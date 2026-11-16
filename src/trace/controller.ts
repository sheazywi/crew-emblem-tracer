import type { Store } from '../model/store';
import { CANVAS, type Layer } from '../model/types';
import { toSocialClub } from '../socialclub/convert';
import { CONTRACT } from '../socialclub/editor-contract';
import { backgroundCost, kb, scBytes, shapeBudget, worstCost, type Budget } from '../socialclub/size';
import { workerSource, type ShapeKind, type WorkerMessage } from './core';
import { backgroundLayer, shapeToLayer, traceMap } from './toLayer';

export type Effort = 'fast' | 'balanced' | 'best';

/** K random candidates and M failed mutations in a row, per shape. */
export const EFFORT: Record<Effort, { cand: number; mut: number }> = {
  fast: { cand: 30, mut: 40 },
  balanced: { cand: 60, mut: 80 },
  best: { cand: 120, mut: 150 },
};

export interface TraceSettings {
  kinds: ShapeKind[];
  /** Auto (max that fits): keep tracing until the Social Club budget is used up. */
  auto: boolean;
  count: number;
  /** Layer opacity, 0.2..1. */
  alpha: number;
  /** Working resolution: long side in pixels. */
  res: number;
  effort: Effort;
  background: boolean;
  replace: boolean;
  /** Stop when more shapes stop helping (the last 10 add almost nothing). */
  stopWhenDone: boolean;
}

/** Average gain per shape, as a fraction of the starting error, below which tracing stops. */
export const MIN_GAIN = 2e-5;

export interface TraceProgress {
  running: boolean;
  made: number;
  fraction: number;
  /** Shapes per second. */
  rate: number;
  scLayers: number;
  scBytes: number;
}

type StopReason = 'layers' | 'size' | 'count' | 'converged' | 'stopped' | 'error';

/** Runs Tracer A in a Blob-URL worker and appends each accepted shape as an editable layer. */
export class TraceController {
  /** The loaded picture, at most 1024 px on its long side. */
  image: HTMLCanvasElement | null = null;
  /** Fraction of the picture that is transparent. */
  transparentFraction = 0;
  running = false;
  onProgress: (p: TraceProgress) => void = () => undefined;
  onDone: (message: string) => void = () => undefined;
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private finish: ((why: StopReason) => void) | null = null;

  constructor(private readonly store: Store) {}

  async load(blob: Blob): Promise<void> {
    const source = await decode(blob);
    const iw = source.width;
    const ih = source.height;
    if (!iw || !ih) throw new Error('That picture has no size');
    const s = Math.min(1, 1024 / Math.max(iw, ih));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(iw * s));
    canvas.height = Math.max(1, Math.round(ih * s));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ('close' in source) source.close();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
    this.transparentFraction = clear / (data.length / 4);
    this.image = canvas;
  }

  /** Where the picture sits on the 512 canvas (fitted and centred). */
  imageRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.image) return null;
    const k = CANVAS / Math.max(this.image.width, this.image.height);
    const w = this.image.width * k;
    const h = this.image.height * k;
    return { x: (CANVAS - w) / 2, y: (CANVAS - h) / 2, w, h };
  }

  private existing(replace: boolean): { layers: number; bytes: number } {
    if (replace) return { layers: 0, bytes: 0 };
    const converted = toSocialClub(this.store.layers).layers;
    return { layers: converted.length, bytes: scBytes(converted) };
  }

  /** The guaranteed minimum number of shapes that fit, from the worst-case cost per shape. */
  budget(s: TraceSettings): Budget {
    const e = this.existing(s.replace);
    return shapeBudget({
      perShape: worstCost(s.kinds),
      backgroundLayers: s.background ? 1 : 0,
      backgroundBytes: s.background ? backgroundCost() : 0,
      existingLayers: e.layers,
      existingBytes: e.bytes,
    });
  }

  private sample(res: number): { T: Float32Array; Wt: Float32Array; W: number; H: number } {
    const image = this.image as HTMLCanvasElement;
    const s = res / Math.max(image.width, image.height);
    const W = Math.max(1, Math.round(image.width * s));
    const H = Math.max(1, Math.round(image.height * s));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const T = new Float32Array(W * H * 3);
    const Wt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      T[i * 3] = data[i * 4];
      T[i * 3 + 1] = data[i * 4 + 1];
      T[i * 3 + 2] = data[i * 4 + 2];
      Wt[i] = data[i * 4 + 3] / 255;
    }
    return { T, Wt, W, H };
  }

  private spawn(): Worker {
    if (!this.workerUrl) {
      this.workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    }
    return new Worker(this.workerUrl);
  }

  start(settings: TraceSettings): void {
    if (!this.image || this.running) return;
    const s: TraceSettings = { ...settings, kinds: settings.kinds.length ? settings.kinds : ['ellipse'] };
    const budget = this.budget(s);
    if (s.auto && budget.n < 1) {
      this.onDone('No room left: the current design already uses the whole Social Club budget.');
      return;
    }
    const { T, Wt, W, H } = this.sample(s.res);
    const map = traceMap(W, H);
    const worst = worstCost(s.kinds);
    const used = this.existing(s.replace);
    const target = s.auto ? budget.n : Math.min(1000, Math.max(10, Math.round(s.count)));

    this.store.checkpoint(); // one undo step removes the whole trace
    if (s.replace) {
      this.store.layers = [];
      this.store.select([]);
    }

    let made = 0;
    let pruned = 0;
    /** Where shapes placed under the trace go: just above the background layer, if any. */
    let bottom = this.store.layers.length;
    /** Traced shape index (1-based) -> layer id and its Social Club cost, for pruning. */
    const traced = new Map<number, { id: string; layers: number; bytes: number }>();
    const t0 = performance.now();
    const worker = this.spawn();
    this.worker = worker;
    this.running = true;

    const account = (layer: Layer): { layers: number; bytes: number } => {
      const converted = toSocialClub([layer]).layers;
      const cost = { layers: converted.length, bytes: scBytes(converted) };
      used.layers += cost.layers;
      used.bytes += cost.bytes;
      return cost;
    };
    const progress = (running: boolean): void => {
      const seconds = Math.max(0.001, (performance.now() - t0) / 1000);
      const fraction = s.auto
        ? Math.max(used.layers / CONTRACT.layersAuto, used.bytes / CONTRACT.saveAuto)
        : made / target;
      this.onProgress({
        running,
        made: made - pruned,
        fraction: Math.min(1, fraction),
        rate: made / seconds,
        scLayers: used.layers,
        scBytes: used.bytes,
      });
    };
    const finish = (why: StopReason): void => {
      if (this.worker !== worker) return;
      worker.terminate();
      this.worker = null;
      this.finish = null;
      this.running = false;
      this.store.touch();
      progress(false);
      const kept = made - pruned;
      const cost =
        `${used.layers} Social Club layers, about ${kb(used.bytes)}` +
        (pruned
          ? `; ${pruned} ${pruned === 1 ? 'shape that ended up fully covered was' : 'shapes that ended up fully covered were'} removed`
          : '');
      const messages: Record<StopReason, string> = {
        layers: `Stopped at the layer limit (${CONTRACT.layersAuto}): ${kept} shapes became ${cost}.`,
        size: `Stopped at the save-size budget: ${kept} shapes became ${cost}.`,
        count: `Traced ${kept} shapes (${cost}).`,
        converged: `Done after ${kept} shapes: more shapes would no longer visibly improve the match (${cost}).`,
        stopped: `Stopped by you after ${kept} shapes (${cost}).`,
        error: 'The tracer stopped with an error.',
      };
      this.onDone(messages[why]);
    };
    this.finish = finish;

    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      if (this.worker !== worker) return;
      const msg = ev.data;
      if (msg.type === 'bg') {
        if (s.background) {
          const layer = backgroundLayer(msg.color, W, H, map);
          this.store.layers.push(layer);
          bottom = this.store.layers.length;
          account(layer);
          this.store.touch();
        }
      } else if (msg.type === 'shape') {
        made++;
        const layer = shapeToLayer(msg.shape, map, s.alpha, 't' + made);
        if (msg.shape.under) this.store.layers.splice(bottom, 0, layer);
        else this.store.layers.push(layer);
        traced.set(made, { id: layer.id, ...account(layer) });
        // Earlier shapes this one completely covers change nothing any more: remove them and
        // give their layers and bytes back to the budget.
        if (msg.shape.hides?.length) {
          const gone = new Set<string>();
          for (const index of msg.shape.hides) {
            const t = traced.get(index);
            if (!t) continue;
            traced.delete(index);
            gone.add(t.id);
            used.layers -= t.layers;
            used.bytes -= t.bytes;
            pruned++;
          }
          if (gone.size) {
            this.store.layers = this.store.layers.filter((l) => !gone.has(l.id));
            for (const id of gone) this.store.sel.delete(id);
          }
        }
        this.store.touch();
        if (s.auto) {
          // Add each layer's real converted cost as it arrives and stop as soon as a
          // worst-case next shape would no longer fit.
          if (used.layers + worst.n > CONTRACT.layersAuto) return finish('layers');
          if (used.bytes + worst.b * 1.2 > CONTRACT.saveAuto) return finish('size');
        } else if (made - pruned >= target) {
          return finish('count');
        }
        progress(true);
      } else if (msg.type === 'done') {
        finish(msg.converged ? 'converged' : 'count');
      }
    };
    worker.onerror = () => finish('error');
    progress(true);
    worker.postMessage(
      {
        T,
        Wt,
        W,
        H,
        kinds: s.kinds,
        alpha: s.alpha,
        cand: EFFORT[s.effort].cand,
        mut: EFFORT[s.effort].mut,
        minGain: s.stopWhenDone ? MIN_GAIN : 0,
        seed: Math.floor(Math.random() * 4294967296),
        // Pruning can remove shapes, so the main thread decides when enough are kept.
        count: 4000,
      },
      [T.buffer, Wt.buffer],
    );
  }

  stop(): void {
    if (this.finish) this.finish('stopped');
  }

  /** The picture as a small PNG data URL (long side at most `max` px) for the trace script. */
  scriptImage(max = 220): string | null {
    if (!this.image) return null;
    const s = Math.min(1, max / Math.max(this.image.width, this.image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(this.image.width * s));
    canvas.height = Math.max(1, Math.round(this.image.height * s));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through: some formats (SVG) only decode through an <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
