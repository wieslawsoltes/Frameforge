import {validateProject,copy} from './core.js';
export class Storage {
  constructor(){this.db=null;this.lastError=null;this.pending=Promise.resolve();this.memory=new Map();}
  async open(){
    try{this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('frameforge-local-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('projects');r.result.createObjectStore('media');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
    catch(e){this.lastError=e;}
    return this;
  }
  async get(store,key){if(!this.db)return this.memory.get(store+':'+key)||null;return new Promise((resolve,reject)=>{const r=this.db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async put(store,key,value){if(!this.db){this.memory.set(store+':'+key,value);return;}return new Promise((resolve,reject)=>{const t=this.db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Storage write aborted.'));});}
  saveProject(project){const snapshot=copy(project);this.pending=this.pending.catch(()=>{}).then(()=>this.put('projects','autosave',snapshot));return this.pending;}
  async loadProject(){const p=await this.get('projects','autosave');return p?validateProject(p):null;}
}
export function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export const safeName=name=>name.replace(/[^\p{L}\p{N}\-_. ]/gu,'').trim().slice(0,100)||'Untitled';
export function readDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
export async function portableProject(p,media){
  const out=copy(p);out.embedded={};let total=0;
  for(const a of p.assets)if(!a.path){const blob=await media.blob(a.id);if(!blob)throw new Error(`Missing media: ${a.name}. Relink it before making a portable project.`);total+=blob.size;if(total>250*1024*1024)throw new Error('Portable projects are limited to 250 MB of media. The local autosave retains larger media; save a reference project instead.');out.embedded[a.id]=await readDataURL(blob);}
  return new Blob([JSON.stringify(out)],{type:'application/json'});
}
export async function unpackProject(file,storage){
  if(file.size>360*1024*1024)throw new Error('Project exceeds the 360 MB JSON safety limit.');
  const raw=JSON.parse(await file.text());validateProject(raw);
  for(const a of raw.assets)if(!a.path&&raw.embedded?.[a.id]){
    const data=raw.embedded[a.id];const match=/^data:((?:image|video|audio)\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(data);
    if(!match)throw new Error(`Invalid embedded media: ${a.name}`);
    const binary=atob(match[2]);const buffer=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)buffer[i]=binary.charCodeAt(i);
    await storage.put('media',a.id,new Blob([buffer],{type:match[1]}));
  }
  delete raw.embedded;return raw;
}
