import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dressBaileyStone } from './baileyStone';
import { trackPending } from './materials';

type RodinAsset = 'gate-scarp' | 'pilgrim-relief' | 'chapel-pinnacle' | 'outer-bailey';
const templates = new Map<RodinAsset, Promise<THREE.Group>>();
const stoneTint = { 'gate-scarp': 0xffffff, 'pilgrim-relief': 0xa5aaa7, 'chapel-pinnacle': 0xc5c7c4, 'outer-bailey': 0xb6bbb9 };

function template(name: RodinAsset): Promise<THREE.Group> {
  const cached = templates.get(name);
  if (cached) return cached;
  const pending = new GLTFLoader().loadAsync(`models/rodin/${name}.glb`).then(({ scene }) => {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        mat.color.multiply(new THREE.Color(stoneTint[name]));
        mat.metalness = 0;
        mat.metalnessMap = null; // All four assets are mineral. The packed green channel remains in roughnessMap.
        for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) if (tex) tex.anisotropy = 8;
      }
    });
    return scene;
  }).catch(error => { templates.delete(name); throw error; });
  templates.set(name, pending);
  return pending;
}

/** Keep the silhouette in place until its local GLB is decoded and fitted. Each fallback owns its geometry. */
export function mountRodin(parent: THREE.Object3D, name: RodinAsset, fallback: THREE.Object3D,
  stone: THREE.MeshStandardMaterial, prepare?: (model: THREE.Group) => void): void {
  parent.add(fallback);
  trackPending(template(name).then(source => {
    const model = source.clone(true);
    // Gate collapse ships a purpose-built, metre-scaled PBR atlas. Projecting the
    // old rock skin back over it would put the same baked stripes on every block.
    if (name !== 'gate-scarp') dressBaileyStone(model, stone, name === 'outer-bailey' ? 'curtain' : 'carving');
    prepare?.(model);
    model.name = `rodin-${name}`;
    model.userData.source = 'hyper3d';
    parent.add(model);
    fallback.removeFromParent();
    fallback.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  }).catch(error => { console.warn(`Kept the stone fallback for ${name}`, error); }));
}
