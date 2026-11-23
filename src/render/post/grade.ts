// 调色（LGT-08）：程序生成 3D LUT（Data3DTexture，无需下载），在 ACES / sRGB 转换后的显示空间做
// 饱和/对比/暗部亮部分色；昼为冷灰低饱和偏青，夜为深蓝阴影 + 琥珀高光。暗角与细颗粒与显示变换合并。
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
  const sGray = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  const hGray = 0.299 * hr + 0.587 * hg + 0.114 * hb;
  const inv = 1 / (size - 1);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const R = r * inv, G = g * inv, B = b * inv;
        const l = 0.299 * R + 0.587 * G + 0.114 * B;
        // Endpoint-preserving contrast and small opponent tints; no black subtraction
        // or lifted pedestal. The key/fill and real emitters provide the color hierarchy.
        const mid = l + (p.contrast - 1) * (2 * l - 1) * l * (1 - l) * 2;
        // Split-tone slate and pale sky, but leave already coloured light and materials
        // to the HDR result. Colour is judged in display space here.
        const chroma = Math.max(R, G, B) - Math.min(R, G, B);
        const tintWeight = 1 - 0.75 * Math.min(1, chroma * 3);
        const sw = l * (1 - l) * (1 - l) * 0.34 * tintWeight;
        const hw = l * l * (1 - l) * (0.12 + 0.12 * l) * tintWeight;
        const sat = p.sat + (1 - p.sat) * 0.38 * Math.min(1, chroma * 2);
        const cr = mid + (R - l) * sat + (sr - sGray) * sw + (hr - hGray) * hw;
        const cg = mid + (G - l) * sat + (sg - sGray) * sw + (hg - hGray) * hw;
        const cb = mid + (B - l) * sat + (sb - sGray) * sw + (hb - hGray) * hw;
        data[i++] = Math.round(Math.max(0, Math.min(1, cr)) * 255);
        data[i++] = Math.round(Math.max(0, Math.min(1, cg)) * 255);
        data[i++] = Math.round(Math.max(0, Math.min(1, cb)) * 255);
        data[i++] = 255;
      }
    }
  }
  tex.needsUpdate = true;
}

/** Final HDR → ACES → sRGB → LUT → vignette/hurt/grain, in a single framebuffer write. */
export const FilmOutputShader = {
  name: 'AwFilmOutput',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLut: { value: null as THREE.Data3DTexture | null },
    uLutSize: { value: 32 },
    uVig: { value: 0.5 }, uGrain: { value: 0.02 }, uTime: { value: 0 }, uHurt: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform highp sampler3D uLut;
    uniform float uLutSize, uVig, uGrain, uTime, uHurt;
    varying vec2 vUv;
    float filmNoise(vec2 pixel, float phase) {
      vec3 p = fract(vec3(pixel, phase) * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z) - 0.5;
    }
    void main() {
      gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);
      // The fitted ACES curve goes negative for very small *positive* inputs.
      // A bounded, luminance-preserving toe resolves real weak radiance without
      // a black offset. At its intersection the ordinary ACES shoulder takes over.
      #ifdef TONE_MAPPING
        vec3 exposed = max(gl_FragColor.rgb * toneMappingExposure, vec3(0.0));
        vec3 toeWeights = vec3(0.2126, 0.7152, 0.0722);
        float sceneY = dot(exposed, toeWeights);
      #endif
      #include <tonemapping_fragment>
      #ifdef TONE_MAPPING
        float filmY = dot(gl_FragColor.rgb, toeWeights);
        float toeY = 2.15 * sceneY / (1.0 + 2.15 * sceneY / 0.014);
        gl_FragColor.rgb += exposed * (max(toeY - filmY, 0.0) / max(sceneY, 1e-8));
      #endif
      #include <colorspace_fragment>
      vec3 coord = (clamp(gl_FragColor.rgb, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
      vec3 c = texture(uLut, coord).rgb;
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.34, 0.88, d);
      c = mix(c, vec3(0.42, 0.06, 0.05), uHurt * smoothstep(0.25, 0.75, d) * 0.6);
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      // Avoid sparkling in deep night shadows or flattening the clean sky shoulder.
      float grainWeight = mix(0.18, 1.0, smoothstep(0.01, 0.23, luma))
                        * mix(1.0, 0.35, smoothstep(0.6, 0.96, luma));
      // Flat haze and sky need dither, not full-strength animated grain. Detect
      // local detail without widening the scene sample or filtering any edges.
      float detail = smoothstep(0.004, 0.032, fwidth(luma));
      vec2 pixel = floor(gl_FragCoord.xy);
      float dither = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))) - 0.5;
      float tick = uTime * 12.0;
      float phase = floor(tick);
      float fade = smoothstep(0.0, 1.0, fract(tick));
      float grain = mix(filmNoise(pixel, mod(phase, 251.0)), filmNoise(pixel, mod(phase + 1.0, 251.0)), fade);
      c += mix(dither * 0.22, grain, detail) * uGrain * grainWeight;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};
