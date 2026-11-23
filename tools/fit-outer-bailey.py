"""Fit Rodin's complete open bailey shell to the fortress survey, offline (NumPy).

The original texture coordinates and triangles survive the fit. Survey entries
locate the inside of the second curtain beyond the playable masonry, in sim XZ.
The original northern drum and southern gate receive independent foundation levels.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np

# Azimuth from the original south gate, reference radius, site X, site Z, burial.
SURVEY = [
    (-180, .59, -1.0, 39.6, 2.8), (-160, .60, -5.9, 36.9, 1.6),
    (-142, .68, -8.1, 31.4, 5.2), (-129, .66, -14.1, 28.8, 3.8),
    (-118, .65, -18.9, 26.0, .2), (-105, .63, -19.3, 21.6, 1.9),
    (-89, .63, -17.4, 15.6, 3.0), (-78, .67, -17.3, 10.2, 4.3),
    (-66, .75, -18.9, 7.2, 3.0), (-55, .82, -20.0, 4.1, .15),
    (-45, .87, -18.4, 1.0, 2.0), (-36, .90, -15.4, -.3, 4.5),
    (-24, .86, -10.3, -2.3, 4.6), (-13, .81, -6.8, -7.5, 2.7),
    (0, .75, -.4, -11.0, 2.3), (20, .75, 7.1, -8.0, 2.4),
    (40, .86, 13.9, -1.5, 5.8), (62, .75, 19.4, 6.2, 6.6),
    (82, .69, 32.6, 9.4, 3.3), (98, .72, 34.5, 17.1, 3.0),
    (115, .71, 32.1, 25.3, 5.3), (129, .79, 21.2, 27.8, 5.5),
    (146, .67, 11.8, 31.5, 5.1), (163, .56, 7.5, 37.1, 4.3),
]
cage = np.array(SURVEY, dtype=float)
angles = cage[:, 0]
base_scale = 18.0
azimuth = np.radians(angles)
# Interpolate displacements, leaving local buttress profiles, reveals and tower curvature intact.
shifts = np.column_stack((cage[:, 2] - base_scale * cage[:, 1] * np.sin(azimuth),
                          -cage[:, 3] - base_scale * cage[:, 1] * np.cos(azimuth), cage[:, 4]))

def fit(p):
    angle = np.degrees(np.arctan2(p[:, 0], p[:, 2]))
    dx, dz, burial = (np.interp(angle, angles, channel, period=360) for channel in shifts.T)
    y = (p[:, 1] + .355) * 15.8 - 1.38 - burial
    return np.column_stack((base_scale * p[:, 0] + dx, y, base_scale * p[:, 2] + dz))

def write_fitted(source, target):
    data = source.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length]); binary = bytearray(data[28 + length:])
    prim, = doc['meshes'][0]['primitives']
    def attribute(name):
        acc = doc['accessors'][prim['attributes'][name]]; view = doc['bufferViews'][acc['bufferView']]
        assert acc['componentType'] == 5126 and acc['type'] == 'VEC3' and 'byteStride' not in view
        return acc, np.frombuffer(binary, '<f4', acc['count'] * 3, view.get('byteOffset', 0) + acc.get('byteOffset', 0)).reshape(-1, 3)
    accessor, pos = attribute('POSITION'); _, normal = attribute('NORMAL')
    original = pos.astype(float); pos[:] = fit(original)
    # Inverse-transpose the original normals, preserving the authored shading across UV seams.
    eps = 1e-5
    jacobian = np.stack([(fit(original + e) - fit(original - e)) / (2*eps) for e in np.eye(3)*eps], axis=-1)
    normals = np.linalg.solve(jacobian.swapaxes(1, 2), normal[..., None])[..., 0]
    normal[:] = normals / np.maximum(1e-12, np.linalg.norm(normals, axis=1, keepdims=True))
    assert np.isfinite(pos).all() and np.isfinite(normal).all() and np.linalg.det(jacobian).min() > 0
    accessor.update(min=pos.min(axis=0).tolist(), max=pos.max(axis=0).tolist())
    header = json.dumps(doc, separators=(',', ':')).encode(); header += b' ' * (-len(header) % 4)
    target.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(header) + len(binary), len(header), 0x4E4F534A)
                       + header + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
    print('outer bailey:', len(pos), 'vertices, bounds', accessor['min'], accessor['max'])

if __name__ == '__main__':
    write_fitted(*map(Path, sys.argv[1:]))
