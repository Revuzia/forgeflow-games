#!/usr/bin/env python3
"""meshy_anims.py — apply Meshy animation-library clips to the Dungeon Forge
rigged party, then strip each result to a tiny clip-only GLB (nodes+animation,
no mesh/textures) for runtime retargeting by bone name.

Usage:
    python pipeline/meshy_anims.py --submit
    python pipeline/meshy_anims.py --watch
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_anims_state.json"
CHARS_STATE = ROOT.parent / "state" / "meshy_chars_state.json"
OUT = ROOT / "games" / "dungeon-forge" / "assets" / "chars" / "meshy"

API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

# per-class clip plan: (clip_name, action_id).  idle 0 = calm neutral standing
# (fixes the A-pose "arms out" bind pose in the menu preview + escape idle).
PLAN = {
    "knight": [("idle", 0), ("slash1", 219), ("slash2", 97), ("finisher", 242), ("parry", 147), ("hit", 172), ("death", 8)],
    "barbarian": [("idle", 0), ("slash1", 237), ("slash2", 238), ("finisher", 128), ("hit", 172), ("death", 8)],
    "sorceress": [("idle", 0), ("melee", 4), ("cast1", 125), ("cast2", 129), ("hit", 172), ("death", 8)],
    "rogue": [("idle", 0), ("slash1", 240), ("slash2", 97), ("finisher", 91), ("hit", 172), ("death", 8)],
}


def req(path, body=None):
    r = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
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
    return {"tasks": {}}  # key "char/clip" → {id, stage}


def save_state(st):
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def submit(st):
    chars = json.loads(CHARS_STATE.read_text(encoding="utf-8"))["chars"]
    for char, clips in PLAN.items():
        rig_id = chars[char].get("rig_id")
        if not rig_id:
            print(f"[{char}] no rig_id — skipped")
            continue
        for name, action in clips:
            key = f"{char}/{name}"
            if key in st["tasks"]:
                continue
            res = req("/openapi/v1/animations", {"rig_task_id": rig_id, "action_id": action})
            st["tasks"][key] = {"id": res["result"], "stage": "run", "action": action}
            print(f"[{key}] task {res['result']} (action {action})")
            save_state(st)
            time.sleep(0.4)  # gentle on rate limits


def strip_clip(src: Path, dst: Path):
    """Clip-only GLB: keep node hierarchy + animations (+ their accessors)."""
    import struct
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    boff = 20 + jlen + 8
    bin_ = buf[boff:]

    keep_acc = set()
    for a in js.get("animations", []):
        for s in a.get("samplers", []):
            keep_acc.add(s["input"]); keep_acc.add(s["output"])
    # rebuild accessors/bufferViews for the kept set
    acc_map, bv_map = {}, {}
    new_acc, new_bv = [], []
    new_bin = bytearray()
    for ai in sorted(keep_acc):
        acc = dict(js["accessors"][ai])
        bvi = acc.get("bufferView")
        if bvi is not None:
            if bvi not in bv_map:
                bv = dict(js["bufferViews"][bvi])
                start = bv.get("byteOffset", 0)
                chunk = bin_[start:start + bv["byteLength"]]
                bv["byteOffset"] = len(new_bin)
                new_bin.extend(chunk)
                new_bin.extend(b"\x00" * ((4 - len(new_bin) % 4) % 4))
                bv_map[bvi] = len(new_bv)
                new_bv.append(bv)
            acc["bufferView"] = bv_map[bvi]
        acc_map[ai] = len(new_acc)
        new_acc.append(acc)
    for a in js.get("animations", []):
        for s in a.get("samplers", []):
            s["input"] = acc_map[s["input"]]; s["output"] = acc_map[s["output"]]

    # strip meshes/skins/materials/textures/images from nodes + doc
    for n in js.get("nodes", []):
        n.pop("mesh", None); n.pop("skin", None)
    for k in ["meshes", "skins", "materials", "textures", "images", "samplers", "cameras"]:
        js.pop(k, None)
    js["accessors"] = new_acc
    js["bufferViews"] = new_bv
    js["buffers"] = [{"byteLength": len(new_bin)}]

    jbytes = json.dumps(js, separators=(",", ":")).encode()
    jbytes += b" " * ((4 - len(jbytes) % 4) % 4)
    total = 12 + 8 + len(jbytes) + 8 + len(new_bin)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jbytes), 0x4E4F534A))
        f.write(jbytes)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942))
        f.write(bytes(new_bin))


def advance(st):
    busy = False
    for key, t in st["tasks"].items():
        if t["stage"] != "run":
            continue
        try:
            r = req(f"/openapi/v1/animations/{t['id']}")
            status = r.get("status")
            if status == "SUCCEEDED":
                url = (r.get("result") or r).get("animation_glb_url") or r.get("animation_glb_url")
                char, name = key.split("/")
                tmp = OUT / char / f"_raw_{name}.glb"
                tmp.parent.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(url, tmp)
                dst = OUT / char / f"anim_{name}.glb"
                strip_clip(tmp, dst)
                tmp.unlink()
                t["stage"] = "done"
                print(f"[{key}] DONE {dst.stat().st_size // 1024}KB")
            elif status in ("FAILED", "CANCELED"):
                t["stage"] = "failed"
                t["error"] = str(r.get("task_error", status))[:200]
                print(f"[{key}] FAILED {t['error']}")
            else:
                print(f"[{key}] {status} {r.get('progress', 0)}%")
                busy = True
        except Exception as e:
            print(f"[{key}] ERR {e}")
            busy = True
        save_state(st)
    return busy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    st = load_state()
    if args.submit:
        submit(st)
    if args.watch:
        while True:
            busy = advance(st)
            stages = {}
            for k, v in st["tasks"].items():
                stages[v["stage"]] = stages.get(v["stage"], 0) + 1
            print("stages:", stages, flush=True)
            if not busy and all(v["stage"] in ("done", "failed") for v in st["tasks"].values()):
                break
            time.sleep(25)
    print(json.dumps({k: v["stage"] for k, v in st["tasks"].items()}))


if __name__ == "__main__":
    main()
