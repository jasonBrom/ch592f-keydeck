#ifndef C5_BLE_FEATURES_H
#define C5_BLE_FEATURES_H
#include <stdint.h>

void nd_ble_features_reset(void);
uint8_t nd_ble_feature_size(uint8_t type, uint8_t id);
uint8_t nd_ble_feature_read(uint8_t type, uint8_t id, uint8_t *out,
    uint16_t *length, uint16_t offset, uint16_t maximum);
uint8_t nd_ble_feature_write(uint8_t type, uint8_t id, const uint8_t *data,
    uint16_t length, uint16_t offset, uint8_t method);
/* Poison an execution replay that mixes a Feature and a non-Feature attribute. */
void nd_ble_feature_reject_other(uint8_t method);
#endif
