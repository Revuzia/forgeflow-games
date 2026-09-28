#!/usr/bin/env python
"""K2a GATE VIEW in-game captures (GATEKEEPERS §8.3 shot names), against the REAL game on a dev server.

    python _harness/scratch/k2a/game_shots.py --base http://localhost:5273/ --headless [--only stencil_tipped_1280,...]

Each shot: a fresh run (?autostart=1&dev=1), god + noSpawns + killAll, the titan grown to the Size the gatekeeper
holds (cheat.level: growToRank also unlocks the gates below it), the fight fielded through the REAL lock path
(cheat.gateLock(slot) → lockGate → the summon delay → spawnGate), then the sim is frozen and stepped
(__BT__.step, frozen only) until the wanted beat; the views keep idling while frozen, so the pose settles; a
screenshot at 1280×720 (the gameplay camera). Stagger shots reach the stagger through the real damage path:
the meter is set to 0.999 and the titan (placed just outside the keep-out) lands a real auto-attack.
Output: _shots/gates/gate_<name>.png + gate_shots.json (per shot: the boss state, events seen, draws).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import ROOT, Session, add_common_args, build_url, ensure_play, dismiss_slate, xp_to_next  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "gates")

GATE_OF = {"stencil": ("stencil1", 1, 7), "cordon": ("cordon2", 2, 16), "switch": ("switchboard5", 3, 27)}
# name → (gate key, mode, param, min phase, titan, biome)
SHOTS = {
    "stencil_intro": ("stencil", "intro", 1.4, 1, "molo", "grideast"),
    "stencil_stripe": ("stencil", "tell:stripeRun", 0.55, 1, "molo", "grideast"),
    "stencil_race": ("stencil", "race", 0.15, 1, "molo", "grideast"),
    "stencil_refill": ("stencil", "attack:refill", 1.0, 1, "molo", "grideast"),
    "stencil_buckets": ("stencil", "attack:paintBuckets", 0.55, 2, "molo", "grideast"),
    "stencil_tipped": ("stencil", "stagger", 0.8, 1, "molo", "grideast"),
    "stencil_tipped_1280": ("stencil", "stagger", 0.45, 1, "voltkite", "whitestacks"),
    "stencil_kill": ("stencil", "kill", 0.6, 1, "molo", "grideast"),
    "cordon_shove": ("cordon", "tell:shieldShove", 0.7, 1, "hearthback", "grideast"),
    "cordon_toss": ("cordon", "attack:sawhorseToss", 0.45, 1, "hearthback", "grideast"),
    "cordon_flank": ("cordon", "flank", 0.6, 1, "hearthback", "grideast"),
    "cordon_stalled": ("cordon", "stagger", 0.7, 1, "hearthback", "grideast"),
    "switch_callin": ("switch", "attack:callIn", 0.6, 1, "briarwick", "grideast"),
    "switch_hold": ("switch", "tell:holdMusic", 0.5, 2, "briarwick", "grideast"),
    "switch_relocate": ("switch", "mode:5", 1.2, 1, "briarwick", "grideast"),
    "switch_linesdown": ("switch", "stagger", 0.7, 1, "briarwick", "grideast"),
    "switch_kill": ("switch", "kill", 1.5, 1, "briarwick", "grideast"),
    "rematch_v": ("stencil", "rematch", 0.8, 1, "molo", "grideast"),
    "finale_s5": ("finale", "finale", 2.6, 1, "molo", "grideast"),
}

STEP_JS = r"""
async ([mode, param, phase, maxTicks]) => {
  const B = window.__BT__; const W = B.world; if (!W) return { err: 'no world' };
  B.freeze(true);
  const T = W.titan;
  const ev = {};
  const atk = {};
  const tally = () => { for (const e of W.events) ev[e.type] = (ev[e.type] || 0) + 1; const b = W.boss; if (b && b.attack) atk[b.attack] = (atk[b.attack] || 0) + 1; };
  const tell = (tag) => W.telegraphs.find((t) => t.alive && t.owner === 'boss' && !t.fired && t.tag.startsWith(tag));
  let n = 0, t0 = -1, hit = false;
  const [kind, arg] = mode.split(':');
  for (; n < maxTicks; n++) {
    const b = W.boss;
    if (!b) { B.step(1); tally(); continue; }
    if (b.introT <= 0 && b.alive && b.phase < phase) b.phase = phase;
    // keep the titan in a sensible spot: the attack we want needs the band (not a hunt)
    if (kind === 'intro') { if (b.introT > 0 && b.introT < 3 - param) break; }
    else if (kind === 'tell') {
      const tg = tell(arg); if (b.attack === arg && tg && tg.t >= tg.windup * param) break;
      if (kind === 'tell' && arg === 'holdMusic' && b.introT <= 0) { const dd = Math.hypot(T.x - b.x, T.z - b.z), H = b.data.H; if (dd > 2.0 * H) { const k = (dd - 1.95 * H) / dd; T.x -= (T.x - b.x) * k; T.z -= (T.z - b.z) * k; } }
      if (arg === 'shieldShove' && b.introT <= 0) { const H = b.data.H, a = b.heading; T.x = b.x + Math.sin(a) * 2.2 * H; T.z = b.z + Math.cos(a) * 2.2 * H; }
    }
    else if (kind === 'attack') { if (b.attack === arg && b.attackT >= param) break; if (arg === 'overheated' && b.introT <= 0 && b.attack !== 'overheated') { const H = b.data.H, a = b.heading; T.x = b.x + Math.sin(a) * 2.2 * H; T.z = b.z + Math.cos(a) * 2.2 * H; } }
    else if (kind === 'flank') {
      const H = b.data.H, a = b.heading;
      if (b.attack === 'overheated') { if (t0 < 0) t0 = W.t; T.x = b.x - Math.sin(a) * 2.0 * H; T.z = b.z - Math.cos(a) * 2.0 * H; if (W.t - t0 >= param) break; }
      else if (b.introT <= 0 && b.attack !== 'shieldShove') { T.x = b.x + Math.sin(a) * 2.2 * H; T.z = b.z + Math.cos(a) * 2.2 * H; }
    }
    else if (kind === 'race') { if ((b.data.raceT || 0) > 0 && (b.data.raceT || 0) <= 0.4 - param) break; }
    else if (kind === 'mode') {
      if ((b.data.mode || 0) === +arg) { if (t0 < 0) t0 = W.t; if (W.t - t0 >= param) break; }
      else if (b.introT <= 0) { const H = b.data.H, a = Math.atan2(T.x - b.x, T.z - b.z); T.x = b.x + Math.sin(a) * 2.0 * H; T.z = b.z + Math.cos(a) * 2.0 * H; }
    }
    else if (kind === 'stagger') {
      if (b.staggerT > 0) { if (t0 < 0) t0 = W.t; if (W.t - t0 >= param) break; }
      else if (b.introT <= 0 && W.t > 1) {
        b.meter = Math.max(b.meter, 0.999); b.attack = null;
        const H = b.data.H, a = Math.atan2(T.x - b.x, T.z - b.z);
        const r = b.id === 'stencil1' ? 1.2 : 1.75;
        T.x = b.x + Math.sin(a) * r * H; T.z = b.z + Math.cos(a) * r * H;
        hit = true;
      }
    }
    else if (kind === 'near') { if (b.introT <= 0 && Math.hypot(T.x - b.x, T.z - b.z) <= param * b.data.H) break; }
    else if (kind === 'kill' || kind === 'rematch' || kind === 'finale') break;
    B.step(1); tally();
  }
  const b = W.boss;
  return { n, ev, atk, hit, id: b && b.id, alive: b && b.alive, attack: b && b.attack, attackT: b && +b.attackT.toFixed(2), phase: b && b.phase,
    introT: b && +b.introT.toFixed(2), staggerT: b && +b.staggerT.toFixed(2), meter: b && +b.meter.toFixed(3), H: b && +(b.data.H || 0).toFixed(2),
    mode: b && b.data.mode, raceT: b && b.data.raceT, drumOpen: b && b.data.drumOpen, weak: b && b.data.weakMask,
    d: b && +(Math.hypot(b.x - T.x, b.z - T.z) / Math.max(1, T.height)).toFixed(2), rank: T.rank, Ht: +T.height.toFixed(2),
    tells: W.telegraphs.filter((t) => t.alive && t.owner === 'boss').map((t) => t.tag + ':' + t.t.toFixed(2) + '/' + t.windup.toFixed(2)),
    shots: W.projectiles.filter((p) => p.alive && p.owner === 'boss').length, hz: W.hazards.filter((h) => h.alive).length };
}
"""


def field(s, key, titan, biome, seed):
    gid, slot, lv = GATE_OF[key]
    s.goto(build_url(s.args.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed))
    s.wait_bt(60)
    s.wait_screen(["slate", "play"], 60)
    dismiss_slate(s)
    ensure_play(s)
    s.cheat("god", True); s.cheat("noSpawns", True); s.cheat("killAll")
    s.cheat("level", lv - 1)         # one level short of the gate at the Size below it (growToRank opens the gates under it)
    time.sleep(0.4)
    ensure_play(s)
    # the real path: XP to the gate level → grow() holds the Size and locks the gate (gateLocked); the ceiling H
    s.cheat("xp", xp_to_next(lv - 1) + 5)
    time.sleep(0.3)
    ensure_play(s)                   # the level-up's draft screen (picked through its own path)
    pend = s.js("() => window.__BT__.world.gates.pending")
    ok, v = (True, pend) if pend == slot else s.cheat("gateLock", slot)
    # noSpawns also holds a pending gate (meta/gates.ts), so lift it for the arrival, then clear the street again
    s.cheat("noSpawns", False)
    t_end = time.time() + 12
    while time.time() < t_end:
        bb = s.js("() => { const b = window.__BT__.world.boss; return b ? b.id : null; }")
        if bb == gid:
            break
        time.sleep(0.15)
    s.cheat("noSpawns", True); s.cheat("killAll")
    return ok, v, gid


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    a.no_serve = True
    os.makedirs(OUT, exist_ok=True)
    only = [x for x in a.only.split(",") if x]
    names = [n for n in SHOTS if not only or n in only]
    rep = {}
    with Session(a, "k2a_gate_shots") as s:
        for name in names:
            key, mode, param, phase, titan, biome = SHOTS[name]
            r = {}
            try:
                if key == "finale":
                    s.goto(build_url(a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=a.seed))
                    s.wait_bt(60); s.wait_screen(["slate", "play"], 60); dismiss_slate(s); ensure_play(s)
                    s.cheat("god", True); s.cheat("noSpawns", True)
                    s.cheat("level", 35); time.sleep(0.5); ensure_play(s)
                    s.cheat("gatesOpen", 3)
                    ok, v = s.cheat("bossSpawn", "parkade6")
                    time.sleep(1.0)
                    s.js("() => { const b = window.__BT__.world.boss; if (b) b.introT = 0; }")
                    ok, v = s.cheat("gateKill")
                    r["kill"] = v
                    time.sleep(param)                   # real frames: the finale runs (banner, surge, dust)
                    r.update(s.js("() => { const W = window.__BT__.world; const c = window.__BT__; let st = null; try { st = c.state(); } catch (e) {} const cv = c.debugCore && c.debugCore.scene.getObjectByName('civilians'); const cs = cv && cv.userData.civState; const dbg = cv && cv.userData.civ; return { surgePlaced: cs ? cs.view.surgePlaced : null, civLive: dbg ? dbg.live : null, fleeing: dbg ? dbg.fleeing : null, finaleT: W.gates.finaleT, rank: W.titan.rank, H: W.titan.height, banner: !!document.querySelector('[data-alert]') || document.body.innerText.includes('THE CITY GOT SMALLER'), screen: st && st.screen }; }") or {})
                elif mode == "rematch":
                    s.goto(build_url(a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=a.seed))
                    s.wait_bt(60); s.wait_screen(["slate", "play"], 60); dismiss_slate(s); ensure_play(s)
                    s.cheat("god", True); s.cheat("noSpawns", True); s.cheat("killAll")
                    s.cheat("level", 40); time.sleep(0.5); ensure_play(s)
                    s.cheat("gatesOpen", 4)
                    s.js("() => { const W = window.__BT__.world; if (W.boss && W.boss.alive) { W.boss.alive = false; } W.boss = null; }")
                    ok, v = s.cheat("bossSpawn", "stencil1")
                    r["spawn"] = v
                    r.update(s.page.evaluate(STEP_JS, ["near", 3.2, 1, 30 * 40]))
                else:
                    ok, v, gid = field(s, key, titan, biome, a.seed)
                    r["lock"] = v
                    # the summon delay + intro run in real time → then freeze + step to the beat
                    t_end = time.time() + 12
                    while time.time() < t_end:
                        b = s.js("() => { const b = window.__BT__.world.boss; return b ? { id: b.id, introT: b.introT } : null; }")
                        if b and b.get("id") == gid:
                            break
                        time.sleep(0.2)
                    if mode == "kill":
                        s.page.evaluate(STEP_JS, ["intro", 2.9, 1, 30 * 10])
                        s.js("() => window.__BT__.freeze(false)")
                        s.js("() => { const b = window.__BT__.world.boss; if (b) b.introT = 0; }")
                        ok, v = s.cheat("gateKill")
                        r["kill"] = v
                        time.sleep(param)
                        r.update(s.js("() => { const W = window.__BT__.world; return { rank: W.titan.rank, H: W.titan.height, unlocked: W.gates.unlocked }; }") or {})
                    elif mode == "stagger":
                        # fx reads events only on unfrozen frames: reach the stagger in REAL time (the meter at 0.999,
                        # the titan just outside the keep-out, a real auto-attack), then capture while the word is up
                        s.page.evaluate(STEP_JS, ["intro", 2.99, 1, 30 * 10])
                        s.js("() => window.__BT__.freeze(false)")
                        ensure_play(s)
                        t_end = time.time() + 15
                        while time.time() < t_end:
                            st = s.js("""() => { const W = window.__BT__.world, b = W.boss, T = W.titan; if (!b) return null;
                              if (b.staggerT > 0) return { stag: b.staggerT, t: W.t };
                              if (b.introT <= 0) { b.meter = Math.max(b.meter, 0.99999); b.attack = null;
                                const H = b.data.H, a = b.id === 'cordon2' ? b.heading + Math.PI : Math.atan2(T.x - b.x, T.z - b.z), r = b.id === 'stencil1' ? 1.2 : 1.75;
                                T.x = b.x + Math.sin(a) * r * H; T.z = b.z + Math.cos(a) * r * H; }
                              return { stag: 0, intro: b.introT }; }""")
                            if st and st.get("stag", 0) > 0:
                                break
                            r["poll"] = st
                            r["screen"] = s.screen()
                            if r["screen"] != "play":
                                ensure_play(s)
                            time.sleep(0.05)
                        if s.screen() != "play":
                            ensure_play(s)
                        time.sleep(param)
                        if s.screen() != "play":
                            ensure_play(s)
                        s.js("() => window.__BT__.freeze(true)")
                        r.update(s.js("() => { const b = window.__BT__.world.boss; return b ? { staggerT: b.staggerT, drumOpen: b.data.drumOpen, id: b.id } : null; }") or {})
                    else:
                        r.update(s.page.evaluate(STEP_JS, [mode, param, phase, 30 * 240]))
                        # frozen: the views keep idling, the pose settles (a stagger shot keeps its 1.35 s word in frame)
                        time.sleep(0.3 if mode == "stagger" else 1.0)
                st = s.state() or {}
                r["draws"] = (st.get("render") or {}).get("draws") if isinstance(st.get("render"), dict) else st.get("draws")
                p1 = os.path.join(OUT, "gate_%s.png" % name)
                s.screenshot(p1)
                r["pageErrors"] = len(s.page_errors)
                r["consoleErrors"] = len([c for c in s.console if c[0] == "error"])
            except Exception as e:                     # keep going: report the failure
                r["err"] = str(e).splitlines()[0][:300]
            rep[name] = r
            print(name, json.dumps(r), flush=True)
            try:
                s.js("() => window.__BT__.freeze(false)")
            except Exception:
                pass
        print("console errors:", len([c for c in s.console if c[0] == "error"]), "page errors:", len(s.page_errors))
        for c in [c for c in s.console if c[0] == "error"][:10]:
            print("  console:", c[1][:200])
        for e in s.page_errors[:10]:
            print("  page:", str(e)[:200])
    with open(os.path.join(OUT, "gate_shots.json"), "w") as f:
        json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
