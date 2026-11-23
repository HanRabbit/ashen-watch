// Render-only gait. Coordinates here match the simulation (+z forward at yaw 0).
// The world/controller remains authoritative; planted feet never move the actor.
export interface PacePoint { x: number; y: number; z: number }
export interface FootContact extends PacePoint { yaw: number; planted: boolean }
export type FloorHeight = (x: number, z: number, reference: number) => number;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const damping = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const foot = (): FootContact => ({ x: 0, y: 0, z: 0, yaw: 0, planted: true });

export class WatchmanPace {
  readonly feet = [foot(), foot()] as const;
  speed = 0;
  forward = 0;
  lateral = 0;
  run = 0;
  swing = 0; // signed upper-body counter-swing, continuous across both gaits
  activity = 0;
  turn = 0;
  private previous: PacePoint | null = null;
  private lastYaw = 0;
  private index = -1;
  private next = 0;
  private progress = 0;
  private size = 0;
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
    out.x = at.x + Math.cos(yaw) * side * 0.12 + tx;
    out.z = at.z - Math.sin(yaw) * side * 0.12 + tz;
    out.y = ground(out.x, out.z, at.y);
    out.yaw = yaw + side * 0.10;
  }

  update(at: PacePoint, yaw: number, dt: number, ground: FloorHeight): void {
    const previous = this.previous;
    const dx = at.x - (previous?.x ?? at.x), dz = at.z - (previous?.z ?? at.z);
    const distance = Math.hypot(dx, dz);
    this.previous = { ...at };
    if (!previous || dt > 0.22 || distance > Math.max(0.48, dt * 4.5) || Math.abs(at.y - previous.y) > 0.55) {
      this.feet.forEach((f, i) => { this.place(f, at, yaw, i, 0, 0, ground); f.planted = true; });
      this.lastYaw = yaw;
      this.index = -1; this.next = 0; this.progress = this.vx = this.vz = this.speed = this.activity = this.run = this.lateral = this.forward = this.swing = this.turn = 0;
      this.settling = this.finishSettling = false;
      return;
    }
    if (dt <= 0) return;
    this.turn = mix(this.turn, clamp(angle(yaw - this.lastYaw) / dt, -5, 5), damping(10, dt));
    this.lastYaw = yaw;
    // Ignore numerical collision jitter, not intentional slow movement.
    const moving = distance > dt * 0.035;
    const k = damping(moving ? 15 : 23, dt);
    this.vx = mix(this.vx, moving ? dx / dt : 0, k);
    this.vz = mix(this.vz, moving ? dz / dt : 0, k);
    this.speed = mix(this.speed, moving ? clamp(distance / dt, 0, 3.6) : 0, damping(14, dt));
    this.forward = Math.sin(yaw) * this.vx + Math.cos(yaw) * this.vz;
    this.lateral = Math.cos(yaw) * this.vx - Math.sin(yaw) * this.vz;
    this.run = mix(this.run, clamp((this.speed - 1.85) / 1.25, 0, 1), damping(10, dt));
    this.activity = mix(this.activity, clamp(this.speed / 1.35, 0, 1), damping(13, dt));

    if (this.index < 0) {
      // At rest, square up only when a foot was left substantially behind or
      // the body turned relative to the planted boot. A held key at a wall can't restart gait.
      if (!moving) {
        let candidate = -1, worst = 0.10;
        this.feet.forEach((f, i) => {
          this.place(this.desired, at, yaw, i, 0, 0, ground);
          const error = Math.hypot(f.x - this.desired.x, f.z - this.desired.z) + 0.17 * Math.abs(angle(f.yaw - this.desired.yaw));
          if (error > worst) { worst = error; candidate = i; }
        });
        if (candidate < 0) { this.swing *= 1 - damping(14, dt); return; }
        this.next = candidate;
      } else if (this.activity < 0.45 && Math.abs(this.lateral) > Math.abs(this.forward) * 1.1) {
        this.next = this.lateral < 0 ? 0 : 1;
      }
      this.index = this.next;
      this.next = 1 - this.index;
      this.progress = 0;
      this.size = mix(0.37, 0.53, this.run);
      this.settling = !moving;
      this.finishSettling = this.settling;
      Object.assign(this.from, this.feet[this.index]);
      this.aim(this.target, at, yaw, ground, moving, dx, dz, distance);
      this.feet[this.index].planted = false;
    }

    if (!moving && this.speed < 0.16) this.finishSettling = true;
    if (moving && !this.settling) this.finishSettling = false;
    const quiet = this.finishSettling;
    this.aim(this.desired, at, yaw, ground, !quiet, dx, dz, distance);
    // Follow intentional turns and stride length changes without snapping an airborne foot.
    const follow = damping(quiet ? 18 : 14, dt);
    this.target.x = mix(this.target.x, this.desired.x, follow);
    this.target.z = mix(this.target.z, this.desired.z, follow);
    this.target.y = ground(this.target.x, this.target.z, at.y);
    this.target.yaw += angle(this.desired.yaw - this.target.yaw) * follow;
    const advance = moving && !this.settling ? distance / this.size : dt * (quiet ? 5.7 : 1.25);
    this.progress = Math.min(1, this.progress + advance);
    const t = this.progress, ease = t * t * (3 - 2 * t);
    const active = this.feet[this.index];
    active.x = mix(this.from.x, this.target.x, ease);
    active.z = mix(this.from.z, this.target.z, ease);
    const stepTerrain = ground(active.x, active.z, at.y);
    // Clear the next riser early on climbs, and linger over the edge on descents.
    const lift = Math.sin(Math.PI * t) * (quiet ? 0.045 : mix(0.085, 0.14, this.run));
    active.y = Math.max(mix(this.from.y, this.target.y, ease), stepTerrain) + lift;
    active.yaw = this.from.yaw + angle(this.target.yaw - this.from.yaw) * ease;
    this.swing = mix(this.swing, (this.index === 0 ? -1 : 1) * Math.sin(Math.PI * t) * this.activity, damping(18, dt));
    if (t === 1) { active.planted = true; this.index = -1; }
  }

  private aim(out: FootContact, at: PacePoint, yaw: number, ground: FloorHeight, moving: boolean, dx: number, dz: number, distance: number): void {
    const len = Math.hypot(this.vx, this.vz);
    // The preview includes the remainder of the swing so its touchdown is ahead
    // of the body, not still under the hip at sprint speed.
    const lead = moving ? this.size * (0.50 + 0.66 * (1 - this.progress)) : 0;
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
