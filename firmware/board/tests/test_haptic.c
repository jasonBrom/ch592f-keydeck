#include <assert.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
static uint32_t gpio;
#define GPIO_Pin_14 (1u<<14)
#define GPIO_Pin_15 (1u<<15)
#define FREQ_SYS 60000000u
#define R32_PB_CLR gpio
#define R32_PB_DIR gpio
#define GPIO_ModeIN_Floating 0
#define GPIOB_ModeCfg(p,m) ((void)(p),(void)(m))
#define GPIOB_ReadPortPin(p) (p)
#define C5_HAPTIC_REGISTER_TEST
#include "../../board/drv2605.c"
static uint8_t registers[256];
static bool io=true;
static uint32_t ticks;
static bool calibrated;
uint32_t board_time_ticks(void){return ticks++;}
uint32_t board_elapsed_ticks(uint32_t start){return ticks++-start;}
void board_delay_us(uint32_t us){(void)us;}
static void motor_limits(void){
    /* Independent electrical limits from the supplier's 0.9Vrms/170+/-10Hz
     * specification. Check the whole frequency tolerance, not copied bytes. */
    double rated_code=registers[0x16]*0.02058;
    for(unsigned hz=160;hz<=180;hz++){
        double sample=(150.0+50.0*((registers[0x1c]>>4)&3))/1000000.0;
        double sense_window=1.0-(4*sample+0.0003)*hz;
        assert(rated_code*rated_code<=0.9*0.9*sense_window);
        #ifndef C5_HAPTIC_CALIBRATION
        assert(rated_code*rated_code>=0.85*0.85*sense_window);
#endif
    }
    double peak=registers[0x17]*0.02122;
    assert(peak*peak<=2.0*1.0*1.0); /* 1.0Vrms sine maximum */
    #ifndef C5_HAPTIC_CALIBRATION
    assert(peak*peak>=2.0*0.9*0.9);
#endif /* modest startup/braking headroom */
    double half_period_ms=(registers[0x1b]&31u)*0.1+0.5;
    assert(half_period_ms>=2.8&&half_period_ms<=3.1);
    #ifndef C5_HAPTIC_CALIBRATION
    assert((registers[0x1c]&0x30)==0x30);
#endif /* formula assumes 300us sample */
    assert(registers[0x1c]&0x40); /* brake stabilizer */
    assert(!(registers[0x1d]&1)&&!(registers[0x1f]&0x20)); /* closed loop */
    double ol_period_us=registers[0x20]*98.46;
    assert(ol_period_us>=1000000.0/170.0-49.23&&ol_period_us<=1000000.0/170.0+49.23);
}
bool haptic_test_write(uint8_t reg,uint8_t data){
    if(!io)return false;
    if(reg==0x1e)assert(!(data&1)); /* No OTP programming, ever. */
    if(reg==0x0c&&data==1&&registers[0x01]==7)motor_limits();
    registers[reg]=data;
#ifdef C5_MOTOR_SOUND
    if((registers[0x1d]&1)&&registers[0x01]==5){
        /* Independent TI Fig26 transfer curve, also checked at each mode
         * transition: unsigned mid-scale is neutral; signed zero is neutral.
         * Never allow more than the advertised20% open-loop drive. */
        double drive=(registers[0x1d]&8)?((int)registers[0x02]-127)/128.0:
                     (int8_t)registers[0x02]/127.0;
        assert(drive>=0&&drive<=0.20);
    }
#endif
    return true;
}
bool haptic_test_read(uint8_t reg,uint8_t *value){if(!io)return false;*value=registers[reg];if(reg==0)registers[reg]&=(uint8_t)~8u;return true;}
static void ready(void){
    memset(registers,0,sizeof registers);registers[0]=0xe0;io=true;calibrated=false;board_haptic_init();
    for(unsigned ms=10;ms<50;ms++){
        if(ms>=30&&!calibrated){
            registers[0x0c]=0;registers[0x18]=0x51;registers[0x19]=0x67;
            registers[0x1a]=(registers[0x1a]&0xfc)|3;calibrated=true;
        }
        board_haptic_tick(ms);
    }
    assert(board_haptic_ready());assert(registers[0x01]==5);motor_limits();
    assert(registers[0x18]==0x51&&registers[0x19]==0x67&&(registers[0x1a]&3)==3);
}
int main(void){
    ready();board_haptic_tick(100);assert(c5_hal_haptic(100));
    assert(registers[0x02]==255);
    board_haptic_tick(118);assert(c5_hal_haptic_busy()&&registers[0x02]==255);
    board_haptic_tick(123);assert(c5_hal_haptic_busy()&&registers[0x02]==255);
    board_haptic_tick(124);assert(!c5_hal_haptic_busy()&&registers[0x02]==0);
    board_haptic_tick(200);assert(c5_hal_haptic(45));assert(registers[0x02]==114);
    board_haptic_tick(220);assert(c5_hal_haptic(0)&&!c5_hal_haptic_busy()&&registers[0x02]==0);
    next_ms=UINT32_MAX-10u;board_haptic_tick(UINT32_MAX-10u);assert(c5_hal_haptic(80));
    board_haptic_tick(12);assert(c5_hal_haptic_busy());
    board_haptic_tick(13);assert(!c5_hal_haptic_busy());
    ready();const uint8_t slots[]={6,131,11};
    assert(c5_hal_haptic_sequence(slots,3,-2,1000));
    assert(registers[0x01]==0&&registers[0x03]==6&&registers[0x0c]==1);
    assert(registers[0x04]==6&&registers[0x05]==131&&registers[0x06]==11&&registers[0x07]==0);
    assert(registers[0x0e]==254&&registers[0x1c]==0xf5);
    assert(c5_hal_haptic(0));assert(registers[0x0c]==0&&registers[0x01]==5&&registers[0x02]==0);
    const uint8_t env[]={80,6,0,40,6,0,0,10,0};
    board_haptic_tick(100);assert(c5_hal_haptic_envelope(env,3,50,1000));
    assert(registers[0x02]==102);board_haptic_tick(106);assert(registers[0x02]==51);
    board_haptic_tick(112);assert(registers[0x02]==0);board_haptic_tick(122);assert(!c5_hal_haptic_busy());
    board_haptic_tick(200);assert(c5_hal_haptic_envelope(env,3,100,1000));
    board_haptic_tick(213);assert(registers[0x02]==0); /* skipped segments are not replayed */
    board_haptic_tick(250);assert(c5_hal_haptic_sequence(slots,3,0,100));
    board_haptic_tick(350);assert(!c5_hal_haptic_busy()&&registers[0x0c]==0);
    next_ms=UINT32_MAX-3u; /* start a fresh clock epoch just before wrap */
    board_haptic_tick(UINT32_MAX-3u);assert(c5_hal_haptic_envelope(env,3,100,1000));
    board_haptic_tick(3);assert(registers[0x02]==102);board_haptic_tick(20);assert(!c5_hal_haptic_busy());
    const uint8_t invalid[]={124};assert(!c5_hal_haptic_sequence(invalid,1,0,1000));
    motor_limits(); /* ROM/RTP playback must retain voltage limits/calibration */
    assert(registers[0x18]==0x51&&registers[0x19]==0x67&&(registers[0x1a]&3)==3);
#ifdef C5_MOTOR_SOUND
    ready();board_haptic_tick(200);
    uint8_t before[256];memcpy(before,registers,256);
    assert(!c5_hal_motor_sound(19,10,150));assert(!c5_hal_motor_sound(128,10,150));
    assert(!c5_hal_motor_sound(60,21,150));assert(!c5_hal_motor_sound(60,10,0));
    assert(!c5_hal_motor_sound(60,10,251));assert(!memcmp(before,registers,256));
    assert(c5_hal_motor_sound(46,10,150));
    assert(registers[0x1d]==0x81&&registers[0x20]==46);
    assert(registers[0x02]/127.0>=0.09&&registers[0x02]/127.0<=0.10);
    uint8_t diagnostics[12];assert(c5_hal_motor_diagnostics(diagnostics));
    assert(diagnostics[0]==HAPTIC_READY&&diagnostics[1]==0&&diagnostics[3]==5);
    assert(diagnostics[4]==registers[0x02]&&diagnostics[7]==0x81);
    board_haptic_tick(349);assert(c5_hal_haptic_busy());
    board_haptic_tick(350);assert(!c5_hal_haptic_busy());motor_limits();
    assert(registers[0x02]==0&&registers[0x01]==5&&registers[0x1d]==0x88);
    assert(c5_hal_motor_sound(20,20,250));
    assert(registers[0x02]/127.0>0.19&&registers[0x02]/127.0<=0.20);
    assert(c5_hal_haptic(10));assert(registers[0x1d]==0x88&&registers[0x20]==DRV_OL_PERIOD);motor_limits();
    assert(c5_hal_motor_sound(127,1,100));assert(c5_hal_motor_sound(60,0,100));
    assert(!c5_hal_haptic_busy()&&registers[0x1d]==0x88);motor_limits();
    next_ms=UINT32_MAX-20u;board_haptic_tick(UINT32_MAX-20u);
    assert(c5_hal_motor_sound(60,20,40));board_haptic_tick(18);assert(c5_hal_haptic_busy());
    board_haptic_tick(19);assert(!c5_hal_haptic_busy());motor_limits();
    assert(registers[0x18]==0x51&&registers[0x19]==0x67&&(registers[0x1a]&3)==3);
    puts("motor sound driver: pitch/gain/duration bounds, watchdog, ordinary haptic restoration, calibration and clock wrap passed");
    io=false;assert(!c5_hal_motor_diagnostics(diagnostics));io=true;
#endif
#ifdef C5_HAPTIC_CALIBRATION
    ready();board_haptic_tick(1000);
    uint8_t custom[8],state[12],base_tuning[8];c5_tuning_defaults(custom);memcpy(base_tuning,custom,8);
    custom[1]=0x77;custom[2]=0x0c;custom[3]=0x65;custom[4]=80;custom[5]=60;custom[6]=8;custom[7]=18;
    assert(c5_tuning_valid(custom));
    assert(c5_hal_haptic_calibration(0,custom)==C5_OK);
    assert(!c5_hal_haptic(100));assert(c5_hal_haptic_calibrating());
    for(unsigned ms=1001;ms<=1050;ms++)board_haptic_tick(ms);
    assert(registers[0x01]==7&&(registers[0x0c]&1));
    assert(registers[0x1f]==0x85);assert(registers[0x1e]==0x80);
    registers[0x0c]=0;registers[0x18]=0x34;registers[0x19]=0x56;registers[0x1a]=(registers[0x1a]&0xfc)|1;
    board_haptic_tick(1070);assert(board_haptic_ready());
    assert(c5_hal_haptic_calibration_status(0,state)&&state[5]==2&&(state[7]&1));
    assert(c5_hal_haptic_calibration_status(2,state)&&!memcmp(state+1,custom,8));
    assert(c5_hal_haptic_pulse_ms()==18);assert(c5_hal_haptic_tuning_matches(custom));
    assert(c5_hal_haptic_calibration(3,NULL)==C5_OK);
    assert(registers[0x18]==0x51&&registers[0x19]==0x67&&(registers[0x1a]&3)==3);
    assert(c5_hal_haptic_tuning_matches(base_tuning));
    /* Failed calibration latches its DIAG_RESULT even after read-to-clear,
     * and restores real previous coefficients, not hardcoded defaults. */
    assert(c5_hal_haptic_calibration(0,custom)==C5_OK);
    for(unsigned ms=1071;ms<=1120;ms++)board_haptic_tick(ms);
    registers[0x0c]=0;registers[0]=0xe8;registers[0x18]=0xaa;registers[0x19]=0xbb;
    board_haptic_tick(1140);assert(board_haptic_ready());
    assert(c5_hal_haptic_calibration_status(0,state)&&state[5]==3);
    assert(c5_hal_haptic_calibration_status(2,state)&&state[10]==0xe8);
    assert(registers[0x18]==0x51&&registers[0x19]==0x67&&c5_hal_haptic_tuning_matches(base_tuning));
    assert(c5_hal_haptic_calibration(0,custom)==C5_OK);
    for(unsigned ms=1141;ms<=1190;ms++)board_haptic_tick(ms);
    board_haptic_tick(2700);assert(board_haptic_ready());
    assert(c5_hal_haptic_calibration_status(0,state)&&state[5]==6);
    assert(c5_hal_haptic_calibration(0,custom)==C5_OK);
    board_haptic_tick(2701);assert(c5_hal_haptic_calibration(2,NULL)==C5_OK&&board_haptic_ready());
    assert(c5_hal_haptic_calibration(1,NULL)==C5_OK);registers[0x0c]=0;
    board_haptic_tick(2721);assert(board_haptic_ready());
    uint8_t raw_before[256];memcpy(raw_before,registers,256);custom[5]=67;
    assert(c5_hal_haptic_calibration(0,custom)==C5_ERR_RANGE&&!memcmp(raw_before,registers,256));
    custom[5]=60;custom[4]=91;assert(c5_hal_haptic_calibration(0,custom)==C5_ERR_RANGE);
    custom[4]=80;custom[6]=0x18;assert(c5_hal_haptic_calibration(0,custom)==C5_ERR_RANGE);
    custom[6]=8;custom[1]=0x7f;assert(c5_hal_haptic_calibration(0,custom)==C5_ERR_RANGE);
    assert(!c5_hal_haptic_calibration_status(3,state));
    puts("calibration driver: custom fields, voltage/sample recompute, live status, real-result undo, failure/timeout rollback, read-clear latch, cancel, diagnostics and invalid/OTP rejection passed");
#endif
    io=false;assert(!c5_hal_haptic_sequence(slots,3,0,1000));assert(!board_haptic_ready());
    puts("haptic driver: AAC0809 voltage/frequency limits, calibration retention, ROM/RTP transitions, gain, stop, deadlines, wrap and I/O faults passed");
}
