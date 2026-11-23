import { Box3, Matrix4, type Mesh } from 'three';

/** Subdivide bounds, not the draw: keeps a static batch and its original depth/tie ordering. */
export class SpatialBounds {
  private cells = new Map<string, Box3>();

  constructor(private cellSize: number) {}

  add(bounds: Box3): void {
    const x = Math.floor((bounds.min.x + bounds.max.x) / (2 * this.cellSize));
    const z = Math.floor((bounds.min.z + bounds.max.z) / (2 * this.cellSize));
    const key = `${x},${z}`;
    const cell = this.cells.get(key);
    // Cell assignment is by centre, but bounds include the entire geometry, even across cell edges.
    if (cell) cell.union(bounds);
    else this.cells.set(key, bounds.clone());
  }

  apply(mesh: Mesh): void {
    useStaticFrustumBounds(mesh, [...this.cells.values()]);
  }
}

/** Extra conservative test for geometry without GPU position deformation.
 * The sphere is kept for broad-phase rejection and for the renderer's sort key. */
export function useStaticFrustumBounds(mesh: Mesh, boxes: readonly Box3[]): void {
  if (!boxes.length) return;
  // Leave room for float32 rounding in the GPU's vertex/matrix math at scenery scale.
  const local = boxes.map(box => box.clone().expandByScalar(0.001));
  const world = local.map(() => new Box3());
  const union = new Box3();
  const lastMatrix = new Matrix4();
  let dirty = true;
  const broadPhase = mesh.intersectsFrustum;
  mesh.intersectsFrustum = function (frustum) {
    if (!broadPhase.call(this, frustum)) return false;
    if (dirty || !lastMatrix.equals(this.matrixWorld)) {
      dirty = false;
      lastMatrix.copy(this.matrixWorld);
      union.makeEmpty();
      for (let i = 0; i < local.length; i++) {
        world[i].copy(local[i]).applyMatrix4(lastMatrix);
        union.union(world[i]);
      }
    }
    if (world.length === 1) return frustum.intersectsBox(world[0]);
    if (!frustum.intersectsBox(union)) return false;
    for (const box of world) if (frustum.intersectsBox(box)) return true;
    return false;
  };
}
