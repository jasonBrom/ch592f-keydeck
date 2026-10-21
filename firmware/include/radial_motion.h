#ifndef C5_RADIAL_MOTION_H
#define C5_RADIAL_MOTION_H
#include <stdint.h>
#include <stdbool.h>
/* One report per captured edge, one local haptic per configured physical
 * interval. Remainders preserve fractional tenths across reversals. */
typedef struct {int16_t remainder;int8_t haptic_edges;} c5_radial_motion;
static inline int16_t c5_radial_advance(c5_radial_motion *s,int direction,uint16_t angle,uint8_t edges,bool *feedback){
    int value=s->remainder+direction*(int)angle;
    int16_t report=(int16_t)(value/edges);
    s->remainder=(int16_t)(value%edges);
    s->haptic_edges+=(int8_t)direction;
    *feedback=false;
    if(s->haptic_edges>=(int8_t)edges){s->haptic_edges-=(int8_t)edges;*feedback=true;}
    else if(s->haptic_edges<=-(int8_t)edges){s->haptic_edges+=(int8_t)edges;*feedback=true;}
    return report;
}
#endif
