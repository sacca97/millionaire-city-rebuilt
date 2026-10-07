"""Shared helpers for the mission parity tooling (read-only on game data)."""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES = ROOT / "assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules"
OUT = ROOT / "tools/missions/out"
NAME_TYPES = {"Houses", "Commerces", "Decorations", "Wonders", "Clubs"}
ITEM_FILES = ["itemDefinitions.xml", "commerceDefinitions.xml", "decorationDefinitions.xml", "wonderDefinitions.xml", "clubDefinitions.xml"]


def attrs(tag: str) -> dict:
    return dict(re.findall(r'([\w:]+)="([^"]*)"', tag))


def load_missions() -> list[dict]:
    s = (RULES / "missionDefinitions.xml").read_text()
    out = []
    for i, m in enumerate(re.finditer(r"<Definition\s+([^>]*?)/?>", s)):
        a = attrs(m.group(1))
        a["_order"] = i
        a["_set"] = "alt" if a.get("showInABtest") == "alt_missions" else "default"
        out.append(a)
    return out


def load_item_skus() -> set[str]:
    skus = set()
    for f in ITEM_FILES:
        p = RULES / f
        if p.exists():
            skus |= set(re.findall(r'\bsku="([^"]+)"', p.read_text()))
    return skus


def load_item_keys() -> set[str]:
    """Event parameter keys an item can register (mirrors apps/client/src/game/missions.ts itemEventParameters):
    nameType, nameType_<subtype> for each comma-separated subtype, and the sku itself."""
    keys = set(NAME_TYPES)
    kinds = {"itemDefinitions.xml": "Houses", "commerceDefinitions.xml": "Commerces", "decorationDefinitions.xml": "Decorations",
             "wonderDefinitions.xml": "Wonders", "clubDefinitions.xml": "Clubs"}
    for f, nt in kinds.items():
        p = RULES / f
        if not p.exists():
            continue
        for tag in re.findall(r"<Definition\s+([^>]*?)/?>", p.read_text()):
            a = attrs(tag)
            if "sku" not in a:
                continue
            keys.add(a["sku"])
            for st in a.get("subtype", "").split(","):
                if st.strip():
                    keys.add(f"{nt}_{st.strip()}")
            if "subsku" in a:
                keys.add(a["subsku"])
    return keys


def param_kind(m: dict, skus: set[str], keys: set[str]) -> str:
    p = m.get("parameter", "")
    if p == "":
        return "none"
    if "%" in p:
        return "typeAndDuration"
    if p in NAME_TYPES:
        return "nameType"
    if p in skus:
        return "sku"
    if p in keys:
        return "subgroup"
    return "other"


def reward_form(t: str | None) -> str:
    if not t:
        return "-"
    parts = t.split(";")
    return "+".join("item" if x not in ("coins", "exp") else x for x in parts)
