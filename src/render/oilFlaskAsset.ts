import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { trackPending } from './materials';

const url = `${import.meta.env.BASE_URL}models/rodin/oil-flask.glb`;
let pendingFlask: Promise<THREE.Mesh | null> | undefined;

function loadOilFlask(): Promise<THREE.Mesh | null> {
  return pendingFlask ??= new GLTFLoader().loadAsync(url).then(({ scene }) => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    if (meshes.length !== 1) throw new Error('Expected one oil flask primitive');
    const [model] = meshes;
    const { geometry, material } = model;
    if (!(material instanceof THREE.MeshPhysicalMaterial) || !material.map || !material.normalMap
      || !material.roughnessMap || !material.clearcoatMap || material.transparent || material.transmission > 0
      || material.metalness !== 0 || material.emissive.getHex() !== 0
      || !geometry.hasAttribute('position') || !geometry.hasAttribute('normal') || !geometry.hasAttribute('uv')
      || !geometry.index || geometry.index.count === 0 || geometry.index.count > 18000) {
      throw new Error('Missing oil flask geometry or PBR maps');
    }
    // The standalone pack already baked metres and the foot pivot into the vertex data.
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    if (min.y !== 0 || Math.abs(max.y - 0.26) > 0.001
      || ![max.x - min.x, max.z - min.z].every(size => size >= 0.18 && size <= 0.2)) {
      throw new Error('Oil flask is not fitted to its tabletop anchor');
    }
    model.castShadow = model.receiveShadow = true;
    model.name = 'rodin-oil-flask';
    model.userData.source = 'hyper3d';
    // The packed blue channel is zero and metallicFactor is zero. No need to sample it a second time.
    material.metalnessMap = null;
    for (const texture of new Set([material.map, material.normalMap, material.roughnessMap, material.clearcoatMap])) {
      texture.anisotropy = 4;
    }
    return model;
  }).catch(error => {
    pendingFlask = undefined;
    console.warn('Kept the procedural oil flasks', error);
    return null;
  });
}

/** Swap only the visuals inside a placement. Parent visibility, transform and pickup state stay intact. */
export function mountOilFlask(parent: THREE.Group, fallback: THREE.Group, frontYaw: number): void {
  parent.add(fallback);
  trackPending(loadOilFlask().then(source => {
    if (!source) return;
    const model = source.clone(); // The mesh instances share geometry, material and all three textures.
    model.rotation.y = frontYaw;
    parent.add(model);
    fallback.removeFromParent();
    fallback.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  }));
}
