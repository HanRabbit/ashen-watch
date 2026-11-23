import * as THREE from 'three';

/** Two rigid segments, targeting a world-space endpoint with an anatomical bend hint.
 * Map the calibrated bend plane when available: shortest-arc alone reaches
 * the endpoint but can leave the skinned knee twisted on the wrong axis. */
export class LimbSolver {
  private bind = new WeakMap<THREE.Object3D, THREE.Quaternion>();
  private normal = new THREE.Vector3(); private cross = new THREE.Vector3();
  private matrix = new THREE.Matrix4();

  calibrate(upper: THREE.Object3D, lower: THREE.Object3D, tip: THREE.Object3D): void {
    upper.getWorldPosition(this.a); lower.getWorldPosition(this.b); tip.getWorldPosition(this.c);
    this.u.subVectors(this.b, this.a).normalize();
    this.v.subVectors(this.c, this.b).normalize();
    this.normal.crossVectors(this.v, this.u);
    if (this.normal.lengthSq() < 1e-5) return;
    this.normal.normalize();
    this.calibrateJoint(upper, this.u);
    this.calibrateJoint(lower, this.v);
  }

  private calibrateJoint(joint: THREE.Object3D, axis: THREE.Vector3): void {
    this.bendFrame(axis);
    this.bind.set(joint, this.turn.clone().invert().multiply(joint.getWorldQuaternion(this.world)));
  }

  private bendFrame(axis: THREE.Vector3): void {
    this.cross.crossVectors(this.normal, axis).normalize();
    this.turn.setFromRotationMatrix(this.matrix.makeBasis(this.cross, this.normal, axis));
  }

  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  private direction = new THREE.Vector3(); private bend = new THREE.Vector3(); private elbow = new THREE.Vector3();
  private u = new THREE.Vector3(); private v = new THREE.Vector3();
  private turn = new THREE.Quaternion(); private parent = new THREE.Quaternion(); private world = new THREE.Quaternion();

  solve(upper: THREE.Object3D, lower: THREE.Object3D, tip: THREE.Object3D, target: THREE.Vector3, poleDirection: THREE.Vector3): void {
    upper.getWorldPosition(this.a); lower.getWorldPosition(this.b); tip.getWorldPosition(this.c);
    const l1 = this.a.distanceTo(this.b), l2 = this.b.distanceTo(this.c);
    if (Math.min(l1, l2) < 0.001) return;
    this.direction.subVectors(target, this.a);
    const norm = this.direction.length();
    if (norm < 1e-5) return;
    this.direction.multiplyScalar(1 / norm);
    const d = THREE.MathUtils.clamp(norm, Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
    this.bend.copy(poleDirection).addScaledVector(this.direction, -poleDirection.dot(this.direction));
    if (this.bend.lengthSq() < 1e-5) this.bend.subVectors(this.b, this.a).addScaledVector(this.direction, -this.bend.dot(this.direction));
    if (this.bend.lengthSq() < 1e-5) {
      this.bend.set(Math.abs(this.direction.x) < 0.8 ? 1 : 0, 0, Math.abs(this.direction.x) < 0.8 ? 0 : 1);
      this.bend.addScaledVector(this.direction, -this.bend.dot(this.direction));
    }
    const adjacent = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    this.elbow.copy(this.a).addScaledVector(this.direction, adjacent)
      .addScaledVector(this.bend.normalize(), Math.sqrt(Math.max(0, l1 * l1 - adjacent * adjacent)));
    this.normal.crossVectors(this.direction, this.bend).normalize();
    this.aim(upper, this.a, this.b, this.elbow);
    lower.getWorldPosition(this.b); tip.getWorldPosition(this.c);
    this.elbow.copy(this.a).addScaledVector(this.direction, d);
    this.aim(lower, this.b, this.c, this.elbow);
  }

  private aim(joint: THREE.Object3D, base: THREE.Vector3, end: THREE.Vector3, target: THREE.Vector3): void {
    this.v.subVectors(target, base).normalize();
    const bind = this.bind.get(joint);
    if (bind) {
      this.bendFrame(this.v);
      this.orient(joint, this.turn.multiply(bind));
      return;
    }
    this.turn.setFromUnitVectors(this.u.subVectors(end, base).normalize(), this.v);
    joint.getWorldQuaternion(this.world).premultiply(this.turn);
    this.orient(joint, this.world);
  }

  orient(joint: THREE.Object3D, orientation: THREE.Quaternion): void {
    joint.parent?.getWorldQuaternion(this.parent);
    joint.quaternion.copy(this.parent.invert()).multiply(orientation);
  }
}

/** Highest reachable hip height for a fixed ankle, with a reserve for knee flex. */
export function supportCeiling(ankleY: number, horizontal: number, length: number, reserve = 0.012): number {
  const reach = Math.max(0, length - reserve);
  return ankleY + Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal));
}

/** Analytic damped oscillator. Subdividing a render tick does not change its
 * response to a constant drive. The small overshoot reads as hanging mass. */
export class HangingAngle {
  value = 0;
  private velocity = 0;

  reset(): void { this.value = this.velocity = 0; }

  update(target: number, dt: number, omega = 13, decay = 8): number {
    const x = this.value - target, v = this.velocity;
    const w = Math.sqrt(omega * omega - decay * decay);
    const c = Math.cos(w * dt), s = Math.sin(w * dt), e = Math.exp(-decay * dt);
    this.value = target + e * (x * c + (v + decay * x) / w * s);
    this.velocity = e * (v * c - (omega * omega * x + decay * v) / w * s);
    return this.value;
  }
}

/** Small, presentation-only root lag. Integrate the linear input segment (the
 * fixed-step interpolated position), rather than treating it as a frame-end
 * jump. Velocity is continuous when the movement input starts/stops/reverses.
 * This never predicts ahead of the controller or changes collision/camera. */
export class WatchmanRoot {
  x = 0;
  z = 0;
  private lastX = 0;
  private lastZ = 0;
  private ready = false;

  update(x: number, z: number, dt: number, reset: boolean): void {
    if (!this.ready || reset) {
      this.x = this.lastX = x;
      this.z = this.lastZ = z;
      this.ready = true;
      return;
    }
    if (!(dt > 0)) return;
    const k = -Math.expm1(-44 * dt);
    const lag = k / (44 * dt);
    this.x += (this.lastX - this.x) * k + (x - this.lastX) * (1 - lag);
    this.z += (this.lastZ - this.z) * k + (z - this.lastZ) * (1 - lag);
    this.lastX = x;
    this.lastZ = z;
    const dx = this.x - x, dz = this.z - z, distance = Math.hypot(dx, dz);
    if (distance > 0.085) {
      this.x = x + dx * (0.085 / distance);
      this.z = z + dz * (0.085 / distance);
    }
  }
}

/** A snap mouse input can otherwise rotate every planted joint by ~35° on the
 * first frame. Take the shortest arc and limit large turns, easing near the
 * goal. Integrate the capped and exponential portions across the same dt. */
export function watchmanFacing(yaw: number, target: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  const error = Math.abs(delta), rate = 14, limit = 12;
  const cappedTime = Math.max(0, (error - limit / rate) / limit);
  const travel = limit * Math.min(dt, cappedTime)
    + Math.min(error, limit / rate) * -Math.expm1(-rate * Math.max(0, dt - cappedTime));
  return yaw + Math.sign(delta) * travel;
}
