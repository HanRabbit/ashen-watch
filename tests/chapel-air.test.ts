import * as THREE from 'three';
import { expect, it } from 'vitest';
import { bakeChapelSkyField, chapelSkyVisibility } from '../tools/bake-chapel-air';
import { CHAPEL_APERTURES } from '../src/render/probeLighting';
import { AIR_SOURCE_GLSL, CHAPEL_AIR_BAFFLES, CHAPEL_AIR_EXTINCTION, CHAPEL_AIR_GRID, CHAPEL_AIR_WALL_GROUPS,
  CHAPEL_BEAM_NODES, CHAPEL_BEAM_SPLIT, CHAPEL_BEAM_WEIGHTS, CHAPEL_KEY_GAIN, CHAPEL_REVEAL, CHAPEL_SKY_GAIN, WEATHER_REACH, WINDOW_SCATTER_GLSL,
  loadChapelSkyField } from '../src/render/post/airVolume';
import { ShadowVolumePass } from '../src/render/post/shadowVolume';
import { AREAS, DOORS, PROPS, RAISED_Y } from '../src/sim/level';

const V = (x: number,y: number,z: number) => new THREE.Vector3(x,y,z);
const smooth = (a: number,b: number,x: number) => THREE.MathUtils.smoothstep(x,a,b);
const [lo,hi] = [V(...CHAPEL_AIR_GRID.lo),V(...CHAPEL_AIR_GRID.hi)];
const size = CHAPEL_AIR_GRID.size;
const code = loadChapelSkyField();
const daylightLuma = (hex: number) => new THREE.Color(hex).toArray().reduce((a,c,i) => a+c*[.2126,.7152,.0722][i],0);
const irradiance = daylightLuma(0xc8d2da)*2.34*.88;
const sun = V(-.58,.68,-.42).normalize();
const dayKey = daylightLuma(0xe4ebef)*.72;
function room(p: THREE.Vector3) {
  const roof = Math.max(16.2-(5.6/5.8)*Math.abs(p.z+16.5),p.z>-16.5 ? 14.685-(3.8/2.9)*Math.abs(p.x-18) : 0);
  return smooth(0,.18,Math.min(roof-p.y,p.x-lo.x,p.y-lo.y,p.z-lo.z,hi.x-p.x,hi.y-p.y,hi.z-p.z));
}
function skyTransfer(p: THREE.Vector3) {
  const uv = p.clone().sub(lo).divide(hi.clone().sub(lo));
  const [x,y,z] = uv.toArray().map((u,i) => THREE.MathUtils.clamp(u,0,1)*(size[i]-1));
  let value=0;
  for (let k=0;k<2;++k) for (let j=0;j<2;++j) for (let i=0;i<2;++i) {
    const ix=Math.floor(x)+i, iy=Math.floor(y)+j, iz=Math.floor(z)+k;
    const w=(1-Math.abs(x-ix))*(1-Math.abs(y-iy))*(1-Math.abs(z-iz));
    if (w>0) value+=w*code[ix+size[0]*(iy+size[1]*iz)]/255;
  }
  return value*value*CHAPEL_AIR_GRID.maxSky;
}
const roomBox = new THREE.Box3(lo,hi);
const asBox = (w: {x0:number,x1:number,z0:number,z1:number,y0?:number,h:number}) => new THREE.Box3(V(w.x0,w.y0 ?? 0,-w.z1),V(w.x1,w.h,-w.z0));
const occluders = CHAPEL_AIR_BAFFLES.map(asBox);
const opaque = [...occluders, asBox(DOORS.chapelFront.box),
  ...PROPS.filter(p => p.x0>=AREAS.chapel.x0 && p.h >= RAISED_Y).map(asBox)];
function opaqueEnd(from: THREE.Vector3, ray: THREE.Vector3) {
  const line = new THREE.Ray(from,ray);
  const shell = new THREE.Ray(from.clone().addScaledVector(ray,.08),ray).intersectBox(roomBox,V(0,0,0));
  let end = shell?.distanceTo(from) ?? 0;
  for (const b of opaque) {
    const hit=line.intersectBox(b,V(0,0,0));
    if (hit) end=Math.min(end,hit.distanceTo(from));
  }
  return end;
}
// CPU estimate of the local volume only (no weather; actual VSM handled by a
// caller-provided visibility). It follows the two Gauss taps and first depth.
type Span = [number,number];
function clip(t: Span, p: number, d: number, a: number, b: number): Span {
  if (Math.abs(d)<1e-5) return p>=a && p<=b ? t : [1,0];
  const x=(a-p)/d,y=(b-p)/d;
  return [Math.max(t[0],Math.min(x,y)),Math.min(t[1],Math.max(x,y))];
}
// CPU perspective-ray intervals of the actual glazing, separate from the
// high/cinematic weather spacing. The dense reference uses the same bounds.
function beamIntervals(origin: THREE.Vector3, ray: THREE.Vector3, depth: number, toKey = sun): Span[] {
  let t: Span = [0,depth];
  for (const k of ['x','y','z'] as const) t=clip(t,origin[k],ray[k],lo[k],hi[k]);
  if (t[1]<=t[0] || toKey.y<=.001) return [];
  const spans: Span[]=[];
  for (const axis of ['x','z'] as const) {
    const comp=toKey[axis];
    if (Math.abs(comp)<=.025) continue;
    const wall=axis==='x' ? (comp<0?0:1) : (comp>0?2:3);
    const along=(p: THREE.Vector3) => axis==='x' ? -p.z : p.x;
    const toInner=((comp<0?lo[axis]:hi[axis])-origin[axis])/comp;
    const inner=origin.clone().addScaledVector(toKey,toInner), outer=inner.clone().addScaledVector(toKey,.5/Math.abs(comp));
    const slope=ray.clone().addScaledVector(toKey,-ray[axis]/comp);
    const sideBounds=axis==='x' ? [-hi.z,-lo.z] : [lo.x,hi.x];
    const wallSpan=clip(t,along(inner),along(slope),sideBounds[0],sideBounds[1]);
    for (const i of CHAPEL_AIR_WALL_GROUPS[wall]) {
      const a=CHAPEL_APERTURES[i], l=a.lateral-.5*a.width, r=a.lateral+.5*a.width;
      let s=clip(wallSpan,along(inner),along(slope),l,r);
      s=clip(s,along(outer),along(slope),l,r);
      s=clip(s,inner.y,slope.y,a.bottom,a.bottom+a.height);
      s=clip(s,outer.y,slope.y,a.bottom,a.bottom+a.height);
      if(s[1]>s[0]) spans.push(s);
    }
  }
  return spans;
}
function beamQuadrature([a,b]: Span, f: (t: number) => number) {
  const mid=(a+b)*.5, half=(b-a)*.5;
  return half*CHAPEL_BEAM_NODES.reduce((sum,n,i) => sum+CHAPEL_BEAM_WEIGHTS[i]*(f(mid-n*half)+f(mid+n*half)),0);
}
function beamIntegral(spans: Span[], f: (t:number)=>number, dense=false) {
  return spans.reduce((sum,[a,b]) => {
    if (dense) {
      let light=0;
      for (let i=0;i<160;++i) light+=f(THREE.MathUtils.lerp(a,b,(i+.5)/160));
      return sum+light*(b-a)/160;
    }
    const mid=(a+b)*.5, split=smooth(...CHAPEL_BEAM_SPLIT,b-a);
    return sum+(split<1 ? (1-split)*beamQuadrature([a,b],f) : 0)+
      (split>0 ? split*(beamQuadrature([a,mid],f)+beamQuadrature([mid,b],f)) : 0);
  },0);
}

function integrate(origin: THREE.Vector3, ray: THREE.Vector3, depth: number, steps: number,
  {sky=irradiance,key=0,liveShadow=0,toggle=1,haze=daylightLuma(0x8996a2)} = {}) {
  const ext = CHAPEL_AIR_EXTINCTION*Math.min(1,toggle*smooth(.075,.235,haze));
  const phase = (1-.39**2)/(1+.39**2-.78*sun.dot(ray))**1.5;
  let trans=1, light=0;
  for (let i=1, start=0; i<=steps && start<depth; ++i) {
    const t=i/steps, stop=Math.min(depth,WEATHER_REACH*t*(.26+.74*t));
    const mid=.5*(start+stop), offset=(stop-start)*.28867513;
    let mass=0, incident=0;
    for (const d of [mid-offset,mid+offset]) {
      const p=origin.clone().addScaledVector(ray,d), w=room(p);
      if (!w) continue;
      mass+=w;
      incident+=w*CHAPEL_SKY_GAIN*sky*skyTransfer(p);
    }
    const opacity=1-Math.exp(-.5*(stop-start)*ext*mass);
    light+=trans*opacity*incident/Math.max(mass,1e-5);
    trans*=1-opacity;
    start=stop;
  }
  if (ext>0 && key>0 && liveShadow>0) {
    const beam=beamIntegral(beamIntervals(origin,ray,depth),t=>{
      const p=origin.clone().addScaledVector(ray,t);
      return room(p)*glassKey(p,sun)*Math.exp(-ext*t);
    });
    light+=ext*CHAPEL_KEY_GAIN*key*THREE.MathUtils.lerp(1,Math.min(2.4,phase),.65)*liveShadow*beam;
  }
  return {light,trans};
}

function glassKey(p: THREE.Vector3, dir: THREE.Vector3) {
  if (!room(p) || dir.y<=.001) return 0;
  const tx=Math.abs((dir.x<0?lo.x:hi.x)-p.x)/Math.max(1e-6,Math.abs(dir.x));
  const tz=Math.abs((dir.z<0?lo.z:hi.z)-p.z)/Math.max(1e-6,Math.abs(dir.z));
  const xWall=tx<tz, wall=xWall ? (dir.x<0?0:1) : (dir.z>0?2:3);
  const incidence=Math.abs(xWall?dir.x:dir.z);
  if (incidence<=.025) return 0;
  const inner=p.clone().addScaledVector(dir,Math.min(tx,tz)), outer=inner.clone().addScaledVector(dir,2*CHAPEL_REVEAL/incidence);
  const middle=inner.clone().lerp(outer,.5);
  const along=(q:THREE.Vector3) => xWall?-q.z:q.x;
  const a=CHAPEL_AIR_WALL_GROUPS[wall].map(i => CHAPEL_APERTURES[i]).find(a => Math.abs(along(middle)-a.lateral)<a.width/2);
  if (!a) return 0;
  const frame=(q:THREE.Vector3) => {
    const u=Math.abs(along(q)-a.lateral), h=q.y-a.bottom;
    const t=Math.sqrt(Math.max(0,1-2*u/a.width));
    return Math.min(a.width/2-u,h,a.spring+(a.height-a.spring)*t*(1.44-.44*t)-h);
  };
  const reveal=Math.min(frame(inner),frame(outer));
  if (reveal<=0) return 0;
  const line=new THREE.Ray(p,dir);
  if (occluders.some(box => box.containsPoint(p) || (line.intersectBox(box,V(0,0,0))?.distanceTo(p) ?? Infinity)<p.distanceTo(outer)*.998)) return 0;
  return a.transmission*smooth(0,.12,reveal);
}
// Recorded real follow-camera stations from the closed, unlit chapel walk.
// Use a stone proxy for depth here; this is not an image/compositor assertion.
const views = [
  { name:'pews', eye:V(18.983,1.931,-11.131), q:new THREE.Quaternion(.04364,-.48458,.02421,.87332) },
  { name:'nave', eye:V(25.111,1.478,-19.208), q:new THREE.Quaternion(.04606,.88128,-.08785,.46207) },
  { name:'altar', eye:V(30.128,1.570,-14.800), q:new THREE.Quaternion(.07856,.39880,-.03431,.91302) },
];
it('matches the checked-in offline sky bake', () => {
  const baked = bakeChapelSkyField();
  expect(baked.every((value,i) => code[i] === value)).toBe(true);
});

it('includes every glazed opening, including both keyed clerestories, without the door or bridge', () => {
  expect(CHAPEL_AIR_WALL_GROUPS.map(group => group.length)).toEqual([3,1,4,5]);
  const indices=CHAPEL_AIR_WALL_GROUPS.flat();
  expect(new Set(indices)).toEqual(new Set(CHAPEL_APERTURES.flatMap((a,i) => a.bottom>7 ? [i] : [])));
  for (const i of indices) {
    const a=CHAPEL_APERTURES[i], n=a.plane-2.5*a.side, y=a.bottom-1.5;
    const p=a.axis==='x' ? V(n,y,-a.lateral) : V(a.lateral,y,-n);
    expect(chapelSkyVisibility(p.x,p.y,p.z,i), `aperture ${i}`).toBeGreaterThan(.001);
  }
  expect(chapelSkyVisibility(18,.8,-20)).toBeLessThan(chapelSkyVisibility(21,3,-17));
  expect(chapelSkyVisibility(18.1,2,-20.2,13)).toBe(0); // near-side deck/stone veto, not another pane
  for (const p of [V(12.8,2,-16.5),V(16,-1,-20),V(20,14,-21.9)]) expect(chapelSkyVisibility(p.x,p.y,p.z)).toBe(0);
});

it('backprojects the real day key through west and north reveals, with soft edges and a dark gap', () => {
  const project = (pane: THREE.Vector3, y: number) => pane.clone().addScaledVector(sun,-(pane.y-y)/sun.y);
  const west=project(V(13.25,9.7,-16.5),1.8);
  const north=project(V(23.3,9,-22.25),2.5);
  const edge=project(V(23.54,9,-22.25),2.5), gap=project(V(24.8,9,-22.25),2.5);
  expect(glassKey(west,sun)).toBeGreaterThan(.15); // through the partition opening
  expect(glassKey(north,sun)).toBeGreaterThan(.25);
  expect(glassKey(edge,sun)).toBeGreaterThan(0);
  expect(glassKey(edge,sun)).toBeLessThan(.15);
  expect(glassKey(gap,sun)).toBe(0);
  expect(glassKey(north,V(0,1,0))).toBe(0); // roof is not an emitter
  expect(glassKey(north,V(-1,-.1,0).normalize())).toBe(0);
  expect(glassKey(project(V(13.25,2.6,-16.5),1.8),sun)).toBe(0); // no glowing door source
});

it('keeps a subdued cloudy fill and exposed beam contrast in eye-level play at both budgets', () => {
  for (const {name,eye,q} of views) {
    for (const steps of [18,32]) {
      const rays = Array.from({length:13*11},(_,i) => {
        const ray=V((- .43+(i%13)*1.15/12)/1.08,(.69-Math.floor(i/13)*1.22/10)/1.92,-1)
          .normalize().applyQuaternion(q);
        const end=opaqueEnd(eye,ray);
        const sky=integrate(eye,ray,end,steps).light;
        const key=integrate(eye,ray,end,steps,{sky:0,key:dayKey,liveShadow:.5}).light;
        return {sky,key};
      });
      const sky=rays.map(r => r.sky).sort((a,b) => a-b);
      expect(sky[71],name).toBeLessThan(.014); // not a large grey offset in the median ray
      expect(sky[128],name).toBeGreaterThan(.014);
      expect(Math.max(...rays.map(r => r.key)),name).toBeGreaterThan(.011);
      expect(rays.some(r => r.key<.003),name).toBe(true);
    }
  }
});

it('stops at foreground depth; real source power, daylight, and the A/B switch are independent', () => {
  const {eye,q}=views[2];
  const ray=V(-.27,.17,-1).normalize().applyQuaternion(q);
  const depth=opaqueEnd(eye,ray);
  const draw=(sources?: Parameters<typeof integrate>[4], end=depth) => integrate(eye,ray,end,32,sources);
  const day=draw();
  expect(day.light).toBeGreaterThan(.002);
  expect(day.trans).toBeLessThan(1);
  expect(day.trans).toBeGreaterThan(.75); // optically thin, not a murky veil
  expect(draw({},.35).light).toBeLessThan(day.light*.12);
  expect(draw({sky:0,key:0})).toEqual({light:0,trans:day.trans}); // no haze colour standing in for irradiance
  expect(draw({sky:irradiance*.5}).light).toBeCloseTo(day.light*.5,10);
  expect(draw({sky:0,key:dayKey,liveShadow:0}).light).toBe(0);
  expect(draw({toggle:0,key:dayKey,liveShadow:1})).toEqual({light:0,trans:1});
  expect(draw({haze:daylightLuma(0x324359),key:dayKey,liveShadow:1})).toEqual({light:0,trans:1});
  expect(integrate(V(20,-1,-17),V(1,0,0),8,32,{key:dayKey,liveShadow:1})).toEqual({light:0,trans:1});
});

it('integrates a sub-bin window crossing continuously as the eye moves', () => {
  // A low horizontal cross-aisle ray through a north clerestory's projected
  // corridor. Move the eye along the same line: the total key flux should not
  // jump just because the shaft crosses a fixed distance-to-camera shell.
  const pane=V(23.3,9,-22.25), y=2.5;
  const core=pane.clone().addScaledVector(sun,-(pane.y-y)/sun.y);
  const ray=V(1,0,0);
  const origin=core.clone().addScaledVector(ray,-4.1);
  let previous: number | undefined;
  for (let i=0;i<24;++i) {
    const eye=origin.clone().addScaledVector(ray,-i*.035), depth=5+i*.035;
    const spans=beamIntervals(eye,ray,depth);
    const f=(t:number) => glassKey(eye.clone().addScaledVector(ray,t),sun);
    const result=beamIntegral(spans,f), exact=beamIntegral(spans,f,true);
    expect(exact).toBeGreaterThan(.08);
    expect(result).toBeCloseTo(exact,2);
    if(previous!==undefined) expect(Math.abs(previous-result)).toBeLessThan(.00001);
    previous=result;
  }
  const before=beamIntervals(origin,ray,3.6);
  expect(beamIntegral(before,t => glassKey(origin.clone().addScaledVector(ray,t),sun))).toBe(0);
});

it('wires single-channel sky lookup and shared real shadow depth, not a per-aperture GPU loop', () => {
  const key=new THREE.DirectionalLight(); key.castShadow=true;
  key.shadow.map=new THREE.WebGLRenderTarget(4,4,{ format:THREE.RGFormat });
  const pass=new ShadowVolumePass(true,()=>key,()=>{});
  const depth=new THREE.DepthTexture(4,4);
  try {
    pass.uniforms.tDepth.value=depth;
    const draw={shadowMap:{enabled:true},setRenderTarget(){},render(mesh: THREE.Mesh){
      const shader=(mesh.material as THREE.ShaderMaterial).fragmentShader;
      expect(shader).toContain('moments.y*moments.y');
      expect(shader).toContain('awChapelSky(pa)');
      expect(shader).toContain('awBeamWall(chapelSpan,ray,uKeyDirection');
      expect(shader).toContain('awBeamSpan(line,pane,lateral)');
      expect(shader).toContain('room*frame*awLit(q0+dq*t)');
      expect(shader).toContain('trans*=1.-chapelOpacity');
    }} as unknown as THREE.WebGLRenderer;
    pass.render(draw);
    expect(pass.uniforms.tKey.value).toBe(key.shadow.map.texture);
    const sky=pass.uniforms.tChapelSky.value;
    expect([sky.image.width,sky.image.height,sky.image.depth]).toEqual([...size]);
    expect(sky.format).toBe(THREE.RedFormat);
    expect(sky.minFilter).toBe(THREE.LinearFilter);
    expect(AIR_SOURCE_GLSL).toContain('awChapelGlassIndex(wall,xWall ? -centre.z : centre.x)');
    expect(AIR_SOURCE_GLSL).not.toContain('visible,awApertureKey(AW_AIR_CHAPEL[i]');
    expect(AIR_SOURCE_GLSL).not.toContain('awApertureFlux(AW_AIR_CHAPEL[i]');
    expect(WINDOW_SCATTER_GLSL).not.toContain('AW_SCATTER_CHAPEL');
  } finally { pass.dispose(); key.shadow.map.dispose(); depth.dispose(); }
});

it('does not classify the sealed B1 roof gap or a feathered chapel foot as outdoor air', () => {
  // Read the emitted classifier limits so the witness follows the same slab
  // and mid-wall footprint used by both compositors, not the sky voxel grid.
  const body = (signature: string, next: string) => AIR_SOURCE_GLSL.split(signature)[1].split(next)[0];
  const under = body('bool awChapelUnderFloor(vec3 p)', 'bool awChapelWeatherRoom');
  const weatherRoom = body('bool awChapelWeatherRoom(vec3 p)', 'struct AwAirAperture');
  const footprintTests = (shader: string) => Array.from(shader.matchAll(
    /awFootprintInset\(p\.xz, vec2\(([^)]+)\), vec2\(([^)]+)\)\) >= 0\.0/g), ([,a,b]) => {
    const [x0,z0]=a.split(',').map(Number), [x1,z1]=b.split(',').map(Number);
    return (p: THREE.Vector3) => x0<=p.x && p.x<=x1 && z0<=p.z && p.z<=z1;
  });
  const floor=+AIR_SOURCE_GLSL.match(/const float AW_CHAPEL_FLOOR = ([\d.]+)/)![1];
  const ceiling=+under.match(/\(p\.y < ([\d.]+)/)![1];
  const [slab,store]=footprintTests(under);
  const [insideWeatherWall]=footprintTests(weatherRoom);
  const underFloor = (p: THREE.Vector3) => p.y<floor && (slab(p) || (p.y<ceiling && store(p)));
  // Both weather sources have an unconditional zero branch before the only
  // outside return, followed by indoor-only transport (never mix with 1).
  const sky=body('float awSkyAccess(vec3 p)', 'float awCourtShaftKey');
  const key=body('float awKeyAccess(vec3 p, vec3 toKey)', '`;');
  for (const access of [sky,key]) {
    expect(access).toContain('if (awChapelUnderFloor(p)) return 0.0;');
    expect(access).toContain('if (awChapelWeatherRoom(p))');
    expect(access.indexOf('awChapelUnderFloor')).toBeLessThan(access.indexOf('awChapelWeatherRoom'));
    expect(access.indexOf('awChapelWeatherRoom')).toBeLessThan(access.indexOf('return 1.0;'));
    expect(access.slice(access.indexOf('if (awChapelWeatherRoom(p))'))).not.toMatch(/mix\(1\.|awChapelMediumWeight/);
  }
  for (const y of [0,.01,.075,.149,.15,.449]) {
    for (const p of [V(21,y,-15.4),V(17.8766,y,-14.62),V(13.17,y,-16),V(15.1,y,-20)]) {
      expect(underFloor(p), p.toArray().join(',')).toBe(true);
      expect(room(p)).toBe(0);
    }
  }
  expect(underFloor(V(12.9,.14,-12))).toBe(true); // buffered B1 store edge beyond the slab envelope
  for (const p of [V(13.31,floor+.01,-16.5),V(21,floor,-15.4)]) {
    expect(underFloor(p)).toBe(false);
    expect(insideWeatherWall(p)).toBe(true); // zero-medium sample is still on the indoor receiver branch
    expect(room(p)).toBe(0);
  }
  for (const p of [V(8,.08,-12),V(6,.08,-9.8),V(31.2,.08,-16)]) {
    expect(underFloor(p)).toBe(false);
    expect(insideWeatherWall(p)).toBe(false);
  }
});
