# Crest Forge

A browser-only emblem editor with image tracing, plus a bridge into the Rockstar Games Social Club crew emblem editor.

**Works with the Rockstar Games Social Club crew emblem editor. Not affiliated with or endorsed by Rockstar Games.**

Crest Forge is a static web app. There is no server, no account and no upload: every picture you load and every design you make stays in your browser.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer. Clone or download this repository, then:

- **Windows:** double-click `start.cmd`.
- **Linux / macOS:** run `./start.sh`.

The first run installs and builds the app (about a minute). After that it starts straight away on http://localhost:8080 and opens your browser. Press Ctrl+C to stop it.

| Option        | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `--port 3000` | use another port                                          |
| `--lan`       | make it reachable from other devices on your network      |
| `--rebuild`   | rebuild first, after pulling new changes                  |
| `--no-open`   | don't open a browser, for example on a server or over SSH |

For example: `./start.sh --lan --no-open` or `start.cmd --port 3000`.

Offline use needs `http://localhost` (or HTTPS); on a plain `http://` network address the app works but needs the server running. Opening `dist/index.html` straight from disk does not work, because browsers block module scripts on `file://` pages. Designs autosave in your browser per address, so use **Export > Save project** and **Open project…** to move one between `localhost` and a network address.

## What it does

1. **A modern layer editor.** Handles, multi-select, centre snapping, 200-step undo, autosave, keyboard shortcuts, PNG/SVG/JSON export.
2. **Image tracing.** Rebuilds any picture from layered ellipses, circles, rectangles and triangles, live, in a Web Worker.
3. **A bridge into the official editor.** Crest Forge generates a console script that you paste into your own signed-in editor tab. Either:
   - the **import script** rebuilds your Crest Forge design there, converting each layer into exact Rockstar primitives, or
   - the **trace script** traces your picture inside their page with their own shape library, which gives a better likeness per layer.

The scripts only add layers to the canvas. **You** click Save, and publishing to your crew stays a separate, manual step.

## Using the bridge

1. On Social Club, open your crew page and click **Edit crew emblem**.
2. Press **F12**, open **Console**, paste, press **Enter**. Chrome asks first-time users to type `allow pasting`.
3. Check the emblem, then click **Save**. It goes to My Emblems; your crew emblem only changes if you publish it.

Read [SECURITY.md](SECURITY.md) before pasting anything into a console, including scripts from this project.

### Terms of service

Automating a website's editor may conflict with that website's terms of service. Crest Forge does not log in, save or publish for you, and it only calls functions the editor already runs in your own tab, but whether to use the bridge is your decision and your responsibility. If in doubt, export a PNG and redraw by hand.

## Limits worth knowing

The official editor allows 750 layers, but the save size (1,048,576 characters) usually binds first. Crest Forge estimates both, warns above 95%, blocks copying when a design is over, and every shape-count control has an **Auto (max that fits)** option that is on by default.

- The editor contract is unofficial. It was measured on editor build `20261031cgjfchh` (November 2026) and any update on Rockstar's side can break it. See [editor-contract.md](editor-contract.md).
- Social Club has no text tool any more, so text is converted into rectangles: often 100 to 250 layers per word.
- The smallest shape the editor keeps is 1% scale, about 3 px. Finer detail is thickened to that.
- Semi-transparent rounded rectangles and stacked rings show darker overlaps; semi-transparent triangulated shapes may show faint seams.
- Detail below about 2 px may vanish in the in-game emblem.

## Develop

Requires Node 22.12 or newer and pnpm (`npx pnpm@10` works without installing it).

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm start          # serve the production build on http://localhost:8080
pnpm test           # unit tests (Vitest)
pnpm build          # typecheck + production build into dist/
pnpm e2e            # Playwright against the production build
pnpm lint           # ESLint + Prettier
pnpm contract:check # writes the read-only snippet that re-measures the editor contract
```

`pnpm e2e` uses Playwright's Chromium (`pnpm exec playwright install chromium`). To use an installed browser instead, set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`.

On Windows, a deep checkout path can exceed the 260-character path limit. `pnpm-workspace.yaml` already asks pnpm for a flat `node_modules`; if tools still fail to start, move the checkout to a shorter path.

### Layout

```
src/
  model/        layer types, undo history, persistence, presets, the example crest
  render/       geometry, Path2D builders, canvas renderer, text fitting, SVG/PNG export
  editor/       pointer, keyboard, selection, snapping, document operations
  trace/        Tracer A (worker core), controller, shape-to-layer mapping
  socialclub/   editor-contract.ts, convert.ts, triangulate.ts, rings.ts, textRects.ts, size.ts, preview.ts
  scripts/      import.template.js, trace.template.js, build-scripts.ts
  ui/           panels, toasts, styles
tests/          unit tests
e2e/            Playwright specs and the fake editor harness
tools/          contract:check, serve.mjs (the static server start.cmd and start.sh run)
docs/           this file, CONTRIBUTING, SECURITY, editor-contract
start.cmd       Windows launcher
start.sh        Linux / macOS launcher
```

## Deploy

`pnpm build` produces a static site in `dist/` with relative URLs, so any static file server can host it from any path. `start.cmd` and `start.sh` use the zero-dependency `tools/serve.mjs`. CI also deploys tagged versions (`vX.Y.Z`) to GitHub Pages when Pages is enabled with source "GitHub Actions". The build adds a strict Content-Security-Policy and a service worker that precaches the site, so it works offline after the first visit. Fonts are bundled; the deployed site contacts no third party.

## Licence

Code: MIT, see [LICENSE](../LICENSE). Bundled fonts (Chakra Petch, IBM Plex Sans, JetBrains Mono) are under the SIL Open Font License 1.1, see [licenses/](../licenses).

Crest Forge ships none of Rockstar's shape artwork, fonts, thumbnails or screenshots. The only editor geometry in the app is the handful of primitive outlines (square, circle, two triangles, a hexagon and six rings) needed to preview a converted design exactly.
