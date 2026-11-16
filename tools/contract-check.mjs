// `pnpm contract:check` - writes a read-only console snippet that re-measures the editor contract.
//
// The check has to run in a signed-in browser tab, and Crest Forge never handles credentials, so
// this tool does not open a browser or log in. It only generates the snippet; a maintainer
// pastes it into their own editor tab. See docs/editor-contract.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/socialclub/editor-contract.ts'), 'utf8');

const number = (name) => {
  const m = new RegExp(`${name}:\\s*([0-9_.]+(?:\\s*/\\s*[0-9.]+)?)`).exec(source);
  if (!m) throw new Error(`editor-contract.ts: ${name} not found`);
  const [a, b] = m[1].replace(/_/g, '').split('/').map(Number);
  return b ? a / b : a;
};
const text = (name) => {
  const m = new RegExp(`${name}:\\s*'([^']*)'`).exec(source);
  if (!m) throw new Error(`editor-contract.ts: ${name} not found`);
  return m[1];
};

// The primitives, kept in step with PRIMS by tests/contract.test.ts.
const prims = {
  'rectangles/square': { w: 300, h: 300 },
  'rounds/01': { w: 300, h: 300 },
  'angles/03': {
    w: 159,
    h: 300,
    pts: [
      [0, 300],
      [158.91, 300],
      [79.457, 0],
    ],
  },
  'angles/05': {
    w: 192,
    h: 300,
    pts: [
      [192, 300],
      [0, 300],
      [192, 0],
    ],
  },
  'polygons/04': {
    w: 300,
    h: 260,
    pts: [
      [75, 0],
      [225, 0],
      [300, 129.9],
      [225, 259.8],
      [75, 259.8],
      [0, 129.9],
    ],
  },
  'rounds/67': { w: 300, h: 300, ratio: 0.9933 },
  'rounds/68': { w: 300, h: 300, ratio: 0.9667 },
  'rounds/69': { w: 300, h: 300, ratio: 0.9333 },
  'rounds/70': { w: 300, h: 300, ratio: 0.8333 },
  'rounds/13': { w: 300, h: 300, ratio: 0.3183 },
  'rounds/14': { w: 288, h: 288, ratio: 0.4887 },
};

export function buildContractCheck() {
  const contract = {
    build: text('build'),
    canvas: number('canvas'),
    costBase: number('costBase'),
    costPerPathChar: number('costPerPathChar'),
    costBase64: number('costBase64'),
    noPathLen: 67,
    groupPrefix: text('groupPrefix'),
    prims,
  };
  const template = readFileSync(join(root, 'tools/contract-check.console.js'), 'utf8');
  return template.replace('__CONTRACT__', () => JSON.stringify(contract));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(root, 'dist-tools', 'contract-check.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildContractCheck());
  console.log(`Wrote ${out}`);
  console.log('');
  console.log('1. Sign in to Social Club yourself and open the emblem editor with a throwaway emblem.');
  console.log('2. Optionally import a design with the Crest Forge import script (do not save yet).');
  console.log('3. Paste the contents of that file into the DevTools console and press Enter.');
  console.log(
    '4. Every row should say "yes". Fix editor-contract.ts and docs/editor-contract.md for any "NO".',
  );
  console.log('');
  console.log('The snippet is read-only: it never saves, publishes or sends anything.');
}
