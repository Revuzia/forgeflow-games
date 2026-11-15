#!/usr/bin/env python3
"""render_quality_gate.py — DETERMINISTIC, headless, no-claude-p AAA render gate.

Why static-source (not a pixel grab): the only existing look-check is the vision
gate (fidelity_gate.py) which needs claude -p and is skipped in interactive/no-key
runs; and post-FX (bloom/tonemap) BLACKS OUT under headless SwiftShader (capture.py
documents this) so a pixel grade is unreliable in CI. This gate instead reads the
game's BUNDLED render source and asserts the AAA-render markers are present — which
is exactly what separates the project's two 3D paths:

  • AAA path  — the Three.js kernel (runtime/3d/ffg_kernel_3d.js): AgX/ACES tone
    mapping + sRGB, shadowMap.enabled, key/fill lights, EffectComposer + UnrealBloom
    (+ SSAO/SMAA). Powers void-skirmish-3d / warboard-chess / iron-tide.
  • WEAK path — the from-scratch engine (src/engine.js): Blinn-Phong, NO tonemap,
    NO post-FX, GLB loader discards textures. Powers games/_engine/* .

A 3D game that renders through the weak path (or otherwise lacks the markers) FAILS.
2D (Phaser) games are out of scope here (the 2D-art gate covers them) and return
verdict "skip-2d".

Usage:
    from render_quality_gate import check_render_quality
    res = check_render_quality(game_dir)          # -> dict with .ok
CLI:
    python render_quality_gate.py <game_dir> [--budget-warn]
    exit 0 = pass (or skip-2d), 1 = fail
"""
import json
import re
import sys
from pathlib import Path

GATES_DIR = Path(__file__).resolve().parent
CONTRACT = GATES_DIR / "genre_render_contract.json"

# ── marker regexes (validated against games/void-skirmish-3d/runtime/3d/*) ──────
MARKERS = {
    "toneMapping":  re.compile(r"toneMapping\s*=\s*[^;\n]*?(AgX|ACESFilmic|Cineon|Reinhard|Custom)ToneMapping"),
    "shadows":      re.compile(r"shadowMap\.enabled\s*=\s*true|castShadow\s*=\s*true"),
    "lights":       re.compile(r"\b(Directional|Hemisphere|Point|Spot|Rect(?:Area)?)Light\b"),
    "postfx":       re.compile(r"EffectComposer|UnrealBloomPass|\bBloomPass\b|SSAOPass|GTAOPass|SMAAPass"),
    # advisory (Phase 2 promotes pbr+textured to REQUIRED once the F: material lib lands)
    "pbr":          re.compile(r"MeshStandardMaterial|MeshPhysicalMaterial|isMeshStandardMaterial"),
    "srgb":         re.compile(r"SRGBColorSpace"),
    "textured":     re.compile(r"\.(map|normalMap|roughnessMap|aoMap|metalnessMap|envMap)\s*=|TextureLoader|RGBELoader|PMREMGenerator|scene\.environment"),
}
REQUIRED_3D = ["toneMapping", "shadows", "lights", "postfx"]   # the kernel-level AAA floor
ADVISORY_3D = ["pbr", "srgb", "textured"]


def _read(p: Path, cap: int = 1_500_000) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")[:cap]
    except Exception:
        return ""


def _classify(game_dir: Path):
    """Return (dimension, render_path) from index.html + dir layout.
      dimension: '3d' | '2d' | 'unknown'
      render_path: 'three-kernel' | 'three-hand' | 'from-scratch-engine' | 'phaser' | 'unknown'
    """
    idx = _read(game_dir / "index.html")
    low = idx.lower()
    has_three_dir = (game_dir / "runtime" / "3d").exists() or "runtime/3d" in idx or "ffg_kernel_3d" in idx or "__ffg3d__" in low
    if has_three_dir:
        return "3d", "three-kernel"
    if "./src/engine.js" in idx or (game_dir / "src" / "engine.js").exists():
        return "3d", "from-scratch-engine"
    # hand-built three importmap with an inline module (e.g. wobblesworth) = 3D
    if '"three"' in idx and "importmap" in low:
        return "3d", "three-hand"
    if "phaser" in low:
        return "2d", "phaser"
    # any other canvas game (2D breakout / arcade) — out of scope for the 3D render gate
    if "<canvas" in low or "getcontext" in low or "canvas" in low:
        return "2d", "canvas-2d"
    return "unknown", "unknown"


def _gather_render_src(game_dir: Path, render_path: str) -> str:
    """Concatenate only the RENDER-relevant JS (avoids reading multi-MB 2D game.js)."""
    parts = [_read(game_dir / "index.html")]
    if render_path in ("three-kernel", "three-hand"):
        d = game_dir / "runtime" / "3d"
        if d.exists():
            for js in sorted(d.rglob("*.js")):
                parts.append(_read(js))
    elif render_path == "from-scratch-engine":
        d = game_dir / "src"
        if d.exists():
            for js in sorted(d.glob("*.js")):
                parts.append(_read(js))
    return "\n".join(parts)


def check_render_quality(game_dir) -> dict:
    game_dir = Path(game_dir)
    if not (game_dir / "index.html").exists():
        return {"ok": False, "verdict": "fail", "reason": "no index.html", "slug": game_dir.name}
    dimension, render_path = _classify(game_dir)
    res = {"slug": game_dir.name, "dimension": dimension, "render_path": render_path,
           "markers": {}, "missing": [], "warnings": []}

    if dimension == "2d":
        res.update({"ok": True, "verdict": "skip-2d", "reason": "2D game — covered by the 2D-art gate"})
        return res
    if dimension == "unknown":
        res.update({"ok": False, "verdict": "fail", "reason": "could not classify render path"})
        return res

    src = _gather_render_src(game_dir, render_path)
    for name, rx in MARKERS.items():
        res["markers"][name] = bool(rx.search(src))

    # the weak from-scratch 3D path is a hard fail by routing alone (it lacks PBR+post by design)
    if render_path == "from-scratch-engine":
        res["missing"] = [m for m in REQUIRED_3D if not res["markers"].get(m)]
        res.update({"ok": False, "verdict": "fail",
                    "reason": "3D game on the WEAK from-scratch renderer (Blinn-Phong, no tonemap/post-FX, GLB textures discarded) — route to the Three.js kernel"})
        return res

    res["missing"] = [m for m in REQUIRED_3D if not res["markers"].get(m)]
    for m in ADVISORY_3D:
        if not res["markers"].get(m):
            res["warnings"].append(f"advisory: missing {m} (Phase 2 makes pbr+textured required)")
    ok = not res["missing"]
    res.update({"ok": ok, "verdict": "pass" if ok else "fail",
                "reason": "AAA render markers present" if ok else ("missing required: " + ", ".join(res["missing"]))})
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: render_quality_gate.py <game_dir>")
        return 2
    res = check_render_quality(args[0])
    try:
        (Path(args[0]) / "render_quality.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    except Exception:
        pass
    print(f"render_quality[{res['slug']}]: {res['verdict']} ({res.get('render_path')}) — {res.get('reason')}")
    for w in res.get("warnings", []):
        print("   " + w)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
