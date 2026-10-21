#ifndef C5_BOARD_H
#define C5_BOARD_H
#include <stdbool.h>
#include <stdint.h>

/* Call after 60 MHz clock setup, before c5_init; then board_tick once per ms.
 * GPIOA ISR only captures encoder states; other services run in main/task context. TMR3 is reserved as a free-running
 * application clock and timeout counter. PB22 BOOT is a pulled-up input for
 * application pairing; its ROM boot function and PB23 RESET are preserved. */
void board_init(void);
void board_tick(uint32_t milliseconds);
/* Drain captured encoder states on every main-loop pass. GPIO interrupts keep
 * sampling during stack/I2C work; key/peripheral service stays on real-ms ticks. */
void board_encoder_init(void);
void board_poll_encoder(void);
bool board_take_pairing_request(void);
uint32_t board_time_ticks(void);
uint32_t board_elapsed_ticks(uint32_t start);
void board_delay_us(uint32_t us);
bool board_haptic_ready(void);
uint8_t board_haptic_fault(void);
uint32_t board_rgb_max_irq_ticks(void);

void board_haptic_init(void);
void board_haptic_tick(uint32_t ms);
void board_rgb_init(void);
void board_rgb_tick(uint32_t ms);
#endif
