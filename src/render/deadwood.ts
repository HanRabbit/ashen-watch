import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Local render coordinates in metres. The three leaders split at different
// heights. The smaller branches emerge partway along those leaders.
type Knot = readonly [x: number, y: number, z: number, radius: number];
interface Limb { knots: readonly Knot[]; broken?: boolean }
const trunk: readonly Knot[] = [
  [0, -.24, 0, .32], [.025, .06, .01, .31], [-.06, .37, .055, .239],
  [-.05, .86, .10, .196], [.13, 1.48, .03, .172], [.24, 2.10, -.06, .154],
  [.19, 2.85, -.10, .127], [.39, 3.70, -.04, .108], [.49, 4.70, .06, .081], [.34, 6.08, .16, .065],
];
const lowArm: readonly Knot[] = [
  trunk[4], [-.23, 1.82, .26, .089], [-.62, 2.10, .38, .064], [-.82, 2.61, .52, .045],
  [-1.18, 2.82, .54, .029], [-1.42, 3.03, .56, .022],
];
const highArm: readonly Knot[] = [
  trunk[5], [.60, 2.39, .09, .099], [.86, 2.97, .27, .075], [1.21, 3.27, .32, .054],
  [1.37, 3.94, .45, .035], [1.54, 4.19, .50, .018], [1.58, 4.46, .54, .0045],
];
const backArm: readonly Knot[] = [
  trunk[6], [.10, 3.07, -.49, .074], [-.18, 3.43, -.75, .059], [-.26, 3.49, -1.03, .041],
  [-.51, 3.83, -1.34, .024], [-.59, 4.11, -1.43, .016],
];
// Child collars start inside the parent. The shoulder is larger than the child
// shaft, and spreads the attachment across the parent's surface.
const fork = (base: Knot, ...ends: Knot[]): readonly Knot[] => [[base[0], base[1], base[2], ends[0][3] * 1.32], ...ends];
const limbs: readonly Limb[] = [
  { knots: trunk, broken: true },
  { knots: fork(lowArm[0], ...lowArm.slice(1)), broken: true },
  { knots: fork(highArm[0], ...highArm.slice(1)) },
  { knots: fork(backArm[0], ...backArm.slice(1)), broken: true },
  { knots: fork(trunk[3], [-.19, 1.06, -.13, .066], [-.37, 1.25, -.27, .041]), broken: true },
  { knots: fork(trunk[7], [.16, 4.09, .16, .069], [-.15, 4.48, .30, .051],
    [-.48, 4.72, .32, .036], [-.61, 5.20, .42, .017], [-.84, 5.37, .40, .004]) },
  { knots: fork(trunk[8], [.73, 5.05, -.16, .045], [.84, 5.39, -.37, .031]), broken: true },
  { knots: fork(lowArm[2], [-.94, 2.22, .67, .036], [-1.28, 2.19, .81, .025],
    [-1.58, 2.32, .86, .016], [-1.74, 2.27, .98, .004]) },
  { knots: fork(lowArm[3], [-.84, 2.90, .36, .027], [-1.01, 3.17, .36, .019], [-.97, 3.44, .44, .005]) },
  { knots: fork(highArm[2], [1.03, 3.03, .59, .040], [1.13, 3.22, .81, .028],
    [1.35, 3.34, .99, .020], [1.50, 3.56, 1.07, .004]) },
  { knots: fork(highArm[3], [1.21, 3.59, .10, .029], [1.07, 3.85, .06, .019], [1.14, 4.06, -.04, .005]) },
  { knots: fork(backArm[2], [-.12, 3.78, -.91, .030], [-.31, 4.03, -1.08, .018], [-.28, 4.28, -1.18, .004]) },
  { knots: fork(backArm[3], [-.57, 3.59, -1.05, .024], [-.77, 3.76, -1.23, .017], [-1.01, 3.79, -1.32, .005]) },
  // Buttress roots emerge from low down on the flared trunk; each tapered toe
  // turns back into the soil. Uneven lengths leave the foot broken up in plan.
  { knots: [[-.03, .23, .08, .19], [-.29, .10, .29, .144], [-.57, .018, .45, .086], [-.94, -.09, .62, .014]] },
  { knots: [[.05, .26, -.025, .184], [.32, .11, -.21, .138], [.63, .024, -.33, .082], [.93, -.08, -.36, .014]] },
  { knots: [[.02, .18, .06, .155], [.15, .075, .34, .133], [.24, .024, .61, .067], [.48, -.09, .90, .012]] },
  { knots: [[-.10, .13, -.08, .145], [-.34, .06, -.26, .111], [-.49, -.012, -.48, .058], [-.56, -.09, -.66, .012]] },
  { knots: [[.11, .14, -.08, .13], [.21, .07, -.36, .099], [.13, .008, -.63, .06], [.21, -.09, -.89, .013]] },
];

const bark = new THREE.Color(0x51463e);
const dryWood = new THREE.Color(0x827568);
const cutWood = new THREE.Color(0x928373);
const mix = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const tau = 2 * Math.PI;

/** Continuous bent rings with longitudinal checks and an uneven splintered cap. */
function makeLimb(limb: Limb, seed: number): THREE.BufferGeometry {
  const { knots } = limb;
  const axis = new THREE.CatmullRomCurve3(knots.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const widest = Math.max(...knots.map(k => k[3]));
  const sides = widest > .20 ? 24 : widest > .085 ? 14 : widest > .036 ? 9 : 7;
  const rows = Math.max(4, Math.ceil(axis.getLength() / (widest > .20 ? .14 : .18)));
  const frames = axis.computeFrenetFrames(rows, false);
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const point = new THREE.Vector3(), radial = new THREE.Vector3(), color = new THREE.Color();
  const rowPoint = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    const u = j / rows;
    const t = axis.getUtoTmapping(u, 0);
    const knotAt = t * (knots.length - 1);
    const k = Math.min(knots.length - 2, Math.floor(knotAt));
    const r = mix(knots[k][3], knots[k + 1][3], knotAt - k);
    axis.getPoint(t, rowPoint);
    for (let i = 0; i < sides; i++) {
      const a = i / sides * tau;
      // Broad bark plates follow the bent grain with a slight twist. Narrow darker
      // crevices sit in the valleys. Their amplitude falls with branch diameter.
      const angle = a + .11 * Math.sin(u * 5.1 + seed);
      const fluting = .55 * Math.sin(a * 3 + u * 2.5 + seed) + .26 * Math.cos(a * 5 - u * 6 + seed);
      const check = Math.pow(.5 + .5 * Math.sin(a * (sides > 14 ? 7 : 4) + u * 4 + seed), 3);
      const radius = r * (1 + .14 * fluting - .135 * check);
      radial.copy(frames.normals[j]).multiplyScalar(Math.cos(angle)).addScaledVector(frames.binormals[j], Math.sin(angle));
      point.copy(rowPoint).addScaledVector(radial, radius);
      const splinter = .55 * Math.sin(a * 3 + seed) + .30 * Math.cos(a * 5 - seed);
      if (limb.broken && j >= rows - 1) {
        point.addScaledVector(frames.tangents[j], r * (j === rows ? splinter * 1.35 : splinter * .22));
      }
      positions.push(point.x, point.y, point.z);
      const scar = Math.max(0, Math.cos(a - seed + u * .92) - .86) * (j > rows - 3 && limb.broken ? 4.3 : .8);
      const grain = Math.sin(u * 17 - a * 2 + seed) * .055 + .11 * fluting;
      const foot = mix(.65, 1, clamp((point.y + .06) / .65, 0, 1));
      color.copy(bark).lerp(dryWood, scar).multiplyScalar(foot * (1 + grain - .28 * check));
      colors.push(color.r, color.g, color.b);
      if (j < rows) {
        const p = j * sides + i, right = j * sides + (i + 1) % sides;
        indices.push(p, right, p + sides, right, right + sides, p + sides);
      }
    }
  }
  for (const row of [0, rows]) {
    const cap = positions.length / 3;
    const outer = row * sides;
    const isFracture = row === rows && limb.broken;
    for (let i = 0; i < sides; i++) {
      const p = (outer + i) * 3;
      positions.push(positions[p], positions[p + 1], positions[p + 2]);
      // The rim of exposed end grain stays darker where the bark broke away.
      if (isFracture) {
        color.copy(cutWood).multiplyScalar(.64 + .23 * Math.sin(i * 2.1 + seed) ** 2);
        colors.push(color.r, color.g, color.b);
      } else {
        colors.push(colors[p], colors[p + 1], colors[p + 2]);
      }
      const next = (i + 1) % sides;
      if (row === 0) indices.push(cap + i, cap + sides, cap + next);
      else indices.push(cap + i, cap + next, cap + sides);
    }
    axis.getPointAt(row === 0 ? 0 : 1, point);
    if (isFracture) point.addScaledVector(frames.tangents[row], -knots[knots.length - 1][3] * .39);
    positions.push(point.x, point.y, point.z);
    color.copy(isFracture ? cutWood : bark);
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildDeadwood(material: THREE.MeshStandardMaterial): THREE.Mesh {
  // Each foot is beyond the paved footprint, on the flat -.62 m valley bench.
  // The west tree now stands past the gable's east shoulder. Its crown frames
  // the opening from the south hall; the roots stay outside both slab edges.
  const sites = [
    { x: -12.44, z: 27.35, yaw: .04, scale: 1, seed: 12 },
    { x: 12.5, z: 31, yaw: 2.2, scale: .83, seed: 29 },
  ];
  const pieces = sites.flatMap(site => limbs.map((limb, i) => makeLimb(limb, site.seed + i * 1.47)
    .scale(site.scale, site.scale, site.scale).rotateY(site.yaw).translate(site.x, -.62, -site.z)));
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'exterior deadwood';
  return mesh;
}
