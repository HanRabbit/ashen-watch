import type { Box, NavEdge, NavNode } from './level';

interface Point { readonly x: number; readonly z: number }
interface Crest extends Point { readonly h: number }

export const BAILEY_GROUND_Y = 0;
// Embed the apron foundation into the valley floor (terrain shelf at -.62 m).
export const BAILEY_SLAB_BOTTOM = -.79;
export const BAILEY_FABRIC_BOTTOM = -.08;
export const BAILEY_PORTAL = {
  x0: -11.18, x1: -10, z0: 4.65, z1: 9.32, bearing: 3.70, soffit: 3.42,
} as const;

export const BAILEY_WING_SEAM_Z = 8.20;

// A→I follows the old drum, from the curtain to the surviving south wall of
// the west wing. I→J and J→A are flush joins to the existing slabs.
export const BAILEY_OUTLINE = [
  { x: -10.50, z: .72 }, { x: -12.35, z: .72 }, { x: -14.96, z: .92 },
  { x: -17.18, z: 1.78 }, { x: -18.52, z: 3.12 }, { x: -18.93, z: 4.62 },
  { x: -18.69, z: 5.88 }, { x: -17.92, z: 7.04 }, { x: -16.10, z: BAILEY_WING_SEAM_Z },
  { x: -10.50, z: BAILEY_WING_SEAM_Z },
] as const satisfies readonly Point[];

const INNER_FACE: readonly Point[] = [
  { x: -10.50, z: 1.73 }, { x: -12.29, z: 1.62 }, { x: -14.72, z: 1.90 },
  { x: -16.57, z: 2.66 }, { x: -17.61, z: 3.67 }, { x: -18.00, z: 4.65 },
  { x: -17.79, z: 5.55 }, { x: -17.24, z: 6.36 }, { x: -14.86, z: BAILEY_WING_SEAM_Z },
];
// Station fractions and surviving masonry heights. Paired close stations are
// breaks in the courses, with broad intact shoulders at the two wall junctions.
const CRESTS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 3.1], [.29, 3.08], [.34, 2.58], [.71, 2.46], [.81, 1.65], [1, 1.61]],
  [[0, 1.61], [.22, 1.58], [.28, .98], [.70, .91], [.76, 1.31], [1, 1.36]],
  [[0, 1.36], [.32, 1.29], [.39, .86], [.72, .82], [.83, 1.52], [1, 1.63]],
  [[0, 1.63], [.31, 1.69], [.40, 2.36], [.73, 2.43], [.84, 2.91], [1, 2.96]],
  [[0, 2.96], [.36, 2.91], [.45, 2.45], [.76, 2.51], [1, 2.20]],
  [[0, 2.20], [.28, 2.18], [.38, 1.59], [.68, 1.49], [.82, .96], [1, .89]],
  [[0, .89], [.45, .82], [.54, 1.20], [.79, 1.24], [1, 1.51]],
  [[0, 1.51], [.28, 1.53], [.35, 2.02], [.62, 2.06], [.71, 2.48], [1, 2.52]],
];

function along(a: Point, b: Point, t: number, h: number): Crest {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h };
}

/** The top of each panel is triangulated 0→2 in the render and proxy builders. */
export const BAILEY_WALL_PANELS = CRESTS.flatMap((profile, edge) => {
  const stations = profile.map(([t, h]) => ({
    outer: along(BAILEY_OUTLINE[edge], BAILEY_OUTLINE[edge + 1], t, h),
    inner: along(INNER_FACE[edge], INNER_FACE[edge + 1], t, h - (.08 + .06 * Math.sin(edge * 1.17 + t * 18) * Math.sin(t * Math.PI))),
  }));
  return stations.slice(1).map((end, i) => {
    const start = stations[i];
    return { edge, corners: [start.outer, end.outer, end.inner, start.inner] as const };
  });
});

function wall(tag: string, x0: number, z0: number, x1: number, z1: number, h: number, y0 = 0): Box {
  return { kind: 'wall', los: true, tag, x0, z0, x1, z1, y0, h };
}

// Full-depth corbels and a continuous bearing course under the original 2F
// deck. The existing west wing return acts as the outside jamb on the north.
const p = BAILEY_PORTAL;
const corbels = [[2.38, 2.62, .20], [2.62, 2.87, .43], [2.87, 3.08, .72], [3.08, 3.27, 1.03], [3.27, p.soffit, 1.30]] as const;
export const BAILEY_PORTAL_HEAD: readonly Box[] = [
  ...corbels.flatMap(([base, top, end]) => [
    wall('baileyPortal', p.x0, p.z0, p.x1, p.z0 + end, top, base),
    wall('baileyPortal', p.x0, p.z1 - end, p.x1, p.z1, top, base),
  ]),
  wall('baileyPortal', p.x0, p.z0, p.x1, p.z1, p.bearing, p.soffit),
];
export const BAILEY_PORTAL_JAMB = wall('baileyPortal', p.x0, 3.94, -10.50, p.z0, p.bearing);

export function baileyCeilingY(x: number, z: number): number {
  if (x < p.x0 || x > -8.4 || z < p.z0 || z > p.z1) return Infinity;
  return BAILEY_PORTAL_HEAD.find((b) => x <= b.x1 && z >= b.z0 && z <= b.z1)?.y0 ?? p.bearing;
}

// Every section of the ground or of an individual wall panel is a single
// interval. Find its ends, including any crease in the triangulated crest.
function section(polygon: readonly Crest[], scanZ: number, crest = false): Crest[] {
  const hits: Crest[] = [];
  const intersect = (a: Crest, b: Crest): void => {
    if (scanZ < Math.min(a.z, b.z) || scanZ > Math.max(a.z, b.z)) return;
    if (a.z === b.z) { hits.push(a, b); return; }
    const t = (scanZ - a.z) / (b.z - a.z);
    hits.push(along(a, b, t, a.h + (b.h - a.h) * t));
  };
  polygon.forEach((a, i) => intersect(a, polygon[(i + 1) % polygon.length]));
  if (crest) intersect(polygon[0], polygon[2]);
  return hits;
}

const GROUND_CREST = BAILEY_OUTLINE.map((v) => ({ ...v, h: BAILEY_GROUND_Y }));
const BAILEY_Z_MIN = BAILEY_OUTLINE[0].z;
export function baileyGroundContains(x: number, z: number): boolean {
  if (z < BAILEY_Z_MIN || z > BAILEY_WING_SEAM_Z || x < BAILEY_OUTLINE[5].x || x > BAILEY_OUTLINE[0].x) return false;
  const hits = section(GROUND_CREST, z);
  return x >= Math.min(...hits.map((v) => v.x)) - 1e-8 && x <= Math.max(...hits.map((v) => v.x)) + 1e-8;
}

// Collision, cameras and offline transport all consume the same conservative
// AABB strips. Preserve every outline vertex at a strip boundary. Foot support
// and the visible surface use the exact polygon instead of the strips.
function proxies(polygon: readonly Crest[], maxStrip: number, crest = false): Box[] {
  const transpose = crest && Math.abs(polygon[1].x - polygon[0].x) > Math.abs(polygon[1].z - polygon[0].z);
  const scan = transpose ? polygon.map(({ x, z, h }) => ({ x: z, z: x, h })) : polygon;
  const breaks = [...new Set(scan.map(({ z }) => z))].sort((a, b) => a - b);
  const boxes: Box[] = [];
  for (let i = 1; i < breaks.length; i++) {
    const start = breaks[i - 1], end = breaks[i];
    const count = Math.ceil((end - start) / maxStrip);
    for (let j = 0; j < count; j++) {
      const lo = start + (end - start) * j / count;
      const hi = j === count - 1 ? end : start + (end - start) * (j + 1) / count;
      const hits = [...section(scan, lo, crest), ...section(scan, hi, crest)];
      const near = Math.min(...hits.map(({ x }) => x)), far = Math.max(...hits.map(({ x }) => x));
      if (hi - lo < 1e-8 || far - near < 1e-8) continue;
      const bounds = transpose ? { x0: lo, x1: hi, z0: near, z1: far } : { x0: near, x1: far, z0: lo, z1: hi };
      boxes.push({ ...bounds, los: true, h: Math.max(...hits.map(({ h }) => h)),
        ...(crest ? { kind: 'wall', tag: 'baileyRuin', y0: BAILEY_FABRIC_BOTTOM } : { kind: 'slab', tag: 'baileySlab', y0: BAILEY_SLAB_BOTTOM }),
      });
    }
  }
  return boxes;
}

export const BAILEY_SLAB_PROXIES: readonly Box[] = proxies(GROUND_CREST, .18);
export const BAILEY_WALL_PROXIES: readonly Box[] = BAILEY_WALL_PANELS.flatMap(({ corners }) => proxies(corners, .18, true));
export const BAILEY_FABRIC: readonly Box[] = [BAILEY_PORTAL_JAMB, ...BAILEY_PORTAL_HEAD, ...BAILEY_WALL_PROXIES];

/** Used by curtain detailing to retire the blind buttress across this bay. */
export function isBaileyPortalSpan(z: number): boolean {
  return z >= p.z0 && z <= p.z1;
}

export function isBaileyApronFabric({ tag }: Pick<Box, 'tag'>): boolean {
  return tag === 'baileyPortal' || tag === 'baileyRuin';
}
export function isBaileyApronSlab({ tag }: Pick<Box, 'tag'>): boolean {
  return tag === 'baileySlab';
}

const nav = (id: string, x: number, z: number): NavNode => ({ id, x, z, y: BAILEY_GROUND_Y, floor: '1F', region: 'courtyard' });
const mainApproach = nav('c_bailey_inner', -8.24, 8.37);
const outerApproach = nav('c_bailey_outer', -11.42, 8.37);
const returnTurn = nav('c_bailey_turn', -11.46, 7.40);
export const BAILEY_STOPS = {
  southPlinth: { ...nav('c_bailey_plinth', -14.70, 2.57), lookAt: { x: -8.20, z: 9.02 } },
  drum: { ...nav('c_bailey_drum', -17.07, 4.68), lookAt: { x: -8.20, z: 8.74 } },
  wingReturn: { ...nav('c_bailey_return', -15.81, 6.44), lookAt: { x: -8.20, z: 8.44 } },
};
const { southPlinth, drum, wingReturn } = BAILEY_STOPS;
export const BAILEY_NODES: readonly NavNode[] = [mainApproach, outerApproach, returnTurn, southPlinth, drum, wingReturn];
export const BAILEY_EDGES: readonly NavEdge[] = [
  { a: 'c_sw', b: mainApproach.id }, { a: 'c_ws_inner', b: mainApproach.id },
  { a: mainApproach.id, b: outerApproach.id },
  { a: outerApproach.id, b: returnTurn.id },
  { a: returnTurn.id, b: wingReturn.id }, { a: returnTurn.id, b: southPlinth.id },
  { a: wingReturn.id, b: drum.id }, { a: southPlinth.id, b: drum.id },
];
