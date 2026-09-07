# Frameforge

**Your story. Every frame.** A working, independent, Final Cut–inspired browser video editor built with plain HTML, CSS, JavaScript, and WGSL. No React, build framework, third-party runtime library, external font, API key, backend, or CDN dependency.

This is an implemented nonlinear editor with a custom edit kernel and GPU compositor, not a screenshot-only interface. It is also **not a feature-complete or production-certified replacement for Final Cut Pro**. See the precise engine contract below.

## Hosted application

[Frameforge on GitHub Pages](https://wieslawsoltes.github.io/Frameforge/) · [Source repository](https://github.com/wieslawsoltes/Frameforge)

The hosted editor runs entirely in your browser. Imported media stays in local browser storage; the app does not upload it to GitHub.

## Run

The easiest reliable setup is a local HTTP server, which also provides byte-range requests for media seeking:

```sh
cd frameforge
node server.mjs
```

Open **http://localhost:8080**. No package installation is required. Change the port with `PORT=8787 node server.mjs` on macOS/Linux or `$env:PORT=8787; node server.mjs` in PowerShell. Node.js 20 or newer is required only for the included server, packer, and tests, not for the editor itself.

The supplied **Frameforge.html** is a completely self-contained build with its demo media and worker embedded. Open it as a local HTML file to try the editor without a server. Browser policies vary for `file:` storage, workers, and GPU access; localhost is preferred for development and persistent projects. The status bar reports the renderer actually in use. If storage is unavailable, the interface explicitly says **Session only**; save a portable project before closing.

Static hosting also works: publish `index.html`, `styles.css`, `src/`, and `assets/` together over HTTPS. No server-side application code is needed. The GitHub Pages workflow validates the edit kernel, builds the standalone distribution, and publishes the static application.

## Working features

### Workspace and editorial tools

The desktop workspace includes a library sidebar, media/audio/title browsers, source and project viewer modes, transport, source range controls, inspector tabs, effects browser, timeline index, and a resizable timeline. Panels can be hidden. The viewer has safe-area guides, resolution controls, fullscreen, and timecode navigation.

Import local browser-decodable video, audio, and still images. The app probes duration and dimensions, generates filmstrip thumbnails, retains imported blobs locally, and supports search and favorites. Select media for source preview; set **I/O** marks; double-click or press **E** to append, **W** to insert, or **Q** to connect. Drag media from the browser onto the timeline. Drop local files to import them.

The timeline has a gapless primary storyline and connected title, overlay, and audio lanes. Move and reorder clips, trim either edge, split at the playhead or with the blade tool, ripple-delete, duplicate, enable/disable, detach anchors, and undo/redo. Source in-points survive edits and positive constant-speed retiming. Connected clips follow their parent when the primary story is reordered. Deleting a primary parent also deletes its anchored children; detach them first to retain them.

Add named markers, navigate edit points, zoom and pan, snap to clip boundaries/markers/playhead, or hold Shift during a drag to bypass snapping. The alternate **Position** mode lifts dragged primary clips into the connected overlay lane; it is deliberately not a complete implementation of Final Cut’s Position tool.

### Compositing, titles, and audio

The WebGPU compositor supports translation, uniform scale, rotation, opacity, rectangular crop, exposure, contrast, saturation, warmth, vignette, and source-over compositing. Effects can be keyframed per clip. The UI authors linear interpolation; the schema also accepts smooth interpolation. Six editable looks are included. Incoming primary clips can use a cross dissolve; clips can fade in/out.

Titles are editable, not burned into the source videos: cinematic, basic/multiline, and lower-third styles, with editable text, subtitle, font size, color, alignment, transform, opacity, and animation. Titles are rasterized with Canvas text and uploaded as cached textures; the complete application UI is DOM/CSS, not GPU-rendered text.

Audio uses a Web Audio mix bus with per-clip gain, fades, transport synchronization, and separate monitor volume/mute. Waveform envelopes use real decoded samples, with min/max reduction in a worker. J/K/L provide reverse/stop/forward preview; reverse preview is silent and uses stepped seeking rather than reverse audio decoding. Positive playback uses native media playback with drift correction.

### Persistence and output

IndexedDB stores imported media and an autosaved project on the current browser origin. Undo history itself is session-only. A **portable .frameforge project** embeds imported source files, up to 250 MiB total. A **reference project** contains metadata and needs the original media/IndexedDB store or explicit relinking on a different device. Built-in demo sources are resolved by the app’s bundled assets.

Export the real composited film plus the mixed audio through the browser’s supported MediaRecorder codecs. The format picker probes support rather than promising MP4 everywhere. WebM VP8/VP9 + Opus and MP4 variants are offered only when supported. Export can be cancelled and restores the preview resolution/playhead after completion. Export a PNG of the current project frame, titles as SRT, and the primary story as a cuts-only CMX 3600 EDL. SRT import creates editable title clips. EDL is not FCPXML and excludes grading, composited overlays, title graphics, audio layers, and transition semantics.

## Engine contract and deliberate boundaries

- Timeline coordinates and clip lengths are integer **24/25/30/60 fps non-drop frames**. Source offsets are seconds and source evaluation is `sourceIn + (frame - clipStart) / fps * speed`. 23.976/29.97, drop-frame timecode, sample-accurate audio editing, and variable-speed ramps are not implemented.
- Decoding is through browser `HTMLVideoElement`/`HTMLAudioElement` instances, one per active clip. Timeline math is frame-based; exact decoded frame delivery is **not guaranteed**, particularly for VFR inputs, rapid scrubbing, or constrained decoders. This is not a custom demuxer/WebCodecs scheduler.
- Export is **real-time MediaRecorder recording**, not offline deterministic mastering. Keep the tab visible; hidden-tab export cancels. Recording can include repeated or dropped frames and a short tail. The video and audio are independently decoded, so this is not sample-accurate broadcast sync. Export is limited to 30 minutes and chunks are retained in memory until completion; practical limits depend on RAM and bitrate.
- The compositor is **SDR**, with simple display-oriented grading. It does not implement a calibrated Rec.709/ACES/HDR pipeline, transfer-function/primaries management, LUT loading, HDR metadata, RAW, ProRes, optical flow, multicam, tracking, stabilization, chroma key, masks, arbitrary blend modes, an effects plug-in host, or FCPXML.
- Dissolves use two actual decoded/rendered sources. When outgoing source handles are exhausted, the outgoing last frame is held. They are picture dissolves, not automatic equal-power audio crossfades.
- Canvas fallback approximates grading and is not pixel-identical to the GPU path. Effect translations use project-space pixels independent of preview/export resolution. The status-bar timing is **CPU submission time**, not measured GPU execution time or a throughput guarantee.
- DOM clip nodes are viewport-virtualized; hit testing and active-plan construction still scan project metadata. History uses bounded metadata snapshots (80 entries), not a persistent structural-sharing graph. Imported thumbnails are metadata; very large projects should be benchmarked before increasing current limits.
- The four visible role lanes are fixed. Multiple connected items can overlap, but this is not a dynamic, arbitrary-track-height editing system. The UI is designed for desktop; no mobile/touch parity is claimed.
- Local means no external media upload or analytics. IndexedDB is browser-managed storage, not a durable archival backup. Downloads can be blocked by browser policy; verify that your project file was actually saved.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/core.js` | DOM-free project schema, validation, frame arithmetic, source mapping, transactions/gesture history, magnetic normalization, anchors, split/trim/reorder, keyframe evaluation, render plans. |
| `src/renderer.js` | WGSL pipelines, external video textures, per-layer uniform ABI, texture caches, title rasterization, layer composition, device-loss fallback, Canvas reference path. |
| `src/media.js` | Local imports, metadata/thumbnail extraction, per-clip media element lifecycle, readiness/seek barriers, audio graph, drift correction, decoder preroll, waveform jobs. |
| `src/peaks.worker.js` | Transferable-PCM min/max waveform reduction. |
| `src/storage.js` | IndexedDB journal, session fallback, portable-project encoding/validation, blob downloads. |
| `src/timeline.js` | Virtualized filmstrip nodes, ruler/waveform drawing, pointer gestures, snap candidates, selection, timeline drag/drop. |
| `src/export.js` | Capability-gated recording, export lifecycle/cancellation, snapshot, SRT parser/writer, basic EDL writer. |
| `src/app.js` | Workspace/inspector bindings, command routing, transport clock, rAF invalidation, source browser, dialogs, keyboard map, autosave. |
| `build.mjs` | Zero-dependency, application-specific single-file packer; embeds media and worker. |
| `server.mjs` | Development static HTTP server with byte-range responses. Not intended as a hardened public production server. |

A clip’s layer parameters occupy four aligned `vec4<f32>` uniforms (64 bytes). Each live clip has its own GPU buffer so queued writes cannot make multiple layers accidentally share the final layer’s parameters. External-video bind groups are recreated per render task because external texture lifetimes are task-scoped. Stills/title textures are retained while their source content is unchanged. Shader diagnostics and asynchronous pipeline creation run during startup; device loss swaps in a new canvas rather than attempting to change an existing WebGPU canvas to 2D.

Mutations operate on metadata only. Transactions normalize the primary sequence and connected offsets, validate the resulting project, and restore the previous snapshot on failure. Drag previews reset to their original gesture snapshot, preventing cumulative floating-point/delta drift. Seek readiness checks the actual `readyState`/`seeking` predicate across `canplay`, `seeked`, and initial load events: it does not wait for a second `loadeddata` event that never comes.

## Tests and build

```sh
npm test
npm run build
```

The source has no npm dependencies. The test command uses Node’s built-in test runner. The suite includes a deterministic 500-operation randomized edit sequence plus source-bound, anchor, rollback/history, interpolation, import/format, and validation tests.

An optional browser smoke suite uses Python Playwright:

```sh
python -m pip install playwright
# Set CHROMIUM to an existing Chromium executable when not /usr/bin/chromium.
python tests/browser-smoke.py
```

That suite intentionally injects the single-file app into `about:blank`, exercising opaque-origin **Canvas/session-only behavior**, actual UI controls, media import, playback, a real recorded export, and export cancellation. It is **not** a hardware WebGPU test. Run `http://localhost:8080/tests/gpu-smoke.html` separately on the target GPU/browser to compile both shaders and check compositing, crop, and external video textures. See **TEST_REPORT.md** for exactly what was run in the delivery environment and what was not.

## Demo media and license

“Beyond — a short film” opens with four real H.264 CGI camera-move clips, two editable title clips, markers, dissolves, and an original 24-second synthesized score. These are **rendered Earth camera moves, not spacecraft footage**. The Earth surface uses NASA’s Blue Marble data. Full credits and primary references are in **THIRD_PARTY_NOTICES.md**.

The rendered assets are already included. Regeneration is optional and requires Python NumPy/Pillow/SciPy, FFmpeg with libx264, and a Blue Marble equirectangular image:

```sh
python assets/build-demo.py --texture /path/to/bmng.jpg
node build.mjs
```

Source code and original contributions: MIT. NASA source imagery retains its applicable NASA usage terms. Frameforge is an independent demonstration project and is not affiliated with or endorsed by Apple or NASA. Final Cut Pro is Apple’s product name, not this project’s name.

## GitHub Pages deployment

The `Deploy GitHub Pages` workflow runs on pushes to `main` and can be started manually. It runs `npm test`, rebuilds `Frameforge.html`, assembles only the public application assets, and deploys them through the official Pages actions. GitHub Pages must use **GitHub Actions** as its publishing source.

The distribution includes the original demo media. The workflow uses these committed assets; Python and FFmpeg are not needed for deployment. The original asset-generation recipe is retained in `assets/build-demo.py`.

To publish this full distribution with your authenticated GitHub CLI:

```sh
bash publish-github.sh
```

The script validates and builds the project, clones the existing `main` branch, copies the complete distribution, configures Pages for GitHub Actions, and performs a normal non-force commit and push. It requires Node.js 20+, Git, and an authenticated GitHub CLI with repository/workflow write and Pages administration access.
