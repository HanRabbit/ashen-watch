import { Group, Mesh, MeshStandardMaterial, Texture, TextureLoader, Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { addBaileyPaving } from '../src/render/baileyPaving';
import { Batch } from '../src/render/geom';
import { awUniforms, enhance, stoneShader } from '../src/render/materials';
import { pavingFace } from '../src/render/pavingFace';

it('keeps the complete rotated stone and its unfolded sides inside one photographed face', () => {
  for (const repair of [false, true]) for (let crop = 0; crop < 40; crop++) {
    const radius = .32 + .05 * (crop % 7);
    const { crop: [a, b, c, d], sample } = pavingFace(repair, (crop + .5) / 40, crop * .19, -3.31, 15.76, radius);
    for (let i = 0; i < 24; i++) {
      const phi = i * Math.PI / 12;
      const [u, v] = sample(-3.31 + radius * Math.cos(phi), 15.76 + radius * Math.sin(phi));
      expect(u).toBeGreaterThan(a);
      expect(u).toBeLessThan(c);
      expect(v).toBeGreaterThan(b);
      expect(v).toBeLessThan(d);
    }
  }
});

it('batches the worn crowns and shoulders with continuous normals, below boot-tread height', () => {
  const old = new MeshStandardMaterial(), repair = new MeshStandardMaterial();
  const b = new Batch(), scene = new Group();
  addBaileyPaving(b, old, repair);
  b.build(scene);
  const caps = (scene.children as Mesh[]).filter(o => o.material === old || o.material === repair);
  expect(caps).toHaveLength(2);
  for (const mesh of caps) {
    const { position, normal } = mesh.geometry.attributes;
    const a = new Vector3(), c = new Vector3();
    const atPosition = new Map<string, Vector3>();
    let maxHeight = -Infinity, edge = 0, top = 0, mismatches = 0;
    for (let i = 0; i < position.count; i++) {
      a.fromBufferAttribute(position, i); c.fromBufferAttribute(normal, i);
      maxHeight = Math.max(maxHeight, a.y);
      if (c.y < .8) edge++;
      if (c.y > .96) top++;
      if (Math.abs(1 - c.length()) > .0001) throw Error('Non-unit paving normal');
      const key = a.toArray().join(',');
      const prev = atPosition.get(key);
      if (!prev) atPosition.set(key, c.clone());
      else if (prev.distanceToSquared(c) > 1e-5) mismatches++;
    }
    expect(maxHeight).toBeLessThan(.029);
    expect(edge).toBeGreaterThan(100);
    expect(top).toBeGreaterThan(edge);
    expect(mismatches).toBe(0);
  }
});

it('keeps the visible bedding within 4.3 cm of the walking support plane, away from vertical slab walls', () => {
  const b = new Batch(), scene = new Group(), flag = new MeshStandardMaterial();
  addBaileyPaving(b, flag, flag);
  b.build(scene);
  const bed = (scene.children as Mesh[]).find(m => m.material !== flag)!;
  const { position, normal } = bed.geometry.attributes;
  let min = 0;
  for (let i = 0; i < position.count; i++) {
    if (normal.getY(i) < .6) continue;
    min = Math.min(min, position.getY(i));
  }
  expect(min).toBeLessThan(-.037);
  expect(min).toBeGreaterThan(-.043);
});

it('never applies scan displacement to a procedural or mismatched normal map', async () => {
  const start = (name: string) => {
    const mat = new MeshStandardMaterial();
    const u = awUniforms(1, .5, .4, [1, 1, 1], .006), pending: Promise<void>[] = [];
    stoneShader(mat, u);
    enhance(mat, name, .8, pending);
    return { u, ready: Promise.all(pending) };
  };
  let finishNormal!: (texture: Texture<HTMLImageElement>) => void;
  const deferredNormal = new Promise<Texture<HTMLImageElement>>(resolve => { finishNormal = resolve; });
  const height = new Texture<HTMLImageElement>();
  const mock = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(url => {
    if (url.endsWith('_disp.jpg')) return Promise.resolve(height);
    if (url.endsWith('_nor.jpg')) return url.includes('delayed_film') ? deferredNormal : Promise.reject(Error('unavailable'));
    return Promise.resolve(new Texture<HTMLImageElement>());
  });
  try {
    const delayed = start('delayed_film'), failed = start('partial_film');
    await failed.ready;
    expect(failed.u.uAwHasDisp.value).toBe(0);
    expect(delayed.u.uAwHasDisp.value).toBe(0);
    finishNormal(new Texture<HTMLImageElement>());
    await delayed.ready;
    expect(delayed.u.uAwHasDisp.value).toBe(1);
    expect(delayed.u.uAwHeightMap.value).toBe(height);
  } finally { mock.mockRestore(); }
});
