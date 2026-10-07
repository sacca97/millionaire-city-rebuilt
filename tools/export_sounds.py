#!/usr/bin/env python3
"""Export all game audio into apps/client/public/audio + index.json.

1. Copies the external mp3s from Datas/sounds/ (loaded by DollarsGame.loadingInitSoundManager).
2. Runs FFDec `-export sound` on every SWF under assets/ (embedded DefineSound tags).
3. Converts to ogg/mp3 with ffmpeg when available (embedded sounds -> mp3).
"""
import json, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FFDEC = ROOT / "generated/tools/ffdec-26.0.0/ffdec.jar"
OUT = ROOT / "apps/client/public/audio"
SOUND_DIR = next(ASSETS.rglob("sounds"), None)

# name -> (file, kind, loop, volume, source line in decompiled DollarsGame.as)
EXTERNAL = {
    "Main_Music": ("main.mp3", "music", True, 1.0),
    "Ronald_Music": ("tycoon.mp3", "music", True, 1.0),
    "Tutorail_Music": ("tutorial2.mp3", "music", True, 1.0),  # sic (original spelling)
    "Income_Sound": ("money.mp3", "sfx", False, 1.0),
    "Contract_Sound": ("contract.mp3", "sfx", False, 1.0),
    "Build_Sound": ("build.mp3", "sfx", False, 1.0),
    "Destroy_Sound": ("bulldoze.mp3", "sfx", False, 1.0),
    "Level_Sound": ("levelup.mp3", "sfx", False, 1.0),
}


def export_swf(swf: Path):
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["java", "-jar", str(FFDEC), "-export", "sound", td, str(swf)],
                       capture_output=True, timeout=300)
        files = [p for p in Path(td).rglob("*") if p.is_file()]
        res = []
        for p in files:
            dest = OUT / "embedded" / swf.stem
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, dest / p.name)
            res.append(dest / p.name)
        return swf, res


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"sounds": {}, "embedded": {}}
    for name, (f, kind, loop, vol) in EXTERNAL.items():
        src = SOUND_DIR / f
        if not src.exists():
            print("missing", src, file=sys.stderr)
            continue
        shutil.copy(src, OUT / f)
        index["sounds"][name] = {"file": f, "kind": kind, "loop": loop, "volume": vol}
    swfs = sorted(ASSETS.rglob("*.swf"))
    with ThreadPoolExecutor(8) as ex:
        for swf, files in ex.map(export_swf, swfs):
            if not files:
                continue
            ff = shutil.which("ffmpeg")
            entries = []
            for p in files:
                if ff and p.suffix.lower() != ".mp3":
                    mp3 = p.with_suffix(".mp3")
                    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(p), str(mp3)])
                    if mp3.exists():
                        p.unlink()
                        p = mp3
                entries.append(str(p.relative_to(OUT)))
            index["embedded"][swf.stem] = entries
    (OUT / "index.json").write_text(json.dumps(index, indent=2))
    print(f"{len(index['sounds'])} external, {sum(map(len, index['embedded'].values()))} embedded sounds")


if __name__ == "__main__":
    main()
