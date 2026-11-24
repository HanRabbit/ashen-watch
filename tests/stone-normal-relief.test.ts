import * as THREE from 'three';
import { beforeAll, expect, it, vi } from 'vitest';
import { makeMaterials, texturesReady, type AwUniforms, type Materials } from '../src/render/materials';
import { variants, type Variants } from '../src/render/materialVariants';
import { buildGatehouseLights } from '../src/render/gatehouseWindows';
import { Batch } from '../src/render/geom';
import { installGlassCaustics } from '../src/render/glassCaustics';

let base: Materials;
let stone: Variants;
const scans = new Map<string, THREE.Texture>();

beforeAll(async () => {
  const gradient = () => ({ addColorStop() {} });
  const image = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
  const context = new Proxy({
    createImageData: image,
    getImageData: (_x: number, _y: number, w: number, h: number) => image(w, h),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const texture = new THREE.Texture<HTMLImageElement>();
    scans.set(url, texture);
    return texture;
  });
  try {
    base = makeMaterials();
    stone = variants(base);
    await texturesReady;
  } finally {
    load.mockRestore();
    vi.unstubAllGlobals();
  }
});

const aw = (mat: THREE.MeshStandardMaterial) => mat.userData.aw as AwUniforms;
const scan = (name: string, slot: string) => scans.get(`textures/${name}_${slot}.jpg`);

function bakeShader(mat: THREE.MeshStandardMaterial) {
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} } as Parameters<typeof mat.onBeforeCompile>[0];
  mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

// Execute the emitted scalar shader math, not a second copy of the curve.
// These two leaf functions use only scalar arithmetic, max and smoothstep.
function scalar3(shader: string, name: string): (a: number, b: number, c: number) => number {
  const fn = new RegExp(`float ${name}\\(([^)]+)\\) \\{([^}]+)\\}`).exec(shader);
  if (!fn) throw new Error(`Missing scalar shader function ${name}`);
  const args = fn[1].replace(/float /g, '').split(',');
  const run = new Function('max', 'smoothstep', ...args, fn[2].replace(/\bfloat /g, 'const '));
  return (a, b, c) => run(Math.max, (lo: number, hi: number, x: number) => THREE.MathUtils.smoothstep(x, lo, hi), a, b, c);
}

it('softens only the steep tail of bright exposed ashlar with zero view pressure', () => {
  const glsl = bakeShader(stone.wallAshlar).fragmentShader;
  const mask = scalar3(glsl, 'awNearFacePressure'), scale = scalar3(glsl, 'awTailScale');
  expect(glsl).toContain('awFacePressure = awNearFacePressure(uAwNearFace, awLum, awCavity)');
  expect(glsl).toContain('awTailScale(tilt, knee, max(pressure, awFacePressure))');
  const { uAwNearFace, uAwReliefKnee } = aw(stone.wallAshlar);
  const k = uAwReliefKnee.value, face = mask(uAwNearFace.value, .17, 0);
  const out = (tilt: number, pressure = face) => tilt * scale(tilt, k, pressure);
  expect(face).toBeGreaterThan(0);
  for (const tilt of [0, k - .01, k]) expect(out(tilt)).toBe(tilt);
  expect(out(k + .01)).toBeGreaterThan(k);
  expect(out(k + .01)).toBeLessThan(k + .01);
  const slope95 = Math.tan(THREE.MathUtils.degToRad(38.6)); // measured high-AO face p95
  const degrees = THREE.MathUtils.radToDeg(Math.atan(out(slope95)));
  expect(degrees).toBeGreaterThan(31);
  expect(degrees).toBeLessThan(34);
  for (const [lum, cavity] of [[.25, 1], [.25, .5], [.08, 0]]) {
    expect(out(slope95, mask(uAwNearFace.value, lum, cavity))).toBe(slope95);
  }
  for (const [name, mat] of Object.entries(stone)) {
    if (name !== 'wallAshlar' && mat.userData.aw) expect(aw(mat).uAwNearFace.value).toBe(0);
  }
});

it('binds the live ashlar uniform in the real glass-caustics receiver clone, including after a material refresh', () => {
  const scene = new THREE.Scene(), level = new THREE.Group(), key = new THREE.DirectionalLight();
  buildGatehouseLights(new Batch(), level, stone.wallTrim, base.iron);
  const source = stone.wallAshlar, mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
  mesh.position.set(0, 1, 2);
  mesh.receiveShadow = true;
  level.add(mesh);
  scene.add(level, key);
  const handle = installGlassCaustics(scene, level, key);
  try {
    const clone = mesh.material, ref = aw(source).uAwNearFace;
    expect(clone).not.toBe(source);
    expect(clone.customProgramCacheKey()).toContain(source.customProgramCacheKey() + '|aw-glass-caustics:');
    expect(bakeShader(source).uniforms.uAwNearFace).toBe(ref);
    const checkBinding = () => {
      const { uniforms, fragmentShader } = bakeShader(clone);
      expect(uniforms.uAwGlassKey).toBeDefined();
      expect(aw(clone).uAwNearFace).toBe(ref);
      expect(uniforms.uAwNearFace).toBe(ref);
      expect(fragmentShader).toContain('awFacePressure = awNearFacePressure(uAwNearFace, awLum, awCavity)');
    };
    checkBinding();
    source.needsUpdate = true;
    clone.onBeforeRender({ shadowMap: {} } as THREE.WebGLRenderer, scene, new THREE.Camera(), mesh.geometry, mesh, level);
    checkBinding();
  } finally { handle.dispose(); }
});

it('keeps cropped courtyard normal and AO registered to the real slab UV including the repair stones', () => {
  for (const [material, name, scale] of [
    [stone.floorFlag, 'monastery_stone_floor', .86],
    [stone.floorFlagWorn, 'stone_pavers', .81],
  ] as const) {
    expect(material.normalMap).toBe(scan(name, 'nor'));
    expect(material.aoMap).toBe(scan(name, 'ao'));
    expect(material.normalScale.toArray()).toEqual([scale, scale]);
    expect(material.bumpMap).toBeNull();
    expect(material.displacementMap).toBeNull();
    expect(aw(material).uAwHeightScale.value).toBe(0);
    expect(aw(material).uAwHasDisp.value).toBe(0);
  }
  expect(scan('monastery_stone_floor', 'disp')).toBeUndefined();
  // Repair flags still share the stone_pavers normal with the wall trim, but
  // only trim receives that scan's height; enabling it there must not leak.
  expect(stone.floorFlagWorn.normalMap).toBe(stone.wallTrim.normalMap);
  expect(aw(stone.wallTrim).uAwHeightMap.value).toBe(scan('stone_pavers', 'disp'));
  expect(aw(stone.wallTrim).uAwHasDisp.value).toBe(1);
});

it('opts the chapel and court stone into distinct slope budgets without globally reducing normalScale', () => {
  for (const [material, knee, scale] of [
    [stone.wallAshlar, .42, 1], [stone.wallRough, .48, 1.2], [stone.wallTrim, .24, .56],
    [stone.wallRubble, .31, .72], [stone.floorInterior, .16, 1], [stone.floorCobble, .32, .8],
    [stone.floorFlag, .26, .86], [stone.floorFlagWorn, .20, .81],
  ] as const) {
    expect(aw(material).uAwReliefKnee.value).toBe(knee);
    expect(bakeShader(material).uniforms).toHaveProperty('uAwReliefKnee', aw(material).uAwReliefKnee);
    expect(material.normalScale.toArray()).toEqual([scale, scale]);
  }
  expect(scan('medieval_blocks_03', 'disp')).toBeUndefined();
  expect(aw(stone.floorInterior).uAwHasDisp.value).toBe(0);
  expect(aw(stone.wallRubble).uAwHeightMap.value).toBe(scan('castle_wall_varriation', 'disp'));
  expect(aw(base.roof).uAwReliefKnee.value).toBe(0);
  expect(aw(stone.floorDirt).uAwReliefKnee.value).toBe(0);
});

it('gates the wall ray before the height fetch and samples every scan layer with the same stable footprint', () => {
  const { fragmentShader: glsl } = bakeShader(stone.wallRubble);
  const pom = glsl.slice(glsl.indexOf('vec2 awPom('), glsl.indexOf('float awReliefPressure('));
  expect(pom).toContain('uAwSteps < 1.0 || uAwHasDisp < 0.5 || uAwHeightScale <= 0.0');
  expect(pom).toContain('awCrossUV(ray, awDy), awCrossUV(awDx, ray)');
  expect(pom).toContain('smoothstep(0.75, 2.5, pixels)');
  expect(pom).toMatch(/if \(graze \* fade < 0\.02\) return uv;\s*float h = awHeight\(uv\);/);
  expect(glsl).toMatch(/awDx = dFdx\(scanUv\); awDy = dFdy\(scanUv\);[\s\S]+awUv = awPom\(scanUv,/);
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    expect(glsl).toContain(`textureGrad(${slot}, awUv, awDx, awDy)`);
  }
  expect(glsl).toContain('getTangentFrame( - vViewPosition, normal,');
  expect(glsl).toContain('awScanBasisUv\n');
});

it('composes the mineral relief around the geometric normal before treating standing water separately', () => {
  const { fragmentShader: glsl } = bakeShader(stone.floorFlag);
  expect(glsl).toContain('awReliefPressure(abs(dot(awView, nonPerturbedNormal)), awDx, awDy)');
  expect(glsl).toContain('max(1.0 - smoothstep(0.12, 0.42, viewCos), smoothstep(0.004, 0.020, footprint))');
  expect(glsl).toContain('mix(uAwReliefKnee, 0.90, awCavity)');
  expect(glsl).toContain('awStoneNormal(nonPerturbedNormal, normal, awGrainTangent, knee, pressure)');
  expect(glsl).toContain('1.0 - smoothstep(0.65 * knee, 1.5 * knee, length(slope))');
  expect(glsl).toContain('float excess = max(tilt - knee, 0.0)');
  expect(glsl).toContain('return normalize(base + slope * scale)');
  expect(glsl).toMatch(/awMineralDelta = normalize\(normal\) - nonPerturbedNormal;\s*\/\/[^\n]*\nnormal = normalize\(mix\(normal, viewMatrix\[1\]\.xyz,/);
  expect(glsl).toContain('dFdx(awMineralDelta)');
  expect(glsl).toMatch(/float slopeVariance = .* \* \(1\.0 - awPuddle\);/);
});
