import * as THREE from 'three';
import type { Box } from '../sim/level';

const smooth = THREE.MathUtils.smoothstep;
const tooth = (y: number, centre: number, span: number) => Math.max(0, 1 - Math.abs(y - centre) / span);

// +Z is the carved face of this specific GLB. Work in its original metres so
// that only the split perimeter and the old bedding behind the figure move.
function fracture(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const rift = Math.max(-.365, y - .845);
  const left = (.045 * tooth(y, .421, .077) + .086 * tooth(y, .619, .135) + .060 * tooth(y, .827, .075))
    * (1 - smooth(x - rift, 0, .20 - .31 * (z + .06)));
  const right = (.047 * tooth(y, -.49, .16) + .087 * tooth(y, .035, .13) + .036 * tooth(y, .63, .11))
    * smooth(x, .19, .36);
  const snap = .063 * smooth(y, .765, .941) * smooth(x, .214, .357);
  const back = 1 - smooth(z, -.145, -.067);
  const bedding = y + .33 * x + .029 * Math.sin(17 * x + 5 * y);
  // Two levels of torn bed, not a separate skin. Broad planes remain between
  // fracture steps; the low-frequency facets end at the worn carved arris.
  const ledge = smooth(bedding, -.13, -.045) * (1 - smooth(bedding, .45, .62));
  const remnant = 1 - smooth(bedding - .19 * x, -.64, -.51);
  const split = .020 * Math.sin(10 * y + 13 * x) + .014 * Math.sin(18 * y - 9 * x);
  return out.set(x + left - right, y - snap, z - back * (.044 + .110 * ledge + .065 * remnant + split));
}

/** Refine the coarse plane of the GLB before disturbing it. Shared edges always
 * use the same midpoint (also across split UV islands); short carved edges stay
 * as authored. No caps, cutout alpha or front/back overlays. */
function refine(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const pp = source.getAttribute('position');
  const nn = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const positions = Array.from({ length: pp.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pp, i));
  const normals = Array.from({ length: nn.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(nn, i));
  const uvs = Array.from({ length: uv.count }, (_, i) => new THREE.Vector2(uv.getX(i), uv.getY(i)));
  const triangles: number[] = [];
  const midpoints = new Map<number, Map<number, number>>();
  const mid = (a: number, b: number) => {
    if (a > b) [a, b] = [b, a];
    let row = midpoints.get(a);
    if (!row) midpoints.set(a, row = new Map());
    const existing = row.get(b);
    if (existing !== undefined) return existing;
    const id = positions.length;
    row.set(b, id);
    positions.push(positions[a].clone().lerp(positions[b], .5));
    normals.push(normals[a].clone().lerp(normals[b], .5));
    uvs.push(uvs[a].clone().lerp(uvs[b], .5));
    return id;
  };
  function face(a: number, b: number, c: number): void {
    const ab = positions[a].distanceToSquared(positions[b]);
    const bc = positions[b].distanceToSquared(positions[c]);
    const ca = positions[c].distanceToSquared(positions[a]);
    const longest = Math.max(ab, bc, ca);
    if (longest <= .069 ** 2) { triangles.push(a, b, c); return; }
    if (longest === bc) [a, b, c] = [b, c, a];
    else if (longest === ca) [a, b, c] = [c, a, b];
    const m = mid(a, b);
    face(a, m, c);
    face(m, b, c);
  }
  const index = source.index;
  const at = (i: number) => index ? index.getX(i) : i;
  for (let i = 0; i < (index?.count ?? pp.count); i += 3) face(at(i), at(i + 1), at(i + 2));

  const pos = new Float32Array(3 * positions.length), nor = new Float32Array(pos.length);
  const coords = new Float32Array(2 * positions.length), carving = new Float32Array(positions.length);
  const origin = new THREE.Vector3(), tx = new THREE.Vector3(), ty = new THREE.Vector3(), tz = new THREE.Vector3();
  const jacobian = new THREE.Matrix3();
  for (let i = 0; i < positions.length; ++i) {
    const { x, y, z } = positions[i];
    const n = normals[i].normalize();
    carving[i] = smooth(z, -.104, -.038) * smooth(n.z, .04, .66);
    fracture(x, y, z, origin).toArray(pos, i * 3);
    // Carry the sculpt's smooth normals through the deformation, including at
    // atlas seams. The derivative is central so it remains stable at a step.
    const e = .0005;
    fracture(x + e, y, z, tx).sub(fracture(x - e, y, z, origin)).multiplyScalar(.5 / e);
    fracture(x, y + e, z, ty).sub(fracture(x, y - e, z, origin)).multiplyScalar(.5 / e);
    fracture(x, y, z + e, tz).sub(fracture(x, y, z - e, origin)).multiplyScalar(.5 / e);
    jacobian.set(tx.x, ty.x, tz.x, tx.y, ty.y, tz.y, tx.z, ty.z, tz.z).invert().transpose();
    n.applyMatrix3(jacobian).normalize().toArray(nor, i * 3);
    uvs[i].toArray(coords, i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(triangles);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(coords, 2));
  g.setAttribute('reliefCarving', new THREE.BufferAttribute(carving, 1));
  return g;
}

/** The decoded source is cached; only the mounted clone gets new geometry. */
export function fractureRelief(model: THREE.Group): { mesh: THREE.Mesh; atlas: THREE.MeshStandardMaterial } {
  // This GLB ships as one static, UV-mapped mesh at the scene origin. Refuse
  // an incompatible replacement rather than removing the mounted fallback.
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  const mesh = meshes[0];
  if (meshes.length !== 1 || Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial)
      || !['position', 'normal', 'uv'].every(name => mesh.geometry.hasAttribute(name))) {
    throw new Error('Unexpected pilgrim-relief mesh layout');
  }
  mesh.geometry = refine(mesh.geometry);
  return { mesh, atlas: mesh.material };
}

/** A plain snapped ashlar fragment if the carved asset cannot load. */
export function reliefBlank(finish: THREE.Material): THREE.Group {
  const points = [[-.29, -.88], [.23, -.925], [.343, -.797], [.337, -.42], [.297, -.31],
    [.329, -.18], [.31, .47], [.23, .57], [.288, .8], [.168, .88], [.022, .806],
    [-.08, .61], [-.134, .58], [-.208, .4], [-.33, .3], [-.289, .095], [-.314, -.06], [-.28, -.43]];
  const rim = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const source = new THREE.ExtrudeGeometry(rim, { depth: .184, bevelThickness: .034, bevelSize: .027, bevelSegments: 1 });
  source.translate(0, 0, -.127);
  const mesh = new THREE.Mesh(refine(source), finish);
  source.dispose();
  const model = new THREE.Group();
  model.name = 'pilgrim-relief-fallback';
  model.add(mesh);
  return model;
}

/** Tilt onto the snapped jamb edge (towards the gate), fit the visible mass to
 * the existing cover box, then locate a second bearing under the rearward lip.
 * Both render paths share this envelope without changing collision/LOS. */
export function seatRelief(model: THREE.Group, p: Box): { contact: THREE.Vector3; bounds: THREE.Box3 } {
  const grade = p.y0 ?? 0;
  model.rotation.set(-.34, -.065, 1.17, 'YXZ');
  model.scale.setScalar(1.06);
  const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
  const safe = .017;
  // Fit along the cover box axes, not along the already tilted sculpture axes.
  model.matrix.premultiply(new THREE.Matrix4().makeScale(
    Math.min(1, (p.x1 - p.x0 - 2 * safe) / size.x),
    Math.min(1, (p.h - grade - safe) / size.y),
    Math.min(1, (p.z1 - p.z0 - 2 * safe) / size.z),
  ));
  model.matrixAutoUpdate = false;
  model.matrixWorldNeedsUpdate = true;
  const bounds = new THREE.Box3().setFromObject(model, true);
  const middle = bounds.getCenter(new THREE.Vector3());
  model.matrix.setPosition((p.x0 + p.x1) * .5 - middle.x, grade - .043 - bounds.min.y,
    -(p.z0 + p.z1) * .5 - middle.z);
  model.matrixWorldNeedsUpdate = true;
  model.updateMatrixWorld(true);
  bounds.setFromObject(model, true);

  const contact = new THREE.Vector3(0, Infinity, 0);
  const vertex = new THREE.Vector3();
  model.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      // The west end sits high. Take the underside slightly west of centre,
      // behind the carved face, so the bearing isn't displayed as a stand.
      const s = (vertex.x - bounds.min.x) / (bounds.max.x - bounds.min.x);
      if (s > .21 && s < .44 && vertex.z < (bounds.min.z + bounds.max.z) / 2 && vertex.y < contact.y) contact.copy(vertex);
    }
  });
  if (!Number.isFinite(contact.y) || contact.y < grade + .035 || contact.y > grade + .34) {
    throw new Error('No stable bearing under pilgrim-relief');
  }
  return { contact, bounds };
}
