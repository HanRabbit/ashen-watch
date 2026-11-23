import * as THREE from 'three';
import { archBand, archHeader, archPath, Batch } from './geom';
import { tiledBox } from './materials';

/** The rough opening must penetrate *all* visible skins, including the rear room lining.
 * It is deliberately not a player-size opening in the simulation. All distances are metres. */
export const GATEHOUSE_LIGHTS = [
  { x: -2.0, z0: 0, z1: 0.5, bottom: 1.43, width: 0.86, spring: 0.87, peak: 1.39, hearth: true },
  { x: 0.6, z0: -8.5, z1: -7.94, bottom: 1.46, width: 0.86, spring: 0.97, peak: 1.49, hearth: false },
] as const;
type Opening = typeof GATEHOUSE_LIGHTS[number];
export type WallPiece = { x0: number; x1: number; y0: number; h: number; z0: number; z1: number };
const HEADER_MARGIN = 0.05;

export function windowWallPieces(w: WallPiece): WallPiece[] {
  return GATEHOUSE_LIGHTS.reduce<WallPiece[]>((parts, a) => parts.flatMap(p => {
    const l = Math.max(p.x0, a.x - a.width / 2), r = Math.min(p.x1, a.x + a.width / 2);
    const b = Math.max(p.y0, a.bottom), t = Math.min(p.h, a.bottom + a.peak + HEADER_MARGIN);
    if (l >= r || b >= t || p.z0 < a.z0 - 1e-5 || p.z1 > a.z1 + 1e-5) return [p];
    return [
      { ...p, x1: l }, { ...p, x0: r },
      { ...p, x0: l, x1: r, h: b }, { ...p, x0: l, x1: r, y0: t },
    ].filter(s => s.x1 > s.x0 && s.h > s.y0);
  }), [w]);
}

const QUARRIES_ACROSS = 4.8;
const QUARRY_ASPECT = 1.12;

function quarryNormals(): THREE.DataTexture {
  const n = 128, data = new Uint8Array(n * n * 4);
  const wave = (x: number, y: number) => Math.sin(28*x + 3*Math.sin(y*8))*0.18
    + Math.sin(18*y - 7*x)*0.12 + Math.sin(62*x + 22*y)*0.032;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i/n, v = j/n, k = (j*n+i)*4;
    const a = Math.floor((u+v*QUARRY_ASPECT)*QUARRIES_ACROSS), b = Math.floor((u-v*QUARRY_ASPECT)*QUARRIES_ACROSS);
    const shift = Math.sin(a*43+b*23)*0.12;
    data[k] = 128 + Math.round(180*(wave(u+shift+0.009,v) - wave(u+shift-0.009,v)));
    data[k+1] = 128 + Math.round(180*(wave(u+shift,v+0.009) - wave(u+shift,v-0.009)));
    data[k+2] = 250; data[k+3] = 255;
  }
  const map = new THREE.DataTexture(data, n, n);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** Thin reflective glass: the real room is visible through it, no second refraction pass. */
function waveGlass(hearth: boolean, normalMap: THREE.Texture): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: hearth ? 0x857966 : 0x748685, emissive: hearth ? 0x98552c : 0x596b79, emissiveIntensity: 0,
    normalMap, normalScale: new THREE.Vector2(0.60, 0.60), roughness: 0.25, metalness: 0, ior: 1.50,
    transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vQuarry;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvQuarry=uv;');
    shader.fragmentShader = 'varying vec2 vQuarry;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      vec2 p = vQuarry;
      vec2 cell = floor(vec2(p.x + p.y * ${QUARRY_ASPECT}, p.x - p.y * ${QUARRY_ASPECT}) * ${QUARRIES_ACROSS});
      float piece = fract(sin(dot(cell,vec2(17.123,41.731)))*4157.31);
      float dirt = (1.0-smoothstep(.01,.17,min(p.x,1.0-p.x))) * .30 + (1.0-smoothstep(.0,.21,p.y))*.31;
      diffuseColor.rgb *= mix(.74,1.09,piece)*(1.0-.53*dirt);
      diffuseColor.a = clamp(diffuseColor.a-.12*piece+.20*dirt,.25,.88);
      totalEmissiveRadiance *= ${hearth ? '(gl_FrontFacing ? .09 : 1.0) * (.15+.87*(1.0-smoothstep(.07,.86,p.y)))' : '(.20 + .50 * p.y)'} * mix(.73,1.0,piece);
    `);
  };
  mat.customProgramCacheKey = () => hearth ? 'hearth-quarries' : 'rear-quarries';
  return mat;
}

/** Individually bedded tapered blocks follow the arch. A small outer lip catches
 * skylight from one side and a raked sill sheds water towards the weather face. */
function dressOpening(b: Batch, stone: THREE.Material, a: Opening): void {
  const half = a.width / 2, depth = a.z1 - a.z0, mid = (a.z0 + a.z1) / 2;
  b.geo(stone, archHeader(a.width, a.spring, a.peak, a.peak + HEADER_MARGIN, depth), a.x, a.bottom, mid);
  const point = (side: number, t: number, band: number): [number, number] => {
    const rise = a.peak - a.spring + band;
    return [side * (half + band) * (1-t*t), a.spring + rise * (1.44*(1-t)*t + t*t)];
  };
  for (const side of [-1, 1]) {
    for (const [j, y] of [0, 0.34, 0.67].entries()) {
      const top = j === 2 ? a.spring : y + 0.34;
      const cx = a.x + side * (half + 0.041);
      b.box(stone, cx-0.064, a.z0-0.025, cx+0.064, a.z1+0.03, a.bottom+y+0.004, a.bottom+top-0.004, 1.53);
    }
    for (let i = 0; i < 4; i++) {
      // Leave a mortar joint; the recessed solid head closes the joint behind it.
      const t0 = i/4 + 0.006, t1 = (i+1)/4 - 0.006;
      const band = 0.107 + 0.012 * Math.sin(i*5 + side);
      const shape = new THREE.Shape();
      shape.moveTo(...point(side, t0, -0.016));
      for (const t of [(t0+t1)/2, t1]) shape.lineTo(...point(side, t, -0.016));
      for (const t of [t1, (t0+t1)/2, t0]) shape.lineTo(...point(side, t, band));
      shape.closePath();
      const d = depth + 0.043 + 0.012 * Math.sin(i*7 + side);
      const voussoir = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.002, bevelThickness: 0.002 });
      // Sample a single face of the trim scan, rather than letting mortar stripe each small block.
      const uv = voussoir.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, .24 + uv.getX(k)*.13 + i*.022, .39 + uv.getY(k)*.10);
      voussoir.translate(0, 0, -d/2);
      b.geo(stone, voussoir, a.x, a.bottom, mid);
    }
  }
  const sill = tiledBox(a.width + 0.22, 0.10, depth + 0.17, 1.6);
  const pos = sill.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const outside = Math.max(0, (a.hearth ? -1 : 1) * pos.getZ(i));
    if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) - 0.083 * outside);
  }
  sill.computeVertexNormals();
  b.geo(stone, sill, a.x, a.bottom-0.032, mid);
}

/** Separate opaque cames are clipped against the same arch as the glass. Saddle
 * bars run behind them, so they separate from the diamond lattice at an angle. */
function leadwork(b: Batch, metal: THREE.Material, a: Opening, outline: THREE.Vector2[], w: number, h: number, z: number): void {
  for (const slope of [w*QUARRY_ASPECT/h, -w*QUARRY_ASPECT/h]) {
    for (let n = -11; n <= 11; n++) {
      const k = n*w/QUARRIES_ACROSS - w/2, ys: number[] = [];
      for (let i = 1; i < outline.length; i++) {
        const p = outline[i-1], q = outline[i], dp = p.x-slope*p.y-k, dq = q.x-slope*q.y-k;
        if (dp*dq > 0 || Math.abs(dp-dq) < 1e-8) continue;
        ys.push(p.y + (q.y-p.y)*dp/(dp-dq));
      }
      if (ys.length < 2) continue;
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (y1-y0 < 0.01) continue;
      const length = (y1-y0)*Math.hypot(1,slope), centre = (y0+y1)/2;
      b.geo(metal, new THREE.BoxGeometry(0.009, length, 0.010), a.x+k+slope*centre, a.bottom+centre, z+0.009, 0, 0, -Math.atan(slope));
    }
  }
  for (const y of [0.28, a.spring-0.085]) b.box(metal, a.x-w/2, z-0.032, a.x+w/2, z-0.012, a.bottom+y-0.011, a.bottom+y+0.011, 1);
}

export function buildGatehouseLights(b: Batch, group: THREE.Group, stone: THREE.Material, metal: THREE.Material) {
  const normals = quarryNormals();
  const hearthWindowMat = waveGlass(true, normals), windowMat = waveGlass(false, normals);
  for (const a of GATEHOUSE_LIGHTS) {
    dressOpening(b, stone, a);
    const frame = 0.075, depth = a.z1 - a.z0, z = a.z0 + depth*0.57;
    const w = a.width - 2*frame, spring = a.spring - 0.035, peak = a.peak - 0.115;
    b.geo(stone, archBand(w, spring, peak, 0.115, 0.082), a.x, a.bottom, z);
    for (const side of [-1, 1]) {
      const cx = a.x + side*(a.width-frame)/2;
      b.box(stone, cx-frame/2, a.z0+depth*.25, cx+frame/2, a.z0+depth*.72, a.bottom+.014, a.bottom+spring+.02, 1.6);
    }
    const shape = archPath(new THREE.Shape(), w, spring, peak);
    const geo = new THREE.ShapeGeometry(shape, 16), pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i)/w+0.5, pos.getY(i)/peak);
    const pane = new THREE.Mesh(geo, a.hearth ? hearthWindowMat : windowMat);
    pane.name = a.hearth ? 'Hearth window quarries' : 'Gatehouse rear quarries';
    pane.position.set(a.x, a.bottom, -z);
    pane.receiveShadow = true;
    pane.renderOrder = 1;
    group.add(pane);
    leadwork(b, metal, a, shape.getPoints(18), w, peak, z);
  }
  return { windowMat, hearthWindowMat };
}
