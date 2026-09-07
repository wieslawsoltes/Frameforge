import {Editor,createDemo,makeClip,DEFAULT_FX,copy,uid,clamp,duration,primaryDuration,timecode,parseTimecode,renderPlan,evaluatedFX,attach,trimInPlace,validateProject,assetURL} from './core.js';
import {Compositor} from './renderer.js';
import {MediaEngine} from './media.js';
import {Storage,download,safeName,portableProject,unpackProject} from './storage.js';
import {Exporter,supportedFormats,exportSRT,parseSRT,exportEDL} from './export.js';
import {Timeline,thumbURL} from './timeline.js';
import {icon,applyIcons} from './icons.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOOKS=[
  {id:'neutral',name:'Original',css:'none',fx:{exposure:0,contrast:100,saturation:100,temperature:0,vignette:0}},
  {id:'cinema',name:'Cinematic',css:'contrast(1.18) saturate(.78)',fx:{exposure:.1,contrast:116,saturation:82,temperature:-12,vignette:25}},
  {id:'warm',name:'Golden hour',css:'sepia(.35) saturate(1.2)',fx:{exposure:.2,contrast:104,saturation:112,temperature:48,vignette:10}},
  {id:'noir',name:'Silver screen',css:'grayscale(1) contrast(1.25)',fx:{exposure:.15,contrast:126,saturation:0,temperature:0,vignette:35}},
  {id:'cool',name:'Blue hour',css:'hue-rotate(15deg) saturate(1.2)',fx:{exposure:-.1,contrast:112,saturation:118,temperature:-48,vignette:20}},
  {id:'soft',name:'Soft light',css:'contrast(.85) brightness(1.15)',fx:{exposure:.2,contrast:86,saturation:88,temperature:10,vignette:0}}
];
const SHORTCUTS=[['Play / pause','Space'],['Previous / next frame','← / →'],['Previous / next edit','↑ / ↓'],['Reverse / stop / forward','J / K / L'],['Select / blade / hand','A / B / H'],['Split at playhead','⌘ B'],['Append / insert / connect','E / W / Q'],['Mark source in / out','I / O'],['Undo / redo','⌘ Z / ⇧⌘ Z'],['Duplicate clip','⌘ D'],['Delete selected clips','⌫'],['Enable / disable clip','V'],['Add marker','M'],['Toggle snapping','N'],['Fit timeline','⇧ Z'],['Zoom timeline','− / +'],['Import media','⌘ I'],['Save portable project','⌘ S'],['New connected title','⌘ T'],['Favorite media','F'],['Project start / end','Home / End'],['Keyboard shortcuts','?']];
class App {
  constructor(){
    this.frame=60;this.sourceFrame=0;this.playing=false;this.rate=1;this.selection=new Set();this.selectedAsset=null;this.sourceMode=false;this.browserTab='media';this.collection='all';this.inspectorTab='video';this.ranges=new Map();this.dirty=true;this.inspectorEditing=false;this.guides=false;this.inspectorOpen=new Map();this.ready=this.init();
  }
  async init(){
    applyIcons();this.storage=await new Storage().open();let project;
    try{project=await this.storage.loadProject();}catch(e){console.warn('Autosave could not be restored',e);}
    this.editor=new Editor(project||createDemo());if(project)this.frame=Math.min(60,duration(project)-1);
    this.selectedAsset=this.editor.project.assets.find(a=>a.kind==='video')?.id||this.editor.project.assets[0]?.id;
    this.selection=new Set(this.editor.project.clips.filter(c=>c.lane==='primary').slice(0,1).map(c=>c.id));
    this.media=new MediaEngine(this.storage,()=>{this.dirty=true;this.timeline?.draw();});
    this.renderer=new Compositor($('canvasHost'),(kind,reason)=>{$('engineName').textContent=kind;$('engineBadge').title=reason;$('engineBadge').dataset.renderer=kind;});
    await Promise.all([this.media.setProject(this.editor.project),this.renderer.init()]);
    this.renderer.onInvalidate=()=>{this.dirty=true;};
    this.exporter=new Exporter(this);this.timeline=new Timeline(this);
    this.editor.onChange(({label})=>{
      this.media.project=this.editor.project;this.media.assets=new Map(this.editor.project.assets.map(a=>[a.id,a]));
      for(const id of this.selection)if(!this.editor.project.clips.some(c=>c.id===id))this.selection.delete(id);
      this.frame=clamp(this.frame,0,duration(this.editor.project)-1);this.dirty=true;
      this.timeline.draw();this.updateLabels();this.renderIndex();
      const sig=JSON.stringify(this.editor.project.assets.map(a=>[a.id,a.favorite,a.name]));if(sig!==this.assetSignature){this.assetSignature=sig;this.renderBrowser();}
      if(!this.inspectorEditing&&label!=='preview')this.renderInspector();
      if(label!=='preview'&&label!=='cancel')this.scheduleSave();
    });
    this.bind();this.renderEffects();this.updateAll();
    new ResizeObserver(()=>this.fitViewer()).observe(document.querySelector('.viewer-body'));
    try{await this.media.prepare(renderPlan(this.editor.project,this.frame),this.editor.project);}catch(e){this.toast(e.message);}
    this.render();requestAnimationFrame(t=>this.tick(t));
    $('saveState').textContent=this.storage.db?'Saved on this device':'Session only';
    if(this.media.missing.size)this.toast(`${this.media.missing.size} media files are offline. Use File → Relink media.`);
    if(!this.storage.db)this.toast('Browser storage is unavailable. Portable project saving is required before closing.');
    this.booted=true;return this;
  }
  bind(){
    document.addEventListener('click',e=>{
      const menuButton=e.target.closest('[data-menu]');if(menuButton){const r=menuButton.getBoundingClientRect();this.openMenu(menuButton.dataset.menu,r.left,r.bottom+2);return;}
      if(!e.target.closest('#menuPopup'))$('menuPopup').hidden=true;
      const action=e.target.closest('[data-action]')?.dataset.action;
      if(action){e.preventDefault();this.action(action).catch(err=>this.toast(err.message));}
      const collection=e.target.closest('[data-collection]')?.dataset.collection;
      if(collection){this.collection=collection;this.browserTab='media';this.renderBrowser();}
      const browser=e.target.closest('[data-browser]')?.dataset.browser;
      if(browser){this.browserTab=browser;this.renderBrowser();}
      const inspector=e.target.closest('[data-inspector]')?.dataset.inspector;
      if(inspector){this.inspectorTab=inspector;this.renderInspector();}
      const tool=e.target.closest('[data-tool]')?.dataset.tool;if(tool)this.timeline.setTool(tool);
      const effect=e.target.closest('[data-effect]')?.dataset.effect;if(effect)this.applyEffect(effect);
    });
    $('mediaSearch').addEventListener('input',()=>this.renderBrowser());
    $('mediaInput').addEventListener('change',async e=>{await this.importFiles(e.target.files);e.target.value='';});
    $('projectInput').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const p=await unpackProject(file,this.storage);await this.loadProject(p);this.toast('Project opened.');}catch(error){this.toast(error.message);}});
    $('relinkInput').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(file)await this.relink(file);});
    $('srtInput').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(file)try{this.importCaptions(await file.text());}catch(error){this.toast(error.message);}});
    $('monitorVolume').addEventListener('input',e=>this.media.setVolume(+e.target.value/100));
    $('previewQuality').addEventListener('change',e=>{const p=this.editor.project;this.renderer.resize(+e.target.value,Math.round(+e.target.value*p.height/p.width));this.dirty=true;});
    $('timelineZoom').addEventListener('input',e=>this.timeline.setZoom(+e.target.value));
    $('sourceScrub').addEventListener('input',e=>{this.pause();this.sourceMode=true;this.sourceFrame=+e.target.value;this.dirty=true;this.updateLabels();});
    $('inspectorContent').addEventListener('click',e=>this.inspectorClick(e));
    $('inspectorContent').addEventListener('pointerdown',e=>{if(e.target.matches('input[type=range][data-fx]')){this.inspectorEditing=true;this.editor.beginGesture('Adjust '+e.target.dataset.fx);}});
    $('inspectorContent').addEventListener('input',e=>{
      const input=e.target;if(input.matches('input[type=range][data-fx]')){
        if(!this.editor.gesture){this.inspectorEditing=true;this.editor.beginGesture('Adjust '+input.dataset.fx);}
        const c=this.selectedClip();if(!c)return;const key=input.dataset.fx,value=+input.value;
        this.editor.previewGesture(p=>this.setFX(p.clips.find(x=>x.id===c.id),key,value));
        const paired=$('inspectorContent').querySelector(`input[type=number][data-fx="${key}"]`);if(paired)paired.value=value;
      }
    });
    $('inspectorContent').addEventListener('change',e=>this.inspectorChange(e));
    $('inspectorContent').addEventListener('toggle',e=>{if(e.target.matches('details'))this.inspectorOpen.set(e.target.dataset.section,e.target.open);},true);
    $('dialogClose').onclick=()=>{if(this.exporter.running)this.exporter.cancel();else $('dialog').close();};
    $('dialog').addEventListener('cancel',e=>{if(this.exporter.running){e.preventDefault();this.exporter.cancel();}});
    $('dialogForm').addEventListener('submit',e=>e.preventDefault());
    document.addEventListener('keydown',e=>this.keydown(e));
    document.addEventListener('visibilitychange',()=>{if(document.hidden){if(this.exporter.running){this.exporter.cancel();this.toast('Export was cancelled because the tab became hidden. Keep it visible during real-time recording.');}else this.pause();}});
    window.addEventListener('beforeunload',e=>{if(this.exporter.running||this.savePending||this.sessionUnsaved){e.preventDefault();e.returnValue='';}});
    const divider=$('timelineDivider');let sizing=null;
    divider.addEventListener('pointerdown',e=>{sizing={y:e.clientY,h:$('timelineRegion').getBoundingClientRect().height};divider.setPointerCapture(e.pointerId);});
    divider.addEventListener('pointermove',e=>{if(sizing)document.documentElement.style.setProperty('--timeline-height',clamp(sizing.h+sizing.y-e.clientY,220,innerHeight*.6)+'px');});
    divider.addEventListener('pointerup',()=>{sizing=null;});
    $('canvasHost').addEventListener('dblclick',()=>this.action('fullscreen'));
    // OS file drops are accepted anywhere except the timeline, which has positional import.
    document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
    document.addEventListener('drop',e=>{if(e.target.closest('#timelineScroll'))return;e.preventDefault();if(e.dataTransfer.files.length)this.importFiles(e.dataTransfer.files);});
  }
  fitViewer(){const body=document.querySelector('.viewer-body');const p=this.editor.project;const width=Math.min(body.clientWidth-30,(body.clientHeight-47)*p.width/p.height);$('canvasHost').style.width=Math.max(100,width)+'px';$('canvasHost').style.aspectRatio=`${p.width}/${p.height}`;}
  selectedClip(){return this.editor.project.clips.find(c=>this.selection.has(c.id));}
  select(id,add=false){if(!id)return;if(add){if(this.selection.has(id))this.selection.delete(id);else this.selection.add(id);}else this.selection=new Set([id]);this.sourceMode=false;const c=this.selectedClip();if(c?.lane==='title')this.inspectorTab='text';else if(c?.lane==='audio')this.inspectorTab='audio';else if(this.inspectorTab==='text'||this.inspectorTab==='audio')this.inspectorTab='video';this.dirty=true;this.timeline.draw();this.renderInspector();this.updateLabels();}
  selectAsset(id){this.pause();this.selectedAsset=id;this.sourceFrame=0;this.sourceMode=true;this.renderBrowser();this.updateLabels();this.dirty=true;}
  sourceClip(){const a=this.editor.project.assets.find(a=>a.id===this.selectedAsset);if(!a)return null;const key=a.id+'|'+a.duration+'|'+this.editor.project.fps;if(this.sourceCache?.key!==key)this.sourceCache={key,clip:{...makeClip(a,a.kind==='audio'?'audio':'primary',0,this.editor.project.fps),id:'source-'+a.id,duration:Math.max(1,Math.round(a.duration*this.editor.project.fps)),gainDb:0}};return this.sourceCache.clip;}
  activePlan(){if(this.sourceMode){const clip=this.sourceClip();return clip?{layers:clip.lane==='audio'?[]:[{clip,frame:this.sourceFrame,opacity:1}],audio:[clip]}:{layers:[],audio:[]};}return renderPlan(this.editor.project,this.frame);}
  clock(){return this.media.audio?.state==='running'?this.media.audio.currentTime:performance.now()/1000;}
  async play(rate=1,force=false){
    if(this.playing&&!force&&rate===this.rate){this.pause();return;}
    await this.media.ensureAudio();
    const max=this.sourceMode?(this.sourceClip()?.duration||1):duration(this.editor.project);
    let frame=this.sourceMode?this.sourceFrame:this.frame;
    if(rate>0&&frame>=max-1)frame=0;if(rate<0&&frame<=0)frame=max-1;
    if(this.sourceMode)this.sourceFrame=frame;else this.frame=frame;
    this.baseFrame=frame;this.baseClock=this.clock();this.rate=rate;this.playing=true;this.dirty=true;this.updatePlayButton();
  }
  pause(){this.playing=false;this.media?.pauseAll();this.updatePlayButton();}
  updatePlayButton(){if(!$('playButton'))return;$('playButton').innerHTML=icon(this.playing?'pause':'play',19);$('playButton').classList.toggle('playing',this.playing);$('playButton').setAttribute('aria-label',this.playing?'Pause':'Play');}
  seek(frame){this.pause();this.sourceMode=false;this.frame=clamp(Math.round(frame),0,duration(this.editor.project)-1);this.dirty=true;this.timeline?.updateHead();this.updateLabels();}
  tick(now){
    let ended=false;
    if(this.playing){const max=this.sourceMode?(this.sourceClip()?.duration||1):duration(this.editor.project);const next=Math.floor(this.baseFrame+(this.clock()-this.baseClock)*this.editor.project.fps*this.rate);const frame=clamp(next,0,max-1);if(this.sourceMode){if(frame!==this.sourceFrame)this.dirty=true;this.sourceFrame=frame;}else{if(frame!==this.frame)this.dirty=true;this.frame=frame;}if(next>=max||next<0)ended=true;}
    if(this.dirty){this.render();this.updateLabels();this.timeline.updateHead(this.playing&&!this.sourceMode);this.dirty=false;}
    if(this.exporter.running)this.exporter.capture();
    if(ended){this.pause();if(this.exporter.running)this.exporter.finish();}
    const level=this.playing?this.media.meter():0;document.querySelectorAll('.audio-meter span').forEach((s,i)=>s.style.height=(2+clamp(level*70*(i?.92:1),0,17))+'px');
    if(!this.lastStats||now-this.lastStats>900){$('renderStats').textContent=`${this.renderer.lastMs.toFixed(2)} ms submit · ${this.activePlan().layers.length} layers`;this.lastStats=now;}
    requestAnimationFrame(t=>this.tick(t));
  }
  render(){
    const plan=this.activePlan(),frame=this.sourceMode?this.sourceFrame:this.frame;
    this.renderer.projectWidth=this.editor.project.width;this.renderer.projectHeight=this.editor.project.height;
    this.media.sync(plan,this.editor.project,frame,this.playing,this.rate);this.renderer.render(plan.layers,this.media);
    const missing=plan.layers.some(l=>this.media.missing.has(l.clip.assetId));$('missingOverlay').hidden=!missing;
  }
  updateLabels(){
    const p=this.editor.project,frames=duration(p);if(this.labelProjectName!==p.name){$('projectTitle').innerHTML=esc(p.name)+icon('down',12);this.labelProjectName=p.name;}$('projectFormat').textContent=`${p.width} × ${p.height}`;$('projectFps').textContent=p.fps+' fps';
    $('libraryProjectName').textContent=p.name.split(' — ')[0];$('libraryDuration').textContent=timecode(frames,p.fps);$('timelineName').textContent=p.name.split(' — ')[0];$('timelineLength').textContent=timecode(frames,p.fps);
    const a=p.assets.find(a=>a.id===this.selectedAsset);$('viewerName').textContent=this.sourceMode?(a?.name||'Source'):p.name.split(' — ')[0];$('viewerMode').textContent=this.sourceMode?'SOURCE VIEWER':'PROJECT VIEWER';$('sourceModeButton').textContent=this.sourceMode?'Source':'Project';$('sourceModeButton').style.color=this.sourceMode?'#c1a6ee':'';
    $('timecode').textContent=timecode(this.sourceMode?this.sourceFrame:this.frame,p.fps);
    $('selectionStatus').textContent=this.selection.size?`${this.selection.size} clip${this.selection.size>1?'s':''} selected`:`${p.clips.length} clips · ${(frames/p.fps).toFixed(1)} seconds`;
    $('timelineStatus').textContent=this.timeline?.magnetic?'Magnetic storyline':'Position · lift to connected';
    $('undo').disabled=this.editor.undoStack.length===0;$('redo').disabled=this.editor.redoStack.length===0;
    $('allCount').textContent=p.assets.length;$('importCount').textContent=p.assets.filter(a=>!a.path).length;
    if(a){$('sourceName').textContent=a.name;$('sourceScrub').max=Math.max(0,Math.round(a.duration*p.fps)-1);$('sourceScrub').value=this.sourceFrame;const r=this.ranges.get(a.id);$('rangeLabel').textContent=r?`${timecode(r.in,p.fps).slice(3)} → ${timecode(r.out,p.fps).slice(3)}`:'Full source';}else{$('sourceName').textContent='Select media to preview';}
    this.fitViewer();
  }
  updateAll(){this.renderBrowser();this.renderInspector();this.renderIndex();this.updateLabels();this.timeline.draw();this.dirty=true;}
  scheduleSave(){
    if(!this.storage.db){$('saveState').textContent='Session only';this.savePending=false;this.sessionUnsaved=true;return;}
    $('saveState').textContent='Saving…';this.savePending=true;clearTimeout(this.saveTimer);
    this.saveTimer=setTimeout(async()=>{try{await this.storage.saveProject(this.editor.project);$('saveState').textContent='Saved on this device';this.savePending=false;}catch(e){$('saveState').textContent='Save needed';this.toast('Autosave failed: '+e.message+' Use File → Save portable project.');}},500);
  }
  toast(message){clearTimeout(this.toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');this.toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4800);}
  rangeFor(id){return this.ranges.get(id)||null;}
  renderBrowser(){
    const p=this.editor.project,grid=$('mediaGrid');grid.replaceChildren();
    document.querySelectorAll('[data-browser]').forEach(b=>b.classList.toggle('selected',b.dataset.browser===this.browserTab));document.querySelectorAll('[data-collection]').forEach(b=>b.classList.toggle('selected',b.dataset.collection===this.collection&&!b.classList.contains('library-root')));
    const labels={all:'All media',imported:'Imported media',favorites:'Favorites',video:'Video',audio:'Audio',image:'Stills'};
    $('collectionName').textContent=this.browserTab==='titles'?'Titles & generators':this.browserTab==='audio'?'Audio':labels[this.collection];
    if(this.browserTab==='titles'){
      $('mediaGroup').innerHTML='TITLES <span>3 styles</span>';
      for(const [style,name,preview]of [['cinematic','Cinematic title','BEYOND'],['basic','Basic title','Your story'],['lower','Lower third','A new perspective']]){
        const card=document.createElement('div');card.className='media-card';card.draggable=true;card.tabIndex=0;card.innerHTML=`<div class="media-thumb"><div class="title-thumbnail" style="font-size:${style==='lower'?9:15}px;letter-spacing:${style==='lower'?0:3}px">${preview}</div></div><div class="media-name">${name}</div><div class="media-meta">Editable · Connected title</div>`;
        card.ondblclick=()=>this.select(this.editor.addTitle(this.frame,style,style==='cinematic'?'YOUR STORY':'Your title'));
        card.onclick=()=>{grid.querySelectorAll('.media-card').forEach(c=>c.classList.remove('selected'));card.classList.add('selected');};
        card.onkeydown=e=>{if(e.key==='Enter')card.ondblclick();};card.ondragstart=e=>e.dataTransfer.setData('application/x-frameforge-title',style);grid.append(card);
      }return;
    }
    const query=$('mediaSearch').value.toLocaleLowerCase();
    const assets=p.assets.filter(a=>a.name.toLocaleLowerCase().includes(query)&&(this.browserTab!=='audio'||a.kind==='audio')&&(this.collection==='all'||this.collection==='favorites'&&a.favorite||this.collection==='imported'&&!a.path||a.kind===this.collection));
    $('mediaGroup').innerHTML=`${this.collection==='all'?'MEDIA COLLECTION':esc(labels[this.collection]).toUpperCase()} <span>${assets.length} items</span>`;
    for(const a of assets){
      const card=document.createElement('div');card.className='media-card'+(this.selectedAsset===a.id?' selected':'');card.draggable=true;card.tabIndex=0;card.dataset.assetId=a.id;
      const thumb=thumbURL(a);const durationText=timecode(Math.round(a.duration*p.fps),p.fps).slice(3);
      card.innerHTML=`<div class="media-thumb">${a.kind==='audio'?'<div class="audio-thumbnail">'+icon('audio',40)+'</div>':''}<span class="thumb-kind">${icon(a.kind==='audio'?'music':a.kind==='image'?'grid':'film',11)}</span><span class="thumb-duration">${durationText}</span>${a.favorite?'<span class="favorite-dot">★</span>':''}</div><div class="media-name"></div><div class="media-meta"></div>`;
      if(thumb)card.querySelector('.media-thumb').style.backgroundImage=`url("${thumb}")`;
      card.querySelector('.media-name').textContent=a.name;
      card.querySelector('.media-meta').textContent=this.media.missing.has(a.id)?'OFFLINE · Relink media':a.kind==='audio'?`${a.sampleRate? a.sampleRate/1000+' kHz · ':''}Stereo audio`:a.kind==='image'?`${a.width} × ${a.height} · Still`:`${a.width} × ${a.height} · ${a.synthetic?'Rendered camera move':'Video'}`;
      card.title=`${a.name}\n${durationText} · ${a.synthetic?'Original 3D Earth render, not live footage':a.kind}\nDouble-click to append to the edit`;
      card.onclick=()=>this.selectAsset(a.id);card.ondblclick=()=>this.addMedia('append',a.id);
      card.onkeydown=e=>{if(e.key==='Enter')this.addMedia('append',a.id);};card.ondragstart=e=>{e.dataTransfer.setData('application/x-frameforge-media',a.id);e.dataTransfer.effectAllowed='copy';};grid.append(card);
    }
    if(!assets.length){const empty=document.createElement('div');empty.className='browser-empty';empty.innerHTML=`${this.collection==='favorites'?'Keep your best takes together.<br>Select media and press F to favorite it.':'Your next story starts here.<br>Import video, audio, or still images.'}<button class="toolbar-button" data-action="import">${icon('import',14)}Import media</button>`;grid.append(empty);}
    $('favoriteButton').classList.toggle('active',!!p.assets.find(a=>a.id===this.selectedAsset)?.favorite);
  }
  renderEffects(){const grid=$('effectsGrid');for(const look of LOOKS){const button=document.createElement('button');button.className='effect-card';button.dataset.effect=look.id;button.innerHTML=`<div class="effect-thumb" style="filter:${look.css}"></div><span>${look.name}</span>`;grid.append(button);}}
  applyEffect(id){
    const selected=this.selectedClip();if(!selected){this.toast('Select a clip in the timeline first.');return;}
    this.pause();this.sourceMode=false;
    try{this.editor.transact('Apply '+id,p=>{for(const c of p.clips.filter(c=>this.selection.has(c.id))){if(id==='dissolve'){if(c.lane!=='primary')throw new Error('Cross dissolves are applied to incoming primary-storyline clips.');c.transition='dissolve';c.transitionFrames=12;}else if(id==='fade'){c.fadeIn=c.fadeOut=Math.min(12,Math.floor(c.duration/2));}else{const look=LOOKS.find(l=>l.id===id);if(look)Object.assign(c.fx,look.fx);}}});this.toast(id==='dissolve'?'Cross dissolve applied to the incoming edge.':id==='fade'?'Fade in and out applied.':LOOKS.find(l=>l.id===id).name+' applied.');}catch(e){this.toast(e.message);}
  }
  renderIndex(){const content=$('indexContent');content.replaceChildren();for(const marker of this.editor.project.markers){const b=document.createElement('button');b.className='index-item';b.innerHTML=icon('marker',12)+`<span>${esc(marker.label)}</span><small>${timecode(marker.frame,this.editor.project.fps).slice(3)}</small>`;b.onclick=()=>this.seek(marker.frame);b.oncontextmenu=e=>{e.preventDefault();this.editor.transact('Remove marker',p=>p.markers=p.markers.filter(m=>m.id!==marker.id));};content.append(b);}for(const c of this.editor.project.clips){const b=document.createElement('button');b.className='index-item';b.innerHTML=icon(c.lane==='title'?'text':c.lane==='audio'?'music':'film',12)+`<span>${esc(c.name)}</span><small>${timecode(c.start,this.editor.project.fps).slice(3)}</small>`;b.onclick=()=>{this.seek(c.start);this.select(c.id);};content.append(b);}}
  renderInspector(){
    const c=this.selectedClip(),host=$('inspectorContent');
    document.querySelectorAll('[data-inspector]').forEach(b=>b.classList.toggle('selected',b.dataset.inspector===this.inspectorTab));
    if(!c){host.innerHTML='<div class="inspector-empty">'+icon('sliders',27)+'<p>Select a timeline clip<br>to make it your own.</p><small>Transform, grade, mix, and animate.</small></div>';return;}
    const p=this.editor.project,fx=evaluatedFX(c,this.frame),type=c.lane==='title'?'text':c.lane==='audio'?'music':'film';
    let html=`<div class="inspector-title"><div class="clip-type-icon">${icon(type,16)}</div><div><strong>${esc(c.name)}</strong><small>${timecode(c.duration,p.fps)} · ${c.lane==='primary'?'Primary storyline':c.lane==='title'?'Connected title':c.lane==='audio'?'Audio clip':'Connected clip'}</small></div><button class="icon-button small" data-inspector-action="reset" title="Reset clip effects">${icon('reset',13)}</button></div>`;
    const section=(id,name,body,open=true)=>`<details class="inspector-section" data-section="${id}" ${(this.inspectorOpen.has(id)?this.inspectorOpen.get(id):open)?'open':''}><summary>${name}</summary><div class="inspector-fields">${body}</div></details>`;
    const number=(key,label,min,max,step=1,unit='',range=false)=>`<div class="property"><label>${label}</label>${range?`<input type="range" min="${min}" max="${max}" step="${step}" value="${fx[key]}" data-fx="${key}" aria-label="${label}">`:''}<input type="number" value="${Number(fx[key].toFixed(2))}" min="${min}" max="${max}" step="${step}" data-fx="${key}" aria-label="${label} value"><span class="unit">${unit}</span><button class="keyframe-button ${c.keyframes[key]?.length?'active':''}" data-keyframe="${key}" title="Add / remove ${label} keyframe at playhead">◇</button></div>`;
    const audioField=(key,label,value,min,max,step=1,unit='')=>`<div class="property"><label>${label}</label><input type="number" value="${Number(value.toFixed(3))}" min="${min}" max="${max}" step="${step}" data-clip="${key}" aria-label="${label}"><span class="unit">${unit}</span></div>`;
    const color=()=>`<div class="color-preview"><span>SDR color correction</span></div>${number('exposure','Exposure',-4,4,.05,'EV',true)}${number('contrast','Contrast',0,200,1,'%',true)}${number('saturation','Saturation',0,200,1,'%',true)}${number('temperature','Warmth',-100,100,1,'',true)}${number('vignette','Vignette',0,100,1,'%',true)}<button class="block-button" data-inspector-action="looks">Browse color looks</button>`;
    if(this.inspectorTab==='video'){
      html+=section('compositing','Compositing',`<div class="property"><label>Enabled</label><input class="clip-enabled" type="checkbox" data-clip="enabled" ${c.enabled?'checked':''} aria-label="Clip enabled"></div>${number('opacity','Opacity',0,100,1,'%',true)}<div class="property"><label>Blend mode</label><span style="font-size:10px;color:#8c819a">Source over</span></div>`);
      html+=section('transform','Transform',number('x','Position X',-3840,3840,1,'px')+number('y','Position Y',-2160,2160,1,'px')+number('scale','Scale',1,500,1,'%',true)+number('rotation','Rotation',-180,180,.1,'°')+'<div class="inspector-note">◇ Add a keyframe at the playhead. Move to another frame and change a value to animate.</div>');
      html+=section('crop','Crop',number('cropL','Left',0,49,1,'%')+number('cropR','Right',0,49,1,'%')+number('cropT','Top',0,49,1,'%')+number('cropB','Bottom',0,49,1,'%'),false);
      html+=section('color','Color adjustment',color(),false);
      html+=section('timing','Timing',audioField('speed','Playback speed',c.speed,.1,8,.1,'×')+audioField('fadeIn','Fade in',c.fadeIn/p.fps,0,c.duration/p.fps,.05,'s')+audioField('fadeOut','Fade out',c.fadeOut/p.fps,0,c.duration/p.fps,.05,'s')+`<div class="property"><label>Transition</label><select data-clip="transition" aria-label="Transition"><option value="none" ${c.transition==='none'?'selected':''}>Cut</option><option value="dissolve" ${c.transition==='dissolve'?'selected':''}>Cross dissolve</option></select></div><div class="inspector-note">Dissolves use outgoing source handles when available and hold the last source frame otherwise.</div>`,false);
    }else if(this.inspectorTab==='color'){
      html+=section('color-full','Color adjustment',color());
      html+=section('color-anim','Animation',`<div class="inspector-note">${Object.values(c.keyframes).reduce((n,k)=>n+k.length,0)} keyframes on this clip.<br>Keyframe interpolation is linear; the project schema also supports smooth interpolation.</div><button class="block-button" data-inspector-action="clear-keyframes">Remove all keyframes</button>`);
    }else if(this.inspectorTab==='audio'){
      if(c.lane==='title')html+='<div class="inspector-empty">Titles do not contain audio.</div>';
      else html+=section('audio','Audio mix',audioField('gainDb','Volume',c.gainDb,-60,12,.5,'dB')+audioField('fadeIn','Fade in',c.fadeIn/p.fps,0,c.duration/p.fps,.05,'s')+audioField('fadeOut','Fade out',c.fadeOut/p.fps,0,c.duration/p.fps,.05,'s')+'<div class="inspector-note">Clip gain is included in export. Viewer volume controls monitoring only. Fade controls apply to both the image and audio of video clips.</div>')+section('speed','Retime',audioField('speed','Speed',c.speed,.1,8,.1,'×')+'<div class="inspector-note">Source duration is preserved when retiming. Browser pitch preservation is used during forward playback.</div>')+section('waveform','Analysis','<button class="block-button" data-inspector-action="waveform">Analyze audio waveform</button><div class="inspector-note">Min/max envelopes are computed in a worker from decoded audio, not generated placeholders. Analysis is limited to 80 MB source files.</div>');
    }else if(this.inspectorTab==='text'){
      if(c.lane!=='title')html+='<div class="inspector-empty">Select a title to edit its typography.<br><button class="block-button" data-action="title">Add a connected title</button></div>';
      else{
        html+=section('text','Title',`<div class="property-wide"><label>Text</label><textarea data-title="text" rows="3" aria-label="Title text">${esc(c.title.text)}</textarea></div><div class="property-wide"><label>Subtitle</label><textarea data-title="subtitle" rows="2" aria-label="Subtitle">${esc(c.title.subtitle)}</textarea></div><div class="property"><label>Style</label><select data-title="style" aria-label="Title style">${['cinematic','basic','lower'].map(s=>`<option value="${s}" ${s===c.title.style?'selected':''}>${{cinematic:'Cinematic',basic:'Basic',lower:'Lower third'}[s]}</option>`).join('')}</select></div><div class="property"><label>Typeface</label><select data-title="font" aria-label="Title font">${['Arial','Georgia','Verdana','Courier New'].map(f=>`<option ${f===c.title.font?'selected':''}>${f}</option>`).join('')}</select></div><div class="property"><label>Size</label><input type="number" min="8" max="300" value="${c.title.size}" data-title="size" aria-label="Title font size"><span class="unit">px</span></div><div class="property"><label>Color</label><input type="color" value="${esc(c.title.color)}" data-title="color" aria-label="Title color" style="width:55px;height:24px;padding:2px"></div><div class="property"><label>Alignment</label><select data-title="align" aria-label="Title alignment">${['left','center','right'].map(a=>`<option ${a===c.title.align?'selected':''}>${a}</option>`).join('')}</select></div><div class="inspector-note">Alignment affects the Basic title style. Cinematic and Lower third use their own typographic layout.</div>`);
        html+=section('text-position','Placement',number('x','Position X',-1920,1920,1,'px')+number('y','Position Y',-1080,1080,1,'px')+number('scale','Scale',1,500,1,'%',true)+number('opacity','Opacity',0,100,1,'%',true));
        html+=section('title-fade','Animation',audioField('fadeIn','Fade in',c.fadeIn/p.fps,0,c.duration/p.fps,.05,'s')+audioField('fadeOut','Fade out',c.fadeOut/p.fps,0,c.duration/p.fps,.05,'s'),false);
      }
    }
    host.innerHTML=html;
  }
  setFX(c,key,value){
    if(!c)return;const local=clamp(Math.round(this.frame-c.start),0,c.duration-1);
    if(c.keyframes[key]?.length){let k=c.keyframes[key].find(k=>k.frame===local);if(k)k.value=value;else c.keyframes[key].push({frame:local,value});c.keyframes[key].sort((a,b)=>a.frame-b.frame);}else c.fx[key]=value;
  }
  inspectorChange(e){
    const input=e.target,c=this.selectedClip();if(!c)return;this.pause();this.sourceMode=false;
    try{
      if(input.matches('input[type=range][data-fx]')){this.editor.endGesture();this.inspectorEditing=false;this.renderInspector();return;}
      this.inspectorEditing=true;
      if(input.dataset.fx){const value=clamp(+input.value,+input.min,+input.max);if(!Number.isFinite(value))throw new Error('Enter a finite numeric value.');this.editor.transact('Adjust '+input.dataset.fx,p=>this.setFX(p.clips.find(x=>x.id===c.id),input.dataset.fx,value));}
      else if(input.dataset.title){const key=input.dataset.title,value=key==='size'?clamp(+input.value,8,300):input.value;this.editor.transact('Edit title',p=>{const clip=p.clips.find(x=>x.id===c.id);clip.title[key]=value;if(key==='text')clip.name=String(value).split('\n')[0]||'Title';});}
      else if(input.dataset.clip){const key=input.dataset.clip;this.editor.transact('Adjust '+key,p=>{
        const clip=p.clips.find(x=>x.id===c.id);
        if(key==='enabled')clip.enabled=input.checked;
        else if(key==='transition'){if(clip.lane!=='primary'&&input.value==='dissolve')throw new Error('Cross dissolves require a primary-storyline clip.');clip.transition=input.value;}
        else{const value=clamp(+input.value,+input.min,+input.max);if(!Number.isFinite(value))throw new Error('Enter a finite numeric value.');if(key==='speed'){clip.duration=Math.max(1,Math.floor(clip.duration*clip.speed/value));clip.speed=value;}else if(key==='fadeIn'||key==='fadeOut')clip[key]=Math.round(value*p.fps);else clip[key]=value;}
      });}
    }catch(error){this.editor.cancelGesture();this.toast(error.message);}
    finally{this.inspectorEditing=false;this.renderInspector();}
  }
  inspectorClick(e){
    const c=this.selectedClip();if(!c)return;const key=e.target.closest('[data-keyframe]')?.dataset.keyframe;
    if(key){const local=clamp(Math.round(this.frame-c.start),0,c.duration-1),value=evaluatedFX(c,this.frame)[key];this.editor.transact('Toggle keyframe',p=>{const clip=p.clips.find(x=>x.id===c.id);const keys=clip.keyframes[key]||[];const k=keys.findIndex(x=>x.frame===local);if(k>=0)keys.splice(k,1);else keys.push({frame:local,value});clip.keyframes[key]=keys.sort((a,b)=>a.frame-b.frame);});return;}
    const action=e.target.closest('[data-inspector-action]')?.dataset.inspectorAction;
    if(action==='reset')this.editor.transact('Reset clip effects',p=>{const clip=p.clips.find(x=>x.id===c.id);clip.fx={...DEFAULT_FX};clip.keyframes={};clip.gainDb=0;clip.fadeIn=0;clip.fadeOut=0;clip.transition='none';});
    if(action==='looks'){$('effectsPanel').hidden=false;$('effectsButton').classList.add('active');}
    if(action==='clear-keyframes')this.editor.update(c.id,{keyframes:{}});
    if(action==='waveform'){const a=this.editor.project.assets.find(a=>a.id===c.assetId);if(a){this.toast('Decoding audio and calculating the waveform…');this.media.waveform(a).then(peaks=>this.toast(peaks?'Waveform analyzed.':'No decodable audio track was found, or the 80 MB analysis limit was exceeded.')).catch(e=>this.toast(e.message));}}
  }
  showMenu(items,x,y){
    const popup=$('menuPopup');popup.replaceChildren();
    for(const item of items){if(!item){const line=document.createElement('div');line.className='menu-separator';popup.append(line);continue;}
      const [label,action,key]=item;const button=document.createElement('button');button.className='menu-item';button.innerHTML=`<span>${esc(label)}</span><span class="menu-key">${esc(key||'')}</span>`;
      button.onclick=e=>{e.stopPropagation();popup.hidden=true;this.action(action).catch(err=>this.toast(err.message));};popup.append(button);
    }
    popup.hidden=false;popup.style.left=Math.min(x,innerWidth-popup.offsetWidth-8)+'px';popup.style.top=Math.min(y,innerHeight-popup.offsetHeight-8)+'px';
  }
  openMenu(name,x,y){const menus={
    file:[['New project…','new','⌘N'],['Open project…','open','⌘O'],null,['Import media…','import','⌘I'],['Import captions…','import-srt',''],['Relink media…','relink',''],null,['Save portable project','save','⌘S'],['Save reference project','save-reference','⇧⌘S'],null,['Export video…','export',''],['Export current frame','snapshot',''],['Export captions (SRT)','export-srt',''],['Export cut list (EDL)','export-edl','']],
    edit:[['Undo','undo','⌘Z'],['Redo','redo','⇧⌘Z'],null,['Duplicate selected','duplicate','⌘D'],['Enable / disable','enable','V'],['Detach connection','detach',''],['Delete selected','delete','⌫'],null,['Select all clips','select-all','⌘A']],
    trim:[['Blade at playhead','split','⌘B'],['Trim start to playhead','trim-start',''],['Trim end to playhead','trim-end',''],null,['Append media','append','E'],['Insert media','insert','W'],['Connect media','connect','Q'],null,['Mark source in','range-in','I'],['Mark source out','range-out','O'],['Clear source range','range-clear',''],null,['Add dissolve','dissolve','']],
    view:[['Show / hide browser','browser',''],['Show / hide inspector','inspector',''],['Effects browser','effects',''],['Timeline index','index',''],null,['Fit timeline','fit','⇧Z'],['Safe-area guides','guides',''],['Fullscreen viewer','fullscreen',''],['Reset workspace','reset-layout','']],
    help:[['Keyboard shortcuts','shortcuts','?'],['About Frameforge','about',''],['Engine & limitations','engine-info','']]
  };this.showMenu(menus[name]||[],x,y);}
  dialog(title,body,buttons,eyebrow='FRAMEFORGE'){
    $('dialogTitle').textContent=title;$('dialogEyebrow').textContent=eyebrow;$('dialogBody').innerHTML=body;$('dialogActions').replaceChildren();
    for(const {label,primary,action} of buttons){const button=document.createElement('button');button.type='button';button.className=primary?'primary':'';button.textContent=label;button.onclick=async()=>{try{await action();}catch(e){this.toast(e.message);}};$('dialogActions').append(button);}
    if(!$('dialog').open)$('dialog').showModal();
  }
  shortcuts(){this.dialog('Stay in the flow.',`<p class="dialog-copy">The essentials, right at your fingertips. Use Ctrl in place of ⌘ on Windows and Linux.</p><div class="shortcut-grid">${SHORTCUTS.map(([label,key])=>`<div class="shortcut-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`,[{label:'Back to the edit',primary:true,action:()=>$('dialog').close()}],'KEYBOARD SHORTCUTS');}
  settings(isNew=false){
    const p=this.editor.project;
    this.dialog(isNew?'A new story.':'Project settings',`<p class="dialog-copy">${isNew?'Create a clean timeline. The current workspace will be replaced; save a portable project first to keep a separate copy.':'The timeline uses integer, non-drop frames. Frame rate is locked once clips have been added.'}</p><div class="dialog-field"><label for="settingName">Project name</label><input id="settingName" value="${isNew?'Untitled project':esc(p.name)}" maxlength="150"></div><div class="dialog-field"><label for="settingSize">Frame size</label><select id="settingSize"><option value="1920,1080">1920 × 1080 · Landscape</option><option value="1080,1920">1080 × 1920 · Vertical</option><option value="1080,1080">1080 × 1080 · Square</option><option value="3840,2160">3840 × 2160 · UHD</option></select></div><div class="dialog-field"><label for="settingFps">Frame rate</label><select id="settingFps" ${!isNew&&p.clips.length?'disabled':''}>${[24,25,30,60].map(n=>`<option value="${n}" ${n===p.fps?'selected':''}>${n} fps</option>`).join('')}</select></div>`,[{label:'Cancel',action:()=>$('dialog').close()},{label:isNew?'Create project':'Apply settings',primary:true,action:async()=>{const name=$('settingName').value.trim()||'Untitled project';const [width,height]=$('settingSize').value.split(',').map(Number);const fps=+$('settingFps').value;if(isNew){await this.loadProject({format:'frameforge-project',version:1,name,width,height,fps,assets:[],clips:[],markers:[]});}else this.editor.transact('Project settings',p=>Object.assign(p,{name,width,height,fps}));this.renderer.resize(1280,Math.round(1280*height/width));this.fitViewer();$('dialog').close();}}]);
    if(!isNew)$('settingSize').value=`${p.width},${p.height}`;
    $('settingName').focus();$('settingName').select();
  }
  exportDialog(){
    this.pause();this.sourceMode=false;const p=this.editor.project,formats=supportedFormats();
    if(!formats.length){this.toast('No supported MediaRecorder video encoder is available in this browser. Frame and project export remain available.');return;}
    this.dialog('Ready for the big screen.',`<div class="export-preview"><strong>${esc(p.name.split(' — ')[0]).toUpperCase()}</strong><span>${timecode(duration(p),p.fps)} &nbsp; / &nbsp; ${p.fps} FPS &nbsp; / &nbsp; ${p.width} × ${p.height}</span></div><div class="dialog-field"><label for="exportFormat">Format</label><select id="exportFormat">${formats.map(f=>`<option value="${f.mime}">${f.name}</option>`).join('')}</select></div><div class="dialog-field"><label for="exportSize">Resolution</label><select id="exportSize">${[1920,1280,640].map(w=>`<option value="${w}">${w} × ${Math.round(w*p.height/p.width)}${w===1280?' · Recommended':''}</option>`).join('')}</select></div><div class="dialog-field"><label for="exportBitrate">Video bitrate</label><select id="exportBitrate"><option value="12000000">12 Mbps · High quality</option><option value="6000000">6 Mbps · Balanced</option><option value="24000000">24 Mbps · Maximum</option></select></div><div class="export-note">Real-time browser recording, including the composited picture, titles, transitions, and mixed audio. Keep this tab visible until completion. Export takes approximately the duration of your film; it is not an offline, frame-guaranteed mastering encoder.</div>`,[{label:'Cancel',action:()=>$('dialog').close()},{label:'Export film',primary:true,action:async()=>{
      const width=+$('exportSize').value,height=Math.round(width*p.height/p.width),mime=$('exportFormat').value,bitrate=+$('exportBitrate').value;
      this.dialog('Your story is rendering.',`<div class="export-preview"><strong>${esc(p.name.split(' — ')[0]).toUpperCase()}</strong><span>${width} × ${height} &nbsp; / &nbsp; ${p.fps} FPS</span></div><div class="export-progress"><span id="exportProgressFill"></span></div><div class="progress-caption"><span id="exportProgressText">Preparing media…</span><span id="exportElapsed">0 s</span></div><div class="export-note">Keep this tab visible. The resulting file will be saved when recording completes. Audio monitoring volume does not change the export mix.</div>`,[{label:'Cancel export',action:()=>this.exporter.cancel()}],'EXPORT IN PROGRESS');
      document.body.classList.add('body-exporting');
      try{const blob=await this.exporter.start({width,height,mime,bitrate},(progress,seconds)=>{if($('exportProgressFill'))$('exportProgressFill').style.width=progress*100+'%';if($('exportProgressText'))$('exportProgressText').textContent=Math.round(progress*100)+'% complete';if($('exportElapsed'))$('exportElapsed').textContent=seconds.toFixed(0)+' s';});$('dialog').close();this.toast(`Film exported · ${(blob.size/1024/1024).toFixed(1)} MB`);}
      catch(e){$('dialog').close();this.toast(e.name==='AbortError'?'Export cancelled.':`Export failed: ${e.message}`);}
      finally{document.body.classList.remove('body-exporting');}
    }}],'SHARE YOUR STORY');$('exportSize').value='1280';
  }
  async loadProject(project){
    validateProject(project);this.pause();this.sourceMode=false;this.frame=0;this.sourceFrame=0;this.ranges.clear();this.selection.clear();
    for(const [id,e]of this.media.entries)this.media.release(id,e);
    for(const url of this.media.urls.values())if(url.startsWith('blob:'))URL.revokeObjectURL(url);
    this.media.urls.clear();this.media.blobs.clear();this.media.images.clear();this.media.peaks.clear();
    this.editor.replace(project);await this.media.setProject(this.editor.project);this.selectedAsset=project.assets[0]?.id||null;
    this.selection=new Set(project.clips.filter(c=>c.lane==='primary').slice(0,1).map(c=>c.id));
    this.updateAll();this.timeline.fit();this.scheduleSave();
    try{await this.media.prepare(renderPlan(project,0),project);}catch(e){this.toast(e.message);}this.dirty=true;
  }
  async importFiles(files,addToTimeline=false,frame=this.frame){
    if(this.importing||this.exporter.running){this.toast('Wait for the current operation to finish.');return;}
    this.importing=true;this.pause();const list=Array.from(files);let count=0,failures=[];
    try{
      for(const file of list){
        this.toast(`Importing ${file.name}…`);
        try{
          if(file.size>2*1024**3)throw new Error('The per-file import limit is 2 GB.');
          if(file.name.toLowerCase().endsWith('.srt')){this.importCaptions(await file.text());count++;continue;}
          const a=await this.media.import(file);this.editor.addAsset(a);this.selectedAsset=a.id;count++;
          if(addToTimeline){const id=this.editor.append(a.id,a.kind==='audio'?'audio':'primary',frame);this.select(id);}
          if(a.kind==='audio')this.media.waveform(a).catch(()=>{});
        }catch(e){failures.push(`${file.name}: ${e.message}`);}
      }
      this.collection='imported';this.browserTab='media';this.renderBrowser();this.updateLabels();
      this.toast(`${count} media item${count===1?'':'s'} imported.${failures.length?' '+failures.join(' · '):' Double-click to append, or drag into the timeline.'}`);
    }finally{this.importing=false;}
  }
  async relink(file){
    const c=this.selectedClip();const id=this.relinkId||c?.assetId||this.selectedAsset;const old=this.editor.project.assets.find(a=>a.id===id);
    if(!old){this.toast('Select an offline media item or a clip to relink.');return;}
    try{
      const fresh=await this.media.import(file);if(fresh.kind!==old.kind)throw new Error(`Choose a ${old.kind} file to match the original media.`);
      this.editor.transact('Relink media',p=>{const i=p.assets.findIndex(a=>a.id===id);p.assets[i]={...fresh,id,name:old.name,favorite:old.favorite};});
      await this.storage.put('media',id,file);const oldUrl=this.media.urls.get(id);if(oldUrl?.startsWith('blob:'))URL.revokeObjectURL(oldUrl);
      this.media.urls.set(id,URL.createObjectURL(file));this.media.blobs.set(id,file);this.media.images.delete(id);this.media.missing.delete(id);
      for(const [cid,e]of this.media.entries)if(e.assetId===id)this.media.release(cid,e);
      if(fresh.kind==='image')await this.media.loadImage(id);this.media.assets.set(id,this.editor.project.assets.find(a=>a.id===id));this.updateAll();this.toast('Media relinked.');
    }catch(e){this.toast('Relink failed: '+e.message);}finally{this.relinkId=null;}
  }
  addMedia(mode,assetId=this.selectedAsset){
    this.pause();this.sourceMode=false;try{
      let id;const range=this.rangeFor(assetId);
      if(mode==='insert')id=this.editor.insert(assetId,this.frame,range);
      else id=this.editor.append(assetId,mode==='connect'?'overlay':'primary',this.frame,range);
      this.select(id);this.toast(mode==='connect'?'Connected clip added.':mode==='insert'?'Clip inserted into the storyline.':'Clip appended.');
    }catch(e){this.toast(e.message);}
  }
  importCaptions(text){
    const captions=parseSRT(text,this.editor.project.fps);
    this.editor.transact('Import captions',p=>{for(const caption of captions){const c=makeClip({id:null,name:caption.text.split('\n')[0]||'Caption',kind:'image'},'title',caption.start,p.fps,caption.duration);c.title={style:'basic',text:caption.text,subtitle:'',size:48,color:'#ffffff',font:'Arial',align:'center'};c.fx.y=350;attach(p,c);p.clips.push(c);}});this.toast(`${captions.length} captions imported as editable title clips.`);
  }
  async action(action){
    if(this.exporter?.running && !['shortcuts','about'].includes(action))return;
    const selected=()=>[...this.selection];const p=this.editor.project;
    switch(action){
      case 'import':$('mediaInput').click();break;
      case 'open':$('projectInput').click();break;
      case 'new':this.pause();this.settings(true);break;
      case 'settings':this.pause();this.settings();break;
      case 'save':this.toast('Preparing a portable project, including imported media…');download(await portableProject(p,this.media),safeName(p.name)+'.frameforge');this.sessionUnsaved=false;this.toast('Portable project saved. Imported source files are embedded.');break;
      case 'save-reference':download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),safeName(p.name)+'.frameforge.json');this.toast('Reference project saved. Imported media remain in this browser; relink them when moving to another device.');break;
      case 'undo':this.pause();this.editor.undo();break;
      case 'redo':this.pause();this.editor.redo();break;
      case 'play':await this.play();break;
      case 'frame-back':case 'frame-forward':{const delta=action==='frame-back'?-1:1;if(this.sourceMode){this.pause();this.sourceFrame=clamp(this.sourceFrame+delta,0,(this.sourceClip()?.duration||1)-1);this.dirty=true;this.updateLabels();}else this.seek(this.frame+delta);break;}
      case 'previous-edit':case 'next-edit':{const points=[0,...p.clips.filter(c=>c.lane==='primary').map(c=>c.start),duration(p)-1].sort((a,b)=>a-b);this.seek(action==='next-edit'?points.find(x=>x>this.frame)??duration(p)-1:points.filter(x=>x<this.frame).at(-1)??0);break;}
      case 'append':case 'insert':case 'connect':this.addMedia(action);break;
      case 'split':{this.pause();this.sourceMode=false;const ids=selected().length?selected():p.clips.filter(c=>this.frame>c.start&&this.frame<c.start+c.duration).map(c=>c.id);const added=this.editor.split(ids,this.frame);this.toast(added.length?`Split ${added.length} clip${added.length>1?'s':''} at ${timecode(this.frame,p.fps)}.`:'The playhead must be inside a selected clip.');break;}
      case 'trim-start':case 'trim-end':{this.pause();const c=this.selectedClip();if(!c||this.frame<=c.start||this.frame>=c.start+c.duration)throw new Error('Move the playhead inside the selected clip.');this.editor.transact('Trim to playhead',p=>trimInPlace(p,c.id,action==='trim-start'?'left':'right',action==='trim-start'?this.frame-c.start:this.frame-c.start-c.duration));break;}
      case 'duplicate':this.pause();this.selection=new Set(this.editor.duplicate(selected()));this.updateAll();break;
      case 'delete':this.pause();this.editor.delete(selected());this.selection.clear();this.updateAll();break;
      case 'enable':this.pause();this.editor.transact('Toggle clip visibility',p=>p.clips.forEach(c=>{if(this.selection.has(c.id))c.enabled=!c.enabled;}));break;
      case 'detach':this.editor.transact('Detach connection',p=>p.clips.forEach(c=>{if(this.selection.has(c.id))delete c.anchor;}));this.toast('Selected connections detached. Clips now retain absolute timeline positions.');break;
      case 'select-all':this.selection=new Set(p.clips.map(c=>c.id));this.updateAll();break;
      case 'title':this.pause();this.select(this.editor.addTitle(this.frame,'basic','Your title'));break;
      case 'marker':{const frame=Math.round(this.frame);this.dialog('Mark this moment.',`<div class="dialog-field"><label for="markerName">Marker name</label><input id="markerName" value="Marker ${p.markers.length+1}" maxlength="120"></div><p class="dialog-copy">At ${timecode(frame,p.fps)}. Markers appear in the timeline index; right-click an index marker to remove it.</p>`,[{label:'Cancel',action:()=>$('dialog').close()},{label:'Add marker',primary:true,action:()=>{this.editor.marker(frame,$('markerName').value||'Marker');$('dialog').close();}}]);$('markerName').focus();$('markerName').select();break;}
      case 'favorite':if(this.selectedAsset)this.editor.transact('Toggle favorite',p=>{const a=p.assets.find(a=>a.id===this.selectedAsset);if(a)a.favorite=!a.favorite;});break;
      case 'range-in':case 'range-out':{const a=p.assets.find(a=>a.id===this.selectedAsset);if(!a)throw new Error('Select a media item first.');const max=Math.max(1,Math.round(a.duration*p.fps)),range=this.ranges.get(a.id)||{in:0,out:max};if(action==='range-in')range.in=Math.min(this.sourceFrame,range.out-1);else range.out=Math.max(range.in+1,Math.min(max,this.sourceFrame+1));this.ranges.set(a.id,range);this.updateLabels();this.toast(`Source range: ${range.out-range.in} frames. Append, insert, or connect to use it.`);break;}
      case 'range-clear':this.ranges.delete(this.selectedAsset);this.updateLabels();break;
      case 'source-toggle':this.pause();this.sourceMode=!this.sourceMode;this.dirty=true;this.updateLabels();break;
      case 'timeline':this.pause();this.sourceMode=false;this.dirty=true;this.updateLabels();break;
      case 'browser':$('workspace').classList.toggle('hide-browser');document.querySelector('[data-action="browser"]').classList.toggle('active',!$('workspace').classList.contains('hide-browser'));this.fitViewer();break;
      case 'inspector':$('workspace').classList.toggle('hide-inspector');document.querySelector('[data-action="inspector"]').classList.toggle('active',!$('workspace').classList.contains('hide-inspector'));this.fitViewer();break;
      case 'effects':$('effectsPanel').hidden=!$('effectsPanel').hidden;$('effectsButton').classList.toggle('active',!$('effectsPanel').hidden);this.timeline.draw();break;
      case 'index':$('timelineIndex').hidden=!$('timelineIndex').hidden;this.timeline.draw();break;
      case 'grid':$('mediaGrid').classList.toggle('list-view');break;
      case 'guides':this.guides=!this.guides;$('safeGuides').hidden=!this.guides;break;
      case 'snapping':this.timeline.snapping=!this.timeline.snapping;$('snapButton').classList.toggle('active',this.timeline.snapping);break;
      case 'magnetic':this.timeline.magnetic=!this.timeline.magnetic;$('magnetButton').classList.toggle('active',this.timeline.magnetic);this.updateLabels();this.toast(this.timeline.magnetic?'Magnetic storyline enabled.':'Position mode: dragging a storyline clip lifts it to a connected layer. The primary storyline stays gapless.');break;
      case 'fit':this.timeline.fit();break;
      case 'zoom-in':this.timeline.setZoom(this.timeline.pps*1.25);break;
      case 'zoom-out':this.timeline.setZoom(this.timeline.pps/1.25);break;
      case 'mute':this.media.setMute(!this.media.monitorMuted);$('muteButton').innerHTML=icon(this.media.monitorMuted?'mute':'volume',14);break;
      case 'goto':this.dialog('Go to timecode',`<div class="dialog-field"><label for="gotoTime">HH:MM:SS:FF</label><input id="gotoTime" value="${timecode(this.frame,p.fps)}" aria-label="Go to timecode"></div>`,[{label:'Cancel',action:()=>$('dialog').close()},{label:'Go',primary:true,action:()=>{this.seek(parseTimecode($('gotoTime').value,p.fps));$('dialog').close();}}]);$('gotoTime').focus();$('gotoTime').select();break;
      case 'fullscreen':if(document.fullscreenElement)await document.exitFullscreen();else await $('canvasHost').requestFullscreen();break;
      case 'reset-layout':$('workspace').className='workspace';$('effectsPanel').hidden=true;$('timelineIndex').hidden=true;document.documentElement.style.removeProperty('--timeline-height');$('effectsButton').classList.remove('active');for(const name of ['browser','inspector'])document.querySelector(`[data-action="${name}"]`).classList.add('active');this.timeline.fit();break;
      case 'dissolve':this.applyEffect('dissolve');break;
      case 'export':this.exportDialog();break;
      case 'snapshot':await this.exporter.framePNG();this.toast('Current composited frame saved as PNG.');break;
      case 'export-srt':download(new Blob([exportSRT(p)],{type:'text/plain;charset=utf-8'}),safeName(p.name)+'.srt');this.toast('Editable titles exported as SRT captions.');break;
      case 'export-edl':download(new Blob([exportEDL(p)],{type:'text/plain;charset=utf-8'}),safeName(p.name)+'.edl');this.toast('Primary storyline exported as a cuts-only CMX 3600 EDL. Effects, titles, and audio layers are not included.');break;
      case 'import-srt':$('srtInput').click();break;
      case 'relink':this.relinkId=this.sourceMode?this.selectedAsset:this.selectedClip()?.assetId||this.selectedAsset;$('relinkInput').click();break;
      case 'shortcuts':this.shortcuts();break;
      case 'about':this.dialog('Meet Frameforge.',`<div class="about-name"><img src="${assetURL('assets/icon.svg')}" alt=""><div><h3>Frameforge</h3><p>Your story. Every frame.</p></div></div><p class="about-features">A framework-free, local-first nonlinear video editor. A magnetic primary storyline, connected clips, real media playback, editable titles, keyframed effects, and an actual WebGPU compositor.</p><p class="dialog-copy">Demo: original rendered camera moves using NASA Earth Observatory’s Blue Marble texture, plus an original synthesized score. These are CGI camera moves, not spacecraft footage. No media is uploaded. Source code is MIT licensed; NASA image credits are included in THIRD_PARTY_NOTICES.md.</p><p class="dialog-copy">Version 1.0 · Independent project. Not affiliated with Apple, and not a complete implementation of Final Cut Pro.</p>`,[{label:'Back to the edit',primary:true,action:()=>$('dialog').close()}]);break;
      case 'engine-info':this.dialog('Under the hood.',`<p class="about-features">Renderer: <strong>${esc(this.renderer.kind)}</strong><br>Frame-based edit kernel · 80-step command history<br>GPU video textures · Cached title textures<br>Worker min/max audio envelopes · Web Audio mix bus<br>IndexedDB source storage · Portable project files</p><p class="dialog-copy">GPU timings in the status bar measure CPU submission time, not GPU execution time. Playback decodes through browser media elements; source-frame delivery is not guaranteed for arbitrary VFR footage. Cross dissolves use source handles, or hold the outgoing final frame when handles are exhausted.</p><p class="dialog-copy">The pipeline is SDR; it is not a calibrated Rec.709/ACES/HDR mastering pipeline. Canvas fallback approximates color grading. Export is real-time MediaRecorder recording and may drop frames under load. There is no ProRes, RAW, optical flow, multicam, object tracking, plug-in host, or FCPXML import.</p>`,[{label:'Got it',primary:true,action:()=>$('dialog').close()}],'ENGINE CONTRACT');break;
    }
  }
  keydown(e){
    if(e.key==='Escape'){$('menuPopup').hidden=true;if(this.editor.gesture){this.editor.cancelGesture();this.inspectorEditing=false;this.timeline.cancelDrag();this.renderInspector();}return;}
    if(e.target.closest('input,textarea,select,[contenteditable=true]')||$('dialog').open||this.exporter.running)return;
    const key=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;let action=null;
    if(mod){action=({s:e.shiftKey?'save-reference':'save',o:'open',n:'new',i:'import',z:e.shiftKey?'redo':'undo',y:'redo',b:'split',d:'duplicate',t:'title',a:'select-all'})[key];}
    else{
      action=({' ':'play',arrowleft:'frame-back',arrowright:'frame-forward',arrowup:'previous-edit',arrowdown:'next-edit',delete:'delete',backspace:'delete',e:'append',w:'insert',q:'connect',i:'range-in',o:'range-out',v:'enable',n:'snapping',m:'marker',f:'favorite','?':'shortcuts','+':'zoom-in','=':'zoom-in','-':'zoom-out'})[key];
      if(e.shiftKey&&key==='z')action='fit';
      if(['a','b','h'].includes(key)){e.preventDefault();this.timeline.setTool({a:'select',b:'blade',h:'hand'}[key]);return;}
      if(key==='home'){e.preventDefault();this.seek(0);return;}if(key==='end'){e.preventDefault();this.seek(duration(this.editor.project)-1);return;}
      if(key==='k'){e.preventDefault();this.pause();return;}
      if(key==='j'||key==='l'){e.preventDefault();const sign=key==='j'?-1:1;const rate=this.playing&&Math.sign(this.rate)===sign?sign*Math.min(4,Math.abs(this.rate)*2):sign;this.play(rate,true).catch(err=>this.toast(err.message));return;}
    }
    if(action){e.preventDefault();this.action(action).catch(err=>this.toast(err.message));}
  }
}
const app=new App();window.frameforge=app;
app.ready.catch(error=>{console.error(error);$('saveState').textContent='Initialization failed';$('toast').textContent='Could not start Frameforge: '+error.message;$('toast').classList.add('visible');});
