// Render-only gait. Coordinates here match the simulation (+z forward at yaw 0).
// The world/controller remains authoritative; planted feet never move the actor.
export interface PacePoint { x: number; y: number; z: number }
export interface FootContact extends PacePoint { yaw: number; pitch: number; planted: boolean; plantId: number }
export type FloorHeight = (x: number, z: number, reference: number) => number;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const damping = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const ease = (t: number) => t * t * (3 - 2 * t);
// Trapezoidal swing velocity: ease toe-off/landing without crowding most
// horizontal travel into one or two sampled frames at sprint speed.
const flight = (t: number): number => {
  const ramp = 0.19;
  if (t < ramp) return t * t / (2 * ramp * (1 - ramp));
  if (t > 1 - ramp) return 1 - (1 - t) ** 2 / (2 * ramp * (1 - ramp));
  return (t - ramp / 2) / (1 - ramp);
};
const foot = (): FootContact => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, planted: true, plantId: 0 });

export class WatchmanPace {
  readonly feet = [foot(), foot()] as const;
  speed = 0;
  forward = 0;
  lateral = 0;
  run = 0;
  swing = 0; // signed upper-body counter-swing, continuous across both gaits
  activity = 0;
  turn = 0;
  support = 0; // -1 = weight over left, +1 = over right
  compression = 0; // soft knee loading at touchdown
  accelForward = 0;
  accelLateral = 0;
  resetThisFrame = true;
  get pendingPlant(): Readonly<FootContact> | null { return this.committed && this.index >= 0 ? this.target : null; }
  get landingWeight(): number { return this.index < 0 ? 0 : ease(clamp((this.progress - 0.42) / 0.49, 0, 1)); }
  private previous: PacePoint | null = null;
  private lastYaw = 0;
  private index = -1;
  private next = 0;
  private progress = 0;
  private size = 0;
  private transfer = 0;
  private stairs = false;
  private swingX = 0;
  private swingZ = 0;
  private committed = false;
  private vx = 0;
  private vz = 0;
  private from = foot();
  private target = foot();
  private desired = foot();
  private settling = false;
  private finishSettling = false;

  reset(): void { this.previous = null; }

  private place(out: FootContact, at: PacePoint, yaw: number, i: number, tx: number, tz: number, ground: FloorHeight): void {
    const side = i === 0 ? -1 : 1;
    out.x = at.x + Math.cos(yaw) * side * 0.105 + tx;
    out.z = at.z - Math.sin(yaw) * side * 0.105 + tz;
    out.yaw = yaw + side * 0.085;
    this.seat(out, at.y, ground);
  }

  private seat(out: FootContact, y: number, ground: FloorHeight): void {
    out.y = ground(out.x, out.z, y);
    // The short treads can support the midsole but not the full length of a boot.
    // Allow heel overhang rather than burying the forefoot in the uphill riser.
    const ux = Math.sin(out.yaw), uz = Math.cos(out.yaw);
    if (ground(out.x + ux * 0.135, out.z + uz * 0.135, y) > out.y + 0.10) {
      for (let d = 0.025; d <= 0.125; d += 0.025) {
        const x = out.x - ux * d, z = out.z - uz * d;
        if (Math.abs(ground(x, z, y) - out.y) < 0.025 && ground(x + ux * 0.135, z + uz * 0.135, y) < out.y + 0.10) {
          out.x = x; out.z = z; break;
        }
      }
    }
    out.pitch = 0;
  }

  update(at: PacePoint, yaw: number, dt: number, ground: FloorHeight): void {
    if (!(dt > 0)) return;
    this.resetThisFrame = false;
    const previous = this.previous;
    const dx = at.x - (previous?.x ?? at.x), dz = at.z - (previous?.z ?? at.z);
    const distance = Math.hypot(dx, dz);
    this.previous = { ...at };
    if (!previous || dt > 0.22 || distance > Math.max(0.48, dt * 4.5) || Math.abs(at.y - previous.y) > 0.55) {
      this.feet.forEach((f, i) => { this.place(f, at, yaw, i, 0, 0, ground); f.planted = true; });
      this.resetThisFrame = true;
      this.lastYaw = yaw;
      this.accelForward = this.accelLateral = this.transfer = this.support = this.compression = 0;
      this.index = -1; this.next = 0; this.progress = this.vx = this.vz = this.speed = this.activity = this.run = this.lateral = this.forward = this.swing = this.turn = 0;
      this.settling = this.finishSettling = false;
      return;
    }
    this.turn = mix(this.turn, clamp(angle(yaw - this.lastYaw) / dt, -5, 5), damping(10, dt));
    this.lastYaw = yaw;
    // Ignore numerical collision jitter, not intentional slow movement.
    const moving = distance > dt * 0.035;
    const k = damping(moving ? 15 : 23, dt);
    const oldVx = this.vx, oldVz = this.vz;
    this.vx = mix(this.vx, moving ? dx / dt : 0, k);
    this.vz = mix(this.vz, moving ? dz / dt : 0, k);
    this.speed = mix(this.speed, moving ? clamp(distance / dt, 0, 3.6) : 0, damping(14, dt));
    this.forward = Math.sin(yaw) * this.vx + Math.cos(yaw) * this.vz;
    this.lateral = Math.cos(yaw) * this.vx - Math.sin(yaw) * this.vz;
    const ax = (this.vx - oldVx) / dt, az = (this.vz - oldVz) / dt;
    this.accelForward = mix(this.accelForward, clamp(Math.sin(yaw) * ax + Math.cos(yaw) * az, -12, 12), damping(9, dt));
    this.accelLateral = mix(this.accelLateral, clamp(Math.cos(yaw) * ax - Math.sin(yaw) * az, -12, 12), damping(9, dt));
    this.run = mix(this.run, clamp((this.speed - 1.83) / 1.23, 0, 1), damping(8, dt));
    this.activity = mix(this.activity, clamp(this.speed / 1.35, 0, 1), damping(13, dt));

    const ux = moving ? dx / distance : 0, uz = moving ? dz / distance : 0;
    const slope = ground(at.x + ux * 0.28, at.z + uz * 0.28, at.y) - ground(at.x - ux * 0.22, at.z - uz * 0.22, at.y);
    const stairs = Math.abs(slope) > 0.14;
    const strafe = Math.abs(this.lateral) > Math.abs(this.forward) * 1.1;
    const stride = stairs ? 0.30 : strafe ? 0.234 : this.forward < -0.3 ? 0.31 : mix(0.385, 0.50, this.run);
    this.compression *= Math.exp(-17 * dt);
    if (this.index < 0 && this.transfer > 0 && moving) {
      // Both soles remain fixed for the brief, loaded part of the weight transfer.
      this.transfer -= distance;
      this.support = mix(this.support, this.next === 0 ? 1 : -1, damping(16, dt));
      this.swing *= Math.exp(-10 * dt);
      if (this.transfer > 0) return;
    }
    if (this.index < 0) {
      this.transfer = 0;
      // At rest, square up only when a foot was left substantially behind or
      // the body turned relative to the planted boot. A held key at a wall can't restart gait.
      if (!moving) {
        let candidate = -1, worst = 0.085;
        this.feet.forEach((f, i) => {
          this.place(this.desired, at, yaw, i, 0, 0, ground);
          const error = Math.hypot(f.x - this.desired.x, f.z - this.desired.z) + 0.17 * Math.abs(angle(f.yaw - this.desired.yaw));
          if (error > worst) { worst = error; candidate = i; }
        });
        if (candidate < 0) {
          this.swing *= Math.exp(-14 * dt);
          this.support *= Math.exp(-9 * dt);
          return;
        }
        this.next = candidate;
      } else if (this.activity < 0.53) {
        if (strafe) this.next = this.lateral < 0 ? 0 : 1;
        else {
          const lag = (this.feet[0].x - this.feet[1].x) * ux + (this.feet[0].z - this.feet[1].z) * uz;
          if (Math.abs(lag) > 0.06) this.next = lag < 0 ? 0 : 1;
        }
      }
      this.index = this.next;
      this.next = 1 - this.index;
      this.progress = 0;
      this.committed = false;
      this.stairs = stairs;
      this.size = stride;
      this.swingX = ux; this.swingZ = uz;
      this.settling = !moving;
      this.finishSettling = this.settling;
      Object.assign(this.from, this.feet[this.index]);
      this.aim(this.target, at, yaw, ground, moving, dx, dz, distance);
      this.feet[this.index].planted = false;
    }

    if (!moving && this.speed < 0.24) this.finishSettling = true;
    if (moving && !this.settling) this.finishSettling = false;
    const quiet = this.finishSettling;
    if (!this.committed) {
      this.aim(this.desired, at, yaw, ground, !quiet, dx, dz, distance);
      const follow = damping(quiet ? 19 : 16, dt);
      this.target.x = mix(this.target.x, this.desired.x, follow);
      this.target.z = mix(this.target.z, this.desired.z, follow);
      this.target.yaw += angle(this.desired.yaw - this.target.yaw) * follow;
      if (this.progress >= 0.36) {
        this.seat(this.target, at.y, ground);
        this.committed = true;
      } else {
        this.target.y = mix(this.target.y, ground(this.target.x, this.target.z, at.y), follow);
      }
    }
    this.size = mix(this.size, this.stairs ? 0.30 : stride, damping(8, dt));
    const advance = moving && !this.settling ? distance / this.size : dt * (quiet ? 5.9 : 2.4);
    this.progress = Math.min(1, this.progress + advance);
    const t = this.progress, travel = flight(t);
    const active = this.feet[this.index];
    active.x = mix(this.from.x, this.target.x, travel);
    active.z = mix(this.from.z, this.target.z, travel);
    active.yaw = this.from.yaw + angle(this.target.yaw - this.from.yaw) * travel;
    const landing = t === 1;
    if (landing) {
      active.y = this.target.y;
      active.pitch = 0;
    } else {
      const toeX = Math.sin(active.yaw) * 0.127, toeZ = Math.cos(active.yaw) * 0.127;
      const stepY = ground(active.x, active.z, at.y);
      const dy = this.target.y - this.from.y;
      const arc = Math.sin(Math.PI * t);
      // Rise before the horizontal sweep, and lower after crossing the nosing.
      // This is anchored at both contacts and doesn't inherit discrete tread Y.
      const heightT = dy >= 0 ? ease(t + 0.73 * t * (1 - t)) : ease(t - 0.24 * t * (1 - t));
      const lift = arc * (this.settling ? 0.045 : mix(0.080, 0.122, this.run) + Math.min(0.060, Math.abs(dy) * 0.19));
      active.pitch = arc * (0.27 * t - mix(0.12, 0.17, this.run));
      let height = mix(this.from.y, this.target.y, heightT) + lift;
      if (this.stairs || stairs || Math.abs(dy) > 0.12 || Math.abs(stepY - this.from.y) > 0.11) {
        // Approximate the sloping clearance envelope with a short footprint
        // sweep. A discrete toe sample would pop down an entire riser in one
        // frame during descent. The contacts themselves use exact tread Y.
        let clear = 0;
        for (const reach of [-0.096, -0.064, -0.032, 0, 0.032, 0.064, 0.096]) {
          const x = active.x + this.swingX * reach, z = active.z + this.swingZ * reach;
          clear += Math.max(ground(x, z, at.y), ground(x + toeX, z + toeZ, at.y));
        }
        const guard = ease(Math.min(1, t / 0.30)) * ease(Math.min(1, (1 - t) / 0.56));
        height += Math.max(0, clear / 7 + 0.018 - height) * guard;
      } else height = Math.max(stepY, height);
      active.y = height;
    }
    this.support = mix(this.support, this.index === 0 ? 1 : -1, damping(13, dt));
    this.swing = mix(this.swing, (this.index === 0 ? -1 : 1) * Math.sin(Math.PI * t) * this.activity, damping(18, dt));
    if (landing) {
      active.planted = true;
      active.plantId++;
      this.index = -1;
      this.transfer = this.stairs ? 0.027 : mix(0.050, 0.028, this.run);
      this.compression = quiet ? 0.25 : 0.45 + this.run * 0.55;
    }
  }

  private aim(out: FootContact, at: PacePoint, yaw: number, ground: FloorHeight, moving: boolean, dx: number, dz: number, distance: number): void {
    const len = Math.hypot(this.vx, this.vz);
    // The preview includes the remainder of the swing so its touchdown is ahead
    // of the body, not still under the hip at sprint speed.
    const strafe = Math.abs(this.lateral) > Math.abs(this.forward) * 1.1;
    const lead = moving ? this.size * ((strafe ? 0.29 : this.stairs ? 0.40 : 0.42) + 0.65 * (1 - this.progress)) : 0;
    const live = distance > 1e-6;
    const ux = live ? dx / distance : len > 1e-3 ? this.vx / len : 0;
    const uz = live ? dz / distance : len > 1e-3 ? this.vz / len : 0;
    this.place(out, at, yaw, this.index, ux * lead, uz * lead, ground);
    const other = this.feet[1 - this.index], side = this.index === 0 ? -1 : 1;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const span = side * ((out.x - other.x) * rx + (out.z - other.z) * rz);
    if (span < 0.14) {
      const correction = Math.min(0.24, 0.14 - span) * side;
      out.x += correction * rx; out.z += correction * rz;
      out.y = ground(out.x, out.z, at.y);
    }
  }
}
