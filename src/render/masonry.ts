import * as THREE from 'three';
import type { Box } from '../sim/level';
import type { Batch } from './geom';

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
  bevel: number; chip?: 'left' | 'right'; drop?: number; exposedBack?: boolean;
}

// A face is authored in simulation coordinates: u increases along x or z and
// depth is measured into the yard. Never rotate a whole block out of its envelope.
const west: Face = { side: 'west', plane: -10 };
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
  const tri = (a: Pt, p: Pt, q: Pt): void => {
    // Dominant-plane projection gives every bevel and corner a valid UV basis,
    // including the nearly edge-on returns with no area in the wall plane.
    const [ax, ay, az] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const [bx, by, bz] = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
    const axis = nx > ny && nx > nz ? 0 : ny > nz ? 1 : 2;
    const us = Math.min(su, (axis === 0 ? ds : w) * 0.52);
    const vs = Math.min(sv, (axis === 1 ? ds : h) * 0.52);
    for (const v of reverse ? [a, q, p] : [a, p, q]) {
      pos.push(...world(f, v));
      uv.push(cu + us * ((axis === 0 ? (v[2] - d0) / ds : (v[0] - s.lo) / w) - 0.5),
        cv + vs * ((axis === 1 ? (v[2] - d0) / ds : (v[1] - s.low) / h) - 0.5));
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
        || (f.side === 'north' && mid > -2.7 && mid < 0.9)
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
    old(x0 - 0.08, z0 - 0.08, x1 - 0.003, z1 + 0.08);
    foot(b, m, { ...west, lo: z0 + 0.58, hi: z1 - 0.58 });
  } else if (h === 4 && z0 === north.plane) {
    old(x0 - 0.08, z0 + 0.003, x1 + 0.08, z1 + 0.08);
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
      bevel: 0.018, chip: n === 1 && kind !== 'full' ? 'left' : undefined }, r, n === 0 || (kind === 'rebuilt' && n === 2));
    y = high + 0.012;
    n++;
  }
  const cap = kind === 'stump' ? 0.18 : 0.229;
  stone(b, m, f, { lo: at - cap, hi: at + cap, low: y, high: top, back: -0.045,
    toe: 0.157, crest: kind === 'stump' ? 0.035 : 0.053, bevel: 0.022,
    chip: kind === 'stump' ? 'right' : undefined, drop: kind === 'stump' ? 0.075 : 0 }, r);
}

function coping(b: Batch, m: Fabric, f: Course, y: number, seed: number): void {
  const r = rng(seed);
  bond(f.lo, f.hi, 1.18, r, (lo, hi, i) => {
    const split = i % 11 === 3 || i % 13 === 7;
    stone(b, m, f, { lo, hi, low: y - 0.023, high: y + (split ? 0.060 : 0.085 + r() * 0.016),
      back: -0.492, toe: -0.006, crest: -0.022, bevel: 0.013,
      chip: split ? (i % 2 ? 'left' : 'right') : undefined,
      drop: split ? 0.018 : 0, exposedBack: true }, r);
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
  support(b, m, west, 7, 3.71, 'full'); // seated under the walk's bearing course
  support(b, m, west, 14, 1.01, 'stump'); // truncated clear of the lamp bracket
  support(b, m, west, 21, 2.64, 'stump');
  support(b, m, east, 24, 3.70, 'rebuilt');
  support(b, m, south, -7, 4.18, 'full');

  repair(b, m, west, 417, [[9.38, 12.62, 0.55, 0.83], [9.58, 12.45, 0.85, 1.15],
    [9.86, 12.63, 1.16, 1.47], [9.93, 12.02, 1.49, 1.86], [10.20, 11.52, 1.88, 2.20]]);
  repair(b, m, north, 857, [[-2.7, 0.92, 0.55, 0.80], [-2.30, 0.61, 0.82, 1.09], [-1.85, 0.18, 1.11, 1.40]]);
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
