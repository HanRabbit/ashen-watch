import { BAILEY_PORTAL, BAILEY_WING_SEAM_Z } from './baileyApron';
import type { Box, Rect } from './level';

/** Survey of the roofless west wing. These are slab extents, including wall feet.
 * The old curtain line survives as the upper walk and the arcade carrying it. */
export const MAIN_COURT: Rect = { x0: -10.5, z0: 0, x1: 10.5, z1: 29 };
export const WEST_COURT = {
  south: { x0: -16.1, z0: BAILEY_WING_SEAM_Z, x1: MAIN_COURT.x0, z1: 16.55 },
  north: { x0: -18.2, z0: 16.55, x1: MAIN_COURT.x0, z1: 25.2 },
} as const satisfies Record<string, Rect>;
export const COURT_FOOTPRINT: readonly Rect[] = [MAIN_COURT, WEST_COURT.south, WEST_COURT.north];

export const WEST_WALL_FACE = -10;
export const WEST_PASSAGES = [
  { id: 'south', z0: 10.25, z1: 13.45 },
  { id: 'north', z0: 19.05, z1: 22.05 },
] as const;
export const WEST_WALK_BEARING = 3.7;
const WEST_JAMB_BACK = -11.15;

const fabric = (tag: string, x0: number, z0: number, x1: number, z1: number, h: number, y0 = 0): Box =>
  ({ x0, z0, x1, z1, h, y0, kind: 'wall', los: true, tag });
const curtain = (z0: number, z1: number): Box =>
  ({ x0: MAIN_COURT.x0, z0, x1: WEST_WALL_FACE, z1, h: 4, kind: 'wall', los: true });

export const WEST_CURTAIN: readonly Box[] = [
  curtain(MAIN_COURT.z0, BAILEY_PORTAL.z0),
  curtain(BAILEY_PORTAL.z1, WEST_PASSAGES[0].z0),
  curtain(WEST_PASSAGES[0].z1, WEST_PASSAGES[1].z0),
  curtain(WEST_PASSAGES[1].z1, MAIN_COURT.z1),
];

// Dressed through-stones under the deck. Their stepped underside is the actual
// clearance profile, not a render arch over a rectangular collision hole.
export const WEST_ARCH_HEADS: readonly Box[] = WEST_PASSAGES.flatMap(({ z0, z1 }) => [
  ...([[2.46, 2.72, 0.16], [2.72, 2.96, 0.37], [2.96, 3.17, 0.65],
    [3.17, 3.34, 0.98], [3.34, 3.5, 1.24]] as const).flatMap(([base, top, end]) => [
    fabric('westArch', WEST_JAMB_BACK, z0, WEST_WALL_FACE, z0 + end, top, base),
    fabric('westArch', WEST_JAMB_BACK, z1 - end, WEST_WALL_FACE, z1, top, base),
  ]),
  fabric('westArch', WEST_JAMB_BACK, z0, WEST_WALL_FACE, z1, WEST_WALK_BEARING, 3.5),
]);
const WEST_JAMBS = WEST_PASSAGES.flatMap(({ z0, z1 }) => [
  fabric('westArch', WEST_JAMB_BACK, z0 - 0.67, MAIN_COURT.x0, z0, WEST_WALK_BEARING),
  fabric('westArch', WEST_JAMB_BACK, z1, MAIN_COURT.x0, z1 + 0.67, WEST_WALK_BEARING),
]);

const { south: s, north: n } = WEST_COURT;
const wall = (x0: number, z0: number, x1: number, z1: number, h: number, y0 = 0): Box =>
  fabric(y0 ? 'westFracture' : 'westRuin', x0, z0, x1, z1, h, y0);
const southInnerX = -15.24;
const northInnerX = -17.27;
const kneeNorth = 17.43;
const northInnerZ = 24.28;
const southInnerZ = 9.04;

/** The surviving hall crosses the old curtain. Its cross-wall ends on both
 * sides of the walk, forcing a turn in the annex but leaving a through-route. */
const WEST_WING: readonly Box[] = [
  // South return and lesser outer wall, with the old roof line broken away.
  wall(s.x0, s.z0, -13.92, southInnerZ, 2.52),
  wall(-13.92, s.z0, -12.82, southInnerZ, 2.97),
  // The last metre of the old return folds back for the bailey passage.
  wall(-12.82, s.z0, -12.04, BAILEY_PORTAL.z1, 3.68),
  wall(-12.82, BAILEY_PORTAL.z1, s.x1, 10.01, 3.68),
  wall(s.x0, southInnerZ, southInnerX, 11.38, 3.36),
  wall(s.x0, 11.38, southInnerX, 13.18, 2.24),
  wall(s.x0, 13.18, southInnerX, 14.55, 1.66),
  wall(s.x0, 14.55, southInnerX, s.z1, 2.83),
  wall(s.x0 + 0.08, 14.88, southInnerX - 0.16, s.z1, 3.21, 2.83),
  // Elbow in the perimeter: the north chamber is 2.1 m deeper than the south bay.
  wall(n.x0, n.z0, -16.79, kneeNorth, 2.13),
  wall(-16.79, n.z0, southInnerX, kneeNorth, 2.83),
  wall(n.x0, kneeNorth, northInnerX, 19.05, 2.54),
  wall(n.x0, 19.05, northInnerX, 21.64, 1.81),
  wall(n.x0, 21.64, northInnerX, 22.86, 2.94),
  wall(n.x0, 22.86, northInnerX, northInnerZ, 4.42),
  wall(n.x0 + 0.1, 23.37, northInnerX - 0.12, northInnerZ, 5.13, 4.42),
  // Damaged high gable and the last open upper window. Full masonry sill below it.
  wall(n.x0, northInnerZ, -16.59, n.z1, 4.56),
  wall(-16.59, northInnerZ, -15.57, n.z1, 2.47),
  wall(-16.59, northInnerZ, -15.57, n.z1, 4.56, 4.12),
  wall(-15.57, northInnerZ, -13.93, n.z1, 4.56),
  wall(-17.76, northInnerZ + 0.025, -14.24, n.z1 - 0.03, 5.35, 4.56),
  wall(-17.49, northInnerZ + 0.06, -14.93, n.z1 - 0.08, 6.02, 5.35),
  wall(-16.96, northInnerZ + 0.12, -15.51, n.z1 - 0.14, 6.59, 6.02),
  wall(-16.75, northInnerZ + 0.16, -16.10, n.z1 - 0.21, 6.76, 6.59),
  wall(-13.93, northInnerZ, -12.85, n.z1, 3.06),
  wall(-12.85, northInnerZ, n.x1, n.z1, 2.23),
  // 1.05 m thick cross-wall broken at the western end; its roots underlie the deck.
  wall(-13.20, 15.55, -12.55, 16.60, 1.47),
  wall(-12.55, 15.55, -11.89, 16.60, 2.50),
  wall(-11.89, 15.55, MAIN_COURT.x0, 16.60, 3.70),
  wall(WEST_WALL_FACE, 15.55, -8.40, 16.60, 3.70),
  wall(-8.40, 15.55, -7.78, 16.60, 2.58),
  wall(-7.78, 15.55, -7.32, 16.60, 1.45),
];

export const WEST_COURT_FABRIC: readonly Box[] = [...WEST_ARCH_HEADS, ...WEST_JAMBS, ...WEST_WING];
export function isWestCourtFabric(w: Box): boolean {
  return w.tag === 'westArch' || w.tag === 'westRuin' || w.tag === 'westFracture';
}

/** Walkable, eye-level survey points (x,z; all y=0). Two independent entries,
 * an off-axis knee, and a deep corner in the north room. */
export const WEST_COURT_POINTS = {
  southMouth: { x: -10.25, z: 11.85 },
  southBay: { x: -14.26, z: 11.85 },
  knee: { x: -14.35, z: 16.15 },
  northBay: { x: -16.20, z: 20.05 },
  northMouth: { x: -10.25, z: 20 },
  gable: { x: -15.9, z: 23.2 },
} as const;
