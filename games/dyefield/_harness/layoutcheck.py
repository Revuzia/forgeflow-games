#!/usr/bin/env python
"""DYEFIELD — layout check (CONTRACT_MOBILE M6): every screen at every M0 viewport, HEADLESS only.

For each device it opens a Playwright context with real device emulation (viewport, DPR, is_mobile, has_touch, a
real mobile user agent) and, for the phones, the notch/home-indicator safe-area insets through CDP
`Emulation.setSafeAreaInsetsOverride` (so `env(safe-area-inset-*)` is live). It then walks the front end by real
taps (mouse clicks on the desktop sizes) and runs `LAYOUT_JS` on every screen:

  * clip     every visible control (button / input / [data-nav] / role=button|switch|radio, plus the touch
             controls from `__DF__.touch().buttons` when that read-back exists) lies inside the viewport AND the
             safe area; a control cut by a non-scrolling `overflow` box is a defect (one below the fold of a
             scroll panel is not: it scrolls);
  * overlap  no two controls overlap (> 2 px each way); the screen's top-level blocks (the visible children of
             the active menu screen / card, the HUD blocks) do not overlap one another;
  * target   touch mode: every control is >= 44 x 44 CSS px;
  * font     touch mode: every visible HTML text >= 12 px; the largest text of a control (its label) and every `.lbl`
             >= 14 px (the desktop kbm layout is the shipped one: its small captions are listed as `fontInfo`);
  * scroll   the page never scrolls (scrollingElement at 0, content <= the viewport); the long panels scroll
             inside themselves (overflow-y auto + overscroll-behavior contain);
  * title    the DYEFIELD wordmark is not covered by any other title block (the 1.1.0 / 1.2.0 profile-card defect);
  * zones    live HUD in touch mode: no HUD block (the reticle's TANK pipette, its label and the sub chip included)
             covers the touch controls (`__DF__.touch().buttons` when present, else the nominal left-bottom stick zone
             and right-bottom thumb arc). The touch controls are round: they are judged as circles, not bounding boxes.

Steps per device (a subset with --steps): loading, title, play, play_ffa, loadout_ffa, loadout, settings,
settings_end, howto, credits, hud_teams, pause, quit, victory, hud_ffa, victory_ffa, playcard, error, rotate.
Screenshots: _shots/layout_<device>_<step>.png (CSS-pixel size). Report: _harness/_reports/layoutcheck.json.

Touch mode comes from the game (M1: `html.df-touch`, `?touch=1`). With --force-touch, a page that did not turn it
on gets the class set by this script (recorded as "forced"): the UI lane's modules follow the class.

Devices: se 667x375, iphone14 852x393 (59/59/21 insets), pixel7 915x412, ipad 1180x820, tab10 1024x768 (touch, landscape;
the two iPhones also emulate Safari's missing element fullscreen), d720 1280x720 and d900 1600x900 (desktop kbm).
Run:  python _harness/layoutcheck.py --headless --base http://localhost:5202/
      python _harness/layoutcheck.py --headless --devices se,iphone14 --steps title,settings
Reuse: `from layoutcheck import LAYOUT_JS, check_page` — check_page(page, where, opts) -> dict of problems.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import FLAGS, SHOTS, HarnessError, build_url, ensure_server, save_report, stop_server  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
          "Version/17.5 Mobile/15E148 Safari/604.1")
IPAD_UA = ("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
           "Version/17.5 Mobile/15E148 Safari/604.1")
ANDROID_UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/128.0.0.0 Mobile Safari/537.36")

# CONTRACT_MOBILE M0, landscape. `safe` = (left, top, right, bottom) CSS px: the landscape insets those devices
# report with viewport-fit=cover (Dynamic Island iPhones 59 / 59 / 21; the iPad's home indicator 20; the SE and the
# Pixel 7 report none in landscape here).
DEVICES = {
    # iOS phones: `ios` emulates iPhone Safari's missing element fullscreen (document.fullscreenEnabled false), so the
    # FULLSCREEN toggles hide and the one-time Add-to-Home-Screen tip shows (M4 / M9)
    "se": {"w": 667, "h": 375, "dpr": 2, "mobile": True, "ua": IOS_UA, "safe": (0, 0, 0, 0), "ios": True},
    "iphone14": {"w": 852, "h": 393, "dpr": 3, "mobile": True, "ua": IOS_UA, "safe": (59, 0, 59, 21), "ios": True},
    "pixel7": {"w": 915, "h": 412, "dpr": 2.625, "mobile": True, "ua": ANDROID_UA, "safe": (0, 0, 0, 0)},
    "ipad": {"w": 1180, "h": 820, "dpr": 2, "mobile": True, "ua": IPAD_UA, "safe": (0, 0, 0, 20)},
    "tab10": {"w": 1024, "h": 768, "dpr": 2, "mobile": True, "ua": IPAD_UA, "safe": (0, 0, 0, 20)},
    "d720": {"w": 1280, "h": 720, "dpr": 1, "mobile": False, "ua": None, "safe": (0, 0, 0, 0)},
    "d900": {"w": 1600, "h": 900, "dpr": 1, "mobile": False, "ua": None, "safe": (0, 0, 0, 0)},
}
IOS_INIT = "try { Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get() { return false; } }); } catch (e) {}"
MENU_STEPS = ["loading", "title", "play", "play_ffa", "loadout_ffa", "loadout", "settings", "settings_end", "howto", "credits"]
MATCH_STEPS = ["hud_teams", "pause", "quit", "victory", "hud_ffa", "victory_ffa"]
EXTRA_STEPS = ["playcard", "error", "rotate"]
ALL_STEPS = MENU_STEPS + MATCH_STEPS + EXTRA_STEPS

# ─────────────────────────────── the check (runs in the page) ───────────────────────────────
LAYOUT_JS = r"""
(opt) => {
  opt = opt || {};
  const W = innerWidth, H = innerHeight, D = document, html = D.documentElement;
  const touch = html.classList.contains('df-touch');
  const pr = D.createElement('div');
  pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  D.body.appendChild(pr);
  const pcs = getComputedStyle(pr);
  const safe = { t: parseFloat(pcs.paddingTop) || 0, r: parseFloat(pcs.paddingRight) || 0, b: parseFloat(pcs.paddingBottom) || 0, l: parseFloat(pcs.paddingLeft) || 0 };
  pr.remove();
  const SB = { l: safe.l, t: safe.t, r: W - safe.r, b: H - safe.b };
  const TOL = 1;
  const name = (e) => {
    if (!e) return '?';
    if (e.id) return '#' + e.id;
    const c = (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
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
  const rnd = (q) => q ? { l: Math.round(q.l), t: Math.round(q.t), r: Math.round(q.r), b: Math.round(q.b) } : null;
  const inter = (a, b) => { const l = Math.max(a.l, b.l), t = Math.max(a.t, b.t), r = Math.min(a.r, b.r), bb = Math.min(a.b, b.b); return r > l && bb > t ? { l, t, r, b: bb } : null; };
  const overlap = (a, b, px) => (Math.min(a.r, b.r) - Math.max(a.l, b.l)) > px && (Math.min(a.b, b.b) - Math.max(a.t, b.t)) > px;
  // the touch controls are round (M2): a pair is judged circle-to-circle / circle-to-box, never by bounding boxes
  const circleOf = (q) => ({ x: (q.l + q.r) / 2, y: (q.t + q.b) / 2, r: Math.min(q.r - q.l, q.b - q.t) / 2 });
  const circleHitsBox = (c, q, px) => Math.hypot(c.x - Math.min(Math.max(c.x, q.l), q.r), c.y - Math.min(Math.max(c.y, q.t), q.b)) < c.r - px;
  const hits = (a, b, px) => {
    if (a.round && b.round) { const ca = circleOf(a.rect), cb = circleOf(b.rect); return Math.hypot(ca.x - cb.x, ca.y - cb.y) < ca.r + cb.r - px; }
    if (a.round) return circleHitsBox(circleOf(a.rect), b.rect, px);
    if (b.round) return circleHitsBox(circleOf(b.rect), a.rect, px);
    return overlap(a.rect, b.rect, px);
  };
  const isScroller = (n, s) => (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1);
  /** the element's rect clipped by its overflow ancestors: {rect, state: 'ok' | 'scrolled' | 'clipped', by} */
  const effective = (e) => {
    let q = R(e.getBoundingClientRect());
    let state = 'ok', by = null;
    for (let n = e.parentElement; n && n !== D.body && n !== html; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = R(n.getBoundingClientRect());
      const cut = inter(q, c);
      const area = (x) => x ? (x.r - x.l) * (x.b - x.t) : 0;
      if (area(cut) + 0.5 < area(q)) {
        if (isScroller(n, s)) { if (!cut) { state = 'scrolled'; by = n; break; } q = cut; }
        else if (state !== 'scrolled') { state = 'clipped'; by = n; if (cut) q = cut; else break; }
      }
    }
    return { rect: q, state, by };
  };
  // the touch overlay (#df-touch, INPUT lane) is read through its own M10 read-back below, not through the DOM.
  // A modal layer on screen is all the player can reach: the rotate overlay (portrait) or the QUIT confirm.
  const rotateEl = D.getElementById('df-rotate');
  const rotating = !!rotateEl && !rotateEl.hidden && rotateEl.getBoundingClientRect().width > 0;
  const confirmEl = D.querySelector('#df-menus:not([hidden]) .dfm-confirm:not([hidden])');
  const roots = rotating ? [rotateEl] : confirmEl ? [confirmEl]
    : [D.getElementById('ui'), D.getElementById('df-boot'), rotateEl].filter(Boolean);
  const CTRL = 'button, input:not([type=hidden]), select, textarea, a[href], [data-nav], [role=button], [role=switch], [role=radio]';
  const ctrls = [];
  for (const root of roots) for (const e of root.querySelectorAll(CTRL)) {
    if (e.closest('.df-hud') || e.closest('#df-touch') || !shown(e)) continue;
    if (ctrls.some((c) => c.e === e)) continue;
    ctrls.push({ e, id: name(e), ...effective(e), raw: R(e.getBoundingClientRect()) });
  }
  // the touch controls' own read-back (M10), when the INPUT lane's overlay is on screen
  let touchButtons = null;
  try {
    const t = window.__DF__ && typeof window.__DF__.touch === 'function' ? window.__DF__.touch() : null;
    if (t && t.visible && Array.isArray(t.buttons)) {
      touchButtons = t.buttons.map((b) => ({ id: 'touch:' + b.id, round: true, rect: { l: b.rect.x ?? b.rect.left, t: b.rect.y ?? b.rect.top, r: (b.rect.x ?? b.rect.left) + (b.rect.w ?? b.rect.width), b: (b.rect.y ?? b.rect.top) + (b.rect.h ?? b.rect.height) } }));
    }
  } catch (err) { touchButtons = null; }
  const problems = [];
  const P = (kind, msg, data) => problems.push({ kind, msg, ...(data ? { data } : {}) });
  // clip / safe area
  for (const c of ctrls) {
    if (c.state === 'clipped') P('clip', c.id + ' is cut by ' + name(c.by), rnd(c.raw));
    if (c.state === 'scrolled') continue;
    const q = c.rect;
    if (q.l < -TOL || q.t < -TOL || q.r > W + TOL || q.b > H + TOL) P('clip', c.id + ' outside the viewport', rnd(q));
    else if (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL) P('safe', c.id + ' outside the safe area', rnd(q));
  }
  if (touchButtons) for (const b of touchButtons) {
    const q = b.rect;
    if (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL) P('safe', b.id + ' outside the safe area', rnd(q));
  }
  // overlap: controls (+ the touch buttons while nothing modal covers them: a menu screen, a card, the victory slate)
  const modal = !!(D.querySelector('#df-menus:not([hidden])') || D.querySelector('#df-boot:not(.gone)') || D.querySelector('.df-victory:not([hidden])')
    || D.querySelector('#df-rotate:not([hidden])'));
  const liveTouch = touchButtons && !modal ? touchButtons : [];
  const all = ctrls.filter((c) => c.state !== 'scrolled').map((c) => ({ id: c.id, e: c.e, rect: c.rect })).concat(liveTouch);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.e && b.e && (a.e.contains(b.e) || b.e.contains(a.e))) continue;
    if (hits(a, b, 2)) P('overlap', a.id + ' x ' + b.id, [rnd(a.rect), rnd(b.rect)]);
  }
  // tap targets
  if (touch) for (const c of ctrls) {
    const r = c.raw;
    const w = r.r - r.l, h = r.b - r.t;
    if (w < 44 - 0.5 || h < 44 - 0.5) P('target', c.id + ' ' + w.toFixed(1) + 'x' + h.toFixed(1) + ' < 44');
  }
  // fonts
  const fontMin = {}, small = [];
  const walker = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || seen.has(p) || p.closest('svg') || p.closest('script, style, noscript, .df-sr')) continue;
    if (!roots.some((r) => r.contains(p))) continue;
    seen.add(p);
    if (!shown(p)) continue;
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs < 12 - 0.25) small.push(name(p) + ' ' + fs + 'px');
    if (p.classList.contains('lbl') && fs < 14 - 0.25) small.push(name(p) + ' ' + fs + 'px (label < 14)');
  }
  // the M6 type floor is for the touch devices (M0); the desktop kbm layout is the shipped one, unchanged: its small
  // captions are reported as info, not as problems
  const fontInfo = [];
  for (const s of small) { if (touch) P('font', s); else fontInfo.push(s); }
  for (const c of ctrls) {
    if (c.e.tagName === 'INPUT' && c.e.type !== 'text') continue;
    let mx = 0;
    const tw = D.createTreeWalker(c.e, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || !n.parentElement || n.parentElement.closest('svg')) continue;
      if (!shown(n.parentElement)) continue;
      mx = Math.max(mx, parseFloat(getComputedStyle(n.parentElement).fontSize));
    }
    if (c.e.tagName === 'INPUT' && c.e.type === 'text') mx = Math.max(mx, parseFloat(getComputedStyle(c.e).fontSize));
    if (mx > 0 && mx < 14 - 0.25) { const m = c.id + ' label ' + mx + 'px < 14'; if (touch) P('font', m); else fontInfo.push(m); }
  }
  // blocks: the visible children of the active screen / card, the HUD blocks
  const blockSets = [];
  const scr = rotating ? null : D.querySelector('#df-menus:not([hidden]) .dfm-screen:not([hidden])');
  if (confirmEl) blockSets.push(['confirm', [...confirmEl.children].filter(shown)]);
  else if (scr && shown(scr)) {
    let kids = [...scr.children].filter((k) => !k.classList.contains('dfm-scrim') && shown(k));
    // the pause screen is one card: its blocks are the card's columns
    if (scr.classList.contains('df-pause')) { const card = scr.querySelector('.df-pause-card'); if (card) kids = [...card.children].filter(shown); }
    const menusRoot = D.getElementById('df-menus');
    for (const k of menusRoot.children) if (k !== scr && !k.classList.contains('dfm-screen') && shown(k)) kids.push(k);
    blockSets.push(['screen:' + scr.dataset.screen, kids]);
  }
  const hud = rotating || confirmEl ? null : D.querySelector('.df-hud.on');
  if (hud && shown(hud)) {
    // the reticle cluster's TANK pipette, its label and the sub chip count too: they must clear the thumb cluster
    const hb = [...hud.querySelectorAll(':scope > .df-top, :scope > .df-mini, :scope > .df-ffa-panel, :scope > .df-toast, .df-right > .df-gauge, .df-feed-item, :scope > .df-tank, :scope > .df-tank-label, :scope > .df-sub')].filter(shown);
    blockSets.push(['hud', hb]);
  }
  const vic = D.querySelector('.df-victory:not([hidden])');
  if (vic && shown(vic)) {
    const card = vic.querySelector('.df-victory-card');
    const q = card ? R(card.getBoundingClientRect()) : null;
    if (q && (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL)) P('clip', 'the victory card leaves the safe viewport', rnd(q));
  }
  const bootCard = D.querySelector('#df-boot:not(.gone) .df-card');
  if (bootCard && shown(bootCard)) {
    const q = R(bootCard.getBoundingClientRect());
    if (q.l < SB.l - TOL || q.t < SB.t - TOL || q.r > SB.r + TOL || q.b > SB.b + TOL) P('clip', 'the boot card leaves the safe viewport', rnd(q));
  }
  // a transparent layout box (no background / border / shadow: a grid or flex wrapper such as .dfm-how or .dfm-maps)
  // is not a visual block: its visible children are (two levels deep)
  const invisibleBox = (k) => {
    const s = getComputedStyle(k);
    const bg = s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none';
    const bd = !(parseFloat(s.borderTopWidth) || parseFloat(s.borderLeftWidth));
    return bg && bd && s.boxShadow === 'none' && k.children.length > 0 && !k.matches(CTRL);
  };
  const expand = (list, depth) => {
    const out = [];
    for (const k of list) {
      if (depth > 0 && invisibleBox(k)) out.push(...expand([...k.children].filter(shown), depth - 1));
      else out.push(k);
    }
    return out;
  };
  const blocksOut = {};
  for (const [label, kids0] of blockSets) {
    // the HUD's transparent wrappers too (.df-top = crests + timer + tug bar, .df-ffa-panel = own card + standings):
    // their bounding boxes hold empty corners (below the crests, beside the tug bar) that nothing draws in
    const kids = expand(kids0, 2);
    // a block inside a scroll panel is judged by its visible (scroll-clipped) part; one scrolled out of view is skipped.
    // The LOADOUT mannequin slot is the 3D render's window, not a box: its name plate sits on its lower edge by design.
    const bs = kids.filter((k) => !k.classList.contains('dfm-mannequin')).map((k) => { const ef = effective(k); return { id: name(k), e: k, state: ef.state, rect: ef.rect, raw: R(k.getBoundingClientRect()) }; })
      .filter((b) => b.state !== 'scrolled');
    blocksOut[label] = bs.map((b) => ({ id: b.id, rect: rnd(b.rect) }));
    for (const b of bs) {
      const q = b.rect;
      if (q.l < -TOL || q.t < -TOL || q.r > W + TOL || q.b > H + TOL) P('clip', label + ' block ' + b.id + ' outside the viewport', rnd(q));
    }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      if (bs[i].e.contains(bs[j].e) || bs[j].e.contains(bs[i].e)) continue;
      if (overlap(bs[i].rect, bs[j].rect, 2)) P('overlap', label + ': ' + bs[i].id + ' x ' + bs[j].id, [rnd(bs[i].rect), rnd(bs[j].rect)]);
    }
    // touch zones vs HUD blocks
    if (label === 'hud' && touch && !modal) {
      const zones = touchButtons && touchButtons.length ? touchButtons : [
        { id: 'zone:stick', rect: { l: SB.l, t: H - Math.min(200, H * 0.5), r: SB.l + Math.min(220, W * 0.3), b: H } },
        { id: 'zone:buttons', rect: { l: SB.r - Math.min(270, W * 0.36), t: H - Math.min(230, H * 0.58), r: SB.r, b: H } },
      ];
      for (const b of bs) for (const z of zones) if (hits({ rect: b.raw }, z, 2)) P('zone', b.id + ' covers ' + z.id, [rnd(b.raw), rnd(z.rect)]);
    }
  }
  // the title wordmark: covered by nothing
  const wm = D.querySelector('#df-menus:not([hidden]) .dfm-s-title:not([hidden]) .dfm-brand .df-wordmark');
  let wordmark = null;
  if (wm && shown(wm)) {
    const q = R(wm.getBoundingClientRect());
    wordmark = rnd(q);
    const scr2 = wm.closest('.dfm-screen');
    for (const k of scr2.querySelectorAll('*')) {
      if (k === wm || wm.contains(k) || k.contains(wm) || k.classList.contains('dfm-scrim') || !shown(k)) continue;
      if (k.parentElement && k.parentElement.closest('.dfm-screen') !== scr2) continue;
      if (k.closest('.dfm-brand')) continue;
      if (overlap(q, R(k.getBoundingClientRect()), 1)) { P('wordmark', 'the wordmark is covered by ' + name(k), [rnd(q), rnd(R(k.getBoundingClientRect()))]); break; }
    }
  }
  // scrolling: the page never; the long panels inside themselves
  const se = D.scrollingElement || html;
  const pageScroll = { top: se.scrollTop, left: se.scrollLeft, sh: se.scrollHeight, sw: se.scrollWidth };
  if (se.scrollTop !== 0 || se.scrollLeft !== 0 || se.scrollHeight > H + 1 || se.scrollWidth > W + 1) P('scroll', 'the page scrolls', pageScroll);
  const scrollers = [];
  for (const root of roots) for (const n of root.querySelectorAll('*')) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (!/(auto|scroll)/.test(s.overflowY)) continue;
    if (n.scrollHeight <= n.clientHeight + 1) continue;
    const q = R(n.getBoundingClientRect());
    scrollers.push({ id: name(n), rect: rnd(q), sh: n.scrollHeight, ch: n.clientHeight, overscroll: s.overscrollBehaviorY, touchAction: s.touchAction });
    if (s.overscrollBehaviorY === 'auto') P('scroll', name(n) + ' scrolls but chains (overscroll-behavior auto)');
  }
  return {
    viewport: [W, H], dpr: devicePixelRatio, touch, safe, controls: ctrls.length, touchButtons: touchButtons ? touchButtons.length : null,
    problems, blocks: blocksOut, wordmark, scrollers, pageScroll, fontInfo,
  };
}
"""


def check_page(page, where, opts=None):
    """Run LAYOUT_JS on the page; returns its dict with `where` added."""
    r = page.evaluate(LAYOUT_JS, opts or {})
    r["where"] = where
    return r


# ─────────────────────────────── driving ───────────────────────────────
class Dev:
    def __init__(self, browser, key, spec, args):
        self.key, self.spec, self.args = key, spec, args
        kw = {"viewport": {"width": spec["w"], "height": spec["h"]}, "device_scale_factor": spec["dpr"]}
        if spec["mobile"]:
            kw.update(is_mobile=True, has_touch=True, user_agent=spec["ua"])
        self.ctx = browser.new_context(**kw)
        if spec.get("ios"):
            self.ctx.add_init_script(IOS_INIT)
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(20_000)
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: %s" % str(e).splitlines()[0][:240]))
        self.page.on("console", lambda m: self.errors.append("console.%s: %s" % (m.type, m.text[:240])) if m.type == "error" else None)
        self.cdp = self.ctx.new_cdp_session(self.page)
        self.safe_ok = None
        self.insets(spec["safe"])
        self.forced = False

    def insets(self, safe):
        l, t, r, b = safe
        try:
            self.cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": t, "left": l, "right": r, "bottom": b}})
            self.safe_ok = True
        except Exception as e:
            self.safe_ok = "unsupported: %s" % str(e).splitlines()[0][:120]

    @property
    def touch(self):
        return bool(self.spec["mobile"])

    def url(self, **q):
        if self.touch:
            q.setdefault("touch", "1")
        return build_url(self.args.base, **q)

    def goto(self, **q):
        self.page.goto(self.url(**q), wait_until="commit", timeout=60_000)

    def js(self, expr, arg=None):
        try:
            return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)
        except Exception as e:
            return {"__error": str(e).splitlines()[0][:200]}

    def wait(self, expr, timeout=60.0, poll=0.2):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = self.js(expr)
            if v and not (isinstance(v, dict) and v.get("__error")):
                return v
            time.sleep(poll)
        return None

    def ensure_touch(self):
        """M1: ?touch=1 turns html.df-touch on (the INPUT lane). --force-touch sets it when the page did not."""
        if not self.touch:
            return "kbm"
        on = self.js("() => document.documentElement.classList.contains('df-touch')")
        if on is True:
            return "input"
        if self.args.force_touch:
            self.js("() => { const h = document.documentElement; h.classList.remove('df-kbm'); h.classList.add('df-touch'); }")
            self.forced = True
            time.sleep(0.2)
            return "forced"
        return "off"

    def tap(self, sel, settle=0.45):
        try:
            loc = self.page.locator(sel).first
            if self.touch:
                loc.tap(timeout=12000)                 # a loaded GPU (parallel runs) slows Playwright's stability wait
            else:
                b = loc.bounding_box(timeout=12000)
                self.page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
                self.page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            time.sleep(settle)
            return True
        except Exception as e:
            self.errors.append("tap %s: %s" % (sel, str(e).splitlines()[0][:160]))
            return False

    def shot(self, step):
        path = os.path.join(SHOTS, "layout_%s_%s.png" % (self.key, step))
        try:
            self.page.screenshot(path=path, scale="css", timeout=20_000)
        except Exception as e:
            self.errors.append("screenshot %s: %s" % (step, str(e).splitlines()[0][:160]))
            return None
        return os.path.relpath(path, os.path.dirname(SHOTS)).replace("\\", "/")

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass


def screen_is(d, s, timeout=6.0):
    return d.wait("() => { const m = window.__DF__ && window.__DF__.menu && window.__DF__.menu(); return m && m.screen === %s ? true : null; }" % json.dumps(s), timeout)


def go(d, sel, scr, flow):
    """tap `sel` and confirm the menus now show `scr` (one more tap if not); a miss is a flow problem, never a silent
    layout check of the wrong screen"""
    for attempt in range(2):
        d.tap(sel)
        if screen_is(d, scr, 5.0):
            return True
    cur = d.js("() => { const m = window.__DF__ && window.__DF__.menu && window.__DF__.menu(); return m ? m.screen : null; }")
    flow.append("tap %s did not reach the %s screen (on %s)" % (sel, scr, cur))
    print("  FLOW  tap %s did not reach %s (on %s)" % (sel, scr, cur))
    return False


def run_device(browser, key, args, steps, out):
    spec = DEVICES[key]
    d = Dev(browser, key, spec, args)
    res = {"device": key, "spec": {k: v for k, v in spec.items() if k != "ua"}, "steps": {}, "safeOverride": d.safe_ok}
    out[key] = res

    def record(step, extra=None, check=True):
        r = {"problems": []}
        if check:
            for attempt in range(2):
                try:
                    r = check_page(d.page, "%s/%s" % (key, step))
                    break
                except Exception as e:                  # a navigation mid-check (a dev-server reload): once more
                    r = {"problems": [{"kind": "flow", "msg": "layout read-back failed: %s" % str(e).splitlines()[0][:160]}]}
                    time.sleep(1.5)
        if extra:
            r.update(extra)
        r["menuScreen"] = d.js("() => { const m = window.__DF__ && window.__DF__.menu && window.__DF__.menu(); return m && m.visible ? m.screen : null; }")
        r["shot"] = d.shot(step)
        res["steps"][step] = r
        n = len(r.get("problems") or [])
        print("  %-12s %s%s" % (step, "ok" if n == 0 else "%d problem(s)" % n,
                                "" if n == 0 else ": " + "; ".join(p["msg"] for p in r["problems"][:4])))
        return r

    def menus():
        menu_steps = [s for s in steps if s in MENU_STEPS]
        if menu_steps:
            d.goto()
            if "loading" in menu_steps:
                if d.wait("() => { const c = document.querySelector('#df-boot:not(.gone) .df-card .df-progress'); return c && c.getBoundingClientRect().width > 0 ? true : null; }", 20):
                    time.sleep(0.4)
                    d.ensure_touch()
                    record("loading")
            ok = d.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase === 'menu') || null", 120)
            if not ok:
                res["fatal"] = "the lobby never reached phase 'menu' (%s)" % d.js("() => window.__DF__ && window.__DF__.state && window.__DF__.state().phase")
                print("  FATAL", res["fatal"])
                return
            res["touchMode"] = d.ensure_touch()
            time.sleep(1.2)
            if "title" in menu_steps:
                record("title")
            flow = res.setdefault("flowErrors", [])
            if "play" in menu_steps or "play_ffa" in menu_steps or "loadout_ffa" in menu_steps:
                if go(d, "#dfm-play", "play", flow):
                    if "play" in menu_steps:
                        record("play")
                    if "play_ffa" in menu_steps or "loadout_ffa" in menu_steps:
                        d.tap("#dfm-mode-ffa")
                        if "play_ffa" in menu_steps:
                            record("play_ffa")
                        if "loadout_ffa" in menu_steps and go(d, "#dfm-playkit", "loadout", flow):
                            time.sleep(0.6)
                            record("loadout_ffa")
                            go(d, ".dfm-s-loadout .dfm-back", "play", flow)
                        d.tap("#dfm-mode-teams")
                    go(d, ".dfm-s-play .dfm-back", "title", flow)
            for step, item, scr in (("loadout", "#dfm-loadout", "loadout"), ("settings", "#dfm-settings", "settings"),
                                    ("howto", "#dfm-how-to-play", "howto"), ("credits", "#dfm-credits", "credits")):
                if step not in menu_steps and not (step == "settings" and "settings_end" in menu_steps):
                    continue
                if not go(d, item, scr, flow):
                    continue
                time.sleep(0.6 if step == "loadout" else 0.3)
                if step in menu_steps:
                    record(step)
                if step == "settings" and "settings_end" in menu_steps:
                    d.js("() => { for (const n of document.querySelectorAll('.dfm-s-settings *')) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) n.scrollTop = n.scrollHeight; } }")
                    time.sleep(0.3)
                    record("settings_end")
                go(d, ".dfm-s-%s .dfm-back" % scr, "title", flow)


    def matches():
        match_steps = [s for s in steps if s in MATCH_STEPS]
        for mode, hud_step, vic_step in (("teams", "hud_teams", "victory"), ("ffa", "hud_ffa", "victory_ffa")):
            want = [s for s in match_steps if s in ((hud_step, "pause", "quit", vic_step) if mode == "teams" else (hud_step, vic_step))]
            if not want:
                continue
            q = {"map": "pier18" if mode == "teams" else "cinder", "autostart": "1", "dev": "1", "seed": "7"}
            if mode == "ffa":
                q["mode"] = "ffa"
            d.goto(**q)
            ok = d.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase === 'play') || null", 120)
            if not ok:
                res.setdefault("fatalMatch", {})[mode] = "no play phase (%s)" % d.js("() => window.__DF__ && window.__DF__.state && window.__DF__.state().phase")
                print("  FATAL match", mode, res["fatalMatch"][mode])
                continue
            res.setdefault("touchModeMatch", {})[mode] = d.ensure_touch()
            time.sleep(4.2)            # the countdown → live
            if hud_step in want:
                # a kill-feed line and the low-tank toast so the HUD shows every block
                d.js("() => { try { window.__DF__.setTank(0, 5); } catch (e) {} }")
                time.sleep(0.8)
                record(hud_step)
            if "pause" in want or "quit" in want:
                t = d.js("() => { try { const t = window.__DF__.touch && window.__DF__.touch(); return t && t.buttons ? t.buttons.find((b) => b.id === 'pause') || null : null; } catch (e) { return null; } }")
                if d.touch and isinstance(t, dict) and t.get("rect") and (t["rect"].get("w", t["rect"].get("width", 0)) or 0) > 0:
                    rc = t["rect"]
                    x = (rc.get("x", rc.get("left", 0)) + (rc.get("w", rc.get("width", 0))) / 2)
                    y = (rc.get("y", rc.get("top", 0)) + (rc.get("h", rc.get("height", 0))) / 2)
                    d.page.touchscreen.tap(x, y)
                else:
                    d.page.keyboard.press("Escape")
                    if d.touch and d.forced:
                        d.ensure_touch()
                screen_is(d, "pause")
                time.sleep(0.4)
                if "pause" in want:
                    record("pause")
                if "quit" in want:
                    d.tap("#df-p-quit")
                    record("quit")
                    d.tap("#dfm-quit-no")
                d.tap("#df-resume")
                d.wait("() => (window.__DF__.state().phase === 'play') || null", 10)
            if vic_step in want:
                d.js("() => { try { window.__DF__.setTimeLeft(0.5); } catch (e) {} }")
                if d.wait("() => { const v = document.querySelector('.df-victory'); return v && !v.hidden ? true : null; }", 15):
                    # the slam-in scales the card (1.4 → 1) and the tally runs on game frames: measure once both are
                    # done (a loaded GPU stretches them), never mid-animation
                    d.wait("() => { const c = document.querySelector('.df-victory-card'); const m = document.querySelector('.df-victory-mark');"
                           " return c && c.getAnimations().length === 0 && m && m.classList.contains('stamped') ? true : null; }", 20)
                    time.sleep(0.6)
                    record(vic_step)
                else:
                    res["steps"][vic_step] = {"problems": [{"kind": "flow", "msg": "the victory slate never showed"}]}
                    print("  %-12s the victory slate never showed" % vic_step)


    def extras():
        if "playcard" in steps:
            d.goto(map="lockwell", seed="3")
            if d.wait("() => { const b = document.getElementById('df-play'); return b && b.getBoundingClientRect().width > 0 ? true : null; }", 120):
                d.ensure_touch()
                time.sleep(0.5)
                record("playcard", {"playText": d.js("() => document.getElementById('df-play').textContent")})
        if "error" in steps:
            d.goto(map="nosuchmap")
            if d.wait("() => { const c = document.querySelector('#df-boot .df-card.df-err'); return c && c.getBoundingClientRect().width > 0 ? true : null; }", 60):
                d.ensure_touch()
                time.sleep(0.3)
                record("error")
        if "rotate" in steps and spec["mobile"]:
            d.page.set_viewport_size({"width": spec["h"], "height": spec["w"]})
            notch = spec["safe"][0] > 0
            d.insets((0, spec["safe"][0] if notch else 0, 0, 34 if notch else spec["safe"][3]))   # portrait: the notch on top
            d.goto()
            d.wait("() => (window.__DF__ && window.__DF__.state && ['menu', 'ready', 'play'].includes(window.__DF__.state().phase)) || null", 120)
            d.ensure_touch()
            time.sleep(1.0)
            info = d.js("() => { const o = document.getElementById('df-rotate'); return o ? { shown: !o.hidden && o.getBoundingClientRect().width > 0, text: o.textContent.trim() } : null; }")
            record("rotate", {"rotate": info})
            d.page.set_viewport_size({"width": spec["w"], "height": spec["h"]})
            d.insets(spec["safe"])

    try:
        for label, fn in (("menus", menus), ("matches", matches), ("extras", extras)):
            try:
                fn()
            except Exception as e:                  # one broken flow never hides the others' results
                msg = "%s flow stopped: %s" % (label, str(e).splitlines()[0][:200])
                res.setdefault("flowErrors", []).append(msg)
                print("  FLOW", msg)
    finally:
        res["forcedTouch"] = d.forced
        res["errors"] = [e for e in d.errors if "favicon" not in e][:40]
        d.close()
    return res


def main():
    ap = argparse.ArgumentParser(description="DYEFIELD layout check (CONTRACT_MOBILE M6), headless")
    ap.add_argument("--base", default="http://localhost:5202/")
    ap.add_argument("--headless", action="store_true", help="accepted for symmetry: this check always runs headless")
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--devices", default=",".join(DEVICES), help="comma list of %s" % ", ".join(DEVICES))
    ap.add_argument("--steps", default=",".join(ALL_STEPS), help="comma list of %s" % ", ".join(ALL_STEPS))
    ap.add_argument("--force-touch", action="store_true", help="set html.df-touch when ?touch=1 did not (INPUT lane not integrated)")
    ap.add_argument("--report", default="layoutcheck")
    args = ap.parse_args()
    devs = [k.strip() for k in args.devices.split(",") if k.strip()]
    steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    bad = [k for k in devs if k not in DEVICES] + [s for s in steps if s not in ALL_STEPS]
    if bad:
        print("unknown device / step: %s" % bad)
        return 2
    server = None
    try:
        server = ensure_server(args.base, not args.no_serve)
    except HarnessError as e:
        print("SETUP FAIL:", e)
        return 2
    out = {}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            try:
                for k in devs:
                    print("%s %dx%d @%sx%s" % (k, DEVICES[k]["w"], DEVICES[k]["h"], DEVICES[k]["dpr"], " touch" if DEVICES[k]["mobile"] else ""))
                    run_device(browser, k, args, steps, out)
            finally:
                browser.close()
    finally:
        stop_server(server)
    total = 0
    for k, r in out.items():
        for s, st in (r.get("steps") or {}).items():
            total += len(st.get("problems") or [])
        total += 1 if r.get("fatal") else 0
        total += len(r.get("fatalMatch") or {})
        total += len(r.get("flowErrors") or [])
    verdict = "LAYOUT OK" if total == 0 else "LAYOUT FAIL (%d problems)" % total
    rep = {"verdict": verdict, "devices": out, "t": time.strftime("%Y-%m-%d %H:%M:%S")}
    path = save_report(args.report, rep, args.base)
    print(verdict)
    print("report:", path)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
