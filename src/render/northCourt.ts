import * as THREE from 'three';
import { NORTH_ARCHES, NORTH_PIERS, NORTH_WALK_BEARING, NORTH_WALL_PANELS, type NorthPoint } from '../sim/northCourt';
import type { Box } from '../sim/level';
import type { Batch } from './geom';

interface Stonework {
  wallAshlar: THREE.Material;
  wallTrim: THREE.Material;
  wallRubble: THREE.Material;
  wallRough: THREE.Material;
}

type Point = NorthPoint & { y: number };

/** World-space UVs follow each stone face, including the exposed thickness. */
function face(b: Batch, mat: THREE.Material, polygon: readonly Point[], inside: THREE.Vector3, tile: number): void {
  const vertices = polygon.map(({ x, y, z }) => new THREE.Vector3(x, y, -z));
  const positions: number[] = [], uv: number[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[0];
    let c = vertices[i], d = vertices[i + 1];
    const normal = c.clone().sub(a).cross(d.clone().sub(a));
    if (normal.lengthSq() < 1e-12) continue;
    if (normal.dot(a.clone().sub(inside)) < 0) { [c, d] = [d, c]; normal.negate(); }
    const flat = Math.abs(normal.y) > Math.hypot(normal.x, normal.z);
    const tangent = new THREE.Vector2(normal.z, -normal.x).normalize();
    for (const p of [a, c, d]) {
      positions.push(p.x, p.y, p.z);
      uv.push((flat ? p.x : p.x * tangent.x + p.z * tangent.y) / tile, (flat ? p.z : p.y) / tile);
    }
  }
  if (positions.length === 0) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  b.geo(mat, geometry, 0, 0, 0);
}

function centerOf(points: readonly Point[]): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (const p of points) { center.x += p.x; center.y += p.y; center.z -= p.z; }
  return center.divideScalar(points.length);
}

export function addNorthPaving(b: Batch, mat: THREE.Material, polygon: readonly NorthPoint[], y: number, tile: number): void {
  const top = polygon.map((p) => ({ ...p, y }));
  const inside = centerOf(top); inside.y -= 1;
  face(b, mat, top, inside, tile);
}

export function addNorthGroundSlab(b: Batch, mat: THREE.Material, polygon: readonly NorthPoint[], bottom: number): void {
  const top = polygon.map((p) => ({ ...p, y: 0 }));
  const base = polygon.map((p) => ({ ...p, y: bottom }));
  const inside = centerOf([...top, ...base]);
  face(b, mat, top, inside, 2.85);
  face(b, mat, base, inside, 2.85);
  // The closing edge at z=29 joins the original slab.
  for (let i = 1; i < top.length; i++) face(b, mat, [base[i - 1], base[i], top[i], top[i - 1]], inside, 2.85);
}

function archPrism(b: Batch, mat: THREE.Material, section: readonly { x: number; h: number }[], z0: number, z1: number, tile: number): void {
  const front = section.map(({ x, h }) => ({ x, y: h, z: z0 }));
  const back = front.map((p) => ({ ...p, z: z1 }));
  const inside = centerOf([...front, ...back]);
  face(b, mat, front, inside, tile);
  face(b, mat, back, inside, tile);
  for (let i = 0; i < front.length; i++) {
    const j = (i + 1) % front.length;
    face(b, mat, [front[i], front[j], back[j], back[i]], inside, tile);
  }
}

export function addNorthCourtFabric(b: Batch, stone: Stonework): void {
  for (const p of NORTH_PIERS) {
    b.box(stone.wallTrim, p.x0, p.z0, p.x1, p.z1, 0, .34, 1.75);
    b.box(stone.wallAshlar, p.x0, p.z0, p.x1, p.z1, .34, 2.01, 2.4);
    b.box(stone.wallTrim, p.x0, p.z0, p.x1, p.z1, 2.01, 2.15, 1.75);
    b.box(stone.wallRubble, p.x0, p.z0, p.x1, p.z1, 2.15, p.h, 2.4);
  }
  for (const { profile, z0, z1 } of NORTH_ARCHES) {
    const outer = profile.map(({ x, h }, i) => {
      const t = Math.PI * i / (profile.length - 1);
      return { x: x - .35 * Math.sin(t) ** 2 * Math.cos(t), h: h + .28 };
    });
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], c = profile[i], d = outer[i], e = outer[i - 1];
      const top = [{ x: d.x, h: NORTH_WALK_BEARING }, { x: e.x, h: NORTH_WALK_BEARING }];
      archPrism(b, stone.wallRubble, [e, d, ...top], z0, z1, 2.3);
      // Dressed stone at both faces and rougher stone along the barrel behind it.
      archPrism(b, stone.wallAshlar, [a, c, d, e], z0 + .19, z1 - .19, 2.05);
      const dressed = i % 5 === 2 || i === 9 ? stone.wallAshlar : stone.wallTrim;
      const recess = [.012, .003, .025, .0, .016][i % 5];
      archPrism(b, dressed, [a, c, d, e], z0 + recess, z0 + .19, 1.25);
      archPrism(b, dressed, [a, c, d, e], z1 - .19, z1 - recess, 1.25);
    }
  }

  for (let i = 0; i < NORTH_WALL_PANELS.length; i++) {
    const { footprint, edge } = NORTH_WALL_PANELS[i];
    const plinth = edge === 0 || edge === 1 || edge === 5 ? .45 : .23;
    const top = footprint.map((p) => ({ ...p, y: p.h }));
    const foot = footprint.map((p) => ({ ...p, y: plinth }));
    const bottom = footprint.map((p) => ({ ...p, y: -.08 }));
    const inside = centerOf([...top, ...bottom]);
    face(b, stone.wallRough, top, inside, 1.6);
    const body = edge === 3 ? stone.wallRough : stone.wallRubble;
    // Continuous coursed skin on both sides. Expose ends only at the old curtain.
    const faces = [0, 2];
    if (i === 0) faces.push(3);
    if (i === NORTH_WALL_PANELS.length - 1) faces.push(1);
    for (const j of faces) {
      const k = (j + 1) % 4;
      face(b, stone.wallAshlar, [bottom[j], bottom[k], foot[k], foot[j]], inside, 2.15);
      face(b, body, [foot[j], foot[k], top[k], top[j]], inside, 3.15);
    }
  }
}

export function addNorthWalkGuard(b: Batch, pieces: readonly Box[], sill: THREE.Material, iron: THREE.Material, wood: THREE.Material): void {
  for (const piece of pieces) {
    const { tag, x0, x1, z0, z1, y0, h } = piece;
    b.box(tag === 'northSill' ? sill : tag === 'northWood' ? wood : iron, x0, z0, x1, z1, y0!, h, 1.5);
  }
}
