#!/usr/bin/env python3
"""char_lod.py - Last Circle character LOD generator (dev-only; _tools/ never ships).

WHY THIS EXISTS
  The five Meshy/Mixamo bodies shipped at 245k-632k triangles each (a lobby of
  50 = 19 M tris before the shadow pass drew them again). Draco (commit
  aebe7736) only shrank the DOWNLOAD - the GPU still drew every triangle.
  This script is the generator for the fixed assets: it decimates each body to
  a ~15k LOD0 (written over <skin>.glb) and a ~2.5k far LOD1 (<skin>_lod1.glb),
  keeps the skin intact and re-applies Draco so the game's DRACOLoader path
  (ffg_kernel_3d.js) is unchanged. Re-run it instead of hand-editing a GLB.

INPUT
  assets/chars/meshy/<skin>.glb.pre_draco.bak - the git-tracked, uncompressed,
  full-resolution body. It is the same model as the Draco body that shipped
  before this tool (same tris/verts/joints, byte-identical images and
  inverseBindMatrices; the JSON differs only by gltf-transform stripping
  default values). Reading the .bak - never the output - makes the script
  idempotent: running it twice gives the same bytes and never decimates its
  own output. A source that is not clearly full-res is refused.
  The *.glb.pre_mixamo.bak files are NOT inputs (pre-rig meshes, other skeleton).

OUTPUT (per skin)
  <skin>.glb       LOD0: ~15k tris (per-skin face weighting in SKIN_CFG),
                   textures/material/skin/animation as before.
  <skin>_lod1.glb  LOD1: ~2.5k tris, SAME skin (joint order + inverse binds),
                   geometry-only: images are dropped and the material is an
                   untextured placeholder (emissive 0). It exists to be swapped
                   in as `skinnedMesh.geometry` on the LOD0 actor, which keeps
                   the actor's own (tinted) material and skeleton: zero extra
                   draw calls, zero new programs, no extra texture decode.
                   Neither LOD carries TANGENT, so both compile the same
                   (derivative-tangent) program variant as the old bodies.

TOOLS
  gltf-transform CLI 4.4.x (global npm install) and the libraries it ships
  (@gltf-transform/core+functions 4.4.x, meshoptimizer). `draco` re-encodes
  with the CLI defaults.

SIMPLIFIER (--simplifier attr, the default)
  `gltf-transform simplify` 4.4.2 is POSITION-ONLY (functions/dist/index.cjs
  simplifyPrimitive -> simplifier.simplify(indices, positions, 3, ...)). On these
  smooth Meshy faces that collapses whole regions and drags the painted eyes and
  lips across big triangles: the 2026-09-30 close-ups showed warped mouths and a
  chin crease at 15k AND at 25k (athlete), and garbled faces (juggernaut,
  soldier). The default path therefore runs the same weld() the CLI runs, then
  meshoptimizer simplifyWithAttributes with NORMAL (weight 0.5) and TEXCOORD_0
  (weight 1.0) in the error metric, through a small Node helper that loads the
  CLI's OWN installed libraries (no other dependency). Per skin, `k_head`
  multiplies the metric on vertices skinned to the Head bone (metric only; the
  simplifier returns indices and never moves or rewrites a vertex), which moves
  triangles into the face at the same total budget. Evidence is in SKIN_CFG.
  `--simplifier cli` runs the plain `gltf-transform simplify` (the plan's
  original recipe) for comparison.

ASSERTIONS (per output; any failure = exit 1 and the repo file is untouched)
  - 1 mesh / 1 triangle primitive; tris within [floor, budget]
    (LOD0 <= 16,000 by default or per-skin target x 1.0667, LOD1 <= 3,000).
  - LOD0 keeps weight > 0.05 on every bone that had it in the source (no limb
    left undeformed); LOD1 reports lost bones without failing.
  - POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 present (and inside the
    Draco extension's attribute map).
  - skins[0].joints: identical node names, same order, same length as the
    source; inverseBindMatrices float-identical; node hierarchy + TRS identical.
  - Decoded-before-Draco content check: weights sum ~1, joint indices < joint
    count, no NaN, UVs finite, positions inside the source bounds.
  - LOD0 images byte-identical to the source; LOD1 has no images.
  - KHR_draco_mesh_compression in extensionsRequired.

USAGE (from anywhere)
  python games/last-circle/_tools/char_lod.py                   # all 5 skins, write in place
  python games/last-circle/_tools/char_lod.py --skins soldier   # one skin
  python games/last-circle/_tools/char_lod.py --target juggernaut=25000
  python games/last-circle/_tools/char_lod.py --out C:/tmp/lods # trial run elsewhere
  python games/last-circle/_tools/char_lod.py --check-only      # validate what is on disk
  python games/last-circle/_tools/char_lod.py --simplifier cli --out C:/tmp/cli  # plain CLI simplify
Exit codes: 0 all good, 1 an assertion failed, 2 environment problem (CLI missing, source missing).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import numpy as np
except Exception:  # pragma: no cover - numpy is present on the dev box; keep a clear message
    np = None

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
MESHY = GAME / "assets" / "chars" / "meshy"

SKINS = ["athlete", "juggernaut", "soldier", "viper", "wraith"]
SRC_SUFFIX = ".glb.pre_draco.bak"

LOD0_TARGET = 15000
LOD0_BUDGET = 16000
LOD1_TARGET = 2500
LOD1_BUDGET = 3000
FLOOR_FRACTION = 0.80          # below 80% of the target = the simplifier did something odd
LOD0_ERROR = 0.01              # PLAN L2: --error 0.01 (fraction of mesh radius)
LOD1_ERROR = 0.05              # far LOD: allow more error so the ratio, not the limit, decides
MIN_SOURCE_TRIS = 60000        # refuse to "decimate" something that is already a LOD
NRM_WEIGHT = 0.5               # simplifyWithAttributes metric weights (attr path)
UV_WEIGHT = 1.0

# Per-skin LOD0 settings. Chosen from close-up renders of the original vs candidates
# (face 0.62 m, face 3/4, both hands, 4.2 m follow, back 3/4; same idle frame, the
# game's material fix). Mean |diff| per tile vs the original, /255 - lower is closer:
#   athlete    attr k1 15k: face 6.05, hands 4.66/4.46, body@4.2m 0.226
#              (CLI 15k: 8.38, 7.64/8.05, 0.313; CLI 25k: 6.60, 5.58/5.61, 0.244).
#              k_head 3 only moved face 6.05->5.82 and cost hands (5.78/5.55) and
#              body (0.271): the Head bone also owns the big pigtails (57,684 of
#              131,456 welded verts), so the metric boost lands on hair. -> k 1.
#   soldier    attr k4 15k: face 6.49 (k1 8.65, CLI 10.89), lips intact; hands 7.33/7.25.
#   viper      attr k1 15k: face 7.34, hands 5.33/6.12; k4 bought face 6.69 for
#              hands 6.62/8.02 - face already fine at k1 -> k 1.
#   wraith     attr k1 15k: masked face 3.39, hands 2.60/2.89 (k4: 2.99, 2.95/3.68).
#   juggernaut 632k-tri armour leaves a small face inside the helmet: CLI 15k garbles
#              eyes/mouth (face 17.50) and attr k1 15k is still blotchy (14.63). k4 15k:
#              face 10.65 - brow/eyes/nose/mouth line read again, about what attr k1
#              buys at 25k (10.31) - hands 9.62/10.11, body 0.500 (CLI 15k 0.700).
#              Kept at the plan's 15k: the ground-cluster gate (<= 2.5 M) has ~no room
#              (2026-09-30 tree: 2.57 M at 20k). OWNER OPTION (PLAN section 7):
#              `--target juggernaut=20000` = k4 20k, face 8.92, ~+80k tris per lobby cluster.
SKIN_CFG = {
    "athlete": {"lod0": LOD0_TARGET, "k_head": 1.0},
    "juggernaut": {"lod0": LOD0_TARGET, "k_head": 4.0},
    "soldier": {"lod0": LOD0_TARGET, "k_head": 4.0},
    "viper": {"lod0": LOD0_TARGET, "k_head": 1.0},
    "wraith": {"lod0": LOD0_TARGET, "k_head": 1.0},
}

REQUIRED_ATTRS = ("POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0")
DRACO_EXT = "KHR_draco_mesh_compression"
TEXTURE_SLOTS = ("baseColorTexture", "metallicRoughnessTexture")
MATERIAL_TEXTURE_SLOTS = ("normalTexture", "occlusionTexture", "emissiveTexture")

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

COMP_FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
COMP_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class LodError(Exception):
    """An assertion about an output failed (exit 1)."""


class EnvError(Exception):
    """The environment cannot run the generator (exit 2)."""


# ---------------------------------------------------------------- GLB helpers
def read_glb(path: Path):
    b = path.read_bytes()
    magic, version, length = struct.unpack("<III", b[:12])
    if magic != GLB_MAGIC or version != 2:
        raise LodError(f"{path.name}: not a glTF 2.0 GLB")
    js, bin_ = None, b""
    off = 12
    while off < min(length, len(b)):
        clen, ctype = struct.unpack("<II", b[off:off + 8])
        data = b[off + 8:off + 8 + clen]
        if ctype == CHUNK_JSON:
            js = json.loads(data.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            bin_ = data
        off += 8 + clen
    if js is None:
        raise LodError(f"{path.name}: no JSON chunk")
    return js, bin_


def write_glb(path: Path, js: dict, bin_: bytes) -> None:
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b"\x00" * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", GLB_MAGIC, 2, total))
        f.write(struct.pack("<II", len(jb), CHUNK_JSON))
        f.write(jb)
        if bb:
            f.write(struct.pack("<II", len(bb), CHUNK_BIN))
            f.write(bb)


def view_bytes(js: dict, bin_: bytes, bv_index: int) -> bytes:
    bv = js["bufferViews"][bv_index]
    o = bv.get("byteOffset", 0)
    return bin_[o:o + bv["byteLength"]]


def read_accessor(js: dict, bin_: bytes, idx: int):
    """Returns a list of tuples (or scalars) for an uncompressed accessor."""
    acc = js["accessors"][idx]
    if "bufferView" not in acc:
        raise LodError(f"accessor {idx} has no bufferView (compressed?)")
    bv = js["bufferViews"][acc["bufferView"]]
    ct, n, count = acc["componentType"], TYPE_N[acc["type"]], acc["count"]
    esize = COMP_SIZE[ct] * n
    stride = bv.get("byteStride") or esize
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt = "<" + COMP_FMT[ct] * n
    if np is not None:
        dt = np.dtype(COMP_FMT[ct]).newbyteorder("<")
        raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (count - 1) + esize, offset=base)
        if stride == esize:
            arr = raw.view(dt).reshape(count, n)
        else:
            rows = np.lib.stride_tricks.as_strided(raw, shape=(count, esize), strides=(stride, 1))
            arr = np.ascontiguousarray(rows).view(dt).reshape(count, n)
        return arr
    out = [struct.unpack_from(fmt, bin_, base + i * stride) for i in range(count)]
    return out


def tri_count(js: dict) -> int:
    t = 0
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            if p.get("mode", 4) != 4:
                raise LodError("non-triangle primitive")
            if "indices" in p:
                t += js["accessors"][p["indices"]]["count"] // 3
            else:
                t += js["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return t


def joint_names(js: dict) -> list:
    skins = js.get("skins") or []
    if not skins:
        return []
    return [js["nodes"][j].get("name", f"#{j}") for j in skins[0]["joints"]]


def node_signature(js: dict) -> list:
    """(name, parent name, T, R, S) for every node, with glTF defaults filled in."""
    parent = {}
    for i, n in enumerate(js.get("nodes", [])):
        for c in n.get("children", []):
            parent[c] = i
    sig = []
    for i, n in enumerate(js.get("nodes", [])):
        p = parent.get(i)
        sig.append((
            n.get("name", ""),
            js["nodes"][p].get("name", "") if p is not None else None,
            tuple(n.get("translation", [0.0, 0.0, 0.0])),
            tuple(n.get("rotation", [0.0, 0.0, 0.0, 1.0])),
            tuple(n.get("scale", [1.0, 1.0, 1.0])),
            "mesh" in n,
            n.get("skin"),
        ))
    return sig


def ibm_floats(js: dict, bin_: bytes):
    skin = js["skins"][0]
    acc = read_accessor(js, bin_, skin["inverseBindMatrices"])
    if np is not None:
        return np.asarray(acc, dtype=np.float32).ravel()
    return [v for row in acc for v in row]


def image_hashes(js: dict, bin_: bytes) -> list:
    out = []
    for im in js.get("images", []):
        if "bufferView" in im:
            out.append(hashlib.md5(view_bytes(js, bin_, im["bufferView"])).hexdigest())
        else:
            out.append("uri:" + im.get("uri", ""))
    return out


# ---------------------------------------------------------------- CLI driver
def find_cli() -> str:
    exe = shutil.which("gltf-transform") or shutil.which("gltf-transform.cmd")
    if not exe:
        raise EnvError("gltf-transform CLI not found on PATH (npm i -g @gltf-transform/cli@4)")
    return exe


def run_cli(cli: str, *args: str) -> str:
    cmd = [cli, *args]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"})
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        raise EnvError(f"gltf-transform {args[0]} failed rc={r.returncode}: {out.strip()[-800:]}")
    return out


def cli_version(cli: str) -> str:
    return run_cli(cli, "--version").strip().splitlines()[-1].strip()


# Attribute-aware simplify, run by Node with the gltf-transform CLI's OWN installed libraries
# (resolved from the CLI package dir, so there is nothing else to install). It does what
# `gltf-transform simplify` does - weld(), simplify, compactPrimitive, uint16 indices when they
# fit - except the simplifier call: simplifyWithAttributes with NORMAL + TEXCOORD_0 in the
# metric, scaled per vertex by k = 1 + (k_head - 1) * weight(Head). The metric array is
# scratch input only; the written vertices are the source's own (welded) vertices.
NODE_HELPER = r"""
const fs = require("fs");
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const req = (m) => require(require.resolve(m, { paths: [job.cliDir] }));
const { NodeIO, VERSION } = req("@gltf-transform/core");
const { ALL_EXTENSIONS } = req("@gltf-transform/extensions");
const { weld, compactPrimitive } = req("@gltf-transform/functions");
const { MeshoptSimplifier } = req("meshoptimizer");
(async () => {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(job.src);
  await doc.transform(weld());
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (prims.length !== 1) throw new Error("expected 1 primitive, got " + prims.length);
  const prim = prims[0];
  const get = (k) => { const a = prim.getAttribute(k); if (!a) throw new Error("missing " + k); return a; };
  const pos = get("POSITION").getArray(), nrm = get("NORMAL").getArray(), uv = get("TEXCOORD_0").getArray();
  if (!(pos instanceof Float32Array && nrm instanceof Float32Array && uv instanceof Float32Array))
    throw new Error("POSITION/NORMAL/TEXCOORD_0 must be float (the source must be the raw, unquantized body)");
  const n = pos.length / 3;
  const jn = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
  const isHead = jn.map((s) => /(^|:)Head$/.test(s));
  if (job.kHead !== 1 && !isHead.some(Boolean)) throw new Error("k_head != 1 but the skin has no Head joint");
  const J = get("JOINTS_0").getArray(), Wacc = get("WEIGHTS_0"), Wa = Wacc.getArray();
  const wN = Wacc.getNormalized() ? (Wa instanceof Uint8Array ? 255 : Wa instanceof Uint16Array ? 65535 : 1) : 1;
  const A = new Float32Array(n * 5);
  let headV = 0;
  for (let i = 0; i < n; i++) {
    let wh = 0;
    for (let c = 0; c < 4; c++) if (isHead[J[i * 4 + c]]) wh += Wa[i * 4 + c] / wN;
    if (wh > 0.5) headV++;
    const k = 1 + (job.kHead - 1) * wh;
    A[i * 5] = k * nrm[i * 3]; A[i * 5 + 1] = k * nrm[i * 3 + 1]; A[i * 5 + 2] = k * nrm[i * 3 + 2];
    A[i * 5 + 3] = k * uv[i * 2]; A[i * 5 + 4] = k * uv[i * 2 + 1];
  }
  const idxAcc = prim.getIndices();
  const idx = new Uint32Array(idxAcc.getArray());
  const target = Math.min(idx.length, Math.floor(job.targetTris) * 3);
  const W = [job.nrmW, job.nrmW, job.nrmW, job.uvW, job.uvW];
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, A, 5, W, null, target, job.error, []);
  idxAcc.setArray(out);
  compactPrimitive(prim);
  const nv = prim.getAttribute("POSITION").getCount();
  if (nv <= 65534) prim.getIndices().setArray(new Uint16Array(prim.getIndices().getArray()));
  await io.write(job.dst, doc);
  process.stdout.write(JSON.stringify({ version: VERSION, welded: n, tris: out.length / 3, verts: nv,
    error: +err.toFixed(5), headV }) + "\n");
})().catch((e) => { process.stderr.write(String((e && e.stack) || e) + "\n"); process.exit(1); });
"""


def cli_package_dir(cli: str) -> Path:
    """The CLI's install dir; its node_modules hold the exact library versions the CLI runs."""
    d = Path(cli).resolve().parent / "node_modules" / "@gltf-transform" / "cli"
    if not (d / "package.json").exists():
        raise EnvError(f"gltf-transform CLI package dir not found next to {cli} (expected {d})")
    return d


def make_simplifier(kind: str, cli: str, work: Path, k_head: float):
    """Returns run(src, dst, target_tris, error, src_tris) -> info string."""
    if kind == "cli":
        if k_head != 1.0:
            raise EnvError("--simplifier cli cannot apply k_head (position-only metric)")

        def run_cli_simplify(src, dst, target_tris, error, src_tris):
            out = run_cli(cli, "simplify", str(src), str(dst), "--ratio", f"{target_tris / src_tris:.6f}",
                          "--error", str(error), "-v")
            return next((ln.strip() for ln in out.splitlines() if "simplify:" in ln and "error" in ln), "")
        return run_cli_simplify
    node = shutil.which("node")
    if not node:
        raise EnvError("node not found on PATH (needed for the attribute-aware simplify)")
    pkg = cli_package_dir(cli)
    helper = work / "char_lod_simplify.cjs"
    helper.write_text(NODE_HELPER, encoding="utf-8")

    def run_attr(src, dst, target_tris, error, src_tris):
        job = {"cliDir": str(pkg), "src": str(src), "dst": str(dst), "targetTris": int(target_tris),
               "error": float(error), "nrmW": NRM_WEIGHT, "uvW": UV_WEIGHT, "kHead": float(k_head)}
        jp = work / (Path(dst).stem + ".job.json")
        jp.write_text(json.dumps(job), encoding="utf-8")
        r = subprocess.run([node, str(helper), str(jp)], capture_output=True, text=True, encoding="utf-8",
                           errors="replace")
        if r.returncode != 0:
            raise EnvError(f"attribute simplify failed rc={r.returncode}: {(r.stderr or r.stdout).strip()[-800:]}")
        info = json.loads(r.stdout.strip().splitlines()[-1])
        if not str(info.get("version", "")).startswith("v4."):
            raise EnvError(f"@gltf-transform/core {info.get('version')}: this tool was written against 4.4.x")
        return info
    return run_attr


def simplify_to(run, src: Path, dst: Path, target: int, budget: int, error: float, src_tris: int):
    """Runs the simplifier, nudging the target down (max 3 tries) if the result is over budget."""
    want = target
    tries = []
    for _ in range(3):
        info = run(src, dst, want, error, src_tris)
        js, _bin = read_glb(dst)
        t = tri_count(js)
        tries.append((int(want), t, info))
        if t <= budget:
            return t, tries
        want = int(want * target / t)
    raise LodError(f"{src.name}: simplify stayed over budget {budget}: {tries}")


def strip_textures(path: Path) -> None:
    """LOD1 is geometry-only: drop images/textures/samplers, keep an untextured material."""
    js, bin_ = read_glb(path)
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        for k in TEXTURE_SLOTS:
            pbr.pop(k, None)
        for k in MATERIAL_TEXTURE_SLOTS:
            m.pop(k, None)
        m["emissiveFactor"] = [0.0, 0.0, 0.0]   # a stray render of this placeholder must not glow white
    for k in ("images", "textures", "samplers"):
        js.pop(k, None)
    # image bufferViews become unreferenced; the next gltf-transform pass drops their bytes
    write_glb(path, js, bin_)


# ---------------------------------------------------------------- validation
def content_check(raw_path: Path, src_js: dict, src_bin: bytes, label: str) -> dict:
    """Decoded-attribute sanity on the pre-Draco intermediate (Draco only quantizes after this)."""
    if np is None:
        raise EnvError("numpy is required for the content check")
    js, bin_ = read_glb(raw_path)
    prim = js["meshes"][0]["primitives"][0]
    at = prim["attributes"]
    pos = read_accessor(js, bin_, at["POSITION"]).astype(np.float64)
    nrm = read_accessor(js, bin_, at["NORMAL"]).astype(np.float64)
    uv = read_accessor(js, bin_, at["TEXCOORD_0"]).astype(np.float64)
    jn = read_accessor(js, bin_, at["JOINTS_0"]).astype(np.int64)
    wacc = js["accessors"][at["WEIGHTS_0"]]
    w = read_accessor(js, bin_, at["WEIGHTS_0"]).astype(np.float64)
    if wacc.get("normalized") and wacc["componentType"] in (5121, 5123):
        w = w / (255.0 if wacc["componentType"] == 5121 else 65535.0)
    idx = read_accessor(js, bin_, prim["indices"]).astype(np.int64).ravel()
    njoints = len(js["skins"][0]["joints"])
    problems = []
    for name, arr in (("POSITION", pos), ("NORMAL", nrm), ("TEXCOORD_0", uv), ("WEIGHTS_0", w)):
        if not np.all(np.isfinite(arr)):
            problems.append(f"{name} has non-finite values")
    wsum = w.sum(axis=1)
    if np.abs(wsum - 1.0).max() > 0.02:
        problems.append(f"WEIGHTS_0 sums off 1 (max dev {np.abs(wsum - 1.0).max():.4f})")
    used = w > 0
    if (jn[used] >= njoints).any() or (jn < 0).any():
        problems.append("JOINTS_0 index out of range")
    if idx.max() >= len(pos):
        problems.append("index out of range")
    nl = np.linalg.norm(nrm, axis=1)
    if (np.abs(nl - 1.0) > 0.05).mean() > 0.001:
        problems.append("NORMAL not unit length")
    sp = src_js["accessors"][src_js["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    lo, hi = np.array(sp["min"]) - 1e-4, np.array(sp["max"]) + 1e-4
    if (pos < lo).any() or (pos > hi).any():
        problems.append("positions outside the source bounds")
    # every bone that carried weight in the source still carries weight (no limb lost)
    sprim = src_js["meshes"][0]["primitives"][0]["attributes"]
    sj = read_accessor(src_js, src_bin, sprim["JOINTS_0"]).astype(np.int64)
    sw = read_accessor(src_js, src_bin, sprim["WEIGHTS_0"]).astype(np.float64)
    src_bones = set(np.unique(sj[sw > 0.05]).tolist())
    out_bones = set(np.unique(jn[w > 0.05]).tolist())
    lost = sorted(src_bones - out_bones)
    lost_names = [src_js["nodes"][src_js["skins"][0]["joints"][b]].get("name", b) for b in lost]
    if problems:
        raise LodError(f"{label}: " + "; ".join(problems))
    bbox = (pos.min(axis=0).round(4).tolist(), pos.max(axis=0).round(4).tolist())
    return {"verts_raw": int(len(pos)), "bones_weighted": len(out_bones),
            "bones_weighted_src": len(src_bones), "bones_lost": lost_names, "bbox": bbox}


def validate(out_path: Path, src_js: dict, src_bin: bytes, kind: str, floor: int, budget: int) -> dict:
    js, bin_ = read_glb(out_path)
    label = f"{out_path.name}"
    if len(js.get("meshes", [])) != 1 or len(js["meshes"][0]["primitives"]) != 1:
        raise LodError(f"{label}: expected 1 mesh with 1 primitive")
    prim = js["meshes"][0]["primitives"][0]
    tris = tri_count(js)
    if not (floor <= tris <= budget):
        raise LodError(f"{label}: tris {tris} outside [{floor}, {budget}]")
    attrs = set(prim["attributes"])
    missing = [a for a in REQUIRED_ATTRS if a not in attrs]
    if missing:
        raise LodError(f"{label}: missing attributes {missing}")
    draco = prim.get("extensions", {}).get(DRACO_EXT)
    if not draco:
        raise LodError(f"{label}: primitive is not Draco-compressed")
    dmissing = [a for a in REQUIRED_ATTRS if a not in draco.get("attributes", {})]
    if dmissing:
        raise LodError(f"{label}: Draco stream lacks {dmissing}")
    if DRACO_EXT not in (js.get("extensionsRequired") or []):
        raise LodError(f"{label}: {DRACO_EXT} not in extensionsRequired")
    jacc = js["accessors"][prim["attributes"]["JOINTS_0"]]
    if jacc["componentType"] not in (5121, 5123):
        raise LodError(f"{label}: JOINTS_0 componentType {jacc['componentType']}")
    # skin contract: identical joints (names, order, length) + inverse binds + hierarchy
    sj, oj = joint_names(src_js), joint_names(js)
    if sj != oj:
        raise LodError(f"{label}: skins[0].joints differ (src {len(sj)} vs out {len(oj)})")
    sibm, oibm = ibm_floats(src_js, src_bin), ibm_floats(js, bin_)
    if np is not None:
        if sibm.shape != oibm.shape or not np.array_equal(sibm, oibm):
            raise LodError(f"{label}: inverseBindMatrices changed")
    elif list(sibm) != list(oibm):
        raise LodError(f"{label}: inverseBindMatrices changed")
    ss, os_ = node_signature(src_js), node_signature(js)
    if len(ss) != len(os_):
        raise LodError(f"{label}: node count {len(ss)} -> {len(os_)}")
    for a, b in zip(ss, os_):
        if a[0] != b[0] or a[1] != b[1] or a[5] != b[5] or a[6] != b[6]:
            raise LodError(f"{label}: node hierarchy changed at {a[0]!r}")
        for va, vb in zip(a[2] + a[3] + a[4], b[2] + b[3] + b[4]):
            if not math.isclose(va, vb, rel_tol=1e-6, abs_tol=1e-7):
                raise LodError(f"{label}: node TRS changed at {a[0]!r}")
    if len(js.get("animations", [])) != len(src_js.get("animations", [])):
        raise LodError(f"{label}: animation count changed")
    if kind == "lod0":
        if image_hashes(js, bin_) != image_hashes(src_js, src_bin):
            raise LodError(f"{label}: textures are not byte-identical to the source")
    else:
        if js.get("images"):
            raise LodError(f"{label}: LOD1 should carry no images")
    return {"file": out_path.name, "kind": kind, "tris": tris, "joints": len(oj),
            "bytes": out_path.stat().st_size,
            "draco_attrs": sorted(draco["attributes"]),
            "verts_decoded": js["accessors"][prim["attributes"]["POSITION"]]["count"]}


# ---------------------------------------------------------------- per skin
def skin_settings(skin: str, args, targets: dict) -> tuple:
    """(lod0 target, lod0 budget, k_head) for a skin: SKIN_CFG, overridden by --target / --k-head."""
    cfg = SKIN_CFG.get(skin, {})
    target = targets.get(skin, cfg.get("lod0", args.lod0_target))
    if skin not in targets and args.lod0_target != LOD0_TARGET:
        target = args.lod0_target                     # an explicit global --lod0-target wins over the table
    k_head = args.k_head if args.k_head is not None else cfg.get("k_head", 1.0)
    if args.simplifier == "cli":
        k_head = 1.0
    return target, max(args.lod0_budget, int(target * 1.0667)), k_head


def build_skin(cli: str, skin: str, out_dir: Path, work: Path, targets: dict, args) -> dict:
    src = MESHY / (skin + SRC_SUFFIX)
    if not src.exists():
        raise EnvError(f"source missing: {src}")
    src_js, src_bin = read_glb(src)
    if src_js.get("extensionsUsed") and DRACO_EXT in src_js["extensionsUsed"]:
        raise EnvError(f"{src.name}: source is Draco-compressed; expected the raw full-res body")
    src_tris = tri_count(src_js)
    if src_tris < MIN_SOURCE_TRIS:
        raise EnvError(f"{src.name}: only {src_tris} tris - that is already a LOD, refusing to re-decimate")
    lod0_target, lod0_budget, k_head = skin_settings(skin, args, targets)
    rec = {"skin": skin, "source": src.name, "source_tris": src_tris,
           "source_joints": len(joint_names(src_js)), "simplifier": args.simplifier,
           "lod0_target": lod0_target, "lod0_budget": lod0_budget, "k_head": k_head}

    # LOD0 ----------------------------------------------------------------
    run0 = make_simplifier(args.simplifier, cli, work, k_head)
    raw0 = work / f"{skin}_lod0_raw.glb"
    t0, tries0 = simplify_to(run0, src, raw0, lod0_target, lod0_budget, args.lod0_error, src_tris)
    rec["lod0_tries"] = tries0
    rec["lod0_content"] = content_check(raw0, src_js, src_bin, f"{skin} LOD0")
    if rec["lod0_content"]["bones_lost"]:
        raise LodError(f"{skin} LOD0: bones lost all weight > 0.05: {rec['lod0_content']['bones_lost']}")
    fin0 = work / f"{skin}.glb"
    run_cli(cli, "draco", str(raw0), str(fin0))
    rec["lod0"] = validate(fin0, src_js, src_bin, "lod0", int(lod0_target * FLOOR_FRACTION), lod0_budget)
    # LOD1 (far-only: no head boost) -------------------------------------
    run1 = make_simplifier(args.simplifier, cli, work, 1.0)
    raw1 = work / f"{skin}_lod1_raw.glb"
    t1, tries1 = simplify_to(run1, src, raw1, args.lod1_target, args.lod1_budget, args.lod1_error, src_tris)
    rec["lod1_tries"] = tries1
    rec["lod1_content"] = content_check(raw1, src_js, src_bin, f"{skin} LOD1")
    strip_textures(raw1)
    fin1 = work / f"{skin}_lod1.glb"
    run_cli(cli, "draco", str(raw1), str(fin1))
    rec["lod1"] = validate(fin1, src_js, src_bin, "lod1", int(args.lod1_target * FLOOR_FRACTION), args.lod1_budget)
    # both validated -> move into place (never leaves a half-written repo file)
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in (fin0, fin1):
        dst = out_dir / f.name
        tmp = out_dir / (f.name + ".tmp_charlod")
        shutil.copyfile(f, tmp)
        os.replace(tmp, dst)
    rec["md5"] = {f.name: hashlib.md5((out_dir / f.name).read_bytes()).hexdigest() for f in (fin0, fin1)}
    return rec


def check_skin(skin: str, out_dir: Path, targets: dict, args) -> dict:
    src = MESHY / (skin + SRC_SUFFIX)
    if not src.exists():
        raise EnvError(f"source missing: {src}")
    src_js, src_bin = read_glb(src)
    lod0_target, lod0_budget, _k = skin_settings(skin, args, targets)
    rec = {"skin": skin, "source_tris": tri_count(src_js), "lod0_target": lod0_target, "lod0_budget": lod0_budget}
    for f in (out_dir / f"{skin}.glb", out_dir / f"{skin}_lod1.glb"):
        if not f.exists():
            raise LodError(f"{f.name}: missing")
    rec["lod0"] = validate(out_dir / f"{skin}.glb", src_js, src_bin, "lod0", int(lod0_target * FLOOR_FRACTION), lod0_budget)
    rec["lod1"] = validate(out_dir / f"{skin}_lod1.glb", src_js, src_bin, "lod1", int(args.lod1_target * FLOOR_FRACTION), args.lod1_budget)
    return rec


def parse_targets(items) -> dict:
    out = {}
    for it in items or []:
        k, _, v = it.partition("=")
        if k not in SKINS or not v.isdigit():
            raise SystemExit(f"--target expects skin=tris with skin in {SKINS}, got {it!r}")
        out[k] = int(v)
    return out


def main(argv=None) -> int:
    try:  # the CLI's verbose lines carry non-ASCII arrows; never die on a cp1252 console
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--skins", default=",".join(SKINS), help="comma list (default: all five)")
    ap.add_argument("--out", default=str(MESHY), help="output dir (default: the game's assets/chars/meshy)")
    ap.add_argument("--lod0-target", type=int, default=LOD0_TARGET)
    ap.add_argument("--lod0-budget", type=int, default=LOD0_BUDGET)
    ap.add_argument("--lod0-error", type=float, default=LOD0_ERROR)
    ap.add_argument("--lod1-target", type=int, default=LOD1_TARGET)
    ap.add_argument("--lod1-budget", type=int, default=LOD1_BUDGET)
    ap.add_argument("--lod1-error", type=float, default=LOD1_ERROR)
    ap.add_argument("--target", action="append", metavar="SKIN=TRIS",
                    help="per-skin LOD0 target override (its budget becomes target x 1.0667)")
    ap.add_argument("--simplifier", choices=("attr", "cli"), default="attr",
                    help="attr = weld + simplifyWithAttributes (default); cli = plain `gltf-transform simplify`")
    ap.add_argument("--k-head", type=float, default=None,
                    help="override SKIN_CFG k_head for every skin (attr only; 1 = no face boost)")
    ap.add_argument("--check-only", action="store_true", help="validate the files on disk; write nothing")
    ap.add_argument("--json", help="also write the per-skin records to this JSON file")
    args = ap.parse_args(argv)
    skins = [s.strip() for s in args.skins.split(",") if s.strip()]
    bad = [s for s in skins if s not in SKINS]
    if bad:
        print(f"unknown skin(s) {bad}; choose from {SKINS}")
        return 2
    targets = parse_targets(args.target)
    out_dir = Path(args.out)
    records, failures = [], []
    try:
        if args.check_only:
            for s in skins:
                try:
                    records.append(check_skin(s, out_dir, targets, args))
                except LodError as e:
                    failures.append(str(e))
        else:
            cli = find_cli()
            ver = cli_version(cli)
            if not ver.startswith("4."):
                raise EnvError(f"gltf-transform {ver}: this tool was written against 4.4.x")
            print(f"gltf-transform {ver} | simplifier {args.simplifier} | out {out_dir}")
            with tempfile.TemporaryDirectory(prefix="ffg_charlod_") as tmp:
                for s in skins:
                    work = Path(tmp) / s
                    work.mkdir()
                    try:
                        records.append(build_skin(cli, s, out_dir, work, targets, args))
                    except LodError as e:
                        failures.append(str(e))
    except EnvError as e:
        print(f"ENVIRONMENT: {e}")
        return 2
    for r in records:
        l0, l1 = r["lod0"], r["lod1"]
        lost = (r.get("lod0_content") or {}).get("bones_lost")
        lost1 = (r.get("lod1_content") or {}).get("bones_lost")
        print(f"{r['skin']:<11} src {r['source_tris']:>7,} tris | LOD0 {l0['tris']:>6,} tris (budget {r['lod0_budget']:,})"
              f" {l0['bytes']:>9,} B joints {l0['joints']}"
              f" | LOD1 {l1['tris']:>5,} tris {l1['bytes']:>8,} B joints {l1['joints']}"
              + (f" k_head {r['k_head']}" if "k_head" in r else "")
              + (f" | LOD0 lost weighted bones {lost}" if lost else "")
              + (f" | LOD1 lost weighted bones {lost1}" if lost1 else ""))
    if args.json:
        Path(args.json).write_text(json.dumps({"records": records, "failures": failures}, indent=2), encoding="utf-8")
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print(f"OK: {len(records)} skin(s) {'checked' if args.check_only else 'written'}; "
          f"joint lists identical to source; budgets LOD0 <= {args.lod0_budget} (or per-skin target x 1.0667), "
          f"LOD1 <= {args.lod1_budget}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
