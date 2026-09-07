import {uid,clamp,sourceTime,assetURL} from './core.js';
const event=(el,name,timeout=12000)=>new Promise((resolve,reject)=>{
  let timer;
  const done=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error(el.error?.message||`Could not ${name} media. The browser may not support this codec.`));};
  const cleanup=()=>{clearTimeout(timer);el.removeEventListener(name,done);el.removeEventListener('error',fail);};
  el.addEventListener(name,done,{once:true});el.addEventListener('error',fail,{once:true});timer=setTimeout(fail,timeout);
});
// loadeddata only fires on the initial load, not after every seek. Wait on the
// state predicate across all readiness events so repeat exports cannot deadlock.
const ready = (el, timeout=12000) => new Promise((resolve,reject)=>{
  const events=['loadedmetadata','loadeddata','canplay','seeked'];let timer;
  const cleanup=()=>{clearTimeout(timer);for(const name of events)el.removeEventListener(name,check);el.removeEventListener('error',fail);};
  const fail=()=>{cleanup();reject(new Error(el.error?.message||'Media did not become seek-ready. Check codec support.'));};
  const check=()=>{if(el.error){fail();return;}if(el.readyState>=2&&!el.seeking){cleanup();resolve();}};
  for(const name of events)el.addEventListener(name,check);el.addEventListener('error',fail);
  timer=setTimeout(fail,timeout);check();
});
export class MediaEngine {
  constructor(storage,onUpdate=()=>{}){
    this.storage=storage;this.onUpdate=onUpdate;this.assets=new Map();this.blobs=new Map();this.urls=new Map();this.images=new Map();this.entries=new Map();this.peaks=new Map();this.waveJobs=new Map();this.missing=new Set();this.project=null;
    this.worker=new Worker(new URL('./peaks.worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{this.peaks.set(data.id,data.peaks);this.waveJobs.get(data.id)?.(data.peaks);this.waveJobs.delete(data.id);this.onUpdate();};
    this.audio=null;this.masterVolume=.75;this.monitorMuted=false;this.audioData=new Float32Array(1024);
  }
  async setProject(p){
    this.pauseAll();this.project=p;this.assets=new Map(p.assets.map(a=>[a.id,a]));this.missing.clear();
    const ids=new Set(p.clips.map(c=>c.id));for(const [id,e]of this.entries)if(!ids.has(id))this.release(id,e);
    await Promise.all(p.assets.map(async a=>{
      if(this.urls.has(a.id))return;
      if(a.path)this.urls.set(a.id,assetURL(a.path));
      else {const blob=this.blobs.get(a.id)||await this.storage.get('media',a.id);if(blob){this.blobs.set(a.id,blob);this.urls.set(a.id,URL.createObjectURL(blob));}else this.missing.add(a.id);}
      if(a.kind==='image'&&this.urls.has(a.id))await this.loadImage(a.id);
    }));
    if(this.assets.has('score')&&!this.peaks.has('score'))fetch(assetURL('assets/waveform.json')).then(r=>r.json()).then(p=>{this.peaks.set('score',new Float32Array(p));this.onUpdate();}).catch(()=>{});
  }
  async ensureAudio(){
    if(!this.audio){
      this.audio=new AudioContext({latencyHint:'interactive'});this.mix=this.audio.createGain();
      this.analyser=this.audio.createAnalyser();this.analyser.fftSize=2048;this.analyser.smoothingTimeConstant=.75;this.audioData=new Float32Array(this.analyser.fftSize);
      this.monitor=this.audio.createGain();this.monitor.gain.value=this.monitorMuted?0:this.masterVolume;
      this.destination=this.audio.createMediaStreamDestination();
      this.mix.connect(this.analyser);this.analyser.connect(this.monitor);this.monitor.connect(this.audio.destination);this.mix.connect(this.destination);
      for(const e of this.entries.values())this.connect(e);
    }
    if(this.audio.state!=='running')await this.audio.resume();
  }
  connect(e){if(!this.audio||e.node)return;try{e.node=this.audio.createMediaElementSource(e.el);e.gain=this.audio.createGain();e.gain.gain.value=0;e.node.connect(e.gain);e.gain.connect(this.mix);e.el.muted=false;}catch(error){console.warn('Audio routing unavailable',error);}}
  setVolume(value){this.masterVolume=clamp(value,0,1);if(this.monitor)this.monitor.gain.setTargetAtTime(this.monitorMuted?0:this.masterVolume,this.audio.currentTime,.015);}
  setMute(muted){this.monitorMuted=muted;this.setVolume(this.masterVolume);}
  meter(){if(!this.analyser)return 0;this.analyser.getFloatTimeDomainData(this.audioData);let sum=0;for(const s of this.audioData)sum+=s*s;return Math.sqrt(sum/this.audioData.length);}
  async blob(id){if(this.blobs.has(id))return this.blobs.get(id);return this.storage.get('media',id);}
  async loadImage(id){
    if(this.images.has(id))return this.images.get(id);
    const image=new Image();image.src=this.urls.get(id);await image.decode();this.images.set(id,image);this.onUpdate();return image;
  }
  async import(file){
    let kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':null;
    if(!kind){const ext=file.name.split('.').pop().toLowerCase();kind=['mp4','mov','webm','m4v','ogv'].includes(ext)?'video':['wav','mp3','aac','m4a','ogg','flac'].includes(ext)?'audio':['png','jpg','jpeg','webp','gif','avif'].includes(ext)?'image':null;}
    if(!kind)throw new Error(`Unsupported file: ${file.name}. Import browser-decodable video, audio, or images.`);
    const id=uid('media'),url=URL.createObjectURL(file);this.urls.set(id,url);this.blobs.set(id,file);
    const a={id,name:file.name,kind,duration:5,size:file.size,type:file.type,originalName:file.name};
    try{
      if(kind==='image'){
        const image=await this.loadImage(id);a.width=image.naturalWidth;a.height=image.naturalHeight;
        if(a.width*a.height>64e6)throw new Error('Images are limited to 64 megapixels.');
        a.thumb=this.thumbnail(image);
      }else{
        const el=document.createElement(kind==='video'?'video':'audio');el.preload='auto';el.muted=true;el.playsInline=true;
        const loaded=event(el,'loadedmetadata');el.src=url;await loaded;
        if(!Number.isFinite(el.duration)||el.duration<=0)throw new Error('This file does not expose a finite duration. Remux it to MP4 or WebM first.');
        a.duration=el.duration;
        if(kind==='video'){
          a.width=el.videoWidth;a.height=el.videoHeight;
          if(el.readyState<2)await event(el,'loadeddata');
          const ready=event(el,'seeked');el.currentTime=Math.min(.25,el.duration/2);await ready;
          a.thumb=this.thumbnail(el);
        }
        el.pause();el.removeAttribute('src');el.load();
      }
      await this.storage.put('media',id,file);this.assets.set(id,a);return a;
    }catch(e){URL.revokeObjectURL(url);this.urls.delete(id);this.blobs.delete(id);throw e;}
  }
  thumbnail(source){const canvas=document.createElement('canvas');canvas.width=240;canvas.height=135;const ctx=canvas.getContext('2d');const sw=source.videoWidth||source.naturalWidth,sh=source.videoHeight||source.naturalHeight;const s=Math.max(240/sw,135/sh);ctx.drawImage(source,(240-sw*s)/2,(135-sh*s)/2,sw*s,sh*s);return canvas.toDataURL('image/jpeg',.75);}
  entry(clip){
    if(this.entries.has(clip.id))return this.entries.get(clip.id);
    const a=this.assets.get(clip.assetId),url=this.urls.get(clip.assetId);if(!a||!url||a.kind==='image')return null;
    const el=document.createElement(a.kind==='video'?'video':'audio');el.preload='auto';el.playsInline=true;el.muted=true;
    const e={el,assetId:a.id,ready:false,lastUsed:performance.now(),playing:false};this.entries.set(clip.id,e);
    el.addEventListener('loadeddata',()=>{e.ready=true;if(clip.in)el.currentTime=clip.in;this.onUpdate();});
    el.addEventListener('seeked',()=>this.onUpdate());
    el.addEventListener('error',()=>{e.error=el.error?.message||'Media decode error';this.onUpdate();});
    el.src=url;this.connect(e);return e;
  }
  source(clip){
    const a=this.assets.get(clip.assetId);if(!a)return null;
    if(a.kind==='image'){if(!this.images.has(a.id))this.loadImage(a.id).catch(()=>{});return this.images.get(a.id);}
    if(a.kind==='audio')return null;
    return this.entry(clip)?.el;
  }
  sync(plan,project,frame,playing,rate=1){
    this.project=project;this.assets=new Map(project.assets.map(a=>[a.id,a]));
    const live=new Map();
    for(const layer of plan.layers)if(layer.clip.lane!=='title')live.set(layer.clip.id,{clip:layer.clip,frame:layer.frame,visual:true});
    for(const clip of plan.audio)if(!live.has(clip.id))live.set(clip.id,{clip,frame,visual:false});
    const currentIds=new Set(plan.audio.map(c=>c.id));
    for(const [id,item]of live){
      const {clip}=item;const a=this.assets.get(clip.assetId);if(a?.kind==='image')continue;
      const e=this.entry(clip);if(!e)continue;e.lastUsed=performance.now();const el=e.el;
      if(el.readyState<1)continue;
      const target=clamp(sourceTime(clip,item.frame,project.fps),0,Math.max(0,a.duration-.001));
      const silent=!currentIds.has(id)||rate<0;
      const shouldPlay=playing&&rate>0&&!silent;
      const tolerance=shouldPlay?.14:1/(project.fps*2);
      if(!el.seeking&&Math.abs(el.currentTime-target)>tolerance){try{el.currentTime=target;}catch{}}
      const speed=clamp(clip.speed*Math.abs(rate),.0625,16);if(el.playbackRate!==speed)el.playbackRate=speed;
      if(shouldPlay&&el.paused&&!e.playRequested){e.playRequested=true;el.play().catch(err=>{e.playError=err.message;}).finally(()=>{e.playRequested=false;});}
      if(!shouldPlay&&!el.paused)el.pause();
      if(e.gain){let volume=silent||!playing?0:10**(clip.gainDb/20);const local=frame-clip.start;if(clip.fadeIn)volume*=clamp(local/clip.fadeIn,0,1);if(clip.fadeOut)volume*=clamp((clip.duration-local)/clip.fadeOut,0,1);e.gain.gain.setTargetAtTime(volume,this.audio.currentTime,.012);}
    }
    for(const [id,e]of this.entries)if(!live.has(id)){if(!e.el.paused)e.el.pause();if(e.gain)e.gain.gain.setTargetAtTime(0,this.audio.currentTime,.012);}
    // Pre-roll the next two video sources, allowing decoders to warm before edits.
    const next=project.clips.filter(c=>c.enabled&&c.start>frame&&c.start<frame+project.fps*3&&c.lane!=='title').slice(0,2);
    for(const c of next)this.entry(c);
    // Bound decoder pool: active + upcoming entries survive. Others expire after 12 s.
    if(this.entries.size>14)for(const [id,e]of this.entries)if(!live.has(id)&&performance.now()-e.lastUsed>12000)this.release(id,e);
  }
  async prepare(plan,project){
    const frame=plan.frame??plan.layers[0]?.frame??0;
    this.sync(plan,project,frame,false);
    const items=new Map(plan.layers.filter(l=>l.clip.lane!=='title').map(l=>[l.clip.id,l]));
    for(const clip of plan.audio)if(!items.has(clip.id))items.set(clip.id,{clip,frame});
    await Promise.all([...items.values()].map(async l=>{
      const a=this.assets.get(l.clip.assetId);if(a?.kind==='image')return this.loadImage(a.id);
      const e=this.entry(l.clip);if(!e)return;
      await ready(e.el);
      const t=clamp(sourceTime(l.clip,l.frame,project.fps),0,Math.max(0,a.duration-.001));
      if(Math.abs(e.el.currentTime-t)>.001){e.el.currentTime=t;await ready(e.el);}
    }));
  }
  async waveform(asset){
    if(this.peaks.has(asset.id))return this.peaks.get(asset.id);
    let blob=await this.blob(asset.id);if(!blob&&asset.path)blob=await(await fetch(assetURL(asset.path))).blob();
    if(!blob||blob.size>80*1024*1024)return null;
    await this.ensureAudio();let buffer;
    try{buffer=await this.audio.decodeAudioData(await blob.arrayBuffer());}catch{return null;}
    const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());
    const promise=new Promise(resolve=>this.waveJobs.set(asset.id,resolve));this.worker.postMessage({id:asset.id,channels},channels.map(c=>c.buffer));return promise;
  }
  pauseAll(){for(const e of this.entries.values()){e.el.pause();if(e.gain)e.gain.gain.setTargetAtTime(0,this.audio.currentTime,.01);}}
  release(id,e){e.el.pause();e.node?.disconnect();e.gain?.disconnect();e.el.removeAttribute('src');e.el.load();this.entries.delete(id);}
  dispose(){this.pauseAll();for(const [id,e]of this.entries)this.release(id,e);for(const url of this.urls.values())if(url.startsWith('blob:'))URL.revokeObjectURL(url);this.worker.terminate();this.audio?.close();}
}
