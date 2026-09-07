import {clamp,duration,timecode,trimInPlace,reorderInPlace,attach,snapFrame,assetURL} from './core.js';
import {icon} from './icons.js';
export const thumbURL=a=>a?.thumb&&(/^(assets\/[a-z0-9-]+\.jpg|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(a.thumb))?assetURL(a.thumb):'';
export class Timeline {
  constructor(app){
    this.app=app;this.scroll=document.querySelector('#timelineScroll');this.content=document.querySelector('#timelineContent');this.layer=document.querySelector('#clipsLayer');this.ruler=document.querySelector('#rulerCanvas');this.head=document.querySelector('#playhead');this.snapLine=document.querySelector('#snapLine');this.markers=document.querySelector('#markersLayer');
    this.pps=42;this.snapping=true;this.magnetic=true;this.tool='select';this.nodes=new Map();this.drag=null;this.padding=16;
    this.scroll.addEventListener('scroll',()=>this.draw(),{passive:true});
    this.scroll.addEventListener('pointerdown',e=>this.pointerDown(e));
    this.scroll.addEventListener('dblclick',e=>{const node=e.target.closest('.clip');if(node){app.select(node.dataset.id);app.inspectorTab=node.classList.contains('title')?'text':'video';app.renderInspector();}});
    window.addEventListener('pointermove',e=>this.pointerMove(e));window.addEventListener('pointerup',e=>this.pointerUp(e));window.addEventListener('pointercancel',()=>this.cancelDrag());
    this.scroll.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();const frame=this.eventFrame(e);const old=this.pps;this.setZoom(this.pps*Math.exp(-e.deltaY*.005));this.scroll.scrollLeft+=(frame/this.app.editor.project.fps)*(this.pps-old);}else if(e.shiftKey&&Math.abs(e.deltaY)>0){e.preventDefault();this.scroll.scrollLeft+=e.deltaY;}},{passive:false});
    this.scroll.addEventListener('contextmenu',e=>{const c=e.target.closest('.clip');if(!c)return;e.preventDefault();app.select(c.dataset.id);app.showMenu([['Blade at playhead','split','⌘B'],['Duplicate','duplicate','⌘D'],['Enable / disable','enable','V'],['Detach connection','detach',''],null,['Delete','delete','⌫']],e.clientX,e.clientY);});
    this.scroll.addEventListener('dragover',e=>{e.preventDefault();this.scroll.classList.add('drop-active');e.dataTransfer.dropEffect='copy';});
    this.scroll.addEventListener('dragleave',()=>this.scroll.classList.remove('drop-active'));
    this.scroll.addEventListener('drop',e=>this.drop(e));
    new ResizeObserver(()=>this.draw()).observe(this.scroll);
  }
  setZoom(value){this.pps=clamp(value,10,180);document.querySelector('#timelineZoom').value=this.pps;this.draw();}
  fit(){const p=this.app.editor.project;this.setZoom((this.scroll.clientWidth-70)/(duration(p)/p.fps));this.scroll.scrollLeft=0;}
  setTool(tool){this.tool=tool;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));this.scroll.style.cursor=tool==='blade'?'crosshair':tool==='hand'?'grab':'default';}
  eventFrame(e){return Math.max(0,Math.round((e.clientX-this.scroll.getBoundingClientRect().left+this.scroll.scrollLeft-this.padding)/this.pps*this.app.editor.project.fps));}
  laneAt(e){const y=e.clientY-this.scroll.getBoundingClientRect().top+this.scroll.scrollTop;return y<85?'title':y<148?'overlay':y<239?'primary':'audio';}
  draw(){
    if(!this.app.editor)return;
    const p=this.app.editor.project,scroll=this.scroll.scrollLeft,width=this.scroll.clientWidth;
    this.content.style.width=Math.min(20000000,Math.max(width,(duration(p)/p.fps+5)*this.pps+this.padding))+'px';
    const active=new Set();const assets=new Map(p.assets.map(a=>[a.id,a]));
    for(const clip of p.clips){
      const x=clip.start/p.fps*this.pps+this.padding,w=clip.duration/p.fps*this.pps;
      if(x+w<scroll-250||x>scroll+width+250)continue;
      active.add(clip.id);let node=this.nodes.get(clip.id);
      if(!node){node=document.createElement('div');node.dataset.id=clip.id;node.setAttribute('role','button');node.tabIndex=-1;node.innerHTML='<div class="clip-filmstrip"></div><div class="clip-label"><i></i><span></span><b></b></div><canvas class="wave-canvas"></canvas><div class="transition-handle" hidden></div><div class="trim-handle left" data-edge="left"></div><div class="trim-handle right" data-edge="right"></div>';this.nodes.set(clip.id,node);this.layer.append(node);}
      node.className=`clip ${clip.lane}${this.app.selection.has(clip.id)?' selected':''}${clip.enabled?'':' disabled'}`;
      node.style.left=x+'px';node.style.width=Math.max(3,w-1)+'px';node.setAttribute('aria-label',`${clip.name}, ${timecode(clip.start,p.fps)}, ${clip.duration} frames`);node.title=`${clip.name}\nStart ${timecode(clip.start,p.fps)} · Duration ${timecode(clip.duration,p.fps)}\nDrag to move · Drag edges to trim`;
      const label=node.querySelector('.clip-label');label.querySelector('span').textContent=clip.lane==='title'?clip.title.text:clip.name;
      label.querySelector('i').innerHTML=icon(clip.lane==='title'?'text':clip.lane==='audio'?'music':'film',10);
      label.querySelector('b').textContent=clip.speed!==1?`${clip.speed}×`:'';
      const asset=assets.get(clip.assetId),thumb=thumbURL(asset);const filmstrip=node.querySelector('.clip-filmstrip');filmstrip.style.backgroundImage=thumb?`url("${thumb}")`:'';filmstrip.hidden=!thumb||clip.lane==='audio'||clip.lane==='title';
      node.querySelector('.transition-handle').hidden=clip.transition!=='dissolve';
      const canvas=node.querySelector('.wave-canvas'),peaks=this.app.media.peaks.get(clip.assetId);canvas.hidden=clip.lane!=='audio'||!peaks;
      if(!canvas.hidden){const key=[w,clip.in,clip.duration,clip.speed,peaks.length].join('|');if(node.waveKey!==key){this.waveform(canvas,clip,asset,peaks,w);node.waveKey=key;}}
    }
    for(const [id,node]of this.nodes)if(!active.has(id)){node.remove();this.nodes.delete(id);}
    this.layer.querySelectorAll('.connection').forEach(e=>e.remove());
    for(const c of p.clips)if(c.anchor&&(c.lane==='title'||c.lane==='overlay')&&active.has(c.id)){
      const line=document.createElement('div');line.className='connection';line.style.left=(c.start/p.fps*this.pps+this.padding+8)+'px';if(c.lane==='overlay'){line.style.top='138px';line.style.height='17px';}this.layer.prepend(line);
    }
    this.drawRuler();this.drawMarkers();this.updateHead();document.querySelector('#timelineEmpty').hidden=p.clips.length>0;
  }
  waveform(canvas,c,a,peaks,width){
    canvas.width=Math.min(2048,Math.max(2,Math.round(width)));canvas.height=40;const ctx=canvas.getContext('2d');ctx.strokeStyle='#84baa1';ctx.lineWidth=1;const bins=peaks.length/2;const start=c.in/a.duration,end=(c.in+c.duration/this.app.editor.project.fps*c.speed)/a.duration;
    ctx.beginPath();for(let x=0;x<canvas.width;x++){const i=clamp(Math.floor((start+(end-start)*x/canvas.width)*bins),0,bins-1)*2;ctx.moveTo(x,20+peaks[i]*55);ctx.lineTo(x,20+peaks[i+1]*55);}ctx.stroke();
  }
  drawRuler(){
    const p=this.app.editor.project,w=this.scroll.clientWidth,dpr=Math.min(2,devicePixelRatio||1),ctx=this.ruler.getContext('2d');this.ruler.width=w*dpr;this.ruler.height=30*dpr;this.ruler.style.width=w+'px';ctx.scale(dpr,dpr);ctx.fillStyle='#212126';ctx.fillRect(0,0,w,30);ctx.font='9px SFMono-Regular,Consolas,monospace';
    const step=this.pps>100?1:this.pps>32?2:this.pps>17?5:10;
    const left=(this.scroll.scrollLeft-this.padding)/this.pps,right=left+w/this.pps;
    for(let t=Math.floor(left/(step/4))*(step/4);t<=right;t+=step/4){if(t<0)continue;const x=t*this.pps-this.scroll.scrollLeft+this.padding,isMajor=Math.abs(t/step-Math.round(t/step))<.01;ctx.strokeStyle=isMajor?'#696071':'#413b49';ctx.beginPath();ctx.moveTo(Math.round(x)+.5,isMajor?21:25);ctx.lineTo(Math.round(x)+.5,30);ctx.stroke();if(isMajor){ctx.fillStyle='#928797';ctx.fillText(timecode(Math.round(t*p.fps),p.fps),x+5,13);}}
  }
  drawMarkers(){this.markers.replaceChildren();for(const m of this.app.editor.project.markers){const node=document.createElement('button');node.className='timeline-marker';node.style.left=(m.frame/this.app.editor.project.fps*this.pps+this.padding)+'px';node.title=m.label;node.setAttribute('aria-label',m.label);node.onclick=e=>{e.stopPropagation();this.app.seek(m.frame);};this.markers.append(node);}}
  updateHead(follow=false){
    const x=this.app.frame/this.app.editor.project.fps*this.pps+this.padding;this.head.style.left=x+'px';
    if(follow&&(x>this.scroll.scrollLeft+this.scroll.clientWidth-65||x<this.scroll.scrollLeft))this.scroll.scrollLeft=Math.max(0,x-this.scroll.clientWidth*.3);
  }
  targets(exclude){const p=this.app.editor.project;return [Math.round(this.app.frame),...p.markers.map(m=>m.frame),...p.clips.filter(c=>c.id!==exclude).flatMap(c=>[c.start,c.start+c.duration])];}
  pointerDown(e){
    if(e.button!==0||this.app.exporter.running)return;
    if(e.target.closest('.timeline-marker'))return;
    this.app.pause();this.app.sourceMode=false;
    const node=e.target.closest('.clip');
    if(this.tool==='hand'||e.altKey&&!node){e.preventDefault();this.drag={type:'pan',x:e.clientX,scroll:this.scroll.scrollLeft};this.scroll.setPointerCapture(e.pointerId);return;}
    if(node){
      e.preventDefault();const id=node.dataset.id;this.app.select(id,e.shiftKey);const c=this.app.editor.project.clips.find(c=>c.id===id);
      if(this.tool==='blade'){this.app.editor.split([id],this.eventFrame(e));return;}
      const edge=e.target.closest('[data-edge]')?.dataset.edge;
      this.drag={type:edge?'trim':'move',id,edge,x:e.clientX,y:e.clientY,start:c.start,duration:c.duration,lane:c.lane,started:false};
    }else{e.preventDefault();this.drag={type:'scrub'};this.app.seek(this.eventFrame(e));}
    this.scroll.setPointerCapture(e.pointerId);
  }
  pointerMove(e){
    const d=this.drag;if(!d)return;
    if(d.type==='pan'){this.scroll.scrollLeft=d.scroll+d.x-e.clientX;return;}
    if(d.type==='scrub'){this.app.seek(this.eventFrame(e));return;}
    if(!d.started&&Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)<4)return;
    if(!d.started){this.app.editor.beginGesture(d.type==='trim'?'Trim clip':'Move clip');d.started=true;}
    const p=this.app.editor.project,fps=p.fps;
    let delta=Math.round((e.clientX-d.x)/this.pps*fps);const raw=d.start+(d.edge==='right'?d.duration:0)+delta;
    const snapped=this.snapping&&!e.shiftKey?snapFrame(raw,this.targets(d.id),6/this.pps*fps):Math.max(0,raw);delta=snapped-d.start-(d.edge==='right'?d.duration:0);
    this.snapLine.hidden=raw===snapped;this.snapLine.style.left=(snapped/fps*this.pps+this.padding)+'px';
    this.app.editor.previewGesture(project=>{
      if(d.type==='trim')trimInPlace(project,d.id,d.edge,delta);
      else{
        const c=project.clips.find(c=>c.id===d.id);
        if(d.lane==='primary'&&!this.magnetic){c.lane='overlay';c.start=Math.max(0,d.start+delta);attach(project,c);}
        else reorderInPlace(project,d.id,Math.max(0,d.start+delta));
      }
    });
    const rect=this.scroll.getBoundingClientRect();if(e.clientX>rect.right-25)this.scroll.scrollLeft+=14;else if(e.clientX<rect.left+25)this.scroll.scrollLeft-=14;
  }
  pointerUp(){if(!this.drag)return;const d=this.drag;this.drag=null;this.snapLine.hidden=true;if(d.started){try{this.app.editor.endGesture();}catch(e){this.app.toast(e.message);}}this.app.renderInspector();}
  cancelDrag(){this.drag=null;this.snapLine.hidden=true;this.app.editor.cancelGesture();}
  drop(e){
    e.preventDefault();this.scroll.classList.remove('drop-active');const mediaId=e.dataTransfer.getData('application/x-frameforge-media'),title=e.dataTransfer.getData('application/x-frameforge-title');let frame=this.eventFrame(e);if(this.snapping)frame=snapFrame(frame,this.targets(),6/this.pps*this.app.editor.project.fps);
    if(title){this.app.select(this.app.editor.addTitle(frame,title,title==='cinematic'?'YOUR STORY':'New title'));return;}
    if(mediaId){try{const a=this.app.editor.project.assets.find(a=>a.id===mediaId);const lane=a?.kind==='audio'?'audio':this.laneAt(e)==='primary'?'primary':'overlay';const id=lane==='primary'?this.app.editor.insert(mediaId,frame,this.app.rangeFor(mediaId)):this.app.editor.append(mediaId,lane,frame,this.app.rangeFor(mediaId));this.app.select(id);}catch(error){this.app.toast(error.message);}return;}
    if(e.dataTransfer.files.length)this.app.importFiles(e.dataTransfer.files,true,frame);
  }
}
