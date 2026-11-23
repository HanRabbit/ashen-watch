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
// 主云层密度：大尺度团块 + 域扭曲花椰菜轮廓 + 中尺度侵蚀。频率低、团块大（画面 5–10 团）。
float cloudShape(vec2 uv) {
  vec2 w = vec2(fbm3(uv * 1.4 + 1.7), fbm3(uv * 1.4 + 9.2));
  float base = fbm(uv * 1.8 + w * 0.40);
  float detail = fbm3(uv * 3.2 + w * 0.6);
  return base * 0.65 + detail * 0.35;
}
// 大尺度密度场：供梯度伪法线（便宜，5 octave）
float cloudGradField(vec2 uv) { return fbm(uv * 1.8); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, 1.0 - smoothstep(-0.25, 0.0, h));

  vec3 sunDir = normalize(uSunDir);
  float cosA = clamp(dot(d, sunDir), -1.0, 1.0);
  // 阴天：太阳/月亮方向一大片透云亮区（无硬日斑）
  col += uSunColor * uGlow * 0.22 * pow(clamp(cosA, 0.0, 1.0), 3.0);

  // 云投影到水平面：抬高偏移减少地平线拉伸，团块保持圆润
  float hh = max(h, 0.02);
  vec2 proj = d.xz / (hh + 0.39);

  // 第一层：极薄高幕云，仅垫纵深（夜晚几乎关闭，避免涂抹条带）
  vec2 uv1 = proj * 0.45 + uTime * vec2(0.003, 0.0013) + 2.3;
  float veilD = fbm(uv1);
  float veil = smoothstep(0.55, 0.95, veilD) * 0.22 * (1.0 - uStars * 0.6) * smoothstep(-0.02, 0.12, h);
  vec3 veilCol = mix(uHorizon, uCloudLit, 0.35);
  col = mix(col, veilCol, veil);

  // 第二层：成团积云/层积云，块状轮廓、软边
  vec2 uv2 = proj * 2.0 + vec2(2.1, 1.7) + uTime * vec2(0.004, 0.0018);
  float dens = cloudShape(uv2);
  float lo = 0.60 - uCover * 0.23;
  float hi = lo + 0.15;
  float optical = max(0.0, dens - lo) * 19.0;
  float cover = (1.0 - exp(-optical)) * smoothstep(-0.025, 0.08, h);

  // 密度梯度→外向伪法线：朝日/月一侧的团块侧翼亮、背侧暗（体积感）
  float e = 0.085;
  vec2 grad = vec2(
    cloudGradField(uv2 + vec2(e, 0.0)) - cloudGradField(uv2 - vec2(e, 0.0)),
    cloudGradField(uv2 + vec2(0.0, e)) - cloudGradField(uv2 - vec2(0.0, e)));
  vec3 cn = normalize(vec3(-grad.x * 4.0, 0.40, -grad.y * 4.0));
  float lambert = clamp(dot(cn, sunDir), 0.0, 1.0);
  // 团内上下明暗：高处（团顶）受光、低处沉入底色；厚云底更沉
  float topLight = mix(0.52, 1.0, smoothstep(0.0, 0.65, h));
  float thick = smoothstep(lo, hi + 0.10, dens);
  float baseDark = mix(1.0, 0.54, thick);
  float lit = (0.12 + 0.64 * lambert) * topLight * baseDark;
  vec3 cloudCol = mix(uCloudDark, uCloudLit, lit);
  // 银边：只勾靠近日/月一侧的团块薄缘，不整片提亮
  float edge = cover * (1.0 - cover) * 4.0;
  float towards = pow(max(cosA, 0.0), 16.0);
  cloudCol += uSunColor * uRim * edge * towards * (0.20 + 0.36 * lambert);
  col = mix(col, cloudCol, cover);

  // 日/月盘 + 光晕：厚云遮挡时减弱；晕宽而柔，不过曝
  float ang = acos(cosA);
  float disc = 0.0, mare = 1.0;
  if (uDiscSize > 0.0 && ang < uDiscSize) {
    disc = 1.0 - smoothstep(uDiscSize * 0.92, uDiscSize, ang);
    // Resolve surface structure in disc-relative coordinates, regardless of position in the sky.
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir));
    vec2 moonUV = vec2(dot(d, right), dot(d, cross(sunDir, right))) / uDiscSize;
    float patch = fbm3(moonUV * 3.3 + 11.2);
    mare = mix(0.46, 1.0, smoothstep(0.24, 0.67, patch));
    mare *= 0.72 + 0.28 * sqrt(max(0.0, 1.0 - dot(moonUV, moonUV)));
  }
  float halo = pow(clamp(cosA, 0.0, 1.0), 320.0) * 0.9 + pow(clamp(cosA, 0.0, 1.0), 40.0) * 0.22;
  float occ = (1.0 - cover) * (1.0 - veil * 0.4);
  col += uSunColor * (disc * uDiscI * mare + halo * uGlow) * occ;

  // 星星只在云隙出现
  if (uStars > 0.001 && h > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) * 3.0, asin(clamp(h, -1.0, 1.0)) * 6.0);
    vec2 cell = floor(uv * 24.0);
    vec2 f = fract(uv * 24.0) - 0.5;
    float rnd = hash21(cell);
    float star = step(0.982, rnd) * (1.0 - smoothstep(0.025, 0.10, length(f)));
    float clarity = (1.0 - cover) * (1.0 - cover) * (1.0 - veil);
    col += vec3(0.50, 0.63, 0.88) * star * clarity * uStars * smoothstep(0.08, 0.36, h);
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