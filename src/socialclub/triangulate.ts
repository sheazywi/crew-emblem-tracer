import { polygonArea, type Pt } from '../render/geometry';

const cross = (a: Pt, b: Pt, c: Pt): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Remove duplicate and collinear points. After this, every polygon edge is a real outline edge,
 * so "is this triangle edge on the outline?" can be answered from point indices alone.
 */
export function cleanPolygon(input: readonly Pt[]): Pt[] {
  let pts = input
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]] as Pt);
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const n = pts.length;
    const keep: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = keep.length ? keep[keep.length - 1] : pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (ab < 1e-9 || Math.abs(cross(a, b, c)) <= 1e-9 * (ab * bc + 1e-12)) {
        changed = true;
        continue;
      }
      keep.push(b);
    }
    pts = keep;
  }
  return pts.length >= 3 ? pts : [];
}

function insideTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const eps = -1e-10;
  return cross(a, b, p) >= eps && cross(b, c, p) >= eps && cross(c, a, p) >= eps;
}

const same = (p: Pt, q: Pt): boolean => p[0] === q[0] && p[1] === q[1];

/** Above this many points the ear search stops at the first ear instead of the best one. */
const QUALITY_LIMIT = 300;

/** Smallest interior angle of a triangle, in radians. */
function minAngle(a: Pt, b: Pt, c: Pt): number {
  const at = (p: Pt, q: Pt, r: Pt): number => {
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const vx = r[0] - p[0];
    const vy = r[1] - p[1];
    return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy);
  };
  return Math.min(at(a, b, c), at(b, c, a), at(c, a, b));
}

/**
 * Ear-clipping triangulation of a simple polygon. Returns index triples into `pts`
 * (pass the output of cleanPolygon). A polygon with n points yields n - 2 triangles.
 */
export function earClip(pts: readonly Pt[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (polygonArea(pts) < 0) idx.reverse();
  const tris: [number, number, number][] = [];
  let guard = n * n + 16;
  while (idx.length > 3 && guard-- > 0) {
    const m = idx.length;
    let clipped = false;
    let bestIndex = -1;
    let bestQuality = -1;
    for (let i = 0; i < m; i++) {
      const ia = idx[(i + m - 1) % m];
      const ib = idx[i];
      const ic = idx[(i + 1) % m];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue; // reflex or flat: not an ear
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j];
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        if (insideTriangle(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      // Prefer the best-shaped ear: clipping the first one found tends to fan long slivers out
      // of a single corner, and slivers are what Social Club draws worst. For very large
      // outlines take the first ear to stay fast.
      const quality = m > QUALITY_LIMIT ? 1 : minAngle(a, b, c);
      if (quality > bestQuality) {
        bestQuality = quality;
        bestIndex = i;
        if (m > QUALITY_LIMIT) break;
      }
    }
    if (bestIndex >= 0) {
      const m2 = idx.length;
      tris.push([idx[(bestIndex + m2 - 1) % m2], idx[bestIndex], idx[(bestIndex + 1) % m2]]);
      idx.splice(bestIndex, 1);
      clipped = true;
    }
    if (!clipped) {
      // Numerically stuck (self-touching input): drop the flattest corner and carry on.
      let worst = 0;
      let worstV = Infinity;
      for (let i = 0; i < m; i++) {
        const v = Math.abs(cross(pts[idx[(i + m - 1) % m]], pts[idx[i]], pts[idx[(i + 1) % m]]));
        if (v < worstV) {
          worstV = v;
          worst = i;
        }
      }
      idx.splice(worst, 1);
    }
  }
  if (idx.length === 3 && Math.abs(cross(pts[idx[0]], pts[idx[1]], pts[idx[2]])) > 1e-12) {
    tris.push([idx[0], idx[1], idx[2]]);
  }
  return tris;
}
