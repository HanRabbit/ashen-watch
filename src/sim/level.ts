// 关卡数据：碰撞盒、门、导航图、交互点与亮区。纯数据，不依赖渲染。
// 坐标：x 向东，z 向北（远离门房），y 向上，单位米。

export type DoorId = 'gatehouse' | 'gate' | 'chapelFront' | 'chapelSide';
export type Region = 'gatehouse' | 'courtyard' | 'porch' | 'chapel' | 'side';

export interface Box {
  x0: number; z0: number; x1: number; z1: number;
  /** 顶部高度，仅供渲染与镜头使用。 */
  h: number;
  /** 是否遮挡视线。矮道具只挡路不挡视线。 */
  los: boolean;
  kind: 'wall' | 'prop';
  tag?: string;
}

export interface DoorDef {
  id: DoorId;
  box: Box;
  /** 枢轴位置与门扇方向，渲染用。 */
  hinge: { x: number; z: number };
  axis: 'x' | 'z';
  label: string;
}

export interface NavNode { id: string; x: number; z: number; region: Region }
export interface NavEdge { a: string; b: string; door?: DoorId }

export type InteractId =
  | 'lantern' | 'board' | 'refuel' | 'hearth' | 'pot' | 'woodpile' | 'ghDoor' | 'bolt' | 'bell'
  | 'shelf' | 'lamp' | 'gate' | 'crate' | 'chapelFront' | 'flask' | 'chest' | 'cellar'
  | 'cot' | 'brazierChapel' | 'brazierSide';

export interface InteractDef {
  id: InteractId;
  x: number; y: number; z: number;
  /** 判定可见性时忽略的门（门自身）。 */
  ownDoor?: DoorId;
}

const W = (x0: number, z0: number, x1: number, z1: number, h = 5, tag?: string): Box =>
  ({ x0, z0, x1, z1, h, los: true, kind: 'wall', tag });
const P = (x0: number, z0: number, x1: number, z1: number, h: number, tag: string, los = false): Box =>
  ({ x0, z0, x1, z1, h, los, kind: 'prop', tag });

/** 室内净尺寸：门房 6×8、庭院 20×28、礼拜堂 11×17（PRD 第 3 节）。 */
export const AREAS = {
  gatehouse: { x0: -3, z0: -8, x1: 3, z1: 0 },
  courtyard: { x0: -10, z0: 0.5, x1: 10, z1: 28.5 },
  side: { x0: 10.5, z0: 2, x1: 13, z1: 17.5 },
  porch: { x0: 10.5, z0: 25.5, x1: 24.5, z1: 28.5 },
  chapel: { x0: 13.5, z0: 8, x1: 24.5, z1: 25 },
} as const;

export const RAISED_Y = 0.45;

export const WALLS: Box[] = [
  // 门房
  W(-3.5, -8.5, 3.5, -8, 3.6, 'gh'), W(-3.5, -8.5, -3, 0.5, 3.6, 'gh'), W(3, -8.5, 3.5, 0.5, 3.6, 'gh'),
  // 庭院南墙（门房门洞 x∈[-0.8,0.8]）
  W(-10.5, 0, -0.8, 0.5, 4.2), W(0.8, 0, 10.5, 0.5, 4.2),
  W(-10.5, 0, -10, 29), W(-10.5, 28.5, 10.5, 29),
  // 庭院东墙：栅门洞 z∈[5.1,6.9]，外廊尖拱 z∈[26,28]
  W(10, 0, 10.5, 5.1), W(10, 6.9, 10.5, 26), W(10, 28, 10.5, 29),
  // 侧廊：南端封门墙、北端实体
  W(10.5, 1.5, 13.5, 2, 5, 'cellar'), W(10.5, 17.5, 13, 25.5),
  // 礼拜堂西墙（侧门洞 z∈[15.2,16.8]）
  W(13, 1.5, 13.5, 15.2, 7), W(13, 16.8, 13.5, 25.5, 7),
  // 礼拜堂北墙（正门洞 x∈[18.1,19.9]）、东墙、南墙
  W(13.5, 25, 18.1, 25.5, 7), W(19.9, 25, 25, 25.5, 7), W(24.5, 7.5, 25, 29, 7), W(13, 7.5, 25, 8, 7),
  // 外廊北墙
  W(10.5, 28.5, 25, 29, 3.2),
  // 门厅隔墙（开口 x∈[14.2,16.2]）
  W(13.5, 20.6, 14.2, 21, 4.5), W(16.2, 20.6, 24.5, 21, 4.5),
];

export const PROPS: Box[] = [
  P(-3, -5.6, -2.2, -3.2, 2.4, 'hearth', true),
  P(-2.75, -2.85, -2.15, -2.25, 0.8, 'pot'),
  P(-3, -7, -2.2, -5.9, 0.7, 'woodpile'),
  P(2.2, -5.6, 3, -3.4, 0.95, 'bench'),
  P(-0.4, -8, 1.6, -7.1, 0.5, 'cot'),
  P(1.5, -6.6, 2.1, -6.0, 0.75, 'stool'),
  P(-10, 5, -9.2, 7.4, 1.9, 'shelf'),
  P(8.8, 9, 10, 10.2, 1.1, 'crates'),
  P(-8.6, 20.4, -7.4, 21.6, 0.9, 'rubble'),
  P(16.4, 27.7, 17.4, 28.5, 0.8, 'crate'),
  P(21.9, 22.6, 22.7, 23.4, 0.9, 'flaskTable'),
  P(17.6, 8.5, 20.4, 9.8, 1.1, 'altar'),
  // 长凳：中央与西侧过道保持 2 m 净宽
  P(16, 14.5, 18, 15.1, 0.9, 'pew'), P(20, 14.5, 23, 15.1, 0.9, 'pew'),
  P(16, 16.5, 18, 17.1, 0.9, 'pew'), P(20, 16.5, 23, 17.1, 0.9, 'pew'),
  P(16, 18.5, 18, 19.1, 0.9, 'pew'), P(20, 18.5, 23, 19.1, 0.9, 'pew'),
  // 火盆：祭台东侧一个，侧廊中段靠西墙一个，都不占过道中线
  P(20.7, 11.2, 21.3, 11.8, 1.0, 'brazier'), P(10.5, 8.7, 11, 9.3, 1.0, 'brazier'),
];

/** 井台：圆形障碍，同时遮挡视线（绕井台可脱离视线）。 */
export const WELL = { x: 0, z: 14, r: 1.3, losR: 1.05 };

export const DOORS: Record<DoorId, DoorDef> = {
  gatehouse: { id: 'gatehouse', box: W(-0.8, 0.12, 0.8, 0.38, 2.6), hinge: { x: -0.8, z: 0.25 }, axis: 'x', label: '门房门' },
  gate: { id: 'gate', box: W(10.12, 5.1, 10.38, 6.9, 2.8), hinge: { x: 10.25, z: 5.1 }, axis: 'z', label: '侧廊栅门' },
  chapelFront: { id: 'chapelFront', box: W(18.1, 25.12, 19.9, 25.38, 3.2), hinge: { x: 19.9, z: 25.25 }, axis: 'x', label: '礼拜堂正门' },
  chapelSide: { id: 'chapelSide', box: W(13.12, 15.2, 13.38, 16.8, 2.6), hinge: { x: 13.25, z: 15.2 }, axis: 'z', label: '礼拜堂侧门' },
};

export const NODES: NavNode[] = [
  { id: 'gh_mid', x: 0, z: -5.5, region: 'gatehouse' }, { id: 'gh_in', x: 0, z: -2.2, region: 'gatehouse' },
  { id: 'c_s', x: 0, z: 2.2, region: 'courtyard' }, { id: 'c_sw', x: -6, z: 5, region: 'courtyard' },
  { id: 'c_se', x: 6, z: 5.5, region: 'courtyard' }, { id: 'c_gate', x: 8.8, z: 6, region: 'courtyard' },
  { id: 'c_w', x: -6, z: 14, region: 'courtyard' }, { id: 'c_wellw', x: -2.8, z: 14, region: 'courtyard' },
  { id: 'c_welle', x: 2.8, z: 14, region: 'courtyard' }, { id: 'c_e', x: 7, z: 14, region: 'courtyard' },
  { id: 'c_nw', x: -6, z: 23, region: 'courtyard' }, { id: 'c_n', x: 0, z: 23, region: 'courtyard' },
  { id: 'c_ne', x: 6.5, z: 25, region: 'courtyard' }, { id: 'c_arch', x: 8.6, z: 27, region: 'courtyard' },
  { id: 'p_w', x: 11.6, z: 27, region: 'porch' }, { id: 'p_m', x: 15, z: 27, region: 'porch' },
  { id: 'p_d', x: 19, z: 26.7, region: 'porch' },
  { id: 'v_d', x: 19, z: 23.8, region: 'chapel' }, { id: 'v_o', x: 15.2, z: 22.4, region: 'chapel' },
  { id: 'v_i', x: 15.2, z: 19.85, region: 'chapel' }, { id: 'n_x', x: 19, z: 19.85, region: 'chapel' },
  { id: 'n_c', x: 19, z: 12.6, region: 'chapel' }, { id: 'n_alt', x: 19, z: 11, region: 'chapel' },
  { id: 'n_w1', x: 14.6, z: 16, region: 'chapel' }, { id: 'n_w2', x: 14.6, z: 13, region: 'chapel' },
  { id: 's_n', x: 11.75, z: 16, region: 'side' }, { id: 's_m', x: 11.75, z: 9.5, region: 'side' },
  { id: 's_g', x: 11.75, z: 6, region: 'side' }, { id: 's_s', x: 11.75, z: 3.4, region: 'side' },
];

export const EDGES: NavEdge[] = [
  { a: 'gh_mid', b: 'gh_in' }, { a: 'gh_in', b: 'c_s', door: 'gatehouse' },
  { a: 'c_s', b: 'c_sw' }, { a: 'c_s', b: 'c_se' }, { a: 'c_s', b: 'c_wellw' }, { a: 'c_s', b: 'c_welle' },
  { a: 'c_sw', b: 'c_w' }, { a: 'c_sw', b: 'c_wellw' },
  { a: 'c_se', b: 'c_gate' }, { a: 'c_se', b: 'c_e' }, { a: 'c_se', b: 'c_welle' }, { a: 'c_gate', b: 'c_e' },
  { a: 'c_w', b: 'c_wellw' }, { a: 'c_w', b: 'c_nw' }, { a: 'c_wellw', b: 'c_nw' }, { a: 'c_wellw', b: 'c_n' },
  { a: 'c_welle', b: 'c_e' }, { a: 'c_welle', b: 'c_n' }, { a: 'c_welle', b: 'c_ne' }, { a: 'c_e', b: 'c_ne' },
  { a: 'c_nw', b: 'c_n' }, { a: 'c_n', b: 'c_ne' }, { a: 'c_n', b: 'c_arch' }, { a: 'c_ne', b: 'c_arch' },
  { a: 'c_arch', b: 'p_w' }, { a: 'p_w', b: 'p_m' }, { a: 'p_m', b: 'p_d' },
  { a: 'p_d', b: 'v_d', door: 'chapelFront' },
  { a: 'v_d', b: 'v_o' }, { a: 'v_o', b: 'v_i' }, { a: 'v_i', b: 'n_x' }, { a: 'v_i', b: 'n_w1' },
  { a: 'n_x', b: 'n_c' }, { a: 'n_c', b: 'n_alt' }, { a: 'n_w1', b: 'n_w2' }, { a: 'n_w2', b: 'n_c' },
  { a: 'n_w2', b: 'n_alt' }, { a: 'n_w1', b: 's_n', door: 'chapelSide' },
  { a: 's_n', b: 's_m' }, { a: 's_m', b: 's_g' }, { a: 's_g', b: 's_s' }, { a: 's_g', b: 'c_gate', door: 'gate' },
];

export const INTERACTS: InteractDef[] = [
  { id: 'lantern', x: 1.8, y: 0.95, z: -6.3 },
  { id: 'board', x: 2.95, y: 1.5, z: -1.6 },
  { id: 'refuel', x: 2.2, y: 1.0, z: -4.5 },
  { id: 'hearth', x: -2.2, y: 0.9, z: -4.4 },
  { id: 'pot', x: -2.45, y: 0.85, z: -2.55 },
  { id: 'woodpile', x: -2.2, y: 0.6, z: -6.45 },
  { id: 'ghDoor', x: -0.35, y: 1.2, z: 0.25, ownDoor: 'gatehouse' },
  { id: 'bolt', x: 0.5, y: 1.25, z: -0.1, ownDoor: 'gatehouse' },
  { id: 'bell', x: 2.2, y: 1.6, z: 1.1 },
  { id: 'shelf', x: -9.2, y: 1.1, z: 6.2 },
  { id: 'lamp', x: -9.85, y: 1.9, z: 14 },
  { id: 'gate', x: 10.25, y: 1.2, z: 6, ownDoor: 'gate' },
  { id: 'crate', x: 16.9, y: 0.9 + RAISED_Y, z: 27.7 },
  { id: 'chapelFront', x: 19, y: 1.2 + RAISED_Y, z: 25.25, ownDoor: 'chapelFront' },
  { id: 'flask', x: 22.3, y: 1.0 + RAISED_Y, z: 23 },
  { id: 'chest', x: 19, y: 1.25 + RAISED_Y, z: 9.8 },
  { id: 'cellar', x: 11.75, y: 1.2, z: 2.05 },
  { id: 'cot', x: 0.6, y: 0.5, z: -7.3 },
  { id: 'brazierChapel', x: 21, y: 1.0 + RAISED_Y, z: 11.5 },
  { id: 'brazierSide', x: 10.75, y: 1.0, z: 9 },
];

export const SPAWN = { x: 0, z: -5.5, yaw: 0 };
export const BELL_POS = { x: 2.2, z: 1.1 };
export const LAMP_POS = { x: -9.8, y: 2.7, z: 14 };
/** 火盆盆口的位置（渲染用）。 */
export const BRAZIER_POS = { chapel: { x: 21, y: 1.0 + RAISED_Y, z: 11.5 }, side: { x: 10.75, y: 1.0, z: 9 } };

export const GHOST_SPAWN = {
  grey: { x: -6, z: 26.2, yaw: Math.PI },
  wraith: { x: 11.75, z: 12.4, yaw: Math.PI },
};
/** 两鬼的巡游锚点互不重叠（PRD 第 4 节）。 */
export const PATROL = {
  grey: ['c_n', 'c_arch', 'p_w', 'c_ne', 'c_e', 'c_se', 'c_s', 'c_sw', 'c_w', 'c_nw'],
  wraith: ['s_m', 's_s', 's_g', 's_n', 'n_w2', 'n_alt', 'n_w1', 'n_x', 'v_o', 'p_d', 'c_gate'],
};

export function inArea(a: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean {
  return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
}

export function regionAt(x: number, z: number): Region {
  if (z < 0.25 && x > -3.5 && x < 3.5) return 'gatehouse';
  if (x >= 13.25 && z < 25.25) return 'chapel';
  if (x > 10.25 && z >= 25.25) return 'porch';
  if (x > 10.25) return 'side';
  return 'courtyard';
}

/** 地面高度：礼拜堂与外廊抬高 0.45 m，两处矮台阶用斜面近似。 */
export function groundY(x: number, z: number): number {
  if (x >= 13) return z > 1.5 ? RAISED_Y : 0;
  if (z >= 25.5 && x >= 10) return RAISED_Y;
  if (z >= 25.5 && x > 8.6) return ((x - 8.6) / 1.4) * RAISED_Y;
  if (x > 12 && z > 15.2 && z < 16.8) return (x - 12) * RAISED_Y;
  return 0;
}
