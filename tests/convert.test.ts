import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/model/presets';
import { makeLayer, type Layer } from '../src/model/types';
import { outlineLocal, polygonArea, rotate, toWorld, type Pt } from '../src/render/geometry';
import {
  classifyTriangle,
  growTriangle,
  RIGHT_COS,
  SEAM_CAP,
  SEAM_GROW,
  toSocialClub,
  triPieces,
} from '../src/socialclub/convert';
import { PRIMS, SLUG, type Packed } from '../src/socialclub/editor-contract';
import { lineDistance, pack, packedVertices, rng, triArea, vertexError } from './helpers';

const NONE = [false, false, false];
const TOL = 0.05; // px

const worldOutline = (l: Layer): Pt[] => {
  const W = toWorld(l);
  return (outlineLocal(l) ?? []).map((p) => W(p[0], p[1]));
};

describe('triangle rule', () => {
  it('maps right triangles onto angles/05 exactly, either handedness, without flips', () => {
    const r = rng(11);
    for (let n = 0; n < 400; n++) {
      const R: Pt = [60 + r() * 380, 60 + r() * 380];
      const a = r() * Math.PI * 2;
      const hand = r() < 0.5 ? 1 : -1;
      const u = rotate(12 + r() * 230, 0, a);
      const v = rotate(0, hand * (12 + r() * 230), a);
      const tri: Pt[] = [R, [R[0] + u[0], R[1] + u[1]], [R[0] + v[0], R[1] + v[1]]];
      // Present the vertices in a random order: the converter has to find the right angle.
      const k = Math.floor(r() * 3);
      const shuffled = [tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]];
      const pieces = triPieces(shuffled, NONE, false);
      expect(pieces).toHaveLength(1);
      expect(pieces[0].slug).toBe(SLUG.right);
      expect(pieces[0].sx).toBeGreaterThan(0);
      expect(pieces[0].sy).toBeGreaterThan(0);
      expect(vertexError(tri, packedVertices(pack(pieces[0])))).toBeLessThan(TOL);
    }
  });

  it('maps isosceles triangles onto angles/03 exactly, without flips', () => {
    const r = rng(12);
    for (let n = 0; n < 400; n++) {
      const m: Pt = [100 + r() * 300, 100 + r() * 300];
      const a = r() * Math.PI * 2;
      const half = 8 + r() * 120;
      const height = (r() < 0.5 ? 1 : -1) * (10 + r() * 220);
      const b = rotate(-half, 0, a);
      const c = rotate(half, 0, a);
      const top = rotate(0, height, a);
      const tri: Pt[] = [
        [m[0] + top[0], m[1] + top[1]],
        [m[0] + b[0], m[1] + b[1]],
        [m[0] + c[0], m[1] + c[1]],
      ];
      if (classifyTriangle(tri).kind !== 'iso') continue; // a right isosceles is caught as right first
      const pieces = triPieces(tri, NONE, false);
      expect(pieces).toHaveLength(1);
      expect(pieces[0].slug).toBe(SLUG.iso);
      expect(pieces[0].sy).toBeGreaterThan(0);
      expect(vertexError(tri, packedVertices(pack(pieces[0])))).toBeLessThan(TOL);
    }
  });

  it('splits any other triangle into two right triangles at the foot of the altitude', () => {
    const r = rng(13);
    let tested = 0;
    while (tested < 400) {
      const tri: Pt[] = [0, 1, 2].map(() => [130 + r() * 250, 130 + r() * 250] as Pt);
      if (classifyTriangle(tri).kind !== 'other' || triArea(tri) < 300) continue;
      // Stay clear of the tolerance zones, where a near-right triangle is deliberately approximated.
      let clear = true;
      for (let i = 0; i < 3; i++) {
        const u = [tri[(i + 1) % 3][0] - tri[i][0], tri[(i + 1) % 3][1] - tri[i][1]];
        const v = [tri[(i + 2) % 3][0] - tri[i][0], tri[(i + 2) % 3][1] - tri[i][1]];
        const cos = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
        if (cos < 0.02) clear = false;
      }
      if (!clear) continue;
      const pieces = triPieces(tri, NONE, false);
      expect(pieces).toHaveLength(2);
      // Pieces thinner than 1% of the primitive (about 3 px) are clamped by the editor's scale
      // range; that case is covered by the packed-format tests, not this exactness test.
      if (pieces.some((p) => p.sx < 0.02 || p.sy < 0.02)) continue;
      tested++;
      const got = pieces.map((p) => packedVertices(pack(p)));
      expect(pieces.every((p) => p.slug === SLUG.right && p.sx > 0 && p.sy > 0)).toBe(true);
      // Every original vertex is reproduced, and the two halves add up to the original area
      // (to within what a 0.05 px vertex error can change it).
      expect(vertexError(tri, got.flat())).toBeLessThan(TOL);
      const area = triArea(got[0]) + triArea(got[1]);
      const perimeter = [0, 1, 2].reduce(
        (s, i) => s + Math.hypot(tri[(i + 1) % 3][0] - tri[i][0], tri[(i + 1) % 3][1] - tri[i][1]),
        0,
      );
      expect(Math.abs(area - triArea(tri))).toBeLessThan(TOL * perimeter);
    }
  });

  it('bounds the error of the documented tolerance zone (|cos| < 0.004 counts as right)', () => {
    const R: Pt = [200, 200];
    const leg = 150;
    const skew = Math.acos(RIGHT_COS * 0.75); // just inside the tolerance
    const tri: Pt[] = [R, [R[0] + leg, R[1]], [R[0] + Math.cos(skew) * leg, R[1] + Math.sin(skew) * leg]];
    const pieces = triPieces(tri, NONE, false);
    expect(pieces).toHaveLength(1);
    expect(vertexError(tri, packedVertices(pack(pieces[0])))).toBeLessThan(RIGHT_COS * leg + TOL);
  });

  it('converts flipped and rotated triangle layers exactly', () => {
    const r = rng(14);
    for (let n = 0; n < 300; n++) {
      const type = r() < 0.5 ? 'rtri' : 'triangle';
      const l = makeLayer(type, {
        x: 120 + r() * 270,
        y: 120 + r() * 270,
        w: 20 + r() * 200,
        h: 20 + r() * 200,
        rot: r() * 360,
        fx: r() < 0.5,
        fy: r() < 0.5,
      });
      const res = toSocialClub([l]);
      expect(res.layers).toHaveLength(1);
      expect(res.layers[0][8]).toBe(false);
      expect(res.layers[0][9]).toBe(false);
      expect(vertexError(worldOutline(l), packedVertices(res.layers[0]))).toBeLessThan(TOL);
    }
  });
});

describe('seam growth', () => {
  it('never moves a vertex more than 1.5 px and never moves an outer edge', () => {
    const r = rng(21);
    for (let n = 0; n < 500; n++) {
      const tri: Pt[] = [0, 1, 2].map(() => [r() * 400, r() * 400] as Pt);
      if (triArea(tri) < 40) continue;
      const shared = [r() < 0.5, r() < 0.5, r() < 0.5];
      const g = growTriangle(tri, shared);
      let capped = false;
      for (let i = 0; i < 3; i++) {
        const moved = Math.hypot(g[i][0] - tri[i][0], g[i][1] - tri[i][1]);
        expect(moved).toBeLessThanOrEqual(SEAM_CAP + 1e-9);
        if (moved > SEAM_CAP - 1e-6) capped = true;
      }
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const da = lineDistance(g[i], a, b);
        const db = lineDistance(g[(i + 1) % 3], a, b);
        if (!shared[i]) {
          // Outer edge: both ends stay on the original line.
          expect(da).toBeLessThan(1e-7);
          expect(db).toBeLessThan(1e-7);
        } else {
          // Shared edge: pushed out in parallel, by 0.8 px unless the cap scaled it down.
          expect(Math.abs(da - db)).toBeLessThan(1e-7);
          expect(da).toBeLessThanOrEqual(SEAM_GROW + 1e-9);
          if (!capped) expect(da).toBeCloseTo(SEAM_GROW, 7);
        }
      }
      // Parallel offsets keep the triangle's shape, so the area can only grow.
      expect(triArea(g)).toBeGreaterThanOrEqual(triArea(tri) - 1e-9);
    }
  });

  it('keeps right and isosceles pieces right and isosceles', () => {
    const right: Pt[] = [
      [100, 100],
      [220, 100],
      [100, 260],
    ];
    expect(classifyTriangle(growTriangle(right, [true, false, true])).kind).toBe('right');
    const iso: Pt[] = [
      [200, 80],
      [140, 240],
      [260, 240],
    ];
    expect(classifyTriangle(growTriangle(iso, [true, true, false])).kind).toBe('iso');
  });

  it('only grows opaque layers', () => {
    const base = { pts: PRESETS.cross.pts, x: 256, y: 256, w: 200, h: 200 };
    const opaque = toSocialClub([makeLayer('path', base)]).layers;
    const glass = toSocialClub([makeLayer('path', { ...base, opacity: 0.5 })]);
    const area = (ls: Packed[]): number => ls.reduce((s, p) => s + triArea(packedVertices(p)), 0);
    const exact = Math.abs(polygonArea(worldOutline(makeLayer('path', base))));
    expect(Math.abs(area(glass.layers) - exact) / exact).toBeLessThan(0.002);
    expect(area(opaque)).toBeGreaterThan(exact * 1.005);
    expect(glass.stats.seamLayers).toBe(1);
  });
});

describe('per-type mapping', () => {
  it('rectangle and ellipse are one layer with the same centre, size and rotation', () => {
    const rect = toSocialClub([makeLayer('rect', { x: 100, y: 140, w: 150, h: 60, rot: 33 })]).layers[0];
    expect(rect).toEqual([SLUG.square, -50, -10, 50, 20, 33, 100, '#f5a524', false, false, 'c0']);
    const ell = toSocialClub([
      makeLayer('ellipse', { x: 300, y: 200, w: 90, h: 240, rot: 350, opacity: 0.4 }),
    ]).layers[0];
    expect(ell).toEqual([SLUG.circle, 150, 50, 30, 80, 350, 40, '#f5a524', false, false, 'c0']);
  });

  it('hexagon is one polygons/04 layer, rotated 90 degrees, for any size, rotation and flip', () => {
    const r = rng(31);
    for (let n = 0; n < 200; n++) {
      const l = makeLayer('poly', {
        n: 6,
        x: 150 + r() * 200,
        y: 150 + r() * 200,
        w: 30 + r() * 220,
        h: 30 + r() * 220,
        rot: r() * 360,
        fx: r() < 0.5,
        fy: r() < 0.5,
      });
      const res = toSocialClub([l]);
      expect(res.layers).toHaveLength(1);
      expect(res.layers[0][0]).toBe(SLUG.hex);
      expect(vertexError(worldOutline(l), packedVertices(res.layers[0]))).toBeLessThan(TOL);
    }
  });

  it('regular polygons become a fan of n isosceles triangles; a 3-gon is a single triangle', () => {
    for (const n of [4, 5, 7, 8, 12]) {
      const l = makeLayer('poly', { n, w: 200, h: 200, rot: 17, opacity: 0.6 });
      const res = toSocialClub([l]);
      expect(res.layers).toHaveLength(n);
      const outline = worldOutline(l);
      expect(vertexError(outline, res.layers.flatMap(packedVertices))).toBeLessThan(TOL);
      const area = res.layers.reduce((s, p) => s + triArea(packedVertices(p)), 0);
      expect(Math.abs(area - Math.abs(polygonArea(outline))) / area).toBeLessThan(0.002);
    }
    expect(toSocialClub([makeLayer('poly', { n: 3, w: 180, h: 180 })]).layers).toHaveLength(1);
  });

  it('a regular star is a fan of the inner polygon plus one spike per point (2n layers)', () => {
    for (const n of [5, 6, 9]) {
      const l = makeLayer('star', { n, inner: 0.5, w: 220, h: 220, rot: 9, opacity: 0.7 });
      const res = toSocialClub([l]);
      expect(res.layers).toHaveLength(2 * n);
      expect(vertexError(worldOutline(l), res.layers.flatMap(packedVertices))).toBeLessThan(TOL);
      const area = res.layers.reduce((s, p) => s + triArea(packedVertices(p)), 0);
      expect(Math.abs(area - Math.abs(polygonArea(worldOutline(l)))) / area).toBeLessThan(0.002);
    }
  });

  it('rounded rectangle is a cross of two rectangles plus four corner circles', () => {
    const l = makeLayer('round', { x: 256, y: 256, w: 200, h: 100, r: 20 });
    const res = toSocialClub([l]).layers;
    expect(res.map((p) => p[0])).toEqual([
      SLUG.square,
      SLUG.square,
      SLUG.circle,
      SLUG.circle,
      SLUG.circle,
      SLUG.circle,
    ]);
    // r = min(w, h) * 20% = 20 px: rectangles 200 x 60 and 160 x 100, circles 40 px across.
    expect([res[0][3], res[0][4]]).toEqual([66.67, 20]);
    expect([res[1][3], res[1][4]]).toEqual([53.33, 33.33]);
    expect([res[2][3], res[2][4]]).toEqual([13.33, 13.33]);
    expect([res[2][1] + 150, res[2][2] + 150]).toEqual([176, 226]);
    // A pill (r = 50%) needs one rectangle and two end caps.
    const pill = toSocialClub([makeLayer('round', { w: 200, h: 80, r: 50 })]).layers;
    expect(pill.map((p) => p[0])).toEqual([SLUG.square, SLUG.circle, SLUG.circle]);
    // A square with r = 50% is exactly one circle.
    expect(toSocialClub([makeLayer('round', { w: 90, h: 90, r: 50 })]).layers.map((p) => p[0])).toEqual([
      SLUG.circle,
    ]);
  });

  it('custom outlines are ear-clipped, then follow the triangle rule', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const l = makeLayer('path', {
        pts: preset.pts,
        x: 256,
        y: 256,
        w: preset.w,
        h: preset.h,
        rot: 23,
        fx: true,
        opacity: 0.5,
      });
      const res = toSocialClub([l]);
      const n = preset.pts.length / 2;
      expect(res.layers.length, name).toBeGreaterThanOrEqual(1);
      expect(res.layers.length, name).toBeLessThanOrEqual(2 * (n - 2));
      const outline = worldOutline(l);
      // Ear-clipped pieces that are right or isosceles to within the detection tolerances
      // (|cos| < 0.004, sides within 0.6%) are drawn as exactly right or isosceles, so a
      // vertex may sit a fraction of a pixel off; seam growth hides that on opaque layers.
      expect(vertexError(outline, res.layers.flatMap(packedVertices)), name).toBeLessThan(1);
      const area = res.layers.reduce((s, p) => s + triArea(packedVertices(p)), 0);
      expect(Math.abs(area - Math.abs(polygonArea(outline))) / area, name).toBeLessThan(0.01);
    }
  });

  it('text becomes rectangles from the rasteriser, grown by 0.35 px per side when opaque', () => {
    const l = makeLayer('text', { x: 200, y: 100, w: 100, h: 40, rot: 90 });
    const rects = [{ x: -20, y: 5, w: 10, h: 4 }];
    const opaque = toSocialClub([l], { textRects: () => rects }).layers[0];
    // Local (-20, 5) rotated 90 degrees clockwise is (-5, -20) from the centre.
    expect(opaque.slice(0, 6)).toEqual([SLUG.square, 195 - 150, 80 - 150, 3.57, 1.57, 90]);
    const glass = toSocialClub([{ ...l, opacity: 0.5 }], { textRects: () => rects }).layers[0];
    expect([glass[3], glass[4]]).toEqual([3.33, 1.33]);
    // Without a canvas (Node), text is skipped and reported instead of crashing.
    const skipped = toSocialClub([l]);
    expect(skipped.layers).toHaveLength(0);
    expect(skipped.stats.textSkipped).toBe(1);
    expect(skipped.notes.join(' ')).toMatch(/text layer was skipped/);
  });
});

describe('packed layer format', () => {
  it('keeps 2 decimals, clamps scale to 1..500 and drops pieces under 0.4 px', () => {
    const res = toSocialClub([
      makeLayer('rect', { x: 100.123456, y: 50.987654, w: 77.7777, h: 2, rot: 12.3456 }),
      makeLayer('rect', { w: 2000, h: 50 }),
      makeLayer('rect', { w: 0.3, h: 50 }),
      makeLayer('ellipse', { visible: false }),
    ]);
    expect(res.layers).toHaveLength(2);
    for (const p of res.layers) {
      for (const i of [1, 2, 3, 4, 5])
        expect(Math.abs((p[i] as number) * 100 - Math.round((p[i] as number) * 100))).toBeLessThan(1e-6);
      expect(Math.abs(p[3])).toBeGreaterThanOrEqual(1);
      expect(Math.abs(p[3])).toBeLessThanOrEqual(500);
      expect(p[5]).toBeGreaterThanOrEqual(0);
      expect(p[5]).toBeLessThan(360);
      expect(Number.isInteger(p[6])).toBe(true);
      expect(p[10].length).toBeLessThanOrEqual(4);
    }
    expect(res.layers[0][4]).toBe(1); // 2 px tall is below 1% of 300, so it is clamped up
    expect(res.layers[1][3]).toBe(500);
    expect(res.stats).toMatchObject({ dropped: 1, clamped: 2, hidden: 1 });
    expect(res.perLayer).toEqual([1, 1, 0, 0]);
  });

  it('offers whole-pixel positions as a fallback', () => {
    const p = toSocialClub([makeLayer('ellipse', { x: 100.4, y: 99.6, w: 33, h: 33 })], {
      roundPositions: true,
    }).layers[0];
    expect(Number.isInteger(p[1]) && Number.isInteger(p[2])).toBe(true);
  });

  it('flags semi-transparent layers built from overlapping pieces', () => {
    const res = toSocialClub([
      makeLayer('round', { opacity: 0.5 }),
      makeLayer('ring', { opacity: 0.5, inner: 0.5 }),
    ]);
    expect(res.stats.overlapLayers).toBe(2);
    expect(res.notes.join(' ')).toMatch(/overlaps will look darker/);
  });

  it('only uses primitives the contract knows', () => {
    const all = toSocialClub(
      [
        makeLayer('rect'),
        makeLayer('round'),
        makeLayer('ellipse'),
        makeLayer('triangle'),
        makeLayer('rtri'),
        makeLayer('star'),
        makeLayer('poly'),
        makeLayer('poly', { n: 5 }),
        makeLayer('ring'),
        makeLayer('path', { pts: PRESETS.shield.pts }),
        makeLayer('text'),
      ],
      { textRects: () => [{ x: 0, y: 0, w: 20, h: 6 }] },
    );
    expect(all.layers.length).toBeGreaterThan(20);
    for (const p of all.layers) expect(PRIMS[p[0]], p[0]).toBeDefined();
  });
});
