"""Reproducible, original Earth camera renders using NASA Blue Marble map data.
Requires NumPy, Pillow, SciPy, FFmpeg and the NASA bmng.jpg distributed by Basemap.
The generated music is an original synthesizer composition, with no third-party recording.
"""
from pathlib import Path
from PIL import Image, ImageOps
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
import subprocess, json, wave, argparse
from importlib.resources import files
ROOT=Path(__file__).parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--texture',type=Path,help='Path to a NASA Blue Marble equirectangular map image')
args=parser.parse_args()
if args.texture is None:
 try: args.texture=Path(str(files('mpl_toolkits.basemap_data')/'bmng.jpg'))
 except (ImportError,ModuleNotFoundError): parser.error('Provide --texture /path/to/bmng.jpg or install basemap-data.')
texture=Image.open(args.texture).convert('RGB')
texture.thumbnail((2160,1080))
tex=np.asarray(texture).astype(np.float32)/255
W,H=1280,720
rng=np.random.default_rng(2039)
y,x=np.mgrid[0:H,0:W].astype(np.float32)
background=np.zeros((H,W,3),np.float32)
background[:]=[.006,.009,.018]
for _ in range(700):
 sx,sy=rng.integers(0,W),rng.integers(0,H); v=rng.uniform(.1,.8)
 background[sy,sx]=[v*.83,v*.9,v]
background+=gaussian_filter(background,sigma=(1.7,1.7,0))*.3
for index,(name,cx,cy,r,lon,lat) in enumerate([
 ('orbit',800,610,570,20,15),('earthrise',850,1060,950,75,15),
 ('blue-marble',690,390,290,-25,10),('horizon',900,920,820,-90,25)]):
 nx=(x-cx)/r; ny=-(y-cy)/r
 rr=nx*nx+ny*ny; mask=rr<=1; nz=np.sqrt(np.maximum(0,1-rr))
 tilt=np.deg2rad(lat); Y=ny*np.cos(tilt)+nz*np.sin(tilt); Z=nz*np.cos(tilt)-ny*np.sin(tilt)
 u=(np.arctan2(nx,Z)+np.deg2rad(lon)+np.pi)/(2*np.pi)*(tex.shape[1]-1)
 v=(.5-np.arcsin(np.clip(Y,-1,1))/np.pi)*(tex.shape[0]-1)
 rgb=np.stack([map_coordinates(tex[:,:,c],[v,u%tex.shape[1]],order=1,mode='wrap') for c in range(3)],axis=-1)
 normal=np.stack([nx,ny,nz],axis=-1)
 sun=np.array([-.65,.57,.52]); sun/=np.linalg.norm(sun)
 diffuse=np.clip(np.einsum('ijk,k->ij',normal,sun),0,1)
 light=.022+.98*diffuse**.6
 rgb*=light[:,:,None]
 # Cloud structures are generated, not inferred observations.
 noise=gaussian_filter(rng.normal(size=(H,W)),9)
 noise=(noise-noise.mean())/noise.std()
 bands=np.sin(u*.029+np.cos(v*.042)*2)*.8+noise*.6
 cloud=np.clip(bands-.75,0,1)*.28
 rgb=rgb*(1-cloud[:,:,None])+cloud[:,:,None]*light[:,:,None]
 rim=(1-nz)**3*np.clip(diffuse+.05,0,1)
 rgb+=rim[:,:,None]*np.array([.05,.24,.51])
 rgb=np.clip(rgb*1.3,0,1)
 out=background.copy()
 out[mask]=rgb[mask]
 outer=np.exp(-np.maximum(0,np.sqrt(rr)-1)*120)*(~mask)
 out+=outer[:,:,None]*np.array([.08,.28,.52])*.7
 out=np.clip(out,0,1)
 Image.fromarray((out*255).astype(np.uint8)).save(ROOT/f'{name}.jpg',quality=93)
 # Real H.264 camera-move clips: 6 seconds, frame-intra-friendly GOP, no implied live footage.
 subprocess.run(['ffmpeg','-y','-loglevel','error','-loop','1','-i',str(ROOT/f'{name}.jpg'),
 '-vf',f"scale=1600:900,zoompan=z='1.0+on*0.00028':x='iw/2-iw/zoom/2+sin(on/120)*10':y='ih/2-ih/zoom/2':d=144:s=960x540:fps=24",'-frames:v','144','-c:v','libx264','-preset','fast','-crf','22','-g','24','-pix_fmt','yuv420p','-movflags','+faststart',str(ROOT/f'{name}.mp4')],check=True)
 print(name,flush=True)
# Original synth score in A minor: 24 seconds, quiet airy pads, a simple arpeggio.
sr=24000; duration=24; t=np.arange(sr*duration)/sr; L=np.zeros_like(t); R=np.zeros_like(t)
chords=[[110,164.8138,220,261.6256],[87.3071,130.8128,174.6141,220],[130.8128,196,261.6256,329.6276],[97.9989,146.8324,196,246.9417]]
for i,chord in enumerate(chords):
 tt=t-i*6; env=np.clip(tt/1.5,0,1)*np.clip((6.8-tt)/1.7,0,1); env[(tt<0)|(tt>6.8)]=0
 for j,f in enumerate(chord):
  tone=(np.sin(2*np.pi*f*t)+.16*np.sin(2*np.pi*f*2*t))*.065*env
  L+=tone;R+=(np.sin(2*np.pi*f*1.001*t+.1*j)+.16*np.sin(2*np.pi*f*2.001*t))*.065*env
for beat in range(48):
 start=beat*.5;tt=t-start; f=chords[min(3,beat//12)][beat%4]*4
 env=np.exp(-np.maximum(tt,0)*5)*(tt>=0)*(tt<2)
 tone=np.sin(2*np.pi*f*t)*env*.09
 L+=tone*(.6+.3*(beat%2));R+=tone*(.9-.3*(beat%2))
env=np.clip(t/2,0,1)*np.clip((duration-t)/3,0,1)
a=np.stack([L*env,R*env],axis=1)
with wave.open(str(ROOT/'weightless.wav'),'wb') as f:
 f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes((np.clip(a,-1,1)*32767).astype('<i2').tobytes())
peaks=[]
mono=np.mean(a,axis=1)
for chunk in np.array_split(mono,512): peaks.extend([float(chunk.min()),float(chunk.max())])
(ROOT/'waveform.json').write_text(json.dumps(peaks))
