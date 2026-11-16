import { CANVAS, type Layer } from '../model/types';
import { cornerRadius, outlineLocal, ringHole } from './geometry';
import { renderToCanvas } from './renderer';
import { fontSpec, textBox, textOf } from './text';

const f = (v: number): string => String(+v.toFixed(3));
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ellipseD(rx: number, ry: number): string {
  return `M${f(rx)} 0A${f(rx)} ${f(ry)} 0 1 1 ${f(-rx)} 0A${f(rx)} ${f(ry)} 0 1 1 ${f(rx)} 0Z`;
}

function shapeMarkup(l: Layer): string {
  const hw = l.w / 2;
  const hh = l.h / 2;
  switch (l.type) {
    case 'ellipse':
      return `<ellipse rx="${f(hw)}" ry="${f(hh)}"/>`;
    case 'ring': {
      const k = ringHole(l);
      return `<path fill-rule="evenodd" d="${ellipseD(hw, hh)}${ellipseD(hw * k, hh * k)}"/>`;
    }
    case 'rect':
      return `<rect x="${f(-hw)}" y="${f(-hh)}" width="${f(l.w)}" height="${f(l.h)}"/>`;
    case 'round':
      return `<rect x="${f(-hw)}" y="${f(-hh)}" width="${f(l.w)}" height="${f(l.h)}" rx="${f(cornerRadius(l))}"/>`;
    case 'text': {
      const text = textOf(l);
      const box = textBox(text, l.font, l.weight);
      const family = fontSpec(l.font, l.weight).replace(/^\d+ 100px /, '');
      return (
        `<text transform="scale(${f(l.w / box.w)} ${f(l.h / box.h)})" x="${f(-box.l - box.w / 2)}" ` +
        `y="${f(-box.t - box.h / 2)}" font-family="${esc(family)}" font-weight="${l.weight || 700}" ` +
        `font-size="100">${esc(text)}</text>`
      );
    }
    default: {
      const pts = outlineLocal(l) ?? [];
      return `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>`;
    }
  }
}

/** SVG export: one <g transform> per visible layer, 512 x 512 viewBox. */
export function toSVG(layers: readonly Layer[]): string {
  const body = layers
    .filter((l) => l.visible && l.opacity > 0)
    .map((l) => {
      const flip = l.fx || l.fy ? ` scale(${l.fx ? -1 : 1} ${l.fy ? -1 : 1})` : '';
      const rot = l.rot ? ` rotate(${f(l.rot)})` : '';
      const opacity = l.opacity < 1 ? ` opacity="${f(l.opacity)}"` : '';
      return `  <g transform="translate(${f(l.x)} ${f(l.y)})${rot}${flip}" fill="${l.color}"${opacity}>${shapeMarkup(l)}</g>`;
    })
    .join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">\n` +
    `${body}\n</svg>\n`
  );
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportPNG(layers: readonly Layer[], size: number): Promise<void> {
  return new Promise((resolve, reject) => {
    renderToCanvas(layers, size).toBlob((blob) => {
      if (!blob) return reject(new Error('PNG export failed'));
      download(`crest-${size}.png`, blob);
      resolve();
    }, 'image/png');
  });
}

export function exportSVG(layers: readonly Layer[]): void {
  download('crest.svg', new Blob([toSVG(layers)], { type: 'image/svg+xml' }));
}
