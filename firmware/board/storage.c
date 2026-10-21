#include "CH59x_common.h"
#include "c5.h"

/* DataFlash offsets; two independent 4KiB erase blocks. BLE owns0x7000-7fff. */
#define SLOT0 0x4000u
#define SLOT1 0x5000u
#define BLOCK_SIZE 4096u
#define PAYLOAD_OFFSET 256u
#define RECORD_MAGIC 0x31463543u

typedef struct {
    uint32_t magic, generation, size, payload_crc, generation_inv, header_crc;
} record_header;
/* One aligned page only: CH592F has26KiB RAM; do not put a1KiB or4KiB
 * automatic object on the2KiB stack. Read-after-write reuses this same page. */
static uint8_t page[256] __attribute__((aligned(4)));

static uint32_t crc_update(uint32_t crc,const uint8_t *data,unsigned length)
{
    while(length--) {
        crc^=*data++;
        for(unsigned k=0;k<8;++k) crc=(crc>>1)^((crc&1)?0xedb88320u:0);
    }
    return crc;
}
/* -1 means I/O failure,0 invalid/erased,1 valid. A read failure must never
 * be mistaken for an empty slot when choosing a block to erase. */
static int read_slot(uint32_t base,uint32_t *generation)
{
    record_header h __attribute__((aligned(4)));
    if(EEPROM_READ(base,&h,sizeof(h))!=0) return -1;
    if(h.magic!=RECORD_MAGIC ||
       h.size!=C5_CONFIG_SIZE || h.generation_inv!=~h.generation ||
       h.header_crc!=c5_crc32((const uint8_t *)&h,20)) return false;
    uint32_t crc=0xffffffffu;
    for(unsigned p=0;p<C5_CONFIG_SIZE;p+=sizeof(page)) {
        if(EEPROM_READ(base+PAYLOAD_OFFSET+p,page,sizeof(page))!=0) return -1;
        crc=crc_update(crc,page,sizeof(page));
    }
    if((crc^0xffffffffu)!=h.payload_crc) return false;
    *generation=h.generation;
    return true;
}
static bool copy_payload(uint32_t base,uint8_t *out)
{
    for(unsigned p=0;p<C5_CONFIG_SIZE;p+=sizeof(page)) {
        if(EEPROM_READ(base+PAYLOAD_OFFSET+p,page,sizeof(page))!=0) return false;
        memcpy(out+p,page,sizeof(page));
    }
    return c5_validate_config(out);
}
static bool payload_matches(uint32_t base,const uint8_t *config)
{
    for(unsigned p=0;p<C5_CONFIG_SIZE;p+=sizeof(page)) {
        if(EEPROM_READ(base+PAYLOAD_OFFSET+p,page,sizeof(page))!=0 ||
           memcmp(page,config+p,sizeof(page))!=0) return false;
    }
    return true;
}
bool c5_hal_load(uint8_t out[C5_CONFIG_SIZE])
{
    uint32_t a=0,b=0;
    bool va=read_slot(SLOT0,&a)==1,vb=read_slot(SLOT1,&b)==1;
    if(!va&&!vb) return false;
    bool newest_b=vb&&(!va||(int32_t)(b-a)>0);
    uint32_t base=newest_b?SLOT1:SLOT0;
    if(copy_payload(base,out)) return true;
    /* A structurally valid record from another schema must not prevent the
     * compatible older slot loading. */
    return (newest_b?va:vb)&&copy_payload(newest_b?SLOT0:SLOT1,out);
}
bool c5_hal_save(const uint8_t config[C5_CONFIG_SIZE])
{
    uint32_t a=0,b=0;
    if(!c5_validate_config(config)) return false;
    int sa=read_slot(SLOT0,&a),sb=read_slot(SLOT1,&b);
    if(sa<0 || sb<0) return false;
    bool va=sa==1,vb=sb==1;
    bool newest_b=vb&&(!va||(int32_t)(b-a)>0);
    uint32_t current=newest_b?SLOT1:SLOT0;
    uint32_t generation=(va||vb)?(newest_b?b:a)+1u:1u;
    if((va||vb)&&payload_matches(current,config)) return true;
    uint32_t target=(va||vb)&&current==SLOT0?SLOT1:SLOT0;
    if(EEPROM_ERASE(target,BLOCK_SIZE)!=0) return false;
    for(unsigned p=0;p<C5_CONFIG_SIZE;p+=sizeof(page)) {
        memcpy(page,config+p,sizeof(page));
        if(EEPROM_WRITE(target+PAYLOAD_OFFSET+p,page,sizeof(page))!=0 ||
           EEPROM_READ(target+PAYLOAD_OFFSET+p,page,sizeof(page))!=0 ||
           memcmp(page,config+p,sizeof(page))!=0) return false;
    }
    /* Header is the commit marker; write last after all payload pages verify. */
    record_header h __attribute__((aligned(4)))={
        RECORD_MAGIC,generation,C5_CONFIG_SIZE,c5_crc32(config,C5_CONFIG_SIZE),
        ~generation,0
    };
    h.header_crc=c5_crc32((const uint8_t *)&h,20);
    if(EEPROM_WRITE(target,&h,sizeof(h))!=0) return false;
    return read_slot(target,&a)==1&&a==generation&&payload_matches(target,config);
}
