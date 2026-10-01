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
//
// CHANGED(AI3D) (CONTRACT §35.9, §35.15, §35.17) - the 3D ring. sense.ts projects everything onto the fight line, so the
// 1D rules above hold off the spawn line. Added on the same honesty rules:
//   * SIDESTEP on reaction (RESP.STEP): a reacted LINEAR / straight strike or an incoming projectile is answered with a
//     sidestep (share `step` of the reaction chance, the SAME latched roll) only when a step started NOW still takes
//     me off it - played in a sandbox from the visible situation (ring3d.ts StepOracle): never vs homing moves, and on
//     an 18-60 f reaction mostly vs slow linear moves and projectiles at range (STEPTUNE §35.15 table).
//   * READ steps (plans.ts): a sidestep in the opponent's range as a guess from its LINEAR habit (habits.linearRate).
//   * the whiff of a stepped move is punished from the side: punishTick also runs from SIDESTEP (from the sim's step buffer
//     frame m.sys.stepBufferF: 2 since fix_core §35.20, was 9) and SIDEWALK; patch / spin step-attacks (SS.H, ctx 'step'
//     recipes) are route candidates there.
//   * a STEPPING opponent: a visible SIDEWALK is answered on the reaction clock (latched roll < `antiStep`) with a
//     homing / cpu.antiStep move that reaches; a step HABIT (habits.stepRate) turns pokes into homing moves (plans.ts).
//   * circle-walks (a held STEP; Decision 'circle'): off my wall, and the opponent onto its wall (plans.ts + ring3d.ts);
//     reactions still run while circling (back = the sim's circle -> block cancel).

import type { Match } from '../sim/state.ts';
import type { CMove } from '../sim/compile.ts';
import { K, UK } from '../sim/compile.ts';
import { F, PH, ST, fighterBase } from '../sim/layout.ts';
import { mulberry32 } from '../rng.ts';
import { B, Pad, STEP_BITS, awayBits } from './pad.ts';
import type { Step } from './pad.ts';
import { isFree, isStep, newSeen, sense } from './sense.ts';
import { StepOracle, stepOrder } from './ring3d.ts';
import type { FView, Seen } from './sense.ts';
import { buildKit, cancelsInto } from './kit.ts';
import type { Kit, MoveInfo, Recipe } from './kit.ts';
import type { BossTools } from './boss.ts';
import { HK, Habits } from './habits.ts';
import { DEFAULT_UNIQUE_RATES, UniqueTools } from './uniques.ts';

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
  /**
   * CHANGED(AI) P2: weight 0..1 of the opponent's observed HABITS (habits.ts) in the guesses a reaction cannot make:
   * whether to hold a guard in its range (its attack rate), crouch or stand (its lows vs overheads), tech / escape a
   * throw (its throw share), wake-up / pressure reads. 0 = the flat P1 guesses.
   */
  habit: number;
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
  // ---- CHANGED(AI3D) (cpu.json levels / personas; default 0 = off, no RNG roll, no sandbox run)
  /** share of the reaction (block) chance spent on a SIDESTEP when a step started now evades the reacted attack */
  step: number;
  /** chance per neutral decision in the opponent's range to sidestep as a READ (x its linear habit x habit weight) */
  stepGuess: number;
  /** chance per neutral decision to circle-walk off my wall (and, x 0.3, to circle the opponent onto its wall) */
  circle: number;
  /** chance to answer a visibly circling opponent / a step habit with a homing (cpu.antiStep) move */
  antiStep: number;
  /**
   * CHANGED(fix_balance) (CONTRACT §35.21): chance per neutral decision at footsies spacing (just outside / at the edge of
   * the opponent's threat range) to circle-walk around it to reposition (x the style's ringWalk) - the 3D ring by plan, not
   * only at the wall
   */
  walk: number;
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
  /**
   * CHANGED(fix_balance) (CONTRACT §35.21): the style's appetite for the 3D ring, multipliers on the level levers -
   * `ringWalk` x the neutral circle-walk lever (footsies / zoning kits reposition by circling, the FREAK stomps straight in),
   * `ringStep` x the read-sidestep levers (close-range kits step more, a zoner less). Default 1 = the level as written.
   */
  ringWalk: number; ringStep: number;
}

export const DEFAULT_STYLE: StyleParams = {
  throw: 0.25, poke: 0.45, jump: 0.06, dash: 0.1, walkIn: 0.45, zone: 0.3, approach: 0.1, grab: 0, armor: 0, counter: 0,
  backOff: 0.15, jumpProj: 0.15, mix: 0.2, air: 0, setup: 0, escape: 0, charge: false, ringWalk: 1, ringStep: 1,
};

/** Responses a reaction can pick (latched per threat). */
export const RESP = { NONE: 0, BLOCK: 1, PARRY: 2, AA: 3, IMPACT: 4, THROW: 5, TOOL: 6, JUMP: 7, BACKDASH: 8, STEP: 9 } as const;

export type Decision =
  | { t: 'hold'; d: number; frames: number }
  | { t: 'guard'; crouch: boolean; frames: number }
  | { t: 'move'; idx: number }
  | { t: 'route'; steps: number[] }
  | { t: 'steps'; steps: Step[] }
  // CHANGED(AI3D): hold STEP bit `bit` for `frames` frames (1 = a sidestep tap, > 15 = a circle-walk); `atk` = a step-attack
  // (move index) to fire from the step when it reaches, -1 none
  | { t: 'circle'; bit: number; frames: number; atk: number }
  | { t: 'none'; frames: number };

export interface Threat {
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
  /** CHANGED(AI3D): the STEP bit a RESP.STEP response taps */
  stepBit: number;
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
  // CHANGED(AI) P2
  /** unique tool moves the planner started (uniques.ts) */
  uniques: number;
  counterReads: number;
  stepReads: number;
  rekicks: number;
  uniqueCancels: number;
  stances: number;
  stanceFollows: number;
  rekkas: number;
  /** neutral guard postures chosen from the opponent's habits (attack rate in range) */
  habitGuards: number;
  /** close-range throw escapes (back off / strike) chosen from its throw habit */
  throwEscapes: number;
  /** supers that finished the round (kill rule) */
  superKills: number;
  wakeSupers: number;
  /** weave / duck reads vs a presser of high buttons */
  evadeReads: number;
  /** Lv3 punishes on a full meter */
  lv3Cash: number;
  // CHANGED(AI3D)
  /** reaction sidesteps started vs strikes / vs projectiles */
  stepsReact: number;
  stepsProj: number;
  /** read sidesteps (plans.ts, linear habit) */
  stepGuesses: number;
  /** strikes / projectiles of the opponent that ended without touching me while I was stepping (sidestep / circle-walk) */
  stepEvades: number;
  /** of those: LINEAR moves */
  linearEvades: number;
  /** circle-walks started: off my wall / the opponent onto its wall */
  circlesEscape: number;
  circlesCorner: number;
  /** CHANGED(fix_balance): neutral repositioning circle-walks (footsies spacing) / read steps vs its walk-in */
  circlesWalk: number;
  approachSteps: number;
  /** CHANGED(fix_balance): pokes swung into a command-grab walk-in (brain.antiGrabPoke) */
  antiGrabPokes: number;
  /** homing / antiStep answers to a stepping opponent (reaction to its visible circle-walk + habit pokes) */
  antiSteps: number;
  /** step-attacks started (SS.<btn>) */
  stepAttacks: number;
  /** punishes started out of a sidestep / circle-walk */
  sidePunishes: number;
  /** sandbox runs of the step oracle */
  oracleRuns: number;
}

function blankStats(): BrainStats {
  return {
    frames: 0, threats: 0, reacted: 0, blocksChosen: 0, parries: 0, aaChosen: 0, aaFired: 0, punishes: 0, whiffPunishes: 0, interrupts: 0,
    routes: 0, routeSteps: 0, drops: 0, techTries: 0, supers: 0, tools: 0, impacts: 0, throws: 0, jumps: 0, respects: 0, spacePokes: 0,
    uniques: 0, counterReads: 0, stepReads: 0, rekicks: 0, uniqueCancels: 0, stances: 0, stanceFollows: 0, rekkas: 0, habitGuards: 0,
    throwEscapes: 0, superKills: 0, wakeSupers: 0, evadeReads: 0, lv3Cash: 0,
    stepsReact: 0, stepsProj: 0, stepGuesses: 0, stepEvades: 0, linearEvades: 0, circlesEscape: 0, circlesCorner: 0, antiSteps: 0,
    stepAttacks: 0, sidePunishes: 0, oracleRuns: 0, circlesWalk: 0, approachSteps: 0, antiGrabPokes: 0,
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
  /**
   * CHANGED(fix_balance) (CONTRACT §35.21): centre distance (U) inside which the opponent's longest COMMAND grab connects
   * (its push front + my push front + the grab's gap; frame data, like opReach); 0 = it has none. Its fastest startup.
   */
  opGrabU = 0;
  opGrabF = 99;
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
  // ---- CHANGED(AI) P2
  /** the opponent's observed habits (visible only, committed after the reaction delay) */
  habits: Habits;
  /** unique-move planner (uniques.ts); rates from cpu.json `uniques` */
  uniq: UniqueTools = new UniqueTools(DEFAULT_UNIQUE_RATES);
  /** recipe tables by phase ([0] phase 1, [1] phase 2 of a `phases` kit or null) */
  private kits: [Kit | null, Kit | null] = [null, null];
  private blockReadKey = -1;
  /** cpu.json rules.lv1Spend: chance a Lv3-capable CPU spends a Lv1 in a route while it has < 3 bars */
  lv1Spend = 0.35;
  /** cpu.json rules.lv3Cash: chance a full-meter CPU (3 bars, Lv3 allowed) punishes with its Lv3 when it reaches */
  lv3Cash = 0.6;
  /** the latched "spend a Lv1 now" roll (rolled once each time my bar count changes, never per frame) */
  spendLv1 = false;
  private lastBars = -1;
  // ---- CHANGED(AI3D)
  /** the sandbox that answers "does a step now evade it" (ring3d.ts) */
  readonly oracle = new StepOracle();
  /**
   * the running step plan: hold `bit` until frame `until` (a tap = 1 frame), fire step-attack `atk` from the step when it
   * reaches (-1 none); `started` = the step began (the plan ends when I am free again)
   */
  circle: { bit: number; until: number; atk: number; started: boolean } | null = null;
  /** the opponent's visible step (start frame key) + the latched anti-step roll for it */
  private opStepKey = -1;
  private opStepRoll = 1;
  private opStepDone = false;
  private projStepB = new Int32Array(12);
  /** the opponent move instance / projectile slot+inst that was live while I stepped (evade bookkeeping) */
  private stepWatch = -1;
  private stepWatchLinear = false;
  private stepWatchTouched = false;
  /** CHANGED(fix_balance): the sense of my last neutral circle-walk (+1 / -1: the sim's stepDir sense), kept across walks */
  walkSense = 1;

  constructor(profile: Profile, seed: number, style: StyleParams | null = null) {
    this.profile = profile;
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x6a09e667);
    this.style = style ?? DEFAULT_STYLE;
    this.pad = new Pad(profile.delayF);
    this.habits = new Habits(profile.reactF, profile.thinkF);
  }

  // ------------------------------------------------------------------ binding
  bind(m: Match, i: number): void {
    this.m = m;
    this.i = i;
    this.kit = buildKit(m.data, m.cf[i], m.cfg.p[i].scheme);
    // CHANGED(AI) P2: a `phases` kit re-routes its SIMPLE keys and Lv3 in phase 2 - its own measured recipe table
    this.kits = [this.kit, m.cf[i].uk === UK.PHASES ? buildKit(m.data, m.cf[i], m.cfg.p[i].scheme, 2) : null];
    this.habits = new Habits(this.profile.reactF, this.profile.thinkF);
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
    // CHANGED(fix_balance): its command grabs (cmdgrab / EX grab kinds; normal throws are the close range, supers need a bar)
    let gU = 0;
    let gF = 99;
    const mcf = m.cf[i];
    for (const cm of ocf.moves) {
      if (!cm.isGrab || cm.snapId < 0 || cm.inAir || cm.isSuper || (cm.kind !== K.cmdgrab && cm.kind !== K.ex)) continue;
      const u = cm.grabGap >= 0 ? ocf.pushFS + mcf.pushFS + cm.grabGap : cm.grabReach + mcf.pushFS;
      if (u > gU) gU = u;
      if (cm.startup < gF) gF = cm.startup;
    }
    this.opGrabU = gU;
    this.opGrabF = gF;
    if (this.profile.step > 0) this.oracle.warm(m); // CHANGED(AI3D): the step oracle's sandbox (never touches m)
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
      const st0 = this.rcp(k)!.steps[0];
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
   * CHANGED(fix_balance) (CONTRACT §35.21): vs a command-grab walk-in - the most damaging ground normal (or not badly unsafe
   * plain special) of mine whose box
   * meets the opponent where its visible walk brings it (it stops to grab once inside its grab range, opGrabU), active at
   * least 2 frames before its fastest grab could be (frame data: opGrabF) from where it gets into that range. The same
   * geometry as spacePoke (a strike that is out first beats a grab). -1 if none.
   */
  antiGrabPoke(): number {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    if (me.air || op.air || this.opGrabU <= 0) return -1;
    const d = s.dist;
    const cf = op.cf;
    const dashV = cf.dashFFrames > 0 ? Math.floor((cf.dashF[cf.dashFFrames] ?? 0) / cf.dashFFrames) : 0;
    const closingNow = op.st === ST.WALK_F ? cf.walkF : op.st === ST.DASH_F ? dashV : 0;
    const closing = Math.max(closingNow, cf.walkF);
    const stopAt = Math.max(0, this.opGrabU - 5000);
    const tin = d <= this.opGrabU ? 0 : Math.ceil((d - this.opGrabU) / closing);
    const charged = this.chargeKit && me.chB >= this.m.sys.raw.motion.chargeFrames;
    let best = -1;
    let bestDmg = -1;
    for (const k of this.kit.groundStrikes) {
      const mi = this.kit.moves[k];
      // normals, and plain specials that are not badly unsafe (a rush / lunge can meet a grappler whose grab out-ranges
      // every normal: Bruno's WALK IN L connects from ~2.2 m)
      if (!(mi.normal || (mi.special && !mi.ex && mi.advBlock >= -14)) || mi.inert || mi.proj || mi.grab || !this.canUse(k)) continue;
      const rc = this.rcp(k)!;
      if (rc.ctx !== '' || rc.air) continue;
      const st0 = rc.steps[0];
      if (mi.normal && charged && (st0.d === 6 || st0.d === 3 || st0.d === 9)) continue;
      const t = this.connectsAt(k, closingNow, stopAt);
      if (t < 0 || t > tin + this.opGrabF - 2) continue;
      if (mi.damage > bestDmg) {
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
    const lag = this.rcpLag(idx);
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

  /** is the charge a charge recipe needs stored now? (the CPU's OWN charge counters; kit charge numbers per fighter) */
  private chargeReady(r: Recipe): boolean {
    if (r.charge === 0) return true;
    const me = this.seen.me;
    const mw = this.kit.cf.mw;
    const need = mw.chargeFrames;
    const keep = mw.chargeKeep;
    if (r.charge === 1) return me.chB >= need || (me.chBS >= need && me.chBR <= keep - 1);
    return me.chD >= need || (me.chDS >= need && me.chDR <= keep - 1);
  }

  /**
   * CHANGED(AI) P2: the recipe to use for `idx` NOW: the measured one, or - for a charge motion without the charge
   * stored - the no-charge alternative (SIMPLE S+dir); null = cannot be input now.
   */
  rcp(idx: number): Recipe | null {
    const mi = this.kit.moves[idx];
    if (!mi || !mi.recipe) return null;
    if (this.chargeReady(mi.recipe)) return mi.recipe;
    return mi.alt;
  }
  rcpLag(idx: number): number {
    const r = this.rcp(idx) ?? this.kit.moves[idx]?.recipe;
    return r ? r.lag : 1;
  }

  /** usable right now (recipe, meter, projectile limit, air state, charge stored, meter policy, unique rules) */
  canUse(idx: number): boolean {
    if (idx < 0 || idx >= this.kit.moves.length) return false;
    const mi = this.kit.moves[idx];
    const r = this.rcp(idx);
    if (!r) return false;
    const me = this.seen.me;
    const cm = mi.cm;
    // CHANGED(AI) P2: context recipes only in their context (stance follow-ups in STANCE; chain parts from the parent)
    if (r.ctx === 'stance' && me.st !== ST.STANCE) return false;
    if (r.ctx === 'chain' && !(me.st === ST.ATTACK && me.cm !== null && me.cm.chains.indexOf(idx) >= 0)) return false;
    if (r.ctx === '' && me.st === ST.STANCE && !(cm.isSpecialCat || cm.isSuper || cm.isGrab || cm.isImpact)) return false;
    // CHANGED(AI3D): step-attacks only out of a step; while stepping, a plain one-button normal whose button has a
    // step-attack comes out as the step-attack (the sim's routing, §35.12.5), so it is not that normal there
    const stepping = me.st === ST.SIDESTEP || me.st === ST.SIDEWALK;
    if (r.ctx === 'step' && !stepping) return false;
    if (stepping && r.ctx === '' && cm.isNormalCat && r.steps.length === 1) {
      const bt = r.steps[0].b;
      const k = bt & B.H ? 2 : bt & B.M ? 1 : bt & B.L ? 0 : -1;
      if (k >= 0 && this.kit.stepAtk[k] >= 0) return false;
    }
    if (r.air !== me.air) return false;
    if (cm.costShow > 0 && me.show < cm.costShow) return false;
    if (cm.costNerve > 0 && !this.nerveOk(cm.costNerve)) return false;
    const P = this.profile;
    if (mi.ex && P.meter < 1) return false;
    if (mi.super === 1 && P.meter < 2) return false;
    if (mi.super === 3 && P.meter < 3) return false;
    if (cm.isImpact && !this.nerveOk(this.m.sys.raw.nerve.impactCost)) return false;
    if (cm.proj && cm.ballAct === 0 && this.myProjCount() >= cm.proj.limit) return false;
    if (!this.uniq.canUse(this, mi)) return false;
    return true;
  }

  /** CHANGED(AI) P2: frames a projectile move's shot needs to fly from its spawn point to the opponent's body (0 others) */
  projTravel(idx: number): number {
    const pj = this.kit.moves[idx].cm.proj;
    if (!pj || pj.vx <= 0) return 0;
    const gap = this.seen.dist - pj.x - (pj.w >> 1) - this.opHurtHalf();
    return gap > 0 ? Math.ceil(gap / pj.vx) : 0;
  }

  /** frames from now until `idx`'s first active frame */
  timeToActive(idx: number): number {
    const mi = this.kit.moves[idx];
    return this.rcpLag(idx) + mi.firstActive - 1;
  }

  private others: number[] | null = null;
  private othersKit: Kit | null = null;
  /** CHANGED(AI) P2: plain special strikes of my kit in no fighter JSON cpu list (neutral recipe, not a tool / projectile) */
  otherSpecials(): number[] {
    if (this.others && this.othersKit === this.kit) return this.others;
    const kit = this.kit;
    const listed = new Set<number>();
    for (const k of Object.keys(kit.lists) as (keyof typeof kit.lists)[]) for (const x of kit.lists[k]) listed.add(x);
    const out: number[] = [];
    for (const mi of kit.moves) {
      if (!mi.special || mi.ex || mi.super > 0 || mi.inert || mi.proj || mi.grab || mi.tool !== '' || !mi.recipe || mi.recipe.ctx !== '' || mi.recipe.air) continue;
      if (!listed.has(mi.idx)) out.push(mi.idx);
    }
    this.others = out;
    this.othersKit = kit;
    return out;
  }

  /** CHANGED(AI) P2: centre distance (U) inside which the opponent's longest ground normal reaches me (+0.25 m) */
  opThreatU(): number {
    return this.opReach + (this.seen.me.cf.hurtStand[0] >> 1) + 25000;
  }

  /** CHANGED(AI) P2: would `idx` input with `lag` frames of input from now reach (grab range / exact box prediction)? */
  inReachFrom(idx: number, lag: number): boolean {
    const mi = this.kit.moves[idx];
    if (mi.proj) return true;
    if (mi.grab) return this.inReach(idx);
    return this.connects(idx, lag);
  }
  connectsFrom(idx: number, lag: number): boolean {
    return this.connects(idx, lag);
  }
  /** is the strike threat `t` still coming (public for uniques.ts) */
  threatLive(t: Threat): boolean {
    return this.live(t);
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
    const r = this.rcp(idx);
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

  /**
   * crouch-or-stand guess for a guard posture (guess weights + adaptation, FIGHTING_DESIGN §10). CHANGED(AI) P2: blended
   * with the opponent's HABIT (habits.ts: its share of lows vs overheads close in, x confidence x the level's `habit`
   * weight) - a crouch guard is right against lows and mids, a standing one against overheads and mids.
   */
  chooseGuardCrouch(): boolean {
    let p = 0.5;
    if (this.opOverheadF >= this.profile.reactF) p = 0.85; // overheads are reactable at this level: crouch by default
    const h = this.habits;
    const lo = h.pLow();
    const oh = h.pOverhead();
    const w = this.profile.habit * h.confidence();
    if (w > 0) p = (1 - w) * p + w * ((lo + 0.03) / (lo + oh + 0.06));
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
    const me = this.seen.me;
    // CHANGED(AI3D): a press out of SIDEWALK keeps the circling STEP held on that frame (a released STEP ends the walk
    // into the STEP_END settle before the press could act - core/sim/fighter.ts sidewalkTick)
    if (step && me.st === ST.SIDEWALK && (step.b & ~STEP_BITS) !== 0 && (step.b & STEP_BITS) === 0) {
      const held = this.m.s[fighterBase(this.i) + F.stepIn] !== 0 ? B.STEP_IN : B.STEP_OUT;
      step = { d: step.d, b: step.b | held, raw: step.raw };
    }
    return this.pad.out(step, me.facing);
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
    // CHANGED(AI) P2: a `phases` kit after its phase change plays its phase-2 recipe table (own state, u0 = phase)
    if (this.kits[1]) {
      const want = s.me.uq[0] === 2 ? this.kits[1] : this.kits[0]!;
      if (this.kit !== want) this.kit = want;
    }
    if (s.cin) return this.out(null);
    this.track();
    this.evadeBook();
    this.habits.tick(s.frame);
    const bars = this.showBars();
    if (bars !== this.lastBars) {
      this.lastBars = bars;
      this.spendLv1 = this.rnd() < this.lv1Spend;
    }
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
    // CHANGED(AI) P2: the stance (Lotus) and my running unique moves (weave / dive / armor step cancels) have drivers
    if (st === ST.STANCE) {
      // the reaction clock runs in the stance too (the stance driver answers a DECIDED threat: hop / lean / leave)
      const t = this.strike;
      if (t && !t.decided && this.live(t) && this.ready(t.start)) this.decideStrike(t);
      return this.out(this.uniq.busy(this));
    }
    if (st === ST.ATTACK) {
      const u = this.uniq.busy(this);
      if (u) return this.out(u);
    }
    // CHANGED(AI3D): sidestep / circle-walk / settle
    if (isStep(st)) return this.out(this.stepTick());
    if (!isFree(st)) {
      // busy (own move, dash, landing, recovery): hold the guard a decided reaction wants, so the first
      // free frame already blocks; otherwise nothing
      return this.out(st === ST.ATTACK ? null : this.reactGuard());
    }
    // ---- free on the ground
    // CHANGED(AI3D): the step plan ended with the step (or never started before its last frame)
    if (this.circle && (this.circle.started || s.frame >= this.circle.until)) this.circle = null;
    if (this.punishTick()) return this.out(this.pad.shift());
    // CHANGED(AI) P2: the first free frame after my blockstun: a counter read vs its frame-trap habit (uniques.ts)
    if (prev === ST.BLOCKSTUN && this.blockReadKey !== s.frame) {
      this.blockReadKey = s.frame;
      const c = this.uniq.counterRead(this, 'block');
      if (c >= 0 && this.startMove(c, false)) {
        this.stats.counterReads++;
        this.uniq.started(c);
        return this.out(this.pad.shift());
      }
    }
    const r = this.reactTick();
    if (r) return this.out(r);
    if (this.confirmTick()) return this.out(this.pad.shift());
    if (this.circle && !this.circle.started && s.frame < this.circle.until) return this.out({ d: 5, b: this.circle.bit });
    if (this.pad.busy) return this.out(this.pad.shift());
    return this.out(this.neutralTick());
  }

  resetRound(): void {
    this.uniq.resetRound();
    this.habits.resetRound();
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
    this.circle = null; // CHANGED(AI3D)
    this.opStepKey = -1;
    this.stepWatch = -1;
  }

  // ------------------------------------------------------------------ threat tracking (visible only)
  private track(): void {
    const s = this.seen;
    const op = s.op;
    let newAttack = false;
    // a new opponent move instance = a new attack to react to (ONE latched roll)
    if (op.st === ST.ATTACK && op.cm) {
      if (!this.strike || this.strike.inst !== op.inst) {
        newAttack = true;
        // CHANGED(AI) P2: the habit it just showed (committed after my reaction delay - pattern knowledge for the NEXT one)
        const cm0 = op.cm;
        if (cm0.proj) this.habits.action(s.frame, HK.PROJ);
        // CHANGED(fix_balance): a command grab counts from as far as it reaches (brain.opGrabU) - it is close offense too
        else if (!op.air && s.dist <= Math.max(this.opThreatU(), cm0.isGrab ? this.opGrabU : 0) + 40000) {
          if (cm0.isGrab) this.habits.action(s.frame, HK.THROW);
          else if (cm0.isStrike && cm0.nBox > 0) {
            this.habits.action(s.frame, cm0.guard === 2 ? HK.LOW : cm0.guard === 1 ? HK.OVERHEAD : HK.MID);
            let lo = 1 << 30;
            for (let k = 0; k < cm0.nBox; k++) lo = Math.min(lo, cm0.boxes[k * 7 + 3] - (cm0.boxes[k * 7 + 5] >> 1));
            this.habits.strikeHeight(s.frame, lo >= 105000);
            this.habits.strikeClass(s.frame, cm0.homing ? 2 : cm0.linear ? 1 : 0); // CHANGED(AI3D)
          }
        }
        this.strike = {
          inst: op.inst, mv: op.mv, cm: op.cm, start: s.frame - Math.max(0, op.mvF - 1), roll: this.rnd(), pRoll: this.rnd(),
          resp: RESP.NONE, decided: false, acted: false, blocked: false, whiffAt: -1, punished: false, tool: -1, stepBit: 0,
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
        if (s.dist < 320000) this.habits.action(s.frame, HK.JUMP);
      }
    } else if (this.jump && !this.jump.done) this.jump.done = true;
    // CHANGED(AI) P2: habit samplers - its attack rate while free in its range, its wake-up / after-block pressure
    {
      const opFree = op.st === ST.IDLE || op.st === ST.CROUCH || op.st === ST.WALK_F || op.st === ST.WALK_B;
      const groundStart = newAttack && !op.air;
      this.habits.rangeFrame(s.frame, opFree && !op.air && s.dist <= this.opThreatU(), groundStart);
      const mySt = s.me.st;
      const myPrev = this.lastMySt;
      this.habits.wakeFrame(s.frame, myPrev === ST.KNOCKDOWN && mySt !== ST.KNOCKDOWN, groundStart);
      this.habits.blockFrame(s.frame, myPrev === ST.BLOCKSTUN && mySt !== ST.BLOCKSTUN, groundStart);
    }
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
    // CHANGED(AI3D): its visible steps - the start (one latched anti-step roll per step) + its neutral habit near me
    if (op.st === ST.SIDESTEP && ps !== ST.SIDESTEP && ps !== ST.SIDEWALK) {
      this.opStepKey = s.frame - Math.max(0, op.stF);
      this.opStepRoll = this.rnd();
      this.opStepDone = false;
    } else if (op.st !== ST.SIDESTEP && op.st !== ST.SIDEWALK) this.opStepKey = -1;
    if (ps !== op.st && s.dist <= this.opThreatU() + 60000) {
      const fromFree = ps === ST.IDLE || ps === ST.CROUCH || ps === ST.WALK_F || ps === ST.WALK_B;
      if (op.st === ST.SIDESTEP && fromFree) this.habits.neutralAction(s.frame, true);
      else if (fromFree && ((op.st === ST.ATTACK && !op.air) || op.st === ST.DASH_F || op.st === ST.DASH_B || op.st === ST.PREJUMP)) this.habits.neutralAction(s.frame, false);
    }
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
    if (st === ST.HITSTUN || st === ST.BLOCKSTUN || st === ST.THROWN || st === ST.KNOCKDOWN) {
      this.hold = null;
      this.circle = null; // CHANGED(AI3D)
    }
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
    // CHANGED(AI3D): a sidestep that still takes me off this attack (share `step` of the reaction chance, the SAME roll;
    // never vs homing moves / cinematics / projectile throws (the projectile itself: projGuard); the sandbox plays it
    // from the visible situation - ring3d.ts StepOracle). Tools / uniques answer first.
    const stepOk = P.step > 0 && r < P.block * P.step && !cm.homing && cm.cin === null && cm.proj === null && isFree(s.me.st) && !s.me.air;
    const tryStep = (): boolean => {
      if (!stepOk) return false;
      const bit = this.stepEvadeBit(t);
      if (bit === 0) return false;
      resp = RESP.STEP;
      t.stepBit = bit;
      return true;
    };
    if (cm.isImpact && tryStep()) {
      // stepped
    } else if (cm.isImpact) {
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
      } else if (r < P.block) {
        // CHANGED(AI) P2: a unique answer to the reacted strike - a counter whose catch window covers its active
        // frames, a low-profile move under a high attack (uniques.ts); the SAME latched roll, scaled inside
        const u = this.uniq.react(this, cm, s.op.mvF, r / Math.max(0.01, P.block));
        if (u >= 0) {
          resp = RESP.TOOL;
          t.tool = u;
        }
      }
      if (resp === RESP.NONE) tryStep();
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
      if (p.owner === this.i || p.miss) continue; // CHANGED(AI3D): its straight path already passes beside me
      const toward = (me.x - p.x) * p.vx > 0;
      if (!toward || p.vx === 0) continue;
      if (!this.ready(this.projStart[p.slot])) continue;
      let resp = this.projResp[p.slot];
      const gap = Math.abs(me.x - p.x) - (p.w >> 1) - (me.cf.hurtStand[0] >> 1);
      const eta = gap / Math.max(1, Math.abs(p.vx));
      const r = this.projRoll[p.slot];
      if (resp < 0) {
        const share = P.parry >= 2 ? P.parryShare : P.parry === 1 ? P.parryShare : 0;
        // CHANGED(AI) P2: a unique answer first (a counter that catches projectiles, a teleport through it, a duck /
        // dive under it - uniques.ts), inside the block chance with the SAME latched roll
        const u = r < P.block && isFree(me.st) ? this.uniq.proj(this, p, Math.floor(eta), r / Math.max(0.01, P.block), false) : -1;
        // CHANGED(AI3D): a sidestep off its line (share `step` of the block chance; the sandbox checks it evades)
        let sb = 0;
        if (u === -1 && P.step > 0 && r < P.block * P.step && isFree(me.st) && !me.air) sb = this.projStepBit(eta);
        if (u !== -1) resp = RESP.TOOL;
        else if (sb !== 0) {
          resp = RESP.STEP;
          this.projStepB[p.slot] = sb;
        } else if (share > 0 && r < P.block * share && this.nerveOk(this.m.sys.raw.parry.costStart)) resp = RESP.PARRY;
        else if (r < P.block * Math.min(1, this.style.jumpProj + P.antiZone) && s.dist > 180000) resp = RESP.JUMP;
        else if (r < P.block) resp = RESP.BLOCK;
        else resp = RESP.NONE;
        this.projResp[p.slot] = resp;
        if (resp === RESP.BLOCK) this.stats.blocksChosen++;
      }
      if (resp === RESP.TOOL) {
        const go = isFree(me.st) ? this.uniq.proj(this, p, Math.floor(eta), r / Math.max(0.01, P.block), true) : -1;
        if (go >= 0 && this.startMove(go, false)) {
          this.projResp[p.slot] = RESP.NONE;
          this.stats.tools++;
          this.uniq.started(go);
          return this.pad.shift();
        }
        if (go === -2 && eta > 3) continue;
        this.projResp[p.slot] = RESP.BLOCK; // the window passed / not free: block it
        resp = RESP.BLOCK;
      }
      if (resp === RESP.STEP) {
        if (isFree(me.st)) {
          const bit = this.projStepB[p.slot];
          this.projResp[p.slot] = RESP.NONE;
          this.stats.stepsProj++;
          this.circle = { bit, until: s.frame + 1, atk: -1, started: false };
          return { d: 5, b: bit };
        }
        this.projResp[p.slot] = RESP.BLOCK; // not free any more: block it
        resp = RESP.BLOCK;
      }
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
              this.uniq.started(t.tool);
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
          case RESP.STEP: // CHANGED(AI3D): tap the step the oracle found (one frame; the sim plays the 15-frame arc)
            if (!t.acted) {
              t.acted = true;
              this.stats.stepsReact++;
              this.circle = { bit: t.stepBit, until: s.frame + 1, atk: -1, started: false };
              return { d: 5, b: t.stepBit };
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
    // CHANGED(AI3D): a visibly circling opponent, on the reaction clock (a 15 f sidestep is over before any reaction can
    // land; a held circle-walk is not): one latched roll per step; a homing / cpu.antiStep move once it reaches
    const op = s.op;
    if ((op.st === ST.SIDESTEP || op.st === ST.SIDEWALK) && this.opStepKey >= 0 && !this.opStepDone && this.ready(this.opStepKey)) {
      if (this.opStepRoll >= P.antiStep) this.opStepDone = true;
      else {
        const k = this.antiStepPick();
        if (k >= 0 && this.startMove(k, false)) {
          this.opStepDone = true;
          this.stats.antiSteps++;
          return this.pad.shift();
        }
      }
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
  connects(idx: number, lagOverride = -1): boolean {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    const mi = this.kit.moves[idx];
    const cm = mi.cm;
    if (cm.nBox === 0) return false;
    const lag = lagOverride >= 0 ? lagOverride : this.rcpLag(idx);
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
    const cands: number[] = [];
    // CHANGED(AI) P2: a super as the anti-air on a full meter (Lv3, 3 bars) / a spare bar (Lv1) - only a super that is
    // invulnerable to air attacks from frame 1 (it wins, never trades); the jump's latched roll decides (no re-roll)
    const j = this.jump;
    const P = this.profile;
    if (j && j.roll < P.antiAir * 0.5) {
      const kit = this.kit;
      if (P.meter >= 3 && kit.sup3 >= 0 && this.showBars() >= 3) cands.push(kit.sup3);
      if (P.meter >= 2 && kit.sup1 >= 0 && (!(P.meter >= 3 && kit.sup3 >= 0) || this.showBars() >= 3 || j.roll < P.antiAir * this.lv1Spend * 0.5)) cands.push(kit.sup1);
    }
    for (let k = cands.length - 1; k >= 0; k--) {
      const cm = this.kit.moves[cands[k]].cm;
      if (!(cm.inv[4] > 0 && cm.inv[4] <= 1 && cm.inv[5] >= cm.startup) && !(cm.inv[0] > 0 && cm.inv[0] <= 1 && cm.inv[1] >= cm.startup)) cands.splice(k, 1);
    }
    for (const k of this.kit.lists.antiAir.concat(this.kit.roles.antiair ?? [])) cands.push(k);
    for (const idx of cands) {
      if (!this.canUse(idx)) continue;
      const mi = this.kit.moves[idx];
      if (mi.proj || mi.grab || this.rcp(idx)!.air) continue;
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
      if (p.owner === this.i || p.vx === 0 || p.miss) continue; // CHANGED(AI3D): p.miss = passes beside me
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
      if (p.owner === this.i || p.vx === 0 || p.miss) continue; // CHANGED(AI3D)
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
      // CHANGED(AI) P2: a throw-happy opponent gets teched more (its throw share, x confidence x habit weight)
      rate += 0.5 * this.profile.habit * this.habits.confidence() * this.habits.pThrow();
      rate = Math.min(0.9, rate);
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
      // CHANGED(AI) P2: the wake-up read scales with its meaty habit (habits.wakeRate: did it attack my last wake-ups?)
      const h = this.habits;
      const meaty = 1 + P.habit * (h.wakeRate - 0.5) * 2; // 0..2 x
      if (P.level >= 5 && this.rnd() < P.wakeReversal * P.punish * meaty) {
        const rev = (this.kit.roles.reversal ?? []).filter((k) => {
          const mi = this.kit.moves[k];
          return mi.invStrike && mi.recipe !== null && !mi.recipe.air && mi.recipe.charge === 0 && mi.recipe.ctx === '';
        });
        // an invulnerable super is a reversal too (Lv1 / Lv3 all start strike-invulnerable) - when the meter policy allows
        for (const sp of [this.kit.sup1, this.kit.sup3]) {
          if (sp < 0 || rev.indexOf(sp) >= 0) continue;
          const mi = this.kit.moves[sp];
          if (!mi.revInv || !mi.recipe || mi.recipe.air || (mi.super === 1 && P.meter < 2) || (mi.super === 3 && P.meter < 3)) continue;
          if (this.seen.me.show >= mi.cm.costShow) rev.push(sp);
        }
        if (rev.length > 0) this.kdReversal = rev[Math.floor(this.rnd() * rev.length)];
      }
      // a counter read on the wake-up (Rerun / Ricky) vs its meaty habit
      if (this.kdReversal < 0) {
        const c = this.uniq.counterRead(this, 'wake');
        if (c >= 0) this.kdReversal = c;
      }
      const g0 = Math.max(P.guard, P.block * 0.5);
      this.kdGuard = this.rnd() < Math.min(0.95, (1 - P.habit) * g0 + P.habit * Math.max(g0 * 0.5, P.block * h.wakeRate));
    }
    const wf = this.m.sys.raw.kd.wakeupFrames;
    if (this.kdBackRise && me.stun <= wf + 1 && me.stun >= wf - 1) return this.out({ d: 5, b: B.L | B.H });
    if (this.pad.busy) return this.out(this.pad.shift());
    // CHANGED(AI) P2: a motion reversal starts early enough that its button lands inside the wake-up buffer
    const revLen = this.kdReversal >= 0 && this.kit.moves[this.kdReversal].recipe ? this.kit.moves[this.kdReversal].recipe!.steps.length : 0;
    if (this.kdReversal >= 0 && me.stun === Math.max(3, revLen) && s.dist < 180000) {
      const idx = this.kdReversal;
      this.kdReversal = -1;
      const mi = this.kit.moves[idx];
      const sb = this.seen.me;
      const costOk = (mi.cm.costShow === 0 || sb.show >= mi.cm.costShow) && (mi.cm.costNerve === 0 || this.nerveOk(mi.cm.costNerve));
      if (costOk && mi.recipe) {
        if (mi.super > 0) this.stats.wakeSupers++;
        if (mi.tool === 'counter') {
          this.stats.counterReads++;
          this.uniq.started(idx);
        }
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
    // CHANGED(AI3D): out of a sidestep the first action comes out on step frame 11 (presses buffer from 9)
    const rem = this.opRecovery() - this.stepWait();
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
    for (let k = 0; k < steps.length; k++) {
      const mi = this.kit.moves[steps[k]];
      const rc = this.rcp(steps[k]);
      // SIMPLE one-button specials / supers deal x0.8; supers keep their minimum share (30 % Lv1 / 50 % Lv3)
      const simple = rc !== null && rc.simple && (mi.special || mi.super > 0) ? 0.8 : 1;
      const sc = Math.max(SCALE[Math.min(k, SCALE.length - 1)], mi.super === 3 ? 50 : mi.super === 1 ? 30 : 0);
      d += (mi.damage * simple * sc) / 100;
    }
    return d;
  }

  /**
   * A punish / confirm route whose first move lands inside `window` frames and reaches, shaped by the
   * level's punish route (FIGHTING_DESIGN §10: jab .. best + corner route).
   */
  buildRoute(window: number, punish: boolean): number[] | null {
    const P = this.profile;
    const kit = this.kit;
    // CHANGED(AI) P2: a projectile "lands" when it has flown to the opponent, not on its spawn frame
    const fits = (idx: number): boolean => this.canUse(idx) && !this.rcp(idx)!.air && this.timeToActive(idx) + this.projTravel(idx) <= window && this.inReach(idx);
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
    // meter enders / super punishes. CHANGED(AI) P2: the 'cancel' meter tier (L6+, FIGHTING_DESIGN §10 "all + cancel
    // supers") cancels its hit-confirms into a super even on a meterless punish route; and at ANY route tier a super
    // that finishes the round is taken when the meter policy allows it (Lv1 from 'lv1', Lv3 from 'all'), the cheapest
    // one that kills first.
    const withMeter = R === 5 || R >= 7 || (P.meter >= 4 && !punish);
    const sups: number[] = [];
    // CHANGED(AI) P2: a CPU that may spend Lv3 ('all' tier) saves bars toward PRIME TIME: with 1-2 bars a Lv1 goes into
    // a route only as a kill or `rules.lv1Spend` of the time (one roll per route) - so its Lv3 appears too
    const saving = P.meter >= 3 && kit.sup3 >= 0 && this.showBars() < 3 && !this.spendLv1;
    if (P.meter >= 2) {
      if (kit.sup3 >= 0 && this.canUse(kit.sup3)) sups.push(kit.sup3);
      if (kit.sup1 >= 0 && this.canUse(kit.sup1)) sups.push(kit.sup1);
    }
    const opHp = this.seen.op.hp;
    const kills: number[][] = [];
    if (sups.length > 0) {
      const base = cands.slice();
      for (const sp of sups) if (fits(sp)) {
        if (withMeter && !(saving && sp === kit.sup1)) cands.push([sp]);
        if (this.estDamage([sp]) >= opHp) kills.push([sp]);
      }
      for (const c of base) {
        const last = kit.moves[c[c.length - 1]].cm;
        for (const sp of sups) {
          if (!last.cSuper || P.meter < 4) continue;
          const cc = c.concat([sp]);
          if (withMeter && !(saving && sp === kit.sup1)) cands.push(cc);
          if (this.estDamage(cc) >= opHp && this.estDamage(c) < opHp) kills.push(cc);
        }
      }
    }
    if (kills.length > 0) {
      // the cheapest kill (Lv1 before Lv3), the shortest route among those
      kills.sort((a, b) => kit.moves[a[a.length - 1]].super - kit.moves[b[b.length - 1]].super || a.length - b.length);
      this.stats.superKills++;
      return kills[0];
    }
    // CHANGED(AI) P2: a full RATINGS meter (3 bars) at a level allowed Lv3 ('all' tier, L5+) cashes PRIME TIME on a
    // clean punish (`rules.lv3Cash` of the time) - every kit's Lv3 shows up, not only as a kill
    if (P.meter >= 3 && kit.sup3 >= 0 && this.showBars() >= 3 && sups.indexOf(kit.sup3) >= 0 && fits(kit.sup3) && this.rnd() < this.lv3Cash) {
      this.stats.lv3Cash++;
      return [kit.sup3];
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

  /** CHANGED(AI) P2: the super to cancel a confirmed hit into now (-1 none): reaches, affordable, policy */
  private superCancel(): number {
    const kit = this.kit;
    const opHp = this.seen.op.hp;
    const cands: number[] = [];
    if (kit.sup3 >= 0 && this.canUse(kit.sup3)) cands.push(kit.sup3);
    if (kit.sup1 >= 0 && this.canUse(kit.sup1)) {
      const saving = kit.sup3 >= 0 && this.profile.meter >= 3 && this.showBars() < 3;
      const kills = this.estDamage([kit.sup1]) * 0.7 >= opHp;
      if (!saving || kills || this.spendLv1) cands.push(kit.sup1);
    }
    for (const sp of cands) {
      const mi = kit.moves[sp];
      if (mi.proj || this.inReachFrom(sp, this.rcpLag(sp))) {
        this.stats.supers++;
        return sp;
      }
    }
    return -1;
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
      const rc = mi ? (r.k === 0 || mi.recipe === null || mi.recipe.ctx === '' ? this.rcp(idx) : mi.recipe) : null;
      if (!mi || !rc) {
        this.route = null;
        return;
      }
      // a motion trigger for a chain part waits out the hitstop: typed inside it, the button's release re-reads the
      // same motion as the PARENT special (negative edge) and overwrites the buffered chain (core/sim/inputs.ts;
      // measured: CLASSIC 236M during CUE 1's hitstop -> no CUE 2; after it -> CUE 2)
      if (r.k > 0 && rc.ctx === 'chain' && rc.steps.length > 1 && me.hitstop > 0) return;
      // CHANGED(AI3D): a sidestep ignores presses before its buffer frame (core/sim/inputs.ts parseAction; m.sys.stepBufferF,
      // 2 since fix_core §35.20 - CHANGED(fix_balance): comment only, the code always followed the number)
      if (me.st === ST.SIDESTEP && me.stF + 2 < this.m.sys.stepBufferF) return;
      const costOk = (mi.cm.costShow === 0 || me.show >= mi.cm.costShow) && (mi.cm.costNerve === 0 || me.nerve > 0);
      if (!costOk) {
        this.route = null;
        return;
      }
      this.pad.push(r.k === 0 ? this.movePlan(idx, true) : rc.steps);
      this.stats.routeSteps++;
      if (mi.super > 0) this.stats.supers++;
      r.phase = 1;
      r.deadline = s.frame + rc.lag + 8 + (r.k > 0 && me.st === ST.ATTACK && me.cm ? Math.max(0, me.cm.total - me.mvF) : 0);
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
        // CHANGED(AI) P2: a rekka continues on contact (Patch CUE 1 -> 2 -> 3 overhead / low, uniques.ts rekka)
        let ext = this.profile.route >= 3 ? this.uniq.rekka(this, idx, me.contact) : -1;
        // CHANGED(AI) P2: the 'cancel' meter tier (L6+) cancels a CONFIRMED hit into a super (Lv3 with 3 bars, else a Lv1
        // unless it is saving toward Lv3 - or the Lv1 kills)
        if (ext < 0 && me.contact === 1 && mi.cm.cSuper && this.profile.meter >= 4) ext = this.superCancel();
        if (ext >= 0 && !(this.profile.drop > 0 && this.rnd() < this.profile.drop)) {
          this.stats.rekkas++;
          r.steps.push(ext);
          r.k++;
          r.phase = 0;
          this.routeTick();
          return;
        }
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

  // ------------------------------------------------------------------ 3D ring (CHANGED(AI3D))
  /** frames a press made now waits before it can act out of my running sidestep (0 elsewhere) */
  stepWait(): number {
    const me = this.seen.me;
    if (me.st !== ST.SIDESTEP) return 0;
    return Math.max(0, this.m.sys.stepAttackF - (me.stF + 2));
  }

  /**
   * The STEP bit (STEP_IN / STEP_OUT) of a sidestep started NOW that the reacted strike `t` does not touch - and that
   * it WOULD touch if I stood still - or 0. The sense with more room behind it is tried first.
   */
  private stepEvadeBit(t: Threat): number {
    const s = this.seen;
    const rem = Math.max(6, Math.min(90, t.cm.total - s.op.mvF + 3));
    const o = this.oracle;
    const r0 = o.runs;
    let bit = 0;
    if (o.touched(this.m, this.i, () => 0, rem, t.inst) >= 0) {
      for (const b of stepOrder(this.m, s)) {
        if (o.touched(this.m, this.i, (k) => (k === 0 ? b : 0), rem, t.inst) < 0) {
          bit = b;
          break;
        }
      }
    }
    this.stats.oracleRuns += o.runs - r0;
    return bit;
  }

  /** the STEP bit of a sidestep started now that the incoming projectiles (arriving in ~`eta` f) all miss, or 0 */
  private projStepBit(eta: number): number {
    const s = this.seen;
    const rem = Math.max(8, Math.min(90, eta + 30));
    const o = this.oracle;
    const r0 = o.runs;
    let bit = 0;
    if (o.touched(this.m, this.i, () => 0, rem, -1) >= 0) {
      for (const b of stepOrder(this.m, s)) {
        if (o.touched(this.m, this.i, (k) => (k === 0 ? b : 0), rem, -1) < 0) {
          bit = b;
          break;
        }
      }
    }
    this.stats.oracleRuns += o.runs - r0;
    return bit;
  }

  /** a homing / cpu.antiStep move that reaches the opponent now (fastest first; aimed projectiles count), or -1 */
  antiStepPick(): number {
    const kit = this.kit;
    let best = -1;
    let bt = 1 << 30;
    for (const k of kit.lists.antiStep.concat(kit.homingStrikes)) {
      const mi = kit.moves[k];
      if (mi.inert || !this.canUse(k)) continue;
      const rc = this.rcp(k)!;
      if (rc.ctx !== '' || rc.air) continue;
      if (mi.proj ? !(mi.cm.proj && mi.cm.proj.aimed) : !this.inReach(k)) continue;
      const tt = this.timeToActive(k) + this.projTravel(k);
      if (tt < bt) {
        bt = tt;
        best = k;
      }
    }
    return best;
  }

  /**
   * Evade bookkeeping (stats only): an opponent strike started in reach while I was stepping / circling, that ended
   * without touching me, is an evade (linear ones counted apart).
   */
  private evadeBook(): void {
    const s = this.seen;
    const me = s.me;
    const op = s.op;
    const stepping = me.st === ST.SIDESTEP || me.st === ST.SIDEWALK;
    const touchedMe = me.st === ST.HITSTUN || me.st === ST.BLOCKSTUN || me.st === ST.JUGGLE || me.st === ST.KNOCKDOWN || me.st === ST.THROWN || me.st === ST.CRUMPLE || me.st === ST.WALL_SPLAT;
    if (this.stepWatch >= 0) {
      if (touchedMe) this.stepWatchTouched = true;
      const sameMove = op.st === ST.ATTACK && op.inst === this.stepWatch && op.cm !== null;
      const over = !sameMove || (op.cm !== null && op.mvF > op.cm.lastActive);
      if (over) {
        if (!this.stepWatchTouched && !(sameMove && op.contact !== 0)) {
          this.stats.stepEvades++;
          if (this.stepWatchLinear) this.stats.linearEvades++;
        }
        this.stepWatch = -1;
      }
    }
    if (this.stepWatch < 0 && stepping && op.st === ST.ATTACK && op.cm && !op.air && op.cm.isStrike && op.cm.nBox > 0 && op.mvF <= op.cm.lastActive) {
      if (op.inst !== this.lastWatched && s.dist <= cmReach(op.cm) + (me.cf.hurtStand[0] >> 1) + 30000) {
        this.lastWatched = op.inst;
        this.stepWatch = op.inst;
        this.stepWatchLinear = op.cm.linear;
        this.stepWatchTouched = false;
      }
    }
  }
  private lastWatched = -1;

  /**
   * One frame in SIDESTEP / SIDEWALK / STEP_END: reactions (a decided block = back, which leaves a circle-walk into the
   * guard; a sidestep blocks from step frame 12), the whiff punish from the side and a planned step-attack once presses
   * act (from the step buffer frame m.sys.stepBufferF / SIDEWALK), else keep holding the step plan's bit until it ends.
   */
  private stepTick(): Step | null {
    const s = this.seen;
    const me = s.me;
    const c = this.circle;
    if (c) c.started = true;
    const g = this.reactGuard();
    if (g) {
      this.circle = null;
      return g;
    }
    if (me.st === ST.STEP_END) return null;
    const canPress = me.st === ST.SIDEWALK || me.stF + 2 >= this.m.sys.stepBufferF;
    if (canPress) {
      if (this.punishTick()) {
        this.stats.sidePunishes++;
        this.circle = null;
        return this.pad.shift();
      }
      if (c && c.atk >= 0) {
        const k = c.atk;
        if (this.canUse(k) && this.inReachFrom(k, this.stepWait() + 1)) {
          c.atk = -1;
          this.circle = null;
          if (this.startMove(k, false)) {
            this.stats.stepAttacks++;
            return this.pad.shift();
          }
        } else if (me.st === ST.SIDESTEP && me.stF + 2 >= this.m.sys.stepFrames) c.atk = -1; // out of reach: let it go
      }
    }
    if (c && s.frame < c.until) return { d: 5, b: c.bit };
    return null;
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
    // CHANGED(AI3D): a step plan (tap / circle-walk) - its first frame starts the sidestep from the free state
    const c = this.circle;
    if (c && !c.started && s.frame < c.until) return { d: 5, b: c.bit };
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
      case 'move': {
        // CHANGED(AI) P2: a rekka starter runs as a route so its trigger parts can follow on contact
        const cm = this.kit.moves[dec.idx]?.cm;
        const rekka = cm !== undefined && cm.nBox > 0 && this.profile.route >= 3 && cm.chains.some((c) => this.kit.moves[c].cm.trigger !== null && this.kit.moves[c].special);
        if (rekka && this.canUse(dec.idx)) this.route = this.newRoute([dec.idx]);
        else if (!this.startMove(dec.idx)) this.hold = null;
        break;
      }
      case 'route':
        if (dec.steps.length > 0) this.route = this.newRoute(dec.steps);
        break;
      case 'steps':
        this.hold = null;
        this.pad.push(dec.steps);
        break;
      case 'circle': // CHANGED(AI3D)
        this.hold = null;
        this.circle = { bit: dec.bit, until: f + Math.max(1, dec.frames), atk: dec.atk, started: false };
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
      hold: this.circle ? `step${this.circle.bit === B.STEP_IN ? 'IN' : 'OUT'}@${this.circle.until}` : this.hold ? (this.hold.guard ? 'guard' + (this.hold.crouch ? '1' : '4') : 'd' + this.hold.d) : '-',
    };
  }
}
