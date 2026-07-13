#!/usr/bin/env python3
"""meshy_rig_anims_v2.py — re-rig the four Thronedrift/Dungeon-Forge hero
meshes (old rig task ids expired from the Meshy account) and pull PROPER
animation-library clips against the fresh rigs.

Owner-approved 2026-07-13 (~119 credits: 4 rigs x 5cr + 33 clips x 3cr).

Flow per hero: strip skin from current base.glb (rigging wants an UNRIGGED
textured humanoid, +Z facing) -> POST /openapi/v1/rigging with a data-URI
model_url -> poll -> POST /openapi/v1/animations per library action id ->
poll -> download; rigged GLB saved as base_new.glb, clips stripped to
clip-only GLBs (anim_<name>.glb naming matches the runtime loader).

Usage:
    python pipeline/meshy_rig_anims_v2.py --submit   # kick off riggings
    python pipeline/meshy_rig_anims_v2.py --watch    # advance to completion
"""
import argparse
import base64
import json
import struct
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_rig_anims_v2_state.json"
SRC = ROOT / "games" / "thronedrift" / "assets" / "chars" / "meshy"
OUT = ROOT / "asset_gen" / "meshy_v2_rigs"

API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

# library action ids (docs.meshy.ai/en/api/animation-library):
# 85 Axe_Stance · 89 Combat_Stance · 11 Idle_02 · 12 Idle_03
# 21 Walk_Fight_Forward · 14 Run_02 · 15 Run_03
# 224-226 Archery variants · 125/129 spell casts · 172 hit · 8 death
PLAN = {
    "barbarian": {"height": 1.9,
        "clips": [("idle", 85), ("walk", 21), ("run", 14), ("slash1", 237), ("slash2", 238), ("finisher", 128), ("hit", 172), ("death", 8)]},
    "knight": {"height": 1.8,
        "clips": [("idle", 89), ("walk", 21), ("run", 14), ("slash1", 219), ("slash2", 97), ("finisher", 242), ("parry", 147), ("hit", 172), ("death", 8)]},
    "rogue": {"height": 1.75,
        "clips": [("idle", 11), ("walk", 21), ("run", 15), ("slash1", 224), ("slash2", 225), ("finisher", 226), ("hit", 172), ("death", 8)]},
    "sorceress": {"height": 1.72,
        "clips": [("idle", 12), ("walk", 21), ("run", 14), ("melee", 4), ("cast1", 125), ("cast2", 129), ("hit", 172), ("death", 8)]},
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
            with urllib.request.urlopen(r, timeout=180) as resp:
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
    return {"chars": {c: {"stage": "new", "anims": {}} for c in PLAN}}


def save_state(st):
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def strip_skin_glb(src: Path, dst: Path):
    """Unrig a GLB: drop skins + JOINTS/WEIGHTS attributes + detach the
    armature from the scene. Unused accessors stay (valid glTF, Meshy
    re-rigs from the mesh)."""
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    boff = 20 + jlen + 8
    bin_ = buf[boff:]

    skin_roots = set()
    for s in js.get("skins", []):
        if s.get("skeleton") is not None:
            skin_roots.add(s["skeleton"])
        for j in s.get("joints", []):
            skin_roots.add(j)
    js.pop("skins", None)
    for n in js.get("nodes", []):
        n.pop("skin", None)
    for m in js.get("meshes", []):
        for p in m.get("primitives", []):
            p.get("attributes", {}).pop("JOINTS_0", None)
            p.get("attributes", {}).pop("WEIGHTS_0", None)
    # detach bone subtrees from scenes + parents (keep mesh nodes)
    def prune(lst):
        return [i for i in lst if i not in skin_roots]
    for sc in js.get("scenes", []):
        sc["nodes"] = prune(sc.get("nodes", []))
    for n in js.get("nodes", []):
        if n.get("children"):
            n["children"] = prune(n["children"])
            if not n["children"]:
                n.pop("children")
    js.pop("animations", None)

    jbytes = json.dumps(js, separators=(",", ":")).encode()
    jbytes += b" " * ((4 - len(jbytes) % 4) % 4)
    total = 12 + 8 + len(jbytes) + 8 + len(bin_)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jbytes), 0x4E4F534A))
        f.write(jbytes)
        f.write(struct.pack("<II", len(bin_), 0x004E4942))
        f.write(bin_)


def strip_clip(src: Path, dst: Path):
    """Clip-only GLB (nodes + animations + their accessors) — same routine
    the original meshy_anims.py used; runtime retargets by bone name."""
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    boff = 20 + jlen + 8
    bin_ = buf[boff:]
    keep_acc = set()
    for a in js.get("animations", []):
        for s in a.get("samplers", []):
            keep_acc.add(s["input"]); keep_acc.add(s["output"])
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


def submit(st):
    OUT.mkdir(parents=True, exist_ok=True)
    for char, cfg in PLAN.items():
        c = st["chars"][char]
        if c["stage"] != "new":
            continue
        static = OUT / f"{char}_static.glb"
        strip_skin_glb(SRC / char / "base.glb", static)
        uri = "data:model/gltf-binary;base64," + base64.b64encode(static.read_bytes()).decode()
        res = req("/openapi/v1/rigging", {"model_url": uri, "height_meters": cfg["height"]})
        c["rig_id"] = res["result"]
        c["stage"] = "rig"
        print(f"[{char}] rigging task {c['rig_id']} ({static.stat().st_size // 1024}KB static)", flush=True)
        save_state(st)
        time.sleep(0.5)


def advance(st):
    busy = False
    for char, cfg in PLAN.items():
        c = st["chars"][char]
        if c["stage"] == "rig":
            t = req(f"/openapi/v1/rigging/{c['rig_id']}")
            s = t.get("status")
            print(f"[{char}] rig {s} {t.get('progress', 0)}%", flush=True)
            if s == "SUCCEEDED":
                r = t.get("result", t)
                url = r.get("rigged_character_glb_url")
                dst = OUT / char
                dst.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(url, dst / "base_new.glb")
                print(f"[{char}] rigged GLB {(dst / 'base_new.glb').stat().st_size // 1024}KB", flush=True)
                for name, action in cfg["clips"]:
                    res = req("/openapi/v1/animations", {"rig_task_id": c["rig_id"], "action_id": action})
                    c["anims"][name] = {"id": res["result"], "action": action, "stage": "run"}
                    time.sleep(0.4)
                c["stage"] = "anims"
                busy = True
            elif s in ("FAILED", "CANCELED"):
                c["stage"] = "failed"
                c["error"] = str(t.get("task_error", s))[:300]
                print(f"[{char}] RIG FAILED: {c['error']}", flush=True)
            else:
                busy = True
        elif c["stage"] == "anims":
            pend = 0
            for name, a in c["anims"].items():
                if a["stage"] != "run":
                    continue
                r = req(f"/openapi/v1/animations/{a['id']}")
                s = r.get("status")
                if s == "SUCCEEDED":
                    res = r.get("result", r)
                    url = res.get("animation_glb_url") or r.get("animation_glb_url")
                    tmp = OUT / char / f"_raw_{name}.glb"
                    urllib.request.urlretrieve(url, tmp)
                    strip_clip(tmp, OUT / char / f"anim_{name}.glb")
                    tmp.unlink()
                    a["stage"] = "done"
                    print(f"[{char}/{name}] DONE", flush=True)
                elif s in ("FAILED", "CANCELED"):
                    a["stage"] = "failed"
                    a["error"] = str(r.get("task_error", s))[:200]
                    print(f"[{char}/{name}] FAILED {a['error']}", flush=True)
                else:
                    pend += 1
            if pend:
                busy = True
            elif all(a["stage"] in ("done", "failed") for a in c["anims"].values()):
                c["stage"] = "done"
                print(f"[{char}] ALL CLIPS COMPLETE", flush=True)
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
            if not busy and all(c["stage"] in ("done", "failed") for c in st["chars"].values()):
                break
            time.sleep(20)
    print("FINAL:", json.dumps({k: v["stage"] for k, v in st["chars"].items()}))
    bal = req("/openapi/v1/balance")
    print("balance:", bal.get("balance"))


if __name__ == "__main__":
    main()
