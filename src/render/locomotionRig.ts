import * as THREE from 'three';

/** Two rigid segments, targeting a world-space endpoint with an anatomical bend hint.
 * Aim with shortest-arc world rotations; never assume Mixamo's local X is the hinge. */
export class LimbSolver {
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
    this.aim(upper, this.a, this.b, this.elbow);
    lower.getWorldPosition(this.b); tip.getWorldPosition(this.c);
    this.elbow.copy(this.a).addScaledVector(this.direction, d);
    this.aim(lower, this.b, this.c, this.elbow);
  }

  private aim(joint: THREE.Object3D, base: THREE.Vector3, end: THREE.Vector3, target: THREE.Vector3): void {
    this.turn.setFromUnitVectors(this.u.subVectors(end, base).normalize(), this.v.subVectors(target, base).normalize());
    joint.getWorldQuaternion(this.world).premultiply(this.turn);
    this.orient(joint, this.world);
  }

  orient(joint: THREE.Object3D, orientation: THREE.Quaternion): void {
    joint.parent?.getWorldQuaternion(this.parent);
    joint.quaternion.copy(this.parent.invert()).multiply(orientation);
  }
}

/** Highest reachable hip height for a fixed ankle, with a reserve for knee flex. */
export function supportCeiling(ankleY: number, horizontal: number, length: number): number {
  const reach = Math.max(0, length - 0.012);
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
