// 反馈特效（art pass 2 / VFX）：脚步灰尘与水花、受击黑烟与红暗角强度、举灯逼退白烟。
// 全部用 Points 软粒子池，克制用量；低画质档整体关闭。
import * as THREE from 'three';
import { GHOST } from '../config';
import { groundY } from '../sim/level';
import { World } from '../sim/state';
import { clamp01 } from './geom';

const PUDDLES: [number, number, number][] = [[-4, 8, 1.1], [3.5, 18, 1.3], [-2, 24, 0.9], [6, 12, 0.8]];

export interface EmitOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number;
  life?: number;
  size?: number;
  grow?: number;
  color?: THREE.Color;
  gravity?: number;
  drag?: number;
}

/** 环形复用的软粒子池：自定义着色器画软圆点，尺寸随距离衰减，生命周期内淡出/长大。 */
export class SoftParticles {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aColor: THREE.BufferAttribute;
  private cursor = 0;

  constructor(n: number, additive = false) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n);
    const colors = new Float32Array(n * 3).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.aSize = new THREE.BufferAttribute(sizes, 1);
    this.aAlpha = new THREE.BufferAttribute(alphas, 1);
    this.aColor = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aColor', this.aColor);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aSize, aAlpha; attribute vec3 aColor;
        varying float vA; varying vec3 vC;
        void main() {
          vA = aAlpha; vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vC, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(o: EmitOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const spread = o.spread ?? 0.2;
    this.pos[i * 3] = o.pos.x + (Math.random() - 0.5) * spread;
    this.pos[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * spread * 0.5;
    this.pos[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * spread;
    const v = o.vel ?? new THREE.Vector3();
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread * 1.5;
    this.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread * 1.5;
    this.life[i] = this.maxLife[i] = o.life ?? 0.6;
    this.size0[i] = o.size ?? 0.12;
    this.grow[i] = o.grow ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    const c = o.color ?? new THREE.Color(0.6, 0.6, 0.6);
    this.aColor.setXYZ(i, c.r, c.g, c.b);
  }

  update(dt: number): void {
    const alphas = this.aAlpha.array as Float32Array;
    const sizes = this.aSize.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { alphas[i] = 0; continue; }
      this.life[i] -= dt;
      const k = clamp01(this.life[i] / this.maxLife[i]);
      const d = 1 - Math.min(1, this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      alphas[i] = k * k * 0.85;
      sizes[i] = this.size0[i] * (1 + (1 - k) * this.grow[i]);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }
}

const DUST = new THREE.Color(0x7d8288);
const SPLASH = new THREE.Color(0xb9c6cf);
const BLACK_SMOKE = new THREE.Color(0x111419);
const WHITE_SMOKE = new THREE.Color(0xcdd5da);

/** 踩水涟漪：贴地 expanding 圆环，低透明冷灰，0.6s 内淡出（圣经 §10 水）。 */
class Ripples {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private cursor = 0;

  constructor() {
    const geo = new THREE.RingGeometry(0.82, 1, 24);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xb9c6cf, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.group.add(m);
      this.rings.push({ mesh: m, mat, t: 1 });
    }
  }

  spawn(x: number, y: number, z: number): void {
    const r = this.rings[this.cursor];
    this.cursor = (this.cursor + 1) % this.rings.length;
    r.t = 0;
    r.mesh.visible = true;
    r.mesh.position.set(x, y + 0.015, z);
    r.mesh.scale.setScalar(0.12);
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.6);
      const k = r.t;
      r.mesh.scale.setScalar(0.12 + k * 0.55);
      r.mat.opacity = 0.3 * (1 - k) * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
  }
}

export class Vfx {
  readonly group = new THREE.Group();
  /** 受击红暗角强度（0..1），view 的调色 pass 读取。 */
  hurt = 0;
  private soft = new SoftParticles(320, false);
  private glow = new SoftParticles(160, true);
  private ripples = new Ripples();
  private prevHp = 100;
  private stepPhase = 0;
  private stepSide = 1;
  private repelAcc = 0;
  private kickPending = false;
  private tmp = new THREE.Vector3();

  constructor() {
    this.group.add(this.soft.points, this.glow.points, this.ripples.group);
  }

  setQuality(q: 'high' | 'low'): void {
    this.group.visible = q === 'high';
  }

  consumeKick(): boolean {
    const k = this.kickPending;
    this.kickPending = false;
    return k;
  }

  update(w: World, pose: { x: number; z: number }, dt: number, time: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
    this.ripples.update(dt);
    this.hurt = Math.max(0, this.hurt - dt * 4.5);
    if (!this.group.visible) { this.prevHp = w.player.hp; return; }
    const px = pose.x, pz = pose.z;
    const py = groundY(px, pz);
    const p = w.player;

    // 脚步：石面灰尘 / 水洼水花，按步频触发
    const rate = p.sprinting ? 3.3 : 2.2;
    const before = Math.floor(this.stepPhase);
    this.stepPhase += dt * rate * (p.moving ? 1 : 0);
    if (Math.floor(this.stepPhase) > before && p.moving) {
      this.stepSide *= -1;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const fx = px + cy * 0.16 * this.stepSide + sy * 0.1;
      const fz = pz - sy * 0.16 * this.stepSide + cy * 0.1;
      const inPuddle = PUDDLES.some(([x, z, r]) => (fx - x) ** 2 + (fz - z) ** 2 < r * r);
      this.tmp.set(fx, py + 0.04, -fz);
      if (inPuddle) {
        this.ripples.spawn(fx, py, -fz);
        for (let i = 0; i < 9; i++) {
          this.glow.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 1.4 + Math.random(), 0), spread: 0.22, life: 0.38, size: 0.05, color: SPLASH, gravity: -5.5, drag: 0.4 });
        }
        for (let i = 0; i < 3; i++) {
          this.soft.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 0.5, 0), spread: 0.25, life: 0.45, size: 0.14, grow: 2, color: SPLASH, drag: 2 });
        }
      } else {
        const n = p.sprinting ? 6 : 4;
        for (let i = 0; i < n; i++) {
          this.soft.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 0.3, 0), spread: 0.16, life: 0.55, size: 0.09, grow: 2.4, color: DUST, drag: 2.2 });
        }
      }
    }

    // 受击：黑烟爆散 + 红暗角脉冲 + 镜头冲击请求
    if (w.player.hp < this.prevHp - 0.5) {
      this.hurt = 1;
      this.kickPending = true;
      this.tmp.set(px, py + 1.2, -pz);
      for (let i = 0; i < 14; i++) {
        this.soft.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 0.6, 0), spread: 0.7, life: 0.7, size: 0.2, grow: 2.6, color: BLACK_SMOKE, drag: 2.5 });
      }
      // 接触点（最近的鬼）也爆一团
      let best: { x: number; z: number } | null = null, bd = 9;
      for (const g of w.ghosts) {
        const d = (g.x - px) ** 2 + (g.z - pz) ** 2;
        if (d < bd) { bd = d; best = g; }
      }
      if (best && bd < 6.25) {
        this.tmp.set(best.x, groundY(best.x, best.z) + 1.1, -best.z);
        for (let i = 0; i < 10; i++) {
          this.soft.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 0.5, 0), spread: 0.6, life: 0.65, size: 0.22, grow: 2.4, color: BLACK_SMOKE, drag: 2.5 });
        }
      }
    }
    this.prevHp = w.player.hp;

    // 举灯照到鬼：鬼身冒白烟（退缩/逃跑状态持续冒）
    const lan = w.lantern;
    const lit = w.inv.hasLantern && lan.on && lan.oil > 0 && lan.raised;
    if (lit) {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      this.repelAcc += dt;
      if (this.repelAcc > 0.09) {
        this.repelAcc = 0;
        for (const g of w.ghosts) {
          if (g.mode === 'gone' || g.mode === 'dissolve') continue;
          const dx = g.x - px, dz = g.z - pz;
          const dist = Math.hypot(dx, dz);
          const range = g.kind === 'grey' ? GHOST.grey.repelRange : GHOST.wraith.repelRange;
          const facing = (dx * sy + dz * cy) / Math.max(0.01, dist);
          const cowed = g.mode === 'recoil' || g.mode === 'flee';
          if ((dist < range && facing > 0.25) || cowed) {
            this.tmp.set(g.x, groundY(g.x, g.z) + 1.2 + Math.random() * 0.5, -g.z);
            this.soft.emit({ pos: this.tmp, vel: new THREE.Vector3(0, 0.8, 0), spread: 0.45, life: 0.8, size: 0.16, grow: 2.2, color: WHITE_SMOKE, drag: 1.6 });
          }
        }
      }
    }
    void time;
  }
}