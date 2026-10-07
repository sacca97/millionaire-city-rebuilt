#!/usr/bin/env python3
"""Swap apps/client/public-opt (from optimize_assets.py) into apps/client/public, keeping a backup.

  apply_optimised_assets.py apply     public -> public-bak, public-opt -> public
  apply_optimised_assets.py restore   public-bak -> public (the optimised tree goes back to public-opt)
Run only when no other agent/server uses apps/client/public. Not run automatically.
"""
import sys
from pathlib import Path
C = Path(__file__).resolve().parent.parent / "apps/client"
pub, opt, bak = C / "public", C / "public-opt", C / "public-bak"
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "apply":
    if not opt.exists() or bak.exists():
        sys.exit("need public-opt and no existing public-bak")
    pub.rename(bak); opt.rename(pub)
    print("applied; original kept in public-bak (restore with 'restore')")
elif cmd == "restore":
    if not bak.exists():
        sys.exit("no public-bak")
    pub.rename(opt); bak.rename(pub)
    print("restored original public; optimised tree is public-opt again")
else:
    sys.exit(__doc__)
