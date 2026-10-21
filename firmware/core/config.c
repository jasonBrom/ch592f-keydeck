#include "c5.h"
#include "haptic.h"
#include "haptic_tuning.h"
#include "layer_settings.h"
#include <string.h>
static uint16_t u16(const uint8_t *p) { return (uint16_t)(p[0] | ((uint16_t)p[1]<<8)); }
static void p16(uint8_t *p,uint16_t x) { p[0]=(uint8_t)x;p[1]=(uint8_t)(x>>8); }
uint32_t c5_crc32(const uint8_t *data,size_t n) {
    uint32_t c=0xffffffffu;
    while(n--) { c^=*data++;for(unsigned i=0;i<8;i++)c=(c>>1)^((c&1)?0xedb88320u:0u); }
    return c^0xffffffffu;
}
static bool zeros(const uint8_t *p,size_t n) { while(n--)if(*p++)return false;return true; }
void c5_tuning_defaults(uint8_t p[8]) {
    const uint8_t d[8]={0xc1,0x78,0x6b,0x11,90,66,3,24};
    memcpy(p,d,8);
}
bool c5_tuning_empty(const uint8_t p[8]) { return zeros(p,8); }
uint8_t c5_tuning_rated_code(const uint8_t p[8]) {
    /* TI 8.5.2.1: use 180Hz, the supplier tolerance's worst case, for the
     * voltage bound. Recompute whenever SAMPLE_TIME or rated voltage changes.
     * Integer inequality avoids floating-point rounding above the limit. */
    uint32_t sample=150u+50u*((p[2]>>5)&3u);
    uint64_t v=(uint32_t)p[4]*1000u;
    uint64_t limit=v*v*(1000000u-(4u*sample+300u)*180u);
    uint8_t code=0;
    while(code<255) {
        uint64_t next=(uint32_t)(code+1u)*2058u;
        if(next*next*1000000u>limit)break;
        ++code;
    }
    return code;
}
bool c5_tuning_valid(const uint8_t p[8]) {
    if(zeros(p,8))return true;
    uint8_t drive=p[1]&31u;
    if(p[0]!=0xc1||drive<23||drive>26||(p[2]&0x80)||
       p[4]<10||p[4]>90||p[5]<7||p[5]>66||(p[6]&0xf0)||p[7]<4||p[7]>120)return false;
    uint32_t peak=(uint32_t)p[5]*2122u,rated=(uint32_t)p[4]*1000u;
    return (uint64_t)peak*peak>=2u*(uint64_t)rated*rated;
}
static bool status_light(const uint8_t *p) {
    return zeros(p,7)||(p[0]==C5_STATUS_LIGHT_MARKER&&p[1]<=1&&p[2]<=100&&p[6]==0);
}
bool c5_validate_haptic(const uint8_t h[C5_HAPTIC_SIZE]) {
    if(zeros(h,C5_HAPTIC_SIZE))return true;
    if(memcmp(h,"HP1",3)||h[3]>1||h[4]>1||h[5]<1||h[5]>8||h[6]<1||h[6]>16||
       u16(h+69)<20||u16(h+69)>500||((int8_t)h[71]) < -20||((int8_t)h[71])>20||
       h[72]<1||h[72]>150||!c5_tuning_valid(h+73))return false;
    for(unsigned i=0;i<8;i++){
        uint8_t id=h[7+i];
        if(i>=h[5]){if(id)return false;}
        else if(!id||id==128||(id<128&&id>123))return false;
    }
    uint32_t duration=0;
    for(unsigned i=0;i<16;i++){
        const uint8_t *s=h+15+i*3;
        if(i>=h[6]){if(!zeros(s,3))return false;}
        else {if(s[0]>100||u16(s+1)<4||u16(s+1)>5000)return false;duration+=u16(s+1);}
    }
    if(duration>5000)return false;
    for(unsigned i=0;i<6;i++)if(h[63+i]>126)return false;
    return true;
}
static bool binding(const uint8_t *p) {
    uint16_t v=u16(p+2);
    switch(p[0]) {
    case 0:return p[1]==0 && v==0;
    case 1:return v<=0xe7;
    case 2:return p[1]==0;
    case 3:return p[1]==0 && (int16_t)v>=-127 && (int16_t)v<=127;
    case 4:return p[1]==0 && v<C5_MACRO_COUNT;
    case 5:return p[1]==0 && v<C5_PROFILE_COUNT;
    case 6:return p[1]==0 && v>=1 && v<=31;
    case 7:return p[1]==0 && v==0;
    default:return false;
    }
}
bool c5_validate_config(const uint8_t c[C5_CONFIG_SIZE]) {
    if(memcmp(c,"C5CF",4)||c[4]!=1||c[5]>2||c[6]>2||c[7]>3||c[8]>100||
       c[9]>4||c[10]>100||c[11]<1||c[11]>4||u16(c+12)<1||u16(c+12)>3600||
       u16(c+14)>3600||c[19]>4||c[24]>3||!status_light(c+C5_STATUS_LIGHT_OFFSET)||!c5_validate_haptic(c+943))return false;
    /* Calibration is deliberately bounded to prevent overflow/bogus voltages. */
    uint32_t scale=(uint32_t)c[20]|((uint32_t)c[21]<<8)|((uint32_t)c[22]<<16)|((uint32_t)c[23]<<24);
    if(scale<500000u||scale>1500000u)return false;
    bool empty_layer=true;for(unsigned i=0;i<16;i++)if(c5_layer_byte(c,i))empty_layer=false;
    if(!empty_layer){
        if(c5_layer_byte(c,0)!=0xd3||(c5_layer_byte(c,1)&~3u)||c5_layer_byte(c,11)>5||c5_layer_byte(c,15))return false;
        if(c5_layer_flags(c)&2u){
            uint8_t prefix=(uint8_t)(1u<<c5_layer_byte(c,11));
            for(unsigned p=0;p<3;p++){
                uint8_t chord=c5_layer_byte(c,12+p);
                if(c[32+4*(8*p+c5_layer_byte(c,11))]!=C5_ACTION_FN)return false;
                if(chord&&((chord&~63u)||!(chord&prefix)||chord==prefix))return false;
                for(unsigned q=0;q<p;q++){uint8_t prior=c5_layer_byte(c,12+q);if(chord&&prior&&((chord&prior)==chord||(chord&prior)==prior))return false;}
            }
        }
    }
    for(unsigned i=0;i<24;i++)if(!binding(c+32+4*i)||((i%8)>=6&&c[32+4*i]==C5_ACTION_FN))return false;
    for(unsigned i=0;i<8;i++) {
        const uint8_t *m=c+128+100*i;
        if(m[0]>16||m[1]>2)return false;
        for(unsigned s=0;s<16;s++) {
            const uint8_t *p=m+4+6*s;uint16_t v=u16(p+2);
            if(s>=m[0]) { if(!zeros(p,6))return false;continue; }
            if(p[0]>6||u16(p+4)>10000)return false;
            if(p[0]==0 && (p[1]||v))return false;
            if((p[0]==1||p[0]==2)&&v>0xe7)return false;
            if(p[0]>=3&&p[1])return false;
            if(p[0]==4&&((int16_t)v < -127||(int16_t)v>127))return false;
            if(p[0]>=5&&(v<1||v>31))return false;
        }
    }
    return true;
}
void c5_default_config(uint8_t c[C5_CONFIG_SIZE]) {
    memset(c,0,C5_CONFIG_SIZE);memcpy(c,"C5CF",4);c[4]=1;c[8]=30;c[9]=1;c[10]=85;c[11]=4;
    p16(c+12,180);p16(c+14,300);c[16]=22;c[17]=138;c[18]=176;
    c[20]=0x40;c[21]=0x42;c[22]=0x0f;
    /* Ctrl+C, Ctrl+V, Ctrl+Z, Space and Enter, on all three editable profiles. */
    const uint8_t keys[5]={6,25,29,44,40};
    for(unsigned p=0;p<3;p++) {
        for(unsigned k=0;k<5;k++) { uint8_t *b=c+32+(8*p+k)*4;b[0]=1;b[1]=k<3?1:0;p16(b+2,keys[k]); }
        uint8_t *ccw=c+32+(8*p+6)*4;ccw[0]=3;p16(ccw+2,(uint16_t)-1);
        uint8_t *cw=ccw+4;cw[0]=3;p16(cw+2,1);
    }
    for(unsigned k=0;k<5;k++)memcpy(c+928+3*k,c+16,3);
}
