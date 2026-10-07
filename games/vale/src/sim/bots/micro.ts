// VALE bots — the 30 Hz combat micro layer (base class of every bot controller).
//
// The mode executors (bot.ts) write a PLAN each tick: where to be (pMove), what to fight (pFight),
// which structure to siege (pSiege), whether to farm minions (pFarm 1 = last hits only, 2 = push)
// or monsters (pMonsters), how aggressive ability use may be (pAggro 0..1) and whether diving
// under an enemy tower is allowed (pDive). The micro layer turns the plan into player commands:
//   1. dodge: telegraphed delayed areas, visible enemy skillshots and enemy zones — gated by the
//      bot's sampled reaction delay and its difficulty's dodge chance (rolled once per stimulus);
//      sidesteps out of the shape, or uses an escape ability when walking cannot make it (veteran);
//   2. abilities, battle spells and item actives, driven by each record's AiHint: use tags,
//      minTargets, castWhenSelfHpBelow / castWhenTargetHpBelow, leadTarget (intercept prediction +
//      difficulty aim error), ally-targeted heals/shields by lowest hp;
//   3. attacks: focus target (kiting / orb-walking for ranged styles vs. shorter-ranged targets),
//      structures, monsters, last hits (hp minus damage already in flight before my hit could land:
//      windup + projectile travel + walk, with difficulty timing noise and skipped chances);
//   4. movement, never re-issuing an order that is already running (a fresh move order clears
//      the sim's path), never standing inside an enemy tower's reach without minions tanking it.
// Bots only ever emit Commands — the same surface a human has.

import type { SlotT } from '../../contracts/catalog.ts';
import type { Command, PlayerId, SeatSetup } from '../../contracts/sim.ts';
import { attackable, inAttackRange } from '../attack.ts';
import { mitigated } from '../combat.ts';
import { matchesFilter } from '../effects.ts';
import {
  ORDER_ATTACK, ORDER_ATTACK_MOVE, ORDER_CAST, ORDER_MOVE, ORDER_NONE, SLOT_INDEX, type AbilitySlot, type Entity, type Player,
} from '../entity.ts';
import { inShape } from '../math.ts';
import type { Rng } from '../rng.ts';
import { behaviorOf } from '../units/common.ts';
import type { World } from '../world.ts';
import type { DifficultyProfile } from './difficulty.ts';
import {
  abilityInfo, estimateDamage, U_BUFF, U_CC, U_DAMAGE, U_ENGAGE, U_ESCAPE, U_EXECUTE, U_GAPCLOSE, U_HEAL, U_OFFENSE, U_POKE, U_SHIELD,
  U_SUMMON, U_VISION, U_WAVECLEAR, U_ZONE, type AbilityInfo, type FighterProfile, type Knowledge,
} from './knowledge.ts';
import type { BotMatch } from './match.ts';
import { inTelegraph, type TeamPerc } from './perception.ts';
import type { TeamBrain } from './team.ts';

export type Mode = 'lane' | 'farm' | 'trade' | 'allin' | 'retreat' | 'recall' | 'push' | 'defend' | 'objective' | 'roam'
  | 'teamfight' | 'hunt' | 'pickup' | 'return';

const scratch: Entity[] = [];
const MOVE_EPS = 0.6;

/** ≈ N(0, 1) from three uniforms (deterministic, cheap) */
export function gauss(r: Rng): number { return (r.float() + r.float() + r.float() - 1.5) * 2; }

interface Stimulus { notice: number; dodge: boolean; seen: number }

export abstract class BotBase {
  readonly m: BotMatch;
  readonly k: Knowledge;
  readonly seat: SeatSetup;
  readonly player: PlayerId;
  readonly team: number;
  readonly diff: DifficultyProfile;
  readonly rng: Rng;
  readonly prof: FighterProfile;

  // per-tick context (set by think)
  w!: World;
  p!: Player;
  e!: Entity;
  perc!: TeamPerc;
  brain: TeamBrain | null = null;
  now = 0;
  out: Command[] = [];

  mode: Mode = 'lane';

  // the plan the executor writes every tick
  pMoveX = 0; pMoveY = 0; pMove = false;
  pFight: Entity | null = null;
  pSiege: Entity | null = null;
  pFarm = 0;
  pMonsters = false;
  pMonsterX = 0; pMonsterY = 0;
  pAggro = 0;
  pDive = false;
  /** where safety is (retreat / escape direction) */
  safeX = 0; safeY = 0;

  // perception (reaction-delayed)
  readonly noticed = new Map<number, number>();
  private noticedVer = -1;
  private readonly teleSeen = new Map<number, Stimulus>();
  private readonly projSeen = new Map<number, Stimulus>();
  private stimCleanAt = 0;
  dodgeUntil = -1; dodgeX = 0; dodgeY = 0;

  // command bookkeeping
  nextAbilityAt = 0;
  castLockUntil = 0;
  private lhMissId = -1;
  private lhMissRoll = false;
  private kiteRollAt = -1;
  private kiting = false;
  readonly slotOrder: number[];
  /** last few ticks of own hp (incoming dps estimate) */
  hpAt1s = 0;
  private hpSampleAt = 0;
  recentDps = 0;
  lastWardAt = -1e9;

  constructor(m: BotMatch, seat: SeatSetup, diff: DifficultyProfile, rng: Rng, prof: FighterProfile) {
    this.m = m; this.k = m.k; this.seat = seat; this.player = seat.player; this.team = seat.team;
    this.diff = diff; this.rng = rng; this.prof = prof;
    const order: number[] = [];
    for (const s of prof.combo) { const i = SLOT_INDEX[s as string]; if (i !== undefined && i <= 3 && !order.includes(i)) order.push(i); }
    for (let i = 0; i < 12; i++) if (!order.includes(i)) order.push(i);
    this.slotOrder = order;
  }

  // ── perception helpers ────────────────────────────────────────────────────────────────────────
  reaction(): number { return Math.max(0.03, this.diff.reaction + (this.rng.float() * 2 - 1) * this.diff.reactionJitter); }

  /** refresh which visible enemy fighters this bot has reacted to (each gets its own delay) */
  protected updateNoticed(): void {
    const tp = this.perc;
    if (tp.version === this.noticedVer) return;
    this.noticedVer = tp.version;
    for (const f of tp.enemyFighters) if (!this.noticed.has(f.id)) this.noticed.set(f.id, this.now + this.reaction());
    if (this.noticed.size > tp.enemyFighters.length) {
      for (const id of [...this.noticed.keys()]) {
        const ls = tp.lastSeen.get(id);
        if (!ls || this.now - ls.t > 1.2) this.noticed.delete(id);
      }
    }
  }
  isNoticed(f: Entity): boolean {
    const t = this.noticed.get(f.id);
    return t !== undefined && t <= this.now && f.alive && (f.visibleMask & this.perc.bit) !== 0;
  }

  dist2(a: Entity, x: number, y: number): number { const dx = a.x - x, dy = a.y - y; return dx * dx + dy * dy; }

  /** an alive enemy tower whose reach covers (x, y) (+ margin), or null */
  enemyTowerAt(x: number, y: number, margin: number): Entity | null {
    for (const st of this.perc.enemyStructs) {
      if (!st.alive || !st.attackDef || !st.unit || behaviorOf(st.unit).targetRules !== 'tower' || st.stats.ad <= 0) continue;
      const r = st.stats.range + st.radius + this.e.radius + margin;
      if (this.dist2(st, x, y) <= r * r) return st;
    }
    return null;
  }
  /** own minions inside a tower's reach take its shots */
  minionsTanking(st: Entity): number {
    const r = st.stats.range + st.radius + 0.3;
    let n = 0;
    for (const u of this.perc.allyUnits) if (u.alive && u.kind === 'minion' && this.dist2(u, st.x, st.y) <= r * r) n++;
    return n;
  }
  /** standing at (x, y) is tower-safe: no uncovered enemy tower reaches it */
  towerSafe(x: number, y: number, margin = 0.6): boolean {
    const st = this.enemyTowerAt(x, y, margin);
    if (!st) return true;
    if (st.atkTarget === this.e.id) return false;
    return this.minionsTanking(st) >= 2;
  }

  // ── commands ──────────────────────────────────────────────────────────────────────────────────
  protected moveTo(x: number, y: number, attackMove = false): void {
    const e = this.e, S = this.w.mapDef.size;
    x = Math.max(0.2, Math.min(S[0] - 0.2, x)); y = Math.max(0.2, Math.min(S[1] - 0.2, y));
    const want = attackMove ? ORDER_ATTACK_MOVE : ORDER_MOVE;
    if (e.order === want && Math.abs(e.orderX - x) + Math.abs(e.orderY - y) < MOVE_EPS) return;
    if (e.order === ORDER_NONE && Math.abs(e.x - x) + Math.abs(e.y - y) < 0.35) return;
    if (e.order === ORDER_CAST) return; // walking into range of a cast: let it resolve
    this.out.push(attackMove ? { type: 'move', x, y, attackMove: true } : { type: 'move', x, y });
  }
  protected attack(t: Entity): void {
    const e = this.e;
    if (e.order === ORDER_ATTACK && e.orderTarget === t.id) return;
    if (e.order === ORDER_CAST) return;
    // an attack already winding up on this target finishes on its own
    if (e.order === ORDER_ATTACK_MOVE && e.atkTarget === t.id && e.atkWindup >= 0) return;
    this.out.push({ type: 'attack', target: t.id });
  }

  // ── dodging ───────────────────────────────────────────────────────────────────────────────────
  /** sidestep threats; true while a dodge owns the movement */
  protected dodge(): boolean {
    const e = this.e, now = this.now;
    if (now >= this.stimCleanAt) {
      this.stimCleanAt = now + 3;
      for (const [id, s] of this.teleSeen) if (now - s.seen > 6) this.teleSeen.delete(id);
      for (const [id, s] of this.projSeen) if (now - s.seen > 6) this.projSeen.delete(id);
    }
    if (this.dodgeUntil > now) {
      this.moveTo(this.dodgeX, this.dodgeY);
      return true;
    }
    const ms = Math.max(0.5, e.stats.moveSpeed);
    const myR = e.radius + 0.2;
    // telegraphs (delayed areas)
    for (const t of this.m.telegraphs) {
      if (t.srcTeam === this.team) continue;
      if (t.visibility === 'ally_only' || !this.w.vision.seen(this.team, t.x, t.y)) continue;
      if (!inTelegraph(t, e.x, e.y, myR)) continue;
      let st = this.teleSeen.get(t.id);
      if (!st) { st = { notice: t.at + this.reaction(), dodge: this.rng.chance(this.diff.dodgeChance), seen: now }; this.teleSeen.set(t.id, st); }
      if (!st.dodge || now < st.notice) continue;
      const left = t.resolveAt - now;
      if (left <= 0) continue;
      let ux: number, uy: number, need: number;
      if (t.kind === 'rect' || t.kind === 'cone') {
        const side = -(e.x - t.x) * t.dirY + (e.y - t.y) * t.dirX;
        const sg = side >= 0 ? 1 : -1;
        ux = -t.dirY * sg; uy = t.dirX * sg;
        need = t.kind === 'rect' ? t.width * 0.5 + myR - Math.abs(side) + 0.3 : Math.max(1, t.radius * Math.sin(t.half) + myR - Math.abs(side));
      } else {
        const dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy);
        if (d < 0.05) { const a = this.rng.float() * Math.PI * 2; ux = Math.cos(a); uy = Math.sin(a); } else { ux = dx / d; uy = dy / d; }
        need = t.radius + myR + 0.3 - d;
      }
      if (need <= 0) continue;
      if (this.startDodge(ux, uy, need, left, ms, t.resolveAt + 0.05)) return true;
    }
    // skillshots in flight
    for (const h of this.perc.hazards) {
      if (h.kind === 'projectile') {
        const pd = h.proj;
        if (!pd || pd.returning) continue;
        const rx = e.x - h.x, ry = e.y - h.y;
        const along = rx * pd.dirX + ry * pd.dirY;
        const remaining = pd.range - pd.traveled;
        if (along < -myR || along > remaining + myR || along > 14) continue;
        const perp = -rx * pd.dirY + ry * pd.dirX;
        const half = pd.width * 0.5 + myR;
        if (Math.abs(perp) > half) continue;
        let st = this.projSeen.get(h.id);
        if (!st) { st = { notice: now + this.reaction(), dodge: this.rng.chance(this.diff.dodgeChance), seen: now }; this.projSeen.set(h.id, st); }
        if (!st.dodge || now < st.notice) continue;
        const tti = Math.max(0, along) / Math.max(1, pd.speed);
        const sg = perp >= 0 ? 1 : -1;
        if (this.startDodge(-pd.dirY * sg, pd.dirX * sg, half - Math.abs(perp) + 0.25, tti, ms, now + tti + 0.1)) return true;
      } else if (h.kind === 'zone' && h.zone && h.zone.active) {
        const zd = h.zone;
        if (!inShape(zd.shape, e.x, e.y, e.radius, h.x, h.y, zd.dirX, zd.dirY)) continue;
        const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
        const reach = h.radius + myR + 0.4 - d;
        if (reach > 0) { this.dodgeX = e.x + (dx / d) * reach; this.dodgeY = e.y + (dy / d) * reach; this.dodgeUntil = now + Math.min(1, reach / ms + 0.1); this.moveTo(this.dodgeX, this.dodgeY); return true; }
      }
    }
    return false;
  }

  private startDodge(ux: number, uy: number, need: number, left: number, ms: number, until: number): boolean {
    const e = this.e, w = this.w;
    let tx = e.x + ux * (need + 0.2), ty = e.y + uy * (need + 0.2);
    if (!w.nav.walkable(tx, ty)) { tx = e.x - ux * (need + 0.2); ty = e.y - uy * (need + 0.2); if (!w.nav.walkable(tx, ty)) return false; }
    // walking will not make it: a sharp bot burns an escape
    if (need / ms > left && this.diff.dodgeChance >= 0.8 && this.escapeTo(tx, ty, need)) return true;
    if (e.cast && e.cast.phase === 'windup' && !e.cast.def.canMoveWhileCasting && e.cast.dur - e.cast.t > left) return false;
    this.dodgeX = tx; this.dodgeY = ty; this.dodgeUntil = until;
    this.moveTo(tx, ty);
    return true;
  }

  /** cast an escape (dash/blink/haste) toward (x, y); true if issued */
  protected escapeTo(x: number, y: number, minDist: number): boolean {
    const e = this.e;
    if (e.cast || e.dash || this.now < this.castLockUntil) return false;
    for (const si of this.slotOrder) {
      const s = e.slots[si];
      if (!s || !s.ready) continue;
      const info = abilityInfo(s.def);
      if (!(info.use & U_ESCAPE)) continue;
      const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1;
      if (info.delivery === 'dash' || info.delivery === 'blink') {
        const reach = Math.max(info.dashDist, info.blinkDist, info.range);
        if (reach < minDist) continue;
        const r = Math.min(reach, Math.max(minDist + 0.5, reach));
        const tx = e.x + (dx / d) * r, ty = e.y + (dy / d) * r;
        this.cast(s, info, null, tx, ty);
        return true;
      }
      if (info.tk === 'self' || info.tk === 'none') { this.cast(s, info, null, e.x, e.y); return true; }
    }
    return false;
  }

  // ── casting ───────────────────────────────────────────────────────────────────────────────────
  protected cast(s: AbilitySlot, info: AbilityInfo, target: Entity | null, x: number, y: number): void {
    const slot = s.slot as SlotT;
    let c: Command;
    switch (info.tk) {
      case 'unit': c = { type: 'cast', slot, target: target ? target.id : this.e.id }; break;
      case 'point': case 'direction': c = { type: 'cast', slot, x, y }; break;
      default: c = { type: 'cast', slot }; break;
    }
    this.out.push(c);
    this.castLockUntil = this.now + 0.2 + info.castTime;
  }

  /** aim point for a skillshot/area at `t` (lead by intercept, scaled by skill, plus aim error) */
  protected aim(t: Entity, info: AbilityInfo, out: { x: number; y: number }): void {
    const e = this.e;
    let px = t.x, py = t.y;
    if (info.lead && (t.vx !== 0 || t.vy !== 0)) {
      const delay = info.castTime + (info.delivery === 'area' || info.delivery === 'zone' ? info.delay : 0);
      let tx = t.x + t.vx * delay, ty = t.y + t.vy * delay;
      if (info.delivery === 'projectile' && info.projSpeed > 0) {
        const dx = tx - e.x, dy = ty - e.y, s = info.projSpeed;
        const a = t.vx * t.vx + t.vy * t.vy - s * s, b = 2 * (dx * t.vx + dy * t.vy), c = dx * dx + dy * dy;
        let T = -1;
        if (Math.abs(a) < 1e-6) T = b < 0 ? -c / b : -1;
        else {
          const disc = b * b - 4 * a * c;
          if (disc >= 0) {
            const sq = Math.sqrt(disc), t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
            T = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
          }
        }
        if (T > 0 && T < 3) { tx += t.vx * T; ty += t.vy * T; }
      }
      const k = this.diff.leadSkill;
      px = t.x + (tx - t.x) * k; py = t.y + (ty - t.y) * k;
    }
    // heading error
    const err = gauss(this.rng) * this.diff.aimErrorDeg * Math.PI / 180;
    if (err !== 0) {
      const dx = px - e.x, dy = py - e.y, c = Math.cos(err), s = Math.sin(err);
      px = e.x + dx * c - dy * s; py = e.y + dx * s + dy * c;
    }
    out.x = px; out.y = py;
  }

  /** count enemies (fighters only, or every unit) whose bodies touch a circle */
  protected countIn(x: number, y: number, r: number, fightersOnly: boolean, monsters: boolean): number {
    let n = 0;
    const tp = this.perc;
    for (const f of tp.enemyFighters) if (f.alive && this.dist2(f, x, y) <= (r + f.radius) ** 2) n++;
    if (!fightersOnly) {
      for (const u of tp.enemyUnits) if (u.alive && this.dist2(u, x, y) <= (r + u.radius) ** 2) n++;
      if (monsters) for (const u of tp.monsters) if (u.alive && this.dist2(u, x, y) <= (r + u.radius) ** 2) n++;
    }
    return n;
  }
  protected alliesIn(x: number, y: number, r: number, below: number): number {
    let n = 0;
    for (const f of this.perc.allyFighters) if (f.alive && f.hp / f.maxHp < below && this.dist2(f, x, y) <= (r + f.radius) ** 2) n++;
    return n;
  }

  /** the best noticed enemy fighter within `reach` (focus target first) */
  protected fighterInReach(reach: number): Entity | null {
    const e = this.e;
    const f = this.pFight;
    if (f && f.kind === 'fighter' && this.isNoticed(f) && this.dist2(f, e.x, e.y) <= (reach + f.radius) ** 2) return f;
    let best: Entity | null = null, bestS = Infinity;
    for (const g of this.perc.enemyFighters) {
      if (!this.isNoticed(g)) continue;
      const d2 = this.dist2(g, e.x, e.y);
      if (d2 > (reach + g.radius) ** 2) continue;
      const s = (g.hp + g.shield) + Math.sqrt(d2) * 30;
      if (s < bestS) { bestS = s; best = g; }
    }
    return best;
  }

  private readonly aimOut = { x: 0, y: 0 };

  /** ability / spell / item use for this tick; true if a cast was issued */
  protected useAbilities(): boolean {
    const e = this.e, now = this.now;
    if (now < this.nextAbilityAt || now < this.castLockUntil || e.cast || e.dash || e.order === ORDER_CAST) return false;
    this.nextAbilityAt = now + this.diff.abilityEvery;
    const hpF = e.hp / Math.max(1, e.maxHp);
    for (const si of this.slotOrder) {
      const s = e.slots[si];
      if (!s || !s.ready) continue;
      const info = abilityInfo(s.def);
      if (info.selfHpBelow <= 1 && hpF >= info.selfHpBelow) continue;
      if (this.tryCast(s, info, hpF)) return true;
    }
    return false;
  }

  private tryCast(s: AbilitySlot, info: AbilityInfo, hpF: number): boolean {
    const e = this.e, u = info.use;
    const res = e.resource;
    const resF = res && res.model === 'pool' && e.maxRes > 0 ? e.res / e.maxRes : 1;
    const threatened = this.recentDps > 0 || this.nearestEnemyFighter(9) !== null;
    // support: heals and shields
    if (u & (U_HEAL | U_SHIELD)) {
      if (info.allyUnit) {
        const gate = info.targetHpBelow <= 1 ? info.targetHpBelow : 0.6;
        let best: Entity | null = null, bestF = gate;
        for (const f of this.perc.allyFighters) {
          if (!f.alive || (f === e && !info.filter?.self)) continue;
          const fF = f.hp / f.maxHp;
          if (fF >= bestF || this.dist2(f, e.x, e.y) > (info.range + f.radius + 0.5) ** 2) continue;
          if (!matchesFilter(this.w, e, f, info.filter)) continue;
          bestF = fF; best = f;
        }
        if (best) { this.cast(s, info, best, best.x, best.y); return true; }
      } else if (info.affectsAllies) {
        const n = this.alliesIn(e.x, e.y, Math.max(info.radius, info.range), 0.65);
        if (n >= Math.max(1, info.minTargets)) { this.cast(s, info, e, e.x, e.y); return true; }
      } else if (!(u & U_OFFENSE) || info.dmg.length === 0) {
        const gate = info.selfHpBelow <= 1 ? 1 : (u & U_SHIELD) ? 0.7 : 0.55;
        if (hpF < gate && (threatened || hpF < 0.4)) { this.cast(s, info, e, e.x, e.y); return true; }
        if (!(u & ~(U_HEAL | U_SHIELD))) return false;
      }
    }
    // escapes while running
    if ((u & U_ESCAPE) && !(u & U_OFFENSE & ~U_DAMAGE) && (this.mode === 'retreat' || (hpF < 0.25 && threatened))) {
      const chaser = this.nearestEnemyFighter(7);
      if (chaser || this.mode === 'retreat') {
        const dx = this.safeX - e.x, dy = this.safeY - e.y, d = Math.hypot(dx, dy) || 1;
        const reach = Math.max(info.dashDist, info.blinkDist, info.range, 3);
        if (info.tk === 'self' || info.tk === 'none') { this.cast(s, info, e, e.x, e.y); return true; }
        if (d > 3 && chaser) { this.cast(s, info, null, e.x + (dx / d) * reach, e.y + (dy / d) * reach); return true; }
      }
      if (!(u & (U_OFFENSE | U_GAPCLOSE | U_BUFF))) return false;
    }
    // self buffs while trading blows
    if ((u & U_BUFF) && !(u & (U_OFFENSE & ~U_ENGAGE)) && (info.tk === 'self' || info.tk === 'none')) {
      const t = this.pFight ?? this.pSiege;
      if (t && t.alive && inAttackRange(e, t) && (t.kind === 'fighter' ? this.pAggro >= 0.5 : this.pFarm === 2 || this.pMonsters || t === this.pSiege)) {
        this.cast(s, info, e, e.x, e.y); return true;
      }
      if (!(u & (U_OFFENSE | U_GAPCLOSE))) return false;
    }
    if (u & U_SUMMON) {
      const t = this.pFight ?? (this.pMonsters ? this.nearestMonster(6) : null);
      if (t && this.dist2(t, e.x, e.y) <= 64) { this.cast(s, info, t, t.x, t.y); return true; }
    }
    if (u & U_VISION) {
      if (this.now - this.lastWardAt > 45 && (this.mode === 'lane' || this.mode === 'push' || this.mode === 'objective' || this.mode === 'farm')) {
        const spot = this.wardSpot(info.range);
        if (spot) { this.lastWardAt = this.now; this.cast(s, info, null, spot.x, spot.y); return true; }
      }
      return false;
    }
    if (!(u & (U_OFFENSE | U_GAPCLOSE | U_WAVECLEAR))) return false;
    // ── offense ──
    const reach = Math.max(info.reach, 1.5);
    const ft = this.pAggro >= 0.3 || this.mode === 'retreat' ? this.fighterInReach(reach + ((u & (U_GAPCLOSE | U_ENGAGE)) ? 1 : 0)) : null;
    if (ft && matchesFilter(this.w, e, ft, info.tk === 'unit' ? info.filter : undefined)) {
      if (this.offensiveOn(s, info, ft, hpF)) return true;
    }
    // minions / monsters / structures
    if ((u & (U_WAVECLEAR | U_DAMAGE | U_EXECUTE)) && (this.pFarm === 2 || this.pMonsters)) {
      if (resF < 0.3 && !(u & U_EXECUTE) && (info.def.cost as number) !== 0) return false;
      return this.farmCast(s, info);
    }
    return false;
  }

  private offensiveOn(s: AbilitySlot, info: AbilityInfo, t: Entity, hpF: number): boolean {
    const e = this.e, u = info.use;
    const tF = (t.hp + t.shield) / Math.max(1, t.maxHp);
    if (info.targetHpBelow <= 1 && tF >= info.targetHpBelow) return false;
    const d = Math.sqrt(this.dist2(t, e.x, e.y));
    const ag = this.pAggro;
    const rank = Math.max(1, s.rank);
    const dmg = info.dmg.length ? estimateDamage(info, e, rank, t) : 0;
    const pureExecute = (u & U_EXECUTE) && !(u & (U_DAMAGE | U_POKE | U_CC | U_ENGAGE | U_ZONE));
    if (pureExecute && dmg < (t.hp + t.shield) * 0.9 && !(info.targetHpBelow <= 1)) return false;
    let ok = false;
    if ((u & U_EXECUTE) && dmg >= (t.hp + t.shield) * 0.9) ok = true;
    if ((u & (U_ENGAGE | U_GAPCLOSE)) && ag >= 0.7 && d > this.prof.attackRange + e.radius + t.radius + 0.5) {
      if (this.pDive || this.towerSafe(t.x, t.y, 0)) ok = true;
    }
    if ((u & U_CC) && (ag >= 0.5 || this.mode === 'retreat')) ok = true;
    if ((u & U_POKE) && ag >= 0.3) ok = true;
    if ((u & (U_DAMAGE | U_ZONE)) && ag >= 0.5) ok = true;
    if (!ok) return false;
    // geometry + minTargets
    const o = this.aimOut;
    switch (info.tk) {
      case 'unit': {
        if (d > info.range + t.radius + ((u & U_GAPCLOSE) ? 1.5 : 0.1)) return false;
        this.cast(s, info, t, t.x, t.y);
        return true;
      }
      case 'point': case 'direction': {
        this.aim(t, info, o);
        const dx = o.x - e.x, dy = o.y - e.y, dd = Math.hypot(dx, dy) || 1;
        if (info.delivery === 'projectile') {
          if (dd > info.projRange + t.radius * 0.5) return false;
        } else if (info.delivery === 'dash' || info.delivery === 'blink') {
          if (dd > info.reach + 0.5) return false;
          if (dd > info.range && info.range > 0) { o.x = e.x + (dx / dd) * info.range; o.y = e.y + (dy / dd) * info.range; }
        } else if (info.tk === 'point' && info.range > 0 && dd > info.range) {
          if (dd > info.range + info.radius * 0.7) return false;
          o.x = e.x + (dx / dd) * info.range; o.y = e.y + (dy / dd) * info.range;
        }
        if (info.minTargets > 1 && info.radius > 0) {
          const cx = info.areaAt === 'self' ? e.x : o.x, cy = info.areaAt === 'self' ? e.y : o.y;
          if (this.countIn(cx, cy, info.radius, true, false) < info.minTargets) return false;
        }
        this.cast(s, info, t, o.x, o.y);
        return true;
      }
      default: {
        // self-anchored areas (and none-targeted effects): the target must be inside
        const r = info.radius > 0 ? info.radius : info.reach;
        if (d > r + t.radius * 0.8) return false;
        if (info.minTargets > 1 && this.countIn(e.x, e.y, r, true, false) < info.minTargets) return false;
        this.cast(s, info, t, e.x, e.y);
        return true;
      }
    }
  }

  private farmCast(s: AbilitySlot, info: AbilityInfo): boolean {
    const e = this.e;
    const monsters = this.pMonsters;
    const target = monsters ? this.nearestMonster(Math.max(info.reach, 3)) : this.bestUnitInReach(Math.max(info.reach, 2));
    if (!target) return false;
    if (info.tk === 'unit' && !matchesFilter(this.w, e, target, info.filter)) return false;
    const u = info.use;
    // a pure execute (smite) waits for the killing blow
    if ((u & U_EXECUTE) && !(u & (U_DAMAGE | U_WAVECLEAR))) {
      const dmg = estimateDamage(info, e, Math.max(1, s.rank), target);
      if (dmg < target.hp + target.shield) return false;
      if (target.kind !== 'monster' || !(target.unit?.onTakedownTeamBuff || target.maxHp >= 1500)) {
        if (target.kind !== 'monster') return false;
      }
    }
    const need = info.minTargets > 0 ? info.minTargets : monsters ? 1 : (u & U_WAVECLEAR) ? 2 : 3;
    const o = this.aimOut;
    o.x = target.x; o.y = target.y;
    const d = Math.sqrt(this.dist2(target, e.x, e.y));
    switch (info.tk) {
      case 'unit': if (d > info.range + target.radius) return false; break;
      case 'point': case 'direction':
        if (info.delivery === 'dash' || info.delivery === 'blink') return false; // never dash into a wave for farm
        if (info.delivery === 'projectile' ? d > info.projRange : d > info.range + 0.1 && info.range > 0) return false;
        break;
      default: if (d > Math.max(info.radius, 1.5) + target.radius) return false;
    }
    if (info.radius > 0) {
      const cx = info.areaAt === 'self' || info.tk === 'none' || info.tk === 'self' ? e.x : o.x, cy = info.areaAt === 'self' || info.tk === 'none' || info.tk === 'self' ? e.y : o.y;
      if (this.countIn(cx, cy, info.radius, false, monsters) < need) return false;
    } else if (!monsters && need > 1 && !(u & U_EXECUTE)) return false;
    this.cast(s, info, target, o.x, o.y);
    return true;
  }

  protected nearestEnemyFighter(r: number): Entity | null {
    const e = this.e;
    let best: Entity | null = null, bd = r * r;
    for (const f of this.perc.enemyFighters) {
      if (!this.isNoticed(f)) continue;
      const d2 = this.dist2(f, e.x, e.y);
      if (d2 < bd) { bd = d2; best = f; }
    }
    return best;
  }
  protected nearestMonster(r: number): Entity | null {
    const e = this.e;
    let best: Entity | null = null, bs = Infinity;
    const cx = this.pMonsters ? this.pMonsterX : e.x, cy = this.pMonsters ? this.pMonsterY : e.y;
    for (const m of this.perc.monsters) {
      if (!m.alive || !m.targetable || this.dist2(m, cx, cy) > 100) continue;
      const d2 = this.dist2(m, e.x, e.y);
      if (d2 > (r + m.radius) * (r + m.radius) + 16) continue;
      const s = m.hp + d2 * 20;
      if (s < bs) { bs = s; best = m; }
    }
    return best;
  }
  protected bestUnitInReach(r: number): Entity | null {
    const e = this.e;
    let best: Entity | null = null, bs = Infinity;
    for (const u of this.perc.enemyUnits) {
      if (!u.alive) continue;
      const d2 = this.dist2(u, e.x, e.y);
      if (d2 > (r + u.radius) ** 2) continue;
      if (d2 < bs) { bs = d2; best = u; }
    }
    return best;
  }

  private wardSpot(range: number): { x: number; y: number } | null {
    const e = this.e, map = this.k.map;
    let best: { x: number; y: number } | null = null, bd = (range + 4) ** 2;
    for (const poly of map.thickets) {
      let cx = 0, cy = 0;
      for (const pt of poly) { cx += pt[0]; cy += pt[1]; }
      cx /= poly.length; cy /= poly.length;
      const d2 = this.dist2(e, cx, cy);
      if (d2 > bd) continue;
      let warded = false;
      for (const u of this.perc.allyUnits) if (u.kind === 'ward' && this.dist2(u, cx, cy) < 25) { warded = true; break; }
      if (warded) continue;
      bd = d2; best = { x: cx, y: cy };
    }
    if (!best) return null;
    const d = Math.sqrt(bd);
    if (d > range) { const k = range / d; best = { x: e.x + (best.x - e.x) * k, y: e.y + (best.y - e.y) * k }; }
    return best;
  }

  // ── last hits ─────────────────────────────────────────────────────────────────────────────────
  /** the enemy minion my next attack should kill (or null); `waitOut` gets one worth staying near */
  protected lastHitTarget(): Entity | null {
    const e = this.e, w = this.w;
    const ad = e.attackDef;
    if (!ad) return null;
    this.m.incoming.build(w);
    const range = e.stats.range;
    const n = w.query(e.x, e.y, range + e.radius + 6, scratch);
    const period = 1 / Math.max(0.05, e.stats.attackSpeed);
    const windup = ad.windup * period;
    const ms = Math.max(0.5, e.stats.moveSpeed);
    const bit = this.perc.bit;
    let best: Entity | null = null, bestHp = Infinity;
    for (let i = 0; i < n; i++) {
      const c = scratch[i];
      if (c.kind !== 'minion' && c.kind !== 'summon') continue;
      if (!attackable(w, e, c)) continue;
      const dist = Math.sqrt(this.dist2(c, e.x, e.y));
      const gap = Math.max(0, dist - c.radius - e.radius - range);
      const flight = ad.projectileSpeed ? Math.max(0, dist - gap - c.radius) / ad.projectileSpeed : 0;
      const busy = e.atkWindup >= 0 ? e.atkWindup + period * (1 - ad.windup) : Math.max(0, e.atkCd);
      const tImpact = Math.max(busy, gap / ms) + windup + flight;
      const noisy = Math.max(0, tImpact + gauss(this.rng) * this.diff.lastHitSigma);
      const hpAt = c.hp - this.m.incoming.before(c.id, noisy, bit, false);
      if (hpAt <= 0) continue;
      const dmg = mitigated(e, c, e.stats.ad, ad.damageType);
      if (hpAt > dmg * 0.97) continue;
      if (hpAt < bestHp) { bestHp = hpAt; best = c; }
    }
    if (best && best.id !== this.lhMissId) { this.lhMissId = best.id; this.lhMissRoll = this.rng.chance(this.diff.lastHitMiss); }
    if (best && this.lhMissRoll) return null;
    return best;
  }

  /** a minion that will be last-hittable soon (stand near it); null if none */
  protected lastHitSoon(): Entity | null {
    const e = this.e, w = this.w, ad = e.attackDef;
    if (!ad) return null;
    const n = w.query(e.x, e.y, e.stats.range + 7, scratch);
    const bit = this.perc.bit;
    let best: Entity | null = null, bestS = Infinity;
    for (let i = 0; i < n; i++) {
      const c = scratch[i];
      if (c.kind !== 'minion' || !attackable(w, e, c)) continue;
      const dmg = mitigated(e, c, e.stats.ad, ad.damageType);
      const left = c.hp - this.m.incoming.before(c.id, 2.0, bit, true);
      if (left > dmg * 1.6) continue;
      const s = left + Math.sqrt(this.dist2(c, e.x, e.y)) * 10;
      if (s < bestS) { bestS = s; best = c; }
    }
    return best;
  }

  /** lowest-hp enemy minion within reach (wave pushing) */
  protected pushTarget(): Entity | null {
    const e = this.e;
    const r = e.stats.range + e.radius + 4;
    let best: Entity | null = null, bs = Infinity;
    for (const u of this.perc.enemyUnits) {
      if (!u.alive || !u.targetable) continue;
      const d2 = this.dist2(u, e.x, e.y);
      if (d2 > (r + u.radius) ** 2) continue;
      const s = u.hp + Math.sqrt(d2) * 25;
      if (s < bs) { bs = s; best = u; }
    }
    return best;
  }

  // ── acting on the plan ────────────────────────────────────────────────────────────────────────
  protected act(): void {
    const e = this.e, w = this.w;
    // 1. dodge owns movement
    const dodging = this.dodge();
    // 2. abilities
    if (this.useAbilities() || dodging) return;
    // 3. fight
    const f = this.pFight;
    if (f && f.alive && attackable(w, e, f)) {
      const towerOk = this.pDive || f.kind !== 'fighter' || this.towerSafe(f.x, f.y, 0.2) || inAttackRange(e, f);
      if (towerOk) { this.fightTarget(f); return; }
    }
    // 4. siege
    const sg = this.pSiege;
    if (sg && sg.alive && sg.targetable && attackable(w, e, sg)) {
      // last hits still come first while the wave is at the tower
      if (this.pFarm > 0) { const lh = this.lastHitTarget(); if (lh) { this.attack(lh); return; } }
      this.attack(sg);
      return;
    }
    // 5. monsters
    if (this.pMonsters) {
      const m = this.nearestMonster(8);
      if (m) { this.attack(m); return; }
    }
    // 6. minions
    if (this.pFarm > 0) {
      const lh = this.lastHitTarget();
      if (lh) {
        if (e.atkWindup >= 0 && e.atkTarget !== lh.id && e.atkWindup < 0.08) return; // let a near-done swing land
        this.attack(lh);
        return;
      }
      if (this.pFarm === 2) {
        const t = this.pushTarget();
        if (t) { this.attack(t); return; }
      } else if (e.atkWindup >= 0 && (e.order === ORDER_ATTACK || e.order === ORDER_NONE)) {
        return; // finish the swing in progress
      } else {
        const soon = this.lastHitSoon();
        if (soon) {
          // drift into range of it, but stay where the plan says otherwise
          const r = e.stats.range + e.radius + soon.radius - 0.3;
          const dx = e.x - soon.x, dy = e.y - soon.y, d = Math.hypot(dx, dy) || 1;
          if (d > r + 0.6 && this.towerSafe(soon.x, soon.y, 0)) { this.moveTo(soon.x + (dx / d) * r, soon.y + (dy / d) * r); return; }
        }
      }
    }
    // 7. movement
    if (this.pMove) {
      const dx = this.pMoveX - e.x, dy = this.pMoveY - e.y;
      if (dx * dx + dy * dy > 0.8 || e.order === ORDER_ATTACK || e.order === ORDER_ATTACK_MOVE) this.moveTo(this.pMoveX, this.pMoveY);
    }
  }

  /** attack a fight target; ranged styles orb-walk away from shorter-ranged targets */
  private fightTarget(f: Entity): void {
    const e = this.e;
    if (this.prof.ranged && f.kind === 'fighter' && f.attackDef && f.stats.range + 0.8 < e.stats.range) {
      if (this.now - this.kiteRollAt > 4) { this.kiteRollAt = this.now; this.kiting = this.rng.chance(this.diff.kiteSkill); }
      if (this.kiting && inAttackRange(e, f)) {
        if (e.atkWindup >= 0) return;                        // never cancel the swing
        const period = 1 / Math.max(0.05, e.stats.attackSpeed);
        if (e.atkCd > period * 0.35) {
          const dx = e.x - f.x, dy = e.y - f.y, d = Math.hypot(dx, dy) || 1;
          const comfy = e.stats.range + e.radius + f.radius - 0.4;
          if (d < comfy) {
            const tx = e.x + (dx / d) * 1.6, ty = e.y + (dy / d) * 1.6;
            if (this.w.nav.walkable(tx, ty)) { this.moveTo(tx, ty); return; }
          }
          return;
        }
      }
    }
    this.attack(f);
  }

  /** incoming dps estimate from own hp loss over the last second */
  protected sampleHp(): void {
    if (this.now >= this.hpSampleAt) {
      const e = this.e;
      this.recentDps = Math.max(0, this.hpAt1s - e.hp);
      this.hpAt1s = e.hp;
      this.hpSampleAt = this.now + 1;
    }
  }
}
