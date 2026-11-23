import type * as THREE from 'three';

// Three clones Color and Vector uniforms when compiling a built-in material,
// but retains typed arrays by reference. All program variants then read the
// staged frame values, including draws outside the main scene traversal.
// Keep these uniforms separate from the legacy fog-managed copies.
export const skyExposureSourceUniforms = {
  uAwSkyDoors: { value: new Float32Array(2) },
  uAwSkyIrradiance: { value: new Float32Array(3) },
};

export function stageSkyExposureSources(portal: THREE.Vector2, skyIrradiance: THREE.Color): void {
  portal.toArray(skyExposureSourceUniforms.uAwSkyDoors.value);
  skyIrradiance.toArray(skyExposureSourceUniforms.uAwSkyIrradiance.value);
}
