import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PostPipeline } from '../src/render/post/pipeline';
import { withoutShadowUpdates } from '../src/render/post/shadows';

it('updates shadows on every beauty pass, with normals and the SSR mask still rendered', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const atmo = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  surface.material.userData.aw = { uAwPool: { value: 1 } };
  scene.add(atmo, surface);
  const shadowMap = { enabled: true, autoUpdate: true, needsUpdate: false };
  const frames: { pass: string; updatesShadows: boolean; atmo: boolean }[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    shadowMap,
    autoClear: true,
    getPixelRatio: () => 1,
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(64, 64),
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
    getClearColor: (color: THREE.Color) => color.set(0),
    setClearColor: () => {},
    getClearAlpha: () => 1,
    setClearAlpha: () => {},
    clear: () => {},
    render: (rendered: THREE.Object3D) => {
      if (rendered !== scene) return; // post-processing full-screen draws
      expect(shadowMap.enabled).toBe(true);
      const updatesShadows = shadowMap.autoUpdate || shadowMap.needsUpdate;
      if (updatesShadows) shadowMap.needsUpdate = false; // WebGLShadowMap's consumption of the request
      const pass = scene.overrideMaterial ? 'normal' : surface.material !== original ? 'mask' : 'beauty';
      frames.push({ pass, updatesShadows, atmo: atmo.visible });
    },
  } as unknown as THREE.WebGLRenderer;
  const original = surface.material;
  const pipeline = new PostPipeline(renderer, scene, camera, { ground: () => [surface], atmo: () => [atmo], lights: () => [] });
  const beauty = { pass: 'beauty', updatesShadows: true, atmo: true };
  const normal = { pass: 'normal', updatesShadows: false, atmo: false };
  const mask = { pass: 'mask', updatesShadows: false, atmo: true };
  pipeline.render(0);
  pipeline.render(1);
  expect(frames.splice(0)).toEqual([beauty, normal, mask, beauty, normal, mask]);
  expect(surface.material).toBe(original);
  expect(atmo.visible).toBe(true);
  pipeline.setQuality('high');
  pipeline.render(2);
  expect(frames.splice(0)).toEqual([beauty, normal]);
  pipeline.setQuality('low');
  pipeline.render(3);
  expect(frames).toEqual([]);
  expect(shadowMap).toEqual({ enabled: true, autoUpdate: true, needsUpdate: false });
});

it('restores an explicit pending shadow refresh even when an auxiliary pass throws', () => {
  const shadowMap = { enabled: true, autoUpdate: false, needsUpdate: true };
  const renderer = { shadowMap } as unknown as THREE.WebGLRenderer;
  expect(() => withoutShadowUpdates(renderer, () => {
    expect(shadowMap).toEqual({ enabled: true, autoUpdate: false, needsUpdate: false });
    throw new Error('render failed');
  })).toThrow('render failed');
  expect(shadowMap).toEqual({ enabled: true, autoUpdate: false, needsUpdate: true });
});
