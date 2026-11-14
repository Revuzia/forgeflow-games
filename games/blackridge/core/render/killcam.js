// core/render/killcam.js — the kill cam: a real replay of the kill, and the
// final kill cam at match end.
//
// Owner request (2026-09-16): "getting killed and respawning should also show
// you the KILL CAM during the wait." Upgrade (2026-11-13): the cam used to
// orbit the killer's LIVE position; it now REPLAYS the seconds before the kill
// from over the killer's shoulder — the way Call of Duty shows you your death
// from the killer's eyes — and at match end replays the match-winning kill for
// everyone ("FINAL KILL") before the end board.
//
// HOW THE REPLAY WORKS (all view-side; the 60 Hz sim is never changed or re-run)
//   1. RECORD. Every view frame, at 30 Hz of SIM time, replay_buffer.js copies
//      each roster actor's body (pos / facing / aim point / velocity / stance /
//      anim / weapon / alive) into a fixed typed-array ring holding ~6.6 s.
//      Fire-time shots, deaths and explosions are recorded off the bridge with
//      their sim timestamps. Measured cost and memory: see state().stats.
//   2. PLAY. On the human's death (PVP, with an attacker) the old death cam
//      runs for a short beat, then the replay cuts in: the soldier actors are
//      driven from the RECORDING instead of live sim state by handing
//      soldiers.update() a "ghost" state for the frame (driveSoldiers below —
//      boot swaps ctx.sim for that one call only). Every recorded actor gets
//      a separate ghost actor (id GHOST_BASE + slot), INCLUDING the human,
//      who is drawn as a third-person soldier; the live actors are parked out
//      of sight. The live match keeps simulating underneath. When the replay
//      ends the ghost ids vanish from the state, soldiers.js disposes those
//      actors on its next live update, and the live actors snap back to live
//      positions (their tick counter jumps, which soldiers.js treats as a snap).
//      Recorded shots are re-emitted to fx + audio (muzzle flash, tracer,
//      impact, report) through a private mini-bridge, the ghost shooter's body
//      kicks, and the last bullet plays in slow motion.
//   3. FINAL KILL. Every kill freezes a copy of the ring ~0.5 s later. When the
//      PVP match ends, boot routes the event batch through filterEvents(),
//      which HOLDS `mission:end` (the event that opens the VICTORY banner →
//      end board → after-action chain), plays the last kill from that frozen
//      clip under a "FINAL KILL" banner, then releases the held event on the
//      next frame — the existing end flow then runs exactly as before.
//
// TIMING RULES (the replay never costs the player anything):
//   - the death replay is sized to the respawn timer: it ENDS before
//     respawnAtT (pre-roll truncated, slow-mo dropped when tight) and is cut
//     instantly if the player is alive again for any reason;
//   - no attacker (suicide / zone / world), a clip that does not cover the
//     kill, or a respawn too close → the old orbit death cam, unchanged;
//   - skippable (fire / Space / Enter / tap / pad A) after 0.3 s → orbit cam;
//   - pause freezes the replay (boot zeroes the sim accumulator but still
//     calls viewUpdates with the wall dt, so this module stops its own clock);
//   - match ending mid-replay → the death replay stops, the final kill cam
//     takes over;
//   - a held mission:end is always released: on replay end, on skip, on a new
//     match (reset), and by a wall-clock failsafe if frames stop arriving.
//   - campaign: no match → nothing is recorded and nothing changes.
//
// VIEWMODEL. ctx.cameraDetached is raised for as long as this module drives
// the camera (it hides the first-person rig — viewmodel.js header), and
// restored the moment it stops.
//
// IDENTITY RULE (PVP). Everything this module puts on screen is a roster
// callsign (actors[i].name — the human is "YOU"), a weapon name, or one of
// the words KILLCAM / FINAL KILL / KILLED BY / HEADSHOT / SKIP. Nothing says or
// implies bot, AI or NPC.

import { createReplayBuffer, createInterner, F, S, SF, E, EK } from "./replay_buffer.js";

const LIVE_PHASES = new Set(["live", "warmup", "overtime"]);

// ---- orbit death cam (the pre-replay behaviour, kept for every fallback) ----
const ORBIT_RATE = 0.22;   // rad/s — slow drift, enough to read depth
const DIST = 4.6;          // how far back from the killer
const HEIGHT = 1.55;       // camera rise above the killer's feet
const FOCUS_Y = 1.35;      // aim at the chest, not the feet
const NEAR_CLAMP = 1.25;   // never pull closer than this when occluded
const SKIN = 0.35;         // stand-off from whatever the pull-in ray hit
const EASE_S = 0.45;       // blend from the death pose into the shot
const NO_KILLER_DIST = 5.4;

// ---- replay ----------------------------------------------------------------
const HZ = 30;
const SLOTS = 16;               // roster max is 10 (5v5 / FFA 10)
const GHOST_BASE = 900000;      // ghost actor ids — never collide with sim bot ids
const DEATH_BEAT = 0.35;        // s of the old death cam before the cut
const MAX_PRE = 4.5;            // s of replay before the kill (max)
const MIN_PRE = 0.8;            // shorter than this is not worth a cut
const POST = 0.5;               // clip seconds played past the kill (the fall)
const SLOW_IN = 0.16, SLOW_OUT = 0.24, SLOW_RATE = 0.33, SLOW_EDGE = 0.12;
const RESPAWN_MARGIN = 0.12;    // end this long before the respawn
const HOLD_MAX = 1.2;           // overtime (no respawn): hold the end, then orbit
const SKIP_ARM = 0.3;
const SHOULDER_BACK = 0.95, SHOULDER_SIDE = 0.40, SHOULDER_UP = 0.10;
const EYE_STAND = 1.62, EYE_CROUCH = 1.10;   // = core/sim/player.js MOVE
const HIDE_POS = [0, -900, 0];  // where live actors are parked during a replay
const FLASH_S = 0.16;
const FINAL_WAIT_MAX = POST + 0.35;  // view s to wait for the post-roll after the end
const FINAL_FAILSAFE_MS = 15000;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len2(v) { return Math.hypot(v[0], v[2]); }
function smooth01(u) { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }

// Playback rate at clip time u (seconds relative to the kill).
function rateAt(u, slow) {
  if (!slow) return 1;
  let w;
  if (u < -SLOW_IN) w = smooth01(1 - (-SLOW_IN - u) / SLOW_EDGE);
  else if (u > SLOW_OUT) w = smooth01(1 - (u - SLOW_OUT) / SLOW_EDGE);
  else w = 1;
  return 1 - (1 - SLOW_RATE) * w;
}
// Wall seconds to play clip span [a, b] (relative to the kill).
function wallFor(a, b, slow) {
  if (!slow) return b - a;
  let w = 0;
  const h = 0.005;
  for (let u = a; u < b; u += h) w += Math.min(h, b - u) / rateAt(u + h * 0.5, true);
  return w;
}

export function createKillCam(ctx) {
  // ---- orbit state (pre-replay module, unchanged behaviour) ------------------
  let killerActorId = null;
  let deathPos = null;
  let fromPos = null;      // camera position at the instant the orbit took over
  let orbit = 0;
  let since = 0;
  let driving = false;
  let prevDetached = false;
  const _p = [0, 0, 0];

  // ---- recording -------------------------------------------------------------
  const intern = createInterner();
  const ring = createReplayBuffer({ slots: SLOTS, hz: HZ, seconds: 6.6 });
  const finalClip = createReplayBuffer({ slots: SLOTS, hz: HZ, seconds: 6.6 });
  let recSim = null;
  let nextSampleT = -1;
  const botById = new Map();
  const stats = { samples: 0, recMs: 0, recMaxMs: 0, copies: 0, copyMs: 0, replays: 0, finals: 0, skips: 0 };
  const W_ID = new Map();  // weapon id string → intern idx cache (no per-sample string work)

  // last kill (for the final kill cam) — slots are roster actorIds
  const lastKill = { valid: false, t: 0, a: -1, v: -1, head: 0, weapon: 0 };
  const finalKill = { valid: false, t: 0, a: -1, v: -1, head: 0, weapon: 0 };
  let finalPendingT = -1;

  // ---- replay state ------------------------------------------------------------
  // mode: idle | deathWait | replay | orbit | finalWait | final | finalHold
  let mode = "idle";
  let beatT = 0;
  const rp = {
    kind: "death", buf: null, killT: 0, killer: -1, victim: -1, head: 0, weapon: 0,
    explosive: false, srcPos: null, startT: 0, endT: 0, t: 0, slow: true,
    wall: 0, done: false, holdT: 0, anDt: 0, frame: 0, hideKiller: false,
    camInit: false,
  };
  const loc = { i0: 0, i1: 0, k: 0 };
  const smp = {};
  const ghosts = [];
  const gen = new Int32Array(SLOTS);
  for (let i = 0; i < SLOTS; i++) {
    ghosts.push({
      id: GHOST_BASE + i, present: false, wasAlive: null,
      archetype: "rifleman", team: 0,
      pos: [0, 0, 0], yaw: 0, alive: true, vel: [0, 0, 0], grounded: true,
      stance: "stand", anim: "idle", state: "idle",
      weapon: { id: "pike", state: "idle" }, aimAt: null, _aim: [0, 0, 0],
      hp: 100,
    });
  }
  const ghostBots = [];
  const wrapCache = new Map();
  const ghostState = { tick: 0, time: 0, bots: ghostBots, player: null, match: null, phase: null };
  const ghostSim = { state: ghostState, epoch: -1 };
  let ghostTick = -1e6;
  let ghostFrame = 0;
  const camDir = [0, 0, -1];
  const camPos = [0, 0, 0];
  const camLook = [0, 0, 0];

  // held mission:end (final kill cam)
  let held = null;
  let released = null;
  let heldEpoch = -1;
  let releaseQueued = false;
  let failsafe = null;
  let finalWaitT = 0;

  // replay targets (bound by boot after fx/audio/soldiers exist)
  let fxRef = null, audioRef = null, soldiersRef = null;
  let mini = null;

  function sim() { return ctx.sim ? ctx.sim() : null; }
  function matchOf(s) { return s && s.match && s.match.m ? s.match.m : null; }
  function paused() { return !!(ctx.pauseCtl && ctx.pauseCtl.active); }

  function acquire() {
    if (driving) return;
    driving = true;
    prevDetached = !!ctx.cameraDetached;
    ctx.cameraDetached = true;   // releases the rig AND hides the floating gun
  }
  function release() {
    if (!driving) return;
    driving = false;
    ctx.cameraDetached = prevDetached;
  }

  // =================================================================== record
  function wIdx(id) {
    if (id == null) return 0;
    let i = W_ID.get(id);
    if (i === undefined) { i = intern.id(id); W_ID.set(id, i); }
    return i;
  }

  function record() {
    const s = sim();
    const st = s && s.state;
    const m = matchOf(s);
    if (!st || !st.match || !m) return;
    if (s !== recSim) {            // a new match: nothing carries over
      recSim = s;
      ring.clear(); finalClip.clear();
      nextSampleT = -1;
      lastKill.valid = false; finalKill.valid = false; finalPendingT = -1;
    }
    const t = st.time;
    if (nextSampleT >= 0 && t + 1e-6 < nextSampleT) { maybeFreezeFinal(t); return; }
    nextSampleT = (nextSampleT < 0 || t - nextSampleT > 0.2) ? t + 1 / HZ : nextSampleT + 1 / HZ;
    const t0 = performance.now();
    botById.clear();
    const bots = st.bots;
    for (let i = 0; i < bots.length; i++) botById.set(bots[i].id, bots[i]);
    ring.beginSample(t);
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      const slot = a.actorId;
      if (slot == null || slot < 0 || slot >= SLOTS) continue;
      if (a.kind === "human") {
        const p = st.player;
        if (!p || !p.pos) continue;
        const crouch = p.stance === "crouch";
        const eye = crouch ? EYE_CROUCH : EYE_STAND;
        const cp = Math.cos(p.pitch || 0);
        const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch || 0), fz = -Math.cos(p.yaw) * cp;
        const ex = p.pos[0], ey = p.pos[1] + eye, ez = p.pos[2];
        let fl = F.HAS_AIM | F.READY;
        if (p.alive) fl |= F.ALIVE;
        if (crouch) fl |= F.CROUCH;
        if (p.grounded !== false) fl |= F.GROUNDED;
        if (p.weapon && p.weapon.state === "reloading") fl |= F.RELOAD;
        const v = p.vel || HIDE_POS;
        ring.writeActor(slot, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch || 0,
          v[0] || 0, v[2] || 0, ex + fx * 25, ey + fy * 25, ez + fz * 25, fl,
          wIdx(p.weapon && p.weapon.id), p.alive ? ANIM_AIM : ANIM_DEATH);
      } else {
        const b = botById.get(a.who);
        if (!b || !b.pos) continue;
        let fl = 0;
        if (b.alive) fl |= F.ALIVE;
        if (b.stance === "crouch") fl |= F.CROUCH;
        if (b.grounded !== false) fl |= F.GROUNDED;
        if (b.weapon && b.weapon.state === "reloading") fl |= F.RELOAD;
        if (b.state === "combat" || b.state === "suppress") fl |= F.READY;
        let ax = 0, ay = 0, az = 0;
        if (b.aimAt) { fl |= F.HAS_AIM; ax = b.aimAt[0]; ay = b.aimAt[1]; az = b.aimAt[2]; }
        const v = b.vel || HIDE_POS;
        ring.writeActor(slot, b.pos[0], b.pos[1], b.pos[2], b.yaw || 0, 0,
          v[0] || 0, v[2] || 0, ax, ay, az, fl,
          wIdx(b.weapon && b.weapon.id), animIdx(b.anim));
      }
    }
    ring.endSample();
    maybeFreezeFinal(t);
    const ms = performance.now() - t0;
    stats.samples++; stats.recMs += ms; if (ms > stats.recMaxMs) stats.recMaxMs = ms;
  }

  const ANIM_IDX = new Map();
  function animIdx(a) {
    if (!a) return 0;
    let i = ANIM_IDX.get(a);
    if (i === undefined) { i = intern.id(a); ANIM_IDX.set(a, i); }
    return i;
  }
  const ANIM_AIM = intern.id("aim");
  const ANIM_DEATH = intern.id("death_a");

  function maybeFreezeFinal(t) {
    if (finalPendingT >= 0 && t >= finalPendingT) freezeFinal();
  }
  function freezeFinal() {
    const c0 = performance.now();
    finalClip.copyFrom(ring);
    stats.copies++; stats.copyMs += performance.now() - c0;
    finalKill.valid = lastKill.valid; finalKill.t = lastKill.t; finalKill.a = lastKill.a;
    finalKill.v = lastKill.v; finalKill.head = lastKill.head; finalKill.weapon = lastKill.weapon;
    finalPendingT = -1;
  }

  // ---- bridge taps (recording side) ------------------------------------------
  function slotOfWho(m, who) {
    if (!m || who == null) return -1;
    const a = m.actorOf(who);
    return a && a.actorId != null ? a.actorId : -1;
  }
  const _o = [0, 0, 0], _d = [0, 0, 0];
  function onShotRec(d, t) {
    if (!d || d.impactOnly || d.pen || !d.origin || !d.dir) return;
    const s = sim();
    const m = matchOf(s);
    if (!m || s !== recSim) return;
    const slot = slotOfWho(m, d.shooter);
    if (slot < 0) return;
    const h = d.hit;
    let ent = -1;
    if (h && h.entity != null) ent = h.entity === "P" ? -2 : (typeof h.entity === "number" ? h.entity : -1);
    let fl = 0;
    if (d.tracer || d.firstShot) fl |= SF.TRACER;
    if (d.firstShot) fl |= SF.FIRST;
    if (h && h.part === "head") fl |= SF.HEAD;
    _o[0] = d.origin[0]; _o[1] = d.origin[1]; _o[2] = d.origin[2];
    _d[0] = d.dir[0]; _d[1] = d.dir[1]; _d[2] = d.dir[2];
    ring.pushShot(t != null ? t : s.state.time, slot, _o, _d, h && h.pos ? h.pos : null, h ? h.normal : null,
      h ? intern.id(h.surface) : 0, ent, wIdx(d.weaponId), fl, d.pellet | 0);
  }
  function onExplosionRec(d, t) {
    if (!d || !d.pos) return;
    const s = sim();
    if (!matchOf(s) || s !== recSim) return;
    ring.pushEvent(t != null ? t : s.state.time, EK.EXPLOSION, -1, -1, d.pos[0], d.pos[1] || 0, d.pos[2],
      d.radius || 5.5, 0, d.source === "streak" ? 2 : 1);
  }

  // ================================================================ death event
  function onDeath(d, t) {
    if (!d) return;
    const s = sim();
    const m = matchOf(s);
    const tk = t != null ? t : (s && s.state ? s.state.time : 0);
    // record every kill (final kill cam + the replay's own event track)
    if (m && s === recSim && d.victimActor != null) {
      const a = d.attackerActor != null ? d.attackerActor : -1;
      const v = d.victimActor;
      let wpn = 0;
      if (a >= 0) {
        const aa = m.actors[a];
        const body = aa ? (aa.kind === "human" ? s.state.player : m.bodyOf(aa)) : null;
        wpn = wIdx(d.melee ? "knife" : (body && body.weapon ? body.weapon.id : null)); // [melee] label "KNIFE"
      }
      ring.pushEvent(tk, EK.DEATH, a, v, d.pos ? d.pos[0] : 0, d.pos ? d.pos[1] : 0, d.pos ? d.pos[2] : 0,
        0, d.headshot ? 1 : 0, wpn);
      if (a >= 0 && a !== v && a < SLOTS && v < SLOTS) {
        lastKill.valid = true; lastKill.t = tk; lastKill.a = a; lastKill.v = v;
        lastKill.head = d.headshot ? 1 : 0; lastKill.weapon = wpn;
        finalPendingT = tk + POST + 0.05;
      }
    }
    // Only OUR death opens a kill cam. victimActor 0 is the human slot, but
    // prefer the explicit who tag when the event carries one.
    const mine = d.victim === "P" || d.who === "P" || d.victimActor === 0;
    if (!mine) return;
    killerActorId = (d.attackerActor != null && d.attackerActor !== 0)
      ? d.attackerActor : null;
    deathPos = Array.isArray(d.pos) ? d.pos.slice() : null;
    const c = ctx.camera;
    fromPos = c ? [c.position.x, c.position.y, c.position.z] : null;
    orbit = 0;
    since = 0;
    if (mode === "final" || mode === "finalWait" || mode === "finalHold") return;
    if (mode === "replay") endReplay();
    // the replay needs a match, a killer, and the kill inside the recording
    if (m && s === recSim && killerActorId != null && killerActorId < SLOTS) {
      mode = "deathWait";
      beatT = 0;
      rp.kind = "death";
      rp.killT = tk; rp.killer = killerActorId; rp.victim = 0;
      rp.head = d.headshot ? 1 : 0;
      rp.weapon = lastKill.valid && lastKill.t === tk ? lastKill.weapon : 0;
    } else {
      mode = "orbit";
    }
  }

  function attach(bridge) {
    if (!bridge || !bridge.register) return;
    bridge.register("death", onDeath);
    bridge.register("shot", onShotRec);
    bridge.register("explosion", onExplosionRec);
    // replay output: fx + audio re-registered on a PRIVATE mini bridge, so a
    // re-emitted shot reaches exactly those two consumers (never the HUD hit
    // markers, the kill feed, scoring or rumble). Re-done per match because
    // fx guards its handlers on the sim epoch at attach time.
    mini = makeMini();
    try { if (fxRef && fxRef.attach) fxRef.attach(mini); } catch (e) { console.warn("[killcam] fx replay tap failed:", e && e.message); }
    try { if (audioRef && audioRef.attach) audioRef.attach(mini); } catch (e) { console.warn("[killcam] audio replay tap failed:", e && e.message); }
  }
  function makeMini() {
    const h = new Map();
    return {
      register(type, fn) { if (type === "shot" || type === "explosion") { let l = h.get(type); if (!l) h.set(type, l = []); l.push(fn); } },
      emit(type, data, t) {
        const l = h.get(type);
        if (!l) return;
        for (let i = 0; i < l.length; i++) { try { l[i](data, t); } catch (e) { /* one bad payload skips one effect */ } }
      },
    };
  }

  // ================================================================= replay
  function startReplay(kind, buf, kill, budget) {
    const oldest = buf.oldestT(), newest = buf.newestT();
    if (!(kill.t > oldest)) return false;
    let pre = Math.min(MAX_PRE, kill.t - oldest - 0.04);
    let slow = true;
    if (Number.isFinite(budget)) {
      const slowWall = wallFor(-1, POST, true);
      pre = Math.min(pre, 1 + (budget - slowWall));
      if (pre < MIN_PRE) { slow = false; pre = Math.min(kill.t - oldest - 0.04, MAX_PRE, budget - POST); }
    }
    if (!(pre >= MIN_PRE)) return false;
    // the death replay reads the LIVE ring, so its end may still be in the
    // future; the final clip is frozen, so clamp to what it holds
    const endT = kind === "final" ? Math.min(kill.t + POST, newest) : kill.t + POST;
    rp.kind = kind; rp.buf = buf;
    rp.killT = kill.t; rp.killer = kill.a; rp.victim = kill.v; rp.head = kill.head; rp.weapon = kill.weapon;
    rp.startT = kill.t - pre; rp.endT = endT; rp.t = rp.startT; rp.slow = slow;
    rp.wall = 0; rp.done = false; rp.holdT = 0; rp.anDt = 0; rp.frame = 0; rp.camInit = false;
    rp.hideKiller = false;
    // explosive kill → framing camera (no first-person view of a thrown frag)
    rp.explosive = false; rp.srcPos = null;
    const vk = buf.findEvent(EK.DEATH, -1, kill.v, kill.t + 1e-3);
    const ev = buf.events;
    const dpx = vk >= 0 ? ev[vk + E.X] : NaN, dpz = vk >= 0 ? ev[vk + E.Z] : NaN;
    buf.forEvents(kill.t - 0.3, kill.t + 0.05, (a, o) => {
      if (a[o + E.KIND] !== EK.EXPLOSION || !Number.isFinite(dpx)) return;
      const r = (a[o + E.R] || 5.5) * 1.3;
      if (Math.hypot(a[o + E.X] - dpx, a[o + E.Z] - dpz) <= r) {
        rp.explosive = true; rp.srcPos = [a[o + E.X], a[o + E.Y], a[o + E.Z]];
      }
    });
    for (let i = 0; i < SLOTS; i++) { ghosts[i].present = false; ghosts[i].wasAlive = null; }
    acquire();
    mode = kind === "final" ? "final" : "replay";
    if (kind === "final") stats.finals++; else stats.replays++;
    flash(1);
    overlayShow();
    return true;
  }

  function endReplay() {
    rp.buf = null;
    wrapCache.clear();
    ghostBots.length = 0;
    // ghost actors: soldiers.js reaps them on its next LIVE update (their ids
    // are not in sim.state.bots); restore anything we hid
    if (soldiersRef && soldiersRef._actors) {
      for (const rec of soldiersRef._actors.values()) {
        if (rec && rec.actor && rec.actor.root && rec.botId < GHOST_BASE) rec.actor.root.visible = true;
      }
    }
    overlayHide();
  }

  function liveWrap(b) {
    let w = wrapCache.get(b);
    if (!w) { w = Object.create(b); w.pos = HIDE_POS; wrapCache.set(b, w); }
    return w;
  }

  // Build this frame's ghost state from the clip at rp.t.
  function buildGhost(advance) {
    const s = sim();
    const st = s.state;
    const m = matchOf(s);
    ghostBots.length = 0;
    for (let i = 0; i < st.bots.length; i++) ghostBots.push(liveWrap(st.bots[i]));
    const buf = rp.buf;
    buf.locate(rp.t, loc);
    for (let slot = 0; slot < SLOTS; slot++) {
      const g = ghosts[slot];
      if (!buf.readActor(slot, loc, smp)) { g.present = false; continue; }
      const alive = (smp.flags & F.ALIVE) !== 0;
      if (alive && g.wasAlive === false) gen[slot]++;   // died and came back inside the clip: fresh actor
      g.wasAlive = alive;
      g.present = true;
      g.id = GHOST_BASE + gen[slot] * SLOTS + slot;
      const ra = m && m.actors[slot];
      g.team = ra ? ra.team : 0;
      g.archetype = ra && ra.archetype ? ra.archetype : humanArch(m, g.team);
      g.pos[0] = smp.x; g.pos[1] = smp.y; g.pos[2] = smp.z;
      g.yaw = smp.yaw;
      g.alive = alive;
      g.hp = alive ? 100 : 0;
      g.vel[0] = smp.vx; g.vel[2] = smp.vz;
      g.grounded = (smp.flags & F.GROUNDED) !== 0;
      g.stance = (smp.flags & F.CROUCH) ? "crouch" : "stand";
      g.anim = intern.str(smp.anim) || "idle";
      g.state = alive ? ((smp.flags & F.READY) ? "combat" : "patrol") : "dead";
      g.weapon.id = intern.str(smp.weapon) || "pike";
      g.weapon.state = (smp.flags & F.RELOAD) ? "reloading" : "idle";
      if (smp.flags & F.HAS_AIM) {
        g._aim[0] = smp.ax; g._aim[1] = smp.ay; g._aim[2] = smp.az; g.aimAt = g._aim;
      } else g.aimAt = null;
      g.pitch = smp.pitch;
      ghostBots.push(g);
    }
    ghostState.player = st.player;
    ghostState.match = st.match;
    ghostState.phase = st.phase;
    if (advance) { ghostTick--; ghostFrame++; }
    ghostState.tick = ghostTick;
    // strictly increasing while playing (soldiers.js freezes the mixers on a
    // non-advancing clock), and never more than ~1 ms ahead of the live clock
    // so the first live frame after the replay is not read as "held"
    ghostState.time = st.time + (ghostFrame % 1000) * 1e-6;
    ghostSim.epoch = s.epoch;
  }
  function humanArch(m, team) {
    if (m) {
      for (const a of m.actors) {
        if (a.kind !== "human" && a.team === team && a.archetype && /rifleman/.test(a.archetype)) return a.archetype;
      }
      for (const a of m.actors) if (a.kind !== "human" && a.archetype) return a.archetype;
    }
    return "rifleman";
  }

  // Re-emit recorded shots / explosions in (t0, t1].
  function emitClip(t0, t1) {
    const buf = rp.buf;
    const s = sim();
    const liveT = s ? s.state.time : 0;
    buf.forShots(t0, t1, (a, o) => {
      const slot = a[o + S.SLOT] | 0;
      const g = ghosts[slot];
      const gid = g ? g.id : GHOST_BASE + slot;
      const ent = a[o + S.ENTITY];
      let hit = null;
      if (a[o + S.HAS_HIT] > 0) {
        // a hit on the human was recorded as entity -2; in the replay the
        // human is a ghost body across the street, so it bleeds like anyone
        let entity = null;
        if (ent === -2) entity = ghosts[0] ? ghosts[0].id : null;
        else if (ent >= 0) entity = ent;
        hit = {
          pos: [a[o + S.HX], a[o + S.HY], a[o + S.HZ]],
          normal: [a[o + S.NX], a[o + S.NY], a[o + S.NZ]],
          surface: intern.str(a[o + S.SURF]) || "concrete",
          entity, part: (a[o + S.FLAGS] & SF.HEAD) ? "head" : "body",
        };
      }
      const pellet = a[o + S.PELLET] | 0;
      const d = {
        shooter: gid, weaponId: intern.str(a[o + S.WEAPON]),
        origin: [a[o + S.OX], a[o + S.OY], a[o + S.OZ]],
        dir: [a[o + S.DX], a[o + S.DY], a[o + S.DZ]],
        hit, tracer: true, firstShot: (a[o + S.FLAGS] & SF.FIRST) !== 0, pellet,
        replay: true,
      };
      if (mini) mini.emit("shot", d, liveT);
      // the shooter's body takes the round (soldiers.js does this for live shots)
      if (!(pellet > 0) && soldiersRef && soldiersRef._actors) {
        const rec = soldiersRef._actors.get(gid);
        if (rec) { rec.kick = 1; if (rec.actor && rec.actor.fireImpulse) rec.actor.fireImpulse(1); }
      }
      if (hit && hit.entity != null && soldiersRef && soldiersRef._actors) {
        const vr = soldiersRef._actors.get(hit.entity === ent ? ghostIdForLive(ent) : hit.entity);
        if (vr && vr.actor && vr.actor.hitImpulse) vr.actor.hitImpulse(0, 0.9);
      }
    });
    buf.forEvents(t0, t1, (a, o) => {
      if (a[o + E.KIND] !== EK.EXPLOSION || !mini) return;
      mini.emit("explosion", {
        pos: [a[o + E.X], a[o + E.Y], a[o + E.Z]], radius: a[o + E.R],
        source: a[o + E.AUX] === 2 ? "streak" : "grenade", replay: true,
      }, liveT);
    });
  }
  // a recorded bot entity id → the ghost of the roster actor that owned it
  function ghostIdForLive(botId) {
    const m = matchOf(sim());
    const a = m && m.actorOf(botId);
    if (!a || a.actorId == null || a.actorId >= SLOTS) return -1;
    return ghosts[a.actorId].id;
  }

  // Camera for the replay frame.
  function replayCamera(dtWall) {
    const camera = ctx.camera;
    const K = ghosts[rp.killer];
    const V = ghosts[rp.victim];
    const s = sim();
    const world = s && s.world;
    const u = rp.t - rp.killT;
    let lookX, lookY, lookZ, px, py, pz;
    rp.hideKiller = false;
    const killerOk = K && K.present && K.alive && !rp.explosive;
    if (killerOk || (K && K.present && !rp.explosive && rp.camInit && !K.alive)) {
      if (!K.alive) {               // the killer was traded after the kill: hold the shot
        camera.position.set(camPos[0], camPos[1], camPos[2]);
        camera.lookAt(camLook[0], camLook[1], camLook[2]);
        camera.updateMatrixWorld();
        return;
      }
      const eye = K.stance === "crouch" ? EYE_CROUCH : EYE_STAND;
      const ex = K.pos[0], ey = K.pos[1] + eye, ez = K.pos[2];
      // aim direction: the recorded aim point, else facing
      let dx, dy, dz;
      if (K.aimAt) { dx = K.aimAt[0] - ex; dy = K.aimAt[1] - ey; dz = K.aimAt[2] - ez; }
      else { const cp = Math.cos(K.pitch || 0); dx = -Math.sin(K.yaw) * cp; dy = Math.sin(K.pitch || 0); dz = -Math.cos(K.yaw) * cp; }
      let L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      // framing assist: lean the shot onto the victim once he is roughly in
      // the killer's view, firmly around the kill (the round is the story)
      if (V && V.present) {
        const vy = V.pos[1] + (V.alive ? (V.stance === "crouch" ? 0.95 : 1.25) : 0.35);
        let vx = V.pos[0] - ex, vyy = vy - ey, vz = V.pos[2] - ez;
        const LV = Math.hypot(vx, vyy, vz) || 1; vx /= LV; vyy /= LV; vz /= LV;
        const c = dx * vx + dy * vyy + dz * vz;
        const near = smooth01((u + 1.6) / 1.4);
        let w = smooth01((c - 0.55) / 0.35) * (0.3 + 0.55 * near);
        // after the round lands the story is the body: stay on it even if
        // the killer is already turning to his next target
        if (u > 0) w = Math.max(w, 0.85 * smooth01(u / 0.2));
        dx += (vx - dx) * w; dy += (vyy - dy) * w; dz += (vz - dz) * w;
        L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      }
      // smooth (bot aim is a stepped signal); snap on the first frame
      const kS = rp.camInit ? 1 - Math.exp(-14 * Math.max(0, dtWall)) : 1;
      camDir[0] += (dx - camDir[0]) * kS; camDir[1] += (dy - camDir[1]) * kS; camDir[2] += (dz - camDir[2]) * kS;
      L = Math.hypot(camDir[0], camDir[1], camDir[2]) || 1;
      const fx = camDir[0] / L, fy = camDir[1] / L, fz = camDir[2] / L;
      // right = forward × up, flattened
      let rx = -fz, rz = fx; const RL = Math.hypot(rx, rz) || 1; rx /= RL; rz /= RL;
      let ox = -fx * SHOULDER_BACK + rx * SHOULDER_SIDE;
      let oy = -fy * SHOULDER_BACK * 0.5 + SHOULDER_UP;
      let oz = -fz * SHOULDER_BACK + rz * SHOULDER_SIDE;
      // occlusion: never put the lens inside the wall behind him
      let OL = Math.hypot(ox, oy, oz) || 1;
      if (world && world.raycast) {
        const hit = world.raycast([ex, ey, ez], [ox / OL, oy / OL, oz / OL], OL);
        if (hit && hit.dist != null && hit.dist < OL) {
          const k = Math.max(0, hit.dist - 0.18) / OL;
          ox *= k; oy *= k; oz *= k; OL *= k;
        }
      }
      // too tight to frame his shoulder → we are in his eyes; hide his body
      if (OL < 0.45) rp.hideKiller = true;
      px = ex + ox; py = ey + oy; pz = ez + oz;
      lookX = ex + fx * 30; lookY = ey + fy * 30; lookZ = ez + fz * 30;
    } else {
      // FRAMING CAMERA: explosive kill, or the killer is not in the clip.
      const src = rp.srcPos || (K && K.present ? K.pos : null);
      const vp = V && V.present ? V.pos : (src || [camera.position.x, 0, camera.position.z]);
      const ax = vp[0], ay = vp[1] + 1.0, az = vp[2];
      let sx = 1, sz = 0;
      if (src) { const d = Math.hypot(src[0] - ax, src[2] - az); if (d > 0.5) { sx = (src[0] - ax) / d; sz = (src[2] - az) / d; } }
      const ang = 0.35 + rp.wall * 0.12;
      const cx = sx * Math.cos(ang) - sz * Math.sin(ang), cz = sx * Math.sin(ang) + sz * Math.cos(ang);
      let ox = cx * 5.2, oy = 2.4, oz = cz * 5.2;
      let OL = Math.hypot(ox, oy, oz);
      if (world && world.raycast) {
        const hit = world.raycast([ax, ay, az], [ox / OL, oy / OL, oz / OL], OL);
        if (hit && hit.dist != null && hit.dist < OL) {
          const k = Math.max(NEAR_CLAMP, hit.dist - SKIN) / OL;
          ox *= k; oy *= k; oz *= k;
        }
      }
      px = ax + ox; py = ay + oy; pz = az + oz;
      lookX = ax; lookY = ay - 0.2; lookZ = az;
    }
    camPos[0] = px; camPos[1] = py; camPos[2] = pz;
    camLook[0] = lookX; camLook[1] = lookY; camLook[2] = lookZ;
    camera.position.set(px, py, pz);
    camera.lookAt(lookX, lookY, lookZ);
    camera.updateMatrixWorld();
    rp.camInit = true;
  }

  // Advance + render one replay frame. Returns true while it owns the camera.
  function driveReplay(dt) {
    const p = paused();
    if (!p && !rp.done) {
      const t0 = rp.t;
      const r = rateAt(rp.t - rp.killT, rp.slow);
      rp.wall += dt;
      rp.t = Math.min(rp.endT, rp.t + dt * r);
      // death replay plays the LIVE ring: never read past what is recorded
      if (rp.kind === "death") {
        const nt = rp.buf.newestT();
        if (rp.t > nt) rp.t = Math.max(t0, nt);
        const ot = rp.buf.oldestT();
        if (rp.t < ot) rp.t = ot;
      }
      rp.anDt = dt * r;
      if (rp.t > t0) emitClip(t0, rp.t); else if (rp.wall < 1e-3) emitClip(rp.startT - 1e-3, rp.t);
      if (rp.t >= rp.endT - 1e-6) rp.done = true;
      buildGhost(true);
    } else {
      rp.anDt = 0;
      if (!p && rp.done) rp.holdT += dt;
      buildGhost(false);
    }
    replayCamera(p ? 0 : dt);
    overlayUpdate(dt, p);
    return true;
  }

  // ============================================================== skip input
  let skipReq = false;
  let padWas = false;
  function skipWanted() {
    // pad A, polled (no event exists for it)
    try {
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
      let down = false;
      if (pads) for (let i = 0; i < pads.length; i++) { const g = pads[i]; if (g && g.buttons && g.buttons[0] && g.buttons[0].pressed) down = true; }
      if (down && !padWas) skipReq = true;
      padWas = down;
    } catch (e) { /* no pads */ }
    const r = skipReq; skipReq = false;
    return r && rp.wall >= SKIP_ARM;
  }
  function replaying() { return mode === "replay" || mode === "final"; }
  if (typeof window !== "undefined") {
    const onKey = (e) => {
      if (!replaying()) return;
      if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") skipReq = true;
    };
    const onPtr = (e) => { if (replaying() && (e.button === 0 || e.button == null)) skipReq = true; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPtr, true);
    window.addEventListener("touchstart", onPtr, { capture: true, passive: true });
  }

  // ================================================================ overlay
  // Self-contained (no hud.js edit): letterbox, banner, killer card, skip
  // prompt, progress hairline and the cut flash. z 40: above the match HUD
  // (35), below the class picker (57-60), pause and the end board (60-70).
  let ov = null;
  function overlayBuild() {
    if (ov || typeof document === "undefined") return ov;
    const st = document.createElement("style");
    st.textContent = `
#kc-ov{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;
  font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);}
#kc-ov .bar{position:absolute;left:0;right:0;height:7.5vh;background:rgba(0,0,0,.82);}
#kc-ov .bar.t{top:0}#kc-ov .bar.b{bottom:0}
#kc-ov .ban{position:absolute;top:calc(7.5vh + 14px);left:50%;transform:translateX(-50%);
  text-align:center;letter-spacing:.42em;font-size:15px;font-weight:700;padding:5px 14px 5px 20px;
  background:rgba(10,10,10,.55);border-left:3px solid #c8443a;}
#kc-ov.final .ban{border-left-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);}
#kc-ov .card{position:absolute;left:24px;bottom:calc(7.5vh + 18px);background:rgba(10,10,10,.6);
  padding:8px 14px 9px;border-left:3px solid var(--a10-amber,#d9a441);min-width:180px;}
#kc-ov .card .lbl{font-size:10px;letter-spacing:.34em;opacity:.6;}
#kc-ov .card .who{font-size:22px;letter-spacing:.12em;margin-top:2px;color:var(--a10-amber,#d9a441);}
#kc-ov .card .who .vs{opacity:.55;color:var(--a10-ink,#e8e8e4);font-size:14px;margin:0 8px;}
#kc-ov .card .wpn{font-size:11px;letter-spacing:.24em;opacity:.8;margin-top:3px;}
#kc-ov .card .hs{font-size:10px;letter-spacing:.28em;color:#e06a5a;margin-top:3px;}
#kc-ov .skip{position:absolute;right:24px;bottom:calc(7.5vh + 22px);font-size:11px;letter-spacing:.3em;opacity:.75;}
#kc-ov .prog{position:absolute;left:0;bottom:7.5vh;height:2px;background:rgba(232,232,228,.55);width:0}
#kc-ov .fl{position:absolute;inset:0;background:#fff;opacity:0}
body.kc-on #mh-killcam,body.kc-on #ld-root,body.kc-on #hud > *{visibility:hidden}
@media (max-width:700px){#kc-ov .card{left:12px}#kc-ov .skip{right:12px}#kc-ov .card .who{font-size:18px}}
`;
    document.head.appendChild(st);
    ov = document.createElement("div");
    ov.id = "kc-ov";
    ov.setAttribute("aria-live", "polite");
    ov.innerHTML = `<div class="bar t"></div><div class="bar b"></div><div class="ban"></div>` +
      `<div class="card"><div class="lbl"></div><div class="who"></div><div class="wpn"></div><div class="hs">HEADSHOT</div></div>` +
      `<div class="skip"></div><div class="prog"></div><div class="fl"></div>`;
    document.body.appendChild(ov);
    ov._ban = ov.querySelector(".ban"); ov._lbl = ov.querySelector(".lbl");
    ov._who = ov.querySelector(".who"); ov._wpn = ov.querySelector(".wpn");
    ov._hs = ov.querySelector(".hs"); ov._skip = ov.querySelector(".skip");
    ov._prog = ov.querySelector(".prog"); ov._fl = ov.querySelector(".fl");
    return ov;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function nameOf(slot) {
    const m = matchOf(sim());
    const a = m && m.actors[slot];
    if (!a) return "—";
    return a.kind === "human" ? "YOU" : (a.name || "—");
  }
  function weaponName(idx) {
    const id = intern.str(idx);
    const w = id && ctx.weapons ? ctx.weapons[id] : null;
    return (w && w.name ? w.name : id || "").toUpperCase();
  }
  let flashA = 0;
  function flash(a) { flashA = Math.max(flashA, a); }
  function overlayShow() {
    const o = overlayBuild();
    if (!o) return;
    const final = rp.kind === "final";
    o.classList.toggle("final", final);
    o._ban.textContent = final ? "FINAL KILL" : "KILLCAM";
    if (final) {
      o._lbl.textContent = "MATCH-WINNING KILL";
      o._who.innerHTML = `${esc(nameOf(rp.killer))}<span class="vs">▸</span>${esc(nameOf(rp.victim))}`;
    } else {
      o._lbl.textContent = "KILLED BY";
      o._who.textContent = nameOf(rp.killer);
    }
    const wn = weaponName(rp.weapon);
    o._wpn.textContent = rp.explosive ? (wn ? wn + " · EXPLOSIVE" : "EXPLOSIVE") : wn;
    o._hs.style.display = rp.head ? "block" : "none";
    const touch = !!ctx.touch || (typeof window !== "undefined" && "ontouchstart" in window && !matchMedia("(pointer:fine)").matches);
    let pad = false;
    try { const ps = navigator.getGamepads ? navigator.getGamepads() : null; if (ps) for (const g of ps) if (g && g.connected) pad = true; } catch (e) { /* none */ }
    o._skip.textContent = touch ? "TAP TO SKIP" : pad ? "PRESS A TO SKIP" : "PRESS SPACE TO SKIP";
    o.style.display = "block";
    document.body.classList.add("kc-on");
  }
  function overlayUpdate(dt, isPaused) {
    if (!ov) return;
    const span = rp.endT - rp.startT;
    const k = span > 0 ? Math.min(1, (rp.t - rp.startT) / span) : 1;
    ov._prog.style.width = (k * 100).toFixed(1) + "%";
    if (!isPaused && flashA > 0) flashA = Math.max(0, flashA - dt / FLASH_S);
    ov._fl.style.opacity = (flashA * 0.55).toFixed(3);
  }
  function overlayHide() {
    if (!ov) return;
    ov.style.display = "none";
    flashA = 0;
    ov._fl.style.opacity = "0";
    if (typeof document !== "undefined") document.body.classList.remove("kc-on");
  }

  // ===================================================== held mission:end
  // Boot routes each drained event batch through here before dispatch.
  function filterEvents(list) {
    if (releaseQueued && held) {
      releaseQueued = false;
      const h = held; held = null;
      if (failsafe) { clearTimeout(failsafe); failsafe = null; }
      const s = sim();
      if (s && s.epoch === heldEpoch) { list.push(h); released = h; }
    }
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.type !== "mission:end" || e === released) continue;   // never re-hold our own release
      const d = e.data;
      if (!d || !d.match || held) continue;            // campaign end: untouched
      if (d.match.result === "forfeit") continue;      // a quit is not a kill
      const s = sim();
      if (!matchOf(s) || s !== recSim) continue;
      held = e; heldEpoch = s.epoch;
      list.splice(i, 1); i--;
      if (mode === "replay") endReplay();
      mode = "finalWait"; finalWaitT = 0;
      if (failsafe) clearTimeout(failsafe);
      failsafe = setTimeout(() => {
        failsafe = null;
        if (!held) return;
        const h = held; held = null;
        if (replaying()) endReplay();
        mode = "idle";
        const s2 = sim();
        if (s2 && s2.epoch === heldEpoch && ctx.bridge) ctx.bridge.dispatch([h]);
      }, FINAL_FAILSAFE_MS);
    }
    return list;
  }
  function releaseHeld() { if (held) releaseQueued = true; }

  // ================================================================ update
  function update(dt) {
    record();
    const s = sim();
    const st = s && s.state;
    const p = st && st.player;
    const ms = st && st.match;
    const camera = ctx.camera;

    // ---- final kill cam ---------------------------------------------------
    if (mode === "finalWait") {
      if (!paused()) finalWaitT += dt;
      if (finalPendingT >= 0 && (finalWaitT >= FINAL_WAIT_MAX)) freezeFinal();
      if (finalPendingT < 0) {
        const kcOff = ctx.settings && ctx.settings.killcam === "off";   // [integration v147]
        const ok = !kcOff && finalKill.valid && camera && startReplay("final", finalClip, finalKill, Infinity);
        if (!ok) { mode = "idle"; release(); releaseHeld(); return false; }
      } else {
        // the post-roll is still arriving: keep whatever view we have
        if (driving && camera) camera.updateMatrixWorld();
        return driving;
      }
    }
    if (mode === "final" || mode === "finalHold") {
      if (!held && mode === "final") { endReplay(); mode = "idle"; release(); return false; }
      if (mode === "final") {
        driveReplay(dt);
        if (skipWanted()) { stats.skips++; rp.done = true; }
        if (rp.done && (rp.holdT >= 0.35 || rp.t < rp.endT)) {
          // hand over: the replay's last frame stays up (frozen) under the
          // result banner while the held mission:end runs the end flow
          overlayHide();
          mode = "finalHold";
          releaseHeld();
        }
        return true;
      }
      // finalHold: freeze the last frame until the match is left
      if (!ms || ms.phase !== "ended") { endReplay(); mode = "idle"; release(); return false; }
      buildGhost(false);
      rp.anDt = 0;
      if (camera) { camera.position.set(camPos[0], camPos[1], camPos[2]); camera.lookAt(camLook[0], camLook[1], camLook[2]); camera.updateMatrixWorld(); }
      return true;
    }

    // ---- death replay -------------------------------------------------------
    if (mode === "replay") {
      const stop = !camera || !p || p.alive || !ms || !LIVE_PHASES.has(ms.phase) || !rp.buf;
      if (stop) {
        endReplay(); mode = "idle";
        if (!p || p.alive || !ms || !LIVE_PHASES.has(ms.phase)) { release(); return false; }
      } else {
        driveReplay(dt);
        if (skipWanted()) { stats.skips++; toOrbit(); }
        else if (rp.done && rp.holdT >= HOLD_MAX) toOrbit();   // overtime: no respawn coming
        else return true;
      }
    }

    const shouldDrive = !!(camera && p && !p.alive && ms && LIVE_PHASES.has(ms.phase));
    if (!shouldDrive) {
      if (mode !== "idle" && (!p || p.alive || !ms || !LIVE_PHASES.has(ms.phase))) mode = "idle";
      release();
      return false;
    }

    if (mode === "deathWait") {
      if (!paused()) beatT += dt;
      if (beatT >= DEATH_BEAT) {
        const m = matchOf(s);
        const you = m && m.actors[0];
        const budget = you && you.respawnAtT >= 0 ? you.respawnAtT - st.time - RESPAWN_MARGIN : Infinity;
        const kill = { t: rp.killT, a: rp.killer, v: 0, head: rp.head, weapon: rp.weapon };
        if ((ctx.settings && ctx.settings.killcam === "off") || !startReplay("death", ring, kill, budget)) mode = "orbit";
        else return driveReplay(0);
      }
    }
    return orbitCam(dt, s, camera);
  }

  function toOrbit() {
    endReplay();
    mode = "orbit";
    const c = ctx.camera;
    fromPos = c ? [c.position.x, c.position.y, c.position.z] : null;
    since = 0;
  }

  // ---- the orbit death cam (pre-replay behaviour) ----------------------------
  // Where the killer is RIGHT NOW (live body), else where they fell. m.posOf
  // returns the LIVE body array — safe to read per frame, never to store.
  function killerPos(m) {
    if (m == null || killerActorId == null) return null;
    const a = m.actors && m.actors[killerActorId];
    if (!a) return null;
    const p = m.posOf(a);
    return Array.isArray(p) ? p : null;
  }

  function orbitCam(dt, s, camera) {
    if (!driving) {
      acquire();
      if (!fromPos) fromPos = [camera.position.x, camera.position.y, camera.position.z];
    }
    // boot.js zeroes the sim accumulator while paused but still calls
    // viewUpdates with the real frame dt: keep ownership, stop advancing.
    if (paused()) { camera.updateMatrixWorld(); return true; }

    since += dt;
    orbit += dt * ORBIT_RATE;

    const m = matchOf(s);
    const kp = killerPos(m);
    const anchor = kp || deathPos || [camera.position.x, 0, camera.position.z];
    const focus = [anchor[0], (anchor[1] || 0) + FOCUS_Y, anchor[2]];

    let bx = 1, bz = 0;
    if (kp && deathPos) {
      const d = sub(deathPos, kp);
      const L = len2(d);
      if (L > 0.5) { bx = d[0] / L; bz = d[2] / L; }
    }
    const ca = Math.cos(orbit), sa = Math.sin(orbit);
    const dirX = bx * ca - bz * sa;
    const dirZ = bx * sa + bz * ca;

    const dist = kp ? DIST : NO_KILLER_DIST;
    let wantX = focus[0] + dirX * dist;
    let wantY = focus[1] + HEIGHT;
    let wantZ = focus[2] + dirZ * dist;

    const world = s && s.world;
    if (world && world.raycast) {
      const vx = wantX - focus[0], vy = wantY - focus[1], vz = wantZ - focus[2];
      const L = Math.hypot(vx, vy, vz) || 1;
      const hit = world.raycast(focus, [vx / L, vy / L, vz / L], L);
      if (hit && hit.dist != null && hit.dist < L) {
        const t = Math.max(NEAR_CLAMP, hit.dist - SKIN) / L;
        wantX = focus[0] + vx * t;
        wantY = focus[1] + vy * t;
        wantZ = focus[2] + vz * t;
      }
    }
    if (world && world.supportAt) {
      const g = world.supportAt(wantX, wantZ, wantY, 0.3);
      if (Number.isFinite(g) && wantY < g + 0.45) wantY = g + 0.45;
    }

    let k = 1;
    if (fromPos && since < EASE_S) {
      const u = since / EASE_S;
      k = u * u * (3 - 2 * u); // smoothstep
    }
    _p[0] = fromPos ? fromPos[0] + (wantX - fromPos[0]) * k : wantX;
    _p[1] = fromPos ? fromPos[1] + (wantY - fromPos[1]) * k : wantY;
    _p[2] = fromPos ? fromPos[2] + (wantZ - fromPos[2]) * k : wantZ;

    camera.position.set(_p[0], _p[1], _p[2]);
    camera.lookAt(focus[0], focus[1], focus[2]);
    // REQUIRED: viewmodel.js's updateMatrixWorld sits below its !rig.visible
    // early-out, so nothing else refreshes the camera while this drives.
    camera.updateMatrixWorld();
    return true;
  }

  // ======================================================= soldiers drive
  // Boot calls this INSTEAD of soldiers.update(dt, alpha). Returns false when
  // no replay is on screen (boot then runs the normal live update).
  function driveSoldiers(soldiers, dt) {
    const on = (mode === "replay" || mode === "final" || mode === "finalHold") && ghostState.bots === ghostBots && ghostBots.length;
    if (!on || !soldiers) return false;
    soldiersRef = soldiers;
    const liveSim = ctx.sim;
    ctx.sim = () => ghostSim;
    try { soldiers.update(rp.anDt, 1); }
    finally { ctx.sim = liveSim; }
    if (soldiers._actors) {
      const kid = ghosts[rp.killer] ? ghosts[rp.killer].id : -1;
      const rec = soldiers._actors.get(kid);
      if (rec && rec.actor && rec.actor.root) rec.actor.root.visible = !rp.hideKiller;
    }
    return true;
  }

  return {
    attach,
    update,
    filterEvents,
    driveSoldiers,
    bind(t) {
      if (!t) return;
      if (t.fx) fxRef = t.fx;
      if (t.audio) audioRef = t.audio;
      if (t.soldiers) soldiersRef = t.soldiers;
    },
    isActive() { return driving; },
    isReplaying() { return mode === "replay" || mode === "final"; },
    skip() { if (replaying()) { skipReq = true; rp.wall = Math.max(rp.wall, SKIP_ARM); } },
    reset() {
      if (replaying() || mode === "finalHold") endReplay();
      release();
      mode = "idle";
      killerActorId = null; deathPos = null; fromPos = null; since = 0; orbit = 0;
      // a held end belongs to the old match: drop it (a new match is starting)
      held = null; releaseQueued = false;
      if (failsafe) { clearTimeout(failsafe); failsafe = null; }
      recSim = null;
    },
    // read-only surface for the HUD and for automated checks
    state() {
      return {
        active: driving, mode, killerActorId, deathPos, since,
        replay: rp.buf ? {
          kind: rp.kind, killer: rp.killer, victim: rp.victim, t: +(rp.t - rp.killT).toFixed(3),
          startRel: +(rp.startT - rp.killT).toFixed(3), endRel: +(rp.endT - rp.killT).toFixed(3),
          wall: +rp.wall.toFixed(3), slow: rp.slow, done: rp.done, explosive: rp.explosive,
          hideKiller: rp.hideKiller, ghosts: ghostBots.length,
        } : null,
        held: !!held,
        lastKill: lastKill.valid ? { t: lastKill.t, a: lastKill.a, v: lastKill.v } : null,
        finalKill: finalKill.valid ? { t: finalKill.t, a: finalKill.a, v: finalKill.v } : null,
        stats: {
          ...stats,
          recAvgMs: stats.samples ? +(stats.recMs / stats.samples).toFixed(4) : 0,
          bytes: ring.bytes + finalClip.bytes,
          ringSpan: ring.count ? +(ring.newestT() - ring.oldestT()).toFixed(2) : 0,
        },
      };
    },
  };
}
