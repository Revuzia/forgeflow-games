#!/usr/bin/env python3
"""
level_balance.py — Validate level difficulty curves match playtester reality.

AAA standard: a level's stated difficulty MUST match how long a competent player
takes. If blueprint says "level 3 difficulty 3/10" but speedrun bot needs 5 min,
the level is over-tuned. If blueprint says 8/10 and bot clears in 15 sec, the
level is under-tuned.

This checks:
  1. Blueprint difficulty monotonically increases (1,2,3,... not 1,5,3,2)
  2. Speedrun bot's actual completion times correlate with stated difficulty
     (Pearson correlation should be positive; negative means mis-tuned)
  3. Each level is completable (reachability solver verdict)
  4. Reasonable enemy count (scales with difficulty)

Run after phase_qa's playtest. Report to logs + catalog.
"""
import argparse
import json
import sys
from pathlib import Path


def _pearson(xs, ys):
    n = len(xs)
    if n < 2: return 0.0
    mean_x = sum(xs) / n; mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den_x = sum((x - mean_x)**2 for x in xs) ** 0.5
    den_y = sum((y - mean_y)**2 for y in ys) ** 0.5
    if den_x == 0 or den_y == 0: return 0.0
    return num / (den_x * den_y)


def validate(design_path: Path, levels_path: Path, qa_results_path: Path,
             physics: dict | None = None) -> dict:
    """L4 level balance check.

    Args:
        physics: derived player physics (jump_height_tiles, horizontal_speed_tiles,
                 double_jump, dash_tiles). If provided, this function re-runs L2
                 reachability with the actual game's physics rather than reading
                 stale qa_results.json. (2026-04-27 fix — was reporting 0%
                 reachable on games that L2 itself reported 100% reachable, due
                 to L4 reading stale snapshot.)
    """
    findings = {"score": 100, "issues": [], "warnings": [], "stats": {}}

    design = json.loads(design_path.read_text(encoding="utf-8")) if design_path.exists() else {}
    blueprints = design.get("levels", [])

    levels = []
    if levels_path.exists():
        try:
            data = json.loads(levels_path.read_text(encoding="utf-8"))
            levels = data if isinstance(data, list) else data.get("levels", [])
        except Exception:
            pass

    # 1. Difficulty monotonicity
    difficulties = [b.get("difficulty_1_to_10", 0) for b in blueprints]
    inversions = sum(1 for i in range(1, len(difficulties)) if difficulties[i] < difficulties[i-1])
    if inversions > len(difficulties) * 0.25:
        findings["issues"].append(f"Difficulty curve has {inversions} inversions (levels going backward in difficulty)")
        findings["score"] -= 10

    # 2. Speedrun correlation — only if speedrun results exist
    qa = {}
    if qa_results_path.exists():
        try:
            qa = json.loads(qa_results_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    speedrun = qa.get("l3_speedrun", {})
    if speedrun and speedrun.get("per_level"):
        levels_tested = speedrun["per_level"]
        if len(levels_tested) >= 3:
            # Compare difficulty vs duration
            xs, ys = [], []
            for lt in levels_tested:
                lvl_idx = lt.get("level", 0)
                if lvl_idx < len(difficulties):
                    xs.append(difficulties[lvl_idx])
                    ys.append(lt.get("duration_sec", 0))
            r = _pearson(xs, ys)
            findings["stats"]["difficulty_duration_correlation"] = round(r, 2)
            if r < 0.1:
                findings["warnings"].append(
                    f"Weak difficulty-duration correlation (r={r:.2f}). "
                    f"Blueprint difficulty may not match actual player experience."
                )
                findings["score"] -= 5

    # 3. Reachability — re-run with derived physics if provided, else fall
    # back to whatever qa_results.json snapshot is on disk.
    l2 = qa.get("l2_reachability", {})
    if physics is not None and levels:
        # Fresh L2 with the game's actual physics — avoids stale qa_results.json
        try:
            from reachability_solver import check_level
            checked = 0
            completable = 0
            for lvl in levels:
                ok, _issues = check_level(lvl, physics)
                checked += 1
                if ok: completable += 1
            l2 = {"checked": checked, "completable": completable}
            findings["stats"]["l2_recomputed_with_derived_physics"] = True
        except Exception as _l2e:
            findings["stats"]["l2_recompute_error"] = str(_l2e)[:120]
    if l2.get("checked"):
        completable_pct = l2["completable"] / l2["checked"]
        if completable_pct < 1.0:  # AAA standard: every level must be reachable
            findings["issues"].append(
                f"Only {completable_pct:.0%} of levels are reachable by solver. "
                f"{l2['checked'] - l2['completable']} levels may be broken."
            )
            findings["score"] -= 15

    # 4. Enemy scaling — more enemies at higher difficulty
    if levels and blueprints:
        by_diff = {}
        for i, lvl in enumerate(levels):
            if i >= len(difficulties): break
            diff = difficulties[i]
            enemy_count = len(lvl.get("enemies", []))
            by_diff.setdefault(diff, []).append(enemy_count)
        avg_per_diff = {d: sum(c)/len(c) for d, c in by_diff.items() if c}
        if len(avg_per_diff) >= 3:
            sorted_diffs = sorted(avg_per_diff.items())
            trending_up = sum(1 for i in range(1, len(sorted_diffs))
                              if sorted_diffs[i][1] > sorted_diffs[i-1][1])
            if trending_up < len(sorted_diffs) * 0.5:
                findings["warnings"].append(
                    "Enemy count doesn't scale with difficulty — harder levels should have more/tougher enemies"
                )
                findings["score"] -= 5
        findings["stats"]["enemies_per_difficulty"] = {str(d): round(v, 1) for d, v in avg_per_diff.items()}

    findings["score"] = max(0, findings["score"])
    # 2026-04-28: AAA standard — L4 must be 100/100 to pass. Anything less
    # means a balance warning fired (weak difficulty correlation, levels
    # unreachable, enemy scaling not increasing) which represents real game
    # design issues that should be fixed before ship.
    findings["verdict"] = (
        "pass" if findings["score"] == 100 else
        "borderline" if findings["score"] >= 75 else
        "fail"
    )
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--design", required=True)
    ap.add_argument("--levels", required=True)
    ap.add_argument("--qa", required=True)
    args = ap.parse_args()
    result = validate(Path(args.design), Path(args.levels), Path(args.qa))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["verdict"] != "fail" else 1)


if __name__ == "__main__":
    main()
