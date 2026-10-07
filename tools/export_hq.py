#!/usr/bin/env python3
"""Export the Headquarters skins (Assets/items/HQDecorations/HeadQuarter_0N.swf) and merge them into
apps/client/public/sprites/index.json. Each skin SWF only has Asset/Asset_new (+selected/base_*/Icon); the
client renders skin N with the "normal" clip, so Asset(_new) is aliased to "normal" (ItemDecoration.setDO draws
the skin's Asset clip). Run tools/fix_old_grass.py afterwards.
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import export_item_sprites as ex

ROOT = Path(__file__).resolve().parent.parent
FFDEC = ROOT / "generated/tools/ffdec-26.0.0/ffdec.jar"
SRC = ROOT / "assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Assets/items/HQDecorations"
OUT = ROOT / "apps/client/public/sprites"

index = json.loads((OUT / "index.json").read_text())
for swf in sorted(SRC.glob("HeadQuarter_*.swf")):
    sku = swf.stem
    d = OUT / sku
    if not (d / "sprites.json").exists():
        ex.main(str(FFDEC), str(swf), str(d))
    syms = {s["class"]: {k: s[k] for k in ("offsetX", "offsetY", "width", "height")} | {"frames": [f"{sku}/{f}" for f in s["frames"]]}
            for s in json.loads((d / "sprites.json").read_text())["symbols"]}
    syms["normal"] = syms.get("Asset_new") or syms["Asset"]
    index[sku] = syms
(OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
print("HQ skins merged")
