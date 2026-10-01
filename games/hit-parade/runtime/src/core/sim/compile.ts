// HIT PARADE — compile data (metres, m/s, JSON) into the integer tables the sim step reads
// (NETCODE §4 rule 9: "fighters/moves JSON are converted to Int32 tables at boot").
// Floats are used ONLY here (IEEE multiply + Math.round are exact on every engine); the step never
// sees a float. Results are cached per GameData object.

import type { FighterDef, GameData, Move, System, Vec2 } from '../types.ts';
import { SHARED_CLIPS, animGrabId, animIntroId, animStanceId, animStepId, animTauntId, animWinId, classicMoveId, exIdFor, moveStrength } from '../data.ts';
import type { GoonKindDef } from '../data.ts';
import { M, mToU, mpsToUpf, mps2ToUpf2 } from './units.ts';
import { SC } from './events.ts';
import { Q, cosQ, degToYaw } from './fx3d.ts';

// ------------------------------------------------------------------ enums
export const K = { normal: 0, command: 1, special: 2, ex: 3, super1: 4, super3: 5, throw: 6, cmdgrab: 7, projectile: 8, system: 9 } as const;
const KIND_CODE: Record<string, number> = K;

/** Guard bits: blockable standing / crouching. HL = 3, H (overhead) = 1, L (low) = 2, U = 0. */
export const GD = { STAND: 1, CROUCH: 2 } as const;

/** Motion codes. */
export const MO = { QCF: 1, QCB: 2, DP: 3, RDP: 4, HCF: 5, HCB: 6, SPD: 7, DQCF: 8, DQCB: 9, CHG_BF: 10, CHG_DU: 11, DD: 12 } as const;
const MOTION_CODE: Record<string, number> = {
  '236': MO.QCF, '214': MO.QCB, '623': MO.DP, '421': MO.RDP, '41236': MO.HCF, '63214': MO.HCB, '360': MO.SPD,
  '236236': MO.DQCF, '214214': MO.DQCB, '[4]6': MO.CHG_BF, '[2]8': MO.CHG_DU, '22': MO.DD,
};
/**
 * Priority class per motion (lower = checked first). CHANGED(SIM) P2 (CONTRACT §28.5a): a longer motion that contains a
 * shorter one wins - supers > 360 > HC > DP > QC > charge > 22 (HC used to sit below QC, so 41236 / 63214 specials could
 * never come out on kits that also have 236 / 214).
 */
export const MOTION_PRIO: Record<number, number> = {
  [MO.DQCF]: 0, [MO.DQCB]: 0, [MO.SPD]: 1, [MO.HCF]: 2, [MO.HCB]: 2, [MO.DP]: 3, [MO.RDP]: 3, [MO.QCF]: 4, [MO.QCB]: 4,
  [MO.CHG_BF]: 5, [MO.CHG_DU]: 5, [MO.DD]: 6,
};

/** CHANGED(SIM) P2: unique kinds (CFighter.uk). */
export const UK = { NONE: 0, STANCE: 1, CHARGE: 2, BALL: 3, COUNTER: 4, ARMOR_STEP: 5, TELEPORT: 6, PHASES: 7 } as const;
const UK_CODE: Record<string, number> = { none: 0, stance: 1, charge: 2, ball: 3, counter: 4, armorStep: 5, teleport: 6, phases: 7 };
/** CHANGED(SIM) P2: Move.stance codes (CMove.stanceKind) and Move.ball.act codes (CMove.ballAct). */
export const STK = { NONE: 0, ENTER: 1, FOLLOW: 2, EXIT: 3 } as const;
export const BACT = { NONE: 0, SHOOT: 1, HOVER: 2, SUMMON: 3 } as const;
/** CHANGED(SIM) P2: teleport destinations (CTeleport.to). */
export const TPD = { BEHIND: 0, FRONT: 1, HOME: 2 } as const;

// ------------------------------------------------------------------ compiled types
export interface CProj {
  vx: number; // U/frame, forward
  life: number;
  w: number;
  h: number;
  y: number;
  x: number; // spawn offset forward
  hits: number;
  limit: number;
  vy: number; // U/frame (arcing projectiles, CONTRACT 20.2)
  g: number; // U/frame^2
  ground: boolean; // rolls on the floor instead of despawning
  /** CHANGED(SIM3D) (CONTRACT §35.4): launched toward the opponent at spawn instead of along the thrower's yaw */
  aimed: boolean;
  /** CHANGED(SIM3D): hit box half-depth across the travel line (U); default = box w / 2 */
  lat: number;
}

/** CONTRACT 20.2 grab block, compiled. */
export interface CGrab {
  frames: number;
  adv: number;
  hitF: number;
  swap: boolean;
  air: boolean;
  techable: boolean;
  animId: number;
  /** CHANGED(fixer) D3: victim segments over the lock (compiled grab.victim, or the default thrown_f / thrown_b pair).
   *  Segment k runs from lock frame vF0[k] to vF0[k + 1] (the last to `frames`), shows shared clip vClip[k] (anim id)
   *  from clip time vT0[k] to vT1[k] (ms; V_SLAM / V_END resolve on the VICTIM's clip, V_OPEN = 1 clip-s per 60 f). */
  vF0: Int32Array;
  vClip: Int32Array;
  vT0: Int32Array;
  vT1: Int32Array;
  /** CHANGED(fix_core) D4 (CONTRACT §35.20): grab.path keys [lockFrame, gapU, liftU, turnYaw] x n (sorted, frames >= 1), null =
   *  none: the victim's root = the thrower's root at the connect + forward x gap, lifted (throwpose.ts holdPos).
   *  CHANGED(wf6_fixer_core) V2: stride 4 - turnYaw = the thrower's yaw turn since the connect (yaw units, multi-turn, 0 when the
   *  data gives none); `turns` = any key turns (throwCarry then turns the thrower + its victim with it) */
  path: Int32Array | null;
  turns: boolean;
  /** CHANGED(fix_core) D4: push-front gap (U) the victim is pulled to at the connect (grab.holdGapM, else system) */
  holdGap: number;
}
/** CHANGED(fixer) D3: symbolic victim clip times (resolved against the victim's own clips.json) */
export const V_SLAM = -1;
export const V_END = -2;
export const V_OPEN = -3;

/** CHANGED(fixer) D3: a shared clip as the sim needs it for victim / knockdown timing (per fighter body) */
export interface CVClip {
  durMs: number;
  slamMs: number; // marks.slam, else -1
  /** clips.json root (forward travel, U) sampled per 1/60 s: rootV[v] at v / 60 s, v = 0 .. last */
  rootV: Int32Array;
}

/** CONTRACT 20.2 special rekka trigger: the input that fires this chain-only move in the parent's window. */
export interface CTrigger {
  motion: number; // MO.* or 0 = no motion
  btnMask: number; // bit0 L bit1 M bit2 H bit3 S
  simpleDir: number; // SIMPLE "6S"-style: numpad dir (5 = neutral / any), -1 = buttons form
  simpleBtn: number; // SIMPLE buttons form mask (bit0 L bit1 M bit2 H)
}

export interface CMove {
  id: string;
  idx: number;
  snapId: number; // §17 rule 1 id, -1 for system moves
  kind: number;
  kindStr: string;
  inAir: boolean;
  inDir: number; // numpad digit of the input (5 = none)
  inBtn: number; // 0 L, 1 M, 2 H, -1 none
  chainOnly: boolean;
  throwBack: boolean;
  startup: number;
  active: number;
  recovery: number;
  total: number; // last move frame = startup + active + recovery - 1
  lastActive: number;
  damage: number;
  chipPct: number;
  hitstop: number;
  hitstun: number;
  blockstun: number;
  guard: number;
  str: number; // 0 L 1 M 2 H
  sc: number; // event strength class (§17 rule 6)
  lightStarter: boolean;
  boxes: Int32Array; // [f0, f1, x, y, w, h, hid] * nBox, U
  nBox: number;
  nHid: number;
  maxReach: number;
  hurt: Int32Array; // [f0, f1, x, y, w, h] * nHurt
  nHurt: number;
  curve: Int32Array; // cumulative forward travel (U) at move frame f, index 0..total+1
  pushHit: number;
  pushBlock: number;
  chains: number[];
  cSpecial: boolean;
  cSuper: boolean;
  cWhiff: boolean;
  js: number;
  ji: number;
  jl: number;
  kd: number; // 0 none 1 soft 2 hard
  launchVx: number;
  launchVy: number;
  wallSplat: boolean;
  groundBounce: boolean;
  crumple: boolean;
  gainShow: number;
  nerveDrain: number;
  costShow: number;
  costNerve: number;
  inv: Int32Array; // [s0,s1, t0,t1, a0,a1, p0,p1] (0,0 = none)
  armorHits: number;
  armorF0: number;
  armorF1: number;
  armorBreak: boolean;
  proj: CProj | null;
  cin: { frames: number; hitF: Int32Array; hitD: Int32Array } | null;
  animId: number;
  sfxF: Int32Array;
  sfxI: Int32Array;
  isStrike: boolean;
  isGrab: boolean;
  isSuper: boolean;
  level: number;
  isEx: boolean;
  isSpecialCat: boolean; // special / ex / projectile / cmdgrab (cancel class "special")
  isNormalCat: boolean;
  isImpact: boolean;
  isShove: boolean;
  usableAir: boolean;
  multi: number;
  grabReach: number;
  chainNames: string[];
  // CONTRACT 20.2 extensions
  hidDmg: Int32Array; // damage per hit id
  hidHs: Int32Array; // hitstop per hit id (-1 = the move's rules)
  hidF0: Int32Array; // first frame per hit id
  yCurve: Int32Array | null; // moveY: attacker root height (U) per move frame
  airVelX: number;
  airVelY: number;
  hasAirVel: boolean;
  hurtOv: Int32Array; // [f0, f1, w, h, y] * n
  nHurtOv: number;
  grab: CGrab | null;
  grabGap: number; // >= 0: pushbox-front gap reach (U) for grabs; -1 = centre reach (grabReach)
  trigger: CTrigger | null;
  airOnly: boolean;
  phase2: boolean;
  cinEndAdv: number; // -100000 = system default
  cinEndGap: number; // -1 = keep positions
  /** CHANGED(fixer) D2: extra push-box front (U) per move frame 0..total+1, null = none */
  pushExt: Int32Array | null;
  // CHANGED(SIM) P2 uniques (CONTRACT §28.2). `counter` is ONLY present on counter moves (core/ai/boss.ts tests
  // `counter !== undefined`).
  counter?: CCounter;
  teleport: CTeleport | null;
  stanceKind: number; // STK.*
  ballAct: number; // BACT.*
  install: CInstall | null;
  armorStep: boolean; // listed in the fighter's unique.steps
  cinEndDown: boolean; // cinematic.endPose "front" (the victim lies face down)
  hitsTotal: number; // sum of cinematic hits (bonus rounds deal it at once)
  // CHANGED(SIM3D) (CONTRACT §35.4): tracking + lateral hit depth
  /** last move frame that re-faces the opponent (frames 1..trackUntil); homing = lastActive, linear = 1 */
  trackUntil: number;
  /** max turn per tracking frame (yaw units); 0 = full re-face */
  trackRate: number;
  homing: boolean;
  linear: boolean;
  /** hitbox half-depth across the attack line (U) */
  lateral: number;
  /** CHANGED(SIM3D): a step-attack ("SS.<btn>"): routed only while stepping (CFighter.stepAtk), never from gTable */
  stepAtk: boolean;
}

export interface CSpecial {
  motion: number;
  prio: number;
  btnMask: number; // bit0 L bit1 M bit2 H
  idx: [number, number, number, number]; // L, M, H, EX(S)
}

/** CHANGED(SIM) P2: a counter move's catch (CONTRACT §20.2 `counter`). */
export interface CCounter {
  f0: number;
  f1: number;
  strike: boolean;
  proj: boolean;
  follow: number; // move index started on a catch
}
/** CHANGED(SIM) P2: a teleport move (CONTRACT §20.2 `teleport`). */
export interface CTeleport {
  f: number;
  to: number; // TPD.*
  gap: number; // U
}
/** CHANGED(SIM) P2: an install granted by a move (CONTRACT §28.2). */
export interface CInstall {
  frames: number;
  dmgPct: number;
  walkPct: number;
}

/** CHANGED(SIM) P2: routing tables (phase 1 = the plain kit; phase 2 = with `phase: 2` moves + `phases` overrides). */
export interface CRoute {
  specials: CSpecial[];
  s5: number; s6: number; s2: number; s4: number;
  e5: number; e6: number; e2: number; e4: number;
  sup1: number;
  sup3: number;
  sAir: number;
}

/** CHANGED(SIM) P2: compiled `unique` block (the kit's numbers, system.json `uniques` defaults filled in). */
export interface CUnique {
  kind: number; // UK.*
  // stance
  stMaxF: number;
  stBlockExitF: number;
  stExitHoldF: number; // frames down must be held to exit (system uniques.stance.exitHoldF)
  stWalkF: number; // U/frame
  stWalkB: number;
  stFollow: [number, number, number]; // L, M, H move index (-1 none)
  stExit2: number;
  stExitT: number;
  stHurtW: number; // U (0 = the standing box)
  stHurtH: number;
  stHurtY: number;
  stAnim: [number, number, number]; // idle, walk_f, walk_b anim ids (-1 = shared idle / walk)
  // charge
  chargeF: number;
  keepF: number;
  standBlockPct: number;
  // ball
  respawnF: number;
  restF: number;
  pickup: number; // U
  bounces: number;
  kickRange: number; // U
  kickBack: number; // U (a ball this far behind him still counts)
  wallRest: number; // %
  looseG: number; // U/f^2
  deflectVxPct: number;
  deflectVy: number; // U/f
  looseFriction: number; // %
  // counter
  catchHitstop: number;
  // armorStep
  tickStr: number; // 0 L 1 M 2 H, -1 none
  // phases
  threshold: number; // %
  lockF: number;
}

export interface CFighter {
  def: FighterDef;
  id: string;
  nDef: number;
  moves: CMove[];
  hpMax: number;
  walkF: number;
  walkB: number;
  dashF: Int32Array; // cumulative travel per dash frame (index 0..frames)
  dashB: Int32Array;
  dashFFrames: number;
  dashBFrames: number;
  prejump: number;
  airFrames: number;
  landing: number;
  g: number;
  vy0: number;
  vxF: number;
  vxB: number;
  throwRange: number;
  hurtStand: [number, number];
  hurtCrouch: [number, number];
  hurtAir: [number, number];
  pushW: number;
  pushH: number;
  /** (front + back) / 2 standing - legacy symmetric half-width (CHANGED(fixer) D2: use the extents below) */
  pushHalf: number;
  /** CHANGED(fixer) D2: push-box extents from the root (U): standing front / back, crouching front / back */
  pushFS: number;
  pushBS: number;
  pushFC: number;
  pushBC: number;
  /** CHANGED(fixer) D3: shared victim / knockdown clips of THIS body, by shared anim id (null = not in clips.json) */
  vclips: (CVClip | null)[];
  /** CHANGED(fixer) D3: system.json anim.kdFall in ms: [kd_fall_b drop, kd_fall_b floor, kd_fall_f drop, kd_fall_f floor] */
  kdFallMs: Int32Array;
  /** CHANGED(fixer) D3: system.json anim.fallMaxFrames / wakeMaxRate (x100) */
  kdFallMax: number;
  wakeRate100: number;
  gTable: Int16Array; // ground normals [dir 0..9][btn 0..2]
  aTable: Int16Array; // air normals
  throwF: number;
  throwB: number;
  impact: number;
  shove: number;
  specials: CSpecial[];
  s5: number; s6: number; s2: number; s4: number;
  e5: number; e6: number; e2: number; e4: number;
  sup1: number;
  sup3: number;
  sAir: number; // SIMPLE jS (CONTRACT 20.4)
  assist: number[];
  // CHANGED(SIM) P2 (CONTRACT §28)
  uk: number; // UK.*
  u: CUnique;
  route1: CRoute; // phase 1 routing (= the fields above)
  route2: CRoute; // phase 2 routing (phases kind; === route1 otherwise)
  mw: { qc: number; dp: number; hc: number; spd: number; double: number; chargeFrames: number; chargeKeep: number; tap22: number };
  /** measured hurtbox extents (U) front / back per posture (data/bodies.json, §28.5c); centred when not measured */
  hurtFS: number; hurtBS: number; hurtFC: number; hurtBC: number; hurtFA: number; hurtBA: number;
  /**
   * CHANGED(wf6_fixer_core) D1: the face-down fall's measured extents (U) front / back (data/bodies.json `down`); 0 / 0 when
   * not measured (fixture kits) = no room kept after a wall splat (fighter.ts splatDrop)
   */
  downF: number; downB: number;
  animIntro: number;
  animWin: number;
  animTaunt: number;
  tauntFrames: number;
  introFrames: number;
  /** CHANGED(SIM3D): anim ids of the step clips (sidestep_l, sidestep_r, sidewalk_l, sidewalk_r), appended to the table */
  animStep: [number, number, number, number];
  /** CHANGED(SIM3D): step-attack move index per button (L, M, H; -1 none) - "SS.<btn>" moves */
  stepAtk: number[];
  /** CHANGED(fix_core) D1 (CONTRACT §35.20): this fighter's sidestep arc length (U) = fighters/<id>.json `step.distM`
   *  (the kit generator sizes it from the measured body), else system.json step.distM (0.85 m) */
  stepDist: number;
  /** CHANGED(fix_core) D1: cumulative sidestep arc travel (U) at step frame f (index 0..stepFrames) for stepDist */
  stepCurve: Int32Array;
}

export interface CSys {
  raw: System;
  wall: number;
  cap: number;
  startHalf: number;
  proxGuard: number;
  gJuggle: number;
  airResetVx: number;
  airResetVy: number;
  popVx: number;
  popVy: number;
  bounceVy: number;
  rushSpeed: number;
  techPush: number;
  backThrowOff: number;
  backRise: number;
  splatRange: number;
  frightCorner: number;
  impactSplat: number;
  projSpawnX: number;
  projScreenHalf: number;
  hitstopBySc: Int32Array;
  pushBySc: Int32Array;
  gainBySc: Int32Array;
  drainBySc: Int32Array;
  sfx: string[];
  sfxIndex: Record<string, number>;
  // CHANGED(SIM3D) (CONTRACT §35.2 / §35.3 / §35.4): system.json `ring`, `step`, `track`, `lateral`, throw front arc
  ringR: number; // default circle radius (U) when the stage has no ring
  againstWall: number; // "against the wall" range (U): IMPACT splat, STAGE FRIGHT stun
  camMinSep: number; // |P2 - P1| below this keeps the previous camN (U)
  frontArcCos: number; // cos(throw front arc half-angle), Q14
  spawnAxis: number; // default spawnAxisDeg (yaw units)
  stepFrames: number;
  /** cumulative sidestep arc travel (U) at step frame f, index 0..stepFrames, of the SYSTEM default step.distM (0.85 m).
   *  CHANGED(fix_core) D1: the sim steps each fighter by its own CFighter.stepCurve; this one stays for readers that want
   *  the default (core/ai traceCircle) */
  stepCurve: Int32Array;
  stepAttackF: number;
  stepBlockF: number;
  stepBufferF: number; // presses during a sidestep buffer from this step frame on (CHANGED(fix_core) D9: 2, held to stepAttackF)
  sidewalk: number; // U/frame tangential
  stepSettle: number;
  trackNormalOff: number; // default track.until = startup - this (normals / throws / system)
  trackSpecialOff: number; // specials / supers
  /** CHANGED(fix_core) D7 (CONTRACT §35.20): BACK HIT - cos (Q14) of the rear-arc limit (arcDeg 120 -> -8192): a hit coming
   *  from a direction whose dot with the defender's forward is below backHitCos x |dir| is a back hit */
  backHitCos: number;
  backHitDmgPct: number;
  backHitStun: number;
  /** CHANGED(fix_core) D4 (CONTRACT §35.20): grab hold - frames the victim slides to the hold point (0 = no pull) and the
   *  default push-front gap it is held at (U) for grabs without a grab block (system throws) */
  throwPullF: number;
  throwHoldGap: number;
}

// ------------------------------------------------------------------ helpers
function pwl(pts: Vec2[], f: number): number {
  if (pts.length === 0) return 0;
  if (f <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i][0]) {
      const [f0, v0] = pts[i - 1];
      const [f1, v1] = pts[i];
      return f1 === f0 ? v1 : v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
    }
  }
  return pts[pts.length - 1][1];
}

function parseInput(inp: string | undefined): { air: boolean; dir: number; btn: number; chainOnly: boolean; back: boolean; step: boolean } {
  const out = { air: false, dir: 5, btn: -1, chainOnly: false, back: false, step: false };
  if (!inp) return out;
  let s = inp.trim();
  // CHANGED(SIM3D) (CONTRACT §35.12 FIGHTERS3D item 5): step-attacks "SS.<L|M|H>" - routed only from SIDESTEP / SIDEWALK
  const ss = /^SS\.([LMH])$/.exec(s);
  if (ss) {
    out.step = true;
    out.btn = ss[1] === 'L' ? 0 : ss[1] === 'M' ? 1 : 2;
    return out;
  }
  if (s.includes('>')) {
    out.chainOnly = true;
    s = s.split('>').pop() ?? '';
  }
  if (s.startsWith('j.')) {
    out.air = true;
    s = s.slice(2);
  }
  const m = /^([1-9])?([A-Z+]+)$/.exec(s);
  if (!m) return out;
  if (m[1]) out.dir = Number(m[1]);
  const b = m[2];
  if (b === 'LM' || b === 'L+M') out.back = out.dir === 4;
  const last = b.charAt(b.length - 1);
  out.btn = last === 'L' ? 0 : last === 'M' ? 1 : last === 'H' ? 2 : -1;
  return out;
}

function scOf(mv: Move, str: number): number {
  switch (mv.kind) {
    case 'normal':
    case 'command':
      return str;
    case 'special':
    case 'ex':
      return mv.projectile ? SC.PROJECTILE : SC.SPECIAL;
    case 'projectile':
      return SC.PROJECTILE;
    case 'super1':
    case 'super3':
      return SC.SUPER;
    case 'throw':
    case 'cmdgrab':
      return SC.THROW;
    default:
      return str;
  }
}

// ------------------------------------------------------------------ system
const sysCache = new WeakMap<System, CSys>();

export function compileSystem(sys: System): CSys {
  const hit = sysCache.get(sys);
  if (hit) return hit;
  const byStr = (t: Record<string, number>, special: number, sup: number, imp: number, proj: number, thr: number): Int32Array =>
    Int32Array.from([t.L, t.M, t.H, special, sup, imp, proj, thr]);
  const c: CSys = {
    raw: sys,
    wall: mToU(sys.stage.wallM),
    cap: mToU(sys.stage.separationCapM),
    startHalf: mToU(sys.round.startDistanceM / 2),
    proxGuard: mToU(sys.movement.proxGuardM),
    gJuggle: mps2ToUpf2(sys.juggle.gravityMps2),
    airResetVx: mpsToUpf(sys.juggle.airReset[0]),
    airResetVy: mpsToUpf(sys.juggle.airReset[1]),
    popVx: mpsToUpf(sys.juggle.pop[0]),
    popVy: mpsToUpf(sys.juggle.pop[1]),
    bounceVy: mpsToUpf(sys.groundBounce.vyMps),
    rushSpeed: mpsToUpf(sys.rush.speedMps),
    techPush: mToU(sys.throw.techPushM),
    backThrowOff: mToU(sys.throw.backThrowOffsetM),
    backRise: mToU(sys.kd.backRiseM),
    splatRange: mToU(sys.wallSplat.rangeM),
    frightCorner: mToU(sys.stageFright.cornerRangeM),
    impactSplat: mToU(sys.impact.splatRangeM),
    projSpawnX: mToU(sys.projectile.spawnXM),
    projScreenHalf: mToU(sys.projectile.screenHalfM),
    hitstopBySc: byStr(sys.hitstop, sys.hitstop.special, sys.hitstop.superHit, sys.hitstop.impact, sys.hitstop.projectile, sys.hitstop.throw),
    pushBySc: Int32Array.from([sys.pushback.L, sys.pushback.M, sys.pushback.H, sys.pushback.special, sys.pushback.super, sys.impact.pushbackBlockM, sys.pushback.projectile, 0].map(mToU)),
    gainBySc: byStr(sys.showtime.gain, sys.showtime.gain.special, 0, 0, sys.showtime.gain.projectile, sys.showtime.gain.throw),
    drainBySc: byStr(sys.nerve.blockDrain, sys.nerve.blockDrain.special, sys.nerve.blockDrain.super, sys.nerve.blockDrain.impact, sys.nerve.blockDrain.projectile, 0),
    sfx: [],
    sfxIndex: {},
    ...compileStep(sys),
    // CHANGED(fix_core) D7 (CONTRACT §35.20): BACK HIT numbers (system.json backHit; defaults 120 deg / 120 % / +4 f)
    backHitCos: cosQ(degToYaw(Math.max(90, Math.min(180, sys.backHit?.arcDeg ?? 120)))),
    backHitDmgPct: Math.max(100, Math.trunc(sys.backHit?.damagePct ?? 120)),
    backHitStun: Math.max(0, Math.trunc(sys.backHit?.hitstunF ?? 4)),
    // CHANGED(fix_core) D4 (CONTRACT §35.20): grab hold (system.json throw.pullF / holdGapM; defaults 6 f / 0 m)
    throwPullF: Math.max(0, Math.trunc(sys.throw.pullF ?? 6)),
    throwHoldGap: mToU(sys.throw.holdGapM ?? 0),
  };
  for (const k of Object.keys(c) as (keyof CSys)[]) {
    const v = c[k];
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`system.json: derived value ${String(k)} is not a number (missing field?)`);
  }
  sysCache.set(sys, c);
  return c;
}

/**
 * CHANGED(fix_core) D1 (CONTRACT §35.20): cumulative sidestep arc travel (U) at step frame f (index 0..frames) for an arc of
 * `distU` - the §35.15 quadratic ease-out over `step.movePct` of the frames (100 = all 15, 64 % in the first 6). The system
 * default (step.distM 0.85 m) is CSys.stepCurve; a fighter's own `step.distM` (kit generator, from the measured body) builds
 * CFighter.stepCurve the same way. Floats only here (IEEE products + Math.round: identical on every engine).
 */
export function stepCurveOf(sys: System, distU: number): Int32Array {
  const st = sys.step ?? {};
  const frames = Math.max(2, Math.trunc(st.frames ?? 15));
  const movePct = st.movePct ?? 100;
  const curve = new Int32Array(frames + 1);
  const fm = Math.max(1, Math.round((frames * movePct) / 100));
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(1, f / fm);
    curve[f] = Math.round(distU * (1 - (1 - t) * (1 - t)));
  }
  return curve;
}

/** CHANGED(SIM3D): the system.json `ring` / `step` / `track` / throw arc numbers (defaults = CONTRACT §35 values). */
function compileStep(sys: System): Pick<CSys, 'ringR' | 'againstWall' | 'camMinSep' | 'frontArcCos' | 'spawnAxis' | 'stepFrames' | 'stepCurve' | 'stepAttackF' | 'stepBlockF' | 'stepBufferF' | 'sidewalk' | 'stepSettle' | 'trackNormalOff' | 'trackSpecialOff'> {
  const rg = sys.ring ?? {};
  const st = sys.step ?? {};
  const tr = sys.track ?? {};
  const frames = Math.max(2, Math.trunc(st.frames ?? 15));
  const dist = mToU(st.distM ?? 0.85);
  // CHANGED(STEPTUNE) (CONTRACT §35.15): default 100 = a FRONT-LOADED quadratic ease-out over all 15 frames (64 % of the
  // arc in the first 6 frames, then easing to a stop on frame 15; the designer's 60-65 % target). SIM3D built 80 (75 % in 6,
  // still from frame 13). The travel a defender makes between the attacker's last tracking frame and its first active
  // frame decides what a step evades (steppable table: probe_3d section 3b).
  const curve = stepCurveOf(sys, dist);
  return {
    ringR: mToU(rg.defaultRadiusM ?? 5.5),
    againstWall: mToU(rg.againstWallM ?? 0.45),
    camMinSep: mToU(rg.camMinSepM ?? 0.3),
    frontArcCos: cosQ(degToYaw(sys.throw.frontArcDeg ?? 70)),
    spawnAxis: degToYaw(rg.spawnAxisDeg ?? 90),
    stepFrames: frames,
    stepCurve: curve,
    stepAttackF: Math.max(1, Math.trunc(st.attackF ?? 11)),
    stepBlockF: Math.max(1, Math.trunc(st.blockF ?? 12)),
    // CHANGED(fix_core) D9 (CONTRACT §35.20): presses buffer from step frame 2 (was 9) and are held to stepAttackF
    stepBufferF: Math.max(1, Math.trunc(st.bufferF ?? 2)),
    sidewalk: mpsToUpf(st.walkMps ?? 1.8),
    stepSettle: Math.max(1, Math.trunc(st.settleF ?? 4)),
    // CHANGED(STEPTUNE) (CONTRACT §35.15): normals / command normals / system moves track to startup - 6 like the
    // specials (was - 4), so a READ sidestep evades a straight normal; throws start on frame 5 (until stays 1)
    trackNormalOff: Math.trunc(tr.normalUntilOffset ?? 6),
    trackSpecialOff: Math.trunc(tr.specialUntilOffset ?? 6),
  };
}

function sfxId(cs: CSys, name: string): number {
  let i = cs.sfxIndex[name];
  if (i === undefined) {
    i = cs.sfx.length;
    cs.sfx.push(name);
    cs.sfxIndex[name] = i;
  }
  return i;
}

// ------------------------------------------------------------------ moves
function compileMove(id: string, mv: Move, idx: number, snapId: number, animId: number, cs: CSys, sys: System, throwRange: number, grabAnim = -1): CMove {
  const kind = KIND_CODE[mv.kind] ?? K.normal;
  const inp = parseInput(mv.input);
  const strL = moveStrength(id, mv);
  const str = strL === 'L' ? 0 : strL === 'M' ? 1 : 2;
  const sc = id === '__impact' ? SC.IMPACT : scOf(mv, str);
  const total = mv.startup + mv.active + mv.recovery - 1;
  const isGrab = kind === K.throw || kind === K.cmdgrab;
  const isSuper = kind === K.super1 || kind === K.super3;
  // boxes -> hit ids: with `hits` (CONTRACT 20.2) each entry is one hit id (a box belongs to the entry
  // whose window contains its first frame); otherwise boxes sharing a frame range form one hit id
  const bx = mv.boxes ?? [];
  const hitDefs = mv.hits ?? [];
  const boxes = new Int32Array(bx.length * 7);
  const hidKeys: string[] = hitDefs.map((h) => `${h.f[0]}:${h.f[1]}`);
  let maxReach = 0;
  bx.forEach((b, i) => {
    let hid = -1;
    if (hitDefs.length > 0) hid = hitDefs.findIndex((h) => b.f[0] >= h.f[0] && b.f[0] <= h.f[1]);
    if (hid < 0) {
      const key = `${b.f[0]}:${b.f[1]}`;
      hid = hidKeys.indexOf(key);
      if (hid < 0) {
        hid = hidKeys.length;
        hidKeys.push(key);
      }
    }
    boxes.set([b.f[0], b.f[1], mToU(b.x), mToU(b.y), mToU(b.w), mToU(b.h), hid], i * 7);
    maxReach = Math.max(maxReach, mToU(b.x + b.w / 2));
  });
  const hx = mv.hurtExt ?? [];
  const hurt = new Int32Array(hx.length * 6);
  hx.forEach((b, i) => hurt.set([b.f[0], b.f[1], mToU(b.x), mToU(b.y), mToU(b.w), mToU(b.h)], i * 6));
  const curve = new Int32Array(total + 2);
  if (mv.move && mv.move.length > 0) for (let f = 0; f <= total + 1; f++) curve[f] = mToU(pwl(mv.move, f));
  // defaults by strength class
  const hsDefault = isSuper ? sys.hitstop.superHit : kind === K.throw || kind === K.cmdgrab ? 0 : cs.hitstopBySc[sc];
  const hitstunDefault = kind === K.normal || kind === K.command ? [sys.hitstun.L, sys.hitstun.M, sys.hitstun.H][str] : mv.projectile ? sys.hitstun.projectile : sys.hitstun.special;
  const hitstun = mv.hitstun ?? hitstunDefault;
  const blockstun = mv.blockstun ?? Math.max(0, hitstun - sys.hitstun.blockstunDelta);
  const g = mv.guard ?? (isGrab ? 'U' : 'HL');
  const guard = g === 'HL' ? 3 : g === 'H' ? GD.STAND : g === 'L' ? GD.CROUCH : 0;
  const pushDef = cs.pushBySc[sc] ?? 0;
  const jd = isSuper ? sys.juggle.defaults.super : kind === K.normal || kind === K.command ? sys.juggle.defaults.normal : sys.juggle.defaults.special;
  const chains: string[] = [];
  let cSpecial = false;
  let cSuper = false;
  let cWhiff = false;
  for (const c of mv.cancel ?? []) {
    if (c.startsWith('chain:')) chains.push(c.slice(6));
    else if (c === 'special' || c === 'ex') cSpecial = true;
    else if (c === 'super') cSuper = true;
    else if (c === 'whiff') cWhiff = true;
  }
  const kdS = mv.onHit?.kd ?? 'none';
  const inv = new Int32Array(8);
  const setR = (o: number, r: [number, number] | undefined): void => {
    if (r) {
      inv[o] = r[0];
      inv[o + 1] = r[1];
    }
  };
  setR(0, mv.invuln?.strike);
  setR(2, mv.invuln?.throw);
  setR(4, mv.invuln?.air);
  setR(6, mv.invuln?.proj);
  let proj: CProj | null = null;
  if (mv.projectile) {
    const p = mv.projectile;
    proj = {
      vx: mpsToUpf(p.speed),
      life: p.life,
      w: mToU(p.box[0]),
      h: mToU(p.box[1]),
      y: mToU(p.y),
      x: p.x !== undefined ? mToU(p.x) : cs.projSpawnX,
      hits: Math.max(1, p.hits ?? 1),
      limit: Math.max(1, p.limit ?? 1),
      vy: p.vy !== undefined ? mpsToUpf(p.vy) : 0,
      g: p.g !== undefined ? mps2ToUpf2(p.g) : 0,
      ground: p.ground === true,
      aimed: p.aimed === true,
      lat: Math.max(1, mToU(p.lateralM !== undefined ? p.lateralM : p.box[0] / 2)),
    };
  }
  let cin: CMove['cin'] = null;
  if (mv.cinematic) {
    const hs = [...mv.cinematic.hits].sort((a, b) => a[0] - b[0]);
    cin = { frames: mv.cinematic.frames, hitF: Int32Array.from(hs.map((h) => h[0])), hitD: Int32Array.from(hs.map((h) => h[1])) };
  }
  const sfx = mv.sfx ?? [];
  const nHid = hidKeys.length;
  const hidDmg = new Int32Array(nHid);
  const hidHs = new Int32Array(nHid);
  const hidF0 = new Int32Array(nHid);
  for (let k = 0; k < nHid; k++) {
    const h = hitDefs[k];
    hidDmg[k] = h ? h.damage : mv.damage ?? 0;
    hidHs[k] = h && h.hitstop !== undefined ? h.hitstop : -1;
    hidF0[k] = h ? h.f[0] : Number(hidKeys[k].split(':')[0]);
  }
  let yCurve: Int32Array | null = null;
  if (mv.moveY && mv.moveY.some((q) => q[1] > 0)) {
    yCurve = new Int32Array(total + 2);
    for (let f = 0; f <= total + 1; f++) yCurve[f] = Math.max(0, mToU(pwl(mv.moveY, f)));
  }
  const ho = mv.hurtOverride ?? [];
  const hurtOv = new Int32Array(ho.length * 5);
  ho.forEach((h, i) => hurtOv.set([h.f[0], h.f[1], mToU(h.w), mToU(h.h), mToU(h.y ?? 0)], i * 5));
  let grab: CGrab | null = null;
  if (mv.grab) {
    const gd = mv.grab;
    const swap = gd.swap === true;
    // CHANGED(fixer) D3: victim segments. Default: thrown_f / thrown_b with its slam mark on hitF (the attacker clip's
    // slam = the damage frame in the kit data) and its end on the release, so the victim lands WITH the attacker's slam
    // and is lying in the clip's end pose (= kd_ground_*) when the knockdown starts.
    const segs: [number, number, number, number][] = [];
    const clipId = (n: string): number => SHARED_CLIPS.indexOf(n);
    if (gd.victim && gd.victim.length > 0) {
      const vs = [...gd.victim].sort((p, q) => p[0] - q[0]);
      for (const v of vs) {
        const c = clipId(v[1]);
        if (c < 0) throw new Error(`move ${id}: grab.victim clip "${v[1]}" is not a shared clip`);
        const t0 = v[2] !== undefined ? Math.round(v[2] * 1000) : 0;
        const t1 = v[3] !== undefined ? Math.round(v[3] * 1000) : V_OPEN;
        segs.push([Math.max(0, Math.min(gd.frames, v[0])), c, t0, t1]);
      }
      if (segs[0][0] > 0) segs.unshift([0, segs[0][1], segs[0][2], segs[0][2]]);
    } else {
      const c = clipId(swap ? 'thrown_b' : 'thrown_f');
      const hitF = Math.max(1, Math.min(gd.frames - 1, gd.hitF));
      segs.push([0, c, 0, V_SLAM], [hitF, c, V_SLAM, V_END]);
    }
    // CHANGED(fix_core) D4 (CONTRACT §35.20): the victim root path (grab supers: = their cinematic gapD)
    let path: Int32Array | null = null;
    if (Array.isArray(gd.path) && gd.path.length > 0) {
      const keys = gd.path
        .filter((k) => Array.isArray(k) && k.length >= 2 && Number.isFinite(k[0]) && k[0] >= 1 && Number.isFinite(k[1]))
        .map((k) => [Math.trunc(k[0]), mToU(Math.max(0, k[1])), mToU(Math.max(0, Number.isFinite(k[2]) ? k[2] : 0)),
          // CHANGED(wf6_fixer_core) V2: the thrower's turn (degrees -> yaw units, at compile time only)
          Number.isFinite(k[3]) ? Math.round(((k[3] as number) * 65536) / 360) : 0])
        .sort((p, q) => p[0] - q[0]);
      if (keys.length > 0) path = Int32Array.from(keys.flat());
    }
    const turns = path !== null && path.some((v, j) => j % 4 === 3 && v !== 0);
    grab = {
      turns,
      frames: gd.frames,
      adv: gd.adv,
      hitF: gd.hitF,
      swap,
      air: gd.air === true,
      techable: gd.techable !== undefined ? gd.techable : kind === K.throw,
      animId: grabAnim,
      vF0: Int32Array.from(segs.map((q) => q[0])),
      vClip: Int32Array.from(segs.map((q) => q[1])),
      vT0: Int32Array.from(segs.map((q) => q[2])),
      vT1: Int32Array.from(segs.map((q) => q[3])),
      path,
      holdGap: mToU(gd.holdGapM !== undefined && Number.isFinite(gd.holdGapM) ? gd.holdGapM : sys.throw.holdGapM ?? 0),
    };
  }
  let pushExt: Int32Array | null = null;
  if (mv.pushExt && mv.pushExt.some((q) => q[1] > 0)) {
    pushExt = new Int32Array(total + 2);
    for (let f = 0; f <= total + 1; f++) pushExt[f] = Math.max(0, mToU(pwl(mv.pushExt, f)));
  }
  let trigger: CTrigger | null = null;
  if (mv.trigger) {
    const tcl = mv.trigger.classic;
    const ts = mv.trigger.simple ?? '';
    const mask = (b: string): number => (b.includes('L') ? 1 : 0) | (b.includes('M') ? 2 : 0) | (b.includes('H') ? 4 : 0) | (b.includes('S') ? 8 : 0);
    const sm = /^([1-9]?)S$/.exec(ts);
    trigger = {
      motion: tcl && tcl.motion ? MOTION_CODE[tcl.motion] ?? 0 : 0,
      btnMask: tcl ? mask(tcl.btn) : 7,
      simpleDir: sm ? Number(sm[1] || '5') : -1,
      simpleBtn: sm ? 0 : mask(ts || 'LMH') & 7,
    };
  }
  const isGrabKind = kind === K.throw || kind === K.cmdgrab || mv.grab !== undefined;
  // CHANGED(SIM3D) (CONTRACT §35.4): tracking defaults by class, lateral depth by strength / role
  const roles = Array.isArray(mv.role) ? mv.role.map(String) : [];
  const homing = mv.homing === true;
  const linear = mv.linear === true && !homing;
  const trackOff = kind === K.special || kind === K.ex || kind === K.projectile || kind === K.cmdgrab || isSuper ? cs.trackSpecialOff : cs.trackNormalOff;
  const lastActive = mv.startup + mv.active - 1;
  let trackUntil = mv.track?.until !== undefined ? Math.trunc(mv.track.until) : mv.startup - trackOff;
  if (homing) trackUntil = Math.max(trackUntil, lastActive);
  if (linear) trackUntil = 1;
  trackUntil = Math.max(1, trackUntil);
  const trackRate = mv.track?.rate !== undefined && mv.track.rate > 0 ? Math.max(1, degToYaw(Math.min(180, mv.track.rate))) : 0;
  const lat = sys.lateral ?? { L: 0.15, M: 0.18, H: 0.22, sweep: 0.45, homing: 0.6 };
  // (specials / EX / supers default to the H depth: their L/M/H is the button strength, not the limb - FIGHTERS3D §35.12.3)
  const special = kind === K.special || kind === K.ex || kind === K.projectile || kind === K.cmdgrab || isSuper;
  const lateralM = mv.lateralM !== undefined ? mv.lateralM : homing ? lat.homing : roles.includes('sweep') ? lat.sweep : special ? lat.H : str === 0 ? lat.L : str === 1 ? lat.M : lat.H;
  const lightStarter = mv.starter === 'light' || ((kind === K.normal || kind === K.command) && (str === 0 || (inp.dir <= 3 && str === 1 && !inp.air)));
  const cm: CMove = {
    id,
    idx,
    snapId,
    kind,
    kindStr: mv.kind,
    inAir: inp.air,
    inDir: inp.dir,
    inBtn: inp.btn,
    chainOnly: inp.chainOnly,
    throwBack: kind === K.throw && inp.dir === 4,
    startup: mv.startup,
    active: mv.active,
    recovery: mv.recovery,
    total,
    lastActive: mv.startup + mv.active - 1,
    damage: mv.damage ?? 0,
    chipPct: mv.chipPct ?? 0,
    hitstop: mv.hitstop ?? hsDefault,
    hitstun,
    blockstun,
    guard,
    str,
    sc,
    lightStarter,
    boxes,
    nBox: bx.length,
    nHid: hidKeys.length,
    maxReach,
    hurt,
    nHurt: hx.length,
    curve,
    pushHit: mv.pushback?.hit !== undefined ? mToU(mv.pushback.hit) : pushDef,
    pushBlock: mv.pushback?.block !== undefined ? mToU(mv.pushback.block) : pushDef,
    chains: [],
    cSpecial,
    cSuper,
    cWhiff,
    js: mv.juggle?.js ?? jd.js,
    ji: mv.juggle?.ji ?? jd.ji,
    jl: mv.juggle?.jl ?? jd.jl,
    kd: kdS === 'hard' ? 2 : kdS === 'soft' ? 1 : 0,
    launchVx: mv.onHit?.launch ? mpsToUpf(mv.onHit.launch[0]) : 0,
    launchVy: mv.onHit?.launch ? mpsToUpf(mv.onHit.launch[1]) : 0,
    wallSplat: mv.onHit?.wallSplat === true,
    groundBounce: mv.onHit?.groundBounce === true,
    crumple: mv.onHit?.crumple === true,
    gainShow: mv.gain?.showtime ?? (isSuper || kind === K.system ? 0 : cs.gainBySc[sc]),
    nerveDrain: mv.gain?.nerveCost ?? cs.drainBySc[sc],
    costShow: mv.cost?.showtime ?? (kind === K.super1 ? sys.showtime.super1Cost : kind === K.super3 ? sys.showtime.super3Cost : 0),
    costNerve: mv.cost?.nerve ?? (kind === K.ex ? sys.nerve.exCost : 0),
    inv,
    armorHits: mv.armor?.hits ?? 0,
    armorF0: mv.armor?.f[0] ?? 0,
    armorF1: mv.armor?.f[1] ?? 0,
    armorBreak: mv.armorBreak === true || isSuper,
    proj,
    cin,
    animId,
    sfxF: Int32Array.from(sfx.map((e) => e[0])),
    sfxI: Int32Array.from(sfx.map((e) => sfxId(cs, e[1]))),
    isStrike: bx.length > 0 && !isGrabKind,
    isGrab: isGrabKind,
    isSuper,
    level: kind === K.super1 ? 1 : kind === K.super3 ? 3 : 0,
    isEx: kind === K.ex,
    isSpecialCat: kind === K.special || kind === K.ex || kind === K.projectile || kind === K.cmdgrab,
    isNormalCat: kind === K.normal || kind === K.command,
    isImpact: id === '__impact',
    isShove: id === '__shove',
    usableAir: inp.air || mv.air === true,
    airOnly: inp.air || mv.air === true,
    multi: mv.multi ?? 0,
    grabReach: isGrabKind ? (bx.length > 0 ? maxReach : throwRange) : 0,
    chainNames: chains,
    hidDmg,
    hidHs,
    hidF0,
    yCurve,
    airVelX: mv.airVel ? mpsToUpf(mv.airVel[0]) : 0,
    airVelY: mv.airVel ? mpsToUpf(mv.airVel[1]) : 0,
    hasAirVel: mv.airVel !== undefined,
    hurtOv,
    nHurtOv: ho.length,
    grab,
    grabGap: mv.grab?.rangeM !== undefined ? mToU(mv.grab.rangeM) : kind === K.throw && bx.length === 0 ? throwRange : -1,
    trigger,
    phase2: mv.phase === 2,
    cinEndAdv: mv.cinematic?.endAdv ?? -100000,
    cinEndGap: mv.cinematic?.endGapM !== undefined ? mToU(mv.cinematic.endGapM) : -1,
    pushExt,
    // CHANGED(SIM) P2 uniques (`counter` is attached by compileFighter once the follow id resolves)
    teleport: mv.teleport
      ? { f: mv.teleport.f, to: mv.teleport.to === 'front' ? TPD.FRONT : mv.teleport.to === 'home' ? TPD.HOME : TPD.BEHIND, gap: mToU(mv.teleport.gapM) }
      : null,
    stanceKind: mv.stance === 'enter' ? STK.ENTER : mv.stance === 'follow' ? STK.FOLLOW : mv.stance === 'exit' ? STK.EXIT : STK.NONE,
    ballAct: mv.ball ? (mv.ball.act === 'shoot' ? BACT.SHOOT : mv.ball.act === 'hover' ? BACT.HOVER : mv.ball.act === 'summon' ? BACT.SUMMON : BACT.NONE) : BACT.NONE,
    install: mv.install ? { frames: mv.install.frames, dmgPct: mv.install.damagePct ?? 100, walkPct: mv.install.walkPct ?? 100 } : null,
    armorStep: false,
    cinEndDown: mv.cinematic?.endPose === 'front',
    hitsTotal: mv.cinematic ? mv.cinematic.hits.reduce((a, h) => a + h[1], 0) : 0,
    trackUntil,
    trackRate,
    homing,
    linear,
    lateral: Math.max(0, mToU(lateralM)),
    stepAtk: inp.step,
  };
  cm.chainOnly = cm.chainOnly || mv.tc === true;
  if (grab && grab.swap) cm.throwBack = true;
  return cm;
}

function systemImpact(sys: System): Move {
  const i = sys.impact;
  return {
    kind: 'system', input: 'IMPACT', startup: i.startup, active: i.active, recovery: i.recovery,
    damage: i.damage, hitstop: i.hitstop, hitstun: i.hitstun, blockstun: i.blockstun, guard: 'HL',
    boxes: [{ f: [i.startup, i.startup + i.active - 1], x: i.box.x, y: i.box.y, w: i.box.w, h: i.box.h }],
    move: i.travel, pushback: { hit: i.pushbackHitM, block: i.pushbackBlockM },
    onHit: { kd: 'soft' }, armor: { hits: i.armorHits, f: i.armorFrames }, gain: { showtime: 0 },
    cost: { nerve: sys.nerve.impactCost }, strength: 'H',
  };
}

function systemShove(sys: System): Move {
  const s = sys.shove;
  return {
    kind: 'system', input: 'SHOVE', startup: s.startup, active: s.active, recovery: s.recovery,
    damage: s.damage, hitstop: s.hitstop, hitstun: s.hitstun, blockstun: s.blockstun, guard: 'HL',
    boxes: [{ f: [s.startup, s.startup + s.active - 1], x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h }],
    pushback: { hit: s.pushbackHitM, block: s.pushbackBlockM }, invuln: { strike: s.invuln, throw: s.invuln },
    gain: { showtime: 0 }, cost: { nerve: sys.nerve.shoveCost }, strength: 'H', armorBreak: true,
  };
}

function systemThrow(sys: System, back: boolean): Move {
  const t = sys.throw;
  return {
    kind: 'throw', input: back ? '4LM' : 'LM', startup: t.startup, active: t.active, recovery: t.recovery,
    damage: t.damage, hitstun: back ? t.hitstunB : t.hitstunF, guard: 'U', onHit: { kd: 'soft' },
  };
}

// ------------------------------------------------------------------ fighters
// ------------------------------------------------------------------ bonus rounds (CHANGED(SIM) P2, CONTRACT §28.4)
/** Compiled data/system.json `brawl` + `heckler` (U, U/frame, frames). */
export interface CBrawl {
  seconds: number;
  hSeconds: number;
  maxActive: number;
  tokens: number;
  tokenSpacing: number;
  telegraphMin: number;
  spawnDist: number;
  spawnGap: number;
  waveGap: number;
  thinkMin: number;
  thinkMax: number;
  ringAttack: [number, number];
  ringApproach: [number, number];
  hurtW: number;
  hurtH: number;
  pushHalf: number;
  hitstunF: number;
  kdF: number;
  wakeF: number;
  downF: number;
  maxJuggle: number;
  kindIds: string[];
  kindHp: number[];
  kindWalk: number[]; // U/frame
  waves: number[][];
  moves: CMove[]; // goon kit (snapId = index, animId = 34 + index)
  moveNames: string[];
  moveRange: number[]; // U: goon centre to the player's near hurt edge where each move is started
  /** CHANGED(ASSETS) P2 (CONTRACT §32): per kind (system.json brawl.kinds order) its own kit (data/goons.json boxes /
   *  move measured on that goon's clips; same order, ids and frame data as `moves`), start ranges (U) and AI pick
   *  weights (integers >= 0). A kind without a goons.json kit uses `moves` / `moveRange` / equal weights. */
  kindMoves: CMove[][];
  kindRange: number[][];
  kindWeights: number[][];
  g: number; // goon juggle gravity U/f^2
  launchVx: number;
  launchVy: number;
  koVx: number;
  koVy: number;
  score: CBrawlScore;
  hk: CHeckler;
}
export interface CBrawlScore {
  hit: number[]; special: number; super: number; throw: number; ko: number; crowd: number; parry: number; perfect: number; comboCashF: number;
  rStart: number; idleF: number; mult: number[]; decay: number[]; // decay = ratings x100 per frame (x1000 for precision)
  gHit: number[]; gSpecial: number; gSuper: number; gThrow: number; gKo: number; gCrowd: number; gParry: number; gPerfect: number;
}
export interface CHeckler {
  maxLive: number;
  distMin: number;
  distMax: number;
  spawnY: number;
  aimY: number;
  g: number;
  startF: number;
  endF: number;
  jitterF: number;
  firstF: number;
  objFlight: number[];
  objDamage: number[];
  objW: number[];
  objH: number[];
  objIds: string[];
  hitstun: number;
  blockstun: number;
  hitstop: number;
  parry: number;
  perfect: number;
  hitCost: number;
}

const bCache = new WeakMap<GameData, CBrawl>();

/** Compiles the bonus-round tables (throws one readable error when system.json `brawl` / `heckler` is malformed). */
export function compileBrawl(data: GameData): CBrawl {
  const hit = bCache.get(data);
  if (hit) return hit;
  const sys = data.system;
  const cs = compileSystem(sys);
  const br = sys.brawl;
  const hk = sys.heckler;
  if (!br || !hk || !Array.isArray(br.moves) || br.moves.length === 0 || !Array.isArray(br.kinds) || br.kinds.length === 0 || !Array.isArray(br.waves) || br.waves.length === 0) {
    throw new Error('system.json: brawl { moves, kinds, waves, ... } and heckler { objects, ... } are required for the bonus rounds (CONTRACT 28.4)');
  }
  const moves = br.moves.map((mv, k) => compileMove(mv.id, mv, k, k, SHARED_CLIPS.length + k, cs, sys, mToU(0.6)));
  // CHANGED(ASSETS) P2: per-goon kits from data/goons.json (core/data.ts applyGoons merged them into brawl.kinds)
  const gkinds = br.kinds as GoonKindDef[];
  const kindMoves = gkinds.map((kd) => (kd.moves && kd.moves.length === br.moves.length
    ? kd.moves.map((mv, k) => compileMove(mv.id, mv, k, k, SHARED_CLIPS.length + k, cs, sys, mToU(0.6)))
    : moves));
  const kindRange = gkinds.map((kd) => br.moves.map((_, k) => mToU(kd.rangeM?.[k] ?? br.moveRangeM[k] ?? 1.0)));
  const kindWeights = gkinds.map((kd) => br.moves.map((_, k) => Math.max(0, Math.trunc(kd.weights?.[k] ?? 1))));
  const r = br.ratings;
  const decay = r.decayPerSec.map((d) => Math.round((d * 100 * 1000) / 60));
  const cb: CBrawl = {
    seconds: br.seconds,
    hSeconds: hk.seconds,
    maxActive: Math.max(1, Math.min(8, br.maxActive)),
    tokens: br.tokens,
    tokenSpacing: br.tokenSpacingF,
    telegraphMin: br.telegraphMinF,
    spawnDist: mToU(br.spawnDistM),
    spawnGap: br.spawnGapF,
    waveGap: br.waveGapF,
    thinkMin: br.thinkF[0],
    thinkMax: br.thinkF[1],
    ringAttack: [mToU(br.ringM.attack[0]), mToU(br.ringM.attack[1])],
    ringApproach: [mToU(br.ringM.approach[0]), mToU(br.ringM.approach[1])],
    hurtW: mToU(br.goonHurt[0]),
    hurtH: mToU(br.goonHurt[1]),
    pushHalf: mToU(br.goonPush[0] / 2),
    hitstunF: br.hitstunF,
    kdF: br.kdF,
    wakeF: br.wakeF,
    downF: br.downF,
    maxJuggle: br.maxJuggle,
    kindIds: br.kinds.map((k) => k.id),
    kindHp: br.kinds.map((k) => k.hp),
    kindWalk: br.kinds.map((k) => mpsToUpf(k.walk)),
    waves: br.waves.map((w) => w.map((x) => Math.max(0, Math.min(br.kinds.length - 1, x | 0)))),
    moves,
    moveNames: br.moves.map((m) => m.id),
    moveRange: br.moves.map((_, k) => mToU(br.moveRangeM[k] ?? 1.0)),
    kindMoves,
    kindRange,
    kindWeights,
    g: cs.gJuggle,
    launchVx: mpsToUpf(3.0),
    launchVy: mpsToUpf(5.0),
    koVx: mpsToUpf(2.4),
    koVy: mpsToUpf(4.2),
    score: {
      hit: br.score.hit, special: br.score.special, super: br.score.super, throw: br.score.throw, ko: br.score.ko,
      crowd: br.score.crowd, parry: br.score.parry, perfect: br.score.perfect, comboCashF: br.score.comboCashF,
      rStart: Math.round(r.start * 100), idleF: r.idleF, mult: r.mult, decay,
      gHit: r.gain.hit.map((g) => g * 100), gSpecial: r.gain.special * 100, gSuper: r.gain.super * 100, gThrow: r.gain.throw * 100,
      gKo: r.gain.ko * 100, gCrowd: r.gain.crowd * 100, gParry: r.gain.parry * 100, gPerfect: r.gain.perfect * 100,
    },
    hk: {
      maxLive: hk.maxLive,
      distMin: mToU(hk.spawnDistM[0]),
      distMax: mToU(hk.spawnDistM[1]),
      spawnY: mToU(hk.spawnY),
      aimY: mToU(hk.aimY),
      g: mps2ToUpf2(hk.gravityMps2),
      startF: hk.cadence.startF,
      endF: hk.cadence.endF,
      jitterF: hk.cadence.jitterF,
      firstF: hk.cadence.firstF,
      objFlight: hk.objects.map((o) => o.flightF),
      objDamage: hk.objects.map((o) => o.damage),
      objW: hk.objects.map((o) => mToU(o.box[0])),
      objH: hk.objects.map((o) => mToU(o.box[1])),
      objIds: hk.objects.map((o) => o.id),
      hitstun: hk.hitstun,
      blockstun: hk.blockstun,
      hitstop: hk.hitstop,
      parry: hk.score.parry,
      perfect: hk.score.perfect,
      hitCost: hk.score.hitCost,
    },
  };
  bCache.set(data, cb);
  return cb;
}

const fCache = new WeakMap<GameData, Record<string, CFighter>>();

/** Dash travel curve: ease-out over `movePct` of the frames, then stationary. */
function dashCurve(distU: number, frames: number, movePct: number): Int32Array {
  const c = new Int32Array(frames + 1);
  const fm = Math.max(1, Math.round((frames * movePct) / 100));
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(1, f / fm);
    c[f] = Math.round(distU * (1 - (1 - t) * (1 - t)));
  }
  return c;
}

/** CHANGED(SIM) P2 (CONTRACT section 28.5c): hurtbox front / back extents (U) per posture; centred when not measured. */
function hurtExtents(def: FighterDef, data: GameData): Pick<CFighter, 'hurtFS' | 'hurtBS' | 'hurtFC' | 'hurtBC' | 'hurtFA' | 'hurtBA' | 'downF' | 'downB'> {
  const b = data.bodies ? data.bodies[def.id] : undefined;
  if (!b) {
    const hs = mToU(def.hurt.stand[0]) >> 1;
    const hc = mToU(def.hurt.crouch[0]) >> 1;
    const ha = mToU(def.hurt.air[0]) >> 1;
    return { hurtFS: hs, hurtBS: hs, hurtFC: hc, hurtBC: hc, hurtFA: ha, hurtBA: ha, downF: 0, downB: 0 };
  }
  return {
    hurtFS: mToU(b.stand[0]), hurtBS: mToU(b.stand[1]), hurtFC: mToU(b.crouch[0]), hurtBC: mToU(b.crouch[1]),
    hurtFA: mToU(b.air[0]), hurtBA: mToU(b.air[1]),
    // CHANGED(wf6_fixer_core) D1
    downF: b.down ? mToU(b.down[0]) : 0, downB: b.down ? mToU(b.down[1]) : 0,
  };
}

/**
 * CHANGED(fix_core) D1 (CONTRACT §35.20): the fighter's sidestep length. fighters/<id>.json `step: { distM }` (0.5..2.5 m,
 * generated from the measured body: a wider / longer body needs a longer arc to clear a straight attack, kitlib.py
 * step_dist_m); absent = the system default (system.json step.distM 0.85 m; goons and the fixture kits).
 */
function fighterStep(def: FighterDef, sys: System, cs: CSys): Pick<CFighter, 'stepDist' | 'stepCurve'> {
  const st = def.step as { distM?: unknown } | undefined;
  const d = st && typeof st.distM === 'number' && Number.isFinite(st.distM) ? Math.max(0.5, Math.min(2.5, st.distM)) : null;
  if (d === null) return { stepDist: cs.stepCurve[cs.stepCurve.length - 1], stepCurve: cs.stepCurve };
  const u = mToU(d);
  return { stepDist: u, stepCurve: stepCurveOf(sys, u) };
}

/** CHANGED(SIM) P2: the fighter's unique block with system.json uniques defaults (CONTRACT section 28.2). */
function compileUnique(def: FighterDef, uk: number, ur: Record<string, unknown>, byName: Record<string, number>, sys: System): CUnique {
  const us = sys.uniques ?? {};
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mv = (n: unknown): number => (typeof n === 'string' && byName[n] !== undefined ? byName[n] : -1);
  const st = us.stance ?? {};
  const ch = us.charge ?? {};
  const bl = us.ball ?? {};
  const fu = (typeof ur.followups === 'object' && ur.followups !== null ? ur.followups : {}) as Record<string, unknown>;
  const ex = (typeof ur.exit === 'object' && ur.exit !== null ? ur.exit : {}) as Record<string, unknown>;
  const walk = (typeof ur.walk === 'object' && ur.walk !== null ? ur.walk : {}) as Record<string, unknown>;
  // stance hurtbox = the enter move's last hurtOverride (the lean)
  let hw = 0;
  let hh = 0;
  let hy = 0;
  if (uk === UK.STANCE && Array.isArray(ur.enter)) {
    for (const n of ur.enter as string[]) {
      const m = def.moves[n];
      const ho = m && m.hurtOverride && m.hurtOverride.length > 0 ? m.hurtOverride[m.hurtOverride.length - 1] : null;
      if (ho) {
        hw = mToU(ho.w);
        hh = mToU(ho.h);
        hy = mToU(ho.y ?? 0);
        break;
      }
    }
  }
  const tick = String(us.armorStep?.tickStrength ?? 'L');
  const ph = us.phases ?? {};
  return {
    kind: uk,
    stMaxF: num(ur.maxF, num(st.maxF, 90)),
    stBlockExitF: num(ur.blockExitF, num(st.blockExitF, 6)),
    stExitHoldF: num(ur.exitHoldF, num((st as { exitHoldF?: number }).exitHoldF, 4)),
    stWalkF: mpsToUpf(num(walk.fwd, def.walk.fwd)),
    stWalkB: mpsToUpf(num(walk.back, def.walk.back)),
    stFollow: [mv(fu.L), mv(fu.M), mv(fu.H)],
    stExit2: mv(ex['2']),
    stExitT: mv(ex.timeout),
    stHurtW: hw,
    stHurtH: hh,
    stHurtY: hy,
    stAnim: uk === UK.STANCE ? [animStanceId(def, 0), animStanceId(def, 1), animStanceId(def, 2)] : [-1, -1, -1],
    chargeF: uk === UK.CHARGE ? num(ur.chargeF, num(ch.chargeF, sys.motion.chargeFrames)) : sys.motion.chargeFrames,
    keepF: uk === UK.CHARGE ? num(ur.keepF, num(ch.keepF, sys.motion.chargeKeep)) : sys.motion.chargeKeep,
    standBlockPct: uk === UK.CHARGE ? num(ur.standBlockNervePct, num(ch.standBlockNervePct, 100)) : 100,
    respawnF: num(ur.respawnF, num(bl.respawnF, 180)),
    restF: num(ur.restF, num(bl.restF, 240)),
    pickup: mToU(num(ur.pickupM, num(bl.pickupM, 0.4))),
    bounces: num(ur.bounces, num(bl.bounces, 1)),
    kickRange: mToU(num(bl.kickRangeM, 1.1)),
    kickBack: mToU(num(bl.kickBackM, 0.3)),
    wallRest: num(bl.wallRestitutionPct, 70),
    looseG: mps2ToUpf2(num(bl.looseGravityMps2, 16)),
    deflectVxPct: num(bl.deflectVxPct, -30),
    deflectVy: mpsToUpf(num(bl.deflectVyMps, 3)),
    looseFriction: num(bl.looseFrictionPct, 94),
    catchHitstop: num(us.counter?.catchHitstop, 12),
    tickStr: uk === UK.ARMOR_STEP ? (tick === 'L' ? 0 : tick === 'M' ? 1 : tick === 'H' ? 2 : -1) : -1,
    threshold: num(ur.thresholdPct, num(ph.thresholdPct, 50)),
    lockF: num(ur.lockF, num(ph.lockF, 60)),
  };
}

export function compileFighter(data: GameData, id: string): CFighter {
  let cache = fCache.get(data);
  if (!cache) {
    cache = {};
    fCache.set(data, cache);
  }
  const hit = cache[id];
  if (hit) return hit;
  const def = data.fighters[id];
  if (!def) throw new Error(`compileFighter: unknown fighter "${id}" (have: ${Object.keys(data.fighters).join(', ')})`);
  const sys = data.system;
  const cs = compileSystem(sys);
  const throwRange = mToU(def.throwRangeM);
  const ids = Object.keys(def.moves);
  const moves: CMove[] = [];
  ids.forEach((mid, k) => moves.push(compileMove(mid, def.moves[mid], k, k, SHARED_CLIPS.length + k, cs, sys, throwRange, def.moves[mid].grab ? animGrabId(def, mid) : -1)));
  const byName: Record<string, number> = {};
  moves.forEach((m) => (byName[m.id] = m.idx));
  const addSys = (name: string, mv: Move, anim: number): number => {
    const idx = moves.length;
    moves.push(compileMove(name, mv, idx, -1, anim, cs, sys, throwRange));
    return idx;
  };
  // IMPACT / SHOVE: fighter override (move named impact / shove) or system numbers
  const impact = byName['impact'] !== undefined ? byName['impact'] : addSys('__impact', systemImpact(sys), 32);
  moves[impact].isImpact = true;
  moves[impact].sc = SC.IMPACT;
  moves[impact].lightStarter = true; // IMPACT starts combos at the 80% column (FIGHTING_DESIGN 2c)
  if (!moves[impact].armorHits) {
    moves[impact].armorHits = sys.impact.armorHits;
    moves[impact].armorF0 = sys.impact.armorFrames[0];
    moves[impact].armorF1 = sys.impact.armorFrames[1];
  }
  const shove = byName['shove'] !== undefined ? byName['shove'] : addSys('__shove', systemShove(sys), 33);
  moves[shove].isShove = true;
  moves[shove].armorBreak = true;
  // throws
  let throwF = -1;
  let throwB = -1;
  for (const m of moves) {
    if (m.kind !== K.throw || m.snapId < 0) continue;
    if (m.throwBack) {
      if (throwB < 0) throwB = m.idx;
    } else if (throwF < 0) throwF = m.idx;
  }
  if (throwF < 0) throwF = addSys('__throw_f', systemThrow(sys, false), 0);
  if (throwB < 0) throwB = addSys('__throw_b', systemThrow(sys, true), 0);
  // chains
  for (const m of moves) {
    m.chains = m.chainNames.map((n) => byName[n]).filter((x) => x !== undefined);
  }
  // normals tables
  const gTable = new Int16Array(30).fill(-1);
  const aTable = new Int16Array(30).fill(-1);
  const find = (air: boolean, dir: number, btn: number): number => {
    for (const m of moves) {
      if (m.snapId < 0 || m.chainOnly || !m.isNormalCat || m.phase2 || m.stepAtk) continue;
      if (m.inAir === air && m.inDir === dir && m.inBtn === btn) return m.idx;
    }
    return -1;
  };
  for (let d = 1; d <= 9; d++) {
    for (let b = 0; b < 3; b++) {
      let g = find(false, d, b);
      if (g < 0) {
        if (d <= 3) g = find(false, 2, b);
        if (g < 0) g = find(false, 5, b);
      }
      gTable[d * 3 + b] = g;
      let a = find(true, d, b);
      if (a < 0) a = find(true, 5, b);
      aTable[d * 3 + b] = a;
    }
  }
  // CHANGED(SIM) P2: routing tables per phase (phase 1 never reaches a phase-2 move; phase 2 = the phases kit)
  const uraw = (def.unique ?? { kind: 'none' }) as Record<string, unknown>;
  const uk = UK_CODE[String(uraw.kind ?? 'none')] ?? UK.NONE;
  const sm = def.simple ?? {};
  const buildRoute = (phase2: boolean): CRoute => {
    const idOrP = (name: string | undefined): number =>
      name !== undefined && byName[name] !== undefined && (phase2 || !moves[byName[name]].phase2) ? byName[name] : -1;
    const specials: CSpecial[] = [];
    for (const e of def.classic ?? []) {
      const code = MOTION_CODE[e.motion];
      if (!code) continue;
      let mask = 0;
      if (e.btn.includes('L')) mask |= 1;
      if (e.btn.includes('M')) mask |= 2;
      if (e.btn.includes('H')) mask |= 4;
      const idx: [number, number, number, number] = [
        idOrP(classicMoveId(e, 'L')), idOrP(classicMoveId(e, 'M')), idOrP(classicMoveId(e, 'H')),
        e.move.includes('{s}') || e.btn.includes('S') ? idOrP(classicMoveId(e, 'S')) : -1,
      ];
      if (idx[0] < 0 && idx[1] < 0 && idx[2] < 0 && idx[3] < 0) continue;
      specials.push({ motion: code, prio: MOTION_PRIO[code], btnMask: mask, idx });
    }
    const ov = phase2 && uk === UK.PHASES && typeof uraw.simple === 'object' && uraw.simple !== null ? (uraw.simple as Record<string, string>) : {};
    const key = (k: string): string | undefined => (ov[k] !== undefined ? ov[k] : (sm[k] as string | undefined));
    const sup1 = idOrP(key('S+H'));
    let sup3 = idOrP(key('S+H+2'));
    if (phase2 && uk === UK.PHASES && typeof uraw.lv3 === 'string' && idOrP(uraw.lv3) >= 0) sup3 = idOrP(uraw.lv3);
    if (!specials.some((q) => q.motion === MO.DQCF) && sup1 >= 0) specials.push({ motion: MO.DQCF, prio: 0, btnMask: 7, idx: [sup1, sup1, sup1, sup1] });
    if (!specials.some((q) => q.motion === MO.DQCB) && sup3 >= 0) specials.push({ motion: MO.DQCB, prio: 0, btnMask: 7, idx: [sup3, sup3, sup3, sup3] });
    specials.sort((a, b) => a.prio - b.prio); // stable: kit order inside one priority class
    const simpleId = (k: string): number => idOrP(key(k));
    const exOf = (k: string, base: number): number => {
      const explicit = simpleId('A' + k);
      if (explicit >= 0) return explicit;
      if (base < 0) return -1;
      const ex = byName[exIdFor(moves[base].id)];
      return ex !== undefined && (phase2 || !moves[ex].phase2) ? ex : -1;
    };
    const s5 = simpleId('5S');
    const s6 = simpleId('6S');
    const s2 = simpleId('2S');
    const s4 = simpleId('4S');
    return { specials, s5, s6, s2, s4, e5: exOf('5S', s5), e6: exOf('6S', s6), e2: exOf('2S', s2), e4: exOf('4S', s4), sup1, sup3, sAir: simpleId('jS') };
  };
  const route1 = buildRoute(false);
  const route2 = uk === UK.PHASES ? buildRoute(true) : route1;
  const idOr = (name: string | undefined): number => (name !== undefined && byName[name] !== undefined && !moves[byName[name]].phase2 ? byName[name] : -1);
  // CHANGED(SIM) P2: counter blocks (follow ids resolve now), armor steps
  ids.forEach((mid, k) => {
    const c = def.moves[mid].counter;
    if (!c) return;
    const follow = byName[c.follow];
    moves[k].counter = { f0: c.catch[0], f1: c.catch[1], strike: c.vs.includes('strike'), proj: c.vs.includes('proj'), follow: follow !== undefined ? follow : -1 };
  });
  if (uk === UK.ARMOR_STEP && Array.isArray(uraw.steps)) {
    for (const n of uraw.steps as string[]) if (byName[n] !== undefined) moves[byName[n]].armorStep = true;
  }
  const u = compileUnique(def, uk, uraw, byName, sys);
  // body / movement
  const jump = def.jump;
  const N = jump.air;
  const apexU = mToU(jump.apexM);
  // choose g so the discrete arc's apex ~ apexM; vy0 = floor(g*N/2) touches down on step N+1, so the
  // fighter spends exactly N frames airborne (takeoff frame = step 1)
  const g = Math.max(1, Math.round((8 * apexU) / (N * N)));
  const vy0 = Math.floor((g * N) / 2);
  const introClip = def.intro ? data.clips[id]?.clips[def.intro] : undefined;
  const tauntClip = def.taunt ? data.clips[id]?.clips[def.taunt] : undefined;
  const cf: CFighter = {
    def,
    id,
    nDef: ids.length,
    moves,
    hpMax: def.hp,
    walkF: mpsToUpf(def.walk.fwd),
    walkB: mpsToUpf(def.walk.back),
    dashF: dashCurve(mToU(def.dash.fwd), def.dash.fwdFrames, sys.movement.dashMovePct),
    dashB: dashCurve(mToU(def.dash.back), def.dash.backFrames, sys.movement.dashMovePct),
    dashFFrames: def.dash.fwdFrames,
    dashBFrames: def.dash.backFrames,
    prejump: jump.prejump,
    airFrames: N,
    landing: jump.landing,
    g,
    vy0,
    vxF: Math.round(mToU(jump.fwdM) / N),
    vxB: Math.round(mToU(jump.fwdM) / N),
    throwRange,
    hurtStand: [mToU(def.hurt.stand[0]), mToU(def.hurt.stand[1])],
    hurtCrouch: [mToU(def.hurt.crouch[0]), mToU(def.hurt.crouch[1])],
    hurtAir: [mToU(def.hurt.air[0]), mToU(def.hurt.air[1])],
    pushW: mToU(def.pushbox[0]),
    pushH: mToU(def.pushbox[1]),
    pushHalf: mToU(def.push ? (def.push.front + def.push.back) / 2 : def.pushbox[0] / 2),
    // CHANGED(fixer) D2: measured extents (fighters/<id>.json `push`), else the symmetric pushbox
    pushFS: mToU(def.push ? def.push.front : def.pushbox[0] / 2),
    pushBS: mToU(def.push ? def.push.back : def.pushbox[0] / 2),
    pushFC: mToU(def.push ? def.push.crouchFront ?? def.push.front : def.pushbox[0] / 2),
    pushBC: mToU(def.push ? def.push.crouchBack ?? def.push.back : def.pushbox[0] / 2),
    vclips: SHARED_CLIPS.map((name) => {
      const c = data.clips[id]?.clips[name];
      if (!c || !(c.dur > 0)) return null;
      const n = Math.max(1, Math.round(c.dur * 60));
      const rootV = new Int32Array(n + 1);
      const root = c.root ?? [];
      for (let v = 0; v <= n; v++) rootV[v] = root.length ? mToU(pwl(root, v / 60)) : 0;
      const slam = c.marks && typeof c.marks.slam === 'number' ? Math.round(c.marks.slam * 1000) : -1;
      return { durMs: Math.round(c.dur * 1000), slamMs: slam, rootV };
    }),
    kdFallMs: Int32Array.from([
      Math.round((sys.anim.kdFall?.kd_fall_b?.[0] ?? 0) * 1000), Math.round((sys.anim.kdFall?.kd_fall_b?.[1] ?? 0) * 1000),
      Math.round((sys.anim.kdFall?.kd_fall_f?.[0] ?? 0) * 1000), Math.round((sys.anim.kdFall?.kd_fall_f?.[1] ?? 0) * 1000),
    ]),
    kdFallMax: sys.anim.fallMaxFrames ?? 30,
    wakeRate100: Math.round((sys.anim.wakeMaxRate ?? 2) * 100),
    gTable,
    aTable,
    throwF,
    throwB,
    impact,
    shove,
    specials: route1.specials,
    s5: route1.s5, s6: route1.s6, s2: route1.s2, s4: route1.s4,
    e5: route1.e5, e6: route1.e6, e2: route1.e2, e4: route1.e4,
    sup1: route1.sup1,
    sup3: route1.sup3,
    sAir: route1.sAir,
    assist: ((sm.assist as string[] | undefined) ?? []).map((n) => idOr(n)).filter((x) => x >= 0),
    animIntro: animIntroId(def),
    animWin: animWinId(def, 0),
    animTaunt: animTauntId(def),
    tauntFrames: tauntClip ? Math.max(30, Math.round(tauntClip.dur * 60)) : 60,
    introFrames: introClip ? Math.round(introClip.dur * 60) : 90,
    // CHANGED(SIM) P2 (CONTRACT section 28)
    uk,
    u,
    route1,
    route2,
    mw: { ...sys.motion, chargeFrames: u.chargeF, chargeKeep: u.keepF },
    ...hurtExtents(def, data),
    animStep: [animStepId(def, 0), animStepId(def, 1), animStepId(def, 2), animStepId(def, 3)],
    stepAtk: [0, 1, 2].map((bt) => {
      const mm = moves.find((q) => q.stepAtk && q.inBtn === bt && q.snapId >= 0 && !q.phase2);
      return mm ? mm.idx : -1;
    }),
    ...fighterStep(def, sys, cs),
  };
  void M;
  void Q;
  cache[id] = cf;
  return cf;
}
