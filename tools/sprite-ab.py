#!/usr/bin/env python3
"""Helper for trying AI redraws of the game sprites.

  prep    sprite.webp out.png [--scale 4]   put the (transparent) sprite on a flat magenta #FF00FF background, optionally upscaled (nearest),
                                            so the model sees exactly what belongs to the sprite and where its edge is
  cutout  redraw.png out.png [--size WxH]   key the magenta out into a transparent PNG; --size resizes to the original sprite size (lanczos)
  compare orig.webp redraw.png out.png      side-by-side sheet (original at 4x nearest | redraw scaled to the same height) plus a 50% overlay

Needs Pillow. Example:
  python3 tools/sprite-ab.py prep apps/client/public-opt/sprites/houses_001_001/sprites/DefineSprite_16_normal_new/1.webp /tmp/ref.png --scale 4
"""
import sys
from PIL import Image

MAGENTA = (255, 0, 255)


def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def prep(src, out):
    im = Image.open(src).convert("RGBA")
    s = int(arg("--scale", 1))
    if s > 1:
        im = im.resize((im.width * s, im.height * s), Image.NEAREST)
    bg = Image.new("RGBA", im.size, MAGENTA + (255,))
    bg.alpha_composite(im)
    bg.convert("RGB").save(out)
    print(f"{out}: {im.size[0]}x{im.size[1]}")


def cutout(src, out):
    im = Image.open(src).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            # distance to magenta: fully transparent when close, soft edge in between; also removes magenta fringe from the colour
            d = ((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) ** 0.5
            if d < 60:
                px[x, y] = (0, 0, 0, 0)
            elif d < 140:
                al = int(255 * (d - 60) / 80)
                px[x, y] = (r, min(255, g), b, al)
    size = arg("--size")
    if size:
        w, h = map(int, size.lower().split("x"))
        bbox = im.getbbox()
        im = im.crop(bbox).resize((w, h), Image.LANCZOS)
    im.save(out)
    print(f"{out}: {im.size[0]}x{im.size[1]}")


def compare(orig, redraw, out):
    a = Image.open(orig).convert("RGBA")
    b = Image.open(redraw).convert("RGBA")
    bb = b.getbbox()
    if bb:
        b = b.crop(bb)
    ab = a.crop(a.getbbox())
    h = ab.height * 4
    a4 = ab.resize((ab.width * 4, h), Image.NEAREST)
    b4 = b.resize((max(1, round(b.width * h / b.height)), h), Image.LANCZOS)
    grass = (120, 184, 60, 255)
    sheet = Image.new("RGBA", (a4.width + b4.width + 3 * 20, h + 40), grass)
    sheet.alpha_composite(a4, (20, 20))
    sheet.alpha_composite(b4, (a4.width + 40, 20))
    sheet.convert("RGB").save(out)
    ov = Image.new("RGBA", (a4.width, h), grass)
    ov.alpha_composite(a4)
    b_fit = b.resize(a4.size, Image.LANCZOS)
    b_fit.putalpha(b_fit.getchannel("A").point(lambda v: v // 2))
    ov.alpha_composite(b_fit)
    ov.convert("RGB").save(out.replace(".png", "-overlay.png"))
    print(out, out.replace(".png", "-overlay.png"))


if __name__ == "__main__" and len(sys.argv) >= 4:
    cmd, files = sys.argv[1], [x for x in sys.argv[2:] if not x.startswith("--")]
    if cmd == "prep":
        prep(files[0], files[1])
    elif cmd == "cutout":
        cutout(files[0], files[1])
    elif cmd == "compare":
        compare(files[0], files[1], files[2])
    else:
        sys.exit(__doc__)
else:
    sys.exit(__doc__)
