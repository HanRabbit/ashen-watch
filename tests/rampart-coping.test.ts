import { BufferGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Batch } from '../src/render/geom';
import { addRampartEdge } from '../src/render/rampartEdges';
import { WALLS } from '../src/sim/level';

it('keeps cut coping courses closed inside the survey on both orientations, without rounding broad faces', () => {
  const m=new MeshStandardMaterial(), stone={wallRubble:m,wallRough:m,wallTrim:m,woodBeam:m};
  let courses=0,runs=0;
  for (const w of WALLS.filter(w=>w.tag==='rail')) {
    const b=new Batch(), solids:BufferGeometry[]=[];
    b.observeGeometry(g=>solids.push(g),()=>{if(addRampartEdge(b,stone,w))runs++;});
    for (const g of solids) {
      const p=g.getAttribute('position'), n=g.getAttribute('normal');
      if (p.count!==96) continue;
      courses++;
      expect(g.getAttribute('uv').count).toBe(96);
      const edges=new Map<string,number>();
      for(let i=0;i<p.count;i+=3){
        const t=[0,1,2].map(k=>new Vector3().fromBufferAttribute(p,i+k));
        const cross=t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0]));
        expect(cross.length()).toBeGreaterThan(1e-7);
        for(const [k,v] of t.entries()){
          expect(v.x).toBeGreaterThanOrEqual(w.x0-1e-5);expect(v.x).toBeLessThanOrEqual(w.x1+1e-5);
          expect(-v.z).toBeGreaterThanOrEqual(w.z0-1e-5);expect(-v.z).toBeLessThanOrEqual(w.z1+1e-5);
          expect(v.y).toBeGreaterThanOrEqual(w.y0!-1e-5);expect(v.y).toBeLessThanOrEqual(w.h+1e-5);
          expect(cross.dot(new Vector3().fromBufferAttribute(n,i+k))).toBeGreaterThan(0);
          const ab=[v.toArray().join(','),t[(k+1)%3].toArray().join(',')].sort().join('|'); edges.set(ab,1+(edges.get(ab)??0));
        }
      }
      expect(new Set(edges.values())).toEqual(new Set([2]));
    }
  }
  expect(runs).toBe(3);expect(courses).toBeGreaterThan(30);
});
