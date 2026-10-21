/* Included in the hardware driver: no arbitrary register-write endpoint, OTP,
 * ERM mode, open-loop override, or externally supplied calibration coefficients. */
static uint8_t drv_setting(uint8_t reg,uint8_t fallback)
{
    switch(reg) {
    case 0x16:return c5_tuning_rated_code(tuning);
    case 0x17:return tuning[5];
    case 0x1a:return 0x80u|((tuning[2]&7u)<<4)|((tuning[2]&24u)>>1)|(fallback&3u);
    case 0x1b:return (tuning[1]&31u)|((tuning[1]&32u)?0x80u:0);
    case 0x1c:return (fallback&0x80u)|((tuning[1]&64u)?0x40u:0)|
        ((tuning[2]&96u)>>1)|((tuning[3]&3u)<<2)|((tuning[3]>>4)&3u);
    case 0x1d:return fallback|((tuning[1]&128u)?4u:0);
    case 0x1e:return ((tuning[6]&3u)<<4)|((tuning[6]&12u)<<4);
    case 0x1f:return 0x80u|(tuning[3]&12u)|((tuning[3]>>6)&3u);
    default:return fallback;
    }
}
static bool drv_resume(void)
{
    if(!write_reg(0x1c,drv_setting(0x1c,0x75)) ||
       !write_reg(0x1d,drv_setting(0x1d,0x88)) ||
       !write_reg(0x02,0) || !write_reg(0x01,5))return false;
    phase=HAPTIC_READY;fault=0;playing=false;playback_mode=0;envelope=NULL;
    next_ms=current_ms;
    return true;
}
static void drv_measure(void)
{
    uint8_t period,supply;
    /* These are chip readings from playback, not acceleration or a lock flag.
     * Ignore an unset/out-of-range period; retain the last playback sample. */
    if(read_reg(0x22,&period)&&read_reg(0x21,&supply)&&period>=34&&period<=81) {
        last_period=period;last_supply=supply;measurement_valid=true;
    }
}
static bool drv_restore(void)
{
    if(!rollback_valid)return false;
    uint8_t status;
    if(!read_reg(0,&status)||(status&3u))return false;
    if(!write_reg(0x0c,0)||!write_reg(0x02,0))return false;
    memcpy(tuning,rollback_tuning,8);
    for(unsigned i=0;i<11;i++) {
        uint8_t reg=setup[i][0],value=drv_setting(reg,setup[i][1]);
        if(reg==0x1a)value=(value&0xfcu)|(rollback_result[2]&3u);
        if(!write_reg(reg,value))return false;
    }
    if(!write_reg(0x18,rollback_result[0])||!write_reg(0x19,rollback_result[1])||!drv_resume())return false;
    rollback_valid=false;measurement_valid=false;++tuning_generation;
    return true;
}
static void drv_job_complete(uint8_t status,bool timeout)
{
    job_status=status;++tuning_generation;
    if(timeout || (status&0x0bu)) {
        bool restored=job_kind==1 && !(status&3u) && drv_restore();
        job_result=restored?(timeout?6:3):4;
        if(!restored)fail(timeout?5:6);
        return;
    }
    if(!drv_resume()){job_result=4;fail(7);return;}
    job_result=2;
}
bool c5_hal_haptic_calibrating(void)
{
    return phase==HAPTIC_START||phase==HAPTIC_PROGRAM||phase==HAPTIC_CALIBRATE||phase==HAPTIC_DIAGNOSTIC;
}
bool c5_hal_haptic_configure(const uint8_t p[8])
{
    uint8_t normalized[8];
    if(!c5_tuning_valid(p))return false;
    if(c5_tuning_empty(p))c5_tuning_defaults(normalized);else memcpy(normalized,p,8);
    if(!memcmp(tuning,normalized,8)&&phase!=HAPTIC_FAILED)return true;
    if(phase==HAPTIC_START){memcpy(tuning,normalized,8);return true;}
    return c5_hal_haptic_calibration(0,normalized)==C5_OK;
}
bool c5_hal_haptic_tuning_matches(const uint8_t p[8])
{
    uint8_t normalized[8];
    if(!c5_tuning_valid(p)||phase!=HAPTIC_READY)return false;
    if(c5_tuning_empty(p))c5_tuning_defaults(normalized);else memcpy(normalized,p,8);
    return !memcmp(tuning,normalized,8);
}
uint8_t c5_hal_haptic_pulse_ms(void) { return tuning[7]; }
uint8_t c5_hal_haptic_calibration(uint8_t action,const uint8_t *p)
{
    if(action==2) {
        if(!c5_hal_haptic_calibrating())return c5_hal_haptic(0)?C5_OK:C5_ERR_IO;
        bool restored=job_kind==2?(write_reg(0x0c,0)&&drv_resume()):drv_restore();
        job_result=restored?5:4;++tuning_generation;
        if(!restored)fail(22);
        return restored?C5_OK:C5_ERR_IO;
    }
    if(c5_hal_haptic_calibrating())return C5_ERR_BUSY;
    if(action==3) {
        if(!rollback_valid)return C5_ERR_BUSY;
        if(!drv_restore()){fail(22);return C5_ERR_IO;}
        job_kind=0;job_result=5;return C5_OK;
    }
    if(action>1)return C5_ERR_FRAME;
    if(action==0 && (!p||c5_tuning_empty(p)||!c5_tuning_valid(p)))return C5_ERR_RANGE;
    if(action==1 && phase!=HAPTIC_READY)return C5_ERR_IO;
    if(phase==HAPTIC_READY) {
        if(!c5_hal_haptic(0))return C5_ERR_IO;
        if(action==0) {
            if(!read_reg(0x18,rollback_result)||!read_reg(0x19,rollback_result+1)||
               !read_reg(0x1a,rollback_result+2))return C5_ERR_IO;
            memcpy(rollback_tuning,tuning,8);rollback_valid=true;
        }
    } else rollback_valid=false;
    job_kind=action+1;job_result=1;job_status=0;measurement_valid=false;++tuning_generation;
    if(action==0) {
        memcpy(tuning,p,8);setup_index=0;phase=HAPTIC_PROGRAM;fault=0;next_ms=current_ms;
    } else {
        if(!write_reg(0x01,6)||!write_reg(0x0c,1)){fail(23);return C5_ERR_IO;}
        phase=HAPTIC_DIAGNOSTIC;calibration_ms=current_ms;next_ms=current_ms+20;
    }
    return C5_OK;
}
bool c5_hal_haptic_calibration_status(uint8_t page,uint8_t out[12])
{
    memset(out,0,12);
    if(page==0) {
        uint8_t status=job_status;
        if(!c5_hal_haptic_calibrating()&&!read_reg(0,&status))return false;
        out[0]=1;out[1]=phase;out[2]=fault;out[3]=status;
        out[4]=job_kind;out[5]=job_result;out[6]=tuning_generation;
        out[7]=(rollback_valid?1:0)|(measurement_valid?2:0)|(c5_hal_haptic_calibrating()?4:0);
        if(!read_reg(0x18,out+8)||!read_reg(0x19,out+9)||!read_reg(0x1a,out+10))return false;
        out[10]&=3;out[11]=tuning[7];
    } else if(page==1) {
        static const uint8_t regs[9]={0x16,0x17,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f,0x20};
        out[0]=tuning_generation;
        for(unsigned i=0;i<9;i++)if(!read_reg(regs[i],out+i+1))return false;
        out[10]=last_supply;out[11]=last_period;
    } else if(page==2) {
        out[0]=tuning_generation;memcpy(out+1,tuning,8);out[9]=measurement_valid;
        out[10]=job_status;
    } else return false;
    return true;
}
