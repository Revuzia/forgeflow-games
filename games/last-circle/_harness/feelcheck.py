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
  const mods = window.__FJ_MODS__ || {};
  const W = window.__LC__.W;
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
      if (mods.hud && mods.hud.readback) { const h = mods.hud.readback(W); s.mk = h.marker ? { style: h.marker.style, op: h.marker.opacity } : null; }
      else { const el = [...document.querySelectorAll('div')].find((d) => d.textContent === '✕'); if (el) s.mk = { style: /255, 77, 77|255, ?7[0-9], ?7[0-9]|ff4d4d/i.test(el.style.color) ? 'kill' : 'hit', op: parseFloat(el.style.opacity || '0'), color: el.style.color }; }
      if (mods.fx && mods.fx.readback) { const f = mods.fx.readback(W); s.nums = f.dmg ? f.dmg.maxPerVictim : null; s.breaks = f.shieldBreaks; }
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--burst", type=float, default=3.7, help="SMG trigger hold, minimum seconds (the audit's 3.7 s burst)")
    ap.add_argument("--burst-shots", type=int, default=30, help="hold the SMG trigger until this many rounds fired (max 45 s)")
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=4242)
    args = ap.parse_args()

    def body(v):
        with C.Session(args, "feelcheck", launch_args=[]) as s:
            s.boot()
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
                t_kill = died[0]["t"]
                after = [x for x in samples if x.get("mk") and x["t"] >= t_kill - 50]
                shown = [x for x in after if (x["mk"].get("op") or 0) >= 0.99]
                last = shown[-1]["mk"] if shown else None
                held = 0.0
                run0 = None
                for x in after:
                    ok = x["mk"].get("style") == "kill" and (x["mk"].get("op") or 0) >= 0.99
                    if ok and run0 is None:
                        run0 = x["t"]
                    if ok:
                        held = max(held, x["t"] - run0)
                    if not ok:
                        run0 = None
                v.check("pistol kill: the marker's last visible state is the kill style, held at opacity >= 0.99 for >= 250 ms",
                        bool(last and last.get("style") == "kill") and held >= 250,
                        {"lastVisible": last, "killHeldMs": round(held), "domMarkerLog": domlog[-4:], "samples": len(after), "clicks": tries})
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
            mx = max([x.get("nums") or 0 for x in samples] or [0])
            fxc = s.js("() => window.__FJ__.fxCreated")
            aud1 = (s.js(READ_JS).get("r") or {}).get("audio")
            d1 = s.js("() => window.__FJ__.duck62")
            if shots < 5 or not hurt2:
                v.cnj("SMG burst checks", "the burst did not land (shots %s, hits %d)" % (shots, len(hurt2)))
            else:
                v.check("SMG burst: <= 1 live damage number per victim at every sample", mx <= 1, {"maxLive": mx, "hits": len(hurt2), "shots": shots, "wallS": burst_wall})
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
