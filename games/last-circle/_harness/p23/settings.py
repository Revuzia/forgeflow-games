#!/usr/bin/env python
"""settings - P2-G settings / map / onboarding (lane hud) + C-GFX graphics tiers incl. ULTRA (lane boot). Plan P2-G gates: "every tab except Controls
fits at 1280x720; rebinding Drop to G works and Q does nothing; at 130% HUD scale every panel stays inside its anchor corner; each hint fires exactly
once" + section 5 "3 colour-blind modes", "local minimap at 3 m/px or finer" + the owner's LOW / MEDIUM / HIGH / ULTRA.

    python _harness/p23/settings.py --disk
    python _harness/p23/settings.py --rev 9aa2b746                 # control: the P2 base (3 tiers, one settings page, whole-map minimap) - MUST FAIL
    python _harness/p23/settings.py --disk --plant ultra-noop      # W.setGfx('tier', 'ultra') applies HIGH - MUST FAIL (ultra row)
    python _harness/p23/settings.py --disk --plant scale-center    # HUD scale grows every anchor from its centre - MUST FAIL (anchor row)
    python _harness/p23/settings.py --disk --plant cvd-sticky      # colour-vision 'off' keeps the last mode - MUST FAIL (colour-blind row)
    python _harness/p23/settings.py --lanes hud,boot               # validation: those lanes' work served over the base

One Chrome at 1280x720 (fresh profile = a first run on this box's default GPU, the UHD iGPU; ?hints=1). Rows:
  contract       W.setGfx, W.gfxTier, the settings modal with tab buttons
  auto-tier      the first-run pick on the iGPU is never ULTRA (owner: auto-tier never picks ultra unless the GPU is clearly fast)
  tabs           GAME / VIDEO / AUDIO / CONTROLS / ACCESSIBILITY; every tab but CONTROLS: every visible control inside 1280x720 and the card
  presets        VIDEO shows LOW / MEDIUM / HIGH / ULTRA; REAL clicks: W.gfxTier follows; pixel ratio and shadow map size never fall going
                 low -> medium -> high -> ultra and ULTRA is strictly above HIGH in at least one (DPR up to 2 / shadow / draw distance)
  ultra-persists ULTRA chosen, the page reloaded: still ULTRA (a player's choice is never auto-overridden)
  rebind         CONTROLS: the Drop row rebound to G by a REAL click + key; in a practice match Q drops nothing, G drops the held gun
  colour-blind   ACCESSIBILITY lists 3 colour-vision modes; each changes the rendered frame (mean |diff| >= 1/255 vs off), off restores it
  hud-scale      130 %: every anchored HUD panel keeps its anchor corner (+-2 px) and stays inside the viewport
  minimap        the local minimap draws <= 3 m per CSS px (hud readback) and is local (not the whole map)
  hints          a standard match with ?hints=1: no hint id shown twice; a second match shows none of the first match's ids again
  errors
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    # setGfx('daltonize', 'off') keeps the last mode on: a mode that never turns off - MUST FAIL (colour-blind: off restores)
    "cvd-sticky": "const sg = W.setGfx; let last = null; W.setGfx = function (k, v) { if (k === 'daltonize') { if (v === 'off' && last) v = last; else if (v !== 'off') last = v; } return sg.call(this, k, v); }",
    "ultra-noop": "const sg = W.setGfx; W.setGfx = function (k, v) { if (k === 'tier' && v === 'ultra') v = 'high'; return sg.call(this, k, v); }",
    # the HUD scale grows each anchored panel from its CENTRE (whatever the build's own scaling does): applied while hudScale > 1. A page-wide
    # stylesheet switched by an html attribute on a wall-clock timer that re-reads window.__LC__.W (the first version hung off kernel._updaters,
    # which the match start did not keep: hud-scale PASSED under it twice - it never bit)
    "scale-center": "const css = 'html[data-p23sc] [data-lc=minimap], html[data-p23sc] [data-lc=bars], html[data-p23sc] [data-lc=slotcol], html[data-p23sc] [data-lc=meta], html[data-p23sc] [data-lc=compass], html[data-p23sc] [data-lc=stormrow] { transform: scale(1.3) !important; transform-origin: 50% 50% !important; }';"
                    " const st = document.createElement('style'); st.id = 'p23-scale-center'; st.textContent = css; document.head.appendChild(st);"
                    " clearInterval(window.__p23sc); window.__p23sc = setInterval(() => { const w = window.__LC__ && window.__LC__.W; const on = !!(w && w.settings && w.settings.hudScale > 1.01);"
                    " if (on) document.documentElement.setAttribute('data-p23sc', '1'); else document.documentElement.removeAttribute('data-p23sc'); }, 30)",
}
HUDMOD_JS = r"""async () => { if (window.__HUDMOD__) return true; const sc = [...document.scripts].find((x) => /ffg_boot3d\.js/.test(x.src)); if (!sc) return false;
  window.__HUDMOD__ = await import(new URL('royale/hud.js' + new URL(sc.src).search, sc.src).href); return true; }"""
BTN_JS = r"""(re) => { const b = [...document.querySelectorAll('button, .lc-tab, .lc-sopt, [role=button]')].find((x) => x.offsetParent && new RegExp(re, 'i').test((x.textContent || '').trim()));
  if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""
FIT_JS = r"""() => { const tabs = document.querySelector('[data-lc="settabs"]'); const box = tabs ? tabs.parentElement : null; if (!box) return null; const B = box.getBoundingClientRect();
  const out = []; for (const e of box.querySelectorAll('button, input, select, .lc-sopt, [role=slider]')) { if (!e.offsetParent) continue; const r = e.getBoundingClientRect(); if (r.width === 0) continue;
    if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.left < B.left - 0.5 || r.right > B.right + 0.5 || r.top < B.top - 0.5 || r.bottom > B.bottom + 0.5)
      out.push((e.textContent || e.value || e.tagName).trim().slice(0, 24)); }
  return { out, box: [B.left, B.top, B.right, B.bottom].map(Math.round) }; }"""
GFX_JS = r"""() => { const W = window.__LC__.W, k = W.kernel, r = k.renderer; const sun = k.sun || (W.scene && W.scene.children.find((c) => c.isDirectionalLight));
  const sOn = !!r.shadowMap.enabled && !!(sun && sun.castShadow !== false && sun.shadow);
  return { tier: W.gfxTier || (W.settings && W.settings.graphics), pr: r.getPixelRatio(), dprMax: k._dprMax != null ? (k._dprMax === Infinity ? 9 : k._dprMax) : null,
           shadow: sOn ? sun.shadow.mapSize.x : 0, shadowOn: sOn, shadowExt: sOn ? Math.abs(sun.shadow.camera.right || 0) : 0,
           aniso: W._texAniso != null ? W._texAniso : null, lootCull: W.lootCull != null ? W.lootCull : null, wpnLOD: W.wpnLOD != null ? W.wpnLOD : null,
           far: W.camera ? W.camera.far : null, gfx: W._gfx ? JSON.parse(JSON.stringify(W._gfx, (kk, vv) => typeof vv === 'object' && vv && kk !== '' && Object.keys(vv).length > 20 ? undefined : vv)) : null }; }"""
MEAN_JS = r"""() => { const W = window.__LC__.W, k = W.kernel; window.__LC__.stepFrames(2, 1e-5, true); const gl = k.renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4 * 64 * 64); const out = []; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { gl.readPixels(Math.floor((i + 0.5) * w / 8) - 4, Math.floor((j + 0.5) * h / 8) - 4, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0, g = 0, b = 0; for (let q = 0; q < 64; q++) { r += px[4 * q]; g += px[4 * q + 1]; b += px[4 * q + 2]; } out.push(r / 64, g / 64, b / 64); }
  return out; }"""
ANCH_JS = r"""() => { const out = {}; for (const k of ['minimap', 'compass', 'stormrow', 'meta', 'bars', 'slotcol', 'feed', 'chat']) { const e = document.querySelector('[data-lc="' + k + '"]'); if (!e || !e.offsetParent) continue;
  const r = e.getBoundingClientRect(); out[k] = [r.left, r.top, r.right, r.bottom].map((x) => +x.toFixed(1)); } return { W: innerWidth, H: innerHeight, a: out }; }"""


def click(s, re_):
    xy = s.js(BTN_JS, re_)
    if xy:
        s.page.mouse.click(xy[0], xy[1])
        s.sleep(0.35)
    return bool(xy)


def open_settings(s):
    for re_ in (r"^\W*SETTINGS$", r"SETTINGS"):
        if click(s, re_):
            if s.wait_js("() => !!document.querySelector('[data-lc=\"settabs\"]') || /SETTINGS/.test(document.body.innerText)", 4, 0.2):
                return True
    return False


def close_settings(s):
    if not click(s, r"^(DONE|CLOSE|BACK|SAVE)$"):
        s.page.keyboard.press("Escape")
    s.sleep(0.4)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)

    def body(v):
        with C.Session(args, "p23_settings", viewport={"width": 1280, "height": 720}) as s:
            url = args.base + ("&" if "?" in args.base else "?") + "hints=1"
            s.boot(url=url)
            s.sleep(2.0)
            L.dismiss_cards(s)
            have = L.contract(s, {"W.setGfx": "typeof W.setGfx === 'function'", "W.gfxTier": "['low', 'medium', 'high', 'ultra'].includes(W.gfxTier)"})
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            s.wait_js("() => { const W = window.__LC__.W; return W._autoTier || W.gfxTier ? true : null; }", 20, 0.5)
            s.sleep(6.0)                     # the first-run auto-tier measures the menu before it decides
            first = s.js(GFX_JS)
            v.data["firstRun"] = first
            v.check("auto-tier (the first-run pick on this box's default GPU is never ULTRA)", first["tier"] in ("low", "medium", "high"), {"tier": first["tier"], "autoTier": s.safe_js("() => window.__LC__.W._autoTier || null")}, "low / medium / high")
            ok_open = open_settings(s)
            tabs = s.js("() => [...document.querySelectorAll('.lc-tab')].filter((x) => x.offsetParent).map((x) => x.textContent.trim().toUpperCase())")
            have["settings tabs"] = bool(tabs)
            L.contract_row(v, "contract (W.setGfx, W.gfxTier, the settings modal with tabs)", have)
            v.check("tabs (GAME / VIDEO / AUDIO / CONTROLS / ACCESSIBILITY)", ok_open and tabs == ["GAME", "VIDEO", "AUDIO", "CONTROLS", "ACCESSIBILITY"], {"opened": ok_open, "tabs": tabs}, "5 tabs")
            fit = {}
            cvd_modes = []
            for t in ("GAME", "VIDEO", "AUDIO", "ACCESSIBILITY"):
                click(s, "^%s$" % t)
                fit[t] = s.js(FIT_JS)
                if t == "ACCESSIBILITY":     # the colour-vision options as the player sees them (any button naming a protan / deuter / tritan mode)
                    cvd_modes = s.js("() => [...document.querySelectorAll('button, .lc-sopt')].filter((b) => b.offsetParent && /protan|deut|tritan/i.test((b.textContent || '') + ' ' + (b.dataset.v || ''))).map((b) => (b.dataset.v || b.textContent).trim())")
                s.screenshot(os.path.join(shots, "settings_%s.png" % t.lower()))
            v.check("tabs-fit (every tab but CONTROLS: every control inside 1280x720 and the card)", all(f is not None and not f["out"] for f in fit.values()) and len(fit) == 4,
                    {k: (f or {}).get("out") for k, f in fit.items()}, "0 outside")
            # presets
            click(s, "^VIDEO$")
            names = s.js("() => [...document.querySelectorAll('.lc-sopt, button')].filter((x) => x.offsetParent).map((x) => x.textContent.trim().toUpperCase()).filter((t) => ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].includes(t))")
            seq = {}
            for t in ("LOW", "MEDIUM", "HIGH", "ULTRA"):
                if click(s, "^%s$" % t):
                    s.sleep(0.6)
                    seq[t] = s.js(GFX_JS)
            v.data["tiers"] = seq
            order = [seq.get(t) for t in ("LOW", "MEDIUM", "HIGH", "ULTRA")]
            # the quality vector: every knob a tier sets that a player sees (an absent knob = 0 on every tier, so it never decides);
            # the shadow map counts only while the shadow pass is ON (a LOW that keeps a 2048 map allocated but disabled is 0)
            QK = ("pr", "dprMax", "shadow", "shadowExt", "aniso", "lootCull", "wpnLOD", "far")
            qv = lambda x: [float(x.get(k) or 0) for k in QK]
            mono = all(order) and all(all(qb >= qa - 1e-6 for qa, qb in zip(qv(a), qv(b))) for a, b in zip(order, order[1:]))
            above = all(order) and any(qb > qa + 1e-6 for qa, qb in zip(qv(order[2]), qv(order[3])))
            below = all(order) and any(qb > qa + 1e-6 for qa, qb in zip(qv(order[0]), qv(order[1])))
            v.check("presets (LOW / MEDIUM / HIGH / ULTRA by real clicks; W.gfxTier follows; quality never falls going up; ULTRA above HIGH)",
                    sorted(set(names)) == ["HIGH", "LOW", "MEDIUM", "ULTRA"] and all(seq.get(t, {}).get("tier") == t.lower() for t in ("LOW", "MEDIUM", "HIGH", "ULTRA")) and mono and above and below,
                    {"buttons": sorted(set(names)), "mono": mono, "ultraAboveHigh": above, "mediumAboveLow": below,
                     "tiers": {t: {k: x.get(k) for k in ("tier",) + QK} for t, x in seq.items()}}, "follows, monotonic on every knob, ultra > high and medium > low on >= 1")
            close_settings(s)
            s.page.reload()
            s.boot(url=url)
            s.sleep(3.0)
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            after = s.js(GFX_JS)
            v.check("ultra-persists (ULTRA chosen, page reloaded: still ULTRA)", after["tier"] == "ultra", {"tier": after["tier"], "pr": after["pr"]}, "ultra")
            s.js("() => window.__LC__.W.setGfx('tier', 'medium')")
            # rebind Drop -> G in CONTROLS
            L.dismiss_cards(s)
            open_settings(s)
            click(s, "^CONTROLS$")
            row = s.js("""() => { const g = document.querySelector('[data-lc="keybinds"]'); if (!g) return null; const rows = [...g.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^Drop\\b/i.test((e.textContent || '').trim()));
                if (!rows.length) return null; const lab = rows[0]; let host = lab.parentElement; let btn = null; for (let i = 0; i < 3 && host && !btn; i++) { btn = [...host.querySelectorAll('button, .lc-key, .lc-sopt')].find((b) => b !== lab); host = host.parentElement; }
                if (!btn) return null; btn.scrollIntoView({ block: 'center' }); const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, was: btn.textContent.trim() }; }""")
            bound = None
            if row:
                s.page.mouse.click(row["x"], row["y"])
                s.sleep(0.3)
                s.page.keyboard.press("g")
                s.sleep(0.4)
                bound = s.js("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.textContent.trim() : null; }", [row["x"], row["y"]])
            close_settings(s)
            drop = {"row": row, "boundTo": bound}
            if row:
                L.practice(s, 4242, "ashgrid")
                L.lock_pointer(s)
                s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[1] = { kind: 'weapon', id: 'ar', rarity: 0, mag: 30 }; }")
                s.press("Digit2")
                s.step_frames(30, 1 / 60)
                cnt = "() => { const p = window.__LC__.W.player; return p.inventory.slots.filter((x) => x && x.kind === 'weapon').length; }"
                n0 = s.js(cnt)
                s.press("KeyQ")
                s.step_frames(20, 1 / 60)
                nq = s.js(cnt)
                s.press("KeyG")
                s.step_frames(20, 1 / 60)
                ng = s.js(cnt)
                drop.update({"weapons": [n0, nq, ng]})
            v.check("rebind (Drop -> G by a real click + key: Q drops nothing, G drops the held gun)", bool(row) and (bound or "").upper() == "G" and drop.get("weapons") and drop["weapons"][1] == drop["weapons"][0] and drop["weapons"][2] == drop["weapons"][0] - 1,
                    drop, "Q: same, G: -1")
            # colour-blind: the three modes change the frame, off restores it - on the FROZEN loop (a live rAF frame between two reads moved
            # the view: 6.8 / 255 'noise' with the loop running)
            s.freeze_loop()
            s.step_frames(10, 1 / 60, render=True)
            modes = sorted(set(cvd_modes))
            mad = lambda a, b: round(sum(abs(x - y) for x, y in zip(a, b)) / len(a), 3)

            def set_cvd(m, alt=None):
                try:
                    s.js("(m) => window.__LC__.W.setGfx('daltonize', m)", m)
                except Exception:
                    if alt is None:
                        raise
                    s.js("(m) => window.__LC__.W.setGfx('daltonize', m)", alt)

            # each mode as its own off -> mode -> off cycle, and one CONTROL cycle (off -> off -> off) with the same reads in between: the
            # control's drift is the noise floor of exactly this spacing (settings_all5: 'off restores' 3.97 against a back-to-back noise of
            # 1.1 - the old floor was two adjacent reads, the restore read came six reads and seconds of wall-clock shader time later)
            cyc = {}
            for m, alt in (("ctl", None), ("protan", "protanopia"), ("deutan", "deuteranopia"), ("tritan", "tritanopia")):
                try:
                    set_cvd("off")
                    o0 = s.js(MEAN_JS)
                    set_cvd("off" if m == "ctl" else m, alt)
                    x = s.js(MEAN_JS)
                    set_cvd("off")
                    o1 = s.js(MEAN_JS)
                    cyc[m] = {"diff": mad(x, o0), "restore": mad(o1, o0)}
                except Exception as e:
                    cyc[m] = {"error": str(e).splitlines()[0][:80]}
            ctl = cyc.get("ctl", {})
            noise = max(ctl.get("diff", 9e9), ctl.get("restore", 9e9))
            diffs = {m: c.get("diff", c.get("error")) for m, c in cyc.items() if m != "ctl"}
            rests = {m: c.get("restore") for m, c in cyc.items() if m != "ctl"}
            rest = max([r for r in rests.values() if isinstance(r, float)] or [9e9])
            v.check("colour-blind (the ACCESSIBILITY row lists off + 3 modes; each changes the frame >= 1/255; off restores it)",
                    len(modes) >= 3 and all(isinstance(d, float) and d >= 1.0 + noise for d in diffs.values()) and rest < 0.5 + noise,
                    {"modesInUi": modes, "meanAbsDiff": diffs, "offRestore": rests, "noise": noise, "control": ctl}, ">= 1.0 + noise each, < 0.5 + noise back (noise = the off/off/off control cycle)")
            # HUD scale 130 %: the anchor corner stays
            s.step_frames(5, 1 / 60, render=True)
            a1 = s.js(ANCH_JS)
            # the REAL slider: Escape -> the pause card -> SETTINGS -> ACCESSIBILITY -> a click at the right end of the HUD scale range (= 130 %)
            s.thaw_loop()
            s.page.keyboard.press("Escape")
            s.sleep(0.6)
            scaled = None
            if open_settings(s):
                click(s, "^ACCESSIBILITY$")
                rr = s.js("""() => { const lab = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /^HUD scale$/i.test((d.textContent || '').trim()));
                    const inp = lab && lab.parentElement ? lab.parentElement.querySelector('input[type=range]') : null; if (!inp) return null; inp.scrollIntoView({ block: 'center' });
                    const r = inp.getBoundingClientRect(); return [r.right - 2, r.top + r.height / 2]; }""")
                if rr:
                    s.page.mouse.click(rr[0], rr[1])
                    s.sleep(0.4)
                    scaled = s.js("() => window.__LC__.W.settings.hudScale")
                close_settings(s)
            for _ in range(2):
                if s.js("() => !!window.__LC__.W.paused"):
                    s.page.keyboard.press("Escape")
                    s.sleep(0.5)
            s.freeze_loop()
            s.step_frames(5, 1 / 60, render=True)
            s.sleep(0.3)
            a2 = s.js(ANCH_JS)
            v.data["hudScaleSet"] = scaled
            s.screenshot(os.path.join(shots, "settings_hud130.png"))
            bad = {}
            empty = []
            Wv, Hv = a2["W"], a2["H"]
            sc = scaled if scaled else 1.3
            for k, r1 in a1["a"].items():
                r2 = a2["a"].get(k)
                if not r2:
                    continue
                if (r1[2] - r1[0]) < 2 or (r1[3] - r1[1]) < 2:
                    empty.append(k)          # an empty panel (no kill feed / chat line yet) has no size to judge
                    continue
                cx, cy = (r1[0] + r1[2]) / 2, (r1[1] + r1[3]) / 2
                left, top = cx < Wv / 2, cy < Hv / 2
                # "grows from its anchor corner": the panel's own corner stays put (+-2 px), OR the whole anchored layer scales from the
                # SCREEN corner (margin included: corner offset x scale, +-2 px) - both keep the panel in its corner; growing from the
                # panel's centre (the plant) does neither
                ox1 = r1[0] if left else Wv - r1[2]
                ox2 = r2[0] if left else Wv - r2[2]
                oy1 = r1[1] if top else Hv - r1[3]
                oy2 = r2[1] if top else Hv - r2[3]
                cornerX = min(abs(ox2 - ox1), abs(ox2 - ox1 * sc))
                cornerY = min(abs(oy2 - oy1), abs(oy2 - oy1 * sc))
                grew = (r2[2] - r2[0]) > (r1[2] - r1[0]) * 1.15
                inside = r2[0] >= -1 and r2[1] >= -1 and r2[2] <= Wv + 1 and r2[3] <= Hv + 1
                centred = abs(cx - Wv / 2) < 40          # a centred panel (compass, storm row) keeps its centre instead
                if centred:
                    cornerX = abs((r2[0] + r2[2]) / 2 - cx)
                if not (grew and inside and cornerX <= 2 and cornerY <= 2):
                    bad[k] = {"100": r1, "130": r2, "grew": grew, "inside": inside, "dx": round(cornerX, 1), "dy": round(cornerY, 1)}
            v.check("hud-scale (130 % by the real slider: every anchored panel grows from its anchor corner, +-2 px, inside the viewport)",
                    bool(a1["a"]) and scaled is not None and abs(scaled - 1.3) < 0.01 and not bad and len(a1["a"]) - len(empty) >= 5,
                    {"set": scaled, "panels": len(a1["a"]), "judged": len(a1["a"]) - len(empty), "empty": empty, "bad": bad}, "1.3, >= 5 judged, 0 bad")
            s.js(HUDMOD_JS)
            rb = s.safe_js("() => { const C = window.__LC__; const f = C.feel ? C.feel() : null; if (f && f.hud) return f.hud; const H = window.__HUDMOD__; return H && H.readback ? H.readback(C.W) : null; }", default=None) or {}
            mm = rb.get("minimap")
            v.check("minimap (local, <= 3 m per CSS px)", bool(mm) and mm["mpp"] <= 3.0 and mm["local"], {"minimap": mm}, "<= 3 m/px, local")
            # hints: a standard match, then a second one
            s.thaw_loop()
            shown = []
            for seed in (7, 8):
                # the tips are gated at MODULE LOAD by ?hints=1 (navigator.webdriver); settings_all4/5 read location.search "" here (the page had
                # been re-opened without the query by the time of this section), so the row judged a page whose tips were off by design. Re-open
                # the hints URL whenever the query is gone (localStorage lc_hints survives: match 2 still sees match 1's ids)
                if "hints=1" not in (s.safe_js("() => location.search") or ""):
                    v.data.setdefault("hintsReboot", []).append(seed)
                    s.boot(url=url)
                    s.sleep(2.0)
                    L.dismiss_cards(s)
                L.start(s, "standard", seed, "ashgrid", guard=True)
                s.land(140, protect=True)
                # past t = 50 s in sim (the 'map' tip's moment), then LIVE frames: the tips run from the HUD's own 2 Hz update and show one at a
                # time on the wall clock (fastForward alone never draws a HUD frame, so it can never show one)
                s.js("() => { const C = window.__LC__, W = C.W; let n = 0; while (W.t < 50 && n++ < 120) C.fastForward(1, 1 / 30); }")
                s.thaw_loop()
                s.sleep(25.0)
                rb = s.safe_js("() => { const C = window.__LC__; const f = C.feel ? C.feel() : null; if (f && f.hud) return f.hud; const H = window.__HUDMOD__; return H && H.readback ? H.readback(C.W) : null; }", default=None) or {}
                shown.append(list(((rb.get("hints") or {}).get("shown")) or []))
                v.data.setdefault("hintState", []).append(s.safe_js("""() => { const W = window.__LC__.W, p = W.player, el = document.querySelector('[data-lc=hint]'); let ls = null; try { ls = localStorage.getItem('lc_hints'); } catch (e) {}
                    return { search: location.search, setting: W.settings && W.settings.hints, mode: W.mode, phase: W.phase, t: +W.t.toFixed(1), onGround: p && p.onGround, running: !!W.kernel._running,
                             frameNo: W.kernel.frameNo, el: el ? el.textContent.slice(0, 60) : null, ls }; }""", default=None))
            new = shown[1][len(shown[0]):] if shown[1][:len(shown[0])] == shown[0] else shown[1]      # the log may run across matches
            dup = [x for x in shown[0] if shown[0].count(x) > 1] + [x for x in new if new.count(x) > 1]
            again = [x for x in new if x in shown[0]]
            v.check("hints (no hint id twice in a match; none of match 1's again in match 2)", bool(shown[0]) and not dup and not again,
                    {"match1": shown[0], "match2": shown[1], "state": v.data.get("hintState")}, "each once")
            L.errors_row(v, s)
    return C.run_gate("p23_settings", body, args)


if __name__ == "__main__":
    sys.exit(main())
