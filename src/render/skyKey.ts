import * as THREE from 'three';

const KEY_DISTANCE = 55;
// Five centred taps at [-2, -1, 0, 1, 2] on each axis. The volume and
// stock fallback still sample these moments; the finite disk samples raw
// geometry depth and does not use this radius.
const VSM_RADIUS = 2;
const VSM_SAMPLES = 5;
const SHADOW_TIERS = {
  cinematic: [THREE.VSMShadowMap, 2048],
  high: [THREE.PCFShadowMap, 2048],
  low: [THREE.PCFShadowMap, 1024],
} as const;

export function makeSkyKey(): THREE.DirectionalLight {
  const key = new THREE.DirectionalLight();
  key.name = 'Sky directional key';
  key.castShadow = true;
  const shadow = key.shadow;
  shadow.intensity = 1;
  // Keep the site-sized, world-anchored volume and the existing acne bias.
  shadow.camera.near = 12; shadow.camera.far = 100;
  shadow.camera.left = -31; shadow.camera.right = 31;
  shadow.camera.top = 29; shadow.camera.bottom = -29;
  shadow.camera.updateProjectionMatrix();
  shadow.bias = -0.0006;
  shadow.normalBias = 0.035;
  key.target.position.set(9.5, 3, -10.25);
  return key;
}

export function configureSkyKeyShadowMap(
  map: Pick<THREE.WebGLRenderer['shadowMap'], 'type'>,
  key: THREE.DirectionalLight, quality: keyof typeof SHADOW_TIERS,
): void {
  const [type, size] = SHADOW_TIERS[quality];
  const shadow = key.shadow;
  if (map.type !== type || shadow.mapSize.x !== size || shadow.mapSize.y !== size) {
    // Release both native targets when switching formats/resolutions. Three
    // lazily allocates the appropriate comparison depth or RG moments next draw.
    shadow.map?.dispose();
    shadow.mapPass?.dispose();
    shadow.map = shadow.mapPass = null;
    map.type = type;
    shadow.mapSize.set(size, size);
  }
  shadow.blurSamples = VSM_SAMPLES;
  if (type === THREE.VSMShadowMap) shadow.radius = VSM_RADIUS;
}

/** Update only the existing key. The sky disc and air take the same sunDir.
 * PCF uses a world-scale radius so its reach doesn't double at low resolution. */
export function applySkyKey(key: THREE.DirectionalLight, type: THREE.ShadowMapType, state: {
  sun: number; sunI: number; sunDir: readonly [number, number, number]; keyPcfMetres: number;
}): void {
  key.color.setHex(state.sun);
  key.intensity = state.sunI;
  key.position.set(...state.sunDir).normalize().multiplyScalar(KEY_DISTANCE).add(key.target.position);
  const shadow = key.shadow;
  if (type === THREE.PCFShadowMap) {
    shadow.radius = state.keyPcfMetres * shadow.mapSize.x / (shadow.camera.right - shadow.camera.left);
  }
}
