import { h } from './dom';

let host: HTMLElement | null = null;

/** Short status message, announced politely to screen readers. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: 'toast ' + kind, text: message });
  host.append(el);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 5500);
}

/** Copy text; if the clipboard is unavailable, show it in a read-only textarea, selected. */
export async function copyText(text: string, fallbackHost: HTMLElement, what: string): Promise<boolean> {
  fallbackHost.replaceChildren();
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied (${Math.round(text.length / 1024)} KB).`);
    return true;
  } catch {
    const area = h('textarea', {
      class: 'fallback',
      readOnly: true,
      rows: 5,
      'aria-label': `${what}: copy this text`,
    });
    area.value = text;
    fallbackHost.append(
      h('p', {
        class: 'hint',
        text: 'Your browser blocked the clipboard. Copy the text below (it is already selected).',
      }),
      area,
    );
    area.focus();
    area.select();
    return false;
  }
}
