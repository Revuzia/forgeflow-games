#!/usr/bin/env python
"""BLOCKTOOTH play-critic flow sweep — every screen / flow driven with REAL keys (page.keyboard) and
real mouse clicks (page.mouse). __BT__ is read for observation; cheats are used ONLY in the tabloid
section (?dev=1) to reach a run end quickly after the early game was played for real.

    python _harness/scratch/flows.py --base http://localhost:5192/ [--only A,B,...]

Writes _harness/_reports/critic_flows.json and _shots/critic/flows/*.png.
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import (Session, add_common_args, build_url, detect_focus, menus_to_slate, owned_total, save_report,  # noqa: E402
                    world_to_keys, SHOTS, TITAN_NAMES, BIOME_NAMES, TITANS, BIOMES)
from playtest import OBS_JS  # noqa: E402

SHOT_DIR = os.path.join(SHOTS, "critic", "flows")
os.makedirs(SHOT_DIR, exist_ok=True)

# Audio tap: capture the first AudioContext's first gains + bus edges (read-only observation).
AUDIO_JS = r"""
(() => {
  if (window.__AU__ || !window.BaseAudioContext) return;
  const AU = window.__AU__ = { ctx: null, gains: [], edges: [] };
  const cg = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain = function (...a) {
    const g = cg.apply(this, a);
    try { if (this instanceof AudioContext) { if (!AU.ctx) AU.ctx = this; if (this === AU.ctx && AU.gains.length < 16) AU.gains.push(g); } } catch (_) {}
    return g;
  };
  const cn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...r) {
    try {
      const i = AU.gains.indexOf(this);
      if (i >= 0 && AU.edges.length < 200) {
        const j = AU.gains.indexOf(dst);
        AU.edges.push([i, j >= 0 ? 'g' + j : (dst && dst.constructor && dst.constructor.name) || '?']);
      }
    } catch (_) {}
    return cn.call(this, dst, ...r);
  };
  AU.taps = null;
  AU.tap = () => {
    if (!AU.ctx) return null;
    if (!AU.taps) {
      AU.taps = {};
      const mk = (name, idx) => { const g = AU.gains[idx]; if (!g) return; const a = AU.ctx.createAnalyser(); a.fftSize = 2048; cn.call(g, a); AU.taps[name] = a; };
      mk('master', 0); mk('sfx', 2); mk('music', 3); mk('duck', 4);
    }
    return true;
  };
  AU.rms = () => {
    const out = {};
    if (!AU.taps) return out;
    for (const k in AU.taps) {
      const a = AU.taps[k]; const buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
      let s = 0, pk = 0; for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; pk = Math.max(pk, Math.abs(buf[i])); }
      out[k] = { rms: Math.sqrt(s / buf.length), peak: pk };
    }
    return out;
  };
})();
"""

LAT_JS = r"""
(code) => { window.__LAT__ = null; const resolve = (v) => { window.__LAT__ = v; };
  const W = window.__BT__ && window.__BT__.world; if (!W) return resolve({ err: 'no world' });
  const T = W.titan; let t0 = null; let tickAt = null, tick0 = W.tick, posAt = null; const x0 = T.x, z0 = T.z;
  const onKey = (e) => { if (e.code === code && t0 === null) t0 = e.timeStamp; };
  window.addEventListener('keydown', onKey, true);
  const start = performance.now();
  const loop = (ts) => {
    const W2 = window.__BT__.world; const T2 = W2.titan;
    if (t0 !== null) {
      const sp = Math.hypot(T2.vx, T2.vz);
      if (tickAt === null && sp > 0.05) tickAt = { t: ts, ms: ts - t0, sp, ticks: W2.tick - tick0 };
      if (posAt === null && Math.hypot(T2.x - x0, T2.z - z0) > 0.05) posAt = { ms: ts - t0 };
      if (tickAt && ts - t0 > 1500) {
        window.removeEventListener('keydown', onKey, true);
        const max = T2.speed;
        return resolve({ firstVelMs: tickAt.ms, firstVelSpeed: tickAt.sp, firstPosMs: posAt && posAt.ms, speedAt1500: max });
      }
    }
    if (performance.now() - start > 4000) { window.removeEventListener('keydown', onKey, true); return resolve({ err: 'timeout', t0, tickAt }); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop); return true;
}
"""

# ramp: sample titan speed each rAF for 1.2 s after the key goes down
RAMP_JS = r"""
(ms) => { window.__RAMP__ = null; const resolve = (v) => { window.__RAMP__ = v; };
  const out = []; const s0 = performance.now();
  const loop = (ts) => { const T = window.__BT__.world.titan; out.push([Math.round(ts - s0), +T.speed.toFixed(3)]);
    if (ts - s0 > ms) return resolve(out); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); return true;
}
"""

R = {"checks": [], "notes": {}}


def check(name, ok, detail=None):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print("  [%s] %s %s" % ("OK" if ok else "!!", name, "" if detail is None else json.dumps(detail, default=str)[:400]), flush=True)
    return ok


def note(k, v):
    R["notes"][k] = v
    print("  note %s = %s" % (k, json.dumps(v, default=str)[:600]), flush=True)


def snap(sess, name):
    p = os.path.join(SHOT_DIR, name + ".png")
    sess.screenshot(p)
    return p


def st(sess):
    return sess.state() or {}


def wait_for(sess, pred, timeout=10, poll=0.1):
    d = time.time() + timeout
    s = None
    while time.time() < d:
        s = st(sess)
        try:
            if pred(s):
                return True, s
        except Exception:
            pass
        time.sleep(poll)
    return False, s


def audio(sess):
    return sess.safe_js("() => { const A = window.__AU__; if (!A) return {tap: 'none'}; const c = A.ctx;"
                        " if (c) A.tap(); return { state: c ? c.state : null, gains: A.gains.length, edges: A.edges.slice(0, 16), rms: A.rms() }; }")


def rms_series(sess, n=10, dt=0.2):
    out = []
    for _ in range(n):
        a = audio(sess) or {}
        out.append({k: round(v["rms"], 5) for k, v in (a.get("rms") or {}).items()})
        time.sleep(dt)
    agg = {}
    for o in out:
        for k, v in o.items():
            agg.setdefault(k, []).append(v)
    return {k: {"max": max(v), "mean": round(sum(v) / len(v), 5)} for k, v in agg.items()}


def play_until_draft(sess, timeout=60):
    """Steer toward food with WASD until a draft opens (real keys)."""
    d = time.time() + timeout
    while time.time() < d:
        obs = sess.safe_js(OBS_JS, {"banned": []}) or {}
        s = obs.get("s") or {}
        if s.get("screen") == "draft":
            return True, s
        T = obs.get("t") or {}
        f = obs.get("food")
        if f and T:
            keys = world_to_keys(f["x"] - T["x"], f["z"] - T["z"]) or {"KeyW"}
        else:
            keys = {"KeyW"}
        sess.hold(keys)
        time.sleep(0.12)
    return False, st(sess)


def sec_menus(sess, args):
    print("== A. title / select / slate", flush=True)
    sess.goto(build_url(args.base))
    sess.wait_bt(60)
    ok, scr = sess.wait_screen("title", 60)
    check("boot → title (no params)", ok, scr)
    time.sleep(1.0)
    a0 = audio(sess)
    note("audio_before_gesture", a0)
    snap(sess, "A_title")
    # title ignores keys for armMs 350 — press once
    t0 = time.time()
    sess.press("Enter")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "select", 10)
    check("Enter on title → select", ok, {"screen": s.get("screen"), "s": round(time.time() - t0, 2)})
    time.sleep(1.2)
    a1 = audio(sess)
    check("AudioContext running after first gesture (Enter)", (a1 or {}).get("state") == "running", {"state": (a1 or {}).get("state"), "edges": (a1 or {}).get("edges")})
    note("select_music_rms", rms_series(sess, 10, 0.2))
    tn = [TITAN_NAMES[t] for t in TITANS]
    f0, _ = detect_focus(sess, tn)
    sess.press("ArrowRight"); time.sleep(0.25)
    f1, _ = detect_focus(sess, tn)
    sess.press("ArrowRight"); time.sleep(0.25)
    f2, _ = detect_focus(sess, tn)
    sess.press("ArrowLeft"); time.sleep(0.25)
    f3, _ = detect_focus(sess, tn)
    check("select step 1: arrows move titan focus", f0 != f1 and f1 != f2 and f3 == f1, [f0, f1, f2, f3])
    snap(sess, "A_select_titan")
    sess.press("Enter"); time.sleep(0.7)
    bn = [BIOME_NAMES[b] for b in BIOMES]
    b0, info = detect_focus(sess, bn)
    check("Enter → step 2 (biome cards)", b0 is not None, {"focus": b0, "screen": st(sess).get("screen")})
    snap(sess, "A_select_biome")
    sess.press("Escape"); time.sleep(0.6)
    fb, _ = detect_focus(sess, tn)
    s = st(sess)
    check("Esc on step 2 → back to step 1 (still select, titan kept)", s.get("screen") == "select" and fb == f1, {"screen": s.get("screen"), "focus": fb, "want": f1})
    sess.press("Escape"); time.sleep(0.8)
    s = st(sess)
    check("Esc on step 1 → title", s.get("screen") == "title", s.get("screen"))
    sess.press("Enter")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "select", 10)
    check("title → select again", ok, s.get("screen"))
    time.sleep(1.0)
    fr, _ = detect_focus(sess, tn)
    note("select_remembers_titan_after_title_roundtrip", {"focus": fr, "was": f1})
    ok, nav = menus_to_slate(sess, "molo", "grideast", log=lambda *_: None)
    check("select → molo / grideast → slate (keys)", ok, nav.get("error") or nav.get("afterDrop"))
    time.sleep(1.0)
    snap(sess, "A_slate")
    s = st(sess)
    cd0 = s.get("abilityCd")
    sess.press("Space")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "play", 5)
    time.sleep(0.6)
    s = st(sess)
    ev = sess.safe_js("() => window.__BT__.events(400).filter(e => e.type === 'ability' || e.type === 'titanAttack' && e.attack === 'hook').length", default=None)
    check("slate dismissed with Space → play, Space did NOT leak into a hook", ok and (s.get("abilityCd") or 0) <= 0.01 and not ev,
          {"screen": s.get("screen"), "abilityCd": s.get("abilityCd"), "abilityEvents": ev})
    a2 = audio(sess)
    note("audio_play_state", {"state": (a2 or {}).get("state")})
    note("play_music_rms_idle", rms_series(sess, 12, 0.25))


def sec_latency(sess, args):
    print("== B. input → motion latency", flush=True)
    res = []
    for i, code in enumerate(["KeyD", "KeyW", "KeyA", "KeyS", "ArrowRight", "KeyD"]):
        sess.release_all()
        time.sleep(0.9)            # come to rest
        sess.page.evaluate(LAT_JS, code)
        time.sleep(0.05)
        sess.page.keyboard.down(code)
        time.sleep(1.8)
        sess.page.keyboard.up(code)
        r = sess.js("() => window.__LAT__") or {"err": "no result"}
        r["code"] = code
        res.append(r)
    note("latency_trials", res)
    v = [r["firstVelMs"] for r in res if isinstance(r.get("firstVelMs"), (int, float))]
    if v:
        v.sort()
        note("latency_keydown_to_velocity_ms", {"min": round(v[0], 1), "median": round(v[len(v) // 2], 1), "max": round(v[-1], 1)})
    # speed ramp
    sess.release_all(); time.sleep(0.9)
    sess.page.evaluate(RAMP_JS, 1200)
    sess.page.keyboard.down("KeyD")
    time.sleep(1.35)
    ramp = sess.js("() => window.__RAMP__") or []
    sess.page.evaluate(RAMP_JS, 900)
    sess.page.keyboard.up("KeyD")
    time.sleep(1.05)
    stop = sess.js("() => window.__RAMP__") or []
    mx = max(x[1] for x in ramp) if ramp else 0
    t90 = next((x[0] for x in ramp if x[1] >= 0.9 * mx), None)
    t_stop = next((x[0] for x in stop if x[1] <= 0.1 * mx), None)
    note("speed_ramp", {"maxSpeed": mx, "ms_to_90pct": t90, "ms_to_stop_after_keyup": t_stop,
                        "ramp_head": ramp[:12], "stop_head": stop[:12]})


def sec_pause(sess, args):
    print("== C. pause / resume / settings", flush=True)
    sess.release_all(); time.sleep(0.3)
    sess.press("Escape")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "pause", 3)
    t1 = s.get("tick"); time.sleep(1.0); t2 = st(sess).get("tick")
    check("Esc → pause, sim frozen", ok and t1 == t2, {"screen": s.get("screen"), "tick": [t1, t2]})
    snap(sess, "C_pause")
    time.sleep(0.3)
    sess.press("Escape")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "play", 3)
    time.sleep(0.6)
    s2 = st(sess)
    check("Esc again → resume, no re-pause double-trigger", ok and s2.get("screen") == "play", s2.get("screen"))
    sess.press("KeyP")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "pause", 3)
    check("P → pause", ok, s.get("screen"))
    time.sleep(0.3)
    sess.press("KeyP")
    ok, s = wait_for(sess, lambda s: s.get("screen") == "play", 3)
    time.sleep(0.5)
    check("P again → resume", ok and st(sess).get("screen") == "play", st(sess).get("screen"))
    # held movement through a pause
    sess.hold({"KeyD"}); time.sleep(0.6)
    sess.press("Escape"); wait_for(sess, lambda s: s.get("screen") == "pause", 3); time.sleep(0.4)
    sess.press("Escape"); wait_for(sess, lambda s: s.get("screen") == "play", 3)
    time.sleep(0.2)
    x0 = st(sess).get("x"); time.sleep(0.8); x1 = st(sess).get("x")
    s = st(sess)
    moved = abs((x1 or 0) - (x0 or 0))
    note("held_D_through_pause_then_resume_moves_m", {"dx": round(moved, 3), "screen": s.get("screen")})
    sess.release_all(); time.sleep(0.3)
    # __PAUSE__
    sess.js("() => window.__PAUSE__.pause()")
    ok1, _ = wait_for(sess, lambda s: s.get("screen") == "pause", 3)
    sess.js("() => window.__PAUSE__.resume()")
    ok2, _ = wait_for(sess, lambda s: s.get("screen") == "play", 5)
    time.sleep(0.4)
    sess.js("() => window.__PAUSE__.toggle()")
    ok3, _ = wait_for(sess, lambda s: s.get("screen") == "pause", 3)
    time.sleep(0.3)
    sess.js("() => window.__PAUSE__.toggle()")
    ok4, _ = wait_for(sess, lambda s: s.get("screen") == "play", 5)
    check("__PAUSE__ pause/resume/toggle×2", ok1 and ok2 and ok3 and ok4, [ok1, ok2, ok3, ok4])
    time.sleep(0.5)
    # window blur (focus lost to another app, tab still visible)
    sess.js("() => window.dispatchEvent(new Event('blur'))")
    time.sleep(0.6)
    s = st(sess)
    note("window_blur_event_pauses", {"screen_after_blur": s.get("screen"), "docHidden": sess.js("() => document.hidden"),
                                       "hasFocus": sess.js("() => document.hasFocus()")})
    # real tab switch → hidden
    p2 = sess.context.new_page()
    p2.goto("about:blank")
    p2.bring_to_front()
    time.sleep(1.0)
    s = st(sess)
    hid = sess.js("() => document.hidden")
    check("tab hidden → auto-pause", s.get("screen") == "pause", {"screen": s.get("screen"), "hidden": hid})
    p2.close()
    sess.page.bring_to_front()
    time.sleep(0.6)
    if st(sess).get("screen") == "pause":
        sess.press("Escape")
        wait_for(sess, lambda s: s.get("screen") == "play", 3)
    # F1 debug overlay
    vis0 = sess.js("() => { const d = document.querySelector('.bt-debug'); return d ? getComputedStyle(d).display : 'none-el'; }")
    sess.press("F1"); time.sleep(0.5)
    vis1 = sess.js("() => { const d = document.querySelector('.bt-debug'); return d ? getComputedStyle(d).display + '|' + d.innerText.slice(0, 160) : 'none-el'; }")
    snap(sess, "C_debug_overlay")
    sess.press("F1"); time.sleep(0.4)
    vis2 = sess.js("() => { const d = document.querySelector('.bt-debug'); return d ? getComputedStyle(d).display : 'none-el'; }")
    check("F1 toggles the debug overlay", vis0 != vis1.split("|")[0] and vis2 == vis0, [vis0, vis1, vis2])
    # settings
    before = sess.js("() => localStorage.getItem('blocktooth.settings.v1')")
    sess.press("Escape"); wait_for(sess, lambda s: s.get("screen") == "pause", 3); time.sleep(0.35)
    sess.press("ArrowDown"); time.sleep(0.15)
    sess.press("Enter"); time.sleep(0.6)
    vis = sess.js("() => { const d = document.querySelector('.bt-settings'); return d && !d.classList.contains('bt-hidden'); }")
    check("pause → Settings opens", vis, vis)
    snap(sess, "C_settings")
    seq = ["ArrowLeft"] * 4 + ["ArrowDown", "ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowLeft", "ArrowDown", "ArrowLeft",
                                 "ArrowDown", "ArrowLeft", "ArrowDown", "ArrowRight"]
    for k in seq:
        sess.press(k); time.sleep(0.12)
    snap(sess, "C_settings_changed")
    vals = sess.js("() => [...document.querySelectorAll('.bt-settings .bt-set-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
    note("settings_rows_after_edit", vals)
    # P inside settings closes settings only
    sess.press("KeyP"); time.sleep(0.5)
    s = st(sess)
    sv = sess.js("() => { const d = document.querySelector('.bt-settings'); return d && !d.classList.contains('bt-hidden'); }")
    check("P in Settings closes Settings, pause stays (no double-trigger)", s.get("screen") == "pause" and not sv, {"screen": s.get("screen"), "settingsVisible": sv})
    after = sess.js("() => localStorage.getItem('blocktooth.settings.v1')")
    check("settings saved to localStorage", after and after != before, {"before": before, "after": after})
    cls = sess.js("() => document.documentElement.className")
    note("html_class_after_reduce_flash", cls)
    sess.press("Escape"); wait_for(sess, lambda s: s.get("screen") == "play", 3)
    R["settings_saved"] = after


def sec_draft(sess, args):
    print("== D. drafts (keys, R reroll, mouse)", flush=True)
    sess.release_all()
    ok, s = play_until_draft(sess, 90)
    check("played into a draft", ok, {"screen": s.get("screen"), "t": s.get("t"), "level": s.get("level")})
    if not ok:
        return
    held = sorted(sess.held)
    time.sleep(0.9)
    snap(sess, "D_draft")
    s = st(sess)
    off0 = (s.get("drafts") or {}).get("offer")
    rr0 = (s.get("drafts") or {}).get("rerolls")
    cards = sess.js("() => [...document.querySelectorAll('.bt-dossier')].map(c => c.innerText.replace(/\\s+/g, ' ').slice(0, 140))")
    note("draft_cards_text", cards)
    sess.press("KeyR"); time.sleep(0.9)
    s = st(sess)
    off1 = (s.get("drafts") or {}).get("offer")
    rr1 = (s.get("drafts") or {}).get("rerolls")
    check("R rerolls the offer", off1 and off1 != off0 and s.get("screen") == "draft", {"before": off0, "after": off1, "rerolls": [rr0, rr1]})
    sess.press("KeyR"); time.sleep(0.9)
    s = st(sess)
    note("second_R_with_rerolls_left", {"offer": (s.get("drafts") or {}).get("offer"), "rerolls": (s.get("drafts") or {}).get("rerolls")})
    ow0 = owned_total(s.get("owned"))
    sess.press("Digit2")
    ok, s = wait_for(sess, lambda s: owned_total(s.get("owned")) > ow0, 4)
    check("key 2 picks (owned grew)", ok, {"owned": [ow0, owned_total(s.get("owned"))], "screen": s.get("screen")})
    time.sleep(0.8)
    s = st(sess)
    if s.get("screen") == "draft":
        note("another_draft_queued", True)
        sess.press("Digit1"); time.sleep(1.0)
    # movement key still physically held since before the draft?
    if held:
        x0, z0 = st(sess).get("x"), st(sess).get("z")
        time.sleep(0.8)
        x1, z1 = st(sess).get("x"), st(sess).get("z")
        note("held_key_through_draft_moves_after", {"held": held, "moved_m": round(math.hypot((x1 or 0) - (x0 or 0), (z1 or 0) - (z0 or 0)), 3),
                                                   "screen": st(sess).get("screen")})
    # next draft by mouse
    sess.release_all()
    ok, s = play_until_draft(sess, 120)
    if ok:
        time.sleep(1.0)
        ow0 = owned_total(s.get("owned"))
        box = sess.js("() => { const c = document.querySelectorAll('.bt-dossier')[2]; if (!c) return null; const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        sess.release_all()
        if box:
            sess.page.mouse.move(box[0], box[1]); time.sleep(0.2)
            sess.page.mouse.click(box[0], box[1])
        ok2, s2 = wait_for(sess, lambda s: owned_total(s.get("owned")) > ow0, 4)
        check("mouse click on card 3 picks it", ok2, {"box": box, "owned": [ow0, owned_total(s2.get("owned"))]})
        time.sleep(0.8)
        if st(sess).get("screen") == "draft":
            sess.press("Digit1"); time.sleep(1.0)
        # Space mashing when a draft pops: must not pick blind
        sess.release_all()
        ok, s = play_until_draft(sess, 120)
        if ok:
            ow0 = owned_total(s.get("owned"))
            for _ in range(3):
                sess.press("Space"); time.sleep(0.08)
            time.sleep(0.5)
            s2 = st(sess)
            note("space_mash_on_draft_open", {"picked": owned_total(s2.get("owned")) > ow0, "screen": s2.get("screen")})
            if s2.get("screen") == "draft":
                sess.press("Digit1"); time.sleep(1.0)
    sess.release_all()


def sec_reload(sess, args):
    print("== E. settings persistence across reload + URL params", flush=True)
    saved = R.get("settings_saved")
    sess.goto(build_url(args.base))
    sess.wait_bt(60)
    sess.wait_screen("title", 60)
    after = sess.js("() => localStorage.getItem('blocktooth.settings.v1')")
    cls = sess.js("() => document.documentElement.className")
    check("settings survive a reload (localStorage)", saved and after == saved, {"saved": saved, "after": after})
    note("html_class_on_title_after_reload", cls)
    # ?titan / ?biome preselect (no autostart)
    sess.goto(build_url(args.base, titan="briarwick", biome="whitestacks"))
    sess.wait_bt(60); sess.wait_screen("title", 60); time.sleep(0.8)
    sess.press("Enter"); sess.wait_screen("select", 15); time.sleep(1.2)
    f, _ = detect_focus(sess, [TITAN_NAMES[t] for t in TITANS])
    sess.press("Enter"); time.sleep(0.7)
    b, _ = detect_focus(sess, [BIOME_NAMES[x] for x in BIOMES])
    check("?titan=briarwick&biome=whitestacks preselect on select", f == "BRIARWICK" and b == "WHITE STACKS", [f, b])
    # ?autostart ?seed ?titan ?biome
    sess.goto(build_url(args.base, autostart=1, seed=4242, titan="voltkite", biome="lockwater"))
    sess.wait_bt(60)
    ok, scr = sess.wait_screen("slate", 60)
    s = st(sess)
    check("?autostart&seed&titan&biome → slate with those", ok and s.get("seed") == 4242 and s.get("titan") == "voltkite" and s.get("biome") == "lockwater",
          {k: s.get(k) for k in ("screen", "seed", "titan", "biome")})
    # retry from pause
    sess.press("Enter"); sess.wait_screen("play", 10); time.sleep(1.0)
    sess.press("Escape"); sess.wait_screen("pause", 3); time.sleep(0.35)
    sess.press("ArrowDown"); sess.press("ArrowDown"); time.sleep(0.15)
    sess.press("Enter"); time.sleep(0.6)
    s1 = st(sess)
    txt = sess.js("() => (document.querySelector('.bt-pause-confirm') || {}).innerText")
    check("Retry needs a confirming second press (first press arms)", s1.get("screen") == "pause", {"screen": s1.get("screen"), "confirmLine": txt})
    sess.press("Enter")
    ok, s2 = wait_for(sess, lambda s: s.get("screen") == "slate" and s.get("seed") != 4242, 30)
    check("Retry from pause → new run, same titan/biome, new seed", ok and s2.get("titan") == "voltkite" and s2.get("biome") == "lockwater",
          {k: s2.get(k) for k in ("screen", "seed", "titan", "biome", "t")})
    note("retry_from_pause_shows_slate_again", s2.get("screen"))
    sess.press("Enter"); sess.wait_screen("play", 10); time.sleep(0.8)
    # quit to title
    sess.press("Escape"); sess.wait_screen("pause", 3); time.sleep(0.35)
    for _ in range(3):
        sess.press("ArrowDown"); time.sleep(0.1)
    sess.press("Enter"); time.sleep(0.4); sess.press("Enter")
    ok, s = sess.wait_screen("title", 15)
    check("Quit (confirmed) → title", ok, s)
    # ?noslate
    sess.goto(build_url(args.base, autostart=1, noslate=1, titan="briarwick"))
    sess.wait_bt(60)
    ok, scr = sess.wait_screen(("play", "slate"), 60)
    check("?autostart&noslate → straight to play", scr == "play", scr)


def sec_tabloid(sess, args):
    print("== F. run end → tabloid RETRY / CHANGE TITAN / TITLE (cheats only to reach death)", flush=True)
    url = build_url(args.base, dev=1, autostart=1, noslate=1, titan="molo", biome="grideast", seed=77)

    def die():
        # play 6 s for real first, then swarm
        sess.hold({"KeyW"}); time.sleep(3); sess.hold({"KeyD"}); time.sleep(3); sess.release_all()
        sess.cheat("spawn", "tank", 60)
        sess.cheat("spawn", "walker", 30)
        d = time.time() + 120
        while time.time() < d:
            s = st(sess)
            if s.get("screen") == "draft":
                sess.press("Digit1"); time.sleep(0.8); continue
            if s.get("screen") == "end":
                return True
            if s.get("screen") == "play" and (s.get("enemies") or 0) < 20:
                sess.cheat("spawn", "tank", 40)
            time.sleep(0.5)
        return False

    sess.goto(url)
    sess.wait_bt(60)
    sess.wait_screen("play", 60)
    ok = die()
    check("reached run end (dead)", ok, st(sess).get("screen"))
    if not ok:
        return
    time.sleep(0.5)
    t_end = time.time()
    snap(sess, "F_tabloid_0s")
    sess.press("Enter"); time.sleep(0.3)
    s = st(sess)
    note("tabloid_early_Enter_swallowed_armMs", s.get("screen"))
    time.sleep(3.0)
    snap(sess, "F_tabloid")
    txt = sess.js("() => { const t = document.querySelector('.bt-tabloid'); return t ? t.innerText.replace(/\\s+/g, ' ').slice(0, 900) : null; }")
    note("tabloid_text", txt)
    if s.get("screen") == "end":
        sess.press("Enter")          # RETRY is item 0
    ok, s = wait_for(sess, lambda s: s.get("screen") in ("play", "slate") and s.get("seed") != 77, 30)
    check("tabloid RETRY (Enter) → new run same titan", ok and s.get("titan") == "molo", {k: s.get(k) for k in ("screen", "seed", "titan")})
    if s.get("screen") == "slate":
        sess.press("Enter"); sess.wait_screen("play", 10)
    ok = die()
    if ok:
        time.sleep(3.5)
        sess.press("Digit2")
        ok2, s = wait_for(sess, lambda s: s.get("screen") == "select", 20)
        time.sleep(1.2)
        f, _ = detect_focus(sess, [TITAN_NAMES[t] for t in TITANS])
        check("tabloid CHANGE TITAN (2) → select, titan preselected", ok2 and f == "MOLO", {"screen": s.get("screen"), "focus": f})
        sess.press("Escape"); time.sleep(0.7)
        s = st(sess)
        note("select_esc_after_change_titan", s.get("screen"))
    # TITLE by mouse
    sess.goto(url); sess.wait_bt(60); sess.wait_screen("play", 60)
    ok = die()
    if ok:
        time.sleep(3.5)
        box = sess.js("() => { const b = [...document.querySelectorAll('.bt-tabloid button')]; const t = b[b.length - 1]; if (!t) return null; const r = t.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, t.innerText]; }")
        if box:
            sess.page.mouse.click(box[0], box[1])
        ok2, s = wait_for(sess, lambda s: s.get("screen") == "title", 20)
        check("tabloid TITLE by mouse click → title", ok2, {"box": box, "screen": s.get("screen")})


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="A,B,C,D,E,F")
    args = ap.parse_args()
    args.no_serve = True
    only = set(args.only.split(","))
    sess = Session(args, "flows")
    sess.start()
    sess.page.add_init_script(AUDIO_JS)
    try:
        if "A" in only:
            sec_menus(sess, args)
        if "B" in only:
            sec_latency(sess, args)
        if "C" in only:
            sec_pause(sess, args)
        if "D" in only:
            sec_draft(sess, args)
        if "E" in only:
            sec_reload(sess, args)
        if "F" in only:
            sec_tabloid(sess, args)
    except Exception as e:
        import traceback
        traceback.print_exc()
        R["fatal"] = str(e)[:400]
    finally:
        R["diag"] = sess.diagnostics() if sess.page else {}
        sess.close()
    print("diag:", json.dumps({k: v[:5] for k, v in R["diag"].items() if v}, default=str)[:2000])
    print("FAILED checks:", [c["name"] for c in R["checks"] if not c["ok"]])
    save_report("critic_flows", R, args.base)


if __name__ == "__main__":
    main()
