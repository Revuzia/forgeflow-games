#!/usr/bin/env python3
"""kernel_target.py — ADDITIVE, FLAG-GATED routing of 3D genres to the AAA Three.js
kernel (the keystone fix), plus the deterministic assembly that wires F: PBR + IBL
into ffg_kernel_3d.js.

THE PROBLEM (see pipeline/engine/AAA_HANDOFF.md): with authoring on, build_target
sends EVERY genre — including 3D — to the from-scratch ForgeFlow engine (Blinn-Phong,
no PBR/tonemap/post-FX, GLB textures discarded). The project's AAA Three kernel renders
MeshStandard PBR + IBL + bloom but the generator never targets it.

THIS MODULE adds a THIRD render target. choose_render_target() returns "three-kernel"
ONLY for 3D genres AND only when the kernel target is explicitly enabled
(FFG_KERNEL_TARGET=1 / kernel_target.json {"enabled": true}). DEFAULT OFF -> returns
None -> the nightly's existing routing is byte-for-byte unchanged (NO blind prod flip;
naively disabling the from-scratch engine would send 3D to Phaser — we don't).

assemble_kernel_game() builds a void-skirmish-3d-shaped dir: the canonical kernel +
generic scene templates (runtime/3d/) + a content.json material/IBL manifest + staged
Poly Haven materials & a prefiltered .hdr (Tier-2 libs). The result PASSES the
deterministic render + payload gates. Gameplay is layered by the claude -p kernel
author step (ffg_scene.js buildGameplay) — recorded as the owner-validation command in
AAA_HANDOFF.md. Pure pipeline code; no claude -p here; unit-tested in
gates/test_kernel_target.py.
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent            # forgeflow-games/pipeline/engine
GAMES = ENGINE_DIR.parent.parent                        # forgeflow-games/
TEMPLATE_3D = ENGINE_DIR / "runtime" / "3d"             # canonical kernel + scene templates
ART_DIR = ENGINE_DIR.parent / "art"                     # pipeline/art (Tier-2 staging libs)

# the 3D genres that should render through the Three kernel (a 3D subset of ENGINE_GENRES
# plus first-person / racing 3D). 2D genres are never kernel-routed.
KERNEL_GENRES = {
    "tactics3d", "3d-tactics", "void-skirmish", "fps", "tps", "shooter3d",
    "3d-shooter", "exploration3d", "arena3d", "racing3d", "3d",
}

# game theme -> (ground surface, scenery surface) for material_library.pick
THEME_SURFACES = {
    "ruins": ("concrete", "brick"), "urban": ("concrete", "metal"),
    "forest": ("grass", "wood"), "desert": ("sand", "rock"),
    "indoor": ("wood", "brick"), "snow": ("ground", "rock"),
    "scifi": ("metal", "concrete"), "default": ("ground", "rock"),
}

TEMPLATE_FILES = ("ffg_kernel_3d.js", "ffg_scene.js", "ffg_scene_boot.js")
MATERIAL_BUDGET = int(1.6 * 1024 * 1024)                # per staged material set


# ── routing ───────────────────────────────────────────────────────────────────
def _config():
    try:
        p = Path(os.environ.get("FFG_KERNEL_CONFIG") or (ENGINE_DIR / "kernel_target.json"))
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def kernel_enabled():
    """OFF by default. On via env FFG_KERNEL_TARGET=1 OR kernel_target.json {enabled:true}."""
    if os.environ.get("FFG_KERNEL_TARGET", "").strip().lower() in ("1", "true", "yes", "on"):
        return True
    return bool(_config().get("enabled"))


def is_3d(genre, content=None):
    g = (genre or "").strip().lower()
    if g in KERNEL_GENRES:
        return True
    c = content or {}
    if str(c.get("dimension", "")).lower() == "3d":
        return True
    if (c.get("view") or {}).get("threeD") or (c.get("view") or {}).get("3d"):
        return True
    return False


def _allowed_genres():
    cfg = _config().get("genres")
    if cfg:
        return {str(g).strip().lower() for g in cfg} & KERNEL_GENRES
    return set(KERNEL_GENRES)


def choose_render_target(genre, content=None):
    """Return "three-kernel" if this 3D genre should render on the AAA kernel, else None.
    None when the kernel target is disabled (default) -> caller keeps its existing routing,
    so production is unchanged until the owner flips kernel_target.json {enabled:true}."""
    if not kernel_enabled():
        return None
    g = (genre or "").strip().lower()
    if is_3d(g, content) and (g in _allowed_genres() or g not in KERNEL_GENRES):
        return "three-kernel"
    return None


# ── assembly ────────────────────────────────────────────────────────────────────
def _seed(slug):
    return int(hashlib.sha1((slug or "x").encode("utf-8")).hexdigest()[:8], 16)


def _theme_for(content):
    t = (content.get("theme") or "").strip().lower()
    if t in THEME_SURFACES:
        return t
    g = (content.get("genre") or "").lower()
    blob = (str(content.get("title", "")) + " " + str(content.get("brief", ""))).lower()
    for key in ("forest", "desert", "snow", "indoor", "scifi", "ruins", "urban"):
        if key in blob:
            return key
    if "tactics" in g or "skirmish" in g:
        return "urban"
    return "default"


def _stage_material(theme, surface, seed, out_dir):
    """Stage one Poly Haven set -> out_dir; return a content.json manifest entry or None."""
    sys.path.insert(0, str(ART_DIR))
    import material_library as ml
    import texture_transcode as tt
    mat = ml.pick(theme, surface, seed)
    if not mat:
        return None
    res = tt.stage_material_to_budget(mat, out_dir, MATERIAL_BUDGET)
    rel = out_dir.relative_to(out_dir.parents[2])  # out/assets/materials/<key> -> assets/materials/<key>
    return {"dir": str(rel).replace("\\", "/"), "maps": sorted(res["files"].keys()),
            "source": res.get("name"), "bytes": res.get("bytes")}


def _stage_env(theme, seed, out_path):
    sys.path.insert(0, str(ART_DIR))
    import hdri_library as hl
    hd = hl.pick(theme, seed)
    if not hd:
        return None
    n = hl.stage(hd, out_path, target_h=256)
    return {"file": "assets/env/env.hdr", "bytes": n, "source": hd["name"]}


def assemble_kernel_game(slug, content, out_root=None):
    """Build a Three-kernel 3D game dir (renderer + F: PBR/IBL + content.json). Returns
    the out Path. Stages F: assets when mounted; without F: it still emits a valid kernel
    scene (tinted MeshStandard fallback) so the structure/render gate holds anywhere."""
    out = Path(out_root) if out_root else (GAMES / "games" / "_kernel" / slug)
    (out / "runtime" / "3d").mkdir(parents=True, exist_ok=True)
    for f in TEMPLATE_FILES:
        shutil.copy2(TEMPLATE_3D / f, out / "runtime" / "3d" / f)

    theme = _theme_for(content)
    seed = _seed(slug)
    ground_surf, wall_surf = THEME_SURFACES.get(theme, THEME_SURFACES["default"])
    materials, env = {}, None
    try:
        mdir = out / "assets" / "materials"
        g = _stage_material(theme, ground_surf, seed, mdir / "ground")
        w = _stage_material(theme, wall_surf, seed + 1, mdir / "wall")
        if g:
            g["repeat"] = [16, 16]; materials["ground"] = g
        if w:
            w["repeat"] = [2, 2]; materials["wall"] = w
        (out / "assets" / "env").mkdir(parents=True, exist_ok=True)
        env = _stage_env(theme, seed, out / "assets" / "env" / "env.hdr")
    except Exception as e:                       # F: absent / staging error -> tinted fallback
        print(f"[kernel_target] asset staging skipped: {type(e).__name__}: {e}")

    cj = dict(content or {})
    cj.update({
        "slug": slug, "dimension": "3d", "render": "three-kernel", "theme": theme,
        "view": {**(content.get("view") or {}),
                 "background": (content.get("view") or {}).get("background", "#0e131b"),
                 "fog": (content.get("view") or {}).get("fog", 0.01)},
        "materials": materials,
    })
    if env:
        cj["env"] = env["file"]; cj["envIntensity"] = 1.0
        cj["_staged_env"] = env
    (out / "content.json").write_text(json.dumps(cj, indent=1), encoding="utf-8")
    (out / "index.html").write_text(_index_html(slug, content.get("title") or slug), encoding="utf-8")
    return out


def _index_html(slug, title):
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">\n'
        f'<title>{title}</title>\n'
        '<script type="importmap">\n'
        '{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js",'
        ' "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/" } }\n'
        '</script>\n'
        '<style>html,body{margin:0;height:100%;background:#0e131b;overflow:hidden}'
        '#game-container{position:absolute;inset:0}</style>\n'
        '</head><body>\n'
        '<div id="game-container"></div>\n'
        '<script>window.GAME_CONFIG=window.GAME_CONFIG||{hide_bug_button:true};</script>\n'
        '<script type="module" src="runtime/3d/ffg_scene_boot.js?v=1"></script>\n'
        '</body></html>\n'
    )


# ── structural + render/payload verify ───────────────────────────────────────────
def verify_kernel_game(gdir):
    """Deterministic accept gate for an assembled kernel game (no claude -p / browser):
    structure present + the render gate sees the three-kernel AAA markers + payload in
    budget. Returns (ok, detail)."""
    gdir = Path(gdir)
    checks = [
        ("index.html", (gdir / "index.html").exists()),
        ("content.json", (gdir / "content.json").exists()),
        ("kernel staged", (gdir / "runtime" / "3d" / "ffg_kernel_3d.js").exists()),
        ("scene staged", (gdir / "runtime" / "3d" / "ffg_scene.js").exists()),
        ("boot staged", (gdir / "runtime" / "3d" / "ffg_scene_boot.js").exists()),
    ]
    missing = [n for n, ok in checks if not ok]
    if missing:
        return False, "missing: " + ", ".join(missing)
    sys.path.insert(0, str(ENGINE_DIR / "gates"))
    import render_quality_gate as rqg
    import payload_gate as pg
    r = rqg.check_render_quality(gdir)
    if not (r["ok"] and r["render_path"] == "three-kernel"):
        return False, f"render gate: {r['verdict']} ({r['render_path']}) — {r.get('reason')}"
    p = pg.check_payload(gdir)
    if not p["ok"]:
        return False, f"payload gate: {p['reason']}"
    return True, f"render pass (three-kernel) + payload {p['mb']}MB"


if __name__ == "__main__":
    import tempfile
    g = sys.argv[1] if len(sys.argv) > 1 else "tactics3d"
    with tempfile.TemporaryDirectory() as td:
        out = assemble_kernel_game("demo-kernel", {"genre": g, "title": "Demo Kernel", "theme": "urban"},
                                   out_root=Path(td) / "demo-kernel")
        ok, det = verify_kernel_game(out)
        print(f"choose_render_target({g}, enabled={kernel_enabled()}) -> {choose_render_target(g)}")
        print(f"assembled {out.name}: verify -> {'PASS' if ok else 'FAIL'} — {det}")
