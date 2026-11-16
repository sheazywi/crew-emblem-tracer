import { describe, expect, it } from 'vitest';
import { outlineLocal, toWorld } from '../src/render/geometry';
import { tracerCore, workerSource, type ShapeKind, type TraceInit, type TraceShape } from '../src/trace/core';
import { backgroundLayer, hex, shapeToLayer, traceMap } from '../src/trace/toLayer';

const W = 48;
const H = 40;

/** White field, a red disc and a blue rotated bar; the right-hand strip is transparent. */
function target(): { T: Float32Array; Wt: Float32Array } {
  const T = new Float32Array(W * H * 3);
  const Wt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let c = [255, 255, 255];
      if (Math.hypot(x + 0.5 - 15, y + 0.5 - 15) < 9) c = [220, 30, 30];
      const u = (x - 30) * 0.8 + (y - 26) * 0.6;
      const v = -(x - 30) * 0.6 + (y - 26) * 0.8;
      if (Math.abs(u) < 12 && Math.abs(v) < 4) c = [20, 40, 200];
      T.set(c, i * 3);
      Wt[i] = x >= 44 ? 0 : 1;
    }
  }
  return { T, Wt };
}

const init = (over: Partial<TraceInit> = {}): TraceInit => ({
  ...target(),
  W,
  H,
  kinds: ['ellipse', 'circle', 'rect', 'triangle'],
  alpha: 1,
  cand: 30,
  mut: 40,
  seed: 42,
  ...over,
});

describe('Tracer A core', () => {
  it('starts from the alpha-weighted mean colour', () => {
    const { T, Wt } = target();
    const s = tracerCore().create(init());
    let sw = 0;
    const m = [0, 0, 0];
    for (let i = 0; i < W * H; i++) {
      sw += Wt[i];
      for (let c = 0; c < 3; c++) m[c] += Wt[i] * T[i * 3 + c];
    }
    expect(s.bg).toEqual(m.map((v) => Math.round(v / sw)));
  });

  it('only accepts shapes that reduce the error, and converges on the picture', () => {
    const s = tracerCore().create(init());
    const start = s.error();
    let last = start;
    let made = 0;
    for (let n = 0; n < 40; n++) {
      const shape = s.step();
      if (!shape) continue;
      made++;
      const now = s.error();
      expect(now).toBeLessThan(last);
      last = now;
      for (const c of shape.color) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
    expect(made).toBeGreaterThan(5);
    expect(last).toBeLessThan(start * 0.08);
  });

  it('is deterministic for a given seed', () => {
    const run = (seed: number): string => {
      const s = tracerCore().create(init({ seed }));
      return JSON.stringify([s.step(), s.step(), s.step()]);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it('works with semi-transparent layers and any subset of shape kinds', () => {
    for (const kinds of [['circle'], ['rect'], ['triangle'], ['ellipse']] as ShapeKind[][]) {
      const s = tracerCore().create(init({ kinds, alpha: 0.5 }));
      const start = s.error();
      for (let n = 0; n < 25; n++) {
        const shape = s.step();
        if (shape) expect(shape.kind).toBe(kinds[0]);
      }
      expect(s.error()).toBeLessThan(start * 0.5);
    }
  });

  it('rasterises analytically at pixel centres', () => {
    const s = tracerCore().create(init());
    const inside: Record<ShapeKind, (p: number[], x: number, y: number) => boolean> = {
      circle: (p, x, y) => Math.hypot(x - p[0], y - p[1]) <= p[2],
      ellipse: (p, x, y) => {
        const u = (x - p[0]) * Math.cos(p[4]) + (y - p[1]) * Math.sin(p[4]);
        const v = -(x - p[0]) * Math.sin(p[4]) + (y - p[1]) * Math.cos(p[4]);
        return (u * u) / (p[2] * p[2]) + (v * v) / (p[3] * p[3]) <= 1;
      },
      rect: (p, x, y) => {
        const u = (x - p[0]) * Math.cos(p[4]) + (y - p[1]) * Math.sin(p[4]);
        const v = -(x - p[0]) * Math.sin(p[4]) + (y - p[1]) * Math.cos(p[4]);
        return Math.abs(u) <= p[2] && Math.abs(v) <= p[3];
      },
      triangle: (p, x, y) => {
        const side = (i: number): number => {
          const j = (i + 1) % 3;
          return (p[j * 2] - p[i * 2]) * (y - p[i * 2 + 1]) - (p[j * 2 + 1] - p[i * 2 + 1]) * (x - p[i * 2]);
        };
        const a = side(0);
        const b = side(1);
        const c = side(2);
        return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
      },
    };
    const cases: [ShapeKind, number[]][] = [
      ['circle', [20.3, 18.7, 9.4]],
      ['ellipse', [24.2, 19.1, 14.6, 6.3, 0.7]],
      ['ellipse', [3.5, 37.2, 9, 4, 2.1]], // partly off the canvas
      ['rect', [22.4, 17.3, 11.2, 5.1, 0.4]],
      ['triangle', [5.2, 4.1, 40.7, 12.3, 18.9, 36.6]],
    ];
    for (const [kind, p] of cases) {
      const cov = s.coverage(kind, p);
      let diff = 0;
      let count = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const want = inside[kind](p, x + 0.5, y + 0.5) ? 1 : 0;
          count += want;
          if (cov[y * W + x] !== want) diff++;
        }
      }
      expect(count).toBeGreaterThan(30);
      expect(diff, kind).toBeLessThanOrEqual(2); // ties exactly on an edge may fall either way
    }
  });

  it('serialises into a self-contained worker script', () => {
    const source = workerSource();
    expect(() => new Function(source)).not.toThrow();
    expect(source).not.toMatch(/\bimport\b|\brequire\(|__vite|__vitest/);
    // Run it against a fake worker scope to prove it has no outside references.
    const posted: { type: string }[] = [];
    const scope: {
      onmessage: ((ev: { data: unknown }) => void) | null;
      postMessage: (m: { type: string }) => void;
    } = {
      onmessage: null,
      postMessage: (m) => posted.push(m),
    };
    new Function('self', source)(scope);
    scope.onmessage?.({ data: { ...init(), count: 5 } });
    expect(posted[0].type).toBe('bg');
    expect(posted.filter((m) => m.type === 'shape')).toHaveLength(5);
    expect(posted[posted.length - 1]).toMatchObject({ type: 'done', made: 5, converged: false });
  });
});

describe('traced shapes to layers', () => {
  const map = traceMap(128, 64);

  it('fits the working image onto the 512 canvas, centred', () => {
    expect(map).toEqual({ k: 4, ox: 0, oy: 128 });
    const bg = backgroundLayer([10, 20, 30], 128, 64, map);
    expect(bg).toMatchObject({ type: 'rect', x: 256, y: 256, w: 512, h: 256, color: '#0a141e' });
    expect(hex([255, 0, 127.6])).toBe('#ff0080');
  });

  it('maps circles, ellipses and rectangles to editable layers', () => {
    const circle = shapeToLayer({ kind: 'circle', p: [10, 20, 5], color: [255, 0, 0] }, map, 0.8, 't1');
    expect(circle).toMatchObject({
      type: 'ellipse',
      x: 40,
      y: 208,
      w: 40,
      h: 40,
      rot: 0,
      color: '#ff0000',
      opacity: 0.8,
      name: 't1',
    });
    const rect = shapeToLayer(
      { kind: 'rect', p: [64, 32, 10, 4, Math.PI / 2], color: [0, 0, 0] },
      map,
      1,
      't2',
    );
    expect(rect).toMatchObject({ type: 'rect', x: 256, y: 256, w: 80, h: 32, rot: 90 });
    const ellipse = shapeToLayer({ kind: 'ellipse', p: [0, 0, 1, 2, -0.1], color: [0, 0, 0] }, map, 1, 't3');
    expect(ellipse.rot).toBeCloseTo(360 - (0.1 * 180) / Math.PI, 2);
  });

  it('maps a free triangle to a path layer with the same corners', () => {
    const p = [10, 5, 60, 20, 30, 50];
    const layer = shapeToLayer({ kind: 'triangle', p, color: [1, 2, 3] }, map, 1, 't4');
    expect(layer.type).toBe('path');
    const world = (outlineLocal(layer) ?? []).map((q) => toWorld(layer)(q[0], q[1]));
    for (let i = 0; i < 3; i++) {
      expect(world[i][0]).toBeCloseTo(p[i * 2] * 4, 6);
      expect(world[i][1]).toBeCloseTo(128 + p[i * 2 + 1] * 4, 6);
    }
  });
});

describe('Tracer A: flat regions become single shapes', () => {
  /** A flat red disc (radius 14) on a flat white field: the "sun" case. */
  function sun(): { T: Float32Array; Wt: Float32Array; W: number; H: number } {
    const W = 64;
    const H = 64;
    const T = new Float32Array(W * H * 3);
    const Wt = new Float32Array(W * H).fill(1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = Math.hypot(x + 0.5 - 40, y + 0.5 - 24) < 14;
        T.set(inside ? [230, 60, 20] : [255, 255, 255], (y * W + x) * 3);
      }
    }
    return { T, Wt, W, H };
  }

  it('fits a seed circle to the disc from its moments', () => {
    const s = tracerCore().create({ ...sun(), kinds: ['circle'], alpha: 1, cand: 1, mut: 1, seed: 1 });
    const disc = s.seeds.find((c) => Math.hypot(c.p[0] - 40, c.p[1] - 24) < 0.5);
    expect(disc).toBeDefined();
    expect(Math.abs((disc as { p: number[] }).p[2] - 14)).toBeLessThan(0.5);
  });

  it('draws the sun with one circle, not dozens of patches', () => {
    for (const kinds of [
      ['ellipse', 'circle', 'rect', 'triangle'],
      ['circle'],
      ['ellipse'],
    ] as ShapeKind[][]) {
      const s = tracerCore().create({ ...sun(), kinds, alpha: 1, cand: 30, mut: 40, seed: 3 });
      const start = s.error();
      const first = s.step();
      expect(first, kinds.join()).not.toBeNull();
      expect(['circle', 'ellipse']).toContain(first?.kind);
      expect(Math.hypot((first as TraceShape).p[0] - 40, (first as TraceShape).p[1] - 24)).toBeLessThan(1);
      expect((first as TraceShape).color).toEqual([230, 60, 20]);
      // Keep tracing: the rest of the picture is fixed around the sun, and no later shape
      // lands on the sun's interior to patch it.
      const later: TraceShape[] = [];
      for (let n = 0; n < 20; n++) {
        const shape = s.step();
        if (shape) later.push(shape);
      }
      const interior = (shape: TraceShape): number => {
        const cov = s.coverage(shape.kind, shape.p);
        let n = 0;
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 64; x++)
            if (cov[y * 64 + x] && Math.hypot(x + 0.5 - 40, y + 0.5 - 24) < 11) n++;
        return n;
      };
      expect(
        // Shapes placed under the trace sit behind the sun, so only those on top count.
        later.filter((shape) => !shape.under && interior(shape) > 0),
        kinds.join(),
      ).toEqual([]);
      // With the field placed under the sun, the whole picture is nearly exact.
      expect(s.error()).toBeLessThan(start * 0.03);
    }
  });

  it('reports earlier shapes that a later opaque shape covers completely', () => {
    const s = tracerCore().create({
      ...sun(),
      kinds: ['circle', 'rect'],
      alpha: 1,
      cand: 30,
      mut: 40,
      seed: 5,
    });
    let hidden = 0;
    const made: TraceShape[] = [];
    for (let n = 0; n < 40; n++) {
      const shape = s.step();
      if (!shape) continue;
      made.push(shape);
      for (const i of shape.hides ?? []) {
        expect(i).toBeGreaterThanOrEqual(1);
        expect(i).toBeLessThan(made.length);
        hidden++;
      }
    }
    expect(hidden).toBeGreaterThanOrEqual(0);
    // Semi-transparent traces never report hidden shapes: covered shapes still show through.
    const glass = tracerCore().create({
      ...sun(),
      kinds: ['circle', 'rect'],
      alpha: 0.5,
      cand: 30,
      mut: 40,
      seed: 5,
    });
    for (let n = 0; n < 30; n++) expect(glass.step()?.hides).toBeUndefined();
  });
});

describe('Tracer A: placing shapes under the trace', () => {
  it('keeps the layer order exact: re-rendering in final order reproduces the internal canvas', () => {
    for (const seed of [1, 2, 3]) {
      const t = init({ seed });
      const s = tracerCore().create(t);
      const order: { index: number; shape: TraceShape }[] = [];
      let made = 0;
      let unders = 0;
      let hidden = 0;
      for (let n = 0; n < 60; n++) {
        const shape = s.step();
        if (!shape) continue;
        made++;
        const entry = { index: made, shape };
        if (shape.under) {
          order.unshift(entry);
          unders++;
        } else order.push(entry);
        for (const h of shape.hides ?? []) {
          const at = order.findIndex((e) => e.index === h);
          expect(at).toBeGreaterThanOrEqual(0);
          order.splice(at, 1);
          hidden++;
        }
      }
      // Re-render: background colour, then each kept shape in order, opaque.
      const C = new Float32Array(W * H * 3);
      for (let i = 0; i < W * H; i++) C.set(s.bg, i * 3);
      for (const { shape } of order) {
        const cov = s.coverage(shape.kind, shape.p);
        for (let i = 0; i < W * H; i++) if (cov[i]) C.set(shape.color, i * 3);
      }
      let e = 0;
      for (let i = 0; i < W * H; i++) {
        for (let c = 0; c < 3; c++) e += t.Wt[i] * (t.T[i * 3 + c] - C[i * 3 + c]) ** 2;
      }
      expect(e).toBeCloseTo(s.error(), 0);
      console.log(`seed ${seed}: ${made} shapes, ${unders} placed under, ${hidden} hidden and removed`);
    }
  });

  it('never places shapes under the trace when they are semi-transparent', () => {
    const s = tracerCore().create(init({ alpha: 0.6 }));
    for (let n = 0; n < 40; n++) expect(s.step()?.under).toBeUndefined();
  });
});

describe('Tracer A: no slivers', () => {
  it('never emits needle triangles', () => {
    const s = tracerCore().create(init({ kinds: ['triangle'], seed: 9 }));
    let n = 0;
    for (let k = 0; k < 60; k++) {
      const shape = s.step();
      if (!shape) continue;
      n++;
      const p = shape.p;
      const area2 = Math.abs((p[2] - p[0]) * (p[5] - p[1]) - (p[3] - p[1]) * (p[4] - p[0]));
      const longest = Math.max(
        Math.hypot(p[2] - p[0], p[3] - p[1]),
        Math.hypot(p[4] - p[2], p[5] - p[3]),
        Math.hypot(p[0] - p[4], p[1] - p[5]),
      );
      expect(area2 / longest).toBeGreaterThanOrEqual(1.5);
      expect((area2 / longest) * 8).toBeGreaterThanOrEqual(longest);
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe('Tracer A: stop when more shapes stop helping', () => {
  const runWorker = (minGain: number): { shapes: number; done: { made: number; converged: boolean } } => {
    const posted: { type: string; made?: number; converged?: boolean }[] = [];
    const scope: {
      onmessage: ((ev: { data: unknown }) => void) | null;
      postMessage: (m: { type: string }) => void;
    } = { onmessage: null, postMessage: (m) => posted.push(m) };
    new Function('self', workerSource())(scope);
    scope.onmessage?.({ data: { ...init({ seed: 4 }), count: 400, minGain } });
    const done = posted[posted.length - 1] as { made: number; converged: boolean };
    return { shapes: posted.filter((m) => m.type === 'shape').length, done };
  };

  it('ends a simple picture early instead of spending every shape on edge pixels', () => {
    const full = runWorker(0);
    const early = runWorker(2e-5);
    expect(early.shapes).toBeLessThan(full.shapes);
    expect(early.shapes).toBeGreaterThanOrEqual(10);
    expect(early.done).toMatchObject({ converged: true, made: early.shapes });
  });

  it('reports each shape gain', () => {
    const s = tracerCore().create(init());
    const before = s.error();
    const shape = s.step() as TraceShape;
    expect(shape.gain).toBeCloseTo(before - s.error(), 0);
  });
});
