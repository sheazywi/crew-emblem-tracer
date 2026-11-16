import { CANVAS, type Layer } from '../model/types';
import { rad } from './geometry';
import { fillRule, layerPath } from './paths';
import { drawTextLocal } from './text';

export function applyLayerTransform(ctx: CanvasRenderingContext2D, l: Layer): void {
  ctx.translate(l.x, l.y);
  if (l.rot) ctx.rotate(rad(l.rot));
  if (l.fx || l.fy) ctx.scale(l.fx ? -1 : 1, l.fy ? -1 : 1);
}

/** Draw one layer in canvas coordinates. `alphaMul` dims it (used for ghosts outside the canvas). */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, alphaMul = 1): void {
  if (!l.visible || l.opacity <= 0) return;
  ctx.save();
  applyLayerTransform(ctx, l);
  ctx.globalAlpha = l.opacity * alphaMul;
  ctx.fillStyle = l.color;
  if (l.type === 'text') drawTextLocal(ctx, l);
  else ctx.fill(layerPath(l), fillRule(l));
  ctx.restore();
}

export function drawLayers(ctx: CanvasRenderingContext2D, layers: readonly Layer[]): void {
  for (const l of layers) drawLayer(ctx, l);
}

/** Render the design to a fresh transparent canvas of size x size px. */
export function renderToCanvas(layers: readonly Layer[], size = CANVAS): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.scale(size / CANVAS, size / CANVAS);
  drawLayers(ctx, layers);
  return canvas;
}
