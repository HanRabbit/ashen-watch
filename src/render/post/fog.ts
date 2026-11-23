import { HEIGHT_COLUMN_GLSL } from './airVolume';
// 全局雾（LGT-03）：把 three 内置线性雾替换为「高度雾 + 距离雾」，用世界坐标计算。
// 直接改 ShaderChunk，所有内置材质（含 onBeforeCompile 的材质）自动生效，不与材质代理冲突。
// 高度雾沿视线做指数衰减的解析积分：贴地浓、高处薄，远景城堡被分层雾吞掉一半。
import * as THREE from 'three';

export interface FogParams {
  heightDensity: number; heightFalloff: number; heightBase: number; distMax: number;
}

let installed = false;

export function installHeightFog(): void {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

  // mvPosition 在标准/点/精灵顶点着色器的 fog_vertex 处都在作用域内；
  // viewMatrix 的逆把视空间位置还原到世界空间（WebGL2 / GLSL ES 3.0）。
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = ( inverse( viewMatrix ) * mvPosition ).xyz;
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform float fogHeightDensity;
  uniform float fogHeightFalloff;
  uniform float fogHeightBase;
  uniform float fogDistMax;
${HEIGHT_COLUMN_GLSL}
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec3 fogRay = vFogWorldPos - cameraPosition;
  float fogDist = length( fogRay );
  vec3 fogDir = fogRay / max( fogDist, 1e-4 );
  // 距离雾：near..far 线性过渡，distMax 控制最浓处（白天远景留一点轮廓）
  float distFog = smoothstep( fogNear, fogFar, fogDist ) * fogDistMax;
  // Low tier: inexpensive sheltered path estimate. No camera-level fog/exposure switch.
  float heightFog = 0.0;
  if (fogHeightDensity > 0.0) {
    float end = min(64.0, fogDist);
    vec3 mid = cameraPosition + fogDir * (end * 0.5);
    float shelter = 1.0 - (0.25 * awAirShelter(cameraPosition) + 0.5 * awAirShelter(mid)
                         + 0.25 * awAirShelter(cameraPosition + fogDir * end));
    vec2 column = awHeightColumn(cameraPosition, fogDir, vec2(0.0, end), vec2(fogHeightFalloff, 0.105), fogHeightBase);
    heightFog = 1.0 - exp(-shelter * fogHeightDensity * dot(column, vec2(1.0, 0.33)));
  }
  float fogFactor = clamp( 1.0 - ( 1.0 - distFog ) * ( 1.0 - heightFog ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

  // 额外 uniform 并入 fog uniform 组。注意 ShaderLib 在 three 模块加载时就已经 merge 过
  // UniformsLib.fog，只改 UniformsLib 不会生效：必须同时补进每个内置着色器的 uniforms。
  const extra: Record<string, THREE.IUniform> = {
    fogHeightDensity: { value: 0 },
    fogHeightFalloff: { value: 0.1 },
    fogHeightBase: { value: 0 },
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
