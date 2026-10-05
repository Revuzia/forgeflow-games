"""BLOCKTOOTH VS QA (lane B-QA) — shared browser helpers for bootcheck_vs.py and playtest_vs.py.

Everything here OBSERVES through the read-only World that the harness already uses (`window.__H_W__()` =
`__BT__.world`): `W.mode`, `W.players[i]`, `W.vs` (phase machine, ring, tenders, crown), `W.t`. Input goes in only as REAL
keys through `page.keyboard` (common.Session.press / hold). The VS menu is found by its visible text ("VS PRACTICE"),
so these helpers do not depend on B-VIEW's DOM class names; if the text is not on screen they say so (exit 3 NOT RUN).
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import BIOME_NAMES, TITAN_NAMES, TITANS, BIOMES, navigate_cards, detect_focus  # noqa: E402

VS_ENTRY_RE = r"VS\s*PRACTICE"

# the visible leaf elements whose text matches a regex (case-insensitive): [{text, x, y, w, h}]
FIND_TEXT_JS = r"""
(re) => {
  const rx = new RegExp(re, 'i');
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || !rx.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity || '1') < 0.05) continue;
    out.push({ text: t.slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return out;
}
"""

# all visible text on the page, upper-cased (banner / HUD / end-card evidence)
PAGE_TEXT_JS = "() => (document.body ? document.body.innerText : '').toUpperCase()"

# the whole VS picture, read from the live World (read-only)
VS_OBS_JS = r"""
() => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W) return { world: false };
  const o = { world: true, mode: W.mode || null, tick: W.tick, t: W.t, view: W.view, result: W.run && W.run.result, endT: W.run && W.run.endT };
  if (!W.players || !W.players.length) return o;
  const vs = W.vs;
  if (vs) {
    o.vs = { phase: vs.phase, startT: vs.startT, clock: W.t - vs.startT, crown: vs.crown, winner: vs.winner, order: vs.order,
             ring: vs.ring ? { cx: vs.ring.cx, cz: vs.ring.cz, r: vs.ring.r, step: vs.ring.step } : null,
             tenders: (vs.tenders || []).map((t) => ({ gate: t.gate, state: t.state })) };
  }
  o.players = W.players.map((p) => ({
    slot: p.slot, titan: p.titanId, x: p.titan.x, z: p.titan.z, height: p.titan.height, hp: p.titan.hp, maxHp: p.titan.maxHp,
    level: p.titan.level, rank: p.titan.rank, alive: p.titan.alive, elim: !!(p.vs && p.vs.eliminated), bot: p.bot !== null && p.bot !== undefined,
    place: p.vs && p.vs.place, evictions: p.vs && p.vs.evictions, ko: p.vs && p.vs.koCount, score: p.vs && p.vs.score,
    railOpen: !!(p.rail && p.rail.open), offer: (p.upgrades && p.upgrades.offer) ? p.upgrades.offer.slice() : null,
    pending: p.upgrades ? p.upgrades.pendingDrafts : null,
    owned: p.upgrades && p.upgrades.owned ? Object.values(p.upgrades.owned).reduce((a, b) => a + (typeof b === 'number' ? b : 1), 0) : 0,
  }));
  const b = W.city && W.city.buildings;
  if (b) { let s = 0, tot = 0; for (const x of b) { tot += x.floors; s += x.collapsed ? 0 : x.alive; } o.floorsPct = tot ? 100 * s / tot : null; }
  return o;
}
"""

# is each VS seat standing in a zebra crossing? (bootcheck's CROSSWALK_JS generalised to every seat)
SEATS_ON_ZEBRA_JS = r"""
(tol) => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.players || !W.city) return { ok: false, reason: 'no world' };
  const cws = W.city.crosswalks || [];
  const rows = [];
  for (const p of W.players) {
    const T = p.titan;
    let best = null;
    for (let i = 0; i < cws.length; i++) {
      const c = cws[i];
      const hx = (c.axis === 'x' ? c.len : c.width) / 2, hz = (c.axis === 'x' ? c.width : c.len) / 2;
      const inside = Math.abs(T.x - c.x) <= hx + tol && Math.abs(T.z - c.z) <= hz + tol;
      const d = Math.hypot(T.x - c.x, T.z - c.z);
      if (!best || (inside && !best.inside) || (inside === best.inside && d < best.d)) best = { i, inside, d };
    }
    rows.push({ slot: p.slot, x: T.x, z: T.z, inside: !!(best && best.inside), dist: best ? best.d : null });
  }
  let minSep = Infinity;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) minSep = Math.min(minSep, Math.hypot(rows[i].x - rows[j].x, rows[i].z - rows[j].z));
  return { ok: rows.every((r) => r.inside), rows, minSep: Number.isFinite(minSep) ? minSep : null, pitch: W.city.pitch };
}
"""


def find_text(sess, regex):
    return sess.safe_js(FIND_TEXT_JS, regex, default=[]) or []


def page_text(sess):
    return sess.safe_js(PAGE_TEXT_JS, default="") or ""


def vs_obs(sess):
    return sess.safe_js(VS_OBS_JS, default={"world": False}) or {"world": False}


def in_vs_world(sess):
    o = vs_obs(sess)
    return bool(o.get("world") and o.get("mode") == "vs")


def goto_vs_practice(sess, titan, biome, log=print, timeout_s=120, snap=None):
    """Drive the REAL menus with keys until a VS world exists. Strategy (B-VIEW owns the exact screens):
    from the title press Enter to reach the select screen; look for the visible text 'VS PRACTICE' and walk the
    focus to it with arrow keys (detect_focus on that text), press Enter; afterwards answer every screen with Enter,
    navigating the titan / biome cards when their names are on screen. Returns (ok, detail dict).
    detail['notFound'] = True when 'VS PRACTICE' never appeared (the VS UI is not landed -> NOT RUN)."""
    d = {"steps": [], "screens": []}
    deadline = time.time() + timeout_s
    ok, scr = sess.wait_screen(("title", "select"), 60)
    if not ok:
        d["error"] = "never reached the title screen (screen=%r)" % (scr,)
        return False, d
    d["steps"].append("title reached (screen=%s)" % scr)
    time.sleep(0.8)
    if snap:
        snap("title")
    entered = False
    presses_enter_title = 0
    for _ in range(60):
        if time.time() > deadline:
            break
        hits = find_text(sess, VS_ENTRY_RE)
        if hits and sess.screen() == "title":
            # B-VIEW: the title shows a 'VS PRACTICE [V]' chip; its hotkey is the V key (a real key press)
            sess.press("KeyV")
            d["steps"].append("title: pressed V on the visible %r chip" % hits[0]["text"])
            time.sleep(1.0)
            if sess.screen() != "title":
                entered = True
                break
            continue
        if hits:
            name = hits[0]["text"].upper()
            cur, info = detect_focus(sess, [name])
            if cur == name:
                if snap:
                    snap("vs_entry_focused")
                sess.press("Enter")
                d["steps"].append("Enter on %r" % hits[0]["text"])
                entered = True
                break
            # walk the focus: Down first, then Right, then Up / Left
            for key in ("ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"):
                sess.press(key)
                time.sleep(0.25)
                cur, _ = detect_focus(sess, [name])
                if cur == name:
                    break
            cur, _ = detect_focus(sess, [name])
            if cur != name:
                # focus is not detectable from the DOM: assume the entry is the next item and press Enter anyway
                d["steps"].append("focus of %r not detectable; pressing Enter blind" % hits[0]["text"])
                sess.press("Enter")
                entered = True
                break
            continue
        scr = sess.screen()
        if scr == "title" and presses_enter_title < 4:
            sess.press("Enter")
            presses_enter_title += 1
            time.sleep(1.0)
            continue
        time.sleep(0.4)
    if not entered:
        d["notFound"] = True
        d["error"] = "no visible 'VS PRACTICE' entry on the title / select screens"
        return False, d
    # answer the following screens
    last_screen = None
    enter_count = 0
    for _ in range(80):
        if time.time() > deadline:
            break
        if in_vs_world(sess):
            d["steps"].append("VS world exists (screen=%s)" % sess.screen())
            return True, d
        scr = sess.screen()
        if scr != last_screen:
            d["screens"].append(scr)
            last_screen = scr
        tn = [TITAN_NAMES[t].upper() for t in TITANS]
        bn = [BIOME_NAMES[b].upper() for b in BIOMES]
        txt = page_text(sess)
        if all(n in txt for n in tn) and enter_count < 12:
            navigate_cards(sess, TITANS, TITAN_NAMES, titan, log)
            sess.press("Enter")
            d["steps"].append("titan card %s + Enter" % titan)
            enter_count += 1
            time.sleep(0.9)
            continue
        if all(n in txt for n in bn) and enter_count < 12:
            navigate_cards(sess, BIOMES, BIOME_NAMES, biome, log)
            sess.press("Enter")
            d["steps"].append("biome card %s + Enter" % biome)
            enter_count += 1
            time.sleep(0.9)
            continue
        if scr in ("slate", "loading", "select", "title", "lobby", "vslobby", "countdown"):
            sess.press("Enter")
            enter_count += 1
            time.sleep(0.9)
            continue
        time.sleep(0.4)
    d["error"] = "pressed through the menus but no VS world appeared (screens seen: %s)" % d["screens"]
    return False, d
