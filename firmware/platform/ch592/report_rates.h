#ifndef C5_REPORT_RATES_H
#define C5_REPORT_RATES_H
#include <stdint.h>
#include <stdbool.h>
/* Schema v1: zero retains the original defaults. Full-speed USB uses literal
 * 1 ms frames, not the high-speed exponent encoding. */
static inline uint8_t c5_usb_interval_for_setting(uint8_t setting) {
    static const uint8_t periods[5]={1,8,4,2,1};
    return setting<5?periods[setting]:1;
}
static inline uint16_t c5_ble_interval_for_setting(uint8_t setting) {
    static const uint16_t periods[4]={6,6,12,24}; /* units of 1.25 ms */
    return setting<4?periods[setting]:6;
}
static inline bool c5_report_period_elapsed(uint32_t now,uint32_t previous,uint8_t period) {
    return (uint32_t)(now-previous)>=period;
}
#endif
