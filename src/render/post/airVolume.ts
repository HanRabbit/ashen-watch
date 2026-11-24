import { AREAS, B1_CEILINGS, B1_FOUNDATION_BACKING, CHAPEL_SLABS, DECK_SLABS, DOORS, RAISED_Y, WALLS, type Box, type Rect } from '../../sim/level';
import chapelSkyData from '../baked/chapel-sky.r8?url&inline';
import { GATEHOUSE_LIGHTS } from '../gatehouseWindows';
import { CHAPEL_APERTURES, GATEHOUSE_APERTURES, SKY_RECEIVER_PLAN, SKY_SHAFTS } from '../probeLighting';

// Built-in surface fog starts here; the landscape's separate aerial perspective starts at 53 m.
// These are adjacent ray segments, not two estimates of the same optical column.
export const WEATHER_REACH = 52;
export const WEATHER_BASE = 0.1;
export const DAMP_FALLOFF = 0.92;
const FREE_FALLOFF = 0.105;
const GRADE_Y = -0.12;
const DEEP_Y = -0.55;

// Shelter bounds are not geometry. Render Z is minus simulation Z.
const room = (a: Rect, top: number) => [
  `vec3(${[a.x0, GRADE_Y, -a.z1].map((n) => n.toFixed(2)).join(', ')})`,
  `vec3(${[a.x1, top, -a.z0].map((n) => n.toFixed(2)).join(', ')})`,
] as const;
const gatehouse = room(AREAS.gatehouse, 3.9);
const chapel = room(AREAS.chapel, 11.0);
const vec3 = (x: number, y: number, z: number) => `vec3(${[x,y,z].map(n => n.toFixed(4)).join(', ')})`;
const vec2 = (a: number, b: number) => `vec2(${a.toFixed(4)}, ${b.toFixed(4)})`;
const footprint = (r: Rect) => `${vec2(r.x0, -r.z1)}, ${vec2(r.x1, -r.z0)}`;
const bounds = (w: Box) => `${vec3(w.x0, w.y0 ?? 0, -w.z1)}, ${vec3(w.x1, w.h, -w.z0)}`;
const cells = WALLS.filter(w => w.tag === 'cellar' || w.tag === 'passage' || w.tag === 'store');
const gateSides = WALLS.filter(w => w.tag === 'gh' && w.z1 > -8);
const chapelWalls = WALLS.filter(w => w.y0 === undefined && w.x0 >= 13 && w.h === 7);
const chapelInterior = [
  ...WALLS.filter(w => w.x0 === 17.5 && w.x1 === 17.9).map(w => ({ ...w, y0: RAISED_Y })),
  ...DECK_SLABS.filter(w => w.x0 >= 13),
];
export const CHAPEL_AIR_BAFFLES = [
  ...chapelInterior,
  ...WALLS.filter(w => w.tag === 'holeGuard' && w.x0 >= 13),
];
const chapelDoor = DOORS.chapelFront.box;
const [frontPane, rearPane] = GATEHOUSE_LIGHTS;
const {court: courtShaft, chapel: chapelShaft} = SKY_SHAFTS;
const gateReceiver = SKY_RECEIVER_PLAN.gatehouse;
// The slab pieces ring S2. Use their whole envelope for *outside-weather*
// classification: the S2 cut opens into the chapel, not straight to the sky.
const chapelSlabEnvelope: Rect = {
  x0: Math.min(...CHAPEL_SLABS.map(s => s.x0)), z0: Math.min(...CHAPEL_SLABS.map(s => s.z0)),
  x1: Math.max(...CHAPEL_SLABS.map(s => s.x1)), z1: Math.max(...CHAPEL_SLABS.map(s => s.z1)),
};
const boxTests = (walls: readonly Box[]) => walls
  .map(w => `awBoxLeg(a, inv, ${bounds(w)})`).join(' ||\n      ');
const airAperture = (w: typeof GATEHOUSE_APERTURES[number]) => {
  const alongX = w.axis === 'x';
  const door = w.door === 'gatehouse' ? 1 : w.door === 'chapelFront' ? 2 : 0;
  return `AwAirAperture(${vec3(alongX ? w.plane : w.lateral, w.bottom, -(alongX ? w.lateral : w.plane))}, ` +
    `${vec2(alongX ? w.side : 0, alongX ? 0 : -w.side)}, ${vec3(w.width * .5, w.spring, w.height)}, ${w.transmission.toFixed(4)}, ${door})`;
};
const airApertures = (list: typeof GATEHOUSE_APERTURES) => list.map(airAperture).join(',\n  ');

// Four wall groups, indexed by the first jamb plane a light leg reaches. The
// repeat is keyed by authored lateral centre, not by a guessed regular spacing.
export const CHAPEL_AIR_WALL_GROUPS = ([['x', -1], ['x', 1], ['z', -1], ['z', 1]] as const).map(([axis, side]) =>
  CHAPEL_APERTURES.flatMap((a, i) => a.axis === axis && a.side === side && a.bottom > 7 ? [i] : [])
    .sort((a,b) => CHAPEL_APERTURES[a].lateral-CHAPEL_APERTURES[b].lateral));
const chapelNearest = (indices: number[]): string => {
  if (indices.length === 1) return `${indices[0]}`;
  const m = indices.length >> 1;
  const a = CHAPEL_APERTURES[indices[m-1]], b = CHAPEL_APERTURES[indices[m]];
  const split = (a.lateral+a.width*.5 + b.lateral-b.width*.5) / 2;
  return `(along < ${split.toFixed(4)} ? ${chapelNearest(indices.slice(0,m))} : ${chapelNearest(indices.slice(m))})`;
};
const west = CHAPEL_APERTURES[CHAPEL_AIR_WALL_GROUPS[0][0]].plane;
const east = CHAPEL_APERTURES[CHAPEL_AIR_WALL_GROUPS[1][0]].plane;
const south = CHAPEL_APERTURES[CHAPEL_AIR_WALL_GROUPS[2][0]].plane;
const north = CHAPEL_APERTURES[CHAPEL_AIR_WALL_GROUPS[3][0]].plane;
export const CHAPEL_REVEAL = .25; // glazedWall's 0.50 m stone extrusion, not the glazing seat
export const CHAPEL_AIR_GRID = {
  lo: [west+CHAPEL_REVEAL, RAISED_Y, -north+CHAPEL_REVEAL],
  hi: [east-CHAPEL_REVEAL, 16.2, -south-CHAPEL_REVEAL],
  size: [49, 45, 33], // approximately 35 cm; x is contiguous
  // Sqrt encoding keeps the dim nave values well above 8-bit quantisation.
  maxSky: .25,
} as const;
export const CHAPEL_AIR_EXTINCTION = .014;
// Artistic exposure of the revealed local sources; neither is a minimum
// light level. The cloudy sky keeps the gaps dark, the key picks out shafts.
export const CHAPEL_SKY_GAIN = 5.0;
export const CHAPEL_KEY_GAIN = 5.2;
export const CHAPEL_BEAM_NODES = [.18343464,.52553241,.79666648,.96028986] as const;
export const CHAPEL_BEAM_WEIGHTS = [.36268378,.31370665,.22238103,.10122854] as const;
export const CHAPEL_BEAM_SPLIT = [1.45,2.75] as const;

// Import the offline bake exactly like the court irradiance bake. The game
// decodes 72,765 bytes; the pane quadrature never runs on the main thread.
export function loadChapelSkyField(): Uint8Array<ArrayBuffer> {
  const bytes = atob(chapelSkyData.slice(chapelSkyData.indexOf(',')+1));
  if (bytes.length !== CHAPEL_AIR_GRID.size.reduce<number>((a,b) => a*b,1)) throw new Error('Invalid chapel sky field');
  const data = new Uint8Array(bytes.length);
  for (let i=0; i<data.length; ++i) data[i] = bytes.charCodeAt(i);
  return data;
}

// Shared by opaque-depth weather and the inexpensive per-surface fallback. Height is
// bounded at the datum, so subterranean rays never turn into denser and denser weather.
export const HEIGHT_COLUMN_GLSL = /* glsl */`
const vec2 AW_FALLOFF = vec2(${DAMP_FALLOFF}, ${FREE_FALLOFF});
const float AW_WEATHER_REACH = ${WEATHER_REACH.toFixed(1)};
const float AW_GRADE_Y = ${GRADE_Y};
const float AW_DEEP_Y = ${DEEP_Y};
vec2 awHeightColumn(vec3 origin, vec3 ray, vec2 interval, vec2 falloff, float base) {
  float distance = max(0.0, interval.y - interval.x);
  float a = origin.y + ray.y * interval.x - base;
  float b = origin.y + ray.y * interval.y - base;
  float span = abs(a - b);
  float h0 = min(a, b), h1 = max(a, b);
  if (h1 <= 0.0) return vec2(distance);
  if (span < 1e-4) return distance * exp(-falloff * max(0.0, (a + b) * 0.5));
  float height = h1 - max(h0, 0.0);
  float above = distance * height / span;
  vec2 q = falloff * height;
  vec2 average = mix(1.0 - q * 0.5, (1.0 - exp(-q)) / max(q, vec2(1e-4)), step(0.01, q));
  return distance - above + above * exp(-falloff * max(h0, 0.0)) * average;
}
float awRoomInset(vec3 p, vec3 lo, vec3 hi) {
  vec3 d = min(p - lo, hi - p);
  return min(d.x, min(d.y, d.z));
}
float awAirShelter(vec3 p) {
  float belowGrade = 1.0 - smoothstep(AW_DEEP_Y, AW_GRADE_Y, p.y);
  float gatehouse = smoothstep(0.0, 0.32, awRoomInset(p, ${gatehouse[0]}, ${gatehouse[1]}));
  float chapel = smoothstep(0.0, 0.40, awRoomInset(p, ${chapel[0]}, ${chapel[1]}));
  return max(0.98 * belowGrade, max(0.91 * gatehouse, 0.84 * chapel));
}
// Keep the close silhouette and wet surface contrast while the middle distance separates.
float awNearWeather(float distance) {
  return mix(0.38, 1.0, smoothstep(0.75, 6.0, distance));
}
`;

/** Source visibility in render-world metres. Shared by full-resolution fallback
 * and shadow integration. Extinction and incident radiance are independent. */
export const AIR_SOURCE_GLSL = /* glsl */`
uniform vec2 uAirDoors; // gatehouse, chapel front; closed until a live door state is supplied
float awFootprintInset(vec2 p, vec2 lo, vec2 hi) {
  vec2 d = min(p - lo, hi - p);
  return min(d.x, d.y);
}
float awShaftSill(vec3 p, vec2 lo, vec2 hi) {
  float t = (p.x-lo.x)/(hi.x-lo.x);
  return mix(0.0, -3.0, clamp(t, 0.0, 1.0));
}
float awCourtShaftSky(vec3 p, vec2 lo, vec2 hi) {
  // Only the air over the descending treads has a direct view of the outdoor mouth.
  // The other stair opens inside the chapel and cannot see the courtyard sky.
  float inset = awFootprintInset(p.xz, lo, hi);
  if (inset <= 0.0) return 0.0;
  float overTread = smoothstep(0.05, 0.30, p.y - awShaftSill(p, lo, hi));
  float depth = smoothstep(-${courtShaft.reach.toFixed(2)}, -0.22, p.y);
  return smoothstep(0.0, 0.34, inset) * overTread * depth / (1.0 + 1.8*p.y*p.y);
}
float awGateRoom(vec3 p) {
  float plan = awFootprintInset(p.xz, ${footprint(gateReceiver)});
  float roof = 5.45 - 0.51 * abs(p.x);
  return smoothstep(-0.05, 0.15, plan) * (1.0-smoothstep(roof-0.20, roof, p.y));
}
const vec3 AW_CHAPEL_LO = ${vec3(...CHAPEL_AIR_GRID.lo)};
const vec3 AW_CHAPEL_HI = ${vec3(...CHAPEL_AIR_GRID.hi)};
float awChapelRoofHeight(vec3 p) {
  return max(16.2 - (5.6/5.8)*abs(p.z+16.5), p.z > -16.5 ? 14.685 - (3.8/2.9)*abs(p.x-18.) : 0.);
}
// This weight feathers only the added chapel medium. It is not a classifier
// for access to outside weather, even when the weight is exactly zero.
float awChapelMediumWeight(vec3 p) {
  float inset = min(awChapelRoofHeight(p)-p.y,awRoomInset(p,AW_CHAPEL_LO,AW_CHAPEL_HI));
  return smoothstep(0.,.18,inset);
}
const float AW_CHAPEL_FLOOR = ${RAISED_Y.toFixed(2)};
bool awChapelUnderFloor(vec3 p) {
  if (p.y >= AW_CHAPEL_FLOOR) return false;
  return awFootprintInset(p.xz, ${footprint(chapelSlabEnvelope)}) >= 0.0 ||
    (p.y < ${CHAPEL_SLABS[0].y0!.toFixed(2)} && awFootprintInset(p.xz, ${footprint(SKY_RECEIVER_PLAN.store)}) >= 0.0);
}
bool awChapelWeatherRoom(vec3 p) {
  // Mid-wall footprint, independent of the glass-field bounds and feather.
  return awFootprintInset(p.xz, ${footprint(SKY_RECEIVER_PLAN.chapel)}) >= 0.0 && p.y < awChapelRoofHeight(p);
}
struct AwAirAperture {
  vec3 sill;
  vec2 outward;
  vec3 shape; // half width, spring, height
  float transmission;
  int door;
};
const AwAirAperture AW_AIR_GATE[${GATEHOUSE_APERTURES.length}] = AwAirAperture[${GATEHOUSE_APERTURES.length}](
  ${airApertures(GATEHOUSE_APERTURES)}
);
const AwAirAperture AW_AIR_CHAPEL[${CHAPEL_APERTURES.length}] = AwAirAperture[${CHAPEL_APERTURES.length}](
  ${airApertures(CHAPEL_APERTURES)}
);
vec3 awInverseSegment(vec3 d) {
  return mix(vec3(-1.0), vec3(1.0), step(0.0, d)) / max(abs(d), vec3(1e-6));
}
bool awBoxLeg(vec3 a, vec3 inv, vec3 lo, vec3 hi) {
  vec3 p = (lo-a)*inv, q = (hi-a)*inv;
  vec3 entry = min(p,q), exit = max(p,q);
  return max(0.002, max(entry.x,max(entry.y,entry.z))) < min(0.998,min(exit.x,min(exit.y,exit.z)));
}
bool awAirChapelBlocked(vec3 a, vec3 b) {
  vec3 inv = awInverseSegment(b-a);
  return ${boxTests(CHAPEL_AIR_BAFFLES)};
}
float awAirThroughput(AwAirAperture a) {
  float opening = a.door == 1 ? uAirDoors.x : (a.door == 2 ? uAirDoors.y : 1.0);
  return a.transmission * smoothstep(0.03, 0.95, opening);
}
float awAirFrameEdge(AwAirAperture a, vec3 p) {
  vec3 d = p-a.sill;
  float lateral = abs(dot(d.xz,a.outward.yx));
  float t = sqrt(max(0.0,1.0-lateral/a.shape.x));
  float head = mix(a.shape.y,a.shape.z,t*(1.44-0.44*t));
  return min(a.shape.x-lateral,min(d.y,head-d.y));
}
float awAirFrame(AwAirAperture a, vec3 p) {
  return smoothstep(0.0,0.04,awAirFrameEdge(a,p));
}
// X, Y in the returned pair are glazed and non-glazed key access respectively.
// Route to the first inner lip; a later plane cannot be another route through
// the same room's solid corner. Only one arch + one interior leg per sample.
int awChapelGlassIndex(int wall, float along) {
  if (wall == 0) return ${chapelNearest(CHAPEL_AIR_WALL_GROUPS[0])};
  if (wall == 1) return ${chapelNearest(CHAPEL_AIR_WALL_GROUPS[1])};
  if (wall == 2) return ${chapelNearest(CHAPEL_AIR_WALL_GROUPS[2])};
  return ${chapelNearest(CHAPEL_AIR_WALL_GROUPS[3])};
}
vec2 awChapelKeySources(vec3 p, vec3 dir) {
  // The first-inner-lip routing assumes the receiver is on the nave side.
  if (dir.y <= .001 || awFootprintInset(p.xz,AW_CHAPEL_LO.xz,AW_CHAPEL_HI.xz) < 0.0) return vec2(0.);
  vec2 s = vec2(dir.x < 0. ? AW_CHAPEL_LO.x : AW_CHAPEL_HI.x,
                dir.z > 0. ? AW_CHAPEL_HI.z : AW_CHAPEL_LO.z);
  vec2 t = abs(s-p.xz)/max(abs(dir.xz),vec2(1e-6));
  bool xWall = t.x<t.y;
  int wall = xWall ? (dir.x<0. ? 0 : 1) : (dir.z>0. ? 2 : 3);
  float incidence = abs(xWall ? dir.x : dir.z);
  if (incidence <= .025) return vec2(0.);
  vec3 leg = dir/incidence;
  vec3 inner = p + dir*min(t.x,t.y);
  vec3 centre = inner+leg*${CHAPEL_REVEAL.toFixed(2)};
  vec3 outer = centre+leg*${CHAPEL_REVEAL.toFixed(2)};
  if (centre.y >= AW_CHAPEL_HI.y) return vec2(0.);
  bool glazed = wall != 0 || centre.y >= 7.;
  int idx = glazed ? awChapelGlassIndex(wall,xWall ? -centre.z : centre.x) : (centre.y<4. ? 0 : 1);
  AwAirAperture a=AW_AIR_CHAPEL[idx];
  float frame = min(awAirFrameEdge(a,inner),awAirFrameEdge(a,outer));
  if (frame <= 0. || awAirChapelBlocked(p,outer)) return vec2(0.);
  float through = awAirThroughput(a)*smoothstep(0.,glazed ? .12 : .04,frame);
  return glazed ? vec2(through,0.) : vec2(0.,through);
}
#ifdef AW_CHAPEL_FIELD
uniform highp sampler3D tChapelSky;
float awChapelSky(vec3 p) {
  const vec3 dims = ${vec3(...CHAPEL_AIR_GRID.size)};
  vec3 uv = (p-AW_CHAPEL_LO)/(AW_CHAPEL_HI-AW_CHAPEL_LO);
  float code = texture(tChapelSky,(uv*(dims-1.)+.5)/dims).r;
  return code*code*${CHAPEL_AIR_GRID.maxSky.toFixed(2)};
}
#endif
float awApertureFlux(AwAirAperture a, vec3 p, bool chapel) {
  float through = awAirThroughput(a);
  if (through <= 0.0) return 0.0;
  float recess = dot(a.sill.xz-p.xz,a.outward);
  if (recess <= 0.0) return 0.0;
  vec3 center = a.sill + vec3(0.0,0.48*a.shape.z,0.0);
  vec3 leg = center-p;
  float distance2 = dot(leg,leg);
  float facing = recess*inversesqrt(max(distance2,1e-5));
  if (facing <= 0.12) return 0.0;
  // Trace past both lips so a grazing receiver behind a jamb cannot see the sky.
  vec3 lip = leg * (0.23/recess);
  float reveal = awAirFrame(a,center+lip)*awAirFrame(a,center-min(1.0,0.23/recess)*leg);
  if (reveal <= 0.0 || (chapel && awAirChapelBlocked(p,center))) return 0.0;
  // Projected solid angle. Air does not have a surface normal.
  float area = 1.65*a.shape.x*a.shape.z;
  return through*reveal*smoothstep(0.12,0.88,facing)*area/(3.141593*distance2+area);
}
float awGateDiffuse(vec3 p) {
  float sky = 0.0;
  for (int i=0; i<${GATEHOUSE_APERTURES.length}; ++i) sky += awApertureFlux(AW_AIR_GATE[i],p,false);
  return min(sky,1.0);
}
float awChapelDiffuse(vec3 p) {
  // Preserve live access at the door and bridge in the ordinary weather layer;
  // neither participates as a glowing source in the new glass scattering.
  float sky = awApertureFlux(AW_AIR_CHAPEL[0],p,true)+awApertureFlux(AW_AIR_CHAPEL[1],p,true);
  #ifdef AW_CHAPEL_FIELD
    sky += awChapelSky(p);
  #else
    // The low-confidence/weather-only fallback needs no additional texture.
    sky += awApertureFlux(AW_AIR_CHAPEL[awChapelGlassIndex(0,-p.z)],p,true);
    sky += awApertureFlux(AW_AIR_CHAPEL[awChapelGlassIndex(1,-p.z)],p,true);
    sky += awApertureFlux(AW_AIR_CHAPEL[awChapelGlassIndex(2,p.x)],p,true);
    sky += awApertureFlux(AW_AIR_CHAPEL[awChapelGlassIndex(3,p.x)],p,true);
  #endif
  return min(sky,1.0);
}
float awSkyAccess(vec3 p) {
  if (p.y < 0.0) return awCourtShaftSky(p, ${footprint(courtShaft)});
  if (awChapelUnderFloor(p)) return 0.0;
  float gate = awGateRoom(p);
  if (gate > 0.0) return mix(1.0, awGateDiffuse(p), gate);
  if (awChapelWeatherRoom(p)) return awChapelDiffuse(p);
  return 1.0;
}
// Intersect the stair throat at grade AND inside the chute. This vetoes light
// leaking through floor meshes that do not contribute to the live key shadow map.
float awCourtShaftKey(vec3 p, vec3 toKey) {
  if (toKey.y <= 0.001) return 0.0;
  vec3 mouth = p - toKey * (p.y / toKey.y);
  float inside = min(awFootprintInset(p.xz, ${footprint(courtShaft)}),
                     awFootprintInset(mouth.xz, ${footprint(courtShaft)}));
  float tread = p.y - awShaftSill(p, ${footprint(courtShaft)});
  return smoothstep(0.0, 0.10, min(inside, tread)) * smoothstep(-${courtShaft.reach.toFixed(2)}, -0.22, p.y);
}
float awApertureKey(AwAirAperture a, vec3 p, vec3 dir) {
  float through = awAirThroughput(a);
  float incidence = dot(dir.xz,a.outward);
  if (through <= 0.0 || incidence <= 0.015) return 0.0;
  float t = dot(a.sill.xz-p.xz,a.outward)/incidence;
  float lip = 0.23/incidence;
  if (t+lip <= 0.0) return 0.0;
  vec3 q = p + dir*(t+lip);
  return through*awAirFrame(a,q)*awAirFrame(a,p+dir*max(0.0,t-lip));
}
float awKeyAccess(vec3 p, vec3 toKey) {
  if (p.y < 0.0) return awCourtShaftKey(p, toKey);
  if (awChapelUnderFloor(p)) return 0.0;
  float gate = awGateRoom(p);
  if (gate > 0.0) {
    float visible = 0.0;
    for (int i=0; i<${GATEHOUSE_APERTURES.length}; ++i) visible = max(visible,awApertureKey(AW_AIR_GATE[i],p,toKey));
    return mix(1.0,visible,gate);
  }
  if (awChapelWeatherRoom(p)) {
    vec2 sources = awChapelKeySources(p,toKey);
    return max(sources.x,sources.y);
  }
  return 1.0;
}
`;

// Use the same cutouts and effective glazing throughput as the surface transport.
// In the gatehouse the rough mouths and pinched glazing seat are not the same arch.
const gateScatterWindows = GATEHOUSE_LIGHTS.map((w, i) => {
  const aperture = GATEHOUSE_APERTURES[i+1];
  const face = { ...aperture, lateral: w.x, bottom: w.bottom+.026,
    width: w.width, spring: w.spring-.026, height: w.peak-.026 };
  const sillRise = aperture.bottom-w.bottom;
  const pane = { ...aperture, plane: w.z0+(w.z1-w.z0)*(w.hearth ? .34 : .66),
    spring: aperture.spring-sillRise, height: aperture.height-sillRise };
  return `AwScatterWindow(${airAperture(face)}, ${airAperture(pane)}, ${((w.z1-w.z0)*.5).toFixed(4)})`;
});

/** Local single scattering from the actual glazed gatehouse openings.
 * No baked screen sprite, generic ambient fill, or source at the open door/bridge. */
export const WINDOW_SCATTER_GLSL = /* glsl */`
uniform float uWindowScatter;
uniform vec3 uWindowIrradiance; // linear outdoor irradiance shared with surface receivers
const float AW_WINDOW_DUST = .038; // thin indoor air, per metre; not the sheltered weather layer
// Match the overcast-day luminance of the previous tuning (.803 / 1.306),
// without using the weather tint as radiance or renormalising the live sky.
const float AW_WINDOW_SKY_GAIN = .615;
const float AW_WINDOW_KEY_GAIN = .19; // overcast: the soft sky component dominates away from the sun corridor
struct AwScatterWindow {
  AwAirAperture mouth;
  AwAirAperture pane;
  float halfDepth;
};
const AwScatterWindow AW_SCATTER_GATE[${gateScatterWindows.length}] = AwScatterWindow[${gateScatterWindows.length}](
  ${gateScatterWindows.join(',\n  ')}
);
float awWindowDaylight(float hazeRigLuma) {
  // Keep the existing rig's dusk fade independent of source power. Both real
  // sky irradiance and the directional key can be nonzero during moonlight.
  return smoothstep(.075,.235,hazeRigLuma);
}
float awWindowFrame(AwAirAperture a, vec3 p, float feather) {
  return smoothstep(0.,feather,awAirFrameEdge(a,p));
}
float awWindowPath(AwScatterWindow w, vec3 p, vec3 dir, float recess) {
  float incidence=dot(dir.xz,w.mouth.outward);
  if(incidence <= .025) return 0.;
  vec3 perMetre=dir/incidence;
  vec3 centre=p+perMetre*recess;
  vec3 outer=centre+perMetre*w.halfDepth;
  float feather=.055;
  float frame=min(awWindowFrame(w.mouth,outer,feather),
                  awWindowFrame(w.mouth,centre-perMetre*w.halfDepth,feather));
  if(frame<=0.) return 0.;
  float seat=dot(w.pane.sill.xz-w.mouth.sill.xz,w.mouth.outward);
  return min(frame,min(awWindowFrame(w.pane,centre+perMetre*(seat-.027),feather),
                       awWindowFrame(w.pane,centre+perMetre*(seat+.027),feather)));
}
vec2 awWindowLight(AwScatterWindow w, vec3 p, vec3 toKey) {
  float recess=dot(w.mouth.sill.xz-p.xz,w.mouth.outward);
  float inside=recess-w.halfDepth;
  float reach=3.65;
  if(inside<=0. || inside>=reach) return vec2(0.);
  vec3 fromSill=p-w.pane.sill;
  if(abs(dot(fromSill.xz,w.mouth.outward.yx)) > w.pane.shape.x+reach ||
     abs(fromSill.y-.45*w.pane.shape.z) > w.pane.shape.z+reach) return vec2(0.);
  float local=smoothstep(0.,.16,inside)*(1.-smoothstep(reach*.48,reach,inside));
  float key=awWindowPath(w,p,toKey,recess);
  // Projected solid angle of the exposed glazing. Three distributed taps see
  // a cloudy sky over a range of angles, not a cone aimed at the pane centre.
  float sky=0.;
  float area=1.65*w.pane.shape.x*w.pane.shape.z;
  for(int i=0;i<3;++i){
    float side=float(i-1);
    vec2 offset=w.pane.outward.yx*(side*.48*w.pane.shape.x);
    vec3 q=w.pane.sill+vec3(offset.x,(i==1 ? .44 : (i==0 ? .61 : .28))*w.pane.shape.z,offset.y);
    vec3 leg=q-p;
    float d2=dot(leg,leg);
    vec3 dir=leg*inversesqrt(max(d2,1e-5));
    float projected=max(0.,dot(dir.xz,w.pane.outward));
    // Lower rays run into the yard/roof rather than the sky hemisphere.
    float openSky=smoothstep(-.24,.14,dir.y);
    sky+=awWindowPath(w,p,dir,recess)*openSky*projected*area/(3.141593*d2+area);
  }
  return w.pane.transmission*local*vec2(sky/3.,key);
}
vec2 awWindowTransport(vec3 p, vec3 toKey) {
  vec2 light=vec2(0.);
  if(p.y>.02 && p.y<3.5) {
    float room=awGateRoom(p);
    if(room>0.) for(int i=0;i<${gateScatterWindows.length};++i)
      light+=room*awWindowLight(AW_SCATTER_GATE[i],p,toKey);
  }
  return min(light,vec2(1.));
}
vec2 awWindowInterval(vec3 origin, vec3 inv, vec3 lo, vec3 hi) {
  vec3 a=(lo-origin)*inv,b=(hi-origin)*inv;
  vec3 entry=min(a,b),exit=max(a,b);
  return vec2(max(0.,max(entry.x,max(entry.y,entry.z))),min(exit.x,min(exit.y,exit.z)));
}
`;

/** Key-only geometry for the bounded camera integral. Project the whole view
 * ray to both reveal lips once per facing wall; never find windows per tap. */
export const CHAPEL_BEAM_GLSL = /* glsl */`
const int AW_BEAM_ORDER[${CHAPEL_AIR_WALL_GROUPS.flat().length}] = int[${CHAPEL_AIR_WALL_GROUPS.flat().length}](${CHAPEL_AIR_WALL_GROUPS.flat().join(',')});
const ivec4 AW_BEAM_END = ivec4(${CHAPEL_AIR_WALL_GROUPS.map((_,i) => CHAPEL_AIR_WALL_GROUPS.slice(0,i+1).flat().length).join(',')});
struct AwBeamLine {
  vec2 inner, outer, slope; // (lateral centre coordinate, height) on the two lips
  vec2 interval;
  float t0, dt; // distance to the inner lip from any camera-ray t
};
vec2 awBeamClip(vec2 t, float p, float d, vec2 limits) {
  if(abs(d)<1e-5) return (p>=limits.x && p<=limits.y) ? t : vec2(1.,0.);
  vec2 ends=(limits-p)/d;
  return vec2(max(t.x,min(ends.x,ends.y)),min(t.y,max(ends.x,ends.y)));
}
AwBeamLine awBeamLine(vec3 origin, vec3 ray, vec2 interval, vec3 key, bool xWall) {
  float component=xWall ? key.x : key.z;
  float wall=xWall ? (component<0. ? AW_CHAPEL_LO.x : AW_CHAPEL_HI.x)
                   : (component<0. ? AW_CHAPEL_LO.z : AW_CHAPEL_HI.z);
  float t0=(wall-(xWall ? origin.x : origin.z))/component;
  float dt=-(xWall ? ray.x : ray.z)/component;
  vec2 projected=vec2(xWall ? -key.z : key.x,key.y);
  vec2 inner=vec2(xWall ? -origin.z : origin.x,origin.y)+projected*t0;
  vec2 outer=inner+projected*(${(2*CHAPEL_REVEAL).toFixed(2)}/abs(component));
  vec2 slope=vec2(xWall ? -ray.z : ray.x,ray.y)+projected*dt;
  // Reject rays that reach another wall before this one (including corner
  // strips where the jamb lip meets the lower stone shell).
  vec2 lateral=xWall ? vec2(-AW_CHAPEL_HI.z,-AW_CHAPEL_LO.z) : vec2(AW_CHAPEL_LO.x,AW_CHAPEL_HI.x);
  interval=awBeamClip(interval,inner.x,slope.x,lateral);
  return AwBeamLine(inner,outer,slope,interval,t0,dt);
}
vec2 awBeamSpan(AwBeamLine line, AwAirAperture a, float lateral) {
  vec2 width=lateral+vec2(-1.,1.)*a.shape.x;
  vec2 height=a.sill.y+vec2(0.,a.shape.z);
  vec2 t=awBeamClip(line.interval,line.inner.x,line.slope.x,width);
  t=awBeamClip(t,line.outer.x,line.slope.x,width);
  t=awBeamClip(t,line.inner.y,line.slope.y,height);
  return awBeamClip(t,line.outer.y,line.slope.y,height);
}
float awBeamArch(vec2 frame, vec3 shape) {
  float u=abs(frame.x), root=sqrt(max(0.,1.-u/shape.x));
  float head=mix(shape.y,shape.z,root*(1.44-.44*root));
  return min(shape.x-u,min(frame.y,head-frame.y));
}
float awBeamReveal(AwBeamLine line, AwAirAperture a, float t, float lateral) {
  vec2 fromSill=line.slope*t-vec2(lateral,a.sill.y);
  return smoothstep(0.,.12,min(awBeamArch(line.inner+fromSill,a.shape),awBeamArch(line.outer+fromSill,a.shape)));
}
`;

/** Conservative opaque envelopes for the light leg. Closed leaves seal the
 * aperture here; live camera depth also sees the moving leaf. */
export const AIR_OCCLUSION_GLSL = /* glsl */`
bool awGateEndLeg(vec3 a, vec3 delta, vec3 inv, vec2 depth, AwAirAperture pane, bool front) {
  if (!awBoxLeg(a, inv, vec3(front ? -10.5 : -3.5, 0.0, depth.x),
      vec3(front ? 10.5 : 3.5, front ? 4.2 : 3.6, depth.y))) return true;
  float t0 = clamp((depth.x-a.z)*inv.z, 0.0, 1.0);
  float t1 = clamp((depth.y-a.z)*inv.z, 0.0, 1.0);
  vec3 p = a + delta*t0, q = a + delta*t1;
  if (min(awAirFrame(pane,p),awAirFrame(pane,q)) > 0.0) return true;
  return front && uAirDoors.x > 0.55 && min(awAirFrame(AW_AIR_GATE[0],p),awAirFrame(AW_AIR_GATE[0],q)) > 0.0;
}
float awLightLeg(vec3 a, vec3 b) {
  vec3 d = b - a, inv = awInverseSegment(d);
  // Grade is a solid barrier except at the two actual slab cuts.
  if ((a.y < 0.0) != (b.y < 0.0)) {
    vec2 p = (a + d * (-a.y * inv.y)).xz;
    if (max(awFootprintInset(p, ${footprint(courtShaft)}), awFootprintInset(p, ${footprint(chapelShaft)})) <= 0.0) return 0.0;
  }
  if (min(a.y,b.y) < ${RAISED_Y.toFixed(2)} && max(a.x,b.x) > 2.0 && min(a.z,b.z) < -6.0) {
    if (${boxTests([...cells, ...B1_CEILINGS, ...B1_FOUNDATION_BACKING])}) return 0.0;
  }
  if (max(a.x,b.x) > 12.95 && min(a.z,b.z) < -10.45 && max(a.z,b.z) > -22.55) {
    if (${boxTests([...chapelWalls, ...chapelInterior])}) return 0.0;
    if (min(a.y,b.y) < ${RAISED_Y.toFixed(2)} && max(a.y,b.y) > 0.15) {
      if (${boxTests(CHAPEL_SLABS)}) return 0.0;
    }
    if (uAirDoors.y <= 0.55 && awBoxLeg(a, inv, ${bounds(chapelDoor)})) return 0.0;
  }
  if (min(a.y,b.y) < 4.2 && max(a.z,b.z) > -0.50 && min(a.z,b.z) < 8.51) {
    if (${boxTests(gateSides)}) return 0.0;
    if (!awGateEndLeg(a,d,inv,${vec2(-frontPane.z1,-frontPane.z0)},AW_AIR_GATE[1],true)) return 0.0;
    if (!awGateEndLeg(a,d,inv,${vec2(-rearPane.z1,-rearPane.z0)},AW_AIR_GATE[2],false)) return 0.0;
  }
  return 1.0;
}
`;

export const AIR_VOLUME_GLSL = /* glsl */`
${HEIGHT_COLUMN_GLSL}
${AIR_SOURCE_GLSL}
float awDampPatch(vec3 p, float time) {
  // Two oblique scales break up the wet ground layer. The broad upper haze does not follow it.
  return 0.79 + 0.23 * sin(dot(p.xz, vec2(0.42, 0.21)) - time * 0.07)
              + 0.20 * sin(dot(p.xz, vec2(-0.16, 0.49)) + time * 0.043);
}
vec3 awAtmosphere(vec3 c, vec3 origin, vec3 ray, float rayEnd, bool isSky, out float transmission) {
  float end = min(rayEnd, AW_WEATHER_REACH);
  float horizon = isSky ? 0.68 * (1.0 - smoothstep(0.035, 0.32, ray.y)) : 1.0;
  transmission = 1.0;
  if (horizon < 0.001) return c;
  vec3 radiance = vec3(0.0);
  float near = 0.0;
  // Low-confidence reconstruction at silhouettes. Use the full-res ray and
  // integrate source access per segment, since sky can be visible down a shaft.
  const int steps = 8;
  for (int i=0; i<steps; ++i) {
    float t = float(i+1)/float(steps);
    float far = min(end, AW_WEATHER_REACH*t*(.26+.74*t));
    float mid = 0.5*(near+far);
    vec3 p = origin + ray*mid;
    float shelter = awAirShelter(p);
    vec2 density = max(uFog.xy, vec2(0.0)) * exp(-AW_FALLOFF*max(0.0,p.y-uFog.z));
    density *= vec2(awDampPatch(p,uAirTime), 1.0) * (1.0-vec2(.985,.965)*shelter);
    float total = density.x+density.y;
    float opacity = 1.0-exp(-total*(far-near)*awNearWeather(mid)*horizon);
    vec3 source = mix(uGroundAir, uAirColor, density.y/max(1e-5,total)) * awSkyAccess(p);
    radiance += transmission*opacity*source;
    transmission *= 1.0-opacity;
    if (far >= end) break;
    near = far;
  }
  return c*transmission+radiance;
}
`;
