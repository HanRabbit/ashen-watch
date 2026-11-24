import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AREAS, CHAPEL_SLABS, PROPS, RAISED_Y, S2_SHAFT, supportY, type Rect } from '../src/sim/level';
import { CHAPEL_APERTURES, CHAPEL_DAYLIGHT_CAP, CHAPEL_DAYLIGHT_GAIN, CHAPEL_DAYLIGHT_RANGE, CHAPEL_SURFACE_GRID as grid, COURT_TRANSPORT_GLSL,
  loadChapelSurfaceTransport } from '../src/render/probeLighting';
import { installSkyExposure } from '../src/render/skyExposure';
import { CHAPEL_STONE_RETURN, chapelDaylightBlocked, chapelPaneIrradiance } from '../tools/chapelSurfaceBake';

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const up = vec(0, 1, 0);
const west = vec(-1, 0, 0);
const north = vec(0, 0, 1);
const panes = CHAPEL_APERTURES.filter(a => a.bottom >= 7);
const luminance = (c: THREE.Color) => c.r * .2126 + c.g * .7152 + c.b * .0722;
const returnFrom = (p: THREE.Vector3, n: THREE.Vector3, b: typeof CHAPEL_STONE_RETURN[number]) => {
  const ray = b.center.clone().sub(p), d2 = ray.lengthSq(), dir = ray.normalize();
  const facing = THREE.MathUtils.smoothstep(n.dot(dir), 0, .08);
  const form = facing * Math.max(0, n.dot(dir)) * Math.max(0, -b.n.dot(dir));
  return !form || chapelDaylightBlocked(p, b.center) ? 0 : b.flux * form / (Math.PI * d2 + b.area);
};
const returnAt = (p: THREE.Vector3, n: THREE.Vector3) => CHAPEL_STONE_RETURN.reduce((sum, b) => sum + returnFrom(p, n, b), 0);
const directAt = (p: THREE.Vector3, n: THREE.Vector3) => panes.reduce((sum, a) => sum + chapelPaneIrradiance(a, p, n), 0);

// The immutable texture, trilinear interpolation, storage curve, normal
// lobes and geometric air-side offset used by awChapelSurfaceDaylight.
const texture = loadChapelSurfaceTransport();
function fieldAt(p: THREE.Vector3, n: THREE.Vector3, geometricN = n) {
  const q = p.clone().addScaledVector(geometricN, .17);
  if (q.y < .15 || q.y > 16.27) return 0;
  const { nx, ny, nz, step, range } = grid;
  const layer = (q.y-grid.y)/step;
  const cell = [(q.x-grid.x)/step, (q.z-grid.z)/step, Math.min(layer, grid.fineLayers)+Math.max(0,layer-grid.fineLayers)*step/grid.upperStep]
    .map((v, i) => THREE.MathUtils.clamp(v, 0, [nx, nz, ny][i] - 1));
  const [x0, z0, y0] = cell.map(Math.floor), [fx, fz, fy] = cell.map(v => v - Math.floor(v));
  const data = texture.image.data as Uint8Array;
  const bankSize = nx * ny * nz * 4;
  const transfer = range * n.toArray().reduce((sum, c, channel) => {
    const bank = c < 0 ? bankSize : 0;
    let sample = 0;
    for (let dy = 0; dy <= 1; ++dy) for (let dz = 0; dz <= 1; ++dz) for (let dx = 0; dx <= 1; ++dx) {
      const x = Math.min(x0 + dx, nx - 1), z = Math.min(z0 + dz, nz - 1), y = Math.min(y0 + dy, ny - 1);
      const i = bank + (x + nx * (z + nz * y)) * 4 + channel;
      sample += data[i] / 255 * (dx ? fx : 1-fx) * (dz ? fz : 1-fz) * (dy ? fy : 1-fy);
    }
    return sum + (sample * c) ** 2;
  }, 0);
  const energy = CHAPEL_DAYLIGHT_GAIN * transfer;
  return energy / (1 + energy / CHAPEL_DAYLIGHT_CAP);
}

const containsXZ = (r: Rect, p: THREE.Vector3) =>
  p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;
const altar = PROPS.find(p => p.tag === 'altar')!;
const altarFront = vec(altar.x0 + .15 - .025, RAISED_Y + .65, (altar.z0 + altar.z1) / 2);
const [vestibule, nave, approach] = [[15.4, 14.2], [20.75, 15.85], [28.4, 16.5]]
  .map(([x, z]) => vec(x, RAISED_Y + .025, z));

describe('chapel daylight surface transport', () => {
  it('admits window irradiance on traversable flagstones and the lower altar and nave masonry', () => {
    for (const p of [vestibule, nave, approach]) {
      expect(supportY(p.x, p.z, RAISED_Y)).toEqual({ y: RAISED_Y, floor: '1F' });
      expect(containsXZ(S2_SHAFT, p)).toBe(false);
      expect(directAt(p, up)).toBeGreaterThan(.018);
      expect(directAt(p, vec(0, -1, 0))).toBe(0);
    }
    const stone = vec(24.8, 1.5, AREAS.chapel.z0 + .025);
    expect(directAt(stone, north)).toBeGreaterThan(.02);
    expect(directAt(stone, vec(0, 0, -1))).toBe(0);
    expect(directAt(altarFront, west)).toBeGreaterThan(.018);
    expect(panes.some(a => a.door)).toBe(false);
  });

  it('cuts both aperture and bounce paths at the gallery, partition, stair mass and shaft headwall', () => {
    const pane = panes.find(a => a.axis === 'z' && a.side === 1 && a.lateral === 23.3)!;
    expect(chapelPaneIrradiance(pane, vec(23.3, 4.025, 20.2), up)).toBeGreaterThan(.005);
    expect(chapelPaneIrradiance(pane, vec(23.3, RAISED_Y + .025, 20.2), up)).toBe(0);
    // A floor return may cross the partition only through a genuine walk-through.
    const westFloor = CHAPEL_STONE_RETURN[0];
    expect(chapelDaylightBlocked(vec(19, 1.2, 16.5), westFloor.center)).toBe(true);
    expect(returnFrom(vec(19, 1.2, 16.5), west, westFloor)).toBe(0);
    expect(chapelDaylightBlocked(vec(18.4, 1.2, 12.65), vec(16.5, 1.2, 12.65))).toBe(false);
    expect(chapelDaylightBlocked(vec(26, 1.2, 20.2), vec(26, 1.2, 21.9))).toBe(true);
    expect(chapelDaylightBlocked(vec(26, 4.2, 20.2), vec(26, 4.2, 21.9))).toBe(false);
    expect(chapelDaylightBlocked(vec(15, .8, 17.1), vec(15, .8, 17.65))).toBe(true);
  });

  it('routes only one bounded, one-sided stone return from the glazing', () => {
    const floor = CHAPEL_STONE_RETURN.filter(b => b.n.y > 0);
    for (const b of floor) {
      expect(CHAPEL_SLABS.some(s => containsXZ(s, b.center))).toBe(true);
      expect(containsXZ(S2_SHAFT, b.center)).toBe(false);
      expect(returnFrom(b.center.clone().add(vec(0, -1, 0)), up, b)).toBe(0);
    }
    const returnToAltar = returnAt(altarFront, west);
    expect(returnToAltar).toBeGreaterThan(.004);
    expect(returnToAltar).toBeLessThan(directAt(altarFront, west));
    expect(returnAt(nave, up)).toBeGreaterThan(.001);
    expect(fieldAt(nave, up)).toBeGreaterThan(.11);
    expect(fieldAt(altarFront, west)).toBeGreaterThan(.099);
    expect(fieldAt(nave, vec(0, -1, 0))).toBeLessThan(fieldAt(nave, up) * .12);
    // A buried texel in the west baffle stays black instead of allowing
    // the volume filter to blend straight from one air side to the other.
    const baffleCore = vec(grid.x + 16 * grid.step, grid.y + 3 * grid.step, grid.z + 22 * grid.step);
    expect(fieldAt(baffleCore, west, vec(0, 0, 0))).toBeCloseTo(0, 10);
    expect(fieldAt(vec(15, 8, 16.5), west)).toBeGreaterThan(.1); // not a black stripe at the old top layer
    expect(fieldAt(vec(15, 18, 16.5), west)).toBe(0);
    expect(texture.image).toMatchObject({ width: grid.nx, height: grid.nz, depth: 2 * grid.ny });
    installSkyExposure();
    for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
      expect(shader.uniforms.uAwChapelSurface.value.isData3DTexture).toBe(true);
    }
    const sampler = COURT_TRANSPORT_GLSL.split('float awChapelSurfaceDaylight')[1].split('// Projected solid angle')[0];
    expect(sampler.match(/texture\(uAwChapelSurface/g)).toHaveLength(2);
    expect(sampler).not.toMatch(/\bfor\s*\(|awSegmentBox|awChapelBlocked/);
  });

  it('does not add fill with the true night sky or zero sky, even on strongly exposed chapel surfaces', () => {
    // view.ts RIGS use a linearized hemi color times hemi * envI. True night
    // has real moonlit hemi radiance (it is not equivalent to a zero uniform).
    const night = new THREE.Color(0x7d90b4).multiplyScalar(2.45 * .14);
    const day = new THREE.Color(0xc8d2da).multiplyScalar(2.34 * .88);
    const daylight = (sky: THREE.Color) => THREE.MathUtils.smoothstep(luminance(sky), ...CHAPEL_DAYLIGHT_RANGE);
    const contribution = (p: THREE.Vector3, n: THREE.Vector3, sky: THREE.Color) => luminance(sky) * daylight(sky) * fieldAt(p, n);
    expect(luminance(night)).toBeCloseTo(.09467, 4);
    expect(daylight(day)).toBe(1);
    for (const [p, n] of [[nave, up], [altarFront, west]]) {
      expect(contribution(p, n, day)).toBeGreaterThan(.13);
      expect(contribution(p, n, night)).toBe(0);
      expect(contribution(p, n, new THREE.Color(0))).toBe(0);
    }
    // S2 still calls the non-daylight overload. The enhanced diffuse channel
    // is populated only in the chapel branch, not in gatehouse/shaft or specular.
    expect(COURT_TRANSPORT_GLSL).toContain('awRoomDiffuse(mouth, vec3(0.0, 1.0, 0.0), AW_CHAPEL)');
    expect(COURT_TRANSPORT_GLSL).toMatch(/if \(room == AW_CHAPEL\) \{[\s\S]*dot\(uAwSkyIrradiance,[\s\S]*if \(daylight > 0.0\) light.aperture.y \+= daylight/);
    expect(COURT_TRANSPORT_GLSL).toContain('mix(ray, light.aperture.x * 0.62, spread)');
  });
});
