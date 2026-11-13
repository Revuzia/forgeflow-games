#!/usr/bin/env python3
"""meshy_lc_deaths.py — Last Circle death variety + gunshot hit-react.

Each skin ships exactly ONE death clip (library action 8 "Dead") and NO hit
reaction at all — getting shot shows nothing on the body. Owner sanctioned the
animation pass on the 5 EXISTING meshes (2026-07-26, "make the animations ...
for 5 existing meshes"; emotes explicitly deferred). This fires the combat
subset only:

    death2  action 183  Shot_and_Fall_Backward
    death3  action 184  Shot_and_Fall_Forward
    hit     action 177  Gunshot_Reaction

Cost: 5 re-rigs x 5cr + 15 clips x 3cr = 70 credits (existing balance; the
sanctioned envelope for the full pass was ~145).

The LC rig_task_ids expired from the account (same as meshy_lc_run.py), so each
skin re-rigs from its shipped textured base GLB. Clips are stripped to
clip-only GLBs and written STRAIGHT into the runtime chars dir as
<skin>_death2.glb / <skin>_death3.glb / <skin>_hit.glb (the loader's
MESHY_CLIPS naming).

Resume-safe: state in state/meshy_lc_deaths_state.json. Never run while any
other meshy_* job is live.

  python pipeline/meshy_lc_deaths.py --submit
  python pipeline/meshy_lc_deaths.py --watch
"""
import argparse, base64, json, struct, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_lc_deaths_state.json"
CHARS = ROOT / "games" / "last-circle" / "assets" / "chars" / "meshy"
OUT = ROOT / "asset_gen" / "lc_deaths"
API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"]
HEIGHTS = {"soldier": 1.85, "athlete": 1.8, "wraith": 1.82, "juggernaut": 1.95, "viper": 1.8}
CLIPS = [("death2", 183), ("death3", 184), ("hit", 177)]


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
                time.sleep(2 ** (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {path}: {detail}")
    raise RuntimeError("retries exhausted")


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"chars": {}}


def save_state(st):
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def strip_skin_glb(src: Path, dst: Path):
    """Unrig a GLB (drop skins + JOINTS/WEIGHTS + detach armature) so Meshy
    re-rigs from the mesh. Verbatim from meshy_lc_run.py."""
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    bin_ = buf[20 + jlen + 8:]
    skin_roots = set()
    for s in js.get("skins", []):
        if s.get("skeleton") is not None: skin_roots.add(s["skeleton"])
        for j in s.get("joints", []): skin_roots.add(j)
    js.pop("skins", None)
    for n in js.get("nodes", []): n.pop("skin", None)
    for m in js.get("meshes", []):
        for p in m.get("primitives", []):
            p.get("attributes", {}).pop("JOINTS_0", None); p.get("attributes", {}).pop("WEIGHTS_0", None)
    prune = lambda lst: [i for i in lst if i not in skin_roots]
    for sc in js.get("scenes", []): sc["nodes"] = prune(sc.get("nodes", []))
    for n in js.get("nodes", []):
        if n.get("children"):
            n["children"] = prune(n["children"])
            if not n["children"]: n.pop("children")
    js.pop("animations", None)
    jbytes = json.dumps(js, separators=(",", ":")).encode()
    jbytes += b" " * ((4 - len(jbytes) % 4) % 4)
    total = 12 + 8 + len(jbytes) + 8 + len(bin_)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jbytes), 0x4E4F534A)); f.write(jbytes)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)


def strip_clip(src: Path, dst: Path):
    """Clip-only GLB (nodes + animations + their accessors). Verbatim from
    meshy_lc_run.py / meshy_rig_anims_v2.py."""
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    bin_ = buf[20 + jlen + 8:]
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
    for skin in SKINS:
        c = st["chars"].setdefault(skin, {"stage": "new", "anims": {}})
        if c["stage"] != "new":
            print(f"[{skin}] already {c['stage']} — skipping", flush=True)
            continue
        static = OUT / f"{skin}_static.glb"
        strip_skin_glb(CHARS / f"{skin}.glb", static)
        uri = "data:model/gltf-binary;base64," + base64.b64encode(static.read_bytes()).decode()
        res = req("/openapi/v1/rigging", {"model_url": uri, "height_meters": HEIGHTS[skin]})
        c["rig_id"] = res["result"]; c["stage"] = "rig"
        print(f"[{skin}] rigging task {res['result']} ({static.stat().st_size // 1024}KB)", flush=True)
        save_state(st)
        time.sleep(0.5)


def watch(st):
    while True:
        pending = 0
        for skin in SKINS:
            c = st["chars"].get(skin)
            if not c or c["stage"] in ("done", "failed"):
                continue
            if c["stage"] == "rig":
                t = req(f"/openapi/v1/rigging/{c['rig_id']}")
                s = t.get("status")
                print(f"[{skin}] rig {s} {t.get('progress', 0)}%", flush=True)
                if s == "SUCCEEDED":
                    for name, action in CLIPS:
                        res = req("/openapi/v1/animations", {"rig_task_id": c["rig_id"], "action_id": action})
                        c["anims"][name] = {"id": res["result"], "action": action, "stage": "run"}
                        time.sleep(0.4)
                    c["stage"] = "anims"
                    # the fresh anims are pending THIS pass — without this the
                    # loop exits early when the last rigs all succeed in one
                    # pass (bit us live: 3 of 5 chars stranded in "anims")
                    pending += 1
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["err"] = str(t.get("task_error", s))[:300]
                    print(f"[{skin}] rig FAILED: {c['err']}", flush=True)
                else:
                    pending += 1
                save_state(st)
            elif c["stage"] == "anims":
                open_ = 0
                for name, a in c["anims"].items():
                    if a["stage"] != "run":
                        continue
                    r = req(f"/openapi/v1/animations/{a['id']}")
                    s = r.get("status")
                    if s == "SUCCEEDED":
                        res = r.get("result", r)
                        url = res.get("animation_glb_url") or r.get("animation_glb_url")
                        tmp = OUT / f"_raw_{skin}_{name}.glb"
                        urllib.request.urlretrieve(url, tmp)
                        strip_clip(tmp, CHARS / f"{skin}_{name}.glb")
                        tmp.unlink()
                        a["stage"] = "done"
                        print(f"[{skin}/{name}] DONE -> {skin}_{name}.glb", flush=True)
                    elif s in ("FAILED", "CANCELED"):
                        a["stage"] = "failed"; a["err"] = str(r.get("task_error", s))[:200]
                        print(f"[{skin}/{name}] FAILED: {a['err']}", flush=True)
                    else:
                        open_ += 1
                if open_ == 0 and all(a["stage"] in ("done", "failed") for a in c["anims"].values()):
                    c["stage"] = "done" if all(a["stage"] == "done" for a in c["anims"].values()) else "failed"
                else:
                    pending += 1
                save_state(st)
        if pending == 0:
            break
        time.sleep(20)
    summary = {s: st["chars"].get(s, {}).get("stage") for s in SKINS}
    print("FINAL:", json.dumps(summary), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    st = load_state()
    if args.submit:
        submit(st)
    if args.watch:
        watch(st)
    if not args.submit and not args.watch:
        print(json.dumps(st, indent=1))
