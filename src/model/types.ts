/** Document model. Drawing order is array order: index 0 is at the back. */

export type LayerType =
  'rect' | 'round' | 'ellipse' | 'triangle' | 'rtri' | 'star' | 'poly' | 'ring' | 'path' | 'text';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  /** Centre and size, canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise. */
  rot: number;
  /** Flips in local space. */
  fx: boolean;
  fy: boolean;
  /** '#rrggbb'. */
  color: string;
  /** 0..1. */
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Star points / polygon sides. */
  n?: number;
  /** Ring hole ratio or star inner ratio, 0..1. */
  inner?: number;
  /** Corner radius of a rounded rectangle, percent of the shorter side (0..50). */
  r?: number;
  /** 'path': flat local points normalised to -0.5..0.5. */
  pts?: number[];
  text?: string;
  font?: string;
  weight?: number;
}

export const CANVAS = 512;

export const LAYER_TYPES: readonly LayerType[] = [
  'rect',
  'round',
  'ellipse',
  'triangle',
  'rtri',
  'star',
  'poly',
  'ring',
  'path',
  'text',
];

export const TYPE_LABEL: Record<LayerType, string> = {
  rect: 'Rectangle',
  round: 'Rounded',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  rtri: 'Right triangle',
  star: 'Star',
  poly: 'Polygon',
  ring: 'Ring',
  path: 'Shape',
  text: 'Text',
};

let seq = 0;

export function uid(): string {
  seq = (seq + 1) % 46656;
  return 'l' + Date.now().toString(36) + seq.toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

export function makeLayer(type: LayerType, over: Partial<Layer> = {}): Layer {
  const base: Layer = {
    id: uid(),
    type,
    name: TYPE_LABEL[type],
    x: CANVAS / 2,
    y: CANVAS / 2,
    w: 160,
    h: 160,
    rot: 0,
    fx: false,
    fy: false,
    color: '#f5a524',
    opacity: 1,
    visible: true,
    locked: false,
  };
  if (type === 'star') Object.assign(base, { n: 5, inner: 0.45 });
  if (type === 'poly') Object.assign(base, { n: 6 });
  if (type === 'ring') Object.assign(base, { inner: 0.7 });
  if (type === 'round') Object.assign(base, { w: 220, h: 120, r: 25 });
  if (type === 'rect') Object.assign(base, { w: 200, h: 130 });
  if (type === 'text')
    Object.assign(base, { w: 220, h: 60, text: 'CREW', font: 'Chakra Petch', weight: 700 });
  return { ...base, ...over };
}

export function cloneLayers(layers: readonly Layer[]): Layer[] {
  return layers.map((l) => ({ ...l, pts: l.pts ? l.pts.slice() : undefined }));
}
