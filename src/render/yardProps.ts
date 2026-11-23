// Courtyard cover, built in local metres from each PROPS box's southwest corner.
// The collision/LOS volumes are intentionally coarse; no hardware, handles or
// leaning stock should leave those volumes or read as part of a walkable route.
import * as THREE from 'three';
import type { Box } from '../sim/level';
import type { Batch } from './geom';
import type { Materials } from './materials';
import type { Variants } from './materialVariants';

type YardIron = Pick<Materials, 'iron'>;
type YardFinishes = Pick<Variants, 'woodBeam' | 'woodPlank' | 'woodFloorOld' | 'wallTrim' | 'clothLinen'>;
type Point = [x: number, y: number, z: number];
type UV = [u: number, v: number];
const vec = ([x, y, z]: Point) => new THREE.Vector3(x, y, -z);
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const fract = (n: number) => n - Math.floor(n);

class Surface {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];

  tri(a: Point, b: Point, c: Point, u: UV, v: UV, w: UV): void {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...u, ...v, ...w);
  }

  quad(p: [Point, Point, Point, Point], uv: [UV, UV, UV, UV]): void {
    this.tri(p[0], p[1], p[2], uv[0], uv[1], uv[2]);
    this.tri(p[0], p[2], p[3], uv[0], uv[2], uv[3]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** Hewn section: small longitudinal arrises, end bevels, and a slight taper.
 * V follows the grain; U samples the interior of one plank in the shared scan
 * so a single rail doesn't look like several strips of decking glued together. */
function hewn(length: number, w: number, d: number, seed: number, taper: number, worn: boolean): THREE.BufferGeometry {
  const edge = Math.min(0.017, w * 0.16, d * 0.16);
  const bias = (fract(seed * 0.618) - 0.5) * edge;
  const ring = (y: number, scale: number, inset: number, offset: number): Point[] => {
    const x = w * scale / 2 - inset, z = d * scale / 2 - inset;
    const a = edge * (1.15 + bias / edge), b = edge * (0.85 - bias / edge);
    return ([[-x + a, -z], [x - b, -z], [x, -z + b], [x, z - a],
      [x - a, z], [-x + b, z], [-x, z - b], [-x, -z + a]]).map(([x, z]) => [x + offset, y, z]);
  };
  const rings = [ring(-length / 2, 1, edge * 0.55, 0), ring(-length / 2 + edge, 1, 0, 0),
    ring(length / 2 - edge, taper, 0, bias), ring(length / 2, taper, edge * 0.55, bias)];
  const s = new Surface();
  const v0 = fract(seed * 0.417);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const u = (worn ? 0.075 : (0.5 + ((seed + (i >> 1) * 2) % 8)) / 9);
    for (let k = 0; k < rings.length - 1; k++) {
      const [a, b] = [rings[k], rings[k + 1]];
      const span = Math.min(0.08, Math.hypot(a[j][0] - a[i][0], a[j][2] - a[i][2]) * 0.48);
      s.quad([a[i], b[i], b[j], a[j]], [[u - span / 2, v0 + a[i][1] * 0.63], [u - span / 2, v0 + b[i][1] * 0.63],
        [u + span / 2, v0 + b[j][1] * 0.63], [u + span / 2, v0 + a[j][1] * 0.63]]);
    }
  }
  const endUV = ([x, , z]: Point): UV => [0.5 + x * 0.43, v0 + z * 0.43];
  for (let i = 1; i < 7; i++) {
    const a = rings[0], b = rings[3];
    s.tri(a[0], a[i], a[i + 1], endUV(a[0]), endUV(a[i]), endUV(a[i + 1]));
    s.tri(b[0], b[i + 1], b[i], endUV(b[0]), endUV(b[i + 1]), endUV(b[i]));
  }
  return s.geometry();
}

class Yard {
  private readonly turn: THREE.Matrix4;

  constructor(private readonly b: Batch, p: Box, center: Point = [0, 0, 0], yaw = 0) {
    this.turn = new THREE.Matrix4().makeRotationY(yaw)
      .setPosition(vec([p.x0 + center[0], (p.y0 ?? 0) + center[1], p.z0 + center[2]]));
  }

  place(mat: THREE.Material, g: THREE.BufferGeometry, p: Point = [0, 0, 0], frame = new THREE.Matrix4()): void {
    frame.setPosition(vec(p)).premultiply(this.turn);
    this.b.add(g, mat, frame);
    if (g.index) g.dispose(); // Batch converts indexed geometry before taking ownership.
  }

  timber(mat: THREE.Material, a: Point, b: Point, w: number, d: number, face: Point,
    seed: number, taper = 1, worn = false): void {
    const axis = vec(b).sub(vec(a)), length = axis.length();
    axis.normalize();
    const normal = vec(face);
    normal.addScaledVector(axis, -normal.dot(axis)).normalize();
    const across = axis.clone().cross(normal);
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    this.place(mat, hewn(length, w, d, seed, taper, worn), mid, new THREE.Matrix4().makeBasis(across, axis, normal));
  }

  board(mat: THREE.Material, [x, y, z]: Point, [w, h, d]: Point, grain: 'x' | 'y' | 'z', seed: number, worn = false): void {
    if (grain === 'x') this.timber(mat, [x - w / 2, y, z], [x + w / 2, y, z], d, h, [0, 1, 0], seed, 1, worn);
    else if (grain === 'z') this.timber(mat, [x, y, z - d / 2], [x, y, z + d / 2], w, h, [0, 1, 0], seed, 1, worn);
    else this.timber(mat, [x, y - h / 2, z], [x, y + h / 2, z], w, d, [0, 0, 1], seed, 1, worn);
  }

  cylinder(mat: THREE.Material, p: Point, axis: Point, length: number, r0: number, r1 = r0, sides = 8): void {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, vec(axis).normalize());
    this.place(mat, new THREE.CylinderGeometry(r1, r0, length, sides), p, new THREE.Matrix4().makeRotationFromQuaternion(q));
  }
}

// Wheel cross-section in (radius, axial depth). The band has a rolled edge;
// the five wooden felloes stop just short of each other under the iron tyre.
function felloe(inner: number, outer: number, width: number, bevel: number, from: number, arc: number,
  steps: number, u: number, cap: boolean): THREE.BufferGeometry {
  const profile: [number, number][] = [[inner, -width / 2], [outer - bevel, -width / 2], [outer, -width / 2 + bevel],
    [outer, width / 2 - bevel], [outer - bevel, width / 2], [inner, width / 2]];
  const s = new Surface();
  const at = (i: number, j: number): Point => {
    const a = from + arc * i / steps, [r, z] = profile[j];
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  const uv = (i: number, j: number): UV => [u + (profile[j][0] - inner) * 0.50 + profile[j][1] * 0.10, (from + arc * i / steps) * 0.32];
  for (let i = 0; i < steps; i++) for (let j = 0; j < profile.length; j++) {
    const k = (j + 1) % profile.length;
    s.quad([at(i, j), at(i + 1, j), at(i + 1, k), at(i, k)], [uv(i, j), uv(i + 1, j), uv(i + 1, k), uv(i, k)]);
  }
  if (cap) for (let j = 1; j < profile.length - 1; j++) {
    s.tri(at(0, 0), at(0, j), at(0, j + 1), uv(0, 0), uv(0, j), uv(0, j + 1));
    s.tri(at(steps, 0), at(steps, j + 1), at(steps, j), uv(steps, 0), uv(steps, j + 1), uv(steps, j));
  }
  return s.geometry();
}

function cart(b: Batch, p: Box, m: YardIron, v: YardFinishes): void {
  const g = new Yard(b, p);
  const { woodBeam: beam, woodPlank: plank, woodFloorOld: repair } = v;
  const axle = 1.04, cy = 0.562;
  for (const side of [-1, 1]) {
    const cz = 0.70 + side * 0.550;
    const phase = side < 0 ? 0.17 : 0.28;
    for (let i = 0; i < 5; i++) {
      const a = phase + (i * 2 - 0.5) * TAU / 10;
      g.place(beam, felloe(0.449, 0.538, 0.094, 0.009, a + 0.003, TAU / 5 - 0.006, 8,
        (i + 0.32) / 9, true), [axle, cy, cz]);
    }
    g.place(m.iron, felloe(0.531, 0.562, 0.106, 0.007, phase, TAU, 40, 0.3, false), [axle, cy, cz]);
    for (let i = 0; i < 10; i++) {
      const a = phase + i * TAU / 10;
      const at = (r: number, dish: number): Point => [axle + r * Math.cos(a), cy + r * Math.sin(a), cz + side * dish];
      const replacement = side < 0 && i === 7;
      g.timber(replacement ? repair : beam, at(0.095, 0.045), at(0.465, 0), 0.064, 0.066,
        [0, 0, 1], i + 1, 0.70, replacement);
    }
    const offset = (z: number): Point => [axle, cy, cz + side * z];
    const axis: Point = [0, 0, side];
    g.cylinder(beam, offset(0.001), axis, 0.15, 0.096, 0.126, 12);
    g.cylinder(beam, offset(0.068), axis, 0.102, 0.127, 0.088, 12);
    g.cylinder(m.iron, offset(-0.061), axis, 0.027, 0.102, 0.112, 12);
    g.cylinder(m.iron, offset(0.095), axis, 0.033, 0.103, 0.096, 12);
    g.cylinder(m.iron, offset(0.127), axis, 0.033, 0.042, 0.038);
    g.cylinder(m.iron, offset(0.132), [0.16, 1, 0], 0.107, 0.010, 0.007, 6);

    const z = 0.70 + side * 0.31;
    // Full-length shafts carry both the cross axle and the hand grips.
    g.timber(beam, [0.11, 0.761, z], [2.18, 0.754, z + side * 0.022], 0.133, 0.14, [0, 1, 0], 5, 0.80);
    g.timber(beam, [2.145, 0.754, z + side * 0.022], [2.555, 0.716 + side * 0.007, z + side * 0.078],
      0.102, 0.108, [0, 1, 0], 8, 0.61);
    g.timber(beam, [2.26, 0.750, z + side * 0.037], [2.34 + side * 0.022, 0.015, z + side * 0.047],
      0.10, 0.096, [0, 0, 1], 9, 0.80);
    g.timber(plank, [1.91, 0.744, z], [2.31, 0.33, z + side * 0.04], 0.069, 0.048, [0, 0, 1], 3);

    const wall = 0.70 + side * 0.455;
    for (const [i, x] of [0.24, 0.70, 1.52, 2.05].entries()) {
      const top = side > 0 ? [1.536, 1.508, 1.488, 1.463][i] : [1.298, 1.277, 1.260, 1.247][i];
      g.timber(beam, [x, 0.788, wall - side * 0.046], [x + 0.015 * (i - 1), top, wall + side * 0.017],
        0.083, 0.075, [0, 0, 1], 3 + i, 0.90);
      // Square-cut heads where the sideboards actually contact the stakes.
      for (const y of (side > 0 ? [0.983, 1.181, 1.382] : [0.982, 1.178]))
        g.cylinder(m.iron, [x, y, wall + side * 0.039], [0, 0, side], 0.022, 0.015, 0.013, 4);
    }
    for (const [i, y] of (side > 0 ? [0.966, 1.176, 1.380] : [0.963, 1.172]).entries()) {
      const patched = side < 0 && i === 1;
      g.timber(plank, [0.15 + i * 0.021, y, wall - side * (0.017 - i * 0.019)],
        [2.145 - i * 0.017, y - i * 0.019, wall - side * (0.010 - i * 0.021)], 0.207 - i * 0.008, 0.051,
        [0, 0, 1], 2 + i + side, 0.96);
      if (patched) {
        g.timber(m.iron, [1.71, 1.062, wall - 0.020], [1.88, 1.241, wall - 0.032], 0.048, 0.014,
          [0, 0, 1], 4, 0.86);
        for (const [x, y, dz] of [[1.74, 1.094, 0.029], [1.85, 1.213, 0.037]])
          g.cylinder(m.iron, [x, y, wall - dz], [0, 0, -1], 0.014, 0.011, 0.010, 4);
      }
    }
  }
  g.cylinder(beam, [axle, cy, 0.70], [0, 0, 1], 1.32, 0.061, 0.061, 10);
  for (const z of [0.38, 1.02]) g.board(beam, [axle, 0.655, z], [0.192, 0.224, 0.184], 'x', 4);
  for (const x of [0.29, 1.05, 1.99]) g.board(beam, [x, 0.791, 0.70], [0.112, 0.099, 0.91], 'z', 3);
  for (const [i, z] of [0.325, 0.510, 0.699, 0.891, 1.075].entries())
    g.board(i === 3 ? repair : plank, [1.15 + i * 0.005, 0.852 - (i % 2) * 0.008, z], [2.0, 0.075, 0.175], 'x', 1 + i, i === 3);
  for (const [i, y] of [0.968, 1.175, 1.385].entries())
    g.board(plank, [0.173 + 0.008 * i, y, 0.70], [0.067, 0.203, 0.89 + 0.018 * i], 'z', i + 6);
  for (const [i, y] of [0.965, 1.172].entries())
    g.board(plank, [2.092 - 0.009 * i, y, 0.70], [0.063, 0.196, 0.89], 'z', i + 2);

  // Recovering a few dressed blocks: weight sits over the axle, not the handles.
  for (const [x, y, z, w, h, d, yaw] of [
    [0.55, 1.01, 0.68, 0.53, 0.29, 0.48, -0.11], [1.08, 1.025, 0.82, 0.48, 0.32, 0.43, 0.16],
    [1.55, 0.996, 0.55, 0.39, 0.26, 0.42, -0.14], [0.82, 1.311, 0.73, 0.61, 0.26, 0.39, 0.22],
  ]) new Yard(b, p, [x, y, z], yaw).board(v.wallTrim, [0, 0, 0], [w, h, d], 'x', 6);
  g.timber(beam, [1.44, 0.056, 0.157], [1.235, 0.022, 0.149], 0.142, 0.104, [0, 1, 0], 4, 0.38);
}

function scaffold(b: Batch, p: Box, m: YardIron, v: YardFinishes): void {
  const g = new Yard(b, p);
  const { woodBeam: beam, woodPlank: plank, woodFloorOld: repair } = v;
  for (const [i, [x, z, endX, endZ, y]] of [
    [0.16, 0.16, 0.208, 0.207, 2.25], [1.64, 0.16, 1.600, 0.194, 2.18],
    [0.18, 1.03, 0.209, 0.981, 1.94], [1.63, 1.01, 1.592, 0.983, 1.96],
  ].entries()) {
    g.board(plank, [x, 0.035, z], [0.286, 0.07, 0.244], 'x', i + 1);
    g.timber(beam, [x, 0.063, z], [endX, y, endZ], 0.153 + (i % 2) * 0.013, 0.146, [0, 0, 1], i + 2, 0.89);
  }
  // Two ledgers, then putlogs crossing them to carry the deck. The ends
  // of the crosspieces seat the plank load directly onto the ledger tops.
  for (const [i, z] of [0.255, 0.941].entries()) {
    g.timber(beam, [0.078, 1.540, z], [1.728, 1.565 - i * 0.014, z], 0.14, 0.157, [0, 1, 0], 2 + i);
    g.timber(beam, [0.128, 0.295, z], [1.684, 0.317 + i * 0.011, z], 0.112, 0.104, [0, 1, 0], 4 + i);
  }
  for (const [i, x] of [0.235, 0.941, 1.559].entries())
    g.board(beam, [x, 1.663, 0.599], [0.119, 0.098, 1.052], 'z', 4 + i);
  for (const [i, z] of [0.181, 0.387, 0.592, 0.798, 1.005].entries()) {
    g.timber(i === 3 ? repair : plank, [0.077 + i * 0.013, 1.749 - i * 0.002, z],
      [1.728 - (i % 3) * 0.032, 1.741 + (i % 2) * 0.013, z + i * 0.002],
      0.190, 0.077, [0, 1, 0], i + 1, 0.99, i === 3);
  }
  g.timber(beam, [0.14, 0.279, 0.115], [1.633, 1.548, 0.135], 0.128, 0.057, [0, 0, 1], 4);
  g.timber(beam, [1.683, 0.300, 1.024], [1.679, 1.518, 0.203], 0.120, 0.058, [1, 0, 0], 6, 0.91);
  g.timber(beam, [0.184, 0.973, 0.922], [0.650, 1.561, 0.907], 0.115, 0.081, [0, 0, 1], 5);
  g.timber(plank, [0.161, 2.110, 0.242], [1.657, 2.055, 0.234], 0.121, 0.058, [0, 0, 1], 7);
  g.timber(plank, [0.131, 1.834, 1.047], [1.675, 1.811, 1.027], 0.118, 0.049, [0, 0, 1], 1);
  for (const [x, z, side] of [[0.201, 0.18, -1], [1.60, 0.17, -1], [0.204, 1.00, 1], [1.598, 0.988, 1]]) {
    for (const y of [0.309, 1.536]) g.cylinder(beam, [x, y, z + side * 0.078], [0, 0, side], 0.034, 0.023, 0.021, 7);
  }
  for (const [x, y, z] of [[0.198, 0.324, 0.092], [1.589, 1.514, 0.111], [0.207, 2.105, 0.275], [1.604, 2.056, 0.268]])
    g.cylinder(m.iron, [x, y, z], [0, 0, z > 0.2 ? 1 : -1], 0.018, 0.016, 0.014, 4);

  g.timber(beam, [0.168, 1.167, 0.917], [1.643, 1.192, 0.917], 0.087, 0.091, [0, 1, 0], 3);

  // Reusable shuttering parked against the back ledger. Keep both ends
  // visibly open and let the staggered board tops frame the empty work bay.
  for (const [i, x] of [0.507, 0.727, 0.953, 1.179].entries())
    g.timber(i === 1 ? repair : plank, [x, 0.018, 0.614 + (i % 2) * 0.027],
      [x - 0.045 + i * 0.014, [1.421, 1.608, 1.54, 1.324][i], 0.965 - i * 0.009],
      0.202, 0.078, [0, 0, 1], 8 - i, 0.96, i === 1);
  for (const [i, [x, y, z]] of [[0.458, 0.081, 0.425], [0.449, 0.221, 0.416], [0.478, 0.348, 0.409]].entries())
    g.board(v.wallTrim, [x, y, z], [0.452 - i * 0.029, 0.155 - i * 0.012, 0.329 - i * 0.026], 'x', i + 3);
}

function crate(b: Batch, p: Box, m: YardIron, v: YardFinishes, base: Point, w: number, h: number, d: number, yaw: number, kind: number): void {
  const g = new Yard(b, p, base, yaw);
  const { woodBeam: beam, woodPlank: plank, woodFloorOld: repair } = v;
  // Vertical staves pinned to battens, with resting skids under the lower boxes.
  for (const z of [-d * 0.32, d * 0.32]) g.board(beam, [0, 0.035, z], [w - 0.04, 0.07, 0.083], 'x', 6);
  for (const axis of ['x', 'z'] as const) {
    const span = (axis === 'x' ? w : d), normal = (axis === 'x' ? d : w) / 2;
    const at = (u: number, y: number, n: number): Point => axis === 'x' ? [u, y, n] : [n, y, u];
    for (const side of [-1, 1]) {
      const face = at(0, 0, side);
      let edge = -span / 2 + 0.027;
      const widths = axis === 'x' ? [0.214, 0.171, 0.227, 0.188, 0.200] : [0.193, 0.211, 0.174, 0.232, 0.190];
      for (const [i, f] of widths.entries()) {
        const width = (span - 0.054) * f;
        const u = edge + width / 2;
        const n = side * (normal - 0.044 + ((i + kind) % 3) * 0.002);
        const patch = kind === 2 && side === -1 && axis === 'x' && i === 3;
        g.timber(patch ? repair : plank, at(u, 0.071, n), at(u + 0.003 * (i % 2), h - 0.060 - ((i + kind) % 3) * 0.007, n),
          width - 0.004, 0.042, face, i + 1 + kind, 0.986, patch);
        edge += width;
      }
      for (const y of [0.115, h - 0.108]) {
        g.timber(beam, at(-span / 2 + 0.006, y, side * (normal - 0.021)), at(span / 2 - 0.012, y + 0.005, side * (normal - 0.021)),
          0.080, 0.041, face, 3 + kind);
        for (const u of [-span / 2 + 0.073, span / 2 - 0.071])
          g.cylinder(m.iron, at(u, y, side * (normal + 0.002)), face, 0.012, 0.012, 0.010, 4);
      }
      const diag = kind === 1 ? -side : side;
      if (axis === 'x' || side === -1) g.timber(beam,
        at(diag * (span / 2 - 0.055), 0.148, side * (normal - 0.016)),
        at(-diag * (span / 2 - 0.061), h - 0.146, side * (normal - 0.016)), 0.087, 0.042, face, 6 + kind, 0.91);
    }
  }
  for (const x of [-w / 2 + 0.064, w / 2 - 0.064]) for (const z of [-d / 2 + 0.063, d / 2 - 0.063])
    g.board(beam, [x, (h + 0.014) / 2, z], [0.085, h - 0.104, 0.082], 'y', 8);
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * d / 5;
    g.board(kind === 2 && i === 1 ? repair : plank, [kind === 2 && i < 2 ? 0.025 : 0, h - 0.028 + (i % 2) * 0.003, z],
      [w - 0.043, 0.055, d / 5 - 0.009], 'x', 2 + i, kind === 2 && i === 1);
  }
  if (kind !== 2) return;

  // A folded packing cloth caught under the lid, not a separate prop. Broad
  // weighted folds and one frayed corner rather than uniform sine-wave ruffles.
  const s = new Surface();
  const cloth = (u: number, t: number): Point => {
    const fold = (Math.sin(u * 16 + t * 1.3) + 0.45 * Math.sin(u * 26 - t * 1.7)) * 0.014;
    const hem = 0.245 + u * 0.092 - 0.064 * Math.exp(-((u - 0.83) ** 2) / 0.008);
    return [-w * 0.26 + u * 0.356 + t * (0.032 - 0.016 * u), h + 0.011 - hem * t * t + fold * (1 - t),
      d / 2 + 0.033 - 0.235 * (1 - t) ** 5 + fold * t];
  };
  for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) {
    const uv: [UV, UV, UV, UV] = [[i / 10, j / 8], [(i + 1) / 10, j / 8], [(i + 1) / 10, (j + 1) / 8], [i / 10, (j + 1) / 8]];
    const [a, b, c, d] = uv.map(([u, t]) => cloth(u, t));
    s.quad([a, b, c, d], uv); s.quad([d, c, b, a], [uv[3], uv[2], uv[1], uv[0]]);
  }
  g.place(v.clothLinen, s.geometry());
}

export function addYardProp(b: Batch, p: Box, m: YardIron, v: YardFinishes): void {
  if (p.tag === 'cart') cart(b, p, m, v);
  else if (p.tag === 'scaffold') scaffold(b, p, m, v);
  else if (p.tag === 'crateStack') {
    crate(b, p, m, v, [0.488, 0, 0.488], 0.870, 0.865, 0.855, 0.038, 0);
    crate(b, p, m, v, [1.205, 0, 1.202], 0.683, 0.666, 0.706, -0.097, 1);
    crate(b, p, m, v, [0.504, 0.863, 0.494], 0.735, 0.743, 0.750, -0.112, 2);
  }
}
