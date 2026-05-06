"""
boss_attack_animator.py — Generate per-attack bespoke animations for bosses.

2026-04-23: standard character_consistency gives 10 generic frames
(idle/run/jump/attack_1-2/hurt/die) per boss. For AAA tier, each boss attack
described in boss.phases[].attacks deserves its OWN animation — different
windup/strike/recovery poses per attack.

For King Brambleback (3 phases × 3 attacks = 9 attacks), this means:
  - Vine Whip:  3 frames (windup, strike, recover)
  - Seed Barrage: 3 frames (inhale, shoot, settle)
  - Root Cage:  3 frames (summon, trap forms, release)
  - ... for all 9 attacks
  Plus: idle (3), walk (4), hit (2), death (4) = 40+ frames per boss.

For 4 bosses × ~40 frames = 160 PixelLab calls = 8% of 2000 quota.

Frame naming on disk:
  assets/boss_{i:02d}_{safe_name}/
    boss_{i:02d}_{safe_name}_attack_{safe_attack}_1.png   (windup)
    boss_{i:02d}_{safe_name}_attack_{safe_attack}_2.png   (strike)
    boss_{i:02d}_{safe_name}_attack_{safe_attack}_3.png   (recover)
"""
from __future__ import annotations
import json
import re
import time
from pathlib import Path


def _safe_slug(s: str, maxlen: int = 20) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", s.lower()).strip("_")
    return cleaned[:maxlen] or "attack"


# Pose template variations for attack phases (windup / strike / recover)
ATTACK_POSE_TEMPLATES = [
    ("1", "winding up, telegraphing, arms back, intimidating stance"),
    ("2", "mid-strike, projectile or weapon extended, aggressive full-commit pose"),
    ("3", "follow-through, recovery stance, weight shifted after attack"),
]


def generate_boss_attack_animations(boss_spec: dict, boss_index: int,
                                     assets_dir: Path, log_fn=print) -> dict:
    """Generate per-attack animation frames for ONE boss.

    Inputs:
      boss_spec: one entry from design.bosses[] — expects name + visual_description
                 + phases[].attacks (list of attack name/descriptions)
      boss_index: position in design.bosses (0, 1, 2, 3)
      assets_dir: game's assets/ Path

    Output:
      Writes frames to assets/boss_<i>_<safe>/ and returns a dict describing
      what was generated:
      {
        "boss_key": "boss_00_KingBramblebackTheVerdantTyrant",
        "attacks": {
          "vine_whip": {"frames": ["...", "..."], "phase": 1},
          "seed_barrage": {...},
          ...
        },
        "frames_generated": N
      }
    """
    import sys as _s
    _s.path.insert(0, str(Path(__file__).resolve().parent))
    from character_consistency import generate_frame_with_reference

    safe = "".join(c if c.isalnum() else "_" for c in boss_spec.get("name", f"boss_{boss_index}"))[:30]
    boss_key = f"boss_{boss_index:02d}_{safe}"
    boss_dir = assets_dir / boss_key
    boss_dir.mkdir(parents=True, exist_ok=True)

    result = {"boss_key": boss_key, "attacks": {}, "frames_generated": 0}

    # Reference image: prefer existing idle frame from baseline pass
    ref_path = boss_dir / f"{boss_key}_idle.png"
    if not ref_path.exists():
        log_fn(f"  [boss-attack] No idle reference for {boss_key} — skipping per-attack frames")
        return result

    visual = boss_spec.get("visual_description", "")

    # Iterate phases → attacks
    phases = boss_spec.get("phases") or []
    all_attacks = []
    for phase_idx, phase in enumerate(phases):
        if not isinstance(phase, dict):
            continue
        attacks = phase.get("attacks") or []
        for atk_desc in attacks:
            atk_str = atk_desc if isinstance(atk_desc, str) else str(atk_desc)
            # Extract attack name (part before colon) + description (after)
            if ":" in atk_str:
                atk_name, atk_full = atk_str.split(":", 1)
            else:
                atk_name, atk_full = atk_str, atk_str
            all_attacks.append({
                "name": atk_name.strip(),
                "description": atk_full.strip(),
                "phase": phase.get("phase_num", phase_idx + 1),
            })

    # Dedup attacks by safe-slug (some bosses repeat attack names across phases)
    seen_slugs = set()
    unique_attacks = []
    for atk in all_attacks:
        slug = _safe_slug(atk["name"])
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        unique_attacks.append({**atk, "slug": slug})

    log_fn(f"  [boss-attack] {boss_key}: generating per-attack frames for {len(unique_attacks)} unique attacks")

    result["frames_cached"] = 0
    for atk in unique_attacks:
        slug = atk["slug"]
        atk_frames = []
        for frame_num, pose_hint in ATTACK_POSE_TEMPLATES:
            frame_file = boss_dir / f"{boss_key}_attack_{slug}_{frame_num}.png"
            if frame_file.exists():
                atk_frames.append(frame_file.name)
                result["frames_cached"] += 1
                continue
            pose_prompt = (
                f"performing {atk['name']}: {atk['description'][:120]}. "
                f"Phase {frame_num} of 3 — {pose_hint}."
            )
            ok = generate_frame_with_reference(visual, pose_prompt, ref_path, frame_file)
            if ok and frame_file.exists() and frame_file.stat().st_size > 100:
                atk_frames.append(frame_file.name)
                result["frames_generated"] += 1
            time.sleep(0.8)  # polite pause between PixelLab calls

        if atk_frames:
            result["attacks"][slug] = {
                "name": atk["name"],
                "phase": atk["phase"],
                "frames": atk_frames,
            }
            log_fn(f"    [ok] {atk['name']!r} -> {len(atk_frames)} frames ({slug})")
        else:
            log_fn(f"    [fail] {atk['name']!r} -> 0 frames generated (PixelLab failures)")

    # Save metadata
    meta_file = boss_dir / "attack_animations.json"
    meta_file.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    total = result["frames_generated"] + result["frames_cached"]
    log_fn(f"  [boss-attack] {boss_key}: {result['frames_generated']} new + "
           f"{result['frames_cached']} cached = {total} attack frames across "
           f"{len(result['attacks'])} attacks")
    return result


def generate_all_boss_attack_animations(bosses: list, assets_dir: Path, log_fn=print) -> list:
    """Run per-attack generation for every boss in design. Returns list of
    per-boss results (for phase_assets to include in sprite_manifest).
    """
    results = []
    for i, boss in enumerate(bosses):
        if not boss.get("visual_description"):
            continue
        try:
            r = generate_boss_attack_animations(boss, i, assets_dir, log_fn)
            results.append(r)
        except Exception as e:
            log_fn(f"  [boss-attack] ERROR on boss {i}: {e}")
    return results


if __name__ == "__main__":
    # Quick CLI test
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--design", required=True)
    ap.add_argument("--assets", required=True)
    args = ap.parse_args()
    design = json.loads(Path(args.design).read_text(encoding="utf-8"))
    r = generate_all_boss_attack_animations(design.get("bosses", []), Path(args.assets))
    print(json.dumps(r, indent=2))
