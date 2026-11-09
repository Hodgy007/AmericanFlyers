#!/usr/bin/env python3
"""Build-time tool: turns the keyed horizon panoramas (RGBA PNG, sky already transparent) into the
WebP files in public/textures/horizon/.

    python3 scripts/prep-horizon.py <dir with k-alps.png k-pyrenees.png ...> [out dir]

What it does, and why:
  - erodes the alpha by a pixel (the keyed edge still carries a little sky blue) and softens it a
    touch, so the silhouette is anti-aliased and has no pale halo;
  - floods the colour of the opaque pixels outwards under the transparent ones, so bilinear
    filtering and mipmaps at the silhouette never pull in the garbage colour a keyed-out pixel has
    (that is what makes a dark or green fringe);
  - writes a full-size WebP (lossy colour, lossless alpha) and a half-size `-low` one for the Low tier.
Needs Pillow and numpy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

NAMES = ['alps', 'pyrenees', 'rockies', 'desert', 'hills']


def clean(im: Image.Image) -> Image.Image:
    a = np.array(im).astype(np.float32)
    alpha = Image.fromarray(a[..., 3].astype(np.uint8))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    al = np.array(alpha).astype(np.float32)
    # Opaque enough to trust its colour; everything else takes the colour of its nearest trusted neighbour.
    known = (np.array(im)[..., 3] > 200) & (al > 200)
    rgb = a[..., :3].copy()
    filled = known.copy()
    for _ in range(40):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(filled.shape, np.float32)
        padded_rgb = np.pad(rgb * filled[..., None], ((1, 1), (1, 1), (0, 0)), mode='edge')
        padded_f = np.pad(filled.astype(np.float32), 1, mode='edge')
        h, w = filled.shape
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                acc += padded_rgb[dy:dy + h, dx:dx + w]
                cnt += padded_f[dy:dy + h, dx:dx + w]
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    out = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def save(im: Image.Image, path: Path):
    im.save(path, 'WEBP', quality=80, alpha_quality=100, method=6, exact=True)
    print(f'{path}  {path.stat().st_size / 1024:.0f} KB  {im.size[0]}x{im.size[1]}')


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / 'public' / 'textures' / 'horizon'
    dst.mkdir(parents=True, exist_ok=True)
    for n in NAMES:
        im = clean(Image.open(src / f'k-{n}.png').convert('RGBA'))
        save(im, dst / f'{n}.webp')
        half = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        # Resizing blends the flooded colour with the alpha-weighted neighbours only through straight alpha, which is what we want.
        save(half, dst / f'{n}-low.webp')


if __name__ == '__main__':
    main()
