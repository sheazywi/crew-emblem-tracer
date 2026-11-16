/**
 * Tracer A: greedy shape tracing with Crest Forge primitives.
 *
 * Add one shape at a time. Each is chosen by random search plus hill climbing to reduce the
 * squared colour error the most, with its colour solved exactly.
 *
 * IMPORTANT: `tracerCore` and `workerMain` are serialised with Function.prototype.toString()
 * and run inside a Blob-URL Web Worker. They must stay fully self-contained: no imports, no
 * references to anything outside their own bodies (types are fine, they are erased).
 */

export type ShapeKind = 'ellipse' | 'circle' | 'rect' | 'triangle';

export interface TraceShape {
  kind: ShapeKind;
  /**
   * Working-pixel parameters:
   * ellipse [cx, cy, rx, ry, rot], circle [cx, cy, r], rect [cx, cy, hw, hh, rot] (rot in
   * radians), triangle [x0, y0, x1, y1, x2, y2].
   */
  p: number[];
  color: [number, number, number];
  /**
   * 1-based indices of earlier shapes this one has completely covered. Only reported for
   * fully opaque traces, where a covered shape no longer changes a single pixel.
   */
  hides?: number[];
  /**
   * Placed under every shape traced so far instead of on top (opaque traces only). It then
   * changes only the pixels where the background still shows, so it never damages a region that
   * is already matched, such as a sun drawn earlier with one circle.
   */
  under?: boolean;
  /** How much this shape reduced the weighted squared error. */
  gain?: number;
}

export interface TraceInit {
  /** Target RGB, 3 floats per pixel. */
  T: Float32Array;
  /** Per-pixel weight = source alpha / 255, so transparent pixels are ignored. */
  Wt: Float32Array;
  W: number;
  H: number;
  kinds: ShapeKind[];
  /** Layer opacity, 0..1. */
  alpha: number;
  /** K random candidates per shape. */
  cand: number;
  /** Hill climbing stops after M failed mutations in a row. */
  mut: number;
  seed: number;
  /**
   * Stop early once the last 10 shapes improve the match, on average, by less than this
   * fraction of the starting error each (0 = never). Keeps simple pictures from spending
   * hundreds of layers on edge pixels that change nothing visible.
   */
  minGain?: number;
}

export interface TraceSession {
  /** Alpha-weighted mean colour: the starting canvas and the optional background layer. */
  bg: [number, number, number];
  /** Find, composite and return the next shape, or null when none improves the match. */
  step(): TraceShape | null;
  /** Current weighted squared error. */
  error(): number;
  /** Binary pixel coverage of a shape (for tests). */
  coverage(kind: ShapeKind, p: number[]): Uint8Array;
  /** Shapes fitted to flat-colour regions of the target, offered as candidates every step. */
  seeds: { kind: ShapeKind; p: number[] }[];
}

export type WorkerMessage =
  | { type: 'bg'; color: [number, number, number] }
  | { type: 'shape'; shape: TraceShape }
  | { type: 'done'; made: number; converged: boolean };

export function tracerCore(): { create(init: TraceInit): TraceSession } {
  function create(init: TraceInit): TraceSession {
    const T = init.T;
    const Wt = init.Wt;
    const W = init.W;
    const H = init.H;
    const N = W * H;
    const R = Math.max(W, H);
    const A = Math.min(1, Math.max(0.05, init.alpha));
    const K = Math.max(1, init.cand | 0);
    const M = Math.max(1, init.mut | 0);
    const kinds: ShapeKind[] = init.kinds.length ? init.kinds : ['ellipse'];

    let seed = init.seed >>> 0 || 0x9e3779b9;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = (): number => {
      let u = rnd();
      if (u < 1e-12) u = 1e-12;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * rnd());
    };
    const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

    // Current canvas C starts as the alpha-weighted mean colour.
    let sw = 0;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < N; i++) {
      const w = Wt[i];
      sw += w;
      m0 += w * T[i * 3];
      m1 += w * T[i * 3 + 1];
      m2 += w * T[i * 3 + 2];
    }
    const bg: [number, number, number] = sw > 0 ? [byte(m0 / sw), byte(m1 / sw), byte(m2 / sw)] : [0, 0, 0];
    const C = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      C[i * 3] = bg[0];
      C[i * 3 + 1] = bg[1];
      C[i * 3 + 2] = bg[2];
    }

    // Which accepted shape (1-based, 0 = background) is on top at each pixel, and how many
    // pixels each shape still owns. A shape that owns nothing is hidden.
    const owner = new Int32Array(N);
    const owned: number[] = [0];
    /** Colour of each accepted shape, by the same 1-based index. */
    const colours: number[][] = [[0, 0, 0]];

    /**
     * Fit shapes to flat-colour regions: flood fill with a colour tolerance, then turn each
     * region's second moments into an ellipse (a uniform disc of radius r has variance r^2/4),
     * a circle, and an oriented rectangle (variance a^2/3 for half-width a). A flat disc in the
     * picture, like a sun, is then one circle instead of dozens of patches.
     */
    function regionSeeds(): { kind: ShapeKind; p: number[] }[] {
      const want = kinds.filter((k) => k !== 'triangle');
      if (!want.length) return [];
      const seen = new Uint8Array(N);
      const stack = new Int32Array(N);
      const minArea = Math.max(12, N * 0.002);
      const tol2 = 34 * 34;
      const found: { n: number; out: { kind: ShapeKind; p: number[] }[] }[] = [];
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
          const x = (i % W) + 0.5;
          const y = Math.floor(i / W) + 0.5;
          n++;
          sx += x;
          sy += y;
          sxx += x * x;
          syy += y * y;
          sxy += x * y;
          const px = i % W;
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
        const dev = Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
        const l1 = Math.max(0.05, mid + dev);
        const l2 = Math.max(0.05, mid - dev);
        const rot = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
        const out: { kind: ShapeKind; p: number[] }[] = [];
        for (const kind of want) {
          if (kind === 'ellipse') out.push({ kind, p: [cx, cy, 2 * Math.sqrt(l1), 2 * Math.sqrt(l2), rot] });
          if (kind === 'circle') out.push({ kind, p: [cx, cy, 2 * Math.sqrt((l1 + l2) / 2)] });
          if (kind === 'rect') out.push({ kind, p: [cx, cy, Math.sqrt(3 * l1), Math.sqrt(3 * l2), rot] });
        }
        found.push({ n, out });
      }
      found.sort((a, b) => b.n - a.n);
      const seeds: { kind: ShapeKind; p: number[] }[] = [];
      for (const f of found.slice(0, 48)) seeds.push(...f.out);
      return seeds;
    }

    // Scanline buffer: inclusive pixel range per row for rows ya..yb (rowB < rowA = empty row).
    const rowA = new Int32Array(H);
    const rowB = new Int32Array(H);
    let ya = 0;
    let yb = -1;
    const qx = new Float64Array(4);
    const qy = new Float64Array(4);

    /** Analytic rasterisation into scanlines, sampling pixel centres. Coverage is binary. */
    function raster(kind: ShapeKind, p: number[]): void {
      ya = 0;
      yb = -1;
      if (kind === 'ellipse' || kind === 'circle') {
        const cx = p[0];
        const cy = p[1];
        const rx = Math.max(0.5, p[2]);
        const ry = Math.max(0.5, kind === 'circle' ? p[2] : p[3]);
        const rot = kind === 'circle' ? 0 : p[4];
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const irx = 1 / (rx * rx);
        const iry = 1 / (ry * ry);
        // Rotated-ellipse quadratic in dx for a given dy: a*dx^2 + b*dx + c = 0.
        const a = cos * cos * irx + sin * sin * iry;
        const bq = 2 * cos * sin * (irx - iry);
        const cq = sin * sin * irx + cos * cos * iry;
        const half = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
        ya = Math.max(0, Math.ceil(cy - half - 0.5));
        yb = Math.min(H - 1, Math.floor(cy + half - 0.5));
        for (let y = ya; y <= yb; y++) {
          const dy = y + 0.5 - cy;
          const b = bq * dy;
          const disc = b * b - 4 * a * (cq * dy * dy - 1);
          if (disc < 0) {
            rowA[y] = 1;
            rowB[y] = 0;
            continue;
          }
          const sq = Math.sqrt(disc);
          rowA[y] = Math.max(0, Math.ceil(cx + (-b - sq) / (2 * a) - 0.5));
          rowB[y] = Math.min(W - 1, Math.floor(cx + (-b + sq) / (2 * a) - 0.5));
        }
        return;
      }
      let n = 3;
      if (kind === 'rect') {
        n = 4;
        const cos = Math.cos(p[4]);
        const sin = Math.sin(p[4]);
        const hw = Math.max(0.5, p[2]);
        const hh = Math.max(0.5, p[3]);
        for (let i = 0; i < 4; i++) {
          const lx = i === 0 || i === 3 ? -hw : hw;
          const ly = i < 2 ? -hh : hh;
          qx[i] = p[0] + lx * cos - ly * sin;
          qy[i] = p[1] + lx * sin + ly * cos;
        }
      } else {
        for (let i = 0; i < 3; i++) {
          qx[i] = p[i * 2];
          qy[i] = p[i * 2 + 1];
        }
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        if (qy[i] < lo) lo = qy[i];
        if (qy[i] > hi) hi = qy[i];
      }
      ya = Math.max(0, Math.ceil(lo - 0.5));
      yb = Math.min(H - 1, Math.floor(hi - 0.5));
      for (let y = ya; y <= yb; y++) {
        const yc = y + 0.5;
        let xl = Infinity;
        let xr = -Infinity;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const y1 = qy[i];
          const y2 = qy[j];
          if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
            const x = qx[i] + ((yc - y1) * (qx[j] - qx[i])) / (y2 - y1);
            if (x < xl) xl = x;
            if (x > xr) xr = x;
          }
        }
        if (xl > xr) {
          rowA[y] = 1;
          rowB[y] = 0;
        } else {
          rowA[y] = Math.max(0, Math.ceil(xl - 0.5));
          rowB[y] = Math.min(W - 1, Math.floor(xr - 0.5));
        }
      }
    }

    // Colour and placement of the candidate scored last.
    let lastUnder = false;
    let c0 = 0;
    let c1 = 0;
    let c2 = 0;

    /**
     * Best flat colour and the change in error it brings, in one pass over covered pixels.
     * With D = T - C(1 - A): c = sum(Wt * D) / (A * sum(Wt)) and
     * |T - C'|^2 = D^2 - 2cA*D + c^2 A^2.
     */
    /**
     * Thin slivers fix a few edge pixels at working size but show as spikes on the 512 canvas,
     * and a scalene triangle costs two Social Club layers. A triangle must be at least 1.5
     * working px thick and at most about 8 times longer than it is thick.
     */
    function sliver(p: number[]): boolean {
      const area2 = Math.abs((p[2] - p[0]) * (p[5] - p[1]) - (p[3] - p[1]) * (p[4] - p[0]));
      const longest = Math.max(
        Math.hypot(p[2] - p[0], p[3] - p[1]),
        Math.hypot(p[4] - p[2], p[5] - p[3]),
        Math.hypot(p[0] - p[4], p[1] - p[5]),
      );
      const thickness = area2 / Math.max(longest, 1e-9);
      return thickness < 1.5 || thickness * 8 < longest;
    }

    function score(kind: ShapeKind, p: number[]): number {
      lastUnder = false;
      if (kind === 'triangle' && sliver(p)) return 0;
      raster(kind, p);
      // The shape that is on top at this candidate's centre, to spot re-tints (below).
      const mx = Math.floor(kind === 'triangle' ? (p[0] + p[2] + p[4]) / 3 : p[0]);
      const my = Math.floor(kind === 'triangle' ? (p[1] + p[3] + p[5]) / 3 : p[1]);
      const host = mx >= 0 && mx < W && my >= 0 && my < H ? owner[my * W + mx] : 0;
      let hostW = 0;
      const ia = 1 - A;
      let sW = 0;
      let d0 = 0;
      let d1 = 0;
      let d2 = 0;
      let sDD = 0;
      let sE = 0;
      // The same sums over the pixels that still show the background: the "under" placement.
      let uW = 0;
      let u0 = 0;
      let u1 = 0;
      let u2 = 0;
      let uDD = 0;
      let uE = 0;
      for (let y = ya; y <= yb; y++) {
        const xb = rowB[y];
        let i = y * W + rowA[y];
        const end = y * W + xb;
        for (; i <= end; i++) {
          const w = Wt[i];
          if (w <= 0) continue;
          const j = i * 3;
          const e0 = T[j] - C[j];
          const e1 = T[j + 1] - C[j + 1];
          const e2 = T[j + 2] - C[j + 2];
          const f0 = T[j] - C[j] * ia;
          const f1 = T[j + 1] - C[j + 1] * ia;
          const f2 = T[j + 2] - C[j + 2] * ia;
          sW += w;
          d0 += w * f0;
          d1 += w * f1;
          d2 += w * f2;
          const dd = w * (f0 * f0 + f1 * f1 + f2 * f2);
          const ee = w * (e0 * e0 + e1 * e1 + e2 * e2);
          sDD += dd;
          sE += ee;
          if (host > 0 && owner[i] === host) hostW += w;
          if (owner[i] === 0) {
            uW += w;
            u0 += w * f0;
            u1 += w * f1;
            u2 += w * f2;
            uDD += dd;
            uE += ee;
          }
        }
      }
      lastUnder = false;
      if (sW <= 0) return 0;
      const k = 1 / (A * sW);
      c0 = byte(d0 * k);
      c1 = byte(d1 * k);
      c2 = byte(d2 * k);
      let top = sDD - 2 * A * (c0 * d0 + c1 * d1 + c2 * d2) + A * A * sW * (c0 * c0 + c1 * c1 + c2 * c2) - sE;
      // A shape that mostly lies on one earlier shape and only shifts its colour by a barely
      // visible amount is not worth a layer: the classic case is a second, slightly smaller
      // sun painted over the first to correct its colour by two levels.
      if (host > 0 && hostW >= 0.85 * sW) {
        const hc = colours[host];
        if (Math.hypot(c0 - hc[0], c1 - hc[1], c2 - hc[2]) < 10) top = 0;
      }
      if (A < 0.999 || uW <= 0 || owned.length === 1) return top;
      const ku = 1 / (A * uW);
      const v0 = byte(u0 * ku);
      const v1 = byte(u1 * ku);
      const v2 = byte(u2 * ku);
      const under =
        uDD - 2 * A * (v0 * u0 + v1 * u1 + v2 * u2) + A * A * uW * (v0 * v0 + v1 * v1 + v2 * v2) - uE;
      if (under >= top) return top;
      lastUnder = true;
      c0 = v0;
      c1 = v1;
      c2 = v2;
      return under;
    }

    function composite(
      kind: ShapeKind,
      p: number[],
      r: number,
      g: number,
      b: number,
      under: boolean,
    ): number[] {
      raster(kind, p);
      const ia = 1 - A;
      const id = owned.length;
      owned.push(0);
      colours.push([r, g, b]);
      const hides: number[] = [];
      for (let y = ya; y <= yb; y++) {
        let i = y * W + rowA[y];
        const end = y * W + rowB[y];
        for (; i <= end; i++) {
          const prev = owner[i];
          if (under && prev !== 0) continue;
          if (prev > 0 && --owned[prev] === 0 && A >= 0.999) hides.push(prev);
          owner[i] = id;
          owned[id]++;
          const j = i * 3;
          C[j] = C[j] * ia + r * A;
          C[j + 1] = C[j + 1] * ia + g * A;
          C[j + 2] = C[j + 2] * ia + b * A;
        }
      }
      return hides;
    }

    function randomShape(): { kind: ShapeKind; p: number[] } {
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(rnd() * kinds.length))];
      const cx = rnd() * W;
      const cy = rnd() * H;
      const u = rnd();
      const size = R * (0.015 + 0.3 * u * u); // skewed small
      if (kind === 'circle') return { kind, p: [cx, cy, size] };
      if (kind === 'ellipse' || kind === 'rect') {
        return { kind, p: [cx, cy, size * (0.4 + rnd()), size * (0.4 + rnd()), rnd() * Math.PI] };
      }
      const a0 = rnd() * 6.283185307179586;
      const p: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = a0 + i * 2.0943951023931953 + (rnd() - 0.5) * 1.2;
        const d = size * (0.6 + rnd());
        p.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      }
      return { kind, p };
    }

    /** Move centre or one vertex (Gaussian, sigma about 8% of R), resize one axis, rotate. */
    function mutate(s: { kind: ShapeKind; p: number[] }): { kind: ShapeKind; p: number[] } {
      const p = s.p.slice();
      // Step sizes from 8% of R down to 0.5%, so edges can be fitted closely.
      const sg = 0.08 * R * Math.pow(2, -Math.floor(rnd() * 5));
      const pick = rnd();
      if (s.kind === 'triangle') {
        if (pick < 0.75) {
          const i = Math.min(2, Math.floor(rnd() * 3));
          p[i * 2] += gauss() * sg;
          p[i * 2 + 1] += gauss() * sg;
        } else {
          const dx = gauss() * sg;
          const dy = gauss() * sg;
          for (let i = 0; i < 3; i++) {
            p[i * 2] += dx;
            p[i * 2 + 1] += dy;
          }
        }
        for (let i = 0; i < 3; i++) {
          p[i * 2] = Math.min(W + R * 0.25, Math.max(-R * 0.25, p[i * 2]));
          p[i * 2 + 1] = Math.min(H + R * 0.25, Math.max(-R * 0.25, p[i * 2 + 1]));
        }
        return { kind: s.kind, p };
      }
      const move = (): void => {
        p[0] = Math.min(W, Math.max(0, p[0] + gauss() * sg));
        p[1] = Math.min(H, Math.max(0, p[1] + gauss() * sg));
      };
      const resize = (i: number): void => {
        p[i] = Math.min(R, Math.max(0.75, p[i] + gauss() * sg * 0.5));
      };
      if (s.kind === 'circle') {
        if (pick < 0.5) move();
        else resize(2);
      } else if (pick < 0.34) move();
      else if (pick < 0.56) resize(2);
      else if (pick < 0.78) resize(3);
      else p[4] += (rnd() - 0.5) * 0.6; // +-0.3 rad
      return { kind: s.kind, p };
    }

    function step(): TraceShape | null {
      let best = randomShape();
      let bestE = score(best.kind, best.p);
      let b0 = c0;
      let b1 = c1;
      let b2 = c2;
      let bu = lastUnder;
      for (const s of seeds) {
        const e = score(s.kind, s.p);
        if (e < bestE) {
          best = { kind: s.kind, p: s.p.slice() };
          bestE = e;
          b0 = c0;
          b1 = c1;
          b2 = c2;
          bu = lastUnder;
        }
      }
      for (let k = 1; k < K; k++) {
        const s = randomShape();
        const e = score(s.kind, s.p);
        if (e < bestE) {
          best = s;
          bestE = e;
          b0 = c0;
          b1 = c1;
          b2 = c2;
          bu = lastUnder;
        }
      }
      let fails = 0;
      while (fails < M) {
        const s = mutate(best);
        const e = score(s.kind, s.p);
        if (e < bestE) {
          best = s;
          bestE = e;
          b0 = c0;
          b1 = c1;
          b2 = c2;
          bu = lastUnder;
          fails = 0;
        } else {
          fails++;
        }
      }
      if (!(bestE < -1e-6)) return null;
      const hides = composite(best.kind, best.p, b0, b1, b2, bu);
      const shape: TraceShape = { kind: best.kind, p: best.p, color: [b0, b1, b2] };
      if (hides.length) shape.hides = hides;
      if (bu) shape.under = true;
      shape.gain = -bestE;
      return shape;
    }

    function error(): number {
      let e = 0;
      for (let i = 0; i < N; i++) {
        const w = Wt[i];
        if (w <= 0) continue;
        const j = i * 3;
        const e0 = T[j] - C[j];
        const e1 = T[j + 1] - C[j + 1];
        const e2 = T[j + 2] - C[j + 2];
        e += w * (e0 * e0 + e1 * e1 + e2 * e2);
      }
      return e;
    }

    function coverage(kind: ShapeKind, p: number[]): Uint8Array {
      const out = new Uint8Array(N);
      raster(kind, p);
      for (let y = ya; y <= yb; y++) {
        for (let x = rowA[y]; x <= rowB[y]; x++) out[y * W + x] = 1;
      }
      return out;
    }

    const seeds = regionSeeds();
    return { bg, step, error, coverage, seeds };
  }

  return { create };
}

/** Entry point of the worker. Posts one message per accepted shape. */
export function workerMain(factory: typeof tracerCore): void {
  const scope = self as unknown as {
    onmessage: ((ev: MessageEvent) => void) | null;
    postMessage(msg: WorkerMessage): void;
  };
  scope.onmessage = (ev) => {
    const init = ev.data as TraceInit & { count: number };
    const session = factory().create(init);
    scope.postMessage({ type: 'bg', color: session.bg });
    const floor = (init.minGain || 0) * session.error();
    const recent: number[] = [];
    let made = 0;
    let misses = 0;
    let settled = false;
    while (made < init.count && misses < 30 && !settled) {
      const shape = session.step();
      if (shape) {
        made++;
        misses = 0;
        scope.postMessage({ type: 'shape', shape });
        recent.push(shape.gain || 0);
        if (recent.length > 10) recent.shift();
        if (floor > 0 && recent.length === 10 && recent.reduce((a, b) => a + b, 0) / 10 < floor)
          settled = true;
      } else {
        misses++;
      }
    }
    scope.postMessage({ type: 'done', made, converged: made < init.count });
  };
}

/** Source text for the Blob-URL worker. */
export function workerSource(): string {
  return `(${workerMain.toString()})(${tracerCore.toString()});`;
}
