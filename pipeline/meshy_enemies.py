#!/usr/bin/env python3
"""meshy_enemies.py — generate ORIGINAL rigged enemies for Dungeon Forge via Meshy.

Same pipeline as meshy_chars.py (text-to-3d preview -> refine -> auto-rig ->
base + walking + running GLBs), but for bipedal ENEMIES. Auto-rig only handles
humanoid/biped shapes well, so every prompt below is a standing biped.

Output: games/dungeon-forge/assets/enemies/meshy/<name>/{base,walk,run}.glb
(a separate Meshy-enemy loader in assets.js consumes these, mirroring chars()).

Usage:
    python pipeline/meshy_enemies.py --submit
    python pipeline/meshy_enemies.py --watch
"""
import argparse
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_enemies_state.json"
OUT = ROOT / "games" / "dungeon-forge" / "assets" / "enemies" / "meshy"

API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

# name -> (theme, prompt). All bipedal so Meshy auto-rig produces a clean skeleton.
ENEMIES = {
    "cultist": ("fantasy",
        "Low poly stylized fantasy dungeon cultist enemy, tattered dark crimson hooded robe, "
        "bony gaunt frame, glowing eyes under the hood, clawed hands, menacing, hand-painted "
        "texture style, game-ready character, standing A-pose, facing forward"),
    "ogre": ("fantasy",
        "Low poly stylized fantasy ogre brute enemy, huge hulking muscular green-skinned body, "
        "small tusks, ragged loincloth and bone trophies, heavy fists, hunched menacing posture, "
        "hand-painted texture style, game-ready character, standing A-pose, facing forward"),
    "cyborg": ("scifi",
        "Low poly stylized sci-fi combat cyborg enemy soldier, sleek dark metal armor with "
        "glowing cyan energy lines, single red optic eye, angular armored limbs, menacing, "
        "hand-painted texture style, game-ready character, standing A-pose, facing forward"),
    "sentinel": ("scifi",
        "Low poly stylized sci-fi security sentinel mech enemy, bulky bipedal battle robot, "
        "matte gunmetal plating with orange warning stripes, heavy shoulder cannons, glowing "
        "visor, hand-painted texture style, game-ready character, standing A-pose, facing forward"),
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
                time.sleep(2 ** (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {path}: {detail}")
        except Exception:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1)); continue
            raise
    raise RuntimeError("retries exhausted")


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"enemies": {k: {"stage": "new", "theme": v[0]} for k, v in ENEMIES.items()}}


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def download(url, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    return dest.stat().st_size


def submit(st):
    for name, (theme, prompt) in ENEMIES.items():
        c = st["enemies"][name]
        if c["stage"] != "new":
            print(f"[{name}] already {c['stage']}"); continue
        res = req("/openapi/v2/text-to-3d", {
            "mode": "preview", "prompt": prompt, "pose_mode": "a-pose",
            "target_polycount": 14000, "should_remesh": True, "target_formats": ["glb"],
        })
        c["preview_id"] = res["result"]; c["stage"] = "preview"
        print(f"[{name}] preview task {c['preview_id']}"); save_state(st)


def advance(st):
    busy = False
    for name in ENEMIES:
        c = st["enemies"][name]
        try:
            if c["stage"] == "preview":
                t = req(f"/openapi/v2/text-to-3d/{c['preview_id']}")
                print(f"[{name}] preview {t['status']} {t.get('progress',0)}%")
                if t["status"] == "SUCCEEDED":
                    res = req("/openapi/v2/text-to-3d", {
                        "mode": "refine", "preview_task_id": c["preview_id"],
                        "enable_pbr": False, "target_formats": ["glb"]})
                    c["refine_id"] = res["result"]; c["stage"] = "refine"
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = t.get("task_error", t["status"])
                else: busy = True
            elif c["stage"] == "refine":
                t = req(f"/openapi/v2/text-to-3d/{c['refine_id']}")
                print(f"[{name}] refine {t['status']} {t.get('progress',0)}%")
                if t["status"] == "SUCCEEDED":
                    res = req("/openapi/v1/rigging", {"input_task_id": c["refine_id"], "height_meters": 1.9})
                    c["rig_id"] = res["result"]; c["stage"] = "rig"
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = t.get("task_error", t["status"])
                else: busy = True
            elif c["stage"] == "rig":
                t = req(f"/openapi/v1/rigging/{c['rig_id']}")
                print(f"[{name}] rig {t['status']} {t.get('progress',0)}%")
                if t["status"] == "SUCCEEDED":
                    r = t.get("result", t)
                    base = r.get("rigged_character_glb_url")
                    anims = r.get("basic_animations", {})
                    n1 = download(base, OUT / name / "base.glb")
                    n2 = download(anims.get("walking_glb_url"), OUT / name / "walk.glb") if anims.get("walking_glb_url") else 0
                    n3 = download(anims.get("running_glb_url"), OUT / name / "run.glb") if anims.get("running_glb_url") else 0
                    c["stage"] = "done"; c["rig_id_done"] = c["rig_id"]
                    print(f"[{name}] DONE base={n1//1024}KB walk={n2//1024}KB run={n3//1024}KB")
                elif t["status"] in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = str(t.get("task_error", t["status"]))[:200]
                else: busy = True
        except Exception as e:
            print(f"[{name}] ERROR: {e}"); busy = True
        save_state(st)
    return busy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--advance", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    st = load_state()
    if args.submit: submit(st)
    if args.advance: advance(st)
    if args.watch:
        for _ in range(120):
            busy = advance(st)
            print("stages:", {k: v["stage"] for k, v in st["enemies"].items()}, flush=True)
            if not busy and all(v["stage"] in ("done", "failed") for v in st["enemies"].values()):
                break
            time.sleep(30)
    print(json.dumps({k: v["stage"] for k, v in st["enemies"].items()}))


if __name__ == "__main__":
    main()
