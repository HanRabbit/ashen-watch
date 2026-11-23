import type { PerspectiveCamera } from 'three';
import type { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { STONE_POOL_GLSL } from '../stoneWater';

/** Screen-space hits supplement the material's sky reflection in puddles, not on dry stone. */
export function configureWetReflections(pass: SSRPass, camera: PerspectiveCamera): void {
  // Beauty/geometry are still full-resolution; the soft reflection ray march is not.
  pass.resolutionScale = 0.5;
  const m = pass.ssrMaterial;
  m.uniforms.uAwCameraWorld = { value: camera.matrixWorld };
  m.fragmentShader = /* glsl */`
    uniform mat4 uAwCameraWorld;
    ${STONE_POOL_GLSL}
    float awFrameEdge(vec2 uv) {
      vec2 margin = min(uv, 1.0 - uv);
      return smoothstep(0.0, 0.055, min(margin.x, margin.y));
    }
  ` + m.fragmentShader.replace('vec3 viewNormal=getViewNormal( vUv );', /* glsl */`
    vec3 viewNormal=getViewNormal( vUv );
    vec3 worldPos = (uAwCameraWorld * vec4(viewPosition, 1.0)).xyz;
    float normalY = (uAwCameraWorld * vec4(viewNormal, 0.0)).y;
    float facing = smoothstep(0.70, 0.96, normalY);
    float atGrade = 1.0 - smoothstep(0.03, 0.16, abs(worldPos.y));
    if (facing * atGrade < 0.001) return;
    float wet = facing * atGrade * smoothstep(0.28, 0.84, awPoolFootprint(worldPos.xz));
    if (wet < 0.001) return;
  `).replace('vec4 reflectColor=texture2D(tDiffuse,uv);', /* glsl */`
    vec4 reflectColor=texture2D(tDiffuse,uv);
    float luma = dot(reflectColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    reflectColor.rgb *= min(1.0, 2.2 / max(luma, 1e-4));
    op *= wet * awFrameEdge(vUv) * awFrameEdge(uv);
  `);
  m.needsUpdate = true;
}
