#!/usr/bin/env python3
"""Export the original GUI SWFs to PNG + JSON layouts for the TS client.

Usage: export_gui.py [--out apps/client/public/gui] [--jobs 4] [--only name,name] [--keep-tmp]

For each non-item SWF (HUD, popups, GUI screens, mission art...) this writes
<out>/<name>/layout.json plus PNGs:
  shapes/<id>.png          every DefineShape rasterised (FFDec SVG -> rsvg-convert)
  sprites/<Class>/<n>.png  composited PNG per SymbolClass sprite frame (preview/fallback)
layout.json keeps the display-list structure; see apps/client/src/gui/layout.ts for the schema.

Units are pixels (twips / 20). Matrix = [a, b, c, d, tx, ty] (Flash order: x' = a*x + c*y + tx).
Needs: java, FFDec jar (generated/tools/ffdec-26.0.0/ffdec.jar), rsvg-convert, PIL.
"""
import argparse, json, re, shutil, subprocess, sys, tempfile
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFDEC = ROOT / "generated/tools/ffdec-26.0.0/ffdec.jar"
DATAS = ROOT / "assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas"
TW = 20.0
SHAPE_TAGS = {"DefineShapeTag", "DefineShape2Tag", "DefineShape3Tag", "DefineShape4Tag"}
MORPH_TAGS = {"DefineMorphShapeTag", "DefineMorphShape2Tag"}


def r2(v):
    v = round(v, 3)
    return int(v) if v == int(v) else v


def rect(el):
    return [r2(float(el.get("Xmin")) / TW), r2(float(el.get("Ymin")) / TW),
            r2(float(el.get("Xmax")) / TW), r2(float(el.get("Ymax")) / TW)] if el is not None else None


def matrix(el):
    m = el.find("matrix") if el is not None else None
    if m is None:
        return None
    a = m.attrib
    hs = a.get("hasScale") == "true"
    hr = a.get("hasRotate") == "true"
    mm = [float(a["scaleX"]) if hs else 1.0, float(a["rotateSkew0"]) if hr else 0.0,
          float(a["rotateSkew1"]) if hr else 0.0, float(a["scaleY"]) if hs else 1.0,
          float(a["translateX"]) / TW, float(a["translateY"]) / TW]
    mm = [round(v, 5) for v in mm]
    return None if mm == [1, 0, 0, 1, 0, 0] else mm


def apply(m, x, y):
    if m is None:
        return x, y
    return m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]


def color(el):
    if el is None:
        return None
    a = el.attrib
    return "#%02x%02x%02x" % (int(a["red"]), int(a["green"]), int(a["blue"])), int(a.get("alpha", 255)) / 255


def cxform(el):
    c = el.find("colorTransform") if el is not None else None
    if c is None:
        return None
    a = c.attrib
    hm, ha = a.get("hasMultTerms") == "true", a.get("hasAddTerms") == "true"
    out = {}
    if hm:
        out["mult"] = [int(a[k + "MultTerm"]) / 256 for k in ("red", "green", "blue", "alpha")] if "alphaMultTerm" in a \
            else [int(a[k + "MultTerm"]) / 256 for k in ("red", "green", "blue")] + [1]
    if ha:
        out["add"] = [int(a[k + "AddTerm"]) for k in ("red", "green", "blue")] + [int(a.get("alphaAddTerm", 0))]
    return out or None


def filters(po):
    fl = po.find("surfaceFilterList")
    if fl is None:
        return None
    out = []
    for f in fl.findall("item"):
        d = {"type": f.get("type", "").replace("FILTER", "").lower()}
        for k, v in f.attrib.items():
            if k in ("type", "id"):
                continue
            d[k] = True if v == "true" else False if v == "false" else (float(v) if re.fullmatch(r"-?[\d.]+", v) else v)
        for ch in f:
            if ch.get("type") == "RGBA":
                d[ch.tag] = color(ch)
            elif ch.tag == "matrix":
                d["matrix"] = [float(i.text) for i in ch.findall("item")]
        out.append(d)
    return out or None


def strip_nul(s):
    return (s or "").replace("\x00", "").replace("\\u0000", "")


def parse_text(it, fonts):
    html = it.get("initialText") or ""
    face = re.search(r'face="([^"]*)"', html)
    size = re.search(r'size="([\d.]+)"', html)
    col = re.search(r'color="(#[0-9a-fA-F]{6})"', html)
    ali = re.search(r'align="(\w+)"', html)
    ls = re.search(r'letterSpacing="(-?[\d.]+)"', html)
    plain = re.sub(r"<[^>]+>", "", html) if it.get("html") == "true" else html
    plain = (plain.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&amp;", "&"))
    fid = it.get("fontId")
    fnt = fonts.get(fid, {})
    tc = color(it.find("textColor"))
    align = {"0": "left", "1": "right", "2": "center", "3": "justify"}.get(it.get("align", "0"), "left")
    d = {"t": "text", "bounds": rect(it.find("bounds")),
         "font": face.group(1) if face else fnt.get("name") or it.get("fontClass"),
         "size": float(size.group(1)) if size else r2(int(it.get("fontHeight", 0)) / TW),
         "color": col.group(1) if col else (tc[0] if tc else "#000000"),
         "align": ali.group(1) if ali else align,
         "text": plain, "multiline": it.get("multiline") == "true", "wordWrap": it.get("wordWrap") == "true",
         "input": it.get("readOnly") != "true", "autoSize": it.get("autoSize") == "true"}
    if fnt.get("bold"):
        d["bold"] = True
    if fnt.get("italic"):
        d["italic"] = True
    if ls:
        d["letterSpacing"] = float(ls.group(1))
    if it.get("leading") not in (None, "0"):
        d["leading"] = r2(int(it.get("leading")) / TW)
    if it.get("html") == "true" and html:
        d["html"] = html
    if it.get("variableName"):
        d["variable"] = it.get("variableName")
    return d


def timeline(tags, ids):
    """Simulate a tag list into frames of display lists. Returns (frames, labels)."""
    state = {}
    frames, labels = [], {}
    pending_label = None
    for t in tags:
        ty = t.get("type", "")
        if ty == "FrameLabelTag":
            labels[t.get("name")] = len(frames)
        elif ty.startswith("PlaceObject"):
            depth = int(t.get("depth"))
            move = t.get("placeFlagMove") == "true"
            has_char = t.get("placeFlagHasCharacter") == "true"
            if has_char and (not move or depth not in state):
                c = {"d": depth}
                state[depth] = c
            elif not has_char and depth in state:
                c = state[depth]
            elif has_char:
                c = state[depth]
            else:
                continue
            if has_char:
                c["ref"] = int(t.get("characterId"))
            if t.get("placeFlagHasName") == "true":
                c["n"] = t.get("name")
            if t.get("placeFlagHasMatrix") == "true":
                c["m"] = matrix(t)
            if t.get("placeFlagHasColorTransform") == "true":
                c["ct"] = cxform(t)
            if t.get("placeFlagHasClipDepth") == "true" and int(t.get("clipDepth")) > 0:
                c["clip"] = int(t.get("clipDepth"))
            if ty == "PlaceObject3Tag":
                if t.get("placeFlagHasFilterList") == "true":
                    c["f"] = filters(t)
                if t.get("placeFlagHasBlendMode") == "true" and t.get("blendMode") not in ("0", "1"):
                    c["bm"] = int(t.get("blendMode"))
                if t.get("placeFlagHasVisible") == "true" and t.get("visible") == "0":
                    c["vis"] = False
            for k in [k for k, v in c.items() if v is None]:
                del c[k]
        elif ty.startswith("RemoveObject"):
            state.pop(int(t.get("depth")), None)
        elif ty == "ShowFrameTag":
            frames.append([dict(state[d]) for d in sorted(state)])
    if not frames:
        frames = [[dict(state[d]) for d in sorted(state)]]
    # dedupe consecutive identical frames as 0
    out = []
    for i, f in enumerate(frames):
        out.append(0 if i and f == frames[i - 1] else f)
    return out, labels


def build_layout(xml_path, swf_name):
    root = ET.parse(xml_path).getroot()
    dr = root.find("displayRect")
    top = root.find("tags")
    fonts, symbols, classes = {}, {}, {}
    sprite_tags = {}
    shape_bounds = {}
    for it in top.findall("item"):
        ty = it.get("type")
        if ty in ("DefineFont2Tag", "DefineFont3Tag", "DefineFontTag", "DefineFont4Tag"):
            fid = it.get("fontID") or it.get("fontId")
            fonts.setdefault(fid, {})["name"] = strip_nul(it.get("fontName"))
            fonts[fid]["bold"] = it.get("fontFlagsBold") == "true"
            fonts[fid]["italic"] = it.get("fontFlagsItalic") == "true"
        elif ty == "DefineFontNameTag":
            fonts.setdefault(it.get("fontId"), {})["name"] = strip_nul(it.get("fontName"))
        elif ty == "SymbolClassTag":
            ids = [e.text for e in it.find("tags").findall("item")]
            names = [e.text for e in it.find("names").findall("item")]
            classes = dict(zip(names, map(int, ids)))
        elif ty == "DefineSpriteTag":
            sprite_tags[it.get("spriteId")] = it
        elif ty in SHAPE_TAGS:
            shape_bounds[it.get("shapeId")] = rect(it.find("shapeBounds"))
    for it in top.findall("item"):
        ty = it.get("type")
        if ty in SHAPE_TAGS:
            symbols[it.get("shapeId")] = {"t": "shape", "bounds": shape_bounds[it.get("shapeId")],
                                          "png": f"shapes/{it.get('shapeId')}.png"}
        elif ty in MORPH_TAGS:
            symbols[it.get("characterId")] = {"t": "morph", "bounds": rect(it.find("startBounds"))}
        elif ty == "DefineEditTextTag":
            symbols[it.get("characterID")] = parse_text(it, fonts)
        elif ty in ("DefineTextTag", "DefineText2Tag"):
            symbols[it.get("characterID")] = {"t": "statictext", "bounds": rect(it.find("textBounds"))}
        elif ty in ("DefineButtonTag", "DefineButton2Tag"):
            symbols[it.get("buttonId")] = {"t": "button2", "raw": ET.tostring(it, encoding="unicode")[:2000]}
    for sid, it in sprite_tags.items():
        sub = it.find("subTags")
        frames, labels = timeline(sub.findall("item") if sub is not None else [], symbols)
        s = {"t": "sprite", "frames": frames}
        if labels:
            s["labels"] = labels
        if {"UpState", "OverState", "DownState"} <= set(labels):
            s["button"] = True
        symbols[sid] = s
    # bounds (union over all frames, children transformed) for sprites
    cache = {}

    def sb(sid, depth=0):
        k = str(sid)
        if k in cache:
            return cache[k]
        sym = symbols.get(k)
        if sym is None or depth > 40:
            return None
        if sym["t"] != "sprite":
            return sym.get("bounds")
        cache[k] = None
        pts = []
        for f in sym["frames"]:
            if f == 0:
                continue
            for c in f:
                b = sb(c.get("ref", 0), depth + 1)
                if c.get("clip") or not b:
                    continue
                m = c.get("m")
                for x in (b[0], b[2]):
                    for y in (b[1], b[3]):
                        pts.append(apply(m, x, y))
        if pts:
            cache[k] = [r2(min(p[0] for p in pts)), r2(min(p[1] for p in pts)),
                        r2(max(p[0] for p in pts)), r2(max(p[1] for p in pts))]
        return cache[k]

    for sid, sym in symbols.items():
        if sym["t"] == "sprite":
            b = sb(sid)
            if b:
                sym["bounds"] = b
    rf, rl = timeline(top.findall("item"), symbols)
    layout = {"swf": swf_name, "frameRate": float(root.get("frameRate", 30)),
              "stage": rect(dr), "fonts": sorted({f["name"] for f in fonts.values() if f.get("name")}),
              "classes": classes, "symbols": symbols,
              "root": {"t": "sprite", "frames": rf, **({"labels": rl} if rl else {})}}
    return layout


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def safe(n):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", n)


def export_one(args):
    swf, name, out_root, ffdec = args
    swf, out_root = Path(swf), Path(out_root)
    out = out_root / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            run(["java", "-jar", ffdec, "-swf2xml", str(swf), str(tmp / "s.xml")])
            run(["java", "-jar", ffdec, "-export", "sprite,shape", str(tmp / "e"), str(swf)])
            layout = build_layout(tmp / "s.xml", swf.name)
            # shapes: SVG (origin = shape bounds min) -> PNG
            nsh = 0
            (out / "shapes").mkdir()
            for svg in (tmp / "e" / "shapes").glob("*.svg"):
                r = subprocess.run(["rsvg-convert", str(svg), "-o", str(out / "shapes" / (svg.stem + ".png"))],
                                   capture_output=True)
                if r.returncode == 0:
                    nsh += 1
                else:
                    sym = layout["symbols"].get(svg.stem)
                    if sym:
                        sym["png"] = None
            # class sprites: move to sprites/<Class>/
            cls_by_id = {str(v): k for k, v in layout["classes"].items()}
            for d in (tmp / "e" / "sprites").glob("DefineSprite_*"):
                sid = d.name.split("_")[1]
                cls = cls_by_id.get(sid)
                sym = layout["symbols"].get(sid)
                if not cls or not sym:
                    continue
                files = sorted(d.glob("*.png"), key=lambda p: int(p.stem))
                if not files:
                    continue
                dst = out / "sprites" / safe(cls)
                dst.mkdir(parents=True, exist_ok=True)
                for f in files:
                    shutil.move(str(f), dst / f.name)
                sym["png"] = f"sprites/{safe(cls)}/"
                sym["pngFrames"] = len(files)
            (out / "layout.json").write_text(json.dumps(layout, separators=(",", ":")))
        return name, len(layout["classes"]), nsh, None
    except Exception as e:  # noqa
        return name, 0, 0, repr(e)[:300] + (getattr(e, "stderr", b"") or b"")[:300].decode("utf8", "replace")


def discover():
    skip = ("Assets/items", "Assets/terrain")
    swfs = {}
    for p in sorted(DATAS.rglob("*.swf")):
        rel = p.relative_to(DATAS).as_posix()
        if any(rel.startswith(s) for s in skip) and rel != "Assets/terrain/fence.swf":  # fence.swf: Background.fencesBuild (expansion borders)
            continue
        n = p.stem
        if n in swfs:
            n = safe(p.parent.name) + "_" + n
        swfs[n] = p
    return swfs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "apps/client/public/gui"))
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    swfs = discover()
    if a.only:
        swfs = {k: v for k, v in swfs.items() if k in a.only.split(",")}
    Path(a.out).mkdir(parents=True, exist_ok=True)
    jobs = [(str(p), n, a.out, str(FFDEC)) for n, p in swfs.items()]
    index = {}
    with ProcessPoolExecutor(a.jobs) as ex:
        for name, ncls, nsh, err in ex.map(export_one, jobs):
            print(f"{name}: {ncls} classes, {nsh} shapes" + (f"  ERROR {err}" if err else ""), flush=True)
            if not err:
                index[name] = {"swf": swfs[name].relative_to(DATAS).as_posix(), "classes": ncls}
    old = Path(a.out) / "index.json"
    if a.only and old.exists():
        index = {**json.loads(old.read_text()), **index}
    old.write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    main()
