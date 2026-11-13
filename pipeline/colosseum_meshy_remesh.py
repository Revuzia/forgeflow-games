#!/usr/bin/env python3
"""colosseum_meshy_remesh.py — reduce the 11 gladiator meshes to game budget
using MESHY'S FEATURE-AWARE REMESH, not a uniform decimator.

Why this exists: Meshy's multi-image-to-3d ignores target_polycount and returns
253k-798k tris. Reducing that with Blender's uniform Collapse decimate erased
every face (nose/eyes/mouth gone at ~94% reduction) while armor and limbs still
looked fine — the failure is invisible in a full-body render, which is how it
reached an upload. Meshy's own remesh preserves silhouette features, and is the
same step that gave the shipping cast intact faces at 11-13k tris.

    python pipeline/colosseum_meshy_remesh.py

Reads the image-to-3d task ids already in state/colosseum_meshy_meshes.json, so
nothing is regenerated from scratch. Raw meshes are moved to _raw/ first.
"""
import json, shutil, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "colosseum_meshy_meshes.json"
OUT = ROOT / "games" / "colosseum" / "tools" / "mixamo_meshes"
RAW = OUT / "_raw"
API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"
TARGET = 20000          # shipping cast is 11-13k; 20k buys facial fidelity cheaply
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


st = json.loads(STATE.read_text())

# preserve the heavy originals once
RAW.mkdir(parents=True, exist_ok=True)
for n in NAMES:
    src, dst = OUT / f"{n}.glb", RAW / f"{n}.glb"
    if src.exists() and not dst.exists():
        shutil.move(str(src), str(dst))

for n in NAMES:
    c = st.setdefault(n, {})
    if c.get("remesh_done"):
        continue
    if not c.get("remesh"):
        c["remesh"] = req("/openapi/v1/remesh", {
            "input_task_id": c["task"], "target_polycount": TARGET,
            "target_formats": ["glb"], "topology": "triangle"})["result"]
        print(f"[{n}] remesh {c['remesh']}", flush=True)
        STATE.write_text(json.dumps(st, indent=1))
        time.sleep(0.4)

while True:
    pending = 0
    for n in NAMES:
        c = st[n]
        if c.get("remesh_done"):
            continue
        t = req(f"/openapi/v1/remesh/{c['remesh']}")
        s = t.get("status")
        if s == "SUCCEEDED":
            url = (t.get("model_urls") or {}).get("glb")
            rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            dst = OUT / f"{n}.glb"
            with urllib.request.urlopen(rq, timeout=300) as resp, open(dst, "wb") as f:
                f.write(resp.read())
            c["remesh_done"] = True
            print(f"[{n}] DONE {dst.stat().st_size/1e6:.1f} MB", flush=True)
            STATE.write_text(json.dumps(st, indent=1))
        elif s in ("FAILED", "CANCELED"):
            print(f"[{n}] {s}: {t.get('task_error')}", flush=True)
            c["remesh"] = None; STATE.write_text(json.dumps(st, indent=1))
        else:
            pending += 1
    if not pending:
        break
    time.sleep(20)

done = sum(1 for n in NAMES if st[n].get("remesh_done"))
print(f"remeshed {done}/{len(NAMES)}")
sys.exit(0 if done == len(NAMES) else 1)
