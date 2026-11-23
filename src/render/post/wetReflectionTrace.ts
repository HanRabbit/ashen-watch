import { STONE_POOL_GLSL } from '../stoneWater';

// Depth fetches per covered origin: 1 source + 1 initial + 44 coarse + 6 refinement + 2 edge probes.
// The coarse stride grows with projected length, up to 12 full-resolution texels.
export const WET_TRACE = {
  glossySteps: 44,
  roughSteps: 24,
  maxStride: 12,
  refineSteps: 6,
  minIncidence: 0.04,
  planeFadeStart: 0.25,
  planeFadeEnd: 0.75,
} as const;

export const WET_REFLECTION_FRAGMENT = /* glsl */`
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform sampler2D tMetalness;
  uniform sampler2D uAwSceneColor;
  uniform mat4 uAwCameraWorld;
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 cameraInverseProjectionMatrix;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float maxDistance;
  uniform float thickness;
  uniform float opacity;

  #include <packing>
  ${STONE_POOL_GLSL}

  struct DepthSample {
    ivec2 pixel;
    float depth;
    float gap;
  };

  float awViewDepth(ivec2 pixel) {
    float raw = texelFetch(tDepth, pixel, 0).r;
    #ifdef USE_REVERSED_DEPTH_BUFFER
      if (raw <= 0.0) return 0.0;
    #else
      if (raw >= 1.0) return 0.0;
    #endif
    return -perspectiveDepthToViewZ(raw, cameraNear, cameraFar);
  }

  vec3 awViewPosition(ivec2 pixel, float depth, vec2 size) {
    vec2 ndc = (vec2(pixel) + 0.5) * (2.0 / size) - 1.0;
    vec3 view = (cameraInverseProjectionMatrix * vec4(ndc, -1.0, 1.0)).xyz;
    return view * (depth / -view.z);
  }

  vec3 awViewNormal(ivec2 pixel) {
    vec3 normal = unpackRGBToNormal(texelFetch(tNormal, pixel, 0).rgb);
    float magnitudeSq = dot(normal, normal);
    // Reject uninitialized/non-normal texels before normalizing.
    if (magnitudeSq < 0.5 || magnitudeSq > 1.5) return vec3(0.0);
    return normal * inversesqrt(magnitudeSq);
  }

  DepthSample awSample(vec2 pixel, float rayDepth) {
    ivec2 texel = ivec2(pixel);
    float depth = awViewDepth(texel);
    return DepthSample(texel, depth, rayDepth - depth);
  }

  bool awBehind(DepthSample tap) {
    return tap.depth > 0.0 && tap.gap >= 0.0;
  }

  float awFrameEdge(vec2 uv) {
    vec2 margin = min(uv, 1.0 - uv);
    return smoothstep(0.0, 0.055, min(margin.x, margin.y));
  }

  float awAxisLimit(float start, float delta, float extent) {
    if (abs(delta) < 1e-5) return 1.0;
    float edge = delta > 0.0 ? extent - 0.5 : 0.5;
    return (edge - start) / delta;
  }

  // Project a fraction of the 3D segment to a fraction of its 2D projection.
  float awScreenFraction(float fraction, vec2 invW) {
    return fraction * invW.x / mix(invW.y, invW.x, fraction);
  }

  float awPlaneConfidence(
    ivec2 pixel, float depth, vec2 size, vec3 anchor, vec3 normal, float tolerance
  ) {
    if (depth <= 0.0) return 0.0;
    float error = abs(dot(awViewPosition(pixel, depth, size) - anchor, normal));
    return 1.0 - smoothstep(${WET_TRACE.planeFadeStart} * tolerance,
      ${WET_TRACE.planeFadeEnd} * tolerance, error);
  }

  float awEdgeProbe(ivec2 pixel, ivec2 size, vec3 anchor, vec3 normal, float tolerance) {
    if (any(lessThan(pixel, ivec2(0))) || any(greaterThanEqual(pixel, size))) return 0.0;
    return awPlaneConfidence(pixel, awViewDepth(pixel), vec2(size), anchor, normal, tolerance);
  }

  void main() {
    // SSRPass draws without clearing, so every early return must write a transparent miss.
    gl_FragColor = vec4(0.0);
    if (maxDistance <= 0.0 || opacity <= 0.0) return;
    float sourceEdge = awFrameEdge(vUv);
    if (sourceEdge <= 0.0) return;
    #ifdef SELECTIVE
      if (texture2D(tMetalness, vUv).r < 0.5) return;
    #endif

    ivec2 depthSize = textureSize(tDepth, 0);
    vec2 size = vec2(depthSize);
    ivec2 sourcePixel = ivec2(vUv * size);
    float sourceDepth = awViewDepth(sourcePixel);
    if (sourceDepth <= 0.0) return;
    vec3 origin = awViewPosition(sourcePixel, sourceDepth, size);
    vec3 worldPos = (uAwCameraWorld * vec4(origin, 1.0)).xyz;
    float atGrade = 1.0 - smoothstep(0.03, 0.16, abs(worldPos.y));
    if (atGrade <= 0.001) return;

    vec3 normal = awViewNormal(sourcePixel);
    vec3 incoming = normalize(origin);
    float sourceIncidence = dot(normal, -incoming);
    if (sourceIncidence <= 0.015) return;
    float normalY = (uAwCameraWorld * vec4(normal, 0.0)).y;
    float facing = smoothstep(0.70, 0.96, normalY);
    if (facing * atGrade <= 0.001) return;
    float pool = smoothstep(0.28, 0.84, awPoolFootprint(worldPos.xz));
    float wet = facing * atGrade * pool;
    if (wet <= 0.001) return;

    // The footprint proxies roughness: clear pool centers get a longer, finer search.
    // Use one stable specular ray at every roughness and filter the resulting radiance.
    float roughness = mix(0.52, 0.20, wet);
    float rough = smoothstep(0.20, 0.52, roughness);
    int budget = int(mix(float(${WET_TRACE.glossySteps}), float(${WET_TRACE.roughSteps}), rough) + 0.5);
    vec3 ray = normalize(reflect(incoming, normal));
    // A normalized view-space ray is measured in world units for the rigid camera.
    float reach = maxDistance * mix(1.0, 0.55, rough);
    float lengthLimit = reach;
    if (ray.z > 1e-5) {
      lengthLimit = min(lengthLimit, (sourceDepth - cameraNear * 1.001) / ray.z);
    } else if (ray.z < -1e-5) {
      lengthLimit = min(lengthLimit, (cameraFar * 0.999 - sourceDepth) / -ray.z);
    }
    const float originBias = 0.025;
    if (lengthLimit <= originBias) return;

    vec3 end = origin + ray * lengthLimit;
    vec4 clip = cameraProjectionMatrix * vec4(end, 1.0);
    vec2 invW = 1.0 / vec2(sourceDepth, clip.w);
    vec2 start = vec2(sourcePixel) + 0.5;
    vec2 delta = (clip.xy * invW.y * 0.5 + 0.5) * size - start;
    float span = max(abs(delta.x), abs(delta.y));
    if (span <= 1.5) return;

    float first = max(1.5 / span, awScreenFraction(originBias / lengthLimit, invW));
    float screenLimit = min(1.0, min(awAxisLimit(start.x, delta.x, size.x), awAxisLimit(start.y, delta.y, size.y)));
    if (first >= screenLimit) return;
    float remaining = (screenLimit - first) * span;
    float covered = min(remaining, float(budget * ${WET_TRACE.maxStride}));
    float stride = clamp(covered / float(budget), mix(2.5, 4.5, rough), float(${WET_TRACE.maxStride}));
    float last = first + covered / span;
    float stepSize = stride / span;

    float lo = first;
    DepthSample front = awSample(start + delta * lo, 1.0 / mix(invW.x, invW.y, lo));
    if (awBehind(front)) return;
    for (int i = 0; i < ${WET_TRACE.glossySteps}; ++i) {
      if (i >= budget || lo >= last) break;
      float hi = min(last, first + float(i + 1) * stepSize);
      DepthSample back = awSample(start + delta * hi, 1.0 / mix(invW.x, invW.y, hi));
      if (!awBehind(back)) {
        lo = hi;
        front = back;
        continue;
      }

      // Refine the first candidate only. A rejected foreground crossing occludes the ray.
      for (int j = 0; j < ${WET_TRACE.refineSteps}; ++j) {
        float mid = 0.5 * (lo + hi);
        DepthSample tap = awSample(start + delta * mid, 1.0 / mix(invW.x, invW.y, mid));
        if (awBehind(tap)) {
          hi = mid;
          back = tap;
        } else {
          lo = mid;
          front = tap;
        }
      }

      vec3 hitNormal = awViewNormal(back.pixel);
      float incidence = dot(hitNormal, -ray);
      if (incidence <= ${WET_TRACE.minIncidence}) return;
      vec3 anchor = awViewPosition(back.pixel, back.depth, size);
      if (dot(hitNormal, normalize(-anchor)) <= 0.015) return;

      // A jump from sky or another depth layer can change sign without intersecting
      // a surface. Require both sides to agree with the receiving tangent plane.
      float tolerance = clamp(thickness, 0.015, 0.12);
      float confidence = awPlaneConfidence(front.pixel, front.depth, size, anchor, hitNormal, tolerance);
      if (confidence <= 0.0) return;
      float distance = dot(origin - anchor, hitNormal) / incidence;
      if (distance <= originBias || distance > lengthLimit) return;
      float hit = awScreenFraction(distance / lengthLimit, invW);
      // Depth is sampled at texel centers. Allow a subpixel correction for sloping surfaces.
      float slack = 0.75 / span;
      if (hit < max(first, lo - slack) || hit > min(last, hi + slack)) return;

      ivec2 axis = abs(delta.x) >= abs(delta.y) ? ivec2(1, 0) : ivec2(0, 1);
      float edgeA = awEdgeProbe(back.pixel - axis, depthSize, anchor, hitNormal, tolerance);
      float edgeB = awEdgeProbe(back.pixel + axis, depthSize, anchor, hitNormal, tolerance);
      confidence *= mix(0.20, 1.0, min(edgeA, edgeB));
      confidence *= smoothstep(${WET_TRACE.minIncidence}, 0.20, incidence);
      if (covered < remaining) {
        confidence *= 1.0 - smoothstep(0.85, 1.0, (hit - first) / (last - first));
      }

      vec2 hitUv = (vec2(back.pixel) + 0.5) / size;
      float strength = opacity * wet * confidence * sourceEdge * awFrameEdge(hitUv);
      #ifdef FRESNEL
        strength *= max(0.0, 1.0 - sourceIncidence * sourceIncidence);
      #endif
      float relativeDistance = distance / reach;
      #ifdef DISTANCE_ATTENUATION
        strength *= 1.0 - smoothstep(0.15, 1.0, relativeDistance);
      #else
        strength *= 1.0 - smoothstep(0.80, 1.0, relativeDistance);
      #endif
      if (strength <= 0.001) return;
      vec3 radiance = texelFetch(uAwSceneColor, back.pixel, 0).rgb;
      float luma = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(radiance * min(1.0, 2.2 / max(luma, 1e-4)), strength);
      return;
    }
  }
`;

// Keep the center's coverage through both half-resolution blur passes so a
// disocclusion or dry pixel does not inherit a neighbor's reflection alpha.
export const WET_REFLECTION_BLUR = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  varying vec2 vUv;

  float awPeak(vec3 rgb) {
    return max(rgb.r, max(rgb.g, rgb.b));
  }

  void main() {
    vec4 center = texture2D(tDiffuse, vUv);
    if (center.a <= 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float peak = awPeak(center.rgb);
    if (peak <= 0.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, center.a);
      return;
    }
    vec2 texel = 1.0 / resolution;
    vec4 left = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0));
    vec4 right = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0));
    vec4 down = texture2D(tDiffuse, vUv - vec2(0.0, texel.y));
    vec4 up = texture2D(tDiffuse, vUv + vec2(0.0, texel.y));
    vec3 sum = 2.0 * center.rgb * center.a + left.rgb * left.a + right.rgb * right.a
      + down.rgb * down.a + up.rgb * up.a;
    float weight = 2.0 * center.a + left.a + right.a + down.a + up.a;
    vec3 filtered = sum / weight;
    // Don't let a bright neighbor overwhelm radiance traced to a dark receiver.
    filtered *= min(1.0, 2.0 * peak / max(awPeak(filtered), 1e-5));
    gl_FragColor = vec4(filtered, center.a);
  }
`;
