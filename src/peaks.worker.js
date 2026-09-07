// Decimated min/max envelopes. Transfer channels rather than cloning decoded PCM.
self.onmessage=({data:{id,channels,bins=512}})=>{
  const length=channels[0]?.length||0;const peaks=new Float32Array(bins*2);
  for(let b=0;b<bins;b++){
    let lo=0,hi=0;const start=Math.floor(b*length/bins),end=Math.floor((b+1)*length/bins);
    for(let i=start;i<end;i++){let v=0;for(const c of channels)v+=c[i]||0;v/=channels.length;lo=Math.min(lo,v);hi=Math.max(hi,v);}
    peaks[b*2]=lo;peaks[b*2+1]=hi;
  }
  self.postMessage({id,peaks},[peaks.buffer]);
};
