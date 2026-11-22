// 角色外部资产（art pass 2）：Objaverse CC-BY 模型的加载、归一化与着色器改造。
// 加载失败时返回 null，characters.ts 回退到程序化模型，游戏离线仍可运行。
// 模型来源与许可见 public/models/characters/CREDITS.md。
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface HunterAsset {
  /** 归一化根节点：脚底 y=0，面朝本地 -Z，身高约 1.75m。 */
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; run: THREE.AnimationClip };
  bones: Record<string, THREE.Bone>;
  /** 挂在右手 bone 上的米制锚点（提灯用）。 */
  handAnchor: THREE.Group;
  /** 挂在头 bone 上的米制锚点（兜帽用）。 */
  headAnchor: THREE.Group;
  /** 挂在胸椎 bone 上的米制锚点（斗篷用）。 */
  chestAnchor: THREE.Group;
}

export interface ReaperAsset {
  root: THREE.Group;
  body: THREE.Mesh;
  /** 网格局部空间的身高（着色器用）。 */
  localHeight: number;
  cloth: ClothUniforms;
}

export interface CreatureAsset {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationClip | null;
  spine: THREE.Bone[];
  bones: Record<string, THREE.Bone>;
  skin: WraithUniforms;
}

export interface CharacterAssets { hunter: HunterAsset; reaper: ReaperAsset; creature: CreatureAsset }

const URLS = { hunter: 'models/characters/hunter.glb', reaper: 'models/characters/reaper.glb', creature: 'models/characters/creature.glb' };

function loadGLB(url: string): Promise<GLTF> {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
}

/** 统一缩放、水平居中、贴地。faceFix 为绕 Y 的朝向修正（模型约定面朝 -Z）。 */
function normalize(scene: THREE.Object3D, targetH: number, faceFix: number): { wrap: THREE.Group; scale: number } {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const s = targetH / h;
  scene.scale.multiplyScalar(s);
  scene.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(scene);
  const c = b2.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= b2.min.y;
  const wrap = new THREE.Group();
  const fix = new THREE.Group();
  fix.rotation.y = faceFix;
  fix.add(scene);
  wrap.add(fix);
  return { wrap, scale: s };
}

function findBone(root: THREE.Object3D, rx: RegExp): THREE.Bone | undefined {
  let out: THREE.Bone | undefined;
  root.traverse((o) => { if (!out && (o as THREE.Bone).isBone && rx.test(o.name)) out = o as THREE.Bone; });
  return out;
}

/** 在 bone 下挂一个抵消归一化缩放的米制锚点。 */
function meterAnchor(bone: THREE.Bone, alignTo: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  bone.updateWorldMatrix(true, false);
  alignTo.updateWorldMatrix(true, false);
  const ws = bone.getWorldScale(new THREE.Vector3());
  g.scale.setScalar(1 / Math.max(1e-6, ws.x));
  const bq = bone.getWorldQuaternion(new THREE.Quaternion());
  const aq = alignTo.getWorldQuaternion(new THREE.Quaternion());
  g.quaternion.copy(bq).invert().multiply(aq);
  bone.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// 守夜人：Hunter Avatar（mixamo 骨骼）。去掉高顶礼帽，程序化兜帽斗篷补剪影。
// ---------------------------------------------------------------------------

const HUNTER_BONES: Record<string, RegExp> = {
  hips: /Hips/, spine: /Spine_/, spine1: /Spine1/, spine2: /Spine2/, neck: /Neck/, head: /Head_/, headTop: /HeadTop/,
  upLegL: /LeftUpLeg/, upLegR: /RightUpLeg/, legL: /LeftLeg_/, legR: /RightLeg_/, footL: /LeftFoot/, footR: /RightFoot/,
  armL: /LeftArm_/, armR: /RightArm_/, foreArmL: /LeftForeArm/, foreArmR: /RightForeArm/, handL: /LeftHand_/, handR: /RightHand_/,
};

function prepHunter(gltf: GLTF): HunterAsset {
  const scene = gltf.scene;
  const { wrap } = normalize(scene, 1.75, Math.PI);
  const bones: Record<string, THREE.Bone> = {};
  for (const [k, rx] of Object.entries(HUNTER_BONES)) {
    const b = findBone(scene, rx);
    if (b) bones[k] = b;
  }
  const mesh = scene.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh | undefined;
  if (mesh && bones.head && bones.headTop) {
    // 礼帽顶点：权重主要在 Head 且高于头顶中段的顶点，向头骨中心塌缩（兜帽会盖住）。
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute;
    const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
    const headJoint = (mesh.skeleton.bones as THREE.Bone[]).indexOf(bones.head);
    mesh.updateMatrixWorld(true);
    const headW = bones.head.getWorldPosition(new THREE.Vector3());
    const topW = bones.headTop.getWorldPosition(new THREE.Vector3());
    const threshW = headW.y + (topW.y - headW.y) * 0.42;
    const headL = mesh.worldToLocal(headW.clone());
    const threshL = mesh.worldToLocal(new THREE.Vector3(headW.x, threshW, headW.z)).y;
    if (headJoint >= 0) {
      for (let i = 0; i < pos.count; i++) {
        let wHead = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === headJoint) wHead += sw.getComponent(i, k);
        if (wHead > 0.4 && pos.getY(i) > threshL) {
          pos.setXYZ(i,
            THREE.MathUtils.lerp(pos.getX(i), headL.x, 0.88),
            THREE.MathUtils.lerp(pos.getY(i), headL.y, 0.88),
            THREE.MathUtils.lerp(pos.getZ(i), headL.z, 0.88));
        }
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  }
  // 材质：压暗偏冷，符合总纲的发黑旧布与皮革。
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true; m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.color.multiplyScalar(0.82);
        mat.roughness = Math.max(mat.roughness, 0.72);
        mat.metalness = Math.min(mat.metalness, 0.15);
      }
    }
  });
  const handAnchor = meterAnchor(bones.handR ?? bones.armR ?? scene, wrap);
  const headAnchor = meterAnchor(bones.head ?? scene, wrap);
  const chestAnchor = meterAnchor(bones.spine2 ?? bones.spine ?? scene, wrap);

  const mixer = new THREE.AnimationMixer(scene);
  const idle = gltf.animations[0] ?? new THREE.AnimationClip('idle', 1, []);
  const { walk, run } = authorLocomotion(bones);
  return { root: wrap, mixer, clips: { idle, walk, run }, bones, handAnchor, headAnchor, chestAnchor };
}

/** 在 mixamo 骨骼上程序化 authored 走/跑循环（四元数关键帧），与 baked Idle 交叉淡入。 */
function authorLocomotion(bones: Record<string, THREE.Bone>): { walk: THREE.AnimationClip; run: THREE.AnimationClip } {
  const make = (name: string, cycle: number, p: {
    legA: number; kneeA: number; armA: number; lean: number; bob: number; twist: number; sway: number;
  }): THREE.AnimationClip => {
    const N = 16;
    const times: number[] = [];
    for (let i = 0; i <= N; i++) times.push((i / N) * cycle);
    const tracks: THREE.KeyframeTrack[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const rest = new THREE.Quaternion();
    const rotTrack = (key: string, fn: (ph: number) => [number, number, number]): void => {
      const b = bones[key];
      if (!b) return;
      rest.copy(b.quaternion);
      const vals: number[] = [];
      for (const t of times) {
        const [x, y, z] = fn((t / cycle) * Math.PI * 2);
        e.set(x, y, z);
        q.setFromEuler(e).premultiply(rest);
        vals.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.uuid}.quaternion`, times, vals));
    };
    const s = Math.sin, c = Math.cos;
    rotTrack('upLegL', (ph) => [p.legA * s(ph), 0, 0.03]);
    rotTrack('upLegR', (ph) => [p.legA * s(ph + Math.PI), 0, -0.03]);
    rotTrack('legL', (ph) => [p.kneeA * Math.max(0, s(ph + 1.1)) + 0.08, 0, 0]);
    rotTrack('legR', (ph) => [p.kneeA * Math.max(0, s(ph + Math.PI + 1.1)) + 0.08, 0, 0]);
    rotTrack('footL', (ph) => [-p.legA * s(ph) * 0.5 - p.kneeA * Math.max(0, s(ph + 1.1)) * 0.4, 0, 0]);
    rotTrack('footR', (ph) => [-p.legA * s(ph + Math.PI) * 0.5 - p.kneeA * Math.max(0, s(ph + Math.PI + 1.1)) * 0.4, 0, 0]);
    rotTrack('armL', (ph) => [-p.armA * s(ph), 0, 0.1]);
    rotTrack('armR', (ph) => [-p.armA * s(ph + Math.PI), 0, -0.1]);
    rotTrack('foreArmL', (ph) => [0.25 + 0.25 * Math.max(0, -s(ph)), 0, 0]);
    rotTrack('foreArmR', (ph) => [0.25 + 0.25 * Math.max(0, -s(ph + Math.PI)), 0, 0]);
    rotTrack('spine', (ph) => [p.lean, p.twist * s(ph), p.sway * s(ph)]);
    rotTrack('spine1', (ph) => [p.lean * 0.5, p.twist * 0.5 * s(ph), 0]);
    rotTrack('head', (ph) => [-p.lean * 0.6, -p.twist * 0.6 * s(ph), 0]);
    const hips = bones.hips;
    if (hips) {
      const base = hips.position.clone();
      const vals: number[] = [];
      for (const t of times) {
        const ph = (t / cycle) * Math.PI * 2;
        vals.push(base.x + p.sway * 0.4 * s(ph), base.y - p.bob * Math.abs(c(ph)), base.z);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${hips.uuid}.position`, times, vals));
    }
    return new THREE.AnimationClip(name, cycle, tracks);
  };
  // 走：1.0s 周期 ≈ 1.8m 步幅（匹配 PLAYER.walkSpeed）；跑：0.62s ≈ 1.9m（匹配 sprintSpeed）。
  const walk = make('walk', 1.0, { legA: 0.55, kneeA: 0.95, armA: 0.4, lean: 0.07, bob: 0.035, twist: 0.07, sway: 0.04 });
  const run = make('run', 0.62, { legA: 0.9, kneeA: 1.35, armA: 0.7, lean: 0.24, bob: 0.06, twist: 0.1, sway: 0.05 });
  return { walk, run };
}

// ---------------------------------------------------------------------------
// 着色器：灰影破布（飘动 + 溶解 + 菲涅尔）与黑影烟雾躯体。
// ---------------------------------------------------------------------------

export interface ClothUniforms {
  uTime: { value: number };
  uLean: { value: number };
  uArmRaise: { value: number };
  uDissolve: { value: number };
  uFlutter: { value: number };
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
  uHeight: { value: number };
  uOpacity: { value: number };
}

const NOISE_GLSL = /* glsl */`
float awHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float awNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(awHash(i), awHash(i + vec3(1, 0, 0)), f.x), mix(awHash(i + vec3(0, 1, 0)), awHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(awHash(i + vec3(0, 0, 1)), awHash(i + vec3(1, 0, 1)), f.x), mix(awHash(i + vec3(0, 1, 1)), awHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

/** 灰影长袍：顶点布料飘动 + 前倾剪切 + 举臂预备动作；片元噪声溶解与冷灰菲涅尔。 */
export function ghostCloth(mat: THREE.MeshStandardMaterial, localHeight: number): ClothUniforms {
  const u: ClothUniforms = {
    uTime: { value: 0 }, uLean: { value: 0 }, uArmRaise: { value: 0 }, uDissolve: { value: 0 },
    uFlutter: { value: 0.022 }, uRim: { value: 0.5 }, uRimColor: { value: new THREE.Color(0x9fb0c0) },
    uHeight: { value: localHeight }, uOpacity: { value: 1 },
  };
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uLean, uArmRaise, uFlutter, uHeight;\nvarying vec3 vLocal;\n${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vLocal = position;
        float hh = clamp(transformed.y / uHeight, 0.0, 1.5);
        transformed.z -= uLean * hh * hh * uHeight * 0.55;
        float armW = smoothstep(0.10 * uHeight, 0.28 * uHeight, transformed.x) * smoothstep(0.5 * uHeight, 0.62 * uHeight, transformed.y);
        float ca = cos(uArmRaise), sa = sin(uArmRaise);
        vec2 rel = vec2(transformed.x - 0.1 * uHeight, transformed.y - 0.66 * uHeight);
        vec2 rot = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
        transformed.xy = mix(transformed.xy, rot + vec2(0.1 * uHeight, 0.66 * uHeight), armW);
        float fl = (1.0 - hh) * (1.0 - hh);
        transformed.x += sin(uTime * 2.3 + transformed.y * 4.0 + transformed.z * 2.0) * uFlutter * fl * uHeight;
        transformed.z += cos(uTime * 1.7 + transformed.x * 3.0) * uFlutter * fl * uHeight * 0.7;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uDissolve, uRim, uOpacity, uHeight;\nuniform vec3 uRimColor;\nvarying vec3 vLocal;\n${NOISE_GLSL}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
        totalEmissiveRadiance += uRimColor * rimF * uRim;
        float dn = awNoise(vLocal * 2.6 + vec3(0.0, uTime * 0.25, 0.0));
        float field = clamp(vLocal.y / uHeight * 0.72 + dn * 0.38, 0.0, 1.0);
        float th = uDissolve * 1.15 + 0.07;
        if (field < th - 0.12) discard;
        totalEmissiveRadiance += uRimColor * 1.6 * smoothstep(th, th - 0.12, field) * step(0.001, uDissolve);
        diffuseColor.a *= uOpacity;`);
  };
  mat.customProgramCacheKey = () => 'ghostCloth';
  return u;
}

export interface WraithUniforms {
  uTime: { value: number };
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
  uOpacity: { value: number };
  uErode: { value: number };
}

/** 黑影：炭黑烟雾躯体——去饱和 + 噪声侵蚀 alpha + 多层菲涅尔冷灰边缘。 */
export function wraithSkin(mat: THREE.MeshStandardMaterial): WraithUniforms {
  const u: WraithUniforms = {
    uTime: { value: 0 }, uRim: { value: 0.85 }, uRimColor: { value: new THREE.Color(0x8d9aa8) },
    uOpacity: { value: 0.95 }, uErode: { value: 0.22 },
  };
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vWpos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;\nvWpos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uRim, uOpacity, uErode;\nuniform vec3 uRimColor;\nvarying vec3 vLocal;\nvarying vec3 vWpos;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float lum = dot(diffuseColor.rgb, vec3(0.3333));
        diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.22) * vec3(0.42, 0.46, 0.52) + vec3(0.045, 0.055, 0.075);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float ndv = saturate(dot(normalize(vViewPosition), normal));
        float rimF = pow(1.0 - ndv, 2.0);
        float rim2 = pow(1.0 - ndv, 4.5);
        totalEmissiveRadiance += uRimColor * (rimF * 0.55 + rim2 * 0.9) * uRim;
        float n = awNoise(vWpos * 2.2 + vec3(0.0, uTime * 0.5, uTime * 0.13));
        float n2 = awNoise(vWpos * 6.5 - vec3(uTime * 0.3, 0.0, 0.0));
        float body = 0.78 + 0.22 * n;
        diffuseColor.a *= uOpacity * body * (0.75 + 0.25 * n2);
        diffuseColor.a *= 1.0 - uErode * 0.6 * rimF * (1.0 - n2);`);
  };
  mat.customProgramCacheKey = () => 'wraithSkin';
  return u;
}

// ---------------------------------------------------------------------------
// 灰影 / 黑影基础模型。
// ---------------------------------------------------------------------------

function prepReaper(gltf: GLTF): ReaperAsset {
  const scene = gltf.scene;
  // 镰刀不是鬼的一部分：按节点名隐藏。
  scene.traverse((o) => { if (/scythe/i.test(o.name)) o.visible = false; });
  const { wrap } = normalize(scene, 2.15, Math.PI / 2);
  let body: THREE.Mesh | undefined;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && /body/i.test(o.parent?.name ?? '')) body = m;
  });
  if (!body) scene.traverse((o) => { const m = o as THREE.Mesh; if (!body && m.isMesh && m.visible) body = m; });
  const b = body!;
  b.castShadow = true;
  b.frustumCulled = false;
  const geo = b.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const localHeight = bb.max.y - bb.min.y;
  const src = b.material as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshStandardMaterial({
    map: src.map ?? null, normalMap: src.normalMap ?? null,
    color: 0x63686e, roughness: 0.95, metalness: 0,
    emissive: 0x39424c, emissiveIntensity: 0.1,
  });
  b.material = mat;
  const cloth = ghostCloth(mat, localHeight);
  return { root: wrap, body: b, localHeight, cloth };
}

function prepCreature(gltf: GLTF): CreatureAsset {
  const scene = gltf.scene;
  const { wrap } = normalize(scene, 1.85, Math.PI);
  let mesh: THREE.SkinnedMesh | undefined;
  scene.traverse((o) => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  const m = mesh!;
  m.castShadow = true;
  m.frustumCulled = false;
  const src = m.material as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshStandardMaterial({
    map: src.map ?? null, normalMap: src.normalMap ?? null,
    color: 0xffffff, roughness: 0.9, metalness: 0,
    emissive: 0x2a3440, emissiveIntensity: 0.7,
  });
  m.material = mat;
  const skin = wraithSkin(mat);
  const spine: THREE.Bone[] = [];
  const bones: Record<string, THREE.Bone> = {};
  const rx: Record<string, RegExp> = { armL: /LeftArm_/, armR: /RightArm_/, foreArmL: /LeftForeArm/, foreArmR: /RightForeArm/, upLegL: /LeftUpLeg/, upLegR: /RightUpLeg/ };
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    if (/mixamorig:Spine/.test(o.name)) spine.push(o as THREE.Bone);
    for (const [k, r] of Object.entries(rx)) if (!bones[k] && r.test(o.name)) bones[k] = o as THREE.Bone;
  });
  const mixer = new THREE.AnimationMixer(scene);
  return { root: wrap, mesh: m, mixer, idle: gltf.animations[0] ?? null, spine, bones, skin };
}

/** 并行加载三个模型；任一失败返回 null（调用方回退程序化模型）。单例：多处调用共享同一次加载。 */
let pending: Promise<CharacterAssets | null> | null = null;
export function loadCharacterAssets(): Promise<CharacterAssets | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const [h, r, c] = await Promise.all([loadGLB(URLS.hunter), loadGLB(URLS.reaper), loadGLB(URLS.creature)]);
        return { hunter: prepHunter(h), reaper: prepReaper(r), creature: prepCreature(c) };
      } catch (e) {
        console.warn('[characters] asset load failed, using procedural fallback', e);
        return null;
      }
    })();
  }
  return pending;
}