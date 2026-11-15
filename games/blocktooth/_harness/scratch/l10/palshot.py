#!/usr/bin/env python
"""L10 scratch: palette contact sheet (renderPortrait, 4 titans x canonical + 2 palettes) and an in-game
palette check (newRun with RunMeta.palette = 2 → the cinematic close-up shows the palette titan).

    python _harness/scratch/l10/palshot.py --base http://localhost:5260/ --no-serve
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from common import Session, add_common_args, build_url, diag_problems  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--out", default=os.path.join(HERE, "shots"))
    args = ap.parse_args()
    args.height = max(args.height, 960)
    os.makedirs(args.out, exist_ok=True)
    sess = Session(args, "l10pal")
    sess.start()
    res = {}
    try:
        sess.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=1))
        sess.wait_bt(90)
        sess.wait_screen(("slate", "play"), 90)
        res["sheet"] = sess.js("async () => await (await import('/_harness/scratch/l10/palsheet.ts')).sheet(220)")
        time.sleep(0.5)
        sess.screenshot(os.path.join(args.out, "palette_sheet.png"))
        sess.js("() => { const e = document.getElementById('l10-palsheet'); if (e) e.remove(); }")
        # in game: a run whose RunMeta.palette = 2 (NIGHT GARDEN for BRIARWICK)
        for titan, pal in (("briarwick", 2), ("voltkite", 2)):
            sess.js("async (o) => { await window.__BT__.newRun({ titan: o.t, biome: 'grideast', seed: 1, meta: { unlocked: [], perk: null, palette: o.p, reviveUsed: false } }); }", {"t": titan, "p": pal})
            t0 = time.time()
            shot = None
            while time.time() - t0 < 12:
                s = sess.state() or {}
                c = (s.get("v2") or {}).get("cine")
                if c and c.get("shot") == "closeup" and c.get("t", 0) >= 0.3:
                    shot = os.path.join(args.out, "palette_ingame_%s_%d.png" % (titan, pal))
                    sess.screenshot(shot)
                    break
                if s.get("screen") == "play":
                    shot = os.path.join(args.out, "palette_ingame_%s_%d_play.png" % (titan, pal))
                    sess.screenshot(shot)
                    break
                time.sleep(0.03)
            res["ingame_" + titan] = {"shot": shot, "meta": ((sess.state() or {}).get("v2") or {}).get("meta")}
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()
    print(json.dumps(res, indent=1))
    probs = diag_problems(diag)
    print("diag:", "clean" if not probs else probs)


if __name__ == "__main__":
    main()
