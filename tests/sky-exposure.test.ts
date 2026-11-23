import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';
import { AREAS, DOORS, RAISED_Y, S1_SHAFT, S2_SHAFT, WALLS } from '../src/sim/level';
import { GATEHOUSE_LIGHTS } from '../src/render/gatehouseWindows';
import { CHAPEL_APERTURES, COURT_TRANSPORT_GLSL, GATEHOUSE_APERTURES, GATEHOUSE_WINDOW_RETURN, SKY_RECEIVER_PLAN, SKY_SHAFTS } from '../src/render/probeLighting';
import { installSkyExposure } from '../src/render/skyExposure';
import { skyExposureSourceUniforms, stageSkyExposureSources } from '../src/render/skyExposureSources';

type Point = [number, number, number];
type Opening = typeof GATEHOUSE_APERTURES[number];
const rectDepth = (r: { x0: number; z0: number; x1: number; z1: number }, [x, , z]: Point) =>
  Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);

// Independent CPU checks against the opening data emitted to the shader. Check
// the two ends of the masonry reveal so a ray through a jamb cannot pass.
function through(opening: Opening, from: Point, direction: Point, doorOpen = false): boolean {
  const axis = opening.axis === 'x' ? 0 : 2;
  const lateral = axis === 0 ? 2 : 0;
  if ((opening.door && !doorOpen) || direction[axis] * opening.side <= 0) return false;
  return [-.23, .23].every(lip => {
    const t = (opening.plane + lip - from[axis]) / direction[axis];
    const u = Math.abs(from[lateral] + t * direction[lateral] - opening.lateral) / (opening.width / 2);
    const h = from[1] + t * direction[1] - opening.bottom;
    if (t <= 0 || u >= 1 || h <= 0) return false;
    const curve = Math.sqrt(1-u);
    const top = opening.spring + (opening.height-opening.spring)*(1.44*curve-.44*curve*curve);
    return h < top;
  });
}

function s1Angle([x, y, z]: Point) {
  const h = -y;
  const corner = (a: number, b: number) => Math.atan2(a*b, h*Math.hypot(a, b, h));
  const {x0, x1, z0, z1} = SKY_SHAFTS.court;
  return (corner(x0-x,z0-z) + corner(x1-x,z1-z) - corner(x0-x,z1-z) - corner(x1-x,z0-z)) / (2*Math.PI);
}

function intersectIntervals(lo: Point, hi: Point, start: Point, end: Point) {
  let near = 0, far = 1;
  for (let i = 0; i < 3; i++) {
    const delta = end[i] - start[i];
    if (Math.abs(delta) < 1e-5) {
      if (start[i] < lo[i] || start[i] > hi[i]) return false;
      continue;
    }
    const a = (lo[i] - start[i]) / delta, b = (hi[i] - start[i]) / delta;
    near = Math.max(near, Math.min(a,b));
    far = Math.min(far, Math.max(a,b));
  }
  return near < far;
}

describe('receiver sky transport', () => {
  it('uses the gatehouse door and both real glass seats, with no opening in its blind wall', () => {
    const [door, front, rear] = GATEHOUSE_APERTURES;
    expect([door.plane, door.width, door.height]).toEqual([DOORS.gatehouse.hinge.z, 1.6, DOORS.gatehouse.box.h]);
    expect(through(door, [0, 1.25, -1.7], [0, 0, 1])).toBe(false);
    expect(through(door, [0, 1.25, -1.7], [0, 0, 1], true)).toBe(true);
    expect(through(door, [.73, 2.57, -1.7], [0, 0, 1], true)).toBe(false);
    expect(through(door, [.53, 1.25, -1.7], [.16, 0, 1], true)).toBe(false);
    for (const [pane, authored] of [[front, GATEHOUSE_LIGHTS[0]], [rear, GATEHOUSE_LIGHTS[1]]] as const) {
      expect(pane.lateral).toBeCloseTo(authored.x, 1);
      expect(through(pane, [pane.lateral, 1.92, -3.5], [0, 0, pane.side])).toBe(true);
    }
    expect(GATEHOUSE_APERTURES.some(a => through(a, [-1.7, .6, -7.55], [0, 0, -1], true))).toBe(false);
    const room = SKY_RECEIVER_PLAN.gatehouse;
    expect(rectDepth(room, [-1.7, 1.65, -7.95])).toBeGreaterThan(0);
    expect(rectDepth(room, [-1.7, 1.65, -8.5])).toBeLessThan(0);
  });

  it('locates the rotated chapel openings and keeps the partition and gallery as aperture blockers', () => {
    const [door, bridge, westRose] = CHAPEL_APERTURES;
    expect([door.plane, door.lateral, door.bottom, door.height]).toEqual([13.25, 16.5, RAISED_Y, 3.2]);
    expect(through(door, [15, 1.3, 16.5], [-1, 0, 0], true)).toBe(true);
    expect(through(bridge, [14, 1.2, 20.25], [-1, 0, 0], true)).toBe(false);
    expect(through(bridge, [14, 5.1, 20.25], [-1, 0, 0], true)).toBe(true);
    expect(through(westRose, [15, 9.7, 16.5], [-1, 0, 0])).toBe(true);
    expect(CHAPEL_APERTURES.filter(a => a.axis === 'z' && a.side > 0).map(a => a.plane)).toEqual(Array(5).fill(22.25));
    expect(CHAPEL_APERTURES.find(a => a.axis === 'z' && a.lateral === 18)?.plane).toBe(10.75);
    const walls = WALLS.filter(w => w.x0 === 17.5 && w.x1 === 17.9);
    const blocked = (p: Point, q: Point) => walls.some(w => intersectIntervals([w.x0, RAISED_Y, w.z0], [w.x1, w.h, w.z1], p, q));
    expect(blocked([20, 1.2, 16.5], [13, 1.5, 16.5])).toBe(true);
    expect(blocked([20, 1.2, 12.7], [16.3, 1.5, 12.7])).toBe(false);
    expect(blocked([20, 8.0, 16.5], [13, 9.2, 16.5])).toBe(false);
    expect(COURT_TRANSPORT_GLSL).toContain('awSegmentBox(p,q,vec3(13.50,3.70,20.0),vec3(24.0,4.0,22.0))');
    for (const w of walls) expect(COURT_TRANSPORT_GLSL).toContain(`vec3(17.9000,${w.h.toFixed(4)},${w.z1.toFixed(4)})`);
  });

  it('bounds S1 sky to the upper shaft and only gives S2 reception from chapel bounce', () => {
    expect(SKY_SHAFTS.court).toMatchObject(S1_SHAFT);
    expect(SKY_SHAFTS.chapel).toMatchObject(S2_SHAFT);
    expect(SKY_SHAFTS.chapel.lip).toBe(RAISED_Y);
    expect(s1Angle([5.5, -.22, 9.9])).toBeGreaterThan(.70);
    expect(s1Angle([5.5, -1.55, 9.9])).toBeLessThan(.31);
    const deep: Point[] = [[5.9, -2.98, 6.8], [11.8, -2.25, 10.2], [19.1, -2.8, 17.3]];
    for (const p of deep) {
      expect(Object.values(SKY_RECEIVER_PLAN).some(r => rectDepth(r, p) > 0)).toBe(true);
      expect(Object.values(SKY_SHAFTS).some(shaft => rectDepth(shaft, p) > 0 && p[1] > shaft.lip - shaft.reach)).toBe(false);
    }
    expect(rectDepth(AREAS.store, deep[2])).toBeGreaterThan(0);
    expect(COURT_TRANSPORT_GLSL).toContain('awKeyOpening(vec3 p, vec3 dir, int room)');
    expect(COURT_TRANSPORT_GLSL).toContain('if (room == AW_CELLAR) return awS1Ray(p, dir);');
    expect(COURT_TRANSPORT_GLSL).toContain('if (room == AW_CELLAR && light.shaft <= 0.0) return 0.0;');
    expect(COURT_TRANSPORT_GLSL).toContain('awRoomDiffuse(mouth, vec3(0.0, 1.0, 0.0), AW_CHAPEL)');
    expect(COURT_TRANSPORT_GLSL).toContain('light.aperture.y += second * (chapelSky.x + chapelSky.y)');
  });

  it('returns pane daylight to the inside back wall below the rear opening', () => {
    const rear = GATEHOUSE_APERTURES[2];
    const patch = GATEHOUSE_WINDOW_RETURN;
    const center = new THREE.Vector3(rear.lateral, patch.elevation, rear.plane - rear.side * patch.depth);
    const projectedArea = .86 * rear.width * rear.height;
    const flux = Math.PI * projectedArea * rear.transmission * patch.retainedFlux;
    const estimate = (p: Point, n: Point, sky: number) => {
      const ray = center.clone().sub(new THREE.Vector3(...p));
      const distanceSquared = ray.lengthSq();
      const dir = ray.normalize();
      const formFactor = Math.max(0, -dir.y) * Math.max(0, dir.dot(new THREE.Vector3(...n)));
      return sky * flux * formFactor / (Math.PI * distanceSquared + patch.area);
    };
    // Near the center of the hardware audit's belowRearWindow ROI, offset
    // from the rear liner by 25 mm just like the shader's receiver.
    const below: Point = [-.072, 1.229, GATEHOUSE_LIGHTS[1].z1 + .025];
    const normal: Point = [0, 0, 1];
    const rayToPane = new THREE.Vector3(rear.lateral, rear.bottom, rear.plane).sub(new THREE.Vector3(...below));
    expect(rayToPane.dot(new THREE.Vector3(...normal))).toBeLessThan(0);
    const day = estimate(below, normal, 1.3271);
    const night = estimate(below, normal, .09566);
    expect(day).toBeGreaterThan(.022);
    expect(night).toBeLessThan(day * .08);
    expect(estimate(below, [0, 0, -1], 1.3271)).toBe(0);
    expect(estimate(below, normal, 0)).toBe(0);
    expect(estimate([2.915, 1.817, -6.222], [-1, 0, 0], 1.3271)).toBeLessThan(day * .5);
    expect(COURT_TRANSPORT_GLSL).toContain('received.y += returnFlux * viewFactor');
  });

  it('registers once and injects aperture irradiance between source assembly and the BRDF', () => {
    const originalEnd = THREE.ShaderChunk.lights_fragment_end;
    installSkyExposure();
    const chunks = { ...THREE.ShaderChunk };
    installSkyExposure();
    expect(THREE.ShaderChunk).toEqual(chunks);
    expect(THREE.ShaderChunk.worldpos_vertex).toMatch(/USE_INSTANCING[\s\S]*modelMatrix \* worldPosition[\s\S]*vAwExposurePosition/);
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('nonPerturbedNormal, viewMatrix');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('getPointLightInfo( pointLight, geometryPosition, directLight );');
    expect(THREE.ShaderChunk.lights_fragment_maps.indexOf('irradiance *= awLight.ambient')).toBeGreaterThan(
      THREE.ShaderChunk.lights_fragment_maps.indexOf('clearcoatRadiance +='));
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('iblIrradiance *= awLight.ambient');
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('clearcoatRadiance *= awSpecularOpening');
    expect(THREE.ShaderChunk.lights_fragment_end).toBe(originalEnd);
    expect(COURT_TRANSPORT_GLSL).toContain('if (room == AW_OUTSIDE) {\n    awCourtTransport');

    const fragment = THREE.ShaderLib.standard.fragmentShader;
    expect(fragment.indexOf('#include <lights_fragment_maps>')).toBeLessThan(fragment.indexOf('#include <lights_fragment_end>'));
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('irradiance += uAwSkyIrradiance');
  });

  it('uploads staged sky and door values to existing program variants and late material clones', () => {
    installSkyExposure();
    const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    const names = [
      { name: 'uAwSkyDoors', type: 0x8b50, size: 1 },
      { name: 'uAwSkyIrradiance', type: 0x8b51, size: 1 },
    ];
    const context = {
      getProgramParameter: () => names.length,
      getActiveUniform: (_program: unknown, i: number) => names[i],
      getUniformLocation: (_program: unknown, name: string) => name,
      uniform2fv: vi.fn(), uniform3fv: vi.fn(),
    };
    const gl = context as unknown as WebGLRenderingContext;
    const program = new WebGLUniforms(gl, {} as ConstructorParameters<typeof WebGLUniforms>[1]);
    // The Three typings omit upload and seqWithValue. Exercise the real
    // uploader using mocked GL calls and compare the bind-time payload.
    const api = WebGLUniforms as typeof WebGLUniforms & {
      seqWithValue(seq: unknown, values: unknown): unknown;
      upload(gl: WebGLRenderingContext, seq: unknown, values: unknown): void;
    };
    const bound = api.seqWithValue((program as WebGLUniforms & { seq: unknown }).seq, uniforms);
    try {
      stageSkyExposureSources(new THREE.Vector2(.25, .5), new THREE.Color(.25, .5, 1.25));
      api.upload(gl, bound, uniforms);
      expect(context.uniform2fv).toHaveBeenLastCalledWith('uAwSkyDoors', new Float32Array([.25, .5]));
      expect(context.uniform3fv).toHaveBeenLastCalledWith('uAwSkyIrradiance', new Float32Array([.25, .5, 1.25]));
      const late = THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms);
      expect(late.uAwSkyIrradiance.value).toBe(skyExposureSourceUniforms.uAwSkyIrradiance.value);
      expect(late.uAwCourtTransport.value.isData3DTexture).toBe(true);

      stageSkyExposureSources(new THREE.Vector2(0, .75), new THREE.Color(.0625, .125, .25));
      api.upload(gl, bound, uniforms);
      expect(context.uniform2fv).toHaveBeenCalledTimes(2);
      expect(context.uniform3fv).toHaveBeenCalledTimes(2);
      expect(context.uniform3fv).toHaveBeenLastCalledWith('uAwSkyIrradiance', new Float32Array([.0625, .125, .25]));
      expect(late.uAwSkyDoors.value).toEqual(new Float32Array([0, .75]));
    } finally {
      stageSkyExposureSources(new THREE.Vector2(), new THREE.Color(0));
    }
  });
});
