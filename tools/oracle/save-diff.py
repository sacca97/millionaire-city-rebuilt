#!/usr/bin/env python3
"""Golden-save diff: python3 save-diff.py <original.json> <ours.json>  (dumps from tools/oracle ... dump.py: {user:{tag:doc}}).
Flattens both documents to path -> value (list items keyed by sid / sku+x+y where present), ignores timestamps
(savedAt, time-like keys listed in IGNORE) and prints every differing path."""
import json, sys, re
IGNORE = re.compile(r'(savedAt|updated_at|lastLogin|lastSave|timestamp|startTime|endTime|cityNameCodes)$')
def key_of(i, n):
    if isinstance(i, dict):
        if 'sku' in i and 'x' in i: return f"{i['sku']}@{i['x']},{i['y']}"
        if 'sid' in i: return 'sid' + str(i['sid'])
        if 'id' in i and 'Decorations' not in i: return 'id' + str(i['id'])
        for k in ('Decorations', 'State', 'Decoration'):
            if k in i: return k
    return str(n)
def flat(o, p=''):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items(): out.update(flat(v, f'{p}/{k}'))
    elif isinstance(o, list):
        seen = {}
        for n, i in enumerate(o):
            k = key_of(i, n); seen[k] = seen.get(k, 0) + 1
            if seen[k] > 1: k += f'#{seen[k]}'
            out.update(flat(i, f'{p}[{k}]'))
        if not o: out[p + '[]'] = '<empty>'
    else: out[p] = o
    return out
a, b = (json.load(open(f)) for f in sys.argv[1:3])
tags = sorted(set(a.get('1', {})) | set(b.get('1', {})))
n = 0
for t in tags:
    fa, fb = flat(a['1'].get(t)), flat(b['1'].get(t))
    for k in sorted(set(fa) | set(fb)):
        if IGNORE.search(k): continue
        va, vb = fa.get(k, '<missing>'), fb.get(k, '<missing>')
        if va != vb:
            # skip volatile ids of world items: sids differ legitimately; compare by position instead
            print(f'{t}{k}: ORIGINAL={va!r} OURS={vb!r}'); n += 1
print('differences:', n)
