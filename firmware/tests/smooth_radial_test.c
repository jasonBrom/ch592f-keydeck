/* Exercise the real production core/feature boundary with the fine-angle flag. */
#define main original_core_regressions_main
#include "core_test.c"
#undef main
#include "radial_motion.h"
static int angle_sum(unsigned route){
    int sum=0;for(unsigned i=0;i<log_count;i++)if(log_reports[i].id==3&&log_reports[i].route==route){
        const uint8_t *p=log_reports[i].data;sum+=(int16_t)(p[1]|((uint16_t)p[2]<<8));
    }return sum;
}
int main(void){
    uint8_t c[1024];c5_default_config(c);c[7]=0;c[11]=4;put16(c+12,100);
    for(unsigned transport=1;transport<=2;transport++){
        setup(c);c5_link(transport==1,transport==2);log_count=haptic_calls=0;
        for(unsigned i=1;i<=4;i++){
            c5_input_encoder(1);c5_tick(i*1000);
            assert(angle_sum(transport)==(int)(i*25));assert(id_count(3)==i);
            assert(haptic_calls==(i==4)); /* fine input without extra local clicks */
        }
        log_count=haptic_calls=0;
        for(unsigned i=1;i<=3;i++){c5_input_encoder(1);c5_tick(5000+i*1000);}
        for(unsigned i=1;i<=3;i++){c5_input_encoder(-1);c5_tick(9000+i*1000);}
        assert(angle_sum(transport)==0&&haptic_calls==0);
        blocked[transport]=true;log_count=haptic_calls=0;
        for(unsigned i=1;i<=80;i++){c5_input_encoder(1);c5_tick(13000+i*1000);}
        assert(log_count==0&&haptic_calls==20);blocked[transport]=false;c5_tick(94000);
        assert(angle_sum(transport)==2000&&id_count(3)==1);
        /* Apply/switch boundaries discard the old fractional/haptic remainder. */
        c5_input_encoder(1);c5_tick(95000);apply(c);log_count=haptic_calls=0;
        c5_input_encoder(1);c5_tick(96000);assert(angle_sum(transport)==25&&haptic_calls==0);
    }
    c5_radial_motion state={0};bool feedback;int sum=0;
    for(unsigned i=0;i<4;i++){sum+=c5_radial_advance(&state,1,7,4,&feedback);assert(feedback==(i==3));}
    assert(sum==7&&!state.remainder);
    for(unsigned i=0;i<4;i++)sum+=c5_radial_advance(&state,-1,7,4,&feedback);
    assert(sum==0&&!state.remainder&&!state.haptic_edges);
    state=(c5_radial_motion){0};sum=0;
    for(unsigned i=0;i<1000;i++){sum+=c5_radial_advance(&state,1,1,4,&feedback);sum+=c5_radial_advance(&state,-1,1,4,&feedback);}
    assert(sum==0&&!state.remainder&&!state.haptic_edges);
    puts("smooth native Dial: USB/BLE per-edge angles, unchanged physical haptic spacing, fractions, reversals, congestion and apply reset passed");
}
