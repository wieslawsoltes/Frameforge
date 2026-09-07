import {duration,renderPlan,timecode} from './core.js';
import {download,safeName} from './storage.js';
export const supportedFormats=()=>{
  if(!globalThis.MediaRecorder)return [];
  const formats=[
    {name:'WebM · VP9 / Opus',mime:'video/webm;codecs=vp9,opus',ext:'webm'},
    {name:'WebM · VP8 / Opus',mime:'video/webm;codecs=vp8,opus',ext:'webm'},
    {name:'MP4 · H.264 / AAC',mime:'video/mp4;codecs=avc1.42E01E,mp4a.40.2',ext:'mp4'},
    {name:'MP4 · browser encoder',mime:'video/mp4',ext:'mp4'}
  ];return formats.filter(f=>MediaRecorder.isTypeSupported(f.mime));
};
export class Exporter {
  constructor(app){this.app=app;this.running=false;this.session=null;}
  async start({mime,width,height,bitrate=12000000},onProgress=()=>{}){
    if(this.running)throw new Error('An export is already running.');
    const app=this.app,p=app.editor.project;
    if(app.media.missing.size)throw new Error('Relink missing media before exporting.');
    if(!supportedFormats().some(f=>f.mime===mime))throw new Error('This encoder is not available in your browser.');
    if(duration(p)/p.fps>1800)throw new Error('Real-time export is limited to 30 minutes per recording.');
    this.running=true;this.onProgress=onProgress;this.old={frame:app.frame,width:app.renderer.canvas.width,height:app.renderer.canvas.height};
    try{
      app.pause();app.sourceMode=false;await app.media.ensureAudio();
      for(const c of p.clips)if(c.lane!=='title')app.media.entry(c);
      app.renderer.resize(width,height);app.frame=0;
      await app.media.prepare(renderPlan(p,0),p);app.render();await app.renderer.settled();
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(app.renderer.canvas,0,0);
      const stream=canvas.captureStream(p.fps);
      const audio=app.media.destination.stream.getAudioTracks()[0]?.clone();if(audio)stream.addTrack(audio);
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrate,audioBitsPerSecond:192000});
      const chunks=[];
      this.session={canvas,ctx,stream,recorder,chunks,cancelled:false,start:performance.now(),mime};
      const result=new Promise((resolve,reject)=>{
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.onerror=e=>reject(e.error||new Error('The recording encoder failed.'));
        recorder.onstop=()=>{if(this.session?.cancelled){reject(new DOMException('Export cancelled.','AbortError'));return;}resolve(new Blob(chunks,{type:recorder.mimeType}));};
      });
      recorder.start(1000);await app.play(1,true);
      const blob=await result;
      const ext=recorder.mimeType.includes('mp4')?'mp4':'webm';
      download(blob,`${safeName(p.name)}.${ext}`);return blob;
    }finally{
      app.pause();const s=this.session;if(s){if(s.recorder.state!=='inactive')s.recorder.stop();s.stream.getTracks().forEach(t=>t.stop());}
      this.session=null;this.running=false;app.renderer.resize(this.old.width,this.old.height);app.seek(this.old.frame);app.updateAll();
    }
  }
  capture(){
    const s=this.session;if(!s||s.recorder.state==='inactive')return;
    s.ctx.drawImage(this.app.renderer.canvas,0,0,s.canvas.width,s.canvas.height);
    this.onProgress(Math.min(1,this.app.frame/duration(this.app.editor.project)),(performance.now()-s.start)/1000);
  }
  finish(){
    const s=this.session;if(!s||s.finishing)return;s.finishing=true;
    setTimeout(()=>{if(s.recorder.state!=='inactive')s.recorder.stop();},1000/this.app.editor.project.fps+30);
  }
  cancel(){const s=this.session;if(!s)return;s.cancelled=true;this.app.pause();if(s.recorder.state!=='inactive')s.recorder.stop();}
  async framePNG(){const app=this.app;app.pause();app.sourceMode=false;await app.media.prepare(renderPlan(app.editor.project,app.frame),app.editor.project);app.render();await app.renderer.settled();const c=document.createElement('canvas');c.width=app.renderer.canvas.width;c.height=app.renderer.canvas.height;c.getContext('2d').drawImage(app.renderer.canvas,0,0);const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw new Error('Could not capture the frame.');download(blob,`${safeName(app.editor.project.name)}-${Math.round(app.frame)}.png`);}
}
function srtTime(frame,fps){let ms=Math.round(frame/fps*1000);const milli=ms%1000;ms=Math.floor(ms/1000);const s=ms%60,m=Math.floor(ms/60)%60,h=Math.floor(ms/3600);return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+','+String(milli).padStart(3,'0');}
export function exportSRT(p){return p.clips.filter(c=>c.lane==='title'&&c.enabled).sort((a,b)=>a.start-b.start).map((c,i)=>`${i+1}\n${srtTime(c.start,p.fps)} --> ${srtTime(c.start+c.duration,p.fps)}\n${c.title.text}${c.title.subtitle?'\n'+c.title.subtitle:''}\n`).join('\n');}
export function parseSRT(text,fps){
  const blocks=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/);const captions=[];
  const timestamp=s=>{const m=/^(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(s);if(!m)return null;return Math.round((+m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/1000)*fps);};
  for(const block of blocks){const lines=block.split('\n');const i=lines.findIndex(l=>l.includes('-->'));if(i<0)continue;const [a,b]=lines[i].split('-->').map(s=>s.trim());const start=timestamp(a),end=timestamp(b);if(start===null||end===null||end<=start)continue;captions.push({start,duration:end-start,text:lines.slice(i+1).join('\n').replace(/<[^>]*>/g,'')});}
  if(!captions.length)throw new Error('No valid SRT captions were found.');if(captions.length>3000)throw new Error('A maximum of 3,000 captions can be imported at once.');return captions;
}
export function exportEDL(p){
  const lines=[`TITLE: ${p.name.replace(/[\r\n]/g,' ')}`,'FCM: NON-DROP FRAME',''];
  p.clips.filter(c=>c.lane==='primary').forEach((c,i)=>{const src=Math.round(c.in*p.fps),srcOut=src+Math.round(c.duration*c.speed);lines.push(`${String(i+1).padStart(3,'0')}  AX       V     C        ${timecode(src,p.fps)} ${timecode(srcOut,p.fps)} ${timecode(c.start,p.fps)} ${timecode(c.start+c.duration,p.fps)}`,`* FROM CLIP NAME: ${c.name.replace(/[\r\n]/g,' ')}`);if(c.speed!==1)lines.push(`M2   AX       ${(p.fps*c.speed).toFixed(1)}            ${timecode(src,p.fps)}`);lines.push('');});return lines.join('\n');
}
