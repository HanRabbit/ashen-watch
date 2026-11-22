// 程序化材质（MAT-01 占位）：青灰石、地砖、发黑木、锻铁、破布、碎石。贴图在画布上生成，不依赖外部文件。
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

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(g: CanvasRenderingContext2D, r: () => number, n: number, size: number, dark: number, light: number): void {
  for (let i = 0; i < n; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${dark * r()})` : `rgba(255,255,255,${light * r()})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

/** 砌块：rows×cols 交错砌缝，每块明度略有差异。 */
function blocks(base: [number, number, number], rows: number, cols: number, seed: number, mortar = 0.5): THREE.CanvasTexture {
  return canvasTex(256, (g, r) => {
    const S = 256, bh = S / rows, bw = S / cols;
    g.fillStyle = `rgb(${base.map((v) => Math.round(v * mortar)).join(',')})`;
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * bw * 0.5;
      for (let x = -1; x < cols; x++) {
        const k = 0.82 + r() * 0.3;
        g.fillStyle = `rgb(${base.map((v) => Math.round(Math.min(255, v * k))).join(',')})`;
        g.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
      }
    }
    speckle(g, r, 2600, S, 0.2, 0.07);
  }, seed);
}

function planks(base: [number, number, number], n: number, seed: number): THREE.CanvasTexture {
  return canvasTex(256, (g, r) => {
    const S = 256, pw = S / n;
    for (let i = 0; i < n; i++) {
      const k = 0.8 + r() * 0.35;
      g.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
      g.fillRect(i * pw, 0, pw, S);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(i * pw, 0, 2, S);
      for (let j = 0; j < 14; j++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
        g.fillRect(i * pw + r() * pw, 0, 1, S);
      }
    }
    speckle(g, r, 900, S, 0.2, 0.05);
  }, seed);
}

function noise(base: [number, number, number], seed: number, amount: number, grain = 3): THREE.CanvasTexture {
  return canvasTex(128, (g, r) => {
    g.fillStyle = `rgb(${base.join(',')})`;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1800; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amount * r()})` : `rgba(255,255,255,${amount * 0.5 * r()})`;
      const s = 1 + r() * grain;
      g.fillRect(r() * 128, r() * 128, s, s);
    }
  }, seed);
}

/** 径向渐变：光斑、雾团与火焰共用。 */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
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

export interface Materials {
  stone: THREE.MeshLambertMaterial;
  stoneDark: THREE.MeshLambertMaterial;
  flag: THREE.MeshLambertMaterial;
  wood: THREE.MeshLambertMaterial;
  woodFloor: THREE.MeshLambertMaterial;
  iron: THREE.MeshStandardMaterial;
  cloth: THREE.MeshLambertMaterial;
  banner: THREE.MeshLambertMaterial;
  gravel: THREE.MeshLambertMaterial;
  roof: THREE.MeshLambertMaterial;
  glass: THREE.MeshStandardMaterial;
  ember: THREE.MeshBasicMaterial;
  flame: THREE.MeshBasicMaterial;
  paper: THREE.MeshLambertMaterial;
  far: THREE.MeshBasicMaterial;
}

export function makeMaterials(): Materials {
  const std = (map: THREE.Texture | null, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ map: map ?? undefined, roughness: 0.92, metalness: 0, ...o });
  const lam = (map: THREE.Texture | null, o: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ map: map ?? undefined, ...o });
  return {
    stone: lam(blocks([128, 134, 140], 4, 2, 11)),
    stoneDark: lam(blocks([96, 101, 108], 4, 2, 12)),
    flag: lam(blocks([112, 116, 120], 2, 2, 13, 0.62)),
    wood: lam(planks([58, 44, 34], 4, 21)),
    woodFloor: lam(planks([74, 58, 44], 5, 22)),
    iron: std(noise([52, 50, 50], 31, 0.35), { roughness: 0.55, metalness: 0.75 }),
    cloth: lam(noise([138, 126, 108], 41, 0.25, 2)),
    banner: lam(noise([92, 38, 36], 42, 0.3, 2), { side: THREE.DoubleSide }),
    gravel: lam(noise([86, 84, 78], 51, 0.5, 5)),
    roof: lam(blocks([62, 60, 62], 8, 4, 61, 0.7)),
    glass: std(null, { color: 0x8fa3b5, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.45 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.92, depthWrite: false }),
    paper: lam(null, { color: 0xc9b891 }),
    far: new THREE.MeshBasicMaterial({ color: 0x59626c, fog: true }),
  };
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
