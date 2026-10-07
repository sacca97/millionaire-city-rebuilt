#!/usr/bin/env python3
"""Print cmdList payloads of two cmdlog files side by side: python3 cmds-diff.py orig.jsonl ours.jsonl (volatile fields stripped)"""
import json, sys, re, os
VERBOSE = bool(os.environ.get('V'))
def load(f):
    out = []
    for l in open(f):
        r = json.loads(l); b = r['body']
        m = re.search(r'data=(.*?)&(?:uid|flash_version|sig)=', b, re.S)
        try: j = json.loads(m.group(1))
        except Exception: j = b
        out.append(j)
    return out
def flatcmds(L):
    r = []
    for j in L:
        for c in (j.get('_cmdList', []) if isinstance(j, dict) else [j]):
            if isinstance(c, dict) and c.get('_cmd', '').startswith(('get_', 'update_profile')) and not VERBOSE: continue
            r.append(c)
    return r
a, b = flatcmds(load(sys.argv[1])), flatcmds(load(sys.argv[2]))
def s(c):
    if isinstance(c, dict): c = {k: v for k, v in c.items() if k != '_cnt'}
    return json.dumps(c, sort_keys=True)[:600]

def sig(c):
    d = c.get('_dat', {}) if isinstance(c, dict) else {}
    return (c.get('_cmd'), d.get('action') or d.get('type'), d.get('type') if d.get('action') else None, d.get('mode'))
def flat(o, p=''):
    r = {}
    if isinstance(o, dict):
        for k, v in o.items():
            if k == '_cnt': continue
            r.update(flat(v, p + '/' + k))
    elif isinstance(o, list):
        for i, v in enumerate(o): r.update(flat(v, f'{p}[{i}]'))
    else: r[p] = o
    return r
IGN = re.compile(r'millis$')
from collections import defaultdict
ga, gb = defaultdict(list), defaultdict(list)
for c in a: ga[sig(c)].append(c)
for c in b: gb[sig(c)].append(c)
for k in sorted(set(ga) | set(gb), key=str):
    xs, ys = ga.get(k, []), gb.get(k, [])
    print('==', k, f'orig x{len(xs)} ours x{len(ys)}')
    for i in range(max(len(xs), len(ys))):
        if i >= len(xs) or i >= len(ys):
            print('   only in', 'ORIG' if i < len(xs) else 'OURS', s((xs + ys)[i] if False else (xs[i] if i < len(xs) else ys[i]))); continue
        fx, fy = flat(xs[i]), flat(ys[i])
        for kk in sorted(set(fx) | set(fy)):
            if IGN.search(kk): continue
            if fx.get(kk, '<missing>') != fy.get(kk, '<missing>'): print(f'   #{i} {kk}: ORIG={fx.get(kk, "<missing>")!r} OURS={fy.get(kk, "<missing>")!r}')
