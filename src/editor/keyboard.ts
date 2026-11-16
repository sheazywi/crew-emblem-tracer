import type { Store } from '../model/store';
import type { Editor } from './editor';
import {
  copySelected,
  duplicateSelected,
  nudge,
  pasteLayers,
  removeSelected,
  reorder,
  selectAll,
} from './ops';

const isField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Controls that use Space/Enter themselves; canvas shortcuts must not steal those keys. */
const isControl = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && /^(BUTTON|A|SUMMARY|LI)$/.test(t.tagName);

/**
 * Keyboard: Ctrl Z / Ctrl Shift Z / Ctrl Y, Ctrl D, Ctrl C / Ctrl V, Ctrl A, Delete, arrows
 * (Shift for 10 px), [ and ] (Shift for bottom/top), Escape, F to fit, Space to pan.
 */
export function bindKeyboard(store: Store, editor: Editor, onPasteImage: (file: File) => void): void {
  window.addEventListener('keydown', (e) => {
    if (isField(e.target)) {
      if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z') {
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') store.redo();
    else if (mod && key === 'd') duplicateSelected(store);
    else if (mod && key === 'c') copySelected(store);
    else if (mod && key === 'a') selectAll(store);
    else if (mod || e.altKey) handled = false;
    else if (key === 'delete' || key === 'backspace') removeSelected(store);
    else if (key === 'arrowleft') nudge(store, e.shiftKey ? -10 : -1, 0);
    else if (key === 'arrowright') nudge(store, e.shiftKey ? 10 : 1, 0);
    else if (key === 'arrowup') nudge(store, 0, e.shiftKey ? -10 : -1);
    else if (key === 'arrowdown') nudge(store, 0, e.shiftKey ? 10 : 1);
    else if (e.code === 'BracketLeft') reorder(store, -1, e.shiftKey);
    else if (e.code === 'BracketRight') reorder(store, 1, e.shiftKey);
    else if (key === 'escape') store.select([]);
    else if (key === 'f') editor.fit();
    else if (e.code === 'Space' && !isControl(e.target)) {
      editor.spaceDown = true;
      editor.canvas.style.cursor = 'grab';
    } else handled = false;
    if (handled) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      editor.spaceDown = false;
      editor.canvas.style.cursor = 'default';
    }
  });
  window.addEventListener('blur', () => {
    editor.spaceDown = false;
  });

  // Ctrl V: a picture on the clipboard goes to the tracer, otherwise paste copied layers.
  document.addEventListener('paste', (e) => {
    if (isField(e.target)) return;
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      onPasteImage(file);
    } else if (pasteLayers(store)) {
      e.preventDefault();
    }
  });
}
