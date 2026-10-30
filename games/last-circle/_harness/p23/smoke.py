#!/usr/bin/env python
"""smoke - C-SMOKE / LC-14 round 2: the smoke grenade. Lanes: sim (weapons.js keeps W.smokes = [{x, y, z, r, t0, t1}] when a smoke lands; K.SMOKE),
maps (W.map.losBlocked treats a segment through a live smoke sphere as blocked), fx (the clouds), bots (throw + respect). Plan gate: "smoke cuts
bot line of sight to 0 for its lifetime, at +0.3 ms or less with 3 smokes on the iGPU". Built dark (loot weight 0) until the integrator turns it on.

    python _harness/p23/smoke.py --disk
    python _harness/p23/smoke.py --rev 9aa2b746                 # control: the P2 base (no smoke) - MUST FAIL
    python _harness/p23/smoke.py --disk --plant los-ignores     # losBlocked called with W.smokes emptied - MUST FAIL (bot sight row)
    python _harness/p23/smoke.py --disk --plant short-life      # every smoke ends 2 s after it starts - MUST FAIL (lifetime row)
    python _harness/p23/smoke.py --disk --plant no-cloud        # the clouds never drawn (sim + LOS untouched) - MUST FAIL (hides row)
    python _harness/p23/smoke.py --lanes all                    # validation: every lane's work served over the base

STANDARD solo match (Savanna seed 7), landed under the guard, the human moved to an isolated flat spot, loop frozen, frames stepped at 60 Hz:
  contract       K.SMOKE (lifeS, r), W.map.losBlocked
  spawn          a REAL throw (a smoke in slot 4, LMB, pitch 0.25): one W.smokes entry {x, y, z, r, t0, t1} within 4 s, 6-35 m ahead (a lob + roll: PUBG ~30 m)
  lifetime       t1 - t0 = K.SMOKE.lifeS (+-0.5 s) and >= 15 s (PUBG / Apex class); the entry is gone after t1 (+1 s)
  los            losBlocked through the cloud's centre at 1.2 m: false before the throw, true every 0.25 s from t0 + 2 s to t1 - 1 s, false after t1
  bot-sight      an enemy bot pinned 26 m away facing the human, provoked by him (positive control first: >= 5 rounds at him in the open in
                 6 s); the smoke between them: 0 rounds from t0 + 3 s and 0 hits from t0 + 2 s, to t1 - 1 s (LOS cut = it stops shooting)
  programs       the first cloud links no shader program after the first rendered frame of it (fx warmed)
  hides          the cloud at full size HIDES a body 7 m behind its centre on screen (what losBlocked cuts for bots, the human must not
                 see either): visibility = mean |smoke+bot - smoke| / mean |bot - nothing| over the bot's projected box <= 0.15, at the
                 tier in use and at LOW (one page task, four renders at dt 1e-5)
  cost           GPU frame time with 3 standing smokes in view minus none, <= +0.3 ms (the iGPU: --gpu d3d11). R4: the scene FROZEN (dt 1e-5:
                 no sim tick, no fx time), the same 3 cloud entries in / out of W.smokes frame by frame, adjacent on / off frames paired in ABBA
                 order, each frame its own TIME_ELAPSED query, 640 counted pairs after a warm batch; reading = the MEDIAN of the paired
                 differences, judged when its 95 % CI is no wider than the bar (else could-not-judge); > 2 other automated Chromes: information.
                 The reading is always printed ("smoke cost reading") and kept in the report (smokeCost)
  errors
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "los-ignores": "const f0 = W.map.losBlocked; W.map.losBlocked = function () { const s0 = W.smokes; W.smokes = []; try { return f0.apply(this, arguments); } finally { W.smokes = s0; } }",
    # the clouds never drawn (a fx that hides nothing): the 'smoke' group made invisible before every render; the sim's W.smokes / losBlocked
    # untouched - MUST FAIL (hides row)
    "no-cloud": "const fr = W.kernel.renderer, r0 = fr.render.bind(fr); fr.render = function () { try { const g = W.group && W.group('smoke'); if (g) g.visible = false; } catch (e) {} return r0.apply(null, arguments); }",
    "short-life": "W.kernel._updaters.push(() => { for (const q of (W.smokes || [])) if (q.t1 > q.t0 + 2) q.t1 = q.t0 + 2; })",
}

ISO_JS = r"""() => { const W = window.__LC__.W, M = W.map, p = W.player; const others = W.actors.filter((a) => a.alive && a !== p);
  // a DETERMINISTIC grid sweep (was 4,000 Math.random samples needing 120 m from every actor + a 34 m collider-free disc: none on the
  // Savanna of the lanes' world); the test needs open flat ground 30 m around (the bot sits 26 m north) and quiet: the farthest such
  // spot from every other actor wins, >= 60 m preferred
  const out = [];
  const flat = (x, z) => { const h = M.heightAt(x, z); if (h < M.waterY + 1) return false;
    for (let r = 4; r <= 30; r += 6.5) for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (Math.abs(M.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > 0.8) return false; }
    for (const c of M.queryColliders(x, z - 13, 22, out)) if (!c.dead && c.maxY > M.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) + 0.3) return false; return true; };
  let best = null; const span = M.half * 0.8, step = 16;
  for (let x = -span; x <= span; x += step) for (let z = -span; z <= span; z += step) {
    const d = others.reduce((m, a) => Math.min(m, Math.hypot(a.pos.x - x, a.pos.z - z)), 1e9); if (best && d <= best.d) continue; if (!flat(x, z)) continue;
    best = { x, z, d: +d.toFixed(1), y: M.heightAt(x, z) }; }
  return best && best.d >= 40 ? best : null; }"""
# the cloud HIDES what it blocks: losBlocked cuts the bots' sight, so a human must not see through it either (and the reverse). One page task,
# four renders at dt 1e-5 (the cloud at full size: t0 = now - 5 s): A smoke on + the bot 7 m behind its centre, B smoke on + the bot gone,
# C smoke off + bot, D smoke off + no bot. visibility = mean |A - B| / mean |C - D| over the bot's projected box (1 = the cloud hides nothing)
HIDE_JS = r"""([bid, cx, cy, cz, bx, bz, wantShot]) => { const C = window.__LC__, W = C.W, K = W.SIM, k = W.kernel, gl = k.renderer.getContext(), cam = W.camera;
  // the subject: the pinned bot if it still lives (and is drawn), else the nearest live, drawn bot (pl_smoke_nocloud 10-26: open diff 0.03 - the
  // pinned bot no longer drawn)
  const drawn = (a) => a && a.alive && a.obj && a.obj.parent && !a.downed;
  let b = W.actorById.get(bid); const was = b ? { alive: b.alive, obj: !!(b.obj && b.obj.parent), visible: !!(b.obj && b.obj.visible) } : null;
  if (!drawn(b)) b = W.actors.filter((a) => a.isBot && drawn(a)).sort((p, q) => Math.hypot(p.pos.x - bx, p.pos.z - bz) - Math.hypot(q.pos.x - bx, q.pos.z - bz))[0];
  if (!b) return { error: 'no live drawn bot', was };
  if (b.obj) b.obj.visible = true; const V = cam.position.constructor; const by = W.map.heightAt(bx, bz);
  const place = (on) => { const x = on ? bx : bx + 400; b.pos.set(x, W.map.heightAt(x, bz), bz); b.vel.set(0, 0, 0); b.alive = true; b.hp = 100; if (b._pp) b._pp.copy(b.pos); if (b.obj) b.obj.position.copy(b.pos); };
  const smoke = (on) => { W.smokes = W.smokes || []; W.smokes.length = 0; if (on) W.smokes.push({ x: cx, y: cy, z: cz, r: K.SMOKE.r, rMax: K.SMOKE.r, t0: W.t - 5, t1: W.t + 30 }); };
  const read = () => { C.stepFrames(2, 1e-5, true); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(4 * w * h); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, w, h }; };
  place(true); smoke(false); C.stepFrames(2, 1e-5, true); cam.updateMatrixWorld(true);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  for (const dx of [-0.45, 0.45]) for (const dz of [-0.45, 0.45]) for (const dy of [0.05, 1.85]) { const q = new V(bx + dx, by + dy, bz + dz).project(cam);
    const sx = (q.x + 1) / 2 * w, sy = (q.y + 1) / 2 * h; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(w - 1, Math.ceil(x1)); y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(h - 1, Math.ceil(y1));
  if (x1 - x0 < 3 || y1 - y0 < 6) return { error: 'the bot projects off screen', box: [x0, y0, x1, y1] };
  const diff = (a, c) => { let s = 0, n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = 4 * (y * w + x); s += Math.abs(a.px[i] - c.px[i]) + Math.abs(a.px[i + 1] - c.px[i + 1]) + Math.abs(a.px[i + 2] - c.px[i + 2]); n += 3; } return s / n; };
  // the OPEN pair first: a cloud taken out of W.smokes fades out on fx time, which dt 1e-5 never advances (smoke_all8 10-26: the cost
  // section's three clouds still stood in front of the bot at the first tier - open diff 0.64 / 255)
  smoke(false); place(true); const Cc = read(); place(false); const D = read();
  smoke(true); place(true); const A = read(); let shot = null; if (wantShot) { try { shot = k.renderer.domElement.toDataURL('image/png'); } catch (e) { shot = 'err:' + e; } }
  place(false); const B = read();
  smoke(false); place(true); C.stepFrames(180, 1 / 60, true);
  const dAB = diff(A, B), dCD = diff(Cc, D);
  return { visibility: dCD > 0 ? +(dAB / dCD).toFixed(3) : null, smokedDiff: +dAB.toFixed(2), openDiff: +dCD.toFixed(2), boxPx: [x0, y0, x1, y1], tier: W.gfxTier, subject: b.id, pinnedWas: was,
         shot }; }"""
# the cost scene: three cloud entries made ONCE and reused for every 'on' frame (fx binds its per-cloud cache to the entry object), 8 m apart,
# 16 m ahead of the human, at full size past their vent jets (t0 = now - 5 s); the kernel's own GPU timer off (one TIME_ELAPSED query at a time)
COST_SETUP_JS = r"""([x, y, z]) => { const W = window.__LC__.W, g = W.kernel.gpuTimer, t = W.t;
  window.__P23GT__ = g ? !!g.on : null; if (g) g.on = false; W.smokes = W.smokes || []; W.smokes.length = 0;
  const e = []; for (let i = 0; i < 3; i++) e.push({ x: x - 8 + 8 * i, y: y + 1.2, z: z - 16, r: W.SIM.SMOKE.r, rMax: W.SIM.SMOKE.r, t0: t - 5, t1: t + 600 });
  window.__P23COST__ = e; return true; }"""
# one batch: 2 x pairs frames, adjacent on / off pairs whose order alternates (ABBA), each frame = one stepFrames(1, 1e-5, render) (dt 1e-5: no
# sim tick, no fx time - the same picture every frame but the clouds). The TIME_ELAPSED queries bracket the frame's RENDER only (the kernel's
# composer.render / renderer.render, every top-level call of the frame summed - the kernel's own GPU timer brackets the same call), never the
# updaters' CPU work: a query round the whole stepFrames read +0.05 ms with NO cloud drawn (GPU idle while the CPU built the clouds' instances).
# Then the page yields until every result is available (WebGL hands query results out only after the task returns). A disjoint event voids
# the batch.
COST_BATCH_JS = r"""async ([pairs, bi]) => { const C = window.__LC__, W = C.W, k = W.kernel, gl = k.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { error: 'no EXT_disjoint_timer_query_webgl2' };
  const E = window.__P23COST__; if (!E) return { error: 'no cost scene' };
  const set = (on) => { W.smokes.length = 0; if (on) for (const q of E) W.smokes.push(q); };
  const tgt = k.composer || k.renderer, own = Object.prototype.hasOwnProperty.call(tgt, 'render'), orig = tgt.render;
  const qs = []; let arm = null, depth = 0;
  tgt.render = function () {
    let q = null;
    if (depth === 0 && arm) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    depth++;
    try { return orig.apply(this, arguments); }
    finally { depth--; if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push({ q, on: arm.on, i: arm.i }); } }
  };
  gl.getParameter(ext.GPU_DISJOINT_EXT);
  try {
    for (let i = 0; i < pairs; i++) {
      const first = ((i + bi) % 2 === 0);
      for (const on of (first ? [true, false] : [false, true])) { set(on); arm = { on, i }; C.stepFrames(1, 1e-5, true); arm = null; }
    }
  } finally { if (own) tgt.render = orig; else delete tgt.render; set(false); }
  if (!qs.length) return { error: 'no render call was timed' };
  const last = qs[qs.length - 1].q, t0 = performance.now();
  while (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) { if (performance.now() - t0 > 20000) break; await new Promise((r) => setTimeout(r, 5)); }
  const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
  const ms = {}; let missing = 0;
  for (const r of qs) {
    if (!disjoint && gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE)) { const m = (ms[r.i] = ms[r.i] || { on: 0, off: 0, non: 0, noff: 0 }); const v = gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6;
      if (r.on) { m.on += v; m.non++; } else { m.off += v; m.noff++; } }
    else missing++;
    gl.deleteQuery(r.q); }
  const out = []; for (let i = 0; i < pairs; i++) { const m = ms[i]; if (m && m.non && m.noff) out.push([m.on, m.off]); }
  return { pairs: out, disjoint, missing, calls: qs.length }; }"""
SNAP_JS = r"""() => { const W = window.__LC__.W; return (W.smokes || []).map((q) => ({ x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2), r: +(q.r || 0).toFixed(2), t0: +(q.t0 || 0).toFixed(2), t1: +(q.t1 || 0).toFixed(2) })); }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)

    def body(v):
        with C.Session(args, "p23_smoke") as s:
            s.boot()
            L.dismiss_cards(s)
            v.data["start"] = L.start(s, "standard", 7, "ashgrid", team="solo", guard=True)
            s.land(140, protect=True)
            s.freeze_loop()
            s.install_pump()
            have = L.contract(s, {"K.SMOKE": "!!K.SMOKE && K.SMOKE.lifeS > 0 && K.SMOKE.r > 0", "W.map.losBlocked": "typeof W.map.losBlocked === 'function'",
                                  "smoke item": "!!(K.CONSUMABLES && K.CONSUMABLES.smoke)"})
            L.contract_row(v, "contract (K.SMOKE, K.CONSUMABLES.smoke, W.map.losBlocked)", have)
            if not all(have.values()):
                L.errors_row(v, s)
                return
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            iso = s.js(ISO_JS)
            v.data["iso"] = iso
            if not iso:
                v.cnj("spawn", "no isolated flat spot")
                return
            life = s.js("() => window.__LC__.W.SIM.SMOKE.lifeS")
            me = s.js("() => window.__LC__.W.player.id")
            s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.input.yaw = 0; p.input.pitch = 0; }", [iso["x"], iso["z"]])
            # the enemy bot 26 m ahead (-z = yaw 0 forward), pinned, facing the human
            e = s.js("() => { const W = window.__LC__.W, p = W.player; const b = W.actors.find((a) => a.isBot && a.alive); return b && b.id; }")
            ex, ez = iso["x"], iso["z"] - 26
            ey = s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z)", [ex, ez])
            s.js("([id, x, z]) => { const W = window.__LC__.W, b = W.actorById.get(id); b.pos.set(x, W.map.heightAt(x, z), z); b.vel.set(0, 0, 0); b.onGround = true; b.gliding = false;"
                 " b.inventory.slots[1] = { kind: 'weapon', id: 'ar', rarity: 2, mag: 30 }; b.inventory.ammo.medium = 999; W.equipSlot(b, 1); }", [e, ex, ez])
            L.pin_actor(s, e, [ex, ey, ez])
            L.guard_ids(s, [e])
            # SETUP ONLY: the bot faces the human and counts as PROVOKED by him every frame (the human "just shot it"), so it answers
            # whatever its notice reach / grace / cone says - the sight rule left to judge is the one under test (smoke, then walls)
            s.js("""([id, me]) => { const W = window.__LC__.W, b = W.actorById.get(id), p = W.player; window.__P23PROV__ = () => { const a = W.actorById.get(id);
                if (!a || !a.alive) return; a.lastAttacker = me; a.lastDamageT = W.t; a.yaw = Math.atan2(-(p.pos.x - a.pos.x), -(p.pos.z - a.pos.z)); };
                W.kernel._updaters.push(window.__P23PROV__); }""", [e, me])
            s.js("([me, e]) => { const W = window.__LC__.W; window.__P23K__ = { hits: [], shots: 0, shotT: [] }; W.events.on('actorHurt', (a, d) => { if (a && a.id === me && d && d.attackerId === e) window.__P23K__.hits.push(+W.t.toFixed(2)); });"
                 " W.events.on('shotFired', (a) => { if (a && a.id === e) { window.__P23K__.shots++; window.__P23K__.shotT.push(+W.t.toFixed(2)); } }); }", [me, e])
            # positive control: in the open the bot finds and shoots the human within 6 s
            t_open = s.js("() => window.__LC__.W.t")
            s.step_frames(360, 1 / 60)
            ctrl = s.js("(t) => ({ hits: window.__P23K__.hits.filter((x) => x >= t).length, shots: window.__P23K__.shots })", t_open)
            # what the bot was doing (names a control that never fired: no weapon / no ammo / no target / asleep)
            ctrl["bot"] = s.safe_js("""(id) => { const W = window.__LC__.W, b = W.actorById.get(id), p = W.player; if (!b) return null; const w = b.weapon, br = b.brain || {};
                const pick = (o) => { const r = {}; for (const k in o) { const x = o[k]; if (x == null || typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') r[k] = x; else if (x && x.id) r[k] = 'actor:' + x.id; } return r; };
                return { alive: b.alive, weapon: w ? { id: w.id, magAmmo: w.magAmmo, state: w.state } : null, ammo: b.inventory && b.inventory.ammo, brain: pick(br),
                         dist: +Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z).toFixed(1), los: W.map.losBlocked(b.pos.x, b.pos.y + 1.5, b.pos.z, p.pos.x, p.pos.y + 1.2, p.pos.z) }; }""", e, default=None)
            v.data["openControl"] = ctrl
            # the line through the future cloud: from the bot's eye to the human's chest
            seg = [ex, ey + 1.5, ez, iso["x"], iso["y"] + 1.2, iso["z"]]
            before = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", seg)
            # a REAL throw: smoke in slot 4, LMB, pitch 0.25
            L.lock_pointer(s)
            s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[3] = { kind: 'consumable', id: 'smoke', count: 3 }; }")
            s.press("Digit4")
            s.step_frames(30, 1 / 60)
            s.js("() => { const p = window.__LC__.W.player; p.input.yaw = 0; p.input.pitch = 0.25; p.recoilPitch = 0; }")
            s.step_frames(10, 1 / 60)
            # the human throw reads the click EDGE for 420 ms of wall time (weapons.js stepThrow: W._fireEdge): on a loaded box the next stepped
            # frame can come later than that, so a real click that threw nothing (the slot still holds 3) is clicked again, up to 4 times
            clicks = 0
            for _ in range(4):
                clicks += 1
                s.page.mouse.down(button="left")
                s.step_frames(1, 1 / 60)
                s.page.mouse.up(button="left")
                if s.js("() => { const sl = window.__LC__.W.player.inventory.slots[3]; return !sl || sl.count < 3; }"):
                    break
                s.js("() => { const p = window.__LC__.W.player; p.input.yaw = 0; p.input.pitch = 0.25; p.recoilPitch = 0; }")
            v.data["throwClicks"] = clicks
            prog0 = None
            sm = []
            for _ in range(240):
                s.step_frames(1, 1 / 60, render=True)
                sm = s.js(SNAP_JS)
                if sm:
                    prog0 = L.programs(s)
                    break
            v.data["smokes"] = sm
            v.data["throwState"] = s.safe_js("() => { const W = window.__LC__.W, p = W.player, w = p.weapon; return { weapon: w && w.id, wstate: w && w.state, slots: p.inventory.slots.map((x) => x && (x.id + ':' + (x.count != null ? x.count : ''))),"
                                             " active: p.inventory.active, projectiles: (W.projectiles || []).length, t: W.t }; }", default=None)
            q = sm[0] if sm else None
            ahead = None if not q else ((q["x"] - iso["x"]) ** 2 + (q["z"] - iso["z"]) ** 2) ** 0.5
            v.check("spawn (a real throw: one W.smokes entry {x,y,z,r,t0,t1} within 4 s, 6-35 m ahead)", len(sm) == 1 and q["r"] > 0 and q["t1"] > q["t0"] and 6 <= ahead <= 35,
                    {"smokes": sm, "aheadM": ahead and round(ahead, 1), "throw": v.data.get("throwState")}, "1 entry, 6-35 m")
            if not q:
                L.errors_row(v, s)
                return
            s.step_frames(30, 1 / 60, render=True)
            prog1 = L.programs(s)
            s.screenshot(os.path.join(shots, "smoke_cloud.png"))
            v.check("programs (the first cloud links no shader program after its first rendered frame)", prog0 is not None and prog1 == prog0, {"atFirstFrame": prog0, "after": prog1}, "unchanged")
            # re-aim the line through the cloud's centre (the bot -> the human line passes the landing point only roughly)
            seg_c = [q["x"], q["y"], q["z"] - 12, q["x"], q["y"], q["z"] + 12]
            samples, last_present = [], None
            t_from, t_to = q["t0"] + 2.0, q["t1"] - 1.0
            while True:
                t = s.js("() => window.__LC__.W.t")
                if t > q["t1"] + 1.5:
                    break
                if s.js("() => (window.__LC__.W.smokes || []).length > 0"):
                    last_present = round(t, 2)
                b = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", seg_c)
                bs = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", [ex, ey + 1.5, ez, iso["x"], iso["y"] + 1.2, iso["z"]])
                samples.append((round(t, 2), bool(b), bool(bs)))
                s.step_frames(15, 1 / 60)
            hits = s.js("([a, b]) => window.__P23K__.hits.filter((x) => x >= a && x <= b)", [t_from, t_to])
            # LINE OF SIGHT = the bot keeps firing at the man it is fighting while it sees him; through the cloud it must stop (1 s after the
            # bloom window opens for its last trigger pull to end). Hits alone cannot judge it: bots miss a new player on purpose (LC-96 grace)
            shots_in = s.js("([a, b]) => window.__P23K__.shotT.filter((x) => x >= a && x <= b)", [t_from + 1.0, t_to])
            after = s.js(SNAP_JS)
            span = q["t1"] - q["t0"]
            seen = None if last_present is None else round(last_present - q["t0"], 2)
            v.check("lifetime (t1 - t0 = K.SMOKE.lifeS +-0.5 s, >= 15 s, observed in W.smokes that long (+-0.6 s); gone after t1 + 1 s)",
                    abs(span - life) <= 0.5 and span >= 15 and seen is not None and abs(seen - span) <= 0.6 and not after,
                    {"spanS": round(span, 2), "observedS": seen, "K.SMOKE.lifeS": life, "afterT1": after}, "lifeS, >= 15 s, gone")
            mid = [x for x in samples if t_from <= x[0] <= t_to]
            late = [x for x in samples if x[0] > q["t1"] + 0.6]
            v.check("los (through the centre: open before the throw, blocked from t0 + 2 s to t1 - 1 s, open after t1)",
                    before is False and bool(mid) and all(x[1] for x in mid) and bool(late) and not any(x[1] for x in late),
                    {"before": before, "midBlocked": "%d/%d" % (sum(1 for x in mid if x[1]), len(mid)), "lateBlocked": sum(1 for x in late if x[1])}, "open / blocked / open")
            sight_blocked = "%d/%d" % (sum(1 for x in mid if x[2]), len(mid))
            v.check("bot-sight (open control: the bot fires >= 5 rounds at the human in 6 s; through the smoke: 0 rounds from t0 + 3 s and 0 hits from t0 + 2 s to t1 - 1 s)",
                    ctrl["shots"] >= 5 and not hits and not shots_in,
                    {"openHits": ctrl["hits"], "openShots": ctrl["shots"], "hitsInSmoke": hits, "shotsInSmoke": shots_in[:20], "botLineBlocked": sight_blocked}, ">= 5 open, 0 in smoke")
            # cost: 3 smokes in view vs none on a FROZEN scene (R4: the old ABAB x 8 of 60 live-stepped frames per arm read +2.0 / -1.0 / +1.9 ms on
            # the real build and +1.3 / +1.7 ms with NO cloud drawn: the world moved between arms and the frame-to-frame spread (~+-3 ms of a
            # ~20 ms frame) swamped a 0.3 ms bar). Now: the world held still (dt 1e-5: no sim tick, no fx time), the SAME three cloud entries in
            # and out of W.smokes frame by frame in ABBA order, each frame its own TIME_ELAPSED query; the reading = the MEDIAN OF THE PAIRED
            # DIFFERENCES (on - off of adjacent frames) over >= 480 pairs, with its 95 % confidence interval (order statistics). The clouds sit at
            # full size past their vent jets (t0 = now - 5 s), so the frame difference is what three standing clouds cost the GPU.
            L.pin_actor(s, None)
            s.js("() => { const W = window.__LC__.W, p = W.player; p.input.pitch = 0.05; }")
            s.js("() => { const W = window.__LC__.W; if (W.smokes) W.smokes.length = 0; }")
            s.step_frames(180, 1 / 60, render=True)            # 3 s of fx time: the thrown cloud's jets / fade are gone before the scene freezes
            s.js(COST_SETUP_JS, [iso["x"], iso["y"], iso["z"]])
            pairs, raw = [], []
            v.data["smokeCostRaw"] = raw                        # [batch, [[on ms, off ms] per pair]] (pair i of batch b is on-first when (i + b) is even)
            batches = {"ok": 0, "disjoint": 0, "missing": 0, "error": None}
            for bi in range(COST_BATCHES):
                r = s.js(COST_BATCH_JS, [COST_PAIRS_PER_BATCH, bi])
                if not isinstance(r, dict) or r.get("error"):
                    batches["error"] = r.get("error") if isinstance(r, dict) else str(r)
                    break
                batches["missing"] += r.get("missing") or 0
                if r.get("disjoint"):
                    batches["disjoint"] += 1
                    continue
                batches["ok"] += 1
                if bi >= 1:                                     # the first batch warms the path (cache binds, first uploads): not counted
                    pairs.extend(r["pairs"])
                    raw.append([bi, [[round(a_, 4), round(b_, 4)] for a_, b_ in r["pairs"]]])
            s.js("() => { const W = window.__LC__.W, g = W.kernel.gpuTimer; if (W.smokes) W.smokes.length = 0; window.__P23COST__ = null;"
                 " if (g && window.__P23GT__ != null) g.on = window.__P23GT__; }")
            others = v.data.get("otherAutomatedChromes")
            name = "cost (3 smokes in view minus none, frozen scene, ABBA paired frames: median GPU difference <= +0.3 ms)"
            if len(pairs) < COST_MIN_PAIRS:
                v.cnj(name, "too few timed frame pairs (%d < %d; batches %s): no GPU timer (EXT_disjoint_timer_query_webgl2) or disjoint results" % (len(pairs), COST_MIN_PAIRS, batches))
            else:
                diffs = sorted(on - off for on, off in pairs)
                n = len(diffs)
                d = statistics.median(diffs)
                lo_i, hi_i = median_ci(n)
                ci = (diffs[lo_i], diffs[hi_i])
                det = {"medianDiffMs": round(d, 3), "ci95Ms": [round(ci[0], 3), round(ci[1], 3)], "pairs": n, "batches": batches,
                       "onMedianMs": round(statistics.median(p_[0] for p_ in pairs), 3), "offMedianMs": round(statistics.median(p_[1] for p_ in pairs), 3),
                       "diffP25P75Ms": [round(quantile(diffs, 0.25), 3), round(quantile(diffs, 0.75), 3)], "otherAutomatedChromes": others}
                # STABLE = the reading resolves the bar: the 95 % interval of the median is no wider than the bar itself (0.3 ms); wider = the
                # timer cannot tell 0 from 0.3 ms on this box now (could-not-judge, never a pass)
                det["stable"] = stable = (ci[1] - ci[0]) <= COST_BAR
                v.data["smokeCost"] = det
                print("  smoke cost reading: median paired diff %+.3f ms (95%% CI %+.3f .. %+.3f, %d pairs), on %.3f / off %.3f ms, other automated Chromes %s" % (
                    d, ci[0], ci[1], n, det["onMedianMs"], det["offMedianMs"], others), flush=True)
                if isinstance(others, int) and others > 2:
                    v.info(name + " would %s - %s other automated Chromes: not judged" % ("PASS" if d <= COST_BAR else "FAIL", others), det)
                elif not stable:
                    v.cnj(name, "the GPU timer does not resolve the bar now (95%% CI %.3f .. %.3f ms wider than %.1f ms): %s" % (ci[0], ci[1], COST_BAR, det))
                else:
                    v.check(name, d <= COST_BAR, det, "<= %.1f ms" % COST_BAR)
            # hides: the cloud hides a body 7 m behind its centre on screen, at the tier in use and at LOW (fx: every tier hides)
            hide = {}
            tier0 = s.js("() => window.__LC__.W.gfxTier")
            s.js("() => { const W = window.__LC__.W, p = W.player; p.input.yaw = 0; p.input.pitch = 0.05; }")
            for tier in [tier0, "low"] if tier0 != "low" else ["low"]:
                try:
                    s.js("(t) => window.__LC__.W.setGfx('tier', t)", tier)
                except Exception as ex_:
                    hide[tier] = {"error": str(ex_).splitlines()[0][:120]}
                    continue
                s.js("() => { const W = window.__LC__.W; if (W.smokes) W.smokes.length = 0; }")
                s.step_frames(180, 1 / 60, render=True)       # 3 s of fx time: every earlier cloud has faded out
                hide[tier] = s.js(HIDE_JS, [e, iso["x"], iso["y"] + K_YOFF(s), iso["z"] - 14, iso["x"], iso["z"] - 21, True])
                save_shot(hide[tier], os.path.join(shots, "smoke_hides_%s.png" % tier))
            try:
                s.js("(t) => window.__LC__.W.setGfx('tier', t)", tier0)
            except Exception:
                pass
            vis = {t: (r or {}).get("visibility") for t, r in hide.items()}
            opened = all((r or {}).get("openDiff", 0) >= 6 for r in hide.values())
            if not opened:
                v.cnj("hides (a body 7 m behind the cloud's centre: visibility <= 0.15 of the open view, the tier in use and LOW)", "the open view of the bot changed < 6/255 (not on screen?): %s" % hide)
            else:
                v.check("hides (a body 7 m behind the cloud's centre: visibility <= 0.15 of the open view, the tier in use and LOW)",
                        all(x is not None and x <= 0.15 for x in vis.values()), hide, "<= 0.15 each")
            # smoke_hides*.png = the SMOKED render the hides row judged (A: the cloud at full size, the bot 7 m behind it), grabbed inside the
            # row's own page task (fix round: the old screenshot came after the row, once the clouds were gone, and showed no smoke)
            first = next((r for r in hide.values() if isinstance(r, dict) and r.get("shotPath")), None)
            if first:
                import shutil
                shutil.copyfile(first["shotPath"], os.path.join(shots, "smoke_hides.png"))
            L.errors_row(v, s)
    return C.run_gate("p23_smoke", body, args)


COST_BAR = 0.3                 # ms of GPU for 3 standing clouds (the plan bar, unchanged)
COST_BATCHES = 41              # the first warms, 40 counted (640 pairs: 95 % CI of the median ~ +-0.08 ms on this iGPU)
COST_PAIRS_PER_BATCH = 16      # ABBA: 32 timed frames per page task
COST_MIN_PAIRS = 480


def median_ci(n):
    """the 95 % confidence interval of the median of n sorted samples (order statistics, the binomial's normal approximation): (lo, hi) indices"""
    import math
    h = 1.96 * math.sqrt(n) / 2
    return max(0, int(math.floor(n / 2 - h))), min(n - 1, int(math.ceil(n / 2 + h)))


def quantile(xs, q):
    xs = sorted(x for x in (xs or []) if isinstance(x, (int, float)))
    if not xs:
        return None
    i = q * (len(xs) - 1)
    lo_, hi_ = int(i), min(len(xs) - 1, int(i) + 1)
    return xs[lo_] + (xs[hi_] - xs[lo_]) * (i - lo_)


def save_shot(r, path):
    """write the data URL HIDE_JS grabbed (the smoked frame) to `path`; the row keeps the path, not the bytes"""
    import base64
    if not isinstance(r, dict):
        return
    u = r.pop("shot", None)
    if isinstance(u, str) and u.startswith("data:image/png;base64,"):
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(u.split(",", 1)[1]))
        r["shotPath"] = path


def K_YOFF(s):
    """the cloud's centre height above the ground (K.SMOKE.yOff, 1.2 m when the lane has no such key)"""
    y = s.safe_js("() => (window.__LC__.W.SIM.SMOKE || {}).yOff", default=None)
    return y if isinstance(y, (int, float)) else 1.2


if __name__ == "__main__":
    sys.exit(main())
