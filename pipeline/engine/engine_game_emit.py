#!/usr/bin/env python3
"""engine_game_emit.py — ADDITIVE Phase-B wiring (ForgeFlow Engine <-> Games pipeline).

Turns an FFG `content.json` into a **PLAYABLE** game that runs on the from-scratch ForgeFlow Engine's
game runtime (controls + rules + collision + audio + win/lose), NOT just a static rendered scene (that is
Phase-A `engine_game_build.py`). It does this DETERMINISTICALLY — it instantiates a genre TEMPLATE built on
the engine's GameContext API (see forgeflow-engine/ENGINE_GAME_API.md) and parameterizes it from the spec
(title, palette/theme colors, coin/enemy counts, level length, lives). No LLM call — so it is fully
verifiable in CI. The richer, bespoke-layout variant is authored by the Opus game-writer (a separate cmd).

It does NOT touch the Phaser generator. Output (self-contained, deployable):
    <out>/
      index.html   (engine bootstrap: mode=game, injects window.__GAME_OBJECT__ = GAME)
      game.js       (export const GAME = {title, dim, setup, update} — the playable game)
      src/          (the ForgeFlow Engine runtime, copied from forgeflow-engine/src)
      assets/       (audio + demo assets the runtime fetches at startup)

Usage:
  python pipeline/engine/engine_game_emit.py --content pipeline/engine/golden/platformer.content.json \
      --out games/_engine/lumen-run --slug lumen-run-engine
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

GAMES = Path(__file__).resolve().parents[2]          # .../Claude Claw/forgeflow-games
CLAW = GAMES.parent                                  # .../Claude Claw
ENGINE = CLAW / "forgeflow-engine"
ASSETS_ROOT = GAMES / "pipeline" / "assets"          # junction -> F:\games\forgeflow-games-assets (real library)

# GS11(d): per-TEMPLATE real-asset selection — logical name -> source path under ASSETS_ROOT (CC0 Kenney /
# game-icons). The build COPIES these into the game dir and the emitted game.js references them by relative
# path (no bare cubes/quads). Missing source -> skipped (the template falls back to a flat color, logged).
ASSET_SETS = {
    "platformer": {"sprites": {"hero": "pixel-platformer/Tiles/Characters/tile_0000.png",
                               "star": "game-icons/PNG/White/2x/star.png"}},
    "shooter":    {"sprites": {"hero": "pixel-platformer/Tiles/Characters/tile_0000.png",
                               "foe":  "pixel-platformer/Tiles/Characters/tile_0004.png"}},
    "collect":    {"models":  {"hero": "3d-models/kenney-creatures/blocky-characters/Models/GLB format/character-a.glb",
                               "coin": "3d-models/kenney-creatures/cube-pets/Models/GLB format/animal-chick.glb"}},
}


def _stage_assets(out, sets):
    """Copy the chosen real asset files into <out>/assets/{sprites,models}/ (after the engine assets are
    copied) and return relative URL refs {kind: {name: './assets/kind/name.ext'}}. Missing -> skipped."""
    refs = {"sprites": {}, "models": {}}
    for kind in ("sprites", "models"):
        for name, rel in (sets.get(kind) or {}).items():
            src = ASSETS_ROOT / rel
            if not src.exists():
                print(f"  [warn] asset missing (color fallback): {kind}/{name} <- {rel}", file=sys.stderr)
                continue
            dst_dir = out / "assets" / kind
            dst_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst_dir / (name + src.suffix))
            refs[kind][name] = f"./assets/{kind}/{name}{src.suffix}"
    return refs


def _name_or_null(refs_kind, name):
    return json.dumps(name) if name in refs_kind else "null"


# ---- per-game AUDIO (GS-AUDIO): slug-seeded music + a named SFX set from the stock catalog -------
# Music: 6 loopable themes under assets/music (+ victory/game_over as win/lose stingers).
# SFX: 282 Kenney sounds across interface-sounds / impact-sounds / rpg-audio. The pick is HASH-SEEDED by
# (slug, name) so each game gets a stable, diverse soundscape with no RNG in CI.
MUSIC_DIR = ASSETS_ROOT / "music"
MUSIC_THEMES = ["cinematic_epic.ogg", "level_theme_1.ogg", "level_theme_2.ogg",
                "level_theme_3.ogg", "menu_theme.ogg", "boss_theme.ogg"]
SFX_PACKS = [ASSETS_ROOT / "interface-sounds", ASSETS_ROOT / "impact-sounds", ASSETS_ROOT / "rpg-audio"]
# contract names (overwrite the staged files in place — zero runtime change):
CONTRACT_SFX = {"coin": ["confirmation", "coin", "select"], "jump": ["cloth", "swish", "jump", "drop"]}
# EXTRA names (declared via GAME.audio; the runtime loads them in load()):
EXTRA_SFX = {"hit": ["impact", "hurt"], "explosion": ["impactmetal", "impactplate", "error"],
             "powerup": ["confirmation", "powerup", "bong"], "select": ["select", "click", "switch"],
             "shoot": ["drawknife", "throw", "swish", "laser"], "land": ["footstep", "drop"]}
EXTRA_STINGERS = {"win": "victory.ogg", "lose": "game_over.ogg"}   # from assets/music
AUDIO_NAMES = ["music", "coin", "jump"] + sorted(EXTRA_SFX) + sorted(EXTRA_STINGERS)


def _seed(slug, salt=""):
    return int(hashlib.md5((slug + "|" + salt).encode("utf-8")).hexdigest()[:8], 16)


def _pick_sfx(name, keywords, slug):
    """Deterministically pick one SFX file matching the keywords (filename contains), seeded by
    (slug, name). Falls back to the whole catalog if no keyword hit. None if no packs exist."""
    pool = []
    for pack in SFX_PACKS:
        if pack.exists():
            pool += [f for f in sorted(pack.rglob("*.ogg")) if any(k in f.name.lower() for k in keywords)]
    if not pool:
        for pack in SFX_PACKS:
            if pack.exists():
                pool += sorted(pack.rglob("*.ogg"))
    return pool[_seed(slug, name) % len(pool)] if pool else None


def stage_audio(out, slug):
    """Stage PER-GAME audio into <out>/assets/audio/ (after the engine assets are copied):
      * music: a slug-seeded theme OVERWRITES music_menu.ogg (the runtime's "music" contract file)
      * coin/jump: slug-seeded picks OVERWRITE sfx_coin.ogg / sfx_jump.ogg (contract files)
      * extras (hit/explosion/powerup/select/shoot/land + win/lose stingers): copied as sfx_<name>.ogg
    Returns {extra_name: './assets/audio/sfx_<name>.ogg'} for the GAME.audio declaration. Missing catalog
    (junction down) -> {} and the bundled engine defaults remain (never breaks the build)."""
    adir = out / "assets" / "audio"
    adir.mkdir(parents=True, exist_ok=True)
    refs = {}
    try:
        if MUSIC_DIR.exists():
            themes = [MUSIC_DIR / t for t in MUSIC_THEMES if (MUSIC_DIR / t).exists()]
            if themes:
                shutil.copyfile(themes[_seed(slug, "music") % len(themes)], adir / "music_menu.ogg")
        for name, kws in CONTRACT_SFX.items():
            f = _pick_sfx(name, kws, slug)
            if f:
                shutil.copyfile(f, adir / ("sfx_%s.ogg" % name))
        for name, kws in EXTRA_SFX.items():
            f = _pick_sfx(name, kws, slug)
            if f:
                shutil.copyfile(f, adir / ("sfx_%s.ogg" % name))
                refs[name] = "./assets/audio/sfx_%s.ogg" % name
        for name, fname in EXTRA_STINGERS.items():
            src = MUSIC_DIR / fname
            if src.exists():
                shutil.copyfile(src, adir / ("sfx_%s.ogg" % name))
                refs[name] = "./assets/audio/sfx_%s.ogg" % name
    except OSError as e:
        print(f"  [warn] audio staging incomplete ({e}); engine default audio remains", file=sys.stderr)
    return refs


def audio_js_snippet(extra_refs):
    """The GAME.audio declaration appended after an emitted/authored game.js (new names only)."""
    if not extra_refs:
        return ""
    return "\nGAME.audio = " + json.dumps(extra_refs) + ";   // per-game SFX set (staged by stage_audio)\n"

# ---- palette / color helpers -------------------------------------------------------------------
def hex2rgb(h, default=(0.8, 0.8, 0.85)):
    if not isinstance(h, str):
        return list(default)
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return list(default)
    try:
        return [round(int(h[i:i + 2], 16) / 255, 3) for i in (0, 2, 4)]
    except ValueError:
        return list(default)


# named palettes (platformer specs carry a name, not colors): hero, ground, plat, coin, goal
PALETTES = {
    "ember":   ([1.0, 0.55, 0.25], [0.30, 0.16, 0.10], [0.55, 0.32, 0.20], [1.0, 0.82, 0.25], [1.0, 0.90, 0.30]),
    "abyss":   ([0.30, 0.62, 1.00], [0.10, 0.16, 0.26], [0.20, 0.30, 0.45], [0.50, 1.00, 0.70], [0.55, 1.0, 0.75]),
    "verdant": ([0.40, 0.90, 0.50], [0.18, 0.30, 0.16], [0.30, 0.45, 0.28], [1.0, 0.90, 0.30], [1.0, 0.90, 0.30]),
    "default": ([0.30, 0.62, 1.00], [0.32, 0.46, 0.30], [0.45, 0.55, 0.68], [1.0, 0.85, 0.20], [1.0, 0.90, 0.25]),
}


def _fill(tpl, repl):
    for k, v in repl.items():
        tpl = tpl.replace(k, v)
    return tpl


# ---- genre templates (built on the engine GameContext API; each is playable + winnable) ---------
PLATFORMER_TPL = """// GENERATED by engine_game_emit.py (platformer template) — DO NOT EDIT.
export const GAME = {
  title: __TITLE__, dim: "2d",
  sprites: __SPRITES__,
  setup(ctx) {
    ctx.enablePhysics({ gravity: -26 });
    const LEN = __LEN__;
    ctx.body(ctx.spawn({ tag: "ground", position: [LEN / 2, 0.5, 0], scale: [LEN + 6, 1, 1], color: __GROUND__ }), { static: true, friction: 0.95 });
    for (const [px, py] of __PLATS__) ctx.body(ctx.spawn({ tag: "plat", position: [px, py, 0], scale: [3, 0.5, 1], color: __PLAT__ }), { static: true, friction: 0.95 });
    const coins = __COINS__;
    for (const [cx, cy] of coins) ctx.spawn({ tag: "coin", sprite: __COIN_SPR__, position: [cx, cy, 0], scale: [0.6, 0.6, 1], color: __COIN__, layer: 1 });
    ctx.spawn({ tag: "goal", position: [LEN - 1, 2.0, 0], scale: [0.7, 2.4, 1], color: __GOAL__, layer: 1 });
    ctx.player = ctx.spawn({ tag: "player", sprite: __HERO_SPR__, position: [1.5, 1.6, 0], scale: [0.9, 0.9, 1], color: __HERO__, layer: 2 });
    ctx.pb = ctx.body(ctx.player, { mass: 1, friction: 0, restitution: 0, noSleep: true });
    ctx.coinsTotal = coins.length;
    ctx.music("music", { vol: 0.5 });
    ctx.hud("Reach the flag!");
  },
  update(dt, ctx) {
    const p = ctx.player, pb = ctx.pb;
    pb.velocity[0] = ctx.input.axisX() * 6.5;
    if ((ctx.input.pressed("Space") || ctx.input.pressed("ArrowUp")) && ctx.grounded(p)) { pb.velocity[1] = 11; ctx.sound("jump"); }
    for (const c of ctx.byTag("coin")) if (ctx.overlap(p, c, 0.12)) { ctx.remove(c); ctx.score++; ctx.sound("coin"); }
    for (const g of ctx.byTag("goal")) if (ctx.overlap(p, g, 0.2)) ctx.win();
    if (p.position[1] < -3) { pb.position[0] = 1.5; pb.position[1] = 2; pb.velocity[0] = pb.velocity[1] = 0; }
    ctx.scrollX = Math.max(0, p.position[0] - 5);
    ctx.hud("Score " + ctx.score + " / " + ctx.coinsTotal + "   -> flag");
  },
};
"""

SHOOTER_TPL = """// GENERATED by engine_game_emit.py (shooter template) — DO NOT EDIT.
export const GAME = {
  title: __TITLE__, dim: "2d",
  sprites: __SPRITES__,
  setup(ctx) {
    ctx.player = ctx.spawn({ tag: "player", sprite: __HERO_SPR__, position: [4, 4.5, 0], scale: [0.9, 0.9, 1], color: __HERO__, layer: 2 });
    ctx.lives = __LIVES__; ctx.enemyKills = 0; ctx.fireCd = 0;
    const spots = __SPOTS__;
    ctx.enemiesTotal = spots.length;
    for (const [x, y] of spots) { const e = ctx.spawn({ tag: "enemy", sprite: __FOE_SPR__, position: [x, y, 0], scale: [0.9, 0.9, 1], color: __ENEMY__, layer: 1 }); e.speed = 1.25; }
    ctx.music("music", { vol: 0.5 });
    ctx.hud("Arrows move   F fire");
  },
  update(dt, ctx) {
    const p = ctx.player;
    p.position[0] = Math.max(1, Math.min(8, p.position[0] + ctx.input.axisX() * 5 * dt));
    p.position[1] = Math.max(1, Math.min(8.5, p.position[1] - ctx.input.axisY() * 5 * dt));
    ctx.fireCd -= dt;
    if (ctx.input.pressed("KeyF") && ctx.fireCd <= 0) {
      const es = ctx.byTag("enemy");
      if (es.length) {
        let best = es[0], bd = 1e9;
        for (const e of es) { const d = Math.hypot(e.position[0] - p.position[0], e.position[1] - p.position[1]); if (d < bd) { bd = d; best = e; } }
        ctx.fire([p.position[0], p.position[1]], [best.position[0] - p.position[0], best.position[1] - p.position[1]], { speed: 16, life: 2, color: __BULLET__ });
        ctx.sound("jump"); ctx.fireCd = 0.15;
      }
    }
    for (const e of ctx.byTag("enemy")) { const dx = p.position[0] - e.position[0], dy = p.position[1] - e.position[1], n = Math.hypot(dx, dy) || 1; e.position[0] += dx / n * e.speed * dt; e.position[1] += dy / n * e.speed * dt; }
    for (const pr of ctx.byTag("proj")) for (const e of ctx.byTag("enemy")) if (ctx.overlap(pr, e, 0.15)) { ctx.remove(pr); ctx.remove(e); ctx.score += 10; ctx.enemyKills++; ctx.sound("coin"); }
    for (const e of ctx.byTag("enemy")) if (ctx.overlap(p, e, 0)) { if (ctx.hurt(1)) { const s = e.position[0] > p.position[0] ? 1 : -1; e.position[0] += s * 1.6; } }
    ctx.hud("Kills " + ctx.enemyKills + "/" + ctx.enemiesTotal + "   Lives " + ctx.lives);
    if (ctx.byTag("enemy").length === 0) ctx.win();
  },
};
"""

COLLECT_TPL = """// GENERATED by engine_game_emit.py (collect template, 3D) — DO NOT EDIT.
export const GAME = {
  title: __TITLE__,
  models: __MODELS__,
  setup(ctx) {
    ctx.spawn({ tag: "ground", position: [6, -0.6, 0], scale: [40, 0.4, 16], color: __GROUND__ });
    ctx.player = ctx.spawn({ tag: "player", model: __HERO_MDL__, position: [0, 0.1, 0], scale: [1, 1, 1], color: __HERO__ });
    const coins = __COINS__;
    ctx.coinsTotal = coins.length;
    for (const cx of coins) ctx.spawn({ tag: "coin", model: __COIN_MDL__, position: [cx, 0.1, 0], scale: [0.7, 0.7, 0.7], color: __COIN__ });
    ctx.music("music", { vol: 0.5 });
    ctx.hud("Collect " + ctx.coinsTotal);
  },
  update(dt, ctx) {
    const sp = 7.0, p = ctx.player;
    p.position[0] += ctx.input.axisX() * sp * dt;
    p.position[2] += ctx.input.axisY() * sp * dt;
    for (const coin of ctx.byTag("coin")) { coin.rotation[1] += dt * 3; if (ctx.overlap(p, coin, 0.1)) { ctx.remove(coin); ctx.score++; ctx.sound("coin"); } }
    ctx.camera.eye[0] = p.position[0]; ctx.camera.target[0] = p.position[0];
    if (ctx.score >= ctx.coinsTotal) ctx.win();
  },
};
"""

INDEX_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>__TITLE__</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
#c{width:100vw;height:100vh;display:block}
#err{position:fixed;inset:0;color:#f66;font:13px/1.5 monospace;padding:16px;white-space:pre-wrap}</style></head>
<body><canvas id="c"></canvas>
<script type="module">
  import { Engine } from "./src/engine.js";
  import { GAME } from "./game.js";
  window.__ENGINE_MODE__ = "game";       // run the game runtime
  window.__GAME_OBJECT__ = GAME;          // inject the emitted game (precedence over built-in samples)
  const canvas = document.getElementById("c");
  try { const eng = new Engine(canvas); window.__ENGINE__ = eng; eng.start(); }
  catch (e) {
    window.__ENGINE_ERROR__ = String(e);
    const d = document.createElement("div"); d.id = "err";
    d.textContent = "Engine failed to start:\\n" + e; document.body.appendChild(d);
  }
</script></body></html>
"""


def _title(content):
    return json.dumps(content.get("title") or content.get("slug") or "FORGEFLOW GAME")


def platformer_js(content, refs):
    lvl = content.get("level", {}) or {}
    tile = lvl.get("tile") or 36
    hero, ground, plat, coin, goal = PALETTES.get(content.get("palette"), PALETTES["default"])
    LEN = max(24, min(60, round((lvl.get("width") or 1800) / tile)))
    nplat = max(3, min(8, len(lvl.get("platforms") or []) or 4))
    ncoin = max(3, min(10, len(lvl.get("coins") or []) or 5))
    plats = [[round(4 + (LEN - 8) * (i + 0.5) / nplat, 2), 2.4 if i % 2 == 0 else 3.2] for i in range(nplat)]
    coins = [[round(3 + (LEN - 6) * (i + 0.5) / ncoin, 2), 2.0] for i in range(ncoin)]
    sp = refs["sprites"]
    js = _fill(PLATFORMER_TPL, {
        "__TITLE__": _title(content), "__LEN__": str(LEN),
        "__PLATS__": json.dumps(plats), "__COINS__": json.dumps(coins),
        "__SPRITES__": json.dumps(sp), "__HERO_SPR__": _name_or_null(sp, "hero"), "__COIN_SPR__": _name_or_null(sp, "star"),
        "__HERO__": json.dumps(hero), "__GROUND__": json.dumps(ground),
        "__PLAT__": json.dumps(plat), "__COIN__": json.dumps(coin), "__GOAL__": json.dumps(goal),
    })
    return js, {"template": "platformer", "dim": "2d", "coins": ncoin, "platforms": nplat}


def shooter_js(content, refs):
    cfg = content.get("config", {}) or {}
    theme = content.get("theme", {}) or {}
    lives = max(1, min(5, int(cfg.get("lives") or 3)))
    total = sum(int(w.get("count") or 0) for world in content.get("worlds", []) for w in world.get("waves", []))
    nenemy = max(3, min(6, total or 4))
    hero = hex2rgb(theme.get("ship"), (0.30, 0.62, 1.0))
    enemy = hex2rgb(theme.get("enemy"), (0.92, 0.30, 0.30))
    bullet = hex2rgb(theme.get("bullet"), (1.0, 0.95, 0.4))
    spots = [[round(11 + (i % 3) * 1.4, 2), round(2 + i * (6.0 / max(1, nenemy - 1)), 2)] for i in range(nenemy)]
    sp = refs["sprites"]
    js = _fill(SHOOTER_TPL, {
        "__TITLE__": _title(content), "__LIVES__": str(lives), "__SPOTS__": json.dumps(spots),
        "__SPRITES__": json.dumps(sp), "__HERO_SPR__": _name_or_null(sp, "hero"), "__FOE_SPR__": _name_or_null(sp, "foe"),
        "__HERO__": json.dumps(hero), "__ENEMY__": json.dumps(enemy), "__BULLET__": json.dumps(bullet),
    })
    return js, {"template": "shooter", "dim": "2d", "enemies": nenemy, "lives": lives}


def collect_js(content, refs):
    hero, ground, plat, coin, goal = PALETTES.get(content.get("palette"), PALETTES["default"])
    lvl = content.get("level", {}) or {}
    ncoin = max(3, min(8, len(lvl.get("coins") or []) or 5))
    coins = [round(2 + i * 2.2, 2) for i in range(ncoin)]
    md = refs["models"]
    js = _fill(COLLECT_TPL, {
        "__TITLE__": _title(content), "__COINS__": json.dumps(coins),
        "__MODELS__": json.dumps(md), "__HERO_MDL__": _name_or_null(md, "hero"), "__COIN_MDL__": _name_or_null(md, "coin"),
        "__HERO__": json.dumps(hero), "__GROUND__": json.dumps(ground), "__COIN__": json.dumps(coin),
    })
    return js, {"template": "collect", "dim": "3d", "coins": ncoin}


GENRE_TEMPLATE = {
    "platformer": "platformer", "runner": "platformer",
    "shmup": "shooter", "shooter": "shooter", "arcade": "shooter", "bullet-hell": "shooter",
    "tactics": "collect", "tactics3d": "collect", "3d-tactics": "collect", "void-skirmish": "collect",
    "collect": "collect", "pickup": "collect",
}
TEMPLATE_FN = {"platformer": platformer_js, "shooter": shooter_js, "collect": collect_js}


def template_of(content):
    return GENRE_TEMPLATE.get((content.get("genre") or "").lower(), "collect")   # default: safe 3D collect


def emit_game_js(content, refs):
    return TEMPLATE_FN[template_of(content)](content, refs)


def build(content_path, out_dir, slug="engine-game"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    content = json.loads(Path(content_path).read_text(encoding="utf-8"))
    for sub in ("src", "assets"):                    # bundle the engine runtime + assets it fetches (FIRST)
        dst = out / sub
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(ENGINE / sub, dst)
    refs = _stage_assets(out, ASSET_SETS.get(template_of(content), {}))   # GS11(d): copy REAL assets into the game dir
    audio_refs = stage_audio(out, slug)              # GS-AUDIO: per-game music + named SFX set (slug-seeded)
    js, meta = emit_game_js(content, refs)           # game.js references the copied assets by relative path
    js += audio_js_snippet(audio_refs)               # declare the extra sounds (runtime loads GAME.audio)
    (out / "game.js").write_text(js, encoding="utf-8")
    (out / "index.html").write_text(INDEX_HTML.replace("__TITLE__", slug), encoding="utf-8")
    meta.update({"out": str(out), "genre": genre_of(content), "slug": slug,
                 "assets": sum(len(v) for v in refs.values()), "audio": 3 + len(audio_refs)})
    return meta


def genre_of(content):
    return (content.get("genre") or "").lower()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", required=True, help="path to an FFG content.json")
    ap.add_argument("--out", required=True, help="output game directory (deployable)")
    ap.add_argument("--slug", default="engine-game")
    a = ap.parse_args(argv)
    r = build(a.content, a.out, a.slug)
    print(f"engine game emitted: {r['out']}  genre={r['genre']} template={r['template']} dim={r['dim']}")
    print(f"deploy: python pipeline/deploy_game.py --game-dir {r['out']} --slug {a.slug}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
