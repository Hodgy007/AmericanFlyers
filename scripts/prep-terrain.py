#!/usr/bin/env python3
"""Build-time tool: turns generated seamless 1024² ground textures (tex-<name>.png) into the
diffuse + normal JPEG pair that public/textures/terrain/ uses.

    python3 scripts/prep-terrain.py <dir with tex-rock.png ...> <out dir> [name ...]

Diffuse: 1024², JPEG q80, 4:2:0.  Normal: 512², height from luminance, Sobel with wrap-around
(so it tiles), OpenGL convention (green up), JPEG q70, 4:4:4.  Needs Pillow and numpy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

NAMES = ['rock', 'sandstone', 'snow', 'grass']


def normal_map(im: Image.Image, size=512, strength=0.8) -> Image.Image:
    g = np.asarray(im.convert('L').resize((size, size), Image.LANCZOS), np.float32) / 255.0
    g = g - g.mean()
    # a light wrap-around blur: the generated textures have fine noise that would make the normals grainy and the JPEG big
    f = np.fft.fft2(g)
    fy, fx = np.meshgrid(np.fft.fftfreq(size), np.fft.fftfreq(size), indexing='ij')
    g = np.real(np.fft.ifft2(f * np.exp(-(fx ** 2 + fy ** 2) * (2 * np.pi ** 2) * 1.2 ** 2)))

    def sh(dy, dx):
        return np.roll(np.roll(g, dy, 0), dx, 1)  # wraps at the edges: the result tiles

    dx = (sh(-1, 1) + 2 * sh(0, 1) + sh(1, 1)) - (sh(-1, -1) + 2 * sh(0, -1) + sh(1, -1))
    dy = (sh(1, -1) + 2 * sh(1, 0) + sh(1, 1)) - (sh(-1, -1) + 2 * sh(-1, 0) + sh(-1, 1))
    # +y is up in the image's own rows going down, so the OpenGL green channel is -dy (rows grow downward).
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(g)
    # OpenGL: green points up the image; height increasing downward tilts the normal up, hence +dy above.
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB')


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for n in sys.argv[3:] or NAMES:
        im = Image.open(src / f'tex-{n}.png').convert('RGB')
        if im.size != (1024, 1024):
            im = im.resize((1024, 1024), Image.LANCZOS)
        im.save(dst / f'{n}.jpg', 'JPEG', quality=80, subsampling=2, optimize=True, progressive=True)
        normal_map(im).save(dst / f'{n}-n.jpg', 'JPEG', quality=70, subsampling=0, optimize=True, progressive=True)
        print(n, (dst / f'{n}.jpg').stat().st_size // 1024, 'KB', (dst / f'{n}-n.jpg').stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
