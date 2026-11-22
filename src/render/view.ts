// 场景视图：渲染器、天空穹顶、图像照明、四套照明（LGT-01，晨曦复用清晨）、后期与越肩镜头。
// 模拟状态只读，网格是它的视图。画质分高/低两档：高档含泛光与调色后期、软阴影、扬尘；低档直出以保帧率。
import * as THREE from 'three';
import { PHASE } from '../config';
import { cameraClearT } from '../sim/collision';
import { groundY, regionAt } from '../sim/level';
import { World } from '../sim/state';
import { GhostModels, PlayerModel } from './characters';
import { clamp01, lerp, smooth } from './geom';
import { glowTexture, makeMaterials, smokeTexture } from './materials';
import { Props } from './props';
import { applySky, makeSkyMaterial, SkyState } from './sky';
import { FogController, installHeightFog } from './post/fog';
import { PostPipeline } from './post/pipeline';
import { installSoftShadows } from './post/shadows';
import { buildStaticLevel, StaticLevel } from './staticLevel';

installHeightFog();
installSoftShadows();

export type Quality = 'cinematic' | 'high' | 'low';

interface Rig extends SkyState {
  fog: number; fogNear: number; fogFar: number;
  fogDistMax: number; fogHeightDensity: number; fogHeightFalloff: number; fogHeightBase: number;
  hemiSky: number; hemiGround: number; hemi: number;
  sunI: number; shadowI: number; shadowRadius: number; rimI: number; scatter: number;
  exposure: number; window: number;
  envI: number; bloom: number; vignette: number; grain: number; sat: number; contrast: number;
  tintS: number; tintH: number; glowStrength: number;
}

const RIGS: Record<'morning' | 'day' | 'dusk' | 'night', Rig> = {
  morning: {
    fog: 0x9aa2a8, fogNear: 26, fogFar: 120, fogDistMax: 0.85, fogHeightDensity: 0.01, fogHeightFalloff: 0.12, fogHeightBase: 0.0,
    hemiSky: 0xcdd5db, hemiGround: 0x575049, hemi: 2.1,
    sun: 0xffe2c0, sunI: 2.2, shadowI: 0.45, shadowRadius: 5, rimI: 0.25, scatter: 0.12, sunDir: [-0.75, 0.5, -0.35], exposure: 1.0, window: 0.9,
    zenith: 0x8fa0b2, horizon: 0xc4cacd, ground: 0x4a4640,
    cloudLit: 0xe6e9ec, cloudDark: 0x9aa3ac, cover: 0.8, rim: 0.25,
    discSize: 0.0, discI: 0, glow: 0.18, stars: 0,
    envI: 0.85, bloom: 0.2, vignette: 0.5, grain: 0.02, sat: 0.92, contrast: 1.04, tintS: 0x14202c, tintH: 0xffe8c8, glowStrength: 0.12,
  },
  day: {
    fog: 0x9aa4ac, fogNear: 26, fogFar: 95, fogDistMax: 0.95, fogHeightDensity: 0.01, fogHeightFalloff: 0.12, fogHeightBase: 0.0,
    hemiSky: 0xc8d2da, hemiGround: 0x5c564e, hemi: 1.9,
    sun: 0xeef2f5, sunI: 1.7, shadowI: 0.25, shadowRadius: 7, rimI: 0.3, scatter: 0.03, sunDir: [-0.3, 0.85, -0.42], exposure: 0.82, window: 1.0,
    zenith: 0x7f93a6, horizon: 0xbcc5cb, ground: 0x504c46,
    cloudLit: 0xf0f3f5, cloudDark: 0x6f7a86, cover: 0.78, rim: 0.18,
    discSize: 0.0, discI: 0, glow: 0.2, stars: 0,
    envI: 0.75, bloom: 0.14, vignette: 0.45, grain: 0.018, sat: 0.86, contrast: 1.1, tintS: 0x2a3640, tintH: 0xfff0d8, glowStrength: 0.05,
  },
  dusk: {
    fog: 0x5a5560, fogNear: 20, fogFar: 100, fogDistMax: 0.85, fogHeightDensity: 0.012, fogHeightFalloff: 0.1, fogHeightBase: 0.0,
    hemiSky: 0x8a92a6, hemiGround: 0x3b332d, hemi: 1.1,
    sun: 0xe09a62, sunI: 1.6, shadowI: 0.5, shadowRadius: 4, rimI: 0.35, scatter: 0.25, sunDir: [0.8, 0.2, 0.3], exposure: 1.0, window: 0.45,
    zenith: 0x39445a, horizon: 0x9a7260, ground: 0x332c28,
    cloudLit: 0xb08a78, cloudDark: 0x4a4452, cover: 0.75, rim: 0.5,
    discSize: 0.035, discI: 2.6, glow: 0.7, stars: 0.18,
    envI: 0.55, bloom: 0.25, vignette: 0.62, grain: 0.022, sat: 0.9, contrast: 1.06, tintS: 0x182030, tintH: 0xffb070, glowStrength: 0.3,
  },
  night: {
    // 月光从画面右上方来（与天空月盘同向），冷蓝 #7f9ccf；暗部保留约 20–30% 可读亮度。
    fog: 0x101826, fogNear: 20, fogFar: 90, fogDistMax: 0.8, fogHeightDensity: 0.012, fogHeightFalloff: 0.1, fogHeightBase: 0.0,
    hemiSky: 0x7d90b4, hemiGround: 0x2a3140, hemi: 3.0,
    sun: 0x7f9ccf, sunI: 1.1, shadowI: 0.5, shadowRadius: 3, rimI: 0.45, scatter: 0.5, sunDir: [0.72, 0.42, -0.35], exposure: 1.15, window: 0.07,
    zenith: 0x0a1322, horizon: 0x1d2b42, ground: 0x0a0e15,
    cloudLit: 0x51648c, cloudDark: 0x0e1626, cover: 0.78, rim: 0.85,
    discSize: 0.026, discI: 5.5, glow: 0.55, stars: 1,
    envI: 1.2, bloom: 0.32, vignette: 0.62, grain: 0.025, sat: 0.88, contrast: 1.08, tintS: 0x24364c, tintH: 0xffb25e, glowStrength: 0.45,
  },
};

const COLOR_KEYS = ['fog', 'hemiSky', 'hemiGround', 'sun', 'zenith', 'horizon', 'ground', 'cloudLit', 'cloudDark', 'tintS', 'tintH'] as const;
const NUM_KEYS = ['fogNear', 'fogFar', 'fogDistMax', 'fogHeightDensity', 'fogHeightFalloff', 'fogHeightBase', 'hemi', 'sunI', 'shadowI', 'shadowRadius', 'rimI', 'scatter', 'exposure', 'window', 'discSize', 'discI', 'glow', 'stars', 'cover', 'rim', 'envI', 'bloom', 'vignette', 'grain', 'sat', 'contrast', 'glowStrength'] as const;

const CAM = { dist: 3.4, shoulder: 0.78, pivotY: 1.62, minDist: 0.35 };
const FAN = { n: 12, step: (3 * Math.PI) / 180 };

export interface RenderPose { x: number; z: number; ghosts: { x: number; z: number }[] }

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 320);
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
  private envDay: THREE.Texture;
  private envNight: THREE.Texture;
  private mats: ReturnType<typeof makeMaterials>;
  private post: PostPipeline;
  private atmo: THREE.Object3D[] = [];
  private rim = new THREE.DirectionalLight(0xffffff, 0);
  private camFwd = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private time = 0;
  /** 景深开关：仅固定机位/标题生效，游戏越肩镜头保持锐利。 */
  cinematicDof = true;
  private camDist = CAM.dist;
  private camShoulder = CAM.shoulder;
  private ca = new THREE.Color(); private cb = new THREE.Color();
  private mist: THREE.Sprite[] = [];
  private mistMat: THREE.SpriteMaterial;
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private shafts: THREE.Mesh[] = [];
  private shaftMat: THREE.MeshBasicMaterial;
  private rig: Rig = { ...RIGS.morning };
  private dawnT = 0;
  brightness = 1;
  fixedCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;

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
    this.mats = m;
    this.level = buildStaticLevel(m);
    this.props = new Props(m);
    this.player = new PlayerModel(m, glowTexture());
    this.ghosts = new GhostModels();
    this.scene.add(this.level.group, this.props.group, this.player.group, this.ghosts.group);

    // 天空穹顶：跟随镜头，渐变天 + 日/月盘 + 夜星
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 90; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 4;
    this.sun.shadow.blurSamples = 8;
    this.rim.castShadow = false;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.rim, this.rim.target);

    // 图像照明：用同一天空着色器烘两张环境图（昼/夜），给 PBR 材质提供柔和环境光与金属反射。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), makeSkyMaterial());
    envScene.add(envSky);
    const bake = (r: Rig): THREE.Texture => {
      applySky(envSky.material as THREE.ShaderMaterial, { ...r, stars: 0 }, 0);
      return pmrem.fromScene(envScene, 0.04, 0.1, 100).texture;
    };
    this.envDay = bake(RIGS.day);
    this.envNight = bake(RIGS.night);
    pmrem.dispose();
    this.scene.environment = this.envDay;
    this.scene.environmentIntensity = 0.6;

    // 低雾（VFX-02）：贴地的软烟团，淡到不遮地面与门洞
    this.mistMat = new THREE.SpriteMaterial({ map: smokeTexture(), color: 0xaab4bc, transparent: true, opacity: 0.1, depthWrite: false });
    for (const [x, z, s] of [[-6, 20, 9], [3, 9, 8], [6, 22, 10], [-3, 4, 7], [11.7, 9, 5], [16, 27, 6], [-7, 12, 8], [5, 16, 9]]) {
      const sp = new THREE.Sprite(this.mistMat);
      sp.position.set(x, 0.6, -z);
      sp.scale.set(s, s * 0.3, 1);
      this.mist.push(sp); this.scene.add(sp);
    }

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

    // 光柱：礼拜堂西墙高窗透进的冷光（白天可见），加性软边面片
    this.shaftMat = new THREE.MeshBasicMaterial({ map: makeShaftTexture(), color: 0xcfe0ee, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (const z of [9.6, 12.4, 18.6, 23]) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 6.5), this.shaftMat);
      shaft.position.set(15.2, 3.0, -z);
      shaft.rotation.set(0, Math.PI / 2, -0.5);
      this.shafts.push(shaft); this.scene.add(shaft);
    }

    // 后期管线拆在 post/pipeline.ts（便于与 camera/landmarks 代理合并）
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && mat.transparent) this.atmo.push(o);
    });
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, {
      ground: () => this.groundMeshes(),
      atmo: () => this.atmo,
      lights: () => [this.props.lampLight, this.player.lanternLight, this.props.brazierLight, this.props.hearthLight, this.props.windowLight],
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    if (this.quality === q) return;
    this.quality = q;
    const heavy = q !== 'low';
    // cinematic 用满设备像素比；high 保留 1.5 上限；low 直出 1x。
    this.renderer.setPixelRatio(q === 'cinematic' ? window.devicePixelRatio : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.renderer.shadowMap.type = heavy ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(heavy ? 2048 : 1024, heavy ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.dust.visible = heavy;
    // props 内部以 'high' 判定重特效：cinematic 同样按高档传入。
    this.props.setQuality(q === 'cinematic' ? 'high' : q);
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

  private applyLighting(w: World, p: { x: number; z: number }, dt: number, time: number): void {
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
    this.fogCtl.update({ heightDensity: r.fogHeightDensity, heightFalloff: r.fogHeightFalloff, heightBase: r.fogHeightBase, distMax: r.fogDistMax });
    this.hemi.color.setHex(r.hemiSky); this.hemi.groundColor.setHex(r.hemiGround); this.hemi.intensity = r.hemi;
    this.sun.color.setHex(r.sun); this.sun.intensity = r.sunI;
    this.sun.target.position.set(p.x, 0, -p.z);
    this.sun.position.set(p.x + r.sunDir[0] * 45, r.sunDir[1] * 45, -p.z + r.sunDir[2] * 45);
    this.renderer.toneMappingExposure = r.exposure * this.brightness;

    // 天空与环境光（同一着色器烘 IBL，见构造函数）
    applySky(this.skyMat, r, time);
    this.sky.position.copy(this.camera.position);
    this.sun.shadow.intensity = r.shadowI;
    const nightish = r.stars > 0.5;
    this.scene.environment = nightish ? this.envNight : this.envDay;
    this.scene.environmentIntensity = r.envI;

    // 后期参数（LUT 随 rig blend 交叉淡入，管线内部按需重填）
    this.post.applyRig({
      bloom: r.bloom, vignette: r.vignette, grain: r.grain,
      glowStrength: r.glowStrength, scatter: r.scatter,
      ssrWet: lerp(0.16, 0.5, clamp01(r.stars)),
      fog: [r.fogHeightDensity, r.fogHeightFalloff, r.fogHeightBase],
      grade: { sat: r.sat, contrast: r.contrast, tintS: r.tintS, tintH: r.tintH },
    });
    this.sun.shadow.radius = r.shadowRadius;
    // 轮廓光：从镜头后方偏月侧打来的弱背光，让守夜人/鬼的剪影从暗墙上分离
    this.rim.color.setHex(r.sun).lerp(this.ca.setHex(0xffffff), 0.35);
    this.rim.intensity = r.rimI;
    this.camera.getWorldDirection(this.camFwd);
    this.camFwd.multiplyScalar(0.85).add(this.tmpV.set(r.sunDir[0], r.sunDir[1], r.sunDir[2]).multiplyScalar(0.35));
    this.camFwd.y += 0.3;
    this.camFwd.normalize();
    this.rim.target.position.set(p.x, 0, -p.z);
    this.rim.position.set(p.x + this.camFwd.x * 40, this.camFwd.y * 40, -p.z + this.camFwd.z * 40);

    this.level.windowMat.emissiveIntensity = r.window;
    this.level.hearthWindowMat.emissiveIntensity = w.hearth.lit ? 1.5 : 0.03;
    this.mistMat.opacity = lerp(0.05, 0.18, clamp01(1 - r.hemi / 2.1));
    this.mistMat.color.setHex(r.fog).multiplyScalar(1.6);
    // 光柱只在白天/清晨的冷光下出现
    const dayness = clamp01((r.hemi - 1.0) / 1.1) * (1 - r.stars);
    this.shaftMat.opacity = 0.06 * dayness;
    for (const s of this.shafts) s.visible = dayness > 0.02;
    (this.dust.material as THREE.PointsMaterial).opacity = 0.08 + 0.12 * dayness;
  }

  private sweep(ax: number, az: number, ay: number, dir: number, len: number, by: number, doors: World['doors']): [number, number] {
    const cast = (off: number): number =>
      cameraClearT(ax, az, ay, ax + Math.sin(dir + off) * len, az + Math.cos(dir + off) * len, by, doors);
    const span = FAN.n * FAN.step;
    const hard = cast(0);
    let soft = hard;
    for (const side of [-1, 1]) {
      let tPrev = hard, oPrev = 0;
      for (let k = 1; k <= FAN.n; k++) {
        const o = k * FAN.step, t = cast(o * side);
        if (Math.abs(t - tPrev) > 0.06) {
          let lo = oPrev, hi = o, tLo = tPrev, tHi = t;
          for (let i = 0; i < 5; i++) {
            const mid = (lo + hi) / 2, tm = cast(mid * side);
            if (Math.abs(tm - tLo) < Math.abs(tm - tHi)) { lo = mid; tLo = tm; } else { hi = mid; tHi = tm; }
          }
          soft = Math.min(soft, tLo + lo / span, tHi + hi / span);
        }
        soft = Math.min(soft, t + o / span);
        tPrev = t; oPrev = o;
      }
    }
    return [hard, soft];
  }

  private updateCamera(w: World, p: { x: number; z: number }, yaw: number, pitch: number, dt: number): void {
    if (this.fixedCam) {
      const f = this.fixedCam;
      this.camera.position.set(f.pos[0], f.pos[1], -f.pos[2]);
      this.camera.lookAt(f.look[0], f.look[1], -f.look[2]);
      return;
    }
    const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const py = groundY(p.x, p.z) + CAM.pivotY;
    const reach = CAM.shoulder + 0.3;
    const side = this.sweep(p.x, p.z, py, yaw + Math.PI / 2, reach, py, w.doors);
    const shHard = Math.max(0, Math.min(CAM.shoulder, side[0] * reach - 0.3));
    const shWant = Math.max(0, Math.min(CAM.shoulder, side[1] * reach - 0.3));
    this.camShoulder = Math.min(shHard, shWant < this.camShoulder ? shWant : lerp(this.camShoulder, shWant, Math.min(1, dt * 6)));
    const sh = this.camShoulder;
    const ax = p.x + cy * sh, az = p.z - sy * sh;
    const back = this.sweep(ax, az, py, yaw + Math.PI, cp * CAM.dist, py + sp * CAM.dist, w.doors);
    let hard = Math.max(CAM.minDist, back[0] * CAM.dist - 0.25);
    const top = regionAt(p.x, p.z) === 'gatehouse' ? 3.25 : regionAt(p.x, p.z) === 'chapel' ? 6.5 : regionAt(p.x, p.z) === 'porch' ? 3.3 : 60;
    if (sp > 0.01) hard = Math.min(hard, Math.max(CAM.minDist, (top - py) / sp));
    if (sp < -0.01) hard = Math.min(hard, Math.max(CAM.minDist, (py - 0.25 - groundY(p.x, p.z)) / -sp));
    const want = Math.min(hard, Math.max(CAM.minDist, back[1] * CAM.dist - 0.25));
    this.camDist = Math.min(hard, want < this.camDist ? want : lerp(this.camDist, want, Math.min(1, dt * 5)));
    const d = this.camDist;
    this.camera.position.set(ax - sy * cp * d, py + sp * d, -(az - cy * cp * d));
    this.camera.lookAt(ax + sy * cp * 6, py - sp * 6, -(az + cy * cp * 6));
    this.player.group.visible = d > 0.85;
  }

  update(w: World, pose: RenderPose, yaw: number, pitch: number, dt: number, time: number): void {
    this.time = time;
    this.applyLighting(w, pose, dt, time);
    this.props.update(w, dt, time);
    this.player.update(w, pose, yaw, dt, time);
    this.ghosts.update(w, pose.ghosts, dt, time);
    this.updateCamera(w, pose, yaw, pitch, dt);
    // 景深只服务固定机位/标题构图；游戏镜头锐利
    if (this.fixedCam && this.cinematicDof && this.quality !== 'low') {
      const f = this.fixedCam;
      const focus = Math.hypot(f.pos[0] - f.look[0], f.pos[1] - f.look[1], f.pos[2] - f.look[2]);
      this.post.setDof(true, focus);
    } else this.post.setDof(false, 0);
    this.mist.forEach((s, i) => { s.position.x += Math.sin(time * 0.13 + i * 1.7) * dt * 0.12; });
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
    const m = this.mats;
    this.level.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat === m.flag || mat === m.gravel || mat === m.woodFloor || (mat.isMeshStandardMaterial && mat.roughness < 0.15)) out.push(mesh);
    });
    return out;
  }

}

/** 光柱贴图：沿长度与宽度软衰减的亮带。 */
function makeShaftTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}