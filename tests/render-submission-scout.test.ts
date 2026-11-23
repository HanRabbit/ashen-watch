import * as THREE from 'three';
import { expect, it } from 'vitest';
import { buildScenery } from '../src/render/scenery';
import { SpatialBounds } from '../src/render/staticFrustum';

type Draw = THREE.Mesh | THREE.InstancedMesh;

const cameras = [
  ['reference east', [-7.5, 1.7, 16.5], [19, 4.6, 16.5]],
  ['castle', [58, 46, -18], [120, 72, -70]],
  ['panorama', [-30, 70, 70], [60, 45, -50]],
  ['pass gate', [18, 32, 28], [40, 26, 60]],
  ['yard north', [0, 2, 8], [0, 1.65, 13]],
  ['hearth', [0, 2, -2], [-5, 1.65, -3.8]],
  ['cellar', [7, -1.45, 11], [0, -1.5, 11]],
  ['sky', [0, 2, 8], [0, 11, 8.5]],
  ['down', [0, 2, 8], [0, -8, 8.5]],
  ['whole scene', [0, 1200, 8], [0, -8, 8.5]],
] as const;

function total(submitted: Draw[]) {
  return {
    draws: submitted.length,
    triangles: submitted.reduce((sum, o) => {
      const vertices = o.geometry.index?.count ?? o.geometry.getAttribute('position').count;
      return sum + vertices / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1);
    }, 0),
  };
}

/** Independent check: no triangle is left without a separating frustum plane. */
function maySubmitTriangle(o: Draw, frustum: THREE.Frustum): boolean {
  const transform = new THREE.Matrix4(), instance = new THREE.Matrix4();
  const vertex = new THREE.Vector3(), box = new THREE.Box3();
  const geometry = o.geometry, positions = geometry.getAttribute('position');
  const corners = geometry.index?.count ?? positions.count;
  const instances = o instanceof THREE.InstancedMesh ? o.count : 1;
  geometry.computeBoundingBox();
  for (let i = 0; i < instances; i++) {
    transform.copy(o.matrixWorld);
    if (o instanceof THREE.InstancedMesh) {
      o.getMatrixAt(i, instance);
      transform.multiply(instance);
    }
    if (!frustum.intersectsBox(box.copy(geometry.boundingBox!).applyMatrix4(transform))) continue;
    const masks = new Uint8Array(positions.count);
    for (let j = 0; j < positions.count; j++) {
      vertex.fromBufferAttribute(positions, j).applyMatrix4(transform);
      frustum.planes.forEach((plane, k) => { if (plane.distanceToPoint(vertex) < 0) masks[j] |= 1 << k; });
    }
    const mask = (j: number) => masks[geometry.index?.getX(j) ?? j];
    for (let j = 0; j < corners; j += 3) if ((mask(j) & mask(j + 1) & mask(j + 2)) === 0) return true;
  }
  return false;
}

it('prunes submitted scenery without new draws or dropping intersecting triangles', () => {
  const { group } = buildScenery();
  group.updateMatrixWorld(true);
  const meshes = group.children as Draw[];
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, .08, 610);
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4();
  const report = [];
  for (const [view, pos, look] of cameras) {
    camera.position.set(pos[0], pos[1], -pos[2]);
    camera.lookAt(look[0], look[1], -look[2]);
    if (view === 'whole scene') {
      camera.far = 2500;
      camera.fov = 90;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const before = meshes.filter(o => frustum.intersectsObject(o));
    const after = meshes.filter(o => o.intersectsFrustum(frustum));
    for (const mesh of before) if (!after.includes(mesh)) expect(maySubmitTriangle(mesh, frustum), `${view}: ${mesh.name}`).toBe(false);
    const base = total(before), optimized = total(after);
    expect(optimized.draws).toBeLessThanOrEqual(base.draws);
    if (view === 'yard north') expect(optimized.triangles).toBeLessThan(base.triangles * 0.8);
    if (view === 'whole scene') expect(optimized).toEqual(total(meshes));
    report.push({ view, beforeDraws: base.draws, afterDraws: optimized.draws, beforeTris: base.triangles, afterTris: optimized.triangles });
  }
  if (import.meta.env.VITE_AW_RENDER_SUBMISSION_REPORT) console.table(report);
});

it('keeps a cluster that crosses a cell boundary and refreshes its bounds when its parent moves', () => {
  const parent = new THREE.Group();
  const box = new THREE.BoxGeometry(8, 1, 1).translate(7, 0, 0);
  const mesh = new THREE.Mesh(box);
  parent.add(mesh);
  box.computeBoundingBox();
  const bounds = new SpatialBounds(4);
  bounds.add(box.boundingBox!); // centre belongs to [4, 8), but actual mesh reaches x=11
  bounds.apply(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
  camera.position.set(10, 0, 10);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  parent.updateMatrixWorld();
  expect(mesh.intersectsFrustum(frustum)).toBe(true);
  parent.position.set(-20, 0, 0);
  parent.updateMatrixWorld();
  expect(mesh.intersectsFrustum(frustum)).toBe(false);
  parent.position.set(0, 0, 0);
  parent.updateMatrixWorld();
  expect(mesh.intersectsFrustum(frustum)).toBe(true);
});
