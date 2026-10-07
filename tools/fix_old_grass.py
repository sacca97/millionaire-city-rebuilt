#!/usr/bin/env python3
"""Recolour the old grass baked into building/decoration sprites to the 0.501 ground colour.

Many item SWFs carry lawns painted for the older (olive) terrain; against the newer bright
ground (terrain.swf 'background') they look like dull patches. Pixels within COLOR_RADIUS of the
old grass mean are mapped to the new grass distribution, keeping their light/dark texture;
a soft falloff avoids hard edges. Each sprites/<sku> dir gets a .grass_fixed marker and is skipped on later runs
(edge pixels would otherwise drift further on every pass); use --force to reprocess.

Usage: fix_old_grass.py [sprites_dir] [--force] [--preview sku ...]   (default apps/client/public/sprites)
"""
import json, sys
from multiprocessing import Pool
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# Old terrain grass (cdndev tile_grass_basic.png) and the new background grass (ground/background.png).
OLD_MEAN = np.array([99.4, 110.7, 8.0])
NEW_MEAN = np.array([122.0, 180.7, 58.3])
GAIN = np.array([0.75, 1.3, 0.9])  # keeps texture contrast: new std / old std per channel
RADIUS = 30.0   # full recolour inside, soft falloff up to RADIUS
INNER = 18.0


def process(path: str):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb = a[..., :3]
    d = np.sqrt(((rgb - OLD_MEAN) ** 2).sum(-1))
    w = np.clip((RADIUS - d) / (RADIUS - INNER), 0.0, 1.0)
    w = np.where(a[..., 3] > 0, w, 0.0)
    n = int((w > 0).sum())
    if n == 0:
        return path, 0
    mapped = np.clip(NEW_MEAN + (rgb - OLD_MEAN) * GAIN, 0, 255)
    out = a.copy()
    out[..., :3] = rgb + (mapped - rgb) * w[..., None]
    Image.fromarray(out.round().astype(np.uint8), "RGBA").save(path, optimize=False)
    return path, n


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    base = Path(args[0]) if args else ROOT / "apps/client/public/sprites"
    files = []
    markers = []
    force = "--force" in sys.argv
    for dirpath in base.glob("*/sprites"):
        if dirpath.parent.name in ("cars", "_building_state"):
            continue
        marker = dirpath.parent / ".grass_fixed"
        if marker.exists() and not force:
            continue
        markers.append(marker)
        files += [str(p) for p in dirpath.glob("DefineSprite_*/*.png")]
    with Pool() as pool:
        res = pool.map(process, files, chunksize=64)
    for m in markers:
        m.write_text("1")
    changed = sum(1 for _, n in res if n)
    print(f"{len(files)} frames scanned, {changed} recoloured")


if __name__ == "__main__":
    if "--preview" in sys.argv:
        i = sys.argv.index("--preview")
        idx = json.load(open(ROOT / "apps/client/public/sprites/index.json"))
        tiles = []
        for sku in sys.argv[i + 1:]:
            e = idx[sku].get("normal_new") or idx[sku]["normal"]
            tiles.append(Image.open(ROOT / "apps/client/public/sprites" / e["frames"][0]).convert("RGBA"))
        W = sum(t.width + 10 for t in tiles) * 2
        H = max(t.height for t in tiles) * 2 + 10
        sheet = Image.new("RGB", (W, H), (122, 181, 58))
        x = 0
        for t in tiles:
            for k, fix in enumerate((False, True)):
                tmp = ROOT / "tmp" / f"_prev_{k}.png"
                t.save(tmp)
                if fix:
                    process(str(tmp))
                im = Image.open(tmp).convert("RGBA")
                sheet.paste(im, (x, 0 if not fix else H // 2 + 5), im)
            x += t.width + 10
        sheet.save(ROOT / "tmp" / "grass_preview.png")
        print("preview -> tmp/grass_preview.png")
    else:
        main()
