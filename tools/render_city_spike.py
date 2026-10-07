#!/usr/bin/env python3
"""Spike: render one company's items from a save bundle JSON using exported sprites.

Usage: render_city_spike.py <save.json> <items_export_dir> <rules_dir> <out.png> [company_csid]
Rules (from docs/client-logic-spec.md): tile = rel + (90/2, 60/2); sprite origin = footprint
bottom-left; draw order = row-major tile index of the footprint's bottom-right row.
"""
import json, re, sys
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageDraw

COLS, ROWS, T = 90, 60, 32


def footprints(rules):
    fp = {}
    for f in ("itemDefinitions.xml", "commerceDefinitions.xml", "decorationDefinitions.xml",
              "wonderDefinitions.xml", "clubDefinitions.xml"):
        p = rules / f
        if not p.exists():
            continue
        for d in ET.parse(p).getroot().iter("Definition"):
            if d.get("sku") and d.get("baseCols"):
                fp[d.get("sku")] = (int(d.get("baseCols")), int(d.get("baseRows")))
    return fp


def chunk_tiles(s):
    out = []
    for part in s.split(","):
        m = re.match(r"^(?:\d+:)?(-?\d+):(-?\d+)$", part.strip())
        if m:
            out.append((int(m[1]), int(m[2])))
    return out


def pick(items_dir, sku):
    j = items_dir / sku / "sprites.json"
    if not j.exists():
        return None
    syms = {s["class"]: s for s in json.loads(j.read_text())["symbols"]}
    s = syms.get("normal_new") or syms.get("normal")
    if not s or not s["frames"]:
        return None
    return s, Image.open(items_dir / sku / s["frames"][0]).convert("RGBA")


def main(save, items_dir, rules, out, csid="1"):
    items_dir, rules = Path(items_dir), Path(rules)
    u = json.load(open(save))["universe"]
    world = next(w for w in u["universe"] if "World" in w)["World"] if isinstance(u["universe"], list) else u["World"]
    fp = footprints(rules)
    img = Image.new("RGBA", (COLS * T, ROWS * T), (96, 150, 70, 255))
    dr = ImageDraw.Draw(img)
    companies = [c for w in world for c in w.get("Company", [])] if False else None
    comp = next(w for w in world if "Company" in w and w.get("whose") == "0")
    for blk in world:
        for m in blk.get("Map", []):
            for k, col in (("Terrain", (120, 190, 90, 255)), ("Road", (70, 70, 75, 255))):
                if k in m:
                    for x, y in chunk_tiles(m.get("chunk", "")):
                        tx, ty = x + COLS // 2, y + ROWS // 2
                        dr.rectangle([tx * T, ty * T, tx * T + T - 1, ty * T + T - 1], fill=col)
    for blk in world:
        for k, col in (("Terrain", (120, 190, 90, 255)), ("Road", (70, 70, 75, 255))):
            pass
    sprites, missing = [], set()
    for it in comp["Company"]:
        sku, tx, ty = it["sku"], int(it["x"]) + COLS // 2, int(it["y"]) + ROWS // 2
        cols, rows = fp.get(sku, (1, 1))
        got = pick(items_dir, sku)
        if not got:
            missing.add(sku)
            continue
        s, im = got
        px, py = tx * T + s["offsetX"], (ty + rows) * T + s["offsetY"]
        depth = (ty + rows - 1) * COLS + (tx + cols)
        sprites.append((depth, int(round(px)), int(round(py)), im))
    for _, px, py, im in sorted(sprites, key=lambda t: t[0]):
        img.alpha_composite(im, (px, py)) if 0 <= px and 0 <= py else img.paste(im, (px, py), im)
    img.save(out)
    print(f"{len(sprites)} drawn, missing sprites for {sorted(missing)}")


if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
