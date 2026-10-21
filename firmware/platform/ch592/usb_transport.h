#ifndef C5_USB_TRANSPORT_H
#define C5_USB_TRANSPORT_H
#include <stdbool.h>
#include <stdint.h>
void nd_usb_init(void);
void nd_usb_poll(void);
void nd_usb_time(uint32_t milliseconds);
uint8_t nd_usb_interval_ms(void);
bool nd_usb_config_idle(void);
void nd_usb_detach(void);
void nd_usb_attach(uint8_t interval_ms);
bool nd_usb_ready(void);
bool nd_usb_send(uint8_t id, const uint8_t *data, uint8_t length);
bool nd_usb_config_send(const uint8_t frame[20]);
void nd_platform_config_received(uint8_t transport, const uint8_t frame[20]);
#endif
