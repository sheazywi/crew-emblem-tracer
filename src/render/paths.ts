import type { Layer } from '../model/types';
import { cornerRadius, outlineLocal, ringHole } from './geometry';

/** Path2D builders. Paths are in the layer's local frame, centre at the origin. */

interface Cached {
  key: string;
  pts: number[] | undefined;
  path: Path2D;
}

const cache = new WeakMap<Layer, Cached>();

export function fillRule(l: Layer): CanvasFillRule {
  return l.type === 'ring' ? 'evenodd' : 'nonzero';
}

export function layerPath(l: Layer): Path2D {
  const key = `${l.type}|${l.w}|${l.h}|${l.n}|${l.inner}|${l.r}`;
  const hit = cache.get(l);
  if (hit && hit.key === key && hit.pts === l.pts) return hit.path;
  const path = buildPath(l);
  cache.set(l, { key, pts: l.pts, path });
  return path;
}

export function buildPath(l: Layer): Path2D {
  const p = new Path2D();
  const hw = l.w / 2;
  const hh = l.h / 2;
  switch (l.type) {
    case 'ellipse':
      p.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'ring': {
      const k = ringHole(l);
      p.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      p.moveTo(hw * k, 0);
      p.ellipse(0, 0, hw * k, hh * k, 0, 0, Math.PI * 2);
      break;
    }
    case 'round': {
      const r = cornerRadius(l);
      if (r <= 0.01) {
        p.rect(-hw, -hh, l.w, l.h);
      } else {
        p.moveTo(-hw + r, -hh);
        p.lineTo(hw - r, -hh);
        p.arc(hw - r, -hh + r, r, -Math.PI / 2, 0);
        p.lineTo(hw, hh - r);
        p.arc(hw - r, hh - r, r, 0, Math.PI / 2);
        p.lineTo(-hw + r, hh);
        p.arc(-hw + r, hh - r, r, Math.PI / 2, Math.PI);
        p.lineTo(-hw, -hh + r);
        p.arc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
        p.closePath();
      }
      break;
    }
    case 'text':
      p.rect(-hw, -hh, l.w, l.h);
      break;
    default: {
      const pts = outlineLocal(l) ?? [];
      pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
      p.closePath();
    }
  }
  return p;
}
