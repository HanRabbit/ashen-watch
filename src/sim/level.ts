// 关卡数据：碰撞盒、门、导航图、交互点、亮区、楼梯与楼板。纯数据，不依赖渲染。
// 坐标：x 向东，z 向北（远离门房），y 向上，单位米。
// 三层：B1(−3) / 1F(0，礼拜堂+0.45) / 2F(+4)。礼拜堂正门朝西面向庭院（构图对齐 concept/03）。

export type DoorId = 'gatehouse' | 'gate' | 'chapelFront';
export type FloorId = 'B1' | '1F' | '2F';
export type Region =
  | 'gatehouse' | 'courtyard' | 'platform' | 'chapel'
  | 'cellar' | 'passage' | 'store'
  | 'walk' | 'bridge' | 'gallery';

export interface Box {
  x0: number; z0: number; x1: number; z1: number;
  /** 顶部高度。 */
  h: number;
  /** 底部高度（缺省 0）。碰撞/视线按实体竖向范围过滤。 */
  y0?: number;
  /** 是否遮挡视线。矮道具只挡路不挡视线。 */
  los: boolean;
  kind: 'wall' | 'prop' | 'slab';
  tag?: string;
}

export interface DoorDef {
  id: DoorId;
  box: Box;
  hinge: { x: number; z: number };
  axis: 'x' | 'z';
  label: string;
}

export interface NavNode { id: string; x: number; z: number; y: number; floor: FloorId; region: Region }
export interface NavEdge { a: string; b: string; door?: DoorId }

export type InteractId =
  | 'lantern' | 'board' | 'refuel' | 'hearth' | 'pot' | 'woodpile' | 'ghDoor' | 'bolt' | 'bell'
  | 'shelf' | 'lamp' | 'gate' | 'crate' | 'chapelFront' | 'flask' | 'chest' | 'cellar'
  | 'cot' | 'brazierChapel' | 'brazierSide';

export interface InteractDef {
  id: InteractId;
  x: number; y: number; z: number;
  floor: FloorId;
  ownDoor?: DoorId;
}

const W = (x0: number, z0: number, x1: number, z1: number, h = 5, tag?: string, y0?: number): Box =>
  ({ x0, z0, x1, z1, h, y0, los: true, kind: 'wall', tag });
const P = (x0: number, z0: number, x1: number, z1: number, h: number, tag: string, los = false, y0?: number): Box =>
  ({ x0, z0, x1, z1, h, y0, los, kind: 'prop', tag });
const SL = (x0: number, z0: number, x1: number, z1: number, y0: number, h: number): Box =>
  ({ x0, z0, x1, z1, h, y0, los: true, kind: 'slab' });

export const RAISED_Y = 0.45;
export const B1_Y = -3;
export const F2_Y = 4;

/** 室内净尺寸：门房 6×8、庭院 20×28、礼拜堂 17×11（转 90°，正门朝西）。 */
export const AREAS = {
  gatehouse: { x0: -3, z0: -8, x1: 3, z1: 0 },
  courtyard: { x0: -10, z0: 0.5, x1: 10, z1: 28.5 },
  platform: { x0: 10.5, z0: 11, x1: 13.5, z1: 22 },
  chapel: { x0: 13.5, z0: 11, x1: 30.5, z1: 22 },
  cellar: { x0: 2.5, z0: 6.5, x1: 10.6, z1: 15.5 },
  passage: { x0: 10.6, z0: 9.0, x1: 14.0, z1: 13.0 },
  store: { x0: 13.0, z0: 11.5, x1: 24.0, z1: 21.9 },
  eastWalk: { x0: 8.4, z0: 2.5, x1: 10.0, z1: 28.5 },
  northWalk: { x0: -10.0, z0: 27.0, x1: 10.0, z1: 28.5 },
  westWalk: { x0: -10.0, z0: 2.5, x1: -8.4, z1: 28.5 },
  bridge: { x0: 8.4, z0: 19.5, x1: 13.5, z1: 21.0 },
  gallery: { x0: 13.5, z0: 20.3, x1: 24.0, z1: 22.0 },
} as const;

export const WALLS: Box[] = [
  // —— 门房 ——
  W(-3.5, -8.5, 3.5, -8, 3.6, 'gh'), W(-3.5, -8.5, -3, 0.5, 3.6, 'gh'), W(3, -8.5, 3.5, 0.5, 3.6, 'gh'),
  // —— 庭院南墙（门房门洞 x[-0.8,0.8]；装饰铁栅在 x5.5 墙面，不开洞）——
  W(-10.5, 0, -0.8, 0.5, 4.2), W(0.8, 0, 10.5, 0.5, 4.2),
  // —— 庭院西/北墙：降为 h4，上方步道 + 垛墙 ——
  W(-10.5, 0, -10, 29, 4), W(-10.5, 28.5, 10.5, 29, 4),
  // —— 庭院东墙：南北两段实墙，中段 z[11,22] 敞开券廊（墩宽 0.5）——
  W(10, 0, 10.5, 11, 4), W(10, 22, 10.5, 29, 4),
  W(10, 11, 10.5, 11.6, 4, 'pier'), W(10, 14.0, 10.5, 14.6, 4, 'pier'),
  W(10, 18.4, 10.5, 19.0, 4, 'pier'), W(10, 21.4, 10.5, 22.0, 4, 'pier'),
  // 垛墙（步道外侧护挡，y4..5.05）
  W(-10.5, 0, -10, 29, 5.05, 'parapet', 4), W(-10.5, 28.5, 10.5, 29, 5.05, 'parapet', 4),
  W(10, 0, 10.5, 19.5, 5.05, 'parapet', 4), W(10, 21, 10.5, 29, 5.05, 'parapet', 4),
  // —— 门前平台栏墙（南北边）——
  W(10.5, 10.5, 13.5, 11, 1.2, 'balustrade'), W(10.5, 22, 13.5, 22.5, 1.2, 'balustrade'),
  // —— 礼拜堂（转 90°）：西墙正门洞 z[15.6,17.4] + 桥洞 z[19.5,21] y4..6.3 ——
  W(13, 11, 13.5, 15.6, 7), W(13, 17.4, 13.5, 19.5, 7), W(13, 21.0, 13.5, 22, 7),
  W(30.5, 10.5, 31, 22.5, 7), W(13.5, 10.5, 31, 11, 7), W(13.5, 22, 31, 22.5, 7),
  // —— 门厅隔墙（x[17.5,17.9]，开口 z[11.7,13.7]；上廊跨越段拆分）——
  W(17.5, 11, 17.9, 11.7, 4.5), W(17.5, 13.7, 17.9, 20.3, 4.5),
  W(17.5, 20.3, 17.9, 22, 3.7, 'partitionLow'),
  // —— 坍塌侧廊瓦砾（堵死，不可通行）——
  W(10.5, 2, 13, 11, 2.5, 'rubbleFill'),
  // —— B1 地窖 ——
  W(2.1, 6.1, 11.0, 6.5, -0.6, 'cellar', -3), W(2.1, 15.5, 11.0, 15.9, -0.6, 'cellar', -3),
  W(2.1, 6.1, 2.5, 15.9, -0.6, 'cellar', -3),
  W(10.6, 6.1, 11.0, 9.0, -0.6, 'cellar', -3), W(10.6, 13.0, 11.0, 15.9, -0.6, 'cellar', -3),
  // —— B1 内侧通道 ——
  W(10.6, 8.6, 14.0, 9.0, -0.8, 'passage', -3), W(10.6, 13.0, 14.0, 13.4, -0.8, 'passage', -3),
  // —— B1 旧储藏室 ——
  W(12.6, 13.0, 13.0, 21.9, 0.15, 'store', -3), W(13.0, 11.1, 24.4, 11.5, 0.15, 'store', -3),
  W(13.6, 21.9, 24.4, 22.3, 0.15, 'store', -3), W(24.0, 11.1, 24.4, 22.3, 0.15, 'store', -3),
  // —— 2F 护栏（锻铁/栏板，los=false 不挡视线）——
  W(8.4, 2.5, 8.5, 27.0, 5.05, 'rail', 4), W(-8.5, 2.5, -8.4, 27.0, 5.05, 'rail', 4),
  W(-8.4, 26.9, 8.4, 27.0, 5.05, 'rail', 4), W(-10, 2.4, -8.4, 2.5, 5.05, 'rail', 4),
  W(10, 19.35, 13.5, 19.5, 5.05, 'rail', 4), W(10, 21.0, 13.5, 21.15, 5.05, 'rail', 4),
  W(15.5, 20.3, 24.0, 20.4, 5.05, 'rail', 4),
  // —— S3 外梯内侧分级护墙 / 外侧铁栏 ——
  ...[0, 1, 2, 3].map((i) => W(3.8 + i * 1.2, 2.3, 5.0 + i * 1.2, 2.5, (i + 1) * 1.0 + 1, 'stairGuard')),
  W(3.8, 0, 9.4, 0.5, 5.1, 'stairRail', 4.2),
  // —— S1 洞口护墙（1F）——
  W(4.6, 8.8, 10.3, 9.0, 1.05, 'holeGuard'), W(4.6, 10.8, 10.3, 11.0, 1.05, 'holeGuard'),
  W(10.0, 8.8, 10.3, 11.0, 1.05, 'holeGuard'),
  // —— S2 洞口护墙（门厅）——
  W(14.0, 17.5, 14.2, 21.5, 1.5, 'holeGuard', 0.45), W(16.0, 17.5, 16.2, 20.5, 1.5, 'holeGuard', 0.45),
  W(14.2, 17.3, 16.0, 17.5, 1.5, 'holeGuard', 0.45),
];

export const PROPS: Box[] = [
  P(-3, -5.6, -2.2, -3.2, 2.4, 'hearth', true),
  P(-2.75, -2.85, -2.15, -2.25, 0.8, 'pot'),
  P(-3, -7, -2.2, -5.9, 0.7, 'woodpile'),
  P(2.2, -5.6, 3, -3.4, 0.95, 'bench'),
  P(-0.4, -8, 1.6, -7.1, 0.5, 'cot'),
  P(1.5, -6.6, 2.1, -6.0, 0.75, 'stool'),
  P(-10, 5, -9.2, 7.4, 1.9, 'shelf'),
  P(8.6, 12.4, 9.8, 13.6, 1.1, 'crates'),
  P(-8.6, 20.4, -7.4, 21.6, 0.9, 'rubble'),
  P(-8, 26.6, -5.6, 28.2, 0.9, 'barrels'),
  P(11.6, 20.2, 12.6, 21.0, 0.8, 'crate', false, RAISED_Y),
  P(14.4, 12.6, 15.2, 13.4, 0.86, 'flaskTable', false, B1_Y),
  P(28.7, 15.1, 30, 17.9, 1.1, 'altar', false, RAISED_Y),
  // 长凳：两列三排，中央过道 z[15.5,17.5] 保持 2 m
  ...[20, 21.8, 23.6].flatMap((x) => [
    P(x, 13.5, x + 0.6, 15.5, 0.9, 'pew', false, RAISED_Y),
    P(x, 17.5, x + 0.6, 20.5, 0.9, 'pew', false, RAISED_Y),
  ]),
  P(26.7, 18.2, 27.3, 18.8, 1.0, 'brazier', false, RAISED_Y),
  P(-9.5, 13.7, -8.9, 14.3, 1.0, 'brazier', false, F2_Y),
  // 庭院掩体
  P(-4.8, 8.2, -2.2, 9.6, 1.6, 'cart', true),
  P(-8.2, 17.0, -6.4, 18.2, 2.3, 'scaffold', true),
  P(6.8, 3.0, 8.4, 4.6, 1.9, 'crateStack', true),
  P(-5.6, 23.6, -3.6, 24.1, 2.1, 'wallStub', true),
  // B1 石墩 / 储藏架
  P(4.3, 7.3, 4.9, 7.9, -0.6, 'pier', true, B1_Y),
  P(4.3, 12.9, 4.9, 13.5, -0.6, 'pier', true, B1_Y),
  P(14.2, 15.0, 14.7, 16.2, 0.0, 'shelfB1', false, B1_Y),
  P(14.2, 17.0, 14.7, 18.2, 0.0, 'shelfB1', false, B1_Y),
];

/** 圆柱障碍（井台 + 礼拜堂柱列）。 */
export interface Cylinder { x: number; z: number; r: number; losR: number; y0: number; h: number }
export const WELL: Cylinder = { x: 3, z: 13, r: 1.3, losR: 1.05, y0: 0, h: 2.6 };
export const COLUMNS: Cylinder[] = [
  { x: 22.7, z: 13.8, r: 0.4, losR: 0.4, y0: RAISED_Y, h: 6.7 },
  { x: 22.7, z: 19.2, r: 0.4, losR: 0.4, y0: RAISED_Y, h: 6.7 },
];

export const DOORS: Record<DoorId, DoorDef> = {
  gatehouse: { id: 'gatehouse', box: W(-0.8, 0.12, 0.8, 0.38, 2.6), hinge: { x: -0.8, z: 0.25 }, axis: 'x', label: '门房门' },
  gate: { id: 'gate', box: W(23.9, 20.4, 24.1, 22.0, 6.4, undefined, 4), hinge: { x: 24.0, z: 20.4 }, axis: 'z', label: '楼梯栅门' },
  chapelFront: { id: 'chapelFront', box: W(13.12, 15.6, 13.38, 17.4, 3.65, undefined, RAISED_Y), hinge: { x: 13.25, z: 15.6 }, axis: 'z', label: '礼拜堂正门' },
};

// —— 楼梯（ENV-09）：坡面 + 平台，连续改变高度 ——
export interface StairRun { x0: number; z0: number; x1: number; z1: number; axis: 'x' | 'z'; from: number; to: number }
export interface StairDef {
  id: string;
  runs: StairRun[];
  landings: { x0: number; z0: number; x1: number; z1: number; y: number }[];
  midY: number; lowFloor: FloorId; highFloor: FloorId;
  a: string; b: string;
}
export const STAIRS: StairDef[] = [
  {
    id: 'S1', runs: [{ x0: 4.6, z0: 9.0, x1: 10.0, z1: 10.8, axis: 'x', from: 0, to: -3 }],
    landings: [], midY: -1.5, lowFloor: 'B1', highFloor: '1F', a: 'c_s1top', b: 'b_land',
  },
  {
    id: 'S2',
    runs: [{ x0: 14.2, z0: 17.5, x1: 16.0, z1: 21.5, axis: 'z', from: -3, to: 0.45 }],
    landings: [],
    midY: 0.4, lowFloor: 'B1', highFloor: '1F', a: 's2top', b: 'b_s2b',
  },
  {
    id: 'S3', runs: [{ x0: 3.8, z0: 0.5, x1: 9.4, z1: 2.3, axis: 'x', from: 0, to: 4 }],
    landings: [{ x0: 9.0, z0: 0.5, x1: 10.0, z1: 2.5, y: 4 }],
    midY: 2, lowFloor: '1F', highFloor: '2F', a: 'c_s3bot', b: 'w_s3t',
  },
  {
    id: 'S4', runs: [{ x0: 24.6, z0: 20.4, x1: 29.6, z1: 22.0, axis: 'x', from: 0.45, to: 4 }],
    landings: [{ x0: 24.0, z0: 20.4, x1: 24.6, z1: 22.0, y: 4 }],
    midY: 2.2, lowFloor: '1F', highFloor: '2F', a: 'n_s4bot', b: 'g_land',
  },
];

/** 梯体（坡面下方的实体，分级盒近似），阻止从下方走入梯段。 */
export const STAIR_MASS: Box[] = [];
for (const s of STAIRS) {
  for (const r of s.runs) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t1 = (i + 1) / n;
      const yTop = r.from + (r.to - r.from) * t1 - 0.05;
      const yBot = Math.min(r.from, r.to);
      if (yTop <= yBot + 0.05) continue;
      if (r.axis === 'x') {
        const xa = r.x0 + (r.x1 - r.x0) * (i / n), xb = r.x0 + (r.x1 - r.x0) * t1;
        STAIR_MASS.push({ x0: xa, z0: r.z0, x1: xb, z1: r.z1, h: yTop, y0: yBot - 0.5, los: true, kind: 'wall', tag: 'stairMass' });
      } else {
        const za = r.z0 + (r.z1 - r.z0) * (i / n), zb = r.z0 + (r.z1 - r.z0) * t1;
        STAIR_MASS.push({ x0: r.x0, z0: za, x1: r.x1, z1: zb, h: yTop, y0: yBot - 0.5, los: true, kind: 'wall', tag: 'stairMass' });
      }
    }
  }
  for (const l of s.landings) {
    STAIR_MASS.push({ x0: l.x0, z0: l.z0, x1: l.x1, z1: l.z1, h: l.y - 0.05, y0: l.y - 3.5, los: true, kind: 'wall', tag: 'stairMass' });
  }
}

// —— 楼板（挡视线 / 镜头）——
export const SLABS: Box[] = [
  // 庭院地面（挖 S1 洞）
  SL(-10.5, 0, 4.6, 29, -0.3, 0), SL(4.6, 0, 10.5, 9.0, -0.3, 0),
  SL(4.6, 10.8, 10.5, 29, -0.3, 0), SL(10.0, 9.0, 10.5, 10.8, -0.3, 0),
  // 礼拜堂 + 平台地面（挖 S2 洞）
  SL(13, 10.5, 14.2, 22.5, 0.15, RAISED_Y), SL(14.2, 10.5, 16, 17.5, 0.15, RAISED_Y),
  SL(14.2, 21.5, 16, 22.5, 0.15, RAISED_Y), SL(16, 10.5, 31, 22.5, 0.15, RAISED_Y),
  SL(10.5, 11, 13, 22, 0.15, RAISED_Y),
  // 2F deck
  SL(8.4, 2.5, 10.5, 28.5, 3.7, F2_Y), SL(-10.5, 26.9, 10.5, 29, 3.7, F2_Y),
  SL(-10.5, 2.5, -8.4, 28.5, 3.7, F2_Y), SL(8.4, 19.5, 13.5, 21.0, 3.7, F2_Y),
  SL(13.5, 20.3, 24.0, 22.0, 3.7, F2_Y),
];
// —— 导航节点 ——
const N = (id: string, x: number, z: number, y: number, floor: FloorId, region: Region): NavNode => ({ id, x, z, y, floor, region });
export const NODES: NavNode[] = [
  N('gh_mid', 0, -5.5, 0, '1F', 'gatehouse'), N('gh_in', 0, -2.2, 0, '1F', 'gatehouse'),
  N('c_s', 0, 2.2, 0, '1F', 'courtyard'), N('c_sw', -6, 5, 0, '1F', 'courtyard'),
  N('c_se', 6, 5.5, 0, '1F', 'courtyard'), N('c_w', -6, 14, 0, '1F', 'courtyard'),
  N('c_wellw', 0.8, 13, 0, '1F', 'courtyard'), N('c_welle', 5.2, 13, 0, '1F', 'courtyard'),
  N('c_e', 7, 16.5, 0, '1F', 'courtyard'), N('c_arc', 8.6, 16.5, 0, '1F', 'courtyard'),
  N('c_nw', -6, 23, 0, '1F', 'courtyard'), N('c_n', 0, 23, 0, '1F', 'courtyard'),
  N('c_ne', 6.5, 23, 0, '1F', 'courtyard'), N('c_s1top', 4.0, 9.9, 0, '1F', 'courtyard'),
  N('c_s3bot', 3.4, 1.4, 0, '1F', 'courtyard'),
  N('p_m', 12, 16.5, RAISED_Y, '1F', 'platform'), N('p_d', 12.6, 16.5, RAISED_Y, '1F', 'platform'),
  N('v_d', 14.4, 16.5, RAISED_Y, '1F', 'chapel'), N('v_o', 15.8, 16.5, RAISED_Y, '1F', 'chapel'),
  N('v_s', 16.5, 12.7, RAISED_Y, '1F', 'chapel'), N('v_s2', 16.8, 21.0, RAISED_Y, '1F', 'chapel'),
  N('v_e', 16.8, 16.5, RAISED_Y, '1F', 'chapel'), N('s2top', 15.1, 21.4, 0.36, '1F', 'chapel'),
  N('n_x', 18.8, 12.7, RAISED_Y, '1F', 'chapel'), N('n_w', 18.9, 16.5, RAISED_Y, '1F', 'chapel'),
  N('n_e', 25.6, 16.5, RAISED_Y, '1F', 'chapel'), N('n_c', 24, 16.5, RAISED_Y, '1F', 'chapel'),
  N('n_alt', 28.0, 16.5, RAISED_Y, '1F', 'chapel'),
  N('n_s1', 20, 12.5, RAISED_Y, '1F', 'chapel'), N('n_s2', 24, 12.5, RAISED_Y, '1F', 'chapel'), N('n_s3', 25.4, 12.5, RAISED_Y, '1F', 'chapel'),
  N('n_n1', 19.2, 21.2, RAISED_Y, '1F', 'chapel'), N('n_n2', 24, 21.2, RAISED_Y, '1F', 'chapel'), N('n_n3', 25.4, 21.2, RAISED_Y, '1F', 'chapel'),
  N('n_s4bot', 29.0, 21.2, RAISED_Y, '1F', 'chapel'),
  N('b_land', 10.2, 9.9, B1_Y, 'B1', 'cellar'), N('b_cs', 5.5, 7.6, B1_Y, 'B1', 'cellar'),
  N('b_cn', 5.5, 13.2, B1_Y, 'B1', 'cellar'), N('b_pw', 11.5, 10.3, B1_Y, 'B1', 'passage'),
  N('b_pe', 12.3, 10.3, B1_Y, 'B1', 'passage'), N('b_pe2', 12.5, 12.2, B1_Y, 'B1', 'passage'), N('b_pg', 13.6, 12.0, B1_Y, 'B1', 'store'), N('b_sw0', 16.0, 12.2, B1_Y, 'B1', 'store'), N('b_sw', 16.2, 14.5, B1_Y, 'B1', 'store'),
  N('b_se', 20, 16, B1_Y, 'B1', 'store'), N('b_s2b', 15.1, 17.5, B1_Y, 'B1', 'store'),
  N('w_s3t', 9.2, 1.5, F2_Y, '2F', 'walk'), N('w_e1', 9.2, 6, F2_Y, '2F', 'walk'),
  N('w_e2', 9.2, 12, F2_Y, '2F', 'walk'), N('w_br', 9.2, 20.25, F2_Y, '2F', 'walk'),
  N('w_e3', 9.2, 24, F2_Y, '2F', 'walk'), N('w_ne', 9.2, 27.7, F2_Y, '2F', 'walk'),
  N('w_n', 0, 27.7, F2_Y, '2F', 'walk'), N('w_nw', -9.2, 27.7, F2_Y, '2F', 'walk'),
  N('w_w1', -9.2, 20, F2_Y, '2F', 'walk'), N('w_w2', -9.2, 14, F2_Y, '2F', 'walk'),
  N('w_w3', -9.2, 8, F2_Y, '2F', 'walk'), N('w_ws', -9.2, 3, F2_Y, '2F', 'walk'),
  N('g_br', 11.5, 20.25, F2_Y, '2F', 'bridge'), N('g_brx', 13.2, 20.25, F2_Y, '2F', 'bridge'), N('g_gal', 16, 21.15, F2_Y, '2F', 'gallery'),
  N('g_gal2', 22.5, 21.15, F2_Y, '2F', 'gallery'), N('g_land', 24.5, 21.15, F2_Y, '2F', 'gallery'),
];

export const EDGES: NavEdge[] = [
  { a: 'gh_mid', b: 'gh_in' }, { a: 'gh_in', b: 'c_s', door: 'gatehouse' },
  { a: 'c_s', b: 'c_sw' }, { a: 'c_s', b: 'c_se' }, { a: 'c_s', b: 'c_s3bot' },
  { a: 'c_sw', b: 'c_w' },

  { a: 'c_w', b: 'c_wellw' }, { a: 'c_w', b: 'c_nw' },
  { a: 'c_wellw', b: 'c_nw' }, { a: 'c_welle', b: 'c_e' },
  { a: 'c_e', b: 'c_arc' }, { a: 'c_e', b: 'c_ne' }, { a: 'c_arc', b: 'p_m' },
  { a: 'c_nw', b: 'c_n' }, { a: 'c_n', b: 'c_ne' }, { a: 'c_ne', b: 'c_arc' },
  { a: 'p_m', b: 'p_d' }, { a: 'p_d', b: 'v_d', door: 'chapelFront' },
  { a: 'v_d', b: 'v_o' }, { a: 'v_o', b: 'v_s' }, { a: 'v_o', b: 'v_e' }, { a: 'v_e', b: 'v_s2' }, { a: 'v_s2', b: 's2top' },
  { a: 'v_s', b: 'n_x' }, { a: 'n_x', b: 'n_w' }, { a: 'n_w', b: 'n_c' },
  { a: 'n_x', b: 'n_s1' }, { a: 'n_s1', b: 'n_s2' }, { a: 'n_s2', b: 'n_s3' }, { a: 'n_s3', b: 'n_e' },
  { a: 'n_e', b: 'n_c' }, { a: 'n_c', b: 'n_alt' }, { a: 'n_e', b: 'n_alt' },
  { a: 'n_n1', b: 'n_w' }, { a: 'n_n1', b: 'n_n2' }, { a: 'n_n2', b: 'n_n3' }, { a: 'n_n3', b: 'n_e' },
  { a: 'n_n2', b: 'n_s4bot' },
  // 楼梯跨层边
  { a: 'c_s1top', b: 'b_land' }, { a: 's2top', b: 'b_s2b' },
  { a: 'c_s3bot', b: 'w_s3t' }, { a: 'n_s4bot', b: 'g_land' },
  // B1 环
  { a: 'b_land', b: 'b_cs' }, { a: 'b_land', b: 'b_cn' }, { a: 'b_cs', b: 'b_cn' },
  { a: 'b_land', b: 'b_pw' }, { a: 'b_pw', b: 'b_pe' }, { a: 'b_pe', b: 'b_pe2' }, { a: 'b_pe2', b: 'b_pg' }, { a: 'b_pg', b: 'b_sw0' }, { a: 'b_sw0', b: 'b_sw' },
  { a: 'b_sw', b: 'b_se' }, { a: 'b_se', b: 'b_s2b' }, { a: 'b_sw', b: 'b_s2b' },
  // 2F 环 + 桥 + 上廊
  { a: 'w_s3t', b: 'w_e1' }, { a: 'w_e1', b: 'w_e2' }, { a: 'w_e2', b: 'w_br' },
  { a: 'w_br', b: 'w_e3' }, { a: 'w_e3', b: 'w_ne' }, { a: 'w_ne', b: 'w_n' },
  { a: 'w_n', b: 'w_nw' }, { a: 'w_nw', b: 'w_w1' }, { a: 'w_w1', b: 'w_w2' },
  { a: 'w_w2', b: 'w_w3' }, { a: 'w_w3', b: 'w_ws' },
  { a: 'w_br', b: 'g_br' }, { a: 'g_br', b: 'g_brx' }, { a: 'g_brx', b: 'g_gal' }, { a: 'g_gal', b: 'g_gal2' },
  { a: 'g_gal2', b: 'g_land', door: 'gate' },
];

export const INTERACTS: InteractDef[] = [
  { id: 'lantern', x: 1.8, y: 0.95, z: -6.3, floor: '1F' },
  { id: 'board', x: 2.95, y: 1.5, z: -1.6, floor: '1F' },
  { id: 'refuel', x: 2.2, y: 1.0, z: -4.5, floor: '1F' },
  { id: 'hearth', x: -2.2, y: 0.9, z: -4.4, floor: '1F' },
  { id: 'pot', x: -2.45, y: 0.85, z: -2.55, floor: '1F' },
  { id: 'woodpile', x: -2.2, y: 0.6, z: -6.45, floor: '1F' },
  { id: 'ghDoor', x: -0.35, y: 1.2, z: 0.25, floor: '1F', ownDoor: 'gatehouse' },
  { id: 'bolt', x: 0.5, y: 1.25, z: -0.1, floor: '1F', ownDoor: 'gatehouse' },
  { id: 'bell', x: 2.2, y: 1.6, z: 1.1, floor: '1F' },
  { id: 'shelf', x: -9.2, y: 1.1, z: 6.2, floor: '1F' },
  { id: 'lamp', x: -5, y: 1.9, z: 28.65, floor: '1F' },
  { id: 'gate', x: 24.0, y: 5.2, z: 21.2, floor: '2F', ownDoor: 'gate' },
  { id: 'crate', x: 12.1, y: 0.9 + RAISED_Y, z: 20.6, floor: '1F' },
  { id: 'chapelFront', x: 13.25, y: 1.2 + RAISED_Y, z: 16.5, floor: '1F', ownDoor: 'chapelFront' },
  { id: 'flask', x: 14.8, y: -2.0, z: 13.0, floor: 'B1' },
  { id: 'chest', x: 28.4, y: 1.25 + RAISED_Y, z: 16.5, floor: '1F' },
  { id: 'cellar', x: 5.9, y: -1.8, z: 6.85, floor: 'B1' },
  { id: 'cot', x: 0.6, y: 0.5, z: -7.3, floor: '1F' },
  { id: 'brazierChapel', x: 27, y: 1.0 + RAISED_Y, z: 18.5, floor: '1F' },
  { id: 'brazierSide', x: -9.2, y: 5.0, z: 14, floor: '2F' },
];

export const SPAWN = { x: 0, z: -5.5, yaw: 0 };
export const BELL_POS = { x: 2.2, z: 1.1 };
export const LAMP_POS = { x: -5, y: 2.7, z: 28.8 };
export const BRAZIER_POS = { chapel: { x: 27, y: 1.0 + RAISED_Y, z: 18.5 }, side: { x: -9.2, y: F2_Y + 1.0, z: 14 } };

export const GHOST_SPAWN = {
  grey: { x: -6, y: 0, z: 26.2, yaw: Math.PI, floor: '1F' as FloorId },
  wraith: { x: 5.5, y: B1_Y, z: 7.6, yaw: 0, floor: 'B1' as FloorId },
};
export const PATROL = {
  grey: ['c_n', 'c_ne', 'c_arc', 'p_m', 'c_se', 'c_s', 'c_sw', 'c_w', 'c_wellw', 'c_nw'],
  wraith: ['b_cs', 'b_cn', 'b_land', 'b_pw', 'b_pe', 'b_sw', 'b_se', 'b_s2b', 'v_s2', 'v_o', 'n_s1', 'n_alt'],
};

export function inArea(a: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean {
  return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
}

/** 2D 区域（音频 / 暖区用）。 */
export function regionAt(x: number, z: number): Region {
  if (z < 0.25 && x > -3.5 && x < 3.5) return 'gatehouse';
  if (x >= 13.25 && z >= 10.5 && z <= 22.5) return 'chapel';
  if (x > 10.25 && z >= 11 && z <= 22) return 'platform';
  return 'courtyard';
}

export function regionAt3(x: number, z: number, floor: FloorId): Region {
  if (floor === 'B1') {
    if (inArea(AREAS.cellar, x, z)) return 'cellar';
    if (inArea(AREAS.passage, x, z)) return 'passage';
    return 'store';
  }
  if (floor === '2F') {
    if (inArea(AREAS.gallery, x, z)) return 'gallery';
    if (inArea(AREAS.bridge, x, z)) return 'bridge';
    return 'walk';
  }
  return regionAt(x, z);
}

// —— 支撑面（地面 + 坡面 + 平台）——
interface Surface { x0: number; z0: number; x1: number; z1: number; y: number; floor: FloorId }
const GROUND: Surface[] = [
  // 1F 庭院（挖 S1 洞）
  { x0: -10.5, z0: 0, x1: 4.6, z1: 29, y: 0, floor: '1F' },
  { x0: 4.6, z0: 0, x1: 10.5, z1: 9.0, y: 0, floor: '1F' },
  { x0: 4.6, z0: 10.8, x1: 10.5, z1: 29, y: 0, floor: '1F' },
  { x0: -3.5, z0: -8.5, x1: 3.5, z1: 0, y: 0, floor: '1F' },
  // 1F 平台 + 礼拜堂（挖 S2 洞）；平台西侧台阶用坡面
  { x0: 11.4, z0: 11, x1: 13.5, z1: 22, y: RAISED_Y, floor: '1F' },
  { x0: 13, z0: 10.5, x1: 14.2, z1: 22.5, y: RAISED_Y, floor: '1F' },
  { x0: 14.2, z0: 10.5, x1: 16, z1: 17.5, y: RAISED_Y, floor: '1F' },
  { x0: 14.2, z0: 21.5, x1: 16, z1: 22.5, y: RAISED_Y, floor: '1F' },
  { x0: 16, z0: 10.5, x1: 31, z1: 22.5, y: RAISED_Y, floor: '1F' },
  // B1
  { x0: 2.5, z0: 6.5, x1: 10.6, z1: 15.5, y: B1_Y, floor: 'B1' },
  { x0: 10.6, z0: 9.0, x1: 14.0, z1: 13.0, y: B1_Y, floor: 'B1' },
  { x0: 13.0, z0: 11.5, x1: 24.0, z1: 21.9, y: B1_Y, floor: 'B1' },
  // 2F deck
  { x0: 8.4, z0: 2.5, x1: 10.0, z1: 28.5, y: F2_Y, floor: '2F' },
  { x0: -10.0, z0: 27.0, x1: 10.0, z1: 28.5, y: F2_Y, floor: '2F' },
  { x0: -10.0, z0: 2.5, x1: -8.4, z1: 28.5, y: F2_Y, floor: '2F' },
  { x0: 8.4, z0: 19.5, x1: 13.5, z1: 21.0, y: F2_Y, floor: '2F' },
  { x0: 13.5, z0: 20.3, x1: 24.0, z1: 22.0, y: F2_Y, floor: '2F' },
];
// 平台西侧台阶坡面（x10.5→11.4 升 0.45）
const STEP_RAMP: Surface = { x0: 10.5, z0: 11, x1: 11.4, z1: 22, y: 0, floor: '1F' };

function rampY(r: StairRun, x: number, z: number): number {
  const t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
  return r.from + (r.to - r.from) * Math.max(0, Math.min(1, t));
}
function inRect(s: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean {
  return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
}

/** 该点所有候选支撑面（地面 / 坡面 / 平台）。 */
export function surfacesAt(x: number, z: number): { y: number; floor: FloorId }[] {
  const out: { y: number; floor: FloorId }[] = [];
  for (const g of GROUND) if (inRect(g, x, z)) out.push({ y: g.y, floor: g.floor });
  if (inRect(STEP_RAMP, x, z)) out.push({ y: ((x - 10.5) / 0.9) * RAISED_Y, floor: '1F' });
  for (const s of STAIRS) {
    for (const r of s.runs) if (inRect(r, x, z)) {
      const y = rampY(r, x, z);
      out.push({ y, floor: y > s.midY ? s.highFloor : s.lowFloor });
    }
    for (const l of s.landings) if (inRect(l, x, z)) out.push({ y: l.y, floor: l.y > s.midY ? s.highFloor : s.lowFloor });
  }
  return out;
}

/** 支撑高度：取不高于 y+0.5（可跨步上限）的最高面；无合法面返回 null（不可进入）。 */
export function supportY(x: number, z: number, y: number): { y: number; floor: FloorId } | null {
  let best: { y: number; floor: FloorId } | null = null;
  for (const s of surfacesAt(x, z)) {
    if (s.y > y + 0.5) continue;
    if (!best || s.y > best.y) best = s;
  }
  return best;
}

/** 1F 地面高度（渲染兜底 / 旧调用兼容）。 */
export function groundY(x: number, z: number): number {
  if (x >= 13 && z >= 10.5 && z <= 22.5) return RAISED_Y;
  if (x >= 11.4 && z >= 11 && z <= 22) return RAISED_Y;
  if (x >= 10.5 && x < 11.4 && z >= 11 && z <= 22) return ((x - 10.5) / 0.9) * RAISED_Y;
  return 0;
}

/** 天花高度（镜头避障）。开敞处返回 +Infinity。 */
export function ceilingY(x: number, z: number, floor: FloorId): number {
  if (floor === 'B1') {
    if (inArea(AREAS.cellar, x, z)) return -0.6;
    if (inArea(AREAS.passage, x, z)) return -0.8;
    if (inArea(AREAS.store, x, z)) return 0.15;
    return -0.6;
  }
  if (floor === '2F') {
    if (inArea(AREAS.gallery, x, z)) return 9.3;
    return Infinity;
  }
  const r = regionAt(x, z);
  if (r === 'gatehouse') return 3.25;
  if (r === 'chapel') return 9.3;
  return Infinity;
}

/** 该 (x,z) 可走的楼层集合（导航终点楼层推断用）。 */
export function floorCandidates(x: number, z: number): FloorId[] {
  const set = new Set<FloorId>();
  for (const s of surfacesAt(x, z)) set.add(s.floor);
  return [...set];
}
