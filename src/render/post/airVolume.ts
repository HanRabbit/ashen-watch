import { AREAS, B1_CEILINGS, B1_FOUNDATION_BACKING, CHAPEL_SLABS, DECK_SLABS, DOORS, RAISED_Y, WALLS, type Box, type Rect } from '../../sim/level';
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
const chapelDoor = DOORS.chapelFront.box;
const [frontPane, rearPane] = GATEHOUSE_LIGHTS;
const {court: courtShaft, chapel: chapelShaft} = SKY_SHAFTS;
const gateReceiver = SKY_RECEIVER_PLAN.gatehouse, chapelReceiver = SKY_RECEIVER_PLAN.chapel;
const boxTests = (walls: readonly Box[]) => walls
  .map(w => `awBoxLeg(a, inv, ${bounds(w)})`).join(' ||\n      ');
const airAperture = (w: typeof GATEHOUSE_APERTURES[number]) => {
  const alongX = w.axis === 'x';
  const door = w.door === 'gatehouse' ? 1 : w.door === 'chapelFront' ? 2 : 0;
  return `AwAirAperture(${vec3(alongX ? w.plane : w.lateral, w.bottom, -(alongX ? w.lateral : w.plane))}, ` +
    `${vec2(alongX ? w.side : 0, alongX ? 0 : -w.side)}, ${vec3(w.width * .5, w.spring, w.height)}, ${w.transmission.toFixed(4)}, ${door})`;
};
const airApertures = (list: typeof GATEHOUSE_APERTURES) => list.map(airAperture).join(',\n  ');

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
float awChapelRoom(vec3 p) {
  float plan = awFootprintInset(p.xz, ${footprint(chapelReceiver)});
  float roof = max(7.0,16.1 - 0.86 * abs(p.z+16.5));
  return smoothstep(-0.06, 0.20, plan) * (1.0-smoothstep(roof-0.30, roof, p.y));
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
  return ${boxTests(chapelInterior)};
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
  float sky = 0.0;
  for (int i=0; i<${CHAPEL_APERTURES.length}; ++i) sky += awApertureFlux(AW_AIR_CHAPEL[i],p,true);
  return min(sky,1.0);
}
float awSkyAccess(vec3 p) {
  if (p.y < 0.0) return awCourtShaftSky(p, ${footprint(courtShaft)});
  float gate = awGateRoom(p);
  if (gate > 0.0) return mix(1.0, awGateDiffuse(p), gate);
  float chapel = awChapelRoom(p);
  if (chapel > 0.0) return mix(1.0, awChapelDiffuse(p), chapel);
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
float awApertureKey(AwAirAperture a, vec3 p, vec3 dir, bool chapel) {
  float through = awAirThroughput(a);
  float incidence = dot(dir.xz,a.outward);
  if (through <= 0.0 || incidence <= 0.015) return 0.0;
  float t = dot(a.sill.xz-p.xz,a.outward)/incidence;
  float lip = 0.23/incidence;
  if (t+lip <= 0.0) return 0.0;
  vec3 q = p + dir*(t+lip);
  if (chapel && awAirChapelBlocked(p,q)) return 0.0;
  return through*awAirFrame(a,q)*awAirFrame(a,p+dir*max(0.0,t-lip));
}
float awKeyAccess(vec3 p, vec3 toKey) {
  if (p.y < 0.0) return awCourtShaftKey(p, toKey);
  float gate = awGateRoom(p);
  if (gate > 0.0) {
    float visible = 0.0;
    for (int i=0; i<${GATEHOUSE_APERTURES.length}; ++i) visible = max(visible,awApertureKey(AW_AIR_GATE[i],p,toKey,false));
    return mix(1.0,visible,gate);
  }
  float chapel = awChapelRoom(p);
  if (chapel > 0.0) {
    float visible = 0.0;
    for (int i=0; i<${CHAPEL_APERTURES.length}; ++i) visible = max(visible,awApertureKey(AW_AIR_CHAPEL[i],p,toKey,true));
    return mix(1.0,visible,chapel);
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
const chapelScatterWindows = CHAPEL_APERTURES.filter(a => a.axis === 'x' && a.side === -1 && a.bottom > 7);

/** Local single scattering from the actual glazed gatehouse and west chapel openings.
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
const AwAirAperture AW_SCATTER_CHAPEL[${chapelScatterWindows.length}] = AwAirAperture[${chapelScatterWindows.length}](
  ${airApertures(chapelScatterWindows)}
);
float awWindowDaylight(float hazeRigLuma) {
  // Keep the existing rig's dusk fade independent of source power. Both real
  // sky irradiance and the directional key can be nonzero during moonlight.
  return smoothstep(.075,.235,hazeRigLuma);
}
float awWindowFrame(AwAirAperture a, vec3 p, float feather) {
  return smoothstep(0.,feather,awAirFrameEdge(a,p));
}
float awWindowPath(AwScatterWindow w, vec3 p, vec3 dir, float recess, bool chapel) {
  float incidence=dot(dir.xz,w.mouth.outward);
  if(incidence <= .025) return 0.;
  vec3 perMetre=dir/incidence;
  vec3 centre=p+perMetre*recess;
  vec3 outer=centre+perMetre*w.halfDepth;
  float feather=chapel ? .13 : .055;
  float frame=min(awWindowFrame(w.mouth,outer,feather),
                  awWindowFrame(w.mouth,centre-perMetre*w.halfDepth,feather));
  if(frame<=0.) return 0.;
  if(chapel) return awAirChapelBlocked(p,outer) ? 0. : frame;
  float seat=dot(w.pane.sill.xz-w.mouth.sill.xz,w.mouth.outward);
  return min(frame,min(awWindowFrame(w.pane,centre+perMetre*(seat-.027),feather),
                       awWindowFrame(w.pane,centre+perMetre*(seat+.027),feather)));
}
vec2 awWindowLight(AwScatterWindow w, vec3 p, vec3 toKey, bool chapel) {
  float recess=dot(w.mouth.sill.xz-p.xz,w.mouth.outward);
  float inside=recess-w.halfDepth;
  float reach=chapel ? 8.5 : 3.65;
  if(inside<=0. || inside>=reach) return vec2(0.);
  vec3 fromSill=p-w.pane.sill;
  if(abs(dot(fromSill.xz,w.mouth.outward.yx)) > w.pane.shape.x+reach ||
     abs(fromSill.y-.45*w.pane.shape.z) > w.pane.shape.z+reach) return vec2(0.);
  float local=smoothstep(0.,.16,inside)*(1.-smoothstep(reach*.48,reach,inside));
  float key=awWindowPath(w,p,toKey,recess,chapel);
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
    sky+=awWindowPath(w,p,dir,recess,chapel)*openSky*projected*area/(3.141593*d2+area);
  }
  return w.pane.transmission*local*vec2(sky/3.,key);
}
vec2 awWindowTransport(vec3 p, vec3 toKey, bool gate, bool chapel) {
  vec2 light=vec2(0.);
  if(gate && p.y>.02 && p.y<3.5) {
    float room=awGateRoom(p);
    if(room>0.) for(int i=0;i<${gateScatterWindows.length};++i)
      light+=room*awWindowLight(AW_SCATTER_GATE[i],p,toKey,false);
  }
  if(chapel && p.y>0.45 && p.y<14.1 && p.x>13.50 && p.x<22.) {
    float room=awChapelRoom(p);
    if(room>0.) for(int i=0;i<${chapelScatterWindows.length};++i){
      AwAirAperture a=AW_SCATTER_CHAPEL[i];
      vec2 w=room*awWindowLight(AwScatterWindow(a,a,.25),p,toKey,true);
      light=vec2(light.x+w.x,max(light.y,w.y));
    }
  }
  return min(light,vec2(1.));
}
vec2 awWindowInterval(vec3 origin, vec3 inv, vec3 lo, vec3 hi) {
  vec3 a=(lo-origin)*inv,b=(hi-origin)*inv;
  vec3 entry=min(a,b),exit=max(a,b);
  return vec2(max(0.,max(entry.x,max(entry.y,entry.z))),min(exit.x,min(exit.y,exit.z)));
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
