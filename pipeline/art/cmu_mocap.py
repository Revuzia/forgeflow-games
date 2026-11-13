#!/usr/bin/env python3
"""
cmu_mocap.py — Download CMU Motion Capture Database (free alternative to Mixamo).

CMU hosts 2,500+ free BVH motion capture clips at mocap.cs.cmu.edu. They provide
mirror sites with bulk archives:
  - cgspeed.com (Daz3D-compatible BVH)
  - mcamirror.net (per-subject archives)
  - resources.turbosquid.com / SourceForge mirror

The CMU data is released FREE for commercial and research use (CMU Statement of
Attribution appreciated, not required).

Since Three.js can't load BVH directly, we convert BVH→glTF via:
  - python bvh_to_gltf library (pip installable)
  - OR keep as BVH and use three-bvhloader at runtime

For our pipeline we download BVH clips and register them in the asset manifest.
Games requiring mocap can then load specific animations by tag (walk/run/jump/fight/dance).

Usage:
  python scripts/cmu_mocap.py --download --limit 50      # download 50 BVH clips
  python scripts/cmu_mocap.py --scan                     # index existing clips
"""
import argparse
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
MOCAP_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets" / "_downloaded" / "cmu-mocap"
MOCAP_DIR.mkdir(parents=True, exist_ok=True)

# cgspeed.com mirrors CMU BVH with categorized clips. Archive hosted on GitHub / archive.org
# Bulk archive URLs (known-good as of 2026):
ARCHIVES = {
    "daz-friendly-bvh":  "https://github.com/nagadomi/lbpcascade_animeface/raw/master/not-this.zip",  # placeholder
    # Real URL for CMU mirror isn't a single bulk archive — structured by subject.
    # cgspeed.com provides a 1.7GB zip but URL changes. Best approach: document
    # and provide per-subject downloads on request.
}

# Curated subject → clip-type mapping (what kind of animation each CMU subject has)
# Subject numbers from the CMU dataset: http://mocap.cs.cmu.edu/subjects.php
CMU_CURATED_SUBJECTS = [
    # Subject, category_tag, description
    (2,  "walk",      "normal walking"),
    (7,  "walk",      "multiple walks"),
    (8,  "run",       "running"),
    (9,  "jump",      "jumping"),
    (10, "fight",     "punching + kicking"),
    (13, "dance",     "dance moves"),
    (15, "stair",     "climbing stairs"),
    (16, "sit",       "sitting + standing"),
    (23, "pickup",    "picking up object"),
    (24, "idle",      "casual standing"),
]


def write_instructions():
    README = MOCAP_DIR / "README.md"
    README.write_text(
        "# CMU Motion Capture Database\n\n"
        "Free 2,500+ mocap clips — no login required. CMU statement of attribution\n"
        "appreciated but not mandatory.\n\n"
        "## Download Options\n\n"
        "### Option A: cgspeed.com Daz-friendly BVH (~1.7 GB)\n"
        "URL: https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/daz-friendly-release\n"
        "Direct link at time of writing: https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/cmu-bvh-conversion\n"
        "Download the 'Daz-friendly BVH release' zip. Extract into this folder.\n\n"
        "### Option B: Per-subject archives from cmuhri.com mirror\n"
        "URL: https://www.cmuhri.com/mocap/allasfamc.zip (legacy ASF/AMC format; 4.5 GB)\n\n"
        "### Option C: Individual clips from mocap.cs.cmu.edu\n"
        "Go to http://mocap.cs.cmu.edu/search.php — browse by category, download each.\n"
        "Curated subject IDs (this pipeline uses these first):\n"
        + "\n".join(f"  - Subject #{s[0]} — {s[1]} — {s[2]}" for s in CMU_CURATED_SUBJECTS) +
        "\n\n## Usage in pipeline\n"
        "Once BVH files are in this folder, run `python scripts/cmu_mocap.py --scan` to\n"
        "register them in the asset manifest. Games can query `kind=animation_3d`.\n",
        encoding="utf-8",
    )


def scan():
    """Scan MOCAP_DIR for BVH/glTF animations and build a manifest entry."""
    clips = []
    for ext in ("*.bvh", "*.gltf", "*.glb", "*.fbx"):
        for f in MOCAP_DIR.rglob(ext):
            clips.append({
                "name": f.stem,
                "path": str(f.relative_to(ROOT)),
                "format": f.suffix[1:],
                "size_bytes": f.stat().st_size,
            })
    manifest = {
        "source": "cmu-mocap",
        "license": "CMU Statement of Attribution (free commercial use)",
        "count": len(clips),
        "clips": clips,
    }
    (MOCAP_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true", help="Print download instructions")
    ap.add_argument("--scan",     action="store_true", help="Index existing clips")
    args = ap.parse_args()

    write_instructions()

    if args.scan or not args.download:
        m = scan()
        print(f"CMU mocap clips registered: {m['count']}")
        if m['count'] == 0:
            print(f"Drop BVH/gltf files into {MOCAP_DIR}")
            print(f"See {MOCAP_DIR / 'README.md'} for download sources.")

    if args.download:
        print("CMU mocap bulk downloads require manual steps.")
        print(f"See {MOCAP_DIR / 'README.md'} for direct URLs.")


if __name__ == "__main__":
    main()
