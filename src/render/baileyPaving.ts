import * as THREE from 'three';
import { BAILEY_OUTLINE, BAILEY_PORTAL, BAILEY_WING_SEAM_Z } from '../sim/baileyApron';
import { MAIN_COURT, WEST_COURT, WEST_PASSAGES } from '../sim/courtPlan';
import { cutRect, DOORS, PROPS, S1_SHAFT, STAIRS, STEP_RAMP, SUBGRADE_GROUND_CUTOUTS, WALLS, WELL, type Rect } from '../sim/level';
import { NORTH_ARCHES, NORTH_OPENING } from '../sim/northCourt';
import type { Batch } from './geom';
import { awUniforms, enhance, stoneShader, trackPending } from './materials';
import { YARD_DRAIN } from './yardWeather';
import { pavingFace } from './pavingFace';

interface Point { x: number; z: number }
interface Course extends Point { half: number }
interface Lane { courses: readonly Course[]; repair: boolean }
interface Reach { a: Course; b: Course; length: number; dx: number; dz: number }
interface Seed extends Point { lane?: Lane }
type UV = (p: Point, y: number) => readonly [number, number];

const bottom = -.30; // Existing render foundation and simulation slab thickness.
const epsilon = 1e-7;
const point = (x: number, z: number): Point => ({ x, z });
const station = (x: number, z: number, half: number): Course => ({ x, z, half });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const blend = (p: Point, q: Point, t: number): Point => point(mix(p.x, q.x, t), mix(p.z, q.z, t));
const ease = (a: number, b: number, v: number): number => THREE.MathUtils.smoothstep(v, a, b);
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const inside = (p: Point, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
const distanceTo = (p: Point, r: Rect) => Math.hypot(Math.max(r.x0 - p.x, p.x - r.x1, 0), Math.max(r.z0 - p.z, p.z - r.z1, 0));
const expand = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });
const rectRing = (r: Rect) => [point(r.x0, r.z0), point(r.x1, r.z0), point(r.x1, r.z1), point(r.x0, r.z1)];
const centroid = (ring: readonly Point[]): Point => point(
  ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
  ring.reduce((sum, p) => sum + p.z, 0) / ring.length,
);

export const YARD_DRAIN_CHANNEL: Rect = {
  x0: YARD_DRAIN.x - YARD_DRAIN.length / 2, x1: YARD_DRAIN.x + YARD_DRAIN.length / 2,
  z0: YARD_DRAIN.z - YARD_DRAIN.width / 2, z1: YARD_DRAIN.z + YARD_DRAIN.width / 2,
};

// The earliest cart road served the west throat. The chapel branch was laid later
// across the bend below the well. The east throat and service runs are patchier.
const cartway: Lane = { repair: false, courses: [
  station(0, .64, .73), station(-.93, 4.04, 1.34), station(-1.05, 7.32, 1.45),
  station(-.52, 10.42, 1.28), station(-.19, 13.18, 1.31), station(.80, 15.13, 1.46),
  station(2.58, 18.75, 1.57), station(2.88, 21.65, 1.37), station(1.51, 24.03, 1.34),
  station(NORTH_ARCHES[0].center + .07, 27.31, 1.36),
] };
const chapelRoad: Lane = { repair: true, courses: [
  station(1.06, 15.51, .91), station(3.47, 15.55, 1.19), station(6.36, 16.04, 1.26),
  station(8.26, 16.47, 1.08), station(STEP_RAMP.x0 - .30, 16.50, .96),
] };
const lanes: readonly Lane[] = [cartway, chapelRoad, { repair: true, courses: [
  station(2.71, 21.15, .92), station(4.41, 23.91, 1.11), station(NORTH_ARCHES[1].center, 27.31, 1.21),
] }, { repair: true, courses: [
  station(-8.85, 7.55, .63), station(-6.19, 7.72, .80), station(-4.18, 8.98, .80), station(-1.43, 9.89, .71),
] }];

function reaches(lane: Lane): Reach[] {
  return lane.courses.slice(1).map((b, i) => {
    const a = lane.courses[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    return { a, b, length, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length };
  });
}

const surveyedLanes = lanes.map(lane => ({ lane, reaches: reaches(lane) }));

function wheelWear(p: Point): number {
  // An axle about 1.3 m wide. Unequal channels wander slightly and peter out in the fork.
  const drift = .047 * Math.sin(p.z * 1.37) + .023 * Math.sin(p.z * 3.23 + .7);
  const strength = ease(1.45, 3.2, p.z) * (1 - ease(18, 22.2, p.z));
  let depth = 0;
  for (const r of surveyedLanes[0].reaches) {
    const lateral = (p.x - r.a.x) * r.dz - (p.z - r.a.z) * r.dx;
    const along = (p.x - r.a.x) * r.dx + (p.z - r.a.z) * r.dz;
    const end = ease(-.46, .06, along) * (1 - ease(r.length - .06, r.length + .46, along));
    const left = 1 - ease(.044, .24, Math.abs(lateral + .66 - drift));
    const right = 1 - ease(.035, .198, Math.abs(lateral - .62 - drift * .78));
    depth = Math.max(depth, end * Math.max(left, .79 * right));
  }
  return strength * depth;
}

const gate = DOORS.gatehouse.box;
const gateThreshold: Rect = { x0: gate.x0, x1: gate.x1, z0: MAIN_COURT.z0, z1: .63 };
const chapelThreshold: Rect = { x0: 9.88, x1: STEP_RAMP.x1, z0: 14.6, z1: 18.4 };
const northThresholds = NORTH_ARCHES.map(({ x0, x1, z0, z1 }) => ({ x0, x1, z0, z1 }));
const westThresholds = [...WEST_PASSAGES, BAILEY_PORTAL].map(({ z0, z1 }) => ({ x0: -11.18, x1: -9.94, z0, z1 }));
const s1Landing: Rect = { x0: S1_SHAFT.x0 - .72, x1: S1_SHAFT.x0, z0: S1_SHAFT.z0, z1: S1_SHAFT.z1 };
const s3 = STAIRS.find(s => s.id === 'S3')!.runs[0];
const thresholds = [gateThreshold, chapelThreshold, ...northThresholds, ...westThresholds, s1Landing,
  { ...s3, x0: s3.x0 - .36 }];
const atGrade = (r: { y0?: number; h: number }) => (r.y0 ?? 0) <= 0 && r.h > 0;
const props = PROPS.filter(atGrade);
const walls = WALLS.filter(atGrade).filter(r => r.x1 > MAIN_COURT.x0 && r.x0 < MAIN_COURT.x1
  && r.z1 > MAIN_COURT.z0 && r.z0 < MAIN_COURT.z1);
const wellClearance = WELL.r + .095;

// These extents reserve the three sculpted failures in yardBreaks.ts and the gutter's curb.
const pockets: readonly Rect[] = [
  { x0: -3.0, x1: -.98, z0: 10.0, z1: 11.1 },
  { x0: -6.4, x1: -4.45, z0: 17.2, z1: 18.3 },
  { x0: -5.65, x1: -3.0, z0: 24.15, z1: 25.4 },
  expand(YARD_DRAIN_CHANNEL, .26),
];
const reserves = [...walls, ...props, ...thresholds, ...SUBGRADE_GROUND_CUTOUTS, ...pockets].map(r => expand(r, .055));

function grade(p: Point): number {
  const rim = Math.min(p.x - MAIN_COURT.x0, MAIN_COURT.x1 - p.x, p.z - MAIN_COURT.z0, MAIN_COURT.z1 - p.z);
  let relief = ease(0, .36, rim); // Exact y=0 at every join to existing survey ground.
  for (const r of thresholds) relief = Math.min(relief, ease(.02, .49, distanceTo(p, r)));
  // Keep zero-grade masonry footings from sharing an exposed coplanar surface.
  const wear = wheelWear(p);
  // Centimetre-scale rolling bedding. It flattens at gates, the stair lips
  // and the slab survey seams; the ground collision remains at grade.
  const bank = Math.sin(p.x * 1.63 - p.z * 1.17 + .68 * Math.sin(p.z * .93));
  const clod = Math.sin(p.x * 3.73 + p.z * 2.21) * Math.cos(p.x * 2.07 - p.z * 3.39);
  const surveyed = -.019 + .006 * Math.sin(p.x * 3.73 + p.z * 2.21) * Math.cos(p.x * 2.07 - p.z * 4.39)
    + .003 * Math.sin(p.x * 6.17 - p.z * 1.81) - .018 * wear;
  // Preserve the surveyed bearing under the wall spalls and west heap. Fade
  // only the new relief; do not leave a visible circular or rectangular rim.
  const stoneSeat = Math.min(ease(1.45, 2.5, Math.hypot(p.x + 8, p.z - 21)),
    ease(.76, 1.52, Math.hypot(p.x - 9.80, p.z - 22.48)));
  const regraded = Math.max(-.042, Math.min(-.003, -.022 + .013 * bank + .011 * clod - .023 * wear));
  const eroded = mix(surveyed, regraded, stoneSeat);
  if (Math.hypot(p.x - WELL.x, p.z - WELL.z) < WELL.r) return -.006;
  if (props.some(r => inside(p, r))) return Math.min(-.004, Math.max(-.006, eroded * relief));
  return relief * eroded;
}

type Normal = readonly [number, number, number];
function unit(x: number, y: number, z: number): Normal {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}
class Surface {
  private positions: number[] = [];
  private uvs: number[] = [];
  private normals: number[] = [];

  face(a: Point, b: Point, c: Point, ay: number, by: number, cy: number, uv: UV,
    smooth?: readonly [Normal, Normal, Normal]): void {
    const bx = b.x - a.x, bz = a.z - b.z, ux = c.x - a.x, uz = a.z - c.z;
    const flat = unit((by - ay) * uz - bz * (cy - ay), bz * ux - bx * uz, bx * (cy - ay) - (by - ay) * ux);
    const vertices = [[a, ay], [b, by], [c, cy]] as const;
    for (let j = 0; j < 3; j++) {
      const [p, y] = vertices[j];
      this.positions.push(p.x, y, -p.z);
      this.uvs.push(...uv(p, y));
      this.normals.push(...(smooth?.[j] ?? flat));
    }
  }

  addTo(batch: Batch, mat: THREE.Material): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    batch.geo(mat, g, 0, 0, 0);
  }
}

/** Convex half-plane clip. Consistent edge endpoints let adjacent cells share height samples. */
function clip(ring: readonly Point[], nx: number, nz: number, end: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const da = a.x * nx + a.z * nz - end, db = b.x * nx + b.z * nz - end;
    if (da <= 0) out.push(a);
    if (da < 0 && db > 0 || da > 0 && db < 0) out.push(blend(a, b, da / (da - db)));
  }
  return out;
}

function inRect(ring: readonly Point[], r: Rect): Point[] {
  return clip(clip(clip(clip(ring, -1, 0, -r.x0), 1, 0, r.x1), 0, -1, -r.z0), 0, 1, r.z1);
}

function cell(seed: Seed, seeds: readonly Seed[]): Point[] {
  let ring = rectRing(MAIN_COURT);
  const radiusSquared = () => Math.max(...ring.map(p => (p.x - seed.x) ** 2 + (p.z - seed.z) ** 2));
  let reach = 4 * radiusSquared();
  for (const other of seeds) {
    if (other === seed) continue;
    const dx = other.x - seed.x, dz = other.z - seed.z;
    if (dx * dx + dz * dz > reach + epsilon) continue;
    const limit = dx * (seed.x + dx * .5) + dz * (seed.z + dz * .5);
    if (ring.some(p => p.x * dx + p.z * dz > limit)) {
      ring = clip(ring, dx, dz, limit);
      reach = 4 * radiusSquared();
    }
  }
  return ring;
}

function seedCourt(random: () => number): Seed[] {
  const seeds: Seed[] = [];
  for (const { lane, reaches: run } of surveyedLanes) {
    let i = 0, along = .06;
    for (const r of run) {
      for (; along < r.length; along += mix(.48, lane.repair ? .72 : .94, random()), i++) {
        const t = along / r.length, p = blend(r.a, r.b, t);
        const width = mix(r.a.half, r.b.half, t);
        const count = Math.max(2, Math.round(width / (lane.repair ? .29 : .34)));
        for (let j = 0; j < count; j++) {
          const across = ((j + .5 + (i % 2 ? .16 : -.16) + (random() - .5) * .47) / count * 2 - 1) * width;
          const drift = (random() - .5) * .24;
          const q = { x: p.x + r.dz * across + r.dx * drift, z: p.z - r.dx * across + r.dz * drift, lane };
          if (inside(q, MAIN_COURT) && seeds.every(s => Math.hypot(s.x - q.x, s.z - q.z) > .31)) seeds.push(q);
        }
      }
      along -= r.length;
    }
  }
  // Jittered earth samples supply the surrounding ground and the edges of the courses.
  for (let z = .39; z < MAIN_COURT.z1; z += .82) {
    for (let x = MAIN_COURT.x0 + .39; x < MAIN_COURT.x1; x += .82) {
      const p = point(x + (random() - .5) * .65, z + (random() - .5) * .65);
      if (seeds.some(s => s.lane && Math.hypot(p.x - s.x, p.z - s.z) < .53)) continue;
      seeds.push(p);
    }
  }
  return seeds;
}

function makeSoil(): THREE.MeshStandardMaterial {
  // Photographed clay and mineral fines, not a carpet of micro-leaves.
  const pixels = new Uint8Array([99, 82, 65, 255, 108, 91, 73, 255, 105, 86, 71, 255, 94, 80, 64, 255]);
  const fallback = new THREE.DataTexture(pixels, 2, 2);
  fallback.magFilter = THREE.LinearFilter;
  fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: fallback, roughness: .96 });
  mat.name = 'Bailey compacted earth and grit';
  const u = awUniforms(1, .57, .45, [.99, .95, .90], .0065);
  u.uAwYard.value = 1;
  u.uAwPool.value = .72;
  u.uAwScanDrift.value.set(.24, .19);
  mat.defines = { ...mat.defines, AW_COMPACTED_EARTH: 1 };
  stoneShader(mat, u);
  if (typeof document !== 'undefined') {
    const textures: Promise<void>[] = [];
    enhance(mat, 'brown_mud', .83, textures);
    trackPending(Promise.all(textures).then(() => undefined));
  }
  return mat;
}

const soilUV: UV = ({ x, z }) => [(.91 * x - .415 * z) * .76, (.415 * x + .91 * z) * .76];

function hitsReserve(ring: Point[]): boolean {
  const x0 = Math.min(...ring.map(p => p.x)), x1 = Math.max(...ring.map(p => p.x));
  const z0 = Math.min(...ring.map(p => p.z)), z1 = Math.max(...ring.map(p => p.z));
  if (reserves.some(r => r.x0 < x1 && r.x1 > x0 && r.z0 < z1 && r.z1 > z0 && inRect(ring, r).length > 0)) return true;
  // Protect the well using a conservative box tested against the collision circle.
  return distanceTo(WELL, { x0, x1, z0, z1 }) < wellClearance;
}

// Scattered old pitching survives where carts braked and shelter held the bedding.
const pitchIns = [[-5.24, 5.37, 2.35, 1.47], [-5.67, 12.54, 2.60, 1.38],
  [-3.69, 22.98, 2.15, 1.53], [5.63, 20.23, 2.49, 1.49], [6.24, 5.89, 2.18, 1.46],
  [5.00, 13.09, 1.60, 1.48], [7.82, 25.63, 1.27, 1.81]];

function patch(p: Point): number {
  return Math.max(...pitchIns.map(([x, z, w, l]) => {
    const u = (p.x - x) * .89 + (p.z - z) * .45, v = (p.z - z) * .89 - (p.x - x) * .45;
    return 1 - ease(.38, 1.22, Math.hypot(u / w, v / l));
  }));
}

function stoneRing(ring: Point[], seed: Seed, random: () => number): { seat: Point[]; chip: boolean } | undefined {
  const center = centroid(ring);
  const pitching = seed.lane ? 0 : patch(center) * .69;
  if (!seed.lane && random() > .16 + pitching) return;
  const chip = !seed.lane && random() > pitching;
  let scale = chip ? mix(.11, .35, random()) : seed.lane ? mix(.86, .965, random()) : mix(.60, .87, random());
  // The ragged margin sheds small stones before the heavier flags of the middle.
  if (seed.lane && random() < (seed.lane === cartway ? .09 : .19)) scale *= mix(.57, .81, random());
  let seat = ring.map(p => blend(center, p, scale));
  if (hitsReserve(seat) && !chip) seat = ring.map(p => blend(center, p, scale * .62));
  if (hitsReserve(seat)) return;
  return { seat, chip };
}

function layStone(soil: Surface, stone: Surface, ring: Point[], seat: Point[], chip: boolean, repair: boolean, random: () => number): void {
  const center = centroid(seat);
  const angle = random() * Math.PI * 2, selection = random();
  const radius = Math.max(...seat.map(p => Math.hypot(p.x - center.x, p.z - center.z)));
  const scan = pavingFace(repair, selection, angle, center.x, center.z, radius + .033);
  // Unfold the slope into its own face UV, with both endpoints still inside
  // this one photographed stone. Do not stretch a strip of texels down the edge.
  const centreGrade = grade(center);
  const uv: UV = (p, y) => {
    const x = p.x - center.x, z = p.z - center.z;
    const wrap = Math.max(0, Math.min(.028, centreGrade + .018 - y)) / Math.max(.06, Math.hypot(x, z));
    return scan.sample(p.x + x * wrap, p.z + z * wrap);
  };
  const tiltX = (random() - .5) * .032, tiltZ = (random() - .5) * .033;
  const crown = chip ? mix(.004, .012, random()) : mix(.010, .023, random());
  const n = seat.length;
  // Old flags have uneven, knocked-back arrises. Keep the buried outline and
  // bedding topology, but clip the exposed crown's corners, not every edge
  // equally. A wet or lit side reads as a shoulder instead of a knife edge.
  const core = seat.map(p => {
    const edge = mix(.016, .035, random()) * (chip ? .48 : repair ? .71 : 1);
    return blend(p, center, Math.min(.21, edge / Math.max(.001, Math.hypot(p.x - center.x, p.z - center.z))));
  });
  const beds = seat.map(grade);
  const cutHeight = (p: Point, seatY: number) => Math.max(seatY + .002, Math.min(.027,
    (chip ? centreGrade : -.006) + crown + tiltX * (p.x - center.x) + tiltZ * (p.z - center.z) - .017 * wheelWear(p)));
  const height = (p: Point) => cutHeight(p, grade(p));
  const centerY = height(center);
  // Deterministic chips avoid perturbing the random sequence of the laid courses.
  const ends = core.map((p, i) => {
    const last = core[(i + n - 1) % n], next = core[(i + 1) % n];
    const nick = (.016 + .029 * (.5 + .5 * Math.sin(p.x * 23.7 + p.z * 16.4))) * (chip ? .36 : repair ? .62 : 1);
    const along = (to: Point, k: number) => blend(p, to, Math.min(.26, nick * k / Math.max(.001, Math.hypot(to.x - p.x, to.z - p.z))));
    return [along(last, .66), along(next, 1.12)] as const;
  });
  const faceN = unit(-tiltX, 1, tiltZ);
  const edgeN = (p: Point, amount: number) => {
    const len = Math.max(.01, Math.hypot(p.x - center.x, p.z - center.z));
    return unit(faceN[0] + amount * (p.x - center.x) / len, 1, faceN[2] - amount * (p.z - center.z) / len);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    soil.face(ring[i], ring[j], seat[j], grade(ring[i]), grade(ring[j]), beds[j], soilUV);
    soil.face(ring[i], seat[j], seat[i], grade(ring[i]), beds[j], beds[i], soilUV);
    const [a, p] = ends[i], q = ends[j][0];
    const ya = height(a), yp = height(p), yq = height(q);
    const ni = edgeN(seat[i], 1.3), nj = edgeN(seat[j], 1.3);
    const na = edgeN(a, .23), np = edgeN(p, .23), nq = edgeN(q, .23);
    stone.face(seat[i], seat[j], q, beds[i], beds[j], yq, uv, [ni, nj, nq]);
    stone.face(seat[i], q, p, beds[i], yq, yp, uv, [ni, nq, np]);
    stone.face(seat[i], p, a, beds[i], yp, ya, uv, [ni, np, na]);
    stone.face(p, q, center, yp, yq, centerY, uv, [np, nq, faceN]);
    stone.face(a, p, center, ya, yp, centerY, uv, [na, np, faceN]);
  }
}

const trueHoles = SUBGRADE_GROUND_CUTOUTS.filter(r => r.x0 < MAIN_COURT.x1 && r.x1 > MAIN_COURT.x0
  && r.z0 < MAIN_COURT.z1 && r.z1 > MAIN_COURT.z0);
const cuts = [...trueHoles, YARD_DRAIN_CHANNEL];
const sortUnique = (n: number[]) => [...new Set(n)].sort((a, b) => a - b);
const xs = sortUnique([MAIN_COURT.x0, MAIN_COURT.x1, ...cuts.flatMap(r => [r.x0, r.x1])]);
const zs = sortUnique([MAIN_COURT.z0, MAIN_COURT.z1, ...cuts.flatMap(r => [r.z0, r.z1])]);
const edgeXs = sortUnique([...xs, NORTH_OPENING.x0, NORTH_OPENING.x1]);
const edgeZs = sortUnique([...zs, BAILEY_OUTLINE[0].z, BAILEY_WING_SEAM_Z, WEST_COURT.north.z1]);
const tiles = xs.slice(1).flatMap((x1, i) => zs.slice(1).flatMap((z1, j) => {
  const rect = { x0: xs[i], x1, z0: zs[j], z1 };
  const mid = point((rect.x0 + x1) / 2, (rect.z0 + z1) / 2);
  return cuts.some(r => inside(mid, r)) ? [] : [rect];
}));

/** Include cut-axis intersections in the uncut side of every shared edge. */
function splitEdges(ring: Point[]): Point[] {
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const parameters: number[] = [];
    for (const [axis, lines] of [['x', edgeXs], ['z', edgeZs]] as const) {
      if (Math.abs(b[axis] - a[axis]) <= epsilon) continue;
      for (const line of lines) {
        const t = (line - a[axis]) / (b[axis] - a[axis]);
        if (t > epsilon && t < 1 - epsilon) parameters.push(t);
      }
    }
    parameters.sort((u, v) => u - v);
    return [a, ...parameters.filter((t, j) => j === 0 || t - parameters[j - 1] > epsilon).map(t => blend(a, b, t))];
  });
}

function area(ring: readonly Point[]): number {
  let result = 0;
  for (let i = 1; i < ring.length - 1; i++) result += cross(ring[0], ring[i], ring[i + 1]);
  return result * .5;
}

function boundaryEdge(a: Point, b: Point, r: Rect): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < epsilon;
  const mid = blend(a, b, .5);
  if (near(a.x, b.x) && (near(a.x, r.x0) || near(a.x, r.x1))) return mid.z >= r.z0 && mid.z <= r.z1;
  if (near(a.z, b.z) && (near(a.z, r.z0) || near(a.z, r.z1))) return mid.x >= r.x0 && mid.x <= r.x1;
  return false;
}

function sharedFoundationEdge(a: Point, b: Point): boolean {
  const m = blend(a, b, .5);
  return (Math.abs(a.x - MAIN_COURT.x0) < epsilon && Math.abs(b.x - MAIN_COURT.x0) < epsilon
    && m.z >= BAILEY_OUTLINE[0].z && m.z <= WEST_COURT.north.z1)
    || (Math.abs(a.z - NORTH_OPENING.z1) < epsilon && Math.abs(b.z - NORTH_OPENING.z1) < epsilon
    && m.x >= NORTH_OPENING.x0 && m.x <= NORTH_OPENING.x1);
}

function finishCell(soil: Surface, ring: Point[], exposedSoil: boolean): void {
  const center = centroid(ring), cy = grade(center);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (cross(a, b, center) <= epsilon) continue;
    const ay = grade(a), by = grade(b);
    if (exposedSoil) soil.face(a, b, center, ay, by, cy, soilUV);
    if (sharedFoundationEdge(a, b)) continue;
    const channelEdge = boundaryEdge(a, b, YARD_DRAIN_CHANNEL);
    if (!channelEdge && !boundaryEdge(a, b, MAIN_COURT) && !trueHoles.some(r => boundaryEdge(a, b, r))) continue;
    const lip = channelEdge ? -.037 : bottom;
    // Unfold the narrow vertical faces into the bed texture.
    const sideUV: UV = (p, y) => [p.x * .54 + p.z * .43, y * .69];
    soil.face(b, a, a, by, ay, lip, sideUV);
    soil.face(b, a, b, by, lip, lip, sideUV);
  }
}

/** A single fitted skin. Each convex cell is either exposed soil or a stone
 * surrounded by its own bedding ring. There is no duplicate surface below the flags. */
export function addBaileyPaving(batch: Batch, flags: THREE.Material, wornFlags: THREE.Material): void {
  const soil = new Surface(), old = new Surface(), repair = new Surface();
  let state = 0x39f7b21d;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const seeds = seedCourt(random);
  for (const seed of seeds) {
    const base = cell(seed, seeds);
    if (area(base) <= epsilon) continue;
    if (cuts.some(r => area(inRect(base, r)) > epsilon)) {
      for (const rect of tiles) {
        const piece = inRect(base, rect);
        if (area(piece) > epsilon) finishCell(soil, splitEdges(piece), true);
      }
      continue;
    }
    const ring = splitEdges(base);
    const stone = stoneRing(ring, seed, random);
    if (!stone) {
      finishCell(soil, ring, true);
      continue;
    }
    const isRepair = seed.lane?.repair ?? random() < .72;
    layStone(soil, isRepair ? repair : old, ring, stone.seat, stone.chip, isRepair, random);
    finishCell(soil, ring, false);
  }
  // The underside can use the coarse survey rectangles. The gutter keeps its
  // foundation, while the S1 shaft remains open through the full section.
  for (const r of trueHoles.reduce((pieces, cut) => pieces.flatMap(p => cutRect(p, cut)), [MAIN_COURT])) {
    const [a, b, c, d] = rectRing(r);
    soil.face(a, c, b, bottom, bottom, bottom, soilUV);
    soil.face(a, d, c, bottom, bottom, bottom, soilUV);
  }
  soil.addTo(batch, makeSoil());
  old.addTo(batch, flags);
  repair.addTo(batch, wornFlags);
}
