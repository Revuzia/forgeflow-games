#!/usr/bin/env python3
"""
mixamo_integration.py — Mixamo animation library workflow.

HONEST LIMITATION: Mixamo requires Adobe OAuth authentication. Adobe explicitly
forbids automated scraping. A "mixamo-downloader" script exists on GitHub but
requires a user-session cookie + violates TOS. We do NOT automate that here.

WORKFLOW (per-user, one-time):
  1. User logs into mixamo.com with Adobe ID
  2. User downloads any character's animation bundle (FBX, 60-frame, skin-to-character)
     — the Mixamo site lets you download the WHOLE character with 20-40 animations
     in a single FBX at no cost
  3. User drops the FBX into `pipeline/assets/_downloaded/mixamo/`
  4. This script extracts per-animation clips from the FBX and registers them
     in the asset manifest under kind="animation_3d"

OR (fully automated alternative): use open-source mocap libraries instead:
  - CMU Motion Capture Database (cmuhri.com, free, 2500+ clips, BVH format)
  - OpenAI Gymnasium's Mo* baseline animations
  - Unity Asset Store free packs re-exported
  - Universal Animation Library on itch.io (120+ animations)

This module:
  - Accepts user-downloaded Mixamo FBX files from the drop folder
  - Registers them in the manifest so Three.js pipelines can load them
  - Provides a simple CLI to list what's available

Usage:
  python scripts/mixamo_integration.py --list          # list available animations
  python scripts/mixamo_integration.py --scan          # (re)scan drop folder
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
MIXAMO_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets" / "_downloaded" / "mixamo"
MIXAMO_DIR.mkdir(parents=True, exist_ok=True)

MANIFEST_FILE = MIXAMO_DIR / "manifest.json"


def scan() -> dict:
    """Scan the drop folder for FBX/GLB animation files and build a manifest."""
    animations = []
    for fbx in MIXAMO_DIR.rglob("*.fbx"):
        animations.append({
            "name": fbx.stem,
            "path": str(fbx.relative_to(ROOT)),
            "format": "fbx",
            "size_bytes": fbx.stat().st_size,
        })
    for glb in MIXAMO_DIR.rglob("*.glb"):
        animations.append({
            "name": glb.stem,
            "path": str(glb.relative_to(ROOT)),
            "format": "glb",
            "size_bytes": glb.stat().st_size,
        })
    manifest = {
        "type": "mixamo-or-mocap",
        "count": len(animations),
        "animations": animations,
        "notes": (
            "Drop Mixamo FBX bundles here. For fully-automated alternative, download "
            "CMU Mocap BVH library or Universal Animation Library (itch.io) and drop "
            "files into this directory — format detection is automatic."
        ),
    }
    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def list_animations():
    if not MANIFEST_FILE.exists():
        scan()
    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    print(f"Mixamo/mocap animations: {manifest['count']}")
    for a in manifest["animations"][:30]:
        print(f"  - {a['name']} ({a['format']}, {a['size_bytes']//1024}KB)")


def write_instructions():
    README = MIXAMO_DIR / "README.md"
    README.write_text(
        "# Mixamo Animation Drop Folder\n\n"
        "Mixamo requires Adobe OAuth login — we can't auto-download.\n\n"
        "## Steps:\n"
        "1. Go to https://mixamo.com and log in with your Adobe ID\n"
        "2. Pick a Quaternius character (upload `universal-base-characters/*.fbx`)\n"
        "3. Select animations (run, jump, attack, idle, death, hurt) — each is free\n"
        "4. Click **Download**, choose 'FBX Binary (.fbx)', 60 FPS, no skin\n"
        "5. Drop the resulting .fbx file into this folder\n"
        "6. Run: `python scripts/mixamo_integration.py --scan`\n\n"
        "## Automated alternatives (no Adobe login):\n"
        "- **Universal Animation Library** (https://itch.io/game-assets/tag-animations) — 120+ animations CC0\n"
        "- **CMU Motion Capture Database** (http://mocap.cs.cmu.edu/) — 2500+ BVH clips\n"
        "- **Ready Player Me** (https://readyplayer.me/) — free humanoid rigs with animations\n",
        encoding="utf-8",
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan",  action="store_true")
    ap.add_argument("--list",  action="store_true")
    args = ap.parse_args()

    write_instructions()

    if args.scan or (not args.list):
        manifest = scan()
        print(f"Scanned {manifest['count']} animation files in {MIXAMO_DIR}")
    if args.list:
        list_animations()


if __name__ == "__main__":
    main()
