import * as THREE from 'three';
import { archHeader, archPath, Batch } from './geom';

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

const CURVE_SEGMENTS = 8; // same subdivision as archHeader

type Section = { z: number; width: number; spring: number; peak: number; sill: number; offset: number };
function revealSections(a: Opening): Section[] {
  const mouth = { width: a.width, spring: a.spring, peak: a.peak, offset: 0 };
  const z = THREE.MathUtils.lerp(a.z0, a.z1, a.hearth ? 0.34 : 0.66);
  const seat = { width: a.hearth ? 0.65 : 0.69, spring: a.spring - 0.065, peak: a.peak - 0.13,
    sill: a.hearth ? 0.067 : 0.048, offset: a.hearth ? 0.022 : -0.016 };
  return [
    { ...mouth, z: a.z0, sill: a.hearth ? 0.022 : 0.009 },
    { ...seat, z: z - 0.027 }, { ...seat, z: z + 0.027 },
    { ...mouth, z: a.z1, sill: a.hearth ? 0.008 : 0.026 },
  ];
}

function sectionPath(s: Section): THREE.Shape {
  return archPath(new THREE.Shape(), s.width, s.spring - s.sill, s.peak - s.sill);
}

/** The rough arch is cut through the wall, but the stone returns splay from
 * both faces to a short glazing seat. The same loft forms the raked sill and
 * the curved soffit; no projecting frame is needed to advertise the depth. */
function dressOpening(b: Batch, stone: THREE.Material, a: Opening, sections: Section[]): void {
  const mid = (a.z0 + a.z1) / 2;
  b.geo(stone, archHeader(a.width, a.spring, a.peak, a.peak + HEADER_MARGIN, a.z1 - a.z0), a.x, a.bottom, mid);
  const contour = (s: Section) => sectionPath(s).getPoints(CURVE_SEGMENTS)
    .map(p => new THREE.Vector3(p.x + s.offset, p.y + s.sill, mid - s.z));
  const positions: number[] = [], uv: number[] = [];
  const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, t: THREE.Vector3,
    u0: number, u1: number, v0: number, v1: number) => {
    for (const v of [p, q, r, p, r, t]) positions.push(v.x, v.y, v.z);
    uv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
  };
  const rings = sections.map(contour);
  // Roll the raked sill into its short face apron. Keep both jamb arrises
  // fixed and put every new station before the glazing seat: the cut in the
  // wall, glazing throat and structural joins are not bevelled as boxes.
  const lip = (s: Section) => Math.min(0.014, s.sill * 0.72);
  const sillRow = (near: THREE.Vector3[], far: THREE.Vector3[], t: number, drop: number) => {
    const r = near.at(-2)!.clone().lerp(far.at(-2)!, t), l = near.at(-1)!.clone().lerp(far.at(-1)!, t);
    return [0, 0.06, 0.94, 1].map((u, i) => {
      const p = r.clone().lerp(l, u);
      if (i === 1 || i === 2) p.y -= drop;
      return p;
    });
  };
  const sillU = [0, 0.06, 0.94, 1];
  let distance = 0;
  for (let i = 1; i < rings[0].length; i++) {
    const run = rings[0][i-1].distanceTo(rings[0][i]);
    for (let j = 1; j < rings.length; j++) {
      const near = rings[j-1], far = rings[j];
      if (i === rings[0].length - 1 && (j === 1 || j === rings.length - 1)) {
        const front = j === 1, mouth = front ? sections[j-1] : sections[j];
        const radius = lip(mouth), depth = Math.abs(sections[j].z - sections[j-1].z), k = 1 - Math.SQRT1_2;
        const profile = [[0, radius], [k * radius / depth, k * radius], [radius / depth, 0], [1, 0]];
        const rows = profile.map(([t, drop]) => sillRow(front ? near : far, front ? far : near, t, drop));
        if (!front) rows.reverse();
        for (let k = 1; k < rows.length; k++) for (let col = 1; col < sillU.length; col++) {
          const lo = rows[k-1], hi = rows[k];
          quad(lo[col-1], hi[col-1], hi[col], lo[col], (distance + run * sillU[col-1]) / 2.2,
            (distance + run * sillU[col]) / 2.2, (mid - lo[0].z - a.z0) / 2.2, (mid - hi[0].z - a.z0) / 2.2);
        }
        continue;
      }
      quad(near[i-1], far[i-1], far[i], near[i], distance / 2.2, (distance + run) / 2.2,
        (sections[j-1].z - a.z0) / 2.2, (sections[j].z - a.z0) / 2.2);
    }
    distance += run;
  }
  for (const j of [0, sections.length - 1]) {
    const s = sections[j], rim = sillRow(rings[j], rings[j], 0, lip(s));
    if (j === 0) rim.reverse();
    for (let k = 1; k < rim.length; k++) {
      const p = rim[k-1], q = rim[k];
      quad(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(q.x, 0, q.z), q, p,
        0, s.sill / 2.2, s.width * sillU[k-1] / 2.2, s.width * sillU[k] / 2.2);
    }
  }
  const liner = new THREE.BufferGeometry();
  liner.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  liner.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  liner.computeVertexNormals();
  b.geo(stone, liner, a.x, a.bottom, mid);
}

type Quarries = { count: number; aspect: number; phase: [number, number] };
const HEARTH_QUARRIES: Quarries = { count: 4.35, aspect: 1.13, phase: [0.19, -0.09] };
const REAR_QUARRIES: Quarries = { count: 5.15, aspect: 1.01, phase: [-0.13, 0.21] };

function quarryNormals(): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / n, v = j / n, k = (j*n+i)*4;
    data[k] = 128 + Math.round(7*Math.sin(27*u + 2*Math.sin(13*v)) + 3*Math.sin(49*v + 23*u));
    data[k+1] = 128 + Math.round(6*Math.sin(24*v - 9*u) + 2*Math.sin(51*u - 17*v));
    data[k+2] = 254; data[k+3] = 255;
  }
  const map = new THREE.DataTexture(data, n, n);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** Glaze over the actual room, not an opaque luminous insert. Patina follows
 * the sill and one jamb and varies between quarries; keep a restrained sheen. */
function waveGlass(hearth: boolean, normalMap: THREE.Texture, q: Quarries): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: hearth ? 0x817d72 : 0x76827e, emissive: hearth ? 0x874725 : 0x4d5961, emissiveIntensity: 0,
    normalMap, normalScale: new THREE.Vector2(0.42, 0.42), roughness: hearth ? 0.52 : 0.62,
    metalness: 0, ior: 1.5, specularIntensity: 0.46, envMapIntensity: 0.62,
    transparent: true, opacity: hearth ? 0.34 : 0.40, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vQuarry;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvQuarry=uv;');
    shader.fragmentShader = 'varying vec2 vQuarry;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      vec2 p = vQuarry;
      vec2 cell = floor(vec2(p.x - p.y * ${q.aspect}, p.x + p.y * ${q.aspect}) * ${q.count}
        - vec2(${q.phase[0]}, ${q.phase[1]}));
      float piece = fract(sin(dot(cell,vec2(17.123,41.731)))*4157.31);
      float streak = 0.57 + 0.43*sin(32.0*p.x + 2.7*sin(9.0*p.y));
      float sill = 1.0-smoothstep(0.0, 0.28 + 0.13*streak, p.y);
      float jamb = 1.0-smoothstep(0.02, 0.20, ${hearth ? '1.0-p.x' : 'p.x'});
      float film = 0.52*sill + jamb*(0.18 + 0.17*streak);
      diffuseColor.rgb *= mix(0.80,1.11,piece)*(1.0-0.42*film);
      diffuseColor.a += 0.26*film + 0.14*(piece-0.5);
      totalEmissiveRadiance *= ${hearth ? '(gl_FrontFacing ? 0.06 : 0.47) * (0.16+0.74*(1.0-smoothstep(0.06,0.76,p.y)))' : '(0.11 + 0.30*p.y)'} * mix(0.70,1.0,piece);
    `).replace('#include <opaque_fragment>', `
      float grazing = pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),3.0);
      diffuseColor.a = clamp(diffuseColor.a + 0.16*grazing, 0.24, 0.70);
      #include <opaque_fragment>
    `);
  };
  mat.customProgramCacheKey = () => hearth ? 'hearth-quarries' : 'rear-quarries';
  return mat;
}

/** Opaque lead cames share the same quarry divisions as the material. The
 * room-side saddle bars sit just behind the glass rather than on the wall. */
function leadwork(b: Batch, metal: THREE.Material, a: Opening, seat: Section, outline: THREE.Vector2[], z: number, q: Quarries): void {
  const w = seat.width, h = seat.peak - seat.sill;
  const x = a.x + seat.offset, y = a.bottom + seat.sill, room = a.hearth ? -1 : 1;
  for (const [i, sign] of [1, -1].entries()) {
    const slope = sign * w * q.aspect / h;
    for (let n = -8; n <= 11; n++) {
      const k = (n + q.phase[i])*w/q.count - w/2, ys: number[] = [];
      for (let j = 1; j < outline.length; j++) {
        const p = outline[j-1], q = outline[j], dp = p.x-slope*p.y-k, dq = q.x-slope*q.y-k;
        if (dp*dq > 0 || Math.abs(dp-dq) < 1e-8) continue;
        ys.push(p.y + (q.y-p.y)*dp/(dp-dq));
      }
      if (ys.length < 2) continue;
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const length = (y1-y0)*Math.hypot(1,slope) - 0.006, centre = (y0+y1)/2;
      if (length <= 0.007) continue;
      b.geo(metal, new THREE.BoxGeometry(0.007, length, 0.012), x+k+slope*centre, y+centre, z, 0, 0, -Math.atan(slope));
    }
  }
  const barZ = z + room * 0.021;
  for (const h of a.hearth ? [0.34, 0.70] : [0.30, 0.79]) {
    b.box(metal, x-w/2, barZ-0.006, x+w/2, barZ+0.006, y+h-0.008, y+h+0.008, 1);
  }
}

export function buildGatehouseLights(b: Batch, group: THREE.Group, stone: THREE.Material, metal: THREE.Material) {
  const normals = quarryNormals();
  const hearthWindowMat = waveGlass(true, normals, HEARTH_QUARRIES), windowMat = waveGlass(false, normals, REAR_QUARRIES);
  for (const a of GATEHOUSE_LIGHTS) {
    const sections = revealSections(a);
    dressOpening(b, stone, a, sections);
    const seat = sections[1], z = (seat.z + sections[2].z) / 2;
    const shape = sectionPath(seat);
    const geo = new THREE.ShapeGeometry(shape, CURVE_SEGMENTS), pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i)/seat.width+0.5, pos.getY(i)/(seat.peak-seat.sill));
    const pane = new THREE.Mesh(geo, a.hearth ? hearthWindowMat : windowMat);
    pane.name = a.hearth ? 'Hearth window quarries' : 'Gatehouse rear quarries';
    pane.position.set(a.x+seat.offset, a.bottom+seat.sill, -z);
    pane.receiveShadow = true;
    pane.renderOrder = 1;
    group.add(pane);
    leadwork(b, metal, a, seat, shape.getPoints(CURVE_SEGMENTS), z, a.hearth ? HEARTH_QUARRIES : REAR_QUARRIES);
  }
  return { windowMat, hearthWindowMat };
}
