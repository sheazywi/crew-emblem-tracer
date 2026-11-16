import type { Layer } from '../model/types';
import {
  clamp,
  cornerRadius,
  deg,
  outlineLocal,
  polyUnit,
  rad,
  rotate,
  sides,
  starInner,
  starUnit,
  toWorld,
  type Pt,
} from '../render/geometry';
import { CONTRACT, PRIMS, RING_SLUGS, SLUG, type Packed } from './editor-contract';
import { ringStack } from './rings';
import { textRects, type LocalRect } from './textRects';
import { cleanPolygon, earClip } from './triangulate';

/**
 * Convert Crest Forge layers into Social Club layers built from six primitive slugs. The
 * conversion is exact geometry, not an approximation: every piece is an affine map
 * M = Rot(theta) * diag(sx, sy) from the primitive's native centred coordinates to the canvas.
 */

/** One Social Club layer before packing: box centre, rotation (radians) and scale factors. */
export interface Piece {
  slug: string;
  cx: number;
  cy: number;
  rot: number;
  sx: number;
  sy: number;
}

export interface ConvertOptions {
  /** Text rasteriser. Defaults to the canvas-based one; pass a stub where there is no DOM. */
  textRects?: (l: Layer) => LocalRect[] | null;
  /** Fallback build flag: round x and y to whole pixels, like Rockstar's own layers. */
  roundPositions?: boolean;
}

export interface ConvertStats {
  /** Pieces narrower than 0.4 px, left out. */
  dropped: number;
  /** Pieces whose scale had to be clamped into 1%..500%. */
  clamped: number;
  /** Semi-transparent layers built from overlapping pieces (darker overlaps will show). */
  overlapLayers: number;
  /** Semi-transparent triangulated layers (faint seams may show). */
  seamLayers: number;
  hidden: number;
  /** Text layers skipped because no canvas was available to rasterise them. */
  textSkipped: number;
  /** Rings whose hole was larger than the thinnest ring slug allows. */
  ringsClamped: number;
}

export interface ConvertResult {
  layers: Packed[];
  notes: string[];
  stats: ConvertStats;
  /** Social Club layers produced by each input layer, same order as the input. */
  perLayer: number[];
}

/** Shared edges are pushed outward by this many px to hide antialiasing seams. */
export const SEAM_GROW = 0.8;
/** No vertex may move further than this, so sharp corners never grow visible spikes. */
export const SEAM_CAP = 1.5;
/** Opaque text rectangles grow by this many px per side. */
export const TEXT_GROW = 0.35;
/** A corner counts as a right angle when |cos| is below this. */
export const RIGHT_COS = 0.004;
/** Two sides count as equal when they are within this fraction of each other. */
export const ISO_TOL = 0.006;
/**
 * A triangle is only drawn as an exact right or isosceles primitive when that moves no vertex
 * further than this many px. The relative tolerances above are not enough on their own: on a
 * long thin triangle, sides within 0.6% can still put the apex many pixels off its axis.
 */
export const SNAP_PX = 0.02;

const NONE: readonly boolean[] = [false, false, false];

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const area2 = (t: readonly Pt[]): number =>
  Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]));

// --- primitive anchors, derived from the contract so the two can never drift apart ----------

const SQ = PRIMS[SLUG.square];
const CI = PRIMS[SLUG.circle];
const R5 = PRIMS[SLUG.right];
const I3 = PRIMS[SLUG.iso];
const HX = PRIMS[SLUG.hex];

const r5 = R5.pts as Pt[]; // [right-angle corner, end of the leg along x, end of the leg along y]
const R5_CORNER: Pt = [r5[0][0] - R5.w / 2, r5[0][1] - R5.h / 2]; // (96, 150) from the box centre
const R5_LEG_X = Math.abs(r5[1][0] - r5[0][0]); // 192
const R5_LEG_Y = Math.abs(r5[2][1] - r5[0][1]); // 300

const i3 = I3.pts as Pt[]; // [base start, base end, apex]
const I3_BASE = i3[1][0] - i3[0][0]; // 158.91
const I3_HEIGHT = i3[0][1] - i3[2][1]; // 300
const I3_MID: Pt = [(i3[0][0] + i3[1][0]) / 2 - I3.w / 2, i3[0][1] - I3.h / 2]; // base midpoint from the box centre

const hx = HX.pts as Pt[];
const HX_X = [Math.min(...hx.map((p) => p[0])), Math.max(...hx.map((p) => p[0]))];
const HX_Y = [Math.min(...hx.map((p) => p[1])), Math.max(...hx.map((p) => p[1]))];
const HX_ACROSS_CORNERS = HX_X[1] - HX_X[0]; // 300
const HX_ACROSS_FLATS = HX_Y[1] - HX_Y[0]; // 259.8
const HX_CENTRE: Pt = [(HX_X[0] + HX_X[1]) / 2 - HX.w / 2, (HX_Y[0] + HX_Y[1]) / 2 - HX.h / 2];

// --- triangles -----------------------------------------------------------------------------

/**
 * Push the flagged edges outward by `grow` px with parallel offsets (shared[i] is the edge from
 * t[i] to t[i+1]). Unflagged (outer) edges never move: their vertices only slide along them.
 * No vertex moves further than `cap`, so sharp corners never grow visible spikes.
 *
 * - 'similar' scales all offsets of the triangle down together when a vertex would pass the
 *   cap. Every angle is kept, so right and isosceles pieces stay right and isosceles.
 * - 'clamped' holds back only the vertices that would pass the cap. A long thin triangle then
 *   keeps most of its overlap along its long seams instead of losing nearly all of it; the
 *   result is no longer similar to the input, so it has to be classified again afterwards.
 *
 * When no vertex reaches the cap the two modes give the same triangle.
 */
export function growTriangle(
  t: readonly Pt[],
  shared: readonly boolean[],
  mode: 'similar' | 'clamped' = 'similar',
  grow = SEAM_GROW,
  cap = SEAM_CAP,
): Pt[] {
  if (!shared[0] && !shared[1] && !shared[2]) return t.map((p) => [p[0], p[1]] as Pt);
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
  const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
  const normal: Pt[] = [];
  const dist: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = t[i];
    const b = t[(i + 1) % 3];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = (b[1] - a[1]) / l;
    let ny = -(b[0] - a[0]) / l;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) > 0) {
      nx = -nx;
      ny = -ny;
    }
    normal.push([nx, ny]);
    dist.push(shared[i] ? grow : 0);
  }
  const delta: Pt[] = [];
  let worst = 0;
  for (let j = 0; j < 3; j++) {
    // Vertex j sits between edge a (ending at j) and edge b (starting at j):
    // solve n_a . d = dist_a, n_b . d = dist_b.
    const a = (j + 2) % 3;
    const b = j;
    const det = normal[a][0] * normal[b][1] - normal[a][1] * normal[b][0];
    if (Math.abs(det) < 1e-9) {
      delta.push([0, 0]);
      continue;
    }
    const dx = (dist[a] * normal[b][1] - dist[b] * normal[a][1]) / det;
    const dy = (normal[a][0] * dist[b] - normal[b][0] * dist[a]) / det;
    delta.push([dx, dy]);
    worst = Math.max(worst, Math.hypot(dx, dy));
  }
  const all = worst > cap ? cap / worst : 1;
  return t.map((p, j) => {
    const moved = Math.hypot(delta[j][0], delta[j][1]);
    const s = mode === 'similar' ? all : moved > cap ? cap / moved : 1;
    return [p[0] + delta[j][0] * s, p[1] + delta[j][1] * s] as Pt;
  });
}

/**
 * Right triangle with the right angle at R and legs to P1 and P2, mapped onto angles/05.
 * A right triangle can always be reached without a flip by choosing which leg lies along the
 * primitive's x leg, so this never emits a negative scale.
 */
export function rightPiece(R: Pt, P1: Pt, P2: Pt): Piece {
  let u = sub(P1, R);
  let v = sub(P2, R);
  if (u[0] * v[1] - u[1] * v[0] < 0) [u, v] = [v, u];
  const th = Math.atan2(-u[1], -u[0]);
  const sx = len(u) / R5_LEG_X;
  const sy = -(v[0] * -Math.sin(th) + v[1] * Math.cos(th)) / R5_LEG_Y;
  const o = rotate(R5_CORNER[0] * sx, R5_CORNER[1] * sy, th);
  return { slug: SLUG.right, cx: R[0] - o[0], cy: R[1] - o[1], rot: th, sx, sy };
}

/** Isosceles triangle with apex A and base B-C, mapped onto angles/03 (never flipped). */
export function isoPiece(A: Pt, B: Pt, C: Pt): Piece {
  let b = B;
  let c = C;
  // Walk the base in the direction that puts the apex on the primitive's apex side.
  if ((c[0] - b[0]) * (A[1] - b[1]) - (c[1] - b[1]) * (A[0] - b[0]) > 0) [b, c] = [c, b];
  const th = Math.atan2(c[1] - b[1], c[0] - b[0]);
  const sx = len(sub(c, b)) / I3_BASE;
  const m: Pt = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const h = sub(A, m);
  const sy = -(h[0] * -Math.sin(th) + h[1] * Math.cos(th)) / I3_HEIGHT;
  const o = rotate(I3_MID[0] * sx, I3_MID[1] * sy, th);
  return { slug: SLUG.iso, cx: m[0] - o[0], cy: m[1] - o[1], rot: th, sx, sy };
}

export type TriangleKind = 'right' | 'iso' | 'other' | 'degenerate';

/**
 * Detection order: right angle first, then isosceles, else split.
 * `i` is the right-angle vertex, the apex, or the start of the longest edge respectively.
 */
export function classifyTriangle(t: readonly Pt[]): { kind: TriangleKind; i: number } {
  if (!(area2(t) > 1e-6)) return { kind: 'degenerate', i: 0 };
  let best = -1;
  let bestV = RIGHT_COS;
  for (let i = 0; i < 3; i++) {
    const u = sub(t[(i + 1) % 3], t[i]);
    const v = sub(t[(i + 2) % 3], t[i]);
    const lu = len(u);
    const lv = len(v);
    const c = Math.abs((u[0] * v[0] + u[1] * v[1]) / (lu * lv));
    // Drawing it as an exact right angle moves the end of a leg by leg * |cos|.
    if (c < bestV && c * Math.max(lu, lv) <= SNAP_PX) {
      bestV = c;
      best = i;
    }
  }
  if (best >= 0) return { kind: 'right', i: best };
  bestV = ISO_TOL;
  for (let i = 0; i < 3; i++) {
    const a = len(sub(t[(i + 1) % 3], t[i]));
    const b = len(sub(t[(i + 2) % 3], t[i]));
    const base = len(sub(t[(i + 2) % 3], t[(i + 1) % 3]));
    const d = Math.abs(a - b) / Math.max(a, b);
    // Drawing it as exactly isosceles moves the apex along the base by |a^2 - b^2| / (2 base).
    if (d <= bestV && Math.abs(a * a - b * b) / (2 * base) <= SNAP_PX) {
      bestV = d;
      best = i;
    }
  }
  if (best >= 0) return { kind: 'iso', i: best };
  let longest = 0;
  let longestV = -1;
  for (let i = 0; i < 3; i++) {
    const l = len(sub(t[(i + 1) % 3], t[i]));
    if (l > longestV) {
      longestV = l;
      longest = i;
    }
  }
  return { kind: 'other', i: longest };
}

/**
 * The triangle rule: one layer for a right or isosceles triangle, otherwise two right
 * triangles split at the foot of the altitude onto the longest side.
 * shared[i] marks the edge t[i] -> t[i+1] as shared with another piece of the same layer;
 * shared edges are grown outward when `grow` is set (fully opaque layers only).
 */
export function triPieces(t: readonly Pt[], shared: readonly boolean[], grow: boolean): Piece[] {
  if (classifyTriangle(t).kind === 'degenerate') return [];
  // Grow the shared edges first, then classify what is actually going to be drawn. Where no
  // corner reaches the cap this is a plain parallel offset, so a right or isosceles triangle
  // stays one layer.
  const g = grow ? growTriangle(t, shared, 'clamped') : t;
  const c = classifyTriangle(g);
  if (c.kind === 'degenerate') return [];
  const i = c.i;
  if (c.kind === 'right') return [rightPiece(g[i], g[(i + 1) % 3], g[(i + 2) % 3])];
  if (c.kind === 'iso') return [isoPiece(g[i], g[(i + 1) % 3], g[(i + 2) % 3])];
  const q1 = g[i];
  const q2 = g[(i + 1) % 3];
  const v = g[(i + 2) % 3];
  const dx = q2[0] - q1[0];
  const dy = q2[1] - q1[1];
  const k = ((v[0] - q1[0]) * dx + (v[1] - q1[1]) * dy) / (dx * dx + dy * dy);
  const foot: Pt = [q1[0] + k * dx, q1[1] + k * dy];
  const out: Piece[] = [];
  const half = (q: Pt): void => {
    const tri: Pt[] = [foot, v, q];
    if (!(area2(tri) > 1e-6)) return;
    // The altitude foot-v is shared by the two halves. Its offset must keep the right angle,
    // so it uses the similar mode; the other two edges were already grown above.
    const h = grow ? growTriangle(tri, [true, false, false], 'similar') : tri;
    out.push(rightPiece(h[0], h[1], h[2]));
  };
  half(q1);
  half(q2);
  return out;
}

// --- per-type mapping ----------------------------------------------------------------------

function layerPieces(l: Layer, opt: ConvertOptions, stats: ConvertStats): Piece[] {
  const th = rad(l.rot);
  const W = toWorld(l);
  const opaque = l.opacity >= 0.995;
  const square = (lx: number, ly: number, w: number, h: number): Piece => {
    const c = W(lx, ly);
    return { slug: SLUG.square, cx: c[0], cy: c[1], rot: th, sx: w / SQ.w, sy: h / SQ.h };
  };
  const circle = (lx: number, ly: number, w: number, h: number): Piece => {
    const c = W(lx, ly);
    return { slug: SLUG.circle, cx: c[0], cy: c[1], rot: th, sx: w / CI.w, sy: h / CI.h };
  };
  const world = (pts: readonly Pt[]): Pt[] => pts.map((p) => W(p[0], p[1]));

  switch (l.type) {
    case 'rect':
      return [square(0, 0, l.w, l.h)];
    case 'ellipse':
      return [circle(0, 0, l.w, l.h)];
    case 'round': {
      const r = cornerRadius(l);
      if (r < 0.2) return [square(0, 0, l.w, l.h)];
      const out: Piece[] = [];
      // Two rectangles (a cross) plus four corner circles.
      if (l.h - 2 * r >= CONTRACT.dropBelowPx) out.push(square(0, 0, l.w, l.h - 2 * r));
      if (l.w - 2 * r >= CONTRACT.dropBelowPx) out.push(square(0, 0, l.w - 2 * r, l.h));
      const ax = l.w / 2 - r;
      const ay = l.h / 2 - r;
      // A square with r = 50% is a plain circle; a pill needs only its two end caps.
      const corners: Pt[] =
        ax < 1e-6 && ay < 1e-6
          ? [[0, 0]]
          : ax < 1e-6
            ? [
                [0, -ay],
                [0, ay],
              ]
            : ay < 1e-6
              ? [
                  [-ax, 0],
                  [ax, 0],
                ]
              : [
                  [-ax, -ay],
                  [ax, -ay],
                  [ax, ay],
                  [-ax, ay],
                ];
      for (const [x, y] of corners) out.push(circle(x, y, 2 * r, 2 * r));
      if (!opaque) stats.overlapLayers++;
      return out;
    }
    case 'ring': {
      const want = clamp(l.inner ?? 0.7, 0.01, 0.99);
      const stack = ringStack(want, Math.min(l.w, l.h) / 2);
      if (want > RING_SLUGS[RING_SLUGS.length - 1].ratio + 1e-9) stats.ringsClamped++;
      if (!opaque && stack.outers.length > 1) stats.overlapLayers++;
      const prim = PRIMS[stack.slug];
      return stack.outers.map((o) => ({
        slug: stack.slug,
        cx: l.x,
        cy: l.y,
        rot: th,
        sx: (l.w * o) / prim.w,
        sy: (l.h * o) / prim.h,
      }));
    }
    case 'triangle':
    case 'rtri':
      return triPieces(world(outlineLocal(l) ?? []), NONE, false);
    case 'poly': {
      const n = sides(l);
      if (n === 6) {
        // polygons/04 is flat-top; ours is point-up, so rotate by 90 degrees.
        const t = th + Math.PI / 2;
        const sx = l.h / HX_ACROSS_CORNERS;
        const sy = (l.w * Math.cos(Math.PI / 6)) / HX_ACROSS_FLATS;
        const o = rotate(HX_CENTRE[0] * sx, HX_CENTRE[1] * sy, t);
        return [{ slug: SLUG.hex, cx: l.x - o[0], cy: l.y - o[1], rot: t, sx, sy }];
      }
      const pts = world(polyUnit(n).map(([x, y]) => [(x * l.w) / 2, (y * l.h) / 2] as Pt));
      if (n === 3) return triPieces(pts, NONE, false);
      // Fan of n triangles from the centre; the spokes are shared edges.
      const centre = W(0, 0);
      const out: Piece[] = [];
      for (let i = 0; i < n; i++) {
        out.push(...triPieces([centre, pts[i], pts[(i + 1) % n]], [true, false, true], opaque));
      }
      if (!opaque) stats.seamLayers++;
      return out;
    }
    case 'star': {
      const n = sides(l);
      const u = world(starUnit(n, starInner(l)).map(([x, y]) => [(x * l.w) / 2, (y * l.h) / 2] as Pt));
      const centre = W(0, 0);
      const out: Piece[] = [];
      for (let i = 0; i < n; i++) {
        const before = u[(2 * i - 1 + 2 * n) % (2 * n)];
        const tip = u[2 * i];
        const after = u[2 * i + 1];
        // One spike per point: its base is the inner rim, shared with the inner polygon.
        out.push(...triPieces([before, tip, after], [false, false, true], opaque));
        // Fan of the inner polygon: both spokes and the rim are shared.
        out.push(...triPieces([centre, after, u[(2 * i + 3) % (2 * n)]], [true, true, true], opaque));
      }
      if (!opaque) stats.seamLayers++;
      return out;
    }
    case 'path': {
      const local = cleanPolygon(outlineLocal(l) ?? []);
      if (local.length < 3) return [];
      const pts = world(local);
      const n = local.length;
      const outer = (a: number, b: number): boolean => (b - a + n) % n === 1 || (a - b + n) % n === 1;
      const out: Piece[] = [];
      const tris = earClip(local);
      for (const [a, b, c] of tris) {
        out.push(...triPieces([pts[a], pts[b], pts[c]], [!outer(a, b), !outer(b, c), !outer(c, a)], opaque));
      }
      if (!opaque && tris.length > 1) stats.seamLayers++;
      return out;
    }
    case 'text': {
      const rects = (opt.textRects ?? textRects)(l);
      if (!rects) {
        stats.textSkipped++;
        return [];
      }
      const g = opaque ? TEXT_GROW * 2 : 0;
      return rects.map((r) => square(r.x, r.y, r.w + g, r.h + g));
    }
  }
}

// --- packing -------------------------------------------------------------------------------

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

/**
 * Pack one piece: x/y are the top-left of the native box, scales are percent, rotation is in
 * degrees. Returns null when the piece is too narrow to draw.
 */
export function packPiece(
  p: Piece,
  color: string,
  opacity: number,
  name: string,
  stats?: ConvertStats,
  roundPositions = false,
): Packed | null {
  const prim = PRIMS[p.slug];
  const w = prim ? prim.w : 300;
  const h = prim ? prim.h : 300;
  if (
    !Number.isFinite(p.sx + p.sy + p.cx + p.cy + p.rot) ||
    Math.abs(p.sx) * w < CONTRACT.dropBelowPx ||
    Math.abs(p.sy) * h < CONTRACT.dropBelowPx
  ) {
    if (stats) stats.dropped++;
    return null;
  }
  const scale = (s: number): number => {
    const pct = s * 100;
    const mag = clamp(Math.abs(pct), CONTRACT.scaleMin, CONTRACT.scaleMax);
    if (mag !== Math.abs(pct) && stats) stats.clamped++;
    return r2(pct < 0 ? -mag : mag);
  };
  const sx = scale(p.sx);
  const sy = scale(p.sy);
  let x = p.cx - w / 2;
  let y = p.cy - h / 2;
  x = roundPositions ? Math.round(x) + 0 : r2(x);
  y = roundPositions ? Math.round(y) + 0 : r2(y);
  let rotation = r2(((deg(p.rot) % 360) + 360) % 360);
  if (rotation >= 360) rotation = 0;
  const op = clamp(Math.round(opacity * 100), 0, 100);
  return [p.slug, x, y, sx, sy, rotation, op, color.toLowerCase(), sx < 0, sy < 0, name];
}

function describe(stats: ConvertStats): string[] {
  const notes: string[] = [];
  const s = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  if (stats.textSkipped)
    notes.push(
      `${s(stats.textSkipped, 'text layer was', 'text layers were')} skipped: no canvas to rasterise text.`,
    );
  if (stats.dropped)
    notes.push(
      `${s(stats.dropped, 'piece is', 'pieces are')} too small to draw (under ${CONTRACT.dropBelowPx} px) and left out.`,
    );
  if (stats.clamped)
    notes.push(
      `${s(stats.clamped, 'piece was', 'pieces were')} resized to fit the editor's 1% to 500% scale range (the smallest square is 3 px), so fine detail gets slightly thicker.`,
    );
  if (stats.overlapLayers)
    notes.push(
      `${s(stats.overlapLayers, 'semi-transparent layer is', 'semi-transparent layers are')} built from overlapping pieces; the overlaps will look darker.`,
    );
  if (stats.seamLayers)
    notes.push(
      `${s(stats.seamLayers, 'semi-transparent layer is', 'semi-transparent layers are')} triangulated and may show faint seams.`,
    );
  if (stats.ringsClamped)
    notes.push(
      `${s(stats.ringsClamped, 'ring is', 'rings are')} thinner than the thinnest ring shape; drawn with a 0.67% wall.`,
    );
  if (stats.hidden) notes.push(`${s(stats.hidden, 'hidden layer is', 'hidden layers are')} not exported.`);
  return notes;
}

/** Convert a design. Pure: no DOM access except for text rasterising. */
export function toSocialClub(layers: readonly Layer[], opt: ConvertOptions = {}): ConvertResult {
  const stats: ConvertStats = {
    dropped: 0,
    clamped: 0,
    overlapLayers: 0,
    seamLayers: 0,
    hidden: 0,
    textSkipped: 0,
    ringsClamped: 0,
  };
  const out: Packed[] = [];
  const perLayer: number[] = [];
  for (const l of layers) {
    const before = out.length;
    if (!l.visible) {
      stats.hidden++;
    } else if (l.opacity > 0.004) {
      for (const piece of layerPieces(l, opt, stats)) {
        const packed = packPiece(
          piece,
          l.color,
          l.opacity,
          'c' + out.length.toString(36),
          stats,
          opt.roundPositions,
        );
        if (packed) out.push(packed);
      }
    }
    perLayer.push(out.length - before);
  }
  return { layers: out, notes: describe(stats), stats, perLayer };
}
