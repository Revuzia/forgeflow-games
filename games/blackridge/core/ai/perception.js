// core/ai/perception.js [A5→W3] — awareness meter (0→1) + night light-factor,
// hearing table (updates lastKnown ONLY — never a wallhack), LOS
// (combat_spec §5.1–5.2; architecture §3.9). THREE-free, deterministic (all
// rolls from the passed rngAi stream). Frozen signature perceive(...).
//
// W3 (PVP_BUILD_PLAN Part 4.1): generalised from "the player" to a TARGET
// LIST. Candidates come from sim.match.livingEnemyBodiesOf(bot); when no
// match driver is present the list falls back to [S.player], so every
// existing single-target battery sees the old behaviour. Awareness is
// metered PER CANDIDATE in bot.percept.byTarget (same fill formula); the
// bot's target is argmax(awareness) WITH HYSTERESIS (pvp_design §7.3.3):
// swap only if the challenger exceeds the incumbent by ≥0.25, or the
// incumbent has been unseen ≥2.0 s, or the incumbent is dead — and never
// more than once per 2.0 s except on the incumbent's death.
//
// Cost control (plan R2, all selftest-asserted):
//   - scalar prefilter (distance > max detect range, or facingFactor 0)
//     rejects a candidate before any raycast;
//   - round-robin: ≤2 LOS candidates per bot per perceive, priority to the
//     current target then the nearest — with INTERVAL-CORRECT awareness
//     fill (a skipped candidate accumulates its interval and fills for the
//     whole gap on its next evaluation, so the meter is not rate-halved);
//   - global MAX_LOS_PER_TICK = 12 across all bots (sim._losb budget).
//
// Awareness (§5.1): fill = 2.5/s × distFactor × facingFactor × lightFactor ×
// stanceFactor × speedFactor; decay 0.25/s with no stimulus; 0.5 →
// INVESTIGATE, 1.0 → confirmed (botfsm rolls the latched reaction).
// detectRange = 18 + 62 × light (×1.2 while the bot is in 'alert' — R17).
// Muzzle flash: candidate fired ≤1.2 s ago → effective light 1.0 within
// 120 m LOS (flashes are information both ways).
// Hearing (§5.2): caps awareness at 0.85 — a bot must SEE a target (or be
// hit) to confirm. Being hit = instant awareness 1.0 toward the origin
// sector (±4 m fuzz), attributed to bot.lastHitBy when the sim provides it
// (else the current target / nearest candidate — flagged to W1).
//
// noTarget (sim.flags.noTarget): the PLAYER does not exist to perception —
// keeps A1's ballistic probes clean, and is the C14 warm-up freeze lever.

const BASE_FILL = 2.5;
const DECAY_PER_S = 0.25;
const HEARD_CAP = 0.85;
const FLASH_WINDOW_S = 1.2;
const FLASH_RANGE_M = 120;

// plan R2 / AC-47: global LOS-candidate budget per sim tick, and the
// per-bot round-robin slice. Frozen numbers — a lane that needs a change
// requests it, it does not make it.
export const MAX_LOS_PER_TICK = 12;
const LOS_PER_BOT = 2;
// hysteresis (pvp_design §7.3.2-3, plan AC-36)
const SWITCH_MARGIN = 0.25;
const LOST_S = 2.0;
const SWITCH_DWELL_S = 2.0;

export function detectRange(light, alert) {
  return (18 + 62 * Math.min(1, Math.max(0, light))) * (alert ? 1.2 : 1);
}

export function lightFactor(light) {
  return 0.30 + 0.70 * Math.min(1, Math.max(0, light));
}

// facing: 1.0 inside the 110° cone; 0.35 in the 110–160° periphery (≤12 m
// only); 0 behind. `ang` = |angle between facing and to-target| in radians.
export function facingFactor(ang, dist) {
  const HALF_CONE = (110 / 2) * Math.PI / 180;   // 0.9599
  const HALF_PERI = (160 / 2) * Math.PI / 180;   // 1.3963
  if (ang <= HALF_CONE) return 1.0;
  if (ang <= HALF_PERI && dist <= 12) return 0.35;
  return 0;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function botEye(bot) {
  return [bot.pos[0], bot.pos[1] + (bot.stance === "crouch" ? 1.10 : 1.62), bot.pos[2]];
}

// candidate list: the match facade owns "who is an enemy of whom".
// Resolution order (exported — botfsm's think-cadence shares it):
//   1. sim.match.livingEnemyBodiesOf(bot) — the arch §5.2 contract surface;
//   2. sim.match.m.livingEnemiesOf(actor) + m.bodyOf — W1's shipped facade;
//   3. bot.team versus sim.state team ints (roster.bindBody mirrors);
//   4. [S.player] — campaign / probes / single-target batteries, as before.
const _ebScratch = [];
export function enemyBodiesOf(sim, bot) {
  const m = sim.match;
  if (m && typeof m.livingEnemyBodiesOf === "function") return m.livingEnemyBodiesOf(bot);
  if (m && m.m && typeof m.m.livingEnemiesOf === "function" && typeof m.m.actorOf === "function") {
    const actor = m.m.actorOf(bot.id);
    if (actor) {
      const list = m.m.livingEnemiesOf(actor);
      _ebScratch.length = 0;
      for (let i = 0; i < list.length; i++) {
        const b = m.m.bodyOf(list[i]);
        if (b && b.alive) _ebScratch.push(b);
      }
      return _ebScratch;
    }
  }
  const S = sim.state;
  if (bot.team != null) {
    _ebScratch.length = 0;
    if (S.player && S.player.alive && S.player.team != null && S.player.team !== bot.team) _ebScratch.push(S.player);
    for (const ob of S.bots) {
      if (!ob.alive || ob === bot) continue;
      if (ob.team != null && ob.team !== bot.team) _ebScratch.push(ob);
    }
    return _ebScratch;
  }
  const p = S.player;
  return p ? [p] : [];
}

function whoOf(sim, body) { return body === sim.state.player ? "P" : body.id; }

function mkRec(who, t, body) {
  return {
    who,
    awareness: 0, lastKnown: null, heardAt: null, heardKind: null,
    lastSeenT: -9, lastHeardT: -9, firstSeenT: -1, seen: false,
    tgtYaw: 0,                       // target yaw AS OF THE LAST SIGHTING (Part 12.1)
    lastEvalT: t,                    // interval-correct fill anchor
    prevShotT: (body.weapon && body.weapon.lastShotT != null) ? body.weapon.lastShotT : -9,
    prevReloading: false, lastSlideBumpT: -9,
    staticRef: null, staticSinceT: t, // lastKnown-stability (bot-target grenades)
  };
}

function losBudget(sim) {
  let b = sim._losb;
  if (!b) b = sim._losb = { t: -1, n: 0, peak: 0 };
  const t = sim.state.time;
  if (b.t !== t) { b.t = t; b.n = 0; }
  return b;
}

export function perceive(bot, sim, world, dt, rngAi) {
  const S = sim.state;
  const t = S.time;
  if (!bot.percept) {
    bot.percept = {
      // mirror of the CURRENT target's record (frozen shape — external
      // readers and botfsm's act() read these, never byTarget directly)
      target: null, targetActor: null, targetBody: null,
      seesTarget: false,
      seesPlayer: false,        // ALIAS kept: (target === 'P' && seesTarget)
      lastKnown: null, heardAt: null, heardKind: null,
      firstSeenT: -1, awareness: 0, lastSeenT: -9, lastHeardT: -9,
      byTarget: {},
      lastHitWho: null,
      prevHitT: bot.lastHitT != null ? bot.lastHitT : -9,
      _switchT: -9, _rr: 0,
    };
  }
  const P = bot.percept;
  const noTarget = !!(sim.flags && sim.flags.noTarget);

  // ---- candidate list (the player is skipped entirely under noTarget)
  const listRaw = enemyBodiesOf(sim, bot);
  const player = S.player;
  const cands = []; // { body, who, rec, d, hd, ang, facing, eye-relative }
  const whoSet = new Set();
  const eye = botEye(bot);
  for (let i = 0; i < listRaw.length; i++) {
    const body = listRaw[i];
    if (!body || !body.alive) continue;
    if (body === player && noTarget) continue;
    const who = whoOf(sim, body);
    if (who === bot.id) continue;
    let rec = P.byTarget[who];
    if (!rec) rec = P.byTarget[who] = mkRec(who, t, body);
    cands.push({ body, who, rec });
    whoSet.add(who);
  }

  if (!cands.length) {
    // nobody to perceive: everything decays (old noTarget / player-dead path)
    for (const k in P.byTarget) {
      const r = P.byTarget[k];
      r.awareness = Math.max(0, r.awareness - DECAY_PER_S * dt);
      r.seen = false;
      r.lastEvalT = t;
    }
    P.seesTarget = false; P.seesPlayer = false; P.targetBody = null;
    if (P.target != null && P.byTarget[P.target]) P.awareness = P.byTarget[P.target].awareness;
    else P.awareness = Math.max(0, P.awareness - DECAY_PER_S * dt);
    return;
  }

  // ---- per-candidate geometry (scalar, no raycasts)
  for (const c of cands) {
    const body = c.body;
    const chestY = body.pos[1] + (body.stance === "crouch" ? 0.75 : 1.05);
    const dx = body.pos[0] - eye[0], dz = body.pos[2] - eye[2];
    c.dx = dx; c.dz = dz; c.chestY = chestY;
    c.d = Math.hypot(dx, chestY - eye[1], dz);
    const toYaw = Math.atan2(-dx, -dz);
    c.ang = Math.abs(angDiff(toYaw, bot.yaw));
    c.facing = facingFactor(c.ang, c.d);
    c.stim = false;
  }

  // ---- hearing pass (scalar, ALL candidates — hearing works through walls)
  const hear = (rec, kind, pos, bump) => {
    rec.heardAt = pos;
    rec.heardKind = kind;
    rec.lastHeardT = t;
    if (!rec.lastKnown || t - rec.lastSeenT > 0.3) rec.lastKnown = pos;
    rec.awareness = Math.max(rec.awareness, Math.min(HEARD_CAP, rec.awareness + bump));
  };
  for (const c of cands) {
    const body = c.body, rec = c.rec, d = c.d;
    // gunshot: 300 m alert / ≤120 m accurate; fuzz ±6 m beyond 120
    const shotT = (body.weapon && body.weapon.lastShotT != null) ? body.weapon.lastShotT : -9;
    if (shotT > rec.prevShotT) {
      rec.prevShotT = shotT;
      if (d <= 300) {
        let pos = body.pos.slice();
        if (d > 120) {
          pos = [pos[0] + (rngAi() * 2 - 1) * 6, pos[1], pos[2] + (rngAi() * 2 - 1) * 6];
        }
        hear(rec, "gunshot", pos, HEARD_CAP); // unmistakable at night
        c.stim = true;
      }
    }
    // footsteps (continuous): sprint 14 m, walk 7 m, crouch-walk 2.5 m; ±3 m
    const hspeed = Math.hypot(body.vel[0], body.vel[2]);
    const grounded = body.grounded !== false; // bots are ground-locked
    if (grounded && hspeed > 0.8) {
      const r = hspeed >= 5.5 ? 14 : (body.stance === "crouch" ? 2.5 : 7);
      if (d <= r) {
        const fz = body.stance === "crouch" ? 2 : 3;
        const pos = [body.pos[0] + (rngAi() * 2 - 1) * fz, body.pos[1],
                     body.pos[2] + (rngAi() * 2 - 1) * fz];
        hear(rec, "steps", pos, 2.0 * (1 - d / r) * dt);
        c.stim = true;
      }
    }
    // reload: 10 m (edge-triggered)
    const reloading = body.weapon && body.weapon.state === "reloading";
    if (reloading && !rec.prevReloading && d <= 10) {
      hear(rec, "reload", [body.pos[0] + (rngAi() * 2 - 1) * 2, body.pos[1],
                           body.pos[2] + (rngAi() * 2 - 1) * 2], 0.5);
      c.stim = true;
    }
    rec.prevReloading = !!reloading;
    // slide / mantle: 12 m (rate-limited 1 s) — player-only movement
    const pm = body._m || null;
    if (pm && (pm.sliding || pm.mantle) && d <= 12 && t - rec.lastSlideBumpT > 1.0) {
      rec.lastSlideBumpT = t;
      hear(rec, "slide", [body.pos[0] + (rngAi() * 2 - 1) * 3, body.pos[1],
                          body.pos[2] + (rngAi() * 2 - 1) * 3], 0.5);
      c.stim = true;
    }
  }
  // enemy grenade bounce/land: 20 m, exact (attributed to the thrower)
  const grenades = sim.internal && sim.internal.grenades;
  if (grenades) {
    for (let i = 0; i < grenades.length; i++) {
      const g = grenades[i];
      if ((!g.bounced && !g.landed) || !whoSet.has(g.who)) continue;
      const gd = Math.hypot(g.pos[0] - eye[0], g.pos[2] - eye[2]);
      if (gd <= 20) {
        for (const c of cands) {
          if (c.who !== g.who) continue;
          hear(c.rec, "grenade", g.pos.slice(), 0.6);
          c.stim = true;
          break;
        }
      }
    }
  }

  // ---- being hit: instant awareness 1.0 toward the origin sector.
  // Attribution: sim-provided lastHitBy when present (W1), else the current
  // target, else the nearest candidate — never a wallhack: the position is
  // fuzzed ±4 m into a sector.
  if (bot.lastHitT != null && bot.lastHitT > P.prevHitT) {
    P.prevHitT = bot.lastHitT;
    let hitC = null;
    if (bot.lastHitBy != null && whoSet.has(bot.lastHitBy)) {
      for (const c of cands) if (c.who === bot.lastHitBy) { hitC = c; break; }
    }
    if (!hitC && P.target != null) {
      for (const c of cands) if (c.who === P.target) { hitC = c; break; }
    }
    if (!hitC) {
      let bd = Infinity;
      for (const c of cands) if (c.d < bd) { bd = c.d; hitC = c; }
    }
    if (hitC) {
      const rec = hitC.rec, body = hitC.body;
      rec.awareness = 1.0;
      rec.lastKnown = [body.pos[0] + (rngAi() * 2 - 1) * 4, body.pos[1],
                       body.pos[2] + (rngAi() * 2 - 1) * 4];
      hitC.stim = true;
      if (rec.firstSeenT < 0) rec.firstSeenT = t;
      P.lastHitWho = hitC.who;
    }
  }

  // ---- sight pass: scalar prefilter → round-robin ≤2 per bot, global ≤12.
  // Prefilter rejects (facing 0 or beyond max detect range) are also the
  // decay path for a candidate the bot cannot possibly see.
  const alert = bot.state === "alert";
  const maxRange = detectRange(1, alert);
  const survivors = [];
  for (const c of cands) {
    if (c.facing === 0 || c.d > maxRange) {
      // cannot see: decay for its accumulated interval (unless heard now)
      const iv = Math.min(0.5, Math.max(0, t - c.rec.lastEvalT));
      if (!c.stim) c.rec.awareness = Math.max(0, c.rec.awareness - DECAY_PER_S * iv);
      c.rec.seen = false;
      c.rec.lastEvalT = t;
      continue;
    }
    survivors.push(c);
  }
  // priority: current target first, then nearest (deterministic tiebreak)
  survivors.sort((a, b) => {
    const at = a.who === P.target ? 0 : 1, bt = b.who === P.target ? 0 : 1;
    if (at !== bt) return at - bt;
    return (a.d - b.d) || (String(a.who) < String(b.who) ? -1 : 1);
  });
  const budget = losBudget(sim);
  let slots = LOS_PER_BOT;
  // round-robin offset so the SAME two candidates are not starved forever
  // when survivors > slots (rotates by one each perceive)
  if (survivors.length > slots) {
    const fixed = survivors[0].who === P.target ? 1 : 0; // target always kept
    const rest = survivors.slice(fixed);
    const off = P._rr % rest.length;
    P._rr = (P._rr + 1) % 997;
    const rot = rest.slice(off).concat(rest.slice(0, off));
    survivors.length = fixed;
    for (const r of rot) survivors.push(r);
  }
  for (const c of survivors) {
    const rec = c.rec, body = c.body;
    if (slots <= 0 || budget.n >= MAX_LOS_PER_TICK) {
      // budget-skipped: leave the meter and lastEvalT untouched — the next
      // evaluation fills/decays for the WHOLE accumulated interval.
      continue;
    }
    slots--;
    budget.n++;
    if (budget.n > budget.peak) budget.peak = budget.n;
    const iv = Math.min(0.5, Math.max(1 / 60, t - rec.lastEvalT));
    rec.lastEvalT = t;

    // light at the TARGET's position (+ muzzle-flash override)
    let L = sim.nav && sim.nav.lightAt ? sim.nav.lightAt(body.pos[0], body.pos[2]) : 0.5;
    const shotT = (body.weapon && body.weapon.lastShotT != null) ? body.weapon.lastShotT : -9;
    const flash = t - shotT <= FLASH_WINDOW_S && c.d <= FLASH_RANGE_M;

    const headY = body.pos[1] + (body.stance === "crouch" ? 1.02 : 1.55);
    const losA = [body.pos[0], c.chestY, body.pos[2]];
    const losB = [body.pos[0], headY, body.pos[2]];
    const visible = c.facing > 0 &&
      (!world.losBlocked(eye, losA) || !world.losBlocked(eye, losB));
    if (flash && visible) L = 1.0;

    const range = detectRange(L, alert);
    const distFactor = Math.min(1, Math.max(0, 1 - c.d / range));

    if (visible && distFactor > 0) {
      const pm = body._m || null;
      const sliding = !!(pm && pm.sliding);
      const hspeed = Math.hypot(body.vel[0], body.vel[2]);
      const stance = body.stance === "crouch" ? 0.6 : (sliding ? 1.2 : 1.0);
      const speed = 0.7 + 0.3 * Math.min(1, hspeed / 6.4);
      const fill = BASE_FILL * distFactor * c.facing * lightFactor(L) * stance * speed;
      rec.awareness = Math.min(1, rec.awareness + fill * iv);
      rec.lastKnown = body.pos.slice();
      rec.lastSeenT = t;
      rec.tgtYaw = body.yaw != null ? body.yaw : rec.tgtYaw;
      rec.seen = true;
      c.stim = true;
    } else {
      rec.seen = false;
      if (!c.stim) rec.awareness = Math.max(0, rec.awareness - DECAY_PER_S * iv);
    }
    if (rec.seen && rec.awareness >= 1 && rec.firstSeenT < 0) rec.firstSeenT = t;

    // lastKnown-stability tracking (bot-target grenade eligibility)
    if (rec.lastKnown) {
      if (!rec.staticRef ||
          Math.hypot(rec.lastKnown[0] - rec.staticRef[0], rec.lastKnown[2] - rec.staticRef[2]) > 2.5) {
        rec.staticRef = rec.lastKnown.slice();
        rec.staticSinceT = t;
      }
    }
  }

  // ---- target selection: argmax awareness with hysteresis + 2 s dwell
  let inc = null;
  if (P.target != null && whoSet.has(P.target)) {
    for (const c of cands) if (c.who === P.target) { inc = c; break; }
  }
  let chall = null;
  for (const c of cands) {
    if (inc && c.who === inc.who) continue;
    if (!chall || c.rec.awareness > chall.rec.awareness) chall = c;
  }
  let next = inc;
  if (!inc) {
    // no valid incumbent (dead / gone): take the best candidate immediately
    if (chall && chall.rec.awareness > 0) next = chall;
    else next = chall; // even at 0 awareness: track SOMEONE as the focus
    P._switchT = t;
  } else if (chall && t - P._switchT >= SWITCH_DWELL_S) {
    const ca = chall.rec.awareness, ia = inc.rec.awareness;
    const lost = t - inc.rec.lastSeenT >= LOST_S;
    if (ca >= ia + SWITCH_MARGIN || (lost && ca > ia)) {
      next = chall;
      P._switchT = t;
    }
  }

  // ---- mirror the current target's record into the frozen top-level shape
  if (next) {
    const rec = next.rec;
    P.target = next.who;
    P.targetActor = next.body.actorId != null ? next.body.actorId : null;
    P.targetBody = next.body;
    P.seesTarget = !!rec.seen;
    P.awareness = rec.awareness;
    P.lastKnown = rec.lastKnown;
    P.heardAt = rec.heardAt;
    P.heardKind = rec.heardKind;
    P.lastSeenT = rec.lastSeenT;
    P.lastHeardT = rec.lastHeardT;
    P.firstSeenT = rec.firstSeenT;
  } else {
    P.target = null; P.targetActor = null; P.targetBody = null;
    P.seesTarget = false;
    P.awareness = Math.max(0, P.awareness - DECAY_PER_S * dt);
  }
  P.seesPlayer = P.target === "P" && P.seesTarget;
}
