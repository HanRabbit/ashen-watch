import * as THREE from 'three';

type Point = [number, number, number];
type Axis = 0 | 1 | 2;
interface Surface {
  axis: Axis;
  sign: number;
}
interface ArrisOptions {
  /** Band carrying the long return. Don't drag its normals over the bevel. */
  body: number;
  capBack?: boolean;
  /** Reflecting the resulting geometry needs reversed indices, but not reversed normals. */
  reflected?: boolean;
  creases?: ReadonlySet<number>;
  uv: (point: Point, surface: Surface) => [number, number];
}

/** Loft only the worn rim, not the broad faces. Rings run CCW in XY, back to
 * front in Z. Each cap is planar (it can be raked). UVs keep their face-local
 * projection even where normals are shared; never weld by position globally. */
export function wornArris(rings: Point[][], o: ArrisOptions): THREE.BufferGeometry {
  const rows = rings.map(r => r.map(p => new THREE.Vector3(...p)));
  const last = rows.length - 1, n = rows[0].length;
  const prev = (i: number) => (i + n - 1) % n, next = (i: number) => (i + 1) % n;
  const cross = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    b.clone().sub(a).cross(c.clone().sub(a));
  const bands = rows.slice(0, last).map((r, k) => r.map((a, i) => {
    const j = next(i), b = r[j], c = rows[k + 1][j], d = rows[k + 1][i];
    return cross(a, b, c).add(cross(a, c, d)).normalize();
  }));
  const surface = (normal: THREE.Vector3): Surface => {
    const [x, y, z] = normal.toArray().map(Math.abs);
    const axis = x > y && x > z ? 0 : y > z ? 1 : 2;
    return { axis, sign: Math.sign(normal.getComponent(axis)) };
  };
  const cap = (k: number, direction: number) => {
    const ring = rows[k];
    // The authored outlines are star-shaped about this centre. Fan from the
    // centre rather than a rim vertex: collinear wear stations on the rim
    // still need an edge on the lid, not a degenerate triangle or T-junction.
    const center = ring.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / n);
    const normal = ring.reduce((sum, p, i) => sum.add(cross(center, p, ring[next(i)])), new THREE.Vector3());
    return { center: center.toArray() as Point, normal: normal.normalize().multiplyScalar(direction) };
  };
  const front = cap(last, 1), back = o.capBack ? cap(0, -1) : undefined;
  const around = (band: number, face: number, vertex: number): THREE.Vector3 => {
    const a = bands[band][face];
    const adjacent = face === vertex ? prev(face) : next(face);
    const b = bands[band][adjacent];
    // A kink in the same edge still reads as one hand-worn surface. Do not
    // average across the corners of a cut block or a deliberately broken chip.
    return !o.creases?.has(vertex) && a.dot(b) > 0.85 ? a.clone().add(b).normalize() : a;
  };
  const at = (ring: number, band: number, face: number, vertex: number): THREE.Vector3 => {
    if (ring === last) return front.normal;
    if (ring === o.body || ring === o.body + 1) return around(o.body, face, vertex);
    if (ring === 0 && back) return back.normal;
    if (ring === 0) return around(band, face, vertex);
    return around(ring - 1, face, vertex).clone().add(around(ring, face, vertex)).normalize();
  };
  const pos: number[] = [], uv: number[] = [], normals: number[] = [];
  const tri = (points: Point[], normal: THREE.Vector3[], projection: Surface) => {
    for (const i of o.reflected ? [0, 2, 1] : [0, 1, 2]) {
      pos.push(...points[i]);
      uv.push(...o.uv(points[i], projection));
      normals.push(...normal[i].toArray());
    }
  };
  for (let k = 0; k < last; k++) for (let i = 0; i < n; i++) {
    const j = next(i), a = at(k, k, i, i), b = at(k, k, i, j);
    const c = at(k + 1, k, i, j), d = at(k + 1, k, i, i);
    const projection = surface(bands[k][i]);
    tri([rings[k][i], rings[k][j], rings[k + 1][j]], [a, b, c], projection);
    tri([rings[k][i], rings[k + 1][j], rings[k + 1][i]], [a, c, d], projection);
  }
  const emitCap = (k: number, { center, normal }: ReturnType<typeof cap>, reverse: boolean) => {
    const projection = surface(normal);
    for (let i = 0; i < n; i++) {
      const a = rings[k][i], b = rings[k][next(i)];
      tri([center, reverse ? b : a, reverse ? a : b], [normal, normal, normal], projection);
    }
  };
  emitCap(last, front, false);
  if (back) emitCap(0, back, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

type Profile = [width: number, depth: number, shoulder: number];

/** Worn ends of a straight extrusion, kept inside its stock. Control how much
 * wood or stone is missing at each outline station, independently at each end. */
export function wornPrism(outline: [number, number][], lo: number, hi: number, ends: {
  front: (i: number) => Profile;
  back?: (i: number) => Profile;
}, uv: ArrisOptions['uv']): THREE.BufferGeometry {
  const points = outline.map(([x, y]) => new THREE.Vector2(x, y));
  const stock = points.map((p, i) => {
    const inward = (dir: THREE.Vector2) => new THREE.Vector2(-dir.y, dir.x).normalize();
    const a = inward(p.clone().sub(points[(i + points.length - 1) % points.length]));
    const b = inward(points[(i + 1) % points.length].clone().sub(p));
    const miter = a.clone().add(b).normalize();
    return miter.divideScalar(miter.dot(a));
  });
  const ring = (z: number, cut?: (i: number) => Profile, side = 1, step = 0): Point[] => points.map((p, i) => {
    const [width, depth, shoulder] = cut?.(i) ?? [0, 0, 0];
    const inset = step === 0 ? width : step === 1 ? width * shoulder : 0;
    return [p.x + stock[i].x * inset, p.y + stock[i].y * inset, z - side * depth * (step === 0 ? 0 : step === 1 ? 0.32 : 1)];
  });
  const rings = ends.back ? [ring(lo, ends.back, -1), ring(lo, ends.back, -1, 1), ring(lo, ends.back, -1, 2)] : [ring(lo)];
  rings.push(ring(hi, ends.front, 1, 2), ring(hi, ends.front, 1, 1), ring(hi, ends.front));
  return wornArris(rings, { body: ends.back ? 2 : 0, capBack: true, uv });
}
