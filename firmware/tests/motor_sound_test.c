#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static bool busy,io=true;
static unsigned plays,stops;
static uint8_t period,gain;
static uint16_t duration;
bool c5_hal_haptic(uint8_t strength){if(!io)return false;if(!strength){busy=false;stops++;}return true;}
bool c5_hal_haptic_busy(void){return busy;}
void c5_haptic_reset(void){(void)c5_hal_haptic(0);}
bool c5_hal_motor_sound(uint8_t p,uint8_t g,uint16_t ms){if(!io)return false;period=p;gain=g;duration=ms;busy=g!=0;plays++;return true;}
int main(void){
    uint8_t note[5]={1,60,10,150,0},stop[1]={0};c5_motor_sound_init();
    assert(c5_motor_sound_command(2,2,note,5,0)==C5_OK);
    assert(c5_motor_sound_active()&&busy&&period==60&&gain==10&&duration==150);
    unsigned before=plays;
    assert(c5_motor_sound_command(1,2,stop,1,0)==C5_ERR_BUSY&&busy);
    assert(c5_motor_sound_command(2,1,note,5,0)==C5_ERR_BUSY&&plays==before);
    assert(c5_motor_sound_command(0,0,note,5,0)==C5_ERR_BUSY);
    assert(c5_motor_sound_command(2,2,note,5,1)==C5_ERR_FRAME);
    assert(c5_motor_sound_command(2,2,note,4,0)==C5_ERR_FRAME);
    note[2]=21;assert(c5_motor_sound_command(2,2,note,5,0)==C5_ERR_RANGE&&plays==before);note[2]=10;
    note[1]=19;assert(c5_motor_sound_command(2,2,note,5,0)==C5_ERR_RANGE);note[1]=60;
    note[3]=251;assert(c5_motor_sound_command(2,2,note,5,0)==C5_ERR_RANGE);note[3]=150;
    c5_motor_sound_lost(1);assert(busy);c5_motor_sound_lost(2);assert(!busy&&!c5_motor_sound_active());
    assert(c5_motor_sound_command(1,1,note,5,0)==C5_OK);busy=false;c5_motor_sound_tick();assert(!c5_motor_sound_active());
    assert(c5_motor_sound_command(2,2,note,5,0)==C5_OK);c5_motor_sound_reset();assert(!busy);
    assert(c5_motor_sound_command(2,2,note,5,0)==C5_OK);c5_motor_sound_init();assert(!busy);
    assert(c5_motor_sound_command(2,2,stop,1,0)==C5_OK&&!busy);
    io=false;assert(c5_motor_sound_command(2,2,note,5,0)==C5_ERR_IO&&!c5_motor_sound_active());
    assert(c5_motor_sound_command(2,2,stop,1,0)==C5_ERR_IO);
    assert(stops>0);puts("motor sound protocol: ownership, malformed/bounded input, disconnect, watchdog completion, reset and I/O failure passed");
}
