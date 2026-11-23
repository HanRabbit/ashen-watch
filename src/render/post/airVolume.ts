import { AREAS } from '../../sim/level';

// These are shelter volumes, not new geometry. Render Z is minus simulation Z.
const room = (a: typeof AREAS.gatehouse | typeof AREAS.chapel, top: number) => [
  `vec3(${[a.x0, -0.12, -a.z1].map((n) => n.toFixed(2)).join(', ')})`,
  `vec3(${[a.x1, top, -a.z0].map((n) => n.toFixed(2)).join(', ')})`,
] as const;
const gatehouse = room(AREAS.gatehouse, 3.9);
const chapel = room(AREAS.chapel, 9.3);

// Closed-form column of two exponential media, bounded below their datum. Used by both the
// depth composite and the direct-render fallback, so the latter cannot exponentiate below grade.
export const HEIGHT_COLUMN_GLSL = /* glsl */`
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
vec2 awRoomInterval(vec3 origin, vec3 invRay, float end, vec3 lo, vec3 hi) {
  vec3 a = (lo - origin) * invRay, b = (hi - origin) * invRay;
  vec3 from = min(a, b), to = max(a, b);
  return vec2(max(0.0, max(from.x, max(from.y, from.z))), min(end, min(to.x, min(to.y, to.z))));
}
float awInRoom(vec3 p, vec3 lo, vec3 hi) {
  vec3 d = min(p - lo, hi - p);
  return smoothstep(-0.16, 0.22, min(d.x, min(d.y, d.z)));
}
float awAirShelter(vec3 p) {
  float underground = 1.0 - smoothstep(-0.36, -0.12, p.y);
  float gatehouse = awInRoom(p, ${gatehouse[0]}, ${gatehouse[1]});
  float chapel = awInRoom(p, ${chapel[0]}, ${chapel[1]});
  return max(0.90 * underground, max(0.83 * gatehouse, 0.70 * chapel));
}
`;

export const AIR_VOLUME_GLSL = /* glsl */`
${HEIGHT_COLUMN_GLSL}
// The damp ground layer settles quickly; the free air above it carries broader, thinner haze.
const vec2 AW_FALLOFF = vec2(0.86, 0.105);
vec2 awOutdoorColumn(vec3 origin, vec3 ray, float end, float base) {
  vec3 raySign = mix(vec3(-1.0), vec3(1.0), step(0.0, ray));
  vec3 invRay = raySign / max(abs(ray), vec3(1e-5));
  vec2 a = awRoomInterval(origin, invRay, end, ${gatehouse[0]}, ${gatehouse[1]});
  vec2 b = awRoomInterval(origin, invRay, end, ${chapel[0]}, ${chapel[1]});
  float crossing = clamp((-0.12 - origin.y) * invRay.y, 0.0, end);
  vec2 below = ray.y >= 0.0 ? vec2(0.0, crossing) : vec2(crossing, end);
  vec2 column = awHeightColumn(origin, ray, vec2(0.0, end), AW_FALLOFF, base);
  // Volumes do not overlap below grade. Only subtract the sheltered portion of the ray,
  // including when the camera is looking *out* through an opening.
  if (a.y > a.x) column -= vec2(0.91, 0.76) * awHeightColumn(origin, ray, a, AW_FALLOFF, base);
  if (b.y > b.x) column -= vec2(0.85, 0.63) * awHeightColumn(origin, ray, b, AW_FALLOFF, base);
  if (below.y > below.x) column -= vec2(0.98, 0.93) * awHeightColumn(origin, ray, below, AW_FALLOFF, base);
  return max(column, 0.0);
}
vec3 awAtmosphere(vec3 c, vec3 origin, vec3 ray, float end) {
  // A bounded local layer, then the existing long-range surface aerial perspective.
  // Do not accumulate background radiance over the whole sky distance.
  end = min(end, 64.0);
  vec2 column = awOutdoorColumn(origin, ray, end, uFog.z);
  // Two broad world-anchored variations sampled on the path, no screen noise or temporal history.
  vec2 p = origin.xz + ray.xz * (0.24 * end);
  vec2 q = origin.xz + ray.xz * (0.68 * end);
  vec2 k = vec2(0.25, -0.16);
  float eddy = sin(dot(p, k) + uAirTime * 0.045) + sin(dot(q, k) + uAirTime * 0.045);
  vec2 tau = column * uFog.xy * vec2(1.0 + 0.11 * eddy, 1.0);
  float total = tau.x + tau.y;
  float tint = tau.y / max(1e-5, total);
  // Broad forward scatter, not an unoccluded sun shaft. Shadowed rooms receive little sky mist.
  float key = pow(max(0.0, dot(ray, uKeyDir)), 5.0);
  vec3 inscatter = mix(uGroundAir, uAirColor * (0.87 + uKeyAir * key), tint);
  return mix(inscatter, c, exp(-total));
}
`;
