#include "c5.h"
#include "../board/encoder.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#ifdef C5_WINDOWS_FEATURES
#include "hid_features.h"
#endif

typedef struct {uint8_t route,id,len,data[8];} report;
static report log_reports[4096];
static unsigned log_count;
static uint8_t stored[1024],host[3][5][8];
static bool load_ok,save_ok,haptic_ok,blocked[3];
static unsigned save_calls,haptic_calls,light_calls;
static uint8_t last_haptic;
static uint8_t shown_lights[18];
#ifdef C5_REPORT_RATES
static unsigned reconfigure_calls;static uint8_t reconfigure_source;static bool reconfigure_ok;
void c5_hal_rate_status(uint8_t *usb_ms,uint16_t *ble_units){*usb_ms=2;*ble_units=12;}
bool c5_hal_reconfigure(uint8_t source){reconfigure_calls++;reconfigure_source=source;return reconfigure_ok;}
#endif
bool c5_hal_report(uint8_t t,uint8_t id,const uint8_t *data,uint8_t len){
    if(blocked[t])return false;
    assert(t==1||t==2);assert(id>=1&&id<=4);assert(len<=8);assert(log_count<4096);
    report *r=&log_reports[log_count++];r->route=t;r->id=id;r->len=len;memcpy(r->data,data,len);
    memset(host[t][id],0,8);memcpy(host[t][id],data,len);return true;
}
bool c5_hal_load(uint8_t out[1024]){if(load_ok)memcpy(out,stored,1024);return load_ok;}
bool c5_hal_save(const uint8_t in[1024]){save_calls++;if(save_ok)memcpy(stored,in,1024);return save_ok;}
bool c5_hal_haptic(uint8_t s){haptic_calls++;last_haptic=s;return haptic_ok;}
void c5_hal_lights(const uint8_t rgb[15],const uint8_t status[3]){memcpy(shown_lights,rgb,15);memcpy(shown_lights+15,status,3);light_calls++;}
void c5_hal_status(uint8_t *flags,uint8_t *percent,uint16_t *mv){*flags|=4;*percent=73;*mv=3975;}
#ifdef C5_BOARD_DIAGNOSTICS
static unsigned diagnostic_calls;
void c5_hal_diagnostics(uint8_t out[12]){++diagnostic_calls;for(unsigned i=0;i<12;++i)out[i]=(uint8_t)(i+1);}
void c5_hal_ble_diagnostics(uint8_t out[12]){++diagnostic_calls;for(unsigned i=0;i<12;++i)out[i]=(uint8_t)(i+32);}
#endif
static void put16(uint8_t *p,uint16_t x){p[0]=(uint8_t)x;p[1]=(uint8_t)(x>>8);}
static void put32(uint8_t *p,uint32_t x){put16(p,(uint16_t)x);put16(p+2,(uint16_t)(x>>16));}
static uint8_t *bind(uint8_t c[1024],unsigned key){return c+32+4*key;}
static void set_binding(uint8_t *b,uint8_t type,uint8_t mods,uint16_t value){b[0]=type;b[1]=mods;put16(b+2,value);}
static void setup(const uint8_t *config){
    memset(host,0,sizeof host);memset(blocked,0,sizeof blocked);log_count=save_calls=haptic_calls=light_calls=0;
    save_ok=haptic_ok=true;load_ok=config!=NULL;if(config)memcpy(stored,config,1024);c5_init();
#ifdef C5_WINDOWS_FEATURES
    c5_features_init();
#endif
#ifdef C5_REPORT_RATES
    reconfigure_calls=0;reconfigure_source=0;reconfigure_ok=true;
#endif
}
static bool key_held(unsigned route,uint8_t usage){for(unsigned i=2;i<8;i++)if(host[route][1][i]==usage)return true;return false;}
static bool is_zero(const uint8_t *p,unsigned n){while(n--)if(*p++)return false;return true;}
static unsigned id_count(uint8_t id){unsigned n=0;for(unsigned i=0;i<log_count;i++)if(log_reports[i].id==id)n++;return n;}
static uint8_t command(uint8_t op,uint16_t offset,const uint8_t *payload,uint8_t len,uint8_t result[20]){
    uint8_t in[20]={0xc5,1,op,0x2a,len,0,0,0};put16(in+6,offset);if(len<=12&&payload)memcpy(in+8,payload,len);
    c5_config_frame(in,result);assert(result[0]==0xc5&&result[1]==1&&result[2]==(op|0x80)&&result[3]==0x2a);
    return result[5];
}
static void begin(const uint8_t config[1024],uint32_t crc){
    uint8_t p[6],r[20];(void)config;put16(p,1024);put32(p+2,crc);assert(command(3,0,p,6,r)==C5_OK);
}
static void write_all(const uint8_t config[1024]){
    uint8_t r[20];for(unsigned i=0;i<1024;i+=12){uint8_t n=(uint8_t)(1024-i<12?1024-i:12);assert(command(4,(uint16_t)i,config+i,n,r)==C5_OK);}
}
static void apply(const uint8_t config[1024]){uint8_t r[20];begin(config,c5_crc32(config,1024));write_all(config);assert(command(5,0,NULL,0,r)==0);}

static void test_defaults_and_protocol(void){
    uint8_t c[1024],r[20],p[12]={0};c5_default_config(c);assert(c5_validate_config(c));
    assert(c5_crc32((const uint8_t *)"123456789",9)==0xcbf43926u);
    setup(NULL);assert(!memcmp(c,c5_config(),1024));assert(command(1,0,NULL,0,r)==0);
    assert(r[4]==12&&!memcmp(r+8,"C5RE",4)&&r[13]==1&&r[14]==0&&r[15]==4);
#ifdef C5_WINDOWS_FEATURES
    assert(r[16]==0xff);
#else
    assert(r[16]==0x3f);
#endif
#ifdef C5_REPORT_RATES
    uint8_t upper_caps=7;
#else
    uint8_t upper_caps=6;
#endif
#ifdef C5_BLE_WINDOWS_FEATURES
    upper_caps|=0x18;
#endif
#ifdef C5_BOARD_DIAGNOSTICS
    upper_caps|=0x60;
#endif
    assert(r[17]==upper_caps&&r[19]==0);
#ifdef C5_WINDOWS_FEATURES
    assert(r[18]==17);
#else
    assert(r[18]==1);
#endif
    p[0]=12;assert(command(2,1020,p,1,r)==C5_ERR_RANGE);p[0]=4;assert(command(2,1020,p,1,r)==0);
    p[0]=0;assert(command(2,0,p,1,r)==C5_ERR_RANGE);p[0]=1;assert(command(2,65535,p,1,r)==C5_ERR_RANGE);
    assert(command(4,0,p,1,r)==C5_ERR_BUSY);assert(command(5,0,NULL,0,r)==C5_ERR_BUSY);
    assert(command(0x40,0,NULL,0,r)==C5_ERR_UNSUPPORTED);
    assert(command(1,0,p,1,r)==C5_ERR_FRAME);
    uint8_t bad[20]={0xc5,1,9,1,13};c5_config_frame(bad,r);assert(r[5]==C5_ERR_FRAME);
    bad[4]=0;bad[5]=1;c5_config_frame(bad,r);assert(r[5]==C5_ERR_FRAME);
    bad[5]=0;bad[0]=0;c5_config_frame(bad,r);assert(r[5]==C5_ERR_FRAME);
    c5_link(true,true);c5_input_key(1,true);c5_input_encoder(-2);
    assert(command(9,0,NULL,0,r)==0);assert(r[8]==7&&r[9]==73&&r[11]==2&&r[12]==0x87&&r[13]==0x0f&&r[14]==0xfe&&r[15]==0xff&&r[16]==1);
#ifdef C5_REPORT_RATES
    assert(r[17]==2&&r[18]==12&&r[19]==0);
#endif
    p[0]=100;assert(command(10,0,p,1,r)==0&&last_haptic==100);p[0]=101;assert(command(10,0,p,1,r)==C5_ERR_RANGE);
    p[0]=50;haptic_ok=false;assert(command(10,0,p,1,r)==C5_ERR_IO);haptic_ok=true;
    c5_tick(25);assert(light_calls==1);
}
static void test_transaction_integrity(void){
    uint8_t c[1024],original[1024],r[20],p[6];setup(NULL);memcpy(original,c5_config(),1024);memcpy(c,original,1024);c[8]=77;
    begin(c,c5_crc32(c,1024));put16(p,1024);put32(p+2,0);assert(command(3,0,p,6,r)==C5_ERR_BUSY);
    assert(command(4,12,c,12,r)==C5_ERR_RANGE);assert(command(5,0,NULL,0,r)==C5_ERR_BUSY);
    assert(!memcmp(original,c5_config(),1024));write_all(c);assert(command(5,0,NULL,0,r)==0);assert(c5_config()[8]==77);
    assert(command(5,0,NULL,0,r)==C5_ERR_BUSY);
    begin(original,c5_crc32(original,1024)^1u);write_all(original);assert(command(5,0,NULL,0,r)==C5_ERR_CRC);assert(c5_config()[8]==77);
    assert(command(7,0,NULL,0,r)==0);
    c[11]=0;begin(c,c5_crc32(c,1024));write_all(c);assert(command(5,0,NULL,0,r)==C5_ERR_CONFIG);assert(c5_config()[11]==4);
    command(7,0,NULL,0,r);save_ok=false;assert(command(6,0,NULL,0,r)==C5_ERR_IO&&save_calls==1);
    save_ok=true;assert(command(6,0,NULL,0,r)==0&&save_calls==2&&stored[8]==77);
    assert(command(8,0,NULL,0,r)==0&&c5_config()[8]==30&&stored[8]==77);
    c5_default_config(c);c[4]=2;assert(!c5_validate_config(c));c[4]=1;c[943]=1;assert(!c5_validate_config(c));c[943]=0;
    c[128]=17;assert(!c5_validate_config(c));c[128]=0;c[132]=1;assert(!c5_validate_config(c));
    c5_default_config(c);c[32]=255;assert(!c5_validate_config(c));
    c5_default_config(c);put16(c+12,3601);assert(!c5_validate_config(c));
    c5_default_config(c);set_binding(c+32,3,0,128);assert(!c5_validate_config(c));
    c5_default_config(c);put32(c+20,0);assert(!c5_validate_config(c));
}
static void test_multikey_and_release(void){
    setup(NULL);c5_link(true,false);c5_input_key(0,true);assert(key_held(1,6)&&host[1][1][0]==1);
    c5_input_key(1,true);assert(key_held(1,6)&&key_held(1,25));
    c5_input_key(0,false);assert(!key_held(1,6)&&key_held(1,25)&&host[1][1][0]==1);
    c5_input_key(1,false);assert(is_zero(host[1][1],8));
    uint8_t c[1024];c5_default_config(c);set_binding(bind(c,0),1,1,6);set_binding(bind(c,1),1,2,6);apply(c);
    c5_input_key(0,true);c5_input_key(1,true);assert(key_held(1,6)&&host[1][1][0]==3);
    c5_input_key(0,false);assert(key_held(1,6)&&host[1][1][0]==2);
    c5_input_key(1,false);assert(is_zero(host[1][1],8));
    set_binding(bind(c,0),1,0,0xe3);apply(c);c5_input_key(0,true);assert(host[1][1][0]==8&&!key_held(1,0xe3));
    c5_input_key(0,false);assert(is_zero(host[1][1],8));
}
static void test_backpressure_never_sticks(void){
    setup(NULL);c5_link(true,false);blocked[1]=true;
    for(unsigned i=0;i<100;i++){c5_input_key(0,true);c5_input_key(0,false);}
    c5_input_key(1,true);blocked[1]=false;c5_tick(1);assert(key_held(1,25));
    blocked[1]=true;c5_input_key(1,false);c5_tick(2);assert(key_held(1,25));
    blocked[1]=false;c5_tick(3);assert(is_zero(host[1][1],8));
    c5_input_key(0,true);assert(key_held(1,6));blocked[1]=true;
    c5_link(false,false);c5_input_key(0,false);c5_link(true,false);
    blocked[1]=false;c5_tick(4);assert(is_zero(host[1][1],8));
}
static void test_switch_and_quarantine(void){
    setup(NULL);c5_link(false,true);c5_input_key(0,true);assert(key_held(2,6));
    unsigned before=log_count;c5_link(true,true);assert(is_zero(host[2][1],8)&&is_zero(host[1][1],8));
    assert(log_count>=before+8);c5_tick(1);assert(is_zero(host[1][1],8));
    c5_input_key(0,false);c5_input_key(0,true);assert(key_held(1,6)&&is_zero(host[2][1],8));
    c5_link(false,true);assert(is_zero(host[2][1],8));c5_input_key(0,false);c5_input_key(1,true);assert(key_held(2,25));
    c5_link(false,false);c5_input_key(1,false);c5_input_key(2,true);c5_link(false,true);assert(is_zero(host[2][1],8));
    c5_input_key(2,false);c5_input_key(2,true);assert(key_held(2,29));
}
static void make_macro(uint8_t c[1024]){
    c5_default_config(c);set_binding(bind(c,4),4,0,0);uint8_t *m=c+128;m[0]=3;
    m[4]=1;m[6]=4;put16(m+8,50); /* A down, delay 50 */
    m[10]=0;put16(m+14,50); /* wait 50 */
    m[16]=2;m[18]=4; /* A up */
}
static void test_macro_pause_preserves_physical(void){
    uint8_t c[1024];make_macro(c);assert(c5_validate_config(c));setup(c);c5_link(true,false);
    c5_input_key(0,true);c5_input_key(4,true);c5_tick(0);assert(key_held(1,4)&&key_held(1,6));
    c5_tick(49);assert(key_held(1,4));c5_tick(50);assert(key_held(1,4));c5_tick(99);assert(key_held(1,4));
    c5_tick(100);assert(!key_held(1,4)&&key_held(1,6)&&host[1][1][0]==1);
    c5_tick(101);c5_input_key(0,false);assert(is_zero(host[1][1],8));
    c5_input_key(4,false);c5_input_key(4,true);c5_tick(102);assert(key_held(1,4));
    c5_link(false,true);assert(is_zero(host[2][1],8));c5_tick(1000);assert(is_zero(host[2][1],8));
    c5_input_key(4,false);c5_input_key(4,true);c5_tick(1001);assert(key_held(2,4));
    apply(c);assert(is_zero(host[2][1],8));c5_tick(1100);assert(is_zero(host[2][1],8));
}
static void test_macro_backpressure_and_rollover(void){
    uint8_t c[1024];make_macro(c);setup(c);c5_link(true,false);blocked[1]=true;
    for(unsigned i=0;i<32;i++){c5_input_key(0,true);c5_input_key(0,false);}
    c5_input_key(4,true);c5_tick(1);blocked[1]=false;c5_tick(2);assert(key_held(1,4));
    c5_input_key(4,false);c5_input_key(4,true);c5_tick(3);assert(key_held(1,4));
    blocked[1]=true;c5_tick(53);c5_tick(103);blocked[1]=false;c5_tick(104);assert(!key_held(1,4));
    c5_default_config(c);set_binding(bind(c,4),4,0,0);uint8_t *m=c+128;m[0]=8;
    for(unsigned i=0;i<8;i++){m[4+6*i]=1;m[6+6*i]=(uint8_t)(4+i);put16(m+8+6*i,1);}
    setup(c);c5_link(true,false);c5_input_key(4,true);for(unsigned i=0;i<7;i++)c5_tick(i);
    for(unsigned i=2;i<8;i++)assert(host[1][1][i]==1);
    c5_tick(7);c5_tick(8);assert(is_zero(host[1][1],8));
}
static void test_encoder_modes(void){
    uint8_t c[1024];setup(NULL);c5_link(true,false);c5_input_key(5,true);assert(host[1][3][0]==1);
    c5_input_encoder(-1);c5_tick(1);assert(host[1][3][0]==1&&host[1][3][1]==0x4c&&host[1][3][2]==0xff);
    c5_input_key(5,false);assert(is_zero(host[1][3],3));
    c5_default_config(c);c[7]=1;apply(c);c5_input_key(5,true);assert(is_zero(host[1][2],2));
    assert(log_reports[log_count-2].data[0]==0xe2);unsigned before=id_count(2);c5_input_encoder(1);c5_tick(2);assert(id_count(2)==before+2);
    assert(log_reports[log_count-2].data[0]==0xe9&&is_zero(host[1][2],2));c5_input_key(5,false);
    c[7]=2;apply(c);c5_input_encoder(-1);c5_tick(3);assert(host[1][4][3]==0xff);
    c[7]=3;set_binding(bind(c,7),1,4,5);apply(c);c5_input_key(0,true);c5_input_encoder(1);c5_tick(4);
    assert(key_held(1,6)&&!key_held(1,5)&&host[1][1][0]==1);assert(log_reports[log_count-2].data[0]==5);
    c5_input_key(0,false);set_binding(bind(c,0),5,0,1);apply(c);c5_input_key(0,true);assert(c5_config()[5]==1);
}
static void test_rotary_backlog(void){
    uint8_t c[1024];c5_default_config(c);
    for(unsigned mode=0;mode<=2;mode+=2)for(unsigned transport=1;transport<=2;transport++){
        c[7]=(uint8_t)mode;setup(c);c5_link(transport==1,transport==2);log_count=0;
        blocked[transport]=true;
        for(unsigned i=1;i<=100;i++){c5_input_encoder(1);c5_tick(i);}
        assert(log_count==0);blocked[transport]=false;c5_tick(101);
        int sum=0;unsigned packets=0;
        for(unsigned i=0;i<log_count;i++)if(log_reports[i].id==(mode?4:3)){
            const uint8_t *d=log_reports[i].data;packets++;
            sum+=mode?(int8_t)d[3]:(int16_t)(d[1]|((uint16_t)d[2]<<8));
        }
        assert(sum==(mode?100:18000));assert(packets<=5);
        /* No delayed per-step tail remains after unblocking. */
        unsigned before=log_count;for(unsigned i=102;i<160;i++)c5_tick(i);assert(log_count==before);
        log_count=0;blocked[transport]=true;
        c5_input_encoder(1);c5_tick(161);c5_input_encoder(-1);c5_tick(162);
        blocked[transport]=false;c5_tick(163);assert(log_count==2);
        assert(mode?log_reports[0].data[3]==1:log_reports[0].data[1]==180);
        assert(mode?log_reports[1].data[3]==255:log_reports[1].data[1]==0x4c);
    }
    puts("rotary backlog: USB/BLE Dial and scroll preserve totals and reversal order without delayed per-step replay");
}
static void test_slow_scroll_edges(void){
    uint8_t c[1024];c5_default_config(c);c[7]=2;setup(c);
    for(unsigned transport=1;transport<=2;transport++){
        c5_link(transport==1,transport==2);c5_encoder encoder;
        c5_encoder_reset(&encoder,0,c5_encoder_mode_resolution(c[7],c[11]));
        unsigned before=id_count(4);const uint8_t states[]={1,3,2,0};
        for(unsigned i=0;i<4;i++){
            c5_tick(10000+i*10000);
            int8_t delta=c5_encoder_sample(&encoder,states[i],c5_encoder_mode_resolution(c[7],c[11]));
            if(delta)c5_input_encoder(delta);
            c5_tick(10001+i*10000);
            assert(id_count(4)==before+(i+1)/2);
        }
        assert(host[transport][4][3]==1);
    }
}
static void layer_block(uint8_t c[1024],const uint8_t bytes[16]){
    for(unsigned i=0;i<16;i++)c[130+100*(i/2)+(i&1)]=bytes[i];
}
static void test_layer_fn_and_rgb(void){
    uint8_t c[1024],r[20];c5_default_config(c);
    const uint8_t settings[16]={0xd3,3,10,20,30,40,50,60,70,80,90,5,33,34,36,0};
    layer_block(c,settings);for(unsigned p=0;p<3;p++)set_binding(c+32+4*(8*p+5),7,0,0);
    set_binding(c+32+4*8,1,0,4);assert(c5_validate_config(c));setup(c);c5_link(true,false);c5_tick(16);
    assert(!memcmp(shown_lights+15,settings+2,3));
    c5_input_key(5,true);assert(is_zero(host[1][3],3));c5_input_encoder(1);unsigned before=log_count;c5_tick(17);assert(log_count==before);
    c5_input_key(1,true);assert(c5_config()[5]==1&&is_zero(host[1][1],8));c5_tick(32);
    assert(!memcmp(shown_lights+15,settings+5,3));
    c5_input_key(2,true);assert(c5_config()[5]==1); /* held chord cannot cascade */
    c5_input_key(1,false);c5_input_key(2,false);c5_input_key(5,false);
    c5_input_key(0,true);assert(key_held(1,4));c5_input_key(0,false);assert(is_zero(host[1][1],8));
    assert(command(6,0,NULL,0,r)==C5_OK);c5_init();c5_link(false,true);c5_tick(16);assert(c5_config()[5]==1&&!memcmp(shown_lights+15,settings+5,3));
    c5_input_key(5,true);c5_input_key(2,true);assert(c5_config()[5]==2);c5_tick(32);assert(!memcmp(shown_lights+15,settings+8,3));
    c5_input_key(2,false);c5_input_key(5,false);c5_pairing_indicator(true,true);c5_tick(48);assert(shown_lights[15]==0&&shown_lights[16]==0&&shown_lights[17]==48);
    c5_pairing_indicator(false,false);c5_tick(64);assert(!memcmp(shown_lights+15,settings+8,3));
    c5_input_key(0,true);c5_input_key(5,true);c5_input_key(1,true);assert(c5_config()[5]==2); /* Fn must be first */
    uint8_t invalid[16];memcpy(invalid,settings,16);invalid[13]=35;layer_block(c,invalid);assert(!c5_validate_config(c));
    memcpy(invalid,settings,16);invalid[12]=1;layer_block(c,invalid);assert(!c5_validate_config(c));
    memcpy(invalid,settings,16);invalid[15]=1;layer_block(c,invalid);assert(!c5_validate_config(c));
    layer_block(c,settings);c[32+4*5]=0;assert(!c5_validate_config(c));
    puts("layers: dedicated Fn, exact chords, no ordinary input leakage/cascade, USB/BLE, RGB priority and saved restart passed");
}
static void test_transaction_ownership_and_lease(void){
    uint8_t c[1024],r[20],q[20]={0xc5,1,3,1,6};c5_default_config(c);setup(NULL);
    put16(q+8,1024);put32(q+10,c5_crc32(c,1024));c5_config_frame_transport(1,q,r);assert(r[5]==C5_OK);
    c5_config_frame_transport(2,q,r);assert(r[5]==C5_ERR_BUSY);
    q[2]=4;q[4]=12;memcpy(q+8,c,12);c5_config_frame_transport(2,q,r);assert(r[5]==C5_ERR_BUSY);
    c5_config_frame_transport(1,q,r);assert(r[5]==C5_OK);
    for(unsigned op=5;op<=8;op++){q[2]=(uint8_t)op;q[4]=0;c5_config_frame_transport(2,q,r);assert(r[5]==C5_ERR_BUSY);}
    q[2]=9;c5_config_frame_transport(2,q,r);assert(r[5]==C5_OK);
    c5_config_transport_lost(2);q[2]=3;q[4]=6;put16(q+8,1024);put32(q+10,c5_crc32(c,1024));
    c5_config_frame_transport(2,q,r);assert(r[5]==C5_ERR_BUSY);
    c5_config_transport_lost(1);c5_config_frame_transport(2,q,r);assert(r[5]==C5_OK);
    c5_tick(29999);c5_config_frame_transport(1,q,r);assert(r[5]==C5_ERR_BUSY);
    c5_tick(30000);c5_config_frame_transport(1,q,r);assert(r[5]==C5_OK);
    c5_config_transport_lost(1);c5_link(true,false);c5_config_frame_transport(1,q,r);assert(r[5]==C5_OK);
    c5_link(false,false);c5_config_frame_transport(2,q,r);assert(r[5]==C5_OK);
}
static void test_inactive_transport_does_not_block(void){
    setup(NULL);c5_link(true,false);blocked[2]=true;c5_link(true,true);
    c5_input_key(0,true);assert(key_held(1,6));c5_input_key(0,false);assert(is_zero(host[1][1],8));
    blocked[2]=false;c5_tick(1);assert(is_zero(host[2][1],8));
}
static void step(uint8_t *m,unsigned i,uint8_t type,uint8_t mods,uint16_t value,uint16_t delay){
    uint8_t *s=m+4+6*i;s[0]=type;s[1]=mods;put16(s+2,value);put16(s+4,delay);
}
static void test_mouse_multikey_and_encoder(void){
    uint8_t c[1024];c5_default_config(c);c[7]=2;
    set_binding(bind(c,0),6,0,1);set_binding(bind(c,1),6,0,3);set_binding(bind(c,2),6,0,16);
    setup(c);c5_link(true,false);c5_input_key(0,true);assert(host[1][4][0]==1);
    c5_input_key(1,true);c5_input_key(2,true);assert(host[1][4][0]==19);
    c5_input_key(0,false);assert(host[1][4][0]==19);
    c5_input_encoder(-1);c5_tick(1);assert(host[1][4][0]==19&&host[1][4][3]==255);
    c5_input_key(1,false);assert(host[1][4][0]==16&&host[1][4][3]==0);
    c5_input_key(2,false);assert(is_zero(host[1][4],4));
    c[7]=3;set_binding(bind(c,7),6,0,4);apply(c);c5_input_key(0,true);c5_input_encoder(1);c5_tick(2);
    assert(log_reports[log_count-2].id==4&&log_reports[log_count-2].data[0]==5&&host[1][4][0]==1);
    c5_input_key(0,false);assert(is_zero(host[1][4],4));
    set_binding(bind(c,5),6,0,8);apply(c);c5_input_key(5,true);assert(host[1][4][0]==8);
    c5_input_key(5,false);assert(is_zero(host[1][4],4));
}
static void test_mouse_macro_merges_physical(void){
    uint8_t c[1024];c5_default_config(c);set_binding(bind(c,0),6,0,1);set_binding(bind(c,4),4,0,0);
    uint8_t *m=c+128;m[0]=6;step(m,0,5,0,3,2);step(m,1,1,0,4,2);step(m,2,5,0,4,2);
    step(m,3,6,0,1,2);step(m,4,6,0,2,2);step(m,5,2,0,4,2);
    setup(c);c5_link(true,false);c5_input_key(0,true);c5_input_key(2,true);c5_input_key(4,true);
    c5_tick(0);assert(host[1][4][0]==3&&key_held(1,29));
    c5_tick(2);assert(key_held(1,4)&&key_held(1,29));c5_tick(4);assert(host[1][4][0]==7);
    c5_tick(6);assert(host[1][4][0]==7);c5_tick(8);assert(host[1][4][0]==5);
    c5_tick(10);assert(!key_held(1,4)&&key_held(1,29));c5_tick(12);assert(host[1][4][0]==1);
    c5_input_key(0,false);c5_input_key(2,false);assert(is_zero(host[1][4],4)&&is_zero(host[1][1],8));
}
static void test_mouse_backpressure_never_sticks(void){
    uint8_t c[1024];c5_default_config(c);set_binding(bind(c,0),6,0,31);setup(c);c5_link(true,false);
    c5_input_key(0,true);blocked[1]=true;c5_input_key(0,false);assert(host[1][4][0]==31);
    for(unsigned i=0;i<100;i++){c5_input_key(0,true);c5_input_key(0,false);}
    blocked[1]=false;c5_tick(1);assert(is_zero(host[1][4],4));
    c5_input_key(0,true);c5_link(false,true);assert(is_zero(host[2][4],4));
    c5_tick(2);assert(is_zero(host[2][4],4));c5_input_key(0,false);c5_input_key(0,true);assert(host[2][4][0]==31);
    c5_link(false,false);c5_input_key(0,false);c5_link(false,true);assert(is_zero(host[2][4],4));
}
static void loop_config(uint8_t c[1024],uint8_t mode){
    c5_default_config(c);set_binding(bind(c,0),6,0,2);set_binding(bind(c,3),4,0,0);set_binding(bind(c,4),4,0,0);
    uint8_t *m=c+128;m[0]=2;m[1]=mode;step(m,0,5,0,1,2);step(m,1,6,0,1,2);
}
static void test_macro_hold_and_toggle(void){
    uint8_t c[1024];loop_config(c,1);setup(c);c5_link(true,false);c5_input_key(0,true);c5_input_key(4,true);
    c5_tick(0);assert(host[1][4][0]==3);c5_tick(2);assert(host[1][4][0]==2);c5_tick(4);c5_tick(5);assert(host[1][4][0]==3);
    c5_input_key(4,false);assert(host[1][4][0]==2);c5_tick(1000);assert(host[1][4][0]==2);
    c5_input_key(3,true);c5_tick(1001);assert(host[1][4][0]==3);c5_input_key(4,true);c5_tick(1002);
    c5_input_key(3,false);assert(host[1][4][0]==3);c5_input_key(4,false);assert(host[1][4][0]==2);
    loop_config(c,2);setup(c);c5_link(true,false);c5_input_key(4,true);c5_tick(0);c5_input_key(4,false);
    c5_tick(2);c5_tick(4);c5_tick(5);assert(host[1][4][0]==1);
    blocked[1]=true;for(unsigned i=0;i<40;i++){c5_input_key(0,true);c5_input_key(0,false);}
    c5_input_key(3,true);blocked[1]=false;c5_tick(6);assert(is_zero(host[1][4],4));
    c5_tick(5000);assert(is_zero(host[1][4],4));
    loop_config(c,1);c[7]=3;set_binding(bind(c,7),4,0,0);setup(c);c5_link(true,false);
    c5_input_encoder(1);c5_tick(0);c5_tick(1);assert(host[1][4][0]==1);c5_tick(3);c5_tick(5);c5_tick(7);assert(is_zero(host[1][4],4));
    c[129]=2;setup(c);c5_link(true,false);c5_input_encoder(1);c5_tick(0);c5_tick(1);blocked[1]=true;
    for(unsigned i=0;i<40;i++){c5_input_key(0,true);c5_input_key(0,false);}
    c5_input_encoder(1);c5_tick(2);blocked[1]=false;c5_tick(3);assert(is_zero(host[1][4],4));
    c5_tick(100);assert(is_zero(host[1][4],4));
}
static void test_macro_loops_stop_on_changes(void){
    uint8_t c[1024];loop_config(c,2);set_binding(bind(c,3),5,0,1);
    uint8_t *m=c+128;step(m,0,1,0,4,0);step(m,1,5,0,1,10000);
    setup(c);c5_link(true,false);c5_input_key(4,true);c5_tick(0);
    for(unsigned i=0;i<100;i++)c5_tick(0);
    assert(host[1][4][0]==0); /* Zero delay cannot spin in the same millisecond. */
    c5_tick(1);assert(key_held(1,4)&&host[1][4][0]==1);apply(c);assert(is_zero(host[1][1],8)&&is_zero(host[1][4],4));
    c5_tick(20000);assert(is_zero(host[1][1],8));c5_input_key(4,false);c5_input_key(4,true);c5_tick(20001);c5_tick(20002);
    c5_input_key(3,true);assert(c5_config()[5]==1&&is_zero(host[1][1],8)&&is_zero(host[1][4],4));
    apply(c);c5_input_key(4,false);c5_input_key(4,true);c5_tick(20003);c5_tick(20004);c5_link(false,true);
    assert(is_zero(host[2][1],8)&&is_zero(host[2][4],4));c5_tick(40000);assert(is_zero(host[2][1],8)&&is_zero(host[2][4],4));
    setup(c);c5_link(true,true);c5_input_key(4,true);c5_tick(0);c5_tick(1);c5_link(true,false);
    assert(is_zero(host[1][1],8)&&is_zero(host[1][4],4));c5_tick(20000);assert(is_zero(host[1][1],8));
}
static void test_new_config_validation(void){
    uint8_t c[1024];c5_default_config(c);set_binding(bind(c,0),6,0,31);assert(c5_validate_config(c));
    set_binding(bind(c,0),6,0,0);assert(!c5_validate_config(c));set_binding(bind(c,0),6,0,32);assert(!c5_validate_config(c));
    set_binding(bind(c,0),6,1,1);assert(!c5_validate_config(c));set_binding(bind(c,0),6,0,1);
    c[128]=1;c[129]=2;step(c+128,0,5,0,31,0);assert(c5_validate_config(c));
    step(c+128,0,6,0,31,0);assert(c5_validate_config(c));step(c+128,0,6,0,0,0);assert(!c5_validate_config(c));
    step(c+128,0,5,1,1,0);assert(!c5_validate_config(c));step(c+128,0,5,0,1,0);c[129]=3;assert(!c5_validate_config(c));
    c[129]=1;c[130]=1;assert(!c5_validate_config(c));c[130]=0;
    c[19]=4;c[24]=3;assert(c5_validate_config(c));c[19]=5;assert(!c5_validate_config(c));c[19]=0;c[24]=4;assert(!c5_validate_config(c));
    c[24]=0;c[25]=1;assert(!c5_validate_config(c));
}
static void test_status_light_idle_and_settings(void){
    uint8_t c[1024],r[20];c5_default_config(c);put16(c+14,1);
    setup(c);c5_link(true,false);c5_tick(16);
    assert(shown_lights[15]==0&&shown_lights[16]==20&&shown_lights[17]==28);
    c5_tick(984);assert(shown_lights[17]==28);
    assert(command(9,0,NULL,0,r)==C5_OK); /* Web polling is not physical activity. */
    c5_tick(1000);assert(is_zero(shown_lights,18));
    c5_input_key(0,true);c5_tick(1016);assert(shown_lights[17]==28&&shown_lights[0]>0);
    c5_input_key(0,false);c5_tick(2016);assert(is_zero(shown_lights,18));
    c5_input_encoder(1);c5_tick(2032);assert(shown_lights[17]==28);
    /* Backlight off/zero brightness must not disable an awake status lamp. */
    c[8]=c[9]=0;apply(c);c5_tick(2048);assert(is_zero(shown_lights,15)&&shown_lights[17]==28);
    c[25]=C5_STATUS_LIGHT_MARKER;c[26]=1;c[27]=50;c[28]=128;c[29]=64;c[30]=255;
    assert(c5_validate_config(c));apply(c);c5_tick(2064);
    assert(shown_lights[15]==64&&shown_lights[16]==32&&shown_lights[17]==127);
    assert(command(6,0,NULL,0,r)==C5_OK);c5_init();c5_link(false,true);c5_tick(16);
    assert(shown_lights[15]==64&&shown_lights[16]==32&&shown_lights[17]==127);
    c5_tick(1000);assert(is_zero(shown_lights+15,3));
    c5_pairing_indicator(true,true);c5_tick(1016);assert(shown_lights[15]==0&&shown_lights[16]==0&&shown_lights[17]==24);
    c5_pairing_indicator(true,false);c5_tick(1032);assert(is_zero(shown_lights+15,3));
    c5_pairing_indicator(true,true);c5_tick(1048);assert(shown_lights[17]==24);
    c5_tick(2000);assert(shown_lights[17]==24);
    c5_pairing_indicator(true,false);c5_tick(2016);c5_pairing_indicator(true,true);c5_tick(2032);
    assert(shown_lights[17]==24); /* BOOT indication outlives normal idle timeout. */
    c5_input_encoder(-1);c5_tick(2048);assert(shown_lights[17]==24);
    c5_pairing_indicator(false,false);c5_tick(2064);assert(shown_lights[15]==64&&shown_lights[17]==127);
    c[27]=0;apply(c);c5_pairing_indicator(true,true);c5_tick(2080);assert(shown_lights[17]==24);
    c5_pairing_indicator(false,false);c[26]=0;c[27]=50;put16(c+14,0);apply(c);c5_link(true,false);c5_tick(2096);
    assert(shown_lights[15]==0&&shown_lights[16]==10&&shown_lights[17]==14);
    c5_link(false,true);c5_tick(2112);assert(shown_lights[15]==6&&shown_lights[16]==0&&shown_lights[17]==14);
    c5_link(false,false);c5_tick(2128);assert(is_zero(shown_lights,18));
    c5_tick(1000000);assert(is_zero(shown_lights,18)); /* Timeout 0 cannot defeat host loss. */
    c5_link(false,true);c5_tick(1000016);assert(shown_lights[15]==6&&shown_lights[17]==14);
    put16(c+14,1);c5_tick(0xffffff00u);apply(c);c5_tick(0xffffff10u);assert(shown_lights[15]==6);
    c5_tick(0x2e8u);assert(is_zero(shown_lights+15,3)); /* Unsigned timer wrap. */
    c[27]=101;assert(!c5_validate_config(c));c[27]=100;c[26]=2;assert(!c5_validate_config(c));
    c[26]=1;c[31]=1;assert(!c5_validate_config(c));c[31]=0;c[25]=0;assert(!c5_validate_config(c));
    puts("status lamp: independent color/brightness, legacy config, idle/wake, pairing, persistence and clock wrap passed");
}
static void test_host_power_lights(void){
    uint8_t c[1024],before[1024],r[20];c5_default_config(c);put16(c+14,0);
    c[25]=C5_STATUS_LIGHT_MARKER;c[26]=1;c[27]=100;c[28]=80;c[29]=40;c[30]=20;
    setup(c);memcpy(before,c5_config(),1024);c5_tick(16);assert(is_zero(shown_lights,18));
    c5_link(true,false);c5_tick(32);assert(shown_lights[0]>0&&shown_lights[15]==80);
    c5_link(false,false);c5_tick(48);assert(is_zero(shown_lights,18));
    c5_input_key(0,true);c5_input_encoder(1);c5_tick(64);assert(is_zero(shown_lights,18));
    c5_input_key(0,false);assert(command(9,0,NULL,0,r)==C5_OK);
    apply(c);c5_tick(80);assert(is_zero(shown_lights,18));
    /* Offline pairing only lights its status indicator, including blink off. */
    c5_pairing_indicator(true,true);c5_tick(96);assert(is_zero(shown_lights,15)&&shown_lights[17]==48);
    c5_pairing_indicator(true,false);c5_tick(112);assert(is_zero(shown_lights,18));
    c5_pairing_indicator(false,false);c5_tick(128);assert(is_zero(shown_lights,18));
    c5_link(false,true);c5_tick(144);assert(shown_lights[0]>0&&shown_lights[15]==80);
    c5_link(true,true);c5_tick(160);assert(shown_lights[0]>0);
    c5_link(false,true);c5_tick(176);assert(shown_lights[0]>0); /* Auto falls back to a live BLE host. */
    c5_link(false,false);c5_tick(192);assert(is_zero(shown_lights,18));
    assert(!memcmp(before,c5_config(),1024)&&save_calls==0);
    /* Reconnection wakes after idle; an inactive second link does not. */
    put16(c+14,1);apply(c);c5_link(true,false);c5_tick(208);
    c5_tick(1192);assert(is_zero(shown_lights,18));
    c5_link(true,true);c5_tick(1208);assert(is_zero(shown_lights,18));
    c5_link(false,false);c5_tick(1224);c5_link(true,false);c5_tick(1240);
    assert(shown_lights[0]>0&&shown_lights[15]==80);
    c[6]=1;apply(c);c5_link(false,true);c5_tick(1256);assert(is_zero(shown_lights,18));
    c[6]=2;apply(c);c5_link(true,false);c5_tick(1272);assert(is_zero(shown_lights,18));
#ifdef C5_WINDOWS_FEATURES
    c[6]=0;apply(c);c5_link(true,false);c5_features_link_source(1,true);
    uint8_t control=0,range[9]={1,0,0,4,0,11,22,33,255};
    assert(c5_features_set(3,C5_LAMP_CONTROL_ID,&control,1));
    assert(c5_features_set(3,C5_LAMP_RANGE_ID,range,9));
    c5_tick(1288);assert(shown_lights[0]==11&&shown_lights[2]==33);
    c5_tick(2272);assert(is_zero(shown_lights,18)); /* Windows colors obey idle too. */
    c5_input_encoder(1);c5_tick(2288);assert(shown_lights[0]==11);
    /* Even a stale feature-link notification cannot override core host loss. */
    c5_link(false,false);c5_tick(2304);assert(is_zero(shown_lights,18));
    c5_features_link_source(1,false);c5_link(true,false);c5_features_link_source(1,true);
    c5_tick(2320);assert(shown_lights[0]>0&&shown_lights[0]!=11);
#endif
    puts("host power lights: USB/BLE loss, timeout 0, offline input/config, pairing, route preference, reconnect and LampArray gating passed");
}
#ifdef C5_REPORT_RATES
static uint8_t rate_command(uint8_t source,uint8_t op,uint16_t offset,uint8_t count){
    uint8_t q[20]={0xc5,1,op,1,0},r[20];put16(q+6,offset);if(op==2){q[4]=1;q[8]=count;}
    c5_config_frame_transport(source,q,r);return r[5];
}
static void rate_read_all(uint8_t source){
    for(unsigned off=0;off<1024;off+=12)assert(rate_command(source,2,(uint16_t)off,(uint8_t)(1024-off<12?1024-off:12))==0);
}
static void test_rate_reconfigure_gate(void){
    uint8_t c[1024];setup(NULL);assert(rate_command(1,11,0,0)==C5_ERR_BUSY&&reconfigure_calls==0);
    assert(rate_command(1,6,0,0)==0);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    rate_read_all(2);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    assert(rate_command(1,2,12,12)==0);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    rate_read_all(1);assert(rate_command(2,11,0,0)==C5_ERR_BUSY);assert(rate_command(1,11,0,0)==0&&reconfigure_calls==1&&reconfigure_source==1);
    assert(rate_command(1,11,0,0)==C5_ERR_BUSY&&reconfigure_calls==1);
    assert(rate_command(1,6,0,0)==0);rate_read_all(1);c5_config_transport_lost(1);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    assert(rate_command(2,6,0,0)==0);rate_read_all(2);save_ok=false;assert(rate_command(2,6,0,0)==C5_ERR_IO);assert(rate_command(2,11,0,0)==C5_ERR_BUSY);save_ok=true;
    assert(rate_command(2,6,0,0)==0);rate_read_all(2);reconfigure_ok=false;assert(rate_command(2,11,0,0)==C5_ERR_IO&&reconfigure_calls==2);
    assert(rate_command(2,11,0,0)==C5_ERR_BUSY);reconfigure_ok=true;
    c5_default_config(c);set_binding(bind(c,0),5,0,1);apply(c);c5_link(true,false);
    assert(rate_command(1,6,0,0)==0);rate_read_all(1);c5_input_key(0,true);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    assert(rate_command(1,6,0,0)==0);rate_read_all(1);apply(c);assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
    assert(rate_command(1,6,0,0)==0);rate_read_all(1);begin(c,c5_crc32(c,1024));assert(rate_command(1,11,0,0)==C5_ERR_BUSY);
}
#endif
int main(void){
    test_defaults_and_protocol();test_transaction_integrity();test_multikey_and_release();
    test_backpressure_never_sticks();test_switch_and_quarantine();test_macro_pause_preserves_physical();
    test_macro_backpressure_and_rollover();test_encoder_modes();test_rotary_backlog();test_slow_scroll_edges();test_layer_fn_and_rgb();test_transaction_ownership_and_lease();test_inactive_transport_does_not_block();
    test_mouse_multikey_and_encoder();test_mouse_macro_merges_physical();test_mouse_backpressure_never_sticks();
    test_macro_hold_and_toggle();test_macro_loops_stop_on_changes();test_new_config_validation();test_status_light_idle_and_settings();test_host_power_lights();
#ifdef C5_BOARD_DIAGNOSTICS
    {
        uint8_t r[20],before[1024],p=1;setup(NULL);memcpy(before,c5_config(),1024);diagnostic_calls=0;
        assert(command(12,0,&p,1,r)==C5_ERR_FRAME&&diagnostic_calls==0);
        assert(command(12,0,NULL,0,r)==C5_OK&&r[4]==12&&diagnostic_calls==1);
        for(unsigned i=0;i<12;++i)assert(r[8+i]==i+1);
        assert(command(13,0,&p,1,r)==C5_ERR_FRAME&&diagnostic_calls==1);
        assert(command(13,0,NULL,0,r)==C5_OK&&r[4]==12&&diagnostic_calls==2);
        for(unsigned i=0;i<12;++i)assert(r[8+i]==i+32);
        assert(!memcmp(before,c5_config(),1024)&&save_calls==0&&haptic_calls==0&&light_calls==0);
        puts("board diagnostics: capability, full payload, malformed request and read-only behavior passed");
    }
#endif
#ifdef C5_REPORT_RATES
    test_rate_reconfigure_gate();puts("core: 20 suites passed (including rotary backlog, host power lights and rate reconfiguration gates)");
#else
    puts("core: 19 suites passed (including rotary backlog and host power lights)");
#endif
    return 0;
}
