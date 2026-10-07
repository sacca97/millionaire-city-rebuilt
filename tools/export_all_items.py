#!/usr/bin/env python3
"""Export every item SWF into apps/client/public/sprites and write index.json.

Usage: export_all_items.py [datas_dir] [out_dir]
index.json maps sku -> {class -> {offsetX, offsetY, width, height, frames[]}}.
"""
import json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import export_item_sprites as ex

ROOT = Path(__file__).resolve().parent.parent
FFDEC = ROOT / "generated/tools/ffdec-26.0.0/ffdec.jar"
DATAS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "apps/client/public/sprites"


def one(swf):
    sku = swf.stem
    d = OUT / sku
    if not (d / "sprites.json").exists():
        ex.main(str(FFDEC), str(swf), str(d))
    data = json.loads((d / "sprites.json").read_text())
    return sku, {
        s["class"]: {k: s[k] for k in ("offsetX", "offsetY", "width", "height")}
        | {"frames": [f"{sku}/{f}" for f in s["frames"]]}
        for s in data["symbols"]
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    swfs = sorted((DATAS / "Assets/items").glob("*.swf"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        index = dict(pool.map(one, swfs))
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"{len(index)} item SWFs indexed -> {OUT / 'index.json'}")


main()
