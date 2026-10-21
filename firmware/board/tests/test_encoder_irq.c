#include <assert.h>
#include <stdio.h>
#include "CH59x_common.h"
#include "../encoder_capture.c"
volatile uint16_t mock_flags;
uint32_t mock_port;
static uint8_t config[1024];
static int total,calls;
static bool enabled,dual_edge;
const uint8_t *c5_config(void){return config;}
void c5_input_encoder(int16_t delta){assert(enabled);total+=delta;calls++;}
void PFIC_DisableIRQ(int id){assert(id==GPIO_A_IRQn);enabled=false;}
void PFIC_EnableIRQ(int id){assert(id==GPIO_A_IRQn);enabled=true;}
void GPIOA_ITModeCfg(uint32_t pins,int mode){assert(pins==ENCODER_PINS&&mode==GPIO_ITMode_FallEdge);}
void GPIOA_ITEdgeTypeCfg(uint32_t pins,int state){assert(pins==ENCODER_PINS&&state==ENABLE);dual_edge=true;}
void GPIOA_ClearITFlagBit(uint32_t pins){assert(pins==ENCODER_PINS);mock_flags=0;}
static void edge(uint8_t ab){assert(enabled);mock_port=(uint32_t)ab<<8;mock_flags=ENCODER_PINS;GPIOA_IRQHandler();}
static void cycle(void){edge(1);edge(3);edge(2);edge(0);}
int main(void){
    config[7]=3;config[11]=4;board_encoder_init();assert(enabled&&dual_edge);
    /* Four transitions occur while main is busy in BLE/I2C. Polling only the
     * final AB state would see no motion; the actual ISR preserves all four. */
    cycle();assert(!calls);board_poll_encoder();assert(total==1&&calls==1);
    for(unsigned i=0;i<1000;i++){for(unsigned p=0;p<7;p++)cycle();board_poll_encoder();}
    assert(total==7001);edge(2);edge(3);edge(1);edge(0);board_poll_encoder();assert(total==7000);
    /* Other GPIO interrupts are ignored. Overflow recovers at the present AB
     * state instead of replaying a corrupt partial and producing a false jump. */
    mock_flags=1;GPIOA_IRQHandler();board_poll_encoder();assert(total==7000);
    for(unsigned p=0;p<10;p++){cycle();}
    board_poll_encoder();assert(total==7000);
    cycle();board_poll_encoder();assert(total==7001);
    config[7]=2;board_poll_encoder();cycle();board_poll_encoder();assert(total==7003);
    int before=total;config[7]=0;board_poll_encoder();cycle();board_poll_encoder();
#ifdef C5_SMOOTH_RADIAL
    assert(total==before+4);
#else
    assert(total==before+1);
#endif
    puts("encoder IRQ: real ISR dual-edge setup, BLE/I2C blocked-main capture, reversals, overflow recovery and mode changes passed");
}
