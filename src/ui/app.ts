import { Editor } from '../editor/editor';
import { bindKeyboard } from '../editor/keyboard';
import { addShape } from '../editor/ops';
import { allTypesFixture, exampleCrest } from '../model/example';
import { loadLocal } from '../model/persistence';
import { PRESETS } from '../model/presets';
import { Store } from '../model/store';
import { CANVAS, makeLayer, TYPE_LABEL, type Layer, type LayerType } from '../model/types';
import { drawLayer, renderToCanvas } from '../render/renderer';
import { onTextInvalidated, watchFonts } from '../render/text';
import { buildImportScript, buildTraceScript, SCRIPT_VERSION } from '../scripts/build-scripts';
import { toSocialClub } from '../socialclub/convert';
import { goldenDiff, pixelDiff, renderPacked } from '../socialclub/preview';
import { scBytes, usage } from '../socialclub/size';
import { TraceController } from '../trace/controller';
import { designPanel } from './designPanel';
import { button, h } from './dom';
import { exportPanel } from './exportPanel';
import { toast } from './toast';
import { tracePanel } from './tracePanel';

const RAIL: { kind: string; label: string }[] = [
  ...(['rect', 'round', 'ellipse', 'triangle', 'rtri', 'star', 'poly', 'ring', 'text'] as LayerType[]).map(
    (t) => ({
      kind: t,
      label: TYPE_LABEL[t],
    }),
  ),
  ...Object.entries(PRESETS).map(([key, p]) => ({ kind: 'preset:' + key, label: p.label })),
];

/** Draw a tool's shape into its rail button. */
function drawIcon(canvas: HTMLCanvasElement, kind: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let layer: Layer;
  if (kind.startsWith('preset:')) {
    const p = PRESETS[kind.slice(7)];
    const k = 380 / Math.max(p.w, p.h);
    layer = makeLayer('path', { pts: p.pts, w: p.w * k, h: p.h * k });
  } else {
    layer = makeLayer(kind as LayerType);
    const k = 380 / Math.max(layer.w, layer.h);
    layer.w *= k;
    layer.h *= k;
    if (kind === 'text') layer.text = 'Aa';
  }
  layer.color = '#d7dde4';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / CANVAS, canvas.height / CANVAS);
  drawLayer(ctx, layer);
}

export function mountApp(root: HTMLElement): void {
  const store = new Store();
  store.layers = loadLocal() ?? exampleCrest();

  const stage = h('canvas', {
    class: 'stage-canvas',
    tabIndex: 0,
    'aria-label': 'Emblem canvas, 512 by 512 pixels. Arrow keys move the selection.',
  });
  const editor = new Editor(stage, store);
  const tracer = new TraceController(store);

  // --- header -------------------------------------------------------------------------------
  const undo = button('Undo', () => store.undo(), '', 'Ctrl Z');
  const redo = button('Redo', () => store.redo(), '', 'Ctrl Shift Z');
  const zoom = h('output', { class: 'mono zoom', 'aria-label': 'Zoom' });
  const header = h(
    'header',
    { class: 'top' },
    h(
      'div',
      { class: 'brand' },
      h('h1', { text: 'Crest Forge' }),
      h('span', { class: 'tag', text: 'emblem editor' }),
    ),
    h(
      'div',
      { class: 'btn-row tools' },
      undo,
      redo,
      button(
        'New',
        () => {
          if (!store.layers.length) return;
          store.checkpoint();
          store.layers = [];
          store.select([]);
          store.touch();
          toast('Blank canvas. Undo brings the design back.');
        },
        '',
        'Start from a blank canvas',
      ),
      button('−', () => editor.zoomBy(1 / 1.25), 'square', 'Zoom out'),
      zoom,
      button('+', () => editor.zoomBy(1.25), 'square', 'Zoom in'),
      button('Fit', () => editor.fit(), '', 'F'),
    ),
  );

  // --- tool rail ----------------------------------------------------------------------------
  const icons: [HTMLCanvasElement, string][] = [];
  const rail = h(
    'nav',
    { class: 'rail', 'aria-label': 'Add shapes' },
    ...RAIL.map(({ kind, label }) => {
      const icon = h('canvas', { width: 56, height: 56, 'aria-hidden': 'true' });
      icons.push([icon, kind]);
      const b = h(
        'button',
        {
          type: 'button',
          class: 'tool',
          title: 'Add ' + label.toLowerCase(),
          'aria-label': 'Add ' + label.toLowerCase(),
        },
        icon,
        h('span', { text: label }),
      );
      b.addEventListener('click', () => {
        addShape(store, kind);
        showTab('design');
      });
      return b;
    }),
  );
  const paintIcons = (): void => icons.forEach(([c, k]) => drawIcon(c, k));
  paintIcons();

  // --- inspector with three tabs -------------------------------------------------------------
  const tabs = ['design', 'trace', 'export'] as const;
  type Tab = (typeof tabs)[number];
  const tabLabel: Record<Tab, string> = { design: 'Design', trace: 'Trace image', export: 'Export' };
  let current: Tab = 'design';
  const trace = tracePanel(store, editor, tracer);
  const exporter = exportPanel(store, () => current === 'export');
  const panels: Record<Tab, HTMLElement> = {
    design: designPanel(store, () => tracer.running),
    trace: trace.root,
    export: exporter.root,
  };
  const tabButtons = {} as Record<Tab, HTMLButtonElement>;
  const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Inspector' });
  for (const t of tabs) {
    const b = h('button', {
      type: 'button',
      role: 'tab',
      id: 'tab-' + t,
      'aria-controls': 'panel-' + t,
      text: tabLabel[t],
    });
    b.addEventListener('click', () => showTab(t));
    tabButtons[t] = b;
    tabList.append(b);
    panels[t].id = 'panel-' + t;
    panels[t].setAttribute('role', 'tabpanel');
    panels[t].setAttribute('aria-labelledby', 'tab-' + t);
  }
  function showTab(t: Tab): void {
    current = t;
    for (const k of tabs) {
      tabButtons[k].setAttribute('aria-selected', k === t ? 'true' : 'false');
      panels[k].hidden = k !== t;
    }
    if (t === 'export') exporter.refresh();
  }
  const inspector = h(
    'aside',
    { class: 'inspector', 'aria-label': 'Inspector' },
    tabList,
    panels.design,
    panels.trace,
    panels.export,
    h('p', {
      class: 'legal',
      text: 'Works with the Rockstar Games Social Club crew emblem editor. Not affiliated with or endorsed by Rockstar Games. Everything runs in your browser; nothing is uploaded.',
    }),
  );

  root.append(header, rail, h('main', { class: 'stage' }, stage), inspector);
  showTab('design');

  // --- wiring -------------------------------------------------------------------------------
  const loadPicture = (file: Blob): void => {
    showTab('trace');
    trace.loadFile(file);
  };
  editor.onDropFile = (file) => {
    if (file.type.startsWith('image/')) loadPicture(file);
    else toast('Drop a picture to trace it. Open project files from the Export tab.', 'error');
  };
  bindKeyboard(store, editor, loadPicture);

  const refreshHeader = (): void => {
    undo.disabled = !store.history.canUndo;
    redo.disabled = !store.history.canRedo;
    zoom.textContent = Math.round(editor.view.zoom * 100) + '%';
  };
  store.on(refreshHeader);
  refreshHeader();

  // Web fonts change text metrics: repaint and re-convert when they finish loading.
  onTextInvalidated(() => {
    paintIcons();
    store.emit('doc');
  });
  watchFonts();

  // A small console/test hook. It exposes nothing that is not already on screen.
  window.crestForge = {
    version: SCRIPT_VERSION,
    store,
    editor,
    tracer,
    loadPicture,
    toSocialClub,
    usage,
    scBytes,
    buildImportScript,
    buildTraceScript,
    goldenDiff,
    pixelDiff,
    renderToCanvas,
    renderPacked,
    fixtures: { example: exampleCrest, allTypes: allTypesFixture },
  };
}

declare global {
  interface Window {
    crestForge?: {
      version: string;
      store: Store;
      editor: Editor;
      tracer: TraceController;
      loadPicture: (file: Blob) => void;
      toSocialClub: typeof toSocialClub;
      usage: typeof usage;
      scBytes: typeof scBytes;
      buildImportScript: typeof buildImportScript;
      buildTraceScript: typeof buildTraceScript;
      goldenDiff: typeof goldenDiff;
      pixelDiff: typeof pixelDiff;
      renderToCanvas: typeof renderToCanvas;
      renderPacked: typeof renderPacked;
      fixtures: { example: () => Layer[]; allTypes: () => Layer[] };
    };
  }
}
