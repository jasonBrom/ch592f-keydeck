#ifndef C5_ENCODER_IRQ_MOCK_H
#define C5_ENCODER_IRQ_MOCK_H
#include <stdint.h>
#define __INTERRUPT
#define __HIGH_CODE
#define GPIO_Pin_8 (1u<<8)
#define GPIO_Pin_9 (1u<<9)
#define GPIO_A_IRQn 17
#define GPIO_ITMode_FallEdge 2
#define ENABLE 1
extern volatile uint16_t mock_flags;
extern uint32_t mock_port;
#define R16_PA_INT_IF mock_flags
#define GPIOA_ReadPort() mock_port
void PFIC_DisableIRQ(int id);
void PFIC_EnableIRQ(int id);
void GPIOA_ITModeCfg(uint32_t pins,int mode);
void GPIOA_ITEdgeTypeCfg(uint32_t pins,int state);
void GPIOA_ClearITFlagBit(uint32_t pins);
#endif
