// 随状态变化的道具：门扇、门闩、栅门、壁灯、拾取件、祭台匣、晨钟、炉火（PRP-01…09、ANM-03 的程序化占位）。
// 火焰用程序化着色器面片，火星用粒子柱（VFX-01/02）；低画质关闭火星。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRAZIER, BrazierId, HEARTH, LightZone, WALL_LAMP } from '../config';
import { B1_Y, BELL_POS, BRAZIER_POS, DOORS, INTERACTS, LAMP_POS, PROPS, RAISED_Y } from '../sim/level';
import { World } from '../sim/state';
import { archLeaf, boxMesh, cyl, halfArchLeaf, lerp, mesh, put } from './geom';
import { glowTexture, grimeTexture, Materials, smokeTexture } from './materials';
import { findNode, loadProp, mergeByMaterial, sackGeometry, sackTie } from './propAssets';
import { variants } from './materialVariants';
import type { Quality } from './view';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

function glowSprite(tex: THREE.Texture, color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

// —— 火焰着色器：交叉面片上的程序化火舌，加性混合 ——
const FLAME_MATS: THREE.ShaderMaterial[] = [];
const FLAME_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAME_FRAG = /* glsl */`
uniform float uTime, uPhase;
uniform vec3 uA, uB, uC;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float t = uTime * 3.0 + uPhase;
  float n = sin(uv.y * 9.0 - t * 2.2) * 0.5 + sin(uv.y * 19.0 - t * 3.7) * 0.25;
  float x = uv.x - 0.5 + n * 0.09 * (1.0 - uv.y);
  float width = mix(0.34, 0.02, pow(uv.y, 0.85));
  float body = smoothstep(width, width * 0.25, abs(x));
  float vert = smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.5, uv.y);
  float f = body * vert * (0.82 + 0.18 * sin(t * 5.0 + uv.y * 7.0));
  vec3 col = mix(uA, uB, smoothstep(0.05, 0.7, uv.y));
  float core = smoothstep(width * 0.55, 0.0, abs(x)) * smoothstep(0.55, 0.0, uv.y);
  col = mix(col, uC, core * 0.85);
  gl_FragColor = vec4(col * 1.15, f);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function flameMaterial(phase: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uPhase: { value: phase },
      uA: { value: new THREE.Color(0xc23208) }, uB: { value: new THREE.Color(0xff8820) }, uC: { value: new THREE.Color(0xffcf90) },
    },
  });
  FLAME_MATS.push(mat);
  return mat;
}

function flame(tex: THREE.Texture, size: number, phase = Math.random() * 10): THREE.Group {
  const g = new THREE.Group();
  const mat = flameMaterial(phase);
  const geo = new THREE.PlaneGeometry(size * 0.8, size);
  for (const ry of [0, HALF_PI]) {
    const card = new THREE.Mesh(geo, mat);
    card.position.y = size * 0.5;
    card.rotation.y = ry;
    card.renderOrder = 2;
    g.add(card);
  }
  const glow = glowSprite(tex, 0xff7020, size * 1.0);
  glow.material.opacity = 0.1;
  glow.position.y = size * 0.45;
  g.add(glow);
  return g;
}

// —— 火星粒子柱 ——
const EMBER_VERT = /* glsl */`
attribute float aLife;
varying float vLife;
uniform float uSize;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (1.0 - aLife * 0.7) * (300.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const EMBER_FRAG = /* glsl */`
varying float vLife;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife);
  gl_FragColor = vec4(uColor * (1.6 - vLife), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Embers {
  readonly points: THREE.Points;
  private life: Float32Array;
  private seed: Float32Array;
  private n: number;
  private h: number;
  constructor(x: number, y: number, z: number, n: number, h: number, color: number, size: number) {
    this.n = n; this.h = h;
    this.life = new Float32Array(n);
    this.seed = new Float32Array(n);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.life[i] = Math.random();
      this.seed[i] = Math.random() * 6.28;
      pos[i * 3] = (Math.random() - 0.5) * 0.2;
      pos[i * 3 + 1] = this.life[i] * h;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: size }, uColor: { value: new THREE.Color(color) } },
    });
    this.points = new THREE.Points(geo, mat);
    this.points.position.set(x, y, -z);
    this.points.frustumCulled = false;
  }
  update(dt: number, time: number, active: boolean): void {
    this.points.visible = active;
    if (!active) return;
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt * (0.5 + (i % 5) * 0.12);
      if (this.life[i] >= 1) {
        this.life[i] = 0;
        arr[i * 3] = (Math.random() - 0.5) * 0.18;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.18;
      }
      arr[i * 3 + 1] = this.life[i] * this.h;
      arr[i * 3] += Math.sin(time * 2 + this.seed[i]) * dt * 0.12;
    }
    pos.needsUpdate = true;
    (this.points.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** 卷草锻铁挂臂：贴墙板 + 铆钉 + 微拱主管 + 三处卷草 + 吊环。原点在墙面。 */
function scrollArm(m: Materials): THREE.Group {
  const g = new THREE.Group();
  const polished = m.iron.clone();
  polished.roughness = 0.4;
  const mount = boxMesh(m.iron, 0.05, 0.36, 0.14, 1); mount.position.set(0.03, 0, 0);
  g.add(mount);
  for (const [ry, rz] of [[-0.14, 0.05], [0.14, 0.05], [-0.14, -0.05], [0.14, -0.05]]) {
    const rivet = mesh(new THREE.SphereGeometry(0.016, 5, 4), m.iron); rivet.position.set(0.06, ry, rz); g.add(rivet);
  }
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, 0.1, 0), new THREE.Vector3(0.24, 0.18, 0),
    new THREE.Vector3(0.46, 0.19, 0), new THREE.Vector3(0.6, 0.13, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(armCurve, 14, 0.02, 6), m.iron));
  // 斜撑 + 臂端矛尖（concept/04 锻铁语汇）
  const braceCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, -0.14, 0), new THREE.Vector3(0.2, -0.02, 0), new THREE.Vector3(0.34, 0.12, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(braceCurve, 10, 0.014, 6), m.iron));
  const spear = mesh(new THREE.ConeGeometry(0.026, 0.11, 4), polished);
  spear.position.set(0.6, 0.2, 0);
  g.add(spear);
  const curl = mesh(new THREE.TorusGeometry(0.14, 0.015, 5, 14, Math.PI * 1.35), polished);
  curl.position.set(0.3, 0.0, 0); curl.rotation.z = -0.5;
  const curl2 = mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI * 1.5), polished);
  curl2.position.set(0.12, -0.08, 0); curl2.rotation.z = 2.2;
  const curl3 = mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI * 1.4), polished);
  curl3.position.set(0.47, 0.06, 0); curl3.rotation.z = -1.2;
  const hangRing = mesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10), m.iron); hangRing.position.set(0.6, 0.1, 0);
  g.add(curl, curl2, curl3, hangRing);
  mergeByMaterial(g);
  return g;
}

/** 六角铁灯笼：顶盖 + 六棱玻璃 + 立柱框 + 底托。玻璃中心在原点。 */
function hexLantern(m: Materials, glass: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const cap = mesh(new THREE.ConeGeometry(0.14, 0.1, 6), m.iron); cap.position.y = 0.16;
  const capRim = mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.022, 6), m.iron); capRim.position.y = 0.11;
  const vent = cyl(m.iron, 0.025, 0.04, 0.035, 6); vent.position.y = 0.22;
  const glassBody = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.2, 6, 1, true), glass, false);
  const baseRim = mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.025, 6), m.iron); baseRim.position.y = -0.11;
  const finial = mesh(new THREE.SphereGeometry(0.022, 6, 5), m.iron); finial.position.y = -0.14;
  g.add(cap, capRim, vent, glassBody, baseRim, finial);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6 + Math.PI / 6;
    const post = boxMesh(m.iron, 0.014, 0.21, 0.014, 1);
    post.position.set(Math.cos(a) * 0.105, 0, Math.sin(a) * 0.105);
    g.add(post);
  }
  mergeByMaterial(g);
  return g;
}

export function makeLantern(m: Materials, tex: THREE.Texture): { group: THREE.Group; glow: THREE.Object3D; glass: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  // 烟熏玻璃：污渍粗糙度贴图，夜晚灯内火光透出（圣经第 5 节玻璃行）
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2a1c0c, emissive: 0xffa640, emissiveIntensity: 0, roughness: 0.22,
    transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughnessMap: grimeTexture(),
  });
  const base = cyl(m.iron, 0.085, 0.1, 0.035, 6); base.position.y = -0.2;
  const baseRim = mesh(new THREE.CylinderGeometry(0.105, 0.09, 0.02, 6), m.iron); baseRim.position.y = -0.18;
  const body = mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.17, 6, 1, true), glass, false); body.position.y = -0.095;
  const hood = mesh(new THREE.ConeGeometry(0.115, 0.085, 6), m.iron); hood.position.y = 0.03;
  const hoodRim = mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.018, 6), m.iron); hoodRim.position.y = -0.005;
  const ring = mesh(new THREE.TorusGeometry(0.055, 0.011, 6, 12), m.iron); ring.position.y = 0.115;
  const posts = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6 + Math.PI / 6;
    const p = boxMesh(m.iron, 0.013, 0.18, 0.013, 1);
    p.position.set(Math.cos(a) * 0.078, -0.095, Math.sin(a) * 0.078);
    posts.add(p);
  }
  // 烛台与蜡泪（灯内叙事）
  const candle = cyl(m.paper, 0.02, 0.024, 0.06, 6); candle.position.y = -0.15;
  const wax = mesh(new THREE.SphereGeometry(0.026, 6, 5), m.paper); wax.position.y = -0.175; wax.scale.y = 0.5;
  posts.add(candle, wax);
  mergeByMaterial(posts);
  const glow = glowSprite(tex, 0xffa848, 0.55);
  glow.position.y = -0.1;
  // 次序保持 base,body,hood,ring,posts,glow（拾取件按 children[5] 隐藏光斑）
  group.add(base, body, hood, ring, posts, glow);
  const trim = new THREE.Group();
  trim.add(baseRim, hoodRim);
  const vent = cyl(m.iron, 0.028, 0.045, 0.03, 6); vent.position.y = 0.08; trim.add(vent);
  const finial = mesh(new THREE.SphereGeometry(0.018, 6, 5), m.iron); finial.position.y = 0.165; trim.add(finial);
  const link = mesh(new THREE.TorusGeometry(0.02, 0.007, 5, 8), m.iron); link.position.y = 0.065; link.rotation.x = HALF_PI; trim.add(link);
  mergeByMaterial(trim);
  group.add(trim);
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

function gateGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  const rnd = (i: number): number => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
  // 尖拱顶：两弧交于中点（哥特尖拱），竖杆粗细有锤痕变化
  const archH = (x: number): number => {
    const k = Math.abs(x - 0.9) / 0.9;
    return 2.02 + 0.76 * Math.pow(1 - k, 0.82);
  };
  for (let i = 0; i <= 8; i++) {
    const x = 0.06 + (i * 1.68) / 8;
    const h = archH(x);
    const w = 0.024 + rnd(i) * 0.012; // 方铁杆，粗细不一
    const bar = new THREE.BoxGeometry(w, h, w * 0.9);
    bar.translate(x, h / 2, 0);
    parts.push(bar);
    // 矛尖：叶形锥 + 箍环（常摸/雨淋磨亮，单独材质）
    const tip = new THREE.ConeGeometry(0.038, 0.17, 4);
    tip.scale(1, 1, 0.55);
    tip.translate(x, h + 0.08, 0);
    tips.push(tip);
    const collar = new THREE.SphereGeometry(0.026, 6, 5);
    collar.translate(x, h + 0.01, 0);
    tips.push(collar);
  }
  // 横档 + 铆钉
  for (const y of [0.28, 1.18]) {
    const rail = new THREE.BoxGeometry(1.76, 0.06, 0.034);
    rail.translate(0.9, y, 0);
    parts.push(rail);
    for (let i = 0; i <= 8; i++) {
      const x = 0.06 + (i * 1.68) / 8;
      const rivet = new THREE.SphereGeometry(0.016, 5, 4);
      rivet.translate(x, y, 0.024);
      parts.push(rivet);
    }
  }
  // 顶部随拱横档（分段折线贴合尖拱）
  for (let i = 0; i < 8; i++) {
    const xa = 0.06 + (i * 1.68) / 8, xb = 0.06 + ((i + 1) * 1.68) / 8;
    const ya = archH(xa) - 0.12, yb = archH(xb) - 0.12;
    const len = Math.hypot(xb - xa, yb - ya);
    const seg = new THREE.BoxGeometry(len + 0.02, 0.045, 0.03);
    seg.rotateZ(Math.atan2(yb - ya, xb - xa));
    seg.translate((xa + xb) / 2, (ya + yb) / 2, 0);
    parts.push(seg);
  }
  // 下段卷草（C 形卷，隔档一对）
  for (let i = 0; i < 8; i += 2) {
    const x = 0.06 + ((i + 0.5) * 1.68) / 8;
    const curl = new THREE.TorusGeometry(0.075, 0.012, 5, 12, Math.PI * 1.4);
    curl.rotateZ(i % 4 === 0 ? 0.6 : 2.6);
    curl.translate(x, 0.72, 0);
    parts.push(curl);
    const curl2 = new THREE.TorusGeometry(0.045, 0.01, 5, 10, Math.PI * 1.3);
    curl2.rotateZ(i % 4 === 0 ? 3.6 : -0.6);
    curl2.translate(x, 0.52, 0);
    parts.push(curl2);
  }
  gateTipParts = tips;
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}
let gateTipParts: THREE.BufferGeometry[] = [];
function gateTipsGeometry(): THREE.BufferGeometry {
  return mergeGeometries(gateTipParts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}

function zoneDisc(zn: LightZone, tex: THREE.Texture, y: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(zn.r, 40);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
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
  readonly lampLight = new THREE.PointLight(0xffb25e, 0, 16, 1.9);
  readonly brazierLight = new THREE.PointLight(0xff9440, 0, 15, 1.5);
  readonly lampDebugRing: THREE.Mesh;

  private glowTex = glowTexture();
  private smokeTex = smokeTexture();
  private ghDoor = new THREE.Group();
  private boltBar: THREE.Mesh;
  private boltBracket: THREE.Mesh;
  private boltKnob: THREE.Mesh;
  private gate = new THREE.Group();
  private gateClosedRot = HALF_PI;
  private gateJam = new THREE.Group();
  private frontL = new THREE.Group();
  private frontR = new THREE.Group();
  private open = { gatehouse: 0, gate: 0, chapelFront: 0 };
  private boltAmt = 0;
  private lampArm = new THREE.Group();
  private lampStub: THREE.Mesh;
  private lampFlame: THREE.Group;
  private lampGlass: THREE.MeshStandardMaterial;
  private sconces: { glass: THREE.MeshStandardMaterial; glow: THREE.Sprite; light: THREE.PointLight; flame: THREE.Group }[] = [];
  private braziers: { id: BrazierId; flame: THREE.Group; coals: THREE.Mesh; ground: THREE.Mesh; embers: Embers }[] = [];
  private pickLantern: THREE.Group;
  private shelfItems = new THREE.Group();
  private crateItems = new THREE.Group();
  private crateLid: THREE.Mesh;
  private flask: THREE.Group;
  private food: THREE.Group;
  private mealBowl: THREE.Group;
  private mealSteam: THREE.Sprite;
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
  private hearthEmbers: Embers;
  private lampEmbers: Embers;
  private chimneySmoke: THREE.Sprite[] = [];
  private potGlow: THREE.Sprite;
  private benchGlow: THREE.Sprite;
  private quality: Quality = 'high';

  constructor(m: Materials) {
    const g = this.group;
    const tex = this.glowTex;

    // 门房门与门闩（PRP-04）
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

    // 尖拱铁栅门（PRP-03）：位置/朝向读 DOORS.gate，布局调整时自动跟随
    const gh = DOORS.gate.hinge;
    this.gateClosedRot = DOORS.gate.axis === 'z' ? HALF_PI : 0;
    const gateBox = DOORS.gate.box;
    put(this.gate, gh.x, gateBox.y0 ?? 0, gh.z);
    this.gate.scale.set((gateBox.z1 - gateBox.z0) / 1.8, (gateBox.h - (gateBox.y0 ?? 0)) / 2.95, 1);
    this.gate.add(mesh(gateGeometry(), m.iron));
    const tipIron = m.iron.clone();
    tipIron.roughness = 0.4;
    this.gate.add(mesh(gateTipsGeometry(), tipIron));
    const wedge = boxMesh(variants(m).woodBeam, 0.12, 1.9, 0.1, 1); wedge.position.set(0.95, 0.85, 0.16); wedge.rotation.z = 0.5;
    const chain = mesh(new THREE.TorusGeometry(0.11, 0.02, 5, 10), m.iron); chain.position.set(1.72, 1.1, 0.02);
    this.gateJam.add(wedge, chain);
    this.gate.add(this.gateJam);
    g.add(this.gate);

    // South wall: a barred, bricked-up arch, not a second interactable gate.
    const grille = put(new THREE.Group(), 4.27, 0.18, 0.63);
    grille.scale.set(1.37, 1.03, 1);
    grille.add(mesh(gateGeometry(), m.iron), mesh(gateTipsGeometry(), tipIron));
    g.add(grille);

    // Chapel leaves follow the actual west-facing opening, at the simulated hinges.
    const front = DOORS.chapelFront;
    put(this.frontL, front.hinge.x, R, front.box.z0);
    put(this.frontR, front.hinge.x, R, front.box.z1);
    this.frontL.rotation.y = HALF_PI;
    this.frontR.rotation.y = -HALF_PI;
    for (const d of [this.frontL, this.frontR]) {
      d.add(mesh(halfArchLeaf(0.9, 2.2, 3.2, 0.1), m.wood));
      for (const y of [0.5, 1.7]) {
        const strap = boxMesh(m.iron, 0.7, 0.07, 0.12, 1); strap.position.set(0.38, y, 0);
        d.add(strap);
      }
      const ring = mesh(new THREE.TorusGeometry(0.08, 0.014, 5, 10), m.iron); ring.position.set(0.76, 1.15, 0);
      ring.scale.z = 4; d.add(ring);
    }
    g.add(this.frontL, this.frontR);

    // 庭院壁灯（PRP-02）：卷草锻铁挂臂 + 悬挂六角铁灯笼（玻璃 + 顶盖），对标概念图
    // 朝向由所在墙推断（西/东/北/南），布局移动 LAMP_POS 时自动跟随
    const ln = Math.abs(LAMP_POS.x) > 9 ? [Math.sign(-LAMP_POS.x), 0] : [0, LAMP_POS.z > 14 ? -1 : 1];
    const lampRot = Math.atan2(ln[1], ln[0]);
    const lamp = put(new THREE.Group(), LAMP_POS.x + ln[0] * 0.32, LAMP_POS.y, LAMP_POS.z + ln[1] * 0.32);
    lamp.rotation.y = lampRot;
    lamp.scale.setScalar(1.15);
    this.lampStub = boxMesh(m.iron, 0.2, 0.05, 0.05, 1); this.lampStub.position.set(0.1, -0.12, 0); this.lampStub.rotation.z = -0.7;
    this.lampGlass = new THREE.MeshStandardMaterial({
      color: 0x3a2a16, emissive: 0xffa640, emissiveIntensity: 0, roughness: 0.2,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughnessMap: grimeTexture(),
    });
    const lx = 0.6, ly = -0.28;
    this.lampArm.add(scrollArm(m));
    const lanternBody = hexLantern(m, this.lampGlass);
    lanternBody.position.set(lx, ly, 0);
    this.lampArm.add(lanternBody);
    for (const ly2 of [0.05, -0.01]) {
      const link = mesh(new THREE.TorusGeometry(0.022, 0.007, 5, 8), m.iron);
      link.position.set(lx, ly2, 0);
      link.rotation.y = HALF_PI;
      this.lampArm.add(link);
    }
    this.lampFlame = flame(tex, 0.16); this.lampFlame.position.set(lx, ly - 0.09, 0);
    this.lampArm.add(this.lampFlame);
    lamp.add(this.lampStub, this.lampArm);
    g.add(lamp);
    put(this.lampLight, LAMP_POS.x + ln[0] * 0.75, LAMP_POS.y - 0.3, LAMP_POS.z + ln[1] * 0.75);
    g.add(this.lampLight);
    // 西墙装饰烛灯（概念图左墙藤幕中的挂灯）：入夜自燃，暖琥珀小光池
    for (const [sx, sy] of [[-0.6, 2.9], [-8.6, 2.6]]) {
      const sc = put(new THREE.Group(), sx, sy, 28.48);
      sc.rotation.y = -HALF_PI;
      sc.add(scrollArm(m));
      const glass = new THREE.MeshStandardMaterial({
        color: 0x3a2a16, emissive: 0xffb25e, emissiveIntensity: 0, roughness: 0.2,
        transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughnessMap: grimeTexture(),
      });
      const body = hexLantern(m, glass);
      body.position.set(0.6, -0.26, 0);
      body.scale.setScalar(0.9);
      sc.add(body);
      const fl = flame(tex, 0.12); fl.position.set(0.6, -0.34, 0); fl.visible = false;
      sc.add(fl);
      const glow = glowSprite(tex, 0xffb25e, 0.7); glow.position.set(0.6, -0.26, 0); glow.material.opacity = 0;
      sc.add(glow);
      const light = new THREE.PointLight(0xffb25e, 0, 10, 1.9);
      light.position.set(0.6, -0.26, 0);
      sc.add(light);
      g.add(sc);
      this.sconces.push({ glass, glow, light, flame: fl });
    }
    const zn = WALL_LAMP.zone;
    // 地面暖光交给真实点光（lampLight），不再贴圆形光斑贴花
    this.lampDebugRing = new THREE.Mesh(new THREE.RingGeometry(zn.r - 0.05, zn.r + 0.05, 64), new THREE.MeshBasicMaterial({ color: 0xff3080, depthTest: false }));
    this.lampDebugRing.rotation.x = -HALF_PI;
    put(this.lampDebugRing, zn.x, 0.06, zn.z);
    this.lampDebugRing.visible = false;
    g.add(this.lampDebugRing);
    this.lampEmbers = new Embers(LAMP_POS.x + ln[0] * 0.43, LAMP_POS.y + 0.06, LAMP_POS.z + ln[1] * 0.43, 10, 0.7, 0xffb060, 0.06);
    g.add(this.lampEmbers.points);

    // 火盆：锻铁三足架 + GLB 铁笼火盆（CC-BY，见 CREDITS.md）
    for (const id of BRAZIER_IDS) {
      const at = BRAZIER_POS[id], bz = BRAZIER.zones[id];
      const floor = at.y - 1.0;
      const stand = put(new THREE.Group(), at.x, floor, at.z);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        const leg = cyl(m.iron, 0.02, 0.026, 0.68, 5);
        leg.position.set(Math.cos(a) * 0.15, 0.33, Math.sin(a) * 0.15);
        leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
        stand.add(leg);
      }
      const ring = mesh(new THREE.TorusGeometry(0.19, 0.018, 5, 14), m.iron); ring.rotation.x = HALF_PI; ring.position.y = 0.66;
      stand.add(ring);
      mergeByMaterial(stand);
      const bowl = loadProp({
        name: 'brazier', size: 0.62,
        normDefault: { color: 0x7d8085, roughness: 0.88, metalness: 0.25, wear: { kind: 'soot', seed: 7, sootY: 0.75 } },
      });
      bowl.position.y = 0.64;
      stand.add(bowl);
      const coals = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10), new THREE.MeshBasicMaterial({ color: 0x24201c }), false); coals.position.y = 0.86;
      const fl = flame(tex, 0.42); fl.position.y = 0.9;
      stand.add(coals, fl);
      const ground = zoneDisc(bz, tex, floor + 0.03);
      const embers = new Embers(at.x, at.y - 0.05, at.z, 16, 1.1, 0xff9040, 0.08);
      g.add(stand, ground, embers.points);
      this.braziers.push({ id, flame: fl, coals, ground, embers });
    }
    g.add(this.brazierLight);

    // 拾取件（PRP-01、PRP-06、PRP-09）
    this.pickLantern = put(makeLantern(m, tex).group, 1.8, 0.88, -6.3);
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
    const supply = PROPS.find((p) => p.tag === 'crate')!;
    const sx = (supply.x0 + supply.x1) / 2, sz = (supply.z0 + supply.z1) / 2;
    put(this.crateItems, sx, R + supply.h, sz);
    this.crateLid = put(boxMesh(m.wood, 0.94, 0.05, 0.76, 0.8), supply.x1 - 0.08, R + 0.55, sz);
    this.crateLid.rotation.z = -1.2;
    g.add(this.crateItems, this.crateLid);
    const flaskAt = INTERACTS.find((it) => it.id === 'flask')!;
    this.flask = put(oilFlask(m), flaskAt.x, B1_Y + 0.86, flaskAt.z);
    g.add(this.flask);

    // 祭台匣（PRP-05）：GLB 圣物箱（CC0），lid 节点挂到后缘枢轴上开合
    const altar = PROPS.find((p) => p.tag === 'altar')!;
    const chest = put(new THREE.Group(), altar.x0 + 0.4, R + altar.h, (altar.z0 + altar.z1) / 2);
    chest.rotation.y = HALF_PI;
    const chestGlb = loadProp({
      name: 'chest', size: 0.72, hide: /lock|handle/,
      normDefault: { color: 0x7a6a52, roughness: 0.8, metalness: 1 },
      onReady: (cg) => {
        const lid = findNode(cg, /treasure_chest_lid/);
        if (lid) {
          const pivot = new THREE.Group();
          pivot.position.set(0, 0.3, -0.19);
          cg.add(pivot);
          cg.updateMatrixWorld(true);
          pivot.attach(lid);
          this.chestLid = pivot;
        }
      },
    });
    chest.add(chestGlb);
    this.chestLock = boxMesh(m.iron, 0.1, 0.12, 0.04, 1); this.chestLock.position.set(0, 0.24, -0.21);
    this.chestGlow = glowSprite(tex, 0x9fb4c8, 0.9); this.chestGlow.position.set(0, 0.32, -0.05);
    this.chestClapper = makeClapper(m); this.chestClapper.rotation.z = HALF_PI; this.chestClapper.position.set(0.05, 0.34, 0);
    chest.add(this.chestLock, this.chestGlow, this.chestClapper);
    g.add(chest);

    // 晨钟（PRP-05）：GLB 铜钟（CC-BY，铜绿只在凹处），钟架/绳/钟舌程序化
    put(this.bell, BELL_POS.x, 3.0, BELL_POS.z);
    const bellGlb = loadProp({
      name: 'bell', size: 0.62, hide: /Wood3|RustMetal/,
      norm: { Bell: { color: 0x8a7a55, roughness: 0.5, metalness: 1, wear: { kind: 'iron', seed: 26 } } },
    });
    bellGlb.position.y = -0.62;
    this.bell.add(bellGlb);
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

    // 炉火套件（PRP-07）：GLB 壁炉炉膛内的柴与火，锅在炉旁吊臂下
    this.embers = put(boxMesh(m.ember, 0.4, 0.05, 0.9, 1), -2.72, 0.3, -4.4);
    this.embers.castShadow = false;
    g.add(this.embers);
    for (const [dz, s] of [[-0.22, 0.6], [0.22, 0.72]]) {
      const f = put(flame(tex, s), -2.72, 0.36, -4.4 + dz);
      this.flames.push(f); g.add(f);
    }
    this.hearthEmbers = new Embers(-2.72, 0.5, -4.4, 22, 1.5, 0xffa050, 0.09);
    g.add(this.hearthEmbers.points);
    put(this.hearthLight, -2.4, 0.8, -4.4);
    put(this.windowLight, -2.0, 1.9, 1.4);
    g.add(this.hearthLight, this.windowLight);
    // 锅体由 furniture.ts 的 cauldron GLB 承担，这里只留锅下暖光
    this.potGlow = glowSprite(tex, 0xff7a28, 0.7); put(this.potGlow, -2.72, 0.45, -4.4);
    this.food = put(new THREE.Group(), -2.05, 0, -2.2);
    const sack = mesh(sackGeometry(5, 0.16, 0.3, 0.45), variants(m).clothLinen);
    const tie = mesh(sackTie(0.16, 0.3), variants(m).clothLinen);
    sack.add(tie);
    const root = cyl(m.paper, 0.03, 0.05, 0.16, 6); root.position.set(0.05, 0.33, 0); root.rotation.z = 0.4;
    this.food.add(sack, root);
    g.add(this.potGlow, this.food);
    // 热食碗：备餐完成后出现在锅旁，冒热气
    const ceramic = new THREE.MeshStandardMaterial({ color: 0x9c8a72, roughness: 0.6 });
    this.mealBowl = put(new THREE.Group(), -2.05, 0.32, -2.55);
    const bowl = mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.09, 10), ceramic); bowl.position.y = 0.045;
    const stew = mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.5, emissive: 0x3a1a08, emissiveIntensity: 0.3 })); stew.position.y = 0.085;
    this.mealBowl.add(bowl, stew);
    this.mealSteam = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xd8d2c8, transparent: true, opacity: 0.3, depthWrite: false }));
    this.mealSteam.scale.set(0.3, 0.5, 1); this.mealSteam.position.y = 0.3;
    this.mealBowl.add(this.mealSteam);
    g.add(this.mealBowl);
    // 炉烟：从屋顶烟囱口升起
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x8a8a8a, transparent: true, opacity: 0, depthWrite: false }));
      s.position.set(-2.72, 3.5 + i * 0.5, -4.4);
      s.scale.setScalar(0.7 + i * 0.4);
      this.chimneySmoke.push(s); g.add(s);
    }
  }

  ringBell(): void {
    this.bellSwing = 1;
    this.bellT = 0;
  }

  setQuality(q: Quality): void {
    this.quality = q;
  }

  update(w: World, dt: number, time: number): void {
    for (const fm of FLAME_MATS) fm.uniforms.uTime.value = time;
    const hi = this.quality === 'high';
    const k = Math.min(1, dt * 3.2);
    const o = this.open;
    o.gatehouse = lerp(o.gatehouse, w.doors.gatehouse ? 1 : 0, k);
    o.gate = lerp(o.gate, w.doors.gate ? 1 : 0, k);
    o.chapelFront = lerp(o.chapelFront, w.doors.chapelFront ? 1 : 0, k);
    this.ghDoor.rotation.y = o.gatehouse * HALF_PI * 1.05;
    this.gate.rotation.y = this.gateClosedRot + o.gate * HALF_PI;
    this.gate.rotation.z = w.repairs.gate ? 0 : 0.035;
    this.gateJam.visible = !w.repairs.gate;
    this.frontL.rotation.y = HALF_PI * (1 - o.chapelFront * 0.95);
    this.frontR.rotation.y = -HALF_PI * (1 - o.chapelFront * 0.95);

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
    this.lampGlass.emissiveIntensity = lit ? 1.8 * fade * flick : 0;
    const candle = w.phase === 'night' || w.phase === 'dawn' ? flick : 0;
    for (const sc of this.sconces) {
      sc.glass.emissiveIntensity = 1.5 * candle;
      sc.glow.material.opacity = 0.22 * candle;
      sc.light.intensity = 10 * candle;
      sc.flame.visible = candle > 0;
    }
    this.lampLight.intensity = 4.5 * fade * flick;
    this.lampFlame.scale.setScalar(0.6 + 0.4 * fade * flick);
    this.lampEmbers.update(dt, time, lit && hi);

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
      b.embers.update(dt, time, on && hi);
      const at = BRAZIER_POS[b.id];
      const d = Math.hypot(at.x - w.player.x, at.z - w.player.z);
      if (on && d < nearD) { near = b.id; nearD = d; }
    }
    if (near) {
      const at = BRAZIER_POS[near];
      put(this.brazierLight, at.x, at.y + 0.7, at.z);
      this.brazierLight.intensity = 30 * Math.min(1, w.braziers[near] / 12) * flick;
    } else this.brazierLight.intensity = 0;

    // 拾取前后的清空变化
    this.pickLantern.visible = !w.inv.hasLantern;
    this.shelfItems.visible = !w.taken.shelf;
    this.crateItems.visible = !w.taken.crate;
    this.flask.visible = w.player.floor === 'B1' && !w.taken.flask;
    this.food.visible = !w.taken.food;
    this.mealBowl.visible = w.inv.meal > 0;
    if (this.mealBowl.visible) {
      this.mealSteam.position.y = 0.3 + (time % 1.5) * 0.12;
      this.mealSteam.material.opacity = 0.3 * (1 - (time % 1.5) / 1.5);
    }

    // 祭台匣
    const unlocked = w.phase === 'night' || w.phase === 'dawn';
    this.lidAmt = lerp(this.lidAmt, w.taken.chest ? 1.9 : unlocked ? 0.16 : 0, Math.min(1, dt * 5));
    this.chestLid.rotation.x = -this.lidAmt;
    this.chestLock.visible = !unlocked && !w.taken.chest;
    this.chestGlow.visible = unlocked && !w.taken.chest;
    this.chestGlow.material.opacity = 0.35 + 0.15 * Math.sin(time * 2);
    this.chestClapper.visible = unlocked && !w.taken.chest;

    // 晨钟
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

    // 炉火
    const fire = !w.hearth.lit ? 0 : w.phase === 'night' ? 0.45 + 0.55 * Math.min(1, w.hearth.burn / (HEARTH.nightBurn * 0.5)) : 1;
    const hf = 0.85 + 0.1 * Math.sin(time * 9.1) + 0.08 * Math.sin(time * 17.3 + 0.7);
    this.flames.forEach((f, i) => {
      f.visible = fire > 0;
      f.scale.set(fire, fire * (0.85 + 0.25 * Math.sin(time * (7 + i * 2.3) + i)), fire);
    });
    this.hearthLight.intensity = 22 * fire * hf;
    this.windowLight.intensity = 6 * fire * hf;
    (this.embers.material as THREE.MeshBasicMaterial).color.setHex(fire > 0 ? 0xff9040 : 0x24201c);
    this.potGlow.visible = fire > 0;
    this.benchGlow.material.opacity = 0.6 + 0.2 * Math.sin(time * 6.3);
    this.hearthEmbers.update(dt, time, fire > 0 && hi);
    this.chimneySmoke.forEach((s, i) => {
      const on = fire > 0;
      s.material.opacity = on ? 0.16 * fire : 0;
      if (on) {
        s.position.y = 3.5 + ((time * 0.4 + i * 0.6) % 2.2);
        s.position.x = -2.72 + Math.sin(time * 0.5 + i) * 0.2;
        s.scale.setScalar(0.7 + ((time * 0.4 + i * 0.6) % 2.2) * 0.5);
      }
    });
  }
}