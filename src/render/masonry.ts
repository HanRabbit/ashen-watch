import * as THREE from 'three';
import { WEST_CURTAIN, WEST_PASSAGES, WEST_WALL_FACE } from '../sim/courtPlan';
import { DECK_SLABS, type Box, type Rect } from '../sim/level';
import type { Batch } from './geom';
import { wornArris, wornPrism } from './wornArris';

interface Fabric {
  wallTrim: THREE.Material;
  wallRough: THREE.Material;
}
type Side = 'west' | 'east' | 'north' | 'south';
interface Face { side: Side; plane: number }
interface Course extends Face { lo: number; hi: number }
type Pt = [u: number, y: number, d: number];
interface Stone {
  lo: number; hi: number; low: number; high: number;
  back: number; toe: number; crest?: number;
  bevel: number; chip?: 'left' | 'right'; drop?: number; exposedBack?: boolean; worn?: boolean;
}

// A face is authored in simulation coordinates: u increases along x or z and
// depth is measured into the yard. Never rotate a whole block out of its envelope.
const west: Face = { side: 'west', plane: WEST_WALL_FACE };
const east: Face = { side: 'east', plane: 10 };
const north: Face = { side: 'north', plane: 28.5 };
const south: Face = { side: 'south', plane: 0.5 };

function world(f: Face, [u, y, d]: Pt): Pt {
  switch (f.side) {
    case 'west': return [f.plane + d, y, -u];
    case 'east': return [f.plane - d, y, -u];
    case 'north': return [u, y, -f.plane + d];
    case 'south': return [u, y, -f.plane - d];
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 0x100000000);
}

// UV windows inside individual stones in the existing trim/rough scans. Using
// an entire repeat on each block would print a second set of mortar joints on it.
const cutSwatches = [
  [0.30, 0.88, 0.24, 0.18], [0.63, 0.88, 0.25, 0.18],
  [0.41, 0.62, 0.25, 0.18], [0.29, 0.37, 0.26, 0.17],
  [0.62, 0.36, 0.22, 0.17], [0.47, 0.12, 0.26, 0.16],
];
const roughSwatches = [
  [0.25, 0.442, 0.20, 0.030], [0.28, 0.197, 0.16, 0.030],
  [0.79, 0.946, 0.19, 0.023], [0.41, 0.105, 0.17, 0.029],
];

/** Battered ashlar with a real face arris, clipped corners and a buried tail. */
function stone(b: Batch, m: Fabric, f: Face, s: Stone, r: () => number, rough = false): void {
  const w = s.hi - s.lo, h = s.high - s.low;
  const bevel = Math.min(s.bevel, w * 0.12, h * 0.14);
  const crest = s.crest ?? s.toe;
  const dz = Math.min(bevel, (Math.min(s.toe, crest) - s.back) * 0.30);
  const clip = Math.min(w * 0.21, h * 0.23, bevel * 1.35);
  const corners = Array.from({ length: 4 }, () => clip * (0.65 + r() * 0.70));
  if (s.chip) corners[s.chip === 'left' ? 3 : 2] = Math.min(w * 0.29, h * 0.43, bevel * 5);
  const ring = (inset: number, depth: (y: number) => number): Pt[] => {
    const l = s.lo + inset, right = s.hi - inset, bot = s.low + inset, top = s.high - inset;
    const [bl, br, tr, tl] = corners;
    const pts = [[l + bl, bot], [right - br, bot], [right, bot + br], [right, top - tr],
      [right - tr, top], [l + tl, top], [l, top - tl], [l, bot + bl]];
    return pts.map(([u, y]) => {
      const v = y - (s.drop ?? 0) * (u - s.lo) / w * (y - s.low) / h;
      return [u, v, depth(v)];
    });
  };
  const front = (y: number): number => s.toe + (crest - s.toe) * (y - s.low) / h;
  const rings = s.exposedBack ? [ring(bevel, () => s.back), ring(0, () => s.back + dz)] : [ring(0, () => s.back)];
  rings.push(ring(0, (y) => front(y) - dz), ring(bevel, front));
  const reverse = f.side === 'east' || f.side === 'south';
  const swatches = rough ? roughSwatches : cutSwatches;
  const [cu, cv, su, sv] = swatches[Math.floor(r() * swatches.length)];
  const pos: number[] = [], uv: number[] = [];
  const d0 = s.back, ds = Math.max(s.toe, crest) - d0;
  const project = (v: Pt, axis: 0 | 1 | 2): [number, number] => {
    const us = Math.min(su, (axis === 0 ? ds : w) * 0.52);
    const vs = Math.min(sv, (axis === 1 ? ds : h) * 0.52);
    return [cu + us * ((axis === 0 ? (v[2] - d0) / ds : (v[0] - s.lo) / w) - 0.5),
      cv + vs * ((axis === 1 ? (v[2] - d0) / ds : (v[1] - s.low) / h) - 0.5)];
  };
  if (s.worn) {
    // Separate seed: adding edge stations must not change bond, course heights,
    // rock swatches or chip placement for the rest of this wall.
    const wear = rng(Math.round(s.lo * 7927 + s.high * 8837 + f.plane * 2053));
    const outer = ring(0, () => s.back), inner = ring(bevel, front);
    const oldRearFace = s.exposedBack ? rings[0] : undefined;
    const stations = outer.flatMap((_, i) => i % 2 === 0 ? [[i, 0], [i, 0.32 + wear() * 0.34]] : [[i, 0]]);
    const profiles = stations.map(([i, t]) => {
      const j = (i + 1) % outer.length;
      const sample = (outline: Pt[]): Pt => [THREE.MathUtils.lerp(outline[i][0], outline[j][0], t),
        THREE.MathUtils.lerp(outline[i][1], outline[j][1], t), THREE.MathUtils.lerp(outline[i][2], outline[j][2], t)];
      const [u, y] = sample(outer), [iu, iy] = sample(inner);
      // Rough shoulder, two different slopes and occasional larger worn pockets.
      // Some edges remain almost as crisp as the original cut.
      const pocket = t > 0 && wear() < 0.27;
      const width = Math.min(pocket ? 1.50 : 0.64 + wear() * 0.65, w * 0.14 / bevel, h * 0.155 / bevel);
      const depth = dz * (pocket ? 1.42 : 0.51 + wear() * 0.73);
      const shoulder = 0.16 + wear() * 0.17;
      const frontAt = (inset: number, loss: number): Pt => {
        const v = y + (iy - y) * inset;
        return [u + (iu - u) * inset, v, front(v) - loss];
      };
      return [...(oldRearFace ? [sample(oldRearFace)] : []),
        [u, y, s.back + (oldRearFace ? dz : 0)] as Pt,
        frontAt(0, depth), frontAt(width * shoulder, depth * (0.25 + wear() * 0.19)), frontAt(width, 0)];
    });
    const crease = s.chip === 'left' ? new Set([7, 9]) : s.chip === 'right' ? new Set([4, 6]) : undefined;
    const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(...world({ ...f, plane: 0 }, [1, 0, 0])),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(...world({ ...f, plane: 0 }, [0, 0, 1])));
    const g = wornArris(profiles[0].map((_, i) => profiles.map(p => p[i])), {
      body: oldRearFace ? 1 : 0, capBack: !!oldRearFace, reflected: reverse, creases: crease,
      uv: (v, { axis }) => project(v, axis),
    }).applyMatrix4(transform.setPosition(...world(f, [0, 0, 0])));
    b.geo(rough ? m.wallRough : m.wallTrim, g, 0, 0, 0);
    return;
  }
  const tri = (a: Pt, p: Pt, q: Pt): void => {
    // Dominant-plane projection gives every bevel and corner a valid UV basis,
    // including the nearly edge-on returns with no area in the wall plane.
    const [ax, ay, az] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const [bx, by, bz] = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
    const axis = nx > ny && nx > nz ? 0 : ny > nz ? 1 : 2;
    for (const v of reverse ? [a, q, p] : [a, p, q]) {
      pos.push(...world(f, v));
      uv.push(...project(v, axis));
    }
  };
  for (let k = 1; k < rings.length; k++) {
    const a = rings[k - 1], c = rings[k];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      tri(a[i], a[j], c[j]);
      tri(a[i], c[j], c[i]);
    }
  }
  const cap = rings[rings.length - 1];
  for (let j = 1; j < cap.length - 1; j++) {
    tri(cap[0], cap[j], cap[j + 1]);
    if (s.exposedBack) tri(rings[0][0], rings[0][j + 1], rings[0][j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.geo(rough ? m.wallRough : m.wallTrim, g, 0, 0, 0);
}

// Fit an uneven bond to the run without leaving a sliver at the far end.
function bond(lo: number, hi: number, size: number, r: () => number, add: (a: number, z: number, i: number) => void): void {
  const widths = Array.from({ length: Math.max(1, Math.round((hi - lo) / size)) }, () => 0.70 + r() * 0.60);
  const scale = (hi - lo) / widths.reduce((a, w) => a + w, 0);
  let u = lo;
  widths.forEach((w, i) => {
    const end = u + w * scale;
    const joint = 0.005 + r() * 0.006;
    add(u + joint, end - joint, i);
    u = end;
  });
}

function foot(b: Batch, m: Fabric, f: Course): void {
  const r = rng(167 + Math.round(f.lo * 73 + f.hi * 31));
  // The splayed upper course sheds water; long, deeper footings below it
  // leave a broken, broad shadow rather than a thin rectangular skirting.
  for (const [low, high, toe, crest, size] of [
    [0, 0.205, 0.080, 0.076, 1.14], [0.203, 0.405, 0.058, 0.055, 0.87],
    [0.403, 0.555, 0.055, 0.007, 1.23],
  ]) {
    bond(f.lo, f.hi, size, r, (lo, hi) => {
      const mid = (lo + hi) / 2;
      const reset = (f.side === 'west' && mid > 9.25 && mid < 12.65)
        || (f.side === 'east' && mid > 25.15 && mid < 27.45)
        || (f.side === 'south' && mid > -4.8 && mid < -3.15);
      const scour = reset && r() < 0.62;
      const wear = r() * 0.007 + (scour ? 0.009 : 0);
      stone(b, m, f, { lo, hi, low, high: high - (scour ? 0.012 : 0), back: -0.024,
        toe: toe - wear, crest: crest - wear * 0.55, bevel: 0.010 + r() * 0.008,
        chip: scour ? (r() < 0.5 ? 'left' : 'right') : undefined }, r, scour && low < 0.21);
    });
  }
}

/** Replace only the inner plinth of the primary curtain, leaving returns and nearby routes intact. */
export function addCurtainPlinth(b: Batch, m: Fabric, w: Box): boolean {
  const { x0, x1, z0, z1, h } = w;
  if (w.y0 !== undefined || w.tag !== undefined) return false;
  const old = (a: number, c: number, d: number, e: number): void => b.box(m.wallTrim, a, c, d, e, 0, 0.35, 2.2);
  if (h === 4 && x1 === west.plane) {
    old(x0 - 0.08, z0, x1 - 0.003, z1);
    foot(b, m, { ...west, lo: z0 + 0.58, hi: z1 - 0.58 });
  } else if (h === 4 && z0 === north.plane) {
    old(x0, z0 + 0.003, x1, z1 + 0.08);
    foot(b, m, { ...north, lo: x0 + 0.5, hi: x1 - 0.5 });
  } else if (h === 4 && x0 === east.plane) {
    old(x0 + 0.003, z0 - 0.08, x1 + 0.08, z1 + 0.08);
    if (z0 === 0) {
      // Keep the original strip at the S3 landing and where S1 meets the wall.
      old(x0 - 0.08, z0 - 0.08, x0 + 0.003, 2.53);
      old(x0 - 0.08, 8.98, x0 + 0.003, 10.82);
      foot(b, m, { ...east, lo: 2.53, hi: 8.98 });
      foot(b, m, { ...east, lo: 10.82, hi: z1 });
    } else {
      foot(b, m, { ...east, lo: z0, hi: z1 - 0.58 });
    }
  } else if (h === 4.2 && z1 === south.plane && z0 === 0) {
    old(x0 - 0.08, z0 - 0.08, x1 + 0.08, z1 - 0.003);
    // Preserve the south grille and S3's original trim. The new bond stops
    // short of both door jambs, not at the old inset of the decorative merlons.
    if (x0 > 0) old(3.7, z1 - 0.003, x1 + 0.08, z1 + 0.08);
    foot(b, m, { ...south, lo: Math.max(-10, x0), hi: Math.min(x1, 3.7) });
  } else return false;
  return true;
}

/** Soften the projecting trim of the chapel and gatehouse, not the structural
 * wall boxes or their window/door cut pieces. Adjacent bands still overlap
 * at the corners and seat into the fully square wall behind them. */
export function addMasonryTrim(b: Batch, m: Fabric, w: Box): void {
  const exposed = w.tag === 'gh' || w.h >= 7 || w.tag === 'balustrade';
  const band = (out: number, y0: number, y1: number) => {
    const rect = [w.x0 - out, w.z0 - out, w.x1 + out, w.z1 + out, y0, y1, 2.2] as const;
    if (exposed) b.edgeBox('stone', m.wallTrim, ...rect);
    else b.box(m.wallTrim, ...rect);
  };
  if (!addCurtainPlinth(b, m, w)) band(0.08, 0, 0.35);
  if (w.h >= 5) band(0.05, w.h - 0.12, w.h);
}

/** Draw stepped repair seams, not rectangular patches or isolated stuck-on stones. */
function repair(b: Batch, m: Fabric, f: Face, seed: number, rows: [number, number, number, number][]): void {
  const r = rng(seed);
  rows.forEach(([lo, hi, low, high], row) => {
    bond(lo, hi, 0.71, r, (a, z, i) => {
      const end = i === 0 || z > hi - 0.035;
      const toe = (end ? 0.028 : 0.045) + r() * 0.026;
      stone(b, m, f, { lo: a, hi: z, low: low + r() * 0.021, high: high - r() * 0.026,
        back: -0.032, toe, crest: toe - 0.006, bevel: 0.014 + r() * 0.012,
        chip: end && row % 2 === 0 ? (i === 0 ? 'left' : 'right') : undefined }, r, row === 0 || (i + row) % 4 === 0);
    });
  });
}

function support(b: Batch, m: Fabric, f: Face, at: number, top: number, kind: 'full' | 'stump' | 'rebuilt'): void {
  const r = rng(Math.round(at * 119 + f.plane * 37));
  let y = 0.35;
  let n = 0;
  while (y < top - 0.25) {
    const high = Math.min(top - 0.18, y + 0.31 + r() * 0.19);
    const spread = y < 0.86 ? 0.48 : kind === 'rebuilt' ? 0.32 : 0.40;
    const shift = (r() - 0.5) * 0.017;
    const toe = y < 0.86 ? 0.158 : kind === 'stump' ? 0.13 : 0.122;
    stone(b, m, f, { lo: at + shift - spread / 2, hi: at + shift + spread / 2, low: y, high,
      back: -0.036, toe, crest: high > 0.82 && y < 0.86 ? toe - 0.033 : toe - 0.005,
      bevel: 0.018, worn: true, chip: n === 1 && kind !== 'full' ? 'left' : undefined }, r, n === 0 || (kind === 'rebuilt' && n === 2));
    y = high + 0.012;
    n++;
  }
  const cap = kind === 'stump' ? 0.18 : 0.229;
  stone(b, m, f, { lo: at - cap, hi: at + cap, low: y, high: top, back: -0.045,
    toe: 0.157, crest: kind === 'stump' ? 0.035 : 0.053, bevel: 0.022, worn: true,
    chip: kind === 'stump' ? 'right' : undefined, drop: kind === 'stump' ? 0.075 : 0 }, r);
}

function coping(b: Batch, m: Fabric, f: Course, y: number, seed: number): void {
  const r = rng(seed);
  bond(f.lo, f.hi, 1.18, r, (lo, hi, i) => {
    const split = i % 11 === 3 || i % 13 === 7;
    stone(b, m, f, { lo, hi, low: y - 0.023, high: y + (split ? 0.060 : 0.085 + r() * 0.016),
      back: -0.492, toe: -0.006, crest: -0.022, bevel: 0.013,
      chip: split ? (i % 2 ? 'left' : 'right') : undefined,
      drop: split ? 0.018 : 0, exposedBack: true, worn: f.side === 'west' && (lo + hi) / 2 > 9.5 && (lo + hi) / 2 < 24 }, r);
  });
}

function southMerlons(b: Batch, m: Fabric): void {
  for (const sign of [-1, 1]) {
    const r = rng(103 + sign);
    for (let i = 0; i < 4; i++) {
      const u = sign * (3.6 + (i + 0.5) * (6.9 / 4));
      const stub = sign < 0 && i === 1;
      const rebuilt = sign > 0 && i === 2;
      const width = 0.59 + r() * 0.10;
      const lo = u - width / 2, hi = u + width / 2;
      // The lost crown leaves a broken lower block, not a scaled-down tooth.
      stone(b, m, south, { lo, hi, low: 4.196, high: stub ? 4.49 : 4.55,
        back: -0.485, toe: -0.012, bevel: 0.029, chip: stub ? 'right' : undefined,
        drop: stub ? 0.10 : 0, exposedBack: true }, r, stub);
      if (stub) continue;
      const head = 4.75 + r() * 0.06;
      const topStone = (a: number, z: number, rough: boolean): void => stone(b, m, south, {
        lo: a, hi: z, low: 4.548, high: head, back: -0.468, toe: -0.028, bevel: 0.023,
        chip: rough ? 'left' : undefined, exposedBack: true,
      }, r, rough);
      if (rebuilt) {
        topStone(lo + 0.015, u - 0.073, true);
        topStone(u - 0.058, hi - 0.017, false);
      } else topStone(lo + 0.012, hi - 0.013, false);
      if (!rebuilt) stone(b, m, south, { lo: lo - 0.002, hi: hi + 0.003, low: head - 0.004,
        high: head + 0.078, back: -0.489, toe: -0.008, crest: -0.027,
        bevel: 0.016, chip: i === 3 ? 'right' : undefined, exposedBack: true }, r);
    }
  }
}

export function addCurtainDetails(b: Batch, m: Fabric, walls: readonly Box[]): void {
  // The southwest corbelled opening now carries this stretch of walk.
  support(b, m, west, 14, 1.01, 'stump'); // truncated clear of the lamp bracket
  support(b, m, west, 22.76, 2.64, 'stump'); // clear of the northern opening
  support(b, m, east, 24, 3.70, 'rebuilt');
  support(b, m, south, -7, 4.18, 'full');

  repair(b, m, west, 417, [[13.7, 15.11, 0.55, 0.83], [13.94, 15.06, 0.85, 1.15],
    [14.10, 15.15, 1.16, 1.47], [14.22, 15.17, 1.49, 1.86], [14.40, 14.90, 1.88, 2.20]]);
  repair(b, m, east, 329, [[25.15, 27.45, 0.55, 0.82], [25.54, 27.32, 0.84, 1.10], [25.71, 26.67, 1.12, 1.41]]);
  repair(b, m, south, 219, [[-4.80, -3.27, 0.55, 0.82], [-4.49, -3.51, 0.85, 1.16]]);

  // floors.ts still owns the parapet and its teeth. Nest only the coping in
  // its footprint, terminating at each actual wall end (including the bridge).
  for (const w of walls) {
    if (w.tag !== 'parapet') continue;
    const f = w.z0 === north.plane ? { ...north, lo: w.x0 + 0.5, hi: w.x1 - 0.5 }
      : { ...(w.x1 === west.plane ? west : east), lo: w.z0, hi: Math.min(w.z1, north.plane) };
    coping(b, m, f, w.h, 27 + Math.round(f.lo * 59 + f.plane * 17));
  }
  coping(b, m, { ...south, lo: -10.48, hi: -0.82 }, 4.2, 108);
  coping(b, m, { ...south, lo: 0.82, hi: 10.48 }, 4.2, 307);
  southMerlons(b, m);
}

type WingFabric = Fabric & { wallRubble: THREE.Material };
const JOIN_EPSILON = 0.0001;

function boundsDistance(w: Rect, x: number, z: number): number {
  return Math.hypot(Math.max(w.x0 - x, x - w.x1, 0), Math.max(w.z0 - z, z - w.z1, 0));
}

/** The surviving west-wing window has no applied trim: wear its real through
 * sill, on both faces of the wall, without narrowing the original opening. */
function wornWindowSill(b: Batch, mat: THREE.Material, w: Box): void {
  const { x0, x1, z0, z1, h } = w;
  const base = w.y0 ?? 0;
  const mid = (x0 + x1) * 0.5;
  const profile = [
    [0.012, 0.013, 0.21], [0.043, 0.034, 0.29], [0.018, 0.014, 0.34],
    [0.009, 0.014, 0.24], [0.028, 0.021, 0.18], [0.017, 0.027, 0.30],
  ] as [number, number, number][];
  const geo = wornPrism([[x0, z0], [mid - 0.14, z0], [x1, z0], [x1, z1], [mid + 0.12, z1], [x0, z1]],
    base, h, { front: i => profile[i] }, ([x, z, y], { axis, sign }) => {
      // Same anchored world-size UVs as the sill box, including the returns.
      const u = axis === 0 ? (sign > 0 ? z - z0 : z1 - z) : axis === 1 && sign > 0 ? x1 - x : x - x0;
      const v = axis === 2 ? (sign > 0 ? z - z0 : z1 - z) : y - base;
      return [u / 3.6, v / 3.6];
    }).rotateX(-Math.PI / 2);
  b.geo(mat, geo, 0, 0, 0);
}

/** Carve back the crown and exposed ends inside the survey volumes. Upper
 * tiers, the window sill and the walk's bearing course keep their full beds. */
function ruinedWall(b: Batch, m: WingFabric, w: Box, neighbors: readonly Box[]): void {
  const base = w.y0 ?? 0;
  const body = w.tag === 'westFracture' ? m.wallRough : m.wallRubble;
  const alongX = w.x1 - w.x0 >= w.z1 - w.z0;
  const u0 = alongX ? w.x0 : w.z0, u1 = alongX ? w.x1 : w.z1;
  const v0 = alongX ? w.z0 : w.x0, v1 = alongX ? w.z1 : w.x1;
  const xz = (u: number, v: number): [number, number] => alongX ? [u, v] : [v, u];
  const nearby = neighbors.filter((n) => n !== w && n.h > base &&
    n.x0 <= w.x1 + JOIN_EPSILON && n.x1 >= w.x0 - JOIN_EPSILON &&
    n.z0 <= w.z1 + JOIN_EPSILON && n.z1 >= w.z0 - JOIN_EPSILON);
  const supported = nearby.filter((n) => (n.y0 ?? 0) <= w.h + JOIN_EPSILON && n.h >= w.h - JOIN_EPSILON);
  const sill = nearby.some((n) => (n.y0 ?? 0) > w.h &&
    n.x0 === w.x0 && n.x1 === w.x1 && n.z0 === w.z0 && n.z1 === w.z1);
  if (sill) {
    wornWindowSill(b, body, w);
    return;
  }
  if (supported.some((n) => n.x0 <= w.x0 && n.x1 >= w.x1 && n.z0 <= w.z0 && n.z1 >= w.z1)) {
    b.box(body, w.x0, w.z0, w.x1, w.z1, base, w.h, 3.6);
    return;
  }

  const r = rng(Math.round(w.x0 * 8317 + w.z0 * 2927 + w.h * 641));
  // Show a deep, raked bed between the two wall skins. A few long facing
  // stones hang on while other stretches have sheared down into the fill.
  const count = Math.max(2, Math.ceil((u1 - u0) / 0.43));
  const stations = [u0, ...Array.from({ length: count - 1 }, (_, i) =>
    u0 + (u1 - u0) * (i + 0.74 + r() * 0.52) / count), u1];
  const depth = [v0, ...[0.21, 0.49, 0.77].map((t) => v0 + (v1 - v0) * (t + (r() - 0.5) * 0.09)), v1];
  // Put vertices on the actual seams so the top can meet the underside of
  // the next tier without opening hairline gaps.
  for (const n of supported) {
    stations.push(...(alongX ? [n.x0, n.x1] : [n.z0, n.z1]).filter((u) => u > u0 && u < u1));
    depth.push(...(alongX ? [n.z0, n.z1] : [n.x0, n.x1]).filter((v) => v > v0 && v < v1));
  }
  const grid = (values: number[]): number[] => [...new Set(values)].sort((a, c) => a - c);
  const us = grid(stations), vs = grid(depth);
  const loss = Math.min(0.39, (w.h - base) * 0.65);
  const freedom = (u: number, v: number): number => Math.min(1,
    ...supported.map((s) => boundsDistance(s, ...xz(u, v)) / 0.22));
  const endBearing = (u: number, v: number): number => {
    const [x, z] = xz(u, v);
    return Math.max(base, ...nearby.filter((n) => boundsDistance(n, x, z) < JOIN_EPSILON).map((n) => n.h));
  };
  const points = us.map((u, i) => {
    const lean = r() - 0.5;
    return vs.map((v) => {
      const t = (v - v0) / (v1 - v0);
      const reaches = freedom(u, v);
      const basin = 1 - Math.abs(2 * t - 1);
      const chipped = Math.max(0.025, 0.06 + 0.62 * basin + 0.32 * r() + lean * (t - 0.48) * 0.65);
      const top = w.h - loss * chipped * reaches;
      const end = i === 0 ? 1 : i === us.length - 1 ? -1 : 0;
      const bite = end ? Math.min(0.227, Math.abs(u - us[i + end]) * 0.62) : 0;
      return { u, v, top, end, bite, bearing: end ? endBearing(u, v) : base, reaches };
    });
  });
  type Section = typeof points[number][number];
  const courses = [0, 0.32, 0.58, 0.78, 1];
  const cut = [0, 0.10, 0.41, 0.32, 1];
  const point = ({ u, v, top, end, bite, bearing, reaches }: Section, i: number): Pt => {
    const y = base + (top - base) * courses[i];
    const breakIn = Math.min(1, Math.max(0, (y - bearing) / 0.35));
    const stagger = 0.31 + 0.69 * Math.abs(Math.sin(v * 8.23 + (i % 2) * 2.17));
    const [x, z] = xz(u + end * bite * breakIn * stagger * cut[i] * reaches, v);
    return [x, y, -z];
  };

  const surfaces = new Map<THREE.Material, { position: number[]; uv: number[] }>();
  const quad = (mat: THREE.Material, a: Pt, c: Pt, d: Pt, e: Pt, projection: 'top' | 'x' | 'z', flip = false): void => {
    let data = surfaces.get(mat);
    if (!data) { data = { position: [], uv: [] }; surfaces.set(mat, data); }
    const tris = flip ? [[a, c, e], [c, d, e]] : [[a, c, d], [a, d, e]];
    for (const tri of tris) for (const [x, y, z] of alongX ? tri : [tri[0], tri[2], tri[1]]) {
      data.position.push(x, y, z);
      data.uv.push((projection === 'z' ? -z : x) / 3.6, (projection === 'top' ? -z : y) / 3.6);
    }
  };
  const crest = courses.length - 1;
  for (let i = 1; i < us.length; i++) for (let j = 1; j < vs.length; j++) {
    quad(m.wallRough, point(points[i - 1][j - 1], crest), point(points[i][j - 1], crest),
      point(points[i][j], crest), point(points[i - 1][j], crest), 'top', (i + j) % 2 === 0);
  }
  const side = (row: Section[], across: boolean): void => {
    const projection = alongX !== across ? 'x' : 'z';
    for (let j = 1; j < row.length; j++) for (let i = 1; i <= crest; i++) {
      const a = row[j - 1], c = row[j];
      const torn = across && base + (Math.min(a.top, c.top) - base) * courses[i] > Math.max(a.bearing, c.bearing) + 0.12;
      quad(torn ? m.wallRough : body, point(a, i - 1), point(c, i - 1), point(c, i), point(a, i), projection);
    }
  };
  side(points.map((row) => row[0]), false);
  side(points[us.length - 1], true);
  side(points.map((row) => row[vs.length - 1]).reverse(), false);
  side([...points[0]].reverse(), true);
  for (const [mat, data] of surfaces) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    g.computeVertexNormals();
    b.geo(mat, g, 0, 0, 0);
  }

  // Short pieces of through-stone survive on some exposed ends. Leave spans
  // of bare fill between them, with no applied blocks across a bonded return.
  for (const [end, row] of [[u0, points[0]], [u1, points[us.length - 1]]] as const) {
    const centre = row[Math.floor(row.length / 2)];
    const exposed = centre.top - centre.bearing;
    if (exposed < 0.40 || centre.reaches < 0.96 || r() < 0.35) continue;
    const atStart = end === u0;
    const face: Face = { side: alongX ? atStart ? 'east' : 'west' : atStart ? 'north' : 'south', plane: end };
    const width = v1 - v0;
    const nearSkin = r() < 0.5;
    const lo = v0 + width * (nearSkin ? 0.05 + r() * 0.10 : 0.43 + r() * 0.08);
    const hi = lo + width * (0.28 + r() * 0.15);
    if (freedom(end, lo) < 0.95 || freedom(end, hi) < 0.95) continue;
    const low = centre.top - Math.min(exposed * 0.69, 0.35 + r() * 0.20);
    const high = Math.min(centre.top - 0.045, low + 0.14 + r() * 0.14);
    stone(b, m, face, { lo, hi, low, high, back: -0.20, toe: -0.014 - r() * 0.035,
      crest: -0.062, bevel: 0.018 + r() * 0.017,
      chip: nearSkin ? 'left' : 'right', drop: 0.035 + r() * 0.065 }, r, r() < 0.70);
  }

  // Larger headers alternate with missing stretches along the crown.
  if (loss < 0.17 || u1 - u0 < 0.74 || r() < 0.24) return;
  const inner = r() > 0.5;
  const f: Face = { side: alongX ? inner ? 'south' : 'north' : inner ? 'west' : 'east', plane: inner ? v1 : v0 };
  const mid = u0 + (u1 - u0) * (0.30 + r() * 0.40);
  const span = Math.min(0.19 + r() * 0.17, (u1 - u0) * 0.25);
  const toe = -(0.025 + r() * 0.15);
  if (freedom(mid - span, f.plane) < 0.94 || freedom(mid + span, f.plane) < 0.94) return;
  stone(b, m, f, { lo: mid - span, hi: mid + span, low: w.h - loss * 1.06, high: w.h - r() * 0.045,
    back: toe - (v1 - v0) * (0.23 + 0.25 * r()), toe, crest: toe - 0.04, bevel: 0.022 + r() * 0.021,
    chip: r() > 0.5 ? 'right' : 'left', drop: 0.029 + r() * 0.097, exposedBack: true }, r, r() > 0.35);
}

/** Both faces of the bearing arches expose dressed blocks. The through depth,
 * broken gable, window and cross-wall come from the same solids as collision. */
export function addWestCourtFabric(b: Batch, m: WingFabric, walls: readonly Box[]): void {
  const neighbors = [...walls, ...WEST_CURTAIN, ...DECK_SLABS];
  for (const w of walls) {
    if (w.tag === 'westRuin' || w.tag === 'westFracture') {
      ruinedWall(b, m, w, neighbors);
      continue;
    }
    const base = w.y0 ?? 0;
    b.box(m.wallTrim, w.x0, w.z0, w.x1, w.z1, base, w.h, 2.2);
    if (base === 0) continue;
    const seed = Math.round(w.z0 * 79 + base * 97);
    for (const f of [{ side: 'west', plane: w.x1 }, { side: 'east', plane: w.x0 }] as const) {
      const r = rng(seed);
      // Blocks stay within each course vertically and stop at the actual corbel.
      bond(w.z0, w.z1, 0.58, r, (lo, hi, i) => {
        stone(b, m, f, { lo, hi, low: base + 0.004, high: w.h - 0.004,
          back: -0.031, toe: 0.026, crest: 0.016, bevel: 0.009, worn: base < 2.73 || (f.side === 'west' && i === 0),
          chip: i === 0 && (seed % 3 === 0) ? 'left' : undefined }, r);
      });
    }
  }
  // The outer jambs are thicker; the inner quoins sit on the existing curtain.
  for (const { z0, z1 } of WEST_PASSAGES) for (const side of [-1, 1]) {
    const r = rng(Math.round(z0 * 100 + side * 19));
    const edge = side === -1 ? z0 : z1;
    for (let i = 0; i < 6; i++) {
      const width = i % 2 === 0 ? 0.41 : 0.29;
      stone(b, m, west, { lo: side === -1 ? edge - width : edge + 0.012,
        hi: side === -1 ? edge - 0.012 : edge + width,
        low: i * 0.41 + 0.012, high: (i + 1) * 0.41 - 0.012,
        back: -0.038, toe: 0.056 + 0.016 * r(), crest: 0.042, bevel: 0.012, worn: true }, r);
    }
  }
}

/** A buried heel of wall core carries the snapped jamb at a real point on its
 * underside. Attach the heel and two split-off chips to their own GLB/fallback
 * so the bearing is replaced atomically along with the stone it supports. */
export function addReliefFooting(model: THREE.Group, stone: THREE.Material, p: Box, contact: THREE.Vector3): void {
  const grade = p.y0 ?? 0;
  const toModel = model.matrix.clone().invert();
  const positions: number[] = [];
  const face = (...points: THREE.Vector3[]) => points.forEach(v => v.toArray(positions, positions.length));
  type Offset = readonly [number, number, number];
  function fragment(x: number, z: number, y: number, rim: readonly Offset[]): void {
    const crest = new THREE.Vector3(x, y, z);
    const heel = new THREE.Vector3(x, grade - .065, z);
    const fitted = (u: number, v: number, h: number) => new THREE.Vector3(
      THREE.MathUtils.clamp(x + u, p.x0 + .006, p.x1 - .006), h,
      THREE.MathUtils.clamp(z + v, -p.z1 + .006, -p.z0 - .006));
    const top = rim.map(([dx, dz, h]) => fitted(dx * .79, dz * .77, grade + h));
    const bottom = rim.map(([dx, dz]) => fitted(dx, dz, grade - .065));
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      face(crest, top[j], top[i]);
      face(top[i], top[j], bottom[j]);
      face(top[i], bottom[j], bottom[i]);
      face(heel, bottom[i], bottom[j]);
    }
  }

  const h = contact.y - grade;
  fragment(contact.x, contact.z, contact.y + .028, [
    [-.24, -.045, h * .43], [-.14, -.19, h * .46], [.12, -.19, h * .37],
    [.23, -.063, h * .38], [.17, .081, h * .47], [-.06, .105, h * .51],
  ]);
  fragment(p.x0 + .27, -p.z0 - .106, grade + .13, [
    [-.17, -.028, .03], [-.10, -.11, .054], [.088, -.086, .087], [.12, .031, .035], [-.051, .084, .046],
  ]);
  fragment(p.x0 + .56, -p.z0 - .07, grade + .065, [
    [-.089, -.031, .019], [.007, -.091, .027], [.077, .024, .037], [-.032, .047, .016],
  ]);
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Derive normals on the final faces, then convert the fitted pieces back to
  // the same local space as the carving (the depth fit is non-uniform).
  g.computeVertexNormals();
  g.applyMatrix4(toModel);
  const mesh = new THREE.Mesh(g, stone);
  mesh.name = 'relief-fracture-bed';
  mesh.castShadow = mesh.receiveShadow = true;
  model.add(mesh);
}
