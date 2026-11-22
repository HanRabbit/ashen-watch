// 几何辅助。模拟坐标 x 向东、z 向北；three.js 里取 (x, y, -z)，这样面朝北时右手边仍是 +x。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scaleUV, tiledBox } from './materials';

export function put<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, -z);
  return o;
}

/** 模拟朝向（0 为朝北，顺时针为正）转为 three.js 的 rotation.y。模型约定面朝本地 -Z。 */
export const yawToRot = (yaw: number): number => -yaw;

/** 把静态几何按材质合并，减少绘制调用。 */
export class Batch {
  private items = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    let list = this.items.get(mat);
    if (!list) { list = []; this.items.set(mat, list); }
    list.push(g);
  }

  /** 以模拟坐标给出的轴对齐盒：x0..x1、z0..z1、y0..y1。 */
  box(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 2): void {
    const geo = tiledBox(x1 - x0, y1 - y0, z1 - z0, tile);
    this.add(geo, mat, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2));
  }

  /** 任意几何：位置为模拟坐标，rotY 为绕竖轴的 three.js 旋转。 */
  geo(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, -z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(geo, mat, m);
  }

  build(parent: THREE.Object3D, shadows = true): void {
    for (const [mat, list] of this.items) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      parent.add(mesh);
      for (const g of list) g.dispose();
    }
    this.items.clear();
  }
}

/** 尖拱轮廓：宽 w，起拱高 s，拱顶高 p，底边在 y=0，中心在 x=0。 */
export function archPath<T extends THREE.Path>(path: T, w: number, s: number, p: number): T {
  const k = s + (p - s) * 0.72;
  path.moveTo(-w / 2, 0);
  path.lineTo(-w / 2, s);
  path.quadraticCurveTo(-w / 2, k, 0, p);
  path.quadraticCurveTo(w / 2, k, w / 2, s);
  path.lineTo(w / 2, 0);
  path.lineTo(-w / 2, 0);
  return path;
}

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  return scaleUV(geo, 0.5);
}

/** 带尖拱洞口的墙板：外框 W×H，洞口宽 w、起拱 s、拱顶 p，厚 d。位于本地 XY 平面。 */
export function archPanel(W: number, H: number, w: number, s: number, p: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, H); shape.lineTo(-W / 2, H); shape.lineTo(-W / 2, 0);
  shape.holes.push(archPath(new THREE.Path(), w, s, p));
  return extrude(shape, d);
}

/** 实心尖拱板（门扇、窗玻璃）。originLeft 为 true 时本地原点在左下角，便于绕门轴旋转。 */
export function archLeaf(w: number, s: number, p: number, d: number, originLeft = false): THREE.BufferGeometry {
  const geo = extrude(archPath(new THREE.Shape(), w, s, p), d);
  if (originLeft) geo.translate(w / 2, 0, 0);
  return geo;
}

/** 半扇尖拱门（双开门用）：从门轴到拱顶中线。 */
export function halfArchLeaf(w: number, s: number, p: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, s);
  shape.quadraticCurveTo(0, s + (p - s) * 0.72, w, p);
  shape.lineTo(w, 0);
  shape.lineTo(0, 0);
  return extrude(shape, d);
}

/** 三角山墙：底宽 w、高 h、厚 d。 */
export function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.lineTo(-w / 2, 0);
  return extrude(shape, d);
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function boxMesh(mat: THREE.Material, w: number, h: number, d: number, tile = 2): THREE.Mesh {
  return mesh(tiledBox(w, h, d, tile), mat);
}

export function cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, seg = 10): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** 木拱肋：跨宽 w、矢高 rise、截面 thick 的 curved 方料肋（本地 XY 平面，沿 x 跨、y 起拱）。 */
export function archRib(w: number, rise: number, thick: number): THREE.BufferGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-w / 2, 0, 0),
    new THREE.Vector3(0, rise * 1.7, 0),
    new THREE.Vector3(w / 2, 0, 0),
  );
  return new THREE.TubeGeometry(curve, 18, thick / 2, 6, false);
}
export const smooth = (t: number): number => { const c = clamp01(t); return c * c * (3 - 2 * c); };

/** 门洞上方的拱形过梁：宽 w，洞口起拱 s、拱顶 p，向上填到 H。底边不含洞口部分。 */
export function archHeader(w: number, s: number, p: number, H: number, d: number): THREE.BufferGeometry {
  const k = s + (p - s) * 0.72;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, s);
  shape.quadraticCurveTo(-w / 2, k, 0, p);
  shape.quadraticCurveTo(w / 2, k, w / 2, s);
  shape.lineTo(w / 2, H);
  shape.lineTo(-w / 2, H);
  shape.lineTo(-w / 2, s);
  return extrude(shape, d);
}
