#ifndef C5_RELATIVE_REPORT_H
#define C5_RELATIVE_REPORT_H
#include <stdint.h>
#include <stdbool.h>
/* Coalesce only adjacent same-direction relative motion with identical held
 * buttons. Never merge a neutral/button transition or a direction reversal. */
static inline bool c5_relative_merge(uint8_t id,uint8_t *tail,const uint8_t *next,uint8_t len){
    int a,b,total;
    if(id==3&&len==3&&tail[0]==next[0]){
        a=(int16_t)((uint16_t)tail[1]|((uint16_t)tail[2]<<8));
        b=(int16_t)((uint16_t)next[1]|((uint16_t)next[2]<<8));
        total=a+b;
        if(!a||!b||(a>0)!=(b>0)||total < -3600||total>3600)return false;
        tail[1]=(uint8_t)total;tail[2]=(uint8_t)((uint16_t)total>>8);return true;
    }
    if(id==4&&len==4&&tail[0]==next[0]&&!tail[1]&&!tail[2]&&!next[1]&&!next[2]){
        a=(int8_t)tail[3];b=(int8_t)next[3];total=a+b;
        if(!a||!b||(a>0)!=(b>0)||total < -127||total>127)return false;
        tail[3]=(uint8_t)total;return true;
    }
    return false;
}
#endif
