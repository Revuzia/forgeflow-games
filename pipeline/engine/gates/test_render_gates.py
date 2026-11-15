#!/usr/bin/env python3
"""test_render_gates.py — CI for render_quality_gate + payload_gate.

Runs the deterministic gates against the EXISTING built games as fixtures (no
claude -p, no browser): the AAA Three-kernel games must PASS the render gate, the
weak from-scratch-engine game must FAIL it, 2D games must skip, and the payload
gate must measure shippable bytes + enforce a budget. Exit 0 only if all hold.
"""
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render_quality_gate as rqg          # noqa: E402
import payload_gate as pg                  # noqa: E402

GAMES = HERE.parents[2] / "games"          # gates -> engine -> pipeline -> forgeflow-games / games
checks = 0
fails = []


def ok(cond, msg):
    global checks
    checks += 1
    if not cond:
        fails.append(msg)


def have(slug, sub=""):
    p = GAMES / slug / "index.html" if not sub else GAMES / sub / slug / "index.html"
    return p.exists()


# ── render_quality: AAA Three-kernel games PASS ───────────────────────────────
for slug in ["void-skirmish-3d", "warboard-chess", "iron-tide"]:
    if not have(slug):
        fails.append(f"fixture missing: games/{slug}")
        continue
    r = rqg.check_render_quality(GAMES / slug)
    ok(r["ok"] and r["verdict"] == "pass", f"{slug}: expected render PASS, got {r['verdict']} ({r.get('reason')})")
    ok(r["render_path"] == "three-kernel", f"{slug}: expected three-kernel, got {r['render_path']}")
    ok(r["markers"].get("toneMapping") and r["markers"].get("shadows") and r["markers"].get("postfx"),
       f"{slug}: missing core AAA markers {r['markers']}")

# ── render_quality: weak from-scratch-engine 3D game FAILS ────────────────────
if have("frost-spire", sub="_engine"):
    r = rqg.check_render_quality(GAMES / "_engine" / "frost-spire")
    ok((not r["ok"]) and r["render_path"] == "from-scratch-engine",
       f"frost-spire: expected FAIL on from-scratch-engine, got {r['verdict']}/{r['render_path']}")
else:
    print("  (note: games/_engine/frost-spire fixture absent — skipping weak-path assertion)")

# ── render_quality: a 2D canvas game is skipped (not failed) ──────────────────
for slug in ["block-breaker", "neon-breakout"]:
    if have(slug):
        r = rqg.check_render_quality(GAMES / slug)
        ok(r["ok"] and r["verdict"] == "skip-2d", f"{slug}: expected skip-2d, got {r['verdict']} ({r.get('render_path')})")
        break

# ── payload: a normal small game is within budget; over-budget is caught ───────
if have("warboard-chess"):
    r = pg.check_payload(GAMES / "warboard-chess", budget_mb=20)
    ok(r["ok"] and r["mb"] > 0, f"warboard-chess: expected within 20MB, got {r['mb']}MB")

with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    (d / "index.html").write_text("<canvas></canvas>", encoding="utf-8")
    (d / "big.glb").write_bytes(b"\0" * (13 * 1024 * 1024))   # 13MB shippable asset
    r = pg.check_payload(d, budget_mb=12)
    ok((not r["ok"]) and r["mb"] >= 12, f"payload over-budget not caught: {r['mb']}MB ok={r['ok']}")
    # dev cruft must NOT count
    (d / "notes.bak").write_bytes(b"\0" * (5 * 1024 * 1024))
    r2 = pg.check_payload(d, budget_mb=12)
    ok(abs(r2["mb"] - r["mb"]) < 0.01, f"excluded .bak still counted: {r['mb']} -> {r2['mb']}")

if fails:
    print(f"RENDER-GATES: FAIL ({len(fails)} of {checks} checks)")
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print(f"RENDER-GATES: PASS ({checks} checks)")
sys.exit(0)
