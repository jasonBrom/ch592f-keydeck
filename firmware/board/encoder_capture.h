#ifndef C5_ENCODER_CAPTURE_H
#define C5_ENCODER_CAPTURE_H
#include <stdint.h>
#include <stdbool.h>
#define C5_ENCODER_CAPTURE_SIZE 32u
/* Single GPIO-ISR producer and main-loop consumer. Every shared byte is
 * volatile; publish the write index only after storing the sampled state. */
typedef struct {
    volatile uint8_t ab[C5_ENCODER_CAPTURE_SIZE],read,write,overflow;
} c5_encoder_capture;
static inline void c5_encoder_capture_push(c5_encoder_capture *q,uint8_t ab){
    uint8_t next=(uint8_t)((q->write+1u)&(C5_ENCODER_CAPTURE_SIZE-1u));
    if(next==q->read){q->overflow=1;return;}
    q->ab[q->write]=ab;q->write=next;
}
static inline bool c5_encoder_capture_pop(c5_encoder_capture *q,uint8_t *ab){
    if(q->read==q->write)return false;
    *ab=q->ab[q->read];q->read=(uint8_t)((q->read+1u)&(C5_ENCODER_CAPTURE_SIZE-1u));return true;
}
#endif
