/* Host register-model test only. All register addresses/masks come from the
 * real WCH SDK; mmap supplies harmless RAM at those addresses on Linux. */
#ifndef TEST_CH59X_COMMON
#define TEST_CH59X_COMMON
#include <stdint.h>
#include <string.h>
#include "CH592SFR.h"
#define __INTERRUPT
#define __HIGH_CODE
static inline void PFIC_EnableIRQ(IRQn_Type irq){(void)irq;}
static inline void PFIC_DisableIRQ(IRQn_Type irq){(void)irq;}
static inline void GetMACAddress(uint8_t *out){memset(out,0x42,6);}
#endif
