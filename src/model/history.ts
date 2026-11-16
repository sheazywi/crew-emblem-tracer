/** Undo history: JSON snapshots of the layer array, taken before each committed change. */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(private readonly limit = 200) {}

  /** Record the state as it was before a change. Clears the redo stack. */
  push(snapshot: string): void {
    if (this.undoStack[this.undoStack.length - 1] === snapshot) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Returns the snapshot to restore, or null when there is nothing to undo. */
  undo(current: string): string | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }
}
