import type { Layer } from '../model/types';

/**
 * Text is drawn by measuring the glyph bounding box at 100 px and scaling it to exactly w x h,
 * so a text layer behaves like any other box.
 */

export const FONTS: readonly string[] = [
  'Chakra Petch',
  'IBM Plex Sans',
  'JetBrains Mono',
  'Impact',
  'Georgia',
  'Arial',
  'Courier New',
];

export interface TextBox {
  /** Left and top of the glyph bounds relative to the text origin (alphabetic baseline). */
  l: number;
  t: number;
  w: number;
  h: number;
}

const cache = new Map<string, TextBox>();
const listeners = new Set<() => void>();
let measureCtx: CanvasRenderingContext2D | null = null;

export function fontSpec(font: string | undefined, weight: number | undefined): string {
  const family = (font || 'Chakra Petch').replace(/["\\;{}]/g, '');
  return `${weight || 700} 100px "${family}", sans-serif`;
}

export function textOf(l: Layer): string {
  return l.text && l.text.trim() ? l.text : ' ';
}

export function textBox(text: string, font: string | undefined, weight: number | undefined): TextBox {
  const spec = fontSpec(font, weight);
  const key = spec + '\n' + text;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  let box: TextBox = { l: 0, t: -70, w: 60, h: 70 };
  if (measureCtx) {
    measureCtx.font = spec;
    measureCtx.textBaseline = 'alphabetic';
    measureCtx.textAlign = 'left';
    const m = measureCtx.measureText(text);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (w > 0.5 && h > 0.5) box = { l: -m.actualBoundingBoxLeft, t: -m.actualBoundingBoxAscent, w, h };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, box);
  return box;
}

/** Draw the layer's text in its local frame (centre at the origin), fitted to w x h. */
export function drawTextLocal(ctx: CanvasRenderingContext2D, l: Layer): void {
  const text = textOf(l);
  const box = textBox(text, l.font, l.weight);
  ctx.save();
  ctx.scale(l.w / box.w, l.h / box.h);
  ctx.font = fontSpec(l.font, l.weight);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(text, -box.l - box.w / 2, -box.t - box.h / 2);
  ctx.restore();
}

/** Run `fn` whenever cached text measurements become stale (a web font finished loading). */
export function onTextInvalidated(fn: () => void): void {
  listeners.add(fn);
}

export function invalidateText(): void {
  cache.clear();
  for (const fn of listeners) fn();
}

/** Ask the browser to load the bundled web fonts used by text layers, then invalidate caches. */
export function watchFonts(): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  document.fonts.addEventListener('loadingdone', invalidateText);
  for (const family of FONTS.slice(0, 3)) {
    for (const weight of [400, 700]) {
      document.fonts.load(`${weight} 100px "${family}"`).catch(() => undefined);
    }
  }
}
