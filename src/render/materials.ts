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

/** 爬藤：褐红叶片簇 + 藤茎，竖向平铺贴在墙面（呼应概念图的红叶藤）。 */
export function ivyTexture(): THREE.CanvasTexture {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(131);
  g.clearRect(0, 0, W, H);
  // 主藤
  g.strokeStyle = 'rgba(48,38,30,0.9)'; g.lineWidth = 2;
  for (let s = 0; s < 3; s++) {
    g.beginPath();
    let x = 20 + r() * 88;
    g.moveTo(x, H);
    for (let y = H; y > 0; y -= 16) { x += (r() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  // 叶簇
  for (let i = 0; i < 240; i++) {
    const x = r() * W, y = r() * H;
    const s = 3 + r() * 5;
    const tone = r();
    g.fillStyle = tone < 0.6 ? `rgba(${120 + r() * 40},${40 + r() * 25},${28 + r() * 15},0.92)` : `rgba(${70 + r() * 30},${70 + r() * 30},${40 + r() * 20},0.9)`;
    g.beginPath();
    g.moveTo(x, y - s); g.lineTo(x + s * 0.8, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.8, y); g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 草丛：几片草叶的 alpha 贴图，用于石板缝里的十字面片。 */
export function grassTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  const r = rng(151);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = 8 + r() * 48;
    const h = 20 + r() * 34;
    const lean = (r() - 0.5) * 14;
    const grd = g.createLinearGradient(0, S, 0, S - h);
    grd.addColorStop(0, 'rgba(58,64,38,0.95)');
    grd.addColorStop(1, 'rgba(120,118,60,0.85)');
    g.strokeStyle = grd; g.lineWidth = 1.5 + r() * 1.5;
    g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + lean * 0.5, S - h * 0.6, x + lean, S - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 秋叶：单片枫叶轮廓，橙褐渐变，用于地面散落贴花。 */
export function leafTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  const r = rng(191);
  g.clearRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const grd = g.createRadialGradient(0, 0, 2, 0, 0, 28);
  grd.addColorStop(0, `rgba(${150 + r() * 50},${70 + r() * 30},20,0.95)`);
  grd.addColorStop(1, `rgba(${90 + r() * 40},${40 + r() * 20},15,0.9)`);
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a2 = a + Math.PI / 5;
    g.lineTo(Math.cos(a) * 26, Math.sin(a) * 26);
    g.lineTo(Math.cos(a2) * 10, Math.sin(a2) * 10);
  }
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(60,30,10,0.6)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, 26); g.lineTo(0, -22); g.stroke();
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
  grab('diff', true, (t) => { mat.map = t; });
  grab('nor', false, (t) => { mat.normalMap = t; mat.normalScale.set(normalScale, normalScale); });
  grab('rough', false, (t) => { mat.roughnessMap = t; });
}

/** 所有外部贴图加载完成（含失败回退）后兑现。供截图工具等待，避免拍到未加载的兜底贴图。 */
export let texturesReady: Promise<void> = Promise.resolve();

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
    stone: std(stoneS, { color: 0xd6dae0, roughness: 0.96, normalScale: new THREE.Vector2(0.9, 0.9) }),
    stoneDark: std(stoneDarkS, { color: 0xb2b8c0, roughness: 0.97, normalScale: new THREE.Vector2(0.9, 0.9) }),
    flag: std(flagS, { color: 0xcdd1d6, roughness: 0.9, normalScale: new THREE.Vector2(1, 1) }),
    wood: std(woodS, { color: 0xc6b49a, roughness: 0.85, normalScale: new THREE.Vector2(0.7, 0.7) }),
    woodFloor: std(woodFloorS, { color: 0xd6be9e, roughness: 0.72, normalScale: new THREE.Vector2(0.6, 0.6) }),
    iron: std(ironS, { color: 0x6e6e76, roughness: 0.46, metalness: 0.88, normalScale: new THREE.Vector2(0.8, 0.8) }),
    cloth: std(clothS, { color: 0xc2b6a0, roughness: 1, normalScale: new THREE.Vector2(0.4, 0.4) }),
    banner: std(null, { map: bannerTexture(), color: 0xffffff, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.4 }),
    gravel: std(gravelS, { color: 0xbdb9b1, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) }),
    roof: std(roofS, { color: 0xb6bac0, roughness: 0.9, normalScale: new THREE.Vector2(0.8, 0.8) }),
    glass: std(null, { color: 0x8fa3b5, roughness: 0.22, metalness: 0.1, transparent: true, opacity: 0.42 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.92, depthWrite: false }),
    paper: std(null, { color: 0xc9b891, roughness: 1 }),
    far: new THREE.MeshBasicMaterial({ color: 0x59626c, fog: true }),
  };

  // 外部 CC0 贴图增强（石、地、木、瓦、碎石）。法线强度按表面起伏微调。
  enhance(m.stone, 'medieval_blocks_03', 1.0, pending);
  enhance(m.stoneDark, 'medieval_blocks_03', 1.0, pending);
  enhance(m.flag, 'cobblestone_floor_08', 1.1, pending);
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