// 天空穹顶着色器（LGT-02）：分层云（高薄幕云 + 主积云团）、密度梯度伪法线受光、
// 月/日方向银边、柔和光晕与云隙星野。同一份材质也用于 PMREM 烘焙昼/夜环境图。
// 技术为公开的 fbm 值噪声云（IQ 式分形叠加）与梯度光照近似，独立实现。
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
// 主云层密度：大尺度团块决定哪里成云，中尺度翻卷 + 小尺度侵蚀给出积云轮廓。
float cloudField(vec2 uv) {
  float base = fbm(uv * 0.5);
  float billow = fbm3(uv * 1.7 + base * 1.6 + 5.2);
  return base * 0.62 + billow * 0.38;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));

  vec3 sunDir = normalize(uSunDir);
  float cosA = clamp(dot(d, sunDir), -1.0, 1.0);
  // 阴天：太阳/月亮方向一大片透云亮区（无硬日斑）
  col += uSunColor * uGlow * 0.22 * pow(clamp(cosA, 0.0, 1.0), 3.0);

  // 云投影到水平面：地平线处压缩、天顶舒展
  float hh = max(h, 0.02);
  vec2 proj = d.xz / (hh + 0.20);

  // 第一层：高而薄的幕云，低对比、柔边，垫出天空纵深
  vec2 uv1 = proj * 0.62 + uTime * vec2(0.005, 0.002) + 2.3;
  float veilD = fbm(uv1);
  float veil = smoothstep(0.48, 0.92, veilD) * 0.5 * smoothstep(-0.02, 0.12, h);
  vec3 veilCol = mix(uHorizon, uCloudLit, 0.4) * (0.88 + 0.24 * veilD);
  col = mix(col, veilCol, veil);

  // 第二层：主积云/层积云，轮廓分明但边缘柔
  vec2 uv2 = proj * 1.15 + uTime * vec2(0.009, 0.0038);
  float dens = cloudField(uv2);
  float lo = 0.62 - uCover * 0.34;
  float hi = lo + 0.24;
  float cover = smoothstep(lo, hi, dens);
  cover *= smoothstep(-0.02, 0.09, h);

  // 密度梯度近似法线：朝日/月一面亮、背面暗；厚云底部更沉
  float e = 0.16;
  vec2 grad = vec2(
    cloudField(uv2 + vec2(e, 0.0)) - cloudField(uv2 - vec2(e, 0.0)),
    cloudField(uv2 + vec2(0.0, e)) - cloudField(uv2 - vec2(0.0, e)));
  vec3 cn = normalize(vec3(-grad.x * 3.0, 0.42, -grad.y * 3.0));
  float lambert = clamp(dot(cn, sunDir), 0.0, 1.0);
  float thick = smoothstep(lo, hi + 0.3, dens);
  float baseDark = mix(1.0, 0.5, thick);
  float topLight = mix(0.82, 1.0, smoothstep(0.05, 0.5, h));
  vec3 cloudCol = mix(uCloudDark, uCloudLit, 0.08 + 0.92 * lambert);
  cloudCol *= baseDark * topLight;
  // 银边：云薄缘在日/月方向被勾亮（夜晚月光银边的主要来源）
  float edge = cover * (1.0 - cover) * 4.0;
  float towards = pow(clamp(cosA, 0.0, 1.0), 3.0);
  cloudCol += uSunColor * uRim * (edge * (0.3 + 0.7 * towards) + 0.10 * towards * cover);
  col = mix(col, cloudCol, cover);

  // 日/月盘 + 光晕：厚云遮挡时减弱；晕宽而柔，不过曝
  float ang = acos(cosA);
  float disc = smoothstep(uDiscSize, uDiscSize * 0.8, ang);
  float mare = 0.82 + 0.18 * fbm3(d.xy * 34.0 + d.z * 17.0);
  float halo = pow(clamp(cosA, 0.0, 1.0), 320.0) * 0.9 + pow(clamp(cosA, 0.0, 1.0), 40.0) * 0.22;
  float occ = (1.0 - cover * 0.85) * (1.0 - veil * 0.4);
  col += uSunColor * (disc * uDiscI * mare + halo * uGlow) * occ;

  // 星星只在云隙出现
  if (uStars > 0.001 && h > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) * 3.0, asin(clamp(h, -1.0, 1.0)) * 6.0);
    vec2 cell = floor(uv * 24.0);
    vec2 f = fract(uv * 24.0) - 0.5;
    float rnd = hash21(cell);
    float star = step(0.965, rnd) * smoothstep(0.12, 0.0, length(f));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 40.0);
    col += vec3(0.8, 0.85, 1.0) * star * tw * uStars * (1.0 - cover) * (1.0 - veil) * smoothstep(0.0, 0.25, h);
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