import { LAYER_TYPES, TYPE_LABEL, uid, type Layer, type LayerType } from './types';

const KEY = 'crest-forge:doc:v1';
const MAX_LAYERS = 5000;

const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Turn untrusted JSON (a project file, old autosave) into a valid layer array. */
export function sanitizeLayers(input: unknown): Layer[] {
  if (!Array.isArray(input)) throw new Error('Not a Crest Forge layer list');
  const out: Layer[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_LAYERS)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (!LAYER_TYPES.includes(o.type as LayerType)) continue;
    const type = o.type as LayerType;
    let id = typeof o.id === 'string' && o.id.length > 0 && o.id.length < 64 ? o.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const layer: Layer = {
      id,
      type,
      name: typeof o.name === 'string' ? o.name.slice(0, 80) : TYPE_LABEL[type],
      x: num(o.x, 256, -1e5, 1e5),
      y: num(o.y, 256, -1e5, 1e5),
      w: num(o.w, 100, 0.01, 1e5),
      h: num(o.h, 100, 0.01, 1e5),
      rot: num(o.rot, 0, -1e6, 1e6),
      fx: o.fx === true,
      fy: o.fy === true,
      color:
        typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#ffffff',
      opacity: num(o.opacity, 1, 0, 1),
      visible: o.visible !== false,
      locked: o.locked === true,
    };
    if (type === 'star' || type === 'poly') layer.n = Math.round(num(o.n, type === 'star' ? 5 : 6, 3, 64));
    if (type === 'star') layer.inner = num(o.inner, 0.45, 0.05, 0.95);
    if (type === 'ring') layer.inner = num(o.inner, 0.7, 0.01, 0.99);
    if (type === 'round') layer.r = num(o.r, 25, 0, 50);
    if (type === 'path') {
      const pts = Array.isArray(o.pts)
        ? o.pts.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        : [];
      if (pts.length < 6 || pts.length % 2 !== 0 || pts.length > 4000) continue;
      layer.pts = pts;
    }
    if (type === 'text') {
      layer.text = typeof o.text === 'string' ? o.text.slice(0, 200) : 'TEXT';
      layer.font = typeof o.font === 'string' ? o.font.replace(/["\\;{}]/g, '').slice(0, 60) : 'Chakra Petch';
      layer.weight = Math.round(num(o.weight, 700, 100, 900) / 100) * 100;
    }
    out.push(layer);
  }
  return out;
}

export function toProjectJson(layers: readonly Layer[]): string {
  return JSON.stringify({ app: 'crest-forge', version: 1, layers }, null, 1);
}

export function fromProjectJson(text: string): Layer[] {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return sanitizeLayers(data);
  if (data && typeof data === 'object' && Array.isArray((data as { layers?: unknown }).layers)) {
    return sanitizeLayers((data as { layers: unknown }).layers);
  }
  throw new Error('This file is not a Crest Forge project');
}

/** Autosave. Returns false when storage is unavailable (private mode, blocked, full). */
export function saveLocal(layers: readonly Layer[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, layers }));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal(): Layer[] | null {
  try {
    const text = window.localStorage.getItem(KEY);
    if (!text) return null;
    const layers = fromProjectJson(text);
    return layers.length ? layers : null;
  } catch {
    return null;
  }
}
