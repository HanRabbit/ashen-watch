import type { Box, NavEdge, NavNode, Rect } from './level';

export interface NorthPoint { x: number; z: number }
interface CrownPoint extends NorthPoint { h: number }

export const NORTH_OPENING = { x0: -2.5, x1: 7.5, z0: 28.5, z1: 29 } as const;
export const NORTH_WALK_BEARING = 3.7;
const ARCH_DEPTH = { z0: 27.32, z1: 29.14 };
export const NORTH_SLAB_BOTTOM = -0.82;

export const NORTH_PIERS: readonly Box[] = [
  [-2.5, -1.80], [1.82, 2.92], [6.76, 7.5],
].map(([x0, x1]) => ({ x0, x1, ...ARCH_DEPTH, y0: 0, h: NORTH_WALK_BEARING, kind: 'wall', los: true, tag: 'northPier' }));

/** Each entry is an actual barrel section, from spring to crown and back. */
export const NORTH_ARCHES = NORTH_PIERS.slice(1).map((right, bay) => {
  const x0 = NORTH_PIERS[bay].x1, x1 = right.x0;
  const spring = 2.15, rise = 1.19;
  const profile = Array.from({ length: 17 }, (_, i) => {
    const angle = Math.PI * i / 16;
    return { x: x0 + (x1 - x0) * (1 - Math.cos(angle)) / 2, h: spring + rise * Math.sin(angle) };
  });
  return { ...ARCH_DEPTH, x0, x1, center: (x0 + x1) / 2, profile };
});

const archHeads: Box[] = NORTH_ARCHES.flatMap(({ profile, z0, z1 }) => profile.slice(1).map((right, i) => ({
  x0: profile[i].x, x1: right.x, z0, z1, y0: Math.min(profile[i].h, right.h),
  h: NORTH_WALK_BEARING, kind: 'wall', los: true, tag: 'northArch',
})));

/** The outer survey and paired inner corners are the two faces of the same
 * thick curtain. The first and last pair close against the original wall. */
const corners = [
  { outer: { x: NORTH_OPENING.x0, z: NORTH_OPENING.z1 }, inner: { x: -1.62, z: NORTH_OPENING.z1 }, h: 2.92 },
  { outer: { x: -5.10, z: 32.65 }, inner: { x: -3.91, z: 32.79 }, h: 3.82 },
  { outer: { x: -3.42, z: 36.45 }, inner: { x: -2.65, z: 35.54 }, h: 5.05 },
  { outer: { x: 1.22, z: 37.10 }, inner: { x: 1.07, z: 36.01 }, h: 1.32 },
  { outer: { x: 5.60, z: 34.96 }, inner: { x: 5.05, z: 34.13 }, h: 2.39 },
  { outer: { x: 8.68, z: 32.10 }, inner: { x: 7.53, z: 31.86 }, h: 3.25 },
  { outer: { x: NORTH_OPENING.x1, z: NORTH_OPENING.z1 }, inner: { x: 6.48, z: NORTH_OPENING.z1 }, h: 3.42 },
] as const;

export const NORTH_OUTLINE: readonly NorthPoint[] = corners.map(({ outer }) => outer);
const NORTH_LIMIT = Math.max(...NORTH_OUTLINE.map(({ z }) => z));

// Intermittent steep fractures, shallow shoulders and exposed low wall cores.
// Only these silhouette stations add geometry: the curtain is solid masonry.
const crowns: readonly (readonly (readonly [t: number, h: number])[])[] = [
  [[.28, 2.50], [.51, 2.64], [.67, 3.70], [.89, 4.12]],
  [[.21, 3.64], [.39, 2.60], [.56, 2.75], [.79, 4.16], [.95, 4.30]],
  [[.18, 6.62], [.34, 5.68], [.42, 5.76], [.55, 4.73], [.63, 4.84], [.69, 3.29], [.83, 3.03], [.91, 1.50]],
  [[.18, 0.95], [.39, 0.83], [.57, 1.11], [.69, 1.00], [.85, 2.35]],
  [[.20, 2.15], [.40, 1.77], [.55, 1.83], [.72, 2.75], [.91, 2.88]],
  [[.19, 3.68], [.44, 3.73], [.69, 2.90], [.83, 2.84]],
];

function station(a: NorthPoint, b: NorthPoint, t: number, h: number): CrownPoint {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h };
}

export const NORTH_WALL_PANELS = crowns.flatMap((edge, i) => {
  const a = corners[i], b = corners[i + 1];
  const stations = [[0, a.h] as const, ...edge, [1, b.h] as const].map(([t, h]) => ({
    outer: station(a.outer, b.outer, t, h), inner: station(a.inner, b.inner, t, h - (t === 0 || t === 1 ? .10 : .12 + .11 * Math.sin(t * 19 + i))),
  }));
  return stations.slice(1).map((end, j) => {
    const start = stations[j];
    return { edge: i, footprint: [start.outer, end.outer, end.inner, start.inner] };
  });
});

/** Convex polygon cross-section for exact foot support and bounded camera/LOS
 * proxies. Split at vertex elevations in plan so every strip is conservative. */
function crossSection(polygon: readonly (NorthPoint & { h?: number })[], z: number, triangulated = false): { x: number; h: number }[] {
  const hits: { x: number; h: number }[] = [];
  const intersect = (a: (typeof polygon)[number], b: (typeof polygon)[number]): void => {
    if (z < Math.min(a.z, b.z) || z > Math.max(a.z, b.z)) return;
    const ah = a.h ?? 0, bh = b.h ?? 0;
    if (a.z === b.z) { hits.push({ x: a.x, h: ah }, { x: b.x, h: bh }); return; }
    const t = (z - a.z) / (b.z - a.z);
    hits.push({ x: a.x + (b.x - a.x) * t, h: ah + (bh - ah) * t });
  };
  for (let i = 0; i < polygon.length; i++) intersect(polygon[i], polygon[(i + 1) % polygon.length]);
  // Crest quads are triangulated 0→2. Include the fold in the maximum height.
  if (triangulated) intersect(polygon[0], polygon[2]);
  return hits;
}

function strips(polygon: readonly (NorthPoint & { h?: number })[], maxDepth: number, wall = false): (Rect & { h: number })[] {
  // Scan along the longer direction. At a horizontal fracture this keeps the
  // strip tight to the wall instead of filling an entire wedge on either side.
  const swap = wall && Math.abs(polygon[1].x - polygon[0].x) > Math.abs(polygon[1].z - polygon[0].z);
  const scan = swap ? polygon.map((p) => ({ x: p.z, z: p.x, h: p.h })) : polygon;
  const breaks = scan.map((p) => p.z);
  const start = Math.min(...breaks), end = Math.max(...breaks);
  const count = Math.ceil((end - start) / maxDepth);
  return Array.from({ length: count }, (_, i) => {
    const lo = start + (end - start) * i / count;
    const hi = i === count - 1 ? end : start + (end - start) * (i + 1) / count;
    const hits = [lo, hi, ...breaks.filter((v) => lo < v && v < hi)].flatMap((v) => crossSection(scan, v, wall));
    const left = Math.min(...hits.map((p) => p.x)), right = Math.max(...hits.map((p) => p.x));
    const h = Math.max(...hits.map((p) => p.h));
    return swap ? { x0: lo, x1: hi, z0: left, z1: right, h } : { x0: left, x1: right, z0: lo, z1: hi, h };
  });
}

export function northGroundContains(x: number, z: number): boolean {
  if (z < NORTH_OPENING.z1 || z > NORTH_LIMIT) return false;
  const hits = crossSection(NORTH_OUTLINE, z);
  return x >= Math.min(...hits.map((p) => p.x)) && x <= Math.max(...hits.map((p) => p.x));
}

export const NORTH_SLAB_PROXIES: readonly Box[] = strips(NORTH_OUTLINE, 0.24)
  .map((r) => ({ ...r, y0: NORTH_SLAB_BOTTOM, kind: 'slab', los: true, tag: 'northSlab' }));

const wallProxies: Box[] = NORTH_WALL_PANELS.flatMap(({ footprint }) => strips(footprint, 0.31, true)
  .map((r) => ({ ...r, y0: 0, kind: 'wall', los: true, tag: 'northRuin' })));

/** Box and mesh use the same posts, spindles, sill and rails. The gaps are
 * smaller than the actor's diameter and remain open to sight and to picking. */
export function northGuard(deckY: number): Box[] {
  const { x0, x1 } = NORTH_OPENING, z = 28.73;
  const piece = (tag: string, a: number, b: number, depth: number, low: number, high: number): Box =>
    ({ x0: a, x1: b, z0: z - depth / 2, z1: z + depth / 2, y0: deckY + low, h: deckY + high, kind: 'wall', los: true, tag });
  const posts = [x0 + .1, -.10, 2.37, 4.90, x1 - .1];
  const bars = posts.slice(1).flatMap((end, i) => {
    const start = posts[i];
    return Array.from({ length: 6 }, (_, j) => {
      const x = start + (end - start) * (j + 1) / 7;
      return piece('northIron', x - .021, x + .021, .052, .12, .89);
    });
  });
  return [piece('northSill', x0, x1, .41, 0, .14),
    piece('northIron', x0, x1, .068, .28, .33), piece('northWood', x0, x1, .15, .87, .98),
    ...posts.map((x) => piece('northIron', x - .071, x + .071, .14, .08, 1.03)), ...bars];
}

export function isNorthCourtFabric(w: Box): boolean {
  return w.tag?.startsWith('north') ?? false;
}
export const NORTH_LOWER_FABRIC: readonly Box[] = [...NORTH_PIERS, ...archHeads, ...wallProxies];

export function northCeilingY(x: number, z: number): number {
  if (z < ARCH_DEPTH.z0 || z > ARCH_DEPTH.z1) return Infinity;
  for (const arch of NORTH_ARCHES) {
    if (x <= arch.x0 || x >= arch.x1) continue;
    const i = arch.profile.findIndex((p) => p.x >= x);
    const a = arch.profile[i - 1], b = arch.profile[i];
    return a.h + (b.h - a.h) * (x - a.x) / (b.x - a.x);
  }
  return Infinity;
}

export const NORTH_COURT_POINTS = {
  westMouth: { x: NORTH_ARCHES[0].center, z: 25.40 },
  westLanding: { x: NORTH_ARCHES[0].center, z: 30.44 },
  westBend: { x: -1.70, z: 33.13 },
  lookout: { x: .32, z: 35.14 },
  eastBend: { x: 3.95, z: 33.03 },
  eastLanding: { x: NORTH_ARCHES[1].center, z: 30.42 },
  eastMouth: { x: NORTH_ARCHES[1].center, z: 25.45 },
} as const;

export const NORTH_NODES: readonly NavNode[] = Object.entries(NORTH_COURT_POINTS).map(([name, p]) => ({
  id: `c_north_${name}`, ...p, y: 0, floor: '1F', region: 'courtyard',
}));
export const NORTH_EDGES: readonly NavEdge[] = [
  { a: 'c_n', b: NORTH_NODES[0].id }, { a: 'c_ne', b: NORTH_NODES[NORTH_NODES.length - 1].id },
  ...NORTH_NODES.slice(1).map(({ id }, i) => ({ a: NORTH_NODES[i].id, b: id })),
];
