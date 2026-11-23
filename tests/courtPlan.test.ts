import { Group, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER, WALL_LAMP } from '../src/config';
import { Batch } from '../src/render/geom';
import { addWestCourtFabric } from '../src/render/masonry';
import { addCourtyardGround } from '../src/render/yardSurface';
import { cameraClearT, circleBlocked, hasLineOfSight, solidBoxes } from '../src/sim/collision';
import { isWestCourtFabric, WEST_COURT_POINTS as survey } from '../src/sim/courtPlan';
import { ceilingY, EDGES, floorCandidates, supportY, WALLS } from '../src/sim/level';
import { findNodePath, findPath, inZone, node, walkClear } from '../src/sim/nav';
import { restoreWorld } from '../src/sim/sim';
import { newGhost, newWorld } from '../src/sim/state';
import { Driver } from './driver';

const doors = { gatehouse: false, chapelFront: false, gate: false };
const ctx = { doors, lit: [] };
const atGrade = (p: { x: number; z: number }) => ({ ...p, y: 0, floor: '1F' as const });

function rayHits(scene: Group, from: Vector3, to: Vector3): boolean {
  const delta = to.clone().sub(from);
  return new Raycaster(from, delta.clone().normalize(), 0, delta.length()).intersectObjects(scene.children).length > 0;
}

describe('折线西翼院', () => {
  it('每条新导航边有连续地坪和玩家净宽', () => {
    const boxes = solidBoxes(doors, 0);
    const newNodes = /^(c_ws_|c_wn_|c_w_knee)/;
    const edges = EDGES.filter(({ a, b }) => newNodes.test(a) || newNodes.test(b));
    expect(edges.length).toBeGreaterThan(6);
    for (const { a, b } of edges) {
      const from = node(a), to = node(b);
      const edge = `${a} → ${b}`;
      expect(walkClear(from.x, from.z, to.x, to.z, boxes, PLAYER.radius), edge).toBe(true);
      for (let i = 0; i <= 20; i++) {
        const x = from.x + (to.x - from.x) * i / 20;
        const z = from.z + (to.z - from.z) * i / 20;
        expect(supportY(x, z, 0), edge).toEqual({ y: 0, floor: '1F' });
      }
    }
    expect(findNodePath('c_ws_bay', 'c_wn_bay', ctx, '1F')).toContain('c_w_knee');
    expect(walkClear(survey.southBay.x, survey.southBay.z, survey.northBay.x, survey.northBay.z, boxes, PLAYER.radius)).toBe(false);
    const route = findPath(atGrade(survey.southBay), atGrade(survey.northBay), ctx);
    expect(route?.some((p) => p.x > -15 && p.z > 16 && p.z < 19)).toBe(true);
    expect(route?.at(-1)).toEqual(atGrade(survey.northBay));
  });

  it.each([false, true])('玩家经西翼双口走回中庭（反向=%s）', (reverse) => {
    const d = new Driver();
    const mainSouth = { x: -8.5, z: 11.85 }, mainNorth = { x: -8.95, z: 20 };
    const checkpoints = [mainSouth, survey.southMouth, survey.southBay, survey.northBay, survey.northMouth, mainNorth];
    if (reverse) checkpoints.reverse();
    const entry = checkpoints.shift()!;
    Object.assign(d.w.player, atGrade(entry));
    d.onStep = ({ player }) => {
      expect(player.y).toBe(0);
      expect(player.floor).toBe('1F');
    };
    for (const { x, z } of checkpoints) {
      expect(d.walkTo(x, z, { floor: '1F', maxSecs: 14, stopDist: 0.18 }), `站位 ${x},${z}`).toBeGreaterThan(0);
      expect(Math.hypot(d.w.player.x - x, d.w.player.z - z)).toBeLessThan(0.2);
    }
  });

  it('壁灯燃烧时灰影在北券西侧受阻，灯灭后可进入中庭', () => {
    const d = new Driver();
    d.w.phase = 'night';
    d.w.repairs.lamp = true;
    d.w.lampBurn = 30;
    Object.assign(d.w.player, atGrade({ x: -7.7, z: 20 }));
    const grey = newGhost('grey');
    Object.assign(grey, atGrade({ x: -13.1, z: 20 }), { yaw: Math.PI / 2, mode: 'chase' });
    d.w.ghosts = [grey];
    d.onStep = () => expect(inZone(WALL_LAMP.zone, grey.x, grey.z, -0.05, grey.floor)).toBe(false);
    d.wait(3);
    expect(grey.x).toBeLessThanOrEqual(-10);
    d.w.lampBurn = 0;
    d.onStep = null;
    expect(d.waitUntil(() => grey.x > -10, 12)).toBe(true);
  });

  it('读档保留西翼和券口内的合法坐标，嵌入旧墙或残墙时恢复到安全节点', () => {
    for (const [p, blocked] of [
      [survey.southMouth, false], [survey.northBay, false],
      [{ x: -10.3, z: 14 }, true], [{ x: -12.26, z: 15.97 }, true],
    ] as const) {
      const snapshot = newWorld();
      Object.assign(snapshot.player, atGrade(p));
      const boxes = solidBoxes(snapshot.doors, 0);
      expect(circleBlocked(p.x, p.z, PLAYER.radius, boxes, [])).toBe(blocked);
      const { player } = restoreWorld(snapshot);
      expect(supportY(player.x, player.z, player.y)).toEqual({ y: 0, floor: '1F' });
      expect(circleBlocked(player.x, player.z, PLAYER.radius, boxes, [])).toBe(false);
      expect(player.x === p.x && player.z === p.z).toBe(!blocked);
    }
  });

  it('原 2F 步道连续跨过两券头，西翼维持单层地坪', () => {
    expect(findNodePath('w_w3', 'w_w1', ctx, '2F')).toEqual(['w_w3', 'w_w2', 'w_w1']);
    const d = new Driver();
    Object.assign(d.w.player, { x: -9.2, z: 8, y: 4, floor: '2F' });
    d.onStep = ({ player }) => expect([player.y, player.floor]).toEqual([4, '2F']);
    expect(d.walkTo(-9.2, 23, { floor: '2F', maxSecs: 12 })).toBeGreaterThan(0);
    expect(d.w.player.z).toBeGreaterThan(22.7);
    for (const p of [survey.southBay, survey.knee, survey.northBay, survey.gable]) {
      expect(floorCandidates(p.x, p.z)).toEqual(['1F']);
    }
  });

  it('渲染地坪与支撑面共用折线边界，保留 S1 开口', () => {
    const b = new Batch(), scene = new Group();
    addCourtyardGround(b, new MeshStandardMaterial(), new MeshStandardMaterial());
    b.build(scene);
    const down = (x: number, z: number) => rayHits(scene, new Vector3(x, 1, -z), new Vector3(x, -0.1, -z));
    for (const { x, z } of Object.values(survey)) {
      expect(down(x, z)).toBe(true);
      expect(supportY(x, z, 0)).toEqual({ y: 0, floor: '1F' });
    }
    expect(down(-10.49, 11.85)).toBe(true);
    expect(down(-10.51, 11.85)).toBe(true);
    for (const [x, z] of [[-16.5, 15.6], [-18.3, 20], [-14, 25.3], [-17.15, 8.1]]) {
      expect(down(x, z)).toBe(false);
      expect(supportY(x, z, 0)).toBeNull();
    }
    expect(down(7.1, 9.9)).toBe(false);
  });

  it('券洞、折入墙与残窗的可见轮廓和视线／镜头阻挡对齐', () => {
    const b = new Batch(), scene = new Group(), mat = new MeshStandardMaterial();
    addWestCourtFabric(b, { wallRubble: mat, wallRough: mat, wallTrim: mat }, WALLS.filter(isWestCourtFabric));
    b.build(scene);
    const probes = [
      { from: [-9, 1.6, 11.85], to: [-12.1, 1.6, 11.85], clear: true }, // south portal
      { from: [-9, 1.6, 20], to: [-12.1, 1.6, 20], clear: true }, // north portal
      { from: [-9, 3.54, 11.85], to: [-12.1, 3.54, 11.85], clear: false }, // crown
      { from: [-9, 2.6, 10.32], to: [-12.1, 2.6, 10.32], clear: false }, // low corbel
      { from: [-9, 2.3, 10.32], to: [-12.1, 2.3, 10.32], clear: true },
      { from: [-12.3, 1.6, 14.5], to: [-12.3, 1.6, 17.5], clear: false }, // cross-wall
      { from: [-14.35, 1.6, 14.5], to: [-14.35, 1.6, 17.5], clear: true }, // around the break
      { from: [-16.08, 3, 23.5], to: [-16.08, 3, 26], clear: true }, // surviving gable window
      { from: [-16.08, 2, 23.5], to: [-16.08, 2, 26], clear: false }, // solid window sill
    ];
    for (const { from: [ax, ay, az], to: [bx, by, bz], clear } of probes) {
      const name = `${ax},${ay},${az} → ${bx},${by},${bz}`;
      expect(!rayHits(scene, new Vector3(ax, ay, -az), new Vector3(bx, by, -bz)), name).toBe(clear);
      expect(hasLineOfSight(ax, ay, az, bx, by, bz, doors), name).toBe(clear);
      expect(cameraClearT(ax, az, ay, bx, bz, by, doors) === 1, name).toBe(clear);
    }
    expect(ceilingY(survey.southMouth.x, survey.southMouth.z, '1F')).toBe(3.5);
    expect(ceilingY(-10.25, 10.32, '1F')).toBe(2.46);
    expect(circleBlocked(-16.08, 24.5, PLAYER.radius, solidBoxes(doors, 0), [])).toBe(true);
  });
});
