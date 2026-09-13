/**
 * Regenerates electron-builder packaging icons from public/logo.png.
 * Requires: Python 3 + Pillow (`pip install pillow`).
 * Usage: node scripts/generate-icons.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = `
from PIL import Image
import struct
from io import BytesIO
from pathlib import Path

def png_bytes(img):
    buf = BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

def write_ico(path, images):
    count = len(images)
    blobs = [png_bytes(im.convert('RGBA')) for im in images]
    offset = 6 + 16 * count
    entries = bytearray()
    payload = bytearray()
    for im, blob in zip(images, blobs):
        w, h = im.size
        entries += struct.pack('<BBBBHHII', 0 if w >= 256 else w, 0 if h >= 256 else h, 0, 0, 1, 32, len(blob), offset + len(payload))
        payload += blob
    path.write_bytes(struct.pack('<HHH', 0, 1, count) + entries + payload)

root = Path(${JSON.stringify(root)})
logo = Image.open(root / 'public' / 'logo.png').convert('RGBA')
build = root / 'build'
icons = build / 'icons'
icons.mkdir(parents=True, exist_ok=True)
logo.resize((1024, 1024), Image.Resampling.LANCZOS).save(build / 'icon.png', 'PNG')
for size in [16, 24, 32, 48, 64, 128, 256, 512, 1024]:
    logo.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'{size}x{size}.png', 'PNG')
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
write_ico(build / 'icon.ico', [logo.resize((s, s), Image.Resampling.LANCZOS) for s in ico_sizes])
write_ico(root / 'public' / 'favicon.ico', [logo.resize((s, s), Image.Resampling.LANCZOS) for s in [16, 32, 48]])
logo.resize((64, 64), Image.Resampling.LANCZOS).save(root / 'public' / 'favicon.png', 'PNG')
print('Icons regenerated from public/logo.png')
`;

const result = spawnSync('python3', ['-c', script], { stdio: 'inherit' });
process.exit(result.status ?? 1);
