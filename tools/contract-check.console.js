/*
 * Crest Forge - contract check (maintainers only).
 *
 * Paste into the DevTools console of the crew emblem editor, signed in, with a THROWAWAY emblem
 * on the canvas (never your crew emblem). It re-measures the values in
 * src/socialclub/editor-contract.ts and prints a table of what still matches.
 *
 * It is read-only: it loads shape groups through the editor's own loader and reads the library
 * and the canvas. It never saves, publishes, clicks anything, or makes requests of its own.
 * To calibrate the save-size estimate it measures the payload the editor WOULD send for the
 * canvas as it is now; pressing Save stays your decision.
 */
(async () => {
  'use strict';
  const EXPECT = __CONTRACT__;
  const rows = [];
  const check = (name, expected, actual, tolerance) => {
    const ok =
      typeof expected === 'number' && typeof actual === 'number'
        ? Math.abs(actual - expected) <= (tolerance === undefined ? 0 : tolerance)
        : expected === actual;
    rows.push({ check: name, expected, actual, ok: ok ? 'yes' : 'NO' });
    return ok;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isFn = (o, k) => !!o && typeof o[k] === 'function';

  const chunks = window.webpackChunksc_web;
  if (!chunks || typeof chunks.push !== 'function') {
    console.warn('Open the Social Club emblem editor first.');
    return;
  }
  let req = null;
  chunks.push([
    [Symbol('cf-check')],
    {},
    (r) => {
      req = r;
    },
  ]);
  const mods = Object.values((req && req.c) || {})
    .map((m) => m && m.exports)
    .filter((e) => e && typeof e === 'object');
  const Layers = mods.find((e) => isFn(e, 'add') && isFn(e, 'removeAll') && isFn(e, 'getLayers'));
  const Groups = mods.find((e) => isFn(e, 'loadGroups') && isFn(e, 'initObjects'));
  const Shapes = mods.find((e) => e.library && typeof e.library === 'object' && isFn(e, 'create'));
  check('layer manager found (add, removeAll, getLayers)', true, !!Layers);
  check('group loader found (loadGroups, initObjects)', true, !!Groups);
  check('shape library found (library, create)', true, !!Shapes);
  if (!Layers || !Groups || !Shapes) {
    console.table(rows);
    return;
  }

  // Primitive boxes, outlines and path lengths.
  const slugs = Object.keys(EXPECT.prims);
  const groups = Array.from(new Set(slugs.map((s) => EXPECT.groupPrefix + s.split('/')[0])));
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 25000);
    Groups.loadGroups(groups, () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await sleep(800);
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 4;
  const g = scratch.getContext('2d');
  const measured = {};
  for (const slug of slugs) {
    const want = EXPECT.prims[slug];
    const lib = Shapes.library[slug];
    if (!check(slug + ' is in the library', true, !!lib)) continue;
    check(slug + ' width', want.w, +lib.width, 0.5);
    check(slug + ' height', want.h, +lib.height, 0.5);
    const pathLen = typeof lib.path === 'string' ? lib.path.length : 0;
    measured[slug] = { width: +lib.width, height: +lib.height, type: lib.type, pathLength: pathLen };
    if (!pathLen) continue;
    const path = new Path2D(lib.path);
    const cx = lib.width / 2;
    const cy = lib.height / 2;
    if (want.ratio !== undefined) {
      // Ring ratio: ray-cast from the centre at 15 degree steps, never trust thumbnails.
      let sum = 0;
      let n = 0;
      for (let a = 0; a < 360; a += 15) {
        const dx = Math.cos((a * Math.PI) / 180);
        const dy = Math.sin((a * Math.PI) / 180);
        let inner = 0;
        let outer = 0;
        for (let r = 0; r <= cx + 2; r += 0.05) {
          const inside = g.isPointInPath(path, cx + dx * r, cy + dy * r);
          if (inside && !inner) inner = r;
          if (inside) outer = r;
        }
        if (inner && outer) {
          sum += inner / outer;
          n++;
        }
      }
      measured[slug].ratio = n ? +(sum / n).toFixed(4) : null;
      check(slug + ' hole/outer ratio', want.ratio, n ? sum / n : NaN, 0.004);
    } else if (want.pts) {
      // Every contract vertex should sit on the outline (allowing the tiny decorative notches).
      let worst = 0;
      g.lineWidth = 2.5;
      for (const [x, y] of want.pts) if (!g.isPointInStroke(path, x, y)) worst = 1;
      check(slug + ' outline passes through the contract vertices', 0, worst);
    }
  }

  // Limits that can be read without acting.
  const svg = document.querySelector('svg');
  if (svg) {
    const box =
      svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
        ? svg.viewBox.baseVal
        : svg.getBoundingClientRect();
    rows.push({
      check: 'canvas SVG size (informational)',
      expected: EXPECT.canvas,
      actual: Math.round(box.width) + ' x ' + Math.round(box.height),
      ok: '-',
    });
  }

  // Save-size calibration for the canvas as it is now.
  const live = Layers.getLayers();
  let payload = null;
  if (live && live.length) {
    const first = live[0];
    const paper = first && first.self && first.self.paper && first.self.paper.canvas;
    if (paper && typeof paper.outerHTML === 'string') {
      const plain = live.map((L) => {
        const o = {};
        for (const k of Object.keys(L)) {
          const v = L[k];
          if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
        }
        return o;
      });
      const b64 = (n) => Math.ceil(n / 3) * 4;
      payload = b64(paper.outerHTML.length) + b64(JSON.stringify(plain).length);
      let estimate = 0;
      for (const L of live) {
        const lib = Shapes.library[L.slug];
        const pathLen = lib && typeof lib.path === 'string' && lib.path ? lib.path.length : EXPECT.noPathLen;
        estimate +=
          EXPECT.costBase64 *
          (EXPECT.costBase + EXPECT.costPerPathChar * pathLen + String(L.name || '').length);
      }
      const error = Math.abs(estimate - payload) / payload;
      rows.push({
        check: 'save size: estimate vs measured payload (fail above 5%)',
        expected: Math.round(estimate),
        actual: payload,
        ok: error <= 0.05 ? 'yes' : 'NO',
      });
    }
  }
  if (payload === null) {
    rows.push({
      check: 'save size calibration',
      expected: 'layers on the canvas',
      actual: 'skipped: import a design first',
      ok: '-',
    });
  }

  console.table(rows);
  const failed = rows.filter((r) => r.ok === 'NO').length;
  console.log(
    failed
      ? failed + ' check(s) FAILED: update editor-contract.ts and docs/editor-contract.md.'
      : 'All checks passed.',
  );
  console.log('Measured values (paste into an issue or a tests/fixtures/payloads file):');
  console.log(JSON.stringify({ build: EXPECT.build, measured, payloadLength: payload }, null, 1));
})();
