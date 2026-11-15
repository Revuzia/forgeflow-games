#!/usr/bin/env python3
"""test_kernel_target.py — CI for the Tier-3 Three-kernel 3D render target (the keystone).

Proves deterministically (no claude -p, no browser):
  • ROUTING is OFF by default — choose_render_target(3D) is None unless the kernel target
    is explicitly enabled, so production routing is unchanged (no blind prod flip).
  • When enabled: 3D genres -> "three-kernel"; 2D genres -> None (NOT kernel, NOT engine);
    dimension/view 3D markers also route.
  • ASSEMBLY emits a void-skirmish-3d-shaped dir (canonical kernel + scene templates +
    content.json) that PASSES the render gate as render_path "three-kernel" AND stays in
    the payload budget — i.e. the from-scratch-engine FAIL the render gate flags is cured.
  • With F: mounted, real Poly Haven materials + a prefiltered .hdr are staged into it.

Hermetic: assembly works with or without F: (tinted MeshStandard fallback when F: absent),
so this runs anywhere; the F:-staging assertions are guarded.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))          # engine dir (kernel_target.py)
sys.path.insert(0, str(HERE))                 # gates dir (render/payload gates)
import kernel_target as kt                     # noqa: E402
import render_quality_gate as rqg              # noqa: E402

n = 0
fails = []


def chk(label, ok):
    global n
    n += 1
    if not ok:
        fails.append(label)


def _hermetic_off():
    os.environ.pop("FFG_KERNEL_TARGET", None)
    os.environ["FFG_KERNEL_CONFIG"] = str(Path(tempfile.gettempdir()) / "ffg_no_such_kernel_cfg.json")


def _on():
    os.environ["FFG_KERNEL_TARGET"] = "1"


# ── routing: OFF by default (production unchanged) ────────────────────────────
_hermetic_off()
chk("default disabled", kt.kernel_enabled() is False)
chk("default: 3D genre defers (None)", kt.choose_render_target("tactics3d") is None)
chk("default: void-skirmish defers", kt.choose_render_target("void-skirmish") is None)

# ── routing: ON -> 3D to kernel, 2D stays out ────────────────────────────────
_on()
chk("enabled flag", kt.kernel_enabled() is True)
chk("on: tactics3d -> three-kernel", kt.choose_render_target("tactics3d") == "three-kernel")
chk("on: fps -> three-kernel", kt.choose_render_target("fps") == "three-kernel")
chk("on: platformer (2D) -> None", kt.choose_render_target("platformer") is None)
chk("on: shmup (2D) -> None", kt.choose_render_target("shmup") is None)
chk("on: empty genre -> None", kt.choose_render_target("") is None)
# dimension / view markers route a non-listed genre
chk("on: dimension=3d routes", kt.choose_render_target("puzzle", {"dimension": "3d"}) == "three-kernel")
chk("on: view.threeD routes", kt.choose_render_target("puzzle", {"view": {"threeD": True}}) == "three-kernel")
chk("on: plain puzzle (no 3D marker) -> None", kt.choose_render_target("puzzle", {}) is None)
chk("is_3d tactics3d", kt.is_3d("tactics3d") is True)
chk("is_3d platformer false", kt.is_3d("platformer") is False)

# ── assembly: renders through the kernel, passes the gates ───────────────────
with tempfile.TemporaryDirectory() as td:
    out = kt.assemble_kernel_game("test-kernel", {"genre": "tactics3d", "title": "Test Kernel", "theme": "urban"},
                                  out_root=Path(td) / "test-kernel")
    for f in ("ffg_kernel_3d.js", "ffg_scene.js", "ffg_scene_boot.js"):
        chk(f"template staged: {f}", (out / "runtime" / "3d" / f).exists())
    chk("index.html", (out / "index.html").exists())
    cj = json.loads((out / "content.json").read_text(encoding="utf-8"))
    chk("content render=three-kernel", cj.get("render") == "three-kernel")
    chk("content dimension=3d", cj.get("dimension") == "3d")

    ok_v, det = kt.verify_kernel_game(out)
    chk("verify_kernel_game PASS: " + det, ok_v)
    r = rqg.check_render_quality(out)
    chk(f"render_path three-kernel (got {r['render_path']})", r["render_path"] == "three-kernel")
    chk(f"render verdict pass (got {r['verdict']})", r["ok"])
    # this is exactly what the from-scratch-engine path FAILS — the keystone, cured
    chk("required AAA markers present", all(r["markers"].get(m) for m in rqg.REQUIRED_3D))

    # F:-mounted staging assertions (guarded — skip cleanly if the asset drive isn't present)
    sys.path.insert(0, str(kt.ART_DIR))
    try:
        import material_library as ml
        f_mounted = ml.root() is not None
    except Exception:
        f_mounted = False
    if f_mounted:
        chk("F:: ground material staged", bool(cj.get("materials", {}).get("ground", {}).get("maps")))
        chk("F:: normal in staged maps", "normal" in cj.get("materials", {}).get("ground", {}).get("maps", []))
        chk("F:: IBL env staged", bool(cj.get("env")) and (out / "assets" / "env" / "env.hdr").exists())
    else:
        print("  (note: F: not mounted — material/IBL staging assertions skipped; tinted fallback used)")

# determinism
chk("theme deterministic", kt._theme_for({"genre": "tactics3d", "title": "X"}) == kt._theme_for({"genre": "tactics3d", "title": "X"}))

_hermetic_off()   # leave env clean for sibling suites

if fails:
    print(f"KERNEL-TARGET: FAIL ({len(fails)} of {n} checks)")
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print(f"KERNEL-TARGET: PASS ({n} checks)")
sys.exit(0)
