// Approximate indirect sky visibility under the castle roofs and below grade. Evaluate
// at each surface, not at the player or camera: outside and inside remain distinct
// in the same frame. Direct light, emissives and the lantern are left untouched.
import * as THREE from 'three';
import { AREAS, type Rect } from '../sim/level';

let installed = false;

export function installSkyExposure(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.common += /* glsl */`
#if defined( STANDARD )
  varying vec3 vAwExposurePosition;
#endif
`;
  const world = THREE.ShaderChunk.worldpos_vertex;
  THREE.ShaderChunk.worldpos_vertex = world.replace('#if defined( USE_ENVMAP )', '#if defined( STANDARD ) || defined( USE_ENVMAP )') + /* glsl */`
#if defined( STANDARD )
  vAwExposurePosition = worldPosition.xyz * vec3( 1.0, 1.0, -1.0 );
#endif
`;
  const { gatehouse, chapel } = AREAS;
  const room = ({ x0, x1, z0, z1 }: Rect) => `vec4(${x0.toFixed(2)}, ${z0.toFixed(2)}, ${x1.toFixed(2)}, ${z1.toFixed(2)})`;
  THREE.ShaderChunk.lights_pars_begin += /* glsl */`
#if defined( STANDARD )
  float awCovered( vec2 p, vec4 room ) {
    vec2 d = min( p - room.xy, room.zw - p );
    return smoothstep( -0.16, 0.18, min( d.x, d.y ) );
  }
  float awSkyExposure( vec3 p ) {
    // Gatehouse faces north into the courtyard; chapel has a west entrance and
    // diffuse spill from its tall windows. Keep a minimum for masonry bounce.
    float gatehouse = awCovered( p.xz, ${room(gatehouse)} ) * ( 1.0 - smoothstep( 3.6, 4.6, p.y ) );
    float chapel = awCovered( p.xz, ${room(chapel)} ) * ( 1.0 - smoothstep( 7.0, 10.5, p.y ) );
    float gateSpill = exp2( -max( 0.0, -p.z ) * 1.4 ) * ( 1.0 - smoothstep( 0.45, 2.0, abs( p.x ) ) );
    float chapelSpill = exp2( -max( 0.0, p.x - 13.5 ) * 0.75 ) * ( 1.0 - smoothstep( 0.8, 3.0, abs( p.z - 16.5 ) ) );
    float indoors = max( gatehouse * ( 0.50 - 0.31 * gateSpill ), chapel * ( 0.50 - 0.34 * chapelSpill ) );
    float belowGrade = 1.0 - smoothstep( -1.9, -0.1, p.y );
    return ( 1.0 - indoors ) * mix( 1.0, 0.31, belowGrade );
  }
#endif
`;
  THREE.ShaderChunk.lights_fragment_end += /* glsl */`
#if defined( STANDARD )
  {
    float awVisibility = awSkyExposure( vAwExposurePosition );
    reflectedLight.indirectDiffuse *= awVisibility;
    reflectedLight.indirectSpecular *= awVisibility * awVisibility;
  }
#endif
`;
}
