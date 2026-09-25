#!/usr/bin/env python
"""DYEFIELD art build + contract check (CONTRACT §3, §7 gate G3).

    python art/build.py map pier18      # blender --background: art/blender/build_map.py -- --map pier18
    python art/build.py hero            # art/blender/build_hero.py
    python art/build.py kits            # art/blender/build_kits.py
    python art/build.py all             # every build target above (maps with status 'built')
    python art/build.py check           # validate every GLB in art/gltf against the contract (no Blender)

Blender is found at $BLENDER, else the standard 5.1 install path. Every build script is run with
--background --factory-startup and receives its arguments after `--`. Scripts must be
deterministic (fixed seeds) so a rebuild is byte-stable. Exit code: 0 ok, 1 build/check failure.
stdout is UTF-8 (Windows consoles default to cp1252).
"""
from __future__ import annotations

import json
import os
import struct
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BLENDER_DIR = os.path.join(HERE, "blender")
GLTF_DIR = os.path.join(HERE, "gltf")
DATA_DIR = os.path.join(ROOT, "data")
DEFAULT_BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"

# ── contract constants (CONTRACT §3) ────────────────────────────────────────────────────────────
HERO_BONES = [
    "root", "hips", "spine", "chest", "neck", "head", "crest_1", "crest_2", "crest_3",
    "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
    "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "toe.L", "thigh.R", "shin.R", "foot.R", "toe.R",
    "tank",
]
HERO_CLIPS_REQUIRED = ["idle", "run", "jump", "fall", "land", "aim", "brush"]
HERO_CLIPS_WANTED = ["slick_dive", "washed", "victory", "lobby_idle", "strafe_l", "strafe_r", "back",
                     # phase 6 (CONTRACT_ART_P6_8 §17) — reported until the KITS lane lands, then promoted to required
                     "roll", "flick", "charge", "blast", "throw", "special_throw", "slam", "hold_two"]
HERO_MATERIALS_TEAM = ["M_crest", "M_top_trim", "M_shorts_stripe", "M_sole", "M_tank_dye", "M_band"]
HERO_NODES = ["rig", "socket_weapon", "tank_dye", "slick_fin"]
MAP_PREFIXES = ("paint_", "solid_", "deco_", "col_", "water_", "grate_", "conveyor_", "spring_", "oob_")  # §14.2 adds the last four
# phase 6 art (CONTRACT_ART_P6_8 §17): checked when present, listed as missing otherwise (not failing until promoted)
KIT_FILES = ["kit_mist_rasp.glb", "kit_sheet_drum.glb", "kit_needle_glint.glb", "kit_pop_well.glb"]
EXTRA_FILES = {"sub_jelly_charge.glb": ["jelly_puddle"], "special_cloudburst.glb": ["rain", "core"]}
KITS_REQUIRED = ["kit_mist_rasp.glb"]


def blender_exe() -> str:
    exe = os.environ.get("BLENDER") or DEFAULT_BLENDER
    if not os.path.isfile(exe):
        raise SystemExit(f"Blender not found at {exe!r} — set $BLENDER")
    return exe


def run_blender(script: str, args: list[str]) -> int:
    path = os.path.join(BLENDER_DIR, script)
    if not os.path.isfile(path):
        print(f"[art] MISSING script {path}")
        return 1
    cmd = [blender_exe(), "--background", "--factory-startup", "--python-exit-code", "1", "--python", path, "--", *args]
    print("[art] $", " ".join(f'"{c}"' if " " in c else c for c in cmd), flush=True)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    proc = subprocess.run(cmd, cwd=ROOT, env=env)
    print(f"[art] {script} rc={proc.returncode}", flush=True)
    return proc.returncode


# ── GLB reading (container + JSON only; enough for contract checks) ─────────────────────────────
def read_glb_json(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB")
    clen, ctype = struct.unpack_from("<II", data, 12)
    if ctype != 0x4E4F534A:
        raise ValueError(f"{path}: first chunk is not JSON")
    return json.loads(data[20:20 + clen].decode("utf-8"))


def check_hero(path: str) -> list[str]:
    errs: list[str] = []
    j = read_glb_json(path)
    names = [n.get("name", "") for n in j.get("nodes", [])]
    skins = j.get("skins", [])
    if not skins:
        errs.append("no skin")
    joint_names = set()
    for s in skins:
        for ji in s.get("joints", []):
            joint_names.add(names[ji])
    for b in HERO_BONES:
        if b not in joint_names:
            errs.append(f"missing bone {b}")
    for n in HERO_NODES:
        if n not in names:
            errs.append(f"missing node {n}")
    clips = [a.get("name", "") for a in j.get("animations", [])]
    for c in HERO_CLIPS_REQUIRED:
        if c not in clips:
            errs.append(f"missing clip {c}")
    missing_wanted = [c for c in HERO_CLIPS_WANTED if c not in clips]
    mats = [m.get("name", "") for m in j.get("materials", [])]
    for m in HERO_MATERIALS_TEAM:
        if m not in mats:
            errs.append(f"missing team material {m}")
    tris = 0
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            if "indices" in p:
                tris += j["accessors"][p["indices"]]["count"] // 3
    if tris > 12000:
        errs.append(f"hero tris {tris} > 12000 budget")
    print(f"[check] hero: {len(joint_names)} joints, clips={clips}, tris={tris}, materials={len(mats)}"
          + (f", wanted-but-missing clips={missing_wanted}" if missing_wanted else ""))
    return errs


def check_kit(path: str) -> list[str]:
    errs: list[str] = []
    j = read_glb_json(path)
    names = [n.get("name", "") for n in j.get("nodes", [])]
    if "muzzle" not in names:
        errs.append("kit has no 'muzzle' node")
    print(f"[check] kit {os.path.basename(path)}: nodes={len(names)}")
    return errs


def check_map(path: str, map_id: str) -> list[str]:
    errs: list[str] = []
    j = read_glb_json(path)
    nodes = j.get("nodes", [])
    names = [n.get("name", "") for n in nodes]
    paint = 0
    for i, n in enumerate(nodes):
        nm = n.get("name", "")
        if "mesh" in n:
            if not nm.startswith(MAP_PREFIXES):
                errs.append(f"mesh node '{nm}' has no contract prefix {MAP_PREFIXES}")
            for key in ("translation", "rotation", "scale", "matrix"):
                if key in n and nm.startswith(("paint_", "solid_", "col_", "grate_", "conveyor_", "spring_", "oob_")):
                    v = n[key]
                    ident = {"translation": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]}.get(key)
                    if key == "matrix" or (ident is not None and any(abs(a - b) > 1e-5 for a, b in zip(v, ident))):
                        errs.append(f"'{nm}' has a non-identity {key} (apply transforms before export)")
            if nm.startswith("paint_"):
                paint += 1
                for p in j["meshes"][n["mesh"]]["primitives"]:
                    attrs = p.get("attributes", {})
                    for a in ("POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"):
                        if a not in attrs:
                            errs.append(f"'{nm}' primitive lacks {a}")
                    if "TEXCOORD_1" in attrs:
                        acc = j["accessors"][attrs["TEXCOORD_1"]]
                        lo, hi = acc.get("min", [0, 0]), acc.get("max", [1, 1])
                        if min(lo) < 0.0 or max(hi) > 1.0:
                            errs.append(f"'{nm}' TEXCOORD_1 outside [0,1]: min={lo} max={hi}")
    if paint == 0:
        errs.append("no paint_* mesh nodes")
    for s in ("spawn_A", "spawn_B", "mapinfo"):
        if s not in names:
            errs.append(f"missing node {s}")
    info = next((n.get("extras", {}) for n in nodes if n.get("name") == "mapinfo"), {}) or {}
    for k in ("df_map_id", "df_atlas_size", "df_texels_per_meter", "df_paint_area"):
        if k not in info:
            errs.append(f"mapinfo extras lacks {k}")
    if info.get("df_map_id") not in (None, map_id):
        errs.append(f"mapinfo df_map_id={info.get('df_map_id')!r} != {map_id!r}")
    if info.get("df_atlas_size") not in (None, 512, 1024, 2048):
        errs.append(f"df_atlas_size {info.get('df_atlas_size')} not in (512,1024,2048)")
    mb = os.path.getsize(path) / 1e6
    if mb > 8.0:
        errs.append(f"map GLB {mb:.1f} MB > 8 MB budget")
    print(f"[check] map {map_id}: {len(nodes)} nodes, {paint} paint meshes, info={info}, {mb:.2f} MB")
    return errs


def built_maps() -> list[str]:
    with open(os.path.join(DATA_DIR, "maps.json"), encoding="utf-8") as f:
        return [m["id"] for m in json.load(f)["maps"] if m.get("status") == "built"]


def cmd_check() -> int:
    bad = 0
    if not os.path.isdir(GLTF_DIR):
        print("[check] art/gltf missing")
        return 1
    targets: list[tuple[str, list[str]]] = []
    hero = os.path.join(GLTF_DIR, "tide_runner.glb")
    targets.append(("tide_runner.glb", check_hero(hero) if os.path.isfile(hero) else ["missing file"]))
    for kf in KIT_FILES:
        kp = os.path.join(GLTF_DIR, kf)
        if os.path.isfile(kp):
            targets.append((kf, check_kit(kp)))
        elif kf in KITS_REQUIRED:
            targets.append((kf, ["missing file"]))
        else:
            print(f"[check] (phase 6, not yet required) missing {kf}")
    for ef, nodes in EXTRA_FILES.items():
        ep = os.path.join(GLTF_DIR, ef)
        if os.path.isfile(ep):
            names = [n.get("name", "") for n in read_glb_json(ep).get("nodes", [])]
            targets.append((ef, [f"missing node {n}" for n in nodes if n not in names]))
        else:
            print(f"[check] (phase 6, not yet required) missing {ef}")
    for mid in built_maps():
        p = os.path.join(GLTF_DIR, f"map_{mid}.glb")
        targets.append((f"map_{mid}.glb", check_map(p, mid) if os.path.isfile(p) else ["missing file"]))
    for name, errs in targets:
        if errs:
            bad += 1
            print(f"[check] FAIL {name}:")
            for e in errs:
                print("   -", e)
        else:
            print(f"[check] OK   {name}")
    print("[check] RESULT:", "OK" if bad == 0 else f"FAIL ({bad})")
    return 0 if bad == 0 else 1


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    what, rest = argv[0], argv[1:]
    if what == "check":
        return cmd_check()
    if what == "map":
        if not rest:
            print("usage: build.py map <id>")
            return 1
        return run_blender("build_map.py", ["--map", rest[0], *rest[1:]])
    if what == "hero":
        return run_blender("build_hero.py", rest)
    if what == "kits":
        return run_blender("build_kits.py", rest)
    if what == "all":
        rc = 0
        for mid in built_maps():
            rc |= run_blender("build_map.py", ["--map", mid])
        rc |= run_blender("build_hero.py", [])
        rc |= run_blender("build_kits.py", [])
        rc |= cmd_check()
        return 1 if rc else 0
    print(f"unknown target {what!r}")
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
