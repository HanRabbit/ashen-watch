// 远景轻虚化（LGT-06）：只用于固定机位/标题。按深度只对远处（远景城堡/天空）做
// 极轻的柔化，近景与中景 factor=0 完全锐利——圣经 §7「游戏视角不加景深，固定机位
// 只允许极轻的远景虚化」。深度复用 GTAOPass 的深度纹理，不额外渲染场景。
import * as THREE from 'three';

export const FarSoftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uNear: { value: 0.08 }, uFar: { value: 320 },
    /** 虚化起始/满幅距离（视空间米） */
    uStart: { value: 40 }, uEnd: { value: 90 },
    /** 最大模糊半径（uv 单位），1080p 下约 2px */
    uMaxBlur: { value: 0.0011 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uHasDepth, uNear, uFar, uStart, uEnd, uMaxBlur, uAspect;
    varying vec2 vUv;
    float viewDepth(float d) {
      return -(uNear * uFar) / ((uFar - uNear) * d - uFar);
    }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      float f = 0.0;
      if (uHasDepth > 0.5) {
        float z = viewDepth(texture2D(tDepth, vUv).x);
        f = smoothstep(uStart, uEnd, z);
      }
      if (f < 0.02) { gl_FragColor = vec4(base, 1.0); return; }
      // 12  tap 泊松盘，半径随深度因子缩放；只影响远景
      vec2 r = vec2(uMaxBlur / uAspect, uMaxBlur) * f;
      vec3 acc = base;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.326, -0.406)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.840, -0.074)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.696,  0.457)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.203,  0.621)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.962, -0.195)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.473, -0.480)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.519,  0.767)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.185, -0.893)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.507,  0.064)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2( 0.896,  0.412)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.322, -0.933)).rgb;
      acc += texture2D(tDiffuse, vUv + r * vec2(-0.792, -0.598)).rgb;
      gl_FragColor = vec4(acc / 13.0, 1.0);
    }`,
};