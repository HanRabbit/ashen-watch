// 越肩镜头（art pass 2 / 任务 B）：从 view.ts 抽出的防穿墙扫描 + 弹簧阻尼跟随。
// FOV 55° 基准，移动 +3°，冲刺拉远；转身横向延迟跟随；受击短促冲击（<0.15s）。
// fixedCam 供验收截图机位使用，逻辑与原来一致。
import * as THREE from 'three';
import { cameraClearT } from '../sim/collision';
import { ceilingY, groundY } from '../sim/level'; // map:
import { World } from '../sim/state';
import { lerp } from './geom';

const CAM = { dist: 3.4, shoulder: 0.78, pivotY: 1.62, minDist: 0.35, fov: 55 };
const FAN = { n: 12, step: (3 * Math.PI) / 180 };

export class CameraRig {
  fixedCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  private camDist = CAM.dist;
  private camShoulder = CAM.shoulder;
  private yawS: number | null = null;
  private pitchS = 0;
  private fov = CAM.fov;
  private moveBlend = 0;
  private sprintBlend = 0;
  private kickT = 0;
  private kickSeed = 0;
  private springPos = new THREE.Vector3();
  private springVel = new THREE.Vector3();
  private sprung = false;
  private world: World | null = null;
  private tmp = new THREE.Vector3();
  private anchor = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** 受击冲击：短促、单次，不持续晃动。 */
  kick(strength = 1): void {
    this.kickT = 0.13 * strength;
    this.kickSeed = Math.random() * 100;
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

  /** 返回镜头距离（view 用它决定玩家模型可见性，避免贴脸穿模）。 */
  update(w: World, p: { x: number; z: number; y?: number }, yaw: number, pitch: number, dt: number): number { // map:
    if (this.fixedCam) {
      const f = this.fixedCam;
      this.camera.position.set(f.pos[0], f.pos[1], -f.pos[2]);
      this.camera.lookAt(f.look[0], f.look[1], -f.look[2]);
      if (this.camera.fov !== CAM.fov) { this.camera.fov = CAM.fov; this.camera.updateProjectionMatrix(); }
      this.sprung = false;
      return 10;
    }
    if (this.world !== w) {
      this.world = w;
      this.sprung = false;
      this.camDist = CAM.dist;
      this.camShoulder = CAM.shoulder;
      this.yawS = yaw;
      this.pitchS = pitch;
    }
    const moving = w.player.moving;
    const sprinting = moving && w.player.sprinting;
    this.moveBlend = lerp(this.moveBlend, moving ? 1 : 0, Math.min(1, dt * 4));
    this.sprintBlend = lerp(this.sprintBlend, sprinting ? 1 : 0, Math.min(1, dt * 4));

    // 转身惯性：镜头偏航临界阻尼滞后于角色偏航
    if (this.yawS === null) this.yawS = yaw;
    let dy = yaw - this.yawS;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawS += dy * Math.min(1, dt * 8.5);
    this.pitchS = lerp(this.pitchS, pitch, Math.min(1, dt * 12));
    const cyaw = this.yawS, cpitch = this.pitchS;

    const dist = CAM.dist + this.sprintBlend * 0.5;
    const sy = Math.sin(cyaw), cy = Math.cos(cyaw), cp = Math.cos(cpitch), sp = Math.sin(cpitch);
    const py = (p.y ?? groundY(p.x, p.z)) + CAM.pivotY; // map:
    const reach = CAM.shoulder + 0.3;
    const side = this.sweep(p.x, p.z, py, cyaw + Math.PI / 2, reach, py, w.doors);
    const shHard = Math.max(0, Math.min(CAM.shoulder, side[0] * reach - 0.3));
    const shWant = Math.max(0, Math.min(CAM.shoulder, side[1] * reach - 0.3));
    this.camShoulder = Math.min(shHard, shWant < this.camShoulder ? shWant : lerp(this.camShoulder, shWant, Math.min(1, dt * 6)));
    const sh = this.camShoulder;
    const ax = p.x + cy * sh, az = p.z - sy * sh;
    const back = this.sweep(ax, az, py, cyaw + Math.PI, cp * dist, py + sp * dist, w.doors);
    let hard = Math.max(CAM.minDist, back[0] * dist - 0.25);
    const top = ceilingY(p.x, p.z, w.player.floor); // map:
    if (sp > 0.01) hard = Math.min(hard, Math.max(CAM.minDist, (top - py) / sp));
    if (sp < -0.01) hard = Math.min(hard, Math.max(CAM.minDist, (py - 0.25 - (p.y ?? groundY(p.x, p.z))) / -sp)); // map:
    const want = Math.min(hard, Math.max(CAM.minDist, back[1] * dist - 0.25));
    this.camDist = Math.min(hard, want < this.camDist ? want : lerp(this.camDist, want, Math.min(1, dt * 5)));
    const d = this.camDist;

    const target = this.tmp.set(ax - sy * cp * d, py + sp * d, -(az - cy * cp * d));
    // 临界阻尼弹簧平滑最终机位（无抖动、无过冲）
    if (!this.sprung) { this.springPos.copy(target); this.springVel.set(0, 0, 0); this.sprung = true; }
    const omega = 20;
    const step = Math.min(dt, 1 / 30);
    this.springVel.x += (omega * omega * (target.x - this.springPos.x) - 2 * omega * this.springVel.x) * step;
    this.springVel.y += (omega * omega * (target.y - this.springPos.y) - 2 * omega * this.springVel.y) * step;
    this.springVel.z += (omega * omega * (target.z - this.springPos.z) - 2 * omega * this.springVel.z) * step;
    this.springPos.addScaledVector(this.springVel, step);
    // The target boom is collision-tested, but its spring can still lag across
    // a wall or the lip of a staircase when the player turns while descending.
    // Clip the resulting boom too, so smoothing never moves the view through stone.
    const anchor = this.anchor.set(ax, py, -az);
    const t = cameraClearT(ax, az, py, this.springPos.x, -this.springPos.z, this.springPos.y, w.doors);
    if (t < 1) {
      const length = anchor.distanceTo(this.springPos);
      this.springPos.lerp(anchor, 1 - Math.max(0, t - 0.18 / Math.max(0.18, length)));
      this.springVel.set(0, 0, 0);
    }
    this.camera.position.copy(this.springPos);

    // 受击冲击： look 目标短促抖动，幅度极小
    let kx = 0, ky = 0;
    if (this.kickT > 0) {
      const k = this.kickT / 0.13;
      kx = Math.sin(this.kickSeed * 13.7) * 0.06 * k;
      ky = Math.cos(this.kickSeed * 7.3) * 0.045 * k;
      this.kickT -= dt;
    }
    this.camera.lookAt(ax + sy * cp * 6 + kx, py - sp * 6 + ky, -(az + cy * cp * 6));

    // FOV：移动轻微前移，冲刺再拉一点
    const fovWant = CAM.fov + 3 * this.moveBlend + 1.2 * this.sprintBlend;
    this.fov = lerp(this.fov, fovWant, Math.min(1, dt * 5));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    return anchor.distanceTo(this.springPos);
  }
}