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
// Fray: no team brain; targets the weakest reachable enemy, penalises fights other players can
// reach, never favours or spares other bots, caps how many bots hunt the same human seat at 2,
// contests pickups, uses the shared shop, plays safer on its last life.

import type { Command, PlayerView, SeatSetup, WorldView } from '../../contracts/sim.ts';
import { attackable, inAttackRange } from '../attack.ts';
import type { Entity, Player } from '../entity.ts';
import type { Rng } from '../rng.ts';
import type { BotController } from '../sim.ts';
import { seatState } from '../units/fighters.ts';
import type { World } from '../world.ts';
import type { DifficultyProfile } from './difficulty.ts';
import { Economy } from './economy.ts';
import type { AbilityCoreT } from '../catalog_index.ts';
import { abilityInfo, estimateDamage, fromProgress, lanePoint, progress, proj, type BuildPlan, type FighterProfile } from './knowledge.ts';
import type { BotMatch } from './match.ts';
import { BotBase, gauss, type Mode } from './micro.ts';
import { memoryWeight } from './perception.ts';

const MODE_TICKS = 6;
const MIN_MODE_TIME = 1.5;

export class Bot extends BotBase implements BotController {
  readonly eco: Economy;
  readonly stagger: number;
  modeSince = -1e9;
  lane = -1;
  jungle = false;
  support = false;
  private assigned = false;
  private follows = true;
  private followRollAt = -1e9;
  private recallTriedAt = -1e9;
  private campTarget = -1;
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
  private holdX = 0; private holdY = 0;

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
    this.act();
    // publish the focus target for teammates
    if (this.brain) { if (this.pFight && this.pFight.kind === 'fighter') this.brain.focus.set(this.player, this.pFight.id); else this.brain.focus.delete(this.player); }
    return out;
  }

  private assign(): void {
    this.assigned = true;
    const a = this.brain ? this.brain.laneOf(this.player) : { lane: this.k.lanes.length > 0 && !this.k.ffa ? 0 : -1, jungle: false, support: false };
    this.lane = a.lane; this.jungle = a.jungle; this.support = a.support;
  }

  private clearPlan(): void {
    this.pMove = false; this.pFight = null; this.pSiege = null; this.pFarm = 0; this.pMonsters = false; this.pAggro = 0; this.pDive = false;
  }

  // ── situation ─────────────────────────────────────────────────────────────────────────────────
  /** fighting power proxy: effective hp × damage per second */
  private power(f: Entity): number {
    const s = f.stats;
    const ehp = (f.hp + f.shield) * (1 + (s.armor + s.resist) / 200);
    const dps = s.ad * s.attackSpeed * (1 + s.crit * 0.75) + s.ap * 0.6 + f.level * 12;
    return Math.sqrt(Math.max(1, ehp) * Math.max(1, dps));
  }
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
    for (const ls of tp.lastSeen.values()) {
      const f = this.w.entity(ls.id);
      if (!f || !f.alive || this.isNoticed(f)) continue;
      const wgt = memoryWeight(ls, this.now, 6);
      if (wgt > 0 && (ls.x - e.x) ** 2 + (ls.y - e.y) ** 2 <= R * R) powE += this.power(f) * wgt * 0.6;
    }
    this.nearE = nE; this.nearA = nA;
    this.adv = powA / Math.max(1, powA + powE);
    // tower aggro: an enemy tower shooting me
    this.towerAggro = false;
    for (const st of tp.enemyStructs) if (st.alive && st.atkTarget === e.id && inAttackRange(st, e)) { this.towerAggro = true; break; }
    // killable target
    this.killTarget = null; this.killMargin = 0;
    for (const f of tp.enemyFighters) {
      if (!this.isNoticed(f) || this.dist2(f, e.x, e.y) > 10 * 10) continue;
      let dmg = this.burstOn(f);
      for (const a of tp.allyFighters) {
        if (a === e || !a.alive || this.dist2(a, f.x, f.y) > 8 * 8) continue;
        dmg += a.stats.ad * a.stats.attackSpeed * 3 + a.level * 25;
      }
      const margin = dmg / Math.max(1, f.hp + f.shield);
      if (margin > this.killMargin) { this.killMargin = margin; this.killTarget = f; }
    }
    if (this.killMargin < 1.1) this.killTarget = null;
    // lane opponent: the nearest noticed enemy fighter on my lane, close by
    this.laneEnemy = this.nearestEnemyFighter(this.prof.attackRange + 6);
  }

  // ── utility mode selection ────────────────────────────────────────────────────────────────────
  private selectMode(): void {
    this.situate();
    const k = this.k, kind = k.kind, e = this.e, b = this.brain, now = this.now;
    if (now - this.followRollAt > 15) { this.followRollAt = now; this.follows = this.rng.chance(this.diff.intentFollow); }
    const hpF = this.hpF;
    const res = e.resource;
    const resF = res && res.model === 'pool' && e.maxRes > 0 ? e.res / e.maxRes : 1;
    const lives = this.p.lives;
    const lastLife = kind === 'fray' && lives !== undefined && lives <= 1;
    const thr = this.prof.retreatHp + this.diff.retreatBias + (lastLife ? 0.15 : 0) + (this.adv < 0.4 ? 0.08 : 0);
    let best: Mode = this.mode, bestS = -1;
    const consider = (m: Mode, s: number): void => {
      if (s <= 0) return;
      s += gauss(this.rng) * this.diff.decisionNoise * 0.3;
      if (m === this.mode) s += now - this.modeSince < 3 ? 0.12 : 0.05;
      if (s > bestS) { bestS = s; best = m; }
    };
    // retreat
    let retreat = 0;
    if (this.nearE > 0) {
      if (hpF < thr) retreat = 0.85 + (thr - hpF);
      else if (this.adv < 0.3 && this.nearE >= 2) retreat = 0.8;
      else if (this.adv < 0.42 && hpF < 0.5) retreat = 0.7;
    }
    if (this.towerAggro && !(this.mode === 'allin' && this.killTarget && this.killTarget.hp < this.killTarget.maxHp * 0.25 && hpF > 0.5)) retreat = Math.max(retreat, 0.86);
    if (kind === 'fray' && hpF < thr && this.recentDps > 0) retreat = Math.max(retreat, 0.75);
    consider('retreat', retreat);
    // recall / shop
    const base = k.bases.find((x) => x.team === this.team);
    const atBase = !!base && this.dist2(e, base.fx, base.fy) <= (base.fr + 1.5) ** 2;
    const nextPrice = this.eco.nextPrice(this.w, this.p);
    let recall = 0;
    if (kind !== 'fray') {
      if (base) {
        if (atBase && (hpF < 0.9 || (this.p.canShop && this.p.gold >= nextPrice))) recall = 0.92;
        else if (hpF < 0.36 + this.diff.recallBias && this.nearE === 0) recall = 0.74;
        else if (k.rules.recall && this.p.gold >= Math.max(nextPrice, 1100) && this.nearE === 0 && hpF < 0.8) recall = 0.5;
        else if (k.rules.recall && this.p.gold >= Math.max(nextPrice, 1700) && this.nearE === 0) recall = 0.46;
        else if (k.rules.recall && resF < 0.12 && this.nearE === 0) recall = 0.5;
      }
    } else if (k.shops.length > 0 && this.nearE === 0 && this.p.gold >= nextPrice && nextPrice < Infinity) recall = 0.52;
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
    // trade
    const le = this.laneEnemy;
    if (le && hpF > 0.55 && this.adv >= 0.45 && this.towerSafe(le.x, le.y, 0.5) && (this.mode === 'lane' || this.mode === 'trade' || this.mode === 'push')) {
      const spent = this.diff.knowsCooldowns ? this.m.spentAbilities(le.id, now) * 0.05 : 0;
      consider('trade', 0.48 + 0.3 * (hpF - le.hp / Math.max(1, le.maxHp)) + spent);
    }
    // all-in
    const kt = this.killTarget;
    if (kt && hpF > 0.3 && (this.towerSafe(kt.x, kt.y, 0) || (kt.hp < kt.maxHp * 0.2 && hpF > 0.6))) {
      consider('allin', 0.7 + Math.min(0.2, (this.killMargin - 1) * 0.2) - (lastLife && this.killMargin < 1.5 ? 0.15 : 0));
    }
    // teamfight
    if (this.nearE >= 2 && this.nearA >= 2 && this.adv >= 0.42) consider('teamfight', 0.6 + (this.adv - 0.5) * 0.6);
    // push / group / defend / objective / roam (team intents)
    if (b) {
      const follow = this.follows ? 1 : 0;
      if (kind === 'bridge' || kind === 'brawl') consider('push', b.siege ? 0.5 : 0.35);
      else if (b.group && follow && (!this.jungle || b.phase === 'late')) consider('push', 0.56);
      else if (this.lane >= 0 && b.push[this.lane] > 0 && !this.jungle) consider('push', 0.3 + 0.2 * b.push[this.lane]);
      const d = this.lane >= 0 ? b.defend[this.lane] : 0;
      let global = 0;
      for (let i = 0; i < b.defend.length; i++) global = Math.max(global, b.defend[i]);
      global = Math.max(global, b.baseThreat);
      if (d > 0.05) consider('defend', (0.5 + 0.35 * d) * (follow ? 1 : 0.85));
      else if (global >= 0.7 && follow) consider('defend', 0.55 + 0.2 * global);
      if (b.objective && follow) consider('objective', b.objective.desire + (this.jungle ? 0.05 : 0));
      if (b.gank && (this.jungle || this.prof.style === 'burst' || this.prof.style === 'diver') && hpF > 0.6 &&
        this.dist2(e, b.gank.x, b.gank.y) < 50 * 50 && b.gank.alive) consider('roam', this.jungle ? 0.53 : 0.44);
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
    // hysteresis: a young mode is kept unless the newcomer is urgent
    if (best !== this.mode) {
      if (now - this.modeSince < MIN_MODE_TIME && bestS < 0.8) return;
      this.mode = best;
      this.modeSince = now;
      this.recallTriedAt = -1e9;
      this.campTarget = -1;
    }
  }

  // ── executors ─────────────────────────────────────────────────────────────────────────────────
  private execute(): void {
    const base = this.k.bases.find((x) => x.team === this.team);
    this.computeSafe(base);
    switch (this.mode) {
      case 'lane': this.execLane(); break;
      case 'return': this.computeHold(); this.pMove = true; this.pMoveX = this.holdX; this.pMoveY = this.holdY; this.selfDefense(); break;
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
        const dx = base.fx - best.x, dy = base.fy - best.y, d = Math.hypot(dx, dy) || 1;
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
    const d = Math.hypot(ax, ay) || 1;
    let tx = e.x + (ax / d) * 8, ty = e.y + (ay / d) * 8;
    // pull toward the map centre so a bot does not pin itself on the edge
    tx = tx * 0.8 + this.k.mapCenterX * 0.2; ty = ty * 0.8 + this.k.mapCenterY * 0.2;
    this.safeX = tx; this.safeY = ty;
  }

  /** the lane stand point behind my wave (last-hit position), tower-safe */
  private computeHold(): void {
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
    const standoff = this.prof.ranged ? e.stats.range + e.radius + 1.2 : 2.4;
    let p = front - standoff - (this.support ? 1.2 : 0);
    // never park inside the first enemy tower's reach (micro re-checks minions tanking it)
    const cap = enemyTowerP - enemyTowerR - e.radius - 1;
    if (p > cap) p = cap;
    if (p < 3) p = 3;
    lanePoint(l, fromProgress(l, team, p));
    const side = (this.player % 2 === 0 ? 1 : -1) * (this.support ? 1.6 : 0.8);
    let x = proj.x - proj.dy * side, y = proj.y + proj.dx * side;
    const nav = this.w.nav;
    if (!nav.walkable(x, y)) { x = proj.x; y = proj.y; }
    this.holdX = x; this.holdY = y;
  }

  /** fight back what is hitting me (any mode that is not running away) */
  private selfDefense(): void {
    if (this.recentDps <= 0) return;
    const f = this.nearestEnemyFighter(this.prof.attackRange + 3);
    if (f && this.hpF > 0.4 && this.towerSafe(f.x, f.y, 0)) { this.pFight = f; this.pAggro = Math.max(this.pAggro, 0.5); }
  }

  private execLane(): void {
    this.computeHold();
    this.pMove = true; this.pMoveX = this.holdX; this.pMoveY = this.holdY;
    this.pFarm = 1;
    this.pAggro = this.hpF > 0.5 ? 0.3 : 0.15;
    // a wave crashing into my tower with no enemy champion around: clear it
    if (this.nearE === 0 && this.perc.enemyN[Math.max(0, this.lane)] >= 4 && this.perc.ownN[Math.max(0, this.lane)] <= 1) this.pFarm = 2;
    this.selfDefense();
  }

  private execTrade(): void {
    this.execLane();
    const t = this.laneEnemy;
    if (t && this.isNoticed(t) && attackable(this.w, this.e, t)) { this.pFight = t; this.pAggro = 0.6; }
  }

  private execAllin(): void {
    const t = this.killTarget ?? this.pickFightTarget(12);
    if (!t) { this.execLaneOrPush(); return; }
    this.pFight = t; this.pAggro = 1;
    this.pDive = t.hp < t.maxHp * 0.25 && this.hpF > 0.5;
    this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
  }

  private execTeamfight(): void {
    const t = this.pickFightTarget(13);
    if (!t) { this.execLaneOrPush(); return; }
    this.pFight = t; this.pAggro = 0.9;
    this.pFarm = 0;
    const e = this.e;
    // ranged styles keep their preferred range; melee walk in
    const want = this.prof.ranged ? Math.max(this.prof.prefRange, this.prof.attackRange) : 0;
    const dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy) || 1;
    this.pMove = true;
    if (want > 0 && d < want - 1) { this.pMoveX = t.x + (dx / d) * want; this.pMoveY = t.y + (dy / d) * want; }
    else { this.pMoveX = t.x; this.pMoveY = t.y; }
  }

  private execRetreat(): void {
    this.pMove = true; this.pMoveX = this.safeX; this.pMoveY = this.safeY;
    this.pAggro = 0.5;
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
    const atBase = this.dist2(e, base.fx, base.fy) <= (base.fr - 0.5) ** 2;
    if (atBase) { this.pMove = true; this.pMoveX = base.fx; this.pMoveY = base.fy; return; }
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

  private execLaneOrPush(): void {
    if (this.k.kind === 'fray') { this.execHunt(); return; }
    if (this.jungle && this.k.kind === 'rift') { this.execFarm(); return; }
    this.execPush();
  }

  private execPush(): void {
    const b = this.brain, k = this.k, e = this.e;
    const grouped = !!b && (b.group || k.kind === 'bridge' || k.kind === 'brawl');
    let lane = this.lane >= 0 ? this.lane : 0;
    if (grouped && b && b.siegeLane >= 0) lane = b.siegeLane;
    const saveLane = this.lane;
    this.lane = lane;
    this.computeHold();
    this.lane = saveLane;
    this.pFarm = 2;
    this.pAggro = 0.5;
    this.pMove = true;
    const siege = grouped && b && b.siege && b.siege.alive ? b.siege : this.nextEnemyStructure(lane);
    let mx = this.holdX, my = this.holdY;
    if (siege && siege.alive && siege.targetable) {
      const info = this.m.structInfo(siege);
      const attacks = !!info?.attacks;
      const alliesNear = this.alliesNear(siege.x, siege.y, 12);
      const enemiesNear = this.enemiesNear(siege.x, siege.y, 12);
      const canHit = !attacks || this.minionsTanking(siege) >= 2 || (alliesNear >= 3 && enemiesNear === 0 && siege.hp < siege.maxHp * 0.35);
      if (canHit) { this.pSiege = siege; mx = siege.x; my = siege.y; }
      else if (grouped && b) {
        // wait for the wave on our side of it
        mx = b.groupX; my = b.groupY;
        if (this.dist2(e, mx, my) > 30 * 30) { mx = this.holdX; my = this.holdY; }
      }
    } else if (grouped && b) { mx = b.groupX; my = b.groupY; }
    // group with the team: do not run ahead alone
    if (grouped && b && !this.pSiege && this.alliesNear(e.x, e.y, 10) < 2 && this.dist2(e, b.groupX, b.groupY) < 20 * 20) { mx = b.groupX; my = b.groupY; }
    this.pMoveX = mx; this.pMoveY = my;
    const f = this.pickFightTarget(9);
    if (f && this.adv >= 0.45 && this.hpF > 0.4 && this.towerSafe(f.x, f.y, 0)) { this.pFight = f; this.pAggro = 0.7; }
  }

  private execDefend(): void {
    const b = this.brain;
    if (!b) { this.execLane(); return; }
    let x = b.baseX, y = b.baseY, best = b.baseThreat;
    if (this.lane >= 0 && b.defend[this.lane] > 0.05) { x = b.defendX[this.lane]; y = b.defendY[this.lane]; best = 2; }
    for (let i = 0; i < b.defend.length; i++) if (b.defend[i] > best) { best = b.defend[i]; x = b.defendX[i]; y = b.defendY[i]; }
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
    if (up && (allies >= 3 || o.desire >= 0.7 || (allies >= 2 && this.jungle))) {
      this.pMonsters = true; this.pMonsterX = c.x; this.pMonsterY = c.y;
    } else {
      // wait outside its reach for the team
      const base = this.k.bases.find((x) => x.team === this.team);
      if (base) {
        const dx = base.fx - c.x, dy = base.fy - c.y, d = Math.hypot(dx, dy) || 1;
        this.pMoveX = c.x + (dx / d) * 10; this.pMoveY = c.y + (dy / d) * 10;
      }
    }
    const f = this.pickFightTarget(10);
    if (f && this.dist2(f, c.x, c.y) < 14 * 14) { this.pFight = f; this.pMonsters = false; }
    void e;
  }

  private execFarm(): void {
    const k = this.k, b = this.brain, e = this.e, now = this.now;
    if (!b || k.camps.length === 0) { this.execPush(); return; }
    const ms = Math.max(1, e.stats.moveSpeed);
    // keep the current camp while it is up; else the best next one
    let ci = this.campTarget;
    if (ci >= 0) {
      const c = k.camps[ci];
      const near = this.dist2(e, c.x, c.y) < 8 * 8;
      if (near && !this.campUp(c.x, c.y) && w2seen(this, c.x, c.y)) { b.campCleared(ci, now); ci = -1; }
      else if (b.campReady[ci] > now + 10) ci = -1;
    }
    if (ci < 0) {
      let bs = Infinity;
      for (const c of k.camps) {
        if (c.objective) continue;
        const travel = Math.sqrt(this.dist2(e, c.x, c.y)) / ms;
        const wait = Math.max(0, b.campReady[c.index] - now - travel);
        const s = travel + wait * 1.5;
        if (s < bs) { bs = s; ci = c.index; }
      }
      this.campTarget = ci;
    }
    if (ci < 0) { this.execPush(); return; }
    const c = k.camps[ci];
    this.pMove = true; this.pMoveX = c.x; this.pMoveY = c.y;
    this.pMonsters = true; this.pMonsterX = c.x; this.pMonsterY = c.y;
    this.pAggro = 0.4;
    this.selfDefense();
    // stand just off the camp when it is still down
    if (b.campReady[ci] > now + 1 && this.dist2(e, c.x, c.y) < 6 * 6) this.pMove = false;
  }

  private execRoam(): void {
    const t = this.brain?.gank;
    if (!t || !t.alive) { this.execLaneOrPush(); return; }
    this.pMove = true; this.pMoveX = t.x; this.pMoveY = t.y;
    this.pAggro = 0.8;
    if (this.isNoticed(t) && this.dist2(t, this.e.x, this.e.y) < 9 * 9) { this.pFight = t; this.pAggro = 1; }
  }

  private execHunt(): void {
    const t = this.huntTarget;
    if (t && t.alive) {
      this.m.ffaTarget.set(this.player, t.player ? t.player.player : -1);
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
    this.pMove = true; this.pMoveX = this.k.mapCenterX + Math.cos(a) * 6; this.pMoveY = this.k.mapCenterY + Math.sin(a) * 6;
    const f = this.nearestEnemyFighter(this.prof.attackRange + 4);
    if (f && this.recentDps > 0) { this.pFight = f; this.pAggro = 0.6; }
    void e;
  }

  private execPickup(): void {
    const pk = this.nearestPickup();
    if (!pk) { this.execLaneOrPush(); return; }
    this.pMove = true; this.pMoveX = pk.x; this.pMoveY = pk.y;
    this.pAggro = 0.4;
    this.selfDefense();
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

  private huntQuality = 0;
  /** Fray: the weakest reachable enemy, minus third-party risk, with the 2-bots-per-human cap */
  private chooseHunt(lastLife: boolean): Entity | null {
    const e = this.e;
    const myBurst = (t: Entity): number => this.burstOn(t);
    let best: Entity | null = null, bs = -Infinity;
    let leaderScore = 0;
    for (const p of this.w.players) if (p && (p.score ?? 0) > leaderScore) leaderScore = p.score ?? 0;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f) || !f.player) continue;
      const d = Math.sqrt(this.dist2(f, e.x, e.y));
      if (d > 30) continue;
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
      if ((tp.lives ?? 2) <= 1) s += 0.08;
      if (lastLife && kill < 0.8 && f.hp > f.maxHp * 0.4) continue;
      if (s > bs) { bs = s; best = f; }
    }
    this.huntQuality = Math.max(0, bs);
    return best;
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
    let best: Entity | null = null, bp = Infinity;
    for (const st of this.perc.enemyStructs) {
      if (!st.alive || !st.targetable) continue;
      const info = this.m.structInfo(st);
      if (!info) continue;
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
