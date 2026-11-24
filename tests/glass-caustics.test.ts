import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { WALLS } from '../src/sim/level';
import { buildGatehouseLights, windowWallPieces } from '../src/render/gatehouseWindows';
import { installGlassCaustics } from '../src/render/glassCaustics';
import { Batch } from '../src/render/geom';
import { GATEHOUSE_APERTURES } from '../src/render/probeLighting';
import { installSkyExposure } from '../src/render/skyExposure';

type Pane = THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
type Compile = Parameters<THREE.Material['onBeforeCompile']>[0];
const fakeRenderer = { shadowMap: { enabled: true, type: THREE.VSMShadowMap } } as THREE.WebGLRenderer;

function fixture() {
  const scene = new THREE.Scene(), level = new THREE.Group(), batch = new Batch();
  const stone = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const lead = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const floor = new THREE.MeshPhysicalMaterial();
  for (const wall of [...WALLS.filter(w => w.y0 === undefined && (w.tag === 'gh' || w.z0 === 0)),
    { x0: -3, x1: 3, z0: -8, z1: -7.94, h: 3.5 }]) {
    for (const p of windowWallPieces({ ...wall, y0: 0 })) batch.box(stone, p.x0, p.z0, p.x1, p.z1, p.y0, p.h);
  }
  buildGatehouseLights(batch, level, stone, lead);
  batch.box(floor, -3.5, -8.5, 3.5, 0, -0.30, 0.005);
  batch.build(level);
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  scene.add(level, new THREE.PointLight(), key, key.target);
  const panes = level.children.filter(object => object.name.endsWith(' quarries')) as Pane[];
  const receiver = level.children.find(object => (object as THREE.Mesh).material === floor) as THREE.Mesh;
  scene.updateMatrixWorld(true);
  return { scene, level, key, panes, floor, receiver };
}

function compile(material: THREE.Material): Compile {
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {},
  } as Compile;
  material.onBeforeCompile(shader, fakeRenderer);
  return shader;
}

it('wraps only local shadow receivers, uses real glazing data, and preserves existing material and chunk hooks', () => {
  const { scene, level, key, panes, floor, receiver } = fixture();
  const remote = new THREE.Mesh(new THREE.BoxGeometry(), floor);
  remote.receiveShadow = true;
  remote.position.set(30, 0.5, 0);
  level.add(remote);
  floor.onBeforeCompile = shader => { shader.fragmentShader += '\n// existing material hook'; };
  floor.customProgramCacheKey = () => 'existing';
  const stock = THREE.ShaderChunk.lights_fragment_begin;
  // Exercise composition with an independent chunk patch installed after us.
  const controller = installGlassCaustics(scene, level, key);
  expect(installGlassCaustics(scene, level, key)).toBe(controller);
  try {
    expect(THREE.ShaderChunk.lights_fragment_begin).toBe(stock);
    THREE.ShaderChunk.lights_fragment_begin = stock.replace('getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n// existing directional hook');
    const bound = receiver.material as THREE.MeshPhysicalMaterial;
    expect(bound).not.toBe(floor);
    expect(remote.material).toBe(floor);
    expect(bound.customProgramCacheKey()).toMatch(/^existing\|aw-glass-caustics/);
    const { fragmentShader: source, uniforms } = compile(bound);
    expect(source).toContain('// existing material hook');
    expect(source).toContain('// existing directional hook');
    expect(source).not.toContain('#include <lights_fragment_begin>');
    expect(source).not.toContain('totalEmissiveRadiance *=');
    const directional = source.slice(source.indexOf('getDirectionalLightInfo( directionalLight, directLight );'));
    expect(directional.indexOf('getShadow( directionalShadowMap[ i ]')).toBeLessThan(directional.indexOf('uAwGlassKey =='));
    expect(directional.indexOf('directLight.color *= 1.0 +')).toBeLessThan(directional.indexOf('RE_Direct('));
    expect(directional).toContain('visibility > 0.0');
    expect(source).toContain('inversesqrt(0.09 + 0.91*area*area) - 1.0');
    expect(source).toContain('exposed = awGlassShadowVisibility(uAwGlassShadowMatrix');
    for (const [i, pane] of panes.entries()) {
      expect(uniforms[`uAwGlassWaves${i}`].value).toBe(pane.material.normalMap);
      expect(uniforms[`uAwGlassScale${i}`].value).toBe(pane.material.normalScale);
      expect(source).toContain(`vec4(${pane.position.z.toFixed(6)},`);
    }
    floor.map = new THREE.Texture();
    floor.needsUpdate = true;
    bound.onBeforeRender(fakeRenderer, scene, new THREE.Camera(), receiver.geometry, receiver, new THREE.Group());
    expect(bound.map).toBe(floor.map);
  } finally {
    THREE.ShaderChunk.lights_fragment_begin = stock;
    controller.dispose();
  }
  expect(receiver.material).toBe(floor);
});

it('disables the beam with no live shadow key and leaves other light and depth draws alone', () => {
  const { scene, level, key, panes, receiver } = fixture();
  const camera = new THREE.PerspectiveCamera();
  const other = new THREE.DirectionalLight();
  other.castShadow = true;
  scene.remove(key);
  scene.add(other, key);
  const prior = vi.fn();
  scene.onBeforeRender = prior;
  const oldPaneHook = panes[0].onBeforeShadow;
  const controller = installGlassCaustics(scene, level, key);
  const material = receiver.material as THREE.Material;
  const { uniforms } = compile(material);
  const stage = () => scene.onBeforeRender(fakeRenderer, scene, camera, receiver.geometry, material, new THREE.Group());
  stage();
  expect(prior).toHaveBeenCalledTimes(1);
  expect(uniforms.uAwGlassKey.value).toBe(1);
  expect(uniforms.uAwGlassBeam.value).toBeCloseTo(0.255);
  key.intensity = 0;
  stage();
  expect(uniforms.uAwGlassKey.value).toBe(-1);
  expect(uniforms.uAwGlassBeam.value).toBe(0);
  key.intensity = 1;
  key.visible = false;
  stage();
  expect(uniforms.uAwGlassKey.value).toBe(-1);
  key.visible = true;
  controller.beamFraction = 0;
  stage();
  expect(uniforms.uAwGlassKey.value).toBe(1);
  expect(uniforms.uAwGlassBeam.value).toBe(0);
  controller.beamFraction = 1;
  controller.enabled = false;
  stage();
  expect(uniforms.uAwGlassKey.value).toBe(1);
  expect(uniforms.uAwGlassBeam.value).toBe(0);
  expect(uniforms.uAwGlassShadowReady.value).toBe(false);
  const depth = new THREE.MeshDepthMaterial();
  const pane = panes[0];
  const args = [pane as unknown as THREE.Scene, camera, key.shadow.camera, pane.geometry, depth, new THREE.Group()] as const;
  pane.onBeforeShadow(fakeRenderer, ...args);
  expect([depth.depthWrite, depth.colorWrite]).toEqual([false, false]);
  pane.onAfterShadow(fakeRenderer, ...args);
  pane.onBeforeShadow(fakeRenderer, args[0], camera, other.shadow.camera, pane.geometry, depth, args[5]);
  expect([depth.depthWrite, depth.colorWrite]).toEqual([true, true]);
  controller.dispose();
  expect(scene.onBeforeRender).toBe(prior);
  expect(pane.onBeforeShadow).toBe(oldPaneHook);
});

it('composes with live sky exposure before the stock key shadow, without tying the reveal to the caustic switch', () => {
  installSkyExposure();
  const { scene, level, key, receiver } = fixture();
  const controller = installGlassCaustics(scene, level, key);
  try {
    const { fragmentShader: src } = compile(receiver.material as THREE.Material);
    const opening = src.indexOf('float paneThroughput = awGlassFlatTransmission');
    const shadow = src.indexOf('getShadow( directionalShadowMap[ i ]');
    const modulation = src.indexOf('directLight.color *= 1.0 + uAwGlassBeam');
    expect(opening).toBeGreaterThan(0);
    expect(opening).toBeLessThan(shadow);
    expect(shadow).toBeLessThan(modulation);
    const keyPath = src.slice(src.indexOf('float awGateOpening ='), shadow);
    expect(keyPath).toContain('awRoom == AW_GATEHOUSE');
    expect(keyPath).toContain('awGlassShadowVisibility(vDirectionalShadowCoord[ i ], uAwGlassShadowBias) > 0.0');
    expect(keyPath).not.toContain('uAwGlassBeam');
    expect(src).toContain(`return ${GATEHOUSE_APERTURES[1].transmission.toFixed(6)} * awGlassFlatPath(`);
  } finally {
    controller.dispose();
  }
});

it('feathers only the admitted side of the restored straight-through beam', () => {
  const { scene, level, key, receiver } = fixture();
  const controller = installGlassCaustics(scene, level, key);
  try {
    const { fragmentShader: src } = compile(receiver.material as THREE.Material);
    const reveal = src.split('float awGlassRevealClearance(')[1].split('// Exact straight-through')[0];
    const flat = src.split('float awGlassFlatPath(')[1].split('vec2 awGlassSlope')[0];
    const refracted = src.split('float awGlassGather(')[1].split('#endif')[0];
    expect(reveal.match(/awGlassArchClearance\(/g)).toHaveLength(5); // both mouths and all seat slices
    expect(flat).toContain('if (reveal <= 0.0) return 0.0;');
    expect(flat).toContain('min(awGlassCameClearance(xy, slope, seat, quarry), awGlassBarClearance(xy, slope, seat, bars))');
    expect(flat).toContain('const float revealFeather = 0.018000;');
    expect(flat).toContain('smoothstep(0.0, revealFeather, reveal) * smoothstep(0.0, 0.006000, tracery)');
    expect(refracted).toContain('planes, segments, 0.0) <= 0.0'); // no change to bent-path masks
  } finally {
    controller.dispose();
  }
});

it('preserves the sky key geometry depth across the r187 VSM blur without changing any other draw', () => {
  const { scene, level, key, receiver } = fixture();
  const controller = installGlassCaustics(scene, level, key);
  const camera = new THREE.PerspectiveCamera(), group = new THREE.Group();
  const drawGroup = { start: 0, count: 0 };
  const material = receiver.material as THREE.Material;
  const { uniforms } = compile(material);
  const map = key.shadow.map = new THREE.WebGLRenderTarget(16, 16, { depthTexture: new THREE.DepthTexture(16, 16) });
  const mapPass = key.shadow.mapPass = new THREE.WebGLRenderTarget(16, 16);
  const other = new THREE.WebGLRenderTarget(16, 16);
  const vertical = new THREE.ShaderMaterial({ defines: { VSM_SAMPLES: 8 }, uniforms: { shadow_pass: { value: map.depthTexture } } });
  const horizontal = new THREE.ShaderMaterial({
    defines: { VSM_SAMPLES: 8, HORIZONTAL_PASS: 1 }, uniforms: { shadow_pass: { value: mapPass.texture } },
  });
  let target: THREE.WebGLRenderTarget = map;
  const clear = vi.fn((_color = true, _depth = true, _stencil = true) => {});
  const draws: boolean[][] = [];
  const draw = vi.fn((_c, _s, _g, m: THREE.Material) => draws.push([m.depthTest, m.depthWrite]));
  const run = vi.fn(() => {
    // Reproduce Three's raw clear, vertical gather, and horizontal reuse of the raw target.
    target = map;
    renderer.clear();
    target = mapPass;
    renderer.clear();
    renderer.renderBufferDirect(camera, scene, receiver.geometry, vertical, receiver, drawGroup);
    target = map;
    renderer.clear();
    renderer.renderBufferDirect(camera, scene, receiver.geometry, horizontal, receiver, drawGroup);
    target = other;
    renderer.clear();
    renderer.renderBufferDirect(camera, scene, receiver.geometry, horizontal, receiver, drawGroup);
  });
  const renderer = {
    shadowMap: { enabled: true, type: THREE.VSMShadowMap, render: run },
    getRenderTarget: () => target, clear, renderBufferDirect: draw,
  } as unknown as THREE.WebGLRenderer;
  try {
    scene.onBeforeRender(renderer, scene, camera, receiver.geometry, material, group);
    material.onBeforeRender(renderer, scene, camera, receiver.geometry, receiver, group);
    expect(uniforms.uAwGlassShadowReady.value).toBe(false);
    renderer.shadowMap.render([key], scene, camera);
    expect(clear.mock.calls).toEqual([[true, true, true], [true, true, true], [true, false, true], [true, true, true]]);
    expect(draws).toEqual([[true, true], [false, false], [true, true]]);
    expect([horizontal.depthTest, horizontal.depthWrite]).toEqual([true, true]);
    expect(renderer.clear).toBe(clear);
    expect(renderer.renderBufferDirect).toBe(draw);
    material.onBeforeRender(renderer, scene, camera, receiver.geometry, receiver, group);
    expect(uniforms.uAwGlassShadowReady.value).toBe(true);
    expect(uniforms.uAwGlassDepth.value).toBe(map.depthTexture);
    // If the shadow target is recreated or the verified sequence did not run, fail closed.
    map.depthTexture = new THREE.DepthTexture(16, 16);
    material.onBeforeRender(renderer, scene, camera, receiver.geometry, receiver, group);
    expect(uniforms.uAwGlassShadowReady.value).toBe(false);
  } finally {
    controller.dispose();
  }
  expect(renderer.shadowMap.render).toBe(run);
});

const refraction = (i: THREE.Vector3, n: THREE.Vector3, eta: number) => {
  const c = i.dot(n);
  return i.clone().multiplyScalar(eta).addScaledVector(n, -(eta*c + Math.sqrt(1-eta*eta*(1-c*c))));
};

function wave(pane: Pane, uv: THREE.Vector2) {
  const { data, width, height } = (pane.material.normalMap as THREE.DataTexture).image;
  if (!data) throw new Error('Missing pane normal texels');
  const x = uv.x*width-0.5, y = uv.y*height-0.5;
  const rgb = [0, 0, 0];
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
    const xi = Math.min(width-1, Math.max(0, Math.floor(x)+i)), yi = Math.min(height-1, Math.max(0, Math.floor(y)+j));
    const weight = (i ? x-Math.floor(x) : 1-x+Math.floor(x)) * (j ? y-Math.floor(y) : 1-y+Math.floor(y));
    for (let k = 0; k < 3; k++) rgb[k] += (Number(data[(yi*width+xi)*4+k])*2/255-1)*weight;
  }
  return new THREE.Vector3(rgb[0]*pane.material.normalScale.x, rgb[1]*pane.material.normalScale.y, -rgb[2]).normalize();
}

it('finds real room-floor light paths and both focusing and dispersal with the courtyard A/B lamp', () => {
  const { level, panes, receiver } = fixture();
  const front = panes[0];
  const sun = new THREE.Vector3(-0.12, 0.72, -1).normalize();
  const opaque = level.children.filter(object => !panes.includes(object as Pane));
  const hit = (p: THREE.Vector3, d: THREE.Vector3, objects: THREE.Object3D[]) =>
    new THREE.Raycaster(p, d, 0.002).intersectObjects(objects, false)[0];
  let minimum = 0, maximum = 0, clearSamples = 0;
  for (let z = 2.5; z <= 3.25; z += 0.035) for (let x = -1.95; x < -1.30; x += 0.035) {
    const center = new THREE.Vector3(x, 0.005, z);
    const straight = hit(center, sun, [front]);
    if (!straight || hit(center, sun, opaque)) continue;
    clearSamples++;
    const depth = z-front.position.z, slope = new THREE.Vector2(-sun.x, -sun.y).divideScalar(-sun.z);
    const incoming = sun.clone().negate();
    const inGlass = refraction(incoming, new THREE.Vector3(0, 0, -1), 1/front.material.ior);
    const spacing = 0.010 + depth*(0.005 + 0.0035*slope.lengthSq());
    let delta = 0, normalization = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const q = straight.point.clone().add(new THREE.Vector3(i*spacing, j*spacing, 0));
      const kernel = (distance: number) => Math.max(0, 1-distance**2/(1.55*spacing)**2)**2;
      const reference = kernel(Math.hypot(i, j)*spacing);
      normalization += reference;
      // Use ray-triangle tests for the arch and cames, independently of the shader's ring clipping.
      const entry = q.clone().addScaledVector(sun, 0.008);
      if (hit(entry, sun, opaque)) continue;
      const uv = hit(entry, incoming, [front])?.uv;
      if (!uv) continue;
      if (hit(q, incoming, opaque)?.object === receiver) delta -= reference;
      const exit = refraction(inGlass, wave(front, uv), front.material.ior);
      const floorHit = hit(q, exit, opaque);
      if (floorHit?.object === receiver) {
        const projected = q.clone().addScaledVector(exit, depth / exit.z);
        delta += kernel(Math.hypot(projected.x-x, projected.y-center.y));
      }
    }
    minimum = Math.min(minimum, delta/normalization);
    maximum = Math.max(maximum, delta/normalization);
  }
  expect(clearSamples).toBeGreaterThan(60);
  expect(minimum).toBeLessThan(-0.12);
  expect(maximum).toBeGreaterThan(0.25);
  const sealed = new THREE.Mesh(new THREE.BoxGeometry(1, 1.8, 0.12), new THREE.MeshStandardMaterial());
  sealed.position.copy(front.position).add(new THREE.Vector3(0, 0.6, -0.40));
  sealed.updateMatrixWorld(true);
  expect(hit(new THREE.Vector3(-1.65, 0.005, 2.85), sun, [...opaque, sealed])?.object).toBe(sealed);
});

it('finds refracted receiver samples with the unmodified overcast key where the coarse reveal undercounts direct light', () => {
  const { level, panes, receiver } = fixture();
  const front = panes[0];
  // View's overcast day rig, Three world coordinates (not an audit-only light).
  const sun = new THREE.Vector3(-0.58, 0.68, -0.42).normalize();
  const opaque = level.children.filter(object => !panes.includes(object as Pane));
  const trace = (p: THREE.Vector3, d: THREE.Vector3, targets: THREE.Object3D[], far = 95) =>
    new THREE.Raycaster(p, d, 0.002, far).intersectObjects(targets, false)[0];
  const proxy = GATEHOUSE_APERTURES[1];
  const coarseFrame = (q: THREE.Vector3) => {
    const lateral = Math.abs(q.x - proxy.lateral);
    const t = Math.sqrt(Math.max(0, 1 - lateral / (proxy.width * .5)));
    const head = THREE.MathUtils.lerp(proxy.spring, proxy.height, t * (1.44 - .44 * t));
    return THREE.MathUtils.smoothstep(Math.min(proxy.width * .5 - lateral, q.y - proxy.bottom, head - (q.y - proxy.bottom)), -.025, .025);
  };
  const incoming = sun.clone().negate();
  const flatSlope = new THREE.Vector2(incoming.x, incoming.y).divideScalar(incoming.z);
  const inGlass = refraction(incoming, new THREE.Vector3(0, 0, -1), 1 / front.material.ior);
  const bentSlope = (uv: THREE.Vector2) => {
    const d = refraction(inGlass, wave(front, uv), front.material.ior);
    return new THREE.Vector2(d.x, d.y).divideScalar(d.z);
  };
  const points = (front.geometry.parameters.shapes as THREE.Shape).getPoints(front.geometry.parameters.curveSegments);
  const width = 2 * Math.max(...points.map(p => p.x)), height = Math.max(...points.map(p => p.y));
  let clear = 0, undercounted = 0, refracted = 0, focused = 0, dispersed = 0;
  for (let z = .85; z <= 1.22; z += .006) for (let x = -.53; x <= .01; x += .006) {
    const p = new THREE.Vector3(x, .005, z);
    const straight = trace(p, sun, [front]);
    if (!straight?.uv || trace(p, sun, opaque)) continue;
    clear++;
    const sampleP = p.clone().add(new THREE.Vector3(0, .025, 0));
    const coarse = [-.23, .23].map(offset => coarseFrame(sampleP.clone().addScaledVector(sun,
      (sampleP.z + proxy.plane + offset) / -sun.z))).reduce((a, b) => a * b);
    if (coarse < .1) undercounted++;

    const depth = z - front.position.z;
    const shift = bentSlope(straight.uv).sub(flatSlope).multiplyScalar(depth);
    const paneLoc = straight.point.clone().sub(new THREE.Vector3(shift.x, shift.y, 0));
    const entry = paneLoc.clone().addScaledVector(sun, .009);
    const through = trace(entry, incoming, [front]);
    if (!through?.uv || trace(entry, sun, opaque)) continue;
    const slope = bentSlope(through.uv);
    const exit = new THREE.Vector3(slope.x, slope.y, 1).normalize();
    const hit = trace(paneLoc, exit, opaque, 5);
    if (hit?.object !== receiver || (hit.face?.normal.y ?? 0) < .9 || hit.point.distanceTo(p) > .06) continue;
    refracted++;

    const radius = .012 + .007 * depth;
    const gradient = (dx: number, dy: number) => bentSlope(through.uv!.clone().add(new THREE.Vector2(dx, dy)))
      .sub(bentSlope(through.uv!.clone().sub(new THREE.Vector2(dx, dy)))).multiplyScalar(depth / (2 * radius));
    const u = gradient(radius / width, 0).add(new THREE.Vector2(1, 0));
    const v = gradient(0, radius / height).add(new THREE.Vector2(0, 1));
    const area = u.x * v.y - u.y * v.x;
    const flux = 1 / Math.sqrt(.09 + .91 * area * area) - 1;
    focused += Number(flux > .02);
    dispersed += Number(flux < -.02);
  }
  expect(clear).toBeGreaterThan(30);
  expect(undercounted).toBeGreaterThan(10);
  expect(refracted).toBeGreaterThan(10);
  expect(focused).toBeGreaterThan(1);
  expect(dispersed).toBeGreaterThan(1);
});
