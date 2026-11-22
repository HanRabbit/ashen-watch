// 镜面能量钳制（LGT-09）：在 PBR 直接光镜面累加之后、合成 outgoingLight 之前，
// 按色相给 directSpecular 的亮度设上限——冷色（月光）镜面压成弱而柔的反射，
// 暖色（灯火/火盆）保留拉长的琥珀倒影。防止湿石/积水镜面高光过曝成纯白块。
// 与 fog/shadows 同模式：改 ShaderChunk + 共享 uniform，所有内置 PBR 材质自动生效。
// 天空穹顶是自定义 ShaderMaterial，不走此 chunk，月盘/光晕亮度不受影响。
import * as THREE from 'three';

let installed = false;

const SPEC_CAP = /* glsl */`
{
  vec3 awDs = reflectedLight.directSpecular;
  float awDl = dot( awDs, vec3( 0.2126, 0.7152, 0.0722 ) );
  float awDw = clamp( ( awDs.r - awDs.b ) / max( awDl, 1e-3 ), -1.0, 1.0 );
  float awCap = mix( uAwSpecCool, uAwSpecWarm, smoothstep( -0.1, 0.25, awDw ) );
  reflectedLight.directSpecular = awDs * min( 1.0, awCap / max( awDl, 1e-4 ) );
}
`;

export function installSpecularCap(): void {
  if (installed) return;
  installed = true;
  // 声明放全局 scope（lights_pars_begin），钳制块放 main 内（lights_fragment_end）
  THREE.ShaderChunk.lights_pars_begin = 'uniform float uAwSpecCool;\nuniform float uAwSpecWarm;\n' + THREE.ShaderChunk.lights_pars_begin;
  THREE.ShaderChunk.lights_fragment_end = THREE.ShaderChunk.lights_fragment_end + SPEC_CAP;
  const extra: Record<string, THREE.IUniform> = {
    uAwSpecCool: { value: 1.2 },
    uAwSpecWarm: { value: 2.5 },
  };
  // ShaderLib 在模块加载时已 merge 过 uniforms，需补进每个内置着色器（同 fog.ts）。
  for (const shader of Object.values(THREE.ShaderLib)) {
    const u = shader.uniforms as Record<string, THREE.IUniform> | undefined;
    if (u && u.fogColor) Object.assign(u, extra);
  }
}

/** 每帧把冷/暖镜面上限写进已编译材质。 */
export class SpecularCapController {
  private cache = new Map<THREE.Material, Record<string, THREE.IUniform>>();
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {}
  update(cool: number, warm: number): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const props = this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> };
        const pu = props?.uniforms;
        if (!pu || !pu.uAwSpecCool) continue; // 尚未编译或无此 uniform
        // 贴图异步加载会触发重编译、uniforms 换新对象：缓存失效时刷新，避免写旧克隆
        let u = this.cache.get(mat);
        if (u !== pu) { u = pu; this.cache.set(mat, u); }
        u.uAwSpecCool.value = cool;
        u.uAwSpecWarm.value = warm;
      }
    });
  }
}