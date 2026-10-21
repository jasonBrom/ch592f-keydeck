import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {defaults,encode,decode,frame,parseFrame} from '../../web/public/config/schema.js';
import {hapticDefaults} from '../../web/public/config/haptic-schema.js';
import {tuningDefaults,encodeTuning,readCalibration,runCalibration,TUNING_CAP,ratedCode} from '../../web/public/config/haptic-tuning.js';
import {DeviceLink} from '../../web/public/config/transport.js';
import {layerDefaults,layerOffsets} from '../../web/public/config/layer-schema.js';
const child=spawn('build/native/haptic_integration_bridge'),pending=[];
createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(line));
child.on('exit',code=>{while(pending.length)pending.shift().reject(Error('bridge exited '+code));});
const cmd=line=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(line+'\n');});
let seq=0;
async function raw(op,payload=new Uint8Array(),offset=0,source='F'){
 return parseFrame(Buffer.from(await cmd(source+' '+Buffer.from(frame(op,++seq,payload,offset)).toString('hex')),'hex'));
}
async function request(op,payload=new Uint8Array(),offset=0){const r=await raw(op,payload,offset);if(r.status)throw Error('status '+r.status);return r.payload;}
try{
 const info=await request(1);assert.equal(info[5],14);assert(new DataView(info.buffer,info.byteOffset).getUint32(8,true)&TUNING_CAP);
 const link=new DeviceLink();link.device={};link.kind='usb';link.request=request;
 const c=defaults();c.advancedHaptic={...hapticDefaults(),tuning:{...tuningDefaults(),pulseMs:18}};c.advancedHaptic.events[2]=126;
 const bytes=encode(c);assert.equal(await cmd('V '+Buffer.from(bytes).toString('hex')),'1');
 await link.apply(bytes,true);assert.deepEqual(await link.read(),bytes);
 await cmd('I');assert.deepEqual(decode(await link.read()).advancedHaptic.tuning,c.advancedHaptic.tuning);
 let s=await readCalibration(link);assert.equal(s.tuning.pulseMs,18);
 // Calibration changes only driver RAM until the verified parameters are
 // adopted into configuration and SAVE succeeds.
 await runCalibration(link,{...s.tuning,pulseMs:36},{sleep:async()=>{}});
 assert.equal((await readCalibration(link)).tuning.pulseMs,36);
 assert.equal(decode(await link.read()).advancedHaptic.tuning.pulseMs,18);
 await cmd('I');assert.equal((await readCalibration(link)).tuning.pulseMs,18);
 const adopted=decode(await link.read());
 adopted.advancedHaptic.tuning=(await runCalibration(link,{...s.tuning,pulseMs:28},{sleep:async()=>{}})).tuning;
 await link.apply(encode(adopted),true);await cmd('I');
 assert.equal((await readCalibration(link)).tuning.pulseMs,28);
 await cmd('S 0');const unsaved=structuredClone(adopted);unsaved.advancedHaptic.tuning.pulseMs=36;
 try{await assert.rejects(link.apply(encode(unsaved),true),/status 6/);}finally{await cmd('S 1');}
 await cmd('I');assert.equal((await readCalibration(link)).tuning.pulseMs,28);
 for(const sampleTime of [0,1,2,3]){
  const tuning={...tuningDefaults(),sampleTime};s=await runCalibration(link,tuning,{sleep:async()=>{}});
  assert.equal(s.registers[0],ratedCode(tuning));assert.deepEqual(s.tuning,tuning);
 }
 assert.equal((await raw(17,Uint8Array.of(0))).status,1);assert.equal((await raw(17,new Uint8Array(),3)).status,1);
 assert.equal((await raw(18,Uint8Array.of(0))).status,1);
 const invalid=Uint8Array.of(0,...encodeTuning(tuningDefaults()));invalid[6]=67;
 assert.equal((await raw(18,invalid)).status,2);
 assert.equal((await raw(18,Uint8Array.of(1),1)).status,1);
 await cmd('L 0 1');assert.equal((await raw(18,Uint8Array.of(1))).status,3);
 assert.equal((await raw(18,Uint8Array.of(1),0,'G')).status,0);
 await cmd('Z 1');assert.equal((await raw(18,Uint8Array.of(1),0,'G')).status,3);
 assert.equal((await raw(6,new Uint8Array(),0,'G')).status,3);
 await cmd('Z 0');await cmd('L 1 0');
 const legacy=defaults();legacy.advancedHaptic={...hapticDefaults(),tuning:tuningDefaults()};
 await link.apply(encode(legacy),true);assert.deepEqual((await readCalibration(link)).tuning,tuningDefaults());
 await runCalibration(link,{...tuningDefaults(),pulseMs:36},{sleep:async()=>{}});
 await request(8);assert.deepEqual((await readCalibration(link)).tuning,tuningDefaults());await request(6);
 const layered=defaults();layered.layers={...layerDefaults(),shortcuts:true};
 for(const profile of layered.profiles)profile[5]={type:7,modifiers:0,value:0};
 layered.profiles[1][0]={type:1,modifiers:0,value:4};
 layered.macros[0]=[{type:1,modifiers:1,value:6,delay:50},{type:2,modifiers:1,value:6,delay:0}];
 await link.apply(encode(layered),true);await cmd('L 1 0');await cmd('X');
 await cmd('K 5 1');await cmd('K 1 1');await cmd('T 64');
 assert.equal((await request(9))[2],1);
 assert.deepEqual([...Buffer.from(await cmd('O'),'hex').slice(15)],layered.layers.colors[1]);
 assert.deepEqual(decode(await link.read()).macros,layered.macros);
 await cmd('K 1 0');await cmd('K 5 0');await cmd('X');await cmd('K 0 1');
 assert(JSON.parse(await cmd('R')).some(r=>r[1]===1&&r[5]===4));await cmd('K 0 0');
 await cmd('I');assert.equal((await request(9))[2],0);assert.deepEqual(decode(await link.read()).layers,layered.layers);
 const malformed=encode(layered);malformed[layerOffsets[13]]=35;assert.equal(await cmd('V '+Buffer.from(malformed).toString('hex')),'0');
 console.log('PASS calibration C/JS: capability, eight-byte storage, independent TURN binding, APPLY/SAVE/reboot, sample-voltage parity, job controls, malformed requests, route ownership and busy save gates');
 console.log('PASS layers C/JS: packed settings, preserved macros, Fn-only layer change, RGB, ordinary key mapping and saved restart');
}finally{child.stdin.end();}
