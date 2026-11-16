import type { Layer } from '../model/types';

/** Pure geometry shared by the renderer, the editor and the Social Club converter. No DOM. */

export type Pt = [number, number];

export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
export const deg = (radians: number): number => (radians * 180) / Math.PI;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Rotate (x, y) clockwise on a y-down canvas by `a` radians. */
export function rotate(x: number, y: number, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

type Frame = Pick<Layer, 'x' | 'y' | 'rot' | 'fx' | 'fy'>;

/** Map a local point (centre at the origin) to canvas coordinates: flips, then rotation, then centre. */
export function toWorld(l: Frame): (lx: number, ly: number) => Pt {
  const c = Math.cos(rad(l.rot));
  const s = Math.sin(rad(l.rot));
  const fx = l.fx ? -1 : 1;
  const fy = l.fy ? -1 : 1;
  return (lx, ly) => {
    const x = lx * fx;
    const y = ly * fy;
    return [l.x + x * c - y * s, l.y + x * s + y * c];
  };
}

/** Inverse of toWorld. */
export function toLocal(l: Frame, wx: number, wy: number): Pt {
  const c = Math.cos(rad(l.rot));
  const s = Math.sin(rad(l.rot));
  const dx = wx - l.x;
  const dy = wy - l.y;
  return [(dx * c + dy * s) * (l.fx ? -1 : 1), (-dx * s + dy * c) * (l.fy ? -1 : 1)];
}

/** A point of the unflipped, rotated bounding box: hx, hy in -1..1. */
export function boxPoint(l: Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rot'>, hx: number, hy: number): Pt {
  const [x, y] = rotate((hx * l.w) / 2, (hy * l.h) / 2, rad(l.rot));
  return [l.x + x, l.y + y];
}

/** Regular n-gon on the unit circle, first vertex at the top. */
export function polyUnit(n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

/** Star outline on the unit circle: outer0, inner0, outer1, inner1, ... */
export function starUnit(n: number, inner: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const b = a + Math.PI / n;
    out.push([Math.cos(a), Math.sin(a)], [Math.cos(b) * inner, Math.sin(b) * inner]);
  }
  return out;
}

export function sides(l: Layer): number {
  return clamp(Math.round(l.n ?? (l.type === 'star' ? 5 : 6)), 3, 64);
}

export function starInner(l: Layer): number {
  return clamp(l.inner ?? 0.45, 0.05, 0.95);
}

export function ringHole(l: Layer): number {
  return clamp(l.inner ?? 0.7, 0.01, 0.99);
}

/** Corner radius of a rounded rectangle in px: r% of the shorter side. */
export function cornerRadius(l: Layer): number {
  return (Math.min(l.w, l.h) * clamp(l.r ?? 0, 0, 50)) / 100;
}

/** Local outline of polygonal layer types, or null for curves, rings and text. */
export function outlineLocal(l: Layer): Pt[] | null {
  const hw = l.w / 2;
  const hh = l.h / 2;
  switch (l.type) {
    case 'rect':
      return [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
    case 'triangle':
      return [
        [0, -hh],
        [hw, hh],
        [-hw, hh],
      ];
    case 'rtri':
      return [
        [-hw, hh],
        [hw, hh],
        [-hw, -hh],
      ];
    case 'poly':
      return polyUnit(sides(l)).map(([x, y]) => [x * hw, y * hh] as Pt);
    case 'star':
      return starUnit(sides(l), starInner(l)).map(([x, y]) => [x * hw, y * hh] as Pt);
    case 'path': {
      const pts = l.pts ?? [];
      const out: Pt[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i] * l.w, pts[i + 1] * l.h]);
      return out;
    }
    default:
      return null;
  }
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned bounds of the layer's rotated bounding box. */
export function layerAABB(l: Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rot'>): Box {
  const c = Math.abs(Math.cos(rad(l.rot)));
  const s = Math.abs(Math.sin(rad(l.rot)));
  const ex = (l.w * c + l.h * s) / 2;
  const ey = (l.w * s + l.h * c) / 2;
  return { x0: l.x - ex, y0: l.y - ey, x1: l.x + ex, y1: l.y + ey };
}

export function unionBounds(layers: readonly Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rot'>[]): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const l of layers) {
    const a = layerAABB(l);
    b.x0 = Math.min(b.x0, a.x0);
    b.y0 = Math.min(b.y0, a.y0);
    b.x1 = Math.max(b.x1, a.x1);
    b.y1 = Math.max(b.y1, a.y1);
  }
  return b;
}

/** Signed area (positive when the points run clockwise on a y-down canvas). */
export function polygonArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
