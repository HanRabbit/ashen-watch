// 后期管线（LGT-05…08）：从 view.ts 拆出，便于与 camera/landmarks 代理合并。
// cinematic = SSR + GTAO + 光晕/雾内散射 + 泛光 + 输出 + LUT + 暗角颗粒 + 固定机位景深；
// high = 无 SSR、无景深；low 不走 composer（view 直出）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import type { Quality } from '../view';
import { LightGlowShader, MAX_GLOW_LIGHTS } from './glow';
import { fillLUT, makeLUT, GradeParams, VignetteGrainShader } from './grade';

export interface PostHooks {
  /** SSR 反射接收面（地面/积水） */
  ground(): THREE.Mesh[];
  /** 透明大气物体：GTAO/景深预 pass 期间隐藏，避免假深度 */
  atmo(): THREE.Object3D[];
  /** 参与屏幕空间光晕/散射的点光源 */
  lights(): THREE.PointLight[];
}

export interface PostRig {
  bloom: number; vignette: number; grain: number;
  glowStrength: number; scatter: number; ssrWet: number;
  fog: [number, number, number];
  grade: GradeParams;
  /** 受击暗角强度 0..1（vfx.hurt） */
  hurt: number;
}

const DEFAULT_GRADE: GradeParams = { sat: 0.9, contrast: 1.05, tintS: 0x2a3640, tintH: 0xfff0d8 };

export class PostPipeline {
  readonly lut = makeLUT(32);
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  private gtao!: GTAOPass;
  private ssr: SSRPass | null = null;
  private glow!: ShaderPass;
  private lutPass!: LUTPass;
  private dof!: BokehPass;
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
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  /** 固定机位/标题才开景深；游戏越肩镜头保持锐利。 */
  setDof(on: boolean, focus: number): void {
    this.dof.enabled = on;
    if (on) (this.dof.uniforms as Record<string, THREE.IUniform>).focus.value = focus;
  }

  applyRig(r: PostRig): void {
    this.bloom.strength = r.bloom;
    const gu = this.grade.uniforms;
    gu.uVig.value = r.vignette; gu.uGrain.value = r.grain; gu.uHurt.value = r.hurt;
    const glu = this.glow.uniforms;
    glu.uStrength.value = r.glowStrength;
    glu.uScatter.value = r.scatter;
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
    this.grade.uniforms.uTime.value = time;
    this.updateGlowLights();
    this.composer.render();
  }

  private build(): void {
    if (this.composer) {
      for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
      this.composer.dispose();
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // MSAA + HalfFloat：HDR 全程半浮点，边缘抗锯齿
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.ssr = null;
    if (this.quality === 'cinematic') {
      // SSR 自带 beauty 渲染，放在链首替代 RenderPass；只让地面/积水接收反射
      this.ssr = new SSRPass({ renderer: this.renderer, scene: this.scene, camera: this.camera, width: size.x, height: size.y, selects: this.hooks.ground(), groundReflector: null });
      this.ssr.beautyRenderTarget.samples = 4;
      this.ssr.opacity = 0.32;
      this.ssr.maxDistance = 10;
      this.ssr.thickness = 0.05;
      this.ssr.fresnel = true;
      this.ssr.distanceAttenuation = true;
      this.ssr.blur = true;
      this.composer.addPass(this.ssr);
    } else {
      this.composer.addPass(new RenderPass(this.scene, this.camera));
    }
    // GTAO：墙脚/门洞/陈设底部接触阴影（半径收紧、强度提高）
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1.0;
    this.gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1, thickness: 1, scale: 1.4, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    this.hideAtmoDuring(this.gtao);
    this.composer.addPass(this.gtao);
    this.glow = new ShaderPass(LightGlowShader);
    this.composer.addPass(this.glow);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    // 景深：仅固定机位/标题启用（setDof），游戏镜头锐利
    this.dof = new BokehPass(this.scene, this.camera, { focus: 12, aperture: 0.00025, maxblur: 0.0035 });
    this.dof.enabled = false;
    this.hideAtmoDuring(this.dof);
    this.composer.addPass(this.dof);
    this.composer.addPass(new OutputPass());
    this.lutPass = new LUTPass({ lut: this.lut, intensity: 1 });
    this.composer.addPass(this.lutPass);
    this.grade = new ShaderPass(VignetteGrainShader);
    this.composer.addPass(this.grade);
  }

  /** GTAO/景深的深度预 pass 用 override 材质：透明雾团/火舌会写成实体深度，预 pass 期间隐藏。 */
  private hideAtmoDuring(pass: { render: (r: THREE.WebGLRenderer, wb: THREE.WebGLRenderTarget, rb: THREE.WebGLRenderTarget, dt: number, mask: boolean) => void }): void {
    const orig = pass.render.bind(pass);
    pass.render = (renderer, wb, rb, dt, mask) => {
      const hidden: THREE.Object3D[] = [];
      for (const o of this.hooks.atmo()) if (o.visible) { o.visible = false; hidden.push(o); }
      orig(renderer, wb, rb, dt, mask);
      for (const o of hidden) o.visible = true;
    };
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
      if (x < -0.3 || x > 1.3 || y < -0.3 || y > 1.3) continue;
      (u.uLights.value as THREE.Vector4[])[n].set(x, y, depth, Math.min(1, L.intensity / 45));
      (u.uLightCols.value as THREE.Color[])[n].copy(L.color);
      n++;
    }
    for (let i = n; i < MAX_GLOW_LIGHTS; i++) (u.uLights.value as THREE.Vector4[])[i].w = 0;
    u.uCount.value = n;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    u.uAspect.value = this.camera.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    (u.uTanHalfFov.value as THREE.Vector2).set(tanHalf * this.camera.aspect, tanHalf);
    (u.uInvView.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    const depth = (this.gtao as unknown as { depthTexture?: THREE.Texture }).depthTexture;
    u.tDepth.value = depth ?? null;
    u.uHasDepth.value = depth ? 1 : 0;
  }
}