#!/usr/bin/env python3
"""test_ai_qa_panel.py — hermetic unit test for the multi-agent AI QA panel. NO claude -p, NO network.
Proves the deterministic harness around the per-inspector claude -p calls: prompt assembly, command
building, response parsing, per-inspector pass/floor/deferred logic, aggregation BOTH WAYS, and the
blocking policy. Prints 'AI-QA-PANEL: PASS'."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_qa_panel as A  # noqa: E402

n = 0
fails = []


def chk(label, ok):
    global n
    n += 1
    if not ok:
        fails.append(label)


def insp(name):
    return next(i for i in A.INSPECTORS if i["name"] == name)


V = insp("vision_fidelity")   # vision, blocking
C = insp("genre_fit")         # code, blocking
CTX = {"genre": "platformer", "title": "Lumen Run", "game_js": "export const GAME = { setup(){}, update(){} };",
       "shot": "/tmp/x.png"}

# ── build_prompt / build_command ────────────────────────────────────────────────────────────────
for env in ("FFG_AI_QA_BLOCKING",):
    os.environ.pop(env, None)
pc = A.build_prompt(C, CTX)
chk("code prompt embeds game.js", "export const GAME" in pc)
chk("code prompt names the genre", "platformer" in pc)
chk("code prompt demands JSON", '"pass"' in pc and '"score"' in pc)
pv = A.build_prompt(V, CTX)
chk("vision prompt has rubric, NOT game.js", "programmer art" in pv and "export const GAME" not in pv)
cmd_v = A.build_command(V, CTX)
chk("vision command attaches @shot", cmd_v[0] == "claude" and cmd_v[1] == "-p" and "@/tmp/x.png" in cmd_v[2])
cmd_c = A.build_command(C, CTX)
chk("code command has no @shot", "@" not in cmd_c[2])

# ── parse_verdict ────────────────────────────────────────────────────────────────────────────
chk("parse fenced json", A.parse_verdict('```json\n{"pass": true, "score": 80, "issues": []}\n```')["score"] == 80)
chk("parse unfenced w/ prose", (A.parse_verdict('Sure:\n{"pass": false, "score": 20}') or {}).get("score") == 20)
chk("parse garbage -> None", A.parse_verdict("I cannot evaluate this.") is None)
chk("parse empty -> None", A.parse_verdict("") is None)
chk("parse no-keys -> None", A.parse_verdict('{"foo": 1}') is None)

# ── run_inspector ────────────────────────────────────────────────────────────────────────────
chk("vision w/o shot -> deferred", A.run_inspector(V, {"genre": "x"}, run=True)["deferred"] is True)
chk("code run=False -> deferred", A.run_inspector(C, CTX, run=False)["deferred"] is True)
r_good = A.run_inspector(C, CTX, _raw_override='{"pass": true, "score": 82, "issues": []}')
chk("code good override -> pass True, not deferred", r_good["pass"] is True and r_good["deferred"] is False and r_good["score"] == 82)
r_fail = A.run_inspector(C, CTX, _raw_override='{"pass": false, "score": 30, "issues": ["coloured circles"]}')
chk("code fail override -> pass False + issues", r_fail["pass"] is False and r_fail["issues"] == ["coloured circles"])
r_low = A.run_inspector(C, CTX, _raw_override='{"pass": true, "score": 40}')   # below floor 55
chk("code below-floor -> pass False", r_low["pass"] is False)
r_garbage = A.run_inspector(C, CTX, _raw_override="no json here")
chk("code garbage override -> deferred (unparseable)", r_garbage["deferred"] is True)

# ── aggregate (both ways) ──────────────────────────────────────────────────────────────────────
def res(name, blocking, passed, deferred=False, issues=None):
    return {"name": name, "kind": "code", "blocking": blocking, "pass": passed,
            "score": None, "issues": issues or [], "deferred": deferred, "error": None}

ship = A.aggregate([res("a", True, True), res("b", True, True), res("c", False, True)])
chk("aggregate all pass -> ship", ship["verdict"] == "ship" and not ship["blocking_fails"])
hold = A.aggregate([res("a", True, True), res("genre_fit", True, False, issues=["stub mechanic"])])
chk("aggregate blocking fail -> hold", hold["verdict"] == "hold" and "genre_fit" in hold["blocking_fails"])
adv = A.aggregate([res("a", True, True), res("code_review", False, False)])
chk("aggregate advisory fail -> ship (flagged)", adv["verdict"] == "ship" and "code_review" in adv["advisory_fails"])
defr = A.aggregate([res("vision_fidelity", True, None, deferred=True), res("genre_fit", True, True)])
chk("aggregate deferred blocking -> ship (not hold), flagged", defr["verdict"] == "ship" and "vision_fidelity" in defr["deferred"])

# ── blocking policy ────────────────────────────────────────────────────────────────────────────
os.environ["FFG_AI_QA_BLOCKING"] = "none"
chk("policy none -> vision_fidelity advisory", A._blocking(V) is False)
os.environ["FFG_AI_QA_BLOCKING"] = "all"
chk("policy all -> code_review blocking", A._blocking(insp("code_review")) is True)
os.environ.pop("FFG_AI_QA_BLOCKING", None)
chk("policy default -> per-flag (vision blocking, code_review advisory)",
    A._blocking(V) is True and A._blocking(insp("code_review")) is False)

# ── run_panel end-to-end (no claude -p: all code deferred, vision no-shot -> deferred) -> ship ───
tmp = Path(tempfile.mkdtemp())
(tmp / "game.js").write_text("export const GAME = { sprites:{}, setup(ctx){}, update(dt,ctx){ ctx.win(); } };", encoding="utf-8")
rep = A.run_panel(tmp, "platformer", run=False)
chk("run_panel no-claude -> ship (nothing blocking failed)", rep["verdict"] == "ship")
chk("run_panel reports all 4 inspectors", len(rep["inspectors"]) == 4)
chk("run_panel marks them deferred", all(i["deferred"] for i in rep["inspectors"]))
chk("run_panel wrote ai_qa_report.json", (tmp / "ai_qa_report.json").exists())

print(f"checks run: {n}")
if fails:
    print("FAILED:")
    for f in fails:
        print("  -", f)
    print("AI-QA-PANEL: FAIL")
    sys.exit(1)
print(f"AI-QA-PANEL: PASS ({n} checks)")
sys.exit(0)
