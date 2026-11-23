// 材质族（美术圣经 5.1）：按区域选用的共享材质，名字是各代理共用的契约，不得自建同类材质。
// 石类复用 materials.ts 的共享石材着色器（湿度/宏观噪声/POM/积水响应一致）；底图为 Poly Haven CC0 扫描，
// 全部去饱和并压到第 4.1 节冷灰色值（原图普遍偏暖偏黄）。世界空间 UV + 低频宏观色差打破平铺重复。
import * as THREE from 'three';
import { Materials, awUniforms, blocks, enhance, stoneShader, trackPending, weatheredWoodRoughness } from './materials';

export interface Variants {
  /** 庭院幕墙、外墙大面：乱石砌 */
  wallRubble: THREE.MeshStandardMaterial;
  /** 礼拜堂立面与侧墙、扶壁、门房外墙：整齐方石 */
  wallAshlar: THREE.MeshStandardMaterial;
  /** 门窗套、券石、压顶、勒脚、线脚、隅石、台阶、垛口：细凿大石 */
  wallTrim: THREE.MeshStandardMaterial;
  /** 地窖、墙基、补砌段、坍塌处、拱顶：粗石 */
  wallRough: THREE.MeshStandardMaterial;
  /** 礼拜堂内墙、门房上半墙：石灰抹面 */
  wallPlaster: THREE.MeshStandardMaterial;
  /** 庭院主路、外廊：大石板 */
  floorFlag: THREE.MeshStandardMaterial;
  /** 庭院边缘、次要区、城墙步道：旧石板 */
  floorFlagWorn: THREE.MeshStandardMaterial;
  /** 侧廊、门洞通道、井台一圈：大卵石 */
  floorCobble: THREE.MeshStandardMaterial;
  /** 墙脚泥土落叶带、坍塌处、地窖 */
  floorDirt: THREE.MeshStandardMaterial;
  /** 门房、礼拜堂正厅：室内石板 */
  floorInterior: THREE.MeshStandardMaterial;
  /** 梁、柱、井架、门框 */
  woodBeam: THREE.MeshStandardMaterial;
  /** 门扇、箱板、脚手架、栅板、护栏 */
  woodPlank: THREE.MeshStandardMaterial;
  /** 二层上廊、楼梯踏板 */
  woodFloorOld: THREE.MeshStandardMaterial;
  /** 井棚、外廊披檐、门楼 */
  roofShingle: THREE.MeshStandardMaterial;
  /** 山崖、地窖开凿岩壁 */
  rock: THREE.MeshStandardMaterial;
  /** 麻布、搭布、床品、地毯（布/旗行：roughness 0.92–1.0 + sheen、织纹、底部潮湿） */
  clothLinen: THREE.MeshStandardMaterial;
  /** 旗、挂毯（布/旗行：褪色酒红 + 徽记、破边、sheen） */
  clothBanner: THREE.MeshStandardMaterial;
}

const cache = new WeakMap<Materials, Variants>();

interface StoneOpts {
  floor: number; wet: number; desat: number; tint: [number, number, number];
  hs: number; ns: number; rough: number; band?: [number, number]; peel?: number;
}

/** 石材族：挂共享石材着色器 + 加载扫描贴图（去饱和/冷灰由 desat+tint 控制）。 */
function stoneMat(name: string, o: StoneOpts, pending: Promise<void>[]): THREE.MeshStandardMaterial {
  const fallback = blocks([120, 124, 130], 4, 2, 17); // 程序化兜底，保证首帧 USE_MAP 成立
  const mat = new THREE.MeshStandardMaterial({
    map: fallback.map, normalMap: fallback.normalMap, roughnessMap: fallback.roughnessMap,
    color: 0xffffff, roughness: o.rough, metalness: 0,
    normalScale: new THREE.Vector2(o.ns, o.ns),
  });
  const u = awUniforms(o.floor, o.wet, o.desat, o.tint, o.hs, o.band);
  if (o.peel) u.uAwPeel.value = o.peel;
  stoneShader(mat, u);
  enhance(mat, name, o.ns, pending);
  return mat;
}

/** 木族：旧橡色 + 纤维法线，加载扫描贴图。 */
function woodMat(name: string, color: number, rough: number, ns: number, pending: Promise<void>[]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0, normalScale: new THREE.Vector2(ns, ns),
  });
  weatheredWoodRoughness(mat);
  enhance(mat, name, ns, pending);
  return mat;
}

/** 取材质族。同一个 Materials 只建一次，所有调用方拿到同一批实例（Batch 按材质合批）。 */
export function variants(m: Materials): Variants {
  let v = cache.get(m);
  if (v) return v;
  const pending: Promise<void>[] = [];

  // —— 石墙族（冷灰，亮度互相 ±12% 内）——
  const wallRubble = m.stone; // 乱石幕墙：复用 castle_wall_varriation（已去饱和冷灰）
  const wallAshlar = stoneMat('medieval_blocks_03', { floor: 0, wet: 0.3, desat: 0.72, tint: [0.68, 0.72, 0.80], hs: 0.02, ns: 1.0, rough: 0.85, band: [2.2, 4.15] }, pending);
  // Worn cut stone rather than the granite scan's narrow, strongly ridged courses.
  const wallTrim = stoneMat('stone_pavers', { floor: 0, wet: 0.28, desat: 0.6, tint: [0.96, 0.99, 1.04], hs: 0.009, ns: 0.56, rough: 0.87, band: [2.2, 4.15] }, pending);
  // This local scan ships no height map. Keep real normal/AO but do not request a missing displacement file.
  const wallRough = stoneMat('rustic_stone_wall_02', { floor: 0, wet: 0.35, desat: 0.55, tint: [0.70, 0.74, 0.82], hs: 0, ns: 1.2, rough: 0.9, band: [0.5, 3.0] }, pending);
  const wallPlaster = stoneMat('grey_plaster', { floor: 0, wet: 0.2, desat: 0.6, tint: [0.46, 0.49, 0.55], hs: 0, ns: 0.5, rough: 0.9, peel: 1 }, pending);

  // —— 地面族 ——
  const floorFlag = m.flag; // 主路：monastery_stone_floor 不规则大石板 + 洼地积水
  const floorFlagWorn = stoneMat('stone_pavers', { floor: 1, wet: 0.48, desat: 0.6, tint: [1.06, 1.10, 1.18], hs: 0.012, ns: 0.8, rough: 0.88 }, pending);
  const floorCobble = stoneMat('cobblestone_large_01', { floor: 1, wet: 0.42, desat: 0.72, tint: [0.78, 0.82, 0.88], hs: 0, ns: 0.8, rough: 0.9 }, pending);
  const floorDirt = stoneMat('brown_mud_leaves_01', { floor: 1, wet: 0.3, desat: 0.35, tint: [0.55, 0.50, 0.44], hs: 0, ns: 0.8, rough: 0.95 }, pending);
  const floorInterior = stoneMat('worn_tile_floor', { floor: 1, wet: 0.3, desat: 0.4, tint: [1.08, 1.12, 1.20], hs: 0, ns: 1.0, rough: 0.8 }, pending);

  // Share the existing cellar earth scan/GPU texture. No new download, no second
  // rendering/decal pass. Keep a neutral texel while the asynchronous scan is loading.
  const unloadedDirtMap = floorDirt.map;
  const soilReady = Promise.all(pending);
  const bindHistory = (mat: THREE.MeshStandardMaterial, mode: 1 | 2) => {
    mat.defines = { ...mat.defines, AW_FLOOR_HISTORY: mode };
    const u = mat.userData.aw;
    u.uAwHumus = { value: u.uAwHeightMap.value };
    soilReady.then(() => {
      if (floorDirt.map && floorDirt.map !== unloadedDirtMap) u.uAwHumus.value = floorDirt.map;
    });
  };
  bindHistory(floorFlag, 1);
  bindHistory(floorInterior, 2);

  // —— 木族 ——
  const woodBeam = woodMat('medieval_wood', 0x8a7258, 0.82, 0.7, pending);
  const woodPlank = woodMat('weathered_planks', 0x9a8262, 0.8, 0.7, pending);
  const woodFloorOld = woodMat('wood_planks_dirt', 0x8a7258, 0.82, 0.6, pending);

  // —— 屋面 / 岩壁 ——
  const roofShingle = stoneMat('grey_roof_tiles', { floor: 0, wet: 0.25, desat: 0.25, tint: [0.32, 0.34, 0.37], hs: 0, ns: 0.9, rough: 0.85 }, pending);
  const rock = stoneMat('rock_face', { floor: 0, wet: 0.25, desat: 0.5, tint: [0.72, 0.76, 0.84], hs: 0, ns: 1.3, rough: 0.9 }, pending);

  v = {
    wallRubble, wallAshlar, wallTrim, wallRough, wallPlaster,
    floorFlag, floorFlagWorn, floorCobble, floorDirt, floorInterior,
    woodBeam, woodPlank, woodFloorOld, roofShingle, rock,
    // 织物族：复用 Materials 里的共享实例（props 不再各自 clone，保合批），参数已符合圣经布/旗行
    clothLinen: m.cloth, clothBanner: m.banner,
  };
  cache.set(m, v);
  trackPending(Promise.all(pending).then(() => undefined));
  return v;
}