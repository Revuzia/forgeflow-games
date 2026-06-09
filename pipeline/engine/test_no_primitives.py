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


def actors_ok(js):
    """An actor spawn line is OK iff it references a real asset: model:"name" or sprite:"name" (quoted,
    non-null). Returns (ok, offenders[])."""
    bad = []
    for ln in _actor_lines(js):
        if not re.search(r'(model|sprite):\s*"[^"]+"', ln):
            bad.append(ln.strip()[:90])
    return (len(bad) == 0, bad)


# ── B) BOTH-WAYS: the detector must reject primitives and accept real assets ──────────────────────
need("detector FAILS a bare-cube player", not actors_ok('ctx.spawn({ tag: "player", color: [1,0,0] });')[0])
need("detector FAILS a null-sprite player", not actors_ok('ctx.spawn({ tag: "player", sprite: null, color: [1,0,0] });')[0])
need("detector FAILS a bare-cube enemy", not actors_ok('const e = ctx.spawn({ tag: "enemy", color: [1,0,0] });')[0])
need("detector PASSES a sprite player", actors_ok('ctx.spawn({ tag: "player", sprite: "hero" });')[0])
need("detector PASSES a model player", actors_ok('ctx.spawn({ tag: "player", model: "hero" });')[0])
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
    out = Path(tempfile.mkdtemp()) / genre
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

print(f"checks run: {n}")
if fails:
    print("NAKED PRIMITIVES / FAILURES:")
    for f in fails:
        print("  -", f)
    print("NO-PRIMITIVES: FAIL")
    sys.exit(1)
print(f"NO-PRIMITIVES: PASS ({n} checks)")
sys.exit(0)
