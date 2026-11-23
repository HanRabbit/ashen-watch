import { Vector3 } from 'three';
import { motionClips, motionFrames, motionJoints } from './baked/watchmanMotionData';

export type WatchmanMotionPose = Record<typeof motionJoints[number], Vector3>;
export function createMotionPose(): WatchmanMotionPose {
  return Object.fromEntries(motionJoints.map(k => [k, new Vector3()])) as WatchmanMotionPose;
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const stride = motionJoints.length * 3;

/** Sample the same foot-contact phase across the three authored performances.
 * Positions in source metres, -X anatomical left, +Z forward; root motion stays
 * with simulation. `jog` interpolates walk→jog, `sprint` interpolates that→sprint.
 * Caller owns pose so no per-frame heap allocation and no sharing between actors. */
export function sampleWatchmanMotion(out: WatchmanMotionPose, phase: number, jog: number, sprint: number): WatchmanMotionPose {
  const f = (phase - Math.floor(phase)) * motionFrames, i = Math.floor(f), t = f-i;
  const a = i * stride, b = ((i+1) % motionFrames) * stride;
  const j = clamp01(jog), s = clamp01(sprint);
  const w0 = (1-j)*(1-s), w1 = j*(1-s), w2 = s;
  const [walk, jogClip, run] = motionClips;
  for (let k=0; k<motionJoints.length; k++) {
    const p=out[motionJoints[k]];
    for (let axis=0; axis<3; axis++) {
      const m=a+k*3+axis, n=b+k*3+axis;
      const l=w0*walk[m]+w1*jogClip[m]+w2*run[m], r=w0*walk[n]+w1*jogClip[n]+w2*run[n];
      p.setComponent(axis,(l+(r-l)*t)*0.001);
    }
  }
  return out;
}
