// Camera-centered live weather and a calibrated, source-free sky for the PMREM bake.
import * as THREE from 'three';

export interface SkyState {
  zenith: number; horizon: number; ground: number;
  sun: number; sunDir: [number, number, number];
  discSize: number; discI: number; glow: number; stars: number;
  cloudLit: number; cloudDark: number; cover: number; rim: number;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudLit, uCloudDark;
uniform float uDiscSize, uDiscI, uGlow, uStars, uTime, uCover, uRim;
varying vec3 vDir;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm5(vec2 p) {
  float v = 0.0, a = 0.55;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = rot * p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0, a = 0.6;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.11 + 7.3; a *= 0.5; }
  return v;
}
// Keep the original broad-sky radiance for the environment probe. The live deck
// can change without re-lighting wet stone or putting the key into reflections.
float probeCloudShape(vec2 uv) {
  vec2 w = vec2(fbm3(uv * 1.4 + 1.7), fbm3(uv * 1.4 + 9.2));
  float base = fbm5(uv * 1.8 + w * 0.40);
  float detail = fbm3(uv * 3.2 + w * 0.6);
  return base * 0.65 + detail * 0.35;
}
float probeGradField(vec2 uv) { return fbm3(uv * 1.8); }
vec3 probeSky(vec3 col, vec3 d, vec3 sunDir, float hh) {
  float h = d.y;
  vec2 proj = d.xz / (hh + 0.39);
  vec2 uv1 = proj * 0.45 + uTime * vec2(0.003, 0.0013) + 2.3;
  float veil = smoothstep(0.55, 0.95, fbm3(uv1)) * 0.22 * smoothstep(-0.02, 0.12, h);
  col = mix(col, mix(uHorizon, uCloudLit, 0.35), veil);

  vec2 uv2 = proj * 2.0 + vec2(2.1, 1.7) + uTime * vec2(0.004, 0.0018);
  float dens = probeCloudShape(uv2);
  float lo = 0.60 - uCover * 0.23;
  float hi = lo + 0.15;
  float optical = max(0.0, dens - lo) * 19.0;
  float cover = (1.0 - exp(-optical)) * smoothstep(-0.025, 0.08, h);

  float e = 0.085;
  vec2 grad = vec2(
    probeGradField(uv2 + vec2(e, 0.0)) - probeGradField(uv2 - vec2(e, 0.0)),
    probeGradField(uv2 + vec2(0.0, e)) - probeGradField(uv2 - vec2(0.0, e)));
  vec3 cn = normalize(vec3(-grad.x * 4.0, 0.40, -grad.y * 4.0));
  float lambert = clamp(dot(cn, sunDir), 0.0, 1.0);
  float topLight = mix(0.52, 1.0, smoothstep(0.0, 0.65, h));
  float thick = smoothstep(lo, hi + 0.10, dens);
  float baseDark = mix(1.0, 0.54, thick);
  float lit = (0.12 + 0.64 * lambert) * topLight * baseDark;
  return mix(col, mix(uCloudDark, uCloudLit, lit), cover);
}

float sourceDisc(vec3 d, vec3 sunDir, float cosA) {
  if (uDiscSize <= 0.0 || uDiscI <= 0.0) return 0.0;
  float dist = length(cross(d, sunDir));
  float radius = sin(uDiscSize);
  // Evaluate derivatives before the per-pixel disc test.
  float aa = min(0.5 * fwidth(dist), radius * 0.5);
  if (cosA <= 0.0 || dist >= radius + aa) return 0.0;
  float disc = 1.0 - smoothstep(sin(uDiscSize * 0.91) - aa, radius + aa, dist);
  vec3 up = abs(sunDir.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 right = normalize(cross(up, sunDir));
  vec2 moonUV = vec2(dot(d, right), dot(d, cross(sunDir, right))) / uDiscSize;
  float detail = fbm3(moonUV * 3.3 + 11.2);
  float mare = mix(0.46, 1.0, smoothstep(0.24, 0.67, detail));
  mare *= 0.72 + 0.28 * sqrt(max(0.0, 1.0 - dot(moonUV, moonUV)));
  return disc * uDiscI * mare;
}

float starField(vec3 d) {
  // Upper-hemisphere stereographic grid: no azimuth seam or pole pinch.
  vec2 p = 108.0 * d.xz / (1.0 + max(d.y, 0.0));
  vec2 px = fwidth(p);
  float footprint = max(px.x, px.y);
  vec2 cell = floor(p);
  float rnd = hash21(cell);
  if (rnd < 0.991) return 0.0;
  vec2 center = 0.34 + 0.32 * vec2(hash21(cell + 4.3), hash21(cell + 14.1));
  float aa = min(0.5 * footprint, 0.20);
  float radius = 0.085 + aa;
  float point = 1.0 - smoothstep(max(0.0, 0.025 - aa), radius, length(fract(p) - center));
  // Widen and dim subpixel points together; fade the grid out if undersampled.
  float gain = 0.085 / radius;
  return point * gain * gain * (1.0 - smoothstep(0.35, 0.78, footprint));
}

// Value and analytic directional derivative from the same four lattice hashes.
vec2 weatherNoise(vec2 p, vec2 towardKey) {
  vec2 i = floor(p), f = fract(p);
  vec2 t = f * f * (3.0 - 2.0 * f);
  vec2 dt = 6.0 * f * (1.0 - f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + 1.0);
  vec2 slope = dt * vec2(mix(b - a, d - c, t.y), mix(c - a, d - b, t.x));
  return vec2(mix(mix(a, b, t.x), mix(c, d, t.x), t.y), dot(slope, towardKey));
}

vec2 weatherDeck(vec2 p, vec2 towardKey) {
  const mat2 turn = mat2(0.94, 0.342, -0.342, 0.94);
  vec2 field = vec2(0.0);
  vec2 weight = vec2(0.57);
  for (int i = 0; i < 4; i++) {
    field += weight * weatherNoise(p, towardKey);
    p = turn * p * 2.03 + vec2(7.3, 11.7);
    towardKey = turn * towardKey;
    // Soften the optical slope at fine scales without smoothing the silhouette.
    weight *= vec2(0.50, 0.70);
  }
  return field;
}

vec3 weatherSky(vec3 col, vec3 d, vec3 sunDir, float hh) {
  float h = d.y;
  float night = smoothstep(0.18, 0.95, uStars); // Dusk retains its overcast deck.
  float cosA = dot(d, sunDir);
  float facing = clamp(cosA, 0.0, 1.0);
  float window = pow(facing, 6.0) * smoothstep(-0.03, 0.18, h);

  // Bounded, world-direction projections: wind translates each pattern and
  // the low deck spreads out toward the horizon without a grazing singularity.
  const mat2 windFrame = mat2(0.8, -0.6, 0.6, 0.8);
  const vec2 deckScale = vec2(2.7, 3.9);
  vec2 wind = windFrame * d.xz;
  vec2 deckUV = wind / (hh + 0.33) * deckScale + vec2(2.1, 1.7)
              - uTime * vec2(0.004, 0.0006);
  float roll = vnoise(deckUV * 0.48 + vec2(8.2, 15.9));
  vec2 towardKey = (windFrame * sunDir.xz) * deckScale;
  towardKey /= max(length(towardKey), 0.1);
  vec2 field = weatherDeck(deckUV + vec2(0.22, 0.86) * (roll - 0.5), towardKey);
  float lo = 0.535 - uCover * 0.20 + night * 0.055;
  float depth = field.x - lo;
  float deck = smoothstep(-0.025, 0.145, depth);
  // Keep the contrast in the courtyard's visible sky, not just above the roofs.
  float horizonFade = smoothstep(-0.025, 0.115, h);

  // Quiet distance haze behind the weather. It no longer takes over the first
  // few degrees above the skyline, where local air already mutes the sky.
  float distant = smoothstep(-0.10, 0.0, h) * (1.0 - smoothstep(0.018, 0.17, h));
  vec3 farDeck = mix(uHorizon, uCloudDark, (0.25 + 0.18 * roll) * mix(1.0, 0.55, night));
  col = mix(col, farDeck, 0.68 * distant);

  // Higher, finer wind streaks, visible through gaps and never opaque.
  vec2 veilUV = (wind + vec2(0.0, 0.20 * wind.x)) / (hh + 0.70) * vec2(1.8, 8.6)
              + vec2(12.4, 3.7) - uTime * vec2(0.006, 0.0013);
  float veil = smoothstep(0.42, 0.66, fbm3(veilUV)) * horizonFade * mix(0.25, 0.45, night);
  vec3 veilCol = mix(mix(uHorizon, uCloudLit, 0.55),
                     mix(uZenith, uCloudLit, 0.21 + 0.27 * window), night);
  col = mix(col, veilCol, veil);

  // Proxy for the column toward the key: a rising density darkens the body;
  // a falling density exposes a soft lit shoulder even away from the corona.
  float keyDepth = depth + 0.20 * field.y;
  float shade = smoothstep(0.025, 0.24, keyDepth);
  float penumbra = (1.0 - shade) * smoothstep(0.025, 0.42, -field.y);
  float opening = window * (1.0 - night);
  float deckOpacity = deck * horizonFade * mix(0.93, 0.64, night) * (1.0 - 0.32 * opening);
  float light = mix(0.36, 0.14, night) - mix(0.16, 0.09, night) * shade
              + penumbra * mix(0.36, 0.53, night) + opening * (0.38 - 0.15 * shade);
  vec3 deckCol = mix(uCloudDark, uCloudLit, light);
  float edge = 4.0 * deck * (1.0 - deck);
  deckCol += uSunColor * uRim * edge * penumbra * pow(facing, 16.0) * mix(0.21, 0.09, night);
  col = mix(col, deckCol, deckOpacity);

  float transmission = (1.0 - deckOpacity) * (1.0 - veil);
  float wing = pow(facing, 40.0);
  float corona = (0.88 * pow(facing, 320.0) + 0.18 * wing) * smoothstep(0.0, 1.4, uDiscI);
  float glow = uGlow * ((0.17 * window + 0.16 * opening) * mix(0.68, 1.0, transmission)
                       + corona * mix(0.60, 1.0, transmission));
  float silver = night * veil * wing * (0.11 * uGlow + 0.16 * uRim);
  col += uSunColor * (glow + silver + sourceDisc(d, sunDir, cosA) * transmission);

  if (uStars > 0.001) {
    float clarity = transmission * transmission * (1.0 - 0.88 * wing);
    col += vec3(0.23, 0.30, 0.41) * starField(d) * clarity * uStars * smoothstep(0.08, 0.36, h);
  }
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, 1.0 - smoothstep(-0.25, 0.0, h));
  vec3 sunDir = normalize(uSunDir);
  float hh = 0.02 + 0.5 * (h + sqrt(h * h + 0.006));

  // SceneView already zeros all source terms in its PMREM preset. This uniform
  // branch preserves that capture without testing render targets or adding API.
  if (uDiscSize == 0.0 && uDiscI == 0.0 && uGlow == 0.0 && uRim == 0.0 && uStars == 0.0) {
    col = probeSky(col, d, sunDir, hh);
  } else {
    col = weatherSky(col, d, sunDir, hh);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
      uDiscSize: { value: 0 }, uDiscI: { value: 0 }, uGlow: { value: 0 }, uStars: { value: 0 },
      uTime: { value: 0 }, uCover: { value: 0.8 }, uRim: { value: 0.2 },
    },
  });
}

/** 把一套天空参数写进材质 uniforms（主穹顶与烘焙穹顶共用）。 */
export function applySky(mat: THREE.ShaderMaterial, s: SkyState, time: number): void {
  const u = mat.uniforms;
  u.uZenith.value.setHex(s.zenith); u.uHorizon.value.setHex(s.horizon); u.uGround.value.setHex(s.ground);
  u.uSunDir.value.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]); u.uSunColor.value.setHex(s.sun);
  u.uCloudLit.value.setHex(s.cloudLit); u.uCloudDark.value.setHex(s.cloudDark);
  u.uDiscSize.value = s.discSize; u.uDiscI.value = s.discI; u.uGlow.value = s.glow; u.uStars.value = s.stars;
  u.uCover.value = s.cover; u.uRim.value = s.rim; u.uTime.value = time;
}