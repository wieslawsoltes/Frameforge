/** Zero-dependency single-file packer for this project's explicit ES module graph.
 * The source distribution remains unbundled. The output embeds demo media and the worker,
 * requires no network and can be opened directly in browsers permitting local HTML files.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const types={'.jpg':'image/jpeg','.mp4':'video/mp4','.wav':'audio/wav','.json':'application/json','.svg':'image/svg+xml'};
const assets={};
for(const file of fs.readdirSync(path.join(root,'assets'))){const mime=types[path.extname(file)];if(mime)assets['assets/'+file]=`data:${mime};base64,${fs.readFileSync(path.join(root,'assets',file)).toString('base64')}`;}
let css=read('styles.css').replace(/url\(['"]?(assets\/[^'")]+)['"]?\)/g,(_,p)=>`url("${assets[p]||p}")`);
const order=['core','renderer','storage','media','icons','timeline','export','app'];
let bundle='const __modules = Object.create(null);\n';
const worker=read('src/peaks.worker.js');
for(const name of order){
 let source=read(`src/${name}.js`);
 const exported=[...source.matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/g)].map(m=>m[1]);
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)\.js['"];?/g,(_,names,mod)=>`const {${names}} = __modules['${mod}'];`);
 source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:const|function|class)\b)/g,'');
 source=source.replace("new URL('./peaks.worker.js',import.meta.url)",`URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}))`);
 bundle+=`__modules['${name}'] = (()=>{\n${source}\nreturn {${exported.join(',')}};\n})();\n`;
}
bundle=bundle.replace(/<\/script/gi,'<\\/script');
let html=read('index.html').replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`).replace('href="assets/icon.svg"',`href="${assets['assets/icon.svg']}"`);
html=html.replace('<script type="module" src="src/app.js"></script>',`<script>globalThis.FRAMEFORGE_ASSETS=${JSON.stringify(assets)};\n${bundle}</script>`);
const out=path.join(root,'Frameforge.html');fs.writeFileSync(out,html);console.log(`${out} — ${(Buffer.byteLength(html)/1048576).toFixed(2)} MB`);
