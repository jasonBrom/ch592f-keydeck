#include "CH59x_common.h"
#include "c5.h"
#include "board.h"
#include "encoder.h"
#include "encoder_capture.h"
#define ENCODER_PINS (GPIO_Pin_8|GPIO_Pin_9)
static c5_encoder decoder;
static c5_encoder_capture capture;

/* Only capture AB in the ISR. No core, BLE, I2C, or haptic calls here. */
__INTERRUPT __HIGH_CODE void GPIOA_IRQHandler(void){
    uint16_t flags=R16_PA_INT_IF&ENCODER_PINS;
    if(flags){R16_PA_INT_IF=flags;c5_encoder_capture_push(&capture,(GPIOA_ReadPort()>>8)&3);}
}
void board_encoder_init(void){
    PFIC_DisableIRQ(GPIO_A_IRQn);
    capture.read=capture.write=capture.overflow=0;
    c5_encoder_reset(&decoder,(GPIOA_ReadPort()>>8)&3,4);
    GPIOA_ITModeCfg(ENCODER_PINS,GPIO_ITMode_FallEdge);
    GPIOA_ITEdgeTypeCfg(ENCODER_PINS,ENABLE);
    GPIOA_ClearITFlagBit(ENCODER_PINS);
    PFIC_EnableIRQ(GPIO_A_IRQn);
}
void board_poll_encoder(void){
    const uint8_t *config=c5_config();
    uint8_t resolution=c5_encoder_mode_resolution(config[7],config[11]),ab;
    if(capture.overflow||resolution!=decoder.resolution){
        /* Ambiguous/mixed-resolution samples must not become invented motion. */
        PFIC_DisableIRQ(GPIO_A_IRQn);
        capture.read=capture.write;capture.overflow=0;
        c5_encoder_reset(&decoder,(GPIOA_ReadPort()>>8)&3,resolution);
        PFIC_EnableIRQ(GPIO_A_IRQn);return;
    }
    /* Snapshot a finite batch so continuous chatter cannot starve the stack. */
    for(unsigned i=0;i<C5_ENCODER_CAPTURE_SIZE-1u&&c5_encoder_capture_pop(&capture,&ab);i++){
        int8_t delta=c5_encoder_sample(&decoder,ab,resolution);
        if(delta)c5_input_encoder(delta);
    }
}
