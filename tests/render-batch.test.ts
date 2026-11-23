import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { expect, it } from 'vitest';
import { Batch } from '../src/render/geom';

it('preserves each triangle corner, UV seam, sort sphere and material when keeping shared vertices', () => {
  const box = new THREE.BoxGeometry();
  const sphere = new THREE.SphereGeometry(1, 8, 8);
  const soup = new THREE.PlaneGeometry().toNonIndexed();
  const transform = new THREE.Matrix4().makeRotationY(.57).setPosition(3, -1, 7);
  // Unused position must not pollute the original sphere or its depth sort key.
  const used = new Set(sphere.index!.array);
  const position = sphere.getAttribute('position');
  for (let i = 0; i < position.count; i++) if (!used.has(i)) position.setXYZ(i, 100, 200, -300);
  const baseline = mergeGeometries([box, sphere, soup].map(g => (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(transform)))!;
  const before = box.getAttribute('position').clone().array;
  const material = new THREE.MeshStandardMaterial();
  const batch = new Batch(), group = new THREE.Group();
  for (const geo of [box, sphere, soup]) batch.add(geo, material, transform);
  batch.build(group);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as THREE.Mesh;
  expect(mesh.material).toBe(material);
  expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
  expect(box.getAttribute('position').array).toEqual(before);
  expect(mesh.geometry.index!.count).toBe(baseline.getAttribute('position').count);
  const expanded = mesh.geometry.toNonIndexed();
  for (const attr of ['position', 'normal', 'uv']) expect(expanded.getAttribute(attr).array).toEqual(baseline.getAttribute(attr).array);
  baseline.computeBoundingSphere();
  expect(mesh.geometry.boundingSphere).toEqual(baseline.boundingSphere);
  expect(mesh.geometry.getAttribute('position').count).toBeLessThan(expanded.getAttribute('position').count);
});

it('keeps triangle soup unindexed when an index would add bytes', () => {
  const group = new THREE.Group();
  const batch = new Batch();
  const geometry = new THREE.BoxGeometry().toNonIndexed();
  batch.add(geometry, new THREE.MeshBasicMaterial(), new THREE.Matrix4());
  batch.build(group, false);
  const mesh = group.children[0] as THREE.Mesh;
  expect(mesh.geometry.index).toBe(null);
  expect(mesh.geometry.getAttribute('position').count).toBe(36);
  expect(mesh.castShadow || mesh.receiveShadow).toBe(false);
});
