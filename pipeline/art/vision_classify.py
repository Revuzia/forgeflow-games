#!/usr/bin/env python3
"""
vision_classify.py — Classify every asset by viewing its rendered thumbnail.

One-time batch that renders a PNG preview of every 3D model + reads every 2D
asset, then sends the image to Claude CLI (`claude -p`) for role/era/theme
classification. Results persist to state/asset_vision_classifications.json.

DESIGN:
  - Saturday 8 AM - 8 PM hard window (auto-stops if outside window)
  - Resumable via .progress file (if crashes or stops, next run continues)
  - Self-deleting — when 100% complete, task deletes its own schedule entry
  - Rate-limited to 50 classifications/hour to preserve daily Claude quota
  - Telegram progress pings every 500 files or every 30 min
  - Graceful failures (bad FBX files skipped, not fatal)

Asset-type handling:
  - 3D models (.glb/.gltf/.fbx/.obj): render first frame via trimesh/pyrender
  - 2D sprites/tilesets (.png/.jpg): sent directly
  - HDRIs (.hdr/.exr): skip (too specialized)
  - Audio/BVH: skip (no visual)
  - Fonts: skip (use CSS name)

Output: state/asset_vision_classifications.json
  { "path/to/file.glb": {"role", "era", "archetype", "themes",
    "incompatible_with", "visual_description", "confidence"}, ... }
"""
# 2026-05-15: sys.path bootstrap so claw_lib (lives at <root>/scripts/claw_lib/)
# is importable from this nested location (forgeflow-games/pipeline/art/).
# The _migrate_secrets.py auto-inject on 2026-04-27 added the import below
# but didn't add this path setup, which broke the Saturday classifier with
# ModuleNotFoundError for ~3 weeks (May 2 + May 9 supervisor sessions).
import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent.parent.parent / "scripts"))

from claw_lib.secrets import get as _secrets_get  # noqa: E402  (auto-injected by _migrate_secrets.py)
import argparse
import base64
import datetime
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
ASSETS_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets"
MANIFEST_PATH = ROOT / "state" / "game_asset_manifest.json"
CLASS_PATH = ROOT / "state" / "asset_vision_classifications.json"
PROGRESS_PATH = ROOT / "state" / "vision_classify.progress"
THUMB_DIR = ROOT / "state" / "vision_thumbs"
LOG_PATH = ROOT / "state" / "logs" / "vision_classify.log"
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

TG_TOKEN = _secrets_get("telegram_token")
TG_CHAT = _secrets_get("telegram_chat")

# No artificial rate limit — let Anthropic's rate limiter be the real ceiling.
# When we hit 429 / rate limit errors, we detect + exponentially back off.
# Minimum 1 sec between calls just for server politeness (prevents flooding logs).
MIN_DELAY_SEC = 1.0                      # minimal polite pause between successful calls
MAX_CLASSIFY_PER_RUN = 100000            # practically unlimited per Saturday
SATURDAY_END_HOUR = 20                   # 8 PM local hard stop
TELEGRAM_EVERY_N = 100                   # update every 100 classifications
HEARTBEAT_SEC = 3600                     # log + telegram heartbeat every hour

# Backoff schedule when we hit a rate limit — doubles until max 1 hour
BACKOFF_SCHEDULE = [30, 60, 120, 300, 600, 1200, 1800, 3600]  # seconds
RATE_LIMIT_MARKERS = ["rate_limit", "429", "too many requests", "quota", "exceeded", "limit_exceeded"]

# Kinds we classify (ones with a meaningful visual)
CLASSIFY_KINDS = {"model_3d", "tileset_2d", "character_2d", "object_2d", "ui_2d", "bg_2d"}


def _log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    # 2026-05-15: when invoked without PYTHONIOENCODING=utf-8 (e.g. direct
    # terminal run vs the supervisor which sets the env var), stdout falls
    # back to Windows cp1252 and crashes on emoji like the 🏁 in the run-end
    # summary. Encode-replace + reconfigure both protect against that.
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((line + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _tg(text):
    try:
        data = json.dumps({"chat_id": TG_CHAT, "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        _log(f"Telegram failed: {e}")


# ── Windowing: abort if outside Saturday 8 AM - 8 PM ──────────────────────
def _in_window(force=False):
    if force:
        return True
    now = datetime.datetime.now()
    # Weekday: Monday=0 ... Saturday=5
    if now.weekday() != 5:
        return False
    if now.hour < 8 or now.hour >= SATURDAY_END_HOUR:
        return False
    return True


# ── Render 3D model to PNG thumbnail ──────────────────────────────────────
def render_3d_thumbnail(src_path: Path, out_path: Path, size: int = 512) -> bool:
    """Render a GLB/GLTF/FBX/OBJ to a PNG thumbnail.

    Uses trimesh + pyrender if available. Falls back to false on error.
    """
    if out_path.exists() and out_path.stat().st_size > 1000:
        return True
    try:
        import trimesh
        import numpy as np
    except ImportError:
        _log("  ERROR: trimesh not installed — pip install trimesh pyglet")
        return False

    try:
        # trimesh handles GLB/GLTF well; FBX requires assimp backend
        scene = trimesh.load(str(src_path), force="scene")
        if scene.is_empty:
            return False

        # Try to render using trimesh's built-in offscreen
        try:
            from PIL import Image
        except ImportError:
            return False

        # Center + scale the scene
        try:
            bounds = scene.bounds
            center = (bounds[0] + bounds[1]) / 2
            size_vec = bounds[1] - bounds[0]
            max_dim = max(size_vec) if max(size_vec) > 0 else 1
            scene.apply_translation(-center)
        except Exception:
            pass

        # Render via trimesh offscreen (uses pyglet under the hood)
        try:
            png_bytes = scene.save_image(resolution=(size, size), visible=False)
            if png_bytes:
                out_path.write_bytes(png_bytes)
                return True
        except Exception:
            pass

        # Fallback: convert to mesh + matplotlib (low quality but works)
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            from mpl_toolkits.mplot3d.art3d import Poly3DCollection

            if hasattr(scene, "geometry") and len(scene.geometry) > 0:
                mesh = list(scene.geometry.values())[0]
            else:
                mesh = scene

            fig = plt.figure(figsize=(4, 4))
            ax = fig.add_subplot(111, projection="3d")
            if hasattr(mesh, "vertices") and hasattr(mesh, "faces"):
                verts = mesh.vertices
                faces = mesh.faces[:5000]  # cap face count for speed
                polys = [verts[face] for face in faces]
                ax.add_collection3d(Poly3DCollection(polys, alpha=0.6, edgecolor="k", linewidth=0.1))
                ax.set_xlim([verts[:, 0].min(), verts[:, 0].max()])
                ax.set_ylim([verts[:, 1].min(), verts[:, 1].max()])
                ax.set_zlim([verts[:, 2].min(), verts[:, 2].max()])
            ax.set_axis_off()
            fig.savefig(out_path, dpi=100, bbox_inches="tight", pad_inches=0)
            plt.close(fig)
            return out_path.exists() and out_path.stat().st_size > 1000
        except Exception as e:
            _log(f"  render fallback failed: {e}")
            return False

    except Exception as e:
        _log(f"  trimesh load failed for {src_path.name}: {str(e)[:100]}")
        # 2026-05-18: trimesh's FBX loader requires the assimp C++ backend
        # (not installed) so EVERY .fbx file fails the trimesh path. ufbx is a
        # pure-Python FBX parser; we extract vertices+faces and render via the
        # same matplotlib path the trimesh fallback uses. Recovers ~1,562 FBX
        # files that were previously 100% failing.
        if src_path.suffix.lower() == ".fbx":
            return _render_fbx_via_ufbx(src_path, out_path, size)
        return False


def _render_fbx_via_ufbx(src_path: Path, out_path: Path, size: int = 512) -> bool:
    """Render an FBX file using ufbx (pure Python parser) + matplotlib.

    ufbx parses the FBX into Python data structures (vertex positions, face
    indices); we feed those into matplotlib's 3D mesh renderer the same way
    the trimesh fallback path does.
    """
    try:
        import ufbx
        import numpy as np
        scene = ufbx.load_file(str(src_path))
    except Exception as e:
        _log(f"  ufbx load failed for {src_path.name}: {str(e)[:100]}")
        return False
    try:
        verts = None
        faces = None
        # ufbx 0.0.5 API (verified 2026-05-18):
        #   mesh.vertex_position.values  → vertex positions (Vec3 list, has .x/.y/.z)
        #   mesh.vertex_indices          → flat Uint32List of indices
        #   mesh.faces                   → FaceList; each Face has .index_begin + .num_indices
        # Faces can be triangles OR quads OR larger n-gons. We fan-triangulate any
        # face with >3 indices into (n-2) triangles for matplotlib.
        for mesh in (scene.meshes or []):
            if not (mesh.num_vertices and mesh.num_faces):
                continue
            pos = np.array(
                [(v.x, v.y, v.z) for v in mesh.vertex_position.values],
                dtype=np.float32,
            )
            indices = list(mesh.vertex_indices)
            tri_list = []
            for face in mesh.faces:
                n = face.num_indices
                begin = face.index_begin
                if n < 3:
                    continue
                fv = [indices[begin + i] for i in range(n)]
                if n == 3:
                    tri_list.append(fv)
                else:
                    # Fan-triangulate quads + n-gons
                    for i in range(1, n - 1):
                        tri_list.append([fv[0], fv[i], fv[i + 1]])
                if len(tri_list) >= 5000:
                    break
            if not tri_list:
                continue
            verts = pos
            faces = np.array(tri_list, dtype=np.int32)
            break
        if verts is None or faces is None or len(verts) == 0:
            return False
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection
        fig = plt.figure(figsize=(4, 4))
        ax = fig.add_subplot(111, projection="3d")
        polys = [verts[face] for face in faces if max(face) < len(verts)]
        if polys:
            ax.add_collection3d(Poly3DCollection(polys, alpha=0.6, edgecolor="k", linewidth=0.1))
            xs, ys, zs = verts[:, 0], verts[:, 1], verts[:, 2]
            ax.set_xlim([xs.min(), xs.max() if xs.max() > xs.min() else xs.min() + 1])
            ax.set_ylim([ys.min(), ys.max() if ys.max() > ys.min() else ys.min() + 1])
            ax.set_zlim([zs.min(), zs.max() if zs.max() > zs.min() else zs.min() + 1])
        ax.set_axis_off()
        fig.savefig(out_path, dpi=100, bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        return out_path.exists() and out_path.stat().st_size > 1000
    except Exception as e:
        _log(f"  ufbx render failed for {src_path.name}: {str(e)[:100]}")
        return False


# Explicitly-unsupported extensions — return None immediately so the per-asset
# loop records them as failed and moves on, instead of asking a 3D renderer
# to load them and crashing the process. HDR/EXR are environment maps (no
# meaningful vision-classifiable content). Audio/font files can leak into the
# manifest if asset_manifest.py doesn't filter them. .blend is a Blender
# project file we can't render without Blender.
_SKIP_EXTS = {".hdr", ".exr", ".blend", ".wav", ".mp3", ".ogg", ".m4a",
              ".ttf", ".otf", ".woff", ".woff2"}


# ── Prepare image bytes for classification ───────────────────────────────
def prepare_image(src_path: Path) -> Path | None:
    """Return a PNG path suitable for classification. For 2D assets returns
    the original. For 3D, renders a thumbnail. For unsupported, returns None."""
    ext = src_path.suffix.lower()
    if ext in _SKIP_EXTS:
        return None
    if ext in (".png", ".jpg", ".jpeg"):
        return src_path
    if ext in (".svg",):
        out = THUMB_DIR / (src_path.stem + ".png")
        if out.exists() and out.stat().st_size > 100:
            return out
        # 2026-05-18: svglib + reportlab (+ pycairo) is the primary path.
        # IMPORTANT: cairocffi must NOT be installed — rlPyCairo prefers it
        # at import time and cairocffi can't find libcairo-2.dll on Windows,
        # which crashes the whole chain at module import. When ONLY pycairo
        # is installed, rlPyCairo falls back to pycairo (which bundles cairo
        # in its Windows wheel) and SVG rendering works end-to-end.
        # `pip uninstall cairocffi` if it ever sneaks back in via a transitive dep.
        try:
            from svglib.svglib import svg2rlg
            from reportlab.graphics import renderPM
            drawing = svg2rlg(str(src_path))
            if drawing is not None:
                renderPM.drawToFile(drawing, str(out), fmt="PNG")
                if out.exists() and out.stat().st_size > 100:
                    return out
        except Exception:
            pass
        # Fallback: cairosvg (only if libcairo-2.dll happens to be present)
        try:
            import cairosvg
            cairosvg.svg2png(url=str(src_path), write_to=str(out),
                             output_width=256, output_height=256)
            if out.exists() and out.stat().st_size > 100:
                return out
        except Exception:
            pass
        return None
    if ext in (".glb", ".gltf", ".fbx", ".obj"):
        # Render via trimesh
        out = THUMB_DIR / (src_path.stem + "_" + str(abs(hash(str(src_path))))[:8] + ".png")
        if render_3d_thumbnail(src_path, out):
            return out
        return None
    return None


# ── Claude CLI classification call ────────────────────────────────────────
def classify_via_claude(image_path: Path, original_filename: str) -> dict | None:
    """Send image + filename to `claude -p` and parse the classification JSON.

    Uses stdin to pass the image via a data URL (since CLI doesn't natively
    accept images). We work around this by writing a prompt that references
    the image PATH and letting Claude's Read tool load it, OR by base64-encoding.

    For simplicity: write a markdown prompt with a local image reference that
    Claude can read via Read tool.
    """
    try:
        prompt = f"""Look at the image at: {image_path.absolute()}

This is a game asset. Filename: {original_filename}

Classify it as JSON with these exact keys:
{{
  "role": "hero|villain|boss|enemy|npc|weapon|structure|prop|nature|vehicle|ui|tile|bg|unknown",
  "era": "medieval|ancient|fantasy|modern|sci-fi|cyberpunk|post-apocalyptic|horror|steampunk|cute|unknown",
  "archetype": "one word or hyphenated phrase: knight, paladin, zombie, goblin, sports-car, medieval-sword, etc",
  "themes": ["list of descriptive tags like 'undead', 'fire', 'ice', 'jungle', 'gothic'"],
  "incompatible_with": ["list of genres this should NEVER appear in, e.g. 'cyberpunk', 'farming-life', 'roblox-clicker'"],
  "good_for": ["list of genres this FITS, e.g. 'arpg', 'rpg', '3d-platformer'"],
  "visual_description": "one sentence describing what you actually see",
  "confidence": 0.0-1.0
}}

Be honest — if the image is unclear or corrupt, set role='unknown' and confidence=0.1.
Respond with ONLY the JSON, no other text."""

        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, cwd=str(ROOT)
        )
        combined = (result.stdout + " " + result.stderr).lower()
        # Detect rate limit / quota errors — caller will back off
        if any(m in combined for m in RATE_LIMIT_MARKERS):
            _log(f"  ⚠️ rate_limit detected: {result.stderr[:200] or result.stdout[:200]}")
            return {"_rate_limited": True, "_raw": (result.stderr or result.stdout)[:300]}
        if result.returncode != 0:
            _log(f"  claude rc={result.returncode} stderr={result.stderr[:100]}")
            return None
        resp = result.stdout.strip()
        # Extract JSON from response
        start = resp.find("{")
        end = resp.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(resp[start:end])
            except json.JSONDecodeError as e:
                _log(f"  JSON parse error: {e}")
                _log(f"  Raw response: {resp[:200]}")
        return None
    except subprocess.TimeoutExpired:
        _log(f"  claude timeout for {original_filename}")
        return None
    except Exception as e:
        _log(f"  claude error: {e}")
        return None


# ── Progress state ────────────────────────────────────────────────────────
def _load_progress():
    """Resume ledger, UNIONED with the keys of asset_vision_classifications.json.

    The results file is the authoritative record of work actually done, so a lost,
    truncated or reverted .progress file can never cause us to re-classify an asset we
    already hold an answer for.

    Why this matters (2026-08-16): `state/vision_classify.progress` was git-TRACKED, and
    the committed copy held only 291 entries. Any routine git checkout/reset reverted the
    ledger, so every Saturday the classifier re-did ~5,000 assets it had already classified
    — progress oscillated 291 -> 5,299 -> 291 -> ... for 18 weeks and never passed 27%,
    burning a full 12-hour vision-call window each time. The file is now gitignored AND
    this union makes the resume idempotent even if the ledger is lost again.
    """
    prog = {"completed": [], "failed": [], "started_at": None}
    if PROGRESS_PATH.exists():
        try:
            loaded = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                prog = loaded
        except Exception:
            pass
    prog.setdefault("completed", [])
    prog.setdefault("failed", [])
    prog.setdefault("started_at", None)
    try:
        already = set(_load_classifications().keys())
    except Exception:
        already = set()
    if already:
        prog["completed"] = sorted(set(prog["completed"]) | already)
    return prog


def _save_progress(prog):
    try:
        PROGRESS_PATH.write_text(json.dumps(prog, indent=2), encoding="utf-8")
    except Exception:
        pass


def _load_classifications():
    if not CLASS_PATH.exists():
        return {}
    try:
        return json.loads(CLASS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_classifications(cls):
    try:
        CLASS_PATH.write_text(json.dumps(cls, indent=2), encoding="utf-8")
    except Exception:
        pass


# ── Self-delete scheduled task ────────────────────────────────────────────
def _self_delete_task(task_name="ClawVisionClassify"):
    try:
        subprocess.run(
            ["schtasks", "/delete", "/tn", task_name, "/f"],
            capture_output=True, timeout=15,
        )
        _log(f"Scheduled task '{task_name}' deleted (100% complete)")
        _tg(f"✅ Vision classifier complete. Task '{task_name}' self-deleted.")
    except Exception as e:
        _log(f"Task self-delete failed: {e}")


# ── Main driver ───────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Ignore Saturday window (testing)")
    ap.add_argument("--limit", type=int, default=0, help="Only classify N files then stop")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete-task", action="store_true",
                    help="Delete ClawVisionClassify scheduled task (call after reviewing results)")
    args = ap.parse_args()

    if args.delete_task:
        _self_delete_task()
        sys.exit(0)

    if not _in_window(args.force):
        _log(f"Outside Saturday 8am-8pm window — aborting. Next window: next Saturday.")
        sys.exit(0)

    if not MANIFEST_PATH.exists():
        _log("Asset manifest missing — run asset_manifest.py first"); sys.exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    classifications = _load_classifications()
    progress = _load_progress()

    # Build the full list of files to classify (skip already done)
    queue = []
    for pack_name, pack in manifest.get("packs", {}).items():
        kind = pack.get("kind")
        if kind not in CLASSIFY_KINDS:
            continue
        for f in pack.get("files", []):
            rel = f["rel_path"]
            if rel in classifications:
                continue
            if rel in progress.get("completed", []):
                continue
            queue.append({"rel_path": rel, "pack": pack_name, "kind": kind})

    if not progress.get("started_at"):
        progress["started_at"] = datetime.datetime.now().isoformat()
        _save_progress(progress)

    total_all = sum(p.get("file_count", 0) for p in manifest.get("packs", {}).values() if p.get("kind") in CLASSIFY_KINDS)
    done_before = total_all - len(queue)
    _log(f"Vision classify starting — {len(queue)} files in queue, {done_before} already done ({100*done_before/max(1,total_all):.1f}%)")

    # 2026-05-18: send startup Telegram ONCE per day. The supervisor restarts
    # the classifier on every crash (105x on Sat May 16). Without this sentinel
    # the user got 105 startup Telegrams in one day. Sentinel file is purged
    # at the start of each day's session via cleanup below.
    _state_dir = PROGRESS_PATH.parent
    SESSION_FLAG = _state_dir / f"vision_session_{datetime.date.today().isoformat()}.flag"
    # Purge any older flag files from previous days
    for stale in _state_dir.glob("vision_session_*.flag"):
        if stale.name != SESSION_FLAG.name:
            try: stale.unlink()
            except Exception: pass
    if not SESSION_FLAG.exists():
        _tg(f"👁️ Vision classify starting\n{len(queue)} files in queue\n{done_before}/{total_all} done previously\nWindow: Saturday 8 AM - 8 PM")
        try: SESSION_FLAG.touch()
        except Exception: pass

    classified_this_run = 0
    errors_this_run = 0
    last_heartbeat = time.time()

    for idx, item in enumerate(queue):
        # Hourly heartbeat — proves task is alive (LOG ONLY, no Telegram)
        if time.time() - last_heartbeat >= HEARTBEAT_SEC:
            pct = 100 * (done_before + classified_this_run) / max(1, total_all)
            _log(f"💓 Heartbeat: {classified_this_run} this hour | {done_before + classified_this_run}/{total_all} total ({pct:.1f}%) | {errors_this_run} errors")
            last_heartbeat = time.time()
        # Window + budget guards
        if not _in_window(args.force):
            _log(f"Hit end of window (8 PM). Pausing at {idx}/{len(queue)}.")
            # Supervisor sends the end-of-day summary Telegram with full stats.
            break
        if args.limit and classified_this_run >= args.limit:
            _log(f"Hit --limit {args.limit}. Stopping."); break
        if classified_this_run >= MAX_CLASSIFY_PER_RUN:
            _log("Hit MAX_CLASSIFY_PER_RUN safety cap."); break

        src_path = ASSETS_DIR / item["rel_path"]
        if not src_path.exists():
            errors_this_run += 1
            progress.setdefault("failed", []).append(item["rel_path"])
            _save_progress(progress)
            continue

        _log(f"[{idx+1}/{len(queue)}] {item['rel_path']}")

        if args.dry_run:
            _log("  [dry-run] would classify")
            continue

        # 2026-05-18: wrap per-asset work in try/except so a Python exception
        # in prepare_image / classify_via_claude doesn't kill the whole loop
        # AND so we mark the offending file as failed BEFORE any potential
        # crash — preventing the exit-120 crash-loop where the supervisor
        # restarted us on the same file repeatedly.
        try:
            # Prepare image
            img_path = prepare_image(src_path)
            if not img_path:
                _log(f"  SKIP — no image available")
                errors_this_run += 1
                progress.setdefault("failed", []).append(item["rel_path"])
                _save_progress(progress)
                continue

            # Classify via Claude CLI — with rate-limit-aware retry
            backoff_idx = 0
            cls = None
            while True:
                cls = classify_via_claude(img_path, src_path.name)
                if cls is None:
                    errors_this_run += 1
                    progress.setdefault("failed", []).append(item["rel_path"])
                    _log(f"  FAIL classification (non-rate-limit)")
                    _save_progress(progress)
                    break
                if cls.get("_rate_limited"):
                    wait = BACKOFF_SCHEDULE[min(backoff_idx, len(BACKOFF_SCHEDULE) - 1)]
                    # LOG ONLY — rate-limit backoff is normal behavior, not worth a Telegram per occurrence.
                    _log(f"  ⏳ Rate-limited. Sleeping {wait}s then retrying. (backoff step {backoff_idx+1})")
                    chunked = 0
                    while chunked < wait:
                        if not _in_window(args.force):
                            _log("  Hit 8 PM during backoff — stopping.")
                            break
                        time.sleep(min(60, wait - chunked))
                        chunked += 60
                    if not _in_window(args.force):
                        break
                    backoff_idx += 1
                    continue
                # Success
                cls["classifier"] = "claude_vision_cli"
                cls["kind"] = item["kind"]
                cls["pack"] = item["pack"]
                classifications[item["rel_path"]] = cls
                progress.setdefault("completed", []).append(item["rel_path"])
                classified_this_run += 1
                _log(f"  OK: role={cls.get('role')} era={cls.get('era')} conf={cls.get('confidence')}")
                _save_progress(progress)  # persist after each successful classification
                break
        except Exception as e:
            # Catch ANY Python exception so a bad asset can't crash the loop.
            # Native abort()s still kill the process but at least Python-level
            # errors are now isolated to one file.
            _log(f"  EXCEPTION on {item['rel_path']}: {type(e).__name__}: {str(e)[:200]}")
            errors_this_run += 1
            progress.setdefault("failed", []).append(item["rel_path"])
            _save_progress(progress)
            continue

        # Re-check window after possible long backoff
        if not _in_window(args.force):
            _log("Hit end of window during backoff. Pausing.")
            break

        # Persist classifications JSON every 10 successful items (full file
        # write is more expensive than the per-file progress save above).
        if classified_this_run % 10 == 0:
            _save_classifications(classifications)

        # 2026-05-18: removed per-N-files Telegram (was firing every 25 files).
        # All progress visible in vision_classify.log + state/vision_classify.progress.
        # Supervisor sends ONE final summary Telegram at 8 PM.

        # Minimal polite pause (1 sec) after each successful call
        time.sleep(MIN_DELAY_SEC)

    # Final save
    _save_classifications(classifications)
    _save_progress(progress)

    total_done_now = done_before + classified_this_run
    _log(f"Run complete: {classified_this_run} new this run, {errors_this_run} errors, {total_done_now}/{total_all} total")

    # 2026-05-18: removed end-of-run Telegram from classifier. The classifier
    # is restarted by the supervisor on every crash (up to 105x/day observed),
    # so each instance hitting this code would have spammed the operator.
    # The supervisor sends ONE end-of-day Telegram with cumulative stats at
    # 8 PM, reading from the .progress file. The classifier logs everything
    # to vision_classify.log; no per-instance Telegram is appropriate here.


if __name__ == "__main__":
    main()
