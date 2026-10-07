#!/usr/bin/env python3
"""Reads the frame rate from each item SWF header -> apps/client/public/sprites/framerates.json.

Usage: tools/export_framerates.py [items_dir] [out_json]
The header (after the optional zlib wrapper) is: signature(3) version(1) length(4) RECT frameRate(8.8 fixed) frameCount(2).
Observed rates: 12, 20, 24, 25, 30, 120 fps (varies per SWF, so it must be looked up per sku).
"""
import glob, json, os, sys, zlib

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
items = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Assets/items")
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "apps/client/public/sprites/framerates.json")
rates = {}
for f in sorted(glob.glob(os.path.join(items, "*.swf"))):
    b = open(f, "rb").read()
    if b[:3] == b"CWS":
        b = b[:8] + zlib.decompress(b[8:])
    elif b[:3] != b"FWS":
        continue
    nbits = b[8] >> 3
    p = 8 + (5 + nbits * 4 + 7) // 8
    rates[os.path.basename(f)[:-4]] = b[p + 1] + b[p] / 256
json.dump(rates, open(out, "w"), indent=0, sort_keys=True)
print(len(rates), "rates ->", out)
