// 灯光散射（LGT-07）：屏幕空间体积光晕。把主要点光源（壁灯/提灯/火盆/炉火窗）投影到屏幕，
// 按深度遮挡做径向 in-scatter 近似：灯被墙挡住时晕消失，灯在湿夜空气里拉出琥珀光晕。
// 深度复用 GTAOPass 的深度纹理，不额外渲染一遍场景。
import * as THREE from 'three';

export const MAX_GLOW_LIGHTS = 6;

export const LightGlowShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uLights: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLightCols: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uCount: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 320 },
    uAspect: { value: 1 }, uStrength: { value: 0.5 },
    // 雾内 in-scatter（解析近似）：uFog = (heightDensity, falloff, base)
    uScatter: { value: 0.4 }, uFog: { value: new THREE.Vector3(0.012, 0.1, 0) },
    uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    uInvView: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uAmber: { value: new THREE.Color(0xffb25e) }, // 美术总纲灯火琥珀 2200–2700K
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uHasDepth, uNear, uFar, uAspect, uStrength, uScatter;
    uniform vec3 uFog, uCamPos, uAmber;
    uniform vec2 uTanHalfFov;
    uniform mat4 uInvView;
    uniform int uCount;
    uniform vec4 uLights[${MAX_GLOW_LIGHTS}];
    uniform vec3 uLightCols[${MAX_GLOW_LIGHTS}];
    varying vec2 vUv;
    float viewDepth(float d) {
      // 透视深度 [0,1] → 正的视空间距离
      return -( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar );
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float here = uHasDepth > 0.5 ? viewDepth(texture2D(tDepth, vUv).x) : 1e4;
      for (int i = 0; i < ${MAX_GLOW_LIGHTS}; i++) {
        if (i >= uCount) break;
        vec4 L = uLights[i];
        if (L.w <= 0.001) continue;
        vec2 dv = (vUv - L.xy) * vec2(uAspect, 1.0);
        float r2 = dot(dv, dv);
        // 宽晕 + 亮核：雾中 in-scatter 的两段衰减
        float halo = exp(-r2 * 40.0) * 0.4 + exp(-r2 * 240.0) * 0.8;
        float att = clamp(7.0 / L.z, 0.12, 1.6);
        float occ = 1.0;
        if (uHasDepth > 0.5) {
          float atLight = viewDepth(texture2D(tDepth, L.xy).x);
          // 灯本身被几何挡住 → 晕消失；fragment 在灯前面 → 晕不画在它上面
          occ = smoothstep(L.z - 0.8, L.z + 0.3, atLight)
              * mix(0.3, 1.0, smoothstep(L.z - 2.0, L.z + 0.5, here));
        }
        c += uLightCols[i] * halo * att * occ * L.w * uStrength;
        // 解析雾内 in-scatter：视线与「到灯方向」的相位函数 × 该处雾密度 × 距离衰减。
        // 只在有雾且灯在视野内时贡献，夜晚湿空气里灯/火盆周围出现体积光柱感。
        if (uScatter > 0.001) {
          vec3 vp = vec3((vUv * 2.0 - 1.0) * uTanHalfFov * here, -here);
          vec3 lp = vec3((L.xy * 2.0 - 1.0) * uTanHalfFov * L.z, -L.z);
          vec3 toL = lp - vp;
          float dist = length(toL);
          toL /= max(dist, 1e-4);
          float wy = (uInvView * vec4(vp, 1.0)).y;
          float fogAmt = 1.0 - exp(-uFog.x * here * exp(-uFog.y * max(wy - uFog.z, 0.0)));
          float phase = 0.3 + 0.7 * pow(clamp(dot(normalize(vp), toL), 0.0, 1.0), 6.0);
          float att2 = 1.0 / (1.0 + dist * dist * 0.08);
          vec3 fireCol = mix(uLightCols[i], uAmber, 0.6);
          c += fireCol * (uScatter * L.w * phase * fogAmt * att2 * occ);
        }
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};