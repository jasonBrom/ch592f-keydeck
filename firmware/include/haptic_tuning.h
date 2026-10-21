#ifndef C5_HAPTIC_TUNING_H
#define C5_HAPTIC_TUNING_H
#include <stdbool.h>
#include <stdint.h>
#define C5_TUNING_SIZE 8u
#define C5_TUNING_OFFSET 1016u
#define C5_TUNING_CAPABILITY 0x80000u
/* HP1 reserved tail: C1, drive/startup/stabilizer/twice, brake/loop/sample,
 * blank/idiss, rated (10mVrms), peak clamp code, cal-time/ZC, pulse ms.
 * Zero tail means firmware defaults. Never stores invented calibration output. */
void c5_tuning_defaults(uint8_t p[8]);
bool c5_tuning_valid(const uint8_t p[8]);
bool c5_tuning_empty(const uint8_t p[8]);
uint8_t c5_tuning_rated_code(const uint8_t p[8]);
#ifdef C5_HAPTIC_CALIBRATION
bool c5_hal_haptic_calibrating(void);
bool c5_hal_haptic_configure(const uint8_t p[8]);
bool c5_hal_haptic_tuning_matches(const uint8_t p[8]);
uint8_t c5_hal_haptic_pulse_ms(void);
uint8_t c5_hal_haptic_calibration(uint8_t action,const uint8_t *p);
bool c5_hal_haptic_calibration_status(uint8_t page,uint8_t out[12]);
uint8_t c5_haptic_calibration_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n);
#endif
#endif
