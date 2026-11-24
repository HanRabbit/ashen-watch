import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/settings';
import { INTERACTS, type InteractId } from '../src/sim/level';
import { node } from '../src/sim/nav';
import { pickTarget } from '../src/sim/sim';
import { goalText, Hud } from '../src/ui/hud';
import { Screens, type ScreenHost } from '../src/ui/screens';
import { Driver, STAND } from './driver';

class Element {
  hidden: boolean;
  style: Record<string, string> = {};
  innerHTML = '';
  classList = { toggle() {} };
  constructor(hidden = false) { this.hidden = hidden; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

let dom: Map<string, Element>, hud: Hud;
const element = (id: string) => dom.get(id)!;
beforeEach(() => {
  dom = new Map();
  vi.stubGlobal('document', { getElementById: (id: string) => {
    if (!dom.has(id)) dom.set(id, new Element(['hud', 'hud-guide', 'hud-prompt', 'overlay'].includes(id)));
    return element(id);
  } });
  hud = new Hud(defaultSettings());
  hud.show(true);
});
afterEach(() => vi.unstubAllGlobals());

const interact = (id: InteractId) => INTERACTS.find(it => it.id === id)!;
const waypointAngle = (x: number, z: number, p: { x: number; z: number }) => Math.atan2(x - p.x, z - p.z);
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const arrow = () => element('hud-guide').hidden ? null : Number(element('hud-guide').style.transform.match(/rotate\((.*?)rad\)/)![1]);
const update = (d: Driver, time = 0) => hud.updateGuide(d.w, 0, true, time);

function followTo(d: Driver, id: InteractId, secs: number) {
  const it = interact(id), p = d.w.player;
  for (let i = 0; i < secs * 60; i++) {
    const toward = waypointAngle(it.x, it.z, p);
    p.yaw = toward;
    if (pickTarget(d.w)?.id === id) return;
    update(d, d.w.played);
    const bearing = arrow();
    if (bearing === null) throw Error(`No arrow to ${id} at ${p.x.toFixed(2)},${p.z.toFixed(2)},${p.y.toFixed(2)} ${p.floor}`);
    d.yaw = bearing;
    d.tick({ forward: 1 });
  }
  throw Error(`Did not reach ${id}: ${JSON.stringify(p)}`);
}

it('follows the tutorial from the real spawn and hands off to the interaction prompt', () => {
  const d = new Driver();
  followTo(d, 'lantern', 12);
  const target = pickTarget(d.w);
  expect(target).toMatchObject({ id: 'lantern', enabled: true });
  hud.update(d.w, target, 0, false);
  update(d, d.w.played);
  expect(arrow()).toBeNull();
  expect(element('hud-prompt').innerHTML).toContain('拾取提灯');
  expect(d.use('lantern')).toBe(true);
  hud.update(d.w, null, 0, false);
  followTo(d, 'board', 12);
  expect(d.use('board')).toBe(true);
  expect(d.ui.board).toBe(true);
});

it('leads players west to supplies, then to the raised crate, and does not require optional work', () => {
  const d = new Driver();
  d.w.phase = 'day';
  followTo(d, 'ghDoor', 12);
  expect(d.use('ghDoor')).toBe(true);
  followTo(d, 'shelf', 25);
  expect(d.use('shelf')).toBe(true);
  expect(goalText(d.w)).toContain('礼拜堂外货箱');
  followTo(d, 'crate', 45);
  expect(d.use('crate')).toBe(true);
  update(d, d.w.played);
  expect(arrow()).toBeNull();
  expect(goalText(d.w)).toMatch(/最多修两处.*床铺/s);
});

it('uses the chapel door in both directions and finishes with two separate bell interactions', () => {
  const d = new Driver();
  d.w.phase = 'dawn';
  Object.assign(d.w.player, node('p_m'));
  followTo(d, 'chapelFront', 5);
  expect(d.use('chapelFront')).toBe(true);
  followTo(d, 'chest', 25);
  expect(d.use('chest')).toBe(true);
  d.w.doors.chapelFront = false;
  followTo(d, 'chapelFront', 25);
  expect(d.use('chapelFront')).toBe(true);
  followTo(d, 'bell', 35);
  expect(d.use('bell')).toBe(true);
  expect(goalText(d.w)).toContain('再交互一次');
  expect(d.use('bell')).toBe(true);
  update(d, d.w.played);
  expect(arrow()).toBeNull();
});

it('leads back through the closed gatehouse door at night and unbolts before the dawn exit', () => {
  const d = new Driver();
  const w = d.w;
  w.phase = 'night';
  w.inv.hasClapper = true;
  Object.assign(w.player, node('c_s'));
  followTo(d, 'ghDoor', 6);
  expect(d.use('ghDoor')).toBe(true);
  followTo(d, 'hearth', 10);
  expect(w.quest.returnedBeforeDawn).toBe(true);
  w.phase = 'dawn';
  w.repairs.bolt = w.bolted = true;
  w.doors.gatehouse = false;
  followTo(d, 'bolt', 10);
  expect(d.use('bolt')).toBe(true);
  followTo(d, 'ghDoor', 10);
  expect(d.use('ghDoor')).toBe(true);
  followTo(d, 'bell', 10);
});

it('does not point at an interactable through a wall even within two metres', () => {
  const d = new Driver();
  d.w.phase = 'dawn';
  d.w.inv.hasClapper = true;
  d.w.doors.gatehouse = true;
  const p = d.w.player, bell = interact('bell');
  Object.assign(p, { x: 2.2, z: -0.55, y: 0, floor: '1F' });
  p.yaw = waypointAngle(bell.x, bell.z, p);
  expect(Math.hypot(p.x - bell.x, p.z - bell.z)).toBeLessThan(2);
  expect(pickTarget(d.w)?.id).not.toBe('bell');
  update(d);
  const bearing = arrow();
  expect(bearing).not.toBeNull();
  expect(angleDiff(bearing!, p.yaw)).toBeGreaterThan(0.3);
});

it('selects actual stair travel instead of pointing straight up at the 1F goal', () => {
  const d = new Driver();
  d.w.phase = 'day';
  d.w.taken.shelf = true;
  const p = d.w.player;
  Object.assign(p, node('g_br'));
  const direct = waypointAngle(interact('crate').x, interact('crate').z, p);
  update(d);
  expect(arrow()).not.toBeNull();
  expect(angleDiff(arrow()!, direct)).toBeGreaterThan(1);
  followTo(d, 'crate', 55);
  expect(p.floor).toBe('1F');
});

it('hides for a disabled prompt, a modal opened during the tick, loss of control and a hidden HUD', () => {
  const d = new Driver();
  const w = d.w;
  w.phase = 'night';
  Object.assign(w.player, { ...STAND.hearth, y: 0, floor: '1F' });
  d.face(interact('hearth').x, interact('hearth').z);
  w.player.yaw = d.yaw;
  const target = pickTarget(w);
  expect(target).toMatchObject({ id: 'hearth', enabled: false });
  update(d);
  expect(arrow()).not.toBeNull();
  hud.update(w, target, 0, false);
  update(d);
  expect(arrow()).toBeNull();
  hud.update(w, null, 0, false);
  update(d);
  expect(arrow()).not.toBeNull();
  const settings = defaultSettings();
  const screens = new Screens({ world: () => w, settings, storageNote: () => '', cancelCapture() {} } as ScreenHost);
  screens.open('tasks');
  expect(arrow()).toBeNull(); // even before the next HUD frame
  update(d); // enabled was captured before the modal opened
  expect(arrow()).toBeNull();
  screens.closeAll();
  hud.updateGuide(w, 0, false, 0);
  expect(arrow()).toBeNull();
  update(d);
  expect(arrow()).not.toBeNull();
  hud.show(false);
  expect(arrow()).toBeNull();
});

it('can take the B1 store stairs to the altar with the chapel door shut', () => {
  const d = new Driver();
  d.w.phase = 'dawn';
  const p = d.w.player;
  Object.assign(p, { ...STAND.flask, y: -3, floor: 'B1' });
  update(d);
  expect(arrow()).not.toBeNull();
  const direct = waypointAngle(interact('chest').x, interact('chest').z, p);
  expect(angleDiff(arrow()!, direct)).toBeGreaterThan(0.25);
  followTo(d, 'chest', 35);
  expect(p.floor).toBe('1F');
  expect(d.w.doors.chapelFront).toBe(false);
});

it('finishes the S2 landing turn before steering toward the nave', () => {
  const d = new Driver();
  d.w.phase = 'dawn';
  const p = d.w.player, corner = node('v_s2');
  // The failing walk rounded to 16.47,21.48. Start just inside the former
  // waypoint-skip radius, where the line to the next node still clips the corner.
  Object.assign(p, { x: corner.x - 0.176, z: corner.z - 0.02, y: corner.y, floor: corner.floor });
  update(d);
  const bearing = arrow();
  expect(bearing).not.toBeNull();
  expect(bearing).toBeCloseTo(waypointAngle(corner.x, corner.z, p), 5);
  followTo(d, 'chest', 25);
});

it('shows repair status, oil remaining and the optional night and dawn rules in the real screens', () => {
  const { w } = new Driver();
  const screens = new Screens({ world: () => w, settings: defaultSettings(), storageNote: () => '' } as ScreenHost);
  w.phase = 'dusk';
  w.inv.hasLantern = true;
  w.lantern.oil = 112;
  w.repairs.lamp = true;
  screens.open('tasks');
  const overlay = element('overlay');
  expect(overlay.innerHTML).toContain('回门房补油、做热食');
  expect(overlay.innerHTML).toContain('1:52 / 5:00');
  expect(overlay.innerHTML).toMatch(/壁灯[^<]*<\/th><td>已修/);
  expect(overlay.innerHTML).toContain('未修');
  screens.open('board');
  expect(overlay.innerHTML).toContain('入夜后不能再修');
  expect(overlay.innerHTML).toContain('还没拿到钟舌仍可去取');
  expect(overlay.innerHTML).toContain('再交互一次敲响');
  expect(overlay.innerHTML).toContain('安全停留 10 秒');
  expect(overlay.innerHTML).toMatch(/夜里在外久留会冻伤.*火盆/s);
});
