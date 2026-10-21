import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {defaults,encode,decode,frame,parseFrame} from '../../web/public/config/schema.js';
import {hapticDefaults,encodeHaptic} from '../../web/public/config/haptic-schema.js';
import {DeviceLink} from '../../web/public/config/transport.js';
const windows=process.platform==='win32';
const bridge=decodeURIComponent(new URL('../build/native/haptic_integration_bridge',import.meta.url).pathname).replace(/^\/([A-Za-z]):/,(_,drive)=>'/mnt/'+drive.toLowerCase());
const child=windows?spawn('wsl.exe',['--exec','env','ASAN_OPTIONS=detect_leaks=0',bridge]):spawn('build/native/haptic_integration_bridge');
const pending=[];
createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(line));
child.on('exit',code=>{while(pending.length)pending.shift().reject(Error('bridge exited '+code));});
const cmd=line=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(line+'\n');});
const hex=b=>Buffer.from(b).toString('hex');
const request=async(op,payload=new Uint8Array(),offset=0,source='F')=>{
 const raw=await cmd(source+' '+hex(frame(op,1,payload,offset))),reply=parseFrame(Uint8Array.from(Buffer.from(raw,'hex')));
 if(reply.status)throw Error('status '+reply.status);return reply.payload;
};
try{
 const c=defaults();c.statusLight={mode:1,brightness:50,color:[128,64,255]};c.advancedHaptic={...hapticDefaults(),enabled:true,mode:1,sustain:-35};const bytes=encode(c);
 assert.equal(await cmd('V '+hex(bytes)),'1');
 const bad=bytes.slice();bad[950]=124;assert.equal(await cmd('V '+hex(bad)),'0');
 const info=await request(1);assert(new DataView(info.buffer).getUint32(8,true)&0x8000);assert.equal(info[5],14);
 const link=new DeviceLink();link.device={};link.kind='usb';link.request=request;
 await link.apply(bytes,false);const applied=await link.read();assert.deepEqual(decode(applied).advancedHaptic,c.advancedHaptic);assert.deepEqual(decode(applied).statusLight,c.statusLight);
 await cmd('L 1 1');await request(14,Uint8Array.of(0));
 await assert.rejects(request(14,Uint8Array.of(3),0,'G'),/status 3/);
 await assert.rejects(request(14,Uint8Array.of(2,75)),/status 3/);
 await link.previewHaptic(encodeHaptic(c.advancedHaptic),75);assert.deepEqual(await link.read(),applied);
 await request(14,Uint8Array.of(3));
 console.log('PASS actual C protocol + browser: advanced config parity/readback, malformed rejection, ownership, complete draft audition, no config mutation, stop');
}finally{child.stdin.end();}
