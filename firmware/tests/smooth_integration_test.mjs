import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {defaults,encode,decode,frame,parseFrame} from '../../web/public/config/schema.js';
import {DeviceLink} from '../../web/public/config/transport.js';
const child=spawn('build/native/smooth_integration_bridge');
const pending=[];
createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(line));
child.on('exit',code=>{while(pending.length)pending.shift().reject(Error('bridge exited '+code));});
const cmd=line=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(line+'\n');});
const hex=b=>Buffer.from(b).toString('hex');
let source='F';
const request=async(op,payload=new Uint8Array(),offset=0)=>{
 const raw=await cmd(source+' '+hex(frame(op,1,payload,offset))),reply=parseFrame(Uint8Array.from(Buffer.from(raw,'hex')));
 if(reply.status)throw Error('status '+reply.status);return reply.payload;
};
const link=new DeviceLink();link.device={};link.kind='usb';link.request=request;
const angle=r=>(r[4]|r[5]<<8)<<16>>16;
try{
 const info=await request(1);assert.equal(info[5],15);assert(new DataView(info.buffer).getUint32(8,true)&0x400000);
 const c=defaults();c.encoderMode=0;c.transitions=4;c.angle=100;const bytes=encode(c);
 await link.apply(bytes,true);await cmd('I');assert.deepEqual(await link.read(),bytes);
 for(const route of [1,2]){
  source=route===1?'F':'G';await cmd(`L ${route===1?1:0} ${route===2?1:0}`);
  await link.apply(bytes,false);await cmd('X');
  for(let i=1;i<=4;i++){await cmd('E 1');await cmd('T '+(route*10000+i*1000));}
  let reports=JSON.parse(await cmd('R')).filter(r=>r[1]===3);
  assert.equal(reports.length,4);assert(reports.every(r=>r[0]===route&&angle(r)===25));
  assert.equal(reports.reduce((s,r)=>s+angle(r),0),100);
  await cmd('X');await cmd('E -4');for(let i=0;i<4;i++)await cmd('T '+(route*10000+5000+i));
  reports=JSON.parse(await cmd('R')).filter(r=>r[1]===3);
  assert.equal(reports.reduce((s,r)=>s+angle(r),0),-100);
  assert.deepEqual(decode(await link.read()),c);
 }
 console.log('PASS production fine Dial flags + browser transport: firmware capability, persistent unchanged config, slow USB/BLE per-edge angles, reversal totals');
}finally{child.stdin.end();}
