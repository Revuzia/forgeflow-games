#!/usr/bin/env python3
"""colosseum_meshy_meshes.py — 11 gladiator MESHES (textured, UNRIGGED) from
the QC'd xAI T-pose pairs, via Meshy multi-image-to-3d (front+back views).
Rigging is deliberately NOT done here: the owner uploads each mesh to Mixamo
and places markers by hand (50+ bone rigs).

    python pipeline/colosseum_meshy_meshes.py          # submit missing + poll all

Resumable: state in state/colosseum_meshy_meshes.json; finished GLBs land in
games/colosseum/tools/mixamo_meshes/<name>.glb (tools/ never ships).
"""
import base64, json, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "colosseum_meshy_meshes.json"
REFS = ROOT / "games" / "colosseum" / "tools" / "mixamo_refs"
OUT = ROOT / "games" / "colosseum" / "tools" / "mixamo_meshes"
API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"
NAMES = ["crupellarius", "dimachaerus", "eques", "hoplomachus", "minotaur",
         "murmillo", "provocator", "retiarius", "scissor", "secutor", "thraex"]


def req(path, body=None):
    r = urllib.request.Request(API + path,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {path}: {detail}")
    raise RuntimeError("retries exhausted")


def load():
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1))


def submit_missing(st):
    for n in NAMES:
        c = st.setdefault(n, {})
        if c.get("task") or c.get("done"):
            continue
        views = []
        for view in ("front", "back"):
            b = (REFS / f"{n}_{view}.png").read_bytes()
            views.append("data:image/png;base64," + base64.b64encode(b).decode())
        # 2048 textures, NOT 4096: eleven 4K character maps would hold ~700MB
        # of VRAM in a browser and tank FPS; 2K is the web standard for hero
        # characters and reads clean at the duel camera. 20k tris = the proven
        # DF budget. NO Draco here — Mixamo cannot read Draco'd files; geometry
        # gets Draco-compressed at integration AFTER rigging (LC pattern, ~10x).
        body = {"image_urls": views, "ai_model": "meshy-6", "should_texture": True,
                "enable_pbr": False, "topology": "triangle", "target_polycount": 20000,
                "texture_resolution": "2k"}
        c["task"] = req("/openapi/v1/multi-image-to-3d", body)["result"]
        print(f"[{n}] submitted {c['task']}", flush=True)
        save(st)
        time.sleep(0.5)


def poll(st):
    while True:
        pending = 0
        for n in NAMES:
            c = st.get(n, {})
            if c.get("done") or not c.get("task"):
                continue
            t = req(f"/openapi/v1/multi-image-to-3d/{c['task']}")
            status = t.get("status")
            if status == "SUCCEEDED":
                url = (t.get("model_urls") or {}).get("glb")
                OUT.mkdir(parents=True, exist_ok=True)
                dst = OUT / f"{n}.glb"
                rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(rq, timeout=300) as resp, open(dst, "wb") as f:
                    f.write(resp.read())
                c["done"] = True
                print(f"[{n}] DONE {dst.stat().st_size} bytes", flush=True)
                save(st)
            elif status in ("FAILED", "CANCELED"):
                print(f"[{n}] {status}: {t.get('task_error')}", flush=True)
                c["task"] = None            # allow resubmit on next run
                c["fails"] = c.get("fails", 0) + 1
                save(st)
                if c["fails"] < 3:
                    pending += 1
            else:
                pending += 1
        if not pending:
            break
        time.sleep(30)
    done = sum(1 for n in NAMES if st.get(n, {}).get("done"))
    print(f"complete: {done}/{len(NAMES)} meshes", flush=True)
    return done


if __name__ == "__main__":
    st = load()
    submit_missing(st)
    n = poll(st)
    sys.exit(0 if n == len(NAMES) else 1)
