#!/usr/bin/env python
"""Lane dead-pose + tabloid probe (F18 / time rounding / A2 personal bests).

    python _harness/scratch/deadpose/endprobe.py --base http://localhost:5211/ --titan molo --biome grideast \
        --mode dead --runs 2 --headless

Real run, real sim death / clear; cheats (?dev=1) ONLY to reach the end state quickly:
  dead  : god off, titan hp set low, armour spawned — the enemies land the killing blow.
  clear : Size V + god, boss spawned; after its intro the boss is finished through damageBoss().
During the 2.5 s aftermath the page is screenshotted at several instants (the pose sequence),
then the tabloid (the paper) is screenshotted and its text is dumped. --runs 2 retries with key
'1' (real key) and plays the second run longer, so records exist BEFORE it and can fall.
Outputs: _shots/deadpose/<tag>_*.png + a JSON line per run on stdout.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, ensure_play, SHOTS  # noqa: E402

OUT = os.path.join(SHOTS, "deadpose")

PAPER_JS = r"""() => {
  const P = document.querySelector('.bt-tabloid');
  if (!P) return null;
  const q = (s) => Array.from(P.querySelectorAll(s)).map(e => e.textContent.replace(/\s+/g, ' ').trim());
  return { stats: q('.bt-np-stat'), book: q('.bt-np-record-row'), note: q('.bt-np-record-note'), stamp: q('.bt-np-stamp'),
           news: q('.bt-np-new'), sub: q('.bt-np-subhead') };
}"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--mode", default="dead", choices=("dead", "clear"))
    ap.add_argument("--rank", type=int, default=1)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--quiet", action="store_true", help="dead: clear the street and land one hostile shockwave (pose study)")
    a = ap.parse_args()
    tag = a.tag or "%s_%s_%s" % (a.mode, a.titan, a.biome)
    os.makedirs(OUT, exist_ok=True)
    with Session(a, "endprobe") as S:
        S.goto(build_url(a.base, autostart=1, dev=1, noslate=1, titan=a.titan, biome=a.biome, seed=a.seed))
        S.wait_bt(60)
        for run in range(a.runs):
            ok, scr = S.wait_screen(("play", "draft"), 90)
            ensure_play(S, 15)
            S.cheat("noSpawns", True)
            S.cheat("killAll")
            want_rank = 4 if a.mode == "clear" else a.rank
            if want_rank > 0:
                S.cheat("rank", want_rank)
                time.sleep(1.5)
                ensure_play(S, 10)
            # second run: stay on air longer + eat more, so records fall
            live_s = 6 + 14 * run
            S.cheat("god", True)
            t0 = time.time()
            keys = ["KeyW", "KeyD", "KeyS", "KeyA"]
            i = 0
            while time.time() - t0 < live_s:
                if S.screen() == "draft":
                    S.press("Digit1"); time.sleep(0.4); continue
                S.hold([keys[i % 4]]); i += 1
                time.sleep(0.9)
            S.release_all()
            ensure_play(S, 10)
            if a.mode == "dead" and a.quiet:
                S.cheat("god", False)
                S.cheat("killAll")
                S.js("async () => { const m = await import('/src/combat/damage.ts'); const W = __BT__.world; const T = W.titan;"
                     " m.damageTitanArea(W, { k: 'circle', x: T.x, z: T.z, r: T.radius * 3 }, 1e9, 'shockwave'); }")
            elif a.mode == "dead":
                S.cheat("god", False)
                S.cheat("noSpawns", False)
                S.js("() => { const T = __BT__.world.titan; T.hp = Math.min(T.hp, T.maxHp * 0.02); }")
                for kind, n in (("tank", 8), ("walker", 3), ("buggy", 8), ("drone", 8)):
                    S.cheat("spawn", kind, n)
            else:
                S.cheat("boss")
                okb = False
                for _ in range(80):
                    b = S.js("() => { const b = __BT__.world.boss; return b ? { intro: b.introT, alive: b.alive } : null; }")
                    if b and b["intro"] <= 0:
                        okb = True; break
                    if S.screen() == "draft":
                        S.press("Digit1")
                    time.sleep(0.25)
                print("boss ready:", okb)
                ensure_play(S, 10)
                S.js("async () => { const m = await import('/src/ai/bosses/index.ts'); const W = __BT__.world;"
                     " m.damageBoss(W, 0, 1e12, { src: 'titan', kind: 'bite' }); }")
            # wait for the run end, then shoot the aftermath
            tEnd = None
            for _ in range(600):
                r = S.js("() => __BT__.world.run.result")
                if r:
                    tEnd = time.time(); break
                if S.screen() == "draft":
                    S.press("Digit1")
                time.sleep(0.05)
            if tEnd is None:
                print("RUN DID NOT END; screen=", S.screen()); return 1
            rt = "%s_r%d" % (tag, run + 1)
            for at in (0.25, 0.6, 0.95, 1.3, 1.8, 2.3):
                dtw = tEnd + at - time.time()
                if dtw > 0:
                    time.sleep(dtw)
                if S.screen() != "play":
                    break
                S.screenshot(os.path.join(OUT, "%s_after_%04d.png" % (rt, int(at * 1000))))
            ok, scr = S.wait_screen(("end",), 15)
            time.sleep(3.2)
            S.screenshot(os.path.join(OUT, "%s_tabloid.png" % rt))
            st = S.state() or {}
            paper = S.js(PAPER_JS)
            w = S.js("() => { const W = __BT__.world; return { t: W.t, endT: W.run.endT, result: W.run.result }; }")
            best = S.js("() => { try { return JSON.parse(localStorage.getItem('blocktooth.best.v1')); } catch (e) { return String(e); } }")
            print(json.dumps({"run": run + 1, "screen": st.get("screen"), "world": w, "paper": paper, "best": best}, indent=1))
            # the photo itself, full size
            S.js("() => { const i = document.querySelector('.bt-np-img'); window.__PHOTO__ = i ? i.src : ''; }")
            photo = S.js("() => window.__PHOTO__")
            if photo and photo.startswith("data:image"):
                import base64
                with open(os.path.join(OUT, "%s_photo.jpg" % rt), "wb") as fh:
                    fh.write(base64.b64decode(photo.split(",", 1)[1]))
            if run + 1 < a.runs:
                S.press("Digit1")          # RETRY (real key)
                time.sleep(1.0)
        d = S.diagnostics()
        errs = (d.get("consoleErrors") or []) + (d.get("pageErrors") or []) + (d.get("shader") or []) + (d.get("windowErrors") or [])
        print("errors:", json.dumps(errs[:10]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
