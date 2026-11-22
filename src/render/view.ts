// 场景视图：渲染器、天空穹顶、图像照明、四套照明（LGT-01，晨曦复用清晨）、后期与越肩镜头。
// 模拟状态只读，网格是它的视图。画质分高/低两档：高档含泛光与调色后期、软阴影、扬尘；低档直出以保帧率。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHASE } from '../config';
import { cameraClearT } from '../sim/collision';
import { groundY, regionAt } from '../sim/level';
import { World } from '../sim/state';
import { GhostModels, PlayerModel } from './characters';
import { clamp01, lerp, smooth } from './geom';
import { glowTexture, makeMaterials, smokeTexture } from './materials';
import { Props } from './props';
import { buildLandmarks, hideLegacy } from './landmarks';
import { buildScenery } from './scenery';
import { buildStaticLevel, StaticLevel } from './staticLevel';

export type Quality = 'high' | 'low';

interface Rig {
  fog: number; fogNear: number; fogFar: number;
  hemiSky: number; hemiGround: number; hemi: number;
  sun: number; sunI: number; sunDir: [number, number, number];
  exposure: number; window: number;
  zenith: number; horizon: number; ground: number;
  discSize: number; discI: number; glow: number; stars: number;
  envI: number; bloom: number; vignette: number; sat: number; contrast: number;
  tintS: number; tintH: number;
}

const RIGS: Record<'morning' | 'day' | 'dusk' | 'night', Rig> = {
  morning: {
    fog: 0x9aa2a8, fogNear: 24, fogFar: 115, hemiSky: 0xcdd5db, hemiGround: 0x575049, hemi: 2.0,
    sun: 0xffe2c0, sunI: 2.6, sunDir: [-0.75, 0.5, -0.35], exposure: 1.0, window: 0.9,
    zenith: 0x8fa0b2, horizon: 0xc4cacd, ground: 0x4a4640, discSize: 0.0, discI: 0, glow: 0.18, stars: 0,
    envI: 0.8, bloom: 0.2, vignette: 0.55, sat: 0.93, contrast: 1.04, tintS: 0x14202c, tintH: 0xffe8c8,
  },
  day: {
    fog: 0x97a0a8, fogNear: 30, fogFar: 135, hemiSky: 0xc8d2da, hemiGround: 0x5c564e, hemi: 2.4,
    sun: 0xeef2f5, sunI: 3.0, sunDir: [-0.3, 0.85, -0.42], exposure: 1.0, window: 1.0,
    zenith: 0x7f93a6, horizon: 0xbcc5cb, ground: 0x504c46, discSize: 0.0, discI: 0, glow: 0.22, stars: 0,
    envI: 0.9, bloom: 0.15, vignette: 0.52, sat: 0.96, contrast: 1.05, tintS: 0x14202c, tintH: 0xfff0d8,
  },
  dusk: {
    fog: 0x5a5560, fogNear: 18, fogFar: 92, hemiSky: 0x8a92a6, hemiGround: 0x3b332d, hemi: 1.0,
    sun: 0xe09a62, sunI: 1.7, sunDir: [0.8, 0.2, 0.3], exposure: 1.0, window: 0.45,
    zenith: 0x39445a, horizon: 0x9a7260, ground: 0x332c28, discSize: 0.035, discI: 2.6, glow: 0.7, stars: 0.18,
    envI: 0.5, bloom: 0.25, vignette: 0.65, sat: 0.9, contrast: 1.06, tintS: 0x182030, tintH: 0xffb070,
  },
  night: {
    fog: 0x0c111a, fogNear: 10, fogFar: 52, hemiSky: 0x4a5c78, hemiGround: 0x161a21, hemi: 0.85,
    sun: 0x8ba2c6, sunI: 0.7, sunDir: [-0.5, 0.7, -0.45], exposure: 1.05, window: 0.07,
    zenith: 0x070b14, horizon: 0x161e2c, ground: 0x0a0d12, discSize: 0.022, discI: 3.2, glow: 0.3, stars: 1,
    envI: 0.3, bloom: 0.3, vignette: 0.85, sat: 0.86, contrast: 1.07, tintS: 0x1a3040, tintH: 0xff9a50,
  },
};

const COLOR_KEYS = ['fog', 'hemiSky', 'hemiGround', 'sun', 'zenith', 'horizon', 'ground', 'tintS', 'tintH'] as const;
const NUM_KEYS = ['fogNear', 'fogFar', 'hemi', 'sunI', 'exposure', 'window', 'discSize', 'discI', 'glow', 'stars', 'envI', 'bloom', 'vignette', 'sat', 'contrast'] as const;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uDiscSize, uDiscI, uGlow, uStars, uTime;
varying vec3 vDir;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float sun = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  float ang = acos(clamp(dot(d, normalize(uSunDir)), -1.0, 1.0));
  float disc = smoothstep(uDiscSize, uDiscSize * 0.82, ang);
  col += uSunColor * (disc * uDiscI + pow(sun, 90.0) * uGlow + pow(sun, 8.0) * uGlow * 0.25);
  if (uStars > 0.001 && h > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) * 3.0, asin(clamp(h, -1.0, 1.0)) * 6.0);
    vec2 cell = floor(uv * 24.0);
    vec2 f = fract(uv * 24.0) - 0.5;
    float rnd = hash21(cell);
    float star = step(0.965, rnd) * smoothstep(0.12, 0.0, length(f));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 40.0);
    col += vec3(0.8, 0.85, 1.0) * star * tw * uStars * smoothstep(0.0, 0.25, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uDiscSize: { value: 0 }, uDiscI: { value: 0 }, uGlow: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 },
    },
  });
}

// 调色 pass（在线性 HDR 空间，OutputPass 之前）：饱和、对比、暗部/亮部分色、暗角、细颗粒。
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVig: { value: 0.5 }, uSat: { value: 1 }, uContrast: { value: 1 }, uGrain: { value: 0.03 }, uTime: { value: 0 },
    uTintS: { value: new THREE.Color() }, uTintH: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig, uSat, uContrast, uGrain, uTime;
    uniform vec3 uTintS, uTintH; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c += uTintS * (1.0 - clamp(l, 0.0, 1.0)) * 0.7;
      c += uTintH * clamp(l, 0.0, 1.0) * 0.4;
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.32, 0.85, d);
      c += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 13.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

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
  quality: Quality = 'high';
  private level: StaticLevel;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private fog = new THREE.Fog(0x888888, 20, 120);
  private skyMat = makeSkyMaterial();
  private sky: THREE.Mesh;
  private envDay: THREE.Texture;
  private envNight: THREE.Texture;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 后期含多个渲染 pass：关闭自动重置，在每帧开头手动重置，探针统计才是整帧的绘制调用。
    this.renderer.info.autoReset = false;
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color();

    const m = makeMaterials();
    this.level = buildStaticLevel(m);
    this.props = new Props(m);
    this.player = new PlayerModel(m, glowTexture());
    this.ghosts = new GhostModels();
    this.scene.add(this.level.group, this.props.group, this.player.group, this.ghosts.group);
    const landmarks = buildLandmarks(m); hideLegacy(this.level.group);
    this.scene.add(landmarks.group, buildScenery(m).group);

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
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // 图像照明：用同一天空着色器烘两张环境图（昼/夜），给 PBR 材质提供柔和环境光与金属反射。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), makeSkyMaterial());
    envScene.add(envSky);
    const bake = (r: Rig): THREE.Texture => {
      const u = (envSky.material as THREE.ShaderMaterial).uniforms;
      u.uZenith.value.setHex(r.zenith); u.uHorizon.value.setHex(r.horizon); u.uGround.value.setHex(r.ground);
      u.uSunDir.value.set(...r.sunDir); u.uSunColor.value.setHex(r.sun);
      u.uDiscSize.value = r.discSize; u.uDiscI.value = r.discI; u.uGlow.value = r.glow; u.uStars.value = 0;
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

    // 后期：渲染 → 泛光 → 调色 → 输出（色调映射与 sRGB）
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    if (this.quality === q) return;
    this.quality = q;
    const high = q === 'high';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.renderer.shadowMap.type = high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.dust.visible = high;
    this.props.setQuality(q);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
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
    this.hemi.color.setHex(r.hemiSky); this.hemi.groundColor.setHex(r.hemiGround); this.hemi.intensity = r.hemi;
    this.sun.color.setHex(r.sun); this.sun.intensity = r.sunI;
    this.sun.target.position.set(p.x, 0, -p.z);
    this.sun.position.set(p.x + r.sunDir[0] * 45, r.sunDir[1] * 45, -p.z + r.sunDir[2] * 45);
    this.renderer.toneMappingExposure = r.exposure * this.brightness;

    // 天空与环境光
    const u = this.skyMat.uniforms;
    u.uZenith.value.setHex(r.zenith); u.uHorizon.value.setHex(r.horizon); u.uGround.value.setHex(r.ground);
    u.uSunDir.value.set(...r.sunDir); u.uSunColor.value.setHex(r.sun);
    u.uDiscSize.value = r.discSize; u.uDiscI.value = r.discI; u.uGlow.value = r.glow; u.uStars.value = r.stars; u.uTime.value = time;
    this.sky.position.copy(this.camera.position);
    const nightish = r.stars > 0.5;
    this.scene.environment = nightish ? this.envNight : this.envDay;
    this.scene.environmentIntensity = r.envI;

    // 后期参数
    this.bloom.strength = r.bloom;
    const gu = this.grade.uniforms;
    gu.uVig.value = r.vignette; gu.uSat.value = r.sat; gu.uContrast.value = r.contrast; gu.uTime.value = time;
    gu.uTintS.value.setHex(r.tintS); gu.uTintH.value.setHex(r.tintH);

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
    this.applyLighting(w, pose, dt, time);
    this.props.update(w, dt, time);
    this.player.update(w, pose, yaw, dt, time);
    this.ghosts.update(w, pose.ghosts, dt, time);
    this.updateCamera(w, pose, yaw, pitch, dt);
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
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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