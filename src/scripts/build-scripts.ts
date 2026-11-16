import { CONTRACT, type Packed } from '../socialclub/editor-contract';
import importTemplate from './import.template.js?raw';
import traceTemplate from './trace.template.js?raw';

/**
 * Builds the two console scripts. Both are generated from templates kept as real .js files
 * (linted and unit-tested), with data injected at a placeholder using a function replacer, so
 * `$` sequences in names or data can never be interpreted.
 */

/** Logged by both scripts as "Crest Forge vX.Y.Z" so bug reports name the script version. */
export const SCRIPT_VERSION = '1.4.0';

export interface TraceScriptOptions {
  /** Shape groups to trace with, or 'all' for every shape in the editor's library. */
  groups: string[] | 'all';
  /** Auto (max that fits): let the script compute the shape count from the real path lengths. */
  auto: boolean;
  /** Shape count when auto is off, at most 740. */
  count: number;
  /** Layer opacity, 0.2..1. */
  alpha: number;
  /** Working resolution: 96, 128, 192 or 256. */
  res: number;
  /** K random candidates per shape. */
  cand: number;
  /** M failed mutations in a row end the hill climb. */
  mut: number;
  /** Add a background rectangle in the picture's mean colour. */
  bg: boolean;
  /** Run the whole trace without touching the canvas; the result lands in window.__crestForgeTrace. */
  dry: boolean;
  /** No dialogs from the script itself (console output only). */
  quiet: boolean;
  /**
   * Stop once the last 10 shapes improve the match by less than this fraction of the starting
   * error each, on average (0 or absent = never).
   */
  minGain?: number;
}

export function buildImportScript(data: readonly Packed[]): string {
  if (!data.length) throw new Error('Nothing to export: the design has no visible layers');
  return importTemplate.replace('__DATA__', () => JSON.stringify(data));
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function buildTraceScript(imageDataUrl: string, options: TraceScriptOptions): string {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) {
    throw new Error('The trace script needs a PNG data URL');
  }
  let groups: string[] | 'all' = 'all';
  if (options.groups !== 'all') {
    groups = options.groups.filter((g) => /^[a-z0-9-]+$/i.test(g));
    if (!groups.length) throw new Error('Choose at least one shape family');
  }
  const opt: TraceScriptOptions = {
    groups,
    auto: !!options.auto,
    count: clamp(Math.round(options.count) || CONTRACT.layersAuto, 1, CONTRACT.layersAuto),
    alpha: clamp(options.alpha, 0.2, 1),
    res: clamp(Math.round(options.res), 32, 256),
    cand: clamp(Math.round(options.cand), 1, 400),
    mut: clamp(Math.round(options.mut), 1, 600),
    bg: !!options.bg,
    dry: !!options.dry,
    quiet: !!options.quiet,
    minGain: clamp(Number(options.minGain) || 0, 0, 0.01),
  };
  // One pass, so injected text is never scanned for the other placeholder.
  return traceTemplate.replace(/__(IMG|OPT)__/g, (_m, which: string) =>
    JSON.stringify(which === 'IMG' ? imageDataUrl : opt),
  );
}
