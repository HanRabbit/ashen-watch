import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { applySkyKey, configureSkyKeyShadowMap, makeSkyKey } from '../src/render/skyKey';

const day = { sun: 0xe4ebef, sunI: .72, sunDir: [-.58, .68, -.42], keyPcfMetres: .075 } as const;
const moon = { sun: 0x7f9ccf, sunI: 1.20, sunDir: [.72, .42, -.35], keyPcfMetres: .055 } as const;
const mapSettings = () => ({ type: THREE.PCFShadowMap as THREE.ShadowMapType });

it('keeps the key and shadow camera on the same live sky ray, anchored to the site', () => {
  const key = makeSkyKey(), { shadow } = key;
  const target = key.target.position.clone();
  expect(target.toArray()).toEqual([9.5, 3, -10.25]);
  expect(key.castShadow).toBe(true);
  expect(shadow.intensity).toBe(1);
  expect(shadow.bias).toBe(-.0006);
  expect(shadow.normalBias).toBe(.035);
  const { left, right, top, bottom, near, far } = shadow.camera;
  expect([left, right, top, bottom, near, far]).toEqual([-31, 31, 29, -29, 12, 100]);
  key.target.updateMatrixWorld();
  for (const phase of [day, moon]) {
    applySkyKey(key, THREE.VSMShadowMap, phase);
    key.updateMatrixWorld();
    shadow.updateMatrices(key);
    const skyDirection = new THREE.Vector3(...phase.sunDir).normalize();
    expect(key.color.getHex()).toBe(phase.sun);
    expect(key.intensity).toBe(phase.sunI);
    expect(key.target.position.equals(target)).toBe(true);
    expect(key.position.clone().sub(target).normalize().distanceTo(skyDirection)).toBeLessThan(1e-12);
    expect(shadow.camera.getWorldDirection(new THREE.Vector3()).dot(skyDirection)).toBeCloseTo(-1, 12);
    const centre = target.clone().applyMatrix4(shadow.matrix);
    expect(centre.x).toBeCloseTo(.5, 12);
    expect(centre.y).toBeCloseTo(.5, 12);
    expect(centre.z).toBeGreaterThan(0);
    expect(centre.z).toBeLessThan(1);
  }
  applySkyKey(key, THREE.VSMShadowMap, { ...moon, sunI: 0 });
  expect(key.intensity).toBe(0);
});

it('uses a centred five-tap native blur in cinematic and stable physical PCF widths on high and low', () => {
  const key = makeSkyKey(), map = mapSettings();
  const { shadow } = key;
  configureSkyKeyShadowMap(map, key, 'cinematic');
  expect(map.type).toBe(THREE.VSMShadowMap);
  expect(shadow.mapSize.toArray()).toEqual([2048, 2048]);
  for (const phase of [day, moon]) {
    applySkyKey(key, map.type, phase);
    expect(shadow.blurSamples).toBe(5);
    expect(shadow.radius).toBe(2);
  }
  for (const [quality, size] of [['high', 2048], ['low', 1024]] as const) {
    configureSkyKeyShadowMap(map, key, quality);
    expect(map.type).toBe(THREE.PCFShadowMap);
    expect(shadow.mapSize.toArray()).toEqual([size, size]);
    for (const phase of [day, moon]) {
      applySkyKey(key, map.type, phase);
      expect(shadow.radius * 62 / size).toBeCloseTo(phase.keyPcfMetres, 12);
    }
  }
});

it('preserves valid shadow buffers within a tier and releases both when the VSM format changes', () => {
  const key = makeSkyKey(), map = mapSettings();
  configureSkyKeyShadowMap(map, key, 'cinematic');
  const main = key.shadow.map = new THREE.WebGLRenderTarget(2048, 2048);
  const blur = key.shadow.mapPass = new THREE.WebGLRenderTarget(2048, 2048);
  const disposeMain = vi.spyOn(main, 'dispose'), disposeBlur = vi.spyOn(blur, 'dispose');
  configureSkyKeyShadowMap(map, key, 'cinematic');
  expect(key.shadow.map).toBe(main);
  expect(key.shadow.mapPass).toBe(blur);
  expect(disposeMain).not.toHaveBeenCalled();
  expect(disposeBlur).not.toHaveBeenCalled();
  configureSkyKeyShadowMap(map, key, 'high');
  expect(disposeMain).toHaveBeenCalledOnce();
  expect(disposeBlur).toHaveBeenCalledOnce();
  expect(key.shadow.map).toBeNull();
  expect(key.shadow.mapPass).toBeNull();
});
