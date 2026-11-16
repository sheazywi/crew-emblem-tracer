import { CANVAS, type Layer } from '../model/types';
import { rad } from '../render/geometry';
import { renderToCanvas } from '../render/renderer';
import { toSocialClub, type ConvertOptions } from './convert';
import { PRIMS, type Packed } from './editor-contract';

/**
 * "Preview it the way Social Club will draw it": renders converted layers with the primitive
 * outlines from the contract and the editor's transform, so seams or mistakes show up before
 * importing.
 */

const cache = new Map<string, Path2D>();

export function primPath(slug: string): Path2D | null {
  const hit = cache.get(slug);
  if (hit) return hit;
  const prim = PRIMS[slug];
  if (!prim) return null;
  const p = new Path2D();
  if (prim.shape === 'rect') {
    p.rect(0, 0, prim.w, prim.h);
  } else if (prim.shape === 'circle') {
    p.arc(prim.w / 2, prim.h / 2, prim.w / 2, 0, Math.PI * 2);
  } else if (prim.shape === 'ring') {
    const c = prim.w / 2;
    const hole = c * (prim.ratio ?? 0.5);
    p.arc(c, c, c, 0, Math.PI * 2);
    p.moveTo(c + hole, c);
    p.arc(c, c, hole, 0, Math.PI * 2);
  } else {
    (prim.pts ?? []).forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
    p.closePath();
  }
  cache.set(slug, p);
  return p;
}

/**
 * The editor's transform, T{x},{y} R{rotation},{x + w/2},{y + h/2} S{scaleX/100},{scaleY/100},
 * in Canvas 2D terms.
 */
export function drawPacked(ctx: CanvasRenderingContext2D, layers: readonly Packed[]): void {
  for (const [slug, x, y, sx, sy, rotation, opacity, color] of layers) {
    const prim = PRIMS[slug];
    const path = primPath(slug);
    if (!prim || !path) continue;
    ctx.save();
    ctx.translate(x + prim.w / 2, y + prim.h / 2);
    ctx.rotate(rad(rotation));
    ctx.scale(sx / 100, sy / 100);
    ctx.translate(-prim.w / 2, -prim.h / 2);
    ctx.globalAlpha = opacity / 100;
    ctx.fillStyle = color;
    ctx.fill(path, prim.shape === 'ring' ? 'evenodd' : 'nonzero');
    ctx.restore();
  }
}

export function renderPacked(layers: readonly Packed[], size = CANVAS): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.scale(size / CANVAS, size / CANVAS);
  drawPacked(ctx, layers);
  return canvas;
}

/** Fraction of pixels whose premultiplied colour or alpha differs by more than `threshold`/255. */
export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 60): number {
  const n = Math.min(a.length, b.length);
  let bad = 0;
  for (let i = 0; i < n; i += 4) {
    const aa = a[i + 3] / 255;
    const ba = b[i + 3] / 255;
    const d = Math.max(
      Math.abs(a[i] * aa - b[i] * ba),
      Math.abs(a[i + 1] * aa - b[i + 1] * ba),
      Math.abs(a[i + 2] * aa - b[i + 2] * ba),
      Math.abs(a[i + 3] - b[i + 3]),
    );
    if (d > threshold) bad++;
  }
  return bad / (n / 4);
}

const pixels = (c: HTMLCanvasElement): Uint8ClampedArray => {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx.getImageData(0, 0, c.width, c.height).data;
};

/** Golden comparison: the design drawn normally versus drawn through the Social Club preview. */
export function goldenDiff(
  layers: readonly Layer[],
  opt: ConvertOptions = {},
): { fraction: number; scLayers: number } {
  const converted = toSocialClub(layers, opt);
  const fraction = pixelDiff(pixels(renderToCanvas(layers)), pixels(renderPacked(converted.layers)));
  return { fraction, scLayers: converted.layers.length };
}
