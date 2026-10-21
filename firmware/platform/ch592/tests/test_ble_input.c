/* Real transport queue and notification path, with the WCH controller boundary
 * mocked to reproduce busy connection events and allocation failures. */
#define main pairing_regression_main
#include "test_handoff.c"
#undef main
const uint8_t primaryServiceUUID[2]={0x00,0x28};
const uint8_t characterUUID[2]={0x03,0x28};
const uint8_t clientCharCfgUUID[2]={0x02,0x29};
static bool controller_busy,allocation_failed;
static uint8_t notification_bytes[32];
static unsigned sent_count,failed_count;
static struct {uint16_t handle;uint8_t n,data[20];} sent[128];
void *GATT_bm_alloc(uint16_t h,uint8_t op,uint16_t n,uint16_t *allocated,uint8_t flag){
    (void)h;(void)op;(void)allocated;(void)flag;assert(n<=sizeof notification_bytes);
    return allocation_failed?NULL:notification_bytes;
}
void GATT_bm_free(gattMsg_t *m,uint8_t op){(void)m;(void)op;failed_count++;}
bStatus_t GATT_Notification(uint16_t h,attHandleValueNoti_t *n,uint8_t auth){
    (void)h;(void)auth;if(controller_busy)return bleIncorrectMode;
    assert(sent_count<128);sent[sent_count].handle=n->handle;sent[sent_count].n=n->len;
    memcpy(sent[sent_count].data,n->pValue,n->len);sent_count++;return SUCCESS;
}
void TMOS_SystemProcess(void){}
uint32_t TMOS_GetSystemClock(void){return 0;}
void nd_platform_config_received(uint8_t t,const uint8_t frame[20]){(void)t;(void)frame;}
static void start(void){
    setup();establish(1,0,host_a);neutral_pending=0;
    controller_busy=allocation_failed=false;sent_count=failed_count=0;
    for(unsigned i=0;i<4;i++)hid_attributes[input_attribute_indices[i]].handle=(uint16_t)(10+i);
    config_attributes[4].handle=20;
}
int main(void){
    start();controller_busy=true;uint8_t radial[3]={0,50,0};
    for(unsigned i=0;i<30;i++){assert(nd_ble_send(3,radial,3));nd_ble_poll();}
    assert(tx_count==1&&sent_count==0&&failed_count>=30);
    controller_busy=false;nd_ble_poll();assert(tx_count==0&&sent_count==1);
    assert(sent[0].handle==12&&sent[0].data[1]==0xdc&&sent[0].data[2]==5); /* 150.0 degrees */
    start();allocation_failed=true;uint8_t wheel[4]={0,0,0,1};
    for(unsigned i=0;i<100;i++){assert(nd_ble_send(4,wheel,4));nd_ble_poll();}
    assert(tx_count==1&&!sent_count);allocation_failed=false;nd_ble_poll();
    assert(sent_count==1&&sent[0].data[3]==100);
    /* Reversal and click transitions form strict boundaries, not cancellation. */
    start();radial[1]=50;radial[2]=0;assert(nd_ble_send(3,radial,3));
    radial[1]=206;radial[2]=255;assert(nd_ble_send(3,radial,3));
    radial[0]=1;radial[1]=radial[2]=0;assert(nd_ble_send(3,radial,3));
    radial[0]=0;assert(nd_ble_send(3,radial,3));assert(tx_count==4);
    nd_ble_poll();assert(sent_count==4&&tx_count==0);
    assert(sent[0].data[1]==50&&sent[1].data[1]==206&&sent[2].data[0]==1&&sent[3].data[0]==0);
    /* Failed notifications stay queued; exceeding a HID range splits a packet. */
    start();wheel[3]=100;assert(nd_ble_send(4,wheel,4));assert(nd_ble_send(4,wheel,4));assert(tx_count==2);
    controller_busy=true;nd_ble_poll();assert(tx_count==2&&!sent_count);
    controller_busy=false;nd_ble_poll();assert(sent_count==2);
    start();wheel[3]=1;assert(nd_ble_send(4,wheel,4));cfg_count=1;
    memset(cfg_queue[0],0,20);nd_ble_poll();assert(sent_count==2);
    assert(sent[0].handle==13&&sent[1].handle==20); /* HID before status ACK */
    /* Epoch change drops old reports and sends neutral before any new motion. */
    start();assert(nd_ble_send(4,wheel,4));report_epoch[3]++;neutral_pending=8;nd_ble_poll();
    assert(tx_count==0&&sent_count==1&&sent[0].data[3]==0);
    puts("BLE input: busy/allocation retry, exact relative sums, direction/button ordering, range splits, bounded drain and epoch neutral passed");
}
