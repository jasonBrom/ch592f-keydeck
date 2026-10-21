#include "ble_features.h"
#include "hid_features.h"
#include "CH59xBLE_LIB.h"
#include <stdbool.h>
#include <string.h>

/* WCH SDK a46e0086, LIBCH59xBLE.a:
 * gattServApp_ProcessPrepareWriteReq queues and echoes ATT fragments without
 * invoking the service callback. Execute(flags=0) frees that queue, also without
 * a service callback. Execute(flags=1) merges contiguous same-handle fragments
 * in gattServApp_IsWriteLong, then calls us once with ATT_EXECUTE_WRITE_REQ.
 * For reliable writes that cannot be merged, the SDK replays queued fragments
 * as ATT_PREPARE_WRITE_REQ, except the final fragment uses EXECUTE. Therefore
 * PREPARE below means execution-phase replay, never the on-wire prepare phase.
 * Assemble one report atomically; reject a multi-report reliable transaction.
 */
static struct {
    uint8_t data[C5_FEATURE_MAX_SIZE];
    uint8_t coverage[(C5_FEATURE_MAX_SIZE+7u)/8u];
    uint8_t type, id;
    bool active, invalid;
} write_stage;
/* Read Blob must see one frozen report, particularly AttributesResponse whose
 * cursor advances once per GET. A new offset-zero read starts a new snapshot. */
static uint8_t read_snapshot[C5_FEATURE_MAX_SIZE];
static uint8_t read_id, read_length;
static uint8_t last_haptic_output[C5_HAPTIC_OUTPUT_SIZE];

uint8_t nd_ble_feature_size(uint8_t type, uint8_t id) {
#ifdef C5_NO_HAPTICS
    if(id==C5_HAPTIC_ID)return 0;
#endif
    if (type==2) return id==C5_HAPTIC_ID ? C5_HAPTIC_OUTPUT_SIZE : 0;
    if (type!=3) return 0;
    switch (id) {
    case C5_HAPTIC_ID: return C5_HAPTIC_FEATURE_SIZE;
    case C5_LAMP_ARRAY_ID: return 22;
    case C5_LAMP_REQUEST_ID: return 2;
    case C5_LAMP_RESPONSE_ID: return 28;
    case C5_LAMP_MULTI_ID: return 50;
    case C5_LAMP_RANGE_ID: return 9;
    case C5_LAMP_CONTROL_ID: return 1;
    default: return 0;
    }
}
void nd_ble_features_reset(void) {
    memset(&write_stage,0,sizeof(write_stage));
    read_id=read_length=0;
    memset(last_haptic_output,0,sizeof(last_haptic_output));
}
void nd_ble_feature_reject_other(uint8_t method) {
    if (method==ATT_EXECUTE_WRITE_REQ) memset(&write_stage,0,sizeof(write_stage));
    else if (method==ATT_PREPARE_WRITE_REQ) {
        write_stage.active=true;
        write_stage.invalid=true;
    }
}
uint8_t nd_ble_feature_read(uint8_t type,uint8_t id,uint8_t *out,
    uint16_t *length,uint16_t offset,uint16_t maximum) {
    uint8_t size=nd_ble_feature_size(type,id);
    *length=0;
    if (!size) return ATT_ERR_ATTR_NOT_FOUND;
    if (offset>size) return ATT_ERR_INVALID_OFFSET;
    const uint8_t *source;
    if (type==2) source=last_haptic_output;
    else {
        if (!offset || read_id!=id || !read_length) {
            size_t got=c5_features_get_source(2,id,read_snapshot,sizeof(read_snapshot));
            if (got!=size) { read_id=read_length=0; return ATT_ERR_UNLIKELY; }
            read_id=id; read_length=(uint8_t)got;
        }
        source=read_snapshot;
    }
    *length=size-offset;
    if (*length>maximum) *length=maximum;
    if (*length) memcpy(out,source+offset,*length);
    return SUCCESS;
}

static bool add_fragment(const uint8_t *data,uint16_t length,uint16_t offset,uint8_t size) {
    if (!data || !length || offset>=size || length>(uint16_t)(size-offset)) return false;
    /* Validate every overlap before modifying staging. Identical retransmission
     * is idempotent; conflicting overlap rejects the entire transaction. */
    for (uint16_t i=0;i<length;i++) {
        uint16_t pos=offset+i;
        if ((write_stage.coverage[pos/8] & (1u<<(pos%8))) && write_stage.data[pos]!=data[i]) return false;
    }
    for (uint16_t i=0;i<length;i++) {
        uint16_t pos=offset+i;
        write_stage.data[pos]=data[i];
        write_stage.coverage[pos/8]|=(uint8_t)(1u<<(pos%8));
    }
    return true;
}
uint8_t nd_ble_feature_write(uint8_t type,uint8_t id,const uint8_t *data,
    uint16_t length,uint16_t offset,uint8_t method) {
    uint8_t size=nd_ble_feature_size(type,id);
    bool replay=method==ATT_PREPARE_WRITE_REQ;
    bool execute=method==ATT_EXECUTE_WRITE_REQ;
    if (!size) return ATT_ERR_WRITE_NOT_PERMITTED;
    if (!replay && !execute && method!=ATT_WRITE_REQ && method!=ATT_WRITE_CMD)
        return ATT_ERR_UNSUPPORTED_REQ;

    if (!replay && !execute) {
        /* Ordinary writes contain the whole report; no hidden partial updates. */
        memset(&write_stage,0,sizeof(write_stage));
        if (offset) return ATT_ERR_INVALID_OFFSET;
        if (!data || length!=size) return ATT_ERR_INVALID_VALUE_SIZE;
        if (!c5_features_set_source(2,type,id,data,length)) return ATT_ERR_UNLIKELY;
        if (type==2) memcpy(last_haptic_output,data,C5_HAPTIC_OUTPUT_SIZE);
        return SUCCESS;
    }
    if (!write_stage.active) {
        memset(&write_stage,0,sizeof(write_stage));
        write_stage.active=true; write_stage.type=type; write_stage.id=id;
    }
    if (write_stage.type!=type || write_stage.id!=id ||
        !add_fragment(data,length,offset,size)) write_stage.invalid=true;
    if (replay) return write_stage.invalid ? ATT_ERR_INVALID_VALUE_SIZE : SUCCESS;

    bool complete=!write_stage.invalid;
    for (uint8_t i=0;i<size;i++)
        if (!(write_stage.coverage[i/8] & (1u<<(i%8)))) complete=false;
    uint8_t result=ATT_ERR_INVALID_VALUE_SIZE;
    if (complete) {
        /* WCH invokes this inside TMOS_SystemProcess on the main loop, not in
         * an IRQ. SET performs at most one bounded I2C register write; the
         * 18ms haptic pulse is asynchronous. Return the real hardware result
         * before the SDK emits ATT Execute Write Response. */
        result=c5_features_set_source(2,type,id,write_stage.data,size) ? SUCCESS : ATT_ERR_UNLIKELY;
        if (result==SUCCESS && type==2)
            memcpy(last_haptic_output,write_stage.data,C5_HAPTIC_OUTPUT_SIZE);
    }
    memset(&write_stage,0,sizeof(write_stage));
    return result;
}
