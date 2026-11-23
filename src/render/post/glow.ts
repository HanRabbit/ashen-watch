// 灯光散射（LGT-07）：屏幕空间体积光晕。把主要点光源（壁灯/提灯/火盆/炉火窗）投影到屏幕，
// 按深度遮挡做径向 in-scatter 近似：灯被墙挡住时晕消失，灯在湿夜空气里拉出琥珀光晕。
// 深度复用 GTAOPass 的深度纹理，不额外渲染一遍场景。
import * as THREE from 'three';
import { AIR_VOLUME_GLSL } from './airVolume';

export const MAX_GLOW_LIGHTS = 6;

export const LightGlowShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uLights: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLightCols: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uLightRadius: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => 0) },
    uCount: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 320 },
    uAspect: { value: 1 }, uStrength: { value: 0.5 },
    // 雾内 in-scatter（解析近似）：uFog = (heightDensity, falloff, base)
    uAirColor: { value: new THREE.Color() }, uGroundAir: { value: new THREE.Color() }, uAirTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyAir: { value: 0 },
    uScatter: { value: 0.4 }, uFog: { value: new THREE.Vector3(0.012, 0.1, 0) },
    uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    uInvView: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    // 高光压缩（色调映射前）：超过阈值的亮度按色相区分滚降——
    // 暖色（灯火/火）保留亮琥珀长条，冷色（月光镜面）压成弱而柔的蓝反射。
    // 天空像素（深度≈far）豁免，月盘/光晕本身可以亮。
    uHiThresh: { value: 3.0 }, uHiKneeCool: { value: 0.6 }, uHiKneeWarm: { value: 0.25 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uHasDepth, uNear, uFar, uAspect, uStrength, uScatter, uHiThresh, uHiKneeCool, uHiKneeWarm;
    uniform float uAirTime, uKeyAir;
    uniform vec3 uFog, uCamPos, uAirColor, uGroundAir, uKeyDir;
    uniform vec2 uTanHalfFov;
    uniform mat4 uInvView;
    uniform int uCount;
    uniform vec4 uLights[${MAX_GLOW_LIGHTS}];
    uniform vec3 uLightCols[${MAX_GLOW_LIGHTS}];
    uniform float uLightRadius[${MAX_GLOW_LIGHTS}];
    varying vec2 vUv;
    float viewDepth(float d) {
      // 透视深度 [0,1] → 正的视空间距离
      return -( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar );
    }
    ${AIR_VOLUME_GLSL}
    // Integrate a finite, softened inverse-square point light along the visible ray.
    // A surface endpoint far past the emitter (including sky) still sees the lit air in front of it.
    float pointScatter(vec3 ray, float rayEnd, vec3 lightPos, float radius, vec3 worldRay) {
      float along = dot(ray, lightPos);
      vec3 offset = lightPos - ray * along;
      float perpendicular2 = dot(offset, offset);
      float reach2 = radius * radius - perpendicular2;
      if (reach2 <= 0.0) return 0.0;
      float reach = sqrt(reach2);
      float a = max(0.0, along - reach), b = min(rayEnd, along + reach);
      if (b <= a) return 0.0;

      const float core = 0.42; // metres; a finite emitter avoids a singularity on its centre ray
      float invD = inversesqrt(perpendicular2 + core * core);
      // Integral of 1 / (distance² + core²), minus the boundary value, so the volume fades out.
      float integral = invD * (atan((b - along) * invD) - atan((a - along) * invD))
                     - (b - a) / (radius * radius + core * core);
      float center = clamp(along, a, b);
      // Approximate phase at the midpoint of the *visible scattering contribution*.
      float delta = along - mix(center, (a + b) * 0.5, 0.45);
      float cosTheta = delta * inversesqrt(perpendicular2 + delta * delta + core * core);
      const float g = 0.42;
      float phase = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
      vec3 world = uCamPos + worldRay * center;
      // A hearth can light a little indoor dust even with almost no incoming courtyard mist.
      float shelter = 1.0 - 0.58 * awAirShelter(world);
      float height = max(world.y - uFog.z, 0.0);
      vec2 localDensity = max(uFog.xy, vec2(0.0)) * exp(-AW_FALLOFF * height);
      float density = shelter * (localDensity.x + localDensity.y + 0.003);
      return max(0.0, integral) * density * phase;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float here = uHasDepth > 0.5 ? viewDepth(texture2D(tDepth, vUv).x) : uFar;
      vec3 viewRay = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
      float rayEnd = here / -viewRay.z;
      vec3 worldRay = (uInvView * vec4(viewRay, 0.0)).xyz;
      if (uHasDepth > 0.5) c = awAtmosphere(c, uCamPos, worldRay, rayEnd);
      for (int i = 0; i < ${MAX_GLOW_LIGHTS}; i++) {
        if (i >= uCount) break;
        vec4 L = uLights[i];
        vec2 dv = (vUv - L.xy) * vec2(uAspect, 1.0);
        float r2 = dot(dv, dv);
        float occ = 1.0;
        if (uHasDepth > 0.5) {
          float atLight = viewDepth(texture2D(tDepth, L.xy).x);
          // A fixture may cover the precise light centre; a solid wall further in front hides it.
          occ = smoothstep(L.z - 0.44, L.z - 0.06, atLight);
        }
        if (occ < 0.001) continue;
        // Tight optical halo. Wider falloff comes from the world-space volume, not a screen decal.
        float halo = exp(-r2 * 830.0) * 0.48 + exp(-r2 * 4500.0) * 0.7;
        float att = clamp(4.0 / L.z, 0.14, 1.6);
        float foreground = smoothstep(L.z - 0.56, L.z - 0.08, here);
        c += uLightCols[i] * halo * att * occ * foreground * min(1.0, L.w / 22.0) * uStrength;
        if (uScatter > 0.001 && uHasDepth > 0.5) {
          vec3 lightPos = vec3((L.xy * 2.0 - 1.0) * uTanHalfFov * L.z, -L.z);
          float haze = pointScatter(viewRay, rayEnd, lightPos, uLightRadius[i], worldRay);
          c += uLightCols[i] * (uScatter * L.w * haze * occ);
        }
      }
      // 高光滚降：保色相压缩超阈值亮度（能量守恒软钳制，随后才进 ACES）。
      // 天空（月盘/云/晕）豁免；几何上的暖高光保留、冷镜面压柔。
      bool isSky = uHasDepth > 0.5 && here >= uFar * 0.999;
      if (!isSky) {
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float warmth = clamp((c.r - c.b) / max(luma, 1e-3), -1.0, 1.0);
        float knee = mix(uHiKneeCool, uHiKneeWarm, smoothstep(-0.1, 0.25, warmth));
        float over = max(luma - uHiThresh, 0.0);
        c *= 1.0 / (1.0 + over * knee);
      }
      // NaN/Inf 防护：材质视差/法线在石缝陡梯度处可能产生 NaN，穿透一切 clamp 形成白线；
      // 这里钳制为 0（暗缝），保证画面无花屏（圣经验收：无 NaN 花屏）。ES1 兼容写法。
      c = vec3(
        c.r >= 0.0 ? min(c.r, 60000.0) : 0.0,
        c.g >= 0.0 ? min(c.g, 60000.0) : 0.0,
        c.b >= 0.0 ? min(c.b, 60000.0) : 0.0);
      gl_FragColor = vec4(c, 1.0);
    }`,
};