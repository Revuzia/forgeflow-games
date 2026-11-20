// VALE bots — the team brain (2 Hz per team; none in free-for-all).
//
// Publishes NON-AUTHORITATIVE intents that bots weigh in their own utility scoring (r09 §2.1, §5.1):
//   * lane assignment from SeatSetup.role → RoleDef.assign (lane id / jungle / support on the duo
//     lane), falling back to FighterDef.role, and filling gaps so every lane is covered; on a one-lane
//     map (Bridge) everyone shares the lane and the team groups as one;
//   * defend[lane]: an own structure with enemies at it (gates/cores weigh more), with the enemy
//     fighter count there (defendFighters: a laner answers a dive, not its lane opponent);
//   * group + siege: in the mid/late game (or always on one lane) the team gathers on one target —
//     the core when it is open, else the least-pushed tower, and respawning structures (gates) only
//     once every tower that guards the core is down, so the core can follow before they return;
//   * objective: objective camps (MapDef camps with objective = true) from the public timers in
//     WorldView.objectives — gather 30 s before a spawn, take it when the team is not behind;
//   * gank: a visible enemy fighter overextended in a lane where the team has a laner (junglers);
//   * camp memory: when each camp should be up (first spawn, then seen empty / seen cleared);
//   * focus: each bot publishes its fight target, so teammates can focus fire.
//   * tier (W4 gameplay G3, difficulty.ts teamDifficulty): a window (a won fight) and a defend call are
//     published only once they have held macroDelay s; a team that convertsLeads also presses a Gleam
//     lead of leadGleam (Σ goldEarned, public) into a grouped siege while it is not short of bodies
//     (`press`: from the mid game on RIFT, at once on one road; never over a live or imminent objective),
//     and keeps a won fight's window open while two fallen enemies still have long respawn clocks (public)
//     even as the rest come back; a team that readsWaves sends answers to threatened roads (thinkAnswers);
//     objective calls follow the tier's objectiveLead / objectiveEven / contests.
//   * play as a team (ruling 65): a road two or three of ours committed to is joined (joinAt), a group siege waits for its
//     arrivals (regroupWait), a won fight takes the structure in front of it, a won defence counter-pushes, and the team
//     talks through pings (comms.ts): it says push / objective / assist / retreat / danger / onMyWay, answers a teammate's
//     assist, and weighs a person's push and objective pings;
//   * endgame (W4 gameplay G5): only towers that can be hit count as standing in front of a gate, so a
//     Lantern guarding a protected Bell Needle is sieged instead of leaving the team without a target, and
//     a tower opened by a fallen gate is pushed before the gate relights.

import type { EntityId, PlayerId, SeatSetup } from '../../contracts/sim.ts';
import type { Entity } from '../entity.ts';
import type { World } from '../world.ts';
import { lanePoint, progress, fromProgress, proj, type CampInfo, type Knowledge, type StructInfo } from './knowledge.ts';
import type { TeamPerc } from './perception.ts';
import { dhypot, sq } from '../dmath.ts';
import { DIFFICULTIES, type DifficultyProfile } from './difficulty.ts';
import { recallTime } from '../units/fighters.ts';
import { abilityInfo, U_ESCAPE } from './knowledge.ts';
import { TeamComms, type Heard } from './comms.ts';
import type { PingKind } from '../../contracts/sim.ts';

export interface LaneAssign { lane: number; jungle: boolean; support: boolean }

/** structure class by how deep it sits: 0 outer (guards nothing behind it), 1 inner, 2 base (a Lantern, a Bell Needle, the core) */
export type StructClass = 0 | 1 | 2;

/** a fighter posted to a threatened own structure (lane AI G1): it keeps this post until the threat has been gone
 *  for the tier's defendHold, and is never pulled onto another call meanwhile */
export interface Guard {
  readonly sid: string;
  /** the structure, and where to stand: inside its reach on the home side (a gate or the core: at it) */
  x: number; y: number; standX: number; standY: number;
  /** its reach (range + radius − 1; 0: it does not shoot) */
  reach: number;
  cls: StructClass;
  /** recall to it (the recall plus the walk from the fountain is clearly faster than walking) */
  recall: boolean;
  /** the post holds until then (renewed while the threat holds) */
  until: number;
  /** when the post was given (a defender that has not turned to it 2 s later, away from it, hands it on) */
  readonly since: number;
  /** what called the post: enemy fighters at it, fighters coming at the road's front, a wave alone, or the core hit */
  readonly why: 'fight' | 'coming' | 'wave' | 'core';
}

/** a place a ganker can wait out of sight beside a road: a thicket whose centre is 4–22 m off the road (lane AI G3) */
export interface Entry { readonly x: number; readonly y: number; readonly lane: number; readonly thicket: number }

export const TEAM_THINK_TICKS = 15;
/** ruling 64, the base answer: a hit within this many seconds still counts as the structure being hit */
const BA_HIT = 1.5;
/** ... an answer holds this long after the last think that saw the hits (then the defenders go back to the plan) */
const BA_HOLD = 1.5;
/** ... defenders: above this share of health, within this many metres, and not in a fight of their own (an enemy fighter
 *  this close to them, away from the structure) */
const BA_HP = 0.6, BA_CAP = 80, BA_BUSY = 12;
/** owner_rulings 44, round 2: seconds a defend call or an answer stands after its threat last showed */
const DEFEND_STICK = 4;
/** ruling 60: RIFT's calls do not stand on — with the walk latch (rulings 55/58) holding a calm fighter's turn, the 4 s stand-on
 *  only kept defenders on a threat that had gone (part of the round-1 package's pace cost, measured with the posts off) */
const stickOf = (k: Knowledge): number => (k.kind === 'rift' ? 0 : DEFEND_STICK);

function roleOf(k: Knowledge, s: SeatSetup): string {
  if (s.role) return s.role;
  return k.idx.fighters.get(s.fighter)?.role ?? '';
}

/**
 * Lane assignment for one team (pure; the team brain and the bot factory share it). Rift: each
 * seat's RoleDef.assign (SeatSetup.role, else the fighter's FighterDef.role) — the jungle role
 * when rules.jungle is on and the map has camps (one jungler), the lane it names (one laner per
 * lane, plus one `support` on its lane); every seat left over fills the emptiest lane. One-lane maps
 * put everyone on the lane; maps without lanes leave everyone unassigned (-1).
 */
export function assignLanes(k: Knowledge, team: number): Map<PlayerId, LaneAssign> {
  const out = new Map<PlayerId, LaneAssign>();
  const seats = k.setup.seats.filter((s) => s.team === team);
  const order = (s: SeatSetup): number => k.roles.get(roleOf(k, s))?.assign?.order ?? 99;
  seats.sort((a, b) => order(a) - order(b) || a.player - b.player);
  const nL = k.lanes.length;
  if (nL === 0 || k.ffa) { for (const s of seats) out.set(s.player, { lane: -1, jungle: false, support: false }); return out; }
  if (k.kind !== 'rift') { for (const s of seats) out.set(s.player, { lane: 0, jungle: false, support: false }); return out; }
  const count = new Int32Array(nL), supports = new Int32Array(nL);
  const jungleOk = k.rules.jungle && k.camps.some((c) => !c.objective);
  let junglers = 0;
  const open: SeatSetup[] = [];
  for (const s of seats) {
    const a = k.roles.get(roleOf(k, s))?.assign;
    if (!a) { open.push(s); continue; }
    if (a.jungle) {
      if (jungleOk && junglers === 0) { junglers++; out.set(s.player, { lane: -1, jungle: true, support: false }); }
      else open.push(s);
      continue;
    }
    const li = a.lane ? k.lanes.findIndex((l) => l.id === a.lane) : -1;
    if (li < 0) { open.push(s); continue; }
    const cores = count[li] - supports[li];
    if (a.support ? supports[li] === 0 && count[li] <= 1 : cores === 0 && count[li] <= 1) {
      count[li]++; if (a.support) supports[li]++;
      out.set(s.player, { lane: li, jungle: false, support: a.support });
    } else open.push(s);
  }
  for (const s of open) {
    let best = 0;
    for (let i = 1; i < nL; i++) if (count[i] < count[best]) best = i;
    count[best]++;
    out.set(s.player, { lane: best, jungle: false, support: false });
  }
  return out;
}

export class TeamBrain {
  readonly team: number;
  readonly k: Knowledge;
  readonly perc: TeamPerc;
  lastThink = -1e9;
  readonly assign = new Map<PlayerId, LaneAssign>();
  readonly push: Float64Array;
  readonly defend: Float64Array;
  readonly defendX: Float64Array;
  readonly defendY: Float64Array;
  /** enemy fighters at the most threatened own structure of each lane */
  readonly defendFighters: Int32Array;
  /** laners assigned to each lane */
  private readonly laners: Int32Array;
  /** an own structure off the lanes (core) under attack */
  baseThreat = 0; baseX = 0; baseY = 0;
  /** ruling 55: enemy fighters seen at a base structure this think (0: the base threat is Wicks alone) */
  baseFighters = 0;
  phase: 'early' | 'mid' | 'late' = 'early';
  group = false;
  /** endgame push: gates/core are open; commit everyone */
  rush = false;
  /** a won fight: the enemy is short of bodies — take structures now */
  window = false;
  /** a lead to press (tiers that convertsLeads): group and siege without waiting for a won fight */
  press = false;
  /** the fighter sent to answer a threatened road: player → lane (RIFT, from the mid game) */
  readonly answer = new Map<PlayerId, number>();
  /** where each lane's answer goes */
  readonly answerX: Float64Array;
  readonly answerY: Float64Array;
  /** the tier the team plays at (macro knobs) */
  readonly diff: DifficultyProfile;
  /** since when each published condition has held (macroDelay) */
  private readonly since = new Map<string, number>();
  /** endgame, not committed yet: gather at the group point, do not start on the gates */
  stage = false;
  groupX = 0; groupY = 0;
  siege: Entity | null = null;
  siegeLane = -1;
  objective: { camp: CampInfo; desire: number; alive: boolean } | null = null;
  gank: Entity | null = null;
  /** the road the gank target stands on (-1: none) */
  gankLane = -1;
  readonly campReady: Float64Array;
  /** objectiveSense: until when the team leaves an objective it gave up on alone, and since when it has been on one */
  private readonly campBlock: Float64Array;
  private readonly campOn: Float64Array;
  readonly focus = new Map<PlayerId, EntityId>();
  aliveAllies = 0; aliveEnemies = 0;
  /** enemy fighters not seen for a while (danger of pushing deep) */
  missing = 0;
  /** lane AI G1: fighters posted to threatened own structures */
  /** the scoreboard's Gleam lead (ours minus theirs, public; two-team modes) */
  gleamLead = 0;
  readonly guard = new Map<PlayerId, Guard>();
  /** defenders that handed a post on (busy elsewhere: a siege, a fight, a trip home), not asked again until then */
  readonly guardDeclined = new Map<PlayerId, number>();
  /** structure id → class (outer / inner / base) */
  private readonly classes = new Map<string, StructClass>();
  /** lane AI G3: thickets beside each road a ganker can wait in, and every thicket centre (ambush spots) */
  readonly entries: Entry[] = [];
  readonly thicketXs: number[] = [];
  readonly thicketYs: number[] = [];
  /** lane AI G3: a roam heading for this road's gank (the laner holds its wave for it), and when it was last seen */
  gankComing = -1; gankComingAt = -1e9;
  /** lane AI G6: the split-pusher (-1: none), its road, and whether the road is safe for it */
  splitSeat: PlayerId = -1; splitLane = -1; splitSafe = false;
  /** lane AI G5: the group is gathered enough to press (fit fighters at the group point) */
  gathered = true;
  /** lane AI G7: a cross-map trade for an objective the team cannot contest — press this structure until then */
  tradeUntil = -1e9;
  private tradeX = 0; private tradeY = 0;
  /** lane AI G7: an objective to light up before it spawns (lamps round the pit), and enemy lamps there to clear */
  visionPit: CampInfo | null = null;
  /** owner_rulings 44: an enemy fighter in sight alone in our half of the Dialwood, and the fighters sent to punish it */
  invader: Entity | null = null;
  readonly hunters = new Set<PlayerId>();
  private invaderUntil = -1e9;
  /** owner_rulings 44: the core's own guards (the structures the core requires), own structures' health at the last think
   *  and when each was last hurt */
  private readonly coreGuards = new Set<string>();
  private readonly enemyCorePath = new Set<string>();
  /** round 2: the sticky defend calls (until, value, point, fighters per lane; the base's) and the sticky answers */
  private readonly stickDef: Float64Array; private readonly stickVal: Float64Array;
  private readonly stickX: Float64Array; private readonly stickY: Float64Array; private readonly stickF: Int32Array;
  private stickBase = -1e9; private stickBaseV = 0; private stickBaseX = 0; private stickBaseY = 0;
  private readonly answerUntil = new Map<PlayerId, { lane: number; until: number }>();
  private readonly structHp = new Map<number, number>();
  private readonly structHitAt = new Map<number, number>();
  /** ruling 55: each own structure's health loss per second, smoothed over the team's thinks (its own health is ours to know) */
  private readonly structLoss = new Map<number, number>();
  private lastGuardAt = -1e9;
  /** ruling 65: the team's pings (said and heard) */
  readonly comms: TeamComms;
  /** ruling 65: this team's computer-played seats (the speakers) and its people */
  private readonly botSeats: PlayerId[] = [];
  private readonly humans = new Set<PlayerId>();
  /** ruling 65: fighters answering an assist ping — where, until when, and the ping's key */
  readonly helpers = new Map<PlayerId, { x: number; y: number; until: number; key: string }>();
  /** ruling 65: a computer-played teammate's own "help here" (said through the team, heard here at once) */
  readonly selfAssist = new Map<PlayerId, { x: number; y: number; t: number }>();
  /** ruling 65: a person's push or objective ping the team is weighing, until when */
  private pingPush: { x: number; y: number; until: number; by: PlayerId; on: boolean; asked: boolean } | null = null;
  /** ruling 65 fix round: the fighters walking to a person's push ping (the structure, until when); only they say onMyWay */
  readonly pushers = new Map<PlayerId, { sid: number; until: number; d0: number }>();
  /** ruling 65 fix round: when the named walkers' progress is checked for the onMyWay (-1: said, or none to say) */
  private pushAckAt = -1;
  private pingObj: { x: number; y: number; until: number; by: PlayerId } | null = null;
  /** ruling 65: the road two or three of ours committed to (an enemy structure id), until when */
  private joinSid = -1; private joinUntil = -1e9;
  joined = false;
  /** ruling 65: a group siege is waiting for its arrivals (regroup), since when and on which structure */
  regroup = false;
  private regroupAt = -1e9; private regroupSid = -1; private regroupDone = -1;
  /** ruling 65: the last think an enemy fighter stood at an inner or base structure of ours, and a counter-push's end */
  private defFightAt = -1e9; private counterUntil = -1e9;
  private heardSeen = 0;
  /** ruling 65: enemy fighters' positions at the last think (steady sightings for calls) */
  private readonly foePos = new Map<EntityId, { x: number; y: number; t: number }>();


  /** shared with the match: map structure id → when it fell */
  readonly downAt: ReadonlyMap<string, number>;
  /** enemy towers (non-respawning, non-core structures) still standing */
  towersLeft = 0;

  constructor(team: number, k: Knowledge, perc: TeamPerc, downAt: ReadonlyMap<string, number> = new Map(), diff: DifficultyProfile = DIFFICULTIES.adept) {
    this.team = team; this.k = k; this.perc = perc; this.downAt = downAt; this.diff = diff;
    const n = k.lanes.length;
    this.push = new Float64Array(n); this.defend = new Float64Array(n);
    this.defendX = new Float64Array(n); this.defendY = new Float64Array(n);
    this.defendFighters = new Int32Array(n); this.laners = new Int32Array(n);
    this.answerX = new Float64Array(n); this.answerY = new Float64Array(n);
    this.stickDef = new Float64Array(n).fill(-1e9); this.stickVal = new Float64Array(n); this.stickX = new Float64Array(n); this.stickY = new Float64Array(n); this.stickF = new Int32Array(n);
    this.campReady = new Float64Array(k.camps.length);
    this.campBlock = new Float64Array(k.camps.length);
    this.campOn = new Float64Array(k.camps.length).fill(-1);
    for (const c of k.camps) this.campReady[c.index] = c.firstSpawn;
    // structure classes by requires-depth (a structure that guards nothing is outer; the core and its guards are base)
    const depth = (id: string, g: number): number => {
      const st = k.structs.find((x) => x.id === id);
      if (!st || g > 12) return 0;
      let d = 0;
      for (const r of st.requires) d = Math.max(d, 1 + depth(r, g + 1));
      return d;
    };
    for (const st of k.structs) this.classes.set(st.id, st.isCore || st.lane < 0 ? 2 : Math.min(2, depth(st.id, 0)) as StructClass);
    for (const st of k.structs) if (st.isCore && st.team === team) for (const r of st.requires) this.coreGuards.add(r);
    // (the enemy core's requires-closure: the structures standing between a push and its core)
    const walk = (id: string, g: number): void => { if (g > 12 || this.enemyCorePath.has(id)) return; this.enemyCorePath.add(id); const st = k.structs.find((x) => x.id === id); if (st) for (const r of st.requires) walk(r, g + 1); };
    for (const st of k.structs) if (st.isCore && st.team !== team) for (const r of st.requires) walk(r, 0);
    // gank entries and ambush spots
    const th = k.map.thickets;
    for (let i = 0; i < th.length; i++) {
      const poly = th[i];
      let cx = 0, cy = 0;
      for (const pt of poly) { cx += pt[0]; cy += pt[1]; }
      cx /= poly.length; cy /= poly.length;
      this.thicketXs.push(cx); this.thicketYs.push(cy);
      for (const l of k.lanes) {
        const pr = this.projectTo(l.index, cx, cy);
        if (pr.d2 >= 4 * 4 && pr.d2 <= 22 * 22) this.entries.push({ x: cx, y: cy, lane: l.index, thicket: i });
      }
    }
    this.assignLanes();
    for (const a of this.assign.values()) if (a.lane >= 0 && !a.jungle) this.laners[a.lane]++;
    this.comms = new TeamComms(diff.pingGap, diff.pingTeam);
    for (const s of k.setup.seats) if (s.team === team) { if (s.controller === 'bot') this.botSeats.push(s.player); else this.humans.add(s.player); }
  }

  /** ruling 65: a teammate's ping heard off the event stream */
  hearPing(h: Heard): void { this.comms.hear(h); }
  /** ruling 65: is this seat played by a person */
  isHuman(p: PlayerId): boolean { return this.humans.has(p); }

  // ── lanes ─────────────────────────────────────────────────────────────────────────────────────
  private assignLanes(): void {
    for (const [p, a] of assignLanes(this.k, this.team)) this.assign.set(p, a);
  }
  laneOf(p: PlayerId): LaneAssign { return this.assign.get(p) ?? { lane: this.k.lanes.length > 0 ? 0 : -1, jungle: false, support: false }; }
  /** is the own structure of this map id standing */
  private ownStanding(id: string): boolean {
    const s = this.k.structs.find((x) => x.id === id);
    if (!s) return false;
    for (const e of this.perc.allyStructs) if (e.alive && Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5) return true;
    return false;
  }
  /** a structure's class (outer 0, inner 1, base 2) */
  classOf(info: StructInfo): StructClass { return this.classes.get(info.id) ?? 0; }
  /** ruling 55: was this own structure (by its map id) hit within the last `s` seconds */
  hitRecently(sid: string, now: number, s: number): boolean {
    const st = this.perc.allyStructs.find((x) => this.structInfoOf(x)?.id === sid);
    return !!st && now - (this.structHitAt.get(st.id) ?? -1e9) <= s;
  }
  /** how many of this team's laners hold `lane` */
  lanersOn(lane: number): number { return lane >= 0 && lane < this.laners.length ? this.laners[lane] : 0; }

  // ── intents ───────────────────────────────────────────────────────────────────────────────────
  think(w: World): void {
    this.lastThink = w.tick;
    const k = this.k, tp = this.perc, now = w.time;
    // who is up
    let aa = 0, ae = 0, lvA = 0, lvE = 0;
    for (const p of w.players) {
      const e = p?.ent;
      if (!e) continue;
      if (p.team === this.team) { if (e.alive) aa++; lvA += e.level; }
      else { if (e.alive) ae++; lvE += e.level; }
    }
    this.aliveAllies = aa; this.aliveEnemies = ae;
    let missing = 0;
    for (const ls of tp.lastSeen.values()) if (now - ls.t > 6) missing++;
    this.missing = Math.min(ae, missing + Math.max(0, ae - tp.lastSeen.size));
    this.updateCamps(w);
    // phase
    let ownLost = 0, enemyLost = 0;
    for (const s of k.structs) {
      if (s.lane < 0) continue;
      const alive = this.structAlive(w, s);
      if (!alive) { if (s.team === this.team) ownLost++; else enemyLost++; }
    }
    const avgLv = lvA / Math.max(1, k.setup.seats.filter((s) => s.team === this.team).length);
    // (one fallen Needle is a lane lost, not the end of laning: 'mid' from 10:00 or the second)
    this.phase = now >= 1200 || avgLv >= 12 ? 'late' : now >= 600 || ownLost + enemyLost >= 2 ? 'mid' : 'early';
    this.thinkDefend(w);
    this.delayDefend(now);
    this.thinkHeard(w);
    this.thinkCounter(w, aa - ae);
    this.thinkSiege(w, aa - ae, lvA - lvE, enemyLost);
    this.thinkObjective(w, aa, ae);
    this.thinkGank(w);
    this.thinkAnswers(w);
    this.thinkGuard(w);
    this.thinkSplit(w);
    this.thinkInvader(w);
    this.thinkAssist(w);
    this.thinkCalls(w, aa - ae);
  }

  /**
   * Ruling 65 — a won defence turns into a counter-push: an enemy fighter stood at an inner or base structure of ours in
   * the last 10 s, none does now, and we have a fighter more up (the defence took one or more of them). The team treats it as
   * a won fight for 20 s (`window`): the beaten attackers' road is pushed while they walk back, as players do.
   */
  private thinkCounter(w: World, aliveDiff: number): void {
    if (this.k.kind !== 'rift') return;
    const now = w.time, tp = this.perc;
    let at = false;
    for (const st of tp.allyStructs) {
      if (!st.alive) continue;
      const info = this.structInfoOf(st);
      if (!info || this.classOf(info) < 1) continue;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - st.x) + sq(f.y - st.y) <= 25 * 25) { at = true; break; }
      if (at) break;
    }
    if (at) { this.defFightAt = now; return; }
    if (now - this.defFightAt <= 10 && aliveDiff >= 1 && now > this.counterUntil + 30) { this.counterUntil = now + 20; this.defFightAt = -1e9; }
  }

  /** ruling 65: the bot seats of this team alive now, nearest (x, y) first (none: -1) */
  private speaker(w: World, x: number, y: number, not: PlayerId = -1, maxD = Infinity): PlayerId {
    let best: PlayerId = -1, bd = maxD * maxD;
    for (const p of this.botSeats) {
      if (p === not) continue;
      const e = w.players[p]?.ent;
      if (!e || !e.alive) continue;
      const d2 = sq(e.x - x) + sq(e.y - y);
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  /** ruling 65: queue a call for a speaker (the bot nearest the point unless `by` is given) */
  private callOut(w: World, kind: PingKind, x: number, y: number, key: string, hold: number, by: PlayerId = -1): void {
    if (this.k.ffa) return;
    const now = w.time;
    if (this.comms.holds(key, now)) return;
    const sp = by >= 0 ? by : this.speaker(w, x, y);
    if (sp < 0) return;
    // (a warning about fighters in sight is said now or not at all: by the time a speaker's turn comes they have moved)
    this.comms.call({ kind, x, y, key, hold, by: sp, until: now + (kind === 'danger' || kind === 'retreat' ? 0.5 : 3) }, now);
  }

  /**
   * Ruling 65 — what the team says (pings through its fighters): a group call on a structure (push), a camp call
   * (objective), a structure of ours under enemy fighters (assist), a lost fight (retreat), and three or more enemy
   * fighters in sight together with a teammate alone in front of them (danger). Every point is something the team sees or
   * owns. Each event is said once (its key), through the team's budget.
   */
  private thinkCalls(w: World, aliveDiff: number): void {
    if (this.k.ffa || this.k.kind === 'practice') return;
    const now = w.time, d = this.diff, k = this.k;
    // (enemy fighters in sight now and at the last think, near where they were then: a recall landing or a blink is seen for a
    // moment on a sight already gone — never a call about it)
    const steady: Entity[] = [];
    for (const f of this.perc.enemyFighters) {
      const o = this.foePos.get(f.id);
      if (f.alive && o && now - o.t <= 0.6 && sq(o.x - f.x) + sq(o.y - f.y) <= 6 * 6) steady.push(f);
    }
    this.foePos.clear();
    for (const f of this.perc.enemyFighters) if (f.alive) this.foePos.set(f.id, { x: f.x, y: f.y, t: now });
    const tp = { enemyFighters: steady, allyFighters: this.perc.allyFighters };
    // push: a group call on a structure that has held 2 s (from 10:00 on a road map; at once on one road)
    const single = k.kind !== 'rift';
    const sg = this.siege;
    if (this.held(`pk${sg ? sg.id : -1}`, !!sg && this.group && (single || now >= 600) && (this.window || this.press || this.joined || this.rush || this.stage || this.phase === 'late'), now, 2) && sg) {
      this.callOut(w, 'push', sg.x, sg.y, `push:${sg.id}`, 45);
    }
    // objective: the camp call (desire 0.6+, held 2 s)
    const o = this.objective;
    if (o && this.held(`ok${o.camp.index}`, o.desire >= 0.6, now, 2)) this.callOut(w, 'objective', o.camp.x, o.camp.y, `obj:${o.camp.index}`, 60);
    if (k.kind !== 'rift') return;
    // assist: a structure of ours with enemy fighters on it (a post or base answer called for a fight)
    for (const g of this.guard.values()) {
      if (g.why !== 'fight' && g.why !== 'core') continue;
      this.callOut(w, 'assist', g.x, g.y, `def:${g.sid}`, 30);
    }
    if (now < 840 && this.phase !== 'late') return;
    // retreat: around one of ours, two or more of theirs over ours within 14 m, three or more of theirs (a lost fight)
    for (const a of tp.allyFighters) {
      if (!a.alive) continue;
      let ne = 0, na = 0;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - a.x) + sq(f.y - a.y) <= 14 * 14) ne++;
      if (ne < 3) continue;
      for (const b of tp.allyFighters) if (b.alive && sq(b.x - a.x) + sq(b.y - a.y) <= 14 * 14) na++;
      if (ne - na < 2 || na < 2 || aliveDiff > 0) continue;
      const by = a.player && this.botSeats.includes(a.player.player) ? a.player.player : this.speaker(w, a.x, a.y, -1, 25);
      if (by >= 0) this.callOut(w, 'retreat', a.x, a.y, `ret:${Math.round(a.x / 30)}:${Math.round(a.y / 30)}`, 15, by);
      break;
    }
    // danger: three or more enemy fighters in sight together, and a teammate alone 12-32 m from them
    if (!d.pingReads) return;
    for (const f of tp.enemyFighters) {
      if (!f.alive) continue;
      let n = 0, cx = 0, cy = 0;
      for (const g of tp.enemyFighters) if (g.alive && sq(g.x - f.x) + sq(g.y - f.y) <= 12 * 12) { n++; cx += g.x; cy += g.y; }
      if (n < 3) continue;
      cx /= n; cy /= n;
      for (const a of tp.allyFighters) {
        if (!a.alive) continue;
        const d2 = sq(a.x - cx) + sq(a.y - cy);
        if (d2 < 12 * 12 || d2 > 32 * 32) continue;
        let mates = 0;
        for (const b of tp.allyFighters) if (b !== a && b.alive && sq(b.x - a.x) + sq(b.y - a.y) <= 15 * 15) mates++;
        if (mates > 0) continue;
        const ap = a.player ? a.player.player : -1;
        let by = this.speaker(w, a.x, a.y, ap, 60);
        if (by < 0 && this.botSeats.includes(ap)) by = ap;
        if (by >= 0) this.callOut(w, 'danger', cx, cy, `dg:${Math.round(cx / 25)}:${Math.round(cy / 25)}`, 20, by);
        return;
      }
    }
  }

  /**
   * Ruling 65 — what the team heard from its people: a person's push on an enemy structure and a person's camp call are
   * weighed as team calls (thinkSiege / thinkObjective) for 25 s; the computer-played fighters' own calls are this brain's.
   */
  private thinkHeard(w: World): void {
    const now = w.time;
    const hs = this.comms.heard;
    if (this.pingPush && now > this.pingPush.until) this.pingPush = null;
    if (this.pingObj && now > this.pingObj.until) this.pingObj = null;
    if (this.k.kind !== 'rift') { this.heardSeen = hs.length > 0 ? hs[hs.length - 1].t : 0; return; }
    for (const h of hs) {
      if (h.t <= this.heardSeen) continue;
      if (!h.human) continue;
      if (h.kind === 'push') this.pingPush = { x: h.x, y: h.y, until: h.t + 25, by: h.player, on: false, asked: false };
      else if (h.kind === 'objective') this.pingObj = { x: h.x, y: h.y, until: h.t + 25, by: h.player };
    }
    if (hs.length > 0) this.heardSeen = hs[hs.length - 1].t;
  }

  /**
   * Ruling 65 — an assist ("help here") from a teammate — a person's ping, or a computer-played teammate's own call — is
   * answered by the nearest fit computer-played fighters within the tier's reach (assistReach), as many as the fight there
   * needs (one, two with two or more enemy fighters in sight there; at most assistMax), less those already on the way (a
   * person's onMyWay counts). Never into a lost fight: with more enemy fighters in sight there than ours could make even, no
   * one is sent. Not a fighter in a fight of its own, recalling, posted, answering or hunting; in the laning phase only the
   * road's own laners and the grovehunter. Each answerer says onMyWay. The answer ends 8 s after the call, or once the place
   * is quiet with the answerer there.
   */
  private thinkAssist(w: World): void {
    const now = w.time, tp = this.perc, d = this.diff;
    for (const [p, h] of [...this.helpers]) {
      const e = w.players[p]?.ent;
      let quiet = true;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - h.x) + sq(f.y - h.y) <= 18 * 18) { quiet = false; break; }
      if (!e || !e.alive || now > h.until || e.hp < e.maxHp * 0.35 || (quiet && sq(e.x - h.x) + sq(e.y - h.y) <= 10 * 10)) this.helpers.delete(p);
    }
    for (const [p, a] of [...this.selfAssist]) if (now - a.t > 6) this.selfAssist.delete(p);
    if (this.k.kind !== 'rift' || d.assistReach <= 0) return;
    const calls: { x: number; y: number; t: number; from: PlayerId }[] = [];
    for (const h of this.comms.heard) if (h.human && h.kind === 'assist' && now - h.t <= 6) calls.push({ x: h.x, y: h.y, t: h.t, from: h.player });
    for (const [p, a] of this.selfAssist) calls.push({ x: a.x, y: a.y, t: a.t, from: p });
    for (const c of calls) {
      const key = `as:${c.from}:${Math.round(c.t * 10)}`;
      let foes = 0, ours = 0;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 15 * 15) foes++;
      for (const f of tp.allyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 20 * 20) ours++;
      const need = Math.min(d.assistMax, foes >= 2 ? 2 : 1);
      let have = 0;
      for (const h of this.helpers.values()) if (h.key === key) have++;
      for (const h of this.comms.heard) if (h.human && h.kind === 'onMyWay' && h.t >= c.t && h.player !== c.from && sq(h.x - c.x) + sq(h.y - c.y) <= 30 * 30) have++;
      if (have >= need) continue;
      // (never into a lost fight: more of theirs there than ours could make even)
      if (foes > ours + need + 1) continue;
      const laning = now < 840 && this.phase !== 'late';
      const cl = laning ? this.nearestLaneOf(c.x, c.y) : -1;
      const cand: { p: PlayerId; dd: number }[] = [];
      for (const p of this.botSeats) {
        if (p === c.from || this.helpers.has(p) || this.guard.has(p) || this.answer.has(p) || this.hunters.has(p) || this.pushers.has(p)) continue;
        const e = w.players[p]?.ent;
        if (!e || !e.alive || e.hp < e.maxHp * 0.55 || e.stateOverride === 'recall') continue;
        const dd = dhypot(e.x - c.x, e.y - c.y);
        if (dd > d.assistReach || dd < 6) continue;
        let busy = false;
        for (const f of tp.enemyFighters) if (f.alive && sq(f.x - e.x) + sq(f.y - e.y) <= 12 * 12 && sq(f.x - c.x) + sq(f.y - c.y) > 20 * 20) { busy = true; break; }
        if (busy) continue;
        const a = this.assign.get(p);
        if (laning && !(a?.jungle || (a && a.lane === cl))) continue;
        cand.push({ p, dd });
      }
      cand.sort((x, y) => x.dd - y.dd || x.p - y.p);
      for (const cd of cand) {
        if (have >= need) break;
        this.helpers.set(cd.p, { x: c.x, y: c.y, until: now + 8, key });
        this.callOut(w, 'onMyWay', c.x, c.y, `omw:${key}:${cd.p}`, 20, cd.p);
        have++;
      }
    }
  }

  /** the road nearest (x, y) (-1: none within 25 m) */
  private nearestLaneOf(x: number, y: number): number {
    let bl = -1, bd = 25 * 25;
    for (const l of this.k.lanes) { const pr = this.projectTo(l.index, x, y); if (pr.d2 < bd) { bd = pr.d2; bl = l.index; } }
    return bl;
  }

  /**
   * owner_rulings 44 — punish an invader (RIFT, tiers with punishInvade, from punishFrom): an enemy fighter in our sight in
   * our own half of the Dialwood (off every road by 9 m, nearer our fountain than theirs, outside its own towers' cover) with
   * no other enemy fighter seen within 14 m, in sight for punishDelay s, is hunted by up to punishInvade fighters above 60 %
   * health that can be on it within 14 s (the grovehunter first) — together at least as strong as it. The hunt holds while it
   * stays in our half and is seen (3 s grace), at most 20 s; it ends at once when a second enemy fighter turns up beside it.
   * The genre's veteran: an invader caught in your jungle at 8:00 is a free kill for the two nearest players, not a sight to
   * ignore while it takes your camps for a minute.
   */
  private thinkInvader(w: World): void {
    const k = this.k, d = this.diff, now = w.time, tp = this.perc;
    const prev = this.invader;
    this.invader = null;
    if (k.kind !== 'rift' || d.punishInvade <= 0 || now < d.punishFrom || this.rush || this.stage) { this.hunters.clear(); return; }
    const own = k.bases.find((b) => b.team === this.team), foe = k.bases.find((b) => b.team !== this.team);
    if (!own || !foe) { this.hunters.clear(); return; }
    let best: Entity | null = null, bs = -Infinity;
    for (const f of tp.enemyFighters) {
      if (!f.alive || (f.visibleMask & tp.bit) === 0) continue;
      const mine = sq(f.x - own.fx) + sq(f.y - own.fy) < sq(f.x - foe.fx) + sq(f.y - foe.fy);
      let offRoad = true;
      for (const l of k.lanes) if (this.projectTo(l.index, f.x, f.y).d2 < 9 * 9) { offRoad = false; break; }
      let alone = true;
      for (const g of tp.enemyFighters) if (g !== f && g.alive && sq(g.x - f.x) + sq(g.y - f.y) <= 14 * 14) { alone = false; break; }
      let covered = false;
      for (const st of tp.enemyStructs) if (st.alive && st.attackDef && sq(st.x - f.x) + sq(st.y - f.y) <= sq(st.stats.range + st.radius + 4)) { covered = true; break; }
      // (owner_rulings 44, collapseRoads: from 14:00 a lone enemy on a road in our half, out of its towers' cover, too)
      const ok = mine && (offRoad || (d.collapseRoads && now >= 840)) && alone && !covered;
      if (!this.held(`inv${f.id}`, ok, now, prev === f ? 0 : d.punishDelay)) continue;
      const sc = (prev === f ? 1 : 0) - f.hp / Math.max(1, f.maxHp);
      if (sc > bs) { bs = sc; best = f; }
    }
    if (best !== prev) { this.hunters.clear(); if (best) this.invaderUntil = now + 20; }
    if (!best || now > this.invaderUntil) { this.hunters.clear(); return; }
    this.invader = best;
    // keep the hunters that still can; fill up by arrival time
    const tgt = best;
    for (const p of [...this.hunters]) { const e = w.players[p]?.ent; if (!e || !e.alive || e.hp < e.maxHp * 0.4) this.hunters.delete(p); }
    const powerOf = (e: Entity): number => (e.hp + e.shield) * Math.max(1, e.stats.ad * e.stats.attackSpeed + e.stats.ap * 0.6 + e.level * 12);
    let pw = 0;
    for (const p of this.hunters) { const e = w.players[p]?.ent; if (e) pw += powerOf(e); }
    while (this.hunters.size < d.punishInvade) {
      let bp: PlayerId = -1, bt = Infinity;
      for (const p of w.players) {
        if (!p || p.team !== this.team || this.hunters.has(p.player) || this.guard.has(p.player) || this.answer.has(p.player)) continue;
        const e = p.ent;
        if (!e || !e.alive || e.hp < e.maxHp * 0.6 || e.stateOverride === 'recall') continue;
        const jg = this.assign.get(p.player)?.jungle ?? false;
        const eta = dhypot(e.x - tgt.x, e.y - tgt.y) * 1.2 / Math.max(1, e.stats.moveSpeed) - (jg ? 4 : 0);
        // (ruling 55: in the laning phase a laner leaves its road for the hunt only when the invader is at hand — 7 s;
        // the grovehunter answers from 14 s — the road's wave and level come first)
        if (eta > (!jg && now < 840 ? 7 : 14) || eta >= bt) continue;
        bt = eta; bp = p.player;
      }
      if (bp < 0) break;
      this.hunters.add(bp);
      const e = w.players[bp]?.ent; if (e) pw += powerOf(e);
    }
    // (never a fair fight called a punish: the hunters together at least as strong as the invader, else nobody goes)
    if (pw < powerOf(tgt) * 0.9) { this.hunters.clear(); this.invader = null; }
  }

  /**
   * Lane AI G1 — structure defence (RIFT). Every own structure with visible enemy fighters at it needs
   * ceil((fighters + 1 at an inner or base structure) × defendMatch) defenders; an inner or base structure with a
   * stacked wave and no enemy fighter (a wave into the base, or a backdoor of Wicks) needs one. In the laning phase an
   * outer Needle with no more enemy fighters than its road has laners is laning, not a call. Defenders are picked
   * greedily by arrival time — the walk, or the recall plus the walk from the fountain when the tier recalls to that
   * class — never below 35 % health, and keep their post (no switching calls) until the threat has been gone for
   * defendHold s. Inner and base calls wait at most 5 s of the tier's macroDelay; outer calls wait all of it.
   */
  private thinkGuard(w: World): void {
    const k = this.k, tp = this.perc, now = w.time, d = this.diff;
    // (ruling 60: posts are off at every tier — guardPosts — the measured cause of the round-1 package's pace cost; the code
    // stays for a later round that pays for it)
    // (ruling 64: with the posts off, a tier with a base answer still answers a base structure being hit — thinkBaseAnswer)
    // (ruling 65: posts are back where a tier pays for them — veteran from the inner Needles, adept at the base — guardFrom)
    const posts = d.guardPosts, from = d.guardFrom;
    if (k.kind !== 'rift' || !posts) { if (k.kind === 'rift' && d.baseAnswerDelay < Infinity && now < d.baseAnswerUntil) this.thinkBaseAnswer(w); else this.guard.clear(); return; }
    for (const [p, g] of this.guard) {
      const e = w.players[p]?.ent;
      // (a post whose structure has fallen is over at once: its defenders stood at the rubble while the next structure
      // of the base fell 20 m away — owner_rulings 42)
      if (!e || !e.alive || e.hp < e.maxHp * 0.25 || now > g.until || !this.ownStanding(g.sid)) this.guard.delete(p);
    }
    const laning = now < 840 && !this.rush && !this.stage && this.phase !== 'late';
    // (from 25:00 the game is closing: a structure gets as many defenders as it has divers, not one more — long death timers
    // decide it, and a base that always out-numbers its attackers turns the late game into a stall; owner_rulings 40)
    const closing = now >= 1500;
    const base = k.bases.find((b) => b.team === this.team);
    const rt = k.rules.recall ? recallTime(w) : Infinity;
    // (owner_rulings 44: own structures' health is the owner's to know — a drop since the last think is a hit, seen or not)
    const hurt = new Set<Entity>();
    const dt = now - this.lastGuardAt;
    this.lastGuardAt = now;
    for (const st of tp.allyStructs) {
      if (!st.alive) continue;
      const prev = this.structHp.get(st.id);
      if (prev !== undefined && st.hp < prev - 1) { hurt.add(st); this.structHitAt.set(st.id, now); }
      else if (now - (this.structHitAt.get(st.id) ?? -1e9) <= 2) hurt.add(st);
      // (ruling 55: the loss rate — half the last think's drop, half the history; a structure regaining health reads 0)
      if (prev !== undefined && dt > 0 && dt < 3) this.structLoss.set(st.id, (this.structLoss.get(st.id) ?? 0) * 0.5 + Math.max(0, prev - st.hp) / dt * 0.5);
      this.structHp.set(st.id, st.hp);
    }
    const threats: { st: Entity; info: StructInfo; cls: StructClass; value: number; need: number; n: number; ttl: number; why: Guard['why'] }[] = [];
    /** ruling 55: structures with Wicks alone on them, by map id: seconds until they fall at the present loss */
    const doomTtl = new Map<string, number>();
    // (owner_rulings 44: each enemy fighter threatens the one own structure it is hitting, else the nearest one it can hurt — a
    // push on the Bell Needles is theirs, not a "coming" threat on the untouched Lantern beside them, which held a full-health
    // veteran posted 3 m from it, idle, while all five enemies took both Bell Needles and the Hourbell 14-21 m away)
    const nearestOwn = new Map<Entity, Entity>();
    for (const f of tp.enemyFighters) {
      if (!f.alive) continue;
      let bs: Entity | null = null, bd = Infinity;
      const at = f.atkTarget >= 0 ? w.entity(f.atkTarget) : undefined;
      if (at && at.kind === 'structure' && at.team === this.team && at.alive) bs = at;
      else for (const st of tp.allyStructs) { if (!st.alive || !st.targetable) continue; const d2 = sq(f.x - st.x) + sq(f.y - st.y); if (d2 < bd) { bd = d2; bs = st; } }
      if (bs) nearestOwn.set(f, bs);
    }
    for (const st of tp.allyStructs) {
      // (a structure its guards still shield cannot be hurt: no threat — the Bell Needles behind a standing Lantern)
      if (!st.alive || !st.targetable) continue;
      const info = this.structInfoOf(st);
      if (!info) continue;
      const cls = this.classOf(info);
      if (cls < from) continue;
      const value = this.valueOf(info);
      const reach = Math.max(9, info.range + info.radius + 6);
      let n = 0, minions = 0, mine = 0, coming = 0, hitting = 0;
      // (an inner or base structure that is the front of its road — everything in front of it has fallen — is defended
      // before the push reaches it: enemy fighters within 28 m count, as a player holds the next tower)
      const front = cls > 0 && !laning && info.requires.every((r) => !this.ownStanding(r));
      for (const f of tp.enemyFighters) {
        if (!f.alive) continue;
        const d2 = sq(f.x - st.x) + sq(f.y - st.y);
        const mineF = nearestOwn.get(f) === st;
        if (f.atkTarget === st.id) hitting++;
        if (d2 <= reach * reach) { if (mineF || d2 <= 9 * 9) n++; }
        else if (front && d2 <= 28 * 28 && mineF) coming++;
      }
      // (ruling 55: what the Wicks on it deal — a wave-only call goes to a defender that can be there before it falls)
      let wdps = 0;
      for (const u of tp.enemyUnits) if (u.alive && u.kind === 'minion' && sq(u.x - st.x) + sq(u.y - st.y) <= reach * reach) { minions++; if (u.atkTarget === st.id) wdps += u.stats.ad * u.stats.attackSpeed * 0.7; }
      for (const u of tp.allyUnits) if (u.alive && u.kind === 'minion' && sq(u.x - st.x) + sq(u.y - st.y) <= reach * reach) mine++;
      let need = 0;
      // (ruling 55: a beginner answers a structure only once it is being hit — it does not read a push coming or a fighter beside
      // the tower as a threat; posting on every sighting kept novice games 2.7 min longer than the pre-lane bots')
      if (!d.anticipates && !(hitting > 0 || hurt.has(st))) { n = 0; if (cls < 2) coming = 0; }
      // (ruling 55: a lone enemy fighter near the front structure with no wave over ours is not a push — farming its wave, walking by,
      // or waiting in the fog; posting against it held a defender off its road for nothing: 'coming' posts were the biggest single
      // share of the defend time, 14-38 s a fighter a game)
      if (coming > 0 && coming < 2 && minions - mine < 2) coming = 0;
      if (n > 0) {
        // (one more than the divers at an inner or base structure — not in the laning phase, where the roads hold first)
        if (!(cls <= 1 && laning && n <= this.lanersOn(info.lane))) need = Math.max(1, Math.ceil((n + (cls > 0 && !laning && !closing ? 1 : 0)) * d.defendMatch - 1e-9));
      } else if (coming > 0) need = Math.max(1, Math.ceil(coming * d.defendMatch - 1e-9));
      // (owner_rulings 44: a big wave — eight or more over ours — is two defenders' work, as is a wave on a structure under half)
      // (round 2: a stacked wave of fourteen or more over ours is three — the late game's 18-33 Wick stacks took Lanterns from
      // two defenders; scaled by the tier's defendMatch)
      // (ruling 55: in the laning phase a wave at an inner Needle is its road's to clear — only the base takes a defender
      // off a road for Wicks; the round-2 bots' solo laners spent 2-4 % of the laning phase posted to waves, against 1 %)
      // (ruling 55: a wave alone calls a defender only where the tier's defender holds against the wave (holdWave, and
      // from 25:00 the base only) — a beginner, or a late inner post, backed off the wave it was sent to and stood fit beside
      // the structure while the Wicks took it: novice falls to Wicks beside two fit defenders 0.61 → 0.91 a game)
      else if (d.holdWave && cls > (laning ? 1 : closing ? 1 : 0) && minions - mine >= 4) {
        need = Math.max(1, Math.ceil((minions - mine >= 14 && !closing ? 3 : minions - mine >= 8 || st.hp < st.maxHp * 0.5 ? 2 : 1) * d.defendMatch - 1e-9));
      }
      // (owner_rulings 44: the core under fighter attack — the Hourbell or a Bell Needle hit, or hurt with enemy fighters at
      // it — is the whole team's call at a tier that defends the core (coreAll): every fit fighter that can be there in time)
      const coreHit = value >= 4 && (hitting > 0 || (n > 0 && hurt.has(st)));
      if (coreHit && d.coreAll) need = Math.max(need, 5);
      const delay = cls === 0 ? d.macroDelay : coreHit ? Math.min(d.macroDelay, 1) : Math.min(d.macroDelay, 5);
      if (!this.held(`g:${info.id}`, need > 0, now, delay)) need = 0;
      // (ruling 55: what the structure is losing, seen on its own health, when that is more than the Wicks' estimate)
      const loss = Math.max(wdps, this.structLoss.get(st.id) ?? 0);
      const ttl = n + coming === 0 && !coreHit && loss > 0 ? (st.hp + st.shield) / loss : Infinity;
      if (ttl < Infinity) doomTtl.set(info.id, ttl);
      // (ruling 55: a team that has just won its fight — two up, or the enemy's long respawn clocks — sends one defender to a
      // wave alone and presses with the rest: the whole team walking home to clear Wicks gave the beaten team its minute back)
      if (this.window && n + coming === 0 && !coreHit) need = Math.min(need, 1);
      if (need > 0) threats.push({ st, info, cls, value: value + (coreHit ? 0.5 : 0), need, n: n + coming, ttl, why: coreHit && d.coreAll ? 'core' : n > 0 ? 'fight' : coming > 0 ? 'coming' : 'wave' });
    }
    // (ruling 55: a post at a structure the Wicks alone will take before its defender is there is handed back — walking up to
    // watch it fall was most of the 'falls to Wicks beside fit defenders' left at veteran: defenders 15 m off when it had
    // seconds left. The defender meets the push at the next structure, or goes on with the plan)
    for (const [p, g] of [...this.guard]) {
      const t = doomTtl.get(g.sid), e = w.players[p]?.ent;
      if (t === undefined || !e) continue;
      const dist = dhypot(e.x - g.x, e.y - g.y);
      if (dist <= g.reach + 4) continue;
      if ((dist - g.reach - 2) * 1.15 / Math.max(1, e.stats.moveSpeed) + 1 > t) this.guard.delete(p);
    }
    // (owner_rulings 44: the most valuable structure first — the Hourbell, then its Bell Needles, the Lanterns, the inner and the
    // outer Needles — then the bigger push; map order breaks ties: deterministic)
    threats.sort((a, b) => b.value - a.value || b.n - a.n);
    const valueOfPost = new Map<string, number>();
    for (const th of threats) if (!valueOfPost.has(th.info.id)) valueOfPost.set(th.info.id, th.value);
    // (a post on a structure that is no longer threatened is worth nothing while another is: handed on below)
    for (const th of threats) {
      const { st, info, cls } = th;
      let have = 0;
      for (const g of this.guard.values()) if (g.sid === info.id) { have++; g.until = now + d.defendHold; }
      // where to stand: inside the tower's reach on the home side (fight the diver under it, never in front of it)
      const reach = info.attacks ? Math.max(0, info.range + info.radius - 1) : 0;
      let sx = st.x, sy = st.y;
      if (base) {
        const dx = base.fx - st.x, dy = base.fy - st.y, dd = dhypot(dx, dy) || 1;
        const off = info.attacks ? Math.min(reach * 0.5, 3.5) : info.radius + 1.5;
        sx = st.x + (dx / dd) * off; sy = st.y + (dy / dd) * off;
      }
      const recallOk = !!base && rt < Infinity && (d.recallDefend === 'inner' ? cls >= 1 : d.recallDefend === 'base' ? cls >= 2 : false);
      // (ruling 55: in the laning phase an inner Needle's post is for a defender 15 s off at most — the roads come first)
      const cap = cls === 2 ? 45 : cls === 1 ? (laning ? 15 : 30) : 20;
      const elig = (p: (typeof w.players)[number]): { eta: number; rec: boolean } | null => {
        if (!p || p.team !== this.team) return null;
        const cur = this.guard.get(p.player);
        // (owner_rulings 44: a post is dropped the moment a more valuable structure in reach is threatened — a defender
        // posted to a lesser threat, or to a quiet structure, is taken for this one)
        if (cur && (cur.sid === info.id || (valueOfPost.get(cur.sid) ?? 0) >= th.value)) return null;
        if (!cur && (this.guardDeclined.get(p.player) ?? -1) > now && th.value < 4) return null;
        const e = p.ent;
        if (!e || !e.alive || e.hp < e.maxHp * 0.35) return null;
        // (the laning phase's grovehunter keeps its clear and its ganks at the outer Needles: an inner or base call
        // takes it — kept off the inner Needles too, a fighter siege there went unanswered 22 % of the time, veteran)
        if (laning && cls < 1 && this.assign.get(p.player)?.jungle) return null;
        // (ruling 55: and an outer Needle in the laning phase is its own road's to hold — a dive there does not post the
        // other roads' laners across the map: the solo laners spent 2.8-3.9 % of the laning phase in defend mode, against 1.0-1.3 %
        // for the pre-lane bots, most of the laners' in-lane share lost)
        if (laning && cls < 1 && this.assign.get(p.player)?.lane !== info.lane) return null;
        // (ruling 55: an inner Needle in the laning phase is its road's laners' and the grovehunter's — the other roads hold theirs)
        if (laning && cls === 1 && !this.assign.get(p.player)?.jungle && this.assign.get(p.player)?.lane !== info.lane) return null;
        const ms = Math.max(1, e.stats.moveSpeed);
        const dist = dhypot(e.x - st.x, e.y - st.y);
        const walk = dist < 14 ? 0 : dist * 1.25 / ms;
        let eta = walk, rec = false;
        if (recallOk && base && dist > 45) {
          const r = rt + dhypot(base.fx - st.x, base.fy - st.y) * 1.15 / ms;
          if (r + 8 <= walk) { eta = r; rec = true; }
        }
        // (a defender already posted is taken only when it is close: the lesser post keeps one farther off)
        if (eta > (cur ? Math.min(cap, 20) : cap)) return null;
        // (ruling 55: a wave-only call is not answered by a defender that would arrive to watch it fall — the Wicks'
        // structure falls before the walk ends: two fit defenders arriving as a 21-Wick stack finished a Lantern were the
        // commonest 'fell to Wicks beside fit defenders' left)
        if (eta + 2 > th.ttl) return null;
        return { eta, rec };
      };
      while (have < th.need) {
        let best: PlayerId = -1, bt = Infinity, bRecall = false;
        for (const p of w.players) {
          const el = elig(p);
          if (!el || el.eta >= bt) continue;
          bt = el.eta; best = p.player; bRecall = el.rec;
        }
        if (best < 0) break;
        this.guard.set(best, { sid: info.id, x: st.x, y: st.y, standX: sx, standY: sy, reach, cls, recall: bRecall, until: now + d.defendHold, since: now, why: th.why });
        // (ruling 65: a defender sent from afar to enemy fighters at the structure says it is coming)
        const be = w.players[best]?.ent;
        if ((th.why === 'fight' || th.why === 'core' || th.why === 'coming') && be && dhypot(be.x - st.x, be.y - st.y) > 20 && this.botSeats.includes(best)) this.callOut(w, 'onMyWay', st.x, st.y, `omw:post:${info.id}:${best}`, 25, best);
        have++;
      }
    }
    // (a post at a structure nobody threatens any more is ended while another structure is short of defenders)
    let short = false;
    for (const th of threats) {
      let have = 0;
      for (const g of this.guard.values()) if (g.sid === th.info.id) have++;
      if (have < th.need) { short = true; break; }
    }
    if (short) for (const [p, g] of [...this.guard]) if (!valueOfPost.has(g.sid)) this.guard.delete(p);
  }

  /**
   * Ruling 64 — the base answer (RIFT, while the posts are off): a base structure (a Lantern, a Bell Needle, the Hourbell)
   * that enemy fighters are hitting — seen swinging at it, or its health dropping with them beside it — gets the nearest fit
   * fighters within 80 m, as many as hit it × defendMatch (one more at the core). A wave alone is not answered: no tier holds
   * a wave (holdWave), and a defender sent to one backs off it and stands beside the structure while it falls. The answer goes through the post machinery (execGuard) and ends 1.5 s
   * after the hits stop: the posts' defendHold, the +1 at every base structure, the 'coming' read and the inner posts are
   * what made the round-1 package's games long (ruling 62), and none of them is here.
   */
  private thinkBaseAnswer(w: World): void {
    const tp = this.perc, now = w.time, d = this.diff;
    // own structures' health is the owner's to know: a drop since the last think is a hit, seen or not
    const hurt = new Set<number>();
    for (const st of tp.allyStructs) {
      if (!st.alive) continue;
      const prev = this.structHp.get(st.id);
      if (prev !== undefined && st.hp < prev - 1) this.structHitAt.set(st.id, now);
      if (now - (this.structHitAt.get(st.id) ?? -1e9) <= BA_HIT) hurt.add(st.id);
      this.structHp.set(st.id, st.hp);
    }
    for (const [p, g] of this.guard) {
      const e = w.players[p]?.ent;
      if (!e || !e.alive || e.hp < e.maxHp * 0.35 || now > g.until || !this.ownStanding(g.sid)) this.guard.delete(p);
    }
    const base = this.k.bases.find((b) => b.team === this.team);
    for (const st of tp.allyStructs) {
      if (!st.alive || !st.targetable) continue;
      const info = this.structInfoOf(st);
      if (!info || this.classOf(info) < 2) continue;
      const reach = Math.max(9, info.range + info.radius + 6);
      let hitting = 0, near = 0;
      for (const f of tp.enemyFighters) {
        if (!f.alive) continue;
        if (f.atkTarget === st.id) hitting++;
        if (sq(f.x - st.x) + sq(f.y - st.y) <= reach * reach) near++;
      }
      const isHurt = hurt.has(st.id);
      const fighters = Math.max(hitting, isHurt ? near : 0);
      const value = this.valueOf(info);
      const need = fighters > 0 ? Math.max(1, Math.ceil((fighters + (value >= 4 ? 1 : 0)) * d.defendMatch - 1e-9)) : 0;
      if (!this.held(`ba:${info.id}`, need > 0, now, Math.min(d.macroDelay, d.baseAnswerDelay)) || need === 0) continue;
      let have = 0;
      for (const g of this.guard.values()) if (g.sid === info.id) { have++; g.until = now + BA_HOLD; }
      if (have >= need) continue;
      const sreach = info.attacks ? Math.max(0, info.range + info.radius - 1) : 0;
      let sx = st.x, sy = st.y;
      if (base) {
        const dx = base.fx - st.x, dy = base.fy - st.y, dd = dhypot(dx, dy) || 1;
        const off = info.attacks ? Math.min(sreach * 0.5, 3.5) : info.radius + 1.5;
        sx = st.x + (dx / dd) * off; sy = st.y + (dy / dd) * off;
      }
      const cand: { p: PlayerId; dd: number }[] = [];
      for (const p of w.players) {
        if (!p || p.team !== this.team || this.guard.has(p.player)) continue;
        if ((this.guardDeclined.get(p.player) ?? -1) > now) continue;
        const e = p.ent;
        if (!e || !e.alive || e.hp < e.maxHp * BA_HP || e.stateOverride === 'recall') continue;
        const dd = dhypot(e.x - st.x, e.y - st.y);
        if (dd > BA_CAP) continue;
        // (a fighter in a fight of its own elsewhere keeps it)
        let busy = false;
        if (dd > reach + 4) for (const f of tp.enemyFighters) if (f.alive && sq(f.x - e.x) + sq(f.y - e.y) <= BA_BUSY * BA_BUSY) { busy = true; break; }
        if (busy) continue;
        cand.push({ p: p.player, dd });
      }
      cand.sort((a, b) => a.dd - b.dd || a.p - b.p);
      for (const c of cand) {
        if (have >= need) break;
        this.guard.set(c.p, { sid: info.id, x: st.x, y: st.y, standX: sx, standY: sy, reach: sreach, cls: 2, recall: false, until: now + BA_HOLD, since: now, why: value >= 4 ? 'core' : 'fight' });
        have++;
      }
    }
  }

  /** owner_rulings 44: what a structure is worth defending — the Hourbell 5, its Bell Needles 4, a Lantern or other base
   *  structure 3, an inner Needle 2, an outer one 1 */
  valueOf(info: StructInfo): number {
    if (info.isCore) return 5;
    if (this.coreGuards.has(info.id)) return 4;
    const c = this.classOf(info);
    return c === 2 ? 3 : c === 1 ? 2 : 1;
  }

  /**
   * Lane AI G6 — split push (tiers with splitPush, RIFT mid and late game, while the team groups with four or more up):
   * one diver or skirmisher with an escape takes the road opposite the siege; the road is safe while at most one enemy
   * fighter was seen near it in the last 8 s and fewer than two enemies are missing.
   */
  private thinkSplit(w: World): void {
    const k = this.k, d = this.diff, now = w.time;
    const on = d.splitPush && k.kind === 'rift' && this.phase !== 'early' && this.group && !this.rush && !this.stage && this.aliveAllies >= 4 && this.siegeLane >= 0 && k.lanes.length >= 3;
    if (!on) { this.splitSeat = -1; this.splitLane = -1; this.splitSafe = false; return; }
    const cur = this.splitSeat >= 0 ? w.players[this.splitSeat]?.ent : null;
    if (!cur || !cur.alive || cur.hp < cur.maxHp * 0.4) {
      this.splitSeat = -1;
      let bs = -Infinity;
      for (const p of w.players) {
        if (!p || p.team !== this.team) continue;
        const e = p.ent;
        if (!e || !e.alive || e.hp < e.maxHp * 0.7) continue;
        const prof = k.profiles.get(e.def);
        if (!prof || (prof.style !== 'diver' && prof.style !== 'skirmisher')) continue;
        let esc = false;
        for (let i = 0; i < 4; i++) { const sl = e.slots[i]; if (sl && (abilityInfo(sl.def).use & U_ESCAPE)) { esc = true; break; } }
        if (!esc) continue;
        const sc = e.level + (this.assign.get(p.player)?.jungle ? -3 : 0);
        if (sc > bs) { bs = sc; this.splitSeat = p.player; }
      }
    }
    if (this.splitSeat < 0) { this.splitLane = -1; this.splitSafe = false; return; }
    // the road farthest from the siege, the one with more of our Wicks on it first
    let bl = -1, bv = -Infinity;
    for (const l of k.lanes) {
      if (l.index === this.siegeLane) continue;
      const v = Math.abs(l.index - this.siegeLane) * 3 + this.perc.ownN[l.index] - this.perc.enemyN[l.index] * 0.5;
      if (v > bv) { bv = v; bl = l.index; }
    }
    this.splitLane = bl;
    let seen = 0;
    if (bl >= 0) for (const ls of this.perc.lastSeen.values()) if (now - ls.t <= 8 && this.projectTo(bl, ls.x, ls.y).d2 <= 25 * 25) seen++;
    this.splitSafe = bl >= 0 && seen <= 1 && this.missing < 2;
  }

  /**
   * From the mid game (RIFT, tiers that readsWaves): a road under threat — a dive or a stacked wave at one of
   * our structures (published defend calls), or four or more enemy Wicks deep in our half with two fewer of ours
   * to meet them — gets one fighter (two for a dive by two or more or a wave six ahead): the nearest ones above
   * 60 % health, never the grovehunter, the road's own laner first when it is not much farther. The rest keep
   * the plan. (Integ done:5: a stack five or more over ours is read as it crosses the river, a stack eight over ours
   * at a structure gets two, and a big stack with no Needle of ours left in its way is met behind the Lantern it
   * walks into.)
   */
  private thinkAnswers(w: World): void {
    this.answer.clear();
    const k = this.k, now = w.time;
    if (k.kind !== 'rift' || this.phase === 'early' || this.rush || !this.diff.readsWaves) { this.answerUntil.clear(); return; }
    this.answerFill(w);
    // (round 2: an answer stands DEFEND_STICK s after it was last given, while its fighter is fit — see delayDefend)
    // (ruling 55: no stand-on in the laning phase, as for the defend calls)
    if (now >= 840) for (const [p, lane] of this.answer) this.answerUntil.set(p, { lane, until: now + stickOf(k) });
    for (const [p, a] of [...this.answerUntil]) {
      const e = w.players[p]?.ent;
      if (now > a.until || !e || !e.alive || e.hp < e.maxHp * 0.5) { this.answerUntil.delete(p); continue; }
      if (!this.answer.has(p)) this.answer.set(p, a.lane);
    }
  }

  private answerFill(w: World): void {
    const k = this.k, tp = this.perc, now = w.time;
    for (const l of k.lanes) {
      const i = l.index;
      let need = 0, x = 0, y = 0;
      const surplus = tp.enemyN[i] - tp.ownN[i];
      // (integ done:5: a stacked wave of eight or more at a structure is two fighters' work — one alone stands off it
      // under its waveGuard while the wave takes the structure)
      if (this.defend[i] > 0.05) { need = this.defendFighters[i] >= 2 || surplus >= 8 ? 2 : 1; x = this.defendX[i]; y = this.defendY[i]; }
      // (integ done:5: a stack of five or more over ours is read as it crosses the river, not once it is at the first
      // Needle — the answer has a road to walk, and a Needle falls to fifteen Wicks before it arrives)
      const deep = this.diff.readsWaves && tp.enemyN[i] >= 4 && surplus >= 2 && (tp.enemyFront[i] < l.length * 0.45 || (surplus >= 5 && tp.enemyFront[i] < l.length * 0.58));
      let big = false;
      if (this.held(`wave${i}`, deep, now) && need === 0) {
        need = surplus >= 6 ? 2 : 1;
        lanePoint(l, fromProgress(l, this.team, Math.max(0, tp.enemyFront[i] - 4)));
        x = proj.x; y = proj.y;
        // (W4 G1 refix: a stacked wave of six or more is met behind the first own Needle in its way, where the Needle
        // shares the hits — never in the open, where it surrounds a lone fighter and body-blocks its way out; integ
        // done:5: with no Needle of ours left in its way it is met behind the next structure it walks into (a Lantern),
        // by two — the base call fires only for structures off the roads, so a Lantern's road was left to its laner)
        if (surplus >= 6) {
          big = true;
          let bp = -1, br = 0, gp = -1, gr = 0;
          for (const st of k.structs) {
            if (st.team !== this.team || st.lane !== i || !this.structAlive(w, st)) continue;
            const p = progress(l, this.team, st.s);
            if (p > tp.enemyFront[i]) continue;
            if (st.attacks) { if (p > bp) { bp = p; br = st.radius; } }
            else if (p > gp) { gp = p; gr = st.radius; }
          }
          if (bp < 0 && gp >= 0) { bp = gp; br = gr; }
          if (bp < 0) need = 0;
          else { lanePoint(l, fromProgress(l, this.team, Math.max(0, bp - br - 2.5))); x = proj.x; y = proj.y; }
        }
      }
      if (need === 0) continue;
      this.answerX[i] = x; this.answerY[i] = y;
      // already there
      let there = 0;
      for (const f of tp.allyFighters) if (f.alive && sq(f.x - x) + sq(f.y - y) <= 20 * 20) there++;
      if (there >= need) continue;
      // (a wave, not a dive, never pulls a fighter off an objective the team is taking or waiting at)
      const oc = this.defend[i] > 0.05 ? null : this.objective?.camp ?? null;
      for (let n = there; n < need; n++) {
        let best: PlayerId = -1, bd = Infinity;
        for (const p of w.players) {
          if (!p || p.team !== this.team || this.answer.has(p.player)) continue;
          const e = p.ent;
          if (!e || !e.alive || e.hp < e.maxHp * (big ? 0.7 : 0.6)) continue;
          if (oc && sq(e.x - oc.x) + sq(e.y - oc.y) <= 30 * 30) continue;
          const a = this.assign.get(p.player);
          // (the grovehunter keeps its camps and objectives: the roads answer for the roads)
          if (a && a.jungle) continue;
          const own = !!a && a.lane === i && !a.jungle;
          const dd = Math.sqrt(sq(e.x - x) + sq(e.y - y)) * (own ? 0.67 : 1);
          if (dd < bd) { bd = dd; best = p.player; }
        }
        if (best < 0) break;
        this.answer.set(best, i);
      }
    }
  }

  /** macroDelay: true once `cond` has held for the tier's delay (resets the moment it fails) */
  private held(key: string, cond: boolean, now: number, delay = this.diff.macroDelay): boolean {
    if (!cond) { this.since.delete(key); return false; }
    let t = this.since.get(key);
    if (t === undefined) { t = now; this.since.set(key, t); }
    return now - t + 1e-9 >= delay;
  }

  /**
   * objectiveSense: seconds the team's living fighters above 45 % health need for a camp's monsters (their attacks
   * and a share for abilities against its armor, at 60 % efficiency: kiting, its sweeps and the walk in), from the
   * monsters in sight, else the camp's unit defs; and the health share left on the ones in sight (1 unseen)
   */
  private campTtk(w: World, c: CampInfo): { ttk: number; hpF: number } {
    let H = 0, M = 0, armor = 0, seen = 0;
    for (const m of this.perc.monsters) {
      if (!m.alive || Math.abs(m.x - c.x) >= 8 || Math.abs(m.y - c.y) >= 8) continue;
      H += m.hp + m.shield; M += m.maxHp; armor = Math.max(armor, m.stats.armor); seen++;
    }
    if (seen === 0) for (const u of c.units) { const def = this.k.idx.units.get(u); if (def) { H += def.base.hp ?? 0; armor = Math.max(armor, def.base.armor ?? 0); } }
    let S = 0;
    for (const p of w.players) {
      const f = p && p.team === this.team ? p.ent : null;
      if (!f || !f.alive || f.hp < f.maxHp * 0.45) continue;
      const st = f.stats;
      S += st.ad * st.attackSpeed * (1 + st.crit * 0.75) * (100 / (100 + Math.max(0, armor))) + st.ap * 0.5 + f.level * 10;
    }
    return { ttk: H / Math.max(1, S * 0.6), hpF: seen > 0 ? H / Math.max(1, M) : 1 };
  }

  private structAlive(w: World, s: StructInfo): boolean {
    for (const e of s.team === this.team ? this.perc.allyStructs : this.perc.enemyStructs) {
      if (e.alive && Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5) return true;
    }
    return false;
  }

  private updateCamps(w: World): void {
    const k = this.k, now = w.time, tp = this.perc;
    for (const c of k.camps) {
      if (c.objective) {
        const ov = w.objectives.find((o) => o.id === c.id);
        if (ov) this.campReady[c.index] = ov.alive ? now : now + ov.respawnIn;
        continue;
      }
      let up = false;
      for (const m of tp.monsters) if (m.alive && Math.abs(m.x - c.x) < 7 && Math.abs(m.y - c.y) < 7) { up = true; break; }
      if (up) { this.campReady[c.index] = Math.min(this.campReady[c.index], now); continue; }
      // the camp ground is in sight and empty: it was cleared; assume recently
      if (now >= this.campReady[c.index] && w.vision.seen(this.team, c.x, c.y)) this.campReady[c.index] = now + c.respawn * 0.6;
    }
  }
  /** a camp the team saw die (or killed): ready again after its respawn */
  campCleared(campIndex: number, now: number): void {
    const c = this.k.camps[campIndex];
    if (c) this.campReady[campIndex] = now + c.respawn;
  }

  private thinkDefend(w: World): void {
    const k = this.k, tp = this.perc;
    this.defend.fill(0);
    this.defendFighters.fill(0);
    this.baseThreat = 0;
    this.baseFighters = 0;
    for (const st of tp.allyStructs) {
      if (!st.alive) continue;
      const reach = Math.max(8, st.stats.range + st.radius + 5);
      let fighters = 0, minions = 0, mine = 0;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - st.x) + sq(f.y - st.y) <= reach * reach) fighters++;
      for (const u of tp.enemyUnits) if (u.alive && sq(u.x - st.x) + sq(u.y - st.y) <= reach * reach) minions++;
      for (const u of tp.allyUnits) if (u.alive && sq(u.x - st.x) + sq(u.y - st.y) <= reach * reach) mine++;
      if (fighters === 0 && minions < 3) continue;
      const hurt = st.hp < st.maxHp * 0.98 ? 1 : 0.6;
      const info = this.structInfoOf(st);
      const weight = info?.isCore ? 1.6 : info && (info.lane < 0 || !info.attacks) ? 1.3 : 1;
      const threat = Math.min(1, (fighters * 0.45 + Math.max(0, minions - mine) * 0.08) * hurt * weight);
      if (threat <= 0.05) continue;
      const lane = info ? info.lane : -1;
      if (lane < 0) this.baseFighters = Math.max(this.baseFighters, fighters);
      if (lane >= 0) {
        if (threat > this.defend[lane]) { this.defend[lane] = threat; this.defendX[lane] = st.x; this.defendY[lane] = st.y; this.defendFighters[lane] = fighters; }
      } else if (threat > this.baseThreat) { this.baseThreat = threat; this.baseX = st.x; this.baseY = st.y; }
    }
    void k;
  }

  /** macroDelay on defend calls: a threat is answered once it has held the tier's delay */
  private delayDefend(now: number): void {
    if (this.diff.macroDelay > 0) {
      for (let i = 0; i < this.defend.length; i++) {
        if (!this.held(`def${i}`, this.defend[i] > 0.05, now)) { this.defend[i] = 0; this.defendFighters[i] = 0; }
      }
      if (!this.held('base', this.baseThreat > 0.05, now)) this.baseThreat = 0;
    }
    // (owner_rulings 44, round 2: a defend call stands DEFEND_STICK s after its threat last showed — an attacker flickering in
    // and out of sight turned the call on and off every think, and the fighters it named paced between the road and the
    // structure: most of veteran's full-health back-and-forth walks)
    // (ruling 55: not in the laning phase — a road's dive call there is its laners' moment, and the 4 s it stood after the
    // dive ended kept the solo laners in defend mode 2.4-3.9 % of the laning phase, against 1.0-1.3 % for the pre-lane bots)
    const laning = now < 840 && this.phase !== 'late';
    const stick = stickOf(this.k);
    for (let i = 0; i < this.defend.length; i++) {
      if (laning) continue;
      if (this.defend[i] > 0.05) { this.stickDef[i] = now + stick; this.stickVal[i] = this.defend[i]; this.stickX[i] = this.defendX[i]; this.stickY[i] = this.defendY[i]; this.stickF[i] = this.defendFighters[i]; }
      else if (now < this.stickDef[i]) { this.defend[i] = this.stickVal[i]; this.defendX[i] = this.stickX[i]; this.defendY[i] = this.stickY[i]; this.defendFighters[i] = this.stickF[i]; }
    }
    if (this.baseThreat > 0.05) { this.stickBase = now + stick; this.stickBaseV = this.baseThreat; this.stickBaseX = this.baseX; this.stickBaseY = this.baseY; }
    else if (now < this.stickBase) { this.baseThreat = this.stickBaseV; this.baseX = this.stickBaseX; this.baseY = this.stickBaseY; }
  }

  structInfoOf(e: Entity): StructInfo | undefined {
    for (const s of this.k.structs) if (Math.abs(s.x - e.x) < 0.5 && Math.abs(s.y - e.y) < 0.5 && s.team === e.team) return s;
    return undefined;
  }

  private respawning(s: StructInfo): boolean { return s.respawns; }
  /** is the enemy structure of this map entry standing (as far as the team's perception holds it) */
  private structAliveInfo(s: StructInfo): boolean {
    for (const e of this.perc.enemyStructs) if (e.alive && Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5) return true;
    return false;
  }

  private thinkSiege(w: World, aliveDiff: number, levelDiff: number, enemyLost: number): void {
    const k = this.k, tp = this.perc;
    this.push.fill(0);
    // per-lane push desire: own wave there and its enemy laners away
    for (const l of k.lanes) {
      if (tp.ownN[l.index] >= 3 && tp.enemyN[l.index] <= 1) this.push[l.index] = 0.5;
    }
    const single = k.kind === 'bridge' || k.kind === 'brawl';
    let group = single;
    const now0 = w.time, d = this.diff;
    let won = aliveDiff >= 2 || (this.aliveEnemies <= 1 && this.aliveAllies >= 2);
    // (a tier that converts leads reads the scoreboard's respawn clocks: a body up with two enemies down for
    // 15 s more is still a won fight)
    if (d.convertsLeads && !won && aliveDiff >= 1) {
      let long = 0;
      for (const p of w.players) if (p && p.team !== this.team && p.ent && !p.ent.alive && p.respawnIn >= 15) long++;
      won = long >= 2;
    }
    // (ruling 65: a won defence counter-pushes — thinkCounter)
    if (now0 < this.counterUntil) won = true;
    this.window = this.held('window', won, now0);
    // a lead to press: the scoreboard's Gleam (two-team modes)
    let lead = 0;
    for (const t of w.teams) lead += t.team === this.team ? t.gold : -t.gold;
    this.gleamLead = lead;
    // (objectiveSense: a lead is pressed by fighters fit to press it — as many above 45 % health as the enemy has up)
    let fit = 0;
    for (const p of w.players) if (p && p.team === this.team && p.ent && p.ent.alive && p.ent.hp >= p.ent.maxHp * 0.45) fit++;
    this.press = this.held('press', d.convertsLeads && w.teams.length === 2 && lead >= d.leadGleam && aliveDiff >= 0 && (single || this.phase !== 'early') &&
      (!d.objectiveSense || k.kind !== 'rift' || fit >= Math.min(this.aliveEnemies, 3)), now0);
    // (owner_rulings 44, round 2 — closeOut: in the late game a lead of 3,000 Gleam is pressed by a tier that closes out even
    // if it does not convert early leads: adept teams 5,000-15,000 ahead from 20:00 lost their own Needles to the team behind
    // and ended at 34-39 minutes)
    if (!this.press && d.closeOut && k.kind === 'rift' && this.phase === 'late' && lead >= 3000 && aliveDiff >= 0 && fit >= Math.min(this.aliveEnemies, 3)) this.press = true;
    if (this.window || this.press) group = true;
    if (k.kind === 'rift') {
      if (this.phase === 'late') group = true;
      else if (this.phase === 'mid') group = (enemyLost > 0 && aliveDiff >= 1) || aliveDiff >= 2 || levelDiff >= 8 || w.time >= 900;
    }
    // choose the siege target among open enemy structures
    const prevSiege = this.siege;
    let best: Entity | null = null, bestInfo: StructInfo | undefined, bestScore = -Infinity;
    let towersLeft = 0;
    // (only towers that can be hit count: a tower held behind a standing gate — a Bell Needle behind its
    // Lantern — is reached through that gate, so the gate is the next target, not a dead end; W4 G5)
    for (const e of tp.enemyStructs) {
      const info = this.structInfoOf(e);
      if (info && !info.isCore && !this.respawning(info) && e.targetable) towersLeft++;
    }
    this.towersLeft = towersLeft;
    // the team's centre of mass (living fighters)
    let cx = 0, cy = 0, cn = 0;
    for (const f of tp.allyFighters) if (f.alive) { cx += f.x; cy += f.y; cn++; }
    if (cn > 0) { cx /= cn; cy /= cn; } else { cx = this.groupX; cy = this.groupY; }
    // (owner_rulings 44, closeOut: ahead — a fighter up, or 1,500 Gleam with nobody of ours down more than theirs — with the
    // enemy core open, the team goes for the core's guards and the core, not the next outer Needle: the late game's long
    // stalls were won teams walking back to the roads with the Bell Needles open)
    // (ruling 55: not in the laning phase — before 14:00 the roads hold, as CW3 CL-1 tuned them)
    const closeOut = d.closeOut && k.kind === 'rift' && this.phase !== 'early' && now0 >= 840 && this.aliveAllies >= 3 && (aliveDiff >= 1 || (lead >= 1500 && aliveDiff >= 0));
    for (const e of tp.enemyStructs) {
      if (!e.alive || !e.targetable) continue;
      const info = this.structInfoOf(e);
      if (!info) continue;
      let score: number;
      if (info.isCore) score = 1000;
      else if (closeOut && info.lane < 0 && !info.respawns) score = 900 - dhypot(e.x - cx, e.y - cy) * 0.5;
      // (closeOut: the way to the core — the middle road's Needles and its Lantern — before the other roads' towers)
      else if (closeOut && this.enemyCorePath.has(info.id)) score = (this.respawning(info) ? 600 : 300) - (e.hp / Math.max(1, e.maxHp)) * 10;
      // (round 2: with every tower down, the Lantern on the way to the core before the side roads' — a side Lantern relights to
      // be taken again, the middle one opens the Bell Needles)
      else if (this.respawning(info)) score = towersLeft === 0 ? 500 - dhypot(e.x - cx, e.y - cy) * 0.5 - (e.hp / Math.max(1, e.maxHp)) * 20 + (this.enemyCorePath.has(info.id) ? 60 : 0) : -1;
      else {
        // the least-pushed lane first: towers nearer our side score higher
        const l = info.lane >= 0 ? k.lanes[info.lane] : null;
        const p = l ? progress(l, this.team, info.s) / l.length : 1;
        score = 100 - p * 50 + (l ? tp.ownN[l.index] * 2 : 0) - (e.hp / Math.max(1, e.maxHp)) * 10;
        // (objectiveSense, W4 G3 refix: the tower the team is already on keeps it — a group that turns to another road
        // whenever a wave count changes walks the map instead of taking towers)
        if (d.objectiveSense && k.kind === 'rift' && e === prevSiege) score += 15;
        // (ruling 65: a won fight takes the structure in front of it — the nearest one to where the team stands — before
        // walking to the least-pushed road)
        if (k.kind === 'rift' && this.window && cn > 0) score += Math.max(0, 70 - dhypot(e.x - cx, e.y - cy)) * 2;
      }
      if (score > bestScore) { bestScore = score; best = e; bestInfo = info; }
    }
    // (ruling 65, play as a team: a road two or three of ours have committed to — fit, at an enemy structure — is the team's
    // road: the free fit rest join it, unless the enemy there already outnumbers them. From 14:00; sticky 15 s while one of
    // ours is still there)
    this.joined = false;
    const joinAt = d.joinAt;
    if (k.kind === 'rift' && now0 >= 840 && joinAt < Infinity && !this.window) {
      let js: Entity | null = null, jI: StructInfo | undefined, jn = 0;
      for (const e of tp.enemyStructs) {
        if (!e.alive || !e.targetable) continue;
        const info = this.structInfoOf(e);
        if (!info || info.isCore) continue;
        if (this.respawning(info) && towersLeft > 0) continue;
        let n = 0, foes = 0;
        for (const f of tp.allyFighters) if (f.alive && f.hp >= f.maxHp * 0.5 && sq(f.x - e.x) + sq(f.y - e.y) <= 22 * 22) n++;
        const sticky = e.id === this.joinSid && now0 < this.joinUntil && n >= 1;
        if (n < joinAt && !sticky) continue;
        for (const f of tp.enemyFighters) if (f.alive && sq(f.x - e.x) + sq(f.y - e.y) <= 22 * 22) foes++;
        if (foes > n + 1 || aliveDiff < -1) continue;
        const sc = n + (sticky ? 0.5 : 0);
        if (sc > jn) { jn = sc; js = e; jI = info; }
      }
      if (js && jI && (!best || !bestInfo || !bestInfo.isCore)) {
        if (js.id !== this.joinSid || jn >= joinAt) { this.joinUntil = now0 + 15; this.joinSid = js.id; }
        best = js; bestInfo = jI; bestScore = Math.max(bestScore, 0); group = true; this.joined = true;
      }
    }
    // (ruling 65: a person's push ping on an enemy structure is the team's call for 25 s, at even numbers or better)
    // (once taken up it holds for the ping's 25 s unless the team falls two behind)
    const pp = this.pingPush;
    if (pp && !pp.on && aliveDiff >= 0) pp.on = true;
    if (pp && k.kind === 'rift' && now0 <= pp.until && (pp.on && aliveDiff >= -1) && now0 >= 600) {
      let ps: Entity | null = null, pI: StructInfo | undefined, pd = 20 * 20;
      for (const e of tp.enemyStructs) {
        if (!e.alive || !e.targetable) continue;
        const info = this.structInfoOf(e);
        const d2 = sq(e.x - pp.x) + sq(e.y - pp.y);
        if (info && d2 < pd) { pd = d2; ps = e; pI = info; }
      }
      if (ps && pI) {
        this.takePush(w, ps, pp);
        best = ps; bestInfo = pI; bestScore = Math.max(bestScore, 0); group = true;
      } else { this.pushers.clear(); this.pushAckAt = -1; }
    } else { this.pushers.clear(); this.pushAckAt = -1; }
    this.siege = bestScore >= 0 ? best : null;
    this.siegeLane = bestInfo ? bestInfo.lane : -1;
    // endgame: every tower that guards the core is down — gates (they come back) and the core must
    // fall in one push. The team first gathers at the staging point; it commits once most of it is
    // there (or the enemy is short of bodies), and at once when a gate is already down (its respawn
    // clock is running) or the core is open.
    this.stage = false;
    this.rush = false;
    // (a tower opened by a fallen gate — a Bell Needle behind its Lantern — is part of the endgame too: it
    // must fall before the gate relights)
    let opened = false;
    if (bestInfo && !bestInfo.isCore && !bestInfo.respawns) {
      for (const id of bestInfo.requires) {
        const g = k.structs.find((st) => st.id === id);
        if (g && g.respawns && this.downAt.has(g.id) && !this.structAliveInfo(g)) { opened = true; break; }
      }
    }
    const endgame = !!this.siege && !!bestInfo && (bestInfo.isCore || (bestInfo.respawns && towersLeft === 0) || opened ||
      (closeOut && (bestInfo.lane < 0 || bestInfo.respawns)));
    if (endgame) {
      group = true;
      let gatesTotal = 0, gatesUp = 0;
      for (const st of k.structs) if (st.team !== this.team && st.respawns) gatesTotal++;
      for (const e of tp.enemyStructs) { const info = this.structInfoOf(e); if (info && info.respawns && e.alive) gatesUp++; }
      // a gate already down only starts the clock if enough of its respawn time is left to finish
      let clock = bestInfo!.isCore;
      const now = w.time;
      for (const st of k.structs) {
        if (st.team === this.team || !st.respawns) continue;
        const down = this.downAt.get(st.id);
        if (down === undefined) continue;
        const left = down + st.respawnTime - now;
        if (left > 0 && left >= Math.min(40, st.respawnTime * 0.6)) clock = true;
      }
      void gatesUp; void gatesTotal;
      let ready = 0;
      for (const f of tp.allyFighters) if (f.alive && f.hp > f.maxHp * 0.5 && sq(f.x - this.groupX) + sq(f.y - this.groupY) < 18 * 18) ready++;
      const need = Math.min(4, Math.max(1, this.aliveAllies));
      // (owner_rulings 44, round 2: a tier that closes out goes into a held base only with a fighter more, or two of theirs left,
      // or a Lantern's clock running at even numbers — a defended base won every even dive, and the fights lost at its door
      // were the long games' back-and-forth)
      const commit = d.closeOut && k.kind === 'rift' ? aliveDiff >= 1 || this.aliveEnemies <= 2 || (clock && aliveDiff >= 0) : aliveDiff >= -1 || this.aliveEnemies <= 2;
      if ((clock || ready >= need || this.aliveEnemies <= 2 || (closeOut && ready >= Math.min(3, need))) && commit) this.rush = true;
      else this.stage = true;
    }
    // (lane AI G7: a cross-map trade — the enemy is on an objective we cannot contest: press the structure farthest from
    // it for 25 s; G5: a pressed siege goes in only with enough fit fighters at the group point)
    if (k.kind === 'rift' && now0 < this.tradeUntil && !endgame && this.pushers.size === 0) {
      let tb: Entity | null = null, tbI: StructInfo | undefined, td = -Infinity;
      for (const e of tp.enemyStructs) {
        if (!e.alive || !e.targetable) continue;
        const info = this.structInfoOf(e);
        if (!info || info.isCore || info.respawns || info.lane < 0) continue;
        const dd = sq(e.x - this.tradeX) + sq(e.y - this.tradeY) - progress(k.lanes[info.lane], this.team, info.s) * 4;
        if (dd > td) { td = dd; tb = e; tbI = info; }
      }
      if (tb && tbI) { this.siege = tb; this.siegeLane = tbI.lane; bestInfo = tbI; group = true; this.press = true; }
    }
    this.group = group && !!this.siege;
    this.gathered = true;
    if (k.kind === 'rift' && (this.window || this.press) && !this.rush && this.group) {
      let fitAt = 0;
      for (const f of tp.allyFighters) if (f.alive && f.hp >= f.maxHp * 0.45 && sq(f.x - this.groupX) + sq(f.y - this.groupY) <= 18 * 18) fitAt++;
      this.gathered = now0 >= 1500 || fitAt >= Math.min(3, this.aliveAllies);
    }
    // (ruling 65: regroup before a siege — with fit teammates still walking in (within 50 m of the group point), the ones there
    // wait up to the tier's regroupWait for them, so the siege starts together, not one at a time; once per siege target)
    this.regroup = false;
    const rw = d.regroupWait;
    if (k.kind === 'rift' && rw > 0 && this.group && this.siege && !this.rush && !this.stage && now0 >= 840) {
      const sid = this.siege.id;
      if (sid !== this.regroupSid) { this.regroupSid = sid; this.regroupAt = now0; }
      if (this.regroupDone !== sid) {
        let at = 0, coming = 0;
        for (const f of tp.allyFighters) {
          if (!f.alive || f.hp < f.maxHp * 0.45 || f.stateOverride === 'recall') continue;
          const d2 = sq(f.x - this.groupX) + sq(f.y - this.groupY);
          if (d2 <= 18 * 18) at++; else if (d2 <= 50 * 50) coming++;
        }
        if (coming > 0 && at < Math.min(3, at + coming) && now0 - this.regroupAt < rw) this.regroup = true;
        else this.regroupDone = sid;
      }
    }
    if (this.siege) {
      const s = this.siege;
      const info = bestInfo!;
      // gather on our side of the target, just outside its reach
      const stand = (info.attacks ? info.range + info.radius + 2.5 : info.radius + 3);
      if (info.lane >= 0) {
        const l = k.lanes[info.lane];
        const p = progress(l, this.team, info.s) - stand;
        const front = tp.ownN[l.index] > 0 ? Math.max(tp.ownFront[l.index] - 2, 0) : 0;
        lanePoint(l, fromProgress(l, this.team, Math.max(0, Math.min(p, Math.max(front, p - 12)))));
        this.groupX = proj.x; this.groupY = proj.y;
      } else {
        const base = k.bases.find((b) => b.team === this.team);
        const bx = base ? base.spawnX : k.mapCenterX, by = base ? base.spawnY : k.mapCenterY;
        const dx = bx - s.x, dy = by - s.y, d = dhypot(dx, dy) || 1;
        this.groupX = s.x + (dx / d) * stand; this.groupY = s.y + (dy / d) * stand;
      }
      if (info.lane >= 0) this.push[info.lane] = Math.max(this.push[info.lane], this.group ? 0.9 : 0.5);
    }
  }

  /**
   * Ruling 65, fix round — a person's push ping is followed, not only acknowledged. When the team takes it up, the fit free
   * computer-played fighters (55 %+ health, not recalling, posted, answering, hunting or in a fight of their own, within
   * 85 m: there within the ping's 25 s) are named to walk to it, the nearest first, all of them; with fewer than two free nobody is named and nobody says
   * onMyWay (a promise the team cannot keep is not made). Nor while a road or our base is under threat. The onMyWay is
   * said once, by the nearest named fighter, when two of them are seen on the way; if they are not within 4 s, they are let
   * go and nothing is said. A named fighter drops out under 35 % health, when posted or sent to an answer, or when the ping's 25 s end.
   */
  private takePush(w: World, ps: Entity, pp: { until: number; by: PlayerId; asked: boolean }): void {
    const now = w.time, tp = this.perc;
    for (const [p, a] of [...this.pushers]) {
      const e = w.players[p]?.ent;
      if (!e || !e.alive || e.hp < e.maxHp * 0.35 || a.sid !== ps.id || now > a.until || this.guard.has(p) || this.answer.has(p) || this.helpers.has(p)) this.pushers.delete(p);
    }
    // (the onMyWay is said once two named fighters are seen walking to it — 2 m nearer than when named — within 4 s;
    // otherwise the call is let go unsaid and nobody is held to it)
    if (this.pushAckAt >= 0 && now >= this.pushAckAt) {
      let going = 0, first: PlayerId = -1, fd = Infinity;
      for (const [p, a] of this.pushers) {
        const e = w.players[p]?.ent;
        if (!e) continue;
        const dd = dhypot(e.x - ps.x, e.y - ps.y);
        if (dd <= a.d0 - 2 || dd <= 30) { going++; if (dd < fd) { fd = dd; first = p; } }
      }
      if (going >= 2 && first >= 0) { this.callOut(w, 'onMyWay', ps.x, ps.y, `ack:push:${ps.id}`, 45, first); this.pushAckAt = -1; }
      else if (now >= this.pushAckAt + 2) { this.pushers.clear(); this.pushAckAt = -1; }
    }
    // (a threat to the base, or a push of three of theirs on a road, after the call: the named walkers are let go to it)
    if (this.pushers.size > 0) {
      let hard = this.baseThreat >= 0.4;
      for (let i = 0; i < this.defend.length; i++) if (this.defend[i] >= 0.7 && this.defendFighters[i] >= 3) hard = true;
      if (hard) { this.pushers.clear(); this.pushAckAt = -1; }
    }
    if (pp.asked) return;
    pp.asked = true;
    // (a road or the base of ours under threat holds the team: the defence first, and no promise)
    if (this.baseThreat >= 0.2) return;
    for (let i = 0; i < this.defend.length; i++) if (this.defend[i] >= 0.5) return;
    const cand: { p: PlayerId; dd: number }[] = [];
    for (const p of this.botSeats) {
      if (p === pp.by || this.helpers.has(p) || this.guard.has(p) || this.answer.has(p) || this.hunters.has(p)) continue;
      const e = w.players[p]?.ent;
      if (!e || !e.alive || e.hp < e.maxHp * 0.55 || e.stateOverride === 'recall') continue;
      const dd = dhypot(e.x - ps.x, e.y - ps.y);
      if (dd > 85) continue;
      let busy = false;
      for (const f of tp.enemyFighters) if (f.alive && sq(f.x - e.x) + sq(f.y - e.y) <= 14 * 14 && sq(f.x - ps.x) + sq(f.y - ps.y) > 25 * 25) { busy = true; break; }
      if (!busy) cand.push({ p, dd });
    }
    if (cand.length < 2) return;
    cand.sort((x, y) => x.dd - y.dd || x.p - y.p);
    for (const c of cand) this.pushers.set(c.p, { sid: ps.id, until: pp.until, d0: c.dd });
    this.pushAckAt = now + 2;
  }

  private thinkObjective(w: World, aa: number, ae: number): void {
    const prev = this.objective?.camp ?? null;
    this.objective = null;
    this.visionPit = null;
    if (this.k.kind !== 'rift') return;
    this.thinkObjectiveExtras(w, aa, ae);
    // never while the base is under siege or the team is closing the game
    if (this.baseThreat >= 0.4 || this.rush || this.stage) return;
    let threat = 0;
    for (let i = 0; i < this.defend.length; i++) { if (this.defend[i] >= 0.7) return; threat = Math.max(threat, this.defend[i]); }
    const now = w.time, d = this.diff, sense = d.objectiveSense;
    const early = this.phase === 'early';
    // (objectiveSense: a road with a stacked enemy wave deep in our half is a threat too — no waiting at a door then)
    if (sense) for (const l of this.k.lanes) if (this.perc.enemyN[l.index] >= 5 && this.perc.enemyFront[l.index] < l.length * 0.5 && this.perc.ownN[l.index] <= this.perc.enemyN[l.index] - 3) threat = Math.max(threat, 0.5);
    // (objectiveSense: a road under threat comes first — Wicks crashing into an empty base end games, a camp does not)
    // (CW3s r2 refix, done:2: not in the early phase: a wave deep in one half is the laning's normal state. This read, the time
    // bars and the 60 s block below split veteran first Sunsplinter takes into 7-10 and 14+ min, where adept stays at 7-10;
    // holding the even-numbers call past 10:00 instead cost far more: veteran beat novice 27/40, a core fell at 15.5 min)
    // (ruling 63: from 14:00 only a road call of 0.7 — the one that holds every tier above — keeps the camp call back; it was
    // 0.3. The lane AI's defend calls read threats sooner and more often (a push coming, a fighter beside a structure), so
    // the old 0.3 kept a veteran team off every camp for most of the mid and late game: no Longshade, no Sunsplinter, and
    // the games that stall at a base. A per-feature bisect put the veteran pace cost here: RIFT veteran length against the
    // pre-lane bots +1.85 min (s765-892) → +0.07 min (s701-956); games reaching 30:00 16 of 128 (pre 4) → 9 of 256 (pre 11))
    if (sense && threat >= (early ? 0.6 : 0.7)) return;
    // (objectiveSense: where the team is — an even-numbers call is for a camp on its way, not one across the map)
    let cx = 0, cy = 0, cn = 0;
    for (const f of this.perc.allyFighters) if (f.alive) { cx += f.x; cy += f.y; cn++; }
    if (cn > 0) { cx /= cn; cy /= cn; }
    for (const c of this.k.camps) {
      if (!c.objective) continue;
      const ready = this.campReady[c.index];
      const alive = ready <= now;
      if (!alive) this.campOn[c.index] = -1;
      if (!alive && ready - now > d.objectiveLead) continue;
      if (now < 240) continue;
      let desire = 0;
      if (sense) {
        if (!early && now < this.campBlock[c.index]) continue;
        const { ttk, hpF } = this.campTtk(w, c);
        const long = ttk > 15, up = aa >= ae + 1;
        const near = cn > 0 && sq(cx - c.x) + sq(cy - c.y) <= 50 * 50;
        if (alive) {
          // a long objective only with a fighter more; none the team cannot take in 40 s; at even numbers a short one
          // only when the team is near (no road is under threat here: that returned above)
          desire = ttk > 40 ? 0 : up ? 0.75 : !long && aa >= ae && this.phase !== 'early' && near ? d.objectiveEven : 0;
          // (lane AI G7: the long objective at even numbers once the team can take it fast enough, fit, with the enemy
          // unable to answer — a fallen enemy's respawn clock or nobody of theirs seen near the pit for 10 s)
          if (long && desire === 0 && this.longOk(w, c, ttk, aa, ae)) desire = d.objectiveEven;
          // (CW3s refix, done:2: the laning phase's own objective is taken at even numbers once it is up and short for us
          // — the grovehunter and the roads beside it; it used to wait for a fighter more, 8.5 min past its spawn)
          if (early && ttk <= 30 && aa >= ae) desire = Math.max(desire, 0.75);
          // (a won fight with a structure to take: a short camp is worth it only on the way — the structure first)
          if (!early && this.window && this.siege && !long && !(cn > 0 && sq(cx - c.x) + sq(cy - c.y) <= 35 * 35)) desire = 0;
          // (ruling 55, closing: from 20:00 a tier that closes out turns a won fight — two or more up — into structures,
          // the long objective too unless it is on the way: an adept team five up at 24:00 walked to Longshade, then lost its
          // lead's game to the team behind on a base race)
          if (d.closeOut && now >= 1200 && this.window && this.siege && aa >= ae + 2 && !(cn > 0 && sq(cx - c.x) + sq(cy - c.y) <= 35 * 35)) desire = 0;
          if (d.contests && aa >= ae && this.pitOdds(c) >= 0) {
            for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) { desire = Math.max(desire, 0.76); break; }
          }
          // (owner_rulings 44: two or more of theirs more at the pit than ours within 45 m — not a call; the cross-map trade is)
          if (this.pitOdds(c) <= -2) desire = 0;
          // on it and it is not falling: give up for a while (the roads matter more than a door that will not open)
          let at = 0;
          for (const f of this.perc.allyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 14 * 14) at++;
          if (at >= 2) { if (this.campOn[c.index] < 0) this.campOn[c.index] = now; }
          else if (this.campOn[c.index] >= 0 && now - this.campOn[c.index] > 40) this.campOn[c.index] = -1;
          if (this.campOn[c.index] >= 0 && now - this.campOn[c.index] > Math.max(25, Math.min(ttk, 40) * 1.8) && hpF > 0.3) {
            this.campBlock[c.index] = now + 60; this.campOn[c.index] = -1; desire = 0;
          }
        } else desire = aa >= ae && (near || up) ? 0.4 : 0;
        // (one call at a time: the camp the team is already on keeps it against an equal one — no walking back and forth)
        if (desire > 0 && prev === c) desire = Math.max(desire, Math.min(0.8, desire + 0.06));
      } else if (alive) {
        // (lane AI G7: a beginner's macro still takes an even objective late, as a beginner does — never zero takes)
        const even = d.objectiveEven > 0 ? d.objectiveEven : now >= 720 ? d.objectiveEvenLate : 0;
        desire = aa >= ae + 1 ? 0.75 : aa >= ae && this.phase !== 'early' ? even : 0;
        // (lane AI G7: the long objective needs the time to kill and an enemy that cannot answer, as above)
        if (desire > 0 && aa < ae + 1 && d.longshadeTtk > 0) {
          const { ttk } = this.campTtk(w, c);
          if (ttk > 15 && !this.longOk(w, c, ttk, aa, ae)) desire = 0;
        }
        // (CW3s refix, done:2: the laning phase's objective at even numbers, as above)
        // (a beginner, objectiveEven 0, takes it only with a fighter more: three Splinters at even numbers kept novice in games)
        if (early && aa >= ae && d.objectiveEven > 0) desire = Math.max(desire, 0.75);
        // (contest: the enemy is at it and we are not short of bodies)
        if (d.contests && aa >= ae && this.pitOdds(c) >= 0) {
          for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) { desire = Math.max(desire, 0.76); break; }
        }
        if (this.pitOdds(c) <= -2) desire = 0;
      } else desire = aa >= ae ? 0.4 : 0;
      // (ruling 65: a person's camp ping is weighed as the team's call for 25 s, at even numbers or better)
      const po = this.pingObj;
      if (po && now <= po.until && sq(po.x - c.x) + sq(po.y - c.y) <= 20 * 20 && aa >= ae && this.pitOdds(c) > -2 && (alive || ready - now <= 30)) {
        desire = Math.max(desire, 0.77);
        this.since.set(`obj${c.index}`, Math.min(this.since.get(`obj${c.index}`) ?? now, now - 99));
      }
      // (macroDelay: the call goes out once it has held)
      if (!this.held(`obj${c.index}`, desire > 0, now)) desire = 0;
      if (desire > (this.objective?.desire ?? 0)) this.objective = { camp: c, desire, alive };
    }
  }

  /** owner_rulings 44: our fighters within 45 m of the pit (they can be at it within seconds) minus the enemy fighters seen at it
   *  (16 m) — a contest is called only at even odds or better, and none at all two down */
  private pitOdds(c: CampInfo): number {
    let ours = 0, theirs = 0;
    for (const f of this.perc.allyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 45 * 45) ours++;
    for (const f of this.perc.enemyFighters) if (f.alive && (f.visibleMask & this.perc.bit) !== 0 && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) theirs++;
    return ours - theirs;
  }

  /** the long objective is worth it at even numbers: time to kill within the tier's longshadeTtk, four fit fighters, and
   *  an enemy that cannot answer (one of them dead for 60 % of the time to kill, or none seen near the pit for 10 s) */
  private longOk(w: World, c: CampInfo, ttk: number, aa: number, ae: number): boolean {
    const d = this.diff;
    if (d.longshadeTtk <= 0 || ttk > d.longshadeTtk || aa < ae) return false;
    let fit = 0;
    for (const p of w.players) if (p && p.team === this.team && p.ent && p.ent.alive && p.ent.hp >= p.ent.maxHp * 0.5) fit++;
    if (fit < 4) return false;
    for (const p of w.players) if (p && p.team !== this.team && p.ent && !p.ent.alive && p.respawnIn >= ttk * 0.6) return true;
    for (const ls of this.perc.lastSeen.values()) if (w.time - ls.t < 10 && sq(ls.x - c.x) + sq(ls.y - c.y) <= 40 * 40) return false;
    for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 40 * 40) return false;
    return true;
  }

  /**
   * Lane AI G7: vision before an objective (tiers with visionSetup: from objectiveLead before a spawn, and while it is up,
   * lamps go round the pit and enemy lamps there are cleared), and the cross-map trade (crossTrade: the enemy is on a
   * live objective the team cannot contest — fewer fighters up, or a camp it would take much longer — so the team
   * presses the structure farthest from it for 25 s).
   */
  private thinkObjectiveExtras(w: World, aa: number, ae: number): void {
    const d = this.diff, now = w.time;
    for (const c of this.k.camps) {
      if (!c.objective) continue;
      const ready = this.campReady[c.index];
      if (d.visionSetup && ready - now <= d.objectiveLead && now >= 240 && (!this.visionPit || ready < this.campReady[this.visionPit.index])) this.visionPit = c;
      if (!d.crossTrade || ready > now || now < this.tradeUntil) continue;
      let at = 0;
      for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) at++;
      if (at < 2) continue;
      if (aa < ae || this.campTtk(w, c).ttk > 30) { this.tradeUntil = now + 25; this.tradeX = c.x; this.tradeY = c.y; }
    }
  }

  /**
   * gank: an enemy fighter on a road we hold, pushed up to the river or past it (outside its own Needles' cover), the
   * lower and the deeper into our half the better, and better again with our laner there to make it two on one
   * (CW3 CL-1: the old read took the enemy farthest from our base — at its own tower — so ganks almost never landed).
   * `gankLane` is the road it stands on.
   */
  private thinkGank(w: World): void {
    this.gank = null; this.gankLane = -1;
    const k = this.k;
    if (k.kind !== 'rift') return;
    let best = 0;
    for (const f of this.perc.enemyFighters) {
      if (!f.alive || (f.visibleMask & this.perc.bit) === 0) continue;
      let lane = -1, s = 0, d2b = 49;
      for (const l of k.lanes) { const pr = this.projectTo(l.index, f.x, f.y); if (pr.d2 < d2b) { d2b = pr.d2; lane = l.index; s = pr.s; } }
      if (lane < 0) continue;
      let laner: Entity | null = null;
      for (const [p, a] of this.assign) {
        if (a.lane !== lane || a.jungle) continue;
        const e = w.players[p]?.ent;
        if (e && e.alive && sq(e.x - f.x) + sq(e.y - f.y) <= 16 * 16 && (!laner || e.hp > laner.hp)) laner = e;
      }
      let held = false;
      for (const [, a] of this.assign) if (a.lane === lane && !a.jungle) { held = true; break; }
      if (!held) continue;
      // under (or next to) one of its own towers: no gank
      let covered = false;
      for (const st of this.perc.enemyStructs) {
        if (!st.alive || !st.attackDef || st.stats.ad <= 0) continue;
        const r = st.stats.range + st.radius + 3;
        if (sq(st.x - f.x) + sq(st.y - f.y) <= r * r) { covered = true; break; }
      }
      if (covered) continue;
      const l = k.lanes[lane];
      const deep = progress(l, this.team, s) / l.length;
      // (CW3s r3, CL-1: from 8:00 a road's fights stand further up, and the longest quiet stretch starts at 9:00-12:00)
      if (deep > (w.time >= 480 ? 0.7 : 0.6)) continue;
      const hpF = (f.hp + f.shield) / Math.max(1, f.maxHp);
      // (a gank is two on one: our laner beside it, or a target already hurt — and no second enemy fighter beside it)
      if (!laner && hpF > 0.5) continue;
      let pair = 0;
      for (const g of this.perc.enemyFighters) if (g !== f && g.alive && sq(g.x - f.x) + sq(g.y - f.y) <= 10 * 10) pair++;
      if (pair > (laner ? 1 : 0)) continue;
      const score = (0.72 - deep) * 3 + (1 - hpF) + (laner ? 0.35 * (laner.hp / Math.max(1, laner.maxHp)) : 0);
      if (score > best) { best = score; this.gank = f; this.gankLane = lane; }
    }
  }
  private projectTo(lane: number, x: number, y: number): { s: number; d2: number } {
    const l = this.k.lanes[lane];
    // inline projection (knowledge.laneProject writes shared scratch; copy it out)
    let bestD2 = Infinity, bestS = 0;
    for (let i = 1; i < l.xs.length; i++) {
      const ax = l.xs[i - 1], ay = l.ys[i - 1], vx = l.xs[i] - ax, vy = l.ys[i] - ay;
      const L2 = vx * vx + vy * vy || 1;
      let t = ((x - ax) * vx + (y - ay) * vy) / L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = ax + vx * t, py = ay + vy * t;
      const d2 = sq(px - x) + sq(py - y);
      if (d2 < bestD2) { bestD2 = d2; bestS = l.cum[i - 1] + Math.sqrt(L2) * t; }
    }
    return { s: bestS, d2: bestD2 };
  }

  /** how many teammates currently publish `target` as their focus (excluding `self`) */
  focusCount(target: EntityId, self: PlayerId): number {
    let n = 0;
    for (const [p, t] of this.focus) if (p !== self && t === target) n++;
    return n;
  }
}
