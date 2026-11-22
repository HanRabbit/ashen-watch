// 材质族（美术圣经 5.1）：按区域选用的共享材质，名字是各代理共用的契约，不得自建同类材质。
// 现在先回退到 materials.ts 里的基础材质；贴图、参数与世界空间去重复由 env 代理实现。
import * as THREE from 'three';
import { Materials } from './materials';

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
}

const cache = new WeakMap<Materials, Variants>();

/** 取材质族。同一个 Materials 只建一次，所有调用方拿到同一批实例（Batch 按材质合批）。 */
export function variants(m: Materials): Variants {
  let v = cache.get(m);
  if (!v) {
    v = {
      wallRubble: m.stone, wallAshlar: m.stone, wallTrim: m.stoneDark, wallRough: m.stoneDark, wallPlaster: m.stone,
      floorFlag: m.flag, floorFlagWorn: m.flag, floorCobble: m.flag, floorDirt: m.gravel, floorInterior: m.flag,
      woodBeam: m.wood, woodPlank: m.wood, woodFloorOld: m.woodFloor, roofShingle: m.roof, rock: m.stoneDark,
    };
    cache.set(m, v);
  }
  return v;
}
