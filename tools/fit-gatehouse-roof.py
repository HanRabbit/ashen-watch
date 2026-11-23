#!/usr/bin/env python3
"""Build the production roof in world metres (requires NumPy and ImageMagick 7).

    python3 tools/fit-gatehouse-roof.py

The source is intentionally untracked. Fit the generated slate and outer oak
only; use a new thin pitched back/liner at the old room envelope, not the
exported interior rafters, jack rafters, or the underside of the source sarking.
"""
import argparse
import io
import json
from pathlib import Path
import struct
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSET = 'gatehouse-roof.glb'
NAMES = ('GatehouseSlate', 'GatehouseOuterOak', 'GatehouseSoffit')
MAX_TRIANGLES = 20000


class Source:
    def __init__(self, path):
        data = path.read_bytes()
        magic, version, length, size, tag = struct.unpack_from('<4sIII4s', data)
        if (magic, version, length, tag) != (b'glTF', 2, len(data), b'JSON'):
            raise ValueError('Expected the original Rodin GLB')
        self.doc = json.loads(data[20:20 + size])
        self.bin = memoryview(data)[28 + size:]
        self.views = self.doc['bufferViews']
        # This export has a single centring translation and identity mesh nodes.
        # Register in the surveyed pre-centring coordinates, not viewer space.
        nodes = self.doc['nodes']
        [root_id] = self.doc['scenes'][self.doc['scene']]['nodes']
        root = nodes[root_id]
        assert set(root) == {'name', 'translation', 'children'}
        assert np.allclose(root['translation'], [0, -0.98419386, 0])
        assert all(set(nodes[i]) == {'name', 'mesh'} for i in root['children'])
        self.meshes = [self.doc['meshes'][nodes[i]['mesh']] for i in root['children']]
        assert len(self.meshes) == 87
        self.swatches = []
        for material in self.doc['materials']:
            tex = self.doc['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
            image = self.doc['images'][tex['source']]
            view = self.views[image['bufferView']]
            offset = view.get('byteOffset', 0)
            payload = self.bin[offset:offset + view['byteLength']]
            self.swatches.append(srgb_to_linear(pixels('png:-', 256, payload=payload) / 255))
        assert len(self.swatches) == 10

    def read(self, idx):
        acc = self.doc['accessors'][idx]
        view = self.views[acc['bufferView']]
        assert 'byteStride' not in view and 'sparse' not in acc
        dtype = {5126: '<f4', 5123: '<u2'}[acc['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[acc['type']]
        return np.frombuffer(self.bin, dtype, acc['count'] * width,
                             acc.get('byteOffset', 0) + view.get('byteOffset', 0)).reshape(-1, width)

    def parts(self, mesh):
        for p in mesh['primitives']:
            attr = p['attributes']
            xyz, normal, uv = (self.read(attr[name]).astype(float) for name in ('POSITION', 'NORMAL', 'TEXCOORD_0'))
            idx = self.read(p['indices']).ravel() if 'indices' in p else np.arange(len(xyz))
            yield xyz, normal, uv, idx.reshape(-1, 3), p['material']


def pixels(path, size, crop=None, payload=None):
    cmd = ['magick', str(path)]
    if crop:
        cmd += ['-crop', crop, '+repage']
    cmd += ['-resize', f'{size}x{size}!', '-alpha', 'off', '-depth', '8', 'rgb:-']
    return np.frombuffer(subprocess.check_output(cmd, input=payload), 'u1').reshape(size, size, 3)


def srgb_to_linear(srgb):
    return np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)


def bake_color(texture, uv, material):
    edge = len(texture)
    st = (uv % 1) * edge - .5
    base = np.floor(st).astype(int)
    s, t = (st - base).T[:, :, None]
    i, j = (base % edge).T
    k, l = ((base + 1) % edge).T
    color = ((1 - s) * texture[j, i] + s * texture[j, k]) * (1 - t) + ((1 - s) * texture[l, i] + s * texture[l, k]) * t
    if material < 5:
        # Reject the source's yellow-green lichen paint; keep a quiet shift in value/hue.
        color = color * .48 + np.mean(color, axis=1, keepdims=True) * .52 if material == 4 else color
        return color * [1.30, 1.25, 1.19]
    return color * [1.33, 1.32, 1.34]


def ramp(z, start, stop):
    return np.clip((z - start) / (stop - start), 0, 1)


def fit(pos):
    x, y, z = np.asarray(pos).T
    # Main cap: 3.60 eave / 5.70 ridge. Compress the unusually tall source
    # cross roof; gently lift the last apron course to clear the 4.20 curtain.
    crest = ramp(z, 1.05, 2.81)
    crest = crest * crest * (3 - 2 * crest)
    apron = ramp(z, 3.30, 4.80)
    base = 3.60 + .61 * apron
    y = base + (5.72 + .05 * crest - base) / (1.37 + .84 * crest) * y
    # A narrow raised saddle keeps the existing 28 cm ridge purlin (y=5.66)
    # under cover, even at the dip between the main and transverse pitches.
    # Seat heights were surveyed at x=±.15 on the fitted weather skin; the
    # remap is monotone, holds the crown, and fades out before the open valleys.
    seat = np.interp(z, [-5, -3, -1, 0, 1.05, 1.35, 1.65, 1.95, 2.4, 2.85, 3.3, 4.5, 4.88],
                        [5.63, 5.60, 5.57, 5.55, 5.54, 5.45, 5.30, 5.36, 5.45, 5.49, 5.51, 5.59, 5.60])
    inset = 1 - ramp(np.abs(x), .16, 1.08)
    inset = inset * inset * (3 - 2 * inset)
    rise = np.clip(np.minimum((y - 4.66) / (seat - 4.66), (5.845 - y) / (5.845 - seat)), 0, 1)
    y += inset * rise * (5.712 - seat)
    # Actual exterior walls: x +/-3.50, rear z=-8.50, courtyard wall z=[0,.50].
    # Reserve the frontmost offset to keep the apron / gable out of the masonry.
    front = np.interp(z, [-5.075, -5, 3.30, 4.50, 4.80, 4.88, 5.07],
                      [-9.055, -8.98, -1.10, .02, .52, .66, .985])
    # +source Z was identified from Courtyard | tie beam and king post.
    # Three world north is -Z; reverse triangle winding when writing meshes.
    return np.column_stack((x * .995, y, -front))


def unit(v):
    return v / np.maximum(1e-12, np.linalg.norm(v, axis=-1, keepdims=True))


def face_cross(p):
    return np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])


def slope_direction(name):
    if name.startswith(('Courtyard shoulder', 'Apron centre')):
        return np.array([0., 1.])
    if name.startswith('Shoulder rear pitch'):
        return np.array([0., -1.])
    if name.startswith('Foregable rear hip'):
        return np.array([0., -1.])
    return np.array([-1. if name.startswith('West') else 1., 0.])


class Batch:
    def __init__(self):
        self.points = []
        self.normals = []
        self.uvs = []
        self.colors = []
        self.indices = []
        self.size = 0

    def add(self, p, n, uv, c, t):
        t = t[np.linalg.norm(face_cross(p[t]), axis=1) > 2e-8]
        if not len(t):
            return
        ids, remap = np.unique(t, return_inverse=True)
        for out, data in zip((self.points, self.normals, self.uvs, self.colors), (p, n, uv, c)):
            out.append(data[ids])
        self.indices.append(remap.reshape(-1, 3) + self.size)
        self.size += len(ids)

    def flat(self, p, tint, uv):
        p = np.asarray(p, dtype=float)
        t = np.arange(len(p)).reshape(-1, 3)
        normal = np.repeat(unit(face_cross(p[t])), 3, axis=0)
        color = np.broadcast_to(srgb_to_linear(np.array(tint)/255), p.shape)
        self.add(p, normal, uv, color, t)


def section_triangles(p, n, uv, indices):
    """Cut long sarking faces at the registration bands before warping.

    Short individual tiles already sample the warp. The sheets below them can
    span several metres; moving just their corners cuts through the courses.
    """
    vertices = np.column_stack((p, n, uv))
    bands = (-1., 0., 1.05, 1.48, 1.92, 2.36, 2.81, 3.30, 3.88, 4.50, 4.80, 4.88)

    def clip(poly, z, sign):
        q = []
        for a, b in zip(poly, poly[1:] + poly[:1]):
            da, db = sign*(a[2]-z), sign*(b[2]-z)
            if da >= 0:
                q.append(a)
            if da * db < 0:
                q.append(a + (b-a)*(da/(da-db)))
        return q

    split = []
    for tri in vertices[indices]:
        lo, hi = tri[:, 2].min(), tri[:, 2].max()
        poly = list(tri)
        near_ridge = tri[:, 0].min() < 1.08 and tri[:, 0].max() > -1.08
        for z in bands:
            if (z >= 1.05 or near_ridge) and lo + 1e-6 < z < hi - 1e-6:
                part = clip(poly, z, -1)
                split.extend([part[0], part[i], part[i+1]] for i in range(1, len(part)-1))
                poly = clip(poly, z, 1)
        split.extend([poly[0], poly[i], poly[i+1]] for i in range(1, len(poly)-1))
    points = np.asarray(split).reshape(-1, 8)
    return points[:, :3], unit(points[:, 3:6]), points[:, 6:], np.arange(len(points)).reshape(-1, 3)


def source_shell(src, batches):
    backing = []
    for mesh in src.meshes:
        name = mesh['name']
        # The imported rafters and deep valley bearings would replace the old room.
        if name.startswith(('Inside |', 'Foregable |')):
            continue
        is_backing = 'sarking' in name
        for p, n, uv, t, mat in src.parts(mesh):
            cross = unit(face_cross(p[t]))
            top = cross[:, 1] > .06
            if mat < 5:
                # Keep real top caps and exposed downhill laps, not the buried
                # tile bottoms, uphill rims or internal sides of every slat.
                rim = np.abs(cross[:, 1]) <= .06
                if not name.startswith('Ridge |'):
                    rim &= cross[:, [0, 2]] @ slope_direction(name) > .969
                t = t[top | rim]
            elif is_backing:
                t = t[top]
            if not len(t):
                continue
            if is_backing or name.startswith('Eave | longitudinal'):
                p, n, uv, t = section_triangles(p, n, uv, t)
            q = fit(p)
            jac = np.stack([(fit(p + d) - fit(p - d)) / (2e-5) for d in np.eye(3)*1e-5], axis=-1)
            if not (np.linalg.det(jac).max() < 0):
                raise ValueError(f'Fit folded or clamped a part of {name}')
            normal = unit(np.linalg.solve(jac.swapaxes(1, 2), n[..., None])[..., 0])
            t = t[:, [0, 2, 1]]
            color = bake_color(src.swatches[mat], uv, mat)
            if is_backing:
                # Only the upper face between tiles survives; keep it dark and
                # close to the slates, not a second room ceiling.
                backing.append(q[t])
                q[:, 1] -= .014
                color *= .55
            if mat < 5:
                # Roof tile microtexture contains no stamped joints; the visible
                # courses still come from the mesh. Use regular world density.
                # Blend the wall component in so that thin split edges have UV area.
                uv = np.column_stack((q[:, 0] + q[:, 1]*.63, q[:, 2] + q[:, 1]*.31)) / .30
            elif mat == 9:
                # End grain color stays baked; stretch the scan less on cuts.
                uv = uv * [.6, .25]
            else:
                uv = uv * [1.4, .43]
            batches[0 if mat < 5 else 1].add(q, normal, uv, color, t)
    return np.vstack(backing)


def height_at(tri, x, z):
    """Vertical intersection of the skin, sampled offline only."""
    p = tri[:, 0]; a = tri[:, 1] - p; b = tri[:, 2] - p
    dx, dz = x - p[:, 0], z - p[:, 2]
    det = a[:, 0]*b[:, 2] - a[:, 2]*b[:, 0]
    ok = np.abs(det) > 1e-10
    u = (dx*b[:, 2] - dz*b[:, 0]) / np.where(ok, det, 1.)
    v = (dz*a[:, 0] - dx*a[:, 2]) / np.where(ok, det, 1.)
    hits = ok & (u >= -1e-5) & (v >= -1e-5) & (u + v <= 1.00001)
    return np.max(p[hits, 1] + a[hits, 1]*u[hits] + b[hits, 1]*v[hits], initial=-np.inf)


def add_room_lining(room, oak, skin):
    # New opaque pitched liner below the weather skin, not a flat lid at eave
    # height. Original bottom y=4.62 + pitch*(1.95-|x|) - .08/cos(angle).
    # Retain the old section except where the generated cross roof needs relief.
    xs = np.linspace(-3.52, 3.52, 33)
    zs = np.array([-8.25, -5, -3.5, -2.7, -2.2, -1.8, -1.5, -1.25, -1., -.80, -.60, -.40, -.20, 0, .29])
    bottom = 4.62 + (1.95 - np.abs(xs))*2/3.9 - .08*np.hypot(3.9, 2)/3.9
    levels = []
    for z in zs:
        # Lower by at most the local cross-pitch relief, keeping the thin
        # sarking/liner separation and the low edge out of the occupied room.
        cap = [max(height_at(skin, x, -z), height_at(skin, x, -z + .018),
                   height_at(skin, x, -z - .018)) for x in xs]
        levels.append(np.maximum(3.57, np.minimum(bottom, np.where(np.isfinite(cap), cap, bottom) - .12)))
    levels = np.array(levels)

    def quad(a, b, c, d, tint, plane, batch=room):
        p = np.asarray([a, b, c, a, c, d], dtype=float)
        uv = p[:, plane] / ([.16, .81] if plane == (0, 2) else [.16, -.81])
        batch.flat(p, tint, uv)

    def at(i, j):
        return xs[i], levels[j, i], -zs[j]

    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            a, b, c, d = at(i, j), at(i+1, j), at(i+1, j+1), at(i, j+1)
            # No extra planks/rafters at player height; variation only across the
            # visible underside. Orient the exposed liner toward the room.
            shade = ((i*23+1) % 9) - 4
            quad(a, d, c, b, (91+shade, 72+shade, 56+shade), (0, 2))
        for i, seq in [(0, [j+1, j]), (-1, [j, j+1])]:
            a, b = (at(i, k) for k in seq)
            quad(a, b, (b[0], 3.57, b[2]), (a[0], 3.57, a[2]), (74, 59, 46), (2, 1))

    # Caps close the original end-wall thickness at the old gable lines.
    # Span an extra 30 mm into the masonry so shadows cannot leak at the join.
    for j, base, outside in [(0, 3.57, 8.48), (-1, 4.17, -.495)]:
        for i in range(len(xs) - 1):
            def cap(k):
                x, y, z = at(k, j)
                return x, max(base, y + .025), z
            a, b = (cap(k) for k in ([i, i+1] if j == 0 else [i+1, i]))
            c, d = (b[0], base, b[2]), (a[0], base, a[2])
            quad(a, b, c, d, (79, 64, 51), (0, 1))
            # Room-facing cap uses the opposite winding on the inner face. The
            # exterior end is near the existing outer wall plane, not the roof edge.
            quad((a[0], a[1], outside), (d[0], d[1], outside), (c[0], c[1], outside),
                 (b[0], b[1], outside), (82, 68, 53), (0, 1))
            top_a, top_b = (a[0], a[1], outside), (b[0], b[1], outside)
            quad(a, top_a, top_b, b, (74, 59, 46), (0, 2))

    # Black oak in the narrow open joints in the generated front panel; no
    # false window in the cross-gable above the playable gate/window wall.
    a, b, c = fit([[-2.11, .006, 4.86], [0., 2.10, 4.86], [2.11, .006, 4.86]])
    p = np.array([a, b, c])
    oak.flat(p, (60, 52, 43), p[:, [0, 1]] / [.16, -.81])


def microtexture(scan, slot, crop, edge, kind):
    # One unjointed part of a scan, mirrored in both axes. Reflect the
    # tangent directions too so the normal field matches the mirrored grain.
    pix = pixels(ROOT / 'public/textures' / f'{scan}_{slot}.jpg', edge//2, crop).astype(float)
    if slot == 'diff':
        mono = pix @ [.2126, .7152, .0722]
        strength = .55 if kind == 'slate' else .93
        values = np.clip((mono - np.mean(mono))*strength + 239, 187, 255)
        pix = np.repeat(values[:, :, None], 3, axis=-1)
    elif slot == 'rough':
        mono = pix[:, :, 0]
        green = np.clip((mono - np.mean(mono))*.65 + (188 if kind == 'slate' else 227), 144, 247)
        pix = np.stack([np.full_like(green, 255), green, np.zeros_like(green)], axis=-1)
    elif slot == 'nor':
        n = pix/127.5 - 1
        n[:, :, :2] -= n[:, :, :2].mean(axis=(0, 1), keepdims=True)
        # Avoid normal discontinuities at the reflected seams.
        a = ramp(np.minimum(np.arange(edge//2), np.arange(edge//2)[::-1]), 0, 4)
        n[:, :, 0] *= a[None, :] * .66
        n[:, :, 1] *= a[:, None] * .66
        pix = (unit(n) + 1) * 127.5
    right = pix[:, ::-1].copy()
    if slot == 'nor':
        right[:, :, 0] = 255 - right[:, :, 0]
    top = np.concatenate((pix, right), axis=1)
    lower = top[::-1].copy()
    if slot == 'nor':
        lower[:, :, 1] = 255 - lower[:, :, 1]
    raw = np.rint(np.concatenate((top, lower), axis=0)).astype('u1')
    return subprocess.check_output(['magick', '-size', f'{edge}x{edge}', '-depth', '8', 'rgb:-', '-strip',
                                    '-sampling-factor', '4:4:4', '-quality', '91', 'jpeg:-'], input=raw.tobytes())


def write_model(target, batches):
    doc = dict(asset={'version': '2.0', 'generator': 'Ashen Watch / AW-A-02 offline fitted roof'}, scene=0,
               scenes=[{'nodes': [0, 1, 2]}], nodes=[], meshes=[], materials=[], textures=[],
               samplers=[dict(wrapS=10497, wrapT=10497, magFilter=9729, minFilter=9987)],
               images=[], bufferViews=[], accessors=[])
    stream = io.BytesIO()

    def view(payload, target=None):
        stream.write(b'\0' * (-stream.tell() % 4))
        idx = len(doc['bufferViews'])
        doc['bufferViews'].append(dict(buffer=0, byteOffset=stream.tell(), byteLength=len(payload)))
        if target:
            doc['bufferViews'][-1]['target'] = target
        stream.write(payload)
        return idx

    def attr(arr, typ, component, target=34962, normalized=False, bounds=False):
        idx = len(doc['accessors'])
        obj = dict(bufferView=view(arr.tobytes(), target), componentType=component, count=len(arr), type=typ)
        if normalized:
            obj['normalized'] = True
        if bounds:
            obj.update(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        doc['accessors'].append(obj)
        return idx

    for kind, scan, crop, edge in [('slate', 'roof_slates_02', '46x52+1630+1456', 128),
                                    ('oak', 'weathered_planks', '82x306+535+350', 256)]:
        for slot in ['diff', 'nor', 'rough']:
            im = microtexture(scan, slot, crop, edge, kind)
            doc['textures'].append(dict(sampler=0, source=len(doc['images'])))
            doc['images'].append(dict(name=f'{kind}-{slot}-{edge}', bufferView=view(im), mimeType='image/jpeg'))
    for name, first in [('Fissile slate', 0), ('Weathered oak', 3)]:
        doc['materials'].append(dict(name=name, pbrMetallicRoughness=dict(baseColorTexture=dict(index=first),
            metallicFactor=0, roughnessFactor=1., metallicRoughnessTexture=dict(index=first+2)),
            normalTexture=dict(index=first+1, scale=.68 if first == 0 else .56)))

    pos, tris = [], 0
    for i, (name, batch) in enumerate(zip(NAMES, batches)):
        c = np.rint(np.clip(np.vstack(batch.colors), 0, 1) * 255)
        vertices = np.column_stack(tuple(np.vstack(f) for f in (batch.points, batch.normals, batch.uvs)) + (c,))
        _, keep, remap = np.unique(np.round(vertices, 6), axis=0, return_index=True, return_inverse=True)
        packed = vertices[keep]
        p, n, uv = (packed[:, a:b].astype('<f4') for a, b in [(0, 3), (3, 6), (6, 8)])
        c = packed[:, 8:].astype('u1')
        t = remap[np.vstack(batch.indices)]
        t = t[np.linalg.norm(face_cross(p[t]), axis=1) > 2e-8]
        assert len(p) <= 65535 and np.isfinite(p).all() and np.isfinite(n).all()
        doc['nodes'].append(dict(mesh=i, name=name))
        doc['meshes'].append(dict(name=name, primitives=[dict(indices=attr(t.astype('<u2').ravel(), 'SCALAR', 5123, 34963),
            material=min(i, 1), attributes=dict(POSITION=attr(p, 'VEC3', 5126, bounds=True), NORMAL=attr(n, 'VEC3', 5126),
                                              TEXCOORD_0=attr(uv, 'VEC2', 5126), COLOR_0=attr(c, 'VEC3', 5121, normalized=True)))]))
        tris += len(t)
        pos.append(p)
        print(f'{name}: {len(t):,} tris, {len(p):,} vertices')
    p = np.vstack(pos)
    low, high = p.min(axis=0), p.max(axis=0)
    if not (15000 <= tris <= MAX_TRIANGLES and np.all(low > [-4.04, 3.46, -1.03]) and np.all(high < [4.04, 5.84, 9.09])):
        raise ValueError(f'Roof outside production budget/envelope: {tris} triangles, {low} .. {high}')
    stream.write(b'\0' * (-stream.tell() % 4))
    payload = stream.getvalue()
    doc['buffers'] = [dict(byteLength=len(payload))]
    header = json.dumps(doc, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(header) + len(payload), len(header), 0x4E4F534A)
                       + header + struct.pack('<I4s', len(payload), b'BIN\0') + payload)
    print(f'{target.name}: {tris:,} tris / 3 draws / 2 PBR materials / 6 JPEGs / {target.stat().st_size:,} bytes')
    print('Three world bounds:', low, high, 'size:', high - low)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, nargs='?', default=ROOT / '.cache/rodin-production' / ASSET)
    parser.add_argument('target', type=Path, nargs='?', default=ROOT / 'public/models/rodin' / ASSET)
    args = parser.parse_args()
    batches = [Batch() for _ in NAMES]
    skin = source_shell(Source(args.source), batches)
    add_room_lining(batches[2], batches[1], skin)
    write_model(args.target, batches)


if __name__ == '__main__':
    main()
