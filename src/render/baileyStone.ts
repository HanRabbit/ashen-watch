import * as THREE from 'three';

type Finish = 'curtain' | 'outcrop' | 'carving';

// The tower atlas covers whole buildings. On the rock ledge and carvings it records
// the deep cracks, moss and chisel marks. Lay a metre-scaled scan underneath those features.
const projection = /* glsl */`
  varying vec3 vStonePosition;
  varying vec3 vStoneDirection;
  uniform sampler2D uStoneAlbedo;
  uniform sampler2D uStoneNormal;
  #ifdef AW_COURSED_STONE
    uniform sampler2D uStoneRough;
  #endif

  void readStonePlane(vec2 uv, vec2 dx, vec2 dy, float weight, vec3 axisU, vec3 axisV,
                      inout vec3 colour, inout vec3 slope, inout float rough) {
    if (weight <= 0.0) return;
    colour += weight * textureGrad(uStoneAlbedo, uv, dx, dy).rgb;
    vec3 n = textureGrad(uStoneNormal, uv, dx, dy).rgb * 2.0 - 1.0;
    slope += weight * (axisU * n.x + axisV * n.y) / max(.62, n.z);
    #ifdef AW_COURSED_STONE
      rough += weight * textureGrad(uStoneRough, uv, dx, dy).g;
    #endif
  }
`;

const sampleStone = /* glsl */`
  vec3 stoneDirection = normalize(vStoneDirection);
  vec3 faces = abs(stoneDirection);
  // Fade the overlapping planes smoothly on worn corners. Explicit gradients keep
  // the scan in the correct mip even where neighbouring fragments use another axis.
  vec3 weights = smoothstep(vec3(.40), vec3(1.), faces / max(max(faces.x, faces.y), faces.z));
  weights /= dot(weights, vec3(1.));
  vec3 metres = vStonePosition * AW_SCAN_DENSITY;
  vec3 dx = dFdx(metres), dy = dFdy(metres);
  vec3 scanColour = vec3(0.), scanSlope = vec3(0.);
  float scanRough = 0.;
  const vec3 X = vec3(1.,0.,0.), Y = vec3(0.,1.,0.), Z = vec3(0.,0.,1.);
  readStonePlane(metres.zy, dx.zy, dy.zy, weights.x, Z, Y, scanColour, scanSlope, scanRough);
  readStonePlane(metres.xz, dx.xz, dy.xz, weights.y, X, Z, scanColour, scanSlope, scanRough);
  readStonePlane(metres.xy, dx.xy, dy.xy, weights.z, X, Y, scanColour, scanSlope, scanRough);
  const vec3 luma = vec3(.2126,.7152,.0722);
  float atlasValue = dot(diffuseColor.rgb, luma);
  float grainValue = dot(scanColour, luma);
  float moss = smoothstep(.045, .26, (diffuseColor.g - diffuseColor.b) / max(atlasValue, .024));
  #ifdef AW_COURSED_STONE
    vec3 course = mix(scanColour, vec3(grainValue), .56) * vec3(.75,.77,.79);
    float coverage = mix(.39,.76, dot(weights,weights)) * (1. - .38*moss);
    float dry = smoothstep(-.1,1.55,vStonePosition.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, course*(.50+1.10*sqrt(atlasValue)), coverage) * mix(.74,1.,dry);
  #else
    // The rock-face scan is iron-brown. Transfer its mineral values in linear light,
    // keeping the atlas's lichen and mineral colour. The carving is a pale limestone.
    float mineral = clamp((grainValue - .072) * 8.5, -.43, .63);
    float veil = (1.-moss*.72) * smoothstep(.010, .078, atlasValue);
    #ifdef AW_CARVED_STONE
      diffuseColor.rgb *= mix(vec3(1.), vec3(.91,.89,.83)*(1.+mineral*.76), veil);
    #else
      // Pale ridges in this stretched atlas include baked illumination. Compress them
      // around the measured bare slate value while retaining the hue of the fissures.
      float slate = clamp(.103 / max(.038,atlasValue), .62, 1.32);
      diffuseColor.rgb *= mix(1.,slate,.69*veil) * (1.+1.27*mineral*veil);
      diffuseColor.rgb *= mix(vec3(1.), vec3(1.065,1.024,.966), veil);
    #endif
  #endif
`;

/** Only the diffuse atlas and its authored normal follow the sculpt UV seams.
 * The scan has its own position, tangent basis and roughness at the same scale. */
export function dressBaileyStone(model: THREE.Group, stone: THREE.MeshStandardMaterial, finish: Finish): void {
  const copies = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  function withFinish(source: THREE.Material): THREE.Material {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source;
    const shared = copies.get(source);
    if (shared) return shared;
    const mat = source.clone();
    copies.set(source, mat);
    mat.defines = { ...mat.defines, AW_SCAN_DENSITY: { curtain: '0.308', outcrop: '1.05', carving: '2.15' }[finish] };
    if (finish === 'curtain') mat.defines.AW_COURSED_STONE = 1;
    if (finish === 'carving') mat.defines.AW_CARVED_STONE = 1;
    // Fitting the generated rock to the gate stretched its baked tangent detail.
    // Keep its broad fractures, letting the undistorted scan carry the surface relief.
    mat.normalScale.multiplyScalar({ curtain: .55, outcrop: .25, carving: .72 }[finish]);
    mat.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile(shader, renderer);
      shader.uniforms.uStoneAlbedo = { get value() { return stone.map; } };
      shader.uniforms.uStoneNormal = { get value() { return stone.normalMap; } };
      if (finish === 'curtain') shader.uniforms.uStoneRough = { get value() { return stone.roughnessMap; } };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vStonePosition;
        varying vec3 vStoneDirection;`).replace('#include <begin_vertex>', `#include <begin_vertex>
        vStonePosition = (modelMatrix * vec4(transformed,1.)).xyz;
        vStoneDirection = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${projection}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${sampleStone}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          #ifdef AW_COURSED_STONE
            // Local aggregate, pale friable mortar, then rough moss in the joints.
            float faceRough = clamp(.68 + .38*(scanRough - .45), .62, .92);
            float mortar = smoothstep(.26,.47,grainValue);
            roughnessFactor = mix(.16*roughnessFactor + .84*faceRough, .97, max(mortar,moss));
          #else
            float pores = clamp(length(scanSlope)*1.85,0.,1.);
            float mineralRough = clamp(.81+.15*pores-.15*mineral, .67,.97);
            roughnessFactor = mix(.24*roughnessFactor+.76*mineralRough, .96, moss);
          #endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 detail = scanSlope - stoneDirection * dot(stoneDirection, scanSlope);
          #ifdef AW_COURSED_STONE
            float strength = .53*(1.-.42*mortar);
          #else
            float strength = .88*veil;
          #endif
          normal = normalize(normal + mat3(viewMatrix)*detail*strength*faceDirection);`);
    };
    mat.customProgramCacheKey = () => `aw-mineral-${finish}:${source.customProgramCacheKey()}`;
    return mat;
  }
  model.traverse(object => {
    if (object instanceof THREE.Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(withFinish) : withFinish(object.material);
  });
}
