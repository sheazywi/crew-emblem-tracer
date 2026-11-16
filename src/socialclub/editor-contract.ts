import type { Pt } from '../render/geometry';

/**
 * The observed, UNOFFICIAL contract of the Rockstar Games Social Club crew emblem editor.
 *
 * Every value here comes from the Crest Forge build specification, which measured them on the
 * live editor in November 2026 (build 20261031cgjfchh). This repository has not re-measured
 * them. Rockstar can change their site at any time: run `pnpm contract:check` in a signed-in
 * editor tab before each release and update this file (and docs/editor-contract.md) together.
 *
 * Only the handful of primitive outlines below may live in this app. Never add other shape
 * artwork from the editor's library here.
 */
export const CONTRACT = {
  measured: '2026-11',
  build: '20261031cgjfchh',
  editorUrl: 'https://socialclub.rockstargames.com/emblems/new',
  canvas: 512,
  /** Hard limit in the editor; the internal background layer is not counted. */
  layersMax: 750,
  /** What exporters and tracers aim for: 750 minus a safety margin. */
  layersAuto: 740,
  /** svgData + layerData length, both base64. Above this the editor refuses to save. */
  saveMax: 1_048_576,
  /** Budget for automatic shape counts: about 92% of saveMax. */
  saveAuto: 960_000,
  /** Warn above this fraction of saveMax. */
  warnFraction: 0.95,
  /** Scale percent that survives a reload (the UI offers 5..500; below 1 is clamped on load). */
  scaleMin: 1,
  scaleMax: 500,
  /** The in-editor tracer keeps its exported scales at or below this. */
  traceScaleMax: 490,
  /** Pieces narrower than this many px are dropped by the converter. */
  dropBelowPx: 0.4,
  /** bytes per layer ~= costBase64 * (costBase + costPerPathChar * pathLength + nameLength) */
  costBase: 742,
  costPerPathChar: 1.2,
  costBase64: 4 / 3,
  /** Tracer B skips library shapes whose path is longer than this (6000 with every shape). */
  tracePathMax: 4000,
  tracePathMaxAll: 6000,
  /** Median library path length, used for slugs this app knows nothing about. */
  medianPathLen: 558,
  groupPrefix: 'emblems/shapes/',
} as const;

export const SLUG = {
  square: 'rectangles/square',
  circle: 'rounds/01',
  iso: 'angles/03',
  right: 'angles/05',
  hex: 'polygons/04',
} as const;

export interface Prim {
  /** Native box. The editor places the box centre (w/2, h/2) at (x + w/2, y + h/2). */
  w: number;
  h: number;
  shape: 'rect' | 'circle' | 'poly' | 'ring';
  /** Outline in native coordinates (polygons only). */
  pts?: Pt[];
  /** Hole radius / outer radius (rings only). */
  ratio?: number;
  /**
   * Effective path length for the save-size estimate. For the five solid primitives it is
   * back-solved from the measured per-layer cost (about 1,100 bytes for square and circle,
   * about 1,050 for triangles and the hexagon).
   */
  pathLen: number;
  /** True when pathLen is an assumption that still needs measuring with contract:check. */
  pathLenAssumed?: boolean;
}

const ring = (ratio: number, size = 300): Prim => ({
  w: size,
  h: size,
  shape: 'ring',
  ratio,
  pathLen: 600,
  pathLenAssumed: true,
});

/** The only editor geometry this app carries: the primitives needed for an exact preview. */
export const PRIMS: Readonly<Record<string, Prim>> = {
  [SLUG.square]: { w: 300, h: 300, shape: 'rect', pathLen: 67 },
  [SLUG.circle]: { w: 300, h: 300, shape: 'circle', pathLen: 67 },
  // Isosceles triangle: base (0,300)-(158.91,300), apex (79.457,0).
  [SLUG.iso]: {
    w: 159,
    h: 300,
    shape: 'poly',
    pts: [
      [0, 300],
      [158.91, 300],
      [79.457, 0],
    ],
    pathLen: 35,
  },
  // Right triangle: right angle at (192,300), legs to (0,300) and (192,0).
  [SLUG.right]: {
    w: 192,
    h: 300,
    shape: 'poly',
    pts: [
      [192, 300],
      [0, 300],
      [192, 0],
    ],
    pathLen: 35,
  },
  // Flat-top regular hexagon.
  [SLUG.hex]: {
    w: 300,
    h: 260,
    shape: 'poly',
    pts: [
      [75, 0],
      [225, 0],
      [300, 129.9],
      [225, 259.8],
      [75, 259.8],
      [0, 129.9],
    ],
    pathLen: 35,
  },
  'rounds/67': ring(0.9933),
  'rounds/68': ring(0.9667),
  'rounds/69': ring(0.9333),
  'rounds/70': ring(0.8333),
  'rounds/13': ring(0.3183),
  'rounds/14': ring(0.4887, 288),
};

/** Ring slugs by hole ratio, ascending. */
export const RING_SLUGS: readonly { slug: string; ratio: number }[] = Object.entries(PRIMS)
  .filter(([, p]) => p.shape === 'ring')
  .map(([slug, p]) => ({ slug, ratio: p.ratio as number }))
  .sort((a, b) => a.ratio - b.ratio);

/** Shape-group families offered for the in-editor tracer. */
export const FAMILIES = {
  basic: ['rounds', 'squares', 'triangles', 'rectangles', 'polygons'],
  curves: ['curves', 'angles', 'perspective', 'radials'],
} as const;

/**
 * Compact layer passed to the console scripts:
 * [slug, x, y, scaleX, scaleY, rotation, opacity, color, invertedX, invertedY, name]
 */
export type Packed = [
  slug: string,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  opacity: number,
  color: string,
  invertedX: boolean,
  invertedY: boolean,
  name: string,
];
