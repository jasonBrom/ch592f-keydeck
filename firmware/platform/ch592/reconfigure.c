#include "c5.h"
#include "usb_transport.h"
#include "ble_transport.h"
#include "report_rates.h"
#include "reconfigure.h"
/* USB must not disconnect while SAVE or READ still has an outstanding ACK.
 * Command11 is separately acknowledged. Wait for endpoint IN completion (or
 * the BLE response queue) and then a grace period before changing transport.
 * No busy wait: BLE, input scan and board service continue during detach. */
static uint8_t phase,source,target_usb;
static uint16_t target_ble;
static uint32_t clock_ms,phase_started,config_crc;
uint8_t nd_reconfigure_phase(void){return phase;}
bool c5_hal_reconfigure(uint8_t transport) {
    if(phase||transport<1||transport>2)return false;
    if(transport==1&&!nd_usb_ready())return false;
    if(transport==2&&!nd_ble_connected())return false;
    const uint8_t *cfg=c5_config();
    target_usb=c5_usb_interval_for_setting(cfg[19]);
    target_ble=c5_ble_interval_for_setting(cfg[24]);
    config_crc=c5_crc32(cfg,C5_CONFIG_SIZE);
    source=transport;phase=1;phase_started=clock_ms;
    return true;
}
void c5_hal_rate_status(uint8_t *usb_ms,uint16_t *ble_units) {
    *usb_ms=nd_usb_ready()?nd_usb_interval_ms():0;
    *ble_units=nd_ble_actual_interval();
}
void nd_reconfigure_poll(uint32_t ms,bool usb_ack_pending,bool ble_ack_pending) {
    clock_ms=ms;
    if(!phase)return;
    if(phase==3) {
        if((uint32_t)(ms-phase_started)>=300u){nd_usb_attach(target_usb);phase=0;}
        return;
    }
    bool source_up=source==1?nd_usb_ready():nd_ble_connected();
    if(!source_up||(uint32_t)(ms-phase_started)>5000u){phase=0;return;}
    if(phase==1) {
        bool pending=source==1?usb_ack_pending:ble_ack_pending;
        bool idle=source==1?nd_usb_config_idle():nd_ble_config_idle();
        if(!pending&&idle){phase=2;phase_started=ms;}
        return;
    }
    if((uint32_t)(ms-phase_started)<120u)return;
    /* If another client changed RAM after command11, don't apply stale targets. */
    if(c5_crc32(c5_config(),C5_CONFIG_SIZE)!=config_crc){phase=0;return;}
    nd_ble_request_interval(target_ble);
    if(target_usb!=nd_usb_interval_ms()) {
        nd_usb_detach();phase=3;phase_started=ms;
    } else phase=0;
}
