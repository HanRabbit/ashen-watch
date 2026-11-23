import { buildCourtContact, type CourtContact } from './courtContact';
// 静态建筑：墙、地面、屋顶、地标与不随状态变化的陈设。按材质合并为少量网格。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isWestCourtFabric } from '../sim/courtPlan';
import { isNorthCourtFabric } from '../sim/northCourt';
import { DOORS, inArea, PROPS, S1_SHAFT, WALLS, WELL } from '../sim/level';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { archHeader, archRib, Batch, gable } from './geom';
import { buildGatehouseLights, windowWallPieces } from './gatehouseWindows';
import { buildFurniture } from './furniture';
import { buildDeadwood } from './deadwood';
import { buildFallenRubble } from './fallenRubble';
import { addCourtyardGround, addGroundSlab, buildYardDrain } from './yardSurface';
import { addSouthScarp } from './southScarp';
import { addBaileyApronFabric } from './baileyApron';
import { mountRodin } from './rodinAssets';
import { addYardBreaks } from './yardBreaks';
import { buildYardIvy, YARD_LITTER_POCKETS } from './yardPlanting';
import { addCurtainDetails, addCurtainPlinth, addWestCourtFabric } from './masonry';
import { addNorthCourtFabric } from './northCourt';
import { variants } from './materialVariants';
import { grassTexture, leafTexture, Materials, rugTexture, rustTexture, smokeTexture, tiledBox, trackPending } from './materials';

const HALF_PI = Math.PI / 2;

/** 确定性随机（装饰分布用，保证每次构建一致）。 */
function drng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StaticLevel {
  courtContact: CourtContact;
  group: THREE.Group;
  /** 高窗：白天透进冷光，夜里几乎全黑。 */
  windowMat: THREE.MeshStandardMaterial;
  /** 门房朝庭院的窗：炉火点着时透出琥珀色，是回程地标。 */
  hearthWindowMat: THREE.MeshStandardMaterial;
}

/** 墙角凸出角石（quoin）：大小交替、微微出墙，从勒脚砌到墙顶。 */
function quoin(b: Batch, mat: THREE.Material, x: number, z: number, h: number): void {
  const r = drng(Math.round(x * 31 + z * 17) + 9);
  let y = 0.3;
  let i = 0;
  while (y < h - 0.2) {
    const ch = 0.36 + r() * 0.12;
    const long = i % 2 === 0;
    const sx = long ? 0.72 : 0.5;
    const sz = long ? 0.5 : 0.72;
    b.box(mat, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, y, Math.min(y + ch, h), 1.4);
    y += ch + 0.02;
    i++;
  }
}

/** 门洞/拱的石砌框：两侧门 jamb 砌块 + 沿尖拱曲线的券石（voussoir），微出墙面。 */
function archFrame(b: Batch, mat: THREE.Material, cx: number, cz: number, w: number, s: number, p: number, rotY: number, y0 = 0): void {
  const r = drng(Math.round(cx * 13 + cz * 7 + w * 3) + 21);
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  // 本地 (u,v) → 世界 (x,z)：u 沿墙横方向，v 为高度；墙面法线本地 +z
  const at = (u: number, v: number, out: number): [number, number, number] =>
    [cx + u * cos + out * sin, v, cz - u * sin + out * cos];
  // 门侧砌块
  for (const side of [-1, 1]) {
    let y = y0;
    let i = 0;
    while (y < y0 + s - 0.1) {
      const ch = 0.4 + r() * 0.12;
      const [x, , z] = at(side * (w / 2 + 0.14), 0, 0);
      const bw = 0.3 + r() * 0.08;
      const geo = tiledBox(bw, ch, 0.62, 1.4);
      b.geo(mat, geo, x, y + ch / 2, z, rotY);
      y += ch + 0.02;
      i++;
    }
  }
  // 券石：沿两条二次曲线采样，朝向切线
  const k = s + (p - s) * 0.72;
  const n = 7;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // 二次贝塞尔：P0=(side*w/2,s) P1=(side*w/2,k) P2=(0,p)
      const u = (1 - t) * (1 - t) * (side * w / 2) + 2 * (1 - t) * t * (side * w / 2);
      const v = (1 - t) * (1 - t) * s + 2 * (1 - t) * t * k + t * t * p;
      const du = 2 * (1 - t) * 0 + 2 * t * (0 - side * w / 2);
      const dv = 2 * (1 - t) * (k - s) + 2 * t * (p - k);
      const ang = Math.atan2(dv, du) - HALF_PI;
      const rl = Math.hypot(u, v - s) || 1;
      const [x, , z] = at(u + (u / rl) * 0.16, v + ((v - s) / rl) * 0.16, 0);
      const geo = tiledBox(0.24, 0.42, 0.6, 1.4);
      b.geo(mat, geo, x, y0 + v + ((v - s) / rl) * 0.16, z, rotY, 0, ang);
    }
  }
  // 拱顶锁石
  const [kx, , kz] = at(0, p, 0);
  b.geo(mat, tiledBox(0.3, 0.5, 0.64, 1.4), kx, y0 + p + 0.16, kz, rotY);
}

/** 斜撑木框货箱：芯板 + 四角立柱 + 上下横档 + 四面斜撑，保持原碰撞盒尺寸。 */

export function buildStaticLevel(m: Materials): StaticLevel {
  const group = new THREE.Group();
  const b = new Batch();
  const v = variants(m);
  const { windowMat, hearthWindowMat } = buildGatehouseLights(b, group, v.wallTrim, m.iron);
  // 世界空间 UV + 每段随机偏移：打破长墙平铺重复（圣经 5.1 反重复）
  const boxOff = (mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile: number, ou: number, ov: number): void => {
    const g = tiledBox(x1 - x0, y1 - y0, z1 - z0, tile);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov);
    b.geo(mat, g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); // Batch.geo 内部已对 z 取负，此处传模拟坐标
  };

  // 墙体：按区域选材质族（5.1）。勒脚/压顶用 wallTrim，幕墙 wallRubble，礼拜堂/门房外墙 wallAshlar，地窖 wallRough。
  for (const w of WALLS) {
    if (w.y0 !== undefined || isNorthCourtFabric(w)) continue; // map: 带 y0 的三层几何由 floors.ts 绘制
    const isChapel = w.h >= 7;
    const isGH = w.tag === 'gh';
    const isCellar = w.tag === 'cellar';
    const mat = isCellar ? v.wallRough : (isChapel || isGH) ? v.wallAshlar : v.wallRubble;
    const ou = ((Math.round(w.x0 * 7 + w.z0 * 13) % 10) / 10) * 3.1;
    const ov = ((Math.round(w.x1 * 5 + w.z1 * 3) % 10) / 10) * 2.3;
    for (const a of windowWallPieces({ ...w, y0: 0 })) {
      boxOff(mat, a.x0, a.z0, a.x1, a.z1, a.y0, a.h, 4.5, ou + (a.x0-w.x0)/4.5, ov + a.y0/4.5);
    }
    if (!addCurtainPlinth(b, v, w)) b.box(v.wallTrim, w.x0 - 0.08, w.z0 - 0.08, w.x1 + 0.08, w.z1 + 0.08, 0, 0.35, 2.2); // 勒脚
    if (w.h >= 5) b.box(v.wallTrim, w.x0 - 0.05, w.z0 - 0.05, w.x1 + 0.05, w.z1 + 0.05, w.h - 0.12, w.h, 2.2); // 压顶
  }
  addSouthScarp(group, v.rock);
  addBaileyApronFabric(b, v);
  // The defensive shell wraps the playable masonry. Its permanent inner walls protect the route during loading.
  mountRodin(group, 'outer-bailey', new THREE.Group(), v.wallRubble);
  addCurtainDetails(b, v, WALLS);
  addNorthCourtFabric(b, v);
  addWestCourtFabric(b, v, WALLS.filter(isWestCourtFabric));

  // 庭院四角与门房角的凸出角石（wallTrim）
  for (const [x, z, h] of [[-10.25, 0.25, 4.2], [10.25, 0.25, 4.2], [-10.25, 28.75, 4.2], [10.25, 28.75, 3.2], [-3.25, -8.25, 3.6], [3.25, -8.25, 3.6]] as [number, number, number][]) {
    quoin(b, v.wallTrim, x, z, h);
  }
  // 门房内墙：全部石墙（concept/02，圣经 v2.8）——下半 wallRubble + 上半 wallAshlar，不用抹灰
  {
    const gh = (x0: number, z0: number, x1: number, z1: number): void => {
      for (const [mat, y0, top, tile] of [
        [v.wallRubble, 0.05, 1.5, 3.2], [v.wallAshlar, 1.5, 3.5, 2.6], [v.wallTrim, 1.46, 1.54, 2.2],
      ] as const) {
        for (const a of windowWallPieces({ x0, z0, x1, z1, y0, h: top })) {
          boxOff(mat, a.x0, z0, a.x1, z1, a.y0, a.h, tile, (a.x0-x0)/tile, (a.y0-y0)/tile);
        }
      }
    };
    gh(-3.0, -8.0, -2.94, 0.0);   // 西内墙
    gh(2.94, -8.0, 3.0, 0.0);     // 东内墙
    gh(-3.0, -8.0, 3.0, -7.94);   // 北内墙（后墙）
  }

  // The gatehouse is unchanged. Chapel portals are authored with the current
  // chapel in landmarks.ts, not layered over the abandoned pre-rotation openings.
  const ghDoor = DOORS.gatehouse;
  const ghWidth = ghDoor.box.x1 - ghDoor.box.x0;
  b.geo(v.wallTrim, archHeader(ghWidth, 1.9, ghDoor.box.h, 4.2, 0.5), 0, 0, ghDoor.hinge.z);
  archFrame(b, v.wallTrim, 0, ghDoor.hinge.z, ghWidth, 1.9, ghDoor.box.h, 0);

  // Let the valley terrain reach the fortress instead of covering its base with
  // a bright rectangular gravel plane. Bury exterior wall feet into that terrain.
  const footings = WALLS.filter((w) => (w.y0 === undefined && w.h >= 3.6) || (isWestCourtFabric(w) && w.y0 === 0));
  for (const w of footings) addGroundSlab(b, v.wallRough, w, -0.79, 0, 2.5);
  const courtContact = buildCourtContact(include => b.observeGeometry(include, () => {
    addCourtyardGround(b, v.floorFlag, v.floorCobble, v.floorFlagWorn);
    buildYardDrain(b, v.wallTrim, m.iron, new THREE.MeshStandardMaterial({ color: 0x191811, roughness: 0.98 }));
    addYardBreaks(b, m, v);
  }));
  // 门房室内石板（concept/02）+ 中央织纹地毯（单幅图案 + 流苏破边 + 磨损污渍）
  b.box(v.floorInterior, -3.5, -8.5, 3.5, 0, -0.3, 0.005, 2);
  {
    const rug = rugTexture();
    const rugMat = new THREE.MeshPhysicalMaterial({
      map: rug.map, normalMap: rug.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      color: 0xffffff, roughness: 0.95, metalness: 0,
      sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6a4a3a),
      alphaTest: 0.4, side: THREE.DoubleSide,
    });
    b.geo(rugMat, new THREE.PlaneGeometry(2.6, 3.6), 0, 0.02, -4.4, 0, -HALF_PI, 0);
  }
  // 门房：木屋顶、山墙、粗壮横梁 + 斜撑托架（concept/02 厚重木构）
  const ghAng = Math.atan2(2, 3.9);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), 1.95, 4.62, -4, 0, 0, -ghAng);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), -1.95, 4.62, -4, 0, 0, ghAng);
  b.geo(v.woodBeam, gable(7.4, 2.0, 0.4), 0, 3.6, -8.25);
  b.geo(v.woodBeam, gable(7.4, 1.7, 0.4), 0, 3.9, 0.25);
  for (const z of [-6.6, -4.1, -1.6]) {
    b.box(v.woodBeam, -3.2, z - 0.16, 3.2, z + 0.16, 3.22, 3.6, 1); // 粗壮方料横梁
    b.geo(v.woodBeam, archRib(6.0, 0.72, 0.22), 0, 2.5, z); // 方料木拱肋（concept/02）
    // 梁端铁箍 + 铁钉（圣经 2 木构铁件）
    for (const sx of [-1, 1]) {
      b.geo(m.iron, new THREE.TorusGeometry(0.15, 0.022, 6, 12), sx * 2.85, 2.5, z, HALF_PI);
      b.geo(m.iron, new THREE.SphereGeometry(0.03, 6, 5), sx * 2.85, 2.62, z + 0.13);
      b.geo(m.iron, new THREE.SphereGeometry(0.03, 6, 5), sx * 2.85, 2.38, z - 0.13);
      const geo = tiledBox(0.16, 0.9, 0.16, 1);
      b.geo(v.woodBeam, geo, sx * 2.75, 2.85, z, 0, 0, sx * 0.7); // 斜撑托架
    }
  }
  b.box(v.woodBeam, -0.14, -8.4, 0.14, 0.4, 5.35, 5.66, 1); // 脊檩
  // 门房外檐：挂晨钟的木托架
  b.box(v.woodBeam, 1.5, 0.5, 1.66, 1.75, 2.95, 3.11, 1);
  b.box(v.woodBeam, 2.74, 0.5, 2.9, 1.75, 2.95, 3.11, 1);
  b.box(v.woodBeam, 1.4, 1.02, 3.0, 1.18, 3.11, 3.27, 1);
  b.geo(m.roof, tiledBox(1.9, 0.08, 1.5, 1.2), 2.2, 3.5, 1.2, 0, 0.3, 0);

  // —— 地表细节：爬藤（实例化叶片）、苔痕、草丛（实例化）、落叶（实例化）、枯木、瓦砾 ——
  const decal = new Batch();
  buildYardIvy(group, decal, drng(131));

  // 石板缝草丛：实例化十字面片，墙脚 / 井台周围 / 板缝，数量提高
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, side: THREE.DoubleSide, alphaTest: 0.4 });
  const gr = drng(211);
  const grassPos: [number, number, number][] = [];
  const grassH: number[] = [];
  const grassEdge: boolean[] = [];
  const plantedGround = (x: number, z: number): boolean =>
    x > -9.89 && x < 9.89 && z > 0.66 && z < 28.38 && !inArea(S1_SHAFT, x, z)
    && Math.hypot(x - WELL.x, z - WELL.z) > 1.22
    && !PROPS.some((p) => (p.y0 ?? 0) === 0 && inArea(p, x, z));
  const pushGrass = (x: number, z: number, edge = false): void => {
    if (!plantedGround(x, z)) return;
    grassPos.push([x, 0, z]);
    grassH.push(edge ? 0.17 + gr() * 0.22 : 0.09 + gr() * 0.13);
    grassEdge.push(edge);
  };
  // Tufts share leaf-catching eddies, not a grid across well-used flagstones.
  for (const [x, z, wx, wz, n] of YARD_LITTER_POCKETS) {
    for (let i = 0; i < n * 0.51; i++) pushGrass(x + (gr() + gr() - 1) * wx, z + (gr() + gr() - 1) * wz, true);
  }
  for (const [x, z] of [[-5.5, 5.1], [-4.9, 11.95], [-7.3, 14.85], [-5.45, 20.52], [-0.1, 23.21], [6.8, 23.6], [7.3, 7.21]]) {
    for (let i = 0; i < 3; i++) pushGrass(x + (gr() - 0.5) * 0.45, z + (gr() - 0.5) * 0.28);
  }
  // 枯黄绿（圣经 4.2，不得鲜绿）：干草色调乘到草模型上
  const grassCol = (): THREE.Color => {
    const gc = [[0.78, 0.74, 0.46], [0.88, 0.82, 0.52], [0.62, 0.64, 0.40], [0.82, 0.76, 0.48]];
    const c = gc[Math.floor(gr() * gc.length)];
    return new THREE.Color(c[0], c[1], c[2]);
  };
  // 兜底：十字 alpha 面片草丛（离线时）
  const gp1 = new THREE.PlaneGeometry(1, 1.2); gp1.translate(0, 0.6, 0);
  const gp2 = gp1.clone(); gp2.rotateY(HALF_PI);
  const grassGeo = mergeGeometries([gp1, gp2], false)!;
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassPos.length);
  const grassXf: THREE.Matrix4[] = [];
  {
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
    for (let i = 0; i < grassPos.length; i++) {
      const s = grassH[i] / 1.2;
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), gr() * Math.PI);
      ss.set(s, s, s);
      mm.compose(new THREE.Vector3(grassPos[i][0], grassPos[i][1], -grassPos[i][2]), qq, ss);
      grassXf.push(mm.clone());
      grassMesh.setMatrixAt(i, mm);
      grassMesh.setColorAt(i, grassCol());
    }
    grassMesh.castShadow = true;
    grassMesh.receiveShadow = true;
    group.add(grassMesh);
  }
  // 真实草丛模型（Poly Haven grass_medium_01，CC0）：gltf 里并排放着 17 个变体（共 24.7k 三角）。
  // 按节点拆成变体、每个实例只画一个变体，每个变体一个 InstancedMesh：
  // 石缝/空地用 tiny/small（30–830 三角），墙脚/井边用 mid（1.3k–2.3k），large 不用。
  trackPending(new Promise<void>((resolve) => {
    new GLTFLoader().load('models/grass_medium_01/grass_medium_01.gltf', (gltf) => {
      const small: THREE.BufferGeometry[] = [], mid: THREE.BufferGeometry[] = [];
      let mat: THREE.Material | null = null;
      gltf.scene.traverse((o) => {
        const me = o as THREE.Mesh;
        if (!me.isMesh) return;
        const bucket = /_(tiny|small)_/.test(me.name) ? small : /_mid_/.test(me.name) ? mid : null;
        if (!bucket) return;
        const g = me.geometry.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.computeBoundingBox();
        bucket.push(g);
        if (!mat) mat = me.material as THREE.Material;
      });
      if (!small.length || !mid.length || !mat) { resolve(); return; }
      const gm = mat as THREE.MeshStandardMaterial;
      gm.alphaTest = 0.4;
      gm.side = THREE.DoubleSide;
      gm.roughness = 0.9;
      gm.color.setHex(0xb8b090); // 压成枯草色，避免鲜绿（圣经 4.2）
      const variants = [...small, ...mid];
      const picks: number[][] = variants.map(() => []);
      for (let i = 0; i < grassXf.length; i++) {
        const pool = grassEdge[i] ? mid : small;
        const base = grassEdge[i] ? small.length : 0;
        const poolN = Math.min(pool.length, 3); // 限制变体数，控制 draw calls
        picks[base + Math.floor(gr() * poolN)].push(i);
      }
      const mm = new THREE.Matrix4(), sc = new THREE.Matrix4();
      variants.forEach((geo, v) => {
        if (!picks[v].length) return;
        const h0 = geo.boundingBox!.max.y - geo.boundingBox!.min.y || 1;
        const im = new THREE.InstancedMesh(geo, gm, picks[v].length);
        picks[v].forEach((i, k) => {
          // 兜底矩阵的缩放是 h/1.2；模型按 h/h0 重新缩放
          const s = 1.2 / h0;
          sc.makeScale(s, s, s);
          mm.copy(grassXf[i]).multiply(sc);
          im.setMatrixAt(k, mm);
          im.setColorAt(k, grassCol());
        });
        im.castShadow = false; // 草丛太小，阴影贴图里只有噪点；接触暗部交给 GTAO
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      });
      group.remove(grassMesh);
      resolve();
    }, undefined, () => resolve());
  }));

  // The existing bark material serves both trees in one indexed mesh with vertex tint.
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  group.add(buildDeadwood(bark));
  group.add(buildFallenRubble());
  // 铁件下方石面的锈色流痕（水造成，沿重力；壁灯支架/栅门铰链/铁箍下）
  const rustMat = new THREE.MeshStandardMaterial({ map: rustTexture(), roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, y, h, rot] of [[-9.95, 14, 1.95, 1.1, HALF_PI], [9.95, 10, 1.5, 1.0, -HALF_PI], [9.95, 20, 1.5, 1.0, -HALF_PI], [9.95, 5.1, 1.4, 1.2, -HALF_PI], [9.95, 6.9, 1.4, 1.2, -HALF_PI], [-5, 28.44, 2.6, 1.3, 0], [5.5, 0.56, 1.6, 1.1, Math.PI]] as [number, number, number, number, number][]) {
    decal.geo(rustMat, new THREE.PlaneGeometry(0.5, h), x, y, z, rot);
  }
  // 火与烟：壁灯上方扇形烟熏（北墙新灯位）、门房炉口上方熏黑（向上扩散、边缘渐淡）
  const sootMat = new THREE.MeshStandardMaterial({ map: smokeTexture(), color: 0x0b0b0d, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  decal.geo(sootMat, new THREE.PlaneGeometry(1.5, 2.2), -5, 3.5, 28.43, 0);          // 北墙壁灯上方
  decal.geo(sootMat, new THREE.PlaneGeometry(1.6, 2.0), -2.93, 2.7, -4.4, HALF_PI);  // 门房炉口上方（西内墙）
  decal.geo(sootMat, new THREE.PlaneGeometry(1.2, 1.4), -2.6, 3.4, -4.4, HALF_PI);   // 烟道熏黑

  // 散落秋叶：藤下、墙角和井台背风侧积聚，主路只留少量散叶。
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.9, alphaTest: 0.4, side: THREE.DoubleSide });
  const lr = drng(307);
  const leafPos: [number, number][] = [];
  for (const [x, z, wx, wz, n] of YARD_LITTER_POCKETS) {
    for (let i = 0; i < n; i++) leafPos.push([x + (lr() + lr() - 1) * wx, z + (lr() + lr() - 1) * wz]);
  }
  // Leaves and a few newly windblown pieces build up in the lee of the cart,
  // scaffold foot and the threshold wall return, rather than carpet the main run.
  for (const [x,z,dx,dz,n] of [[-4.01,9.69,1.33,.41,35],[-2.48,8.11,.61,.26,16],
    [-6.48,18.42,.68,.53,30],[-2.68,1.33,.86,.50,20],[4.25,14.34,.76,.38,24]]) {
    for (let i=0;i<n;i++) leafPos.push([x+(lr()+lr()-1)*dx,z+(lr()+lr()-1)*dz]);
  }
  for (let i = 0; i < 20; i++) leafPos.push([-8.8 + lr() * 17.6, 1.5 + lr() * 26]);
  const groundedLeaves = leafPos.filter(([x, z]) => plantedGround(x, z));
  const leafGeo = new THREE.PlaneGeometry(1, 1, 3, 3);
  {
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.12 * lp.getX(i) * lp.getX(i) + 0.08 * lp.getY(i) * lp.getY(i));
    leafGeo.computeVertexNormals();
  }
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, groundedLeaves.length);
  {
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler();
    // The texture already contains autumn colour: multiply by faded tan and gray,
    // not another saturated red (which previously made the litter disappear).
    const lc = [0xcfb792, 0xa58b76, 0x9d9385, 0xd1a47b, 0xb1a495].map((h) => new THREE.Color(h));
    for (let i = 0; i < groundedLeaves.length; i++) {
      const s = 0.095 + lr() * 0.13;
      ee.set(-HALF_PI + (lr() - 0.5) * 0.22, 0, lr() * Math.PI * 2);
      qq.setFromEuler(ee);
      mm.compose(new THREE.Vector3(groundedLeaves[i][0], 0.01 + lr() * 0.015, -groundedLeaves[i][1]), qq, new THREE.Vector3(s, s, s));
      leafMesh.setMatrixAt(i, mm);
      leafMesh.setColorAt(i, lc[Math.floor(lr() * lc.length)].clone().multiplyScalar(0.9 + lr() * 0.5));
    }
    leafMesh.receiveShadow = true;
    group.add(leafMesh);
  }

  // 陈设、井台、木桶：见 furniture.ts（与地表/墙体分开，便于并行打磨）
  group.add(buildFurniture(m));

  b.build(group, true);
  decal.build(group, false);
  return { group, windowMat, hearthWindowMat, courtContact };
}
