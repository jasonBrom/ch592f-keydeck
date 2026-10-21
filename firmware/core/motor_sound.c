#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#ifdef C5_MOTOR_SOUND
/* One bounded tone at a time, no PCM buffer and no Flash writes. A host must
 * refresh it; the board independently stops at its <=250ms deadline. */
static uint8_t owner;
void c5_motor_sound_init(void){c5_motor_sound_reset();}
bool c5_motor_sound_active(void){return owner!=0;}
void c5_motor_sound_reset(void){if(owner)(void)c5_hal_haptic(0);owner=0;}
void c5_motor_sound_lost(uint8_t source){if(!source||source==owner)c5_motor_sound_reset();}
void c5_motor_sound_tick(void){if(owner&&!c5_hal_haptic_busy())owner=0;}
uint8_t c5_motor_sound_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n,uint16_t offset){
    if(!n||offset||p[0]>1)return C5_ERR_FRAME;
    if(source<1||source>2||source!=active||(owner&&owner!=source))return C5_ERR_BUSY;
    if(p[0]==0){if(n!=1)return C5_ERR_FRAME;c5_motor_sound_reset();return c5_hal_haptic(0)?C5_OK:C5_ERR_IO;}
    if(n!=5)return C5_ERR_FRAME;
    uint16_t duration=(uint16_t)(p[3]|((uint16_t)p[4]<<8));
    if(p[1]<20||p[1]>127||p[2]>C5_MOTOR_SOUND_MAX_GAIN||!duration||duration>C5_MOTOR_SOUND_MAX_MS)return C5_ERR_RANGE;
    if(!owner)c5_haptic_reset();
    if(!c5_hal_motor_sound(p[1],p[2],duration)){owner=0;return C5_ERR_IO;}
    owner=p[2]?source:0;return C5_OK;
}
#endif
