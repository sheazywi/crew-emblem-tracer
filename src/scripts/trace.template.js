/*
 * Crest Forge - trace script (generated; see docs/SECURITY.md in the Crest Forge repository).
 *
 * What it does: rebuilds the embedded picture in the crew emblem editor you have open, using
 * the editor's own shape library. It adds one shape at a time, each chosen by random search
 * plus hill climbing to reduce the colour error the most. The shapes never leave this page.
 * What it never does: no network requests, no reading of cookies, storage or tokens, no dynamic
 * code evaluation, no overriding of dialogs, and it never saves or publishes. You click Save.
 *
 * Not affiliated with or endorsed by Rockstar Games.
 */
(async () => {
  'use strict';
  const VERSION = '1.4.0';
  const TAG = 'Crest Forge v' + VERSION;
  const IMG = __IMG__;
  const OPT = __OPT__;

  // Observed, unofficial editor limits (measured November 2026).
  const CANVAS = 512;
  const LAYERS_AUTO = 740;
  const SAVE_AUTO = 960000;
  const SAVE_MAX = 1048576;
  const PATH_MAX = 4000;
  const PATH_MAX_ALL = 6000;
  const NO_PATH_LEN = 67;
  const NAME_LEN = 4;
  const SCALE_MIN = 1;
  const SCALE_MAX = 490;
  const GROUP_PREFIX = 'emblems/shapes/';
  const BG_SLUG = 'rectangles/square';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const opt = OPT && typeof OPT === 'object' ? OPT : {};
  const every = opt.groups === 'all';
  const dry = !!opt.dry;
  const quiet = !!opt.quiet;
  const auto = !!opt.auto;
  const userCount = clamp(Math.round(+opt.count) || LAYERS_AUTO, 1, LAYERS_AUTO);
  const A = clamp(+opt.alpha || 1, 0.2, 1);
  const R = clamp(Math.round(+opt.res) || 128, 32, 256);
  const K = clamp(Math.round(+opt.cand) || 60, 1, 400);
  const M = clamp(Math.round(+opt.mut) || 80, 1, 600);
  const wantBg = !!opt.bg;
  const minGain = clamp(+opt.minGain || 0, 0, 0.01);

  const log = (msg) => console.log('[' + TAG + '] ' + msg);
  const fail = (msg) => {
    console.warn('[' + TAG + '] ' + msg);
    if (dry) window.__crestForgeTrace = { version: VERSION, error: msg };
    if (!quiet) alert(TAG + '\n\n' + msg);
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
  const cost = (pathLen) => (4 / 3) * (742 + 1.2 * pathLen + NAME_LEN);
  const kb = (n) => Math.round(n / 1024) + ' KB';

  console.log(TAG + ' - trace script' + (dry ? ' (dry run)' : ''));

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

  // 3. Decode the embedded picture and downscale it so its long side is R pixels.
  if (typeof IMG !== 'string' || IMG.indexOf('data:image/') !== 0) {
    return fail('This script carries no picture. Copy it again from Crest Forge.');
  }
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('decode'));
      img.src = IMG;
    });
  } catch {
    return fail('The embedded picture could not be decoded. Copy the trace script again from Crest Forge.');
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return fail('The embedded picture is empty. Copy the trace script again from Crest Forge.');
  const W = Math.max(1, Math.round((iw * R) / Math.max(iw, ih)));
  const H = Math.max(1, Math.round((ih * R) / Math.max(iw, ih)));
  const N = W * H;
  const source = document.createElement('canvas');
  source.width = W;
  source.height = H;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  if (!sctx || !g || typeof Path2D !== 'function')
    return fail('This browser cannot rasterise shapes (Canvas 2D or Path2D is missing).');
  let px;
  try {
    sctx.drawImage(img, 0, 0, W, H);
    px = sctx.getImageData(0, 0, W, H).data;
  } catch {
    return fail('The embedded picture could not be read.');
  }

  // T = target RGB, Wt = weight (alpha), C = current canvas, started at the weighted mean.
  const T = new Float32Array(N * 3);
  const Wt = new Float32Array(N);
  const C = new Float32Array(N * 3);
  let sw = 0;
  const mean = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const w = px[i * 4 + 3] / 255;
    Wt[i] = w;
    sw += w;
    for (let c = 0; c < 3; c++) {
      T[i * 3 + c] = px[i * 4 + c];
      mean[c] += w * px[i * 4 + c];
    }
  }
  if (sw <= 0) return fail('The embedded picture is fully transparent.');
  for (let c = 0; c < 3; c++) mean[c] = clamp(Math.round(mean[c] / sw), 0, 255);
  for (let i = 0; i < N; i++) {
    C[i * 3] = mean[0];
    C[i * 3 + 1] = mean[1];
    C[i * 3 + 2] = mean[2];
  }
  const hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  // 4. Load the chosen shape groups (25 s timeout, plus 800 ms to settle).
  let names = [];
  if (every) {
    const all = Shapes.groups;
    if (Array.isArray(all)) {
      names = all
        .map((x) => (typeof x === 'string' ? x : x && (x.slug || x.name)))
        .filter((x) => typeof x === 'string');
    } else if (all && typeof all === 'object') {
      names = Object.keys(all);
    }
    if (!names.length) return fail('The editor did not list its shape groups.' + outdated);
  } else {
    names = Array.isArray(opt.groups) ? opt.groups.filter((x) => typeof x === 'string') : [];
    if (!names.length)
      return fail(
        'No shape families were chosen. Tick at least one in Crest Forge and copy the script again.',
      );
  }
  names = names.map((n) => String(n).split('/').pop());
  const wanted = new Set(names);
  const toLoad = names.slice();
  if (wantBg && !wanted.has(BG_SLUG.split('/')[0])) toLoad.push(BG_SLUG.split('/')[0]);
  log('loading ' + toLoad.length + ' shape group(s)...');
  const loaded = await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 25000);
    try {
      Groups.loadGroups(
        toLoad.map((n) => GROUP_PREFIX + n),
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(true);
          }
        },
      );
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
  await sleep(800);
  if (!loaded) log('the shape groups did not finish loading in time; using the shapes that are there');

  // 5. Collect every eligible library shape. Long paths cost too much save size and are skipped.
  const pathMax = every ? PATH_MAX_ALL : PATH_MAX;
  const shapes = [];
  let skippedLong = 0;
  for (const slug of Object.keys(Shapes.library)) {
    const e = Shapes.library[slug];
    if (!e || typeof e !== 'object') continue;
    const own = Array.isArray(e.groups) ? e.groups : typeof e.groups === 'string' ? [e.groups] : [];
    const inGroup =
      every || wanted.has(slug.split('/')[0]) || own.some((x) => wanted.has(String(x).split('/').pop()));
    if (!inGroup) continue;
    const w = +e.width;
    const h = +e.height;
    if (!(w > 0 && h > 0)) continue;
    const hasPath = typeof e.path === 'string' && e.path.length > 0;
    if (!hasPath && e.type !== 'rectangle') continue;
    const pathLen = hasPath ? e.path.length : NO_PATH_LEN;
    if (pathLen > pathMax) {
      skippedLong++;
      continue;
    }
    let path;
    try {
      path = new Path2D(hasPath ? e.path : 'M0,0H' + w + 'V' + h + 'H0Z');
    } catch {
      continue;
    }
    shapes.push({
      slug: slug,
      w: w,
      h: h,
      path: path,
      cost: cost(pathLen),
      type: typeof e.type === 'string' ? e.type : 'path',
    });
  }
  if (!shapes.length) return fail('No usable shapes were found in the chosen groups.' + outdated);
  log(
    shapes.length + ' shapes eligible' + (skippedLong ? ', ' + skippedLong + ' skipped (path too long)' : ''),
  );

  // 6. Automatic shape budget: the largest count that stays under both limits.
  const k = CANVAS / Math.max(W, H);
  const ox = (CANVAS - W * k) / 2;
  const oy = (CANVAS - H * k) / 2;
  const bgLib = wantBg && isObj(Shapes.library, BG_SLUG) ? Shapes.library[BG_SLUG] : null;
  if (wantBg && !bgLib)
    log('the background square is not in the library; continuing without a background layer');
  const bgLayers = bgLib ? 1 : 0;
  const bgCost = bgLib ? cost(NO_PATH_LEN) : 0;
  let meanCost = 0;
  let minCost = Infinity;
  let maxCost = 0;
  for (const s of shapes) {
    meanCost += s.cost / shapes.length;
    minCost = Math.min(minCost, s.cost);
    maxCost = Math.max(maxCost, s.cost);
  }
  const byLayers = LAYERS_AUTO - bgLayers;
  const bySize = Math.floor((SAVE_AUTO - bgCost) / meanCost);
  const nMax = Math.max(0, Math.min(byLayers, bySize));
  const binding = bySize < byLayers ? 'size' : 'layers';
  const bindingText =
    binding === 'size'
      ? 'limited by save size (layer limit ' + LAYERS_AUTO + ')'
      : 'limited by the layer limit (' + LAYERS_AUTO + ')';
  const target = auto ? LAYERS_AUTO : Math.min(nMax, userCount);
  log('Up to ' + nMax + ' shapes fit, ' + bindingText + (auto ? '' : '; tracing ' + target));

  // 7. Ask before replacing what is on the canvas, then clear it (never in a dry run).
  if (!dry) {
    const existing = layerCount();
    if (existing > 0) {
      const question =
        'The canvas has ' +
        existing +
        ' layer' +
        (existing === 1 ? '' : 's') +
        '. Replace ' +
        (existing === 1 ? 'it' : 'them') +
        ' with a trace of the picture (up to ' +
        Math.min(nMax, target) +
        ' shapes)?' +
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
        return fail(
          'The canvas did not clear. Delete the remaining layers by hand and run the script again.',
        );
    }
  }

  // --- rasterising and scoring --------------------------------------------------------------
  const sMin = SCALE_MIN / 100 / k;
  const sMax = SCALE_MAX / 100 / k;
  let bx = 0;
  let by = 0;
  let bw = 0;
  let bh = 0;
  let cov = null;
  let col0 = 0;
  let col1 = 0;
  let col2 = 0;

  // Draw one candidate with the editor's transform and read back only its rotated bounding
  // box. Alpha is antialiased coverage, which makes the colour fit match the editor's rendering.
  const draw = (c) => {
    const s = shapes[c.i];
    const cos = Math.cos(c.r);
    const sin = Math.sin(c.r);
    const hw = (Math.abs(c.sx) * s.w) / 2;
    const hh = (Math.abs(c.sy) * s.h) / 2;
    const ex = Math.abs(cos) * hw + Math.abs(sin) * hh;
    const ey = Math.abs(sin) * hw + Math.abs(cos) * hh;
    bx = Math.max(0, Math.floor(c.x - ex - 1));
    by = Math.max(0, Math.floor(c.y - ey - 1));
    bw = Math.min(W, Math.ceil(c.x + ex + 1)) - bx;
    bh = Math.min(H, Math.ceil(c.y + ey + 1)) - by;
    if (bw <= 0 || bh <= 0) return false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(bx, by, bw, bh);
    g.save();
    g.beginPath();
    g.rect(bx, by, bw, bh);
    g.clip();
    g.setTransform(cos * c.sx, sin * c.sx, -sin * c.sy, cos * c.sy, c.x, c.y);
    g.translate(-s.w / 2, -s.h / 2);
    g.fill(s.path);
    g.restore();
    cov = g.getImageData(bx, by, bw, bh).data;
    return true;
  };

  // Best flat colour c = sum(Wt m (T - C(1 - m))) / sum(Wt m^2), and the change in error.
  const score = (c) => {
    if (!draw(c)) return 0;
    let sM2 = 0;
    let d0 = 0;
    let d1 = 0;
    let d2 = 0;
    let sFF = 0;
    let sE = 0;
    for (let yy = 0; yy < bh; yy++) {
      let i = (by + yy) * W + bx;
      let q = yy * bw * 4 + 3;
      for (let xx = 0; xx < bw; xx++, i++, q += 4) {
        const a = cov[q];
        if (a === 0) continue;
        const w = Wt[i];
        if (w <= 0) continue;
        const m = (a / 255) * A;
        const j = i * 3;
        const e0 = T[j] - C[j];
        const e1 = T[j + 1] - C[j + 1];
        const e2 = T[j + 2] - C[j + 2];
        const f0 = T[j] - C[j] * (1 - m);
        const f1 = T[j + 1] - C[j + 1] * (1 - m);
        const f2 = T[j + 2] - C[j + 2] * (1 - m);
        sM2 += w * m * m;
        d0 += w * m * f0;
        d1 += w * m * f1;
        d2 += w * m * f2;
        sFF += w * (f0 * f0 + f1 * f1 + f2 * f2);
        sE += w * (e0 * e0 + e1 * e1 + e2 * e2);
      }
    }
    if (sM2 <= 1e-9) return 0;
    col0 = clamp(Math.round(d0 / sM2), 0, 255);
    col1 = clamp(Math.round(d1 / sM2), 0, 255);
    col2 = clamp(Math.round(d2 / sM2), 0, 255);
    return (
      sFF - 2 * (col0 * d0 + col1 * d1 + col2 * d2) + (col0 * col0 + col1 * col1 + col2 * col2) * sM2 - sE
    );
  };

  const composite = (c, r, gr, b) => {
    if (!draw(c)) return;
    for (let yy = 0; yy < bh; yy++) {
      let i = (by + yy) * W + bx;
      let q = yy * bw * 4 + 3;
      for (let xx = 0; xx < bw; xx++, i++, q += 4) {
        const a = cov[q];
        if (a === 0) continue;
        const m = (a / 255) * A;
        const j = i * 3;
        C[j] = C[j] * (1 - m) + r * m;
        C[j + 1] = C[j + 1] * (1 - m) + gr * m;
        C[j + 2] = C[j + 2] * (1 - m) + b * m;
      }
    }
  };

  const gauss = () => {
    let u = Math.random();
    if (u < 1e-12) u = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  };
  const fit = (c) => {
    const ax = clamp(Math.abs(c.sx), sMin, sMax);
    const ay = clamp(Math.abs(c.sy), sMin, sMax);
    c.sx = c.sx < 0 ? -ax : ax;
    c.sy = c.sy < 0 ? -ay : ay;
    c.x = clamp(c.x, 0, W);
    c.y = clamp(c.y, 0, H);
    return c;
  };
  // Shapes fitted to flat-colour regions of the picture, offered as candidates at every step,
  // so a flat disc (a sun, a coin) becomes one circle instead of many patches. Flood fill with a
  // colour tolerance, then second moments: a uniform disc of radius r has variance r^2/4 and a
  // rectangle of half-width a has variance a^2/3. Uses the editor's own circle and square.
  const regionSeeds = () => {
    const circleIndex = shapes.findIndex((x) => x.slug === 'rounds/01');
    const squareIndex = shapes.findIndex((x) => x.slug === 'rectangles/square');
    if (circleIndex < 0 && squareIndex < 0) return [];
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    const minArea = Math.max(12, N * 0.002);
    const tol2 = 34 * 34;
    const found = [];
    for (let start = 0; start < N; start++) {
      if (seen[start] || Wt[start] < 0.5) continue;
      const r0 = T[start * 3];
      const g0 = T[start * 3 + 1];
      const b0 = T[start * 3 + 2];
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      while (top > 0) {
        const i = stack[--top];
        const px = i % W;
        const x = px + 0.5;
        const y = Math.floor(i / W) + 0.5;
        n++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        for (let d = 0; d < 4; d++) {
          if ((d === 0 && px === 0) || (d === 1 && px === W - 1)) continue;
          const j = d === 0 ? i - 1 : d === 1 ? i + 1 : d === 2 ? i - W : i + W;
          if (j < 0 || j >= N || seen[j] || Wt[j] < 0.5) continue;
          const dr = T[j * 3] - r0;
          const dg = T[j * 3 + 1] - g0;
          const db = T[j * 3 + 2] - b0;
          if (dr * dr + dg * dg + db * db > tol2) continue;
          seen[j] = 1;
          stack[top++] = j;
        }
      }
      if (n < minArea || n > N * 0.9) continue;
      const cx = sx / n;
      const cy = sy / n;
      const vxx = sxx / n - cx * cx;
      const vyy = syy / n - cy * cy;
      const vxy = sxy / n - cx * cy;
      const mid = (vxx + vyy) / 2;
      const dev = Math.sqrt(((vxx - vyy) / 2) * ((vxx - vyy) / 2) + vxy * vxy);
      const l1 = Math.max(0.05, mid + dev);
      const l2 = Math.max(0.05, mid - dev);
      const rot = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
      found.push({ n: n, cx: cx, cy: cy, l1: l1, l2: l2, rot: rot });
    }
    found.sort((a, b) => b.n - a.n);
    const out = [];
    for (const g of found.slice(0, 48)) {
      if (circleIndex >= 0) {
        const c = shapes[circleIndex];
        out.push(
          fit({
            i: circleIndex,
            x: g.cx,
            y: g.cy,
            r: g.rot,
            sx: (2 * Math.sqrt(g.l1)) / (c.w / 2),
            sy: (2 * Math.sqrt(g.l2)) / (c.h / 2),
          }),
        );
      }
      if (squareIndex >= 0) {
        const q = shapes[squareIndex];
        out.push(
          fit({
            i: squareIndex,
            x: g.cx,
            y: g.cy,
            r: g.rot,
            sx: Math.sqrt(3 * g.l1) / (q.w / 2),
            sy: Math.sqrt(3 * g.l2) / (q.h / 2),
          }),
        );
      }
    }
    return out;
  };

  // Random size 4% to 64% of R (skewed small), aspect 0.6 to 1.4, random horizontal flip.
  const randomCandidate = (pool) => {
    const i = pool[Math.floor(Math.random() * pool.length)];
    const s = shapes[i];
    const u = Math.random();
    const size = R * (0.04 + 0.6 * u * u);
    const aspect = 0.6 + 0.8 * Math.random();
    const base = size / Math.max(s.w, s.h);
    let sx = base * Math.sqrt(aspect);
    const sy = base / Math.sqrt(aspect);
    if (Math.random() < 0.5) sx = -sx;
    return fit({
      i: i,
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * Math.PI * 2,
      sx: sx,
      sy: sy,
    });
  };
  // One mutation per step, chosen uniformly.
  const mutate = (c, pool) => {
    const n = { i: c.i, x: c.x, y: c.y, r: c.r, sx: c.sx, sy: c.sy };
    const move = (sigma) => {
      n.x += gauss() * sigma * R;
      n.y += gauss() * sigma * R;
    };
    switch (Math.floor(Math.random() * 7)) {
      case 0:
        // Step sizes from 4% of R down to 0.25%, so edges can be fitted closely.
        move(0.04 * Math.pow(2, -Math.floor(Math.random() * 5)));
        break;
      case 1:
        n.sx *= Math.exp(gauss() * 0.15);
        break;
      case 2:
        n.sy *= Math.exp(gauss() * 0.15);
        break;
      case 3: {
        const f = Math.exp(gauss() * 0.15);
        n.sx *= f;
        n.sy *= f;
        break;
      }
      case 4:
        n.r += gauss() * 0.2;
        break;
      case 5: {
        // Swap to another shape keeping the on-canvas size (30% of this branch), else a fine move.
        const j = pool[Math.floor(Math.random() * pool.length)];
        if (Math.random() < 0.3 && j !== c.i) {
          const from = shapes[c.i];
          const to = shapes[j];
          n.sx = (c.sx * from.w) / to.w;
          n.sy = (c.sy * from.h) / to.h;
          n.i = j;
        } else {
          move(0.01);
        }
        break;
      }
      default:
        n.sx = -n.sx;
    }
    return fit(n);
  };

  // --- adding layers to the editor ----------------------------------------------------------
  const r2 = (v) => Math.round(v * 100) / 100;
  const result = []; // packed layers: [slug, x, y, scaleX, scaleY, rotation, opacity, color, invX, invY, name]
  let used = 0;
  let expected = 0;
  let addErrors = 0;
  const stamp = String(Date.now());
  const addToEditor = (p, lib) => {
    const record = {
      id: 's' + stamp + String(100000 + expected),
      name: p[10],
      slug: p[0],
      type: typeof lib.type === 'string' ? lib.type : 'path',
      x: p[1],
      y: p[2],
      width: lib.width,
      height: lib.height,
      scaleX: p[3],
      scaleY: p[4],
      rotation: p[5],
      opacity: p[6],
      invertedX: p[8],
      invertedY: p[9],
      index: expected,
      color: p[7],
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
    expected++;
    try {
      // The editor rounds positions on creation and skips x + y = 0: set exact values, redraw.
      Layers.add(p[0], record, false, false, (layer) => {
        try {
          if (!layer) return;
          layer.x = p[1];
          layer.y = p[2];
          layer.rotation = p[5];
          layer._rotation = p[5];
          if (typeof layer.draw === 'function') layer.draw();
        } catch {
          addErrors++;
        }
      });
    } catch {
      addErrors++;
    }
  };
  const accept = (p, lib, bytes) => {
    result.push(p);
    used += bytes;
    if (!dry) addToEditor(p, lib);
  };

  // --- progress panel -----------------------------------------------------------------------
  let stopRequested = false;
  const panel = document.createElement('div');
  const label = document.createElement('div');
  const button = document.createElement('button');
  panel.setAttribute('role', 'status');
  panel.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:99999;min-width:230px;padding:12px 14px;border:1px solid #f5a524;' +
    'border-radius:8px;background:#12161b;color:#f4ead2;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  button.type = 'button';
  button.textContent = 'Stop';
  button.style.cssText =
    'margin-top:8px;padding:4px 14px;border:1px solid #f5a524;border-radius:6px;background:#f5a524;color:#12161b;font:inherit;cursor:pointer';
  button.addEventListener('click', () => {
    stopRequested = true;
  });
  panel.appendChild(label);
  panel.appendChild(button);
  document.body.appendChild(panel);
  let made = 0;
  const moreFit = () => {
    const meanSoFar = made > 0 ? (used - bgCost) / made : meanCost;
    return Math.max(0, Math.min(LAYERS_AUTO - result.length, Math.floor((SAVE_AUTO - used) / meanSoFar)));
  };
  const showProgress = () => {
    label.textContent =
      TAG +
      (dry ? ' (dry run)' : '') +
      ': ' +
      made +
      ' shapes, ' +
      kb(used) +
      ', about ' +
      moreFit() +
      ' more fit';
  };

  let stoppedBy = '';
  const started = Date.now();
  try {
    if (bgLib) {
      const bw0 = +bgLib.width;
      const bh0 = +bgLib.height;
      const p = [
        BG_SLUG,
        r2(CANVAS / 2 - bw0 / 2),
        r2(CANVAS / 2 - bh0 / 2),
        r2(((W * k) / bw0) * 100),
        r2(((H * k) / bh0) * 100),
        0,
        100,
        hex(mean),
        false,
        false,
        'bg',
      ];
      accept(p, bgLib, bgCost);
    }
    showProgress();

    // 8. The greedy loop: K random candidates, then hill climbing until M mutations in a row fail.
    let startError = 0;
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 3; c++)
        startError += Wt[i] * (T[i * 3 + c] - C[i * 3 + c]) * (T[i * 3 + c] - C[i * 3 + c]);
    }
    const gainFloor = minGain * startError;
    const recent = [];
    const everyIndex = shapes.map((s, i) => i);
    const seeds = regionSeeds();
    let misses = 0;
    let turn = 0;
    while (!stoppedBy) {
      if (stopRequested) {
        stoppedBy = 'you pressed Stop';
        break;
      }
      if (result.length >= LAYERS_AUTO) {
        stoppedBy = 'the layer limit (' + LAYERS_AUTO + ')';
        break;
      }
      if (!auto && made >= target) {
        stoppedBy =
          made >= userCount ? 'the shape count you chose' : 'the shape budget (' + bindingText + ')';
        break;
      }
      // Only pick candidates that still fit the save budget.
      const room = SAVE_AUTO - used;
      const pool = room >= maxCost ? everyIndex : everyIndex.filter((i) => shapes[i].cost <= room);
      if (!pool.length || room < minCost) {
        stoppedBy = 'the save-size budget (' + kb(SAVE_AUTO) + ')';
        break;
      }
      let best = randomCandidate(pool);
      let bestE = score(best);
      let b0 = col0;
      let b1 = col1;
      let b2 = col2;
      for (const seedCandidate of seeds) {
        if (shapes[seedCandidate.i].cost > room) continue;
        const e = score(seedCandidate);
        if (e < bestE) {
          best = Object.assign({}, seedCandidate);
          bestE = e;
          b0 = col0;
          b1 = col1;
          b2 = col2;
        }
      }
      for (let n = 1; n < K; n++) {
        const c = randomCandidate(pool);
        const e = score(c);
        if (e < bestE) {
          best = c;
          bestE = e;
          b0 = col0;
          b1 = col1;
          b2 = col2;
        }
      }
      let fails = 0;
      while (fails < M) {
        const c = mutate(best, pool);
        const e = score(c);
        if (e < bestE) {
          best = c;
          bestE = e;
          b0 = col0;
          b1 = col1;
          b2 = col2;
          fails = 0;
        } else {
          fails++;
        }
      }
      if (bestE < -1e-6) {
        misses = 0;
        composite(best, b0, b1, b2);
        made++;
        const s = shapes[best.i];
        const scaleX = r2(best.sx * k * 100);
        const scaleY = r2(best.sy * k * 100);
        const turned = r2(((((best.r * 180) / Math.PI) % 360) + 360) % 360);
        const rotation = turned >= 360 ? 0 : turned;
        const p = [
          s.slug,
          r2(ox + best.x * k - s.w / 2),
          r2(oy + best.y * k - s.h / 2),
          scaleX,
          scaleY,
          rotation,
          Math.round(A * 100),
          hex([b0, b1, b2]),
          scaleX < 0,
          scaleY < 0,
          't' + made,
        ];
        accept(p, Shapes.library[s.slug], s.cost);
        // Stop when more shapes stop helping: the last 10 improved the match by almost nothing.
        recent.push(-bestE);
        if (recent.length > 10) recent.shift();
        if (gainFloor > 0 && recent.length === 10 && recent.reduce((a, b) => a + b, 0) / 10 < gainFloor) {
          stoppedBy = 'more shapes no longer visibly improving the match';
        }
      } else if (++misses >= 12) {
        stoppedBy = 'no further improvement';
      }
      // Yield to the event loop every 2 shapes so the page stays responsive.
      if (++turn % 2 === 0) {
        showProgress();
        await sleep(0);
      }
    }

    // 9. Wait for the editor to finish adding the layers.
    if (!dry && expected > 0) {
      label.textContent = TAG + ': finishing ' + expected + ' layers...';
      const t1 = Date.now();
      while (layerCount() < expected && Date.now() - t1 < 90000) await sleep(200);
      await sleep(250);
    }
  } catch (e) {
    stoppedBy = 'an error: ' + (e && e.message ? e.message : String(e));
  } finally {
    panel.remove();
  }

  // 10. Report. Nothing is stored in the page except the dry-run result.
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (dry) {
    window.__crestForgeTrace = {
      version: VERSION,
      layers: result,
      bytes: Math.round(used),
      stoppedBy: stoppedBy,
      nMax: nMax,
      binding: binding,
      eligible: shapes.length,
      seconds: +seconds,
    };
  }
  const onCanvas = dry ? 0 : Math.max(0, layerCount());
  let report =
    (dry
      ? 'Dry run: traced ' + result.length + ' layers (nothing was added to the canvas).'
      : 'Added ' + onCanvas + ' of ' + expected + ' layers.') +
    ' Estimated save size ' +
    kb(used) +
    ' of ' +
    kb(SAVE_MAX) +
    '. Stopped by ' +
    stoppedBy +
    ' after ' +
    seconds +
    ' s.';
  if (addErrors) report += ' ' + addErrors + ' layer(s) raised an error while being added.';
  if (!dry) {
    report +=
      '\n\nCheck the emblem, then click Save. It goes to My Emblems; your crew emblem only changes if you publish it yourself.' +
      '\n(The cyan handles are editor controls, not part of the emblem.)';
  }
  log(report.replace(/\n+/g, ' '));
  if (!quiet) alert(TAG + '\n\n' + report);
})();
