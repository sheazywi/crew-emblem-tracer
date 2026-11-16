import { expect, test, type Page } from '@playwright/test';
import { expectClean, loadTestPicture, openApp, openHarness, snapshot, type Packed } from './support';

/**
 * Runs both generated console scripts against the fake editor harness: layer counts, exact
 * positions, the editor's quirks, error messages when the editor changes, and the safety rules
 * (no network, storage or cookie access, no leftovers).
 */

const run = (harness: Page, script: string): Promise<unknown> => harness.evaluate(script);

interface TraceResult {
  version: string;
  layers: Packed[];
  bytes: number;
  stoppedBy: string;
  nMax: number;
  binding: string;
  eligible: number;
  error?: string;
}
const traceResult = (harness: Page): Promise<TraceResult> =>
  harness.evaluate(() => (window as unknown as { __crestForgeTrace: TraceResult }).__crestForgeTrace);

test.describe('import script', () => {
  test('rebuilds every shape type with exact positions, and the editor draws what the app previewed', async ({
    context,
    page,
  }) => {
    await openApp(page);
    await page.evaluate(() => document.fonts.ready);
    const built = await page.evaluate(() => {
      const cf = window.crestForge!;
      const layers = cf.toSocialClub([...cf.fixtures.allTypes(), ...cf.fixtures.example()]).layers;
      return { layers, script: cf.buildImportScript(layers) };
    });
    expect(built.layers.length).toBeGreaterThan(150);

    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, built.script);

    const got = await snapshot(harness);
    expect(got).toHaveLength(built.layers.length);
    built.layers.forEach((p, i) => {
      const g = got[i];
      // Exact positions: the callback undoes the editor's whole-pixel rounding.
      expect(
        [g.slug, g.x, g.y, g.scaleX, g.scaleY, g.rotation, g._rotation, g.opacity, g.color, g.name],
        `layer ${i}`,
      ).toEqual([p[0], p[1], p[2], p[3], p[4], p[5], p[5], p[6], p[7], p[10]]);
      expect(g.transform).toBe(
        `T${p[1]},${p[2]}R${p[5]},${p[1] + (g.slug === 'rounds/14' ? 144 : widths[p[0]] / 2)},${p[2] + heights[p[0]] / 2}S${p[3] / 100},${p[4] / 100}`,
      );
    });
    // Positions really were fractional, so the rounding fix was exercised.
    expect(built.layers.some((p) => !Number.isInteger(p[1]) || !Number.isInteger(p[2]))).toBe(true);

    // Only the groups the design needs were requested, by their full path.
    const loads = await harness.evaluate(() =>
      (window as unknown as { __harness: { groupLoads(): string[][] } }).__harness.groupLoads(),
    );
    expect(loads).toHaveLength(1);
    expect(loads[0].every((g) => g.startsWith('emblems/shapes/'))).toBe(true);
    expect(loads[0]).not.toContain('emblems/shapes/rectangles'); // already in the library

    // One final report; never a confirm on an empty canvas.
    expect(seen.dialogs).toHaveLength(1);
    expect(seen.dialogs[0].type).toBe('alert');
    expect(seen.dialogs[0].message).toContain(
      `Added ${built.layers.length} of ${built.layers.length} layers.`,
    );
    expect(seen.dialogs[0].message).toContain('click Save');
    expect(seen.dialogs[0].message).toContain('only changes if you publish it yourself');
    await expectClean(harness, seen.requests);

    // Cross-bridge golden: what the fake editor drew equals what the app previewed.
    const png = await harness.evaluate(() =>
      (window as unknown as { __harness: { png(): string } }).__harness.png(),
    );
    const diff = await page.evaluate(
      async ({ url, layers }) => {
        const cf = window.crestForge!;
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = 512;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const preview = cf.renderPacked(layers).getContext('2d')!.getImageData(0, 0, 512, 512).data;
        return cf.pixelDiff(g.getImageData(0, 0, 512, 512).data, preview, 24);
      },
      { url: png, layers: built.layers },
    );
    expect(diff).toBeLessThan(0.0005);
  });

  test('survives the editor quirks: whole-pixel rounding, x + y = 0, flips and tiny scales', async ({
    context,
    page,
  }) => {
    await openApp(page);
    const data: Packed[] = [
      ['rounds/01', 80, -80, 25, 25, 0, 100, '#ff0000', false, false, 'a'], // x + y = 0: move() is skipped
      ['rounds/01', 10.4, 20.6, 25, 25, 0, 100, '#00ff00', false, false, 'b'], // would round to 10, 21
      ['angles/05', -12.25, 300.75, -40, 60, 123.45, 50, '#0000ff', true, false, 'c'], // flipped in X
      ['angles/03', 5.5, 6.5, 30, -30, 359.99, 100, '#ffffff', false, true, 'd$&'], // flipped in Y
      ['rectangles/square', 100, 100, 1, 1, 0, 100, '#123456', false, false, 'e'],
    ];
    const script = await page.evaluate((d) => window.crestForge!.buildImportScript(d), data);
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, script);
    const got = await snapshot(harness);
    expect(got.map((g) => [g.x, g.y])).toEqual(data.map((d) => [d[1], d[2]]));
    expect(got.map((g) => [g.scaleX, g.scaleY])).toEqual(data.map((d) => [d[3], d[4]]));
    expect(got.map((g) => [g.invertedX, g.invertedY])).toEqual(data.map((d) => [d[8], d[9]]));
    expect(got[2].rotation).toBe(123.45);
    expect(got[3].name).toBe('d$&');
    expect(got[4].type).toBe('rectangle');
    await expectClean(harness, seen.requests);
  });

  test('asks before replacing a canvas that has layers, and leaves it alone on Cancel', async ({
    context,
    page,
  }) => {
    await openApp(page);
    const two: Packed[] = [
      ['rounds/01', 1, 2, 10, 10, 0, 100, '#ffffff', false, false, 'a'],
      ['rounds/01', 3, 4, 10, 10, 0, 100, '#ffffff', false, false, 'b'],
    ];
    const three: Packed[] = [...two, ['angles/05', 5, 6, 10, 10, 0, 100, '#ffffff', false, false, 'c']];
    const [scriptTwo, scriptThree] = await page.evaluate(
      ([a, b]) => [window.crestForge!.buildImportScript(a), window.crestForge!.buildImportScript(b)],
      [two, three],
    );

    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, scriptTwo);
    await run(harness, scriptThree); // accept the confirm
    expect(await snapshot(harness)).toHaveLength(3);
    const confirm = seen.dialogs.find((d) => d.type === 'confirm');
    expect(confirm?.message).toContain(
      'The canvas has 2 layers. Replace them with the imported design (3 layers)?',
    );
    expect(confirm?.message).toContain('Nothing is saved until you click Save.');

    const cancelled = await context.newPage();
    const seen2 = await openHarness(cancelled, '', false);
    await run(cancelled, scriptTwo);
    await run(cancelled, scriptThree); // dismiss the confirm
    expect(await snapshot(cancelled)).toHaveLength(2);
    expect(seen2.dialogs.filter((d) => d.type === 'confirm')).toHaveLength(1);
    await expectClean(cancelled, seen2.requests);
  });

  test('asks before importing an oversized design', async ({ context, page }) => {
    await openApp(page);
    const many: Packed[] = Array.from(
      { length: 760 },
      (_, i) => ['rounds/01', i, i, 5, 5, 0, 100, '#ffffff', false, false, 'c' + i] as Packed,
    );
    const script = await page.evaluate((d) => window.crestForge!.buildImportScript(d), many);
    const harness = await context.newPage();
    const seen = await openHarness(harness, '', false);
    await run(harness, script);
    expect(seen.dialogs).toHaveLength(1);
    expect(seen.dialogs[0].type).toBe('confirm');
    expect(seen.dialogs[0].message).toContain('probably too large to save');
    expect(seen.dialogs[0].message).toContain('It has 760 layers; the editor allows 750.');
    expect(await snapshot(harness)).toHaveLength(0);
  });

  test('fails with a readable message when the editor changes', async ({ context, page }) => {
    await openApp(page);
    const script = await page.evaluate(() =>
      window.crestForge!.buildImportScript([
        ['rounds/01', 1, 2, 10, 10, 0, 100, '#ffffff', false, false, 'a'],
      ]),
    );
    const cases: [string, RegExp][] = [
      ['?missing=webpack', /Open the Social Club emblem editor first/],
      [
        '?missing=layers',
        /Could not find the layer manager \(add, removeAll, getLayers\)\..*Nothing was changed/,
      ],
      ['?missing=groups', /Could not find the shape-group loader \(loadGroups, initObjects\)/],
      ['?missing=shapes', /Could not find the shape library \(library, create\)/],
      ['?missing=layers,shapes', /the layer manager .* or the shape library/],
    ];
    for (const [query, message] of cases) {
      const harness = await context.newPage();
      const problems: string[] = [];
      harness.on('pageerror', (e) => problems.push(e.message));
      const seen = await openHarness(harness, query);
      await run(harness, script);
      expect(seen.dialogs, query).toHaveLength(1);
      expect(seen.dialogs[0].message, query).toMatch(message);
      expect(seen.dialogs[0].message, query).toContain('Crest Forge v1.4.0');
      expect(problems, query).toEqual([]);
      await expectClean(harness, seen.requests);
      await harness.close();
    }
  });

  test('names shapes that are not in the library and stops', async ({ context, page }) => {
    await openApp(page);
    const script = await page.evaluate(() =>
      window.crestForge!.buildImportScript([
        ['rounds/01', 1, 2, 10, 10, 0, 100, '#ffffff', false, false, 'a'],
        ['curves/gone', 1, 2, 10, 10, 0, 100, '#ffffff', false, false, 'b'],
      ]),
    );
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    test.setTimeout(60_000);
    await run(harness, script); // polls for 20 s before giving up
    expect(seen.dialogs[0].message).toContain('These shapes are not in the editor library: curves/gone.');
    expect(await snapshot(harness)).toHaveLength(0);
  });
});

test.describe('trace script', () => {
  const build = async (page: Page, over: Record<string, unknown>): Promise<string> => {
    await openApp(page);
    await loadTestPicture(page);
    return page.evaluate((o) => {
      const cf = window.crestForge!;
      const image = cf.tracer.scriptImage(220);
      if (!image) throw new Error('no picture');
      return cf.buildTraceScript(image, {
        groups: [
          'rounds',
          'squares',
          'triangles',
          'rectangles',
          'polygons',
          'curves',
          'angles',
          'perspective',
          'radials',
        ],
        auto: false,
        count: 40,
        alpha: 1,
        res: 96,
        cand: 20,
        mut: 30,
        bg: true,
        dry: false,
        quiet: true,
        ...o,
      });
    }, over);
  };

  test('dry run traces without touching the canvas', async ({ context, page }) => {
    const script = await build(page, { dry: true });
    expect(script.length).toBeLessThan(120_000);
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, script);
    const result = await traceResult(harness);
    expect(result.error).toBeUndefined();
    expect(result.version).toBe('1.4.0');
    expect(result.layers).toHaveLength(41); // background + 40 shapes
    expect(result.layers[0].slice(0, 1)).toEqual(['rectangles/square']);
    expect(result.stoppedBy).toBe('the shape count you chose');
    expect(result.nMax).toBeGreaterThan(300);
    // The 4,000-character path limit keeps the long stand-in shape out; stars were not chosen.
    expect(result.eligible).toBeGreaterThan(15);
    const slugs = new Set(result.layers.map((l) => l[0]));
    expect(slugs.has('curves/cf-long')).toBe(false);
    expect(slugs.has('stars/cf-star')).toBe(false);
    for (const l of result.layers) {
      expect(Math.abs(l[3])).toBeGreaterThanOrEqual(1);
      expect(Math.abs(l[3])).toBeLessThanOrEqual(490);
      expect(Math.abs(l[4])).toBeLessThanOrEqual(490);
      expect(l[8]).toBe(l[3] < 0);
      expect(l[5]).toBeGreaterThanOrEqual(0);
      expect(l[5]).toBeLessThan(360);
      expect(l[7]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(await snapshot(harness)).toHaveLength(0);
    expect(seen.dialogs).toEqual([]); // quiet
    await expectClean(harness, seen.requests);
  });

  test('stops when more shapes stop helping', async ({ context, page }) => {
    const script = await build(page, { auto: true, dry: true, minGain: 2e-5 });
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, script);
    const result = await traceResult(harness);
    console.log('Tracer B with early stop:', result.layers.length, 'layers, stopped by', result.stoppedBy);
    expect(result.stoppedBy).toBe('more shapes no longer visibly improving the match');
    expect(result.layers.length).toBeLessThan(400);
    await expectClean(harness, seen.requests);
  });

  test('live run adds each layer with exact positions and removes its panel', async ({ context, page }) => {
    const script = await build(page, { quiet: false });
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, script);
    const got = await snapshot(harness);
    expect(got).toHaveLength(41);
    expect(got[0]).toMatchObject({ slug: 'rectangles/square', name: 'bg', x: 106, y: 106, scaleX: 170.67 });
    expect(got.slice(1).every((g, i) => g.name === 't' + (i + 1))).toBe(true);
    expect(got.some((g) => !Number.isInteger(g.x))).toBe(true);
    expect(got.every((g) => g.rotation === g._rotation)).toBe(true);
    expect(seen.dialogs).toHaveLength(1);
    expect(seen.dialogs[0].message).toMatch(
      /Added 41 of 41 layers\. Estimated save size \d+ KB of 1024 KB\. Stopped by the shape count you chose/,
    );
    expect(await harness.evaluate(() => '__crestForgeTrace' in window)).toBe(false);
    await expectClean(harness, seen.requests);
  });

  test('Auto stops at a limit, never exceeds 740 layers or the save budget, and says which', async ({
    context,
    page,
  }) => {
    const script = await build(page, { auto: true, dry: true, cand: 6, mut: 6, groups: 'all' });
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    test.setTimeout(120_000);
    await run(harness, script);
    const result = await traceResult(harness);
    console.log(
      'Tracer B auto:',
      result.layers.length,
      'layers,',
      result.bytes,
      'bytes, stopped by',
      result.stoppedBy,
      '| nMax',
      result.nMax,
      result.binding,
    );
    expect(result.error).toBeUndefined();
    expect(result.layers.length).toBeLessThanOrEqual(740);
    expect(result.bytes).toBeLessThanOrEqual(960_000);
    expect(result.stoppedBy).toMatch(/the layer limit \(740\)|the save-size budget|no further improvement/);
    expect(['layers', 'size']).toContain(result.binding);
    // With every shape allowed the limit is 6,000 characters, so the long stand-in is eligible.
    expect(result.eligible).toBeGreaterThan(20);
    await expectClean(harness, seen.requests);
  });

  test('Stop ends the trace early and keeps what was added', async ({ context, page }) => {
    const script = await build(page, { auto: true, cand: 60, mut: 120, res: 192 });
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    const done = run(harness, script);
    const stop = harness.getByRole('button', { name: 'Stop' });
    await expect(stop).toBeVisible();
    await expect(harness.getByRole('status')).toContainText(/\d+ shapes, \d+ KB, about \d+ more fit/);
    await harness.waitForFunction(
      () => (window as unknown as { __harness: { snapshot(): unknown[] } }).__harness.snapshot().length > 3,
    );
    await stop.click();
    await done;
    const n = (await snapshot(harness)).length;
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(740);
    await expectClean(harness, seen.requests);
  });

  test('asks before replacing existing layers, and fails readably when the editor changes', async ({
    context,
    page,
  }) => {
    const script = await build(page, { count: 5, quiet: false });
    const harness = await context.newPage();
    const seen = await openHarness(harness);
    await run(harness, script);
    await run(harness, script);
    expect(seen.dialogs.filter((d) => d.type === 'confirm')).toHaveLength(1);
    expect(seen.dialogs.find((d) => d.type === 'confirm')?.message).toContain(
      'The canvas has 6 layers. Replace them with a trace of the picture',
    );
    expect(await snapshot(harness)).toHaveLength(6);

    const broken = await context.newPage();
    const seen2 = await openHarness(broken, '?missing=groups');
    await run(broken, script);
    expect(seen2.dialogs).toHaveLength(1);
    expect(seen2.dialogs[0].message).toMatch(
      /Could not find the shape-group loader \(loadGroups, initObjects\)\..*Nothing was changed/,
    );
    await expectClean(broken, seen2.requests);
  });
});

test('contract:check snippet re-measures the contract read-only', async ({ page }) => {
  const tool = (await import('../tools/contract-check.mjs' as string)) as { buildContractCheck(): string };
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  const seen = await openHarness(page);
  await run(page, tool.buildContractCheck());
  expect(logs.join(' | ')).toContain('All checks passed.');
  expect(await snapshot(page)).toHaveLength(0);
  expect(seen.dialogs).toEqual([]);
  await expectClean(page, seen.requests);
});

// Native boxes of the contract primitives, as the harness library declares them.
const widths: Record<string, number> = {
  'rectangles/square': 300,
  'rounds/01': 300,
  'angles/03': 159,
  'angles/05': 192,
  'polygons/04': 300,
  'rounds/67': 300,
  'rounds/68': 300,
  'rounds/69': 300,
  'rounds/70': 300,
  'rounds/13': 300,
  'rounds/14': 288,
};
const heights: Record<string, number> = { ...widths, 'angles/03': 300, 'angles/05': 300, 'polygons/04': 260 };
