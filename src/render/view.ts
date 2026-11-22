// 场景视图：渲染器、四套照明（LGT-01，晨曦复用清晨）、越肩镜头。模拟状态只读，网格是它的视图。
import * as THREE from 'three';
import { PHASE } from '../config';
import { cameraClearT } from '../sim/collision';
import { groundY, regionAt } from '../sim/level';
import { World } from '../sim/state';
import { GhostModels, PlayerModel } from './characters';
import { clamp01, lerp, smooth } from './geom';
import { glowTexture, makeMaterials } from './materials';
import { Props } from './props';
import { buildStaticLevel, StaticLevel } from './staticLevel';

interface Rig {
  sky: number; fog: number; fogNear: number; fogFar: number;
  hemiSky: number; hemiGround: number; hemi: number;
  sun: number; sunI: number; sunDir: [number, number, number];
  exposure: number; window: number;
}

const RIGS: Record<'morning' | 'day' | 'dusk' | 'night', Rig> = {
  morning: {
    sky: 0x9aa2a6, fog: 0x8f979b, fogNear: 22, fogFar: 105, hemiSky: 0xc4ccd2, hemiGround: 0x4f4a44, hemi: 0.95,
    sun: 0xffe2c0, sunI: 1.5, sunDir: [-0.75, 0.5, -0.35], exposure: 1.0, window: 0.9,
  },
  day: {
    sky: 0x8d979f, fog: 0x868f96, fogNear: 28, fogFar: 125, hemiSky: 0xc0cad3, hemiGround: 0x55504a, hemi: 1.15,
    sun: 0xe9eef2, sunI: 1.9, sunDir: [-0.3, 0.85, -0.42], exposure: 1.0, window: 1.0,
  },
  dusk: {
    sky: 0x4d5562, fog: 0x4a505b, fogNear: 18, fogFar: 85, hemiSky: 0x7f8a9c, hemiGround: 0x3b3531, hemi: 0.62,
    sun: 0xd08a5a, sunI: 1.0, sunDir: [0.8, 0.3, 0.3], exposure: 1.0, window: 0.45,
  },
  night: {
    sky: 0x0b1019, fog: 0x0c111a, fogNear: 9, fogFar: 46, hemiSky: 0x4a5c78, hemiGround: 0x1a1e25, hemi: 0.5,
    sun: 0x7b93b8, sunI: 0.5, sunDir: [-0.5, 0.7, -0.45], exposure: 1.05, window: 0.07,
  },
};

const CAM = { dist: 3.4, shoulder: 0.78, pivotY: 1.62, minDist: 0.35 };
/** 镜头预判的扇形：两侧各 n 条射线，间隔 step，偏到最外侧时放宽一整段长度。 */
const FAN = { n: 12, step: (3 * Math.PI) / 180 };

/** 渲染用的位置：模拟两步之间的插值结果（见 main.ts）。ghosts 与 world.ghosts 按下标对应。 */
export interface RenderPose { x: number; z: number; ghosts: { x: number; z: number }[] }

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 260);
  readonly props: Props;
  readonly player: PlayerModel;
  readonly ghosts: GhostModels;
  private level: StaticLevel;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private fog = new THREE.Fog(0x888888, 20, 120);
  private camDist = CAM.dist;
  private camShoulder = CAM.shoulder;
  private ca = new THREE.Color(); private cb = new THREE.Color();
  private mist: THREE.Sprite[] = [];
  private mistMat: THREE.SpriteMaterial;
  private rig: Rig = { ...RIGS.morning };
  private dawnT = 0;
  brightness = 1;
  /** 截图与验收用的固定机位。为 null 时使用越肩镜头。 */
  fixedCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color();

    const m = makeMaterials();
    const tex = glowTexture();
    this.level = buildStaticLevel(m);
    this.props = new Props(m);
    this.player = new PlayerModel(m, tex);
    this.ghosts = new GhostModels();
    this.scene.add(this.level.group, this.props.group, this.player.group, this.ghosts.group);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 90; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // 低雾（VFX-02）：庭院与外廊贴地的几团，淡到不遮地面与门洞
    this.mistMat = new THREE.SpriteMaterial({ map: tex, color: 0xaab4bc, transparent: true, opacity: 0.1, depthWrite: false });
    for (const [x, z, s] of [[-6, 20, 9], [3, 9, 8], [6, 22, 10], [-3, 4, 7], [11.7, 9, 5], [16, 27, 6]]) {
      const sp = new THREE.Sprite(this.mistMat);
      sp.position.set(x, 0.7, -z);
      sp.scale.set(s, s * 0.32, 1);
      this.mist.push(sp); this.scene.add(sp);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private blend(a: Rig, b: Rig, t: number): void {
    const r = this.rig;
    const col = (x: number, y: number): number => this.ca.setHex(x).lerp(this.cb.setHex(y), t).getHex();
    r.sky = col(a.sky, b.sky); r.fog = col(a.fog, b.fog);
    r.hemiSky = col(a.hemiSky, b.hemiSky); r.hemiGround = col(a.hemiGround, b.hemiGround); r.sun = col(a.sun, b.sun);
    r.fogNear = lerp(a.fogNear, b.fogNear, t); r.fogFar = lerp(a.fogFar, b.fogFar, t);
    r.hemi = lerp(a.hemi, b.hemi, t); r.sunI = lerp(a.sunI, b.sunI, t);
    r.exposure = lerp(a.exposure, b.exposure, t); r.window = lerp(a.window, b.window, t);
    r.sunDir = [lerp(a.sunDir[0], b.sunDir[0], t), lerp(a.sunDir[1], b.sunDir[1], t), lerp(a.sunDir[2], b.sunDir[2], t)];
  }

  private applyLighting(w: World, p: { x: number; z: number }, dt: number): void {
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
    // 晨曦无时限，天色过渡用视图自己的计时
    this.dawnT = w.phase === 'dawn' || w.phase === 'ended' ? this.dawnT + dt : 0;
    const r = this.rig;
    (this.scene.background as THREE.Color).setHex(r.sky);
    this.fog.color.setHex(r.fog); this.fog.near = r.fogNear; this.fog.far = r.fogFar;
    this.hemi.color.setHex(r.hemiSky); this.hemi.groundColor.setHex(r.hemiGround); this.hemi.intensity = r.hemi;
    this.sun.color.setHex(r.sun); this.sun.intensity = r.sunI;
    // 阴影相机跟随玩家，保持贴图密度
    this.sun.target.position.set(p.x, 0, -p.z);
    this.sun.position.set(p.x + r.sunDir[0] * 45, r.sunDir[1] * 45, -p.z + r.sunDir[2] * 45);
    this.renderer.toneMappingExposure = r.exposure * this.brightness;
    this.level.windowMat.emissiveIntensity = r.window;
    this.level.hearthWindowMat.emissiveIntensity = w.hearth.lit ? 1.5 : 0.03;
    this.mistMat.opacity = lerp(0.05, 0.16, clamp01(1 - r.hemi));
    this.mistMat.color.setHex(r.fog).multiplyScalar(1.5);
  }

  /**
   * 从 (ax, az) 朝水平方向 dir 伸出 len 米的可用比例。除了正向这一条，还向两侧扇形取样，
   * 偏得越远放得越宽：转向时镜头在扫到墙角之前就逐步收近，而不是一帧跳到位。
   * 返回 [正向比例, 预判后的比例]，后者不大于前者。
   */
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
          // 相邻两条射线一条被挡一条没挡：二分找出遮挡边缘的角度，结果才随转向连续变化
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
    // 越肩偏移遇墙先收回，避免镜头枢轴自己穿墙；让开后平滑放回
    const reach = CAM.shoulder + 0.3;
    const side = this.sweep(p.x, p.z, py, yaw + Math.PI / 2, reach, py, w.doors);
    const shHard = Math.max(0, Math.min(CAM.shoulder, side[0] * reach - 0.3));
    const shWant = Math.max(0, Math.min(CAM.shoulder, side[1] * reach - 0.3));
    this.camShoulder = Math.min(shHard, shWant < this.camShoulder ? shWant : lerp(this.camShoulder, shWant, Math.min(1, dt * 6)));
    const sh = this.camShoulder;
    const ax = p.x + cy * sh, az = p.z - sy * sh;
    const back = this.sweep(ax, az, py, yaw + Math.PI, cp * CAM.dist, py + sp * CAM.dist, w.doors);
    let hard = Math.max(CAM.minDist, back[0] * CAM.dist - 0.25);
    // 室内屋顶与地面限制
    const top = regionAt(p.x, p.z) === 'gatehouse' ? 3.25 : regionAt(p.x, p.z) === 'chapel' ? 6.5 : regionAt(p.x, p.z) === 'porch' ? 3.3 : 60;
    if (sp > 0.01) hard = Math.min(hard, Math.max(CAM.minDist, (top - py) / sp));
    if (sp < -0.01) hard = Math.min(hard, Math.max(CAM.minDist, (py - 0.25 - groundY(p.x, p.z)) / -sp));
    const want = Math.min(hard, Math.max(CAM.minDist, back[1] * CAM.dist - 0.25));
    // 收近跟着预判走，绝不超过正后方的实际可用距离；离开后平滑复位
    this.camDist = Math.min(hard, want < this.camDist ? want : lerp(this.camDist, want, Math.min(1, dt * 5)));
    const d = this.camDist;
    this.camera.position.set(ax - sy * cp * d, py + sp * d, -(az - cy * cp * d));
    this.camera.lookAt(ax + sy * cp * 6, py - sp * 6, -(az + cy * cp * 6));
    // 镜头贴近时隐去角色，免得挡住视野
    this.player.group.visible = d > 0.85;
  }

  update(w: World, pose: RenderPose, yaw: number, pitch: number, dt: number, time: number): void {
    this.applyLighting(w, pose, dt);
    this.props.update(w, dt, time);
    this.player.update(w, pose, yaw, dt, time);
    this.ghosts.update(w, pose.ghosts, dt, time);
    this.updateCamera(w, pose, yaw, pitch, dt);
    this.mist.forEach((s, i) => { s.position.x += Math.sin(time * 0.13 + i * 1.7) * dt * 0.12; });
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
