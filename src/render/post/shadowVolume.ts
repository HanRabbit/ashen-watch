import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { HEIGHT_COLUMN_GLSL, WEATHER_REACH } from './airVolume';
import { COURT_MIST_GLSL } from './courtMist';

// RGB = integrated single-scattering radiance, A = camera transmittance in linear HDR.
// This pass runs after opaque depth AND the beauty pass's shadow refresh. No extra scene render.
const fragment = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDepth;
  #ifdef AW_MOMENTS
    uniform sampler2D tKey;
  #else
    uniform highp sampler2DShadow tKey;
  #endif
  uniform mat4 uShadow, uWorld;
  uniform vec2 uClip, uTan;
  uniform vec3 uOrigin,uFog,uGround,uSky,uKeyDirection,uKeyColour;
  uniform float uTime;
  ${HEIGHT_COLUMN_GLSL}
  ${COURT_MIST_GLSL}
  float awLit(vec3 q) {
    // Beyond the site-sized shadow frustum ease to the open valley, never repeat an edge caster.
    vec3 inset = min(q,1.-q);
    float coverage = smoothstep(0.,.023,min(inset.x,min(inset.y,inset.z)));
    if(coverage<=0.) return 1.;
    #ifdef AW_MOMENTS
      vec2 moments = texture2D(tKey, q.xy).rg;
      float dz=max(0.,q.z-.0007-moments.x), variance=max(.0000004,moments.y*moments.y);
      float lit=clamp((variance/(variance+dz*dz)-.23)/.77,0.,1.);
    #else
      float lit=texture(tKey,vec3(q.xy,q.z-.0007));
    #endif
    return mix(1.,lit,coverage);
  }
  // A baked, tileable, single-channel volume: two trilinear fetches instead of
  // evaluating dozens of hashes per step. Wind advects the air, not the stone or camera.
  uniform highp sampler3D tWeather;
  float awDrift(vec3 p, vec3 segment) {
    // Filter along the ray as a depth bin widens. Sampling only mip 0 made
    // fine density rotate in and out of existence on long grazing rays.
    vec3 scale=vec3(.022,.049,.019);
    vec3 uv=p*scale + vec3(-.00135,.00009,.00054)*uTime;
    float footprint=length(segment*scale)*float(textureSize(tWeather,0).x);
    float broad=textureLod(tWeather,uv,log2(max(1.,footprint))).r;
    float fine=textureLod(tWeather,uv.zxy*1.93+vec3(.32,.47,.73),log2(max(1.,footprint*1.93))).r;
    return .74*broad + .26*fine;
  }
  void main(){
    float depth=texture2D(tDepth,vUv).r;
    vec3 viewRay=normalize(vec3((vUv*2.-1.)*uTan,-1.));
    vec3 ray=mat3(uWorld)*viewRay;
    float end=min(AW_WEATHER_REACH,(uClip.x*uClip.y)/(uClip.y-depth*(uClip.y-uClip.x)) / -viewRay.z);
    float horizon=depth>=1. ? .68*(1.-smoothstep(.035,.32,ray.y)) : 1.;
    if(horizon<.001){gl_FragColor=vec4(0.,0.,0.,1.);return;}
    vec3 q0=(uShadow*vec4(uOrigin,1.)).xyz, dq=mat3(uShadow)*ray; // orthographic site key
    float mu=dot(ray,uKeyDirection);
    const float g=.39;
    float denom=1.+g*g-2.*g*mu;
    float phase=(1.-g*g)/(denom*sqrt(denom)); // HG relative to isotropic scattering
    // The lamp rig is calibrated for opaque surfaces. Normalise the scattering
    // lobe; do not paint the moon's surface-light intensity into every mist bin.
    float skyEnergy=dot(uSky,vec3(.2126,.7152,.0722));
    vec3 direct=uKeyColour*(.0795775*phase)*mix(.42,1.,smoothstep(.025,.23,skyEnergy));
    float trans=1.,start=0.; vec3 light=vec3(0.);
    // Fixed near-weighted bins: a nearby character does not change the spacing of all
    // upstream samples. Clip the last bin at the first visible surface. No animated dither.
    for(int i=0;i<AW_RAY_STEPS;i++){
      float t=float(i+1)/float(AW_RAY_STEPS);
      float stop=min(end,AW_WEATHER_REACH*t*(.26+.74*t));
      float mid=(start+stop)*.5;
      vec3 p=uOrigin+ray*mid;
      vec2 layers=uFog.xy*exp(-AW_FALLOFF*max(0.,p.y-uFog.z));
      float shelter=awAirShelter(p);
      float bank=awCourtyardMist(p,uTime);
      float weatherWeight=(1.-smoothstep(6.5,9.,p.y))*(1.-smoothstep(.76,.91,shelter));
      float drift=weatherWeight>.001 ? mix(.5,awDrift(p,ray*(stop-start)),weatherWeight) : .5;
      float ground=(layers.x*(.53+drift)+bank)*(1.-.985*shelter);
      float upper=layers.y*mix(.90,1.04,drift)*(1.-.965*shelter);
      float density=ground+upper;
      float opacity=1.-exp(-density*(stop-start)*awNearWeather(mid)*horizon);
      if(opacity>.00008){
        // Average visibility over the segment rather than toggling an entire
        // metre of air when its midpoint crosses a parapet or a mullion.
        float delta=(stop-start)*.28867513;
        float sun=.5*(awLit(q0+dq*(mid-delta))+awLit(q0+dq*(mid+delta)));
        vec3 ambient=mix(uGround,uSky,upper/max(density,1e-5));
        // Diffuse overcast fill is always present. Raking light exists only along the
        // unblocked part of the ray. Ground vapour scatters differently from the upper haze.
        vec3 source=ambient*mix(.84,1.,sun) + direct*sun*(1.-.88*shelter);
        light+=trans*opacity*source;
        trans*=1.-opacity;
      }
      if(stop>=end)break;
      start=stop;
    }
    gl_FragColor=vec4(light,trans);
  }
`;

/** Continuous periodic density; built once at quality setup, never per frame.
 * The coarse flow is aperiodic within a tile, unlike stacked planar sine waves. */
function weatherTile(): THREE.Data3DTexture {
  const size=32, values=new Uint8Array(size**3);
  const octave=(n:number, seed:number) => {
    let state=seed;
    const lattice=Float32Array.from({length:n**3},()=>{
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      return state/4294967296;
    });
    const get=(x:number,y:number,z:number)=>lattice[(x%n)+n*((y%n)+n*(z%n))];
    const smooth=(f:number)=>f*f*f*(f*(f*6-15)+10);
    const lerp=(a:number,b:number,f:number)=>a+(b-a)*f;
    return (x:number,y:number,z:number)=>{
      x*=n/size;y*=n/size;z*=n/size;
      const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);
      const u=smooth(x-i),v=smooth(y-j),w=smooth(z-k);
      const plane=(l:number)=>lerp(lerp(get(i,j,l),get(i+1,j,l),u),lerp(get(i,j+1,l),get(i+1,j+1,l),u),v);
      return lerp(plane(k),plane(k+1),w);
    };
  };
  const a=octave(4,19071),b=octave(8,862),c=octave(16,4292);
  for(let z=0;z<size;z++) for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    values[x+size*(y+size*z)]=Math.round(255*(.61*a(x,y,z)+.29*b(x,y,z)+.10*c(x,y,z)));
  }
  const tile=new THREE.Data3DTexture(values,size,size,size);
  tile.format=THREE.RedFormat;tile.magFilter=THREE.LinearFilter;tile.minFilter=THREE.LinearMipmapLinearFilter;
  tile.wrapR=tile.wrapS=tile.wrapT=THREE.RepeatWrapping;tile.generateMipmaps=true;tile.needsUpdate=true;
  return tile;
}

export class ShadowVolumePass extends Pass {
  readonly target = new THREE.WebGLRenderTarget(1,1, {type:THREE.HalfFloatType, depthBuffer:false,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter, generateMipmaps:false});
  readonly uniforms = {
    tWeather:{value:weatherTile()}, tDepth:{value:null as THREE.Texture|null}, tKey:{value:null as THREE.Texture|null},
    uShadow:{value:new THREE.Matrix4()}, uWorld:{value:new THREE.Matrix4()},
    uTan:{value:new THREE.Vector2()}, uOrigin:{value:new THREE.Vector3()}, uClip:{value:new THREE.Vector2()},
    uFog:{value:new THREE.Vector3()}, uSky:{value:new THREE.Color()}, uGround:{value:new THREE.Color()},
    uKeyColour:{value:new THREE.Color()},uKeyDirection:{value:new THREE.Vector3()},uTime:{value:0},
  };
  private readonly material:THREE.ShaderMaterial;
  private readonly quad:FullScreenQuad;
  constructor(private readonly cinematic:boolean, private readonly key:()=>THREE.DirectionalLight,
      private readonly ready:(available:boolean)=>void) {
    super(); this.needsSwap=false;
    this.target.texture.name='Court air · radiance and transmission';
    this.material=new THREE.ShaderMaterial({ uniforms:this.uniforms,depthTest:false,depthWrite:false,
      defines:{AW_RAY_STEPS:cinematic?32:18,...(cinematic?{AW_MOMENTS:1}:{})},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment });
    this.quad=new FullScreenQuad(this.material);
  }
  override setSize(w:number,h:number){
    this.target.setSize(Math.max(1,Math.ceil(w/(this.cinematic?2:3))),Math.max(1,Math.ceil(h/(this.cinematic?2:3))));
  }
  override render(renderer:THREE.WebGLRenderer){
    const key=this.key(),shadow=key.shadow, rt=shadow.map;
    const tex=this.cinematic ? rt?.texture : rt?.depthTexture;
    const available=!!(tex && this.uniforms.tDepth.value && renderer.shadowMap.enabled && key.castShadow &&
      (this.cinematic ? tex.format===THREE.RGFormat : rt?.depthTexture?.compareFunction===THREE.LessEqualCompare));
    this.ready(available);
    if(!available)return;
    this.uniforms.tKey.value=tex!;
    this.uniforms.uShadow.value.copy(shadow.matrix);
    this.uniforms.uKeyColour.value.copy(key.color).multiplyScalar(key.intensity);
    renderer.setRenderTarget(this.target);this.quad.render(renderer);
  }
  override dispose(){this.uniforms.tWeather.value.dispose();this.target.dispose();this.material.dispose();this.quad.dispose();}
}

// Opaque depth guides four half-resolution neighbours. A foreground shoulder against
// foggy sky cannot inherit a distant column. At subpixel silhouettes use the full-res
// analytical solution instead of sampling across the edge or darkening the silhouette.
export const GATHER_VOLUME_GLSL = /* glsl */`
vec4 awResolveVolume(float here, bool sky, out float confidence) {
  ivec2 size=textureSize(tVolume,0);
  vec2 pos=vUv*vec2(size)-.5, f=fract(pos);
  ivec2 base=ivec2(floor(pos));
  vec4 sum=vec4(0.); float mass=0.;
  for(int i=0;i<4;i++){
    ivec2 o=ivec2(i%2,i/2), pix=clamp(base+o,ivec2(0),size-1);
    vec2 tap=(vec2(pix)+.5)/vec2(size);
    float depth=texture2D(tDepth,tap).r;
    if ((depth >= 1.) != sky) continue; // The sky already has its own aerial perspective.
    float z=min(${WEATHER_REACH.toFixed(1)},viewDepth(depth));
    float self=min(${WEATHER_REACH.toFixed(1)},here);
    float w=mix(1.-f.x,f.x,float(o.x))*mix(1.-f.y,f.y,float(o.y));
    w*=1.-smoothstep(.06+self*.012,.30+self*.045,abs(z-self));
    sum+=w*texelFetch(tVolume,pix,0);mass+=w;
  }
  confidence=smoothstep(.02,.22,mass);
  return sum/max(mass,.00001);
}`;
