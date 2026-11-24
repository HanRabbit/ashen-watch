import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { retainKeyVSMDepth } from '../src/render/keyShadowDepth';
import { makeSkyKey } from '../src/render/skyKey';
import { installSkyKeyDiskShadow } from '../src/render/skyKeyDiskShadow';

it('stages one verified live raw depth for the sky key, updating the projected radius without rebuilding shaders', () => {
  const key = makeSkyKey(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const map = key.shadow.map = new THREE.WebGLRenderTarget(2048, 2048, { depthTexture: new THREE.DepthTexture(2048, 2048) });
  const blur = key.shadow.mapPass = new THREE.WebGLRenderTarget(2048, 2048);
  const vsm = { VSM_SAMPLES: 5 };
  const vertical = new THREE.ShaderMaterial({ defines: vsm, uniforms: { shadow_pass: { value: map.depthTexture } } });
  const horizontal = new THREE.ShaderMaterial({ defines: { ...vsm, HORIZONTAL_PASS: 1 }, uniforms: { shadow_pass: { value: blur.texture } } });
  const clear = vi.fn(), draw = vi.fn();
  const mesh = new THREE.Mesh(), group = { start: 0, count: 0 };
  let target = map, update = false;
  const render = vi.fn(() => {
    if (!update) return;
    target = map;
    renderer.clear();
    target = blur;
    renderer.clear();
    renderer.renderBufferDirect(camera, scene, mesh.geometry, vertical, mesh, group);
    target = map;
    renderer.clear();
    renderer.renderBufferDirect(camera, scene, mesh.geometry, horizontal, mesh, group);
  });
  const renderer = {
    shadowMap: { enabled: true, autoUpdate: true, type: THREE.VSMShadowMap, render },
    getRenderTarget: () => target, clear, renderBufferDirect: draw,
  } as unknown as THREE.WebGLRenderer;
  let tan = 0.031;
  const dispose = installSkyKeyDiskShadow(renderer, scene, key, () => tan);
  const wrapped = renderer.shadowMap.render;
  const glassLease = retainKeyVSMDepth(renderer, key);
  const beauty = THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms);
  const state = beauty.uAwDiskState.value as Float32Array;
  const slot = beauty.uAwDiskDepth.value as ArrayLike<THREE.DepthTexture | null>;
  const run = (lights: THREE.Light[] = [key], renderedScene = scene) => renderer.shadowMap.render(lights, renderedScene, camera);
  try {
    expect(wrapped).not.toBe(render);
    expect(renderer.shadowMap.render).toBe(wrapped); // one preservation hook, two consumers
    expect(state).toBe(THREE.ShaderLib.standard.uniforms.uAwDiskState.value);
    expect(slot).toBe(THREE.ShaderLib.standard.uniforms.uAwDiskDepth.value);
    run(); // first frame with no verified clear/blur sequence
    expect(state[0]).toBe(-1);
    expect(slot[0]).toBeNull();
    update = true;
    const point = new THREE.PointLight(), anotherKey = new THREE.DirectionalLight();
    run([point, anotherKey, key]);
    expect(clear.mock.calls).toEqual([[true, true, true], [true, true, true], [true, false, true]]);
    expect(draw).toHaveBeenCalledTimes(2); // the two original blur calls, no extra submission
    expect(slot[0]).toBe(map.depthTexture);
    expect(glassLease.getDepth()).toBe(slot[0]);
    expect(state[0]).toBe(1);
    expect(state[1]).toBeCloseTo(88 * .031, 6);
    expect(state[2]).toBeCloseTo(62 / 2048, 8);
    expect(state[3]).toBeCloseTo(58 / 2048, 8);
    // 4 axial metres: 12.4 cm radius by day, 4.4 cm by moonlight. The
    // unchanged shader reads a live scale even when reusing the shadow map.
    expect(state[1] * (4 / 88)).toBeCloseTo(.124, 6);
    const shader = THREE.ShaderChunk.shadowmap_pars_fragment;
    update = false;
    tan = .011;
    run();
    expect(state[1] * (4 / 88)).toBeCloseTo(.044, 6);
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toBe(shader);
    expect(shader).toContain('const float awDiskCap = 0.240000;');
    expect(shader).toContain('min(awDiskCap, blockerRadius)');
    expect(shader).toContain('texelFetch(uAwDiskDepth[0], ij, 0)');
    expect(shader.match(/sum \+= awDiskPCF/g)).toHaveLength(3);
    scene.onAfterRender(renderer, scene, camera, mesh.geometry, vertical, new THREE.Group());
    expect(state[0]).toBe(-1);
    run([key], new THREE.Scene());
    expect(slot[0]).toBeNull();
    run([]);
    expect(slot[0]).toBeNull();
    renderer.shadowMap.type = THREE.PCFShadowMap;
    run();
    expect(slot[0]).toBeNull();
    renderer.shadowMap.type = THREE.VSMShadowMap;
    map.depthTexture = new THREE.DepthTexture(2048, 2048);
    run(); // new texture that has not yet been rendered
    expect(slot[0]).toBeNull();
    glassLease.dispose();
    expect(renderer.shadowMap.render).toBe(wrapped);
  } finally {
    glassLease.dispose();
    dispose();
  }
  expect(renderer.shadowMap.render).toBe(render);
});
