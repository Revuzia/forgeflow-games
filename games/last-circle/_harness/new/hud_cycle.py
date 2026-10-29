#!/usr/bin/env python
"""hud_cycle - the HUD across back-to-back matches driven through ITS OWN post-match buttons (plan P4.3), in a real browser.

    python _harness/new/hud_cycle.py --disk [--rounds 3]
    python _harness/new/hud_cycle.py --disk --plant leak-geometries      # FALSIFIER: 24 geometries uploaded and never disposed per round (gpu row MUST fail)
    python _harness/new/hud_cycle.py --disk --plant leak-textures        # FALSIFIER: 5 textures uploaded and never disposed per round (gpu row MUST fail)

One match -> the player is eliminated -> a REAL click on MATCH STATS -> the standings -> a REAL click on "Run it back" (round 1 and 3)
or "Find a new match" (round 2) -> the next lobby -> a REAL Enter -> landed.  leaktest.py reaches the next match through startMatch
directly (the path onAgain calls) and so never touches the buttons this lane added; this gate does, and counts what the HUD leaves behind:

  dom          document element count in each lobby: round 3 within +-60 of round 1 (the HUD rebuilds its tree per match; a per-match
               leak shows as growth that adds up)
  overlays     in every match: 0 leftover [data-lc=death] / [data-lc=post] nodes, exactly 1 [data-lc=bars] vitals card and 1 weapon card
  gpu          renderer.info.memory.textures in each lobby: round 3 within +-5 of round 1; geometries within +-30 (R3: rounds 1 and 3 share the map AND the
               seed - their "Run it back" seed rolls are pinned to one value, --again-seed - since the lobby's textures depend on the seeded content)
  programs     (INFORMATION) renderer.info.programs in each lobby; it is NOT gated: three releases and re-links programs as the lobby / match materials come and go, and the
               lobbies of one run read 58, 55, 59 (isla_viva, 2026-10-14), so a one-program-per-round leak is inside the noise and a no-growth bar would flake
  animations   document.getAnimations() in the lobby: no growth between round 1 and round 3
  errors       0 console / page errors, 0 failed requests over the whole run

SAME-MAP COMPARISON (Wave-7 fix round, lane 7G). "Find a new match" rolls a RANDOM map (hud.js randomMap(): BATTLE_MAPS[floor(Math.random() * 3)]), and
the maps do not cost the same: Savanna (ashgrid) holds about +70 geometries and +10 textures over Isla Viva, so round 3 vs round 1 failed the gpu row
4 times in 9 runs whenever the roll left Isla Viva (e.g. textures 139 -> 149, geometries 147 -> 240) - by design of the comparison, not a leak (leaktest, which pins
the map over 5 matches, shows none). The gate now (a) pins the die roll of round 2's REAL "Find a new match" click to the map the player is on (--find-map same, the
default; a one-shot Math.random override that lives only inside that click event, so the button, onAgain() and randomMap() all run for real - it also fixes round 2's match seed,
which startMatch draws from Math.random in the same click (2 reads, printed); --find-map random keeps
the product's roll, --find-map <map id> rolls that map) and (b) compares lobbies GROUPED BY MAP: the first and the last lobby on the same map, with the same bars as
before (+-5 textures, +-30 geometries, no animation growth). A run in which no map has two lobbies is could-not-judge, never a pass.
Exit 0 pass / 1 fail / 2 could-not-judge (common.py's contract).  Run it alone (one Chrome).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402
import hud_checks as HC  # noqa: E402

CENSUS_JS = r"""() => { const W = window.__LC__.W, mem = W.kernel && W.kernel.renderer ? W.kernel.renderer.info.memory : {};
  const q = (n) => document.querySelectorAll('[data-lc="' + n + '"]').length;
  const progs = W.kernel && W.kernel.renderer && W.kernel.renderer.info.programs ? W.kernel.renderer.info.programs.length : null;
  return { dom: document.getElementsByTagName('*').length, textures: mem.textures, geometries: mem.geometries, programs: progs,
           anims: document.getAnimations().length, phase: W.phase, map: W.mapId, death: q('death'), post: q('post'), bars: q('bars'), wcard: q('wcard'), feed: q('feed') }; }"""

# Pins the die roll of the NEXT click (the real "Find a new match" button): hud.js randomMap() reads Math.random() synchronously inside that click's handler, so a
# one-shot override installed in the capture phase of the click event and removed by a 0 ms timeout (after the handler returned) is seen by nothing else.
# BATTLE_MAPS comes from the very hud.js instance the game imported (the boot script's ?v=), so the index is the product's own.
PIN_FIND_JS = r"""async (want) => {
  const el = [...document.querySelectorAll('script[type=module]')].find((s) => /ffg_boot3d/.test(s.src));
  const V = el ? new URL(el.src).search : '';
  const mod = await import(new URL('runtime/3d/royale/hud.js', location.href.replace(/[^/]*$/, '')).href + V);
  const maps = mod.BATTLE_MAPS || [];
  const idx = maps.indexOf(want);
  if (idx < 0) return { ok: false, want, maps };
  const orig = Math.random;
  window.__HC_PIN__ = { want, idx, used: 0 };
  document.addEventListener('click', () => {
    Math.random = () => { window.__HC_PIN__.used++; return (idx + 0.5) / maps.length; };
    setTimeout(() => { Math.random = orig; }, 0);
  }, { capture: true, once: true });
  return { ok: true, want, idx, maps };
}"""

# R3 (gates): "Run it back" keeps the map but startMatch draws a NEW seed from Math.random inside the same click (ffg_royale3d.js _startMatch:
# W.seed = opts.seed ?? Math.random() * 0xffffffff), and the lobby's texture count depends on the seeded content: seeds 5 / 2 / 8 / 1 on one map read
# 160 / 164 / 158 / 162 textures, flat from 0.5 to 5.5 s (F:/lc_p23/r2/hud/probe/seed_s*.json) - round 1 vs round 3 differed by up to 6 on the base
# build too, i.e. the row measured the seed roll, not accumulation. Rounds 1 and 3 therefore pin the seed roll of their REAL "Run it back" click to
# the SAME value (one-shot Math.random override inside that click only, as PIN_FIND_JS does), so the two lobbies the rows compare are the same map
# AND the same seed: what is left is what the rounds accumulated. Round 2's "Find a new match" stays pinned as before (--find-map).
PIN_AGAIN_JS = r"""(val) => {
  const orig = Math.random;
  window.__HC_PINA__ = { val, used: 0 };
  document.addEventListener('click', () => {
    Math.random = () => { window.__HC_PINA__.used++; return val; };
    setTimeout(() => { Math.random = orig; }, 0);
  }, { capture: true, once: true });
  return { ok: true, val };
}"""
AGAIN_ROLL = 0.37      # any fixed value: the same seed for every pinned "Run it back"

# PLANTED LEAKS (--plant): what a real "not freed between rounds" defect looks like to the gpu row. They run in the post-match screen before each
# "Run it back" / "Find a new match" click: a scratch scene is rendered once (so the renderer registers the resources in renderer.info.memory) and
# then dropped WITHOUT dispose() - exactly what a forgotten dispose leaves behind. 24 geometries / 5 textures per round, so the two rounds the rows compare add
# 48 > 30 and 10 > 5 (an honest lobby drifts -8 .. -2 geometries and 0 textures over the same two rounds: 9 runs, 2026-10-14).
LEAK_JS = r"""(a) => { const W = window.__LC__.W, T = W.THREE, r = W.kernel.renderer;
  const sc = new T.Scene(), cam = new T.PerspectiveCamera(60, 1, 0.1, 100); cam.position.set(0, 0, 5);
  const m0 = new T.MeshBasicMaterial({ color: 0xff00ff });
  for (let i = 0; i < a.geos; i++) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, i * 0.001]), 3)); const m = new T.Mesh(g, m0); m.frustumCulled = false; sc.add(m); }
  const shared = new T.BufferGeometry(); shared.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)); shared.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  for (let i = 0; i < a.texs; i++) { const t = new T.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); t.needsUpdate = true; const m = new T.Mesh(shared, new T.MeshBasicMaterial({ map: t })); m.frustumCulled = false; sc.add(m); }
  const prevT = r.getRenderTarget(), prevAuto = r.autoClear; r.setRenderTarget(null); r.autoClear = false;
  try { r.render(sc, cam); } finally { r.autoClear = prevAuto; r.setRenderTarget(prevT); }
  const mem = r.info.memory; return { geometries: mem.geometries, textures: mem.textures }; }"""

PLANTS = {
    "leak-geometries": {"geos": 24, "texs": 0},
    "leak-textures": {"geos": 0, "texs": 5},
}

DIE_JS = r"""() => { const W = window.__LC__.W; const bot = W.actors.find((a) => a.id !== W.player.id && a.alive && !a.isDummy);
  W.player.lastHit = null; W.hurtActor(W.player, 9999, bot.id, 'ar', true); return { by: bot.name, alive: W.player.alive }; }"""


# round 2 dies to the STORM (no killer, weapon id "storm"): the banner must say so and the feed row must name "the Storm"
DIE_STORM_JS = r"""() => { const W = window.__LC__.W; W.killActor(W.player, null, 'storm'); return { alive: W.player.alive }; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--find-map", default="same",
                    help="the die roll of the REAL 'Find a new match' click: 'same' (default) = the map the player is on, 'random' = the product's own roll, or a map id (isla_viva / ashgrid / deepwood)")
    ap.add_argument("--again-seed", default="same", choices=["same", "random"],
                    help="the seed roll of the REAL 'Run it back' clicks (rounds 1 and 3): 'same' (default, R3) = one fixed roll for both, so the compared lobbies share the seed; 'random' = the product's roll")
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS),
                    help="FALSIFIER: a resource leaked every round (renderer.info.memory.geometries / textures grow and are never disposed); the gpu row MUST fail")
    args = ap.parse_args()
    if args.plant and not args.report:
        args.report = "hud_cycle_plant_" + args.plant.replace("-", "_")

    def body(v):
        census = []          # one per lobby
        in_match = []
        storm = {}
        guard_runs = []      # every round: the guard call made in the LOBBY (before Enter) and whether the human survived the drop + landing
        with C.Session(args, "hud_cycle", viewport={"width": 1280, "height": 720}) as s:
            s.boot()
            # RACE FIX (L4-gates 2026-10-13): the guard goes up in the LOBBY, before the Enter that starts the drop. It used to be installed
            # after Enter reached phase 'drop', and in 1 of 9 full-run rounds a bot sniper (HEADSHOT, 52 m) killed the unprotected human in
            # those frames, leaving a [data-lc=death] overlay behind ("0 leftover death / post overlays" red, then 8 of 8 green on re-run).
            first = HC.start_landed(s, guard_first=True)
            guard_runs.append({"round": 1, "guardCallBeforeEnter": first.get("guardBeforeEnter"), "alive": first.get("alive"), "phase": first.get("phase")})
            for rnd in range(1, args.rounds + 1):
                s.freeze_loop()
                HC.step(s, 6)
                m = s.js(CENSUS_JS)
                in_match.append(m)
                v.info("round %d in the match" % rnd, m)
                s.guard_player(False)
                s.js(DIE_STORM_JS if rnd == 2 else DIE_JS)
                s.sleep(0.5)
                HC.step(s, 10, render=True)
                dd = s.js(HC.DEATH_JS)
                if rnd == 2:
                    storm = {"banner": (dd or {}).get("text"), "feed": [r["text"] for r in (s.js(HC.FEED_JS) or [])][-2:]}
                btn = (dd or {}).get("btn")
                if not btn:
                    v.cnj("round %d" % rnd, "no MATCH STATS button on the death banner")
                    return
                s.page.mouse.click(btn[0], btn[1])
                s.sleep(3.6)
                HC.step(s, 6, render=False)
                p = s.js(HC.POST_JS)
                if not p:
                    v.cnj("round %d" % rnd, "no post-match screen after MATCH STATS (phase %s)" % s.phase())
                    return
                want = "Find a new match" if rnd == 2 else "Run it back"
                b = next((x for x in p["btns"] if x["t"].startswith(want)), None)
                if not b:
                    v.cnj("round %d" % rnd, "no '%s' button: %s" % (want, [x["t"] for x in p["btns"]]))
                    return
                if args.plant:
                    v.info("round %d PLANTED LEAK (%s), not disposed" % (rnd, args.plant), s.js(LEAK_JS, PLANTS[args.plant]))
                if want == "Find a new match" and args.find_map != "random":
                    target = (in_match[-1]["map"] if args.find_map == "same" else args.find_map)
                    pin = s.js(PIN_FIND_JS, target)
                    v.info("round %d: the die roll of the REAL 'Find a new match' click is pinned to %s" % (rnd, target), pin)
                    if not pin.get("ok"):
                        v.cnj("round %d" % rnd, "cannot pin the map roll to %r: %s" % (target, pin))
                        return
                if want == "Run it back" and args.again_seed == "same":
                    v.info("round %d: the seed roll of the REAL 'Run it back' click is pinned (R3: the compared lobbies share map AND seed)" % rnd, s.js(PIN_AGAIN_JS, AGAIN_ROLL))
                s.thaw_loop()
                s.page.mouse.click(b["x"], b["y"])
                ok = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
                if ok is None:
                    v.cnj("round %d" % rnd, "the next lobby never came (%s)" % want)
                    return
                s.sleep(0.5)
                cl = s.js(CENSUS_JS)
                census.append(cl)
                v.info("round %d lobby after '%s'" % (rnd, want), cl)
                if want == "Find a new match" and args.find_map != "random":
                    v.info("round %d: the pinned die roll was consumed by the click (Math.random reads inside it)" % rnd, s.safe_js("() => window.__HC_PIN__"))
                if want == "Run it back" and args.again_seed == "same":
                    v.info("round %d: the pinned seed roll was consumed by the click; the lobby's seed" % rnd, s.safe_js("() => ({ pin: window.__HC_PINA__, seed: window.__LC__.W.seed })"))
                cl["seed"] = s.safe_js("() => window.__LC__.W.seed")
                if rnd < args.rounds:
                    s.js("() => { window.__H_GUARD_N__ = {}; }")      # fresh per-phase frame counts for this round
                    lobby_phase = s.phase()
                    guard_call = s.guard_player(True)                 # BEFORE Enter (the race fix)
                    s.page.keyboard.press("Enter")
                    s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
                    s.guard_player(True)
                    land = s.land(120, protect=True)
                    seen = s.js("() => Object.assign({}, window.__H_GUARD_N__ || {})")
                    guard_runs.append({"round": rnd + 1, "guardCallBeforeEnter": guard_call, "phaseAtThatCall": lobby_phase, "framesPerPhase": seen, "alive": land.get("alive"), "phase": land.get("phase")})
                    v.info("round %d guard (installed in the lobby, before Enter)" % (rnd + 1), guard_runs[-1])
            d = s.diagnostics()
            probs = C.diag_problems(d, rig=False)

        # SAME-MAP comparison (lane 7G): group the lobbies by map and compare the FIRST and the LAST lobby of a map that has at least two. With the default
        # --find-map same every lobby is on one map, so this is the old round-1-vs-round-3 comparison with the same bars; with --find-map random a map the roll left
        # is simply not compared against another map's resources.
        # R3: with the seed rolls pinned (--again-seed same) the compared lobbies are grouped by map AND seed - round 2's lobby (another seed) is
        # never compared with round 1's; --again-seed random keeps the map-only grouping
        by_map = {}
        for c in census:
            by_map.setdefault(c["map"] if args.again_seed == "random" else "%s seed %s" % (c["map"], c.get("seed")), []).append(c)
        groups = [(m, cs) for m, cs in by_map.items() if len(cs) >= 2]
        v.info("lobbies per map (resources are only compared on the same map)", {m: len(cs) for m, cs in by_map.items()})
        if not groups:
            v.cnj("dom / gpu / animations: the same-map comparison", "no map has two lobbies in this run (maps %s): nothing to compare" % [c["map"] for c in census])
        for m, cs in groups:
            a, z = cs[0], cs[-1]
            tag = "%s, %d lobbies" % (m, len(cs))
            v.check("dom: the lobby's element count after the last round on %s is within +-60 of the first (%d -> %d)" % (tag, a["dom"], z["dom"]), abs(z["dom"] - a["dom"]) <= 60, [c["dom"] for c in cs])
            v.check("gpu: lobby textures within +-5 and geometries within +-30 of the first lobby on %s (%s -> %s, %s -> %s)" % (tag, a["textures"], z["textures"], a["geometries"], z["geometries"]),
                    abs(z["textures"] - a["textures"]) <= 5 and abs(z["geometries"] - a["geometries"]) <= 30, [(c["textures"], c["geometries"]) for c in cs])
            v.info("programs per lobby on %s (information: three re-links programs as materials come and go, the count moves by several without a leak)" % tag, [c.get("programs") for c in cs])
            v.check("animations: no growth in running CSS animations/transitions between the first and the last lobby on %s (%d -> %d)" % (tag, a["anims"], z["anims"]), z["anims"] <= a["anims"], [c["anims"] for c in cs])
        bad = [m for m in in_match if not (m["death"] == 0 and m["post"] == 0 and m["bars"] == 1 and m["wcard"] == 1 and m["feed"] == 1)]
        v.check("overlays: in every match 0 leftover death / post overlays and exactly 1 vitals card, 1 weapon card, 1 kill feed", bool(in_match) and not bad, bad[:2] or in_match[:1])
        if len(in_match) >= 2:
            t = (storm.get("banner") or "")
            v.check("storm death (round 2): the banner reads 'ELIMINATED #N of 50 ... THE STORM GOT YOU' (no killer, no weapon, no HEADSHOT) and the feed row names 'the Storm'",
                    "ELIMINATED" in t and " of 50" in t and "THE STORM GOT YOU" in t and "HEADSHOT" not in t and "ELIMINATED BY" not in t and any("the Storm" in f for f in storm.get("feed", [])), storm)
        maps = [m["map"] for m in in_match] + [c["map"] for c in census]
        v.info("maps seen (Run it back keeps the map; Find a new match rolls a random map unless --find-map pins the roll, the default)", maps)
        if len(census) >= 1 and len(in_match) >= 1:
            v.check("'Run it back' (round 1) loaded the SAME map as the match it ended", census[0]["map"] == in_match[0]["map"], {"before": in_match[0]["map"], "after": census[0]["map"]})
        # the guard call made before Enter must have happened in the lobby and installed (or found) the guard; the human must be alive when landed
        bad_g = [g for g in guard_runs if not g.get("alive") or g.get("guardCallBeforeEnter") not in ("on", "already") or g.get("phaseAtThatCall", "lobby") != "lobby"]
        v.check("guard: up in the lobby before every Enter (race fix) and the human is alive when landed, all %d rounds" % len(guard_runs), bool(guard_runs) and not bad_g, bad_g[:2] or guard_runs)
        v.check("0 console / page errors, 0 failed requests over the cycle", not probs, {"problems": probs[:6]})
    return C.run_gate("hud_cycle", body, args)


if __name__ == "__main__":
    sys.exit(main())
