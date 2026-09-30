// HIT PARADE - the CPU brain (lane AI, CONTRACT §11, FIGHTING_DESIGN §10 + §12 AI honesty rules).
// THREE-free, DOM-free, clock-free. Deterministic: its only randomness is a mulberry32 stream seeded at
// creation, and it is called exactly once per sim frame (before step) with the match it plays in.
//
// Honesty rules, as built:
//   * It sees only sense.ts's Seen (visible state). Never the opponent's input words, history or buffer.
//   * Reaction clock: the response to an attack is in place `reactF` frames after the attacker's FIRST
//     startup frame is on screen (sim frames, so a super freeze / hitstop counts as time the player can
//     watch), i.e. on the attacker's move frame reactF + 1. An L8 (18 f) CPU blocks a 19 f overhead on
//     reaction, not an 18 f one, and never a 5 f jab - unless it was already guarding (the neutral guard
//     posture, a guess). probe_personas H4 measures exactly this boundary.
//   * ONE latched reaction roll per incoming attack (per move instance, per jump, per projectile):
//     block / parry / anti-air / counter decisions all compare that single roll; the punish decision is
//     its own roll, latched too. Nothing is re-rolled per frame.
//   * Commit while swinging: a started move or planned input sequence is never abandoned to block.
//   * Execution drops: garbled motions, dropped links, late presses at the level's rate.
//   * Bosses get tools (boss.ts), never faster reactions than the L8 floor.
// The brain emits §4.4 input words only; it never writes to the state.

import type { Match } from '../sim/state.ts';
import type { CMove } from '../sim/compile.ts';
import { F, PH, ST, fighterBase } from '../sim/layout.ts';
import { mulberry32 } from '../rng.ts';
import { B, Pad, awayBits } from './pad.ts';
import type { Step } from './pad.ts';
import { isFree, newSeen, sense } from './sense.ts';
import type { FView, Seen } from './sense.ts';
import { buildKit, cancelsInto } from './kit.ts';
import type { Kit, MoveInfo } from './kit.ts';
import { counterLive } from './boss.ts';
import type { BossTools } from './boss.ts';

// ------------------------------------------------------------------ profile
export const ROUTE_KINDS = ['jab', 'single', 'two', 'chainSpecial', 'bnb', 'bnbMeter', 'bestMeterless', 'bestMeter', 'bestCorner'] as const;
export const PARRY_TIERS = ['never', 'rare', 'projectiles', 'slow', 'perfect', 'rush', 'baits'] as const;
export const METER_TIERS = ['never', 'ex', 'lv1', 'all', 'cancel'] as const;
export const NERVE_TIERS = ['none', 'avoid', 'burnout', 'impactReads', 'counterImpact'] as const;

export interface Profile {
  name: string;
  level: number; // 0..8, -1 persona
  reactF: number;
  block: number;
  guessAdapt: number;
  antiAir: number;
  punish: number;
  route: number; // ROUTE_KINDS index
  tech: number;
  parry: number; // PARRY_TIERS index
  meter: number; // METER_TIERS index
  nerve: number; // NERVE_TIERS index
  drop: number;
  aggression: number;
  adaptAggro: boolean;
  guard: number;
  /** chance per neutral decision to respect a presser (plans.ts): guard / space-poke instead of walking into it; 0 = never (no roll) */
  respect: number;
  thinkF: number;
  delayF: number;
  /** extra jump-over share of reacted projectiles + dash-in chance between them (cpu.json [R]) */
  antiZone: number;
  parryShare: number;
  slowStartup: number;
  whiffReactPct: number;
  counterImpactNerve: number;
  avoidFrightNerve: number;
  adapt: { base: number; span: number; min: number; max: number };
  backRise: number;
  wakeReversal: number;
  /**
   * cpu.json rules.press: the opponent counts as PRESSING when the share of its free frames inside its own
   * fast-button zone that ended in an attack start (an EMA with time constant `windowF` frames) is >= `rate`
   */
  press: { rate: number; windowF: number };
}

/** how many of the opponent's recent ground strikes the brain remembers (the buttons it actually presses) */
export const OPSEEN = 6;

/** horizontal reach (U) of a compiled strike: box front + authored travel up to that box */
export function cmReach(cm: CMove): number {
  let r = 0;
  for (let k = 0; k < cm.nBox; k++) r = Math.max(r, cm.boxes[k * 7 + 2] + (cm.boxes[k * 7 + 4] >> 1) + cm.curve[Math.min(cm.boxes[k * 7], cm.curve.length - 1)]);
  return r;
}

export interface StyleParams {
  throw: number; poke: number; jump: number; dash: number; walkIn: number; zone: number; approach: number; grab: number;
  armor: number; counter: number; backOff: number; jumpProj: number; mix: number; air: number; setup: number; escape: number;
  charge: boolean;
}

export const DEFAULT_STYLE: StyleParams = {
  throw: 0.25, poke: 0.45, jump: 0.06, dash: 0.1, walkIn: 0.45, zone: 0.3, approach: 0.1, grab: 0, armor: 0, counter: 0,
  backOff: 0.15, jumpProj: 0.15, mix: 0.2, air: 0, setup: 0, escape: 0, charge: false,
};

/** Responses a reaction can pick (latched per threat). */
export const RESP = { NONE: 0, BLOCK: 1, PARRY: 2, AA: 3, IMPACT: 4, THROW: 5, TOOL: 6, JUMP: 7, BACKDASH: 8 } as const;

export type Decision =
  | { t: 'hold'; d: number; frames: number }
  | { t: 'guard'; crouch: boolean; frames: number }
  | { t: 'move'; idx: number }
  | { t: 'route'; steps: number[] }
  | { t: 'steps'; steps: Step[] }
  | { t: 'none'; frames: number };

interface Threat {
  inst: number;
  mv: number;
  cm: CMove;
  start: number; // sim frame of the attacker's move frame 1
  roll: number;
  pRoll: number;
  resp: number;
  decided: boolean;
  acted: boolean;
  blocked: boolean;
  whiffAt: number;
  punished: boolean;
  tool: number; // move index a TOOL response uses
}

interface JumpThreat {
  start: number;
  roll: number;
  resp: number;
  decided: boolean;
  done: boolean;
  fired: boolean;
}

interface Route {
  steps: number[];
  k: number;
  phase: number; // 0 send, 1 wait start, 2 running
  deadline: number;
  contactSeen: boolean;
  linkPending: boolean;
  confirm: boolean;
}

export interface BrainStats {
  frames: number;
  threats: number;
  reacted: number;
  blocksChosen: number;
  parries: number;
  aaChosen: number;
  aaFired: number;
  punishes: number;
  whiffPunishes: number;
  interrupts: number;
  routes: number;
  routeSteps: number;
  drops: number;
  techTries: number;
  supers: number;
  tools: number;
  impacts: number;
  throws: number;
  jumps: number;
  /** neutral decisions that held a guard because the opponent was pressing (plans.ts respect rule) */
  respects: number;
  /** footsies pokes swung into a presser's walk-in (plans.ts respect rule, brain.spacePoke) */
  spacePokes: number;
}

function blankStats(): BrainStats {
  return {
    frames: 0, threats: 0, reacted: 0, blocksChosen: 0, parries: 0, aaChosen: 0, aaFired: 0, punishes: 0, whiffPunishes: 0, interrupts: 0,
    routes: 0, routeSteps: 0, drops: 0, techTries: 0, supers: 0, tools: 0, impacts: 0, throws: 0, jumps: 0, respects: 0, spacePokes: 0,
  };
}

const SCALE = [100, 100, 80, 70, 60, 50, 40, 30, 20, 10];

export type NeutralPlanner = (b: Brain) => Decision;

// ------------------------------------------------------------------ the brain
export class Brain {
  readonly profile: Profile;
  readonly seed: number;
  readonly rnd: () => number;
  style: StyleParams;
  readonly stats: BrainStats = blankStats();
  tools: BossTools | null = null;
  planner: NeutralPlanner | null = null;
  styleTable: Record<string, StyleParams> = {};

  m!: Match;
  i = 0;
  kit!: Kit;
  seen!: Seen;
  readonly pad: Pad;
  bound = false;

  // memory (the CPU's own head; never in the sim state)
  strike: Threat | null = null;
  jump: JumpThreat | null = null;
  private projKey = new Int32Array(12).fill(-1);
  private projRoll = new Float64Array(12);
  private projStart = new Int32Array(12);
  private projResp = new Int8Array(12);
  route: Route | null = null;
  private hold: { d: number; guard: boolean; crouch: boolean; until: number } | null = null;
  nextThink = 0;
  private round = -1;
  private wasFight = false;
  guardCrouch = true;
  private parryPress = false;
  private parryRushed = false;
  /** last 3 close-range mixups the opponent landed or had blocked: 1 low, 2 overhead, 3 throw */
  mixHist: number[] = [];
  private lastMySt = -1;
  private throwKey = -1;
  private techGo = false;
  private techDone = false;
  private kdKey = -1;
  private kdBackRise = false;
  private kdReversal = -1;
  private kdGuard = false;
  private airKey = -1;
  private airUsed = false;
  private opPassive = 0.5;
  private opWasAttacking = false;
  /** opponent's fastest overhead startup (frames); 999 if none */
  opOverheadF = 999;
  /** opponent's longest ground strike reach (U) */
  opReach = 100000;
  /** opponent's fastest ground strike startup (frames; its frame data, known like any player knows it) */
  opFastest = 99;
  /** longest reach (U) among the opponent's ground normals within 3 f of its fastest startup (its "fast buttons") */
  opFastReach = 80000;
  /** EMA: share of the opponent's free frames inside its fast-button zone that ended in an attack start */
  opPressRate = 0;
  private opPrevSt = -1;
  /** reach (U) / startup (f) of the opponent's last OPSEEN ground strikes (visible move starts) */
  private seenReach = new Int32Array(OPSEEN);
  private seenStart = new Int32Array(OPSEEN);
  private seenN = 0;
  private seenK = 0;
  /** my kit has a back-charge special (a full back charge turns forward + button into it) */
  chargeKit = false;
  private shoveKey = -1;
  private lastDecision: Decision | null = null;

  constructor(profile: Profile, seed: number, style: StyleParams | null = null) {
    this.profile = profile;
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x6a09e667);
    this.style = style ?? DEFAULT_STYLE;
    this.pad = new Pad(profile.delayF);
  }

  // ------------------------------------------------------------------ binding
  bind(m: Match, i: number): void {
    this.m = m;
    this.i = i;
    this.kit = buildKit(m.data, m.cf[i], m.cfg.p[i].scheme);
    this.chargeKit = this.kit.moves.some((mi) => mi.recipe !== null && mi.recipe.charge === 1);
    this.seen = newSeen(m, i);
    const st = this.styleTable[this.kit.rawStyle] ?? this.styleTable[this.kit.style];
    if (st) this.style = st;
    const ocf = m.cf[1 - i];
    let oh = 999;
    let reach = 0;
    for (const cm of ocf.moves) {
      if (!cm.isStrike || cm.snapId < 0 || cm.inAir) continue;
      if (cm.guard === 1 && cm.startup < oh) oh = cm.startup;
      let r = 0;
      for (let k = 0; k < cm.nBox; k++) r = Math.max(r, cm.boxes[k * 7 + 2] + (cm.boxes[k * 7 + 4] >> 1) + cm.curve[Math.min(cm.boxes[k * 7], cm.curve.length - 1)]);
      if (cm.isNormalCat && r > reach) reach = r;
    }
    this.opOverheadF = oh;
    this.opReach = Math.max(80000, reach);
    let fast = 99;
    for (const cm of ocf.moves) if (cm.isStrike && cm.snapId >= 0 && !cm.inAir && !cm.chainOnly && cm.costShow === 0 && cm.costNerve === 0 && cm.startup < fast) fast = cm.startup;
    this.opFastest = fast;
    // the reach of its fast buttons (the ones that beat a slower poke started at the same time)
    let fr = 0;
    for (const cm of ocf.moves) {
      if (!cm.isStrike || !cm.isNormalCat || cm.snapId < 0 || cm.inAir || cm.chainOnly || cm.startup > fast + 3) continue;
      fr = Math.max(fr, cmReach(cm));
    }
    this.opFastReach = Math.max(80000, fr);
    this.bound = true;
  }

  get level(): number {
    return this.profile.level;
  }

  // ------------------------------------------------------------------ helpers
  frame(): number {
    return this.seen.frame;
  }
  me(): FView {
    return this.seen.me;
  }
  op(): FView {
    return this.seen.op;
  }
  info(idx: number): MoveInfo {
    return this.kit.moves[idx];
  }
  /**
   * Is the reaction window open? `start` = the sim frame whose step showed the attacker's move frame 1;
   * the CPU call before step start + k sees move frame k, and a response emitted there is in effect on
   * move frame k + 1. Open from k = reactF, so the response is in effect reactF frames after the stimulus.
   */
  ready(start: number): boolean {
    return this.seen.frame - start >= this.profile.reactF - 1;
  }
  /**
   * Has the opponent been PRESSING buttons - does it start an attack almost as soon as it is free inside the
   * range of its fast buttons (opPressRate >= rules.press.rate)? Built from the states it watched (the
   * opponent's move starts), never from input words; it persists across rounds (a player remembers).
   */
  opPressing(): boolean {
    return this.opPressRate >= this.profile.press.rate;
  }

  /**
   * Centre distance (U) inside which the buttons the opponent has been pressing reach me before a slower
   * button of mine is out: per button (its last OPSEEN visible ground strikes; its kit's fast buttons until it
   * has shown 3) reach + my hurt half + its walk over that startup (+2 f), plus 0.15 m.
   */
  pressZone(): number {
    const me = this.seen.me;
    const op = this.seen.op;
    const hurt = Math.max(me.cf.hurtStand[0], me.cf.hurtCrouch[0]) >> 1;
    const walk = op.cf.walkF;
    if (this.seenN < 3) return this.opFastReach + hurt + walk * (this.opFastest + 2) + 15000;
    let z = 0;
    for (let k = 0; k < this.seenN; k++) z = Math.max(z, this.seenReach[k] + hurt + walk * (this.seenStart[k] + 2));
    return z + 15000;
  }

  /**
   * Footsies vs a presser: the most damaging ground normal of mine whose box meets the opponent where its
   * visible walk brings it, at least 2 frames before any button it has been pressing could be active from
   * where it gets into range. -1 if none (then the planner guards).
   */
  spacePoke(): number {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    if (me.air || op.air) return -1;
    const d = s.dist;
    // walking / dashing is not in the velocity fields (the sim moves walkers by their walk speed): the closing
    // speed comes from the visible state and the opponent's known walk / dash speeds. For safety a free
    // opponent may start walking in on any frame: its full forward walk speed at least.
    const cf = op.cf;
    const dashV = cf.dashFFrames > 0 ? Math.floor((cf.dashF[cf.dashFFrames] ?? 0) / cf.dashFFrames) : 0;
    const closingNow = op.st === ST.WALK_F ? cf.walkF : op.st === ST.DASH_F ? dashV : 0;
    const closing = Math.max(closingNow, cf.walkF);
    // my widest body (a crouching normal widens it): the opponent's buttons reach me from there
    const hurt = Math.max(me.cf.hurtStand[0], me.cf.hurtCrouch[0]) >> 1;
    const n = this.seenN >= 3 ? this.seenN : 0;
    // a presser stops walking to press once its longest button reaches me: the walk-in ends there
    let stopAt = 0;
    if (n === 0) stopAt = this.opFastReach + hurt;
    else for (let j = 0; j < n; j++) stopAt = Math.max(stopAt, this.seenReach[j] + hurt);
    // a full back charge turns forward + button into a charge special (the recipe would not be this normal)
    const charged = this.chargeKit && me.chB >= this.m.sys.raw.motion.chargeFrames;
    let best = -1;
    let bestDmg = -1;
    for (const k of this.kit.groundStrikes) {
      const mi = this.kit.moves[k];
      if (!mi.normal || mi.inert || mi.proj || mi.grab || !this.canUse(k)) continue;
      const st0 = mi.recipe!.steps[0];
      if (charged && (st0.d === 6 || st0.d === 3 || st0.d === 9)) continue;
      const t = this.connectsAt(k, closingNow, stopAt);
      if (t < 0) continue;
      let safe = true;
      const check = (r: number, su: number): void => {
        const c = r + hurt;
        const tin = d <= c ? 0 : Math.ceil((d - c) / closing);
        if (t > tin + su - 2) safe = false;
      };
      if (n === 0) check(this.opFastReach, this.opFastest);
      else for (let j = 0; j < n; j++) check(this.seenReach[j], this.seenStart[j]);
      if (safe && mi.damage > bestDmg) {
        best = k;
        bestDmg = mi.damage;
      }
    }
    return best;
  }

  /**
   * Earliest frame from now (recipe lag + move frame - 1) at which `idx`'s box overlaps the GROUNDED
   * opponent closing in at `closing` U/frame (its visible walk / dash) until the centre distance is `stopAt`
   * (where it stops to press); -1 if none. Ground vs ground only.
   */
  private connectsAt(idx: number, closing: number, stopAt: number): number {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    const mi = this.kit.moves[idx];
    const cm = mi.cm;
    if (cm.nBox === 0 || me.air || op.air) return -1;
    const lag = mi.recipe ? mi.recipe.lag : 1;
    const fc = me.facing;
    // the presser may be in a crouching button by my active frame: the box must meet its crouching body too
    const cur = op.crouch ? op.cf.hurtCrouch : op.cf.hurtStand;
    const oh: [number, number] = [Math.min(cur[0], op.cf.hurtCrouch[0]), Math.min(cur[1], op.cf.hurtCrouch[1])];
    const ohw = oh[0] >> 1;
    const side = me.x >= op.x ? 1 : -1; // the opponent is on the -side of me
    const d0 = Math.abs(me.x - op.x);
    let best = -1;
    for (let j = 0; j < cm.nBox; j++) {
      const q = j * 7;
      const bx = cm.boxes[q + 2];
      const by = cm.boxes[q + 3];
      const bw2 = cm.boxes[q + 4] >> 1;
      const bh2 = cm.boxes[q + 5] >> 1;
      for (let fr = cm.boxes[q]; fr <= cm.boxes[q + 1]; fr++) {
        const kk = lag + fr - 1;
        if (best >= 0 && kk >= best) break;
        const dk = d0 > stopAt ? Math.max(stopAt, d0 - closing * kk) : d0;
        const px = me.x - side * dk;
        const hx = me.x + fc * cm.curve[Math.min(fr, cm.curve.length - 1)] + fc * bx;
        const hy = (cm.yCurve ? cm.yCurve[Math.min(fr, cm.yCurve.length - 1)] : 0) + by;
        if (hx + bw2 < px - ohw || hx - bw2 > px + ohw) continue;
        if (hy + bh2 < op.y || hy - bh2 > op.y + oh[1]) continue;
        best = kk;
        break;
      }
    }
    return best;
  }
  aggression(): number {
    const P = this.profile;
    let a = P.aggression;
    if (P.adaptAggro) a = Math.max(P.adapt.min, Math.min(P.adapt.max, P.adapt.base + P.adapt.span * (this.opPassive - 0.5) * 2));
    if (P.nerve >= 2 && this.seen.op.fright) a += 0.2;
    if (this.tools) a += this.tools.aggressionBonus(this);
    return Math.max(0, Math.min(0.95, a));
  }
  bars(v: number, bar: number): number {
    return Math.floor(v / bar);
  }
  nerveBars(): number {
    return Math.floor(this.seen.me.nerve / this.m.sys.raw.nerve.bar);
  }
  showBars(): number {
    return Math.floor(this.seen.me.show / this.m.sys.raw.showtime.bar);
  }
  /** can the CPU spend NERVE now without breaking its own NERVE management rule */
  nerveOk(cost: number): boolean {
    const me = this.seen.me;
    if (me.fright || me.nerve <= 0) return false;
    if (this.profile.nerve >= 1 && me.nerve - cost < this.profile.avoidFrightNerve * this.m.sys.raw.nerve.bar) return false;
    return true;
  }
  myProjCount(): number {
    let n = 0;
    for (let k = 0; k < this.seen.nProj; k++) if (this.seen.proj[k].owner === this.i) n++;
    return n;
  }
  opHurtHalf(): number {
    const op = this.seen.op;
    const h = op.air ? op.cf.hurtAir : op.crouch ? op.cf.hurtCrouch : op.cf.hurtStand;
    return h[0] >> 1;
  }

  /** usable right now (recipe, meter, projectile limit, air state, charge stored, meter policy) */
  canUse(idx: number): boolean {
    if (idx < 0 || idx >= this.kit.moves.length) return false;
    const mi = this.kit.moves[idx];
    const r = mi.recipe;
    if (!r) return false;
    const me = this.seen.me;
    const cm = mi.cm;
    if (r.air !== me.air) return false;
    if (cm.costShow > 0 && me.show < cm.costShow) return false;
    if (cm.costNerve > 0 && !this.nerveOk(cm.costNerve)) return false;
    const P = this.profile;
    if (mi.ex && P.meter < 1) return false;
    if (mi.super === 1 && P.meter < 2) return false;
    if (mi.super === 3 && P.meter < 3) return false;
    if (cm.isImpact && !this.nerveOk(this.m.sys.raw.nerve.impactCost)) return false;
    if (cm.proj && this.myProjCount() >= cm.proj.limit) return false;
    if (r.charge === 1) {
      const need = this.m.sys.raw.motion.chargeFrames;
      if (!(me.chB >= need || (me.chBS >= need && me.chBR <= this.m.sys.raw.motion.chargeKeep - 1))) return false;
    } else if (r.charge === 2) {
      const need = this.m.sys.raw.motion.chargeFrames;
      if (!(me.chD >= need || (me.chDS >= need && me.chDR <= this.m.sys.raw.motion.chargeKeep - 1))) return false;
    }
    return true;
  }

  /** frames from now until `idx`'s first active frame */
  timeToActive(idx: number): number {
    const mi = this.kit.moves[idx];
    return (mi.recipe ? mi.recipe.lag : 1) + mi.firstActive - 1;
  }

  /**
   * Would `idx` reach the opponent? With no `dist`: the exact per-box prediction from the current
   * positions (connects: height matters - a head-high jab whiffs over a crouching body). With a
   * hypothetical `dist` (U): the horizontal reach only.
   */
  inReach(idx: number, dist?: number): boolean {
    const mi = this.kit.moves[idx];
    if (mi.proj) return true;
    const d = dist ?? this.seen.dist;
    if (mi.grab) {
      // CHANGED(fixer) D2: push-box fronts (asymmetric boxes)
      if (mi.grabGap >= 0) return d - this.kit.cf.pushFS - this.seen.op.cf.pushFS <= mi.grabGap - 2000;
      return d <= mi.grabReach + this.seen.op.cf.pushFS - 2000;
    }
    if (mi.reach <= 0) return false;
    if (dist === undefined && mi.cm.nBox > 0) return this.connects(idx);
    return d <= mi.reach + this.opHurtHalf() - 3000;
  }

  /** planned steps for move idx (execution drops applied) */
  movePlan(idx: number, dropOk = true): Step[] {
    const mi = this.kit.moves[idx];
    const r = mi.recipe;
    if (!r) return [];
    const steps = r.steps.slice();
    if (dropOk && this.profile.drop > 0 && this.rnd() < this.profile.drop * 0.5) {
      this.stats.drops++;
      if (steps.length > 1) {
        // a garbled motion: the button comes out on the last direction only (a normal, or nothing)
        const last = steps[steps.length - 1];
        return [{ d: last.d === 3 ? 2 : last.d === 1 ? 2 : last.d, b: last.b & ~B.S }];
      }
      // a late press
      const late = 2 + Math.floor(this.rnd() * 4);
      const out: Step[] = [];
      for (let k = 0; k < late; k++) out.push({ d: 5, b: 0 });
      return out.concat(steps);
    }
    return steps;
  }

  startMove(idx: number, dropOk = true): boolean {
    if (!this.canUse(idx)) return false;
    const plan = this.movePlan(idx, dropOk);
    if (plan.length === 0) return false;
    this.pad.push(plan);
    const mi = this.kit.moves[idx];
    if (mi.super > 0) this.stats.supers++;
    if (mi.cm.isImpact) this.stats.impacts++;
    if (mi.grab) this.stats.throws++;
    this.hold = null;
    return true;
  }

  guardStep(fromX: number, crouch: boolean): Step {
    const me = this.seen.me;
    return { d: 5, b: 0, raw: awayBits(me.x, fromX, me.facing) | (crouch ? B.DOWN : 0) };
  }

  /** crouch-or-stand guess for a guard posture (guess weights + adaptation, FIGHTING_DESIGN §10) */
  chooseGuardCrouch(): boolean {
    let p = 0.5;
    if (this.opOverheadF >= this.profile.reactF) p = 0.85; // overheads are reactable at this level: crouch by default
    if (this.profile.guessAdapt > 0 && this.mixHist.length > 0) {
      let lo = 0;
      let hi = 0;
      for (const k of this.mixHist) {
        if (k === 1) lo++;
        else if (k === 2) hi++;
      }
      p += this.profile.guessAdapt * (lo - hi);
    }
    p = Math.max(0.05, Math.min(0.95, p));
    return this.rnd() < p;
  }

  private out(step: Step | null): number {
    return this.pad.out(step, this.seen.me.facing);
  }

  // ------------------------------------------------------------------ the per-frame entry
  input(m: Match, i: number): number {
    if (!this.bound || this.m !== m || this.i !== i) this.bind(m, i);
    const s = sense(m, i, this.seen);
    this.stats.frames++;
    if (s.phase !== PH.FIGHT) {
      if (this.wasFight) this.resetRound();
      this.wasFight = false;
      return this.pad.out(null, s.me.facing) & 0;
    }
    this.wasFight = true;
    if (s.cin) return this.out(null);
    this.track();
    const me = s.me;
    const st = me.st;
    const prev = this.lastMySt;
    this.lastMySt = st;
    if (st !== prev) this.onMyState(prev, st);
    switch (st) {
      case ST.INTRO:
      case ST.KO:
      case ST.WIN:
      case ST.LOSE:
        return this.out(null);
      case ST.THROWN:
        this.pad.clear();
        this.route = null;
        return this.out(this.techTick());
      case ST.KNOCKDOWN:
        this.route = null;
        return this.wakeTick();
      case ST.HITSTUN:
      case ST.JUGGLE:
      case ST.CRUMPLE:
      case ST.WALL_SPLAT:
      case ST.DIZZY:
      case ST.TECH:
        this.pad.clear();
        this.route = null;
        return this.out(this.guardStep(s.op.x, true));
      case ST.BLOCKSTUN:
        this.pad.clear();
        this.route = null;
        return this.out(this.blockstunTick());
      case ST.PARRY:
        return this.out(this.parryTick());
      case ST.GRAB:
      case ST.CINEMATIC:
        return this.out(null);
      default:
        break;
    }
    if (s.freeze > 0 && !this.pad.busy) {
      // super freeze / perfect-parry freeze: watch (the reaction clock runs), hold the decided guard
      const g = this.reactGuard();
      return this.out(g);
    }
    if (this.route) this.routeTick();
    if (this.pad.busy) return this.out(this.pad.shift());
    if (st === ST.RUSH) return this.out(this.rushTick());
    if (st === ST.AIR || (st === ST.ATTACK && me.air)) return this.out(st === ST.AIR ? this.airTick() : null);
    if (!isFree(st)) {
      // busy (own move, dash, landing, recovery): hold the guard a decided reaction wants, so the first
      // free frame already blocks; otherwise nothing
      return this.out(st === ST.ATTACK ? null : this.reactGuard());
    }
    // ---- free on the ground
    if (this.punishTick()) return this.out(this.pad.shift());
    const r = this.reactTick();
    if (r) return this.out(r);
    if (this.confirmTick()) return this.out(this.pad.shift());
    if (this.pad.busy) return this.out(this.pad.shift());
    return this.out(this.neutralTick());
  }

  resetRound(): void {
    this.pad.resetRound();
    this.strike = null;
    this.jump = null;
    this.projKey.fill(-1);
    this.route = null;
    this.hold = null;
    this.nextThink = 0;
    this.parryPress = false;
    this.throwKey = -1;
    this.kdKey = -1;
    this.airKey = -1;
    this.lastMySt = -1;
  }

  // ------------------------------------------------------------------ threat tracking (visible only)
  private track(): void {
    const s = this.seen;
    const op = s.op;
    // a new opponent move instance = a new attack to react to (ONE latched roll)
    if (op.st === ST.ATTACK && op.cm) {
      if (!this.strike || this.strike.inst !== op.inst) {
        this.strike = {
          inst: op.inst, mv: op.mv, cm: op.cm, start: s.frame - Math.max(0, op.mvF - 1), roll: this.rnd(), pRoll: this.rnd(),
          resp: RESP.NONE, decided: false, acted: false, blocked: false, whiffAt: -1, punished: false, tool: -1,
        };
        this.stats.threats++;
        const cm = op.cm;
        if (!op.air && cm.isStrike && cm.nBox > 0 && cm.proj === null && !cm.isGrab && !cm.isImpact && !cm.isSuper) {
          this.seenReach[this.seenK] = cmReach(cm);
          this.seenStart[this.seenK] = cm.startup;
          this.seenK = (this.seenK + 1) % OPSEEN;
          if (this.seenN < OPSEEN) this.seenN++;
        }
      }
      const t = this.strike;
      if (t.whiffAt < 0 && op.contact === 0 && op.mvF > op.cm.lastActive) t.whiffAt = s.frame;
    }
    // jumps
    const opGround = !op.air && op.st !== ST.PREJUMP;
    if (!opGround) {
      if (!this.jump || this.jump.done) {
        const start = op.st === ST.PREJUMP ? s.frame - op.stF : s.frame - (op.cf.prejump + Math.max(0, op.stF));
        this.jump = { start, roll: this.rnd(), resp: RESP.NONE, decided: false, done: false, fired: false };
      }
    } else if (this.jump && !this.jump.done) this.jump.done = true;
    // projectiles (each new projectile inherits the latched roll of the move that threw it)
    for (let k = 0; k < s.nProj; k++) {
      const p = s.proj[k];
      if (p.owner === this.i) continue;
      const key = (p.inst & 0xffff) * 16 + p.slot;
      if (this.projKey[p.slot] !== key) {
        this.projKey[p.slot] = key;
        const t = this.strike;
        const linked = t !== null && t.inst === p.inst;
        this.projRoll[p.slot] = linked ? t.roll : this.rnd();
        this.projStart[p.slot] = linked ? t.start : s.frame - p.age;
        this.projResp[p.slot] = -1;
      }
    }
    // adaptive aggression bookkeeping (L8): how often the opponent attacks
    const attacking = op.st === ST.ATTACK;
    if (attacking && !this.opWasAttacking) this.opPassive = this.opPassive * 0.9;
    else if (!attacking && s.frame % 30 === 0) this.opPassive = this.opPassive * 0.97 + 0.03;
    this.opWasAttacking = attacking;
    // press-rate bookkeeping (plans.ts respect rule): each frame the opponent was free on the ground inside the
    // range of its fast buttons either stayed free or started an attack; a masher starts one within a few frames
    const ps = this.opPrevSt;
    this.opPrevSt = op.st;
    const wasFree = ps === ST.IDLE || ps === ST.CROUCH || ps === ST.WALK_F || ps === ST.WALK_B;
    if (wasFree && !op.air && s.dist <= this.opFastReach + (s.me.cf.hurtStand[0] >> 1) + 20000) {
      const started = attacking ? 1 : 0;
      this.opPressRate += (started - this.opPressRate) / this.profile.press.windowF;
    }
  }

  /** my state changed: learn the opponent's mixups (visible outcomes), mark blocked threats */
  private onMyState(prev: number, st: number): void {
    const t = this.strike;
    if (st === ST.BLOCKSTUN && t) t.blocked = true;
    if ((st === ST.HITSTUN || st === ST.BLOCKSTUN) && t && this.seen.dist < 150000) {
      const k = t.cm.guard === 2 ? 1 : t.cm.guard === 1 ? 2 : 0;
      if (k) this.pushMix(k);
    }
    if (st === ST.THROWN) this.pushMix(3);
    if (st === ST.HITSTUN || st === ST.BLOCKSTUN || st === ST.THROWN || st === ST.KNOCKDOWN) this.hold = null;
    void prev;
  }

  private pushMix(k: number): void {
    this.mixHist.push(k);
    if (this.mixHist.length > 3) this.mixHist.shift();
  }

  // ------------------------------------------------------------------ reactions
  private decideStrike(t: Threat): void {
    t.decided = true;
    this.stats.reacted++;
    const P = this.profile;
    const cm = t.cm;
    const r = t.roll;
    const s = this.seen;
    const sys = this.m.sys.raw;
    let resp: number = RESP.NONE;
    if (cm.isImpact) {
      if (P.nerve >= 4 && r < P.block) {
        if (this.kit.throwF >= 0 && this.inReach(this.kit.throwF)) resp = RESP.THROW;
        else if (this.kit.impact >= 0 && this.nerveOk(sys.nerve.impactCost)) resp = RESP.IMPACT;
        else resp = RESP.BLOCK;
      } else if (r < P.block) resp = RESP.BLOCK;
    } else if (cm.isGrab) {
      // grabs are 5 f: only a slow command grab is ever reactable - jump away from it
      if (cm.startup >= P.reactF && r < P.block && s.dist < 200000) resp = RESP.JUMP;
    } else if (cm.proj) {
      const share = P.parry >= 2 ? P.parryShare : P.parry === 1 ? P.parryShare : 0;
      if (share > 0 && r < P.block * share && this.nerveOk(sys.parry.costStart)) resp = RESP.PARRY;
      else if (r < P.block) resp = RESP.BLOCK;
    } else if (cm.isStrike) {
      const tool = this.tools ? this.tools.react(this, cm, r) : -1;
      if (tool >= 0) {
        resp = RESP.TOOL;
        t.tool = tool;
      } else if (this.style.counter > 0 && this.kit.lists.counter.length > 0 && r < P.block * this.style.counter) {
        // counter stance as a reaction tool - only when the sim implements the §20 counter block
        const c = this.kit.lists.counter.find((k) => this.canUse(k) && counterLive(this.kit.moves[k].cm));
        if (c !== undefined) {
          resp = RESP.TOOL;
          t.tool = c;
        }
      }
      if (resp === RESP.NONE) {
        const slow = cm.startup >= P.slowStartup;
        const parryOk = P.parry >= 4 || (P.parry >= 3 && slow) || P.parry === 1;
        if (parryOk && r < P.block * P.parryShare && this.nerveOk(sys.parry.costStart)) resp = RESP.PARRY;
        else if (r < P.block) resp = RESP.BLOCK;
      }
    }
    t.resp = resp;
    if (resp === RESP.BLOCK) this.stats.blocksChosen++;
    else if (resp === RESP.PARRY) this.stats.parries++;
    else if (resp === RESP.TOOL) this.stats.tools++;
  }

  private decideJump(j: JumpThreat): void {
    j.decided = true;
    this.stats.reacted++;
    const P = this.profile;
    if (j.roll < P.antiAir) {
      j.resp = RESP.AA;
      this.stats.aaChosen++;
    } else if (j.roll < Math.max(P.block, P.antiAir)) {
      j.resp = RESP.BLOCK;
      this.stats.blocksChosen++;
    } else j.resp = RESP.NONE;
  }

  /** is the strike threat still coming (startup / active frames left)? */
  private live(t: Threat): boolean {
    const op = this.seen.op;
    return op.st === ST.ATTACK && op.inst === t.inst && op.mvF <= t.cm.lastActive + 1;
  }

  /** the guard a decided reaction wants this frame (or null) - used while busy / frozen too */
  private reactGuard(): Step | null {
    const s = this.seen;
    const t = this.strike;
    if (t && !t.decided && this.live(t) && this.ready(t.start)) this.decideStrike(t);
    if (t && t.decided && t.resp === RESP.BLOCK && this.live(t)) return this.guardStep(s.op.x, t.cm.guard !== 1 && !s.op.air);
    const j = this.jump;
    if (j && !j.done && !j.decided && this.ready(j.start)) this.decideJump(j);
    if (j && !j.done && (j.resp === RESP.BLOCK || j.resp === RESP.AA) && s.dist < 220000) return this.guardStep(s.op.x, false);
    const pg = this.projGuard();
    if (pg) return pg;
    return null;
  }

  /** incoming projectiles: block / parry at the latched decision */
  private projGuard(): Step | null {
    const s = this.seen;
    const me = s.me;
    const P = this.profile;
    for (let k = 0; k < s.nProj; k++) {
      const p = s.proj[k];
      if (p.owner === this.i) continue;
      const toward = (me.x - p.x) * p.vx > 0;
      if (!toward || p.vx === 0) continue;
      if (!this.ready(this.projStart[p.slot])) continue;
      let resp = this.projResp[p.slot];
      if (resp < 0) {
        const r = this.projRoll[p.slot];
        const share = P.parry >= 2 ? P.parryShare : P.parry === 1 ? P.parryShare : 0;
        if (share > 0 && r < P.block * share && this.nerveOk(this.m.sys.raw.parry.costStart)) resp = RESP.PARRY;
        else if (r < P.block * Math.min(1, this.style.jumpProj + P.antiZone) && s.dist > 180000) resp = RESP.JUMP;
        else if (r < P.block) resp = RESP.BLOCK;
        else resp = RESP.NONE;
        this.projResp[p.slot] = resp;
        if (resp === RESP.BLOCK) this.stats.blocksChosen++;
      }
      const gap = Math.abs(me.x - p.x) - (p.w >> 1) - (me.cf.hurtStand[0] >> 1);
      const eta = gap / Math.max(1, Math.abs(p.vx));
      if (resp === RESP.JUMP) {
        if (isFree(me.st) && eta <= 40 && this.jumpClears(k)) {
          this.projResp[p.slot] = RESP.NONE;
          this.stats.jumps++;
          this.pad.push([{ d: 9, b: 0 }, { d: 9, b: 0 }]);
          return this.pad.shift();
        }
        if (eta <= 6) {
          this.projResp[p.slot] = RESP.BLOCK; // too late to jump it: block
          return this.guardStep(p.x, true);
        }
        continue;
      }
      if (resp === RESP.BLOCK && eta <= 12) return this.guardStep(p.x, true);
      if (resp === RESP.PARRY && eta <= 2 && isFree(me.st) && !this.parryPress) {
        this.parryPress = true;
        this.stats.parries++;
        return { d: 5, b: B.PARRY };
      }
      if (resp === RESP.PARRY && eta <= 12) return this.guardStep(p.x, true);
    }
    return null;
  }

  /**
   * Would a forward jump started NOW carry my hurtbox over projectile `pi` (s.proj index)? Steps my jump
   * exactly like core/sim/fighter.ts (prejump frames on the ground, then x += vx; y += vy; vy -= g) and
   * the projectile at its speed, frame by frame, until it has passed me.
   */
  jumpClears(pi: number): boolean {
    const s = this.seen;
    const p = s.proj[pi];
    const me = s.me;
    const cf = me.cf;
    const pj = this.m.cf[p.owner]?.moves[p.mv]?.proj;
    if (!pj || pj.g !== 0 || pj.vy !== 0) return false; // arcing / rolling: not a jump-over case
    const fc = me.facing;
    const hs = cf.hurtStand;
    const ha = cf.hurtAir;
    const pw = p.w >> 1;
    const ph = p.h >> 1;
    let mx = me.x;
    let my = 0;
    let vx = 0;
    let vy = 0;
    let air = false;
    let px = p.x;
    for (let t = 1; t <= 70; t++) {
      if (t === cf.prejump + 1) {
        air = true;
        vx = fc * cf.vxF;
        vy = cf.vy0;
      }
      if (air) {
        mx += vx;
        my += vy;
        vy -= cf.g;
        if (my <= 0) {
          my = 0;
          air = false;
          vx = 0;
        }
      }
      px += p.vx;
      const hw = (air ? ha[0] : hs[0]) >> 1;
      const hh = air ? ha[1] : hs[1];
      const passed = p.vx > 0 ? px - pw > mx + hw : px + pw < mx - hw;
      if (passed) return true;
      const ox = px + pw >= mx - hw && px - pw <= mx + hw;
      const oy = p.y + ph >= my && p.y - ph <= my + hh;
      if (ox && oy) return false;
      if (!air && t > cf.prejump + 1) return false; // landed in front of it
    }
    return false;
  }

  /** free on the ground: act on decided reactions. Returns a step or null. */
  private reactTick(): Step | null {
    const s = this.seen;
    const P = this.profile;
    const t = this.strike;
    if (t && this.live(t)) {
      if (!t.decided && this.ready(t.start)) this.decideStrike(t);
      if (t.decided) {
        switch (t.resp) {
          case RESP.BLOCK:
            return this.guardStep(s.op.x, t.cm.guard !== 1 && !s.op.air);
          case RESP.PARRY: {
            const toActive = t.cm.startup - s.op.mvF;
            const perfect = P.parry >= 4;
            if (!this.parryPress && (!perfect || toActive <= 2)) {
              this.parryPress = true;
              return { d: 5, b: B.PARRY };
            }
            return this.guardStep(s.op.x, t.cm.guard !== 1);
          }
          case RESP.IMPACT:
            if (!t.acted && this.kit.impact >= 0) {
              t.acted = true;
              this.startMove(this.kit.impact, false);
              return this.pad.shift();
            }
            return null;
          case RESP.THROW:
            if (!t.acted && this.kit.throwF >= 0 && this.inReach(this.kit.throwF)) {
              t.acted = true;
              this.startMove(this.kit.throwF, false);
              return this.pad.shift();
            }
            return this.guardStep(s.op.x, true);
          case RESP.TOOL:
            if (!t.acted && t.tool >= 0 && this.canUse(t.tool)) {
              t.acted = true;
              this.startMove(t.tool, false);
              return this.pad.shift();
            }
            return null;
          case RESP.JUMP:
            if (!t.acted) {
              t.acted = true;
              this.stats.jumps++;
              this.pad.push([{ d: 7, b: 0 }, { d: 7, b: 0 }]);
              return this.pad.shift();
            }
            return null;
          default:
            break;
        }
      }
    }
    // jump-ins
    const j = this.jump;
    if (j && !j.done) {
      if (!j.decided && this.ready(j.start)) this.decideJump(j);
      if (j.decided && j.resp === RESP.AA && !j.fired) {
        const aa = this.antiAirPick();
        if (aa >= 0) {
          j.fired = true;
          this.stats.aaFired++;
          this.startMove(aa, false);
          return this.pad.shift();
        }
        if (s.dist < 200000 && s.op.vy <= 0) return this.guardStep(s.op.x, false);
      }
      if (j.decided && j.resp === RESP.BLOCK && s.dist < 220000) return this.guardStep(s.op.x, false);
    }
    this.parryPress = false;
    return this.projGuard();
  }

  /**
   * Does move `idx`, started now, put a hitbox on the opponent's hurtbox on some active frame? Positions
   * are predicted per sim step: mine from the move's authored travel (ground) or my ballistic arc (air),
   * the opponent's from its visible velocity (ballistic while airborne, standing still on the ground).
   * Box / hurtbox geometry exactly as core/sim/boxes.ts (hitbox centred, hurtbox from the feet up).
   */
  connects(idx: number): boolean {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    const mi = this.kit.moves[idx];
    const cm = mi.cm;
    if (cm.nBox === 0) return false;
    const lag = mi.recipe ? mi.recipe.lag : 1;
    const fc = me.facing;
    const oh = op.air ? op.cf.hurtAir : op.crouch ? op.cf.hurtCrouch : op.cf.hurtStand;
    const ohw = oh[0] >> 1;
    const og = op.cf.g;
    const opDive = op.st === ST.ATTACK && op.cm !== null && op.cm.hasAirVel;
    const mg = me.cf.g;
    for (let j = 0; j < cm.nBox; j++) {
      const q = j * 7;
      const f0 = cm.boxes[q];
      const f1 = cm.boxes[q + 1];
      const bx = cm.boxes[q + 2];
      const by = cm.boxes[q + 3];
      const bw2 = cm.boxes[q + 4] >> 1;
      const bh2 = cm.boxes[q + 5] >> 1;
      for (let fr = f0; fr <= f1; fr++) {
        const kk = lag + fr - 1;
        // opponent
        let px = op.x;
        let py = op.y;
        if (op.air) {
          px = op.x + op.vx * kk;
          py = opDive ? op.y + op.vy * kk : op.y + op.vy * kk - (og * kk * (kk - 1)) / 2;
          if (py <= 0) return false; // it lands first
        }
        // me
        let mx: number;
        let my: number;
        if (me.air) {
          mx = me.x + me.vx * kk;
          my = me.y + me.vy * kk - (mg * kk * (kk - 1)) / 2;
          if (my <= 0) break; // I land first
        } else {
          mx = me.x + fc * cm.curve[Math.min(fr, cm.curve.length - 1)];
          my = cm.yCurve ? cm.yCurve[Math.min(fr, cm.yCurve.length - 1)] : 0;
        }
        const hx = mx + fc * bx;
        const hy = my + by;
        if (hx + bw2 < px - ohw || hx - bw2 > px + ohw) continue;
        if (hy + bh2 < py || hy - bh2 > py + oh[1]) continue;
        return true;
      }
    }
    return false;
  }

  /** the anti-air to fire NOW so an active frame meets the falling opponent (or -1) */
  private antiAirPick(): number {
    const s = this.seen;
    if (!s.op.air) return -1;
    const cands = this.kit.lists.antiAir.concat(this.kit.roles.antiair ?? []);
    for (const idx of cands) {
      if (!this.canUse(idx)) continue;
      const mi = this.kit.moves[idx];
      if (mi.proj || mi.grab || mi.recipe!.air) continue;
      if (this.connects(idx)) return idx;
    }
    return -1;
  }

  // ------------------------------------------------------------------ own defensive states
  private blockstunTick(): Step {
    const s = this.seen;
    const P = this.profile;
    // SHOVE out of blockstun (costs 2 bars): top levels, cornered, NERVE to spare - rarely
    const cornered = Math.abs(s.me.x) > s.wall - 120000 && s.me.x * s.dx < 0;
    const key = this.strike ? this.strike.inst : -1;
    if (P.level >= 7 && cornered && key !== this.shoveKey && this.nerveOk(this.m.sys.raw.nerve.shoveCost)) {
      this.shoveKey = key;
      if (this.rnd() < 0.08) return { d: 5, b: B.PARRY };
    }
    // blockstun auto-guards mids / overheads; lows still need crouch: always crouch-guard
    return this.guardStep(s.op.x, true);
  }

  private parryTick(): Step | null {
    const s = this.seen;
    const P = this.profile;
    const b = fighterBase(this.i);
    const ok = this.m.s[b + F.parryOk] !== 0;
    if (ok && P.parry >= 5 && !this.parryRushed && this.nerveOk(this.m.sys.raw.nerve.rushCost)) {
      // parry -> RUSH (66) -> a normal (rushTick)
      this.parryRushed = true;
      this.pad.push([{ d: 6, b: 0 }, { d: 5, b: 0 }, { d: 6, b: 0 }]);
      return this.pad.shift();
    }
    if (this.pad.busy) return this.pad.shift();
    const t = this.strike;
    const threat = (t !== null && this.live(t)) || this.projNear(10);
    if (threat) return { d: 5, b: B.PARRY };
    this.parryPress = false;
    this.parryRushed = false;
    return null;
  }

  private rushTick(): Step | null {
    // RUSH accepts a normal or a throw: the closest-reaching fast normal, then the route continues
    const s = this.seen;
    const b = fighterBase(this.i);
    const f = this.m.s[b + F.rushF];
    if (f + 2 < this.m.sys.raw.rush.startup) return null;
    for (const idx of this.kit.lists.pokes.concat(this.kit.lights)) {
      const mi = this.kit.moves[idx];
      if (!mi.normal || !mi.recipe || mi.recipe.air) continue;
      if (s.dist > mi.reach + this.opHurtHalf() + 60000) continue;
      this.route = this.newRoute([idx].concat(this.followUps(idx)));
      this.routeTick();
      return this.pad.shift();
    }
    return null;
  }

  /**
   * frames until the nearest incoming opponent projectile the CPU has REACTED to reaches my body (999 =
   * none): a projectile counts only once its reaction window opened and its latched response is to deal
   * with it (block / parry / jump) - an unseen or ignored one is walked into, honestly.
   */
  projEta(): number {
    const s = this.seen;
    let best = 999;
    for (let k = 0; k < s.nProj; k++) {
      const p = s.proj[k];
      if (p.owner === this.i || p.vx === 0) continue;
      if ((s.me.x - p.x) * p.vx <= 0) continue;
      const r = this.projResp[p.slot];
      if (this.projKey[p.slot] < 0 || r < 0 || r === RESP.NONE) continue;
      const gap = Math.abs(s.me.x - p.x) - (p.w >> 1) - (s.me.cf.hurtStand[0] >> 1);
      const eta = Math.max(0, Math.floor(gap / Math.abs(p.vx)));
      if (eta < best) best = eta;
    }
    return best;
  }

  /** would starting move `idx` now run into an incoming projectile before its first active frame? */
  projBlocksStart(idx: number): boolean {
    const eta = this.projEta();
    if (eta >= 999) return false;
    const mi = this.kit.moves[idx];
    const t = this.timeToActive(idx) + 2;
    if (eta > t) return false;
    const inv = mi.cm.inv;
    return !(inv[6] > 0 && inv[6] <= 1 && inv[7] >= t); // projectile-invulnerable through it
  }

  private projNear(frames: number): boolean {
    const s = this.seen;
    for (let k = 0; k < s.nProj; k++) {
      const p = s.proj[k];
      if (p.owner === this.i || p.vx === 0) continue;
      if ((s.me.x - p.x) * p.vx <= 0) continue;
      const gap = Math.abs(s.me.x - p.x) - (p.w >> 1) - (s.me.cf.hurtStand[0] >> 1);
      if (gap / Math.abs(p.vx) <= frames) return true;
    }
    return false;
  }

  private techTick(): Step | null {
    const s = this.seen;
    const b = fighterBase(this.i);
    const key = s.frame - s.me.stF;
    if (key !== this.throwKey) {
      this.throwKey = key;
      let rate = this.profile.tech;
      if (this.profile.guessAdapt > 0) rate += this.profile.guessAdapt * this.mixHist.filter((k) => k === 3).length / 3;
      this.techGo = this.rnd() < rate;
      this.techDone = false;
    }
    if (this.techGo && !this.techDone && this.m.s[b + F.techWin] > 0) {
      this.techDone = true;
      this.stats.techTries++;
      return { d: 5, b: B.THROW };
    }
    return null;
  }

  private wakeTick(): number {
    const s = this.seen;
    const me = s.me;
    const P = this.profile;
    const key = s.frame - me.stF;
    if (key !== this.kdKey) {
      this.kdKey = key;
      this.pad.clear();
      const behind = me.x * s.dx < 0 ? Math.abs(me.x) : 0; // my back is to that wall
      this.kdBackRise = me.kd !== 2 && P.level >= 3 && behind < s.wall - 150000 && this.rnd() < P.backRise;
      this.kdReversal = -1;
      if (P.level >= 5 && this.rnd() < P.wakeReversal * P.punish) {
        const rev = (this.kit.roles.reversal ?? []).filter((k) => {
          const mi = this.kit.moves[k];
          return mi.invStrike && !mi.recipe!.air && mi.recipe!.charge === 0;
        });
        if (rev.length > 0) this.kdReversal = rev[Math.floor(this.rnd() * rev.length)];
      }
      this.kdGuard = this.rnd() < Math.max(P.guard, P.block * 0.5);
    }
    const wf = this.m.sys.raw.kd.wakeupFrames;
    if (this.kdBackRise && me.stun <= wf + 1 && me.stun >= wf - 1) return this.out({ d: 5, b: B.L | B.H });
    if (this.pad.busy) return this.out(this.pad.shift());
    if (this.kdReversal >= 0 && me.stun === 3 && s.dist < 180000) {
      const idx = this.kdReversal;
      this.kdReversal = -1;
      const mi = this.kit.moves[idx];
      const sb = this.seen.me;
      const costOk = (mi.cm.costShow === 0 || sb.show >= mi.cm.costShow) && (mi.cm.costNerve === 0 || this.nerveOk(mi.cm.costNerve));
      if (costOk && mi.recipe) {
        this.pad.push(mi.recipe.steps);
        return this.out(this.pad.shift());
      }
    }
    if (this.kdGuard && me.stun <= 3) return this.out(this.guardStep(s.op.x, true));
    return this.out(null);
  }

  // ------------------------------------------------------------------ punish + confirm
  /** frames the opponent still needs before it can act (0 = not punishable now) */
  private opRecovery(): number {
    const op = this.seen.op;
    if (op.st === ST.ATTACK && op.cm && !op.air && op.mvF > op.cm.lastActive) return op.cm.total - op.mvF;
    if (op.st === ST.LAND || op.st === ST.RECOVER || op.st === ST.PARRY_REC) return op.stun;
    return 0;
  }

  private punishTick(): boolean {
    const s = this.seen;
    const P = this.profile;
    const t = this.strike;
    if (!t || t.punished || t.pRoll >= P.punish) return false;
    const op = s.op;
    const sameMove = (op.st === ST.ATTACK && op.inst === t.inst) || op.st === ST.LAND || op.st === ST.RECOVER;
    if (!sameMove) return false;
    const rem = this.opRecovery();
    if (rem <= 0) return false;
    if (!t.blocked) {
      // a whiff: visible from the first recovery frame; needs part of the reaction delay
      if (t.whiffAt < 0) t.whiffAt = s.frame;
      if (s.frame - t.whiffAt < Math.ceil(((P.reactF - 1) * P.whiffReactPct) / 100)) return false;
    }
    let steps = this.buildRoute(rem, true);
    if (!steps && t.blocked && this.opFastest < 99) {
      // not punishable, but I am plus: a normal that is active before the opponent's fastest button can be
      // (frame advantage + its fastest startup) wins or trades - the answer to mashed lights
      steps = this.buildRoute(rem + this.opFastest - 1, true);
      if (steps && !this.kit.moves[steps[0]].normal) steps = null;
      if (steps) this.stats.interrupts++;
    }
    if (!steps || this.projBlocksStart(steps[0])) return false;
    t.punished = true;
    this.stats.punishes++;
    if (!t.blocked) this.stats.whiffPunishes++;
    this.route = this.newRoute(steps);
    this.routeTick();
    return this.pad.busy;
  }

  /** the opponent is reeling from MY hit and I am free (jump-in, counter hit, link): continue */
  private confirmTick(): boolean {
    const s = this.seen;
    const P = this.profile;
    if (P.route < 2) return false;
    const op = s.op;
    if (op.st !== ST.HITSTUN || op.combo <= 0) return false;
    const steps = this.buildRoute(op.stun, false);
    if (!steps || this.projBlocksStart(steps[0])) return false;
    this.route = this.newRoute(steps);
    this.routeTick();
    return this.pad.busy;
  }

  /** chain / cancel follow-ups after `idx` from the fighter's combo list (for routes built on the fly) */
  followUps(idx: number): number[] {
    const combo = this.kit.lists.combo;
    const k = combo.indexOf(idx);
    if (k >= 0) return combo.slice(k + 1);
    return combo.length > 0 ? combo.slice(-1) : [];
  }

  private estDamage(steps: number[]): number {
    let d = 0;
    for (let k = 0; k < steps.length; k++) d += (this.kit.moves[steps[k]].damage * SCALE[Math.min(k, SCALE.length - 1)]) / 100;
    return d;
  }

  /**
   * A punish / confirm route whose first move lands inside `window` frames and reaches, shaped by the
   * level's punish route (FIGHTING_DESIGN §10: jab .. best + corner route).
   */
  buildRoute(window: number, punish: boolean): number[] | null {
    const P = this.profile;
    const kit = this.kit;
    const fits = (idx: number): boolean => this.canUse(idx) && !kit.moves[idx].recipe!.air && this.timeToActive(idx) <= window && this.inReach(idx);
    const R = P.route;
    const cands: number[][] = [];
    if (R === 0) {
      const j = kit.lights.find(fits);
      return j !== undefined ? [j] : null;
    }
    const singles = kit.groundStrikes.filter((k) => fits(k) && !kit.moves[k].proj);
    for (const k of kit.lists.punish) if (fits(k) && singles.indexOf(k) < 0) singles.push(k);
    if (R === 1) {
      let best = -1;
      for (const k of singles) if (best < 0 || kit.moves[k].damage > kit.moves[best].damage) best = k;
      return best >= 0 ? [best] : null;
    }
    const combo = kit.lists.combo.filter((k) => kit.moves[k].recipe !== null);
    if (combo.length > 0 && fits(combo[0])) {
      if (R === 2) cands.push(combo.slice(0, 2));
      else if (R === 3) cands.push(combo.length > 2 ? [combo[0], combo[combo.length - 1]] : combo.slice());
      else cands.push(combo.slice());
    }
    for (const k of singles) cands.push(R >= 3 ? [k].concat(this.cancelEnder(k)) : [k]);
    // meter enders / super punishes
    const withMeter = R === 5 || R >= 7;
    const sups: number[] = [];
    if (withMeter && P.meter >= 2) {
      if (kit.sup3 >= 0 && this.canUse(kit.sup3)) sups.push(kit.sup3);
      if (kit.sup1 >= 0 && this.canUse(kit.sup1)) sups.push(kit.sup1);
    }
    if (sups.length > 0) {
      for (const sp of sups) if (fits(sp)) cands.push([sp]);
      const add: number[][] = [];
      for (const c of cands) {
        const last = kit.moves[c[c.length - 1]].cm;
        for (const sp of sups) if (last.cSuper && P.meter >= 4) add.push(c.concat([sp]));
      }
      for (const a of add) cands.push(a);
    }
    if (cands.length === 0) return null;
    if (R <= 5 && R !== 5) return cands[0];
    let best = cands[0];
    let bd = -1;
    for (const c of cands) {
      let d = this.estDamage(c);
      if (R === 8 && this.nearWall() && kit.moves[c[c.length - 1]].cm.wallSplat) d *= 1.15;
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    void punish;
    return best;
  }

  private cancelEnder(k: number): number[] {
    const cm = this.kit.moves[k].cm;
    if (!cm.cSpecial) return [];
    const combo = this.kit.lists.combo;
    const last = combo.length > 0 ? combo[combo.length - 1] : -1;
    if (last >= 0 && last !== k && this.kit.moves[last].special && this.kit.moves[last].recipe) return [last];
    return [];
  }

  nearWall(): boolean {
    const s = this.seen;
    return Math.abs(s.op.x) > s.wall - 150000 && s.op.x * s.dx > 0;
  }

  newRoute(steps: number[]): Route {
    this.stats.routes++;
    this.hold = null;
    return { steps, k: 0, phase: 0, deadline: 0, contactSeen: false, linkPending: false, confirm: this.profile.route >= 4 };
  }

  /** advances the running route; queues the next step's inputs into the pad when it is time */
  private routeTick(): void {
    const r = this.route;
    if (!r) return;
    const s = this.seen;
    const me = s.me;
    const idx = r.steps[r.k];
    const mi = this.kit.moves[idx];
    if (r.phase === 0) {
      if (!mi || !mi.recipe) {
        this.route = null;
        return;
      }
      const costOk = (mi.cm.costShow === 0 || me.show >= mi.cm.costShow) && (mi.cm.costNerve === 0 || me.nerve > 0);
      if (!costOk) {
        this.route = null;
        return;
      }
      this.pad.push(r.k === 0 ? this.movePlan(idx, true) : mi.recipe.steps);
      this.stats.routeSteps++;
      if (mi.super > 0) this.stats.supers++;
      r.phase = 1;
      r.deadline = s.frame + mi.recipe.lag + 8 + (r.k > 0 && me.st === ST.ATTACK && me.cm ? Math.max(0, me.cm.total - me.mvF) : 0);
      r.contactSeen = false;
      r.linkPending = false;
      return;
    }
    if (r.phase === 1) {
      if (me.st === ST.ATTACK && me.mv === idx && me.mvF <= 3) {
        r.phase = 2;
        return;
      }
      if (s.frame > r.deadline) this.route = null;
      return;
    }
    // phase 2: step k is running
    if (me.mv !== idx || me.st !== ST.ATTACK) {
      if (r.linkPending && r.k + 1 < r.steps.length && isFree(me.st)) {
        r.k++;
        r.phase = 0;
        this.routeTick();
        return;
      }
      this.route = null;
      return;
    }
    if (!r.contactSeen && me.contact !== 0) {
      r.contactSeen = true;
      if (r.k + 1 >= r.steps.length) {
        this.route = null;
        return;
      }
      const next = this.kit.moves[r.steps[r.k + 1]];
      if (r.confirm && me.contact !== 1 && (next.special || next.super > 0)) {
        this.route = null; // blocked: do not finish into an unsafe special
        return;
      }
      if (r.k >= 0 && this.profile.drop > 0 && this.rnd() < this.profile.drop) {
        this.stats.drops++;
        this.route = null;
        return;
      }
      if (cancelsInto(mi.cm, next.cm)) {
        r.k++;
        r.phase = 0;
        this.routeTick();
        return;
      }
      r.linkPending = true;
    }
    if (r.linkPending && me.mvF >= mi.cm.total - 2) {
      r.k++;
      r.phase = 0;
      this.routeTick();
    }
  }

  // ------------------------------------------------------------------ air
  private airTick(): Step | null {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    const key = s.frame - me.stF;
    if (Math.abs(this.airKey - key) > 2) {
      this.airKey = key;
      this.airUsed = false;
    }
    if (this.airUsed) return null;
    const kit = this.kit;
    const cands: number[] = [];
    if (this.style.air > 0) for (const k of kit.lists.air) cands.push(k);
    for (const mi of kit.moves) if (mi.recipe && mi.recipe.air && mi.normal && mi.reach > 0) cands.push(mi.idx);
    cands.sort((a, b) => kit.moves[b].damage - kit.moves[a].damage);
    void op;
    for (const idx of cands) {
      if (!this.canUse(idx) || !this.connects(idx)) continue;
      this.airUsed = true;
      this.startMove(idx, false);
      return this.pad.shift();
    }
    return null;
  }

  // ------------------------------------------------------------------ neutral
  private neutralTick(): Step | null {
    const s = this.seen;
    const expired = this.hold !== null && s.frame >= this.hold.until;
    if (s.frame >= this.nextThink || expired) {
      const P = this.profile;
      this.hold = null;
      this.nextThink = s.frame + P.thinkF + Math.floor(this.rnd() * (P.thinkF / 2 + 1));
      const dec = this.planner ? this.planner(this) : ({ t: 'none', frames: P.thinkF } as Decision);
      this.lastDecision = dec;
      this.apply(dec);
      if (this.route) {
        this.routeTick();
        if (this.pad.busy) return this.pad.shift();
      }
      if (this.pad.busy) return this.pad.shift();
    }
    const h = this.hold;
    if (!h) return null;
    if (h.guard) return this.guardStep(s.op.x, h.crouch);
    return { d: h.d, b: 0 };
  }

  apply(dec: Decision): void {
    const f = this.seen.frame;
    switch (dec.t) {
      case 'hold':
        this.hold = { d: dec.d, guard: false, crouch: false, until: f + dec.frames };
        break;
      case 'guard':
        this.hold = { d: 5, guard: true, crouch: dec.crouch, until: f + dec.frames };
        break;
      case 'move':
        if (!this.startMove(dec.idx)) this.hold = null;
        break;
      case 'route':
        if (dec.steps.length > 0) this.route = this.newRoute(dec.steps);
        break;
      case 'steps':
        this.hold = null;
        this.pad.push(dec.steps);
        break;
      default:
        this.hold = null;
        break;
    }
  }

  /** debug read-back for the harness */
  debug(): { decision: string; route: string; hold: string } {
    const d = this.lastDecision;
    return {
      decision: d ? d.t + ('idx' in d ? ':' + this.kit.moves[d.idx]?.id : '') : '-',
      route: this.route ? this.route.steps.map((k) => this.kit.moves[k].id).join('>') + '@' + this.route.k : '-',
      hold: this.hold ? (this.hold.guard ? 'guard' + (this.hold.crouch ? '1' : '4') : 'd' + this.hold.d) : '-',
    };
  }
}
