import {clamp, evaluatedFX, DEFAULT_FX} from './core.js';

// Uniform ABI: four aligned vec4<f32>, 64 bytes. Distinct per-layer buffers avoid
// queue.writeBuffer hazards when several layers are encoded before submission.
const shader = external => `
struct Params { transform: vec4f, grade: vec4f, misc: vec4f, crop: vec4f };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var tex: ${external?'texture_external':'texture_2d<f32>'};
struct Varying { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32) -> Varying {
  let points=array<vec2f,6>(vec2f(-1,1),vec2f(-1,-1),vec2f(1,1),vec2f(1,1),vec2f(-1,-1),vec2f(1,-1));
  let uvs=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1));
  let v=points[i]*p.transform.xy;
  let ca=cos(p.misc.z);let sa=sin(p.misc.z);let aspect=p.misc.w;
  let rotated=vec2f(v.x*ca-v.y*sa/aspect,v.x*sa*aspect+v.y*ca);
  var out:Varying;out.position=vec4f(rotated+p.transform.zw,0,1);out.uv=uvs[i];return out;
}
@fragment fn fs(in:Varying)->@location(0) vec4f {
  let sample=${external?'textureSampleBaseClampToEdge(tex,s,in.uv)':'textureSample(tex,s,in.uv)'};
  if(in.uv.x<p.crop.x || in.uv.y<p.crop.y || in.uv.x>1-p.crop.z || in.uv.y>1-p.crop.w){discard;}
  var rgb=sample.rgb*exp2(p.grade.x);
  rgb=(rgb-vec3f(.5))*p.grade.y+vec3f(.5);
  let luma=dot(rgb,vec3f(.2126,.7152,.0722));rgb=mix(vec3f(luma),rgb,p.grade.z);
  rgb+=vec3f(.12,.025,-.12)*p.grade.w;
  let d=distance(in.uv,vec2f(.5));rgb*=1-p.misc.y*smoothstep(.22,.72,d);
  return vec4f(clamp(rgb,vec3f(0),vec3f(1)),sample.a*p.misc.x);
}`;

export class Compositor {
  constructor(host, onStatus=()=>{}){
    this.host=host;this.onStatus=onStatus;this.canvas=document.createElement('canvas');
    this.canvas.id='programCanvas';this.canvas.width=1280;this.canvas.height=720;host.prepend(this.canvas);
    this.kind='initializing';this.resources=new Map();this.textCache=new Map();this.disposed=false;this.frameCount=0;
    this.lastMs=0;this.generation=0;
  }
  async init(){
    try{
      if(new URLSearchParams(location.search).get('renderer')==='canvas')throw new Error('Canvas requested');
      if(!navigator.gpu)throw new Error('WebGPU unavailable');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if(!adapter)throw new Error('No WebGPU adapter');
      this.device=await adapter.requestDevice();
      this.context=this.canvas.getContext('webgpu');
      if(!this.context)throw new Error('No WebGPU canvas');
      this.format=navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
      this.sampler=this.device.createSampler({minFilter:'linear',magFilter:'linear'});
      this.pipelines={};
      for(const external of [false,true]){
        const module=this.device.createShaderModule({label:external?'External video compositor':'Image and title compositor',code:shader(external)});
        const info=await module.getCompilationInfo();
        const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
        this.pipelines[external?'video':'image']=await this.device.createRenderPipelineAsync({label:'Frameforge layer pipeline',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
      }
      this.device.addEventListener('uncapturederror',e=>{console.error('WebGPU validation:',e.error);this.onStatus('WebGPU error',e.error.message);});
      this.device.lost.then(info=>{if(!this.disposed){this.fallback(`GPU device lost: ${info.message}`);this.onInvalidate?.();}});
      this.kind='WebGPU';this.onStatus(this.kind,adapter.info?.description||'Hardware compositor');
    }catch(e){this.fallback(e.message);}
    return this;
  }
  fallback(reason){
    // A canvas that has acquired a WebGPU context cannot subsequently acquire 2D.
    if(this.context){const next=document.createElement('canvas');next.id=this.canvas.id;next.width=this.canvas.width;next.height=this.canvas.height;this.canvas.replaceWith(next);this.canvas=next;this.context=null;}
    this.ctx=this.canvas.getContext('2d',{alpha:false});this.kind='Canvas 2D';this.onStatus(this.kind,reason);this.generation++;
  }
  resize(width,height){width=Math.round(width);height=Math.round(height);if(this.canvas.width===width&&this.canvas.height===height)return;this.canvas.width=width;this.canvas.height=height;this.textCache.clear();this.onInvalidate?.();}
  titleSource(c){
    const title=c.title;const w=this.canvas.width,h=this.canvas.height;
    const key=JSON.stringify([title,w,h]);const cached=this.textCache.get(c.id);if(cached?.key===key)return cached.canvas;
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');
    const k=w/1920;const size=title.size*k;const style=title.style;
    ctx.fillStyle=title.color||'#ffffff';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=12*k;
    if(style==='cinematic'){
      ctx.textAlign='center';ctx.font=`500 ${Math.max(10,19*k)}px Arial`;ctx.letterSpacing=`${5*k}px`;
      ctx.fillText('A FRAMEFORGE ORIGINAL',w/2,h*.32);
      ctx.font=`300 ${size}px ${title.font||'Arial'}`;ctx.letterSpacing=`${20*k}px`;
      ctx.fillText(title.text,w/2,h*.48,w*.88);
      ctx.letterSpacing=`${7*k}px`;ctx.font=`400 ${23*k}px Arial`;ctx.fillText(title.subtitle||'',w/2,h*.62,w*.85);
      ctx.shadowBlur=0;ctx.globalAlpha=.7;ctx.fillRect(w/2-26*k,h*.71,52*k,1.5*k);
    }else if(style==='lower'){
      const x=w*.075,y=h*.78;ctx.textAlign='left';ctx.letterSpacing='0px';
      ctx.fillStyle='#a59af7';ctx.fillRect(x,y-30*k,3*k,95*k);ctx.fillStyle=title.color||'#ffffff';
      ctx.font=`500 ${size}px ${title.font||'Arial'}`;ctx.fillText(title.text,x+26*k,y,w*.83);
      ctx.font=`400 ${17*k}px Arial`;ctx.letterSpacing=`${2.5*k}px`;ctx.fillText(title.subtitle||'',x+26*k,y+48*k,w*.8);
    }else{
      ctx.textAlign=title.align||'center';ctx.letterSpacing='0px';ctx.font=`500 ${size}px ${title.font||'Arial'}`;
      const lines=title.text.split('\n');const x=title.align==='left'?w*.1:title.align==='right'?w*.9:w/2;
      lines.forEach((line,i)=>ctx.fillText(line,x,h*.5+(i-(lines.length-1)/2)*size*1.2,w*.85));
    }
    this.textCache.set(c.id,{key,canvas});if(this.textCache.size>80){const id=this.textCache.keys().next().value;this.textCache.delete(id);}
    return canvas;
  }
  params(layer, source){
    const c=layer.clip;const fx=evaluatedFX(c,layer.frame);const w=this.canvas.width,h=this.canvas.height;
    const sw=source.videoWidth||source.naturalWidth||source.width||w,sh=source.videoHeight||source.naturalHeight||source.height||h;
    const fit=Math.min(w/sw,h/sh),scale=clamp(fx.scale,1,1000)/100;
    const array=new Float32Array([sw*fit/w*scale,sh*fit/h*scale,2*fx.x/(this.projectWidth||1920),-2*fx.y/(this.projectHeight||1080),clamp(fx.exposure,-5,5),clamp(fx.contrast,0,300)/100,clamp(fx.saturation,0,300)/100,fx.temperature/100,clamp(fx.opacity/100*layer.opacity,0,1),clamp(fx.vignette/100,0,1),-fx.rotation*Math.PI/180,w/h,fx.cropL/100,fx.cropT/100,fx.cropR/100,fx.cropB/100]);
    return {fx,array,sw,sh,fit,scale};
  }
  render(layers,media){
    const start=performance.now();
    const prepared=[];
    for(const layer of layers){const source=layer.clip.lane==='title'?this.titleSource(layer.clip):media.source(layer.clip);if(source&&(source.readyState===undefined||source.readyState>=2))prepared.push({...layer,source});}
    if(this.kind==='WebGPU')this.renderGPU(prepared);else if(this.ctx)this.render2D(prepared);
    this.frameCount++;this.lastMs=performance.now()-start;
  }
  renderGPU(layers){
    const device=this.device;
    const encoder=device.createCommandEncoder({label:'Composite frame'});
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:.003,g:.004,b:.008,a:1},loadOp:'clear',storeOp:'store'}]});
    const alive=new Set();
    for(const layer of layers){
      const {source}=layer;const id=layer.clip.id;alive.add(id);
      const isVideo=source instanceof HTMLVideoElement;const pipe=this.pipelines[isVideo?'video':'image'];
      let res=this.resources.get(id);
      if(!res){res={buffer:device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};this.resources.set(id,res);}
      const params=this.params(layer,source);device.queue.writeBuffer(res.buffer,0,params.array);
      let texture;
      if(isVideo){try{texture=device.importExternalTexture({source});}catch{continue;}}
      else{
        if(res.source!==source||!res.texture){res.texture?.destroy();res.texture=device.createTexture({size:[params.sw,params.sh],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});device.queue.copyExternalImageToTexture({source},{texture:res.texture},[params.sw,params.sh]);res.source=source;res.bind=null;}
        texture=res.texture.createView();
      }
      // External texture bindings are task-scoped. Never cache them across rAF callbacks.
      const bind=(!isVideo&&res.bind)||device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:res.buffer}},{binding:1,resource:this.sampler},{binding:2,resource:texture}]});
      if(!isVideo)res.bind=bind;
      pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.draw(6);
    }
    pass.end();device.queue.submit([encoder.finish()]);
    // Keep GPU memory bounded to active layers plus a small reuse window.
    if(this.resources.size>32)for(const [id,res]of this.resources)if(!alive.has(id)){res.buffer.destroy();res.texture?.destroy();this.resources.delete(id);}
  }
  render2D(layers){
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;ctx.fillStyle='#010204';ctx.fillRect(0,0,w,h);
    for(const layer of layers){
      const {source}=layer;const {fx,sw,sh,fit,scale}=this.params(layer,source);const dw=sw*fit*scale,dh=sh*fit*scale;
      if(fx.cropL+fx.cropR>=100||fx.cropT+fx.cropB>=100)continue;
      ctx.save();ctx.globalAlpha=clamp(fx.opacity/100*layer.opacity,0,1);ctx.translate(w/2+fx.x*w/(this.projectWidth||1920),h/2+fx.y*h/(this.projectHeight||1080));ctx.rotate(fx.rotation*Math.PI/180);
      ctx.beginPath();ctx.rect(-dw/2+dw*fx.cropL/100,-dh/2+dh*fx.cropT/100,dw*(1-(fx.cropL+fx.cropR)/100),dh*(1-(fx.cropT+fx.cropB)/100));ctx.clip();
      ctx.filter=`brightness(${2**fx.exposure}) contrast(${fx.contrast}%) saturate(${fx.saturation}%)`;
      ctx.drawImage(source,-dw/2,-dh/2,dw,dh);ctx.filter='none';
      if(fx.temperature){ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=clamp(layer.opacity*fx.opacity/100,0,1)*Math.abs(fx.temperature)/100*.25;ctx.fillStyle=fx.temperature>0?'#ff9933':'#3388ff';ctx.fillRect(-dw/2,-dh/2,dw,dh);ctx.globalCompositeOperation='source-over';}
      if(fx.vignette){const g=ctx.createRadialGradient(0,0,dw*.15,0,0,dw*.64);g.addColorStop(0,'transparent');g.addColorStop(1,`rgba(0,0,0,${fx.vignette/100})`);ctx.globalAlpha=layer.opacity*fx.opacity/100;ctx.fillStyle=g;ctx.fillRect(-dw/2,-dh/2,dw,dh);}
      ctx.restore();
    }
  }
  async settled(){if(this.kind==='WebGPU')await this.device.queue.onSubmittedWorkDone();}
  dispose(){this.disposed=true;for(const res of this.resources.values()){res.buffer.destroy();res.texture?.destroy();}this.resources.clear();this.device?.destroy();}
}
