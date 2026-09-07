"""Verify a deployed Frameforge build with Chromium; no hardware-GPU claim."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urljoin
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-output'
BASE = os.environ.get('FRAMEFORGE_BASE_URL', 'http://localhost:8080/').rstrip('/') + '/'
EXPECTED = os.environ.get('EXPECTED_COMMIT')

async def main():
    OUT.mkdir(exist_ok=True)
    checks, errors, failures = [], [], []
    report = {'url': BASE, 'checks': checks, 'errors': errors, 'httpFailures': failures,
              'webgpuHardwareTested': False}
    async with async_playwright() as pw:
        request = await pw.request.new_context()
        browser = None
        try:
            if EXPECTED:
                for attempt in range(30):
                    response = await request.get(urljoin(BASE, 'build-info.json') + '?commit=' + EXPECTED)
                    if response.ok:
                        info = await response.json()
                        if info.get('commit') == EXPECTED:
                            report['build'] = info
                            checks.append('Published build-info matches the deployed commit')
                            break
                    await asyncio.sleep(2)
                else:
                    raise AssertionError('Published commit did not match EXPECTED_COMMIT')
            for path in ['index.html', 'styles.css', 'src/app.js', 'src/renderer.js',
                         'src/peaks.worker.js', 'assets/orbit.mp4', 'assets/earthrise.mp4',
                         'assets/blue-marble.mp4', 'assets/horizon.mp4',
                         'assets/weightless.wav', 'assets/waveform.json', 'Frameforge.html']:
                response = await request.get(urljoin(BASE, path))
                assert response.ok, f'{path}: HTTP {response.status}'
                assert len(await response.body()) > 10, f'Empty resource: {path}'
            checks.append('HTML, CSS, modules, worker, four videos, audio, waveform and standalone app are served')
            browser = await pw.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required'])
            page = await browser.new_page(viewport={'width': 1600, 'height': 1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: failures.append({'url': response.url, 'status': response.status}) if response.status >= 400 else None)
            response = await page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
            assert response and response.ok, 'Editor page failed to load'
            await page.wait_for_function('window.frameforge?.booted && frameforge.media.entries.get("demo-0")?.el.readyState >= 2', timeout=60000)
            state = await page.evaluate('({clips:frameforge.editor.project.clips.length,assets:frameforge.editor.project.assets.length,renderer:frameforge.renderer.kind,storage:!!frameforge.storage.db})')
            assert state['clips'] == 7 and state['assets'] == 6, state
            assert state['storage'], 'IndexedDB was not available on the deployed origin'
            report['initialState'] = state
            checks.append('Source application boots with six assets, seven clips, decoded video and IndexedDB')
            before = await page.evaluate('frameforge.frame')
            await page.locator('#playButton').click()
            await page.wait_for_function('(before)=>frameforge.playing && frameforge.frame>before+5 && frameforge.media.meter()>0.0001', arg=before, timeout=15000)
            await page.keyboard.press('Space')
            assert await page.evaluate('!frameforge.playing')
            checks.append('Playback advances with nonzero audio; Space pauses')
            await page.evaluate('frameforge.seek(60);frameforge.select("demo-0")')
            await page.keyboard.press('Control+b')
            assert await page.evaluate('frameforge.editor.project.clips.length===8 && frameforge.editor.project.clips[0].duration===60')
            await page.keyboard.press('Control+z')
            assert await page.evaluate('frameforge.editor.project.clips.length===7 && frameforge.editor.project.clips[0].duration===144')
            checks.append('Keyboard blade and undo edit and restore the timeline')
            await page.evaluate('frameforge.select("demo-title")')
            text = page.locator('[data-title="text"]')
            await text.fill('PAGES VERIFICATION')
            await text.press('Tab')
            assert await page.evaluate('frameforge.editor.project.clips.find(c=>c.id==="demo-title").title.text==="PAGES VERIFICATION"')
            await page.evaluate('frameforge.editor.undo();frameforge.select("demo-0")')
            checks.append('Title inspector updates editable title data')
            await page.screenshot(path=str(OUT / 'published-workspace.png'), full_page=True)
            await page.wait_for_function('!frameforge.savePending', timeout=10000)
            await page.evaluate('async()=>{const p=structuredClone(frameforge.editor.project);p.name="Pages persistence verification";await frameforge.storage.saveProject(p);}')
            await page.reload(wait_until='domcontentloaded')
            await page.wait_for_function('window.frameforge?.booted', timeout=60000)
            assert await page.evaluate('frameforge.editor.project.name==="Pages persistence verification"')
            checks.append('IndexedDB project persists across reload on the hosted origin')
            assert not errors, errors
            assert not failures, failures
            checks.append('No page exceptions or failed HTTP resources')
            report['browser'] = browser.version
            report['passed'] = True
        except Exception as error:
            report['passed'] = False
            report['failure'] = str(error)
            raise
        finally:
            (OUT / 'pages-report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2), flush=True)
            if browser:
                await browser.close()
            await request.dispose()

asyncio.run(main())
