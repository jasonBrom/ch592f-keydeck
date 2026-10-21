#include <assert.h>
#include <stdio.h>
#include "encoder.h"

static int sample(c5_encoder *encoder, uint8_t ab)
{ return c5_encoder_sample(encoder, ab, encoder->resolution); }

static int cycle(c5_encoder *encoder, int clockwise)
{
    const uint8_t cw[] = {1,3,2,0}, ccw[] = {2,3,1,0};
    const uint8_t *states = clockwise ? cw : ccw;
    int total = 0;
    for (unsigned i = 0; i < 4; ++i) total += sample(encoder, states[i]);
    return total;
}

int main(void)
{
    c5_encoder encoder;
    c5_encoder_reset(&encoder, 0, 4);
    /* Continuous encoders can stop in any AB state. No detent timeout, speed
     * lockout, or rest-at-11 assumption is allowed to discard valid motion. */
    for (unsigned i = 0; i < 10000; ++i) {
        assert(cycle(&encoder, 1) == 1);
        assert(cycle(&encoder, 0) == -1);
    }
    for (uint8_t start = 0; start < 4; ++start) {
        c5_encoder_reset(&encoder, start, 4);
        /* Booting between pulse boundaries drops only the initial partial. */
        const uint8_t sequence[] = {1,3,2,0};
        unsigned index = start == 0 ? 0 : start == 1 ? 1 : start == 3 ? 2 : 3;
        for (; index < 4; ++index)
            assert(sample(&encoder, sequence[index]) == (start == 0 && index == 3));
        assert(cycle(&encoder, 1) == 1);
    }
    /* Repeat and bounce each individual contact before accepting its edge.
     * Back-and-forth reversals must neither overcount nor briefly reverse. */
    const uint8_t cw[] = {0,1,3,2,0}, ccw[] = {0,2,3,1,0};
    for (unsigned direction = 0; direction < 2; ++direction) {
        const uint8_t *states = direction ? cw : ccw;
        c5_encoder_reset(&encoder, 0, 4);
        for (unsigned pulse = 0; pulse < 2000; ++pulse) {
            for (unsigned edge = 1; edge <= 4; ++edge) {
                assert(sample(&encoder, states[edge-1]) == 0);
                /* Bounce the outgoing contact; the final boundary is accepted
                 * just once, even if it is immediately crossed again. */
                int first = sample(&encoder, states[edge]);
                assert(first == (edge == 4 ? (direction ? 1 : -1) : 0));
                assert(sample(&encoder, states[edge-1]) == 0);
                assert(sample(&encoder, states[edge]) == 0);
            }
        }
    }
    c5_encoder_reset(&encoder, 0, 4);
    const uint8_t rollback[] = {1,3,1,0,2,3,2,0};
    for (unsigned i = 0; i < sizeof rollback; ++i) assert(sample(&encoder, rollback[i]) == 0);
    assert(cycle(&encoder, 1) == 1);
    /* Lost/two-bit edges are ambiguous. Reject the incomplete pulse, acquire
     * a known cycle boundary, then count the next full pulse in either direction. */
    const uint8_t corrupt[] = {1,2,3,1,0,3,2,0};
    for (unsigned i = 0; i < sizeof corrupt; ++i) assert(sample(&encoder, corrupt[i]) == 0);
    assert(cycle(&encoder, 0) == -1);
    for (uint8_t resolution = 1; resolution <= 4; ++resolution) {
        c5_encoder_reset(&encoder, 0, resolution);
        int count = 0;
        for (unsigned i = 0; i < 30; ++i) count += cycle(&encoder, 1);
        assert(count == 120 / resolution);
    }
    c5_encoder_reset(&encoder, 0, 4);
    assert(sample(&encoder, 1) == 0);
    assert(c5_encoder_sample(&encoder, 3, 2) == 0); /* clear old partial */
    assert(sample(&encoder, 2) == 0);
    assert(sample(&encoder, 0) == 1);
    c5_encoder_reset(&encoder, 0, 255);
    assert(encoder.resolution == 4 && cycle(&encoder, 1) == 1);
    for(uint8_t mode=0;mode<4;mode++)for(uint8_t edges=1;edges<=4;edges++)
        assert(c5_encoder_mode_resolution(mode,edges)==(mode==2&&edges>2?2:edges));
    c5_encoder_reset(&encoder,0,c5_encoder_mode_resolution(2,4));
    assert(sample(&encoder,1)==0);for(unsigned i=0;i<100000;i++)assert(sample(&encoder,1)==0);
    assert(sample(&encoder,3)==1);assert(sample(&encoder,2)==0);assert(sample(&encoder,0)==1);
    puts("encoder: CW/CCW, continuous arbitrary stops, bounce, rollbacks, corrupt edges, resolution changes and 10000 reversals passed");
}
