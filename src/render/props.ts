// 随状态变化的道具：门扇、门闩、栅门、壁灯、拾取件、祭台匣、晨钟、炉火（PRP-01…09、ANM-03 的程序化占位）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRAZIER, BrazierId, HEARTH, LightZone, WALL_LAMP } from '../config';
import { BELL_POS, BRAZIER_POS, LAMP_POS, RAISED_Y } from '../sim/level';
import { World } from '../sim/state';
import { archLeaf, boxMesh, cyl, halfArchLeaf, lerp, mesh, put } from './geom';
import { glowTexture, Materials } from './materials';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

function glowSprite(tex: THREE.Texture, color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

function flame(m: Materials, tex: THREE.Texture, size: number): THREE.Group {
  const g = new THREE.Group();
  const core = mesh(new THREE.ConeGeometry(size * 0.32, size, 7), m.flame, false);
  core.position.y = size * 0.5;
  g.add(core, glowSprite(tex, 0xffa040, size * 3.2));
  g.children[1].position.y = size * 0.45;
  return g;
}

export function makeLantern(m: Materials, tex: THREE.Texture): { group: THREE.Group; glow: THREE.Object3D; glass: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xffa640, emissiveIntensity: 0, roughness: 0.4, transparent: true, opacity: 0.85 });
  const base = cyl(m.iron, 0.085, 0.095, 0.04, 8); base.position.y = -0.2;
  const body = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 8), glass, false); body.position.y = -0.1;
  const hood = mesh(new THREE.ConeGeometry(0.11, 0.09, 8), m.iron); hood.position.y = 0.03;
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.009, 5, 10), m.iron); ring.position.y = 0.12;
  const posts = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const p = boxMesh(m.iron, 0.012, 0.17, 0.012, 1);
    p.position.set(Math.cos(i * HALF_PI) * 0.075, -0.1, Math.sin(i * HALF_PI) * 0.075);
    posts.add(p);
  }
  const glow = glowSprite(tex, 0xffa848, 0.55);
  glow.position.y = -0.1;
  group.add(base, body, hood, ring, posts, glow);
  return { group, glow, glass };
}

export function makeClapper(m: Materials): THREE.Group {
  const g = new THREE.Group();
  const loop = mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 10), m.iron); loop.position.y = 0.3;
  const stem = cyl(m.iron, 0.02, 0.035, 0.34, 7); stem.position.y = 0.1;
  const bulb = mesh(new THREE.SphereGeometry(0.085, 10, 8), m.iron); bulb.position.y = -0.1; bulb.scale.y = 1.25;
  g.add(loop, stem, bulb);
  return g;
}

function woodBundle(m: Materials): THREE.Group {
  const g = new THREE.Group();
  for (const [x, y] of [[-0.07, 0], [0.07, 0], [0, 0.11]]) {
    const l = cyl(m.wood, 0.065, 0.065, 0.55, 7);
    l.rotation.x = HALF_PI; l.position.set(x, y + 0.065, 0);
    g.add(l);
  }
  const tie = mesh(new THREE.TorusGeometry(0.12, 0.012, 5, 10), m.cloth); tie.position.y = 0.09;
  g.add(tie);
  return g;
}

function ironPack(m: Materials): THREE.Group {
  const g = new THREE.Group();
  const bag = boxMesh(m.cloth, 0.3, 0.14, 0.22, 1); bag.position.y = 0.07;
  const bar = boxMesh(m.iron, 0.34, 0.03, 0.04, 1); bar.position.set(0, 0.16, 0.03); bar.rotation.y = 0.3;
  const hook = mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 8, Math.PI * 1.3), m.iron); hook.position.set(-0.05, 0.17, -0.05); hook.rotation.x = HALF_PI;
  g.add(bag, bar, hook);
  return g;
}

function oilFlask(m: Materials): THREE.Group {
  const g = new THREE.Group();
  const oil = new THREE.MeshStandardMaterial({ color: 0xb8741c, emissive: 0x7a4208, emissiveIntensity: 0.35, roughness: 0.3, transparent: true, opacity: 0.9 });
  const body = mesh(new THREE.SphereGeometry(0.09, 10, 8), oil); body.position.y = 0.085; body.scale.y = 0.9;
  const neck = cyl(m.glass, 0.025, 0.035, 0.07, 7); neck.position.y = 0.19;
  const cork = cyl(m.wood, 0.028, 0.024, 0.04, 6); cork.position.y = 0.24;
  const net = mesh(new THREE.TorusGeometry(0.088, 0.008, 4, 10), m.cloth); net.rotation.x = HALF_PI; net.position.y = 0.09;
  g.add(body, neck, cork, net);
  return g;
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9b891'; g.fillRect(0, 0, 256, 320);
  g.strokeStyle = '#3b2f24'; g.lineWidth = 3; g.lineCap = 'round';
  // 钟座线稿：钟身、缺失的钟舌（虚线）与钟架
  g.beginPath(); g.moveTo(60, 60); g.lineTo(196, 60); g.moveTo(128, 60); g.lineTo(128, 84); g.stroke();
  g.beginPath(); g.moveTo(92, 200); g.quadraticCurveTo(96, 96, 128, 84); g.quadraticCurveTo(160, 96, 164, 200);
  g.lineTo(178, 214); g.lineTo(78, 214); g.closePath(); g.stroke();
  g.setLineDash([5, 6]);
  g.beginPath(); g.moveTo(128, 120); g.lineTo(128, 196); g.stroke();
  g.beginPath(); g.arc(128, 208, 13, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#3b2f24'; g.font = 'bold 30px serif'; g.textAlign = 'center';
  g.fillText('晨钟 · 缺钟舌', 128, 268);
  g.font = '20px serif'; g.fillText('祭台匣入夜方开', 128, 298);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bellGeometry(): THREE.BufferGeometry {
  const pts = [[0.05, 0], [0.16, -0.04], [0.22, -0.2], [0.25, -0.42], [0.31, -0.58], [0.36, -0.66], [0.33, -0.68]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 14);
}

function gateGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = 0.06 + (i * 1.68) / 8;
    const k = Math.abs(x - 0.9) / 0.9;
    const h = 2.0 + 0.78 * (1 - k * k);
    const bar = new THREE.CylinderGeometry(0.022, 0.022, h, 5);
    bar.translate(x, h / 2, 0);
    parts.push(bar);
    const tip = new THREE.ConeGeometry(0.04, 0.12, 4);
    tip.translate(x, h + 0.05, 0);
    parts.push(tip);
  }
  for (const y of [0.25, 1.15, 1.95]) {
    const rail = new THREE.BoxGeometry(1.72, 0.05, 0.03);
    rail.translate(0.9, y, 0);
    parts.push(rail);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}

/** 亮区的地面光斑：圆盘裁到所在房间的矩形内，和规则里「光不穿墙」一致。 */
function zoneDisc(zn: LightZone, tex: THREE.Texture, y: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(zn.r, 40);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    // 圆盘随后绕 X 轴放平：本地 x 对应模拟 x，本地 y 对应模拟 z
    pos.setXY(i, Math.max(zn.x0, Math.min(zn.x1, zn.x + pos.getX(i))) - zn.x, Math.max(zn.z0, Math.min(zn.z1, zn.z + pos.getY(i))) - zn.z);
  }
  const disc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0xffa040, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  disc.rotation.x = -HALF_PI;
  return put(disc, zn.x, y, zn.z);
}

const BRAZIER_IDS = Object.keys(BRAZIER.zones) as BrazierId[];

export class Props {
  readonly group = new THREE.Group();
  readonly hearthLight = new THREE.PointLight(0xff9a48, 0, 16, 1.6);
  readonly windowLight = new THREE.PointLight(0xff9a48, 0, 9, 1.8);
  readonly lampLight = new THREE.PointLight(0xffa850, 0, 18, 1.4);
  /** 两个火盆共用一盏灯（少一盏点光源）：放在离玩家最近的那个点着的火盆上。 */
  readonly brazierLight = new THREE.PointLight(0xff9440, 0, 15, 1.5);
  /** 开发预设下显示亮区边界。 */
  readonly lampDebugRing: THREE.Mesh;

  private glowTex = glowTexture();
  private ghDoor = new THREE.Group();
  private boltBar: THREE.Mesh;
  private boltBracket: THREE.Mesh;
  private boltKnob: THREE.Mesh;
  private gate = new THREE.Group();
  private gateJam = new THREE.Group();
  private frontL = new THREE.Group();
  private frontR = new THREE.Group();
  private open = { gatehouse: 0, gate: 0, chapelFront: 0 };
  private boltAmt = 0;
  private lampArm = new THREE.Group();
  private lampStub: THREE.Mesh;
  private lampFlame: THREE.Group;
  private lampGround: THREE.Mesh;
  private braziers: { id: BrazierId; flame: THREE.Group; coals: THREE.Mesh; ground: THREE.Mesh }[] = [];
  private pickLantern: THREE.Group;
  private shelfItems = new THREE.Group();
  private crateItems = new THREE.Group();
  private crateLid: THREE.Mesh;
  private flask: THREE.Group;
  private food: THREE.Group;
  private chestLid = new THREE.Group();
  private chestLock: THREE.Mesh;
  private chestGlow: THREE.Sprite;
  private chestClapper: THREE.Group;
  private lidAmt = 0;
  private bell = new THREE.Group();
  private bellClapper: THREE.Group;
  private bellSwing = 0;
  private bellT = 0;
  private flames: THREE.Group[] = [];
  private embers: THREE.Mesh;
  private potGlow: THREE.Sprite;
  private benchGlow: THREE.Sprite;

  constructor(m: Materials) {
    const g = this.group;
    const tex = this.glowTex;

    // 门房门与门闩（PRP-04）：门轴在西侧，向庭院开。门闩装在门的内侧。
    put(this.ghDoor, -0.8, 0, 0.25);
    const leaf = mesh(archLeaf(1.6, 1.9, 2.6, 0.09, true), m.wood);
    this.ghDoor.add(leaf);
    for (const y of [0.45, 1.75]) {
      const strap = boxMesh(m.iron, 1.1, 0.07, 0.11, 1); strap.position.set(0.58, y, 0);
      this.ghDoor.add(strap);
    }
    const ringOut = mesh(new THREE.TorusGeometry(0.07, 0.012, 5, 10), m.iron); ringOut.position.set(1.35, 1.1, -0.06);
    this.ghDoor.add(ringOut);
    const bracketFixed = boxMesh(m.iron, 0.09, 0.16, 0.06, 1); bracketFixed.position.set(0.85, 1.25, 0.075);
    this.boltBracket = boxMesh(m.iron, 0.09, 0.16, 0.06, 1); this.boltBracket.position.set(1.4, 1.25, 0.075);
    this.boltBar = cyl(m.iron, 0.028, 0.028, 0.72, 7); this.boltBar.rotation.z = HALF_PI; this.boltBar.position.set(1.05, 1.25, 0.085);
    this.boltKnob = mesh(new THREE.SphereGeometry(0.045, 7, 6), m.iron); this.boltKnob.position.set(0.7, 1.25, 0.12);
    this.ghDoor.add(bracketFixed, this.boltBracket, this.boltBar, this.boltKnob);
    const keeper = put(boxMesh(m.iron, 0.12, 0.16, 0.07, 1), 0.88, 1.25, 0.07);
    g.add(this.ghDoor, keeper);

    // 侧廊栅门（PRP-03）：卡死、已修关门、已修开门三态。向庭院一侧开。
    put(this.gate, 10.25, 0, 5.1);
    this.gate.add(mesh(gateGeometry(), m.iron));
    const wedge = boxMesh(m.wood, 0.12, 1.9, 0.1, 1); wedge.position.set(0.95, 0.85, 0.16); wedge.rotation.z = 0.5;
    const chain = mesh(new THREE.TorusGeometry(0.11, 0.02, 5, 10), m.iron); chain.position.set(1.72, 1.1, 0.02);
    this.gateJam.add(wedge, chain);
    this.gate.add(this.gateJam);
    g.add(this.gate);

    // 礼拜堂正门：双开，向堂内开。
    put(this.frontL, 18.1, R, 25.25);
    put(this.frontR, 19.9, R, 25.25);
    for (const d of [this.frontL, this.frontR]) {
      d.add(mesh(halfArchLeaf(0.9, 2.2, 3.2, 0.1), m.wood));
      for (const y of [0.5, 1.7]) {
        const strap = boxMesh(m.iron, 0.7, 0.07, 0.12, 1); strap.position.set(0.38, y, 0);
        d.add(strap);
      }
      const ring = mesh(new THREE.TorusGeometry(0.08, 0.014, 5, 10), m.iron); ring.position.set(0.76, 1.15, 0);
      ring.scale.z = 4; d.add(ring);
    }
    this.frontR.rotation.y = Math.PI;
    g.add(this.frontL, this.frontR);
    // 礼拜堂侧门：门扇早已松脱，靠在侧廊墙边。
    const fallen = put(boxMesh(m.wood, 1.4, 2.2, 0.08, 1), 12.82, 1.05, 14.2);
    fallen.rotation.set(0, HALF_PI, 0.12);
    g.add(fallen);

    // 庭院壁灯（PRP-02）：缺件、修复未点、点亮三态。
    const lamp = put(new THREE.Group(), LAMP_POS.x - 0.18, LAMP_POS.y, LAMP_POS.z);
    const tri = new THREE.Shape();
    tri.moveTo(-0.26, 0.3); tri.lineTo(0.26, 0.3); tri.lineTo(0, -0.42); tri.lineTo(-0.26, 0.3);
    const plate = mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.03, bevelEnabled: false }), m.iron);
    plate.rotation.y = HALF_PI;
    lamp.add(plate);
    this.lampStub = boxMesh(m.iron, 0.2, 0.05, 0.05, 1); this.lampStub.position.set(0.1, -0.12, 0); this.lampStub.rotation.z = -0.7;
    const arm = boxMesh(m.iron, 0.5, 0.045, 0.045, 1); arm.position.set(0.28, -0.05, 0);
    const curl = mesh(new THREE.TorusGeometry(0.08, 0.02, 5, 10, Math.PI), m.iron); curl.position.set(0.5, 0.02, 0); curl.rotation.z = -HALF_PI;
    const cup = cyl(m.iron, 0.13, 0.09, 0.09, 8); cup.position.set(0.55, 0.14, 0);
    const oilCup = cyl(m.glass, 0.09, 0.09, 0.06, 8); oilCup.position.set(0.55, 0.2, 0);
    this.lampArm.add(arm, curl, cup, oilCup);
    for (let i = 0; i < 5; i++) {
      const prong = boxMesh(m.iron, 0.025, 0.1, 0.025, 1);
      prong.position.set(0.55 + Math.cos((i * Math.PI * 2) / 5) * 0.12, 0.22, Math.sin((i * Math.PI * 2) / 5) * 0.12);
      this.lampArm.add(prong);
    }
    this.lampFlame = flame(m, tex, 0.2); this.lampFlame.position.set(0.55, 0.23, 0);
    this.lampArm.add(this.lampFlame);
    lamp.add(this.lampStub, this.lampArm);
    g.add(lamp);
    put(this.lampLight, LAMP_POS.x + 1.4, LAMP_POS.y + 0.5, LAMP_POS.z);
    g.add(this.lampLight);
    // 地面光斑与调试边界：半径取自同一处亮区配置。
    const zn = WALL_LAMP.zone;
    this.lampGround = new THREE.Mesh(
      new THREE.CircleGeometry(zn.r, 40),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffa040, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lampGround.rotation.x = -HALF_PI;
    put(this.lampGround, zn.x, 0.03, zn.z);
    this.lampDebugRing = new THREE.Mesh(new THREE.RingGeometry(zn.r - 0.05, zn.r + 0.05, 64), new THREE.MeshBasicMaterial({ color: 0xff3080, depthTest: false }));
    this.lampDebugRing.rotation.x = -HALF_PI;
    put(this.lampDebugRing, zn.x, 0.06, zn.z);
    this.lampDebugRing.visible = false;
    g.add(this.lampGround, this.lampDebugRing);

    // 火盆：三脚铁架托一只浅盆，点着时有火苗和地面光斑。
    for (const id of BRAZIER_IDS) {
      const at = BRAZIER_POS[id], zn = BRAZIER.zones[id];
      const floor = at.y - 1.0;
      const stand = put(new THREE.Group(), at.x, floor, at.z);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        const leg = cyl(m.iron, 0.02, 0.025, 0.95, 5);
        leg.position.set(Math.cos(a) * 0.16, 0.46, Math.sin(a) * 0.16);
        leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
        stand.add(leg);
      }
      const bowl = cyl(m.iron, 0.3, 0.16, 0.16, 10); bowl.position.y = 0.94;
      const rim = mesh(new THREE.TorusGeometry(0.3, 0.02, 5, 14), m.iron); rim.rotation.x = HALF_PI; rim.position.y = 1.02;
      const coals = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 10), new THREE.MeshBasicMaterial({ color: 0x24201c }), false); coals.position.y = 1.02;
      const fl = flame(m, tex, 0.42); fl.position.y = 1.03;
      stand.add(bowl, rim, coals, fl);
      const ground = zoneDisc(zn, tex, floor + 0.03);
      g.add(stand, ground);
      this.braziers.push({ id, flame: fl, coals, ground });
    }
    g.add(this.brazierLight);

    // 拾取件（PRP-01、PRP-06、PRP-09）
    this.pickLantern = put(makeLantern(m, tex).group, 1.8, 0.97, -6.3);
    this.pickLantern.children[5].visible = false;
    g.add(this.pickLantern);
    const sw = woodBundle(m); sw.position.set(0, 0, 0.55); sw.rotation.y = HALF_PI;
    const si = ironPack(m); si.position.set(0, 0, -0.1);
    const sf = oilFlask(m); sf.position.set(0, 0, -0.75);
    this.shelfItems.add(sw, si, sf);
    put(this.shelfItems, -9.6, 1.07, 6.2);
    g.add(this.shelfItems);
    const cw = woodBundle(m); cw.position.set(-0.22, 0, 0.05); cw.rotation.y = 0.4;
    const ci = ironPack(m); ci.position.set(0.2, 0, 0.1);
    const cf = oilFlask(m); cf.position.set(0.1, 0, -0.25);
    this.crateItems.add(cw, ci, cf);
    put(this.crateItems, 16.9, R + 0.8, 28.1);
    this.crateLid = put(boxMesh(m.wood, 1.0, 0.05, 0.8, 0.8), 17.55, R + 0.42, 28.1);
    this.crateLid.rotation.z = -1.2;
    g.add(this.crateItems, this.crateLid);
    this.flask = put(oilFlask(m), 22.3, R + 0.86, 23);
    g.add(this.flask);

    // 祭台匣（PRP-05）：白天上锁，入夜微启，取走后大开。
    const chest = put(new THREE.Group(), 19, R + 1.1, 9.35);
    const body = boxMesh(m.wood, 0.72, 0.26, 0.42, 0.6); body.position.y = 0.13;
    for (const x of [-0.3, 0.3]) {
      const band = boxMesh(m.iron, 0.05, 0.28, 0.44, 1); band.position.set(x, 0.13, 0);
      chest.add(band);
    }
    const lid = boxMesh(m.wood, 0.74, 0.07, 0.44, 0.6); lid.position.set(0, 0.035, -0.22);
    this.chestLid.add(lid);
    this.chestLid.position.set(0, 0.26, 0.21);
    this.chestLock = boxMesh(m.iron, 0.1, 0.12, 0.04, 1); this.chestLock.position.set(0, 0.2, -0.23);
    this.chestGlow = glowSprite(tex, 0x9fb4c8, 0.9); this.chestGlow.position.set(0, 0.3, -0.1);
    this.chestClapper = makeClapper(m); this.chestClapper.rotation.z = HALF_PI; this.chestClapper.position.set(0.05, 0.3, 0);
    chest.add(body, this.chestLid, this.chestLock, this.chestGlow, this.chestClapper);
    g.add(chest);

    // 晨钟（PRP-05）：钟身与钟舌分动，下垂一根拉绳。
    put(this.bell, BELL_POS.x, 3.0, BELL_POS.z);
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide });
    this.bell.add(mesh(bellGeometry(), bellMat));
    this.bellClapper = makeClapper(m); this.bellClapper.position.y = -0.42;
    this.bell.add(this.bellClapper);
    const rope = cyl(m.cloth, 0.015, 0.015, 0.95, 5); rope.position.y = -1.15;
    this.bell.add(rope);
    const yoke = put(cyl(m.iron, 0.03, 0.03, 0.2, 6), BELL_POS.x, 3.06, BELL_POS.z);
    g.add(this.bell, yoke);

    // 任务板与补油台（PRP-08）
    const board = put(boxMesh(m.wood, 0.06, 1.0, 1.2, 1), 2.96, 1.5, -1.6);
    const sheet = put(new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.78), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 1 })), 2.92, 1.5, -1.6);
    sheet.rotation.y = -HALF_PI;
    const can = put(boxMesh(m.iron, 0.2, 0.3, 0.16, 1), 2.6, 1.1, -4.3);
    const spout = put(cyl(m.iron, 0.012, 0.02, 0.22, 5), 2.5, 1.22, -4.3); spout.rotation.z = 0.9;
    const funnel = put(mesh(new THREE.ConeGeometry(0.08, 0.12, 8, 1, true), m.iron), 2.5, 1.01, -4.75); funnel.rotation.x = Math.PI;
    const rag = put(boxMesh(m.cloth, 0.3, 0.02, 0.24, 1), 2.45, 0.96, -5.2);
    this.benchGlow = glowSprite(tex, 0xffa040, 0.5); put(this.benchGlow, 2.75, 1.15, -3.75);
    const stub = put(cyl(m.paper, 0.03, 0.035, 0.12, 6), 2.75, 1.01, -3.75);
    g.add(board, sheet, can, spout, funnel, rag, this.benchGlow, stub);

    // 炉火套件（PRP-07）：壁炉、烹煮锅、储备食材
    for (const [dz, rot] of [[-0.25, 0.25], [0.25, -0.2]]) {
      const log = put(cyl(m.wood, 0.1, 0.1, 0.8, 7), -2.6, 0.33, -4.4 + dz);
      log.rotation.set(HALF_PI, 0, rot);
      g.add(log);
    }
    this.embers = put(boxMesh(m.ember, 0.5, 0.05, 1.0, 1), -2.6, 0.25, -4.4);
    this.embers.castShadow = false;
    g.add(this.embers);
    for (const [dz, s] of [[-0.3, 0.55], [0.05, 0.8], [0.35, 0.5]]) {
      const f = put(flame(m, tex, s), -2.6, 0.3, -4.4 + dz);
      this.flames.push(f); g.add(f);
    }
    put(this.hearthLight, -1.9, 1.1, -4.4);
    put(this.windowLight, -2.0, 1.9, 1.4);
    g.add(this.hearthLight, this.windowLight);
    const pot = put(mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0.5, 2.4), m.iron), -2.45, 0.54, -2.55);
    const potRim = put(mesh(new THREE.TorusGeometry(0.19, 0.025, 5, 12), m.iron), -2.45, 0.72, -2.55); potRim.rotation.x = HALF_PI;
    this.potGlow = glowSprite(tex, 0xff7a28, 0.7); put(this.potGlow, -2.45, 0.34, -2.55);
    this.food = put(new THREE.Group(), -2.05, 0, -2.2);
    const sack = mesh(new THREE.SphereGeometry(0.17, 8, 6), m.cloth); sack.position.y = 0.15; sack.scale.y = 1.1;
    const root = cyl(m.paper, 0.03, 0.05, 0.16, 6); root.position.set(0.05, 0.33, 0); root.rotation.z = 0.4;
    this.food.add(sack, root);
    g.add(pot, potRim, this.potGlow, this.food);
  }

  ringBell(): void {
    this.bellSwing = 1;
    this.bellT = 0;
  }

  update(w: World, dt: number, time: number): void {
    const k = Math.min(1, dt * 3.2);
    const o = this.open;
    o.gatehouse = lerp(o.gatehouse, w.doors.gatehouse ? 1 : 0, k);
    o.gate = lerp(o.gate, w.doors.gate ? 1 : 0, k);
    o.chapelFront = lerp(o.chapelFront, w.doors.chapelFront ? 1 : 0, k);
    this.ghDoor.rotation.y = o.gatehouse * HALF_PI * 1.05;
    this.gate.rotation.y = HALF_PI + o.gate * HALF_PI;
    this.gate.rotation.z = w.repairs.gate ? 0 : 0.035;
    this.gateJam.visible = !w.repairs.gate;
    this.frontL.rotation.y = -o.chapelFront * HALF_PI * 0.95;
    this.frontR.rotation.y = Math.PI + o.chapelFront * HALF_PI * 0.95;

    // 门闩：闩杆滑动与锁定状态同步
    this.boltAmt = lerp(this.boltAmt, w.bolted ? 1 : 0, Math.min(1, dt * 8));
    this.boltBar.visible = this.boltKnob.visible = w.repairs.bolt;
    this.boltBar.position.x = 1.05 + this.boltAmt * 0.4;
    this.boltKnob.position.x = 0.7 + this.boltAmt * 0.4;
    this.boltBracket.rotation.z = w.repairs.bolt ? 0 : 0.9;
    this.boltBracket.position.y = w.repairs.bolt ? 1.25 : 1.17;

    // 壁灯
    const lit = w.lampBurn > 0;
    const flick = 0.88 + 0.08 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 23.7 + 1.3);
    this.lampArm.visible = w.repairs.lamp;
    this.lampStub.visible = !w.repairs.lamp;
    this.lampFlame.visible = lit;
    const fade = lit ? Math.min(1, w.lampBurn / 12) : 0;
    this.lampLight.intensity = 60 * fade * flick;
    this.lampGround.visible = lit;
    (this.lampGround.material as THREE.MeshBasicMaterial).opacity = 0.38 * fade * flick;
    this.lampFlame.scale.setScalar(0.6 + 0.4 * fade * flick);

    // 火盆
    let near: BrazierId | null = null, nearD = Infinity;
    for (const b of this.braziers) {
      const burn = w.braziers[b.id];
      const on = burn > 0;
      const f = on ? Math.min(1, burn / 12) : 0;
      b.flame.visible = on;
      b.flame.scale.setScalar(0.55 + 0.45 * f * flick);
      (b.coals.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff9040 : 0x24201c);
      b.ground.visible = on;
      (b.ground.material as THREE.MeshBasicMaterial).opacity = 0.36 * f * flick;
      const at = BRAZIER_POS[b.id];
      const d = Math.hypot(at.x - w.player.x, at.z - w.player.z);
      if (on && d < nearD) { near = b.id; nearD = d; }
    }
    if (near) {
      const at = BRAZIER_POS[near];
      put(this.brazierLight, at.x, at.y + 0.7, at.z);
      this.brazierLight.intensity = 46 * Math.min(1, w.braziers[near] / 12) * flick;
    } else this.brazierLight.intensity = 0;

    // 拾取前后的清空变化
    this.pickLantern.visible = !w.inv.hasLantern;
    this.shelfItems.visible = !w.taken.shelf;
    this.crateItems.visible = !w.taken.crate;
    this.flask.visible = !w.taken.flask;
    this.food.visible = !w.taken.food;

    // 祭台匣
    const unlocked = w.phase === 'night' || w.phase === 'dawn';
    this.lidAmt = lerp(this.lidAmt, w.taken.chest ? 1.9 : unlocked ? 0.16 : 0, Math.min(1, dt * 5));
    this.chestLid.rotation.x = this.lidAmt;
    this.chestLock.visible = !unlocked && !w.taken.chest;
    this.chestGlow.visible = unlocked && !w.taken.chest;
    this.chestGlow.material.opacity = 0.35 + 0.15 * Math.sin(time * 2);
    this.chestClapper.visible = unlocked && !w.taken.chest;

    // 晨钟：敲响后阻尼摆动，钟舌相位滞后
    this.bellClapper.visible = w.quest.installed;
    if (this.bellSwing > 0.002) {
      this.bellT += dt;
      this.bellSwing *= Math.exp(-dt * 0.55);
      this.bell.rotation.x = Math.sin(this.bellT * 4.2) * 0.38 * this.bellSwing;
      this.bellClapper.rotation.x = Math.sin(this.bellT * 4.2 - 1.2) * 0.5 * this.bellSwing;
    } else {
      this.bell.rotation.x = 0;
      this.bellClapper.rotation.x = 0;
    }

    // 炉火：火势随剩余燃时变化
    const fire = !w.hearth.lit ? 0 : w.phase === 'night' ? 0.45 + 0.55 * Math.min(1, w.hearth.burn / (HEARTH.nightBurn * 0.5)) : 1;
    const hf = 0.85 + 0.1 * Math.sin(time * 9.1) + 0.08 * Math.sin(time * 17.3 + 0.7);
    this.flames.forEach((f, i) => {
      f.visible = fire > 0;
      f.scale.set(fire, fire * (0.85 + 0.25 * Math.sin(time * (7 + i * 2.3) + i)), fire);
    });
    this.hearthLight.intensity = 34 * fire * hf;
    this.windowLight.intensity = 9 * fire * hf;
    (this.embers.material as THREE.MeshBasicMaterial).color.setHex(fire > 0 ? 0xff9040 : 0x24201c);
    this.potGlow.visible = fire > 0;
    this.benchGlow.material.opacity = 0.6 + 0.2 * Math.sin(time * 6.3);
  }
}
