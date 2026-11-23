import { AREAS, type Rect } from '../../sim/level';
import { GATEHOUSE_LIGHTS } from '../gatehouseWindows';

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
const pane = GATEHOUSE_LIGHTS[1]; // the exterior-facing pane, not the yard-side hearth pane
const windowMouth = [pane.x, pane.bottom + pane.peak * 0.48, -pane.z1]
  .map((v) => v.toFixed(3)).join(', ');

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

export const AIR_VOLUME_GLSL = /* glsl */`
${HEIGHT_COLUMN_GLSL}
vec2 awRoomInterval(vec3 origin, vec3 invRay, float end, vec3 lo, vec3 hi) {
  vec3 a = (lo - origin) * invRay, b = (hi - origin) * invRay;
  vec3 from = min(a, b), to = max(a, b);
  return vec2(max(0.0, max(from.x, max(from.y, from.z))), min(end, min(to.x, min(to.y, to.z))));
}
vec2 awRoomColumn(vec3 origin, vec3 ray, vec3 invRay, float end, float base, vec3 lo, vec3 hi, float feather) {
  vec2 interval = awRoomInterval(origin, invRay, end, lo, hi);
  if (interval.y <= interval.x) return vec2(0.0);
  // Feather a grazing ray rather than suddenly subtracting the whole room at the wall plane.
  vec3 mid = origin + ray * (0.5 * (interval.x + interval.y));
  return awHeightColumn(origin, ray, interval, AW_FALLOFF, base)
       * smoothstep(0.0, feather, awRoomInset(mid, lo, hi));
}
// Primitive of clamp(h, 0, 1). Integrate the below-grade transition, including horizontal rays.
float awRampArea(float h) {
  float ramp = clamp(h, 0.0, 1.0);
  return 0.5 * ramp * ramp + max(0.0, h - 1.0);
}
float awBelowColumn(float y0, float y1, float len) {
  float a = (AW_GRADE_Y - y0) / (AW_GRADE_Y - AW_DEEP_Y);
  float b = (AW_GRADE_Y - y1) / (AW_GRADE_Y - AW_DEEP_Y);
  if (max(a, b) <= 0.0) return 0.0;
  if (min(a, b) >= 1.0) return len;
  if (abs(b - a) < 1e-4) return len * clamp((a + b) * 0.5, 0.0, 1.0);
  return len * (awRampArea(b) - awRampArea(a)) / (b - a);
}
vec2 awOutdoorColumn(vec3 origin, vec3 ray, float end, float base) {
  vec3 raySign = mix(vec3(-1.0), vec3(1.0), step(0.0, ray));
  vec3 invRay = raySign / max(abs(ray), vec3(1e-6));
  vec2 column = awHeightColumn(origin, ray, vec2(0.0, end), AW_FALLOFF, base);
  column -= vec2(0.97, 0.89) * awRoomColumn(origin, ray, invRay, end, base, ${gatehouse[0]}, ${gatehouse[1]}, 0.32);
  column -= vec2(0.94, 0.85) * awRoomColumn(origin, ray, invRay, end, base, ${chapel[0]}, ${chapel[1]}, 0.40);
  // The transition is below the density datum and does not overlap either room volume.
  column -= vec2(0.995, 0.98) * awBelowColumn(origin.y, origin.y + ray.y * end, end);
  return max(column, 0.0);
}
float awDampPatch(vec3 p, float time) {
  // Two oblique scales break up the wet ground layer. The broad upper haze does not follow it.
  return 0.79 + 0.23 * sin(dot(p.xz, vec2(0.42, 0.21)) - time * 0.07)
              + 0.20 * sin(dot(p.xz, vec2(-0.16, 0.49)) + time * 0.043);
}
vec3 awAtmosphere(vec3 c, vec3 origin, vec3 ray, float rayEnd, bool isSky, out float transmission) {
  float end = min(rayEnd, AW_WEATHER_REACH);
  vec2 column = awOutdoorColumn(origin, ray, end, uFog.z);
  // Weight the ground pattern towards the low part of the ray, not towards the camera.
  float low = mix(0.73, 0.27, smoothstep(-0.18, 0.18, ray.y));
  float dampWeight = mix(awDampPatch(origin + ray * (end * 0.48), uAirTime),
                         awDampPatch(origin + ray * (end * low), uAirTime), 0.66);
  vec2 tau = column * max(uFog.xy, vec2(0.0)) * vec2(dampWeight, 1.0) * awNearWeather(end);
  // The sky already contains its own clouds and lunar corona. Only near-horizon rays receive
  // appreciable local weather; this also brings far silhouettes and horizon air together.
  if (isSky) tau *= 0.68 * (1.0 - smoothstep(0.035, 0.32, ray.y));
  float total = tau.x + tau.y;
  transmission = exp(-total);
  float towardKey = max(0.0, dot(ray, uKeyDir));
  float key = towardKey * towardKey;
  key *= key;
  vec3 inscatter = mix(uGroundAir, uAirColor * (0.84 + uKeyAir * key), tau.y / max(1e-5, total));
  return mix(inscatter, c, transmission);
}

// Primitive of (peak - x²)². x is measured from closest approach in normalized lobe space.
float awLobeArea(float x, float peak) {
  float x2 = x * x;
  return x * (peak * peak - 0.6666667 * peak * x2 + 0.2 * x2 * x2);
}
vec3 awWindowSpace(vec3 p) {
  // A wide, downward-spreading lobe, not a directional sunlight streak. The profile is
  // narrower at the mouth than in the room so it starts inside the stone reveal.
  return vec3((p.x + 0.16 * p.z) / 0.60, (p.y - 0.34 * p.z) / 0.68, p.z / 2.65);
}
float awWindowColumn(vec3 origin, vec3 ray, float rayEnd) {
  vec3 mouth = vec3(${windowMouth});
  // Restrict integration to the room side of the window and the open length of the lobe.
  float start = 0.0, end = rayEnd;
  if (abs(ray.z) > 1e-5) {
    float a = (mouth.z - 4.55 - origin.z) / ray.z;
    float b = (mouth.z - origin.z) / ray.z;
    start = max(0.0, min(a, b)); end = min(end, max(a, b));
  } else if (origin.z < mouth.z - 4.55 || origin.z > mouth.z) return 0.0;
  if (end <= start) return 0.0;

  vec3 p = awWindowSpace(origin - mouth);
  p.z += 1.89 / 2.65;
  vec3 v = awWindowSpace(ray);
  float speed = length(v);
  vec3 n = v / speed;
  float offset = dot(n, p);
  vec3 miss = p - offset * n;
  float peak = 1.0 - dot(miss, miss);
  if (peak <= 0.0) return 0.0;
  float span = sqrt(peak);
  float a = max(-span, offset + start * speed);
  float b = min(span, offset + end * speed);
  if (b <= a) return 0.0;
  return max(0.0, awLobeArea(b, peak) - awLobeArea(a, peak)) / speed;
}
`;
