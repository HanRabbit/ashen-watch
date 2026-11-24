import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { AIR_SOURCE_GLSL, CHAPEL_AIR_EXTINCTION, CHAPEL_AIR_GRID, CHAPEL_BEAM_GLSL, CHAPEL_BEAM_NODES, CHAPEL_BEAM_SPLIT, CHAPEL_BEAM_WEIGHTS, CHAPEL_KEY_GAIN, CHAPEL_SKY_GAIN,
  HEIGHT_COLUMN_GLSL, WEATHER_REACH, WINDOW_SCATTER_GLSL, loadChapelSkyField } from './airVolume';
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
  #define AW_CHAPEL_FIELD
  ${HEIGHT_COLUMN_GLSL}
  ${AIR_SOURCE_GLSL}
  ${WINDOW_SCATTER_GLSL}
  ${CHAPEL_BEAM_GLSL}
  ${COURT_MIST_GLSL}
  float awLit(vec3 q) {
    // Beyond the site-sized shadow frustum ease to the open valley, never repeat an edge caster.
    vec3 inset = min(q,1.-q);
    float coverage = smoothstep(0.,.023,min(inset.x,min(inset.y,inset.z)));
    if(coverage<=0.) return 1.;
    #ifdef AW_MOMENTS
      // Three's RG16F VSM pass stores mean and standard deviation, in
      // normalised shadow depth; G needs squaring (not a second raw moment).
      vec2 moments = texture2D(tKey, q.xy).rg;
      float dz=max(0.,q.z-.0007-moments.x), variance=max(.0000004,moments.y*moments.y);
      float lit=clamp((variance/(variance+dz*dz)-.23)/.77,0.,1.);
    #else
      float lit=texture(tKey,vec3(q.xy,q.z-.0007));
    #endif
    return mix(1.,lit,coverage);
  }
  // Eight-point symmetric Gauss-Legendre quadrature, reparameterised to
  // each window footprint instead of fixed, camera-centred weather shells.
  // If a shaft is very long we smoothly introduce a second half-span rule
  // (no changing sample count/phase discontinuity while walking).
  const vec4 AW_BEAM_NODES=vec4(${CHAPEL_BEAM_NODES.join(',')});
  const vec4 AW_BEAM_WEIGHTS=vec4(${CHAPEL_BEAM_WEIGHTS.join(',')});
  float awBeamTap(float t, AwBeamLine line, AwAirAperture pane, float lateral, vec3 ray, vec3 key,
                  vec3 q0, vec3 dq, float chapelEntry, float attenuation) {
    float frame=awBeamReveal(line,pane,t,lateral);
    if(frame<=0.) return 0.;
    vec3 p=uOrigin+ray*t;
    float room=awChapelMediumWeight(p);
    if(room<=0.) return 0.;
    float toOuter=line.t0+line.dt*t+.5/max(.025,abs(pane.outward.x!=0. ? key.x : key.z));
    if(awAirChapelBlocked(p,p+key*toOuter)) return 0.;
    return room*frame*awLit(q0+dq*t)*exp(-attenuation*(t-chapelEntry));
  }
  float awBeamQuad(vec2 t, AwBeamLine line, AwAirAperture pane, float lateral, vec3 ray, vec3 key,
                   vec3 q0, vec3 dq, float chapelEntry, float attenuation) {
    float mid=.5*(t.x+t.y), halfSpan=.5*(t.y-t.x);
    float integral=0.;
    for(int i=0;i<4;++i) {
      float offset=AW_BEAM_NODES[i]*halfSpan;
      integral+=AW_BEAM_WEIGHTS[i]*(awBeamTap(mid-offset,line,pane,lateral,ray,key,q0,dq,chapelEntry,attenuation)
                                  + awBeamTap(mid+offset,line,pane,lateral,ray,key,q0,dq,chapelEntry,attenuation));
    }
    return halfSpan*integral;
  }
  float awBeamWall(vec2 interval, vec3 ray, vec3 key, vec3 q0, vec3 dq, bool xWall, float attenuation) {
    float component=xWall ? key.x : key.z;
    if(abs(component)<=.025) return 0.;
    int wall=xWall ? (component<0. ? 0 : 1) : (component>0. ? 2 : 3);
    AwBeamLine line=awBeamLine(uOrigin,ray,interval,key,xWall);
    if(line.interval.y<=line.interval.x) return 0.;
    vec2 lat=line.inner.x+line.interval*line.slope.x;
    float minLat=min(lat.x,lat.y), maxLat=max(lat.x,lat.y), light=0.;
    int first=wall==0 ? 0 : AW_BEAM_END[wall-1];
    for(int i=first;i<AW_BEAM_END[wall];++i){ // one wall family, once per ray
      AwAirAperture pane=AW_AIR_CHAPEL[AW_BEAM_ORDER[i]];
      float lateral=xWall ? -pane.sill.z : pane.sill.x;
      if(lateral+pane.shape.x<minLat) continue;
      if(lateral-pane.shape.x>maxLat) break;
      vec2 span=awBeamSpan(line,pane,lateral);
      if(span.y<=span.x) continue;
      float split=smoothstep(${CHAPEL_BEAM_SPLIT.join(',')},span.y-span.x);
      float integral=0.;
      if(split<1.) integral=awBeamQuad(span,line,pane,lateral,ray,key,q0,dq,interval.x,attenuation)*(1.-split);
      if(split>0.) {
        float mid=.5*(span.x+span.y);
        integral+=split*(awBeamQuad(vec2(span.x,mid),line,pane,lateral,ray,key,q0,dq,interval.x,attenuation)
                       + awBeamQuad(vec2(mid,span.y),line,pane,lateral,ray,key,q0,dq,interval.x,attenuation));
      }
      light+=pane.transmission*integral;
    }
    return light;
  }
  // A baked, tileable, single-channel volume: two trilinear fetches instead of
  // evaluating dozens of hashes per step. Wind advects the air, not the stone or camera.
  uniform highp sampler3D tWeather;
  const vec3 awWeatherScale=vec3(.022,.049,.019);
  float awDrift(vec3 p, float footprint) {
    // Filter along the ray as a depth bin widens. Sampling only mip 0 made
    // fine density rotate in and out of existence on long grazing rays.
    vec3 uv=p*awWeatherScale + vec3(-.00135,.00009,.00054)*uTime;
    float lod=log2(max(.5,footprint));
    float broad=textureLod(tWeather,uv,max(0.,lod)).r;
    float fine=textureLod(tWeather,uv.zxy*1.93+vec3(.32,.47,.73),max(0.,lod+.94860)).r;
    return .74*broad + .26*fine;
  }
  void main(){
    float depth=texture2D(tDepth,vUv).r;
    vec3 viewRay=normalize(vec3((vUv*2.-1.)*uTan,-1.));
    vec3 ray=mat3(uWorld)*viewRay;
    float end=min(AW_WEATHER_REACH,(uClip.x*uClip.y)/(uClip.y-depth*(uClip.y-uClip.x)) / -viewRay.z);
    float horizon=depth>=1. ? .68*(1.-smoothstep(.035,.32,ray.y)) : 1.;
    vec3 q0=(uShadow*vec4(uOrigin,1.)).xyz, dq=mat3(uShadow)*ray; // orthographic site key
    float texelsPerMetre=length(ray*awWeatherScale)*float(textureSize(tWeather,0).x);
    float mu=dot(ray,uKeyDirection);
    const float g=.39;
    float denom=1.+g*g-2.*g*mu;
    float phase=(1.-g*g)/(denom*sqrt(denom)); // HG relative to isotropic scattering
    // The lamp rig is calibrated for opaque surfaces. Normalise the scattering
    // lobe; do not paint the moon's surface-light intensity into every mist bin.
    float skyEnergy=dot(uSky,vec3(.2126,.7152,.0722));
    float daylight=awWindowDaylight(skyEnergy);
    float windowScale=max(0.,uWindowScatter)*daylight;
    vec3 windowSkySource=AW_WINDOW_SKY_GAIN*uWindowIrradiance;
    vec3 chapelSkySource=${CHAPEL_SKY_GAIN.toFixed(2)}*uWindowIrradiance;
    bool hasSky=any(greaterThan(uWindowIrradiance,vec3(0.)));
    bool hasKey=any(greaterThan(uKeyColour,vec3(0.)));
    // A/B and night controls fade the chapel medium as well as the source
    // terms; actual emitter power affects only incident radiance, not density.
    float chapelMedium=${CHAPEL_AIR_EXTINCTION.toFixed(4)}*clamp(windowScale,0.,1.);
    vec2 gateWindow=vec2(end,0.), chapelWindow=vec2(end,0.);
    if(windowScale>0.) {
      vec3 inv=awInverseSegment(ray);
      if(hasSky || hasKey) gateWindow=awWindowInterval(uOrigin,inv,vec3(-3.,.02,0.),vec3(3.,3.5,7.94));
      chapelWindow=awWindowInterval(uOrigin,inv,AW_CHAPEL_LO,AW_CHAPEL_HI);
    }
    bool windowRay=gateWindow.x<min(end,gateWindow.y) || chapelWindow.x<min(end,chapelWindow.y);
    if(horizon<.001){
      if(!windowRay){gl_FragColor=vec4(0.,0.,0.,1.);return;}
      horizon=0.; // Window air can be seen against sky above the outdoor mist horizon.
      end=min(end,max(gateWindow.y,chapelWindow.y));
    }
    vec3 direct=uKeyColour*(.0795775*phase)*mix(.42,1.,smoothstep(.025,.23,skyEnergy));
    float trans=1.,start=0.; vec3 light=vec3(0.);
    // Use the existing weather integration for attenuation; it no longer
    // chooses the sampling positions of directional chapel radiance.
    vec2 chapelSpan=vec2(chapelWindow.x,min(end,chapelWindow.y));
    bool chapelKey=hasKey && uKeyDirection.y>.001 && chapelSpan.y>chapelSpan.x;
    float chapelT0=1.,chapelT1=1.;
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
      float drift=weatherWeight>.001 ? mix(.5,awDrift(p,texelsPerMetre*(stop-start)),weatherWeight) : .5;
      float ground=(layers.x*(.53+drift)+bank)*(1.-.985*shelter);
      float upper=layers.y*mix(.90,1.04,drift)*(1.-.965*shelter);
      float density=ground+upper;
      float opacity=1.-exp(-density*(stop-start)*awNearWeather(mid)*horizon);
      bool gateBin=start<gateWindow.y && stop>gateWindow.x;
      bool chapelBin=start<chapelWindow.y && stop>chapelWindow.x;
      if(opacity>.00008 || gateBin || chapelBin){
        // Keep the existing two weather/gatehouse key-shadow taps and the
        // same smooth sampling of the chapel's baked diffuse sky.
        float delta=(stop-start)*.28867513;
        float a=mid-delta, b=mid+delta;
        vec3 pa=uOrigin+ray*a, pb=uOrigin+ray*b;
        vec2 wa=vec2(0.), wb=vec2(0.);
        if(gateBin){
          wa=awWindowTransport(pa,uKeyDirection);
          wb=awWindowTransport(pb,uKeyDirection);
        }
        float ra=chapelBin ? awChapelMediumWeight(pa) : 0.;
        float rb=chapelBin ? awChapelMediumWeight(pb) : 0.;
        float ka=opacity>.00008 ? awKeyAccess(pa,uKeyDirection) : 0.;
        float kb=opacity>.00008 ? awKeyAccess(pb,uKeyDirection) : 0.;
        float litA=max(ka,wa.y)>0. ? awLit(q0+dq*a) : 0.;
        float litB=max(kb,wb.y)>0. ? awLit(q0+dq*b) : 0.;
        if(gateBin){
          // Existing optically thin gatehouse term, including its A/B behaviour.
          vec3 windowSky=windowSkySource*.5*(wa.x+wb.x);
          vec3 windowKey=AW_WINDOW_KEY_GAIN*uKeyColour*phase*.5*(wa.y*litA+wb.y*litB);
          light+=trans*(1.-.5*opacity)*(stop-start)*AW_WINDOW_DUST*windowScale*(windowSky+windowKey);
        }
        float chapelOpacity=0.;
        if(ra+rb>0.){
          // The diffuse field has a broad spatial bandwidth. Only the sharply
          // shadowed key needs aperture-local quadrature below.
          float skyA=ra>0. && hasSky ? awChapelSky(pa) : 0.;
          float skyB=rb>0. && hasSky ? awChapelSky(pb) : 0.;
          vec3 chapelSky=chapelSkySource*(ra*skyA+rb*skyB);
          float mass=.5*(stop-start)*chapelMedium;
          chapelOpacity=1.-exp(-mass*(ra+rb));
          light+=trans*(1.-.5*opacity)*chapelOpacity*chapelSky/max(ra+rb,1e-5);
        }
        if(chapelKey && start<chapelSpan.y && stop>=chapelSpan.x) {
          // Entry/exit transmittance of the lit volume, including extinction
          // accumulated before entering. Fit a local exponential for key.
          float binT=(1.-opacity)*(1.-chapelOpacity);
          float invSpan=1./max(stop-start,1e-5);
          if(start<=chapelSpan.x) chapelT0=trans*pow(binT,clamp((chapelSpan.x-start)*invSpan,0.,1.));
          chapelT1=trans*pow(binT,clamp((chapelSpan.y-start)*invSpan,0.,1.));
        }
        if(opacity>.00008){
          float sun=.5*(ka*litA+kb*litB);
          // A damp bank can see diffuse sky even in the key's shadow.
          vec3 ambient=mix(uGround,uSky,clamp((upper+.48*bank)/max(density,1e-5),0.,1.));
          float sky=awSkyAccess(p);
          vec3 source=ambient*sky*mix(.84,1.,sun) + direct*sun*(1.-.88*shelter);
          light+=trans*(1.-.5*chapelOpacity)*opacity*source;
          trans*=1.-opacity;
        }
        trans*=1.-chapelOpacity;
      }
      if(stop>=end)break;
      start=stop;
    }
    if(chapelKey) {
      float attenuation=max(0.,log(max(1e-5,chapelT0)/max(1e-5,chapelT1)))/(chapelSpan.y-chapelSpan.x);
      float beam=awBeamWall(chapelSpan,ray,uKeyDirection,q0,dq,true,attenuation)
                +awBeamWall(chapelSpan,ray,uKeyDirection,q0,dq,false,attenuation);
      float chapelPhase=mix(1.,min(2.4,phase),.65);
      light+=chapelT0*chapelMedium*${CHAPEL_KEY_GAIN.toFixed(2)}*chapelPhase*beam*uKeyColour;
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

function chapelSkyTile(): THREE.Data3DTexture {
  const tile = new THREE.Data3DTexture(loadChapelSkyField(), ...CHAPEL_AIR_GRID.size);
  tile.name = 'Chapel · revealed overcast sky transfer';
  tile.format = THREE.RedFormat;
  tile.minFilter = tile.magFilter = THREE.LinearFilter;
  tile.needsUpdate = true;
  return tile;
}

export class ShadowVolumePass extends Pass {
  readonly target = new THREE.WebGLRenderTarget(1,1, {type:THREE.HalfFloatType, depthBuffer:false,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter, generateMipmaps:false});
  readonly uniforms = {
    tWeather:{value:weatherTile()}, tChapelSky:{value:chapelSkyTile()}, tDepth:{value:null as THREE.Texture|null}, tKey:{value:null as THREE.Texture|null},
    uShadow:{value:new THREE.Matrix4()}, uWorld:{value:new THREE.Matrix4()},
    uTan:{value:new THREE.Vector2()}, uOrigin:{value:new THREE.Vector3()}, uClip:{value:new THREE.Vector2()},
    uFog:{value:new THREE.Vector3()}, uSky:{value:new THREE.Color()}, uGround:{value:new THREE.Color()},
    uAirDoors:{value:new THREE.Vector2()},uWindowScatter:{value:1},uWindowIrradiance:{value:new THREE.Color(0,0,0)},
    uKeyColour:{value:new THREE.Color(0,0,0)},uKeyDirection:{value:new THREE.Vector3()},uTime:{value:0},
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
    this.uniforms.uKeyColour.value.copy(key.color).multiplyScalar(key.visible ? Math.max(0,key.intensity) : 0);
    const tex=this.cinematic ? rt?.texture : rt?.depthTexture;
    const available=!!(tex && this.uniforms.tDepth.value && renderer.shadowMap.enabled && key.castShadow &&
      (this.cinematic ? tex.format===THREE.RGFormat : rt?.depthTexture?.compareFunction===THREE.LessEqualCompare));
    this.ready(available);
    if(!available)return;
    this.uniforms.tKey.value=tex!;
    this.uniforms.uShadow.value.copy(shadow.matrix);
    renderer.setRenderTarget(this.target);this.quad.render(renderer);
  }
  override dispose(){this.uniforms.tWeather.value.dispose();this.uniforms.tChapelSky.value.dispose();this.target.dispose();this.material.dispose();this.quad.dispose();}
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
