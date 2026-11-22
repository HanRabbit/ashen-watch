// 角色模型（CHR-01…03）与动画（ANM-01、02、04）：守夜人、灰影、黑影。
// art pass 2：优先使用 Objaverse CC-BY 骨骼模型（characterAssets.ts），加载失败回退程序化拼装。
// 模型根节点以米为单位，原点在脚下地面，面朝本地 -Z。双鬼用菲涅尔边缘光在暗背景上勾出轮廓。
import * as THREE from 'three';
import { GHOST, PLAYER } from '../config';
import { groundY } from '../sim/level';
import { GhostState, World } from '../sim/state';
import { CharacterAssets, CreatureAsset, HunterAsset, ReaperAsset, loadCharacterAssets } from './characterAssets';
import { cyl, lerp, mesh, yawToRot } from './geom';
import { Materials, glowTexture, smokeTexture } from './materials';
import { makeClapper, makeLantern } from './props';
import { SoftParticles } from './vfx';

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

// ---------------------------------------------------------------------------
// 程序化回退模型（保留旧代码，离线/加载失败时启用）。
// ---------------------------------------------------------------------------

class ProceduralPlayer {
  readonly group = new THREE.Group();
  private legL: THREE.Group; private legR: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private body = new THREE.Group();
  private lantern: Lantern;
  private clapper: THREE.Group;
  private cloak: THREE.Mesh;
  private phase = 0;
  private raise = 0;
  private hurt = 0;

  constructor(m: Materials, tex: THREE.Texture, private light: THREE.PointLight, lantern: Lantern, clapper: THREE.Group) {
    const coat = new THREE.MeshStandardMaterial({ color: 0x444943, roughness: 0.95 });
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x38332b, roughness: 1, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a7262, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1f1b17, roughness: 0.9 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.8 });
    const linen = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1 });
    const faceShadow = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 });

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
    const nose = mesh(new THREE.ConeGeometry(0.02, 0.04, 5), skin); nose.position.set(0, 1.65, -0.12); nose.rotation.x = -Math.PI / 2;
    const face = mesh(new THREE.SphereGeometry(0.1, 12, 9), faceShadow); face.position.set(0, 1.66, -0.045);
    const hood = mesh(new THREE.SphereGeometry(0.16, 14, 12, 0, Math.PI * 2, 0, 2.1), cloakMat); hood.position.set(0, 1.68, 0.035);
    const hoodTip = mesh(new THREE.ConeGeometry(0.05, 0.14, 6), cloakMat); hoodTip.position.set(0, 1.78, 0.12); hoodTip.rotation.x = 0.5;
    const cloakGeo = new THREE.CylinderGeometry(0.27, 0.42, 1.08, 16, 4, true, -1.35, 2.7);
    const cp = cloakGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      if (cp.getY(i) < -0.5) cp.setY(i, cp.getY(i) + Math.sin(cp.getX(i) * 9) * 0.06);
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

    this.body.add(torso, belt, buckle, pouch1, pouch2, strap, satchel, flap, scarf, clasp, head, nose, face, hood, hoodTip, this.cloak, bedroll, this.armL, this.armR, this.clapper);
    this.group.add(this.legL, this.legR, this.body);
  }

  triggerHurt(): void { this.hurt = 1; }

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
    this.light.intensity = on ? (lan.raised ? 30 : 13) * flick * low : 0;
    this.light.distance = lan.raised ? 17 : 12;
    this.light.position.y = lerp(1.2, 1.95, this.raise);
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

function buildGrey(tex: THREE.Texture): { root: THREE.Group; mats: THREE.Material[]; armL: THREE.Group; armR: THREE.Group; top: THREE.Group; mist: THREE.Sprite[] } {
  const root = new THREE.Group();
  const cloth = rim(new THREE.MeshStandardMaterial({ color: 0xb6b4ad, emissive: 0x6e747a, emissiveIntensity: 0.45, roughness: 1, transparent: true, side: THREE.DoubleSide }), 0xa8aeb6, 0.55);
  const dark = new THREE.MeshBasicMaterial({ color: 0x060708, transparent: true });
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xa8acb0, transparent: true, opacity: 0.22, depthWrite: false }));
    s.scale.setScalar(0.9);
    mist.push(s); root.add(s);
  }
  root.add(robe, hem, top);
  return { root, mats: [cloth, dark, ...mist.map((s) => s.material)], armL, armR, top, mist };
}

function buildWraith(tex: THREE.Texture): { root: THREE.Group; mats: THREE.Material[]; legs: THREE.Group[]; shell: THREE.Group; mist: THREE.Sprite[] } {
  const root = new THREE.Group();
  const cloth = rim(new THREE.MeshStandardMaterial({ color: 0x141518, emissive: 0x2c343c, emissiveIntensity: 0.4, roughness: 1, transparent: true, side: THREE.DoubleSide }), 0x9aa6b2, 0.7, 2.2);
  const shell = new THREE.Group();
  const backGeo = new THREE.SphereGeometry(0.5, 12, 9);
  const bp = backGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const n = 1 + Math.sin(bp.getX(i) * 6 + bp.getY(i) * 4) * 0.08;
    bp.setXYZ(i, bp.getX(i) * n, bp.getY(i) * n, bp.getZ(i) * n);
  }
  backGeo.computeVertexNormals();
  const back = mesh(backGeo, cloth, false); back.scale.set(0.8, 0.5, 1.5); back.position.y = 0.72;
  const hood = mesh(new THREE.ConeGeometry(0.26, 0.62, 8), cloth, false); hood.position.set(0, 0.82, -0.78); hood.rotation.x = -1.15;
  for (let i = 0; i < 5; i++) {
    const spike = mesh(new THREE.ConeGeometry(0.05, 0.22 - i * 0.02, 4), cloth, false);
    spike.position.set(0, 0.95 - i * 0.02, -0.4 + i * 0.28);
    spike.rotation.x = -0.3;
    shell.add(spike);
  }
  const drape = tatter(cloth, 0.3, 0.7, 12, 4); drape.scale.set(1, 1, 2.1); drape.position.y = 0.72;
  shell.add(back, hood, drape);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.42, -0.52], [0.42, -0.52], [-0.38, 0.5], [0.38, 0.5]]) {
    const { pivot } = limb(cloth, 0.07, 0.8);
    pivot.position.set(x, 0.74, z);
    const rag = tatter(cloth, 0.07, 0.35, 4, 6); rag.position.y = -0.65;
    const claw = mesh(new THREE.ConeGeometry(0.05, 0.14, 4), cloth, false); claw.position.y = -0.82; claw.rotation.x = Math.PI;
    pivot.add(rag, claw);
    legs.push(pivot); root.add(pivot);
  }
  const mist: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x20242a, transparent: true, opacity: 0.32, depthWrite: false }));
    s.scale.setScalar(0.8);
    mist.push(s); root.add(s);
  }
  root.add(shell);
  return { root, mats: [cloth, ...mist.map((s) => s.material)], legs, shell, mist };
}

class ProceduralGhosts {
  readonly group = new THREE.Group();
  private grey: ReturnType<typeof buildGrey>;
  private wraith: ReturnType<typeof buildWraith>;
  private base = new Map<THREE.Material, number>();
  private ph = { grey: 0, wraith: 0 };

  constructor() {
    const tex = smokeTexture();
    this.grey = buildGrey(tex);
    this.wraith = buildWraith(tex);
    for (const mat of [...this.grey.mats, ...this.wraith.mats]) this.base.set(mat, mat.opacity);
    this.group.add(this.grey.root, this.wraith.root);
    this.grey.root.visible = this.wraith.root.visible = false;
  }

  private fade(mats: THREE.Material[], k: number): void {
    for (const mat of mats) mat.opacity = (this.base.get(mat) ?? 1) * k;
  }

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

// ---------------------------------------------------------------------------
// 资产驱动的守夜人：mixamo 骨骼 + baked Idle + authored Walk/Run 交叉淡入。
// ---------------------------------------------------------------------------

const cloakFlutter = { uTime: { value: 0 }, uSway: { value: 0 } };

function makeHoodAndCloak(m: Materials): { hood: THREE.Group; cloakPivot: THREE.Group; cloakMat: THREE.MeshStandardMaterial } {
  const cloakMat = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 1, side: THREE.DoubleSide });
  cloakMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, cloakFlutter);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        float hem = smoothstep(0.1, -0.45, position.y);
        transformed.x += sin(uTime * 3.1 + position.y * 6.0 + position.z * 3.0) * 0.022 * (0.3 + uSway) * hem;
        transformed.z += cos(uTime * 2.4 + position.x * 5.0) * 0.018 * (0.3 + uSway) * hem;`);
  };
  cloakMat.customProgramCacheKey = () => 'cloakFlutter';
  const faceShadow = new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 1 });
  // 兜帽（头 bone 本地：+Y 上，+Z 前）：开口朝前下的穹顶 + 兜帽尖 + 脸部虚空
  const hood = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, 2.05), cloakMat);
  shell.rotation.x = -0.5;
  shell.position.set(0, 0.1, 0.0);
  const tip = mesh(new THREE.ConeGeometry(0.05, 0.16, 6), cloakMat);
  tip.position.set(0, 0.2, -0.1); tip.rotation.x = 0.6;
  const voidFace = mesh(new THREE.SphereGeometry(0.112, 12, 9), faceShadow, false);
  voidFace.position.set(0, 0.09, 0.05);
  hood.add(shell, tip, voidFace);
  // 斗篷（胸椎 bone 本地）：背面披挂，波浪下摆
  const cloakGeo = new THREE.CylinderGeometry(0.23, 0.4, 0.95, 16, 5, true, Math.PI - 1.35, 2.7);
  const cp = cloakGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    if (cp.getY(i) < -0.42) cp.setY(i, cp.getY(i) + Math.sin(cp.getX(i) * 9) * 0.05);
  }
  cloakGeo.computeVertexNormals();
  const cloakPivot = new THREE.Group();
  const cloak = mesh(cloakGeo, cloakMat);
  cloakPivot.add(cloak);
  cloakPivot.position.set(0, -0.42, -0.03);
  const collar = mesh(new THREE.TorusGeometry(0.145, 0.035, 8, 14), cloakMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.03, 0);
  cloakPivot.add(collar);
  void m;
  return { hood, cloakPivot, cloakMat };
}

export class PlayerModel {
  readonly group = new THREE.Group();
  readonly lanternLight = new THREE.PointLight(0xffa550, 0, 13, 1.5);
  private procedural: ProceduralPlayer;
  private lantern: Lantern;
  private clapper: THREE.Group;
  private asset: HunterAsset | null = null;
  private actions: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction } | null = null;
  private current: THREE.AnimationAction | null = null;
  private rotS: number | null = null;
  private raise = 0;
  private hurt = 0;
  private cloakPivot: THREE.Group | null = null;
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();

  constructor(m: Materials, tex: THREE.Texture) {
    this.lantern = makeLantern(m, tex);
    this.clapper = makeClapper(m);
    this.procedural = new ProceduralPlayer(m, tex, this.lanternLight, this.lantern, this.clapper);
    this.group.add(this.procedural.group, this.lanternLight);
    void loadCharacterAssets().then((a) => { if (a) this.attachAsset(a.hunter, m); });
  }

  private attachAsset(a: HunterAsset, m: Materials): void {
    this.asset = a;
    this.procedural.group.visible = false;
    this.group.add(a.root);
    const { idle, walk, run } = a.clips;
    this.actions = { idle: a.mixer.clipAction(idle), walk: a.mixer.clipAction(walk), run: a.mixer.clipAction(run) };
    this.actions.idle.play();
    this.current = this.actions.idle;
    // 提灯挂右手；兜帽挂头；斗篷挂胸椎
    this.lantern.group.position.set(0, -0.14, 0.02);
    a.handAnchor.add(this.lantern.group);
    const { hood, cloakPivot } = makeHoodAndCloak(m);
    a.headAnchor.add(hood);
    a.chestAnchor.add(cloakPivot);
    this.cloakPivot = cloakPivot;
    this.clapper.position.set(-0.16, -0.42, -0.16);
    this.clapper.rotation.z = 0.5;
    a.chestAnchor.add(this.clapper);
  }

  triggerHurt(): void {
    this.hurt = 1;
    this.procedural.triggerHurt();
  }

  update(w: World, at: { x: number; z: number }, yaw: number, dt: number, time: number): void {
    if (!this.asset || !this.actions) {
      this.procedural.update(w, at, yaw, dt, time);
      return;
    }
    const a = this.asset;
    const p = w.player;
    this.group.position.set(at.x, groundY(at.x, at.z), -at.z);
    // 转身惯性：偏航平滑
    const target = yawToRot(yaw);
    if (this.rotS === null) this.rotS = target;
    let d = target - this.rotS;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rotS += d * Math.min(1, dt * 10);
    this.group.rotation.y = this.rotS;

    const speed = p.moving ? (p.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) : 0;
    const want = speed > 2.2 ? this.actions.run : speed > 0.01 ? this.actions.walk : this.actions.idle;
    if (want !== this.current) {
      want.reset().play();
      this.current?.crossFadeTo(want, 0.25, true);
      this.current = want;
    }
    this.actions.walk.timeScale = THREE.MathUtils.clamp(speed / PLAYER.walkSpeed, 0.4, 1.8);
    this.actions.run.timeScale = THREE.MathUtils.clamp(speed / PLAYER.sprintSpeed, 0.4, 1.6);
    a.mixer.update(dt);

    // 持灯/举灯：mixer 之后叠加右臂姿态
    const lan = w.lantern;
    this.raise = lerp(this.raise, lan.raised ? 1 : 0, Math.min(1, dt * 9));
    const b = a.bones;
    if (w.inv.hasLantern && b.armR && b.foreArmR) {
      this.tmpE.set(lerp(-0.12, -1.75, this.raise), 0, lerp(-0.1, 0, this.raise));
      this.tmpQ.setFromEuler(this.tmpE);
      b.armR.quaternion.slerp(this.tmpQ, 0.85);
      this.tmpE.set(lerp(-0.32, -0.2, this.raise), 0, 0);
      this.tmpQ.setFromEuler(this.tmpE);
      b.foreArmR.quaternion.slerp(this.tmpQ, 0.85);
    }
    // 受击 flinch
    this.hurt = Math.max(0, this.hurt - dt * 3);
    if (this.hurt > 0 && b.spine) {
      this.tmpE.set(this.hurt * 0.32, 0, 0);
      this.tmpQ.setFromEuler(this.tmpE);
      b.spine.quaternion.multiply(this.tmpQ);
    }
    // 提灯保持世界竖直 + 轻微钟摆
    this.lantern.group.visible = w.inv.hasLantern;
    a.handAnchor.getWorldQuaternion(this.tmpQ);
    this.lantern.group.quaternion.copy(this.tmpQ).invert();
    this.tmpE.set(0, 0, Math.sin(time * 2.2) * 0.05 * (p.moving ? 1 : 0.3));
    this.tmpQ.setFromEuler(this.tmpE);
    this.lantern.group.quaternion.multiply(this.tmpQ);
    this.clapper.visible = w.inv.hasClapper;
    // 斗篷 follow-through：速度/转身滞后
    cloakFlutter.uTime.value = time;
    cloakFlutter.uSway.value = lerp(cloakFlutter.uSway.value, (speed / PLAYER.sprintSpeed) + Math.abs(d) * 2, Math.min(1, dt * 5));
    if (this.cloakPivot) {
      this.cloakPivot.rotation.x = lerp(this.cloakPivot.rotation.x, -0.03 - (speed / PLAYER.sprintSpeed) * 0.16, Math.min(1, dt * 6));
    }

    const on = w.inv.hasLantern && lan.on && lan.oil > 0;
    const flick = 0.9 + 0.07 * Math.sin(time * 12.7) + 0.05 * Math.sin(time * 27.1 + 2);
    const low = lan.oil < 20 ? 0.55 + 0.45 * Math.abs(Math.sin(time * 5)) : 1;
    this.lanternLight.intensity = on ? (lan.raised ? 30 : 13) * flick * low : 0;
    this.lanternLight.distance = lan.raised ? 17 : 12;
    this.lantern.group.getWorldPosition(this.tmpV);
    this.group.worldToLocal(this.tmpV);
    this.lanternLight.position.copy(this.tmpV);
    this.lantern.glow.visible = on;
    this.lantern.glass.emissiveIntensity = on ? 2.4 * flick : 0;
  }
}

// ---------------------------------------------------------------------------
// 资产驱动的双鬼：灰影 = 破袍 Reaper（布料飘动/溶解着色器），黑影 = 烟雾 Creature（残影）。
// ---------------------------------------------------------------------------

function afterimageMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const u = { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.2 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uColor; uniform float uOpacity;')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float af = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.0);
        totalEmissiveRadiance = uColor * af * uOpacity * 3.0;
        diffuseColor.a = af * uOpacity;`);
  };
  mat.customProgramCacheKey = () => 'afterimage';
  mat.userData.uni = u;
  return mat;
}

export class GhostModels {
  readonly group = new THREE.Group();
  private procedural: ProceduralGhosts;
  private reaper: ReaperAsset | null = null;
  private creature: CreatureAsset | null = null;
  private eyes: THREE.Sprite[] = [];
  private greyTrail = new SoftParticles(140, false);
  private wraithTrail = new SoftParticles(140, false);
  private trailAcc = { grey: 0, wraith: 0 };
  private echoes: { mesh: THREE.SkinnedMesh; mat: THREE.MeshStandardMaterial; age: number }[] = [];
  private history: { t: number; p: THREE.Vector3 }[] = [];
  private tmpV = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private idleAction: THREE.AnimationAction | null = null;

  constructor() {
    this.procedural = new ProceduralGhosts();
    this.group.add(this.procedural.group, this.greyTrail.points, this.wraithTrail.points);
    void loadCharacterAssets().then((a) => { if (a) this.attachAssets(a); });
  }

  private attachAssets(a: CharacterAssets): void {
    this.procedural.group.visible = false;
    this.reaper = a.reaper;
    this.creature = a.creature;
    this.group.add(a.reaper.root, a.creature.root);
    a.reaper.root.visible = a.creature.root.visible = false;
    // 兜帽内两点极暗冷光
    const eyeTex = glowTexture();
    for (const x of [-0.045, 0.045]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex, color: 0x8fa3b8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(x, 1.86, -0.19);
      s.scale.setScalar(0.055);
      a.reaper.root.add(s);
      this.eyes.push(s);
    }
    // 黑影残影：共享骨骼的附加网格，矩阵 = 历史位移 × 当前世界矩阵
    const src = a.creature.mesh;
    for (const [age, op] of [[0.07, 0.2], [0.14, 0.1]] as [number, number][]) {
      const mat = afterimageMaterial(0x6d7a88);
      mat.userData.uOpacity = op;
      const im = new THREE.SkinnedMesh(src.geometry, mat);
      im.skeleton = src.skeleton;
      im.bindMatrix.copy(src.bindMatrix);
      im.bindMatrixInverse.copy(src.bindMatrixInverse);
      im.frustumCulled = false;
      im.matrixAutoUpdate = false;
      im.visible = false;
      this.group.add(im);
      this.echoes.push({ mesh: im, mat, age });
    }
    // 静息烟雾团：给躯体体积感
    const mistTex = smokeTexture();
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: 0x232a33, transparent: true, opacity: 0.3, depthWrite: false }));
      sp.scale.setScalar(0.7 + (i % 3) * 0.2);
      sp.position.set(Math.cos(i * 2.4) * 0.3, 0.5 + (i % 4) * 0.22, Math.sin(i * 2.4) * 0.35);
      a.creature.root.add(sp);
    }
    if (a.creature.idle) {
      this.idleAction = a.creature.mixer.clipAction(a.creature.idle);
      this.idleAction.play();
    }
  }

  update(w: World, at: { x: number; z: number }[], dt: number, time: number): void {
    this.greyTrail.update(dt);
    this.wraithTrail.update(dt);
    if (!this.reaper || !this.creature) {
      this.procedural.update(w, at, dt, time);
      return;
    }
    this.reaper.root.visible = this.creature.root.visible = false;
    for (const e of this.echoes) e.mesh.visible = false;
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
    const a = this.reaper!;
    const u = a.cloth;
    const alpha = this.place(a.root, g, at);
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    let lean = 0.06, arm = 0.08, lift = 0, flutter = 0.022, rimS = 0.5;
    const sway = Math.sin(time * (g.mode === 'chase' ? 6 : 3));
    switch (g.mode) {
      case 'alert': lean = -0.06; arm = 0.2; break;
      case 'chase': lean = 0.3; arm = 0.55 + sway * 0.06; flutter = 0.07; rimS = 0.65; break;
      case 'windup': {
        const k = Math.min(1, g.t / GHOST.grey.windup);
        lean = lerp(0.2, -0.35, k); arm = lerp(0.5, 1.35, k); lift = k * 0.12; flutter = 0.09; rimS = lerp(0.65, 1.0, k);
        break;
      }
      case 'recover': { const k = Math.min(1, g.t / 0.25); arm = lerp(1.35, 0.1, k); lean = lerp(0.5, 0.1, Math.min(1, g.t / 0.9)); break; }
      case 'recoil': case 'flee': lean = -0.4; arm = 0.9; flutter = 0.08; break;
      case 'bang': { const k = Math.abs(Math.sin((g.t / 0.7) * Math.PI)); arm = lerp(0.6, 1.1, k); lean = 0.1 + k * 0.2; break; }
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
    for (const e of this.eyes) {
      (e.material as THREE.SpriteMaterial).opacity = alpha * (0.4 + 0.2 * Math.sin(time * 2.3));
      e.visible = g.mode !== 'dissolve';
    }
    // 身后烟雾拖尾
    if (moving && alpha > 0.5) {
      this.trailAcc.grey += dt * 16;
      while (this.trailAcc.grey > 1) {
        this.trailAcc.grey -= 1;
        const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
        this.tmpV.set(at.x - sy * 0.35, groundY(at.x, at.z) + 0.25 + Math.random() * 0.5, -(at.z - cy * 0.35));
        this.greyTrail.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.18, 0), spread: 0.4, life: 1.1, size: 0.24, grow: 1.6, color: new THREE.Color(0x8b939c), drag: 1.2 });
      }
    }
  }

  private updateWraith(g: GhostState, at: { x: number; z: number }, dt: number, time: number): void {
    const a = this.creature!;
    const u = a.skin;
    const alpha = this.place(a.root, g, at);
    a.root.rotation.order = 'YXZ';
    const moving = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'chase' || g.mode === 'flee';
    const speed = g.mode === 'chase' ? GHOST.wraith.chaseSpeed : moving ? GHOST.wraith.patrolSpeed : 0;
    let rear = 0, crouch = 0, flare = 1, lift = 0, rimS = 0.85;
    switch (g.mode) {
      case 'alert': rear = 0.45 * Math.min(1, g.t / 0.3); rimS = 1.1; break;
      case 'chase': crouch = -0.1; rear = -0.12; break;
      case 'windup': {
        const k = Math.min(1, g.t / GHOST.wraith.windup);
        rear = lerp(0.1, 0.8, k); flare = 1 + k * 0.5; crouch = -0.16 * (1 - k); rimS = lerp(0.85, 1.3, k);
        break;
      }
      case 'recover': rear = lerp(-0.35, 0, Math.min(1, g.t / 0.6)); crouch = -0.12; break;
      case 'recoil': case 'flee': crouch = -0.26; flare = 0.85; break;
      case 'dissolve': lift = (1 - alpha) * 0.4; flare = 1 + (1 - alpha) * 0.8; break;
    }
    if (this.idleAction) this.idleAction.timeScale = g.mode === 'chase' ? 1.7 : 1;
    a.mixer.update(dt);
    const k = Math.min(1, dt * 10);
    a.root.rotation.x = lerp(a.root.rotation.x, -0.16 + rear * 0.5, k);
    a.root.scale.x = lerp(a.root.scale.x, flare, k);
    a.root.scale.y = lerp(a.root.scale.y, 1 + (flare - 1) * 0.6, k);
    a.root.scale.z = lerp(a.root.scale.z, flare, k);
    a.root.position.y += crouch + lift + (moving ? Math.abs(Math.sin(time * 9)) * 0.03 : 0);
    for (const s of a.spine) s.rotation.x = rear * 0.16;
    u.uTime.value = time;
    u.uOpacity.value = alpha * 0.95;
    u.uErode.value = 0.22 + (1 - alpha) * 0.6;
    u.uRim.value = lerp(u.uRim.value, rimS, k);
    // 残影：高速移动时拖两道回声
    const src = a.mesh;
    src.updateWorldMatrix(true, false);
    this.history.push({ t: time, p: src.getWorldPosition(new THREE.Vector3()) });
    while (this.history.length > 40) this.history.shift();
    const fast = speed > 1.6 && alpha > 0.6;
    for (const e of this.echoes) {
      const want = time - e.age;
      let best: { t: number; p: THREE.Vector3 } | null = null;
      for (const h of this.history) if (h.t <= want) best = h;
      if (fast && best) {
        src.getWorldPosition(this.tmpV);
        this.tmpV.subVectors(best.p, this.tmpV);
        e.mesh.matrix.copy(this.tmpM.makeTranslation(this.tmpV.x, this.tmpV.y, this.tmpV.z)).multiply(src.matrixWorld);
        e.mesh.matrixWorldNeedsUpdate = true;
        e.mesh.visible = true;
        const uni = e.mat.userData.uni as { uOpacity: { value: number } };
        uni.uOpacity.value = ((e.mat.userData.uOpacity as number) ?? 0.2) * (speed / GHOST.wraith.chaseSpeed);
      } else {
        e.mesh.visible = false;
      }
    }
    // 黑烟拖尾
    if (moving && alpha > 0.5) {
      this.trailAcc.wraith += dt * 14;
      while (this.trailAcc.wraith > 1) {
        this.trailAcc.wraith -= 1;
        const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
        this.tmpV.set(at.x - sy * 0.5, groundY(at.x, at.z) + 0.2 + Math.random() * 0.4, -(at.z - cy * 0.5));
        this.wraithTrail.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.15, 0), spread: 0.5, life: 0.9, size: 0.26, grow: 1.8, color: new THREE.Color(0x1c2128), drag: 1.4 });
      }
    }
  }
}