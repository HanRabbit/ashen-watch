// HDR weather, local light transport and optical halo share the existing opaque-depth pass.
import * as THREE from 'three';
import { AIR_OCCLUSION_GLSL, AIR_VOLUME_GLSL } from './airVolume';
import { GATHER_VOLUME_GLSL } from './shadowVolume';

export const MAX_GLOW_LIGHTS = 6;

export const LightGlowShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tVolume: { value: null as THREE.Texture | null }, uHasVolume: { value: 0 },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uLights: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLightCols: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uLightRadius: { value: Array.from({ length: MAX_GLOW_LIGHTS }, () => 0) },
    uCount: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 320 },
    uAspect: { value: 1 }, uStrength: { value: 0.5 },
    // uFog = (damp ground extinction, free-air extinction, height datum)
    uAirColor: { value: new THREE.Color() }, uGroundAir: { value: new THREE.Color() }, uAirTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyAir: { value: 0 },
    uAirDoors: { value: new THREE.Vector2() },
    uScatter: { value: 0.4 }, uFog: { value: new THREE.Vector3(0.025, 0.008, 0.1) },
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
    uniform sampler2D tDiffuse, tDepth, tVolume;
    uniform float uHasVolume;
    uniform float uHasDepth, uNear, uFar, uAspect, uStrength, uScatter, uHiThresh, uHiKneeCool, uHiKneeWarm;
    uniform float uAirTime;
    uniform vec3 uFog, uCamPos, uAirColor, uGroundAir;
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
    ${AIR_OCCLUSION_GLSL}
    ${GATHER_VOLUME_GLSL}
    vec2 projectView(vec3 p) {
      return 0.5 + 0.5 * p.xy / (-p.z * uTanHalfFov);
    }
    float depthAt(vec2 uv) { return viewDepth(texture2D(tDepth, uv).x); }
    float sourceVisibility(vec4 light, float atCenter, vec2 fromLight) {
      // Depth is authoritative for solid occluders. Only probe beside the source in the
      // last few decimetres, where a lamp's own cap, bracket or cames can hide its centre.
      float center = smoothstep(light.z - 0.16, light.z - 0.04, atCenter);
      if (center >= 1.0 || atCenter <= light.z - 0.24) return center;
      vec2 side = vec2(-fromLight.y, fromLight.x) + vec2(1e-4, 0.0);
      side /= max(length(side), 1e-5);
      vec2 px = 1.0 / vec2(textureSize(tDepth, 0));
      vec2 offset = side * clamp(vec2(0.047) / (light.z * uTanHalfFov), px, 3.0 * px);
      float sideA = smoothstep(light.z - 0.12, light.z - 0.03, depthAt(light.xy + offset));
      float sideB = smoothstep(light.z - 0.12, light.z - 0.03, depthAt(light.xy - offset));
      float fixture = 0.5 * (sideA + sideB) * smoothstep(light.z - 0.24, light.z - 0.13, atCenter);
      return mix(center, 1.0, 0.48 * fixture);
    }
    float legDepth(vec3 lightPos, vec3 airPos) {
      // Camera depth adds movable occluders and small meshes to the world barriers.
      // A blocked tap vetoes this sample. A single view cannot recover hidden light paths.
      vec3 a = mix(lightPos, airPos, 0.33), b = mix(lightPos, airPos, 0.67);
      float da = depthAt(projectView(a)) + a.z;
      float db = depthAt(projectView(b)) + b.z;
      return smoothstep(-0.12, 0.015, min(da, db));
    }
    float scatterSample(vec3 ray, vec3 lightPos, vec3 worldLight, vec3 worldRay, float sampleT,
                        float along, float perpendicular2, float transmission) {
      vec3 world = uCamPos + worldRay * sampleT;
      if (awLightLeg(worldLight, world) == 0.0) return 0.0;
      float visibility = legDepth(lightPos, ray*sampleT);
      if (visibility <= 0.0) return 0.0;
      float delta = along-sampleT;
      float cosTheta = delta*inversesqrt(perpendicular2 + delta*delta + 0.16);
      const float g = 0.34;
      float phaseDenom = 1.0 + g*g - 2.0*g*cosTheta;
      float phase = 0.0704 / (phaseDenom*sqrt(phaseDenom));
      float height = max(world.y-uFog.z,0.0);
      vec2 density = uFog.xy*exp(-AW_FALLOFF*height);
      // A small amount of indoor particulate is visible to a real local light.
      // It contributes nothing when the light-to-air leg is blocked.
      float medium = (1.0-awAirShelter(world))*(density.x*awDampPatch(world,uAirTime)+density.y)+0.007;
      float airT = mix(1.0,transmission,clamp(sampleT/AW_WEATHER_REACH,0.0,1.0));
      return medium*phase*airT*visibility;
    }
    float pointScatter(vec3 ray, vec3 lightPos, vec3 worldLight, vec2 interval, vec2 sphere, vec3 worldRay, float transmission) {
      // Split the softened inverse-square integral into two equal-weight
      // angular strata. Test the light leg independently in each stratum.
      float along = sphere.x, perpendicular2 = sphere.y;
      float invD = inversesqrt(perpendicular2 + 0.16); // 0.40 m light core
      vec2 angles = atan((interval-along)*invD);
      float a = along+tan(mix(angles.x,angles.y,0.25))/invD;
      float b = along+tan(mix(angles.x,angles.y,0.75))/invD;
      float s0 = scatterSample(ray,lightPos,worldLight,worldRay,a,along,perpendicular2,transmission);
      float s1 = scatterSample(ray,lightPos,worldLight,worldRay,b,along,perpendicular2,transmission);
      return 0.5*invD*(angles.y-angles.x)*(s0+s1);
    }
    const vec3 AW_LUMA = vec3(0.2126, 0.7152, 0.0722);
    float awRolloff(float luma, float threshold, float knee) {
      float over = max(luma - threshold, 0.0);
      return luma - over + over / (1.0 + over * knee);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      bool hasDepth = uHasDepth > 0.5;
      float depth = hasDepth ? texture2D(tDepth, vUv).x : 1.0;
      bool isSky = hasDepth && depth >= 1.0;
      float here = isSky || !hasDepth ? uFar : viewDepth(depth);
      vec3 viewRay = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
      float rayEnd = here / -viewRay.z;
      vec3 worldRay = (uInvView * vec4(viewRay, 0.0)).xyz;
      float transmission = 1.0;
      if (hasDepth) {
        float confidence=0.; vec4 volume=vec4(0.,0.,0.,1.);
        if(uHasVolume>.5) volume=awResolveVolume(here,isSky,confidence);
        vec3 resolved=c*volume.a+volume.rgb;
        if(confidence<1.) {
          // Do not synthesize window shafts without trustworthy opaque-depth
          // neighbours and a live key shadow map. The fallback is base air only.
          vec3 fallback=awAtmosphere(c,uCamPos,worldRay,rayEnd,isSky,transmission);
          resolved=mix(fallback,resolved,confidence);
        }
        transmission=mix(transmission,volume.a,confidence);
        c=resolved;
      }

      // Compress *excess* luminance, not the whole pixel. Wet cold glints stay ordered,
      // the actual moon (clear depth) is exempt, and local air is added after this shoulder.
      if (!isSky) {
        float luma = dot(c, AW_LUMA);
        if (luma > uHiThresh) {
          float warmth = (c.r - c.b) / luma;
          float knee = mix(uHiKneeCool, uHiKneeWarm, smoothstep(-0.1, 0.25, warmth));
          c *= awRolloff(luma, uHiThresh, knee) / luma;
        }
      }
      for (int i = 0; i < ${MAX_GLOW_LIGHTS}; i++) {
        if (!hasDepth) break;
        if (i >= uCount) break;
        vec4 L = uLights[i];
        if (L.w < 1e-4) continue;
        vec2 dv = (vUv - L.xy) * vec2(uAspect, 1.0);
        float r2 = dot(dv, dv);
        vec3 lightPos = vec3((L.xy * 2.0 - 1.0) * uTanHalfFov * L.z, -L.z);
        float along = dot(viewRay, lightPos);
        vec3 offset = lightPos - viewRay * along;
        float perpendicular2 = dot(offset, offset);
        float radius2 = uLightRadius[i] * uLightRadius[i];
        // Broad lighting follows world metres, not screen UV. Restrict depth fetches to
        // rays that can see a lit interval or the very tight optical halo.
        vec2 interval = vec2(0.0);
        if (uScatter > 0.001 && perpendicular2 < radius2) {
          float span = sqrt(radius2 - perpendicular2);
          interval = vec2(max(0.0, along - span), min(rayEnd, along + span));
        }
        bool litAir = interval.y > interval.x;
        bool haloVisible = r2 < 0.008 && here > L.z - 0.12 && uStrength > 0.001;
        if (!litAir && !haloVisible) continue;
        float occ = sourceVisibility(L, depthAt(L.xy), dv);
        if (occ < 0.001) continue;
        vec3 worldLight = (uInvView*vec4(lightPos,1.0)).xyz;
        if (awLightLeg(worldLight,uCamPos) == 0.0) continue;
        float radiance = 0.0;
        if (haloVisible) {
          float halo = exp(-r2 * 1050.0) * 0.35 + exp(-r2 * 5200.0) * 0.64;
          halo *= 1.0 - smoothstep(0.005, 0.008, r2);
          float foreground = smoothstep(L.z - 0.12, L.z + 0.01, here);
          vec3 haloPoint = uCamPos + worldRay * (L.z / -viewRay.z);
          float haloLeg = awLightLeg(worldLight,haloPoint);
          radiance += halo * clamp(4.0 / L.z, 0.12, 1.4) * foreground * haloLeg * min(1.0, L.w / 22.0) * uStrength;
        }
        if (litAir) {
          float haze = pointScatter(viewRay, lightPos, worldLight, interval, vec2(along, perpendicular2), worldRay, transmission);
          // Fade the tangential rim of the finite point-light support.
          float reach = 1.0 - perpendicular2 / radius2;
          float edge = smoothstep(0.0, 0.55, reach);
          radiance += uScatter * L.w * haze * edge;
        }
        c += uLightCols[i] * (radiance * occ);
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