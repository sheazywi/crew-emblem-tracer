import { describe, expect, it } from 'vitest';
import { allTypesFixture, exampleCrest } from '../src/model/example';
import { History } from '../src/model/history';
import { fromProjectJson, sanitizeLayers, toProjectJson } from '../src/model/persistence';
import { Store } from '../src/model/store';
import { LAYER_TYPES, makeLayer } from '../src/model/types';
import {
  addShape,
  centreSelected,
  duplicateSelected,
  flipSelected,
  removeSelected,
  reorder,
  scaleSelected,
} from '../src/editor/ops';
import { toSocialClub } from '../src/socialclub/convert';

describe('undo history', () => {
  it('keeps 200 steps and clears redo on a new change', () => {
    const h = new History(200);
    for (let i = 0; i < 250; i++) h.push('s' + i);
    expect(h.depth).toBe(200);
    expect(h.undo('now')).toBe('s249');
    expect(h.undo('s249')).toBe('s248');
    expect(h.redo('s248')).toBe('s249');
    expect(h.canRedo).toBe(true);
    h.push('branch');
    expect(h.canRedo).toBe(false);
    expect(new History().undo('x')).toBeNull();
  });
});

describe('store and document operations', () => {
  const fresh = (): Store => {
    const s = new Store();
    s.layers = [
      makeLayer('rect', { x: 100, y: 100, w: 40, h: 20 }),
      makeLayer('ellipse', { x: 300, y: 200, w: 60, h: 60 }),
    ];
    return s;
  };

  it('undoes and redoes whole operations', () => {
    const s = fresh();
    addShape(s, 'star');
    expect(s.layers).toHaveLength(3);
    expect(s.sel.size).toBe(1);
    addShape(s, 'preset:shield');
    expect(s.layers[3]).toMatchObject({ type: 'path', name: 'Shield' });
    removeSelected(s);
    expect(s.layers).toHaveLength(3);
    s.undo();
    expect(s.layers).toHaveLength(4);
    s.undo();
    s.undo();
    expect(s.layers).toHaveLength(2);
    s.redo();
    expect(s.layers).toHaveLength(3);
    expect(addShape(s, 'preset:nope')).toBeNull();
  });

  it('moves, scales, flips and reorders the selection as a group', () => {
    const s = fresh();
    s.select(s.layers.map((l) => l.id));
    centreSelected(s);
    // Bounds were x 80..330, y 90..230: centre (205, 160) moves to (256, 256).
    expect(s.layers[0]).toMatchObject({ x: 151, y: 196 });
    scaleSelected(s, 200);
    expect(s.layers[0]).toMatchObject({ w: 80, h: 40 });
    expect(s.layers[1]).toMatchObject({ w: 120, h: 120 });
    const before = s.layers.map((l) => l.x);
    flipSelected(s, 'h');
    expect(s.layers[0].fx).toBe(true);
    expect(s.layers[0].x + before[0]).toBeCloseTo(s.layers[1].x + before[1], 9);
    duplicateSelected(s);
    expect(s.layers).toHaveLength(4);
    expect(s.sel.size).toBe(2);
    reorder(s, -1, true);
    expect(s.sel.has(s.layers[0].id) && s.sel.has(s.layers[1].id)).toBe(true);
    reorder(s, 1, false);
    expect(s.sel.has(s.layers[1].id) && s.sel.has(s.layers[2].id)).toBe(true);
  });

  it('mirrors a rotated layer correctly: rotation is negated', () => {
    const s = new Store();
    s.layers = [makeLayer('rtri', { rot: 30 })];
    s.select([s.layers[0].id]);
    flipSelected(s, 'v');
    expect(s.layers[0]).toMatchObject({ rot: 330, fy: true, fx: false });
  });
});

describe('project files', () => {
  it('round-trips every layer type', () => {
    const layers = allTypesFixture();
    expect(new Set(layers.map((l) => l.type)).size).toBeGreaterThanOrEqual(LAYER_TYPES.length - 1);
    expect(fromProjectJson(toProjectJson(layers))).toEqual(layers);
    expect(fromProjectJson(JSON.stringify(exampleCrest()))).toHaveLength(exampleCrest().length);
  });

  it('sanitises untrusted input', () => {
    const out = sanitizeLayers([
      { type: 'rect', x: 'oops', w: -5, color: 'red', opacity: 7, id: 'a' },
      { type: 'rect', id: 'a' },
      { type: 'nonsense' },
      { type: 'path', pts: [0, 0, 1] },
      { type: 'text', text: 'x'.repeat(999), font: 'A"; } body { color: red', weight: 9000 },
      null,
      'string',
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ x: 256, w: 0.01, color: '#ffffff', opacity: 1, id: 'a' });
    expect(out[1].id).not.toBe('a');
    expect(out[2].text).toHaveLength(200);
    expect(out[2].font).not.toMatch(/["{};]/);
    expect(out[2].weight).toBe(900);
    expect(() => fromProjectJson('{"nope":1}')).toThrow();
    expect(() => sanitizeLayers('x')).toThrow();
  });
});

describe('example crest', () => {
  it('converts into a design that fits Social Club with room to spare', () => {
    const res = toSocialClub(exampleCrest(), { textRects: () => [{ x: 0, y: 0, w: 30, h: 10 }] });
    expect(res.layers.length).toBeGreaterThan(30);
    expect(res.layers.length).toBeLessThan(400);
    expect(res.stats.dropped).toBe(0);
  });
});
