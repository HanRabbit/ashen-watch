// 远景（art pass 2）：山顶城堡、第二城门塔楼、松林三层、山雾分层。
// 城堡用「手动雾混合」的无雾材质：白天被山雾吞没大半，夜晚保留剪影 + 暖窗灯。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch } from './geom';
import { Materials, scaleUV } from './materials';

export interface Scenery {
  group: THREE.Group;
}

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** 低模松树：树干 + 三层锥体冠，合并为单一几何供 InstancedMesh 使用。 */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  parts.push(trunk);
  const tiers: [number, number, number][] = [[2.6, 3.8, 1.2], [2.1, 3.2, 2.9], [1.5, 2.8, 4.6]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, y + h / 2, 0);
    parts.push(cone);
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return geo;
}

/** 圆塔 + 尖锥顶（城堡用，局部坐标，底在 y0）。 */
function tower(parts: THREE.BufferGeometry[], x: number, z: number, y0: number, r: number, h: number, spire: number): void {
  const body = new THREE.CylinderGeometry(r, r * 1.08, h, 10);
  body.translate(x, y0 + h / 2, z);
  parts.push(body);
  const cap = new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.6, 10);
  cap.translate(x, y0 + h + 0.3, z);
  parts.push(cap);
  const cone = new THREE.ConeGeometry(r * 1.2, spire, 10);
  cone.translate(x, y0 + h + 0.6 + spire / 2, z);
  parts.push(cone);
}

const HALF_PI = Math.PI / 2;

export function buildScenery(m: Materials): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';

  // ——— 大地盘：延伸至雾外的暗色地面 ———
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(320, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = false;
  group.add(ground);

  // ——— 山丘（岩石质感，正常场景雾）———
  const hillBatch = new Batch();
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x555a58, roughness: 1, map: m.gravel.map, normalMap: m.gravel.normalMap });
  const hills: [number, number, number, number][] = [
    // [x, z, 半径, 高]
    [70, 60, 38, 28],   // 城堡山
    [-11, 78, 16, 7],   // 城门塔楼丘
    [-45, 100, 42, 16],
    [20, 125, 50, 22],
    [-80, 55, 34, 12],
    [100, 115, 46, 18],
    [45, 105, 30, 12],
  ];
  for (const [x, z, r, h] of hills) {
    const cone = new THREE.ConeGeometry(r, h, 12, 3);
    // 顶点扰动，避免完美圆锥
    const pos = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const n = Math.sin(px * 0.35 + pz * 0.27) * Math.cos(pz * 0.31 - px * 0.19);
      if (py < h / 2 - 0.1) {
        pos.setX(i, px * (1 + n * 0.14));
        pos.setZ(i, pz * (1 + n * 0.14));
        pos.setY(i, py + n * h * 0.06);
      }
    }
    cone.computeVertexNormals();
    hillBatch.geo(hillMat, scaleUV(cone, 0.06), x, h / 2 - 1.2, z);
  }
  hillBatch.build(group, false);

  // ——— 山顶城堡：主楼 + 多座圆塔尖顶 + 城墙（剪影丰富）———
  const castleParts: THREE.BufferGeometry[] = [];
  const cx = 70, czSim = 60, cy = 25; // 城堡基座（山丘顶附近）
  const cz = -czSim; // 几何用渲染坐标 z = -sim.z
  // 主楼
  const keep = new THREE.BoxGeometry(11, 26, 11);
  keep.translate(cx, cy + 13, cz);
  castleParts.push(keep);
  const keepRoof = new THREE.ConeGeometry(8.6, 12, 4);
  keepRoof.rotateY(Math.PI / 4);
  keepRoof.translate(cx, cy + 32, cz);
  castleParts.push(keepRoof);
  // 主楼四角小塔
  for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) {
    tower(castleParts, cx + dx, cz + dz, cy + 18, 1.7, 12, 6);
  }
  // 外圈圆塔 + 城墙
  const ring: [number, number, number, number][] = [
    [-14, -9, 2.8, 18], [-15, 7, 2.6, 15], [13, -11, 3.0, 20], [15, 6, 2.7, 16],
    [-2, -15, 2.4, 14], [5, 14, 2.5, 15], [-9, 13, 2.2, 13],
  ];
  for (const [dx, dz, r, h] of ring) tower(castleParts, cx + dx, cz + dz, cy - 2, r, h, r * 2.4);
  // 连墙
  const wallPairs: [number, number, number, number][] = [
    [-13, -8, -2, -14], [-2, -14, 12, -10], [12, -10, 14, 5], [14, 5, 4, 13],
    [4, 13, -8, 12], [-8, 12, -14, 6], [-14, 6, -13, -8],
  ];
  for (const [ax, az, bx, bz] of wallPairs) {
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    const wall = new THREE.BoxGeometry(1.6, 7, len);
    wall.rotateY(ang);
    wall.translate(cx + (ax + bx) / 2, cy + 1.5, cz + (az + bz) / 2);
    castleParts.push(wall);
    // 垛口
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
      const merlon = new THREE.BoxGeometry(1.7, 1.1, 1.0);
      merlon.rotateY(ang);
      merlon.translate(cx + mx, cy + 5.5, cz + mz);
      castleParts.push(merlon);
    }
  }
  const castleGeo = mergeGeometries(castleParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of castleParts) g.dispose();
  // 高度渐变顶点色：底部沉入雾中更暗，顶部稍亮，避免纯色剪影的纸片感
  const shadeByHeight = (geo: THREE.BufferGeometry, y0: number, span: number): void => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, Math.min(1, (pos.getY(i) - y0) / span));
      const v = 0.68 + 0.32 * t;
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  };
  shadeByHeight(castleGeo, cy - 4, 44);
  const castleMat = new THREE.MeshBasicMaterial({ color: 0x59626c, fog: false, vertexColors: true });
  const castle = new THREE.Mesh(castleGeo, castleMat);
  group.add(castle);

  // ——— 第二城门塔楼（概念图左侧远处）———
  const gateParts: THREE.BufferGeometry[] = [];
  const gx = -11, gzSim = 78, gy = 6.5;
  const gz = -gzSim;
  tower(gateParts, gx - 3.4, gz, gy, 2.4, 18, 7);
  tower(gateParts, gx + 3.4, gz, gy, 2.4, 18, 7);
  const gateWall = new THREE.BoxGeometry(9.5, 14, 3);
  gateWall.translate(gx, gy + 7, gz);
  gateParts.push(gateWall);
  const gateRoof = new THREE.ConeGeometry(5.6, 4.5, 4);
  gateRoof.rotateY(Math.PI / 4);
  gateRoof.translate(gx, gy + 16.2, gz);
  gateParts.push(gateRoof);
  // 门洞（暗色凹陷）
  const gateArch = new THREE.BoxGeometry(2.6, 4.5, 3.4);
  gateArch.translate(gx, gy + 2.2, gz);
  gateParts.push(gateArch);
  const gateGeo = mergeGeometries(gateParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of gateParts) g.dispose();
  shadeByHeight(gateGeo, gy, 26);
  const gateTower = new THREE.Mesh(gateGeo, castleMat);
  group.add(gateTower);

  // ——— 城堡暖窗灯（夜晚 3–6 点琥珀色）———
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb25e, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const winBatch = new Batch();
  // 面向庭院（西南）的窗
  // [x, y, z, rotY]：主楼西面/南面 + 两座外塔朝庭院的西南面
  const winSpots: [number, number, number, number][] = [
    [cx - 5.56, cy + 20, czSim - 2, -HALF_PI], [cx - 5.56, cy + 24, czSim + 1.5, -HALF_PI],
    [cx - 2, cy + 22, czSim - 5.56, 0],
    [cx - 7.1, cy + 22, czSim - 6.3, -1.13], [cx + 10.4, cy + 20, czSim - 12.3, -1.13],
    [gx, gy + 8, gzSim - 1.56, 0],
  ];
  for (const [x, y, z, rot] of winSpots) {
    winBatch.geo(winMat, new THREE.PlaneGeometry(0.8, 1.4), x, y, z, rot);
  }
  winBatch.build(group, false);

  // ——— 外墙延伸与外侧塔楼（庭院东北角外，正常雾）———
  const outerBatch = new Batch();
  outerBatch.box(m.stone, 25, 28.5, 56, 29.5, 0, 5.5);
  for (let x = 26; x < 56; x += 1.6) outerBatch.box(m.stone, x, 28.5, x + 0.8, 29.5, 5.5, 6.1);
  for (const x of [36, 52]) {
    outerBatch.geo(m.stone, scaleUV(new THREE.CylinderGeometry(2.2, 2.5, 9, 10), 0.4), x, 4.5, 29);
    outerBatch.geo(m.roof, scaleUV(new THREE.ConeGeometry(2.6, 4, 10), 0.4), x, 11, 29);
  }
  outerBatch.box(m.stone, -10.5, 29, -9.5, 62, 0, 5);
  for (let z = 30; z < 62; z += 1.6) outerBatch.box(m.stone, -10.5, z, -9.5, z + 0.8, 5, 5.6);
  outerBatch.build(group, false);

  // ——— 松林：三层 InstancedMesh，由近到远渐淡 ———
  const pineGeo = pineGeometry();
  let seed = 977;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const layers: { count: number; r0: number; r1: number; color: number; h0: number; h1: number }[] = [
    { count: 160, r0: 26, r1: 46, color: 0x2f3630, h0: 4.5, h1: 8 },
    { count: 260, r0: 46, r1: 88, color: 0x3c443c, h0: 7, h1: 13 },
    { count: 230, r0: 88, r1: 150, color: 0x4d564e, h0: 9, h1: 16 },
  ];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (const layer of layers) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const inst = new THREE.InstancedMesh(pineGeo, mat, layer.count);
    let placed = 0, guard = 0;
    while (placed < layer.count && guard++ < layer.count * 12) {
      const a = rnd() * Math.PI * 2;
      const r = layer.r0 + rnd() * (layer.r1 - layer.r0);
      // 以庭院中心为原点，偏向北/东/西（南面门房后方少种）
      const x = Math.sin(a) * r * 1.15;
      const z = 14 + Math.cos(a) * r;
      // 排除可玩区与建筑足迹
      if (x > -13 && x < 27 && z > -11 && z < 32) continue;
      if (z < -20 && Math.abs(x) < 20) continue;
      if (z < 6 && rnd() < 0.7) continue; // 南面门房后方少种，集中北/西/东
      // 城堡山上不种（留给城堡剪影）
      if (Math.hypot(x - 70, z - 60) < 30) continue;
      if (Math.hypot(x + 11, z - 78) < 14) continue;
      const h = layer.h0 + rnd() * (layer.h1 - layer.h0);
      const s = h / 7.3;
      dummy.position.set(x, -0.3, -z);
      dummy.rotation.y = rnd() * Math.PI * 2;
      dummy.scale.set(s * (0.85 + rnd() * 0.3), s, s * (0.85 + rnd() * 0.3));
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.setHex(layer.color).multiplyScalar(0.8 + rnd() * 0.4);
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  }

  // ——— 山雾分层：几片巨大的软雾团，横在庭院与城堡之间 ———
  const mistTex = makeMistTexture();
  const mistMat = new THREE.SpriteMaterial({ map: mistTex, color: 0x9aa2a8, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
  const mists: THREE.Sprite[] = [];
  const mistSpots: [number, number, number, number, number][] = [
    // [x, y, z, 宽, 高]
    [48, 12, 44, 55, 13], [70, 30, 62, 72, 18], [-4, 7, 46, 45, 10],
    [15, 16, 90, 80, 20], [60, 8, 36, 40, 9], [-14, 11, 70, 50, 12],
  ];
  for (const [x, y, z, w, h] of mistSpots) {
    const sp = new THREE.Sprite(mistMat);
    sp.position.set(x, y, -z);
    sp.scale.set(w, h, 1);
    mists.push(sp);
    group.add(sp);
  }

  // ——— 每帧大气驱动：借 scene.fog 推断昼夜，手动混合城堡剪影色与雾色 ———
  const dayBase = new THREE.Color(0x5a636e);
  const nightBase = new THREE.Color(0x0a0f18);
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  castle.onBeforeRender = (_r, scene) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const night = clamp01(1 - (fog.far - 52) / 70);
    // 城堡距参考机位约 100 m：白天雾因子 ~0.67，夜晚雾已吞没一切 → 改用剪影混合
    const dist = 97;
    const f = clamp01((dist - fog.near) / Math.max(1, fog.far - fog.near));
    tmpA.copy(dayBase).lerp(nightBase, night);
    tmpB.copy(fog.color).multiplyScalar(1 + night * 0.9); // 夜晚雾色提亮近似天际线
    const amount = Math.min(0.88, f * 0.8) * (1 - night) + 0.35 * night;
    castleMat.color.copy(tmpA).lerp(tmpB, Math.min(0.88, amount));
    winMat.opacity = night * 0.95;
    mistMat.opacity = 0.32 * (1 - night) + 0.06 * night;
    mistMat.color.copy(fog.color).multiplyScalar(1.45 - night * 0.25);
  };

  return { group };
}

/** 横向软雾带：上下软衰减 + 絮状噪声。 */
function makeMistTexture(): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  let s = 613;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const waves = Array.from({ length: 6 }, () => ({ fx: 1 + rnd() * 3, fy: 1 + rnd() * 2, ph: rnd() * 6.28, a: 0.5 + rnd() * 0.5 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      let n = 0;
      for (const w of waves) n += w.a * Math.cos(u * w.fx * 6 + w.ph) * Math.cos(v * w.fy * 4 + w.ph * 1.6);
      n = n / waves.length * 0.5 + 0.5;
      const vert = Math.sin(v * Math.PI); // 上下软边
      const horiz = Math.min(1, Math.min(u, 1 - u) * 6); // 左右软边
      const a = Math.pow(vert, 1.6) * horiz * (0.35 + 0.65 * n);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}