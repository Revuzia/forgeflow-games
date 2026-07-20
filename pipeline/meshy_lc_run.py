#!/usr/bin/env python3
"""meshy_lc_run.py — regenerate Last Circle's run clip as a PROPER UPRIGHT run.

The shipped run clip is Meshy action 16 "RunFast" which leans ~55deg (measured:
soldier_run.glb avg 54.7deg vs walk 5.5deg) — the "running bent over" the owner
flagged. Owner authorized Meshy spend (2026-07-20) to fix it.

The 5 LC rig_task_ids are gone (never committed, expired from the account), so we
re-rig from the shipped textured base GLBs (same precedent as meshy_rig_anims_v2.py).

MODES
  --bakeoff : re-rig SOLDIER once, generate several CANDIDATE run actions, save each
              as asset_gen/lc_run_bakeoff/soldier_test_<id>.glb. Then measure each
              candidate's lean offline (browser, via data-URI) and pick the best.
  --rollout <action_id> [--allclips]
            : re-rig all 5 skins, generate the chosen run action (and, with
              --allclips, ALL locomotion clips + reship base_new.glb for zero
              retarget risk), placing results for the runtime loader.

Resume-safe: state in state/meshy_lc_run_state.json (own file — never run while any
other meshy_* job is live; last-writer-wins clobbers the shared state).

  python pipeline/meshy_lc_run.py --bakeoff --watch
  python pipeline/meshy_lc_run.py --rollout 15 --watch
"""
import argparse, base64, json, struct, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT.parent / "state" / "meshy_lc_run_state.json"
CHARS = ROOT / "games" / "last-circle" / "assets" / "chars" / "meshy"
OUT = ROOT / "asset_gen" / "lc_run_bakeoff"
API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"

SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"]
HEIGHTS = {"soldier": 1.85, "athlete": 1.8, "wraith": 1.82, "juggernaut": 1.95, "viper": 1.8}
# Run/jog candidates from the WalkAndRun catalog (avoid 16 RunFast + 509 Lean_Forward_Sprint).
CANDIDATES = [14, 15, 510, 534, 538]
# full-clip plan for --allclips rollout (action ids from CHANGELOG: walk 30, jump 86,
# swim 569, death 8; idle stays baked in the base). run id is set from the rollout arg.
ALLCLIPS = {"walk": 30, "death": 8, "jump": 86, "swim": 569}


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
    return {"bakeoff": {"stage": "new", "cands": {}}, "rollout": {}}


def save_state(st):
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def strip_skin_glb(src: Path, dst: Path):
    """Unrig a GLB (drop skins + JOINTS/WEIGHTS + detach armature) so Meshy re-rigs
    from the mesh. Verbatim from meshy_rig_anims_v2.py."""
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
    """Clip-only GLB (nodes + animations + their accessors). Verbatim from v2."""
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


def rig_char(skin):
    """strip skin -> POST rigging -> return rig task id."""
    OUT.mkdir(parents=True, exist_ok=True)
    static = OUT / f"{skin}_static.glb"
    strip_skin_glb(CHARS / f"{skin}.glb", static)
    uri = "data:model/gltf-binary;base64," + base64.b64encode(static.read_bytes()).decode()
    res = req("/openapi/v1/rigging", {"model_url": uri, "height_meters": HEIGHTS[skin]})
    print(f"[{skin}] rigging task {res['result']} ({static.stat().st_size // 1024}KB)", flush=True)
    return res["result"]


def poll_rig(rig_id):
    t = req(f"/openapi/v1/rigging/{rig_id}"); return t.get("status"), t


def poll_anim(aid):
    r = req(f"/openapi/v1/animations/{aid}"); return r.get("status"), r


def dl(url, dst):
    urllib.request.urlretrieve(url, dst)


def bakeoff(st, watch):
    b = st["bakeoff"]
    if b["stage"] == "new":
        b["rig_id"] = rig_char("soldier"); b["stage"] = "rig"; save_state(st)
    while watch:
        if b["stage"] == "rig":
            s, t = poll_rig(b["rig_id"]); print(f"[soldier] rig {s} {t.get('progress',0)}%", flush=True)
            if s == "SUCCEEDED":
                r = t.get("result", t); dl(r.get("rigged_character_glb_url"), OUT / "soldier_base_new.glb")
                for a in CANDIDATES:
                    res = req("/openapi/v1/animations", {"rig_task_id": b["rig_id"], "action_id": a})
                    b["cands"][str(a)] = {"id": res["result"], "stage": "run"}; time.sleep(0.4)
                b["stage"] = "anims"; save_state(st)
            elif s in ("FAILED", "CANCELED"):
                b["stage"] = "failed"; b["err"] = str(t.get("task_error", s))[:300]; save_state(st); break
        elif b["stage"] == "anims":
            pend = 0
            for a, c in b["cands"].items():
                if c["stage"] != "run": continue
                s, r = poll_anim(c["id"])
                if s == "SUCCEEDED":
                    res = r.get("result", r); url = res.get("animation_glb_url") or r.get("animation_glb_url")
                    tmp = OUT / f"_raw_{a}.glb"; dl(url, tmp)
                    strip_clip(tmp, OUT / f"soldier_test_{a}.glb"); tmp.unlink()
                    c["stage"] = "done"; print(f"[soldier/run-{a}] DONE", flush=True)
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["err"] = str(r.get("task_error", s))[:200]; print(f"[soldier/run-{a}] FAILED", flush=True)
                else: pend += 1
            save_state(st)
            if pend == 0: b["stage"] = "done"; break
        else: break
        if watch: time.sleep(20)
    print("BAKEOFF STATE:", json.dumps({a: c["stage"] for a, c in b["cands"].items()}))


def rollout(st, action, watch):
    """Ship the chosen run action to all 5 skins, swapping <skin>_run.glb.
    Soldier reuses the bake-off clip; the other 4 re-rig + animate."""
    OUT.mkdir(parents=True, exist_ok=True)
    r = st.setdefault("rollout", {}); r["action"] = action
    chars = r.setdefault("chars", {})
    src = OUT / f"soldier_test_{action}.glb"
    if src.exists() and chars.get("soldier", {}).get("stage") != "done":
        (CHARS / "soldier_run.glb").write_bytes(src.read_bytes())
        chars["soldier"] = {"stage": "done", "reused": True}
        print(f"[soldier] run reused from bake-off (action {action}) -> soldier_run.glb", flush=True)
        save_state(st)
    todo = [s for s in SKINS if chars.get(s, {}).get("stage") != "done"]
    for skin in todo:
        c = chars.setdefault(skin, {"stage": "new"})
        if c["stage"] == "new":
            c["rig_id"] = rig_char(skin); c["stage"] = "rig"; save_state(st)
    while watch:
        busy = False
        for skin in todo:
            c = chars[skin]
            if c["stage"] == "rig":
                s, t = poll_rig(c["rig_id"]); print(f"[{skin}] rig {s} {t.get('progress',0)}%", flush=True)
                if s == "SUCCEEDED":
                    res = req("/openapi/v1/animations", {"rig_task_id": c["rig_id"], "action_id": action})
                    c["anim_id"] = res["result"]; c["stage"] = "anim"; busy = True
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["err"] = str(t.get("task_error", s))[:200]
                else:
                    busy = True
            elif c["stage"] == "anim":
                s, rr = poll_anim(c["anim_id"])
                if s == "SUCCEEDED":
                    res = rr.get("result", rr); url = res.get("animation_glb_url") or rr.get("animation_glb_url")
                    tmp = OUT / f"_raw_{skin}.glb"; dl(url, tmp)
                    strip_clip(tmp, CHARS / f"{skin}_run.glb"); tmp.unlink()
                    c["stage"] = "done"; print(f"[{skin}] run -> {skin}_run.glb DONE", flush=True)
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["err"] = str(rr.get("task_error", s))[:200]
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
    ap.add_argument("--rollout", type=int, default=0, help="chosen run action id")
    ap.add_argument("--allclips", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    st = load_state()
    if args.bakeoff:
        bakeoff(st, args.watch)
    if args.rollout:
        rollout(st, args.rollout, args.watch)
    print("balance:", req("/openapi/v1/balance").get("balance"))


if __name__ == "__main__":
    main()
