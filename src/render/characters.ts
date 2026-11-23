// 角色模型（CHR-01…03）与动画（ANM-01、02、04）：守夜人、灰影、黑影。
// art pass 3：守夜人 = Objaverse CC-BY 骨骼模型 + 程序化兜帽/披肩/及膝斗篷/皮革腰带（圣经 §9）；
// 灰影 = 破袍 Reaper + 附加布条层与兜帽暗腔；黑影 = 全程序化四足破布体 RagWraith（concept/05）。
// 模型根节点以米为单位，原点在脚下地面，面朝本地 -Z。双鬼靠剪影 + 月光菲涅尔边缘识别，不自发光。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GHOST, PLAYER } from '../config';
import { groundY, inArea, STAIR_MASS, supportY } from '../sim/level';

/** 跨层贴地：优先用实体自身连续高度 y（B1/2F），回退到只看 x/z 的 groundY。 */
type Grounded = { x: number; z: number; y?: number };
const gy = (p: Grounded): number => p.y ?? groundY(p.x, p.z);
import { cameraClearT } from '../sim/collision';
import { GhostState, World } from '../sim/state';
import { CharTextures, HunterAsset, ReaperAsset, ghostRags, loadCharacterAssets, loadCharTextures, shieldWatchmanLamp } from './characterAssets';
import { cyl, lerp, mesh, yawToRot } from './geom';
import { Materials, glowTexture, smokeTexture } from './materials';
import { makeClapper, makeLantern } from './props';
import { SoftParticles } from './vfx';
import { WatchmanPace } from './locomotion';
import { LimbSolver } from './locomotionRig';

type Lantern = ReturnType<typeof makeLantern>;

/** 给 Standard 材质注入菲涅尔边缘自发光：视角掠射处发亮，暗处也能辨出轮廓与朝向。 */
function rim(mat: THREE.MeshStandardMaterial, color: number, strength: number, power = 2.6): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), uRimPower);\ntotalEmissiveRadiance += uRimColor * rimF * uRimStrength;');
  };
  mat.customProgramCacheKey = () => 'rim';
  return mat;
}

function limb(mat: THREE.Material, r: number, len: number): { pivot: THREE.Group; part: THREE.Mesh } {
  const pivot = new THREE.Group();
  const part = cyl(mat, r, r * 0.85, len, 8);
  part.position.y = -len / 2;
  pivot.add(part);
  return { pivot, part };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 破布条几何：顶边在挂点（y=0），向下撕裂；aHang 0→1，顶点色做灰阶层次。
// ---------------------------------------------------------------------------

function ragGeo(w: number, len: number, seed: number, shade: number, taper = 0.4): THREE.BufferGeometry {
  const segs = 8;
  const g = new THREE.PlaneGeometry(w, len, 3, segs);
  g.translate(0, -len / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const hang = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  const r = rng(seed * 7919 + 13);
  const bend = (r() - 0.5) * 0.7;
  const twist = (r() - 0.5) * 2.2;
  const curlAmp = 0.18 + r() * 0.24;
  const curl2 = 0.06 + r() * 0.1;
  const phase = r() * Math.PI * 2;
  const flare = r() < 0.3 ? 1.25 : 1.0; // 部分布条末端散开
  const rowW: number[] = [];
  const sideTearL: number[] = [];
  const sideTearR: number[] = [];
  for (let row = 0; row <= segs; row++) {
    const tt = row / segs;
    rowW.push((1 - (1 - taper) * tt + (r() - 0.5) * 0.34) * (1 + (flare - 1) * tt * tt));
    sideTearL.push(r() * 0.3);
    sideTearR.push(r() * 0.3);
  }
  const tipNotch = [r() * 0.3, r() * 0.42, r() * 0.3, r() * 0.38];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, -pos.getY(i) / len);
    const row = Math.round(t * segs);
    const colIdx = i % 4;
    let x = pos.getX(i) * rowW[row];
    // 侧缘撕裂：边缘列按行随机内收
    if (colIdx === 0) x += sideTearL[row] * w * 0.5 * t;
    if (colIdx === 3) x -= sideTearR[row] * w * 0.5 * t;
    // 卷曲 + 下垂：S 形卷 + 高频皱 + 重力前坠
    let z = Math.sin(t * Math.PI * 1.5 + phase) * curlAmp * len * t
      + Math.sin(t * Math.PI * 4.0 + phase * 2.0) * curl2 * len * t
      + bend * len * t * t;
    const tw = twist * t;
    const nx = x * Math.cos(tw);
    z += x * Math.sin(tw);
    x = nx;
    let y = pos.getY(i) - t * t * len * 0.12; // 末端下垂
    if (row >= segs - 1) y -= tipNotch[colIdx] * len;
    pos.setXYZ(i, x, y, z);
    hang[i] = t;
    const c = shade * (1 - t * 0.32);
    col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c;
  }
  g.setAttribute('aHang', new THREE.BufferAttribute(hang, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** 给实体几何补上布条着色器需要的 aHang/color 属性，使其能与布条合并、共享侵蚀材质。 */
function solidRagAttrs(g: THREE.BufferGeometry, shade: number): THREE.BufferGeometry {
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  const hang = new Float32Array(n);
  const col = new Float32Array(n * 3).fill(shade);
  g.setAttribute('aHang', new THREE.BufferAttribute(hang, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** 把布条摆到 (x,y,z) 并旋转（布条默认向下垂）。 */
function placeRag(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

function mergeRags(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(list, false)!;
  for (const g of list) g.dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// 守夜人兜帽 / 披肩 / 斗篷 / 腰带（圣经 §4.5：暗褐深灰布 #2f2a26、皮革 #4a3a2c）。
// 锚点本地轴：+Y 上、-Z 前。
// ---------------------------------------------------------------------------

function buildHood(cloakMat: THREE.Material, voidMat: THREE.Material): THREE.Group {
  const hood = new THREE.Group();
  // 兜帽主壳：饱满穹顶 + 径向褶皱与后中缝，开口朝前下；尺寸略大以罩住头部附件。
  const shellGeo = new THREE.SphereGeometry(0.2, 28, 18, 0, Math.PI * 2, 0, 2.35);
  const sp = shellGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const ang = Math.atan2(x, z);
    const theta = Math.acos(Math.min(1, Math.max(-1, y / 0.2)));
    const fold = 1 + 0.13 * Math.sin(ang * 6 + theta * 2.5) * (0.3 + theta / 2.35)
      + 0.05 * Math.sin(ang * 13 + 1.7)
      + 0.06 * Math.exp(-Math.pow(ang / 0.4, 2)) * (theta / 2.35);
    sp.setX(i, x * fold); sp.setZ(i, z * fold);
  }
  shellGeo.computeVertexNormals();
  const shell = mesh(shellGeo, cloakMat);
  shell.scale.set(1.08, 1.55, 1.45);
  shell.rotation.x = 0.46;
  shell.position.set(0, 0.03, 0.06);
  // 颈侧垂布（前开口）
  const cowl = mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.2, 18, 1, true, -2.35, 4.7), cloakMat);
  cowl.position.set(0, -0.07, 0.03);
  cowl.rotation.x = 0.12;
  // 帽檐弧：框住脸部开口
  const brow = mesh(new THREE.TorusGeometry(0.15, 0.026, 6, 16, Math.PI * 1.25), cloakMat);
  brow.rotation.z = -Math.PI * 0.125;
  brow.rotation.x = -0.46;
  brow.position.set(0, 0.06, -0.15);
  // 脸部虚空
  const voidFace = mesh(new THREE.SphereGeometry(0.125, 12, 9), voidMat, false);
  voidFace.scale.set(0.95, 1.15, 0.9);
  voidFace.position.set(0, 0.04, -0.075);
  hood.add(shell, cowl, brow, voidFace);
  return hood;
}

/** 角色风化噪声（圣经 §5.2）：局部遮罩用，不做满铺均匀脏。 */
const CLOTH_NOISE = /* glsl */`
float cwHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cwNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cwHash(i), cwHash(i + vec3(1, 0, 0)), f.x), mix(cwHash(i + vec3(0, 1, 0)), cwHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(cwHash(i + vec3(0, 0, 1)), cwHash(i + vec3(1, 0, 1)), f.x), mix(cwHash(i + vec3(0, 1, 1)), cwHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

function makeCloakOutfit(tex: CharTextures | null, lamp: HunterAsset['lampSource'], flutter: CloakFlutter): {
  hood: THREE.Group; mantle: THREE.Group; cloakPivot: THREE.Group; belt: THREE.Group; cloakMat: THREE.MeshStandardMaterial;
} {
  const fabric = tex?.fabric;
  const leather = tex?.leather;
  // 织物贴图为中灰扫描，color 提亮补偿，使有效反照率落在圣经 #2f2a26。
  const cloakMat = new THREE.MeshStandardMaterial({
    color: 0x8a8074, roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
    map: fabric?.map ?? null, normalMap: fabric?.normalMap ?? null, roughnessMap: fabric?.roughnessMap ?? null,
    normalScale: new THREE.Vector2(0.48, 0.48),
  });
  if (fabric) { fabric.map.repeat.set(2.5, 2.5); fabric.normalMap.repeat.set(2.5, 2.5); fabric.roughnessMap.repeat.set(2.5, 2.5); }
  cloakMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, flutter);
    shieldWatchmanLamp(sh, lamp);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway;\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vPos = position;
        float hem = 1.0 - smoothstep(-0.45, 0.1, position.y);
        transformed.x += sin(uTime * 3.1 + position.y * 6.0 + position.z * 3.0) * 0.022 * (0.3 + uSway) * hem;
        transformed.z += cos(uTime * 2.4 + position.x * 5.0) * 0.018 * (0.3 + uSway) * hem;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPos;\n${CLOTH_NOISE}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        float wn = cwNoise(vPos * 8.0);
        float wn2 = cwNoise(vPos * 22.0 + 3.1);
        // 宏观色差（圣经 §5.1）：轻微明度斑驳，增加明暗层次但不改色相、不满铺
        diffuseColor.rgb *= 0.66 + 0.68 * cwNoise(vPos * 5.0 + 1.3);
        diffuseColor.rgb *= 0.8 + 0.4 * cwNoise(vPos * 13.0 + 5.7);
        // 下摆泥渍（水造成，沿重力向上渐淡）：泥 #2b2620，局部噪声遮罩不满铺
        float mudH = 1.0 - smoothstep(-0.46, -0.12, vPos.y);
        float mud = mudH * smoothstep(0.35, 0.72, wn);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.023, 0.019, 0.014), mud * 0.7);
        // 肩背磨亮（人用出来）：只降 roughness，不改色相
        float wear = smoothstep(0.12, 0.34, vPos.y) * smoothstep(0.4, 0.78, wn2);
        roughnessFactor = clamp(roughnessFactor * (1.0 - 0.2 * wear), 0.84, 1.0);
        // 下摆破边磨损露暖褐
        float fray = mudH * smoothstep(0.62, 0.9, wn2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.08), fray * 0.4);`);
  };
  cloakMat.customProgramCacheKey = () => 'cloakWeather';
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0,
    map: leather?.map ?? null, normalMap: leather?.normalMap ?? null, roughnessMap: leather?.roughnessMap ?? null,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  // 皮革扫描偏黑：提亮并暖化到圣经皮革 #4a3a2c；常摸处磨亮（只降 roughness）。
  leatherMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPos;\n${CLOTH_NOISE}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        diffuseColor.rgb *= vec3(6.0, 4.8, 3.2);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 - 0.35 * smoothstep(0.5, 0.85, cwNoise(vPos * 16.0));`);
  };
  leatherMat.customProgramCacheKey = () => 'leatherWeather';
  const voidMat = new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 1 });
  // 铁扣：边缘/凹处锈斑 #5a3a24（时间与遗弃），凸起磨亮。
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6, metalness: 1 });
  ironMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPos;\n${CLOTH_NOISE}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float rn = cwNoise(vPos * 34.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.045, 0.018), smoothstep(0.55, 0.82, rn) * 0.6);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.4, smoothstep(0.6, 0.9, cwNoise(vPos * 20.0 + 7.0)) * 0.5);`);
  };
  ironMat.customProgramCacheKey = () => 'ironWeather';

  const hood = buildHood(cloakMat, voidMat);

  // 肩部披肩：短斗篷层 + 皮革领口，下摆撕边
  const mantlePts = [[0.12, 0.14], [0.18, 0.07], [0.25, -0.02], [0.29, -0.11], [0.3, -0.18], [0.285, -0.22]].map(([r, y]) => new THREE.Vector2(r, y));
  const mantleGeo = new THREE.LatheGeometry(mantlePts, 32);
  const mp = mantleGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    const ang = Math.atan2(mp.getX(i), mp.getZ(i));
    const f = 1 + Math.sin(ang * 6) * 0.035 * (0.14 - y);
    mp.setX(i, mp.getX(i) * f); mp.setZ(i, mp.getZ(i) * f);
    if (y < -0.15) {
      mp.setY(i, y - Math.abs(Math.sin(ang * 7 + 0.4)) * 0.05 - 0.018);
    }
  }
  mantleGeo.computeVertexNormals();
  const mantle = new THREE.Group();
  mantle.add(mesh(mantleGeo, cloakMat));
  const collar = mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 16), leatherMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.13;
  mantle.add(collar);
  mantle.position.set(0, 0.02, 0);

  // 及膝斗篷：背面披挂，纵向褶皱 + 破边下摆 + 后摆更长
  const cloakGeo = new THREE.CylinderGeometry(0.18, 0.32, 0.78, 32, 9, true, -1.54, 3.08);
  const cp = cloakGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const ang = Math.atan2(x, z);
    const down = (0.39 - y) / 0.78;
    const fold = 1 + Math.sin(ang * 6) * 0.12 * (0.3 + down) + Math.sin(ang * 13 + 1.2) * 0.045 * down + Math.sin(ang * 3 + 0.5) * 0.04 * down;
    cp.setX(i, x * fold); cp.setZ(i, z * fold + down * (0.08 + 0.14 * Math.abs(Math.sin(ang))));
    if (y < -0.26) {
      const tear = Math.abs(Math.sin(ang * 9 + 0.7)) * 0.09 + Math.abs(Math.sin(ang * 23 + 2.1)) * 0.045;
      cp.setY(i, y - tear * (0.4 + down) - Math.cos(ang) * 0.06 * down);
    }
  }
  cloakGeo.computeVertexNormals();
  const cloakPivot = new THREE.Group();
  const cape = mesh(cloakGeo, cloakMat);
  cape.position.y = -0.39;
  cloakPivot.add(cape);
  const cloakCollar = mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 16), cloakMat);
  cloakCollar.rotation.x = Math.PI / 2;
  cloakCollar.position.y = -0.37;
  cloakPivot.add(cloakCollar);
  cloakPivot.position.set(0, 0.10, 0.055);

  // 皮革腰带 + 铁扣 + 皮囊 + 斜挎带
  const belt = new THREE.Group();
  const band = cyl(leatherMat, 0.172, 0.172, 0.075, 16);
  band.position.y = -0.4;
  const buckle = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.025), ironMat);
  buckle.position.set(0, -0.4, -0.172);
  const pouch1 = mesh(new THREE.BoxGeometry(0.085, 0.1, 0.055), leatherMat);
  pouch1.position.set(0.14, -0.45, -0.09);
  const pouch2 = mesh(new THREE.BoxGeometry(0.07, 0.085, 0.05), leatherMat);
  pouch2.position.set(-0.145, -0.44, -0.08);
  const strap = mesh(new THREE.BoxGeometry(0.055, 0.5, 0.018), leatherMat);
  strap.position.set(0.02, -0.1, -0.155);
  strap.rotation.z = 0.45;
  belt.add(band, buckle, pouch1, pouch2, strap);

  return { hood, mantle, cloakPivot, belt, cloakMat };
}

// ---------------------------------------------------------------------------
// 程序化回退守夜人（离线/加载失败时启用）。
// ---------------------------------------------------------------------------

class ProceduralPlayer {
  readonly group = new THREE.Group();
  private legL: THREE.Group; private legR: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private body = new THREE.Group();
  private lantern: Lantern;
  private clapper: THREE.Group;
  private cloak: THREE.Mesh;
  private raise = 0;
  private hurt = 0;

  constructor(m: Materials, tex: THREE.Texture, private light: THREE.PointLight, lantern: Lantern, clapper: THREE.Group) {
    const coat = new THREE.MeshStandardMaterial({ color: 0x2f2a26, roughness: 0.96 });
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x2f2a26, roughness: 0.96, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a7262, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1f1b17, roughness: 0.9 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.82 });
    const linen = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 1 });
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 1 });

    const l1 = limb(boot, 0.085, 0.86), l2 = limb(boot, 0.085, 0.86);
    this.legL = l1.pivot; this.legR = l2.pivot;
    this.legL.position.set(-0.11, 0.88, 0); this.legR.position.set(0.11, 0.88, 0);
    for (const leg of [this.legL, this.legR]) {
      const sole = mesh(new THREE.BoxGeometry(0.13, 0.04, 0.26), leather); sole.position.set(0, -0.87, -0.05);
      const foot = mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), boot); foot.position.set(0, -0.82, -0.05);
      const cuff = cyl(leather, 0.095, 0.09, 0.12, 10); cuff.position.y = -0.6;
      const strap = mesh(new THREE.TorusGeometry(0.088, 0.012, 4, 10), leather); strap.rotation.x = Math.PI / 2; strap.position.y = -0.7;
      leg.add(sole, foot, cuff, strap);
    }

    const tunicPts = [[0.2, 0], [0.185, 0.06], [0.165, 0.2], [0.18, 0.34], [0.225, 0.5], [0.235, 0.58], [0.16, 0.64]].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = mesh(new THREE.LatheGeometry(tunicPts, 16), coat); torso.position.y = 0.9;
    const belt = cyl(leather, 0.195, 0.195, 0.06, 14); belt.position.y = 0.96;
    const buckle = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.03), m.iron); buckle.position.set(0, 0.96, -0.19);
    const pouch1 = mesh(new THREE.BoxGeometry(0.09, 0.11, 0.06), leather); pouch1.position.set(0.16, 0.9, -0.1);
    const pouch2 = mesh(new THREE.BoxGeometry(0.07, 0.09, 0.05), leather); pouch2.position.set(-0.15, 0.9, -0.11);
    const strap = mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), leather); strap.position.set(0.02, 1.22, -0.17); strap.rotation.z = 0.5;
    const satchel = mesh(new THREE.BoxGeometry(0.16, 0.14, 0.08), leather); satchel.position.set(-0.2, 0.92, 0.02);
    const flap = mesh(new THREE.BoxGeometry(0.17, 0.06, 0.09), boot); flap.position.set(-0.2, 1.0, 0.02);
    const scarf = mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 14), linen); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.5;
    const clasp = mesh(new THREE.SphereGeometry(0.025, 6, 5), m.iron); clasp.position.set(0, 1.48, -0.16);
    const head = mesh(new THREE.SphereGeometry(0.115, 14, 12), skin); head.position.y = 1.66;
    const hood = buildHood(cloakMat, voidMat); hood.position.set(0, 1.66, 0.02);
    const cloakGeo = new THREE.CylinderGeometry(0.27, 0.42, 1.08, 20, 5, true, -1.5, 3.0);
    const cp = cloakGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const ang = Math.atan2(x, z);
      const f = 1 + Math.sin(ang * 6) * 0.07;
      cp.setX(i, x * f); cp.setZ(i, z * f);
      if (y < -0.4) cp.setY(i, y - Math.abs(Math.sin(ang * 9 + 0.7)) * 0.08);
    }
    cloakGeo.computeVertexNormals();
    this.cloak = mesh(cloakGeo, cloakMat);
    this.cloak.position.set(0, 1.02, 0.05);
    const bedroll = cyl(linen, 0.07, 0.07, 0.34, 10); bedroll.rotation.z = Math.PI / 2; bedroll.position.set(0, 1.34, 0.2);
    for (const x of [-0.1, 0.1]) {
      const tie = mesh(new THREE.TorusGeometry(0.075, 0.01, 4, 8), leather); tie.rotation.y = Math.PI / 2; tie.position.set(x, 1.34, 0.2);
      this.body.add(tie);
    }

    const a1 = limb(coat, 0.06, 0.6), a2 = limb(coat, 0.06, 0.6);
    this.armL = a1.pivot; this.armR = a2.pivot;
    this.armL.position.set(-0.26, 1.45, 0); this.armR.position.set(0.26, 1.45, 0);
    for (const arm of [this.armL, this.armR]) {
      const shoulder = mesh(new THREE.SphereGeometry(0.085, 10, 8), coat); shoulder.position.y = 0.02;
      const elbow = mesh(new THREE.SphereGeometry(0.055, 8, 6), coat); elbow.position.y = -0.3;
      const cuff = cyl(leather, 0.065, 0.06, 0.06, 8); cuff.position.y = -0.52;
      const hand = mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), boot); hand.position.y = -0.62;
      arm.add(shoulder, elbow, cuff, hand);
    }
    this.lantern = lantern;
    this.lantern.group.position.set(0, -0.82, 0);
    this.armR.add(this.lantern.group);
    this.light.position.set(0.3, 1.25, -0.35);
    this.clapper = clapper;
    this.clapper.position.set(-0.2, 0.92, 0.22);
    this.clapper.rotation.z = 0.5;

    this.body.add(torso, belt, buckle, pouch1, pouch2, strap, satchel, flap, scarf, clasp, head, hood, this.cloak, bedroll, this.armL, this.armR, this.clapper);
    this.group.add(this.legL, this.legR, this.body);
  }

  triggerHurt(): void { this.hurt = 1; }

  update(w: World, at: Grounded, yaw: number, dt: number, time: number, pace: WatchmanPace): void {
    this.group.position.set(at.x, gy(at), -at.z);
    this.group.rotation.y = yawToRot(yaw);
    const speed = pace.speed / PLAYER.sprintSpeed;
    const sw = pace.swing * (0.34 + pace.run * 0.24) * Math.sign(pace.forward);
    for (const [i, leg] of [this.legL, this.legR].entries()) {
      const f = pace.feet[i];
      const dx = f.x - at.x, dz = f.z - at.z;
      const forward = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const side = dx * Math.cos(yaw) - dz * Math.sin(yaw) - leg.position.x;
      leg.rotation.x = Math.atan2(forward, Math.max(0.35, gy(at) + leg.position.y - f.y));
      leg.rotation.z = Math.atan2(side, Math.max(0.35, gy(at) + leg.position.y - f.y));
      leg.scale.y = THREE.MathUtils.clamp(Math.hypot(gy(at) + leg.position.y - f.y, forward, side) / 0.89, 0.67, 1.06);
    }
    this.armL.rotation.x = lerp(this.armL.rotation.x, -sw * 0.7, 0.3);
    const lan = w.lantern;
    this.raise = lerp(this.raise, lan.raised ? 1 : 0, Math.min(1, dt * 9));
    this.armR.rotation.x = w.inv.hasLantern ? lerp(0.25, 2.25, this.raise) + sw * 0.08 : sw * 0.7;
    this.armR.rotation.z = w.inv.hasLantern ? lerp(0.12, 0.0, this.raise) : 0;
    this.lantern.group.rotation.x = -this.armR.rotation.x;
    this.lantern.group.visible = w.inv.hasLantern;
    const bob = Math.abs(pace.swing) * 0.025 + Math.sin(time * 1.6) * 0.004;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.body.position.y = bob;
    this.body.rotation.x = pace.forward * 0.042 + this.hurt * 0.3;
    this.cloak.rotation.x = -0.05 - speed * 0.07;
    this.clapper.visible = w.inv.hasClapper;

    const on = w.inv.hasLantern && lan.on && lan.oil > 0;
    const flick = 0.9 + 0.07 * Math.sin(time * 12.7) + 0.05 * Math.sin(time * 27.1 + 2);
    const low = lan.oil < 20 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 5)) : 1;
    this.light.intensity = on ? (lan.raised ? 30 : 13) * flick * low : 0;
    this.light.distance = lan.raised ? 17 : 12;
    this.lantern.group.localToWorld(this.light.position.set(0, -0.10, 0));
    this.group.parent?.worldToLocal(this.light.position);
    this.lantern.glow.visible = on;
    this.lantern.glass.emissiveIntensity = on ? 2.4 * flick : 0;
  }
}

// ---------------------------------------------------------------------------
// 程序化回退灰影（加载失败时启用）。
// ---------------------------------------------------------------------------

function tatter(mat: THREE.Material, r: number, len: number, n: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const l = len * (0.65 + ((i * seed * 7919) % 100) / 180);
    const s = mesh(new THREE.ConeGeometry(0.07, l, 4), mat, false);
    s.position.set(Math.cos(a) * r, -l / 2, Math.sin(a) * r);
    s.rotation.x = Math.PI;
    s.rotation.z = Math.cos(a) * 0.18;
    g.add(s);
  }
  return g;
}

function buildGrey(tex: THREE.Texture): { root: THREE.Group; mats: THREE.Material[]; armL: THREE.Group; armR: THREE.Group; top: THREE.Group; mist: THREE.Sprite[] } {
  const root = new THREE.Group();
  const cloth = rim(new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 1, transparent: true, side: THREE.DoubleSide }), 0x9fb4c8, 0.3);
  const dark = new THREE.MeshBasicMaterial({ color: 0x0a0b0d, transparent: true });
  const top = new THREE.Group();
  const robePts = [[0.19, 1.3], [0.22, 1.0], [0.28, 0.6], [0.36, 0.25], [0.44, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
  const robeGeo = new THREE.LatheGeometry(robePts, 14);
  const rp = robeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    if (rp.getY(i) < 0.05) rp.setY(i, rp.getY(i) - Math.abs(Math.sin(Math.atan2(rp.getZ(i), rp.getX(i)) * 7)) * 0.18);
  }
  robeGeo.computeVertexNormals();
  const robe = mesh(robeGeo, cloth, false);
  const chest = mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 10), cloth, false); chest.position.y = 1.62;
  const hood = mesh(new THREE.ConeGeometry(0.22, 0.66, 9), cloth, false); hood.position.set(0, 2.06, -0.04); hood.rotation.x = 0.12;
  const face = mesh(new THREE.SphereGeometry(0.12, 9, 7), dark, false); face.position.set(0, 1.9, -0.1);
  const hem = tatter(cloth, 0.4, 0.5, 12, 3); hem.position.y = 0.3;
  const mk = (x: number): THREE.Group => {
    const { pivot } = limb(cloth, 0.05, 0.85);
    pivot.position.set(x, 1.75, 0);
    const rag = tatter(cloth, 0.06, 0.42, 4, 5); rag.position.y = -0.8;
    pivot.add(rag);
    return pivot;
  };
  const armL = mk(-0.24), armR = mk(0.24);
  top.add(chest, hood, face, armL, armR);
  const mist: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x8b939c, transparent: true, opacity: 0.22, depthWrite: false }));
    s.scale.setScalar(0.9);
    mist.push(s); root.add(s);
  }
  root.add(robe, hem, top);
  return { root, mats: [cloth, dark, ...mist.map((s) => s.material)], armL, armR, top, mist };
}

class ProceduralGrey {
  readonly group = new THREE.Group();
  private grey: ReturnType<typeof buildGrey>;
  private base = new Map<THREE.Material, number>();
  private ph = 0;

  constructor() {
    const tex = smokeTexture();
    this.grey = buildGrey(tex);
    for (const mat of this.grey.mats) this.base.set(mat, mat.opacity);
    this.group.add(this.grey.root);
    this.grey.root.visible = false;
  }

  private fade(mats: THREE.Material[], k: number): void {
    for (const mat of mats) mat.opacity = (this.base.get(mat) ?? 1) * k;
  }

  update(g: GhostState, at: Grounded, dt: number, time: number): void {
    const m = this.grey;
    const root = m.root;
    root.visible = g.mode !== 'gone';
    root.position.set(at.x, gy(at), -at.z);
    root.rotation.y = yawToRot(g.yaw);
    const alpha = g.mode === 'dissolve' ? Math.max(0, 1 - g.t / GHOST.dissolveSecs) : 1;
    this.fade(m.mats, alpha);
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    this.ph += dt * (g.mode === 'chase' ? 6 : 3) * (moving ? 1 : 0.3);
    const sway = Math.sin(this.ph);
    let armL = 0.12 + sway * 0.12, armR = 0.12 - sway * 0.12, lean = 0.2, turn = 0, lift = 0;
    switch (g.mode) {
      case 'alert': turn = Math.sin(Math.min(1, g.t / 0.35) * Math.PI * 0.5) * 0.5 * (1 - g.t / GHOST.alertPause); lean = 0.1; break;
      case 'chase': armL = armR = 1.2 + sway * 0.1; lean = 0.4; break;
      case 'windup': {
        const k = Math.min(1, g.t / GHOST.grey.windup);
        armL = armR = lerp(1.2, 2.9, k); lean = lerp(0.3, -0.2, k); lift = k * 0.12;
        break;
      }
      case 'recover': { const k = Math.min(1, g.t / 0.25); armL = armR = lerp(2.9, 0.5, k); lean = lerp(0.6, 0.25, Math.min(1, g.t / 0.9)); break; }
      case 'recoil': case 'flee': armL = armR = 2.1; lean = -0.25; break;
      case 'bang': { const k = Math.abs(Math.sin((g.t / 0.7) * Math.PI)); armL = armR = lerp(1.4, 2.4, k); lean = 0.2 + k * 0.2; break; }
      case 'dissolve': lift = (1 - alpha) * 0.9; armL = armR = 0.6; break;
    }
    const k = Math.min(1, dt * 12);
    m.armL.rotation.x = lerp(m.armL.rotation.x, armL, k);
    m.armR.rotation.x = lerp(m.armR.rotation.x, armR, k);
    m.top.rotation.x = lerp(m.top.rotation.x, lean, k);
    m.top.rotation.y = lerp(m.top.rotation.y, turn, k);
    root.position.y += lift + Math.sin(time * 1.7) * 0.03;
    m.mist.forEach((s, i) => {
      s.position.set(Math.cos(time * 0.9 + i * 1.6) * 0.35, 0.18 + 0.1 * Math.sin(time * 1.3 + i), Math.sin(time * 0.7 + i * 1.6) * 0.35);
      s.scale.setScalar(0.8 + (1 - alpha) * 1.6);
    });
  }
}

// ---------------------------------------------------------------------------
// 黑影 RagWraith（concept/05）：四足佝偻破布体。长前肢、脊背布条成刺、
// 头部是下垂兜帽状布团；近黑灰 #1e1f22→#3a3b3f，月光菲涅尔冷灰轮廓，不发光。
// ---------------------------------------------------------------------------

interface WraithUni {
  uTime: { value: number };
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
  uOpacity: { value: number };
  uErode: { value: number };
}

function wraithRags(mat: THREE.MeshStandardMaterial): WraithUni {
  const u: WraithUni = {
    uTime: { value: 0 }, uRim: { value: 0.3 }, uRimColor: { value: new THREE.Color(0x5a6672) },
    uOpacity: { value: 0.96 }, uErode: { value: 0.2 },
  };
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.vertexColors = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aHang;\nvarying vec3 vWpos;\nvarying float vHang;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vHang = aHang;
        float hang = aHang * aHang;
        transformed.x += sin(uTime * 3.4 + position.y * 5.0 + position.z * 4.0) * 0.05 * hang;
        transformed.z += cos(uTime * 2.7 + position.x * 6.0) * 0.04 * hang;
        vWpos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime, uRim, uOpacity, uErode; uniform vec3 uRimColor;
        varying vec3 vWpos; varying float vHang;
        float awHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float awNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(awHash(i), awHash(i + vec3(1, 0, 0)), f.x), mix(awHash(i + vec3(0, 1, 0)), awHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(awHash(i + vec3(0, 0, 1)), awHash(i + vec3(1, 0, 1)), f.x), mix(awHash(i + vec3(0, 1, 1)), awHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float wLum = dot(diffuseColor.rgb, vec3(0.3333));
        diffuseColor.rgb = mix(vec3(wLum), diffuseColor.rgb, 0.2) * vec3(0.82, 0.86, 0.92) * 0.6;`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float ndv = saturate(dot(normalize(vViewPosition), normal));
        float rimF = pow(1.0 - ndv, 2.6);
        float rim2 = pow(1.0 - ndv, 5.5);
        // 月光冷灰轮廓：强度压低并钳制，边缘最亮不超 ~0.5，绝不冲白（圣经 §4.5 不发光）。
        vec3 rimC = uRimColor * (rimF * 0.2 + rim2 * 0.26) * uRim;
        totalEmissiveRadiance += min(rimC, vec3(0.08));
        float n = awNoise(vWpos * 2.4 + vec3(0.0, uTime * 0.5, uTime * 0.13));
        float n2 = awNoise(vWpos * 7.0 - vec3(uTime * 0.3, 0.0, 0.0));
        diffuseColor.a *= uOpacity * (0.8 + 0.2 * n) * (0.8 + 0.2 * n2);
        diffuseColor.a *= 1.0 - uErode * 0.55 * rimF * (1.0 - n2);
        float tear = awNoise(vWpos * 10.0 + vec3(uTime * 0.12, 0.0, 0.0));
        if (vHang > 0.74 && tear < (vHang - 0.74) * 0.65) discard;`)
      .replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
        material.specularColor = vec3(0.0);`);
  };
  mat.customProgramCacheKey = () => 'wraithRags';
  return u;
}

class RagWraith {
  readonly root = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private legs: { pivot: THREE.Group; knee: THREE.Group; front: boolean }[] = [];
  private uni: WraithUni;
  private voidMat: THREE.MeshBasicMaterial;
  private ph = 0;

  constructor() {
    const ragMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 1, metalness: 0 });
    // 实例差异（圣经 §5.2）：每只黑影轻微色值抖动。
    ragMat.color.multiplyScalar(0.9 + Math.random() * 0.2);
    this.uni = wraithRags(ragMat);
    this.voidMat = new THREE.MeshBasicMaterial({ color: 0x0a0b0d, transparent: true });
    const r = rng(4242);

    // 脊背布条成刺：四排叠瓦，向后上翘，宽布片而非细刺
    const back: THREE.BufferGeometry[] = [];
    // 躯干核心（暗色体积，与布条同材质同侵蚀，避免光滑蛋壳感）：佝偻拱背 + 肩峰
    back.push(solidRagAttrs(mergeGeometries([
      new THREE.SphereGeometry(0.36, 12, 9).scale(0.7, 0.72, 1.2).translate(0, 1.0, 0.16),
      new THREE.SphereGeometry(0.26, 10, 8).scale(0.78, 0.95, 0.95).translate(0, 1.04, -0.36),
      new THREE.SphereGeometry(0.22, 10, 8).scale(0.9, 0.8, 0.9).translate(0, 1.18, -0.26),
    ], false)!, 0.12));
    for (let row = 0; row < 4; row++) {
      const z = -0.42 + row * 0.32;
      const y = 1.22 - row * 0.07;
      for (let i = 0; i < 7; i++) {
        const x = -0.28 + i * 0.093 + (r() - 0.5) * 0.05;
        const len = 0.3 + r() * 0.16 - row * 0.02;
        back.push(placeRag(ragGeo(0.18 + r() * 0.08, len, row * 31 + i, 0.45 + r() * 0.4, 0.5),
          x, y, z, -1.6 + (r() - 0.5) * 0.5, (r() - 0.5) * 0.4, (r() - 0.5) * 0.35));
      }
    }
    // 体侧垂布：密排长条拖向地面
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = -0.4 + i * 0.19;
        back.push(placeRag(ragGeo(0.2 + r() * 0.08, 0.62 + r() * 0.34, 100 + side * 10 + i, 0.45 + r() * 0.45, 0.45),
          side * (0.27 + r() * 0.06), 1.0 - i * 0.015, z, (r() - 0.5) * 0.25, 0, side * (0.14 + r() * 0.12)));
      }
    }
    // 腹下碎布
    for (let i = 0; i < 6; i++) {
      back.push(placeRag(ragGeo(0.15, 0.34 + r() * 0.18, 200 + i, 0.4 + r() * 0.35, 0.4),
        (r() - 0.5) * 0.34, 0.76, -0.28 + i * 0.17, (r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35));
    }
    this.spine.add(mesh(mergeRags(back), ragMat, false));
    this.root.add(this.spine);

    // 头部：下垂兜帽状布团 + 面部垂条 + 暗腔
    const hoodGeo = new THREE.ConeGeometry(0.17, 0.42, 12, 3);
    const hp = hoodGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      if (y < -0.12) {
        const ang = Math.atan2(hp.getX(i), hp.getZ(i));
        hp.setY(i, y - Math.abs(Math.sin(ang * 5 + 1)) * 0.1);
      }
    }
    hoodGeo.computeVertexNormals();
    hoodGeo.rotateX(-2.55);
    hoodGeo.translate(0, 0.0, -0.12);
    const headRags: THREE.BufferGeometry[] = [solidRagAttrs(hoodGeo, 0.15)];
    // 实心暗色头核：填满布条间隙，杜绝背景月光从针孔透出形成亮点
    headRags.push(solidRagAttrs(new THREE.SphereGeometry(0.16, 12, 9).translate(0, -0.02, -0.13), 0.12));
    // 兜帽周缘垂布
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      headRags.push(placeRag(ragGeo(0.09 + r() * 0.04, 0.26 + r() * 0.16, 300 + i, 0.5 + r() * 0.4, 0.45),
        Math.sin(a) * 0.13, -0.02, -0.16 + Math.cos(a) * 0.1, -0.5 + Math.cos(a) * 0.3, a, Math.sin(a) * 0.2));
    }
    // 面部垂条
    for (let i = 0; i < 4; i++) {
      headRags.push(placeRag(ragGeo(0.07 + r() * 0.03, 0.24 + r() * 0.12, 310 + i, 0.45 + r() * 0.35, 0.4),
        -0.09 + i * 0.06, -0.06, -0.27 - r() * 0.04, -0.3 + (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.2));
    }
    // 兜帽顶背布刺
    for (let i = 0; i < 3; i++) {
      headRags.push(placeRag(ragGeo(0.12, 0.22 + r() * 0.1, 320 + i, 0.55 + r() * 0.3, 0.5),
        (r() - 0.5) * 0.12, 0.1, 0.04 + i * 0.06, -2.5 + (r() - 0.5) * 0.3, 0, 0));
    }
    const voidHead = mesh(new THREE.SphereGeometry(0.1, 10, 8), this.voidMat, false);
    voidHead.position.set(0, -0.12, -0.2);
    this.head.add(mesh(mergeRags(headRags), ragMat, false), voidHead);
    this.head.position.set(0, 1.1, -0.6);
    this.root.add(this.head);

    // 四肢：长前肢 + 短后肢，布条包裹，末端散开铺地
    const mkLeg = (x: number, y: number, z: number, front: boolean): void => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.rotation.z = x > 0 ? -0.16 : 0.16;
      const upLen = front ? 0.64 : 0.46;
      const loLen = front ? 0.62 : 0.48;
      const up: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        up.push(placeRag(ragGeo(0.2 + r() * 0.05, upLen * (0.88 + r() * 0.26), 400 + (front ? 0 : 50) + i + Math.round(x * 10), 0.45 + r() * 0.45, 0.45),
          Math.sin(a) * 0.07, 0.03, Math.cos(a) * 0.07, (front ? 0.12 : 0.3) + Math.cos(a) * 0.08, a, Math.sin(a) * 0.08));
      }
      pivot.add(mesh(mergeRags(up), ragMat, false));
      const knee = new THREE.Group();
      knee.position.set(0, -upLen, front ? -0.06 : 0.12);
      const lo: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        lo.push(placeRag(ragGeo(0.19 + r() * 0.05, loLen * (0.9 + r() * 0.26), 500 + (front ? 0 : 50) + i + Math.round(x * 10), 0.45 + r() * 0.45, 0.45),
          Math.sin(a) * 0.06, 0.03, Math.cos(a) * 0.06, (front ? -0.1 : -0.25) + Math.cos(a) * 0.07, a, Math.sin(a) * 0.07));
      }
      // 脚端破布铺地散开
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.36;
        lo.push(placeRag(ragGeo(0.11 + r() * 0.04, 0.3 + r() * 0.16, 600 + i + Math.round(x * 10), 0.4 + r() * 0.35, 0.4),
          Math.sin(a) * 0.1, -loLen + 0.05, -Math.cos(a) * 0.1, -1.8 + (r() - 0.5) * 0.3, a, 0));
      }
      knee.add(mesh(mergeRags(lo), ragMat, false));
      pivot.add(knee);
      this.root.add(pivot);
      this.legs.push({ pivot, knee, front });
    };
    mkLeg(-0.48, 1.22, -0.42, true);
    mkLeg(0.48, 1.22, -0.42, true);
    mkLeg(-0.38, 0.88, 0.55, false);
    mkLeg(0.38, 0.88, 0.55, false);
    this.root.visible = false;
  }

  update(g: GhostState, at: Grounded, dt: number, time: number): void {
    const root = this.root;
    root.visible = g.mode !== 'gone';
    root.position.set(at.x, gy(at), -at.z);
    root.rotation.order = 'YXZ';
    root.rotation.y = yawToRot(g.yaw);
    const alpha = g.mode === 'dissolve' ? Math.max(0, 1 - g.t / GHOST.dissolveSecs) : 1;
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    this.ph += dt * (g.mode === 'chase' ? 11 : 5.5) * (moving ? 1 : 0);
    let rear = 0, crouch = 0, flare = 1, lift = 0, rimS = 0.3, reach = 0.1;
    switch (g.mode) {
      case 'alert': rear = 0.45 * Math.min(1, g.t / 0.3); rimS = 0.4; break;
      case 'chase': crouch = -0.08; reach = 0.45; break;
      case 'windup': {
        const k = Math.min(1, g.t / GHOST.wraith.windup);
        rear = lerp(0.1, 0.85, k); flare = 1 + k * 0.5; crouch = -0.14 * (1 - k); rimS = lerp(0.3, 0.42, k); reach = lerp(0.2, 0.9, k);
        break;
      }
      case 'recover': rear = lerp(-0.3, 0, Math.min(1, g.t / 0.6)); crouch = -0.1; reach = 0.3; break;
      case 'recoil': case 'flee': crouch = -0.24; flare = 0.85; reach = -0.15; break;
      case 'dissolve': lift = (1 - alpha) * 0.4; flare = 1 + (1 - alpha) * 0.8; break;
    }
    const k = Math.min(1, dt * 10);
    this.spine.rotation.x = lerp(this.spine.rotation.x, rear * 0.5, k);
    this.head.rotation.x = lerp(this.head.rotation.x, -0.12 - rear * 0.35, k);
    root.scale.x = lerp(root.scale.x, flare, k);
    root.scale.y = lerp(root.scale.y, 1 + (flare - 1) * 0.6, k);
    root.scale.z = lerp(root.scale.z, flare, k);
    root.position.y += crouch + lift + (moving ? Math.abs(Math.sin(this.ph)) * 0.03 : 0);
    this.legs.forEach((leg, i) => {
      const diag = i === 0 || i === 3 ? 0 : Math.PI;
      const s = Math.sin(this.ph + diag);
      const swing = moving ? s * 0.38 : s * 0.03;
      if (leg.front) {
        leg.pivot.rotation.x = lerp(leg.pivot.rotation.x, 0.1 + swing + reach * 0.55, k);
        leg.knee.rotation.x = lerp(leg.knee.rotation.x, -0.18 - Math.max(0, -s) * 0.3 - reach * 0.2, k);
      } else {
        leg.pivot.rotation.x = lerp(leg.pivot.rotation.x, -0.12 - swing - rear * 0.3, k);
        leg.knee.rotation.x = lerp(leg.knee.rotation.x, 0.28 + Math.max(0, s) * 0.25, k);
      }
    });
    this.uni.uTime.value = time;
    this.uni.uOpacity.value = alpha * 0.96;
    this.uni.uErode.value = 0.2 + (1 - alpha) * 0.6;
    this.uni.uRim.value = lerp(this.uni.uRim.value, rimS, k);
    this.voidMat.opacity = alpha;
  }
}

// ---------------------------------------------------------------------------
// 资产驱动的守夜人：mixamo 骨骼 + baked Idle + authored Walk/Run 交叉淡入。
// ---------------------------------------------------------------------------

type CloakFlutter = { uTime: { value: number }; uSway: { value: number } };

export class PlayerModel {
  readonly group = new THREE.Group();
  readonly lanternLight = new THREE.PointLight(0xffa550, 0, 13, 1.5);
  private procedural: ProceduralPlayer;
  private lantern: Lantern;
  private clapper: THREE.Group;
  private asset: HunterAsset | null = null;
  private readonly pace = new WatchmanPace();
  private readonly limb = new LimbSolver();
  private readonly flutter: CloakFlutter = { uTime: { value: 0 }, uSway: { value: 0 } };
  private lastWorld: World | null = null;
  private rotS: number | null = null;
  private readonly turnQ = new THREE.Quaternion();
  private readonly targetTurn = new THREE.Quaternion();
  private readonly grip = new THREE.Group();
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly joint = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly limit = new THREE.Vector3();
  private readonly ground = (x: number, z: number, y: number): number => {
    // Match solid stair surfaces, not the smoothed visual root or a floor above the boot.
    for (const tread of STAIR_MASS) if (Math.abs(tread.h - y) < 0.47 && inArea(tread, x, z)) return tread.h;
    const flat = supportY(x, z, y);
    return flat && Math.abs(flat.y - y) < 0.47 ? flat.y : y;
  };
  private raise = 0;
  private pelvisY: number | null = null;
  private hurt = 0;
  private cloakPivot: THREE.Group | null = null;
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();

  constructor(m: Materials, tex: THREE.Texture) {
    this.lantern = makeLantern(m, tex);
    this.clapper = makeClapper(m);
    this.procedural = new ProceduralPlayer(m, tex, this.lanternLight, this.lantern, this.clapper);
    this.grip.name = 'watchman-lantern-grip';
    this.group.add(this.procedural.group, this.lanternLight, this.grip);
    void Promise.all([loadCharacterAssets(), loadCharTextures()]).then(([a, t]) => {
      if (a.hunter) this.attachAsset(a.hunter, t);
    });
  }

  private attachAsset(a: HunterAsset, tex: CharTextures): void {
    this.asset = a;
    this.procedural.group.visible = false;
    this.group.add(a.root);
    a.mixer.clipAction(a.idle).play();
    // 提灯挂右手；兜帽挂头；披肩/斗篷/腰带挂胸椎
    this.lantern.group.position.set(0, -0.152, 0);
    this.grip.add(this.lantern.group);
    const { hood, mantle, cloakPivot, belt } = makeCloakOutfit(tex, a.lampSource, this.flutter);
    a.headAnchor.add(hood);
    a.chestAnchor.add(mantle, cloakPivot, belt);
    this.cloakPivot = cloakPivot;
    this.clapper.position.set(-0.16, -0.42, 0.16);
    this.clapper.rotation.z = 0.5;
    a.chestAnchor.add(this.clapper);
  }

  triggerHurt(): void {
    this.hurt = 1;
    this.procedural.triggerHurt();
  }

  update(w: World, at: Grounded, yaw: number, dt: number, time: number): void {
    if (w !== this.lastWorld) { this.pace.reset(); this.rotS = null; this.pelvisY = null; this.lastWorld = w; }
    const targetYaw = yawToRot(yaw);
    if (this.rotS === null) this.rotS = targetYaw;
    const difference = targetYaw - this.rotS;
    this.rotS += Math.atan2(Math.sin(difference), Math.cos(difference)) * (1 - Math.exp(-14 * dt));
    const y = gy(at);
    const terrainY = this.ground(at.x, at.z, w.player.y);
    this.pace.update({ x: at.x, y: terrainY, z: at.z }, -this.rotS, dt, this.ground);
    const pace = this.pace;
    if (!this.asset) {
      this.procedural.update(w, at, -this.rotS, dt, time, pace);
      return;
    }
    const a = this.asset, b = a.bones;
    this.group.position.set(at.x, y, -at.z);
    this.group.rotation.y = this.rotS;
    a.mixer.update(dt);

    const lan = w.lantern;
    const smooth = (rate: number): number => 1 - Math.exp(-rate * dt);
    this.raise = lerp(this.raise, lan.raised && w.inv.hasLantern ? 1 : 0, smooth(12));
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.turnQ.setFromAxisAngle(this.axisY, this.rotS);
    if (b.hips) {
      const ground = Math.min(terrainY, Math.max(terrainY - 0.27, Math.min(...pace.feet.map((f) => f.y))));
      const tuck = pace.run * 0.025 + Math.abs(pace.lateral) * 0.012;
      this.pelvisY = this.pelvisY === null || Math.abs(ground - this.pelvisY) > 0.46 ? ground : lerp(this.pelvisY, ground, smooth(19));
      b.hips.getWorldPosition(this.tmpV);
      this.tmpV.y += this.pelvisY - y - 0.055 - tuck + Math.abs(pace.swing) * 0.029;
      b.hips.parent?.worldToLocal(this.tmpV);
      b.hips.position.copy(this.tmpV);
    }
    this.tilt(b.spine, pace.forward * 0.026 + this.hurt * 0.32, pace.swing * 0.075, -pace.lateral * 0.027);
    this.tilt(b.spine1, pace.forward * 0.016, pace.swing * 0.035, -pace.lateral * 0.014);
    this.tilt(b.head, -pace.forward * 0.021, -pace.swing * 0.051, pace.lateral * 0.018);

    for (const [i, side] of ['L', 'R'].entries()) {
      const f = pace.feet[i], boot = a.feet[i];
      const hip = b[`upLeg${side}`], knee = b[`leg${side}`], ankle = b[`foot${side}`];
      if (!hip || !knee || !ankle) continue;
      this.target.set(f.x, f.y + boot.ankleHeight, -f.z);
      this.pole.set(i === 0 ? -0.14 : 0.14, 0, -1).applyQuaternion(this.turnQ);
      this.limb.solve(hip, knee, ankle, this.target, this.pole);
      this.tmpQ.setFromAxisAngle(this.axisY, -f.yaw).multiply(boot.orientation);
      this.limb.orient(ankle, this.tmpQ);
    }

    // Reach in body axes, with a separate elbow guide. The lamp does not inherit
    // the swinging arm's twist or cross the body when transitioning to raised.
    for (const [i, side] of ['L', 'R'].entries()) {
      const upper = b[`arm${side}`], lower = b[`foreArm${side}`], hand = b[`hand${side}`];
      if (!upper || !lower || !hand) continue;
      const sign = i === 0 ? -1 : 1;
      const carrying = i === 1 && w.inv.hasLantern;
      const counter = pace.swing * (0.16 + pace.run * 0.16) * THREE.MathUtils.clamp(pace.forward, -1, 1) * sign;
      if (carrying) {
        this.target.set(lerp(0.395, 0.34, this.raise), lerp(0.88, 1.34, this.raise), lerp(-0.19, -0.53, this.raise));
        this.target.z += counter * (1 - this.raise) * 0.12;
      } else this.target.set(sign * 0.255, 0.81 + Math.abs(counter * 0.27), -0.045 + counter);
      this.group.localToWorld(this.target);
      upper.getWorldPosition(this.joint);
      if (carrying) {
        const t = cameraClearT(this.joint.x, -this.joint.z, this.joint.y, this.target.x, -this.target.z, this.target.y, w.doors);
        if (t < 1) this.target.lerpVectors(this.joint, this.target, Math.max(0.24, t - 0.16));
      }
      this.pole.set(sign * (carrying ? 0.45 : 0.3), carrying ? -0.75 : -0.2, 0.6).applyQuaternion(this.turnQ);
      this.limb.solve(upper, lower, hand, this.target, this.pole);
    }
    this.grip.visible = this.lantern.group.visible = w.inv.hasLantern;
    if (b.handR) {
      b.handR.getWorldPosition(this.tmpV);
      this.grip.position.copy(this.group.worldToLocal(this.tmpV));
    }
    this.grip.rotation.set(-pace.forward * 0.018 * (1 - this.raise), 0,
      (-pace.lateral * 0.024 + pace.swing * 0.041) * (1 - this.raise * 0.7));
    this.clapper.visible = w.inv.hasClapper;
    this.flutter.uTime.value = time;
    this.flutter.uSway.value = lerp(this.flutter.uSway.value, pace.activity * 0.44 + Math.abs(pace.turn) * 0.055, smooth(5));
    if (this.cloakPivot) {
      this.cloakPivot.rotation.x = lerp(this.cloakPivot.rotation.x, -0.085 - Math.max(0, pace.forward) * 0.038, smooth(7));
      this.cloakPivot.rotation.z = lerp(this.cloakPivot.rotation.z, -pace.lateral * 0.047 + pace.turn * 0.009, smooth(6));
    }

    const on = w.inv.hasLantern && lan.on && lan.oil > 0;
    const flick = 0.9 + 0.07 * Math.sin(time * 12.7) + 0.05 * Math.sin(time * 27.1 + 2);
    const low = lan.oil < 20 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 5)) : 1;
    this.lanternLight.intensity = on ? (lan.raised ? 30 : 13) * flick * low : 0;
    this.lanternLight.distance = lan.raised ? 17 : 12;
    // Candle flame, not the hand/pivot or an arbitrary point in the coat.
    this.lantern.group.localToWorld(a.lampSource.value.set(0, -0.10, 0));
    this.lanternLight.position.copy(this.group.worldToLocal(this.limit.copy(a.lampSource.value)));
    this.lantern.glow.visible = on;
    this.lantern.glass.emissiveIntensity = on ? 2.4 * flick : 0;
  }

  private tilt(joint: THREE.Bone | undefined, x: number, y: number, z: number): void {
    if (!joint) return;
    this.tmpQ.setFromEuler(this.tmpE.set(x, y, z)).premultiply(this.turnQ).multiply(this.targetTurn.copy(this.turnQ).invert());
    joint.getWorldQuaternion(this.targetTurn).premultiply(this.tmpQ);
    this.limb.orient(joint, this.targetTurn);
  }

}

// ---------------------------------------------------------------------------
// 双鬼：灰影 = 破袍 Reaper + 布条层（布料飘动/溶解着色器）；黑影 = RagWraith。
// ---------------------------------------------------------------------------

export class GhostModels {
  readonly group = new THREE.Group();
  private procedural: ProceduralGrey;
  private reaper: ReaperAsset | null = null;
  private wraith: RagWraith;
  private eyes: THREE.Sprite[] = [];
  private greyVoid: THREE.Mesh | null = null;
  private hemMist: THREE.Sprite[] = [];
  private greyTrail = new SoftParticles(140, false);
  private wraithTrail = new SoftParticles(140, false);
  private wraithDebris = new SoftParticles(90, false);
  private trailAcc = { grey: 0, wraith: 0, debris: 0 };
  private tmpV = new THREE.Vector3();

  constructor() {
    this.procedural = new ProceduralGrey();
    this.wraith = new RagWraith();
    this.group.add(this.procedural.group, this.wraith.root, this.greyTrail.points, this.wraithTrail.points, this.wraithDebris.points);
    void loadCharacterAssets().then((a) => { if (a.reaper) this.attachReaper(a.reaper); });
  }

  private attachReaper(a: ReaperAsset): void {
    this.procedural.group.visible = false;
    this.reaper = a;
    this.group.add(a.root);
    a.root.visible = false;
    // 附加破布层：肩部披布 + 腰间布带（遮住原模型杂物）+ 下摆碎条，与主体共享动画
    const ragMat = new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.97, metalness: 0 });
    ghostRags(ragMat, 2.15, a.cloth);
    const r = rng(917);
    const rags: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      rags.push(placeRag(ragGeo(0.13 + r() * 0.06, 0.42 + r() * 0.2, 10 + i, 0.6 + r() * 0.4),
        Math.sin(ang) * 0.23, 1.62, Math.cos(ang) * 0.23, 0.1 * Math.cos(ang), ang, 0.12 * Math.sin(ang)));
    }
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      rags.push(placeRag(ragGeo(0.16 + r() * 0.06, 0.5 + r() * 0.2, 40 + i, 0.55 + r() * 0.4),
        Math.sin(ang) * 0.27, 1.12, Math.cos(ang) * 0.27, 0.1 * Math.cos(ang), ang, 0.12 * Math.sin(ang)));
    }
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + 0.26;
      rags.push(placeRag(ragGeo(0.14 + r() * 0.05, 0.42 + r() * 0.16, 140 + i, 0.5 + r() * 0.4),
        Math.sin(ang) * 0.24, 1.22, Math.cos(ang) * 0.24, 0.08 * Math.cos(ang), ang, 0.1 * Math.sin(ang)));
    }
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      rags.push(placeRag(ragGeo(0.14 + r() * 0.07, 0.45 + r() * 0.25, 70 + i, 0.5 + r() * 0.45),
        Math.sin(ang) * 0.38, 0.42, Math.cos(ang) * 0.38, 0.16 * Math.cos(ang), ang, 0.16 * Math.sin(ang)));
    }
    a.root.add(mesh(mergeRags(rags), ragMat, false));
    // 兜帽暗腔 + 两点极暗冷光（≤0.3）
    const voidHood = mesh(new THREE.SphereGeometry(0.09, 12, 9), new THREE.MeshBasicMaterial({ color: 0x0a0b0d }), false);
    voidHood.scale.set(1, 1.2, 1);
    voidHood.position.set(0.02, 1.86, -0.16);
    a.root.add(voidHood);
    this.greyVoid = voidHood;
    // 腰间实心破布围裙（整圈、不透明）：彻底遮住原模型沙漏。晚于本体绘制并写深度。
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x55534e, roughness: 0.97, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: true });
    panelMat.onBeforeCompile = (sh) => {
      sh.uniforms.uLean = a.cloth.uLean;
      sh.uniforms.uHeight = { value: 2.15 };
      sh.uniforms.uOpacity = a.cloth.uOpacity;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uLean, uHeight;')
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          float hh = clamp(transformed.y / uHeight, 0.0, 1.5);
          transformed.z += uLean * hh * hh * uHeight * 0.55;`);
      sh.fragmentShader = 'uniform float uOpacity;\n' + sh.fragmentShader.replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        diffuseColor.a *= uOpacity;
        float pLum = dot(diffuseColor.rgb, vec3(0.3333));
        diffuseColor.rgb = mix(vec3(pLum), diffuseColor.rgb, 0.3);`);
    };
    panelMat.customProgramCacheKey = () => 'greyPanel';
    const panelGeo = new THREE.CylinderGeometry(0.46, 0.5, 0.82, 20, 3, true, 0, Math.PI * 2);
    panelGeo.translate(0, 0.95, 0);
    const panelMesh = mesh(panelGeo, panelMat, false);
    panelMesh.renderOrder = 10;
    a.root.add(panelMesh);
    // 前腰垂布：密排双层遮住原模型腰间杂物（沙漏）
    const apron: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) {
      apron.push(placeRag(ragGeo(0.26 + r() * 0.05, 0.62 + r() * 0.16, 500 + i, 0.55 + r() * 0.35, 0.45),
        -0.3 + i * 0.066, 1.24, -0.42 - r() * 0.03, 0.12, (r() - 0.5) * 0.2, (r() - 0.5) * 0.12));
    }
    for (let i = 0; i < 8; i++) {
      apron.push(placeRag(ragGeo(0.24 + r() * 0.05, 0.52 + r() * 0.14, 560 + i, 0.5 + r() * 0.35, 0.45),
        -0.27 + i * 0.077, 1.32, -0.38 - r() * 0.03, 0.1, (r() - 0.5) * 0.2, (r() - 0.5) * 0.12));
    }
    const apronMesh = mesh(mergeRags(apron), ragMat, false);
    apronMesh.renderOrder = 11;
    a.root.add(apronMesh);
    // 袍摆烟雾：下摆溶进烟里
    const hemTex = smokeTexture();
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: hemTex, color: 0x8b939c, transparent: true, opacity: 0.22, depthWrite: false }));
      sp.scale.set(0.7, 0.4, 1);
      sp.position.set(Math.cos(i * 1.9) * 0.32, 0.12 + (i % 2) * 0.1, Math.sin(i * 1.9) * 0.32);
      a.root.add(sp);
      this.hemMist.push(sp);
    }
    const eyeTex = glowTexture();
    for (const x of [-0.04, 0.04]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex, color: 0x9fb4c8, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(x, 1.88, -0.27);
      s.scale.setScalar(0.05);
      a.root.add(s);
      this.eyes.push(s);
    }
  }

  update(w: World, at: Grounded[], dt: number, time: number): void {
    this.greyTrail.update(dt);
    this.wraithTrail.update(dt);
    this.wraithDebris.update(dt);
    if (this.reaper) this.reaper.root.visible = false;
    this.procedural.group.visible = !this.reaper && w.ghosts.some((g) => g.kind === 'grey');
    this.wraith.root.visible = false;
    w.ghosts.forEach((g, i) => {
      const pos = at[i] ?? g;
      if (g.kind === 'grey') {
        if (this.reaper) this.updateGrey(g, pos, dt, time);
        else this.procedural.update(g, pos, dt, time);
      } else {
        this.wraith.update(g, pos, dt, time);
        this.wraithTrailEmit(g, pos, dt);
      }
    });
  }

  private updateGrey(g: GhostState, at: Grounded, dt: number, time: number): void {
    const a = this.reaper!;
    const u = a.cloth;
    a.root.visible = g.mode !== 'gone';
    a.root.position.set(at.x, gy(at), -at.z);
    a.root.rotation.y = yawToRot(g.yaw);
    const alpha = g.mode === 'dissolve' ? Math.max(0, 1 - g.t / GHOST.dissolveSecs) : 1;
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    let lean = 0.3, arm = 0.08, lift = 0, flutter = 0.022, rimS = 0.28;
    const sway = Math.sin(time * (g.mode === 'chase' ? 6 : 3));
    switch (g.mode) {
      case 'alert': lean = 0.12; arm = 0.2; break;
      case 'chase': lean = 0.45; arm = 0.55 + sway * 0.06; flutter = 0.06; rimS = 0.4; break;
      case 'windup': {
        const k = Math.min(1, g.t / GHOST.grey.windup);
        lean = lerp(0.35, -0.25, k); arm = lerp(0.5, 1.35, k); lift = k * 0.12; flutter = 0.08; rimS = lerp(0.4, 0.6, k);
        break;
      }
      case 'recover': { const k = Math.min(1, g.t / 0.25); arm = lerp(1.35, 0.1, k); lean = lerp(0.55, 0.3, Math.min(1, g.t / 0.9)); break; }
      case 'recoil': case 'flee': lean = -0.25; arm = 0.9; flutter = 0.07; break;
      case 'bang': { const k = Math.abs(Math.sin((g.t / 0.7) * Math.PI)); arm = lerp(0.6, 1.1, k); lean = 0.25 + k * 0.2; break; }
      case 'dissolve': lift = (1 - alpha) * 0.9; arm = 0.3; break;
    }
    const k = Math.min(1, dt * 10);
    u.uTime.value = time;
    u.uLean.value = lerp(u.uLean.value, lean, k);
    u.uArmRaise.value = lerp(u.uArmRaise.value, arm, k);
    u.uFlutter.value = lerp(u.uFlutter.value, flutter * (moving ? 1.4 : 1), k);
    u.uRim.value = lerp(u.uRim.value, rimS, k);
    u.uOpacity.value = alpha;
    u.uDissolve.value = 1 - alpha;
    a.root.position.y += lift + Math.sin(time * 1.7) * 0.03;
    // 兜帽暗腔与冷光点跟随主体前倾剪切（头部高度 hh≈0.87；剪切在网格局部空间，世界方向取反）
    const leanOff = -u.uLean.value * 0.886;
    if (this.greyVoid) {
      this.greyVoid.position.z = -0.16 + leanOff;
      this.greyVoid.visible = g.mode !== 'dissolve';
    }
    for (const e of this.eyes) {
      (e.material as THREE.SpriteMaterial).opacity = alpha * (0.22 + 0.08 * Math.sin(time * 2.3));
      e.position.z = -0.27 + leanOff;
      e.visible = g.mode !== 'dissolve';
    }
    this.hemMist.forEach((sp, i) => {
      (sp.material as THREE.SpriteMaterial).opacity = alpha * (0.16 + 0.08 * Math.sin(time * 1.4 + i * 2.0));
      sp.position.x = Math.cos(time * 0.6 + i * 1.9) * 0.34;
      sp.position.z = Math.sin(time * 0.5 + i * 1.9) * 0.34;
      sp.scale.setScalar(0.6 + (1 - alpha) * 1.4);
    });
    // 身后拖烟（冷灰软烟）
    if (moving && alpha > 0.5) {
      this.trailAcc.grey += dt * 16;
      while (this.trailAcc.grey > 1) {
        this.trailAcc.grey -= 1;
        const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
        this.tmpV.set(at.x - sy * 0.35, gy(at) + 0.25 + Math.random() * 0.5, -(at.z - cy * 0.35));
        this.greyTrail.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.18, 0), spread: 0.4, life: 1.1, size: 0.24, grow: 1.6, color: new THREE.Color(0x8b939c), drag: 1.2 });
      }
    }
  }

  private wraithTrailEmit(g: GhostState, at: Grounded, dt: number): void {
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    const alpha = g.mode === 'dissolve' ? Math.max(0, 1 - g.t / GHOST.dissolveSecs) : 1;
    if (!moving || alpha <= 0.5) return;
    const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
    // 黑烟拖尾
    this.trailAcc.wraith += dt * 14;
    while (this.trailAcc.wraith > 1) {
      this.trailAcc.wraith -= 1;
      this.tmpV.set(at.x - sy * 0.5, gy(at) + 0.2 + Math.random() * 0.4, -(at.z - cy * 0.5));
      this.wraithTrail.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.15, 0), spread: 0.5, life: 0.9, size: 0.26, grow: 1.8, color: new THREE.Color(0x1c2128), drag: 1.4 });
    }
    // 黑色碎屑：小而短命，受重力下落
    this.trailAcc.debris += dt * 20;
    while (this.trailAcc.debris > 1) {
      this.trailAcc.debris -= 1;
      this.tmpV.set(at.x - sy * 0.3 + (Math.random() - 0.5) * 0.6, gy(at) + 0.5 + Math.random() * 0.7, -(at.z - cy * 0.3) + (Math.random() - 0.5) * 0.6);
      this.wraithDebris.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.1, 0), spread: 0.3, life: 0.55, size: 0.035, grow: 0, color: new THREE.Color(0x0d0e10), gravity: -3.5, drag: 0.6 });
    }
  }
}