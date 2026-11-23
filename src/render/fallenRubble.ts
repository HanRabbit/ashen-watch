import * as THREE from 'three';
import { inArea, PROPS } from '../sim/level';
import { awUniforms, enhance, stoneShader, trackPending } from './materials';

const up = new THREE.Vector3(0, 1, 0);
const axes = [new THREE.Vector3(1, 0, 0), up, new THREE.Vector3(0, 0, 1)];
const EPS = 1e-7;

type Surface = 'old' | 'bed' | 'core' | 'arriss' | 'split';
type Attitude = readonly [pitch: number, roll: number, buried: number];
interface Face { ring: THREE.Vector3[]; normal: THREE.Vector3; surface: Surface }
interface Piece {
  size: readonly [number, number, number];
  x: number; z: number; yaw: number; seed: number;
  end: -1 | 1; loss: number;
  attitude?: Attitude;
  profile?: 'through' | 'core';
}

// metres, sim x/z; the long stone has toppled NW → SE. Its lower end is
// sunk into the bedding, not balanced on the centre of another ashlar. The
// chip trail continues the same fall and fans into the quiet court shoulder.
const heap: readonly Piece[] = [
  { x: -.052, z: .138, size: [.985, .32, .455], yaw: -.54, attitude: [-.43, .14, .252], seed: 83, end: 1, loss: .84, profile: 'through' },
  { x: -.297, z: -.321, size: [.45, .209, .305], yaw: .36, attitude: [.17, -.67, .113], seed: 37, end: -1, loss: .58, profile: 'core' },
  { x: .349, z: -.317, size: [.34, .172, .235], yaw: -.73, attitude: [.12, .18, .074], seed: 57, end: 1, loss: .87, profile: 'core' },
  { x: .198, z: -.539, size: [.147, .075, .092], yaw: -.16, seed: 17, end: -1, loss: 1.05 },
  { x: .478, z: -.008, size: [.214, .087, .116], yaw: .58, seed: 61, end: -1, loss: .83 },
  { x: .367, z: .219, size: [.145, .074, .144], yaw: -.14, seed: 89, end: 1, loss: .94 },
  { x: .015, z: -.506, size: [.198, .082, .109], yaw: -.34, seed: 45, end: 1, loss: 1.07 },
  { x: -.460, z: -.093, size: [.143, .062, .094], yaw: .76, seed: 52, end: -1, loss: .81 },
  { x: .195, z: .442, size: [.154, .068, .103], yaw: .32, seed: 38, end: 1, loss: .90 },
  { x: .059, z: -.382, size: [.108, .062, .074], yaw: -.40, seed: 72, end: 1, loss: .91 },
  { x: .523, z: -.484, size: [.119, .062, .073], yaw: -.80, seed: 79, end: 1, loss: .95 },
  { x: .494, z: -.133, size: [.083, .057, .077], yaw: -.41, seed: 37, end: -1, loss: 1.13 },
];

// Low, sparser continuation of the same fracture fan. Only thin, nearly
// flush flakes go past the proxy, and only on its away-from-arch side.
const westSkirt: readonly Piece[] = [
  { x: .652, z: -.323, size: [.159, .035, .106], yaw: -.77, seed: 80, end: 1, loss: .98 },
  { x: .745, z: -.424, size: [.099, .037, .057], yaw: -.35, seed: 82, end: -1, loss: .89 },
  { x: .615, z: -.597, size: [.118, .037, .081], yaw: .22, seed: 29, end: 1, loss: 1.14 },
  { x: .924, z: -.554, size: [.077, .030, .057], yaw: -.58, seed: 24, end: 1, loss: 1.00 },
  { x: .693, z: -.099, size: [.075, .032, .056], yaw: .34, seed: 99, end: -1, loss: .79 },
];

// No collision here: just spalls in the toe of the east curtain, north of the
// arcade, inside the wall's player-radius margin. Do not extend them into the bay.
const eastSpalls: readonly Piece[] = [
  { x: 9.810, z: 22.27, size: [.229, .065, .099], yaw: 1.22, seed: 105, end: 1, loss: .80 },
  { x: 9.741, z: 22.52, size: [.152, .047, .077], yaw: .91, seed: 127, end: -1, loss: .91 },
  { x: 9.830, z: 22.71, size: [.125, .052, .090], yaw: -1.10, seed: 131, end: 1, loss: .72 },
];

// CC0 Poly Haven stone_pavers: inset rectangles of single scanned paver faces
// (texture UV origin bottom-left). Neither the old face nor a fracture samples a joint.
const crops = [
  [.15, .778, .427, .963], [.481, .783, .765, .963], [.042, .526, .256, .715],
  [.308, .525, .565, .710], [.652, .534, .921, .712], [.14, .273, .404, .469],
  [.465, .270, .735, .466], [.069, .030, .349, .221], [.411, .027, .679, .215],
  [.788, .041, .978, .208],
] as const;

function basis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = (Math.abs(n.y) < .92 ? up : axes[2]).clone().cross(n).normalize();
  return [u, n.clone().cross(u)];
}

function centroid(ring: readonly THREE.Vector3[]): THREE.Vector3 {
  return ring.reduce((c, p) => c.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
}

function ordered(ring: THREE.Vector3[], n: THREE.Vector3): THREE.Vector3[] {
  const c = centroid(ring), [u, v] = basis(n);
  const angle = (p: THREE.Vector3) => Math.atan2(p.dot(v) - c.dot(v), p.dot(u) - c.dot(u));
  return ring.sort((a, b) => angle(a) - angle(b));
}

/** Cut a closed solid, keeping small arrises and larger oblique breaks distinct. */
function trim(faces: Face[], normal: THREE.Vector3, limit: number, surface: Surface): Face[] {
  const cap: THREE.Vector3[] = [], clipped: Face[] = [];
  for (const face of faces) {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < face.ring.length; i++) {
      const a = face.ring[i], b = face.ring[(i + 1) % face.ring.length];
      const da = normal.dot(a) - limit, db = normal.dot(b) - limit;
      if (da <= EPS) ring.push(a);
      if (da < -EPS && db > EPS || da > EPS && db < -EPS) ring.push(a.clone().lerp(b, da / (da - db)));
    }
    if (ring.length >= 3) clipped.push({ ...face, ring });
    for (const p of ring) {
      if (Math.abs(normal.dot(p) - limit) <= EPS && !cap.some(q => p.distanceToSquared(q) < EPS * EPS)) cap.push(p);
    }
  }
  if (cap.length >= 3) {
    const n = normal.clone().normalize();
    clipped.push({ ring: ordered(cap, n), surface, normal: n });
  }
  return clipped;
}

function block(piece: Piece): Face[] {
  const [w, h, d] = piece.size.map(s => s / 2);
  const corners = [-w, w].flatMap(x => [-h, h].flatMap(y => [-d, d].map(z => new THREE.Vector3(x, y, z))));
  const half = [w, h, d];
  let faces: Face[] = axes.flatMap((axis, i) => [-1, 1].map(sign => {
    const normal = axis.clone().multiplyScalar(sign);
    const surface: Surface = i === 1 ? 'bed' : i === 2 && sign === 1 ? 'old' : 'core';
    return { normal, surface, ring: ordered(corners.filter(p => normal.dot(p) === half[i]), normal) };
  }));
  let edge = 0;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const n = axes[i].clone().multiplyScalar(a).addScaledVector(axes[j], b);
      const chisel = (.065 + .065 * hash(piece.seed + ++edge)) * Math.min(w, h, d) * 2;
      faces = trim(faces, n, half[i] + half[j] - chisel, 'arriss');
    }
  }
  // Remove one angled end with two intersecting breaks. On the larger pieces
  // the surviving bed, head and dressed face still read as a masonry section.
  const { end, loss, seed } = piece;
  faces = trim(faces, new THREE.Vector3(end / w, (.25 + .25 * hash(seed)) / h, -.68 / d), 1.91 - loss, 'split');
  faces = trim(faces, new THREE.Vector3(end * .80 / w, (.49 + .22 * hash(seed + 1)) / h, .61 / d), 1.94 - loss, 'split');
  if (piece.profile === 'through') {
    // A large spall off the old shoulder, with a second cleavage into the bed.
    faces = trim(faces, new THREE.Vector3(-.56 / w, .59 / h, .61 / d), 1.24, 'split');
    return trim(faces, new THREE.Vector3(-.66 / w, .81 / h, -.24 / d), 1.24, 'split');
  }
  if (piece.profile === 'core') {
    // The body of a ragged fragment thins toward the head, not a shallow bevel.
    return trim(faces, new THREE.Vector3(-end * .64 / w, .78 / h, .53 / d), .73, 'split');
  }
  return faces;
}

function hash(n: number): number {
  const h = Math.sin(n * 137.135 + 15.83) * 43758.5453;
  return h - Math.floor(h);
}

const tone: Record<Surface, readonly [number, number, number]> = {
  old: [.73, .76, .80], bed: [1.01, .98, .92], core: [.88, .89, .91],
  arriss: [.88, .90, .93], split: [1.19, 1.17, 1.13],
};

function uvProject(face: Face, seed: number): (p: THREE.Vector3) => [number, number] {
  const [u, v] = basis(face.normal);
  const theta = (hash(seed + 59) - .5) * .7 + (seed % 2) * Math.PI;
  u.applyAxisAngle(face.normal, theta);
  v.applyAxisAngle(face.normal, theta);
  const [x0, y0, x1, y1] = crops[Math.floor(hash(seed) * crops.length)];
  const us = face.ring.map(p => u.dot(p)), vs = face.ring.map(p => v.dot(p));
  const u0 = Math.min(...us), v0 = Math.min(...vs), du = Math.max(...us) - u0, dv = Math.max(...vs) - v0;
  const scale = Math.min(face.surface === 'split' ? .78 : .52, .95 * (x1 - x0) / du, .95 * (y1 - y0) / dv);
  const tx = x0 + (.18 + .64 * hash(seed + 617)) * (x1 - x0 - du * scale);
  const ty = y0 + (.18 + .64 * hash(seed + 319)) * (y1 - y0 - dv * scale);
  return p => [tx + scale * (u.dot(p) - u0), ty + scale * (v.dot(p) - v0)];
}

/** CPU-side, indexed and world-positioned. A piece stays a closed solid even at
 * the base; its full bearing plane is seated, not just one vertex of a rotated rock. */
export function fallenRubbleGeometry(): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], indices: number[] = [];
  const add = (piece: Piece, x: number, z: number, grade: number) => {
    let faces = block(piece);
    const [pitch, roll, burial] = piece.attitude ?? [0, 0, 0];
    const rotation = new THREE.Quaternion().setFromAxisAngle(up, piece.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(axes[2], pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(axes[0], roll));
    const down = up.clone().negate().applyQuaternion(rotation.clone().invert());
    const cutAt = Math.max(...faces.flatMap(f => f.ring.map(p => p.dot(down)))) - burial;
    // Close the buried volume below the visible ground. This broad cut plane
    // remains under the centre of mass instead of a sloping block tipping on a vertex.
    if (burial > 0) faces = trim(faces, down, cutAt, 'bed');
    const translation = new THREE.Vector3(x + piece.x, grade + cutAt, -(z + piece.z));
    const chipLight = piece.size[1] < .10 ? .16 + .12 * hash(piece.seed + 101) : 0;
    const baseTint = .92 + .15 * hash(piece.seed) + chipLight;
    faces.forEach((face, i) => {
      const project = uvProject(face, piece.seed * 31 + i);
      const n = face.normal.clone().applyQuaternion(rotation);
      const base = position.length / 3;
      for (const p of face.ring) {
        const q = p.clone().applyQuaternion(rotation).add(translation);
        position.push(q.x, q.y, q.z);
        normal.push(n.x, n.y, n.z);
        uv.push(...project(p));
        const bedGrain = face.surface === 'bed' || face.surface === 'split' ? .041 * Math.sin(21 * p.y + 10 * p.z + piece.seed) : 0;
        color.push(...tone[face.surface].map(c => c * (baseTint + bedGrain)));
      }
      for (let j = 1; j < face.ring.length - 1; j++) indices.push(base, base + j, base + j + 1);
    });
  };
  // This design fits the west court proxy only; don't copy it to other ruins.
  const westProp = PROPS.find(p => p.tag === 'rubble' && (p.y0 ?? 0) === 0 && inArea(p, -8, 21));
  if (westProp) {
    const x = (westProp.x0 + westProp.x1) / 2, z = (westProp.z0 + westProp.z1) / 2;
    // The paving reserves this proxy for earth. Seat into that bedding (the
    // triangulated skirt varies a few mm at the edges), not the sim y=0.
    for (const piece of heap) add(piece, x, z, -.018);
    for (const piece of westSkirt) add(piece, x, z, -.028);
  }
  // Surveyed against the unflagged paving at the curtain toe (not nominal y=0).
  for (const piece of eastSpalls) add(piece, 0, 0, -.024);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(indices);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function buildFallenRubble(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  // Neutral, joint-free placeholder. enhance() shares existing textures and
  // their in-flight requests with trim and paving; no extra download/atlas.
  const fallback = new THREE.DataTexture(new Uint8Array([115, 106, 96, 255]), 1, 1);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: fallback, vertexColors: true, roughness: .94 });
  stoneShader(material, awUniforms(0, .27, .69, [1.06, 1.09, 1.15], 0));
  const stoneCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    stoneCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      // Centimetres of capillary dirt at the ground, not on the upper bed joint.
      vec2 rubbleXZ = vAwWorldPos.xz;
      float rubbleRind = awFbm(rubbleXZ * 19.0 + vAwWorldPos.y * 13.0);
      float rubbleMud = (1.0 - smoothstep(0.001, 0.027 + 0.070 * rubbleRind, vAwWorldPos.y))
        * mix(0.36, 0.88, rubbleRind) * (1.0 - 0.86 * max(vAwWorldNormal.y, 0.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.066, 0.047, 0.031) * (0.65 + rubbleRind * 0.65), rubbleMud);
    `).replace('#include <metalnessmap_fragment>', /* glsl */`
      #include <metalnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.965, rubbleMud);
    `);
  };
  material.customProgramCacheKey = () => 'aw-fallen-rubble';
  if (typeof document !== 'undefined') {
    const pending: Promise<void>[] = [];
    enhance(material, 'stone_pavers', .56, pending);
    trackPending(Promise.all(pending).then(() => {
      if (material.map !== fallback) fallback.dispose();
    }));
  }
  const mesh = new THREE.Mesh(fallenRubbleGeometry(), material);
  mesh.name = 'Fallen masonry and curtain spalls';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
