import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { LightGlowShader } from '../src/render/post/glow';
import { WEATHER_REACH, WINDOW_SCATTER_GLSL } from '../src/render/post/airVolume';
import { ShadowVolumePass } from '../src/render/post/shadowVolume';
import { groundY } from '../src/sim/level';
import { newWorld } from '../src/sim/state';

const smooth = (lo: number, hi: number, x: number) => THREE.MathUtils.smoothstep(x, lo, hi);
const vec = (csv: string) => new THREE.Vector3(...csv.split(',').map(Number));
// Decode the shipped apertures rather than keeping a second set of fixture dimensions.
const apertures = [...WINDOW_SCATTER_GLSL.matchAll(/AwAirAperture\(vec3\(([^)]+)\), vec2\(([^)]+)\), vec3\(([^)]+)\), ([\d.]+), 0\)/g)]
  .map(([, sill, outward, shape, transmission]) => {
    const [x,z] = outward.split(',').map(Number);
    return { sill: vec(sill), normal: new THREE.Vector3(x, 0, z), lateral: new THREE.Vector3(z, 0, x), shape: vec(shape), transmission: +transmission };
  });
type Aperture = typeof apertures[number];
const [front, frontPane, rear, rearPane] = apertures;
const [frontDepth, rearDepth] = [...WINDOW_SCATTER_GLSL.matchAll(/, 0\), (0\.\d+)\)/g)].map(([, n]) => +n);
const constant = (pattern: RegExp) => +WINDOW_SCATTER_GLSL.match(pattern)![1];
const dust = constant(/AW_WINDOW_DUST = ([.\d]+)/);
const skyGain = constant(/AW_WINDOW_SKY_GAIN = ([.\d]+)/);
const keyGain = constant(/AW_WINDOW_KEY_GAIN = ([.\d]+)/);
const luma = new THREE.Vector3(.2126,.7152,.0722);
const linearLuma = (hex: number) => {
  const {r,g,b}=new THREE.Color(hex);
  return new THREE.Vector3(r,g,b).dot(luma);
};
const dayHaze = linearLuma(0x8996a2);
const nightHaze = linearLuma(0x324359);
const dayIrradiance = linearLuma(0xc8d2da) * 2.34 * .88;
const nightIrradiance = linearLuma(0x7d90b4) * 2.45 * .14;
const dayKey = linearLuma(0xe4ebef) * .72;
const moonKey = linearLuma(0x7f9ccf) * 1.2;
const sun = new THREE.Vector3(-.58,.68,-.42).normalize();
function frame(a: Aperture, p: THREE.Vector3, feather: number) {
  const offset = p.clone().sub(a.sill);
  const x = Math.abs(offset.dot(a.lateral)), t = Math.sqrt(Math.max(0,1-x/a.shape.x));
  const head = THREE.MathUtils.lerp(a.shape.y,a.shape.z,t*(1.44-.44*t));
  return smooth(0,feather,Math.min(a.shape.x-x,offset.y,head-offset.y));
}
function access(p: THREE.Vector3, toKey: THREE.Vector3, mouth: Aperture, pane = mouth, half = .25) {
  const recess = mouth.sill.clone().sub(p).dot(mouth.normal), inside = recess-half;
  const reach = 3.65;
  if (inside <= 0 || inside >= reach) return [0,0];
  const path = (dir: THREE.Vector3) => {
    const incidence=dir.dot(mouth.normal);
    if (incidence <= .025) return 0;
    const hit = (offset: number) => p.clone().addScaledVector(dir,(recess+offset)/incidence);
    const outer = hit(half), feather = .055;
    const reveal = Math.min(frame(mouth,outer,feather),frame(mouth,hit(-half),feather));
    if (!reveal) return 0;
    const seat = pane.sill.clone().sub(mouth.sill).dot(mouth.normal);
    return Math.min(reveal,frame(pane,hit(seat-.027),feather),frame(pane,hit(seat+.027),feather));
  };
  let sky=0;
  const area=1.65*pane.shape.x*pane.shape.z;
  for (const [i,h] of [.61,.44,.28].entries()) {
    const leg=pane.sill.clone().addScaledVector(pane.lateral,(i-1)*.48*pane.shape.x).sub(p);
    leg.y+=h*pane.shape.z;
    const d2=leg.lengthSq(), dir=leg.normalize();
    sky+=path(dir)*smooth(-.24,.14,dir.y)*Math.max(0,dir.dot(pane.normal))*area/(Math.PI*d2+area);
  }
  const local=pane.transmission*smooth(0,.16,inside)*(1-smooth(reach*.48,reach,inside));
  return [sky/3*local,path(toKey)*local];
}

const follow = (x: number, z: number, yaw: number, pitch: number) => {
  const world = newWorld();
  Object.assign(world.player,{x,z,y:groundY(x,z),yaw,pitch});
  const camera = new THREE.PerspectiveCamera(55,16/9,.1,320);
  const rig = new CameraRig(camera);
  for (let i=0;i<90;i++) rig.update(world,world.player,yaw,pitch,1/60);
  camera.updateMatrixWorld(true);
  return camera;
};
const phase = (ray: THREE.Vector3) => (1-.39**2) / (1+.39**2-.78*ray.dot(sun))**1.5;
const [nightEdge, dayEdge] = WINDOW_SCATTER_GLSL.match(/smoothstep\((\.\d+),(\.\d+),hazeRigLuma\)/)!.slice(1).map(Number);
function rayLight(origin: THREE.Vector3, direction: THREE.Vector3, depth: number, steps: number,
  { haze=dayHaze, irradiance=dayIrradiance, key=dayKey, toggle=1, shadow=1 } = {}) {
  const daylight=toggle*smooth(nightEdge,dayEdge,haze);
  let L=0, start=0;
  for (let i=1;i<=steps;i++) {
    const t=i/steps, stop=Math.min(depth,WEATHER_REACH*t*(.26+.74*t));
    const mid=(start+stop)*.5, offset=(stop-start)*.28867513;
    for (const d of [mid-offset,mid+offset]) {
      const p=origin.clone().addScaledVector(direction,d);
      let skyAccess=0, keyAccess=0;
      if (Math.abs(p.x)<3 && p.z>0 && p.z<7.94 && p.y>.02 && p.y<3.5) {
        for (const [a,b,half] of [[front,frontPane,frontDepth],[rear,rearPane,rearDepth]] as const) {
          const [s,k]=access(p,sun,a,b,half);
          skyAccess+=s; keyAccess+=k;
        }
      }
      // Conservative sizing fixture: apply 15% upstream transmittance loss and no inferred bounce.
      L+=.85*.5*(stop-start)*dust*daylight*(skyGain*irradiance*skyAccess+keyGain*key*phase(direction)*keyAccess*shadow);
    }
    if (stop >= depth) break;
    start=stop;
  }
  return L;
}

it('admits the daytime sun only through the actual stone lips and glass seat', () => {
  expect([frontDepth,rearDepth]).toEqual([.25,.28]);
  expect(apertures).toHaveLength(4); // gatehouse front/rear mouths and seats, not the door.
  const frontCore = new THREE.Vector3(-1.033,.95,.45);
  expect(access(frontCore,sun,front,frontPane,frontDepth)[1]).toBeGreaterThan(.02);
  expect(access(frontCore.clone().add(new THREE.Vector3(.43,0,0)),sun,front,frontPane,frontDepth)[1]).toBe(0);
  expect(access(new THREE.Vector3(.6,1.97,7.05),sun,rear,rearPane,rearDepth)[1]).toBe(0);
  expect(access(new THREE.Vector3(.6,1.97,7.05),sun,rear,rearPane,rearDepth)[0]).toBeGreaterThan(.05);
});

// Neutral stone witness: match the scalar Three ACES fit for neutral gray, then sRGB;
// this estimates code-value scale, not the frame's material, LUT, grain, or GPU shadow.
function displayGray(hdr: number) {
  const x=hdr/.6;
  const linear=Math.max(0,(x*(x+.0245786)-.000090537)/(x*(.983729*x+.432951)+.238081));
  return linear <= .0031308 ? 12.92*linear : 1.055*linear**(1/2.4)-.055;
}

it('integrates a subtle daylight difference on camera rays at both quality budgets and stops at opaque depth', () => {
  const fixtures = [
    { camera: follow(-.93,-3.48,-.31,-.04), target: new THREE.Vector3(-1.99,1.90,.88), name:'gatehouse' },
  ];
  for (const {camera,target,name} of fixtures) {
    const direction=target.clone().sub(camera.position).normalize(), length=target.distanceTo(camera.position);
    const ndc=target.clone().project(camera);
    expect(Math.abs(ndc.x),name).toBeLessThan(.8);
    expect(Math.abs(ndc.y),name).toBeLessThan(.8);
    for (const steps of [18,32]) {
      const on=rayLight(camera.position,direction,length+.78,steps);
      const shaded=rayLight(camera.position,direction,length+.78,steps,{shadow:0});
      expect(shaded,name).toBeGreaterThan(.0015); // A soft visible term even without a clear directional tap.
      expect(on,name).toBeLessThan(.02);
      expect(255*(displayGray(.035+shaded)-displayGray(.035)),name).toBeGreaterThan(1);
      expect(rayLight(camera.position,direction,length+.78,steps,{toggle:0}),name).toBe(0);
      expect(rayLight(camera.position,direction,length+.78,steps,{haze:nightHaze,irradiance:nightIrradiance,key:moonKey}),name).toBe(0);
      expect(rayLight(camera.position,direction,Math.max(.1,length-5),steps),name).toBeLessThan(on*.27);
    }
  }
  expect(rayLight(new THREE.Vector3(7,-1.45,-12),new THREE.Vector3(1,0,0),3.5,32)).toBe(0);
});

it.each([[.08,-3.6],[-1.35,-2.02]])('has a gatehouse signal at the walk QA stops (%s, %s)', (x,z) => {
  const target=new THREE.Vector3(-1.54,1.94,.58); // projected air ROI; render Z is opposite simulation Z.
  let camera=follow(x,z,Math.atan2(target.x-x,-target.z-z),-.06);
  for (let i=0;i<2;i++) {
    const d=target.clone().sub(camera.position);
    camera=follow(x,z,Math.atan2(d.x,-d.z),-Math.atan2(d.y,Math.hypot(d.x,d.z)));
  }
  const ray=target.clone().sub(camera.position).normalize();
  // Conservatively terminate even before the glazing (inside face of the wall).
  const toWall=-camera.position.z/ray.z;
  expect(rayLight(camera.position,ray,toWall,32,{shadow:0})).toBeGreaterThan(.001);
});

it('calibrates day luminance while keeping sky and key independently source-driven', () => {
  expect(skyGain*dayIrradiance).toBeCloseTo(2.7*dayHaze,3);
  // Cross the front pane's actual key corridor near the sill (the follow
  // witnesses above deliberately look mostly at the diffuse hearth air).
  const origin=new THREE.Vector3(-1.033,.95,.95);
  const ray=new THREE.Vector3(0,0,-1);
  const draw = (sources?: Parameters<typeof rayLight>[4]) => rayLight(origin,ray,.92,32,sources);
  const skyOnly=draw({key:0}), keyOnly=draw({irradiance:0});
  expect(skyOnly).toBeGreaterThan(0);
  expect(keyOnly).toBeGreaterThan(0);
  expect(draw()).toBeCloseTo(skyOnly+keyOnly,10);
  expect(draw({key:0,irradiance:dayIrradiance*.5})).toBeCloseTo(skyOnly*.5,10);
  expect(draw({irradiance:0,key:0})).toBe(0); // bright weather tint cannot stand in for either emitter
  expect(draw({haze:nightHaze,irradiance:nightIrradiance,key:moonKey})).toBe(0);
});

it('binds the live pass uniform once and adds only depth-guided RGB radiance', () => {
  const key=new THREE.DirectionalLight(); key.castShadow=true;
  key.shadow.map=new THREE.WebGLRenderTarget(4,4,{ format:THREE.RGFormat });
  const pass=new ShadowVolumePass(true,()=>key,()=>{});
  const depth=new THREE.DepthTexture(4,4);
  let material: THREE.ShaderMaterial;
  const renderer={shadowMap:{enabled:true},setRenderTarget(){},render(mesh: THREE.Mesh){
    material=mesh.material as THREE.ShaderMaterial;
  }} as unknown as THREE.WebGLRenderer;
  try {
    pass.uniforms.tDepth.value=depth;
    key.color.setHex(0xe4ebef);
    key.intensity=.72;
    pass.render(renderer);
    const shader=material!.fragmentShader;
    expect(material!.uniforms.uWindowScatter).toBe(pass.uniforms.uWindowScatter);
    expect(material!.uniforms.uWindowIrradiance).toBe(pass.uniforms.uWindowIrradiance);
    expect(pass.uniforms.uWindowIrradiance.value.toArray()).toEqual([0,0,0]);
    const receiverSky=new THREE.Color(0xc8d2da).multiplyScalar(2.34*.88);
    pass.uniforms.uWindowIrradiance.value.copy(receiverSky);
    expect(pass.uniforms.uKeyColour.value.toArray()).toEqual(key.color.clone().multiplyScalar(.72).toArray());
    key.visible=false;
    pass.render(renderer);
    expect(pass.uniforms.uKeyColour.value.toArray()).toEqual([0,0,0]);
    expect(pass.uniforms.uWindowIrradiance.value.equals(receiverSky)).toBe(true);
    key.visible=true;
    key.intensity=0;
    pass.render(renderer);
    expect(pass.uniforms.uKeyColour.value.toArray()).toEqual([0,0,0]);
    expect(pass.uniforms.uWindowScatter.value).toBe(1);
    pass.uniforms.uWindowScatter.value=0;
    pass.render(renderer);
    expect(material!.uniforms.uWindowScatter.value).toBe(0);
    expect(shader).toContain('float stop=min(end,');
    expect(shader).toContain('awWindowDaylight(skyEnergy)');
    expect(shader).toContain('uniform vec3 uWindowIrradiance');
    expect(shader).toContain('windowSkySource=AW_WINDOW_SKY_GAIN*uWindowIrradiance');
    expect(shader).toContain('windowSky=windowSkySource');
    expect(shader).not.toMatch(/(?:windowSkySource|windowSky)=.*\buSky\b/);
    expect(shader).toContain('wa.y*litA+wb.y*litB');
    expect(shader).toContain('AW_WINDOW_DUST*windowScale*(windowSky+windowKey)');
    expect(shader).toContain('gl_FragColor=vec4(light,trans)');
    expect(LightGlowShader.fragmentShader).toContain('awResolveVolume(here,isSky,confidence)');
    expect(LightGlowShader.fragmentShader).not.toContain('AW_WINDOW_DUST');
  } finally { pass.dispose(); key.shadow.map.dispose(); depth.dispose(); }
});
