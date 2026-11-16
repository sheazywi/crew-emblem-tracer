import { rad, rotate, type Pt } from '../src/render/geometry';
import { packPiece, type Piece } from '../src/socialclub/convert';
import { PRIMS, type Packed } from '../src/socialclub/editor-contract';

/** Deterministic PRNG so failures reproduce. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The editor's transform applied to a native point: scale, rotate about the box centre, move. */
export function applyPacked(p: Packed, pt: Pt): Pt {
  const prim = PRIMS[p[0]];
  const [x, y] = rotate(((pt[0] - prim.w / 2) * p[3]) / 100, ((pt[1] - prim.h / 2) * p[4]) / 100, rad(p[5]));
  return [p[1] + prim.w / 2 + x, p[2] + prim.h / 2 + y];
}

/** Re-render a packed polygon primitive: its outline vertices on the canvas. */
export function packedVertices(p: Packed): Pt[] {
  return (PRIMS[p[0]].pts ?? []).map((pt) => applyPacked(p, pt));
}

/** Largest distance from an expected vertex to the nearest rendered vertex. */
export function vertexError(expected: readonly Pt[], got: readonly Pt[]): number {
  let worst = 0;
  for (const e of expected) {
    let best = Infinity;
    for (const g of got) best = Math.min(best, Math.hypot(e[0] - g[0], e[1] - g[1]));
    worst = Math.max(worst, best);
  }
  return worst;
}

export function pack(piece: Piece): Packed {
  const packed = packPiece(piece, '#ffffff', 1, 't');
  if (!packed) throw new Error('piece was dropped');
  return packed;
}

export function triArea(t: readonly Pt[]): number {
  return Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) / 2;
}

/** Distance from point p to the infinite line through a and b. */
export function lineDistance(p: Pt, a: Pt, b: Pt): number {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
}
