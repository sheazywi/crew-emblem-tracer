/**
 * Built-in outline presets. Each is a simple (non self-intersecting) polygon stored as flat local
 * points normalised to -0.5..0.5, original Crest Forge artwork.
 */

type P = [number, number];

function normalise(pts: P[]): number[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const out: number[] = [];
  for (const [x, y] of pts) {
    out.push(+((x - x0) / (x1 - x0) - 0.5).toFixed(4), +((y - y0) / (y1 - y0) - 0.5).toFixed(4));
  }
  return out;
}

function shield(): P[] {
  const pts: P[] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.05],
  ];
  const steps = 6;
  // Right flank curves into a pointed base, then mirrors back up the left flank.
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    pts.push([0.5 * (1 - s * s), 0.05 + 0.45 * s]);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const s = i / steps;
    pts.push([-0.5 * (1 - s * s), 0.05 + 0.45 * s]);
  }
  return pts;
}

function heart(): P[] {
  // Right half of the classic heart curve, from the top cusp (t = 0) to the bottom tip (t = pi).
  const at = (t: number): P => [
    16 * Math.sin(t) ** 3,
    -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
  ];
  const dense: P[] = [];
  const along: number[] = [0];
  for (let i = 0; i <= 600; i++) {
    dense.push(at((i / 600) * Math.PI));
    if (i > 0)
      along.push(along[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  // Sample evenly by arc length: evenly spaced points triangulate without thin slivers, which
  // matters because Social Club cannot draw pieces thinner than 1% of a primitive.
  const segments = 13;
  const right: P[] = [];
  let j = 0;
  for (let s = 0; s <= segments; s++) {
    const want = (along[600] * s) / segments;
    while (j < 600 && along[j] < want) j++;
    right.push(dense[j]);
  }
  right[0] = at(0);
  right[segments] = at(Math.PI);
  const left = right
    .slice(1, segments)
    .reverse()
    .map(([x, y]) => [-x, y] as P);
  return [...right, ...left];
}

const CHEVRON: P[] = [
  [-0.5, 0.1],
  [0, -0.5],
  [0.5, 0.1],
  [0.5, 0.5],
  [0, -0.1],
  [-0.5, 0.5],
];

const ARROW: P[] = [
  [-0.5, -0.2],
  [0.1, -0.2],
  [0.1, -0.5],
  [0.5, 0],
  [0.1, 0.5],
  [0.1, 0.2],
  [-0.5, 0.2],
];

const T = 1 / 6;
const CROSS: P[] = [
  [-T, -0.5],
  [T, -0.5],
  [T, -T],
  [0.5, -T],
  [0.5, T],
  [T, T],
  [T, 0.5],
  [-T, 0.5],
  [-T, T],
  [-0.5, T],
  [-0.5, -T],
  [-T, -T],
];

const BOLT: P[] = [
  [0.1, -0.5],
  [-0.4, 0.08],
  [-0.05, 0.08],
  [-0.2, 0.5],
  [0.4, -0.12],
  [0.05, -0.12],
  [0.3, -0.5],
];

const WING: P[] = [
  [-0.5, 0.0],
  [-0.35, -0.3],
  [-0.05, -0.47],
  [0.3, -0.5],
  [0.5, -0.42],
  [0.28, -0.22],
  [0.42, -0.12],
  [0.15, 0.02],
  [0.3, 0.14],
  [0.0, 0.2],
  [0.1, 0.36],
  [-0.2, 0.3],
  [-0.3, 0.5],
  [-0.5, 0.3],
];

export interface Preset {
  label: string;
  pts: number[];
  w: number;
  h: number;
}

export const PRESETS: Record<string, Preset> = {
  shield: { label: 'Shield', pts: normalise(shield()), w: 200, h: 236 },
  heart: { label: 'Heart', pts: normalise(heart()), w: 200, h: 184 },
  chevron: { label: 'Chevron', pts: normalise(CHEVRON), w: 200, h: 120 },
  arrow: { label: 'Arrow', pts: normalise(ARROW), w: 220, h: 140 },
  cross: { label: 'Cross', pts: normalise(CROSS), w: 180, h: 180 },
  bolt: { label: 'Bolt', pts: normalise(BOLT), w: 130, h: 220 },
  wing: { label: 'Wing', pts: normalise(WING), w: 240, h: 170 },
};
