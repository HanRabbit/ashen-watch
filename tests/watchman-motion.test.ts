import { expect, it } from 'vitest';
import { createMotionPose, sampleWatchmanMotion } from '../src/render/watchmanMotion';

it.each([[0,0],[1,0],[1,1]])('keeps the lead foot synchronized when changing pace (%s, %s)', (jog,sprint) => {
  const p=createMotionPose(), left=p.footL;
  for(const phase of [0.0,.5,1,1.5,-.5]) {
    sampleWatchmanMotion(p,phase,jog,sprint);
    expect(p.footL).toBe(left); // reuse the caller's vectors
    const [a,b]=phase%1===0 ? [p.footL,p.footR] : [p.footR,p.footL];
    expect(a.z-b.z).toBeGreaterThan(.38);
    expect(a.y).toBeLessThan(.17);
    expect(p.handL.x).toBeLessThan(p.handR.x);
    expect(p.head.y-p.hips.y).toBeGreaterThan(.49);
  }
  const end=sampleWatchmanMotion(createMotionPose(),1-0.00001,jog,sprint);
  sampleWatchmanMotion(p,0,jog,sprint);
  expect(end.handL.distanceTo(p.handL)).toBeLessThan(.001);
  expect(end.footR.distanceTo(p.footR)).toBeLessThan(.001);
});
it('mixes the same phase, not different clocks for walking and running', () => {
  const walk=sampleWatchmanMotion(createMotionPose(),.24,0,0);
  const jog=sampleWatchmanMotion(createMotionPose(),.24,1,0);
  const run=sampleWatchmanMotion(createMotionPose(),.24,1,1);
  const blended=sampleWatchmanMotion(createMotionPose(),.24,.63,.42);
  expect(walk.handL.distanceTo(jog.handL)).toBeGreaterThan(.1);
  expect(walk.handL.lerp(jog.handL,.63).lerp(run.handL,.42).distanceTo(blended.handL)).toBeLessThan(1e-6);
});
