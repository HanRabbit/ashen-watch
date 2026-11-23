import * as THREE from 'three';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { BRAZIER_POS, LAMP_POS } from '../src/sim/level';
import { newWorld } from '../src/sim/state';
import { LOCAL_LIGHT_UNIFORMS, installLocalLightTransport, traceLocalLight } from '../src/render/localLightTransport';
import { shieldWatchmanLamp } from '../src/render/characterAssets';
import { type Materials } from '../src/render/materials';
import { makeLantern, Props } from '../src/render/props';

vi.mock('../src/render/materials', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/render/materials')>();
  const texture = () => new THREE.CanvasTexture({} as HTMLCanvasElement);
  return { ...actual, glowTexture: texture, smokeTexture: texture, grimeTexture: texture };
});
vi.mock('../src/render/propAssets', async importOriginal => ({
  ...await importOriginal<typeof import('../src/render/propAssets')>(),
  loadProp: () => new THREE.Group(),
}));
vi.mock('../src/render/oilFlaskAsset', () => ({ mountOilFlask: () => {} }));
vi.mock('../src/render/materialVariants', () => ({
  variants: () => new Proxy({}, { get: () => new THREE.MeshStandardMaterial() }),
}));

const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);
const leg = (a: THREE.Vector3, b: THREE.Vector3) => traceLocalLight(a, b).visible;
let props: Props;
const m = new Proxy({}, { get: () => new THREE.MeshStandardMaterial() }) as Materials;
const originalLightLoop = THREE.ShaderChunk.lights_fragment_begin;
const otherChunkNames = ['lights_pars_begin', 'lights_fragment_maps', 'lights_fragment_end', 'common', 'worldpos_vertex'] as const;
const otherChunks = otherChunkNames.map(name => THREE.ShaderChunk[name]);

beforeAll(() => {
  const ctx = new Proxy({}, { get: () => () => {} });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  props = new Props(m);
  vi.unstubAllGlobals();
});

afterEach(() => props.update(newWorld(), 1, 0));

it('blocks the gatehouse by actual walls, gable and the rendered door angle', () => {
  const world = newWorld();
  props.update(world, 1, 0);
  const a = p(0, 1.1, -2), throughDoor = p(0, 1.1, 1);
  expect(leg(a, p(2.9, 1.1, -2))).toBe(true);
  expect(leg(a, p(4, 1.1, -2))).toBe(false);
  expect(leg(a, p(0, 1.1, -10))).toBe(false);
  expect(leg(a, p(0, 7, -2))).toBe(false);
  expect(leg(a, throughDoor)).toBe(false);
  world.doors.gatehouse = true;
  props.update(world, 0, 0.01); // state changed, but the visual leaf has not moved
  expect(leg(a, throughDoor)).toBe(false);
  props.update(world, 1, 1);
  expect(leg(a, throughDoor)).toBe(true);
  expect(leg(p(0, 2.75, -2), p(0, 2.75, 1))).toBe(false);
  // The open leaf swings into the courtyard over the left jamb.
  expect(leg(p(-1.2, 1.2, 1.3), p(-0.45, 1.2, 1.3))).toBe(false);
  expect(leg(p(-2.02, 1.9, -1), p(-2.02, 1.9, 1))).toBe(true);
  expect(leg(p(-2.02, 0.9, -1), p(-2.02, 0.9, 1))).toBe(false);
});

it('blocks the chapel partition, leaves its walk-through open, and follows both exterior leaves', () => {
  const world = newWorld();
  props.update(world, 1, 0);
  expect(leg(p(19, 1.4, 16.5), p(16, 1.4, 16.5))).toBe(false);
  expect(leg(p(19, 1.4, 12.8), p(16, 1.4, 12.8))).toBe(true);
  for (const z of [16.1, 16.9]) expect(leg(p(14.2, 1.5, z), p(12, 1.5, z))).toBe(false);
  world.doors.chapelFront = true;
  props.update(world, 1, 1);
  expect(leg(p(14.2, 1.5, 16.5), p(12, 1.5, 16.5))).toBe(true);
});

it('blocks opaque floor and ceiling slabs but leaves the stair apertures open', () => {
  expect(leg(p(7, 1.2, 12), p(7, -2, 12))).toBe(false);
  expect(leg(p(18, 1.4, 18), p(18, -1.4, 18))).toBe(false);
  expect(leg(p(-9.2, 5.1, 15), p(-9.2, 2.6, 15))).toBe(false);
  expect(leg(p(20, 4.7, 21), p(20, 3.1, 21))).toBe(false);
  expect(leg(p(7, 0.9, 9.9), p(7, -1.0, 9.9))).toBe(true);
  expect(leg(p(15, 1.1, 18.5), p(15, -0.1, 18.5))).toBe(true);
  expect(leg(p(7, 1, 12), p(7, 0, 12))).toBe(true); // top surface receives illumination
});

it('keeps both fire baskets and the wall lantern at their own flames across player movement', () => {
  const w = newWorld();
  w.phase = 'night';
  w.hearth.burn = w.lampBurn = w.braziers.chapel = w.braziers.side = 30;
  props.update(w, 1, 0.2);
  expect(props.lampLight.intensity).toBe(0); // a burn counter cannot light a broken mount
  w.repairs.lamp = true;
  props.update(w, 1, 0.2);
  expect(props.localLights.every(light => light.intensity > 0)).toBe(true);
  const attached: THREE.PointLight[] = [];
  props.group.traverse(o => { if (o instanceof THREE.PointLight) attached.push(o); });
  expect(new Set(attached)).toEqual(new Set(props.localLights));
  const at = (light: THREE.PointLight) => light.getWorldPosition(new THREE.Vector3()).toArray();
  const original = props.localLights.map(at);
  expect(at(props.lampLight)[2]).toBeCloseTo(-(LAMP_POS.z - 0.32 - 0.6 * 1.15));
  expect(at(props.lampLight)[1]).toBeCloseTo(LAMP_POS.y + 1.15 * (-0.28 - 0.09 + 0.067));
  for (const id of ['chapel', 'side'] as const) {
    const a = BRAZIER_POS[id];
    expect(at(props.brazierLights[id])).toEqual([a.x, a.y + 0.04, -a.z]);
  }
  w.player.x = BRAZIER_POS.side.x;
  w.player.y = -3;
  w.player.z = BRAZIER_POS.side.z;
  w.player.floor = 'B1';
  props.update(w, 1, 0.2);
  expect(props.localLights.map(at)).toEqual(original);
  expect(props.localLights.every(light => light.intensity > 0)).toBe(true);
  const litMaterials = new Set<THREE.MeshStandardMaterial>();
  props.group.traverse(o => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.emissiveIntensity > 0
        && o.material.emissive.getHex() !== 0) litMaterials.add(o.material);
  });
  expect(litMaterials.size).toBe(4); // lamp glass, two braziers, hearth embers
  expect(leg(props.hearthLight.getWorldPosition(new THREE.Vector3()), p(-1.2, 1, -4.4))).toBe(true);
  expect(leg(props.lampLight.getWorldPosition(new THREE.Vector3()), p(-5, 1, 26))).toBe(true);
  expect(leg(props.lampLight.getWorldPosition(new THREE.Vector3()), p(-5, 1, 30))).toBe(false);
  expect(leg(props.brazierLights.side.getWorldPosition(new THREE.Vector3()), p(-9.2, 2.5, 14))).toBe(false);
  w.braziers.chapel = 0;
  props.update(w, 1, 0.3);
  expect(props.brazierLights.chapel.intensity).toBe(0);
  expect(props.brazierLights.side.intensity).toBeGreaterThan(0);
  w.hearth.lit = false;
  w.lampBurn = w.braziers.side = 0;
  props.update(w, 1, 0.4);
  expect(props.localLights.every(light => light.intensity === 0)).toBe(true);
  expect([...litMaterials].every(mat => mat.emissiveIntensity === 0)).toBe(true);
  const particles: THREE.Points[] = [];
  props.group.traverse(o => { if (o instanceof THREE.Points) particles.push(o); });
  expect(particles.length).toBe(4);
  expect(particles.every(o => !o.visible)).toBe(true);
  const lantern = makeLantern(m, new THREE.Texture());
  expect(lantern.glow.visible).toBe(false);
  expect(lantern.glass.emissiveIntensity).toBe(0);
});

it('shares moving door uniforms and installs solely on the physical point-light path', () => {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const loop = THREE.ShaderChunk.lights_fragment_begin;
  installLocalLightTransport();
  expect(THREE.ShaderChunk.lights_physical_pars_fragment).toBe(chunk);
  expect(THREE.ShaderChunk.lights_fragment_begin).toBe(loop);
  expect(chunk).toContain('#define getPointLightInfo awGetLocalPointLightInfo');
  expect(chunk.indexOf('getPointLightInfo(pointLight, geometryPosition, light)')).toBeLessThan(chunk.indexOf('#define getPointLightInfo'));
  expect(otherChunkNames.map(name => THREE.ShaderChunk[name])).toEqual(otherChunks);
  for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
    expect(shader.fragmentShader.indexOf('#include <lights_pars_begin>')).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_physical_pars_fragment>'));
    expect(shader.fragmentShader.indexOf('#include <lights_physical_pars_fragment>')).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_fragment_begin>'));
    const uniforms = THREE.UniformsUtils.clone(shader.uniforms);
    expect(uniforms.uAwLocalLeaves.value).toBe(LOCAL_LIGHT_UNIFORMS.uAwLocalLeaves.value);
    expect(uniforms.uAwLocalTree.value.source).toBe(LOCAL_LIGHT_UNIFORMS.uAwLocalTree.value.source);
  }
});

it('guards exactly the PBR point BRDF after transport, watchman shielding and point shadows', () => {
  const loop = THREE.ShaderChunk.lights_fragment_begin;
  const guard = /^[ \t]*#ifdef STANDARD\n[ \t]*if \( any\( notEqual\( directLight\.color, vec3\( 0\.0 \) \) \) \)\n[ \t]*#endif\n/gm;
  expect([...loop.matchAll(guard)]).toHaveLength(1);
  expect(loop.replace(guard, '')).toBe(originalLightLoop);

  // Use the actual material hook to check the exact call anchor still works and
  // that the test of final energy comes after every point-light multiplier.
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} } as THREE.WebGLProgramParametersWithUniforms;
  shieldWatchmanLamp(shader, { value: new THREE.Vector3() });
  const point = shader.fragmentShader.slice(shader.fragmentShader.indexOf('pointLight = pointLights[ i ];'))
    .split('#pragma unroll_loop_end')[0];
  let previous = -1;
  for (const marker of ['getPointLightInfo(', 'directLight.color *= mix', 'getPointShadow(',
    'if ( any( notEqual( directLight.color, vec3( 0.0 ) ) ) )', 'RE_Direct(']) {
    const offset = point.indexOf(marker);
    expect(offset, marker).toBeGreaterThan(previous);
    previous = offset;
  }
});

it('keeps representative sight lines well below the 128-node shader budget', () => {
  let count = 0, visited = 0, max = 0;
  for (const origin of [...props.localLights.map(light => light.getWorldPosition(new THREE.Vector3())),
    p(0, 1.4, -2), p(6, -1.4, 12), p(16, -1.4, 16), p(23, 5.2, 21)]) {
    for (let y = -2; y < 6; y += 1.1) for (let z = -5; z < 29; z += 2) for (let x = -12; x < 31; x += 2) {
      const point = p(x, y, z);
      if (origin.distanceToSquared(point) > 17 ** 2) continue;
      const { visits } = traceLocalLight(origin, point);
      visited += visits;
      count++;
      max = Math.max(max, visits);
    }
  }
  expect(count).toBeGreaterThan(2000);
  expect(visited / count).toBeLessThan(40);
  expect(max).toBeLessThan(100);
});
