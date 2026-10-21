#ifndef C5_ENCODER_H
#define C5_ENCODER_H
#include <stdint.h>

/* AB bit 0 is PA8/A, bit 1 is PA9/B. Positive means clockwise.
 * No assumption about mechanical detents: four edges are one electrical
 * pulse. Full-pulse mode accepts only complete Gray cycles starting at 00. */
typedef struct {
    uint8_t previous, resolution, synchronized;
    int8_t edges;
} c5_encoder;

static inline uint8_t c5_encoder_resolution(uint8_t edges)
{ return edges >= 1 && edges <= 4 ? edges : 4; }

/* Scroll uses a half-cycle at the usual 3/4-edge setting, so small slow
 * movements need not complete an entire pulse. Explicit 1/2-edge choices and
 * all other modes retain their resolution. No velocity threshold or timeout. */
static inline uint8_t c5_encoder_mode_resolution(uint8_t mode,uint8_t edges)
{
    uint8_t resolution=c5_encoder_resolution(edges);
#ifdef C5_SMOOTH_RADIAL
    if(mode==0)return 1;
#endif
    return mode==2 && resolution>2 ? 2 : resolution;
}

static inline void c5_encoder_reset(c5_encoder *encoder, uint8_t ab, uint8_t edges)
{
    encoder->previous = ab & 3;
    encoder->resolution = c5_encoder_resolution(edges);
    encoder->synchronized = encoder->previous == 0;
    encoder->edges = 0;
}

static inline int8_t c5_encoder_sample(c5_encoder *encoder, uint8_t ab, uint8_t edges)
{
    static const int8_t direction[16] = {
        0,1,-1,0, -1,0,0,1, 1,0,0,-1, 0,-1,1,0
    };
    ab &= 3;
    if (encoder->resolution != c5_encoder_resolution(edges)) {
        c5_encoder_reset(encoder, ab, edges);
        return 0;
    }
    uint8_t previous = encoder->previous;
    encoder->previous = ab;
    if ((previous ^ ab) == 3) {
        /* Both channels changing at once gives no direction. Start a fresh
         * cycle instead of attaching the next edge to a corrupt partial. */
        encoder->edges = 0;
        encoder->synchronized = ab == 0;
        return 0;
    }
    if (encoder->resolution == 4 && !encoder->synchronized) {
        if (ab == 0) encoder->synchronized = 1;
        encoder->edges = 0;
        return 0;
    }
    encoder->edges += direction[(previous << 2) | ab];
    if (encoder->resolution == 4 && ab != 0) return 0;
    int8_t result = 0;
    if (encoder->edges >= (int8_t)encoder->resolution) {
        encoder->edges -= encoder->resolution;
        result = 1;
    } else if (encoder->edges <= -(int8_t)encoder->resolution) {
        encoder->edges += encoder->resolution;
        result = -1;
    }
    if (encoder->resolution == 4) encoder->edges = 0;
    return result;
}
#endif
