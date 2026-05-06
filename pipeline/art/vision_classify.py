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
    print(line, flush=True)
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
        return False


# ── Prepare image bytes for classification ───────────────────────────────
def prepare_image(src_path: Path) -> Path | None:
    """Return a PNG path suitable for classification. For 2D assets returns
    the original. For 3D, renders a thumbnail. For unsupported, returns None."""
    ext = src_path.suffix.lower()
    if ext in (".png", ".jpg", ".jpeg"):
        return src_path
    if ext in (".svg",):
        # Convert SVG to PNG via cairosvg if available.
        # 2026-04-26: also catch OSError — cairosvg requires libcairo-2.dll on
        # Windows; if missing, the import succeeds but svg2png raises OSError
        # at the dlopen layer. Without this except, the whole script crashed
        # on every SVG file and the supervisor restarted it 107x = 200 TG msgs.
        try:
            import cairosvg
            out = THUMB_DIR / (src_path.stem + ".png")
            if not out.exists():
                cairosvg.svg2png(url=str(src_path), write_to=str(out), output_width=256, output_height=256)
            return out
        except (ImportError, OSError) as e:
            # Skip SVG silently — classifier treats unsupported files as None.
            # Don't log per-file (would flood logs); a single startup warning is enough.
            return None
        except Exception:
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
    if not PROGRESS_PATH.exists():
        return {"completed": [], "failed": [], "started_at": None}
    try:
        return json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"completed": [], "failed": [], "started_at": None}


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
    _tg(f"👁️ Vision classify starting\n{len(queue)} files in queue\n{done_before}/{total_all} done previously\nWindow: Saturday 8 AM - 8 PM")

    classified_this_run = 0
    errors_this_run = 0
    last_heartbeat = time.time()

    for idx, item in enumerate(queue):
        # Hourly heartbeat — proves task is alive
        if time.time() - last_heartbeat >= HEARTBEAT_SEC:
            pct = 100 * (done_before + classified_this_run) / max(1, total_all)
            _log(f"💓 Heartbeat: {classified_this_run} this hour | {done_before + classified_this_run}/{total_all} total ({pct:.1f}%)")
            _tg(f"💓 Vision classifier alive\n{classified_this_run} this run | {pct:.1f}% total\n{errors_this_run} errors")
            last_heartbeat = time.time()
        # Window + budget guards
        if not _in_window(args.force):
            _log(f"Hit end of window (8 PM). Pausing at {idx}/{len(queue)}.")
            _tg(f"⏸️ Vision classify paused at 8 PM — {idx}/{len(queue)} this run. Will resume next Saturday.")
            break
        if args.limit and classified_this_run >= args.limit:
            _log(f"Hit --limit {args.limit}. Stopping."); break
        if classified_this_run >= MAX_CLASSIFY_PER_RUN:
            _log("Hit MAX_CLASSIFY_PER_RUN safety cap."); break

        src_path = ASSETS_DIR / item["rel_path"]
        if not src_path.exists():
            errors_this_run += 1
            progress.setdefault("failed", []).append(item["rel_path"])
            continue

        _log(f"[{idx+1}/{len(queue)}] {item['rel_path']}")

        if args.dry_run:
            _log("  [dry-run] would classify")
            continue

        # Prepare image
        img_path = prepare_image(src_path)
        if not img_path:
            _log(f"  SKIP — no image available")
            errors_this_run += 1
            progress.setdefault("failed", []).append(item["rel_path"])
            continue

        # Classify via Claude CLI — with rate-limit-aware retry
        backoff_idx = 0
        cls = None
        while True:
            cls = classify_via_claude(img_path, src_path.name)
            if cls is None:
                # Non-rate-limit failure — give up on this file, continue
                errors_this_run += 1
                progress.setdefault("failed", []).append(item["rel_path"])
                _log(f"  FAIL classification (non-rate-limit)")
                break
            if cls.get("_rate_limited"):
                # Rate-limited. Back off exponentially. Check window between retries.
                wait = BACKOFF_SCHEDULE[min(backoff_idx, len(BACKOFF_SCHEDULE) - 1)]
                _log(f"  ⏳ Rate-limited. Sleeping {wait}s then retrying. (backoff step {backoff_idx+1})")
                _tg(f"⏳ Rate limit hit. Backing off {wait}s and retrying. Progress: {done_before + classified_this_run}/{total_all}")
                # Sleep in small chunks so we can still check window
                chunked = 0
                while chunked < wait:
                    if not _in_window(args.force):
                        _log("  Hit 8 PM during backoff — stopping.")
                        break
                    time.sleep(min(60, wait - chunked))
                    chunked += 60
                if not _in_window(args.force):
                    break  # exit retry loop; outer loop will detect window end
                backoff_idx += 1
                continue  # retry same file
            # Success
            cls["classifier"] = "claude_vision_cli"
            cls["kind"] = item["kind"]
            cls["pack"] = item["pack"]
            classifications[item["rel_path"]] = cls
            progress.setdefault("completed", []).append(item["rel_path"])
            classified_this_run += 1
            _log(f"  OK: role={cls.get('role')} era={cls.get('era')} conf={cls.get('confidence')}")
            break

        # Re-check window after possible long backoff
        if not _in_window(args.force):
            _log("Hit end of window during backoff. Pausing.")
            break

        # Persist every 10 items (resumability)
        if classified_this_run % 10 == 0:
            _save_classifications(classifications)
            _save_progress(progress)

        # Telegram progress
        if classified_this_run > 0 and classified_this_run % TELEGRAM_EVERY_N == 0:
            pct = 100 * (done_before + classified_this_run) / max(1, total_all)
            _tg(f"📊 Vision classify: {classified_this_run} this run | {done_before + classified_this_run}/{total_all} total ({pct:.1f}%) | {errors_this_run} errors")

        # Minimal polite pause (1 sec) after each successful call
        time.sleep(MIN_DELAY_SEC)

    # Final save
    _save_classifications(classifications)
    _save_progress(progress)

    total_done_now = done_before + classified_this_run
    _log(f"Run complete: {classified_this_run} new this run, {errors_this_run} errors, {total_done_now}/{total_all} total")

    # 8 PM summary — user reviews before deleting task (no auto-delete)
    pct_final = 100 * total_done_now / max(1, total_all)
    is_complete = total_done_now >= total_all - 50
    summary = (
        f"🏁 Vision classify run ended at 8 PM\n"
        f"Progress: {total_done_now}/{total_all} ({pct_final:.1f}%)\n"
        f"This run: {classified_this_run} classified, {errors_this_run} errors\n"
        + (f"✅ EFFECTIVELY COMPLETE — waiting for your review before task delete.\n"
           f"Run: python forgeflow-games/pipeline/art/vision_classify.py --delete-task to self-delete."
           if is_complete else
           f"⏸️  Paused for the day. Will auto-resume next Saturday 8 AM.")
    )
    _log(summary)
    _tg(summary)


if __name__ == "__main__":
    main()
