# Changelog

All notable changes to Crest Forge. This project follows [semantic versioning](https://semver.org/).

## 1.4.0 - 2026-11-16

First build from the November 2026 specification.

### Added

- Layer editor: ten layer types, seven outline presets, handles, multi-select, centre snapping, 200-step undo, autosave, keyboard shortcuts, layers panel.
- Tracer A: greedy shape tracing with ellipses, circles, rectangles and triangles in a Blob-URL Web Worker, with a live reference overlay.
- Social Club converter: exact mapping of every layer type onto six primitive slugs, seam hiding for opaque layers, text as rectangles, an exact preview.
- Automatic shape budget against both the 740-layer and the 960,000-character limits, naming the limit that binds.
- Import and trace console scripts, generated from linted templates, versioned `Crest Forge v1.4.0`.
- Fake editor harness and end-to-end tests for both scripts; `pnpm contract:check`.
- Static deployment with a strict Content-Security-Policy, bundled fonts and an offline cache.

### Tracing quality

- Flat-colour regions are fitted with a single ellipse, circle or rectangle from their moments and offered as candidates at every step, so a flat disc such as a sun becomes one circle (both tracers).
- Opaque traces can place a new shape under the shapes traced so far, so background shapes no longer cut into regions that are already matched.
- Shapes that end up completely covered are removed during the trace and their layers and bytes go back to the budget.
- A shape that only re-tints one earlier shape by a barely visible amount is not worth a layer, so a sun is no longer stacked from near-identical circles.
- **Stop when more shapes stop helping** (on by default, both tracers): tracing ends once the last 10 shapes add almost nothing, so simple pictures use far fewer layers. Auto still caps the count at the maximum that fits.
- Hill climbing tries step sizes from 8% down to 0.5% of the image, and needle triangles are rejected.

### Hosting

- `start.cmd` (Windows) and `start.sh` (Linux, macOS) build on first run and serve the app on http://localhost:8080 with only Node installed; `--lan`, `--port`, `--rebuild` and `--no-open` options.
- `tools/serve.mjs`: a zero-dependency static server (`pnpm start`, `pnpm serve`).

### Known gaps

- The editor contract has not been re-measured from this repository, and no real save payloads have been captured yet (see docs/editor-contract.md).
