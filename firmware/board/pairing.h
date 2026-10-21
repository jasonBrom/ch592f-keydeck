#ifndef C5_PAIRING_H
#define C5_PAIRING_H
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#define C5_PAIR_HOLD_MS 2000u
#define C5_PAIR_WINDOW_MS 120000u
#define C5_PAIR_BLINK_MS 250u

typedef struct {
    uint32_t pressed_at;
    uint8_t debounce, pressed, fired;
} c5_pair_button;

/* One request per press; normal application context only. BOOT's ROM strap
 * behavior at power-on/reset is independent of this debounced long press. */
static inline bool c5_pair_button_sample(c5_pair_button *button, bool pressed,
                                         uint32_t now)
{
    if (pressed != (bool)button->pressed) {
        if (++button->debounce >= 5) {
            button->pressed = pressed;
            button->debounce = 0;
            button->pressed_at = now;
            button->fired = 0;
        }
    } else button->debounce = 0;
    if (button->pressed && !button->fired &&
        (uint32_t)(now - button->pressed_at) >= C5_PAIR_HOLD_MS) {
        button->fired = 1;
        return true;
    }
    return false;
}

typedef struct {
    uint32_t started_at;
    uint8_t active, waiting_disconnect;
} c5_pair_session;

static inline bool c5_pair_session_tick(c5_pair_session *session, uint32_t now,
                                        bool encrypted)
{
    if (!session->active) return false;
    if ((uint32_t)(now - session->started_at) >= C5_PAIR_WINDOW_MS ||
        (encrypted && !session->waiting_disconnect)) {
        session->active = 0;
        return false;
    }
    return true;
}

static inline bool c5_pair_session_light(const c5_pair_session *session, uint32_t now)
{
    return session->active &&
           (((uint32_t)(now - session->started_at) / C5_PAIR_BLINK_MS) & 1u) == 0;
}
#endif
