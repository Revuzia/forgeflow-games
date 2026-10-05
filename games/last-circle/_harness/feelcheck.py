#!/usr/bin/env python
"""feelcheck - hit feedback a player reads in a fight (PLAN L7 / L8 gates; logic of _spec/.../baseline/fju/shots3.py + shots4.py).

    python _harness/feelcheck.py
    python _harness/feelcheck.py --disk --burst 3.7

A standard match (ashgrid, seed 4242), the player landed (setup), pointer lock by a REAL click, one bot pinned in front
of the camera (setup: isDummy + netRemote, exactly as the feel-juice audit's shots3.py did), then REAL LMB input.
The kernel's own loop is stopped and a TIMER-driven frame pump (setInterval 16 ms, dt = real elapsed, max 0.05) runs the
frames, so the wall-clock parts of the HUD (setTimeout fades today) and the frame-driven parts (L7's dt clocks) both
advance on this rAF-starved box. Read-back: __LC__.feel() (contract C9, lane L4) when it exists, else each module's
own readback(W) (hud.js / fx.js / audio.js, contract C9, lanes L7 / L8), else the DOM (today's build: the "✕" marker
element, numeric damage-number nodes, the reticle's child rects).

  kill marker    pistol kill: the marker's LAST state is the kill style (red) and it is held at opacity >= 0.99 for
                 >= 250 ms (was: overwritten white 26 px in the same frame, hidden 113 ms later)
  reticle        every arm >= 2 px thick and >= 6 px long at rest, crouched-still (REAL C held) and sprinting (REAL
                 Shift toggle + W) (was: ~0.9 px x 3.7 px - scale(0.457) of the whole element)
  SMG burst      REAL LMB held --burst s on a shielded pinned bot: <= 1 live damage number per victim at every sample,
                 no damage-number DOM node created by fx.js after the first 0.3 s (pool), music duck ramps <= 2 (L8; was 30)
  shield break   the shield-break burst fires exactly once, on the breaking hit (fx readback; could-not-judge without it)

The sampler (a 20 ms setInterval) starts only AFTER the module read-backs are loaded (LOAD_MODS_JS) and re-resolves its
source at every sample: module readback(W) -> __LC__.feel() -> DOM (wave2/VERIFY.md 4a: it used to capture an empty module
table once and report a false FAIL). A sample-based check that collected 0 readings is could-not-judge, never pass/fail.
Falsifiers: `--plant kill-marker-short` (hud.js served with the kill hold 0.35 -> 0.05 s) must FAIL the kill-marker row;
`--plant blind-sampler` (the Wave-2 defect re-created) must make it CNJ. `--selftest` runs the judges offline.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

SPY_JS = r"""() => {
  if (window.__FJ__) return 'already';
  const FJ = window.__FJ__ = { log: [], created: 0, fxCreated: 0, since: 0, duck62: 0 };
  // DOM spy (today's build): the marker element ('✕') style changes + numeric damage-number nodes
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.style && /^\d/.test(n.textContent || '') && (n.style.willChange || '').includes('transform')) FJ.log.push({ t: performance.now(), k: 'dmgnum', txt: n.textContent, color: n.style.color });
      }
      if (m.type === 'attributes' && m.target.textContent === '✕') FJ.log.push({ t: performance.now(), k: 'mark', op: m.target.style.opacity, color: m.target.style.color, fs: m.target.style.fontSize });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  const ce = document.createElement.bind(document);
  document.createElement = function (tag) { FJ.created++; try { if (FJ.trace) { const s = new Error().stack || ''; if (/royale\/fx\.js/.test(s)) FJ.fxCreated++; } } catch (_) {} return ce.apply(null, arguments); };
  const st = AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime = function (v) { if (v === 0.62) FJ.duck62++; return st.apply(this, arguments); };
  return 'ok';
}"""

# The module read-backs (hud / fx / audio readback(W), contract C9) loaded ONCE, BEFORE the sampler starts. Wave-2 defect
# (wave2/VERIFY.md 4a): READ_JS returned early through __LC__.feel, so window.__FJ_MODS__ was never set when TICK_JS
# started; the sampler fell back to a DOM marker search the four-tick marker no longer matches and collected 0 marker
# samples -> a false FAIL. The same module URL (with the boot script's ?v=) is the instance the game itself imported.
LOAD_MODS_JS = r"""async () => {
  if (!window.__FJ_MODS__) {
    const el = [...document.querySelectorAll('script[type=module]')].find((s) => /ffg_boot3d/.test(s.src));
    const V = el ? new URL(el.src).search : '';
    const base = new URL('runtime/3d/royale/', location.href.replace(/[^/]*$/, '')).href;
    const mods = {};
    for (const m of ['hud', 'fx', 'audio']) { try { mods[m] = await import(base + m + '.js' + V); } catch (e) { mods[m] = null; } }
    window.__FJ_MODS__ = mods;
  }
  const out = {};
  for (const m in window.__FJ_MODS__) { const mod = window.__FJ_MODS__[m]; out[m] = !!(mod && typeof mod.readback === 'function'); }
  out.feel = typeof (window.__LC__ && window.__LC__.feel) === 'function';
  return out;
}"""

READ_JS = r"""async () => {
  const L = window.__LC__, W = L.W;
  if (typeof L.feel === 'function') { try { return { via: '__LC__.feel', r: L.feel() }; } catch (e) { return { via: 'feel threw', err: String(e) }; } }
  if (!window.__FJ_MODS__) {
    const el = [...document.querySelectorAll('script[type=module]')].find((s) => /ffg_boot3d/.test(s.src));
    const V = el ? new URL(el.src).search : '';
    const base = new URL('runtime/3d/royale/', location.href.replace(/[^/]*$/, '')).href;
    const mods = {};
    for (const m of ['hud', 'fx', 'audio']) { try { mods[m] = await import(base + m + '.js' + V); } catch (e) { mods[m] = null; } }
    window.__FJ_MODS__ = mods;
  }
  const out = {};
  for (const m in window.__FJ_MODS__) { const mod = window.__FJ_MODS__[m]; if (mod && typeof mod.readback === 'function') { try { out[m] = mod.readback(W); } catch (e) { out[m] = { err: String(e) }; } } }
  return { via: Object.keys(out).length ? 'module readback' : 'none', r: out };
}"""

TICK_JS = r"""(on) => {
  if (!on) { clearInterval(window.__FJ_TICK__); clearInterval(window.__FJ_SAMP__); window.__FJ_TICK__ = window.__FJ_SAMP__ = null; return 'off'; }
  if (window.__FJ_TICK__) return 'already';
  const P = window.__H_PUMP__; let last = performance.now();
  window.__FJ_S__ = window.__FJ_S__ || [];
  window.__FJ_PAUSE__ = false;
  const L = window.__LC__, W = L.W;
  // read-back sources are resolved at EVERY sample (never captured once at start): the module readback(W), else the
  // orchestrator's __LC__.feel() (C9), else the DOM. __FJ_BLIND__ (--plant blind-sampler only) forces the DOM path, which
  // re-creates the Wave-2 ordering defect so the 0-sample rule can be shown to answer could-not-judge.
  const src = () => {
    if (window.__FJ_BLIND__) return { mods: {}, feel: null };
    const mods = window.__FJ_MODS__ || {};
    return { mods, feel: typeof L.feel === 'function' ? L.feel : null };
  };
  // the frame pump (dt = real elapsed, max 0.05); paused while the harness steps frames synchronously around a click
  window.__FJ_TICK__ = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    if (window.__FJ_PAUSE__) return;
    try { P.frame(dt, false); } catch (e) { (window.__FJ_ERR__ = window.__FJ_ERR__ || []).push(String(e && e.stack || e).slice(0, 400)); }
  }, 16);
  // a SEPARATE sampler, so the sampling rate does not depend on what a pumped frame costs on this box
  window.__FJ_SAMP__ = setInterval(() => {
    const s = { t: performance.now() };
    try {
      const { mods, feel } = src();
      let fr = null;
      const fl = () => (fr || (fr = feel()));
      let h = null;
      if (mods.hud && mods.hud.readback) { h = mods.hud.readback(W); s.src = 'module'; }
      else if (feel) { h = fl().hud; s.src = 'feel'; }
      if (h) s.mk = h.marker ? { style: h.marker.style, op: h.marker.opacity } : null;
      else { s.src = 'dom'; const el = [...document.querySelectorAll('div')].find((d) => d.textContent === '✕'); if (el) s.mk = { style: /255, 77, 77|255, ?7[0-9], ?7[0-9]|ff4d4d/i.test(el.style.color) ? 'kill' : 'hit', op: parseFloat(el.style.opacity || '0'), color: el.style.color }; }
      let f = null;
      if (mods.fx && mods.fx.readback) f = mods.fx.readback(W);
      else if (feel) f = fl().fx;
      if (f) { s.nums = f.dmg ? f.dmg.maxPerVictim : null; s.breaks = f.shieldBreaks; }
      else { let n = 0; for (const e of document.querySelectorAll('div')) { if ((e.style.willChange || '').includes('transform') && /^\d/.test(e.textContent || '') && parseFloat(getComputedStyle(e).opacity) > 0.05) n++; } s.nums = n; }
    } catch (e) { s.err = String(e); }
    if (window.__FJ_S__.length < 6000) window.__FJ_S__.push(s);
  }, 20);
  return 'on';
}"""

PLACE_JS = r"""(args) => { const W = window.__LC__.W, p = W.player, cam = W.camera;
  cam.updateMatrixWorld(true);
  const dir = new W.THREE.Vector3(); cam.getWorldDirection(dir);
  const d = args.d; const x = cam.position.x + dir.x * d, z = cam.position.z + dir.z * d, y = cam.position.y + dir.y * d;
  const bot = W.actors.find((a) => a !== p && a.alive && !(args.skip || []).includes(a.id));
  if (!bot) return null;
  bot.isDummy = true; bot.netRemote = true; bot.gliding = false; if (bot.vel) bot.vel.set(0, 0, 0);
  const g = W.map.heightAt(x, z);
  bot.pos.set(x, Math.max(g, y - (args.aimY || 1.15)), z); bot.obj.position.copy(bot.pos);
  bot.yaw = p.yaw + Math.PI; bot.obj.rotation.y = bot.yaw;
  bot.hp = args.hp; bot.shield = args.shield;
  if (args.live) { bot.isDummy = false; bot.netRemote = false; }   // a real kill: cleared in the SAME task, so the bot cannot walk off first
  window.__FJ_HURT__ = []; window.__FJ_TGT__ = bot.id;
  if (!window.__FJ_HOOKED__) { window.__FJ_HOOKED__ = true;
    W.events.on('actorHurt', (v, info) => { if (v.id === window.__FJ_TGT__) window.__FJ_HURT__.push({ t: performance.now(), dmg: info.dmg, toShield: info.toShield, broke: !!info.broke }); });
    W.events.on('actorDied', (v) => { if (v.id === window.__FJ_TGT__) window.__FJ_HURT__.push({ t: performance.now(), died: true }); }); }
  return { id: bot.id, d, groundGap: +(bot.pos.y - g).toFixed(2) };
}"""

RETICLE_JS = r"""async () => {
  if (!window.__FJ_MODS__) {
    const el = [...document.querySelectorAll('script[type=module]')].find((s) => /ffg_boot3d/.test(s.src));
    const V = el ? new URL(el.src).search : '';
    const base = new URL('runtime/3d/royale/', location.href.replace(/[^/]*$/, '')).href;
    const m = {}; for (const k of ['hud', 'fx', 'audio']) { try { m[k] = await import(base + k + '.js' + V); } catch (e) { m[k] = null; } }
    window.__FJ_MODS__ = m;
  }
  const mods = window.__FJ_MODS__ || {};
  if (mods.hud && mods.hud.readback) { const r = mods.hud.readback(window.__LC__.W).reticle;
    if (r) return { via: 'readback', arms: r.arms, thick: r.armThickPx, len: r.armLenPx, gap: r.gapPx, kind: r.kind, weapon: r.weapon }; }
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  let best = null;
  for (const e of document.querySelectorAll('div')) {
    if (e.children.length < 2) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.width > 140 || r.height > 140) continue;
    if (Math.abs(r.left + r.width / 2 - cx) > 3 || Math.abs(r.top + r.height / 2 - cy) > 3) continue;
    if (!vis(e)) continue;
    const kids = [...e.children].map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0 && k.height > 0);
    const arms = kids.filter((k) => Math.max(k.width, k.height) / Math.max(0.01, Math.min(k.width, k.height)) >= 1.5);
    if (arms.length >= 2 && (!best || r.width < best.w)) best = { w: r.width, arms: arms.map((k) => [+Math.min(k.width, k.height).toFixed(2), +Math.max(k.width, k.height).toFixed(2)]) };
  }
  if (!best) return { via: 'dom', arms: 0 };
  return { via: 'dom', arms: best.arms.length, thick: Math.min(...best.arms.map((a) => a[0])), len: Math.min(...best.arms.map((a) => a[1])), box: +best.w.toFixed(1) };
}"""


# ─────────────────────────────── judges (pure; --selftest exercises them without a browser) ───────────────────────────────
KILL_HOLD_MS = 250


def _sources(samples):
    out = {}
    for x in samples:
        k = x.get("src") or "?"
        out[k] = out.get(k, 0) + 1
    return out


def judge_kill(samples, t_kill):
    """(ok, detail): ok True / False, or None = could-not-judge when the sampler collected 0 marker readings after the
    kill (a blind sampler must never report a verdict on the game - Wave-2 VERIFY.md 4a)."""
    after = [x for x in samples if x.get("t", -1e18) >= t_kill - 50]
    marked = [x for x in after if x.get("mk")]
    det = {"samples": len(after), "markerSamples": len(marked), "sources": _sources(after)}
    if not marked:
        det["why"] = "0 marker readings after the kill (sampler blind: no readback, no DOM marker)"
        return None, det
    shown = [x for x in marked if (x["mk"].get("op") or 0) >= 0.99]
    last = shown[-1]["mk"] if shown else None
    held, run0 = 0.0, None
    for x in marked:
        ok = x["mk"].get("style") == "kill" and (x["mk"].get("op") or 0) >= 0.99
        if ok and run0 is None:
            run0 = x["t"]
        if ok:
            held = max(held, x["t"] - run0)
        else:
            run0 = None
    det.update({"lastVisible": last, "killHeldMs": round(held)})
    return bool(last and last.get("style") == "kill") and held >= KILL_HOLD_MS, det


def judge_live_numbers(samples, hits=0):
    """(ok, maxLive, n): ok None when no sample carried a damage-number count (0 samples measured nothing), or when the
    reader never saw a single number although `hits` rounds landed (a reader that sees nothing cannot pass '<= 1')."""
    vals = [x.get("nums") for x in samples if isinstance(x.get("nums"), (int, float))]
    if not vals:
        return None, None, 0
    mx = max(vals)
    if mx == 0 and hits > 0:
        return None, mx, len(vals)
    return mx <= 1, mx, len(vals)


def selftest():
    """Offline proof of the judging rules (no browser): 0 samples -> CNJ, a 280 ms kill hold -> PASS, 50 ms -> FAIL."""
    t = 1000.0
    run = lambda ms, style="kill": [{"t": t + i * 20, "src": "module", "mk": {"style": style, "op": 1.0}} for i in range(int(ms / 20) + 1)]
    fade = [{"t": t + 400 + i * 20, "src": "module", "mk": {"style": "kill", "op": 0.5}} for i in range(5)]
    cases = [
        ("0 samples", judge_kill([], t)[0], None),
        ("samples but no marker reading (blind DOM path)", judge_kill([{"t": t + i * 20, "src": "dom"} for i in range(30)], t)[0], None),
        ("kill held 280 ms", judge_kill(run(280) + fade, t)[0], True),
        ("kill held 60 ms (planted short hold)", judge_kill(run(60) + fade, t)[0], False),
        ("marker overwritten white (hit style)", judge_kill(run(300, "body") + fade, t)[0], False),
        ("live numbers: 0 samples", judge_live_numbers([])[0], None),
        ("live numbers: max 1", judge_live_numbers([{"nums": 1}, {"nums": 0}])[0], True),
        ("live numbers: max 3", judge_live_numbers([{"nums": 3}])[0], False),
        ("live numbers: 0 seen while 40 hits landed", judge_live_numbers([{"nums": 0}] * 50, 40)[0], None),
    ]
    bad = 0
    for name, got, want in cases:
        ok = got is want
        bad += 0 if ok else 1
        print("  %s  %-50s got %s want %s" % ("ok  " if ok else "BAD ", name, got, want))
    print("feelcheck selftest: %d/%d" % (len(cases) - bad, len(cases)))
    return 0 if not bad else 1


# ─────────────────────────────── planted faults (--plant; each must make the gate FAIL / CNJ as stated) ─────────────────
def plant_kill_hold(s, hold=0.05):
    """kill-marker-short: serve hud.js with the kill tier's hold cut from 0.35 s to `hold` (a real game regression: the
    kill confirm flashes for 50 ms). A PAGE route, so it wins over the DiskServer's context route; the original bytes come
    from the same place the run serves from (--disk working copy / --rev blob / the server via route.fetch)."""
    import re
    import urllib.parse
    st = {"served": 0, "patched": 0, "err": None}
    pat = re.compile(rb"(kill:\s*\{[^}]*?hold:\s*)(\d*\.?\d+)")

    def handler(route):
        try:
            u = urllib.parse.urlparse(route.request.url)
            if s.disk is not None:
                rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
                if s.disk.git is not None:
                    body = s.disk.git.read(rel)
                else:
                    p = C.disk_file_for(u.path)
                    body = open(p, "rb").read() if p else None
            else:
                body = route.fetch().body()
            if body is None:
                return route.fallback()
            new, n = pat.subn(lambda m: m.group(1) + (b"%.2f" % hold), body, count=1)
            st["served"] += 1
            st["patched"] += n
            route.fulfill(status=200, body=new, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
                                                         "Access-Control-Allow-Origin": "*"})
        except Exception as e:
            st["err"] = str(e)[:200]
            route.fallback()
    s.page.route(lambda url: "/runtime/3d/royale/hud.js" in url, handler)
    return st


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--burst", type=float, default=3.7, help="SMG trigger hold, minimum seconds (the audit's 3.7 s burst)")
    ap.add_argument("--burst-shots", type=int, default=30, help="hold the SMG trigger until this many rounds fired (max 45 s)")
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--plant", default=None, choices=["kill-marker-short", "blind-sampler"],
                    help="FALSIFIER: kill-marker-short = hud.js served with the kill hold cut to 0.05 s (the kill-marker row MUST "
                         "FAIL); blind-sampler = the Wave-2 ordering defect re-created (the sampler gets no read-back; the "
                         "kill-marker row MUST be could-not-judge, never FAIL or PASS)")
    ap.add_argument("--selftest", action="store_true", help="run the offline judge selftest only (no browser)")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if args.plant and not args.report:
        args.report = "feelcheck_plant_" + args.plant.replace("-", "_")

    def body(v):
        with C.Session(args, "feelcheck", launch_args=[]) as s:
            plant = None
            if args.plant == "kill-marker-short":
                plant = plant_kill_hold(s)
                v.note("PLANTED FAULT: hud.js served with the kill tier's hold 0.35 s -> 0.05 s (the kill-marker row MUST fail)")
            s.boot()
            if plant is not None:
                v.info("plant applied", dict(plant))
                if not plant["patched"]:
                    v.cnj("planted fault", "the hud.js kill-hold pattern was not found / not served (%s) - nothing planted" % plant)
                    return
            s.js(SPY_JS)
            for _ in range(3):
                b = s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\\s*GOT IT\\s*$/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
                if not b:
                    break
                s.page.mouse.click(b[0], b[1])
                s.sleep(0.4)
            s.page.mouse.click(5, 5)                     # a user gesture: unlock audio so the music graph + duck exist
            s.start_match("standard", args.seed, args.map, enter=True)
            s.land(120)
            s.freeze_loop()
            s.install_pump()
            s.step_frames(30, 1 / 60, render=False)
            rb = s.js(READ_JS)
            v.info("read-back source", rb.get("via"))
            p_alive = s.js("() => window.__LC__.W.player.alive")
            if not p_alive:
                v.cnj("feel checks", "the player died while landing (setup)")
                return
            # pointer lock first (that click may fire a round at nothing)
            cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
            s.page.mouse.click(cv["x"], cv["y"])
            s.wait_js("() => !!document.pointerLockElement", 3, 0.1)
            s.js("() => { for (const el of document.querySelectorAll('div')) if (el.textContent === 'CLICK TO LOOK AROUND') el.style.visibility = 'hidden'; }")
            # the read-backs are loaded BEFORE the sampler starts (Wave-2 VERIFY.md 4a); the sampler re-resolves them per sample
            if args.plant == "blind-sampler":
                s.js("() => { window.__FJ_BLIND__ = true; }")
                v.note("PLANTED FAULT: blind sampler (no module / feel read-back; DOM marker search only) - the kill-marker row MUST be CNJ")
            else:
                v.info("read-backs loaded before the sampler", s.js(LOAD_MODS_JS))
            s.js(TICK_JS, True)
            s.sleep(0.6)
            # ---------------- reticle: rest / crouched-still / sprinting ----------------
            s.press("Digit1")
            s.sleep(0.8)
            ret = {"rest": s.js(RETICLE_JS)}
            s.page.keyboard.down("KeyC")
            s.sleep(0.8)
            ret["crouched"] = s.js(RETICLE_JS)
            s.page.keyboard.up("KeyC")
            s.sleep(0.4)
            s.press("ShiftLeft")
            s.page.keyboard.down("KeyW")
            s.sleep(0.8)
            ret["sprinting"] = s.js(RETICLE_JS)
            s.page.keyboard.up("KeyW")
            s.press("ShiftLeft")
            s.sleep(0.5)
            v.data["reticle"] = ret
            bad = {k: r for k, r in ret.items() if not (r.get("arms", 0) >= 2 and (r.get("thick") or 0) >= 2 and (r.get("len") or 0) >= 6)}
            v.check("reticle arms >= 2 px thick x >= 6 px long at rest, crouched-still and sprinting", not bad, ret)
            # ---------------- pistol kill: the kill style must win and hold ----------------
            # The semi-auto click edge lives 420 ms of WALL time (weapons.js edgeLive). On this box one pumped frame can
            # cost more than that, so the click is followed by SYNCHRONOUSLY stepped frames (pump paused): the edge is
            # consumed while fresh. The bot is placed and made killable in the same task as the click.
            died, hurt, tgt, tries, shots_k = [], [], None, 0, 0
            n0 = s.js("() => window.__FJ_S__.length")
            k0 = s.js("() => window.__FJ__.log.length")
            for tries in range(1, 4):
                s.js("() => { window.__FJ_PAUSE__ = true; }")
                tgt = s.js(PLACE_JS, {"d": 11, "hp": 5, "shield": 0, "live": True, "skip": []})
                if not tgt:
                    break
                f0 = s.js("() => window.__LC__.W.stats.shotsFired")
                s.page.mouse.down()
                s.step_frames(3, 1 / 60, render=False)
                s.page.mouse.up()
                s.step_frames(3, 1 / 60, render=False)
                shots_k += s.js("() => window.__LC__.W.stats.shotsFired") - f0
                s.js("() => { window.__FJ_PAUSE__ = false; }")
                s.sleep(1.4)
                hurt = s.js("() => window.__FJ_HURT__")
                died = [h for h in hurt if h.get("died")]
                if died:
                    break
                s.sleep(0.6)                                 # the pistol's cooldown before the next click
            if not tgt:
                v.cnj("kill marker", "no bot to pin")
                return
            samples = s.js("(n) => window.__FJ_S__.slice(n)", n0)
            domlog = s.js("(k) => window.__FJ__.log.slice(k).filter((e) => e.k === 'mark')", k0)
            if not died:
                v.cnj("pistol kill: the marker ends in the kill style, held >= 250 ms",
                      "no kill in %d clicks (shots %d, hurt events %s)" % (tries, shots_k, hurt[:3]))
            else:
                ok_k, det_k = judge_kill(samples, died[0]["t"])
                det_k.update({"domMarkerLog": domlog[-4:], "clicks": tries})
                name_k = "pistol kill: the marker's last visible state is the kill style, held at opacity >= 0.99 for >= 250 ms"
                if ok_k is None:
                    v.cnj(name_k, det_k)
                else:
                    v.check(name_k, ok_k, det_k)
            # ---------------- SMG burst: numbers + pool + duck ----------------
            # held until >= --burst-shots rounds left the gun (a wall-clock burst fires 5 rounds when a pumped frame costs
            # 600 ms on this box - 21:31 run); the target is a practice dummy (absorbs and resets, never dies)
            s.js("() => { const W = window.__LC__.W, p = W.player; p.inventory.slots[1] = { kind: 'weapon', id: 'smg', rarity: 2, mag: 400 }; p.inventory.ammo.light = 999; }")
            tgt2 = s.js(PLACE_JS, {"d": 9, "hp": 100, "shield": 100, "skip": [tgt["id"]]})
            s.press("Digit2")
            s.sleep(0.9)
            aud0 = (s.js(READ_JS).get("r") or {}).get("audio")
            d0 = s.js("() => window.__FJ__.duck62")
            n0 = s.js("() => window.__FJ_S__.length")
            s.js("() => { window.__FJ__.fxCreated = 0; window.__FJ__.trace = false; }")
            shots0 = s.js("() => window.__LC__.W.stats.shotsFired")
            t_b = time.time()
            s.page.mouse.down()
            s.sleep(0.3)
            s.js("() => { window.__FJ__.fxCreated = 0; window.__FJ__.trace = true; }")
            while time.time() - t_b < max(args.burst, 45.0):
                s.sleep(0.25)
                if time.time() - t_b >= args.burst and s.js("() => window.__LC__.W.stats.shotsFired") - shots0 >= args.burst_shots:
                    break
            s.page.mouse.up()
            s.js("() => { window.__FJ__.trace = false; }")
            burst_wall = round(time.time() - t_b, 1)
            s.sleep(0.5)
            shots = s.js("() => window.__LC__.W.stats.shotsFired") - shots0
            hurt2 = s.js("() => window.__FJ_HURT__")
            samples = s.js("(n) => window.__FJ_S__.slice(n)", n0)
            ok_n, mx, n_num = judge_live_numbers(samples, len(hurt2 or []))
            fxc = s.js("() => window.__FJ__.fxCreated")
            aud1 = (s.js(READ_JS).get("r") or {}).get("audio")
            d1 = s.js("() => window.__FJ__.duck62")
            if shots < 5 or not hurt2:
                v.cnj("SMG burst checks", "the burst did not land (shots %s, hits %d)" % (shots, len(hurt2)))
            else:
                det_n = {"maxLive": mx, "samplesWithCount": n_num, "samples": len(samples), "sources": _sources(samples),
                         "hits": len(hurt2), "shots": shots, "wallS": burst_wall}
                if ok_n is None:
                    v.cnj("SMG burst: <= 1 live damage number per victim at every sample", det_n)
                else:
                    v.check("SMG burst: <= 1 live damage number per victim at every sample", ok_n, det_n)
                v.check("SMG burst: no damage-number DOM node created by fx.js after 0.3 s (pool)", fxc == 0, {"fxCreateElement": fxc, "shots": shots})
                if aud0 and aud1 and "duckRamps" in aud0:
                    ramps = aud1["duckRamps"] - aud0["duckRamps"]
                    v.check("SMG burst: music duck ramps <= 2 (audio readback)", ramps <= 2, {"duckRamps": ramps, "shots": shots, "wallS": burst_wall})
                else:
                    v.check("SMG burst: music duck ramps <= 2 (setTargetAtTime(0.62) count - today's duckMusic)", d1 - d0 <= 2,
                            {"duckCalls": d1 - d0, "shots": shots, "wallS": burst_wall})
            # ---------------- shield break ----------------
            fx0 = (s.js(READ_JS).get("r") or {}).get("fx")
            if not fx0 or "shieldBreaks" not in fx0:
                v.cnj("shield break: exactly one burst, on the breaking hit", "needs fx.js readback() (contract C9, lane L7)")
            else:
                # SETUP: level the aim first. A 30+ round burst leaves the recoil-kicked pitch near the clamp, so a dummy
                # placed along the camera ray hangs in the air and falls out of the line of fire (22:36 working-copy
                # run: "no breaking hit landed (0 hits)").
                s.js("() => { const p = window.__LC__.W.player; p.input.pitch = 0; p.recoilPitch = 0; p.recoilYaw = 0; }")
                # ...and move the SMG dummy (still standing on the same ray at 9 m, absorbing every round) out of the line
                if tgt2:
                    s.js("(id) => { const W = window.__LC__.W, b = W.actorById.get(id); if (!b) return; b.pos.x += 40; b.pos.z += 40;"
                         " b.pos.y = Math.max(W.map.heightAt(b.pos.x, b.pos.z), W.map.waterY); b.obj.position.copy(b.pos); }", tgt2["id"])
                s.sleep(0.5)
                s.js(PLACE_JS, {"d": 8, "hp": 100, "shield": 20, "skip": [tgt["id"], tgt2["id"] if tgt2 else None]})
                s.sleep(0.3)
                f_s = s.js("() => window.__LC__.W.stats.shotsFired")
                s.page.mouse.down()
                t_s = time.time()
                while time.time() - t_s < 20 and not s.js("() => (window.__FJ_HURT__ || []).some((h) => h.broke)"):
                    s.sleep(0.2)
                s.sleep(0.3)
                s.page.mouse.up()
                s.sleep(0.4)
                fx1 = (s.js(READ_JS).get("r") or {}).get("fx")
                hurt3 = s.js("() => window.__FJ_HURT__")
                breaks = [h for h in hurt3 if h.get("broke")]
                nb = fx1["shieldBreaks"] - fx0["shieldBreaks"]
                if not breaks:
                    v.cnj("shield break: exactly one burst, on the breaking hit", "no breaking hit landed (%d hits, %d rounds fired)" % (
                        len(hurt3), s.js("() => window.__LC__.W.stats.shotsFired") - f_s))
                else:
                    v.check("shield break: exactly one burst, on the breaking hit", nb == 1, {"bursts": nb, "breakingHits": len(breaks), "hits": len(hurt3)})
            s.js(TICK_JS, False)
            errs = s.safe_js("() => window.__FJ_ERR__ || []", default=[])
            d = s.diagnostics()
            v.check("no game errors while the frames ran", not (errs or d["pageErrors"] or d["windowErrors"]),
                    {"pumpErrors": errs[:2], "pageErrors": d["pageErrors"][:2], "windowErrors": d["windowErrors"][:2]})
    return C.run_gate("feelcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
