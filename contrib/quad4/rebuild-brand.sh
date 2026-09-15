#!/usr/bin/env bash
# Rebuild Quad4 brand assets from contrib/quad4/brand/.
# SVG outputs are the real vectors (quad4-mark*.svg). Rasters are derived
# from source-mark.png: the mark is pure white on black, so luminance is
# the alpha channel.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

python3 << 'PY'
from PIL import Image
from pathlib import Path

brand = Path("contrib/quad4/brand")
assets = Path("assets")
pub = Path("public/assets/img")
custom = Path("custom/public/assets/img")
for d in (pub, custom, assets):
    d.mkdir(parents=True, exist_ok=True)

src = brand / "source-mark.png"
mark_svg = (brand / "quad4-mark.svg").read_bytes()
mark_black_svg = (brand / "quad4-mark-black.svg").read_bytes()
mark_on_black_svg = (brand / "quad4-mark-on-black.svg").read_bytes()

base = Image.open(src).convert("RGB")

def extract(fg):
    # fg=255: white mark on transparent; fg=0: black mark on transparent.
    lum = base.convert("L")
    if fg == 0:
        lum = lum.point(lambda v: 255 - v)
    rgba = Image.new("RGBA", base.size, (fg, fg, fg, 0))
    rgba.putalpha(lum)
    return rgba

white_mark = extract(255)
black_mark = extract(0)

def fit(im, size, bg=None):
    canvas = Image.new("RGBA", (size, size), bg if bg else (0, 0, 0, 0))
    tmp = im.copy()
    tmp.thumbnail((size, size), Image.Resampling.LANCZOS)
    x = (size - tmp.size[0]) // 2
    y = (size - tmp.size[1]) // 2
    canvas.paste(tmp, (x, y), tmp)
    if bg and len(bg) == 4 and bg[3] == 255:
        out = Image.new("RGBA", (size, size), bg)
        out.alpha_composite(canvas)
        return out.convert("RGB")
    return canvas

BLACK = (0, 0, 0, 255)

# Vector outputs
(assets / "logo.svg").write_bytes(mark_svg)
(assets / "favicon.svg").write_bytes(mark_on_black_svg)
(pub / "logo.svg").write_bytes(mark_svg)
(pub / "favicon.svg").write_bytes(mark_on_black_svg)
(custom / "logo-light.svg").write_bytes(mark_black_svg)
(custom / "favicon-light.svg").write_bytes(mark_on_black_svg)

# Raster outputs. The mark is white, so anything that can sit on a light
# surface gets a black background; dark-surface assets stay transparent.
fit(white_mark, 512).save(pub / "logo.png", "PNG", optimize=True)
fit(black_mark, 512).save(custom / "logo-light.png", "PNG", optimize=True)
fit(white_mark, 200, bg=BLACK).save(pub / "avatar_default.png", "PNG", optimize=True)
fit(white_mark, 180, bg=BLACK).save(pub / "apple-touch-icon.png", "PNG", optimize=True)
fit(white_mark, 180, bg=BLACK).save(pub / "favicon.png", "PNG", optimize=True)
fit(white_mark, 180, bg=BLACK).save(custom / "favicon-light.png", "PNG", optimize=True)
fit(white_mark, 512, bg=BLACK).save(brand / "logo-512.png", "PNG", optimize=True)
fit(white_mark, 1024, bg=BLACK).save(brand / "logo-1024.png", "PNG", optimize=True)

ico = [fit(white_mark, s, bg=BLACK) for s in (16, 32, 48)]
sizes = [(16, 16), (32, 32), (48, 48)]
ico[0].save(pub / "favicon.ico", format="ICO", sizes=sizes, append_images=ico[1:])
ico[0].save(brand / "favicon.ico", format="ICO", sizes=sizes, append_images=ico[1:])
ico[0].save(custom / "favicon-light.ico", format="ICO", sizes=sizes, append_images=ico[1:])

for name in [
    "logo.png", "logo.svg", "favicon.png", "favicon.svg",
    "favicon.ico", "apple-touch-icon.png", "avatar_default.png",
]:
    (custom / name).write_bytes((pub / name).read_bytes())

print("brand assets rebuilt from", src)
PY
