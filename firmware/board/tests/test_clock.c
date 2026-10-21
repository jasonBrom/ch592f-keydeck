#include <assert.h>
#include <stdio.h>
#include "app_clock.h"

int main(void)
{
    c5_app_clock clock={0,0,0};
    assert(c5_app_clock_poll(&clock,59999)==0);
    assert(c5_app_clock_poll(&clock,60000)==1);
    assert(c5_app_clock_poll(&clock,60000)==1);
    assert(c5_app_clock_poll(&clock,90017)==1);
    assert(c5_app_clock_poll(&clock,120000)==2);
    /* Long polling gaps preserve elapsed milliseconds without replaying stale
     * input samples, and the non-power-of-two timer wrap loses no ticks. */
    clock=(c5_app_clock){C5_TIMER_PERIOD_TICKS-30000,0,42};
    assert(c5_app_clock_poll(&clock,30000)==43);
    assert(c5_timer_delta(0,C5_TIMER_PERIOD_TICKS-1)==1);
    assert(c5_timer_delta(19,17)==2);
    /* Many asynchronous poll intervals, including timer wraps, must agree
     * exactly with elapsed SYSCLK time. No RTC tick is required. */
    clock=(c5_app_clock){0,0,0};
    uint64_t elapsed=0;
    for(unsigned i=0;i<50000;++i){
        elapsed+=(i*977u)%20000000u;
        uint32_t result=c5_app_clock_poll(&clock,(uint32_t)(elapsed%C5_TIMER_PERIOD_TICKS));
        assert(result==(uint32_t)(elapsed/C5_TICKS_PER_MS));
    }
    clock=(c5_app_clock){0,0,UINT32_MAX};
    assert(c5_app_clock_poll(&clock,60000)==0);
    puts("application clock: sub-ms carry, polling gaps, timer wraps, uptime rollover and RTC independence passed");
}
