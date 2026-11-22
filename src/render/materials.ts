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
function blocks(base: [number, number, number], rows: number, cols: number, seed: number, mortar = 0.5): Surface {
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

// —— 共享石材着色器（石墙 / 石地 / 瓦 / 碎石共用，onBeforeCompile 注入）——
// 世界坐标宏观噪声打破平铺重复；墙脚潮湿发黑偏绿苔、墙顶向上面生苔与竖向雨渍；
// 地面用高度图 + 世界噪声算低洼积水（变暗、粗糙度 ~0.05、法线压平），整体偏湿；
// 视差遮挡贴图（POM，8–24 步）用 disp 高度图，低画质经 setMaterialsQuality 关闭。

/** 全局 POM 步数开关：high=16 步，low=0（关闭）。view.ts 以后可调用 setMaterialsQuality。 */
const AW_STEPS = { value: 16 };
export function setMaterialsQuality(q: 'high' | 'low'): void {
  AW_STEPS.value = q === 'low' ? 0 : 16;
}

interface AwUniforms {
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
}

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

function awUniforms(floor: number, wet: number, desat: number, tint: [number, number, number], hs: number, band: [number, number] = [0, 0]): AwUniforms {
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
uniform float uAwSteps, uAwFloor, uAwWet, uAwDesat, uAwHeightScale, uAwHasDisp;
uniform vec2 uAwStreakBand;
uniform vec4 uAwWear[3];
float awPolish;
uniform vec3 uAwTint;
uniform sampler2D uAwHeightMap, uAwAlbedo;
vec2 awUv;
float awWet, awMoss, awBase, awMacro, awMacro2, awUp, awJGeo, awSlabHash;
vec2 awW;
float awHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float awNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = awHash(i), b = awHash(i + vec2(1, 0)), c = awHash(i + vec2(0, 1)), d = awHash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float awFbm(vec2 p) { return 0.6 * awNoise(p) + 0.3 * awNoise(p * 2.13 + 7.7) + 0.1 * awNoise(p * 4.7 + 3.1); }
float awHeight(vec2 uv) {
  return uAwHasDisp > 0.5 ? texture2D(uAwHeightMap, uv).r : dot(texture2D(uAwAlbedo, uv).rgb, vec3(0.3333));
}
vec2 awPom(vec2 uv, vec3 vTs) {
  if (uAwSteps < 1.0) return uv;
  int steps = int(uAwSteps);
  float layerH = 1.0 / float(steps);
  vec2 delta = (vTs.xy / max(0.35, vTs.z)) * uAwHeightScale / float(steps);
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
  vec3 dp1 = dFdx(vAwWorldPos), dp2 = dFdy(vAwWorldPos);
  vec2 duv1 = dFdx(vMapUv), duv2 = dFdy(vMapUv);
  vec3 dp2p = cross(dp2, awN), dp1p = cross(awN, dp1);
  vec3 T = dp2p * duv1.x + dp1p * duv2.x;
  vec3 B = dp2p * duv1.y + dp1p * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
  mat3 awTBN = mat3(T * invmax, B * invmax, awN);
  awUv = awPom(vMapUv, awV * awTBN);
  // 石板单元（stone_pavers 每格 4x4 错缝）：单元 ID 用于每块石板的明暗/色相差异，
  // 单元边界 + 噪声扰动 = 不规则崩边灰缝（几何遮罩，远处也清晰）
  vec2 awCellUv = vMapUv * 4.0;
  awCellUv += vec2(awFbm(vMapUv * 2.6 + 4.4), awFbm(vMapUv * 2.6 + 9.8)) * 0.55 - 0.27;
  float awRow = floor(awCellUv.y);
  awCellUv.x += mod(awRow, 2.0) * 0.5;
  vec2 awCell = floor(awCellUv);
  vec2 awF = fract(awCellUv);
  float awEdge = min(min(awF.x, 1.0 - awF.x), min(awF.y, 1.0 - awF.y));
  awEdge += (awFbm(vMapUv * 40.0) - 0.5) * 0.10;
  awJGeo = (1.0 - smoothstep(0.02, 0.07, awEdge)) * uAwFloor;
  awSlabHash = awHash(awCell + 17.0);
  float awH = awHeight(awUv);
  awW = vAwWorldPos.xz;
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
  awMoss = clamp(awBase * 0.8 + awTopMoss * 0.9 + awStreak * 0.35, 0.0, 1.0);
  float awLow = 1.0 - smoothstep(0.3, 0.6, awH);
  float awPool = smoothstep(0.42, 0.62, awFbm(awW * 0.22 + 9.1)) * (0.55 + 0.45 * awLow);
  awWet = uAwFloor > 0.5 ? clamp(uAwWet * 0.65 + awPool * 1.1, 0.0, 1.0) : awBase * 0.5;
}
vec4 sampledDiffuseColor = texture2D(map, awUv);
float awJ0 = 1.0 - smoothstep(0.03, 0.09, dot(sampledDiffuseColor.rgb, vec3(0.3333)));
float awJx = 1.0 - smoothstep(0.03, 0.09, dot(texture2D(map, awUv + vec2(0.006, 0.0)).rgb, vec3(0.3333)));
float awJy = 1.0 - smoothstep(0.03, 0.09, dot(texture2D(map, awUv + vec2(0.0, 0.006)).rgb, vec3(0.3333)));
float awJoint = max(max(awJ0, max(awJx, awJy)) * uAwFloor, awJGeo);
awMoss = clamp(awMoss + awUp * awJoint * smoothstep(0.42, 0.68, awFbm(awW * 0.5 + 6.2)) * (0.5 + 0.5 * awMacro2), 0.0, 1.0);
diffuseColor *= sampledDiffuseColor;
diffuseColor.rgb *= 1.0 - 0.6 * awJoint;
{
  float awLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(awLum), uAwDesat) * uAwTint;
  float awM = awMacro * 0.7 + awMacro2 * 0.3;
  diffuseColor.rgb *= 0.82 + 0.36 * awM;
  diffuseColor.rgb *= 0.7 + 0.6 * awFbm(awW * 1.3 + 2.2);
  diffuseColor.rgb *= 0.78 + 0.44 * awSlabHash;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.0, 0.94), (awSlabHash - 0.5) * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.94, 0.98, 1.06), (0.5 - awSlabHash) * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.0, 0.92), smoothstep(0.55, 0.8, awM));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.98, 1.08), smoothstep(0.45, 0.2, awM));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.10, 0.05) * (0.6 + 0.8 * awMacro2), awMoss * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.038, 0.028), awJoint * 0.7);
  diffuseColor.rgb *= 1.0 - 0.5 * awBase;
  diffuseColor.rgb *= 1.0 - 0.62 * awWet * uAwFloor;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3333))) * 1.22, awPolish * 0.5);
}
`;

const AW_ROUGH_BLOCK = /* glsl */`
roughnessFactor = clamp(roughnessFactor * (1.0 - 0.35 * uAwWet * uAwFloor), 0.04, 1.0);
roughnessFactor = mix(roughnessFactor, 0.18, clamp(awWet * uAwFloor * 1.6, 0.0, 1.0) * 0.75);
roughnessFactor = mix(roughnessFactor, 0.04, smoothstep(0.6, 0.9, awWet) * uAwFloor);
roughnessFactor = mix(roughnessFactor, 0.3, awPolish);
roughnessFactor = mix(roughnessFactor, 0.85, awMoss * 0.5);
roughnessFactor = mix(roughnessFactor, 0.55, awJoint * 0.4);
`;

const AW_NORMAL_BLOCK = /* glsl */`
normal = normalize(mix(normal, nonPerturbedNormal, clamp(awWet * uAwFloor * 0.9 + awMoss * 0.25 + awPolish * 0.4, 0.0, 1.0)));
`;

/** 给石材类材质挂上共享着色器扩展。uniforms 存 userData 供 enhance 写入 disp 高度图。 */
function stoneShader(mat: THREE.MeshStandardMaterial, u: AwUniforms): void {
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
function enhance(mat: THREE.MeshStandardMaterial, name: string, normalScale: number, pending: Promise<void>[]): void {
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
    flag: std(flagS, { color: 0xffffff, roughness: 0.9, normalScale: new THREE.Vector2(1.4, 1.4) }),
    wood: std(woodS, { color: 0xc6b49a, roughness: 0.85, normalScale: new THREE.Vector2(0.7, 0.7) }),
    woodFloor: std(woodFloorS, { color: 0xd6be9e, roughness: 0.72, normalScale: new THREE.Vector2(0.6, 0.6) }),
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
  stoneShader(m.stone, awUniforms(0, 0.3, 0.3, [0.86, 0.9, 0.98], 0.025, [2.2, 4.15]));
  stoneShader(m.stoneDark, awUniforms(0, 0.3, 0.35, [0.66, 0.7, 0.78], 0.025, [4.4, 6.85]));
  stoneShader(m.flag, awUniforms(1, 1.0, 0.5, [0.26, 0.29, 0.34], 0.02));
  stoneShader(m.roof, awUniforms(0, 0.25, 0.2, [0.3, 0.32, 0.34], 0.02));
  stoneShader(m.gravel, awUniforms(1, 0.4, 0.15, [0.82, 0.82, 0.82], 0.03));

  // 外部 CC0 贴图增强（石、地、木、瓦、碎石），2K：颜色/法线/粗糙度/AO/高度。
  enhance(m.stone, 'castle_wall_varriation', 1.0, pending);
  enhance(m.stoneDark, 'castle_wall_varriation', 1.0, pending);
  enhance(m.flag, 'stone_pavers', 1.1, pending);
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