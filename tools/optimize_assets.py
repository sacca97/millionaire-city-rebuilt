#!/usr/bin/env python3
"""Build an optimised copy of apps/client/public into apps/client/public-opt (the source is never modified).

  * sprites: prune clips the client can never request (see KEEP_CLIP), de-duplicate identical frames
    (pixel-identical decoded RGBA -> one file, index.json points several frames at it), convert to lossless WebP.
  * _building_state, gui, ground/background: lossless WebP (gui/ground keep requesting `.png` URLs; the
    server and the vite dev server answer `X.png` from `X.webp`, see apps/server/src/clientStatic.ts).
  * json minified, audio/fonts copied.
Every conversion is verified: the WebP is decoded and compared with the source PNG (RGBA incl. transparent
pixels) and the script aborts on any difference.

Run AFTER export_all_items / export_hq / fix_old_grass / export_gui.
Usage: optimize_assets.py [--src DIR] [--dst DIR] [--dry-run] [--jobs N]
Then `MCITY_OPT=1 npx vite build` (or tools/apply_optimised_assets.py to swap it into public/).
"""
import argparse, hashlib, json, os, re, shutil, sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "apps/client"
# Clips ItemView/TrafficLayer/shop icons can request: normal, normal_2, building, BarPosition, Effect_<i>[_top|_people], car
# (SpriteLibrary.symbol prefers "<clip>_new", so a clip with a _new twin is never loaded) + intro/shop icons use normal(_new).
KEEP_CLIP = re.compile(r"^(normal|normal_2|building|BarPosition|car|Effect_\d+(_top|_people)?)$")


def keep_class(name, classes):
    if name.endswith("_new"):
        base = name[:-4]
    else:
        base = name
        if name + "_new" in classes:
            return False  # shadowed
    return bool(KEEP_CLIP.match(base))


def load_rgba(path):
    return np.asarray(Image.open(path).convert("RGBA"))


def digest(path):
    a = load_rgba(path)
    return path, hashlib.sha1(a.tobytes() + str(a.shape).encode()).hexdigest()


def convert(args):
    src, dst = args
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    a = load_rgba(src)
    Image.fromarray(a, "RGBA").save(dst, "WEBP", lossless=True, quality=100, method=5, exact=True)
    b = load_rgba(dst)
    if a.shape != b.shape or not np.array_equal(a, b):
        raise SystemExit(f"PIXEL MISMATCH {src} -> {dst}")
    return os.path.getsize(src), os.path.getsize(dst)


def minify(src, dst):
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps(json.loads(Path(src).read_text()), separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(CLIENT / "public"))
    ap.add_argument("--dst", default=str(CLIENT / "public-opt"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()
    src, dst = Path(a.src), Path(a.dst)
    pool = Pool(a.jobs)
    report = {}

    # ---- sprites
    spr = src / "sprites"
    todo = []  # (png src, webp dst) unique conversions
    for idx_name in ("index.json", "cars/index.json"):
        pass
    indexes = {}
    for idx_path in (spr / "index.json", spr / "cars/index.json"):
        if idx_path.exists():
            indexes[idx_path] = json.loads(idx_path.read_text())
    dropped_classes = 0
    dropped_files = set()
    kept = {}
    for p, ix in indexes.items():
        out = {}
        for sku, cl in ix.items():
            keep = {n: v for n, v in cl.items() if keep_class(n, cl)}
            for n, v in cl.items():
                if n not in keep:
                    dropped_classes += 1
                    dropped_files.update(v["frames"])
            out[sku] = keep
        kept[p] = out
    frames = sorted({f for ix in kept.values() for cl in ix.values() for v in cl.values() for f in v["frames"]})
    missing = [f for f in frames if not (spr / f).exists()]
    if missing:
        print(f"WARNING {len(missing)} indexed frames missing in source, e.g. {missing[:3]}")
    frames = [f for f in frames if (spr / f).exists()]
    print(f"sprites: {len(frames)} referenced frames, {dropped_classes} clips pruned")
    digs = dict(pool.imap_unordered(digest, [str(spr / f) for f in frames], chunksize=32))
    canon, mapping = {}, {}
    for f in frames:
        h = digs[str(spr / f)]
        c = canon.setdefault(h, f)
        mapping[f] = c
    uniq = sorted(set(canon.values()))
    print(f"sprites: {len(uniq)} unique frames after de-duplication ({len(frames) - len(uniq)} duplicates)")
    srcbytes_all = sum((spr / f).stat().st_size for f in frames)
    if not a.dry_run:
        res = pool.map(convert, [(str(spr / f), str(dst / "sprites" / (f[:-4] + ".webp"))) for f in uniq], chunksize=16)
        report["sprites"] = (srcbytes_all, sum(r[1] for r in res), len(res))
        for p, ix in kept.items():
            for cl in ix.values():
                for v in cl.values():
                    v["frames"] = [mapping[f][:-4] + ".webp" if f in mapping else f for f in v["frames"]]
            o = dst / "sprites" / p.relative_to(spr)
            o.parent.mkdir(parents=True, exist_ok=True)
            o.write_text(json.dumps(ix, separators=(",", ":")))
    else:
        print(f"dry-run: would convert {len(uniq)} files; source bytes of referenced frames {srcbytes_all/1e6:.1f} MB")

    # other sprites assets (framerates.json, _building_state)
    for p in spr.glob("*.json"):
        if p.name != "index.json" and not a.dry_run:
            minify(p, dst / "sprites" / p.name)
    bs = spr / "_building_state"
    if bs.exists() and not a.dry_run:
        ix = json.loads((bs / "index.json").read_text())
        jobs = []
        for e in ix.values():
            f = e["file"]
            jobs.append((str(bs / f), str(dst / "sprites/_building_state" / (Path(f).stem + ".webp"))))
            e["file"] = Path(f).stem + ".webp"
        pool.map(convert, jobs)
        (dst / "sprites/_building_state").mkdir(parents=True, exist_ok=True)
        (dst / "sprites/_building_state/index.json").write_text(json.dumps(ix, separators=(",", ":")))

    # ---- gui (requests keep the .png URL; served from .webp)
    gui = src / "gui"
    pngs = sorted(gui.rglob("*.png")) if gui.exists() else []
    print(f"gui: {len(pngs)} png")
    if not a.dry_run:
        res = pool.map(convert, [(str(p), str(dst / "gui" / p.relative_to(gui).with_suffix(".webp"))) for p in pngs], chunksize=16)
        report["gui"] = (sum(r[0] for r in res), sum(r[1] for r in res), len(res))
        for j in gui.rglob("*.json"):
            minify(j, dst / "gui" / j.relative_to(gui))

    # ---- ground
    gr = src / "ground"
    if gr.exists() and not a.dry_run:
        for p in gr.glob("*.png"):
            r = convert((str(p), str(dst / "ground" / (p.stem + ".webp"))))
            report["ground:" + p.name] = (r[0], r[1], 1)
        for j in gr.glob("*.json"):
            minify(j, dst / "ground" / j.name)

    # ---- copy audio/fonts
    for d in ("audio", "fonts"):
        if (src / d).exists() and not a.dry_run:
            shutil.copytree(src / d, dst / d, dirs_exist_ok=True)
    pool.close()
    for k, (s, d, n) in report.items():
        print(f"{k}: {n} files, {s/1e6:.1f} MB -> {d/1e6:.1f} MB, all verified pixel-identical")


if __name__ == "__main__":
    main()
