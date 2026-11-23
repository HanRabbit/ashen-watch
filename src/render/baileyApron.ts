import * as THREE from 'three';
import {
  BAILEY_FABRIC_BOTTOM, BAILEY_GROUND_Y, BAILEY_OUTLINE, BAILEY_PORTAL, BAILEY_PORTAL_HEAD,
  BAILEY_PORTAL_JAMB, BAILEY_SLAB_BOTTOM, BAILEY_WALL_PANELS, BAILEY_WING_SEAM_Z,
} from '../sim/baileyApron';
import type { Batch } from './geom';

interface Stonework {
  wallAshlar: THREE.Material;
  wallTrim: THREE.Material;
  wallRubble: THREE.Material;
  wallRough: THREE.Material;
}
interface Point { x: number; z: number }
interface Vertex extends Point { y: number }
type UV = [number, number];

const meshPoint = ({ x, y, z }: Vertex) => new THREE.Vector3(x, y, -z);
const atHeight = (p: Point, y: number): Vertex => ({ ...p, y });
const distance = (a: Point, c: Point): number => Math.hypot(c.x - a.x, c.z - a.z);
const triangles = (outline: readonly Point[]) => THREE.ShapeUtils.triangulateShape(outline.map(({ x, z }) => new THREE.Vector2(x, z)), []);
const PLANAR_UV = ({ x, z }: Point): UV => [x, z];
const QUAD = [[0, 1, 2], [0, 2, 3]];

function addFaces(
  b: Batch, material: THREE.Material, points: readonly Vertex[], indices: readonly number[][],
  outward: THREE.Vector3, tile: number, uvs = points.map(PLANAR_UV),
): void {
  const positions: number[] = [], uv: number[] = [];
  const world = points.map(meshPoint);
  for (const [a, c, d] of indices) {
    const normal = world[c].clone().sub(world[a]).cross(world[d].clone().sub(world[a]));
    for (const i of normal.dot(outward) >= 0 ? [a, c, d] : [a, d, c]) {
      positions.push(...world[i].toArray());
      uv.push(uvs[i][0] / tile, uvs[i][1] / tile);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  b.geo(material, geo, 0, 0, 0);
}

const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);
const sideNormal = (a: Point, c: Point) => new THREE.Vector3(c.z - a.z, 0, c.x - a.x);

function addSide(
  b: Batch, material: THREE.Material, bottomA: Vertex, bottomC: Vertex, topA: Vertex, topC: Vertex,
  normal: THREE.Vector3, tile: number, u: number,
): void {
  const end = u + distance(bottomA, bottomC);
  addFaces(b, material, [bottomA, bottomC, topC, topA], QUAD, normal, tile,
    [[u, bottomA.y], [end, bottomC.y], [end, topC.y], [u, topA.y]]);
}

/** Yard surface entry point. The slab wraps its exposed sides and meets the
 * two original slabs at grade. The foundation reaches the valley shelf. */
export function addBaileyApronGround(b: Batch, cobbles: THREE.Material, wornFlags = cobbles): void {
  const slab = triangles(BAILEY_OUTLINE);
  addFaces(b, cobbles, BAILEY_OUTLINE.map((v) => atHeight(v, BAILEY_GROUND_Y)), slab, up, 3.6);
  addFaces(b, cobbles, BAILEY_OUTLINE.map((v) => atHeight(v, BAILEY_SLAB_BOTTOM)), slab, down, 3.6);
  let u = 0;
  for (let i = 1; i <= BAILEY_OUTLINE.length - 2; i++) {
    const a = BAILEY_OUTLINE[i - 1], c = BAILEY_OUTLINE[i];
    addSide(b, cobbles, atHeight(a, BAILEY_SLAB_BOTTOM), atHeight(c, BAILEY_SLAB_BOTTOM), atHeight(a, BAILEY_GROUND_Y),
      atHeight(c, BAILEY_GROUND_Y), sideNormal(a, c).negate(), 2.6, u);
    u += distance(a, c);
  }
  // Surviving fan of flags at the threshold, with the far edge scavenged.
  const { z0 } = BAILEY_PORTAL;
  const z1 = BAILEY_WING_SEAM_Z;
  const paving = [
    { x: -10.50, z: z0 + .18 }, { x: -10.50, z: z1 - .14 },
    { x: -12.2, z: z1 - .29 }, { x: -13.3, z: 7.26 },
    { x: -12.84, z: 6.92 }, { x: -13.05, z: 6.42 }, { x: -12.14, z: 5.21 },
  ];
  addFaces(b, wornFlags, paving.map((v) => atHeight(v, BAILEY_GROUND_Y + .007)), triangles(paving), up, 2.35);
}

/** Static masonry entry point. Build with the same shadow-enabled Batch as
 * the curtain. The AABB strips are consumed only by the simulation and bake. */
export function addBaileyApronFabric(b: Batch, stone: Stonework): void {
  const jamb = BAILEY_PORTAL_JAMB;
  b.box(stone.wallRubble, jamb.x0, jamb.z0, jamb.x1, jamb.z1, jamb.y0!, jamb.h, 2.3);
  for (const [i, course] of BAILEY_PORTAL_HEAD.entries()) {
    const { x0, x1, z0, z1, y0, h } = course;
    const material = i === BAILEY_PORTAL_HEAD.length - 1 ? stone.wallRubble : stone.wallAshlar;
    b.box(material, x0 + .18, z0, x1 - .18, z1, y0!, h, 2.05);
    b.box(stone.wallTrim, x0, z0, x0 + .18, z1, y0!, h, 1.3);
    b.box(stone.wallTrim, x1 - .18, z0, x1, z1, y0!, h, 1.3);
  }

  const courseU = [0, 0];
  for (const [i, { edge, corners }] of BAILEY_WALL_PANELS.entries()) {
    const top = corners.map((v) => atHeight(v, v.h));
    const bottom = corners.map((v) => atHeight(v, BAILEY_FABRIC_BOTTOM));
    const plinth = corners.map((v) => atHeight(v, .26 + .04 * Math.sin(v.x * 1.3 + v.z)));
    addFaces(b, stone.wallRough, top, QUAD, up, 1.6);
    const faces = [0, 2];
    if (i === 0) faces.push(3);
    if (i === BAILEY_WALL_PANELS.length - 1) faces.push(1);
    for (const j of faces) {
      const k = (j + 1) % 4;
      const normal = sideNormal(corners[j], corners[k]).negate();
      const body = edge === 2 || edge === 6 ? stone.wallRough : stone.wallRubble;
      const u = j === 0 ? courseU[0] : j === 2 ? courseU[1] - distance(corners[j], corners[k]) : 0;
      addSide(b, stone.wallAshlar, bottom[j], bottom[k], plinth[j], plinth[k], normal, 2.05, u);
      addSide(b, body, plinth[j], plinth[k], top[j], top[k], normal, 3.1, u);
      if (j === 0) courseU[0] += distance(corners[j], corners[k]);
      if (j === 2) courseU[1] = u;
    }
  }
}
