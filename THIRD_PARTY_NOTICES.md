# Third-party notices and primary references

## NASA Blue Marble surface imagery

The Earth surface texture used to generate the bundled CGI pictures is **Blue Marble: Next Generation**, NASA Earth Observatory. Credit: **NASA Earth Observatory; Reto Stöckli, NASA Goddard Space Flight Center**. The source `bmng.jpg` was obtained from the Basemap data installed in the build environment. No Basemap source code or fonts are bundled with the application.

- Project and credits: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/
- NASA imagery usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/

NASA imagery is generally available for informational/educational use under its stated guidelines. Logos, insignia, personal rights, third-party material, and endorsement restrictions are distinct. This project does not claim NASA endorsement or ownership of the NASA imagery. Retain this notice when redistributing the included Earth assets.

`orbit`, `earthrise`, `blue-marble`, and `horizon` are newly rendered CGI compositions and synthetic camera moves created for this editor. `weightless.wav` is an original synthesized composition created by `assets/build-demo.py`; it is not a commercial recording. The title templates and icon artwork are original application assets. No Unsplash images, Apple screenshots, Apple application assets, or external font files are included.

## Runtime

There are no third-party JavaScript runtime dependencies. The app uses browser platform APIs. The optional test/generation tooling (Node, Chromium/Playwright, FFmpeg, Pillow, NumPy, SciPy) is not redistributed as part of the application and has its own licenses.

## Interface reference

The user requested a Final Cut–style interface. Layout and editorial workflow are inspired by that category of desktop nonlinear editor; code and artwork are independent. Final Cut Pro is a trademark/product of Apple Inc. No affiliation, compatibility certification, or full feature parity is represented.

- Apple magnetic timeline guide: https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac

## API references

- WebGPU: https://www.w3.org/TR/webgpu/
- WGSL: https://www.w3.org/TR/WGSL/
- Canvas/media capture: https://www.w3.org/TR/mediacapture-fromelement/
- Web Audio: https://www.w3.org/TR/webaudio/
- External video textures: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/importExternalTexture
- Recorder capability detection: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
