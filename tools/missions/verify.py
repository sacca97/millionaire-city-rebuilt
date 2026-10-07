#!/usr/bin/env python3
"""Compare ONE original-vs-ours oracle run and write tamper-evident evidence (the only way a mission row can become MATCH).

Usage:
  python3 tools/missions/verify.py --flow mission-build --skus 6,7 --class C09 \
      --orig tools/oracle/out/flow-mission-build --ours /tmp/ours-mission-build
Both dirs come from the oracle harness: `cmds.jsonl` (cmdList payload log) and `<label>.saves.json` (save dumps).
Result: tools/missions/evidence/<flow>.json with equal=true only when
  * both runs have the same set of save-dump labels (at least one besides the reload one) and a non-empty cmds.jsonl,
  * the command diff and every save diff have ZERO differences after applying tools/missions/accepted.json
    (accepted differences are written by a human/strong agent with a reason; models must not edit it),
  * sha256 of every compared file is recorded (mark.py re-checks them; editing a result file invalidates the evidence).
Exit code 0 = equal, 1 = differences, 2 = incomplete/invalid input.
"""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE.parent / "oracle"
EVIDENCE = HERE / "evidence"
ACCEPTED = HERE / "accepted.json"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def accepted() -> list[dict]:
    return json.loads(ACCEPTED.read_text()) if ACCEPTED.exists() else []


def diff_lines(cmd: list[str]) -> list[str]:
    r = subprocess.run(cmd, capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l.strip()]


def cmd_diffs(orig: Path, ours: Path) -> list[str]:
    out, bad = diff_lines([sys.executable, str(ORACLE / "cmds-diff.py"), str(orig / "cmds.jsonl"), str(ours / "cmds.jsonl")]), []
    for l in out:
        if l.startswith("=="):
            m = re.search(r"orig x(\d+) ours x(\d+)", l)
            if m and m.group(1) != m.group(2):
                bad.append(l)
        elif l.startswith("   #") or l.lstrip().startswith("only in"):
            bad.append(l)
    return bad


def save_diffs(a: Path, b: Path) -> list[str]:
    out = diff_lines([sys.executable, str(ORACLE / "save-diff.py"), str(a), str(b)])
    return [l for l in out if not l.startswith("differences:")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flow", required=True)
    ap.add_argument("--skus", required=True, help="comma separated mission skus this run proves")
    ap.add_argument("--class", dest="klass", required=True)
    ap.add_argument("--orig", required=True)
    ap.add_argument("--ours", required=True)
    ap.add_argument("--reward-group", type=int, default=0, choices=[0, 1, 2], help="profile missionAltReward group the run used (0 base, 1, 2)")
    ap.add_argument("--reload", action="store_true", help="run includes a reload and a dump after it (required for claim/reload evidence)")
    a = ap.parse_args()
    orig, ours = Path(a.orig), Path(a.ours)
    files, problems, diffs = {}, [], []
    for d in (orig, ours):
        if not (d / "cmds.jsonl").exists() or (d / "cmds.jsonl").stat().st_size == 0:
            problems.append(f"{d}: cmds.jsonl missing/empty")
    labels = lambda d: sorted(p.name for p in d.glob("*.saves.json"))
    lo, lu = labels(orig), labels(ours)
    if lo != lu:
        problems.append(f"save dump labels differ: orig={lo} ours={lu}")
    if len(lo) < 2:
        problems.append("need at least 2 save dumps (e.g. after the action and after a reload)")
    if a.reload and not any("reload" in n or "final" in n for n in lo):
        problems.append("--reload given but no dump with 'reload' or 'final' in its name")
    if problems:
        print("INVALID:", *problems, sep="\n  ")
        return 2
    diffs += [f"cmds: {l}" for l in cmd_diffs(orig, ours)]
    for n in lo:
        diffs += [f"{n}: {l}" for l in save_diffs(orig / n, ours / n)]
        files[str(orig / n)] = sha(orig / n)
        files[str(ours / n)] = sha(ours / n)
    for d in (orig, ours):
        files[str(d / "cmds.jsonl")] = sha(d / "cmds.jsonl")
    rules = accepted()
    remaining, used = [], []
    for l in diffs:
        hit = next((r for r in rules if re.search(r["pattern"], l)), None)
        (used if hit else remaining).append({"line": l, "reason": hit["reason"]} if hit else l)
    EVIDENCE.mkdir(exist_ok=True)
    ev = {"flow": a.flow, "class": a.klass, "skus": a.skus.split(","), "reload": a.reload, "reward_group": a.reward_group, "equal": not remaining,
          "remaining_differences": remaining, "accepted_differences": used, "files": files,
          "accepted_sha": sha(ACCEPTED) if ACCEPTED.exists() else None}
    (EVIDENCE / f"{a.flow}.json").write_text(json.dumps(ev, indent=1))
    print(f"{a.flow}: {'EQUAL' if ev['equal'] else 'DIFFERENT'} ({len(remaining)} differences, {len(used)} accepted)")
    for l in remaining[:25]:
        print("  ", l)
    return 0 if ev["equal"] else 1


sys.exit(main())
