#!/usr/bin/env python
"""loadbar - LC-23 loading bar + LC-82 Quick Match copy + LC-19 mode-aware challenges (P1-D, in the base): F:/lc_p1/P1-D/p1d_quick.py promoted
to a gate (P2-F port). One Chrome at 1280x720, the REAL QUICK MATCH card click (the lobby is not skipped by the harness: the player's wait).

    python _harness/p23/loadbar.py --disk
    python _harness/p23/loadbar.py --rev e10b9836               # control: the snapshot before P1 (bar 84 % -> 15 %, DEPLOY copy) - MUST FAIL
    python _harness/p23/loadbar.py --disk --plant bar-dip       # the fill forced to 2 % for 0.8 s mid-load - MUST FAIL

Rows: never-backwards (the fill sampled at 4 Hz from the click to the lobby never decreases, >= 8 samples) - card (the loading card names the
map and QUICK MATCH and shows a tip) - fight-copy (Quick announces FIGHT / GROUND START, never DEPLOY) - quick-challenges (120 HUD builds with
a forced daily 'survive8': no survive5 / survive8 offered in a 239 s storm) - errors. Screenshots: _reports/p23_shots/loadbar_*.png.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {"bar-dip": "bar-dip"}
SAMPLER_JS = r"""() => {
  window.__LB__ = { s: [], texts: new Set(), tips: new Set(), maps: new Set() };
  const scale = () => { const f = document.querySelector('[data-lc="loadfill"]'); if (!f) return null; const m = /scaleX\(([0-9.]+)\)/.exec(f.style.transform || ''); return m ? +m[1] : null; };
  window.__LB__.iv = setInterval(() => {
    const v = scale(), W = window.__LC__ && window.__LC__.W;
    window.__LB__.s.push([Math.round(performance.now()), v, W ? W.phase : null]);
    const box = document.querySelector('[data-lc="loadbox"]'); if (box) window.__LB__.texts.add(box.innerText.replace(/\s+/g, ' ').slice(0, 200));
    const tip = document.querySelector('[data-lc="loadtip"]'); if (tip) window.__LB__.tips.add(tip.textContent);
    const mp = document.querySelector('[data-lc="loadmap"]'); if (mp) window.__LB__.maps.add(mp.textContent);
  }, 250);
  return true; }"""
# the dip is anchored on the BAR, not on the clock (fix round: gateA 10-27 the plant did not bite - the old dip ran 1.5-2.3 s after the click,
# before / while the integrated tree's loading card painted, so no sample saw it): once the fill reads >= 0.15 it is forced to 2 % for 0.8 s,
# re-written every 5 ms so the game's own writes in between cannot win a 4 Hz sample
DIP_JS = r"""() => { let t0 = null; const iv = setInterval(() => { const f = document.querySelector('[data-lc="loadfill"]'); if (!f) return;
  if (t0 === null) { const m = /scaleX\(([0-9.]+)\)/.exec(f.style.transform || ''); if (!m || +m[1] < 0.15) return; t0 = performance.now(); }
  f.style.transform = 'scaleX(0.02)'; if (performance.now() - t0 > 800) clearInterval(iv); }, 5); return true; }"""
CARD_JS = r"""(name) => { const c = [...document.querySelectorAll('.lc-mode-card')].find((x) => x.offsetParent && x.textContent.includes(name)); if (!c) return null;
  c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""
HUDMOD_JS = r"""async () => { if (window.__HUDMOD__) return true;
  const sc = [...document.scripts].find((x) => /ffg_boot3d\.js/.test(x.src)); if (!sc) return false;
  window.__HUDMOD__ = await import(new URL('royale/hud.js' + new URL(sc.src).search, sc.src).href); return true; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)
    today = datetime.date.today().strftime("%Y-%m-%d")
    daily = json.dumps({"day": today, "ids": ["survive8", "elim", "dmg"], "done": {}, "firstWin": False})
    tag = "rev_" + args.rev if args.rev else ("plant_" + args.plant if args.plant else "disk")

    def body(v):
        init = "try { localStorage.setItem('lc_seen_intro', '1'); localStorage.setItem('lc_daily', %s); } catch (e) {}" % json.dumps(daily)
        with C.Session(args, "p23_loadbar", viewport={"width": 1280, "height": 720}, init_scripts=[init]) as s:
            s.boot()
            s.sleep(2.0)
            L.dismiss_cards(s)
            xy = s.js(CARD_JS, "QUICK MATCH")
            if not xy:
                v.check("the QUICK MATCH card is on the menu", False, None)
                return
            s.js(SAMPLER_JS)
            if args.plant == "bar-dip":
                s.js(DIP_JS)
            s.page.mouse.click(xy[0], xy[1])
            s.sleep(3.0)
            s.screenshot(os.path.join(shots, "loadbar_%s_3s.png" % tag))
            t = s.wait_js("() => { const W = window.__LC__.W; return W.phase === 'lobby' && !document.querySelector('[data-lc=\"loadfill\"]'); }", args.load_timeout, 0.25)
            v.data["toLobby_s"] = t
            s.sleep(0.5)
            lb = s.js("() => { clearInterval(window.__LB__.iv); return { s: window.__LB__.s, texts: [...window.__LB__.texts], tips: [...window.__LB__.tips], maps: [...window.__LB__.maps] }; }")
            vals = [x[1] for x in lb["s"] if x[1] is not None]
            drops = [(i, vals[i - 1], vals[i]) for i in range(1, len(vals)) if vals[i] < vals[i - 1] - 1e-9]
            v.check("never-backwards (the fill at 4 Hz never decreases, >= 8 samples)", t is not None and len(vals) >= 8 and not drops,
                    {"samples": len(vals), "drops": drops[:5], "first": vals[:5], "last": vals[-3:], "toLobby_s": t}, "0 drops")
            v.check("card (map name + QUICK MATCH + a tip on the loading card)", any("QUICK MATCH" in m for m in lb["maps"]) and bool(lb["tips"]),
                    {"maps": lb["maps"], "tips": lb["tips"][:3]}, "present")
            for _ in range(3):
                s.page.keyboard.press("Enter")
                if s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 5, 0.1) is not None:
                    break
            s.wait_js("() => [...document.querySelectorAll('[data-lc=\"ann\"] div')].some((e) => e.textContent.length > 0)", 8, 0.1)
            ann = s.safe_js("() => { const e = document.querySelector('[data-lc=\"ann\"]'); return e ? e.innerText : ''; }", default="")
            s.screenshot(os.path.join(shots, "loadbar_%s_hud.png" % tag))
            v.check("fight-copy (Quick: FIGHT / GROUND START, never DEPLOY)", "FIGHT" in ann and "DEPLOY" not in ann and "GROUND START" in ann, {"ann": ann}, "FIGHT, GROUND START")
            s.js(HUDMOD_JS)
            many = s.js(r"""() => { const W = window.__LC__.W, H = window.__HUDMOD__; const seen = {};
                for (let i = 0; i < 120; i++) { H.showHUD(W); for (const c of (W._challenges || [])) seen[c.id] = (seen[c.id] || 0) + 1; }
                return seen; }""")
            bad = {k: n for k, n in many.items() if k in ("survive5", "survive8")}
            v.check("quick-challenges (120 HUD builds, forced daily survive8: no survive5 / survive8 in Quick)", not bad and "survive" in many, {"seen": many}, "none")
            L.errors_row(v, s)
    return C.run_gate("p23_loadbar", body, args)


if __name__ == "__main__":
    sys.exit(main())
