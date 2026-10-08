#!/usr/bin/env python3
"""Rebuild our client once and re-run OUR side of the given flows (default: every evidence whose dump dir is missing), writing the
output to tools/oracle/out/ours-<flow> (stable, gitignored) and re-verifying against the recorded original dir.
Usage: python3 tools/missions/rerun_ours_all.py [flow ...]   (e.g. mission-C06-9)"""
import glob, json, os, shutil, subprocess, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(root)
build = '/tmp/mc-rerun'
subprocess.run(['npx', 'vite', 'build', '--outDir', build], cwd='apps/client', check=True, capture_output=True)
want = set(sys.argv[1:])
port = 33100
for f in sorted(glob.glob('tools/missions/evidence/*.json')):
    e = json.load(open(f))
    if want and e['flow'] not in want:
        continue
    dirs = {os.path.dirname(k) for k in e['files']}
    orig = [d for d in dirs if d.startswith('tools/oracle/out/flow-') or 'evidence' in d or d.startswith('/tmp/solo')]
    ours_old = [d for d in dirs if d not in orig]
    if not want and all(os.path.exists(d) for d in dirs):
        continue
    stable = 'tools/oracle/out/flow-' + e['flow']
    if len(orig) != 1 or not os.path.exists(orig[0]):
        orig = [stable]
        if not os.path.exists(os.path.join(stable, 'final.saves.json')):
            # the original's dumps are gone (e.g. /tmp was wiped): run the ORIGINAL client again
            oenv = dict(os.environ, FLOW=e['flow'], MCITY_ORACLE_PORT_BASE=str(32000 + port % 1000))
            subprocess.run(['node', 'tools/oracle/run.mjs', 'flow'], env=oenv, capture_output=True, text=True, timeout=900)
            if not os.path.exists(os.path.join(stable, 'final.saves.json')):
                print('FAILED original run', e['flow'], flush=True); continue
    out = os.path.join(root, 'tools/oracle/out/ours-' + e['flow'])
    ok = False
    for attempt in range(3):
        shutil.rmtree(out, ignore_errors=True)
        port += 1
        env = dict(os.environ, CHROME=os.path.expanduser('~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'), MCITY_CLIENT_DIST=build,
                   OUT=out, PORT=str(port), PREVIEW=f'http://127.0.0.1:{port}/?nogiveback=1')
        r = subprocess.run(['node', 'tools/oracle/ours-flow.mjs', e['flow']], env=env, capture_output=True, text=True, timeout=600)
        if os.path.exists(os.path.join(out, 'final.saves.json')):
            ok = True; break
    if not ok:
        print('FAILED run', e['flow']); continue
    cmd = ['python3', 'tools/missions/verify.py', '--flow', e['flow'], '--skus', ','.join(e['skus']), '--class', e['class'],
           '--reward-group', str(e['reward_group']), '--orig', orig[0], '--ours', out] + (['--reload'] if e.get('reload') else [])
    v = subprocess.run(cmd, capture_output=True, text=True)
    print((v.stdout.splitlines() or [v.stderr[:160]])[0], flush=True)
shutil.rmtree(build, ignore_errors=True)
