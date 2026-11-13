#!/usr/bin/env python3
"""
regression_test.py — Compare current QA results against baseline. Flag any
metric that went backwards between builds.

Every time a game passes QA, save baseline snapshot. Next build loads the baseline,
compares new QA results, alerts on degradation (FPS dropped 10+, completion rate
fell, level got harder to beat, etc.).

Baseline path: games/<slug>/qa_baseline.json
"""
import argparse
import json
import sys
from pathlib import Path


# What counts as a regression — threshold deltas that trigger alerts
THRESHOLDS = {
    "fps_drop":              5,      # FPS drop of 5+ = regression
    "memory_growth_mb":     20,      # 20+ MB more memory = regression
    "completion_rate_drop": 0.15,    # 15% drop in random-bot completion = regression
    "speedrun_drop":        0.15,    # 15% drop in speedrun levels completed = regression
    "reachability_drop":    0.10,    # 10% drop in reachability_solver = regression
    "balance_drop":         10,      # 10-point drop in balance score = regression
    "overall_drop":         15,      # 15-point drop in overall QA score = regression
    "lint_drop":            10,      # 10-point drop in code quality lint = regression
}


def _get(d, *path, default=None):
    for p in path:
        if isinstance(d, dict): d = d.get(p)
        else: return default
    return d if d is not None else default


def compare(baseline: dict, current: dict) -> dict:
    """Compare baseline vs current QA — return {regressions, improvements, score}."""
    regressions = []
    improvements = []

    # Overall score
    b_score = _get(baseline, "score", default=0)
    c_score = _get(current, "score", default=0)
    if c_score + THRESHOLDS["overall_drop"] < b_score:
        regressions.append({
            "metric": "overall_qa_score",
            "was": b_score, "is": c_score, "delta": c_score - b_score,
        })
    elif c_score > b_score + THRESHOLDS["overall_drop"]:
        improvements.append({"metric": "overall_qa_score", "was": b_score, "is": c_score})

    # FPS
    b_fps = _get(baseline, "l5_performance", "fps", default=60)
    c_fps = _get(current, "l5_performance", "fps", default=60)
    if isinstance(b_fps, (int, float)) and isinstance(c_fps, (int, float)):
        if c_fps + THRESHOLDS["fps_drop"] < b_fps:
            regressions.append({"metric": "fps", "was": b_fps, "is": c_fps, "delta": c_fps - b_fps})

    # Memory
    b_mem = _get(baseline, "l5_performance", "memMB")
    c_mem = _get(current, "l5_performance", "memMB")
    if isinstance(b_mem, (int, float)) and isinstance(c_mem, (int, float)):
        if c_mem > b_mem + THRESHOLDS["memory_growth_mb"]:
            regressions.append({"metric": "memory_mb", "was": b_mem, "is": c_mem, "delta": c_mem - b_mem})

    # Random-bot completion rate
    b_comp = _get(baseline, "l3_playtest", "completion_rate", default=0)
    c_comp = _get(current, "l3_playtest", "completion_rate", default=0)
    if c_comp + THRESHOLDS["completion_rate_drop"] < b_comp:
        regressions.append({"metric": "random_bot_completion_rate", "was": b_comp, "is": c_comp})

    # Speedrun bot — levels_completed / levels_tested
    b_sr_c = _get(baseline, "l3_speedrun", "levels_completed", default=0)
    b_sr_t = _get(baseline, "l3_speedrun", "levels_tested", default=1)
    c_sr_c = _get(current, "l3_speedrun", "levels_completed", default=0)
    c_sr_t = _get(current, "l3_speedrun", "levels_tested", default=1)
    b_sr_ratio = b_sr_c / b_sr_t if b_sr_t else 0
    c_sr_ratio = c_sr_c / c_sr_t if c_sr_t else 0
    if c_sr_ratio + THRESHOLDS["speedrun_drop"] < b_sr_ratio:
        regressions.append({"metric": "speedrun_ratio", "was": b_sr_ratio, "is": c_sr_ratio})

    # Reachability
    b_r_c = _get(baseline, "l2_reachability", "completable", default=0)
    b_r_t = _get(baseline, "l2_reachability", "checked", default=1)
    c_r_c = _get(current, "l2_reachability", "completable", default=0)
    c_r_t = _get(current, "l2_reachability", "checked", default=1)
    b_r_ratio = b_r_c / b_r_t if b_r_t else 0
    c_r_ratio = c_r_c / c_r_t if c_r_t else 0
    if c_r_ratio + THRESHOLDS["reachability_drop"] < b_r_ratio:
        regressions.append({"metric": "reachability_ratio", "was": b_r_ratio, "is": c_r_ratio})

    # Balance
    b_bal = _get(baseline, "l4_balance", "score", default=100)
    c_bal = _get(current, "l4_balance", "score", default=100)
    if c_bal + THRESHOLDS["balance_drop"] < b_bal:
        regressions.append({"metric": "balance_score", "was": b_bal, "is": c_bal})

    return {
        "regression_count": len(regressions),
        "improvement_count": len(improvements),
        "regressions": regressions,
        "improvements": improvements,
        "verdict": "regression" if regressions else "stable_or_improved",
    }


def run(game_dir: Path) -> dict:
    """Load baseline + current, compare, optionally save new baseline."""
    game_dir = Path(game_dir)
    baseline_path = game_dir / "qa_baseline.json"
    current_path = game_dir / "qa_results.json"

    if not current_path.exists():
        return {"error": "no qa_results.json — run QA first"}

    current = json.loads(current_path.read_text(encoding="utf-8"))

    if not baseline_path.exists():
        # First run — save current as baseline
        baseline_path.write_text(json.dumps(current, indent=2), encoding="utf-8")
        return {"verdict": "first_build", "message": "Saved baseline for future comparisons"}

    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    result = compare(baseline, current)

    # If current score is clearly better, promote it to new baseline
    if _get(current, "score", default=0) > _get(baseline, "score", default=0) + 5:
        baseline_path.write_text(json.dumps(current, indent=2), encoding="utf-8")
        result["baseline_updated"] = True

    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir", help="Path to game directory (contains qa_results.json)")
    args = ap.parse_args()
    result = run(Path(args.game_dir))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("verdict") not in ("regression",) else 1)


if __name__ == "__main__":
    main()
