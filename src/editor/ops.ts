import { PRESETS } from '../model/presets';
import type { Store } from '../model/store';
import { CANVAS, makeLayer, TYPE_LABEL, uid, type Layer, type LayerType } from '../model/types';
import { unionBounds } from '../render/geometry';

/** Document operations shared by the keyboard, the rail and the inspector. Each is one undo step. */

function uniqueName(store: Store, base: string): string {
  const names = new Set(store.layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Add a shape at the canvas centre. `kind` is a layer type or "preset:<name>". */
export function addShape(store: Store, kind: string): Layer | null {
  let layer: Layer;
  if (kind.startsWith('preset:')) {
    const preset = PRESETS[kind.slice(7)];
    if (!preset) return null;
    layer = makeLayer('path', {
      name: uniqueName(store, preset.label),
      pts: preset.pts,
      w: preset.w,
      h: preset.h,
    });
  } else {
    const type = kind as LayerType;
    if (!(type in TYPE_LABEL)) return null;
    layer = makeLayer(type, { name: uniqueName(store, TYPE_LABEL[type]) });
  }
  store.checkpoint();
  store.layers.push(layer);
  store.touch();
  store.select([layer.id]);
  return layer;
}

export function removeSelected(store: Store): void {
  if (!store.sel.size) return;
  store.checkpoint();
  store.layers = store.layers.filter((l) => !store.sel.has(l.id));
  store.touch();
  store.select([]);
}

function insertCopies(store: Store, sources: readonly Layer[], offset: number): void {
  if (!sources.length) return;
  store.checkpoint();
  const copies = sources.map((l) => ({
    ...l,
    id: uid(),
    name: uniqueName(store, l.name),
    x: l.x + offset,
    y: l.y + offset,
    pts: l.pts ? l.pts.slice() : undefined,
    locked: false,
  }));
  store.layers.push(...copies);
  store.touch();
  store.select(copies.map((c) => c.id));
}

export function duplicateSelected(store: Store): void {
  insertCopies(store, store.selected(), 12);
}

let clipboard: Layer[] = [];

export function copySelected(store: Store): void {
  clipboard = store.selected().map((l) => ({ ...l, pts: l.pts ? l.pts.slice() : undefined }));
}

export function pasteLayers(store: Store): boolean {
  if (!clipboard.length) return false;
  insertCopies(store, clipboard, 12);
  return true;
}

export function selectAll(store: Store): void {
  store.select(store.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
}

export function nudge(store: Store, dx: number, dy: number): void {
  const sel = store.selected().filter((l) => !l.locked);
  if (!sel.length) return;
  store.checkpoint();
  for (const l of sel) {
    l.x += dx;
    l.y += dy;
  }
  store.touch();
}

/** Move the selection one step forward (dir 1) or back (dir -1), or all the way with `edge`. */
export function reorder(store: Store, dir: 1 | -1, edge: boolean): void {
  if (!store.sel.size) return;
  const layers = store.layers.slice();
  const picked = (l: Layer): boolean => store.sel.has(l.id);
  if (edge) {
    const moving = layers.filter(picked);
    const rest = layers.filter((l) => !picked(l));
    store.checkpoint();
    store.layers = dir === 1 ? [...rest, ...moving] : [...moving, ...rest];
    store.touch();
    return;
  }
  let changed = false;
  if (dir === 1) {
    for (let i = layers.length - 2; i >= 0; i--) {
      if (picked(layers[i]) && !picked(layers[i + 1])) {
        [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
        changed = true;
      }
    }
  } else {
    for (let i = 1; i < layers.length; i++) {
      if (picked(layers[i]) && !picked(layers[i - 1])) {
        [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]];
        changed = true;
      }
    }
  }
  if (!changed) return;
  store.checkpoint();
  store.layers = layers;
  store.touch();
}

/** Mirror the selection as a group about its own centre line. */
export function flipSelected(store: Store, axis: 'h' | 'v'): void {
  const sel = store.selected().filter((l) => !l.locked);
  if (!sel.length) return;
  const b = unionBounds(sel);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  store.checkpoint();
  for (const l of sel) {
    // Mirroring T(x,y) R(rot) F is T(x',y) R(-rot) with the matching flip toggled.
    if (axis === 'h') {
      l.x = 2 * cx - l.x;
      l.fx = !l.fx;
    } else {
      l.y = 2 * cy - l.y;
      l.fy = !l.fy;
    }
    l.rot = (((-l.rot % 360) + 360) % 360) + 0;
  }
  store.touch();
}

/** Move the selection so its bounds are centred on the canvas. */
export function centreSelected(store: Store): void {
  const sel = store.selected().filter((l) => !l.locked);
  if (!sel.length) return;
  const b = unionBounds(sel);
  const dx = CANVAS / 2 - (b.x0 + b.x1) / 2;
  const dy = CANVAS / 2 - (b.y0 + b.y1) / 2;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
  store.checkpoint();
  for (const l of sel) {
    l.x += dx;
    l.y += dy;
  }
  store.touch();
}

/** Scale the selection as a group about its centre. */
export function scaleSelected(store: Store, percent: number): void {
  const sel = store.selected().filter((l) => !l.locked);
  const s = percent / 100;
  if (!sel.length || !Number.isFinite(s) || s <= 0 || s === 1) return;
  const b = unionBounds(sel);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  store.checkpoint();
  for (const l of sel) {
    l.x = cx + (l.x - cx) * s;
    l.y = cy + (l.y - cy) * s;
    l.w = Math.max(0.5, l.w * s);
    l.h = Math.max(0.5, l.h * s);
  }
  store.touch();
}

export function recolorSelected(store: Store, color: string): void {
  const sel = store.selected();
  if (!sel.length) return;
  store.checkpoint();
  for (const l of sel) l.color = color;
  store.touch();
}
