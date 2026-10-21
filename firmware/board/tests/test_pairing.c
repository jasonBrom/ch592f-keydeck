#include <assert.h>
#include <stdio.h>
#include "pairing.h"

static void test_button(void)
{
    c5_pair_button button={0};
    for(uint32_t t=0;t<100;t++)assert(!c5_pair_button_sample(&button,t%2,t));
    assert(!button.pressed); /* Contact chatter cannot start the hold. */
    for(uint32_t t=100;t<1100;t++)assert(!c5_pair_button_sample(&button,true,t));
    for(uint32_t t=1100;t<1105;t++)assert(!c5_pair_button_sample(&button,false,t));
    assert(!button.pressed); /* A short press has no pairing action. */
    for(uint32_t t=2000;t<4004;t++)assert(!c5_pair_button_sample(&button,true,t));
    assert(c5_pair_button_sample(&button,true,4004));
    for(uint32_t t=4005;t<10000;t++)assert(!c5_pair_button_sample(&button,true,t));
    for(uint32_t t=10000;t<10004;t++)assert(!c5_pair_button_sample(&button,false,t));
    assert(!c5_pair_button_sample(&button,true,10004)); /* Brief release bounce does not rearm. */
    for(uint32_t t=10005;t<10010;t++)assert(!c5_pair_button_sample(&button,false,t));
    for(uint32_t t=11000;t<13004;t++)assert(!c5_pair_button_sample(&button,true,t));
    assert(c5_pair_button_sample(&button,true,13004));

    button=(c5_pair_button){0};
    uint32_t start=UINT32_MAX-1000;
    for(uint32_t dt=0;dt<2004;dt++)assert(!c5_pair_button_sample(&button,true,start+dt));
    assert(c5_pair_button_sample(&button,true,start+2004));
}

static void test_session(void)
{
    c5_pair_session session={1000,1,0};
    assert(c5_pair_session_light(&session,1000));
    assert(c5_pair_session_light(&session,1249));
    assert(!c5_pair_session_light(&session,1250));
    assert(c5_pair_session_light(&session,1500));
    assert(c5_pair_session_tick(&session,120999,false));
    assert(!c5_pair_session_tick(&session,121000,false));
    assert(!c5_pair_session_light(&session,121000));
    /* The existing encrypted link must not mark a requested new pairing done
     * before its asynchronous termination event arrives. */
    session=(c5_pair_session){2000,1,1};
    assert(c5_pair_session_tick(&session,2001,true));
    session.waiting_disconnect=0;
    assert(c5_pair_session_tick(&session,2002,false));
    assert(!c5_pair_session_tick(&session,2003,true));
    assert(!c5_pair_session_light(&session,2003));
    session=(c5_pair_session){UINT32_MAX-1000,1,0};
    assert(c5_pair_session_tick(&session,session.started_at+119999,false));
    assert(!c5_pair_session_tick(&session,session.started_at+120000,false));
    /* A failed/hung disconnect is still bounded by the window timeout. */
    session=(c5_pair_session){0,1,1};
    assert(!c5_pair_session_tick(&session,120000,true));
}

int main(void)
{
    test_button();test_session();
    puts("pairing: BOOT debounce, short press, one action per hold, release bounce, reconnect, blink and rollover passed");
}
