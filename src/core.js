/** Frameforge edit kernel. All editorial positions are integer timeline frames.
 * Source offsets are floating-point source seconds, so retiming does not round source time.
 * No DOM or media objects enter snapshots. Connected clips retain parent-relative anchors.
 */
export const VERSION = 1;
export const assetURL = path => globalThis.FRAMEFORGE_ASSETS?.[path] || path;
export const LANES = ['title', 'overlay', 'primary', 'audio'];
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const uid = (prefix='c') => { const uuid=globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''); return `${prefix}-${uuid}`; };
export const copy = value => structuredClone(value);
export const DEFAULT_FX = Object.freeze({x:0,y:0,scale:100,rotation:0,opacity:100,exposure:0,contrast:100,saturation:100,temperature:0,vignette:0,cropL:0,cropR:0,cropT:0,cropB:0});
export function timecode(frame, fps=24) {
  frame = Math.max(0, Math.round(frame));
  const ff=frame%fps, s=Math.floor(frame/fps)%60, m=Math.floor(frame/fps/60)%60, h=Math.floor(frame/fps/3600);
  return [h,m,s,ff].map(n=>String(n).padStart(2,'0')).join(':');
}
export function parseTimecode(text, fps=24) {
  const a=text.trim().split(':').map(Number);
  if(a.length!==4 || a.some(n=>!Number.isInteger(n)||n<0) || a[1]>59 || a[2]>59 || a[3]>=fps) throw new Error('Use HH:MM:SS:FF at the project frame rate.');
  return ((a[0]*60+a[1])*60+a[2])*fps+a[3];
}
export const duration = p => Math.max(1, ...p.clips.map(c=>c.start+c.duration));
export const primaryDuration = p => p.clips.filter(c=>c.lane==='primary').reduce((n,c)=>n+c.duration,0);
export const sourceTime = (clip, frame, fps) => Math.max(0,clip.in+(frame-clip.start)/fps*clip.speed);
export function makeClip(asset, lane, start, fps, length) {
  const seconds=asset.kind==='image'?5:asset.duration || 5;
  return {id:uid(),assetId:asset.id,name:asset.name,lane,start:Math.max(0,Math.round(start)),duration:Math.max(1,Math.round(length ?? seconds*fps)),in:0,speed:1,enabled:true,fx:{...DEFAULT_FX},gainDb:asset.kind==='audio'?-8:0,fadeIn:0,fadeOut:0,transition:'none',transitionFrames:12,keyframes:{}};
}
export function normalize(p) {
  let t=0;
  for(const c of p.clips.filter(c=>c.lane==='primary')) {c.start=t;t+=c.duration;}
  const byId=new Map(p.clips.map(c=>[c.id,c]));
  for(const c of p.clips) if(c.anchor) {
    const parent=byId.get(c.anchor.clipId);
    if(parent?.lane==='primary') c.start=Math.max(0,parent.start+c.anchor.offset);
    else delete c.anchor;
  }
  return p;
}
export function validateProject(p) {
  if(!p || p.format!=='frameforge-project' || p.version!==VERSION) throw new Error('This is not a supported Frameforge project.');
  if(![24,25,30,60].includes(p.fps)) throw new Error('Supported frame rates are 24, 25, 30, and 60 fps (non-drop).');
  if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<64||p.height<64||p.width>4096||p.height>4096) throw new Error('Invalid project dimensions.');
  if(typeof p.name!=='string'||p.name.length>300) throw new Error('Invalid project name.');
  if(!Array.isArray(p.clips)||p.clips.length>10000||!Array.isArray(p.assets)||p.assets.length>2000||!Array.isArray(p.markers)||p.markers.length>10000) throw new Error('Project collection limit exceeded.');
  const assets=new Map();
  for(const a of p.assets){
    if(!a||typeof a.id!=='string'||assets.has(a.id)||!['video','audio','image'].includes(a.kind)||typeof a.name!=='string'||!Number.isFinite(a.duration)||a.duration<0) throw new Error('Invalid media metadata.');
    if(a.path && !/^assets\/[a-z0-9-]+\.(mp4|jpg|wav)$/.test(a.path)) throw new Error('External media paths are not permitted. Use local import.');
    assets.set(a.id,a);
  }
  const ids=new Set();
  for(const c of p.clips){
    if(!c || typeof c.id!=='string'||ids.has(c.id)||!LANES.includes(c.lane)||!Number.isSafeInteger(c.start)||c.start<0||c.start>24*60*60*p.fps||!Number.isSafeInteger(c.duration)||c.duration<1||c.duration>24*60*60*p.fps) throw new Error('Invalid clip geometry.');
    ids.add(c.id);
    if(c.lane!=='title'&&!assets.has(c.assetId)) throw new Error('A clip references missing media.');
    if(!Number.isFinite(c.in)||c.in<0||!Number.isFinite(c.speed)||c.speed<.1||c.speed>8||!Number.isFinite(c.gainDb)||c.gainDb< -96||c.gainDb>24) throw new Error('Invalid clip timing or audio gain.');
    if(!c.fx || Object.values(c.fx).some(v=>!Number.isFinite(v))) throw new Error('Invalid effect parameters.');
    for(const field of ['x','y','scale','rotation','opacity','exposure','contrast','saturation','temperature','vignette','cropL','cropR','cropT','cropB']) if(!Number.isFinite(c.fx[field])) throw new Error(`Missing effect parameter: ${field}.`);
    for(const [key,keys] of Object.entries(c.keyframes||{})) {
      if(!Object.hasOwn(DEFAULT_FX,key)||!Array.isArray(keys)||keys.length>10000||keys.some((k,i)=>!Number.isSafeInteger(k.frame)||k.frame<0||!Number.isFinite(k.value)||i>0&&k.frame<=keys[i-1].frame)) throw new Error('Invalid keyframes.');
    }
    if(typeof c.name!=='string'||c.name.length>20000||typeof c.enabled!=='boolean'||!['none','dissolve'].includes(c.transition)||!Number.isSafeInteger(c.transitionFrames)||c.transitionFrames<1||!Number.isSafeInteger(c.fadeIn)||c.fadeIn<0||!Number.isSafeInteger(c.fadeOut)||c.fadeOut<0)throw new Error('Invalid clip attributes.');
    if(c.lane==='title' && (!c.title||typeof c.title.text!=='string'||c.title.text.length>20000||!Number.isFinite(c.title.size)||c.title.size<1||c.title.size>500)) throw new Error('Invalid title.');
    const asset=assets.get(c.assetId);
    if(asset && asset.kind!=='image' && c.in+c.duration/p.fps*c.speed>asset.duration+1/p.fps+.001) throw new Error(`The clip “${c.name}” exceeds its source duration.`);
    if(c.anchor && (!Number.isInteger(c.anchor.offset)||!p.clips.some(a=>a.id===c.anchor.clipId&&a.lane==='primary'))) throw new Error('Invalid connected-clip anchor.');
  }
  for(const m of p.markers) if(!Number.isSafeInteger(m.frame)||m.frame<0||typeof m.label!=='string') throw new Error('Invalid marker.');
  return p;
}
export function interpolate(keys, localFrame, fallback) {
  if(!keys?.length) return fallback;
  const sorted=keys; // Commands maintain sorted arrays.
  if(localFrame<=sorted[0].frame) return sorted[0].value;
  for(let i=1;i<sorted.length;i++) if(localFrame<=sorted[i].frame) {
    const a=sorted[i-1],b=sorted[i], t=(localFrame-a.frame)/(b.frame-a.frame);
    const eased=b.ease==='smooth'?t*t*(3-2*t):t;
    return a.value+(b.value-a.value)*eased;
  }
  return sorted.at(-1).value;
}
export function evaluatedFX(c, frame) {
  const out={...c.fx};
  for(const key of Object.keys(c.keyframes||{})) out[key]=interpolate(c.keyframes[key],frame-c.start,out[key]);
  return out;
}
export function snapFrame(frame, targets, tolerance) {
  let best=Math.round(frame), distance=tolerance;
  for(const target of targets) { const d=Math.abs(target-frame); if(d<=distance) {distance=d;best=target;} }
  return Math.max(0,Math.round(best));
}
export function attach(p, c) {
  if(c.lane==='primary') { delete c.anchor;return; }
  const primary=p.clips.filter(x=>x.lane==='primary');
  const parent=primary.find(x=>c.start>=x.start&&c.start<x.start+x.duration)||primary.at(-1);
  if(parent)c.anchor={clipId:parent.id,offset:c.start-parent.start};
  else delete c.anchor;
}
export class Editor {
  constructor(project){this.project=validateProject(normalize(copy(project)));this.undoStack=[];this.redoStack=[];this.listeners=new Set();this.gesture=null;}
  onChange(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  notify(label='change'){for(const fn of this.listeners)fn({project:this.project,label});}
  transact(label, fn){
    const before=copy(this.project);
    try {fn(this.project);normalize(this.project);validateProject(this.project);}
    catch(e){this.project=before;throw e;}
    if(JSON.stringify(before)===JSON.stringify(this.project))return;
    this.undoStack.push({label,state:before});if(this.undoStack.length>80)this.undoStack.shift();this.redoStack=[];this.notify(label);
  }
  beginGesture(label){if(this.gesture)this.cancelGesture();this.gesture={label,state:copy(this.project)};}
  previewGesture(fn){if(!this.gesture)return;this.project=copy(this.gesture.state);fn(this.project);normalize(this.project);this.notify('preview');}
  endGesture(){if(!this.gesture)return;const g=this.gesture;this.gesture=null;try{validateProject(this.project);}catch(e){this.project=g.state;this.notify('cancel');throw e;}if(JSON.stringify(g.state)!==JSON.stringify(this.project)){this.undoStack.push(g);if(this.undoStack.length>80)this.undoStack.shift();this.redoStack=[];}this.notify(g.label);}
  cancelGesture(){if(this.gesture){this.project=this.gesture.state;this.gesture=null;this.notify('cancel');}}
  undo(){if(this.gesture)this.cancelGesture();const e=this.undoStack.pop();if(!e)return;this.redoStack.push({label:e.label,state:copy(this.project)});this.project=e.state;this.notify('Undo '+e.label);}
  redo(){const e=this.redoStack.pop();if(!e)return;this.undoStack.push({label:e.label,state:copy(this.project)});this.project=e.state;this.notify('Redo '+e.label);}
  replace(p){this.project=validateProject(normalize(copy(p)));this.undoStack=[];this.redoStack=[];this.notify('Open project');}
  update(id, patch){this.transact('Change clip',p=>{const c=p.clips.find(c=>c.id===id);if(!c)return;Object.assign(c,patch);});}
  addAsset(asset){this.transact('Import media',p=>p.assets.push(asset));}
  append(assetId,lane='primary',at=0,range=null){
    let id;
    this.transact('Add clip',p=>{
      const a=p.assets.find(a=>a.id===assetId);if(!a)throw new Error('Select a media item first.');
      if(a.kind==='audio')lane='audio';
      const c=makeClip(a,lane,lane==='primary'?primaryDuration(p):at,p.fps,range?range.out-range.in:undefined);
      if(range)c.in=range.in/p.fps;
      p.clips.push(c);attach(p,c);id=c.id;
    });return id;
  }
  insert(assetId,frame,range=null){
    let id;
    this.transact('Insert clip',p=>{
      const a=p.assets.find(a=>a.id===assetId);if(!a||a.kind==='audio')throw new Error('Select video or a still image to insert.');
      const hit=p.clips.find(c=>c.lane==='primary'&&frame>=c.start&&frame<c.start+c.duration);
      let index=hit?p.clips.indexOf(hit):p.clips.length;
      if(hit&&frame>hit.start){const right=splitInPlace(p,hit.id,frame);index=p.clips.findIndex(c=>c.id===right);}
      const c=makeClip(a,'primary',frame,p.fps,range?range.out-range.in:undefined);if(range)c.in=range.in/p.fps;
      p.clips.splice(index,0,c);id=c.id;
    });return id;
  }
  split(ids,frame){let result=[];this.transact('Blade clips',p=>{for(const id of ids){const out=splitInPlace(p,id,frame);if(out)result.push(out);}});return result;}
  delete(ids){this.transact('Delete clips',p=>{const set=new Set(ids);p.clips=p.clips.filter(c=>!set.has(c.id)&&!set.has(c.anchor?.clipId));});}
  duplicate(ids){let added=[];this.transact('Duplicate clips',p=>{for(const id of ids){const c=p.clips.find(c=>c.id===id);if(!c)continue;const d=copy(c);d.id=uid();d.start=c.start+c.duration;delete d.anchor;const i=p.clips.indexOf(c);p.clips.splice(i+1,0,d);attach(p,d);added.push(d.id);}});return added;}
  addTitle(frame,style='cinematic',text='BEYOND'){
    let id;this.transact('Add title',p=>{const c=makeClip({id:null,name:style==='lower'?'Lower third':'Basic title',kind:'image'},'title',frame,p.fps,5*p.fps);c.title={style,text,subtitle:style==='cinematic'?'OUR BLUE WORLD':'',size:style==='cinematic'?120:64,color:'#ffffff',font:'Arial',align:'center'};c.fadeIn=10;c.fadeOut=10;p.clips.push(c);attach(p,c);id=c.id;});return id;
  }
  marker(frame,label='Marker'){this.transact('Add marker',p=>p.markers.push({id:uid('m'),frame:Math.max(0,Math.round(frame)),label}));}
}
export function splitInPlace(p,id,frame){
  const c=p.clips.find(c=>c.id===id);if(!c||frame<=c.start||frame>=c.start+c.duration)return null;
  const offset=frame-c.start;const d=copy(c);d.id=uid();d.start=frame;d.in+=offset/p.fps*c.speed;d.duration-=offset;c.duration=offset;
  d.transition='none';d.fadeIn=0;c.fadeOut=0;
  if(d.anchor)d.anchor.offset+=offset;
  for(const [key,keys] of Object.entries(c.keyframes||{})){
    const value=interpolate(keys,offset,c.fx[key]);
    d.keyframes[key]=[{frame:0,value},...keys.filter(k=>k.frame>offset).map(k=>({...k,frame:k.frame-offset}))];
    c.keyframes[key]=[...keys.filter(k=>k.frame<offset),{frame:Math.max(0,offset-1),value:interpolate(keys,offset-1,c.fx[key])}];
    c.keyframes[key]=c.keyframes[key].filter((v,i,a)=>i===0||v.frame!==a[i-1].frame);
  }
  p.clips.splice(p.clips.indexOf(c)+1,0,d);
  if(c.lane==='primary')for(const child of p.clips)if(child.anchor?.clipId===c.id&&child.anchor.offset>=offset){child.anchor.clipId=d.id;child.anchor.offset-=offset;}
  return d.id;
}
export function trimInPlace(p,id,edge,delta){
  const c=p.clips.find(c=>c.id===id);if(!c)return;
  const a=p.assets.find(a=>a.id===c.assetId);
  const available=a&&a.kind!=='image'?Math.floor((a.duration-c.in)/c.speed*p.fps+1e-5):p.fps*3600;
  delta=Math.round(delta);
  if(edge==='right') c.duration=clamp(c.duration+delta,1,available);
  else {
    const oldFX={...c.fx};
    delta=clamp(delta,Math.ceil(-c.in/c.speed*p.fps),c.duration-1);
    c.in+=delta/p.fps*c.speed;c.duration-=delta;
    if(c.lane!=='primary'){c.start=Math.max(0,c.start+delta);attach(p,c);}
    for(const [key,keys] of Object.entries(c.keyframes||{}))if(keys.length){
      const value=interpolate(keys,delta,oldFX[key]);
      c.keyframes[key]=delta>=0?[{frame:0,value},...keys.filter(k=>k.frame>delta).map(k=>({...k,frame:k.frame-delta}))]:keys.map(k=>({...k,frame:k.frame-delta}));
    }
    for(const child of p.clips)if(child.anchor?.clipId===c.id)child.anchor.offset-=delta;
  }
}
export function reorderInPlace(p,id,targetFrame){
  const c=p.clips.find(c=>c.id===id);if(!c)return;
  if(c.lane!=='primary'){c.start=Math.max(0,Math.round(targetFrame));attach(p,c);return;}
  const target=p.clips.find(x=>x.lane==='primary'&&x.id!==id&&targetFrame<x.start+x.duration/2);
  p.clips.splice(p.clips.indexOf(c),1);
  if(target)p.clips.splice(p.clips.indexOf(target),0,c);else p.clips.push(c);
}
export function renderPlan(p,frame){
  const active=p.clips.filter(c=>c.enabled&&frame>=c.start&&frame<c.start+c.duration);
  const layers=[];
  const primary=active.find(c=>c.lane==='primary');
  if(primary){
    let opacity=1;
    const n=primary.transitionFrames||12;
    if(primary.transition==='dissolve'&&frame-primary.start<n){
      const outgoing=p.clips.find(c=>c.lane==='primary'&&c.enabled&&c.start+c.duration===primary.start);
      if(outgoing){const a=p.assets.find(a=>a.id===outgoing.assetId);const sourceFrame=outgoing.start+Math.min(outgoing.duration-1+(frame-primary.start),Math.floor(((a?.duration||0)-outgoing.in)/outgoing.speed*p.fps)-1);layers.push({clip:outgoing,frame:sourceFrame,opacity:1});opacity=(frame-primary.start)/n;}
    }
    layers.push({clip:primary,frame,opacity});
  }
  for(const lane of ['overlay','title'])for(const c of active.filter(c=>c.lane===lane))layers.push({clip:c,frame,opacity:1});
  for(const layer of layers){const c=layer.clip;const local=frame-c.start; if(c.fadeIn)layer.opacity*=clamp(local/c.fadeIn,0,1);if(c.fadeOut)layer.opacity*=clamp((c.duration-local)/c.fadeOut,0,1);}
  return {frame,layers,audio:active.filter(c=>c.lane!=='title')};
}
export function createDemo(){
  const assets=[
    {id:'orbit',name:'01 · Home, from above',kind:'video',path:'assets/orbit.mp4',thumb:'assets/orbit.jpg',duration:6,width:960,height:540,synthetic:true},
    {id:'earthrise',name:'02 · First light',kind:'video',path:'assets/earthrise.mp4',thumb:'assets/earthrise.jpg',duration:6,width:960,height:540,synthetic:true},
    {id:'blue-marble',name:'03 · The blue marble',kind:'video',path:'assets/blue-marble.mp4',thumb:'assets/blue-marble.jpg',duration:6,width:960,height:540,synthetic:true},
    {id:'horizon',name:'04 · A new horizon',kind:'video',path:'assets/horizon.mp4',thumb:'assets/horizon.jpg',duration:6,width:960,height:540,synthetic:true},
    {id:'poster',name:'Blue planet · still',kind:'image',path:'assets/orbit.jpg',thumb:'assets/orbit.jpg',duration:6,width:1280,height:720},
    {id:'score',name:'Weightless · original score',kind:'audio',path:'assets/weightless.wav',duration:24,channels:2,sampleRate:24000}
  ];
  const p={format:'frameforge-project',version:VERSION,name:'Beyond — a short film',fps:24,width:1920,height:1080,assets,clips:[],markers:[{id:'m1',frame:0,label:'Opening'},{id:'m2',frame:144,label:'First light'},{id:'m3',frame:432,label:'Home'}]};
  for(let i=0;i<4;i++){const c=makeClip(assets[i],'primary',i*144,24,144);c.id=`demo-${i}`;if(i)c.transition='dissolve';p.clips.push(c);}
  const title=makeClip({id:null,name:'Beyond / Main title',kind:'image'},'title',0,24,144);title.id='demo-title';title.title={style:'cinematic',text:'BEYOND',subtitle:'OUR BLUE WORLD',size:124,color:'#ffffff',font:'Arial',align:'center'};title.fadeIn=18;title.fadeOut=18;attach(p,title);p.clips.push(title);
  const lower=makeClip({id:null,name:'One planet. Infinite possibility.',kind:'image'},'title',456,24,108);lower.title={style:'lower',text:'One planet. Infinite possibility.',subtitle:'A FILM ABOUT THE PLACE WE CALL HOME',size:42,color:'#ffffff',font:'Arial',align:'left'};lower.fadeIn=12;lower.fadeOut=12;attach(p,lower);p.clips.push(lower);
  const score=makeClip(assets[5],'audio',0,24,576);score.id='demo-score';score.gainDb=-3;score.fadeIn=24;score.fadeOut=48;attach(p,score);p.clips.push(score);
  return normalize(p);
}
