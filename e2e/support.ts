import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Packed = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
  boolean,
  boolean,
  string,
];

export interface HarnessLayer {
  slug: string;
  name: string;
  type: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  _rotation: number;
  opacity: number;
  color: string;
  invertedX: boolean;
  invertedY: boolean;
  transform: string;
}

export interface Dialog {
  type: string;
  message: string;
}

export const harnessUrl = (query = ''): string =>
  pathToFileURL(join(process.cwd(), 'e2e', 'harness', 'editor.html')).href + query;

/** Open the app and wait until it has rendered. Fails the test on any page error. */
export async function openApp(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.crestForge && document.querySelectorAll('.layer').length > 0);
  return problems;
}

/**
 * Open the fake editor and record everything a console script must not do: dialogs are answered
 * with `accept`, real network requests are collected.
 */
export async function openHarness(
  page: Page,
  query = '',
  accept = true,
): Promise<{ dialogs: Dialog[]; requests: string[] }> {
  const dialogs: Dialog[] = [];
  const requests: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    void (accept ? d.accept() : d.dismiss());
  });
  await page.goto(harnessUrl(query));
  await page.waitForFunction(() => '__harness' in window);
  page.on('request', (r) => {
    if (/^(https?|wss?):/.test(r.url())) requests.push(r.url());
  });
  return { dialogs, requests };
}

export const snapshot = (page: Page): Promise<HarnessLayer[]> =>
  page.evaluate(() =>
    (window as unknown as { __harness: { snapshot(): HarnessLayer[] } }).__harness.snapshot(),
  );

export const audit = (page: Page): Promise<{ net: number; storage: number; cookie: number }> =>
  page.evaluate(
    () => (window as unknown as { __audit: { net: number; storage: number; cookie: number } }).__audit,
  );

/** The harness must be exactly as a well-behaved script leaves it. */
export async function expectClean(page: Page, requests: string[]): Promise<void> {
  expect(await audit(page)).toEqual({ net: 0, storage: 0, cookie: 0 });
  expect(requests).toEqual([]);
  // No leftover UI, and nothing stored in the page beyond the documented dry-run variable.
  expect(await page.evaluate(() => document.querySelectorAll('[role="status"]').length)).toBe(0);
  const globals = await page.evaluate(() => Object.keys(window).filter((k) => /crest/i.test(k)));
  expect(globals.filter((k) => k !== '__crestForgeTrace')).toEqual([]);
}

/** A small test picture, drawn in the page: gradient sky, a sun, a hill and a transparent corner. */
export async function loadTestPicture(page: Page, transparentCorner = false): Promise<void> {
  await page.evaluate(async (corner) => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 160;
    const g = c.getContext('2d');
    if (!g) throw new Error('no canvas');
    const sky = g.createLinearGradient(0, 0, 0, 160);
    sky.addColorStop(0, '#1b3a6b');
    sky.addColorStop(1, '#f2a65a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 200, 160);
    g.fillStyle = '#ffe9a8';
    g.beginPath();
    g.arc(140, 60, 28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#20402b';
    g.beginPath();
    g.moveTo(0, 160);
    g.quadraticCurveTo(70, 70, 200, 160);
    g.fill();
    g.fillStyle = '#c0392b';
    g.fillRect(30, 30, 40, 24);
    if (corner) g.clearRect(0, 0, 90, 70);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    window.crestForge?.loadPicture(blob);
  }, transparentCorner);
  await page.waitForFunction(() => !!window.crestForge?.tracer.image);
  await expect(page.getByText(/Picture loaded: 200 × 160 px/)).toBeVisible();
}
