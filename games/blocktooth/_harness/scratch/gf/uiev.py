#!/usr/bin/env python
"""Gate F: the evolution hint on draft cards (real Digit1 picks through level-up drafts) and the EVOLUTION READY toast."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url  # noqa: E402
HINTS = "() => [...document.querySelectorAll('[data-v2=\"evo-hint\"]')].filter(e => e.offsetParent).map(e => ({ text: e.textContent, card: e.closest('[data-card]')?.dataset.card, w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth }))"
TOASTS = r"() => [...document.querySelectorAll('[data-v2=\"toast\"]')].map(e => e.textContent.replace(/s+/g, ' ').trim())"
def main():
    ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--out", required=True); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); rep = {"drafts": []}
    sess = Session(a, "uiev"); sess.start()
    try:
        sess.goto(build_url(a.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=4242, noslate=1))
        sess.wait_bt(90); print("play", sess.wait_screen(("play",), 90), flush=True)
        sess.cheat("god", True); sess.cheat("noSpawns", True)
        shot = False
        for lv in range(2, 40):
            sess.cheat("mass", 100); time.sleep(0.9)
            n = 0
            while sess.screen() == "draft" and n < 6:
                time.sleep(0.5)
                h = sess.safe_js(HINTS) or []
                rep["drafts"].append({"lv": lv, "hints": h})
                if h and not shot:
                    sess.screenshot(os.path.join(a.out, "draft_hint.png")); shot = True; print("hint", h, flush=True)
                sess.press("Digit1"); time.sleep(0.6); n += 1
            if shot and lv >= 12: break
        time.sleep(1.0)
        ok = sess.cheat("evolveReady", "evo_full_block_bite"); print("evolveReady", ok, flush=True)
        seen = []
        for i in range(30):
            t = sess.safe_js(TOASTS) or []
            if any("EVOLUTION READY" in x for x in t):
                seen = t; time.sleep(0.35); sess.screenshot(os.path.join(a.out, "toast.png")); break
            time.sleep(0.2)
        rep["toast"] = seen
        # the next draft should carry the evolution (evoDraftChance) — record whether it was offered within 6 drafts
        offered = None
        for lv in range(40, 46):
            sess.cheat("mass", 100); time.sleep(0.9)
            if sess.screen() == "draft":
                ids = sess.safe_js("() => [...document.querySelectorAll('[data-card]')].filter(e => e.offsetParent).map(e => e.dataset.card)") or []
                if "evo_full_block_bite" in ids and offered is None:
                    offered = lv; sess.screenshot(os.path.join(a.out, "draft_evo.png"))
                while sess.screen() == "draft": sess.press("Digit1"); time.sleep(0.6)
        rep["evo_offered_at_lv"] = offered
    finally:
        sess.close()
    json.dump(rep, open(os.path.join(a.out, "uiev.json"), "w"), indent=1)
    print("drafts", len(rep["drafts"]), "with hints", sum(1 for d in rep["drafts"] if d["hints"]), "toast", rep["toast"], "evo offered at", rep["evo_offered_at_lv"])
if __name__ == "__main__": main()
