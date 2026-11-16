import type { Store } from '../model/store';
import { CANVAS, type Layer } from '../model/types';
import { boxPoint, clamp, layerAABB, rad, rotate, toLocal, unionBounds, type Pt } from '../render/geometry';
import { fillRule, layerPath } from '../render/paths';
import { drawLayer } from '../render/renderer';

/** The zoomable 512 x 512 stage: rendering, hit testing, handles, marquee, snapping, pan and zoom. */

const HANDLES: readonly Pt[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];
const ROTATE_HANDLE = 8;
const SELECT = '#3fd8f0';
const GUIDE = '#ff4fa3';
/** The rotate handle sits this many screen px above the top edge. */
const ROTATE_OFFSET = 26;
/** Centre snapping distance, screen px. */
const SNAP_PX = 6;
/** Hit-test tolerance, screen px. */
const HIT_PX = 4;
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 40;

interface Moving {
  layer: Layer;
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; from: Pt; panX: number; panY: number }
  | { kind: 'move'; start: Pt; down: Pt; items: Moving[]; centre: Pt; moved: boolean }
  | {
      kind: 'resize';
      layer: Layer;
      hx: number;
      hy: number;
      anchor: Pt;
      w0: number;
      h0: number;
      moved: boolean;
    }
  | { kind: 'rotate'; layer: Layer; moved: boolean }
  | { kind: 'marquee'; start: Pt; cur: Pt; base: Set<string> };

export interface Reference {
  image: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Editor {
  readonly ctx: CanvasRenderingContext2D;
  /** screen = pan + canvas * zoom */
  view = { zoom: 1, panX: 0, panY: 0 };
  /** Reference overlay for checking a trace or tracing by hand. */
  reference: Reference | null = null;
  referenceVisible = false;
  referenceOpacity = 0.5;
  /** True while Space is held: dragging pans. */
  spaceDown = false;
  onDropFile: (file: File) => void = () => undefined;

  private cw = 0;
  private ch = 0;
  private fitted = false;
  private queued = false;
  private drag: Drag | null = null;
  private guideV = false;
  private guideH = false;
  private readonly hit: CanvasRenderingContext2D;
  private checker: CanvasPattern | string | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly store: Store,
  ) {
    const ctx = canvas.getContext('2d');
    const hitCanvas = document.createElement('canvas');
    hitCanvas.width = hitCanvas.height = 1;
    const hit = hitCanvas.getContext('2d');
    if (!ctx || !hit) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
    this.hit = hit;

    store.on(() => this.invalidate());
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : 1;
        this.zoomAt(this.screenOf(e), Math.exp(-e.deltaY * unit * 0.0015));
      },
      { passive: false },
    );
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) this.onDropFile(file);
    });
    this.resize();
  }

  // --- view ---------------------------------------------------------------------------------

  invalidate(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.cw = rect.width;
    this.ch = rect.height;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.fitted) this.fit();
    else this.invalidate();
  }

  /** Fit the whole canvas in view. */
  fit(): void {
    if (this.cw < 2 || this.ch < 2) return;
    const zoom = clamp((Math.min(this.cw, this.ch) * 0.92) / CANVAS, ZOOM_MIN, ZOOM_MAX);
    this.view = { zoom, panX: (this.cw - CANVAS * zoom) / 2, panY: (this.ch - CANVAS * zoom) / 2 };
    this.fitted = true;
    this.store.emit('view');
  }

  /** Zoom about a screen point, 5% to 4000%. */
  zoomAt(s: Pt, factor: number): void {
    const before = this.toWorld(s);
    const zoom = clamp(this.view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.view = { zoom, panX: s[0] - before[0] * zoom, panY: s[1] - before[1] * zoom };
    this.store.emit('view');
  }

  zoomBy(factor: number): void {
    this.zoomAt([this.cw / 2, this.ch / 2], factor);
  }

  private screenOf(e: MouseEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  toWorld(s: Pt): Pt {
    return [(s[0] - this.view.panX) / this.view.zoom, (s[1] - this.view.panY) / this.view.zoom];
  }

  toScreen(w: Pt): Pt {
    return [w[0] * this.view.zoom + this.view.panX, w[1] * this.view.zoom + this.view.panY];
  }

  // --- hit testing --------------------------------------------------------------------------

  /** Topmost visible, unlocked layer under a canvas point; tests in local space. */
  hitLayer(wx: number, wy: number): Layer | null {
    const zoom = this.view.zoom;
    const tol = HIT_PX / zoom;
    const layers = this.store.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      const [lx, ly] = toLocal(l, wx, wy);
      if (Math.abs(lx) > l.w / 2 + tol || Math.abs(ly) > l.h / 2 + tol) continue;
      // Tiny shapes (and text) are hit by their bounding box.
      if (l.type === 'text' || l.w * zoom < 10 || l.h * zoom < 10) return l;
      const path = layerPath(l);
      if (this.hit.isPointInPath(path, lx, ly, fillRule(l))) return l;
      this.hit.lineWidth = tol * 2;
      if (this.hit.isPointInStroke(path, lx, ly)) return l;
    }
    return null;
  }

  private single(): Layer | null {
    if (this.store.sel.size !== 1) return null;
    const l = this.store.selected()[0];
    return l && !l.locked && l.visible ? l : null;
  }

  private handlePoints(l: Layer): { pts: Pt[]; rotate: Pt } {
    const pts = HANDLES.map(([hx, hy]) => this.toScreen(boxPoint(l, hx, hy)));
    const up = rotate(0, -1, rad(l.rot));
    return { pts, rotate: [pts[1][0] + up[0] * ROTATE_OFFSET, pts[1][1] + up[1] * ROTATE_OFFSET] };
  }

  /** Index of the handle at a screen point: 0..7 resize, 8 rotate, -1 none. */
  private handleAt(l: Layer, s: Pt): number {
    const hp = this.handlePoints(l);
    if (Math.hypot(s[0] - hp.rotate[0], s[1] - hp.rotate[1]) <= 9) return ROTATE_HANDLE;
    for (let i = 0; i < hp.pts.length; i++) {
      if (Math.abs(s[0] - hp.pts[i][0]) <= 7 && Math.abs(s[1] - hp.pts[i][1]) <= 7) return i;
    }
    return -1;
  }

  // --- pointer ------------------------------------------------------------------------------

  private down(e: PointerEvent): void {
    const s = this.screenOf(e);
    const w = this.toWorld(s);
    const store = this.store;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== this.canvas) {
      document.activeElement.blur();
    }
    this.canvas.focus({ preventScroll: true });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.drag = { kind: 'pan', from: s, panX: this.view.panX, panY: this.view.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const one = this.single();
    if (one) {
      const handle = this.handleAt(one, s);
      if (handle === ROTATE_HANDLE) {
        this.drag = { kind: 'rotate', layer: one, moved: false };
        return;
      }
      if (handle >= 0) {
        const [hx, hy] = HANDLES[handle];
        // Resize keeps the opposite edge or corner fixed.
        this.drag = {
          kind: 'resize',
          layer: one,
          hx,
          hy,
          anchor: boxPoint(one, -hx, -hy),
          w0: one.w,
          h0: one.h,
          moved: false,
        };
        return;
      }
    }

    const hit = this.hitLayer(w[0], w[1]);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!hit) {
      this.drag = { kind: 'marquee', start: w, cur: w, base: additive ? new Set(store.sel) : new Set() };
      if (!additive && store.sel.size) store.select([]);
      return;
    }
    if (additive) {
      const next = new Set(store.sel);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.add(hit.id);
      store.select(next);
      if (!next.has(hit.id)) return;
    } else if (!store.sel.has(hit.id)) {
      store.select([hit.id]);
    }
    const items = store
      .selected()
      .filter((l) => !l.locked)
      .map((layer) => ({ layer, x: layer.x, y: layer.y }));
    if (!items.length) return;
    const b = unionBounds(items.map((m) => m.layer));
    const centre: Pt = items.length === 1 ? [items[0].x, items[0].y] : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    this.drag = { kind: 'move', start: w, down: s, items, centre, moved: false };
  }

  private move(e: PointerEvent): void {
    const s = this.screenOf(e);
    const d = this.drag;
    if (!d) {
      this.hover(s);
      return;
    }
    const w = this.toWorld(s);
    const store = this.store;
    switch (d.kind) {
      case 'pan':
        this.view = {
          zoom: this.view.zoom,
          panX: d.panX + s[0] - d.from[0],
          panY: d.panY + s[1] - d.from[1],
        };
        store.emit('view');
        break;
      case 'move': {
        if (!d.moved) {
          if (Math.hypot(s[0] - d.down[0], s[1] - d.down[1]) < 3) return;
          d.moved = true;
          store.checkpoint();
        }
        let dx = w[0] - d.start[0];
        let dy = w[1] - d.start[1];
        // Snap the selection's centre to the canvas mid-lines.
        const tol = SNAP_PX / this.view.zoom;
        const mid = CANVAS / 2;
        this.guideV = Math.abs(d.centre[0] + dx - mid) < tol;
        this.guideH = Math.abs(d.centre[1] + dy - mid) < tol;
        if (this.guideV) dx = mid - d.centre[0];
        if (this.guideH) dy = mid - d.centre[1];
        for (const m of d.items) {
          m.layer.x = m.x + dx;
          m.layer.y = m.y + dy;
        }
        store.touch();
        break;
      }
      case 'resize': {
        if (!d.moved) {
          d.moved = true;
          store.checkpoint();
        }
        const l = d.layer;
        const [lx, ly] = rotate(w[0] - d.anchor[0], w[1] - d.anchor[1], -rad(l.rot));
        let nw = d.hx !== 0 ? Math.max(1, d.hx * lx) : d.w0;
        let nh = d.hy !== 0 ? Math.max(1, d.hy * ly) : d.h0;
        if (e.shiftKey && d.hx !== 0 && d.hy !== 0) {
          const k = Math.max(nw / d.w0, nh / d.h0); // Shift keeps proportions on corners
          nw = d.w0 * k;
          nh = d.h0 * k;
        }
        const [ox, oy] = rotate((d.hx * nw) / 2, (d.hy * nh) / 2, rad(l.rot));
        l.w = nw;
        l.h = nh;
        l.x = d.anchor[0] + ox;
        l.y = d.anchor[1] + oy;
        store.touch();
        break;
      }
      case 'rotate': {
        if (!d.moved) {
          d.moved = true;
          store.checkpoint();
        }
        const l = d.layer;
        let a = (Math.atan2(w[1] - l.y, w[0] - l.x) * 180) / Math.PI + 90;
        if (e.shiftKey) a = Math.round(a / 15) * 15; // Shift snaps rotation to 15 degrees
        l.rot = Math.round((((a % 360) + 360) % 360) * 100) / 100;
        store.touch();
        break;
      }
      case 'marquee':
        d.cur = w;
        this.invalidate();
        break;
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.guideV = this.guideH = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    if (d && d.kind === 'marquee') {
      const x0 = Math.min(d.start[0], d.cur[0]);
      const x1 = Math.max(d.start[0], d.cur[0]);
      const y0 = Math.min(d.start[1], d.cur[1]);
      const y1 = Math.max(d.start[1], d.cur[1]);
      if ((x1 - x0) * this.view.zoom > 3 || (y1 - y0) * this.view.zoom > 3) {
        // Marquee selects layers whose centre is inside.
        const ids = new Set(d.base);
        for (const l of this.store.layers) {
          if (l.visible && !l.locked && l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1) ids.add(l.id);
        }
        this.store.select(ids);
      }
    }
    this.hover(this.screenOf(e));
    this.invalidate();
  }

  private hover(s: Pt): void {
    let cursor = 'default';
    if (this.spaceDown) {
      cursor = 'grab';
    } else {
      const one = this.single();
      const handle = one ? this.handleAt(one, s) : -1;
      if (handle === ROTATE_HANDLE) cursor = 'alias';
      else if (handle >= 0) cursor = 'crosshair';
      else {
        const w = this.toWorld(s);
        if (this.hitLayer(w[0], w[1])) cursor = 'move';
      }
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // --- rendering ----------------------------------------------------------------------------

  private checkerFill(): CanvasPattern | string {
    if (this.checker) return this.checker;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const t = tile.getContext('2d');
    if (t) {
      t.fillStyle = '#1c2229';
      t.fillRect(0, 0, 32, 32);
      t.fillStyle = '#232a33';
      t.fillRect(0, 0, 16, 16);
      t.fillRect(16, 16, 16, 16);
    }
    this.checker = this.ctx.createPattern(tile, 'repeat') ?? '#1c2229';
    return this.checker;
  }

  private render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const { zoom, panX, panY } = this.view;
    const layers = this.store.layers;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Shapes outside the canvas show as a faint ghost...
    for (const l of layers) {
      if (!l.visible) continue;
      const b = layerAABB(l);
      if (b.x0 < 0 || b.y0 < 0 || b.x1 > CANVAS || b.y1 > CANVAS) drawLayer(ctx, l, 0.16);
    }
    // ...and the canvas itself clips.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS, CANVAS);
    ctx.clip();
    ctx.fillStyle = this.checkerFill();
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    for (const l of layers) drawLayer(ctx, l);
    if (this.reference && this.referenceVisible) {
      const r = this.reference;
      ctx.globalAlpha = this.referenceOpacity;
      ctx.drawImage(r.image, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(0, 0, CANVAS, CANVAS);
    if (this.guideV || this.guideH) {
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      if (this.guideV) {
        ctx.moveTo(CANVAS / 2, -40);
        ctx.lineTo(CANVAS / 2, CANVAS + 40);
      }
      if (this.guideH) {
        ctx.moveTo(-40, CANVAS / 2);
        ctx.lineTo(CANVAS + 40, CANVAS / 2);
      }
      ctx.stroke();
    }
    ctx.restore();
    this.drawOverlay(ctx);
  }

  /** Selection boxes, handles and the marquee, drawn in screen space so they stay crisp. */
  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const sel = this.store.selected();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = SELECT;
    for (const l of sel) {
      ctx.beginPath();
      for (let i = 0; i < 8; i += 2) {
        const [x, y] = this.toScreen(boxPoint(l, HANDLES[i][0], HANDLES[i][1]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    const one = this.single();
    if (one) {
      const hp = this.handlePoints(one);
      ctx.beginPath();
      ctx.moveTo(hp.pts[1][0], hp.pts[1][1]);
      ctx.lineTo(hp.rotate[0], hp.rotate[1]);
      ctx.stroke();
      ctx.fillStyle = '#0d1014';
      ctx.beginPath();
      ctx.arc(hp.rotate[0], hp.rotate[1], 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const [x, y] of hp.pts) {
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
    }
    const d = this.drag;
    if (d && d.kind === 'marquee') {
      const a = this.toScreen(d.start);
      const b = this.toScreen(d.cur);
      ctx.fillStyle = 'rgba(63,216,240,0.12)';
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.setLineDash([]);
    }
  }
}
