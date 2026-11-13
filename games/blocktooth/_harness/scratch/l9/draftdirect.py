#!/usr/bin/env python
"""L9 scratch: open a SECOND DraftScreen instance directly (vite module import) over a live, frozen run to
preview the card states a live draft rarely shows together: an evolution card, a HELD card and a NEW
ribbon (DraftCtx.newIds). Also opens the pause SETTINGS panel with real keys (REDUCE MOTION + OPENING rows).

    python _harness/scratch/l9/draftdirect.py --base http://localhost:5259/ --no-serve --headless
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import ROOT, Session, add_common_args, build_url  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "scratch_l9")

OPEN_JS = r"""
async () => {
  const { DraftScreen } = await import('/src/ui/draft.ts');
  const root = document.querySelector('.bt-draft').parentElement;
  const w = window.__H_W__();
  const d = new DraftScreen(root, null);
  window.__L9D__ = d;
  const offer = ['seismic_retrofit', 'u_block_captain', 'evo_full_block_bite'];
  window.__L9P__ = d.open(w, offer, { rerollsLeft: 1, banishLeft: 1, lockLeft: 0, locked: 'seismic_retrofit', newIds: ['u_block_captain'] });
  await new Promise((r) => setTimeout(r, 900));
  const cards = [...document.querySelectorAll('.bt-draft:not(.bt-hidden) .bt-dossier')];
  return cards.map((c) => ({ id: c.dataset.card, held: c.classList.contains('is-held'), ribbon: !!c.querySelector('.bt2-ribbon'),
    evo: c.classList.contains('evo'), stamp: (c.querySelector('.bt-dossier-stamp') || {}).textContent }));
}
"""


def main():
    ap = add_common_args(argparse.ArgumentParser())
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    bad = []
    with Session(args, "l9draft") as S:
        S.goto(build_url(args.base, dev=1, noslate=1, autostart=1, titan="molo", biome="grideast", meta="full", seed=1337))
        S.wait_bt()
        ok, sc = S.wait_screen("play", 90)
        print("play:", ok, sc)
        S.cheat("god", True)
        S.cheat("noSpawns", True)
        S.cheat("evolveReady", "evo_full_block_bite")
        time.sleep(0.5)
        S.bt_call("freeze", True)
        cards = S.js(OPEN_JS)
        print("cards:", cards)
        want = cards and cards[0]["held"] and cards[1]["ribbon"] and cards[2]["evo"] and cards[2]["stamp"] == "RESTRUCTURED"
        print(("PASS" if want else "FAIL"), "direct draft: HELD / NEW ribbon / RESTRUCTURED evo card")
        if not want:
            bad.append("direct draft states")
        S.screenshot(os.path.join(OUT, "draft_states_%d.png" % args.width))
        # a LOCK press on a card other than the held one with lockLeft 0 moves the hold (allowed); C on the held
        # one resolves {lock} (unlock) — check the resolve value
        time.sleep(0.7)
        S.press("KeyC")
        time.sleep(0.4)
        res = S.js("async () => await Promise.race([window.__L9P__, new Promise((r) => setTimeout(() => r('pending'), 800))])")
        ok2 = isinstance(res, dict) and res.get("lock") == "seismic_retrofit"
        print(("PASS" if ok2 else "FAIL"), "C on the held card resolves {lock: id} (unlock toggle):", res)
        if not ok2:
            bad.append("lock resolve")
        S.js("() => { const l = document.querySelectorAll('.bt-draft'); if (l.length > 1) l[l.length - 1].remove(); }")
        S.bt_call("freeze", False)
        # pause → SETTINGS (real keys): the two v2 rows exist and toggle
        S.press("Escape")
        ok, sc = S.wait_screen("pause", 8)
        time.sleep(0.4)
        S.press("ArrowDown")
        time.sleep(0.15)
        S.press("Enter")
        time.sleep(0.6)
        rows = S.js("() => [...document.querySelectorAll('.bt-settings:not(.bt-hidden) .bt-set-row .bt-set-lbl')].map(e => e.textContent)")
        print("settings rows:", rows)
        for _ in range(7):
            S.press("ArrowDown"); time.sleep(0.08)
        S.press("ArrowLeft"); time.sleep(0.15)     # OPENING FULL → SHORT
        opening = S.js("() => { const r = document.querySelector('.bt-settings .k-cinematic'); return [...r.querySelectorAll('.bt-set-opt')].findIndex(o => o.classList.contains('on')); }")
        S.press("ArrowUp"); time.sleep(0.1)
        S.press("Enter"); time.sleep(0.15)          # REDUCE MOTION toggle
        rm = S.js("() => { const r = document.querySelector('.bt-settings .k-reduceMotion'); return [...r.querySelectorAll('.bt-set-opt')].findIndex(o => o.classList.contains('on')); }")
        S.screenshot(os.path.join(OUT, "settings_v2_%d.png" % args.width))
        ok3 = rows and "REDUCE MOTION" in rows and "OPENING" in rows and opening == 1 and rm == 1
        print(("PASS" if ok3 else "FAIL"), "settings: REDUCE MOTION + OPENING rows, ← sets SHORT, Enter toggles reduce motion:", opening, rm)
        if not ok3:
            bad.append("settings rows")
        S.press("Escape"); time.sleep(0.5)
        S.press("Escape"); time.sleep(0.5)
        errs = list(S.page_errors) + list(S.window_errors())
        cerr = [t for (k, t) in S.console if k == "error"]
        print(("PASS" if not errs and not cerr else "FAIL"), "no page/console errors", errs[:2], cerr[:2])
        if errs or cerr:
            bad.append("errors")
    print("DRAFTDIRECT:", "OK" if not bad else "FAILED " + ", ".join(bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
