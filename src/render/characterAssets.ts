// 角色外部资产（art pass 3）：Objaverse CC-BY 模型的加载、归一化与着色器改造。
// 守夜人 / 灰影各自独立加载，任一失败只影响该角色（回退程序化模型），游戏离线仍可运行。
// 黑影为全程序化破布四足体（characters.ts 的 RagWraith），不再依赖外部模型。
// 模型与贴图来源、许可见 public/models/characters/CREDITS.md。
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
  /** 挂在胸椎 bone 上的米制锚点（斗篷/披肩/腰带用）。 */
  chestAnchor: THREE.Group;
}

export interface ReaperAsset {
  root: THREE.Group;
  body: THREE.Mesh;
  /** 网格局部空间的身高（着色器用）。 */
  localHeight: number;
  cloth: ClothUniforms;
}

export interface CharacterAssets { hunter: HunterAsset | null; reaper: ReaperAsset | null }

const URLS = { hunter: 'models/characters/hunter.glb', reaper: 'models/characters/reaper.glb' };

function loadGLB(url: string): Promise<GLTF> {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
}

// ---------------------------------------------------------------------------
// 角色布料 / 皮革贴图（ambientCG CC0）：加载失败回退画布织纹，离线可用。
// ---------------------------------------------------------------------------

export interface CharTex { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }
export interface CharTextures { fabric: CharTex; leather: CharTex }

function fallbackWeave(base: string, line: string): CharTex {
  const S = 128;
  const mk = (draw: (g: CanvasRenderingContext2D) => void, srgb: boolean): THREE.CanvasTexture => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d')!;
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  const map = mk((g) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    g.strokeStyle = line; g.lineWidth = 1;
    for (let i = 0; i < S; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  }, true);
  const normalMap = mk((g) => {
    g.fillStyle = '#8080ff'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(120,120,255,0.7)';
    for (let i = 0; i < S; i += 4) { g.fillRect(i, 0, 1, S); g.fillRect(0, i, S, 1); }
  }, false);
  const roughnessMap = mk((g) => { g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, S, S); }, false);
  return { map, normalMap, roughnessMap };
}

function loadTexSet(prefix: string, fallback: CharTex): Promise<CharTex> {
  const loader = new THREE.TextureLoader();
  const one = (file: string, srgb: boolean): Promise<THREE.Texture> =>
    new Promise((res) => loader.load(`models/characters/${prefix}_${file}.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      res(t);
    }, undefined, () => res(null as unknown as THREE.Texture)));
  return Promise.all([one('color', true), one('normal', false), one('rough', false)]).then(([map, normalMap, roughnessMap]) =>
    map && normalMap && roughnessMap ? { map, normalMap, roughnessMap } : fallback);
}

let texPending: Promise<CharTextures> | null = null;
export function loadCharTextures(): Promise<CharTextures> {
  if (!texPending) {
    texPending = Promise.all([
      loadTexSet('fabric', fallbackWeave('#9a958c', 'rgba(60,56,50,0.35)')),
      loadTexSet('leather', fallbackWeave('#8a7a66', 'rgba(40,32,24,0.4)')),
    ]).then(([fabric, leather]) => ({ fabric, leather }));
  }
  return texPending;
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

/** 在 bone 下挂一个抵消归一化缩放的米制锚点（锚点本地轴 = 世界轴：+Y 上、-Z 前）。 */
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

/** 原贴图去饱和 + 暖褐压暗：覆盖过亮/过花的部分，归一到圣经皮革/旧布。 */
function hunterNormalize(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
      float hLum = dot(diffuseColor.rgb, vec3(0.3333));
      diffuseColor.rgb = mix(vec3(hLum), diffuseColor.rgb, 0.2) * vec3(0.6, 0.54, 0.47);`);
  };
  mat.customProgramCacheKey = () => 'hunterNormalize';
}

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
    // 头部圆柱区域（礼帽帽冠/帽檐 + 立领）整体塌缩到头骨中心，由兜帽与披肩遮盖，
    // 避免后脑残留薄片（白天室内近景曾出现"黑球加翘片"）。
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute;
    const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
    const headJoint = (mesh.skeleton.bones as THREE.Bone[]).indexOf(bones.head);
    const topJoint = (mesh.skeleton.bones as THREE.Bone[]).indexOf(bones.headTop);
    mesh.updateMatrixWorld(true);
    const headW = bones.head.getWorldPosition(new THREE.Vector3());
    const topW = bones.headTop.getWorldPosition(new THREE.Vector3());
    const headL = mesh.worldToLocal(headW.clone());
    const topL = mesh.worldToLocal(topW.clone());
    const range = Math.max(1e-4, topL.y - headL.y);
    // 仅温和塌缩礼帽帽冠（Head 权重高且高于颅顶中段），保留头部体积与蒙皮权重，
    // 由加大的兜帽罩住头骨与立领，避免后脑翘片。不做整柱收拢（会拉出尖锥）。
    if (headJoint >= 0) {
      const crownL = headL.y + range * 0.25;
      for (let i = 0; i < pos.count; i++) {
        let wHead = 0;
        for (let k = 0; k < 4; k++) {
          const j = si.getComponent(i, k);
          if (j === headJoint || j === topJoint) wHead += sw.getComponent(i, k);
        }
        if (wHead > 0.5 && pos.getY(i) > crownL) {
          pos.setXYZ(i,
            THREE.MathUtils.lerp(pos.getX(i), headL.x, 0.9),
            THREE.MathUtils.lerp(pos.getY(i), headL.y + range * 0.1, 0.9),
            THREE.MathUtils.lerp(pos.getZ(i), headL.z, 0.9));
        }
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  }
  // 材质：压暗偏暖褐、去饱和，粗糙度拉到旧布/皮革区间（圣经 §4.5 / §5）。
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true; m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.color.multiplyScalar(0.62);
        mat.roughness = Math.max(mat.roughness, 0.85);
        mat.metalness = Math.min(mat.metalness, 0.1);
        hunterNormalize(mat);
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
// 着色器：灰影破布（飘动 + 溶解 + 菲涅尔）与附加布条层。
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

const DESAT_GLSL = /* glsl */`
float gLum = dot(diffuseColor.rgb, vec3(0.3333));
diffuseColor.rgb = mix(vec3(gLum), diffuseColor.rgb, 0.3);`;

/** 灰影长袍：顶点布料飘动 + 前倾剪切 + 举臂预备动作；片元噪声溶解与冷灰菲涅尔。 */
export function ghostCloth(mat: THREE.MeshStandardMaterial, localHeight: number): ClothUniforms {
  const u: ClothUniforms = {
    uTime: { value: 0 }, uLean: { value: 0.3 }, uArmRaise: { value: 0 }, uDissolve: { value: 0 },
    uFlutter: { value: 0.022 }, uRim: { value: 0.22 }, uRimColor: { value: new THREE.Color(0x9fb4c8) },
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
        transformed.z += uLean * hh * hh * uHeight * 0.55;
        float armW = smoothstep(0.16 * uHeight, 0.30 * uHeight, transformed.z)
          * smoothstep(0.66 * uHeight, 0.72 * uHeight, transformed.y)
          * (1.0 - smoothstep(0.84 * uHeight, 0.88 * uHeight, transformed.y));
        float ca = cos(uArmRaise), sa = sin(uArmRaise);
        vec2 rel = vec2(transformed.z - 0.1 * uHeight, transformed.y - 0.78 * uHeight);
        vec2 rot = vec2(rel.x * ca + rel.y * sa, -rel.x * sa + rel.y * ca);
        transformed.zy = mix(transformed.zy, rot + vec2(0.1 * uHeight, 0.78 * uHeight), armW);
        float fl = (1.0 - hh) * (1.0 - hh);
        transformed.x += sin(uTime * 2.3 + transformed.y * 4.0 + transformed.z * 2.0) * uFlutter * fl * uHeight;
        transformed.z += cos(uTime * 1.7 + transformed.x * 3.0) * uFlutter * fl * uHeight * 0.7;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uDissolve, uRim, uOpacity, uHeight;\nuniform vec3 uRimColor;\nvarying vec3 vLocal;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${DESAT_GLSL}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.6);
        totalEmissiveRadiance += uRimColor * rimF * uRim;
        float dn = awNoise(vLocal * 2.6 + vec3(0.0, uTime * 0.25, 0.0));
        float field = clamp(vLocal.y / uHeight * 0.72 + dn * 0.38, 0.0, 1.0);
        float th = uDissolve * 1.15 + 0.07;
        if (field < th - 0.12) discard;
        totalEmissiveRadiance += uRimColor * 1.2 * smoothstep(th, th - 0.12, field) * step(0.001, uDissolve);
        // 常态边缘侵蚀 + 下摆破洞：破布而非实心雕像
        float en = awNoise(vLocal * 7.0 - vec3(uTime * 0.2, 0.0, 0.0));
        diffuseColor.a *= 1.0 - 0.3 * rimF * (1.0 - en);
        float hemH = 1.0 - smoothstep(0.0, 0.3 * uHeight, vLocal.y);
        if (hemH > 0.4 && en < (hemH - 0.4) * 0.7) discard;
        diffuseColor.a *= uOpacity;`);
  };
  mat.customProgramCacheKey = () => 'ghostCloth';
  return u;
}

/** 灰影附加布条层：与主体共享动画 uniform；aHang=0 在挂点、1 在条尖，飘动随悬挂长度增大。 */
export function ghostRags(mat: THREE.MeshStandardMaterial, height: number, shared: ClothUniforms): void {
  const u = { ...shared, uHeight: { value: height } };
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  mat.vertexColors = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uLean, uFlutter, uHeight;\nattribute float aHang;\nvarying vec3 vLocal;\nvarying float vHang;\n${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vLocal = position; vHang = aHang;
        float hh = clamp(transformed.y / uHeight, 0.0, 1.5);
        transformed.z += uLean * hh * hh * uHeight * 0.55;
        float hang = aHang * aHang;
        transformed.x += sin(uTime * 2.6 + position.y * 5.0 + position.z * 3.0) * uFlutter * 2.2 * hang * uHeight;
        transformed.z += cos(uTime * 1.9 + position.x * 4.0) * uFlutter * 1.6 * hang * uHeight;
        transformed.y -= hang * uFlutter * 0.4 * uHeight * (0.5 + 0.5 * sin(uTime * 1.3 + position.x * 6.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uDissolve, uRim, uOpacity, uHeight;\nuniform vec3 uRimColor;\nvarying vec3 vLocal;\nvarying float vHang;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${DESAT_GLSL}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
        totalEmissiveRadiance += uRimColor * rimF * uRim * 0.8;
        float dn = awNoise(vLocal * 3.1 + vec3(0.0, uTime * 0.25, 0.0));
        float field = clamp(vLocal.y / uHeight * 0.72 + dn * 0.38, 0.0, 1.0);
        float th = uDissolve * 1.15 + 0.07;
        if (field < th - 0.12) discard;
        // 布条尖端被侵蚀出破洞
        float tear = awNoise(vLocal * 9.0 + vec3(uTime * 0.1, 0.0, 0.0));
        if (vHang > 0.55 && tear < (vHang - 0.55) * 0.9) discard;
        diffuseColor.a *= uOpacity * (1.0 - vHang * 0.25);`);
  };
  mat.customProgramCacheKey = () => 'ghostRags';
}

// ---------------------------------------------------------------------------
// 灰影基础模型。
// ---------------------------------------------------------------------------

function prepReaper(gltf: GLTF): ReaperAsset {
  const scene = gltf.scene;
  // 镰刀不是鬼的一部分：按节点名隐藏。
  scene.traverse((o) => { if (/scythe/i.test(o.name)) o.visible = false; });
  const { wrap } = normalize(scene, 2.15, Math.PI);
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
  // 圣经 §4.5：灰白破布 #8d8b86 → #5a5955，内部虚空靠兜帽暗腔；不自发光，靠月光 rim。
  const mat = new THREE.MeshStandardMaterial({
    map: src.map ?? null, normalMap: src.normalMap ?? null,
    color: 0x4a4843, roughness: 0.97, metalness: 0,
  });
  // 实例差异（圣经 §5.2）：每只灰影轻微色值/粗糙度抖动，避免复制感。
  mat.color.multiplyScalar(0.92 + Math.random() * 0.16);
  mat.roughness = Math.min(1, 0.94 + Math.random() * 0.06);
  b.material = mat;
  const cloth = ghostCloth(mat, localHeight);
  return { root: wrap, body: b, localHeight, cloth };
}

/** 并行加载两个模型；各自失败只影响自己（调用方回退程序化模型）。单例：多处调用共享同一次加载。 */
let pending: Promise<CharacterAssets> | null = null;
export function loadCharacterAssets(): Promise<CharacterAssets> {
  if (!pending) {
    pending = (async () => {
      const [h, r] = await Promise.all([
        loadGLB(URLS.hunter).then(prepHunter).catch((e) => { console.warn('[characters] hunter load failed, procedural fallback', e); return null; }),
        loadGLB(URLS.reaper).then(prepReaper).catch((e) => { console.warn('[characters] reaper load failed, procedural fallback', e); return null; }),
      ]);
      return { hunter: h, reaper: r };
    })();
  }
  return pending;
}