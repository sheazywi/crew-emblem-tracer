import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildImportScript,
  buildTraceScript,
  SCRIPT_VERSION,
  type TraceScriptOptions,
} from '../src/scripts/build-scripts';
import { CONTRACT, type Packed } from '../src/socialclub/editor-contract';

const lf = (s: string): string => s.replace(/\r\n/g, '\n');
const root = process.cwd();
const importTemplate = lf(readFileSync(join(root, 'src/scripts/import.template.js'), 'utf8'));
const traceTemplate = lf(readFileSync(join(root, 'src/scripts/trace.template.js'), 'utf8'));

const layer = (i: number, name = 'c' + i.toString(36)): Packed => [
  'rounds/01',
  12.34,
  -56.78,
  25,
  -25,
  130.5,
  100,
  '#ffffff',
  false,
  true,
  name,
];
const data = (n: number): Packed[] => Array.from({ length: n }, (_, i) => layer(i));
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const options: TraceScriptOptions = {
  groups: ['curves', 'angles'],
  auto: true,
  count: 740,
  alpha: 0.9,
  res: 128,
  cand: 60,
  mut: 80,
  bg: true,
  dry: false,
  quiet: false,
  minGain: 0,
};

const importScript = lf(buildImportScript(data(80)));
const traceScript = lf(buildTraceScript(PNG, options));

describe('generated console scripts', () => {
  it('are syntactically valid, self-contained async IIFEs', () => {
    for (const script of [importScript, traceScript, lf(buildImportScript(data(740)))]) {
      expect(() => new Function(script)).not.toThrow();
      expect(script).toMatch(/^\/\*[\s\S]*?\*\/\n\(async \(\) => \{\n {2}'use strict';/);
      expect(script.trimEnd().endsWith('})();')).toBe(true);
      expect(script).not.toMatch(/__(DATA|IMG|OPT)__/);
    }
  });

  it('never talk to the network, storage, cookies or the save and publish endpoints', () => {
    const forbidden = [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'sendBeacon',
      'document.cookie',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'emblems/save',
      'emblems/publish',
      'saveEmblem',
      '/publish',
      'eval(',
      'new Function',
      'import(',
      'window.alert =',
      'window.confirm =',
      'RequestVerificationToken',
    ];
    for (const script of [importScript, traceScript]) {
      for (const word of forbidden) expect(script.includes(word), word).toBe(false);
      // No script-driven clicks at all, so Save and Publish can only be pressed by the user.
      expect(script).not.toMatch(/\.click\(|dispatchEvent|\.submit\(/);
      // The only dialogs are real alert/confirm calls, never reassigned.
      expect(script).not.toMatch(/\b(alert|confirm|prompt)\s*=[^=]/);
    }
  });

  it('carry a version banner that matches the package version', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(SCRIPT_VERSION).toBe(pkg.version);
    for (const script of [importScript, traceScript]) {
      expect(script).toContain(`const VERSION = '${pkg.version}';`);
      expect(script).toContain("const TAG = 'Crest Forge v' + VERSION;");
      expect(script).toMatch(/console\.log\(TAG \+ ' - (import|trace) script'/);
    }
  });

  it('use the same limits as editor-contract.ts', () => {
    const num = (script: string, name: string): number => {
      const m = new RegExp(`const ${name} = ([0-9.]+);`).exec(script);
      if (!m) throw new Error(`${name} not found`);
      return Number(m[1]);
    };
    expect(num(importTemplate, 'LAYERS_MAX')).toBe(CONTRACT.layersMax);
    expect(num(importTemplate, 'SAVE_MAX')).toBe(CONTRACT.saveMax);
    expect(num(traceTemplate, 'CANVAS')).toBe(CONTRACT.canvas);
    expect(num(traceTemplate, 'LAYERS_AUTO')).toBe(CONTRACT.layersAuto);
    expect(num(traceTemplate, 'SAVE_AUTO')).toBe(CONTRACT.saveAuto);
    expect(num(traceTemplate, 'SAVE_MAX')).toBe(CONTRACT.saveMax);
    expect(num(traceTemplate, 'PATH_MAX')).toBe(CONTRACT.tracePathMax);
    expect(num(traceTemplate, 'PATH_MAX_ALL')).toBe(CONTRACT.tracePathMaxAll);
    expect(num(traceTemplate, 'SCALE_MIN')).toBe(CONTRACT.scaleMin);
    expect(num(traceTemplate, 'SCALE_MAX')).toBe(CONTRACT.traceScaleMax);
    for (const t of [importTemplate, traceTemplate]) {
      expect(t).toContain(`'${CONTRACT.groupPrefix}'`);
      expect(t).toContain('(4 / 3) * (742 + 1.2 * pathLen');
    }
  });

  it('inject data with a function replacer, so $ sequences are never interpreted', () => {
    const nasty = "$& $1 $' $` $$ __DATA__";
    const script = buildImportScript([layer(0, nasty)]);
    expect(script).toContain(JSON.stringify([layer(0, nasty)]));
    expect(() => new Function(script)).not.toThrow();
  });

  it('have exactly one injection point per placeholder', () => {
    expect(importTemplate.split('__DATA__')).toHaveLength(2);
    expect(traceTemplate.split('__IMG__')).toHaveLength(2);
    expect(traceTemplate.split('__OPT__')).toHaveLength(2);
    expect(traceScript).toContain(`const IMG = ${JSON.stringify(PNG)};`);
    expect(traceScript).toContain(`const OPT = ${JSON.stringify(options)};`);
  });

  it('validate what goes into the trace script', () => {
    expect(() => buildTraceScript('https://example.com/a.png', options)).toThrow(/PNG data URL/);
    expect(() => buildTraceScript(PNG, { ...options, groups: [] })).toThrow(/shape family/);
    expect(() => buildTraceScript(PNG, { ...options, groups: ['../x', 'a b'] })).toThrow(/shape family/);
    const clamped = buildTraceScript(PNG, {
      ...options,
      groups: 'all',
      count: 99999,
      alpha: 5,
      res: 4096,
      cand: 1e6,
      mut: -3,
    });
    expect(clamped).toContain(
      '"groups":"all","auto":true,"count":740,"alpha":1,"res":256,"cand":400,"mut":1,',
    );
    expect(() => buildImportScript([])).toThrow(/Nothing to export/);
  });

  it('stay small enough to paste', () => {
    const sizes = {
      importTemplate: importTemplate.length,
      traceTemplate: traceTemplate.length,
      import80: importScript.length,
      import740: lf(buildImportScript(data(740))).length,
    };
    expect(sizes.import80).toBeLessThan(20_000);
    expect(sizes.import740).toBeLessThan(110_000);
    expect(sizes.traceTemplate).toBeLessThan(40_000);
    expect(sizes).toMatchSnapshot();
  });
});
