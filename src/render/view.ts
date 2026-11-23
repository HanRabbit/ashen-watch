// 场景视图：渲染器、天空穹顶、图像照明、四套照明（LGT-01，晨曦复用清晨）、后期与越肩镜头。
// 模拟状态只读，网格是它的视图。画质分高/低两档：高档含泛光与调色后期、软阴影、扬尘；低档直出以保帧率。
import * as THREE from 'three';
import { PHASE } from '../config';
import { World } from '../sim/state';
import { CameraRig } from './camera';
import { GhostModels, PlayerModel } from './characters';
import { clamp01, lerp, smooth } from './geom';
import { glowTexture, makeMaterials, setMaterialsQuality } from './materials';
import { Props } from './props';
import { applySky, makeSkyMaterial, SkyState } from './sky';
import { FogController, installHeightFog } from './post/fog';
import { DAMP_FALLOFF, WEATHER_BASE, WEATHER_REACH } from './post/airVolume';
import { PostPipeline } from './post/pipeline';
import { installSoftShadows } from './post/shadows';
import { installSpecularCap } from './post/specular';
import { buildLandmarks, hideLegacy } from './landmarks';
import { buildScenery } from './scenery';
import { buildStaticLevel, StaticLevel } from './staticLevel';
import { buildFloors, hideGroundHoles } from './floors'; // map:
import { Vfx } from './vfx';
import { installSkyExposure } from './skyExposure';
import { stageSkyExposureSources } from './skyExposureSources';
import { installGlassCaustics, type GlassCaustics } from './glassCaustics';

installHeightFog();
installSoftShadows();
installSpecularCap();
installSkyExposure();

export type Quality = 'cinematic' | 'high' | 'low';

interface Rig extends SkyState {
  fog: number; fogNear: number; fogFar: number;
  fogDistMax: number; groundMist: number; freeHaze: number;
  mistColor: number; hazeColor: number; airForward: number;
  hemiSky: number; hemiGround: number; hemi: number;
  sunI: number; shadowRadius: number; scatter: number;
  exposure: number; window: number;
  envI: number; bloom: number; vignette: number; grain: number; sat: number; contrast: number;
  tintS: number; tintH: number; glowStrength: number;
}

const RIGS: Record<'morning' | 'day' | 'dusk' | 'night', Rig> = {
  morning: {
    fog: 0x939ba3, fogNear: WEATHER_REACH, fogFar: 140, fogDistMax: 0.56, groundMist: 0.028, freeHaze: 0.0094, mistColor: 0x6a7882, hazeColor: 0x939da6, airForward: 0.24,
    hemiSky: 0xcdd5db, hemiGround: 0x736d64, hemi: 1.65,
    sun: 0xffe2c0, sunI: 0.88, shadowRadius: 5.5, scatter: 0.35, sunDir: [-0.75, 0.5, -0.35], exposure: 1.0, window: 0.9,
    zenith: 0xa8b4c0, horizon: 0xd6dce1, ground: 0x4a4640,
    cloudLit: 0xc8d2da, cloudDark: 0x6a7480, cover: 0.75, rim: 0.22,
    discSize: 0.0, discI: 0, glow: 0.2, stars: 0,
    envI: 0.72, bloom: 0.12, vignette: 0.5, grain: 0.02, sat: 0.92, contrast: 1.06, tintS: 0x14202c, tintH: 0xffe8c8, glowStrength: 0.09,
  },
  day: {
    // 阴天：雾色比天空 horizon 略暗，远景被分层吞没但留轮廓（圣经 §4.7/§6 Distant）
    fog: 0x818e9c, fogNear: WEATHER_REACH, fogFar: 142, fogDistMax: 0.57, groundMist: 0.0275, freeHaze: 0.0092, mistColor: 0x5b666f, hazeColor: 0x8996a2, airForward: 0.27,
    hemiSky: 0xc8d2da, hemiGround: 0x7e7972, hemi: 2.34,
    sun: 0xe4ebef, sunI: 0.72, shadowRadius: 5.5, scatter: 0.32, sunDir: [-0.58, 0.68, -0.42], exposure: 1.0, window: 1.0,
    zenith: 0xb1bdc8, horizon: 0xcbd2da, ground: 0x504c46,
    cloudLit: 0xcbd3dc, cloudDark: 0x7e8a98, cover: 0.85, rim: 0.15,
    discSize: 0.0, discI: 0, glow: 0.25, stars: 0,
    envI: 0.88, bloom: 0.10, vignette: 0.46, grain: 0.014, sat: 0.83, contrast: 1.09, tintS: 0x2a3640, tintH: 0xfff0d8, glowStrength: 0.04,
  },
  dusk: {
    fog: 0x54505c, fogNear: WEATHER_REACH, fogFar: 120, fogDistMax: 0.62, groundMist: 0.027, freeHaze: 0.0086, mistColor: 0x484c5a, hazeColor: 0x626a78, airForward: 0.34,
    hemiSky: 0x8a92a6, hemiGround: 0x3b332d, hemi: 1.1,
    sun: 0xe09a62, sunI: 1.6, shadowRadius: 3.5, scatter: 0.46, sunDir: [0.8, 0.2, 0.3], exposure: 1.0, window: 0.45,
    zenith: 0x39445a, horizon: 0x9a7260, ground: 0x332c28,
    cloudLit: 0xb08a78, cloudDark: 0x4a4452, cover: 0.7, rim: 0.5,
    discSize: 0.035, discI: 2.6, glow: 0.7, stars: 0.18,
    envI: 0.55, bloom: 0.25, vignette: 0.62, grain: 0.022, sat: 0.9, contrast: 1.08, tintS: 0x182030, tintH: 0xffb070, glowStrength: 0.24,
  },
  night: {
    // 月光从画面右上方来（与天空月盘同向），冷蓝 #7f9ccf；暗部保留约 20–30% 可读亮度。
    fog: 0x202d40, fogNear: WEATHER_REACH, fogFar: 110, fogDistMax: 0.68, groundMist: 0.025, freeHaze: 0.0078, mistColor: 0x202b39, hazeColor: 0x324359, airForward: 0.52,
    hemiSky: 0x7d90b4, hemiGround: 0x3c414b, hemi: 2.45,
    sun: 0x7f9ccf, sunI: 1.20, shadowRadius: 3.4, scatter: 0.69, sunDir: [0.72, 0.42, -0.35], exposure: 1.15, window: 0.07,
    zenith: 0x111b29, horizon: 0x202f44, ground: 0x0a0e15,
    cloudLit: 0x657791, cloudDark: 0x162133, cover: 0.84, rim: 0.60,
    discSize: 0.017, discI: 4.2, glow: 0.34, stars: 1,
    envI: 0.14, bloom: 0.19, vignette: 0.55, grain: 0.019, sat: 0.89, contrast: 1.05, tintS: 0x24364c, tintH: 0xffb25e, glowStrength: 0.32,
  },
};

const COLOR_KEYS = ['fog', 'mistColor', 'hazeColor', 'hemiSky', 'hemiGround', 'sun', 'zenith', 'horizon', 'ground', 'cloudLit', 'cloudDark', 'tintS', 'tintH'] as const;
const NUM_KEYS = ['fogNear', 'fogFar', 'fogDistMax', 'groundMist', 'freeHaze', 'airForward', 'hemi', 'sunI', 'shadowRadius', 'scatter', 'exposure', 'window', 'discSize', 'discI', 'glow', 'stars', 'cover', 'rim', 'envI', 'bloom', 'vignette', 'grain', 'sat', 'contrast', 'glowStrength'] as const;


export interface RenderPose { x: number; z: number; y?: number; ghosts: { x: number; z: number; y?: number }[] } // map:

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 610);
  readonly props: Props;
  readonly player: PlayerModel;
  readonly ghosts: GhostModels;
  quality: Quality = 'cinematic';
  private level: StaticLevel;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private fog = new THREE.Fog(0x888888, 20, 120);
  private fogCtl: FogController;
  private skyMat = makeSkyMaterial();
  private sky: THREE.Mesh;
  private portal = new THREE.Vector2();
  private portalIrradiance = new THREE.Color();
  readonly glassCaustics: GlassCaustics;
  private post: PostPipeline;
  private atmo: THREE.Object3D[] = [];
  private time = 0;
  /** 远景轻虚化开关：仅固定机位/标题生效，游戏越肩镜头保持锐利。 */
  cinematicDof = true;
  private camRig: CameraRig;
  private vfx: Vfx;
  private ca = new THREE.Color(); private cb = new THREE.Color();
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private rig: Rig = { ...RIGS.morning };
  private dawnT = 0;
  brightness = 1;
  get fixedCam(): { pos: [number, number, number]; look: [number, number, number] } | null { return this.camRig.fixedCam; }
  set fixedCam(v: { pos: [number, number, number]; look: [number, number, number] } | null) { this.camRig.fixedCam = v; }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio); // 默认 cinematic：满像素比
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap; // PCSS-like 可变半影（post/shadows.ts）
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 后期含多个渲染 pass：关闭自动重置，在每帧开头手动重置，探针统计才是整帧的绘制调用。
    this.renderer.info.autoReset = false;
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color();
    this.fogCtl = new FogController(this.renderer, this.scene);

    const m = makeMaterials();
    this.level = buildStaticLevel(m);
    const floors = buildFloors(m);
    this.props = new Props(m);
    this.player = new PlayerModel(m, glowTexture(), this.level.courtContact);
    this.ghosts = new GhostModels();
    this.scene.add(this.level.group, this.props.group, this.player.group, this.ghosts.group, floors.group); // map:
    const landmarks = buildLandmarks(m); hideLegacy(this.level.group);
    hideGroundHoles(this.level.group);
    this.scene.add(landmarks.group, buildScenery().group);

    // 天空穹顶：跟随镜头，渐变天 + 日/月盘 + 夜星
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), this.skyMat);
    // Draw at the far plane after opaque geometry so cloud shading only runs in visible sky.
    this.sky.renderOrder = 1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.hemi.name = 'Outdoor sky irradiance';
    this.sun.name = 'Sky directional key';
    this.sun.castShadow = true;
    // Opaque blockers remove the direct beam. Sky and surface bounce supply the penumbra fill.
    this.sun.shadow.intensity = 1;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 12; sc.far = 100; sc.left = -31; sc.right = 31; sc.top = 29; sc.bottom = -29;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 4;
    this.sun.shadow.blurSamples = 8;
    // Site-sized, world-anchored shadow volume. No shadow texel drift as the player walks.
    this.sun.target.position.set(9.5, 3, -10.25);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.glassCaustics = installGlassCaustics(this.scene, this.level.group, this.sun);

    // Stable broad-sky probe. The live key supplies sun/moon energy; baking a disc here
    // would also put it in every specular lobe. Fade probe energy instead of swapping maps
    // abruptly at dusk. Per-phase sky colour is carried by the hemi and actual sky/air.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), makeSkyMaterial());
    envScene.add(envSky);
    applySky(envSky.material, { ...RIGS.day, stars: 0, discSize: 0, discI: 0, glow: 0, rim: 0 }, 0);
    this.scene.environment = pmrem.fromScene(envScene, 0.08, 0.1, 100).texture;
    pmrem.dispose();
    envSky.material.dispose();
    envSky.geometry.dispose();

    // 扬尘（VFX-02）：庭院与礼拜堂空气中缓慢漂浮的微尘，高档可见
    const N = 160;
    const pos = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const inChapel = i % 3 === 0;
      pos[i * 3] = inChapel ? 14 + Math.random() * 10 : -9 + Math.random() * 18;
      pos[i * 3 + 1] = 0.3 + Math.random() * 4;
      pos[i * 3 + 2] = -(inChapel ? 9 + Math.random() * 15 : 1 + Math.random() * 27);
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.05;
      this.dustVel[i * 3 + 1] = (Math.random() - 0.3) * 0.02;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffe8c8, size: 0.05, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.scene.add(this.dust);

    this.camRig = new CameraRig(this.camera);
    this.vfx = new Vfx();
    this.scene.add(this.vfx.group);
    this.atmo.push(this.sky);
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && mat.transparent) this.atmo.push(o);
    });
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, {
      key: () => this.sun,
      doors: () => this.portal,
      skyIrradiance: () => this.portalIrradiance,
      ground: () => this.groundMeshes(),
      atmo: () => this.atmo,
      lights: () => [this.player.lanternLight, ...this.props.localLights],
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    if (this.quality === q) return;
    this.quality = q;
    const heavy = q !== 'low';
    setMaterialsQuality(heavy ? 'high' : 'low');
    // cinematic 用满设备像素比；high 保留 1.5 上限；low 直出 1x。
    this.renderer.setPixelRatio(q === 'cinematic' ? window.devicePixelRatio : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.renderer.shadowMap.type = q === 'cinematic' ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(heavy ? 2048 : 1024, heavy ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.dust.visible = heavy;
    // props 内部以 'high' 判定重特效：cinematic 同样按高档传入。
    this.props.setQuality(q === 'cinematic' ? 'high' : q);
    this.vfx.setQuality(q === 'cinematic' ? 'high' : q);
    this.post.setQuality(q);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.resize(w, h, this.renderer.getPixelRatio());
  }

  private blend(a: Rig, b: Rig, t: number): void {
    const r = this.rig;
    for (const k of COLOR_KEYS) (r[k] as number) = this.ca.setHex(a[k]).lerp(this.cb.setHex(b[k]), t).getHex();
    for (const k of NUM_KEYS) (r[k] as number) = lerp(a[k], b[k], t);
    r.sunDir = [lerp(a.sunDir[0], b.sunDir[0], t), lerp(a.sunDir[1], b.sunDir[1], t), lerp(a.sunDir[2], b.sunDir[2], t)];
  }

  private applyLighting(w: World, dt: number, time: number): void {
    switch (w.phase) {
      case 'tutorial': this.blend(RIGS.morning, RIGS.morning, 0); break;
      case 'day': {
        const end = smooth((w.clock - (PHASE.dayLength - 90)) / 90);
        if (end > 0) this.blend(RIGS.day, RIGS.dusk, end);
        else this.blend(RIGS.morning, RIGS.day, smooth(w.clock / 60));
        break;
      }
      case 'dusk': this.blend(RIGS.dusk, RIGS.night, smooth(w.clock / PHASE.duskLength)); break;
      case 'night': this.blend(RIGS.night, RIGS.night, 0); break;
      case 'dawn': case 'ended': this.blend(RIGS.night, RIGS.morning, smooth(this.dawnT / 5)); break;
      case 'failed': break;
    }
    this.dawnT = w.phase === 'dawn' || w.phase === 'ended' ? this.dawnT + dt : 0;
    const r = this.rig;
    (this.scene.background as THREE.Color).setHex(r.fog);
    this.fog.color.setHex(r.fog); this.fog.near = r.fogNear; this.fog.far = r.fogFar;
    // 共享昼夜信号：landmarks/scenery 的 onBeforeRender 读取（0 = 白天，1 = 深夜）
    this.scene.userData.night = clamp01(r.stars);
    // The low tier estimates sheltered height fog per surface. HDR tiers integrate once
    // against linear scene depth; their surface shader only contributes distant haze.
    const nightAmt = clamp01(r.stars);
    const fade = 1 - Math.exp(-7 * dt);
    this.portal.x = lerp(this.portal.x, Number(w.doors.gatehouse), fade);
    this.portal.y = lerp(this.portal.y, Number(w.doors.chapelFront), fade);
    this.hemi.color.setHex(r.hemiSky); this.hemi.groundColor.setHex(r.hemiGround); this.hemi.intensity = r.hemi;
    // Bounce samples are unit-sky transport. Scale by the incident sky radiance
    // and the night sky's lower contribution to the broad environment probe.
    this.portalIrradiance.copy(this.hemi.color).multiplyScalar(this.hemi.visible ? this.hemi.intensity * r.envI : 0);
    stageSkyExposureSources(this.portal, this.portalIrradiance);
    this.fogCtl.update({ heightDensity: this.quality === 'low' ? r.groundMist * 0.64 : 0,
      freeDensity: this.quality === 'low' ? r.freeHaze * 0.76 : 0,
      heightFalloff: DAMP_FALLOFF, heightBase: WEATHER_BASE, distMax: r.fogDistMax },
    this.portal, this.portalIrradiance, lerp(1.2, 0.35, nightAmt), lerp(2.5, 2.2, nightAmt));
    this.sun.color.setHex(r.sun); this.sun.intensity = r.sunI;
    this.glassCaustics.beamFraction = (1 - r.cover) * this.sun.intensity / (this.sun.intensity + this.hemi.intensity);
    this.sun.position.set(...r.sunDir).normalize().multiplyScalar(55).add(this.sun.target.position);
    this.renderer.toneMappingExposure = r.exposure * this.brightness;

    // 天空与环境光（同一着色器烘 IBL，见构造函数）
    applySky(this.skyMat, r, time);
    this.scene.environmentIntensity = r.envI;

    // 后期参数（LUT 随 rig blend 交叉淡入，管线内部按需重填）
    this.post.applyRig({
      bloom: r.bloom, vignette: r.vignette, grain: r.grain,
      glowStrength: r.glowStrength, scatter: r.scatter,
      ssrWet: lerp(0.12, 0.32, nightAmt),
      fog: [r.groundMist, r.freeHaze, WEATHER_BASE], mistColor: r.mistColor, hazeColor: r.hazeColor,
      airForward: r.airForward, keyDir: r.sunDir,
      grade: { sat: r.sat, contrast: r.contrast, tintS: r.tintS, tintH: r.tintH },
      hurt: this.vfx.hurt,
      hiThresh: lerp(3.0, 0.92, nightAmt),
      hiKneeCool: lerp(0.82, 3.7, nightAmt), hiKneeWarm: lerp(0.45, 0.82, nightAmt),
    });
    this.sun.shadow.radius = r.shadowRadius;
    this.level.windowMat.emissiveIntensity = .58 * r.window;
    this.level.hearthWindowMat.emissiveIntensity = w.hearth.lit ? .87 : 0;
    const dayness = clamp01((r.hemi - 1.0) / 1.1) * (1 - r.stars);
    (this.dust.material as THREE.PointsMaterial).opacity = 0.08 + 0.12 * dayness;
  }

  update(w: World, pose: RenderPose, yaw: number, pitch: number, dt: number, time: number): void {
    this.time = time;
    this.applyLighting(w, dt, time);
    this.props.update(w, dt, time);
    this.player.update(w, pose, yaw, dt, time);
    this.ghosts.update(w, pose.ghosts, dt, time);
    this.vfx.update(w, pose, dt, this.player.readFootPlants());
    if (this.vfx.consumeKick()) this.camRig.kick(1);
    const camD = this.camRig.update(w, pose, yaw, pitch, dt);
    this.sky.position.copy(this.camera.position);
    this.player.setBodyVisible(camD > 0.85);
    // 远景轻虚化只服务固定机位/标题构图；游戏镜头与近中景锐利
    if (this.fixedCam && this.cinematicDof && this.quality !== 'low') {
      const f = this.fixedCam;
      const focus = Math.hypot(f.pos[0] - f.look[0], f.pos[1] - f.look[1], f.pos[2] - f.look[2]);
      this.post.setDof(true, focus);
    } else this.post.setDof(false, 0);
    if (this.dust.visible) {
      const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += this.dustVel[i] * dt + Math.sin(time * 0.3 + i) * dt * 0.01;
        arr[i + 1] += this.dustVel[i + 1] * dt;
        arr[i + 2] += this.dustVel[i + 2] * dt;
        if (arr[i + 1] > 4.5) arr[i + 1] = 0.3;
        if (arr[i + 1] < 0.2) arr[i + 1] = 4.4;
      }
      pos.needsUpdate = true;
    }
  }

  render(): void {
    this.renderer.info.reset();
    if (this.quality === 'low') { this.renderer.render(this.scene, this.camera); return; }
    this.post.render(this.time);
  }

  /** SSR 反射接收面：石板地/碎石/木地板 + 低粗糙度积水。 */
  private groundMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.level.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.userData.aw?.uAwPool?.value > 0) out.push(mesh);
    });
    return out;
  }

}
