#!/usr/bin/env python3
"""Write the presentation fields the VFX kit needs into content/fighters/<id>.json (never the `art` block):

  vfx                          { signature, secondary } from tools/vfx/signatures.py (r12 M12)
  attack.windup                the basic attack's wind-up share (r12 M5: melee 0.25-0.28, ranged 0.21-0.24 of the
                               attack period, i.e. 0.37-0.44 s / 0.31-0.37 s at base attack speed)
  attack.present.windupVfx     <f>_atk_swing (melee) / <f>_atk_draw (ranged); attack.present.vfx <f>_atk_shot (ranged)
  kit.<slot>.present.windupVfx every timed cast's <f>_<slot>_windup (r12 M3; tools/vfx/kit_defs.py)
  telegraphs (r12 M1)          the delayed areas that damage or control are warned to everyone (ALL_SEE)

    python3 tools/vfx/kit_present.py        # then: python3 tools/vfx/build_vfx.py && node tools/build_content.ts --check

Idempotent; each file is read and written back at once (other lanes edit the art block of the same files).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from kit_defs import FIGHTERS, plan  # noqa: E402
from signatures import pairs  # noqa: E402

# the basic attack wind-up share of the attack period (r12 M5); heavier weapons sit at the top of the band
ATTACK_WINDUP = {
    "ardit": 0.26, "burdam": 0.28, "ervet": 0.27, "hesmi": 0.28, "kemdo": 0.27, "marund": 0.27, "nurrow": 0.25, "rishal": 0.25,
    "dunsom": 0.23, "ilsheta": 0.23, "lisvel": 0.21, "odrum": 0.23, "sukri": 0.23, "tunlan": 0.24, "ulkro": 0.21, "vashil": 0.24,
}

# r12 M1: delayed areas that damage or control, hidden from enemies before; now everyone sees them (ability id → areas)
ALL_SEE = {"marund_mortar_pail", "sukri_mote_toss", "sukri_gather_in"}
# r12 M1: a delayed area that repeats (its later passes get no wind-up) needs >= 0.6 s of its own (ability id → delay)
MIN_DELAY = {"vashil_morning_toll": 0.6}


def _min_delay(effs, d: float) -> None:
    for e in effs or []:
        if not isinstance(e, dict):
            continue
        if e.get("op") in ("area", "zone") and 0 < (e.get("delay") or 0) < d and _harms(e):
            e["delay"] = d
        for k in ("effects", "then", "else", "onHit", "onArrive", "onEnd", "onExpire", "onPass", "onTick", "onCenter", "onEnter"):
            if isinstance(e.get(k), list):
                _min_delay(e[k], d)


def _harms(e: dict) -> bool:
    if (e.get("filter") or {}).get("enemies") is False:
        return False
    s = json.dumps(e)
    return any(f'"op": "{op}"' in s for op in ("damage", "status", "displace", "pull"))


def _abilities(kit: dict):
    for slot in ("a1", "a2", "a3", "ult"):
        a = kit.get(slot)
        if a:
            yield a
            if a.get("recast"):
                yield a["recast"]["ability"]


def main() -> None:
    P = plan()
    sig = pairs()
    for path in sorted(FIGHTERS.glob("*.json")):
        rec = json.loads(path.read_text(encoding="utf-8"))
        fid = rec["id"]
        if fid not in P:
            continue
        before = json.dumps(rec, ensure_ascii=False)
        rec["vfx"] = sig[fid]
        rec["attack"]["windup"] = ATTACK_WINDUP[fid]
        pres = rec["attack"].setdefault("present", {})
        pres.update(P[fid]["attack"])
        kits = [rec["kit"]] + [fm["kit"] for fm in (rec["kit"]["passive"].get("forms") or {}).values() if fm.get("kit")]
        for kit in kits:
            for ab in _abilities(kit):
                wid = P[fid]["windups"].get(ab["id"])
                if wid:
                    ab.setdefault("present", {})["windupVfx"] = wid
                if ab["id"] in MIN_DELAY:
                    _min_delay(ab.get("effects"), MIN_DELAY[ab["id"]])
                if ab["id"] in ALL_SEE:
                    ab.setdefault("present", {})["telegraph"] = "everyone"
                    for e in ab.get("effects", []):
                        if e.get("op") in ("area", "zone") and _harms(e) and (e.get("present") or {}).get("telegraph") in ("ally_only", "none"):
                            e["present"]["telegraph"] = "everyone"
        if json.dumps(rec, ensure_ascii=False) != before:
            path.write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{fid}: updated")


if __name__ == "__main__":
    main()
