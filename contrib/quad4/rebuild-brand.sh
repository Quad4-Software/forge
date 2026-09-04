#!/usr/bin/env bash
# Rebuild Quad4 brand assets from contrib/quad4/brand/logo-transparent.png
# SVG outputs are PNG embeds (no hand-drawn vectors).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

python3 << 'PY'
from PIL import Image
from pathlib import Path
import base64, io

brand = Path("contrib/quad4/brand")
assets = Path("assets")
pub = Path("public/assets/img")
custom = Path("custom/public/assets/img")
for d in (pub, custom, assets):
    d.mkdir(parents=True, exist_ok=True)

src = brand / "logo-transparent.png"
if not src.exists():
    raise SystemExit(f"missing {src}")

master = Image.open(src).convert("RGBA")
side = max(master.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(master, ((side - master.size[0]) // 2, (side - master.size[1]) // 2), master)
master = square

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

def png_bytes(im, size):
    buf = io.BytesIO()
    fit(im, size).save(buf, format="PNG", optimize=True)
    return buf.getvalue()

def write_svg_embed(path, im, size):
    data = base64.b64encode(png_bytes(im, size)).decode("ascii")
    path.write_text(
        f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Quad4 Forge">
  <image width="{size}" height="{size}" href="data:image/png;base64,{data}" xlink:href="data:image/png;base64,{data}"/>
</svg>
'''
    )

write_svg_embed(assets / "logo.svg", master, 512)
write_svg_embed(assets / "favicon.svg", master, 64)
write_svg_embed(pub / "logo.svg", master, 512)
write_svg_embed(pub / "favicon.svg", master, 64)

fit(master, 512).save(pub / "logo.png", "PNG", optimize=True)
fit(master, 200).save(pub / "avatar_default.png", "PNG", optimize=True)
fit(master, 180, bg=(18, 18, 18, 255)).save(pub / "apple-touch-icon.png", "PNG", optimize=True)
fit(master, 180).save(pub / "favicon.png", "PNG", optimize=True)
fit(master, 512).save(brand / "logo-512.png", "PNG", optimize=True)

ico = [fit(master, s) for s in (16, 32, 48)]
ico[0].save(pub / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[1:])
ico[0].save(brand / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[1:])

for name in [
    "logo.png", "logo.svg", "favicon.png", "favicon.svg",
    "favicon.ico", "apple-touch-icon.png", "avatar_default.png",
]:
    (custom / name).write_bytes((pub / name).read_bytes())

print("brand assets rebuilt from", src)
PY
