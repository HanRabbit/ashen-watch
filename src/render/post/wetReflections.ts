import type { PerspectiveCamera } from 'three';
import type { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { WET_REFLECTION_BLUR, WET_REFLECTION_FRAGMENT } from './wetReflectionTrace';

/** GPU screen-space ray tracing for pooled water, using this frame's rendered geometry and colour. */
export function configureWetReflections(pass: SSRPass, camera: PerspectiveCamera): void {
  pass.resolutionScale = 0.5;
  const material = pass.ssrMaterial;
  material.name = 'Ashen Watch wet reflection trace';
  const uniforms = material.uniforms;
  uniforms.uAwSceneColor = { value: pass.beautyRenderTarget.texture };
  uniforms.uAwCameraWorld = { value: camera.matrixWorld };
  uniforms.cameraProjectionMatrix.value = camera.projectionMatrix;
  uniforms.cameraInverseProjectionMatrix.value = camera.projectionMatrixInverse;
  material.onBeforeRender = () => {
    // The pipeline attaches a higher-precision depth texture after configuration.
    // Prefer it so entry/hit depth and geometric normals describe the same draw.
    uniforms.tDepth.value = pass.normalRenderTarget.depthTexture ?? pass.beautyRenderTarget.depthTexture;
    uniforms.cameraNear.value = camera.near;
    uniforms.cameraFar.value = camera.far;
    material.uniformsNeedUpdate = true;
  };
  material.fragmentShader = WET_REFLECTION_FRAGMENT;
  material.needsUpdate = true;

  for (const blur of [pass.blurMaterial, pass.blurMaterial2]) {
    blur.fragmentShader = WET_REFLECTION_BLUR;
    blur.needsUpdate = true;
  }
}
