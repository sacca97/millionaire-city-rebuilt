#!/usr/bin/env python3
"""Re-run verify.py for every evidence file from the dump dirs it recorded (needed after accepted.json changes, which invalidates
every evidence hash). Skips evidence whose dump dirs are gone. Usage: python3 tools/missions/reverify_all.py"""
import glob, json, os, subprocess
for f in sorted(glob.glob('tools/missions/evidence/*.json')):
    e = json.load(open(f))
    dirs = {os.path.dirname(k) for k in e['files']}
    if not all(os.path.exists(d) for d in dirs):
        print('SKIP (dump dir missing)', os.path.basename(f)); continue
    orig = [d for d in dirs if d.startswith('tools/oracle/out/flow-') or 'evidence' in d or d.startswith('/tmp/solo')]
    ours = [d for d in dirs if d not in orig]
    if len(orig) != 1 or len(ours) != 1:
        print('SKIP (cannot tell orig/ours)', os.path.basename(f), sorted(dirs)); continue
    cmd = ['python3', 'tools/missions/verify.py', '--flow', e['flow'], '--skus', ','.join(e['skus']), '--class', e['class'],
           '--reward-group', str(e['reward_group']), '--orig', orig[0], '--ours', ours[0]] + (['--reload'] if e.get('reload') else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    print((r.stdout.splitlines() or [r.stderr[:160]])[0])
