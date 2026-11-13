// core/ai/equip_ai.js — how operators USE and REACT TO tactical / lethal
// equipment (core/sim/equipment.js). THREE-free, deterministic: every roll is
// from sim.rng.ai and is only drawn when equipment is actually in play, so a
// match where nobody carries any is byte-identical to before this lane.
//
// USE (think-rate, from botfsm.planCombat / the idle branch):
//   flash / concussion  a held position: the target went out of sight 1-12 s
//                       ago, 7-24 m away, and this bot is about to push it (hunt,
//                       squad push, last stand, objective run) or it has sat
//                       still >= 4 s -> lob it on the last-known spot, then push
//                       in behind the bang.
//   smoke               crossing open ground under fire on an objective run ->
//                       wall between the bot and the threat; holding an
//                       objective anchor under fire -> screen the anchor;
//                       falling back hurt -> smoke the retreat.
//   tripmine            idle at an anchor (or holding cover with no contact for
//                       4 s): plant one covering the most open FLANK or rear
//                       approach (3 knee-height probes), never two within 10 m.
// REACT (act-rate):
//   a flash / concussion it SEES land within 20 m: turn away (flash) or get
//   clear (concussion) — chance by skill; blinded: no sight (perception), drift
//   back, and a brief burst of blind fire at the last-known spot (chance by
//   skill, the squad fire token still required); a tripmine it NOTICES (10 m,
//   facing, line of sight, chance by skill): back out of its cone and shoot it.
//
// HARD RULE: nothing here is player-facing text.

import {
  EQUIP, throwTactical, plantFromBody, flashLevel, isBlind, stunLevel, enemyMines, liveCans, friendly,
} from "../sim/equipment.js";

const DEG = Math.PI / 180;
// per-skill chances (band.name): use a tactical when the moment comes, see a
// canister land and react, notice a planted mine, fire blind after a flash
const USE_P = { recruit: 0.25, regular: 0.6, hardened: 0.85, veteran: 1 };
const DODGE_P = { recruit: 0.15, regular: 0.45, hardened: 0.7, veteran: 0.85 };
const NOTICE_P = { recruit: 0.3, regular: 0.6, hardened: 0.85, veteran: 0.95 };
const BLINDFIRE_P = { recruit: 0.6, regular: 0.45, hardened: 0.3, veteran: 0.2 };
const pOf = (tbl, band) => tbl[band && band.name] != null ? tbl[band.name] : tbl.regular;

function hdist(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); }
function yawTo(from, to) { return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])); }
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function approachYaw(cur, des, maxStep) {
  const d = angDiff(des, cur);
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
function eyeOf(bot) { return [bot.pos[0], bot.pos[1] + (bot.stance === "crouch" ? 1.10 : 1.62), bot.pos[2]]; }

export function tacticalOf(bot) { return (bot && bot.kit && bot.kit.tactical) || null; }
/** frag eligibility gate: a tripmine kit's lethal is not a frag */
export function lethalIsFrag(bot) { return !(bot && bot.kit && bot.kit.lethal && bot.kit.lethal !== "frag"); }

// =========================================================== think-rate: USE
// o = { threat, seenNow, lostS, staticFor, objDrive, obj, pushOn, lastStand, solveArcPitch, setGoal }
export function planTactical(sim, bot, brain, t, rng, band, o) {
  // follow-through: push in behind a flash/concussion we threw
  if (brain.tacPush && t >= brain.tacPush.at) {
    const tp = brain.tacPush;
    brain.tacPush = null;
    if (t - tp.at < 2.5 && o.setGoal) { o.setGoal(tp.pos, true); brain.pushUntil = t + 3.0; }
  }
  const kind = tacticalOf(bot);
  if (!kind || (bot.tactical | 0) <= 0 || brain.gPlanned || t < (brain.tacNextT || 0)) return false;
  const threat = o.threat;
  if (!threat) return false;
  const d = hdist(bot.pos, threat);
  let target = null, delay = 0.45;
  if (kind === "flash" || kind === "stun") {
    const pushing = brain.huntOn || o.pushOn || o.lastStand ||
      (o.objDrive && o.obj && o.obj.anchor && hdist(o.obj.anchor, threat) < 14);
    if (!o.seenNow && o.lostS > 1.0 && o.lostS < 12 && d >= 7 && d <= 24 && (pushing || o.staticFor >= 4)) {
      // land it short of the spot when it is beyond a lob (the burst still
      // reaches; the canister rolls on) — max ~17 m at the bot throw speed
      const k = Math.min(d, 17) / d;
      const x = bot.pos[0] + (threat[0] - bot.pos[0]) * k, z = bot.pos[2] + (threat[2] - bot.pos[2]) * k;
      target = [x, sim.world.sphereGround(x, z), z];
    }
  } else if (kind === "smoke") {
    const underFire = t - (bot.lastHitT ?? -9) < 2.5 || o.seenNow;
    const obj = o.obj;
    if (underFire && d > 6) {
      let at = null;
      if (o.objDrive && obj && obj.anchor && hdist(bot.pos, obj.anchor) > 10) {
        // a wall between us and the shooter, ~45% of the way, at most 9 m out
        const k = Math.min(9, d * 0.45) / d;
        at = [bot.pos[0] + (threat[0] - bot.pos[0]) * k, 0, bot.pos[2] + (threat[2] - bot.pos[2]) * k];
      } else if (obj && obj.anchor && hdist(bot.pos, obj.anchor) < 6 && obj.priority >= 0.6) {
        // screen the objective from the shooter: 4 m off the anchor toward them
        const da = hdist(obj.anchor, threat) || 1;
        const k = Math.min(4, da * 0.5) / da;
        at = [obj.anchor[0] + (threat[0] - obj.anchor[0]) * k, 0, obj.anchor[2] + (threat[2] - obj.anchor[2]) * k];
      }
      if (at) target = [at[0], sim.world.sphereGround(at[0], at[2]), at[2]];
    }
  }
  if (!target) return false;
  if (rng() >= pOf(USE_P, band)) { brain.tacNextT = t + 8; return false; }
  const pitch = o.solveArcPitch(eyeOf(bot), target, EQUIP.BOT_THROW_V);
  if (pitch == null) { brain.tacNextT = t + 3; return false; }
  brain.gPlanned = true;
  brain.gKind = kind;
  brain.gReleaseT = t + delay;
  brain.gPitch = pitch;
  brain.gTarget = target;
  brain.tacNextT = t + 12;
  if (kind !== "smoke") brain.tacPush = { pos: [threat[0], threat[1], threat[2]], at: t + delay + EQUIP.FLASH.FUSE_S - 0.15 };
  return true;
}

/** Hurt and falling back: smoke between us and the threat (no roll beyond USE_P). */
export function retreatSmoke(sim, bot, brain, t, rng, band, threat, solveArcPitch) {
  if (tacticalOf(bot) !== "smoke" || (bot.tactical | 0) <= 0 || brain.gPlanned || t < (brain.tacNextT || 0) || !threat) return false;
  const d = hdist(bot.pos, threat);
  if (d < 5) return false;
  if (rng() >= pOf(USE_P, band)) { brain.tacNextT = t + 8; return false; }
  const k = Math.min(5, d * 0.4) / d;
  const x = bot.pos[0] + (threat[0] - bot.pos[0]) * k, z = bot.pos[2] + (threat[2] - bot.pos[2]) * k;
  const target = [x, sim.world.sphereGround(x, z), z];
  const pitch = solveArcPitch(eyeOf(bot), target, EQUIP.BOT_THROW_V);
  if (pitch == null) return false;
  brain.gPlanned = true; brain.gKind = "smoke"; brain.gReleaseT = t + 0.3;
  brain.gPitch = pitch; brain.gTarget = target; brain.tacNextT = t + 12;
  return true;
}

/** Called by the windup when brain.gKind is a tactical. */
export function releaseTactical(sim, bot, brain) {
  const kind = brain.gKind;
  brain.gKind = null;
  if (!kind || (bot.tactical | 0) <= 0) return false;
  const eye = eyeOf(bot);
  const org = [eye[0], eye[1] - 0.15, eye[2]];
  const yaw = yawTo(org, brain.gTarget);
  const cp = Math.cos(brain.gPitch), sp = Math.sin(brain.gPitch);
  const v = EQUIP.BOT_THROW_V;
  throwTactical(sim, bot.id, kind, org, [-Math.sin(yaw) * cp * v, sp * v, -Math.cos(yaw) * cp * v]);
  bot.tactical = Math.max(0, (bot.tactical | 0) - 1);
  return true;
}

// Plant a tripmine covering a flank. Idle at an anchor, or holding cover with
// no contact. Returns true when one went down.
export function planMine(sim, bot, brain, t, rng, band) {
  if (!(bot.kit && bot.kit.lethal === "claymore") || (bot.grenades | 0) <= 0) return false;
  if (!brain.arrived || bot.grounded === false) return false;
  if (brain.mineNextT == null) { brain.mineNextT = t + 2 + rng() * 4; return false; }
  if (t < brain.mineNextT) return false;
  const obj = bot._obj;
  if (obj && (obj.role === "attack" || obj.role === "carry" || obj.role === "escort" || obj.role === "return" || obj.role === "intercept")) return false;
  // never two of ours within 10 m
  const E = sim.internal.equip;
  if (E) for (const m of E.mines) if (m.who === bot.id && hdist(m.pos, bot.pos) < 10) { brain.mineNextT = t + 15; return false; }
  // flanks and rear of the facing we hold: the most open lane wins
  const base = brain.anchorYaw != null ? brain.anchorYaw : bot.yaw;
  const cands = [base + 90 * DEG, base - 90 * DEG, base + Math.PI];
  let best = null, bestD = 2.5;
  const org = [bot.pos[0], bot.pos[1] + 0.5, bot.pos[2]];
  for (const y of cands) {
    const dir = [-Math.sin(y), 0, -Math.cos(y)];
    const hit = sim.world.raycast(org, dir, 10);
    const open = hit ? hit.dist : 10;
    if (open > bestD) { bestD = open; best = y; }
  }
  brain.mineNextT = t + 20 + rng() * 10;
  if (best == null) return false;
  const m = plantFromBody(sim, bot.id, bot, best);
  if (!m) return false;
  bot.grenades = Math.max(0, (bot.grenades | 0) - 1);
  return true;
}

// ========================================================== think-rate: SEE
// Notice enemy tripmines in view (10 m, facing ±60°, line of sight). Rolled
// once per mine per bot.
export function noticeEquipment(sim, bot, brain, t, rng, band) {
  const mines = enemyMines(sim, bot.id);
  if (!mines || !mines.length) return;
  if (!brain.mineSeen) brain.mineSeen = {};
  if (isBlind(bot, t)) return;
  const eye = eyeOf(bot);
  for (const m of mines) {
    if (brain.mineSeen[m.id] != null) continue;
    const d = hdist(bot.pos, m.pos);
    if (d > 10) continue;
    if (Math.abs(angDiff(yawTo(bot.pos, m.pos), bot.yaw)) > 60 * DEG) continue;
    const c = [m.pos[0], m.pos[1] + 0.15, m.pos[2]];
    if (sim.world.losBlocked(eye, c)) continue;
    brain.mineSeen[m.id] = rng() < pOf(NOTICE_P, band);
  }
}

// ============================================================ act-rate: REACT
// Returns true when it OWNS this tick's cmd (botfsm.act returns right after).
// ctx = { squad, P, tb, dirOf }
export function react(sim, bot, brain, c, dt, t, rng, band, ctx) {
  // ---- blinded: drift back from where the fight was, maybe a blind burst
  const fl = flashLevel(bot, t);
  if (fl >= EQUIP.FLASH.BLIND_LVL) {
    if (brain.blindT0 !== bot.flashT0) {
      brain.blindT0 = bot.flashT0;
      const P = ctx.P;
      const hadTarget = P && P.lastKnown && t - P.lastSeenT < 1.5 && (bot.state === "combat" || bot.state === "suppress");
      brain.blindFire = !!(hadTarget && rng() < pOf(BLINDFIRE_P, band)) ? { at: P.lastKnown.slice(), until: t + 0.9 } : null;
      brain.blindYaw = brain.curYaw;
    }
    const bf = brain.blindFire;
    c.moveZ = -0.6; c.crouch = false; c.sprint = false;
    if (bf && t < bf.until && bot.weapon.mag > 0 && bot.weapon.state !== "reloading" && bot.weapon.state !== "switching") {
      const eye = eyeOf(bot);
      const ay = yawTo(eye, bf.at) + (rng() * 2 - 1) * 9 * DEG;
      const hl = Math.hypot(bf.at[0] - eye[0], bf.at[2] - eye[2]) || 1;
      const ap = Math.atan2(bf.at[1] + 1.1 - eye[1], hl) + (rng() * 2 - 1) * 4 * DEG;
      const sq = ctx.squad;
      const token = !sq || sq.holdsFire(bot.id) || (sq.requestToken && sq.requestToken(bot.id, ctx.P ? ctx.P.target : null));
      if (token) {
        brain.curYaw = ay;
        c.pitch = ap;
        const w = sim.weapons[bot.weapon.id];
        if (w && w.auto) c.fire = true; else { brain.semiToggle = !brain.semiToggle; c.fire = brain.semiToggle; }
      }
    } else {
      // stagger: the head swings off the line, slowly
      brain.blindYaw = brain.blindYaw == null ? brain.curYaw : brain.blindYaw + Math.sin(t * 3.1 + bot.id) * 0.9 * dt;
      brain.curYaw = approachYaw(brain.curYaw, brain.blindYaw, 2 * dt);
      c.pitch = -0.15;
    }
    c.yaw = brain.curYaw;
    bot.aimAt = null;
    return true;
  }

  // ---- a canister we SAW land: look away from a flash, clear a concussion
  if (brain.lookAwayUntil > t) {
    brain.curYaw = approachYaw(brain.curYaw, brain.lookAwayYaw, 11 * dt);
    c.yaw = brain.curYaw; c.pitch = 0;
    if (brain.lookAwayKind === "stun") { c.moveZ = 1; c.sprint = stunLevel(bot, t) <= 0; }
    else c.crouch = true;
    bot.aimAt = null;
    return true;
  }
  const cans = liveCans(sim);
  if (cans && cans.length && ((sim.state.tick + bot.id) % 4) === 0) {
    if (!brain.canSeen) brain.canSeen = {};
    const eye = eyeOf(bot);
    for (const cn of cans) {
      if (cn.kind === "smoke" || brain.canSeen[cn.id] != null) continue;
      if (friendly(sim, cn.who, bot.id)) continue;
      if (!(cn.bounced || cn.landed || cn.fuseLeft < 0.8)) continue;
      const d = Math.hypot(cn.pos[0] - eye[0], cn.pos[1] - eye[1], cn.pos[2] - eye[2]);
      if (d > 20) continue;
      if (Math.abs(angDiff(yawTo(bot.pos, cn.pos), brain.curYaw)) > 60 * DEG) continue;
      if (sim.world.losBlocked(eye, [cn.pos[0], cn.pos[1] + 0.1, cn.pos[2]])) continue;
      const go = rng() < pOf(DODGE_P, band);
      brain.canSeen[cn.id] = go;
      if (!go) continue;
      if (cn.kind === "stun" && d > EQUIP.STUN.RANGE_M + 1) continue;
      brain.lookAwayUntil = t + cn.fuseLeft + 0.25;
      brain.lookAwayYaw = yawTo(cn.pos, bot.pos);
      brain.lookAwayKind = cn.kind;
      return false; // starts next tick
    }
  }

  // ---- a noticed tripmine: back out of its cone and shoot it
  if (brain.mineSeen) {
    const mines = enemyMines(sim, bot.id);
    if (mines && mines.length) {
      const P = ctx.P;
      const fighting = P && P.seesTarget && t - P.lastSeenT <= 0.4;
      let near = null, nd = 1e9;
      for (const m of mines) {
        if (!brain.mineSeen[m.id]) continue;
        const d = hdist(bot.pos, m.pos);
        if (d < nd) { nd = d; near = m; }
      }
      if (near && nd < EQUIP.CLAYMORE.TRIGGER_R + 3 && !fighting) {
        const eye = eyeOf(bot);
        const cpos = [near.pos[0], near.pos[1] + 0.12, near.pos[2]];
        const ay = yawTo(eye, cpos);
        const hl = Math.hypot(cpos[0] - eye[0], cpos[2] - eye[2]) || 1;
        const ap = Math.atan2(cpos[1] - eye[1], hl);
        brain.curYaw = approachYaw(brain.curYaw, ay, 9 * dt);
        c.yaw = brain.curYaw; c.pitch = ap;
        // inside its cone and close: back away while aiming
        const fx = -Math.sin(near.yaw), fz = -Math.cos(near.yaw);
        const dx = bot.pos[0] - near.pos[0], dz = bot.pos[2] - near.pos[2];
        const inCone = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > Math.cos(50 * DEG);
        if (inCone && nd < EQUIP.CLAYMORE.TRIGGER_R + 1.2) c.moveZ = -1;
        const onTarget = Math.abs(angDiff(brain.curYaw, ay)) < 2.5 * DEG;
        const w = sim.weapons[bot.weapon.id];
        if (onTarget && w && bot.weapon.mag > 0 && bot.weapon.state !== "reloading" && bot.weapon.state !== "switching" &&
            !sim.world.losBlocked(eye, cpos)) {
          brain.semiToggle = !brain.semiToggle;
          c.fire = w.auto ? true : brain.semiToggle;
        } else if (bot.weapon.mag === 0 && bot.weapon.reserve > 0) c.reload = true;
        bot.aimAt = cpos;
        return true;
      }
    }
  }
  return false;
}
