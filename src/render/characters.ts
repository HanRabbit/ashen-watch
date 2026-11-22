// 角色占位模型（CHR-01…03）与程序化动画（ANM-01、02、04）：守夜人、灰影、黑影。
// 模型根节点以米为单位，原点在脚下地面，面朝本地 -Z。
import * as THREE from 'three';
import { GHOST } from '../config';
import { groundY } from '../sim/level';
import { GhostState, World } from '../sim/state';
import { cyl, lerp, mesh, yawToRot } from './geom';
import { glowTexture, Materials } from './materials';
import { makeClapper, makeLantern } from './props';

function limb(mat: THREE.Material, r: number, len: number): { pivot: THREE.Group; part: THREE.Mesh } {
  const pivot = new THREE.Group();
  const part = cyl(mat, r, r * 0.85, len, 7);
  part.position.y = -len / 2;
  pivot.add(part);
  return { pivot, part };
}

export class PlayerModel {
  readonly group = new THREE.Group();
  readonly lanternLight = new THREE.PointLight(0xffa550, 0, 13, 1.5);
  private legL: THREE.Group; private legR: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private body = new THREE.Group();
  private lantern: ReturnType<typeof makeLantern>;
  private clapper: THREE.Group;
  private cloak: THREE.Mesh;
  private phase = 0;
  private raise = 0;
  private hurt = 0;

  constructor(m: Materials, tex: THREE.Texture) {
    const coat = new THREE.MeshStandardMaterial({ color: 0x4a4f4c, roughness: 0.95 });
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 1, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9a8272, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x241f1b, roughness: 0.9 });

    const l1 = limb(boot, 0.085, 0.86), l2 = limb(boot, 0.085, 0.86);
    this.legL = l1.pivot; this.legR = l2.pivot;
    this.legL.position.set(-0.11, 0.88, 0); this.legR.position.set(0.11, 0.88, 0);

    const torso = cyl(coat, 0.2, 0.17, 0.62, 9); torso.position.y = 1.19;
    const belt = cyl(m.wood, 0.185, 0.185, 0.06, 9); belt.position.y = 0.95;
    const head = mesh(new THREE.SphereGeometry(0.115, 10, 8), skin); head.position.y = 1.66;
    const hood = mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, 1.9), cloakMat); hood.position.set(0, 1.66, 0.02);
    this.cloak = mesh(new THREE.CylinderGeometry(0.24, 0.36, 1.0, 9, 1, true, -1.25, 2.5), cloakMat);
    this.cloak.position.set(0, 1.02, 0.03);

    const a1 = limb(coat, 0.06, 0.6), a2 = limb(coat, 0.06, 0.6);
    this.armL = a1.pivot; this.armR = a2.pivot;
    this.armL.position.set(-0.26, 1.45, 0); this.armR.position.set(0.26, 1.45, 0);
    const glove = mesh(new THREE.SphereGeometry(0.06, 7, 6), boot); glove.position.y = -0.62;
    this.armR.add(glove);

    // 提灯挂点：右手
    this.lantern = makeLantern(m, tex);
    this.lantern.group.position.set(0, -0.82, 0);
    this.armR.add(this.lantern.group);
    this.lanternLight.position.set(0.3, 1.25, -0.35);
    // 钟舌：背在腰后，取得后可见
    this.clapper = makeClapper(m);
    this.clapper.position.set(-0.2, 0.92, 0.2);
    this.clapper.rotation.z = 0.5;

    this.body.add(torso, belt, head, hood, this.cloak, this.armL, this.armR, this.clapper);
    this.group.add(this.legL, this.legR, this.body, this.lanternLight);
  }

  triggerHurt(): void {
    this.hurt = 1;
  }

  /** at 是插值后的位置；yaw 取镜头当前朝向，转身时角色与镜头同帧转动。 */
  update(w: World, at: { x: number; z: number }, yaw: number, dt: number, time: number): void {
    const p = w.player;
    this.group.position.set(at.x, groundY(at.x, at.z), -at.z);
    this.group.rotation.y = yawToRot(yaw);
    const speed = p.moving ? (p.sprinting ? 1.7 : 1) : 0;
    this.phase += dt * speed * 7.2;
    const sw = Math.sin(this.phase) * (p.sprinting ? 0.85 : 0.55) * (speed > 0 ? 1 : 0);
    this.legL.rotation.x = lerp(this.legL.rotation.x, sw, 0.35);
    this.legR.rotation.x = lerp(this.legR.rotation.x, -sw, 0.35);
    this.armL.rotation.x = lerp(this.armL.rotation.x, -sw * 0.7, 0.3);
    // 持灯为上身叠加：右臂不跟随摆臂，举灯时抬到身前
    const lan = w.lantern;
    this.raise = lerp(this.raise, lan.raised ? 1 : 0, Math.min(1, dt * 9));
    this.armR.rotation.x = w.inv.hasLantern ? lerp(0.25, 2.25, this.raise) + sw * 0.08 : sw * 0.7;
    this.armR.rotation.z = w.inv.hasLantern ? lerp(0.12, 0.0, this.raise) : 0;
    this.lantern.group.rotation.x = -this.armR.rotation.x;
    this.lantern.group.visible = w.inv.hasLantern;
    const bob = speed > 0 ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(time * 1.6) * 0.006;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.body.position.y = bob;
    this.body.rotation.x = (p.sprinting ? 0.16 : 0) + this.hurt * 0.3;
    this.cloak.rotation.x = -0.05 - speed * 0.07;
    this.clapper.visible = w.inv.hasClapper;

    const on = w.inv.hasLantern && lan.on && lan.oil > 0;
    const flick = 0.9 + 0.07 * Math.sin(time * 12.7) + 0.05 * Math.sin(time * 27.1 + 2);
    const low = lan.oil < 20 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 5)) : 1;
    this.lanternLight.intensity = on ? (lan.raised ? 30 : 13) * flick * low : 0;
    this.lanternLight.distance = lan.raised ? 17 : 12;
    this.lanternLight.position.y = lerp(1.2, 1.95, this.raise);
    this.lantern.glow.visible = on;
    this.lantern.glass.emissiveIntensity = on ? 2.4 * flick : 0;
  }
}

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

/** 灰影（CHR-02）：削尖兜帽、灰白破布、无面孔，直立高瘦，雾化集中在衣摆。 */
function buildGrey(tex: THREE.Texture): { root: THREE.Group; mats: THREE.Material[]; armL: THREE.Group; armR: THREE.Group; top: THREE.Group; mist: THREE.Sprite[] } {
  const root = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xb4b2ab, emissive: 0x7d8288, emissiveIntensity: 0.55, roughness: 1, transparent: true, side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: 0x08090a, transparent: true });
  const top = new THREE.Group();
  const robe = mesh(new THREE.CylinderGeometry(0.2, 0.42, 1.25, 9, 1, true), cloth, false); robe.position.y = 0.92;
  const chest = mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 9), cloth, false); chest.position.y = 1.62;
  const hood = mesh(new THREE.ConeGeometry(0.21, 0.62, 8), cloth, false); hood.position.y = 2.05;
  const face = mesh(new THREE.SphereGeometry(0.12, 8, 6), dark, false); face.position.set(0, 1.9, -0.09);
  const hem = tatter(cloth, 0.38, 0.5, 11, 3); hem.position.y = 0.32;
  const mk = (x: number): THREE.Group => {
    const { pivot } = limb(cloth, 0.05, 0.85);
    pivot.position.set(x, 1.75, 0);
    const rag = tatter(cloth, 0.06, 0.4, 4, 5); rag.position.y = -0.8;
    pivot.add(rag);
    return pivot;
  };
  const armL = mk(-0.24), armR = mk(0.24);
  top.add(chest, hood, face, armL, armR);
  const mist: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xa8acb0, transparent: true, opacity: 0.2, depthWrite: false }));
    s.scale.setScalar(0.9);
    mist.push(s); root.add(s);
  }
  root.add(robe, hem, top);
  return { root, mats: [cloth, dark, ...mist.map((s) => s.material)], armL, armR, top, mist };
}

/** 黑影（CHR-03）：炭黑低伏的异形披布，四肢拖地，边缘冷灰反光。 */
function buildWraith(tex: THREE.Texture): { root: THREE.Group; mats: THREE.Material[]; legs: THREE.Group[]; shell: THREE.Group; mist: THREE.Sprite[] } {
  const root = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x141518, emissive: 0x39424c, emissiveIntensity: 0.5, roughness: 1, transparent: true, side: THREE.DoubleSide });
  const rim = new THREE.MeshBasicMaterial({ color: 0x8e9aa6, transparent: true, opacity: 0.55, side: THREE.BackSide });
  const shell = new THREE.Group();
  const back = mesh(new THREE.SphereGeometry(0.5, 10, 7), cloth, false); back.scale.set(0.8, 0.5, 1.5); back.position.y = 0.72;
  // 冷灰轮廓光：略大一圈的背面壳，暗背景上勾出轮廓与朝向
  const halo = mesh(new THREE.SphereGeometry(0.5, 10, 7), rim, false); halo.scale.set(0.86, 0.56, 1.58); halo.position.y = 0.72;
  const hood = mesh(new THREE.ConeGeometry(0.26, 0.6, 7), cloth, false); hood.position.set(0, 0.82, -0.78); hood.rotation.x = -1.15;
  const hoodRim = mesh(new THREE.ConeGeometry(0.29, 0.66, 7), rim, false); hoodRim.position.copy(hood.position); hoodRim.rotation.x = -1.15;
  const drape = tatter(cloth, 0.3, 0.7, 12, 4); drape.scale.set(1, 1, 2.1); drape.position.y = 0.72;
  shell.add(back, halo, hood, hoodRim, drape);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.42, -0.52], [0.42, -0.52], [-0.38, 0.5], [0.38, 0.5]]) {
    const { pivot } = limb(cloth, 0.07, 0.8);
    pivot.position.set(x, 0.74, z);
    const rag = tatter(cloth, 0.07, 0.35, 4, 6); rag.position.y = -0.65;
    pivot.add(rag);
    legs.push(pivot); root.add(pivot);
  }
  const mist: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x20242a, transparent: true, opacity: 0.3, depthWrite: false }));
    s.scale.setScalar(0.8);
    mist.push(s); root.add(s);
  }
  root.add(shell);
  return { root, mats: [cloth, rim, ...mist.map((s) => s.material)], legs, shell, mist };
}

export class GhostModels {
  readonly group = new THREE.Group();
  private grey: ReturnType<typeof buildGrey>;
  private wraith: ReturnType<typeof buildWraith>;
  private base = new Map<THREE.Material, number>();
  private ph = { grey: 0, wraith: 0 };

  constructor() {
    const tex = glowTexture();
    this.grey = buildGrey(tex);
    this.wraith = buildWraith(tex);
    for (const mat of [...this.grey.mats, ...this.wraith.mats]) this.base.set(mat, mat.opacity);
    this.group.add(this.grey.root, this.wraith.root);
    this.grey.root.visible = this.wraith.root.visible = false;
  }

  private fade(mats: THREE.Material[], k: number): void {
    for (const mat of mats) mat.opacity = (this.base.get(mat) ?? 1) * k;
  }

  /** at 与 w.ghosts 按下标对应，是插值后的位置。 */
  update(w: World, at: { x: number; z: number }[], dt: number, time: number): void {
    this.grey.root.visible = this.wraith.root.visible = false;
    w.ghosts.forEach((g, i) => {
      if (g.kind === 'grey') this.updateGrey(g, at[i] ?? g, dt, time);
      else this.updateWraith(g, at[i] ?? g, dt, time);
    });
  }

  private place(root: THREE.Group, g: GhostState, at: { x: number; z: number }): number {
    root.visible = g.mode !== 'gone';
    root.position.set(at.x, groundY(at.x, at.z), -at.z);
    root.rotation.y = yawToRot(g.yaw);
    return g.mode === 'dissolve' ? Math.max(0, 1 - g.t / GHOST.dissolveSecs) : 1;
  }

  private updateGrey(g: GhostState, at: { x: number; z: number }, dt: number, time: number): void {
    const m = this.grey;
    const alpha = this.place(m.root, g, at);
    this.fade(m.mats, alpha);
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    this.ph.grey += dt * (g.mode === 'chase' ? 6 : 3) * (moving ? 1 : 0.3);
    const sway = Math.sin(this.ph.grey);
    let armL = 0.12 + sway * 0.12, armR = 0.12 - sway * 0.12, lean = 0, turn = 0, lift = 0;
    switch (g.mode) {
      case 'alert': turn = Math.sin(Math.min(1, g.t / 0.35) * Math.PI * 0.5) * 0.5 * (1 - g.t / GHOST.alertPause); lean = -0.06; break;
      case 'chase': armL = armR = 1.2 + sway * 0.1; lean = 0.28; break;
      case 'windup': {
        // 扑击前摇：双臂高举后仰，判定帧在前摇结束
        const k = Math.min(1, g.t / GHOST.grey.windup);
        armL = armR = lerp(1.2, 2.9, k); lean = lerp(0.2, -0.3, k); lift = k * 0.12;
        break;
      }
      case 'recover': { const k = Math.min(1, g.t / 0.25); armL = armR = lerp(2.9, 0.5, k); lean = lerp(0.6, 0.15, Math.min(1, g.t / 0.9)); break; }
      case 'recoil': case 'flee': armL = armR = 2.1; lean = -0.38; break;
      case 'bang': { const k = Math.abs(Math.sin((g.t / 0.7) * Math.PI)); armL = armR = lerp(1.4, 2.4, k); lean = 0.1 + k * 0.2; break; }
      case 'dissolve': lift = (1 - alpha) * 0.9; armL = armR = 0.6; break;
    }
    const k = Math.min(1, dt * 12);
    m.armL.rotation.x = lerp(m.armL.rotation.x, armL, k);
    m.armR.rotation.x = lerp(m.armR.rotation.x, armR, k);
    m.top.rotation.x = lerp(m.top.rotation.x, lean, k);
    m.top.rotation.y = lerp(m.top.rotation.y, turn, k);
    m.root.position.y += lift + Math.sin(time * 1.7) * 0.03;
    m.mist.forEach((s, i) => {
      s.position.set(Math.cos(time * 0.9 + i * 1.6) * 0.35, 0.18 + 0.1 * Math.sin(time * 1.3 + i), Math.sin(time * 0.7 + i * 1.6) * 0.35);
      s.scale.setScalar(0.8 + (1 - alpha) * 1.6);
    });
  }

  private updateWraith(g: GhostState, at: { x: number; z: number }, dt: number, time: number): void {
    const m = this.wraith;
    const alpha = this.place(m.root, g, at);
    this.fade(m.mats, alpha);
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    this.ph.wraith += dt * (g.mode === 'chase' ? 11 : 5.5) * (moving ? 1 : 0);
    let rear = 0, crouch = 0, flare = 1, lift = 0;
    switch (g.mode) {
      case 'alert': rear = 0.45 * Math.min(1, g.t / 0.3); break;
      case 'chase': crouch = -0.1; break;
      case 'windup': {
        // 扑击前摇：先压低，再扬起披布
        const k = Math.min(1, g.t / GHOST.wraith.windup);
        rear = lerp(0.1, 0.75, k); flare = 1 + k * 0.55; crouch = -0.16 * (1 - k);
        break;
      }
      case 'recover': rear = lerp(-0.3, 0, Math.min(1, g.t / 0.6)); crouch = -0.12; break;
      case 'recoil': case 'flee': crouch = -0.26; flare = 0.85; break;
      case 'dissolve': lift = (1 - alpha) * 0.4; flare = 1 + (1 - alpha) * 0.8; break;
    }
    const k = Math.min(1, dt * 10);
    m.shell.rotation.x = lerp(m.shell.rotation.x, rear, k);
    m.shell.position.y = lerp(m.shell.position.y, crouch + lift, k);
    m.shell.scale.x = lerp(m.shell.scale.x, flare, k);
    m.shell.scale.y = lerp(m.shell.scale.y, 1 + (flare - 1) * 0.6, k);
    m.legs.forEach((leg, i) => {
      // 对角步态
      const diag = i === 0 || i === 3 ? 0 : Math.PI;
      const front = i < 2;
      const s = Math.sin(this.ph.wraith + diag);
      leg.rotation.x = (front ? -0.35 : 0.35) + s * (moving ? 0.5 : 0.04) + (front ? -rear * 1.1 : 0);
      leg.rotation.z = (i % 2 === 0 ? 0.3 : -0.3) * flare;
      leg.position.y = 0.74 + crouch + (front ? rear * 0.5 : 0);
    });
    m.mist.forEach((s, i) => {
      s.position.set(Math.cos(time * 1.1 + i * 2.1) * 0.5, 0.12, Math.sin(time * 0.8 + i * 2.1) * 0.8);
      s.scale.setScalar(0.8 + (1 - alpha) * 1.5);
    });
  }
}
