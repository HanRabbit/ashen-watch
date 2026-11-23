import * as THREE from 'three';
import type { Batch } from './geom';
import type { Materials } from './materials';
import type { Variants } from './materialVariants';

type BreakMaterials = Pick<Materials, 'flag'>;
type BreakVariants = Pick<Variants, 'floorDirt' | 'floorFlagWorn' | 'rock'>;

type XZ = [x: number, z: number];
type Outline = XZ[];
// An old flag retains its own quarry face; a laid repair or a loose spall doesn't.
type Face = 'old' | 'repair' | 'spall';
interface Stone {
  outline: Outline;
  face: Face;
  height: number;
  tilt: XZ; // rise per metre in the two local directions
}
interface Break {
  origin: XZ;
  bed: Outline;
  stones: Stone[];
}

function stone(face: Face, height: number, tilt: XZ, outline: Outline): Stone {
  return { face, height, tilt, outline };
}

// Survey in local metres, CCW as seen from above (+sim Z is north). The large
// surviving edges follow particular joints in the 3.6 m monastery scan, rather
// than drawing an unrelated patch across half a dozen undamaged stone faces.
const wheel: Break = {
  origin: [-3.05, 9.65],
  bed: [[0.22, 0.38], [0.44, 0.46], [0.70, 0.47], [0.82, 0.52], [1.05, 0.49], [1.17, 0.54],
    [1.37, 0.46], [1.53, 0.39], [1.68, 0.41], [1.87, 0.40], [1.99, 0.48], [2.04, 0.97],
    [1.96, 1.14], [1.69, 1.19], [1.42, 1.23], [1.25, 1.37], [1.16, 1.43], [0.94, 1.31],
    [0.76, 1.27], [0.60, 1.28], [0.39, 1.20], [0.21, 1.14], [0.13, 1.01], [0.18, 0.84], [0.30, 0.61]],
  stones: [
    // Wheel pressure has tipped one half into its bed. Its mate still has
    // the ragged diagonal fracture, but the toe between the two is gone.
    stone('old', 0.024, [-0.018, 0.014], [[0.20, 1.01], [0.33, 0.74], [0.44, 0.63], [0.66, 0.65],
      [0.75, 0.72], [0.88, 0.74], [0.91, 0.89], [1.02, 1.00], [1.02, 1.10], [1.15, 1.26],
      [1.09, 1.34], [0.91, 1.25], [0.66, 1.22], [0.48, 1.20], [0.25, 1.11]]),
    stone('old', 0.016, [0.012, -0.010], [[0.93, 0.60], [1.20, 0.57], [1.22, 0.79], [1.21, 1.04],
      [1.18, 1.18], [1.065, 1.076], [1.06, 0.981], [0.963, 0.865], [0.941, 0.729]]),
    stone('old', 0.028, [0.020, -0.008], [[1.40, 0.58], [1.54, 0.51], [1.84, 0.47], [1.94, 0.51],
      [1.99, 0.96], [1.91, 1.11], [1.70, 1.155], [1.54, 1.14], [1.55, 1.01], [1.47, 0.96], [1.44, 0.81], [1.36, 0.74]]),
    stone('spall', 0.014, [-0.031, 0.016], [[1.29, 0.87], [1.38, 0.84], [1.44, 0.98], [1.49, 1.02], [1.48, 1.10], [1.39, 1.06]]),
    stone('spall', 0.011, [0.016, 0.01], [[0.51, 0.52], [0.64, 0.52], [0.75, 0.58], [0.63, 0.59], [0.54, 0.57]]),
  ],
};

const scaffold: Break = {
  origin: [-6.50, 16.30],
  bed: [[0.20, 0.99], [0.34, 0.97], [0.56, 1.01], [0.78, 1.03], [0.98, 1.00], [1.14, 1.04],
    [1.36, 0.97], [1.51, 0.94], [1.72, 0.98], [1.88, 1.03], [2.01, 1.05], [1.92, 1.11],
    [1.85, 1.28], [1.84, 1.56], [1.75, 1.69], [1.39, 1.73], [1.26, 1.76], [1.15, 1.83],
    [0.98, 1.91], [0.85, 1.98], [0.74, 1.91], [0.60, 1.85], [0.41, 1.83], [0.20, 1.75], [0.13, 1.69],
    [0.12, 1.52], [0.20, 1.36], [0.29, 1.17]],
  stones: [
    // The yard crew packed the low bearing surface with hand-set offcuts.
    // Butt the sawn ends together but leave the outside quarry edges untrimmed.
    stone('repair', 0.031, [-0.014, 0.005], [[0.26, 1.58], [0.37, 1.42], [0.76, 1.46], [0.88, 1.49],
      [0.81, 1.83], [0.70, 1.84], [0.53, 1.77], [0.33, 1.76], [0.22, 1.67]]),
    stone('repair', 0.023, [0.008, 0.018], [[0.39, 1.10], [0.61, 1.08], [0.95, 1.11], [0.89, 1.43],
      [0.72, 1.43], [0.36, 1.39], [0.32, 1.30]]),
    stone('repair', 0.020, [-0.014, -0.006], [[0.93, 1.47], [1.08, 1.44], [1.23, 1.46], [1.26, 1.60],
      [1.14, 1.72], [0.99, 1.79], [0.87, 1.82]]),
    stone('old', 0.021, [0.017, -0.008], [[1.36, 1.03], [1.67, 1.01], [1.81, 1.08], [1.80, 1.33],
      [1.78, 1.55], [1.70, 1.65], [1.42, 1.68], [1.29, 1.64], [1.29, 1.49], [1.36, 1.38], [1.38, 1.22]]),
    stone('spall', 0.016, [0.026, -0.012], [[1.00, 1.12], [1.20, 1.10], [1.31, 1.16], [1.28, 1.23], [1.07, 1.22], [0.99, 1.18]]),
    stone('spall', 0.013, [0.008, 0.025], [[1.12, 1.273], [1.29, 1.27], [1.32, 1.32], [1.22, 1.37], [1.08, 1.35]]),
  ],
};

const wallToe: Break = {
  origin: [-5.90, 23.95],
  bed: [[0.28, 0.55], [0.55, 0.54], [0.71, 0.48], [0.98, 0.43], [1.20, 0.54], [1.48, 0.57],
    [1.74, 0.56], [1.80, 0.37], [1.90, 0.26], [2.01, 0.23], [2.05, 0.35], [2.16, 0.48],
    [2.27, 0.55], [2.40, 0.62], [2.49, 0.60], [2.60, 0.63], [2.78, 0.58], [2.89, 0.64],
    [2.76, 0.77], [2.79, 0.98], [2.69, 1.12], [2.47, 1.17], [2.34, 1.23], [2.20, 1.40],
    [1.90, 1.42], [1.64, 1.36], [1.56, 1.21], [1.42, 1.14], [1.22, 1.13], [1.09, 1.22],
    [0.86, 1.19], [0.75, 1.23], [0.64, 1.31], [0.52, 1.20], [0.52, 1.01], [0.47, 0.82], [0.36, 0.72]],
  stones: [
    // Runoff lost the fine bedding at the wall toe. Broad plates remain
    // upstream; thin flakes have lodged edge-first across the outlet.
    stone('old', 0.022, [-0.018, 0.008], [[0.54, 0.73], [0.68, 0.58], [0.94, 0.50], [1.12, 0.58],
      [1.17, 0.74], [1.08, 0.85], [1.05, 0.95], [0.90, 0.99], [0.77, 1.15], [0.61, 1.20], [0.56, 1.01]]),
    stone('spall', 0.024, [-0.017, 0.013], [[1.02, 1.02], [1.17, 0.84], [1.29, 0.81], [1.40, 0.87], [1.34, 0.98], [1.12, 1.11], [0.97, 1.13]]),
    stone('spall', 0.018, [0.022, 0.028], [[1.32, 0.68], [1.52, 0.64], [1.73, 0.70], [1.61, 0.80], [1.45, 0.79]]),
    stone('spall', 0.015, [-0.026, 0.022], [[1.46, 0.92], [1.69, 0.80], [1.84, 0.77], [1.85, 0.83], [1.60, 1.01], [1.43, 1.05]]),
    stone('spall', 0.013, [-0.025, 0.018], [[1.86, 0.50], [1.93, 0.49], [2.05, 0.61], [2.01, 0.66], [1.92, 0.61]]),
    stone('spall', 0.011, [-0.011, 0.014], [[1.88, 0.39], [1.94, 0.37], [2.00, 0.45], [1.96, 0.47]]),
    stone('old', 0.027, [0.014, 0.005], [[2.20, 0.68], [2.36, 0.68], [2.48, 0.74], [2.60, 0.70],
      [2.72, 0.77], [2.73, 0.98], [2.64, 1.07], [2.45, 1.12], [2.33, 1.19], [2.19, 1.29], [2.06, 1.31],
      [2.08, 1.12], [2.15, 1.02], [2.13, 0.89]]),
  ],
};

const contour = (r: Outline) => r.map(([x, z]) => new THREE.Vector2(x, z));
const bedHeight = (x: number, z: number) => 0.004 + 0.0019 * Math.sin(2.9 * x + 4.2 * z);
const finish = (pos: number[], uv: number[]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
};

function bedding(b: Batch, v: BreakVariants, { origin, bed, stones }: Break): void {
  // Actual holes, not a second floor behind the stones. Their footprints
  // are exactly the stones' outer profiles; there are no overlapping caps.
  const loops = [bed, ...stones.map(s => s.outline)];
  const points = loops.flat();
  const tris = THREE.ShapeUtils.triangulateShape(contour(bed), loops.slice(1).map(contour));
  const pos: number[] = [], uv: number[] = [];
  for (const tri of tris) for (const i of tri) {
    const [x, z] = points[i];
    // A compacted bed is lower than even the slipped flag, but never lies
    // on the intact y=0 scan. Its thickness varies 2–6 mm, not a raised rim.
    const y = bedHeight(x, z);
    pos.push(x, y, -z);
    // Keep the exposed wet fines on a mostly bare-earth part of the mud scan.
    uv.push(0.21 + 0.105 * x, 0.68 + 0.091 * z);
  }
  // The substrate edge disappears into the existing paving, even edge-on.
  for (let i = 0; i < bed.length; i++) {
    const [a, c] = [bed[i], bed[(i + 1) % bed.length]];
    for (const [point, bottom] of [[a, 1], [c, 1], [a, 0], [c, 1], [c, 0], [a, 0]] as const) {
      const [x, z] = point, y = bottom ? -0.005 : bedHeight(x, z);
      pos.push(x, y, -z); uv.push(0.21 + 0.105 * x + y * 0.08, 0.68 + 0.091 * z + y * 0.07);
    }
  }
  b.geo(v.floorDirt, finish(pos, uv), origin[0], 0, origin[1]);
}

// Centres inside individual stone_pavers scan blocks, not in their mortar.
const dressed: XZ[] = [[0.28, 0.87], [0.60, 0.62], [0.25, 0.37]];
function brokenStone(b: Batch, m: BreakMaterials, v: BreakVariants, origin: XZ, s: Stone, index: number): void {
  const ring = s.outline, n = ring.length;
  const cx = ring.reduce((a, p) => a + p[0], 0) / n, cz = ring.reduce((a, p) => a + p[1], 0) / n;
  const seat = -0.005;
  const pos: number[] = [], uv: number[] = [];
  const chips = ring.map((_, i) => (0.007 + 0.011 * ((i * 7 + index) % 5) / 4) * (s.face === 'spall' ? 0.42 : 1));
  const cap = ring.map(([x, z], i): XZ => {
    const inset = Math.min(chips[i] / Math.hypot(x - cx, z - cz), 0.13);
    return [x - (x - cx) * inset, z - (z - cz) * inset];
  });
  const point = (i: number, layer: 'seat' | 'break' | 'face'): void => {
    const [x, z] = ring[i];
    const dx = x - cx, dz = z - cz, len = Math.hypot(dx, dz);
    const top = s.height + dx * s.tilt[0] + dz * s.tilt[1];
    const [px, pz] = layer === 'face' ? cap[i] : ring[i];
    const y = layer === 'seat' ? seat : layer === 'face' ? top : top - chips[i] * 0.55;
    pos.push(px, y, -pz);
    // Retained pieces keep the parent flag's UV across the fracture. A repair
    // samples a single cut face; exposed shale samples continuous quarry rock.
    // Unfold side UVs away from the cap so the vertical edge isn't a streak.
    const under = (top - y) / len;
    const u = px + dx * under, w = pz + dz * under;
    if (s.face === 'old') uv.push((origin[0] + u + 10.5) / 3.6, (origin[1] + w) / 3.6);
    else if (s.face === 'repair') {
      const [a, c] = dressed[index % dressed.length]; uv.push(a + (u - cx) * 0.25, c + (w - cz) * 0.25);
    } else uv.push(0.11 + index * 0.247 + u * 0.37, 0.32 + index * 0.12 + w * 0.44);
  };
  for (const tri of THREE.ShapeUtils.triangulateShape(contour(cap), [])) for (const i of tri) point(i, 'face');
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const [low, high] of [['seat', 'break'], ['break', 'face']] as const) {
      point(i, low); point(j, low); point(i, high);
      point(j, low); point(j, high); point(i, high);
    }
  }
  b.geo(s.face === 'old' ? m.flag : s.face === 'repair' ? v.floorFlagWorn : v.rock,
    finish(pos, uv), origin[0], 0, origin[1]);
}

/** Three shallow yard failures; all offsets are visual only, in simulation metres. */
export function addYardBreaks(b: Batch, m: BreakMaterials, v: BreakVariants): void {
  for (const site of [wheel, scaffold, wallToe]) {
    bedding(b, v, site);
    site.stones.forEach((s, i) => brokenStone(b, m, v, site.origin, s, i));
  }
}
