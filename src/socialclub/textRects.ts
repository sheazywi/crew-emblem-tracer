import type { Layer } from '../model/types';
import { drawTextLocal, onTextInvalidated, textOf } from '../render/text';
import { CONTRACT, PRIMS, SLUG } from './editor-contract';

/**
 * Social Club has no text tool (adding a text layer throws), so text becomes small axis-aligned
 * rectangles in the layer's local frame. Rectangles may overlap freely, so they never crack.
 */

/** Centre and size in the layer's local frame (origin at the layer centre), canvas px. */
export interface LocalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Run {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The mask is drawn at this multiple of canvas resolution. */
export const TEXT_MASK_SCALE = 1.25;

/**
 * Turn an alpha mask into rectangles: scan rows into runs [x0, x1), extend each run downward
 * while the next row has an identical run, and emit a rectangle when it ends.
 * `stride`/`offset` let this read the alpha channel of RGBA ImageData directly.
 */
export function maskToRuns(
  alpha: ArrayLike<number>,
  mw: number,
  mh: number,
  stride = 1,
  offset = 0,
  threshold = 127,
): Run[] {
  const out: Run[] = [];
  let open = new Map<number, number>(); // x0 * 65536 + x1 -> first row
  for (let y = 0; y <= mh; y++) {
    const next = new Map<number, number>();
    if (y < mh) {
      const row = y * mw;
      let x = 0;
      while (x < mw) {
        while (x < mw && !(alpha[(row + x) * stride + offset] > threshold)) x++;
        if (x >= mw) break;
        const x0 = x;
        while (x < mw && alpha[(row + x) * stride + offset] > threshold) x++;
        const key = x0 * 65536 + x;
        const started = open.get(key);
        next.set(key, started === undefined ? y : started);
      }
    }
    for (const [key, y0] of open) {
      if (!next.has(key)) out.push({ x0: Math.floor(key / 65536), x1: key % 65536, y0, y1: y });
    }
    open = next;
  }
  return out;
}

/**
 * The editor cannot draw a square smaller than 1% of its 300-unit box, about 3 px. A run thinner
 * than that would be scaled up and stick out of the glyph as a bump. Widen such runs into the
 * glyph instead: a row (or column) is only taken when the mask is filled along its whole
 * length, so the result never covers a pixel the text does not. Rectangles may overlap freely,
 * so this is free; rectangles that end up inside another are dropped.
 */
export function fattenRuns(
  runs: readonly Run[],
  alpha: ArrayLike<number>,
  mw: number,
  mh: number,
  minCols: number,
  minRows: number,
  stride = 1,
  offset = 0,
  threshold = 127,
): Run[] {
  const on = (x: number, y: number): boolean => alpha[(y * mw + x) * stride + offset] > threshold;
  const rowFull = (y: number, x0: number, x1: number): boolean => {
    if (y < 0 || y >= mh) return false;
    for (let x = x0; x < x1; x++) if (!on(x, y)) return false;
    return true;
  };
  const colFull = (x: number, y0: number, y1: number): boolean => {
    if (x < 0 || x >= mw) return false;
    for (let y = y0; y < y1; y++) if (!on(x, y)) return false;
    return true;
  };
  const grown = runs.map((r) => {
    let { x0, x1, y0, y1 } = r;
    for (let moved = true; moved && y1 - y0 < minRows;) {
      moved = false;
      if (rowFull(y1, x0, x1)) {
        y1++;
        moved = true;
      }
      if (y1 - y0 < minRows && rowFull(y0 - 1, x0, x1)) {
        y0--;
        moved = true;
      }
    }
    for (let moved = true; moved && x1 - x0 < minCols;) {
      moved = false;
      if (colFull(x1, y0, y1)) {
        x1++;
        moved = true;
      }
      if (x1 - x0 < minCols && colFull(x0 - 1, y0, y1)) {
        x0--;
        moved = true;
      }
    }
    return { x0, x1, y0, y1 };
  });
  // Drop rectangles that lie inside another one (of two identical ones, keep the first).
  return grown.filter((a, i) => {
    for (let j = 0; j < grown.length; j++) {
      if (j === i) continue;
      const b = grown[j];
      if (b.x0 <= a.x0 && b.x1 >= a.x1 && b.y0 <= a.y0 && b.y1 >= a.y1) {
        const same = b.x0 === a.x0 && b.x1 === a.x1 && b.y0 === a.y0 && b.y1 === a.y1;
        if (!same || j < i) return false;
      }
    }
    return true;
  });
}

/** Smallest square the editor can draw: scaleMin percent of the 300-unit square, in px. */
const MIN_RECT_PX = (CONTRACT.scaleMin / 100) * PRIMS[SLUG.square].w;

const cache = new Map<string, LocalRect[]>();
onTextInvalidated(() => cache.clear());

/** Rasterise a text layer into local rectangles. Returns null when no canvas is available. */
export function textRects(l: Layer): LocalRect[] | null {
  if (typeof document === 'undefined') return null;
  const key = `${textOf(l)}|${l.font}|${l.weight}|${l.w.toFixed(2)}|${l.h.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = Math.min(TEXT_MASK_SCALE, 4096 / Math.max(l.w, l.h, 1));
  const mw = Math.max(1, Math.ceil(l.w * s));
  const mh = Math.max(1, Math.ceil(l.h * s));
  const canvas = document.createElement('canvas');
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.translate((l.w * s) / 2, (l.h * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#000';
  drawTextLocal(ctx, l);
  const data = ctx.getImageData(0, 0, mw, mh).data;
  const min = Math.ceil(MIN_RECT_PX * s - 1e-9);
  const rects = fattenRuns(maskToRuns(data, mw, mh, 4, 3), data, mw, mh, min, min, 4, 3).map((r) => ({
    x: (r.x0 + r.x1) / 2 / s - l.w / 2,
    y: (r.y0 + r.y1) / 2 / s - l.h / 2,
    w: (r.x1 - r.x0) / s,
    h: (r.y1 - r.y0) / s,
  }));
  if (cache.size > 200) cache.clear();
  cache.set(key, rects);
  return rects;
}
