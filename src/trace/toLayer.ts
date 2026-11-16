import { CANVAS, makeLayer, type Layer } from '../model/types';
import { deg } from '../render/geometry';
import type { TraceShape } from './core';

/** Maps working pixels (long side R) onto the 512 canvas, centred. */
export interface TraceMap {
  k: number;
  ox: number;
  oy: number;
}

export function traceMap(W: number, H: number): TraceMap {
  const k = CANVAS / Math.max(W, H);
  return { k, ox: (CANVAS - W * k) / 2, oy: (CANVAS - H * k) / 2 };
}

export function hex(c: readonly number[]): string {
  return (
    '#' +
    c
      .slice(0, 3)
      .map((v) =>
        Math.min(255, Math.max(0, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Turn one traced shape into an editable layer. */
export function shapeToLayer(s: TraceShape, m: TraceMap, alpha: number, name: string): Layer {
  const base = { name, color: hex(s.color), opacity: alpha };
  const X = (x: number): number => r2(m.ox + x * m.k);
  const Y = (y: number): number => r2(m.oy + y * m.k);
  const p = s.p;
  if (s.kind === 'circle') {
    return makeLayer('ellipse', {
      ...base,
      x: X(p[0]),
      y: Y(p[1]),
      w: r2(2 * p[2] * m.k),
      h: r2(2 * p[2] * m.k),
    });
  }
  if (s.kind === 'ellipse' || s.kind === 'rect') {
    return makeLayer(s.kind, {
      ...base,
      x: X(p[0]),
      y: Y(p[1]),
      w: r2(2 * p[2] * m.k),
      h: r2(2 * p[3] * m.k),
      rot: r2(((deg(p[4]) % 360) + 360) % 360),
    });
  }
  const xs = [X(p[0]), X(p[2]), X(p[4])];
  const ys = [Y(p[1]), Y(p[3]), Y(p[5])];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = Math.max(0.01, x1 - x0);
  const h = Math.max(0.01, y1 - y0);
  const pts: number[] = [];
  for (let i = 0; i < 3; i++) pts.push((xs[i] - x0) / w - 0.5, (ys[i] - y0) / h - 0.5);
  return makeLayer('path', { ...base, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w, h, pts });
}

/** The optional background rectangle: the image's area filled with its mean colour. */
export function backgroundLayer(color: readonly number[], W: number, H: number, m: TraceMap): Layer {
  return makeLayer('rect', {
    name: 'bg',
    color: hex(color),
    x: CANVAS / 2,
    y: CANVAS / 2,
    w: r2(W * m.k),
    h: r2(H * m.k),
  });
}
