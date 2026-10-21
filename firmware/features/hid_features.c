#include "hid_features.h"
#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#include "haptic_tuning.h"
#include <string.h>

/* 84 bytes of static state: one host state per transport and actual visible RGB.
 * No heap. BLE's long-read snapshot belongs to its transport, not this module. */
enum { READY=1, AUTONOMOUS=2, HOST_HAPTICS=4 };
typedef struct {
    uint8_t current[15], staged[15];
    uint8_t requested_lamp, auto_trigger, intensity, flags;
} feature_host;
static struct {
    feature_host hosts[2];
    uint8_t visible[15], motor_source;
} state;
static uint32_t feature_ms,auto_haptic_ms;
static bool auto_haptic_started;
/* Rev.E CPL centers, um; X from left and Y from rear (51.6mm - CPL Y).
 * Five IDs follow D2..D6 / KEY1..KEY5, independent status D7 is excluded. */
static const uint16_t lamp_x[5]={12800,32800,12800,32800,52800};
static const uint16_t lamp_y[5]={21000,21000,41000,41000,41000};

static uint16_t rd16(const uint8_t *p){return (uint16_t)(p[0]|((uint16_t)p[1]<<8));}
static void wr16(uint8_t *p,uint16_t v){p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8);}
static void wr32(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static feature_host *host(uint8_t source){return source>=1&&source<=2?&state.hosts[source-1]:NULL;}
static uint8_t owner(void){
    uint8_t preference=c5_config()[6];
    if(preference==C5_FEATURE_USB)return (state.hosts[0].flags&READY)?C5_FEATURE_USB:0;
    if(preference==C5_FEATURE_BLE)return (state.hosts[1].flags&READY)?C5_FEATURE_BLE:0;
    if(state.hosts[0].flags&READY)return C5_FEATURE_USB;
    return (state.hosts[1].flags&READY)?C5_FEATURE_BLE:0;
}
static void defaults(feature_host *h){
    h->flags=AUTONOMOUS;h->auto_trigger=3;h->intensity=100;h->requested_lamp=0;
    memcpy(h->current,state.visible,15);memcpy(h->staged,state.visible,15);
}
uint8_t c5_features_control_flags(void){
    feature_host *h=host(owner());
#ifdef C5_NO_HAPTICS
    return h?((h->flags&AUTONOMOUS)?0u:16u):0u;
#endif
    return h?((h->flags&HOST_HAPTICS)?8u:0u)|((h->flags&AUTONOMOUS)?0u:16u):0u;
}
static bool play(uint8_t source,uint8_t strength){
    if(!c5_hal_haptic(strength))return false;
    state.motor_source=strength?source:0;return true;
}
void c5_features_init(void){memset(state.visible,0,15);state.motor_source=0;feature_ms=auto_haptic_ms=0;auto_haptic_started=false;defaults(&state.hosts[0]);defaults(&state.hosts[1]);}
void c5_features_link_source(uint8_t source,bool ready){
    feature_host *h=host(source);if(!h)return;
    if(!ready&&(h->flags&READY)){
        defaults(h);
        if(state.motor_source==source)(void)play(0,0);
    }
    if(ready)h->flags|=READY;
}
void c5_features_link(bool ready){c5_features_link_source(C5_FEATURE_USB,ready);}
void c5_features_tick(uint32_t milliseconds){
    feature_ms=milliseconds;/* HAL owns the bounded click timeout. */
    if(state.motor_source&&state.motor_source!=owner())(void)play(0,0);
}
bool c5_features_lights(uint8_t rgb[15],bool awake){
    feature_host *active=host(owner());
    bool controlled=awake&&active&&!(active->flags&AUTONOMOUS);
    if(!awake)memset(rgb,0,15);
    if(controlled)memcpy(rgb,active->current,15);
    memcpy(state.visible,rgb,15);
    for(unsigned i=0;i<2;i++)if(state.hosts[i].flags&AUTONOMOUS){
        memcpy(state.hosts[i].current,state.visible,15);memcpy(state.hosts[i].staged,state.visible,15);
    }
    return controlled;
}
void c5_features_auto_haptic(uint8_t local_strength){
#ifdef C5_MOTOR_SOUND
    if(c5_motor_sound_active())return;
#endif
    uint8_t source=owner();feature_host *h=host(source);
    if(h&&(h->flags&HOST_HAPTICS)){
        if(h->auto_trigger==3&&h->intensity){
            if(auto_haptic_started&&(uint32_t)(feature_ms-auto_haptic_ms)<40u)return;
#ifdef C5_ADVANCED_HAPTICS
            if(c5_hal_haptic_busy())return;
#endif
            if(play(source,h->intensity)){auto_haptic_started=true;auto_haptic_ms=feature_ms;}
        }
    }else {
#ifdef C5_ADVANCED_HAPTICS
        (void)local_strength;c5_haptic_event(C5_HE_TURN);
#else
        if(local_strength)(void)play(0,local_strength);
#endif
    }
}

size_t c5_features_get_source(uint8_t source,uint8_t id,uint8_t *out,size_t cap){
#ifdef C5_NO_HAPTICS
    if(id==C5_HAPTIC_ID)return 0;
#endif
    feature_host *h=host(source);size_t n;if(!h)return 0;
    switch(id){
    case C5_HAPTIC_ID:n=9;break;
    case C5_LAMP_ARRAY_ID:n=22;break;
    case C5_LAMP_REQUEST_ID:n=2;break;
    case C5_LAMP_RESPONSE_ID:n=28;break;
    case C5_LAMP_MULTI_ID:n=50;break;
    case C5_LAMP_RANGE_ID:n=9;break;
    case C5_LAMP_CONTROL_ID:n=1;break;
    default:return 0;
    }
    if(!out||cap<n)return 0;
    memset(out,0,n);
    switch(id){
    case C5_HAPTIC_ID:
        out[0]=h->auto_trigger;wr32(out+1,0x00010037);
        out[5]=(h->flags&HOST_HAPTICS)?h->intensity:c5_config()[10];
        out[6]=3;wr16(out+7,
#ifdef C5_HAPTIC_CALIBRATION
            c5_hal_haptic_pulse_ms()
#else
            C5_HAPTIC_PULSE_MS
#endif
        );break;
    case C5_LAMP_ARRAY_ID:
        wr16(out,5);wr32(out+2,65600);wr32(out+6,51600);wr32(out+10,1600);
        wr32(out+14,1);wr32(out+18,20000);break;
    case C5_LAMP_REQUEST_ID:wr16(out,h->requested_lamp);break;
    case C5_LAMP_RESPONSE_ID:{
        const uint8_t lamp=h->requested_lamp;
        wr16(out,lamp);wr32(out+2,lamp_x[lamp]);wr32(out+6,lamp_y[lamp]);
        wr32(out+10,0);wr32(out+14,20000);wr32(out+18,1);
        out[22]=out[23]=out[24]=out[25]=255;out[26]=1;out[27]=0;
        h->requested_lamp=(uint8_t)((lamp+1)%5);break;
    }
    case C5_LAMP_MULTI_ID:
        out[0]=5;out[1]=1;
        for(uint8_t i=0;i<5;i++){wr16(out+2+2*i,i);memcpy(out+18+4*i,h->current+3*i,3);out[21+4*i]=255;}
        break;
    case C5_LAMP_RANGE_ID:
        /* A valid snapshot of lamp zero, without pretending all lamps match. */
        out[0]=1;memcpy(out+5,h->current,3);out[8]=255;break;
    case C5_LAMP_CONTROL_ID:out[0]=(h->flags&AUTONOMOUS)?1:0;break;
    default:break;
    }
    return n;
}
size_t c5_features_get(uint8_t id,uint8_t *out,size_t cap){return c5_features_get_source(C5_FEATURE_USB,id,out,cap);}
static void stage_color(feature_host *h,uint16_t id,const uint8_t *rgba){
    for(unsigned c=0;c<3;c++)h->staged[id*3+c]=(uint8_t)(((uint16_t)rgba[c]*rgba[3]+127)/255);
}
bool c5_features_set_source(uint8_t source,uint8_t type,uint8_t id,const uint8_t *p,size_t n){
#ifdef C5_NO_HAPTICS
    if(id==C5_HAPTIC_ID)return false;
#endif
    feature_host *h=host(source);if(!h||!(h->flags&READY)||!p)return false;
    if(id==C5_HAPTIC_ID){
        if(type==2){
            if(n!=2||p[0]>3||p[1]>100||source!=owner())return false;
            if(p[0]==0||p[0]==1)return true; /* NULL / None do not interrupt playback. */
            return play(source,p[0]==2?0:p[1]);
        }
        if(type!=3||n!=9||p[0]>3||p[5]>100)return false;
        /* An inactive host can retain auto settings but cannot stop the owner.
         * Identity, waveform, and duration bytes are read-only and ignored. */
        if(source==owner()&&(p[0]==0||p[0]==2||p[5]==0)&&!play(0,0))return false;
        if(p[0]!=1)h->auto_trigger=p[0]; /* None preserves selected waveform. */
        h->intensity=p[5];h->flags|=HOST_HAPTICS;return true;
    }
    if(type!=3)return false;
    switch(id){
    case C5_LAMP_ARRAY_ID:return n==22; /* Constant feature; writes have no effect. */
    case C5_LAMP_RESPONSE_ID:return n==28; /* Attribute data is device-owned. */
    case C5_LAMP_REQUEST_ID:
        if(n!=2)return false;
        h->requested_lamp=rd16(p)<5?(uint8_t)rd16(p):0;return true;
    case C5_LAMP_CONTROL_ID:
        if(n!=1||p[0]>1)return false;
        if(((h->flags&AUTONOMOUS)!=0)!=(p[0]!=0)){
            if(p[0])h->flags|=AUTONOMOUS;
            else{h->flags&=(uint8_t)~AUTONOMOUS;memcpy(h->current,state.visible,15);}
            memcpy(h->staged,h->current,15);
        }
        return true;
    case C5_LAMP_MULTI_ID:{
        if(n!=50||p[0]>8||(p[1]&~1u))return false;
        uint8_t seen=0;
        /* USB HUT 26.11 requires whole-report validation before any mutation. */
        for(uint8_t i=0;i<p[0];i++){
            uint16_t lamp=rd16(p+2+2*i);
            if(lamp>=5||(seen&(1u<<lamp)))return false;
            seen|=(uint8_t)(1u<<lamp);
        }
        if(h->flags&AUTONOMOUS)return true;
        for(uint8_t i=0;i<p[0];i++)stage_color(h,rd16(p+2+2*i),p+18+4*i);
        if(p[1]&1)memcpy(h->current,h->staged,15);
        return true;
    }
    case C5_LAMP_RANGE_ID:{
        if(n!=9||(p[0]&~1u))return false;
        uint16_t first=rd16(p+1),last=rd16(p+3);
        if(first>last||last>=5)return false;
        if(h->flags&AUTONOMOUS)return true;
        for(uint16_t i=first;i<=last;i++)stage_color(h,i,p+5);
        if(p[0]&1)memcpy(h->current,h->staged,15);
        return true;
    }
    default:return false;
    }
}
bool c5_features_set(uint8_t type,uint8_t id,const uint8_t *p,size_t n){return c5_features_set_source(C5_FEATURE_USB,type,id,p,n);}
