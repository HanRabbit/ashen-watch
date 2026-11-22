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
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec3 fogRay = vFogWorldPos - cameraPosition;
  float fogDist = length( fogRay );
  vec3 fogDir = fogRay / max( fogDist, 1e-4 );
  // 距离雾：near..far 线性过渡，distMax 控制最浓处（白天远景留一点轮廓）
  float distFog = smoothstep( fogNear, fogFar, fogDist ) * fogDistMax;
  // 高度雾：密度 = heightDensity * exp(-falloff * (y - base))，沿视线解析积分
  float fb = max( fogHeightFalloff, 1e-4 );
  float cy = cameraPosition.y - fogHeightBase;
  float ft = fb * fogDir.y * fogDist;
  float atten = exp( - fb * cy );
  float integ = abs( ft ) < 1e-3 ? atten : atten * ( 1.0 - exp( - ft ) ) / ft;
  float heightFog = 1.0 - exp( - fogHeightDensity * fogDist * integ );
  float fogFactor = clamp( 1.0 - ( 1.0 - distFog ) * ( 1.0 - heightFog ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

  // 额外 uniform 并入内置材质的 fog uniform 组；渲染器只刷新 fogColor/Near/Far，
  // 其余由 FogController 每帧通过 renderer.properties 写入（见下）。
  const lib = THREE.UniformsLib.fog as unknown as Record<string, THREE.IUniform>;
  lib.fogHeightDensity = { value: 0 };
  lib.fogHeightFalloff = { value: 0.1 };
  lib.fogHeightBase = { value: 0 };
  lib.fogDistMax = { value: 1 };
}

/** 每帧把高度雾参数写进场景里所有已编译材质的 uniform。 */
export class FogController {
  private cache = new Map<THREE.Material, Record<string, THREE.IUniform>>();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {}

  update(p: FogParams): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        let u = this.cache.get(mat);
        if (!u) {
          const props = this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> };
          const pu = props?.uniforms;
          if (!pu || !pu.fogHeightDensity) continue; // 尚未编译或无雾（ShaderMaterial 自带 uniforms）
          u = pu;
          this.cache.set(mat, u);
        }
        u.fogHeightDensity.value = p.heightDensity;
        u.fogHeightFalloff.value = p.heightFalloff;
        u.fogHeightBase.value = p.heightBase;
        u.fogDistMax.value = p.distMax;
      }
    });
  }
}