import { RING_SLUGS } from './editor-contract';

/** Overlap between stacked rings, canvas px, so no hairline shows between them. */
export const RING_OVERLAP_PX = 1.2;

export interface RingStack {
  slug: string;
  /** Hole/outer ratio of the chosen ring slug. */
  ratio: number;
  /** Outer radius of each stacked ring as a fraction of the wanted outer radius, outside in. */
  outers: number[];
  /** The hole ratio actually produced (equals the request unless it had to be clamped). */
  hole: number;
}

/**
 * Build a ring with hole ratio `k` from one ring slug.
 *
 * Pick the slug with the smallest ratio rho that is still >= k. Stack from the outside in: the
 * first ring has outer radius 1, each next ring's outer radius is the previous hole plus an
 * overlap, and the last ring has outer radius k / rho so its hole is exactly k.
 *
 * The overlap is RING_OVERLAP_PX, but never more than half the thickness of the ring it
 * overlaps: thin ring slugs (ratio 0.99) are thinner than 1.2 px at most sizes, and a larger
 * overlap would stop the stack from ever moving inward.
 */
export function ringStack(k: number, outerRadiusPx: number): RingStack {
  const maxRatio = RING_SLUGS[RING_SLUGS.length - 1].ratio;
  const hole = Math.min(Math.max(k, 0.001), maxRatio);
  const pick = RING_SLUGS.find((r) => r.ratio >= hole - 1e-9) ?? RING_SLUGS[RING_SLUGS.length - 1];
  const rho = pick.ratio;
  const eps = RING_OVERLAP_PX / Math.max(outerRadiusPx, 1e-6);
  const outers: number[] = [];
  let o = 1;
  for (let guard = 0; guard < 256; guard++) {
    if (o * rho <= hole + 1e-9) {
      outers.push(Math.min(1, hole / rho));
      break;
    }
    outers.push(o);
    o = o * rho + Math.min(eps, 0.5 * o * (1 - rho));
  }
  return { slug: pick.slug, ratio: rho, outers, hole };
}
