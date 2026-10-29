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

export interface LaneAssign { lane: number; jungle: boolean; support: boolean }

export const TEAM_THINK_TICKS = 15;

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
  readonly campReady: Float64Array;
  /** objectiveSense: until when the team leaves an objective it gave up on alone, and since when it has been on one */
  private readonly campBlock: Float64Array;
  private readonly campOn: Float64Array;
  readonly focus = new Map<PlayerId, EntityId>();
  aliveAllies = 0; aliveEnemies = 0;
  /** enemy fighters not seen for a while (danger of pushing deep) */
  missing = 0;

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
    this.campReady = new Float64Array(k.camps.length);
    this.campBlock = new Float64Array(k.camps.length);
    this.campOn = new Float64Array(k.camps.length).fill(-1);
    for (const c of k.camps) this.campReady[c.index] = c.firstSpawn;
    this.assignLanes();
    for (const a of this.assign.values()) if (a.lane >= 0 && !a.jungle) this.laners[a.lane]++;
  }

  // ── lanes ─────────────────────────────────────────────────────────────────────────────────────
  private assignLanes(): void {
    for (const [p, a] of assignLanes(this.k, this.team)) this.assign.set(p, a);
  }
  laneOf(p: PlayerId): LaneAssign { return this.assign.get(p) ?? { lane: this.k.lanes.length > 0 ? 0 : -1, jungle: false, support: false }; }
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
    this.thinkSiege(w, aa - ae, lvA - lvE, enemyLost);
    this.thinkObjective(w, aa, ae);
    this.thinkGank(w);
    this.thinkAnswers(w);
  }

  /**
   * From the mid game (RIFT, tiers that readsWaves): a road under threat — a dive or a stacked wave at one of
   * our structures (published defend calls), or four or more enemy Wicks deep in our half with two fewer of ours
   * to meet them — gets one fighter (two for a dive by two or more or a wave six ahead): the nearest ones above
   * 60 % health, never the grovehunter, the road's own laner first when it is not much farther. The rest keep
   * the plan.
   */
  private thinkAnswers(w: World): void {
    this.answer.clear();
    const k = this.k, tp = this.perc, now = w.time;
    if (k.kind !== 'rift' || this.phase === 'early' || this.rush || !this.diff.readsWaves) return;
    for (const l of k.lanes) {
      const i = l.index;
      let need = 0, x = 0, y = 0;
      if (this.defend[i] > 0.05) { need = this.defendFighters[i] >= 2 ? 2 : 1; x = this.defendX[i]; y = this.defendY[i]; }
      const deep = this.diff.readsWaves && tp.enemyN[i] >= 4 && tp.enemyFront[i] < l.length * 0.45 && tp.ownN[i] <= tp.enemyN[i] - 2;
      let big = false;
      if (this.held(`wave${i}`, deep, now) && need === 0) {
        const surplus = tp.enemyN[i] - tp.ownN[i];
        need = surplus >= 6 ? 2 : 1;
        lanePoint(l, fromProgress(l, this.team, Math.max(0, tp.enemyFront[i] - 4)));
        x = proj.x; y = proj.y;
        // (W4 G1 refix: a stacked wave of six or more is met behind the first own Needle in its way, where the Needle
        // shares the hits — never in the open, where it surrounds a lone fighter and body-blocks its way out; with no
        // Needle of ours left in its way it is the base's call, not one fighter's)
        if (surplus >= 6) {
          big = true;
          let bp = -1, br = 0;
          for (const st of k.structs) {
            if (st.team !== this.team || st.lane !== i || !st.attacks || !this.structAlive(w, st)) continue;
            const p = progress(l, this.team, st.s);
            if (p <= tp.enemyFront[i] && p > bp) { bp = p; br = st.radius; }
          }
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
  private held(key: string, cond: boolean, now: number): boolean {
    if (!cond) { this.since.delete(key); return false; }
    let t = this.since.get(key);
    if (t === undefined) { t = now; this.since.set(key, t); }
    return now - t + 1e-9 >= this.diff.macroDelay;
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
      if (lane >= 0) {
        if (threat > this.defend[lane]) { this.defend[lane] = threat; this.defendX[lane] = st.x; this.defendY[lane] = st.y; this.defendFighters[lane] = fighters; }
      } else if (threat > this.baseThreat) { this.baseThreat = threat; this.baseX = st.x; this.baseY = st.y; }
    }
    void k;
  }

  /** macroDelay on defend calls: a threat is answered once it has held the tier's delay */
  private delayDefend(now: number): void {
    if (this.diff.macroDelay <= 0) return;
    for (let i = 0; i < this.defend.length; i++) {
      if (!this.held(`def${i}`, this.defend[i] > 0.05, now)) { this.defend[i] = 0; this.defendFighters[i] = 0; }
    }
    if (!this.held('base', this.baseThreat > 0.05, now)) this.baseThreat = 0;
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
    this.window = this.held('window', won, now0);
    // a lead to press: the scoreboard's Gleam (two-team modes)
    let lead = 0;
    for (const t of w.teams) lead += t.team === this.team ? t.gold : -t.gold;
    // (objectiveSense: a lead is pressed by fighters fit to press it — as many above 45 % health as the enemy has up)
    let fit = 0;
    for (const p of w.players) if (p && p.team === this.team && p.ent && p.ent.alive && p.ent.hp >= p.ent.maxHp * 0.45) fit++;
    this.press = this.held('press', d.convertsLeads && w.teams.length === 2 && lead >= d.leadGleam && aliveDiff >= 0 && (single || this.phase !== 'early') &&
      (!d.objectiveSense || fit >= Math.min(this.aliveEnemies, 3)), now0);
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
    for (const e of tp.enemyStructs) {
      if (!e.alive || !e.targetable) continue;
      const info = this.structInfoOf(e);
      if (!info) continue;
      let score: number;
      if (info.isCore) score = 1000;
      else if (this.respawning(info)) score = towersLeft === 0 ? 500 - dhypot(e.x - cx, e.y - cy) * 0.5 - (e.hp / Math.max(1, e.maxHp)) * 20 : -1;
      else {
        // the least-pushed lane first: towers nearer our side score higher
        const l = info.lane >= 0 ? k.lanes[info.lane] : null;
        const p = l ? progress(l, this.team, info.s) / l.length : 1;
        score = 100 - p * 50 + (l ? tp.ownN[l.index] * 2 : 0) - (e.hp / Math.max(1, e.maxHp)) * 10;
        // (objectiveSense, W4 G3 refix: the tower the team is already on keeps it — a group that turns to another road
        // whenever a wave count changes walks the map instead of taking towers)
        if (d.objectiveSense && e === prevSiege) score += 15;
      }
      if (score > bestScore) { bestScore = score; best = e; bestInfo = info; }
    }
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
    const endgame = !!this.siege && !!bestInfo && (bestInfo.isCore || (bestInfo.respawns && towersLeft === 0) || opened);
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
      if (clock || ready >= need || this.aliveEnemies <= 2) this.rush = aliveDiff >= -1 || this.aliveEnemies <= 2;
      else this.stage = true;
    }
    this.group = group && !!this.siege;
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

  private thinkObjective(w: World, aa: number, ae: number): void {
    const prev = this.objective?.camp ?? null;
    this.objective = null;
    if (this.k.kind !== 'rift') return;
    // never while the base is under siege or the team is closing the game
    if (this.baseThreat >= 0.4 || this.rush || this.stage) return;
    let threat = 0;
    for (let i = 0; i < this.defend.length; i++) { if (this.defend[i] >= 0.7) return; threat = Math.max(threat, this.defend[i]); }
    const now = w.time, d = this.diff, sense = d.objectiveSense;
    // (objectiveSense: a road with a stacked enemy wave deep in our half is a threat too — no waiting at a door then)
    if (sense) for (const l of this.k.lanes) if (this.perc.enemyN[l.index] >= 5 && this.perc.enemyFront[l.index] < l.length * 0.5 && this.perc.ownN[l.index] <= this.perc.enemyN[l.index] - 3) threat = Math.max(threat, 0.5);
    // (objectiveSense: a road under threat comes first — Wicks crashing into an empty base end games, a camp does not)
    if (sense && threat >= 0.3) return;
    // (objectiveSense: where the team is — an even-numbers call is for a camp on its way, not one across the map)
    let cx = 0, cy = 0, cn = 0;
    for (const f of this.perc.allyFighters) if (f.alive) { cx += f.x; cy += f.y; cn++; }
    if (cn > 0) { cx /= cn; cy /= cn; }
    // (objectiveSense with convertsLeads: a Gleam lead of leadGleam (public) is converted through a long objective too,
    // at even numbers — the lead is what makes the long take safe)
    let lead = 0;
    for (const t of w.teams) lead += t.team === this.team ? t.gold : -t.gold;
    const ahead = d.convertsLeads && w.teams.length === 2 && lead >= d.leadGleam;
    for (const c of this.k.camps) {
      if (!c.objective) continue;
      const ready = this.campReady[c.index];
      const alive = ready <= now;
      if (!alive) this.campOn[c.index] = -1;
      if (!alive && ready - now > d.objectiveLead) continue;
      if (now < 240) continue;
      let desire = 0;
      if (sense) {
        if (now < this.campBlock[c.index]) continue;
        const { ttk, hpF } = this.campTtk(w, c);
        const long = ttk > 15, up = aa >= ae + 1;
        const near = cn > 0 && sq(cx - c.x) + sq(cy - c.y) <= 50 * 50;
        if (alive) {
          // a long objective only with a fighter more or a lead to convert; none the team cannot take in 40 s; at even
          // numbers a short one only when the team is near (no road is under threat here: that returned above)
          desire = ttk > 40 ? 0 : up ? 0.75 : aa >= ae && this.phase !== 'early' && (long ? ahead : near) ? d.objectiveEven : 0;
          // (a won fight with a structure to take: a short camp is worth it only on the way — the structure first)
          if (this.window && this.siege && !long && !(cn > 0 && sq(cx - c.x) + sq(cy - c.y) <= 35 * 35)) desire = 0;
          if (d.contests && aa >= ae) {
            for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) { desire = Math.max(desire, 0.76); break; }
          }
          // on it and it is not falling: give up for a while (the roads matter more than a door that will not open)
          let at = 0;
          for (const f of this.perc.allyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 14 * 14) at++;
          if (at >= 2) { if (this.campOn[c.index] < 0) this.campOn[c.index] = now; }
          else if (this.campOn[c.index] >= 0 && now - this.campOn[c.index] > 40) this.campOn[c.index] = -1;
          if (this.campOn[c.index] >= 0 && now - this.campOn[c.index] > Math.max(25, Math.min(ttk, 40) * 1.8) && hpF > 0.3) {
            this.campBlock[c.index] = now + 60; this.campOn[c.index] = -1; desire = 0;
          }
        } else desire = aa >= ae && (near || up || (long && ahead)) ? 0.4 : 0;
        // (one call at a time: the camp the team is already on keeps it against an equal one — no walking back and forth)
        if (desire > 0 && prev === c) desire = Math.max(desire, Math.min(0.8, desire + 0.06));
      } else if (alive) {
        desire = aa >= ae + 1 ? 0.75 : aa >= ae && this.phase !== 'early' ? d.objectiveEven : 0;
        // (contest: the enemy is at it and we are not short of bodies)
        if (d.contests && aa >= ae) {
          for (const f of this.perc.enemyFighters) if (f.alive && sq(f.x - c.x) + sq(f.y - c.y) <= 16 * 16) { desire = Math.max(desire, 0.76); break; }
        }
      } else desire = aa >= ae ? 0.4 : 0;
      // (macroDelay: the call goes out once it has held)
      if (!this.held(`obj${c.index}`, desire > 0, now)) desire = 0;
      if (desire > (this.objective?.desire ?? 0)) this.objective = { camp: c, desire, alive };
    }
  }

  private thinkGank(w: World): void {
    this.gank = null;
    const k = this.k;
    if (k.kind !== 'rift') return;
    let best = 0;
    for (const f of this.perc.enemyFighters) {
      if (!f.alive) continue;
      // which lane is it in, and how far into our half
      let lane = -1, s = 0, d2b = 49;
      for (const l of k.lanes) { const pr = this.projectTo(l.index, f.x, f.y); if (pr.d2 < d2b) { d2b = pr.d2; lane = l.index; s = pr.s; } }
      if (lane < 0) continue;
      let ally = false;
      for (const [, a] of this.assign) if (a.lane === lane) { ally = true; break; }
      if (!ally) continue;
      const l = k.lanes[lane];
      const deep = progress(l, this.team, s) / l.length;
      const hpF = f.hp / Math.max(1, f.maxHp);
      const score = (deep - 0.35) * 2 + (1 - hpF);
      if (deep > 0.4 && score > best) { best = score; this.gank = f; }
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
