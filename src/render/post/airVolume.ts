import { AREAS } from '../../sim/level';

// Coordinates match the render scene (world Z is minus simulation Z). Restrict only the part of
// the ray actually inside a room: an observer indoors can still see outdoor air through a door.
const room = (a: typeof AREAS.gatehouse | typeof AREAS.chapel, bottom: number, top: number): [string, string] => [
  `vec3(${[a.x0, bottom, -a.z1].map((n) => n.toFixed(2)).join(', ')})`,
  `vec3(${[a.x1, top, -a.z0].map((n) => n.toFixed(2)).join(', ')})`,
];
const gatehouse = room(AREAS.gatehouse, -0.12, 3.6);
const chapel = room(AREAS.chapel, -0.12, 9.3);

export const AIR_VOLUME_GLSL = /* glsl */`
// Integrate exp(-falloff * max(worldY - base, 0)): finite under the terrain datum,
// continuous at grazing incidence. Split at the datum instead of extrapolating exponentials.
float awHeightPath(vec3 origin, vec3 ray, float start, float end) {
  if (end <= start) return 0.0;
  float a = origin.y + ray.y * start - uFog.z;
  float b = origin.y + ray.y * end - uFog.z;
  float distance = end - start;
  float span = abs(a - b);
  float h0 = min(a, b), h1 = max(a, b);
  if (h1 <= 0.0) return distance;
  if (span < 1e-4) return distance * exp(-uFog.y * max((a + b) * 0.5, 0.0));
  float above = distance * (h1 - max(h0, 0.0)) / span;
  float q = uFog.y * max(h1 - max(h0, 0.0), 0.0);
  float average = q < 0.01 ? 1.0 - q * 0.5 : (1.0 - exp(-q)) / q;
  return distance - above + above * exp(-uFog.y * max(h0, 0.0)) * average;
}
float awRoomPath(vec3 origin, vec3 ray, vec3 invRay, float end, vec3 lo, vec3 hi) {
  vec3 a = (lo - origin) * invRay, b = (hi - origin) * invRay;
  vec3 from = min(a, b), to = max(a, b);
  float start = max(0.0, max(from.x, max(from.y, from.z)));
  float stop = min(end, min(to.x, min(to.y, to.z)));
  return awHeightPath(origin, ray, start, stop);
}
float awUndergroundPath(vec3 origin, vec3 ray, float end) {
  const float grade = -0.12;
  if (abs(ray.y) < 1e-4) return origin.y < grade ? awHeightPath(origin, ray, 0.0, end) : 0.0;
  float crossing = clamp((grade - origin.y) / ray.y, 0.0, end);
  return ray.y > 0.0 ? awHeightPath(origin, ray, 0.0, crossing) : awHeightPath(origin, ray, crossing, end);
}
float awAirDensity(vec3 world, float sheltered) {
  return exp(-uFog.y * max(world.y - uFog.z, 0.0)) * sheltered;
}
float awExposureToAir(vec3 world) {
  if (world.y < -0.12) return 0.06;
  if (all(greaterThan(world, ${gatehouse[0]})) && all(lessThan(world, ${gatehouse[1]}))) return 0.13;
  if (all(greaterThan(world, ${chapel[0]})) && all(lessThan(world, ${chapel[1]}))) return 0.32;
  return 1.0;
}
float awAtmosphere(vec3 origin, vec3 ray, float end) {
  // The existing distance fog handles distant landmarks. A finite local layer prevents a second
  // veil of fog on the far skyline. Rays into the sky still traverse this same near atmosphere.
  end = min(end, 60.0);
  vec3 raySign = mix(vec3(-1.0), vec3(1.0), step(0.0, ray));
  vec3 invRay = raySign / max(abs(ray), vec3(1e-5));
  float column = awHeightPath(origin, ray, 0.0, end);
  column -= 0.94 * awUndergroundPath(origin, ray, end);
  column -= 0.87 * awRoomPath(origin, ray, invRay, end, ${gatehouse[0]}, ${gatehouse[1]});
  column -= 0.68 * awRoomPath(origin, ray, invRay, end, ${chapel[0]}, ${chapel[1]});
  // Soft, sparse air variation in world coordinates. A smooth path average avoids a moving
  // screen-space pattern, hard fog sheets, or noise boiling in the depth buffer.
  vec2 p = origin.xz + ray.xz * (0.42 * end);
  float eddy = sin(dot(p, vec2(0.20, 0.14)) + uAirTime * 0.065)
             * sin(dot(p, vec2(-0.15, 0.22)) - uAirTime * 0.045);
  float opticalDepth = uFog.x * max(column, 0.0) * (1.0 + 0.17 * eddy);
  return 1.0 - exp(-opticalDepth);
}
`;
