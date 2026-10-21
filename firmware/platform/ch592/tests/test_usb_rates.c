#define _GNU_SOURCE
#include <assert.h>
#include <stdio.h>
#include <sys/mman.h>
#include "../usb_transport.c"
static uint8_t config[C5_CONFIG_SIZE];
const uint8_t *c5_config(void){return config;}
size_t c5_features_get(uint8_t id,uint8_t *out,size_t cap){(void)id;(void)out;(void)cap;return 0;}
bool c5_features_set(uint8_t type,uint8_t id,const uint8_t *data,size_t n){(void)type;(void)id;(void)data;(void)n;return false;}
void c5_features_link(bool ready){(void)ready;}
void nd_platform_config_received(uint8_t source,const uint8_t frame[20]){(void)source;(void)frame;}
static void usb_setup(uint8_t type,uint8_t request,uint16_t value,uint16_t len) {
    uint8_t s[8]={type,request,(uint8_t)value,(uint8_t)(value>>8),0,0,(uint8_t)len,(uint8_t)(len>>8)};
    memcpy(ep0,s,8);R8_USB_INT_FG=RB_UIF_TRANSFER;R8_USB_INT_ST=RB_UIS_SETUP_ACT;USB_IRQHandler();
}
int main(void){
    assert(mmap((void *)0x40001000,4096,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS|MAP_FIXED,-1,0)!=(void*)-1);
    assert(mmap((void *)0x40008000,4096,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS|MAP_FIXED,-1,0)!=(void*)-1);
    const unsigned rates[5]={1000,125,250,500,1000};
    for(unsigned setting=0;setting<5;setting++) {
        config[19]=(uint8_t)setting;nd_usb_time(0);nd_usb_init();
        usb_setup(0x80,6,0x0200,66); /* real GET_DESCRIPTOR handler */
        assert(ep0[33]==1000/rates[setting]);
        usb_setup(0,9,1,0);assert(nd_usb_ready());
        unsigned sent=0;const uint8_t keyboard[8]={0};
        for(uint32_t t=1;t<=1000;t++) {
            (void)nd_usb_send(1,keyboard,8);nd_usb_time(t);nd_usb_poll();
            if(input_busy) {
                ++sent;assert(R8_UEP1_T_LEN==9);
                R8_USB_INT_FG=RB_UIF_TRANSFER;R8_USB_INT_ST=UIS_TOKEN_IN|1;USB_IRQHandler();
            }
        }
        assert(sent==rates[setting]);
        nd_usb_detach();assert(!nd_usb_ready());
        assert(!(R8_USB_CTRL&RB_UC_DEV_PU_EN));assert(!(R16_PIN_ANALOG_IE&RB_PIN_USB_DP_PU));
    }
    nd_usb_time(0);nd_usb_attach(1);assert(!nd_usb_ready());
    usb_setup(0,9,1,0);assert(nd_usb_ready());
    uint8_t wheel[4]={0,0,0,1};
    for(unsigned i=0;i<100;i++)assert(nd_usb_send(4,wheel,4));
    assert(((q_head-q_tail)&15u)==1&&queue[q_tail].bytes[4]==100);
    wheel[3]=255;assert(nd_usb_send(4,wheel,4));
    wheel[0]=1;wheel[3]=0;assert(nd_usb_send(4,wheel,4));
    wheel[0]=0;assert(nd_usb_send(4,wheel,4));assert(((q_head-q_tail)&15u)==4);
    usb_setup(0,9,0,0);usb_setup(0,9,1,0);assert(q_head==q_tail);
    const uint8_t keyboard[8]={0},frame[20]={0};
    assert(nd_usb_send(1,keyboard,8));assert(nd_usb_config_send(frame));
    R8_USB_MIS_ST=RB_UMS_SUSPEND;
    assert(!nd_usb_ready()); /* Live hardware wins even before the IRQ is served. */
    R8_USB_INT_FG=RB_UIF_SUSPEND;USB_IRQHandler();
    assert(suspended&&q_head==q_tail&&!input_busy&&!config_busy);
    assert(!nd_usb_send(1,keyboard,8)&&!nd_usb_config_send(frame));
    R8_USB_MIS_ST=0;R8_USB_INT_FG=RB_UIF_SUSPEND;USB_IRQHandler();
    assert(nd_usb_ready()); /* Resume without requiring fresh enumeration. */
    assert(nd_usb_send(1,keyboard,8));nd_usb_time(10000);nd_usb_poll();
    assert(nd_usb_ready()); /* A long gap between HID reports is not PC shutdown. */
    R8_USB_MIS_ST=RB_UMS_SUSPEND;nd_usb_poll(); /* No suspend IRQ. */
    assert(!nd_usb_ready()&&suspended&&q_head==q_tail&&!input_busy);
    R8_USB_MIS_ST=0;nd_usb_poll();assert(nd_usb_ready()); /* No resume IRQ either. */
    usb_setup(0,9,0,0);assert(!nd_usb_ready());
    usb_setup(0,9,1,0);assert(nd_usb_ready());
    R8_USB_INT_FG=RB_UIF_BUS_RST;USB_IRQHandler();assert(!nd_usb_ready());
    usb_setup(0,9,1,0);assert(nd_usb_ready());nd_usb_detach();assert(!nd_usb_ready());
    puts("USB power state: live suspend, interrupt/poll suspend and resume, queue discard, deconfiguration and bus reset passed");
    puts("USB real-source register model: GET_DESCRIPTOR bInterval and 125/250/500/1000 report pacing passed");
    puts("USB input: congested queue keeps exact scroll total and direction/button transition boundaries passed");
}
