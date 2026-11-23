import * as THREE from 'three';
import { expect, it } from 'vitest';
import { DAMP_FALLOFF, WEATHER_BASE } from '../src/render/post/airVolume';
import { FogController, installHeightFog } from '../src/render/post/fog';
import { LightGlowShader } from '../src/render/post/glow';
import { fillLUT, makeLUT } from '../src/render/post/grade';

it('does not emit the reserved GLSL token patch in the assembled glow fragment', () => {
  const code = LightGlowShader.fragmentShader.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, ' ');
  expect(code).not.toMatch(/\bpatch\b/);
});

it('clears both surface weather layers on a low → HDR → low switch', () => {
  installHeightFog();
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(undefined, material), new THREE.Mesh(undefined, [material]));
  const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
  let updates = 0;
  const renderer = { properties: { get: () => { updates++; return { uniforms }; } } } as unknown as THREE.WebGLRenderer;
  const fog = new FogController(renderer, scene);
  const optics = { distMax: 0.57, heightBase: WEATHER_BASE, heightFalloff: DAMP_FALLOFF };
  const update = (heightDensity: number, freeDensity: number) => {
    fog.update({ ...optics, heightDensity, freeDensity }, new THREE.Vector2(), new THREE.Color(), 1, 1);
    expect(uniforms.fogHeightDensity.value).toBe(heightDensity);
    expect(uniforms.fogFreeDensity.value).toBe(freeDensity);
    expect(uniforms.fogDistMax.value).toBe(optics.distMax);
  };
  update(0.018, 0.007);
  update(0, 0);
  update(0.014, 0.006);
  expect(updates).toBe(3); // the same uniform set can be shared by a mesh and a multi-material mesh
});

it('preserves black, white and ordered neutral levels while separating a cool shadow and a warm light', () => {
  const size = 32;
  const lut = makeLUT(size);
  fillLUT(lut, { sat: 0.89, contrast: 1.05, tintS: 0x24364c, tintH: 0xffb25e });
  const data = lut.image.data as Uint8Array;
  const sample = (r: number, g: number, b: number) => {
    const i = ((b * size + g) * size + r) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  expect(sample(0, 0, 0)).toEqual([0, 0, 0]);
  expect(sample(31, 31, 31)).toEqual([255, 255, 255]);
  for (let n = 1; n < size; n++) {
    const previous = sample(n - 1, n - 1, n - 1);
    for (const [channel, value] of sample(n, n, n).entries()) expect(value).toBeGreaterThan(previous[channel]);
  }
  const [darkR, , darkB] = sample(5, 5, 5);
  const [warmR, , warmB] = sample(29, 17, 6);
  expect(darkB).toBeGreaterThan(darkR);
  expect(warmR - warmB).toBeGreaterThan(160);
  lut.dispose();
});
