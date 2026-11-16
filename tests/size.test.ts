import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT, SLUG, type Packed } from '../src/socialclub/editor-contract';
import {
  backgroundCost,
  bindingText,
  kindCost,
  layerCost,
  scBytes,
  shapeBudget,
  usage,
  worstCost,
} from '../src/socialclub/size';

const simple = (n: number, slug: string = SLUG.circle): Packed[] =>
  Array.from(
    { length: n },
    (_, i) => [slug, 0, 0, 10, 10, 0, 100, '#ffffff', false, false, 't' + i] as Packed,
  );

describe('save-size estimate', () => {
  it('follows bytes = 4/3 (742 + 1.2 L_path + L_name)', () => {
    expect(layerCost(0, 0)).toBeCloseTo((4 / 3) * 742, 9);
    expect(layerCost(558, 3)).toBeCloseTo((4 / 3) * (742 + 1.2 * 558 + 3), 9);
  });

  it('matches the measured per-layer costs', () => {
    // Simple primitives cost about 1.1 KB per layer; a median library shape about 1.9 KB.
    expect(kindCost('ellipse').b).toBeGreaterThan(1050);
    expect(kindCost('ellipse').b).toBeLessThan(1150);
    expect(kindCost('rect').b).toBeCloseTo(kindCost('circle').b, 6);
    expect(kindCost('triangle')).toMatchObject({ n: 2 });
    expect(kindCost('triangle').b).toBeGreaterThan(2000);
    expect(kindCost('triangle').b).toBeLessThan(2200);
    expect(layerCost(CONTRACT.medianPathLen, 3)).toBeGreaterThan(1800);
    expect(layerCost(CONTRACT.medianPathLen, 3)).toBeLessThan(1950);
    // 740 simple layers fit comfortably; about 520 median shapes fill the limit.
    expect(scBytes(simple(740))).toBeLessThan(CONTRACT.saveAuto);
    const medianFit = CONTRACT.saveMax / layerCost(CONTRACT.medianPathLen, 3);
    expect(medianFit).toBeGreaterThan(500);
    expect(medianFit).toBeLessThan(580);
  });

  it('charges unknown slugs like a median library shape', () => {
    expect(scBytes(simple(1, 'wings/99'))).toBe(Math.round(layerCost(CONTRACT.medianPathLen, 2)));
  });
});

describe('automatic shape budget', () => {
  it('reproduces the worst-case formula: 369 traced shapes with a background', () => {
    const b = shapeBudget({
      perShape: worstCost(['ellipse', 'circle', 'rect', 'triangle']),
      backgroundLayers: 1,
      backgroundBytes: backgroundCost(),
      existingLayers: 0,
      existingBytes: 0,
    });
    expect(b).toEqual({ n: 369, binding: 'layers' });
    expect(bindingText(b.binding)).toBe('limited by the layer limit (740)');
  });

  it('uses 740 single-layer shapes when nothing else is on the canvas', () => {
    const b = shapeBudget({
      perShape: worstCost(['ellipse']),
      backgroundLayers: 0,
      backgroundBytes: 0,
      existingLayers: 0,
      existingBytes: 0,
    });
    expect(b).toEqual({ n: 740, binding: 'layers' });
  });

  it('names save size when that binds first, and counts the existing design', () => {
    const perShape = { n: 1, b: layerCost(2506, 4) }; // a 75th-percentile library shape
    const b = shapeBudget({
      perShape,
      backgroundLayers: 0,
      backgroundBytes: 0,
      existingLayers: 100,
      existingBytes: 300_000,
    });
    expect(b.binding).toBe('size');
    expect(b.n).toBe(Math.floor((CONTRACT.saveAuto - 300_000) / perShape.b));
    expect(bindingText(b.binding)).toBe('limited by save size (layer limit 740)');
    const full = shapeBudget({
      perShape,
      backgroundLayers: 0,
      backgroundBytes: 0,
      existingLayers: 800,
      existingBytes: 0,
    });
    expect(full.n).toBe(0);
  });

  it('never lets a worst-case budget exceed either limit', () => {
    for (const kinds of [['ellipse'], ['triangle'], ['rect', 'triangle']] as const) {
      const per = worstCost(kinds);
      const b = shapeBudget({
        perShape: per,
        backgroundLayers: 1,
        backgroundBytes: backgroundCost(),
        existingLayers: 0,
        existingBytes: 0,
      });
      expect(b.n * per.n + 1).toBeLessThanOrEqual(CONTRACT.layersAuto);
      expect(b.n * per.b + backgroundCost()).toBeLessThanOrEqual(CONTRACT.saveAuto);
    }
  });
});

describe('usage against both limits', () => {
  it('reports headroom, warns above 95% and blocks above the limit', () => {
    const ok = usage(simple(412));
    expect(ok).toMatchObject({
      layers: 412,
      overLayers: false,
      overBytes: false,
      warn: false,
      roomBinding: 'layers',
    });
    expect(ok.room).toBe(CONTRACT.layersAuto - 412);
    expect(usage(simple(745)).warn).toBe(true); // past the 740 safety margin
    expect(usage(simple(751))).toMatchObject({ overLayers: true });
    const heavy = usage(simple(540, 'wings/99'));
    expect(heavy.byteFraction).toBeGreaterThan(CONTRACT.warnFraction);
    expect(heavy.warn).toBe(true);
    expect(usage(simple(600, 'wings/99'))).toMatchObject({ overBytes: true, room: 0 });
  });
});

/**
 * Calibration against real payloads. Each fixture is { layers: Packed[], payloadLength: number },
 * captured in a signed-in editor tab with `pnpm contract:check` (see docs/editor-contract.md).
 * None ship with the repository yet, so this block reports itself as skipped until they do.
 */
const dir = join(process.cwd(), 'tests', 'fixtures', 'payloads');
const fixtures = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe.skipIf(fixtures.length === 0)('estimate versus real editor payloads', () => {
  it.each(fixtures)('%s is within 5%%', (file) => {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
      layers: Packed[];
      payloadLength: number;
    };
    const estimate = scBytes(fixture.layers);
    expect(Math.abs(estimate - fixture.payloadLength) / fixture.payloadLength).toBeLessThan(0.05);
  });
});
