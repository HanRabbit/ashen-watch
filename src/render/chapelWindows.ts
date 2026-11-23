// All drawings are local to the wall: +Z faces the weather, -Z faces the nave.
// The wall cut, masonry and glass use the SAME spring and crown, measured from the sill.
import * as THREE from 'three';
import { Batch } from './geom';
import { scaleUV } from './materials';

type Point = [number, number];
export interface Light {
  u: number; sill: number; width: number; spring: number; height: number;
  pattern: 'great' | 'pair' | 'single';
}
interface Wall {
  x: number; y: number; z: number; rot: number;
  width: number; eaves: number; peak?: number; lights: Light[];
}
interface Fabric { ash: THREE.Material; trim: THREE.Material; iron: THREE.Material; glass: THREE.Material; lead: THREE.Material }

function pointed<T extends THREE.Path>(p: T, cx: number, y: number, w: number, s: number, h: number): T {
  const l = cx - w / 2, r = cx + w / 2, k = y + s + 0.72 * (h - s);
  p.moveTo(l, y); p.lineTo(l, y + s);
  p.quadraticCurveTo(l, k, cx, y + h); p.quadraticCurveTo(r, k, r, y + s);
  p.lineTo(r, y); p.closePath();
  return p;
}

/** Normalized cartoons, x in [-1,1], y in [0,1]. The stone is the material
 * LEFT between these piercings: every cusp and fork has a load path to a jamb or sill. */
function openings(light: Light): THREE.Shape[] {
  const holes: THREE.Shape[] = [];
  const make = (mirror = 1) => {
    const p = new THREE.Shape(); holes.push(p);
    const x = (u: number) => u * light.width * 0.5 * mirror;
    const y = (v: number) => v * light.height;
    return {
      m: (u: number, v: number) => p.moveTo(x(u), y(v)), l: (u: number, v: number) => p.lineTo(x(u), y(v)),
      q: (a: number, b: number, u: number, v: number) => p.quadraticCurveTo(x(a), y(b), x(u), y(v)),
      c: (a: number, b: number, d: number, e: number, u: number, v: number) => p.bezierCurveTo(x(a), y(b), x(d), y(e), x(u), y(v)),
      close: () => p.closePath(),
    };
  };
  const lancet = (u: number, radius: number, spring: number, head: number) => {
    const p = make(), rise = head - spring;
    p.m(u - radius, 0.013); p.l(u - radius, spring);
    p.q(u - radius, spring + rise * 0.55, u - radius * 0.50, spring + rise * 0.62);
    p.c(u - radius * 0.69, spring + rise * 0.75, u - radius * 0.28, head - rise * 0.06, u, head);
    p.c(u + radius * 0.28, head - rise * 0.06, u + radius * 0.69, spring + rise * 0.75, u + radius * 0.50, spring + rise * 0.62);
    p.q(u + radius, spring + rise * 0.55, u + radius, spring); p.l(u + radius, 0.013); p.close();
  };
  if (light.pattern === 'single') {
    lancet(0, 0.88, 0.58, 0.95);
  } else if (light.pattern === 'pair') {
    for (const s of [-1, 1]) lancet(s * 0.485, 0.415, 0.54, 0.76);
    const p = make(); // small cusped lozenge set between the two heads
    p.m(0, 0.948); p.q(-0.45, 0.85, -0.33, 0.805); p.q(-0.14, 0.80, -0.14, 0.826);
    p.q(-0.18, 0.78, 0, 0.708); p.q(0.18, 0.78, 0.14, 0.826);
    p.q(0.14, 0.80, 0.33, 0.805); p.q(0.45, 0.85, 0, 0.948); p.close();
  } else {
    lancet(0, 0.206, 0.494, 0.657);
    for (const s of [-1, 1]) {
      lancet(s * 0.42, 0.166, 0.461, 0.581);
      lancet(s * 0.783, 0.150, 0.394, 0.511);
      // Two ranks of leaning flame-shaped lights follow the thrust of the jambs.
      const wing = make(s);
      wing.m(0.75, 0.539); wing.c(0.90, 0.515, 0.94, 0.531, 0.92, 0.629);
      wing.q(0.90, 0.688, 0.842, 0.706); wing.q(0.846, 0.644, 0.791, 0.653);
      wing.q(0.694, 0.637, 0.654, 0.551); wing.q(0.705, 0.580, 0.75, 0.539); wing.close();
      const flame = make(s);
      flame.m(0.57, 0.594); flame.q(0.61, 0.663, 0.758, 0.712);
      flame.q(0.702, 0.776, 0.476, 0.851); flame.q(0.515, 0.778, 0.426, 0.783);
      flame.q(0.316, 0.778, 0.337, 0.737); flame.q(0.363, 0.673, 0.57, 0.594); flame.close();
      const bud = make(s);
      bud.m(0.238, 0.585); bud.q(0.300, 0.607, 0.463, 0.605);
      bud.q(0.409, 0.66, 0.274, 0.706); bud.q(0.226, 0.728, 0.181, 0.736);
      bud.q(0.159, 0.698, 0.064, 0.672); bud.q(0.214, 0.640, 0.238, 0.585); bud.close();
    }
    // Crown: four lobes cut around inward cusps, rather than intersecting circular hoops.
    const p = make();
    p.m(0, 0.967); p.c(-0.083, 0.949, -0.243, 0.913, -0.136, 0.876);
    p.c(-0.297, 0.907, -0.434, 0.852, -0.343, 0.809); p.q(-0.261, 0.775, -0.132, 0.8);
    p.c(-0.223, 0.758, -0.128, 0.717, 0, 0.695);
    p.c(0.128, 0.717, 0.223, 0.758, 0.132, 0.8); p.q(0.261, 0.775, 0.343, 0.809);
    p.c(0.434, 0.852, 0.297, 0.907, 0.136, 0.876); p.c(0.243, 0.913, 0.083, 0.949, 0, 0.967); p.close();
  }
  return holes;
}

/** Loft the jambs, springers and archivolt together. Sections are contours of
 * the same arch, so the splay returns all the way to the glazing on BOTH faces. */
function dressing(light: Light, profile: Point[]): THREE.BufferGeometry {
  const vertices: number[] = [], uv: number[] = [];
  const strips = profile.map(([out, depth]) => {
    const w = light.width / 2 + out;
    const s = light.spring, h = light.height + 1.2 * out, k = s + (h - s) * 0.72;
    const p = new THREE.Path();
    p.moveTo(-w, 0); p.lineTo(-w, s); p.quadraticCurveTo(-w, k, 0, h);
    p.quadraticCurveTo(w, k, w, s); p.lineTo(w, 0);
    return p.getPoints(16).map(({ x, y }) => new THREE.Vector3(x, y, depth));
  });
  for (let j = 0; j < strips.length; j++) {
    const a = strips[j], b = strips[(j + 1) % strips.length];
    const breadth = Math.hypot(profile[j][0] - profile[(j + 1) % profile.length][0], profile[j][1] - profile[(j + 1) % profile.length][1]);
    let length = 0;
    for (let i = 1; i < a.length; i++) {
      const run = a[i - 1].distanceTo(a[i]);
      for (const p of [a[i - 1], a[i], b[i], a[i - 1], b[i], b[i - 1]]) vertices.push(p.x, p.y, p.z);
      const l = length / 2.2, r = (length + run) / 2.2, v = breadth / 2.2;
      uv.push(l, 0.07, r, 0.07, r, 0.07 + v, l, 0.07, r, 0.07 + v, l, 0.07 + v);
      length += run;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}

export function glazedWall(b: Batch, f: Fabric, wall: Wall): void {
  const { width: w, eaves, peak } = wall;
  const face = new THREE.Shape(); face.moveTo(-w / 2, 0); face.lineTo(w / 2, 0); face.lineTo(w / 2, eaves);
  if (peak) face.lineTo(0, peak);
  face.lineTo(-w / 2, eaves); face.closePath();
  const put = (m: THREE.Material, g: THREE.BufferGeometry, u = 0, y = 0, z = 0) => {
    g.translate(u, y, z); b.geo(m, g, wall.x, wall.y, wall.z, wall.rot);
  };
  for (const light of wall.lights) {
    const { u, sill, width, spring, height, pattern } = light;
    const hero = pattern === 'great', rim = hero ? 0.19 : 0.10;
    face.holes.push(pointed(new THREE.Path(), u, sill, width, spring, height));
    const panes = openings(light);
    const web = pointed(new THREE.Shape(), 0, 0, width, spring, height);
    // ExtrudeGeometry expects counter-clockwise holes in a clockwise contour;
    // mirrored flame drawings otherwise acquire inward normals on one half.
    for (const pane of panes) {
      const pts = pane.getPoints(9);
      web.holes.push(new THREE.Path(THREE.ShapeUtils.isClockWise(pts) ? pts.reverse() : pts));
    }
    const bevel = hero ? 0.026 : 0.012, depth = hero ? 0.17 : 0.105;
    const stone = new THREE.ExtrudeGeometry(web, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel * 1.4, bevelSegments: 2, curveSegments: 9 });
    put(f.trim, scaleUV(stone, 0.44), u, sill, -depth / 2);
    const profile: Point[] = [[-rim * 0.53, -0.08], [-rim * 0.53, 0.09], [-rim * 0.31, 0.125], [-rim * 0.15, 0.127],
      [rim * 0.13, 0.206], [rim * 0.13, 0.249], [rim * 0.30, 0.272], [rim * 0.47, 0.266], [rim * 0.61, 0.283],
      [rim * 0.68, 0.324], [rim * 0.92, 0.338], [rim * 1.13, 0.310], [rim * 1.17, 0.238],
      [rim * 0.66, -0.253], [rim * 0.29, -0.279], [-rim * 0.15, -0.224]];
    put(f.trim, dressing(light, profile), u, sill);
    // Stone stool extends under the molding feet; bevel gives the weather edge a drip.
    const stool = new THREE.Shape(); stool.moveTo(-width / 2 - rim * 1.3, 0); stool.lineTo(width / 2 + rim * 1.3, 0);
    stool.lineTo(width / 2 + rim * 1.3, 0.102); stool.lineTo(-width / 2 - rim * 1.3, 0.102); stool.closePath();
    put(f.trim, scaleUV(new THREE.ExtrudeGeometry(stool, { depth: 0.625, bevelSize: 0.021, bevelThickness: 0.018, bevelSegments: 1 }), 0.44), u, sill - 0.094, -0.28);

    const glazing = new THREE.ShapeGeometry(panes, 9);
    const pos = glazing.getAttribute('position'), tex = glazing.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) tex.setXY(i, pos.getX(i) / 1.52 + u * 0.37, pos.getY(i) / 1.76);
    // The came network is a cutout in the opaque pass. Translucent glass
    // behind it cannot erase its silhouette even across another glazed bay.
    put(f.lead, glazing.clone(), u, sill, -0.032);
    put(f.glass, glazing, u, sill, -0.035);
    // Slender saddle bars brace the lead panels from the nave side only.
    const spacing = hero ? 0.92 : 0.74;
    for (let y = spacing; y < spring + 0.01; y += spacing) {
      const bar = new THREE.CylinderGeometry(hero ? 0.014 : 0.01, hero ? 0.014 : 0.01, width, 6).rotateZ(Math.PI / 2);
      put(f.iron, bar, u, sill + y, -depth / 2 - 0.025);
    }
  }
  put(f.ash, scaleUV(new THREE.ExtrudeGeometry(face, { depth: 0.5, bevelEnabled: false, curveSegments: 16 }), 0.5), 0, 0, -0.25);
}

/** Clear leaded quarries, not coloured stained glass. A single repeating sheet
 * supplies the glass colour, shallow cylinder-glass waves and raised lead cames. */
export function chapelGlass(): { glass: THREE.MeshStandardMaterial; lead: THREE.MeshStandardMaterial } {
  const size = 256, colour = new Uint8Array(size * size * 4), normals = new Uint8Array(colour.length), finish = new Uint8Array(colour.length);
  const mask = new Uint8Array(colour.length);
  const tau = Math.PI * 2;
  const smooth = (a: number, b: number, v: number) => THREE.MathUtils.smoothstep(v, a, b);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = (i + 0.5) / size, v = (j + 0.5) / size;
    const x = (u + 0.0031 * Math.sin(tau * (2 * v + u))) * 6;
    const y = (v + 0.0028 * Math.sin(tau * (u + 2 * v))) * 5;
    const row = Math.floor(y), bond = (row % 5 + 5) % 5;
    const xx = x + [0, 0.04, 0.02, 0.53, 0.52][bond]; // one reset course in each assembled panel
    const col = ((Math.floor(xx) % 6) + 6) % 6;
    const id = Math.sin((col + 3) * 13.57 + (bond + 1) * 27.14) * 734.943;
    const tone = id - Math.floor(id), phase = tone * tau;
    const dx = xx - Math.round(xx), dy = y - Math.round(y);
    const alongX = Math.abs(dx) * 0.253 < Math.abs(dy) * 0.352;
    const mm = (alongX ? Math.abs(dx) * 0.253 : Math.abs(dy) * 0.352) * 1000;
    const pane = smooth(2.8, 7.2, mm), came = 1 - pane;
    const haze = (1 - smooth(5, 22, mm)) * (0.55 + 0.45 * Math.sin(tau * (3 * u + v)));
    const cord = Math.sin(tau * (2 * u + 3 * v) + 2.2 * Math.sin(tau * (v - u)) + phase);
    const wave = Math.sin(tau * (4 * u - v) + 1.8 * Math.sin(tau * v) + phase);
    const faint = 2.4 * cord + 1.8 * wave;
    const luma = 107 + 35 * tone + faint - 12 * haze;
    const k = 4 * (j * size + i), warm = col === 2 && bond === 3 ? 6 : 0;
    const mix = (a: number, b: number) => Math.round(a * came + b * pane);
    colour.set([mix(46, luma - 6 + warm), mix(49, luma + 3), mix(50, luma + 9 - warm), 255], k);
    const bead = came * Math.min(1, mm / 3.4) * 0.43;
    const nx = 0.09 * cord + 0.035 * Math.sin(phase) + (alongX ? bead * Math.sign(dx) : 0);
    const ny = 0.052 * wave + 0.037 * Math.cos(phase) + (alongX ? 0 : bead * Math.sign(dy));
    const inv = 127.5 / Math.hypot(nx, ny, 1);
    normals.set([128 + nx * inv, 128 + ny * inv, 128 + inv, 255], k);
    finish.set([0, mix(183, 61 + tone * 17 + haze * 52), 0, 255], k);
    mask.set([0, 255 * came, 0, 255], k);
  }
  const texture = (bytes: Uint8Array<ArrayBuffer>, srgb = false) => {
    const t = new THREE.DataTexture(bytes, size, size);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  const normalMap = texture(normals), roughnessMap = texture(finish);
  const lead = new THREE.MeshStandardMaterial({ name: 'Chapel | soldered cames', color: 0x353737,
    alphaMap: texture(mask), alphaTest: 0.42, alphaToCoverage: true, normalMap, roughness: 0.69, metalness: 0.44, side: THREE.DoubleSide });
  const mat = new THREE.MeshStandardMaterial({ name: 'Chapel | leaded clear quarries', map: texture(colour, true),
    normalMap, roughnessMap, roughness: 1, metalness: 0, transparent: true, depthWrite: false, forceSinglePass: true,
    color: 0x97a4af, emissive: 0xc1d0dc, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      // Recessed glass seen from outside mostly reflects the sky probe; from
      // the nave the same quarries admit broad skylight. No screen refraction.
      float sky = smoothstep(0.0, 2.6, vMapUv.y);
      float edge = smoothstep(0.0, 0.17, vMapUv.y);
      totalEmissiveRadiance *= sampledDiffuseColor.rgb * mix(0.68, 1.0, edge)
        * (gl_FrontFacing ? mix(0.19, 0.37, sky) : mix(1.15, 1.90, sky));
    `).replace('#include <opaque_fragment>', `
      // Optical density of clear sheet glass, not the opacity of the stone frame.
      // Actual opaque scene colour remains visible behind both opposing lights;
      // the live sky probe takes over on the slightly wavy glass at grazing angles.
      float grazing = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
      float film = smoothstep(0.26, 0.48, roughnessFactor);
      diffuseColor.a *= clamp(0.27 + 0.40 * grazing + 0.17 * film, 0.0, 0.88);
      #include <opaque_fragment>
    `);
  };
  mat.customProgramCacheKey = () => 'chapel-glass-front-and-nave';
  mat.onBeforeRender = (_renderer, scene) => { mat.emissiveIntensity = THREE.MathUtils.lerp(0.85, 0.045, scene.userData.night ?? 0); };
  return { glass: mat, lead };
}
