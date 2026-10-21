#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#include "haptic_tuning.h"
#ifdef C5_ADVANCED_HAPTICS
#include <string.h>
static uint8_t preview[C5_HAPTIC_SIZE],owner,received;
static bool uploading,preview_playing,turned;
static uint32_t clock_ms,upload_ms,turn_ms;
static uint16_t le16(const uint8_t *p){return (uint16_t)(p[0]|((uint16_t)p[1]<<8));}
#ifdef C5_HAPTIC_CALIBRATION
static uint8_t calibration_owner;
uint8_t c5_haptic_calibration_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n) {
    if(!n||p[0]>3||n!=(p[0]==0?9:1))return C5_ERR_FRAME;
    if(!c5_hal_haptic_calibrating())calibration_owner=0;
    if((active&&source!=active)||(calibration_owner&&source!=calibration_owner))return C5_ERR_BUSY;
    if(p[0]==0&&(!c5_tuning_valid(p+1)||c5_tuning_empty(p+1)))return C5_ERR_RANGE;
    if((p[0]==0||p[0]==1)&&c5_hal_haptic_calibrating())return C5_ERR_BUSY;
    if(p[0]<=1)c5_haptic_reset();
    uint8_t result=c5_hal_haptic_calibration(p[0],p[0]==0?p+1:NULL);
    if(result==C5_OK)calibration_owner=p[0]<=1?source:0;
    return result;
}
#endif
static bool play(const uint8_t *h,uint8_t id,uint8_t gain){
    if(!gain||!id)return true;
    if(id==126)return c5_hal_haptic(gain);
    uint16_t limit=(uint16_t)h[72]*100u;
    if(id==125)return c5_hal_haptic_envelope(h+15,h[6],gain,limit);
    if(id==124)return c5_hal_haptic_sequence(h+7,h[5],(int8_t)h[71],limit);
    return c5_hal_haptic_sequence(&id,1,(int8_t)h[71],limit);
}
void c5_haptic_reset(void){
#ifdef C5_HAPTIC_CALIBRATION
    if(calibration_owner)(void)c5_hal_haptic_calibration(2,NULL);
    calibration_owner=0;
#endif
    uploading=preview_playing=turned=false;owner=received=0;
    (void)c5_hal_haptic(0);
}
void c5_haptic_lost(uint8_t source){
#ifdef C5_HAPTIC_CALIBRATION
    if(calibration_owner&&(!source||source==calibration_owner)) {
        (void)c5_hal_haptic_calibration(2,NULL);calibration_owner=0;
    }
#endif
    if(!source||source==owner){
        if(preview_playing)(void)c5_hal_haptic(0);
        uploading=preview_playing=false;owner=received=0;
    }
}
void c5_haptic_tick(uint32_t ms){
#ifdef C5_HAPTIC_CALIBRATION
    if(!c5_hal_haptic_calibrating())calibration_owner=0;
#endif
    clock_ms=ms;
    if(uploading&&(uint32_t)(ms-upload_ms)>=30000u){uploading=false;received=0;owner=0;}
    if(preview_playing&&!c5_hal_haptic_busy()){preview_playing=false;owner=0;received=0;}
}
void c5_haptic_event(uint8_t event){
#ifdef C5_MOTOR_SOUND
    if(c5_motor_sound_active())return;
#endif
    const uint8_t *c=c5_config(),*h=c+C5_HAPTIC_OFFSET;
    if(event>5||preview_playing)return;
    /* Rotation must finish/brake a click before accepting another. Applying
     * this to legacy mode too prevents fast turns extending one endless buzz. */
    if(event==C5_HE_TURN){
        uint16_t interval=h[0]&&h[3]?le16(h+69):40u;
        if((turned&&(uint32_t)(clock_ms-turn_ms)<interval)||c5_hal_haptic_busy())return;
        turn_ms=clock_ms;turned=true;
    }
    /* Disabling the advanced editor restores the existing pulse feedback.
     * Byte 10 is the global mute; an inactive HP1 draft must not mute it. */
    if(h[0]==0||!h[3]){
        if(event<=C5_HE_TURN&&c[10])(void)c5_hal_haptic(c[10]);
        return;
    }
    if(!c[10])return;
    (void)play(h,h[63+event],c[10]);
}
uint8_t c5_haptic_command(uint8_t source,uint8_t active,const uint8_t *p,uint8_t n,uint16_t offset){
    if(!n||p[0]>3)return C5_ERR_FRAME;
    /* A non-owner host cannot interrupt the input host or another preview. */
    if((active&&source!=active)||(owner&&source!=owner))return C5_ERR_BUSY;
    switch(p[0]){
    case 0:
        if(n!=1||offset)return C5_ERR_FRAME;
        if(preview_playing&&!c5_hal_haptic(0))return C5_ERR_IO;
        preview_playing=false;owner=source;received=0;uploading=true;upload_ms=clock_ms;
        memset(preview,0,sizeof preview);return C5_OK;
    case 1:
        if(!uploading||source!=owner)return C5_ERR_BUSY;
        if(n<2||offset!=received||(uint32_t)offset+n-1u>C5_HAPTIC_SIZE)return C5_ERR_RANGE;
        memcpy(preview+offset,p+1,n-1);received+=(uint8_t)(n-1);upload_ms=clock_ms;return C5_OK;
    case 2:
        if(n!=2||offset||p[1]>100)return C5_ERR_RANGE;
        if(!uploading||source!=owner||received!=C5_HAPTIC_SIZE)return C5_ERR_BUSY;
        if(preview[0]==0||!c5_validate_haptic(preview))return C5_ERR_CONFIG;
        uploading=false;
        if(!p[1]){owner=received=0;return c5_hal_haptic(0)?C5_OK:C5_ERR_IO;}
        if(!play(preview,preview[4]?125:124,p[1])){owner=received=0;return C5_ERR_IO;}
        preview_playing=true;return C5_OK;
    case 3:
        if(n!=1||offset)return C5_ERR_FRAME;
        uploading=preview_playing=false;owner=received=0;
        return c5_hal_haptic(0)?C5_OK:C5_ERR_IO;
    default:return C5_ERR_FRAME;
    }
}
#endif
