// core/sim/equipment.js — TACTICAL + LETHAL EQUIPMENT beside the frag:
// FLASHBANG, SMOKE, CONCUSSION (tactical slot) and the TRIPMINE (lethal slot).
// THREE-free, DOM-free, deterministic (no rng: every effect is a pure function
// of positions, facings and the tick clock). Ticked in sim.js slot 5 right
// after the frag (stepEquipment); the view layer (core/fx/equipment_fx.js)
// only READS what lives here.
//
// WHERE EVERY EFFECT LIVES (all gameplay is sim-side, all looks view-side):
//   flash   popFlash()      body.flashT0/flashDur/flashAmt  -> flashLevel(body,t)
//                           perception: blind >= FLASH.BLIND_LVL sees nothing;
//                           botfsm: aim sigma x(1 + 3*level), blind-fire window
//   stun    popStun()       body.stunT0/stunDur/stunAmt     -> stunLevel(body,t)
//                           player.js + stepBotLocomotion: move x0.55, no sprint;
//                           botfsm turn rate x0.3, aim sigma x2.5; the human's
//                           look rate is scaled view-side by stunTurnMult()
//                           (input.lookMult) because the sim takes the human's
//                           yaw from cmd — a sim clamp would split camera/bullets
//   smoke   state.smokes    [{id,pos,radius,density,until,t0,who}] — sight lines
//                           through smokeBlocks() (perception + flash bursts),
//                           aim_assist.js reads the same array (pos + radius)
//   mine    internal.equip.mines — trigger cone, directional blast, shot/blast
//                           destroy (equipOnShot / blastEquipment), owner-death
//                           expiry (equipOnDeath), max 2 active per operator
//
// EVENT VOCABULARY (additive, one new type "equip"; sim.selftest's frozen list
// carries it):
//   equip {phase:"out",      kind, who, id, pos}
//   equip {phase:"bounce",   kind, who, id, pos}
//   equip {phase:"pop",      kind, who, id, pos}            flash/stun burst, smoke deploy
//   equip {phase:"flashed",  kind:"flash", who, by, amt, dur}
//   equip {phase:"stunned",  kind:"stun",  who, by, amt, dur}
//   equip {phase:"plant",    kind:"claymore", who, id, pos, yaw}
//   equip {phase:"trip",     kind:"claymore", who, id, pos, victim}
//   equip {phase:"destroy",  kind:"claymore", who, id, pos, by}
//   equip {phase:"remove",   kind:"claymore", who, id, pos, reason}  ("limit"|"owner")
//   equip {phase:"smokeEnd", kind:"smoke", id, pos}
// A tripmine detonation is ALSO the existing `explosion` event (source
// "claymore") so every explosion consumer (fx, audio, shake, rumble) reacts.

import { applyDamage } from "./damage.js";
import { hasPerk, PERK_FX } from "./classes.js";

const DEG = Math.PI / 180;

export const EQUIP = {
  GRAV: -20, RESTITUTION: 0.3, TANGENT_FRICTION: 0.62,
  PLAYER_THROW_V: 19, BOT_THROW_V: 18.5, LOFT: 0.14, THROW_CD_S: 0.7, BUFFER_S: 0.35,
  FLASH: {
    FUSE_S: 1.5, RANGE_M: 24, NEAR_M: 5, MIN_S: 1.0, MAX_S: 4.0, HOLD_FRAC: 0.45,
    FULL_CONE_DEG: 30, SIDE_AMT: 0.45, BEHIND_AMT: 0.2, FRIENDLY: 0.35, MIN_AMT: 0.1,
    BLIND_LVL: 0.4,
  },
  STUN: {
    FUSE_S: 1.5, RANGE_M: 10, MIN_S: 1.5, MAX_S: 4.0, HOLD_FRAC: 0.7, FRIENDLY: 0.5,
    MOVE_MULT: 0.55, TURN_MULT: 0.3, AIM_SIGMA: 2.5,
  },
  SMOKE: {
    FUSE_S: 1.3, LIFE_S: 15, BLOOM_S: 2.0, THIN_S: 2.5, R0: 1.2, R: 5.0, LIFT_M: 1.4,
    OPAQUE_M: 1.6, // metres of cloud a sight line may cross before it is blocked
  },
  CLAYMORE: {
    ARM_S: 1.0, MAX_ACTIVE: 2, TRIGGER_R: 2.8, TRIGGER_HALF_DEG: 40, TRIGGER_DY: 1.5,
    DELAY_S: 0.22, BLAST_R: 6.0, FRONT_HALF_DEG: 60, DMG_NEAR: 180, DMG_FAR: 50,
    BACK_R: 1.3, BACK_DMG: 35, THROUGH_HARD: 0.25, SHOT_R: 0.26, OWNER_DEATH_S: 3.0,
    PLACE_FWD_M: 0.55, LASER_M: 2.8, CHAIN_R: 2.5, BODY_Y: 0.12,
  },
};
export const TACTICAL_KINDS = ["flash", "smoke", "stun"];

// ------------------------------------------------------------------ helpers
export function eqOf(sim) {
  let E = sim.internal.equip;
  if (!E) E = sim.internal.equip = { cans: [], mines: [], nextId: 1 };
  if (!sim.state.smokes) sim.state.smokes = [];
  return E;
}

function bodyOf(sim, who) {
  if (who === "P") return sim.state.player;
  const bots = sim.state.bots;
  for (let i = 0; i < bots.length; i++) if (bots[i].id === who) return bots[i];
  return null;
}

/** Same side (a teammate or yourself). FFA: only yourself. */
export function friendly(sim, a, b) {
  if (a == null || b == null) return false;
  if (a === b) return true;
  if (sim.match && typeof sim.match.sameTeam === "function") return !!sim.match.sameTeam(a, b);
  const A = bodyOf(sim, a), B = bodyOf(sim, b);
  return !!(A && B && (A.team | 0) === (B.team | 0));
}

function eyeOf(body) {
  const sl = body._m && body._m.sliding;
  return [body.pos[0], body.pos[1] + (sl ? 0.9 : body.stance === "crouch" ? 1.10 : 1.62), body.pos[2]];
}
function chestOf(body) {
  return [body.pos[0], body.pos[1] + (body.stance === "crouch" ? 0.8 : 1.1), body.pos[2]];
}
function viewDir(body) {
  const yaw = body.yaw || 0;
  const pitch = body.pitch != null ? body.pitch : (body.cmd && body.cmd.pitch) || 0;
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
function forEachBody(sim, fn) {
  const p = sim.state.player;
  if (p && p.alive && !(sim.flags && sim.flags.noTarget)) fn("P", p);
  const bots = sim.state.bots;
  for (let i = 0; i < bots.length; i++) if (bots[i].alive) fn(bots[i].id, bots[i]);
}
const hardOnly = (box) => (box.matClass || "hard") === "hard";
function smooth01(k) { k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k); }

// --------------------------------------------------------------- status read
function levelOf(t0, dur, peak, holdFrac, t) {
  if (!(dur > 0)) return 0;
  const el = t - t0;
  if (el < 0 || el >= dur) return 0;
  const hold = dur * holdFrac;
  if (el <= hold) return peak;
  return peak * (1 - smooth01((el - hold) / (dur - hold)));
}
/** 0..1 whiteout / blindness of a body at time t. */
export function flashLevel(body, t) {
  if (!body || !(body.flashDur > 0)) return 0;
  return levelOf(body.flashT0, body.flashDur, Math.min(1, (body.flashAmt || 0) * 1.6), EQUIP.FLASH.HOLD_FRAC, t);
}
/** 0..1 concussion of a body at time t. */
export function stunLevel(body, t) {
  if (!body || !(body.stunDur > 0)) return 0;
  return levelOf(body.stunT0, body.stunDur, 0.6 + 0.4 * Math.min(1, body.stunAmt || 0), EQUIP.STUN.HOLD_FRAC, t);
}
export function isBlind(body, t) { return flashLevel(body, t) >= EQUIP.FLASH.BLIND_LVL; }
export function stunMoveMult(body, t) {
  const s = stunLevel(body, t);
  return s > 0 ? 1 - (1 - EQUIP.STUN.MOVE_MULT) * s : 1;
}
export function stunTurnMult(body, t) {
  const s = stunLevel(body, t);
  return s > 0 ? 1 - (1 - EQUIP.STUN.TURN_MULT) * s : 1;
}
/** Bot aim-error multiplier from flash + stun (1 = unaffected). */
export function equipAimMult(body, t) {
  const f = flashLevel(body, t), s = stunLevel(body, t);
  if (f <= 0 && s <= 0) return 1;
  return (1 + 3 * f) * (1 + (EQUIP.STUN.AIM_SIGMA - 1) * s);
}
export function resetStatus(body) {
  if (!body) return;
  body.flashT0 = 0; body.flashDur = 0; body.flashAmt = 0;
  body.stunT0 = 0; body.stunDur = 0; body.stunAmt = 0;
}

// ------------------------------------------------------------------- smoke
/** Length (m) of segment a→b inside the sphere (c, r). */
export function chordLen(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-9) return 0;
  const fx = a[0] - c[0], fy = a[1] - c[1], fz = a[2] - c[2];
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  let t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
  if (t2 <= 0 || t1 >= 1) return 0;
  if (t1 < 0) t1 = 0;
  if (t2 > 1) t2 = 1;
  return (t2 - t1) * Math.sqrt(A);
}
/** Does live smoke block the sight line a→b? (cheap: no smokes → one read) */
export function smokeBlocks(sim, a, b) {
  const list = sim.state.smokes;
  if (!list || !list.length) return false;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!(s.radius > 0) || !(s.density > 0)) continue;
    if (chordLen(a, b, s.pos, s.radius) * s.density >= EQUIP.SMOKE.OPAQUE_M) return true;
  }
  return false;
}
/** 0..1 how deep point p sits inside live smoke (view: the in-cloud veil). */
export function smokeDepthAt(sim, p) {
  const list = sim.state.smokes;
  if (!list || !list.length) return 0;
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const d = Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1], p[2] - s.pos[2]);
    if (d >= s.radius) continue;
    const k = Math.min(1, (1 - d / s.radius) * 2.2) * s.density;
    if (k > best) best = k;
  }
  return best;
}

// ------------------------------------------------------------------ throws
export function throwTactical(sim, who, kind, origin, vel) {
  const E = eqOf(sim);
  const F = kind === "smoke" ? EQUIP.SMOKE.FUSE_S : kind === "stun" ? EQUIP.STUN.FUSE_S : EQUIP.FLASH.FUSE_S;
  const c = {
    id: E.nextId++, kind, who, pos: origin.slice(), vel: vel.slice(),
    fuseLeft: F, bounced: false, landed: false, t0: sim.state.time,
  };
  E.cans.push(c);
  sim.emit("equip", { phase: "out", kind, who, id: c.id, pos: c.pos.slice() });
  return c;
}

/** Throw velocity for a body looking (yaw, pitch) — the same loft the frag uses. */
export function throwVel(yaw, pitch, v) {
  const p = Math.min(1.2, pitch + EQUIP.LOFT);
  const cp = Math.cos(p);
  return [-Math.sin(yaw) * cp * v, Math.sin(p) * v, -Math.cos(yaw) * cp * v];
}

// Human verbs: cmd.tactical (edge, 0.35 s buffered) throws the class tactical;
// called from player.js stepPlayerWeaponVerbs. Returns true on a throw.
export function stepPlayerEquipment(sim, p, cmd, t, mantling) {
  let q = p._eq;
  if (!q) q = p._eq = { prev: false, bufT: -9, lastT: -9 };
  const press = !!(cmd && cmd.tactical);
  if (press && !q.prev) q.bufT = t;
  q.prev = press;
  if (t - q.bufT > EQUIP.BUFFER_S) return false;
  const kind = p.kit && p.kit.tactical;
  if (!kind || TACTICAL_KINDS.indexOf(kind) < 0 || (p.tactical | 0) <= 0 || mantling) return false;
  if (t - q.lastT < EQUIP.THROW_CD_S) return false;
  q.bufT = -9; q.lastT = t;
  p.tactical = (p.tactical | 0) - 1;
  const eye = eyeOf(p);
  throwTactical(sim, "P", kind, [eye[0], eye[1] - 0.15, eye[2]], throwVel(p.yaw || 0, p.pitch || 0, EQUIP.PLAYER_THROW_V));
  return true;
}

// ------------------------------------------------------------------ mines
/** Where a body standing at `body.pos` facing `yaw` would plant (null = can't). */
export function plantSpot(sim, body, yaw) {
  const C = EQUIP.CLAYMORE;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let d = C.PLACE_FWD_M;
  const org = [body.pos[0], body.pos[1] + 0.35, body.pos[2]];
  const hit = sim.world.raycast(org, [fx, 0, fz], d + 0.25);
  if (hit && hit.dist < d + 0.25) d = Math.max(0, hit.dist - 0.3);
  const x = body.pos[0] + fx * d, z = body.pos[2] + fz * d;
  let y = sim.world.sphereGround(x, z);
  if (!Number.isFinite(y) || Math.abs(y - body.pos[1]) > 0.6) y = body.pos[1];
  return [x, y, z];
}

export function plantClaymore(sim, who, pos, yaw) {
  const E = eqOf(sim);
  const C = EQUIP.CLAYMORE;
  const t = sim.state.time;
  // max active per operator: the oldest is pulled when a third goes down
  let mine = 0;
  for (const m of E.mines) if (m.who === who) mine++;
  while (mine >= C.MAX_ACTIVE) {
    const i = E.mines.findIndex((m) => m.who === who);
    if (i < 0) break;
    const old = E.mines[i];
    E.mines.splice(i, 1);
    mine--;
    sim.emit("equip", { phase: "remove", kind: "claymore", who, id: old.id, pos: old.pos.slice(), reason: "limit" });
  }
  const m = { id: E.nextId++, who, pos: pos.slice(), yaw, t0: t, armT: t + C.ARM_S, tripT: -1, expireT: -1, victim: null };
  E.mines.push(m);
  sim.emit("equip", { phase: "plant", kind: "claymore", who, id: m.id, pos: m.pos.slice(), yaw });
  return m;
}

/** Plant from a body facing its own yaw (player verb + bot planting). */
export function plantFromBody(sim, who, body, yaw) {
  if (!body || !body.alive || body.grounded === false) return null;
  const y = yaw != null ? yaw : body.yaw || 0;
  const spot = plantSpot(sim, body, y);
  return spot ? plantClaymore(sim, who, spot, y) : null;
}

function removeMine(sim, m, phase, extra) {
  const E = eqOf(sim);
  const i = E.mines.indexOf(m);
  if (i < 0) return;
  E.mines.splice(i, 1);
  sim.emit("equip", Object.assign({ phase, kind: "claymore", who: m.who, id: m.id, pos: m.pos.slice() }, extra || null));
}

function mineCenter(m) { return [m.pos[0], m.pos[1] + EQUIP.CLAYMORE.BODY_Y, m.pos[2]]; }

function detonateMine(sim, m) {
  const C = EQUIP.CLAYMORE;
  const E = eqOf(sim);
  const i = E.mines.indexOf(m);
  if (i < 0) return;
  E.mines.splice(i, 1);
  const pos = [m.pos[0], m.pos[1] + 0.25, m.pos[2]];
  sim.emit("explosion", { pos: pos.slice(), radius: C.BLAST_R, source: "claymore", yaw: m.yaw, who: m.who });
  const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
  const world = sim.world;
  forEachBody(sim, (who, body) => {
    const chest = chestOf(body);
    const dx = chest[0] - pos[0], dy = chest[1] - pos[1], dz = chest[2] - pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > C.BLAST_R) return;
    const hd = Math.hypot(dx, dz) || 1e-6;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / hd))) / DEG;
    let w = ang <= C.FRONT_HALF_DEG ? 1 : ang < 90 ? 1 - (ang - C.FRONT_HALF_DEG) / (90 - C.FRONT_HALF_DEG) : 0;
    const front = (C.DMG_NEAR + (C.DMG_FAR - C.DMG_NEAR) * (d / C.BLAST_R)) * w;
    const back = d <= C.BACK_R ? C.BACK_DMG * (1 - d / C.BACK_R) : 0;
    let dmg = Math.max(front, back);
    if (dmg <= 0.5) return;
    if (world.losBlocked(pos, chest, hardOnly)) dmg *= C.THROUGH_HARD;
    if (hasPerk(body, "flak")) dmg *= PERK_FX.flak.explosiveMult;
    if (dmg > 0.5) applyDamage(sim, who, dmg, m.who, "body", "claymore");
  });
  blastEquipment(sim, pos, C.CHAIN_R, m.who);
}

/** An explosion at `pos` destroys tripmines inside `r` (frags, call-ins, mines). */
export function blastEquipment(sim, pos, r, by) {
  const E = sim.internal.equip;
  if (!E || !E.mines.length) return;
  for (let i = E.mines.length - 1; i >= 0; i--) {
    const m = E.mines[i];
    if (!m) continue;
    const c = mineCenter(m);
    if (Math.hypot(c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]) <= r) removeMine(sim, m, "destroy", { by: by != null ? by : null });
  }
}

/** sim.emit hook: a resolved shot segment origin→hit.pos that passes through a
 *  tripmine destroys it (anyone's shot, the owner's included). */
export function equipOnShot(sim, d) {
  const E = sim.internal.equip;
  if (!E || !E.mines.length || !d || !d.hit || !d.hit.pos || !d.origin || d.pen) return;
  const a = d.origin, b = d.hit.pos;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const L2 = ux * ux + uy * uy + uz * uz;
  if (L2 < 1e-9) return;
  const R = EQUIP.CLAYMORE.SHOT_R;
  for (let i = E.mines.length - 1; i >= 0; i--) {
    const m = E.mines[i];
    const c = mineCenter(m);
    let k = ((c[0] - a[0]) * ux + (c[1] - a[1]) * uy + (c[2] - a[2]) * uz) / L2;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const px = a[0] + ux * k - c[0], py = a[1] + uy * k - c[1], pz = a[2] + uz * k - c[2];
    if (px * px + py * py + pz * pz <= R * R) removeMine(sim, m, "destroy", { by: d.shooter != null ? d.shooter : null });
  }
}

/** sim.emit death hook: an operator's tripmines are pulled OWNER_DEATH_S later. */
export function equipOnDeath(sim, d) {
  const E = sim.internal.equip;
  if (!E || !d || d.victim == null) return;
  const t = sim.state.time;
  for (const m of E.mines) if (m.who === d.victim && m.expireT < 0) m.expireT = t + EQUIP.CLAYMORE.OWNER_DEATH_S;
}

// ------------------------------------------------------------------- pops
function popFlash(sim, c) {
  const F = EQUIP.FLASH;
  const t = sim.state.time;
  const src = [c.pos[0], c.pos[1] + 0.12, c.pos[2]];
  forEachBody(sim, (who, body) => {
    const eye = eyeOf(body);
    const dx = src[0] - eye[0], dy = src[1] - eye[1], dz = src[2] - eye[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > F.RANGE_M) return;
    if (d > 0.3 && sim.world.losBlocked(src, eye)) return;
    if (d > 0.3 && smokeBlocks(sim, src, eye)) return;
    const v = viewDir(body);
    const cosA = d > 1e-3 ? (v[0] * dx + v[1] * dy + v[2] * dz) / d : 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) / DEG;
    const facing = ang <= F.FULL_CONE_DEG ? 1
      : ang <= 90 ? 1 - (1 - F.SIDE_AMT) * (ang - F.FULL_CONE_DEG) / (90 - F.FULL_CONE_DEG)
      : F.SIDE_AMT - (F.SIDE_AMT - F.BEHIND_AMT) * (ang - 90) / 90;
    const distF = d <= F.NEAR_M ? 1 : Math.max(0, 1 - (d - F.NEAR_M) / (F.RANGE_M - F.NEAR_M));
    let amt = facing * distF;
    if (who !== c.who && friendly(sim, c.who, who)) amt *= F.FRIENDLY;
    if (amt < F.MIN_AMT) return;
    const dur = F.MIN_S + (F.MAX_S - F.MIN_S) * amt;
    // a stronger or longer flash replaces the current one; a weaker one does not
    const remain = flashLevel(body, t);
    if (Math.min(1, amt * 1.6) < remain) return;
    body.flashT0 = t; body.flashDur = dur; body.flashAmt = amt;
    sim.emit("equip", { phase: "flashed", kind: "flash", who, by: c.who, amt, dur });
  });
}

function popStun(sim, c) {
  const S = EQUIP.STUN;
  const t = sim.state.time;
  const src = [c.pos[0], c.pos[1] + 0.12, c.pos[2]];
  forEachBody(sim, (who, body) => {
    const chest = chestOf(body);
    const d = Math.hypot(chest[0] - src[0], chest[1] - src[1], chest[2] - src[2]);
    if (d > S.RANGE_M) return;
    if (d > 0.3 && sim.world.losBlocked(src, chest, hardOnly)) return;
    let amt = 1 - d / S.RANGE_M;
    if (who !== c.who && friendly(sim, c.who, who)) amt *= S.FRIENDLY;
    if (amt <= 0.02) return;
    const dur = S.MIN_S + (S.MAX_S - S.MIN_S) * amt;
    if (stunLevel(body, t) > 0 && body.stunT0 + body.stunDur > t + dur) return; // a longer stun stands
    body.stunT0 = t; body.stunDur = dur; body.stunAmt = amt;
    sim.emit("equip", { phase: "stunned", kind: "stun", who, by: c.who, amt, dur });
  });
}

function popSmoke(sim, c) {
  const SM = EQUIP.SMOKE;
  const t = sim.state.time;
  const gy = c.landed ? c.pos[1] : Math.min(c.pos[1], sim.world.sphereGround(c.pos[0], c.pos[2]));
  sim.state.smokes.push({
    id: c.id, who: c.who, pos: [c.pos[0], gy + SM.LIFT_M, c.pos[2]], ground: gy,
    radius: SM.R0, density: 1, t0: t, until: t + SM.LIFE_S,
  });
}

function stepSmokes(sim) {
  const SM = EQUIP.SMOKE;
  const list = sim.state.smokes;
  const t = sim.state.time;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (t >= s.until) {
      list.splice(i, 1);
      sim.emit("equip", { phase: "smokeEnd", kind: "smoke", id: s.id, pos: s.pos.slice() });
      continue;
    }
    const age = t - s.t0;
    const k = Math.min(1, age / SM.BLOOM_S);
    s.radius = SM.R0 + (SM.R - SM.R0) * (1 - (1 - k) * (1 - k));
    const left = s.until - t;
    s.density = left >= SM.THIN_S ? 1 : Math.max(0, left / SM.THIN_S);
  }
}

// --------------------------------------------------------------------- tick
export function stepEquipment(sim, world, dt) {
  const E = sim.internal.equip;
  if (!E) return;
  const t = sim.state.time;

  // canisters in flight / on the ground
  const cans = E.cans;
  for (let i = cans.length - 1; i >= 0; i--) {
    const c = cans[i];
    c.fuseLeft -= dt;
    if (c.fuseLeft <= 0) {
      cans.splice(i, 1);
      sim.emit("equip", { phase: "pop", kind: c.kind, who: c.who, id: c.id, pos: c.pos.slice() });
      if (c.kind === "flash") popFlash(sim, c);
      else if (c.kind === "stun") popStun(sim, c);
      else popSmoke(sim, c);
      continue;
    }
    if (c.landed) continue;
    c.vel[1] += EQUIP.GRAV * dt;
    const speed = Math.hypot(c.vel[0], c.vel[1], c.vel[2]);
    if (speed > 0.01) {
      const step = speed * dt;
      const dir = [c.vel[0] / speed, c.vel[1] / speed, c.vel[2] / speed];
      const hit = world.raycast(c.pos, dir, step + 0.08);
      if (hit && hit.dist <= step + 0.08) {
        const n = hit.normal;
        const vDotN = c.vel[0] * n[0] + c.vel[1] * n[1] + c.vel[2] * n[2];
        const vn = [n[0] * vDotN, n[1] * vDotN, n[2] * vDotN];
        const vt = [c.vel[0] - vn[0], c.vel[1] - vn[1], c.vel[2] - vn[2]];
        c.vel[0] = vt[0] * EQUIP.TANGENT_FRICTION - vn[0] * EQUIP.RESTITUTION;
        c.vel[1] = vt[1] * EQUIP.TANGENT_FRICTION - vn[1] * EQUIP.RESTITUTION;
        c.vel[2] = vt[2] * EQUIP.TANGENT_FRICTION - vn[2] * EQUIP.RESTITUTION;
        c.pos[0] = hit.pos[0] + n[0] * 0.05;
        c.pos[1] = hit.pos[1] + n[1] * 0.05;
        c.pos[2] = hit.pos[2] + n[2] * 0.05;
        const after = Math.hypot(c.vel[0], c.vel[1], c.vel[2]);
        if (after > 1.0) {
          c.bounced = true;
          sim.emit("equip", { phase: "bounce", kind: c.kind, who: c.who, id: c.id, pos: c.pos.slice() });
        } else if (n[1] > 0.5) {
          c.landed = true;
          c.vel[0] = c.vel[1] = c.vel[2] = 0;
        }
      } else {
        c.pos[0] += c.vel[0] * dt; c.pos[1] += c.vel[1] * dt; c.pos[2] += c.vel[2] * dt;
      }
    }
  }

  // smoke volumes
  if (sim.state.smokes.length) stepSmokes(sim);

  // tripmines
  const mines = E.mines;
  if (!mines.length) return;
  const C = EQUIP.CLAYMORE;
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    if (!m) continue;
    if (m.expireT >= 0 && t >= m.expireT && m.tripT < 0) { removeMine(sim, m, "remove", { reason: "owner" }); continue; }
    if (m.tripT >= 0) {
      if (t >= m.tripT) detonateMine(sim, m);
      continue;
    }
    if (t < m.armT) continue;
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    const cosHalf = Math.cos(C.TRIGGER_HALF_DEG * DEG);
    const eye = [m.pos[0], m.pos[1] + 0.3, m.pos[2]];
    let tripper = null;
    forEachBody(sim, (who, body) => {
      if (tripper != null || friendly(sim, m.who, who)) return;
      const dx = body.pos[0] - m.pos[0], dz = body.pos[2] - m.pos[2];
      const hd = Math.hypot(dx, dz);
      if (hd > C.TRIGGER_R || hd < 1e-3) return;
      if (Math.abs(body.pos[1] - m.pos[1]) > C.TRIGGER_DY) return;
      if ((dx * fx + dz * fz) / hd < cosHalf) return;
      if (world.losBlocked(eye, chestOf(body), hardOnly)) return;
      tripper = who;
    });
    if (tripper != null) {
      m.tripT = t + C.DELAY_S;
      m.victim = tripper;
      sim.emit("equip", { phase: "trip", kind: "claymore", who: m.who, id: m.id, pos: m.pos.slice(), victim: tripper });
    }
  }
}

/** Live equipment owned by enemies of `who` (AI reads). */
export function enemyMines(sim, who) {
  const E = sim.internal.equip;
  if (!E || !E.mines.length) return null;
  const out = [];
  for (const m of E.mines) if (!friendly(sim, m.who, who)) out.push(m);
  return out;
}
export function liveCans(sim) {
  const E = sim.internal.equip;
  return E ? E.cans : null;
}
