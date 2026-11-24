import * as THREE from 'three';
import { AREAS, type Box } from '../sim/level';
import type { Batch } from './geom';
import type { Variants } from './materialVariants';

type Materials = Pick<Variants, 'wallRubble' | 'wallRough' | 'wallTrim' | 'woodBeam'>;
type Panel = readonly [length: number, startHeight: number, endHeight: number, kind: 'wall' | 'break' | 'pier' | 'wood'];

// Each run has its own sequence of surviving masonry and short timber repairs.
// Heights are above the deck and lengths follow the guard.
const WEST: readonly Panel[] = [
  [1.22, .94, .81, 'pier'], [2.13, .66, .55, 'wall'], [1.44, .57, .39, 'break'],
  [.88, .68, .76, 'wood'], [1.06, .87, 1.02, 'pier'], [2.78, .68, .59, 'wall'],
  [.94, .54, .36, 'break'], [1.57, .44, .51, 'wall'], [1.03, .72, .84, 'wood'],
  [.71, .96, .85, 'pier'], [3.27, .65, .47, 'wall'], [1.15, .54, .45, 'break'],
  [.76, .68, .62, 'wood'], [1.33, .79, .90, 'pier'], [2.68, .60, .73, 'wall'],
  [1.58, .55, .47, 'break'], [1.70, .67, .83, 'wall'],
];
const NORTH: readonly Panel[] = [
  [1.46, .84, .92, 'pier'], [2.62, .69, .55, 'wall'], [.84, .49, .38, 'break'],
  [1.16, .64, .76, 'wood'], [1.09, .91, .83, 'pier'], [3.16, .61, .68, 'wall'],
  [.78, .57, .39, 'break'], [1.40, .50, .42, 'wall'], [.73, .66, .70, 'wood'],
  [1.27, 1.03, .89, 'pier'], [2.29, .68, .59, 'wall'],
];
const SOUTH_RETURN: readonly Panel[] = [[.68, .58, .42, 'break'], [.92, .95, .83, 'pier']];

const faces = [
  [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2], [4, 7, 6, 5], [0, 1, 2, 3],
];

type Span = { alongX: boolean; near: number; far: number; base: number };
type EndHeights = readonly [start: number, end: number];

/** A longitudinal coping, not a run of individually rounded cubes. Both
 * ends stay on their original station planes; only the two upper outside
 * arrises are cut. Keep the authored height gradient and cross-fall. */
function coping(span: Span, start: number, end: number, a: number, c: number,
  bottom: EndHeights, top: EndHeights, wear: EndHeights, tile: number, radius: number): THREE.BufferGeometry {
  const { alongX, base } = span;
  const section = (u: number, k: 0 | 1) => {
    // Small deterministic longitudinal variation; long rails need not look lathe-turned.
    const r = Math.min(radius * (.91 + .09 * Math.cos(u * 1.81)), (c-a)*.16, (top[k]-wear[k]-bottom[k])*.24);
    const lip = (v: number, drop: number) => top[k] - wear[k]*(v-a)/(c-a) - drop;
    const q = 1 - Math.SQRT1_2;
    return [[a,bottom[k]],[c,bottom[k]],[c,lip(c,r)],[c-q*r,lip(c-q*r,q*r)],
      [c-r,lip(c-r,0)],[a+r,lip(a+r,0)],[a+q*r,lip(a+q*r,q*r)],[a,lip(a,r)]]
      .map(([v,y]) => new THREE.Vector3(alongX ? u : v, base+y, alongX ? -v : -u));
  };
  const rings=[section(start,0),section(end,1)];
  const pos:number[]=[], uv:number[]=[], nor:number[]=[];
  const tri=(pts:THREE.Vector3[], normals:THREE.Vector3[], chart:'side'|'top'|'end')=>{
    for(const i of alongX ? [0,1,2] : [0,2,1]) {
      const p=pts[i], u=alongX?p.x:-p.z, v=alongX?-p.z:p.x;
      pos.push(...p.toArray());nor.push(...normals[i].toArray());
      uv.push((chart==='end'?v:u)/tile, (chart==='top'?v:p.y-base)/tile);
    }
  };
  const quads=rings[0].map((p,i)=>{const j=(i+1)%8;return [p,rings[0][j],rings[1][j],rings[1][i]];});
  const faceNormals=quads.map(([a,b,c,d])=>b.clone().sub(d).cross(c.clone().sub(a)).normalize().multiplyScalar(alongX?1:-1));
  // Face normals stay flat right up to the lip; only the middle of each
  // quarter-round interpolates. No normal bleed from ends or bottom.
  const mid=(i:number,j:number)=>faceNormals[i].clone().add(faceNormals[j]).normalize();
  const shoulders=[faceNormals[0],faceNormals[1],faceNormals[1],mid(2,3),faceNormals[4],faceNormals[4],mid(5,6),faceNormals[7]];
  for(let i=0;i<8;i++) {
    const [a,b,c,d]=quads[i],j=(i+1)%8, soft=i===2||i===3||i===5||i===6;
    const n=soft?shoulders[i]:faceNormals[i],m=soft?shoulders[j]:faceNormals[i];
    const chart=i===1||i===7?'side':'top';
    tri([a,b,c],[n,m,m],chart);tri([a,c,d],[n,m,n],chart);
  }
  for(const [k,ring] of rings.entries()) {
    const center=ring.reduce((s,v)=>s.add(v),new THREE.Vector3()).multiplyScalar(1/8);
    const n=alongX?new THREE.Vector3(k?1:-1,0,0):new THREE.Vector3(0,0,k?-1:1);
    for(let i=0;i<8;i++){const j=(i+1)%8;tri(k?[center,ring[i],ring[j]]:[center,ring[j],ring[i]],[n,n,n],'end');}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g;
}

/** A single coursed prism. The coping may be worn down along its far edge.
 * Keep its full footprint inside the original narrow collision strip. */
function course(b: Batch, material: THREE.Material, span: Span, start: number, end: number,
  bottom: EndHeights, top: EndHeights, tile: number, inset = 0, wear: EndHeights = [0, 0], radius = 0): void {
  const { alongX, near, far, base } = span;
  const a = near + inset, c = far - inset;
  if (radius) { b.geo(material, coping(span,start,end,a,c,bottom,top,wear,tile,radius),0,0,0); return; }
  const vertices = [
    [start, bottom[0], a], [end, bottom[1], a], [end, bottom[1], c], [start, bottom[0], c],
    [start, top[0], a], [end, top[1], a], [end, top[1] - wear[1], c], [start, top[0] - wear[0], c],
  ];
  const positions: number[] = [], uv: number[] = [];
  for (let i = 0; i < faces.length; i++) {
    const [p, q, r, s] = faces[i];
    const order = alongX ? [p, r, q, p, s, r] : [p, q, r, p, r, s];
    for (const index of order) {
      const [u, y, v] = vertices[index];
      positions.push(alongX ? u : v, base + y, alongX ? -v : -u);
      uv.push((i === 2 || i === 3 ? v : u) / tile, (i >= 4 ? v : y) / tile);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  b.geo(material, geometry, 0, 0, 0);
}

function repair(b: Batch, materials: Materials, span: Span, a: number, c: number, height: EndHeights): void {
  const mid = a + (c - a) * .43;
  course(b, materials.wallTrim, span, mid - .091, mid + .091, [0, 0], [.17, .15], 1.12);
  course(b, materials.woodBeam, span, mid - .058, mid + .048, [.16, .15], [.81, .77], 1.18, .008);
  const [left, right] = height;
  course(b, materials.woodBeam, span, a, c, [left - .09, right - .09], height, 1.18, .012, [0,0], .012);
  course(b, materials.woodBeam, span, a, c, [left - .38, right - .40], [left - .30, right - .32], 1.18, .019, [0,0], .009);
}

/** Draw the main court's western and northern guards. Return false for the
 * east, bridge and gallery so their existing open metalwork is retained. */
export function addRampartEdge(b: Batch, material: Materials, w: Box): boolean {
  const { westWalk, northWalk, eastWalk } = AREAS;
  if (w.tag !== 'rail' || w.y0 === undefined) return false;
  const alongX = w.x1 - w.x0 > w.z1 - w.z0;
  let panels: readonly Panel[];
  if (!alongX && w.x1 === westWalk.x1 && w.z0 === westWalk.z0 && w.z1 === northWalk.z0) panels = WEST;
  else if (alongX && w.z1 === northWalk.z0 && w.x0 === westWalk.x1 && w.x1 === eastWalk.x0) panels = NORTH;
  else if (alongX && w.z1 === westWalk.z0 && w.x0 === westWalk.x0 && w.x1 === westWalk.x1) panels = SOUTH_RETURN;
  else return false;

  const span = { alongX, near: alongX ? w.z0 : w.x0, far: alongX ? w.z1 : w.x1, base: w.y0 };
  const start = alongX ? w.x0 : w.z0, end = alongX ? w.x1 : w.z1;
  const scale = (end - start) / panels.reduce((sum, [length]) => sum + length, 0);
  let a = start;
  for (const [i, [length, first, last, kind]] of panels.entries()) {
    const c = i === panels.length - 1 ? end : a + length * scale;
    const clearance = w.h - w.y0;
    const top: EndHeights = [Math.min(first, clearance), Math.min(last, clearance)];
    if (kind === 'wood') repair(b, material, span, a, c, top);
    else if (kind === 'pier') {
      const neck: EndHeights = [top[0] - .15, top[1] - .13];
      course(b, material.wallRubble, span, a, c, [0, 0], neck, 2.3, .008);
      course(b, material.wallTrim, span, a, c, neck, top, 1.42, 0, [.035, .014], .032);
    } else {
      const bed = i % 3 === 0 ? .20 : .14;
      course(b, material.wallRubble, span, a, c, [0, 0], [bed, bed], 2.3);
      course(b, kind === 'break' ? material.wallRough : material.wallRubble, span, a, c,
        [bed, bed], top, 2.3, kind === 'break' ? .014 : .004, kind === 'break' ? [.08, .12] : [.025, .06], kind === 'break' ? .046 : .028);
    }
    a = c;
  }
  return true;
}
