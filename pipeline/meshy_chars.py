#!/usr/bin/env python3
"""meshy_chars.py — generate RIGGED player characters for Dungeon Forge via Meshy.

Pipeline per character: text-to-3d preview → refine (textured) → auto-rig
(humanoid skeleton, a-pose, empty hands so in-game weapons/armor attach to
bones) → download base + walking + running GLBs.

State is checkpointed to state/meshy_chars_state.json so the script can be
re-run to resume polling without resubmitting (Meshy tasks are billed).

Usage:
    python pipeline/meshy_chars.py --submit     # kick off previews
    python pipeline/meshy_chars.py --advance    # poll + advance stages + download
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_chars_state.json"
OUT = ROOT / "games" / "dungeon-forge" / "assets" / "chars" / "meshy"

API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

CHARS = {
    "knight": (
        "Low poly stylized fantasy dungeon knight hero, sturdy plate armor with gold trim, "
        "closed great helm with red plume, empty gauntleted hands at sides, heroic proportions, "
        "hand-painted texture style, game-ready character, standing A-pose, facing forward"
    ),
    "barbarian": (
        "Low poly stylized barbarian warrior, muscular build, fur pauldrons and leather straps, "
        "tribal war paint, braided beard, empty hands at sides, hand-painted texture style, "
        "game-ready character, standing A-pose, facing forward"
    ),
    "sorceress": (
        "Low poly stylized sorceress adventurer, elegant hooded violet robe with glowing arcane "
        "runes, ornate belt, empty hands at sides, hand-painted texture style, game-ready "
        "character, standing A-pose, facing forward"
    ),
    "rogue": (
        "Low poly stylized rogue thief adventurer, dark green leather hood and cloak, light "
        "armor with buckles, dagger sheaths on belt but empty hands at sides, hand-painted "
        "texture style, game-ready character, standing A-pose, facing forward"
    ),
}


def req(path, body=None, method=None):
    r = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
        method=method or ("POST" if body is not None else "GET"),
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code} {path}: {detail}")
    raise RuntimeError("retries exhausted")


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"chars": {k: {"stage": "new"} for k in CHARS}}


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def download(url, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    return dest.stat().st_size


def submit(st):
    for name, prompt in CHARS.items():
        c = st["chars"][name]
        if c["stage"] != "new":
            print(f"[{name}] already {c['stage']}")
            continue
        res = req("/openapi/v2/text-to-3d", {
            "mode": "preview",
            "prompt": prompt,
            "pose_mode": "a-pose",
            "target_polycount": 14000,
            "should_remesh": True,
            "target_formats": ["glb"],
        })
        c["preview_id"] = res["result"]
        c["stage"] = "preview"
        print(f"[{name}] preview task {c['preview_id']}")
        save_state(st)


def advance(st):
    """One polling pass: move every char forward when its current task finished."""
    busy = False
    for name in CHARS:
        c = st["chars"][name]
        try:
            if c["stage"] == "preview":
                t = req(f"/openapi/v2/text-to-3d/{c['preview_id']}")
                print(f"[{name}] preview {t['status']} {t.get('progress', 0)}%")
                if t["status"] == "SUCCEEDED":
                    res = req("/openapi/v2/text-to-3d", {
                        "mode": "refine", "preview_task_id": c["preview_id"],
                        "enable_pbr": False, "target_formats": ["glb"],
                    })
                    c["refine_id"] = res["result"]
                    c["stage"] = "refine"
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = t.get("task_error", t["status"])
                else:
                    busy = True
            elif c["stage"] == "refine":
                t = req(f"/openapi/v2/text-to-3d/{c['refine_id']}")
                print(f"[{name}] refine {t['status']} {t.get('progress', 0)}%")
                if t["status"] == "SUCCEEDED":
                    res = req("/openapi/v1/rigging", {
                        "input_task_id": c["refine_id"],
                        "height_meters": 1.75,
                    })
                    c["rig_id"] = res["result"]
                    c["stage"] = "rig"
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = t.get("task_error", t["status"])
                else:
                    busy = True
            elif c["stage"] == "rig":
                t = req(f"/openapi/v1/rigging/{c['rig_id']}")
                print(f"[{name}] rig {t['status']} {t.get('progress', 0)}%")
                if t["status"] == "SUCCEEDED":
                    r = t.get("result", t)
                    base = r.get("rigged_character_glb_url")
                    anims = r.get("basic_animations", {})
                    n1 = download(base, OUT / name / "base.glb")
                    n2 = download(anims.get("walking_glb_url"), OUT / name / "walk.glb") if anims.get("walking_glb_url") else 0
                    n3 = download(anims.get("running_glb_url"), OUT / name / "run.glb") if anims.get("running_glb_url") else 0
                    c["stage"] = "done"
                    print(f"[{name}] DONE base={n1//1024}KB walk={n2//1024}KB run={n3//1024}KB")
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = str(t.get("task_error", t["status"]))[:200]
                else:
                    busy = True
        except Exception as e:
            print(f"[{name}] ERROR: {e}")
            busy = True
        save_state(st)
    return busy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--advance", action="store_true")
    ap.add_argument("--watch", action="store_true", help="poll every 30s until all done/failed")
    args = ap.parse_args()
    st = load_state()
    if args.submit:
        submit(st)
    if args.advance:
        advance(st)
    if args.watch:
        while True:
            busy = advance(st)
            stages = {k: v["stage"] for k, v in st["chars"].items()}
            print("stages:", stages, flush=True)
            if not busy and all(v["stage"] in ("done", "failed") for v in st["chars"].values()):
                break
            time.sleep(30)
    print(json.dumps({k: v["stage"] for k, v in st["chars"].items()}))


if __name__ == "__main__":
    main()
