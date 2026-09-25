#!/usr/bin/env python
"""L9 SCREENS scratch preview + real-key checks (FEATURES_V2 §7.5, §8.4, §9, §13.1).

    python _harness/scratch/l9/l9shots.py --base http://localhost:5259/ --no-serve [--only menus,draft,pause,tabloid] [--width 1920 --height 1080]

Menus are driven by REAL keys (G, Esc, arrows, Enter); cheats (?dev=1) only set up state for the draft /
pause / tabloid. A crafted profile + bests are written to localStorage first (so FILED rows, unlocked and
locked palettes / perks and YOUR BEST ON FILE all have something to show). Shots → _shots/scratch_l9/.
Prints one PASS/FAIL line per check; exit 1 if any check failed.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import ROOT, Session, add_common_args, build_url  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "scratch_l9")
NOW = int(time.time() * 1000)
PROFILE = {
    "v": 1,
    "done": {"g_first_broadcast": NOW - 86400000 * 3, "g_zoning_change": NOW - 86400000 * 2, "g_city_got_smaller": NOW - 86400000,
             "g_molo_curbside_pickup": NOW - 3600000, "g_paperwork": NOW - 7200000, "g_molo_bite_sized": NOW - 5000000},
    "best": {"g_crowd_control": 412, "g_live_coverage": 7, "g_molo_speed_bump": 188, "g_urban_renewal": 19, "g_lw_early_closing": 611},
    "life": {"runs": 6, "clears": 1, "banishes": 5, "evolutions": 0,
             "clearedBy": {"molo": ["grideast"], "voltkite": [], "hearthback": [], "briarwick": []}, "bossKills": {"parkade6": 1}},
    "perk": "perk_red_tape", "palette": {"molo": 1, "voltkite": 0, "hearthback": 0, "briarwick": 0},
    "cineSeen": {}, "newUnlocks": ["u_block_captain", "u_sidewalk_sale"],
}
BESTS = {
    "molo.grideast.level": 31, "molo.grideast.peakRank": 4, "molo.grideast.clearS": 552.4, "molo.grideast.survivedS": 552,
    "molo.grideast.tonnage": 81234, "molo.grideast.endlessS": 204, "molo.grideast.endlessScore": 48210,
    "molo.lockwater.level": 18, "molo.lockwater.peakRank": 2, "molo.lockwater.survivedS": 301,
    "voltkite.whitestacks.level": 12, "voltkite.whitestacks.peakRank": 1, "voltkite.whitestacks.survivedS": 190,
}

SEED_JS = """([p, b]) => { try { localStorage.setItem('blocktooth.profile.v1', JSON.stringify(p));
  localStorage.setItem('blocktooth.best.v1', JSON.stringify(b)); return true; } catch (e) { return String(e); } }"""

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (("  · " + str(detail)) if detail else ""), flush=True)


def shot(S, name):
    p = os.path.join(OUT, "%s_%d.png" % (name, S.args.width))
    S.screenshot(p)
    print("  shot", os.path.relpath(p, ROOT), flush=True)


def dom(S, sel, prop="count"):
    if prop == "count":
        return S.safe_js("(s) => document.querySelectorAll(s).length", sel, default=-1)
    if prop == "visible":
        return S.safe_js("(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect();"
                         " return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }", sel, default=False)
    return S.safe_js("(s) => { const e = document.querySelector(s); return e ? e.textContent : null; }", sel, default=None)


def goals_up(S):
    return dom(S, ".bt2-goals:not(.bt-hidden)", "visible")


def menus(S):
    S.goto(build_url(S.args.base, dev=1, noslate=1))
    S.wait_bt()
    S.js(SEED_JS, [PROFILE, BESTS])
    S.goto(build_url(S.args.base, dev=1, noslate=1))
    S.wait_bt()
    ok, sc = S.wait_screen("title", 60)
    check("title up", ok, sc)
    time.sleep(0.6)
    check("title GOALS & RECORDS chip visible", dom(S, ".bt-title .bt2-goals-chip", "visible"))
    shot(S, "title")
    # real G → goals; Esc → title
    S.press("KeyG")
    time.sleep(0.5)
    check("title G → goals screen", goals_up(S), S.screen())
    check("goals header count", "GOALS FILED" in (dom(S, ".bt2-goals-count", "text") or ""), dom(S, ".bt2-goals-count", "text"))
    check("goals rows (GENERAL = 15)", dom(S, ".bt2-goals:not(.bt-hidden) .bt2-grow") == 15, dom(S, ".bt2-goals .bt2-grow"))
    check("FILED stamps on done rows", dom(S, ".bt2-goals .bt2-grow.done .bt2-stamp.filed") >= 3)
    shot(S, "goals_general")
    S.press("ArrowRight")
    time.sleep(0.35)
    check("→ MOLO tab (4 rows)", dom(S, ".bt2-goals .bt2-grow") == 4, dom(S, ".bt2-goals .bt2-tab.on", "text"))
    S.press("ArrowDown"); S.press("ArrowDown")
    time.sleep(0.3)
    shot(S, "goals_molo")
    for _ in range(4):
        S.press("ArrowRight"); time.sleep(0.15)
    time.sleep(0.3)
    check("CITIES tab (9 rows)", dom(S, ".bt2-goals .bt2-grow") == 9, dom(S, ".bt2-goals .bt2-tab.on", "text"))
    shot(S, "goals_cities")
    S.press("ArrowRight")
    time.sleep(0.35)
    check("RECORDS tab 4×3 table", dom(S, ".bt2-goals .bt2-rec-cell") == 12, dom(S, ".bt2-goals .bt2-rec-cell"))
    shot(S, "goals_records")
    S.press("Escape")
    time.sleep(0.6)
    ok, sc = S.wait_screen("title", 5)
    check("goals Esc → title", ok and not goals_up(S), sc)
    # into select with Enter
    S.press("Enter")
    ok, sc = S.wait_screen("select", 60)
    check("select up", ok, sc)
    time.sleep(1.2)
    check("NEXT PERMIT PENDING slip visible", dom(S, ".bt2-permit", "visible"), dom(S, ".bt2-permit", "text"))
    check("YOUR BEST ON FILE on focused card", "BEST ON FILE" in (S.safe_js(
        "() => { const e = document.querySelector('.bt-tcard.is-sel .bt2-best'); return e ? e.textContent : ''; }") or "") or
        "NO BROADCASTS" in (S.safe_js("() => { const e = document.querySelector('.bt-tcard.is-sel .bt2-best'); return e ? e.textContent : ''; }") or ""),
        S.safe_js("() => { const e = document.querySelector('.bt-tcard.is-sel .bt2-best'); return e ? e.textContent : ''; }"))
    shot(S, "select_next_unlock")
    # palette row: ↓ then → (real keys)
    S.press("ArrowDown")
    time.sleep(0.2)
    check("↓ focuses the palette row", S.safe_js("() => document.querySelector('.bt-select').dataset.row") == "palette")
    before = S.safe_js("() => document.querySelector('.bt-select .bt2-swatch.on .bt2-swatch-name').textContent")
    S.press("ArrowRight")
    time.sleep(1.2)
    after = S.safe_js("() => document.querySelector('.bt-select .bt2-swatch.on .bt2-swatch-name').textContent")
    check("→ on palette row changes the palette", before != after, "%s → %s" % (before, after))
    shot(S, "select_palette")
    S.press("ArrowUp")
    time.sleep(0.2)
    focus0 = S.safe_js("() => [...document.querySelectorAll('.bt-tcard')].findIndex(e => e.classList.contains('is-sel'))")
    S.press("ArrowRight")
    time.sleep(0.3)
    focus1 = S.safe_js("() => [...document.querySelectorAll('.bt-tcard')].findIndex(e => e.classList.contains('is-sel'))")
    check("↑ back to cards; → moves the card focus", S.safe_js("() => document.querySelector('.bt-select').dataset.row") == "cards" and focus1 == (focus0 + 1) % 4,
          "%s → %s" % (focus0, focus1))
    S.press("ArrowLeft")
    time.sleep(0.3)
    # step 2 + perk row
    S.press("Enter")
    time.sleep(0.8)
    check("step 2", S.safe_js("() => document.querySelector('.bt-select').dataset.step") == "2")
    S.press("ArrowDown")
    time.sleep(0.2)
    p0 = dom(S, ".bt2-perkval-txt b", "text")
    S.press("ArrowRight")
    time.sleep(0.3)
    p1 = dom(S, ".bt2-perkval-txt b", "text")
    check("perk row ←/→ changes the perk", p0 != p1, "%s → %s" % (p0, p1))
    shot(S, "select_perk")
    # G from step 2 → goals → Esc → same step
    S.press("KeyG")
    time.sleep(0.8)
    check("select G → goals", goals_up(S), S.screen())
    S.press("Escape")
    ok, sc = S.wait_screen("select", 10)
    time.sleep(0.8)
    st = S.safe_js("() => ({ step: document.querySelector('.bt-select').dataset.step, row: document.querySelector('.bt-select').dataset.row,"
                   " perk: (document.querySelector('.bt2-perkval-txt b') || {}).textContent })")
    check("goals Esc → select on the same step / row / perk", ok and st and st.get("step") == "2" and st.get("row") == "perk" and st.get("perk") == p1, st)
    S.press("Escape")   # back to step 1
    time.sleep(0.6)
    check("Esc on step 2 → step 1", S.safe_js("() => document.querySelector('.bt-select').dataset.step") == "1")
    shot(S, "select_step1_after")


def start_run(S, titan="molo", biome="grideast", extra=None):
    q = dict(dev=1, noslate=1, autostart=1, titan=titan, biome=biome, seed=1337)
    q.update(extra or {})
    S.goto(build_url(S.args.base, **q))
    S.wait_bt()
    ok, sc = S.wait_screen("play", 90)
    if not ok:
        S.bt_call("newRun", {"titan": titan, "biome": biome, "seed": 1337, "skipSlate": True})
        ok, sc = S.wait_screen("play", 90)
    return ok, sc


def draft(S):
    ok, sc = start_run(S, "molo", "grideast", {"meta": "full"})
    check("run for draft", ok, sc)
    S.cheat("god", True)
    S.cheat("noSpawns", True)
    # an evolution ready + a level-up draft
    ok, v = S.cheat("evolveReady", "evo_full_block_bite")
    check("evolveReady(evo_full_block_bite)", ok and v, v)
    got_evo = False
    for i in range(10):
        S.cheat("xp", 5000)
        ok, sc = S.wait_screen("draft", 8)
        if not ok:
            continue
        time.sleep(1.0)
        ids = S.safe_js("() => [...document.querySelectorAll('.bt-draft .bt-dossier')].map(e => e.dataset.card)") or []
        if any(x and x.startswith("evo_") for x in ids):
            got_evo = True
            break
        S.press("Digit1")
        time.sleep(0.8)
    check("an evolution card offered", got_evo, ids)
    check("draft charges line", "BANISH" in (dom(S, ".bt2-draft-charges", "text") or ""), dom(S, ".bt2-draft-charges", "text"))
    shot(S, "draft_evo")
    st0 = S.state() or {}
    v2 = (st0.get("v2") or {}).get("draft") or {}
    ids0 = S.safe_js("() => [...document.querySelectorAll('.bt-draft .bt-dossier')].map(e => e.dataset.card)")
    time.sleep(0.7)
    S.press("KeyX")
    time.sleep(1.4)
    st1 = S.state() or {}
    v21 = (st1.get("v2") or {}).get("draft") or {}
    ids1 = S.safe_js("() => [...document.querySelectorAll('.bt-draft .bt-dossier')].map(e => e.dataset.card)")
    check("real X banishes (banishLeft −1, offer changed)", v21.get("banishLeft") == (v2.get("banishLeft", 0) - 1) and ids0 != ids1,
          "%s→%s %s→%s" % (v2.get("banishLeft"), v21.get("banishLeft"), ids0, ids1))
    time.sleep(0.7)
    S.press("KeyC")
    time.sleep(1.0)
    st2 = S.state() or {}
    v22 = (st2.get("v2") or {}).get("draft") or {}
    check("real C locks (v2.draft.locked set)", bool(v22.get("locked")), v22)
    check("HELD badge on the locked card", dom(S, ".bt-draft .bt-dossier.is-held") == 1)
    shot(S, "draft_evo_banish_lock")
    S.press("Digit2")
    time.sleep(1.0)


def pause(S):
    ok, sc = start_run(S, "voltkite", "lockwater", {"meta": "full"})
    check("run for pause", ok, sc)
    S.cheat("god", True)
    S.cheat("xp", 1500)
    calm = 0
    for i in range(80):
        time.sleep(0.5)
        sc = S.screen()
        if sc == "draft":
            calm = 0
            S.press("Digit1")
        else:
            calm += 1
            if calm >= 10:
                break
    S.wait_screen("play", 10)
    time.sleep(0.5)
    S.press("Escape")
    ok, sc = S.wait_screen("pause", 8)
    time.sleep(0.5)
    n = dom(S, ".bt2-loadout .bt2-lrow")
    owned = S.safe_js("() => { const w = window.__H_W__(); let n = 0; for (const k in w.upgrades.owned) if (w.upgrades.owned[k] > 0) n++; return n; }")
    check("pause LOADOUT lists owned cards", ok and n >= 1 and n <= (owned or 0), "%s rows / %s owned" % (n, owned))
    shot(S, "pause_loadout")
    S.press("Escape")
    time.sleep(0.5)


def tabloid(S):
    ok, sc = start_run(S, "molo", "grideast")
    check("run for tabloid", ok, sc)
    S.cheat("god", True)
    S.cheat("level", 12)
    S.cheat("boss")
    time.sleep(0.5)
    S.js("() => { const w = window.__H_W__(); const b = w.boss; if (b) { b.introT = 0; b.hp = 0; b.alive = false; } }")
    ok, sc = S.wait_screen(("tabloid", "end"), 40)
    check("clear tabloid up", ok, sc)
    time.sleep(2.2)
    check("KEEP GOING button visible", dom(S, ".bt-tabloid .bt2-keep", "visible"))
    check("default focus stays on RETRY", S.safe_js("() => (document.querySelector('.bt-tab-btn.is-sel') || {}).dataset.choice") == "retry")
    shot(S, "tabloid_clear_keepgoing")
    S.press("KeyK")
    ok, sc = S.wait_screen("play", 10)
    st = S.state() or {}
    E = (st.get("v2") or {}).get("endless")
    check("real K → EXTENDED COVERAGE (v2.endless set, phase endless)", ok and E is not None and (st.get("run") or {}).get("phase") == "endless",
          (sc, (st.get("run") or {}).get("phase"), E))
    t0 = st.get("t") or (st.get("run") or {}).get("t")
    time.sleep(2.0)
    t1 = (S.state() or {}).get("t")
    check("sim advances after K", t0 is not None and t1 is not None and t1 > t0, (t0, t1))
    # die → EXTENDED COVERAGE EDITION
    S.cheat("god", False)
    S.js("() => { const w = window.__H_W__(); w.titan.hp = 0; w.titan.alive = false; }")
    ok, sc = S.wait_screen(("tabloid", "end"), 40)
    time.sleep(2.2)
    check("endless tabloid up", ok, sc)
    check("IT WOULD NOT LEAVE. headline", "IT WOULD NOT LEAVE." in (dom(S, ".bt2-np-endless", "text") or ""))
    check("no KEEP GOING after a death", not dom(S, ".bt-tabloid .bt2-keep", "visible"))
    shot(S, "tabloid_endless")

PAD_JS = r"""
(() => {
  window.__PAD__ = { b: new Array(17).fill(0) };
  const mk = () => ({ id: 'stub standard pad', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: [0, 0, 0, 0], buttons: window.__PAD__.b.map((v) => ({ pressed: !!v, touched: !!v, value: v ? 1 : 0 })) });
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [mk(), null, null, null] });
})();
"""


def pad_btn(S, i, v):
    S.js("([i, v]) => { window.__PAD__.b[i] = v; }", [i, v])


def pad_tap(S, i, ms=90):
    pad_btn(S, i, 1); time.sleep(ms / 1000.0); pad_btn(S, i, 0); time.sleep(0.12)


def pad(S):
    S.page.add_init_script(PAD_JS)
    S.goto(build_url(S.args.base, dev=1, noslate=1))
    S.wait_bt()
    ok, sc = S.wait_screen("title", 60)
    time.sleep(0.8)
    pad_tap(S, 2)
    time.sleep(0.5)
    check("pad X on the title → goals", goals_up(S), S.screen())
    pad_tap(S, 1)
    ok, sc = S.wait_screen("title", 5)
    check("pad B → back to the title", ok, sc)
    # draft: hold Y 0.6 s banishes, a tap does not, LB locks
    ok, sc = start_run(S, "molo", "grideast", {"meta": "full"})
    S.cheat("god", True)
    S.cheat("noSpawns", True)
    S.cheat("xp", 400)
    ok, sc = S.wait_screen("draft", 10)
    check("pad: a draft is open", ok, sc)
    time.sleep(1.0)
    d0 = ((S.state() or {}).get("v2") or {}).get("draft") or {}
    pad_tap(S, 3, 120)
    time.sleep(0.8)
    d1 = ((S.state() or {}).get("v2") or {}).get("draft") or {}
    check("pad: TAP Y does not banish", d1.get("banishLeft") == d0.get("banishLeft"), (d0.get("banishLeft"), d1.get("banishLeft")))
    pad_btn(S, 3, 1); time.sleep(0.75); pad_btn(S, 3, 0)
    time.sleep(1.2)
    d2 = ((S.state() or {}).get("v2") or {}).get("draft") or {}
    check("pad: HOLD Y 0.75 s banishes", d2.get("banishLeft") == (d0.get("banishLeft", 0) - 1), (d0.get("banishLeft"), d2.get("banishLeft")))
    time.sleep(0.7)
    pad_tap(S, 4)
    time.sleep(1.0)
    d3 = ((S.state() or {}).get("v2") or {}).get("draft") or {}
    check("pad: LB locks", bool(d3.get("locked")), d3)
    check("pad hints shown (HOLD Y)", "HOLD Y" in (S.safe_js("() => document.querySelector('.bt-draft-foot .bt-hints').textContent") or ""))
    shot(S, "draft_pad_hints")
    pad_tap(S, 0)
    time.sleep(0.8)



def main():
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--only", default="menus,draft,pause,tabloid")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    parts = [p.strip() for p in args.only.split(",") if p.strip()]
    with Session(args, "l9shots") as S:
        S.start() if S.page is None else None
        for p in parts:
            try:
                {"menus": menus, "draft": draft, "pause": pause, "tabloid": tabloid, "pad": pad}[p](S)
            except Exception as e:
                check("%s: no exception" % p, False, str(e).splitlines()[0][:300])
        errs = [e for e in S.page_errors] + [e for e in S.window_errors()]
        cerr = [t for (k, t) in S.console if k == "error"]
        check("no page errors", not errs, errs[:3])
        check("no console errors", not cerr, cerr[:3])
    bad = [n for n, ok in RESULTS if not ok]
    print("L9SHOTS: %d/%d checks passed%s" % (len(RESULTS) - len(bad), len(RESULTS), (" · FAILED: " + "; ".join(bad)) if bad else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
