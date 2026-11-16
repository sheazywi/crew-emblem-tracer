type Child = Node | string | number | null | undefined | false;

/**
 * Tiny DOM builder. Never sets inline `style` attributes from markup, so the app runs under a
 * strict Content-Security-Policy; use element.style.x = ... for dynamic styling.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'text') el.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (
        key.startsWith('aria-') ||
        key.startsWith('data-') ||
        key === 'role' ||
        key === 'for' ||
        key === 'list'
      ) {
        el.setAttribute(key, value === true ? 'true' : String(value));
      } else if (key in el) Reflect.set(el, key, value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === 'number' ? String(kid) : kid);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

let labelSeq = 0;

/** A labelled control: <label>text</label> + control, wired with for/id. */
export function field(label: string, control: HTMLElement, cls = ''): HTMLElement {
  // Label the real form control when it is wrapped (a range with its readout, a colour pair).
  const target = control.matches('input,select,textarea')
    ? control
    : (control.querySelector<HTMLElement>('input,select,textarea') ?? control);
  if (!target.id) target.id = 'cf-f' + ++labelSeq;
  return h('div', { class: 'field ' + cls }, h('label', { for: target.id, text: label }), control);
}

export function button(label: string, onClick: () => void, cls = '', title = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn ' + cls, title: title || null, onclick: onClick }, label);
}

export function checkbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): {
  root: HTMLElement;
  input: HTMLInputElement;
} {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return { root: h('label', { class: 'check' }, input, h('span', { text: label })), input };
}
