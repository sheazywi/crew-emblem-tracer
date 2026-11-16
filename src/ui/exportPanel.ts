import { fromProjectJson, toProjectJson } from '../model/persistence';
import type { Store } from '../model/store';
import { CANVAS } from '../model/types';
import { download, exportPNG, exportSVG } from '../render/export';
import { renderToCanvas } from '../render/renderer';
import { buildImportScript } from '../scripts/build-scripts';
import { toSocialClub, type ConvertResult } from '../socialclub/convert';
import { CONTRACT } from '../socialclub/editor-contract';
import { drawPacked, pixelDiff } from '../socialclub/preview';
import { bindingText, kb, usage } from '../socialclub/size';
import { button, checkbox, clear, h } from './dom';
import { copyText, toast } from './toast';

/** Export tab: files, the Social Club budget and import script, and the exact preview. */
export function exportPanel(
  store: Store,
  isVisible: () => boolean,
): { root: HTMLElement; refresh: () => void } {
  // --- files --------------------------------------------------------------------------------
  const openInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden',
    'aria-label': 'Open a Crest Forge project file',
  });
  openInput.addEventListener('change', () => {
    const file = openInput.files?.[0];
    openInput.value = '';
    if (!file) return;
    file
      .text()
      .then((text) => {
        const layers = fromProjectJson(text);
        store.checkpoint();
        store.layers = layers;
        store.select([]);
        store.touch();
        toast(`Opened ${layers.length} layers. Undo brings the previous design back.`);
      })
      .catch(() => toast('That file is not a Crest Forge project.', 'error'));
  });
  const png = (size: number): HTMLButtonElement =>
    button(`PNG ${size}`, () => {
      exportPNG(store.layers, size).catch(() => toast('PNG export failed.', 'error'));
    });
  const dataFallback = h('div', { class: 'fallback-host' });

  // --- Social Club --------------------------------------------------------------------------
  const layerMeter = h('meter', { min: 0, max: 1, value: 0, 'aria-label': 'Layers used' });
  const sizeMeter = h('meter', { min: 0, max: 1, value: 0, 'aria-label': 'Save size used' });
  const layerText = h('span', { class: 'mono' });
  const sizeText = h('span', { class: 'mono' });
  const summary = h('p', { class: 'hint summary', 'aria-live': 'polite' });
  const warnings = h('ul', { class: 'warnings' });
  const round = checkbox('Round positions to whole pixels (fallback)', false, () => refresh());
  const scriptFallback = h('div', { class: 'fallback-host' });
  const preview = h('canvas', {
    class: 'preview',
    width: CANVAS,
    height: CANVAS,
    role: 'img',
    'aria-label': 'The design as Social Club will draw it',
  });
  const previewNote = h('p', { class: 'hint mono' });
  let latest: ConvertResult | null = null;
  let blocked = false;

  const copyImport = button(
    'Copy import script',
    () => {
      if (!latest || blocked) return;
      try {
        void copyText(buildImportScript(latest.layers), scriptFallback, 'Import script');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not build the script.', 'error');
      }
    },
    'primary',
  );

  function refresh(): void {
    const result = toSocialClub(store.layers, { roundPositions: round.input.checked });
    latest = result;
    const u = usage(result.layers);
    layerMeter.value = Math.min(1, u.layerFraction);
    sizeMeter.value = Math.min(1, u.byteFraction);
    layerText.textContent = `${u.layers} / ${CONTRACT.layersMax} layers`;
    sizeText.textContent = `${kb(u.bytes)} / ${kb(CONTRACT.saveMax)}`;
    blocked = u.overLayers || u.overBytes || u.layers === 0;
    copyImport.disabled = blocked;
    summary.textContent =
      u.layers === 0
        ? 'Nothing to import yet: the design has no visible layers.'
        : `${u.layers} layers, ${kb(u.bytes)}; room for about ${u.room} more simple shapes (${bindingText(u.roomBinding)}).`;

    clear(warnings);
    const warn = (text: string, cls = ''): void => {
      warnings.append(h('li', { class: cls, text }));
    };
    if (u.overLayers)
      warn(
        `Over the limit: ${u.layers} layers, the editor allows ${CONTRACT.layersMax}. Copying is blocked until the design is simpler.`,
        'over',
      );
    if (u.overBytes)
      warn(
        `Over the limit: about ${kb(u.bytes)}, the editor refuses to save above ${kb(CONTRACT.saveMax)}. Copying is blocked until the design is simpler.`,
        'over',
      );
    if (!u.overLayers && !u.overBytes && u.warn)
      warn(
        'Close to the limit: the estimate is above 95% of the save size or above the 740-layer safety margin. Saving may fail.',
      );
    for (const note of result.notes) warn(note);

    const ctx = preview.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, CANVAS, CANVAS);
      drawPacked(ctx, result.layers);
      const design = renderToCanvas(store.layers).getContext('2d')?.getImageData(0, 0, CANVAS, CANVAS).data;
      previewNote.textContent = design
        ? `Differs from your design in ${(pixelDiff(design, ctx.getImageData(0, 0, CANVAS, CANVAS).data) * 100).toFixed(2)}% of pixels.`
        : '';
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  store.on((change) => {
    if (change !== 'doc' || !isVisible()) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(refresh, 200);
  });

  const root = h(
    'div',
    { class: 'panel' },
    h('h2', { text: 'Files' }),
    h(
      'div',
      { class: 'btn-row' },
      png(512),
      png(1024),
      png(2048),
      button('SVG', () => exportSVG(store.layers)),
    ),
    h(
      'div',
      { class: 'btn-row' },
      button('Save project', () =>
        download(
          'crest.crestforge.json',
          new Blob([toProjectJson(store.layers)], { type: 'application/json' }),
        ),
      ),
      button('Open project…', () => openInput.click()),
      button(
        'Copy layer data',
        () => void copyText(JSON.stringify(store.layers), dataFallback, 'Layer data'),
      ),
      openInput,
    ),
    dataFallback,
    h('h2', { text: 'Social Club' }),
    h('div', { class: 'meter-row' }, layerMeter, layerText),
    h('div', { class: 'meter-row' }, sizeMeter, sizeText),
    summary,
    warnings,
    round.root,
    h('div', { class: 'btn-row' }, copyImport),
    scriptFallback,
    h(
      'ol',
      { class: 'steps' },
      h('li', { text: 'On Social Club, open your crew page and click Edit crew emblem.' }),
      h('li', {
        text: 'Press F12, open Console, paste, press Enter. Chrome asks first-time users to type "allow pasting".',
      }),
      h('li', {
        text: 'Check the emblem, then click Save. It goes to My Emblems; your crew emblem only changes if you publish it.',
      }),
    ),
    h('p', {
      class: 'hint',
      text: 'The script only adds layers in your own editor tab. It never saves, publishes, or touches your account. Only paste console code you trust; automating a website can conflict with its terms of service, so the choice is yours.',
    }),
    h('h2', { text: 'Preview: how Social Club will draw it' }),
    preview,
    previewNote,
  );
  return { root, refresh };
}
