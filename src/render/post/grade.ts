// 调色（LGT-08）：程序生成 3D LUT（Data3DTexture，无需下载），在 OutputPass 之后的显示空间做
// 饱和/对比/暗部亮部分色；昼为冷灰低饱和偏青，夜为深蓝阴影 + 琥珀高光。暗角与细颗粒单独一个 pass。
import * as THREE from 'three';

export interface GradeParams {
  sat: number; contrast: number;
  /** 暗部/亮部色调，0xRRGGBB 显示空间意图值 */
  tintS: number; tintH: number;
}

const raw = (hex: number): [number, number, number] =>
  [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

export function makeLUT(size = 32): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** 按参数填充 LUT：输入/输出都是显示空间 [0,1]。 */
export function fillLUT(tex: THREE.Data3DTexture, p: GradeParams): void {
  const size = tex.image.width as number;
  const data = tex.image.data as Uint8Array;
  const [sr, sg, sb] = raw(p.tintS);
  const [hr, hg, hb] = raw(p.tintH);
  const inv = 1 / (size - 1);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const R = r * inv, G = g * inv, B = b * inv;
        const l = 0.299 * R + 0.587 * G + 0.114 * B;
        // 饱和 → 对比
        let cr = (l + (R - l) * p.sat - 0.5) * p.contrast + 0.5;
        let cg = (l + (G - l) * p.sat - 0.5) * p.contrast + 0.5;
        let cb = (l + (B - l) * p.sat - 0.5) * p.contrast + 0.5;
        // 分色：暗部乘向冷调（压暗并着色），亮部加一点暖
        const sw = (1 - l) * (1 - l) * 0.85;
        const hw = l * l * 0.16;
        cr = cr * (1 - sw + sw * sr * 1.7) + hr * hw;
        cg = cg * (1 - sw + sw * sg * 1.7) + hg * hw;
        cb = cb * (1 - sw + sw * sb * 1.7) + hb * hw;
        data[i++] = Math.max(0, Math.min(255, cr * 255)) | 0;
        data[i++] = Math.max(0, Math.min(255, cg * 255)) | 0;
        data[i++] = Math.max(0, Math.min(255, cb * 255)) | 0;
        data[i++] = 255;
      }
    }
  }
  tex.needsUpdate = true;
}

/** 暗角 + 细颗粒（显示空间，颗粒比上一轮更弱）。 */
export const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVig: { value: 0.5 }, uGrain: { value: 0.02 }, uTime: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig, uGrain, uTime; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.34, 0.88, d);
      c += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 13.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};