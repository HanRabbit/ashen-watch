import { Group, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { addBaileyApronFabric, addBaileyApronGround } from '../src/render/baileyApron';
import { Batch } from '../src/render/geom';
import {
  BAILEY_EDGES, BAILEY_FABRIC, BAILEY_OUTLINE, BAILEY_PORTAL, BAILEY_SLAB_PROXIES, BAILEY_STOPS,
  baileyGroundContains, isBaileyApronFabric, isBaileyApronSlab, isBaileyPortalSpan,
} from '../src/sim/baileyApron';
import { cameraClearT, circleBlocked, hasLineOfSight, solidBoxes } from '../src/sim/collision';
import { ceilingY, floorCandidates, supportY, WALLS, COURTYARD_SLABS, PROPS } from '../src/sim/level';
import { findPath, node, walkClear } from '../src/sim/nav';
import { restoreWorld } from '../src/sim/sim';
import { prepareCourtTransport } from '../tools/courtTransport';
import { Driver, STAND } from './driver';

const doors = { gatehouse: false, chapelFront: false, gate: false };
const ctx = { doors, lit: [] };
const ground = { y: 0, floor: '1F' as const };
const stone = new MeshStandardMaterial();
const eye = 1.62;
const stops = Object.values(BAILEY_STOPS);
type XYZ = [x: number, y: number, z: number];

function rayHit(scene: Group, [ax, ay, az]: XYZ, [bx, by, bz]: XYZ): boolean {
  const start = new Vector3(ax, ay, -az), delta = new Vector3(bx, by, -bz).sub(start);
  return new Raycaster(start, delta.clone().normalize(), 0, delta.length()).intersectObject(scene).length > 0;
}

function meshOf(add: (b: Batch) => void): Group {
  const b = new Batch(), scene = new Group();
  add(b);
  b.build(scene);
  scene.updateMatrixWorld(true);
  return scene;
}

const fabric = () => meshOf((b) => addBaileyApronFabric(b, { wallAshlar: stone, wallTrim: stone, wallRubble: stone, wallRough: stone }));

describe('西南鼓楼外院', () => {
  it('多边形地坪用精确边界，主院与西翼接缝平齐', () => {
    const scene = meshOf((b) => addBaileyApronGround(b, stone));
    expect(BAILEY_OUTLINE[0].x - Math.min(...BAILEY_OUTLINE.map(({ x }) => x))).toBeCloseTo(8.43);
    const survey = [
      [-18.80, 4.61, true], [-19.04, 4.61, false], [-17.4, 1.72, false],
      [-17.3, 2.07, true], [-18.45, 6.45, false], [-17.35, 6.45, true],
      [-16.11, 8.18, true], [-16.36, 8.18, false], [-10.51, 7.79, true],
      [-14.00, 8.19, true], [-14.00, 8.21, false], [-13.2, .65, false],
    ] as const;
    for (const [x, z, inside] of survey) {
      const label = `${x},${z}`;
      expect(baileyGroundContains(x, z), label).toBe(inside);
      expect(rayHit(scene, [x, .03, z], [x, -.03, z]), label).toBe(inside);
      expect(supportY(x, z, 0), label).toEqual(inside || (x === -14 && z === 8.21) ? ground : null);
    }
    for (const [x, z] of [[-10.51, 8.05], [-10.5, 8.05], [-10.49, 8.05], [-15.4, 8.2]]) {
      expect(supportY(x, z, 0)).toEqual(ground);
    }
    for (const stop of stops) expect(floorCandidates(stop.x, stop.z)).toEqual(['1F']);
    expect(rayHit(scene, [-13, -.50, -.1], [-13, -.50, 1.2])).toBe(true);
  });

  it('所有导航边有连续地坪与玩家净宽，券口中央及北侧均可实走', () => {
    const boxes = solidBoxes(doors);
    for (const { a, b } of BAILEY_EDGES) {
      const from = node(a), to = node(b), label = `${a} → ${b}`;
      expect(walkClear(from.x, from.z, to.x, to.z, boxes, PLAYER.radius), label).toBe(true);
      for (let i = 0; i <= 24; i++) {
        const x = from.x + (to.x - from.x) * i / 24, z = from.z + (to.z - from.z) * i / 24;
        expect(supportY(x, z, 0), label).toEqual(ground);
      }
    }
    for (const z of [6.2, 7.8, 8.35, 8.9]) expect(walkClear(-8.25, z, -11.46, z, boxes, PLAYER.radius)).toBe(true);
    expect(hasLineOfSight(-11.46, eye, 6.2, -8.25, eye, 6.2, doors)).toBe(true);
    expect(isBaileyPortalSpan(7)).toBe(true);
    expect(isBaileyPortalSpan(14)).toBe(false);
  });

  it('货架贴南券脚且占位，原站位可取物资并沿券口中央往返', () => {
    const shelf = PROPS.find(({ tag }) => tag === 'shelf')!;
    const boxes = solidBoxes(doors);
    expect(shelf).toMatchObject({ x0: -10.9, x1: -8.65, z0: BAILEY_PORTAL.z0, z1: 5.15 });
    expect(boxes).toContain(shelf);
    expect(circleBlocked(-9.75, 4.9, PLAYER.radius, boxes)).toBe(true);
    expect(circleBlocked(STAND.shelf.x, STAND.shelf.z, PLAYER.radius, boxes)).toBe(false);

    const d = new Driver();
    Object.assign(d.w.player, STAND.shelf, ground);
    const { wood, iron, oil } = d.w.inv;
    expect(d.use('shelf')).toBe(true);
    expect(d.w.taken.shelf).toBe(true);
    expect(d.w.inv).toMatchObject({ wood: wood + 2, iron: iron + 2, oil: oil + 1 });

    d.onStep = ({ player }) => {
      expect(player.z).toBeCloseTo(STAND.shelf.z);
      expect([player.y, player.floor]).toEqual([0, '1F']);
    };
    d.yaw = -Math.PI / 2;
    expect(d.waitUntil(({ player }) => player.x <= -11.46, 4, { forward: 1 })).toBe(true);
    d.yaw = Math.PI / 2;
    expect(d.waitUntil(({ player }) => player.x >= STAND.shelf.x, 4, { forward: 1 })).toBe(true);
  });

  it.each([false, true])('玩家可走到三个回望站位并返回主院（反向=%s）', (reverse) => {
    const d = new Driver();
    const entry = { x: -6, z: 5, ...ground };
    const checkpoints = reverse ? [...stops].reverse() : stops;
    Object.assign(d.w.player, entry);
    d.onStep = ({ player }) => expect([player.y, player.floor]).toEqual([0, '1F']);
    for (const at of [...checkpoints, entry]) {
      expect(findPath(d.w.player, at, ctx)?.at(-1), `${at.x},${at.z}`).toEqual({ x: at.x, z: at.z, ...ground });
      expect(d.walkTo(at.x, at.z, { floor: '1F', maxSecs: 19, stopDist: .18 })).toBeGreaterThan(0);
      expect(Math.hypot(at.x - d.w.player.x, at.z - d.w.player.z)).toBeLessThan(.2);
      if ('lookAt' in at) expect(hasLineOfSight(d.w.player.x, eye, d.w.player.z, at.lookAt.x, eye, at.lookAt.z, doors), at.id).toBe(true);
    }
    for (const at of stops) {
      Object.assign(d.w.player, at);
      const { player } = restoreWorld(d.w);
      expect([player.x, player.z, player.y, player.floor]).toEqual([at.x, at.z, 0, '1F']);
    }
  });

  it('阶券托住 2F 步道，残墙阻挡与模型、镜头和视线一致', () => {
    const mesh = fabric();
    const probes: { label: string; from: XYZ; to: XYZ; clear: boolean }[] = [
      { label: '券下通路', from: [-8.9, eye, 8.4], to: [-11.6, eye, 8.4], clear: true },
      { label: '券顶承托层', from: [-8.9, 3.54, 6.88], to: [-11.6, 3.54, 6.88], clear: false },
      { label: '南券脚', from: [-10.59, 1.2, 5.1], to: [-10.59, 1.2, 3.89], clear: false },
      { label: '券角低腹', from: [-9.4, 2.5, 4.79], to: [-11.8, 2.5, 4.79], clear: false },
      { label: '券角下净空', from: [-9.4, 2.16, 4.79], to: [-11.8, 2.16, 4.79], clear: true },
      { label: '鼓楼高残墙', from: [-16.9, eye, 3.8], to: [-19.3, eye, 3.8], clear: false },
      { label: '残墙上可回看', from: [-16.9, 3.18, 3.8], to: [-19.3, 3.18, 3.8], clear: true },
      { label: '低残边保留视窗', from: [-15.8, eye, 3.25], to: [-15.8, eye, .57], clear: true },
    ];
    for (const { label, from, to, clear } of probes) {
      const [ax, ay, az] = from, [bx, by, bz] = to;
      expect(!rayHit(mesh, from, to), `${label} 网格`).toBe(clear);
      expect(hasLineOfSight(ax, ay, az, bx, by, bz, doors), `${label} 视线`).toBe(clear);
      expect(cameraClearT(ax, az, ay, bx, bz, by, doors) === 1, `${label} 镜头`).toBe(clear);
    }
    expect(ceilingY(-10.9, 6.88, '1F')).toBe(3.42);
    expect(ceilingY(-10.9, 4.79, '1F')).toBe(2.38);
    expect(ceilingY(-9.2, 8.4, '1F')).toBe(3.7);
    const d = new Driver();
    Object.assign(d.w.player, { x: -9.2, y: 4, z: 3.05, floor: '2F' });
    d.onStep = ({ player }) => expect([player.y, player.floor]).toEqual([4, '2F']);
    expect(d.walkTo(-9.2, 11.85, { floor: '2F', maxSecs: 12 })).toBeGreaterThan(0);
    expect(d.w.player.z).toBeGreaterThan(11.6);
  });

  it('烘焙 CPU 打包包含同一批墙体和地坪代理，渲染可按标签排除', () => {
    expect(WALLS.filter(isBaileyApronFabric)).toEqual(BAILEY_FABRIC);
    expect(COURTYARD_SLABS.filter(isBaileyApronSlab)).toEqual(BAILEY_SLAB_PROXIES);
    const { bvh } = prepareCourtTransport();
    const leaves = new Set<string>();
    for (let i = 0; i < bvh.entries * 8; i += 8) {
      const [x0, y0, z0, , x1, h, z1, mat] = bvh.pixels.slice(i, i + 8);
      if (mat) leaves.add([x0, y0, z0, x1, h, z1, mat].join(','));
    }
    for (const box of [...BAILEY_FABRIC, ...BAILEY_SLAB_PROXIES]) {
      expect(leaves.has([box.x0, box.y0!, box.z0, box.x1, box.h, box.z1, box.kind === 'wall' ? 1 : 3].map(Math.fround).join(','))).toBe(true);
    }
  });
});
