/** 庭院积水洼地（模拟坐标 x,z,r），与 vfx.ts PUDDLES 完全一致；着色器里 z 取负转到世界坐标。 */
export const PUDDLE_CENTERS: [number, number, number][] = [[-4, 8, 1.1], [3.5, 18, 1.3], [-2, 24, 0.9], [6, 12, 0.8]];

/** World-space footprint used by material shading and cinematic reflections. */
export const STONE_POOL_GLSL = /* glsl */`
float awHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float awNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = awHash(i), b = awHash(i + vec2(1, 0)), c = awHash(i + vec2(0, 1)), d = awHash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float awFbm(vec2 p) { return 0.6 * awNoise(p) + 0.3 * awNoise(p * 2.13 + 7.7) + 0.1 * awNoise(p * 4.7 + 3.1); }
float awPoolFootprint(vec2 p) {
  const vec3 depressions[${PUDDLE_CENTERS.length}] = vec3[](
    ${PUDDLE_CENTERS.map(([x, z, r]) => `vec3(${x.toFixed(2)}, ${(-z).toFixed(2)}, ${r.toFixed(2)})`).join(', ')});
  float ruffle = (awFbm(p * 4.5) - 0.5) * 0.23;
  float water = 0.0;
  for (int i = 0; i < ${PUDDLE_CENTERS.length}; i++) {
    float rim = distance(p, depressions[i].xy) / depressions[i].z + ruffle;
    water = max(water, 0.9 * (1.0 - smoothstep(0.61, 0.97, rim)));
  }
  return water;
}
`;
