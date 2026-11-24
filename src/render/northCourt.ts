import * as THREE from 'three';
import { NORTH_ARCHES, NORTH_PIERS, NORTH_WALK_BEARING, NORTH_WALL_PANELS, type NorthPoint } from '../sim/northCourt';
import type { Box } from '../sim/level';
import type { Batch } from './geom';

interface Stonework {
  wallAshlar: THREE.Material;
  wallTrim: THREE.Material;
  wallRubble: THREE.Material;
  wallRough: THREE.Material;
}

type Point = NorthPoint & { y: number };

/** World-space UVs follow each stone face, including the exposed thickness. */
function face(b: Batch, mat: THREE.Material, polygon: readonly Point[], inside: THREE.Vector3, tile: number, chart?: (p: THREE.Vector3) => [number, number]): void {
  const vertices = polygon.map(({ x, y, z }) => new THREE.Vector3(x, y, -z));
  const positions: number[] = [], uv: number[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[0];
    let c = vertices[i], d = vertices[i + 1];
    const normal = c.clone().sub(a).cross(d.clone().sub(a));
    if (normal.lengthSq() < 1e-12) continue;
    if (normal.dot(a.clone().sub(inside)) < 0) { [c, d] = [d, c]; normal.negate(); }
    const flat = Math.abs(normal.y) > Math.hypot(normal.x, normal.z);
    const tangent = new THREE.Vector2(normal.z, -normal.x).normalize();
    for (const p of [a, c, d]) {
      positions.push(p.x, p.y, p.z);
      const [u,v] = chart ? chart(p) : [flat ? p.x : p.x * tangent.x + p.z * tangent.y, flat ? p.z : p.y];
      uv.push(u / tile, v / tile);
    }
  }
  if (positions.length === 0) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  b.geo(mat, geometry, 0, 0, 0);
}

function centerOf(points: readonly Point[]): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (const p of points) { center.x += p.x; center.y += p.y; center.z -= p.z; }
  return center.divideScalar(points.length);
}

export function addNorthPaving(b: Batch, mat: THREE.Material, polygon: readonly NorthPoint[], y: number, tile: number): void {
  const top = polygon.map((p) => ({ ...p, y }));
  const inside = centerOf(top); inside.y -= 1;
  face(b, mat, top, inside, tile);
}

export function addNorthGroundSlab(b: Batch, mat: THREE.Material, polygon: readonly NorthPoint[], bottom: number): void {
  const top = polygon.map((p) => ({ ...p, y: 0 }));
  const base = polygon.map((p) => ({ ...p, y: bottom }));
  const inside = centerOf([...top, ...base]);
  face(b, mat, top, inside, 2.85);
  face(b, mat, base, inside, 2.85);
  // The closing edge at z=29 joins the original slab.
  for (let i = 1; i < top.length; i++) face(b, mat, [base[i - 1], base[i], top[i], top[i - 1]], inside, 2.85);
}

function archPrism(b: Batch, mat: THREE.Material, section: readonly { x: number; h: number }[], z0: number, z1: number, tile: number): void {
  const front = section.map(({ x, h }) => ({ x, y: h, z: z0 }));
  const back = front.map((p) => ({ ...p, z: z1 }));
  const inside = centerOf([...front, ...back]);
  face(b, mat, front, inside, tile);
  face(b, mat, back, inside, tile);
  for (let i = 0; i < front.length; i++) {
    const j = (i + 1) % front.length;
    face(b, mat, [front[i], front[j], back[j], back[i]], inside, tile);
  }
}

/** Dressed voussoirs only lose material on the exposed mouth of the barrel.
 * Radial joints and the back bed remain square; independently recessed stones
 * can still bear against the continuous masonry directly behind them. */
function archMouth(b: Batch, mat: THREE.Material, section: {x:number; h:number}[], lipZ:number, bedZ:number): void {
  const end = Math.sign(bedZ-lipZ), [a,c,d,e] = section;
  const cut = (p: typeof a, q: typeof a, t:number, z:number):Point => ({x:p.x+(q.x-p.x)*t, y:p.h+(q.h-p.h)*t,z});
  const ring = (t:number, z:number) => [cut(a,e,t,z),cut(c,d,t,z)];
  const outer = (z:number) => [cut(d,d,0,z),cut(e,e,0,z)];
  const front=ring(.13,lipZ), mid=ring(.038,lipZ+end*.009), shoulder=ring(0,lipZ+end*.028), back=ring(0,bedZ);
  const [d0,e0]=outer(lipZ),[d1,e1]=outer(bedZ);
  const inside=centerOf([...front,...back,d0,e0,d1,e1]);
  for(const quad of [[...front,d0,e0],[...back,d1,e1],[d0,e0,e1,d1]])face(b,mat,quad,inside,1.25);
  const bands=[front,mid,shoulder,back];
  for(let i=0;i<3;i++)face(b,mat,[bands[i][0],bands[i][1],bands[i+1][1],bands[i+1][0]],inside,1.25);
  for(const [i,f,h] of [[0,e0,e1],[1,d0,d1]] as const) {
    // Fan from the uncut outer corner, not the nearly collinear lip points.
    face(b,mat,[f,front[i],mid[i],shoulder[i],back[i],h],inside,1.25);
  }
}

export function addNorthCourtFabric(b: Batch, stone: Stonework): void {
  for (const p of NORTH_PIERS) {
    // One octagonal footprint for every course: no horizontal grooves between
    // stacked units and no punctures around the support beneath the walk.
    const {x0,x1,z0,z1}=p,r=.049;
    const outline=[[x0+r,z0],[x1-r,z0],[x1,z0+r],[x1,z1-r],[x1-r,z1],[x0+r,z1],[x0,z1-r],[x0,z0+r]];
    const ring=(y:number)=>outline.map(([x,z])=>({x,y,z}));
    for(const [lo,hi,mat,tile] of [[0,.34,stone.wallTrim,1.75],[.34,2.01,stone.wallAshlar,2.4],[2.01,2.15,stone.wallTrim,1.75],[2.15,p.h,stone.wallRubble,2.4]] as const){
      const bottom=ring(lo),top=ring(hi),inside=centerOf([...bottom,...top]);
      // Retain the four original tiledBox face charts on the untouched stone.
      // The narrow diagonal returns continue the preceding face's texture.
      const u=[(v:THREE.Vector3)=>v.x-x0,(v:THREE.Vector3)=>-v.z-z0,
        (v:THREE.Vector3)=>x1-v.x,(v:THREE.Vector3)=>z1+v.z];
      for(let i=0;i<8;i++){
        const j=(i+1)%8,axis=u[Math.floor(i/2)];
        face(b,mat,[bottom[i],bottom[j],top[j],top[i]],inside,tile,v=>[axis(v),v.y-lo]);
      }
      if(lo===0)face(b,mat,bottom,inside,tile,v=>[v.x-x0,z1+v.z]);
      if(hi===p.h)face(b,mat,top,inside,tile,v=>[v.x-x0,-v.z-z0]);
    }
  }
  for (const { profile, z0, z1 } of NORTH_ARCHES) {
    const outer = profile.map(({ x, h }, i) => {
      const t = Math.PI * i / (profile.length - 1);
      return { x: x - .35 * Math.sin(t) ** 2 * Math.cos(t), h: h + .28 };
    });
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], c = profile[i], d = outer[i], e = outer[i - 1];
      const top = [{ x: d.x, h: NORTH_WALK_BEARING }, { x: e.x, h: NORTH_WALK_BEARING }];
      archPrism(b, stone.wallRubble, [e, d, ...top], z0, z1, 2.3);
      // Dressed stone at both faces and rougher stone along the barrel behind it.
      archPrism(b, stone.wallAshlar, [a, c, d, e], z0 + .19, z1 - .19, 2.05);
      const dressed = i % 5 === 2 || i === 9 ? stone.wallAshlar : stone.wallTrim;
      const recess = [.012, .003, .025, .0, .016][i % 5];
      archMouth(b, dressed, [a, c, d, e], z0 + recess, z0 + .19);
      archMouth(b, dressed, [a, c, d, e], z1 - recess, z1 - .19);
    }
  }

  for (let i = 0; i < NORTH_WALL_PANELS.length; i++) {
    const { footprint, edge } = NORTH_WALL_PANELS[i];
    const plinth = edge === 0 || edge === 1 || edge === 5 ? .45 : .23;
    const top = footprint.map((p) => ({ ...p, y: p.h }));
    const foot = footprint.map((p) => ({ ...p, y: plinth }));
    const bottom = footprint.map((p) => ({ ...p, y: -.08 }));
    const inside = centerOf([...top, ...bottom]);
    // A continuous weathered lip along BOTH sides of the surveyed curtain.
    // Endpoints depend on the survey station, never on the panel index: the
    // shoulder crosses a bend without splinter cracks or visible module seams.
    const rim=top.map((p,j)=>{const q=top[3-j], f=.072+.020*Math.sin(1.89*p.x+.57*p.z);
      return {x:p.x+(q.x-p.x)*f, y:p.y+(q.y-p.y)*f, z:p.z+(q.z-p.z)*f};});
    const side=top.map(p=>({...p,y:p.y-.074-.024*Math.cos(.84*p.x-1.76*p.z)}));
    face(b, stone.wallRough, rim, inside, 1.6);
    const body = edge === 3 ? stone.wallRough : stone.wallRubble;
    // Continuous coursed skin on both sides. Expose ends only at the old curtain.
    const faces = [0, 2];
    if (i === 0) faces.push(3);
    if (i === NORTH_WALL_PANELS.length - 1) faces.push(1);
    for (const j of faces) {
      const k = (j + 1) % 4;
      face(b, stone.wallAshlar, [bottom[j], bottom[k], foot[k], foot[j]], inside, 2.15);
      face(b, body, [foot[j], foot[k], side[k], side[j]], inside, 3.15);
      face(b, stone.wallRough, [side[j],side[k],rim[k],rim[j]], inside, 1.6);
    }
  }
}

export function addNorthWalkGuard(b: Batch, pieces: readonly Box[], sill: THREE.Material, iron: THREE.Material, wood: THREE.Material): void {
  for (const piece of pieces) {
    const { tag, x0, x1, z0, z1, y0, h } = piece;
    if (tag === 'northSill' || tag === 'northWood' || x1-x0 > .1) {
      b.edgeBox(tag==='northSill'?'stone':tag==='northWood'?'timber':'iron', tag==='northSill'?sill:tag==='northWood'?wood:iron,x0,z0,x1,z1,y0!,h,1.5);
    } else b.box(iron,x0,z0,x1,z1,y0!,h,1.5); // Subpixel edges of the thin repeated pickets.
  }
}
