#include "c5.h"
#include "haptic.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t config[C5_CONFIG_SIZE],last_id,last_gain,last_pulse;
static unsigned plays,pulses;
static bool playing;
const uint8_t *c5_config(void){return config;}
bool c5_hal_haptic(uint8_t strength){playing=strength!=0;if(strength){last_pulse=strength;pulses++;}return true;}
bool c5_hal_haptic_busy(void){return playing;}
bool c5_hal_haptic_sequence(const uint8_t *p,uint8_t n,int8_t s,uint16_t t){(void)n;(void)s;(void)t;last_id=p[0];plays++;playing=true;return true;}
bool c5_hal_haptic_envelope(const uint8_t *p,uint8_t n,uint8_t g,uint16_t t){(void)p;(void)n;(void)t;last_gain=g;plays++;playing=true;return true;}
static void block(uint8_t *h){
    memset(h,0,81);memcpy(h,"HP1",3);h[3]=1;h[5]=1;h[6]=2;h[7]=26;
    h[15]=65;h[16]=6;h[18]=0;h[19]=10;h[63]=6;h[65]=125;h[69]=40;h[72]=50;
}
int main(void){
    c5_default_config(config);config[10]=45;uint8_t *h=config+943;block(h);assert(c5_validate_config(config));
    h[7]=124;assert(!c5_validate_config(config));h[7]=26;
    h[19]=0;assert(!c5_validate_config(config));h[19]=10;
    h[68]=127;assert(!c5_validate_config(config));h[68]=0;
    h[3]=0;c5_haptic_reset();
    for(uint8_t event=C5_HE_KEY;event<=C5_HE_TURN;event++){playing=false;c5_haptic_event(event);}
    assert(pulses==3&&last_pulse==45&&plays==0);
    c5_haptic_event(C5_HE_PROFILE);c5_haptic_event(C5_HE_MACRO_START);c5_haptic_event(C5_HE_MACRO_END);
    assert(pulses==3&&plays==0);
    config[10]=0;c5_haptic_event(C5_HE_KEY);assert(pulses==3);config[10]=45;
    h[3]=1;c5_haptic_event(C5_HE_PRESS);assert(pulses==3&&plays==0); /* explicit event off stays off */
    c5_haptic_reset();c5_haptic_tick(100);c5_haptic_event(C5_HE_TURN);assert(plays==1&&last_gain==45);
    playing=false;c5_haptic_tick(120);c5_haptic_event(C5_HE_TURN);assert(plays==1);
    c5_haptic_tick(140);c5_haptic_event(C5_HE_TURN);assert(plays==2);
    c5_haptic_event(C5_HE_KEY);assert(plays==3&&last_id==6);
    uint8_t begin[]={0},commit[]={2,75},stop[]={3};
    assert(c5_haptic_command(2,1,begin,1,0)==C5_ERR_BUSY);
    assert(c5_haptic_command(1,1,begin,1,0)==C5_OK);
    assert(c5_haptic_command(2,0,stop,1,0)==C5_ERR_BUSY);
    assert(c5_haptic_command(1,1,commit,2,0)==C5_ERR_BUSY);
    for(unsigned offset=0;offset<81;offset+=11){uint8_t p[12]={1};unsigned n=81-offset;if(n>11)n=11;memcpy(p+1,h+offset,n);assert(c5_haptic_command(1,1,p,(uint8_t)(n+1),(uint16_t)offset)==C5_OK);}
    assert(c5_haptic_command(1,1,commit,2,0)==C5_OK);assert(last_id==26);
    c5_haptic_event(C5_HE_KEY);assert(plays==4); /* local inputs don't interrupt preview */
    c5_haptic_lost(2);assert(playing);c5_haptic_lost(1);assert(!playing);
    assert(c5_haptic_command(1,1,begin,1,0)==C5_OK);c5_haptic_tick(30200);
    assert(c5_haptic_command(1,1,commit,2,0)==C5_ERR_BUSY);
    c5_haptic_reset();memset(h,0,81);pulses=0;config[10]=45;
    c5_haptic_tick(1000);c5_haptic_event(C5_HE_TURN);assert(pulses==1);
    c5_haptic_tick(1010);c5_haptic_event(C5_HE_TURN);assert(pulses==1);
    c5_haptic_tick(1040);c5_haptic_event(C5_HE_TURN);assert(pulses==1); /* Still playing: never extend. */
    playing=false;c5_haptic_event(C5_HE_TURN);assert(pulses==2);
    c5_haptic_reset();block(h);h[65]=126;assert(c5_validate_config(config));
    c5_haptic_tick(2000);c5_haptic_event(C5_HE_TURN);assert(pulses==3&&last_pulse==45);
    h[63]=126;assert(c5_validate_config(config)); /* 1.13: standard pulse on any event. */
    h[63]=127;assert(!c5_validate_config(config));
    puts("haptic core: legacy/advanced rotation coalescing, independent TURN pulse, mute, validation and preview ownership/completeness/timeout passed");
}
