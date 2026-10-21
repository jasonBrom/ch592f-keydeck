#include "CH59x_common.h"
#include "c5.h"
#include "board.h"
#include "usb_transport.h"
#include "ble_transport.h"
#include "hid_features.h"
#include "reconfigure.h"
#include "app_clock.h"
#include <string.h>

/* Separate pending acknowledgements for independently connected config clients.
 * Both transport receivers deliver in main context. Core mutations run serially.
 */
static uint8_t ack[2][20];
static bool ack_pending[2];
void nd_platform_config_received(uint8_t transport,const uint8_t frame[20]) {
  if(transport<1||transport>2)return;
  uint8_t i=transport-1;
  if(ack_pending[i])return; /* protocol permits only one outstanding request */
  c5_config_frame_transport(transport,frame,ack[i]);ack_pending[i]=true;
}
bool c5_hal_report(uint8_t transport,uint8_t id,const uint8_t *data,uint8_t length) {
  if(transport==C5_TRANSPORT_USB)return nd_usb_send(id,data,length);
  if(transport==C5_TRANSPORT_BLE)return nd_ble_send(id,data,length);
  return false;
}
int main(void) {
  SetSysClock(CLK_SOURCE_PLL_60MHz);
  board_init();
  c5_features_init();
  c5_init();
  nd_ble_init();
  nd_usb_init();
  /* Application service must keep running even if the BLE 32 kHz crystal
   * stops. TMR3 already provides bounded board I/O waits from SYSCLK. */
  c5_app_clock clock={board_time_ticks(),0,0};
  uint32_t milliseconds=0;
  bool old_usb=false,old_ble_connection=false;
  for(;;) {
    board_poll_encoder();
    nd_usb_time(milliseconds);
    nd_ble_poll();nd_usb_poll();
    bool usb=nd_usb_ready(),ble=nd_ble_ready();
    bool ble_connection=nd_ble_connected();
    if(old_usb&&!usb)c5_config_transport_lost(1);
    if(old_ble_connection&&!ble_connection)c5_config_transport_lost(2);
    old_usb=usb;old_ble_connection=ble_connection;
    c5_features_link_source(1,usb);
    c5_features_link_source(2,nd_ble_features_ready());
    c5_link(usb,ble);
    if(!usb)ack_pending[0]=false;
    if(!nd_ble_connected())ack_pending[1]=false;
    if(ack_pending[0]&&nd_usb_config_send(ack[0]))ack_pending[0]=false;
    if(ack_pending[1]&&nd_ble_config_ready()&&nd_ble_config_send(ack[1]))ack_pending[1]=false;
    nd_reconfigure_poll(milliseconds,ack_pending[0],ack_pending[1]);
    uint32_t current_ms=c5_app_clock_poll(&clock,board_time_ticks());
    if(current_ms!=milliseconds) {
      milliseconds=current_ms;
      board_tick(milliseconds);
      if(board_take_pairing_request())nd_ble_start_pairing(milliseconds);
      nd_ble_pairing_tick(milliseconds);
      c5_pairing_indicator(nd_ble_pairing_active(),nd_ble_pairing_light(milliseconds));
      c5_tick(milliseconds);c5_features_tick(milliseconds);
    }
  }
}
