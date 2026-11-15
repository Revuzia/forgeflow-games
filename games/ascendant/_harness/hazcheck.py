#!/usr/bin/env python
"""ASCENDANT hazard-correctness + stage-reset check.

loopcheck proves the loop runs and that hazards are DETERMINISTIC across a reset.
This gate proves the things determinism does not: that a kill volume is lethal
EXACTLY when its telegraph says it is, that state hazards (crumble / sink /
elevator / chase) actually arm, break, restore and rewind, that no respawn point
is standing inside a live kill volume at the moment you arrive, that a disposed
stage is really gone, and that the two def contracts (Stage.validate and
hazards/index.js validateHazardDef) agree about what a stage may author.

    python hazcheck.py                          # every section, every stage
    python hazcheck.py --only bench,contract     # pick sections
    python hazcheck.py --stages spire-2,neon-2   # limit the live sections

Sections
    bench     synthetic hazards: telegraph vs lethality (laser / crusher /
              vanish / spikes), driven on a fixed clock
    crumble   crumble tiles: break on touch, gone after, re-arm on resetFrom,
              never break from a teleport-in
    stateful  sink movers restore, elevators return, chase rewinds to the
              checkpoint clock
    respawn   every stage x every checkpoint: resetFrom(i), stand 1.5 s, alive
    dispose   after a stage transition zero old hazards still update, and
              renderer.info does not grow across 3 transitions
    contract  Stage.validate vs makeHazard: same verdict on the same def

Exit 0 = every assertion passed.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

ALL_SECTIONS = ["bench", "crumble", "stateful", "respawn", "dispose", "contract"]

# ══════════════════════════════════════════════════════════════════════════════
#  shared page-side preamble — every section evaluates this string first
# ══════════════════════════════════════════════════════════════════════════════
PRELUDE = r"""
const A = globalThis.ASCENDANT;
const THREE = A.THREE;
const G = A.game;
const R = { checks: [], notes: [] };
const ok = (name, pass, detail) =>
  R.checks.push({ name, pass: !!pass, detail: detail === undefined ? null : String(detail) });
const frame = () => new Promise(r => requestAnimationFrame(r));
const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await frame(); };
const f3 = (v) => v == null ? 'null' : `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
"""

# ── section: bench ────────────────────────────────────────────────────────────
JS_BENCH = PRELUDE + r"""
const H = await import('./runtime/hazards/index.js');
const L = await import('./runtime/hazards/lasers.js');

// A realistic ctx: the live stage's material/theme registry, nothing that ties the
// synthetic hazard to the live world (no broadphase, no group) so it cannot disturb it.
const S = G.stage;
const ctx = {
  mats: S.mats, theme: S.theme, themeId: S.themeId, palette: S.palette,
  quality: S.quality, rng: null,
};

const STEP = 1 / 240;
/** Drive a hazard exactly the way Stage does: reset(t0), then fixed steps. */
function drive(hz, t0, t1, fn) {
  hz.reset(t0);
  hz.update(t0, 0);
  fn(t0);
  for (let t = t0 + STEP; t <= t1 + 1e-9; t += STEP) { hz.update(t, STEP); fn(t); }
}
const anyKill = (hz) => { for (const k of hz.kills) if (k.active) return true; return false; };
const anySolid = (hz) => { for (const c of hz.colliders) if (c.active !== false) return true; return false; };

/* ───────────────────────────── 1. LASER ─────────────────────────────────────
   "lethal only while fully on, never in warn" — asserted against the very
   cycleState the hazard reads, so there is no boundary epsilon to argue about. */
for (const spec of [
  { kind: 'laser', a: [0, 2, 0], b: [10, 2, 0], cycle: { on: 1.0, off: 1.4, warn: 0.6, phase: 0 } },
  { kind: 'lasergrid', a: [0, 2, -4], b: [0, 2, 4], count: 3, cycle: { on: 0.8, off: 1.6, warn: 0.5, phase: 0.3 } },
  { kind: 'lasersweep', p: [0, 4, 0], period: 3.0, cycle: { on: 1.1, off: 1.3, warn: 0.4, phase: 0 } },
]) {
  let hz = null;
  try { hz = H.makeHazard(spec, ctx); } catch (e) { ok(`${spec.kind} builds`, false, e.message); continue; }
  ok(`${spec.kind} builds`, true, `${hz.kills.length} kill volume(s)`);
  // A grid staggers per-beam phase on purpose (unit N is on while unit 0 is off),
  // so every beam is judged against ITS OWN cycle state, not the rack's.
  const cs = L.makeCycleState();
  const units = Array.isArray(hz.units) && hz.units.length ? hz.units : null;
  ok(`${spec.kind} exposes its beam units`, !!units, units ? `${units.length}` : 'none');
  let onLethal = 0, onTotal = 0, warnLethal = 0, warnTotal = 0, offLethal = 0, offTotal = 0;
  drive(hz, 0, (spec.cycle.on + spec.cycle.off) * 3, (t) => {
    if (!units) return;
    for (const u of units) {
      const st = L.cycleState(t, spec.cycle, cs, u.phaseExtra || 0).state;
      const lethal = !!(u.kill && u.kill.active);
      if (st === 'on') { onTotal++; if (lethal) onLethal++; }
      else if (st === 'warn') { warnTotal++; if (lethal) warnLethal++; }
      else { offTotal++; if (lethal) offLethal++; }
    }
  });
  ok(`${spec.kind} is lethal through the whole ON window`, onTotal > 0 && onLethal === onTotal,
     `${onLethal}/${onTotal} on-samples lethal`);
  ok(`${spec.kind} is NEVER lethal during WARN`, warnTotal > 0 && warnLethal === 0,
     `${warnLethal}/${warnTotal} warn-samples lethal`);
  ok(`${spec.kind} is NEVER lethal while OFF`, offTotal > 0 && offLethal === 0,
     `${offLethal}/${offTotal} off-samples lethal`);
  hz.dispose();
}

/* ───────────────────────────── 2. CRUSHER ───────────────────────────────────
   "kills only on the moving face while descending". Measured black-box: the
   head's own collider says which way it is going; the kill volume must sit in
   front of that face and must never be live while the head is not closing. */
{
  const def = { kind: 'crusher', p: [0, 8, 0], s: [3, 1.4, 3], travel: 5, period: 3.0, dwell: 0.5 };
  let hz = null;
  try { hz = H.makeHazard(def, ctx); } catch (e) { ok('crusher builds', false, e.message); hz = null; }
  if (hz) {
    ok('crusher builds', true, `${hz.colliders.length} collider(s), ${hz.kills.length} kill(s)`);
    const dir = new THREE.Vector3(0, -1, 0);           // authored default crush direction
    const head = hz.colliders[0], kv = hz.kills[0];
    let prevD = null, retreatLethal = 0, retreatN = 0, closeLethal = 0, closeN = 0;
    let behind = 0, pokesOut = 0, faceErr = 0, worstFace = 0;
    const sAlong = 1.4;                                 // extent along the crush axis
    drive(hz, 0, 9.0, () => {
      const d = head.center.dot(dir);                   // distance travelled along dir
      const lethal = kv.active;
      if (prevD !== null) {
        const v = (d - prevD) / STEP;
        if (v < -0.02) { retreatN++; if (lethal) retreatLethal++; }
        else if (v > 0.60) { closeN++; if (lethal) closeLethal++; }
      }
      prevD = d;
      // geometry of the lethal slab, in head-local terms along dir
      const along = kv.center.clone().sub(head.center).dot(dir);
      const front = along + kv.half.y, back = along - kv.half.y;
      if (along <= 0) behind++;
      if (back < -sAlong * 0.5 - 1e-3) pokesOut++;
      const want = sAlong * 0.5 + 0.06;
      const err = Math.abs(front - want);
      if (err > worstFace) worstFace = err;
      if (err > 0.02) faceErr++;
    });
    ok('crusher is NEVER lethal while retracting', retreatN > 0 && retreatLethal === 0,
       `${retreatLethal}/${retreatN} retreating samples lethal`);
    ok('crusher IS lethal while slamming', closeN > 0 && closeLethal === closeN,
       `${closeLethal}/${closeN} fast-closing samples lethal`);
    ok('crusher kill volume sits on the MOVING FACE', behind === 0, `${behind} samples behind the head centre`);
    ok('crusher kill volume never pokes out the safe back face', pokesOut === 0, `${pokesOut} samples`);
    ok('crusher lethal front plane == head front plane', faceErr === 0,
       `${faceErr} samples off, worst ${worstFace.toFixed(4)} m`);
    hz.dispose();
  }
}

/* ───────────────────────────── 3. VANISH (cycle) ────────────────────────────
   "vanish off is non-solid AND non-lethal", and the FAIRNESS RULE: solid iff it
   reads solid — the telegraph window is still standable. */
{
  const cyc = { on: 1.2, off: 1.4, warn: 0.5, phase: 0 };
  const def = { kind: 'vanish', p: [0, 3, 0], s: [4, 0.5, 4], mode: 'cycle', cycle: cyc };
  let hz = null;
  try { hz = H.makeHazard(def, ctx); } catch (e) { ok('vanish builds', false, e.message); hz = null; }
  if (hz) {
    ok('vanish builds', true, `${hz.colliders.length} collider(s)`);
    ok('vanish declares NO kill volume', hz.kills.length === 0, `${hz.kills.length}`);
    const period = cyc.on + cyc.warn + cyc.off;
    let onSolid = 0, onN = 0, warnSolid = 0, warnN = 0, offSolid = 0, offN = 0;
    // the fade windows at each end of `off` are deliberately still solid; measure
    // the MIDDLE of the off window, where the tile is unambiguously gone.
    drive(hz, 0, period * 3, (t) => {
      const s = ((t / period) % 1) * period;
      const solid = anySolid(hz);
      if (s < cyc.on - 0.02) { onN++; if (solid) onSolid++; }
      else if (s > cyc.on + 0.02 && s < cyc.on + cyc.warn - 0.02) { warnN++; if (solid) warnSolid++; }
      else if (s > cyc.on + cyc.warn + 0.30 && s < period - 0.34) { offN++; if (solid) offSolid++; }
    });
    ok('vanish is SOLID through the whole ON window', onN > 0 && onSolid === onN, `${onSolid}/${onN}`);
    ok('vanish is STILL SOLID through the telegraph', warnN > 0 && warnSolid === warnN, `${warnSolid}/${warnN}`);
    ok('vanish OFF is non-solid', offN > 0 && offSolid === 0, `${offSolid}/${offN} off-samples still solid`);
    hz.dispose();
  }
}

/* ───────────────────────────── 4. SPIKES (retract) ──────────────────────────
   "retracting spikes safe when down" — and the plate stays standable throughout. */
{
  const cyc = { on: 1.5, off: 1.9, warn: 0.7, phase: 0 };
  const def = { kind: 'spikes', p: [0, 1, 0], s: [4, 1.2, 4], mode: 'retract', cycle: cyc };
  let hz = null;
  try { hz = H.makeHazard(def, ctx); } catch (e) { ok('retract spikes build', false, e.message); hz = null; }
  if (hz) {
    ok('retract spikes build', true, `${hz.kills.length} kill(s)`);
    let downLethal = 0, downN = 0, upLethal = 0, upN = 0, plateOff = 0, earlyLethal = 0;
    drive(hz, 0, (cyc.on + cyc.off) * 3, () => {
      const ext = hz.extend, lethal = hz.kills[0].active;
      if (ext <= 1e-6) { downN++; if (lethal) downLethal++; }
      if (ext >= 0.999) { upN++; if (lethal) upLethal++; }
      if (lethal && ext <= 0.34) earlyLethal++;
      if (hz.colliders[0].active === false) plateOff++;
    });
    ok('retract spikes are SAFE when fully down', downN > 0 && downLethal === 0,
       `${downLethal}/${downN} down-samples lethal`);
    ok('retract spikes are lethal when fully up', upN > 0 && upLethal === upN, `${upLethal}/${upN}`);
    ok('retract spikes never arm below 34% extension', earlyLethal === 0, `${earlyLethal} samples`);
    ok('spike base plate stays standable', plateOff === 0, `${plateOff} samples with the plate off`);
    hz.dispose();
  }
}
{
  const def = { kind: 'spikes', p: [0, 1, 0], s: [4, 1.2, 4] };   // static bed
  let hz = null;
  try { hz = H.makeHazard(def, ctx); } catch (e) { ok('static spikes build', false, e.message); hz = null; }
  if (hz) {
    let n = 0, lethal = 0, solid = 0;
    drive(hz, 0, 3, () => { n++; if (hz.kills[0].active) lethal++; if (hz.colliders[0].active !== false) solid++; });
    ok('static spikes are permanently lethal', n > 0 && lethal === n, `${lethal}/${n}`);
    ok('static spike plate is permanently standable', solid === n, `${solid}/${n}`);
    hz.dispose();
  }
}
return R;
"""

# ── section: crumble ──────────────────────────────────────────────────────────
JS_CRUMBLE = PRELUDE + r"""
const H = await import('./runtime/hazards/index.js');
const S = G.stage;
const baseCtx = () => ({
  mats: S.mats, theme: S.theme, themeId: S.themeId, palette: S.palette, quality: S.quality,
});
const STEP = 1 / 240;
const anySolid = (hz) => { for (const c of hz.colliders) if (c.active !== false) return true; return false; };
function run(hz, t0, t1) { for (let t = t0 + STEP; t <= t1 + 1e-9; t += STEP) hz.update(t, STEP); }

const SIZE = [4, 0.5, 4];
const P = [0, 3, 0];
const TOP = P[1] + SIZE[1] * 0.5;
const mk = (ctx) => H.makeHazard(
  { kind: 'vanish', p: P.slice(), s: SIZE.slice(), mode: 'crumble', crackDelay: 0.32 }, ctx);

/* ---- 1. explicit landing: breaks, and stays broken ---------------------- */
{
  const hz = mk(baseCtx());
  hz.reset(0); run(hz, 0, 1.0);
  ok('crumble is solid before it is touched', anySolid(hz));
  hz.onStand(1.0);
  run(hz, 1.0, 1.0 + 0.32 - 0.02);
  ok('crumble is STILL solid through its crack telegraph', anySolid(hz));
  run(hz, 1.0 + 0.30, 1.0 + 0.32 + 0.05);
  ok('crumble breaks on touch', !anySolid(hz));
  run(hz, 1.37, 6.0);
  ok('crumble is gone after (stays broken)', !anySolid(hz));
  hz.reset(0);
  ok('crumble RE-ARMS on reset', anySolid(hz));
  hz.dispose();
}

/* ---- 2. a hazard with a live player must arm from a LANDING ------------- */
{
  const player = { pos: new THREE.Vector3(999, 999, 999), grounded: false, groundCollider: null, vel: new THREE.Vector3() };
  const ctx = baseCtx();
  ctx.player = player;
  const hz = mk(ctx);
  hz.reset(0); run(hz, 0, 0.5);
  ok('crumble ignores a player that is nowhere near it', anySolid(hz));

  // The player LANDS: standing on the tile's own collider, grounded.
  player.pos.set(P[0], TOP, P[2]);
  player.grounded = true;
  player.groundCollider = hz.colliders[0];
  run(hz, 0.5, 0.5 + 0.32 + 0.06);
  ok('crumble breaks when the player LANDS on it', !anySolid(hz), 'grounded on its own collider');
  hz.dispose();
}

/* ---- 3. a teleport-in must NOT break it -------------------------------- */
{
  const player = { pos: new THREE.Vector3(999, 999, 999), grounded: false, groundCollider: null, vel: new THREE.Vector3() };
  const ctx = baseCtx();
  ctx.player = player;
  const hz = mk(ctx);
  hz.reset(0); run(hz, 0, 0.5);
  // A respawn: the stage resets the hazard and the player APPEARS on the tile in
  // the same frame, airborne, with no landing and no ground contact yet.
  hz.reset(0.5);
  player.pos.set(P[0], TOP, P[2]);
  player.grounded = false;
  player.groundCollider = null;
  run(hz, 0.5, 0.5 + 0.32 + 0.06);
  ok('crumble does NOT break from a teleport-in', anySolid(hz),
     'player placed on the tile with no landing');
  hz.dispose();
}

/* ---- 4. a fly-over must not break it ----------------------------------- */
{
  const player = { pos: new THREE.Vector3(999, 999, 999), grounded: false, groundCollider: null, vel: new THREE.Vector3() };
  const ctx = baseCtx();
  ctx.player = player;
  const hz = mk(ctx);
  hz.reset(0); run(hz, 0, 0.5);
  player.pos.set(P[0], TOP + 2.0, P[2]);   // apex of a running jump, clean over the tile
  player.grounded = false;
  run(hz, 0.5, 0.5 + 0.32 + 0.06);
  ok('crumble does NOT break from a fly-over 2 m above it', anySolid(hz));
  hz.dispose();
}

/* ---- 5. walking underneath must not break it --------------------------- */
{
  const player = { pos: new THREE.Vector3(999, 999, 999), grounded: true, groundCollider: null, vel: new THREE.Vector3() };
  const ctx = baseCtx();
  ctx.player = player;
  const hz = mk(ctx);
  hz.reset(0); run(hz, 0, 0.5);
  player.pos.set(P[0], TOP - 0.7, P[2]);   // feet below the deck: passing under it
  run(hz, 0.5, 0.5 + 0.32 + 0.06);
  ok('crumble does NOT break from walking underneath', anySolid(hz));
  hz.dispose();
}
return R;
"""

# ── section: crumble-live (needs spire-2) ─────────────────────────────────────
JS_CRUMBLE_LIVE = PRELUDE + r"""
const S = G.stage;
const recs = (S.hazards || []).filter(r => r.kind === 'vanish' &&
  String((r.def && r.def.mode) || '').toLowerCase() === 'crumble');
ok('spire-2 carries crumble tiles', recs.length > 0, `${recs.length} found`);
if (!recs.length) return R;

const solid = (h) => { for (const c of h.colliders) if (c.active !== false) return true; return false; };
const rec = recs[0];
const hz = rec.h;
const d = rec.def;
const p = d.p, s = d.s || [4, 0.5, 4];
const top = p[1] + s[1] * 0.5;

ok('crumble tile starts armed', solid(hz));

// Stand the real player on it and let the game run: the trigger must fire.
const P = G.player;
P.__test.teleport(new THREE.Vector3(p[0], top + 0.05, p[2]));
P.__test.setVel(new THREE.Vector3(0, 0, 0));
// The trigger must come through the STAGE (Stage._detectStand -> hz.onStand), the only
// path that knows the player's ground contact. Sample it DURING the stand: once the tile
// breaks the player falls through, is no longer grounded, and _standOn goes back to null.
let sawStand = false, sawMs = -1;
{
  const t0 = performance.now();
  while (performance.now() - t0 < 700) {
    await frame();
    if (hz.colliders.indexOf(S._standOn) >= 0) { sawStand = true; sawMs = Math.round(performance.now() - t0); break; }
  }
}
ok('the stage registered the stand on the tile\'s own collider', sawStand,
   sawStand ? `stage._standOn became this tile ${sawMs} ms after the teleport` : 'never became this tile within 700 ms');
await wait(1400);
const brokeLive = !solid(hz);
ok('a real landing breaks the tile in the live stage', brokeLive,
   brokeLive ? 'collider went inactive' : 'collider still active after 1.4 s standing on it');

// Now respawn: the tile must come back.
G.cpIndex = 0;
S.resetFrom(0);
await wait(60);
ok('resetFrom RE-ARMS the crumble tile', solid(hz));
return R;
"""

# ── section: stateful (sink / elevator / chase) ───────────────────────────────
JS_STATEFUL = PRELUDE + r"""
const S = G.stage;
const P = G.player;
const stageId = (S.def && S.def.id) || S.id;
const recs = S.hazards || [];

function yOf(rec) { return rec.h.colliders[0] ? rec.h.colliders[0].center.y : NaN; }
/** Each sub-test starts with a LIVE player: the previous one may have ended in a death,
 *  and a teleport issued inside the death freeze is undone by the game's own respawn. */
async function settleAlive() {
  // The game's own "the player is back" condition (loopcheck uses the same one): alive,
  // the run state is 'playing' and input is not suspended by a respawn fade.
  const back = () => !P.dead && G.state === 'playing' && !(G.input && G.input.suspended);
  const t0 = performance.now();
  while (!back() && performance.now() - t0 < 6000) await frame();
  await wait(350);
}
/**
 * Every sub-test starts from the game's own respawn path — resetFrom(0) re-arms every
 * stateful hazard, the player is placed at the spawn, and the run is back in 'playing'.
 * Without this the previous sub-test leaks in: on temple-3 the rider ejected from the
 * sinker falls onto the ELEVATOR deck below, the stage fires that trigger on the way
 * down, and the elevator sub-test then finds it mid-cycle (movers' tryTrigger no-ops
 * while a cycle is running) and reads "8.10 -> 8.10".
 */
async function freshStart() {
  await settleAlive();
  G.cpIndex = 0;
  S.resetFrom(0);
  const sp = S.spawnFor(0);
  P.respawn(sp.pos, sp.yaw || 0);
  await wait(400);
  await settleAlive();
}
/** Teleport onto a deck and wait until the STAGE registers the stand (one retry). */
async function standOn(rec, x, y, z) {
  for (let attempt = 0; attempt < 2; attempt++) {
    P.__test.teleport(new THREE.Vector3(x, y, z));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await frame();
      if (rec.h.colliders.indexOf(S._standOn) >= 0) return Math.round(performance.now() - t0);
    }
  }
  return -1;
}

/* ---- sinkers (foundry-2 / neon-1) --------------------------------------- */
{
  const sinks = recs.filter(r => r.def && r.def.motion && r.def.motion.type === 'sink');
  if (sinks.length) {
    const rec = sinks[0];
    const d = rec.def, s = d.s || [4, 1, 4];
    await freshStart();
    const rest = yOf(rec);
    const col = rec.h.colliders[0];
    P.__test.teleport(new THREE.Vector3(d.p[0], d.p[1] + s[1] * 0.5 + 0.05, d.p[2]));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
    // Sample the DECK continuously, for up to 3 s or until it has clearly sunk. On
    // foundry-2 the sinker descends into lava, so the game itself may kill + respawn
    // (and resetFrom) the rider inside the window; the trigger question ("does standing
    // on it make it sink?") is the deck's minimum y, and the rider's fate is a separate
    // question, asked below and only while the rider is alive.
    let minY = rest, rideMs = 0, worstGap = 0, ejected = false;
    {
      const t0 = performance.now();
      while (performance.now() - t0 < 3000) {
        await frame();
        const y = yOf(rec);
        if (y < minY) minY = y;
        const deckTop = col.center.y + col.half.y;
        if (!P.dead && y < rest - 0.02 && deckTop > 2.5) {   // the deck is moving and still above the pool
          const gap = deckTop - P.pos.y;                     // > 0 == the rider is BELOW the deck top
          if (gap > worstGap) worstGap = gap;
          if (gap > 0.6 && !ejected) { ejected = true; rideMs = Math.round(performance.now() - t0); }
        }
        if (minY < rest - 0.6 && (ejected || performance.now() - t0 > 1500)) break;
      }
    }
    ok(`${stageId}: a sink mover actually SINKS when stood on`, minY < rest - 0.4,
       `deck y ${rest.toFixed(2)} -> min ${minY.toFixed(2)}`);
    // A rider on a descending deck must stay ON it (fall onto it under gravity, at worst
    // hover above it) — never pass THROUGH it. Owned by the collision layer's platform
    // velocity carry (collide.js / movers.js linVel), i.e. the PHYSICS lane, not this one:
    // zeroing hz.linVel after each update makes the rider track the deck exactly.
    ok(`${stageId}: the rider stays ON the sinking deck (physics lane: collide.js carry)`, !ejected,
       ejected ? `rider ${worstGap.toFixed(2)} m BELOW the deck top ${rideMs} ms in — carried through it`
               : `worst rider-below-deck gap ${worstGap.toFixed(2)} m`);
    G.cpIndex = 0;
    S.resetFrom(0);
    await wait(60);
    ok(`${stageId}: resetFrom RESTORES the sinker`, Math.abs(yOf(rec) - rest) < 0.05,
       `y ${yOf(rec).toFixed(2)} vs rest ${rest.toFixed(2)}`);
  } else R.notes.push(`${stageId}: no sink movers`);
}

/* ---- elevators (neon-2) -------------------------------------------------- */
{
  const lifts = recs.filter(r => r.def && r.def.motion && r.def.motion.type === 'elevator');
  if (lifts.length) {
    const rec = lifts[0];
    const d = rec.def, s = d.s || [4, 1, 4];
    await freshStart();
    const rest = yOf(rec);
    const to = d.motion.to;
    const col = rec.h.colliders[0];
    const stoodMs = await standOn(rec, d.p[0], d.p[1] + s[1] * 0.5 + 0.05, d.p[2]);
    // Same discipline as the sinker: the deck's PEAK is the trigger evidence (the game
    // may kill + respawn + resetFrom an ejected rider inside the window, snapping the
    // deck back to rest before a single end sample); the rider's fate is asked separately.
    let maxY = rest, worstGap = 0, ejected = false, rideMs = 0;
    {
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await frame();
        const y = yOf(rec);
        if (y > maxY) maxY = y;
        const deckTop = col.center.y + col.half.y;
        if (!P.dead && y > rest + 0.02) {
          const gap = deckTop - P.pos.y;                     // > 0 == the rider is BELOW the deck top
          if (gap > worstGap) worstGap = gap;
          if (gap > 0.6 && !ejected) { ejected = true; rideMs = Math.round(performance.now() - t0); }
        }
        if (maxY > rest + 1.0 && (ejected || performance.now() - t0 > 2500)) break;
      }
    }
    ok(`${stageId}: an elevator actually RISES when stood on`, maxY > rest + 0.5,
       `deck y ${rest.toFixed(2)} -> peak ${maxY.toFixed(2)} (target ${to ? to[1] : '?'}); stand registered ${stoodMs < 0 ? 'NEVER' : stoodMs + ' ms'} after the teleport`);
    ok(`${stageId}: the rider stays ON the rising deck (physics lane: collide.js carry)`, !ejected,
       ejected ? `rider ${worstGap.toFixed(2)} m BELOW the deck top ${rideMs} ms in — the deck rose through them`
               : `worst rider-below-deck gap ${worstGap.toFixed(2)} m`);
    P.__test.teleport(new THREE.Vector3(d.p[0] + 40, d.p[1] + 30, d.p[2]));
    G.cpIndex = 0;
    S.resetFrom(0);
    await wait(60);
    ok(`${stageId}: resetFrom RETURNS the elevator`, Math.abs(yOf(rec) - rest) < 0.05,
       `y ${yOf(rec).toFixed(2)} vs rest ${rest.toFixed(2)}`);
  } else R.notes.push(`${stageId}: no elevators`);
}

/* ---- chase walls (spire-3 / temple-3) ----------------------------------- */
{
  const chases = recs.filter(r => r.kind === 'chase');
  if (chases.length) {
    const hz = chases[0].h;
    const d = chases[0].def;
    await freshStart();
    S.reset(); S.clock = 0;
    for (const r of recs) if (r.h.reset) r.h.reset(0);
    const home = hz.frontAt ? hz.frontAt(0) : hz.front;
    // Halfway through its run — an authored `delay` can be minutes (temple-3 waits
    // 176 s), so the sample point is derived from the def, never hard-coded.
    const tMid = (hz.delay || 0) + (hz.travel / hz.speed) * 0.5;
    S.clock = tMid; for (const r of recs) r.h.update(tMid, 0);
    const far = hz.front;
    ok(`${stageId}: the chase front advances with the clock`, Math.abs(far - home) > 1.0,
       `front ${home.toFixed(2)} -> ${far.toFixed(2)} at t=${tMid.toFixed(1)}`);
    const cps = S.checkpoints || [];
    const idx = Math.max(0, cps.length - 1);
    const want = (cps[idx] && typeof cps[idx].clockOffset === 'number') ? cps[idx].clockOffset : 0;
    S.resetFrom(idx);
    await wait(40);
    const expect = hz.frontAt(want);
    ok(`${stageId}: resetFrom REWINDS the chase to the checkpoint clock`,
       Math.abs(hz.front - expect) < 0.25,
       `front ${hz.front.toFixed(2)}, expected ${expect.toFixed(2)} at clock ${want}`);
  } else R.notes.push(`${stageId}: no chase hazards`);
}
return R;
"""

# ── section: respawn safety ───────────────────────────────────────────────────
JS_RESPAWN = PRELUDE + r"""
const S = G.stage;
const P = G.player;
const stageId = (S.def && S.def.id) || S.id;
const cps = S.checkpoints || [];
const hold = opts.holdMs;

for (let i = 0; i < Math.max(1, cps.length); i++) {
  const idx = cps.length ? i : 0;
  // Exactly what Game._performRespawn does, minus the fade.
  G.cpIndex = idx;
  S.resetFrom(idx);
  const sp = S.spawnFor(idx);
  P.respawn(sp.pos, sp.yaw || 0);
  const deaths0 = G.deaths | 0;
  await wait(hold);
  const cause = P.deathCause || P.lastDeath || null;
  const died = P.dead || (G.deaths | 0) !== deaths0;
  ok(`${stageId} cp${idx}: alive ${hold} ms after respawn`, !died,
     died ? `died (${cause || 'unknown'}) at ${f3(P.pos)}, spawn ${f3(sp.pos)}` : `${f3(P.pos)}`);
}
return R;
"""

# ── section: dispose ──────────────────────────────────────────────────────────
JS_DISPOSE_ARM = r"""
const A = globalThis.ASCENDANT;
const G = A.game;
const S = G.stage;
const marks = [];
for (const rec of (S.hazards || [])) {
  const h = rec.h;
  const orig = h.update.bind(h);
  const m = { n: 0, kind: rec.kind };
  marks.push(m);
  h.update = function (t, dt) { m.n++; return orig(t, dt); };
}
globalThis.__hazDispose = { marks, stageId: (S.def && S.def.id) || S.id,
  geo0: A.engine.renderer.info.memory.geometries,
  tex0: A.engine.renderer.info.memory.textures };
return marks.length;
"""

JS_DISPOSE_CHECK = PRELUDE + r"""
const D = globalThis.__hazDispose;
const before = D.marks.reduce((a, m) => a + m.n, 0);
await wait(1200);
const after = D.marks.reduce((a, m) => a + m.n, 0);
const live = D.marks.filter(m => m.n > 0).length;
ok(`zero hazards from ${D.stageId} still update after the transition`, after === before,
   `${after - before} update() calls across ${live}/${D.marks.length} old hazards in 1.2 s`);
return R;
"""

JS_LEAK = PRELUDE + r"""
const info = A.engine.renderer.info.memory;
return { checks: [], geo: info.geometries, tex: info.textures, programs: A.engine.renderer.info.programs ? A.engine.renderer.info.programs.length : -1 };
"""

# ── section: contract ─────────────────────────────────────────────────────────
JS_CONTRACT = PRELUDE + r"""
const H = await import('./runtime/hazards/index.js');
const { Stage } = await import('./runtime/world/stage.js');
const S = G.stage;
const ctx = { mats: S.mats, theme: S.theme, themeId: S.themeId, palette: S.palette, quality: S.quality };

/** A minimal one-object stage def that is otherwise beyond reproach. */
function wrap(obj) {
  return {
    id: 'contract-probe', world: 'neon', theme: 'neon',
    spawn: { p: [0, 1, 0], yaw: 0 },
    finish: { p: [40, 1, 0] },
    killY: -50, par: 30000,
    checkpoints: [], coins: [],
    objects: [obj],
  };
}
function stageVerdict(obj) {
  try { Stage.validate(wrap(obj)); return { ok: true, msg: '' }; }
  catch (e) { return { ok: false, msg: String(e.message || e).slice(0, 200) }; }
}
function hazardVerdict(obj) {
  try { H.validateHazardDef(obj, { stageId: 'contract-probe', objectIndex: 0 }); }
  catch (e) { return { ok: false, msg: String(e.message || e).slice(0, 200) }; }
  // validation is only half the contract: the factory must also survive the def.
  try { const hz = H.makeHazard(obj, ctx); hz.dispose(); }
  catch (e) { return { ok: false, msg: 'factory: ' + String(e.message || e).slice(0, 180) }; }
  return { ok: true, msg: '' };
}

/* A complete, canonical def per kind, then every single-field deletion of it.
   Both validators must return the same verdict on every one. */
const GOOD = {
  mover:      { kind: 'mover', p: [0, 2, 0], s: [4, 1, 4], motion: { type: 'linear', to: [10, 2, 0], period: 4 } },
  vanish:     { kind: 'vanish', p: [0, 2, 0], s: [4, 0.5, 4], cycle: { on: 1.2, off: 1.4, warn: 0.5, phase: 0 } },
  rotor:      { kind: 'rotor', p: [0, 3, 0], len: 4, period: 4 },
  pendulum:   { kind: 'pendulum', p: [0, 8, 0], len: 5, amp: 1.1, period: 3 },
  crusher:    { kind: 'crusher', p: [0, 8, 0], s: [3, 1.4, 3], travel: 5, period: 3 },
  saw:        { kind: 'saw', p: [0, 3, 0], len: 2.4, period: 2.5 },
  laser:      { kind: 'laser', a: [0, 2, 0], b: [10, 2, 0], cycle: { on: 1, off: 1.4, warn: 0.5 } },
  lasergrid:  { kind: 'lasergrid', a: [0, 2, -4], b: [0, 2, 4], count: 3, cycle: { on: 1, off: 1.4, warn: 0.5 } },
  lasersweep: { kind: 'lasersweep', p: [0, 4, 0], period: 3 },
  turret:     { kind: 'turret', p: [0, 4, 0], period: 2 },
  lava:       { kind: 'lava', p: [0, 0, 0], s: [10, 1, 10] },
  risinglava: { kind: 'risinglava', p: [0, 0, 0], s: [10, 1, 10], rising: { from: 0, to: 12 } },
  spikes:     { kind: 'spikes', p: [0, 1, 0], s: [4, 1.2, 4] },
  chase:      { kind: 'chase', p: [0, 4, 0], axis: 'x', from: 0, to: 60, speed: 4 },
  ice:        { kind: 'ice', p: [0, 2, 0], s: [6, 1, 6] },
  conveyor:   { kind: 'conveyor', p: [0, 2, 0], s: [6, 1, 4], dir: [1, 0, 0], power: 3 },
  jumppad:    { kind: 'jumppad', p: [0, 2, 0], power: 6 },
  speedpad:   { kind: 'speedpad', p: [0, 2, 0], s: [3, 0.2, 3], dir: [1, 0, 0], power: 12 },
  wind:       { kind: 'wind', p: [0, 4, 0], s: [8, 8, 8], dir: [0, 1, 0], power: 6 },
  sticky:     { kind: 'sticky', p: [0, 2, 0], s: [4, 1, 4] },
};

const rows = [];
for (const kind in GOOD) {
  const good = GOOD[kind];
  const sv = stageVerdict(good), hv = hazardVerdict(good);
  if (!sv.ok || !hv.ok) {
    rows.push({ kind, field: '(canonical def)', stage: sv.ok, haz: hv.ok, msg: (sv.msg || hv.msg) });
  }
  for (const field in good) {
    if (field === 'kind') continue;
    const probe = Object.assign({}, good);
    delete probe[field];
    const a = stageVerdict(probe), b = hazardVerdict(probe);
    if (a.ok !== b.ok) rows.push({ kind, field: 'no ' + field, stage: a.ok, haz: b.ok, msg: (a.msg || b.msg) });
  }
}
/* Malformed VALUES (not just missing fields): both validators must REJECT every one of
   these — a zero period is an infinite loop, a zero-amplitude pendulum a NaN — and both
   must ACCEPT the documented aliases the factories read (pendulum `ampDeg`). */
const BAD = [
  ['rotor period 0',        Object.assign({}, GOOD.rotor, { period: 0 })],
  ['rotor len 0',           Object.assign({}, GOOD.rotor, { len: 0 })],
  ['rotor arms 0',          Object.assign({}, GOOD.rotor, { arms: 0 })],
  ['pendulum len 0',        Object.assign({}, GOOD.pendulum, { len: 0 })],
  ['pendulum period -1',    Object.assign({}, GOOD.pendulum, { period: -1 })],
  ['crusher travel 0',      Object.assign({}, GOOD.crusher, { travel: 0 })],
  ['mover motion.period 0', Object.assign({}, GOOD.mover, { motion: { type: 'linear', to: [10, 2, 0], period: 0 } })],
  ['mover motion.to NaN',   Object.assign({}, GOOD.mover, { motion: { type: 'linear', to: [10, NaN, 0], period: 4 } })],
  ['vanish cycle.on -1',    Object.assign({}, GOOD.vanish, { cycle: { on: -1, off: 1.4, warn: 0.5 } })],
  ['vanish cycle on+off 0', Object.assign({}, GOOD.vanish, { cycle: { on: 0, off: 0, warn: 0 } })],
  ['laser cycle.warn -1',   Object.assign({}, GOOD.laser, { cycle: { on: 1, off: 1.4, warn: -1 } })],
  ['jumppad power 0',       Object.assign({}, GOOD.jumppad, { power: 0 })],
  ['speedpad power 0',      Object.assign({}, GOOD.speedpad, { power: 0 })],
  ['chase speed 0',         Object.assign({}, GOOD.chase, { speed: 0 })],
  ['pendulum no amplitude', (() => { const d = Object.assign({}, GOOD.pendulum); delete d.amp; return d; })()],
];
const GOOD_ALIAS = [
  ['pendulum ampDeg instead of amp', (() => { const d = Object.assign({}, GOOD.pendulum); delete d.amp; d.ampDeg = 42; return d; })()],
];
let badN = 0, badWrong = 0, aliasWrong = 0;
for (const [label, d] of BAD) {
  const sv = stageVerdict(d), hv = hazardVerdict(d);
  badN++;
  if (sv.ok || hv.ok) { badWrong++; rows.push({ kind: d.kind, field: label, stage: sv.ok, haz: hv.ok, msg: 'malformed value ACCEPTED' }); }
}
for (const [label, d] of GOOD_ALIAS) {
  const sv = stageVerdict(d), hv = hazardVerdict(d);
  if (!sv.ok || !hv.ok) { aliasWrong++; rows.push({ kind: d.kind, field: label, stage: sv.ok, haz: hv.ok, msg: sv.msg || hv.msg }); }
}
ok('both validators REJECT every malformed value', badWrong === 0, `${badN - badWrong}/${badN} rejected by both`);
ok('both validators ACCEPT the factory aliases (pendulum ampDeg)', aliasWrong === 0,
   aliasWrong ? `${aliasWrong} alias def(s) rejected` : `${GOOD_ALIAS.length}/${GOOD_ALIAS.length}`);
R.rows = rows;
ok('Stage.validate and the hazard contract agree on every def', rows.length === 0,
   `${rows.length} disagreement(s)`);
return R;
"""


# ══════════════════════════════════════════════════════════════════════════════
#  driver
# ══════════════════════════════════════════════════════════════════════════════
CLICK_JS = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const want of ['NEW RUN', 'PLAY', 'CONTINUE']) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (b.__activate) b.__activate(); else b.click();
      return want;
    }
  }
  return null;
}"""


def wait_ready(pg, need_stage, timeout=75):
    expr = ("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"
            if need_stage else "!!(globalThis.ASCENDANT && ASCENDANT.game)")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate(expr):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(300)
    return False


def click_play(pg, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st and st != "title":
            return True
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(350)
    return False


def goto_stage(pg, sid, timeout=70):
    """__dev.goto + VERIFY the id — ?stage= alone only preloads."""
    try:
        pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", sid)
    except Exception as e:
        return "dev goto threw: " + str(e)[:200]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate(
                "(s)=>!!(ASCENDANT.game.stage && ((ASCENDANT.game.stage.def&&ASCENDANT.game.stage.def.id)===s"
                " || ASCENDANT.game.stage.id===s))", sid):
                pg.wait_for_timeout(1200)
                return None
        except Exception:
            pass
        pg.wait_for_timeout(300)
    return "never became " + sid


def boot(pg, dev=True):
    url = BASE + ("?dev=1" if dev else "")
    pg.goto(url, wait_until="load", timeout=60_000)
    if not wait_ready(pg, need_stage=False):
        return "ASCENDANT.game never appeared"
    click_play(pg)
    pg.wait_for_timeout(2000)
    if not wait_ready(pg, need_stage=True, timeout=45):
        return "game.stage never appeared"
    return None


def run_js(pg, js, arg=None, timeout=180_000):
    try:
        return pg.evaluate("async (opts) => { " + js + " }", arg or {}), None
    except Exception as e:
        return None, str(e)[:600]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list: " + ",".join(ALL_SECTIONS))
    ap.add_argument("--stages", default="")
    ap.add_argument("--hold", type=int, default=1500, help="ms to stand at each respawn point")
    ap.add_argument("--json", default=os.path.join(HERE, "hazcheck.json"))
    args = ap.parse_args()

    sections = [s.strip() for s in args.only.split(",") if s.strip()] or list(ALL_SECTIONS)
    bad = [s for s in sections if s not in ALL_SECTIONS]
    if bad:
        print("unknown section(s): " + ", ".join(bad))
        return 2

    if args.stages:
        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    else:
        d = os.path.join(HERE, "..", "runtime", "data", "stages")
        stages = sorted(f[:-3] for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []
    stages = [s for s in stages if s != "hub"]

    results = {}      # section -> list of checks
    notes = []
    pageerrs = []

    def add(section, checks):
        results.setdefault(section, []).extend(checks or [])

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))

        err = boot(pg)
        if err:
            print("BOOT FAILED: " + err)
            br.close()
            return 1

        # ── bench / crumble(synthetic) / contract: no particular stage needed ──
        for name, js in (("bench", JS_BENCH), ("crumble", JS_CRUMBLE), ("contract", JS_CONTRACT)):
            if name not in sections:
                continue
            res, e = run_js(pg, js)
            if e:
                add(name, [{"name": name + " routine", "pass": False, "detail": e}])
            else:
                add(name, res.get("checks"))
                notes.extend(res.get("notes") or [])
                if res.get("rows"):
                    results.setdefault("_contract_rows", []).extend(res["rows"])

        # ── crumble live (spire-2) ────────────────────────────────────────────
        if "crumble" in sections and "spire-2" in stages:
            e = goto_stage(pg, "spire-2")
            if e:
                add("crumble", [{"name": "spire-2 load", "pass": False, "detail": e}])
            else:
                res, e2 = run_js(pg, JS_CRUMBLE_LIVE)
                if e2:
                    add("crumble", [{"name": "spire-2 live crumble routine", "pass": False, "detail": e2}])
                else:
                    add("crumble", res.get("checks"))

        # ── stateful: the stages that actually carry the mechanics ────────────
        if "stateful" in sections:
            for sid in [s for s in ("foundry-2", "neon-1", "neon-2", "spire-3", "temple-3") if s in stages]:
                e = goto_stage(pg, sid)
                if e:
                    add("stateful", [{"name": sid + " load", "pass": False, "detail": e}])
                    continue
                res, e2 = run_js(pg, JS_STATEFUL)
                if e2:
                    add("stateful", [{"name": sid + " stateful routine", "pass": False, "detail": e2}])
                else:
                    add("stateful", res.get("checks"))
                    notes.extend(res.get("notes") or [])

        # ── respawn safety: every stage, every checkpoint ─────────────────────
        if "respawn" in sections:
            for sid in stages:
                e = goto_stage(pg, sid)
                if e:
                    add("respawn", [{"name": sid + " load", "pass": False, "detail": e}])
                    continue
                res, e2 = run_js(pg, JS_RESPAWN, {"holdMs": args.hold}, timeout=240_000)
                if e2:
                    add("respawn", [{"name": sid + " respawn routine", "pass": False, "detail": e2}])
                else:
                    add("respawn", res.get("checks"))

        # ── dispose + leak ────────────────────────────────────────────────────
        if "dispose" in sections:
            target = "neon-1" if "neon-1" in stages else (stages[0] if stages else None)
            other = "neon-2" if "neon-2" in stages else (stages[1] if len(stages) > 1 else None)
            if target and other:
                e = goto_stage(pg, target)
                if e:
                    add("dispose", [{"name": target + " load", "pass": False, "detail": e}])
                else:
                    n = pg.evaluate("() => { " + JS_DISPOSE_ARM + " }")
                    add("dispose", [{"name": "wrapped " + str(n) + " hazards on " + target,
                                     "pass": n > 0, "detail": str(n)}])
                    e2 = goto_stage(pg, other)
                    if e2:
                        add("dispose", [{"name": other + " load", "pass": False, "detail": e2}])
                    else:
                        res, e3 = run_js(pg, JS_DISPOSE_CHECK)
                        if e3:
                            add("dispose", [{"name": "dispose routine", "pass": False, "detail": e3}])
                        else:
                            add("dispose", res.get("checks"))

                    # leak: 3 identical transitions of the same stage
                    samples = []
                    for k in range(4):
                        e4 = goto_stage(pg, target)
                        if e4:
                            add("dispose", [{"name": "leak cycle " + str(k), "pass": False, "detail": e4}])
                            break
                        pg.wait_for_timeout(600)
                        s = pg.evaluate("() => { const i = ASCENDANT.engine.renderer.info.memory;"
                                        " return {geo: i.geometries, tex: i.textures}; }")
                        samples.append(s)
                        if k < 3:
                            goto_stage(pg, other)
                    if len(samples) == 4:
                        g0, g3 = samples[0]["geo"], samples[3]["geo"]
                        t0, t3 = samples[0]["tex"], samples[3]["tex"]
                        add("dispose", [
                            {"name": "geometries do not grow across 3 transitions",
                             "pass": g3 <= g0, "detail": f"{[s['geo'] for s in samples]}"},
                            {"name": "textures do not grow across 3 transitions",
                             "pass": t3 <= t0, "detail": f"{[s['tex'] for s in samples]}"},
                        ])
        br.close()

    # ── report ────────────────────────────────────────────────────────────────
    total = failed = 0
    print("=" * 78)
    print("ASCENDANT hazcheck — hazard correctness + stage reset")
    print("=" * 78)
    for sec in ALL_SECTIONS:
        checks = results.get(sec)
        if not checks:
            continue
        bad_n = sum(1 for c in checks if not c["pass"])
        total += len(checks)
        failed += bad_n
        print(f"\n{sec}  —  {len(checks) - bad_n}/{len(checks)} passed")
        for c in checks:
            mark = "ok  " if c["pass"] else "FAIL"
            det = "" if not c.get("detail") else f"   [{c['detail']}]"
            print(f"   {mark} {c['name']}{det}")
    rows = results.get("_contract_rows") or []
    if rows:
        print("\ncontract disagreements (Stage.validate vs hazards/index.js):")
        for r in rows:
            print(f"   {r['kind']:<11} {r['field']:<22} Stage.validate={'accept' if r['stage'] else 'REJECT':<6}"
                  f" hazard={'accept' if r['haz'] else 'REJECT'}")
            if r.get("msg"):
                print(f"                 {r['msg'][:150]}")
    if notes:
        print("\nnotes:")
        for n in notes:
            print("   - " + n)
    if pageerrs:
        print(f"\npage errors ({len(pageerrs)}):")
        for e in pageerrs[:10]:
            print("  !! " + e[:300])
    print("\n" + "=" * 78)
    print(f"VERDICT: {'HAZARDS OK' if failed == 0 else 'HAZARDS BROKEN'} — {total - failed}/{total} checks passed")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"results": results, "notes": notes, "pageErrors": pageerrs}, f, indent=2)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
