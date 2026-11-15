// core/sim/melee.js [melee lane, 2026-11-13] — the QUICK KNIFE STRIKE.
//
// One verb, one rule, every combatant: the human (cmd.melee, key V / R3 / the
// MELEE touch button) and every opponent (bot.cmd.melee, written by botfsm's
// small melee block) run THIS code. THREE-free, deterministic (no RNG is drawn:
// target choice is a pure function of positions), JSON-safe state on the body.
//
// TIMELINE (sim seconds from the press that is accepted):
//   0.00 - 0.12   WINDUP   the knife comes across; LUNGE toward a locked target
//   0.12          STRIKE   one contact test (reach + cone + line of sight)
//   0.12 - 0.72   RECOVER  hands come back to the gun: no fire, no ADS, no
//                          reload start, no weapon switch, no sprint
// A melee press is buffered like every other verb (player.js §1.8, 0.35 s), so
// a press during a weapon switch or mid-air lands as soon as it is legal.
//
// LUNGE (sim-side magnetism, the same for everyone — never aim assist): at the
// press, the nearest ENEMY whose capsule centre is within REACH_M (2.6 m,
// horizontal) and inside a narrow CONE_DEG (28 deg half-angle) of the
// attacker's facing, with |dy| <= MAX_DY and clear line of sight eye->chest, is
// LOCKED. During the windup the attacker's horizontal velocity is replaced by
// a dash toward it that stops STOP_M (0.85 m) short, capped at LUNGE_V_MAX
// (14 m/s), integrated through the normal capsule mover (walls still stop
// you). The lunge never turns the view: the human's aim stays theirs.
//
// STRIKE: the target is the locked one if it still qualifies, else the best
// enemy inside STRIKE_M (1.45 m) and STRIKE_CONE_DEG (40 deg) with clear LOS.
// DAMAGE RULE (stated): from BEHIND — the attacker inside the victim's rear
// 130 deg arc (BACK_ARC_DEG 65 either side of straight behind) — the strike is
// LETHAL (one hit). From the FRONT or the side it deals FRONT_FRAC (55%) of the
// victim's max HP: two strikes kill from full health (sp 100 HP -> 55,
// pvp 110 HP -> 60.5) and regen (4.5-5 s delay) cannot intervene between two
// strikes 0.72 s apart. WHY two from the front: a one-hit knife at 0.72 s per
// swing beats every gun inside 2.6 m (the fastest gun TTK here is ~0.3 s but a
// lunge covers the gap the gun needs to aim); two hits keep the knife a FLANK
// and FINISHER tool (back-stab, empty mag, finish a wounded man) while a
// point-blank gunfight is still won by the gun. Friendly fire, spawn
// protection and the human's difficulty damage scale apply exactly as for
// bullets (damage.js gates; the back-stab amount is large enough that the
// difficulty scale cannot make it non-lethal).
//
// EVENT (additive to the frozen bridge vocabulary, one type, phased):
//   melee {who, phase:"swing", target|null, pos, dir}
//   melee {who, phase:"hit",   victim, pos(chest), dir, backstab, lethal}
//   melee {who, phase:"miss",  pos, dir, surface|null}   (surface = a wall the blade met)
// Kills are credited through damage.js with weaponId "knife" and melee:true on
// the death event (and on match.onActorDeath's ev) — the gun-game lane reads it.

import { applyDamage } from "./damage.js";

export const MELEE = {
  WINDUP_S: 0.12,
  RECOVER_S: 0.60,
  REACH_M: 2.6,
  CONE_DEG: 28,
  STRIKE_M: 1.45,
  STRIKE_CONE_DEG: 40,
  STOP_M: 0.85,
  LUNGE_V_MAX: 14.0,
  MAX_DY: 1.3,
  BACK_ARC_DEG: 65,
  FRONT_FRAC: 0.55,
  BACKSTAB_DMG: 1000,
  WEAPON_ID: "knife",
};

const DEG = Math.PI / 180;
const COS_CONE = Math.cos(MELEE.CONE_DEG * DEG);
const COS_STRIKE = Math.cos(MELEE.STRIKE_CONE_DEG * DEG);
const COS_BACK = Math.cos(MELEE.BACK_ARC_DEG * DEG);

function eyeY(body) { return body.stance === "crouch" ? 1.10 : 1.62; }
function chestY(body) { return body.stance === "crouch" ? 0.80 : 1.15; }

function bodyOf(sim, who) {
  if (who === "P") return sim.state.player;
  const bots = sim.state.bots;
  for (let i = 0; i < bots.length; i++) if (bots[i].id === who) return bots[i];
  return null;
}

function enemies(sim, aWho, a, bWho, b) {
  if (aWho === bWho) return false;
  if (sim.match && sim.match.sameTeam) return !sim.match.sameTeam(aWho, bWho);
  return (a.team | 0) !== (b.team | 0);
}

/** true while `body` is inside a melee (windup or recovery): no fire / ADS /
 *  reload start / switch / sprint. Pure read of JSON state. */
export function meleeBusy(body, t) {
  const s = body && body._melee;
  return !!(s && t < s.end - 1e-9);
}

/** true during the windup (the lunge window) only. */
export function meleeLunging(body, t) {
  const s = body && body._melee;
  return !!(s && !s.struck && t < s.strikeAt - 1e-9);
}

// Best qualifying enemy for (a) inside reach/cone, or null. Deterministic:
// lowest (distance + angular penalty), ties broken by iteration order (player
// first, then bots in spawn order — the sim's own fixed order).
function pick(sim, aWho, a, reach, cosCone, preferWho) {
  const world = sim.world;
  const fx = -Math.sin(a.yaw || 0), fz = -Math.cos(a.yaw || 0);
  const ex = a.pos[0], ey = a.pos[1] + eyeY(a), ez = a.pos[2];
  let best = null, bestScore = Infinity;
  const consider = (who, b) => {
    if (!b || !b.alive || !enemies(sim, aWho, a, who, b)) return;
    const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > reach) return;
    if (Math.abs(b.pos[1] - a.pos[1]) > MELEE.MAX_DY) return;
    // inside ~0.25 m the bearing is noise: overlapping capsules always qualify
    const c = d < 0.25 ? 1 : (dx * fx + dz * fz) / d;
    if (c < cosCone) return;
    const cy = b.pos[1] + chestY(b);
    if (world && world.losBlocked && world.losBlocked([ex, ey, ez], [b.pos[0], cy, b.pos[2]])) return;
    const score = d + (1 - c) * 2 - (who === preferWho ? 0.5 : 0);
    if (score < bestScore) { bestScore = score; best = who; }
  };
  consider("P", sim.state.player);
  const bots = sim.state.bots;
  for (let i = 0; i < bots.length; i++) consider(bots[i].id, bots[i]);
  return best;
}

/**
 * Start a melee for `who` if it is legal now. Returns true when it started.
 * Caller has already checked the input edge / buffer. `o.blocked` = a caller
 * rule (mantling, cooking a grenade, ...) that forbids the start.
 */
export function tryBeginMelee(sim, who, body, o) {
  const t = sim.state.time;
  if (!body || !body.alive || (o && o.blocked)) return false;
  if (meleeBusy(body, t)) return false;
  const w = body.weapon;
  // interrupts: a reload (pre- or post-commit; ammo already moved stays moved),
  // a shell reload (the shells in stay in), ADS (the machine drops it while busy)
  if (w && w.state === "reloading") {
    w.state = "idle"; w.stateT = 0;
    w._shellNext = null; w._shellPhase = null; w._shellEndAt = null;
    sim.emit("reload", { who, weaponId: w.id, phase: "done", duration: 0, canceled: true });
  }
  if (w && w.state === "firing") { w.state = "idle"; w.stateT = 0; }
  const target = pick(sim, who, body, MELEE.REACH_M, COS_CONE, null);
  body._melee = {
    t0: t,
    strikeAt: t + MELEE.WINDUP_S,
    end: t + MELEE.WINDUP_S + MELEE.RECOVER_S,
    target,          // locked lunge target ('P' | botId | null)
    struck: false,
    result: null,    // "hit" | "miss" after the strike
  };
  const fx = -Math.sin(body.yaw || 0), fz = -Math.cos(body.yaw || 0);
  sim.emit("melee", { who, phase: "swing", target, pos: body.pos.slice(), dir: [fx, 0, fz] });
  return true;
}

/**
 * Advance `who`'s melee by one tick: resolves the strike on the tick the windup
 * ends, clears the state when recovery ends. Returns the LUNGE velocity
 * [vx, vz] to impose this tick (windup only, target locked), else null.
 * Called by player.js BEFORE the capsule integrates (player and bots alike).
 */
export function stepMelee(sim, who, body, dt) {
  const s = body && body._melee;
  if (!s) return null;
  const t = sim.state.time;
  if (!body.alive) { body._melee = null; return null; }
  // stale (the body was not stepped through its strike tick — died, respawned,
  // teleported by a harness): drop it, never strike late
  if (!s.struck && t > s.strikeAt + 0.05) { body._melee = null; return null; }
  if (!s.struck && t >= s.strikeAt - 1e-9) {
    s.struck = true;
    strike(sim, who, body, s);
  }
  if (t >= s.end - 1e-9) { body._melee = null; return null; }
  if (s.struck || s.target == null) return null;
  // LUNGE toward the locked target (it may have moved / died / broken LOS: a
  // dead or missing target simply ends the dash, the strike still happens)
  const b = bodyOf(sim, s.target);
  if (!b || !b.alive) return null;
  const dx = b.pos[0] - body.pos[0], dz = b.pos[2] - body.pos[2];
  const d = Math.hypot(dx, dz);
  const gap = d - MELEE.STOP_M;
  if (gap <= 0.01 || d < 1e-6) return [0, 0];
  const left = Math.max(dt, s.strikeAt - t);          // seconds of windup left
  const v = Math.min(MELEE.LUNGE_V_MAX, gap / left);
  return [dx / d * v, dz / d * v];
}

function strike(sim, who, a, s) {
  const fx = -Math.sin(a.yaw || 0), fz = -Math.cos(a.yaw || 0);
  let victimWho = null;
  // the locked target keeps priority if it still qualifies at contact range
  victimWho = pick(sim, who, a, MELEE.STRIKE_M, COS_STRIKE, s.target);
  if (victimWho == null) {
    s.result = "miss";
    const ex = a.pos[0], ey = a.pos[1] + eyeY(a) - 0.25, ez = a.pos[2];
    const hit = sim.world && sim.world.raycast ? sim.world.raycast([ex, ey, ez], [fx, 0, fz], 1.25) : null;
    const pos = hit && hit.box ? hit.pos.slice() : [ex + fx * 1.1, ey, ez + fz * 1.1];
    sim.emit("melee", { who, phase: "miss", pos, dir: [fx, 0, fz], surface: hit && hit.box ? (hit.surface || "concrete") : null });
    return;
  }
  const v = bodyOf(sim, victimWho);
  // back-stab: the attacker stands inside the victim's rear arc
  const vfx = -Math.sin(v.yaw || 0), vfz = -Math.cos(v.yaw || 0);
  const ax = a.pos[0] - v.pos[0], az = a.pos[2] - v.pos[2];
  const ad = Math.hypot(ax, az) || 1;
  const backstab = (ax * vfx + az * vfz) / ad <= -COS_BACK;
  const maxHp = sim.tuning && sim.tuning.maxHp ? sim.tuning.maxHp : 100;
  const amount = backstab ? MELEE.BACKSTAB_DMG : maxHp * MELEE.FRONT_FRAC;
  const lethal = backstab || (v.hp || 0) <= amount + 1e-9;
  s.result = "hit";
  const dx = v.pos[0] - a.pos[0], dz = v.pos[2] - a.pos[2];
  const dd = Math.hypot(dx, dz) || 1;
  // emitted BEFORE the damage so the view's blood takes the flesh gate ahead of
  // the generic hurt puff (fx.js), and a lethal strike's death follows its hit
  sim.emit("melee", {
    who, phase: "hit", victim: victimWho,
    pos: [v.pos[0], v.pos[1] + chestY(v), v.pos[2]], dir: [dx / dd, 0, dz / dd],
    backstab, lethal,
  });
  applyDamage(sim, victimWho, amount, who, "body", "melee",
    { weaponId: MELEE.WEAPON_ID, melee: true, backstab });
}
