/* Native boundary tests for the production BLE feature write assembler.
 * SDK adapter boundary follows documented WCH callbacks: ordinary sequential
 * long writes arrive aggregated under Execute; reliable writes are replayed as
 * Prepare callbacks plus one final Execute callback. No fake GATT stack here. */
#include "ble_features.h"
#include "hid_features.h"
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum { WRITE=0x12, COMMAND=0x52, PREPARE=0x16, EXECUTE=0x18, OK=0,
       INVALID_OFFSET=7, INVALID_SIZE=13, IO_ERROR=14 };
static unsigned attempts,commits;
static bool set_allowed;
static uint8_t last_source,last_type,last_id,latched[50];
static size_t latched_size;
static unsigned get_calls;
static bool cursor_get;
bool c5_features_set_source(uint8_t source,uint8_t type,uint8_t id,
                            const uint8_t *data,size_t size){
    assert(data&&size<=sizeof(latched));++attempts;
    if(!set_allowed)return false;
    ++commits;last_source=source;last_type=type;last_id=id;
    memcpy(latched,data,size);latched_size=size;return true;
}
size_t c5_features_get_source(uint8_t source,uint8_t id,uint8_t *out,size_t cap){
    assert(source==2);(void)id;if(cap<latched_size)return 0;
    ++get_calls;memcpy(out,latched,latched_size);
    if(cursor_get&&latched_size)out[0]=(uint8_t)get_calls;
    return latched_size;
}
static uint8_t pattern[50];
static void reset(void){
    nd_ble_features_reset();attempts=commits=0;set_allowed=true;
    last_source=last_type=last_id=0;latched_size=0;get_calls=0;cursor_get=false;memset(latched,0xa5,sizeof(latched));
    for(unsigned i=0;i<sizeof(pattern);i++)pattern[i]=(uint8_t)(i*37u+11u);
}
static uint8_t write_part(uint8_t id,const uint8_t *data,uint16_t n,uint16_t off,uint8_t method){
    return nd_ble_feature_write(3,id,data,n,off,method);
}
static void same_payload(uint8_t id){
    assert(attempts==1&&commits==1&&last_source==2&&last_type==3&&last_id==id);
    assert(latched_size==50&&memcmp(latched,pattern,50)==0);
}
static void long_write_mtu23(void){
    reset();
    /* ATT_MTU23 gives 18 data bytes for Prepare (opcode+handle+offset=5).
     * WCH joins sequential prepared chunks before calling Execute callback. */
    uint8_t sdk_aggregate[50];size_t n=0;
    const unsigned lengths[]={18,18,14};
    for(unsigned i=0;i<3;i++){memcpy(sdk_aggregate+n,pattern+n,lengths[i]);n+=lengths[i];assert(commits==0);}
    assert(n==50);assert(write_part(C5_LAMP_MULTI_ID,sdk_aggregate,50,0,EXECUTE)==OK);
    same_payload(C5_LAMP_MULTI_ID);
}
static void cancel_does_not_mutate(void){
    reset();
    /* Normal Execute(cancel) stays inside the vendor queue, with no callback. */
    nd_ble_features_reset();assert(attempts==0&&commits==0);
    /* Also check a staged reliable replay is never committed by reset/loss. */
    assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+18,18,18,PREPARE)==OK);
    assert(attempts==0&&commits==0);nd_ble_features_reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern+36,14,36,EXECUTE)!=OK);
    assert(attempts==0&&commits==0&&latched_size==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==OK);same_payload(C5_LAMP_MULTI_ID);
}
static void out_of_order_and_duplicates(void){
    reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern+18,18,18,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+18,18,18,PREPARE)==OK);
    assert(commits==0&&attempts==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+36,14,36,EXECUTE)==OK);
    same_payload(C5_LAMP_MULTI_ID);
}
static void conflicting_overlap_rejects(void){
    reset();uint8_t conflict[18];memcpy(conflict,pattern,18);conflict[9]^=1;
    assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,conflict,18,0,PREPARE)!=OK);
    assert(attempts==0&&commits==0&&latched_size==0);
    /* Actual WCH Execute loop continues after errors. The poisoned state must
     * survive every remaining replay and clear at the final Execute callback. */
    assert(write_part(C5_LAMP_MULTI_ID,pattern+18,18,18,PREPARE)!=OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+36,14,36,EXECUTE)!=OK);
    assert(attempts==0&&commits==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==OK);same_payload(C5_LAMP_MULTI_ID);
}
static void gaps_reject_without_partial_commit(void){
    reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern,17,0,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+18,18,18,PREPARE)==OK);
    assert(write_part(C5_LAMP_MULTI_ID,pattern+36,14,36,EXECUTE)!=OK);
    assert(attempts==0&&commits==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,WRITE)==OK);same_payload(C5_LAMP_MULTI_ID);
}
static void cross_report_rejects(void){
    reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    assert(write_part(C5_LAMP_RANGE_ID,pattern,9,0,EXECUTE)!=OK);
    assert(attempts==0&&commits==0);
    nd_ble_features_reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,WRITE)==OK);same_payload(C5_LAMP_MULTI_ID);
}
static void mixed_service_transaction_rejects(void){
    reset();
    assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    nd_ble_feature_reject_other(PREPARE);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)!=OK);
    assert(attempts==0&&commits==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==OK);same_payload(C5_LAMP_MULTI_ID);
    reset();assert(write_part(C5_LAMP_MULTI_ID,pattern,18,0,PREPARE)==OK);
    nd_ble_feature_reject_other(EXECUTE);
    assert(attempts==0&&commits==0);
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==OK);same_payload(C5_LAMP_MULTI_ID);
}
static void lengths_offsets_and_types(void){
    static const struct {uint8_t type,id,size;} reports[]={
        {2,C5_HAPTIC_ID,2},{3,C5_HAPTIC_ID,9},{3,C5_LAMP_ARRAY_ID,22},
        {3,C5_LAMP_REQUEST_ID,2},{3,C5_LAMP_RESPONSE_ID,28},
        {3,C5_LAMP_MULTI_ID,50},{3,C5_LAMP_RANGE_ID,9},{3,C5_LAMP_CONTROL_ID,1}};
    for(unsigned i=0;i<sizeof(reports)/sizeof(reports[0]);i++){
        reset();assert(nd_ble_feature_write(reports[i].type,reports[i].id,pattern,reports[i].size,0,WRITE)==OK);
        assert(attempts==1&&commits==1&&latched_size==reports[i].size&&last_source==2);
        reset();assert(nd_ble_feature_write(reports[i].type,reports[i].id,pattern,reports[i].size-1,0,WRITE)!=OK);assert(attempts==0);
        reset();assert(nd_ble_feature_write(reports[i].type,reports[i].id,pattern,reports[i].size+1,0,WRITE)!=OK);assert(attempts==0);
    }
    reset();assert(write_part(C5_LAMP_MULTI_ID,pattern,1,65535,PREPARE)!=OK);assert(attempts==0);
    reset();assert(write_part(C5_LAMP_MULTI_ID,pattern,50,1,WRITE)!=OK);assert(attempts==0);
    reset();assert(nd_ble_feature_write(2,C5_LAMP_MULTI_ID,pattern,50,0,WRITE)!=OK);assert(attempts==0);
    reset();assert(write_part(0x7f,pattern,1,0,WRITE)!=OK);assert(attempts==0);
    reset();assert(write_part(C5_LAMP_MULTI_ID,NULL,50,0,WRITE)!=OK);assert(attempts==0);
}
static void failed_set_reports_real_error(void){
    reset();set_allowed=false;
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==IO_ERROR);
    assert(attempts==1&&commits==0&&latched_size==0&&latched[0]==0xa5);
    set_allowed=true;
    assert(write_part(C5_LAMP_MULTI_ID,pattern,50,0,EXECUTE)==OK);
    assert(attempts==2&&commits==1&&memcmp(latched,pattern,50)==0);
}
static void read_blob_snapshot_and_bounds(void){
    reset();memcpy(latched,pattern,50);latched_size=50;cursor_get=true;
    uint8_t out[52],joined[50];uint16_t n=0;memset(out,0xa5,sizeof(out));
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out+1,&n,0,22)==OK&&n==22);
    assert(get_calls==1&&out[0]==0xa5&&out[23]==0xa5);memcpy(joined,out+1,n);
    /* Underlying colors/cursor change between Read Blob calls. */
    memset(latched,0x55,50);
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out+1,&n,22,22)==OK&&n==22);
    memcpy(joined+22,out+1,n);
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out+1,&n,44,22)==OK&&n==6);
    memcpy(joined+44,out+1,n);assert(get_calls==1&&joined[0]==1&&memcmp(joined+1,pattern+1,49)==0);
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out,&n,50,22)==OK&&n==0&&get_calls==1);
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out,&n,51,22)==INVALID_OFFSET&&n==0);
    assert(nd_ble_feature_read(3,C5_LAMP_MULTI_ID,out,&n,0,22)==OK&&n==22&&get_calls==2&&out[0]==2&&out[1]==0x55);
    /* AttributesResponse is 28B, so reading its final6B must not advance cursor. */
    reset();latched_size=28;memcpy(latched,pattern,28);cursor_get=true;
    assert(nd_ble_feature_read(3,C5_LAMP_RESPONSE_ID,out,&n,0,22)==OK&&n==22&&out[0]==1);
    assert(nd_ble_feature_read(3,C5_LAMP_RESPONSE_ID,out,&n,22,22)==OK&&n==6&&get_calls==1);
    nd_ble_features_reset();assert(nd_ble_feature_read(3,C5_LAMP_RESPONSE_ID,out,&n,0,22)==OK&&get_calls==2);
}
static void haptic_output_read_latches_only_success(void){
    reset();const uint8_t good[]={3,70},failed[]={3,20};uint8_t out[2];uint16_t n;
    assert(nd_ble_feature_read(2,C5_HAPTIC_ID,out,&n,0,22)==OK&&n==2&&out[0]==0&&out[1]==0);
    assert(nd_ble_feature_write(2,C5_HAPTIC_ID,good,2,0,WRITE)==OK);
    assert(nd_ble_feature_read(2,C5_HAPTIC_ID,out,&n,0,22)==OK&&memcmp(out,good,2)==0);
    set_allowed=false;assert(nd_ble_feature_write(2,C5_HAPTIC_ID,failed,2,0,WRITE)==IO_ERROR);
    assert(nd_ble_feature_read(2,C5_HAPTIC_ID,out,&n,0,22)==OK&&memcmp(out,good,2)==0);
    assert(get_calls==0);nd_ble_features_reset();
    assert(nd_ble_feature_read(2,C5_HAPTIC_ID,out,&n,0,22)==OK&&out[0]==0&&out[1]==0);
}
int main(void){
    long_write_mtu23();cancel_does_not_mutate();out_of_order_and_duplicates();
    conflicting_overlap_rejects();gaps_reject_without_partial_commit();cross_report_rejects();
    mixed_service_transaction_rejects();lengths_offsets_and_types();failed_set_reports_real_error();
    read_blob_snapshot_and_bounds();haptic_output_read_latches_only_success();
    puts("BLE features: 11 suites passed (MTU23 long write, cancellation, reorder/duplicates, overlap, gaps, cross-report/service, bounds/types, synchronous ATT failure, Read Blob snapshots, output latch)");return 0;
}
