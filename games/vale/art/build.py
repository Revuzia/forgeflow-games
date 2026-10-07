#!/usr/bin/env python3
"""VALE art build runner + contract check (CONTRACT §12).

    python3 art/build.py proof [--fast]          # technical proof mannequin, end to end
    python3 art/build.py fighter <id> [args]     # art/blender/fighters/<id>.py (+ its skins)
    python3 art/build.py fighters                # every fighters/*.py not starting with '_'
    python3 art/build.py unit <id> | units       # art/blender/units/<id>.py
    python3 art/build.py map <id> | maps         # art/blender/maps/<id>.py
    python3 art/build.py sky <id> | skies        # art/blender/sky.py -- --id <id> (sky_presets.json)
    python3 art/build.py portraits [<id>]        # re-render portrait/splash/icon/turntable from .cache
                                                 #   (--only splash --scale 0.5 = a quick PREVIEW)
    python3 art/build.py parts [--keys mask_]    # the parts-library sheet -> art/renders/parts/sheet.png
    python3 art/build.py check                   # validate every GLB in art/out, write art/out/manifest.json
    python3 art/build.py all                     # fighters, units, maps, skies, then check

Each script runs with the Blender executable from $BLENDER
    "$BLENDER" --background --factory-startup --python-exit-code 1 --python <script> -- <args>
or, when $BLENDER is unset, in a child `python3 <script> -- <args>` that imports the `bpy`
module. Scripts read their arguments after `--` in both cases. Extra arguments after the target
are passed through (e.g. `--fast`, `--no-render`, `--skin <id>`). stdout is UTF-8.
`check` needs no Blender: it reads the GLB JSON/BIN chunks directly. Exit code 0 = ok.
"""
from __future__ import annotations

import glob
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
BLENDER_DIR = os.path.join(HERE, "blender")
OUT = os.path.join(HERE, "out")
CONTENT = os.path.join(GAME, "content")

# ── contract constants (CONTRACT §12) ───────────────────────────────────────────────────────────
STANDARD_BONES = [
    "root", "hips", "spine", "chest", "neck", "head",
    "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
    "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "toe.L", "thigh.R", "shin.R", "foot.R", "toe.R",
    "prop.R", "prop.L",
]
PARENTS = {"prop.R": "hand.R", "prop.L": "hand.L"}
REQUIRED_CLIPS = ["idle", "run", "attack1", "attack2", "cast_a1", "cast_a2", "cast_a3", "cast_ult",
                  "death", "recall", "idle_lobby", "victory"]
OPTIONAL_CLIPS = ["crit", "channel", "dash", "stunned", "spawn", "taunt"]
LOOP_CLIPS = ["idle", "run", "recall", "idle_lobby", "channel", "stunned"]
TRI_BUDGET = {"fighter": (10_000, 25_000), "skin": (10_000, 25_000), "minion": (1_500, 4_000),
              "monster": (4_000, 12_000), "structure": (4_000, 20_000), "summon": (0, 12_000),
              "ward": (0, 4_000), "pickup": (0, 4_000), "landmark": (0, 60_000), "map": (0, 700_000)}
TEX_MAX = {"fighter": 1024, "skin": 1024, "landmark": 2048, "map": 2048}
TEX_DEFAULT = 1024
# fighter/skin: 1.2 MB with the shipping compression (KHR_mesh_quantization + EXT_texture_webp + int16
# rotation tracks, art/tools/optimize.mjs --fighter); technical builds (ids starting with '_') only warn
BYTES_MAX = {"fighter": 1_200_000, "skin": 1_200_000, "minion": 1_500_000, "monster": 3_000_000,
             "structure": 4_000_000, "map": 48_000_000}


def blender_exe() -> str | None:
    exe = os.environ.get("BLENDER")
    if exe and not os.path.isfile(exe):
        raise SystemExit(f"$BLENDER={exe!r} does not exist")
    return exe or None


def run_script(script: str, args: list[str]) -> int:
    if not os.path.isfile(script):
        print(f"[art] MISSING script {os.path.relpath(script, GAME)}")
        return 1
    exe = blender_exe()
    if exe:
        cmd = [exe, "--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", *args]
    else:
        cmd = [sys.executable, script, "--", *args]
    print("[art] $", " ".join(f'"{c}"' if " " in c else c for c in cmd), flush=True)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    t = time.perf_counter()
    rc = subprocess.run(cmd, cwd=GAME, env=env).returncode
    print(f"[art] {os.path.relpath(script, GAME)} rc={rc} in {time.perf_counter() - t:.1f}s", flush=True)
    return rc


def scripts_in(sub: str) -> list[str]:
    return sorted(p for p in glob.glob(os.path.join(BLENDER_DIR, sub, "*.py"))
                  if not os.path.basename(p).startswith("_"))


# ── GLB reading ────────────────────────────────────────────────────────────────────────────────
class GLB:
    def __init__(self, path: str):
        self.path = path
        with open(path, "rb") as f:
            data = f.read()
        magic, version, length = struct.unpack_from("<III", data, 0)
        if magic != 0x46546C67:
            raise ValueError("not a GLB")
        clen, ctype = struct.unpack_from("<II", data, 12)
        if ctype != 0x4E4F534A:
            raise ValueError("first chunk is not JSON")
        self.json = json.loads(data[20:20 + clen].decode("utf-8"))
        off = 20 + clen
        self.bin = b""
        if off + 8 <= len(data):
            blen, btype = struct.unpack_from("<II", data, off)
            if btype == 0x004E4942:
                self.bin = data[off + 8:off + 8 + blen]
        self.bytes = len(data)

    def accessor(self, i: int) -> list:
        """Decode a float/int accessor (no sparse) into a flat list."""
        j = self.json
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        fmt = {5126: "f", 5123: "H", 5125: "I", 5121: "B", 5122: "h", 5120: "b"}[a["componentType"]]
        size = struct.calcsize(fmt)
        stride = bv.get("byteStride") or size * comps
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        out = []
        for k in range(a["count"]):
            out.extend(struct.unpack_from("<" + fmt * comps, self.bin, base + k * stride))
        if a.get("normalized"):                     # KHR_mesh_quantization / int16 rotation tracks
            div = {5122: 32767.0, 5120: 127.0, 5123: 65535.0, 5121: 255.0}.get(a["componentType"], 1.0)
            lo = -1.0 if a["componentType"] in (5122, 5120) else 0.0
            out = [max(lo, v / div) for v in out]
        return out

    def image_bytes(self, img: dict) -> bytes:
        bv = self.json["bufferViews"][img["bufferView"]]
        o = bv.get("byteOffset", 0)
        return self.bin[o:o + bv["byteLength"]]


def image_size(b: bytes) -> tuple[int, int] | None:
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":          # EXT_texture_webp (VP8 / VP8L / VP8X)
        cc = b[12:16]
        if cc == b"VP8 ":
            w, h = struct.unpack("<HH", b[26:30])
            return (w & 0x3FFF, h & 0x3FFF)
        if cc == b"VP8L":
            v = struct.unpack("<I", b[21:25])[0]
            return ((v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1)
        if cc == b"VP8X":
            return (1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little"))
        return None
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", b[16:24])
    if b[:2] == b"\xff\xd8":
        i = 2
        while i < len(b) - 9:
            if b[i] != 0xFF:
                i += 1
                continue
            m = b[i + 1]
            ln = struct.unpack(">H", b[i + 2:i + 4])[0]
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", b[i + 5:i + 9])
                return (w, h)
            i += 2 + ln
    return None


def file_image_size(path: str):
    with open(path, "rb") as f:
        head = f.read(65536)
    if path.endswith(".hdr"):
        txt = head.decode("latin-1", "replace")
        for line in txt.split("\n"):
            parts = line.split()
            if len(parts) == 4 and parts[0] in ("-Y", "+Y"):
                return (int(parts[3]), int(parts[1]))
        return None
    return image_size(head)


def tri_count(g: GLB) -> int:
    j = g.json
    inst = {}
    for n in j.get("nodes", []):
        ext = n.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        if "mesh" in n:
            count = 1
            if ext:
                attrs = ext.get("attributes", {})
                any_attr = next(iter(attrs.values()), None)
                count = j["accessors"][any_attr]["count"] if any_attr is not None else 1
            inst[n["mesh"]] = inst.get(n["mesh"], 0) + count
    tris = 0
    for mi, m in enumerate(j.get("meshes", [])):
        t = 0
        for p in m.get("primitives", []):
            if p.get("mode", 4) != 4:
                continue
            if "indices" in p:
                t += j["accessors"][p["indices"]]["count"] // 3
            else:
                t += j["accessors"][p["attributes"]["POSITION"]]["count"] // 3
        tris += t * inst.get(mi, 1)
    return tris


def clips_of(g: GLB) -> list[dict]:
    out = []
    j = g.json
    for a in j.get("animations", []):
        dur = 0.0
        for s in a.get("samplers", []):
            acc = j["accessors"][s["input"]]
            dur = max(dur, (acc.get("max") or [0])[0])
        out.append({"name": a.get("name", ""), "duration": round(dur, 4), "frames30": int(round(dur * 30)),
                    "channels": len(a.get("channels", []))})
    return out


def loop_seam_error(g: GLB, anim: dict) -> float:
    """Max |first - last| keyframe over rotation channels (quaternion sign-aware)."""
    worst = 0.0
    for ch in anim.get("channels", []):
        s = anim["samplers"][ch["sampler"]]
        path = ch["target"].get("path")
        if path not in ("rotation", "translation"):
            continue
        vals = g.accessor(s["output"])
        n = 4 if path == "rotation" else 3
        if len(vals) < 2 * n:
            continue
        a, b = vals[:n], vals[-n:]
        d = max(abs(x - y) for x, y in zip(a, b))
        if path == "rotation":
            d = min(d, max(abs(x + y) for x, y in zip(a, b)))
        worst = max(worst, d)
    return worst


def unit_kinds() -> dict:
    p = os.path.join(CONTENT, "units.json")
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        items = data.get("units", data) if isinstance(data, dict) else data
        return {u["id"]: u.get("kind") for u in items if isinstance(u, dict) and "id" in u}
    except Exception:
        return {}


def classify(path: str, g: GLB) -> tuple[str, str]:
    """-> (kind, id). Node extras `vale_kind`/`vale_id` (written by the pipeline) win."""
    for n in g.json.get("nodes", []):
        ex = n.get("extras") or {}
        if "vale_kind" in ex:
            return ex["vale_kind"], ex.get("vale_id", os.path.splitext(os.path.basename(path))[0])
    rel = os.path.relpath(path, OUT).replace("\\", "/")
    parts = rel.split("/")
    base = os.path.splitext(parts[-1])[0]
    if parts[0] == "fighters" and len(parts) >= 3:
        return ("fighter" if base == parts[1] else "skin"), base
    if parts[0] == "units":
        return unit_kinds().get(base, "unit"), base
    if parts[0] == "maps":
        return ("map" if base == "scene" else "landmark"), parts[1] if len(parts) > 2 else base
    if parts[0] == "landmarks":
        return "landmark", base
    return "other", base


def check_glb(path: str) -> dict:
    errs, warns = [], []
    try:
        g = GLB(path)
    except Exception as e:
        return {"path": path, "ok": False, "errors": [f"unreadable: {e}"], "warnings": []}
    kind, gid = classify(path, g)
    j = g.json
    names = [n.get("name", "") for n in j.get("nodes", [])]
    tris = tri_count(g)
    clips = clips_of(g)
    mats = [m.get("name", "") for m in j.get("materials", [])]
    textures = []
    for img in j.get("images", []):
        sz = image_size(g.image_bytes(img)) if "bufferView" in img else None
        textures.append({"name": img.get("name", ""), "mime": img.get("mimeType"), "size": list(sz) if sz else None})
    joints = []
    for s in j.get("skins", []):
        joints = [names[i] for i in s.get("joints", [])]
    extras = {}
    for n in j.get("nodes", []):
        if n.get("extras") and "vale_kind" in n["extras"]:
            extras = n["extras"]
    if kind in ("fighter", "skin"):
        if not j.get("skins"):
            errs.append("no skin (skeleton) in GLB")
        missing = [b for b in STANDARD_BONES if b not in joints]
        if missing:
            errs.append(f"missing VALE_BIPED_1 bones: {missing}")
        bad = [b for b in joints if b not in STANDARD_BONES and not b.startswith("x_")]
        if bad:
            errs.append(f"non-standard bones without x_ prefix: {bad}")
        for child, parent in PARENTS.items():
            ci = names.index(child) if child in names else -1
            pi = names.index(parent) if parent in names else -1
            if ci >= 0 and pi >= 0 and ci not in j["nodes"][pi].get("children", []):
                errs.append(f"{child} is not a child of {parent}")
        if "accent" not in mats:
            errs.append("no material named 'accent'")
        else:
            acc = j["materials"][mats.index("accent")]
            if not any(v > 0 for v in acc.get("emissiveFactor", [0, 0, 0])):
                errs.append("'accent' material is not emissive")
        for m in j.get("meshes", []):
            for p in m.get("primitives", []):
                if "JOINTS_0" not in p.get("attributes", {}):
                    errs.append(f"mesh {m.get('name')} primitive is not skinned")
                    break
        # texture slots: glTF fixes the colour space by slot (baseColor sRGB, the rest linear), so a
        # data map used as base colour (or the reverse) is a colour-space bug; images must be embedded
        tex_img = lambda ti: j["textures"][ti].get("source") if ti is not None else None  # noqa: E731
        for mat in j.get("materials", []):
            pbr = mat.get("pbrMetallicRoughness", {})
            bc = tex_img(pbr.get("baseColorTexture", {}).get("index"))
            mr = tex_img(pbr.get("metallicRoughnessTexture", {}).get("index"))
            oc = tex_img(mat.get("occlusionTexture", {}).get("index"))
            nm = tex_img(mat.get("normalTexture", {}).get("index"))
            data_imgs = {x for x in (mr, oc, nm) if x is not None}
            if bc is not None and bc in data_imgs:
                errs.append(f"material {mat.get('name')}: base colour image is also used as a data map")
            if mr is not None and oc is not None and mr != oc:
                warns.append(f"material {mat.get('name')}: occlusion and metallicRoughness are separate images (ORM expected)")
            if mat.get("name") not in ("accent",) and not mat.get("name", "").startswith(("gem_", "glow_")):
                if bc is None or nm is None or mr is None:
                    warns.append(f"material {mat.get('name')}: missing baked maps (base/normal/ORM)")
        for img in j.get("images", []):
            if "bufferView" not in img:
                errs.append(f"image {img.get('name')} is not embedded (uri {img.get('uri')})")
    if kind == "fighter":
        cn = [c["name"] for c in clips]
        miss = [c for c in REQUIRED_CLIPS if c not in cn]
        if miss:
            errs.append(f"missing required clips: {miss}")
        unknown = [c for c in cn if c not in REQUIRED_CLIPS + OPTIONAL_CLIPS]
        if unknown:
            warns.append(f"clips outside the §12 role list (bespoke, need a ClipRole mapping): {unknown}")
        for a in j.get("animations", []):
            if a.get("name") in LOOP_CLIPS:
                e = loop_seam_error(g, a)
                if e > 2e-3:
                    errs.append(f"loop clip {a['name']} does not close (seam error {e:.4f})")
        for c in clips:
            if c["duration"] <= 0:
                errs.append(f"clip {c['name']} has zero duration")
        if extras and "vale_run_ref_speed" not in extras:
            warns.append("armature extras lack vale_run_ref_speed")
    lo, hi = TRI_BUDGET.get(kind, (0, 10**9))
    if tris > hi:
        errs.append(f"{tris} tris > {kind} budget {hi}")
    elif tris < lo:
        warns.append(f"{tris} tris < {kind} budget floor {lo}")
    tmax = TEX_MAX.get(kind, TEX_DEFAULT)
    for t in textures:
        if t["size"] and max(t["size"]) > tmax:
            errs.append(f"texture {t['name']} {t['size']} > {tmax}")
        if t["size"] and any(v & (v - 1) for v in t["size"]):
            warns.append(f"texture {t['name']} {t['size']} is not power-of-two")
    bmax = BYTES_MAX.get(kind)
    if bmax and g.bytes > bmax:
        (warns if gid.startswith("_") else errs).append(f"{g.bytes / 1e6:.2f} MB > {kind} budget {bmax / 1e6:.1f} MB")
    if kind in ("fighter", "skin"):
        d = os.path.dirname(path)
        pre = "" if kind == "fighter" else f"{gid}_"
        need = {"portrait": (512, 512), "splash": (1600, 900)}
        if kind == "fighter":
            need["icon"] = (128, 128)
        for nm, size in need.items():
            p = os.path.join(d, f"{pre}{nm}.png")
            if not os.path.isfile(p):
                (errs if kind == "fighter" else warns).append(f"missing {os.path.basename(p)}")
            elif tuple(file_image_size(p) or ()) != size:
                errs.append(f"{os.path.basename(p)} is {file_image_size(p)}, expected {size}")
    if kind == "map":
        d = os.path.dirname(path)
        for nm in ("sky.hdr", "minimap.png"):
            if not os.path.isfile(os.path.join(d, nm)):
                errs.append(f"missing {nm} next to scene.glb")
    return {"path": os.path.relpath(path, GAME).replace("\\", "/"), "kind": kind, "id": gid, "bytes": g.bytes,
            "tris": tris, "joints": len(joints), "clips": clips, "materials": mats, "textures": textures,
            "extras": extras, "ok": not errs, "errors": errs, "warnings": warns}


def cmd_check() -> int:
    files = sorted(glob.glob(os.path.join(OUT, "**", "*.glb"), recursive=True))
    results = [check_glb(p) for p in files]
    bad = 0
    for r in results:
        tag = "OK  " if r["ok"] else "FAIL"
        bad += 0 if r["ok"] else 1
        clips = ", ".join(f"{c['name']}({c['duration']:.2f}s)" for c in r.get("clips", []))
        print(f"[check] {tag} {r['path']}  kind={r.get('kind')} tris={r.get('tris')} "
              f"{r.get('bytes', 0) / 1024:.0f}KiB joints={r.get('joints')} textures="
              f"{[t['size'] for t in r.get('textures', [])]}")
        if clips:
            print(f"         clips: {clips}")
        for e in r["errors"]:
            print(f"         ERROR {e}")
        for w in r["warnings"]:
            print(f"         warn  {w}")
    images = []
    for p in sorted(glob.glob(os.path.join(OUT, "**", "*.png"), recursive=True) +
                    glob.glob(os.path.join(OUT, "**", "*.hdr"), recursive=True) +
                    glob.glob(os.path.join(OUT, "**", "*.jpg"), recursive=True)):
        sz = file_image_size(p)
        images.append({"path": os.path.relpath(p, GAME).replace("\\", "/"), "bytes": os.path.getsize(p),
                       "size": list(sz) if sz else None})
    manifest = {"format": 1, "generator": "art/build.py check", "contract": "CONTRACT §12",
                "glb": results, "images": images,
                "summary": {"glb": len(results), "failed": bad,
                            "bytes_total": sum(r.get("bytes", 0) for r in results) + sum(i["bytes"] for i in images)}}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"[check] wrote {os.path.relpath(os.path.join(OUT, 'manifest.json'), GAME)}")
    # art.json must parse with the real catalog schema (FighterArt is .strict()): needs node
    node = shutil.which("node") or shutil.which("node.exe")
    tool = os.path.join(HERE, "tools", "validate_art_json.mjs")
    if node and os.path.isfile(tool) and os.path.isfile(os.path.join(GAME, "src", "contracts", "catalog.ts")):
        rc = subprocess.run([node, tool], cwd=GAME).returncode
        if rc != 0:
            bad += 1
    else:
        print("[check] warn: node missing - art.json not validated against src/contracts/catalog.ts")
    print("[check] RESULT:", "OK" if bad == 0 else f"FAIL ({bad} of {len(results)})")
    return 0 if bad == 0 else 1


def sky_ids() -> list[str]:
    p = os.path.join(BLENDER_DIR, "sky_presets.json")
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [k for k in json.load(f) if not k.startswith("_")]


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if argv else 1
    what, rest = argv[0], argv[1:]
    passthru = [a for a in rest if a != "--"]
    if what == "check":
        return cmd_check()
    if what == "proof":
        rc = 0
        if "--no-sky" not in passthru:   # sky first: the fighter's three.js QA lights with it
            rc |= run_script(os.path.join(BLENDER_DIR, "sky.py"), ["--id", "_proof"] + [a for a in passthru if a == "--fast"])
        if rc == 0:
            rc |= run_script(os.path.join(BLENDER_DIR, "fighters", "_proof_mannequin.py"),
                             [a for a in passthru if a != "--no-sky"])
        return rc or cmd_check()
    if what in ("fighter", "unit", "map"):
        if not passthru:
            print(f"usage: build.py {what} <id> [args]")
            return 1
        sub = {"fighter": "fighters", "unit": "units", "map": "maps"}[what]
        return run_script(os.path.join(BLENDER_DIR, sub, f"{passthru[0]}.py"), passthru[1:])
    if what in ("fighters", "units", "maps"):
        rc = 0
        found = scripts_in(what)
        if not found:
            print(f"[art] no {what} scripts yet in art/blender/{what}/ (files starting with '_' are templates)")
        for s in found:
            rc |= run_script(s, passthru)
        return rc
    if what == "sky":
        if not passthru:
            print("usage: build.py sky <id> [--fast]")
            return 1
        return run_script(os.path.join(BLENDER_DIR, "sky.py"), ["--id", passthru[0]] + passthru[1:])
    if what == "skies":
        rc = 0
        for sid in sky_ids():
            rc |= run_script(os.path.join(BLENDER_DIR, "sky.py"), ["--id", sid] + passthru)
        return rc
    if what == "portraits":
        return run_script(os.path.join(BLENDER_DIR, "portraits.py"), passthru)
    if what == "parts":
        return run_script(os.path.join(BLENDER_DIR, "parts_sheet.py"), passthru)
    if what == "all":
        rc = 0
        for sub in ("fighters", "units", "maps"):
            for s in scripts_in(sub):
                rc |= run_script(s, passthru)
        for sid in sky_ids():
            rc |= run_script(os.path.join(BLENDER_DIR, "sky.py"), ["--id", sid])
        rc |= cmd_check()
        return 1 if rc else 0
    print(f"unknown target {what!r}")
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
