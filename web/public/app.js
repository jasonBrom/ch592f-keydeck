import * as THREE from './three.module.js';
import { OrbitControls } from './OrbitControls.js';
import { GLTFExporter } from './GLTFExporter.js';
import { followInput,clockwiseAngle,LiveRotation } from './input-motion.js?v=encoder-fix-20261007';
const liveRotation=new LiveRotation();

const $=id=>document.getElementById(id);
const stage=$('stage'), wrap=$('canvasWrap');
const PI=Math.PI, reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={explode:0,target:0,mode:'assembled',playing:false,direction:1,xray:false,labels:false,lights:true,color:'aurora',selected:null,lightMode:'rainbow',brightness:.35,ambientLevel:.32,bloom:.2,spread:.65,knobMode:'volume',volume:50,muted:false,knobAngle:0,knobTarget:0,finish:'graphite',lastInput:-10};
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35,1,1,1600);
camera.position.set(113,108,131);
let renderer;
try{
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'default'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<761?1.25:1.5));
 renderer.setClearColor(0x152027,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 wrap.appendChild(renderer.domElement);
}catch(e){$('loading').innerHTML='<strong>无法启动三维显示</strong><span>请使用支持 WebGL 的浏览器并开启硬件加速。</span>';throw e;}
// Keep the antialiased default framebuffer. Local optical spill needs no HDR/MSAA targets.
let contextLost=false;
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;releaseInteractions();toast('三维显示正在恢复…');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;renderer.setPixelRatio(1);lastWidth=lastHeight=0;resize();toast('三维显示已恢复');});
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,15,0);controls.enableDamping=true;controls.dampingFactor=.075;
controls.minDistance=32;controls.maxDistance=1000;controls.maxPolarAngle=PI;controls.minPolarAngle=.015;
controls.enablePan=true;controls.autoRotateSpeed=.8;controls.zoomSpeed=.7;
const product=new THREE.Group();product.name='CH592F_RevD_CONCEPT_mm';product.userData={units:'mm',basis:'Rev.D schematic and supplied component meshes; PCB layout, enclosure and battery envelope are conceptual.'};scene.add(product);
const parts={},groups=[],lightMeshes=[],keycaps=[],presses=[],switchStems=[];
const heldKeys=new Set(),keyCounts=Array(5).fill(0);
const pulses=Array(5).fill(-10);let knobStem=null,knobHeld=false,knobCap=null,knobRing=null,deviceInput=false;
let hardware,padsData,enclosureData,boardData,socketData,encoderData,selectedBox=null,viewTween=null,time=0,last=0,toastTimer,lastExplodePercentage=-1;
const TOP=13.6, BOARD_BOTTOM=12, CASE_TOP=17.6, TILT=6*PI/180;
const KNOB_X=20,KNOB_Z=-10,KNOB_BASE=TOP+11.5,CAP_BASE=TOP+9.1;
const keyPositions=[[-20,-10],[0,-10],[-20,10],[0,10],[20,10]];
const screwPositions=[[-30,22],[30,22],[-30,-22],[30,-22]];
product.rotation.x=TILT;product.position.y=1;
product.userData.enclosure={width:70,depth:56,typingAngleDeg:6};
const materials={
 shell:new THREE.MeshStandardMaterial({color:0x313e51,roughness:.36,metalness:.25}),
 base:new THREE.MeshStandardMaterial({color:0x171e2b,roughness:.48,metalness:.22}),
 cap:new THREE.MeshStandardMaterial({color:0xd6dce3,roughness:.44,metalness:.02}),
 accent:new THREE.MeshStandardMaterial({color:0xf49b45,roughness:.3,metalness:.62}),
 pcb:new THREE.MeshStandardMaterial({color:0x155b50,roughness:.6,metalness:.12}),
 gold:new THREE.MeshStandardMaterial({color:0xc5a55d,metalness:.8,roughness:.32,side:THREE.DoubleSide}),
 steel:new THREE.MeshStandardMaterial({color:0xb2bec0,metalness:.82,roughness:.28}),
 black:new THREE.MeshStandardMaterial({color:0x182126,roughness:.7}),
 rubber:new THREE.MeshStandardMaterial({color:0x121c20,roughness:.91}),
 foil:new THREE.MeshStandardMaterial({color:0x9ca6af,metalness:.65,roughness:.39}),
 wireRed:new THREE.MeshStandardMaterial({color:0xb54c3e,roughness:.52}),
 wireBlack:new THREE.MeshStandardMaterial({color:0x25333b,roughness:.57}),
 diff:new THREE.MeshStandardMaterial({color:0xbdebe1,roughness:.25,transparent:true,opacity:.52,depthWrite:false}),
 silk:new THREE.MeshBasicMaterial({color:0xc0d2c4,transparent:true,opacity:.85})
};
const ambient=new THREE.HemisphereLight(0xe7edff,0x202d41,2.0);scene.add(ambient);
const keyLight=new THREE.DirectionalLight(0xfff1d9,3.2);keyLight.position.set(-70,140,90);keyLight.castShadow=true;
keyLight.shadow.mapSize.set(1024,1024);Object.assign(keyLight.shadow.camera,{left:-95,right:95,top:110,bottom:-80,near:5,far:380});keyLight.shadow.bias=-.0006;keyLight.shadow.normalBias=.18;scene.add(keyLight);
const fill=new THREE.DirectionalLight(0x93ccd5,2.0);fill.position.set(85,75,-60);scene.add(fill);
const rim=new THREE.DirectionalLight(0xffd5b2,1.2);rim.position.set(-80,30,-75);scene.add(rim);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),new THREE.ShadowMaterial({opacity:.28}));ground.rotation.x=-PI/2;ground.position.y=-1.1;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(300,30,0x57757b,0x3c535d);grid.position.y=-1.03;grid.material.transparent=true;grid.material.opacity=.045;grid.material.depthWrite=false;scene.add(grid);

function mesh(geometry,material,parent,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent?.add(m);return m;}
function rrPath(w,d,r,x=0,y=0,hole=false){
 const p=hole?new THREE.Path():new THREE.Shape();let a=x-w/2,b=y-d/2;r=Math.min(r,w/2,d/2);
 p.moveTo(a+r,b);p.lineTo(a+w-r,b);p.quadraticCurveTo(a+w,b,a+w,b+r);p.lineTo(a+w,b+d-r);p.quadraticCurveTo(a+w,b+d,a+w-r,b+d);p.lineTo(a+r,b+d);p.quadraticCurveTo(a,b+d,a,b+d-r);p.lineTo(a,b+r);p.quadraticCurveTo(a,b,a+r,b);return p;
}
function hole(shape,x,z,w,d,r){shape.holes.push(rrPath(w,d,r,x,-z,true));}
function circleHole(shape,x,z,r){const p=new THREE.Path();p.absarc(x,-z,r,0,2*PI,true);shape.holes.push(p);}
function extrude(shape,height,y,mat,parent,bevel=0){const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:bevel>0,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:12});g.rotateX(-PI/2);return mesh(g,mat,parent,0,y,0);}
function roundedBox(w,h,d,r,mat,parent,x=0,y=0,z=0,bevel=.15){const g=new THREE.ExtrudeGeometry(rrPath(w-2*bevel,d-2*bevel,r),{depth:Math.max(.01,h-2*bevel),bevelEnabled:bevel>0,bevelSegments:3,bevelSize:bevel,bevelThickness:bevel,curveSegments:9});g.rotateX(-PI/2);return mesh(g,mat,parent,x,y+bevel,z);}
function cylinder(radius,height,mat,parent,x,y,z,segments=40){return mesh(new THREE.CylinderGeometry(radius,radius,height,segments),mat,parent,x,y+height/2,z);}
function ring(outer,inner,height,mat,parent,x,y,z){const s=new THREE.Shape();s.absarc(x,-z,outer,0,PI*2,false);circleHole(s,x,z,inner);return extrude(s,height,y,mat,parent);}
function cable(points,mat,parent,r=.35){const curve=new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v)));return mesh(new THREE.TubeGeometry(curve,48,r,7,false),mat,parent);}
function labelTexture(text,color='#bbd2d1',fontSize=70){const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle=color;ctx.font=`500 ${fontSize}px "Segoe UI",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,65);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
function textOnTop(text,w,d,x,y,z,parent,color,font=70){const mat=new THREE.MeshBasicMaterial({map:labelTexture(text,color,font),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});const m=mesh(new THREE.PlaneGeometry(w,d),mat,parent,x,y,z);m.rotation.x=-PI/2;m.castShadow=false;return m;}
function createPart(id,name,sub,description,specs,layer,explode,anchor=[0,0,0]){
 const g=new THREE.Group();g.name=id;g.userData.partId=id;product.add(g);
 const p={id,name,sub,description,specs,layer,explode,g,anchor:new THREE.Vector3(...anchor),base:g.position.clone(),visible:true};parts[id]=p;groups.push(p);return g;
}
function moveWith(g,x,y,z){g.position.set(x,y,z);parts[g.userData.partId].base.copy(g.position);return g;}
function addPad(p,parent,offset=[0,0],bottom=false){
 const w=p.size[0],h=p.size[1];if(!w||!h)return;
 const pos=p.at3d||[p.at[0],-p.at[1],0];const drill=p.drill?.size;
 if(p.number===''&&drill&&Math.abs(drill[0]-w)<.03)return;
 const s=rrPath(w,h,p.shape==='circle'?w/2:p.shape==='oval'?Math.min(w,h)/2:p.shape==='roundrect'?Math.min(w,h)*.2:.03);
 if(drill){const dh=drill[1]||drill[0];s.holes.push(rrPath(drill[0],dh,Math.min(drill[0],dh)/2,0,0,true));}
 const geo=new THREE.ShapeGeometry(s,8);const m=mesh(geo,materials.gold,parent,pos[0]-offset[0],pos[1]-offset[1],bottom?-1.62:.015);m.rotation.z=(p.rotation3dDeg||0)*PI/180;m.receiveShadow=true;m.castShadow=false;
 if(drill){const holeRadius=Math.min(...drill)/2;const wall=mesh(new THREE.CylinderGeometry(holeRadius,holeRadius,1.6,12,1,true),materials.gold,parent,pos[0]-offset[0],pos[1]-offset[1],-.8);wall.rotation.x=PI/2;}
}
const meshCache=new Map();
function nativeComponent(fpKey,parent,x,y,z,rotation=0,centering=null,withPads=true){
 const fp=padsData.footprints[fpKey];const obj=new THREE.Group();obj.position.set(x,y,z);obj.rotation.y=rotation;parent.add(obj);
 const local=new THREE.Group();local.rotation.x=-PI/2;obj.add(local);
 const offset=centering||[0,0];
 if(fp?.models)for(const md of fp.models){const data=hardware.models[md.meshKey];if(!data)continue;
  const modelG=new THREE.Group();modelG.rotation.set(...md.rotation3dDeg.map(v=>v*PI/180));modelG.scale.fromArray(md.scale);modelG.position.set(md.offset[0]-offset[0],md.offset[1]-offset[1],md.offset[2]);local.add(modelG);
  data.shapes.forEach((s,i)=>{const ck=md.meshKey+'_'+i;let cached=meshCache.get(ck);if(!cached){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(s.positions,3));geo.setIndex(s.indices);geo.computeVertexNormals();const color=new THREE.Color().setRGB(...s.color,THREE.SRGBColorSpace);const lum=(s.color[0]+s.color[1]+s.color[2])/3;const metallic=lum>.3&&Math.max(...s.color)-Math.min(...s.color)<.1;const mat=new THREE.MeshStandardMaterial({color,roughness:metallic?.38:.53,metalness:metallic?.52:.06,transparent:s.opacity<1,opacity:Math.max(.28,s.opacity),side:THREE.DoubleSide});cached={geo,mat};meshCache.set(ck,cached);}mesh(cached.geo,cached.mat,modelG);});
 }
 if(withPads&&fp)fp.pads.forEach(p=>{addPad(p,local,offset);if(p.type==='thru_hole')addPad(p,local,offset,true);});
 return obj;
}
function passive(parent,x,z,w=1,d=.5,kind='R',y=TOP){
 const mat=kind==='C'?new THREE.MeshStandardMaterial({color:0x9b896a,roughness:.68}):materials.black;
 roundedBox(w,.4,d,.08,mat,parent,x,y,z,.035);
 for(const side of [-1,1]){roundedBox(w*.22,.42,d,.03,materials.steel,parent,x+side*w*.39,y,z,.02);roundedBox(w*.35,.035,d*1.5,.04,materials.gold,parent,x+side*w*.5,y-.02,z,.01);}
}
function floorY(z){return Math.tan(TILT)*z-1/Math.cos(TILT);}
function enclosureMesh(which,parent){
 const d=enclosureData[which],g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(d.positions,3));g.setIndex(d.indices);g.setAttribute('normal',new THREE.Float32BufferAttribute(d.normals,3));g.computeBoundingBox();g.computeBoundingSphere();
 const m=mesh(g,materials.shell,parent);m.name=which==='base'?'Printable_lower_shell':'Printable_upper_shell';m.userData.printable=true;return m;
}
function buildShell(base){enclosureMesh('base',base);}
function movingStem(component,threshold){
 let chosen=null,best=-Infinity;
 component.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;let max=-Infinity;for(let i=0;i<p.count;i++)max=Math.max(max,p.getZ(i));if(max>best){best=max;chosen=o;}}});
 if(!chosen||best<threshold)return null;
 chosen.geometry=chosen.geometry.clone();const pos=chosen.geometry.attributes.position,rest=new Float32Array(pos.array);return {geo:chosen.geometry,pos,rest,threshold};
}
function moveStem(stem,travel){if(!stem)return;if(stem.group){stem.group.position.y=-travel;return;}const {pos,rest,threshold}=stem;for(let i=0;i<pos.count;i++)if(rest[i*3+2]>threshold)pos.setZ(i,rest[i*3+2]-travel);pos.needsUpdate=true;}
function buildFeedback(top){
 // The translucent housing distributes light; planes represent nearby diffuse spill.
 keyPositions.forEach(([x,z],i)=>{
  const mat=new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color(0x74c8ff)},uStrength:{value:1},uCenter:{value:new THREE.Vector2(x,z+5.2)},uSpan:{value:44}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
   fragmentShader:`varying vec2 vUv;uniform vec3 uColor;uniform float uStrength;uniform vec2 uCenter;uniform float uSpan;
    float rr(vec2 p){vec2 q=abs(p)-vec2(7.5);return length(max(q,0.))+min(max(q.x,q.y),0.)-1.1;}
    void main(){vec2 xy=(vUv-.5)*uSpan;vec2 p=vec2(xy.x,-xy.y)+uCenter;vec2 q=abs(p)-vec2(28.7,21.7);float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-6.;float mask=1.-smoothstep(-.35,0.,sd);float opening=min(min(rr(p-vec2(-20.,-10.)),rr(p-vec2(0.,-10.))),min(min(rr(p-vec2(-20.,10.)),rr(p-vec2(0.,10.))),rr(p-vec2(20.,10.))));mask*=smoothstep(-.12,.18,opening)*smoothstep(4.3,4.55,length(p-vec2(20.,-10.)));float d=length(xy)/(uSpan*.5);float g=exp(-d*d*5.5)*(1.-smoothstep(.7,1.,d));gl_FragColor=vec4(uColor*uStrength,g*mask*.42);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`
  });
  const glow=mesh(new THREE.PlaneGeometry(44,44),mat,top,x,20.06,z+5.2);glow.rotation.x=-PI/2;glow.castShadow=false;glow.userData.visualOnly=true;lightMeshes.push({mesh:glow,index:i,glow:true});
  // Primary light remains at the LED window; a weaker escaped-light proxy represents
  // scattering through the neutral housing. Neither recolors the switch material.
  const source=new THREE.PointLight(0x74c8ff,0,40,2);source.userData.visualOnly=true;source.position.set(x,13.8,z+5.2);parts.leds.g.add(source);lightMeshes.push({mesh:source,index:i,point:true,source:true});
  const escaped=new THREE.PointLight(0x74c8ff,0,38,2);escaped.userData.visualOnly=true;escaped.position.set(x,20.35,z+5.2);parts.switches.g.add(escaped);lightMeshes.push({mesh:escaped,index:i,point:true});

 });
 const ringMat=new THREE.MeshBasicMaterial({color:0xffb75d,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
 const r=mesh(new THREE.RingGeometry(10.4,10.9,72),ringMat,parts.knob.g,KNOB_X,KNOB_BASE+.2,KNOB_Z);r.rotation.x=-PI/2;r.castShadow=false;r.userData.visualOnly=true;knobRing=r;
}
function calibrateSwitchHousing(sw){
 // Correct the supplied illustrative mesh to the SAMZO drawing: flange at +5/+6 mm.
 // Preserve the PCB seating plane, pins and stem tip; this is not a new supplier mesh.
 const from=[.1,5.40004,6.10008,11.10008,11.3],to=[.1,5,6,11,11.3];
 for(const model of sw.children[0].children.filter(o=>o.isGroup))model.traverse(o=>{if(!o.isMesh)return;const g=o.geometry=o.geometry.clone(),p=g.attributes.position;for(let i=0;i<p.count;i++){const z=p.getZ(i),x=p.getX(i)-.63,y=p.getY(i)+3.81;if(z<.4002&&Math.abs(y)<1.1&&Math.abs(x)>4.5&&Math.abs(x)<6.45)p.setX(i,p.getX(i)+(x<0?.435:-.405));for(let j=1;j<from.length;j++)if(z>from[j-1]&&z<=from[j]){p.setZ(i,to[j-1]+(z-from[j-1])/(from[j]-from[j-1])*(to[j]-to[j-1]));break;}}p.needsUpdate=true;g.computeVertexNormals();});
 sw.userData.calibration='SAMZO drawing flange 5.00/6.00 mm; locator centers ±5.08 mm aligned to project footprint, subject to physical check';
}
function prepareSwitchMaterial(sw){
 let body=null,highest=-Infinity;sw.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;let h=-Infinity;for(let i=0;i<p.count;i++)h=Math.max(h,p.getZ(i));if(h>highest){body=o;highest=h;}});
 if(!body)return;
 // The supplied mesh joins housing and stem; assign fixed materials by height.
 const geometry=body.geometry=body.geometry.clone(),position=geometry.attributes.position,index=geometry.index;
 const ordered=[[],[],[]];for(let i=0;i<index.count;i+=3){const t=[index.getX(i),index.getX(i+1),index.getX(i+2)],hi=Math.max(...t.map(n=>position.getZ(n)));ordered[hi>11.31?2:hi<=4.1?0:1].push(...t);}
 geometry.setIndex(ordered.flat());geometry.clearGroups();let offset=0;ordered.forEach((ids,i)=>{geometry.addGroup(offset,ids.length,i);offset+=ids.length;});
 body.material=[new THREE.MeshStandardMaterial({color:0xd6d9da,roughness:.55}),new THREE.MeshStandardMaterial({color:0xe9edef,roughness:.25,metalness:0,transparent:true,opacity:.3,depthWrite:false,side:THREE.FrontSide}),new THREE.MeshStandardMaterial({color:0xe3e6df,roughness:.55})];
 body.name='Switch_neutral_housing_and_stem';body.castShadow=false;
}

function build(){
 const mechanical=enclosureData.parameters;
 const base=createPart('base','楔形底壳','2.0 mm 壳壁 / 2.0 mm 底板','底壳使用时底面水平，树脂打印包提供倾斜摆放的 STL。电池和振动器有一体承托台，四根支柱支撑 PCB，底部自攻螺丝固定到上盖。前壁有状态灯光窗，后壁有 USB-C 和电源开关孔，左壁有两个按钮针孔。',{外廓:'70 × 56 mm · 试装版',支柱:'Ø6.4 / 通孔 Ø2.4 mm',沉孔:'Ø4.6 mm',打印:'韧性树脂 · 倾斜 STL · 需加支撑'},'base',0,[30,9,19]);
 buildShell(base);

 const statusMat=new THREE.MeshStandardMaterial({color:0x72b4ff,emissive:0x458fff,emissiveIntensity:1.8,roughness:.3});
 const status=roundedBox(4.3,.7,.06,.25,statusMat,base,0,13.7,28.01,.02);status.userData.visualOnly=true;lightMeshes.push({mesh:status,index:5,status:true});
 const frontText=mesh(new THREE.PlaneGeometry(14,1.9),new THREE.MeshBasicMaterial({map:labelTexture('C H 5 9 2','#a0aab9'),transparent:true,depthWrite:false}),base,-17,7.8,28.015);frontText.castShadow=false;
 const feet=createPart('feet','脚垫与底部螺丝','前 M2×14 / 后 M2×18 · 自攻','四颗底部螺丝经过支柱通孔与 PCB，直接拧入上盖树脂螺柱。前后采用不同长度的 Ø2 mm 自攻螺丝，底孔 Ø1.8 mm；先用孔径小样核对实际螺丝与韧性树脂的配合。脚垫另行粘贴。',{脚垫:'4 × 硅胶垫 · 另配',螺丝:'前 M2×14 / 后 M2×18 · 自攻',孔位:'X ±30 / Z ±22 mm'},'feet',-12,[29,0,20]);
 for(const [x,z]of [[-25,-19],[25,-19],[-25,19],[25,19]]){const f=new THREE.Group();f.position.set(x,floorY(z),z);f.rotation.x=-TILT;feet.add(f);roundedBox(10,.9,6,2,materials.rubber,f,0,-.85,0,.15);}
 screwPositions.forEach(([x,z])=>{const seat=floorY(z)+mechanical.head_seat_above_local_floor,length=z>0?mechanical.reference_screw_length_front:mechanical.reference_screw_length_rear;cylinder(1,length-.6,materials.steel,feet,x,seat,z,24);const tip=mesh(new THREE.ConeGeometry(1,.6,24),materials.steel,feet,x,seat+length-.3,z);cylinder(1.9,2,materials.black,feet,x,seat-2,z,32);mesh(new THREE.BoxGeometry(2.1,.08,.38),materials.steel,feet,x,seat-2.03,z);mesh(new THREE.BoxGeometry(.38,.08,2.1),materials.steel,feet,x,seat-2.03,z);});
 const battery=createPart('battery','双线锂电池','1S · 800mAh','单节带保护板软包，使用红黑两根线。电池尺寸仅为占位；没有额外引出 NTC 线。',{容量:'800 mAh · 项目规格',外形:'40 × 30 × 5 mm · 估算',接口:'JST-PH 2.0 · 双线'},'battery',18,[-3,7,0]);
 roundedBox(38,.2,28,1,materials.rubber,battery,-3,3.0,0,.02);
 roundedBox(40,5,30,1.2,materials.foil,battery,-3,3.2,0,.3);
 roundedBox(41.5,.22,32,1.1,materials.foil,battery,-3,5.5,0,.03);
 roundedBox(7,.25,28,.3,new THREE.MeshStandardMaterial({color:0xc9a14d,transparent:true,opacity:.8,roughness:.4}),battery,14.8,8.2,0,.03);
 const sticker=roundedBox(27,.07,20,.6,new THREE.MeshStandardMaterial({color:0xd0d5cd,roughness:.9}),battery,-7,8.25,0,.01);
 textOnTop('Li-ion  800mAh',24,3,-7,8.35,-2,battery,'#344a4d',85);textOnTop('1S  /  2-WIRE',19,2,-7,8.36,3,battery,'#516269',65);
 cable([[17,6,-8],[23,7,-11],[24,8,-18],[17,9.2,-23]],materials.wireRed,battery,.37);
 cable([[17,6,-10],[21,7,-13],[20,7.7,-18.5],[15,8.4,-21.1],[15,9.2,-23]],materials.wireBlack,battery,.37);
 const haptic=createPart('haptic','线性振动器','LD0832AA-0099F','Ø8 × 3.2 mm LRA 以泡棉胶固定在底壳刚性位置。DRV2605L 驱动芯片随 PCB 安装。',{尺寸:'Ø8 × 3.2 mm',谐振频率:'235 ± 10 Hz',额定驱动:'1.8 Vrms'},'battery',0,[25,5.8,15]);
 cylinder(4.15,.7,materials.rubber,haptic,25,3.1,15);cylinder(4,3.2,materials.steel,haptic,25,3.8,15);cylinder(3.2,.06,materials.foil,haptic,25,7.02,15);textOnTop('LRA',6,1.2,25,7.11,15,haptic,'#40575a',80);
 cable([[28.8,5.3,14],[30.6,6.5,15],[26.6,8.5,18.5],[24.8,10.4,20.9],[24.8,11.7,21]],materials.wireRed,haptic,.22);cable([[28.9,5.3,15],[30.8,6.5,16],[28,8.5,18.5],[25.8,10.4,20.9],[25.8,11.7,21]],materials.wireBlack,haptic,.22);
 const pcb=createPart('pcb','主电路板','FR-4 · 器件分区示意','沿用 Rev.D 器件型号与封装，板框及元件位置为本次概念排布。仅显示焊盘，没有实际铜走线。',{板框:'65.6 × 51.6 × 1.6 mm · 概念',主控:'CH592F · QFN-28',灯光:'5 颗反贴 + 1 颗侧发光'},'pcb',43,[-31,TOP,7]);
 const pcbShape=rrPath(65.6,51.6,3.6);
 // The drawing and the visible PCB share all mechanical holes and LED windows.
 for(const f of boardData.features){if(f.layer!=='PCB'||!['drill','window'].includes(f.kind))continue;
  if(f.hole_shape==='circle')circleHole(pcbShape,f.x,-f.y,f.width/2);
  else hole(pcbShape,f.x,-f.y,f.width,f.height,f.corner_radius??Math.min(f.width,f.height)/2);
 }
 extrude(pcbShape,1.6,12,materials.pcb,pcb,0);screwPositions.forEach(([x,z])=>{ring(2.2,1.2,.04,materials.gold,pcb,x,TOP+.035,z);ring(2.2,1.2,.04,materials.gold,pcb,x,11.94,z);ring(2.5,1.25,.46,materials.rubber,pcb,x,13.64,z);});
 textOnTop('CH592F / REV.D',27,2.6,-15,TOP+.08,-18.3,pcb,'#bed3bf',65);
 textOnTop('CONCEPT PLACEMENT',26,2,-3,TOP+.085,24.4,pcb,'#9bb9a6',58);
 const chip=createPart('mcu','CH592F 与时钟','U1 · Y1 / Y2 · PCB 背面','主控和时钟在本次结构方案中放在 PCB 背面，避开轴座与电池。采用工程原始网格，具体布线和射频仍待布局验证。',{主控:'CH592F · QFN-28',芯片本体:'4 × 4 × 0.9 mm',位置:'PCB 背面 · 概念排布'},'pcb',43,[-15,11,-22]);
 for(const [fp,x,z]of [['VQFN-28_L4.0-W4.0-P0.40-BL-EP2.6',-15,-22],['CRYSTAL-SMD_4P-L3.2-W2.5-BL',-22,-22],['CRYSTAL-SMD_L2.0-W1.2',-22,-18.5]]){const c=nativeComponent(fp,chip,x,BOARD_BOTTOM,z);c.rotation.x=PI;}
 const power=createPart('power','电源与触觉驱动','ETA6002 · TPS631000 · DRV2605L','沿用 Rev.D 的充电、电源路径与 3.807 V 电源方案。真实封装网格配合概念分区，未布实际走线。',{充电与路径:'ETA6002E8A',负载电源:'TPS631000 · 3.807 V',触觉驱动:'DRV2605LDGSR'},'pcb',43,[8,14,-23]);
 nativeComponent('ESOP-8_L4.9-W3.9-P1.27-LS6.0-BL-EP-1',power,7.3,TOP,-22);
 nativeComponent('SOT-583-8_L2.1-W1.2-P0.50-LS1.6-BL',power,15,TOP,-22);
 nativeComponent('VSSOP-10_L3.0-W3.0-P0.50-LS4.9-BL',power,22,TOP,22);
 nativeComponent('SOT-23-3_L3.0-W1.7-P0.95-LS2.9-BR',power,6,TOP,22);
 nativeComponent('SOT-23-5_L2.9-W1.6-P0.95-LS2.8-BR',power,-7,TOP,22);
 nativeComponent('SOT-23-5_L2.9-W1.6-P0.95-LS2.8-BR',power,-13,TOP,22);
 for(const [x,z]of [[11.85,-21.8],[15,-24.5]]){roundedBox(2.5,1.2,2,.3,materials.black,power,x,TOP,z,.1);textOnTop('2R2',2,.65,x,TOP+1.23,z,power,'#a5b5ad',80);}
 for(let i=0;i<16;i++)passive(power,i===15?-28:-25+i*3.1,i===15?18:19.9,1,.5,i%3?'C':'R');
 [[2,-18.4],[-7,-22],[-10,-22],[-13,-22],[12,-18.7],[14.5,-18.7],[17,-18.7]].forEach(([x,z],i)=>passive(power,x,z,1.6,.8,i%2?'R':'C'));
 const conn=createPart('ports','USB-C 与电源开关','J1 · C963206','USB-C 沿用工程原始模型；电源开关换为 C963206，按原厂尺寸绘制本体与拨杆。接口位置向板内调整，避免固定焊盘越出板框。',{USB接口:'GT-USB-7010ANS',开关:'MK-12C02-G020 · C963206',本体:'6.6 × 2.7 × 1.4 mm',拨杆:'横向行程 1.5 mm'},'pcb',43,[0,15,-27]);
 nativeComponent('USB-C-SMD_GT-USB-7010ANS',conn,0,TOP,-22.2,PI);
 const slide=new THREE.Group();slide.position.set(23,TOP,-23.9);conn.add(slide);
 roundedBox(6.6,1.25,2.7,.15,materials.black,slide,0,0,0,.04);
 roundedBox(6.6,.15,2.7,.15,materials.steel,slide,0,1.25,0,.035);
 roundedBox(1.3,1.15,2.1,.12,materials.black,slide,.75,.1,-2.3,.03);
 for(const x of [-1.5,1.5])cylinder(.35,.5,materials.black,slide,x,-.5,0,16);
 for(const f of boardData.features.filter(f=>f.ref==='SW1'&&f.kind==='pad')){roundedBox(f.width,.035,f.height,.03,materials.gold,conn,f.x,TOP+.01,-f.y,.008);roundedBox(f.pad_number<'4'?.4:.6,.12,f.pad_number<'4'?1.1:.5,.02,materials.steel,conn,f.x,TOP+.05,-f.y,.015);}
 const service=createPart('service','侧按复位与下载开关','SW2 RESET · SW3 BOOT · C2762970','两个侧按开关朝向左侧，Ø1.6 mm 维护孔与按钮轴线对准。图纸以两定位柱中点作为器件基准；焊盘完整尺寸需在 PCB 定版前复核。',{型号:'GT-TC018B-H0375-L1 · C2762970',按压:'沿 PCB 平面向内按',侧孔:'2 × Ø1.6 mm · 左侧',基准:'X −30.4；Y +7 / −7 mm'},'pcb',43,[-30.4,14.55,-7]);
 for(const [x,y,z]of mechanical.tactile_centers_app){
  const g=new THREE.Group();g.position.set(x,y,z);service.add(g);
  roundedBox(2.3,1.76,4.7,.12,materials.black,g,.2,0,0,.03);
  roundedBox(2.3,.14,4.7,.12,materials.steel,g,.2,1.76,0,.025);
  roundedBox(1.45,.8,1.7,.12,materials.black,g,-1.675,.55,0,.03);
  for(const pz of [-.85,.85])cylinder(.25,.4,materials.black,g,0,-.4,pz,16);
 }
 for(const f of boardData.features.filter(f=>['SW2','SW3'].includes(f.ref)&&f.kind==='pad')){const g=roundedBox(f.width,.035,f.height,.04,materials.gold,service,f.x,TOP+.01,-f.y,.008);g.rotation.y=(f.rotation_deg||0)*PI/180;}
 for(const [z,label]of [[-7,'RST'],[7,'BOOT']]){const t=mesh(new THREE.PlaneGeometry(5,1.2),new THREE.MeshBasicMaterial({map:labelTexture(label,'#c2cad5',65),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),base,-35.035,16.6,z);t.rotation.y=-PI/2;t.castShadow=false;}
 // Internal B-side two-pin battery connector and board-mounted temperature proxy.
 roundedBox(8,4.4,5,1,new THREE.MeshStandardMaterial({color:0xd9dfd2,roughness:.7}),conn,16,7.6,-23,.15);
 for(let i=0;i<2;i++)mesh(new THREE.BoxGeometry(.55,.55,3.4),materials.gold,conn,15+i*2,9.3,-24);
 roundedBox(1.6,.6,.8,.15,new THREE.MeshStandardMaterial({color:0xa58a69,roughness:.7}),pcb,-9,11.3,0,.04);

 const rf=createPart('rf','2.4 GHz 陶瓷天线','AE1 · RF 匹配区','工程内陶瓷天线网格；此处以空白区域表达天线端的概念净空，仍需以最终布局和整机调谐确定。',{天线:'3.1 × 1.6 × 0.61 mm',安装:'PCB 边缘 · 概念位置',后续:'净空与整机 RF 复核'},'pcb',43,[-32,TOP+1,-24]);
 nativeComponent('ANT-SMD_L3.1-W1.6',rf,-29.5,TOP,-14,PI/2);
 textOnTop('RF',5,1.5,-30,TOP+.07,-10,rf,'#c1d7bd',80);passive(rf,-29,-16.8,1,.5);passive(rf,-29,-18.2,1,.5,'C');
 const switches=createPart('switches','五颗热插拔机械键轴','SAMZO 28115181DM × 5','上盖定位台阶承托键轴法兰，侧卡扣扣住定位面，限制本体上下及横向移动。底部针脚插入 PCB 背面的 C49352235 轴座；拆解时键轴可单独拔出。打印配合需先用定位孔小样核对。',{数量:'5 颗 · SW4—SW8',固定:'法兰 + 卡扣 + 定位孔',轴座:'C49352235 · 焊在 PCB 背面',排布:'20 mm 节距'},'switches',82,[-21,23,10.5]);
 keyPositions.forEach(([x,z],i)=>{const sw=nativeComponent('KEY-TH_28115181DM',switches,x,TOP,z,0,[.63,-3.81],false);calibrateSwitchHousing(sw);prepareSwitchMaterial(sw);switchStems.push(movingStem(sw,11.31));textOnTop('SW'+(i+4),6,1.2,x,TOP+.09,z-9.5,pcb,'#b1cbb5',70);});
 const sockets=createPart('sockets','五颗热插拔轴座','C49352235 · CPG151101S11-2','轴座焊在 PCB 背面，两处绝缘凸台进入板上 Ø3.0 mm 孔。针脚插入金属弹片完成电连接；键轴的机械固定由上盖定位台阶与轴体原卡扣承担。采用立创关联的轴座网格，尺寸公差按原厂图留空间。',{数量:'5 颗 · 瀚源白色轴座',安装:'PCB 背面 · 主体下凸1.8 mm',轴座孔:'2 × Ø3.0 NPTH / 每轴',固定:'SMT焊接 · 拔轴时留在PCB'},'pcb',43,[-20,11,-13.81]);
 const socketGeometries=socketData.shapes.map(s=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(s.positions,3));g.setIndex(s.indices);g.computeVertexNormals();return {g,mat:new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...s.color,THREE.SRGBColorSpace),metalness:s.metalness,roughness:s.roughness,side:THREE.DoubleSide}),name:s.name};});
 keyPositions.forEach(([x,z],i)=>{const g=new THREE.Group();g.name='Socket_'+(i+1);g.position.set(x-.635,BOARD_BOTTOM,z-3.81);g.rotation.x=PI/2;sockets.add(g);for(const s of socketGeometries){const m=mesh(s.g,s.mat,g);m.name=s.name;}});
 for(const f of boardData.features.filter(f=>/^SW[4-8]$/.test(f.ref)&&f.kind==='pad'&&f.copper_layer==='B.Cu')){const m=roundedBox(f.width,.04,f.height,.035,materials.gold,sockets,f.x,BOARD_BOTTOM-.055,-f.y,.005);m.rotation.y=(f.rotation_deg||0)*PI/180;}
 const enc=createPart('encoder','短轴按压编码器 · 建议方案','Bourns PEC11L-4115K-S0020','本次按原厂尺寸图建模：Ø6 mm、18齿花轴，带按压。轴尖比原 EC11N 低5 mm；PCB孔位随建议型号更新。此型号尚未由你确认购买，原旋钮帽需核对18齿和插入深度。',{方案:'PEC11L-4115K-S0020 · 待选型确认',手感:'20定位 / 20脉冲 · 按压0.5 mm',高度:'PCB上19.5 mm · 原24.5 mm',花轴:'Ø6 / 18齿 · M7螺套'},'switches',43,[21,29,-10.5]);
 const eg=new THREE.Group();eg.position.set(KNOB_X,TOP,KNOB_Z);enc.add(eg);
 roundedBox(11.8,4,12,.35,materials.black,eg,0,0,0,.08);
 roundedBox(11.8,.5,12,.35,materials.steel,eg,0,4,0,.05);
 for(const x of [-6.25,6.25])roundedBox(.7,4.5,2.1,.12,materials.steel,eg,x,0,0,.03);
 cylinder(3.5,5,materials.steel,eg,0,4.5,0,48);
 for(const h of encoderData.signal_holes){const g=new THREE.Group();g.name='Terminal_'+h.terminal;eg.add(g);mesh(new THREE.BoxGeometry(.5,3.4,.5),materials.gold,g,h.x,-1.3,-h.y);}
 for(const h of encoderData.shell_anchor_slots){const g=new THREE.Group();g.name='Anchor_'+h.id;eg.add(g);mesh(new THREE.BoxGeometry(.7,3.4,1.5),materials.steel,g,h.x,-1.3,-h.y);}
 const shaft=new THREE.Group();shaft.name='PEC11L_rotating_press_shaft';eg.add(shaft);knobStem={group:shaft};
 cylinder(2.98,8,materials.steel,shaft,0,4.5,0,48);
 const teethPoints=Array.from({length:72},(_,i)=>{const a=i/72*2*PI,r=i%4<2?3:2.78;return [Math.cos(a)*r,Math.sin(a)*r];});
 const profile=pts=>{const sh=new THREE.Shape();pts.forEach(([x,y],i)=>i?sh.lineTo(x,y):sh.moveTo(x,y));sh.closePath();return sh;};
 extrude(profile(teethPoints),1,12.5,materials.steel,shaft);
 for(const side of [-1,1]){const clipped=[];for(let i=0;i<teethPoints.length;i++){const a=teethPoints[i],b=teethPoints[(i+1)%teethPoints.length],insideA=a[0]*side>=.5,insideB=b[0]*side>=.5;if(insideA)clipped.push(a);if(insideA!==insideB){const t=(.5*side-a[0])/(b[0]-a[0]);clipped.push([.5*side,a[1]+t*(b[1]-a[1])]);}}extrude(profile(clipped),6,13.5,materials.steel,shaft);}
 const leds=createPart('leds','反贴背光与状态灯','5 × GL6028 + 1 × XL-4020','五颗 GL6028 装在 PCB 背面，经光窗朝上出光；一颗 XL-4020 在正面向侧边发光，使用独立数据通道。',{主背光:'5 × GL6028RGB01H-W',开窗:'3.4 × 3.0 mm · 首板值',状态灯:'XL-4020 · 独立链'},'pcb',43,[0,12,15.7]);
 keyPositions.forEach(([x,z],i)=>{
  const m=new THREE.MeshStandardMaterial({color:0xc6ece0,emissive:0x39bda9,emissiveIntensity:1.1,roughness:.24});
  roundedBox(6,1.6,2.8,.2,new THREE.MeshStandardMaterial({color:0xdedecb,roughness:.5}),leds,x,10.4,z+5.2,.08);
  lightMeshes.push({mesh:roundedBox(3.1,.12,2.6,.3,m,leds,x,11.99,z+5.2,.03),index:i});
  for(const f of boardData.features.filter(f=>f.ref==='D'+(i+2)&&f.kind==='pad'))roundedBox(f.width,.05,f.height,.025,materials.gold,leds,f.x,11.92,-f.y,.01);

 });
 const sideM=new THREE.MeshStandardMaterial({color:0xd0eee3,emissive:0x41c7a6,emissiveIntensity:1.3,roughness:.35});
 roundedBox(4,.9,2,.18,new THREE.MeshStandardMaterial({color:0xd1d8c8,roughness:.5}),leds,0,TOP,24.0,.05);
 lightMeshes.push({mesh:mesh(new THREE.BoxGeometry(3,.7,.08),sideM,leds,0,TOP+.45,25.1),index:5,status:true});
 const top=createPart('top','带键轴定位台阶的上盖','R1.2 / 1.5 mm 卡扣区 / 自攻螺柱','上盖外缘保持圆弧，五个键位增加一体定位台阶。键轴法兰落在定位面，原有侧卡扣扣住下缘；不依靠轴座承受侧向摇动。孔径需要用实际键轴与后固化小样试配。',{外廓:'70 × 56 mm',定位孔:'14.1 × 14.1 mm · R0.15 · 试配值',卡扣区:'厚1.5 mm · 高于PCB顶面5 mm',裙边:'单边间隙0.25 mm · 一体连接'},'top',65,[31,20,18]);
 enclosureMesh('top',top);
 // M2 self-tapping screws engage the printed bosses directly; no insert mesh.
 textOnTop('CH592  /  FIVE',24,2,-10,20.04,23,top,'#c2cad5',65);

 const capsGroup=createPart('caps','五颗键帽','MX 1U · 概念键帽','五颗独立键帽，使用中空裙边与十字安装座。按住时键帽和轴心一起下压，松开后回弹，并触发 LED 灯光反馈；标号仅用于区分键位。',{数量:'5 × 1U',外形:'18 × 18 mm · 估算',标签:'01—05 · 可自定义'},'caps',105,[0,33,10.5]);
 const capGeometry=makeCapGeometry();
 keyPositions.forEach(([x,z],i)=>{
  const g=new THREE.Group();g.position.set(x,CAP_BASE,z);g.userData.pressKey=i;capsGroup.add(g);mesh(capGeometry,materials.cap,g);
  const crossOuter=rrPath(6.1,6.1,1);const cross=new THREE.Path();cross.moveTo(-.68,-2.12);cross.lineTo(.68,-2.12);cross.lineTo(.68,-.68);cross.lineTo(2.12,-.68);cross.lineTo(2.12,.68);cross.lineTo(.68,.68);cross.lineTo(.68,2.12);cross.lineTo(-.68,2.12);cross.lineTo(-.68,.68);cross.lineTo(-2.12,.68);cross.lineTo(-2.12,-.68);cross.lineTo(-.68,-.68);cross.closePath();crossOuter.holes.push(cross);extrude(crossOuter,4.7,1.4,materials.cap,g);
  const legend=textOnTop('0'+(i+1),5.4,2.6,0,7.98,.2,g,'#ffffff',90);
  roundedBox(3,.05,.33,.15,materials.accent,g,0,8.07,-4.7,.015);
  keycaps.push({g,legend,base:g.position.y,travel:0,index:i});
 });
 const knob=createPart('knob','旋钮帽','Ø20 × 10 mm · 花轴胶芯','保留 Ø20 × 10 mm 外形，按短编码器建议方案降低安装位置，帽顶比上一版低4.3 mm。胶芯预览为Ø6、18齿；你的实物齿数和插孔深度仍需确认。',{外形:'Ø20 × 10 mm · 用户指定',胶芯:'Ø6 / 18齿预览 · 实物待核',位置:'帽顶低4.3 mm · 名义插入8 mm'},'caps',111,[20,35,-10]);
 const kg=new THREE.Group();kg.position.set(KNOB_X,KNOB_BASE,KNOB_Z);kg.userData.pressKnob=true;knob.add(kg);knobCap=kg;
 // A continuous closed shell gives the knob exactly one exterior top surface.
 const knobProfile=[[7.6,.25],[9.7,.25],[9.95,.5],[9.95,9.5],[9.7,9.85],[9.35,10],[0,10],[0,9.2],[7.6,9.2],[7.6,.25]].map(([r,y])=>new THREE.Vector2(r,y));
 const knobSurface=mesh(new THREE.LatheGeometry(knobProfile,96),materials.accent,kg);knobSurface.name='Knob_continuous_shell';
 const inner=new THREE.Shape();inner.absarc(0,0,7.4,0,2*PI,false);const teeth=new THREE.Path();for(let i=0;i<72;i++){const a=i/72*2*PI,r=i%4<2?3.12:2.9;i?teeth.lineTo(Math.cos(a)*r,Math.sin(a)*r):teeth.moveTo(Math.cos(a)*r,Math.sin(a)*r);}teeth.closePath();inner.holes.push(teeth);extrude(inner,6.5,1.8,materials.black,kg);ring(7.4,3.15,1,materials.black,kg,0,.8,0);
 for(let i=0;i<64;i++){const a=i/64*2*PI;const gr=mesh(new THREE.BoxGeometry(.18,6.9,.20),new THREE.MeshStandardMaterial({color:0x915322,roughness:.44,metalness:.5}),kg,Math.sin(a)*9.86,5.3,Math.cos(a)*9.86);gr.rotation.y=a;}
 const markerMat=new THREE.MeshBasicMaterial({color:0xe2f1d8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 const marker=mesh(new THREE.ShapeGeometry(rrPath(.7,3.2,.3)),markerMat,kg,0,10.04,-5.3);marker.rotation.x=-PI/2;marker.castShadow=false;marker.name='Knob_indicator';
 const washer=createPart('washer','编码器垫圈与螺母','M7轴套固定 · 外形示意','垫圈和螺母将编码器轴套固定在上盖，配合 PCB 焊脚稳定旋钮。这里采用薄垫圈与薄螺母占位；需核对实际随附紧固件尺寸。',{接口:'M7 × 0.75',垫圈:'Ø12 × 0.5 mm · 占位',螺母:'对边11 / 厚2 mm · 占位'},'top',65,[21,22,-10.5]);
 ring(6,3.6,.5,materials.steel,washer,KNOB_X,20.03,KNOB_Z);
 const nutShape=new THREE.Shape();for(let i=0;i<6;i++){const a=i*PI/3,r=11/Math.sqrt(3);i?nutShape.lineTo(Math.cos(a)*r,Math.sin(a)*r):nutShape.moveTo(Math.cos(a)*r,Math.sin(a)*r);}nutShape.closePath();circleHole(nutShape,0,0,3.55);const nut=extrude(nutShape,2,20.55,materials.steel,washer);nut.position.x=KNOB_X;nut.position.z=KNOB_Z;
 buildFeedback(top);setupLayers();createAnnotations();
 product.updateMatrixWorld(true);
}
function makeCapGeometry(){
 const vertices=[],uvs=[],indices=[];const seg=64;
 function outline(w,r){const s=rrPath(w,w,r);const pts=s.getSpacedPoints(seg);return pts.slice(0,seg);}
 const layers=[[18,1.65,0],[17.45,1.8,1.1],[15.7,2.2,7.55],[15.3,2.3,8.4]];
 layers.forEach(([w,r,y],l)=>{outline(w,r).forEach((p,i)=>{vertices.push(p.x,y,-p.y);uvs.push(i/seg,l/3);});});
 for(let l=0;l<3;l++)for(let i=0;i<seg;i++){const a=l*seg+i,b=l*seg+(i+1)%seg,c=(l+1)*seg+i,d=(l+1)*seg+(i+1)%seg;indices.push(a,c,b,b,c,d);}
 // Hollow underside: tapered inner wall, joined only at the skirt lip.
 const innerStart=vertices.length/3;outline(15.8,1.2).forEach((p,i)=>{vertices.push(p.x,.12,-p.y);uvs.push(i/seg,0);});
 const innerTop=vertices.length/3;outline(13.6,1.5).forEach((p,i)=>{vertices.push(p.x,6.5,-p.y);uvs.push(i/seg,1);});
 for(let i=0;i<seg;i++){let j=(i+1)%seg;indices.push(i,j,innerStart+i,j,innerStart+j,innerStart+i);indices.push(innerStart+i,innerStart+j,innerTop+i,innerStart+j,innerTop+j,innerTop+i);}
 const center=vertices.length/3;vertices.push(0,7.78,0);uvs.push(.5,.5);
 // Top rings curve down gently toward the center, producing a shallow dished top.
 let previous=3*seg;
 for(let ringI=1;ringI<=5;ringI++){const scale=1-ringI/6,start=vertices.length/3;outline(15.3,2.3).forEach((p,i)=>{vertices.push(p.x*scale,7.78+.62*scale*scale,-p.y*scale);uvs.push(p.x*scale/18+.5,p.y*scale/18+.5);});for(let i=0;i<seg;i++){const j=(i+1)%seg;indices.push(previous+i,start+i,previous+j,previous+j,start+i,start+j);}previous=start;}
 for(let i=0;i<seg;i++)indices.push(previous+i,center,previous+(i+1)%seg);
 for(let i=0;i<indices.length;i+=3){const t=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=t;}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
const layerDefinitions=[
 ['caps','01','键帽与旋钮帽','5 × 1U / Ø20 mm'],['top','02','上盖','键位开口与面板'],['switches','03','键轴与编码器','键轴热插拔 · 编码器焊接'],['pcb','04','主电路板与轴座','CH592F / RGB / 热插拔'],['battery','05','锂电池','800mAh · 双线'],['haptic','06','线性振动器','Ø8 × 3.2 mm'],['base','07','底壳','支柱与接口开口'],['feet','08','脚垫与紧固件','固定与防滑']
];
const layerRepresentative={caps:'caps',top:'top',switches:'switches',pcb:'pcb',battery:'battery',haptic:'haptic',base:'base',feet:'feet'};
function layerParts(id){return groups.filter(p=>id==='haptic'?p.id==='haptic':id==='battery'?p.id==='battery':p.layer===id&&p.id!=='haptic');}
function eyeIcon(hidden){return `<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${hidden?'<path d="M3 3 18 18"/>':''}</svg>`;}
function setupLayers(){
 $('layerList').innerHTML=layerDefinitions.map(([id,n,title,sub])=>`<div class="layer" data-layer="${id}"><button class="layer-select" data-select="${id}"><span class="layer-num">${n}</span><span class="layer-title">${title}<small>${sub}</small></span></button><button class="layer-eye" data-eye="${id}" title="隐藏${title}" aria-label="隐藏${title}" aria-pressed="true">${eyeIcon(false)}</button></div>`).join('');
 $('layerList').addEventListener('click',e=>{const sel=e.target.closest('[data-select]'),eye=e.target.closest('[data-eye]');if(sel)selectPart(layerRepresentative[sel.dataset.select]);if(eye){stopPlay();const ps=layerParts(eye.dataset.eye),show=!ps.some(p=>p.visible);ps.forEach(p=>{p.visible=show;});applyVisibility();syncLayers();}});
}
function syncLayers(){for(const [id,,title]of layerDefinitions){const ps=layerParts(id);const showing=ps.some(p=>p.visible);const row=document.querySelector(`[data-layer="${id}"]`);row.classList.toggle('hidden',!showing);row.classList.toggle('selected',state.selected&&ps.some(p=>p.id===state.selected));const b=row.querySelector('[data-eye]');b.innerHTML=eyeIcon(!showing);b.setAttribute('aria-pressed',String(showing));b.setAttribute('aria-label',(showing?'隐藏':'显示')+title);}}
function applyVisibility(){groups.forEach(p=>{p.g.visible=p.visible&&(state.mode!=='pcb'||['pcb','switches'].includes(p.layer));if(state.mode==='pcb'&&p.layer==='switches')p.g.visible=false;});if(selectedBox)selectedBox.visible=!!parts[state.selected]?.g.visible;}
function selectPart(id,open=false){const p=parts[id];if(!p)return;state.selected=id;$('partCode').textContent=p.sub;$('partName').textContent=p.name;$('partDescription').textContent=p.description;$('partSpecs').innerHTML=Object.entries(p.specs).map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');if(selectedBox){scene.remove(selectedBox);selectedBox.geometry.dispose();selectedBox.material.dispose();}selectedBox=new THREE.BoxHelper(p.g,0x8ee1c9);selectedBox.material.transparent=true;selectedBox.material.opacity=.25;selectedBox.material.depthTest=false;selectedBox.renderOrder=12;scene.add(selectedBox);syncLayers();if(open&&innerWidth<761)$('sidebar').classList.add('open');}
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2400);}
function stopPlay(){state.playing=false;$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z"/></svg>';$('playBtn').setAttribute('aria-label','播放拆解动画');}
function setMode(mode){releaseInteractions();stopPlay();state.mode=mode;state.target=mode==='exploded'?1:0;groups.forEach(p=>p.visible=true);if(mode==='pcb'){state.target=0;selectPart('pcb');}applyVisibility();syncLayers();document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));setView(mode==='pcb'?'top':'iso');}
function setView(type='iso',focus=null){
 const embedded=window.parent!==window;
 const e=state.target;
 const saved=groups.map(p=>p.g.position.clone());
 groups.forEach(p=>{p.g.position.copy(p.base);p.g.position.y+=p.explode*e;});product.updateMatrixWorld(true);
 const box=new THREE.Box3();
 if(focus)box.setFromObject(focus.g);else groups.filter(p=>p.g.visible).forEach(p=>box.union(new THREE.Box3().setFromObject(p.g)));
 groups.forEach((p,i)=>p.g.position.copy(saved[i]));product.updateMatrixWorld(true);
 if(embedded&&!focus&&state.mode==='assembled')box.set(new THREE.Vector3(-37,0,-31),new THREE.Vector3(37,48,31)).applyMatrix4(product.matrixWorld);
 if(box.isEmpty())box.set(new THREE.Vector3(-39,0,-33),new THREE.Vector3(39,42,33));
 const target=box.getCenter(new THREE.Vector3());
 const dirs={iso:[.67,.56,.83],top:[0,1,.001],front:[0,.045,1],side:[-1,.055,0],back:[0,.15,-1],bottom:[.2,-1,.15]};
 const dir=new THREE.Vector3(...(dirs[type]||dirs.iso)).normalize();
 const right=new THREE.Vector3(0,1,0).cross(dir).normalize(),up=dir.clone().cross(right).normalize();
 const w=stage.clientWidth,h=stage.clientHeight;
 const left=embedded?16:innerWidth<761?18:35,rightEdge=w-(embedded?16:innerWidth<761?46:65),topEdge=embedded?20:innerWidth<1201?185:155,bottomEdge=h-(embedded?20:190);
 const tanY=Math.tan(camera.fov*PI/360),tanX=tanY*w/h;
 const fitX=Math.max(.3,(rightEdge-left)/w),fitY=Math.max(.28,(bottomEdge-topEdge)/h);
 let radius=28;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const v=new THREE.Vector3(x,y,z).sub(target),depth=v.dot(dir);
  radius=Math.max(radius,depth+Math.abs(v.dot(right))/(tanX*fitX),depth+Math.abs(v.dot(up))/(tanY*fitY));
 }
 radius*=embedded?.82:1.04;
 camera.setViewOffset(w,h,w/2-(left+rightEdge)/2,h/2-(topEdge+bottomEdge)/2,w,h);
 viewTween={from:camera.position.clone(),to:target.clone().add(dir.multiplyScalar(radius)),fromTarget:controls.target.clone(),toTarget:target,start:performance.now(),duration:reduced?1:800};
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===type));
}
function zoomModel(factor){
 if(!Number.isFinite(factor)||factor<=0)return;
 viewTween=null;
 const offset=camera.position.clone().sub(controls.target),distance=offset.length();
 if(distance<=0)return;
 const next=Math.max(controls.minDistance,Math.min(controls.maxDistance,distance*factor));
 camera.position.copy(controls.target).add(offset.multiplyScalar(next/distance));controls.update();
}
function createAnnotations(){for(const id of ['knob','caps','encoder','top','mcu','pcb','battery','haptic']){const b=document.createElement('button');b.className='annotation';b.textContent=parts[id].name;b.dataset.part=id;b.onclick=()=>selectPart(id,true);$('annotations').appendChild(b);}}
function updateAnnotations(){for(const b of $('annotations').children){const p=parts[b.dataset.part];if(!state.labels||!p.g.visible){b.hidden=true;continue;}const v=p.g.localToWorld(p.anchor.clone());v.project(camera);const x=(v.x*.5+.5)*stage.clientWidth,y=(-v.y*.5+.5)*stage.clientHeight;b.hidden=v.z>1||v.z<0||x<20||x>stage.clientWidth-145||y<180||y>stage.clientHeight-185;b.style.left=x+'px';b.style.top=y+'px';}}
function xray(on){state.xray=on;for(const m of [materials.shell,materials.base]){m.transparent=on;m.opacity=on?.16:1;m.depthWrite=!on;}for(const id of ['base','top'])parts[id].g.traverse(m=>{if(m.isMesh)m.castShadow=!on;});$('xrayBtn').setAttribute('aria-pressed',String(on));}
function readyToPlay(){return state.mode==='assembled'&&state.explode<.035&&state.target<.035;}
function feedback(text){$('inputMessage').textContent=text;state.lastInput=time;}
function keyDown(i){if(deviceInput){modelEvent(i);return;}if(!readyToPlay()||heldKeys.has(i))return;modelEvent(i);heldKeys.add(i);pulses[i]=time;keyCounts[i]++;feedback(`按键 0${i+1} · 第 ${keyCounts[i]} 次`);document.querySelector(`[data-key="${i}"]`)?.classList.add('pressed');}
function keyUp(i){if(deviceInput)return;heldKeys.delete(i);document.querySelector(`[data-key="${i}"]`)?.classList.remove('pressed');}
function pressKey(i){if(!readyToPlay()){toast('切回整机，即可试按');return;}keyDown(i);setTimeout(()=>keyUp(i),150);}
function syncKnob(){const brightness=state.knobMode==='brightness';const val=brightness?Math.round(state.brightness*100):state.volume;
 $('knobValue').textContent=val;$('knobUnit').textContent=brightness?'% 亮度':state.muted?'% · 静音':'% 音量';$('knobMeter').style.width=val+'%';$('knobReadout').setAttribute('aria-label',`${brightness?'灯光亮度':'模拟音量'} ${val}%${state.muted&&!brightness?'，已静音':''}`);
 $('brightness').value=Math.round(state.brightness*100);$('brightnessText').textContent=Math.round(state.brightness*100)+'%';$('brightness').style.setProperty('--progress',Math.round(state.brightness*100)+'%');$('previewBrightness').value=Math.round(state.brightness*100);$('previewBrightnessText').textContent=Math.round(state.brightness*100)+'%';$('previewBrightness').style.setProperty('--progress',Math.round(state.brightness*100)+'%');}
function rotateKnob(steps){if(deviceInput||!steps)return;modelEvent(steps<0?6:7);state.knobTarget+=clockwiseAngle(steps,4,encoderData.encoder.detents);
 if(state.knobMode==='brightness'){state.brightness=THREE.MathUtils.clamp(state.brightness+steps*.02,0,1);state.lights=true;$('lightBtn').setAttribute('aria-checked','true');feedback(`旋钮 · 亮度 ${Math.round(state.brightness*100)}%`);}
 else {state.volume=THREE.MathUtils.clamp(state.volume+steps*2,0,100);feedback(`旋钮 · 模拟音量 ${state.volume}%`);}
 syncKnob();}
function clickKnob(){modelEvent(5);if(state.knobMode==='brightness'){state.lights=!state.lights;$('lightBtn').setAttribute('aria-checked',String(state.lights));feedback(state.lights?'旋钮按压 · 灯光开启':'旋钮按压 · 灯光关闭');}
 else {state.muted=!state.muted;feedback(state.muted?'旋钮按压 · 模拟静音':'旋钮按压 · 取消静音');}syncKnob();}
function pressKnob(){if(deviceInput){modelEvent(5);return;}if(!readyToPlay()){toast('切回整机，即可试按');return;}knobHeld=true;clickKnob();setTimeout(()=>{if(!deviceInput)knobHeld=false;},150);}
function releaseInteractions(){const captured=activePointer;activePointer=null;viewPointer=null;if(captured&&renderer.domElement.hasPointerCapture(captured.id))renderer.domElement.releasePointerCapture(captured.id);if(!deviceInput){heldKeys.forEach(i=>keyUp(i));knobHeld=false;}controls.enabled=true;controls.autoRotate=false;$('spinBtn').setAttribute('aria-pressed','false');}
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
function pick(e){const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
 const hit=ray.intersectObject(product,true).find(h=>{let o=h.object;while(o&&o!==product){if(!o.visible||o.userData.visualOnly)return false;o=o.parent;}return true;});if(!hit)return null;
 let o=hit.object,key=null,knob=false,id=null;while(o&&o!==product){if(o.userData.pressKey!==undefined)key=o.userData.pressKey;if(o.userData.pressKnob)knob=true;if(o.userData.partId)id=o.userData.partId;o=o.parent;}return {key,knob,id};
}
let activePointer=null,viewPointer=null;
renderer.domElement.addEventListener('pointerdown',e=>{viewTween=null;if(e.button!==0)return;
 const hit=pick(e);viewPointer={x:e.clientX,y:e.clientY,id:e.pointerId};
 if(activePointer||!readyToPlay()||!hit||(hit.key===null&&!hit.knob))return;
 if(deviceInput){modelEvent(hit.knob?5:hit.key);return;}
 e.preventDefault();e.stopImmediatePropagation();releaseInteractions();controls.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);
 activePointer={id:e.pointerId,key:hit.key,knob:hit.knob,x:e.clientX,y:e.clientY,steps:0,dragged:false};viewPointer=null;
 if(hit.knob){knobHeld=true;feedback('旋钮按住 · 左右拖动可旋转');}else keyDown(hit.key);
},true);
stage.addEventListener('pointerdown',()=>{if(window.parent!==window)window.parent.postMessage({source:'c5-model',type:'interact'},location.origin);},true);
renderer.domElement.addEventListener('pointermove',e=>{if(!activePointer){if(e.pointerType==='mouse'){const h=pick(e);renderer.domElement.style.cursor=readyToPlay()&&(h?.knob||h?.key!==null&&h?.key!==undefined)?h.knob?'ew-resize':'pointer':'grab';}return;}
 if(activePointer.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const p=activePointer,dx=e.clientX-p.x,dy=e.clientY-p.y;
 if(p.knob&&Math.hypot(dx,dy)>5){p.dragged=true;knobHeld=false;const steps=Math.trunc((dx-dy*.35)/7);rotateKnob(steps-p.steps);p.steps=steps;}
},true);
function endPointer(e,cancel=false){if(!activePointer||activePointer.id!==e.pointerId)return;const p=activePointer;activePointer=null;
 if(p.key!==null)keyUp(p.key);if(p.knob){knobHeld=false;if(!cancel&&!p.dragged)clickKnob();}
 controls.enabled=true;if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);e.stopImmediatePropagation();}
renderer.domElement.addEventListener('pointerup',e=>{if(activePointer){endPointer(e);return;}if(viewPointer&&viewPointer.id===e.pointerId&&Math.hypot(e.clientX-viewPointer.x,e.clientY-viewPointer.y)<5){const hit=pick(e);if(hit?.id)selectPart(hit.id);}viewPointer=null;},true);
renderer.domElement.addEventListener('pointercancel',e=>{endPointer(e,true);viewPointer=null;},true);
renderer.domElement.addEventListener('lostpointercapture',e=>{if(activePointer?.id===e.pointerId){endPointer(e,true);}},true);
renderer.domElement.addEventListener('wheel',e=>{viewTween=null;
 if(window.parent!==window){e.preventDefault();e.stopImmediatePropagation();zoomModel(Math.exp(Math.max(-300,Math.min(300,e.deltaY*(e.deltaMode===1?16:1)))*.0015));window.parent.postMessage({source:'c5-model',type:'interact'},location.origin);return;}
 const hit=pick(e);if(hit?.knob&&readyToPlay()){e.preventDefault();e.stopImmediatePropagation();if(!deviceInput)rotateKnob(e.deltaY<0?1:-1);}},{capture:true,passive:false});
addEventListener('blur',()=>{activePointer=null;viewPointer=null;releaseInteractions();});

function setFinish(name){state.finish=name;const silver=name==='silver';materials.shell.color.setHex(silver?0xc6ccd6:0x313e51);materials.base.color.setHex(silver?0x666f7f:0x171e2b);materials.cap.color.setHex(silver?0x424d60:0xd6dce3);
 document.querySelectorAll('[data-finish]').forEach(b=>{b.classList.toggle('active',b.dataset.finish===name);b.setAttribute('aria-pressed',String(b.dataset.finish===name));});
 keycaps.forEach(k=>{const label=k.legend;if(label)label.material.color.setHex(silver?0xffffff:0x27344c);});}
function setEnvironment(value){
 state.ambientLevel=THREE.MathUtils.clamp(value,0,1);const v=state.ambientLevel;
 ambient.intensity=v*2.4;keyLight.intensity=v*3.8;fill.intensity=v*2.2;rim.intensity=v*1.5;
 const name=v<.12?'夜间':v<.5?'柔光':'展台';
 for(const id of ['ambient','previewAmbient']){$(id).value=Math.round(v*100);$(id).style.setProperty('--progress',Math.round(v*100)+'%');}
 $('ambientText').textContent=Math.round(v*100)+'% · '+name;$('previewAmbientText').textContent=Math.round(v*100)+'%';
 document.querySelectorAll('[data-environment]').forEach(b=>{const active=Math.abs(Number(b.dataset.environment)-v)<.04;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 scene.background=new THREE.Color(0x01030a).lerp(new THREE.Color(0x172338),v);
 const center=new THREE.Color(0x080b13).lerp(new THREE.Color(0x354359),v),edge=new THREE.Color(0x02040a).lerp(new THREE.Color(0x121a29),v);stage.style.background=`radial-gradient(ellipse at 48% 44%,#${center.getHexString()} 0%,#${edge.getHexString()} 88%)`;
}
function bindEnvironmentUI(){
 $('environmentBtn').onclick=()=>{const open=$('environmentPopup').hidden;$('environmentPopup').hidden=!open;$('environmentBtn').setAttribute('aria-expanded',String(open));};
 $('closeEnvironment').onclick=()=>{$('environmentPopup').hidden=true;$('environmentBtn').setAttribute('aria-expanded','false');};
 document.querySelectorAll('[data-environment]').forEach(b=>b.onclick=()=>setEnvironment(Number(b.dataset.environment)));
 for(const id of ['ambient','previewAmbient'])$(id).oninput=e=>setEnvironment(Number(e.target.value)/100);
 $('previewBrightness').oninput=e=>{state.brightness=Number(e.target.value)/100;syncKnob();};
 $('spread').oninput=e=>{state.spread=Number(e.target.value)/100;$('spreadText').textContent=state.spread<.33?'集中':state.spread<.7?'柔和':'宽广';e.target.style.setProperty('--progress',e.target.value+'%');};
 $('bloom').oninput=e=>{state.bloom=Number(e.target.value)/100;$('bloomText').textContent=e.target.value+'%';e.target.style.setProperty('--progress',(Number(e.target.value)/1.5)+'%');};
 document.addEventListener('pointerdown',e=>{if(!$('environmentPopup').hidden&&!$('environmentPopup').contains(e.target)&&!$('environmentBtn').contains(e.target)){$('environmentPopup').hidden=true;$('environmentBtn').setAttribute('aria-expanded','false');}});
 addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('environmentPopup').hidden){e.preventDefault();e.stopImmediatePropagation();$('environmentPopup').hidden=true;$('environmentBtn').setAttribute('aria-expanded','false');$('environmentBtn').focus();}},true);
 setEnvironment(state.ambientLevel);
}
function bindInteractionUI(){
 document.querySelectorAll('[data-key]').forEach(b=>{const i=Number(b.dataset.key);b.addEventListener('pointerdown',e=>{if(!readyToPlay()){toast('切回整机，即可试按');return;}e.preventDefault();b.setPointerCapture(e.pointerId);keyDown(i);});b.addEventListener('pointerup',()=>keyUp(i));b.addEventListener('pointercancel',()=>keyUp(i));b.addEventListener('lostpointercapture',()=>keyUp(i));b.onclick=e=>{if(e.detail===0)pressKey(i);};});
 $('knobMinus').onclick=()=>{if(readyToPlay())rotateKnob(-1);else toast('切回整机，即可旋转');};$('knobPlus').onclick=()=>{if(readyToPlay())rotateKnob(1);else toast('切回整机，即可旋转');};$('knobPress').onclick=pressKnob;
 $('knobMode').onchange=e=>{state.knobMode=e.target.value;syncKnob();};
 $('lightMode').onchange=e=>{state.lightMode=e.target.value;if(state.lightMode==='rainbow'){state.color='aurora';document.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('active',b.dataset.color==='aurora'));$('lightLabel').textContent='流动渐变';}state.lights=true;$('lightBtn').setAttribute('aria-checked','true');};
 $('brightness').oninput=e=>{state.brightness=Number(e.target.value)/100;syncKnob();};
 document.querySelectorAll('[data-finish]').forEach(b=>b.onclick=()=>setFinish(b.dataset.finish));
 bindEnvironmentUI();
 addEventListener('keydown',e=>{if(e.target.matches('input,button,select,textarea')||($('basisDialog').open||$('printDialog').open||$('drawingDialog').open)||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='Escape'){$('sidebar').classList.remove('open');setView('iso');}
  if(deviceInput||!readyToPlay())return;
  if(e.code.startsWith('Digit')&&e.code.slice(5)>='1'&&e.code.slice(5)<='5'){e.preventDefault();if(!e.repeat)keyDown(Number(e.code.slice(5))-1);}
  if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();rotateKnob(e.code==='ArrowRight'?1:-1);}
  if(e.code==='Space'){e.preventDefault();if(!e.repeat){knobHeld=true;clickKnob();}}
 });
 addEventListener('keyup',e=>{if(deviceInput)return;if(e.code.startsWith('Digit')&&e.code.slice(5)>='1'&&e.code.slice(5)<='5')keyUp(Number(e.code.slice(5))-1);if(e.code==='Space')knobHeld=false;});
 syncKnob();setFinish('graphite');
}

async function exportModel(){
 const b=$('exportBtn');b.disabled=true;toast('正在导出当前装配状态…');
 try{
  const clone=product.clone(true);clone.name='CH592F_Print06_assembly';clone.scale.setScalar(.001);clone.position.multiplyScalar(.001);
  clone.userData={basis:'CH592F_Keyboard_RevD 2026-08-18',status:'Concept arrangement; not production CAD',sourceUnits:'mm',gltfUnits:'m',explode:state.explode};
  // The GLB preserves the current visible components and assembly state.
  clone.traverse(o=>{if(o.userData.visualOnly||o.isLight)o.visible=false;o.userData=Object.fromEntries(Object.entries(o.userData).filter(([,v])=>v===null||typeof v!=='object'));if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});
  const result=await new GLTFExporter().parseAsync(clone,{binary:true,onlyVisible:true,trs:true});
  const url=URL.createObjectURL(new Blob([result],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download='CH592F_Print06_'+(state.explode>.1?'exploded':'assembled')+'_concept.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已导出 GLB · 单位为米，概念排布');
 }catch(e){console.error(e);toast('导出失败，请重新加载后再试。');}finally{b.disabled=false;}
}
function bindUI(){
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
 $('resetView').onclick=()=>setView('iso');
 $('explode').onpointerdown=()=>{viewTween=null;};
 $('explode').oninput=e=>{viewTween=null;releaseInteractions();stopPlay();state.target=Number(e.target.value)/100;if(state.mode==='pcb'){state.mode='assembled';applyVisibility();}state.mode=state.target>.05?'exploded':'assembled';document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));};
 $('playBtn').onclick=()=>{releaseInteractions();if(state.playing){stopPlay();return;}if(state.mode==='pcb'){state.mode='assembled';applyVisibility();}state.playing=true;state.direction=state.explode>.7?-1:1;state.target=state.direction>0?1:0;state.mode=state.direction>0?'exploded':'assembled';setView('iso');$('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';$('playBtn').setAttribute('aria-label','暂停装配动画');document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));};
 $('xrayBtn').onclick=()=>xray(!state.xray);
 $('labelsBtn').onclick=()=>{state.labels=!state.labels;$('labelsBtn').setAttribute('aria-pressed',String(state.labels));};
 $('spinBtn').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('spinBtn').setAttribute('aria-pressed',String(controls.autoRotate));};
 $('lightBtn').onclick=()=>{state.lights=!state.lights;$('lightBtn').setAttribute('aria-checked',String(state.lights));};
 document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{state.color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(n=>n.classList.toggle('active',n===b));$('lightLabel').textContent=state.color==='aurora'?'流动渐变':{'#5ce4d4':'青绿色','#739bff':'蓝色','#ffa45f':'琥珀色'}[state.color];if(state.color!=='aurora'){state.lightMode='solid';$('lightMode').value='solid';}else{state.lightMode='rainbow';$('lightMode').value='rainbow';}});
 $('focusBtn').onclick=()=>{if(!state.selected){toast('先选择一个零件');return;}const p=parts[state.selected];if(!p.g.visible){toast('该零件已隐藏，请先显示');return;}setView('iso',p);};
 $('restoreBtn').onclick=()=>{groups.forEach(p=>p.visible=true);state.mode=state.target>.05?'exploded':'assembled';applyVisibility();syncLayers();document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));setView('iso');};
 $('basisBtn').onclick=()=>$('basisDialog').showModal();$('closeBasis').onclick=()=>$('basisDialog').close();$('basisDialog').addEventListener('click',e=>{if(e.target===$('basisDialog')){const r=$('basisDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('basisDialog').close();}});
 $('inspectShell').onclick=()=>{$('printDialog').close();setMode('exploded');state.target=.4;groups.forEach(p=>p.visible=['base','top'].includes(p.id));xray(false);applyVisibility();syncLayers();setView('iso');};
 $('drawingBtn').onclick=()=>{releaseInteractions();$('drawingDialog').showModal();};$('closeDrawing').onclick=()=>$('drawingDialog').close();
 $('printBtn').onclick=()=>$('printDialog').showModal();$('closePrint').onclick=()=>$('printDialog').close();$('printBasis').onclick=()=>{$('printDialog').close();$('basisDialog').showModal();};
 $('sideToggle').onclick=()=>$('sidebar').classList.toggle('open');$('closeSide').onclick=()=>$('sidebar').classList.remove('open');$('exportBtn').onclick=exportModel;
 bindInteractionUI();
}
let lastWidth=0,lastHeight=0;
function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!Number.isFinite(w)||!Number.isFinite(h)||w<2||h<2||(w===lastWidth&&h===lastHeight))return;lastWidth=w;lastHeight=h;camera.aspect=w/h;renderer.setSize(w,h,false);camera.updateProjectionMatrix();if(window.parent!==window&&groups.length){camera.clearViewOffset();setView('iso');}}
new ResizeObserver(resize).observe(stage);
function lightAt(index,status=false){
 if(status&&state.indicator)return {color:new THREE.Color(`rgb(${state.indicator.color.join(',')})`),strength:state.indicator.brightness/100};
  let pulse=index<5?Math.max(0,1-(time-pulses[index])/1.05):0;
  if(index<5)for(let j=0;j<5;j++){const delay=Math.abs(index-j)*.085,age=time-pulses[j]-delay;if(age>=0)pulse=Math.max(pulse,Math.max(0,1-age/.7)*.55);}
  if(heldKeys.has(index))pulse=1;
  const color=state.color==='aurora'?new THREE.Color().setHSL(((reduced?0:time*.05)+index*.125)%1,.82,.62):new THREE.Color(state.color);
  let strength=state.brightness;
  if(state.lightMode==='breathing')strength*=reduced?.7:.35+.65*(Math.sin(time*2.2)*.5+.5);
  if(state.lightMode==='solid'&&state.color==='aurora')color.setHSL(index*.125,.82,.62);
  if(state.lightMode==='reactive'&&!status)strength*=.05+pulse*.95;
  else strength*=.9+pulse*.1;
  strength=THREE.MathUtils.clamp(strength,0,1);
  if(!state.lights)strength=0;
  return {color,strength};
}
function frame(now){requestAnimationFrame(frame);if(contextLost||document.hidden||lastWidth<2||lastHeight<2){last=now;return;}const dt=Math.min((now-last)/1000,.045)||.016;last=now;time+=dt;
 if(state.playing){const d=state.target-state.explode;state.explode+=Math.sign(d)*Math.min(Math.abs(d),dt*.23);if(Math.abs(d)<.002){state.explode=state.target;stopPlay();}}
 else state.explode+= (state.target-state.explode)*(reduced?1:Math.min(1,dt*6));
 if(Math.abs(state.target-state.explode)<.0001)state.explode=state.target;
 const e=state.explode;groups.forEach(p=>{p.g.position.copy(p.base);p.g.position.y+=p.explode*e;});
 // Spring return is driven per key, so rapid repeats and simultaneous keys stay independent.
 keycaps.forEach((k,i)=>{const target=heldKeys.has(i)?1.8:0;k.travel=deviceInput?followInput(k.travel,target,dt,target ? .012 : .018):k.travel+(target-k.travel)*Math.min(1,dt*(target?32:20));k.g.position.y=k.base-k.travel;moveStem(switchStems[i],k.travel);});
 if(parts.knob){const kg=knobCap;const target=KNOB_BASE-(knobHeld?.5:0);kg.position.y=deviceInput?followInput(kg.position.y,target,dt,.016):kg.position.y+(target-kg.position.y)*Math.min(1,dt*26);moveStem(knobStem,KNOB_BASE-kg.position.y);state.knobAngle=deviceInput?followInput(state.knobAngle,state.knobTarget,dt,.018):state.knobAngle+(state.knobTarget-state.knobAngle)*Math.min(1,dt*22);kg.rotation.y=state.knobAngle;if(knobStem?.group)knobStem.group.rotation.y=state.knobAngle;
 const ring=knobRing;if(ring){ring.material.opacity=readyToPlay()?Math.max(0,1-(time-state.lastInput)/.7)*.85:0;}}
 const percentage=Math.round(e*100);if(percentage!==lastExplodePercentage){lastExplodePercentage=percentage;$('explodeValue').innerHTML=percentage+'<span>%</span>';$('explode').value=percentage;$('explode').style.setProperty('--progress',percentage+'%');$('explodeText').textContent=percentage===0?'完整装配':percentage===100?'全部展开':percentage<35?'移出内部组件':percentage<72?'分离上盖':'提起键帽与旋钮';}
 const keyRGB=keycaps.map((_,i)=>lightAt(i)),statusRGB=lightAt(5,true);
 lightMeshes.forEach(({mesh:m,index,glow,point,status,source})=>{
  const {color,strength}=index<5?keyRGB[index]:statusRGB;
  if(point){m.color.copy(color);m.intensity=strength*(source?110:24);m.distance=22+state.spread*28;m.visible=state.lights&&parts.leds.g.visible&&(source||parts.switches.g.visible&&e<.06)&&state.mode!=='pcb';return;}
  if(glow){const span=30+state.spread*22;m.scale.setScalar(span/44);m.material.uniforms.uColor.value.copy(color);m.material.uniforms.uStrength.value=strength*Math.max(0,1-e/.06)*state.bloom;m.material.uniforms.uSpan.value=span;m.visible=state.lights&&parts.leds.g.visible&&parts.switches.g.visible&&e<.06&&state.mode!=='pcb';return;}
  if(status)m.material.color.copy(color);
  m.material.emissive?.copy(color);if(m.material.emissive)m.material.emissiveIntensity=strength*1.4;
 });
 document.querySelectorAll('[data-key]').forEach((b,i)=>{const {color,strength}=keyRGB[i];b.style.setProperty('--key-color',strength>0?'#'+color.clone().multiplyScalar(Math.min(1,strength)).getHexString():'#42506a');});
 if(viewTween){const t=Math.min(1,(now-viewTween.start)/viewTween.duration),s=1-Math.pow(1-t,3);camera.position.lerpVectors(viewTween.from,viewTween.to,s);controls.target.lerpVectors(viewTween.fromTarget,viewTween.toTarget,s);if(t>=1)viewTween=null;}
 controls.update();product.updateMatrixWorld(true);if(selectedBox){selectedBox.update();selectedBox.visible=!!parts[state.selected]?.g.visible;}
 updateAnnotations();renderer.render(scene,camera);
}
async function init(){try{
 const [hm,pm,em,bm,sm,cm]=await Promise.all([fetch('./components.json'),fetch('./pads.json'),fetch('./enclosure-v6.json'),fetch('./pcb-mechanical-data.json?v=print6'),fetch('./C49352235-mesh.json'),fetch('./PEC11L-dimensions.json')]);if(!hm.ok||!pm.ok||!em.ok||!bm.ok||!sm.ok||!cm.ok)throw Error('model resource unavailable');[hardware,padsData,enclosureData,boardData,socketData,encoderData]=await Promise.all([hm.json(),pm.json(),em.json(),bm.json(),sm.json(),cm.json()]);build();bindUI();resize();setView('iso');$('loading').remove();requestAnimationFrame(frame);
 }catch(e){console.error(e);$('loading').innerHTML='<strong>模型暂未载入</strong><span>请刷新页面重新读取模型资源。</span><button onclick="location.reload()" style="border:1px solid #77dec8;padding:9px 20px;border-radius:6px">重新载入</button>';}}
init();

// Configuration-console bridge. Only the embedding page at this origin may control preview state.
function modelEvent(index){if(window.parent!==window)window.parent.postMessage({source:'c5-model',type:'select',index},location.origin);}
window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==location.origin||e.data?.source!=='c5-console')return;const d=e.data;if(d.type==='view'){if(d.action==='reset')setView('iso');else if(d.action==='in')zoomModel(.8);else if(d.action==='out')zoomModel(1.25);return;}if(d.type==='config'){if(d.indicator&&Array.isArray(d.indicator.color)&&d.indicator.color.length===3&&d.indicator.color.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&Number.isFinite(d.indicator.brightness))state.indicator={color:[...d.indicator.color],brightness:Math.max(0,Math.min(100,d.indicator.brightness))};state.brightness=Math.max(0,Math.min(1,Number(d.brightness)/100));state.lights=d.effect!==0;state.lightMode=['solid','solid','rainbow','breathing','reactive'][d.effect]||'solid';if(Array.isArray(d.color)&&d.color.length===3)state.color='#'+d.color.map(x=>Math.max(0,Math.min(255,Number(x)||0)).toString(16).padStart(2,'0')).join('');}if(d.type==='status'){if(d.connected!==false&&!deviceInput)releaseInteractions();deviceInput=d.connected!==false;for(let i=0;i<5;i++){if(d.keys&(1<<i)){heldKeys.add(i);pulses[i]=time;}else heldKeys.delete(i);}knobHeld=Boolean(d.keys&32);state.knobTarget=liveRotation.update(deviceInput,d.encoderPosition,state.knobTarget,d.transitions||4);}if(d.type==='select'&&Number.isInteger(d.index)&&d.index<5&&d.index>=0)pulses[d.index]=time;});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&window.parent!==window)window.parent.postMessage({source:'c5-model',type:'escape'},location.origin);});
if(window.parent!==window)window.parent.postMessage({source:'c5-model',type:'ready'},location.origin);
