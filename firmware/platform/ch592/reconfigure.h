#ifndef C5_RECONFIGURE_H
#define C5_RECONFIGURE_H
#include <stdbool.h>
#include <stdint.h>
uint8_t nd_reconfigure_phase(void);
/* Commands must already have passed core's durable-save + full-readback gate. */
void nd_reconfigure_poll(uint32_t ms,bool usb_ack_pending,bool ble_ack_pending);
#endif
