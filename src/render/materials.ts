// 材质（MAT-01）：全部走 PBR（MeshStandardMaterial）。石、木、地、瓦优先用 Poly Haven 的 CC0 贴图
// （颜色 + 法线 + 粗糙度，见 public/textures/CREDITS.md），加载前或离线时回退到画布程序化贴图。
// 锻铁、破布、残旗、纸张等仍程序化生成。贴图在画布上生成，不依赖构建期资源。
import * as THREE from 'three';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

function toTex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 由高度图求法线（Sobel），输出切线空间法线贴图。 */
function normalFromHeight(hc: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const S = hc.width;
  const src = hc.getContext('2d')!.getImageData(0, 0, S, S).data;
  const { c, g } = canvas(S);
  const out = g.createImageData(S, S);
  const h = (x: number, y: number): number => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      out.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return toTex(c, false);
}

function speckle(g: CanvasRenderingContext2D, r: () => number, n: number, size: number, dark: number, light: number): void {
  for (let i = 0; i < n; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${dark * r()})` : `rgba(255,255,255,${light * r()})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

interface Surface { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture }

/** 砌块：颜色与高度同步绘制，灰缝凹陷、块面微凸。 */
export function blocks(base: [number, number, number], rows: number, cols: number, seed: number, mortar = 0.5): Surface {
  const S = 256;
  const col = canvas(S), ht = canvas(S), ro = canvas(S);
  const r = rng(seed);
  const bh = S / rows, bw = S / cols;
  col.g.fillStyle = `rgb(${base.map((v) => Math.round(v * mortar)).join(',')})`;
  col.g.fillRect(0, 0, S, S);
  ht.g.fillStyle = '#404040'; ht.g.fillRect(0, 0, S, S);
  ro.g.fillStyle = '#d8d8d8'; ro.g.fillRect(0, 0, S, S);
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * bw * 0.5;
    for (let x = -1; x < cols; x++) {
      const k = 0.82 + r() * 0.3;
      col.g.fillStyle = `rgb(${base.map((v) => Math.round(Math.min(255, v * k))).join(',')})`;
      col.g.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
      const hv = 150 + Math.floor(r() * 60);
      ht.g.fillStyle = `rgb(${hv},${hv},${hv})`;
      ht.g.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
      const rv = 190 + Math.floor(r() * 50);
      ro.g.fillStyle = `rgb(${rv},${rv},${rv})`;
      ro.g.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
    }
  }
  speckle(col.g, r, 2600, S, 0.2, 0.07);
  speckle(ht.g, r, 1800, S, 0.25, 0.2);
  return { map: toTex(col.c, true), normalMap: normalFromHeight(ht.c, 2.2), roughnessMap: toTex(ro.c, false) };
}

function planks(base: [number, number, number], n: number, seed: number): Surface {
  const S = 256;
  const col = canvas(S), ht = canvas(S), ro = canvas(S);
  const r = rng(seed);
  const pw = S / n;
  ht.g.fillStyle = '#808080'; ht.g.fillRect(0, 0, S, S);
  ro.g.fillStyle = '#c0c0c0'; ro.g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) {
    const k = 0.8 + r() * 0.35;
    col.g.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
    col.g.fillRect(i * pw, 0, pw, S);
    col.g.fillStyle = 'rgba(0,0,0,0.55)'; col.g.fillRect(i * pw, 0, 2, S);
    ht.g.fillStyle = '#303030'; ht.g.fillRect(i * pw, 0, 2, S);
    const hv = 120 + Math.floor(r() * 40);
    ht.g.fillStyle = `rgb(${hv},${hv},${hv})`; ht.g.fillRect(i * pw + 2, 0, pw - 2, S);
    for (let j = 0; j < 14; j++) {
      col.g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
      col.g.fillRect(i * pw + r() * pw, 0, 1, S);
      ht.g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`;
      ht.g.fillRect(i * pw + r() * pw, 0, 1, S);
    }
  }
  speckle(col.g, r, 900, S, 0.2, 0.05);
  return { map: toTex(col.c, true), normalMap: normalFromHeight(ht.c, 1.6), roughnessMap: toTex(ro.c, false) };
}

function noiseSurf(base: [number, number, number], seed: number, amount: number, grain = 3, rough = 200): Surface {
  const S = 128;
  const col = canvas(S), ht = canvas(S), ro = canvas(S);
  const r = rng(seed);
  col.g.fillStyle = `rgb(${base.join(',')})`; col.g.fillRect(0, 0, S, S);
  ht.g.fillStyle = '#808080'; ht.g.fillRect(0, 0, S, S);
  ro.g.fillStyle = `rgb(${rough},${rough},${rough})`; ro.g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const v = r();
    col.g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amount * r()})` : `rgba(255,255,255,${amount * 0.5 * r()})`;
    const s = 1 + r() * grain;
    const x = r() * S, y = r() * S;
    col.g.fillRect(x, y, s, s);
    ht.g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amount * r()})` : `rgba(255,255,255,${amount * r()})`;
    ht.g.fillRect(x, y, s, s);
    ro.g.fillStyle = `rgba(${v < 0.5 ? '255,255,255' : '0,0,0'},${amount * 0.6 * r()})`;
    ro.g.fillRect(x, y, s, s);
  }
  return { map: toTex(col.c, true), normalMap: normalFromHeight(ht.c, 1.2), roughnessMap: toTex(ro.c, false) };
}

/** 径向渐变：光斑、雾团与火焰共用。 */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const { c, g } = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.35)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 软烟团：分形噪点遮罩的径向衰减，用于鬼的衣摆雾与炉烟。 */
export function smokeTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S);
  const r = rng(77);
  const img = g.createImageData(S, S);
  // 几组随机余弦波叠加出絮状纹理
  const waves = Array.from({ length: 6 }, () => ({ fx: 1 + r() * 4, fy: 1 + r() * 4, ph: r() * 6.28, a: 0.5 + r() * 0.5 }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S - 0.5) * 2, v = (y / S - 0.5) * 2;
      const d = Math.hypot(u, v);
      let n = 0;
      for (const w of waves) n += w.a * Math.cos(u * w.fx * 3 + w.ph) * Math.cos(v * w.fy * 3 + w.ph * 1.7);
      n = n / waves.length * 0.5 + 0.5;
      const fall = Math.max(0, 1 - d);
      const a = Math.pow(fall, 1.8) * (0.45 + 0.55 * n);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 苔痕贴花：墙脚与石缝的暗绿斑片，带 alpha。 */
export function mossTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S);
  const r = rng(91);
  const img = g.createImageData(S, S);
  const waves = Array.from({ length: 5 }, () => ({ fx: 1 + r() * 5, fy: 1 + r() * 5, ph: r() * 6.28 }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let n = 0;
      for (const w of waves) n += Math.cos(u * w.fx * 6 + w.ph) * Math.cos(v * w.fy * 6 + w.ph * 1.3);
      n = n / waves.length * 0.5 + 0.5;
      const patch = Math.max(0, n - 0.45) * 2.2;
      const edge = Math.min(u, 1 - u, v, 1 - v) * 6;
      const a = Math.min(1, patch) * Math.min(1, edge);
      const i = (y * S + x) * 4;
      img.data[i] = 40 + n * 30; img.data[i + 1] = 60 + n * 45; img.data[i + 2] = 32 + n * 20;
      img.data[i + 3] = a * 200;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 单片藤叶（三裂心形，带 alpha 与叶脉明暗）。近白色底，颜色由 InstancedMesh 的 instanceColor 决定。 */
export function ivyLeafTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  g.clearRect(0, 0, S, S);
  g.translate(S / 2, S / 2 + 4);
  const grd = g.createRadialGradient(0, -6, 2, 0, 0, 30);
  grd.addColorStop(0, 'rgba(255,244,238,1)');
  grd.addColorStop(0.7, 'rgba(226,210,200,1)');
  grd.addColorStop(1, 'rgba(178,160,150,1)');
  g.fillStyle = grd;
  // 三裂叶：中央裂片 + 两侧裂片，叶尖朝下（-y 为叶柄方向）
  g.beginPath();
  g.moveTo(0, -26);
  g.quadraticCurveTo(10, -20, 12, -12);
  g.quadraticCurveTo(24, -14, 27, -4);
  g.quadraticCurveTo(24, 8, 12, 10);
  g.quadraticCurveTo(10, 20, 0, 27);
  g.quadraticCurveTo(-10, 20, -12, 10);
  g.quadraticCurveTo(-24, 8, -27, -4);
  g.quadraticCurveTo(-24, -14, -12, -12);
  g.quadraticCurveTo(-10, -20, 0, -26);
  g.closePath();
  g.fill();
  // 叶脉
  g.strokeStyle = 'rgba(120,96,88,0.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 24);
  g.moveTo(0, -6); g.lineTo(18, -2); g.moveTo(0, -6); g.lineTo(-18, -2);
  g.moveTo(0, 6); g.lineTo(10, 12); g.moveTo(0, 6); g.lineTo(-10, 12);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 草丛：几片草叶的 alpha 贴图，用于石板缝里的十字面片。 */
export function grassTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  const r = rng(151);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 11; i++) {
    const x = 8 + r() * 48;
    const h = 20 + r() * 34;
    const lean = (r() - 0.5) * 14;
    const grd = g.createLinearGradient(0, S, 0, S - h);
    grd.addColorStop(0, 'rgba(96,100,52,0.95)');
    grd.addColorStop(1, 'rgba(172,162,92,0.9)');
    g.strokeStyle = grd; g.lineWidth = 2.5 + r() * 2;
    g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + lean * 0.5, S - h * 0.6, x + lean, S - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 秋叶：锯齿五裂枫叶轮廓 + 叶柄与叶脉，锈红渐变，用于地面实例化落叶。 */
export function leafTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S);
  const r = rng(191);
  g.clearRect(0, 0, S, S);
  g.translate(S / 2, S / 2 + 6);
  const grd = g.createRadialGradient(0, -8, 4, 0, 0, 58);
  grd.addColorStop(0, `rgba(${170 + r() * 40},${86 + r() * 26},30,0.98)`);
  grd.addColorStop(0.65, `rgba(${140 + r() * 30},${62 + r() * 20},24,0.96)`);
  grd.addColorStop(1, `rgba(${96 + r() * 24},${44 + r() * 16},18,0.94)`);
  g.fillStyle = grd;
  // 五裂枫叶：裂片尖 + 锯齿缘
  const lobe = (a: number, len: number, w: number): void => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca;
    g.lineTo(ca * len * 0.45 + px * w, sa * len * 0.45 + py * w);
    g.lineTo(ca * len * 0.62 + px * w * 0.55, sa * len * 0.62 + py * w * 0.55);
    g.lineTo(ca * len * 0.8 + px * w * 0.8, sa * len * 0.8 + py * w * 0.8);
    g.lineTo(ca * len, sa * len);
    g.lineTo(ca * len * 0.8 - px * w * 0.8, sa * len * 0.8 - py * w * 0.8);
    g.lineTo(ca * len * 0.62 - px * w * 0.55, sa * len * 0.62 - py * w * 0.55);
    g.lineTo(ca * len * 0.45 - px * w, sa * len * 0.45 - py * w);
  };
  g.beginPath();
  g.moveTo(0, 44);
  const angles = [-Math.PI / 2, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62, -Math.PI / 2 - 1.25, -Math.PI / 2 + 1.25];
  const lens = [52, 44, 44, 30, 30];
  g.moveTo(Math.cos(angles[3]) * 12, Math.sin(angles[3]) * 12 + 8);
  for (let i = 0; i < 5; i++) lobe(angles[i], lens[i], 7 + (i === 0 ? 3 : 0));
  g.closePath();
  g.fill();
  // 叶柄
  g.strokeStyle = 'rgba(90,48,22,0.95)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 30); g.lineTo(0, 52); g.stroke();
  // 叶脉
  g.strokeStyle = 'rgba(70,36,16,0.5)'; g.lineWidth = 1.6;
  for (const a of angles) {
    g.beginPath(); g.moveTo(0, 6); g.lineTo(Math.cos(a) * 40, Math.sin(a) * 40 + 6); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 玻璃污渍：竖向灰垢条带，用作玻璃粗糙度贴图（线性）。 */
export function grimeTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  const r = rng(231);
  g.fillStyle = '#303030'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = r() * S, w = 1 + r() * 4;
    const a = 0.15 + r() * 0.4;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x, r() * S * 0.3, w, S * (0.4 + r() * 0.6));
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.15})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  return toTex(c, false);
}

/** 锈色流痕：铁件下方石面上的竖向锈渍贴花（alpha）。 */
export function rustTexture(): THREE.CanvasTexture {
  const W = 64, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(251);
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) {
    const x = 6 + r() * (W - 12), w = 1.5 + r() * 3.5;
    const len = H * (0.35 + r() * 0.6);
    const grd = g.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, `rgba(90,58,36,${0.5 + r() * 0.3})`);
    grd.addColorStop(0.6, `rgba(70,44,28,${0.25 + r() * 0.2})`);
    grd.addColorStop(1, 'rgba(60,38,24,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, len);
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(80,50,30,${0.05 + r() * 0.2})`;
    g.fillRect(r() * W, r() * H * 0.7, 1 + r() * 2, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 残旗：暗红底 + 灰烬守夜徽记（钟塔剪影），下摆破损。 */
export function bannerTexture(): THREE.CanvasTexture {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(171);
  g.fillStyle = '#6e2a28'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  // 徽记：钟塔与钟
  g.strokeStyle = 'rgba(200,190,170,0.8)'; g.fillStyle = 'rgba(200,190,170,0.8)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(44, 150); g.lineTo(44, 80); g.lineTo(64, 60); g.lineTo(84, 80); g.lineTo(84, 150); g.stroke();
  g.beginPath(); g.moveTo(56, 110); g.quadraticCurveTo(56, 92, 64, 90); g.quadraticCurveTo(72, 92, 72, 110); g.lineTo(76, 118); g.lineTo(52, 118); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(40, 150); g.lineTo(88, 150); g.stroke();
  // 下摆破损
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, H - 10 - r() * 26);
  g.lineTo(W, H); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 从扫描高度图分割石板：连通域标记 → 每块哈希/平均高度 + 到缝距离变换，烘成 RGBA 单元图。
 * R=每块石板哈希（明暗/冷暖差异），G=到缝距离（倒角积 dirt），B=每块平均高度（选低洼积水），A=石板遮罩。 */
export function bakeStoneCells(dispImg: CanvasImageSource): THREE.CanvasTexture {
  const S = 1024, N = S * S;
  const { c, g } = canvas(S);
  g.drawImage(dispImg, 0, 0, S, S);
  const src = g.getImageData(0, 0, S, S).data;
  const stone = new Uint8Array(N);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    height[i] = src[i * 4] / 255;
    stone[i] = height[i] > 0.72 ? 1 : 0;
  }
  // 连通域标记（4 邻域 BFS）
  const label = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const areas: number[] = [], sums: number[] = [];
  let nStones = 0;
  for (let seed = 0; seed < N; seed++) {
    if (!stone[seed] || label[seed] >= 0) continue;
    const id = nStones++;
    let sp = 0, area = 0, sum = 0;
    stack[sp++] = seed; label[seed] = id;
    while (sp > 0) {
      const p = stack[--sp];
      area++; sum += height[p];
      const x = p % S, y = (p / S) | 0;
      if (x > 0 && stone[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < S - 1 && stone[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && stone[p - S] && label[p - S] < 0) { label[p - S] = id; stack[sp++] = p - S; }
      if (y < S - 1 && stone[p + S] && label[p + S] < 0) { label[p + S] = id; stack[sp++] = p + S; }
    }
    areas.push(area); sums.push(sum);
  }
  // 碎砾（面积过小）并入缝
  const valid = areas.map((a) => a >= 160);
  for (let i = 0; i < N; i++) {
    if (label[i] >= 0 && !valid[label[i]]) { stone[i] = 0; label[i] = -1; }
  }
  // 到缝距离（chamfer 两遍）
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = stone[i] ? 1e9 : 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x; if (!stone[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - S] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - S - 1] + 1.414);
      if (x < S - 1 && y > 0) d = Math.min(d, dist[i - S + 1] + 1.414);
      dist[i] = d;
    }
  }
  for (let y = S - 1; y >= 0; y--) {
    for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x; if (!stone[i]) continue;
      let d = dist[i];
      if (x < S - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < S - 1) d = Math.min(d, dist[i + S] + 1);
      if (x < S - 1 && y < S - 1) d = Math.min(d, dist[i + S + 1] + 1.414);
      if (x > 0 && y < S - 1) d = Math.min(d, dist[i + S - 1] + 1.414);
      dist[i] = d;
    }
  }
  const out = g.createImageData(S, S);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    if (stone[i] && label[i] >= 0) {
      const id = label[i];
      const hsh = ((Math.sin(id * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
      out.data[o] = hsh * 255;
      out.data[o + 1] = Math.min(1, dist[i] / 16) * 255;
      out.data[o + 2] = Math.min(1, Math.max(0, sums[id] / areas[id])) * 255;
      out.data[o + 3] = 255;
    } else {
      out.data[o] = out.data[o + 1] = out.data[o + 2] = out.data[o + 3] = 0;
    }
  }
  g.putImageData(out, 0, 0);
  return toTex(c, false);
}

/** 铅条玻璃：暗玻璃底 + 铅条网格 + 污渍烟熏。返回 map（暗玻璃）与 panes（窗格遮罩，用作 emissiveMap）。 */
export function leadedGlass(warm = false): { map: THREE.CanvasTexture; panes: THREE.CanvasTexture } {
  const W = 128, H = 256;
  const mk = (): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    return { c, g: c.getContext('2d')! };
  };
  const r = rng(warm ? 311 : 307);
  const base = mk(), pane = mk();
  // 玻璃底：冷暗灰（白天透天光）或暖暗褐（炉火窗）
  base.g.fillStyle = warm ? '#241a12' : '#10161c';
  base.g.fillRect(0, 0, W, H);
  pane.g.fillStyle = '#000'; pane.g.fillRect(0, 0, W, H);
  // 菱形铅条窗格：每格略带色差，铅条压暗
  const cellW = 22, cellH = 30;
  for (let y = -1; y < H / cellH + 1; y++) {
    for (let x = -1; x < W / cellW + 1; x++) {
      const cx = x * cellW + (y % 2) * cellW * 0.5, cy = y * cellH;
      const k = 0.8 + r() * 0.4;
      const grd = base.g.createRadialGradient(cx, cy, 1, cx, cy, cellW * 0.7);
      if (warm) {
        grd.addColorStop(0, `rgba(${Math.round(70 * k)},${Math.round(48 * k)},${Math.round(30 * k)},1)`);
        grd.addColorStop(1, `rgba(${Math.round(36 * k)},${Math.round(26 * k)},${Math.round(18 * k)},1)`);
      } else {
        grd.addColorStop(0, `rgba(${Math.round(46 * k)},${Math.round(58 * k)},${Math.round(70 * k)},1)`);
        grd.addColorStop(1, `rgba(${Math.round(20 * k)},${Math.round(28 * k)},${Math.round(36 * k)},1)`);
      }
      base.g.fillStyle = grd;
      base.g.beginPath();
      base.g.moveTo(cx, cy - cellH * 0.5); base.g.lineTo(cx + cellW * 0.5, cy);
      base.g.lineTo(cx, cy + cellH * 0.5); base.g.lineTo(cx - cellW * 0.5, cy);
      base.g.closePath(); base.g.fill();
      // 窗格遮罩（菱形内白，铅条黑）
      pane.g.fillStyle = `rgba(255,255,255,${0.75 + r() * 0.25})`;
      pane.g.beginPath();
      pane.g.moveTo(cx, cy - cellH * 0.5 + 2); pane.g.lineTo(cx + cellW * 0.5 - 2, cy);
      pane.g.lineTo(cx, cy + cellH * 0.5 - 2); pane.g.lineTo(cx - cellW * 0.5 + 2, cy);
      pane.g.closePath(); pane.g.fill();
    }
  }
  // 铅条线
  base.g.strokeStyle = 'rgba(8,9,10,0.95)'; base.g.lineWidth = 2.4;
  for (let y = -1; y < H / cellH + 1; y++) {
    for (let x = -1; x < W / cellW + 1; x++) {
      const cx = x * cellW + (y % 2) * cellW * 0.5, cy = y * cellH;
      base.g.beginPath();
      base.g.moveTo(cx, cy - cellH * 0.5); base.g.lineTo(cx + cellW * 0.5, cy);
      base.g.lineTo(cx, cy + cellH * 0.5); base.g.lineTo(cx - cellW * 0.5, cy);
      base.g.closePath(); base.g.stroke();
    }
  }
  // 污渍烟熏（竖向灰垢）
  for (let i = 0; i < 40; i++) {
    base.g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.18})`;
    base.g.fillRect(r() * W, r() * H * 0.4, 1 + r() * 3, H * (0.3 + r() * 0.6));
  }
  const map = toTex(base.c, true);
  const panes = toTex(pane.c, false);
  return { map, panes };
}

// —— 共享石材着色器（石墙 / 石地 / 瓦 / 碎石共用，onBeforeCompile 注入）——
// 世界坐标宏观噪声打破平铺重复；墙脚潮湿发黑偏绿苔、墙顶向上面生苔与竖向雨渍、白灰缝压暗；
// 庭院石板用扫描单元图做每块差异/倒角/泥缝，低洼石板 + 洼地中心生成不规则积水（镜面反射）；
// 视差遮挡贴图（POM，8–24 步）用 disp 高度图，低画质经 setMaterialsQuality 关闭。

/** 全局 POM 步数开关：high=16 步，low=0（关闭）。view.ts 以后可调用 setMaterialsQuality。 */
const AW_STEPS = { value: 16 };
export function setMaterialsQuality(q: 'high' | 'low'): void {
  AW_STEPS.value = q === 'low' ? 0 : 16;
}

export interface AwUniforms {
  uAwSteps: { value: number };
  uAwFloor: { value: number };
  uAwWet: { value: number };
  uAwDesat: { value: number };
  uAwTint: { value: THREE.Vector3 };
  uAwHeightScale: { value: number };
  uAwHeightMap: { value: THREE.Texture };
  uAwHasDisp: { value: number };
  uAwAlbedo: { value: THREE.Texture };
  uAwStreakBand: { value: THREE.Vector2 };
  /** 石板单元图（R=每块哈希 G=到缝距离 B=每块平均高度 A=石板遮罩），仅庭院石板地启用。 */
  uAwCellMap: { value: THREE.Texture };
  uAwHasCells: { value: number };
  /** 无单元图时是否叠加错缝网格灰缝（矩形石板/室内砖启用，卵石/泥土关闭）。 */
  uAwGrid: { value: number };
  /** 无单元图地面的积水强度（室外石板/卵石启用，室内/泥土关闭）。 */
  uAwPuddleAmt: { value: number };
  /** 积水洼地中心（世界 xz）+ 半径 + 强度，与 vfx.ts 的 PUDDLES 保持一致。 */
  uAwPuddles: { value: THREE.Vector4[] };
  /** 主路↔边缘混合过渡（5.1 反重复第 4 条）：第二套贴图 + 世界 x 噪声遮罩，仅庭院地面启用。 */
  uAwBlendAlbedo: { value: THREE.Texture };
  uAwBlendNormal: { value: THREE.Texture };
  uAwBlendRough: { value: THREE.Texture };
  uAwBlendDisp: { value: THREE.Texture };
  uAwHasBlend: { value: number };
  uAwBlendHalf: { value: number };
  uAwBlendBand: { value: number };
}

/** 庭院积水洼地（模拟坐标 x,z,r），与 vfx.ts PUDDLES 完全一致；着色器里 z 取负转到世界坐标。 */
export const PUDDLE_CENTERS: [number, number, number][] = [[-4, 8, 1.1], [3.5, 18, 1.3], [-2, 24, 0.9], [6, 12, 0.8]];

/** 被磨亮的区域（井沿、台阶中央）：xz 中心 + 半径 + 强度，石材着色器共用。 */
const AW_WEAR = { value: [
  new THREE.Vector4(0, 14, 1.45, 0.8),   // 井沿
  new THREE.Vector4(9.3, 27, 1.1, 0.7),  // 外廊台阶
  new THREE.Vector4(12.5, 16, 0.8, 0.7), // 礼拜堂侧门台阶
] };

const AW_FALLBACK_HEIGHT = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function awUniforms(floor: number, wet: number, desat: number, tint: [number, number, number], hs: number, band: [number, number] = [0, 0]): AwUniforms {
  return {
    uAwSteps: AW_STEPS,
    uAwFloor: { value: floor },
    uAwWet: { value: wet },
    uAwDesat: { value: desat },
    uAwTint: { value: new THREE.Vector3(...tint) },
    uAwHeightScale: { value: hs },
    uAwHeightMap: { value: AW_FALLBACK_HEIGHT },
    uAwHasDisp: { value: 0 },
    uAwAlbedo: { value: AW_FALLBACK_HEIGHT },
    uAwStreakBand: { value: new THREE.Vector2(band[0], band[1]) },
    uAwCellMap: { value: AW_FALLBACK_HEIGHT },
    uAwHasCells: { value: 0 },
    uAwGrid: { value: 0 },
    uAwPuddleAmt: { value: 0 },
    uAwPuddles: { value: PUDDLE_CENTERS.map(([x, z, r]) => new THREE.Vector4(x, -z, r, 0.9)) },
    uAwBlendAlbedo: { value: AW_FALLBACK_HEIGHT },
    uAwBlendNormal: { value: AW_FALLBACK_HEIGHT },
    uAwBlendRough: { value: AW_FALLBACK_HEIGHT },
    uAwBlendDisp: { value: AW_FALLBACK_HEIGHT },
    uAwHasBlend: { value: 0 },
    uAwBlendHalf: { value: 4.5 },
    uAwBlendBand: { value: 1.2 },
  };
}

const AW_VERT_PREFIX = /* glsl */`
varying vec3 vAwWorldPos;
varying vec3 vAwWorldNormal;
`;

const AW_VERT_NORMAL = /* glsl */`
#ifdef USE_INSTANCING
  vAwWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vAwWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;
const AW_VERT_POS = /* glsl */`
#ifdef USE_INSTANCING
  vAwWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vAwWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

const AW_FRAG_PREFIX = /* glsl */`
varying vec3 vAwWorldPos;
varying vec3 vAwWorldNormal;
uniform float uAwSteps, uAwFloor, uAwWet, uAwDesat, uAwHeightScale, uAwHasDisp, uAwHasCells, uAwGrid, uAwPuddleAmt;
uniform float uAwHasBlend, uAwBlendHalf, uAwBlendBand;
uniform vec2 uAwStreakBand;
uniform vec4 uAwWear[3];
uniform vec4 uAwPuddles[4];
float awPolish;
uniform vec3 uAwTint;
uniform sampler2D uAwHeightMap, uAwAlbedo, uAwCellMap;
uniform sampler2D uAwBlendAlbedo, uAwBlendNormal, uAwBlendRough, uAwBlendDisp;
vec2 awUv;
float awWet, awMoss, awBase, awMacro, awMacro2, awUp, awJGeo, awSlabHash, awPuddle, awStoneA, awEdge, awBlend;
vec2 awW;
mat3 awTBNg;
float awHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float awNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = awHash(i), b = awHash(i + vec2(1, 0)), c = awHash(i + vec2(0, 1)), d = awHash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float awFbm(vec2 p) { return 0.6 * awNoise(p) + 0.3 * awNoise(p * 2.13 + 7.7) + 0.1 * awNoise(p * 4.7 + 3.1); }
float awHeight(vec2 uv) {
  float h = uAwHasDisp > 0.5 ? texture2D(uAwHeightMap, uv).r : dot(texture2D(uAwAlbedo, uv).rgb, vec3(0.3333));
  if (uAwHasBlend > 0.5) h = mix(h, texture2D(uAwBlendDisp, uv).r, awBlend);
  return h;
}
vec2 awPom(vec2 uv, vec3 vTs) {
  if (uAwSteps < 1.0) return uv;
  // 掠射钳制（圣经 7）：视线与面夹角极小时衰减步长与偏移，退化为普通法线贴图，杜绝整面发黑/撕裂
  float graze = smoothstep(0.10, 0.35, abs(vTs.z));
  if (graze < 0.02) return uv;
  int steps = int(uAwSteps);
  float layerH = 1.0 / float(steps);
  vec2 delta = (vTs.xy / max(0.35, vTs.z)) * uAwHeightScale * graze / float(steps);
  float maxOff = uAwHeightScale * 2.0;
  delta = clamp(delta, vec2(-maxOff), vec2(maxOff));
  vec2 cur = uv; float curH = 1.0;
  float h = awHeight(cur);
  for (int i = 0; i < 24; i++) {
    if (i >= steps || curH <= h) break;
    cur -= delta; curH -= layerH; h = awHeight(cur);
  }
  vec2 prev = cur + delta;
  float after = h - curH;
  float before = awHeight(prev) - (curH + layerH);
  float w = clamp(after / (after - before + 1e-5), 0.0, 1.0);
  return mix(cur, prev, w);
}
`;

/** 在 map_fragment 处计算 POM uv、宏观噪声、苔藓/潮湿/积水遮罩，并调制基础色。 */
const AW_MAP_BLOCK = /* glsl */`
{
  vec3 awN = normalize(vAwWorldNormal);
  vec3 awV = normalize(cameraPosition - vAwWorldPos);
  awW = vAwWorldPos.xz;
  // 主路↔边缘混合遮罩（5.1 第 4 条）：世界 x + 低频噪声不规则边界，仅庭院地面（y≈0、|x|<11）
  awBlend = 0.0;
  if (uAwHasBlend > 0.5) {
    float awBN = (awFbm(awW * 0.8 + 5.0) - 0.5) * 1.7;
    awBlend = smoothstep(uAwBlendHalf - uAwBlendBand, uAwBlendHalf + uAwBlendBand, abs(vAwWorldPos.x) + awBN);
    awBlend *= (1.0 - smoothstep(0.05, 0.2, vAwWorldPos.y)) * (1.0 - smoothstep(10.5, 11.5, abs(vAwWorldPos.x)));
  }
  vec3 dp1 = dFdx(vAwWorldPos), dp2 = dFdy(vAwWorldPos);
  vec2 duv1 = dFdx(vMapUv), duv2 = dFdy(vMapUv);
  vec3 dp2p = cross(dp2, awN), dp1p = cross(awN, dp1);
  vec3 T = dp2p * duv1.x + dp1p * duv2.x;
  vec3 B = dp2p * duv1.y + dp1p * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
  mat3 awTBN = mat3(T * invmax, B * invmax, awN);
  awTBNg = awTBN;
  awUv = awPom(vMapUv, awV * awTBN);
  awMacro = awFbm(awW * 0.16 + 3.7);
  awMacro2 = awFbm(awW * 0.45 + 11.3);
  vec2 awWallUv = vec2(vAwWorldPos.x + vAwWorldPos.z, vAwWorldPos.y);
  awUp = clamp(awN.y, 0.0, 1.0);
  float awVert = 1.0 - awUp; awVert *= awVert;
  awBase = (1.0 - smoothstep(0.0, 0.85, vAwWorldPos.y)) * (0.55 + 0.45 * awFbm(awWallUv * 1.7)) * awVert;
  float awTopMoss = awUp * smoothstep(0.45, 0.75, awFbm(awW * 0.9 + 5.0)) * (1.0 - uAwFloor);
  float awStreak = smoothstep(0.52, 0.78, awFbm(vec2(awWallUv.x * 7.0, awWallUv.y * 0.22)))
                 * smoothstep(uAwStreakBand.x, uAwStreakBand.y, vAwWorldPos.y) * awVert;
  awPolish = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 z = uAwWear[i];
    awPolish = max(awPolish, smoothstep(z.z, z.z * 0.35, distance(vAwWorldPos.xz, z.xy)) * z.w);
  }
  awPolish *= awUp * (0.6 + 0.4 * awMacro2);
  // 动线磨亮（5.2）：庭院主路中线 + 门房门槛前后 1 m（只降 roughness，不改色相）
  float awPath = (1.0 - smoothstep(0.6, 1.7, abs(vAwWorldPos.x))) * (1.0 - smoothstep(0.05, 0.2, vAwWorldPos.y));
  float awThreshold = smoothstep(1.3, 0.3, distance(vAwWorldPos.xz, vec2(0.0, -0.5)));
  awPolish = max(awPolish, max(awPath * 0.5, awThreshold * 0.6) * uAwFloor * awUp);
  awMoss = clamp(awBase * 0.8 + awTopMoss * 0.9 + awStreak * 0.35, 0.0, 1.0);
  awPuddle = 0.0; awStoneA = 1.0; awEdge = 1.0;
  float awH = awHeight(awUv);
  if (uAwFloor > 0.5 && uAwHasCells > 0.5) {
    // 真实扫描石板：单元图给出每块石板的哈希/到缝距离/平均高度/遮罩
    vec4 awCell = texture2D(uAwCellMap, vMapUv);
    awStoneA = awCell.a;
    awEdge = awCell.g;
    awSlabHash = awCell.r;
    float awCrumble = (awFbm(vMapUv * 55.0 + 2.0) - 0.5) * 0.16;
    awJGeo = 1.0 - smoothstep(0.0, 0.16, awEdge + awCrumble);
    // 低洼石板 + 世界噪声 → 不规则积水（克制覆盖，避免成片像雪）；再叠加与溅水判定一致的洼地中心
    float awLowStone = smoothstep(0.80, 0.74, awCell.b);
    awPuddle = awStoneA * awLowStone * smoothstep(0.66, 0.78, awFbm(awW * 0.55 + 4.0));
    for (int i = 0; i < 4; i++) {
      vec4 p = uAwPuddles[i];
      awPuddle = max(awPuddle, smoothstep(p.z, p.z * 0.35, distance(awW, p.xy)) * p.w * awStoneA);
    }
    awPuddle *= 1.0 - smoothstep(0.05, 0.2, vAwWorldPos.y); // 只在庭院地面，不上抬高的礼拜堂/外廊
    awPuddle = clamp(awPuddle, 0.0, 1.0);
    awWet = clamp(uAwWet * 0.45 + awPuddle, 0.0, 1.0);
    // 过渡带内 monastery 单元特征渐隐，让位给边缘旧石板（避免两套缝叠加）
    awJGeo *= 1.0 - awBlend;
    awSlabHash = mix(awSlabHash, 0.5, awBlend);
    awPuddle *= 1.0 - awBlend * 0.7;
    awStoneA = mix(awStoneA, 1.0, awBlend);
  } else if (uAwFloor > 0.5) {
    // 离线兜底：错缝网格石板
    vec2 awCellUv = vMapUv * 4.0;
    awCellUv += vec2(awFbm(vMapUv * 2.6 + 4.4), awFbm(vMapUv * 2.6 + 9.8)) * 0.55 - 0.27;
    float awRow = floor(awCellUv.y);
    awCellUv.x += mod(awRow, 2.0) * 0.5;
    vec2 awCell = floor(awCellUv);
    vec2 awF = fract(awCellUv);
    float awEdgeF = min(min(awF.x, 1.0 - awF.x), min(awF.y, 1.0 - awF.y));
    awEdgeF += (awFbm(vMapUv * 40.0) - 0.5) * 0.10;
    awJGeo = (1.0 - smoothstep(0.02, 0.07, awEdgeF)) * uAwGrid;
    awSlabHash = awHash(awCell + 17.0);
    float awLow = 1.0 - smoothstep(0.3, 0.6, awH);
    awPuddle = smoothstep(0.5, 0.66, awFbm(awW * 0.3 + 9.1)) * (0.5 + 0.5 * awLow) * uAwPuddleAmt;
    awWet = clamp(uAwWet * 0.5 + awPuddle, 0.0, 1.0);
  } else {
    awJGeo = 0.0;
    awSlabHash = 0.5;
    awWet = awBase * 0.5;
  }
}
vec4 sampledDiffuseColor = texture2D(map, awUv);
// 主路↔边缘 albedo 混合（不规则噪声边界，消除直缝）
if (uAwHasBlend > 0.5 && awBlend > 0.001) {
  sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(uAwBlendAlbedo, vMapUv), awBlend);
}
// 墙石：把过亮的白色灰缝压暗到石色系（高亮度 + 低饱和 = 灰缝）
if (uAwFloor < 0.5) {
  float awLum0 = dot(sampledDiffuseColor.rgb, vec3(0.3333));
  float awMx = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
  float awMn = min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b));
  float awSat0 = (awMx - awMn) / max(awMx, 0.001);
  float awMortar = smoothstep(0.30, 0.50, awLum0) * (1.0 - smoothstep(0.10, 0.30, awSat0));
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.05, 0.055, 0.062) * (0.7 + 0.6 * awMacro), awMortar * 0.95);
}
diffuseColor *= sampledDiffuseColor;
diffuseColor.rgb *= 1.0 - 0.62 * awJGeo;
{
  float awLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(awLum), uAwDesat) * uAwTint;
  float awM = awMacro * 0.7 + awMacro2 * 0.3;
  diffuseColor.rgb *= 0.80 + 0.40 * awM;
  diffuseColor.rgb *= 0.74 + 0.52 * awFbm(awW * 1.3 + 2.2);
  // 每块石板的明暗与冷暖差异
  diffuseColor.rgb *= 0.78 + 0.44 * awSlabHash;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.0, 0.94), (awSlabHash - 0.5) * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.94, 0.98, 1.06), (0.5 - awSlabHash) * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.0, 0.92), smoothstep(0.55, 0.8, awM));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.98, 1.08), smoothstep(0.45, 0.2, awM));
  // 苔藓（墙脚/墙顶/缝）
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.10, 0.05) * (0.6 + 0.8 * awMacro2), awMoss * 0.5);
  // 缝里深色泥 + 枯草
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.043, 0.038, 0.030) * (0.7 + 0.6 * awMacro2), awJGeo * 0.85);
  float awGress = awJGeo * smoothstep(0.62, 0.82, awFbm(vMapUv * 90.0 + 7.0)) * uAwFloor;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.15, 0.085), awGress * 0.5);
  // 过渡带混入泥土点缀（"被人踩出来的路"而非施工缝），边缘渐脏
  float awBand = awBlend * (1.0 - awBlend) * 4.0;
  float awDirt = awBand * smoothstep(0.52, 0.74, awFbm(awW * 1.6 + 8.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.037) * (0.7 + 0.6 * awMacro2), awDirt * 0.7);
  diffuseColor.rgb *= 1.0 - 0.12 * awBlend * uAwFloor;
  // 石板边缘倒角积 dirt
  diffuseColor.rgb *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.5, awEdge)) * awStoneA * uAwFloor;
  diffuseColor.rgb *= 1.0 - 0.5 * awBase;
  diffuseColor.rgb *= 1.0 - 0.4 * awWet * uAwFloor * (1.0 - awPuddle);
  // 行走路径磨亮
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3333))) * 1.22, awPolish * 0.5);
  // 积水：深色冷水 + 微弱冷天光
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.026, 0.040), awPuddle * 0.82);
}
`;

const AW_ROUGH_BLOCK = /* glsl */`
roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
if (uAwHasBlend > 0.5 && awBlend > 0.001) {
  roughnessFactor = mix(roughnessFactor, texture2D(uAwBlendRough, vMapUv).r * 0.82, awBlend);
}
roughnessFactor *= 1.0 - 0.22 * awWet * uAwFloor * (1.0 - awPuddle);
roughnessFactor = mix(roughnessFactor, 0.34, awPolish);
roughnessFactor = mix(roughnessFactor, 0.92, awJGeo * 0.55);
roughnessFactor = mix(roughnessFactor, 0.85, awMoss * 0.4);
roughnessFactor = clamp(roughnessFactor + (awSlabHash - 0.5) * 0.12, 0.0, 1.0); // 每块石板 roughness ±0.06
roughnessFactor = mix(roughnessFactor, 0.05, awPuddle);
roughnessFactor = max(roughnessFactor, awJGeo * 0.55); // 石缝/灰浆不得镜面
`;

const AW_NORMAL_BLOCK = /* glsl */`
if (uAwHasBlend > 0.5 && awBlend > 0.001) {
  vec3 awBN = texture2D(uAwBlendNormal, vMapUv).xyz * 2.0 - 1.0;
  awBN.xy *= normalScale;
  vec3 awBlendN = normalize(mat3(viewMatrix) * normalize(awTBNg * awBN)); // 世界→视图空间再混
  normal = normalize(mix(normal, awBlendN, awBlend));
}
normal = normalize(mix(normal, nonPerturbedNormal, clamp(awPuddle * 0.9 + awMoss * 0.2 + awPolish * 0.3, 0.0, 1.0)));
`;

/** 给石材类材质挂上共享着色器扩展。uniforms 存 userData 供 enhance 写入 disp 高度图。 */
export function stoneShader(mat: THREE.MeshStandardMaterial, u: AwUniforms): void {
  mat.userData.aw = u;
  if (mat.map) u.uAwAlbedo.value = mat.map;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uAwWear: AW_WEAR });
    shader.vertexShader = AW_VERT_PREFIX + shader.vertexShader
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n' + AW_VERT_NORMAL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + AW_VERT_POS);
    shader.fragmentShader = AW_FRAG_PREFIX + shader.fragmentShader
      .replace('#include <map_fragment>', AW_MAP_BLOCK)
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replaceAll('vRoughnessMapUv', 'awUv') + AW_ROUGH_BLOCK)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('vNormalMapUv', 'awUv') + AW_NORMAL_BLOCK)
      .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replaceAll('vAoMapUv', 'awUv'));
  };
  mat.customProgramCacheKey = () => 'aw-stone';
}

export interface Materials {
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodFloor: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  ember: THREE.MeshBasicMaterial;
  flame: THREE.MeshBasicMaterial;
  paper: THREE.MeshStandardMaterial;
  far: THREE.MeshBasicMaterial;
}

/** 异步加载一套外部贴图并替换到材质上；失败时保留程序化兜底。 */
export function enhance(mat: THREE.MeshStandardMaterial, name: string, normalScale: number, pending: Promise<void>[]): void {
  const loader = new THREE.TextureLoader();
  const grab = (slot: string, srgb: boolean, apply: (t: THREE.Texture) => void): void => {
    pending.push(new Promise<void>((resolve) => {
      loader.load(`textures/${name}_${slot}.jpg`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        apply(t);
        mat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
  };
  grab('diff', true, (t) => {
    mat.map = t;
    const u = mat.userData.aw as AwUniforms | undefined;
    if (u) u.uAwAlbedo.value = t;
  });
  grab('nor', false, (t) => { mat.normalMap = t; mat.normalScale.set(normalScale, normalScale); });
  grab('rough', false, (t) => { mat.roughnessMap = t; });
  grab('ao', false, (t) => { mat.aoMap = t; mat.aoMapIntensity = 1.0; });
  grab('disp', false, (t) => {
    const u = mat.userData.aw as AwUniforms | undefined;
    if (u) { u.uAwHeightMap.value = t; u.uAwHasDisp.value = 1; }
  });
}

/** 所有外部贴图加载完成（含失败回退）后兑现。供截图工具等待，避免拍到未加载的兜底贴图。 */
export let texturesReady: Promise<void> = Promise.resolve();

/** 庭院石板：加载 monastery_stone_floor 扫描贴图，并从高度图分割石板单元（每块差异/倒角/积水）。 */
function loadFlagstone(mat: THREE.MeshStandardMaterial, normalScale: number, pending: Promise<void>[]): void {
  const loader = new THREE.TextureLoader();
  const u = mat.userData.aw as AwUniforms;
  const grab = (slot: string, srgb: boolean, apply: (t: THREE.Texture) => void): void => {
    pending.push(new Promise<void>((resolve) => {
      loader.load(`textures/monastery_stone_floor_${slot}.jpg`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        apply(t);
        mat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
  };
  grab('diff', true, (t) => { mat.map = t; u.uAwAlbedo.value = t; });
  grab('nor', false, (t) => { mat.normalMap = t; mat.normalScale.set(normalScale, normalScale); });
  grab('rough', false, (t) => { mat.roughnessMap = t; });
  grab('ao', false, (t) => { mat.aoMap = t; mat.aoMapIntensity = 1.0; });
  grab('disp', false, (t) => {
    u.uAwHeightMap.value = t; u.uAwHasDisp.value = 1;
    // 分割石板单元（一次性，~100ms）；失败则保留兜底网格
    try {
      const cells = bakeStoneCells(t.image as CanvasImageSource);
      u.uAwCellMap.value = cells;
      u.uAwHasCells.value = 1;
    } catch { /* 保留兜底 */ }
  });
  // 边缘旧石板 stone_pavers 作为混合目标：主路↔边缘世界 x 噪声过渡（5.1 第 4 条）
  const grabB = (slot: string, srgb: boolean, apply: (t: THREE.Texture) => void): void => {
    pending.push(new Promise<void>((resolve) => {
      loader.load(`textures/stone_pavers_${slot}.jpg`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        apply(t);
        resolve();
      }, undefined, () => resolve());
    }));
  };
  grabB('diff', true, (t) => { u.uAwBlendAlbedo.value = t; });
  grabB('nor', false, (t) => { u.uAwBlendNormal.value = t; });
  grabB('rough', false, (t) => { u.uAwBlendRough.value = t; });
  grabB('disp', false, (t) => { u.uAwBlendDisp.value = t; u.uAwHasBlend.value = 1; });
}

/** 把额外的异步资源（如 glTF 模型）并入 texturesReady 的等待链。 */
export function trackPending(p: Promise<void>): void {
  texturesReady = Promise.all([texturesReady, p]).then(() => undefined);
}

export function makeMaterials(): Materials {
  const pending: Promise<void>[] = [];
  const std = (s: Surface | null, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map: s?.map, normalMap: s?.normalMap, roughnessMap: s?.roughnessMap,
      roughness: 0.92, metalness: 0, ...o,
    });

  const stoneS = blocks([128, 134, 140], 4, 2, 11);
  const stoneDarkS = blocks([96, 101, 108], 4, 2, 12);
  const flagS = blocks([112, 116, 120], 2, 2, 13, 0.62);
  const woodS = planks([58, 44, 34], 4, 21);
  const woodFloorS = planks([74, 58, 44], 5, 22);
  const roofS = blocks([62, 60, 62], 8, 4, 61, 0.7);
  const gravelS = noiseSurf([86, 84, 78], 51, 0.5, 5, 235);
  const ironS = noiseSurf([52, 50, 50], 31, 0.35, 3, 120);
  const clothS = noiseSurf([138, 126, 108], 41, 0.25, 2, 240);

  const m: Materials = {
    stone: std(stoneS, { color: 0xffffff, roughness: 0.96, normalScale: new THREE.Vector2(1, 1) }),
    stoneDark: std(stoneDarkS, { color: 0xffffff, roughness: 0.97, normalScale: new THREE.Vector2(1, 1) }),
    flag: std(flagS, { color: 0xffffff, roughness: 0.82, normalScale: new THREE.Vector2(1.5, 1.5) }),
    wood: std(woodS, { color: 0x9a8262, roughness: 0.82, normalScale: new THREE.Vector2(0.7, 0.7) }),
    woodFloor: std(woodFloorS, { color: 0x6b5a48, roughness: 0.8, normalScale: new THREE.Vector2(0.6, 0.6) }),
    iron: std(ironS, { color: 0x2a2b2e, roughness: 0.62, metalness: 1.0, normalScale: new THREE.Vector2(0.8, 0.8) }),
    cloth: new THREE.MeshPhysicalMaterial({ map: clothS.map, normalMap: clothS.normalMap, roughnessMap: clothS.roughnessMap, color: 0x7a6a52, roughness: 0.95, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x8a7a60), normalScale: new THREE.Vector2(0.4, 0.4) }),
    banner: new THREE.MeshPhysicalMaterial({ map: bannerTexture(), color: 0xffffff, roughness: 0.95, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x6a4a44), side: THREE.DoubleSide, alphaTest: 0.4 }),
    gravel: std(gravelS, { color: 0xffffff, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) }),
    roof: std(roofS, { color: 0xffffff, roughness: 0.9, normalScale: new THREE.Vector2(0.9, 0.9) }),
    glass: std(null, { color: 0x9fb0bd, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.35, roughnessMap: grimeTexture() }),
    ember: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.92, depthWrite: false }),
    paper: std(null, { color: 0xc9b891, roughness: 1 }),
    far: new THREE.MeshBasicMaterial({ color: 0x59626c, fog: true }),
  };

  // 锻铁：金属度 1、粗糙 0.62；锈只出现在竖面/滴水处（世界噪声条带），锈处金属度下降。
  m.iron.onBeforeCompile = (shader) => {
    shader.vertexShader = AW_VERT_PREFIX + shader.vertexShader
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n' + AW_VERT_NORMAL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + AW_VERT_POS);
    shader.fragmentShader = AW_FRAG_PREFIX + shader.fragmentShader
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment + /* glsl */`
      {
        vec3 awN = normalize(vAwWorldNormal);
        float awRust = smoothstep(0.55, 0.8, awFbm(vec2(vAwWorldPos.x + vAwWorldPos.z, vAwWorldPos.y * 0.5) * 2.2))
                     * (0.25 + 0.75 * (1.0 - abs(awN.y)));
        awRust = clamp(awRust * 1.2 - 0.15, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.106, 0.045, 0.017), awRust * 0.8);
        awWet = awRust;
      }`)
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment + '\nroughnessFactor = mix(roughnessFactor, 0.88, awWet);')
      .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment + '\nmetalnessFactor = mix(metalnessFactor, 0.25, awWet);');
  };
  m.iron.customProgramCacheKey = () => 'aw-iron';

  // 共享石材着色器：墙（floor=0）与地（floor=1）。冷灰调、去饱和、宏观噪声、潮湿与 POM。
  stoneShader(m.stone, awUniforms(0, 0.3, 0.5, [0.88, 0.92, 1.0], 0.025, [2.2, 4.15]));
  stoneShader(m.stoneDark, awUniforms(0, 0.3, 0.55, [0.74, 0.78, 0.86], 0.025, [4.4, 6.85]));
  stoneShader(m.flag, awUniforms(1, 0.85, 0.6, [1.08, 1.12, 1.20], 0.045));
  stoneShader(m.roof, awUniforms(0, 0.25, 0.2, [0.3, 0.32, 0.34], 0.02));
  stoneShader(m.gravel, awUniforms(1, 0.4, 0.15, [0.82, 0.82, 0.82], 0.03));

  // 木地板故事层：板缝积脏、行走磨损露暖褐、宏观色差（旧橡，不再像新地板）。
  m.woodFloor.onBeforeCompile = (shader) => {
    shader.vertexShader = AW_VERT_PREFIX + shader.vertexShader
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n' + AW_VERT_NORMAL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + AW_VERT_POS);
    shader.fragmentShader = AW_FRAG_PREFIX + shader.fragmentShader
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment + /* glsl */`
      {
        float awLum = dot(diffuseColor.rgb, vec3(0.3333));
        float awGap = 1.0 - smoothstep(0.03, 0.11, awLum);
        diffuseColor.rgb *= 1.0 - 0.55 * awGap;
        float awWear = smoothstep(0.55, 0.82, awFbm(vAwWorldPos.xz * 0.7 + 3.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.16, 0.92) + vec3(0.025, 0.016, 0.008), awWear * 0.5);
        diffuseColor.rgb *= 0.82 + 0.34 * awFbm(vAwWorldPos.xz * 2.0 + 1.0);
      }`);
  };
  m.woodFloor.customProgramCacheKey = () => 'aw-woodfloor';

  // 外部 CC0 贴图增强（石、木、瓦、碎石），2K：颜色/法线/粗糙度/AO/高度。
  enhance(m.stone, 'castle_wall_varriation', 1.0, pending);
  enhance(m.stoneDark, 'castle_wall_varriation', 1.0, pending);
  loadFlagstone(m.flag, 1.5, pending);
  enhance(m.wood, 'medieval_wood', 0.8, pending);
  enhance(m.woodFloor, 'brown_planks_05', 0.7, pending);
  enhance(m.roof, 'roof_slates_02', 0.9, pending);
  enhance(m.gravel, 'gravel_floor', 1.3, pending);

  texturesReady = Promise.all(pending).then(() => undefined);
  return m;
}

/** 盒体几何，UV 按世界尺寸平铺（tile 米一格），拼接处纹理连续。 */
export function tiledBox(w: number, h: number, d: number, tile = 2): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * dims[f][0]) / tile, (uv.getY(idx) * dims[f][1]) / tile);
    }
  }
  return geo;
}

export function scaleUV(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return geo;
}