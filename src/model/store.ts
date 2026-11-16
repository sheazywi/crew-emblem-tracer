import { History } from './history';
import { saveLocal } from './persistence';
import type { Layer } from './types';

export type Change = 'doc' | 'sel' | 'view';

/** The single source of truth: layers, selection and undo history, with a tiny pub/sub. */
export class Store {
  layers: Layer[] = [];
  sel = new Set<string>();
  readonly history = new History(200);
  /** False once an autosave attempt has failed; the app keeps working without storage. */
  storageOk = true;
  private subs = new Set<(c: Change) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  on(fn: (c: Change) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(change: Change): void {
    for (const fn of this.subs) fn(change);
    if (change === 'doc') this.scheduleSave();
  }

  /** Call before a committed change (drag start, first input of an edit, trace start). */
  checkpoint(): void {
    this.history.push(JSON.stringify(this.layers));
  }

  /** Call after mutating layers. */
  touch(): void {
    this.emit('doc');
  }

  undo(): boolean {
    return this.restore(this.history.undo(JSON.stringify(this.layers)));
  }

  redo(): boolean {
    return this.restore(this.history.redo(JSON.stringify(this.layers)));
  }

  private restore(snapshot: string | null): boolean {
    if (snapshot === null) return false;
    this.layers = JSON.parse(snapshot) as Layer[];
    const ids = new Set(this.layers.map((l) => l.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
    this.emit('doc');
    this.emit('sel');
    return true;
  }

  byId(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  selected(): Layer[] {
    return this.sel.size ? this.layers.filter((l) => this.sel.has(l.id)) : [];
  }

  select(ids: Iterable<string>): void {
    this.sel = new Set(ids);
    this.emit('sel');
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.storageOk = saveLocal(this.layers);
    }, 400);
  }
}
