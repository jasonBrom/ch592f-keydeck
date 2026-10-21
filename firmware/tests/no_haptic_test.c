#include "c5.h"
#include "haptic.h"
#include "haptic_tuning.h"
#include "board.h"
#include "hid_features.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint8_t stored[1024];
static unsigned reports;
bool c5_hal_load(uint8_t out[1024]) { memcpy(out,stored,1024);return true; }
bool c5_hal_save(const uint8_t in[1024]) { memcpy(stored,in,1024);return true; }
bool c5_hal_report(uint8_t t,uint8_t id,const uint8_t *p,uint8_t n)
{ (void)t;(void)id;(void)p;(void)n;++reports;return true; }
void c5_hal_lights(const uint8_t a[15],const uint8_t b[3]) { (void)a;(void)b; }
void c5_hal_status(uint8_t *f,uint8_t *p,uint16_t *v) { (void)f;*p=50;*v=3800; }

static uint8_t command(uint8_t op,const uint8_t *data,uint8_t n,uint16_t offset,uint8_t out[20])
{
    uint8_t in[20]={0xc5,1,op,1,n,0,(uint8_t)offset,(uint8_t)(offset>>8)};
    if(n)memcpy(in+8,data,n);
    c5_config_frame_transport(1,in,out);return out[5];
}
int main(void)
{
    uint8_t out[20],before[1024],feature[64];
    c5_default_config(stored);
    /* A valid haptic calibration block must survive a motorless read/save. */
    uint8_t *h=stored+943;
    memcpy(h,"HP1",3);h[3]=1;h[5]=1;h[6]=1;h[7]=1;
    h[15]=40;h[16]=24;h[63]=126;h[65]=126;
    h[69]=40;h[72]=100;c5_tuning_defaults(stored+1016);
    assert(c5_validate_config(stored));memcpy(before,stored,1024);
    board_haptic_init();board_haptic_tick(1000);
    assert(!board_haptic_ready()&&board_haptic_fault()==0);
    assert(c5_hal_haptic(0)&&!c5_hal_haptic(50)&&!c5_hal_haptic_busy());
    c5_init();c5_link(true,false);c5_tick(1);
    assert(command(1,NULL,0,0,out)==C5_OK&&out[13]==15);
    uint32_t caps=(uint32_t)out[16]|((uint32_t)out[17]<<8)|((uint32_t)out[18]<<16)|((uint32_t)out[19]<<24);
    assert(caps&0x800000u);assert(caps&0x200000u);assert(caps&0x400000u);
    assert(!(caps&(0x20u|0x80u|0x1000u|0x8000u|0x80000u)));
    const uint8_t strength=50;
    assert(command(10,&strength,1,0,out)==C5_ERR_UNSUPPORTED);
    assert(command(14,NULL,0,0,out)==C5_ERR_UNSUPPORTED);
    assert(command(17,NULL,0,0,out)==C5_ERR_UNSUPPORTED);
    assert(c5_features_get(5,feature,sizeof(feature))==0);
    const uint8_t output[2]={3,50};assert(!c5_features_set(2,5,output,2));
    assert(c5_features_get(16,feature,sizeof(feature))==22); /* LampArray retained. */
    assert(!memcmp(c5_config(),before,1024));
    assert(command(6,NULL,0,0,out)==C5_OK&&!memcmp(stored,before,1024));
    unsigned previous=reports;c5_input_key(0,true);c5_tick(50);c5_input_key(0,false);c5_tick(100);
    assert(reports>previous);assert(!memcmp(c5_config(),before,1024));
    puts("no-haptic: real null driver, capability mask, disabled commands, LampArray, input and calibrated config preservation passed");
}
