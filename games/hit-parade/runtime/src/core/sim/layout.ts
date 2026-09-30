// HIT PARADE — the ONE Int32Array state layout (CONTRACT §4.2, NETCODE §3.5).
// Every sim field has a fixed word offset declared here. Blocks:
//   W  world block at offset 0
//   F  fighter block (offsets relative to the fighter base), 2 fighters, stride FIGHTER_INTS
//   P  projectile block (relative), PROJ_CAP slots, stride PROJ_INTS
//   -- STATE_INTS (versus / training / online / arcade state ends here, hard cap 1024 ints)
//   G  goon block (relative), GOON_CAP slots after a BRAWL header (offline modes only)
// Adding or moving a field changes STATE_VERSION (it hashes the layout sizes and LAYOUT_REV),
// which NET sends in HELLO.

import { hash32 } from '../rng.ts';

/** Bump when a field's MEANING changes without the sizes changing. */
export const LAYOUT_REV = 1;

function builder(): { f: () => number; a: (n: number) => number; size: () => number } {
  let n = 0;
  return {
    f: () => n++,
    a: (k: number) => {
      const o = n;
      n += k;
      return o;
    },
    size: () => n,
  };
}

// ---------------------------------------------------------------- world
const wb = builder();
export const W = {
  ver: wb.f(),
  frame: wb.f(),
  phase: wb.f(),
  phaseF: wb.f(),
  round: wb.f(),
  timer: wb.f(), // frames left; -1 = infinite
  wins0: wb.f(),
  wins1: wb.f(),
  winner: wb.f(), // -1 undecided / drawn match, 0 | 1
  draw: wb.f(), // 1 when the match ended drawn
  roundWinner: wb.f(), // -1 none yet, 0 | 1, 2 = draw round
  matchDeciding: wb.f(),
  seed: wb.f(),
  rng: wb.f(), // mulberry32 cursor (general stream)
  freeze: wb.f(), // world freeze frames left (super freeze / perfect parry)
  freezeKind: wb.f(), // 0 none, 1 super, 2 perfect parry
  freezeOwner: wb.f(),
  koStop: wb.f(), // KO hitstop frames left
  slowmo: wb.f(), // KO slow-mo frames left
  slowTick: wb.f(),
  cinActive: wb.f(),
  cinFighter: wb.f(),
  cinMove: wb.f(),
  cinFrame: wb.f(),
  cinLen: wb.f(),
  cinHit: wb.f(), // next authored hit index
  camCue: wb.f(),
  camCueFighter: wb.f(),
  camCueFrame: wb.f(),
  evSeq: wb.f(), // events ring write cursor (ring memory lives on Match.events)
  mode: wb.f(),
  roundsNeed: wb.f(),
  maxRounds: wb.f(),
  timerSetting: wb.f(), // seconds, 0 = infinite
  reserved: wb.a(6),
};
export const WORLD_INTS = wb.size();

// ---------------------------------------------------------------- fighter
export const HIST = 32; // input history ring length (frames)

const fb = builder();
export const F = {
  x: fb.f(),
  y: fb.f(),
  vx: fb.f(),
  vy: fb.f(),
  facing: fb.f(), // +1 faces +X, -1 faces -X
  st: fb.f(), // ST.*
  stF: fb.f(), // frames in state
  mv: fb.f(), // compiled move index, -1 none
  mvF: fb.f(), // move frame, 1 on the move's first frame
  mvInst: fb.f(), // move instance counter (combo scaling counts moves, not hits)
  mvFlags: fb.f(), // MVF.*
  contact: fb.f(), // 0 none, 1 hit, 2 block/parry/armor
  contactF: fb.f(), // mvF at first contact
  hitMask: fb.f(), // hit ids that already connected this move
  hitCount: fb.f(),
  lastHitF: fb.f(), // mvF of the last hit (multi-hit interval)
  armorLeft: fb.f(),
  armorAbs: fb.f(), // hits absorbed this move
  hitstop: fb.f(),
  stun: fb.f(), // frames left in hitstun / blockstun / knockdown / timed states
  stunKind: fb.f(), // anim hint for the stun state
  hp: fb.f(),
  grey: fb.f(),
  greyDelay: fb.f(),
  showtime: fb.f(),
  nerve: fb.f(),
  nerveCd: fb.f(), // regen cooldown after spending
  nerveBlk: fb.f(), // regen stop after blocking
  fright: fb.f(), // STAGE FRIGHT (burnout) flag
  cCount: fb.f(), // combo hits TAKEN
  cStep: fb.f(), // scaling step (attacks counted)
  cStarter: fb.f(), // 1 = light-starter table
  cLastInst: fb.f(), // attacker's mvInst of the last counted attack
  cFlags: fb.f(), // CF.*
  cDamage: fb.f(), // combo damage taken
  jc: fb.f(), // juggle count
  ppPending: fb.f(), // was perfect-parried: the punish combo is x0.5
  kd: fb.f(), // pending knockdown kind 0 none 1 soft 2 hard
  wake: fb.f(), // 0 normal rise, 1 back rise
  invS: fb.f(), // strike invulnerability frames (timers, not move ranges)
  invT: fb.f(), // throw invulnerability frames
  invP: fb.f(), // projectile invulnerability frames
  chB: fb.f(), // back charge frames held
  chBS: fb.f(), // back charge stored at release
  chBR: fb.f(), // frames since back release
  chD: fb.f(),
  chDS: fb.f(),
  chDR: fb.f(),
  hHead: fb.f(), // history write index
  hist: fb.a(HIST), // HISTORY entries (see inputs.ts)
  raw: fb.f(), // this frame's raw input word
  prevRaw: fb.f(),
  bufA: fb.f(), // ACT.* buffered action
  bufM: fb.f(), // move index for ACT.MOVE
  bufAge: fb.f(),
  bufWin: fb.f(),
  bufF: fb.f(), // BUF.* flags
  ageL: fb.f(), // frames since last press of L / M / H / S (chords), capped
  ageM: fb.f(),
  ageH: fb.f(),
  ageS: fb.f(),
  techWin: fb.f(), // frames left to tech the throw being received
  throwDir: fb.f(), // 0 forward, 1 back (thrower side)
  throwDmgF: fb.f(), // frames until the throw damage lands (thrower side)
  throwUntech: fb.f(),
  parryF: fb.f(),
  parryOk: fb.f(), // a parry succeeded during this parry
  animId: fb.f(),
  animF: fb.f(),
  pAnimId: fb.f(),
  pAnimF: fb.f(),
  blendT: fb.f(), // 0..6 (sixths of full weight)
  blendStep: fb.f(),
  flags: fb.f(), // FL.*
  assistStep: fb.f(),
  uniq: fb.a(4), // per-fighter unique ints (§4.2)
  pushLeft: fb.f(), // world-signed pushback still to apply (U)
  pushF: fb.f(),
  lastDmg: fb.f(),
  counterFlag: fb.f(), // last hit received: 0 normal, 1 counter, 2 punish counter
  lastStun: fb.f(),
  jumpDir: fb.f(), // -1 back, 0 neutral, +1 forward
  neutralF: fb.f(), // frames actionable (training refill)
  bounce: fb.f(), // ground bounce pending
  rushF: fb.f(),
  after: fb.f(), // knockdown frames that follow a throw lock
  throwDmg: fb.f(), // pending throw damage (thrower side)
  animInst: fb.f(), // mvInst the current move anim belongs to
  reserved: fb.a(3),
};
export const FIGHTER_INTS = fb.size();

// ---------------------------------------------------------------- projectiles
export const PROJ_CAP = 12;
const pb = builder();
export const P = {
  act: pb.f(),
  owner: pb.f(),
  mv: pb.f(),
  x: pb.f(),
  y: pb.f(),
  vx: pb.f(),
  life: pb.f(),
  hits: pb.f(),
  w: pb.f(),
  h: pb.f(),
  age: pb.f(),
  hitCd: pb.f(),
  kind: pb.f(), // 0 projectile, 1 ball (unique), 2 heckle object
  str: pb.f(),
  inst: pb.f(), // owner's mvInst of the spawning move (combo scaling)
  flags: pb.f(), // owner's mvFlags at spawn (SIMPLE x0.8, RUSH)
  vy: pb.f(), // vertical speed (arcing projectiles)
};
export const PROJ_INTS = pb.size();

// ---------------------------------------------------------------- bases
export const FIGHTER_BASE = WORLD_INTS;
export const PROJ_BASE = FIGHTER_BASE + 2 * FIGHTER_INTS;
/** Versus / training / arcade / online state length (hard cap 1024). */
export const STATE_INTS = PROJ_BASE + PROJ_CAP * PROJ_INTS;

// ---------------------------------------------------------------- BRAWL / HECKLER (offline only)
export const GOON_CAP = 8;
const bh = builder();
export const BR = {
  score: bh.f(),
  wave: bh.f(),
  waveTimer: bh.f(),
  tokens: bh.f(),
  spawned: bh.f(),
  downed: bh.f(),
  timeLeft: bh.f(),
  rng: bh.f(),
  reserved: bh.a(8),
};
export const BRAWL_HEADER_INTS = bh.size();
const gb = builder();
export const G = {
  act: gb.f(),
  kind: gb.f(),
  x: gb.f(),
  y: gb.f(),
  vx: gb.f(),
  vy: gb.f(),
  facing: gb.f(),
  st: gb.f(),
  stF: gb.f(),
  hp: gb.f(),
  mv: gb.f(),
  mvF: gb.f(),
  hitstop: gb.f(),
  stun: gb.f(),
  token: gb.f(),
  animId: gb.f(),
  animF: gb.f(),
  reserved: gb.a(7),
};
export const GOON_INTS = gb.size();
export const BRAWL_BASE = STATE_INTS;
export const GOON_BASE = BRAWL_BASE + BRAWL_HEADER_INTS;
export const STATE_INTS_BRAWL = GOON_BASE + GOON_CAP * GOON_INTS;

export const STATE_VERSION = hash32(LAYOUT_REV, STATE_INTS, (FIGHTER_INTS << 16) | (PROJ_INTS << 8) | WORLD_INTS);

export function fighterBase(i: number): number {
  return FIGHTER_BASE + i * FIGHTER_INTS;
}
export function projBase(k: number): number {
  return PROJ_BASE + k * PROJ_INTS;
}
export function goonBase(k: number): number {
  return GOON_BASE + k * GOON_INTS;
}

// ---------------------------------------------------------------- enum-like constants
/** Fighter states. */
export const ST = {
  INTRO: 0,
  IDLE: 1,
  CROUCH: 2,
  WALK_F: 3,
  WALK_B: 4,
  PREJUMP: 5,
  AIR: 6,
  LAND: 7,
  DASH_F: 8,
  DASH_B: 9,
  ATTACK: 10,
  HITSTUN: 11,
  BLOCKSTUN: 12,
  JUGGLE: 13,
  KNOCKDOWN: 14,
  THROWN: 15,
  TECH: 16,
  PARRY: 17,
  PARRY_REC: 18,
  CRUMPLE: 19,
  WALL_SPLAT: 20,
  DIZZY: 21,
  RUSH: 22,
  TAUNT: 23,
  RECOVER: 24,
  CINEMATIC: 25,
  KO: 26,
  WIN: 27,
  LOSE: 28,
  GRAB: 29, // attacker holding a landed grab (CONTRACT 20.2 grab.frames)
} as const;
export const ST_NAMES: readonly string[] = [
  'intro', 'idle', 'crouch', 'walk_f', 'walk_b', 'prejump', 'air', 'land', 'dash_f', 'dash_b',
  'attack', 'hitstun', 'blockstun', 'juggle', 'knockdown', 'thrown', 'tech', 'parry', 'parry_rec',
  'crumple', 'wall_splat', 'dizzy', 'rush', 'taunt', 'recover', 'cinematic', 'ko', 'win', 'lose', 'grab',
];

/** Match phases. */
export const PH = { INTRO: 0, FIGHT: 1, KO: 2, TIMEOVER: 3, ROUND_END: 4, MATCH_END: 5 } as const;
export const PH_NAMES: readonly string[] = ['intro', 'fight', 'ko', 'timeover', 'roundEnd', 'matchEnd'];

/** Fighter flag bits (F.flags). */
export const FL = {
  AIRBORNE: 1,
  CROUCHING: 2,
  ASSIST: 4, // ASSIST held
  TAUNTING: 8,
  AIR_USED: 16, // air normal already used this jump
  PROX: 32, // proximity guard pose
  THROWING: 64, // in the hold phase of a landed throw
  PUSHX: 128, // current pushback transfers to the opponent at a wall (melee hits)
  KO: 256,
  BLOCKING: 512, // blocking pose this frame (UI)
} as const;

/** Move instance flags (F.mvFlags). */
export const MVF = {
  SIMPLE: 1, // one-button special/super: x0.8
  NOCANCEL: 2, // perfect-parried: cannot cancel
  RUSH: 4, // started from RUSH: +4 stun
  SPAWNED: 8, // projectile spawned
  ROUTE: 16, // part of an assist route
  WHIFFED: 32, // WHIFF event emitted
  CIN: 64, // cinematic started
  CLASH: 128,
} as const;

/** Combo flags on the DEFENDER (F.cFlags). */
export const CF = {
  SPLAT: 1, // wall splat used this combo
  BOUNCE: 2, // ground bounce used this combo
  PP: 4, // perfect-parry punish x0.5
  RUSH: 8, // rush mid-combo x0.85
  DIZZY: 16, // started from a STAGE FRIGHT stun (x0.8 start)
} as const;

/** Buffered actions (F.bufA). */
export const ACT = { NONE: 0, MOVE: 1, PARRY: 2, DASH_F: 3, DASH_B: 4, TAUNT: 5, ROUTE: 6 } as const;

/** Buffer flags (F.bufF). */
export const BUF = { SIMPLE: 1, CHAIN: 2, FROM_KD: 4, NEG: 8, FROZEN: 16 } as const;

/** Mode codes (W.mode). */
export const MODE_CODES: readonly string[] = ['versus', 'arcade', 'training', 'online', 'brawl', 'heckler'];
