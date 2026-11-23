import { createMotionPose, sampleWatchmanMotion } from './watchmanMotion';

// Render-only gait. Coordinates here match the simulation (+z forward at yaw 0).
// The world/controller remains authoritative; planted feet never move the actor.
export interface PacePoint { x: number; y: number; z: number }
// Position is the sole marker in simulation world coordinates.
export interface FootContact extends PacePoint { yaw: number; pitch: number; planted: boolean; plantId: number }
// Sole marker in metres ahead of the ankle, along the boot axis.
export const WATCHMAN_SOLE_FORWARD = 0.095;
// Ground-plane samples about the sole marker, including corners for oblique nosings.
const BOOT_HEEL = -0.164;
const BOOT_SOLE = [[0, 0.137], [-0.048, 0.115], [0.048, 0.115],
  [-0.063, 0], [0.063, 0], [-0.043, -0.148], [0.043, -0.148], [0, BOOT_HEEL]] as const;
const STAIR_SOLE_SECTIONS = [0.04, 0.065, 0.095] as const;
const SEAT_DIRECTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2]] as const;
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

interface StairFlight {
  from: PacePoint & { yaw: number; pitch: number };
  start: number;
  nodes: { u: number; y: number; cost: number }[];
}

interface SwingStep {
  from: FootContact;
  target: FootContact;
  phase: number;
  rate: number; // swing clock in cycles/s, kept continuous through changes of speed
  redirected: boolean;
  span: number; // translation budget for the whole swing, latched at lift
  ratio: number; // retain short adaptive spacing on stairs
  lead: number;
  committed: boolean;
  quiet: boolean;
  stairs: boolean;
  stairFlight: StairFlight | null;
  ux: number;
  uz: number;
  jog: number;
  sprint: number;
  run: number;
  clip: number;
}
const step = (): SwingStep => ({ from: foot(), target: foot(), phase: 0, rate: 0, redirected: false, span: 0, ratio: 0, lead: 0, committed: false,
  quiet: false, stairs: false, stairFlight: null, ux: 0, uz: 0, jog: 0, sprint: 0, run: 0, clip: 0 });

export class WatchmanPace {
  readonly feet = [foot(), foot()] as const;
  speed = 0;
  forward = 0;
  lateral = 0;
  run = 0;
  swing = 0; // + when the left boot is ahead in body coordinates
  activity = 0;
  turn = 0;
  support = 0; // -1 = weight over left, +1 = over right
  compression = 0;
  accelForward = 0;
  accelLateral = 0;
  float = 0;
  clipPhase = 0;
  clipWeight = 0;
  jog = 0;
  sprint = 0;
  resetThisFrame = true;
  private previous: PacePoint | null = null;
  private lastYaw = 0;
  private next = 0;
  private untilLift = 0; // remaining translation to the next scheduled lift
  private lastStride = 0;
  private lastStairs = false;
  private vx = 0;
  private vz = 0;
  private readonly steps = [step(), step()];
  private readonly desired = foot();
  private readonly motion = createMotionPose();
  private readonly motionFrom = createMotionPose();
  private readonly motionTo = createMotionPose();
  private correction = 0;
  private clipRate = 0;
  private wasMoving = false;
  private headingX = 0;
  private headingZ = 0;
  private turnRecovery = 0;

  reset(): void { this.previous = null; }

  // Landing preview is individual; there can be two swings during a run.
  landing(i: number): Readonly<FootContact> | null {
    const s = this.steps[i];
    return !this.feet[i].planted && s.committed ? s.target : null;
  }

  landingWeight(i: number): number {
    const s = this.steps[i];
    return s.stairs || Math.abs(s.target.y - s.from.y) > 0.12
      ? ease(clamp((s.phase - 0.31) / 0.59, 0, 1))
      : ease(clamp((s.phase - 0.68) / 0.32, 0, 1));
  }

  private place(out: FootContact, at: PacePoint, yaw: number, i: number, tx: number, tz: number): void {
    const side = i === 0 ? -1 : 1;
    out.x = at.x + Math.cos(yaw) * side * 0.105 + tx;
    out.z = at.z - Math.sin(yaw) * side * 0.105 + tz;
    out.yaw = yaw + side * 0.085;
    // Keep the leg's neutral placement while placing the contact at the sole.
    const soleLead = WATCHMAN_SOLE_FORWARD - 0.035;
    out.x += Math.sin(out.yaw) * soleLead;
    out.z += Math.cos(out.yaw) * soleLead;
    out.pitch = 0;
  }

  private soleRise(x: number, z: number, yaw: number, pitch: number, reference: number, ground: FloorHeight, pad = 0): number {
    const ux = Math.sin(yaw), uz = Math.cos(yaw);
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    let height = ground(x, z, reference);
    for (const [side, length] of BOOT_SOLE) {
      const reach = (length + Math.sign(length) * pad) * cosPitch;
      height = Math.max(height, ground(x + reach * ux + side * uz, z + reach * uz - side * ux, reference) - length * sinPitch);
    }
    return height;
  }

  private stairRise(x: number, z: number, yaw: number, pitch: number, reference: number, ground: FloorHeight, pad: number): number {
    let height = this.soleRise(x, z, yaw, pitch, reference, ground, pad);
    const ux = Math.sin(yaw), uz = Math.cos(yaw), cos = Math.cos(pitch), sin = Math.sin(pitch);
    // The tip can clear the nosing while the lower midsole still intersects
    // it. Sample sections between the marker and the raised end as well.
    for (const section of STAIR_SOLE_SECTIONS) {
      const length = Math.sign(pitch) * section;
      const reach = length * cos;
      height = Math.max(height, ground(x + reach * ux, z + reach * uz, reference) - length * sin);
    }
    // In toe-up pitch the back of the heel projects farther uphill than the
    // sole marker plane. Check its raised face after the sole has cleared.
    const top = 0.06;
    const reach = BOOT_HEEL * cos - top * sin;
    const h = ground(x + reach * ux, z + reach * uz, reference);
    return Math.max(height, h - BOOT_HEEL * sin - top * cos);
  }

  private seat(out: FootContact, y: number, ground: FloorHeight): void {
    out.y = ground(out.x, out.z, y);
    const soleY = this.soleRise(out.x, out.z, out.yaw, 0, y, ground);
    if (soleY <= out.y + 0.065) { out.y = soleY; return; }
    const ux = Math.sin(out.yaw), uz = Math.cos(out.yaw);
    // On the narrow treads the uphill end must clear the riser, even when
    // it's the heel. Search locally at the same level before changing treads.
    let fallback: PacePoint | undefined;
    for (let distance = 0.01; distance <= 0.18; distance += 0.01) {
      for (const [side, forward] of SEAT_DIRECTIONS) {
        const x = out.x + (side * uz + forward * ux) * distance;
        const z = out.z + (-side * ux + forward * uz) * distance;
        const height = ground(x, z, y);
        if (this.soleRise(x, z, out.yaw, 0, y, ground) > height + 0.065) continue;
        if (Math.abs(height - out.y) < 0.025) { out.x = x; out.z = z; out.y = height; return; }
        fallback ??= { x, y: height, z };
      }
    }
    if (fallback) Object.assign(out, fallback);
  }

  update(at: PacePoint, yaw: number, dt: number, ground: FloorHeight): void {
    if (!(dt > 0)) return;
    this.resetThisFrame = false;
    const previous = this.previous;
    const dx = at.x - (previous?.x ?? at.x), dz = at.z - (previous?.z ?? at.z);
    const distance = Math.hypot(dx, dz);
    this.previous = { ...at };
    if (!previous || dt > 0.22 || distance > Math.max(0.48, dt * 4.5) || Math.abs(at.y - previous.y) > 0.55) {
      this.feet.forEach((f, i) => { this.place(f, at, yaw, i, 0, 0); this.seat(f, at.y, ground); f.planted = true; });
      this.resetThisFrame = true;
      this.lastYaw = yaw;
      this.lastStride = this.headingX = this.headingZ = this.turnRecovery = 0;
      this.lastStairs = this.wasMoving = false;
      this.next = this.untilLift = this.accelForward = this.accelLateral = this.support = this.compression = this.float = 0;
      this.clipWeight = this.clipPhase = this.jog = this.sprint = this.correction = this.clipRate = 0;
      this.vx = this.vz = this.speed = this.activity = this.run = this.lateral = this.forward = this.swing = this.turn = 0;
      return;
    }
    const deltaYaw = angle(yaw - this.lastYaw);
    this.lastYaw = yaw;
    this.turn = mix(this.turn, clamp(deltaYaw / dt, -5, 5), damping(10, dt));
    // Read actual travel, not the held input key. A wall cannot advance the gait.
    const moving = distance > dt * 0.035;
    const starting = moving && !this.wasMoving && this.speed < 0.34;
    this.wasMoving = moving;
    const k = damping(moving ? 15 : 23, dt);
    const oldVx = this.vx, oldVz = this.vz;
    this.vx = mix(this.vx, moving ? dx / dt : 0, k);
    this.vz = mix(this.vz, moving ? dz / dt : 0, k);
    this.speed = mix(this.speed, moving ? clamp(distance / dt, 0, 3.6) : 0, damping(14, dt));
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    this.forward = sin * this.vx + cos * this.vz;
    this.lateral = cos * this.vx - sin * this.vz;
    const ax = (this.vx - oldVx) / dt, az = (this.vz - oldVz) / dt;
    this.accelForward = mix(this.accelForward, clamp(sin * ax + cos * az, -12, 12), damping(9, dt));
    this.accelLateral = mix(this.accelLateral, clamp(cos * ax - sin * az, -12, 12), damping(9, dt));
    const ux = moving ? dx / distance : 0, uz = moving ? dz / distance : 0;
    // Time-limited recovery after a true heading change. Leave the stable
    // authored walk/run cadence alone during ordinary straight-line travel.
    this.turnRecovery = Math.max(0, this.turnRecovery - dt);
    if (moving) {
      if (ux * this.headingX + uz * this.headingZ < 0.72 && this.activity > 0.33) this.turnRecovery = 0.32;
      this.headingX = ux; this.headingZ = uz;
    }
    const recovering = this.turnRecovery > 0;
    const ahead = sin * ux + cos * uz;
    // Blend around diagonals: a slight camera rotation at 0.63 used to
    // hard-switch stride, lead and phase speed despite nearly identical travel.
    const sideGait = 1 - ease(clamp((Math.abs(ahead) - 0.43) / 0.39, 0, 1));
    const reverseGait = ahead < 0 ? 1 - sideGait : 0;
    const slope = moving ? ground(at.x + ux * 0.29, at.z + uz * 0.29, at.y)
      - ground(at.x - ux * 0.22, at.z - uz * 0.22, at.y) : 0;
    const stairs = Math.abs(slope) > 0.14;
    this.run = mix(this.run, stairs ? 0 : clamp((this.forward - 1.85) / 1.24, 0, 1), damping(9, dt));
    this.activity = mix(this.activity, clamp(this.speed / 1.35, 0, 1), damping(13, dt));
    this.jog = mix(this.jog, clamp((this.forward - 1.8) / 0.67, 0, 1), damping(9, dt));
    this.sprint = mix(this.sprint, clamp((this.forward - 2.47) / 0.62, 0, 1), damping(9, dt));
    this.clipWeight = mix(this.clipWeight, (stairs ? 0.52 : 1) * this.activity
      * ease(clamp((ahead - 0.38) / 0.55, 0, 1)), damping(12, dt));
    const sprint = stairs ? 0 : this.run * (1 - sideGait - reverseGait);
    // At 1.8 m/s: ~2.9 steps/s and 60% stance. At 3.1 m/s: ~3.7
    // steps/s and 44% stance, so the tail of one swing overlaps the next lift.
    const stride = stairs ? 0.31 : mix(
      mix(mix(mix(0.34, 0.62, clamp(this.speed / 1.8, 0, 1)), 0.82, sprint),
        mix(0.39, 0.56, clamp(this.speed - 1.75, 0, 1)), ahead < 0 ? 1 : 0),
      mix(0.31, 0.48, clamp(this.speed - 1.75, 0, 1)), sideGait);
    // The stair/tread planner changes cadence at stair boundaries. Preserve
    // the fraction of its transfer window there, rather than inheriting a
    // full flat-ground stride into a short tread.
    if (this.lastStride > 0 && (stairs || this.lastStairs)) this.untilLift *= stride / this.lastStride;
    this.lastStride = stride;
    this.lastStairs = stairs;
    const span = stairs ? 0.91 : mix(mix(0.80, 1.12, sprint), 0.78, sideGait);
    const lead = stairs ? 0.34 : mix(ahead < 0 ? 0.51 : 1 - span / 2, 0.36, sideGait);
    const advance = moving ? distance / stride : 0;
    const correction = this.correction * damping(11, dt);
    this.correction -= correction;
    const clipGoal = advance * 0.5 / dt;
    const clipGain = damping(29, dt);
    // Integrate the eased phase rate; a release doesn't abruptly freeze the
    // arms/upper body, and a small tap doesn't restart a still-visible clip.
    this.clipPhase += clipGoal * dt + (this.clipRate - clipGoal) * clipGain / 29 + correction;
    this.clipRate = mix(this.clipRate, clipGoal, clipGain);
    this.clipPhase -= Math.floor(this.clipPhase);
    this.compression *= Math.exp(-16 * dt);

    const quiet = !moving && this.speed < 0.34;
    if (moving) {
      // A scheduled lift may already be due during a moving transfer. Only
      // the transition from near-rest gets the abbreviated launch step.
      const idle = starting && this.feet.every(f => f.planted);
      // On the first stride don't wait a full swing while still standing on the
      // spawn footprint. Pick the trailing boot, or lead with the outside boot.
      if (idle) {
        const lag = (this.feet[0].x - this.feet[1].x) * ux + (this.feet[0].z - this.feet[1].z) * uz;
        if (sideGait > 0.5 && this.activity < 0.33) this.next = lag > 0 ? 0 : 1;
        else if (Math.abs(lag) > 0.045) this.next = lag < 0 ? 0 : 1;
      }
      let next = this.next;
      const rearOf = (f: FootContact): number => this.anklePlanarGap(f, at, ux, uz);
      const other = 1 - next;
      // A collision may redirect travel abruptly (e.g. a door jamb). Keep
      // ordinary left/right cadence, unless the actual stance is about to
      // leave anatomical reach before the planned next lift.
      const maxRear = mix(0.385, 0.414, sprint);
      let urgent = false;
      if (!stairs && (recovering || sprint < 0.25) && this.feet.every(f => f.planted)) {
        // The other foot may have finished an old-direction swing since the
        // input changed. Don't strand it as the stance for a whole new stride.
        const lag = rearOf(this.feet[other]);
        if (lag > maxRear && lag > rearOf(this.feet[next]) + 0.065) {
          next = other;
          urgent = true;
        } else if (rearOf(this.feet[next]) > 0.11 && this.anklePlanarGap(this.feet[next], at) > 0.50) {
          // A strafe can leave an off-axis boot behind even though its
          // projection onto our new direction still looks close enough.
          urgent = true;
        }
      }
      const fastTravel = distance / dt > 2.35;
      if (!stairs && this.feet[other].planted !== this.feet[next].planted && (ahead > 0.78 || recovering && fastTravel)) {
        const stance = this.feet[next].planted ? next : other;
        const foot = this.feet[stance];
        const offAxis = Math.abs(this.anklePlanarGap(foot, at, cos, -sin));
        const air = this.steps[1 - stance];
        const crossing = recovering && fastTravel && ux * air.ux + uz * air.uz < 0.72;
        if ((offAxis > 0.21 || sprint > 0.33 || crossing) && air.phase > (crossing ? 0.46 : 0.53)
          && this.anklePlanarGap(foot, at) > 0.46) {
          next = stance;
          urgent = true;
        }
      }
      const trailing = this.feet[next], opposite = this.feet[1 - next];
      const rear = rearOf(trailing);
      const reachRelease = !stairs && rear > maxRear && (opposite.planted || sprint > 0.33 || urgent);
      const reachDistance = clamp(maxRear - (rear - distance), 0, distance);
      const liftDistance = urgent || idle ? 0 : reachRelease ? Math.min(this.untilLift, reachDistance) : this.untilLift;
      // Only fast travel may overlap swings. A shorter lateral stride can
      // otherwise schedule toe-off before the previous walk swing lands.
      const canLift = opposite.planted || !stairs && (sprint > 0.18 || fastTravel && urgent);
      if (distance >= liftDistance && trailing.planted && canLift) {
        const fraction = clamp(liftDistance / distance, 0, 1);
        const liftAt = { x: mix(previous.x, at.x, fraction), y: mix(previous.y, at.y, fraction), z: mix(previous.z, at.z, fraction) };
        const first = idle && !stairs;
        // On the first tick the smoothed velocity depends on the render sample
        // interval. Take the intended initial spacing from actual displacement.
        const launchStride = first && ahead > 0
          ? mix(mix(0.34, 0.62, clamp(distance / (dt * 1.8), 0, 1)), stride, sideGait) : stride;
        const spanAtLift = urgent ? Math.min(recovering || sprint < 0.25 ? 0.56 : 0.66, span) : first ? 0.46 : span;
        this.launch(next, liftAt, yaw - deltaYaw * (1 - fraction), ground, ux, uz, launchStride,
          spanAtLift, urgent ? lead * 0.72 : first ? lead * 0.86 : lead, stairs, false, -liftDistance, distance / dt);
        if (idle && this.clipWeight < 0.035) {
          this.clipPhase = (next * 0.5 - spanAtLift * 0.5 + advance * 0.5 + 1) % 1;
          this.correction = 0;
        }
        this.next = 1 - next;
        this.untilLift = liftDistance + launchStride * (first ? 0.59 : 1);
      }
      this.untilLift = Math.max(0, this.untilLift - distance);
    } else if (quiet && this.feet.every(f => f.planted)) {
      this.untilLift = 0;
      let candidate = -1, worst = 0.077;
      this.feet.forEach((f, i) => {
        this.place(this.desired, at, yaw, i, 0, 0);
        this.seat(this.desired, at.y, ground);
        const error = Math.hypot(f.x - this.desired.x, f.z - this.desired.z) + 0.21 * Math.abs(angle(f.yaw - this.desired.yaw));
        if (error > worst) { worst = error; candidate = i; }
      });
      if (candidate >= 0) this.launch(candidate, at, yaw, ground, 0, 0, stride, 1, 0, false, true, 0, 0);
    }

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], s = this.steps[i];
      if (f.planted) continue;
      const terrain = stairs || s.stairs;
      // Keep a landing locked near impact, but let a not-yet-loaded foot
      // replan if a key release / reversal makes it the wrong landing.
      const interrupted = !s.quiet && !terrain && !s.stairFlight && (!moving || ux * s.ux + uz * s.uz < 0.72);
      if (interrupted && s.phase < 0.76 && !s.redirected) {
        s.redirected = true;
        s.committed = false;
      }
      const support = this.feet[1 - i];
      const supportRear = this.anklePlanarGap(support, at, ux, uz);
      const reach = !terrain && moving && (recovering || sprint < 0.25) && support.planted && supportRear > 0.19
        ? ease(clamp((this.anklePlanarGap(support, at) - (s.redirected ? 0.34 : 0.44)) / 0.18, 0, 1)) : 0;
      const goal = s.quiet ? 5.5 : moving ? distance / (dt * (terrain ? stride * s.ratio : s.span)) + 3 * reach
        : s.redirected ? 3.6 : 5.4;
      const clockGain = damping(25, dt);
      const phaseDelta = terrain || s.quiet ? goal * dt : goal * dt + (s.rate - goal) * clockGain / 25;
      s.rate = terrain || s.quiet ? goal : mix(s.rate, goal, clockGain);
      const next = Math.min(1, s.phase + phaseDelta);
      if (!s.committed) {
        const progress = clamp(next, 0, 1);
        this.aim(this.desired, at, yaw, i, ground, ux, uz, moving && !s.quiet
          ? terrain ? stride * ((s.stairs ? 0.34 : lead) + s.ratio * (1 - progress)) : s.lead + s.span * (1 - progress)
          : 0, s.stairs);
        const follow = damping(s.stairs ? 17 : s.redirected ? 32 : 23, dt);
        const tx = this.desired.x - s.target.x, tz = this.desired.z - s.target.z;
        // Bound contact-target motion in world units. Multiplying a sudden
        // target jump by late-swing travel otherwise jerks the actual boot.
        const steerRate = s.redirected ? 4.7 : 2.6;
        const fadeStart = s.redirected ? 0.70 : 0.58;
        const steer = terrain ? follow : Math.min(follow, steerRate * dt / Math.max(1e-6, Math.hypot(tx, tz)))
          * (1 - ease(clamp((progress - fadeStart) / 0.24, 0, 1)));
        s.target.x += tx * steer;
        s.target.z += tz * steer;
        s.target.yaw += angle(this.desired.yaw - s.target.yaw) * steer;
        if (progress >= (terrain ? 0.13 : s.redirected ? 0.89 : 0.59)) {
          this.seat(s.target, at.y, ground);
          s.committed = true;
        } else s.target.y = mix(s.target.y, ground(s.target.x, s.target.z, at.y), follow);
      }
      this.poseBoot(f, s, i, at.y, ground, stairs, next);
      s.phase = next;
      if (next === 1) {
        f.planted = true;
        f.plantId++;
        if (moving && !s.quiet) {
          // Phase-lock the source torso/arms to actual foot contacts, without
          // snapping them during speed changes or a missed physics tick.
          const error = ((i * 0.5 - this.clipPhase + 1.5) % 1) - 0.5;
          this.correction = clamp(error, -0.13, 0.13);
        }
        this.compression = s.quiet || quiet ? 0.23 : mix(0.50, 0.88, sprint);
      }
    }
    const [left, right] = this.feet;
    const single = left.planted === right.planted ? 0 : left.planted ? -1 : 1;
    this.support = mix(this.support, single, damping(16, dt));
    this.float = mix(this.float, !left.planted && !right.planted ? sprint : 0, damping(26, dt));
    const separation = (left.x - right.x) * sin + (left.z - right.z) * cos;
    this.swing = mix(this.swing, clamp(separation / (stride * 0.92), -1, 1) * this.activity, damping(21, dt));
  }

  private anklePlanarGap(f: FootContact, at: PacePoint, ux?: number, uz?: number): number {
    const dx = at.x - f.x + Math.sin(f.yaw) * WATCHMAN_SOLE_FORWARD;
    const dz = at.z - f.z + Math.cos(f.yaw) * WATCHMAN_SOLE_FORWARD;
    return ux === undefined || uz === undefined ? Math.hypot(dx, dz) : dx * ux + dz * uz;
  }

  private launch(i: number, at: PacePoint, yaw: number, ground: FloorHeight, ux: number, uz: number,
    stride: number, span: number, lead: number, stairs: boolean, quiet: boolean, offset: number, speed: number): void {
    const f = this.feet[i], s = this.steps[i];
    Object.assign(s.from, f);
    s.span = span * stride;
    s.ratio = span;
    s.lead = lead * stride;
    s.phase = offset / s.span;
    s.rate = speed / s.span;
    s.redirected = false;
    s.stairFlight = null;
    s.stairs = stairs; s.quiet = quiet; s.committed = false; s.ux = ux; s.uz = uz;
    s.jog = this.jog; s.sprint = this.sprint;
    const forwardBlend = ease(clamp((Math.sin(yaw) * ux + Math.cos(yaw) * uz - 0.38) / 0.55, 0, 1));
    s.run = this.run * forwardBlend;
    s.clip = quiet || stairs ? 0 : this.activity * forwardBlend;
    this.aim(s.target, at, yaw, i, ground, ux, uz, stride * (lead + span), stairs);
    if (stairs) {
      this.seat(s.target, at.y, ground);
      s.committed = true;
    }
    f.planted = false;
  }

  private aim(out: FootContact, at: PacePoint, yaw: number, i: number, ground: FloorHeight,
    ux: number, uz: number, lead: number, stairs: boolean): void {
    this.place(out, at, yaw, i, ux * lead, uz * lead);
    const other = this.feet[1 - i], side = i === 0 ? -1 : 1;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const span = side * ((out.x - other.x) * rx + (out.z - other.z) * rz);
    const minimum = stairs ? 0.14 : 0.125;
    if (span < minimum) {
      const correction = Math.min(0.26, minimum - span) * side;
      out.x += correction * rx; out.z += correction * rz;
    }
    out.y = ground(out.x, out.z, at.y);
  }

  private poseBoot(f: FootContact, s: SwingStep, i: number, y: number, ground: FloorHeight, stairs: boolean, phase: number): void {
    if (phase >= 1) {
      f.x = s.target.x; f.y = s.target.y; f.z = s.target.z;
      f.yaw = s.from.yaw + angle(s.target.yaw - s.from.yaw); f.pitch = 0;
      return;
    }
    const stepped = s.stairs || stairs || Math.abs(s.target.y - s.from.y) > 0.12;
    if (s.stairFlight || stepped && s.committed) {
      this.poseStairFlight(f, s, phase, y, ground);
      return;
    }
    const t = Math.max(0, phase);
    const dy = s.target.y - s.from.y;
    const travel = flight(stepped && dy >= -0.025 ? clamp((t - 0.21) / 0.79, 0, 1)
      : stepped ? t + 0.78 * t * (1 - t) : t);
    let sourceLift = 0, sourcePitch = 0;
    // The upper body can fade out on release, but the already air-borne
    // boot keeps its takeoff performance (and never swaps to another clip).
    const blend = stepped ? 0 : s.clip;
    if (blend > 0.001 && t < 1) {
      const side = i ? 'R' : 'L', end = 1 + i * 0.5;
      // Toe markers reveal source toe-off at ~.56/.14/.21. The original
      // running cycles are faster than our 3.1m/s character; map their full
      // recovery phase onto the longer stance selected by our controller.
      const start = end - 1 + mix(mix(i ? 0.55 : 0.57, 0.14, s.jog), i ? 0.23 : 0.20, s.sprint);
      sampleWatchmanMotion(this.motion, mix(start, end, t), s.jog, s.sprint);
      sampleWatchmanMotion(this.motionFrom, start, s.jog, s.sprint);
      sampleWatchmanMotion(this.motionTo, end, s.jog, s.sprint);
      const ankle = this.motion[`foot${side}`], from = this.motionFrom[`foot${side}`], to = this.motionTo[`foot${side}`];
      const pitch = (p: ReturnType<typeof createMotionPose>): number => {
        const a = p[`foot${side}`], b = p[`toe${side}`];
        return Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
      };
      const authoredPitch = pitch(this.motion);
      const gain = mix(mix(0.76, 0.73, s.jog), 0.64, s.sprint);
      sourceLift = clamp((ankle.y - mix(from.y, to.y, t) + 0.075 * (Math.sin(authoredPitch)
        - mix(Math.sin(pitch(this.motionFrom)), Math.sin(pitch(this.motionTo)), t))) * gain, 0, 0.26);
      sampleWatchmanMotion(this.motionFrom, end + mix(mix(0.18, 0.04, s.jog), 0.065, s.sprint), s.jog, s.sprint);
      sourcePitch = clamp(authoredPitch - pitch(this.motionFrom), -0.58, 0.26) * ease(Math.min(1, t / 0.20)) * ease(Math.min(1, (1 - t) / 0.18));
    }
    f.x = mix(s.from.x, s.target.x, travel);
    f.z = mix(s.from.z, s.target.z, travel);
    f.yaw = s.from.yaw + angle(s.target.yaw - s.from.yaw) * travel;
    const arc = Math.sin(Math.PI * t);
    const heightT = dy >= 0 ? ease(t + 0.73 * t * (1 - t)) : ease(t - 0.24 * t * (1 - t));
    const lift = s.quiet ? 0.045 : mix(0.090, 0.197, s.run) + Math.min(0.060, Math.abs(dy) * 0.19);
    const swingArc = Math.sin(Math.PI * (t + s.run * 0.46 * t * (1 - t)));
    const pitch = arc * (stepped && dy > 0.08 ? 0.42 - 0.32 * t : mix(0.41, 0.73, s.run) * t - mix(0.18, 0.48, s.run));
    f.pitch = mix(pitch, sourcePitch, blend);
    // A provisional landing can look several treads ahead and then get
    // seated much nearer. Don't lift toward its full height before committing.
    const landingY = stepped ? s.from.y + clamp(dy, -0.30, 0.30) : s.target.y;
    const height = mix(s.from.y, landingY, heightT) + mix(swingArc * lift, Math.max(arc * 0.041, sourceLift), blend);
    const downhillPad = stepped && dy < -0.12 ? ease(clamp((0.90 - t) / 0.40, 0, 1)) : 1;
    const pad = 0.014 * ease(Math.min(1, t / 0.30, (1 - t) / 0.24)) * downhillPad;
    f.y = Math.max(height, this.soleRise(f.x, f.z, f.yaw, f.pitch, y, ground, pad));
  }

  private poseStairFlight(f: FootContact, s: SwingStep, phase: number, y: number, ground: FloorHeight): void {
    // A flat swing can acquire a stair landing after takeoff. Rebuild only
    // the remaining flight from the last displayed boot, not the old plant.
    const plan = s.stairFlight ??= { from: { ...f }, start: Math.max(0, s.phase), nodes: [] };
    const { from, nodes, start } = plan, to = s.target;
    const dy = to.y - from.y;
    const travelAt = (u: number): number => flight(dy >= -0.025 ? clamp((u - 0.21) / 0.79, 0, 1) : u + 0.78 * u * (1 - u));
    const pitchAt = (u: number): number => from.pitch * (1 - ease(u)) + Math.sin(Math.PI * u)
      * (dy > 0.08 ? 0.42 - 0.32 * u : mix(0.41, 0.73, s.run) * u - mix(0.18, 0.48, s.run));
    // Fade only the extra reach downhill; the real footprint is still hard.
    const padAt = (u: number): number => 0.014 * ease(Math.min(1, u / 0.30, (1 - u) / 0.24))
      * (dy < -0.12 ? ease(clamp((0.90 - u) / 0.40, 0, 1)) : 1);
    const yawDelta = angle(to.yaw - from.yaw);
    if (!nodes.length) {
      const samples = 48;
      const lift = start > 0 ? 0 : s.quiet ? 0.045 : 0.09;
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const raw: number[] = [];
      for (let j = 0; j <= samples; j++) {
        const u = j / samples, p = travelAt(u);
        // Hold the layer reference on the flight instead of following the
        // moving root, which can be several treads ahead of a trailing boot.
        raw.push(this.stairRise(mix(from.x, to.x, p), mix(from.z, to.z, p), from.yaw + yawDelta * p,
          pitchAt(u), mix(from.y, to.y, p), ground, padAt(u)));
      }
      // Give each sampled nosing one interval on both sides. Leave the end
      // contacts pinned; a stationary interval allows lift before translation
      // (or settling after clearing the edge) if a nosing is close to either.
      nodes.push({ u: 0, y: from.y, cost: 0 });
      for (let j = 0; j <= samples; j++) {
        const u = j / samples;
        const liftY = mix(from.y, to.y, dy >= 0 ? travelAt(u) : ease(u)) + lift * Math.sin(Math.PI * u);
        nodes.push({ u, y: Math.max(liftY, raw[Math.max(0, j - 1)], raw[j], raw[Math.min(samples, j + 1)]), cost: 0 });
      }
      nodes.push({ u: 1, y: to.y, cost: 0 });
      for (let j = 1; j < nodes.length; j++) {
        const a = nodes[j - 1], b = nodes[j];
        const planar = span * (travelAt(b.u) - travelAt(a.u));
        b.cost = a.cost + Math.hypot(planar, 1.6 * (b.y - a.y));
      }
    }
    // Spend swing phase on vertical travel as well as horizontal travel. A
    // riser is cleared or descended over time, not at the frame the sampled
    // sole crosses it. Neither the gait clock nor the landing moves.
    const progress = clamp((phase - start) / (1 - start), 0, 1);
    const cost = (progress + 0.20 * progress * progress * (1 - progress)) * nodes[nodes.length - 1].cost;
    let j = 1;
    while (j < nodes.length - 1 && nodes[j].cost <= cost) j++;
    const a = nodes[j - 1], b = nodes[j];
    const local = b.cost === a.cost ? 1 : (cost - a.cost) / (b.cost - a.cost);
    const u = mix(a.u, b.u, local), p = travelAt(u);
    f.x = mix(from.x, to.x, p); f.z = mix(from.z, to.z, p);
    f.yaw = from.yaw + yawDelta * p; f.pitch = pitchAt(u);
    // The sampled profile is not a collision oracle. Keep the live footprint
    // as a hard floor for missed samples and changes of supporting layer.
    f.y = Math.max(mix(a.y, b.y, local), this.stairRise(f.x, f.z, f.yaw, f.pitch, y, ground, padAt(u)));
  }
}
