import * as THREE from 'three';
import bakedData from './baked/court.irr.bin?url&inline';
import { PROBE_COUNT, PROBE_GRID as g } from './probeGrid';

/** Install the immutable bake before Three clones its first material uniforms. The
 * packed data is part of the build, so the loading screen and first frame agree. */
export function loadCourtTransport(): THREE.Data3DTexture {
  const encoded = bakedData.slice(bakedData.indexOf(',') + 1);
  const data = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
  if (data.length !== PROBE_COUNT * 8) throw new Error('Invalid courtyard light bake');
  const map = new THREE.Data3DTexture(data, g.nx, g.nz, 2 * g.ny);
  map.name = 'Court diffuse transport';
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

// Interpolate in air a fraction of a cell away from the surface, especially across parapets.
// Recover cosine-weighted visibility from the sky's zeroth and first moments. Normalizing
// by an open hemisphere keeps the original open-sky IBL and material response calibrated.
export const COURT_TRANSPORT_GLSL = /* glsl */`
uniform highp sampler3D uAwCourtTransport;
void awCourtTransport(vec3 p, vec3 n, out float visibility, out vec3 bounce, out float proximity) {
  visibility = 1.0; bounce = vec3(0.0); proximity = 0.0;
  vec3 q = p + n * 0.32;
  float weight = smoothstep(-0.12,0.20,p.y) * (1.0-smoothstep(7.8,9.0,q.y));
  weight *= smoothstep(-20.7,-18.9,q.x) * (1.0-smoothstep(10.1,12.9,q.x));
  weight *= smoothstep(-0.10,0.79,q.z) * (1.0-smoothstep(38.3,40.8,q.z));
  if (weight < 0.001) return;
  vec3 cell = (q.xzy - vec3(${g.x},${g.z},${g.y})) / vec3(${g.dx},${g.dx},${g.dy});
  cell = clamp(cell, vec3(0.0), vec3(${g.nx-1}.0,${g.nz-1}.0,${g.ny-1}.0));
  vec3 uvw = (cell+0.5)/vec3(${g.nx}.0,${g.nz}.0,${2*g.ny}.0);
  vec4 sky = texture(uAwCourtTransport,uvw);
  vec4 reflected = texture(uAwCourtTransport,uvw + vec3(0.0,0.0,0.5));
  float openSky = max(0.24, 0.5 + 0.5*n.y);
  float directional = max(0.0, 0.5*sky.a + 2.0*dot(sky.rgb-0.5,n));
  float coverage = mix(sky.a, min(1.0,directional/openSky), smoothstep(-0.6,0.05,n.y)*0.83);
  visibility = mix(1.0, 0.23 + 0.77*coverage, weight);
  bounce = weight * reflected.rgb * 0.25;
  proximity = weight * reflected.a;
}
`;
