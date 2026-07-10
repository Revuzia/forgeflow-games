#!/usr/bin/env python3
"""meshy_prop_bow.py — one-off: generate a proper recurve BOW prop for Thronedrift.

Same Meshy text-to-3d flow as meshy_chars.py but for a static prop (no rig):
preview -> refine (textured) -> download GLB to games/thronedrift/assets/props/bow.glb

State checkpointed to state/meshy_prop_bow_state.json (tasks are billed — resume,
never resubmit). Usage:
    python pipeline/meshy_prop_bow.py --submit
    python pipeline/meshy_prop_bow.py --advance   # poll until downloaded
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_prop_bow_state.json"
OUT = ROOT / "games" / "thronedrift" / "assets" / "props"

API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

PROMPT = (
    "Low poly stylized fantasy recurve bow, dark polished wood limbs with ornate gold tips, "
    "leather-wrapped grip in the middle, taut bowstring, elegant curved silhouette, "
    "hand-painted texture style, game-ready weapon prop, single object, upright vertical "
    "orientation, no arrow, no character"
)


def req(path, body=None):
    r = urllib.request.Request(API + path, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    if body is not None:
        r.data = json.dumps(body).encode()
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode())


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"stage": "new"}


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=2))


def download(url, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    print(f"downloaded -> {dest} ({dest.stat().st_size//1024} KB)")


def submit(st):
    if st["stage"] != "new":
        print(f"already at stage {st['stage']} — use --advance")
        return
    res = req("/openapi/v2/text-to-3d", {
        "mode": "preview", "prompt": PROMPT,
        "target_polycount": 8000, "should_remesh": True, "target_formats": ["glb"],
    })
    st["preview_id"] = res["result"]
    st["stage"] = "preview"
    save_state(st)
    print(f"preview task {st['preview_id']}")


def advance(st):
    while True:
        if st["stage"] == "preview":
            t = req(f"/openapi/v2/text-to-3d/{st['preview_id']}")
            print(f"  preview: {t['status']} {t.get('progress', 0)}%")
            if t["status"] == "SUCCEEDED":
                res = req("/openapi/v2/text-to-3d", {
                    "mode": "refine", "preview_task_id": st["preview_id"], "enable_pbr": False})
                st["refine_id"] = res["result"]
                st["stage"] = "refine"
                save_state(st)
            elif t["status"] in ("FAILED", "CANCELED"):
                print("preview failed:", t.get("task_error"))
                return 1
        elif st["stage"] == "refine":
            t = req(f"/openapi/v2/text-to-3d/{st['refine_id']}")
            print(f"  refine: {t['status']} {t.get('progress', 0)}%")
            if t["status"] == "SUCCEEDED":
                download(t["model_urls"]["glb"], OUT / "bow.glb")
                st["stage"] = "done"
                save_state(st)
                return 0
            elif t["status"] in ("FAILED", "CANCELED"):
                print("refine failed:", t.get("task_error"))
                return 1
        elif st["stage"] == "done":
            print("already done:", OUT / "bow.glb")
            return 0
        time.sleep(15)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--advance", action="store_true")
    a = ap.parse_args()
    st = load_state()
    if a.submit:
        submit(st)
    if a.advance:
        sys.exit(advance(st))
