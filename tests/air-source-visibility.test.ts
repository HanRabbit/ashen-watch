import * as THREE from 'three';
import { expect, it } from 'vitest';
import { GATEHOUSE_APERTURES, SKY_SHAFTS } from '../src/render/probeLighting';
import { AIR_OCCLUSION_GLSL, AIR_SOURCE_GLSL } from '../src/render/post/airVolume';
import { LightGlowShader } from '../src/render/post/glow';
import { ShadowVolumePass } from '../src/render/post/shadowVolume';

// Check the actual proxy bounds emitted into the world-space light-leg shader.
function unpackVector(csv: string) {
  return new THREE.Vector3(...csv.split(',').map(Number) as [number, number, number]);
}
const barriers = Array.from(AIR_OCCLUSION_GLSL.matchAll(/awBoxLeg\(a, inv, vec3\(([-., 0-9]+)\), vec3\(([-., 0-9]+)\)\)/g),
  ([, lo, hi]) => new THREE.Box3(unpackVector(lo), unpackVector(hi)));
const renderPoint = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);
function blocked(from: THREE.Vector3, to: THREE.Vector3) {
  const leg = to.clone().sub(from), distance = leg.length();
  const ray = new THREE.Ray(from, leg.normalize());
  return barriers.some(box => {
    const hit = ray.intersectBox(box, new THREE.Vector3());
    return hit && hit.distanceTo(from) < distance;
  });
}

it('blocks light through the cellar ceiling and walls while retaining a clear indoor leg and both stair paths', () => {
  expect(barriers.length).toBeGreaterThan(10);
  expect(blocked(renderPoint(8, 1, 12), renderPoint(8, -1.7, 12))).toBe(true);
  expect(blocked(renderPoint(10, -1.4, 12.4), renderPoint(11.7, -1.4, 14))).toBe(true);
  expect(blocked(renderPoint(7, -1.5, 12), renderPoint(8, -1.5, 13))).toBe(false);
  for (const shaft of [SKY_SHAFTS.court, SKY_SHAFTS.chapel]) {
    const x = (shaft.x0 + shaft.x1) * 0.5, z = (shaft.z0 + shaft.z1) * 0.5;
    expect(blocked(renderPoint(x, 0.8, z), renderPoint(x, -0.7, z))).toBe(false);
  }
  expect(AIR_SOURCE_GLSL).toMatch(/if \(p\.y < 0\.0\) return awCourtShaftSky/);
  expect(AIR_SOURCE_GLSL).toMatch(/if \(p\.y < 0\.0\) return awCourtShaftKey/);
  const shaft = SKY_SHAFTS.court;
  const vec2 = (x: number, z: number) => `vec2(${x.toFixed(4)}, ${(-z).toFixed(4)})`;
  expect(AIR_SOURCE_GLSL).toContain(`awCourtShaftSky(p, ${vec2(shaft.x0, shaft.z1)}, ${vec2(shaft.x1, shaft.z0)})`);
});

it('uses the real arched panes on both ends of the gatehouse light path', () => {
  expect(blocked(renderPoint(-2.4, 1.9, -3.8), renderPoint(-3.9, 1.9, -3.8))).toBe(true);
  for (const aperture of GATEHOUSE_APERTURES.filter(a => !a.door)) {
    const z = (-aperture.plane).toFixed(4);
    expect(AIR_SOURCE_GLSL).toContain(`vec3(${aperture.lateral.toFixed(4)}, ${aperture.bottom.toFixed(4)}, ${z})`);
  }
  expect(AIR_OCCLUSION_GLSL).toMatch(/min\(awAirFrame\(pane,p\),awAirFrame\(pane,q\)\) > 0\.0/);
  expect(AIR_OCCLUSION_GLSL).toContain('front && uAirDoors.x > 0.55');
  expect(LightGlowShader.fragmentShader).not.toContain('awWindowColumn');
});

it('applies source visibility to the fallback, integrated weather and both local-light effects', () => {
  const glow = LightGlowShader.fragmentShader;
  expect(glow).toContain('* awSkyAccess(p)');
  expect(glow).toContain('return c*transmission+radiance;');
  expect(glow).toContain('if (!hasDepth) break;');
  expect(glow).toContain('if (occ < 0.001) continue;');
  expect(glow).toContain('if (awLightLeg(worldLight,uCamPos) == 0.0) continue;');
  expect(glow).toContain('if (awLightLeg(worldLight, world) == 0.0) return 0.0;');
  expect(glow).toContain('foreground * haloLeg');
  expect(glow).not.toContain('mix(0.035, 1.0, leg)');
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.map = new THREE.WebGLRenderTarget(4, 4, { format: THREE.RGFormat });
  const volume = new ShadowVolumePass(true, () => key, () => {});
  const opaqueDepth = new THREE.DepthTexture(4, 4);
  try {
    volume.uniforms.tDepth.value = opaqueDepth;
    let shader = '';
    const renderer = { shadowMap: { enabled: true }, setRenderTarget() {}, render(mesh: THREE.Mesh) {
      shader = (mesh.material as THREE.ShaderMaterial).fragmentShader;
    } } as unknown as THREE.WebGLRenderer;
    volume.render(renderer);
    expect(shader).toContain('ambient*sky*mix');
    expect(shader).toContain('awKeyAccess(pa,uKeyDirection)');
    expect(shader).toContain('awKeyAccess(pb,uKeyDirection)');
    expect(shader).toContain('trans*=1.-opacity');
    expect(shader).toContain('texelsPerMetre*(stop-start)');
    expect(shader).toContain('textureLod(tWeather');
  } finally {
    volume.dispose();
    key.shadow.map.dispose();
    opaqueDepth.dispose();
  }
});
