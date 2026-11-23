import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { trackPending } from './materials';

const PARTS = ['GatehouseSlate', 'GatehouseOuterOak', 'GatehouseSoffit'];
let template: Promise<THREE.Group> | undefined;

/** The packer writes world-space vertices and one indexed draw per part. */
export function prepareGatehouseRoof(model: THREE.Group): void {
  const parts = new Set(PARTS);
  let triangles = 0;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const { geometry, material } = object;
    const p = geometry.getAttribute('position');
    if (!parts.delete(object.name) || !p || !geometry.index || geometry.index.count % 3 !== 0 ||
      !['normal', 'uv', 'color'].every(name => geometry.getAttribute(name)?.count === p.count) ||
      !(material instanceof THREE.MeshStandardMaterial) || material.transparent ||
      !material.map || !material.normalMap || !material.roughnessMap) {
      throw new Error('Incomplete gatehouse roof part');
    }
    triangles += geometry.index.count / 3;
    object.castShadow = object.receiveShadow = true;
    // Slate has no buried backfaces. Keep its silhouette in both PCF and VSM.
    material.shadowSide = THREE.DoubleSide;
    material.metalnessMap = null;
    for (const texture of [material.map, material.normalMap, material.roughnessMap]) texture.anisotropy = 4;
  });
  const { min, max } = new THREE.Box3().setFromObject(model, true);
  if (parts.size || triangles < 15000 || triangles > 20000 ||
      !(min.x >= -4.04 && min.x < -3.75 && max.x <= 4.04 && max.x > 3.75 &&
        min.y >= 3.46 && min.y < 3.63 && max.y > 5.60 && max.y <= 5.84 &&
        min.z >= -1.03 && min.z < -.83 && max.z > 8.85 && max.z <= 9.09)) {
    throw new Error('Gatehouse roof is outside the registered envelope');
  }
  model.name = 'rodin-gatehouse-roof';
  model.userData.source = 'hyper3d';
}

function loadGatehouseRoof(): Promise<THREE.Group> {
  return template ??= new GLTFLoader().loadAsync('models/rodin/gatehouse-roof.glb').then(({ scene }) => {
    prepareGatehouseRoof(scene);
    return scene;
  }).catch(error => { template = undefined; throw error; });
}

/** Swap all four legacy surfaces together, only after the full opaque PBR pack is ready. */
export function mountGatehouseRoof(parent: THREE.Object3D, fallback: THREE.Group): void {
  fallback.name = 'gatehouse-roof-fallback';
  parent.add(fallback);
  trackPending(loadGatehouseRoof().then(source => {
    parent.add(source.clone(true));
    fallback.removeFromParent();
    // Fallback materials belong to the main static scene (e.g. the bell eave).
    fallback.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  }).catch(error => { console.warn('Kept the authored gatehouse roof', error); }));
}
