#!/usr/bin/env python3
"""Fit and finish AW–B–01 in place of the grey Rodin export (requires NumPy and Pillow).

    python3 tools/pack-oil-flask.py

Defaults to .cache/rodin-production/oil-flask.glb → public/models/rodin/oil-flask.glb.
"""
import argparse
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image


EDGE = 512


def require(test, message):
    if not test:
        raise ValueError(message)


def unpack(source):
    require(len(source) >= 28, 'Truncated GLB')
    magic, version, length, json_length, kind = struct.unpack_from('<4sIII4s', source)
    require((magic, version, length, kind) == (b'glTF', 2, len(source), b'JSON')
            and json_length % 4 == 0 and json_length <= length - 28, 'Invalid GLB header')
    doc = json.loads(source[20:20 + json_length])
    bin_length, kind = struct.unpack_from('<I4s', source, 20 + json_length)
    require(kind == b'BIN\0' and bin_length + json_length + 28 == length and bin_length % 4 == 0,
            'Invalid GLB BIN chunk')
    require(len(doc['buffers']) == 1 and 'uri' not in doc['buffers'][0]
            and 0 <= bin_length - doc['buffers'][0]['byteLength'] <= 3, 'Expected one embedded buffer')
    return doc, memoryview(source)[28 + json_length:]


def read_source(source):
    doc, binary = unpack(source)

    def view(i):
        v = doc['bufferViews'][i]
        start = v.get('byteOffset', 0)
        end = start + v['byteLength']
        require(v['buffer'] == 0 and 0 <= start < end <= doc['buffers'][0]['byteLength'],
                f'Out-of-range buffer view {i}')
        return v, binary[start:end]

    def accessor(i, kind, component, dtype, width):
        a = doc['accessors'][i]
        v, data = view(a['bufferView'])
        require((a['type'], a['componentType']) == (kind, component) and 'sparse' not in a
                and not a.get('normalized') and 'byteStride' not in v, f'Unexpected accessor layout {i}')
        return np.frombuffer(data, dtype, count=a['count'] * width,
                             offset=a.get('byteOffset', 0)).reshape(-1, width)

    [node_id] = doc['scenes'][doc.get('scene', 0)]['nodes']
    node = doc['nodes'][node_id]
    require(not node.keys() & {'matrix', 'rotation', 'scale', 'translation', 'children', 'skin'},
            'Expected one untransformed source mesh')
    [p] = doc['meshes'][node['mesh']]['primitives']
    require(p.get('mode', 4) == 4 and not p.get('extensions'), 'Expected uncompressed indexed triangles')
    attrs = p['attributes']
    pos = accessor(attrs['POSITION'], 'VEC3', 5126, '<f4', 3).astype(np.float64)
    normal = accessor(attrs['NORMAL'], 'VEC3', 5126, '<f4', 3)
    uv = accessor(attrs['TEXCOORD_0'], 'VEC2', 5126, '<f4', 2)
    indices = accessor(p['indices'], 'SCALAR', 5123, '<u2', 1).reshape(-1, 3)
    require(0 < len(indices) <= 6000 and indices.max() < len(pos), 'Invalid index range or triangle budget')
    require(len(pos) == len(normal) == len(uv) > 0 and all(np.isfinite(a).all() for a in (pos, normal, uv)),
            'Missing or nonfinite vertices, normals or UVs')
    require(np.allclose(np.linalg.norm(normal, axis=1), 1.0, atol=1e-4), 'Non-unit vertex normals')
    a, b, c = pos[indices].transpose(1, 0, 2)
    winding = np.cross(b - a, c - a)
    require(((winding * normal[indices].mean(axis=1)).sum(axis=1) > 0).all(),
            'Degenerate faces or winding disagrees with normals')
    a, b, c = uv[indices].transpose(1, 0, 2).astype(np.float64)
    ab, ac = b - a, c - a
    require(0 <= uv.min() <= uv.max() <= 1 and (abs(ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]) > 1e-10).all(),
            'Out-of-range UVs or collapsed UV faces')
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    require(np.allclose(lo, [-.7985, -.9506, -.8045], atol=.002)
            and np.allclose(hi, [.8027, .9503, .7963], atol=.002),
            'Unexpected source bounds; re-check up axis and material mask')

    material = doc['materials'][p['material']]
    pbr = material['pbrMetallicRoughness']
    maps = []
    for entry in (material['normalTexture'], pbr['baseColorTexture'], pbr['metallicRoughnessTexture']):
        require(entry.get('texCoord', 0) == 0 and not entry.get('extensions'), 'Expected untransformed UV0 maps')
        image = doc['images'][doc['textures'][entry['index']]['source']]
        data = view(image['bufferView'])[1]
        with Image.open(io.BytesIO(data)) as png:
            require(image['mimeType'] == 'image/png' and png.format == 'PNG' and png.size == (2048, 2048),
                    'Unexpected source texture format or size')
            maps.append(png.convert('RGB').resize((EDGE, EDGE), Image.Resampling.LANCZOS))
    print(f'Source: {len(indices):,} tris, {len(pos):,} UV-split vertices, 3 × 2048² maps; bounds {lo} → {hi}')
    return pos, normal, uv, indices, maps


def smooth(lo, hi, data):
    t = np.clip((data - lo) / (hi - lo), 0., 1.)
    return t * t * (3. - 2. * t)


def atlas_height(uv, indices, height):
    """Bake object-space height into UV0; extend chart heights to adjacent gutter texels."""
    result = np.full((EDGE, EDGE), np.nan)
    for tri in indices:
        a, b, c = uv[tri].astype(np.float64) * EDGE
        u, v = b - a, c - a
        x0, y0 = np.maximum(0, np.floor(np.minimum(np.minimum(a, b), c)).astype(int))
        x1, y1 = np.minimum(EDGE, 1 + np.ceil(np.maximum(np.maximum(a, b), c)).astype(int))
        y, x = np.mgrid[y0:y1, x0:x1] + .5
        x, y = x - a[0], y - a[1]
        det = u[0] * v[1] - u[1] * v[0]
        s = (x * v[1] - y * v[0]) / det
        t = (y * u[0] - x * u[1]) / det
        hit = (s >= 0) & (t >= 0) & (s + t <= 1)
        h0, h1, h2 = height[tri]
        result[y0:y1, x0:x1][hit] = (h0 + s * (h1 - h0) + t * (h2 - h0))[hit]
    for _ in range(12):
        padded = np.pad(result, 1, constant_values=np.nan)
        for neighbour in (padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:]):
            np.copyto(result, neighbour, where=np.isnan(result))
    return np.nan_to_num(result, nan=.55)


def finish_images(maps, height):
    normal, base, mr = maps
    rgb = np.asarray(base, dtype=float)
    rough = np.asarray(mr, dtype=float)[:, :, 1]
    # Rodin's roughness channel follows the actual cord, not a hue key against the
    # near-neutral vessel. Protect the porous stopper separately by position/color.
    stopper = np.maximum(smooth(.883, .901, height),
                         smooth(.856, .879, height) * smooth(132, 195, rgb[:, :, 0]))
    glass = (1 - smooth(198, 218, rough)) * (1 - stopper)
    oil = 1 - smooth(.482, .509, height)
    # Upper smoked glass vs pooled honey/olive oil. Keep a soft meniscus without a
    # bright baked reflection; preserve only low-amplitude detail in the source glass.
    oil_colour = np.array([117., 73., 33.]) + smooth(.04, .47, height)[..., None] * [12., 8., 2.]
    glass_colour = np.array([99., 94., 81.]) * (1 - oil[..., None]) + oil_colour * oil[..., None]
    luma = rgb @ np.array([.2126, .7152, .0722])
    glass_colour *= (1 + np.clip((luma - 91) / 200, -.19, .16))[..., None]
    # Hemp stays warm and coarse; the cork is pale, muted and distinctly matte.
    hemp = rgb * [.88, .92, .96] + [6., 6., 6.]
    cork = rgb * [.65, .69, .73] + [8., 7., 6.]
    dry = hemp * (1 - stopper[..., None]) + cork * stopper[..., None]
    colour = dry * (1 - glass[..., None]) + glass_colour * glass[..., None]
    # Match the glTF red clearcoat mask / green roughness / blue metalness layout.
    # Coat weight is genuinely zero over hemp/cork; no global transmission or emission.
    dry_rough = np.clip(rough / 255 + .035, .80, .98)
    glass_rough = np.clip(.37 + (rough - 155) / 255, .30, .60)
    packed = np.stack((.72 * glass, dry_rough * (1 - glass) + glass_rough * glass, np.zeros_like(glass)), axis=-1)

    def rgb_image(data):
        return Image.fromarray(np.rint(np.clip(data, 0, 255)).astype(np.uint8))

    images = []
    for name, image, fmt in [('normal', normal, 'JPEG'), ('amber-hemp-cork', rgb_image(colour), 'JPEG'),
                             ('coat-roughness-metalness', rgb_image(packed * 255), 'PNG')]:
        buf = io.BytesIO()
        options = {'quality': 92, 'subsampling': 0} if fmt == 'JPEG' else {'optimize': True}
        image.save(buf, fmt, **options)
        images.append((name, fmt.lower(), buf.getvalue()))
    return images


def pack(source, target):
    pos, normal, uv, indices, maps = read_source(source.read_bytes())
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    extent = hi - lo
    # +Y is already up and +Z shows the main knot. Match the old footprint/height;
    # centre horizontally, and put the lowest contact vertices at exactly Y=0.
    horizontal = .192 / max(extent[0], extent[2])
    scale = np.array([horizontal, .260 / extent[1], horizontal])
    origin = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    pos = ((pos - origin) * scale).astype('<f4')
    normal = normal / scale  # inverse transpose for the minor vertical stretch
    normal = (normal / np.linalg.norm(normal, axis=1)[:, None]).astype('<f4')
    images = finish_images(maps, atlas_height(uv, indices, pos[:, 1] / .260))

    data, views, accessors = bytearray(), [], []

    def add(chunk, target=None):
        data.extend(b'\0' * (-len(data) % 4))
        v = {'buffer': 0, 'byteOffset': len(data), 'byteLength': len(chunk)}
        if target is not None:
            v['target'] = target
        views.append(v)
        data.extend(chunk)
        return len(views) - 1

    for arr, kind, component, target_type in [(pos, 'VEC3', 5126, 34962), (normal, 'VEC3', 5126, 34962),
                                              (uv, 'VEC2', 5126, 34962), (indices.ravel(), 'SCALAR', 5123, 34963)]:
        accessors.append({'bufferView': add(arr.tobytes(), target_type), 'componentType': component,
                          'type': kind, 'count': len(arr)})
    accessors[0].update(min=pos.min(axis=0).tolist(), max=pos.max(axis=0).tolist())
    coat = 'KHR_materials_clearcoat'
    material = {
        'name': 'Oil flask · amber glass / hemp / cork',
        'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1,
                                 'baseColorTexture': {'index': 1}, 'metallicRoughnessTexture': {'index': 2}},
        'normalTexture': {'index': 0, 'scale': .65},
        'extensions': {coat: {'clearcoatFactor': 1, 'clearcoatRoughnessFactor': .32,
                              'clearcoatTexture': {'index': 2}}},
    }
    doc = {
        'asset': {'version': '2.0', 'generator': 'Ashen Watch AW–B–01 / Hyper3D Rodin'},
        'extensionsUsed': [coat], 'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'Corded oil flask'}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2},
                                    'indices': 3, 'material': 0}]}],
        'materials': [material], 'accessors': accessors, 'bufferViews': views,
        'images': [{'name': name, 'mimeType': f'image/{fmt}', 'bufferView': add(img)} for name, fmt, img in images],
        'textures': [{'sampler': 0, 'source': n} for n in range(len(images))],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
    }
    data.extend(b'\0' * (-len(data) % 4))
    doc['buffers'] = [{'byteLength': len(data)}]
    header = json.dumps(doc, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    length = 28 + len(header) + len(data)
    require(length <= 1_000_000, 'Packed oil flask exceeds 1 MB')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(struct.pack('<4sIII4s', b'glTF', 2, length, len(header), b'JSON')
                       + header + struct.pack('<I4s', len(data), b'BIN\0') + data)
    print(f'{target}: {length:,} bytes, {len(indices):,} tris, 3 × {EDGE}² maps, '
          f'foot at Y=0, X/Y/Z {pos.max(axis=0) - pos.min(axis=0)} m')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, nargs='?', default=Path('.cache/rodin-production/oil-flask.glb'))
    parser.add_argument('target', type=Path, nargs='?', default=Path('public/models/rodin/oil-flask.glb'))
    args = parser.parse_args()
    pack(args.source, args.target)
