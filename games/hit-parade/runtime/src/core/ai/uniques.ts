// HIT PARADE - how the CPU plays each fighter's UNIQUE (lane AI P2, CONTRACT §28.2 uniques, §23.10). THREE-free.
//
// Every tool below changes WHAT the CPU does with information it honestly has (a reaction it earned on the reaction
// clock, a habit it saw - habits.ts, its own state, the visible opponent), never how fast it knows it:
//   counter   (Rerun PLAY DEAD / DEAD AIR, Ricky COMMERCIAL BREAK) - a reacted strike or projectile arriving inside the
//             catch window; a READ vs a presser in range, on my wake-up vs a meaty habit, after my blockstun vs a
//             frame-trap habit (the catch then starts the sim's follow-up by itself)
//   teleport  (Zambini VANISH) - cornered: behind (side switch); crowded: home; a reacted projectile: behind (through
//             it, invulnerable) into a punish; the opponent's wake-up: a behind / front mixup
//   stance    (Lotus SWAY) - enter at follow-up range, walk the stance in, then the follow-up the opponent's posture
//             loses to (crouching -> M overhead, standing -> L low, a low-happy opponent -> H hop); exit / timeout
//   evade     (Johnny WEAVE, Gazza SIMULATION dive) - under a reacted high projectile / high strike, then WEAVE ->
//             counter hook (trigger) when it reaches, DIVE -> a special cancel when it reaches
//   step      (Bruno BRACE, Boneyard BUTCHER'S BLOCK) - armored step as a read vs a presser / an approach, then in its
//             cancel window: command grab in range, else the 2L tick (§28.2 tickStr) or a special that connects
//   ball      (Gazza) - shoot / keepy only with the ball available (at his feet, or a hover / resting / loose ball in
//             kick range), re-kick (volley) a hovering ball, walk to a resting ball to trap it
//   rekka     (Patch CUE 1 -> CUE 2 -> CUE 3 overhead / low) - continued on contact, the ender picked from the
//             opponent's visible posture
//   install   (none of the kits yet, §28.2) - started at a safe distance / during the opponent's knockdown
//   phases    (Ricky) - the phase-2 recipe table (kit.ts) + phase-2 zoning (PYRO) - boss.ts
// Rates live in data/cpu.json `uniques` (per tool) x the level's `habit` weight where a read is involved.

import { ST } from '../sim/layout.ts';
import { BALL } from '../sim/layout.ts';
import type { CMove } from '../sim/compile.ts';
import type { Brain, Decision } from './brain.ts';
import type { MoveInfo } from './kit.ts';
import type { ProjView } from './sense.ts';
import { B } from './pad.ts';
import type { Step } from './pad.ts';

type Obj = Record<string, unknown>;

export interface UniqueRates {
  /** chance a reacted strike that a counter move can catch is answered with it (x style.counter weight 1) */
  counterReact: number;
  /** chance per neutral decision to counter-read a presser in range (x habit weight x attack rate) */
  counterRead: number;
  /** counter read on my wake-up (x wakeRate) / after my blockstun (x pressureRate) */
  counterWake: number;
  counterBlock: number;
  /** a reacted projectile answered with a counter that catches projectiles (DEAD AIR) */
  counterProj: number;
  teleCorner: number;
  teleCrowd: number;
  teleProj: number;
  teleWake: number;
  stanceUse: number;
  evadeProj: number;
  evadeHigh: number;
  stepRead: number;
  stepApproach: number;
  ballRekick: number;
  ballPickup: number;
  rekkaBlock: number;
  install: number;
}

export const DEFAULT_UNIQUE_RATES: UniqueRates = {
  counterReact: 0.6, counterRead: 0.35, counterWake: 0.3, counterBlock: 0.3, counterProj: 0.5,
  teleCorner: 0.45, teleCrowd: 0.25, teleProj: 0.35, teleWake: 0.3,
  stanceUse: 0.45, evadeProj: 0.45, evadeHigh: 0.3,
  stepRead: 0.45, stepApproach: 0.25,
  ballRekick: 0.7, ballPickup: 0.8,
  rekkaBlock: 0.5, install: 0.5,
};

export function uniqueRates(o: unknown): UniqueRates {
  const r: UniqueRates = { ...DEFAULT_UNIQUE_RATES };
  if (typeof o !== 'object' || o === null) return r;
  for (const k of Object.keys(r) as (keyof UniqueRates)[]) {
    const v = (o as Obj)[k];
    if (typeof v === 'number' && Number.isFinite(v)) r[k] = v;
  }
  return r;
}

const M = 100000;

/** usable tool moves of a kind (recipe measured, usable now), cheapest first */
function toolsOf(b: Brain, kind: string): number[] {
  return (b.kit.tools[kind] ?? []).filter((k) => b.canUse(k));
}

/** the latest frame (from now) on which an incoming strike threat `cm` (seen at its move frame `mvF`) is active */
function activeSpan(cm: CMove, mvF: number): [number, number] {
  // frames from now until its first / last active frame (the CPU knows the move's frame data like a player does)
  return [cm.startup - mvF, cm.lastActive - mvF];
}

/** lowest point (U, above the floor) of the strike boxes of `cm` (for "is it a HIGH attack" checks) */
function lowestBox(cm: CMove): number {
  let lo = 1 << 30;
  for (let k = 0; k < cm.nBox; k++) lo = Math.min(lo, cm.boxes[k * 7 + 3] - (cm.boxes[k * 7 + 5] >> 1) + (cm.yCurve ? cm.yCurve[Math.min(cm.boxes[k * 7], cm.yCurve.length - 1)] : 0));
  return cm.nBox > 0 ? lo : 0;
}

export class UniqueTools {
  readonly r: UniqueRates;
  /** the tool move started by this planner that busy() is driving (-1 none) and its instance */
  private drive = -1;
  private driveInst = -1;
  private stanceGoal = -1; // the follow-up the stance is walking in for
  private stanceKey = -1;

  constructor(rates: UniqueRates) {
    this.r = rates;
  }

  resetRound(): void {
    this.drive = -1;
    this.driveInst = -1;
    this.stanceGoal = -1;
    this.stanceKey = -1;
  }

  // ------------------------------------------------------------------ availability (ball)
  /** extra usability rule of unique moves (the ball must be available for a shoot / keepy) */
  canUse(b: Brain, mi: MoveInfo): boolean {
    if (mi.tool === 'ballShoot' || mi.tool === 'ballHover') return this.ballReady(b);
    if (mi.phase2 && b.kit.phase !== 2) return false;
    return true;
  }

  /** mirrors core/sim/projectiles.ts ballReady from what the CPU sees of its OWN ball (u0 state, the ball on screen) */
  ballReady(b: Brain): boolean {
    const me = b.seen.me;
    const st = me.uq[0];
    if (st === BALL.FEET) return true;
    if (st !== BALL.HOVER && st !== BALL.REST && st !== BALL.LOOSE) return false;
    const p = this.myBall(b);
    if (!p) return false;
    const u = me.cf.u;
    const dxF = (p.x - me.x) * me.facing;
    // CHANGED(AI3D): + the sim's sideways rule (within kickRange / 2 of his forward line - §35.13 item 9); p.lat is off the
    // fight line, which is his forward while he faces the opponent
    return dxF >= -u.kickBack && dxF <= u.kickRange && Math.abs(p.lat) <= u.kickRange >> 1;
  }

  private myBall(b: Brain): ProjView | null {
    const s = b.seen;
    for (let k = 0; k < s.nProj; k++) {
      const p = s.proj[k];
      if (p.owner === b.i && p.kind === 1) return p;
    }
    return null;
  }

  // ------------------------------------------------------------------ reactions (called on the reaction clock)
  /** a reacted STRIKE `cm` at its move frame `mvF` (latched roll `roll`): a unique answer (move index) or -1 */
  react(b: Brain, cm: CMove, mvF: number, roll: number): number {
    const [a0, a1] = activeSpan(cm, mvF);
    if (a1 < 0 || cm.isGrab) return -1;
    // counter: the hit must arrive inside the catch window
    if (b.style.counter > 0 || b.kit.tools.counter) {
      if (roll < this.r.counterReact * Math.max(0.5, b.style.counter * 2)) {
        for (const k of toolsOf(b, 'counter')) {
          const mi = b.kit.moves[k];
          const c = mi.counter!;
          const lag = b.rcpLag(k);
          if (a0 >= lag + c.f0 - 1 && a0 <= lag + c.f1 - 1) return k;
        }
      }
    }
    // evade a HIGH strike (every box above my evade hurtbox) with a low-profile move whose window covers it
    if (roll < this.r.evadeHigh) {
      const lo = lowestBox(cm);
      for (const k of toolsOf(b, 'evade').concat(toolsOf(b, 'stance'))) {
        const mi = b.kit.moves[k];
        if (mi.evadeTop <= 0 || lo <= mi.evadeTop + 5000) continue;
        const lag = b.rcpLag(k);
        if (a0 >= lag + mi.evadeF0 - 1 && a1 <= lag + mi.evadeF1 - 1) return k;
      }
    }
    return -1;
  }

  /**
   * A reacted incoming projectile `p` arriving in `eta` frames (latched roll): a unique answer (move index) to fire
   * NOW, -2 = wait (fire later: the answer keeps its latched decision), -1 = none (block / jump / parry as usual)
   */
  proj(b: Brain, p: ProjView, eta: number, roll: number, fire: boolean): number {
    const s = b.seen;
    // counters that catch projectiles (DEAD AIR, EX PLAY DEAD): the super first when the bar is spare
    if (roll < this.r.counterProj) {
      const spare = b.showBars() >= 3 || b.spendLv1;
      const cs = toolsOf(b, 'counter').sort((x, y) => (spare ? b.kit.moves[y].super - b.kit.moves[x].super : b.kit.moves[x].super - b.kit.moves[y].super));
      for (const k of cs) {
        const mi = b.kit.moves[k];
        const c = mi.counter!;
        if (!c.proj) continue;
        const lag = b.rcpLag(k);
        if (eta >= lag + c.f0 && eta <= lag + c.f1 - 2) return fire ? k : -2;
        if (eta > lag + c.f1 - 2) return -2;
      }
    }
    // teleport through it (invulnerable from its startup) - behind the thrower, which is still recovering
    if (roll < this.r.teleProj && s.dist > 220000) {
      const tp = toolsOf(b, 'teleport').filter((k) => b.kit.moves[k].tele === 0);
      for (const k of tp) {
        const mi = b.kit.moves[k];
        const inv0 = mi.cm.inv[6];
        const inv1 = mi.cm.inv[7];
        const lag = b.rcpLag(k);
        if (inv0 <= 0) continue;
        if (eta >= lag + inv0 && eta <= lag + inv1 - 2) return fire ? k : -2;
        if (eta > lag + inv1 - 2) return -2;
      }
    }
    // duck / dive under it: its bottom above my evade hurtbox, or projectile-invulnerable frames covering it
    if (roll < this.r.evadeProj) {
      const bottom = p.y - (p.h >> 1);
      for (const k of toolsOf(b, 'evade')) {
        const mi = b.kit.moves[k];
        const lag = b.rcpLag(k);
        let f0 = 0;
        let f1 = -1;
        if (mi.projInv0 > 0) {
          f0 = mi.projInv0;
          f1 = mi.projInv1;
        } else if (mi.evadeTop > 0 && bottom > mi.evadeTop + 1000) {
          f0 = mi.evadeF0;
          f1 = mi.evadeF1;
        }
        if (f1 < f0) continue;
        // the projectile reaches my body during the window (a forward-moving evade meets it sooner: aim at its middle)
        if (eta >= lag + f0 && eta <= lag + Math.max(f0, f1 - 6)) return fire ? k : -2;
        if (eta > lag + f1 - 6) return -2;
      }
    }
    return -1;
  }

  // ------------------------------------------------------------------ reads
  /** a counter READ: the opponent is about to press (habits) - returns a counter move index or -1 */
  counterRead(b: Brain, when: 'neutral' | 'wake' | 'block'): number {
    const cs = toolsOf(b, 'counter');
    if (cs.length === 0) return -1;
    const h = b.habits;
    const w = b.profile.habit;
    let p = 0;
    if (when === 'neutral') p = this.r.counterRead * w * h.attackRate * Math.max(0.5, b.style.counter * 2);
    else if (when === 'wake') p = this.r.counterWake * w * h.wakeRate;
    else p = this.r.counterBlock * w * h.pressureRate;
    if (b.rnd() >= p) return -1;
    // the cheapest non-super counter first (EX / supers only when the meter policy allows: canUse checked); a super
    // counter (DEAD AIR) when the bar is spare (a full meter, or the latched spend roll)
    const sup = cs.filter((k) => b.kit.moves[k].super > 0);
    if (sup.length > 0 && (b.showBars() >= 3 || b.spendLv1) && b.rnd() < 0.4) return sup[0];
    const plain = cs.filter((k) => b.kit.moves[k].super === 0 && !b.kit.moves[k].ex);
    return plain.length > 0 ? plain[Math.floor(b.rnd() * plain.length)] : cs[0];
  }

  // ------------------------------------------------------------------ neutral options
  /** unique neutral options for the planner (null = none this decision) */
  neutral(b: Brain, aggro: boolean): Decision | null {
    const s = b.seen;
    const me = s.me;
    const op = s.op;
    const d = s.dist;
    const kit = b.kit;
    const cornered = Math.abs(me.x) > s.wall - 120000 && me.x * s.dx < 0;
    const opFree = op.st === ST.IDLE || op.st === ST.CROUCH || op.st === ST.WALK_F || op.st === ST.WALK_B;

    // install: power up at a safe distance or during the opponent's knockdown
    for (const k of toolsOf(b, 'install')) {
      if (me.instF > 0) break;
      const safe = d > 250000 || (op.st === ST.KNOCKDOWN && op.stun > b.timeToActive(k) + 6);
      if (safe && b.rnd() < this.r.install) return this.start(b, k);
    }

    // counter read vs a presser about to walk into me
    if (opFree && d <= b.opThreatU() + 30000) {
      const c = this.counterRead(b, 'neutral');
      if (c >= 0) {
        b.stats.counterReads++;
        return this.start(b, c);
      }
    }

    // duck-counter read (Johnny WEAVE): a presser whose close buttons are mostly HIGH (habits.highRate) is about to
    // swing over a weave - then the busy driver fires the trigger (counter hook) when it reaches
    if (opFree && d <= b.opThreatU() + 20000) {
      const h = b.habits;
      // only where its counter can reach from the end of the weave (the chain part's reach + the weave's own travel)
      const ev = toolsOf(b, 'evade').filter((k) => {
        const mi = kit.moves[k];
        if (mi.evadeTop <= 0 || mi.evadeTop >= 105000 || mi.cm.chains.length === 0) return false;
        const cr = Math.max(...mi.cm.chains.map((c) => kit.moves[c].reach));
        return d <= cr + (mi.cm.curve[mi.cm.total] >> 1) + b.opHurtHalf();
      });
      // CHANGED(fix_balance): from a third of its close strikes high (was 0.45): in the 3D ring its close strikes mix in more
      // lows / mids and steps, and measured highRate stayed 0.00-0.49 in G3 U1's johnny bouts - WEAVE never came out there
      // (G3 U1 "MISSING johnny [weave, weave_counter]" on the base tree); the chance still scales with highRate
      if (ev.length > 0 && h.highRate > 0.3 && b.rnd() < this.r.evadeHigh * b.profile.habit * h.attackRate * h.highRate * 3) {
        b.stats.evadeReads++;
        return this.start(b, ev[0]);
      }
    }

    // teleport: cornered -> behind; crowded (not cornered) -> home; the opponent knocked down -> a mixup
    const tele = toolsOf(b, 'teleport');
    if (tele.length > 0) {
      const beh = tele.find((k) => kit.moves[k].tele === 0 && !kit.moves[k].ex);
      const front = tele.find((k) => kit.moves[k].tele === 1 && !kit.moves[k].ex);
      const home = tele.find((k) => kit.moves[k].tele === 2 && !kit.moves[k].ex);
      if (cornered && d < 200000 && beh !== undefined && b.rnd() < this.r.teleCorner) return this.start(b, beh);
      if (!cornered && d < kit.rangeLo && home !== undefined && Math.abs(me.x) < s.wall - 250000 && b.rnd() < this.r.teleCrowd) return this.start(b, home);
      if (op.st === ST.KNOCKDOWN && op.stun > 10 && op.stun < 30 && d < 350000 && b.rnd() < this.r.teleWake) {
        const pick = b.rnd() < 0.5 ? beh : front;
        if (pick !== undefined) return this.start(b, pick);
      }
    }

    // stance: enter at follow-up range (the forward enter from further out); the stance driver walks in and picks
    const st = toolsOf(b, 'stance');
    if (st.length > 0 && aggro && b.rnd() < this.r.stanceUse * (0.5 + b.style.mix)) {
      const reachF = this.followReach(b);
      const fwd = st.find((k) => kit.moves[k].cm.curve[kit.moves[k].cm.total] > 20000 && !kit.moves[k].ex);
      const inPlace = st.find((k) => kit.moves[k].cm.curve[kit.moves[k].cm.total] <= 20000 && !kit.moves[k].ex);
      if (d <= reachF + 30000 && inPlace !== undefined) return this.start(b, inPlace);
      if (d <= reachF + 110000 && fwd !== undefined) return this.start(b, fwd);
    }

    // armor step: a read vs a presser just outside its buttons, or an approach
    const steps = toolsOf(b, 'step');
    if (steps.length > 0) {
      const presser = b.habits.attackRate * b.profile.habit;
      const zone = d > b.opThreatU() - 40000 && d < b.opThreatU() + 90000;
      const pRead = zone && opFree ? this.r.stepRead * presser : 0;
      const pAppr = aggro && d > 140000 && d < 280000 ? this.r.stepApproach * (0.5 + b.style.armor) : 0;
      if (pRead + pAppr > 0 && b.rnd() < pRead + pAppr) {
        const k = steps.find((x) => !kit.moves[x].ex) ?? steps[0];
        b.stats.stepReads++;
        return this.start(b, k);
      }
    }

    // ball: re-kick a hovering ball (the volley) at range, walk to a resting ball to trap it
    if (kit.uk === 3) {
      const ball = this.myBall(b);
      const bs = me.uq[0];
      if (ball && bs === BALL.HOVER && this.ballReady(b) && d > 150000 && b.rnd() < this.r.ballRekick) {
        const shots = toolsOf(b, 'ballShoot').filter((k) => !kit.moves[k].ex);
        if (shots.length > 0) {
          b.stats.rekicks++;
          return { t: 'move', idx: shots[Math.floor(b.rnd() * shots.length)] };
        }
      }
      if (ball && (bs === BALL.REST || bs === BALL.LOOSE) && !this.ballReady(b)) {
        const dx = ball.x - me.x;
        const safeWalk = Math.abs(dx) < 300000 && (Math.abs(op.x - ball.x) > 120000 || d > 200000);
        if (safeWalk && b.rnd() < this.r.ballPickup) return { t: 'hold', d: dx * me.facing > 0 ? 6 : 4, frames: 8 };
      }
    }

    // evade approach (gazza's dive vs a projectile-happy opponent at mid range)
    const ev = toolsOf(b, 'evade').filter((k) => b.kit.moves[k].projInv0 > 0 && b.kit.moves[k].cm.curve[b.kit.moves[k].cm.total] > 60000);
    if (ev.length > 0 && aggro && d > 180000 && d < 360000 && b.habits.counts[5] > 1 && b.rnd() < 0.15) return this.start(b, ev[0]);
    return null;
  }

  /** the longest reach of my stance follow-ups (centre distance, U) */
  private followReach(b: Brain): number {
    let r = 0;
    for (const k of b.kit.cf.u.stFollow) if (k >= 0) r = Math.max(r, b.kit.moves[k].reach + b.opHurtHalf() - 3000);
    return r;
  }

  private start(b: Brain, k: number): Decision {
    b.stats.uniques++;
    this.drive = k;
    this.driveInst = -1;
    return { t: 'move', idx: k };
  }

  /** note a tool move started from elsewhere (reactions) so busy() drives it */
  started(k: number): void {
    this.drive = k;
    this.driveInst = -1;
  }

  // ------------------------------------------------------------------ per-frame drivers of running unique moves / states
  /** while one of my unique moves or the stance runs: the step to press (or null = nothing; the brain's default) */
  busy(b: Brain): Step | null {
    const s = b.seen;
    const me = s.me;
    if (me.st === ST.STANCE) return this.stanceTick(b);
    if (me.st !== ST.ATTACK || me.mv < 0 || me.air) return null;
    const mi = b.kit.moves[me.mv];
    if (!mi) return null;
    if (mi.tool === 'evade' || mi.tool === 'step') return this.cancelTick(b, mi);
    return null;
  }

  /** WEAVE -> counter hook, DIVE -> special, armor STEP -> command grab / 2L tick / special: inside the whiff-cancel window */
  private cancelTick(b: Brain, mi: MoveInfo): Step | null {
    const s = b.seen;
    const me = s.me;
    const op = s.op;
    const cm = mi.cm;
    const f = me.mvF;
    if (me.inst === this.driveInst) return null; // already answered this instance
    const grace = 3;
    if (f < cm.startup || f > cm.lastActive + grace - 1) return null;
    const lateWindow = f >= cm.lastActive + grace - 2;
    const cands: number[] = [];
    // chain parts with a trigger (weave counter hook)
    for (const c of cm.chains) {
      const ci = b.kit.moves[c];
      if (ci.recipe && ci.recipe.ctx === 'chain' && ci.recipe.steps.length === 1) cands.push(c);
    }
    if (cm.cSpecial) {
      // command grabs first when in their range, then specials that connect
      for (const k of b.kit.lists.grab.concat(b.kit.groundStrikes)) if (b.kit.moves[k].special && cands.indexOf(k) < 0) cands.push(k);
      for (const mv of b.kit.moves) if (mv.special && mv.recipe && mv.recipe.ctx === '' && !mv.inert && !mv.proj && cands.indexOf(mv.idx) < 0) cands.push(mv.idx);
    }
    if (mi.tool === 'step' && b.kit.cf.u.tickStr >= 0) {
      // the armor step's tick normal (2L / 5L) after it absorbed something, or as a frame-trap into a throw
      for (const k of b.kit.lights) if (cands.indexOf(k) < 0) cands.push(k);
    }
    const opBusy = op.st === ST.ATTACK || op.st === ST.RECOVER || op.st === ST.LAND || op.st === ST.BLOCKSTUN || op.st === ST.HITSTUN;
    for (const k of cands) {
      const c = b.kit.moves[k];
      if (!c.recipe) continue;
      if (c.recipe.ctx === '' && !b.canUse(k)) continue;
      if (c.recipe.ctx === 'chain' && (c.cm.costShow > me.show || (c.cm.costNerve > 0 && !b.nerveOk(c.cm.costNerve)))) continue;
      if (!b.inReachFrom(k, c.recipe.lag)) continue;
      // a strike cancel wants the opponent busy (whiffing / recovering / absorbed) or the armor to have absorbed
      const absorbed = mi.tool === 'step' && me.uq[1] > 0;
      if (!c.grab && !opBusy && !absorbed && !lateWindow && mi.tool === 'step') continue;
      this.driveInst = me.inst;
      b.stats.uniqueCancels++;
      b.pad.push(c.recipe.steps);
      return b.pad.shift();
    }
    return null;
  }

  /** one frame in STANCE: walk in, pick the follow-up the opponent's visible posture loses to, or leave */
  private stanceTick(b: Brain): Step | null {
    const s = b.seen;
    const me = s.me;
    const op = s.op;
    const key = s.frame - me.uq[1];
    if (key !== this.stanceKey) {
      this.stanceKey = key;
      this.stanceGoal = -1;
      b.stats.stances++;
    }
    const fu = b.kit.cf.u.stFollow;
    const low = fu[0];
    const oh = fu[1];
    const hop = fu[2];
    const t = b.strike;
    // under attack in the stance (it cannot block): hop a reacted low, stay leaned for a high, else leave backwards
    if (t && b.threatLive(t) && t.decided && t.resp !== 0) {
      if (t.cm.guard === 2 && hop >= 0) return { d: 5, b: B.H };
      const lo = lowestBox(t.cm);
      if (lo > b.kit.cf.u.stHurtH + b.kit.cf.u.stHurtY) return { d: 5, b: 0 };
      return { d: 4, b: 0 };
    }
    if (this.stanceGoal < 0) {
      // the opponent's posture NOW (visible) + its habit: crouching -> overhead, standing -> low, low-happy -> hop
      const h = b.habits;
      let g = op.crouch ? oh : low;
      if (hop >= 0 && h.pLow() > 0.5 && h.confidence() > 0.5 && b.rnd() < 0.4) g = hop;
      if (g < 0) g = [low, oh, hop].find((x) => x >= 0) ?? -1;
      this.stanceGoal = g;
    }
    const g = this.stanceGoal;
    if (g < 0) return { d: 2, b: 0 };
    // re-read the posture each frame: a crouch now flips the pick between low and overhead (it is on screen)
    let pick = g;
    if (g !== hop) pick = op.crouch ? oh : low;
    if (pick < 0) pick = g;
    if (b.connectsFrom(pick, 1)) {
      b.stats.stanceFollows++;
      return { d: 5, b: b.kit.cf.u.stFollow[0] === pick ? B.L : b.kit.cf.u.stFollow[1] === pick ? B.M : B.H };
    }
    // out of reach: walk the stance in until the timeout gets close, then leave (down = exit)
    if (me.uq[1] < me.uq[2] - 20 && s.dist > 60000) return { d: 6, b: 0 };
    return { d: 2, b: 0 };
  }

  // ------------------------------------------------------------------ route extensions
  /** a rekka continuation after `idx` made contact (hit / block), or -1 */
  rekka(b: Brain, idx: number, contact: number): number {
    const cm = b.kit.moves[idx].cm;
    const parts = cm.chains.filter((c) => {
      const mi = b.kit.moves[c];
      return mi.recipe !== null && mi.recipe.ctx === 'chain' && mi.cm.trigger !== null && mi.special;
    });
    if (parts.length === 0) return -1;
    if (contact !== 1 && b.rnd() >= this.r.rekkaBlock) return -1;
    if (parts.length === 1) return parts[0];
    // the ender: overhead vs a crouching (blocking) opponent, low vs a standing one; on hit the harder hitter
    const op = b.seen.op;
    const oh = parts.find((c) => b.kit.moves[c].overhead);
    const lo = parts.find((c) => b.kit.moves[c].low);
    // on hit either ender connects: the harder hitter most of the time, the other one as variety
    if (contact === 1) {
      const best = parts.reduce((x, y) => (b.kit.moves[y].damage > b.kit.moves[x].damage ? y : x));
      return b.rnd() < 0.7 ? best : parts[Math.floor(b.rnd() * parts.length)];
    }
    // on block: the guard it is holding NOW (visible) loses to one of them - mostly that one (a mixup stays a mixup)
    const right = op.crouch ? oh : lo;
    const wrong = op.crouch ? lo : oh;
    if (right !== undefined && (wrong === undefined || b.rnd() < 0.75)) return right;
    if (wrong !== undefined) return wrong;
    return parts[Math.floor(b.rnd() * parts.length)];
  }
}

export { M };
