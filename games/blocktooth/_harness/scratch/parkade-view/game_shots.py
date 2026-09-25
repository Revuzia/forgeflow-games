#!/usr/bin/env python
"""L7 PARKADE-VIEW in-game captures (the §15.4 shot names), against the REAL game on a dev server.

    python _harness/scratch/parkade-view/game_shots.py --base http://localhost:5256/ --headless [--only ramp,till_open]

Starts a GRID-EAST run (MOLO, Size V via cheat.level), cheat.god + noSpawns, fields PARKADE-6 with
cheat.bossSpawn('parkade6'), then for each shot freezes the sim and steps it (__BT__.step, frozen only) until
the wanted state is reached (the boss phase is raised so P2/P3 attacks come up), lets the views settle for a
moment of real frames while frozen, and saves _shots/parkade_<name>.png (gameplay framing) plus a
manual-zoom close-up _shots/parkade_<name>_close.png (real '=' key presses). Prints the boss state per shot
and the renderer draw count from state().
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import ROOT, Session, add_common_args, build_url, ensure_play, dismiss_slate  # noqa: E402

OUT = os.path.join(ROOT, "_shots")

# name → (attack or state, attackT to stop at, min phase)
SHOTS = {
    "intro": ("intro", 1.3, 1),
    "ramp": ("rampLaunch", 0.45, 1),
    "barrier": ("barrierSwing", -0.05, 1),     # negative = seconds BEFORE the fire (windup end)
    "tow": ("towChain", 0.6, 2),               # 0.6 s after the fire: hooked (or reeling back)
    "deckdrop": ("deckDrop", 0.12, 2),         # just after the slam
    "collapse": ("levelCollapse", 0.75, 3),    # after beat A: pancaked
    "till_open": ("rampLaunch", 1.1, 1),
    "jammed": ("jammed", 1.2, 1),
}

STEP_JS = r"""
async ([mode, want, tStop, phase, maxTicks]) => {
  const B = window.__BT__; const W = B.world; if (!W) return { err: 'no world' };
  B.freeze(true);
  const tele = (tag) => W.telegraphs.find((t) => t.alive && t.owner === 'boss' && t.tag === tag);
  let n = 0, stag = false;
  for (; n < maxTicks; n++) {
    const b = W.boss; if (!b) return { err: 'no boss', n };
    if (mode === 'intro') { if (b.introT > 0 && b.introT < 4 - tStop) break; }
    else if (mode === 'jammed') {
      if (b.introT <= 0 && !stag) { b.staggerT = 5; b.attack = null; b.data.tillOpen = 5; stag = true; }
      if (stag && b.staggerT > 0 && b.staggerT < 5 - tStop) break;
    } else {
      if (b.introT <= 0 && b.phase < phase) b.phase = phase;
      if (b.attack === want) {
        if (tStop < 0) {
          const tg = tele(want);
          if (tg && tg.windup - tg.t <= -tStop) break;
          if (!tg && b.attackT > 0.2) { /* fired already: wait for the next one */ }
        } else if (want === 'towChain' || want === 'deckDrop' || want === 'levelCollapse') {
          const tag = want === 'levelCollapse' ? 'levelCollapse:A' : want;
          const tg = tele(tag);
          if (tg) b.data.__wu = tg.windup;
          const wu = b.data.__wu;
          if (wu !== undefined && b.attackT >= wu + tStop) break;
        } else if (b.attackT >= tStop) break;
      }
    }
    B.step(1);
  }
  const b = W.boss, T = W.titan;
  return { n, attack: b && b.attack, attackT: b && +b.attackT.toFixed(2), phase: b && b.phase, introT: b && +b.introT.toFixed(2),
    till: b && +(b.data.tillOpen || 0).toFixed(2), tow: b && b.data.tow, leash: !!T.leash, staggerT: b && +b.staggerT.toFixed(2),
    d: b && Math.round(Math.hypot(b.x - T.x, b.z - T.z)), H: +T.height.toFixed(1),
    shots: W.projectiles.filter((p) => p.alive && p.kind === 'carLob').length,
    tells: W.telegraphs.filter((t) => t.alive && t.owner === 'boss').map((t) => t.tag + ':' + t.t.toFixed(2) + '/' + t.windup.toFixed(2)) };
}
"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--level", type=int, default=35)
    ap.add_argument("--zoom", type=int, default=6, help="'=' presses for the close-up")
    a = ap.parse_args()
    a.no_serve = True
    only = [s for s in a.only.split(",") if s]
    names = [n for n in SHOTS if not only or n in only]
    rep = {}
    with Session(a, "parkade_shots") as s:
        for name in names:
            mode, tstop, phase = SHOTS[name]
            s.goto(build_url(a.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=a.seed))
            s.wait_bt(60)
            s.wait_screen(["slate", "play"], 60)
            dismiss_slate(s)
            ensure_play(s)
            s.cheat("god", True); s.cheat("noSpawns", True); s.cheat("killAll")
            s.cheat("level", a.level)
            time.sleep(0.6)
            ensure_play(s)
            ok, v = s.cheat("bossSpawn", "parkade6")
            if not ok:
                print("bossSpawn failed:", v); rep[name] = {"err": v}; continue
            want = "rampLaunch" if name == "till_open" else mode
            r = s.page.evaluate(STEP_JS, [mode, want, tstop, phase, 30 * 240])
            time.sleep(1.2)                        # frozen: the views keep idling, the pose settles
            p1 = os.path.join(OUT, "parkade_%s.png" % name)
            s.screenshot(p1)
            st = s.state() or {}
            r["draws"] = (st.get("render") or {}).get("draws") if isinstance(st.get("render"), dict) else st.get("draws")
            for _ in range(a.zoom):
                s.press("Equal", 40); time.sleep(0.08)
            time.sleep(1.4)
            p2 = os.path.join(OUT, "parkade_%s_close.png" % name)
            s.screenshot(p2)
            errs = [e for e in s.page_errors]
            r["pageErrors"] = len(errs)
            rep[name] = r
            print(name, json.dumps(r), flush=True)
        d = s.diagnostics()
        print("console errors:", len([c for c in s.console if c[0] == "error"]), "page errors:", len(s.page_errors))
    with open(os.path.join(OUT, "parkade_shots.json"), "w") as f:
        json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
