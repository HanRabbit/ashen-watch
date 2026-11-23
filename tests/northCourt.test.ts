import { Group, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { Batch } from '../src/render/geom';
import { addNorthCourtFabric, addNorthWalkGuard } from '../src/render/northCourt';
import { addCourtyardGround } from '../src/render/yardSurface';
import { cameraClearT, circleBlocked, cylsAt, hasLineOfSight, solidBoxes } from '../src/sim/collision';
import { ceilingY, floorCandidates, NORTH_GUARD, PROPS, supportY } from '../src/sim/level';
import { findNodePath, findPath, node, walkClear } from '../src/sim/nav';
import { NORTH_ARCHES, NORTH_COURT_POINTS as survey, NORTH_EDGES, NORTH_OUTLINE, northGroundContains, type NorthPoint } from '../src/sim/northCourt';
import { pickTarget, restoreWorld } from '../src/sim/sim';
import { Driver, STAND } from './driver';

const doors = { gatehouse: true, chapelFront: false, gate: false };
const ctx = { doors, lit: [] };
const atGrade = (p: NorthPoint) => ({ ...p, y: 0, floor: '1F' as const });
const atDeck = (p: NorthPoint) => ({ ...p, y: 4, floor: '2F' as const });
type XYZ = [x: number, y: number, z: number];

function meshHit(scene: Group, [ax, ay, az]: XYZ, [bx, by, bz]: XYZ): boolean {
  const dir = new Vector3(bx - ax, by - ay, az - bz);
  return new Raycaster(new Vector3(ax, ay, -az), dir.clone().normalize(), 0, dir.length())
    .intersectObjects(scene.children).length > 0;
}

function testScene(): Group {
  const b = new Batch(), scene = new Group();
  const stone = new MeshStandardMaterial(), trim = new MeshStandardMaterial(), iron = new MeshStandardMaterial(), wood = new MeshStandardMaterial();
  addNorthCourtFabric(b, { wallAshlar: stone, wallTrim: trim, wallRubble: stone, wallRough: stone });
  addNorthWalkGuard(b, NORTH_GUARD, trim, iron, wood);
  addCourtyardGround(b, trim, stone);
  b.build(scene);
  return scene;
}

describe('北侧斜折残堡', () => {
  it('双拱回路的每条边都有站立净宽和连续支撑，寻路可抵达深处', () => {
    const boxes = solidBoxes(doors, 0);
    for (const { a, b } of NORTH_EDGES) {
      const from = node(a), to = node(b);
      expect(walkClear(from.x, from.z, to.x, to.z, boxes, PLAYER.radius, cylsAt(0)), `${a} → ${b}`).toBe(true);
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
        expect(supportY(x, z, 0)).toEqual({ y: 0, floor: '1F' });
      }
    }
    expect(walkClear(0, 25, 3.3, 34.8, boxes, PLAYER.radius)).toBe(false);
    expect(findPath(atGrade({ x: 0, z: 25 }), atGrade(survey.lookout), ctx)?.at(-1)).toEqual(atGrade(survey.lookout));
    expect(findNodePath('c_n', 'c_north_lookout', ctx, '1F')).toContain('c_north_westLanding');
    expect(findNodePath('c_ne', 'c_north_lookout', ctx, '1F')).toContain('c_north_eastLanding');
  });

  it.each([false, true])('用玩家输入走完整条 1F 回路（反向=%s）', (reverse) => {
    const d = new Driver();
    const points = Object.values(survey);
    if (reverse) points.reverse();
    Object.assign(d.w.player, atGrade(points[0]));
    d.onStep = ({ player }) => expect([player.y, player.floor]).toEqual([0, '1F']);
    for (const { x, z } of points.slice(1)) {
      expect(d.walkTo(x, z, { floor: '1F', maxSecs: 12, stopDist: .15 }), `${x},${z}`).toBeGreaterThan(0);
      expect(Math.hypot(d.w.player.x - x, d.w.player.z - z)).toBeLessThan(.16);
    }
  });

  it('1F 玩家沿低墙缺口方向前进时仍留在残堡内', () => {
    const d = new Driver();
    Object.assign(d.w.player, atGrade({ x: 1.8, z: 34.8 }));
    d.onStep = ({ player }) => {
      expect(northGroundContains(player.x, player.z)).toBe(true);
      expect([player.y, player.floor]).toEqual([0, '1F']);
    };
    d.wait(2.5, { forward: 1 });
    expect(d.w.player.z).toBeGreaterThan(35.1);
    expect(d.w.player.z).toBeLessThan(36.1);
  });

  it('2F 可走完整原北廊，护栏挡住朝北的输入并保留栏间视线', () => {
    const d = new Driver();
    Object.assign(d.w.player, atDeck(node('w_nw')));
    d.onStep = ({ player }) => expect([player.y, player.floor]).toEqual([4, '2F']);
    const goal = node('w_ne');
    expect(findNodePath('w_nw', 'w_ne', ctx, '2F')).toEqual(['w_nw', 'w_n', 'w_ne']);
    expect(d.walkTo(goal.x, goal.z, { floor: '2F', maxSecs: 15 })).toBeGreaterThan(0);
    expect(d.w.player.x).toBeGreaterThan(8.9);
    Object.assign(d.w.player, atDeck({ x: .08, z: 27.8 }));
    d.yaw = 0;
    d.wait(1.5, { forward: 1 });
    expect(d.w.player.z).toBeGreaterThan(28.1);
    expect(d.w.player.z).toBeLessThan(28.5);
    expect(floorCandidates(survey.lookout.x, survey.lookout.z)).toEqual(['1F']);
    expect(hasLineOfSight(.08, 5.6, 27.8, survey.lookout.x, 1.65, survey.lookout.z, doors)).toBe(true);
  });

  it('地坪、拱腹、厚残墙和栏杆的网格与碰撞/视线共用轮廓', () => {
    const scene = testScene();
    const groundSamples = [[-4.2, 32.5, true], [-5.25, 33, false], [7.8, 32.4, true], [8.6, 34, false], [.6, 36.6, true], [1, 37.15, false]] as const;
    for (const [x, z, inside] of groundSamples) {
      expect(northGroundContains(x, z)).toBe(inside);
      expect(supportY(x, z, 0) !== null).toBe(inside);
      expect(meshHit(scene, [x, .03, z], [x, -.03, z])).toBe(inside);
      expect(cameraClearT(x, z, .03, x, z, -.03, doors) < 1).toBe(inside);
    }
    expect(Math.max(...NORTH_OUTLINE.map((p) => p.z)) - 29).toBeCloseTo(8.1);
    for (const arch of NORTH_ARCHES) expect(ceilingY(arch.center, 28.6, '1F')).toBeCloseTo(3.34);
    const probes: [XYZ, XYZ, boolean][] = [
      [[0, 1.65, 26], [0, 1.65, 30.5], true],
      [[4.84, 2.05, 26], [4.84, 2.05, 30.5], true],
      [[2.4, 1.65, 26], [2.4, 1.65, 30.5], false], // bearing pier
      [[0, 3.24, 26], [0, 3.24, 30.5], true],
      [[0, 3.57, 26], [0, 3.57, 30.5], false], // crown
      [[-1.74, 2.66, 26], [-1.74, 2.66, 30.5], false], // haunch
      [[-2.5, 2, 33], [-5.75, 2, 33], false], // diagonal sidewall
      [[-.1, 4.60, 28.3], [-.1, 4.60, 29.3], false], // iron post
      [[.08, 4.6, 28.3], [.08, 4.6, 29.3], true], // gap
      [[.08, 4.93, 28.3], [.08, 4.93, 29.3], false], // wooden cap
      [[0, 1.7, 2.2], [-2.45, 6.26, 34.80], true], // clear up to the high broken crest from the south door
      [[0, 1.7, 2.2], [-2.58, 6.48, 36.54], false], // ray lands in the crest
      [[-.2, 1.65, 18], [-.45, 1.65, 34], true], // lower view framed by the west arch
    ];
    for (const [a, b, clear] of probes) {
      const label = `${a} → ${b}`;
      expect(!meshHit(scene, a, b), label).toBe(clear);
      expect(hasLineOfSight(...a, ...b, doors), label).toBe(clear);
      expect(cameraClearT(a[0], a[2], a[1], b[0], b[2], b[1], doors) === 1, label).toBe(clear);
    }
  });

  it('保留壁灯站位、原北侧掩体及新院合法读档点', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.repairs.lamp = true;
    d.w.inv.oil = 2;
    Object.assign(d.w.player, atGrade(survey.westMouth));
    expect(d.walkTo(STAND.lamp.x, STAND.lamp.z, { floor: '1F', stopDist: .15, maxSecs: 12 })).toBeGreaterThan(0);
    d.face(-5, 28.65);
    d.w.player.yaw = d.yaw;
    expect(pickTarget(d.w)?.id).toBe('lamp');
    expect(d.use('lamp')).toBe(true);
    expect(d.w.lampBurn).toBeGreaterThan(0);
    const boxes = solidBoxes(doors, 0);
    for (const p of PROPS.filter(({ tag }) => tag === 'barrel' || tag === 'wallStub')) {
      expect(circleBlocked((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, PLAYER.radius, boxes)).toBe(true);
    }
    Object.assign(d.w.player, atGrade(survey.lookout));
    expect(restoreWorld(d.w).player).toMatchObject(atGrade(survey.lookout));
  });
});
