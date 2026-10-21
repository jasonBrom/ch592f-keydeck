/* Independent native boundary harness. JS sends the actual serialized wire frame;
 * the production C core produces replies. No schema/protocol implementation here. */
#include "c5.h"
#include "haptic.h"
#include "motor_sound.h"
#include "haptic_tuning.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static uint8_t saved[C5_CONFIG_SIZE],reports[4096][11];
static unsigned report_count;
static uint8_t shown_lights[18];
static bool saved_valid,save_allowed=true,blocked[3];
#ifdef C5_HAPTIC_CALIBRATION
/* Protocol boundary model only; real register/rollback behavior is tested in
 * board/tests/test_haptic.c against the production driver. */
static uint8_t mock_tuning[8],mock_generation,mock_result=2;
static bool mock_calibration_busy;
bool c5_hal_haptic_calibrating(void){return mock_calibration_busy;}
bool c5_hal_haptic_configure(const uint8_t p[8]){
    if(!c5_tuning_valid(p))return false;
    if(c5_tuning_empty(p))c5_tuning_defaults(mock_tuning);else memcpy(mock_tuning,p,8);
    return true;
}
bool c5_hal_haptic_tuning_matches(const uint8_t p[8]){
    uint8_t n[8];if(c5_tuning_empty(p))c5_tuning_defaults(n);else memcpy(n,p,8);
    return !mock_calibration_busy&&!memcmp(n,mock_tuning,8);
}
uint8_t c5_hal_haptic_calibration(uint8_t action,const uint8_t *p){
    if(action==0){if(!c5_tuning_valid(p)||c5_tuning_empty(p))return C5_ERR_RANGE;memcpy(mock_tuning,p,8);}
    mock_calibration_busy=false;mock_result=action==2?5:2;++mock_generation;return C5_OK;
}
bool c5_hal_haptic_calibration_status(uint8_t page,uint8_t out[12]){
    memset(out,0,12);if(page>2)return false;
    if(page==0){out[0]=1;out[1]=mock_calibration_busy?2:3;out[3]=0xe0;out[4]=1;out[5]=mock_result;out[6]=mock_generation;out[7]=mock_calibration_busy?4:0;out[8]=0x51;out[9]=0x67;out[10]=3;out[11]=mock_tuning[7];}
    else if(page==1){out[0]=mock_generation;out[1]=c5_tuning_rated_code(mock_tuning);out[2]=mock_tuning[5];out[3]=0xb7;out[4]=0x98;out[5]=0x75;out[6]=0x88;out[7]=0x30;out[8]=0x80;out[9]=60;}
    else {out[0]=mock_generation;memcpy(out+1,mock_tuning,8);}
    return true;
}
#endif
#ifdef C5_REPORT_RATES
static bool reconfigure_allowed=true;static unsigned reconfigure_count;static uint8_t reconfigure_source;
void c5_hal_rate_status(uint8_t *usb_ms,uint16_t *ble_units){*usb_ms=2;*ble_units=24;}
bool c5_hal_reconfigure(uint8_t source){reconfigure_count++;reconfigure_source=source;return reconfigure_allowed;}
#endif
bool c5_hal_report(uint8_t t,uint8_t id,const uint8_t *p,uint8_t n){
    if(t>2||blocked[t])return false;
    if(n>8||report_count>=4096)abort();
    uint8_t *r=reports[report_count++];r[0]=t;r[1]=id;r[2]=n;memcpy(r+3,p,n);return true;
}
bool c5_hal_load(uint8_t out[C5_CONFIG_SIZE]){if(saved_valid)memcpy(out,saved,C5_CONFIG_SIZE);return saved_valid;}
bool c5_hal_save(const uint8_t in[C5_CONFIG_SIZE]){if(!save_allowed)return false;memcpy(saved,in,C5_CONFIG_SIZE);saved_valid=true;return true;}
#ifdef C5_MOTOR_SOUND
static bool sound_busy;static unsigned sound_calls;static uint8_t sound_period,sound_gain;static uint16_t sound_duration;
bool c5_hal_motor_sound(uint8_t p,uint8_t g,uint16_t d){sound_calls++;sound_period=p;sound_gain=g;sound_duration=d;sound_busy=g!=0;return true;}
bool c5_hal_motor_diagnostics(uint8_t out[12]){memset(out,0,12);out[0]=3;out[3]=5;out[7]=0x88;return true;}
#endif
bool c5_hal_haptic(uint8_t s){(void)s;
#ifdef C5_MOTOR_SOUND
    sound_busy=false;
#endif
    return true;}
#ifdef C5_ADVANCED_HAPTICS
bool c5_hal_haptic_busy(void){
#ifdef C5_MOTOR_SOUND
    return sound_busy;
#else
    return false;
#endif
}
bool c5_hal_haptic_sequence(const uint8_t *p,uint8_t n,int8_t s,uint16_t t){(void)p;(void)n;(void)s;(void)t;return true;}
bool c5_hal_haptic_envelope(const uint8_t *p,uint8_t n,uint8_t g,uint16_t t){(void)p;(void)n;(void)g;(void)t;return true;}
#endif
void c5_hal_lights(const uint8_t a[15],const uint8_t b[3]){memcpy(shown_lights,a,15);memcpy(shown_lights+15,b,3);}
void c5_hal_status(uint8_t *f,uint8_t *p,uint16_t *mv){*f|=4;*p=67;*mv=3921;}
static size_t unhex(const char *s,uint8_t *out,size_t cap){size_t n=0;unsigned x;while(s[0]&&s[0]!='\n'&&s[1]&&s[1]!='\n'){if(n==cap||sscanf(s,"%2x",&x)!=1)abort();out[n++]=(uint8_t)x;s+=2;}return n;}
static void hex(const uint8_t *p,size_t n){for(size_t i=0;i<n;i++)printf("%02x",p[i]);puts("");}
int main(void){char line[4096];c5_init();while(fgets(line,sizeof(line),stdin)){
    uint8_t bytes[C5_CONFIG_SIZE],out[C5_FRAME_SIZE];unsigned a,b;
    switch(line[0]){
    case 'F':case 'G':if(unhex(line+2,bytes,sizeof(bytes))!=C5_FRAME_SIZE)abort();c5_config_frame_transport(line[0]=='F'?1:2,bytes,out);hex(out,C5_FRAME_SIZE);break;
    case 'U':if(sscanf(line+2,"%u",&a)!=1)abort();c5_config_transport_lost((uint8_t)a);puts("OK");break;
    case 'D':c5_default_config(bytes);hex(bytes,C5_CONFIG_SIZE);break;
    case 'V':if(unhex(line+2,bytes,sizeof(bytes))!=C5_CONFIG_SIZE)abort();printf("%u\n",c5_validate_config(bytes));break;
    case 'C':{size_t n=unhex(line+2,bytes,sizeof(bytes));printf("%08x\n",c5_crc32(bytes,n));break;}
    case 'L':if(sscanf(line+2,"%u %u",&a,&b)!=2)abort();c5_link(a!=0,b!=0);puts("OK");break;
    case 'K':if(sscanf(line+2,"%u %u",&a,&b)!=2)abort();c5_input_key((uint8_t)a,b!=0);puts("OK");break;
    case 'E':{int d;if(sscanf(line+2,"%d",&d)!=1)abort();c5_input_encoder((int16_t)d);puts("OK");break;}
    case 'T':if(sscanf(line+2,"%u",&a)!=1)abort();c5_tick(a);puts("OK");break;
    case 'J':if(sscanf(line+2,"%u %u",&a,&b)!=2)abort();c5_pairing_indicator(a!=0,b!=0);puts("OK");break;
    case 'O':hex(shown_lights,18);break;
#ifdef C5_HAPTIC_CALIBRATION
    case 'Z':if(sscanf(line+2,"%u",&a)!=1)abort();mock_calibration_busy=a!=0;puts("OK");break;
#endif
#ifdef C5_MOTOR_SOUND
    case 'Y':printf("[%u,%u,%u,%u,%u]\n",sound_busy,sound_calls,sound_period,sound_gain,sound_duration);break;
#endif
    case 'B':if(sscanf(line+2,"%u %u",&a,&b)!=2||a>2)abort();blocked[a]=b!=0;puts("OK");break;
    case 'S':if(sscanf(line+2,"%u",&a)!=1)abort();save_allowed=a!=0;puts("OK");break;
#ifdef C5_REPORT_RATES
    case 'P':if(sscanf(line+2,"%u",&a)!=1)abort();reconfigure_allowed=a!=0;puts("OK");break;
    case 'Q':printf("[%u,%u]\n",reconfigure_count,reconfigure_source);break;
#endif
    case 'I':c5_init();puts("OK");break;
    case 'X':report_count=0;memset(reports,0,sizeof(reports));puts("OK");break;
    case 'R':printf("[");for(unsigned i=0;i<report_count;i++){if(i)printf(",");printf("[");for(unsigned j=0;j<11;j++)printf("%s%u",j?",":"",reports[i][j]);printf("]");}puts("]");break;
    default:abort();
    }fflush(stdout);
}return 0;}
