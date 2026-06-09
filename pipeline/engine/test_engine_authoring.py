#!/usr/bin/env python3
"""test_engine_authoring.py — hermetic unit test for the AI authoring harness. NO claude -p, NO playwright,
NO network (node --check only, if node is present). Proves the DETERMINISTIC scaffolding around the single
claude -p call: prompt assembly, code extraction, validation (both ways), staging, and the full
author->extract->validate->write path via a fixture override. Prints 'AUTHORING-HARNESS: PASS'."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import engine_authoring as A  # noqa: E402

n = 0
fails = []


def chk(label, ok):
    global n
    n += 1
    if not ok:
        fails.append(label)


# A VALID authored game (simulates a good claude -p output): 2D collect, real sprites, winnable, responds,
# audio + hud. Coins sit on the bot's rightward path (y=4.5) so the play-bot makes progress.
GOOD_GAME_JS = """export const GAME = {
  title: "Fixture Collect", dim: "2d",
  sprites: { hero: "./assets/sprites/hero.png", coin: "./assets/sprites/coin.png" },
  setup(ctx) {
    ctx.player = ctx.spawn({ tag: "player", sprite: "hero", position: [4, 4.5, 0], scale: [0.9, 0.9, 1], layer: 2 });
    const spots = [[5.5, 4.5], [6.5, 4.5], [7.5, 4.5], [3, 6], [2, 3]];
    ctx.coinsTotal = spots.length;
    for (const [x, y] of spots) ctx.spawn({ tag: "coin", sprite: "coin", position: [x, y, 0], scale: [0.6, 0.6, 1], layer: 1 });
    ctx.music("music", { vol: 0.5 });
    ctx.hud("Collect them all");
  },
  update(dt, ctx) {
    const p = ctx.player;
    p.position[0] = Math.max(1, Math.min(8, p.position[0] + ctx.input.axisX() * 5 * dt));
    p.position[1] = Math.max(1, Math.min(8.5, p.position[1] - ctx.input.axisY() * 5 * dt));
    for (const c of ctx.byTag("coin")) if (ctx.overlap(p, c, 0.14)) { ctx.remove(c); ctx.score++; ctx.sound("coin"); }
    ctx.hud("Score " + ctx.score + " / " + ctx.coinsTotal);
    if (ctx.score >= ctx.coinsTotal) ctx.win();
  },
};
"""

# ── extract_game_js ────────────────────────────────────────────────────────────────────────────
chk("extract: ```js fenced", A.extract_game_js("blah\n```js\n" + GOOD_GAME_JS + "\n```\ndone") and
    A.extract_game_js("```js\n" + GOOD_GAME_JS + "\n```").startswith("export const GAME"))
chk("extract: plain ``` fence", (A.extract_game_js("```\n" + GOOD_GAME_JS + "\n```") or "").startswith("export const GAME"))
chk("extract: unfenced", (A.extract_game_js("here you go:\n" + GOOD_GAME_JS) or "").startswith("export const GAME"))
chk("extract: no GAME -> None", A.extract_game_js("sorry, I can't do that") is None)
chk("extract: empty -> None", A.extract_game_js("") is None)

# ── validate (both ways) ──────────────────────────────────────────────────────────────────────
ok, d = A.validate(GOOD_GAME_JS)
chk("validate: good fixture passes (" + d + ")", ok)
chk("validate: no GAME fails", not A.validate("const x = 1;")[0])
chk("validate: missing update fails", not A.validate("export const GAME = { setup(ctx){ ctx.win(); } , sprite: 'x' };")[0])
chk("validate: no asset usage fails", not A.validate("export const GAME = { setup(ctx){}, update(dt,ctx){ ctx.win(); } };")[0])
chk("validate: no win condition fails", not A.validate("export const GAME = { sprites:{}, setup(ctx){}, update(dt,ctx){} };")[0])
syn_ok, syn_d = A.validate("export const GAME = { sprites:{}, setup(ctx){ , update(dt,ctx){ ctx.win(); } };")  # syntax error
chk("validate: syntax error fails (if node present) (" + syn_d + ")", (not syn_ok) or ("node unavailable" in syn_d))

# ── build_prompt ─────────────────────────────────────────────────────────────────────────────
refs = {"sprites": {"hero": "./assets/sprites/hero.png", "coin": "./assets/sprites/coin.png"},
        "models": {"hero": "./assets/models/hero.glb"}}
pr = A.build_prompt({"slug": "neon-drift", "genre": "bullet-hell", "title": "Neon Drift", "brief": "dodge + shoot"}, refs)
for needle in ("export const GAME", "./assets/sprites/hero.png", "Neon Drift", "bullet-hell",
               "ENGINE_GAME_API", "WINNABLE", "REAL ASSETS", "```js"):
    chk(f"prompt contains {needle!r}", needle in pr)

# ── stage + author paths (use temp out dirs; don't pollute games/_engine) ──────────────────────
tmp = Path(tempfile.mkdtemp())
out, sref = A.stage("_unit-stage", tmp / "_unit-stage")
chk("stage: engine src copied", (out / "src" / "engine.js").exists())
chk("stage: real sprites staged + exist", all((out / "assets" / "sprites").joinpath(Path(u).name).exists()
                                              for u in sref.get("sprites", {}).values()) and len(sref.get("sprites", {})) >= 2)
chk("stage: real models staged + exist", all((out / "assets" / "models").joinpath(Path(u).name).exists()
                                             for u in sref.get("models", {}).values()) and len(sref.get("models", {})) >= 1)

# run=False -> deferred, prompt written, no game.js
ok0, out0, det0 = A.author_engine_game({"slug": "_defer", "genre": "arcade", "title": "Defer"},
                                       out_dir=tmp / "_defer", run=False)
chk("author run=False -> None (deferred)", ok0 is None and (Path(out0) / "_author_prompt.txt").exists()
    and not (Path(out0) / "game.js").exists())

# fixture override -> full extract->validate->write path
ok1, out1, det1 = A.author_engine_game({"slug": "_good", "genre": "collect", "title": "Good"},
                                       out_dir=tmp / "_good", _raw_override="```js\n" + GOOD_GAME_JS + "\n```")
chk("author fixture -> ok=True (" + det1 + ")", ok1 is True and (Path(out1) / "game.js").exists()
    and (Path(out1) / "index.html").exists())

# garbage override -> ok=False (fallback)
ok2, out2, det2 = A.author_engine_game({"slug": "_bad", "genre": "arcade", "title": "Bad"},
                                       out_dir=tmp / "_bad", _raw_override="I cannot write that.")
chk("author garbage -> ok=False (" + det2 + ")", ok2 is False)

print(f"checks run: {n}")
if fails:
    print("FAILED:")
    for f in fails:
        print("  -", f)
    print("AUTHORING-HARNESS: FAIL")
    sys.exit(1)
print(f"AUTHORING-HARNESS: PASS ({n} checks)")
sys.exit(0)
