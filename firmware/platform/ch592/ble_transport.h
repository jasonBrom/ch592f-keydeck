#ifndef C5_BLE_TRANSPORT_H
#define C5_BLE_TRANSPORT_H
#include <stdbool.h>
#include <stdint.h>

/* Requires board clocks first. Owns WCH BLE heap, TMOS and RTC initialization. */
void nd_ble_init(void);
void nd_ble_poll(void);
bool nd_ble_start_pairing(uint32_t ms);
void nd_ble_pairing_tick(uint32_t ms);
bool nd_ble_pairing_active(void);
bool nd_ble_pairing_light(uint32_t ms);
void nd_ble_diagnostics(uint8_t out[12]);
bool nd_ble_ready(void);
bool nd_ble_connected(void);
uint16_t nd_ble_actual_interval(void);
void nd_ble_request_interval(uint16_t interval_units);
bool nd_ble_config_idle(void);
bool nd_ble_config_ready(void);
/* Encrypted and awake; Feature reports do not depend on input CCCs. */
bool nd_ble_features_ready(void);
/* Report IDs are carried by HOGP Report Reference, never inside data. */
bool nd_ble_send(uint8_t id, const uint8_t *data, uint8_t length);
bool nd_ble_config_send(const uint8_t frame[20]);
/* Main-loop callback, never called in an interrupt or GATT callback. */
void nd_platform_config_received(uint8_t transport, const uint8_t frame[20]);
#endif
