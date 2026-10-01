#!/usr/bin/env python
"""HIT PARADE - layout check (G8 part 2, CONTRACT_MOBILE M6). Pattern: dyefield/_harness/layoutcheck.py. HEADLESS.

For each device: a Playwright context with real emulation (viewport, DPR, is_mobile, has_touch, a mobile UA) and, for the
notched phones, safe-area insets through CDP Emulation.setSafeAreaInsetsOverride (env(safe-area-inset-*) live). Every
step opens a deep link and runs LAYOUT_JS:
  clip     every visible control (button / input / [data-nav] / role=button|switch|radio, plus the touch buttons from
           the touch read-back) lies inside the viewport AND the safe area; a control cut by a non-scrolling overflow box
           is a defect (one below the fold of a scroll panel is not: it scrolls)
  overlap  no two controls overlap (> 2 px each way, judged on the UNSKEWED layout box: the comic skew is paint only);
           the touch buttons are circles
  target   touch mode: every control >= 44 x 44 CSS px
  font     touch mode: visible text >= 12 px; .lbl and control labels >= 14 px (desktop small captions -> fontInfo)
  scroll   the page never scrolls; long panels scroll inside themselves
  title    the HIT PARADE logo is not covered by the bug / corner buttons
  zones    live HUD in touch mode: no HUD block covers a touch control (circles vs boxes)
Screenshots: _shots/layout_<device>_<step>.png. Report: _harness/_reports/layoutcheck.json. Exit 0 PASS, 1 FAIL, 2 error.

Targets: --lab (default: runtime/lab/ui.html deep links ?screen= / ?hud=, UI dev server :5324 started when needed) or
--base URL (the integrated game: steps then need the shell's deep links - integration).
Run:  python _harness/layoutcheck.py --headless [--devices d900,p844] [--steps title,hud_mid]
Reuse: from layoutcheck import LAYOUT_JS, check_page, DEVICES
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from menus import LabServer, HarnessError, lab_url, save_report, shot, wait_ready, ROOT, INIT_JS  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
IPAD_UA = ("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
ANDROID_UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36")

# CONTRACT_MOBILE M0 (landscape) + the desktop sizes. safe = (left, top, right, bottom) CSS px.
DEVICES = {
    "se": {"w": 667, "h": 375, "dpr": 2, "mobile": True, "ua": IOS_UA, "safe": (0, 0, 0, 0)},
    "p844": {"w": 844, "h": 390, "dpr": 3, "mobile": True, "ua": IOS_UA, "safe": (47, 0, 47, 21)},
    "iphone14": {"w": 852, "h": 393, "dpr": 3, "mobile": True, "ua": IOS_UA, "safe": (59, 0, 59, 21)},
    "pixel7": {"w": 915, "h": 412, "dpr": 2.625, "mobile": True, "ua": ANDROID_UA, "safe": (0, 0, 0, 0)},
    "ipad": {"w": 1180, "h": 820, "dpr": 2, "mobile": True, "ua": IPAD_UA, "safe": (0, 0, 0, 20)},
    "d720": {"w": 1280, "h": 720, "dpr": 1, "mobile": False, "ua": None, "safe": (0, 0, 0, 0)},
    "d900": {"w": 1600, "h": 900, "dpr": 1, "mobile": False, "ua": None, "safe": (0, 0, 0, 0)},
}
MENU_STEPS = ["title", "main", "season", "versus", "charselect", "charselect_season", "stage", "vs", "results", "results_arcade",
              "ladder", "card_rival", "card_boss", "card_miniboss", "card_brawl", "card_heckler", "ending", "nameentry",
              "pause", "training", "movelist", "settings", "online", "credits", "confirm",
              # CHANGED(UI) P2: the ending sequence's cards, bonus / online results, the online lobby states, the blind pick
              "ending_text", "ending_ratings", "ending_board", "results_brawl", "results_heckler", "results_online_dc",
              "online_room", "online_sync", "online_blind",
              # CHANGED(UI3D): HOW TO PLAY (the ring's STEP controls) and a move list with a step-attack + HOMING / LINEAR tags
              "howto", "movelist_patch"]
# CHANGED(UI3D): steps the lab has no deep link for: (lab screen to open, element to click on it)
STEP_NAV = {"howto": ("main", "hpm-main-howto")}
# CHANGED(UI3D): steps that are a lab screen + extra query
STEP_QUERY = {"movelist_patch": "screen=movelist&fighter=patch"}
HUD_STEPS = ["hud_intro", "hud_mid", "hud_fright", "hud_super", "hud_parry", "hud_ko", "hud_arcade", "hud_training"]
ALL_STEPS = MENU_STEPS + HUD_STEPS
# how long each step settles before it is measured / shot (sweeps and captions animate in)
SETTLE = {"hud_intro": 0.55, "hud_mid": 0.9, "hud_fright": 0.9, "hud_super": 0.9, "hud_parry": 0.5, "hud_ko": 0.45, "hud_arcade": 0.6, "hud_training": 0.9, "stage": 1.0,
         "ending_text": 2.4, "ending_ratings": 4.0, "ending_board": 4.8, "online_blind": 1.2}

LAYOUT_JS = r"""
(opt) => {
  opt = opt || {};
  const W = innerWidth, H = innerHeight, D = document, html = D.documentElement;
  const touch = html.classList.contains('hp-touch');
  const pr = D.createElement('div');
  pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  D.body.appendChild(pr);
  const pcs = getComputedStyle(pr);
  const safe = { t: parseFloat(pcs.paddingTop) || 0, r: parseFloat(pcs.paddingRight) || 0, b: parseFloat(pcs.paddingBottom) || 0, l: parseFloat(pcs.paddingLeft) || 0 };
  pr.remove();
  const SB = { l: safe.l, t: safe.t, r: W - safe.r, b: H - safe.b };
  const TOL = 1;
  const name = (e) => {
    if (!e) return '?';
    if (e.id) return '#' + e.id;
    const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const t = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    return e.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? '"' + t + '"' : '');
  };
  const shown = (e) => {
    if (!e || e.closest('[hidden]')) return false;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const ns = n === e ? s : getComputedStyle(n);
      if (parseFloat(ns.opacity) < 0.05 || ns.display === 'none') return false;
    }
    const r = e.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  /** the layout box without transforms (the comic skew is paint only): centred on the painted box */
  const L = (e) => { const r = e.getBoundingClientRect(); const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; const w = e.offsetWidth || r.width, h = e.offsetHeight || r.height; return { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 }; };
  const rnd = (q) => q ? { l: Math.round(q.l), t: Math.round(q.t), r: Math.round(q.r), b: Math.round(q.b) } : null;
  const inter = (a, b) => { const l = Math.max(a.l, b.l), t = Math.max(a.t, b.t), r = Math.min(a.r, b.r), bb = Math.min(a.b, b.b); return r > l && bb > t ? { l, t, r, b: bb } : null; };
  const overlap = (a, b, px) => (Math.min(a.r, b.r) - Math.max(a.l, b.l)) > px && (Math.min(a.b, b.b) - Math.max(a.t, b.t)) > px;
  const circleOf = (q) => ({ x: (q.l + q.r) / 2, y: (q.t + q.b) / 2, r: Math.min(q.r - q.l, q.b - q.t) / 2 });
  const circleHitsBox = (c, q, px) => Math.hypot(c.x - Math.min(Math.max(c.x, q.l), q.r), c.y - Math.min(Math.max(c.y, q.t), q.b)) < c.r - px;
  const hits = (a, b, px) => {
    if (a.round && b.round) { const ca = circleOf(a.rect), cb = circleOf(b.rect); return Math.hypot(ca.x - cb.x, ca.y - cb.y) < ca.r + cb.r - px; }
    if (a.round) return circleHitsBox(circleOf(a.rect), b.rect, px);
    if (b.round) return circleHitsBox(circleOf(b.rect), a.rect, px);
    return overlap(a.rect, b.rect, px);
  };
  const isScroller = (n, s) => (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1);
  const effective = (e) => {
    let q = R(e.getBoundingClientRect());
    let state = 'ok', by = null;
    for (let n = e.parentElement; n && n !== D.body && n !== html; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = R(n.getBoundingClientRect());
      const cut = inter(q, c);
      const area = (x) => x ? (x.r - x.l) * (x.b - x.t) : 0;
      if (area(cut) + 0.5 < area(q) * 0.97) {
        if (isScroller(n, s)) { if (!cut) { state = 'scrolled'; by = n; break; } q = cut; }
        else if (state !== 'scrolled') { state = 'clipped'; by = n; if (cut) q = cut; else break; }
      }
    }
    return { rect: q, state, by };
  };
  const menus = D.getElementById('hp-menus');
  const menusUp = !!menus && !menus.hidden;
  const confirmEl = D.querySelector('#hp-menus:not([hidden]) .hpm-confirm:not([hidden])');
  const roots = confirmEl ? [confirmEl] : [menus, D.getElementById('hp-hud'), D.getElementById('hp-broadcast')].filter(Boolean);
  const CTRL = 'button, input:not([type=hidden]), select, textarea, a[href], [data-nav], [role=button], [role=switch], [role=radio]';
  const ctrls = [];
  for (const root of roots) for (const e of root.querySelectorAll(CTRL)) {
    if (e.closest('#hp-touch') || !shown(e)) continue;
    if (ctrls.some((c) => c.e === e)) continue;
    ctrls.push({ e, id: name(e), ...effective(e), raw: R(e.getBoundingClientRect()), lay: L(e) });
  }
  let touchButtons = null;
  try {
    const src = window.__UILAB__ || window.__HP__;
    const t = src && typeof src.touch === 'function' ? src.touch() : null;
    if (t && t.visible && Array.isArray(t.buttons)) touchButtons = t.buttons.map((b) => ({ id: 'touch:' + b.id, round: true, rect: { l: b.rect.x, t: b.rect.y, r: b.rect.x + b.rect.w, b: b.rect.y + b.rect.h } }));
  } catch (err) { touchButtons = null; }
  const problems = [];
  const P = (kind, msg, data) => problems.push({ kind, msg, ...(data ? { data } : {}) });
  for (const c of ctrls) {
    if (c.state === 'clipped') P('clip', c.id + ' is cut by ' + name(c.by), rnd(c.raw));
    if (c.state === 'scrolled') continue;
    const q = c.rect;
    if (q.l < -TOL || q.t < -TOL || q.r > W + TOL || q.b > H + TOL) P('clip', c.id + ' outside the viewport', rnd(q));
    else if (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL) P('safe', c.id + ' outside the safe area', rnd(q));
  }
  if (touchButtons) for (const b of touchButtons) {
    const q = b.rect;
    if (b.id === 'touch:stick') continue;
    if (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL) P('safe', b.id + ' outside the safe area', rnd(q));
  }
  const liveTouch = touchButtons && !menusUp ? touchButtons.filter((b) => b.id !== 'touch:stick') : [];
  const all = ctrls.filter((c) => c.state !== 'scrolled').map((c) => ({ id: c.id, e: c.e, rect: c.lay })).concat(liveTouch);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.e && b.e && (a.e.contains(b.e) || b.e.contains(a.e))) continue;
    if (hits(a, b, 2)) P('overlap', a.id + ' x ' + b.id, [rnd(a.rect), rnd(b.rect)]);
  }
  if (touch) for (const c of ctrls) {
    const w = c.lay.r - c.lay.l, h = c.lay.b - c.lay.t;
    if (w < 44 - 0.5 || h < 44 - 0.5) P('target', c.id + ' ' + w.toFixed(1) + 'x' + h.toFixed(1) + ' < 44');
  }
  const small = [];
  const walker = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || seen.has(p) || p.closest('svg') || p.closest('script, style, noscript')) continue;
    if (!roots.some((r) => r.contains(p))) continue;
    seen.add(p);
    if (!shown(p)) continue;
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs < 12 - 0.25) small.push(name(p) + ' ' + fs + 'px');
    if (p.classList.contains('lbl') && fs < 14 - 0.25) small.push(name(p) + ' ' + fs + 'px (label < 14)');
    // CHANGED(wf6 fixer) VO-D4: text wider than its own box (a chip whose label spills / is cut: the online ribbon showed
    // SEARC / CONNEC at 960 x 540 and on the phone; the overlap / clip checks only look at controls). Leaf boxes only.
    // (a label truncated ON PURPOSE - text-overflow: ellipsis, the select grid's long names - shows its cut and is skipped)
    // (2 px tolerance: scrollWidth counts the last glyph's trailing letter-spacing and rounds up - a 12 px BEST COMBO
    // header measured 48 in a 46.4 px column with nothing visibly cut)
    const pcs2 = getComputedStyle(p);
    if (!p.firstElementChild && p.clientWidth > 0 && pcs2.display !== 'inline' && pcs2.textOverflow !== 'ellipsis' && p.scrollWidth > p.clientWidth + 2) {
      let scroller = false;
      for (let a = p.parentElement; a && a !== D.body; a = a.parentElement) { const as = getComputedStyle(a); if (/(auto|scroll)/.test(as.overflowX) && a.scrollWidth > a.clientWidth + 1) { scroller = true; break; } }
      if (!scroller) P('textclip', name(p) + ' text ' + p.scrollWidth + ' px in a ' + p.clientWidth + ' px box', rnd(R(p.getBoundingClientRect())));
    }
  }
  const fontInfo = [];
  for (const s of small) { if (touch) P('font', s); else fontInfo.push(s); }
  // the page never scrolls; the document fits
  const se = D.scrollingElement || html;
  if (se.scrollTop > 0 || se.scrollLeft > 0 || se.scrollHeight > H + 2 || se.scrollWidth > W + 2) P('scroll', 'the page scrolls: ' + se.scrollWidth + 'x' + se.scrollHeight + ' in ' + W + 'x' + H);
  // title: the logo uncovered
  const logo = D.querySelector('#hp-menus:not([hidden]) .hpm-s-title:not([hidden]) .hpm-logo');
  if (logo && shown(logo)) {
    const q = R(logo.getBoundingClientRect());
    for (const sel of ['.hpm-title-bug', '.hpm-corner', '.hpm-press', '.hpm-network']) {
      const o = D.querySelector('#hp-menus .hpm-s-title ' + sel);
      if (o && shown(o) && overlap(q, R(o.getBoundingClientRect()), 3)) P('title', 'the logo is covered by ' + sel);
    }
  }
  // blocks of the active screen must not overlap one another (paint boxes, the scrim excluded)
  const scr = D.querySelector('#hp-menus:not([hidden]) .hpm-screen:not([hidden])');
  if (scr && !confirmEl) {
    const kids = [...scr.children].filter((k) => shown(k) && getComputedStyle(k).position !== 'absolute' && !k.classList.contains('hpm-burst'));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = L(kids[i]), b = L(kids[j]);
      if (overlap(a, b, 3)) P('blocks', name(kids[i]) + ' x ' + name(kids[j]), [rnd(a), rnd(b)]);
    }
  }
  // HUD vs the thumb zones (touch): HUD blocks must not cover a touch button
  const hud = D.querySelector('#hp-hud:not([hidden])');
  let hudBlocks = [];
  if (hud && !menusUp) {
    // persistent blocks + the transient text that lingers (combo, callouts, host caption, strap); the 1 s sweeps are exempt
    const sel = '.hp-side, .hp-center, .hp-show, .hp-top > *, .hp-inputs, .hp-frames, .hp-combo.on, .hp-call';
    hudBlocks = [...hud.querySelectorAll(sel), ...D.querySelectorAll('#hp-broadcast .hpb-cap.on, #hp-broadcast .hpb-strap.on')].filter(shown).map((e) => ({ id: name(e), rect: L(e) }));
    for (const hb of hudBlocks) for (const tb of liveTouch) if (hits(tb, hb, 2)) P('zones', hb.id + ' covers ' + tb.id, [rnd(hb.rect), rnd(tb.rect)]);
  }
  return { W, H, touch, safe, controls: ctrls.length, touchButtons: touchButtons ? touchButtons.length : 0, problems, fontInfo: fontInfo.slice(0, 20), hudBlocks: hudBlocks.length };
}
"""


def check_page(page, where: str, opts: dict | None = None) -> dict:
    r = page.evaluate(LAYOUT_JS, opts or {})
    r["where"] = where
    return r


def run(args) -> int:
    from playwright.sync_api import sync_playwright
    devices = [d.strip() for d in args.devices.split(",") if d.strip()]
    steps = [s.strip() for s in args.steps.split(",") if s.strip()] if args.steps else ALL_STEPS
    report: dict = {"devices": {}, "verdict": "PASS"}
    t0 = time.time()
    srv = LabServer() if not args.base else None
    try:
        if srv:
            srv.__enter__()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
            for dev in devices:
                d = DEVICES[dev]
                kw = {"viewport": {"width": d["w"], "height": d["h"]}, "device_scale_factor": d["dpr"], "is_mobile": d["mobile"], "has_touch": d["mobile"]}
                if d["ua"]:
                    kw["user_agent"] = d["ua"]
                ctx = browser.new_context(**kw)
                ctx.add_init_script(INIT_JS)
                page = ctx.new_page()
                errs: list = []
                page.on("pageerror", lambda e, errs=errs: errs.append(f"pageerror: {e}"))
                page.on("console", lambda m, errs=errs: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
                if any(d["safe"]):
                    cdp = ctx.new_cdp_session(page)
                    l, t, r, b = d["safe"]
                    try:
                        cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": t, "left": l, "bottom": b, "right": r}})
                    except Exception as e:  # older Chromium: report, continue
                        errs.append(f"safe-area override unsupported: {e}")
                drep: dict = {"steps": {}, "errors": errs}
                for step in steps:
                    q = ("hud=" + step[4:]) if step.startswith("hud_") else STEP_QUERY.get(step) or ("screen=" + STEP_NAV.get(step, (step, ""))[0])
                    if d["mobile"]:
                        q += "&touch=1"
                    url = args.base or lab_url(None, q)
                    page.goto(url, wait_until="load")
                    wait_ready(page)
                    if step in STEP_NAV:
                        page.wait_for_timeout(300)
                        page.evaluate("(id) => { const e = document.getElementById(id); if (e) e.click(); }", STEP_NAV[step][1])
                    time.sleep(SETTLE.get(step, 0.7))
                    res = check_page(page, f"{dev}:{step}")
                    path = shot(page, f"layout_{dev}_{step}")
                    probs = res["problems"]
                    drep["steps"][step] = {"problems": probs, "fontInfo": res["fontInfo"], "controls": res["controls"], "touchButtons": res["touchButtons"], "shot": os.path.relpath(path, ROOT).replace("\\", "/")}
                    flag = "PASS" if not probs else "FAIL"
                    print(f"  [{flag}] {dev:<8} {step:<18} controls={res['controls']:<3} touch={res['touchButtons']:<2} problems={len(probs)}" + (f"  e.g. {probs[0]['kind']}: {probs[0]['msg']}" if probs else ""))
                    if probs:
                        report["verdict"] = "FAIL"
                if errs:
                    report["verdict"] = "FAIL"
                    print(f"  [FAIL] {dev} page errors: {errs[:3]}")
                report["devices"][dev] = drep
                ctx.close()
            browser.close()
    except HarnessError as e:
        print(f"[layout] HARNESS ERROR: {e}")
        return 2
    finally:
        if srv:
            srv.__exit__(None, None, None)
    report["seconds"] = round(time.time() - t0, 1)
    path = save_report("layoutcheck", report)
    n = sum(len(s["problems"]) for dv in report["devices"].values() for s in dv["steps"].values())
    print(f"[layout] {report['verdict']}: {len(devices)} devices x {len(steps)} steps, {n} problems -> {os.path.relpath(path, ROOT)}")
    return 0 if report["verdict"] == "PASS" else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--devices", default="se,p844,iphone14,pixel7,ipad,d720,d900")
    ap.add_argument("--steps", default="")
    ap.add_argument("--base", default=None)
    ap.add_argument("--headless", action="store_true", help="(always headless; accepted for the gate table)")
    ap.add_argument("--lab", action="store_true")
    return run(ap.parse_args())


if __name__ == "__main__":
    sys.exit(main())
