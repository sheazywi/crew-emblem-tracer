# Security and privacy

## Never paste console code you do not trust

A script pasted into a browser console runs with everything that tab can do: it can read your session and act as you. Only paste the scripts Crest Forge generates if you got Crest Forge from a source you trust, and never paste console code that someone sends you in chat, in a comment or in a "free emblem" offer. That includes anything that claims to be a Crest Forge script.

Both scripts are plain text. Read them before you run them: they are short, commented, and start with a banner saying what they do.

## What the app does

- Runs entirely in your browser. There is no backend, no account, no analytics and no third-party script.
- Makes no network requests except loading its own static files. Fonts are bundled.
- Pictures never leave the device. They are drawn to a canvas; for the trace script a small PNG (long side at most 220 px) is embedded in the script text as a data URL, which you then paste yourself.
- Stores one thing: your current design, in `localStorage` under `crest-forge:doc:v1`, so a reload does not lose it. The app works when storage is unavailable.
- Ships with this Content-Security-Policy:

  ```
  default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self';
  object-src 'none'; base-uri 'self'; form-action 'none'
  ```

  `blob:` workers are the image tracer; the same-origin worker is the offline cache.

## What the console scripts do

Both scripts are generated from the audited templates in `src/scripts/` with data injected at one placeholder (`JSON.stringify`, through a function replacer).

**Import script**

1. Checks that `window.webpackChunksc_web` exists (you are in the editor).
2. Finds three of the editor's own modules by the shape of their exports: the layer manager, the shape-group loader and the shape library.
3. Asks the editor's loader for the shape groups the design needs and waits for them.
4. Estimates the save size and asks before importing a design that is probably too large.
5. If the canvas has layers, asks before replacing them, then calls the editor's `removeAll()`.
6. Calls the editor's `add()` once per layer and sets each layer's exact position.
7. Reports how many layers were added.

**Trace script**

The same module discovery and the same `add()` calls, plus: it decodes the embedded picture, rasterises candidate shapes from the editor's library on an off-screen canvas in the page, and keeps the ones that reduce the colour error. It shows a small progress panel with a Stop button and removes it when done. With `dry: true` it adds nothing and leaves the result in `window.__crestForgeTrace`.

**What neither script does**

- No network requests of its own (`fetch`, `XMLHttpRequest`, `WebSocket`, beacons).
- No access to cookies, `localStorage`, `sessionStorage`, IndexedDB or tokens.
- No `eval`, `new Function` or dynamic imports.
- No overriding of `alert` or `confirm`: you answer real dialogs.
- No clicks and no synthetic events, so it cannot press Save or Publish. It never calls the save or publish endpoints.
- Nothing left behind: no timers, no globals (except the documented dry-run result).

These rules are enforced three ways: ESLint rules on the templates (`eslint.config.js`), string checks on every generated script (`tests/scripts.test.ts`), and end-to-end runs against a fake editor that counts network, storage and cookie access (`e2e/scripts.spec.ts`).

## What Crest Forge will never do

- Handle your Rockstar credentials, cookies or tokens.
- Call Rockstar's private endpoints.
- Save or publish on your behalf.
- Ship, mirror or redistribute Rockstar's shape artwork, fonts or thumbnails.

## Reporting a problem

Please report security issues privately to the maintainers (use the repository's private vulnerability reporting) rather than in a public issue. Include the script version from the console banner (`Crest Forge vX.Y.Z`).
