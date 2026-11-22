// 天空穹顶着色器（LGT-02）：两层 fbm 体积感云、日/月盘与光晕、云缘受光、云隙星野。
// 同一份材质也用于 PMREM 烘焙昼/夜环境图，保证 IBL 与可见天空一致。
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
float fbm(vec2 p) {
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
// 云密度：大尺度团块 + 小尺度侵蚀，随时间缓慢漂移。
float cloudDensity(vec2 uv) {
  float big = fbm(uv * 0.55);
  float small = fbm3(uv * 1.9 + big * 1.35);
  return big * 0.68 + small * 0.32;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));

  vec3 sunDir = normalize(uSunDir);
  // 云投影到水平面：地平线处压缩、天顶舒展
  float hh = max(h, 0.015);
  vec2 cuv = d.xz / (hh + 0.22) * 1.35;
  cuv += uTime * vec2(0.008, 0.0035);
  float dens = cloudDensity(cuv);
  float cover = smoothstep(0.62 - uCover * 0.45, 0.95 - uCover * 0.25, dens);
  cover *= smoothstep(-0.03, 0.10, h);

  // 云体受光：密度梯度近似法线，朝向太阳/月亮的一面亮、背面暗
  vec2 grad = vec2(
    cloudDensity(cuv + vec2(0.22, 0.0)) - cloudDensity(cuv - vec2(0.22, 0.0)),
    cloudDensity(cuv + vec2(0.0, 0.22)) - cloudDensity(cuv - vec2(0.0, 0.22)));
  vec3 cn = normalize(vec3(-grad.x, 0.55, -grad.y));
  float lambert = clamp(dot(cn, sunDir), 0.0, 1.0);
  vec3 cloudCol = mix(uCloudDark, uCloudLit, 0.12 + 0.75 * lambert);
  cloudCol *= mix(1.0, 0.62, smoothstep(0.5, 0.95, dens)); // 厚云更沉
  // 日/月方向的银边：薄云边缘被照亮
  float towards = pow(clamp(dot(d, sunDir), 0.0, 1.0), 5.0);
  float edge = clamp(1.0 - cover, 0.0, 1.0);
  cloudCol += uSunColor * uRim * towards * (0.35 + 0.65 * edge);
  col = mix(col, cloudCol, cover);

  // 日/月盘 + 光晕：厚云遮挡时减弱
  float cosA = clamp(dot(d, sunDir), -1.0, 1.0);
  float ang = acos(cosA);
  float disc = smoothstep(uDiscSize, uDiscSize * 0.8, ang);
  // 月面明暗斑（仅盘内）
  float mare = 0.82 + 0.18 * fbm3(d.xy * 34.0 + d.z * 17.0);
  float halo = pow(clamp(cosA, 0.0, 1.0), 220.0) * 1.1 + pow(clamp(cosA, 0.0, 1.0), 26.0) * 0.32;
  col += uSunColor * (disc * uDiscI * mare + halo * uGlow) * (1.0 - cover * 0.8);

  // 星星只在云隙出现
  if (uStars > 0.001 && h > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) * 3.0, asin(clamp(h, -1.0, 1.0)) * 6.0);
    vec2 cell = floor(uv * 24.0);
    vec2 f = fract(uv * 24.0) - 0.5;
    float rnd = hash21(cell);
    float star = step(0.965, rnd) * smoothstep(0.12, 0.0, length(f));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 40.0);
    col += vec3(0.8, 0.85, 1.0) * star * tw * uStars * (1.0 - cover) * smoothstep(0.0, 0.25, h);
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