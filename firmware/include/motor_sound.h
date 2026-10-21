#ifndef C5_MOTOR_SOUND_H
#define C5_MOTOR_SOUND_H
#include <stdbool.h>
#include <stdint.h>
#define C5_MOTOR_SOUND_CAPABILITY 0x20000u
#define C5_MOTOR_DIAGNOSTICS_CAPABILITY 0x40000u
#define C5_MOTOR_SOUND_MAX_GAIN 20u
#define C5_MOTOR_SOUND_MAX_MS 250u
#ifdef C5_MOTOR_SOUND
void c5_motor_sound_init(void);
void c5_motor_sound_reset(void);
void c5_motor_sound_lost(uint8_t source);
void c5_motor_sound_tick(void);
bool c5_motor_sound_active(void);
uint8_t c5_motor_sound_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n,uint16_t offset);
bool c5_hal_motor_sound(uint8_t period,uint8_t gain,uint16_t duration_ms);
bool c5_hal_motor_diagnostics(uint8_t out[12]);
#endif
#endif
