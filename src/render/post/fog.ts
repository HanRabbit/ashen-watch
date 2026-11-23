import * as THREE from 'three';
import { DAMP_FALLOFF, HEIGHT_COLUMN_GLSL, WEATHER_BASE } from './airVolume';

// Ordinary distance fog is the far segment. Only direct rendering (low) also
// estimates the near weather segment in the surface shader.
export interface FogParams {
  heightDensity: number; freeDensity: number; heightFalloff: number; heightBase: number; distMax: number;
}

let installed = false;

export function installHeightFog(): void {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;

  // mvPosition 在标准/点/精灵顶点着色器的 fog_vertex 处都在作用域内；
  // viewMatrix 的逆把视空间位置还原到世界空间（WebGL2 / GLSL ES 3.0）。
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogWorldPos = ( inverse( viewMatrix ) * mvPosition ).xyz;
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform float fogHeightDensity;
  uniform float fogFreeDensity;
  uniform float fogHeightFalloff;
  uniform float fogHeightBase;
  uniform float fogDistMax;
${HEIGHT_COLUMN_GLSL}
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec3 fogRay = vFogWorldPos - cameraPosition;
  float fogDist = length( fogRay );
  #ifdef FOG_EXP2
    float farLeg = max(0.0, fogDist - AW_WEATHER_REACH) * fogDensity;
    float distFog = (1.0 - exp(-farLeg * farLeg)) * fogDistMax;
  #else
    float farStart = max(fogNear, AW_WEATHER_REACH);
    float distFog = smoothstep(farStart, max(farStart + 1e-3, fogFar), fogDist) * fogDistMax;
  #endif
  // Low tier: inexpensive sheltered path estimate. No camera-level fog/exposure switch.
  float heightFog = 0.0;
  if (fogHeightDensity + fogFreeDensity > 0.0) {
    float end = min(AW_WEATHER_REACH, fogDist);
    vec3 fogDir = fogRay / max(fogDist, 1e-4);
    // Interior/outdoor transition depends on the length of visible air on each side.
    float shelter = 1.0 - (awAirShelter(cameraPosition + fogDir * (end * 0.18))
                         + awAirShelter(cameraPosition + fogDir * (end * 0.50))
                         + awAirShelter(cameraPosition + fogDir * (end * 0.82))) / 3.0;
    vec2 column = awHeightColumn(cameraPosition, fogDir, vec2(0.0, end), vec2(fogHeightFalloff, AW_FALLOFF.y), fogHeightBase);
    float tau = shelter * awNearWeather(end) * dot(column, vec2(fogHeightDensity, fogFreeDensity));
    heightFog = 1.0 - exp(-tau);
  }
  float fogFactor = clamp( 1.0 - ( 1.0 - distFog ) * ( 1.0 - heightFog ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

  // 额外 uniform 并入 fog uniform 组。注意 ShaderLib 在 three 模块加载时就已经 merge 过
  // UniformsLib.fog，只改 UniformsLib 不会生效：必须同时补进每个内置着色器的 uniforms。
  const extra: Record<string, THREE.IUniform> = {
    fogHeightDensity: { value: 0 },
    fogFreeDensity: { value: 0 },
    fogHeightFalloff: { value: DAMP_FALLOFF },
    fogHeightBase: { value: WEATHER_BASE },
    fogDistMax: { value: 1 },
  };
  const lib = THREE.UniformsLib.fog as unknown as Record<string, THREE.IUniform>;
  Object.assign(lib, extra);
  for (const shader of Object.values(THREE.ShaderLib)) {
    const u = shader.uniforms as Record<string, THREE.IUniform> | undefined;
    if (u && u.fogColor) Object.assign(u, extra);
  }
}

/** Update shared lighting uniforms in one traversal, once per compiled uniform set. */
export class FogController {
  private seen = new Set<THREE.Material>();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {}

  update(p: FogParams, portal: THREE.Vector2, sky: THREE.Color, cool: number, warm: number): void {
    this.seen.clear();
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (Array.isArray(mat)) {
        for (const m of mat) this.updateMaterial(m, p, portal, sky, cool, warm);
      } else if (mat) this.updateMaterial(mat, p, portal, sky, cool, warm);
    });
  }

  private updateMaterial(mat: THREE.Material, p: FogParams, portal: THREE.Vector2, sky: THREE.Color, cool: number, warm: number): void {
    if (this.seen.has(mat)) return;
    this.seen.add(mat);
    const { uniforms: u } = this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> };
    if (!u) return;
    if (u.fogHeightDensity) {
      u.fogHeightDensity.value = p.heightDensity;
      u.fogFreeDensity.value = p.freeDensity;
      u.fogHeightFalloff.value = p.heightFalloff;
      u.fogHeightBase.value = p.heightBase;
      u.fogDistMax.value = p.distMax;
    }
    if (u.uAwPortal) {
      u.uAwPortal.value.copy(portal);
      u.uAwPortalIrradiance.value.copy(sky);
    }
    if (u.uAwSpecCool) {
      u.uAwSpecCool.value = cool;
      u.uAwSpecWarm.value = warm;
    }
  }
}
