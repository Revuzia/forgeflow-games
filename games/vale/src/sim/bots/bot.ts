// VALE bots — the per-bot controller: utility mode selection (5 Hz, hysteresis) + mode executors.
//
// think(world, player) runs every tick in the sim's 'bots' phase (CONTRACT §5.7):
//   1. the shared per-tick work (BotMatch.beginTick: events, perception, team brains);
//   2. the economy track (level-ups, shopping) — also while dead and in the pre-game;
//   3. every 6 ticks (staggered by seat) the utility mode selector scores the modes below from the
//      bot's situation (hp, nearby power balance, tower aggro, killable targets, team intents) and
//      switches with hysteresis: the active mode keeps a commitment bonus and a minimum duration,
//      unless the newcomer is urgent;
//   4. the active mode's executor writes the plan; the micro layer (micro.ts) turns it into commands.
// Modes: lane · farm (jungle) · trade · allin · retreat · recall (+ shop) · push (and group/siege) ·
// defend · objective · roam (gank) · teamfight · hunt (Fray) · pickup · return (to lane).
// RIFT laning phase (until LANE_PHASE_END or the team's endgame): laners hold their lane first —
// a wave or the lane opponent at their own tower is laning, not a defend call; they answer only a
// dive and the base, skip roams, shove their own lane only while no enemy fighter is there to farm
// it under its tower, rotate to an objective only from the lane beside it and only on an opening,
// recall on a real purchase or low health rather than every 1,100 gold, never trade into a fighter
// its own Wicks cover, step out of Wick aggro instead of tanking it, and join a 2v2 only once it
// has started. Wicks and monsters that would finish a bot with no enemy fighter near send it out
// (unless the monster dies first — never for the Wicks on it, and never for an objective monster its team is
// not taking), a stacked wave is judged on all of it, not only its front (a Needle covers up to seven Wicks),
// a bot hemmed in by Wicks takes the widest gap and may burn an escape, and an objective is started only when
// the fighters at it can take it (damage vs. health over the time to kill), never alone (W4 G1 refix).
// Fray: no team brain; targets the weakest reachable enemy, penalises fights other players can
// reach, never favours or spares other bots, caps how many bots hunt the same human seat at 2,
// contests pickups, uses the shared shop, plays safer on its last life while more than 4 seats are in and before the Noon Toll rings (G6).

import type { Command, PlayerView, SeatSetup, WorldView } from '../../contracts/sim.ts';
import { attackable, inAttackRange } from '../attack.ts';
import { mitigated } from '../combat.ts';
import type { Entity, Player } from '../entity.ts';
import type { Rng } from '../rng.ts';
import type { BotController } from '../sim.ts';
import { noonTollOn } from '../modes/match.ts';
import { seatState } from '../units/fighters.ts';
import { CC_HARD, ORDER_MOVE, SLOT_ULT } from '../entity.ts';
import type { World } from '../world.ts';
import type { DifficultyProfile } from './difficulty.ts';
import { Economy } from './economy.ts';
import type { AbilityCoreT } from '../catalog_index.ts';
import { abilityInfo, estimateDamage, U_ENGAGE, U_ESCAPE, U_GAPCLOSE, U_HEAL, U_SHIELD, fromProgress, lanePoint, laneProject, progress, proj, type BuildPlan, type CampInfo, type FighterProfile, type PlanOpts } from './knowledge.ts';
import type { BotMatch } from './match.ts';
import { BotBase, gauss, holdLeft, type Mode } from './micro.ts';
import type { Guard } from './team.ts';
import { fighterPower, memoryWeight } from './perception.ts';
import { dcos, dhypot, dsin, sq } from '../dmath.ts';

const MODE_TICKS = 6;
/** ruling 55: the plans whose walk a calm fighter does not turn round on more than once in 8 s */
const WALKS: ReadonlySet<Mode> = new Set<Mode>(['push', 'defend', 'objective', 'roam', 'farm', 'return', 'lane']);
const MIN_MODE_TIME = 1.5;
/** (ruling 55) in a road's laning phase a partner is dived, for the peel, only when held or under this share of its health —
 *  above it the burst is the duo's trade, played from the lane */
const LANE_PEEL_HP = 0.25;
/** (ruling 55) … and a partner held by hard CC only under this share (a stun in a full-health trade is the trade) */
const LANE_PEEL_HELD_HP = 0.5;
/** ruling 55: how far above frayBreak a losing FRAY fighter starts to leave (a constant: the sim reads no environment) */
const FRAY_EARLY = 0.2;
/** RIFT laning phase (s): a laner holds its lane first — no cross-map defends, roams or far objectives
 *  — until this time, unless its team starts the endgame push sooner */
const LANE_PHASE_END = 840;
/** during the laning phase a laner only leaves its lane for an objective camp this close to its lane (m) */
const LANE_OBJECTIVE_REACH = 40;
/** seconds of extra cost a jungler's clear puts on a camp in the enemy half of the Dialwood */
const JUNGLE_INVADE_COST = 25;
/** a jungler leaves its clear for an objective only from this time (s): its first clears come first */
const JUNGLE_OBJECTIVE_FROM = 360;
/** a grovehunter ganks from this time (s) — its first clears come first (CW3 CL-1: ganks from 3:00 doubled the early
 *  takedowns but cost the roads ~2 points of last-hit share, the G1 bar's whole margin) */
const JUNGLE_GANK_FROM = 270;
/** an all-in keeps chasing the fighter it was started on for at most this long (s) once its combo is spent (CW3 CL-1) */
const ALLIN_COMMIT = 7;
/** a roam is given up after this long without its kill (s) */
const ROAM_MAX = 25;
/** Wicks within this distance of an enemy fighter turn on whoever hits that fighter (call for help) */
const WAVE_AGGRO_R = 9;
/** how far from the nearest enemy Wick a fighter stands to stay out of its reach when no Wick of mine
 *  is there to take its attention (m) */
const WICK_REACH = 8.5;

export class Bot extends BotBase implements BotController {
  readonly eco: Economy;
  readonly stagger: number;
  modeSince = -1e9;
  /** ruling 56: this tick's siege outnumbers the structure's defenders by two (execPush) */
  private siegeDive = false;
  /** ruling 55 (no pacing): the macro mode last left, when, and the walk point a calm fighter is committed to */
  private latchX = 0;
  private latchY = 0;
  private latchAt = -1e9;
  private headX = 0;
  private headY = 0;
  private fleeX = 0;
  private fleeY = 0;
  private fleeAt = -1e9;
  /** ruling 55 (FRAY chase discipline): the chase under way — its target, since when, the gap then — and targets given up */
  private chaseId = -1;
  private chaseAt = 0;
  private chaseGap = 0;
  private readonly chaseDrop = new Map<number, number>();
  lane = -1;
  jungle = false;
  support = false;
  private assigned = false;
  private follows = true;
  private followRollAt = -1e9;
  private recallTriedAt = -1e9;
  private campTarget = -1;
  private tradeRestUntil = 0;
  /** the enemy fighter I lane against (last noticed in my lane), and when I last saw it start a recall */
  private laneFoe = -1;
  private foeRecallAt = -1e9;
  /** since when that opponent has been my lane foe, and when it last swung at me or cast (castSeen's estimate) */
  private foeSince = 0;
  private foeHitAt = -1e9;
  /** the fighter my current all-in was started on (-1: none) */
  private allinTarget = -1;
  // situation (5 Hz)
  hpF = 1;
  nearE = 0;
  nearA = 1;
  adv = 0.5;
  towerAggro = false;
  killTarget: Entity | null = null;
  killMargin = 0;
  laneEnemy: Entity | null = null;
  huntTarget: Entity | null = null;
  /** damage per second of the enemy Wicks, summons and monsters attacking me (after my defenses) */
  unitDps = 0;
  private holdX = 0; private holdY = 0;
  // ── lane AI (2026-11-15, owner_rulings 40) ──
  /** G6: the group call roll (at least groupFollowFloor), rerolled with `follows` */
  private groupFollows = true;
  /** G5: fog risk — enemies unseen 6-40 s that could be near me, weighted by how long ago — and whether it leaves me
   *  exposed (risk over the tier's cap with no partner within 20 m) */
  fogRisk = 0;
  private exposed = false;
  /** fighters within 18 m (G6: a fight of five or more bodies is a team fight in the mid game) */
  private nE18 = 0; private nA18 = 0;
  /** G2: per partner, the start of its current peel episode and whether I answer it (peelChance, rolled once) */
  private readonly peelRolls = new Map<number, { at: number; last: number; ok: boolean }>();
  private protectAlly: Entity | null = null;
  private protectDiver: Entity | null = null;
  private protectU = 0;
  /** owner_rulings 44: I am the designated peeler of the partner I protect */
  private protectDes = false;
  /** an answered dive is seen through for 3 s after its last trigger (it does not drop the moment the burst pauses) */
  private protectUntil = -1e9;
  private protectAllyId = -1; private protectDiverId = -1;
  /** G3: the gank approach (approach → lurk → strike), its entry point and its clocks */
  private roamPhase: 'approach' | 'lurk' | 'strike' = 'strike';
  private roamX = 0; private roamY = 0;
  private roamTarget = -1;
  private lurkSince = 0;
  private lurkFor = 0;
  private roamLostAt = -1;
  private roamBlockUntil = -1e9;
  /** G3: when the fight near me started (a flanker goes in 1.5 s after the frontline) */
  private fightSince = -1;
  /** G10: FRAY third party — the target it waits on, and the roll for that wait */
  private thirdRoll = { id: -1, ok: false };

  constructor(m: BotMatch, seat: SeatSetup, diff: DifficultyProfile, rng: Rng, prof: FighterProfile, plan: BuildPlan, support: boolean) {
    super(m, seat, diff, rng, prof);
    this.eco = new Economy(m.k, prof, plan, support);
    this.stagger = seat.player % MODE_TICKS;
  }

  think(view: WorldView, pv: PlayerView): readonly Command[] {
    const out = this.out;
    out.length = 0;
    const w = view as World, p = pv as Player;
    this.m.beginTick(w);
    this.w = w; this.p = p; this.now = w.time;
    const e = p.ent;
    if (!e) return out;
    this.e = e;
    this.perc = this.m.perc(this.team);
    this.brain = this.m.brain(this.team);
    if (!this.assigned) this.assign();
    this.eco.levelUp(p, out);
    if (this.diff.adaptiveBuild && p.canShop && this.k.kind === 'rift') this.eco.replan(w, p, this.liveRead(), this.jungle);
    this.eco.shop(w, p, out);
    if (w.phase !== 'live' || !e.alive || seatState(w, this.player)?.eliminated) {
      if (!e.alive) { this.m.ffaTarget.delete(this.player); this.brain?.focus.delete(this.player); }
      return out;
    }
    this.updateNoticed();
    this.sampleHp();
    // a recall in progress is left alone unless trouble shows up
    if (e.stateOverride === 'recall') {
      if (this.recentDps <= 0 && this.nearestEnemyFighter(8) === null) return out;
    }
    if ((w.tick + this.stagger) % MODE_TICKS === 0) this.selectMode();
    this.clearPlan();
    this.execute();
    this.clearOwn();
    this.holdWalk();
    this.act();
    // publish the focus target for teammates
    if (this.brain) { if (this.pFight && this.pFight.kind === 'fighter') this.brain.focus.set(this.player, this.pFight.id); else this.brain.focus.delete(this.player); }
    return out;
  }

  /** lane AI G9: the build's read of the match as it stands — the draft's enemy team, the fed enemy (scoreboard
   *  takedowns minus half its deaths, three or more: counted twice more), the damage mix I have been taking (two
   *  thirds of one type: that type's enemies count again), and my team 2,500 Gleam or more behind */
  private liveRead(): PlanOpts {
    const w = this.w, k = this.k;
    const enemies: FighterProfile[] = [];
    let fed: FighterProfile | null = null, fs = 2.99;
    for (const s of k.setup.seats) {
      if (s.team === this.team) continue;
      const pr = k.profiles.get(s.fighter);
      if (!pr) continue;
      enemies.push(pr);
      const pl = w.players[s.player];
      const sc = pl ? pl.kills + pl.assists * 0.5 - pl.deaths * 0.5 : 0;
      if (sc > fs) { fs = sc; fed = pr; }
    }
    const base = enemies.slice();
    if (fed) enemies.push(fed, fed);
    const mx = this.m.takenMix.get(this.e.id);
    if (mx && mx.phys + mx.magic > this.e.maxHp) {
      const mf = mx.magic / (mx.phys + mx.magic);
      if (mf >= 0.67) for (const pr of base) { if (pr.scaling === 'magic') enemies.push(pr); }
      else if (mf <= 0.33) for (const pr of base) { if (pr.scaling !== 'magic') enemies.push(pr); }
    }
    let lead = 0;
    for (const t of w.teams) lead += t.team === this.team ? t.gold : -t.gold;
    return { support: this.eco.support, enemies, teamSize: base.length, salt: (k.setup.seed | 0) * 31 + this.player, behind: w.teams.length === 2 && lead <= -2500 };
  }

  private assign(): void {
    this.assigned = true;
    const a = this.brain ? this.brain.laneOf(this.player) : { lane: this.k.lanes.length > 0 && !this.k.ffa ? 0 : -1, jungle: false, support: false };
    this.lane = a.lane; this.jungle = a.jungle; this.support = a.support;
    this.eco.carriesWards = this.eco.support || (a.jungle && this.diff.visionSetup);
  }

  private clearPlan(): void {
    this.pMove = false; this.pFight = null; this.pSiege = null; this.pSiegeFirst = false; this.pFarm = 0; this.pMonsters = false; this.pAggro = 0; this.pDive = false; this.pLhFight = false; this.pClear = false;
    this.caged = false;
    this.peelVictim = null; this.peelDiver = null;
  }

  // ── situation ─────────────────────────────────────────────────────────────────────────────────
  /** fighting power proxy: effective hp × damage per second */
  private power(f: Entity): number { return fighterPower(f); }
  /** what I can deal in ~3 s: ready damaging abilities + attacks */
  private burstOn(t: Entity): number {
    const e = this.e;
    let dmg = 0;
    for (let i = 0; i < 6; i++) {
      const s = e.slots[i];
      if (!s || !s.ready) continue;
      const def = s.def;
      if (!def.ai.use.some((u) => u === 'damage' || u === 'execute' || u === 'poke')) continue;
      dmg += this.abilityDamage(s.def, Math.max(1, s.rank), t);
    }
    const ad = e.attackDef;
    const period = 1 / Math.max(0.05, e.stats.attackSpeed);
    if (ad) dmg += (3 / period) * (e.stats.ad * (1 + e.stats.crit * 0.75)) * (100 / (100 + Math.max(0, ad.damageType === 'magic' ? t.stats.resist : t.stats.armor)));
    return dmg;
  }
  /** a ready ultimate the burst estimate cannot price (a stance, form or empowering buff, or a heal or shield that
   *  outlasts the trade) still turns a fight: x 1.3 on the kill read (CW3s refix, CL-1: such ults sat unused past 10:00) */
  private ultBoost(): number {
    const u = this.e.slots[SLOT_ULT];
    if (!u || !u.ready || u.rank <= 0) return 1;
    return abilityInfo(u.def).dmg.length ? 1 : 1.3;
  }
  /** RIFT laning trade bonus for a power spike over the lane opponent `le`: my ultimate ready while it has none up
   *  (+0.18), a level on it at 2-3 (+0.12, the item-less early spikes), any other level lead (+0.06) */
  private spikeEdge(le: Entity): number {
    const e = this.e, u = e.slots[SLOT_ULT];
    if (u && u.ready && u.rank > 0) {
      const lu = le.slots[SLOT_ULT];
      if (!lu || lu.rank <= 0 || !lu.ready) return 0.18;
    }
    if (e.level > le.level) return e.level <= 3 ? 0.12 : 0.06;
    return 0;
  }
  private abilityDamage(def: AbilityCoreT, rank: number, t: Entity): number {
    const info = abilityInfo(def);
    return info.dmg.length ? estimateDamage(info, this.e, rank, t) : 0;
  }

  private situate(): void {
    const e = this.e, tp = this.perc;
    this.hpF = e.hp / Math.max(1, e.maxHp);
    let nE = 0, nA = 0, powE = 0, powA = 0;
    const R = 13;
    for (const f of tp.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > R * R) continue;
      nE++; powE += this.power(f);
    }
    for (const f of tp.allyFighters) {
      if (!f.alive || this.dist2(f, e.x, e.y) > R * R) continue;
      nA++; powA += this.power(f);
    }
    // enemies seen moments ago near me still count (decayed)
    // (lane AI G4: fog-honest — the power it had when last seen, never the hidden fighter's live state; a fighter seen
    // dying is dropped by the death itself, which is public on the scoreboard)
    for (const ls of tp.lastSeen.values()) {
      const f = this.w.entity(ls.id);
      if (!f || !f.alive || this.isNoticed(f)) continue;
      const wgt = memoryWeight(ls, this.now, 6);
      if (wgt > 0 && sq(ls.x - e.x) + sq(ls.y - e.y) <= R * R) powE += ls.power * wgt * 0.6;
    }
    this.nearE = nE; this.nearA = nA;
    if (this.k.ffa) {
      // free-for-all: nobody is allied — weigh me against the strongest single threat, plus a
      // share of the others (they may turn on me, or on each other)
      let top = 0, rest = 0;
      for (const f of tp.enemyFighters) {
        if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > R * R) continue;
        const pw = this.power(f);
        if (pw > top) { rest += top; top = pw; } else rest += pw;
      }
      powE = top + rest * 0.35;
    }
    this.adv = powA / Math.max(1, powA + powE);
    // tower aggro: an enemy tower shooting me
    this.towerAggro = false;
    for (const st of tp.enemyStructs) if (st.alive && st.atkTarget === e.id && inAttackRange(st, e)) { this.towerAggro = true; break; }
    // killable target
    this.killTarget = null; this.killMargin = 0;
    // (the CL-1 kill-window reads are RIFT's laning; BRIDGE keeps the reads its G5 pace was measured with)
    const rift = this.k.kind === 'rift';
    const hold = rift && this.ccReady();
    for (const f of tp.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > 10 * 10) continue;
      if (this.k.ffa && this.chaseDropped(f)) continue;
      // (CW3 CL-1: a ready hold — stun, root, sleep — keeps the target in reach for the whole combo: a kill window)
      let dmg = this.burstOn(f) * (hold ? 1.2 : 1) * (rift ? this.ultBoost() : 1);
      for (const a of tp.allyFighters) {
        if (a === e || !a.alive) continue;
        // (an ally beside it, or one already committing to it — its published focus — on the way)
        const d2 = this.dist2(a, f.x, f.y);
        if (d2 > 8 * 8 && !(rift && d2 <= 15 * 15 && this.brain && this.brain.focus.get(a.player?.player ?? -1) === f.id)) continue;
        dmg += a.stats.ad * a.stats.attackSpeed * 3 + a.level * 25;
      }
      const margin = dmg / Math.max(1, f.hp + f.shield);
      if (margin > this.killMargin) { this.killMargin = margin; this.killTarget = f; }
    }
    if (this.killMargin < (rift && this.lanePhase() ? this.diff.riftKillRead ?? 0.9 : 1.1)) this.killTarget = null;
    // lane opponent: the nearest noticed enemy fighter on my lane, close by
    this.laneEnemy = this.nearestEnemyFighter(this.prof.attackRange + 6);
    if (this.laneEnemy && this.lane >= 0 && !this.jungle) {
      if (this.laneFoe !== this.laneEnemy.id) { this.foeSince = this.now; this.foeHitAt = -1e9; }
      this.laneFoe = this.laneEnemy.id;
      const fs = this.m.castSeen(this.team, this.laneEnemy.id);
      if (this.laneEnemy.atkTarget === e.id || (fs && fs.some((x) => x > this.now))) this.foeHitAt = this.now;
      if (this.laneEnemy.stateOverride === 'recall') this.foeRecallAt = this.now;
    }
    // Wicks, summons and monsters hitting me
    let ud = 0;
    for (const u of tp.enemyUnits) if (u.alive && u.atkTarget === e.id && u.attackDef) ud += mitigated(u, e, u.stats.ad, u.attackDef.damageType) * u.stats.attackSpeed;
    for (const m of tp.monsters) if (m.alive && m.atkTarget === e.id && m.attackDef) ud += mitigated(m, e, m.stats.ad, m.attackDef.damageType) * m.stats.attackSpeed;
    this.unitDps = ud;
    // (lane AI G6: bodies within 18 m)
    let e18 = 0, a18 = 0;
    for (const f of tp.enemyFighters) if (this.isNoticed(f) && this.dist2(f, e.x, e.y) <= 18 * 18) e18++;
    for (const f of tp.allyFighters) if (f.alive && this.dist2(f, e.x, e.y) <= 18 * 18) a18++;
    this.nE18 = e18; this.nA18 = a18;
    // (lane AI G5: fog risk from memory only — where each enemy was last seen and how long ago; a fighter seen 20 s ago
    // 40 m away could be on me now)
    let risk = 0;
    if (rift && this.diff.riskCap < Infinity) {
      const ms = Math.max(1, e.stats.moveSpeed);
      for (const ls of tp.lastSeen.values()) {
        const age = this.now - ls.t;
        if (age < 6 || age > 40) continue;
        const f = this.w.entity(ls.id);
        if (!f || !f.alive) continue;
        const r = ms * age * 0.6 + 10;
        if (sq(ls.x - e.x) + sq(ls.y - e.y) <= r * r) risk += memoryWeight(ls, this.now, 40);
      }
      // (enemies never seen at all count as missing too, half each)
      const known = tp.lastSeen.size;
      if (this.brain && this.brain.aliveEnemies > known) risk += (this.brain.aliveEnemies - known) * 0.5;
    }
    this.fogRisk = risk;
    this.exposed = rift && risk >= this.diff.riskCap && this.alliesNear(e.x, e.y, 20) <= 1 && !this.lanePhase() && !!this.brain && this.brain.phase !== 'early' && !this.brain.rush;
  }

  /** lane AI G5: the visible enemy fighters within 10 m can take most of my health before my side finishes one of them
   *  (their attacks for 2.5 s plus a share for abilities, against mine and my partners' burst on the weakest of them) */
  private burstDanger(): boolean {
    const e = this.e;
    let inc = 0;
    let weakest: Entity | null = null;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > 10 * 10) continue;
      inc += this.dpsOn(f, e) * 2.5 + f.stats.ap * 0.9 + f.level * 22;
      if (!weakest || f.hp + f.shield < weakest.hp + weakest.shield) weakest = f;
    }
    if (!weakest || inc <= 0.8 * (e.hp + e.shield)) return false;
    let ours = this.burstOn(weakest);
    for (const a of this.perc.allyFighters) if (a !== e && a.alive && this.dist2(a, weakest.x, weakest.y) <= 9 * 9) ours += this.dpsOn(a, weakest) * 2.5 + a.stats.ap * 0.9 + a.level * 22;
    return ours < (weakest.hp + weakest.shield);
  }

  /** fighters are trading blows near me: an enemy fighter hitting one of us, or one of us hitting it */
  private fightOn(): boolean {
    const e = this.e, R2 = 13 * 13;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > R2) continue;
      const t = f.atkTarget >= 0 ? this.w.entity(f.atkTarget) : null;
      if (t && t.kind === 'fighter' && t.team === this.team) return true;
      for (const a of this.perc.allyFighters) if (a.alive && a.atkTarget === f.id) return true;
    }
    return false;
  }

  protected override unanswering(t: Entity): boolean {
    return this.k.kind === 'rift' && t.id === this.laneFoe && this.now - this.foeSince > 6 && this.now - this.foeHitAt > 6;
  }

  /** my lane opponent is dead, or was seen starting a recall in the last 9 s and is not back in sight */
  private foeAway(): boolean {
    if (this.lane < 0 || this.jungle || this.support || this.laneFoe < 0) return false;
    const foe = this.w.entity(this.laneFoe);
    if (!foe) return false;
    if (!foe.alive) return true;
    return this.now - this.foeRecallAt < 9 && !(this.isNoticed(foe) && this.dist2(foe, this.e.x, this.e.y) < 25 * 25);
  }

  /** a ready ability that holds its target (stun, root, sleep...) */
  private ccReady(): boolean {
    const e = this.e;
    for (let i = 0; i < 4; i++) {
      const s = e.slots[i];
      if (s && s.ready && abilityInfo(s.def).cc && s.def.ai.use.some((u) => u === 'cc')) return true;
    }
    return false;
  }

  /** a RIFT laner in the laning phase: the lane comes first */
  private lanePhase(): boolean {
    const b = this.brain;
    return this.k.kind === 'rift' && !this.jungle && this.lane >= 0 && this.now < LANE_PHASE_END && !!b && !b.rush && !b.stage && b.phase !== 'late';
  }

  /** enemy Wicks within r of (x, y) */
  private wicksNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const u of this.perc.enemyUnits) if (u.alive && u.kind === 'minion' && this.dist2(u, x, y) <= r * r) n++;
    return n;
  }

  /** rough sustained damage per second of a fighter against `t` (attacks + a share for abilities) */
  private dpsOn(f: Entity, t: Entity): number {
    const s = f.stats;
    return s.ad * s.attackSpeed * (1 + s.crit * 0.75) * (100 / (100 + Math.max(0, t.stats.armor))) + s.ap * 0.5 + f.level * 10;
  }

  /**
   * Wicks or monsters are wearing me down and no enemy fighter is near: walk out before they finish
   * me — unless the monster on me dies first (my team's damage on it beats my time to die).
   * Returns a retreat utility (0: stay).
   */
  private outmatched(): number {
    const e = this.e;
    const inc = Math.max(this.unitDps, this.recentDps);
    if (inc <= 0 || this.nearE > 0) return 0;
    const ttd = (e.hp + e.shield) / inc;
    // (W4 G1 refix: an objective monster on me that my team is not taking now — I am not in on a start the fighters at
    // it can finish — sends me out at once, before its sweeps and its growing hits leave too little to walk away on)
    if (ttd < 20 && !(this.mode === 'objective' && this.pMonsters)) {
      for (const m of this.perc.monsters) if (m.alive && m.atkTarget === e.id && this.objectiveMonster(m)) return 0.82;
    }
    // (a stacked wave can take a full-health fighter in seconds: leave on the time to die alone)
    if (ttd > (this.hpF > 0.7 ? 6 : 9)) return 0;
    let ttk = Infinity;
    for (const m of this.perc.monsters) {
      if (!m.alive || m.atkTarget !== e.id) continue;
      let dps = 0;
      for (const a of this.perc.allyFighters) if (a.alive && this.dist2(a, m.x, m.y) <= 10 * 10) dps += this.dpsOn(a, m);
      ttk = Math.min(ttk, (m.hp + m.shield) / Math.max(1, dps));
    }
    // (nearly dead, only a monster that is about to fall is worth the last swing; a jungler on its
    // own camp finishes one that falls well before it would)
    // (W4 G1 refix: the Wicks on me keep hitting after the monster falls — their own time to finish me is not
    // outlasted by the monster, so they send me out whatever the camp does)
    let wd = 0;
    for (const u of this.perc.enemyUnits) if (u.alive && u.atkTarget === e.id && u.attackDef) wd += mitigated(u, e, u.stats.ad, u.attackDef.damageType) * u.stats.attackSpeed;
    const wickTtd = wd > 0 ? (e.hp + e.shield) / wd : Infinity;
    if (wickTtd > 9 && ttk < (this.hpF < 0.3 ? Math.min(ttd * 0.6, 2) : ttd * (this.jungle ? 0.8 : 0.6))) return 0;
    return ttd < 3 ? 0.9 : 0.82;
  }

  // ── utility mode selection ────────────────────────────────────────────────────────────────────
  private selectMode(): void {
    this.situate();
    const k = this.k, kind = k.kind, e = this.e, b = this.brain, now = this.now;
    if (now - this.followRollAt > 15) {
      this.followRollAt = now; this.follows = this.rng.chance(this.diff.intentFollow);
      // (lane AI G6: a group call is followed at least groupFollowFloor of the time — the roll only delays the arrival)
      this.groupFollows = this.follows || (this.diff.groupFollowFloor > 0 && this.rng.chance(this.diff.groupFollowFloor));
    }
    const hpF = this.hpF;
    const res = e.resource;
    const resF = res && res.model === 'pool' && e.maxRes > 0 ? e.res / e.maxRes : 1;
    const lives = this.p.lives;
    // FRAY last-life caution (W4 gameplay G6): only while more than 4 seats are still in and before the Noon Toll
    // rings — six bots on their last life used to circle the middle for minutes without a fight
    const lastLife = kind === 'fray' && lives !== undefined && lives <= 1 && this.frayCareful();
    // under the Noon Toll nobody can hide: the outnumbered-in-a-crowd retreats (a third party near) are off, only low
    // health still sends a bot away — three survivors used to circle each other until the clock ran out
    const tolled = kind === 'fray' && this.tollRinging();
    // (CW3s r2 refix, CL-1: on a road in the laning phase a skilled tier's read of its own burst holds it in the trade; its caution
    // bias, right for the mid game, left veteran laners with fewer takedowns than adept ones on every real-seat window)
    const edgy = this.lanePhase();
    // (lane AI G5: alone with enemies unaccounted for in the fog, a fighter leaves a fight 10 points of health sooner)
    const thr = this.prof.retreatHp + (edgy ? this.diff.riftRetreatBias ?? this.diff.retreatBias : this.diff.retreatBias) + (lastLife ? 0.15 : 0) + (this.adv < 0.4 && !tolled ? 0.08 : 0) - (tolled ? 0.05 : 0) + (this.exposed ? 0.1 : 0) +
      (kind === 'rift' && !edgy && !!b && b.gleamLead >= 2000 ? this.diff.aheadCaution : 0);
    let best: Mode = this.mode, bestS = -1;
    const consider = (m: Mode, s: number): void => {
      if (s <= 0) return;
      s += gauss(this.rng) * this.diff.decisionNoise * 0.3;
      if (m === this.mode) s += now - this.modeSince < 3 ? 0.12 : 0.05;
      if (s > bestS) { bestS = s; best = m; }
    };
    // retreat
    let retreat = 0;
    // (CW3s refix 2, CL-1: a RIFT laner in the laning phase plays its lane closer to the edge — it leaves a trade 5 points
    // of health later and turns from a merely worse 2v2 only below 0.36, not 0.42: laning kills come from the
    // trades a laner stays in a moment too long, and the wave's last hits from staying on it)
    // (for the whole laning phase: the longest quiet stretch started at 8:00-12:00 when this ended at 9:00; the Dawn Seal, up to 8:00 now, keeps the first Needle in G4's 9–12 band)
    if (this.nearE > 0) {
      if (hpF < thr - (edgy ? 0.05 : 0)) retreat = 0.85 + (thr - hpF);
      else if (tolled) retreat = 0;
      else if (this.adv < 0.3 && this.nearE >= 2) retreat = 0.8;
      else if (this.adv < (edgy ? 0.36 : 0.42) && hpF < 0.5) retreat = 0.7;
    }
    if (this.towerAggro && !(this.mode === 'allin' && this.killTarget && this.killTarget.hp < this.killTarget.maxHp * 0.25 && hpF > 0.5)) retreat = Math.max(retreat, 0.86);
    if (kind === 'fray' && hpF < thr && this.recentDps > 0) retreat = Math.max(retreat, 0.75);
    // (owner_rulings 44: FRAY — nearly out with a foe within 10 m and no kill of mine on, a skilled fighter breaks off whether or
    // not the blows are landing this moment; the old read needed fresh damage, so a fighter at 15 % between swings stood in
    // reach: 98 of 150 such moments at veteran ended with the foe still within 12 m 4 s later. Not under the Noon Toll, which
    // is there to end the arena)
    if (kind === 'fray' && this.diff.frayBreak > 0 && hpF < this.diff.frayBreak + (lastLife ? 0.1 : 0) && !tolled && this.nearestEnemyFighter(10) !== null &&
      !(this.killTarget && this.killMargin >= 1.2)) retreat = Math.max(retreat, 0.9);
    // (ruling 55: FRAY early break — a skilled fighter whose health is going and whose fight is not won (blows landing on
    // me, the trade read against me, no kill of mine on) leaves while it still has the health to walk away on; breaking at the
    // last fifth left the chaser in reach for the whole walk: 70 % of the low moments still had a foe within 12 m 4 s later)
    if (kind === 'fray' && this.diff.frayBreak > 0 && !tolled && hpF < this.diff.frayBreak + FRAY_EARLY && this.recentDps > 0 && this.adv < 0.5 &&
      !(this.killTarget && this.killMargin >= 1)) retreat = Math.max(retreat, 0.88);
    // (lane AI G5: leave early when the visible enemies' burst would take most of my health before my side finishes one of
    // them — RIFT from the mid game: not in a road's laning phase, whose trades CL-1 tuned, never off a kill that is on, and
    // not in FRAY, where every seat turning from the hardest hitter handed it the placements, ulkro 2.7 against the 3.5 floor)
    if (this.diff.burstRetreat && this.nearE > 0 && kind === 'rift' && !edgy && !!b && b.phase !== 'early' && hpF < (lastLife ? 0.85 : 0.75) &&
      !(this.killTarget && this.killMargin >= 1.2) && !tolled && this.burstDanger()) retreat = Math.max(retreat, 0.86);
    retreat = Math.max(retreat, this.outmatched());
    consider('retreat', retreat);
    // recall / shop
    const lp = this.lanePhase();
    const base = k.bases.find((x) => x.team === this.team);
    const atBase = !!base && this.dist2(e, base.fx, base.fy) <= sq(base.fr + 1.5);
    const nextPrice = this.eco.nextPrice(this.w, this.p);
    let recall = 0;
    if (kind !== 'fray') {
      if (base) {
        // without a recall the walk home is the cost: only go when nearly out (attrition modes)
        // (a jungler with a camp to take now finishes it first: no shopping trip, and home on low
        // health only once the camp would take more than it has left)
        const camp = this.jungle && kind === 'rift' && this.campAtHand(14);
        const lowAt = (k.rules.recall ? (lp ? 0.25 : camp ? 0.22 : 0.36) : 0.22) + (edgy ? this.diff.riftRecallBias ?? this.diff.recallBias : this.diff.recallBias);
        // (lane AI G1: a defender posted to a structure leaves the fountain once it is fit to — the shop works anywhere
        // in the base, ruling 31)
        const posted = !!b && b.guard.has(this.player) && hpF >= 0.5;
        if (atBase && !posted && (hpF < 0.9 || (this.p.canShop && this.eco.canBuyNow(this.w, this.p)))) recall = 0.92;
        // (CW3 CL-1: a laner with a wave of its own to take and no enemy fighter in sight takes it before going home,
        // unless it is nearly out — a recall at every trade's end cost the roads their last hits)
        else if (hpF < lowAt && this.nearE === 0 && !(lp && hpF > 0.18 && this.unitDps <= 0 && this.wicksNear(e.x, e.y, 12) >= 3 && this.nearestEnemyFighter(22) === null)) recall = 0.74;
        else if (camp) recall = 0;
        else if (k.rules.recall && lp) {
          // laning: shop on a real purchase, and not while a wave is there to farm
          const farm = this.wicksNear(e.x, e.y, 12) >= 3 && hpF > 0.35;
          if (this.nearE === 0 && !farm) {
            // (CW3 CL-1: a laner fresh from a won trade or a kill does not walk home on 1,250 Gleam at 59 % — the road pays
            // more; it goes once it is really worn down or the purchase is a big one)
            if (this.p.gold >= Math.max(nextPrice, 1250) && hpF < 0.38) recall = 0.5;
            else if (this.p.gold >= Math.max(nextPrice, 2000)) recall = 0.46;
            else if (resF < 0.1 && hpF < 0.7) recall = 0.5;
          }
        }
        else if (k.rules.recall && this.p.gold >= Math.max(nextPrice, 1100) && this.nearE === 0 && hpF < 0.8) recall = 0.5;
        else if (k.rules.recall && this.p.gold >= Math.max(nextPrice, 1700) && this.nearE === 0) recall = 0.46;
        else if (k.rules.recall && resF < 0.12 && this.nearE === 0) recall = 0.5;
      }
    } else if (k.shops.length > 0 && this.nearE === 0 && this.p.gold >= nextPrice && nextPrice < Infinity) recall = 0.52;
    // a jungler whose next camp is up but too much for its health goes home first, not in and out
    if (this.jungle && kind === 'rift' && this.nearE === 0 && hpF < 0.6 && this.mode === 'farm' && this.campTarget >= 0) {
      const c = k.camps[this.campTarget];
      if (c && this.campUp(c.x, c.y) && this.dist2(e, c.x, c.y) < 16 * 16 && !this.campOdds(c.x, c.y)) recall = Math.max(recall, 0.6);
    }
    // (lane AI G3: a laner holds its wave — no shopping trip — while a partner's gank is on its way to its road)
    if (recall > 0 && recall < 0.7 && b && b.gankComing === this.lane && now - b.gankComingAt < 1 && hpF > 0.3) recall *= 0.6;
    consider('recall', recall);
    // lane / return
    const laner = (kind === 'rift' && !this.jungle && this.lane >= 0) || kind === 'bridge';
    if (laner) {
      this.computeHold();
      const far = this.dist2(e, this.holdX, this.holdY) > 22 * 22;
      consider(far ? 'return' : 'lane', far ? 0.43 : 0.4);
    }
    // farm
    if (this.jungle) consider('farm', 0.45);
    else if (kind === 'rift' && b && b.phase !== 'early' && this.nearbyCamp(25) >= 0 && this.perc.enemyUnits.length === 0) consider('farm', 0.3);
    // trade: only with an edge (hp lead, their cooldowns spent, them low), short, then a breather
    const le = this.laneEnemy;
    // (CW3s r2, critic bot-micro: the breather is short against an opponent that has not answered a blow)
    // (r2 refix: 5 s long against it)
    const unanswered = kind === 'rift' && now - this.foeHitAt > 8;
    if (this.mode === 'trade' && now - this.modeSince > (unanswered ? 5 : 3.5)) this.tradeRestUntil = now + (unanswered ? 1.2 : 6);
    if (le && hpF > (edgy ? 0.5 : 0.55) && this.adv >= 0.45 && now >= this.tradeRestUntil && this.towerSafe(le.x, le.y, 0.5) &&
      (this.mode === 'lane' || this.mode === 'trade' || this.mode === 'push')) {
      const leF = le.hp / Math.max(1, le.maxHp);
      const spent = this.diff.knowsCooldowns ? this.m.spentAbilities(le.id, now, this.team) : 0;
      // hitting a fighter that stands in its own wave turns that wave on me: a trade there costs more
      const wavePenalty0 = Math.max(0, this.coverWicks(le) - 1) * 0.07 + (this.unitDps > 0 ? 0.1 : 0);
      // (CW3 CL-1 measured trade windows — a level on the opponent, my burst ready, the opponent turning to a Wick — on
      // 40 games: +1 takedown by 10:00 for −2 to −3 points of the roads' last-hit share; they stay out)
      // (CW3 critic bot-micro: an opponent that has not answered a single blow while it laned against me — no swing at me,
      // no cast seen — is pressed: a passive laner is zoned off its Wicks and punished, as a player would)
      // (CW3s refix: 0.3 after 12 s; at 0.15 after 20 s a passive seat took less damage than the bot-played one)
      // (refix 2: 0.3 after 12 s still left the passive seat at 288 vs 321 damage a minute: 0.4 after 8 s)
      // (r2-bots: 0.4 still left the passive seat under the bot-played one against veteran bots, 309 vs 356 a minute: 0.55 after 6 s)
      const passive = kind === 'rift' && le.id === this.laneFoe && now - this.foeSince > 6 && now - this.foeHitAt > 6 ? this.diff.riftPassivePress ?? 0.55 : 0;
      // (CW3s refix, with fight-time last hits in: the power spikes are trade windows again, a level on the opponent at 2
      // or 3 and my ultimate up while it has none; the trades no longer cost the road its last hits)
      const lvl = kind === 'rift' && this.lanePhase() ? this.spikeEdge(le) : 0;
      // (CW3s r2, critic bot-micro: a passive opponent's wave is half the deterrent: it never answers the trade that wakes it)
      const wavePenalty = passive > 0 ? wavePenalty0 * 0.5 : wavePenalty0;
      const edge = (hpF - leF) + spent * 0.12 + (leF < 0.45 ? 0.2 : 0) + (this.adv - 0.5) + passive + lvl - wavePenalty;
      if (edge >= 0.12 || (this.mode === 'trade' && edge > -0.1)) consider('trade', 0.42 + Math.min(0.25, Math.max(0, edge)));
      // (a passive opponent that let me take half its health without answering is finished, as a player would)
      if (passive > 0 && leF < 0.55 && hpF - leF >= 0.15 && this.enemiesNear(le.x, le.y, 10) <= 1 && this.towerSafe(le.x, le.y, 0)) { this.killTarget = le; consider('allin', 0.72); }
    }
    // all-in
    const kt = this.killTarget;
    if (kt && hpF > 0.3 && (!this.exposed || this.killMargin >= 1.3) && (this.towerSafe(kt.x, kt.y, 0) || (kt.hp < kt.maxHp * 0.2 && hpF > 0.6))) {
      consider('allin', 0.7 + Math.min(0.2, (this.killMargin - 1) * 0.2) - (lastLife && this.killMargin < 1.5 ? 0.15 : 0));
    } else if (kind === 'rift' && le && !this.jungle && (this.mode === 'trade' || this.mode === 'allin') && hpF > 0.5 && this.towerSafe(le.x, le.y, 0)) {
      // (CW3 CL-1: a trade I am winning — its health well under mine and below half, nobody of theirs beside it — is pressed
      // into an all-in instead of a step back: that is where laning kills come from)
      const leF = (le.hp + le.shield) / Math.max(1, le.maxHp);
      if (leF < 0.5 && hpF - leF >= 0.2 && this.adv >= 0.5 && this.enemiesNear(le.x, le.y, 10) <= 1) { this.killTarget = le; consider('allin', 0.72); }
    }
    // (CW3 CL-1: a gank on my road is two on one only if I turn on its target too — the grovehunter at it, or already on
    // it, and me close enough to join: that is the laner's half of the gank)
    const gk = b && kind === 'rift' && !this.jungle && b.gank && b.gankLane === this.lane ? b.gank : null;
    if (gk && gk.alive && this.isNoticed(gk) && hpF > 0.4 && this.dist2(gk, e.x, e.y) < 11 * 11 && (this.towerSafe(gk.x, gk.y, 0) || gk.hp < gk.maxHp * 0.25)) {
      let mate = false;
      for (const a of this.perc.allyFighters) {
        if (a === e || !a.alive || !a.player) continue;
        const al = b ? b.laneOf(a.player.player) : null;
        // (my lane partner is the lane, not the gank: a duo road turning every 2v2 into an all-in measured +1 takedown by
        // 10:00 for −1.5 points of last-hit share)
        if (al && !al.jungle && al.lane === this.lane) continue;
        if (this.dist2(a, gk.x, gk.y) < 9 * 9 || (b && b.focus.get(a.player.player) === gk.id)) { mate = true; break; }
      }
      if (mate) { if (!this.killTarget || this.killTarget === gk) { this.killTarget = gk; consider('allin', 0.76); } }
    }
    // (CW3 CL-1: a committed all-in is seen through — the combo it was started on is spent the moment it lands, and
    // dropping the chase then let every wounded target walk home; it holds while the target stays in reach, is hurt
    // worse than I am, and I am not the one about to fall)
    const ct = this.allinTarget >= 0 ? this.w.entity(this.allinTarget) : null;
    // (RIFT only: BRIDGE's pace — G5's 15–18 min median — was measured on all-ins that let go)
    if (kind === 'rift' && this.mode === 'allin' && ct && ct.alive && ct !== this.killTarget && this.isNoticed(ct) && now - this.modeSince < ALLIN_COMMIT) {
      const cF = (ct.hp + ct.shield) / Math.max(1, ct.maxHp);
      if (this.dist2(ct, e.x, e.y) < 12 * 12 && hpF > 0.3 && (cF < 0.35 || cF < hpF - 0.1) && (this.towerSafe(ct.x, ct.y, 0) || (cF < 0.2 && hpF > 0.5))) {
        if (!this.killTarget) this.killTarget = ct;
        consider('allin', 0.74);
      }
    }
    // teamfight (laning: two against two is a lane, not a fight — join only one that has started)
    if (this.nearE >= 2 && this.nearA >= 2 && this.adv >= 0.42 && (!lp || this.nearE + this.nearA >= 5 || this.fightOn())) {
      consider('teamfight', 0.6 + (this.adv - 0.5) * 0.6);
    } else if (kind === 'rift' && b && b.phase !== 'early' && !lp && this.nE18 >= 2 && this.nE18 + this.nA18 >= 5 && this.adv >= 0.45) {
      // (lane AI G6: five or more bodies within 18 m in the mid game is a team fight — the team joins it as one)
      consider('teamfight', 0.62 + (this.adv - 0.5) * 0.6);
    }
    // (lane AI G2: a partner being dived or held — turn and protect it)
    const pu = this.protectUtility();
    if (pu > 0) consider('protect', pu);
    // push / group / defend / objective / roam (team intents)
    if (b) {
      const follow = this.follows ? 1 : 0;
      if (b.rush) {
        // at the open core / a gate: hitting it beats chasing heroes
        const coreOpen = !!b.siege && !!this.m.structInfo(b.siege)?.isCore;
        const r = coreOpen ? 32 : 16;
        const near = !!b.siege && b.siege.alive && b.siege.targetable && this.dist2(e, b.siege.x, b.siege.y) < r * r;
        consider('push', near && hpF > 0.2 ? 0.92 : hpF > 0.35 ? 0.79 : 0.5);
      }
      else if (b.stage) consider('push', hpF > 0.5 ? 0.66 : 0.4);
      else if (b.window && b.siege && hpF > 0.4 && (!this.jungle || b.phase !== 'early')) consider('push', 0.72);
      // (a lead to press, W4 G3: the tiers that convert leads group on the siege without a won fight)
      else if (b.press && b.siege && !b.objective && hpF > 0.5 && (!this.jungle || b.phase !== 'early')) consider('push', 0.62);
      else if (kind === 'bridge' || kind === 'brawl') consider('push', b.siege ? 0.5 : 0.35);
      // (lane AI G6: the split-pusher takes its road; the rest follow the group call at least groupFollowFloor of the time)
      else if (b.group && b.splitSeat === this.player && b.splitLane >= 0 && hpF > 0.45) consider('push', 0.64);
      else if (b.group && (follow || this.groupFollows) && (!this.jungle || b.phase === 'late') && (!this.diff.objectiveSense || hpF > 0.45)) consider('push', kind === 'rift' && this.diff.groupFollowFloor > 0 ? 0.64 : 0.56);
      // (laning: shove my own lane only while no enemy fighter is there to farm it under its tower)
      else if (this.lane >= 0 && b.push[this.lane] > 0 && !this.jungle && (!lp || this.nearestEnemyFighter(20) === null)) consider('push', 0.3 + 0.2 * b.push[this.lane]);
      // (sent to answer a threatened road, W4 G3: before the plan, not before my life)
      if (b.answer.has(this.player) && hpF > 0.5) consider('defend', 0.8);
      // (lane AI G1: posted to a threatened structure — the post comes before the plan, and in the laning phase too)
      const post = b.guard.get(this.player);
      // (the base outranks a siege at its tower — 0.92 — an inner Needle does not: that siege hands the post on, below)
      if (post && hpF > 0.3) consider('defend', post.cls === 0 ? 0.78 : post.cls === 1 ? 0.84 : 0.95);
      const d = this.lane >= 0 ? b.defend[this.lane] : 0;
      let global = 0;
      // (a tier that reads waves sends answers to a threatened road; the whole team turns for a push of three or more
      // fighters, or the base — not for every Wick at a Needle, which pulls it off its own siege; W4 G3 refix)
      for (let i = 0; i < b.defend.length; i++) if (!this.diff.readsWaves || b.defendFighters[i] >= 3) global = Math.max(global, b.defend[i]);
      // (ruling 56: Wicks alone at the base do not turn a team that has just won its fight — its posts send one to clear them)
      if (!(b.window && b.baseFighters === 0 && kind === 'rift')) global = Math.max(global, b.baseThreat);
      if (lp) {
        // laning: a wave or my lane opponent at my own tower is laning (lane mode clears it under the
        // tower); I defend only a dive — more enemy fighters at my tower than my lane has laners —
        // and the base. Other lanes are their laners' and the jungler's to answer.
        if (d > 0.05 && b.defendFighters[this.lane] > b.lanersOn(this.lane)) consider('defend', (0.5 + 0.35 * d) * (follow ? 1 : 0.85));
        else if (b.baseThreat >= 0.7 && follow) consider('defend', 0.55 + 0.2 * b.baseThreat);
        else {
          // (CW3 gameplay CL-g1: a siege of three or more enemy fighters on any road ends the hold for the whole team —
          // the other roads used to keep farming while one road and then the base fell)
          let siege = 0;
          for (let i = 0; i < b.defend.length; i++) if (b.defendFighters[i] >= 3) siege = Math.max(siege, b.defend[i]);
          if (siege > 0.05 && follow && hpF > 0.4) consider('defend', 0.55 + 0.2 * siege);
        }
      } else if (d > 0.05) consider('defend', (0.5 + 0.35 * d) * (follow ? 1 : 0.85));
      else if (global >= 0.7 && follow && (!this.diff.objectiveSense || kind !== 'rift' || hpF > 0.4)) consider('defend', 0.55 + 0.2 * global);
      // laning: only the laners of the lane beside an objective go, and only on an opening (it is up
      // and we have a fighter more), not to wait for its spawn; the other lanes keep farming
      // (the jungler too: during the laning phase no one comes to wait with it, so it keeps its camps)
      const oc = b.objective?.camp;
      const opening = !!b.objective && b.objective.desire >= 0.75;
      const jungleLaning = this.jungle && kind === 'rift' && now < LANE_PHASE_END && b.phase !== 'late';
      if (b.objective && oc && follow && (lp ? opening && this.nearestLane(oc.x, oc.y) === this.lane && this.laneDist2(oc.x, oc.y) <= sq(LANE_OBJECTIVE_REACH)
        : (!jungleLaning || opening) && (!this.jungle || now >= JUNGLE_OBJECTIVE_FROM)) && (!this.diff.objectiveSense || hpF > (this.mode === 'objective' ? 0.3 : 0.45))) {
        consider('objective', b.objective.desire + (this.jungle ? 0.05 : 0));
      }
      // (a jungler ganks between its camps from JUNGLE_GANK_FROM: not with a camp up right here, and only a road in reach;
      // a laner holds its road through the laning phase — CW3 CL-1 measured laners' roams from a shoved road: the road
      // they left lost more Wicks than the roams won takedowns)
      // (owner_rulings 44: sent to punish an invader in our half of the Dialwood — before the lane and the camps)
      const inv = b.hunters.has(this.player) ? b.invader : null;
      if (inv && inv.alive && hpF > 0.5 && this.isNoticed(inv)) consider('roam', 0.74);
      const g = this.roamGoal();
      if (!inv && g && g.alive && hpF > 0.6 && !this.exposed && now >= this.roamBlockUntil) {
        // (a planned gank whose target slipped out of sight a moment ago is measured from the thicket I walk to, not its hidden spot)
        const d2 = this.isNoticed(g) ? this.dist2(e, g.x, g.y) : this.dist2(e, this.roamX, this.roamY);
        // (lane AI G3: a planned approach and a lurk take longer than a straight walk)
        const roaming = this.mode === 'roam' && now - this.modeSince < ROAM_MAX + this.diff.lurkMax;
        if (this.jungle) {
          if (now >= JUNGLE_GANK_FROM && e.level >= 3 && (roaming || g.hp < g.maxHp * 0.6 || !this.campAtHand(10)) && d2 < sq(roaming ? 70 : 55)) consider('roam', 0.53);
        } else if (!lp) {
          if ((this.prof.style === 'burst' || this.prof.style === 'diver') && d2 < sq(50)) consider('roam', 0.44);
        }
      }
    }
    // Fray hunting
    if (kind === 'fray' || kind === 'brawl') {
      const t = this.chooseHunt(lastLife);
      this.huntTarget = t;
      consider('hunt', t ? 0.5 + Math.min(0.3, this.huntQuality * 0.2) : 0.3);
    }
    // pickups
    const pk = this.nearestPickup();
    if (pk) {
      const d = Math.sqrt(this.dist2(e, pk.x, pk.y));
      if (hpF < 0.7 && d < 40) consider('pickup', 0.45 + (0.7 - hpF) * 0.8);
      else if (kind === 'fray' && d < 12) consider('pickup', 0.42);
    }
    if (bestS < 0) best = laner ? 'lane' : this.jungle ? 'farm' : kind === 'fray' ? 'hunt' : 'push';
    // (lane AI G1: a defender that has not turned to its post 2 s after it was given, and is not at it, hands it on — the
    // team brain asks the next fastest; one held by a siege or a trip home used to keep the post while the tower fell)
    if (b) {
      const post = b.guard.get(this.player);
      if (post && best !== 'defend' && now - post.since >= 2 && this.dist2(e, post.x, post.y) > 18 * 18) {
        b.guard.delete(this.player); b.guardDeclined.set(this.player, now + 10);
      }
    }
    // hysteresis: a young mode is kept unless the newcomer is urgent
    if (best === 'allin' && this.killTarget && (best !== this.mode || this.allinTarget < 0)) this.allinTarget = this.killTarget.id;
    if (best !== this.mode) {
      if (now - this.modeSince < MIN_MODE_TIME && bestS < 0.8) return;
      if (this.mode === 'allin') this.allinTarget = -1;
      if (this.mode === 'roam') this.roamTarget = -1;
      if (best === 'allin' && this.killTarget) this.allinTarget = this.killTarget.id;
      this.mode = best;
      this.modeSince = now;
      this.recallTriedAt = -1e9;
      this.campTarget = -1;
    }
  }

  /** ruling 55: fit, nothing hitting me, no enemy fighter noticed within 25 m */
  private calm(): boolean {
    return this.hpF >= 0.85 && this.recentDps <= 0 && this.nearestEnemyFighter(25) === null;
  }

  /**
   * ruling 55 (no pacing): a calm fighter (fit, nothing hitting it, no enemy fighter noticed within 25 m) walking a
   * plan does not turn round more than once in 8 s. When the plan's point flips behind it again within 8 s of its last
   * turn — two calls, two roads or two camps trading places as their values cross, the team's call flickering — it keeps
   * walking to the point it set out for until it gets there or the 8 s are up. Never for a fight, a retreat, a recall, a
   * peel, the rush, a post at a base structure or the core, or the base under attack: those turn at once. The flicker
   * walked full-health fighters back and forth 2-5 times a game (veteran, whose calls carry no delay, most).
   */
  private holdWalk(): void {
    if (this.k.kind === 'fray' || !this.pMove) return;
    const e = this.e, now = this.now, b = this.brain;
    const post = b ? b.guard.get(this.player) : undefined;
    // (ruling 55: a post at a base structure is urgent only while that structure or the base is being hit — a quiet
    // post handed between two Lanterns walked a full-health defender back and forth)
    const nx = this.pMoveX - e.x, ny = this.pMoveY - e.y, n2 = nx * nx + ny * ny;
    // (ruling 55: a wave to clear, a camp or a structure to hit is urgent only once it is at hand — 10 m; the flags are
    // set the whole walk there, and a full-health veteran walking to a camp, a post's wave or a siege turned on every flicker
    // of the team's call: 2.6-3.3 back-and-forth episodes a game against a bar of 1)
    const atHand = n2 <= 10 * 10;
    const urgent = !WALKS.has(this.mode) || this.pFight !== null || ((this.pSiege !== null || this.pClear || this.pMonsters) && atHand) || !this.calm() ||
      (!!b && (b.rush || b.baseThreat >= 0.7)) || (this.mode === 'defend' && !!post && post.cls >= 2 && !!b && b.hitRecently(post.sid, this.now, 4));
    if (n2 < 4 * 4) return;
    const nd = Math.sqrt(n2), dx = nx / nd, dy = ny / nd;
    // (ruling 55: a turn is a walk that reverses the last one — heading against heading, not point against point: the
    // round-3 latch let a fighter that reached one point walk straight back to the other, and pace on)
    // (ruling 55: a right-angle turn or more — two calls a quarter-circle apart zigzag a fighter as surely as two opposite)
    const turn = this.headX * dx + this.headY * dy < 0.1;
    // (ruling 55: one turn in 12 s, not 8 — two turns 8 s apart are three legs inside a 12 s window, the pacing itself)
    if (turn && !urgent && now - this.latchAt < 12) {
      if (sq(this.latchX - e.x) + sq(this.latchY - e.y) > 1.5 * 1.5) { this.pMoveX = this.latchX; this.pMoveY = this.latchY; }
      else { this.pMoveX = e.x; this.pMoveY = e.y; }
      return;
    }
    if (turn) this.latchAt = now;
    this.headX = dx; this.headY = dy;
    this.latchX = this.pMoveX; this.latchY = this.pMoveY;
  }

  /**
   * ruling 55 (base defence): a fit fighter (60 % or more) beside a structure of mine — an inner Needle or the base —
   * that enemy Wicks are hitting, with no enemy fighter noticed at it, clears the wave: into reach of the Wick nearest the
   * structure, every swing and its wave spells on the Wicks hitting it, holding against the wave until the Wicks on me would
   * finish me within 4 s. Not in a fight, a retreat, a recall or a peel. Fighters in any other plan who stood beside the
   * structure while a wave took it — pushing past it, walking to a call, waiting at the group point — were half of the
   * 'falls to Wicks beside fit defenders' left after ruling 44.
   */
  private clearOwn(): void {
    // (ruling 55: a fighter I am set on but cannot reach does not hold me off the wave — a defender walking at a fighter
    // 13 m off the structure watched the Wicks finish it)
    if (this.k.kind !== 'rift' || this.pClear || (this.pFight && inAttackRange(this.e, this.pFight)) || this.pSiege || this.hpF < 0.6) return;
    const m = this.mode;
    if (m === 'retreat' || m === 'recall' || m === 'allin' || m === 'teamfight' || m === 'protect' || m === 'trade') return;
    const e = this.e, b = this.brain;
    if (!b) return;
    let st: Entity | null = null, sd = 14 * 14;
    for (const s of this.perc.allyStructs) {
      if (!s.alive || !s.targetable) continue;
      const d2 = this.dist2(s, e.x, e.y);
      if (d2 > sd) continue;
      const info = this.m.structInfo(s);
      if (!info || b.classOf(info) < 1) continue;
      st = s; sd = d2;
    }
    if (!st) return;
    let wk: Entity | null = null, wd = Infinity;
    for (const u of this.perc.enemyUnits) {
      if (!u.alive || u.kind !== 'minion' || !u.targetable || u.atkTarget !== st.id) continue;
      const d2 = this.dist2(u, st.x, st.y);
      if (d2 < wd) { wd = d2; wk = u; }
    }
    if (!wk) return;
    for (const f of this.perc.enemyFighters) if (this.isNoticed(f) && this.dist2(f, st.x, st.y) <= 12 * 12) return;
    this.pClear = true; this.pFarm = 2; this.pMonsters = false; this.pFight = null;
    const r = e.stats.range + e.radius + wk.radius;
    this.pMove = true;
    if (this.dist2(wk, e.x, e.y) > sq(r + 0.5)) {
      // (from the structure's side of the Wick, inside its cover)
      const dx = st.x - wk.x, dy = st.y - wk.y, dd = dhypot(dx, dy) || 1;
      this.pMoveX = wk.x + (dx / dd) * Math.max(0.5, r - 0.6); this.pMoveY = wk.y + (dy / dd) * Math.max(0.5, r - 0.6);
    } else { this.pMoveX = e.x; this.pMoveY = e.y; }
    this.waveGuard(true);
  }

  // ── executors ─────────────────────────────────────────────────────────────────────────────────
  private execute(): void {
    const base = this.k.bases.find((x) => x.team === this.team);
    this.computeSafe(base);
    switch (this.mode) {
      case 'lane': this.execLane(); break;
      case 'return': this.computeHold(); this.pMove = true; this.pMoveX = this.holdX; this.pMoveY = this.holdY; this.selfDefense(); this.shedWicks(); break;
      case 'farm': this.execFarm(); break;
      case 'trade': this.execTrade(); break;
      case 'allin': this.execAllin(); break;
      case 'retreat': this.execRetreat(); break;
      case 'recall': this.execRecall(base); break;
      case 'push': this.execPush(); break;
      case 'defend': this.execDefend(); break;
      case 'objective': this.execObjective(); break;
      case 'roam': this.execRoam(); break;
      case 'teamfight': this.execTeamfight(); break;
      case 'hunt': this.execHunt(); break;
      case 'pickup': this.execPickup(); break;
      case 'protect': this.execProtect(); break;
    }
  }

  /** where to run: behind the nearest own tower toward base, the fountain, or away from threats */
  private computeSafe(base: { fx: number; fy: number } | undefined): void {
    const e = this.e;
    if (base) {
      let best: Entity | null = null, bd = Infinity;
      for (const st of this.perc.allyStructs) {
        if (!st.alive || !st.attackDef || st.stats.ad <= 0) continue;
        const d2 = this.dist2(st, e.x, e.y);
        // only towers between me and home count
        if (this.dist2(st, base.fx, base.fy) > this.dist2(e, base.fx, base.fy) + 4) continue;
        if (d2 < bd) { bd = d2; best = st; }
      }
      if (best && this.hpF > 0.2) {
        const dx = base.fx - best.x, dy = base.fy - best.y, d = dhypot(dx, dy) || 1;
        this.safeX = best.x + (dx / d) * 3; this.safeY = best.y + (dy / d) * 3;
      } else { this.safeX = base.fx; this.safeY = base.fy; }
      return;
    }
    // no base: away from the noticed enemies, toward open ground
    let ax = 0, ay = 0, n = 0;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f)) continue;
      const dx = e.x - f.x, dy = e.y - f.y, d2 = dx * dx + dy * dy;
      if (d2 > 225) continue;
      const wgt = 1 / Math.max(1, d2);
      ax += dx * wgt; ay += dy * wgt; n++;
    }
    if (n === 0) { this.safeX = e.x; this.safeY = e.y; return; }
    const d = dhypot(ax, ay) || 1;
    // (owner_rulings 44: a skilled FRAY fighter breaking off runs farther — 12 m, not 8 — and toward a heal on the ground when one
    // lies away from the threat within 30 m: an 8 m step pulled a fifth of the way back to the middle kept it in its chaser's reach)
    const brk = this.k.ffa && this.diff.frayBreak > 0 && this.mode === 'retreat';
    if (brk && this.fleePoint()) return;
    const step = brk ? 12 : 8;
    let tx = e.x + (ax / d) * step, ty = e.y + (ay / d) * step;
    // pull toward the map centre so a bot does not pin itself on the edge
    const pull = brk ? 0.1 : 0.2;
    tx = tx * (1 - pull) + this.k.mapCenterX * pull; ty = ty * (1 - pull) + this.k.mapCenterY * pull;
    this.safeX = tx; this.safeY = ty;
  }

  /**
   * ruling 55 (FRAY self-preservation): where a skilled fighter breaking off runs — the open point 8 or 15 m off (16
   * headings, walkable at its middle and end) that ends farthest from every foe it has seen within 30 m, not past one of them,
   * a thicket to break their sight worth 3 m and a heal on the ground worth 6 m. The old straight step away ran into walls
   * and back past a second foe: 70 % of the breaks still had a foe within 12 m 4 s later. False when nothing is in reach.
   */
  private fleePoint(): boolean {
    const e = this.e, nav = this.w.nav;
    const foes: Entity[] = [];
    for (const f of this.perc.enemyFighters) if (f.alive && this.isNoticed(f) && this.dist2(f, e.x, e.y) <= 30 * 30) foes.push(f);
    if (foes.length === 0) return false;
    const b = this.brain;
    let bx = e.x, by = e.y, bs = -Infinity;
    const score = (x: number, y: number): number => {
      let m = Infinity;
      for (const f of foes) {
        const dd = dhypot(f.x - x, f.y - y);
        // (a foe nearer the line's middle than I am is in the way)
        const mx = (x + e.x) * 0.5, my = (y + e.y) * 0.5;
        if (dhypot(f.x - mx, f.y - my) < 4) return -Infinity;
        if (dd < m) m = dd;
      }
      return m;
    };
    // (the point already chosen is kept unless another is 2 m better: no turning on the spot every tick)
    if (this.now - this.fleeAt < 0.5 && sq(this.fleeX - e.x) + sq(this.fleeY - e.y) > 2 * 2) { const sc = score(this.fleeX, this.fleeY) + 2; if (sc > bs) { bs = sc; bx = this.fleeX; by = this.fleeY; } }
    for (const r of [8, 15]) for (let k = 0; k < 16; k++) {
      const x = e.x + dcos(k * Math.PI / 8) * r, y = e.y + dsin(k * Math.PI / 8) * r;
      if (!nav.walkable(x, y) || !nav.walkable((x + e.x) * 0.5, (y + e.y) * 0.5)) continue;
      const sc = score(x, y);
      if (sc > bs) { bs = sc; bx = x; by = y; }
    }
    if (b) for (let i = 0; i < b.thicketXs.length; i++) {
      const x = b.thicketXs[i], y = b.thicketYs[i];
      if (sq(x - e.x) + sq(y - e.y) > 18 * 18 || !nav.walkable(x, y)) continue;
      const sc = score(x, y) + 3;
      if (sc > bs) { bs = sc; bx = x; by = y; }
    }
    if (this.hpF < 0.5) for (const pk of this.perc.pickups) {
      if (!pk.alive || sq(pk.x - e.x) + sq(pk.y - e.y) > 25 * 25) continue;
      const sc = score(pk.x, pk.y) + 6;
      if (sc > bs) { bs = sc; bx = pk.x; by = pk.y; }
    }
    if (bs === -Infinity) return false;
    this.safeX = bx; this.safeY = by; this.fleeX = bx; this.fleeY = by; this.fleeAt = this.now;
    return true;
  }

  /** the lane stand point behind my wave (last-hit position), tower-safe; `wary`: with no wave of
   *  mine in front, stand out of the enemy Wicks' reach (step in for last hits, not to tank them) */
  private computeHold(wary = false): void {
    const k = this.k, tp = this.perc, e = this.e;
    const lane = this.lane >= 0 ? this.lane : 0;
    const l = k.lanes[lane];
    if (!l) { this.holdX = e.x; this.holdY = e.y; return; }
    const team = this.team;
    const ownF = tp.ownN[lane] > 0 ? tp.ownFront[lane] : -1;
    const enF = tp.enemyN[lane] > 0 ? tp.enemyFront[lane] : Infinity;
    let towerP = 0, enemyTowerP = l.length, enemyTowerR = 0;
    for (const st of tp.allyStructs) {
      const info = this.m.structInfo(st);
      if (info && info.lane === lane && info.attacks) towerP = Math.max(towerP, progress(l, team, info.s));
    }
    for (const st of tp.enemyStructs) {
      const info = this.m.structInfo(st);
      if (info && info.lane === lane && info.attacks) {
        const p = progress(l, team, info.s);
        if (p < enemyTowerP) { enemyTowerP = p; enemyTowerR = info.range + info.radius; }
      }
    }
    let front: number;
    if (ownF >= 0 && enF < Infinity) front = Math.min(ownF, enF);
    else if (ownF >= 0) front = ownF;
    else if (enF < Infinity) front = Math.max(Math.min(enF, towerP + 4), 4);
    else front = Math.max(towerP + 5, Math.min(l.length * 0.45, enemyTowerP - enemyTowerR - 4));
    // just outside my reach of the contact line (an idle fighter in reach swings at the nearest Wick)
    const standoff = e.stats.range + e.radius + (this.k.kind === 'rift' ? 0.8 : 1.2);
    let p = front - standoff - (this.support ? 1.2 : 0);
    if (wary && ownF < 0 && enF < Infinity) p = Math.min(p, enF - WICK_REACH);
    // never park inside the first enemy tower's reach (micro re-checks minions tanking it)
    const cap = enemyTowerP - enemyTowerR - e.radius - 1;
    if (p > cap) p = cap;
    // (lane AI G5: exposed — alone with enemies unaccounted for — no deeper than half the road or my own front tower)
    if (this.exposed) p = Math.min(p, Math.max(l.length * 0.5, towerP));
    if (p < 3) p = 3;
    lanePoint(l, fromProgress(l, team, p));
    const side = (this.player % 2 === 0 ? 1 : -1) * (this.support ? 1.6 : 0.8);
    let x = proj.x - proj.dy * side, y = proj.y + proj.dx * side;
    const nav = this.w.nav;
    if (!nav.walkable(x, y)) { x = proj.x; y = proj.y; }
    this.holdX = x; this.holdY = y;
  }

  /** the lane whose path passes closest to (x, y) */
  private nearestLane(x: number, y: number): number {
    let best = -1, bd = Infinity;
    for (const l of this.k.lanes) { laneProject(l, x, y); if (proj.d2 < bd) { bd = proj.d2; best = l.index; } }
    return best;
  }

  /** squared distance from (x, y) to my lane stand point */
  private laneDist2(x: number, y: number): number {
    this.computeHold();
    return sq(this.holdX - x) + sq(this.holdY - y);
  }

  /** fight back an enemy fighter that is attacking me (any mode that is not running away) */
  private selfDefense(): void {
    if (this.recentDps <= 0 || this.hpF <= 0.4) return;
    const e = this.e, reach = this.prof.attackRange + 3;
    for (const f of this.perc.enemyFighters) {
      if (f.atkTarget !== e.id || !this.isNoticed(f) || this.dist2(f, e.x, e.y) > reach * reach) continue;
      if (!this.towerSafe(f.x, f.y, 0)) continue;
      // hitting back into its covering wave costs more than the trade is worth (unless it is losing)
      if (this.coverWicks(f) >= 3 && f.hp > e.hp * 0.6) continue;
      this.pFight = f; this.pAggro = Math.max(this.pAggro, 0.5);
      return;
    }
  }

  private execLane(): void {
    // a wave crashing into my tower with no enemy fighter around: clear it (when healthy enough to
    // take its hits — else last hits only, the tower does the rest); one-lane modes always shove
    const li = Math.max(0, this.lane);
    // (CW3 CL-1: and with my lane opponent dead or gone home, the road is mine to shove — its Wicks die to me, not to
    // mine, and my own are not ground down by a wave nobody of theirs is there to farm)
    const clear = (this.nearE === 0 && this.hpF > 0.45 && this.perc.enemyN[li] >= 4 && this.perc.ownN[li] <= 1) ||
      (this.nearE === 0 && this.hpF > 0.35 && this.foeAway()) ||
      this.k.kind === 'bridge' || this.k.kind === 'brawl';
    this.computeHold(!clear);
    this.pMove = true; this.pMoveX = this.holdX; this.pMoveY = this.holdY;
    this.pFarm = clear ? 2 : 1;
    this.pAggro = this.hpF > 0.5 ? 0.3 : 0.15;
    // no pokes at a lane opponent its own wave covers: every Wick near it would turn on me
    const le = this.laneEnemy;
    if (le && this.coverWicks(le) >= 2) this.pAggro = 0.15;
    this.selfDefense();
    this.shedWicks();
  }

  /**
   * Wicks are hitting me: a Wick keeps its target while that target stays in reach, so step back
   * along the lane out of it instead of standing there last-hitting — unless I am healthy and the
   * hits are light.
   */
  private shedWicks(): void {
    if (this.unitDps <= 0 || this.lane < 0) return;
    const e = this.e;
    if (this.hpF > 0.5 && (e.hp + e.shield) / this.unitDps > 8) return;
    const l = this.k.lanes[this.lane];
    if (!l) return;
    laneProject(l, e.x, e.y);
    const p = progress(l, this.team, proj.s) - WICK_REACH;
    lanePoint(l, fromProgress(l, this.team, Math.max(0, p)));
    this.pMove = true; this.pMoveX = proj.x; this.pMoveY = proj.y;
    this.pFarm = 0;
    if (this.pFight && this.pFight.kind === 'fighter' && this.pFight.hp > this.pFight.maxHp * 0.25) this.pFight = null;
  }

  /** enemy Wicks that would turn on me if I hit `t` now: beside it (they answer its call for help)
   *  and close enough to reach me */
  private coverWicks(t: Entity): number {
    const e = this.e;
    let n = 0;
    for (const u of this.perc.enemyUnits) {
      if (!u.alive || u.kind !== 'minion' || this.dist2(u, t.x, t.y) > WAVE_AGGRO_R * WAVE_AGGRO_R) continue;
      if (this.dist2(u, e.x, e.y) <= sq(WAVE_AGGRO_R + 0.5)) n++;
    }
    return n;
  }

  private execTrade(): void {
    this.execLane();
    const t = this.laneEnemy;
    if (t && this.isNoticed(t) && attackable(this.w, this.e, t) && !(this.unitDps > 0 && this.pFarm === 0)) { this.pFight = t; this.pAggro = 0.6; }
    this.pLhFight = this.lanePhase();
  }

  private execAllin(): void {
    const t = this.killTarget ?? this.pickFightTarget(12);
    if (!t || (this.k.ffa && !this.chaseOn(t))) { if (this.k.ffa) { this.execHunt(); return; } this.execLaneOrPush(); return; }
    this.pFight = t; this.pAggro = 1;
    this.pLhFight = this.lanePhase();
    this.pDive = t.hp < t.maxHp * 0.25 && this.hpF > 0.5;
    this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
  }

  private execTeamfight(): void {
    const t = this.pickFightTarget(this.nearE > 0 ? 13 : 18);
    if (!t) { this.execLaneOrPush(); return; }
    this.pFight = t; this.pAggro = 0.9;
    this.pFarm = 0;
    const e = this.e;
    // (lane AI G3: a flanker — burst or diver with an escape, tiers with flank — comes from the side, 10 m off the line
    // between the two groups, and goes in 1.5 s after the frontline has started the fight)
    if (this.k.kind === 'rift' && this.diff.flank && (this.prof.style === 'burst' || this.prof.style === 'diver') && this.hasEscape()) {
      const on = this.fightOn();
      if (!on) this.fightSince = -1; else if (this.fightSince < 0) this.fightSince = this.now;
      if (this.fightSince < 0 || this.now - this.fightSince < 1.5) {
        let ax = 0, ay = 0, an = 0, ex = 0, ey = 0, en = 0;
        for (const a of this.perc.allyFighters) if (a !== e && a.alive && this.dist2(a, e.x, e.y) <= 20 * 20) { ax += a.x; ay += a.y; an++; }
        for (const f of this.perc.enemyFighters) if (this.isNoticed(f) && this.dist2(f, e.x, e.y) <= 22 * 22) { ex += f.x; ey += f.y; en++; }
        if (an > 0 && en > 0 && this.recentDps <= 0) {
          ax /= an; ay /= an; ex /= en; ey /= en;
          const ux = ex - ax, uy = ey - ay, ud = dhypot(ux, uy) || 1;
          let fx = 0, fy = 0, fd = Infinity;
          for (const sg of [1, -1]) {
            const px = ex + (-uy / ud) * 10 * sg - (ux / ud) * 2, py = ey + (ux / ud) * 10 * sg - (uy / ud) * 2;
            if (!this.w.nav.walkable(px, py)) continue;
            const d2 = this.dist2(e, px, py);
            if (d2 < fd) { fd = d2; fx = px; fy = py; }
          }
          if (fd < Infinity) { this.pFight = null; this.pAggro = 0.3; this.pMove = true; this.pMoveX = fx; this.pMoveY = fy; return; }
        }
      }
    }
    // ranged styles keep their preferred range; melee walk in
    const want = this.prof.ranged ? Math.max(this.prof.prefRange, this.prof.attackRange) : 0;
    const dx = e.x - t.x, dy = e.y - t.y, d = dhypot(dx, dy) || 1;
    this.pMove = true;
    if (want > 0 && d < want - 1) { this.pMoveX = t.x + (dx / d) * want; this.pMoveY = t.y + (dy / d) * want; }
    else { this.pMoveX = t.x; this.pMoveY = t.y; }
  }

  private execRetreat(): void {
    this.pMove = true; this.pMoveX = this.safeX; this.pMoveY = this.safeY;
    this.pAggro = 0.5;
    // shaking off Wicks or monsters (no enemy fighter near): straight away from what is hitting me,
    // leaning toward safety — the way to my tower can run through the wave
    if (this.nearE === 0 && this.unitDps > 0) {
      const e = this.e;
      let cx = 0, cy = 0, n = 0;
      for (const u of this.perc.enemyUnits) if (u.alive && u.atkTarget === e.id) { cx += u.x; cy += u.y; n++; }
      for (const m of this.perc.monsters) if (m.alive && m.atkTarget === e.id) { cx += m.x; cy += m.y; n++; }
      if (n > 0) {
        cx /= n; cy /= n;
        const ax = e.x - cx, ay = e.y - cy, ad = dhypot(ax, ay) || 1;
        const sx = this.safeX - e.x, sy = this.safeY - e.y, sd = dhypot(sx, sy) || 1;
        const vx = ax / ad + 0.5 * sx / sd, vy = ay / ad + 0.5 * sy / sd, vd = dhypot(vx, vy) || 1;
        let ux = vx / vd, uy = vy / vd;
        // (W4 G1 refix: hemmed in — Wicks pressed against me on several sides body-block the straight way out — take the
        // widest gap that does not lead back into the wave, and let an escape fire whatever my health)
        let pressed = 0;
        for (const u of this.perc.enemyUnits) if (u.alive && u.kind === 'minion' && this.dist2(u, e.x, e.y) <= sq(e.radius + u.radius + 0.7)) pressed++;
        this.caged = pressed >= 3 && this.k.kind === 'rift';
        if (this.caged) {
          let bs = -Infinity;
          for (let k = 0; k < 16; k++) {
            const dx = dcos(k * Math.PI / 8), dy = dsin(k * Math.PI / 8);
            const px = e.x + dx * 1.5, py = e.y + dy * 1.5;
            if (!this.w.nav.walkable(px, py)) continue;
            let clr = 2.5;
            for (const u of this.perc.enemyUnits) {
              if (!u.alive || this.dist2(u, e.x, e.y) > 16) continue;
              const c = Math.sqrt(this.dist2(u, px, py)) - u.radius - e.radius;
              if (c < clr) clr = c;
            }
            const sc = clr * 2 + (dx * ux + dy * uy);
            if (sc > bs) { bs = sc; ux = dx; uy = dy; }
          }
        }
        for (const step of this.caged ? [4, 2] : this.k.kind === 'rift' ? [8, 4] : [8]) {
          const tx = e.x + ux * step, ty = e.y + uy * step;
          if (this.w.nav.walkable(tx, ty)) { this.pMoveX = tx; this.pMoveY = ty; break; }
        }
      }
    }
    // cornered (faster chaser right on me): hit back
    const f = this.nearestEnemyFighter(this.prof.attackRange + 0.5);
    if (f && f.stats.moveSpeed > this.e.stats.moveSpeed + 0.2 && inAttackRange(this.e, f) && f.hp < this.e.hp) this.pFight = f;
  }

  private execRecall(base: { fx: number; fy: number; fr: number; sx: number; sy: number; sr: number } | undefined): void {
    const e = this.e, w = this.w, k = this.k;
    if (k.kind === 'fray' || !base) {
      // walk to the nearest shop
      let bx = e.x, by = e.y, bd = Infinity;
      for (const s of k.shops) { const d2 = this.dist2(e, s.x, s.y); if (d2 < bd) { bd = d2; bx = s.x; by = s.y; } }
      if (base) { const d2 = this.dist2(e, base.sx, base.sy); if (d2 < bd) { bd = d2; bx = base.sx; by = base.sy; } }
      this.pMove = true; this.pMoveX = bx; this.pMoveY = by;
      this.selfDefense();
      return;
    }
    const atBase = this.dist2(e, base.fx, base.fy) <= sq(base.fr - 0.5);
    // (lane AI G12: inside the fountain is home — the bot stops there instead of pressing on to its centre, where other
    // bodies stand and a move order never finishes)
    if (atBase) {
      if (this.dist2(e, base.fx, base.fy) <= sq(base.fr - 1.5)) { if (e.order === ORDER_MOVE && !e.cast) this.out.push({ type: 'stop' }); return; }
      this.pMove = true; this.pMoveX = base.fx; this.pMoveY = base.fy; return;
    }
    const threat = this.nearestEnemyFighter(10) !== null || this.recentDps > 0;
    if (k.rules.recall && !threat) {
      if (e.stateOverride === 'recall') return;
      if (this.now - this.recallTriedAt > 1 && !e.cast && !e.dash) {
        this.recallTriedAt = this.now;
        this.out.push({ type: 'recall' });
      }
      return;
    }
    this.pMove = true; this.pMoveX = k.rules.recall ? this.safeX : base.fx; this.pMoveY = k.rules.recall ? this.safeY : base.fy;
  }

  // ── lane AI G2: protect a partner ─────────────────────────────────────────────────────────────
  /**
   * A partner within peelR (12 m, 15 m for a ranged fighter or a support) that enemy fighters took 15 % of its health
   * from in the last 2 s (22 % in a road's laning phase, where a duo's trades are laning), or that is held by hard CC
   * with an enemy fighter within 6 m, is being dived. Whether I answer is rolled once per episode (peelChance), and
   * the diver must be noticed (reaction delay). Utility 0.66 + 0.2 × its value (a carry, or under 40 %: 1, else 0.5)
   * + 0.1 for a tank or support − 0.3 when I am under 35 % − 0.2 when the diver stands under an enemy tower.
   */
  /** owner_rulings 44: the teammate whose peel a dive on `a` is — the support within 8 m of it, else the nearest teammate within
   *  12 m; above half health and not recalling (fixed scan order: every bot of the team reads the same one) */
  private designatedPeeler(a: Entity): Entity | null {
    let best: Entity | null = null, bd = Infinity, sup: Entity | null = null;
    const b = this.brain;
    for (const f of this.perc.allyFighters) {
      if (f === a || !f.alive || f.hp < f.maxHp * 0.5 || f.stateOverride === 'recall') continue;
      const d2 = this.dist2(f, a.x, a.y);
      if (d2 > 12 * 12) continue;
      if (!sup && d2 <= 8 * 8 && b && f.player && b.laneOf(f.player.player).support) sup = f;
      if (d2 < bd) { bd = d2; best = f; }
    }
    return sup ?? best;
  }

  private protectUtility(): number {
    this.protectAlly = null; this.protectDiver = null; this.protectDes = false;
    const k = this.k;
    // (RIFT: BRIDGE keeps the fights its G5 pace was measured with — one road, the whole team always on it)
    if (k.kind !== 'rift') return 0;
    const e = this.e, now = this.now, m = this.m;
    const prevU = this.protectU;
    this.protectU = 0;
    const peelR = this.prof.ranged || this.support ? 15 : 12;
    const lp = this.lanePhase();
    let best = 0;
    for (const a of this.perc.allyFighters) {
      if (a === e || !a.alive || this.dist2(a, e.x, e.y) > peelR * peelR) continue;
      const burst = m.hurtBy(a.id, now, 2);
      const held = (a.ccMask & CC_HARD) !== 0 || holdLeft(a) > 0;
      const dived = burst >= (lp ? 0.22 : 0.15) * a.maxHp;
      if (!dived && !held) continue;
      // (owner_rulings 44: the designated peeler — the support within 8 m of the partner, else the nearest fit teammate within
      // 12 m — always answers at a tier with peelFirst: no roll, and in the laning phase too; the others as before)
      const des = this.diff.peelFirst && this.designatedPeeler(a) === e;
      // (a road's laning phase: a duo's trades are laning — only a partner held, or one taken under half, is a dive)
      // (ruling 55: the designated peeler too — in the laning phase a burst on a fit road partner is the duo's trade, played
      // from the lane: the round-2 support answered every such trade in protect mode, 5.5 % of its laning time, the whole drop of
      // the laners' in-lane share against the pre-lane bots, 67.4 / 66.4 → 66.0 / 64.7 %)
      // (ruling 55: in the laning phase a partner is dived only under a quarter of its health, or held under half — the peel at
      // 40 % and on every hold kept the duo in protect mode 1.6 % of the laning phase, the laners' in-lane share 66.4 / 65.1 %
      // against the pre-lane bots' 68.3 / 67.3 %; and the laning-phase peel stands 1 s past the burst, not 3)
      if (lp && a.hp > a.maxHp * (held ? LANE_PEEL_HELD_HP : LANE_PEEL_HP)) continue;
      // (and the laning phase's peel is for the partner on my own road: the other roads are their laners' and the grovehunter's —
      // the grovehunter answers a dive on any road it stands beside, the genre's counter-gank)
      if (!des && lp && !this.jungle && (!this.brain || !a.player || this.brain.laneOf(a.player.player).lane !== this.lane)) continue;
      let diver: Entity | null = null;
      if (burst > 0) { const id = m.topHurter(a.id, now, 2); const f = id >= 0 ? this.w.entity(id) : null; if (f && f.alive && f.kind === 'fighter' && this.isNoticed(f)) diver = f; }
      if (!diver) {
        let bd = 6 * 6;
        for (const f of this.perc.enemyFighters) { if (!this.isNoticed(f)) continue; const d2 = this.dist2(f, a.x, a.y); if (d2 < bd) { bd = d2; diver = f; } }
      }
      if (!diver || (lp && !this.towerSafe(diver.x, diver.y, 0))) continue;
      let r = this.peelRolls.get(a.id);
      if (!r || now - r.last > 3) { r = { at: now, last: now, ok: this.rng.chance(this.diff.peelChance) }; this.peelRolls.set(a.id, r); }
      r.last = now;
      if (!r.ok && !des) continue;
      const st = k.profiles.get(a.def)?.style;
      const carry = st === 'marksman' || st === 'artillery' || st === 'burst';
      const value = carry || a.hp < a.maxHp * 0.4 ? 1 : 0.5;
      const tank = this.support || this.prof.style === 'frontline' || this.prof.style === 'warden';
      // (from 0.72: a dive is urgent — it overrides a mode younger than its minimum time; a kill of mine that is on comes first)
      const u = 0.72 + 0.2 * value + (tank ? 0.1 : 0) - (this.hpF < 0.35 ? 0.3 : 0) - (this.towerSafe(diver.x, diver.y, 0) ? 0 : 0.2) -
        (this.mode === 'allin' && this.killTarget && this.killTarget !== diver && this.killMargin >= 1.2 ? 0.25 : 0);
      const ud = des ? Math.max(u, 0.97) : u;
      if (ud > best) { best = ud; this.protectAlly = a; this.protectDiver = diver; this.protectDes = des; }
    }
    if (this.peelRolls.size > 12) for (const [id, r] of [...this.peelRolls]) if (now - r.last > 6) this.peelRolls.delete(id);
    if (best > 0 && this.protectAlly && this.protectDiver) {
      this.protectUntil = now + (lp ? 1 : 3); this.protectAllyId = this.protectAlly.id; this.protectDiverId = this.protectDiver.id;
    } else if (now < this.protectUntil && this.mode === 'protect') {
      // (the burst paused: keep on the same diver while it is still in sight near my partner)
      const a = this.w.entity(this.protectAllyId), d = this.w.entity(this.protectDiverId);
      if (a && d && a.alive && d.alive && this.isNoticed(d) && this.dist2(d, a.x, a.y) <= 14 * 14 && this.hpF >= 0.3) {
        this.protectAlly = a; this.protectDiver = d; best = prevU * 0.97;
      }
    }
    this.protectU = best;
    return best;
  }

  /** turn on the diver: its damage on my partner first, CC on it whatever the ability's target count, heals and
   *  shields on the partner (walking into range first, up to 4 m), and a frontline or warden steps between them */
  private execProtect(): void {
    const a = this.protectAlly, d = this.protectDiver, e = this.e;
    if (!a || !d || !a.alive || !d.alive || !this.isNoticed(d)) { this.execLaneOrPush(); return; }
    this.peelVictim = a; this.peelDiver = d;
    const tank = this.prof.style === 'frontline' || this.prof.style === 'warden' || this.support;
    // (owner_rulings 42: a healthy frontline, or anyone fit beside a partner about to fall, follows the diver under its tower —
    // standing off at the tower's edge while the partner died there was no peel at all)
    // (owner_rulings 44: by tier — veteran as ruling 42, adept only for a partner about to fall, a beginner never)
    const pdv = this.diff.peelDive;
    const dive = (pdv !== 'none' && !this.lanePhase() && this.hpF > 0.6 && ((pdv === 'all' && tank) || a.hp < a.maxHp * 0.4) && !this.towerAggro) ||
      // (owner_rulings 44: the designated peeler follows the diver a step under its tower when fit, outside the laning phase)
      (this.protectDes && pdv !== 'none' && !this.lanePhase() && this.hpF > 0.5 && !this.towerAggro);
    this.pFight = d; this.pAggro = 0.9; this.pFarm = 0; this.pDive = dive;
    this.pMove = true; this.pMoveX = d.x; this.pMoveY = d.y;
    const contact = dhypot(d.x - a.x, d.y - a.y) <= d.stats.range + d.radius + a.radius + 1.5;
    // (a body-block is for a partner I stand beside; from farther off the diver is reached faster than the gap between them)
    // (only a melee diver can be blocked: a ranged one shoots past the body, so the tank goes at it instead)
    // (owner_rulings 44: the designated peeler goes at the diver itself — a block lands nothing on it)
    if (this.diff.peelBodyBlock && tank && !this.protectDes && !contact && d.stats.range <= 3 && !inAttackRange(e, d) && this.dist2(a, e.x, e.y) <= 4 * 4) {
      const dx = d.x - a.x, dy = d.y - a.y, dd = dhypot(dx, dy) || 1;
      const bx = a.x + (dx / dd) * 1.6, by = a.y + (dy / dd) * 1.6;
      if (this.w.nav.walkable(bx, by) && sq(bx - e.x) + sq(by - e.y) > 1.2 * 1.2) { this.pMoveX = bx; this.pMoveY = by; this.pFight = null; }
    }
    // a heal or shield for the partner, ready, and the partner just out of its range: close in first
    if (a.hp <= a.maxHp * 0.85) {
      for (let i = 0; i < 4; i++) {
        const sl = e.slots[i];
        if (!sl || !sl.ready) continue;
        const info = abilityInfo(sl.def);
        if (!info.allyUnit || !(info.use & (U_HEAL | U_SHIELD))) continue;
        const dd = Math.sqrt(this.dist2(a, e.x, e.y)), r = info.range + a.radius + 0.5;
        if (dd > r && dd <= r + 4) { this.pFight = null; this.pMoveX = a.x; this.pMoveY = a.y; break; }
      }
    }
  }

  // ── lane AI G1: hold a post at a threatened structure ─────────────────────────────────────────
  private execGuard(g: Guard): void {
    const e = this.e, now = this.now;
    // recall to the post when that is the faster way there and nothing is on me
    if (g.recall && this.k.rules.recall && this.dist2(e, g.x, g.y) > 45 * 45 && this.nearestEnemyFighter(12) === null && this.recentDps <= 0) {
      if (e.stateOverride !== 'recall' && now - this.recallTriedAt > 1 && !e.cast && !e.dash) { this.recallTriedAt = now; this.out.push({ type: 'recall' }); }
      return;
    }
    this.pFarm = 2; this.pAggro = 0.75;
    let t: Entity | null = null, bs = Infinity, nE = 0, inside = false;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, g.x, g.y) > 15 * 15) continue;
      nE++;
      const inR = g.reach > 0 && this.dist2(f, g.x, g.y) <= sq(g.reach + f.radius);
      const sc = f.hp + Math.sqrt(this.dist2(f, e.x, e.y)) * 40 - (inR ? 5000 : 0);
      if (sc < bs) { bs = sc; t = f; inside = inR; }
    }
    // (owner_rulings 42: a partner dived at the post is the post's fight — its diver first)
    const pd = this.protectDiver;
    if (pd && pd.alive && this.isNoticed(pd) && this.dist2(pd, g.x, g.y) <= 15 * 15) { t = pd; inside = true; }
    // (owner_rulings 44: a quiet post beside a structure of ours that enemy fighters are hitting is that structure's defence —
    // the post is the base, not one stone of it; the team brain hands the post on within its next think, this is the moment
    // between)
    if (!t) {
      let hs: Entity | null = null, hd = 26 * 26;
      for (const f of this.perc.enemyFighters) {
        if (!this.isNoticed(f) || f.atkTarget < 0) continue;
        const s = this.w.entity(f.atkTarget);
        if (!s || s.kind !== 'structure' || s.team !== this.team || !s.alive) continue;
        const d2 = this.dist2(s, e.x, e.y);
        if (d2 < hd) { hd = d2; hs = s; }
      }
      if (hs) {
        const info = this.m.structInfo(hs);
        const reach = info && info.attacks ? Math.max(0, info.range + info.radius - 1) : 0;
        g = { ...g, x: hs.x, y: hs.y, standX: hs.x, standY: hs.y, reach };
        for (const f of this.perc.enemyFighters) {
          if (!this.isNoticed(f) || this.dist2(f, g.x, g.y) > 15 * 15) continue;
          nE++;
          const inR = reach > 0 && this.dist2(f, g.x, g.y) <= sq(reach + f.radius);
          const sc = f.hp + Math.sqrt(this.dist2(f, e.x, e.y)) * 40 - (inR ? 5000 : 0);
          if (sc < bs) { bs = sc; t = f; inside = inR; }
        }
        // (the structure's own side, inside its reach, until the attacker is under it)
        if (this.brain) {
          const base = this.k.bases.find((x) => x.team === this.team);
          if (base) { const dx = base.fx - hs.x, dy = base.fy - hs.y, dd = dhypot(dx, dy) || 1, off = reach > 0 ? Math.min(reach * 0.5, 3.5) : hs.radius + 1.5; g.standX = hs.x + (dx / dd) * off; g.standY = hs.y + (dy / dd) * off; }
        }
      }
    }
    const nA = this.alliesNear(g.x, g.y, 15);
    // (ruling 55: Wicks hitting the structure while the enemy fighter waits off it, out of my reach, are the post's fight — the
    // defender that walked at a fighter standing off the post let the wave take the structure behind it)
    let waveOn = false;
    if (t && !inside) for (const u of this.perc.enemyUnits) {
      if (!u.alive || u.kind !== 'minion' || u.atkTarget < 0) continue;
      const a = this.w.entity(u.atkTarget);
      if (a && a.kind === 'structure' && a.team === this.team && this.dist2(a, g.x, g.y) <= 4) { waveOn = true; break; }
    }
    // (fight the diver under the tower, never in front of it — unless we have the bodies there, or the post does not shoot)
    if (t && (g.reach === 0 || inside || ((nA > nE || this.adv >= 0.58) && (!waveOn || inAttackRange(e, t))))) {
      this.pFight = t; this.pDive = false;
      this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
      this.waveGuard(this.holdsWave(g.cls));
      return;
    }
    let sx = g.standX, sy = g.standY;
    // (defensive ambush, tiers that lurk: an enemy at the post that has not committed under it — wait in a thicket
    // beside the tower and come out when it does)
    // (not at the base, and not once the diver is on the structure: then the post is under it)
    const onPost = !!t && t.atkTarget >= 0 && (() => { const a = this.w.entity(t.atkTarget); return !!a && a.kind === 'structure' && this.dist2(a, g.x, g.y) <= 4; })();
    if (t && this.diff.lurkMax > 0 && this.brain && g.cls < 2 && !onPost) {
      const b = this.brain;
      let bd = 10 * 10;
      for (let i = 0; i < b.thicketXs.length; i++) {
        const d2 = sq(b.thicketXs[i] - g.x) + sq(b.thicketYs[i] - g.y);
        if (d2 < bd && this.w.nav.walkable(b.thicketXs[i], b.thicketYs[i])) { bd = d2; sx = b.thicketXs[i]; sy = b.thicketYs[i]; }
      }
    }
    this.pMove = true; this.pMoveX = sx; this.pMoveY = sy;
    // (owner_rulings 44: no fighter to fight — the Wicks at the structure are the post's work: walk into reach of the one
    // nearest the structure, inside its cover; standing at the post while the wave took the structure was the commonest
    // "fell to Wicks beside two fit defenders")
    // (ruling 55: and with an enemy fighter waiting off the post, not under it, the Wicks already hitting the structure are
    // still the post's work — two fit defenders stood at the stand point, held by a fighter 13 m off, while the wave took the
    // Needle: 167 of the veteran falls to Wicks beside fit defenders had them in defend mode)
    let wave = !t;
    if (t) for (const u of this.perc.enemyUnits) {
      if (!u.alive || u.kind !== 'minion' || u.atkTarget < 0) continue;
      const a = this.w.entity(u.atkTarget);
      if (a && a.kind === 'structure' && a.team === this.team && this.dist2(a, g.x, g.y) <= 4) { wave = true; break; }
    }
    if (wave) {
      const sr = Math.max(9, g.reach + 3);
      let wk: Entity | null = null, wd = sr * sr;
      for (const u of this.perc.enemyUnits) {
        if (!u.alive || u.kind !== 'minion' || !u.targetable) continue;
        const d2 = this.dist2(u, g.x, g.y);
        if (d2 < wd) { wd = d2; wk = u; }
      }
      if (wk) {
        this.pClear = true;
        const r = this.e.stats.range + this.e.radius + wk.radius;
        const dx = sx - wk.x, dy = sy - wk.y, dd = dhypot(dx, dy) || 1;
        if (this.dist2(wk, e.x, e.y) > sq(r + 0.5)) { this.pMoveX = wk.x + (dx / dd) * Math.max(0.5, r - 0.6); this.pMoveY = wk.y + (dy / dd) * Math.max(0.5, r - 0.6); }
      }
    }
    this.selfDefense();
    this.waveGuard(this.holdsWave(g.cls));
  }

  // ── lane AI G3: the gank approach ─────────────────────────────────────────────────────────────
  /** how far I can reach a fighter from where I stand: my longest ready gap-closer or engage, else my attack */
  private strikeReach(): number {
    let r = this.prof.attackRange + this.e.radius;
    for (let i = 0; i < 4; i++) {
      const sl = this.e.slots[i];
      if (!sl || !sl.ready) continue;
      const info = abilityInfo(sl.def);
      if (info.use & (U_GAPCLOSE | U_ENGAGE)) r = Math.max(r, info.reach);
    }
    return r;
  }
  /** seconds of exposure a straight walk from (ax, ay) to (bx, by) costs: 6 s per 4 m sample inside a known enemy lamp's sight */
  private visPenalty(ax: number, ay: number, bx: number, by: number): number {
    const wards = this.perc.enemyWards;
    if (wards.length === 0) return 0;
    const d = dhypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 4));
    let pen = 0;
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * (i / n), y = ay + (by - ay) * (i / n);
      for (const wd of wards) { const r = Math.max(6, wd.sight); if (wd.alive && sq(wd.x - x) + sq(wd.y - y) <= r * r) { pen += 6; break; } }
    }
    return pen;
  }
  /** plan a gank on `t`: the thicket beside its road that is quickest to reach unseen (and behind it, toward its base,
   *  is worth 4 s), or straight in when no thicket is worth the detour (or the tier does not lurk) */
  private planRoam(t: Entity): void {
    const b = this.brain, e = this.e;
    this.roamTarget = t.id; this.roamLostAt = -1; this.roamPhase = 'strike';
    // (owner_rulings 44: an invader in our own Dialwood is run down at once — it is in our ground, out of its towers' cover)
    if (b && b.invader === t) return;
    // (the laning phase's ganks are on a clock — the road's fight is on now: they walk straight in, as CW3 CL-1 tuned them; a
    // planned approach through a thicket cost a quarter of the laning takedowns and half the grovehunter's)
    if (this.diff.lurkMax <= 0 || !b || this.k.kind !== 'rift' || b.gankLane < 0 || this.now < LANE_PHASE_END) return;
    const ms = Math.max(1, e.stats.moveSpeed);
    const eb = this.k.bases.find((x) => x.team !== this.team);
    let best: { x: number; y: number } | null = null, bc = Infinity;
    for (const en of b.entries) {
      if (en.lane !== b.gankLane) continue;
      const dT = dhypot(en.x - t.x, en.y - t.y);
      // (a thicket the target is near — a wait farther off is a gank that never lands — and nearer it than I am)
      if (dT > 20 || dT < 3 || dT >= dhypot(t.x - e.x, t.y - e.y) || !this.w.nav.walkable(en.x, en.y)) continue;
      let lamp = false;
      for (const wd of this.perc.enemyWards) if (wd.alive && sq(wd.x - en.x) + sq(wd.y - en.y) <= sq(Math.max(6, wd.sight))) { lamp = true; break; }
      if (lamp) continue;
      let cost = dhypot(en.x - e.x, en.y - e.y) / ms + (dT / ms) * 0.5;
      if (this.diff.avoidVision) cost += this.visPenalty(e.x, e.y, en.x, en.y);
      if (eb && (en.x - t.x) * (eb.fx - t.x) + (en.y - t.y) * (eb.fy - t.y) > 0) cost -= 4;
      if (cost < bc) { bc = cost; best = en; }
    }
    const direct = dhypot(t.x - e.x, t.y - e.y) / ms + (this.diff.avoidVision ? this.visPenalty(e.x, e.y, t.x, t.y) : 0);
    if (!best || bc > direct + 8) return;
    this.roamX = best.x; this.roamY = best.y; this.roamPhase = 'approach';
    this.lurkFor = this.diff.lurkMax;
  }

  private execLaneOrPush(): void {
    if (this.k.kind === 'fray') { this.execHunt(); return; }
    if (this.jungle && this.k.kind === 'rift') { this.execFarm(); return; }
    this.execPush();
  }

  private execPush(): void {
    const b = this.brain, k = this.k, e = this.e;
    // a laner in the laning phase pushes its own lane (a won fight is a free wave, not a cross-map siege)
    // (lane AI G6: the split-pusher works its own road, away from the group)
    const split = !!b && k.kind === 'rift' && b.splitSeat === this.player && b.splitLane >= 0 && b.group;
    const grouped = !!b && (b.group || k.kind === 'bridge' || k.kind === 'brawl') && !this.lanePhase() && !split;
    let lane = this.lane >= 0 ? this.lane : 0;
    if (split && b) lane = b.splitLane;
    else if (grouped && b && b.siegeLane >= 0) lane = b.siegeLane;
    const saveLane = this.lane;
    this.lane = lane;
    this.computeHold();
    this.lane = saveLane;
    this.pFarm = 2;
    this.pAggro = 0.5;
    this.pMove = true;
    let siege = grouped && b && b.siege && b.siege.alive ? b.siege : this.nextEnemyStructure(lane);
    let mx = this.holdX, my = this.holdY;
    // (lane AI G6: the split road turns unsafe — enemies seen on it, or two missing — back to my nearest own tower there)
    if (split && b && !b.splitSafe) { siege = null; this.pFarm = 1; }
    // (lane AI G5: exposed, no structure past where I hold; a pressed siege waits at the group point until the team is there)
    if (siege && this.exposed && !(b && (b.rush || b.stage)) && this.dist2(siege, this.holdX, this.holdY) > 14 * 14) siege = null;
    if (siege && grouped && b && !b.gathered && !b.rush && !b.stage && this.minionsTanking(siege) < 2) siege = null;
    if (b && b.stage) {
      // gathering for the final push: wait at the staging point, fight what comes
      this.pMoveX = b.groupX; this.pMoveY = b.groupY;
      this.pFarm = 2;
      const f = this.pickFightTarget(9);
      if (f && this.adv >= 0.45 && this.towerSafe(f.x, f.y, 0)) { this.pFight = f; this.pAggro = 0.7; }
      return;
    }
    const rushR = siege && this.m.structInfo(siege)?.isCore ? 32 : 16;
    if (b && b.rush && siege && siege.alive && siege.targetable && this.dist2(e, siege.x, siege.y) < rushR * rushR) {
      // endgame: the structure first; only peel an enemy that is hitting me
      this.pSiege = siege; this.pSiegeFirst = true;
      this.pMoveX = siege.x; this.pMoveY = siege.y;
      for (const f of this.perc.enemyFighters) {
        if (f.atkTarget === e.id && this.isNoticed(f) && inAttackRange(e, f) && f.hp < f.maxHp * 0.3) { this.pFight = f; this.pAggro = 0.8; break; }
      }
      return;
    }
    if (siege && siege.alive && siege.targetable) {
      const info = this.m.structInfo(siege);
      const attacks = !!info?.attacks;
      const alliesNear = this.alliesNear(siege.x, siege.y, 12);
      const enemiesNear = this.enemiesNear(siege.x, siege.y, 12);
      const window = !!b && b.window;
      // (ruling 56: a grouped siege that outnumbers the structure's defenders by two goes in without waiting for a wave — the
      // defenders now clear every wave off their structure, and a group waiting at the door for Wicks stood there for minutes,
      // ahead in numbers and Gleam; a beginner's team takes the dive too, as beginners do)
      const outnum = grouped && this.hpF > 0.5 && this.alliesNear(siege.x, siege.y, 20) >= Math.max(3, this.enemiesNear(siege.x, siege.y, 20) + 2);
      this.siegeDive = outnum;
      const canHit = !attacks || this.minionsTanking(siege) >= 2 || outnum || (enemiesNear === 0 && (alliesNear >= 3 || (window && alliesNear >= 2)) && this.hpF > 0.45);
      if (canHit) { this.pSiege = siege; mx = siege.x; my = siege.y; }
      else if (grouped && b) {
        // wait for the wave on our side of it
        mx = b.groupX; my = b.groupY;
        if (this.dist2(e, mx, my) > 30 * 30) { mx = this.holdX; my = this.holdY; }
      }
    } else if (grouped && b) { mx = b.groupX; my = b.groupY; }
    // group with the team: do not run ahead alone
    // (owner_rulings 44: judged at the destination, not where I stand — "allies beside me" sent a fighter that reached the group
    // back to its wave point, and alone there back to the group: a full-health veteran paced 10 m back and forth for 12 s)
    if (grouped && b && !this.pSiege && this.dist2(e, b.groupX, b.groupY) < 20 * 20) {
      const meThere = this.dist2(e, mx, my) <= 10 * 10 ? 1 : 0;
      if (this.alliesNear(mx, my, 10) - meThere < 1) { mx = b.groupX; my = b.groupY; }
    }
    this.pMoveX = mx; this.pMoveY = my;
    const f = this.pickFightTarget(9);
    // (ruling 56: and the outnumbered defenders under it are the fight — the tower takes one of us, not all)
    if (f && this.adv >= 0.45 && this.hpF > 0.4 && (this.towerSafe(f.x, f.y, 0) || this.siegeDive)) { this.pFight = f; this.pAggro = 0.7; }
    this.siegeDive = false;
    // laning: shoving my own lane is not worth tanking its Wicks
    if (!grouped && this.lanePhase() && !this.pSiege) this.shedWicks();
    else if (!(b && b.rush)) this.waveGuard();
  }

  private execDefend(): void {
    const b = this.brain;
    if (!b) { this.execLane(); return; }
    const post = b.guard.get(this.player);
    if (post) { this.execGuard(post); return; }
    let x = b.baseX, y = b.baseY, best = b.baseThreat;
    const ans = b.answer.get(this.player);
    if (ans !== undefined) { x = b.answerX[ans]; y = b.answerY[ans]; best = 3; }
    else if (this.lane >= 0 && b.defend[this.lane] > 0.05) { x = b.defendX[this.lane]; y = b.defendY[this.lane]; best = 2; }
    for (let i = 0; i < b.defend.length; i++) if (b.defend[i] > best) { best = b.defend[i]; x = b.defendX[i]; y = b.defendY[i]; }
    // (round 2: no call left to answer — the mode is a moment stale: carry on with the plan, never toward the map's corner)
    if (best <= 0.05) { this.execLaneOrPush(); return; }
    this.pMove = true; this.pMoveX = x; this.pMoveY = y;
    this.pFarm = 2; this.pAggro = 0.75;
    const e = this.e;
    let t: Entity | null = null, bs = Infinity;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, x, y) > 12 * 12) continue;
      const s = f.hp + Math.sqrt(this.dist2(f, e.x, e.y)) * 40;
      if (s < bs) { bs = s; t = f; }
    }
    if (t && this.adv >= 0.38) { this.pFight = t; this.pDive = false; }
    // (owner_rulings 42: at a structure of ours the defender holds it against the wave, as at a post)
    let atStruct = false;
    // (an outer Needle in the laning phase is the road's to hold: the wave stacked there is laning — standing in it there kept
    // the first structure up past 12:00)
    if (this.k.kind === 'rift') for (const st of this.perc.allyStructs) {
      if (!st.alive || this.dist2(st, e.x, e.y) > sq(st.stats.range + st.radius + 3)) continue;
      const info = this.m.structInfo(st);
      if (info && this.holdsWave(b.classOf(info))) { atStruct = true; break; }
    }
    // (owner_rulings 44: and clears it — every swing on the wave)
    if (atStruct && !(t && this.adv >= 0.38)) this.pClear = true;
    this.waveGuard(atStruct);
  }

  /**
   * Away from Wick lines: a fighter with no Wick or tower of its own nearby to take their attention
   * is the target of every enemy Wick in reach, and they keep it while it stays in reach (a stacked
   * wave kills a full-health fighter in seconds and body-blocks its way out). So stay out of the
   * reach of an enemy wave that could kill me within 6 s unless something of mine covers me, and
   * walk away once Wicks that would finish me within 8 s have turned on me.
   */
  /** owner_rulings 42: does a defender at a structure of this class hold it against the wave — an inner or base structure, an
   *  outer one after the laning phase (in it the stacked wave at an outer Needle is the road's laning), and from 25:00 only the
   *  base (a late game's inner Needles fall to waves as death timers decide it; holding them too drew it out past the pace bar) */
  private holdsWave(cls: number): boolean {
    // (owner_rulings 44: a beginner backs off a stacked wave — the hold is a skilled tier's)
    if (!this.diff.holdWave) return false;
    if (this.now >= 1500) return cls >= 2;
    return cls >= 1 || this.now >= LANE_PHASE_END;
  }

  private waveGuard(hold = false): void {
    const e = this.e;
    const ehp = e.hp + e.shield;
    // (owner_rulings 42: a defender posted to a structure holds it against the wave — the wave's blows are shared with the
    // partners beside me and the structure covers me whatever the wave's size; it backs off only once the Wicks on me would
    // finish me within 4 s. Two full-health defenders used to stand 8 m off a Lantern while a stacked wave took it)
    if (hold && this.k.kind === 'rift') {
      if (this.unitDps > 0) { if (ehp / this.unitDps >= 4) return; }
      else {
        let pot = 0, mates = 1;
        for (const u of this.perc.enemyUnits) if (u.alive && u.kind === 'minion' && u.attackDef && this.dist2(u, e.x, e.y) <= sq(WICK_REACH + 1.5)) pot += mitigated(u, e, u.stats.ad, u.attackDef.damageType) * u.stats.attackSpeed;
        for (const a of this.perc.allyFighters) if (a !== e && a.alive && this.dist2(a, e.x, e.y) <= 8 * 8) mates++;
        if (pot / mates * 5 <= ehp || this.hpF > 0.6) return;
      }
    }
    // (W4 G1 refix, RIFT: three roads stack waves while the team is elsewhere; BRIDGE's one road always has the
    // team on it, so its guard stays the front-of-the-wave one its G5 pacing was measured with)
    const rift = this.k.kind === 'rift';
    const R = WICK_REACH + 1.5, RW = rift ? 16 : R;
    let pot = 0, potW = 0, cx = 0, cy = 0, n = 0, wide = 0, near2 = Infinity;
    for (const u of this.perc.enemyUnits) {
      if (!u.alive || u.kind !== 'minion' || !u.attackDef) continue;
      const d2 = this.dist2(u, e.x, e.y);
      if (d2 > RW * RW) continue;
      // (the rest of a stacked wave, still a few steps behind its front, counts too — it arrives while I stand
      // there, and twenty Wicks around a fighter body-block every way out)
      const dps = mitigated(u, e, u.stats.ad, u.attackDef.damageType) * u.stats.attackSpeed;
      potW += dps; wide++;
      if (d2 > R * R) continue;
      pot += dps;
      cx += u.x; cy += u.y; n++;
      if (d2 < near2) near2 = d2;
    }
    if (n === 0) return;
    const targeted = this.unitDps > 0;
    let mine = 0;
    for (const u of this.perc.allyUnits) if (u.alive && u.kind === 'minion' && this.dist2(u, e.x, e.y) <= 9 * 9) mine++;
    // (a cover that the wave outnumbers dies under it, and then the whole wave turns on me; on RIFT a Needle holds a
    // wave of up to seven Wicks, not a stacked one)
    let covered = mine >= Math.max(2, Math.ceil(wide * 0.6));
    if (!covered && (!rift || wide <= 7)) {
      for (const st of this.perc.allyStructs) if (st.alive && st.attackDef && st.stats.ad > 0 && this.dist2(st, e.x, e.y) <= sq(st.stats.range + st.radius + 2)) { covered = true; break; }
    }
    if (rift) {
      // uncovered, the whole wave turns on me: judge it on what it could deal, not only on the Wicks already on me
      const inc = covered ? this.unitDps : Math.max(this.unitDps, Math.max(pot, potW * 0.75) * 0.75);
      if (targeted ? ehp / inc >= 8 : covered || Math.max(pot, potW * 0.75) * 8 <= ehp) return;
    } else if (targeted ? ehp / this.unitDps >= 8 : covered || pot * 6 <= ehp) return;
    cx /= n; cy /= n;
    const ax = e.x - cx, ay = e.y - cy, ad = dhypot(ax, ay) || 1;
    const sx = this.safeX - e.x, sy = this.safeY - e.y, sd = dhypot(sx, sy) || 1;
    const vx = ax / ad + 0.5 * sx / sd, vy = ay / ad + 0.5 * sy / sd, vd = dhypot(vx, vy) || 1;
    // (RIFT, not on me yet: back off decisively, well outside its reach — a sidestep to its edge is overrun by a wave
    // that marches)
    const step = targeted ? 8 : rift ? Math.max(2.5, WICK_REACH + 3 - Math.sqrt(near2)) : Math.max(0, WICK_REACH + 1 - Math.sqrt(near2));
    if (step <= 0.3) { if (this.pFarm === 2) this.pFarm = 1; return; }
    let tx = e.x + (vx / vd) * step, ty = e.y + (vy / vd) * step;
    if (!this.w.nav.walkable(tx, ty)) {
      if (!rift) return;
      tx = e.x + (vx / vd) * 2.5; ty = e.y + (vy / vd) * 2.5;
      if (!this.w.nav.walkable(tx, ty)) { tx = this.safeX; ty = this.safeY; }
    }
    this.pMove = true; this.pMoveX = tx; this.pMoveY = ty;
    this.pFarm = targeted ? 0 : 1;
    this.pSiege = null; this.pMonsters = false;
    if (this.pFight && this.pFight.kind === 'fighter' && this.pFight.hp > this.pFight.maxHp * 0.25) this.pFight = null;
  }

  private execObjective(): void {
    const b = this.brain, e = this.e;
    const o = b?.objective;
    if (!o) { this.execLaneOrPush(); return; }
    const c = o.camp;
    this.pMoveX = c.x; this.pMoveY = c.y; this.pMove = true;
    this.pAggro = 0.7;
    const allies = this.alliesNear(c.x, c.y, 13);
    const up = this.campUp(c.x, c.y);
    // (owner_rulings 44: outnumbered at the pit — two or more enemy fighters more than us within 18 m — the monster is left to
    // them unless my burst finishes it now (a steal is the genre's play); the fighters there are the fight)
    const foes = this.enemiesNear(c.x, c.y, 18), mates = this.alliesNear(c.x, c.y, 18);
    let steal = false;
    // (owner_rulings 44, round 2: never against three or more — a lone steal into four was the verifier's 1-against-4 take)
    if (up && foes >= mates + 2 && foes < 3) {
      let mon: Entity | null = null;
      for (const m of this.perc.monsters) if (m.alive && Math.abs(m.x - c.x) < 8 && Math.abs(m.y - c.y) < 8 && (!mon || m.hp + m.shield > mon.hp + mon.shield)) mon = m;
      steal = !!mon && mon.hp + mon.shield <= this.burstOn(mon) * 0.9 && this.dist2(mon, e.x, e.y) <= 10 * 10;
    }
    // start (and keep at) it only when the fighters there can take it: never a lone attempt
    if (up && steal) { this.pMonsters = true; this.pMonsterX = c.x; this.pMonsterY = c.y; }
    else if (up && foes >= mates + 2) {
      // (wait out of their reach on our side; the team brain drops the call)
      const base = this.k.bases.find((x) => x.team === this.team);
      if (base) { const dx = base.fx - c.x, dy = base.fy - c.y, d = dhypot(dx, dy) || 1; this.pMoveX = c.x + (dx / d) * 16; this.pMoveY = c.y + (dy / d) * 16; }
    }
    else if (up && allies >= 2 && this.campOdds(c.x, c.y)) {
      this.pMonsters = true; this.pMonsterX = c.x; this.pMonsterY = c.y;
    } else {
      // wait outside its reach for the team
      const base = this.k.bases.find((x) => x.team === this.team);
      if (base) {
        const dx = base.fx - c.x, dy = base.fy - c.y, d = dhypot(dx, dy) || 1;
        this.pMoveX = c.x + (dx / d) * 10; this.pMoveY = c.y + (dy / d) * 10;
      }
    }
    const f = this.pickFightTarget(10);
    if (steal) { /* the last blow on the monster first */ }
    else if (f && this.dist2(f, c.x, c.y) < 14 * 14 && (foes < mates + 2 || this.adv >= 0.5)) { this.pFight = f; this.pMonsters = false; }
    // (lane AI G7: an enemy lamp watching the pit is cleared first while nobody of theirs is near)
    else if (this.diff.visionSetup && this.nearestEnemyFighter(12) === null) {
      for (const wd of this.perc.enemyWards) if (wd.alive && wd.targetable && this.dist2(wd, c.x, c.y) <= 20 * 20) { this.pSiege = wd; this.pMonsters = false; this.pMoveX = wd.x; this.pMoveY = wd.y; break; }
    }
  }

  private execFarm(): void {
    const k = this.k, b = this.brain, e = this.e, now = this.now;
    if (!b || k.camps.length === 0) { this.execPush(); return; }
    // keep the current camp while it is up; else the best next one
    let ci = this.campTarget;
    if (ci >= 0) {
      const c = k.camps[ci];
      const near = this.dist2(e, c.x, c.y) < 8 * 8;
      // (a camp found empty only counts as cleared once it was due: before its spawn it is just early)
      if (near && !this.campUp(c.x, c.y) && w2seen(this, c.x, c.y) && b.campReady[ci] <= now) { b.campCleared(ci, now); ci = -1; }
      else if (b.campReady[ci] > now + 10) {
        // still down: keep walking to it unless another camp is clearly sooner (no drifting from
        // camp to camp while every camp waits on its first spawn)
        const nx = this.nextCamp();
        if (nx !== ci && this.campScore(k.camps[nx]) < this.campScore(c) - 8) ci = nx;
        this.campTarget = ci;
      }
    }
    if (ci < 0) { ci = this.nextCamp(); this.campTarget = ci; }
    if (ci < 0) { this.execPush(); return; }
    const c = k.camps[ci];
    this.pMove = true; this.pMoveX = c.x; this.pMoveY = c.y;
    this.pMonsters = true; this.pMonsterX = c.x; this.pMonsterY = c.y;
    this.pAggro = 0.4;
    this.selfDefense();
    // stand just off the camp when it is still down
    if (b.campReady[ci] > now + 1 && this.dist2(e, c.x, c.y) < 6 * 6) this.pMove = false;
  }

  /**
   * A gank (lane AI G3): approach — walk to the planned thicket, not fighting on the way (aggression 0); lurk — stand
   * in it, out of sight, up to lurkMax s, until the target steps within my reach + 1 m, or is under 60 % or held within
   * 11 m; strike — the old straight run at it (gap-closer or CC first, the laner joins through its gank read). The
   * approach is given up when the target is lost for 3 s or a second enemy fighter stands beside it.
   */
  /** the team's gank target — or, while I walk to or wait in a planned thicket, my own target through up to 3 s out of
   *  sight (the team read needs it in view, and a lurk loses sight of its target as it should) */
  private roamGoal(): Entity | null {
    const b = this.brain;
    if (b && b.invader && b.hunters.has(this.player)) return b.invader;
    const g = b?.gank ?? null;
    if (this.mode !== 'roam' || this.roamPhase === 'strike' || this.roamTarget < 0 || (g && g.id === this.roamTarget)) return g;
    const own = this.w.entity(this.roamTarget);
    if (!own || !own.alive || own.kind !== 'fighter') return g;
    if (this.isNoticed(own) || (this.roamLostAt >= 0 && this.now - this.roamLostAt <= 3)) return own;
    return g;
  }

  private execRoam(): void {
    const b = this.brain, t = this.roamGoal(), e = this.e, now = this.now;
    if (!t || !t.alive) { this.execLaneOrPush(); return; }
    if (this.roamTarget !== t.id) this.planRoam(t);
    if (b && b.gankLane >= 0) { b.gankComing = b.gankLane; b.gankComingAt = now; }
    const seen = this.isNoticed(t);
    if (seen) this.roamLostAt = -1; else if (this.roamLostAt < 0) this.roamLostAt = now;
    const d2 = this.dist2(t, e.x, e.y);
    if (this.roamPhase !== 'strike') {
      if ((this.roamLostAt >= 0 && now - this.roamLostAt > 3) || this.enemiesNear(t.x, t.y, 9) >= 2) {
        this.roamBlockUntil = now + 12; this.roamTarget = -1; this.execLaneOrPush(); return;
      }
      // (strike: the target steps into my reach + 3 m, or is under 60 %, held, or already fighting my laner, within 14 m)
      const reach = this.strikeReach() + 3;
      if (seen && (d2 <= reach * reach || ((t.hp < t.maxHp * 0.6 || holdLeft(t) > 0 || this.fightOn()) && d2 <= 14 * 14))) this.roamPhase = 'strike';
    }
    if (this.roamPhase === 'approach' && this.spottedOnApproach()) {
      // (spotted on the way in — an enemy I can see has me in its sight, or a lamp I know of does: a seen gank is no
      // surprise; go now if the target is close, else give it up, the genre's call)
      if (seen && d2 <= 14 * 14) this.roamPhase = 'strike';
      else { this.roamBlockUntil = now + 12; this.roamTarget = -1; this.execLaneOrPush(); return; }
    }
    if (this.roamPhase === 'approach') {
      this.pMove = true; this.pMoveX = this.roamX; this.pMoveY = this.roamY; this.pAggro = 0;
      this.selfDefense();
      if (this.dist2(e, this.roamX, this.roamY) <= 1.6 * 1.6) { this.roamPhase = 'lurk'; this.lurkSince = now; }
      return;
    }
    if (this.roamPhase === 'lurk') {
      this.pAggro = 0;
      this.selfDefense();
      if (now - this.lurkSince <= this.lurkFor) return;
      // (the wait is over: go anyway while it is in sight and in walking range — a gank is two on one either way)
      if (seen && d2 <= 22 * 22) this.roamPhase = 'strike';
      else { this.roamBlockUntil = now + 12; this.roamTarget = -1; this.execLaneOrPush(); return; }
    }
    this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
    this.pAggro = 0.8;
    if (seen && d2 < 9 * 9) { this.pFight = t; this.pAggro = 1; }
  }

  /** fog-honest: an enemy fighter or tower I can see stands with me inside its sight, or a lamp I know of covers me (a Wick
   *  passing on its road is no watcher for the lower tiers: the approach skirts the road) */
  private spottedOnApproach(): boolean {
    const e = this.e, p = this.perc;
    // (the tiers that route round known vision, veteran, also turn back from a Wick's glimpse)
    for (const l of this.diff.avoidVision ? [p.enemyFighters, p.enemyStructs, p.enemyUnits] : [p.enemyFighters, p.enemyStructs]) {
      for (const o of l) { if (o.alive && o.sight > 0 && sq(o.x - e.x) + sq(o.y - e.y) <= sq(o.sight)) return true; }
    }
    for (const wd of p.enemyWards) if (wd.alive && sq(wd.x - e.x) + sq(wd.y - e.y) <= sq(Math.max(6, wd.sight))) return true;
    return false;
  }

  private execHunt(): void {
    const t = this.huntTarget;
    if (t && t.alive && !(this.isNoticed(t) && !this.chaseOn(t))) {
      this.m.ffaTarget.set(this.player, t.player ? t.player.player : -1);
      if (this.isNoticed(t) && this.thirdParty(t)) return;
      if (this.isNoticed(t)) {
        this.pFight = t; this.pAggro = 0.85;
        this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
        return;
      }
      const ls = this.perc.lastSeen.get(t.id);
      if (ls) { this.pMove = true; this.pMoveX = ls.x; this.pMoveY = ls.y; return; }
    }
    this.m.ffaTarget.delete(this.player);
    // no target: drift toward the centre of the arena (where fights and pickups are)
    const e = this.e;
    const a = (this.player * 1.7) % (Math.PI * 2);
    this.pMove = true; this.pMoveX = this.k.mapCenterX + dcos(a) * 6; this.pMoveY = this.k.mapCenterY + dsin(a) * 6;
    const f = this.nearestEnemyFighter(this.prof.attackRange + 4);
    if (f && this.recentDps > 0) { this.pFight = f; this.pAggro = 0.6; }
    void e;
  }

  /** ruling 55 (FRAY chase discipline): has this target been given up on */
  private chaseDropped(f: Entity): boolean {
    return (this.chaseDrop.get(f.id) ?? -1e9) > this.now;
  }

  /** ruling 55: a seen fighter moving away from me at 80 % or more of my speed (its motion is in plain sight) */
  private fleeing(f: Entity): boolean {
    const e = this.e, dx = f.x - e.x, dy = f.y - e.y, d = dhypot(dx, dy) || 1;
    return (f.vx * dx + f.vy * dy) / d >= 0.8 * Math.max(1, e.stats.moveSpeed);
  }

  /**
   * ruling 55 (FRAY chase discipline, adept and veteran): a chase that has not closed the gap by a metre in chaseQuit
   * seconds, with the target out of my reach and no gap-closer or engage ready to reach it, is given up — the target is
   * left alone for 6 s. A fleeing fighter as fast as its chaser keeps the gap for ever; the chaser walked 10-15 m behind a
   * fighter at 20 % for 4 s and more, out of the fight, while a third seat lined up on both. False when given up now.
   */
  private chaseOn(t: Entity): boolean {
    const q = this.diff.chaseQuit;
    if (!this.k.ffa || !(q < Infinity)) return true;
    const e = this.e, now = this.now;
    const d = Math.sqrt(this.dist2(t, e.x, e.y));
    // (only a wounded target's run counts — under 40 %: the one that breaks off; a third party's wait beside a fight is not a chase)
    // (ruling 55: or any target seen running from me at my speed)
    if ((t.hp >= t.maxHp * 0.4 && !this.fleeing(t)) || inAttackRange(e, t) || this.strikeReach() >= d - t.radius) { this.chaseId = -1; return true; }
    if (this.chaseId !== t.id) { this.chaseId = t.id; this.chaseAt = now; this.chaseGap = d; return true; }
    if (now - this.chaseAt < q) return true;
    if (d < this.chaseGap - 1) { this.chaseAt = now; this.chaseGap = d; return true; }
    this.chaseDrop.set(t.id, now + 6); this.chaseId = -1;
    if (this.huntTarget === t) this.huntTarget = null;
    if (this.killTarget === t) this.killTarget = null;
    return false;
  }

  private execPickup(): void {
    const pk = this.nearestPickup();
    if (!pk) { this.execLaneOrPush(); return; }
    this.pMove = true; this.pMoveX = pk.x; this.pMoveY = pk.y;
    this.pAggro = 0.4;
    this.selfDefense();
  }

  /** a ready escape (dash, blink or haste) among my abilities */
  private hasEscape(): boolean {
    for (let i = 0; i < 4; i++) { const sl = this.e.slots[i]; if (sl && sl.ready && (abilityInfo(sl.def).use & U_ESCAPE)) return true; }
    return false;
  }

  // ── targets ───────────────────────────────────────────────────────────────────────────────────
  /** focus fire: lowest effective hp in reach, fighters first, with team focus and tower penalties */
  private pickFightTarget(R: number): Entity | null {
    const e = this.e, b = this.brain;
    const myDps = Math.max(10, e.stats.ad * e.stats.attackSpeed);
    const magic = this.prof.scaling === 'magic';
    let best: Entity | null = null, bs = Infinity;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || !attackable(this.w, e, f)) continue;
      const d = Math.sqrt(this.dist2(f, e.x, e.y));
      if (d > R) continue;
      const def = magic ? f.stats.resist : f.stats.armor;
      const ehp = (f.hp + f.shield) * (1 + Math.max(0, def) / 100);
      let s = ehp / myDps + d * 0.15;
      const st = this.m.k.profiles.get(f.def)?.style;
      if (st === 'marksman' || st === 'artillery' || st === 'burst') s -= 0.6;
      // (lane AI G2: an enemy hitting one of our carries within 10 m of me is the one to turn on)
      if (f.atkTarget >= 0 && f.atkTarget !== e.id) {
        const v = this.w.entity(f.atkTarget);
        if (v && v.kind === 'fighter' && v.team === this.team && v.alive && this.dist2(v, e.x, e.y) <= 10 * 10) {
          const vs = this.m.k.profiles.get(v.def)?.style;
          if (vs === 'marksman' || vs === 'artillery' || vs === 'burst') s -= 1.0 * this.diff.focusDiscipline;
        }
      }
      if (b) {
        const n = b.focusCount(f.id, this.player);
        s -= n * 1.2 * this.diff.focusDiscipline;
        if (n >= 3 && ehp < myDps * 2) s += 2;
      }
      if (!this.towerSafe(f.x, f.y, 0)) s += 4;
      if (s < bs) { bs = s; best = f; }
    }
    return best;
  }

  /** FRAY: is the last-life caution on — more than 4 seats still in, and the Noon Toll (rules.noonToll) not yet ringing */
  private frayCareful(): boolean {
    let inPlay = 0;
    for (const p of this.w.players) if (p && (p.lives ?? 1) > 0) inPlay++;
    return inPlay > 4 && !this.tollRinging();
  }
  /** the Noon Toll (rules.noonToll) rings: from its hour, for the last seats, or over a quiet arena (public: announced) */
  private tollRinging(): boolean {
    return noonTollOn(this.w);
  }

  private huntQuality = 0;
  /** Fray: the weakest reachable enemy, minus third-party risk, with the 2-bots-per-human cap; a fighter the Noon Toll
   *  shows is worth walking to from across the plate (80 m, not 30) */
  private chooseHunt(lastLife: boolean): Entity | null {
    const e = this.e;
    const myBurst = (t: Entity): number => this.burstOn(t);
    let best: Entity | null = null, bs = -Infinity;
    let leaderScore = 0, second = 0, leader = -1;
    for (const p of this.w.players) {
      if (!p) continue;
      const sc = p.score ?? 0;
      if (sc > leaderScore) { second = leaderScore; leaderScore = sc; leader = p.player; } else if (sc > second) second = sc;
    }
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || !f.player || this.chaseDropped(f)) continue;
      const d = Math.sqrt(this.dist2(f, e.x, e.y));
      if (d > (f.revealAllUntil > this.w.tick ? 80 : 30)) continue;
      const tp = f.player;
      if (tp.controller === 'human') {
        let hunters = 0;
        for (const [bot, target] of this.m.ffaTarget) if (bot !== this.player && target === tp.player) hunters++;
        if (hunters >= 2) continue;
      }
      const kill = myBurst(f) / Math.max(1, f.hp + f.shield);
      let third = 0;
      for (const g of this.perc.enemyFighters) {
        if (g === f || !g.alive) continue;
        if (this.dist2(g, f.x, f.y) < 10 * 10) third++;
      }
      let s = Math.min(2, kill) - d / 30 - third * 0.35;
      if ((tp.score ?? 0) > 0 && (tp.score ?? 0) >= leaderScore) s += 0.12;
      // (lane AI G10: a leader two or more ahead is everyone's problem — more so while it is busy with someone else)
      if (tp.player === leader && leaderScore >= second + 2) s += 0.3 + (third > 0 ? 0.15 : 0);
      if ((tp.lives ?? 2) <= 1) s += 0.08;
      // careful on the last life: an even fight is a worse pick, never no pick (a skip here froze whole endgames)
      if (lastLife && kill < 0.8 && f.hp > f.maxHp * 0.4) s -= 0.6;
      // (ruling 55, chase discipline: a seat running from me — moving away at most of my speed, out of my reach — is a chase
      // I cannot win at even speed; a skilled seat takes the fight in front of it instead. The whole arena hunting the one that
      // broke off kept a foe within 12 m of 61-67 % of the fighters under a quarter's health)
      if (this.diff.chaseQuit < Infinity && this.fleeing(f) && this.strikeReach() < d - f.radius) s -= 0.7;
      if (s > bs) { bs = s; best = f; }
    }
    this.huntQuality = Math.max(0, bs);
    return best;
  }

  /**
   * Lane AI G10 (FRAY): my target is trading blows with someone else within 20 m — wait 12 m off their fight (in a
   * thicket within 8 m of that spot when there is one) and go in once either is under 35 % or my burst kills it.
   * Rolled once per target (thirdParty). True while waiting.
   */
  private thirdParty(t: Entity): boolean {
    if (this.diff.thirdParty <= 0 || this.recentDps > 0) return false;
    const e = this.e;
    let o: Entity | null = null;
    for (const g of this.perc.enemyFighters) {
      if (g === t || !this.isNoticed(g) || this.dist2(g, t.x, t.y) > 20 * 20) continue;
      if (g.atkTarget === t.id || t.atkTarget === g.id) { o = g; break; }
    }
    if (!o) return false;
    if (this.thirdRoll.id !== t.id) this.thirdRoll = { id: t.id, ok: this.rng.chance(this.diff.thirdParty) };
    if (!this.thirdRoll.ok) return false;
    if (t.hp < t.maxHp * 0.35 || o.hp < o.maxHp * 0.35 || this.burstOn(t) >= (t.hp + t.shield) * 0.9) return false;
    const cx = (t.x + o.x) * 0.5, cy = (t.y + o.y) * 0.5;
    const dx = e.x - cx, dy = e.y - cy, d = dhypot(dx, dy) || 1;
    let wx = cx + (dx / d) * 12, wy = cy + (dy / d) * 12;
    let bd = 8 * 8;
    for (const poly of this.k.map.thickets) {
      let tx = 0, ty = 0;
      for (const pt of poly) { tx += pt[0]; ty += pt[1]; }
      tx /= poly.length; ty /= poly.length;
      const d2 = sq(tx - wx) + sq(ty - wy);
      if (d2 < bd && sq(tx - cx) + sq(ty - cy) >= 10 * 10 && this.w.nav.walkable(tx, ty)) { bd = d2; wx = tx; wy = ty; }
    }
    if (!this.w.nav.walkable(wx, wy)) return false;
    this.pMove = true; this.pMoveX = wx; this.pMoveY = wy; this.pAggro = 0.2;
    return true;
  }

  private nearestPickup(): { x: number; y: number } | null {
    const e = this.e;
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const pk of this.perc.pickups) {
      if (!pk.alive) continue;
      const d2 = this.dist2(e, pk.x, pk.y);
      if (d2 < bd) { bd = d2; best = { x: pk.x, y: pk.y }; }
    }
    return best;
  }

  private nextEnemyStructure(lane: number): Entity | null {
    const l = this.k.lanes[lane];
    if (!l) return null;
    const b = this.brain;
    let best: Entity | null = null, bp = Infinity;
    for (const st of this.perc.enemyStructs) {
      if (!st.alive || !st.targetable) continue;
      const info = this.m.structInfo(st);
      if (!info) continue;
      // a structure that comes back is only worth hitting when the core can follow
      if (info.respawns && b && b.towersLeft > 0) continue;
      const p = info.lane === lane ? progress(l, this.team, info.s) : info.lane < 0 ? l.length + 1 : Infinity;
      if (p < bp) { bp = p; best = st; }
    }
    return best;
  }

  private alliesNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const f of this.perc.allyFighters) if (f.alive && this.dist2(f, x, y) <= r * r) n++;
    return n;
  }
  private enemiesNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const f of this.perc.enemyFighters) if (f.alive && this.isNoticed(f) && this.dist2(f, x, y) <= r * r) n++;
    return n;
  }
  /**
   * Can the allied fighters at a camp take it? Their damage kills its monsters within 35 s, and the
   * monsters' damage over that time stays within 45 % of the fighters' combined health.
   */
  private campOdds(x: number, y: number): boolean {
    let H = 0, D = 0;
    let first: Entity | null = null;
    for (const m of this.perc.monsters) {
      if (!m.alive || Math.abs(m.x - x) >= 8 || Math.abs(m.y - y) >= 8) continue;
      first ??= m;
      H += m.hp + m.shield;
      // attacks, plus a third again for the monster's own abilities
      D += (m.attackDef ? mitigated(m, this.e, m.stats.ad, m.attackDef.damageType) * m.stats.attackSpeed : 0) * 1.33;
    }
    if (!first) return false;
    let S = 0, E = 0;
    for (const a of this.perc.allyFighters) {
      if (!a.alive || this.dist2(a, x, y) > 14 * 14) continue;
      S += this.dpsOn(a, first);
      E += a.hp + a.shield;
    }
    const ttk = H / Math.max(1, S);
    return ttk <= 35 && D * ttk <= E * 0.45;
  }

  /**
   * The next camp of a clear: the one I can start soonest — arrival is the walk or the respawn left,
   * whichever is longer (a far camp is never better for being down longer), the nearer of two
   * equal ones first. The enemy half of the Dialwood costs JUNGLE_INVADE_COST s more (and more again
   * with an enemy fighter seen near it), so the clear stays home unless the own half is all down.
   */
  private nextCamp(): number {
    let ci = -1, bs = Infinity;
    for (const c of this.k.camps) {
      if (c.objective) continue;
      const s = this.campScore(c);
      if (s < bs) { bs = s; ci = c.index; }
    }
    return ci;
  }
  private campScore(c: CampInfo): number {
    const e = this.e;
    const travel = Math.sqrt(this.dist2(e, c.x, c.y)) / Math.max(1, e.stats.moveSpeed);
    const left = Math.max(0, this.brain!.campReady[c.index] - this.now);
    let s = Math.max(travel, left) + travel * 0.35;
    if (c.side >= 0 && c.side !== this.team) s += JUNGLE_INVADE_COST + (this.enemiesNear(c.x, c.y, 18) > 0 ? 30 : 0);
    return s;
  }
  /** a jungler with a camp to take now: one of its non-objective camps up (or up within 4 s) within
   *  `r` m, that it can take on its current health (campOdds), or a monster on it already */
  private campAtHand(r: number): boolean {
    const b = this.brain, e = this.e;
    if (!b || !this.jungle) return false;
    for (const m of this.perc.monsters) if (m.alive && m.atkTarget === e.id) return true;
    for (const c of this.k.camps) {
      if (c.objective || b.campReady[c.index] > this.now + 4 || this.dist2(e, c.x, c.y) > r * r) continue;
      if (!this.campUp(c.x, c.y) && w2seen(this, c.x, c.y)) continue;
      if (this.campOdds(c.x, c.y) || !this.campUp(c.x, c.y)) return true;
    }
    return false;
  }

  /** a monster of an objective camp (it may have chased out of the pit) */
  private objectiveMonster(m: Entity): boolean {
    for (const c of this.k.camps) if (c.objective && Math.abs(m.x - c.x) < 20 && Math.abs(m.y - c.y) < 20) return true;
    return false;
  }
  private campUp(x: number, y: number): boolean {
    for (const m of this.perc.monsters) if (m.alive && Math.abs(m.x - x) < 8 && Math.abs(m.y - y) < 8) return true;
    return false;
  }
  private nearbyCamp(r: number): number {
    const b = this.brain;
    if (!b) return -1;
    for (const c of this.k.camps) if (!c.objective && b.campReady[c.index] <= this.now && this.dist2(this.e, c.x, c.y) < r * r) return c.index;
    return -1;
  }
}

function w2seen(b: Bot, x: number, y: number): boolean { return b.w.vision.seen(b.team, x, y); }
