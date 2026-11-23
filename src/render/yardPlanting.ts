import * as THREE from 'three';
import { Batch } from './geom';
import { ivyLeafTexture } from './materials';

// Plants take hold at a specific damp joint, not at a regular interval along every wall.
// (x,z) is the wall plane; tx/tz is the direction along it, nx/nz points into air.
interface Root {
  x: number; z: number; tx: number; tz: number; nx: number; nz: number;
  h: number; spread: number; vigor: number;
}
const north = (x: number, h: number, spread: number, vigor: number): Root =>
  ({ x, z: 28.46, tx: 1, tz: 0, nx: 0, nz: -1, h, spread, vigor });
const west = (z: number, h: number, spread: number, vigor: number): Root =>
  ({ x: -9.96, z, tx: 0, tz: 1, nx: 1, nz: 0, h, spread, vigor });
const roots: Root[] = [
  north(-8.84, 3.98, 1.16, 1), north(-8.47, 3.52, -0.72, 0.95), north(-7.91, 2.99, 0.70, 0.86),
  north(-6.04, 1.78, -0.63, 0.74), north(-3.52, 2.30, -0.77, 0.80),
  north(7.89, 1.78, 0.51, 0.67),
  west(6.82, 3.27, 0.67, 0.78), west(7.42, 2.76, -0.83, 0.83), west(16.6, 2.50, 1.1, 0.75),
  west(23.0, 3.69, 0.42, 0.94), west(23.18, 3.17, -0.41, 0.87), west(24.07, 1.64, 0.56, 0.71),
  { x: -5.8, z: 0.54, tx: 1, tz: 0, nx: 0, nz: 1, h: 2.74, spread: 0.89, vigor: 0.77 },
  { x: 9.96, z: 23.8, tx: 0, tz: 1, nx: -1, nz: 0, h: 2.58, spread: -0.76, vigor: 0.86 },
  { x: 12.96, z: 12.8, tx: 0, tz: 1, nx: -1, nz: 0, h: 3.38, spread: 0.72, vigor: 0.74 },
];

// Leeward piles collect beneath the main roots, wall returns and around the well apron.
export const YARD_LITTER_POCKETS: readonly (readonly [number, number, number, number, number])[] = [
  [-8.6, 27.83, 1.44, 0.60, 41], [-5.7, 27.93, 1.05, 0.38, 21], [-2.8, 28.11, 1.62, 0.34, 21],
  [2.07, 27.90, 1.05, 0.38, 17], [8.80, 27.72, 0.85, 0.52, 20],
  [-9.57, 7.23, 0.38, 1.17, 28], [-9.51, 22.39, 0.52, 1.66, 35],
  [-7.83, 20.72, 0.64, 0.71, 13], [-6.21, 0.86, 1.06, 0.33, 17],
  [9.44, 23.31, 0.39, 1.01, 21], [2.15, 14.83, 0.53, 0.44, 18], [3.81, 11.36, 0.65, 0.31, 13],
];

/** Continuous old stems taper into attached, flatter leaf sprays, with an open wall elsewhere. */
export function buildYardIvy(parent: THREE.Group, stems: Batch, rng: () => number): void {
  const palette = [0x522b20, 0x5c2925, 0x713821, 0x602a21, 0x804725, 0x3d3d29].map((c) => new THREE.Color(c));
  const wood = new THREE.MeshStandardMaterial({ color: 0x3b3025, roughness: 0.93 });
  const leaf = new THREE.MeshStandardMaterial({ map: ivyLeafTexture(), roughness: 0.86, side: THREE.DoubleSide, alphaTest: 0.39 });
  const transforms: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const v = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  const edge = new THREE.Euler(0, 0, 0, 'YXZ');
  const offset = (r: Root, u: number, y: number, d: number): THREE.Vector3 =>
    new THREE.Vector3(u * r.tx + d * r.nx, y, -(u * r.tz + d * r.nz));
  const point = (r: Root, u: number, y: number, d: number): THREE.Vector3 =>
    offset(r, u, y, d).add(new THREE.Vector3(r.x, 0, -r.z));

  for (const r of roots) {
    const phase = rng() * Math.PI * 2;
    const trunk = (t: number): THREE.Vector3 => point(r,
      r.spread * t * t * 0.76 + Math.sin(t * 10 + phase) * 0.17 * Math.sin(t * Math.PI),
      r.h * t, 0.087 + 0.015 * Math.sin(t * 12 + phase));
    stems.geo(wood, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
      Array.from({ length: 10 }, (_, i) => trunk(i / 9))), 16, 0.014, 5, false), 0, 0, 0);
    const count = Math.ceil(r.h * 2.85);
    for (let i = 0; i < count; i++) {
      const t = 0.18 + (i + 0.24 + 0.48 * rng()) / count * 0.79;
      const a = trunk(t);
      const sign = i % 2 === 0 ? 1 : -1;
      const shoot = sign * (0.13 + rng() * 0.52) * (1.08 - 0.56 * t);
      const rise = 0.17 + rng() * 0.32;
      const c = a.clone().add(offset(r, shoot, rise, 0.058 + rng() * 0.04));
      const mid = a.clone().lerp(c, 0.54).add(new THREE.Vector3(r.nx * 0.022, -0.028, -r.nz * 0.022));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      stems.geo(wood, new THREE.TubeGeometry(curve, 5, 0.0048, 4, false), 0, 0, 0);
      const full = Math.round((11 + Math.abs(shoot) * 14) * r.vigor);
      const colony = palette[Math.floor(rng() * palette.length)];
      for (let j = 0; j < full; j++) {
        const k = 0.13 + (j + rng()) / full * 0.90;
        const drift = (j % 2 === 0 ? 1 : -1) * (0.029 + rng() * 0.08);
        curve.getPoint(k, v);
        v.add(offset(r, drift, -0.012 - rng() * 0.08, 0.004 + rng() * 0.053));
        edge.set((rng() - 0.5) * 0.72, Math.atan2(r.nx, -r.nz) + (rng() - 0.5) * 0.87,
          -sign * (0.14 + 0.85 * k) + (rng() - 0.5) * 0.75, 'YXZ');
        quat.setFromEuler(edge);
        const size = (0.111 + rng() * 0.079) * (1.0 - 0.24 * t);
        scale.set(size * (0.78 + 0.18 * rng()), size, size);
        transforms.push(new THREE.Matrix4().compose(v, quat, scale));
        colors.push(colony.clone().lerp(palette[2], rng() * 0.36).multiplyScalar(0.78 + rng() * 0.39));
      }
    }
  }
  // Shallow convex leaves keep a light-catching fold instead of exposing the planar card.
  const geo = new THREE.PlaneGeometry(1, 1, 2, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.105 * (1 - Math.abs(pos.getX(i)) * 2));
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, leaf, transforms.length);
  for (let i = 0; i < transforms.length; i++) {
    mesh.setMatrixAt(i, transforms[i]);
    mesh.setColorAt(i, colors[i]);
  }
  mesh.name = 'Attached creeper stems and leaf sprays';
  mesh.receiveShadow = true;
  parent.add(mesh);
}
