import type { Editor } from '../editor/editor';
import type { Store } from '../model/store';
import { buildTraceScript } from '../scripts/build-scripts';
import { CONTRACT, FAMILIES } from '../socialclub/editor-contract';
import { bindingText, kb } from '../socialclub/size';
import {
  EFFORT,
  type Effort,
  MIN_GAIN,
  type TraceController,
  type TraceProgress,
  type TraceSettings,
} from '../trace/controller';
import type { ShapeKind } from '../trace/core';
import { button, checkbox, field, h } from './dom';
import { copyText, toast } from './toast';

/** Trace image tab: Tracer A settings and progress, the reference overlay and the Tracer B script. */
export function tracePanel(
  store: Store,
  editor: Editor,
  tracer: TraceController,
): { root: HTMLElement; loadFile: (file: Blob) => void } {
  // --- picture ------------------------------------------------------------------------------
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    'aria-label': 'Choose a picture to trace',
  });
  const thumb = h('canvas', { class: 'thumb', width: 96, height: 96, 'aria-hidden': 'true' });
  const pictureInfo = h('p', {
    class: 'hint',
    text: 'Choose a picture, drop one on the canvas, or paste it (Ctrl V). It never leaves this device.',
  });
  const choose = button('Choose picture…', () => fileInput.click(), 'primary');

  // --- Tracer A settings --------------------------------------------------------------------
  const kinds: Record<ShapeKind, boolean> = { ellipse: true, circle: true, rect: true, triangle: true };
  const kindBoxes = (
    [
      ['ellipse', 'Ellipses'],
      ['circle', 'Circles'],
      ['rect', 'Rectangles'],
      ['triangle', 'Triangles'],
    ] as [ShapeKind, string][]
  ).map(([k, label]) =>
    checkbox(label, true, (v) => {
      kinds[k] = v;
      refreshBudget();
    }),
  );

  const count = h('input', {
    type: 'number',
    class: 'mono',
    min: 10,
    max: 1000,
    step: 10,
    value: '300',
    disabled: true,
  });
  const auto = checkbox('Auto (max that fits)', true, (v) => {
    count.disabled = v;
    refreshBudget();
  });
  const budgetLine = h('p', { class: 'hint budget', 'aria-live': 'polite' });
  count.addEventListener('input', () => refreshBudget());

  const opacity = h('input', { type: 'range', min: 20, max: 100, step: 5, value: '100' });
  const opacityOut = h('output', { class: 'mono', text: '100%' });
  opacity.addEventListener('input', () => (opacityOut.textContent = opacity.value + '%'));

  const detail = h(
    'select',
    null,
    ...[96, 128, 192, 256].map((r) =>
      h('option', { value: String(r), text: `${r} px`, selected: r === 128 }),
    ),
  );
  const effort = h(
    'select',
    null,
    h('option', { value: 'fast', text: 'Fast' }),
    h('option', { value: 'balanced', text: 'Balanced', selected: true }),
    h('option', { value: 'best', text: 'Best' }),
  );
  const background = checkbox('Background layer', true, () => refreshBudget());
  const replace = checkbox('Replace design', true, () => refreshBudget());
  const stopWhenDone = checkbox('Stop when more shapes stop helping', true, () => refreshBudget());

  const start = button('Trace picture', () => run(), 'primary');
  const stop = button('Stop', () => tracer.stop(), 'danger');
  const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Trace progress' });
  const status = h('p', { class: 'hint mono status', 'aria-live': 'polite', text: 'No picture loaded.' });
  start.disabled = true;
  stop.disabled = true;

  const settings = (): TraceSettings => ({
    kinds: (Object.keys(kinds) as ShapeKind[]).filter((k) => kinds[k]),
    auto: auto.input.checked,
    count: parseInt(count.value, 10) || 300,
    alpha: parseInt(opacity.value, 10) / 100,
    res: parseInt(detail.value, 10),
    effort: effort.value as Effort,
    background: background.input.checked,
    replace: replace.input.checked,
    stopWhenDone: stopWhenDone.input.checked,
  });

  function refreshBudget(): void {
    const s = settings();
    if (!s.kinds.length) {
      budgetLine.textContent = 'Pick at least one shape type.';
      return;
    }
    const b = tracer.budget(s);
    const cap = `Up to ${b.n} shapes fit, ${bindingText(b.binding)}`;
    if (s.auto) {
      budgetLine.textContent = s.stopWhenDone
        ? `${cap}. That is the guaranteed minimum; tracing can use more while the real cost fits, and stops sooner when more shapes stop helping.`
        : `${cap}. That is the guaranteed minimum: tracing continues while the real converted cost still fits.`;
    } else if (s.count > b.n) {
      budgetLine.textContent = `${cap}. ${s.count} shapes will be too many to import into Social Club; PNG and SVG export still work.`;
    } else {
      budgetLine.textContent = `${cap}.`;
    }
  }

  function setRunning(running: boolean): void {
    start.disabled = running || !tracer.image;
    stop.disabled = !running;
    choose.disabled = running;
  }

  let pending: TraceProgress | null = null;
  tracer.onProgress = (p) => {
    const first = pending === null;
    pending = p;
    if (!first) return;
    requestAnimationFrame(() => {
      const q = pending;
      pending = null;
      if (!q) return;
      bar.value = q.fraction;
      if (q.running) {
        status.textContent = `${q.made} shapes · ${Math.round(q.rate)}/s · ${q.scLayers} Social Club layers · ${kb(q.scBytes)}`;
      }
    });
  };
  tracer.onDone = (message) => {
    setRunning(false);
    status.textContent = message;
    toast(message);
    refreshBudget();
  };

  function run(): void {
    const s = settings();
    if (!tracer.image) return;
    if (!s.kinds.length) {
      toast('Pick at least one shape type.', 'error');
      return;
    }
    setRunning(true);
    bar.value = 0;
    status.textContent = 'Starting…';
    tracer.start(s);
    if (!tracer.running) setRunning(false);
  }

  // --- reference overlay --------------------------------------------------------------------
  const refOpacity = h('input', { type: 'range', min: 5, max: 100, step: 5, value: '50' });
  const refToggle = checkbox('Show the picture over the canvas', false, (v) => {
    editor.referenceVisible = v;
    editor.invalidate();
  });
  refOpacity.addEventListener('input', () => {
    editor.referenceOpacity = parseInt(refOpacity.value, 10) / 100;
    editor.invalidate();
  });

  function loadFile(file: Blob): void {
    if (tracer.running) return;
    tracer
      .load(file)
      .then(() => {
        const image = tracer.image;
        const rect = tracer.imageRect();
        if (!image || !rect) return;
        editor.reference = { image, ...rect };
        editor.invalidate();
        const t = thumb.getContext('2d');
        if (t) {
          const k = Math.min(96 / image.width, 96 / image.height);
          t.clearRect(0, 0, 96, 96);
          t.drawImage(
            image,
            (96 - image.width * k) / 2,
            (96 - image.height * k) / 2,
            image.width * k,
            image.height * k,
          );
        }
        // The background layer defaults on only when under 5% of the picture is transparent.
        background.input.checked = tracer.transparentFraction < 0.05;
        pictureInfo.textContent = `Picture loaded: ${image.width} × ${image.height} px, ${Math.round(tracer.transparentFraction * 100)}% transparent.`;
        status.textContent = 'Ready to trace.';
        setRunning(false);
        copyTrace.disabled = false;
        refreshBudget();
      })
      .catch(() => toast('That file could not be read as a picture.', 'error'));
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadFile(file);
    fileInput.value = '';
  });

  // --- Tracer B: Rockstar's own shapes, inside their page ------------------------------------
  const famBasic = checkbox('Basic', true, () => undefined);
  const famCurves = checkbox('Curves and angles', true, () => undefined);
  const famAll = checkbox('Every shape', false, (v) => {
    famBasic.input.disabled = v;
    famCurves.input.disabled = v;
  });
  const scCount = h('input', {
    type: 'number',
    class: 'mono',
    min: 1,
    max: CONTRACT.layersAuto,
    step: 10,
    value: '300',
    disabled: true,
  });
  const scAuto = checkbox('Auto (max that fits)', true, (v) => (scCount.disabled = v));
  const fallback = h('div', { class: 'fallback-host' });
  const copyTrace = button(
    'Copy Social Club trace script',
    () => {
      const image = tracer.scriptImage(220);
      if (!image) {
        toast('Load a picture first.', 'error');
        return;
      }
      let groups: string[] | 'all' = 'all';
      if (!famAll.input.checked) {
        groups = [
          ...(famBasic.input.checked ? FAMILIES.basic : []),
          ...(famCurves.input.checked ? FAMILIES.curves : []),
        ];
        if (!groups.length) {
          toast('Tick at least one shape family.', 'error');
          return;
        }
      }
      const s = settings();
      try {
        const script = buildTraceScript(image, {
          groups,
          auto: scAuto.input.checked,
          count: parseInt(scCount.value, 10) || CONTRACT.layersAuto,
          alpha: s.alpha,
          res: s.res,
          cand: EFFORT[s.effort].cand,
          mut: EFFORT[s.effort].mut,
          bg: s.background,
          minGain: s.stopWhenDone ? MIN_GAIN : 0,
          dry: false,
          quiet: false,
        });
        void copyText(script, fallback, 'Trace script');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not build the script.', 'error');
      }
    },
    'primary',
  );
  copyTrace.disabled = true;

  store.on((change) => {
    if (change === 'doc' && !replace.input.checked && !tracer.running) scheduleBudget();
  });
  let budgetTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBudget(): void {
    if (budgetTimer !== null) clearTimeout(budgetTimer);
    budgetTimer = setTimeout(refreshBudget, 300);
  }

  const root = h(
    'div',
    { class: 'panel' },
    h('h2', { text: 'Picture' }),
    h('div', { class: 'picture' }, thumb, h('div', null, choose, fileInput, pictureInfo)),
    h('h2', { text: 'Trace with Crest Forge shapes' }),
    h(
      'fieldset',
      null,
      h('legend', { text: 'Shape types' }),
      h('div', { class: 'checks' }, ...kindBoxes.map((k) => k.root)),
    ),
    h(
      'div',
      { class: 'grid2' },
      field('Number of shapes', count),
      h('div', { class: 'field' }, h('span', { class: 'label-gap' }), auto.root),
    ),
    budgetLine,
    field('Opacity', h('div', { class: 'range' }, opacity, opacityOut)),
    h('div', { class: 'grid2' }, field('Detail', detail), field('Effort', effort)),
    h('div', { class: 'checks' }, background.root, replace.root, stopWhenDone.root),
    h('p', {
      class: 'hint',
      text: 'A flat area such as a sun becomes one shape. With this on, tracing also ends once new shapes would only touch up edge pixels, so simple pictures use far fewer layers. Turn it off to always use the full count.',
    }),
    h('div', { class: 'btn-row' }, start, stop),
    bar,
    status,
    h('h2', { text: 'Reference overlay' }),
    refToggle.root,
    field('Overlay opacity', refOpacity),
    h('h2', { text: "Trace with Rockstar's shapes" }),
    h('p', {
      class: 'hint',
      text: "Higher quality: a single curve or angle piece can match a whole contour. The script runs in your own signed-in editor tab and traces there with the editor's shape library, so those shapes never leave Rockstar's page.",
    }),
    h(
      'fieldset',
      null,
      h('legend', { text: 'Shape families' }),
      h('div', { class: 'checks' }, famBasic.root, famCurves.root, famAll.root),
    ),
    h(
      'div',
      { class: 'grid2' },
      field('Number of shapes', scCount),
      h('div', { class: 'field' }, h('span', { class: 'label-gap' }), scAuto.root),
    ),
    h('p', {
      class: 'hint',
      text: `With Auto, the script works out the largest count from the real shape sizes once it is in the editor (at most ${CONTRACT.layersAuto} layers). Opacity, detail, effort and background come from the settings above.`,
    }),
    h('div', { class: 'btn-row' }, copyTrace),
    fallback,
  );
  refreshBudget();
  return { root, loadFile };
}
