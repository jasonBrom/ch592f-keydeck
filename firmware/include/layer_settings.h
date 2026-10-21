#ifndef C5_LAYER_SETTINGS_H
#define C5_LAYER_SETTINGS_H
#include <stdint.h>
#define C5_LAYER_CAPABILITY 0x200000u
/* Sixteen previously reserved macro bytes: two bytes per100-byte slot. */
static inline uint8_t c5_layer_byte(const uint8_t *config,unsigned i)
{ return config[130u+100u*(i/2u)+(i&1u)]; }
static inline uint8_t c5_layer_flags(const uint8_t *config)
{ return c5_layer_byte(config,0)==0xd3?c5_layer_byte(config,1):0; }
#endif
