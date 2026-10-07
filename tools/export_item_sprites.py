#!/usr/bin/env python3
"""Export item SWF state clips to PNG frames plus a JSON file of origin offsets.

Usage: export_item_sprites.py <ffdec.jar> <swf> <out_dir>

FFDec crops each exported sprite frame to the sprite's bounds, which drops the
symbol-origin offset. The offset (px, relative to the symbol origin) is recomputed
here from the swf2xml dump as the union of placed child bounds. For item state
clips the origin is the footprint's bottom-left corner (see docs/client-logic-spec.md).
"""
import json, subprocess, sys, tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

TWIPS = 20.0


def matrix(el):
    m = el.find("matrix") if el is not None else None
    if m is None:
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    a = m.attrib
    has_scale = a.get("hasScale") == "true"
    has_rot = a.get("hasRotate") == "true"
    sx = float(a["scaleX"]) if has_scale else 1.0
    sy = float(a["scaleY"]) if has_scale else 1.0
    r0 = float(a["rotateSkew0"]) if has_rot else 0.0
    r1 = float(a["rotateSkew1"]) if has_rot else 0.0
    return (sx, r0, r1, sy, float(a["translateX"]), float(a["translateY"]))


def apply(m, x, y):
    a, b, c, d, tx, ty = m
    return (a * x + c * y + tx, b * x + d * y + ty)


def rect_corners(r):
    xs = (float(r["Xmin"]), float(r["Xmax"]))
    ys = (float(r["Ymin"]), float(r["Ymax"]))
    return [(x, y) for x in xs for y in ys]


def main(ffdec, swf, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        xml_path = Path(tmp) / "swf.xml"
        subprocess.run(["java", "-jar", ffdec, "-swf2xml", swf, str(xml_path)],
                       check=True, capture_output=True)
        subprocess.run(["java", "-jar", ffdec, "-export", "sprite", str(out / "sprites"), swf],
                       check=True, capture_output=True)
        root = ET.parse(xml_path).getroot()
    shapes, sprites, names = {}, {}, {}
    for it in root.iter("item"):
        t = it.get("type")
        if t in ("DefineShapeTag", "DefineShape2Tag", "DefineShape3Tag", "DefineShape4Tag"):
            b = it.find("shapeBounds")
            if b is not None:
                shapes[it.get("shapeId")] = rect_corners(b.attrib)
        elif t == "DefineSpriteTag":
            sprites[it.get("spriteId")] = it
        elif t == "SymbolClassTag":
            ids = [e.text for e in it.find("tags").findall("item")]
            cls = [e.text for e in it.find("names").findall("item")]
            names = dict(zip(ids, cls))
    cache = {}

    def bounds(sprite_id):
        if sprite_id in cache:
            return cache[sprite_id]
        cache[sprite_id] = None  # guards against cycles
        pts = []
        sub = sprites[sprite_id].find("subTags")
        for t in (sub if sub is not None else []):
            if not t.get("type", "").startswith("PlaceObject"):
                continue
            cid = t.get("characterId")
            if cid is None:
                continue
            m = matrix(t)
            if cid in shapes:
                src = shapes[cid]
            elif cid in sprites and bounds(cid):
                src = bounds(cid)
            else:
                continue  # bitmaps/text not placed directly
            pts += [apply(m, x, y) for x, y in src]
        cache[sprite_id] = pts or None
        return cache[sprite_id]

    result = []
    for sid, cls in names.items():
        if sid not in sprites:
            continue
        pts = bounds(sid)
        if not pts:
            continue
        x0 = min(p[0] for p in pts) / TWIPS
        y0 = min(p[1] for p in pts) / TWIPS
        x1 = max(p[0] for p in pts) / TWIPS
        y1 = max(p[1] for p in pts) / TWIPS
        frames = sorted((out / "sprites").glob(f"DefineSprite_{sid}_*/*.png"),
                        key=lambda p: int(p.stem))
        result.append({"class": cls, "spriteId": int(sid), "offsetX": x0, "offsetY": y0,
                       "width": x1 - x0, "height": y1 - y0,
                       "frames": [str(f.relative_to(out)) for f in frames]})
    (out / "sprites.json").write_text(json.dumps(
        {"swf": Path(swf).name, "origin": "state clip origin = footprint bottom-left",
         "symbols": result}, indent=2))
    print(f"{Path(swf).name}: {len(result)} symbols")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
