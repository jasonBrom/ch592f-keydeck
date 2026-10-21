/* CH592 USB FS composite HID: input devices + independent WebHID interface.
 * Register programming follows WCH CH59x_usbdev.c, SDK a46e0086.
 * Copyright (c) 2026 C5 contributors; WCH-derived register sequencing is for WCH MCUs.
 */
#include "CH59x_common.h"
#include "usb_transport.h"
#include "hid_reports.h"
#include "hid_features.h"
#include "c5.h"
#include "report_rates.h"
#include "relative_report.h"
#include <string.h>

#ifndef C5_USB_VID
#define C5_USB_VID 0x1209 /* Prototype-only identity; obtain a VID/PID allocation for distribution. */
#endif
#ifndef C5_USB_PID
#define C5_USB_PID 0xc592
#endif
#define LO(x) ((x)&255)
#define HI(x) (((x)>>8)&255)
static const uint8_t hid_map[] = { C5_FULL_HID_REPORT_MAP_BYTES };
static const uint8_t cfg_map[] = { C5_CONFIG_REPORT_MAP_BYTES };
static const uint8_t dev_desc[] = {18,1,0,2,0,0,0,64,LO(C5_USB_VID),HI(C5_USB_VID),LO(C5_USB_PID),HI(C5_USB_PID),1,1,1,2,3,1};
static uint8_t cfg_desc[] = {
  9,2,66,0,2,1,0,0x80,50,
  9,4,0,0,1,3,0,0,0,
  9,0x21,0x11,1,0,1,0x22,LO(sizeof(hid_map)),HI(sizeof(hid_map)),
  7,5,0x81,3,16,0,1,
  9,4,1,0,2,3,0,0,0,
  9,0x21,0x11,1,0,1,0x22,LO(sizeof(cfg_map)),HI(sizeof(cfg_map)),
  7,5,0x82,3,64,0,1,
  7,5,0x02,3,64,0,1
};
static const uint8_t lang_desc[] = {4,3,9,4};
static const uint8_t maker_desc[] = {6,3,'C',0,'5',0};
static const uint8_t product_desc[] = {26,3,'C',0,'5',0,' ',0,'D',0,'i',0,'a',0,'l',0,' ',0,'R',0,'e',0,'v',0,'E',0};
static uint8_t serial_desc[26];
static __attribute__((aligned(4))) uint8_t ep0[64], ep1[64], ep2[128];
static volatile uint8_t configured, suspended, input_busy, config_busy;
static bool attached;
static uint8_t active_interval_ms=1;
static uint32_t usb_milliseconds, last_report_milliseconds;
static volatile uint8_t q_head,q_tail;
struct usb_report { uint8_t size, bytes[9]; };
static struct usb_report queue[16];
static uint8_t last_report[4][9];
static const uint8_t report_len[4]={8,2,3,4};
static volatile uint8_t command_pending;
static uint8_t command[20], control_out[64], config_reply[64];
static uint16_t control_received, control_expected;
static uint8_t control_req,control_type,control_if,control_report,pending_address;
static uint8_t idle_rate[2],protocol[2]={1,1};
static const uint8_t *control_data;
static uint16_t control_left;
static uint8_t control_zlp;
static uint8_t config_sent;
static uint8_t control_scratch[64];
static volatile uint8_t feature_pending, control_generation;
static uint8_t control_report_type;

static void reset_queues(void) {
  q_head=q_tail=0; input_busy=0; config_busy=0; command_pending=0;
  last_report_milliseconds=usb_milliseconds-active_interval_ms;
  config_sent=0; control_received=control_expected=0;feature_pending=0;
  memset(last_report,0,sizeof(last_report));
  R8_UEP1_T_LEN=R8_UEP2_T_LEN=0;
  R8_UEP1_CTRL=UEP_T_RES_NAK; R8_UEP2_CTRL=UEP_R_RES_ACK|UEP_T_RES_NAK;
}
static void stall(void) { R8_UEP0_CTRL=RB_UEP_R_TOG|RB_UEP_T_TOG|UEP_R_RES_STALL|UEP_T_RES_STALL; }
static void control_next(void) {
  uint8_t n=control_left>64?64:(uint8_t)control_left;
  if(n) {memcpy(ep0,control_data,n);control_data+=n;control_left-=n;}
  else control_zlp=0;
  R8_UEP0_T_LEN=n;
  R8_UEP0_CTRL=(R8_UEP0_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_ACK;
}
static void control_read(const uint8_t *p,uint16_t n,uint16_t requested) {
  uint16_t actual=n<requested?n:requested;
  control_zlp=(actual<requested && (actual%64)==0);
  control_data=p;control_left=actual;control_next();
}
static void status_in(void) {R8_UEP0_T_LEN=0;R8_UEP0_CTRL=RB_UEP_R_TOG|RB_UEP_T_TOG|UEP_R_RES_ACK|UEP_T_RES_ACK;}
static void setup(void) {
  uint8_t s[8]; memcpy(s,ep0,8);
  uint16_t value=s[2]|((uint16_t)s[3]<<8), index=s[4]|((uint16_t)s[5]<<8),length=s[6]|((uint16_t)s[7]<<8);
  control_req=s[1];control_type=s[0];control_if=(uint8_t)index;control_report=(uint8_t)value;
  control_data=0;control_left=control_received=control_expected=0;control_zlp=0;
  ++control_generation;feature_pending=0;control_report_type=(uint8_t)(value>>8);
  R8_UEP0_CTRL=RB_UEP_R_TOG|RB_UEP_T_TOG|UEP_R_RES_ACK|UEP_T_RES_NAK;
  if((s[0]&0x60)==0) {
    switch(s[1]) {
    case 6: {
      const uint8_t *p=0;uint16_t n=0;
      switch(value>>8) {
      case 1:p=dev_desc;n=sizeof(dev_desc);break;
      case 2:p=cfg_desc;n=sizeof(cfg_desc);break;
      case 3:
        switch(value&255) {case 0:p=lang_desc;break;case 1:p=maker_desc;break;case 2:p=product_desc;break;case 3:p=serial_desc;break;}
        if(p)n=p[0];
        break;
      case 0x21:if(index<2){p=cfg_desc+(index?43:18);n=9;}break;
      case 0x22:if(index==0){p=hid_map;n=sizeof(hid_map);}else if(index==1){p=cfg_map;n=sizeof(cfg_map);}break;
      default:break; /* FS-only: stall DEVICE_QUALIFIER as required. */
      }
      if(!p) {stall();return;} control_read(p,n,length);return;
    }
    case 5:if(value>127||length){stall();return;}pending_address=(uint8_t)value;status_in();return;
    case 9:if(value>1||length){stall();return;}configured=(uint8_t)value;reset_queues();status_in();return;
    case 8:control_scratch[0]=configured;control_read(control_scratch,1,length);return;
    case 0:
      control_scratch[0]=control_scratch[1]=0;
      if((s[0]&15)==2) {
        if(index==0x81)control_scratch[0]=((R8_UEP1_CTRL&MASK_UEP_T_RES)==UEP_T_RES_STALL);
        else if(index==0x82)control_scratch[0]=((R8_UEP2_CTRL&MASK_UEP_T_RES)==UEP_T_RES_STALL);
        else if(index==0x02)control_scratch[0]=((R8_UEP2_CTRL&MASK_UEP_R_RES)==UEP_R_RES_STALL);
        else if(index!=0&&index!=0x80){stall();return;}
      }
      control_read(control_scratch,2,length);return;
    case 1:case 3: /* only endpoint halt; remote wakeup isn't advertised */
      if((s[0]&15)!=2||value!=0){stall();return;}
      if(index==0x81){R8_UEP1_CTRL=s[1]==3?UEP_T_RES_STALL:UEP_T_RES_NAK;input_busy=0;}
      else if(index==0x82){R8_UEP2_CTRL=s[1]==3?UEP_T_RES_STALL:UEP_T_RES_NAK;config_busy=0;}
      else if(index==0x02){R8_UEP2_CTRL=(R8_UEP2_CTRL&~(RB_UEP_R_TOG|MASK_UEP_R_RES))|(s[1]==3?UEP_R_RES_STALL:UEP_R_RES_ACK);}
      else {stall();return;}status_in();return;
    case 10:if(index>1){stall();return;}control_scratch[0]=0;control_read(control_scratch,1,length);return;
    case 11:if(index>1||value){stall();return;}status_in();return;
    default:stall();return;
    }
  }
  if((s[0]&0x7f)!=0x21||index>1){stall();return;}
  switch(s[1]) {
  case 1: /* GET_REPORT */
    if(index==0&&(value>>8)==3) {
      size_t n=c5_features_get(control_report,control_scratch+1,63);
      if(!n){stall();return;}control_scratch[0]=control_report;
      control_read(control_scratch,(uint16_t)(n+1),length);return;
    }
    if((value>>8)!=1){stall();return;}
    if(index==0 && control_report>=1 && control_report<=4){control_scratch[0]=control_report;memcpy(control_scratch+1,last_report[control_report-1],report_len[control_report-1]);control_read(control_scratch,1+report_len[control_report-1],length);return;}
    if(index==1&&control_report==0x20){control_read(config_reply,64,length);return;}stall();return;
  case 9: /* SET_REPORT is deferred until *all* 64 bytes have arrived. */
    if(index==0&&length>=2&&length<=51&&((value>>8)==3||(value>>8)==2)&&
       (control_report==5||(control_report>=0x10&&control_report<=0x15))) {
      control_expected=length;return;
    }
    if((value>>8)!=2){stall();return;}
    if(index==1&&control_report==0x20&&length==64&&!command_pending){control_expected=64;return;}
    if(index==0&&control_report==1&&length==2){control_expected=2;return;}
    stall();return;
  case 2:control_scratch[0]=idle_rate[index];control_read(control_scratch,1,length);return;
  case 3:control_scratch[0]=protocol[index];control_read(control_scratch,1,length);return;
  case 10:idle_rate[index]=(uint8_t)(value>>8);status_in();return;
  case 11:if(value>1){stall();return;}protocol[index]=(uint8_t)value;status_in();return;
  default:stall();return;
  }
}
static void config_next(void) {
  uint8_t n=(64-config_sent)>64?64:(uint8_t)(64-config_sent);
  memcpy(ep2+64,config_reply+config_sent,n); config_sent+=n;
  R8_UEP2_T_LEN=n;R8_UEP2_CTRL=(R8_UEP2_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_ACK;
}
__INTERRUPT __HIGH_CODE void USB_IRQHandler(void) {
  uint8_t flags=R8_USB_INT_FG;
  if(flags&RB_UIF_BUS_RST) {
    configured=0;suspended=0;R8_USB_DEV_AD=0;reset_queues();R8_UEP0_CTRL=UEP_R_RES_ACK|UEP_T_RES_NAK;
    R8_USB_INT_FG=RB_UIF_BUS_RST;return;
  }
  if(flags&RB_UIF_TRANSFER) {
    uint8_t st=R8_USB_INT_ST;
    if(st&RB_UIS_SETUP_ACT)setup();
    else switch(st&(MASK_UIS_TOKEN|MASK_UIS_ENDP)) {
    case UIS_TOKEN_IN:
      R8_UEP0_CTRL^=RB_UEP_T_TOG;
      if(control_req==5 && (control_type&0x60)==0) {R8_USB_DEV_AD=pending_address;R8_UEP0_CTRL=UEP_R_RES_ACK|UEP_T_RES_NAK;}
      else if(control_left||control_zlp)control_next();
      else R8_UEP0_CTRL=(R8_UEP0_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_NAK;
      break;
    case UIS_TOKEN_OUT:
      if(!(st&RB_UIS_TOG_OK))break;
      if(control_expected) {
        uint8_t n=R8_USB_RX_LEN;
        if(!n||control_received+n>control_expected){stall();break;}
        memcpy(control_out+control_received,ep0,n);control_received+=n;
        R8_UEP0_CTRL^=RB_UEP_R_TOG;
        if(control_received==control_expected) {
          if(control_out[0]!=control_report){stall();break;}
          if(control_if==1){memcpy(command,control_out+1,20);command_pending=1;}
          if(control_if==0&&control_report!=1) {
            feature_pending=1;control_expected=0;
            R8_UEP0_CTRL=(R8_UEP0_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_NAK;
          } else {control_expected=0;status_in();}
        }
      }break;
    case UIS_TOKEN_IN|1:
      R8_UEP1_CTRL^=RB_UEP_T_TOG;R8_UEP1_CTRL=(R8_UEP1_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_NAK;input_busy=0;break;
    case UIS_TOKEN_OUT|2:
      if(st&RB_UIS_TOG_OK) {
        R8_UEP2_CTRL^=RB_UEP_R_TOG;
        if(R8_USB_RX_LEN==64&&ep2[0]==0x20&&!command_pending) {
          memcpy(command,ep2+1,20);command_pending=1;
          R8_UEP2_CTRL=(R8_UEP2_CTRL&~MASK_UEP_R_RES)|UEP_R_RES_NAK;
        }
      }break;
    case UIS_TOKEN_IN|2:
      R8_UEP2_CTRL^=RB_UEP_T_TOG;
      if(config_sent<64)config_next();
      else {R8_UEP2_CTRL=(R8_UEP2_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_NAK;config_busy=0;}break;
    default:break;
    }
    R8_USB_INT_FG=RB_UIF_TRANSFER;
  }
  if(flags&RB_UIF_SUSPEND) {
    suspended=(R8_USB_MIS_ST&RB_UMS_SUSPEND)?1:0;
    if(suspended)reset_queues();
    R8_USB_INT_FG=RB_UIF_SUSPEND;
  }
}
void nd_usb_time(uint32_t milliseconds){usb_milliseconds=milliseconds;}
uint8_t nd_usb_interval_ms(void){return active_interval_ms;}
bool nd_usb_config_idle(void){return !config_busy&&!command_pending;}
void nd_usb_detach(void) {
  PFIC_DisableIRQ(USB_IRQn);
  attached=false;configured=suspended=0;
  R8_USB_INT_EN=0;
  R16_PIN_ANALOG_IE&=~RB_PIN_USB_DP_PU;
  R8_USB_CTRL&=~RB_UC_DEV_PU_EN;
  R8_UDEV_CTRL&=~RB_UD_PORT_EN;
  reset_queues();R8_USB_INT_FG=0xff;
}
void nd_usb_init(void) {
  nd_usb_attach(c5_usb_interval_for_setting(c5_config()[19]));
}
void nd_usb_attach(uint8_t interval_ms) {
  active_interval_ms=(interval_ms==1||interval_ms==2||interval_ms==4||interval_ms==8)?interval_ms:1;
  cfg_desc[33]=active_interval_ms; /* Endpoint 0x81 bInterval; config endpoints stay at 1 ms. */
  configured=suspended=0;attached=true;
  uint8_t mac[6];GetMACAddress(mac);static const char hex[]="0123456789ABCDEF";
  serial_desc[0]=sizeof(serial_desc);serial_desc[1]=3;
  for(unsigned i=0;i<6;i++){serial_desc[2+i*4]=hex[mac[i]>>4];serial_desc[4+i*4]=hex[mac[i]&15];}
  memset(config_reply,0,sizeof(config_reply));config_reply[0]=0x20;
  R8_USB_CTRL=0;R8_UEP4_1_MOD=RB_UEP1_TX_EN;R8_UEP2_3_MOD=RB_UEP2_TX_EN|RB_UEP2_RX_EN;
  R16_UEP0_DMA=(uint16_t)(uintptr_t)ep0;R16_UEP1_DMA=(uint16_t)(uintptr_t)ep1;R16_UEP2_DMA=(uint16_t)(uintptr_t)ep2;
  R8_UEP0_CTRL=UEP_R_RES_ACK|UEP_T_RES_NAK;reset_queues();R8_USB_DEV_AD=0;
  R8_USB_CTRL=RB_UC_DEV_PU_EN|RB_UC_INT_BUSY|RB_UC_DMA_EN;
  R16_PIN_ANALOG_IE|=RB_PIN_USB_IE|RB_PIN_USB_DP_PU;
  R8_USB_INT_FG=0xff;R8_UDEV_CTRL=RB_UD_PD_DIS|RB_UD_PORT_EN;
  R8_USB_INT_EN=RB_UIE_SUSPEND|RB_UIE_BUS_RST|RB_UIE_TRANSFER;
  PFIC_EnableIRQ(USB_IRQn);
}
bool nd_usb_ready(void){return attached&&configured&&!suspended&&!(R8_USB_MIS_ST&RB_UMS_SUSPEND);}
bool nd_usb_send(uint8_t id,const uint8_t *data,uint8_t n) {
  if(!nd_usb_ready()||id<1||id>4||n!=report_len[id-1])return false;
  PFIC_DisableIRQ(USB_IRQn);
  if(!nd_usb_ready()){PFIC_EnableIRQ(USB_IRQn);return false;}
  if(q_head!=q_tail){
    struct usb_report *last=&queue[(q_head-1u)&15u];
    if(last->size==n+1&&last->bytes[0]==id&&c5_relative_merge(id,last->bytes+1,data,n)){
      memcpy(last_report[id-1],last->bytes+1,n);PFIC_EnableIRQ(USB_IRQn);return true;
    }
  }
  uint8_t next=(uint8_t)((q_head+1)&15);
  if(next==q_tail){PFIC_EnableIRQ(USB_IRQn);return false;}
  queue[q_head].size=n+1;queue[q_head].bytes[0]=id;memcpy(queue[q_head].bytes+1,data,n);
  memcpy(last_report[id-1],data,n);q_head=next;PFIC_EnableIRQ(USB_IRQn);return true;
}
bool nd_usb_config_send(const uint8_t frame[20]) {
  if(!nd_usb_ready()||config_busy)return false;
  PFIC_DisableIRQ(USB_IRQn);
  if(!nd_usb_ready()||config_busy){PFIC_EnableIRQ(USB_IRQn);return false;}
  config_busy=1;config_sent=0;
  memset(config_reply,0,64);config_reply[0]=0x20;memcpy(config_reply+1,frame,20);config_next();
  PFIC_EnableIRQ(USB_IRQn);return true;
}
void nd_usb_poll(void) {
  if(!attached)return;
  /* Check the controller's live bus state too. Retained USB power after PC
   * shutdown must not keep a stale SET_CONFIGURATION looking like a live host.
   * Polling also recovers a missed suspend/resume interrupt. No VBUS GPIO exists.
   * Do not use time since the last HID report: an idle, awake host is valid. */
  PFIC_DisableIRQ(USB_IRQn);
  uint8_t bus_suspended=(R8_USB_MIS_ST&RB_UMS_SUSPEND)?1:0;
  if(bus_suspended!=suspended){suspended=bus_suspended;if(suspended)reset_queues();}
  PFIC_EnableIRQ(USB_IRQn);
  if(suspended)return;
  if(feature_pending) {
    uint8_t data[50],id,type,generation;uint16_t n;
    PFIC_DisableIRQ(USB_IRQn);
    bool execute=feature_pending&&control_received>=2&&control_received<=51;
    n=0;id=type=generation=0;
    if(execute) {
      n=control_received-1;id=control_report;type=control_report_type;generation=control_generation;
      memcpy(data,control_out+1,n);feature_pending=0;
    }
    PFIC_EnableIRQ(USB_IRQn);
    if(execute) {
      c5_features_link(nd_usb_ready());
      bool success=c5_features_set(type,id,data,n);
      PFIC_DisableIRQ(USB_IRQn);
      if(generation==control_generation) {if(success)status_in();else stall();}
      PFIC_EnableIRQ(USB_IRQn);
    }
  }
  if(command_pending) {
    uint8_t frame[20];PFIC_DisableIRQ(USB_IRQn);
    bool execute=command_pending&&nd_usb_ready();
    if(execute)memcpy(frame,command,20);
    command_pending=0;R8_UEP2_CTRL=(R8_UEP2_CTRL&~MASK_UEP_R_RES)|UEP_R_RES_ACK;
    PFIC_EnableIRQ(USB_IRQn);
    if(execute)nd_platform_config_received(1,frame);
  }
  PFIC_DisableIRQ(USB_IRQn);
  if(nd_usb_ready()&&!input_busy&&q_head!=q_tail&&
     c5_report_period_elapsed(usb_milliseconds,last_report_milliseconds,active_interval_ms)) {
    struct usb_report *r=&queue[q_tail];memcpy(ep1,r->bytes,r->size);R8_UEP1_T_LEN=r->size;
    q_tail=(uint8_t)((q_tail+1)&15);last_report_milliseconds=usb_milliseconds;input_busy=1;R8_UEP1_CTRL=(R8_UEP1_CTRL&~MASK_UEP_T_RES)|UEP_T_RES_ACK;
  }
  PFIC_EnableIRQ(USB_IRQn);
}
