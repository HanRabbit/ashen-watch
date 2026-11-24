import * as THREE from 'three';
import { AREAS, DOORS, RAISED_Y, S1_SHAFT, S2_SHAFT, WALLS } from '../sim/level';
import { GATEHOUSE_LIGHTS } from './gatehouseWindows';
import bakedData from './baked/court.irr.bin?url&inline';
import chapelSurfaceData from './baked/chapel-surface.irr.bin?url&inline';
import { PROBE_COUNT, PROBE_GRID as g } from './probeGrid';

function readTransport(asset: string, size: number): Uint8Array<ArrayBuffer> {
  const encoded = asset.slice(asset.indexOf(',') + 1);
  const data = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
  if (data.length !== size) throw new Error('Invalid diffuse transport bake');
  return data;
}

/** Install the immutable bake before Three clones its first material uniforms. */
export function loadCourtTransport(): THREE.Data3DTexture {
  const data = readTransport(bakedData, PROBE_COUNT * 8);
  const map = new THREE.Data3DTexture(data, g.nx, g.nz, 2 * g.ny);
  map.name = 'Court diffuse transport';
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/** Effective pierced opening in metres. The normal points from the room to
 * weather. Transmission includes glazing and the fraction open within tracery. */
export interface Aperture {
  plane: number; lateral: number; bottom: number; width: number; height: number;
  spring: number; axis: 'x' | 'z'; side: 1 | -1; transmission: number; door?: 'gatehouse' | 'chapelFront';
}

const gate = DOORS.gatehouse.box, chapel = DOORS.chapelFront.box;
const gatePlan = AREAS.gatehouse;
const cellarPlan = AREAS.cellar;
const passagePlan = AREAS.passage;
const storePlan = AREAS.store;
// Boundaries go inside the masonry, between the exposed wall faces. Sills,
// soffits and moving meshes select their side with a small geometric offset.
export const SKY_RECEIVER_PLAN = {
  gatehouse: { x0: gatePlan.x0-.25, z0: gatePlan.z0-.25, x1: gatePlan.x1+.25, z1: DOORS.gatehouse.hinge.z },
  chapel: { x0: 13.25, z0: 10.75, x1: 30.75, z1: 22.25 },
  cellar: { x0: cellarPlan.x0-.2, z0: cellarPlan.z0-.2, x1: cellarPlan.x1+.2, z1: cellarPlan.z1+.2 },
  passage: { x0: passagePlan.x0+.2, z0: passagePlan.z0-.2, x1: passagePlan.x1+.18, z1: passagePlan.z1+.2 },
  store: { x0: storePlan.x0-.22, z0: storePlan.z0-.20, x1: storePlan.x1+.20, z1: storePlan.z1+.20 },
};
const chapelPartition = WALLS.filter(w => w.x0 === 17.5 && w.x1 === 17.9);
export const SKY_SHAFTS = {
  court: { ...S1_SHAFT, lip: 0, reach: 2.25 },
  chapel: { ...S2_SHAFT, lip: RAISED_Y, reach: 1.8 },
};
export const GATEHOUSE_APERTURES: readonly Aperture[] = [
  { plane: DOORS.gatehouse.hinge.z, lateral: 0, bottom: 0, width: gate.x1 - gate.x0,
    height: gate.h, spring: 1.9, axis: 'z', side: 1, transmission: 1, door: 'gatehouse' },
  ...GATEHOUSE_LIGHTS.map((w): Aperture => ({ plane: (w.z0 + w.z1) * .5, lateral: w.x + (w.hearth ? .022 : -.016),
    bottom: w.bottom + (w.hearth ? .067 : .048), width: w.hearth ? .65 : .69, height: w.peak - .13,
    spring: w.spring - .065, axis: 'z', side: w.hearth ? 1 : -1, transmission: w.hearth ? .28 : .43 })),
];

// Landmarks rotates its authored (x,z) to (38.5-z,x-2.5) in sim space.
// Use its pierced clerestory and the openings cut in the *current* low walls.
const clerestory = (authoredZ: number, authoredX: number, side: 1 | -1): Aperture => ({
  plane: authoredX - 2.5, lateral: 38.5 - authoredZ, bottom: 7.53,
  width: 1.25, height: 2.65, spring: 1.54, axis: 'z', side, transmission: .32,
});
export const CHAPEL_APERTURES: readonly Aperture[] = [
  { plane: DOORS.chapelFront.hinge.x, lateral: (chapel.z0 + chapel.z1) * .5,
    bottom: RAISED_Y, width: chapel.z1 - chapel.z0, height: 3.2, spring: 2.2,
    axis: 'x', side: -1, transmission: 1, door: 'chapelFront' },
  { plane: 13.25, lateral: 20.25, bottom: 4, width: 1.5, height: 2.3, spring: 2.3,
    axis: 'x', side: -1, transmission: .72 }, // high bridge opening
  { plane: 13.25, lateral: 16.5, bottom: 7.90, width: 4, height: 6.10, spring: 3.10,
    axis: 'x', side: -1, transmission: .21 },
  ...[12.82, 20.18].map((lateral): Aperture => ({ plane: 13.25, lateral, bottom: 7.94,
    width: .89, height: 2.44, spring: 1.54, axis: 'x', side: -1, transmission: .38 })),
  { plane: 30.75, lateral: 16.5, bottom: 7.92, width: 2.28, height: 4.42, spring: 2.54,
    axis: 'x', side: 1, transmission: .29 },
  { plane: 10.75, lateral: 18, bottom: 7.90, width: 3.36, height: 5.68, spring: 2.93,
    axis: 'z', side: -1, transmission: .21 },
  ...[9.6, 12.4, 15.2].map(z => clerestory(z, 13.25, -1)),
  ...[9.3, 12.1, 15.2, 20.4, 24.6].map(z => clerestory(z, 24.75, 1)),
];

// This is the extra *daylight* band of the staged sky radiance, not an ambient
// floor. The night rig is ~0.095 linear luminance; full morning is ~0.77.
export const CHAPEL_DAYLIGHT_RANGE = [.12, .66] as const;
// The legacy hemi × env proxy is tuned to broad outdoor fill, not to the
// bright sky visible through the clerestory. Calibrate its daylight band in
// scene-linear units against the gameplay view; only the traced transfer is
// scaled. The cap controls near-sill peaks without lifting occluded surfaces.
export const CHAPEL_DAYLIGHT_GAIN = 28;
export const CHAPEL_DAYLIGHT_CAP = 2.5;
// X,Z,Y layout, with positive and negative normal axes in two RGB banks.
// Keep 25 cm vertical sampling through the baffle/gallery. Above them the
// room is open: 75 cm layers continue through the clerestory to the vault.
export const CHAPEL_SURFACE_GRID = { x: 13.58, y: .475, z: 11.04, nx: 68, ny: 36, nz: 44, step: .25, fineLayers: 19, upperStep: .75, range: 1.04 } as const;
const surfaceProbeCount = CHAPEL_SURFACE_GRID.nx * CHAPEL_SURFACE_GRID.ny * CHAPEL_SURFACE_GRID.nz;

export function loadChapelSurfaceTransport(): THREE.Data3DTexture {
  const data = readTransport(chapelSurfaceData, surfaceProbeCount * 8);
  const { nx, ny, nz } = CHAPEL_SURFACE_GRID;
  const map = new THREE.Data3DTexture(data, nx, nz, 2 * ny);
  map.name = 'Chapel glazing / stone diffuse transfer';
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

// One representative footprint per pane. Collapse the daylight hitting the
// floor and its low masonry edges into an upward diffuse emitter of finite
// area. The retained flux includes the capture fraction and stone reflectance.
export const GATEHOUSE_WINDOW_RETURN = {
  depth: 1.48, elevation: .075, area: 1.05, retainedFlux: .48,
};

const f = (v: number) => v.toFixed(4);
const rect = (r: { x0: number; z0: number; x1: number; z1: number }) =>
  `vec4(${[r.x0, r.z0, r.x1, r.z1].map(f).join(', ')})`;
const pack = (list: readonly Aperture[]) => list.map(w => {
  const x = w.axis === 'x';
  const door = !w.door ? 0 : w.door === 'gatehouse' ? 1 : 2;
  return `AwAperture(vec3(${f(x ? w.plane : w.lateral)}, ${f(w.bottom)}, ${f(x ? w.lateral : w.plane)}), ` +
    `vec2(${f(x ? w.side : 0)}, ${f(x ? 0 : w.side)}), vec4(${[w.width * .5, w.height, w.spring, w.transmission].map(f).join(', ')}), ${door})`;
}).join(',\n    ');

export const COURT_TRANSPORT_GLSL = /* glsl */`
uniform highp sampler3D uAwCourtTransport;
uniform highp sampler3D uAwChapelSurface;
uniform vec2 uAwSkyDoors;
uniform vec3 uAwSkyIrradiance;

const int AW_OUTSIDE = 0, AW_GATEHOUSE = 1, AW_CHAPEL = 2, AW_CELLAR = 3;
const vec4 AW_S1 = ${rect(SKY_SHAFTS.court)}, AW_S2 = ${rect(SKY_SHAFTS.chapel)};
const vec4 AW_CHAPEL_PLAN = ${rect(SKY_RECEIVER_PLAN.chapel)};

float awRectDepth(vec2 p, vec4 r) {
  vec2 d = min(p - r.xy, r.zw - p);
  return min(d.x, d.y);
}

// Use the geometric normal for choosing the air side. Texture normals, and
// the slightly different displacements of stone materials, cannot move a wall
// receiver through a slab or cause it to sample an exterior probe.
int awReceiverRoom(vec3 p, vec3 n) {
  vec3 q = p + n * 0.055;
  if (q.y < 0.0 && (awRectDepth(q.xz, ${rect(SKY_RECEIVER_PLAN.cellar)}) >= 0.0 ||
                   awRectDepth(q.xz, ${rect(SKY_RECEIVER_PLAN.passage)}) >= 0.0)) return AW_CELLAR;
  if (q.y < 0.15 && awRectDepth(q.xz, ${rect(SKY_RECEIVER_PLAN.store)}) >= 0.0) return AW_CELLAR;
  // S2 crosses the raised chapel floor. S1 remains outdoors above its top.
  if (q.y < ${f(RAISED_Y)} && q.y >= 0.15 && awRectDepth(q.xz, AW_S2) > 0.0) return AW_CELLAR;
  if (awRectDepth(q.xz, ${rect(SKY_RECEIVER_PLAN.gatehouse)}) >= 0.0 && q.y > -0.18 && q.y < 5.84) {
    // The finished slate and pitched liner face opposite air volumes. Near
    // the apron the cut starts lower, over the old 4.2 m curtain wall.
    float roofY = 5.62 - abs(p.x)*0.51;
    if (p.z > -3.2) roofY = min(roofY, max(4.08, 5.56 - abs(p.x)*0.87));
    if (n.y > 0.32 && p.y > max(3.65, roofY - 0.16)) return AW_OUTSIDE;
    return AW_GATEHOUSE;
  }
  if (q.y >= 0.15 && q.y < 16.27 && awRectDepth(q.xz, AW_CHAPEL_PLAN) >= 0.0) {
    float roofY = max(16.20 - abs(p.z - 16.5)*0.966, 14.78 - abs(p.x - 18.0)*1.31);
    // The cross-gable is present only on the south-facing roof patch.
    if (p.z > 14.4) roofY = 16.20 - abs(p.z - 16.5)*0.966;
    if (n.y > 0.3 && p.y > roofY - 0.13) return AW_OUTSIDE;
    return AW_CHAPEL;
  }
  return AW_OUTSIDE;
}

void awCourtTransport(vec3 p, vec3 n, vec3 geometricN, out float visibility, out vec3 bounce, out float proximity) {
  visibility = 1.0; bounce = vec3(0.0); proximity = 0.0;
  vec3 q = p + geometricN * 0.32;
  // The coarsely spaced bake was made from yard proxies. A normal-offset
  // sample can straddle a facade and must never substitute for room transport.
  if (awReceiverRoom(q, geometricN) != AW_OUTSIDE) return;
  float weight = smoothstep(-0.12,0.20,p.y) * (1.0-smoothstep(7.8,9.0,q.y));
  weight *= smoothstep(-20.7,-18.9,q.x) * (1.0-smoothstep(10.1,12.9,q.x));
  weight *= smoothstep(-0.10,0.79,q.z) * (1.0-smoothstep(38.3,40.8,q.z));
  if (weight < 0.001) return;
  vec3 cell = (q.xzy - vec3(${g.x},${g.z},${g.y})) / vec3(${g.dx},${g.dx},${g.dy});
  cell = clamp(cell, vec3(0.0), vec3(${g.nx-1}.0,${g.nz-1}.0,${g.ny-1}.0));
  vec3 uvw = (cell+0.5)/vec3(${g.nx}.0,${g.nz}.0,${2*g.ny}.0);
  vec4 sky = texture(uAwCourtTransport,uvw);
  vec4 reflected = texture(uAwCourtTransport,uvw + vec3(0.0,0.0,0.5));
  float openSky = max(0.24, 0.5 + 0.5*n.y);
  float directional = max(0.0, 0.5*sky.a + 2.0*dot(sky.rgb-0.5,n));
  float coverage = mix(sky.a, min(1.0,directional/openSky), smoothstep(-0.6,0.05,n.y)*0.83);
  visibility = mix(1.0, 0.23 + 0.77*coverage, weight);
  bounce = weight * reflected.rgb * 0.25;
  proximity = weight * reflected.a;
}

struct AwAperture {
  vec3 sill;
  vec2 outward;
  vec4 shape;
  int door;
};
const AwAperture AW_GATE_PORTALS[${GATEHOUSE_APERTURES.length}] = AwAperture[${GATEHOUSE_APERTURES.length}](
    ${pack(GATEHOUSE_APERTURES)}
);
const AwAperture AW_CHAPEL_PORTALS[${CHAPEL_APERTURES.length}] = AwAperture[${CHAPEL_APERTURES.length}](
    ${pack(CHAPEL_APERTURES)}
);

float awThroughput(AwAperture a) {
  float opening = a.door == 1 ? uAwSkyDoors.x : (a.door == 2 ? uAwSkyDoors.y : 1.0);
  // The projected width grows as a leaf swings away from its closed plane.
  return a.shape.w * (a.door == 0 ? 1.0 : 1.0 - cos(clamp(opening, 0.0, 1.0)*1.5707963));
}

float awFrameMask(AwAperture a, vec3 p) {
  vec3 d = p - a.sill;
  float lateral = abs(dot(d.xz, a.outward.yx));
  float t = sqrt(max(0.0, 1.0 - lateral/a.shape.x));
  float head = mix(a.shape.z, a.shape.y, t*(1.44 - 0.44*t));
  return smoothstep(-0.025, 0.025, min(a.shape.x-lateral, min(d.y, head-d.y)));
}

// Segment/blocker intersection. These are the opaque internal masses of the
// chapel. They are shared by diffuse, rough reflections, and the key sightline.
bool awSegmentBox(vec3 p, vec3 q, vec3 lower, vec3 upper) {
  vec3 d = q - p;
  vec3 inv = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), d)) / max(abs(d), vec3(0.0001));
  vec3 u = (lower - p)*inv, v = (upper - p)*inv;
  vec3 a = min(u, v), b = max(u, v);
  return max(0.003, max(a.x, max(a.y, a.z))) < min(0.997, min(b.x, min(b.y, b.z)));
}

bool awChapelBlocked(vec3 p, vec3 q) {
  if (awSegmentBox(p,q,vec3(13.50,3.70,20.0),vec3(24.0,4.0,22.0))) return true;
  ${chapelPartition.map(w => `if (awSegmentBox(p,q,vec3(${f(w.x0)},${f(RAISED_Y)},${f(w.z0)}),vec3(${f(w.x1)},${f(w.h)},${f(w.z1)}))) return true;`).join('\n  ')}
  return false;
}

// Offline one-leg glazing + one stone return. A coarse directional cube
// takes two trilinear reads. Geometric bias selects the air side of a baffle;
// shading normals still give the diffuse response on the stone or wood.
float awChapelSurfaceDaylight(vec3 p, vec3 n, vec3 geometricN) {
  vec3 q = p + geometricN * 0.17;
  if (q.y < 0.15 || q.y > 16.27) return 0.0;
  vec3 dims = vec3(${CHAPEL_SURFACE_GRID.nx}.0, ${CHAPEL_SURFACE_GRID.nz}.0, ${CHAPEL_SURFACE_GRID.ny}.0);
  vec3 cell = (q.xzy - vec3(${f(CHAPEL_SURFACE_GRID.x)}, ${f(CHAPEL_SURFACE_GRID.z)}, ${f(CHAPEL_SURFACE_GRID.y)})) / ${f(CHAPEL_SURFACE_GRID.step)};
  cell.z = min(cell.z, ${f(CHAPEL_SURFACE_GRID.fineLayers)}) + max(0.0, cell.z - ${f(CHAPEL_SURFACE_GRID.fineLayers)}) * ${f(CHAPEL_SURFACE_GRID.step / CHAPEL_SURFACE_GRID.upperStep)};
  vec3 uvw = (clamp(cell, vec3(0.0), dims - 1.0) + 0.5) / (dims * vec3(1.0, 1.0, 2.0));
  vec3 positive = texture(uAwChapelSurface, uvw).rgb;
  vec3 negative = texture(uAwChapelSurface, uvw + vec3(0.0, 0.0, 0.5)).rgb;
  vec3 incident = mix(negative, positive, step(vec3(0.0), n));
  float transfer = ${f(CHAPEL_SURFACE_GRID.range)} * dot(n*n, incident*incident);
  float energy = ${f(CHAPEL_DAYLIGHT_GAIN)} * transfer;
  return energy / (1.0 + energy / ${f(CHAPEL_DAYLIGHT_CAP)});
}

// Projected solid angle of the effective hole. Clamp the projected centre
// near jambs so that large portals illuminate their own splayed stonework.
void awDiffuseThrough(AwAperture a, vec3 p, vec3 n, bool chapel, inout vec2 received) {
  float transmission = awThroughput(a);
  float distanceIn = dot(a.sill.xz - p.xz, a.outward);
  if (transmission < 0.0001 || distanceIn < -0.20) return;
  vec2 lateralAxis = a.outward.yx;
  float lateral = dot(p.xz - a.sill.xz, lateralAxis);
  float nearFrame = 1.0 - smoothstep(0.15, 2.0, distanceIn);
  vec2 targetXZ = a.sill.xz + a.outward*0.25 + nearFrame*lateralAxis*clamp(lateral, -0.6*a.shape.x, 0.6*a.shape.x);
  float targetH = a.sill.y + a.shape.y * mix(0.52, clamp((p.y - a.sill.y)/a.shape.y, 0.25, 0.78), nearFrame);
  vec3 target = vec3(targetXZ.x, targetH, targetXZ.y);
  vec3 ray = target - p;
  float d2 = dot(ray, ray);
  vec3 dir = ray * inversesqrt(max(d2, 0.0001));
  float projected = max(0.0, dot(dir.xz, a.outward));
  float area = 1.72 * a.shape.x * a.shape.y;
  float flux = transmission * projected * area / (3.14159265 * d2 + area);
  if (chapel && awChapelBlocked(p, target)) return;
  bool gatehousePane = !chapel && a.door == 0;
  if (gatehousePane) {
    // The gatehouse pane term integrates the broad sky radiance over projected
    // solid angle. Undo the projected-hemisphere normalization for irradiance.
    received.x += PI * flux * max(0.0, dot(n, dir));

    // The window ray lies behind the rear wall's inward-facing surface. Its
    // floor footprint faces that surface and supplies light below the sill.
    vec2 floorXZ = a.sill.xz - a.outward * ${f(GATEHOUSE_WINDOW_RETURN.depth)};
    vec3 toFloor = vec3(floorXZ.x, ${f(GATEHOUSE_WINDOW_RETURN.elevation)}, floorXZ.y) - p;
    float floorD2 = dot(toFloor, toFloor);
    vec3 floorDir = toFloor * inversesqrt(max(floorD2, 0.0001));
    float viewFactor = max(0.0, -floorDir.y) * max(0.0, dot(n, floorDir));
    float returnFlux = PI * transmission * area * ${f(GATEHOUSE_WINDOW_RETURN.retainedFlux)};
    received.y += returnFlux * viewFactor / (PI * floorD2 + ${f(GATEHOUSE_WINDOW_RETURN.area)});
  } else {
    received += flux * vec2(max(0.0, dot(n, dir)), 0.13);
  }
}

float awRayThrough(AwAperture a, vec3 p, vec3 dir, bool chapel) {
  float transmission = awThroughput(a);
  float incidence = dot(dir.xz, a.outward);
  if (transmission < 0.0001 || incidence < 0.025) return 0.0;
  float depth = dot(a.sill.xz - p.xz, a.outward);
  float exitT = (depth + 0.23) / incidence;
  if (exitT <= 0.005) return 0.0;
  vec3 q = p + exitT*dir;
  float frame = awFrameMask(a, q) * awFrameMask(a, p + max(0.0, (depth - 0.23)/incidence)*dir);
  if (frame <= 0.0 || (chapel && awChapelBlocked(p, q))) return 0.0;
  return transmission * frame;
}

vec2 awRoomDiffuse(vec3 p, vec3 n, int room) {
  vec2 received = vec2(0.0);
  if (room == AW_GATEHOUSE) {
    for (int i = 0; i < ${GATEHOUSE_APERTURES.length}; ++i) awDiffuseThrough(AW_GATE_PORTALS[i], p, n, false, received);
  } else {
    for (int i = 0; i < ${CHAPEL_APERTURES.length}; ++i) awDiffuseThrough(AW_CHAPEL_PORTALS[i], p, n, true, received);
  }
  return min(received, vec2(0.82, 0.13));
}

float awRoomRay(vec3 p, vec3 dir, int room) {
  float visible = 0.0;
  if (room == AW_GATEHOUSE) {
    for (int i = 0; i < ${GATEHOUSE_APERTURES.length}; ++i) visible = max(visible, awRayThrough(AW_GATE_PORTALS[i], p, dir, false));
  } else {
    for (int i = 0; i < ${CHAPEL_APERTURES.length}; ++i) visible = max(visible, awRayThrough(AW_CHAPEL_PORTALS[i], p, dir, true));
  }
  return visible;
}

float awShaftWeight(vec3 p, vec4 shaft, float lip, float depth) {
  return smoothstep(-0.08, 0.12, awRectDepth(p.xz, shaft)) * smoothstep(lip-depth, lip-0.12, p.y);
}

float awS1Ray(vec3 p, vec3 dir) {
  if (dir.y < 0.025 || p.y >= 0.02) return 0.0;
  vec3 lip = p+dir*((0.02-p.y)/dir.y);
  return smoothstep(0.0, 0.10, awRectDepth(lip.xz, AW_S1)) * awShaftWeight(p, AW_S1, ${f(SKY_SHAFTS.court.lip)}, ${f(SKY_SHAFTS.court.reach)});
}

float awKeyOpening(vec3 p, vec3 dir, int room) {
  if (room == AW_OUTSIDE) return 1.0;
  if (room == AW_CELLAR) return awS1Ray(p, dir);
  return awRoomRay(p, dir, room);
}

float awShaftSolidAngleCorner(vec2 v, float h) {
  return atan(v.x*v.y, h*sqrt(dot(v,v) + h*h));
}

float awS1SolidAngle(vec3 p) {
  vec2 lo = AW_S1.xy - p.xz, hi = AW_S1.zw - p.xz;
  float h = max(0.025, -p.y);
  float omega = awShaftSolidAngleCorner(lo, h) + awShaftSolidAngleCorner(hi, h)
              - awShaftSolidAngleCorner(vec2(lo.x, hi.y), h) - awShaftSolidAngleCorner(vec2(hi.x, lo.y), h);
  return clamp(omega * 0.15915494, 0.0, 1.0);
}

struct AwReceiverLight {
  float ambient;
  vec2 aperture;
  vec3 courtyardBounce;
  float courtyardNear;
  float shaft;
};

AwReceiverLight awReceiverLight(vec3 p, vec3 n, vec3 geometricN, int room) {
  AwReceiverLight light = AwReceiverLight(0.0, vec2(0.0), vec3(0.0), 0.0, 0.0);
  if (room == AW_OUTSIDE) {
    awCourtTransport(p, n, geometricN, light.ambient, light.courtyardBounce, light.courtyardNear);
  } else if (room == AW_CELLAR) {
    light.shaft = awShaftWeight(p, AW_S1, ${f(SKY_SHAFTS.court.lip)}, ${f(SKY_SHAFTS.court.reach)});
    // Sky extent contracts below the open first stair. The stone return
    // shares the same opening and falls to zero before the deep landing.
    if (light.shaft > 0.0) {
      float visible = light.shaft * awS1SolidAngle(p);
      light.aperture = visible * vec2(0.74*max(0.0, n.y), 0.10);
    }
    float second = awShaftWeight(p, AW_S2, ${f(SKY_SHAFTS.chapel.lip)}, ${f(SKY_SHAFTS.chapel.reach)});
    if (second > 0.001) {
      vec3 mouth = vec3(clamp(p.x, AW_S2.x+0.15, AW_S2.z-0.15), 0.55, clamp(p.z, AW_S2.y+0.15, AW_S2.w-0.15));
      vec2 chapelSky = awRoomDiffuse(mouth, vec3(0.0, 1.0, 0.0), AW_CHAPEL);
      light.aperture.y += second * (chapelSky.x + chapelSky.y) * 0.26;
    }
  } else {
    light.aperture = awRoomDiffuse(p + geometricN*0.025, n, room);
    if (room == AW_CHAPEL) {
      float skyLuminance = dot(uAwSkyIrradiance, vec3(0.2126, 0.7152, 0.0722));
      float daylight = smoothstep(${f(CHAPEL_DAYLIGHT_RANGE[0])}, ${f(CHAPEL_DAYLIGHT_RANGE[1])}, skyLuminance);
      // Aperture.x still feeds rough reflections. Only this additive
      // diffuse term changes, and only on daylit chapel surface receivers.
      if (daylight > 0.0) light.aperture.y += daylight * awChapelSurfaceDaylight(p, n, geometricN);
    }
  }
  return light;
}

float awSpecularOpening(vec3 p, vec3 dir, float roughness, int room, AwReceiverLight light) {
  if (room == AW_OUTSIDE) return 1.0 - 0.48*light.courtyardNear;
  if (room == AW_CELLAR && light.shaft <= 0.0) return 0.0;
  float ray = room == AW_CELLAR ? awS1Ray(p, dir) : awRoomRay(p, dir, room);
  float spread = roughness * roughness;
  // A broad lobe can see part of an opening that the ideal mirror misses.
  // Use the visible aperture's directional flux, with no ground or room floor.
  return mix(ray, light.aperture.x * 0.62, spread);
}
`;
