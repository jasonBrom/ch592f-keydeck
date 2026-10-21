#include "CH59x_common.h"
#include "c5.h"
#include "board.h"
#include "haptic.h"
#include "motor_sound.h"
#include "haptic_tuning.h"

#ifdef C5_NO_HAPTICS
/* No pin setup, I2C transfers, calibration or playback on motorless hardware.
 * Keep the shared 1024-byte configuration layout and the HAL ABI intact. */
void board_haptic_init(void) {}
void board_haptic_tick(uint32_t ms) { (void)ms; }
bool board_haptic_ready(void) { return false; }
uint8_t board_haptic_fault(void) { return 0; }
bool c5_hal_haptic(uint8_t strength) { return strength == 0; }
#ifdef C5_ADVANCED_HAPTICS
bool c5_hal_haptic_busy(void) { return false; }
bool c5_hal_haptic_sequence(const uint8_t *p,uint8_t n,int8_t s,uint16_t ms)
{ (void)p;(void)n;(void)s;(void)ms;return false; }
bool c5_hal_haptic_envelope(const uint8_t *p,uint8_t n,uint8_t gain,uint16_t ms)
{ (void)p;(void)n;(void)gain;(void)ms;return false; }
#endif
#else

#define SDA GPIO_Pin_14
#define SCL GPIO_Pin_15
#define DRV_ADDR 0x5au
#define I2C_STRETCH_US 150u
enum { HAPTIC_START, HAPTIC_PROGRAM, HAPTIC_CALIBRATE, HAPTIC_READY, HAPTIC_FAILED, HAPTIC_DIAGNOSTIC };
static uint8_t phase, fault, setup_index;
static uint32_t next_ms, calibration_ms, stop_ms, current_ms;
static bool playing;
/* Pattern pointers refer to the stable config or the preview upload buffer.
 * Applying/replacing either always cancels playback first. No heap or queue. */
static const uint8_t *envelope;
static uint8_t playback_mode,segment,segment_count,envelope_gain;
static uint32_t segment_ms,limit_ms;
#ifdef C5_HAPTIC_CALIBRATION
static uint8_t tuning[8],rollback_tuning[8],rollback_result[3];
static uint8_t job_kind,job_result,job_status,tuning_generation,last_period,last_supply;
static bool rollback_valid,measurement_valid;
static uint8_t drv_setting(uint8_t reg,uint8_t fallback);
static bool drv_resume(void);
static void drv_job_complete(uint8_t status,bool timeout);
static void drv_measure(void);
#endif

/* Open drain emulation: latch stays zero. A high is always input/released,
 * never push-pull, so slave ACK and clock stretching cannot short a driver.
 * Rev.E 0-ohm jumpers R16/R17 must be fitted and CFG_DEBUG_EN must be0. */
static void low(uint32_t pins) { R32_PB_CLR = pins; R32_PB_DIR |= pins; }
static void release(uint32_t pins) { R32_PB_DIR &= ~pins; }
static bool high_clock(void)
{
    uint32_t start=board_time_ticks();
    release(SCL);
    while (!GPIOB_ReadPortPin(SCL)) {
        if (board_elapsed_ticks(start) >= I2C_STRETCH_US*(FREQ_SYS/1000000u)) return false;
    }
    return true;
}
static void half(void) { board_delay_us(3); }
static void stop(void)
{
    low(SDA); half();
    (void)high_clock(); half();
    release(SDA); half();
}
#ifndef C5_HAPTIC_REGISTER_TEST
static bool start(void)
{
    release(SDA);
    if (!high_clock()) return false;
    half();
    if (!GPIOB_ReadPortPin(SDA)) return false;
    low(SDA); half(); low(SCL); half();
    return true;
}
static bool send(uint8_t data)
{
    for (unsigned i=0; i<8; ++i) {
        if (data & 0x80) release(SDA); else low(SDA);
        data <<= 1;
        half(); if (!high_clock()) return false; half(); low(SCL);
    }
    release(SDA); half(); if (!high_clock()) return false; half();
    bool ack=!GPIOB_ReadPortPin(SDA);
    low(SCL); half();
    return ack;
}
static bool receive(uint8_t *value)
{
    uint8_t data=0;
    release(SDA);
    for (unsigned i=0; i<8; ++i) {
        half(); if (!high_clock()) return false; half();
        data=(data << 1) | (GPIOB_ReadPortPin(SDA)!=0);
        low(SCL);
    }
    /* Single-byte read: master sends NACK, then STOP. */
    release(SDA); half(); if (!high_clock()) return false; half(); low(SCL);
    *value=data;
    return true;
}
static bool write_reg(uint8_t reg,uint8_t data)
{
    bool ok=start() && send(DRV_ADDR<<1) && send(reg) && send(data);
    stop();
    return ok;
}
static bool read_reg(uint8_t reg,uint8_t *value)
{
    bool ok=start() && send(DRV_ADDR<<1) && send(reg) &&
            start() && send((DRV_ADDR<<1)|1) && receive(value);
    stop();
    return ok;
}
#else
extern bool haptic_test_write(uint8_t reg,uint8_t data);
extern bool haptic_test_read(uint8_t reg,uint8_t *value);
static bool write_reg(uint8_t reg,uint8_t data){return haptic_test_write(reg,data);}
static bool read_reg(uint8_t reg,uint8_t *value){return haptic_test_read(reg,value);}
#endif
static void fail(uint8_t error)
{
#ifdef C5_HAPTIC_CALIBRATION
    if(job_result==1)job_result=4;
    ++tuning_generation;
#endif
    fault=error;
    playing=false;
    phase=HAPTIC_FAILED;
    /* Best-effort standby if device is still reachable. No indefinite retry. */
    (void)write_reg(0x02,0);
    (void)write_reg(0x01,0x40);
    release(SDA|SCL);
}

void board_haptic_init(void)
{
    GPIOB_ModeCfg(SDA|SCL,GPIO_ModeIN_Floating);
    R32_PB_CLR=SDA|SCL;
    phase=HAPTIC_START; fault=0; setup_index=0; next_ms=10;
    playing=false;playback_mode=segment=segment_count=0;envelope=NULL;
#ifdef C5_HAPTIC_CALIBRATION
    c5_tuning_defaults(tuning);rollback_valid=measurement_valid=false;
    job_kind=job_result=1;job_status=tuning_generation=last_period=last_supply=0;
#endif
}
bool board_haptic_ready(void) { return phase==HAPTIC_READY; }
uint8_t board_haptic_fault(void) { return fault; }

/* AAC 0809 supplied for this device: 170+/-10Hz, 0.9Vrms rated,
 * 0.1-1.0Vrms AC sine operating range. This replaces the original BOM LRA.
 * TI SLOS854D 8.5.1, 8.5.2 and 8.6 (SAMPLE_TIME=300us):
 * rated=floor(0.9*sqrt(1-(4*0.0003+0.0003)*170)/0.02058)=37(0x25)
 * clamp=floor(1.0*sqrt(2)/0.02122)=66(0x42): at most 1.40052V peak,
 * below the specified 1.0Vrms sine peak; no undocumented overdrive boost.
 * drive=round((500/170-0.5)/0.1)=24; OL period=round(1/(170*98.46us))=60.
 * Automatic open-loop fallback remains disabled. Auto cal runs at each power-up;
 * compensation/BEMF results stay in DRV RAM and are never invented constants.
 */
enum {
    DRV_RATED_VOLTAGE=0x25, DRV_OD_CLAMP=0x42,
    DRV_DRIVE_CONTROL=0x98, DRV_OL_PERIOD=0x3c
};
static const uint8_t setup[][2] = {
    {0x01,0x00}, {0x03,0x06}, {0x16,DRV_RATED_VOLTAGE}, {0x17,DRV_OD_CLAMP},
    {0x1a,0xb6}, {0x1b,DRV_DRIVE_CONTROL}, {0x1c,0xf5}, {0x1d,0x80},
    {0x1e,0x30}, {0x1f,0x80}, {0x20,DRV_OL_PERIOD}, {0x01,0x07}, {0x0c,0x01}
};

void board_haptic_tick(uint32_t ms)
{
    uint8_t status, go;
    current_ms=ms;
    if ((int32_t)(ms-next_ms)<0) return;
    if (phase==HAPTIC_START) {
        /* Nine SCL clocks recover a slave interrupted mid-byte by MCU reset. */
        release(SDA|SCL);
        for (unsigned i=0; i<9 && !GPIOB_ReadPortPin(SDA); ++i) {
            low(SCL); half();
            if (!high_clock()) { fail(1); return; }
            half();
        }
        stop();
        if (!read_reg(0x00,&status) || (status & 0xe0)!=0xe0) { fail(2); return; }
        phase=HAPTIC_PROGRAM;
    }
    if (phase==HAPTIC_PROGRAM) {
        uint8_t reg=setup[setup_index][0],value=setup[setup_index][1];
#ifdef C5_HAPTIC_CALIBRATION
        value=drv_setting(reg,value);
#endif
        if (!write_reg(reg,value)) { fail(3); return; }
        next_ms=ms+1;
        if (++setup_index == sizeof(setup)/sizeof(setup[0])) {
            phase=HAPTIC_CALIBRATE; calibration_ms=ms; next_ms=ms+20;
        }
        return;
    }
    if (phase==HAPTIC_CALIBRATE || phase==HAPTIC_DIAGNOSTIC) {
        if (!read_reg(0x0c,&go)) { fail(4); return; }
        if (go & 1) {
            if ((uint32_t)(ms-calibration_ms)>1400) {
#ifdef C5_HAPTIC_CALIBRATION
                drv_job_complete(0,true);
#else
                fail(5);
#endif
                return;
            }
            next_ms=ms+20; return;
        }
        if (!read_reg(0x00,&status)) { fail(6); return; }
#ifdef C5_HAPTIC_CALIBRATION
        drv_job_complete(status,false);
#else
        if(status&0x0b){fail(6);return;}
        /* Unsigned unidirectional closed-loop RTP has0=off,255=full amplitude. */
        if (!write_reg(0x1c,0x75) || !write_reg(0x1d,0x88) ||
            !write_reg(0x02,0) || !write_reg(0x01,0x05)) { fail(7); return; }
        phase=HAPTIC_READY;
#endif
        return;
    }
    if (phase==HAPTIC_READY && playing) {
        if ((int32_t)(ms-limit_ms)>=0) { (void)c5_hal_haptic(0); return; }
        if (playback_mode==1) {
            next_ms=ms+10;
            if (!read_reg(0x0c,&go)||!read_reg(0x00,&status)||(status&0x03)) {fail(10);return;}
            if (!(go&1)) (void)c5_hal_haptic(0);
        } else if (playback_mode==2) {
            uint8_t old=segment;
            /* Catch up to absolute time; never replay segments missed during
             * Flash writes or BLE work. At most 16 bounded iterations. */
            while ((int32_t)(ms-segment_ms)>=0) {
                if (++segment>=segment_count) {(void)c5_hal_haptic(0);return;}
                const uint8_t *s=envelope+3*segment;
                segment_ms+=(uint16_t)(s[1]|((uint16_t)s[2]<<8));
            }
            if (segment!=old) {
                uint8_t a=(uint8_t)((uint32_t)envelope[3*segment]*envelope_gain*255u/10000u);
                if (!write_reg(0x02,a)) fail(11);
            }
        } else if ((int32_t)(ms-stop_ms)>=0) {
            (void)c5_hal_haptic(0);
        }
    }
}

bool c5_hal_haptic(uint8_t strength)
{
    if (!board_haptic_ready()) return false;
#ifdef C5_HAPTIC_CALIBRATION
    if(playing)drv_measure();
#endif
    if (strength>100) strength=100;
#ifdef C5_MOTOR_SOUND
    if(playback_mode==3){
        /* Stop drive first, then restore auto resonance and its fallback period.
         * Ordinary pulses and ROM effects must never inherit experiment pitch. */
        if(!write_reg(0x02,0)||!write_reg(0x1d,
#ifdef C5_HAPTIC_CALIBRATION
        drv_setting(0x1d,0x88)
#else
        0x88
#endif
        )||!write_reg(0x20,DRV_OL_PERIOD)){fail(17);return false;}
    }
#endif
    /* Cancel the ROM sequencer before returning to unsigned unidirectional RTP.
     * Set amplitude to zero before the mode switch, avoiding a stale kick. */
    if (playback_mode && (!write_reg(0x0c,0)||!write_reg(0x02,0)||
        !write_reg(0x1c,
#ifdef C5_HAPTIC_CALIBRATION
        drv_setting(0x1c,0x75)
#else
        0x75
#endif
        )||!write_reg(0x01,0x05))) {fail(12);return false;}
    playback_mode=0;envelope=NULL;segment_count=0;next_ms=current_ms;
    /* A longer pulse can feel like a buzz. Keep short-click duration separate
     * from chip calibration; user tuning selects 4..120ms, default 24ms. */
    if (!write_reg(0x02,(uint8_t)((uint16_t)strength*255u/100u))) { fail(9); return false; }
    playing=strength!=0;
    stop_ms=current_ms+
#ifdef C5_HAPTIC_CALIBRATION
        tuning[7];
#else
        C5_HAPTIC_PULSE_MS;
#endif
    limit_ms=stop_ms;
    return true;
}

#ifdef C5_ADVANCED_HAPTICS
bool c5_hal_haptic_busy(void){return playing;}
#ifdef C5_MOTOR_SOUND
bool c5_hal_motor_sound(uint8_t period,uint8_t gain,uint16_t duration_ms)
{
    if(!board_haptic_ready()||period<20||period>127||gain>C5_MOTOR_SOUND_MAX_GAIN||
       !duration_ms||duration_ms>C5_MOTOR_SOUND_MAX_MS)return false;
    if(!gain)return c5_hal_haptic(0);
    if(playback_mode!=3){
        /* Open-loop uses mid-scale zero in unsigned RTP, unlike normal
         * unidirectional closed-loop. Signed RTP makes zero remain zero during
         * both mode transitions, avoiding an unintended reverse full drive. */
        if(!c5_hal_haptic(0)||!write_reg(0x1d,0x81)){fail(18);return false;}
        playback_mode=3;
    }
    /* TI SLOS854D: RTP with LRA_OPEN_LOOP uses OL_LRA_PERIOD*98.46us.
     * Keep original voltage clamps/calibration; amplitude is capped at20%.
     * This synthesizes a narrow-band tone, not decoded PCM or LE Audio. */
    if(!write_reg(0x20,period)||!write_reg(0x02,(uint8_t)((uint16_t)gain*127u/100u))){fail(19);return false;}
    envelope=NULL;segment_count=0;playing=true;next_ms=current_ms;
    stop_ms=limit_ms=current_ms+duration_ms;
    return true;
}
bool c5_hal_motor_diagnostics(uint8_t out[12])
{
    static const uint8_t registers[]={0x00,0x01,0x02,0x0c,0x1c,0x1d,0x20,0x16,0x17,0x21};
    out[0]=phase;out[1]=fault;
    for(unsigned i=0;i<sizeof registers;i++)if(!read_reg(registers[i],out+2+i))return false;
    return true;
}
#endif
bool c5_hal_haptic_sequence(const uint8_t *slots,uint8_t count,int8_t sustain,uint16_t timeout_ms)
{
    if(!board_haptic_ready()||!slots||!count||count>8||sustain < -20||sustain>20||
       !timeout_ms||timeout_ms>15000)return false;
    for(uint8_t i=0;i<count;i++)if(!slots[i]||slots[i]==128||(slots[i]<128&&slots[i]>123))return false;
    if(!c5_hal_haptic(0))return false;
    /* Library 6 is LRA. ROM amplitude is defined by the selected effect ID;
     * changing rated voltage to imitate an intensity slider would invalidate
     * motor calibration. Only the documented positive sustain offset is used. */
    if(!write_reg(0x1c,
#ifdef C5_HAPTIC_CALIBRATION
       drv_setting(0x1c,0xf5))
#else
       0xf5)
#endif
       ||!write_reg(0x03,6)||!write_reg(0x0e,(uint8_t)sustain)||
       !write_reg(0x01,0)) {fail(13);return false;}
    for(uint8_t i=0;i<8;i++)if(!write_reg(0x04+i,i<count?slots[i]:0)) {fail(14);return false;}
    if(!write_reg(0x0c,1)) {fail(15);return false;}
    playback_mode=1;playing=true;limit_ms=current_ms+timeout_ms;next_ms=current_ms+10;
    return true;
}
bool c5_hal_haptic_envelope(const uint8_t *steps,uint8_t count,uint8_t gain,uint16_t timeout_ms)
{
    if(!board_haptic_ready()||!steps||!count||count>16||gain>100||!timeout_ms||timeout_ms>15000)return false;
    uint32_t total=0;
    for(uint8_t i=0;i<count;i++){
        const uint8_t *s=steps+3*i;uint16_t d=(uint16_t)(s[1]|((uint16_t)s[2]<<8));
        if(s[0]>100||d<4||d>5000)return false;
        total+=d;
    }
    if(total>5000||!c5_hal_haptic(0))return false;
    if(!gain)return true;
    envelope=steps;envelope_gain=gain;segment=0;segment_count=count;playback_mode=2;
    segment_ms=current_ms+(uint16_t)(steps[1]|((uint16_t)steps[2]<<8));
    limit_ms=current_ms+(total<timeout_ms?total:timeout_ms);playing=true;
    if(!write_reg(0x02,(uint8_t)((uint32_t)steps[0]*gain*255u/10000u))) {fail(16);return false;}
    return true;
}
#endif

#ifdef C5_HAPTIC_CALIBRATION
#include "drv2605_tuning.inc"
#endif
#endif /* C5_NO_HAPTICS */
