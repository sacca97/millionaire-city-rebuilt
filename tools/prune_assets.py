#!/usr/bin/env python3
"""Report (default, dry run) or delete (--apply) sprite files the client can never request.

A clip is unreachable when it is not one of normal/normal_2/building/BarPosition/car/Effect_<i>[_top|_people]
or when a `<clip>_new` twin exists (SpriteLibrary.symbol prefers it); a PNG is unreferenced when no kept clip lists it.
optimize_assets.py applies the same rules while building public-opt (preferred: never touches public/).
Usage: prune_assets.py [sprites_dir] [--apply]
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from optimize_assets import keep_class, CLIENT

args = [x for x in sys.argv[1:] if not x.startswith("--")]
spr = Path(args[0]) if args else CLIENT / "public/sprites"
apply = "--apply" in sys.argv
keep, dropped_clips = set(), []
for idx in (spr / "index.json", spr / "cars/index.json"):
    if not idx.exists():
        continue
    for sku, cl in json.loads(idx.read_text()).items():
        for n, v in cl.items():
            if keep_class(n, cl):
                keep.update(v["frames"])
            else:
                dropped_clips.append((sku, n, len(v["frames"])))
files = [p for p in spr.rglob("*.png") if "_building_state" not in p.parts]
rel = {p.relative_to(spr).as_posix(): p for p in files}
dead = [p for r, p in rel.items() if r not in keep]
size = sum(p.stat().st_size for p in dead)
print(f"{len(dropped_clips)} unreachable clips; {len(dead)} of {len(files)} PNGs unreferenced ({size/1e6:.1f} MB)")
for sku, n, c in dropped_clips[:15]:
    print(f"  clip {sku}/{n} ({c} frames)")
if apply:
    for p in dead:
        p.unlink()
    print("deleted (index.json still lists pruned clips; run optimize_assets.py instead for a consistent tree)")
else:
    print("dry run: nothing removed (--apply to delete)")
