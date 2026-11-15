#!/usr/bin/env python3
"""meshy_lc_crouch.py — author a CROUCH clip for Last Circle's five skins.

Why this exists: crouch shipped (?v=49) as speed + accuracy + camera only. The
hit capsule was deliberately NOT shrunk, because these Meshy rigs have no crouch
clip and a procedural leg-fold was tried and rejected — captures showed the
character kneeling in mid-air (no IK to plant the feet). A shrunken capsule
under a visibly standing model means shots at a plainly visible head passing
through it. This job lands the authored clip that unblocks it; once a skin has
<skin>_crouch.glb the sim's CROUCH.heightMult goes from 1 to ~0.62.

Candidates come from the Meshy animation library (docs.meshy.ai animation-library):
  524 Cautious_Crouch_Walk_Forward   — crouched locomotion, unarmed
  523 Cautious_Crouch_Walk_Backward  — same family, different phase
  527 Crouch_Walk_Left_with_Gun      — crouched WITH a weapon
   54 Squat_Stance                   — stationary low stance (crouch idle)
Arm content matters little: pose.js overrides the arm chains every frame
(Meshy's armed clips retarget badly on these rigs). What matters is that the
LEGS and hips read as a genuine crouch with the feet on the floor.

Reuses the rigging/GLB surgery from meshy_lc_run.py verbatim; keeps its OWN
state file, and must never run while another meshy_* job is live (last writer
wins on shared state).

  python pipeline/meshy_lc_crouch.py --bakeoff --watch
  python pipeline/meshy_lc_crouch.py --rollout 524 --watch
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import meshy_lc_run as R  # noqa: E402  (rigging + strip_clip + polling, verbatim)

ROOT = HERE.parent
STATE = ROOT.parent / "state" / "meshy_lc_crouch_state.json"
OUT = ROOT / "asset_gen" / "lc_crouch_bakeoff"
CHARS = R.CHARS
SKINS = R.SKINS
CANDIDATES = [524, 523, 527, 54]
CLIP = "crouch"


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"bakeoff": {"stage": "new", "cands": {}}, "rollout": {}}


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def bakeoff(st, watch):
    R.OUT = OUT          # rig_char writes its stripped static GLB here
    OUT.mkdir(parents=True, exist_ok=True)
    b = st["bakeoff"]
    if b["stage"] == "new":
        b["rig_id"] = R.rig_char("soldier")
        b["stage"] = "rig"
        save_state(st)
    while True:
        if b["stage"] == "rig":
            s, t = R.poll_rig(b["rig_id"])
            print(f"[soldier] rig {s} {t.get('progress', 0)}%", flush=True)
            if s == "SUCCEEDED":
                res = t.get("result", t)
                R.dl(res.get("rigged_character_glb_url"), OUT / "soldier_base_new.glb")
                for a in CANDIDATES:
                    r = R.req("/openapi/v1/animations", {"rig_task_id": b["rig_id"], "action_id": a})
                    b["cands"][str(a)] = {"id": r["result"], "stage": "run"}
                    print(f"[soldier/{a}] anim task {r['result']}", flush=True)
                    time.sleep(0.4)
                b["stage"] = "anims"
                save_state(st)
            elif s in ("FAILED", "CANCELED"):
                b["stage"] = "failed"
                b["err"] = str(t.get("task_error", s))[:300]
                save_state(st)
                break
        elif b["stage"] == "anims":
            pend = 0
            for a, c in b["cands"].items():
                if c["stage"] != "run":
                    continue
                s, r = R.poll_anim(c["id"])
                if s == "SUCCEEDED":
                    res = r.get("result", r)
                    url = res.get("animation_glb_url") or r.get("animation_glb_url")
                    tmp = OUT / f"_raw_{a}.glb"
                    R.dl(url, tmp)
                    R.strip_clip(tmp, OUT / f"soldier_test_{a}.glb")
                    tmp.unlink()
                    c["stage"] = "done"
                    print(f"[soldier/{a}] DONE -> soldier_test_{a}.glb", flush=True)
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"
                    c["err"] = str(r.get("task_error", s))[:200]
                    print(f"[soldier/{a}] FAILED {c['err']}", flush=True)
                else:
                    pend += 1
            save_state(st)
            if pend == 0:
                b["stage"] = "done"
                break
        else:
            break
        if not watch:
            break
        time.sleep(20)
    print("BAKEOFF:", json.dumps({a: c["stage"] for a, c in b["cands"].items()}))


def rollout(st, action, watch):
    """Ship the chosen crouch action to all 5 skins as <skin>_crouch.glb."""
    R.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    r = st.setdefault("rollout", {})
    r["action"] = action
    chars = r.setdefault("chars", {})
    src = OUT / f"soldier_test_{action}.glb"
    if src.exists() and chars.get("soldier", {}).get("stage") != "done":
        (CHARS / f"soldier_{CLIP}.glb").write_bytes(src.read_bytes())
        chars["soldier"] = {"stage": "done", "reused": True}
        print(f"[soldier] reused bake-off action {action} -> soldier_{CLIP}.glb", flush=True)
        save_state(st)
    todo = [s for s in SKINS if chars.get(s, {}).get("stage") != "done"]
    for skin in todo:
        c = chars.setdefault(skin, {"stage": "new"})
        if c["stage"] == "new":
            c["rig_id"] = R.rig_char(skin)
            c["stage"] = "rig"
            save_state(st)
    while watch:
        busy = False
        for skin in todo:
            c = chars[skin]
            if c["stage"] == "rig":
                s, t = R.poll_rig(c["rig_id"])
                print(f"[{skin}] rig {s} {t.get('progress', 0)}%", flush=True)
                if s == "SUCCEEDED":
                    res = R.req("/openapi/v1/animations", {"rig_task_id": c["rig_id"], "action_id": action})
                    c["anim_id"] = res["result"]
                    c["stage"] = "anim"
                    busy = True
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"
                    c["err"] = str(t.get("task_error", s))[:200]
                else:
                    busy = True
            elif c["stage"] == "anim":
                s, rr = R.poll_anim(c["anim_id"])
                if s == "SUCCEEDED":
                    res = rr.get("result", rr)
                    url = res.get("animation_glb_url") or rr.get("animation_glb_url")
                    tmp = OUT / f"_raw_{skin}.glb"
                    R.dl(url, tmp)
                    R.strip_clip(tmp, CHARS / f"{skin}_{CLIP}.glb")
                    tmp.unlink()
                    c["stage"] = "done"
                    print(f"[{skin}] -> {skin}_{CLIP}.glb DONE", flush=True)
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"
                    c["err"] = str(rr.get("task_error", s))[:200]
                else:
                    busy = True
            save_state(st)
        if not busy:
            break
        time.sleep(20)
    print("ROLLOUT:", json.dumps({s: chars.get(s, {}).get("stage") for s in SKINS}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bakeoff", action="store_true")
    ap.add_argument("--rollout", type=int, default=0, help="chosen crouch action id")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    st = load_state()
    if args.bakeoff:
        bakeoff(st, args.watch)
    if args.rollout:
        rollout(st, args.rollout, args.watch)
    print("balance:", R.req("/openapi/v1/balance").get("balance"))


if __name__ == "__main__":
    main()
