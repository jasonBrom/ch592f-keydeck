/* C5 Rev.E: CH592 HID over GATT and bounded configuration service.
 * Uses the actual WCH CH592 EVT BLE library and HAL. Service registration,
 * notification-buffer ownership and GAP startup follow the vendor Peripheral
 * example. No USB report ID is embedded in a BLE characteristic value.
 */
#include "CONFIG.h"
#include "HAL.h"
#include "ble_transport.h"
#include "hid_reports.h"
#include "report_rates.h"
#include "relative_report.h"
#include "pairing.h"
#include "c5.h"
#ifdef C5_BLE_WINDOWS_FEATURES
#include "hid_features.h"
#include "ble_features.h"
#endif
#include <string.h>

#ifndef C5_USB_VID
#define C5_USB_VID 0x1209
#endif
#ifndef C5_USB_PID
#define C5_USB_PID 0xc592
#endif

#define ND_START_EVENT 0x0001
#define ND_PARAMS_EVENT 0x0002
#define ND_HANDOFF_EVENT 0x0004
#define ND_TX_CAPACITY 16
#define ND_CFG_CAPACITY 2
#define ND_RX_CAPACITY 2
#define ARRAY_COUNT(x) (sizeof(x) / sizeof((x)[0]))
#define UUID16(name, value) static const uint8_t name[2] = {LO_UINT16(value), HI_UINT16(value)}
#define ATTR16(uuid, permit, value) {{ATT_BT_UUID_SIZE, uuid}, permit, 0, (uint8_t *)(value)}
#define ATTR128(uuid, permit, value) {{ATT_UUID_SIZE, uuid}, permit, 0, (uint8_t *)(value)}
#define DECL(props) ATTR16(characterUUID, GATT_PERMIT_READ, &(props))
#define CCC(value) ATTR16(clientCharCfgUUID, GATT_PERMIT_READ | GATT_PERMIT_ENCRYPT_WRITE, value)

__attribute__((aligned(4))) uint32_t MEM_BUF[BLE_MEMHEAP_SIZE / 4];

UUID16(hid_service_uuid, 0x1812);
UUID16(hid_info_uuid, 0x2a4a);
UUID16(hid_map_uuid, 0x2a4b);
UUID16(hid_control_uuid, 0x2a4c);
UUID16(hid_report_uuid, 0x2a4d);
UUID16(hid_reference_uuid, 0x2908);
UUID16(battery_service_uuid, 0x180f);
UUID16(battery_level_uuid, 0x2a19);
UUID16(device_info_uuid, 0x180a);
UUID16(pnp_id_uuid, 0x2a50);
UUID16(model_uuid, 0x2a24);
UUID16(firmware_uuid, 0x2a26);

/* UUIDs are little-endian on the ATT wire. */
static const uint8_t config_service_uuid[16] = {
    0x01,0xe0,0x10,0xb5,0x72,0x5a,0x28,0x9c,0x3b,0x4f,0x1b,0x7a,0x01,0x00,0x92,0xc5};
static const uint8_t config_command_uuid[16] = {
    0x01,0xe0,0x10,0xb5,0x72,0x5a,0x28,0x9c,0x3b,0x4f,0x1b,0x7a,0x02,0x00,0x92,0xc5};
static const uint8_t config_response_uuid[16] = {
    0x01,0xe0,0x10,0xb5,0x72,0x5a,0x28,0x9c,0x3b,0x4f,0x1b,0x7a,0x03,0x00,0x92,0xc5};

static const gattAttrType_t hid_service = {2, hid_service_uuid};
static const gattAttrType_t battery_service = {2, battery_service_uuid};
static const gattAttrType_t device_info_service = {2, device_info_uuid};
static const gattAttrType_t config_service = {16, config_service_uuid};
static const uint8_t hid_information[] = {0x11,0x01,0x00,0x02};
#ifdef C5_BLE_WINDOWS_FEATURES
static const uint8_t hid_report_map[] = {C5_FULL_HID_REPORT_MAP_BYTES};
#else
static const uint8_t hid_report_map[] = {C5_HID_REPORT_MAP_BYTES};
#endif
/* Bluetooth Core ATT caps one attribute at512 octets, regardless of MTU.
 * Long Read support does not waive that limit. Guard descriptor regressions. */
_Static_assert(sizeof(hid_report_map)<=512u,"BLE HID Report Map exceeds ATT attribute limit");
/* USB-IF namespace; prototype IDs must be replaced by assigned IDs for sale. */
static const uint8_t pnp_id[] = {2, LO_UINT16(C5_USB_VID), HI_UINT16(C5_USB_VID),
    LO_UINT16(C5_USB_PID), HI_UINT16(C5_USB_PID), 0x01, 0x01};
static const uint8_t model_name[] = "C5 Rev.E";
static const uint8_t firmware_version[] = "1.15.0";

static uint8_t property_read = GATT_PROP_READ;
static uint8_t property_input = GATT_PROP_READ | GATT_PROP_NOTIFY;
static uint8_t property_output = GATT_PROP_READ | GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP;
static uint8_t property_control = GATT_PROP_WRITE_NO_RSP;
static uint8_t property_command = GATT_PROP_WRITE;
static uint8_t property_response = GATT_PROP_NOTIFY;
static uint8_t control_point;
static uint8_t keyboard_leds;
static uint8_t battery_level;
static uint8_t input_values[4][8];
static uint8_t config_command[20], config_response[20];
static const uint8_t input_lengths[4] = {8,2,3,4};
static const uint8_t report_references[5][2] = {{1,1},{2,1},{3,1},{4,1},{1,2}};
#ifdef C5_BLE_WINDOWS_FEATURES
/* Value entries carry metadata; reads/writes are served by ble_features.
 * Their first two bytes also form the HOGP Report Reference descriptor. */
static const uint8_t feature_references[8][2] = {
    {C5_HAPTIC_ID,2},{C5_HAPTIC_ID,3},
    {C5_LAMP_ARRAY_ID,3},{C5_LAMP_REQUEST_ID,3},{C5_LAMP_RESPONSE_ID,3},
    {C5_LAMP_MULTI_ID,3},{C5_LAMP_RANGE_ID,3},{C5_LAMP_CONTROL_ID,3}
};
static uint8_t property_feature=GATT_PROP_READ|GATT_PROP_WRITE;
#define FEATURE_REPORT(index,props) \
    DECL(props), ATTR16(hid_report_uuid,GATT_PERMIT_ENCRYPT_READ|GATT_PERMIT_ENCRYPT_WRITE,feature_references[index]), \
    ATTR16(hid_reference_uuid,GATT_PERMIT_READ,feature_references[index])
#endif
static gattCharCfg_t hid_ccc[4][GATT_MAX_NUM_CONN];
static gattCharCfg_t config_ccc[GATT_MAX_NUM_CONN];
static gattCharCfg_t battery_ccc[GATT_MAX_NUM_CONN];

enum {
    HID_SERVICE, HID_INFO_DECL, HID_INFO_VALUE, HID_MAP_DECL, HID_MAP_VALUE,
    HID_CONTROL_DECL, HID_CONTROL_VALUE,
    HID_KEY_DECL, HID_KEY_VALUE, HID_KEY_CCC, HID_KEY_REF,
    HID_CONSUMER_DECL, HID_CONSUMER_VALUE, HID_CONSUMER_CCC, HID_CONSUMER_REF,
    HID_RADIAL_DECL, HID_RADIAL_VALUE, HID_RADIAL_CCC, HID_RADIAL_REF,
    HID_MOUSE_DECL, HID_MOUSE_VALUE, HID_MOUSE_CCC, HID_MOUSE_REF,
    HID_LED_DECL, HID_LED_VALUE, HID_LED_REF
};
static const uint8_t input_attribute_indices[4] = {
    HID_KEY_VALUE, HID_CONSUMER_VALUE, HID_RADIAL_VALUE, HID_MOUSE_VALUE};
static gattAttribute_t hid_attributes[] = {
    ATTR16(primaryServiceUUID, GATT_PERMIT_READ, &hid_service),
    DECL(property_read), ATTR16(hid_info_uuid, GATT_PERMIT_ENCRYPT_READ, hid_information),
    DECL(property_read), ATTR16(hid_map_uuid, GATT_PERMIT_ENCRYPT_READ, hid_report_map),
    DECL(property_control), ATTR16(hid_control_uuid, GATT_PERMIT_ENCRYPT_WRITE, &control_point),
    DECL(property_input), ATTR16(hid_report_uuid, GATT_PERMIT_ENCRYPT_READ, input_values[0]),
    CCC(hid_ccc[0]), ATTR16(hid_reference_uuid, GATT_PERMIT_READ, report_references[0]),
    DECL(property_input), ATTR16(hid_report_uuid, GATT_PERMIT_ENCRYPT_READ, input_values[1]),
    CCC(hid_ccc[1]), ATTR16(hid_reference_uuid, GATT_PERMIT_READ, report_references[1]),
    DECL(property_input), ATTR16(hid_report_uuid, GATT_PERMIT_ENCRYPT_READ, input_values[2]),
    CCC(hid_ccc[2]), ATTR16(hid_reference_uuid, GATT_PERMIT_READ, report_references[2]),
    DECL(property_input), ATTR16(hid_report_uuid, GATT_PERMIT_ENCRYPT_READ, input_values[3]),
    CCC(hid_ccc[3]), ATTR16(hid_reference_uuid, GATT_PERMIT_READ, report_references[3]),
    DECL(property_output), ATTR16(hid_report_uuid,
        GATT_PERMIT_ENCRYPT_READ | GATT_PERMIT_ENCRYPT_WRITE, &keyboard_leds),
    ATTR16(hid_reference_uuid, GATT_PERMIT_READ, report_references[4])
#ifdef C5_BLE_WINDOWS_FEATURES
#ifndef C5_NO_HAPTICS
    , FEATURE_REPORT(0,property_output), FEATURE_REPORT(1,property_feature)
#endif
    , FEATURE_REPORT(2,property_feature), FEATURE_REPORT(3,property_feature),
    FEATURE_REPORT(4,property_feature), FEATURE_REPORT(5,property_feature),
    FEATURE_REPORT(6,property_feature), FEATURE_REPORT(7,property_feature)
#endif
};
static gattAttribute_t config_attributes[] = {
    ATTR16(primaryServiceUUID, GATT_PERMIT_READ, &config_service),
    DECL(property_command), ATTR128(config_command_uuid, GATT_PERMIT_ENCRYPT_WRITE, config_command),
    DECL(property_response), ATTR128(config_response_uuid, 0, config_response),
    CCC(config_ccc)
};
static gattAttribute_t battery_attributes[] = {
    ATTR16(primaryServiceUUID, GATT_PERMIT_READ, &battery_service),
    DECL(property_input), ATTR16(battery_level_uuid, GATT_PERMIT_ENCRYPT_READ, &battery_level),
    CCC(battery_ccc)
};
static gattAttribute_t device_info_attributes[] = {
    ATTR16(primaryServiceUUID, GATT_PERMIT_READ, &device_info_service),
    DECL(property_read), ATTR16(pnp_id_uuid, GATT_PERMIT_READ, pnp_id),
    DECL(property_read), ATTR16(model_uuid, GATT_PERMIT_READ, model_name),
    DECL(property_read), ATTR16(firmware_uuid, GATT_PERMIT_READ, firmware_version)
};

typedef struct { uint8_t id, length, epoch, data[8]; } hid_packet_t;
static hid_packet_t tx_queue[ND_TX_CAPACITY];
static uint8_t cfg_queue[ND_CFG_CAPACITY][20];
static uint8_t rx_queue[ND_RX_CAPACITY][20];
static uint8_t tx_head, tx_count, cfg_head, cfg_count, rx_head, rx_count;
static uint8_t task_id = INVALID_TASK_ID;
static uint16_t connection = GAP_CONNHANDLE_INIT;
static bool initialized, service_ok, suspended;
static c5_pair_session pairing;
static bool connection_rejected;
static bStatus_t pairing_status;
static uint32_t pairing_now_ms, pairing_retry_ms, connection_started_ms;
static uint32_t battery_sample_time;
static bool battery_pending;
static uint8_t report_epoch[4], neutral_pending;
static uint16_t actual_interval,requested_interval=6;

static uint8_t advertising_data[] = {
    2,GAP_ADTYPE_FLAGS,GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED,
    3,GAP_ADTYPE_APPEARANCE,0xc1,0x03,
    3,GAP_ADTYPE_16BIT_MORE,0x12,0x18,
    17,GAP_ADTYPE_128BIT_MORE,
    0x01,0xe0,0x10,0xb5,0x72,0x5a,0x28,0x9c,0x3b,0x4f,0x1b,0x7a,0x01,0x00,0x92,0xc5
};
static uint8_t scan_response[] = {9,GAP_ADTYPE_LOCAL_NAME_COMPLETE,
    'C','5',' ','R','e','v','.','E'};
static uint8_t device_name[GAP_DEVICE_NAME_LEN] = "C5 Rev.E";

static bool encrypted(void) {
    return !connection_rejected && connection != GAP_CONNHANDLE_INIT && linkDB_Up(connection)
        && linkDB_State(connection, LINK_ENCRYPTED);
}
static bool subscribed(gattCharCfg_t *ccc) {
    return encrypted() && (GATTServApp_ReadCharCfg(connection, ccc) & GATT_CLIENT_CFG_NOTIFY);
}
static void reset_queues(void) {
    tx_head = tx_count = cfg_head = cfg_count = rx_head = rx_count = 0;
    suspended = false;
    battery_pending = false;
    neutral_pending = 0;
    memset(input_values, 0, sizeof(input_values));
#ifdef C5_BLE_WINDOWS_FEATURES
    nd_ble_features_reset();
#endif
}
static void reset_ccc(uint16_t handle) {
    for (uint8_t i=0; i<4; ++i) GATTServApp_InitCharCfg(handle, hid_ccc[i]);
    GATTServApp_InitCharCfg(handle, config_ccc);
    GATTServApp_InitCharCfg(handle, battery_ccc);
}
static bStatus_t read_value(const uint8_t *source, uint16_t size, uint8_t *out,
                           uint16_t *length, uint16_t offset, uint16_t maximum) {
    if (offset > size) return ATT_ERR_INVALID_OFFSET;
    *length = size - offset;
    if (*length > maximum) *length = maximum;
    memcpy(out, source + offset, *length);
    return SUCCESS;
}
static bStatus_t attribute_read(uint16_t handle, gattAttribute_t *attribute,
    uint8_t *out, uint16_t *length, uint16_t offset, uint16_t maximum, uint8_t method) {
    (void)method;
    if(connection_rejected && handle==connection)return ATT_ERR_UNLIKELY;
    const uint8_t *value = attribute->pValue;
    uint16_t size = 0;
#ifdef C5_BLE_WINDOWS_FEATURES
    for (uint8_t i=0;i<ARRAY_COUNT(feature_references);i++) if(value==feature_references[i]) {
        if (attribute->type.len==2 && BUILD_UINT16(attribute->type.uuid[0],attribute->type.uuid[1])==0x2908)
            return read_value(value,2,out,length,offset,maximum);
        c5_features_link_source(C5_FEATURE_BLE,nd_ble_features_ready());
        return nd_ble_feature_read(value[1],value[0],out,length,offset,maximum);
    }
#endif
    if (value == hid_information) size = sizeof(hid_information);
    else if (value == hid_report_map) size = sizeof(hid_report_map);
    else if (value == pnp_id) size = sizeof(pnp_id);
    else if (value == model_name) size = sizeof(model_name)-1;
    else if (value == firmware_version) size = sizeof(firmware_version)-1;
    else if (value == &keyboard_leds) size = 1;
    else if (value == &battery_level) {
        uint8_t flags=0, percent=255; uint16_t millivolts=0;
        c5_hal_status(&flags, &percent, &millivolts);
        /* An unknown measurement must not masquerade as a charged battery. */
        if (percent > 100) return ATT_ERR_UNLIKELY;
        battery_level = percent; size = 1;
    } else {
        for (uint8_t i=0; i<4; ++i) if (value == input_values[i]) size = input_lengths[i];
        for (uint8_t i=0; i<5; ++i) if (value == report_references[i]) size = 2;
    }
    if (!size) { *length = 0; return ATT_ERR_ATTR_NOT_FOUND; }
    return read_value(value, size, out, length, offset, maximum);
}
static bStatus_t attribute_write(uint16_t handle, gattAttribute_t *attribute,
    uint8_t *value, uint16_t length, uint16_t offset, uint8_t method) {
    if(connection_rejected && handle==connection)return ATT_ERR_UNLIKELY;
#ifdef C5_BLE_WINDOWS_FEATURES
    for (uint8_t i=0;i<ARRAY_COUNT(feature_references);i++)
        if(attribute->pValue==feature_references[i]) {
            c5_features_link_source(C5_FEATURE_BLE,nd_ble_features_ready());
            return nd_ble_feature_write(feature_references[i][1],feature_references[i][0],
                value,length,offset,method);
        }
    /* All other writable values fit a default-MTU Write Request. Reject queued
     * reliable transactions here so a mixed CCC/config/Feature transaction
     * cannot partially activate host lighting or leave a staged update behind. */
    if(method==ATT_PREPARE_WRITE_REQ || method==ATT_EXECUTE_WRITE_REQ) {
        nd_ble_feature_reject_other(method);
        return ATT_ERR_ATTR_NOT_LONG;
    }
#else
    (void)method;
#endif
    if (attribute->type.len == 2 && BUILD_UINT16(attribute->type.uuid[0],
            attribute->type.uuid[1]) == GATT_CLIENT_CHAR_CFG_UUID) {
        gattCharCfg_t *ccc=(gattCharCfg_t *)attribute->pValue;
        uint16_t previous=GATTServApp_ReadCharCfg(handle,ccc);
        bStatus_t result=GATTServApp_ProcessCCCWriteReq(handle,attribute,value,length,
            offset,GATT_CLIENT_CFG_NOTIFY);
        uint16_t current=GATTServApp_ReadCharCfg(handle,ccc);
        if(result==SUCCESS && previous!=current) {
            for(uint8_t i=0;i<4;i++) if(ccc==hid_ccc[i]) {
                ++report_epoch[i]; /* Old queued presses cannot survive unsubscribe/resubscribe. */
                memset(input_values[i],0,sizeof(input_values[i]));
                if(current&GATT_CLIENT_CFG_NOTIFY)neutral_pending|=(uint8_t)(1u<<i);
                else neutral_pending&=(uint8_t)~(1u<<i);
            }
        }
        return result;
    }
    if (offset) return ATT_ERR_INVALID_OFFSET;
    if (attribute->pValue == &keyboard_leds) {
        if (length != 1) return ATT_ERR_INVALID_VALUE_SIZE;
        keyboard_leds = value[0] & 0x1f;
        return SUCCESS;
    }
    if (attribute->pValue == &control_point) {
        if (length != 1 || value[0] > 1) return ATT_ERR_INVALID_VALUE_SIZE;
        control_point = value[0]; suspended = value[0] == 0;
        tx_head=tx_count=0;
        memset(input_values,0,sizeof(input_values));
        neutral_pending=0;
        for(uint8_t i=0;i<4;i++) {
            ++report_epoch[i];
            if(!suspended&&subscribed(hid_ccc[i]))neutral_pending|=(uint8_t)(1u<<i);
        }
        return SUCCESS;
    }
    if (attribute->pValue == config_command) {
        if (length != 20) return ATT_ERR_INVALID_VALUE_SIZE;
        if (!subscribed(config_ccc)) return ATT_ERR_UNLIKELY;
        if (rx_count == ND_RX_CAPACITY) return ATT_ERR_INSUFFICIENT_RESOURCES;
        memcpy(rx_queue[(rx_head + rx_count) % ND_RX_CAPACITY], value, 20);
        ++rx_count;
        return SUCCESS;
    }
    return ATT_ERR_WRITE_NOT_PERMITTED;
}
static gattServiceCBs_t service_callbacks = {attribute_read, attribute_write, NULL};

static void link_changed(uint16_t handle, uint8_t change) {
    if (handle == LOOPBACK_CONNHANDLE) return;
    if (change == LINKDB_STATUS_UPDATE_REMOVED ||
        (change == LINKDB_STATUS_UPDATE_STATEFLAGS && !linkDB_Up(handle))) {
        reset_ccc(handle);
        if (handle == connection) {
            connection = GAP_CONNHANDLE_INIT; actual_interval=0; reset_queues();
            connection_rejected=false;tmos_stop_task(task_id,ND_HANDOFF_EVENT);
            pairing.waiting_disconnect=0;
        }
    }
}
static void role_changed(gapRole_States_t state, gapRoleEvent_t *event) {
    (void)state;
    if (event->gap.opcode == GAP_LINK_ESTABLISHED_EVENT && event->gap.hdr.status == SUCCESS) {
        connection = event->linkCmpl.connectionHandle;
        actual_interval=event->linkCmpl.connInterval;
        reset_queues();
        /* BOOT opens pairing for every host, including the PC just left.
         * An address blacklist made same-PC repair impossible for two minutes. */
        connection_rejected=false;pairing.waiting_disconnect=0;
        connection_started_ms=pairing_now_ms;
        tmos_start_task(task_id, ND_PARAMS_EVENT, MS1_TO_SYSTEM_TIME(1500));
    } else if (event->gap.opcode == GAP_LINK_TERMINATED_EVENT) {
        reset_ccc(event->linkTerminate.connectionHandle);
        if(event->linkTerminate.connectionHandle==connection) {
            connection = GAP_CONNHANDLE_INIT; actual_interval=0; reset_queues();
            connection_rejected=false;pairing.waiting_disconnect=0;
            tmos_stop_task(task_id,ND_PARAMS_EVENT);tmos_stop_task(task_id,ND_HANDOFF_EVENT);
        }
        if(connection==GAP_CONNHANDLE_INIT) {
            uint8_t enable = TRUE;
            GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, sizeof(enable), &enable);
        }
    }
}
static void pair_state_changed(uint16_t handle,uint8_t state,uint8_t status) {
    if(handle!=connection || status==SUCCESS ||
       (state!=GAPBOND_PAIRING_STATE_COMPLETE && state!=GAPBOND_PAIRING_STATE_BONDED))return;
    /* A failed security procedure must not occupy the only connection forever.
     * Keep bonds intact; the host may retry pairing on the next connection. */
    pairing_status=status;connection_rejected=true;
    pairing.waiting_disconnect=1;reset_queues();
    tmos_stop_task(task_id,ND_PARAMS_EVENT);
    (void)GAPRole_TerminateLink(connection);
    tmos_start_task(task_id,ND_HANDOFF_EVENT,MS1_TO_SYSTEM_TIME(100));
}
static void connection_parameters_changed(uint16_t handle,uint16_t interval,
    uint16_t latency,uint16_t timeout) {
    (void)latency;(void)timeout;
    if(handle==connection)actual_interval=interval;
}
static gapRolesCBs_t role_callbacks = {role_changed, NULL, connection_parameters_changed};
static gapBondCBs_t bond_callbacks = {NULL, pair_state_changed, NULL};

static uint16_t process_events(uint8_t id, uint16_t events) {
    if (events & SYS_EVENT_MSG) {
        uint8_t *message;
        while ((message=tmos_msg_receive(id)) != NULL) {
            /* Server notifications have no GATT client response allocation. */
            tmos_msg_deallocate(message);
        }
        return events ^ SYS_EVENT_MSG;
    }
    if (events & ND_START_EVENT) {
        if (service_ok) pairing_status=GAPRole_PeripheralStartDevice(id, &bond_callbacks, &role_callbacks);
        return events ^ ND_START_EVENT;
    }
    if (events & ND_PARAMS_EVENT) {
        if (connection != GAP_CONNHANDLE_INIT)
            GAPRole_PeripheralConnParamUpdateReq(connection, requested_interval, requested_interval, 0, 400, id);
        return events ^ ND_PARAMS_EVENT;
    }
    if(events & ND_HANDOFF_EVENT) {
        if(connection_rejected && connection!=GAP_CONNHANDLE_INIT) {
            pairing_status=GAPRole_TerminateLink(connection);
            tmos_start_task(id,ND_HANDOFF_EVENT,MS1_TO_SYSTEM_TIME(100));
        }
        return events ^ ND_HANDOFF_EVENT;
    }
    return 0;
}

void nd_ble_init(void) {
    if (initialized) return;
    initialized = true;
    CH59x_BLEInit();
    HAL_Init();
    GAPRole_PeripheralInit();
    task_id = TMOS_ProcessEventRegister(process_events);
    reset_queues(); reset_ccc(INVALID_CONNHANDLE);
    uint8_t enable=TRUE, pair_mode=GAPBOND_PAIRING_MODE_INITIATE;
    uint8_t no_mitm=FALSE, io=GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT;
    requested_interval=c5_ble_interval_for_setting(c5_config()[24]);
    uint16_t minimum=requested_interval, maximum=requested_interval, advertising_interval=160;
    GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &enable);
    GAPRole_SetParameter(GAPROLE_ADVERT_DATA, sizeof(advertising_data), advertising_data);
    GAPRole_SetParameter(GAPROLE_SCAN_RSP_DATA, sizeof(scan_response), scan_response);
    GAPRole_SetParameter(GAPROLE_MIN_CONN_INTERVAL, 2, &minimum);
    GAPRole_SetParameter(GAPROLE_MAX_CONN_INTERVAL, 2, &maximum);
    GAP_SetParamValue(TGAP_DISC_ADV_INT_MIN, advertising_interval);
    GAP_SetParamValue(TGAP_DISC_ADV_INT_MAX, advertising_interval);
    GAPBondMgr_SetParameter(GAPBOND_PERI_PAIRING_MODE, 1, &pair_mode);
    GAPBondMgr_SetParameter(GAPBOND_PERI_MITM_PROTECTION, 1, &no_mitm);
    GAPBondMgr_SetParameter(GAPBOND_PERI_IO_CAPABILITIES, 1, &io);
    GAPBondMgr_SetParameter(GAPBOND_PERI_BONDING_ENABLED, 1, &enable);
    GGS_AddService(GATT_ALL_SERVICES);
    GATTServApp_AddService(GATT_ALL_SERVICES);
    GGS_SetParameter(GGS_DEVICE_NAME_ATT, GAP_DEVICE_NAME_LEN, device_name);
    gapPeriConnectParams_t params = {requested_interval,requested_interval,0,400};
    GGS_SetParameter(GGS_PERI_CONN_PARAM_ATT, sizeof(params), &params);
    service_ok = GATTServApp_RegisterService(hid_attributes, ARRAY_COUNT(hid_attributes),
        GATT_MAX_ENCRYPT_KEY_SIZE, &service_callbacks) == SUCCESS;
    service_ok &= GATTServApp_RegisterService(config_attributes, ARRAY_COUNT(config_attributes),
        GATT_MAX_ENCRYPT_KEY_SIZE, &service_callbacks) == SUCCESS;
    service_ok &= GATTServApp_RegisterService(battery_attributes, ARRAY_COUNT(battery_attributes),
        GATT_MAX_ENCRYPT_KEY_SIZE, &service_callbacks) == SUCCESS;
    service_ok &= GATTServApp_RegisterService(device_info_attributes, ARRAY_COUNT(device_info_attributes),
        GATT_MAX_ENCRYPT_KEY_SIZE, &service_callbacks) == SUCCESS;
    linkDB_Register(link_changed);
    tmos_set_event(task_id, ND_START_EVENT);
}

bool nd_ble_start_pairing(uint32_t ms) {
    if (!initialized || !service_ok) {
        pairing_status=bleNotReady;
        return false;
    }
    pairing_now_ms=ms;pairing_retry_ms=ms;
    /* linkDB removal may precede the role callback. Do not repeatedly request
     * termination of a handle the controller has already removed. */
    if(connection!=GAP_CONNHANDLE_INIT && !linkDB_Up(connection)) {
        reset_ccc(connection);connection=GAP_CONNHANDLE_INIT;actual_interval=0;reset_queues();
    }
    bool disconnect=connection!=GAP_CONNHANDLE_INIT;
    pairing.started_at=ms;pairing.waiting_disconnect=disconnect;pairing.active=1;
    connection_rejected=disconnect;
    GAP_SetParamValue(TGAP_DISC_ADV_INT_MIN,80);
    GAP_SetParamValue(TGAP_DISC_ADV_INT_MAX,80);
    if (disconnect) pairing_status=GAPRole_TerminateLink(connection);
    else {
        uint8_t enable=TRUE;
        pairing_status=GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED,1,&enable);
    }
    /* A busy asynchronous controller does not cancel the user's request.
     * Retry disconnects below and advertising from the application clock. */
    if(disconnect) {
        reset_queues();tmos_stop_task(task_id,ND_PARAMS_EVENT);
        tmos_start_task(task_id,ND_HANDOFF_EVENT,MS1_TO_SYSTEM_TIME(100));
    }
    return true;
}
void nd_ble_pairing_tick(uint32_t ms) {
    if(!initialized || !service_ok)return;
    pairing_now_ms=ms;
    bool was_active=pairing.active;
    bool usable=nd_ble_ready() || nd_ble_config_ready();
    if (!c5_pair_session_tick(&pairing,ms,usable) && was_active) {
        GAP_SetParamValue(TGAP_DISC_ADV_INT_MIN,160);
        GAP_SetParamValue(TGAP_DISC_ADV_INT_MAX,160);
    }
    /* Recover when the role termination callback is delayed/missing, or an
     * advertising request races a controller state transition. Rate limited. */
    if(connection==GAP_CONNHANDLE_INIT && (uint32_t)(ms-pairing_retry_ms)>=500u) {
        pairing_retry_ms=ms;
        gapRole_States_t state=GAPROLE_INIT;
        if(GAPRole_GetParameter(GAPROLE_STATE,&state)!=SUCCESS ||
           (state&GAPROLE_STATE_ADV_MASK)!=GAPROLE_ADVERTISING) {
            uint8_t enable=TRUE;
            pairing_status=GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED,1,&enable);
        }
    } else if(pairing.active && connection!=GAP_CONNHANDLE_INIT && !connection_rejected &&
              !usable && (uint32_t)(ms-connection_started_ms)>=30000u) {
        /* Encryption/subscription never completed: free the single slot and
         * continue the remaining pairing window rather than staying stuck. */
        connection_rejected=true;pairing.waiting_disconnect=1;reset_queues();
        tmos_stop_task(task_id,ND_PARAMS_EVENT);
        pairing_status=GAPRole_TerminateLink(connection);
        tmos_start_task(task_id,ND_HANDOFF_EVENT,MS1_TO_SYSTEM_TIME(100));
    }
}
bool nd_ble_pairing_active(void) { return pairing.active; }
bool nd_ble_pairing_light(uint32_t ms) { return c5_pair_session_light(&pairing,ms); }
void nd_ble_diagnostics(uint8_t out[12]) {
    gapRole_States_t state=GAPROLE_INIT;
    if (initialized) GAPRole_GetParameter(GAPROLE_STATE,&state);
    memset(out,0,12);
    out[0]=(initialized?1:0)|(service_ok?2:0)|(encrypted()?4:0)|(pairing.active?8:0)|
           (connection_rejected?0x20:0)|(suspended?0x40:0)|(nd_ble_ready()?0x80:0);
    out[1]=(uint8_t)state&0x0f;
    out[2]=pairing_status;
    out[3]=CLK_OSC32K;
    for (unsigned i=0;i<4;++i) out[i+4]=(uint8_t)(pairing.started_at>>(8*i));
}

uint16_t nd_ble_actual_interval(void) {
    return nd_ble_connected()?actual_interval:0;
}
bool nd_ble_config_idle(void){return cfg_count==0&&rx_count==0;}
void nd_ble_request_interval(uint16_t interval_units) {
    if(interval_units!=6&&interval_units!=12&&interval_units!=24)return;
    requested_interval=interval_units;
    GAPRole_SetParameter(GAPROLE_MIN_CONN_INTERVAL,2,&requested_interval);
    GAPRole_SetParameter(GAPROLE_MAX_CONN_INTERVAL,2,&requested_interval);
    gapPeriConnectParams_t params={requested_interval,requested_interval,0,400};
    GGS_SetParameter(GGS_PERI_CONN_PARAM_ATT,sizeof(params),&params);
    /* This is a request, not proof of the negotiated interval. Only the link
     * event / pfnParamUpdate callback updates actual_interval. */
    if(nd_ble_connected())tmos_set_event(task_id,ND_PARAMS_EVENT);
}
bool nd_ble_connected(void) {
    return initialized && !connection_rejected && connection != GAP_CONNHANDLE_INIT && linkDB_Up(connection);
}
bool nd_ble_ready(void) {
    if (!initialized || !service_ok || suspended || !encrypted()) return false;
    for (uint8_t i=0; i<4; ++i) if (subscribed(hid_ccc[i])) return true;
    return false;
}
bool nd_ble_config_ready(void) {
    return initialized && service_ok && subscribed(config_ccc);
}
bool nd_ble_features_ready(void) {
    return initialized && service_ok && !suspended && encrypted();
}
bool nd_ble_send(uint8_t id, const uint8_t *data, uint8_t length) {
    if (id < 1 || id > 4 || length != input_lengths[id-1] || !data ||
        !nd_ble_ready()) return false;
    /* A disabled CCC has no host consumer. Consume without queueing rather than
     * block every other HID collection. A new subscription gets a neutral first. */
    if(!subscribed(hid_ccc[id-1]))return true;
    if(tx_count){
        hid_packet_t *last=&tx_queue[(tx_head+tx_count-1u)%ND_TX_CAPACITY];
        if(last->id==id&&last->length==length&&last->epoch==report_epoch[id-1]&&
           c5_relative_merge(id,last->data,data,length))return true;
    }
    if(tx_count==ND_TX_CAPACITY)return false;
    hid_packet_t *packet = &tx_queue[(tx_head + tx_count) % ND_TX_CAPACITY];
    packet->id = id; packet->length = length; packet->epoch=report_epoch[id-1]; memcpy(packet->data, data, length);
    ++tx_count;
    return true;
}
bool nd_ble_config_send(const uint8_t frame[20]) {
    if (!frame || !subscribed(config_ccc) || cfg_count == ND_CFG_CAPACITY) return false;
    memcpy(cfg_queue[(cfg_head + cfg_count) % ND_CFG_CAPACITY], frame, 20);
    ++cfg_count;
    return true;
}
static bool notify(uint16_t attribute_handle, const uint8_t *data, uint8_t length) {
    attHandleValueNoti_t notification;
    notification.handle = attribute_handle; notification.len = length;
    notification.pValue = GATT_bm_alloc(connection, ATT_HANDLE_VALUE_NOTI, length, NULL, 0);
    if (!notification.pValue) return false;
    memcpy(notification.pValue, data, length);
    bStatus_t status = GATT_Notification(connection, &notification, FALSE);
    if (status != SUCCESS) GATT_bm_free((gattMsg_t *)&notification, ATT_HANDLE_VALUE_NOTI);
    return status == SUCCESS;
}
static void drain_input(unsigned budget){
    if(nd_ble_ready()) for(uint8_t i=0;i<4;i++) {
        if((neutral_pending&(1u<<i)) && subscribed(hid_ccc[i])) {
            static const uint8_t zero[8]={0};
            if(notify(hid_attributes[input_attribute_indices[i]].handle,zero,input_lengths[i]))
                neutral_pending&=(uint8_t)~(1u<<i);
            break;
        }
    }
    /* Bounded drain: use available controller slots in this connection event. */
    for(unsigned slot=0;slot<budget&&tx_count;slot++) {
        hid_packet_t *packet = &tx_queue[tx_head];
        uint8_t index = packet->id - 1;
        bool discarded=packet->epoch!=report_epoch[index]||!subscribed(hid_ccc[index]);
        bool sent=!discarded&&nd_ble_ready()&&!(neutral_pending&(1u<<index))&&
            notify(hid_attributes[input_attribute_indices[index]].handle,packet->data,packet->length);
        if(discarded||sent) {
            if(sent)memcpy(input_values[index],packet->data,packet->length);
            tx_head = (tx_head + 1) % ND_TX_CAPACITY; --tx_count;
        } else break;
    }
}
void nd_ble_poll(void) {
    if (!initialized) return;
    TMOS_SystemProcess();
    /* Input gets the first slot; config still runs once per poll. */
    drain_input(1);
    /* Core may erase/write flash for SAVE: execute it after the stack returned.
     * Reserve an ACK slot before consuming each request. */
    if (rx_count && cfg_count < ND_CFG_CAPACITY && subscribed(config_ccc)) {
        uint8_t request[20]; memcpy(request, rx_queue[rx_head], 20);
        rx_head = (rx_head + 1) % ND_RX_CAPACITY; --rx_count;
        nd_platform_config_received(C5_TRANSPORT_BLE, request);
    }
    if (cfg_count && subscribed(config_ccc) &&
        notify(config_attributes[4].handle, cfg_queue[cfg_head], 20)) {
        memcpy(config_response, cfg_queue[cfg_head], 20);
        cfg_head = (cfg_head + 1) % ND_CFG_CAPACITY; --cfg_count;
    }
    drain_input(3);
    uint32_t now = TMOS_GetSystemClock();
    if ((uint32_t)(now - battery_sample_time) >= MS1_TO_SYSTEM_TIME(1000)) {
        battery_sample_time = now;
        uint8_t flags=0, percent=255; uint16_t millivolts=0;
        c5_hal_status(&flags, &percent, &millivolts);
        if (percent <= 100 && percent != battery_level) {
            battery_level = percent; battery_pending = true;
        }
    }
    if (battery_pending && subscribed(battery_ccc) &&
        notify(battery_attributes[2].handle, &battery_level, 1)) battery_pending = false;
}
