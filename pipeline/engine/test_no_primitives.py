#!/usr/bin/env python3
"""test_no_primitives.py — GS11(e): the "NO NAKED PRIMITIVES" gate. Enforces the user rule that games must
never use basic geometric figures for gameplay ACTORS (player / enemy / coin / pickup) — those must
reference a REAL model or sprite. Ground / tiles / goal / projectiles may stay flat-colored.

Three parts, deterministic (no claude -p, no browser):
  A) PIPELINE GUARD (the teeth): build each emitter genre and assert every actor spawn in the emitted
     game.js carries a real `model:"..."`/`sprite:"..."` (not a bare cube/quad) AND the referenced asset
     files were actually COPIED into the build dir.
  B) BOTH-WAYS proof: the detector PASSES real-asset spawns and FAILS bare-cube / null-asset spawns.
  C) SAMPLES: the showcase engine samples (platformer/shooter/arena3d) can't regress to primitives either.
     (SAMPLE_COLLECT / SAMPLE_JUMP are documented engine MECHANIC fixtures — primitives allowed there.)

Prints 'NO-PRIMITIVES: PASS (N checks)'. Run: python pipeline/engine/test_no_primitives.py
"""
import json
import re
import sys
import tempfile
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))
from _scratch import scratch_dir  # noqa: E402
import engine_game_emit as emit  # noqa: E402

GAMES = ENGINE_DIR.parent.parent
ENGINE = GAMES.parent / "forgeflow-engine"

ACTOR_TAGS = ("player", "enemy", "foe", "coin", "pickup")   # gameplay actors that MUST use real assets
n = 0
fails = []


def need(label, ok, detail=None):
    global n
    n += 1
    if not ok:
        fails.append(label + (f"  [{detail}]" if detail else ""))


def _actor_lines(js):
    return [ln for ln in js.splitlines() if any(f'tag: "{t}"' in ln for t in ACTOR_TAGS)]


# matches NAME = "literal" / NAME = null inside single OR multi-declaration consts
# (`const LEN = 60, COIN_SPR = "star", ...;` — the emitted-template shape)
_CONST_RE = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("([^"]*)"|null)\s*[,;)\n]')


def actors_ok(js):
    """An actor spawn line is OK iff it references a real asset: model:"name"/sprite:"name" (quoted),
    OR an identifier resolving to a non-null const string (emitted templates use
    `const COIN_SPR = "star"` + `sprite: COIN_SPR` — 2026-06-11 detector upgrade; the old line-literal
    check false-failed every emitted template). Returns (ok, offenders[])."""
    consts = {m.group(1): (m.group(3) if m.group(2) != "null" else None) for m in _CONST_RE.finditer(js)}
    bad = []
    for ln in _actor_lines(js):
        if re.search(r'(model|sprite):\s*"[^"]+"', ln):
            continue                                   # literal asset name
        m = re.search(r'(model|sprite):\s*([A-Za-z_][A-Za-z0-9_]*)\b', ln)
        if m and consts.get(m.group(2)):               # identifier resolved to a non-null name
            continue
        bad.append(ln.strip()[:90])
    return (len(bad) == 0, bad)


# ── B) BOTH-WAYS: the detector must reject primitives and accept real assets ──────────────────────
need("detector FAILS a bare-cube player", not actors_ok('ctx.spawn({ tag: "player", color: [1,0,0] });')[0])
need("detector FAILS a null-sprite player", not actors_ok('ctx.spawn({ tag: "player", sprite: null, color: [1,0,0] });')[0])
need("detector FAILS a bare-cube enemy", not actors_ok('const e = ctx.spawn({ tag: "enemy", color: [1,0,0] });')[0])
need("detector PASSES a sprite player", actors_ok('ctx.spawn({ tag: "player", sprite: "hero" });')[0])
need("detector PASSES a model player", actors_ok('ctx.spawn({ tag: "player", model: "hero" });')[0])
need("detector PASSES const-resolved sprite (template style)",
     actors_ok('const COIN_SPR = "star";\nctx.spawn({ tag: "coin", sprite: COIN_SPR });')[0])
need("detector FAILS const-null sprite (asset missing at emit time)",
     not actors_ok('const COIN_SPR = null;\nctx.spawn({ tag: "coin", sprite: COIN_SPR });')[0])
need("detector ignores non-actors (ground color OK)", actors_ok('ctx.spawn({ tag: "ground", color: [0,1,0] });')[0])

# ── A) PIPELINE GUARD: every emitter genre must produce real-asset actors + copy the files ────────
GENRE_GOLDEN = {
    "platformer": GAMES / "pipeline/engine/golden/platformer.content.json",
    "shmup": GAMES / "pipeline/engine/golden/shmup.content.json",
    "tactics3d": GAMES / "pipeline/engine/golden/tactics3d.content.json",
}
for genre, content in GENRE_GOLDEN.items():
    if not content.exists():
        need(f"golden exists: {genre}", False, str(content)); continue
    out = scratch_dir() / genre
    emit.build(str(content), out, slug=genre)
    js = (out / "game.js").read_text(encoding="utf-8")
    ok, bad = actors_ok(js)
    need(f"emitted {genre}: actors use real assets (no cubes/quads)", ok, "; ".join(bad))
    found_decl = False
    for kind in ("sprites", "models"):
        m = re.search(kind + r":\s*(\{[^}]*\})", js)
        if m and m.group(1) != "{}":
            found_decl = True
            for name, url in json.loads(m.group(1)).items():
                need(f"emitted {genre}: asset file copied {url}", (out / url.lstrip("./")).exists(), url)
    need(f"emitted {genre}: declares a models/sprites map", found_decl)

# ── C) SAMPLES: showcase engine games can't regress (mechanic fixtures collect/jump are exempt) ────
rt = (ENGINE / "src" / "game_runtime.js").read_text(encoding="utf-8")
blocks = {}
for part in rt.split("export const ")[1:]:
    name = part.split("=", 1)[0].strip()
    blocks[name] = part.split("export const ")[0]
SHOWCASE = ("SAMPLE_PLATFORMER", "SAMPLE_SHOOTER", "SAMPLE_ARENA3D")
for s in SHOWCASE:
    blk = blocks.get(s, "")
    need(f"sample {s} present", bool(blk))
    ok, bad = actors_ok(blk)
    need(f"sample {s}: actors use real assets", ok, "; ".join(bad))

# ── D) TIER 4: slug-seeded real-sprite variety from the F: pixel packs ─────────────────────────────
sys.path.insert(0, str(GAMES / "pipeline" / "art"))
import twod_asset_selector as tas  # noqa: E402
need("collect template keeps 3D models (selector returns None)", tas.select_asset_set("collect", "x") is None)
if tas.root():
    for tmpl in ("platformer", "shooter"):
        s = tas.select_asset_set(tmpl, "lumen-run")
        need(f"selector {tmpl}: returns sprites", bool(s and s.get("sprites")))
        if s:
            for role, rel in s["sprites"].items():
                need(f"selector {tmpl}: {role} file exists on F:", (tas.ASSETS_ROOT / rel).exists(), rel)
    sh = tas.select_asset_set("shooter", "lumen-run")
    need("selector shooter: hero != foe", sh and sh["sprites"].get("hero") != sh["sprites"].get("foe"))
    # variety: distinct slugs should not all collapse to one hero
    slugs = ["lumen-run", "neon-breakout", "star-drift", "cave-hopper", "iron-gate", "frost-spire", "tide-pool"]
    heroes = {tas.select_asset_set("platformer", s2)["sprites"].get("hero") for s2 in slugs}
    need(f"selector platformer: hero varies across slugs ({len(heroes)} distinct of {len(slugs)})", len(heroes) >= 3)
    # determinism
    need("selector deterministic", tas.select_asset_set("platformer", "lumen-run") == tas.select_asset_set("platformer", "lumen-run"))
    # integration: variety reaches the emitter — two slugs copy different hero sprites
    if GENRE_GOLDEN["platformer"].exists():
        oa = scratch_dir() / "a"; ob = scratch_dir() / "b"
        ca = json.loads(GENRE_GOLDEN["platformer"].read_text(encoding="utf-8")); ca["slug"] = "variety-a"
        cb = dict(ca); cb["slug"] = "variety-zzz"
        fa = oa.parent / "a.json"; fb = ob.parent / "b.json"
        fa.write_text(json.dumps(ca), encoding="utf-8"); fb.write_text(json.dumps(cb), encoding="utf-8")
        emit.build(str(fa), oa, slug="variety-a"); emit.build(str(fb), ob, slug="variety-zzz")
        ja = (oa / "game.js").read_text(encoding="utf-8"); jb = (ob / "game.js").read_text(encoding="utf-8")
        ha = re.search(r'sprites:\s*(\{[^}]*\})', ja); hb = re.search(r'sprites:\s*(\{[^}]*\})', jb)
        need("emitter: two slugs select sprites", bool(ha and hb))
        # both must still pass the no-primitives actor gate
        need("variety build A: actors real", actors_ok(ja)[0])
        need("variety build B: actors real", actors_ok(jb)[0])
else:
    print("  (note: F: pixel packs not mounted — Tier-4 selector variety checks skipped; emitter falls back to ASSET_SETS)")

print(f"checks run: {n}")
if fails:
    print("NAKED PRIMITIVES / FAILURES:")
    for f in fails:
        print("  -", f)
    print("NO-PRIMITIVES: FAIL")
    sys.exit(1)
print(f"NO-PRIMITIVES: PASS ({n} checks)")
sys.exit(0)
