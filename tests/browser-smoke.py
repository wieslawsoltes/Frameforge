"""Optional browser regression test. Requires Python Playwright and Chromium.
Tests the standalone build without navigation using about:blank; this deliberately
exercises session-only storage and the Canvas 2D fallback in restricted environments.
For hardware validation, serve the source over localhost and run tests/gpu-smoke.html.
"""
import asyncio, base64, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('FRAMEFORGE_TEST_OUTPUT',str(ROOT/'test-output')))
OUT.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  page=await browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
  logs=[]; checks=[]
  page.on('pageerror',lambda e: logs.append(str(e)))
  page.on('console',lambda m: logs.append(m.text[:1000]) if m.type=='error' else None)
  async def check(name,expr):
   result=await page.evaluate(expr)
   assert result, f'Failed: {name}'
   checks.append(name); print('PASS',name,flush=True)
  await page.set_content((ROOT/'Frameforge.html').read_text(),wait_until='domcontentloaded',timeout=25000)
  await page.wait_for_function('window.frameforge?.booted',timeout=25000)
  await check('Demo boots with 7 clips and loaded video','frameforge.editor.project.clips.length===7 && frameforge.media.entries.get("demo-0").el.readyState>=2')
  await check('Opaque-origin Canvas fallback accurately reported','frameforge.renderer.kind==="Canvas 2D" && document.getElementById("engineName").textContent==="Canvas 2D"')
  await page.wait_for_timeout(5000)
  await page.screenshot(path=str(OUT/'workspace.png'),full_page=True)
  print('Starting playback',flush=True)
  await page.locator('#playButton').click(timeout=10000)
  print('Playback clicked',flush=True)
  await page.wait_for_timeout(1400)
  state=await page.evaluate('({frame:frameforge.frame,playing:frameforge.playing,meter:frameforge.media.meter()})')
  assert state['playing'] and state['frame']>75 and state['meter']>0.0001,state
  checks.append('Playback advances with nonzero mixed audio');print('PASS Playback',state,flush=True)
  await page.keyboard.press('Space')
  await check('Space pauses playback','!frameforge.playing')
  await page.evaluate('frameforge.seek(60);frameforge.select("demo-0")')
  await page.keyboard.press('Control+b')
  await check('Keyboard blade creates a real primary split','frameforge.editor.project.clips.length===8 && frameforge.editor.project.clips.find(c=>c.id==="demo-0").duration===60')
  await page.keyboard.press('Control+z')
  await check('Keyboard undo restores exact duration','frameforge.editor.project.clips.length===7 && frameforge.editor.project.clips[0].duration===144')
  await page.evaluate('frameforge.applyEffect("noir")')
  await check('Color look changes clip grading data','frameforge.editor.project.clips[0].fx.saturation===0')
  await page.evaluate('frameforge.editor.undo();frameforge.select("demo-title")')
  text=page.locator('[data-title="text"]')
  await text.fill('TEST STORY');await text.press('Tab')
  await check('Title inspector edits composited title data','frameforge.editor.project.clips.find(c=>c.id==="demo-title").title.text==="TEST STORY"')
  await page.evaluate('frameforge.editor.undo()')
  await page.locator('#mediaInput').set_input_files(str(ROOT/'assets/orbit.jpg'))
  await page.wait_for_function('frameforge.editor.project.assets.length===7 && !frameforge.importing',timeout=15000)
  await check('Local image import retains blob and metadata','[...frameforge.media.blobs.values()].some(b=>b.size>1000) && frameforge.editor.project.assets.at(-1).kind==="image"')
  await page.evaluate('frameforge.addMedia("append",frameforge.editor.project.assets.at(-1).id)')
  await check('Imported still appends as an editable clip','frameforge.editor.project.clips.at(-1).assetId===frameforge.editor.project.assets.at(-1).id')
  # A short export tests rendering/encoding/audio without making the smoke suite wait 24 seconds.
  await page.evaluate('''async()=>{
   const a=frameforge,p=structuredClone(a.editor.project);
   p.name='Frameforge export verification';
   p.clips=p.clips.filter(c=>['demo-0','demo-title','demo-score'].includes(c.id));
   for(const c of p.clips){c.duration=72;c.start=0;c.fadeIn=0;c.fadeOut=0;}
   await a.loadProject(p);a.seek(12);
   a._exportProgress=[];
   a._exportTask=a.exporter.start({mime:'video/webm;codecs=vp8,opus',width:640,height:360,bitrate:2500000},v=>a._exportProgress.push(v)).then(async b=>{a._exportBlob=b;a._exportDone=true;}).catch(e=>{a._exportError=String(e);});
  }''')
  await page.wait_for_function('frameforge._exportDone || frameforge._exportError',timeout=20000)
  await check('Real-time MediaRecorder export completes','frameforge._exportDone && frameforge._exportBlob.size>10000 && !frameforge.exporter.running')
  data=await page.evaluate('''async()=>{const b=frameforge._exportBlob;return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.slice(f.result.indexOf(';base64,')+8));f.readAsDataURL(b);});}''')
  (OUT/'export-verification.webm').write_bytes(base64.b64decode(data))
  await check('Export restores playhead and preview resolution','frameforge.frame===12 && frameforge.renderer.canvas.width===1280')
  # Export cancellation must not leave playback or stream recording active.
  await page.evaluate('''()=>{frameforge._cancelled=false;frameforge.exporter.start({mime:'video/webm;codecs=vp8,opus',width:640,height:360}).catch(e=>frameforge._cancelled=e.name==='AbortError');}''')
  await page.wait_for_function('!!frameforge.exporter.session',timeout=10000)
  await page.evaluate('frameforge.exporter.cancel()')
  await page.wait_for_function('frameforge._cancelled',timeout=10000)
  await check('Cancel releases export and pauses playback','!frameforge.exporter.running && !frameforge.playing')
  await check('No script or console errors',json.dumps(len(logs)==0))
  report={'browser':browser.version,'renderer':await page.evaluate('frameforge.renderer.kind'),'checks':checks,'errors':logs,'webgpuHardwareTested':False,'exportBytes':(OUT/'export-verification.webm').stat().st_size}
  (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
  print(json.dumps(report,indent=2),flush=True)
  await browser.close()
asyncio.run(main())
