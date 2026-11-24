import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { edgeStock } from '../src/render/edgeStock';
import { buildFurniture } from '../src/render/furniture';
import { Batch } from '../src/render/geom';
import { buildLandmarks } from '../src/render/landmarks';
import type { Variants } from '../src/render/materialVariants';
import { tiledBox, type Materials } from '../src/render/materials';
import { Props } from '../src/render/props';
import { addYardProp } from '../src/render/yardProps';
import { DOORS, PROPS, RAISED_Y } from '../src/sim/level';
import { newWorld } from '../src/sim/state';

// Exercise the real synchronous game builders and Batch. Only the asset I/O,
// canvas and texture families are stubbed so the result is independent of GLB loading.
vi.mock('../src/render/edgeStock', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/render/edgeStock')>();
  return { ...actual, edgeStock: vi.fn(actual.edgeStock) };
});
vi.mock('../src/render/materialVariants', () => ({ variants: () => materialFamily<Variants>() }));
vi.mock('../src/render/propAssets', async importOriginal => ({
  ...await importOriginal<typeof import('../src/render/propAssets')>(),
  loadProp: ({ name }: { name: string }) => Object.assign(new THREE.Group(), { name: `prop_${name}` }),
}));
vi.mock('../src/render/oilFlaskAsset', () => ({ mountOilFlask: () => {} }));
vi.mock('../src/render/rodinAssets', () => ({
  mountRodin: (parent: THREE.Group, _name: string, fallback: THREE.Group) => parent.add(fallback),
}));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class { setMeshoptDecoder() {} load() {} },
}));
vi.mock('../src/render/materials', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/render/materials')>();
  const texture = () => new THREE.Texture();
  return { ...actual, glowTexture: texture, smokeTexture: texture, grimeTexture: texture, trackPending: () => {} };
});

const stock = vi.mocked(edgeStock);
const realStock = stock.getMockImplementation()!;
function materialFamily<T>(): T {
  return new Proxy({} as Record<string, THREE.MeshStandardMaterial>, {
    get: (family, key: string) => family[key] ??= new THREE.MeshStandardMaterial(),
  }) as T;
}

beforeEach(() => {
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, k) => () => String(k).endsWith('Gradient') ? gradient : undefined });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  stock.mockClear().mockImplementation(realStock);
});
afterEach(() => vi.unstubAllGlobals());

const triangles = (g: THREE.BufferGeometry) => (g.index?.count ?? g.getAttribute('position').count) / 3;
function budget(group: THREE.Group) {
  let meshes = 0, faces = 0, bytes = 0;
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const g = o.geometry as THREE.BufferGeometry;
    faces += triangles(g);
    bytes += g.index?.array.byteLength ?? 0;
    for (const attribute of Object.values(g.attributes)) bytes += attribute.array.byteLength;
  });
  return { meshes, faces, bytes };
}

it.each([
  ['interactive props', () => new Props(materialFamily<Materials>()).group, [1, 8, 29], 104],
  ['furniture', () => buildFurniture(materialFamily<Materials>()), [13, 46, 0], 136],
  ['landmark approaches', () => buildLandmarks(materialFamily<Materials>(), new THREE.Color()).group, [9, 0, 0], 72],
] as const)('caps the built geometry budget for %s without splitting draws', (_name, build, profiles, maxKiB) => {
  const actual = budget(build());
  expect(['stone', 'timber', 'iron'].map(p => stock.mock.calls.filter(args => args[4] === p).length)).toEqual(profiles);
  stock.mockImplementation(tiledBox);
  const baseline = budget(build());

  expect(actual.meshes).toBe(baseline.meshes);
  expect(actual.faces - baseline.faces).toBe(80 * profiles.reduce((a: number, b) => a + b, 0));
  expect(actual.bytes - baseline.bytes).toBeLessThanOrEqual(maxKiB * 1024);
});

it('puts the new geometry on the moving stair gate, not its decorative copy', () => {
  const props = new Props(materialFamily<Materials>());
  const gate = props.group.getObjectByName('S4-stair-gate')!;
  const grille = props.group.getObjectByName('blocked-south-grille')!.children.at(-1)!;
  const body = (o: THREE.Object3D) => (o.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
  expect(triangles(body(gate)) - triangles(body(grille))).toBe(11 * 80);
  expect(gate.position.toArray()).toEqual([DOORS.gate.hinge.x, DOORS.gate.box.y0 ?? 0, -DOORS.gate.hinge.z]);
  const originalGeometry = body(gate);
  const world = newWorld();
  world.repairs.gate = true;
  props.update(world, 1, 0);
  const closed = gate.rotation.y;
  world.doors.gate = true;
  props.update(world, 1, 1);
  expect(gate.rotation.y - closed).toBeCloseTo(Math.PI / 2);
  expect(body(gate)).toBe(originalGeometry);
});

it('preserves the bearing surfaces of the altar, oil table and actual west entry threshold', () => {
  const furniture = buildFurniture(materialFamily<Materials>());
  const landmarks = buildLandmarks(materialFamily<Materials>(), new THREE.Color()).group;
  const top = (group: THREE.Group, x: number, z: number, from: number) => {
    group.updateMatrixWorld(true);
    return new THREE.Raycaster(new THREE.Vector3(x, from, -z), new THREE.Vector3(0, -1, 0))
      .intersectObject(group)[0]?.point.y;
  };
  for (const tag of ['altar', 'flaskTable']) {
    const p = PROPS.find(prop => prop.tag === tag)!;
    const h = p.y0! + p.h;
    expect(top(furniture, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, h + .05)).toBeCloseTo(h, 5);
  }
  // Authored north-gable stone ends up at the western playable opening after the landmark transform.
  expect(top(landmarks, 12.76, 16.5, RAISED_Y + .14)).toBeCloseTo(RAISED_Y + .07, 5);
});

it('does not apply the generic profile again to the already-hewn yard cover', () => {
  const group = new THREE.Group(), batch = new Batch();
  const m = materialFamily<Materials>(), v = materialFamily<Variants>();
  for (const tag of ['cart', 'scaffold', 'crateStack']) {
    addYardProp(batch, PROPS.find(p => p.tag === tag)!, m, v);
  }
  batch.build(group);
  expect(budget(group).faces).toBeGreaterThan(0);
  expect(stock).not.toHaveBeenCalled();
});
