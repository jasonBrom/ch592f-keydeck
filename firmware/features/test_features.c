/* Native protocol tests: no board/USB emulation. Build command is in README. */
#include "hid_features.h"
#include "c5.h"
#include "../platform/ch592/hid_reports.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static unsigned haptic_calls;
static uint8_t last_strength;
static bool haptic_ready=true;
static uint8_t test_config[C5_CONFIG_SIZE]={[10]=25};
const uint8_t *c5_config(void){return test_config;}
bool c5_hal_haptic(uint8_t s){if(!haptic_ready)return false;haptic_calls++;last_strength=s;return true;}
static void put16(uint8_t *p,uint16_t v){p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8);}
static uint32_t get32(const uint8_t *p){return p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);}

static void test_lamps(void){
    uint8_t rgb[15],local[15],r[50],p[50]={0},control=0;
    memset(local,17,15);memcpy(rgb,local,15);
    c5_features_init();assert(!c5_features_lights(rgb,true));
    assert(!c5_features_set(3,C5_LAMP_CONTROL_ID,&control,1));
    c5_features_link(true);
    assert(c5_features_get(C5_LAMP_ARRAY_ID,r,50)==22);
    assert(r[0]==5&&get32(r+2)==65600&&get32(r+6)==51600&&get32(r+18)==20000);
    memset(r,0xa5,50);assert(c5_features_get(C5_LAMP_RESPONSE_ID,r,27)==0);assert(r[0]==0xa5);
    assert(c5_features_get(C5_LAMP_RESPONSE_ID,r,50)==28);
    assert(r[0]==0&&get32(r+2)==12800&&get32(r+6)==21000&&r[25]==255&&r[26]==1);
    assert(c5_features_get(C5_LAMP_RESPONSE_ID,r,50)==28&&r[0]==1);
    p[0]=9;p[1]=0;assert(c5_features_set(3,C5_LAMP_REQUEST_ID,p,2));
    assert(c5_features_get(C5_LAMP_RESPONSE_ID,r,50)==28&&r[0]==0);
    assert(c5_features_set(3,C5_LAMP_CONTROL_ID,&control,1));
    memset(rgb,99,15);assert(c5_features_lights(rgb,true));assert(memcmp(rgb,local,15)==0);
    /* First report changes lamp 0, but not visible until the second report completes. */
    memset(p,0,50);p[0]=1;put16(p+2,0);p[18]=255;p[21]=128;
    assert(c5_features_set(3,C5_LAMP_MULTI_ID,p,50));
    assert(c5_features_lights(rgb,true)&&rgb[0]==17);
    p[1]=1;put16(p+2,4);p[18]=0;p[19]=255;p[21]=255;
    assert(c5_features_set(3,C5_LAMP_MULTI_ID,p,50));
    assert(c5_features_lights(rgb,true));assert(rgb[0]==128&&rgb[1]==0&&rgb[12]==0&&rgb[13]==255);
    assert(rgb[3]==17);
    /* Malformed duplicate update must neither partially stage nor commit lamp 0. */
    memset(p,0,50);p[0]=2;p[1]=1;put16(p+2,0);put16(p+4,0);p[20]=255;p[21]=255;
    assert(!c5_features_set(3,C5_LAMP_MULTI_ID,p,50));
    p[0]=0;assert(c5_features_set(3,C5_LAMP_MULTI_ID,p,50));
    assert(c5_features_lights(rgb,true)&&rgb[0]==128&&rgb[2]==0);
    p[0]=1;put16(p+2,5);assert(!c5_features_set(3,C5_LAMP_MULTI_ID,p,50));
    assert(!c5_features_set(3,C5_LAMP_MULTI_ID,p,49));
    assert(!c5_features_set(2,C5_LAMP_MULTI_ID,p,50));
    /* Range changes all five atomically, inclusive endpoints, intensity scaling. */
    memset(p,0,50);p[0]=1;put16(p+1,0);put16(p+3,4);p[5]=10;p[6]=20;p[7]=30;p[8]=255;
    assert(c5_features_set(3,C5_LAMP_RANGE_ID,p,9));
    assert(c5_features_lights(rgb,true));for(unsigned i=0;i<5;i++)assert(rgb[3*i]==10&&rgb[3*i+2]==30);
    put16(p+1,4);put16(p+3,3);assert(!c5_features_set(3,C5_LAMP_RANGE_ID,p,9));
    /* Redundant control disable cannot reset host colors. Disconnect yields to local. */
    assert(c5_features_set(3,C5_LAMP_CONTROL_ID,&control,1));
    assert(c5_features_lights(rgb,true)&&rgb[0]==10);
    c5_features_link(false);memcpy(rgb,local,15);assert(!c5_features_lights(rgb,true));
    c5_features_link(true);assert(c5_features_get(C5_LAMP_CONTROL_ID,r,50)==1&&r[0]==1);
    assert(c5_features_get(0x7f,r,50)==0);
}
static uint32_t auto_test_ms;
static void timed_auto_haptic(uint8_t strength){c5_features_tick(auto_test_ms+=50);c5_features_auto_haptic(strength);}
static void test_haptics(void){
    uint8_t f[9],o[2]={3,70};unsigned before;
    c5_features_init();c5_features_link(true);haptic_calls=0;
    assert(c5_features_control_flags()==0);
    assert(c5_features_get(C5_HAPTIC_ID,f,sizeof(f))==9);
    assert(f[0]==3&&get32(f+1)==0x10037&&f[5]==25&&f[6]==3&&f[7]==24&&f[8]==0);
    timed_auto_haptic(25);assert(last_strength==25);
    assert(c5_features_set(2,C5_HAPTIC_ID,o,2)&&last_strength==70);
    o[0]=1;before=haptic_calls;assert(c5_features_set(2,C5_HAPTIC_ID,o,2));assert(haptic_calls==before);
    o[0]=2;assert(c5_features_set(2,C5_HAPTIC_ID,o,2)&&last_strength==0);
    f[0]=0;assert(c5_features_set(3,C5_HAPTIC_ID,f,9));
    assert(c5_features_control_flags()&8);
    before=haptic_calls;timed_auto_haptic(25);assert(haptic_calls==before);
    f[0]=3;f[5]=60;assert(c5_features_set(3,C5_HAPTIC_ID,f,9));
    timed_auto_haptic(0);assert(last_strength==60);
    f[5]=0;assert(c5_features_set(3,C5_HAPTIC_ID,f,9));before=haptic_calls;
    timed_auto_haptic(100);assert(haptic_calls==before);
    o[0]=3;o[1]=101;assert(!c5_features_set(2,C5_HAPTIC_ID,o,2));
    o[1]=60;haptic_ready=false;assert(!c5_features_set(2,C5_HAPTIC_ID,o,2));haptic_ready=true;
    assert(!c5_features_set(3,C5_HAPTIC_ID,o,2));
    c5_features_link(false);before=haptic_calls;timed_auto_haptic(40);assert(haptic_calls==before+1&&last_strength==40);
    c5_features_init();c5_features_link(true);assert(c5_features_get(C5_HAPTIC_ID,f,sizeof(f))==9);
    f[0]=3;f[5]=80;assert(c5_features_set(3,C5_HAPTIC_ID,f,9));
    c5_features_tick(1000);before=haptic_calls;c5_features_auto_haptic(45);assert(haptic_calls==before+1);
    c5_features_tick(1010);c5_features_auto_haptic(45);assert(haptic_calls==before+1);
    c5_features_tick(1039);c5_features_auto_haptic(45);assert(haptic_calls==before+1);
    c5_features_tick(1040);c5_features_auto_haptic(45);assert(haptic_calls==before+2);
}

static void test_dual_transport(void){
    uint8_t rgb[15],r[50],f[9],off=0,range[9]={1,0,0,4,0,10,20,30,255};
    uint8_t output[2]={3,70};unsigned before;
    c5_features_init();test_config[6]=0;memset(rgb,17,15);
    assert(!c5_features_lights(rgb,true));
    c5_features_link_source(C5_FEATURE_BLE,true);
    assert(c5_features_set_source(2,3,C5_LAMP_CONTROL_ID,&off,1));
    assert(c5_features_lights(rgb,true)&&rgb[0]==17);
    assert(c5_features_set_source(2,3,C5_LAMP_RANGE_ID,range,9));
    assert(c5_features_lights(rgb,true)&&rgb[0]==10&&rgb[2]==30);
    /* USB absent polling must not reset the connected BLE host's state. */
    c5_features_link(false);assert(c5_features_lights(rgb,true)&&rgb[0]==10);
    assert(c5_features_set_source(2,2,C5_HAPTIC_ID,output,2));
    before=haptic_calls;c5_features_link(false);assert(haptic_calls==before);
    /* Auto preference gives newly connected USB ownership and stops BLE click. */
    c5_features_link(true);c5_features_tick(1);assert(last_strength==0);
    memset(rgb,45,15);assert(!c5_features_lights(rgb,true)&&rgb[0]==45);
    assert(c5_features_set(3,C5_LAMP_CONTROL_ID,&off,1));
    range[5]=90;assert(c5_features_set(3,C5_LAMP_RANGE_ID,range,9));
    assert(c5_features_lights(rgb,true)&&rgb[0]==90);
    /* Inactive BLE state is independently writable, cannot stop/click USB. */
    range[5]=25;assert(c5_features_set_source(2,3,C5_LAMP_RANGE_ID,range,9));
    assert(c5_features_lights(rgb,true)&&rgb[0]==90);
    before=haptic_calls;assert(!c5_features_set_source(2,2,C5_HAPTIC_ID,output,2));
    assert(haptic_calls==before);
    assert(c5_features_get_source(2,C5_HAPTIC_ID,f,9)==9);f[0]=0;
    assert(c5_features_set_source(2,3,C5_HAPTIC_ID,f,9));assert(haptic_calls==before);
    assert(c5_features_get(C5_HAPTIC_ID,f,9)==9&&f[0]==3);
    /* Attribute cursors are per transport; GET too short cannot advance. */
    assert(c5_features_get_source(2,C5_LAMP_RESPONSE_ID,r,50)==28&&r[0]==0);
    assert(!c5_features_get_source(2,C5_LAMP_RESPONSE_ID,r,22));
    assert(c5_features_get(C5_LAMP_RESPONSE_ID,r,50)==28&&r[0]==0);
    assert(c5_features_get_source(2,C5_LAMP_RESPONSE_ID,r,50)==28&&r[0]==1);
    /* USB removal reveals BLE's retained colors and retained disabled auto. */
    c5_features_link(false);assert(c5_features_lights(rgb,true)&&rgb[0]==25);
    before=haptic_calls;timed_auto_haptic(25);assert(haptic_calls==before);
    /* Forced USB has no fallback even though BLE is ready. */
    test_config[6]=1;memset(rgb,63,15);assert(!c5_features_lights(rgb,true)&&rgb[0]==63);
    assert(!c5_features_set_source(2,2,C5_HAPTIC_ID,output,2));
    /* Forced BLE owns hardware while USB is connected and retains USB state. */
    c5_features_link(true);test_config[6]=2;
    assert(c5_features_lights(rgb,true)&&rgb[0]==25);
    assert(c5_features_set_source(2,2,C5_HAPTIC_ID,output,2)&&last_strength==70);
    before=haptic_calls;c5_features_link(false);assert(haptic_calls==before);
    c5_features_link_source(2,false);assert(last_strength==0);
    c5_features_link_source(2,true);
    assert(c5_features_get_source(2,C5_LAMP_CONTROL_ID,r,50)==1&&r[0]==1);
    assert(c5_features_get_source(2,C5_HAPTIC_ID,f,9)==9&&f[0]==3);
    assert(!c5_features_get_source(0,C5_LAMP_ARRAY_ID,r,50));
    assert(!c5_features_set_source(3,3,C5_LAMP_CONTROL_ID,&off,1));
    c5_features_link_source(3,true);test_config[6]=0;
}

/* Parse HID Global PUSH/POP and report sizes, without assuming array byte offsets.
 * This catches accidental descriptor/implementation length drift. */
static void test_descriptors(void){
    static const uint8_t map[]={C5_FULL_HID_REPORT_MAP_BYTES};
    assert(sizeof(map)<=512); /* The same map is a single BLE ATT attribute. */
    struct state{unsigned size,count,id;} s={0},stack[4];
    unsigned depth=0,collections=0,bits[3][256]={{0}};
    for(size_t i=0;i<sizeof(map);){
        uint8_t prefix=map[i++];unsigned n=prefix&3;if(n==3)n=4;
        assert(prefix!=0xfe&&i+n<=sizeof(map));
        unsigned value=0;for(unsigned j=0;j<n;j++)value|=(unsigned)map[i++]<<(8*j);
        unsigned type=(prefix>>2)&3,tag=prefix>>4;
        if(type==1){
            if(tag==7)s.size=value;else if(tag==8)s.id=value;else if(tag==9)s.count=value;
            else if(tag==10){assert(depth<4);stack[depth++]=s;}
            else if(tag==11){assert(depth);s=stack[--depth];}
        }else if(type==0){
            if(tag==10)collections++;else if(tag==12){assert(collections);collections--;}
            else if(tag==8||tag==9||tag==11){assert(s.id<256);bits[tag==8?0:tag==9?1:2][s.id]+=s.size*s.count;}
        }
    }
    assert(!depth&&!collections);
    assert(bits[0][1]==64&&bits[0][2]==16&&bits[0][3]==24&&bits[0][4]==32);
    assert(bits[1][1]==8);
    assert(bits[1][5]==16&&bits[2][5]==72);
    const unsigned expected[6]={22,2,28,50,9,1};
    for(unsigned i=0;i<6;i++){assert(bits[2][0x10+i]==expected[i]*8);assert(!bits[0][0x10+i]&&!bits[1][0x10+i]);}
}
int main(void){test_lamps();test_haptics();test_dual_transport();test_descriptors();puts("HID features: geometry, USB/BLE ownership, atomic batches, malformed reports, haptics, descriptors PASS");return 0;}
