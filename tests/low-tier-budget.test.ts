import { expect,it } from 'vitest';
import { displayPixelRatio, SettledKeyBudget } from '../src/render/lowTierBudget';

it('caps the low 3D buffer in either orientation without upscaling small views or reducing cinema',()=>{
  for(const [w,h] of [[1920,1080],[1080,1920],[3840,1080],[701,701],[640,360]]){
    const r=displayPixelRatio('low',w,h,2);
    expect(Math.max(w,h)*r).toBeLessThanOrEqual(960);expect(Math.min(w,h)*r).toBeLessThanOrEqual(540);
    expect(displayPixelRatio('high',w,h,2)).toBe(1.5);expect(displayPixelRatio('cinematic',w,h,2)).toBe(2);
  }
  expect(displayPixelRatio('low',640,360,.8)).toBe(.8);
});

it('reuses a settled key only; motion, doors, a new sky direction and quality switches invalidate it',()=>{
  const b=new SettledKeyBudget(),run=(time:number,move=false,state=0,yaw=1,light=8)=>b.due(time,move,state,yaw,0,1,2,light,3,9);
  expect(run(0)).toBe(true);expect(run(640)).toBe(true);expect(run(680)).toBe(false);expect(run(845)).toBe(true);
  expect(run(860,false,0,1,8.02)).toBe(true);expect(run(875,false,0,1,8.02)).toBe(false);
  expect(run(890,false,1,1,8.02)).toBe(true);expect(run(1000,false,1,1,8.02)).toBe(true);
  expect(run(1690,true,1)).toBe(true);expect(run(1700,false,1,1.1)).toBe(true);
  b.reset();expect(run(1710,false,1,1.1)).toBe(true);
});
