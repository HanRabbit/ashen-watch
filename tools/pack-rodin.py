"""Pack original Rodin PBR GLBs with web-sized textures. Requires ImageMagick 7.

Rebuild only the collision-fitted scarp (Node 22.18+ for native TS imports):
    python3 tools/pack-rodin.py .cache/rodin-court/source public/models/rodin --only gate-scarp
"""
import argparse
import io
import json
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
from pathlib import Path


def pack(source, target, size):
    data = source.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    binary = memoryview(data)[28 + length:]
    images = {im['bufferView']: im for im in doc['images']}
    stream = io.BytesIO()
    for index, view in enumerate(doc['bufferViews']):
        start = view.get('byteOffset', 0)
        chunk = binary[start:start + view['byteLength']]
        if index in images:
            im = images[index]
            normal = 'normal' in im['name']
            diffuse = 'diffuse' in im['name']
            edge = size if normal or diffuse else min(1024, size)
            # High quality 4:4:4 avoids chroma subsampling across tangent-space seams.
            chunk = subprocess.check_output(['magick', 'png:-', '-resize', f'{edge}x{edge}>', '-strip',
                '-sampling-factor', '4:4:4', '-quality', '95' if normal else '90', 'jpeg:-'], input=chunk)
            im['mimeType'] = 'image/jpeg'
        stream.write(b'\0' * (-stream.tell() % 4))
        view['byteOffset'] = stream.tell()
        stream.write(chunk)
        view['byteLength'] = len(chunk)
    stream.write(b'\0' * (-stream.tell() % 4))
    doc['buffers'][0]['byteLength'] = stream.tell()
    header = json.dumps(doc, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    target.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(header) + stream.tell(), len(header), 0x4E4F534A)
                       + header + struct.pack('<I4s', stream.tell(), b'BIN\0') + stream.getvalue())
    print(f'{target.name}: {len(data):,} → {target.stat().st_size:,} bytes', flush=True)


if __name__ == '__main__':
    sizes = {'gate-scarp': 2048, 'pilgrim-relief': 1536, 'chapel-pinnacle': 1024, 'outer-bailey': 2048}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path)
    parser.add_argument('output_dir', type=Path)
    parser.add_argument('--only', choices=sizes, help='pack just this asset')
    options = parser.parse_args()
    options.output_dir.mkdir(parents=True, exist_ok=True)
    for asset in [options.only] if options.only else sizes:
        filename = asset + '.glb'
        source = options.source_dir / filename
        target = options.output_dir / filename
        if asset in ('gate-scarp', 'outer-bailey'):
            fit_cmd = ['node', str(Path(__file__).with_name('fit-gate-scarp.mjs'))] if asset == 'gate-scarp' else [sys.executable, str(Path(__file__).with_name('fit-outer-bailey.py'))]
            with TemporaryDirectory(prefix='packed-rodin-') as directory:
                packed = Path(directory) / filename
                pack(source, packed, sizes[asset])
                subprocess.run([*fit_cmd, str(packed), str(target)], check=True)
        else:
            pack(source, target, sizes[asset])
