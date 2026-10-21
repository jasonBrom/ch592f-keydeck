#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "c5.h"
#include "report_rates.h"
#include "reconfigure.h"
static uint8_t config[C5_CONFIG_SIZE];
static bool usb=true,ble=true,usb_idle=true,ble_idle=true;
static uint8_t usb_interval=1;
static uint16_t ble_actual=12;
static unsigned detaches,attaches,ble_requests;
static uint16_t ble_requested;
const uint8_t *c5_config(void){return config;}
uint32_t c5_crc32(const uint8_t *p,size_t n){uint32_t x=0;while(n--)x=x*33u+*p++;return x;}
bool nd_usb_ready(void){return usb;}
bool nd_ble_connected(void){return ble;}
bool nd_usb_config_idle(void){return usb_idle;}
bool nd_ble_config_idle(void){return ble_idle;}
uint8_t nd_usb_interval_ms(void){return usb_interval;}
uint16_t nd_ble_actual_interval(void){return ble?ble_actual:0;}
void nd_usb_detach(void){usb=false;++detaches;}
void nd_usb_attach(uint8_t ms){usb=true;usb_interval=ms;++attaches;}
void nd_ble_request_interval(uint16_t units){ble_requested=units;++ble_requests;}
int main(void){
    const unsigned rates[5]={1000,125,250,500,1000};
    for(unsigned s=0;s<5;s++) {
        uint8_t interval=c5_usb_interval_for_setting(s);unsigned count=0;uint32_t previous=0;
        assert(interval==1000/rates[s]);
        for(uint32_t t=1;t<=1000;t++)if(c5_report_period_elapsed(t,previous,interval)){previous=t;++count;}
        assert(count==rates[s]);
    }
    assert(c5_report_period_elapsed(2,0xfffffffeu,4));
    assert(!c5_report_period_elapsed(1,0xfffffffeu,4));
    assert(c5_ble_interval_for_setting(0)==6&&c5_ble_interval_for_setting(1)==6);
    assert(c5_ble_interval_for_setting(2)==12&&c5_ble_interval_for_setting(3)==24);
    config[19]=1;config[24]=3;
    nd_reconfigure_poll(100,false,false);assert(c5_hal_reconfigure(1));
    nd_reconfigure_poll(500,true,false);assert(!detaches&&!ble_requests);
    usb_idle=false;nd_reconfigure_poll(900,false,false);assert(!detaches);
    usb_idle=true;nd_reconfigure_poll(1000,false,false); /* physical ACK completed */
    nd_reconfigure_poll(1119,false,false);assert(!detaches);
    nd_reconfigure_poll(1120,false,false);assert(detaches==1&&ble_requested==24);
    nd_reconfigure_poll(1419,false,false);assert(!attaches&&!usb);
    nd_reconfigure_poll(1420,false,false);assert(attaches==1&&usb_interval==8);
    /* Actual BLE rate remains controller-reported, never the requested value. */
    uint8_t u;uint16_t b;c5_hal_rate_status(&u,&b);assert(u==8&&b==12);
    usb=false;c5_hal_rate_status(&u,&b);assert(u==0&&b==12&&nd_usb_interval_ms()==8);usb=true;
    config[24]=2;assert(c5_hal_reconfigure(2));
    nd_reconfigure_poll(1500,false,false);nd_reconfigure_poll(1620,false,false);
    assert(ble_requested==12&&detaches==1&&attaches==1);
    /* Reject stale target if config changed after command11. */
    assert(c5_hal_reconfigure(1));nd_reconfigure_poll(1700,false,false);
    config[19]=2;nd_reconfigure_poll(1820,false,false);assert(detaches==1);
    /* Lost source or undelivered ACK times out without changing transports. */
    assert(c5_hal_reconfigure(1));usb=false;nd_reconfigure_poll(1900,false,false);usb=true;
    assert(c5_hal_reconfigure(1));nd_reconfigure_poll(7000,true,false);assert(detaches==1);
    assert(c5_hal_reconfigure(1));assert(!c5_hal_reconfigure(2));
    usb=false;nd_reconfigure_poll(7001,false,false);usb=true;
    assert(!c5_hal_reconfigure(0));
    puts("report rates: mappings, pacing, rollover, ACK gate, reconnect, stale config and disconnect/timeout passed");
}
