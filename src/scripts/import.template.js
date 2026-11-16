/*
 * Crest Forge - import script (generated; see docs/SECURITY.md in the Crest Forge repository).
 *
 * What it does: rebuilds a Crest Forge design in the crew emblem editor you have open, by
 * calling the editor's own in-page functions to add layers. Nothing else.
 * What it never does: no network requests, no reading of cookies, storage or tokens, no dynamic
 * code evaluation, no overriding of dialogs, and it never saves or publishes. You click Save.
 *
 * Not affiliated with or endorsed by Rockstar Games.
 */
(async () => {
  'use strict';
  const VERSION = '1.4.0';
  const TAG = 'Crest Forge v' + VERSION;
  const DATA = __DATA__;

  // Observed, unofficial editor limits (measured November 2026).
  const LAYERS_MAX = 750;
  const SAVE_MAX = 1048576;
  const NO_PATH_LEN = 67;
  const GROUP_PREFIX = 'emblems/shapes/';

  const log = (msg) => console.log('[' + TAG + '] ' + msg);
  const fail = (msg) => {
    console.warn('[' + TAG + '] ' + msg);
    alert(TAG + '\n\n' + msg);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isFn = (o, k) => {
    try {
      return !!o && typeof o[k] === 'function';
    } catch {
      return false;
    }
  };
  const isObj = (o, k) => {
    try {
      return !!o && o[k] !== null && typeof o[k] === 'object';
    } catch {
      return false;
    }
  };
  const outdated =
    ' The editor has probably changed since this script (v' + VERSION + ') was written. Nothing was changed.';

  console.log(TAG + ' - import script');

  if (!Array.isArray(DATA) || !DATA.length || !DATA.every((d) => Array.isArray(d) && d.length === 11)) {
    return fail('This script carries no layer data. Copy it again from Crest Forge.');
  }

  // 1. Are we in the editor?
  const chunks = window.webpackChunksc_web;
  if (!chunks || typeof chunks.push !== 'function') {
    return fail('Open the Social Club emblem editor first, then paste this script into its console.');
  }

  // 2. Find the editor's modules by the shape of their exports, never by id.
  let req = null;
  try {
    chunks.push([
      [Symbol('cf')],
      {},
      (r) => {
        req = r;
      },
    ]);
  } catch {
    req = null;
  }
  if (!req || !req.c || typeof req.c !== 'object') {
    return fail("Could not reach the editor's module cache." + outdated);
  }
  const mods = [];
  for (const m of Object.values(req.c)) {
    let e;
    try {
      e = m && m.exports;
    } catch {
      e = null;
    }
    if (e && typeof e === 'object') {
      mods.push(e);
      if (isObj(e, 'default')) mods.push(e.default);
    }
  }
  const Layers = mods.find((e) => isFn(e, 'add') && isFn(e, 'removeAll') && isFn(e, 'getLayers'));
  const Groups = mods.find((e) => isFn(e, 'loadGroups') && isFn(e, 'initObjects'));
  const Shapes = mods.find((e) => isObj(e, 'library') && isFn(e, 'create'));
  const lost = [];
  if (!Layers) lost.push('the layer manager (add, removeAll, getLayers)');
  if (!Groups) lost.push('the shape-group loader (loadGroups, initObjects)');
  if (!Shapes) lost.push('the shape library (library, create)');
  if (lost.length) return fail('Could not find ' + lost.join(' or ') + '.' + outdated);

  const layerCount = () => {
    try {
      const list = Layers.getLayers();
      return list && typeof list.length === 'number' ? list.length : 0;
    } catch {
      return -1;
    }
  };
  if (layerCount() < 0) return fail('The layer manager did not answer getLayers().' + outdated);

  // 3. Load every shape group the design needs and wait for its shapes.
  const slugs = Array.from(new Set(DATA.map((d) => String(d[0]))));
  const missing = () => slugs.filter((s) => !isObj(Shapes.library, s));
  if (missing().length) {
    const groups = Array.from(new Set(missing().map((s) => GROUP_PREFIX + s.split('/')[0])));
    log('loading shape groups: ' + groups.join(', '));
    try {
      Groups.loadGroups(groups, () => {});
    } catch {
      return fail('The shape-group loader refused to load ' + groups.join(', ') + '.' + outdated);
    }
    const t0 = Date.now();
    while (missing().length && Date.now() - t0 < 20000) await sleep(150);
  }
  if (missing().length) {
    return fail('These shapes are not in the editor library: ' + missing().join(', ') + '.' + outdated);
  }

  // 4. Estimate the save size with the real path lengths and ask before importing too much.
  let estimate = 0;
  for (const d of DATA) {
    const lib = Shapes.library[d[0]];
    const pathLen = typeof lib.path === 'string' && lib.path ? lib.path.length : NO_PATH_LEN;
    estimate += (4 / 3) * (742 + 1.2 * pathLen + String(d[10]).length);
  }
  estimate = Math.round(estimate);
  log(
    DATA.length +
      ' layers, estimated save size ' +
      Math.round(estimate / 1024) +
      ' KB of ' +
      SAVE_MAX / 1024 +
      ' KB',
  );
  if (DATA.length > LAYERS_MAX || estimate > SAVE_MAX) {
    const why =
      DATA.length > LAYERS_MAX
        ? 'It has ' + DATA.length + ' layers; the editor allows ' + LAYERS_MAX + '.'
        : 'Its estimated save size is ' +
          Math.round(estimate / 1024) +
          ' KB; the editor allows ' +
          SAVE_MAX / 1024 +
          ' KB.';
    if (!confirm(TAG + '\n\nThis design is probably too large to save. ' + why + '\n\nImport it anyway?')) {
      return log('cancelled: design too large');
    }
  }

  // 5. Ask before replacing what is on the canvas, then clear it.
  const existing = layerCount();
  if (existing > 0) {
    const question =
      'The canvas has ' +
      existing +
      ' layer' +
      (existing === 1 ? '' : 's') +
      '. Replace ' +
      (existing === 1 ? 'it' : 'them') +
      ' with the imported design (' +
      DATA.length +
      ' layers)?' +
      '\n\nNothing is saved until you click Save.';
    if (!confirm(TAG + '\n\n' + question)) return log('cancelled: canvas left as it was');
    try {
      Layers.removeAll();
    } catch {
      return fail('The editor could not clear the canvas.' + outdated);
    }
    await sleep(700);
    const t0 = Date.now();
    while (layerCount() > 0 && Date.now() - t0 < 8000) await sleep(150);
    if (layerCount() > 0)
      return fail('The canvas did not clear. Delete the remaining layers by hand and run the script again.');
  }

  // 6. Add the layers. The editor rounds positions to whole pixels on creation and skips
  //    positions where x + y = 0, so the callback sets the exact values and redraws.
  let fixed = 0;
  let errors = 0;
  let flipMismatch = 0;
  const stamp = String(Date.now());
  DATA.forEach((d, i) => {
    const slug = d[0];
    const x = d[1];
    const y = d[2];
    const lib = Shapes.library[slug];
    const record = {
      id: 's' + stamp + String(100000 + i),
      name: String(d[10]),
      slug: slug,
      type: typeof lib.type === 'string' ? lib.type : 'path',
      x: x,
      y: y,
      width: lib.width,
      height: lib.height,
      scaleX: d[3],
      scaleY: d[4],
      rotation: d[5],
      opacity: d[6],
      invertedX: !!d[8],
      invertedY: !!d[9],
      index: i,
      color: d[7],
      isFilled: true,
      internal: false,
      locked: false,
      borderColor: '#a1a1a1',
      borderSize: 0,
      gradientStyle: 'Fill',
      tBold: false,
      tItalic: false,
      fontFamily: null,
    };
    try {
      Layers.add(slug, record, false, false, (layer) => {
        try {
          if (!layer) return;
          layer.x = x;
          layer.y = y;
          layer.rotation = d[5];
          layer._rotation = d[5];
          if (typeof layer.scaleX === 'number' && layer.scaleX < 0 !== d[3] < 0) flipMismatch++;
          if (typeof layer.scaleY === 'number' && layer.scaleY < 0 !== d[4] < 0) flipMismatch++;
          if (typeof layer.draw === 'function') layer.draw();
          fixed++;
        } catch {
          errors++;
        }
      });
    } catch {
      errors++;
    }
  });

  // 7. Wait until every layer is present, then report.
  const t1 = Date.now();
  while (layerCount() < DATA.length && fixed + errors < DATA.length && Date.now() - t1 < 90000)
    await sleep(200);
  await sleep(250);
  const added = Math.max(0, layerCount());
  if (errors) log(errors + ' layer(s) raised an error while being added');
  if (flipMismatch)
    log(flipMismatch + ' flip(s) differ from the design; please report this with the version number');
  let report = 'Added ' + added + ' of ' + DATA.length + ' layers.';
  if (added < DATA.length)
    report += ' Some layers are missing: the editor may have reached its limit of ' + LAYERS_MAX + '.';
  report +=
    '\n\nCheck the emblem, then click Save. It goes to My Emblems; your crew emblem only changes if you publish it yourself.' +
    '\n(The cyan handles are editor controls, not part of the emblem.)';
  log(report.replace(/\n+/g, ' '));
  alert(TAG + '\n\n' + report);
})();
