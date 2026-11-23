import * as THREE from 'three';
import { SCARP_SECTIONS } from '../sim/southScarp';
import { mountRodin } from './rodinAssets';

type Point = [number, number, number];

/** One contiguous rock face. A persistent oblique bedding direction carries the
 * scan across ledges and fractured faces, including the cut end facing the gate. */
export function addSouthScarp(parent: THREE.Object3D, rock: THREE.MeshStandardMaterial): void {
  const pos: number[] = [], uv: number[] = [];
  function tri(a: Point, b: Point, c: Point): void {
    const ab = new THREE.Vector3(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
    const ac = new THREE.Vector3(c[0]-a[0], c[1]-a[1], c[2]-a[2]);
    const n = ab.cross(ac);
    const top = Math.abs(n.y) > Math.max(Math.abs(n.x), Math.abs(n.z));
    const end = Math.abs(n.x) > Math.abs(n.z);
    for (const [x,y,z] of [a,b,c]) {
      pos.push(x,y,-z);
      const u = end && !top ? z : x;
      uv.push(u * 0.36, (top ? z * 0.37 : y * 0.43) - u * 0.069);
    }
  }
  for (let i = 1; i < SCARP_SECTIONS.length; i++) {
    const a = SCARP_SECTIONS[i-1], b = SCARP_SECTIONS[i];
    for (let j = 1; j < a.length; j++) {
      tri(a[j-1], a[j], b[j]);
      tri(a[j-1], b[j], b[j-1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const fallback = new THREE.Mesh(g, rock);
  fallback.castShadow = fallback.receiveShadow = true;
  mountRodin(parent, 'gate-scarp', fallback, rock);
}
