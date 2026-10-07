#!/usr/bin/env python3
"""Static sweep over ALL mission definitions (no game, no oracle). Fails (exit 1) on hard errors.

Checks: unique skus, default/alt split (87/231), prerequisites exist in the same set and form no cycle,
unlock level/sku present, reward lists well-formed and item rewards exist, parameters resolve to item
groups/skus/sub-groups, every event type is known to our client and has an emission point.
Usage: python3 tools/missions/static_sweep.py   -> tools/missions/out/static_sweep.json + prints a summary
"""
import json, re, subprocess, sys
from common import ROOT, OUT, NAME_TYPES, load_missions, load_item_skus, load_item_keys

KNOWN_TYPES = None


def known_types():
    src = (ROOT / "apps/client/src/game/missions.ts").read_text()
    block = re.search(r"MISSION_EVENT = \{(.*?)\} as const", src, re.S).group(1)
    return set(re.findall(r"(\w+):", block))


def emitters(t: str) -> list[str]:
    """Files (outside missions.ts and tests) that mention the event type as a string literal or MISSION_EVENT member."""
    pats = [f'"{t}"', f"'{t}'", f"MISSION_EVENT.{t}", f"poll(\"{t}\""]
    hits = []
    for p in (ROOT / "apps/client/src").rglob("*.ts"):
        if p.name.endswith(".test.ts") or p.name == "missions.ts":
            continue
        txt = p.read_text()
        if any(x in txt for x in pats):
            hits.append(str(p.relative_to(ROOT)))
    return sorted(hits)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ms = load_missions()
    skus, keys = load_item_skus(), load_item_keys()
    by = {m["sku"]: m for m in ms}
    errors, warnings = [], []
    if len(by) != len(ms):
        errors.append("duplicate mission skus")
    sets = {"default": [m for m in ms if m["_set"] == "default"], "alt": [m for m in ms if m["_set"] == "alt"]}
    if (len(sets["default"]), len(sets["alt"])) != (87, 231):
        errors.append(f"set sizes {len(sets['default'])}/{len(sets['alt'])} != 87/231")
    types = known_types()
    for m in ms:
        sku, t = m["sku"], m["type"]
        if t not in types:
            errors.append(f"{sku}: unknown event type {t}")
        if int(m.get("amount", "0") or 0) <= 0 and t not in ("informative",):
            warnings.append(f"{sku}: type {t} has no positive amount (no trigger)")
        u = m.get("unlockSku")
        if u:
            if u not in by:
                errors.append(f"{sku}: unlockSku {u} does not exist")
            elif by[u]["_set"] != m["_set"]:
                errors.append(f"{sku}: unlockSku {u} is in the other set")
        if not u and not m.get("unlockLevel"):
            warnings.append(f"{sku}: neither unlockLevel nor unlockSku (unlocks immediately)")
        for tag in ("", "ABtest1", "ABtest2"):
            rt, ra = m.get("rewardType" + tag), m.get("rewardAmount" + tag)
            if rt is None and ra is None:
                continue
            ts, as_ = (rt or "").split(";"), (ra or "").split(";")
            if len(ts) != len(as_):
                errors.append(f"{sku}: reward{tag} type/amount length mismatch")
            for x, a in zip(ts, as_):
                if not re.fullmatch(r"\d+", a.strip() or "x"):
                    errors.append(f"{sku}: reward{tag} amount '{a}' not an integer")
                if x not in ("coins", "exp") and x not in skus:
                    errors.append(f"{sku}: reward{tag} item '{x}' is not a known item sku")
        p = m.get("parameter", "")
        if p and t in ("build", "buy", "sell", "collect", "collectUpgraded", "upgrade", "moveHouse", "checkInfluence", "bonus"):
            base = p.split("%")[0]
            if base not in NAME_TYPES and base not in keys:
                warnings.append(f"{sku}: parameter '{p}' ({t}) matches no item sku/sub-group (mission cannot progress; known quirk if listed)")
    # cycles in prerequisites
    for m in ms:
        seen, cur = set(), m
        while cur.get("unlockSku"):
            if cur["sku"] in seen:
                errors.append(f"prerequisite cycle at {cur['sku']}")
                break
            seen.add(cur["sku"])
            cur = by.get(cur["unlockSku"], {})
    usage = {t: sum(1 for m in ms if m["type"] == t) for t in sorted({m["type"] for m in ms})}
    emit = {t: emitters(t) for t in usage}
    for t, files in emit.items():
        if not files:
            warnings.append(f"event type {t} ({usage[t]} missions): no emission point found in apps/client/src (outside missions.ts)")
    res = {"missions": len(ms), "errors": errors, "warnings": warnings, "type_usage": usage, "emitters": emit}
    (OUT / "static_sweep.json").write_text(json.dumps(res, indent=1))
    print(f"{len(ms)} missions: {len(errors)} errors, {len(warnings)} warnings")
    for e in errors:
        print("ERROR  ", e)
    for w in warnings:
        print("WARNING", w)
    sys.exit(1 if errors else 0)


main()
