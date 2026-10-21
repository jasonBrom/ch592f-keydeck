/* Real production GAP callbacks and handoff functions. The WCH controller
 * boundary is stubbed; no fake bond/GATT implementation or Flash erasure. */
#include <assert.h>
#include <stdio.h>
#include "../ble_transport.c"

static uint16_t mock_handle;
static bool mock_up,mock_encrypted,mock_advertising,mock_subscribed;
static bStatus_t terminate_result,advert_result;
static unsigned terminations,bond_writes,advert_requests;
static uint16_t scheduled;
static const uint8_t host_a[6]={1,2,3,4,5,6},host_b[6]={9,8,7,6,5,4};
void c5_hal_status(uint8_t *flags,uint8_t *percent,uint16_t *mv){(void)flags;*percent=50;*mv=3700;}
uint8_t linkDB_State(uint16_t handle,uint8_t state){return handle==mock_handle && mock_up && (state==LINK_CONNECTED || (state==LINK_ENCRYPTED && mock_encrypted));}
uint16_t GATTServApp_ReadCharCfg(uint16_t handle,gattCharCfg_t *table){(void)table;return handle==mock_handle&&mock_subscribed?GATT_CLIENT_CFG_NOTIFY:0;}
void GATTServApp_InitCharCfg(uint16_t handle,gattCharCfg_t *table){(void)handle;(void)table;}
bStatus_t GATTServApp_ProcessCCCWriteReq(uint16_t h,gattAttribute_t *a,uint8_t *v,uint16_t n,uint16_t o,uint16_t valid){(void)h;(void)a;(void)v;(void)n;(void)o;(void)valid;return SUCCESS;}
bStatus_t GAPRole_TerminateLink(uint16_t handle){assert(handle==mock_handle);terminations++;return terminate_result;}
bStatus_t GAPRole_SetParameter(uint16_t p,uint16_t n,void *v){if(p==GAPROLE_ADVERT_ENABLED){++advert_requests;assert(n==1);if(advert_result==SUCCESS)mock_advertising=*(uint8_t *)v!=0;return advert_result;}return SUCCESS;}
bStatus_t GAPRole_GetParameter(uint16_t p,void *v){assert(p==GAPROLE_STATE);*(gapRole_States_t *)v=mock_up?GAPROLE_CONNECTED:(mock_advertising?GAPROLE_ADVERTISING:GAPROLE_WAITING);return SUCCESS;}
bStatus_t GAP_SetParamValue(uint16_t p,uint16_t v){(void)p;(void)v;return SUCCESS;}
bStatus_t GAPBondMgr_SetParameter(uint16_t p,uint8_t n,void *v){assert(p!=GAPBOND_ERASE_ALLBONDS&&p!=GAPBOND_ERASE_SINGLEBOND);(void)n;(void)v;bond_writes++;return SUCCESS;}
BOOL tmos_start_task(tmosTaskID id,tmosEvents event,tmosTimer time){(void)id;assert(time);scheduled|=event;return TRUE;}
bStatus_t tmos_stop_task(tmosTaskID id,tmosEvents event){(void)id;scheduled&=(uint16_t)~event;return SUCCESS;}
uint8_t *tmos_msg_receive(tmosTaskID id){(void)id;return NULL;}
bStatus_t tmos_msg_deallocate(uint8_t *p){(void)p;return SUCCESS;}
bStatus_t GAPRole_PeripheralStartDevice(uint8_t id,gapBondCBs_t *b,gapRolesCBs_t *r){(void)id;(void)b;(void)r;return SUCCESS;}
bStatus_t GAPRole_PeripheralConnParamUpdateReq(uint16_t h,uint16_t a,uint16_t b,uint16_t l,uint16_t t,uint8_t id){(void)h;(void)a;(void)b;(void)l;(void)t;(void)id;return SUCCESS;}

static void setup(void){
    initialized=service_ok=true;connection=GAP_CONNHANDLE_INIT;pairing=(c5_pair_session){0};
    connection_rejected=false;pairing_now_ms=pairing_retry_ms=connection_started_ms=0;
    mock_up=mock_encrypted=mock_advertising=false;mock_handle=0;scheduled=0;
    mock_subscribed=true;terminations=bond_writes=advert_requests=0;terminate_result=advert_result=SUCCESS;reset_queues();
}
static void establish(uint16_t handle,uint8_t type,const uint8_t *address){
    mock_handle=handle;mock_up=mock_encrypted=true;mock_advertising=false;
    gapRoleEvent_t event={0};event.linkCmpl.opcode=GAP_LINK_ESTABLISHED_EVENT;
    event.linkCmpl.hdr.status=SUCCESS;event.linkCmpl.connectionHandle=handle;
    event.linkCmpl.devAddrType=type;memcpy(event.linkCmpl.devAddr,address,6);event.linkCmpl.connInterval=12;
    role_changed(GAPROLE_CONNECTED,&event);
}
static void terminate(uint16_t handle){
    if(handle==mock_handle)mock_up=mock_encrypted=false;
    gapRoleEvent_t event={0};event.linkTerminate.opcode=GAP_LINK_TERMINATED_EVENT;
    event.linkTerminate.connectionHandle=handle;role_changed(GAPROLE_WAITING,&event);
}
static void test_same_pc_repair_and_other_pc(void){
    setup();establish(1,0,host_a);assert(nd_ble_ready()&&nd_ble_config_ready());
    tx_count=cfg_count=rx_count=1;assert(nd_ble_start_pairing(5000));
    assert(terminations==1&&pairing.active&&pairing.waiting_disconnect);
    assert(!nd_ble_connected()&&!nd_ble_ready()&&!nd_ble_config_ready()&&!nd_ble_features_ready());
    assert(tx_count==0&&cfg_count==0&&rx_count==0);
    nd_ble_pairing_tick(5001);assert(pairing.active); /* Old encryption cannot end the window. */
    terminate(1);assert(mock_advertising&&pairing.active);
    establish(2,0,host_a);assert(nd_ble_ready()); /* Same PC is accepted immediately. */
    terminate(1);assert(nd_ble_ready()); /* A stale previous-handle event cannot remove it. */
    nd_ble_pairing_tick(5500);assert(!pairing.active&&!bond_writes);
    assert(nd_ble_start_pairing(6000));terminate(2);establish(3,0,host_b);
    assert(nd_ble_ready());nd_ble_pairing_tick(6100);assert(!pairing.active&&!bond_writes);
}
static void test_controller_busy_and_advert_recovery(void){
    setup();establish(1,0,host_a);terminate_result=bleIncorrectMode;
    assert(nd_ble_start_pairing(10));assert(pairing.active&&connection_rejected);
    unsigned count=terminations;terminate_result=SUCCESS;
    process_events(task_id,ND_HANDOFF_EVENT);assert(terminations==count+1);
    /* linkDB removal without the role termination callback must still resume advertising. */
    mock_up=mock_encrypted=false;link_changed(1,LINKDB_STATUS_UPDATE_REMOVED);
    assert(connection==GAP_CONNHANDLE_INIT&&!nd_ble_connected());
    nd_ble_pairing_tick(509);assert(!mock_advertising);
    nd_ble_pairing_tick(510);assert(mock_advertising);
    unsigned adverts=advert_requests;nd_ble_pairing_tick(1010);assert(advert_requests==adverts);
    setup();advert_result=bleIncorrectMode;
    assert(nd_ble_start_pairing(0)&&pairing.active);assert(!mock_advertising);
    adverts=advert_requests;nd_ble_pairing_tick(499);assert(advert_requests==adverts);
    advert_result=SUCCESS;nd_ble_pairing_tick(500);assert(mock_advertising);
    /* Ordinary offline recovery also runs after shutdown, outside a BOOT window. */
    setup();nd_ble_pairing_tick(500);assert(mock_advertising&&!pairing.active);
}
static void test_security_and_hid_timeout(void){
    setup();assert(nd_ble_start_pairing(0));mock_subscribed=false;establish(1,0,host_a);
    nd_ble_pairing_tick(1);assert(pairing.active); /* Encryption alone is not a usable HID. */
    nd_ble_pairing_tick(29999);assert(pairing.active&&!connection_rejected);
    nd_ble_pairing_tick(30000);assert(connection_rejected&&terminations==1);
    terminate(1);assert(mock_advertising&&pairing.active);
    establish(2,0,host_a);mock_encrypted=false;
    pair_state_changed(1,GAPBOND_PAIRING_STATE_COMPLETE,1);assert(!connection_rejected);
    pair_state_changed(2,GAPBOND_PAIRING_STATE_STARTED,1);assert(!connection_rejected);
    pair_state_changed(2,GAPBOND_PAIRING_STATE_COMPLETE,1);
    assert(connection_rejected&&!nd_ble_ready());terminate(2);
    mock_subscribed=true;establish(3,0,host_a);nd_ble_pairing_tick(30001);
    assert(!pairing.active&&nd_ble_ready()&&!bond_writes);
    assert(bond_callbacks.pairStateCB==pair_state_changed);
}
static void test_timeout_repeat_and_wrap(void){
    setup();assert(nd_ble_start_pairing(UINT32_MAX-1000));
    nd_ble_pairing_tick((UINT32_MAX-1000)+119999u);assert(pairing.active);
    nd_ble_pairing_tick((UINT32_MAX-1000)+120000u);assert(!pairing.active);
    establish(1,0,host_a);assert(nd_ble_ready());
    setup();assert(nd_ble_start_pairing(0));assert(nd_ble_start_pairing(100000));
    nd_ble_pairing_tick(120000);assert(pairing.active);
    nd_ble_pairing_tick(220000);assert(!pairing.active&&!bond_writes);
    /* A stale stored handle is discarded before starting a fresh window. */
    setup();establish(1,0,host_a);mock_up=false;
    assert(nd_ble_start_pairing(10));assert(connection==GAP_CONNHANDLE_INIT&&mock_advertising);
}
int main(void){
    test_same_pc_repair_and_other_pc();test_controller_busy_and_advert_recovery();
    test_security_and_hid_timeout();test_timeout_repeat_and_wrap();
    puts("BLE pairing: same/other PC, busy retries, missing disconnect callback, normal offline advertising recovery, security failure, HID timeout, repeat hold, retained bonds and clock wrap passed");return 0;
}
