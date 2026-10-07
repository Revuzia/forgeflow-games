// VALE sim — in-match economy: gold, XP, bounties, streaks (CONTRACT §5.6).
//
// Everything here runs from hooks.death (at the moment of the kill, in whatever phase it happens)
// except passive gold ('deaths' phase). Core already counts K/D/A and team kills; this file never
// counts them again. Every gold amount is rounded to a whole number after × rules.goldMult; XP is
// × rules.xpMult and may be fractional.
//
// Units (minion, monster, structure, summon, ward): the fighter credited with the kill (itself, or
// a summon's owner) gets UnitDef.bounty.gold — reason 'cs' for minions/monsters (and cs + 1),
// 'objective' for objective monsters, 'structure' for structures, 'kill' otherwise.
// bounty.goldGlobal goes to EVERY player of the destroying team (the credited fighter's team, or
// the killing unit's team when no fighter gets credit — a minion finishing a tower still pays its
// team) with reason 'structure' (structures) or 'objective' (anything else). Kills by neutral
// units or with no killer pay nothing.
//
// Fighters (rules.bounty = { kill, assistShare, streakStep, streakMax, shutdownMax }):
//   streak bonus  = min(streakMax, streakStep × max(0, victim streak − 1))
//   shutdown      = min(shutdownMax, streak bonus)          (paid on top of `kill`)
//   killer gold   = kill + shutdown                          reason 'kill'
//   each assister = (kill + shutdown) × assistShare / #assisters   reason 'assist'
// With no credited killer (tower, monster, minion) the assisters still get their share. The killer's
// streak +1, the victim's resets to 0. Player.bounty shows what the seat is worth right now.
// 'takedown' carries the killer's new streak, the shutdown paid, first (first fighter takedown
// with a credited killer) and multi (takedowns by that killer each within tuning.multiKillWindow s of
// the previous one, 1..MULTI_KILL_MAX).
//
// XP: a unit is worth UnitDef.bounty.xp; a fighter tuning.killXpFraction × the xp step at its level.
// It is split evenly between the eligible fighters: alive, hostile to the victim, within
// tuning.xpShareRange m of it — plus the credited killer wherever it stands. FFA (more than two teams):
// only the killer and the assisters are eligible.
//
// Passive gold: from rules.passiveGoldStart, rules.passiveGoldPerSec × goldMult paid once per
// second (fractions carried), reason 'passive', dead or alive.
//
// Announce keys emitted here: 'first_blood' (player), 'multikill' (player, params.n),
// 'shutdown' (player, params.gold, params.victim).

import { TICK_HZ, type PlayerId } from '../contracts/sim.ts';
import { grantGold, type GoldReason } from './effects.ts';
import type { Entity, Player } from './entity.ts';
import { grantXp, xpStep } from './units/fighters.ts';
import { isObjectiveUnit } from './units/monsters.ts';
import type { DeathEvent, World } from './world.ts';

// defaults of the rules.tuning keys of the same names (CONTRACT §5.6)
export const XP_SHARE_RANGE = 16;
export const KILL_XP_FRACTION = 0.6;
export const MULTI_KILL_WINDOW = 10;
export const MULTI_KILL_MAX = 5;

interface EconState {
  firstBlood: boolean;
  passiveAcc: number[];
  lastKillAt: number[];
  multi: number[];
  ffa: boolean;
}
const KEY = 'econ';
function econ(w: World): EconState { return w.ext[KEY] as EconState; }

/** gold earned by play (counts toward goldEarned); rounded, × goldMult applied by the caller */
export function payGold(w: World, player: PlayerId, amount: number, reason: GoldReason, x: number, y: number): number {
  const g = Math.round(amount);
  if (g <= 0) return 0;
  grantGold(w, player, g, reason, x, y);
  return g;
}

export function streakBonus(w: World, p: Player): number {
  const b = w.rules.bounty;
  return Math.min(b.streakMax, b.streakStep * Math.max(0, p.streak - 1));
}
export function shutdownOf(w: World, p: Player): number { return Math.min(w.rules.bounty.shutdownMax, streakBonus(w, p)); }
/** gold a killer would get for this seat right now */
export function killValue(w: World, p: Player): number {
  return Math.round((w.rules.bounty.kill + shutdownOf(w, p)) * w.rules.goldMult);
}
export function fighterKillXp(w: World, level: number): number {
  const t = w.rules.xpTable;
  const step = xpStep(w, level) || (t.length ? t[t.length - 1] : 0);
  return (w.rules.tuning?.killXpFraction ?? KILL_XP_FRACTION) * step;
}

// ── deaths ──────────────────────────────────────────────────────────────────────────────────────
function onDeath(w: World, victim: Entity, killer: Entity | null, assists: PlayerId[], ev: DeathEvent): void {
  const credit = w.creditFighter(killer);
  const kp = credit && credit.player && credit.team !== victim.team ? credit.player : null;
  if (victim.kind === 'fighter' && victim.player) fighterTakedown(w, victim, victim.player, kp, assists, ev);
  else if (victim.unit) unitBounty(w, victim, killer, kp, ev);
  shareXp(w, victim, kp, assists);
}

function unitBounty(w: World, victim: Entity, killer: Entity | null, kp: Player | null, ev: DeathEvent): void {
  const u = victim.unit!;
  const mult = w.rules.goldMult;
  const objective = isObjectiveUnit(victim);
  const reason: GoldReason = victim.kind === 'structure' ? 'structure' : objective ? 'objective'
    : victim.kind === 'minion' || victim.kind === 'monster' ? 'cs' : 'kill';
  if (kp) {
    if (victim.kind === 'minion' || victim.kind === 'monster') kp.cs++;
    ev.gold = payGold(w, kp.player, u.bounty.gold * mult, reason, victim.x, victim.y);
  }
  const global = u.bounty.goldGlobal;
  if (global && global > 0) {
    const team = kp ? kp.team : killer && killer.team >= 0 && killer.team !== victim.team ? killer.team : -1;
    if (team < 0) return;
    const r: GoldReason = victim.kind === 'structure' ? 'structure' : 'objective';
    for (const p of w.players) if (p && p.team === team) payGold(w, p.player, global * mult, r, victim.x, victim.y);
  }
}

function fighterTakedown(w: World, victim: Entity, vp: Player, kp: Player | null, assists: PlayerId[], ev: DeathEvent): void {
  const st = econ(w);
  const b = w.rules.bounty;
  const mult = w.rules.goldMult;
  const shutdown = shutdownOf(w, vp);
  const value = b.kill + shutdown;
  let first = false, multi = 0, paidShutdown = 0;
  if (kp) {
    ev.gold = payGold(w, kp.player, value * mult, 'kill', victim.x, victim.y);
    paidShutdown = Math.round(shutdown * mult);
    kp.streak++;
    first = !st.firstBlood;
    st.firstBlood = true;
    const window = w.rules.tuning?.multiKillWindow ?? MULTI_KILL_WINDOW;
    multi = w.time - st.lastKillAt[kp.player] <= window ? Math.min(MULTI_KILL_MAX, st.multi[kp.player] + 1) : 1;
    st.multi[kp.player] = multi;
    st.lastKillAt[kp.player] = w.time;
  }
  if (assists.length > 0) {
    const share = (value * b.assistShare * mult) / assists.length;
    for (const a of assists) payGold(w, a, share, 'assist', victim.x, victim.y);
  }
  vp.streak = 0;
  vp.bounty = killValue(w, vp);
  if (kp) kp.bounty = killValue(w, kp);
  w.emit({ e: 'takedown', t: w.time, killer: kp ? kp.player : -1, victim: vp.player, assists: assists.slice(), streak: kp ? kp.streak : 0,
    shutdown: paidShutdown, first, multi });
  if (kp) {
    if (first) w.emit({ e: 'announce', t: w.time, key: 'first_blood', team: kp.team, player: kp.player });
    if (multi >= 2) w.emit({ e: 'announce', t: w.time, key: 'multikill', team: kp.team, player: kp.player, params: { n: multi } });
    if (paidShutdown > 0) w.emit({ e: 'announce', t: w.time, key: 'shutdown', team: kp.team, player: kp.player, params: { gold: paidShutdown, victim: vp.player } });
  }
}

function shareXp(w: World, victim: Entity, kp: Player | null, assists: readonly PlayerId[]): void {
  let amount = victim.kind === 'fighter' ? fighterKillXp(w, victim.level) : victim.unit ? victim.unit.bounty.xp : 0;
  amount *= w.rules.xpMult;
  if (!(amount > 0)) return;
  const ffa = econ(w).ffa;
  const range = w.rules.tuning?.xpShareRange ?? XP_SHARE_RANGE;
  const r2 = range * range;
  const eligible: Player[] = [];
  for (const p of w.players) {
    const f = p?.ent;
    if (!f || !f.alive || f.team === victim.team) continue;
    const credited = kp === p;
    const dx = f.x - victim.x, dy = f.y - victim.y;
    if (!credited && dx * dx + dy * dy > r2) continue;
    if (ffa && !credited && !assists.includes(p.player)) continue;
    eligible.push(p);
  }
  if (eligible.length === 0) return;
  const share = amount / eligible.length;
  for (const p of eligible) grantXp(w, p, share);
}

// ── passive gold ────────────────────────────────────────────────────────────────────────────────
/** 'deaths' phase */
export function passiveGoldSystem(w: World): void {
  const r = w.rules;
  if (w.phase === 'ended' || r.passiveGoldPerSec <= 0 || w.time < r.passiveGoldStart || w.tick % TICK_HZ !== 0) return;
  const acc = econ(w).passiveAcc;
  for (const p of w.players) {
    if (!p) continue;
    acc[p.player] = (acc[p.player] ?? 0) + r.passiveGoldPerSec * r.goldMult;
    const g = Math.floor(acc[p.player] + 1e-9);
    if (g <= 0) continue;
    acc[p.player] -= g;
    const e = p.ent;
    grantGold(w, p.player, g, 'passive', e ? e.x : 0, e ? e.y : 0);
  }
}

export function installEconomy(w: World, ffa: boolean): void {
  const n = w.setup.seats.length;
  const st: EconState = {
    firstBlood: false, passiveAcc: new Array(n).fill(0), lastKillAt: new Array(n).fill(-1e9), multi: new Array(n).fill(0), ffa,
  };
  w.ext[KEY] = st;
  w.hooks.death.push(onDeath);
}

/** seat bounty views after spawning */
export function initEconomyViews(w: World): void {
  for (const p of w.players) if (p) p.bounty = killValue(w, p);
}
