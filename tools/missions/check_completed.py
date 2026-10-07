#!/usr/bin/env python3
"""Text-only check that a mission ended up in the Given/Reached/Up list of a save dump (no screenshots needed).
Usage: python3 tools/missions/check_completed.py <dump.saves.json> <sku> [<sku>...]
Prints one line per sku: sku: given|reached|up|absent, plus coins/exp from the profile. Exit 0 if every sku is 'given'."""
import json, re, sys


def lists(dump: dict) -> dict:
    u = dump["1"]["universe"]["universe"]
    prof = next(e for e in u if isinstance(e, dict) and "Profile" in e)
    out = {"up": set(), "reached": set(), "given": set()}
    for entry in prof["Profile"]:
        for m in entry.get("Missions", []) if isinstance(entry, dict) else []:
            for k in ("Up", "Reached", "Given"):
                if k in m:
                    out[k.lower()] |= {x for x in re.split(r"[,\s]+", m.get("chunk", "")) if x}
    return out, prof


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    dump = json.load(open(sys.argv[1]))
    L, prof = lists(dump)
    ok = True
    for sku in sys.argv[2:]:
        state = next((k for k in ("given", "reached", "up") if sku in L[k]), "absent")
        ok &= state == "given"
        print(f"{sku}: {state}")
    print(f"profile: coins={prof.get('DCCoins')} exp={prof.get('exp')} cash={prof.get('DCCash')} companyValue={prof.get('companyValue')}")
    return 0 if ok else 1


sys.exit(main())
