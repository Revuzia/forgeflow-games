#!/usr/bin/env python
"""audiotap - the P1-B audio probe (F:/lc_p1/P1-B/probe_core.py + plib.py) promoted to a gate (P2-F port): a tap on the FINAL AudioContext
output (everything connected to ctx.destination, after the limiter), real game events emitted with the kernel loop frozen (fixed camera and
listener), what reaches the ear analysed. LC-02 listener, LC-08 gun reports, LC-26 occlusion, LC-53 mix are IN the base: the rows COUNT now.

    python _harness/p23/audiotap.py --disk
    python _harness/p23/audiotap.py --rev e10b9836              # control: the snapshot before P1 (camera ear, no tails, no occlusion, flat mix) - MUST FAIL
    python _harness/p23/audiotap.py --disk --plant no-occlusion # the map answers no colliders to the audio probes after setup - MUST FAIL
    python _harness/p23/audiotap.py --disk --plant team-blind   # every actor reads as an enemy (C-MODE teamId) - MUST FAIL (mate step not ducked)

STANDARD match (Savanna seed 7) landed under the guard; music muted and the beds stopped (phase 'probe'); Math.random pinned to 0.5 during each
emit so every repeat plays the same variant (the comparisons see only the placement). Rows (plan section 5 Audio; P1-B's numbers in brackets):
  tap             the tap captured audio from the game's output (a silent tap is could-not-judge, never a pass)
  listener        footstep placement gain front vs back of the PLAYER (not the camera): pairs within 1.5 dB (crouch 9 m, walk 16 m)  [<= 0.4 dB]
  crouch-heard    a crouched step at 9 m reaches the ear (not culled)                                                                  [-36.8 dBFS peak]
  ild             an AR 20 m to the right is louder in the right ear, 20 m left louder in the left (|L-R| >= 2 dB, right sign)         [-4.7 / +4.7]
  tail-5m         an AR report at 5 m rings >= 250 ms to -40 dB                                                                        [base 50 ms]
  delay-450m      a sniper at 450 m is heard >= 1.2 s after the shot (sound speed)                                                     [+1.31 s]
  occlusion       a wall between source and ear (the same two points, the wall collider present vs removed): 4-8 dB quieter (rms)   [5.6-5.7]
  mix             an enemy step at 10 m is >= 6 dB louder than a team-mate's step at the same place                                    [13.7 dB]
  errors
"""
from __future__ import annotations

import argparse
import base64
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "no-occlusion": "const q0 = W.map.queryColliders.bind(W.map); W.map.queryColliders = function (x, z, r, out) { if (window.__P23A_ON__) { if (out) { out.length = 0; return out; } return []; } return q0(x, z, r, out); }",
    "team-blind": "for (const a of W.actors) Object.defineProperty(a, 'teamId', { configurable: true, get: () => 'T' + a.id, set: () => {} })",
}

TAP_JS = r"""(() => {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const oc = AudioNode.prototype.connect;
  window.__TAP__ = { chunks: [], times: [], on: false, sr: 0 };
  AudioNode.prototype.connect = function (dest) {
    const r = oc.apply(this, arguments);
    try { if (dest instanceof AudioDestinationNode && !this.__tapped) { this.__tapped = true; const ctx = this.context;
        if (!ctx.__tapSP) { const sp = ctx.createScriptProcessor(2048, 2, 1); const z = ctx.createGain(); z.gain.value = 0; oc.call(sp, z); oc.call(z, ctx.destination);
          sp.onaudioprocess = (e) => { if (!window.__TAP__.on) return; const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.getChannelData(1);
            const m = new Float32Array(L.length * 2); for (let i = 0; i < L.length; i++) { m[2 * i] = L[i]; m[2 * i + 1] = R[i]; }
            window.__TAP__.chunks.push(m); window.__TAP__.times.push(e.playbackTime); };
          ctx.__tapSP = sp; window.__TAP__.sr = ctx.sampleRate; }
        oc.call(this, ctx.__tapSP); } } catch (e) { window.__TAP__.err = String(e); }
    return r; }; })();"""
# every GainNode -> PannerNode connect while __PLON__: the distance gain the game computed (deterministic)
PL_HOOK = r"""(() => { const oc = AudioNode.prototype.connect; window.__PL__ = []; const PG = new WeakSet();
  // the placement gain = the GainNode feeding a PannerNode. audio.js POOLS its positional strips (gain -> panner wired once, at strip
  // creation; a reused strip only gets g.gain.value = vol x occ), so record both a fresh connect AND every later write to such a gain.
  AudioNode.prototype.connect = function (dst) { try { if (this instanceof GainNode && dst instanceof PannerNode) { PG.add(this.gain);
    if (window.__PLON__) window.__PL__.push({ gain: this.gain.value, model: dst.panningModel, via: 'connect' }); } } catch (e) {} return oc.apply(this, arguments); };
  const d = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  Object.defineProperty(AudioParam.prototype, 'value', { configurable: true, enumerable: d.enumerable, get: d.get,
    set(v) { d.set.call(this, v); try { if (window.__PLON__ && PG.has(this)) window.__PL__.push({ gain: +v, via: 'set' }); } catch (e) {} } }); })();"""
DRAIN_JS = r"""() => { const T = window.__TAP__; const ch = T.chunks, tm = T.times; T.chunks = []; T.times = [];
  let n = 0; for (const c of ch) n += c.length; const f = new Float32Array(n); let k = 0; for (const c of ch) { f.set(c, k); k += c.length; }
  let s = ''; const u = new Uint8Array(f.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return { sr: T.sr, b64: btoa(s), t0: tm.length ? tm[0] : null }; }"""
IMPORT_JS = r"""async () => { const el = [...document.querySelectorAll('script[type=module]')].find(s => /ffg_boot3d/.test(s.src));
  const V = el ? new URL(el.src).search : ''; const base = new URL('runtime/3d/royale/', location.href.replace(/[^/]*$/, '')).href;
  window.__AM__ = await import(base + 'audio.js' + V); return V; }"""
SETUP_JS = r"""() => { const W = window.__LC__.W, p = W.player, M = W.map, out = [];
  const flat = (x, z, R) => { if (M.queryColliders(x, z, R, out).length) return false; const h0 = M.heightAt(x, z); if (h0 < M.waterY + 1) return false;
    for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; for (const r of [R * 0.5, R]) if (Math.abs(M.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0) > 0.9) return false; } return true; };
  for (let ring = 0; ring < 60; ring++) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, r = ring * 12, x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
    if (Math.abs(x) < M.half - 30 && Math.abs(z) < M.half - 30 && flat(x, z, 26)) { window.__P1B__ = { open: { x, z } }; return { x, z }; } }
  return null; }"""
PLACE_JS = r"""([x, z, yaw]) => { const W = window.__LC__.W, p = W.player, M = W.map, T = W.THREE; const y = M.heightAt(x, z);
  p.pos.set(x, y, z); if (p.obj) p.obj.position.set(x, y, z); p.input.yaw = yaw; p.yaw = yaw; p.crouching = false;
  const ey = p._hasEyeY ? p._eyeY : 1.62, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), cam = W.camera;
  cam.position.set(x - fx * 4.2 + rx * 0.7, y + ey + 0.6, z - fz * 4.2 + rz * 0.7); cam.lookAt(x + fx * 6, y + ey, z + fz * 6); cam.updateMatrixWorld(true);
  window.__AM__.update(W, 0.02); const f = new T.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize();
  window.__P1B__.f = { x: f.x, z: f.z }; window.__P1B__.r = { x: -f.z, z: f.x }; return true; }"""
ACTOR_JS = r"""() => { const W = window.__LC__.W; return (window.__PA__ = window.__PA__ || W.actors.find(x => x !== W.player && x.alive && !x.isDummy && !x.netRemote)).id; }"""
STEP_JS = r"""([d, stance, side, team]) => { const W = window.__LC__.W, p = W.player, M = W.map, P = window.__P1B__, a = window.__PA__; const dir = side === 'r' ? P.r : P.f;
  a.pos.x = p.pos.x + dir.x * d; a.pos.z = p.pos.z + dir.z * d; a.pos.y = M.heightAt(a.pos.x, a.pos.z); a.crouching = stance === 'crouch'; a.sprinting = stance === 'sprint';
  p.teamId = team ? 'T1' : null; a.teamId = team === 'mate' ? 'T1' : team === 'enemy' ? 'T2' : null;
  window.__AM__.update(W, 0.02); const R = Math.random; Math.random = () => 0.5; try { W.events.emit('footstep', a); } finally { Math.random = R; }
  return window.__AUDIO_CTX__.currentTime; }"""
SHOT_JS = r"""([wid, d, side, x, y, z]) => { const W = window.__LC__.W, p = W.player, M = W.map, P = window.__P1B__, a = window.__PA__; let e;
  if (x != null) e = { x, y, z }; else { const dir = side === 'r' ? P.r : side === 'l' ? { x: -P.r.x, z: -P.r.z } : P.f; const ex = p.pos.x + dir.x * d, ez = p.pos.z + dir.z * d; e = { x: ex, y: M.heightAt(ex, ez) + 1.5, z: ez }; }
  a.teamId = null; p.teamId = null; window.__AM__.update(W, 0.02); const R = Math.random; Math.random = () => 0.5;
  try { W.events.emit('shotFired', a, wid, e, { x: 0, y: 0, z: 1 }); } finally { Math.random = R; } return window.__AUDIO_CTX__.currentTime; }"""
WALL_JS = r"""() => { const W = window.__LC__.W, M = W.map, out = []; const cands = [];
  for (const c of M.colliders) { if (c.kind !== 'box' || c.dead) continue; const sx = c.maxX - c.minX, sz = c.maxZ - c.minZ, sy = c.maxY - c.minY; if (sy < 3) continue;
    let nx = 0, nz = 0; if (sx <= 1.2 && sz >= 6) nx = 1; else if (sz <= 1.2 && sx >= 6) nz = 1; else continue;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, gy = M.heightAt(cx, cz); if (c.minY > gy + 0.3 || c.maxY < gy + 3) continue; cands.push({ c, cx, cz, nx, nz }); }
  const clear = (x0, z0, x1, z1, skip) => { const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1;
    for (const c of M.queryColliders(mx, mz, r, out)) { if (c === skip || c.kind !== 'box' || c.dead || c.maxY - c.minY < 1) continue;
      let t0 = 0, t1 = 1, ok = true; const dx = x1 - x0, dz = z1 - z0;
      for (const [o, d, lo, hi] of [[x0, dx, c.minX, c.maxX], [z0, dz, c.minZ, c.maxZ]]) { if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; } }
      if (ok) return false; } return true; };
  for (const w of cands) for (const [sg, lo] of [[1, 2], [-1, 2], [1, 18], [-1, 18], [1, 10], [-1, 10], [1, 15], [-1, 15], [1, 5], [-1, 5]]) {
    const lx = w.cx + w.nx * sg * lo, lz = w.cz + w.nz * sg * lo, sx = w.cx - w.nx * sg * (20 - lo), sz = w.cz - w.nz * sg * (20 - lo), ox = lx + w.nz * 20, oz = lz + w.nx * 20;
    const hs = [M.heightAt(lx, lz), M.heightAt(sx, sz), M.heightAt(ox, oz)]; if (Math.max(...hs) - Math.min(...hs) > 0.8 || Math.min(...hs) < M.waterY + 1) continue;
    if (!clear(lx, lz, sx, sz, w.c) || !clear(lx, lz, ox, oz, null) || M.queryColliders(lx, lz, 0.8, out).length) continue;
    window.__WALL__ = w.c; return { listener: [lx, lz], source: [sx, M.heightAt(sx, sz) + 1.5, sz], yaw: Math.atan2(-(sx - lx), -(sz - lz)) }; }
  return null; }"""


def analyse(sr, x, t0=None, emit_t=None):
    if len(x) == 0:
        return {"empty": True}
    m = x.mean(axis=1)
    a = np.abs(m)
    pk = float(a.max())
    if pk < 1e-5:
        return {"silent": True}
    on = int(np.argmax(a > pk * 0.05))
    hop = int(sr * 0.01)
    seg = m[on:]
    r = np.array([np.sqrt(np.mean(seg[i:i + hop] ** 2)) for i in range(0, max(0, len(seg) - hop), hop)])
    rd = 20 * np.log10(np.maximum(r, 1e-9) / max(r.max(), 1e-9))
    pi = int(np.argmax(rd))
    k = np.where(rd[pi:] < -40)[0]
    Lc, Rc = x[on:on + int(sr * 0.12), 0], x[on:on + int(sr * 0.12), 1]
    row = {"peak": round(20 * np.log10(pk), 2), "rms10": round(20 * np.log10(max(float(r.max()) if len(r) else 0.0, 1e-9)), 2),
           "t40ms": int((pi + k[0]) * 10) if len(k) else None,
           "LmR": round(float(20 * np.log10(max(1e-9, np.sqrt(np.mean(Lc ** 2))) / max(1e-9, np.sqrt(np.mean(Rc ** 2))))), 2)}
    if t0 is not None and emit_t is not None:
        row["delayS"] = round(t0 + on / sr - emit_t, 3)
    return row


def capture(s, js, arg, settle):
    s.js("() => { window.__TAP__.chunks = []; window.__TAP__.times = []; window.__TAP__.on = true; window.__PL__ = []; window.__PLON__ = true; window.__P23A_ON__ = true; }")
    s.sleep(0.25)
    et = s.js(js, arg)
    s.sleep(settle)
    s.js("() => { window.__TAP__.on = false; window.__PLON__ = false; window.__P23A_ON__ = false; }")
    d = s.js(DRAIN_JS)
    x = np.frombuffer(base64.b64decode(d["b64"]), dtype=np.float32)
    x = x.reshape(-1, 2) if len(x) else np.zeros((0, 2), np.float32)
    row = analyse(d["sr"], x, d["t0"], et)
    pl = s.js("() => window.__PL__.slice(0, 2)")
    row["gain_dB"] = round(20 * np.log10(pl[0]["gain"]), 2) if pl and pl[0]["gain"] > 0 else None
    return row


def mean(rows, k):
    xs = [r[k] for r in rows if r.get(k) is not None]
    return round(float(np.mean(xs)), 2) if xs else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=7)
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_audiotap", init_scripts=[TAP_JS, PL_HOOK]) as s:
            s.boot()
            s.sleep(2.0)
            s.page.keyboard.press("Control")            # a real gesture: the AudioContext may start
            s.sleep(1.0)
            L.dismiss_cards(s)
            v.data["start"] = s.start_match("standard", args.seed, args.map, enter=True, guard=True)
            s.land(140, 1 / 30, protect=True)
            s.freeze_loop()
            s.install_pump()
            s.step_frames(3, 1 / 60, render=True)
            s.js(IMPORT_JS)
            for _ in range(40):
                if (s.safe_js("() => window.__AM__.readback(window.__LC__.W).sfxDecoded", default=0) or 0) >= 60:
                    break
                s.sleep(0.25)
            s.js("() => { const W = window.__LC__.W; W.settings.musicVol = 0; window.__AM__.setVolumes(W); (window.__GAME_AUDIO__ || []).forEach(a => a.volume = 0); }")
            s.js("() => { const W = window.__LC__.W; W.__probePhase = W.phase; W.phase = 'probe'; window.__AM__.update(W, 0.02); }")
            s.js(ACTOR_JS)
            spot = s.js(SETUP_JS)
            if not spot:
                v.cnj("tap", "no open flat spot for the listener")
                return
            s.js(PLACE_JS, [spot["x"], spot["z"], 0.7])
            wall = s.js(WALL_JS)
            v.data["wall"] = wall
            s.js(PLACE_JS, [spot["x"], spot["z"], 0.7])
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            capture(s, STEP_JS, [9, "walk", "f", None], 2.0)            # warm-up (discarded)
            R = v.data["rows"] = {}
            st = {}
            for stance, d in (("crouch", 9), ("walk", 16)):
                for sg in (1, -1):
                    st["%s%+d" % (stance, sg * d)] = [capture(s, STEP_JS, [sg * d, stance, "f", None], 1.0) for _ in range(3)]
            R["steps"] = {k: {"gain_dB": mean(x, "gain_dB"), "peak": mean(x, "peak"), "heard": sum(1 for r in x if "peak" in r)} for k, x in st.items()}
            heard_any = any(R["steps"][k]["heard"] for k in R["steps"])
            if not heard_any:
                v.cnj("tap (the tap captured the game's output)", "every capture was silent / empty: no AudioContext output reached the tap")
                return
            v.check("tap (the tap captured the game's output)", True, {"heard": {k: x["heard"] for k, x in R["steps"].items()}}, "> 0")
            pairs = {}
            for stance, d in (("crouch", 9), ("walk", 16)):
                f, b = R["steps"]["%s+%d" % (stance, d)]["gain_dB"], R["steps"]["%s-%d" % (stance, d)]["gain_dB"]
                pairs[stance] = None if f is None or b is None else round(abs(f - b), 2)
            v.check("listener (front / back step placement gain within 1.5 dB: crouch 9 m, walk 16 m)", all(x is not None and x <= 1.5 for x in pairs.values()),
                    {"pairDiffDb": pairs, "gains": {k: x["gain_dB"] for k, x in R["steps"].items()}}, "<= 1.5 dB")
            c9 = R["steps"]["crouch+9"]
            v.check("crouch-heard (a crouched step at 9 m reaches the ear)", c9["heard"] >= 2 and (c9["peak"] or -200) > -60, c9, "heard, peak > -60 dBFS")
            ild = [capture(s, SHOT_JS, ["ar", 20, side, None, None, None], 1.5) for side in ("r", "l")]
            R["ild"] = ild
            v.check("ild (AR 20 m right: right ear louder; left: left ear louder; >= 2 dB)", (ild[0].get("LmR") or 0) <= -2 and (ild[1].get("LmR") or 0) >= 2,
                    {"rightLmR": ild[0].get("LmR"), "leftLmR": ild[1].get("LmR")}, "<= -2 / >= +2")
            ar5 = capture(s, SHOT_JS, ["ar", 5, "f", None, None, None], 2.6)
            sn450 = capture(s, SHOT_JS, ["sniper", 450, "f", None, None, None], 3.2)
            R["ar5"], R["sniper450"] = ar5, sn450
            v.check("tail-5m (AR at 5 m rings >= 250 ms to -40 dB)", (ar5.get("t40ms") or 0) >= 250, {"t40ms": ar5.get("t40ms")}, ">= 250 ms")
            v.check("delay-450m (sniper at 450 m heard >= 1.2 s after the shot)", (sn450.get("delayS") or 0) >= 1.2, {"delayS": sn450.get("delayS"), "peak": sn450.get("peak")}, ">= 1.2 s")
            if not wall:
                v.cnj("occlusion (4-8 dB behind a wall)", "no thin tall wall with open ground on both sides on this map")
            else:
                s.js(PLACE_JS, [wall["listener"][0], wall["listener"][1], wall["yaw"]])
                occ, opn = [], []
                for _ in range(3):
                    s.js("() => { window.__WALL__.dead = false; }")
                    occ.append(capture(s, SHOT_JS, ["ar", None, None] + wall["source"], 2.0))
                    s.js("() => { window.__WALL__.dead = true; }")
                    opn.append(capture(s, SHOT_JS, ["ar", None, None] + wall["source"], 2.0))
                s.js("() => { window.__WALL__.dead = false; }")
                a, b = mean(occ, "rms10"), mean(opn, "rms10")
                drop = None if a is None or b is None else round(b - a, 2)
                R["occlusion"] = {"behind": a, "removed": b, "dropDb": drop}
                v.check("occlusion (the same two points, wall present vs removed: 4-8 dB quieter)", drop is not None and 4.0 <= drop <= 8.0, R["occlusion"], "4-8 dB")
                s.js(PLACE_JS, [spot["x"], spot["z"], 0.7])
            en = [capture(s, STEP_JS, [10, "walk", "f", "enemy"], 1.0) for _ in range(3)]
            mt = [capture(s, STEP_JS, [10, "walk", "f", "mate"], 1.0) for _ in range(3)]
            e, m = mean(en, "rms10"), mean(mt, "rms10")
            R["mix"] = {"enemy": e, "mate": m, "diffDb": None if e is None or m is None else round(e - m, 2)}
            v.check("mix (enemy step >= 6 dB louder than a team-mate's at 10 m)", R["mix"]["diffDb"] is not None and R["mix"]["diffDb"] >= 6.0, R["mix"], ">= 6 dB")
            s.js("() => { const W = window.__LC__.W; if (W.__probePhase) W.phase = W.__probePhase; }")
            L.errors_row(v, s)
    return C.run_gate("p23_audiotap", body, args)


if __name__ == "__main__":
    sys.exit(main())
