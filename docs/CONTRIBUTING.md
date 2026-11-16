# Contributing

Thanks for helping. A few rules keep this project safe for the people who use it.

## Hard rules

1. **No Rockstar artwork.** Never add shape paths, thumbnails, fonts or screenshots from the editor. The only editor geometry allowed is the primitive outlines already in `src/socialclub/editor-contract.ts`. The test harness uses made-up stand-in shapes (`cf-*`) for the same reason.
2. **No credentials, no private endpoints.** The app makes no network calls. The console scripts call only functions the editor already runs in the page.
3. **Never save or publish.** Scripts stop after building the canvas.
4. **No look-alike branding.** The product is "Crest Forge". Say "works with the Rockstar Games Social Club crew emblem editor" and "not affiliated with or endorsed by Rockstar Games".
5. **Never invent editor behaviour.** If it is not in `docs/editor-contract.md`, measure it in the real editor first, then document it there with the date.

## Workflow

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

CI runs exactly that on every push. Please run `pnpm format` before committing.

## Where things go

- Pure logic (geometry, conversion, budgets, tracing maths) has no DOM access and is covered by Vitest in `tests/`.
- Anything that needs a canvas is covered by Playwright in `e2e/`, against the production build, so the real CSP and the minified worker are what get tested.
- Editor constants live in one file, `src/socialclub/editor-contract.ts`. The script templates repeat a few of them as literals; `tests/scripts.test.ts` fails if they drift.

## The console script templates

`src/scripts/*.template.js` are real, linted JavaScript files: plain ES2020, one async IIFE each, no imports.

- Data goes in at a single placeholder. Do not mention a placeholder name anywhere else in the template, comments included.
- Wrap every editor access in feature detection or `try`/`catch`, and fail with a message that names what is missing.
- The words `fetch`, `XMLHttpRequest`, `localStorage`, `document.cookie` and the save and publish URLs must not appear, even in comments; the hygiene test greps for them.
- Bump `VERSION` in both templates, `SCRIPT_VERSION` in `build-scripts.ts` and `version` in `package.json` together. The banner is how bug reports identify a script.
- If a template's size changes, update the snapshot with `pnpm test -- -u` and mention it in the pull request.

## Tracer worker

`tracerCore` and `workerMain` in `src/trace/core.ts` are serialised with `toString()` into a Blob-URL worker. They must stay self-contained: no imports and no references outside their own bodies. `tests/trace.test.ts` runs the serialised source against a fake worker scope to prove it.

## Releases

1. Run `pnpm contract:check` and the manual release check in `docs/editor-contract.md` on the real editor, with a throwaway emblem.
2. Update `CHANGELOG.md`, bump the version (semantic versioning), tag `vX.Y.Z`.
3. CI builds and deploys `dist/`.
