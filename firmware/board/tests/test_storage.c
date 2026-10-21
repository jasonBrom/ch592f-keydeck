#include "CH59x_common.h"
#include "c5.h"
#include <assert.h>
#include <stdio.h>

static uint8_t flash[32768],baseline[32768];
static int cut_after=-1,partial_bytes,operation_count,erase_count;
static bool cut;
static bool operation_fails(void)
{
    if(cut) return true;
    if(cut_after>=0 && operation_count++==cut_after) { cut=true;return true; }
    return false;
}
uint32_t mock_read(uint32_t addr,void *out,uint32_t n)
{
    assert(addr+n<=sizeof(flash));assert(((uintptr_t)out&3)==0);
    if(operation_fails()) return 1;
    memcpy(out,flash+addr,n);return 0;
}
uint32_t mock_erase(uint32_t addr,uint32_t n)
{
    assert((addr==0x4000 || addr==0x5000) && n==4096);
    erase_count++;
    if(operation_fails()) {
        memset(flash+addr,0xff,partial_bytes<(int)n?(unsigned)partial_bytes:n);
        return 1;
    }
    memset(flash+addr,0xff,n);return 0;
}
uint32_t mock_write(uint32_t addr,void *data,uint32_t n)
{
    assert(addr+n<=sizeof(flash));assert(((uintptr_t)data&3)==0);
    bool failed=operation_fails();
    unsigned take=failed?(partial_bytes<(int)n?(unsigned)partial_bytes:n):n;
    for(unsigned i=0;i<take;++i) flash[addr+i]&=((uint8_t *)data)[i];
    return failed?1:0;
}
uint32_t c5_crc32(const uint8_t *d,size_t n)
{
    uint32_t crc=~0u;
    while(n--) { crc^=*d++;for(unsigned i=0;i<8;++i) crc=(crc>>1)^((crc&1)?0xedb88320u:0); }
    return ~crc;
}
bool c5_validate_config(const uint8_t c[C5_CONFIG_SIZE])
{ return memcmp(c,"C5CF",4)==0 && c[4]==1 && c[5]<3; }

int main(void)
{
    uint8_t a[1024]={0},b[1024]={0},out[1024]={0};
    memset(flash,0xff,sizeof(flash));
    memcpy(a,"C5CF",4);a[4]=1;memcpy(b,a,sizeof(a));b[8]=37;b[42]=123;
    assert(!c5_hal_load(out));
    assert(c5_hal_save(a));assert(c5_hal_load(out));assert(!memcmp(out,a,sizeof(a)));
    int erases=erase_count;
    assert(c5_hal_save(a));assert(erase_count==erases);
    memcpy(baseline,flash,sizeof(flash));
    /* Cut power at every ROM operation; test partial erase/program sizes.
     * A reboot may see the previous config or the fully committed new config,
     * never a mixture, and never modifies BLE storage. */
    unsigned scenarios=0;
    for(int call=0;call<45;++call) for(int bytes=0;bytes<=256;bytes+=16) {
        memcpy(flash,baseline,sizeof(flash));
        cut=false;cut_after=call;operation_count=0;partial_bytes=bytes;
        bool saved=c5_hal_save(b);
        cut=false;cut_after=-1;
        assert(c5_hal_load(out));
        assert(!memcmp(out,a,sizeof(a)) || !memcmp(out,b,sizeof(b)));
        if(saved) assert(!memcmp(out,b,sizeof(b)));
        assert(!memcmp(flash+0x7000,baseline+0x7000,4096));
        scenarios++;
    }
    memcpy(flash,baseline,sizeof(flash));assert(c5_hal_save(b));
    flash[0x5000+256+8]^=1; /* corrupt newer slot -> older CRC-valid slot */
    assert(c5_hal_load(out));assert(!memcmp(out,a,sizeof(a)));
    puts("storage: blank/load/save/no-op/corruption fallback passed");
    printf("storage: %u interrupted ROM-operation scenarios passed\n",scenarios);
    return 0;
}
