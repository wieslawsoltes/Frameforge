# Frameforge delivery verification

Verification performed 2026-09-06. Reports are included under `validation/`.

## Executed successfully

**42 Node unit tests**, zero failures. The suite includes timecode round trips, project validation, source-bound trimming, insert/split/reorder/duplicate, ripple deletion, connected anchors, transaction rollback, bounded gesture/command history, undo/redo, keyframe continuity and trim sampling, dissolve plans, SRT/EDL, portable project validation, session storage, and a deterministic **500-operation randomized timeline edit test**. See `validation/unit-tests.txt` and `tests/core.test.mjs`.

**14 browser smoke checks** passed using Chromium **144.0.7559.96** at 1600 × 1000. The standalone app was injected into an opaque-origin page, because the managed test browser disallowed HTTP/file navigation. No policies were changed. This context did not expose WebGPU or IndexedDB, so the measured path was **Canvas 2D with session-only storage**. This intentionally exercised the fallback; it does not validate persistent IndexedDB or hardware rendering.

The browser checks verified loaded demo video, an accurate renderer badge, playback advancing with nonzero mixed audio, Space pause, keyboard blade and undo, a color-look metadata change, actual title-inspector editing, local image import/blob retention, appending imported media, real video/audio export, restored preview state, export cancellation, and no page/console errors. See `validation/browser-report.json` and `tests/browser-smoke.py`.

The captured export was independently parsed and decoded with **FFprobe/FFmpeg**: **VP8 video, 640 × 360; Opus audio, 48 kHz stereo**, a playable approximately three-second recording. This is real exported media, not a placeholder. Exact frame count and file size are in `validation/export-probe.json`; real-time recording is variable-timestamp and may include repeated frames/a short recording tail. The audio was also decoded and found non-silent. The test video is supplied separately with the delivery.

**Six HTTP checks** passed against the included server: index HTML, leading byte range, suffix byte range, HEAD, rejection of out-of-range requests, and rejection of non-read methods. All application JavaScript and server/build modules passed Node syntax checks.

The workspace screenshot was captured from the running app with the Canvas renderer. It was not an image mockup and was not used in place of interactive code.

## Not verified in this environment

The **hardware WebGPU path was not executed**. Both WGSL modules, actual GPU alpha blending/crop, external-video textures, and device-specific presentation/export behavior need execution on the target GPU/browser. `tests/gpu-smoke.html` is supplied for that purpose and reports failure rather than treating Canvas fallback as a GPU pass. There is no claimed GPU benchmark, frame-rate guarantee, or hardware compatibility matrix.

Persistent IndexedDB behavior across restarts, MP4/H.264/AAC export, Safari/Firefox, large files/long projects, high-resolution throughput, arbitrary third-party codecs/VFR media, every drag/keyboard/menu combination, fullscreen under managed policies, and durable download completion were not certified. Unit tests and a working smoke sequence are not a substitute for long-form production qualification.

## Fixes made during verification

- Replaced initial-load-only seek waits with state-predicate readiness barriers so repeated exports do not wait for a nonexistent second `loadeddata` event.
- Bounded both transaction and gesture history to 80 snapshots.
- Preserved keyframe values when trimming and rejected duplicate/unsorted keyframe positions.
- Made snapshot/movie export explicitly use project view rather than an accidentally selected source view.
- Corrected project-space translation scaling and fallback crop/opacity behavior.
- Added session-only persistence behavior and a portable-save warning path when IndexedDB is unavailable.

For the complete current feature contract and limitations, read `README.md` and the in-app **Help → Engine & limitations** dialog.
