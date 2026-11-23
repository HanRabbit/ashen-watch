// Coarse masonry occupancy used only as input to the hardware light bake. Keep vertical gaps open.
import { readFileSync } from 'node:fs';

export function outerBaileyOccluders() {
  const glb = readFileSync(new URL('../public/models/rodin/outer-bailey.glb', import.meta.url));
  const headerSize = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.toString('utf8', 20, 20 + headerSize));
  const primitive = doc.meshes[0].primitives[0];
  function array(i, Type, width) {
    const a = doc.accessors[i], v = doc.bufferViews[a.bufferView];
    return new Type(glb.buffer, glb.byteOffset + 28 + headerSize + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * width);
  }
  const position = array(primitive.attributes.POSITION, Float32Array, 3);
  const indices = array(primitive.indices, doc.accessors[primitive.indices].componentType === 5123 ? Uint16Array : Uint32Array, 1);
  const step = 1.25, columns = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const a = 3 * indices[i], b = 3 * indices[i+1], c = 3 * indices[i+2];
    const average = axis => (position[a+axis] + position[b+axis] + position[c+axis]) / 3;
    if (average(1) < 0) continue;
    const x = Math.floor(average(0) / step), z = Math.floor(-average(2) / step), k = `${x},${z}`;
    if (!columns.has(k)) columns.set(k, { x, z, levels: new Set() });
    columns.get(k).levels.add(Math.floor(average(1) / step));
  }
  const boxes = [];
  for (const { x, z, levels } of columns.values()) {
    let box;
    for (const y of [...levels].sort((a,b) => a-b)) {
      if (!box || box.h !== step * y) {
        box = { x0: x*step, x1: (x+1)*step, z0: z*step, z1: (z+1)*step, y0: y*step, h: y*step };
        boxes.push(box);
      }
      box.h += step;
    }
  }
  return boxes;
}
