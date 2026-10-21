#ifndef C5_H
#define C5_H
#if defined(C5_NO_HAPTICS) && (defined(C5_HAPTIC_CALIBRATION) || defined(C5_MOTOR_SOUND))
#error "C5_NO_HAPTICS cannot enable calibration or motor sound"
#endif
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define C5_CONFIG_SIZE 1024u
#define C5_FRAME_SIZE 20u
#define C5_PROFILE_COUNT 3u
#define C5_KEY_COUNT 6u
#define C5_MACRO_COUNT 8u
#define C5_MACRO_STEPS 16u
#define C5_STATUS_LIGHT_OFFSET 25u
#define C5_STATUS_LIGHT_MARKER 0x4cu
#define C5_STATUS_LIGHT_CAPABILITY 0x10000u
#define C5_HAPTIC_PULSE_MS 24u
enum c5_transport { C5_TRANSPORT_NONE=0, C5_TRANSPORT_USB=1, C5_TRANSPORT_BLE=2 };
enum c5_report_id { C5_REPORT_KEYBOARD=1, C5_REPORT_CONSUMER=2,
                    C5_REPORT_RADIAL=3, C5_REPORT_MOUSE=4, C5_REPORT_CONFIG=0x20 };
enum c5_status { C5_OK=0, C5_ERR_FRAME=1, C5_ERR_RANGE=2, C5_ERR_BUSY=3,
                 C5_ERR_CRC=4, C5_ERR_CONFIG=5, C5_ERR_IO=6, C5_ERR_UNSUPPORTED=7 };
enum c5_action { C5_ACTION_NONE=0, C5_ACTION_KEYBOARD=1, C5_ACTION_CONSUMER=2,
                 C5_ACTION_SCROLL=3, C5_ACTION_MACRO=4, C5_ACTION_PROFILE=5,
                 C5_ACTION_MOUSE_BUTTONS=6,C5_ACTION_FN=7 };
enum c5_macro_trigger { C5_MACRO_ONCE=0, C5_MACRO_HOLD=1, C5_MACRO_TOGGLE=2 };

void c5_init(void);
void c5_tick(uint32_t milliseconds);
/* Already decoded input units. Normally one configured interval per unit;
 * C5_SMOOTH_RADIAL uses one valid AB edge per unit in native Dial mode only. */
void c5_input_key(uint8_t index, bool pressed);
void c5_input_encoder(int16_t delta_detents);
void c5_link(bool usb_ready, bool ble_ready);
/* Explicit pairing blinks remain visible regardless of normal idle/brightness. */
void c5_pairing_indicator(bool active, bool on);
/* Process exactly 20 bytes, outside IRQ context. Caller queues its 20-byte reply. */
void c5_config_frame(const uint8_t in[C5_FRAME_SIZE], uint8_t out[C5_FRAME_SIZE]);
/* Device transports use this entrypoint to isolate simultaneous USB/BLE writers. */
void c5_config_frame_transport(uint8_t transport, const uint8_t in[C5_FRAME_SIZE], uint8_t out[C5_FRAME_SIZE]);
/* Call on physical link loss, including a BLE config-only connection without HID CCC. */
void c5_config_transport_lost(uint8_t transport);
const uint8_t *c5_config(void);
uint32_t c5_crc32(const uint8_t *data, size_t length);
bool c5_validate_config(const uint8_t config[C5_CONFIG_SIZE]);
void c5_default_config(uint8_t config[C5_CONFIG_SIZE]);

/* Platform implements these hooks. No report IDs inside data. true means copied
 * into an ordered, lossless TX queue; false means retry without consuming data.
 * On link loss discard that transport's TX queue. Never silently drop releases.
 * c5_hal_load returns true only for a full, CRC-checked persistent record.
 * c5_hal_save is synchronous and returns true only after durable verification.
 */
bool c5_hal_report(uint8_t transport, uint8_t report_id, const uint8_t *data, uint8_t length);
bool c5_hal_load(uint8_t out[C5_CONFIG_SIZE]);
bool c5_hal_save(const uint8_t config[C5_CONFIG_SIZE]);
/* false reports an unavailable driver, calibration fault or I/O error. */
bool c5_hal_haptic(uint8_t strength);
void c5_hal_lights(const uint8_t key_rgb[15], const uint8_t status_rgb[3]);
/* OR charging bit (4) into *flags. Return 255 if percentage unknown. */
void c5_hal_status(uint8_t *flags, uint8_t *battery_percent, uint16_t *millivolts);
#ifdef C5_BOARD_DIAGNOSTICS
/* Read-only uptime/RTC counters, raw keys/AB, haptic fault, reconfigure phase. */
void c5_hal_diagnostics(uint8_t out[12]);
/* Read-only BLE role, pairing state, clock source and application uptime. */
void c5_hal_ble_diagnostics(uint8_t out[12]);
#endif
#ifdef C5_REPORT_RATES
/* Active (not merely requested) USB bInterval in ms and BLE interval in 1.25 ms
 * units. 0 means unavailable. Reconfigure must only schedule work: the platform
 * waits until command 11's ACK has been transmitted before changing the links. */
void c5_hal_rate_status(uint8_t *usb_interval_ms, uint16_t *ble_interval_units);
bool c5_hal_reconfigure(uint8_t source_transport);
#endif
#endif
