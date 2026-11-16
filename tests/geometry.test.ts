import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/model/presets';
import { makeLayer } from '../src/model/types';
import {
  boxPoint,
  layerAABB,
  outlineLocal,
  polygonArea,
  toLocal,
  toWorld,
  type Pt,
} from '../src/render/geometry';
import { toSVG } from '../src/render/export';
import { RING_SLUGS } from '../src/socialclub/editor-contract';
import { RING_OVERLAP_PX, ringStack } from '../src/socialclub/rings';
import { fattenRuns, maskToRuns } from '../src/socialclub/textRects';
import { cleanPolygon, earClip } from '../src/socialclub/triangulate';
import { rng } from './helpers';

describe('layer frame', () => {
  it('toLocal inverts toWorld, including flips and rotation', () => {
    const r = rng(1);
    for (let n = 0; n < 200; n++) {
      const l = makeLayer('rect', {
        x: r() * 500,
        y: r() * 500,
        rot: r() * 720 - 360,
        fx: r() < 0.5,
        fy: r() < 0.5,
      });
      const p: Pt = [r() * 200 - 100, r() * 200 - 100];
      const w = toWorld(l)(p[0], p[1]);
      const back = toLocal(l, w[0], w[1]);
      expect(back[0]).toBeCloseTo(p[0], 8);
      expect(back[1]).toBeCloseTo(p[1], 8);
    }
  });

  it('rotation is clockwise on a y-down canvas', () => {
    const l = makeLayer('rect', { x: 100, y: 100, w: 40, h: 20, rot: 90 });
    const top = boxPoint(l, 0, -1);
    expect(top[0]).toBeCloseTo(110, 8); // the top edge swings to the right
    expect(top[1]).toBeCloseTo(100, 8);
    const b = layerAABB(l);
    expect([b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v))).toEqual([90, 80, 110, 120]);
  });

  it('a six-sided polygon is point-up and inscribed in its ellipse', () => {
    const pts = outlineLocal(makeLayer('poly', { n: 6, w: 200, h: 100 })) as Pt[];
    expect(pts[0][0]).toBeCloseTo(0, 9);
    expect(pts[0][1]).toBeCloseTo(-50, 9);
    expect(pts[1][0]).toBeCloseTo(100 * Math.cos(Math.PI / 6), 9);
  });
});

describe('triangulation', () => {
  it('ear-clips every preset into n - 2 triangles that cover the same area', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const raw: Pt[] = [];
      for (let i = 0; i < preset.pts.length; i += 2) raw.push([preset.pts[i] * 300, preset.pts[i + 1] * 300]);
      for (const pts of [cleanPolygon(raw), cleanPolygon(raw.slice().reverse())]) {
        const tris = earClip(pts);
        expect(tris.length, name).toBe(pts.length - 2);
        let area = 0;
        for (const [a, b, c] of tris) area += Math.abs(polygonArea([pts[a], pts[b], pts[c]]));
        expect(area, name).toBeCloseTo(Math.abs(polygonArea(pts)), 6);
      }
    }
  });

  it('cleans duplicate and collinear points so outline edges can be told from diagonals', () => {
    const square: Pt[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 4],
    ];
    expect(cleanPolygon(square)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(
      cleanPolygon([
        [0, 0],
        [1, 1],
      ]),
    ).toEqual([]);
  });

  it('presets are normalised to -0.5..0.5', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(Math.min(...preset.pts)).toBeCloseTo(-0.5, 4);
      expect(Math.max(...preset.pts)).toBeCloseTo(0.5, 4);
    }
  });
});

describe('ring stacks', () => {
  it('stack one ring slug from the outside in and end on exactly the wanted hole', () => {
    for (const radius of [30, 60, 100, 150, 250]) {
      for (let k = 0.05; k <= 0.99; k += 0.01) {
        const s = ringStack(k, radius);
        const rho = s.ratio;
        // The slug is the one with the smallest ratio that is still >= k.
        expect(rho).toBeGreaterThanOrEqual(k - 1e-9);
        for (const other of RING_SLUGS)
          if (other.ratio >= k - 1e-9) expect(rho).toBeLessThanOrEqual(other.ratio);
        expect(s.outers[0]).toBeCloseTo(s.outers.length === 1 ? k / rho : 1, 9);
        const last = s.outers[s.outers.length - 1];
        expect(Math.abs(last * rho - k) / k).toBeLessThan(0.005); // hole ratio within 0.5%
        expect(s.outers.length).toBeLessThan(40);
        for (let i = 1; i < s.outers.length; i++) {
          const prev = s.outers[i - 1];
          const overlapPx = (s.outers[i] - prev * rho) * radius;
          const thicknessPx = prev * (1 - rho) * radius;
          // 1.2 px of overlap, unless the ring it overlaps is thinner than 2.4 px.
          expect(overlapPx).toBeGreaterThanOrEqual(Math.min(RING_OVERLAP_PX, thicknessPx / 2) - 1e-9);
          if (thicknessPx >= 2.4) expect(overlapPx).toBeGreaterThanOrEqual(1);
          expect(s.outers[i]).toBeLessThanOrEqual(prev + 1e-12);
        }
      }
    }
  });

  it('needs one to three rings for ordinary hole sizes', () => {
    expect(ringStack(0.3183, 100).outers).toHaveLength(1);
    expect(ringStack(0.7, 100).outers.length).toBeLessThanOrEqual(3);
    expect(ringStack(0.9, 100).outers.length).toBeLessThanOrEqual(3);
    expect(ringStack(0.2, 100).outers.length).toBeLessThanOrEqual(3);
  });
});

describe('text mask to rectangles', () => {
  it('rebuilds the mask exactly and merges identical runs downward', () => {
    const r = rng(5);
    const w = 37;
    const h = 23;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = r() < 0.55 ? 255 : 0;
    // A solid block must come out as a single rectangle.
    for (let y = 4; y < 14; y++) for (let x = 0; x < w; x++) mask[y * w + x] = x >= 6 && x < 20 ? 255 : 0;
    const runs = maskToRuns(mask, w, h);
    const out = new Uint8Array(w * h);
    for (const run of runs) {
      for (let y = run.y0; y < run.y1; y++) for (let x = run.x0; x < run.x1; x++) out[y * w + x] += 1;
    }
    for (let i = 0; i < w * h; i++) expect(out[i]).toBe(mask[i] > 127 ? 1 : 0);
    expect(runs).toContainEqual({ x0: 6, x1: 20, y0: 4, y1: 14 });
  });

  it('widens runs thinner than the editor can draw into the glyph, never outside it', () => {
    // A disc: its top and bottom rows are short single-row runs.
    const w = 48;
    const h = 48;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) mask[y * w + x] = Math.hypot(x + 0.5 - 24, y + 0.5 - 24) < 20 ? 255 : 0;
    const runs = maskToRuns(mask, w, h);
    expect(runs.some((r) => r.y1 - r.y0 < 4)).toBe(true);
    const fat = fattenRuns(runs, mask, w, h, 4, 4);
    const out = new Uint8Array(w * h);
    for (const r of fat) {
      expect(r.y1 - r.y0).toBeGreaterThanOrEqual(4);
      expect(r.x1 - r.x0).toBeGreaterThanOrEqual(4);
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out[y * w + x] = 1;
    }
    // Same coverage as the mask: nothing lost, nothing added.
    for (let i = 0; i < w * h; i++) expect(out[i]).toBe(mask[i] ? 1 : 0);
    expect(fat.length).toBeLessThanOrEqual(runs.length);
    // A hairline with nothing to grow into is left alone (the converter then clamps it).
    const line = new Uint8Array(20 * 5);
    for (let x = 2; x < 18; x++) line[2 * 20 + x] = 255;
    expect(fattenRuns(maskToRuns(line, 20, 5), line, 20, 5, 4, 4)).toEqual([{ x0: 2, x1: 18, y0: 2, y1: 3 }]);
  });

  it('thresholds alpha at 127 and reads RGBA data in place', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255]);
    expect(maskToRuns(rgba, 3, 1, 4, 3)).toEqual([{ x0: 1, x1: 3, y0: 0, y1: 1 }]);
  });
});

describe('SVG export', () => {
  it('writes one <g transform> per visible layer', () => {
    const svg = toSVG([
      makeLayer('rect', { x: 10, y: 20, rot: 30, fx: true }),
      makeLayer('ring', { opacity: 0.5 }),
      makeLayer('star'),
      makeLayer('ellipse', { visible: false }),
    ]);
    expect(svg.match(/<g /g)).toHaveLength(3);
    expect(svg).toContain('<g transform="translate(10 20) rotate(30) scale(-1 1)" fill="#f5a524">');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('viewBox="0 0 512 512"');
  });
});
