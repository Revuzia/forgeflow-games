#!/usr/bin/env python
"""hud_checks - the restyled HUD (plan P1.9) and the death banner + post-match standings (P4.3), in a real browser.

    python _harness/new/hud_checks.py --disk                    # desktop + phones
    python _harness/new/hud_checks.py --disk --only desktop
    python _harness/new/hud_checks.py --disk --only phones
    python _harness/new/hud_checks.py --disk --only fallback    # the silhouette files 404: text fallback

Run it one at a time (one Chrome). Exit 0 pass / 1 fail / 2 could-not-judge (common.py's contract).

DESKTOP (1280x720, 1366x768, 1920x1080), a standard isla_viva match, the player landed (setup, protected):
  anchors      the signed-off boxes did not move: vitals left 18 / bottom 16 / width 300, slot column right 18 / bottom 54,
               storm row top 56, LVL stack top 94, compass top 4, minimap 14 / 12 / 180, reticle centred
  vitals       HP 78 / shield 62 -> the big number reads 78, the segments read [1,1,1,.12] / [1,1,.48,0], the shield number
               62, the consumables row counts and key chips match the inventory; low HP turns the number red
  card         every gun: name, rarity tag, AUTO (smg, ar) or SEMI (the rest, same rule as weapons.js), "mag / reserve",
               ammo type, mag segments; a held consumable shows its name and count
  storm row    "Circle N of 8 - X damage a second" (no damage at the first wait, the circle's rate while it closes)
  dom writes   120 stepped frames with nothing changing: 0 mutations inside the vitals card and the weapon card
  overlaps     0 intersections among minimap / vitals / storm row / LVL stack / compass / feed / weapon card / slot row
  kill feed    a kill shows the weapon silhouette (assets/hud/wpn_<id>.png) between killer and victim
  death        (staged with the WORST-CASE killer - 100 HP + 100 shield, 14-char name, Grenade Launcher, HEADSHOT - and a FULL
               6-row kill feed, at every size) a banner AT the announcement band's top, clear of the reticle, the LVL chip and the quest card, in the
               viewport; "ELIMINATED", "#N of 50", "ELIMINATED BY", the weapon, HEADSHOT, the distance; a real D press
               still switches the spectated player (W.player.spectating changes); the world keeps rendering behind it
  post-match   a standings table with every player (50 rows), one highlighted row = you, kills and damage columns;
               "Run it back" replays the SAME map (Math.random pinned to a different map), "Find a new match" starts a
               RANDOM map (Math.random pinned: the pinned map is the one that loads)
  diagnostics  0 console / page errors, 0 failed requests over the whole run
PHONES + TABLETS (touch forced, 667x375 / 852x393 / 915x412 / 1180x820 / 1024x600 / 1024x768):
  vitals       the card is <= 46 px tall (<= 50 on the tall tablet) so the prompts and the chat below it keep their rows
  overlaps     0 HUD text under a touch control, 0 pairwise overlaps among the named HUD boxes, 0 clipped / < 12 px / < 44 px
  death        the banner clears the reticle (<= its top) and the top stack, inside the viewport
  post-match   the standings are reachable by scrolling, every button >= 44 px, 0 fonts < 12 px, 0 clipped
FALLBACK (assets/hud/*.png answer 404): the kill feed row reads "killer > victim . Weapon" in text, the weapon card shows
  the rendered 3D thumb, and the game still boots and plays (the one expected 404 is listed, not hidden).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402
import mobilekit as MK  # noqa: E402

DESKTOP = [(1280, 720), (1366, 768), (1920, 1080)]
# the phone sizes plus the two SHORT tablets (a 7-inch 1024x600 and the 9.7-inch iPad 1024x768): taller than 520 px, so they
# get the tablet layout (vitals under the minimap at x 14..254, band top 180) with the reticle only 300 / 384 px down
TOUCH_SIZES = list(MK.PHONE_SIZES) + [("tab7", 1024, 600), ("ipad97", 1024, 768)]
BATTLE_MAPS = ["isla_viva", "ashgrid", "deepwood"]

RECTS_JS = r"""() => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const R = (e) => { const r = e.getBoundingClientRect(); return [+r.left.toFixed(1), +r.top.toFixed(1), +r.right.toFixed(1), +r.bottom.toFixed(1)]; };
  const q = (n) => { const e = document.querySelector('[data-lc="' + n + '"]'); if (!e || !vis(e)) return null;
    const r = e.getBoundingClientRect(); return r.width < 1 || r.height < 1 ? null : R(e); };
  const out = { W: innerWidth, H: innerHeight };
  for (const n of ['bars', 'slotcol', 'slots', 'wcard', 'ammo', 'stormrow', 'meta', 'compass', 'minimap', 'reticle', 'feed', 'death',
                   'ann', 'chat', 'interact', 'pickupmsg', 'stormmsg', 'cons', 'hpnum']) out[n] = q(n);
  const lvl = [...document.querySelectorAll('div')].find((e) => /^LVL \d+$/.test(Array.from(e.childNodes).filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim()) && vis(e));
  out.lvl = lvl ? R(lvl.parentElement) : null;
  const bar = document.getElementById('__ff_controls__'); out.controlbar = bar && vis(bar) ? R(bar) : null;
  return out;
}"""

# one read of everything the HUD says (module readback + a few DOM texts)
FEEL_JS = r"""() => { const L = window.__LC__; const f = L.feel ? L.feel() : null; return f && f.hud ? f.hud : null; }"""

SETUP_JS = r"""(o) => {
  const W = window.__LC__.W, p = W.player, inv = p.inventory;
  inv.slots[0] = { kind: 'weapon', id: 'pistol', rarity: 0, mag: 16 };
  inv.slots[1] = { kind: 'weapon', id: 'ar', rarity: 1, mag: 30 };
  inv.slots[2] = { kind: 'weapon', id: 'shotgun', rarity: 2, mag: 5 };
  inv.slots[3] = { kind: 'consumable', id: 'bandage', count: 5 };
  inv.slots[4] = { kind: 'consumable', id: 'big_shield', count: 2 };
  inv.ammo.light = 36; inv.ammo.medium = 150; inv.ammo.shells = 20; inv.ammo.heavy = 12; inv.ammo.grenades = 8;
  W.equipSlot(p, 1);
  p.hp = o.hp; p.shield = o.shield;
  return { slots: inv.slots.map((s) => s && s.id), w: p.weapon && p.weapon.id };
}"""

EQUIP_JS = r"""(o) => {
  const W = window.__LC__.W, p = W.player;
  p.inventory.slots[0] = o.slot;
  W.equipSlot(p, 0);
  if (p.weapon && o.mag != null) p.weapon.magAmmo = o.mag;
  return p.weapon && p.weapon.id;
}"""

# every mutation inside the vitals + weapon card subtrees (the HUD must write only on change)
SPY_JS = r"""() => {
  window.__HUDSPY__ = { n: 0, what: [] };
  const targets = ['bars', 'wcard'].map((n) => document.querySelector('[data-lc="' + n + '"]')).filter(Boolean);
  const mo = new MutationObserver((ms) => { for (const m of ms) { window.__HUDSPY__.n++; if (window.__HUDSPY__.what.length < 6) window.__HUDSPY__.what.push(m.type + ' ' + (m.target.className || m.target.nodeName)); } });
  for (const t of targets) mo.observe(t, { subtree: true, attributes: true, characterData: true, childList: true });
  window.__HUDSPY_MO__ = mo;
  return targets.length;
}"""

FEED_JS = r"""() => {
  const f = document.querySelector('[data-lc="feed"]'); if (!f) return null;
  const rows = [...f.children].filter((e) => e.style.display !== 'none').map((e) => {
    const img = e.querySelector('img'); const shown = !!(img && getComputedStyle(img).display !== 'none');
    return { text: e.textContent, img: shown ? { src: (img.getAttribute('src') || '').slice(-22), w: img.naturalWidth, h: img.naturalHeight, rect: (() => { const r = img.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() } : null, cls: e.className };
  });
  return rows;
}"""

DEATH_JS = r"""() => {
  const d = document.querySelector('[data-lc="death"]'); if (!d) return null;
  const btn = [...d.querySelectorAll('button')].find((b) => /MATCH STATS/.test(b.textContent));
  const r = btn ? btn.getBoundingClientRect() : null;
  return { text: d.innerText.replace(/\s+/g, ' ').trim(), btn: r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), Math.round(r.height)] : null,
           img: (() => { const i = d.querySelector('img'); return i && getComputedStyle(i).display !== 'none' ? (i.getAttribute('src') || '').slice(-22) : null; })() };
}"""

POST_JS = r"""() => {
  const post = document.querySelector('[data-lc="post"]'); if (!post) return null;
  const rows = [...post.querySelectorAll('tbody tr')];
  const me = rows.filter((r) => r.classList.contains('me'));
  const heads = [...post.querySelectorAll('th')].map((t) => t.textContent.trim());
  const btns = [...post.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; });
  const cells = (r) => [...r.children].map((c) => c.textContent.trim());
  const sc = post.querySelector('[data-lc="standscroll"]');
  const mer = me[0] ? me[0].getBoundingClientRect() : null, scr = sc ? sc.getBoundingClientRect() : null;
  // a row that straddles the sticky header's bottom edge shows as a sliver of text peeking out under (and through) the header
  const th0 = post.querySelector('th'), hb = th0 ? th0.getBoundingClientRect().bottom : 0;
  const hdrBg = th0 ? getComputedStyle(th0).backgroundColor : '';
  const straddle = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.top < hb - 1 && b.bottom > hb + 1 && !!scr && b.bottom > scr.top; }).length;
  return { rows: rows.length, me: me.length, meCells: me[0] ? cells(me[0]) : null, first: rows[0] ? cells(rows[0]) : null, heads, btns,
           title: (post.querySelector('[data-lc="posttitle"]') || {}).textContent, tiles: [...post.querySelectorAll('.lc-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
           straddle, hdrBg, meVisible: !!(mer && scr && mer.bottom > scr.top && mer.top < scr.bottom), scrollable: !!(sc && sc.scrollHeight > sc.clientHeight + 2),
           postScrolls: post.scrollHeight > post.clientHeight + 2 };
}"""


# the WORST-CASE death, deterministic (the old gate killed the player with whichever bot came first, so the recap pill's length
# - and with it whether the banner wrapped to a second row and ran into the kill feed - changed from run to run):
# the killer is at full health AND full shield (the longest "THEY HAD n HP + n shield LEFT"), has the longest bot name (14 chars),
# the longest weapon name (Grenade Launcher), a HEADSHOT and a 3-digit distance (the game measures it itself), and the kill feed is FULL (6 rows of the longest names)
WORST_WEAPON = "glauncher"
WORST_WEAPON_NAME = "Grenade Launcher"
FILL_FEED_JS = r"""() => { const W = window.__LC__.W;
  // ONE living killer for all six rows (the old fill used a fresh killer per row: 12 bots per call, so six sizes ran the pool dry and
  // the feed was empty at the later sizes - the gate passed or failed depending on how many bots were left)
  const alive = W.actors.filter((a) => a.id !== W.player.id && a.alive && !a.isDummy);
  if (alive.length < 3) return 0;
  const kil = alive[0]; kil.name = 'HighGroundHera';
  const vics = alive.slice(1, 7);
  for (const vic of vics) { vic.name = 'BoxedLikeAFish'; W.hurtActor(vic, 9999, kil.id, 'shotgun', false); }
  return vics.length; }"""
WORST_DEATH_JS = r"""(wid) => { const W = window.__LC__.W;
  const bot = W.actors.find((a) => a.id !== W.player.id && a.alive && !a.isDummy);
  bot.name = 'BoxedLikeAFish'; bot.hp = 100; bot.shield = 100; bot.dmgFrom = bot.dmgFrom || {}; bot.dmgFrom[W.player.id] = 100;
  W.player.lastHit = null;
  W.hurtActor(W.player, 9999, bot.id, wid, true);
  return { by: bot.name, alive: W.player.alive }; }"""


def isect(a, b):
    if not a or not b:
        return False
    return min(a[2], b[2]) - max(a[0], b[0]) > 1 and min(a[3], b[3]) - max(a[1], b[1]) > 1


def near(a, b, tol=0.6):
    return a is not None and abs(a - b) <= tol


def vit_ok(segs, want, tol=0.03):
    return isinstance(segs, list) and len(segs) == len(want) and all(abs((x if x is not None else -9) - w) <= tol for x, w in zip(segs, want))


def pin_random(s, value):
    s.js("(v) => { if (!window.__RANDOM0__) window.__RANDOM0__ = Math.random; Math.random = () => v; return true; }", value)


def unpin_random(s):
    s.js("() => { if (window.__RANDOM0__) { Math.random = window.__RANDOM0__; } return true; }")


def step(s, n=3, render=False):
    s.step_frames(n, 1 / 60, render=render)


def start_landed(s, seed=7, map_id="isla_viva", mode="standard", guard_first=False):
    # guard_first: install the guard in the lobby, BEFORE the Enter that starts the drop (hud_cycle's race fix, L4-gates 2026-10-13)
    st = s.start_match(mode, seed, map_id, enter=True, guard=guard_first)
    s.guard_player(True)
    info = s.land(120, protect=True)
    if guard_first:
        info["guardBeforeEnter"] = st.get("guardBeforeEnter")
    return info


# ───────────────────────────────────────── desktop ─────────────────────────────────────────
def desktop(v, args):
    with C.Session(args, "hud_checks-desktop", viewport={"width": 1280, "height": 720}) as s:
        s.boot()
        v.info("landed (setup, protected)", start_landed(s))
        s.freeze_loop()
        v.info("setup", s.js(SETUP_JS, {"hp": 100, "shield": 100}))
        step(s, 6)

        # --- anchors: the signed-off boxes did not move ---
        for (w, h) in DESKTOP:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.6)
            step(s, 4)
            r = s.js(RECTS_JS)
            s.screenshot(os.path.join(C.SHOTS, "hud_match_%dx%d.png" % (w, h)))
            ok = (r["bars"] and near(r["bars"][0], 18) and near(r["bars"][2], 318) and near(r["bars"][3], h - 16)
                  and r["slotcol"] and near(r["slotcol"][2], w - 18) and near(r["slotcol"][3], h - 54)
                  and r["stormrow"] and near(r["stormrow"][1], 56)
                  and r["compass"] and near(r["compass"][1], 4)
                  and r["minimap"] and near(r["minimap"][0], 14) and near(r["minimap"][1], 12) and near(r["minimap"][2] - r["minimap"][0], 180)
                  and r["lvl"] and r["meta"] and near(r["meta"][1], 94))
            v.check("%dx%d: the signed-off anchors are unchanged (vitals 18/16/300, slot column 18/54, storm row top 56, LVL stack 94, compass 4, minimap 14/12/180)" % (w, h),
                    bool(ok), {k: r.get(k) for k in ("bars", "slotcol", "stormrow", "meta", "compass", "minimap")})
            ret = r.get("reticle")
            v.check("%dx%d: the reticle is pinned to the centre" % (w, h),
                    bool(ret) and near((ret[0] + ret[2]) / 2, w / 2, 1.5) and near((ret[1] + ret[3]) / 2, h / 2, 1.5), ret)
            names = ["minimap", "bars", "stormrow", "meta", "compass", "feed", "wcard", "slots", "controlbar"]
            pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if isect(r.get(a), r.get(b))]
            v.check("%dx%d: 0 overlaps among minimap / vitals / storm row / LVL stack / compass / feed / weapon card / slot row / portal bar" % (w, h),
                    not pairs, {"overlaps": pairs, "rects": {n: r.get(n) for n in names}})
            am = r.get("ammo")
            v.check("%dx%d: the ammo count clears the portal control bar" % (w, h), bool(am) and not isect(am, r.get("controlbar")), {"ammo": am, "bar": r.get("controlbar")})
            vh = (r["bars"][3] - r["bars"][1]) if r.get("bars") else None
            v.check("%dx%d: the vitals card stays compact (<= 100 px tall)" % (w, h), vh is not None and vh <= 100, {"h": vh})
        s.page.set_viewport_size({"width": 1280, "height": 720})
        s.sleep(0.6)
        step(s, 4)

        # --- vitals (the guard tops the player up every frame: off while the numbers are set by hand) ---
        s.guard_player(False)
        s.js("() => { const p = window.__LC__.W.player; p.hp = 78; p.shield = 62; }")
        step(s, 4)
        f = s.js(FEEL_JS)
        vit = (f or {}).get("vitals")
        if not vit:
            v.cnj("vitals read-back", "hud readback has no vitals block: %s" % json.dumps(f)[:200])
        else:
            v.check("vitals: HP 78 / shield 62 -> number 78, HP segments [1,1,1,.12], shield segments [1,1,.48,0]",
                    vit["hp"] == 78 and vit["shield"] == 62 and vit_ok(vit["hpSegs"], [1, 1, 1, 0.12]) and vit_ok(vit["shieldSegs"], [1, 1, 0.48, 0]), vit)
            num = s.js("() => ({ hp: document.querySelector('[data-lc=hpnum] b').textContent, sh: document.querySelector('[data-lc=shieldbar] .lc-vn').textContent })")
            v.check("vitals: the DOM prints 78 and 62 (no % text, no emoji)", num["hp"] == "78" and num["sh"] == "62", num)
            cons = {c["id"]: c for c in vit["cons"]}
            v.check("vitals: the consumables row counts match the inventory (bandage 5 on slot 4, big shield 2 on slot 5, others 0)",
                    cons["bandage"]["n"] == 5 and cons["bandage"]["key"] == 4 and cons["big_shield"]["n"] == 2 and cons["big_shield"]["key"] == 5
                    and cons["medkit"]["n"] == 0 and cons["mini_shield"]["n"] == 0, vit["cons"])
            keys = s.js("() => [...document.querySelectorAll('[data-lc=cons] kbd')].map((k) => k.textContent)")
            v.check("vitals: the key chips read the slot keys (4 and 5)", "4" in keys and "5" in keys, keys)
            # low HP: yellow at 40, red + pulse at 25
            s.js("() => { const p = window.__LC__.W.player; p.hp = 20; p.shield = 0; }")
            step(s, 3)
            vit2 = s.js(FEEL_JS)["vitals"]
            cls = s.js("() => ({ num: document.querySelector('[data-lc=hpnum]').className, row: document.querySelector('[data-lc=hpbar]').className })")
            v.check("vitals: HP 20 -> number 20, state 2 (critical), number + bar classes carry cr",
                    vit2["hp"] == 20 and vit2["hpState"] == 2 and "cr" in cls["num"] and "cr" in cls["row"] and vit_ok(vit2["hpSegs"], [0.8, 0, 0, 0]) and vit_ok(vit2["shieldSegs"], [0, 0, 0, 0]),
                    {"vit": vit2, "cls": cls})
            s.js("() => { const p = window.__LC__.W.player; p.hp = 100; p.shield = 100; }")
            s.guard_player(True)
            step(s, 3)

        # --- weapon card: every gun ---
        want = [
            ("pistol", 0, 16, "Pistol", "common", "SEMI", "LIGHT AMMO", "16 / 36"),
            ("smg", 1, 30, "SMG", "uncommon", "AUTO", "LIGHT AMMO", "30 / 36"),
            ("ar", 2, 30, "Assault Rifle", "rare", "AUTO", "MEDIUM AMMO", "30 / 150"),
            ("shotgun", 3, 5, "Shotgun", "epic", "SEMI", "SHELLS", "5 / 20"),
            ("sniper", 4, 1, "Sniper", "legendary", "SEMI", "HEAVY AMMO", "1 / 12"),
            ("glauncher", 0, 4, "Grenade Launcher", "common", "SEMI", "GRENADES", "4 / 8"),
        ]
        bad = []
        for wid, rar, mag, nm, rn, mode, atype, count in want:
            s.js(EQUIP_JS, {"slot": {"kind": "weapon", "id": wid, "rarity": rar, "mag": mag}, "mag": mag})
            step(s, 4)
            c = s.js(FEEL_JS)["card"]
            fit = s.js("() => { const r = document.querySelector('[data-lc=wrow1]'); const w = document.querySelector('[data-lc=wcard]'); return { row: [r.scrollWidth, r.clientWidth], card: [w.scrollWidth, w.clientWidth] }; }")
            ok = (c and c["weapon"] == wid and c["name"] == nm and c["tag"] == rn and c["mode"] == mode and c["ammoType"] == atype and c["count"] == count
                  and len(c["magSegs"]) >= 1 and abs(c["magSegs"][0] - 1) < 0.01
                  and fit["row"][0] <= fit["row"][1] + 1 and fit["card"][0] <= fit["card"][1] + 1)
            if not ok:
                bad.append({"want": [wid, nm, rn, mode, atype, count], "got": c, "fit": fit})
        v.check("weapon card: name, rarity tag, AUTO (smg, ar) / SEMI (pistol, shotgun, sniper, launcher), 'mag / reserve', ammo type, full mag bar, name row fits the card (no overflow) - all 6 guns",
                not bad, bad[:3])
        # a part-empty mag draws a part-filled bar
        s.js(EQUIP_JS, {"slot": {"kind": "weapon", "id": "ar", "rarity": 1, "mag": 30}, "mag": 15})
        step(s, 4)
        c = s.js(FEEL_JS)["card"]
        v.check("weapon card: AR with 15 / 30 -> 'x / 150', segments [1,1,1,1,1,0,0,0,0,0]", bool(c) and c["count"] == "15 / 150" and vit_ok(c["magSegs"], [1] * 5 + [0] * 5), c)
        # picture: the shipped silhouette (feature-detected) or the 3D thumb
        s.sleep(1.2)
        step(s, 3)
        c = s.js(FEEL_JS)["card"]
        v.check("weapon card: a picture is showing (silhouette file or the rendered thumb)", bool(c and c["pic"]), c)
        # a held consumable
        s.js(EQUIP_JS, {"slot": {"kind": "consumable", "id": "medkit", "count": 3}, "mag": None})
        step(s, 4)
        c = s.js(FEEL_JS)["card"]
        v.check("weapon card: a held consumable reads its name and count ('MEDKIT', 'x3')", bool(c) and c["name"] == "MEDKIT" and c["count"] == "x3", c)
        s.js(EQUIP_JS, {"slot": {"kind": "weapon", "id": "ar", "rarity": 1, "mag": 30}, "mag": 30})
        step(s, 4)

        # --- storm row line ---
        sl = s.js(FEEL_JS).get("stormLine")
        v.check("storm row: 'Circle 1 of 8' with no damage at the first wait", bool(sl) and sl.startswith("Circle 1 of 8") and "no damage yet" in sl, sl)
        # (the CLOSING line is judged after the death-banner checks: the sim has to run ~100 s to get there, and by then the bots have
        #  finished most of the match - staging the banner and a full kill feed on a nearly finished match ended the match under the gate)
        # --- DOM writes only on change ---
        s.guard_player(True)
        s.js("() => { const p = window.__LC__.W.player; p.hp = 100; p.shield = 100; }")
        step(s, 6)
        s.js(SPY_JS)
        step(s, 120)
        spy = s.js("() => { const r = window.__HUDSPY__; window.__HUDSPY_MO__.takeRecords(); window.__HUDSPY_MO__.disconnect(); return r; }")
        v.check("dom writes: 120 stepped frames with nothing changing -> 0 mutations in the vitals card and the weapon card", spy["n"] == 0, spy)
        # a change IS written: one hit moves the segments (and only then)
        s.js(SPY_JS)
        s.js("() => { const p = window.__LC__.W.player; p.shield = 50; }")
        step(s, 4)
        spy2 = s.js("() => { const r = window.__HUDSPY__; window.__HUDSPY_MO__.takeRecords(); window.__HUDSPY_MO__.disconnect(); return r; }")
        v.check("dom writes: shield 100 -> 50 is written (the spy sees it)", spy2["n"] >= 2, spy2)
        s.js("() => { const p = window.__LC__.W.player; p.shield = 100; }")
        step(s, 3)

        # --- kill feed with a silhouette ---
        k = s.js("""() => { const W = window.__LC__.W; const bot = W.actors.find((a) => a.id !== W.player.id && a.alive && !a.isDummy);
          W.hurtActor(bot, 9999, W.player.id, 'ar', false); return { victim: bot.name, alive: bot.alive }; }""")
        step(s, 4)
        s.sleep(1.0)
        step(s, 3)
        rows = s.js(FEED_JS)
        mine = [r for r in (rows or []) if k["victim"] in r["text"]]
        if not mine:
            v.cnj("kill feed: a kill shows the weapon silhouette", "the kill's row never appeared: %s" % json.dumps(rows)[:200])
        else:
            im = mine[-1]["img"]
            v.check("kill feed: the row shows the AR silhouette (assets/hud/wpn_ar.png, decoded, 14 px tall) between killer and victim, no weapon text",
                    bool(im) and "wpn_ar.png" in im["src"] and im["w"] > 0 and im["rect"][1] >= 12 and "Assault Rifle" not in mine[-1]["text"], mine[-1])
        r = s.js(RECTS_JS)
        v.check("kill feed: the feed box does not overlap the storm row / minimap", not isect(r.get("feed"), r.get("stormrow")) and not isect(r.get("feed"), r.get("minimap")), {"feed": r.get("feed")})

        # --- death banner ---
        s.guard_player(False)
        s.page.set_viewport_size({"width": 1280, "height": 720})
        s.sleep(0.5)
        for (w, h) in DESKTOP:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.6)
            if h == 720 and w == 1280:
                pass
            if not s.js("() => !!document.querySelector('[data-lc=death]')"):
                kk = s.js(WORST_DEATH_JS, WORST_WEAPON)
                v.info("player eliminated by the worst-case killer (100 HP + 100 shield, 14-char name, %s, HEADSHOT)" % WORST_WEAPON_NAME, kk)
                s.sleep(0.5)
            nfeed = s.js(FILL_FEED_JS)          # a FULL kill feed at every size (its rows expire after 6 s)
            step(s, 12, render=True)
            s.sleep(0.4)
            nvis = len(s.js(FEED_JS) or [])
            if nvis < 6:
                v.cnj("%dx%d death banner vs a FULL kill feed" % (w, h), "only %d feed rows visible (staged %s): the overlap check would be vacuous" % (nvis, nfeed))
                continue
            r = s.js(RECTS_JS)
            d = r.get("death")
            if not d:
                v.cnj("%dx%d death banner" % (w, h), "no [data-lc=death] box")
                continue
            ret, lvl, meta, ann = r.get("reticle"), r.get("lvl"), r.get("meta"), r.get("ann")
            band_top = s.js("() => { const f = window.__LC__.feel(); return f.hud.band.top; }")
            v.check("%dx%d: the death banner sits at the announcement band's top (%s), inside the viewport, under the LVL chip and quest card" % (w, h, band_top),
                    near(d[1], band_top, 1.0) and d[0] >= 0 and d[2] <= w and d[3] <= h and (meta is None or d[1] >= meta[3] - 1), {"death": d, "meta": meta, "bandTop": band_top})
            # the reticle: its arms (centre +- 28 box, arms within ~24 px of the centre)
            cy = h / 2
            v.check("%dx%d: the banner ends above the reticle (centre %d, arm tops ~%d)" % (w, h, cy, cy - 20), d[3] <= cy - 18, {"bottom": d[3], "centreY": cy, "height": round(d[3] - d[1], 1)})
            s.screenshot(os.path.join(C.SHOTS, "hud_death_%dx%d.png" % (w, h)))
            hits = [n for n in ("minimap", "stormrow", "meta", "compass", "bars", "wcard", "slots", "feed", "controlbar") if isect(r.get(n), d)]
            v.check("%dx%d: the banner overlaps no HUD box (minimap, storm row, LVL stack, compass, vitals, weapon card, slots, feed, portal bar)" % (w, h), not hits, {"hits": hits, "death": d})
            v.check("%dx%d: the banner is compact (<= 120 px tall) and the live view is not covered (banner area <= 12%% of the screen)" % (w, h),
                    (d[3] - d[1]) <= 120 and ((d[2] - d[0]) * (d[3] - d[1])) / (w * h) <= 0.12, {"w": round(d[2] - d[0]), "h": round(d[3] - d[1]), "feedRows": nfeed, "feed": r.get("feed")})
            ovf = s.js("""() => { const d = document.querySelector('[data-lc=death]'); const W = window.__LC__.W;
              if (!d) return { gone: true, phase: W.phase, over: !!(W.match && W.match.over), post: !!document.querySelector('[data-lc=post]'), alive: W.player && W.player.alive, t: W.t };
              return [...d.querySelectorAll('.lc-d1, .lc-d2, .lc-dp')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className); }""")
            if isinstance(ovf, dict):
                v.cnj("%dx%d banner spill check" % (w, h), "the death banner left the page while it was being measured: %s" % json.dumps(ovf))
                continue
            v.check("%dx%d: no row or pill of the banner spills out of its box (the long recap wraps, the name ellipsizes)" % (w, h), not ovf, ovf)
        s.page.set_viewport_size({"width": 1280, "height": 720})
        s.sleep(0.6)
        step(s, 6, render=True)
        dd = s.js(DEATH_JS)
        t = (dd or {}).get("text", "")
        v.check("death banner: 'ELIMINATED', '#N of 50', 'ELIMINATED BY <name>', the weapon, HEADSHOT, the distance, MATCH STATS",
                bool(dd) and "ELIMINATED" in t and " of 50" in t and "ELIMINATED BY" in t and WORST_WEAPON_NAME in t and "HEADSHOT" in t and re.search(r"\d{2,4} m", t) is not None and "BoxedLikeAFish" in t and "THEY HAD 100 HP + 100 shield LEFT" in t and "MATCH STATS" in t, dd)
        v.check("death banner: the weapon silhouette shows next to the weapon name (file present)", bool(dd and dd.get("img") and ("wpn_%s.png" % WORST_WEAPON) in dd["img"]), dd and dd.get("img"))
        # the world still renders behind it, and A / D still switch the spectated player
        fr0 = s.js("() => window.__LC__.W.kernel.frameNo")
        step(s, 10, render=True)
        fr1 = s.js("() => window.__LC__.W.kernel.frameNo")
        v.check("death: the live view keeps rendering behind the banner (frames advance)", fr1 > fr0, {"before": fr0, "after": fr1})
        sp0 = s.js("() => window.__LC__.W.player.spectating")
        s.press("KeyD")
        s.sleep(0.2)
        step(s, 4, render=True)
        sp1 = s.js("() => window.__LC__.W.player.spectating")
        v.check("death: a REAL D press still switches the spectated player (W.player.spectating changes)", sp0 != sp1 and sp1 is not None, {"before": sp0, "after": sp1})
        vit = s.js(FEEL_JS).get("vitals")
        v.check("death: the vitals follow the spectated player (hp read back, no crash)", bool(vit) and vit["hp"] is not None, vit)

        # --- storm row line, closing phase: fast-forward only until the first circle starts to close (the storm row keeps ticking while you spectate) ---
        ff = s.js("""() => { const C = window.__LC__, W = C.W; let n = 0;
          while (n < 400 && W.phase === 'match' && W.stormCtl && !(W.stormCtl.storm.stateAt(W.t).closing)) { C.fastForward(0.5, 1 / 30); n++; }
          return { steps: n, t: W.t, phase: W.phase }; }""")
        step(s, 40)
        sl2 = s.js(FEEL_JS).get("stormLine")
        if ff["phase"] != "match" or sl2 is None:
            v.cnj("storm row: 'Circle N of 8 - X damage a second' once the circle closes", "the match ended while the sim ran to the closing phase: %s" % json.dumps(ff))
        else:
            v.check("storm row: 'Circle N of 8 - X damage a second' once the circle closes (1 damage a second in circle 1)",
                    "of 8" in sl2 and "1 damage a second" in sl2, {"line": sl2, "ff": ff})

        # --- post-match: a REAL click on MATCH STATS ---
        btn = (dd or {}).get("btn")
        if s.js("() => !!document.querySelector('[data-lc=post]')"):
            v.info("the match ended by itself during the closing-phase fast-forward: the standings are already up (MATCH STATS not clicked)", s.phase())
        elif btn:
            s.page.mouse.click(btn[0], btn[1])
            s.sleep(3.6)
            step(s, 6, render=False)
        else:
            v.cnj("post-match", "no MATCH STATS button to click")
        p = s.js(POST_JS)
        s.screenshot(os.path.join(C.SHOTS, "hud_post_1280x720.png"))
        if not p:
            v.cnj("post-match standings", "no [data-lc=post] after the MATCH STATS click (phase %s)" % s.phase())
        else:
            v.check("post-match: a standings table lists all 50 players with # / PLAYER / KILLS / DAMAGE, 1 highlighted row (you)",
                    p["rows"] == 50 and p["me"] == 1 and p["heads"] == ["#", "PLAYER", "KILLS", "DAMAGE"], {k: p.get(k) for k in ("rows", "me", "heads", "meCells", "first")})
            v.check("post-match: your row is in view in the table", p["meVisible"], {"scrollable": p["scrollable"]})
            v.check("post-match: no half row peeks out under the sticky header (0 rows straddle its bottom edge) and the header is opaque (the row scrolled under it does not ghost through)",
                    p["straddle"] == 0 and p["hdrBg"].startswith("rgb(") and not p["hdrBg"].startswith("rgba("), {"straddle": p["straddle"], "headerBackground": p["hdrBg"]})
            v.check("post-match: the summary shows placement / kills / damage and the two buttons 'Run it back' and 'Find a new match' (+ MAIN MENU)",
                    len(p["tiles"]) == 3 and any(b["t"] == "Run it back" for b in p["btns"]) and any(b["t"].startswith("Find a new match") for b in p["btns"])
                    and any(b["t"] == "MAIN MENU" for b in p["btns"]), {"tiles": p["tiles"], "btns": [b["t"] for b in p["btns"]]})
        # RUN IT BACK: pinned random picks a DIFFERENT map; the same map must load
        m0 = s.js("() => window.__LC__.W.mapId")
        pinned = BATTLE_MAPS[-1] if BATTLE_MAPS[-1] != m0 else BATTLE_MAPS[0]
        if p:
            rb = next((b for b in p["btns"] if b["t"] == "Run it back"), None)
            if rb:
                pin_random(s, 0.99 if pinned == BATTLE_MAPS[-1] else 0.0)
                s.page.mouse.click(rb["x"], rb["y"])           # randomMap() is read inside this click's handler
                unpin_random(s)
                ok = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
                m1 = s.js("() => window.__LC__.W.mapId")
                v.check("'Run it back': the SAME map and mode load (Math.random pinned to %s, the map before was %s)" % (pinned, m0), ok is not None and m1 == m0,
                        {"before": m0, "after": m1, "pinnedWouldPick": pinned, "load_s": ok})
                if ok is not None:
                    s.sleep(0.3)
                    s.page.keyboard.press("Enter")
                    s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
                    s.guard_player(True)
                    s.land(120, protect=True)
                    # finish this match from the HUD side, then FIND A NEW MATCH
                    s.js("() => window.__LC__.W.endMatch(false)")
                    s.sleep(3.6)
                    step(s, 6, render=False)
                    p2 = s.js(POST_JS)
                    fb = next((b for b in (p2 or {"btns": []})["btns"] if b["t"].startswith("Find a new match")), None)
                    if fb:
                        m_before = s.js("() => window.__LC__.W.mapId")
                        want_map = BATTLE_MAPS[-1] if BATTLE_MAPS[-1] != m_before else BATTLE_MAPS[0]
                        pin_random(s, 0.99 if want_map == BATTLE_MAPS[-1] else 0.0)
                        s.page.mouse.click(fb["x"], fb["y"])
                        unpin_random(s)
                        ok2 = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
                        m2 = s.js("() => window.__LC__.W.mapId")
                        v.check("'Find a new match': a RANDOM map loads (Math.random pinned to pick %s; the map before was %s)" % (want_map, m_before),
                                ok2 is not None and m2 == want_map and m2 in BATTLE_MAPS, {"before": m_before, "after": m2, "load_s": ok2})
                    else:
                        v.cnj("'Find a new match'", "no button on the second post-match screen")
            else:
                v.cnj("'Run it back'", "no Run it back button")
        s.thaw_loop()
        d = s.diagnostics()
        probs = C.diag_problems(d, rig=False)
        v.check("0 console / page errors, 0 failed requests, 0 shader errors (match -> death -> standings -> Run it back -> Find a new match)", not probs,
                {"problems": probs[:6], "first": (d["consoleErrors"] + d["pageErrors"] + d["windowErrors"] + d["failedRequests"])[:5]})


# ───────────────────────────────────────── phones ─────────────────────────────────────────
def phones(v, args):
    spec = MK.DEVICES["pixel7"]
    ctx = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
    with C.Session(args, "hud_checks-phones", viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx, init_scripts=[MK.PHONE_NO_LOCK]) as s:
        s.boot(C.build_url(args.base, touch=1))
        s.sleep(1.0)
        s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^GOT IT$/.test(x.textContent.trim())); if (b) b.click(); }")
        v.info("landed (setup, protected)", start_landed(s))
        s.freeze_loop()
        s.js(SETUP_JS, {"hp": 78, "shield": 62})
        step(s, 6)
        # the DEPLOY beat (2.6 s of wall clock from the HUD's first frame) can still be on screen when a fast landing
        # returns; measured 2026-10-12: its subtitle was then judged against a USE button caught mid-relayout by the
        # next viewport switch. The match HUD is judged in its steady state: wait for the band to clear (<= 6 s).
        s.js("""() => new Promise((res) => { const t0 = performance.now(); const tick = () => {
          const a = document.querySelector('[data-lc=ann]');
          if (!a || a.style.opacity === '0' || performance.now() - t0 > 6000) return res(true); setTimeout(tick, 100); }; tick(); })""")
        s.sleep(0.5)
        mounted = {}
        for name, w, h in TOUCH_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.9)
            step(s, 4)
            r = s.js(RECTS_JS)
            tall = h > 520
            lim = 50 if tall else 46
            bh = (r["bars"][3] - r["bars"][1]) if r.get("bars") else None
            v.check("%s %dx%d: the vitals card is <= %d px tall" % (name, w, h, lim), bh is not None and bh <= lim, {"h": bh, "bars": r.get("bars")})
            lay = s.js(MK.LAYOUT_JS)
            v.check("%s %dx%d match HUD: 0 clipped, targets >= 44 px, fonts >= 12 px" % (name, w, h),
                    lay["nClipped"] == 0 and lay["nSmallTargets"] == 0 and lay["nSmallFonts"] == 0,
                    {"clipped": lay["clipped"][:3], "small": lay["smallTargets"][:3], "fonts": lay["smallFonts"][:3]})
            ol = s.js(MK.OVERLAP_JS)
            v.check("%s %dx%d match HUD: 0 HUD text under a touch control / the control bar" % (name, w, h), not ol, ol[:5])
            names = ["minimap", "bars", "stormrow", "meta", "compass", "ammo", "slots", "interact", "chat"]
            pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if isect(r.get(a), r.get(b))]
            v.check("%s %dx%d: 0 pairwise overlaps among the named HUD boxes" % (name, w, h), not pairs, {"pairs": pairs, "rects": {n: r.get(n) for n in names}})
            v.check("%s %dx%d: the vitals card holds the number and both bars (no consumables row, no weapon card chrome)" % (name, w, h),
                    r.get("cons") is None and r.get("wcard") is None and r.get("hpnum") is not None, {"cons": r.get("cons"), "wcard": r.get("wcard")})
            mounted[name] = s.js("() => { const W = window.__LC__.W; return { phase: W.phase, alive: !!(W.player && W.player.alive), touch: !!document.querySelector('[data-touch-ui]') }; }")
        # death banner on the phones
        s.guard_player(False)
        for name, w, h in TOUCH_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.8)
            if not s.js("() => !!document.querySelector('[data-lc=death]')"):
                s.js(WORST_DEATH_JS, WORST_WEAPON)
                s.sleep(0.5)
            nfeed = s.js(FILL_FEED_JS)          # a full kill feed at every size
            step(s, 10, render=True)
            s.sleep(0.4)
            nvis = len(s.js(FEED_JS) or [])
            if nvis < 2:                        # a phone shows only the last two rows (TOUCH_CSS), a tablet all six
                v.cnj("%s %dx%d death banner vs a full kill feed" % (name, w, h), "only %d feed rows visible (staged %s): the overlap check would be vacuous" % (nvis, nfeed))
                continue
            r = s.js(RECTS_JS)
            d = r.get("death")
            if not d:
                v.cnj("%s %dx%d death banner" % (name, w, h), "no banner")
                continue
            s.screenshot(os.path.join(C.SHOTS, "hud_death_%s_%dx%d.png" % (name, w, h)))
            cy = h / 2
            band_top = s.js("() => window.__LC__.feel().hud.band.top")
            v.check("%s %dx%d: the death banner is inside the viewport, at the band's top (%s) and ends above the reticle arms (<= %d)" % (name, w, h, band_top, cy - 17),
                    d[0] >= 0 and d[2] <= w and d[3] <= cy - 17 + 1 and near(d[1], band_top, 1.0), {"death": d, "centre": cy})
            pairs = [(a, b) for a in ["minimap", "stormrow", "meta", "compass", "bars", "slots", "chat", "feed", "controlbar"] for b in ["death"] if isect(r.get(a), r.get(b))]
            v.check("%s %dx%d: the death banner overlaps no HUD box (minimap, storm row, LVL stack, compass, vitals, slots, chat, kill feed, portal bar)" % (name, w, h), not pairs, {"pairs": pairs, "death": d})
            lay = s.js(MK.LAYOUT_JS)
            v.check("%s %dx%d death: 0 clipped, targets >= 44 px, fonts >= 12 px" % (name, w, h),
                    lay["nClipped"] == 0 and lay["nSmallTargets"] == 0 and lay["nSmallFonts"] == 0,
                    {"clipped": lay["clipped"][:3], "small": lay["smallTargets"][:3], "fonts": lay["smallFonts"][:3]})
        # post-match on the phones
        s.js("() => window.__LC__.W.endMatch(false)")
        s.sleep(3.6)
        step(s, 6, render=False)
        for name, w, h in TOUCH_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.9)
            p = s.js(POST_JS)
            if not p:
                v.cnj("%s %dx%d post-match" % (name, w, h), "no post-match screen")
                continue
            lay = s.js(MK.LAYOUT_JS)
            v.check("%s %dx%d post-match: 50 standings rows reachable, every button >= 44 px, 0 fonts < 12 px, 0 clipped, no page scroll" % (name, w, h),
                    p["rows"] == 50 and all(b["h"] >= 44 for b in p["btns"]) and lay["nSmallFonts"] == 0 and lay["nClipped"] == 0 and not lay["pageScrolls"],
                    {"rows": p["rows"], "btns": [(b["t"], b["h"]) for b in p["btns"]], "fonts": lay["smallFonts"][:3], "clipped": lay["clipped"][:3], "pageScrolls": lay["pageScrolls"]})
        s.thaw_loop()
        d = s.diagnostics()
        probs = C.diag_problems(d, rig=False)
        v.check("phones: 0 console / page errors, 0 failed requests", not probs, {"problems": probs[:6]})


# ───────────────────────────────────────── fallback ─────────────────────────────────────────
def fallback(v, args):
    """assets/hud/*.png answer 404 (the other lane's files absent): text in the feed, the thumb on the card."""
    with C.Session(args, "hud_checks-fallback", viewport={"width": 1280, "height": 720}) as s:
        # a route in FRONT of the disk server: every wpn_*.png is a 404
        def deny(route):
            route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})
        s.context.route("**/assets/hud/wpn_*.png", deny)          # registered last = matched first
        s.boot()
        v.info("landed (setup, protected)", start_landed(s))
        s.freeze_loop()
        s.js(SETUP_JS, {"hp": 100, "shield": 100})
        step(s, 6)
        s.sleep(1.5)
        step(s, 4)
        k = s.js("""() => { const W = window.__LC__.W; const bot = W.actors.find((a) => a.id !== W.player.id && a.alive && !a.isDummy);
          W.hurtActor(bot, 9999, W.player.id, 'ar', false); return { victim: bot.name }; }""")
        step(s, 4)
        s.sleep(0.8)
        rows = s.js(FEED_JS)
        mine = [r for r in (rows or []) if k["victim"] in r["text"]]
        v.check("fallback: the kill-feed row is TEXT ('You > victim . Assault Rifle') and shows no image",
                bool(mine) and mine[-1]["img"] is None and "Assault Rifle" in mine[-1]["text"], mine[-1] if mine else rows)
        c = s.js(FEEL_JS)["card"]
        v.check("fallback: the weapon card still shows a picture (the rendered 3D thumb) and the count", bool(c) and c["count"] == "30 / 150", c)
        sil = s.js(FEEL_JS).get("silhouettes")
        v.check("fallback: the silhouette set is marked absent after the first failure (no further requests)", bool(sil) and sil["off"] is True, sil)
        n404 = [f for f in s.failed if "wpn_" in f]
        v.check("fallback: at most ONE wpn_*.png request failed (not six)", len(n404) <= 1, n404)
        s.thaw_loop()
        d = s.diagnostics()
        # diag_problems() returns COUNTS ("1 failed request(s)"), so the denied file has to be filtered out of the raw lists:
        # its failed request names wpn_, and Chrome's matching console line is "Failed to load resource: ... status of 404"
        # (no URL in the text), allowed once per denied wpn_ request and no more
        f_all = list(d.get("failedRequests") or [])
        f_other = [f for f in f_all if "wpn_" not in f]
        n_wpn = len(f_all) - len(f_other)
        c_all = list(d.get("consoleErrors") or [])
        c404 = [t for t in c_all if "status of 404" in t]
        c_other = [t for t in c_all if "status of 404" not in t] + c404[n_wpn:]
        other = {"failedRequests": f_other, "consoleErrors": c_other, "pageErrors": d.get("pageErrors") or [],
                 "windowErrors": d.get("windowErrors") or [], "shader": d.get("shader") or []}
        v.check("fallback: nothing else failed (0 page errors; the one denied file is the only failed request and its 404 line the only console error)",
                not any(other.values()), {"other": {k: x[:4] for k, x in other.items() if x}, "deniedRequests": n_wpn, "allowed404Lines": min(len(c404), n_wpn)})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", choices=["desktop", "phones", "fallback"], default=None)
    args = ap.parse_args()

    def body(v):
        if args.only in (None, "desktop"):
            desktop(v, args)
        if args.only in (None, "phones"):
            phones(v, args)
        if args.only in (None, "fallback"):
            fallback(v, args)
    return C.run_gate("hud_checks", body, args)


if __name__ == "__main__":
    sys.exit(main())
