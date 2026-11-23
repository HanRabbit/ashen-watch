// 越肩镜头：用位移驱动焦段与跟拍距离，用物理净空限制构图。
// 55° 基准，移动最多 +3°，只有确实跑起来才拉远。fixedCam 仅用于验收机位。
import * as THREE from 'three';
import { PLAYER } from '../config';
import { cameraClearT } from '../sim/collision';
import { ceilingY, groundY } from '../sim/level';
import { World } from '../sim/state';
import { clamp01, lerp } from './geom';

const CAM = { dist: 3.4, shoulder: 0.78, pivotY: 1.62, fov: 55, margin: 0.25 };
const damp = (from: number, to: number, rate: number, dt: number): number =>
  lerp(from, to, -Math.expm1(-rate * dt));
const FAN = { n: 12, step: (3 * Math.PI) / 180 };

export class CameraRig {
  fixedCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  private camDist = CAM.dist;
  private camShoulder = CAM.shoulder;
  private yawS = 0;
  private pitchS = 0;
  private fov = CAM.fov;
  private speed = 0;
  private prevX = 0;
  private prevZ = 0;
  private kickT = 0;
  private kickSeed = 0;
  private springPos = new THREE.Vector3();
  private springVel = new THREE.Vector3();
  private springOffset = new THREE.Vector3();
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
  update(w: World, p: { x: number; z: number; y?: number }, yaw: number, pitch: number, dt: number): number {
    if (this.fixedCam) {
      const f = this.fixedCam;
      this.camera.position.set(f.pos[0], f.pos[1], -f.pos[2]);
      this.camera.lookAt(f.look[0], f.look[1], -f.look[2]);
      if (this.camera.fov !== CAM.fov) { this.camera.fov = CAM.fov; this.camera.updateProjectionMatrix(); }
      this.sprung = false;
      return 10;
    }
    const travel = Math.hypot(p.x - this.prevX, p.z - this.prevZ);
    // A fresh world or a return from a fixed camera must not inherit lens, kick or pose lag.
    if (this.world !== w || !this.sprung || travel > 1.25) {
      this.world = w;
      this.sprung = false;
      this.camDist = CAM.dist;
      this.camShoulder = CAM.shoulder;
      this.yawS = yaw;
      this.pitchS = pitch;
      this.speed = 0;
      this.fov = CAM.fov;
      this.kickT = 0;
    } else if (dt > 0) {
      // player.moving is the input intent, including when a wall has stopped the player.
      this.speed = damp(this.speed, Math.min(PLAYER.sprintSpeed, travel / dt), 7, dt);
    }
    this.prevX = p.x;
    this.prevZ = p.z;

    const dy = yaw - this.yawS;
    this.yawS += damp(0, Math.atan2(Math.sin(dy), Math.cos(dy)), 10, dt);
    this.pitchS = damp(this.pitchS, pitch, 14, dt);
    const cyaw = this.yawS, cpitch = this.pitchS;
    const stride = clamp01(this.speed / PLAYER.walkSpeed);
    const sprint = clamp01((this.speed - PLAYER.walkSpeed) / (PLAYER.sprintSpeed - PLAYER.walkSpeed));
    const dist = CAM.dist + sprint * 0.42;
    const sy = Math.sin(cyaw), cy = Math.cos(cyaw), cp = Math.cos(cpitch), sp = Math.sin(cpitch);
    const footY = p.y ?? groundY(p.x, p.z);
    const py = footY + CAM.pivotY;
    const reach = CAM.shoulder + 0.3;
    const side = this.sweep(p.x, p.z, py, cyaw + Math.PI / 2, reach, py, w.doors);
    const shHard = Math.max(0, Math.min(CAM.shoulder, side[0] * reach - 0.3));
    const shWant = Math.max(0, Math.min(CAM.shoulder, side[1] * reach - 0.3));
    this.camShoulder = Math.min(shHard, shWant < this.camShoulder ? shWant : damp(this.camShoulder, shWant, 6, dt));
    const sh = this.camShoulder;
    const ax = p.x + cy * sh, az = p.z - sy * sh;
    const back = this.sweep(ax, az, py, cyaw + Math.PI, cp * dist, py + sp * dist, w.doors);
    // Zero is safer than an artificial minimum boom in a tight doorway/stair throat.
    let hard = Math.max(0, back[0] * dist - CAM.margin);
    const top = ceilingY(p.x, p.z, w.player.floor);
    if (sp > 0.01) hard = Math.min(hard, Math.max(0, (top - CAM.margin - py) / sp));
    if (sp < -0.01) hard = Math.min(hard, (CAM.pivotY - CAM.margin) / -sp);
    const want = Math.min(hard, Math.max(0, back[1] * dist - CAM.margin));
    this.camDist = Math.min(hard, want < this.camDist ? want : damp(this.camDist, want, 4.5, dt));
    const d = this.camDist;

    const target = this.tmp.set(ax - sy * cp * d, py + sp * d, -(az - cy * cp * d));
    // Closed-form critically damped spring. Unlike clamped Euler steps this handles
    // a missed frame and reaches the same pose for a held target at 30 or 120 Hz.
    if (!this.sprung) {
      this.springPos.copy(target);
      this.springVel.set(0, 0, 0);
      this.sprung = true;
    } else {
      const omega = 22;
      const decay = Math.exp(-omega * dt);
      const offset = this.springOffset.subVectors(this.springPos, target);
      const impulse = this.springVel.addScaledVector(offset, omega);
      this.springPos.copy(target).addScaledVector(offset, decay).addScaledVector(impulse, dt * decay);
      this.springVel.multiplyScalar((1 - omega * dt) * decay).addScaledVector(offset, -omega * decay);
    }
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

    // Keep the lens quiet: walking and running share the moving FOV.
    this.fov = damp(this.fov, CAM.fov + 3 * stride, 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    return anchor.distanceTo(this.springPos);
  }
}
