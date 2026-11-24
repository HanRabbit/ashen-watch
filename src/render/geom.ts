// 几何辅助。模拟坐标 x 向东、z 向北；three.js 里取 (x, y, -z)，这样面朝北时右手边仍是 +x。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scaleUV, tiledBox } from './materials';
import { edgeStock, type EdgeStockProfile } from './edgeStock';

export function put<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, -z);
  return o;
}

/** 模拟朝向（0 为朝北，顺时针为正）转为 three.js 的 rotation.y。模型约定面朝本地 -Z。 */
export const yawToRot = (yaw: number): number => -yaw;

// Keep the old sort/cull sphere: unused vertices (e.g. sphere UV poles) did not
// survive the old index expansion and must not move the centre of a merged batch.
function computeIndexedBatchSphere(geometry: THREE.BufferGeometry): void {
  const positions = geometry.getAttribute('position');
  const index = geometry.index!;
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  for (let i = 0; i < index.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(positions, index.getX(i)));
  const sphere = geometry.boundingSphere = new THREE.Sphere();
  bounds.getCenter(sphere.center);
  let radiusSquared = 0;
  for (let i = 0; i < index.count; i++) {
    vertex.fromBufferAttribute(positions, index.getX(i));
    radiusSquared = Math.max(radiusSquared, sphere.center.distanceToSquared(vertex));
  }
  sphere.radius = Math.sqrt(radiusSquared);
}

function mergeBatch(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  let vertices = 0, corners = 0;
  for (const g of list) {
    const count = g.getAttribute('position').count;
    vertices += count;
    corners += g.index?.count ?? count;
  }
  // position/normal/uv are Float32 in the static batches. Keep the index only
  // when saved attribute bytes exceed its cost, including mixed triangle soup.
  const IndexArray = vertices > 0xffff ? Uint32Array : Uint16Array;
  const attributes = Object.values(list[0].attributes);
  const stride = attributes.reduce((sum, attribute) => sum + attribute.itemSize * attribute.array.BYTES_PER_ELEMENT, 0);
  if ((corners - vertices) * stride <= corners * IndexArray.BYTES_PER_ELEMENT) {
    const expanded = list.map(g => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(expanded, false);
    for (let i = 0; i < list.length; i++) if (expanded[i] !== list[i]) expanded[i].dispose();
    return merged;
  }
  for (const g of list) {
    if (g.index) continue;
    const indices = new IndexArray(g.getAttribute('position').count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    g.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  const merged = mergeGeometries(list, false);
  if (merged) computeIndexedBatchSphere(merged);
  return merged;
}

/** 把静态几何按材质合并，减少绘制调用，并保留有收益的共享顶点。 */
export class Batch {
  private items = new Map<THREE.Material, THREE.BufferGeometry[]>();

  private observer?: (g: THREE.BufferGeometry) => void;

  /** Visit transformed geometries added during a construction step without
   * splitting its material batches or retaining mutable mesh references. */
  observeGeometry(visitor: (g: THREE.BufferGeometry) => void, build: () => void): void {
    const previous = this.observer;
    this.observer = visitor;
    try { build(); } finally { this.observer = previous; }
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    // Indexed inputs continue to belong to the caller; nonindexed inputs are transferred.
    const g = geo.index ? new THREE.BufferGeometry().copy(geo) : geo;
    g.applyMatrix4(m);
    this.observer?.(g);
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

  /** Solid, exposed stock only. Keep continuous structural shells (and thin sheets) on box(). */
  edgeBox(profile: EdgeStockProfile, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 2): void {
    this.geo(mat, edgeStock(x1 - x0, y1 - y0, z1 - z0, tile, profile), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
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
      const merged = mergeBatch(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      parent.add(mesh);
    }
    this.items.clear();
  }
}

/** 尖拱饰带（罩拱线脚）：外拱 minus 内拱的单一路径，避免 hole 贴边。 */
export function archBand(w: number, s: number, p: number, t: number, d: number): THREE.BufferGeometry {
  const k = s + (p - s) * 0.72;
  const ko = s + (p + t - s) * 0.72;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - t, 0);
  shape.lineTo(-w / 2 - t, s);
  shape.quadraticCurveTo(-w / 2 - t, ko, 0, p + t);
  shape.quadraticCurveTo(w / 2 + t, ko, w / 2 + t, s);
  shape.lineTo(w / 2 + t, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, s);
  shape.quadraticCurveTo(w / 2, k, 0, p);
  shape.quadraticCurveTo(-w / 2, k, -w / 2, s);
  shape.lineTo(-w / 2, 0);
  shape.lineTo(-w / 2 - t, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -d / 2);
  return scaleUV(geo, 0.5);
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

/** 木拱肋：跨宽 w、矢高 rise、截面 thick 的粗壮方料肋（倒角矩形截面，沿曲线起拱；圣经 2 木构方料）。 */
export function archRib(w: number, rise: number, thick: number): THREE.BufferGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-w / 2, 0, 0),
    new THREE.Vector3(0, rise * 1.7, 0),
    new THREE.Vector3(w / 2, 0, 0),
  );
  const s = thick / 2, c = thick * 0.2; // 倒角
  const shape = new THREE.Shape();
  shape.moveTo(-s + c, -s); shape.lineTo(s - c, -s); shape.lineTo(s, -s + c);
  shape.lineTo(s, s - c); shape.lineTo(s - c, s); shape.lineTo(-s + c, s);
  shape.lineTo(-s, s - c); shape.lineTo(-s, -s + c); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { steps: 24, extrudePath: curve, bevelEnabled: false });
  return scaleUV(geo, 2.2); // 木纹密度
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
