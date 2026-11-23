// 后期管线（LGT-05…08）：从 view.ts 拆出，便于与 camera/landmarks 代理合并。
// cinematic = SSR + GTAO + 光晕/雾内散射 + 泛光 + 输出 + LUT + 暗角颗粒 + 固定机位远景轻虚化；
// high = 无 SSR；low 不走 composer（view 直出）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import type { Quality } from '../view';
import { LightGlowShader, MAX_GLOW_LIGHTS } from './glow';
import { FarSoftShader } from './farsoft';
import { fillLUT, makeLUT, GradeParams, FilmOutputShader } from './grade';
import { configureWetReflections } from './wetReflections';

export interface PostHooks {
  /** SSR 反射接收面（地面/积水） */
  ground(): THREE.Mesh[];
  /** 透明大气物体：GTAO 预 pass 期间隐藏，避免假深度 */
  atmo(): THREE.Object3D[];
  /** 参与屏幕空间光晕/散射的点光源 */
  lights(): THREE.PointLight[];
}

export interface PostRig {
  bloom: number; vignette: number; grain: number;
  glowStrength: number; scatter: number; ssrWet: number;
  fog: [number, number, number];
  mistColor: number; hazeColor: number; airForward: number;
  keyDir: [number, number, number];
  grade: GradeParams;
  /** 受击暗角强度 0..1（vfx.hurt） */
  hurt: number;
  /** 高光滚降阈值/膝部（HDR 亮度，色调映射前；冷/暖分开） */
  hiThresh: number; hiKneeCool: number; hiKneeWarm: number;
}

const DEFAULT_GRADE: GradeParams = { sat: 0.9, contrast: 1.05, tintS: 0x2a3640, tintH: 0xfff0d8 };

export class PostPipeline {
  readonly lut = makeLUT(32);
  private composer: EffectComposer | null = null;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  private gtao!: GTAOPass;
  private ssr: SSRPass | null = null;
  private glow!: ShaderPass;
  private farSoft!: ShaderPass;
  private quality: Quality = 'cinematic';
  private lastSig = '';
  private glowV = new THREE.Vector3();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private hooks: PostHooks,
  ) {
    fillLUT(this.lut, DEFAULT_GRADE);
    this.build();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.build();
  }

  resize(w: number, h: number, pixelRatio: number): void {
    this.composer?.setPixelRatio(pixelRatio);
    this.composer?.setSize(w, h);
  }

  /** 固定机位/标题才开远景轻虚化；游戏越肩镜头保持锐利。focus 为构图焦点距离。 */
  setDof(on: boolean, focus: number): void {
    if (!this.composer) return;
    this.farSoft.enabled = on;
    if (on) {
      const u = this.farSoft.uniforms;
      u.uStart.value = focus * 1.7;
      u.uEnd.value = focus * 3.4;
    }
  }

  applyRig(r: PostRig): void {
    if (!this.composer) return;
    this.bloom.strength = r.bloom;
    const gu = this.grade.uniforms;
    gu.uVig.value = r.vignette; gu.uGrain.value = r.grain; gu.uHurt.value = r.hurt;
    const glu = this.glow.uniforms;
    glu.uStrength.value = r.glowStrength;
    glu.uScatter.value = r.scatter;
    glu.uGroundAir.value.setHex(r.mistColor);
    glu.uAirColor.value.setHex(r.hazeColor);
    glu.uKeyAir.value = r.airForward;
    glu.uKeyDir.value.set(...r.keyDir).normalize();
    glu.uHiThresh.value = r.hiThresh;
    glu.uHiKneeCool.value = r.hiKneeCool;
    glu.uHiKneeWarm.value = r.hiKneeWarm;
    glu.uFog.value.set(r.fog[0], r.fog[1], r.fog[2]);
    if (this.ssr) this.ssr.opacity = r.ssrWet;
    const g = r.grade;
    const sig = `${g.sat.toFixed(3)}|${g.contrast.toFixed(3)}|${g.tintS}|${g.tintH}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      fillLUT(this.lut, g);
    }
  }

  render(time: number): void {
    if (!this.composer) return;
    this.grade.uniforms.uTime.value = time;
    this.glow.uniforms.uAirTime.value = time;
    this.updateGlowLights();
    this.composer.render();
  }

  private build(): void {
    if (this.composer) {
      for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
      this.composer.dispose();
    }
    this.composer = null;
    this.ssr = null;
    if (this.quality === 'low') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const cinematic = this.quality === 'cinematic';
    // SSR owns the multisampled beauty buffer. Post-only ping-pong needs neither MSAA nor depth.
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: cinematic ? 0 : 4, depthBuffer: !cinematic,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    let gBuffer: { depthTexture: THREE.DepthTexture; normalTexture: THREE.Texture } | undefined;
    if (cinematic) {
      // SSR 自带 beauty 渲染，放在链首替代 RenderPass；只让地面/积水接收反射
      const pools = this.hooks.ground().filter((mesh) => !Array.isArray(mesh.material) && mesh.material.userData.aw?.uAwPool?.value > 0);
      this.ssr = new SSRPass({ renderer: this.renderer, scene: this.scene, camera: this.camera, width: size.x, height: size.y, selects: pools, groundReflector: null });
      this.ssr.beautyRenderTarget.samples = 4;
      this.ssr.opacity = 0.25;
      this.ssr.maxDistance = 8;
      this.ssr.thickness = 0.08;
      this.ssr.fresnel = true;
      this.ssr.distanceAttenuation = true;
      this.ssr.blur = true;
      configureWetReflections(this.ssr, this.camera);
      // Share the SSR normal prepass with GTAO and the atmospheric depth composite. Use
      // depth from that same opaque pass, not the lower-precision SSR beauty depth.
      // Three r187's normal-pass hook is internal; keep the dependency isolated here.
      const ssr = this.ssr as SSRPass & {
        normalMaterial: THREE.MeshNormalMaterial;
        normalRenderTarget: THREE.WebGLRenderTarget;
        _renderOverride: (renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget, clearColor: number, clearAlpha: number) => void;
      };
      const depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      ssr.normalRenderTarget.depthTexture = depthTexture;
      gBuffer = { depthTexture, normalTexture: ssr.normalRenderTarget.texture };
      const renderOverride = ssr._renderOverride.bind(ssr);
      ssr._renderOverride = (renderer, material, target, clearColor, clearAlpha) => {
        const render = () => renderOverride(renderer, material, target, clearColor, clearAlpha);
        if (material === ssr.normalMaterial) this.withoutAtmo(render);
        else render();
      };
      this.composer.addPass(ssr);
    } else {
      this.composer.addPass(new RenderPass(this.scene, this.camera));
    }
    // GTAO：墙脚/门洞/陈设底部接触阴影（半径收紧、强度提高）
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y, gBuffer);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.82;
    this.gtao.updateGtaoMaterial({ radius: 0.36, distanceExponent: 1, thickness: 1, scale: 1.25, samples: cinematic ? 16 : 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: cinematic ? 8 : 6 });
    if (!gBuffer) {
      const render = this.gtao.render.bind(this.gtao);
      this.gtao.render = (...args) => this.withoutAtmo(() => render(...args));
    }
    this.composer.addPass(this.gtao);
    this.glow = new ShaderPass(LightGlowShader);
    this.composer.addPass(this.glow);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.23, 0.3, 1.10);
    // Restrict bloom to high-luminance warm emitters (day sky, moon and neutral wet stone
    // are not light sources). Point-source air scattering is handled separately above.
    const bright = this.bloom.materialHighPassFilter;
    bright.fragmentShader = bright.fragmentShader.replace('gl_FragColor = mix',
      'alpha *= smoothstep(0.10, 0.43, (texel.r - texel.b) / max(v, 1e-4));\n gl_FragColor = mix');
    if (!cinematic) {
      const setSize = this.bloom.setSize.bind(this.bloom);
      this.bloom.setSize = (w, h) => setSize(Math.max(2, Math.round(w * 0.64)), Math.max(2, Math.round(h * 0.64)));
    }
    this.composer.addPass(this.bloom);
    this.farSoft = new ShaderPass(FarSoftShader);
    this.farSoft.enabled = false;
    this.composer.addPass(this.farSoft);
    this.grade = new ShaderPass(FilmOutputShader);
    this.grade.uniforms.uLut.value = this.lut;
    this.grade.uniforms.uLutSize.value = this.lut.image.width;
    this.composer.addPass(this.grade);
  }

  private withoutAtmo(render: () => void): void {
    const hidden: THREE.Object3D[] = [];
    for (const o of this.hooks.atmo()) if (o.visible) { o.visible = false; hidden.push(o); }
    try { render(); } finally { for (const o of hidden) o.visible = true; }
  }

  /** 把点光源投影到屏幕，供光晕 pass 做深度遮挡散射与雾内 in-scatter。 */
  private updateGlowLights(): void {
    const u = this.glow.uniforms;
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    let n = 0;
    for (const L of this.hooks.lights()) {
      if (n >= MAX_GLOW_LIGHTS) break;
      if (L.intensity <= 0.05) continue;
      const v = this.glowV;
      L.getWorldPosition(v);
      v.applyMatrix4(this.camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth < 0.2) continue;
      v.applyMatrix4(this.camera.projectionMatrix);
      const x = v.x * 0.5 + 0.5, y = v.y * 0.5 + 0.5;
      // Depth only verifies visibility for onscreen emitters. Fade gracefully at the screen edge.
      const edge = Math.min(x, y, 1 - x, 1 - y);
      if (edge <= 0) continue;
      const flux = Math.min(L.intensity, 45) * THREE.MathUtils.smoothstep(edge, 0, 0.035);
      (u.uLights.value as THREE.Vector4[])[n].set(x, y, depth, flux);
      (u.uLightRadius.value as number[])[n] = L.distance > 0 ? Math.min(4.6, L.distance * 0.3) : 4.6;
      (u.uLightCols.value as THREE.Color[])[n].copy(L.color);
      n++;
    }
    u.uCount.value = n;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    u.uAspect.value = this.camera.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    (u.uTanHalfFov.value as THREE.Vector2).set(tanHalf * this.camera.aspect, tanHalf);
    (u.uInvView.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    const depth = this.gtao.depthTexture;
    u.tDepth.value = depth ?? null;
    u.uHasDepth.value = depth ? 1 : 0;
    const fu = this.farSoft.uniforms;
    fu.tDepth.value = depth ?? null;
    fu.uHasDepth.value = depth ? 1 : 0;
    fu.uNear.value = this.camera.near; fu.uFar.value = this.camera.far;
    fu.uAspect.value = this.camera.aspect;
  }
}