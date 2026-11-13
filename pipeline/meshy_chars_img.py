#!/usr/bin/env python3
"""meshy_chars_img.py — rebuild the 4 Dungeon Forge classes from clean T-POSE
reference art (assets/chars/_tpose_src/<class>_tpose.jpg).

Per class: Meshy image-to-3d (textured, ~30 cr) -> auto-rig (~5 cr, bundles
walk+run) -> download base.glb + clip-only walk_arm.glb / run_arm.glb, and record
rig_id in state/meshy_chars_state.json so meshy_anims.py can add idle/attacks/etc.

The T-pose source gives a neutral bind pose (no shrug on retarget) and relaxed
hands (fingers together, not the splayed claw of the old text-to-3d models).

    python pipeline/meshy_chars_img.py --run      # submit + poll to completion
    python pipeline/meshy_chars_img.py --advance   # one polling pass
"""
import argparse, base64, json, struct, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent           # forgeflow-games
STATE = ROOT.parent / "state" / "meshy_chars_state.json"
SRC = ROOT / "games" / "dungeon-forge" / "assets" / "chars" / "_tpose_src"
OUT = ROOT / "games" / "dungeon-forge" / "assets" / "chars" / "meshy"
API = "https://api.meshy.ai"
KEY = "msy_st8XcruSB8SvhIAJHFPvUXWZ8TjbJ5Y2cLpT"
CLASSES = ["knight", "barbarian", "sorceress", "rogue"]
ACTIVE = list(CLASSES)  # narrowed by positional CLI args (e.g. `... --run knight`)


def req(path, body=None, method=None):
    m = method or ("POST" if body is not None else "GET")
    r = urllib.request.Request(API + path,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
                               method=m)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=90) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {path}: {detail}")
    raise RuntimeError("retries exhausted")


def balance():
    return req("/openapi/v1/balance")["balance"]


def load():
    if STATE.exists():
        st = json.loads(STATE.read_text(encoding="utf-8"))
        st.setdefault("chars", {})
        return st
    return {"chars": {}}


def save(st):
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def dl(url, dst):
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(r, timeout=180) as resp, open(dst, "wb") as f:
        f.write(resp.read())
    return dst.stat().st_size


def strip_clip(src: Path, dst: Path):
    """Clip-only GLB: keep node hierarchy + animations (+ their accessors)."""
    buf = src.read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen].decode("utf-8"))
    bin_ = buf[20 + jlen + 8:]
    keep_acc = set()
    for a in js.get("animations", []):
        for s in a.get("samplers", []):
            keep_acc.add(s["input"]); keep_acc.add(s["output"])
    acc_map, bv_map, new_acc, new_bv, new_bin = {}, {}, [], [], bytearray()
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
        f.write(struct.pack("<II", len(jbytes), 0x4E4F534A)); f.write(jbytes)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942)); f.write(bytes(new_bin))


def dl_strip(url, dst):
    tmp = dst.parent / ("_raw_" + dst.name)
    dl(url, tmp); strip_clip(tmp, dst); tmp.unlink()
    return dst.stat().st_size


def submit(st):
    for cls in ACTIVE:
        c = st["chars"].setdefault(cls, {})
        if c.get("stage"):
            continue
        img = SRC / f"{cls}_tpose.jpg"
        b64 = base64.b64encode(img.read_bytes()).decode()
        body = {"image_url": f"data:image/jpeg;base64,{b64}", "ai_model": "meshy-6",
                "should_texture": True, "enable_pbr": False, "topology": "triangle",
                "target_polycount": 20000}
        c["img_id"] = req("/openapi/v1/image-to-3d", body)["result"]
        c["stage"] = "img"
        print(f"[{cls}] image-to-3d {c['img_id']}", flush=True)
        save(st); time.sleep(0.4)


def advance(st):
    busy = False
    for cls in ACTIVE:
        c = st["chars"].get(cls, {})
        stage = c.get("stage")
        try:
            if stage == "img":
                t = req(f"/openapi/v1/image-to-3d/{c['img_id']}")
                s = t.get("status"); print(f"[{cls}] img {s} {t.get('progress',0)}%", flush=True)
                if s == "SUCCEEDED":
                    # image-to-3d comes out ~900k faces; remesh under the 300k rigging limit first
                    c["remesh_id"] = req("/openapi/v1/remesh", {"input_task_id": c["img_id"],
                                                                "target_polycount": 30000, "target_formats": ["glb"],
                                                                "topology": "triangle"})["result"]
                    c["stage"] = "remesh"; print(f"[{cls}] remesh {c['remesh_id']}", flush=True); save(st); busy = True
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = str(t.get("task_error", s))[:200]; save(st)
                else:
                    busy = True
            elif stage == "remesh":
                t = req(f"/openapi/v1/remesh/{c['remesh_id']}")
                s = t.get("status"); print(f"[{cls}] remesh {s} {t.get('progress',0)}%", flush=True)
                if s == "SUCCEEDED":
                    c["rig_id"] = req("/openapi/v1/rigging", {"input_task_id": c["remesh_id"], "height_meters": 1.75})["result"]
                    c["stage"] = "rig"; print(f"[{cls}] rig {c['rig_id']}", flush=True); save(st); busy = True
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = str(t.get("task_error", s))[:200]; save(st)
                else:
                    busy = True
            elif stage == "rig":
                t = req(f"/openapi/v1/rigging/{c['rig_id']}")
                s = t.get("status"); print(f"[{cls}] rig {s} {t.get('progress',0)}%", flush=True)
                if s == "SUCCEEDED":
                    r = t.get("result", t); anims = r.get("basic_animations", {})
                    n1 = dl(r["rigged_character_glb_url"], OUT / cls / "base.glb")
                    n2 = dl_strip(anims["walking_glb_url"], OUT / cls / "walk_arm.glb") if anims.get("walking_glb_url") else 0
                    n3 = dl_strip(anims["running_glb_url"], OUT / cls / "run_arm.glb") if anims.get("running_glb_url") else 0
                    c["stage"] = "done"
                    print(f"[{cls}] DONE base={n1//1024}KB walk={n2//1024}KB run={n3//1024}KB", flush=True); save(st)
                elif s in ("FAILED", "CANCELED"):
                    c["stage"] = "failed"; c["error"] = str(t.get("task_error", s))[:200]; save(st)
                else:
                    busy = True
        except Exception as e:
            msg = str(e); print(f"[{cls}] ERROR {msg}", flush=True)
            if any(code in msg for code in ("HTTP 400", "HTTP 401", "HTTP 403")):
                c["stage"] = "failed"; c["error"] = msg[:200]; save(st)  # fatal — don't spin
            else:
                busy = True
        save(st)
    return busy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--advance", action="store_true")
    ap.add_argument("only", nargs="*", help="restrict to these class names")
    args = ap.parse_args()
    global ACTIVE
    if args.only:
        ACTIVE = [c for c in args.only if c in CLASSES]
    print(f"[active] {ACTIVE}", flush=True)
    st = load()
    b0 = balance(); print(f"[balance] before = {b0}", flush=True)
    submit(st)
    if args.run:
        for _ in range(200):
            if not advance(st):
                break
            time.sleep(10)
    elif args.advance:
        advance(st)
    b1 = balance()
    done = [c for c in CLASSES if st["chars"].get(c, {}).get("stage") == "done"]
    print(f"\n[balance] after = {b1}  SPENT = {b0 - b1}", flush=True)
    print(f"models+rigs done: {len(done)}/4  {done}", flush=True)


if __name__ == "__main__":
    main()
