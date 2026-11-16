import { describe, expect, it } from 'vitest';
import { CONTRACT, FAMILIES, PRIMS, RING_SLUGS, SLUG } from '../src/socialclub/editor-contract';

interface Embedded {
  build: string;
  canvas: number;
  costBase: number;
  costPerPathChar: number;
  costBase64: number;
  noPathLen: number;
  groupPrefix: string;
  prims: Record<string, { w: number; h: number; pts?: number[][]; ratio?: number }>;
}

describe('editor contract', () => {
  it('holds the limits measured in November 2026', () => {
    expect(CONTRACT).toMatchObject({
      canvas: 512,
      layersMax: 750,
      layersAuto: 740,
      saveMax: 1_048_576,
      saveAuto: 960_000,
      warnFraction: 0.95,
      scaleMin: 1,
      scaleMax: 500,
      traceScaleMax: 490,
      dropBelowPx: 0.4,
      costBase: 742,
      costPerPathChar: 1.2,
      tracePathMax: 4000,
      tracePathMaxAll: 6000,
    });
    expect(CONTRACT.costBase64).toBeCloseTo(4 / 3, 12);
    expect(CONTRACT.saveAuto / CONTRACT.saveMax).toBeCloseTo(0.92, 2);
  });

  it('carries only the primitive outlines needed for the exact preview', () => {
    expect(Object.keys(PRIMS).sort()).toEqual(
      [
        'angles/03',
        'angles/05',
        'polygons/04',
        'rectangles/square',
        'rounds/01',
        'rounds/13',
        'rounds/14',
        'rounds/67',
        'rounds/68',
        'rounds/69',
        'rounds/70',
      ].sort(),
    );
    expect(PRIMS[SLUG.iso]).toMatchObject({ w: 159, h: 300 });
    expect(PRIMS[SLUG.right]).toMatchObject({ w: 192, h: 300 });
    expect(PRIMS[SLUG.hex]).toMatchObject({ w: 300, h: 260 });
    expect(RING_SLUGS.map((r) => r.ratio)).toEqual([0.3183, 0.4887, 0.8333, 0.9333, 0.9667, 0.9933]);
    expect(PRIMS['rounds/14']).toMatchObject({ w: 288, h: 288 });
    // No path strings anywhere: polygons are a few vertices, everything else is parametric.
    for (const prim of Object.values(PRIMS)) {
      expect(Object.keys(prim)).not.toContain('path');
      expect((prim.pts ?? []).length).toBeLessThanOrEqual(6);
    }
    expect(FAMILIES.basic).toEqual(['rounds', 'squares', 'triangles', 'rectangles', 'polygons']);
    expect(FAMILIES.curves).toEqual(['curves', 'angles', 'perspective', 'radials']);
  });

  it('gives contract:check the same values, in a read-only snippet', async () => {
    const tool = (await import('../tools/contract-check.mjs' as string)) as { buildContractCheck(): string };
    const snippet = tool.buildContractCheck();
    // Syntax check only; the snippet is this repository's own generated text and is never run here.
    expect(() => new Function(snippet)).not.toThrow();
    const match = /const EXPECT = (\{.*\});/.exec(snippet);
    expect(match).not.toBeNull();
    const embedded = JSON.parse((match as RegExpExecArray)[1]) as Embedded;
    expect(embedded).toMatchObject({
      build: CONTRACT.build,
      canvas: CONTRACT.canvas,
      costBase: CONTRACT.costBase,
      costPerPathChar: CONTRACT.costPerPathChar,
      groupPrefix: CONTRACT.groupPrefix,
      noPathLen: PRIMS[SLUG.square].pathLen,
    });
    expect(embedded.costBase64).toBeCloseTo(CONTRACT.costBase64, 12);
    expect(Object.keys(embedded.prims).sort()).toEqual(Object.keys(PRIMS).sort());
    for (const [slug, prim] of Object.entries(PRIMS)) {
      expect(embedded.prims[slug].w, slug).toBe(prim.w);
      expect(embedded.prims[slug].h, slug).toBe(prim.h);
      expect(embedded.prims[slug].pts, slug).toEqual(prim.pts);
      expect(embedded.prims[slug].ratio, slug).toBe(prim.ratio);
    }
    for (const word of [
      'fetch',
      'XMLHttpRequest',
      'localStorage',
      'document.cookie',
      '.click(',
      'emblems/save',
      'emblems/publish',
      'removeAll()',
      '.add(',
    ]) {
      expect(snippet.includes(word), word).toBe(false);
    }
  });
});
