import type { ShapeKind } from '../trace/core';
import { CONTRACT, PRIMS, SLUG, type Packed } from './editor-contract';

/**
 * Save-size estimate and automatic shape budget.
 *
 * The editor refuses to save when base64(layer JSON) + base64(canvas SVG) is longer than
 * 1,048,576 characters. Measured per layer: the SVG element is about 330 + 1.2 * path length,
 * the layer JSON about 400 + name length, hence
 *
 *   bytes ~= 4/3 * (742 + 1.2 * pathLength + nameLength)
 */

export function layerCost(pathLen: number, nameLen: number): number {
  return CONTRACT.costBase64 * (CONTRACT.costBase + CONTRACT.costPerPathChar * pathLen + nameLen);
}

export function pathLenOf(slug: string): number {
  return PRIMS[slug]?.pathLen ?? CONTRACT.medianPathLen;
}

/** Estimated save payload of a converted design, in characters. */
export function scBytes(layers: readonly Packed[]): number {
  let total = 0;
  for (const l of layers) total += layerCost(pathLenOf(l[0]), l[10].length);
  return Math.round(total);
}

export type Binding = 'layers' | 'size';

/** Length of the short names tracers and the converter give their layers ("t123", "c1f"). */
const NAME_LEN = 4;

export interface KindCost {
  /** Social Club layers per shape (worst case). */
  n: number;
  /** Bytes per shape (worst case). */
  b: number;
}

/** Expected Social Club cost of one traced shape of each kind. */
export function kindCost(kind: ShapeKind): KindCost {
  // A free triangle becomes two right triangles unless it happens to be right or isosceles.
  if (kind === 'triangle') return { n: 2, b: 2 * layerCost(pathLenOf(SLUG.right), NAME_LEN) };
  return { n: 1, b: layerCost(pathLenOf(kind === 'rect' ? SLUG.square : SLUG.circle), NAME_LEN) };
}

/** Worst case among the selected kinds, so a budget computed from it is always safe. */
export function worstCost(kinds: readonly ShapeKind[]): KindCost {
  let n = 1;
  let b = layerCost(pathLenOf(SLUG.circle), NAME_LEN);
  for (const k of kinds) {
    const c = kindCost(k);
    n = Math.max(n, c.n);
    b = Math.max(b, c.b);
  }
  return { n, b };
}

export interface BudgetInput {
  /** Expected layers and bytes per shape. */
  perShape: KindCost;
  /** Background rectangle: layers and bytes (0 when off). */
  backgroundLayers: number;
  backgroundBytes: number;
  /** The current design's own cost (0 when the trace replaces it). */
  existingLayers: number;
  existingBytes: number;
}

export interface Budget {
  n: number;
  binding: Binding;
}

/**
 * N_max = min( floor((L_max - l_e - l_0) / n), floor((B_max - b_e - b_0) / b) )
 */
export function shapeBudget(i: BudgetInput): Budget {
  const byLayers = Math.floor((CONTRACT.layersAuto - i.existingLayers - i.backgroundLayers) / i.perShape.n);
  const bySize = Math.floor((CONTRACT.saveAuto - i.existingBytes - i.backgroundBytes) / i.perShape.b);
  const binding: Binding = bySize < byLayers ? 'size' : 'layers';
  return { n: Math.max(0, Math.min(byLayers, bySize)), binding };
}

export function backgroundCost(): number {
  return layerCost(pathLenOf(SLUG.square), NAME_LEN);
}

export function bindingText(binding: Binding): string {
  return binding === 'size'
    ? `limited by save size (layer limit ${CONTRACT.layersAuto})`
    : `limited by the layer limit (${CONTRACT.layersAuto})`;
}

export interface Usage {
  layers: number;
  bytes: number;
  /** Fractions of the hard limits (750 layers, 1,048,576 characters). */
  layerFraction: number;
  byteFraction: number;
  overLayers: boolean;
  overBytes: boolean;
  /** Above 95% of the save limit, or above the 740-layer safety margin. */
  warn: boolean;
  /** How many more simple shapes fit under both budgets. */
  room: number;
  roomBinding: Binding;
}

export function usage(layers: readonly Packed[]): Usage {
  const n = layers.length;
  const bytes = scBytes(layers);
  const simple = layerCost(pathLenOf(SLUG.circle), NAME_LEN);
  const roomLayers = Math.max(0, CONTRACT.layersAuto - n);
  const roomBytes = Math.max(0, Math.floor((CONTRACT.saveAuto - bytes) / simple));
  return {
    layers: n,
    bytes,
    layerFraction: n / CONTRACT.layersMax,
    byteFraction: bytes / CONTRACT.saveMax,
    overLayers: n > CONTRACT.layersMax,
    overBytes: bytes > CONTRACT.saveMax,
    warn: bytes > CONTRACT.saveMax * CONTRACT.warnFraction || n > CONTRACT.layersAuto,
    room: Math.min(roomLayers, roomBytes),
    roomBinding: roomBytes < roomLayers ? 'size' : 'layers',
  };
}

export const kb = (bytes: number): string => `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;
