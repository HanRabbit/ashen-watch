import * as THREE from 'three';

/** Depth/normal/mask passes do not sample shadows. Keep shadow support enabled
 * (shader defines and beauty's map), but skip WebGLShadowMap.render's update. */
export function withoutShadowUpdates(renderer: THREE.WebGLRenderer, render: () => void): void {
  const shadowMap = renderer.shadowMap;
  const { autoUpdate, needsUpdate } = shadowMap;
  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = false;
  try {
    render();
  } finally {
    shadowMap.autoUpdate = autoUpdate;
    shadowMap.needsUpdate ||= needsUpdate;
  }
}
