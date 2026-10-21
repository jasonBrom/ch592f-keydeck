#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#include "haptic_tuning.h"
#include "layer_settings.h"
#include "relative_report.h"
#ifdef C5_SMOOTH_RADIAL
#include "radial_motion.h"
static c5_radial_motion radial_motion;
#endif
#include <string.h>
#ifdef C5_WINDOWS_FEATURES
#include "hid_features.h"
#endif
#define TX_CAP 16u
typedef struct { uint8_t route,id,len,data[8]; } tx_item;
typedef struct { uint8_t usage,mods,used; } macro_hold;
static uint8_t cfg[C5_CONFIG_SIZE],stage[C5_CONFIG_SIZE];
static bool staging;static uint8_t stage_owner;static uint16_t stage_next;static uint32_t stage_crc,stage_last;
static bool links[3];static uint8_t route,reset_mask[3],physical,suppressed;
static uint8_t held[6][4],last_keyboard[8],last_consumer[2],last_radial,last_mouse;
static tx_item tx[TX_CAP];static unsigned tx_head,tx_count;
static uint32_t now,last_activity,last_light_tick;
static int32_t encoder_pending;static uint16_t encoder_total;
static bool macro_active;static uint8_t macro_slot,macro_step,macro_mode,macro_trigger_key,macro_mouse;static uint32_t macro_due;
static macro_hold mh[16];
static uint8_t last_lights[18];
static uint8_t pair_indicator;
#ifdef C5_REPORT_RATES
static bool rate_saved;static uint8_t rate_owner;static uint16_t rate_read_next;static uint32_t rate_saved_crc;
#endif
static uint16_t u16(const uint8_t *p){return (uint16_t)(p[0]|((uint16_t)p[1]<<8));}
static uint32_t u32(const uint8_t *p){return (uint32_t)u16(p)|((uint32_t)u16(p+2)<<16);}
static void p16(uint8_t *p,uint16_t n){p[0]=(uint8_t)n;p[1]=(uint8_t)(n>>8);}
static void p32(uint8_t *p,uint32_t n){p16(p,(uint16_t)n);p16(p+2,(uint16_t)(n>>16));}
const uint8_t *c5_config(void){return cfg;}
static void rate_invalidate(void){
#ifdef C5_REPORT_RATES
    rate_saved=false;rate_read_next=0;
#endif
}
static uint8_t choose_route(void){if(cfg[6]==1)return links[1]?1:0;if(cfg[6]==2)return links[2]?2:0;return links[1]?1:(links[2]?2:0);}
static bool enqueue(uint8_t id,const uint8_t *p,uint8_t len){
    if(!route)return true;
    if(tx_count){
        tx_item *last=&tx[(tx_head+tx_count-1u)%TX_CAP];
        if(last->route==route&&last->id==id&&last->len==len&&c5_relative_merge(id,last->data,p,len))return true;
    }
    if(tx_count==TX_CAP)return false;
    tx_item *t=&tx[(tx_head+tx_count)%TX_CAP];t->route=route;t->id=id;t->len=len;
    memcpy(t->data,p,len);tx_count++;return true;
}
static void flush(void){
    const uint8_t zero[8]={0};const uint8_t lengths[4]={8,2,3,4};
    for(uint8_t r=1;r<=2;r++) {
        if(!links[r])continue;
        for(uint8_t id=1;id<=4;id++)if(reset_mask[r]&(1u<<(id-1))) {
            if(!c5_hal_report(r,id,zero,lengths[id-1]))break;
            reset_mask[r]&=(uint8_t)~(1u<<(id-1));
        }
    }
    while(tx_count) {
        tx_item *t=&tx[tx_head];
        if(links[t->route]&&(reset_mask[t->route]||!c5_hal_report(t->route,t->id,t->data,t->len)))return;
        tx_head=(tx_head+1)%TX_CAP;tx_count--;
    }
}
static void add_key(uint8_t report[8],uint8_t usage,uint8_t mods,unsigned *count){
    report[0]|=mods;if(usage>=0xe0&&usage<=0xe7){report[0]|=(uint8_t)(1u<<(usage-0xe0));return;}
    if(!usage)return;
    for(unsigned i=2;i<8;i++)if(report[i]==usage)return;
    if(*count<6)report[2+*count]=usage;
    (*count)++;
}
static void keyboard(uint8_t report[8],const uint8_t *extra){
    unsigned count=0;memset(report,0,8);
    for(unsigned k=0;k<6;k++)if((physical&~suppressed&(1u<<k))&&held[k][0]==1)add_key(report,(uint8_t)u16(held[k]+2),held[k][1],&count);
    for(unsigned i=0;i<16;i++)if(mh[i].used)add_key(report,mh[i].usage,mh[i].mods,&count);
    if(extra)add_key(report,(uint8_t)u16(extra+2),extra[1],&count);
    if(count>6)memset(report+2,1,6); /* HID ErrorRollOver, never silently omit held keys. */
}
static uint16_t consumer(void){
    for(unsigned k=0;k<6;k++)if((physical&~suppressed&(1u<<k))&&held[k][0]==2)return u16(held[k]+2);
    return 0;
}
static uint8_t radial_button(void){return cfg[7]==0&&held[5][0]!=C5_ACTION_FN&&(physical&~suppressed&32u)?1:0;}
static bool fn_held(void){return (c5_layer_flags(cfg)&2u)&&(physical&~suppressed&(1u<<c5_layer_byte(cfg,11)));}
static uint8_t mouse_buttons(void){
    uint8_t buttons=macro_mouse;
    for(unsigned k=0;k<6;k++)if((physical&~suppressed&(1u<<k))&&held[k][0]==C5_ACTION_MOUSE_BUTTONS)buttons|=(uint8_t)u16(held[k]+2);
    return buttons;
}
static bool sync_holds(void){
    uint8_t b[8];keyboard(b,NULL);
    if(memcmp(b,last_keyboard,8)){if(!enqueue(1,b,8))return false;memcpy(last_keyboard,b,8);}
    p16(b,consumer());
    if(memcmp(b,last_consumer,2)){if(!enqueue(2,b,2))return false;memcpy(last_consumer,b,2);}
    b[0]=radial_button();b[1]=b[2]=0;
    if(b[0]!=last_radial){if(!enqueue(3,b,3))return false;last_radial=b[0];}
    b[0]=mouse_buttons();b[1]=b[2]=b[3]=0;
    if(b[0]!=last_mouse){if(!enqueue(4,b,4))return false;last_mouse=b[0];}
    return true;
}
static void macro_clear_holds(void){memset(mh,0,sizeof mh);macro_mouse=0;}
static void macro_cancel(void){macro_active=false;macro_trigger_key=0xff;macro_clear_holds();}
static void release_and_route(void){
    uint8_t old=route;route=choose_route();
#ifdef C5_MOTOR_SOUND
    c5_motor_sound_reset();
#endif
#ifdef C5_ADVANCED_HAPTICS
    c5_haptic_reset();
#endif
    /* Cancel pending presses and enqueue neutral before any report on either link.
     * A key held over a switch is quarantined until physically released. */
    tx_head=tx_count=0;macro_cancel();encoder_pending=0;suppressed|=physical;
#ifdef C5_SMOOTH_RADIAL
    memset(&radial_motion,0,sizeof radial_motion);
#endif
    memset(last_keyboard,0,8);memset(last_consumer,0,2);last_radial=last_mouse=0;
    if(old)reset_mask[old]=15;
    if(route)reset_mask[route]=15;
}
void c5_link(bool usb_ready,bool ble_ready){
    bool changed=links[1]!=usb_ready||links[2]!=ble_ready;
    if(!changed)return;
    bool old_usb=links[1],old_ble=links[2];links[1]=usb_ready;links[2]=ble_ready;
    if(old_usb&&!usb_ready)c5_config_transport_lost(1);
    if(old_ble&&!ble_ready)c5_config_transport_lost(2);
    if(!usb_ready&&!ble_ready)c5_config_transport_lost(0);
    if(usb_ready&&!old_usb)reset_mask[1]=15;
    if(ble_ready&&!old_ble)reset_mask[2]=15;
    uint8_t next_route=choose_route();
    if(next_route!=route){release_and_route();if(next_route)last_activity=now;}
    flush();
}
static void profile(uint8_t p){if(p!=cfg[5]){cfg[5]=p;rate_invalidate();release_and_route();
#ifdef C5_ADVANCED_HAPTICS
    c5_haptic_event(C5_HE_PROFILE);
#endif
}}
static bool macro_start(uint8_t slot,uint8_t trigger_key){
    if(macro_active&&macro_slot==slot&&macro_mode==C5_MACRO_TOGGLE){macro_cancel();sync_holds();return true;}
    /* Stopping/replacing a macro remains possible even under TX backpressure.
     * sync_holds retains dirty releases until they can enter the queue. */
    macro_cancel();sync_holds();
    const uint8_t *m=cfg+128+100*slot;
    if(!m[0])return true;
    macro_active=true;macro_slot=slot;macro_step=0;macro_due=now;
    macro_mode=m[1];macro_trigger_key=trigger_key;
    if(macro_mode==C5_MACRO_HOLD&&trigger_key>=6)macro_mode=C5_MACRO_ONCE;
#ifdef C5_ADVANCED_HAPTICS
    c5_haptic_event(C5_HE_MACRO_START);
#endif
    return true;
}
static bool tap(const uint8_t b[4]){
    uint8_t press[8],release[8];
    if(!route)return true;
    if(b[0]==C5_ACTION_MACRO)return macro_start((uint8_t)u16(b+2),0xff);
    if(b[0]==C5_ACTION_PROFILE){profile((uint8_t)u16(b+2));return true;}
    if(TX_CAP-tx_count<3)return false;
    switch(b[0]) {
    case 0:return true;
    case 1:keyboard(press,b);keyboard(release,NULL);enqueue(1,press,8);enqueue(1,release,8);return true;
    case 2:p16(press,u16(b+2));p16(release,consumer());enqueue(2,press,2);enqueue(2,release,2);return true;
    case 3:press[0]=mouse_buttons();press[1]=press[2]=0;press[3]=(uint8_t)(int8_t)(int16_t)u16(b+2);enqueue(4,press,4);return true;
    case 6:
        memset(press,0,4);memset(release,0,4);release[0]=mouse_buttons();press[0]=release[0]|(uint8_t)u16(b+2);
        enqueue(4,press,4);enqueue(4,release,4);return true;
    default:return false;
    }
}
void c5_input_key(uint8_t index,bool pressed){
    if(index>=6)return;
    uint8_t mask=(uint8_t)(1u<<index);
    if(!!(physical&mask)==pressed)return;
    last_activity=now;
    if(!pressed){
        physical&=(uint8_t)~mask;suppressed&=(uint8_t)~mask;
        if(macro_active&&macro_mode==C5_MACRO_HOLD&&macro_trigger_key==index)macro_cancel();
        sync_holds();flush();return;
    }
    physical|=mask;
    if((c5_layer_flags(cfg)&2u)&&index==c5_layer_byte(cfg,11)){
        memset(held[index],0,4);held[index][0]=C5_ACTION_FN;
        /* Fn must be pressed first. Never reinterpret an ordinary held key as
         * a chord after its host action has already started. */
        if((physical&~suppressed&~mask)||!route)suppressed|=mask;
        return;
    }
    if(fn_held()){
        memset(held[index],0,4);uint8_t chord=physical&~suppressed;
        for(uint8_t p=0;p<3;p++)if(chord==c5_layer_byte(cfg,12+p)){profile(p);break;}
        flush();return;
    }
    memcpy(held[index],cfg+32+(cfg[5]*8+index)*4,4);
    if(index==5&&cfg[7]==0)memset(held[index],0,4);
    bool volume_press=index==5&&cfg[7]==1;
    if(volume_press)memset(held[index],0,4);
    if(!route){suppressed|=mask;return;}
#ifdef C5_ADVANCED_HAPTICS
    if(volume_press||(held[index][0]!=C5_ACTION_MACRO&&held[index][0]!=C5_ACTION_PROFILE))
        c5_haptic_event(index==5?C5_HE_PRESS:C5_HE_KEY);
#else
    if(cfg[10])c5_hal_haptic(cfg[10]);
#endif
    if(volume_press){const uint8_t mute[4]={2,0,0xe2,0};tap(mute);}
    else if(held[index][0]==C5_ACTION_MACRO)macro_start((uint8_t)u16(held[index]+2),index);
    else if(held[index][0]==C5_ACTION_SCROLL||held[index][0]==C5_ACTION_PROFILE)tap(held[index]);
    else sync_holds();
    flush();
}
void c5_input_encoder(int16_t delta){
    encoder_total=(uint16_t)(encoder_total+(uint16_t)delta);last_activity=now;
    if(!route||fn_held())return;
    encoder_pending+=delta;
    if(encoder_pending>32767)encoder_pending=32767;
    if(encoder_pending < -32767)encoder_pending=-32767;
}
static void encoder_tick(void){
    if(!encoder_pending||!route)return;
    int direction=encoder_pending>0?1:-1;uint8_t b[4]={0};bool accepted=false,feedback=true;
#ifdef C5_SMOOTH_RADIAL
    c5_radial_motion next=radial_motion;
#endif
    const uint8_t *custom=cfg+32+(cfg[5]*8+(direction>0?7:6))*4;
    if(TX_CAP-tx_count<3&&!(cfg[7]==3&&(custom[0]==C5_ACTION_MACRO||custom[0]==C5_ACTION_PROFILE)))return;
    if(cfg[7]==0){
        int16_t angle=(int16_t)(direction*(int)u16(cfg+12));
#ifdef C5_SMOOTH_RADIAL
        angle=c5_radial_advance(&next,direction,u16(cfg+12),cfg[11],&feedback);
#endif
        b[0]=radial_button();p16(b+1,(uint16_t)angle);
        accepted=!angle||enqueue(3,b,3);
    }
    else if(cfg[7]==1){b[0]=2;p16(b+2,direction>0?0xe9:0xea);accepted=tap(b);}
    else if(cfg[7]==2){b[0]=3;p16(b+2,(uint16_t)(int16_t)direction);accepted=tap(b);}
    else accepted=tap(custom);
    if(accepted){ /* profile actions clear encoder_pending themselves. */
#ifdef C5_SMOOTH_RADIAL
        if(cfg[7]==0)radial_motion=next;
#endif
        if(encoder_pending&&((encoder_pending>0)==(direction>0)))encoder_pending-=direction;
#ifdef C5_WINDOWS_FEATURES
        if(feedback)c5_features_auto_haptic(cfg[10]);
#else
#ifdef C5_ADVANCED_HAPTICS
        if(feedback)c5_haptic_event(C5_HE_TURN);
#else
        if(feedback&&cfg[10])c5_hal_haptic(cfg[10]);
#endif
#endif
    }
}
static void macro_tick(void){
    if(!macro_active||!route||(int32_t)(now-macro_due)<0||TX_CAP-tx_count<4)return;
    const uint8_t *m=cfg+128+100*macro_slot;
    if(macro_step>=m[0]){
        bool repeat=macro_mode==C5_MACRO_TOGGLE||
            (macro_mode==C5_MACRO_HOLD&&macro_trigger_key<6&&(physical&~suppressed&(1u<<macro_trigger_key)));
        macro_clear_holds();sync_holds();
        if(repeat){macro_step=0;macro_due=now+1;}else {macro_cancel();
#ifdef C5_ADVANCED_HAPTICS
            c5_haptic_event(C5_HE_MACRO_END);
#endif
        }
        return;
    }
    const uint8_t *s=m+4+6*macro_step;uint8_t value=(uint8_t)u16(s+2);
    if(s[0]==1){
        unsigned free_slot=16;
        for(unsigned i=0;i<16;i++){if(mh[i].used&&mh[i].usage==value&&mh[i].mods==s[1]){free_slot=i;break;}if(!mh[i].used&&free_slot==16)free_slot=i;}
        if(free_slot<16){mh[free_slot].used=1;mh[free_slot].usage=value;mh[free_slot].mods=s[1];}
        sync_holds();
    }else if(s[0]==2){
        for(unsigned i=0;i<16;i++)if(mh[i].used&&mh[i].usage==value&&mh[i].mods==s[1])mh[i].used=0;
        sync_holds();
    }else if(s[0]==3||s[0]==4){uint8_t b[4]={s[0]==3?2:3,0,s[2],s[3]};tap(b);}
    else if(s[0]==5||s[0]==6){
        if(s[0]==5)macro_mouse|=value;else macro_mouse&=(uint8_t)~value;
        sync_holds();
    }
    macro_step++;macro_due=now+(u16(s+4)?u16(s+4):1u);
}
static void colorwheel(uint8_t h,uint8_t out[3]){
    if(h<85){out[0]=(uint8_t)(255-3*h);out[1]=(uint8_t)(3*h);out[2]=0;}
    else if(h<170){h-=85;out[0]=0;out[1]=(uint8_t)(255-3*h);out[2]=(uint8_t)(3*h);}
    else{h-=170;out[0]=(uint8_t)(3*h);out[1]=0;out[2]=(uint8_t)(255-3*h);}
}
static void lights_tick(void){
    if((uint32_t)(now-last_light_tick)<16)return;
    last_light_tick=now;
    uint8_t out[18]={0};uint32_t idle=now-last_activity;
    bool idle_awake=!u16(cfg+14)||idle<(uint32_t)u16(cfg+14)*1000u;
    /* A powered USB port is not proof that its computer is awake. Transports
     * report configured/unsuspended HID readiness; no selected host means dark.
     * Explicit pairing may show its status lamp while backlights stay off. */
    bool host_awake=route!=0&&idle_awake;
    bool status_awake=(pair_indicator&1)||(route!=0&&idle_awake);
    bool lit=cfg[9]!=0&&host_awake;
    unsigned amplitude=cfg[8];
    if(cfg[9]==3){unsigned phase=(now/12u)%510u;amplitude=amplitude*(phase<255?phase:510-phase)/255;}
    for(unsigned k=0;k<5;k++){
        uint8_t rgb[3];memcpy(rgb,cfg+928+3*k,3);
        if(cfg[9]==2)colorwheel((uint8_t)(now/20u+k*35u),rgb);
        unsigned a=lit?amplitude:0;
        if(cfg[9]==4&&!(physical&(1u<<k)))a=0;
        for(unsigned c=0;c<3;c++)out[3*k+c]=(uint8_t)((unsigned)rgb[c]*a/100u);
    }
#ifdef C5_WINDOWS_FEATURES
    c5_features_lights(out,host_awake);
#endif
    const uint8_t *status=cfg+C5_STATUS_LIGHT_OFFSET;
    bool custom=status[0]==C5_STATUS_LIGHT_MARKER;
    unsigned brightness=custom?status[2]:100;
    /* An explicit BOOT request must remain visible throughout its bounded
     * pairing window, even with status brightness zero or a short idle time. */
    if((pair_indicator&1)&&brightness<50)brightness=50;
    if(status_awake){
        if(pair_indicator&1)out[17]=(pair_indicator&2)?48:0;
        else if(c5_layer_flags(cfg)&1u)for(unsigned c=0;c<3;c++)out[15+c]=c5_layer_byte(cfg,2+3*cfg[5]+c);
        else if(custom&&status[1]==1)memcpy(out+15,status+3,3);
        else if(route==1){out[16]=20;out[17]=28;}
        else if(route==2){out[15]=12;out[17]=28;}
        else out[15]=8;
        for(unsigned c=15;c<18;c++)out[c]=(uint8_t)((unsigned)out[c]*brightness/100u);
    }
    if(memcmp(out,last_lights,18)){c5_hal_lights(out,out+15);memcpy(last_lights,out,18);}
}
void c5_pairing_indicator(bool active,bool on){
    /* Entering user-requested pairing wakes the lamp. Blink transitions and
     * background link/config polling must not keep extending the idle timer. */
    if(active&&!(pair_indicator&1))last_activity=now;
    pair_indicator=active?(on?3:1):0;
}
void c5_tick(uint32_t milliseconds){
    now=milliseconds;
#ifdef C5_MOTOR_SOUND
    c5_motor_sound_tick();
#endif
#ifdef C5_ADVANCED_HAPTICS
    c5_haptic_tick(milliseconds);
#endif
    if(staging&&(uint32_t)(now-stage_last)>=30000u){staging=false;stage_next=0;}
    flush();sync_holds();macro_tick();encoder_tick();flush();lights_tick();
}
void c5_init(void){
#ifdef C5_MOTOR_SOUND
    c5_motor_sound_init();
#endif
    memset(links,0,sizeof links);memset(reset_mask,0,sizeof reset_mask);memset(held,0,sizeof held);
    memset(last_keyboard,0,8);memset(last_consumer,0,2);memset(last_lights,255,18);
    route=physical=suppressed=last_radial=last_mouse=pair_indicator=0;tx_head=tx_count=0;now=last_activity=last_light_tick=0;
#ifdef C5_SMOOTH_RADIAL
    memset(&radial_motion,0,sizeof radial_motion);
#endif
    encoder_pending=0;encoder_total=0;staging=false;stage_next=0;stage_owner=0;stage_last=0;macro_cancel();
    rate_invalidate();
    if(!c5_hal_load(cfg)||!c5_validate_config(cfg))c5_default_config(cfg);
#ifdef C5_HAPTIC_CALIBRATION
    (void)c5_hal_haptic_configure(cfg+C5_TUNING_OFFSET);
#endif
}
static void activate(const uint8_t *c){memcpy(cfg,c,C5_CONFIG_SIZE);rate_invalidate();release_and_route();flush();last_activity=now;}
void c5_config_transport_lost(uint8_t transport){
#ifdef C5_MOTOR_SOUND
    c5_motor_sound_lost(transport);
#endif
#ifdef C5_ADVANCED_HAPTICS
    c5_haptic_lost(transport);
#endif
    if(staging&&stage_owner==transport){staging=false;stage_next=0;}
    /* A physical transport disconnect is also an unconditional loop stop, even
     * if input was routed to the other host. Preserve independently held keys. */
    if(macro_active){macro_cancel();sync_holds();flush();}
#ifdef C5_REPORT_RATES
    if(rate_saved&&rate_owner==transport)rate_invalidate();
#endif
}
void c5_config_frame(const uint8_t in[C5_FRAME_SIZE],uint8_t out[C5_FRAME_SIZE]){c5_config_frame_transport(0,in,out);}
void c5_config_frame_transport(uint8_t transport,const uint8_t in[C5_FRAME_SIZE],uint8_t out[C5_FRAME_SIZE]){
    uint8_t request[C5_FRAME_SIZE];memcpy(request,in,C5_FRAME_SIZE);in=request;
    memset(out,0,C5_FRAME_SIZE);out[0]=0xc5;out[1]=1;out[2]=in[2]|0x80;out[3]=in[3];out[6]=in[6];out[7]=in[7];
    uint8_t n=in[4];uint16_t offset=u16(in+6);uint8_t error=C5_OK;
    if(transport>2||in[0]!=0xc5||in[1]!=1||n>12||in[5]||in[2]&0x80){out[5]=C5_ERR_FRAME;return;}
    if(staging&&stage_owner!=transport&&in[2]>=3&&in[2]<=8){out[5]=C5_ERR_BUSY;return;}
    switch(in[2]){
    case 1:
        if(n){error=C5_ERR_FRAME;break;}out[4]=12;memcpy(out+8,"C5RE",4);out[12]=1;out[13]=1;p16(out+14,C5_CONFIG_SIZE);
        uint32_t capabilities=0x63fu|C5_STATUS_LIGHT_CAPABILITY;
#ifdef C5_WINDOWS_FEATURES
        capabilities|=0x1000c0u;
#endif
#ifdef C5_REPORT_RATES
        capabilities|=0x100u;
#endif
#ifdef C5_BLE_WINDOWS_FEATURES
        capabilities|=0x1800u;
#endif
#ifdef C5_BOARD_DIAGNOSTICS
        capabilities|=0x6000u;
#endif
#ifdef C5_ADVANCED_HAPTICS
        capabilities|=0x8000u|C5_LAYER_CAPABILITY;
        out[13]=14;
#ifdef C5_SMOOTH_RADIAL
        capabilities|=0x400000u;out[13]=15;
#endif
#endif
#ifdef C5_NO_HAPTICS
        /* Explicit motorless variant; keep layers and smooth Dial independent. */
        capabilities=(capabilities&~(0x20u|0x80u|0x1000u|0x8000u|0x80000u))|0x800000u;
#endif
        p32(out+16,capabilities);
#ifdef C5_MOTOR_SOUND
        out[13]=14;
#ifdef C5_SMOOTH_RADIAL
        capabilities|=0x400000u;out[13]=15;
#endif
        p32(out+16,capabilities|C5_MOTOR_SOUND_CAPABILITY|C5_MOTOR_DIAGNOSTICS_CAPABILITY);
#endif
#ifdef C5_HAPTIC_CALIBRATION
        p32(out+16,u32(out+16)|C5_TUNING_CAPABILITY);
#endif
        break;
    case 2:
        if(n!=1){error=C5_ERR_FRAME;break;}
        if(!in[8]||in[8]>12||offset>C5_CONFIG_SIZE||in[8]>C5_CONFIG_SIZE-offset){error=C5_ERR_RANGE;break;}
        out[4]=in[8];memcpy(out+8,cfg+offset,in[8]);
#ifdef C5_REPORT_RATES
        if(rate_saved&&rate_owner==transport){
            if(offset==0)rate_read_next=0;
            if(offset==rate_read_next)rate_read_next=(uint16_t)(rate_read_next+in[8]);else rate_read_next=0;
        }
#endif
        break;
    case 3:
        if(n!=6){error=C5_ERR_FRAME;break;}if(u16(in+8)!=C5_CONFIG_SIZE){error=C5_ERR_RANGE;break;}
        if(staging){error=C5_ERR_BUSY;break;}rate_invalidate();staging=true;stage_owner=transport;stage_last=now;stage_next=0;stage_crc=u32(in+10);memset(stage,0,C5_CONFIG_SIZE);break;
    case 4:
        if(!staging){error=C5_ERR_BUSY;break;}if(!n){error=C5_ERR_FRAME;break;}
        if(offset!=stage_next||offset>C5_CONFIG_SIZE||n>C5_CONFIG_SIZE-offset){error=C5_ERR_RANGE;break;}
        memcpy(stage+offset,in+8,n);stage_next=(uint16_t)(stage_next+n);stage_last=now;break;
    case 5:
        if(n){error=C5_ERR_FRAME;break;}if(!staging||stage_next!=C5_CONFIG_SIZE){error=C5_ERR_BUSY;break;}
        if(c5_crc32(stage,C5_CONFIG_SIZE)!=stage_crc){error=C5_ERR_CRC;break;}
        if(!c5_validate_config(stage)){error=C5_ERR_CONFIG;break;}
#ifdef C5_HAPTIC_CALIBRATION
        if(c5_hal_haptic_calibrating()){error=C5_ERR_BUSY;break;}
        c5_haptic_reset();
        if(!c5_hal_haptic_configure(stage+C5_TUNING_OFFSET)){error=C5_ERR_IO;break;}
#endif
        activate(stage);staging=false;break;
    case 6:
#ifdef C5_HAPTIC_CALIBRATION
        if(c5_hal_haptic_calibrating()){error=C5_ERR_BUSY;break;}
        if(!c5_hal_haptic_tuning_matches(cfg+C5_TUNING_OFFSET)){error=C5_ERR_IO;break;}
#endif
        if(n){error=C5_ERR_FRAME;break;}rate_invalidate();
        if(!c5_hal_save(cfg))error=C5_ERR_IO;
#ifdef C5_REPORT_RATES
        else{rate_saved=true;rate_owner=transport;rate_read_next=0;rate_saved_crc=c5_crc32(cfg,C5_CONFIG_SIZE);}
#endif
        break;
    case 7:if(n){error=C5_ERR_FRAME;break;}staging=false;stage_next=0;break;
    case 8:
        if(n){error=C5_ERR_FRAME;break;}
#ifdef C5_HAPTIC_CALIBRATION
        if(c5_hal_haptic_calibrating()){error=C5_ERR_BUSY;break;}
#endif
        c5_default_config(stage);
#ifdef C5_HAPTIC_CALIBRATION
        c5_haptic_reset();
        if(!c5_hal_haptic_configure(stage+C5_TUNING_OFFSET)){error=C5_ERR_IO;break;}
#endif
        activate(stage);staging=false;stage_next=0;break;
    case 9:{
        if(n){error=C5_ERR_FRAME;break;}uint8_t flags=(links[1]?1:0)|(links[2]?2:0),percent=255;uint16_t mv=0;
        c5_hal_status(&flags,&percent,&mv);out[4]=12;out[8]=flags;out[9]=percent;out[10]=cfg[5];out[11]=physical;
#ifdef C5_WINDOWS_FEATURES
        if(route)out[8]|=c5_features_control_flags();
#endif
        p16(out+12,mv);p16(out+14,encoder_total);out[16]=route;
#ifdef C5_REPORT_RATES
        uint8_t usb_ms=0;uint16_t ble_units=0;c5_hal_rate_status(&usb_ms,&ble_units);out[17]=usb_ms;p16(out+18,ble_units);
#endif
        break;}
    case 10:if(n!=1){error=C5_ERR_FRAME;break;}if(in[8]>100){error=C5_ERR_RANGE;break;}
#ifdef C5_NO_HAPTICS
        error=C5_ERR_UNSUPPORTED;break;
#endif
#ifdef C5_ADVANCED_HAPTICS
        if(route&&transport!=route){error=C5_ERR_BUSY;break;}
        c5_haptic_reset();
#endif
        if(!c5_hal_haptic(in[8]))error=C5_ERR_IO;
        break;
#ifdef C5_ADVANCED_HAPTICS
    case 14:
#ifdef C5_NO_HAPTICS
        error=C5_ERR_UNSUPPORTED;break;
#endif
#ifdef C5_HAPTIC_CALIBRATION
        if(c5_hal_haptic_calibrating()){error=C5_ERR_BUSY;break;}
#endif
#ifdef C5_MOTOR_SOUND
        if(c5_motor_sound_active()){error=C5_ERR_BUSY;break;}
#endif
        error=c5_haptic_command(transport,route,in+8,n,offset);break;
#endif
#ifdef C5_MOTOR_SOUND
    case 15:error=c5_motor_sound_command(transport,route,in+8,n,offset);break;
    case 16:
        if(n||offset){error=C5_ERR_FRAME;break;}
        out[4]=12;
        if(!c5_hal_motor_diagnostics(out+8))error=C5_ERR_IO;
        break;
#endif
#ifdef C5_HAPTIC_CALIBRATION
    case 17:
        if(n||offset>2){error=C5_ERR_FRAME;break;}
        out[4]=12;
        if(!c5_hal_haptic_calibration_status((uint8_t)offset,out+8))error=C5_ERR_IO;
        break;
    case 18:
        if(offset){error=C5_ERR_FRAME;break;}
#ifdef C5_MOTOR_SOUND
        if(c5_motor_sound_active()){error=C5_ERR_BUSY;break;}
#endif
        error=c5_haptic_calibration_command(transport,route,in+8,n);break;
#endif
#ifdef C5_REPORT_RATES
    case 11:
        if(n){error=C5_ERR_FRAME;break;}
        if(staging||!rate_saved||rate_owner!=transport||rate_read_next!=C5_CONFIG_SIZE){error=C5_ERR_BUSY;break;}
        if(rate_saved_crc!=c5_crc32(cfg,C5_CONFIG_SIZE)){rate_invalidate();error=C5_ERR_CONFIG;break;}
        rate_invalidate();if(!c5_hal_reconfigure(transport))error=C5_ERR_IO;break;
#endif
#ifdef C5_BOARD_DIAGNOSTICS
    case 12:if(n){error=C5_ERR_FRAME;break;}out[4]=12;c5_hal_diagnostics(out+8);break;
    case 13:if(n){error=C5_ERR_FRAME;break;}out[4]=12;c5_hal_ble_diagnostics(out+8);break;
#endif
    default:error=C5_ERR_UNSUPPORTED;break;
    }
    out[5]=error;
}
