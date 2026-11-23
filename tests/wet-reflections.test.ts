import { BufferGeometry, DepthTexture, Group, Object3D, PerspectiveCamera, Scene, UnsignedIntType, Vector3 } from 'three';
import type { WebGLRenderer } from 'three';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { describe, expect, it } from 'vitest';
import { configureWetReflections } from '../src/render/post/wetReflections';
import { WET_REFLECTION_FRAGMENT, WET_TRACE } from '../src/render/post/wetReflectionTrace';

// One row of a perspective depth buffer. The ray moves one centimeter per projected
// texel and crosses the valid receiving plane at pixel coordinate 7.3.
const rayDepth = 5.045;
const focalLength = rayDepth / 0.01;
const normal = new Vector3(-0.6, 0, 0.8);
const intersection = new Vector3(0.073, 0, -rayDepth);
const tolerance = 0.08;
const silhouette = (texel: number) => texel < 7 ? 6.0 : 5.0;
const continuousPlane = (texel: number) =>
  normal.dot(intersection) / (normal.x * (texel + 0.5) / focalLength - normal.z);

function refine(depthAt: (texel: number) => number) {
  let front = 4;
  let back = 10;
  for (let i = 0; i < WET_TRACE.refineSteps; i++) {
    const mid = (front + back) * 0.5;
    const depth = depthAt(Math.floor(mid));
    if (depth > 0 && rayDepth >= depth) back = mid;
    else front = mid;
  }
  return [front, back] as const;
}

function position(pixel: number, depthAt: (texel: number) => number) {
  const texel = Math.floor(pixel);
  const depth = depthAt(texel);
  return new Vector3((texel + 0.5) * depth / focalLength, 0, -depth);
}

describe('wet reflector GPU pass', () => {
  it('rejects a silhouette depth step that passes the stock SSR line-distance test', () => {
    const [front, back] = refine(silhouette);
    const before = position(front, silhouette);
    const after = position(back, silhouette);
    expect(rayDepth + before.z).toBeLessThan(0);
    expect(rayDepth + after.z).toBeGreaterThan(0);
    expect(Math.abs(rayDepth + after.z)).toBeLessThan(tolerance);
    expect(normal.x).toBeLessThan(-WET_TRACE.minIncidence);
    expect(Math.abs(before.sub(after).dot(normal))).toBeGreaterThan(WET_TRACE.planeFadeEnd * tolerance);

    const [planeFront, planeBack] = refine(continuousPlane);
    const planeAnchor = position(planeBack, continuousPlane);
    expect(Math.abs(position(planeFront, continuousPlane).sub(planeAnchor).dot(normal)))
      .toBeLessThan(WET_TRACE.planeFadeStart * tolerance);
    const crossing = intersection.clone().setX(0);
    const distance = crossing.clone().sub(planeAnchor).dot(normal) / -normal.x;
    const hitPixel = distance / 0.01;
    expect(hitPixel).toBeCloseTo(7.3);
    expect(hitPixel).toBeGreaterThan(planeFront - 0.75);
    expect(hitPixel).toBeLessThan(planeBack + 0.75);
    // Keep the plane-continuity guard on the path between refinement and the live colour fetch.
    expect(WET_REFLECTION_FRAGMENT).toMatch(/awPlaneConfidence\(front\.pixel, front\.depth,[\s\S]*?if \(confidence <= 0\.0\) return;[\s\S]*?texelFetch\(uAwSceneColor/);
  });

  it('bounds candidate depth tests and subpixel refinement at any raster size', () => {
    const { glossySteps, roughSteps, refineSteps, maxStride } = WET_TRACE;
    expect(glossySteps * maxStride).toBe(528);
    expect(roughSteps * maxStride).toBe(288);
    expect(2 + glossySteps + refineSteps + 2).toBe(54);
    expect(2 + roughSteps + refineSteps + 2).toBe(34);
    expect(maxStride / 2 ** refineSteps).toBeLessThan(0.2);
  });

  it('uses the shared normal depth if attached after configure and always reads live beauty colour', () => {
    const camera = new PerspectiveCamera();
    const scene = new Scene();
    const renderer = {} as WebGLRenderer;
    const pass = new SSRPass({ renderer, scene, camera, width: 1920, height: 1080, selects: null, groundReflector: null });
    try {
      configureWetReflections(pass, camera);
      const material = pass.ssrMaterial;
      const uniforms = material.uniforms;
      const geometry = new BufferGeometry();
      const quad = new Object3D();
      const group = new Group();
      const draw = () => material.onBeforeRender(renderer, scene, camera, geometry, quad, group);
      draw();
      expect(uniforms.tDepth.value).toBe(pass.beautyRenderTarget.depthTexture);
      pass.normalRenderTarget.depthTexture = new DepthTexture(1920, 1080, UnsignedIntType);
      camera.near = 0.08;
      camera.far = 610;
      draw();
      expect(uniforms.tDepth.value).toBe(pass.normalRenderTarget.depthTexture);
      expect(uniforms.cameraNear.value).toBe(0.08);
      expect(uniforms.cameraFar.value).toBe(610);
      expect(uniforms.cameraProjectionMatrix.value).toBe(camera.projectionMatrix);
      expect(uniforms.uAwCameraWorld.value).toBe(camera.matrixWorld);
      expect(pass.ssrRenderTarget.width).toBe(960);
      expect(pass.normalRenderTarget.width).toBe(1920);
      pass.bouncing = true;
      expect(uniforms.uAwSceneColor.value).toBe(pass.beautyRenderTarget.texture);
    } finally {
      pass.dispose();
    }
  });
});
