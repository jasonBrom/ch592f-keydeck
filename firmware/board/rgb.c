#include "CH59x_common.h"
#include "c5.h"
#include "board.h"

/* GL6028RGB01H-W manufacturer 2023/05: RGB order, T0H0.30us,
 * T1H0.90us, reset>200us. XL4020: GRB order, own WS2812 timings.
 * Frozen pins cannot use SPI MOSI/PWM DMA. Fixed instructions execute from
 * RAM .highcode; clock is fixed60MHz. See README for scope acceptance gate. */
static uint8_t pending_keys[15],pending_status[3];
static bool dirty_keys,dirty_status;
static uint32_t last_keys_ms,last_status_ms,max_irq_ticks;

#define NOPS(n) ".rept " #n "\nnop\n.endr\n"

/* Low intervals may be extended by the loop; GL datasheet expressly allows
 * low<20us with symbol>=1.2us. IRQs are restored before reset/latch interval.
 * Memory bus/store latency is not CPU-nop latency: first board must measure
 * high pulses and adjust counts if needed. No claim of scope validation. */
static __HIGH_CODE __attribute__((noinline)) void send_gl(const uint8_t *bytes,unsigned len)
{
    uint32_t hi=R32_PB_OUT|GPIO_Pin_13, lo=GPIO_Pin_13;
    for(unsigned n=0;n<len;++n) {
        uint8_t b=bytes[n];
        for(unsigned bit=0;bit<8;++bit) {
            if(b&0x80) {
                __asm__ volatile("sw %[hi],0(%[out])\n" NOPS(53)
                                 "sw %[lo],0(%[clr])\n" NOPS(17)
                                 ::[hi]"r"(hi),[lo]"r"(lo),[out]"r"(&R32_PB_OUT),[clr]"r"(&R32_PB_CLR):"memory");
            } else {
                __asm__ volatile("sw %[hi],0(%[out])\n" NOPS(17)
                                 "sw %[lo],0(%[clr])\n" NOPS(53)
                                 ::[hi]"r"(hi),[lo]"r"(lo),[out]"r"(&R32_PB_OUT),[clr]"r"(&R32_PB_CLR):"memory");
            }
            b<<=1;
        }
    }
}
static __HIGH_CODE __attribute__((noinline)) void send_xl(const uint8_t *bytes)
{
    uint32_t hi=R32_PA_OUT|GPIO_Pin_15,lo=GPIO_Pin_15;
    for(unsigned n=0;n<3;++n) {
        uint8_t b=bytes[n];
        for(unsigned bit=0;bit<8;++bit) {
            if(b&0x80) {
                __asm__ volatile("sw %[hi],0(%[out])\n" NOPS(47)
                                 "sw %[lo],0(%[clr])\n" NOPS(25)
                                 ::[hi]"r"(hi),[lo]"r"(lo),[out]"r"(&R32_PA_OUT),[clr]"r"(&R32_PA_CLR):"memory");
            } else {
                __asm__ volatile("sw %[hi],0(%[out])\n" NOPS(23)
                                 "sw %[lo],0(%[clr])\n" NOPS(49)
                                 ::[hi]"r"(hi),[lo]"r"(lo),[out]"r"(&R32_PA_OUT),[clr]"r"(&R32_PA_CLR):"memory");
            }
            b<<=1;
        }
    }
}
void board_rgb_init(void)
{
    GPIOA_ResetBits(GPIO_Pin_15); GPIOB_ResetBits(GPIO_Pin_13);
    GPIOA_ModeCfg(GPIO_Pin_15,GPIO_ModeOut_PP_5mA);
    GPIOB_ModeCfg(GPIO_Pin_13,GPIO_ModeOut_PP_5mA);
    dirty_keys=dirty_status=true;
}
void c5_hal_lights(const uint8_t keys[15],const uint8_t status[3])
{
    if(memcmp(pending_keys,keys,15)!=0) { memcpy(pending_keys,keys,15);dirty_keys=true; }
    uint8_t grb[3]={status[1],status[0],status[2]};
    if(memcmp(pending_status,grb,3)!=0) { memcpy(pending_status,grb,3);dirty_status=true; }
}
void board_rgb_tick(uint32_t ms)
{
    /* Core renders status, pairing, and idle darkness together. The hardware
     * layer must not override a black frame after the lamp has timed out. */
    /* At most one string in one tick; every string keeps at least1ms low for
     * latch and <=40fps. Sending150 bytes or keeping IRQs off for latch is
     * intentionally avoided. Only120bits on the longer chain. */
    if(dirty_keys && (uint32_t)(ms-last_keys_ms)>=25) {
        uint32_t irq=__risc_v_disable_irq(), t=board_time_ticks();
        send_gl(pending_keys,15);
        uint32_t elapsed=board_elapsed_ticks(t);
        __risc_v_enable_irq(irq);
        if(elapsed>max_irq_ticks) max_irq_ticks=elapsed;
        dirty_keys=false;last_keys_ms=ms;
    } else if(dirty_status &&
              (uint32_t)(ms-last_status_ms)>=25) {
        uint32_t irq=__risc_v_disable_irq(), t=board_time_ticks();
        send_xl(pending_status);
        uint32_t elapsed=board_elapsed_ticks(t);
        __risc_v_enable_irq(irq);
        if(elapsed>max_irq_ticks) max_irq_ticks=elapsed;
        dirty_status=false;last_status_ms=ms;
    }
}
uint32_t board_rgb_max_irq_ticks(void) { return max_irq_ticks; }
