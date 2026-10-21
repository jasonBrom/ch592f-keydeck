#include "CH59x_common.h"
#include "c5.h"
#include "board.h"
#include "app_clock.h"
#include "encoder.h"
#include "pairing.h"
#include "ble_transport.h"
#include "reconfigure.h"

#if FREQ_SYS != 60000000
#error "Rev.E GPIO RGB timing requires FREQ_SYS=60000000"
#endif
#define KEY_DEBOUNCE_MS 5u
static uint32_t now_ms, sample_ms, battery_ms;
static uint8_t stable_keys;
static uint8_t debounce[6];
static c5_pair_button pair_button;
static bool pairing_request;
static int16_t adc_offset;
static uint16_t battery_mv;
static bool adc_ok;

uint32_t board_time_ticks(void) { return R32_TMR3_COUNT; }
uint32_t board_elapsed_ticks(uint32_t start)
{ return c5_timer_delta(board_time_ticks(),start); }
void board_delay_us(uint32_t us)
{
    uint32_t start = board_time_ticks();
    while (board_elapsed_ticks(start) < us * (FREQ_SYS / 1000000u)) {}
}

static bool adc_sample(uint16_t *value)
{
    uint32_t start = board_time_ticks();
    ADC_StartUp();
    while (R8_ADC_CONVERT & RB_ADC_START) {
        if (board_elapsed_ticks(start) > FREQ_SYS / 10000u) return false;
    }
    *value = R16_ADC_DATA & RB_ADC_DATA;
    return true;
}

/* Same offset procedure as WCH ADC_DataCalib_Rough, with bounded waits. */
static bool adc_calibrate(void)
{
    uint8_t old_cfg = R8_ADC_CFG;
    uint16_t sample;
    uint32_t sum = 0;
    bool ok = true;
    R8_ADC_CFG = (old_cfg | RB_ADC_OFS_TEST) & ~RB_ADC_DIFF_EN;
    if (!adc_sample(&sample)) ok = false;
    for (unsigned i = 0; ok && i < 16; ++i) {
        ok = adc_sample(&sample);
        sum += (~sample) & RB_ADC_DATA;
    }
    R8_ADC_CFG = old_cfg;
    if (ok) adc_offset = (int16_t)(2048 - ((sum + 8) >> 4));
    return ok;
}

static uint8_t read_keys(void)
{
    uint32_t a = GPIOA_ReadPort(), b = GPIOB_ReadPort();
    return (uint8_t)((!(a & GPIO_Pin_4)) | (!(a & GPIO_Pin_5) << 1) |
                    (!(a & GPIO_Pin_12) << 2) | (!(b & GPIO_Pin_7) << 3) |
                    (!(b & GPIO_Pin_12) << 4) | (!(b & GPIO_Pin_4) << 5));
}

static void sample_inputs(void)
{
    if (c5_pair_button_sample(&pair_button,
                             !GPIOB_ReadPortPin(GPIO_Pin_22), now_ms))
        pairing_request = true;
    const uint8_t raw = read_keys();
    for (unsigned k = 0; k < 6; ++k) {
        const uint8_t mask = 1u << k;
        if ((raw ^ stable_keys) & mask) {
            if (++debounce[k] >= KEY_DEBOUNCE_MS) {
                debounce[k] = 0;
                stable_keys ^= mask;
                c5_input_key(k, (stable_keys & mask) != 0);
            }
        } else debounce[k] = 0;
    }
}


bool board_take_pairing_request(void)
{
    bool requested = pairing_request;
    pairing_request = false;
    return requested;
}

static void sample_battery(void)
{
    uint32_t sum = 0;
    uint16_t sample;
    if (!adc_ok) return;
    /* First measurement >= 250ms after init: divider 1M||470k * 100nF
     * has 32ms time constant. Discard first conversion after channel select. */
    ADC_ChannelCfg(CH_EXTIN_4);
    if (!adc_sample(&sample)) { adc_ok = false; battery_mv = 0; return; }
    for (unsigned i = 0; i < 8; ++i) {
        if (!adc_sample(&sample)) { adc_ok = false; battery_mv = 0; return; }
        int32_t corrected = (int32_t)sample + adc_offset;
        if (corrected < 0) corrected = 0;
        if (corrected > 4095) corrected = 4095;
        sum += (uint16_t)corrected;
    }
    /* WCH table15-2: PGA0dB Vin=ADC*1.05V/2048, not 1.05V/4096.
     * Divider inverse=(1000+470)/470. ppm calibration is applied once. */
    uint32_t raw_mv = (uint32_t)(((uint64_t)sum * 1050u * 1470u +
                         (uint64_t)8u*2048u*470u/2u)/(8u*2048u*470u));
    const uint8_t *cfg = c5_config();
    uint32_t ppm = (uint32_t)cfg[20] | ((uint32_t)cfg[21] << 8) |
                   ((uint32_t)cfg[22] << 16) | ((uint32_t)cfg[23] << 24);
    raw_mv = (uint32_t)(((uint64_t)raw_mv * ppm + 500000u) / 1000000u);
    if (raw_mv < 2000 || raw_mv > 4500) { battery_mv = 0; return; }
    battery_mv = battery_mv ? (uint16_t)((3u*battery_mv+raw_mv+2u)/4u) : raw_mv;
}

void board_init(void)
{
    TMR3_TimerInit(C5_TIMER_PERIOD_TICKS);
    GPIOA_ModeCfg(GPIO_Pin_4 | GPIO_Pin_5 | GPIO_Pin_12 |
                  GPIO_Pin_8 | GPIO_Pin_9, GPIO_ModeIN_PU);
    GPIOB_ModeCfg(GPIO_Pin_7 | GPIO_Pin_12 | GPIO_Pin_4 | GPIO_Pin_22, GPIO_ModeIN_PU);
    GPIOA_ModeCfg(GPIO_Pin_13, GPIO_ModeIN_PU);
    GPIOA_ModeCfg(GPIO_Pin_14, GPIO_ModeIN_Floating);
    GPIOA_PinCfg(GPIO_Pin_14, DISABLE);
    ADC_ExtSingleChSampInit(SampleFreq_3_2, ADC_PGA_0);
    adc_ok = adc_calibrate();
    ADC_ChannelCfg(CH_EXTIN_4);
    board_encoder_init();
    sample_ms = UINT32_MAX;
    battery_ms = 0;
    board_rgb_init();
    board_haptic_init();
}

void board_tick(uint32_t milliseconds)
{
    now_ms = milliseconds;
    if (sample_ms != now_ms) {
        sample_ms = now_ms;
        sample_inputs();
        board_haptic_tick(now_ms);
        board_rgb_tick(now_ms);
    }
    if ((uint32_t)(now_ms - battery_ms) >= (battery_ms ? 1000u : 250u)) {
        battery_ms = now_ms;
        sample_battery();
    }
}

void c5_hal_status(uint8_t *flags, uint8_t *percent, uint16_t *mv)
{
    /* STAT low means charging. STAT high does not prove VBUS, battery present,
     * or charge complete. Rev.E has no charger control or VBUS sense GPIO. */
    if (!GPIOA_ReadPortPin(GPIO_Pin_13)) *flags |= 4;
    *mv = battery_mv;
    *percent = 255;
    if (!battery_mv) return;
    /* Approximate rested single-cell Li-ion curve; not a coulomb counter. */
    static const uint16_t volts[] = {3300,3500,3600,3700,3750,3800,3900,4000,4100,4200};
    static const uint8_t soc[] = {0,5,10,20,35,50,65,80,90,100};
    *percent = battery_mv <= volts[0] ? 0 : 100;
    if(battery_mv<=volts[0])return; /* Do not interpolate below the first point. */
    for (unsigned i=1; i<sizeof(volts)/sizeof(volts[0]); ++i) {
        if (battery_mv < volts[i]) {
            *percent = soc[i-1] + (battery_mv-volts[i-1])*(soc[i]-soc[i-1])/(volts[i]-volts[i-1]);
            break;
        }
    }
}

#ifdef C5_BOARD_DIAGNOSTICS
void c5_hal_diagnostics(uint8_t out[12])
{
    uint32_t rtc=RTC_GetCycle32k();
    for(unsigned i=0;i<4;++i){out[i]=(uint8_t)(now_ms>>(8*i));out[i+4]=(uint8_t)(rtc>>(8*i));}
    out[8]=read_keys();
    out[9]=(GPIOA_ReadPort()>>8)&3;
    out[10]=board_haptic_fault();
    out[11]=nd_reconfigure_phase();
}

void c5_hal_ble_diagnostics(uint8_t out[12])
{
    nd_ble_diagnostics(out);
    if (!GPIOB_ReadPortPin(GPIO_Pin_22)) out[0] |= 0x10;
    for (unsigned i=0;i<4;++i) out[i+8]=(uint8_t)(now_ms>>(8*i));
}
#endif
