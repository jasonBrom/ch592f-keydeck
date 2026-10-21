#ifndef C5_HAPTIC_H
#define C5_HAPTIC_H
#include <stdbool.h>
#include <stdint.h>
#define C5_HAPTIC_OFFSET 943u
#define C5_HAPTIC_SIZE 81u
enum { C5_HE_KEY, C5_HE_PRESS, C5_HE_TURN, C5_HE_PROFILE, C5_HE_MACRO_START, C5_HE_MACRO_END };
/* HP1 block: enabled, editor mode, sequence count, RTP count, 8 ROM slots,
 * 16 RTP triples (percent, duration LE16), 6 event IDs, minimum turn interval
 * LE16, signed ROM sustain offset in 5ms units, timeout in 100ms units,
 * eight tuning bytes (zero on legacy). Event IDs: 0=off, 1..123=ROM,
 * 124=sequence, 125=RTP, 126=standard pulse (TURN-only in1.12, any event1.13). */
bool c5_validate_haptic(const uint8_t h[C5_HAPTIC_SIZE]);
#ifdef C5_ADVANCED_HAPTICS
void c5_haptic_event(uint8_t event);
void c5_haptic_tick(uint32_t ms);
void c5_haptic_reset(void);
void c5_haptic_lost(uint8_t source);
uint8_t c5_haptic_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n,uint16_t offset);
bool c5_hal_haptic_sequence(const uint8_t *slots,uint8_t count,int8_t sustain,uint16_t timeout_ms);
bool c5_hal_haptic_envelope(const uint8_t *steps,uint8_t count,uint8_t gain,uint16_t timeout_ms);
bool c5_hal_haptic_busy(void);
#endif
#endif
