import {
  centreSelected,
  duplicateSelected,
  flipSelected,
  recolorSelected,
  removeSelected,
  reorder,
  scaleSelected,
} from '../editor/ops';
import type { Store } from '../model/store';
import type { Layer } from '../model/types';
import { FONTS } from '../render/text';
import { button, clear, field, h } from './dom';

/** Design tab: the selection inspector, a swatch row and the layers panel. */

interface Sync {
  el: HTMLElement;
  run: () => void;
}

const HEX = /^#[0-9a-f]{6}$/i;
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

export function designPanel(store: Store, isBusy: () => boolean): HTMLElement {
  const props = h('div', { class: 'props' });
  const swatches = h('div', {
    class: 'swatches',
    role: 'group',
    'aria-label': 'Colours already in the design',
  });
  const count = h('span', { class: 'count mono' });
  const list = h('ul', {
    class: 'layers',
    role: 'listbox',
    'aria-multiselectable': 'true',
    'aria-label': 'Layers, newest on top',
  });
  const root = h(
    'div',
    { class: 'panel' },
    h('h2', { text: 'Selection' }),
    props,
    h('h2', { text: 'Colours in the design' }),
    swatches,
    h('h2', null, 'Layers ', count),
    list,
  );

  // --- inspector ----------------------------------------------------------------------------

  let propsSig = '';
  let syncs: Sync[] = [];

  /** Arms one undo checkpoint per edit: taken on the first input after focus or pointer-down. */
  function editable<T extends HTMLElement>(el: T, apply: () => void): T {
    let armed = true;
    el.addEventListener('focus', () => (armed = true));
    el.addEventListener('pointerdown', () => (armed = true));
    el.addEventListener('input', () => {
      if (armed) {
        store.checkpoint();
        armed = false;
      }
      apply();
      store.touch();
    });
    return el;
  }

  function numberInput(
    get: () => number | undefined,
    set: (v: number) => void,
    o: { min?: number; max?: number; step?: number } = {},
  ): HTMLInputElement {
    const input = h('input', {
      type: 'number',
      class: 'mono',
      step: o.step ?? 1,
      min: o.min ?? null,
      max: o.max ?? null,
    });
    editable(input, () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      set(Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v)));
    });
    syncs.push({
      el: input,
      run: () => {
        const v = get();
        input.value = v === undefined ? '' : fmt(v);
      },
    });
    return input;
  }

  function rangeInput(
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    unit = '%',
  ): HTMLElement {
    const input = h('input', { type: 'range', min, max, step: 1 });
    const out = h('output', { class: 'mono' });
    editable(input, () => {
      set(parseFloat(input.value));
      out.textContent = input.value + unit;
    });
    syncs.push({
      el: input,
      run: () => {
        input.value = String(Math.round(get()));
        out.textContent = input.value + unit;
      },
    });
    const wrap = h('div', { class: 'range' }, input, out);
    wrap.dataset.control = '1';
    return wrap;
  }

  function colorControls(get: () => string, set: (c: string) => void): HTMLElement {
    const picker = h('input', { type: 'color', 'aria-label': 'Colour picker' });
    const text = h('input', {
      type: 'text',
      class: 'mono hex',
      maxLength: 7,
      spellcheck: false,
      'aria-label': 'Hex colour',
    });
    editable(picker, () => {
      set(picker.value.toLowerCase());
      text.value = picker.value.toLowerCase();
    });
    editable(text, () => {
      const v = text.value.trim().startsWith('#') ? text.value.trim() : '#' + text.value.trim();
      if (HEX.test(v)) {
        set(v.toLowerCase());
        picker.value = v.toLowerCase();
      }
    });
    syncs.push({ el: picker, run: () => (picker.value = get()) });
    syncs.push({ el: text, run: () => (text.value = get()) });
    return h('div', { class: 'color' }, picker, text);
  }

  function actions(): HTMLElement {
    return h(
      'div',
      { class: 'btn-row' },
      button('Flip H', () => flipSelected(store, 'h'), '', 'Mirror left to right'),
      button('Flip V', () => flipSelected(store, 'v'), '', 'Mirror top to bottom'),
      button('Centre', () => centreSelected(store), '', 'Centre on the canvas'),
      button('Forward', () => reorder(store, 1, false), '', 'Bring forward ( ] )'),
      button('Back', () => reorder(store, -1, false), '', 'Send backward ( [ )'),
      button('Duplicate', () => duplicateSelected(store), '', 'Ctrl D'),
      button('Delete', () => removeSelected(store), 'danger', 'Delete'),
    );
  }

  function buildSingle(id: string): void {
    const L = (): Layer | undefined => store.byId(id);
    const first = L();
    if (!first) return;
    const num = (
      label: string,
      key: 'x' | 'y' | 'w' | 'h' | 'rot',
      o: { min?: number; max?: number } = {},
    ): HTMLElement =>
      field(
        label,
        numberInput(
          () => L()?.[key],
          (v) => {
            const l = L();
            if (l) l[key] = v;
          },
          o,
        ),
      );
    props.append(
      h(
        'div',
        { class: 'grid5' },
        num('X', 'x'),
        num('Y', 'y'),
        num('W', 'w', { min: 0.5 }),
        num('H', 'h', { min: 0.5 }),
        num('Rot°', 'rot', { min: -360, max: 360 }),
      ),
      field(
        'Colour',
        colorControls(
          () => L()?.color ?? '#ffffff',
          (c) => {
            const l = L();
            if (l) l.color = c;
          },
        ),
      ),
      field(
        'Opacity',
        rangeInput(
          () => (L()?.opacity ?? 1) * 100,
          (v) => {
            const l = L();
            if (l) l.opacity = v / 100;
          },
          0,
          100,
        ),
      ),
    );
    const type = first.type;
    if (type === 'star' || type === 'poly') {
      props.append(
        field(
          type === 'star' ? 'Points' : 'Sides',
          numberInput(
            () => L()?.n,
            (v) => {
              const l = L();
              if (l) l.n = Math.round(v);
            },
            { min: 3, max: 32 },
          ),
        ),
      );
    }
    if (type === 'star' || type === 'ring') {
      props.append(
        field(
          type === 'star' ? 'Inner size' : 'Hole size',
          rangeInput(
            () => (L()?.inner ?? 0.5) * 100,
            (v) => {
              const l = L();
              if (l) l.inner = v / 100;
            },
            5,
            95,
          ),
        ),
      );
    }
    if (type === 'round') {
      props.append(
        field(
          'Corner radius',
          rangeInput(
            () => L()?.r ?? 0,
            (v) => {
              const l = L();
              if (l) l.r = v;
            },
            0,
            50,
          ),
        ),
      );
    }
    if (type === 'text') {
      const text = h('input', { type: 'text', maxLength: 200 });
      editable(text, () => {
        const l = L();
        if (l) l.text = text.value;
      });
      syncs.push({ el: text, run: () => (text.value = L()?.text ?? '') });
      const font = h('select', null, ...FONTS.map((f) => h('option', { value: f, text: f })));
      editable(font, () => {
        const l = L();
        if (l) l.font = font.value;
        if (document.fonts)
          document.fonts.load(`${L()?.weight ?? 700} 100px "${font.value}"`).catch(() => undefined);
      });
      font.addEventListener('change', () => font.dispatchEvent(new Event('input')));
      syncs.push({ el: font, run: () => (font.value = L()?.font ?? FONTS[0]) });
      const weight = h(
        'select',
        null,
        h('option', { value: '400', text: 'Regular' }),
        h('option', { value: '700', text: 'Bold' }),
      );
      editable(weight, () => {
        const l = L();
        if (l) l.weight = parseInt(weight.value, 10);
      });
      weight.addEventListener('change', () => weight.dispatchEvent(new Event('input')));
      syncs.push({ el: weight, run: () => (weight.value = String((L()?.weight ?? 700) >= 600 ? 700 : 400)) });
      props.append(
        field('Text', text),
        h('div', { class: 'grid2' }, field('Font', font), field('Weight', weight)),
      );
    }
    props.append(actions());
  }

  function buildMulti(n: number): void {
    const scale = h('input', { type: 'number', class: 'mono', value: '100', min: 1, max: 1000, step: 1 });
    const apply = button('Apply', () => {
      scaleSelected(store, parseFloat(scale.value));
      scale.value = '100';
    });
    const picker = h('input', {
      type: 'color',
      'aria-label': 'Colour for all selected layers',
      value: store.selected()[0]?.color ?? '#ffffff',
    });
    let armed = true;
    picker.addEventListener('pointerdown', () => (armed = true));
    picker.addEventListener('focus', () => (armed = true));
    picker.addEventListener('input', () => {
      if (armed) {
        recolorSelected(store, picker.value.toLowerCase());
        armed = false;
      } else {
        for (const l of store.selected()) l.color = picker.value.toLowerCase();
        store.touch();
      }
    });
    props.append(
      h('p', { class: 'hint', text: `${n} layers selected. Drag to move them together.` }),
      h(
        'div',
        { class: 'grid2' },
        field('Scale %', h('div', { class: 'inline' }, scale, apply)),
        field('Colour', picker),
      ),
      actions(),
    );
  }

  function refreshProps(): void {
    const sel = store.selected();
    const sig = sel.length > 1 ? 'multi:' + sel.length : sel.map((l) => l.id + ':' + l.type).join(',');
    if (sig !== propsSig) {
      propsSig = sig;
      syncs = [];
      clear(props);
      if (sel.length === 0) {
        props.append(
          h('p', {
            class: 'hint',
            text: 'Nothing selected. Click a shape on the canvas, drag a box around several, or add one from the rail.',
          }),
        );
      } else if (sel.length === 1) buildSingle(sel[0].id);
      else buildMulti(sel.length);
    }
    for (const s of syncs) if (document.activeElement !== s.el) s.run();
  }

  // --- swatches -----------------------------------------------------------------------------

  let swatchSig = '';
  function refreshSwatches(): void {
    const colors: string[] = [];
    for (let i = store.layers.length - 1; i >= 0 && colors.length < 18; i--) {
      const c = store.layers[i].color;
      if (!colors.includes(c)) colors.push(c);
    }
    const sig = colors.join();
    if (sig === swatchSig) return;
    swatchSig = sig;
    clear(swatches);
    for (const c of colors) {
      const b = h('button', { type: 'button', class: 'swatch', title: c, 'aria-label': 'Use colour ' + c });
      b.style.backgroundColor = c;
      b.addEventListener('click', () => recolorSelected(store, c));
      swatches.append(b);
    }
  }

  // --- layers panel -------------------------------------------------------------------------

  let listSig = '';
  let anchor: string | null = null;
  let dragId: string | null = null;
  /** While a name is being edited the list must not be rebuilt under the input. */
  let renaming = false;

  function clickRow(l: Layer, e: MouseEvent | KeyboardEvent): void {
    const order = store.layers.map((x) => x.id);
    if (e.shiftKey && anchor && order.includes(anchor)) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(l.id);
      store.select(order.slice(Math.min(a, b), Math.max(a, b) + 1)); // Shift range-select
      return;
    }
    anchor = l.id;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(store.sel);
      if (next.has(l.id)) next.delete(l.id);
      else next.add(l.id);
      store.select(next);
    } else store.select([l.id]);
  }

  function rename(l: Layer, label: HTMLElement): void {
    const input = h('input', {
      type: 'text',
      class: 'rename',
      value: l.name,
      maxLength: 80,
      'aria-label': 'Layer name',
    });
    let done = false;
    renaming = true;
    const commit = (save: boolean): void => {
      if (done) return;
      done = true;
      renaming = false;
      listSig = '';
      const name = input.value.trim();
      if (save && name && name !== l.name) {
        store.checkpoint();
        l.name = name;
        store.touch();
      } else {
        refreshList();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  function dropOn(targetId: string, above: boolean): void {
    if (!dragId || dragId === targetId) return;
    const ids = store.sel.has(dragId) ? new Set(store.sel) : new Set([dragId]);
    if (ids.has(targetId)) return;
    const moving = store.layers.filter((l) => ids.has(l.id));
    const rest = store.layers.filter((l) => !ids.has(l.id));
    const at = rest.findIndex((l) => l.id === targetId);
    if (at < 0) return;
    store.checkpoint();
    // The list shows the newest on top, so "above" a row means later in the array.
    rest.splice(above ? at + 1 : at, 0, ...moving);
    store.layers = rest;
    store.touch();
  }

  function toggle(label: string, on: boolean, glyph: string, act: () => void): HTMLButtonElement {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'icon' + (on ? ' on' : ''),
        'aria-label': label,
        'aria-pressed': on ? 'true' : 'false',
        title: label,
      },
      glyph,
    );
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      store.checkpoint();
      act();
      store.touch();
    });
    return b;
  }

  function refreshList(): void {
    if (renaming) return;
    const layers = store.layers;
    let sig = '';
    for (const l of layers)
      sig += `${l.id}|${l.name}|${l.visible ? 1 : 0}${l.locked ? 1 : 0}${store.sel.has(l.id) ? 1 : 0}|${l.color};`;
    if (sig === listSig) return;
    listSig = sig;
    count.textContent = String(layers.length);
    const frag = document.createDocumentFragment();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const selected = store.sel.has(l.id);
      const chip = h('span', { class: 'chip' });
      chip.style.backgroundColor = l.color;
      const name = h('span', { class: 'name', text: l.name });
      const row = h(
        'li',
        {
          class: 'layer' + (selected ? ' selected' : '') + (l.visible ? '' : ' hidden-layer'),
          role: 'option',
          'aria-selected': selected ? 'true' : 'false',
          tabIndex: 0,
          draggable: true,
        },
        chip,
        name,
        toggle(
          l.visible ? 'Hide layer' : 'Show layer',
          !l.visible,
          l.visible ? '●' : '○',
          () => (l.visible = !l.visible),
        ),
        toggle(
          l.locked ? 'Unlock layer' : 'Lock layer',
          l.locked,
          l.locked ? '■' : '□',
          () => (l.locked = !l.locked),
        ),
      );
      row.addEventListener('click', (e) => clickRow(l, e));
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        rename(l, name);
      });
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clickRow(l, e);
        } else if (e.key === 'F2') rename(l, name);
      });
      row.addEventListener('dragstart', (e) => {
        dragId = l.id;
        e.dataTransfer?.setData('text/plain', l.name);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        row.classList.toggle('drop-above', above);
        row.classList.toggle('drop-below', !above);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        dropOn(l.id, e.clientY < r.top + r.height / 2);
        dragId = null;
      });
      row.addEventListener('dragend', () => (dragId = null));
      frag.append(row);
    }
    clear(list);
    list.append(frag);
  }

  // --- scheduling ---------------------------------------------------------------------------

  let queued = false;
  let lastList = 0;
  function refresh(): void {
    queued = false;
    refreshProps();
    refreshSwatches();
    // While a trace is appending hundreds of layers a second, rebuild the list less often.
    const now = performance.now();
    if (!isBusy() || now - lastList > 250) {
      lastList = now;
      refreshList();
    } else schedule();
  }
  function schedule(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(refresh);
  }
  store.on((change) => {
    if (change !== 'view') schedule();
  });
  schedule();
  return root;
}
