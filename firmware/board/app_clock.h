#ifndef C5_APP_CLOCK_H
#define C5_APP_CLOCK_H
#include <stdint.h>

/* TMR3 uses the 60 MHz system clock. Its period is CNT_END clocks, not
 * 2^26 clocks; it is reserved by board_init and keeps running during USB/BLE.
 * Poll at least once per timer period (about 1.118 seconds). */
#define C5_TIMER_PERIOD_TICKS 0x03ffffffu
#define C5_TICKS_PER_MS 60000u
typedef struct { uint32_t previous, fraction, milliseconds; } c5_app_clock;
static inline uint32_t c5_timer_delta(uint32_t current,uint32_t previous) {
    return current>=previous?current-previous:C5_TIMER_PERIOD_TICKS-previous+current;
}
static inline uint32_t c5_app_clock_poll(c5_app_clock *clock,uint32_t ticks) {
    uint32_t elapsed=c5_timer_delta(ticks,clock->previous)+clock->fraction;
    clock->previous=ticks;
    clock->milliseconds+=elapsed/C5_TICKS_PER_MS;
    clock->fraction=elapsed%C5_TICKS_PER_MS;
    return clock->milliseconds;
}
#endif
