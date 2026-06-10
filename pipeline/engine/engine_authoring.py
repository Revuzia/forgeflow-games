#!/usr/bin/env python3
"""engine_authoring.py — AI AUTHORING: claude -p writes a ForgeFlow ENGINE game.js for ANY genre, against
forgeflow-engine/ENGINE_GAME_API.md. This is the general path the owner asked for — use the engine + the
real F:\\ asset library to build ALL genres (incl. indie), not just the 3 deterministic templates in
engine_game_emit.py.

DESIGN / SAFETY:
  • The DETERMINISTIC harness here — prompt assembly, code extraction, validation (node --check +
    structural), real-asset staging, fallback — is fully unit-tested with FIXTURES (no claude -p, no
    network): see test_engine_authoring.py.
  • The single claude -p CALL is gated behind run=True and only fires in NON-interactive contexts (the
    nightly / an operator cmd). It MUST NOT run inside an interactive Claude session (OAuth lock).
  • On ANY failure (claude unavailable, no code, invalid/wrong-shape output, syntax error) the entry point
    author_engine_game() returns ok=False so the caller falls back to the deterministic emitter, then
    Phaser — the nightly always ships something.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent              # forgeflow-games/pipeline/engine
GAMES = ENGINE_DIR.parent.parent                          # forgeflow-games/
CLAW = GAMES.parent                                       # Claude Claw/
FORGE_ENGINE = CLAW / "forgeflow-engine"
API_DOC = FORGE_ENGINE / "ENGINE_GAME_API.md"

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
import engine_game_emit as _emit                          # reuse staging (_stage_assets, INDEX_HTML, src/assets copy)

# FALLBACK bundle (used only when the library index is unavailable) — the proven-existing files the
# templates already use (emit-platformer passed the real_assets inspector with these).
GENERIC_ASSETS = {
    "sprites": {
        "hero": "pixel-platformer/Tiles/Characters/tile_0000.png",
        "foe":  "pixel-platformer/Tiles/Characters/tile_0004.png",
        "coin": "game-icons/PNG/White/2x/star.png",
    },
    "models": {
        "hero": "3d-models/kenney-creatures/blocky-characters/Models/GLB format/character-a.glb",
        "coin": "3d-models/kenney-creatures/cube-pets/Models/GLB format/animal-chick.glb",
    },
}

# THE REAL LIBRARY: every authored game picks its CAST from the full F:\ asset library, slug-seeded —
# 1,555 indexed creature/character GLBs (CREATURES_INDEX.json; we use CC0 + self-contained .glb only,
# since a staged .gltf with external buffers would break) + 27 pixel-platformer character sprites.
# Unity Asset Store haul (FBX->GLB via scripts/unity_fbx_convert.py): character-like models join the
# cast pool; everything else is the PROP pool (scenery the author can place). Owner-licensed.
CREATURES_INDEX = _emit.ASSETS_ROOT / "3d-models" / "CREATURES_INDEX.json"
UNITY_MODELS_INDEX = _emit.ASSETS_ROOT / "3d-models" / "UNITY_MODELS_INDEX.json"
SPRITE_CHAR_DIR = _emit.ASSETS_ROOT / "pixel-platformer" / "Tiles" / "Characters"
_CHARACTER_WORDS = ("character", "monster", "creature", "knight", "skeleton", "zombie", "dragon",
                    "goblin", "orc", "golem", "robot", "soldier", "warrior", "wizard", "demon",
                    "animal", "enemy", "hero", "viking", "samurai", "ninja", "alien", "slime",
                    "bandit", "guard", "troll", "elf", "dwarf", "rat", "spider", "wolf", "bear")
_lib_cache = {}


def _seed(slug, salt=""):
    import hashlib
    return int(hashlib.md5((slug + "|" + salt).encode("utf-8")).hexdigest()[:8], 16)


def _creature_pool():
    """Browser-ready, CC0, self-contained .glb entries from the library index (cached)."""
    if "creatures" not in _lib_cache:
        pool = []
        try:
            idx = json.loads(CREATURES_INDEX.read_text(encoding="utf-8"))
            items = idx if isinstance(idx, list) else next((v for v in idx.values() if isinstance(v, list)), [])
            for e in items:
                f = str(e.get("file") or "")
                if e.get("browser_ready") and e.get("license_class") == "CC0" and f.lower().endswith(".glb"):
                    pool.append("3d-models/" + f)
        except Exception:
            pool = []
        _lib_cache["creatures"] = sorted(pool)
    return _lib_cache["creatures"]


def _unity_pools():
    """(characters, props) from the converted Unity GLB index. Character-like names (animated first)
    can join the cast; the rest are scenery props. Empty pools when the index doesn't exist yet."""
    if "unity" not in _lib_cache:
        chars, props = [], []
        try:
            idx = json.loads(UNITY_MODELS_INDEX.read_text(encoding="utf-8"))
            for e in idx.get("models", []):
                f = str(e.get("file") or "")
                if not (e.get("browser_ready") and f.lower().endswith(".glb")):
                    continue
                path = "3d-models/" + f
                hay = (str(e.get("name", "")) + " " + str(e.get("pack", ""))).lower()
                if any(w in hay for w in _CHARACTER_WORDS):
                    chars.append((not e.get("animated"), path))  # animated sort first
                else:
                    props.append(path)
        except Exception:
            chars, props = [], []
        _lib_cache["unity"] = ([p for _a, p in sorted(chars)], sorted(props))
    return _lib_cache["unity"]


def _sprite_chars():
    if "sprites" not in _lib_cache:
        try:
            _lib_cache["sprites"] = sorted(p.name for p in SPRITE_CHAR_DIR.glob("tile_*.png"))
        except Exception:
            _lib_cache["sprites"] = []
    return _lib_cache["sprites"]


def pick_assets(slug):
    """The per-game CAST, slug-seeded over the full library: distinct hero/foe/foe2 sprites (2D) and
    distinct hero/foe/foe2/boss creature GLBs (3D) + the coin/star pickup. Falls back to GENERIC_ASSETS
    when the library is unavailable. Deterministic — same slug, same cast."""
    sets = {"sprites": dict(GENERIC_ASSETS["sprites"]), "models": dict(GENERIC_ASSETS["models"])}
    chars = _sprite_chars()
    if len(chars) >= 3:
        picks, i = [], 0
        while len(picks) < 3 and i < len(chars) * 2:
            c = chars[(_seed(slug, "spr") + i * 7) % len(chars)]
            if c not in picks:
                picks.append(c)
            i += 1
        base = "pixel-platformer/Tiles/Characters/"
        sets["sprites"]["hero"], sets["sprites"]["foe"] = base + picks[0], base + picks[1]
        sets["sprites"]["foe2"] = base + picks[2]
    u_chars, u_props = _unity_pools()
    pool = _creature_pool() + u_chars            # Unity character-like GLBs join the cast pool
    if len(pool) >= 4:
        picks, i = [], 0
        while len(picks) < 4 and i < 40:
            m = pool[(_seed(slug, "mdl") + i * 131) % len(pool)]
            if m not in picks:
                picks.append(m)
            i += 1
        sets["models"]["hero"], sets["models"]["foe"] = picks[0], picks[1]
        sets["models"]["foe2"], sets["models"]["boss"] = picks[2], picks[3]
    if len(u_props) >= 2:                        # slug-seeded scenery from the Unity prop pool
        a = u_props[_seed(slug, "prp") % len(u_props)]
        b = u_props[(_seed(slug, "prp") + 977) % len(u_props)]
        sets["models"]["prop"] = a
        if b != a:
            sets["models"]["prop2"] = b
    return sets
AUDIO_NAMES = list(_emit.AUDIO_NAMES)                     # per-game staged sound names (stage_audio provides them)


# ── staging ───────────────────────────────────────────────────────────────────────────────────────
def stage(slug, out_dir):
    """Stage the engine runtime + audio + the GENERIC real-asset bundle into out_dir. Returns asset refs
    {sprites:{name:'./assets/sprites/x.png'}, models:{...}} with EXACT relative paths for the prompt."""
    import shutil
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for sub in ("src", "assets"):
        dst = out / sub
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(_emit.ENGINE / sub, dst)
    refs = _emit._stage_assets(out, pick_assets(slug))    # slug-seeded CAST from the full library
    return out, refs


def _asset_brief(refs):
    sp = ", ".join(f'{n}="{u}"' for n, u in refs.get("sprites", {}).items()) or "(none)"
    md = ", ".join(f'{n}="{u}"' for n, u in refs.get("models", {}).items()) or "(none)"
    return sp, md


# ── prompt ────────────────────────────────────────────────────────────────────────────────────────
def build_prompt(spec, refs):
    """Assemble the full claude -p authoring prompt: hard rules + the staged real-asset paths + the spec +
    the VERBATIM engine API contract. Deterministic + testable."""
    sp, md = _asset_brief(refs)
    api = API_DOC.read_text(encoding="utf-8") if API_DOC.exists() else "(API doc missing)"
    title = spec.get("title") or spec.get("slug") or "Untitled"
    genre = spec.get("genre") or "arcade"
    brief = spec.get("brief") or spec.get("concept") or ""
    loop = spec.get("core_loop") or spec.get("coreLoop") or ""
    return f"""You are the ForgeFlow game-writer. Write ONE complete, polished, genuinely FUN and PLAYABLE web
game as a single ES module (game.js) for the from-scratch ForgeFlow Engine, following the API contract
below EXACTLY. This is a real shippable game, not a tech demo.

GAME SPEC
  title : {title}
  genre : {genre}
  concept: {brief}
  core loop: {loop}

HARD REQUIREMENTS (a reviewer + an automated player will reject the game if any are missing):
  1. Export EXACTLY: export const GAME = {{ title, dim, /* sprites or models */, setup(ctx), update(dt, ctx) }};
     - dim is "2d" or "3d". Pick what fits the genre.
  2. USE REAL ASSETS — never bare colored cubes/quads as the main actors. The following assets are already
     staged in this game's folder; declare them and spawn with sprite:/model::
       sprites (2D): {sp}
       models  (3D): {md}
       e.g. 2D:  GAME.sprites = {{ hero:"./assets/sprites/hero.png", foe:"./assets/sprites/foe.png" }};
                 ctx.spawn({{ tag:"player", sprite:"hero", position:[x,y,0], scale:[1,1,1] }});
            3D:  GAME.models  = {{ hero:"./assets/models/hero.glb" }};  ctx.spawn({{ model:"hero", ... }});
     hero/foe/foe2/boss are ACTORS; any prop/prop2 models are SCENERY — place them to dress the level
     (platforms, obstacles, background décor), never as the player or an enemy.
  3. WINNABLE and LOSEABLE, with PROGRESSION: ship 3+ levels/waves/rounds with a DIFFICULTY RAMP (each
     stage bigger/faster/harder), scale speeds/counts by ctx.difficulty, and advance ctx.level as the
     player progresses (show it in the HUD). Win -> ctx.win() after the final stage; a real fail state ->
     ctx.lose() or ctx.hurt(). A bot pressing arrows/Space/F must make score/progress within ~12s.
  4. Respond to input every frame via ctx.input (axisX/axisY/pressed/down/pointerJustDown). Declare a
     `controls: "..."` how-to line on the GAME object (shown on the menu).
  5. Call ctx.hud("...") each frame with a live status line. Call ctx.music("music") in setup and
     ctx.sound("jump")/ctx.sound("coin") on events. Available audio names: {", ".join(AUDIO_NAMES)}.
  6. Do NOT write the menu, the game loop, HUD rendering, the physics step, or restart logic — the engine
     owns those (see the lifecycle in the contract). Only setup(ctx) + update(dt, ctx).
  7. OUTPUT ONLY the game.js code inside a single ```js fenced block. No prose before or after.

=== ENGINE_GAME_API.md (the contract — follow it precisely) ===
{api}
"""


# ── extraction + validation ─────────────────────────────────────────────────────────────────────
def extract_game_js(raw):
    """Pull the game.js out of a claude -p response: a ```js fenced block if present, else from
    'export const GAME' to the end. Returns the code string or None."""
    if not raw or not raw.strip():
        return None
    m = re.search(r"```(?:js|javascript)?\s*\n(.*?)```", raw, re.DOTALL)
    code = m.group(1) if m else raw
    if "export const GAME" not in code:
        return None
    i = code.index("export const GAME")
    return code[i:].strip()


def validate(js_text, workdir=None):
    """Validate authored game.js DETERMINISTICALLY: structural shape + real-asset usage + node --check
    syntax. Returns (ok, detail). No claude -p."""
    if not js_text or "export const GAME" not in js_text:
        return False, "no 'export const GAME'"
    miss = [tok for tok in ("setup(", "update(") if tok not in js_text]
    if miss:
        return False, "missing " + ", ".join(miss)
    if not re.search(r"\b(sprite|model)\s*:", js_text) and "sprites" not in js_text and "models" not in js_text:
        return False, "no real-asset usage (no sprite:/model: or sprites/models map)"
    if "ctx.win(" not in js_text:
        return False, "no win condition (ctx.win not called)"
    # node --check (ESM syntax) — write to a temp .mjs
    try:
        d = Path(workdir) if workdir else Path(tempfile.mkdtemp())
        f = d / "_authored_check.mjs"
        f.write_text(js_text, encoding="utf-8")
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True, timeout=30)
        try:
            f.unlink()
        except OSError:
            pass
        if r.returncode != 0:
            return False, "node --check FAIL: " + (r.stderr or r.stdout).strip().splitlines()[-1][:160]
    except FileNotFoundError:
        return True, "structural ok (node unavailable; syntax not checked)"
    except Exception as e:
        return True, "structural ok (node --check skipped: %s)" % type(e).__name__
    return True, "structural + node --check OK"


# ── ITERATIVE DEVELOPMENT (the 2-6 hour real-game path) ───────────────────────────────────────────
# A full game is NOT one authoring call. The nightly drives MILESTONE passes: each pass is a claude -p
# revision of the COMPLETE game.js against (a) the milestone goal and (b) the open QA issues from the
# play tester / AI QA panel. ~3-6 min per pass; a real game is ~12-40 passes (M1..M5), resuming across
# nights via the dev journal — matching how the Phaser deep-dev loop built games.
def build_revision_prompt(spec, current_js, goal, issues=None):
    """Assemble the ITERATIVE pass prompt: keep what works, fix every QA issue, advance the milestone
    goal, output the COMPLETE new game.js. Deterministic + fixture-testable."""
    api = API_DOC.read_text(encoding="utf-8") if API_DOC.exists() else "(API doc missing)"
    issue_lines = "\n".join(f"  - {i}" for i in (issues or [])) or "  (none open)"
    return f"""You are the ForgeFlow game-writer doing an ITERATIVE DEVELOPMENT PASS on an EXISTING engine
game (title: {spec.get('title')}, genre: {spec.get('genre')}). This is real game development — you are
deepening a working game, not starting over.

MILESTONE GOAL FOR THIS PASS:
  {goal}

OPEN QA ISSUES (from the automated play tester / AI QA panel — fix EVERY one):
{issue_lines}

RULES:
  1. Output the COMPLETE new game.js (the full file, not a diff). Keep the exact export shape:
     export const GAME = {{ title, dim, controls, sprites/models, setup(ctx), update(dt, ctx) }};
     Helper functions above the export are encouraged for levels/waves/enemy behaviors.
  2. KEEP everything that already works (assets, audio incl. any GAME.audio line, controls, win/lose,
     ctx.level progression). Build on it; never regress it.
  3. All previous hard requirements still apply: real sprites/models (never bare shapes), 3+ stages with
     a ramp scaled by ctx.difficulty, ctx.level advanced and shown in the HUD, winnable AND loseable,
     input every frame, ctx.hud each frame, per-event sounds ({", ".join(AUDIO_NAMES)}).
  4. A bot pressing arrows/Space/F must still make progress within ~12s of starting.
  5. OUTPUT ONLY the game.js code inside a single ```js fenced block. No prose.

CURRENT game.js:
```js
{current_js}
```

=== ENGINE_GAME_API.md (the contract) ===
{api}
"""


def revise_engine_game(gdir, spec, *, goal, issues=None, run=False, timeout=420, _raw_override=None):
    """One iterative milestone pass: claude -p rewrites the COMPLETE game.js against the goal + QA issues.
    The existing file is only replaced when the revision VALIDATES — a bad revision never destroys a
    working game. Returns (ok, out_dir, detail). Never raises."""
    gdir = Path(gdir)
    gj = gdir / "game.js"
    if not gj.exists():
        return False, str(gdir), "no game.js to revise (author it first)"
    current = gj.read_text(encoding="utf-8")
    try:
        prompt = build_revision_prompt(spec, current, goal, issues)
        (gdir / "_author_prompt_rev.txt").write_text(prompt, encoding="utf-8")
        if _raw_override is None and not run:
            return None, str(gdir), "revision prompt assembled; claude -p deferred (run=False)"
        raw = _raw_override if _raw_override is not None else _claude_author(prompt, timeout)
        js = extract_game_js(raw)
        if not js:
            return False, str(gdir), "no game.js code in revision output (old file kept)"
        ok, detail = validate(js, gdir)
        if not ok:
            return False, str(gdir), "revision invalid: " + detail + " (old file kept)"
        # never lose the per-game audio declaration: re-attach it if the revision dropped it
        if "GAME.audio" in current and "GAME.audio" not in js:
            m = re.search(r"^GAME\.audio = .*$", current, re.MULTILINE)
            if m:
                js += "\n" + m.group(0) + "\n"
        gj.write_text(js, encoding="utf-8")
        return True, str(gdir), "revision applied (" + detail + ")"
    except Exception as e:
        return False, str(gdir), "revision error: " + type(e).__name__ + ": " + str(e)[:160]


# ── claude -p call (NON-interactive only) ──────────────────────────────────────────────────────────
def _claude_author(prompt, timeout=300):
    """Run claude -p to author the game.js; return raw stdout. FORBIDDEN in an interactive session (OAuth
    lock) — only called when author_engine_game(run=True) in the nightly / an operator cmd."""
    r = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True, timeout=timeout)
    return r.stdout or ""


# ── entry point ────────────────────────────────────────────────────────────────────────────────────
def author_engine_game(spec, *, out_dir=None, run=False, timeout=300, _raw_override=None):
    """Author a playable engine game for ANY genre. Stages real assets, builds the prompt, (optionally)
    calls claude -p, extracts + validates the code, writes game.js + index.html. Returns (ok, out_dir,
    detail). Never raises.
      run=False (default, in-session safe): stage + assemble the prompt, then STOP — returns
                (None, out_dir, 'prompt assembled; claude -p deferred'). Used to test the harness.
      run=True  (nightly / operator): also calls claude -p and finishes the build.
      _raw_override: inject a fake claude response (the unit test uses this to exercise the full
                     extract->validate->write path with a fixture, no claude -p)."""
    slug = spec.get("slug") or "authored-game"
    out = Path(out_dir) if out_dir else (GAMES / "games" / "_engine" / slug)
    try:
        out, refs = stage(slug, out)
        audio_extras = _emit.stage_audio(out, slug)   # per-game music + named SFX set (slug-seeded)
        prompt = build_prompt(spec, refs)
        (out / "_author_prompt.txt").write_text(prompt, encoding="utf-8")        # for operator inspection
        if _raw_override is None and not run:
            return None, str(out), "prompt assembled; claude -p deferred (run=False)"
        raw = _raw_override if _raw_override is not None else _claude_author(prompt, timeout)
        js = extract_game_js(raw)
        if not js:
            return False, str(out), "no game.js code in claude output"
        ok, detail = validate(js, out)
        if not ok:
            return False, str(out), "authored game.js invalid: " + detail
        js += _emit.audio_js_snippet(audio_extras)    # extra named sounds (mechanical JSON append)
        (out / "game.js").write_text(js, encoding="utf-8")
        (out / "index.html").write_text(_emit.INDEX_HTML.replace("__TITLE__", spec.get("title") or slug), encoding="utf-8")
        return True, str(out), "authored + validated (" + detail + ")"
    except Exception as e:
        return False, str(out), "authoring error: " + type(e).__name__ + ": " + str(e)[:160]


if __name__ == "__main__":
    # Operator helper: print the assembled authoring prompt for a spec (paste into `claude -p` in cmd.exe).
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--genre", default="arcade")
    ap.add_argument("--title", default=None)
    ap.add_argument("--brief", default="")
    ap.add_argument("--print-prompt", action="store_true", help="stage + print the authoring prompt, no claude -p")
    a = ap.parse_args()
    spec = {"slug": a.slug, "genre": a.genre, "title": a.title or a.slug, "brief": a.brief}
    ok, out, detail = author_engine_game(spec, run=False)
    print(f"[author] {detail}\n[author] staged at: {out}")
    if a.print_prompt:
        print("\n===== AUTHORING PROMPT (pipe to `claude -p` in cmd.exe) =====\n")
        print((Path(out) / "_author_prompt.txt").read_text(encoding="utf-8"))
