import { expect, test } from '@playwright/test';
import { loadTestPicture, openApp } from './support';

test('opens on the example crest, under the production CSP, with no errors', async ({ page }) => {
  const problems = await openApp(page);
  await expect(page.locator('.layer')).toHaveCount(8);
  await expect(page.locator('h1')).toHaveText('Crest Forge');
  await expect(page.getByText(/Not affiliated with or endorsed by Rockstar Games/)).toBeVisible();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('unsafe');
  // The stage is actually painted.
  const painted = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.stage-canvas');
    const d = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    if (d) for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(10_000);
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('makes no network requests beyond its own static files', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (
      !r.url().startsWith('http://localhost:4173/') &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:')
    ) {
      outside.push(r.url());
    }
  });
  await openApp(page);
  await loadTestPicture(page);
  await page.getByRole('button', { name: 'Trace picture' }).click();
  await expect(page.locator('.status')).toContainText(/Stopped|Traced|Done/, { timeout: 60_000 });
  expect(outside).toEqual([]);
});

test('edits with the rail, inspector, keyboard and pointer, with undo', async ({ page }) => {
  await openApp(page);
  const layers = (): Promise<number> => page.evaluate(() => window.crestForge!.store.layers.length);
  const top = (): Promise<Record<string, unknown>> =>
    page.evaluate(() => {
      const l = window.crestForge!.store.layers;
      return { ...l[l.length - 1] } as Record<string, unknown>;
    });

  await page.getByRole('button', { name: 'Add star' }).click();
  expect(await layers()).toBe(9);
  await expect(page.locator('.layer.selected')).toHaveCount(1);

  // Inspector: numeric fields and per-type controls edit the selected layer.
  await page.getByLabel('X', { exact: true }).fill('100');
  await page.getByLabel('Points').fill('8');
  expect(await top()).toMatchObject({ type: 'star', x: 100, n: 8 });

  // Arrow keys nudge (Shift for 10 px); Ctrl D duplicates; [ sends backward.
  await page.locator('.stage-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await top()).toMatchObject({ x: 101, y: 266 });
  await page.keyboard.press('Control+d');
  expect(await layers()).toBe(10);
  await page.keyboard.press('Control+z');
  expect(await layers()).toBe(9);

  // Pointer: drag the star; it snaps to the canvas centre line when dropped near it.
  const drag = async (to: [number, number]): Promise<void> => {
    const pts = await page.evaluate((target) => {
      const cf = window.crestForge!;
      const l = cf.store.layers[cf.store.layers.length - 1];
      const r = cf.editor.canvas.getBoundingClientRect();
      const a = cf.editor.toScreen([l.x, l.y]);
      const b = cf.editor.toScreen(target);
      return { ax: a[0] + r.left, ay: a[1] + r.top, bx: b[0] + r.left, by: b[1] + r.top };
    }, to);
    await page.mouse.move(pts.ax, pts.ay);
    await page.mouse.down();
    await page.mouse.move((pts.ax + pts.bx) / 2, (pts.ay + pts.by) / 2, { steps: 4 });
    await page.mouse.move(pts.bx, pts.by, { steps: 4 });
    await page.mouse.up();
  };
  await drag([258, 120]);
  const moved = await top();
  expect(moved.x).toBe(256); // snapped to the vertical mid-line
  expect(Math.abs((moved.y as number) - 120)).toBeLessThan(2);

  // Select all, delete, undo.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await layers()).toBe(0);
  await page.keyboard.press('Control+z');
  expect(await layers()).toBe(9);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer.selected')).toHaveCount(0);

  // Layers panel: click selects, Shift range-selects, the eye toggles visibility, rename works.
  const rows = page.locator('.layer');
  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('.layer.selected')).toHaveCount(3);
  await rows.nth(0).getByRole('button', { name: 'Hide layer' }).click();
  expect((await top()).visible).toBe(false);
  await rows.nth(0).locator('.name').dblclick();
  await page.getByLabel('Layer name').fill('Hero star');
  await page.keyboard.press('Enter');
  expect((await top()).name).toBe('Hero star');
});

test('golden: the Social Club preview matches the design within 0.15% of pixels', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const cf = window.crestForge!;
    return { all: cf.goldenDiff(cf.fixtures.allTypes()), example: cf.goldenDiff(cf.fixtures.example()) };
  });
  console.log('golden diff', JSON.stringify(result));
  expect(result.all.fraction).toBeLessThan(0.0015);
  expect(result.all.scLayers).toBeGreaterThan(50);
  // The example crest includes text, which becomes rectangles no thinner than 3 px.
  expect(result.example.fraction).toBeLessThan(0.004);
});

test('text becomes rectangles that fit the Social Club budget', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByLabel('Text', { exact: true }).fill('CREW');
  await page.getByLabel('W', { exact: true }).fill('190');
  await page.getByLabel('H', { exact: true }).fill('50');
  const info = await page.evaluate(() => {
    const cf = window.crestForge!;
    const text = cf.store.layers[cf.store.layers.length - 1];
    const res = cf.toSocialClub([text]);
    return {
      n: res.layers.length,
      slugs: [...new Set(res.layers.map((l) => l[0]))],
      diff: cf.goldenDiff([text]).fraction,
    };
  });
  console.log('CREW 190x50 rectangles:', info.n, 'diff', info.diff);
  expect(info.slugs).toEqual(['rectangles/square']);
  expect(info.n).toBeGreaterThan(20);
  expect(info.n).toBeLessThan(400);
  expect(info.diff).toBeLessThan(0.01);
});

test('Tracer A: Auto fills the Social Club budget, never exceeds it, and is one undo step', async ({
  page,
}) => {
  await openApp(page);
  await loadTestPicture(page);
  await expect(page.getByLabel('Auto (max that fits)').first()).toBeChecked();
  // This test is about filling the budget, so turn off the early stop.
  await page.getByLabel('Stop when more shapes stop helping').uncheck();
  await expect(page.locator('.budget')).toContainText(
    'Up to 369 shapes fit, limited by the layer limit (740)',
  );
  await page.getByLabel('Effort').selectOption('fast');
  await page.getByRole('button', { name: 'Trace picture' }).click();
  await expect(page.locator('.status')).toContainText(/Stopped at the (layer limit|save-size budget)/, {
    timeout: 80_000,
  });
  const after = await page.evaluate(() => {
    const cf = window.crestForge!;
    const u = cf.usage(cf.toSocialClub(cf.store.layers).layers);
    return { shapes: cf.store.layers.length, layers: u.layers, bytes: u.bytes, undo: cf.store.history.depth };
  });
  console.log('Tracer A auto:', JSON.stringify(after));
  expect(after.layers).toBeLessThanOrEqual(740);
  expect(after.layers).toBeGreaterThanOrEqual(737); // the worst-case next shape (2 layers) no longer fits
  expect(after.bytes).toBeLessThanOrEqual(960_000);
  expect(after.shapes).toBeGreaterThan(369); // beats the worst-case formula
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.crestForge!.store.layers.length)).toBe(8);
});

test('Tracer A: a fixed count, Stop, and the background default', async ({ page }) => {
  await openApp(page);
  await loadTestPicture(page, true);
  // More than 5% transparent: the background layer defaults to off.
  await expect(page.getByLabel('Background layer')).not.toBeChecked();
  await page.getByLabel('Stop when more shapes stop helping').uncheck();
  await page.getByLabel('Auto (max that fits)').first().uncheck();
  await page.getByLabel('Number of shapes').first().fill('60');
  await page.getByLabel('Detail').selectOption('96');
  await page.getByRole('button', { name: 'Trace picture' }).click();
  await expect(page.locator('.status')).toContainText('Traced 60 shapes', { timeout: 60_000 });
  expect(await page.evaluate(() => window.crestForge!.store.layers.length)).toBe(60);

  await page.getByLabel('Number of shapes').first().fill('1000');
  await page.getByLabel('Effort').selectOption('best');
  await page.getByLabel('Detail').selectOption('256');
  await page.getByRole('button', { name: 'Trace picture' }).click();
  await page.waitForFunction(() => window.crestForge!.store.layers.length > 3);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.status')).toContainText(/Stopped by you/);
  const n = await page.evaluate(() => window.crestForge!.store.layers.length);
  expect(n).toBeGreaterThan(3);
  expect(n).toBeLessThan(1000);
});

test('Export tab: budget, blocking, import script and clipboard fallback', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.locator('.summary')).toContainText(
    /\d+ layers, \d+ KB; room for about \d+ more simple shapes/,
  );
  await page.getByRole('button', { name: 'Copy import script' }).click();
  const script = await page.evaluate(() => navigator.clipboard.readText());
  expect(script).toContain("const VERSION = '1.4.0';");
  expect(script).toContain('"rounds/01"');
  expect(() => new Function(script)).not.toThrow();
  // The preview canvas is painted.
  const painted = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.preview');
    const d = c?.getContext('2d')?.getImageData(0, 0, 512, 512).data;
    let n = 0;
    if (d) for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(20_000);

  // Clipboard refused: the script appears in a read-only textarea, selected.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  });
  await page.getByRole('button', { name: 'Copy import script' }).click();
  const area = page.getByLabel('Import script: copy this text');
  await expect(area).toBeVisible();
  expect(
    await area.evaluate(
      (el: HTMLTextAreaElement) => el.readOnly && el.selectionEnd - el.selectionStart === el.value.length,
    ),
  ).toBe(true);

  // Over the layer limit: copying is blocked with a clear warning.
  await page.evaluate(() => {
    const cf = window.crestForge!;
    const one = cf.fixtures.allTypes()[1];
    cf.store.layers = Array.from({ length: 760 }, (_, i) => ({
      ...one,
      id: 'x' + i,
      x: 20 + (i % 40) * 12,
      y: 20 + Math.floor(i / 40) * 24,
    }));
    cf.store.touch();
  });
  await expect(page.locator('.warnings .over')).toContainText('Over the limit: 760 layers');
  await expect(page.getByRole('button', { name: 'Copy import script' })).toBeDisabled();
});

test('files: SVG, PNG and project JSON download; a project opens again', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Export' }).click();
  for (const [name, file] of [
    ['SVG', 'crest.svg'],
    ['PNG 1024', 'crest-1024.png'],
    ['Save project', 'crest.crestforge.json'],
  ]) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(file);
  }
  const project = JSON.stringify({
    app: 'crest-forge',
    version: 1,
    layers: [{ type: 'ellipse', x: 50, y: 60, w: 70, h: 80, color: '#00ff00' }],
  });
  await page
    .getByLabel('Open a Crest Forge project file')
    .setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(project) });
  await expect(page.locator('.layer')).toHaveCount(1);
  expect(await page.evaluate(() => window.crestForge!.store.layers[0])).toMatchObject({
    type: 'ellipse',
    x: 50,
    w: 70,
    color: '#00ff00',
    opacity: 1,
  });
});

test('autosaves, and still works when storage is unavailable', async ({ page, browser }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add ring' }).click();
  await page.waitForTimeout(700); // debounce is 400 ms
  await page.reload();
  await page.waitForFunction(() => !!window.crestForge);
  await expect(page.locator('.layer')).toHaveCount(9);

  const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const blocked = await context.newPage();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  const problems = await openApp(blocked);
  await blocked.getByRole('button', { name: 'Add ring' }).click();
  await blocked.waitForTimeout(700);
  await expect(blocked.locator('.layer')).toHaveCount(9);
  expect(problems).toEqual([]);
  await context.close();
});

test('phone layout: 400 px wide, no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await openApp(page);
  for (const tab of ['Design', 'Trace image', 'Export']) {
    await page.getByRole('tab', { name: tab }).click();
    const size = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(size.scroll, tab).toBeLessThanOrEqual(size.client);
  }
  const stage = await page.locator('.stage').boundingBox();
  expect(Math.abs((stage?.width ?? 0) - (stage?.height ?? 1))).toBeLessThan(2); // the canvas is a square
  const rail = await page.locator('.rail').boundingBox();
  expect(rail?.height ?? 999).toBeLessThan(110); // the rail is a horizontal strip
});

test('works offline after the first load', async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.crestForge && document.querySelectorAll('.layer').length > 0);
  await expect(page.locator('h1')).toHaveText('Crest Forge');
  await context.setOffline(false);
});

test('by default a simple picture finishes early: the sun is one circle and nothing patches it', async ({
  page,
}) => {
  await openApp(page);
  await loadTestPicture(page);
  await expect(page.getByLabel('Stop when more shapes stop helping')).toBeChecked();
  await page.getByRole('button', { name: 'Trace picture' }).click();
  await expect(page.locator('.status')).toContainText(/Done after \d+ shapes/, { timeout: 80_000 });
  const r = await page.evaluate(() => {
    const cf = window.crestForge!;
    const ls = cf.store.layers;
    // The test picture's sun: centre (140, 60), radius 28 in 200 x 160, fitted to 512.
    const cx = 140 * 2.56;
    const cy = 51.2 + 60 * 2.56;
    const rs = 28 * 2.56;
    const sun = ls.findIndex(
      (l) => l.type === 'ellipse' && Math.hypot(l.x - cx, l.y - cy) < 6 && Math.abs(l.w / 2 - rs) < 8,
    );
    // Layers drawn on top of the sun whose own centre lies well inside it: patches.
    const patches =
      sun < 0 ? -1 : ls.slice(sun + 1).filter((l) => Math.hypot(l.x - cx, l.y - cy) < rs * 0.7).length;
    const detail =
      sun < 0
        ? []
        : ls
            .slice(sun + 1)
            .filter((l) => Math.hypot(l.x - cx, l.y - cy) < rs * 0.7)
            .map((l) => ({
              type: l.type,
              x: Math.round(l.x),
              y: Math.round(l.y),
              w: Math.round(l.w),
              h: Math.round(l.h),
              color: l.color,
              sunColor: ls[sun].color,
            }));
    return { shapes: ls.length, sun, patches, detail, layers: cf.usage(cf.toSocialClub(ls).layers).layers };
  });
  console.log('default trace:', JSON.stringify(r));
  expect(r.sun).toBeGreaterThanOrEqual(0);
  expect(r.patches).toBe(0);
  expect(r.shapes).toBeLessThan(250);
  expect(r.layers).toBeLessThan(400);
});
