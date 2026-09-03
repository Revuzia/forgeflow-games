#!/usr/bin/env python
"""CRESTBOUND core-loop check — proves the game is actually playable, end to end.

This is the ship criterion, automated. In ONE real browser session it walks the
whole loop the player walks (CONTRACT "The gates" -> core loop):

  THE KEEP        boots into the hub, the hub is populated, the spawn is solid
  per course      __dev.goto(id) arrives at that id, and the course carries the
                  content the contract promises (>= 3 checkpoints, 7 crests,
                  8 sigils, >= 100 coins, colliders, hazards)
  checkpoints     teleport onto every checkpoint -> game.cpIndex advances to it
  death           player.kill('void') at each checkpoint -> the rewind plays, the
                  hero is alive again AT that checkpoint, the death is counted,
                  and game.lastRespawnMs (kill -> controls restored) has a MEDIAN
                  <= 700 ms over at least 3 samples (CONTRACT §28)
  collection      a coin, a sigil and a crest collect on contact, the counters
                  move, and the SAVE (localStorage `crestbound.save.v1`) is
                  updated for the crest
  celebration     the crest celebration runs and resolves to the clear card
  determinism     snapshot every hazard's world matrix at course clock t; reset;
                  advance to t again; the matrices must be BIT-IDENTICAL
                  (CONTRACT §21 determinism law — the reason a gauntlet is
                  learnable instead of luck)
  return          game.returnToKeep() lands in state 'keep'
  gates           crests written to the save unlock the Keep gate that requires
                  them (Save.crestTotal / Save.unlockedGates / the live gate)

    python loopcheck.py                          # the Keep + every course on disk
    python loopcheck.py --courses verdant-1
    python loopcheck.py --headless               # swiftshader, no display
    python loopcheck.py --skip-keep --budget 700

The player's real save is snapshotted before the run and written back after it,
so running the gate never costs anyone their crests.

Exit 0 = every assertion passed.
"""
import argparse
import json
import os
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

RESPAWN_BUDGET_MS = 700          # CONTRACT §28 median
RESPAWN_CEILING_MS = 950         # CONTRACT §28 hard ceiling for a single sample
SAVE_KEY = "crestbound.save.v1"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

# ── the whole per-course routine, run inside the page ────────────────────────
LOOP_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND;
  const R = {course: opts.course, checks: [], respawnMs: [], notes: {}};
  const ok = (name, pass, detail) =>
    R.checks.push({name, pass: !!pass, detail: detail === undefined ? null : detail});
  if (!A || !A.game) { ok('bootstrap', false, 'no CRESTBOUND.game'); return R; }

  const G = A.game, THREE = A.THREE, Save = A.Save;
  if (!THREE) { ok('bootstrap', false, 'CRESTBOUND.THREE missing'); return R; }
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await frame(); };
  const until = async (fn, ms) => {
    const t = performance.now();
    while (performance.now() - t < ms) { let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return performance.now() - t; await frame(); }
    return null;
  };
  const posOf = (o) => {
    if (!o) return null;
    if (typeof o.x === 'number') return o;
    if (o.pos) return posOf(o.pos);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.position) return posOf(o.position);
    if (Array.isArray(o)) return {x:o[0], y:o[1], z:o[2]};
    return null;
  };
  const near = (a, b, r) => !!(a && b) && Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) <= r;
  // The player object is REPLACED across a course load; a captured reference
  // then drives a corpse the game no longer updates.
  let P = G.player;
  if (!P) { ok('player exists', false, 'game.player is null'); return R; }
  if (!P.__test) { ok('player.__test exists (contract §11)', false, 'no harness surface'); return R; }
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const tp = (p, dy) => { syncP();
    P.__test.teleport(V3(p.x, p.y + (dy === undefined ? 0.6 : dy), p.z));
    P.__test.setVel(V3(0, 0, 0)); };

  /* ---- 1. the course loaded and IS the requested one --------------------- */
  const C = G.course;
  if (!C) { ok('course loaded', false, 'game.course is null'); return R; }
  const liveId = (C.def && C.def.id) || G.courseId;
  ok('the loaded course IS the requested one', liveId === opts.course, liveId);
  ok('state is live', G.state === 'playing' || G.state === 'keep', G.state);

  const cps = C.checkpoints || [];
  const bp = C.broadphase;
  const colliderCount = bp ? (bp.count | 0) : 0;
  const col = C.collectibles;
  const counts = (col && col.counts) || null;
  const crestDefs = (C.def && C.def.crests) || [];

  ok('course has colliders', colliderCount > 0, colliderCount);
  ok('course has bounds', !!(C.bounds && C.bounds.min && C.bounds.max));
  if (opts.isKeep) {
    ok('the Keep has gates', ((C.gates || []).length) >= 8, (C.gates || []).length);
  } else {
    ok('>= 3 checkpoints', cps.length >= 3, cps.length);
    ok('7 crests', crestDefs.length === 7, crestDefs.length);
    ok('8 sigils', !!counts && counts.sigilsTotal === 8, counts && counts.sigilsTotal);
    ok('>= 100 coins', !!counts && counts.coinsTotal >= 100, counts && counts.coinsTotal);
    ok('course has hazards', (C.hazards || []).length > 0, (C.hazards || []).length);
  }

  /* ---- 2. the spawn is solid and not lethal ------------------------------ */
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) {
    tp(sp.pos, 0.5);
    const gr = await until(() => syncP().grounded, 3000);
    ok('spawn is grounded', gr !== null, gr === null ? 'never grounded within 3 s' : Math.round(gr) + ' ms');
    ok('spawn is not instantly lethal', !P.dead);
  } else {
    ok('course.spawnFor(0) returns a spawn', false, 'null');
  }

  /* ---- 3. every checkpoint fires, and a death returns you to it ---------- */
  // checkpoints[0] is the spawn; the real checkpoints are 1..n-1.
  const deaths = [];
  for (let i = 1; i < cps.length; i++) {
    const cp = posOf(cps[i]);
    if (!cp) { ok(`cp${i} has a position`, false); continue; }
    tp(cp, 0.6);
    const fired = await until(() => (G.cpIndex | 0) >= i, 3000);
    ok(`cp${i} activates on contact`, fired !== null,
       fired === null ? `game.cpIndex stuck at ${G.cpIndex}` : Math.round(fired) + ' ms');

    const deaths0 = G.deaths | 0;
    const t0 = performance.now();
    syncP().kill('void');
    const back = await until(() => { syncP();
      return !P.dead && !(G.input && G.input.suspended) && (G.state === 'playing' || G.state === 'keep');
    }, 5000);
    const wall = back === null ? null : Math.round(performance.now() - t0);
    const stamped = Number.isFinite(G.lastRespawnMs) && G.lastRespawnMs >= 0 ? Math.round(G.lastRespawnMs) : null;
    const ms = stamped !== null ? stamped : wall;
    deaths.push(ms);
    ok(`cp${i} respawn completes (<= ${opts.ceiling} ms ceiling)`,
       ms !== null && ms <= opts.ceiling, `${ms} ms (wall ${wall})`);
    ok(`cp${i} death counted`, (G.deaths | 0) === deaths0 + 1, `${deaths0} -> ${G.deaths}`);
    const rp = syncP().pos;
    ok(`cp${i} respawns AT the checkpoint`, near(rp, cp, 4.0),
       `player ${rp.x.toFixed(1)},${rp.y.toFixed(1)},${rp.z.toFixed(1)} vs cp ${cp.x.toFixed(1)},${cp.y.toFixed(1)},${cp.z.toFixed(1)}`);
    await wait(200);
  }

  // At least three samples for the median, whatever the checkpoint count.
  while (deaths.length < 3 && cps.length) {
    const t0 = performance.now();
    syncP().kill('void');
    const back = await until(() => { syncP();
      return !P.dead && !(G.input && G.input.suspended) && (G.state === 'playing' || G.state === 'keep'); }, 5000);
    const stamped = Number.isFinite(G.lastRespawnMs) && G.lastRespawnMs >= 0 ? Math.round(G.lastRespawnMs) : null;
    deaths.push(stamped !== null ? stamped : (back === null ? null : Math.round(performance.now() - t0)));
    await wait(200);
  }
  R.respawnMs = deaths;
  {
    const good = deaths.filter(v => v !== null).sort((a, b) => a - b);
    const med = good.length ? good[(good.length - 1) >> 1] : null;
    R.notes.respawnMedian = med;
    ok(`median respawn <= ${opts.budget} ms`, med !== null && med <= opts.budget, med);
  }

  /* ---- 4. collection: coin, sigil, crest — counters AND save ------------- */
  if (!opts.isKeep && col) {
    // Positions come off the Collectibles instance's home arrays (the harness
    // is allowed to reach in; there is no public accessor and the def's ring /
    // line groups are expanded inside the instance).
    const coinAt = (i) => (col._cHome && col._cHome.length > i * 3 + 2)
      ? {x: col._cHome[i*3], y: col._cHome[i*3+1], z: col._cHome[i*3+2]} : null;
    const sigilAt = (i) => (col._sHome && col._sHome.length > i * 3 + 2)
      ? {x: col._sHome[i*3], y: col._sHome[i*3+1], z: col._sHome[i*3+2]} : null;

    let coinIdx = -1;
    for (let i = 0; i < (col.coinCount | 0); i++) if (!col._cState || col._cState[i] === 1) { coinIdx = i; break; }
    const cp0 = coinIdx >= 0 ? coinAt(coinIdx) : null;
    if (cp0) {
      const before = col.counts.coins | 0;
      tp(cp0, -0.3);
      const got = await until(() => (col.counts.coins | 0) > before, 3000);
      ok('a coin collects on contact', got !== null,
         got === null ? `coins stuck at ${col.counts.coins}` : Math.round(got) + ' ms');
    } else ok('the course has an uncollected coin to test', false, col.coinCount);

    let sigIdx = -1;
    for (let i = 0; i < (col.sigilCount | 0); i++) if (!col._sState || col._sState[i] === 1) { sigIdx = i; break; }
    const sp0 = sigIdx >= 0 ? sigilAt(sigIdx) : null;
    if (sp0) {
      const before = col.counts.sigils | 0;
      tp(sp0, -0.3);
      const got = await until(() => (col.counts.sigils | 0) > before, 3000);
      ok('a sigil collects on contact', got !== null,
         got === null ? `sigils stuck at ${col.counts.sigils}` : Math.round(got) + ' ms');
    } else ok('the course has an uncollected sigil to test', false, col.sigilCount);

    // A crest: the celebration + the clear card + the SAVE.
    let crest = null;
    for (const c of col.crests || []) if (c && c.present && !c.taken) { crest = c; break; }
    if (crest) {
      const cid = crest.id || (crest.def && crest.def.id);
      const before = col.counts.crests | 0;
      tp(posOf(crest.home) || posOf(crest), -0.2);
      const got = await until(() => (col.counts.crests | 0) > before, 4000);
      ok('a crest collects on contact', got !== null,
         got === null ? `crests stuck at ${col.counts.crests}` : Math.round(got) + ' ms');
      const celebrated = await until(() => G.state === 'clear' || G.state === 'card', 6000);
      ok('the crest celebration reaches the clear card', celebrated !== null,
         celebrated === null ? `state stuck at ${G.state}` : `${G.state} after ${Math.round(celebrated)} ms`);
      const rec = Save && Save.course ? Save.course(opts.course) : null;
      const saved = !!(rec && rec.crests && rec.crests.indexOf(cid) >= 0);
      ok('the crest is written to the save record', saved, rec ? JSON.stringify(rec).slice(0, 160) : 'no record');
      let raw = null;
      try { raw = window.localStorage.getItem(opts.saveKey); } catch (e) { raw = null; }
      ok('the save reached localStorage', !!(raw && raw.indexOf(opts.course) >= 0),
         raw ? raw.length + ' bytes' : 'nothing stored');
      ok('the course is marked cleared', !!(rec && rec.cleared), rec && rec.cleared);
      // leave the card: STAY, so the rest of the routine still has a course
      if (G.__dev && G.__dev.stay) G.__dev.stay();
      await until(() => G.state === 'playing' || G.state === 'keep', 6000);
      ok('the clear card resolves back to play', G.state === 'playing' || G.state === 'keep', G.state);
    } else ok('the course has a placed crest to test', false, (col.crests || []).length);
  }

  /* ---- 5. DETERMINISM: same clock -> bit-identical hazard transforms ----- */
  const hz = (C.hazards || []).slice(0, 60);
  const snap = () => hz.map(h => {
    const m = h && h.mesh;
    if (!m) return null;
    m.updateMatrixWorld(true);
    const e = m.matrixWorld.elements;
    return Array.prototype.slice.call(e, 0, 16);
  });
  const advanceTo = (t) => {
    C.reset();
    C.clock = 0;
    const h = 1 / 120;
    let c = 0;
    while (c < t - 1e-9) { const step = Math.min(h, t - c); c += step; C.update(step, P); }
    return snap();
  };
  if (hz.length) {
    let a1 = null, a2 = null, err = null;
    try { a1 = advanceTo(5.0); a2 = advanceTo(5.0); } catch (e) { err = String(e); }
    if (err) ok('hazards are deterministic at the same clock', false, err);
    else {
      let diff = 0, worst = 0, which = -1;
      for (let i = 0; i < a1.length; i++) {
        if (!a1[i] || !a2[i]) continue;
        for (let k = 0; k < 16; k++) {
          const d = Math.abs(a1[i][k] - a2[i][k]);
          if (d > 0) { diff++; if (d > worst) { worst = d; which = i; } }
        }
      }
      ok('hazards are deterministic at the same clock', diff === 0,
         diff === 0 ? `${hz.length} hazards bit-identical at t=5.0 s`
                    : `${diff} matrix components drifted, worst ${worst.toExponential(2)} on hazard ${which} (${hz[which] && hz[which].kind})`);
    }
    // resetFrom must place the world exactly where update() would at that clock
    try {
      const cpi = Math.max(0, cps.length - 1);
      C.resetFrom(cpi);
      const after = C.clock;
      ok('resetFrom(cp) rewinds the course clock', Number.isFinite(after), `clock -> ${after}`);
    } catch (e) { ok('resetFrom(cp) rewinds the course clock', false, String(e)); }
  } else if (!opts.isKeep) {
    ok('the course has hazards to test for determinism', false, 0);
  }

  /* ---- 6. back to the Keep ---------------------------------------------- */
  if (!opts.isKeep) {
    try {
      await G.returnToKeep();
    } catch (e) { ok('returnToKeep() resolves', false, String(e)); }
    const home = await until(() => G.state === 'keep' && G.courseId === 'keep', 20000);
    ok('returnToKeep lands in THE KEEP', home !== null,
       home === null ? `state ${G.state} / course ${G.courseId}` : Math.round(home) + ' ms');
  }

  return R;
}
"""

# ── the Keep gate-unlock routine ─────────────────────────────────────────────
GATE_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND;
  const R = {checks: [], notes: {}};
  const ok = (name, pass, detail) =>
    R.checks.push({name, pass: !!pass, detail: detail === undefined ? null : detail});
  if (!A || !A.game || !A.Save) { ok('gate bootstrap', false, 'no CRESTBOUND.game / Save'); return R; }
  const G = A.game, Save = A.Save;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const until = async (fn, ms) => { const t = performance.now();
    while (performance.now() - t < ms) { let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return true; await frame(); } return false; };

  const meta = await import(new URL('runtime/data/index.js', location.href).href)
    .then(m => m).catch(() => null);
  if (!meta) { ok('data/index.js imports in the page', false); return R; }

  // Pick the cheapest gate that is NOT already open: the lowest positive
  // gateCrests in the registry.
  let target = null;
  for (const id of meta.ALL_COURSE_IDS) {
    const need = meta.COURSE_META[id].gateCrests | 0;
    if (need > 0 && (!target || need < target.need)) target = {id, need};
  }
  if (!target) { ok('a locked gate exists in the registry', false); return R; }
  R.notes.gate = target;

  const before = Save.crestTotal() | 0;
  ok('crest total reads as a number', Number.isFinite(before), before);

  // Exercise the dev hook once (contract §28 __dev.give), then top the save up
  // to the gate's requirement course by course — the gate reads the TOTAL.
  let gave = null;
  try { gave = G.__dev && G.__dev.give ? G.__dev.give('open') : null; } catch (e) { gave = 'threw: ' + e; }
  R.notes.devGive = gave;

  const crestIds = ['open', 'sigils', 'coins', 'secret', 'boss', 'race', 'power'];
  outer:
  for (const cid of meta.ALL_COURSE_IDS) {
    for (const k of crestIds) {
      if ((Save.crestTotal() | 0) >= target.need) break outer;
      Save.collectCrest(cid, k);
    }
  }
  const after = Save.crestTotal() | 0;
  ok(`the save reaches the gate requirement (${target.need})`, after >= target.need, `${before} -> ${after}`);

  // The contract's own query: Save.unlockedGates(keepDef)
  const keepDef = await meta.getCourse('keep').catch(() => null);
  if (keepDef) {
    let unlocked = null;
    try { unlocked = Save.unlockedGates(keepDef); } catch (e) { unlocked = 'threw: ' + e; }
    const gates = keepDef.gates || [];
    let idx = -1;
    for (let i = 0; i < gates.length; i++) if (gates[i] && gates[i].course === target.id) { idx = i; break; }
    R.notes.gateIndex = idx;
    ok('Save.unlockedGates(keepDef) returns a list', Array.isArray(unlocked),
       Array.isArray(unlocked) ? unlocked.join(',') : String(unlocked));
    if (Array.isArray(unlocked) && idx >= 0) {
      ok(`gate ${idx} (${target.id}) reports UNLOCKED at ${after} crests`,
         unlocked.indexOf(idx) >= 0, unlocked.join(','));
    } else if (idx < 0) {
      ok(`the Keep authors a gate for ${target.id}`, false, `${gates.length} gates`);
    }
  } else {
    ok('the Keep def loads', false, 'getCourse("keep") failed');
  }

  // And the LIVE Keep agrees (the sign on the door is what the player reads).
  // The crests above were written STRAIGHT into Save, behind the game's back, so
  // give the Keep the same chance a returning player gives it: walk back in. The
  // Keep resolves lock state per load and after each unlock sequence
  // (game._resolveGates -> _refreshGateState), deliberately never per frame.
  if (G.__dev && typeof G.__dev.goto === 'function') {
    let reentered = false;
    try { await G.__dev.goto('keep'); reentered = true; }
    catch (e) { ok('re-enter THE KEEP after the save changes', false, String(e)); }
    if (reentered) {
      const home = await until(() => G.state === 'keep' && G.courseId === 'keep', 30000);
      ok('re-enter THE KEEP after the save changes', home, home ? 'ok' : `state ${G.state} / course ${G.courseId}`);
    }
  }
  if (G.courseId === 'keep' && G.__dev && G.__dev.gates) {
    let live = null;
    try {
      live = G.__dev.gates().map(g => {
        // `requires:{crests:N}` is the AUTHORED keep-data shape (contract §26);
        // the RESOLVED live gate carries a plain number plus `locked`.
        const req = (g.requires && typeof g.requires === 'object') ? g.requires.crests : g.requires;
        return {course: g.course, unlocked: g.locked === false, requires: req};
      });
    }
    catch (e) { live = 'threw: ' + e; }
    R.notes.liveGates = live;
    if (Array.isArray(live)) {
      const g = live.find(x => x.course === target.id);
      ok(`the live Keep gate for ${target.id} reports unlocked`, !!(g && g.unlocked),
         g ? JSON.stringify(g) : 'no live gate for that course');
    }
  }
  return R;
}
"""


def launch_headless(p):
    """Headless, but on the REAL GPU.

    This gate measures a real-time budget (CONTRACT §28: median <= 700 ms from
    kill to controls restored). Under the bundled Chromium + SwiftShader the
    page presents ~0.3 frames/second, so a 620 ms timeline that needs ~13 frames
    takes ~30 s of wall clock and every timing row reports the rasterizer
    instead of the game. Real Chrome headless drives ANGLE/D3D11 on this box at
    ~28 fps, which measures the timeline. SwiftShader stays as the fallback for
    a machine with no usable GPU -- and says so, because the timings it produces
    are not the game's.
    """
    try:
        return p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    except Exception as e:
        print("headless: no hardware Chrome (%s) -> SwiftShader; real-time rows "
              "will measure the software rasterizer" % str(e)[:120], file=sys.stderr)
        return p.chromium.launch(headless=True, args=HEADLESS_FLAGS)


def wait_ready(pg, timeout=75, need_course=False):
    expr = ("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"
            if need_course else "!!(globalThis.CRESTBOUND && CRESTBOUND.game)")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate(expr):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def leave_title(pg, timeout=45, boot_timeout=240):
    """Only 'keep'/'playing' counts: boot passes through 'loading' BEFORE the
    title exists, so 'not title' would be a false positive on a raced click.

    The `timeout` budget is for LEAVING the title, so it may not start until the
    title exists: `CRESTBOUND.game` appears tens of seconds before the Keep has
    finished building, and on a loaded box that swallowed the whole window and
    the gate reported 'never left the title screen' for a game that had not yet
    reached it. Waiting for the title first is a measurement fix, not a longer
    budget for the thing being measured."""
    boot_deadline = time.time() + boot_timeout
    while time.time() < boot_deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("title", "keep", "playing"):
            break
        pg.wait_for_timeout(400)

    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = pg.evaluate(STATE_JS)
        except Exception:
            last = None
        if last in ("keep", "playing"):
            return True
        if last == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def goto_course(pg, cid, timeout=90):
    """Drive __dev.goto and VERIFY the id arrived. `?course=` is only a boot hint
    and PLAY lands in the Keep — without this check every course row would be a
    measurement of the hub."""
    try:
        pg.evaluate(
            "async (id) => { const d = CRESTBOUND.game.__dev;"
            " if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }", cid)
    except Exception as e:
        return False, "goto threw: %s" % str(e)[:200]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("(id)=>!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId===id"
                           " && (CRESTBOUND.game.state==='playing' || CRESTBOUND.game.state==='keep'))", cid):
                return True, "ok"
        except Exception:
            pass
        # a course intro cinematic or a card can sit in front; nudge it along
        try:
            st = pg.evaluate(STATE_JS)
            if st in ("card", "cinematic", "title", "paused"):
                pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    try:
        return False, "never arrived (state %s, course %s)" % (
            pg.evaluate(STATE_JS), pg.evaluate("CRESTBOUND.game.courseId"))
    except Exception:
        return False, "never arrived"


def course_ids_on_disk(pg):
    """Registry order from the page's own data/index.js, filtered to the files
    that actually exist — a registered course with no file is reachcheck's
    finding, not this gate's."""
    ids = []
    try:
        ids = pg.evaluate(
            "async () => { const m = await import(new URL('runtime/data/index.js', location.href).href);"
            " return m.ALL_COURSE_IDS || []; }") or []
    except Exception:
        ids = []
    if not ids:
        d = os.path.join(ROOT, "runtime", "data", "courses")
        ids = sorted(f[:-3] for f in os.listdir(d)) if os.path.isdir(d) else []
    out = []
    for cid in ids:
        if os.path.isfile(os.path.join(ROOT, "runtime", "data", "courses", cid + ".js")):
            out.append(cid)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND core-loop check")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--courses", default="", help="comma list; default = every course on disk")
    ap.add_argument("--skip-keep", action="store_true")
    ap.add_argument("--budget", type=int, default=RESPAWN_BUDGET_MS)
    ap.add_argument("--ceiling", type=int, default=RESPAWN_CEILING_MS)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "loopcheck.json"))
    ap.add_argument("--keep-save", action="store_true",
                    help="do NOT restore the player's save afterwards")
    args = ap.parse_args()

    all_res, pageerrs = {}, []
    saved_blob = None

    with sync_playwright() as p:
        if args.headless:
            br = launch_headless(p)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));")

        try:
            pg.goto(args.url + "?dev=1", wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        if not wait_ready(pg):
            print("LOOP CHECK: globalThis.CRESTBOUND never appeared", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        # snapshot the player's save so the gate never costs anyone their crests
        try:
            saved_blob = pg.evaluate("(k)=>window.localStorage.getItem(k)", SAVE_KEY)
        except Exception:
            saved_blob = None

        if not leave_title(pg):
            print("LOOP CHECK: never left the title screen (state=%s)"
                  % pg.evaluate(STATE_JS), file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        courses = ([c.strip() for c in args.courses.split(",") if c.strip()]
                   if args.courses else course_ids_on_disk(pg))
        targets = ([] if args.skip_keep else ["keep"]) + courses

        for cid in targets:
            arrived, why = goto_course(pg, cid)
            if not arrived:
                all_res[cid] = {"checks": [{"name": "__dev.goto(%s)" % cid, "pass": False, "detail": why}]}
                continue
            pg.wait_for_timeout(1200)
            try:
                all_res[cid] = pg.evaluate(LOOP_JS, {
                    "course": cid, "isKeep": cid == "keep",
                    "budget": args.budget, "ceiling": args.ceiling, "saveKey": SAVE_KEY})
            except Exception as e:
                all_res[cid] = {"checks": [{"name": "loop routine", "pass": False,
                                            "detail": str(e)[:600]}]}

        # gate unlock last: it deliberately writes crests into the save
        if not args.skip_keep:
            ok, _ = goto_course(pg, "keep")
            if ok:
                pg.wait_for_timeout(800)
                try:
                    all_res["gates"] = pg.evaluate(GATE_JS, {})
                except Exception as e:
                    all_res["gates"] = {"checks": [{"name": "gate routine", "pass": False,
                                                    "detail": str(e)[:600]}]}

        if not args.keep_save:
            try:
                if saved_blob is None:
                    pg.evaluate("(k)=>window.localStorage.removeItem(k)", SAVE_KEY)
                else:
                    pg.evaluate("([k,v])=>window.localStorage.setItem(k,v)", [SAVE_KEY, saved_blob])
            except Exception:
                pass

        try:
            jserr = pg.evaluate("window.__err || []")
        except Exception:
            jserr = []
        br.close()

    total = failed = 0
    print("=" * 82)
    for cid, res in all_res.items():
        checks = res.get("checks", []) if isinstance(res, dict) else []
        bad = [c for c in checks if not c.get("pass")]
        total += len(checks)
        failed += len(bad)
        print("\n%s  —  %d/%d passed" % (cid, len(checks) - len(bad), len(checks)))
        for c in checks:
            mark = "ok  " if c.get("pass") else "FAIL"
            det = "" if c.get("detail") is None else "   [%s]" % c["detail"]
            print("   %s %s%s" % (mark, c.get("name"), det))
        if res.get("respawnMs"):
            good = [v for v in res["respawnMs"] if v is not None]
            med = statistics.median(good) if good else None
            print("        respawn samples: %s ms   median %s   budget %d"
                  % (res["respawnMs"], med, args.budget))
        if res.get("notes"):
            print("        notes: %s" % json.dumps(res["notes"])[:400])

    print("\n" + "=" * 82)
    if pageerrs or jserr:
        print("page errors (%d) / window errors (%d):" % (len(pageerrs), len(jserr)))
        for e in pageerrs[:10]:
            print("  !! %s" % str(e)[:300])
        for e in jserr[:10]:
            print("  !!! %s" % str(e)[:300])
    verdict = "LOOP OK" if (failed == 0 and total > 0) else "LOOP BROKEN"
    print("VERDICT: %s — %d/%d checks passed" % (verdict, total - failed, total))
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"results": all_res, "pageErrors": pageerrs, "windowErrors": jserr},
                          f, indent=2)
        except Exception:
            pass
    good = failed == 0 and total > 0
    print("RESULT: %s" % ("OK" if good else "FAIL"))
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
