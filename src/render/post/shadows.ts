// 软阴影（LGT-04）：PCSS 思路的可变半影。r187 的 PCF 分支用硬件比较采样器拿不到原始深度，
// 无法做 blocker search；VSM 分支的 RG 矩里 mean 即平均 blocker 深度，据此估计半影宽度：
// 接触处硬、离遮挡物远则软，再用 Vogel 盘做 Chebyshev 软采样。配合 VSMShadowMap + shadow.radius。
import * as THREE from 'three';

/** Depth/normal/mask passes do not sample shadows. Keep shadow support enabled
 * (shader defines and beauty's map), but skip WebGLShadowMap.render's update. */
export function withoutShadowUpdates(renderer: THREE.WebGLRenderer, render: () => void): void {
  const shadowMap = renderer.shadowMap;
  const { autoUpdate, needsUpdate } = shadowMap;
  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = false;
  try {
    render();
  } finally {
    shadowMap.autoUpdate = autoUpdate;
    shadowMap.needsUpdate ||= needsUpdate;
  }
}

let installed = false;

const VSM_PCSS = /* glsl */`
	// PCSS-like variable penumbra from VSM moments (mean = average blocker depth)
	float vsmNoise( vec2 position ) {
		return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
	}
	vec2 vsmVogel( int sampleIndex, int samplesCount, float phi ) {
		const float goldenAngle = 2.399963229728653;
		float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
		float theta = float( sampleIndex ) * goldenAngle + phi;
		return vec2( cos( theta ), sin( theta ) ) * r;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		#ifdef USE_REVERSED_DEPTH_BUFFER
			shadowCoord.z -= shadowBias;
		#else
			shadowCoord.z += shadowBias;
		#endif
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
			vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
			float mean = distribution.x;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float hard_shadow = step( mean, shadowCoord.z );
			#else
				float hard_shadow = step( shadowCoord.z, mean );
			#endif
			if ( hard_shadow == 1.0 ) {
				shadow = 1.0;
			} else {
				// 半影宽度 ∝ (receiver - blocker) / blocker：贴地接触阴影锐利，远处投影柔化
				float blocker = max( mean, 1e-4 );
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float penumbra = clamp( ( blocker - shadowCoord.z ) / blocker * 24.0, 0.0, 1.0 );
				#else
					float penumbra = clamp( ( shadowCoord.z - blocker ) / blocker * 24.0, 0.0, 1.0 );
				#endif
				vec2 texel = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * mix( 0.25, 1.0, penumbra );
				float phi = vsmNoise( gl_FragCoord.xy ) * PI2;
				float acc = 0.0;
				for ( int i = 0; i < 8; i++ ) {
					vec2 off = vsmVogel( i, 8, phi ) * radius * texel;
					vec2 d = texture2D( shadowMap, shadowCoord.xy + off ).rg;
					float m = d.x;
					float v = max( d.y * d.y, 0.0000001 );
					#ifdef USE_REVERSED_DEPTH_BUFFER
						float dd = m - shadowCoord.z;
						float hs = step( m, shadowCoord.z );
					#else
						float dd = shadowCoord.z - m;
						float hs = step( shadowCoord.z, m );
					#endif
					float p = clamp( ( v / ( v + dd * dd ) - 0.3 ) / 0.65, 0.0, 1.0 );
					acc += max( hs, p );
				}
				shadow = acc * 0.125;
			}
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
`;

export function installSoftShadows(): void {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  const b = chunk.indexOf('#else // SHADOWMAP_TYPE_BASIC');
  if (a < 0 || b < 0 || b < a) return; // 结构变化时保留内置 VSM，画面仍正确
  THREE.ShaderChunk.shadowmap_pars_fragment =
    chunk.slice(0, a) + '#elif defined( SHADOWMAP_TYPE_VSM )\n' + VSM_PCSS + '\n\t' + chunk.slice(b);
}
