import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {access,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
// Accept source checkout, complete delivery package, or a firmware folder under
// the web repository. C5_WEB_ROOT may name either web/ or web/public/.
const webCandidates=process.env.C5_WEB_ROOT
 ? [resolve(process.env.C5_WEB_ROOT),resolve(process.env.C5_WEB_ROOT,'public')]
 : ['../../site/dist/','../../web/public/','../../public/'].map(p=>fileURLToPath(new URL(p,import.meta.url)));
let webRoot;
for(const candidate of webCandidates){try{await access(resolve(candidate,'config/schema.js'));await access(resolve(candidate,'config/transport.js'));webRoot=candidate;break;}catch{}}
if(!webRoot)throw new Error('找不到网页配置模块。请保留 firmware 与 web/public 的目录结构，或设置 C5_WEB_ROOT 指向网页源码目录。已检查：'+webCandidates.join(', '));
const schema=await import(pathToFileURL(resolve(webRoot,'config/schema.js')).href);
const {DeviceLink}=await import(pathToFileURL(resolve(webRoot,'config/transport.js')).href);
const {hasStatusLightSettings,STATUS_LIGHT_CAPABILITY}=await import(pathToFileURL(resolve(webRoot,'config/status-light-schema.js')).href);
const {MacroRecorder,macroSummary}=await import(pathToFileURL(resolve(webRoot,'config/recorder.js')).href);
const catalog=await import(pathToFileURL(resolve(webRoot,'config/catalog.js')).href);
const consoleSource=await readFile(resolve(webRoot,'config/console.js'),'utf8');
const bridge=fileURLToPath(new URL('../build/native/integration_bridge',import.meta.url));
const child=process.platform==='win32'?spawn('wsl.exe',['--exec','env','ASAN_OPTIONS=detect_leaks=0',bridge.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/mnt/'+drive.toLowerCase())],{stdio:['pipe','pipe','inherit']}):spawn(bridge,[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout});const waiting=[];
lines.on('line',s=>{const w=waiting.shift();if(!w)throw new Error('unsolicited harness reply');w.resolve(s);});
const exited=new Promise((resolve,reject)=>child.on('exit',code=>{for(const w of waiting)w.reject(new Error(`bridge exited ${code}`));if(code===0)resolve();else reject(new Error(`bridge exited ${code}`));}));
function cmd(s){return new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write(s+'\n');});}
const hex=b=>Buffer.from(b).toString('hex');
async function coreFrame(b){return Uint8Array.from(Buffer.from(await cmd('F '+hex(b)),'hex'));}
async function command(op,payload=new Uint8Array(),offset=0){return schema.parseFrame(await coreFrame(schema.frame(op,17,payload,offset)));}
function connectMock({kind='usb',history=[],mutate}={}){const link=new DeviceLink();link.kind=kind;
 const send=async bytes=>{assert.equal(bytes.length,20);history.push(bytes[2]);const result=kind==='usb'?await coreFrame(bytes):Uint8Array.from(Buffer.from(await cmd('G '+hex(bytes)),'hex'));const response=mutate?mutate(result,bytes):result;queueMicrotask(()=>link.receive(response));};
 link.device={sendReport:async(id,bytes)=>{assert.equal(id,0x20);assert.equal(bytes.length,63);assert(bytes.slice(20).every(x=>x===0));await send(bytes.slice(0,20));},removeEventListener(){}};
 if(kind==='ble')link.tx={writeValueWithResponse:send};return link;}
// Execute only the real pure orchestration helpers. No fake DOM or copy of their
// implementation: changes in console.js are automatically exercised here.
function helperSource(name){
 const token='function '+name+'(',at=consoleSource.indexOf(token);assert(at>=0,`missing helper ${name}`);
 const start=consoleSource.slice(at-6,at)==='async '?at-6:at;let depth=0,quote=null,escaped=false;
 for(let i=consoleSource.indexOf('{',at);i<consoleSource.length;i++){const ch=consoleSource[i];if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;continue;}if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}if(ch==='{')depth++;if(ch==='}'&&--depth===0)return consoleSource.slice(start,i+1);}
 throw new Error('unclosed helper '+name);
}
function consoleContext(config,link,caps=0x173f){
 const context=vm.createContext({config,link,caps,profileActivationRequested:false,LAYER_CAP:0x200000,calibrationEditor:{validateDraft(){},saved(){}},$:()=>({textContent:''}),actualUSB:2,validate:schema.validate,decode:schema.decode,encode:schema.encode,encodeForDevice:schema.encodeForDevice,firmwareMinor:5,hasStatusLightSettings,STATUS_LIGHT_CAPABILITY,clone:x=>JSON.parse(JSON.stringify(x)),deviceConfig:null,dirty:true,expectedReconnect:false,setMessage(){}});
 const rateHelpers=consoleSource.split('\n').find(line=>/^const\s+usbMs\s*=/.test(line));assert(rateHelpers,'missing USB interval helper');
 vm.runInContext(rateHelpers+'\n'+helperSource('requireCapabilities')+'\n'+helperSource('saveConfig'),context);return context;
}
async function releaseInputs(){for(let i=0;i<6;i++)await cmd(`K ${i} 0`);}
async function playback(steps,device){
 await releaseInputs();const c=schema.defaults();c.profiles[0][4]={type:4,modifiers:0,value:0};c.macros[0]=steps;
 await device.apply(schema.encode(c),false);await cmd('L 1 0');await cmd('T 0');await cmd('X');await cmd('K 4 1');let t=0;
 for(const step of steps){await cmd('T '+t);t+=Math.max(1,step.delay);}await cmd('T '+t);await cmd('K 4 0');return JSON.parse(await cmd('R'));
}
const findings=[];let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
function infoFinding(name,message){findings.push({name,message});console.log('FINDING '+name+': '+message);}
try{
await test('ISO-HDLC known vector, C and browser',async()=>{const vector=new TextEncoder().encode('123456789');assert.equal(schema.crc32(vector),0xcbf43926);assert.equal(await cmd('C '+hex(vector)),'cbf43926');});
const cDefault=Uint8Array.from(Buffer.from(await cmd('D'),'hex'));
await test('C default decodes and re-encodes byte for byte in browser',async()=>{assert.deepEqual(schema.encode(schema.decode(cDefault)),cDefault);});
if(!Buffer.from(schema.encode(schema.defaults())).equals(Buffer.from(cDefault)))infoFinding('default-mismatch','Browser Restore defaults differs from firmware factory defaults');
else{checks++;console.log('PASS browser and firmware defaults identical');}
let link=connectMock();
await test('actual DeviceLink INFO + 86 READ chunks against C core',async()=>{const info=await link.request(1);assert.equal(new TextDecoder().decode(info.slice(0,4)),'C5RE');assert.deepEqual(await link.read(),cDefault);});
await test('rich JS configuration APPLY SAVE and exact C readback',async()=>{const c=schema.defaults();c.profile=2;c.encoderMode=3;c.transport=0;c.angle=3600;c.idle=3600;c.batteryScale=1500000;c.profiles[2]=[{type:1,modifiers:255,value:0xe7},{type:2,modifiers:0,value:1023},{type:3,modifiers:0,value:-127},{type:4,modifiers:0,value:7},{type:5,modifiers:0,value:0},{type:1,modifiers:1,value:6},{type:3,modifiers:0,value:127},{type:2,modifiers:0,value:233}];c.macros[7]=[{type:1,modifiers:255,value:0xe7,delay:10000},{type:2,modifiers:255,value:0xe7,delay:0},{type:3,modifiers:0,value:1023,delay:1},{type:4,modifiers:0,value:-127,delay:1},{type:0,modifiers:0,value:0,delay:1}];const bytes=schema.encode(c);assert.equal(await cmd('V '+hex(bytes)),'1');assert.equal(await cmd('C '+hex(bytes)),schema.crc32(bytes).toString(16).padStart(8,'0'));await link.apply(bytes,true);assert.deepEqual(await link.read(),bytes);await cmd('I');assert.deepEqual(await link.read(),bytes);});
await test('browser lamp settings persist and drive real C idle/wake and pairing frames',async()=>{
 const c=schema.defaults();c.idle=1;c.statusLight={mode:1,brightness:50,color:[128,64,255]};
 const info=await link.request(1);assert(new DataView(info.buffer,info.byteOffset).getUint32(8,true)&0x10000);
 await link.apply(schema.encode(c),true);await cmd('I');assert.deepEqual(schema.decode(await link.read()).statusLight,c.statusLight);
 await cmd('L 1 0');await cmd('T 16');const shown=()=>cmd('O').then(hex=>Array.from(Buffer.from(hex,'hex')).slice(15));
 assert.deepEqual(await shown(),[64,32,127]);await cmd('T 1000');assert.deepEqual(await shown(),[0,0,0]);
 await cmd('E 1');await cmd('T 1016');assert.deepEqual(await shown(),[64,32,127]);
 await cmd('J 1 1');await cmd('T 1032');assert.deepEqual(await shown(),[0,0,24]);
 await cmd('T 2016');assert.deepEqual(await shown(),[0,0,24]);await cmd('J 0 0');
 await link.apply(cDefault,true);await cmd('I');
});
await test('browser-saved timeout 0 and custom lamp obey host shutdown and reconnect without config loss',async()=>{
 const c=schema.defaults();c.idle=0;c.statusLight={mode:1,brightness:75,color:[120,80,40]};
 const bytes=schema.encode(c);await link.apply(bytes,true);await cmd('I');
 const shown=()=>cmd('O').then(raw=>Array.from(Buffer.from(raw,'hex')));
 await cmd('T 16');assert.deepEqual(await shown(),Array(18).fill(0));
 await cmd('L 1 0');await cmd('T 32');assert.deepEqual((await shown()).slice(15),[90,60,30]);
 await cmd('L 0 0');await cmd('T 48');assert.deepEqual(await shown(),Array(18).fill(0));
 await cmd('K 0 1');await cmd('E 1');await cmd('T 64');assert.deepEqual(await shown(),Array(18).fill(0));
 await cmd('K 0 0');assert.deepEqual(await link.read(),bytes);
 await cmd('L 0 1');await cmd('T 80');assert.deepEqual((await shown()).slice(15),[90,60,30]);
 await cmd('L 0 0');await cmd('T 96');assert.deepEqual(await shown(),Array(18).fill(0));
 await link.apply(cDefault,true);await cmd('I');assert.deepEqual(await link.read(),cDefault);
});
await test('SAVE failure reaches browser as rejection without false success',async()=>{await cmd('S 0');await assert.rejects(link.apply(cDefault,true),/存储|外设/);assert.deepEqual(await link.read(),cDefault);await cmd('S 1');});
await test('CRC corruption rejects atomic APPLY; active config unchanged',async()=>{const head=new Uint8Array(6),v=new DataView(head.buffer);v.setUint16(0,1024,true);v.setUint32(2,schema.crc32(cDefault)^1,true);assert.equal((await command(3,head)).status,0);for(let o=0;o<1024;o+=12)assert.equal((await command(4,cDefault.slice(o,o+12),o)).status,0);assert.equal((await command(5)).status,4);assert.deepEqual(await link.read(),cDefault);assert.equal((await command(7)).status,0);});
await test('sequential offsets, incomplete APPLY and length bounds enforced',async()=>{const h=new Uint8Array(6);new DataView(h.buffer).setUint16(0,1024,true);assert.equal((await command(3,h)).status,0);assert.equal((await command(4,cDefault.slice(0,12),12)).status,2);assert.equal((await command(5)).status,3);assert.equal((await command(2,Uint8Array.of(12),1020)).status,2);assert.equal((await command(2,Uint8Array.of(1),65535)).status,2);assert.equal((await command(7)).status,0);});
await test('unknown/reserved bytes rejected by C semantics',async()=>{for(const o of [25,31,130,131,927,943,1023]){const bytes=cDefault.slice();bytes[o]=1;assert.equal(await cmd('V '+hex(bytes)),'0',`byte ${o}`);}});
await test('disconnect suppresses physically held key on new transport',async()=>{await link.apply(cDefault,false);await cmd('L 1 0');await cmd('K 0 1');await cmd('L 0 1');await cmd('X');await cmd('T 10');await cmd('K 0 0');await cmd('K 1 1');const reports=JSON.parse(await cmd('R'));assert(reports.some(r=>r[0]===2&&r[1]===1&&r.slice(5).includes(25)));assert(!reports.some(r=>r[0]===2&&r[1]===1&&r.slice(5).includes(6)));await cmd('K 1 0');});
await test('radial button signed angle and browser STATUS decoding',async()=>{await cmd('L 1 0');await cmd('X');await cmd('K 5 1');await cmd('E -1');await cmd('T 20');const reports=JSON.parse(await cmd('R'));assert(reports.some(r=>r[0]===1&&r[1]===3&&r[2]===3&&r[3]===1&&r[4]===0x4c&&r[5]===0xff));const p=await link.request(9),v=new DataView(p.buffer,p.byteOffset,p.byteLength);assert.equal(p[3]&32,32);assert.equal(v.getInt16(6,true),-1);assert.equal(v.getUint16(4,true),3921);assert.equal(p[8],1);await cmd('K 5 0');});
await test('inactive congested BLE reset cannot block active USB key',async()=>{await cmd('B 2 1');await cmd('L 1 1');await cmd('X');await cmd('K 0 1');await cmd('T 30');const reports=JSON.parse(await cmd('R'));assert(reports.some(r=>r[0]===1&&r[1]===1&&r.slice(5).includes(6)));await cmd('K 0 0');await cmd('B 2 0');await cmd('L 1 0');});
await test('DeviceLink rejects stale sequence and wrong offset before accepting correct ACK',async()=>{const mock=new DeviceLink();mock.kind='usb';let accepted=0;mock.device={sendReport:async(id,p)=>{const good=await coreFrame(p.slice(0,20));const seq=good.slice();seq[3]^=1;mock.receive(seq);assert(mock.pending);const offset=good.slice();offset[6]^=1;mock.receive(offset);assert(mock.pending);mock.receive(good);accepted++;}};const got=await mock.request(2,Uint8Array.of(12),32);assert.equal(got.length,12);assert.equal(accepted,1);});
await test('DeviceLink serializes simultaneous requests into one in flight',async()=>{const mock=new DeviceLink();mock.kind='usb';let active=0,maximum=0;mock.device={sendReport:async(id,p)=>{active++;maximum=Math.max(maximum,active);const good=await coreFrame(p.slice(0,20));active--;mock.receive(good);}};const got=await Promise.all(Array.from({length:12},()=>mock.request(9)));assert(got.every(p=>p.length===12));assert.equal(maximum,1);});
await test('DeviceLink disconnect rejects current request and queued stale generation',async()=>{const mock=new DeviceLink();mock.kind='usb';let sends=0;mock.device={sendReport:()=>{sends++;return Promise.resolve();},removeEventListener(){}};const promises=[mock.request(9),mock.request(9)];const resultPromise=Promise.allSettled(promises);await new Promise(resolve=>setImmediate(resolve));mock.cleanup();const results=await resultPromise;assert(results.every(p=>p.status==='rejected'));assert.equal(sends,1);});
// Native C may accept Consumer usages that the browser rejects; test both ends.
const broad=cDefault.slice();broad.set([2,0,0xff,0xff],32);assert.equal(await cmd('V '+hex(broad)),'1');
try{assert.deepEqual(schema.encode(schema.decode(broad)),broad);checks++;console.log('PASS full Consumer uint16 range interoperable');}catch(e){infoFinding('consumer-range',e.message);}
// Reproduce browser/transport recovery after write cancellation by unplug.
await cmd('L 1 0');const h=new Uint8Array(6);new DataView(h.buffer).setUint16(0,1024,true);new DataView(h.buffer).setUint32(2,schema.crc32(cDefault),true);assert.equal((await command(3,h)).status,0);assert.equal((await command(4,cDefault.slice(0,12),0)).status,0);await cmd('L 0 0');await cmd('U 1');await cmd('L 1 0');
try{await link.apply(cDefault,false);checks++;console.log('PASS interrupted transaction reconnect recovery');}catch(e){infoFinding('interrupted-transaction',e.message);await command(7);}
await test('USB/BLE transaction ownership rejects competing mutation',async()=>{assert.equal((await command(3,h)).status,0);for(const op of [3,4,5,6,7,8]){const payload=op===3?h:op===4?cDefault.slice(0,12):new Uint8Array();const response=schema.parseFrame(Uint8Array.from(Buffer.from(await cmd('G '+hex(schema.frame(op,42,payload,0))),'hex')));assert.equal(response.status,3,`competing op ${op}`);}assert.equal((await command(7)).status,0);});
// Invalid frame bytes exercise actual C boundary under ASan/UBSan builds.
await test('malformed frames and 65535 offset never overrun the fixed 20-byte response',async()=>{for(let i=0;i<128;i++){const frame=schema.frame(i%11, i,new Uint8Array(),65535);if(i%3===0)frame[4]=13+(i%240);else if(i%3===1)frame[5]=1;else frame[1]=2;const out=await coreFrame(frame);assert.equal(out.length,20);assert.equal(out[5],1);}});
await test('R2 schema migrates old JSON and encodes mouse/rates/mode at the real C offsets',async()=>{
 const old=schema.defaults();delete old.usbRate;delete old.bleInterval;delete old.macroModes;assert.deepEqual(schema.encode(old),cDefault);
 const c=schema.defaults();c.usbRate=4;c.bleInterval=3;c.profiles[2][7]={type:6,modifiers:0,value:31};c.macroModes[7]=2;c.macros[7]=[{type:5,modifiers:0,value:31,delay:17},{type:6,modifiers:0,value:31,delay:0}];
 const bytes=schema.encode(c);assert.equal(bytes[19],4);assert.equal(bytes[24],3);assert.equal(bytes[829],2);assert.equal(bytes[832],5);assert.equal(bytes[838],6);assert.equal(await cmd('V '+hex(bytes)),'1');
 await link.apply(bytes,true);assert.deepEqual(schema.decode(await link.read()),c);
 for(const change of [x=>x.usbRate=5,x=>x.bleInterval=4,x=>x.macroModes[0]=3,x=>x.profiles[0][0]={type:6,modifiers:0,value:0},x=>x.macros[0]=[{type:6,modifiers:1,value:1,delay:0}]]){const invalid=schema.defaults();change(invalid);assert.throws(()=>schema.encode(invalid));}
});
await test('real console capability guards reject unsupported R2 actions on old firmware',async()=>{
 const oldCaps=0x3f;consoleContext(schema.defaults(),link,oldCaps).requireCapabilities();
 const scenarios=[[x=>x.profiles[0][0]={type:6,modifiers:0,value:1},512],[x=>x.macros[0]=[{type:5,modifiers:0,value:1,delay:0}],512],[x=>x.macroModes[0]=1,1024],[x=>x.usbRate=1,256],[x=>x.statusLight.brightness=50,0x10000]];
 for(const [change,bit]of scenarios){const c=schema.defaults();change(c);assert.throws(()=>consoleContext(c,link,oldCaps).requireCapabilities());consoleContext(c,link,oldCaps|bit).requireCapabilities();}
});
await test('real console persistent save verifies 1024 bytes before command11, including after temporary apply',async()=>{
 const history=[],device=connectMock({history}),c=schema.defaults();c.usbRate=1;c.bleInterval=2;const context=consoleContext(c,device);
 const notified=[];context.calibrationEditor={validateDraft(){},saved:t=>notified.push(t)};
 await context.saveConfig(false,()=>{});assert(!history.includes(6)&&!history.includes(11));history.length=0;
 assert.equal(notified.length,0);
 await context.saveConfig(true,()=>{});const saved=history.indexOf(6);assert(saved>0);assert.deepEqual(history.slice(saved+1),[...Array(86).fill(2),11]);assert.equal(context.dirty,false);assert.equal(context.expectedReconnect,true);
 assert.equal(notified.length,1);
 const rate=JSON.parse(await cmd('Q'));assert.equal(rate[1],1);const status=await device.request(9);assert.equal(status[9],2);assert.equal(new DataView(status.buffer,status.byteOffset).getUint16(10,true),24);
 assert.notEqual(status[9],[1,8,4,2,1][c.usbRate],'STATUS reflects the actual platform interval, not requested settings');
});
await test('legacy firmware capabilities keep real console SAVE free of opcode11',async()=>{
 const history=[],device=connectMock({history}),context=consoleContext(schema.defaults(),device,0x3f);await context.saveConfig(true,()=>{});assert(history.includes(6));assert(!history.includes(11));assert.equal(context.expectedReconnect,false);
});
await test('saving unrelated edits preserves the live layer unless a startup layer is explicitly requested',async()=>{
 const device=connectMock({}),c=schema.defaults();c.profile=2;await device.apply(schema.encode(c),false);
 const draft=schema.defaults();draft.brightness=47;const context=consoleContext(draft,device);await context.saveConfig(true,()=>{});
 assert.equal(schema.decode(await device.read()).profile,2);
 context.config.profile=1;context.profileActivationRequested=true;await context.saveConfig(true,()=>{});assert.equal(schema.decode(await device.read()).profile,1);
});
await test('save readback mismatch blocks console reconfiguration and retains draft state',async()=>{
 const history=[];let corrupt=true;const device=connectMock({history,mutate:(response,request)=>{if(corrupt&&request[2]===2){corrupt=false;const out=response.slice();out[8]^=1;return out;}return response;}}),context=consoleContext(schema.defaults(),device);
 const notified=[];context.calibrationEditor={validateDraft(){},saved:t=>notified.push(t)};
 await assert.rejects(context.saveConfig(true,()=>{}),/回读/);assert(!history.includes(11));assert(history.includes(7));assert.equal(context.dirty,true);
 assert.equal(notified.length,0);
});
await test('command11 I/O failure is reported as saved but not activated by the real console',async()=>{
 const history=[],context=consoleContext(schema.defaults(),connectMock({history}));await cmd('P 0');try{await assert.rejects(context.saveConfig(true,()=>{}),/配置已保存.*启用失败/);}finally{await cmd('P 1');}assert(history.includes(11));assert.equal(context.dirty,false);assert.equal(context.expectedReconnect,false);
});
await test('real BLE DeviceLink uses 20-byte writes and transport-owned SAVE/READ/11',async()=>{
 const history=[],ble=connectMock({kind:'ble',history}),c=schema.defaults();c.usbRate=3;c.bleInterval=3;await ble.apply(schema.encode(c),true);await ble.request(11);assert.equal(JSON.parse(await cmd('Q'))[1],2);assert.deepEqual(history.slice(history.indexOf(6)+1),[...Array(86).fill(2),11]);
 await assert.rejects(link.request(11),/事务忙|失效/);
});
await test('recorder reserves releases at the 16-step boundary for mixed keyboard/mouse chords',async()=>{
 const r=new MacroRecorder();for(let i=0;i<4;i++)assert(r.input('key',4+i,true,i));for(const mask of [1,2,4,8])assert(r.input('mouse',mask,true,10));assert.equal(r.steps.length,8);
 assert.equal(r.input('key',20,true,20),false);assert.equal(r.active,false);assert.equal(r.held.size,0);assert.equal(r.steps.length,16);assert(r.steps.slice(8).every(s=>s.type===2||s.type===6));const steps=r.finish(100);assert.strictEqual(r.finish(200),steps);assert.equal(r.input('mouse',16,true,300),false);
 const c=schema.defaults();c.macros[0]=steps;assert.equal(await cmd('V '+hex(schema.encode(c))),'1');
});
await test('recorder ignores repeats/stray releases and preserves timing/fixed-delay modes',async()=>{
 const live=new MacroRecorder();live.input('key',6,false,0);live.input('key',6,true,100,1);live.input('key',6,true,101,1);live.input('mouse',1,true,140);live.input('key',6,false,190);const steps=live.finish(220);
 assert.equal(steps.length,4);assert.deepEqual(steps.map(s=>s.delay),[40,50,30,0]);assert.deepEqual(steps.map(s=>s.type),[1,5,2,6]);assert.equal(steps[2].modifiers,1);
 const fixed=new MacroRecorder({timing:false,fixedDelay:73});fixed.input('key',4,true,0);fixed.input('key',4,false,10000);fixed.input('mouse',2,true,50000);assert.deepEqual(fixed.finish(50001).map(s=>s.delay),[73,73,73,0]);
 const clamp=new MacroRecorder();clamp.input('key',4,true,100);clamp.input('key',4,false,50);clamp.input('key',5,true,50000);assert.deepEqual(clamp.finish(90000).map(s=>s.delay),[0,10000,10000,0]);
});
await test('recorded right/left modifiers replay without redundant Ctrl or stuck modifiers',async()=>{
 const r=new MacroRecorder();r.input('key',catalog.codeToHID.ControlRight,true,0);r.input('key',catalog.codeToHID.KeyC,true,10,catalog.eventModifiers({ctrlKey:true}));r.input('key',catalog.codeToHID.ControlRight,false,20);r.input('key',catalog.codeToHID.KeyC,false,30);
 const steps=r.finish(30);assert.equal(steps[1].modifiers,0);const reports=await playback(steps,link);const keyboard=reports.filter(r=>r[1]===1);assert(keyboard.some(r=>r[3]===16&&r.slice(5).includes(6)));assert(keyboard.some(r=>r[3]===0&&r.slice(5).includes(6)));assert(!keyboard.some(r=>r[3]&1));assert(keyboard.at(-1).slice(3).every(x=>x===0));
 const both=new MacroRecorder();both.input('key',224,true,0);both.input('key',228,true,10);both.input('key',6,true,20,1);both.input('key',224,false,30);both.input('key',228,false,40);both.input('key',6,false,50);const replay=await playback(both.finish(50),link);
 assert(replay.some(r=>r[1]===1&&r[3]===17&&r.slice(5).includes(6)));assert(replay.some(r=>r[1]===1&&r[3]===16&&r.slice(5).includes(6)));assert(replay.some(r=>r[1]===1&&r[3]===0&&r.slice(5).includes(6)));
 const fallback=new MacroRecorder();fallback.input('key',6,true,0,3);fallback.input('key',6,false,10);assert.deepEqual(fallback.finish(10).map(s=>s.modifiers),[3,3]);
});
await test('macro summary handles mouse bitmask releases without false unmatched warnings',async()=>{
 const steps=[{type:5,value:3,modifiers:0,delay:3},{type:6,value:1,modifiers:0,delay:5},{type:6,value:2,modifiers:0,delay:0}];assert.deepEqual(macroSummary(steps),{duration:8,warning:''});assert(macroSummary(steps.slice(0,2)).warning);assert(macroSummary([{type:6,value:1,modifiers:0,delay:0}]).warning);assert.match(catalog.mouseText(31),/左键.*右键.*中键.*后退.*前进/);
});
await test('browser-recorded mouse macro and trigger mode reach C execution without layout drift',async()=>{
 const recorded=new MacroRecorder({timing:false,fixedDelay:2});recorded.input('mouse',2,true,0);recorded.input('mouse',2,false,1);const c=schema.defaults();c.profiles[0][0]={type:6,modifiers:0,value:1};c.profiles[0][4]={type:4,modifiers:0,value:7};c.macros[7]=recorded.finish(1);c.macroModes[7]=2;
 await releaseInputs();await link.apply(schema.encode(c),false);await cmd('L 1 0');await cmd('T 0');await cmd('K 0 1');await cmd('K 4 1');await cmd('X');await cmd('T 0');await cmd('K 4 0');await cmd('T 2');await cmd('T 3');await cmd('T 4');let reports=JSON.parse(await cmd('R'));const mouse=reports.filter(r=>r[1]===4);assert.deepEqual(mouse.map(r=>r[3]),[3,1,3]);
 await cmd('K 4 1');reports=JSON.parse(await cmd('R'));assert.equal(reports.filter(r=>r[1]===4).at(-1)[3],1);await releaseInputs();
});
console.log(JSON.stringify({passed:checks,findings},null,2));
}finally{child.stdin.end();await exited;lines.close();}
