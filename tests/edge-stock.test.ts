import { Vector2, Vector3, type BufferGeometry } from 'three';
import { expect, it } from 'vitest';
import { edgeStock, type EdgeStockProfile } from '../src/render/edgeStock';
import { tiledBox } from '../src/render/materials';

const profiles: EdgeStockProfile[] = ['stone', 'timber', 'iron'];
const v = (g: BufferGeometry, attr: string, i: number) => new Vector3().fromBufferAttribute(g.getAttribute(attr), i);
const tex = (g: BufferGeometry, i: number) => {
  const uv = g.getAttribute('uv');
  return new Vector2(uv.getX(i), uv.getY(i));
};
const normalOf = (a: Vector3, b: Vector3, c: Vector3) => b.clone().sub(a).cross(c.clone().sub(a));

it.each(profiles)('%s: closed, consistently wound solid within the original stock, even on tiny and thin parts', profile => {
  const sizes: [number, number, number][] = [[.83, 1.57, 2.41], [.008, .33, .012], [3e-5, 1e-5, 2e-5]];
  for (const [w, h, d] of sizes) {
    const g = edgeStock(w, h, d, .77, profile), idx = g.index!;
    g.computeBoundingBox();
    const half = new Vector3(w / 2, h / 2, d / 2);
    for (let k = 0; k < 3; k++) {
      expect(g.boundingBox!.max.getComponent(k)).toBe(Math.fround(half.getComponent(k)));
      expect(g.boundingBox!.min.getComponent(k)).toBe(-Math.fround(half.getComponent(k)));
    }
    // Weld in position space only: texture seams are intentional; holes, T-junctions
    // and conflicting normals on those seams are not. No epsilon weld on the tiny part.
    const normals = new Map<string, Vector3>();
    const uses = new Map<string, { total: number; winding: number }>();
    for (let t = 0; t < idx.count; t += 3) {
      const ids = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const [a, b, c] = ids.map(i => v(g, 'position', i));
      const cp = normalOf(a, b, c), center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      expect(cp.dot(center)).toBeGreaterThan(0); // strict: also rejects zero-area triangles
      const [s, u, q] = ids.map(i => tex(g, i));
      expect(u.sub(s).cross(q.sub(s))).toBeGreaterThan(0);
      for (const [j, i] of ids.entries()) {
        const p = v(g, 'position', i), n = v(g, 'normal', i);
        expect(n.length()).toBeCloseTo(1, 6);
        expect(cp.dot(n)).toBeGreaterThan(0);
        const key = p.toArray().join(','), next = v(g, 'position', ids[(j + 1) % 3]).toArray().join(',');
        expect(normals.get(key)?.distanceTo(n) ?? 0).toBe(0);
        normals.set(key, n);
        const edge = [key, next].sort().join('|');
        const prev = uses.get(edge) ?? { total: 0, winding: 0 };
        prev.total++; prev.winding += key < next ? 1 : -1; uses.set(edge, prev);
      }
    }
    expect([...uses.values()].every(e => e.total === 2 && e.winding === 0)).toBe(true);
    expect(normals.size - uses.size + idx.count / 3).toBe(2); // sphere topology
  }
});

it.each(profiles)('%s: locks each broad quad to its axis and rounds all twelve shoulders at half-angle', profile => {
  const g = edgeStock(1, 2, 3, 1, profile), idx = g.index!;
  const half = new Vector3(.5, 1, 1.5), flats: number[] = [], rails = new Set<string>();
  // Caps are exercised here; smaller sizes in the closure test exercise the proportional limit.
  const r = { stone: .038, timber: .014, iron: .0035 }[profile];
  for (const group of g.groups) {
    let flat = 0;
    const axis = Math.floor(group.materialIndex! / 2), sign = group.materialIndex! % 2 ? -1 : 1;
    for (let t = group.start; t < group.start + group.count; t += 3) {
      const ids = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      if (ids.every(i => v(g, 'position', i).getComponent(axis) === sign * half.getComponent(axis))) {
        for (const i of ids) expect(v(g, 'normal', i).getComponent(axis)).toBe(sign);
        flat++;
      }
      for (const i of ids) {
        const p = v(g, 'position', i), n = v(g, 'normal', i);
        const core = half.clone().addScalar(-r).multiply(new Vector3(Math.sign(p.x), Math.sign(p.y), Math.sign(p.z)));
        // A real inset radius, not just edited vertex normals on an ordinary box.
        expect(p.distanceTo(core.addScaledVector(n, r))).toBeLessThan(1.5e-7);
        if (n.toArray().filter(k => Math.abs(Math.abs(k) - Math.SQRT1_2) < 1e-6).length === 2) rails.add(n.toArray().join(','));
      }
    }
    flats.push(flat);
  }
  expect(flats).toEqual([2, 2, 2, 2, 2, 2]);
  expect(rails.size).toBe(12);
});

it('uses the exact six tiledBox charts (orientation, origin and metres per repeat), including the bevels', () => {
  for (const tile of [.43, 2.7]) {
    const dims = [.53, 1.23, .86] as const;
    const ref = tiledBox(...dims, tile), g = edgeStock(...dims, tile, 'timber');
    expect(g.groups.map(group => group.materialIndex)).toEqual(ref.groups.map(group => group.materialIndex));
    for (const group of g.groups) {
      const i0 = group.materialIndex! * 4, origin = v(ref, 'position', i0);
      const du = v(ref, 'position', i0 + 1).sub(origin), dv = v(ref, 'position', i0 + 2).sub(origin);
      const tex0 = tex(ref, i0), tu = tex(ref, i0 + 1).sub(tex0), tv = tex(ref, i0 + 2).sub(tex0);
      for (let j = group.start; j < group.start + group.count; j++) {
        const i = g.index!.getX(j), delta = v(g, 'position', i).sub(origin);
        const expected = tex0.clone().addScaledVector(tu, delta.dot(du) / du.lengthSq()).addScaledVector(tv, delta.dot(dv) / dv.lengthSq());
        expect(tex(g, i).distanceTo(expected)).toBeLessThan(4e-7);
      }
    }
  }
});

it('stays within the same indexed buffer budget for all profiles; no unused vertices or extra channels', () => {
  for (const profile of profiles) {
    const g = edgeStock(.12, .7, .25, .5, profile), idx = g.index!;
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(idx.array).toBeInstanceOf(Uint16Array);
    expect(idx.count / 3).toBe(92);
    expect(g.getAttribute('position').count).toBe(80);
    expect(new Set(idx.array).size).toBe(80);
    expect(Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, idx.array.byteLength)).toBe(3112);
  }
});
