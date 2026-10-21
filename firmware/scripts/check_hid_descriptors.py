#!/usr/bin/env python3
"""Verify real compiled USB/BLE descriptor macros and report byte counts."""
from pathlib import Path
import json,subprocess,tempfile,struct,sys
no_haptics='--no-haptic' in sys.argv
root=Path(__file__).resolve().parents[1]
source=r'''
#include <stdio.h>
#include <stdint.h>
#include "hid_reports.h"
#include "hid_features.h"
static const uint8_t usb[]={C5_FULL_HID_REPORT_MAP_BYTES};
static const uint8_t cfg[]={C5_CONFIG_REPORT_MAP_BYTES};
static const uint8_t ble[]={C5_FULL_HID_REPORT_MAP_BYTES};
int main(void){const uint8_t *a[]={usb,cfg,ble};size_t n[]={sizeof(usb),sizeof(cfg),sizeof(ble)};for(int i=0;i<3;i++){putchar(n[i]&255);putchar(n[i]>>8);fwrite(a[i],1,n[i],stdout);}return 0;}
'''
with tempfile.TemporaryDirectory(prefix='c5-hid-') as td:
    p=Path(td);(p/'dump.c').write_text(source)
    subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror',*(['-DC5_NO_HAPTICS'] if no_haptics else []),'-I'+str(root/'platform/ch592'),'-I'+str(root/'features'),str(p/'dump.c'),'-o',str(p/'dump')],check=True)
    data=subprocess.check_output([str(p/'dump')])
expected=[{(1,8):64,(1,9):8,(2,8):16,(3,8):24,(4,8):32,(5,9):16,(5,11):72,(16,11):176,(17,11):16,(18,11):224,(19,11):400,(20,11):72,(21,11):8},
          {(32,8):504,(32,9):504},None]
expected[2]=expected[0].copy()
if no_haptics:
    for index in [0,2]:
        expected[index]={k:v for k,v in expected[index].items() if k[0]!=5}
results=[]
for name,wanted in zip(['USB input+Windows features','USB config','BLE HOGP'],expected):
    n=int.from_bytes(data[:2],'little');d=data[2:2+n];data=data[2+n:]
    if name=='BLE HOGP':assert n<=512,'HOGP Report Map must fit the ATT 512-byte attribute limit'
    g={'id':0,'size':0,'count':0};stack=[];bits={};depth=0;i=0
    while i<len(d):
        tag=d[i];i+=1
        if tag==0xfe:raise AssertionError('unexpected long item')
        size=[0,1,2,4][tag&3];typ=(tag>>2)&3;item=tag>>4
        assert i+size<=len(d),'truncated item'
        value=int.from_bytes(d[i:i+size],'little');i+=size
        if typ==1:
            if item==7:g['size']=value
            elif item==8:g['id']=value
            elif item==9:g['count']=value
            elif item==10:stack.append(g.copy())
            elif item==11:g=stack.pop()
        if typ==0:
            if item==10:depth+=1
            elif item==12:depth-=1
            elif item in (8,9,11):
                key=(g['id'],item);bits[key]=bits.get(key,0)+g['size']*g['count']
            assert depth>=0,'unbalanced collection'
    assert not stack and depth==0,'unbalanced HID stack/collection'
    assert bits==wanted,(name,bits,wanted)
    results.append({'name':name,'descriptor_bytes':n,'reports':[{'id':k[0],'type':{8:'input',9:'output',11:'feature'}[k[1]],'payload_bytes':v//8} for k,v in sorted(bits.items())]})
print(json.dumps({'passed':True,'descriptors':results},indent=2))
