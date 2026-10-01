// HIT PARADE — shared data + snapshot types (CONTRACT §4.6, §5, §16, §17, §19). THREE-free.

export type Vec2 = [number, number];
export type FrameRange = [number, number];

// ------------------------------------------------------------------ fighter data (§5.2)
export interface BoxDef {
  f: FrameRange; // move frames (1-based, inclusive)
  x: number; // metres forward of the fighter origin (box centre)
  y: number; // metres up (box centre)
  w: number;
  h: number;
}

export type MoveKind =
  | 'normal' | 'command' | 'special' | 'ex' | 'super1' | 'super3'
  | 'throw' | 'cmdgrab' | 'projectile' | 'system';
export type Guard = 'HL' | 'H' | 'L' | 'U';
export type KdKind = 'none' | 'soft' | 'hard';
export type Strength = 'L' | 'M' | 'H';

export interface ProjectileDef {
  speed: number; // m/s
  life: number; // frames
  box: Vec2; // [w, h] metres
  y: number; // metres
  hits?: number;
  strength?: string;
  clip?: string;
  limit?: number; // per-fighter on-screen limit (default 1)
  x?: number; // spawn metres forward (default system.projectile.spawnXM)
  vy?: number; // m/s initial vertical speed (arcing projectile)
  g?: number; // m/s² gravity on the projectile
  ground?: boolean; // rolls along the floor instead of despawning on touchdown
  /** CHANGED(SIM3D) (CONTRACT §35.4): aim at the opponent at spawn (default: along the thrower's yaw) */
  aimed?: boolean;
  /** CHANGED(SIM3D): hit box half-depth across the travel line (m); default box[0] / 2 */
  lateralM?: number;
}

export interface CinematicDef {
  frames: number;
  cue: string;
  hits: Vec2[]; // [cinematic frame, damage]
  // §20.2 extras: view-side timelines + the end state the sim applies
  anim?: [number, string][];
  victim?: [number, string][];
  shots?: [number, string][];
  endAdv?: number;
  endGapM?: number;
  /** CHANGED(SIM) P2: §26.1 how the defender lies at the end ('back' | 'front'); the sim starts the KD without a fall */
  endPose?: string;
  [key: string]: unknown;
}

export interface Move {
  kind: MoveKind;
  input?: string;
  startup: number;
  active: number;
  recovery: number;
  damage?: number;
  chipPct?: number;
  hitstop?: number;
  hitstun?: number;
  blockstun?: number;
  guard?: Guard;
  boxes?: BoxDef[];
  hurtExt?: BoxDef[];
  move?: Vec2[]; // [frame, metres forward] piecewise linear
  pushback?: { hit?: number; block?: number };
  cancel?: string[];
  juggle?: { js?: number; ji?: number; jl?: number };
  onHit?: { kd?: KdKind; launch?: Vec2; wallSplat?: boolean; groundBounce?: boolean; crumple?: boolean };
  gain?: { showtime?: number; nerveCost?: number };
  cost?: { showtime?: number; nerve?: number };
  invuln?: { strike?: FrameRange; throw?: FrameRange; air?: FrameRange; proj?: FrameRange };
  armor?: { hits: number; f: FrameRange };
  projectile?: ProjectileDef;
  cinematic?: CinematicDef;
  anim?: { clip: string; warp?: Vec2[] };
  sfx?: [number, string][];
  // optional (CONTRACT §19.5)
  strength?: Strength;
  air?: boolean;
  armorBreak?: boolean;
  starter?: 'light';
  multi?: number;
  // optional (CONTRACT §20.2, lane FIGHTERS)
  hits?: HitDef[];
  moveY?: Vec2[];
  airVel?: Vec2;
  hurtOverride?: { f: FrameRange; w: number; h: number; y?: number }[];
  grab?: GrabDef;
  tc?: boolean;
  trigger?: { classic?: { motion: string; btn: string }; simple?: string };
  counter?: { catch: FrameRange; vs: string[]; follow: string };
  teleport?: { f: number; to: string; gapM: number };
  stance?: string;
  ball?: { act: string };
  phase?: number;
  role?: string[]; // CHANGED(SIM) P2: a tag list (§20.2); the loader turns a lone string into [string]
  name?: string;
  desc?: string;
  /** CHANGED(fixer) D2: extra push-box FRONT extent (m) over the fighter's neutral front, per move frame (piecewise
   *  linear, >= 0): the clip's measured forward lean (data/fighters/_gen, art/blender/measure_body.py) */
  pushExt?: Vec2[];
  /** CHANGED(SIM) P2 (CONTRACT §28.2): install granted when the move starts */
  install?: { frames: number; damagePct?: number; walkPct?: number };
  /** informational (FIGHTERS §20.6): "hitVolume" = the v1 derived box widened; SIM re-derives those (§28.5b) */
  boxSrc?: string;
  /** CHANGED(SIM3D) (CONTRACT §35.4): move frames 1..until re-face the opponent by at most `rate` deg / frame
   *  (rate absent / 0 = full re-face). Defaults: normals until = startup - 4, specials / supers startup - 6. */
  track?: { until?: number; rate?: number };
  /** tracks through the active frames (sweeps, spins, lariats, most supers, command-grab reach arcs) */
  homing?: boolean;
  /** no tracking after frame 1 (rushes, straight projectiles, charge moves) */
  linear?: boolean;
  /** hitbox half-depth across the attack line (m). Defaults L 0.15, M 0.18, H 0.22, sweep 0.45, homing 0.60 */
  lateralM?: number;
}

/** CHANGED(SIM) P2 (CONTRACT §28.5c): measured posture extents [front, back] in metres from the root along the facing. */
export interface BodyExt {
  stand: Vec2;
  crouch: Vec2;
  air: Vec2;
  /**
   * CHANGED(wf6_fixer_core) D1: optional - the FACE-DOWN fall [front, back] (m, the widest per-frame 98th-percentile extent
   * over kd_fall_f / kd_ground_f / wake_f); the sim keeps a body that drops face-down off the ring wall clear of it
   */
  down?: Vec2;
}

/** §20.2 one hit of a multi-hit move. */
export interface HitDef {
  f: FrameRange;
  damage: number;
  hitstop?: number;
}

/** §20.2 grab block (throws, command grabs, grab supers). */
export interface GrabDef {
  rangeM?: number; // pushbox front to pushbox front
  frames: number; // lock length from the connect frame
  adv: number; // attacker advantage after the release (defender knocked down)
  hitF: number; // lock frame the damage lands on (1 = connect frame)
  swap?: boolean;
  air?: boolean;
  techable?: boolean;
  clip?: string;
  /** CHANGED(fixer) D3: the victim's animation over the lock: [lockFrame, sharedClip, fromS?, toS?] segments (each runs
   *  until the next one starts, or the lock ends; fromS / toS = the clip range it plays - toS omitted = 1 clip-second per
   *  60 frames from fromS). Omitted = thrown_f / thrown_b (swap) with its slam mark on hitF, ending at release. */
  victim?: [number, string, number?, number?][];
  /** CHANGED(fix_core) D4 (CONTRACT §35.20): the victim's ROOT path over the lock, [lockFrame, gapM, liftM] keys = root to
   *  root distance along the thrower's forward (at the connect) + height; implicit first key = the actual distance at the
   *  connect (lift 0), linear between keys, held after the last; while lift < 0.30 m the gap never goes under the two push
   *  fronts (CONTRACT §26.5). Replaces the clip-root carry. Generated for grab supers from their cinematic gapD.
   *  CHANGED(wf6_fixer_core) V2: an optional 4th number per key = turnDeg, the THROWER's yaw turn since the connect (degrees,
   *  yaw convention, may exceed 360: 720 = two whole turns), linear between keys from an implicit 0: the thrower turns with
   *  it (a carousel), the victim's root swings round the connect root with it (gap along the turned forward) and it keeps
   *  facing the thrower. Must end on a whole number of turns (validate.py). */
  path?: Array<[number, number, number] | [number, number, number, number]>;
  /** CHANGED(fix_core) D4: push-front gap (m) the victim is pulled to at the connect (default system.json throw.holdGapM) */
  holdGapM?: number;
}

export interface ClassicEntry {
  motion: string;
  btn: string;
  move: string;
}

export interface SimpleMap {
  '5S'?: string;
  '6S'?: string;
  '2S'?: string;
  '4S'?: string;
  'S+H'?: string;
  'S+H+2'?: string;
  A5S?: string;
  A6S?: string;
  A2S?: string;
  A4S?: string;
  assist?: string[];
  [key: string]: string | string[] | undefined;
}

export interface FighterDef {
  id: string;
  name: string;
  persona?: string;
  archetype?: string;
  body?: string;
  heightM: number;
  hp: number;
  walk: { fwd: number; back: number };
  dash: { fwd: number; back: number; fwdFrames: number; backFrames: number };
  jump: { prejump: number; air: number; landing: number; apexM: number; fwdM: number };
  throwRangeM: number;
  hurt: { stand: Vec2; crouch: Vec2; air: Vec2 };
  pushbox: Vec2;
  /** CHANGED(fixer) D2: measured push-box extents (m) from the root along the facing: front / back standing and
   *  crouching (omitted = pushbox[0] / 2 each side, the symmetric box) */
  push?: { front: number; back: number; crouchFront?: number; crouchBack?: number };
  /** CHANGED(SIM) P2 (CONTRACT §28.5c): measured hurtbox extents (wins over data/bodies.json) */
  hurtBody?: BodyExt;
  /** CHANGED(fix_core) D1 (CONTRACT §35.20): this fighter's sidestep arc length in metres (0.5..2.5; the kit generator
   *  sizes it from the measured body in data/bodies.json); absent = system.json step.distM (0.85) */
  step?: { distM?: number };
  colors?: { name: string; tint: string | null }[];
  moves: Record<string, Move>;
  simple: SimpleMap;
  classic: ClassicEntry[];
  unique?: { kind: string; [key: string]: unknown };
  intro?: string;
  win?: string[];
  taunt?: string;
  rival?: string;
  stage?: string;
  cpu?: { style?: string; [key: string]: unknown };
  [key: string]: unknown;
}

// ------------------------------------------------------------------ clips (§6.3, generated by ASSETS)
export interface ClipInfo {
  dur: number;
  frames: number;
  contact: number | null;
  effector: { bone: string; at: Vec2 } | null;
  root: Vec2[];
  apexY: number | null;
  loop: boolean;
  marks?: Record<string, number>;
  /** CHANGED(SIM) P2: per-mark effector points (§6.3 CHANGED(ASSETS) part 2) - derive v2 uses one per `hits` entry */
  marksAt?: Record<string, { bone: string; at: Vec2 }>;
}

export interface ClipsFile {
  heightM?: number;
  hipsM?: number;
  handReachM?: number;
  footReachM?: number;
  /** Normalised by core/data.ts: every clip, whether the file nests them under `clips` or not. */
  clips: Record<string, ClipInfo>;
}

// ------------------------------------------------------------------ system.json (§5.1)
export type StrengthTable = { L: number; M: number; H: number; [k: string]: number };

export interface System {
  version: number;
  hp: { default: number };
  round: {
    timer: number; rounds: number; maxRounds: number; introFrames: number; koHitstop: number;
    koSlowmoFrames: number; koSlowmoEvery: number; koOutroFrames: number; timeoverOutroFrames: number;
    startDistanceM: number;
  };
  stage: { wallM: number; separationCapM: number };
  movement: {
    walkFirstFramePct: number; dashTapMax: number; dashGapMax: number; dashMovePct: number;
    backDashThrowInvuln: FrameRange; crouchHurtFrame: number; crouchTransFrames: number; proxGuardM: number;
  };
  jump: { prejump: number; air: number; landing: number; apexM: number; fwdM: number };
  buffer: { classic: number; simple: number; dash: number; wakeup: number; afterStun: number; chordFrames: number };
  motion: { qc: number; dp: number; hc: number; spd: number; double: number; chargeFrames: number; chargeKeep: number; tap22: number };
  hitstop: StrengthTable & { special: number; projectile: number; impact: number; superHit: number; superLast: number; throw: number; pcHeavyBonus: number };
  hitstun: StrengthTable & { special: number; projectile: number; blockstunDelta: number };
  counter: { chFrames: number; chDamagePct: number; pcFrames: number; pcDamagePct: number; pcThrowDamagePct: number };
  scaling: {
    general: number[]; light: number[]; superMinPct: { super1: number; super3: number };
    perfectParryPct: number; rushPct: number; comboThrowPct: number;
  };
  simple: { damagePct: number };
  grey: { delay: number; regenPerFrame: number };
  showtime: {
    bar: number; bars: number; blockPct: number; defHitPct: number; defBlockPct: number; techGain: number;
    gain: StrengthTable & { special: number; throw: number; projectile: number };
    super1Cost: number; super3Cost: number;
  };
  nerve: {
    bar: number; bars: number; regen: number; regenStunAir: number; walkFwdBonus: number;
    blockDrain: StrengthTable & { special: number; super: number; projectile: number; impact: number };
    blockRegenStop: number; spendCooldown: number; whiffParryCooldown: number;
    exCost: number; impactCost: number; shoveCost: number; rushCost: number; hitGain: number;
  };
  stageFright: { regen: number; blockstunBonus: number; chipPct: number; cornerImpactStun: number; stunScalePct: number; cornerRangeM: number };
  parry: {
    active: number; perfectFrames: number; recovery: number; costStart: number; costStartFrame: number;
    drainPerFrame: number; drainFromFrame: number; refund: { projectile: number; strike: number; super: number };
    perfectFreeze: number; perfectInvulnAfter: number; projPerfectRecovery: number;
  };
  rush: { startup: number; speedMps: number; frames: number; recovery: number; advBonus: number };
  impact: {
    startup: number; active: number; recovery: number; damage: number; hitstop: number; hitstun: number;
    blockstun: number; armorHits: number; armorFrames: FrameRange; box: { x: number; y: number; w: number; h: number };
    travel: Vec2[]; pushbackHitM: number; pushbackBlockM: number; splatRangeM: number;
  };
  shove: {
    startup: number; active: number; recovery: number; damage: number; hitstop: number; hitstun: number;
    blockstun: number; invuln: FrameRange; box: { x: number; y: number; w: number; h: number };
    pushbackHitM: number; pushbackBlockM: number;
  };
  throw: {
    startup: number; active: number; recovery: number; rangeM: number; damage: number; hitstunF: number;
    hitstunB: number; techWindow: number; techFrames: number; techPushM: number; damageFrame: number;
    postStunInvuln: number; wakeupInvuln: number; backThrowOffsetM: number;
    /** CHANGED(SIM3D) (CONTRACT §35.4): the defender must be inside the thrower's front arc +- this (deg), default 70 */
    frontArcDeg?: number;
    /** CHANGED(fix_core) D4 (CONTRACT §35.20): at the connect the victim slides onto the thrower's forward line at the HOLD
     *  distance (push fronts touching + holdGapM) over pullF frames (defaults 6 f / 0.0 m) */
    pullF?: number;
    holdGapM?: number;
  };
  kd: { fallFrames: number; wakeupFrames: number; softLandTotal: number; hardLandTotal: number; airResetLand: number; backRiseM: number; minTotal: number };
  juggle: {
    gravityMps2: number; airReset: Vec2; pop: Vec2;
    defaults: Record<'normal' | 'special' | 'super', { js: number; ji: number; jl: number }>;
  };
  /** CHANGED(wf6_fixer_core) D1: dropF = frames the face-down drop off the wall slides the body clear of it (default 5) */
  wallSplat: { frames: number; rangeM: number; fallTotal: number; dropF?: number };
  groundBounce: { vyMps: number };
  crumple: { frames: number };
  pushback: StrengthTable & { frames: number; special: number; super: number; projectile: number };
  cancel: { graceAfterActive: number };
  super: { freeze1: number; freeze3: number };
  cinematic: { attackerRecover: number; victimKd: number };
  projectile: { spawnXM: number; screenHalfM: number };
  boxes: { L: Vec2; M: Vec2; H: Vec2 };
  anim: {
    blendAttack: number; blendHit: number; blendLoco: number; blendDefault: number;
    /** CHANGED(fixer) D3: knockdown presentation. kdFall[clip] = [dropS, groundS]: when the shared fall clip starts to
     *  drop / hits the floor (a KD from standing plays dropS..end, a juggle landing groundS..end, over at most
     *  fallMaxFrames); the wake clip ends exactly on the actionable frame, played at <= wakeMaxRate x speed. */
    kdFall?: Record<string, [number, number]>;
    fallMaxFrames?: number;
    wakeMaxRate?: number;
  };
  training: { refillDelay: number };
  /** CHANGED(SIM3D) (CONTRACT §35): ring defaults, STEP_IN / STEP_OUT, tracking + lateral defaults */
  ring?: { defaultRadiusM?: number; againstWallM?: number; camMinSepM?: number; spawnAxisDeg?: number; sectors?: number };
  step?: { frames?: number; distM?: number; movePct?: number; bufferF?: number; attackF?: number; blockF?: number; walkMps?: number; settleF?: number };
  track?: { normalUntilOffset?: number; specialUntilOffset?: number };
  /** CHANGED(fix_core) D7 (CONTRACT §35.20): BACK HIT - a hit from more than arcDeg off a grounded defender's facing deals
   *  damagePct % and +hitstunF hitstun frames (defaults 120 / 120 / 4) */
  backHit?: { arcDeg?: number; damagePct?: number; hitstunF?: number };
  lateral?: { L: number; M: number; H: number; sweep: number; homing: number };
  /** CHANGED(SIM) P2 (CONTRACT §28): unique defaults, bonus rounds */
  uniques?: UniquesSys;
  brawl?: BrawlSys;
  heckler?: HecklerSys;
  [key: string]: unknown;
}

/** CHANGED(SIM) P2: data/system.json `uniques` (defaults; a kit's unique block wins). */
export interface UniquesSys {
  stance?: { maxF?: number; blockExitF?: number; exitHoldF?: number };
  charge?: { chargeF?: number; keepF?: number; standBlockNervePct?: number };
  ball?: {
    respawnF?: number; restF?: number; pickupM?: number; bounces?: number; kickRangeM?: number; wallRestitutionPct?: number;
    looseGravityMps2?: number; deflectVxPct?: number; deflectVyMps?: number; looseFrictionPct?: number; kickBackM?: number;
  };
  counter?: { catchHitstop?: number };
  armorStep?: { tickStrength?: string };
  phases?: { thresholdPct?: number; lockF?: number };
}

/** CHANGED(SIM) P2: a goon move = an ordinary Move plus its id. */
export type GoonMoveDef = Move & { id: string };

/** CHANGED(SIM) P2: data/system.json `brawl` (BRAWL BREAK). */
export interface BrawlSys {
  seconds: number; maxActive: number; tokens: number; tokenSpacingF: number; telegraphMinF: number;
  spawnDistM: number; spawnGapF: number; waveGapF: number; thinkF: [number, number];
  ringM: { attack: [number, number]; approach: [number, number] };
  goonHurt: Vec2; goonPush: Vec2; hitstunF: number; kdF: number; wakeF: number; downF: number; maxJuggle: number;
  kinds: { id: string; hp: number; walk: number }[];
  waves: number[][];
  moves: GoonMoveDef[];
  moveRangeM: number[];
  score: { hit: number[]; special: number; super: number; throw: number; ko: number; crowd: number; parry: number; perfect: number; comboCashF: number };
  ratings: {
    start: number; idleF: number; mult: number[]; decayPerSec: number[];
    gain: { hit: number[]; special: number; super: number; throw: number; ko: number; crowd: number; parry: number; perfect: number };
  };
}

/** CHANGED(SIM) P2: data/system.json `heckler` (HECKLER TOSS). */
export interface HecklerSys {
  seconds: number; maxLive: number; spawnDistM: [number, number]; spawnY: number; aimY: number; gravityMps2: number;
  cadence: { startF: number; endF: number; jitterF: number; firstF: number };
  objects: { id: string; flightF: number; damage: number; box: Vec2 }[];
  hitstun: number; blockstun: number; hitstop: number;
  score: { parry: number; perfect: number; hitCost: number };
}

// ------------------------------------------------------------------ other data files (owned by other lanes)
export type StagesFile = Record<string, unknown>;
export type LadderFile = Record<string, unknown>;
export type CpuFile = Record<string, unknown>;

/** §17 rule 2: one entry of the per-fighter anim table. */
export interface AnimRef {
  clip: string;
  warp: [number, number][] | null;
  loop: boolean;
  moveId: number; // -1 = system / intro / win / taunt
}

export interface GameData {
  system: System;
  fighters: Record<string, FighterDef>;
  clips: Record<string, ClipsFile>;
  stages: StagesFile;
  ladder: LadderFile;
  cpu: CpuFile;
  strings: Record<string, string>;
  /** §17 rule 2 anim tables, per fighter id. */
  anims: Record<string, AnimRef[]>;
  /** Non-fatal load findings (missing clips files, derived fallbacks). probe_data prints them. */
  warnings: string[];
  /** CHANGED(SIM) P2 (CONTRACT §28.5c): measured hurtbox extents per fighter id (data/bodies.json) */
  bodies: Record<string, BodyExt>;
  /** CHANGED(SIM) P2 (CONTRACT §28.4): goon anim tables per goon id (§17 rule 2 layout: 34 shared + 3 goon moves) */
  goonAnims: Record<string, AnimRef[]>;
}

// ------------------------------------------------------------------ snapshots (§4.6 + §19.7)
export interface FighterFlags {
  invuln: boolean;
  armor: boolean;
  counter: boolean;
  stance: number;
  taunting: boolean;
  ko: boolean;
}

export interface FighterSnap {
  x: number; // metres (world x)
  y: number; // metres (height)
  /** CHANGED(SIM3D) (CONTRACT §35): world z (metres) - the fight is on the (x, z) ground plane. Always set by the sim
   *  (optional in the type only so older hand-built snapshots in labs / probes still type-check) */
  z?: number;
  /** CHANGED(SIM3D): body yaw in RADIANS for the view (three.js rotation.y of a model facing +Z at rest); always set */
  yaw?: number;
  /** +1 | -1 = the SCREEN side the fighter faces (sign of its forward on the camera's screen-right, CONTRACT §35.3) */
  facing: number;
  state: number;
  stateName: string;
  moveId: number; // §17 rule 1, -1 none
  moveName: string; // move key, or system move name, '' none
  moveKind: string;
  moveFrame: number;
  animId: number;
  animFrame: number;
  prevAnimId: number;
  prevAnimFrame: number;
  blendT: number; // 0..1 weight of the current anim
  animSec: number; // convenience: seconds into animId's clip per §17 rule 3
  hp: number;
  hpMax: number;
  greyHp: number;
  showtime: number;
  nerve: number;
  stageFright: boolean;
  combo: number; // hits this fighter is currently landing
  comboDamage: number;
  lastDamage: number;
  hitstop: number;
  stun: number;
  airborne: boolean;
  crouching: boolean;
  flags: FighterFlags;
  unique: [number, number, number, number];
  /** CHANGED(SIM) P2 (CONTRACT §28.1) */
  install?: number;
  absent?: boolean;
  actionable?: boolean;
  /** CHANGED(SIM3D) (CONTRACT §35.2): step state - kind, step frame (1..), the side of the fighter's OWN body it moves
   *  toward (-1 left, +1 right, 0 none) and which button ('in' = STEP_IN away from the camera, 'out' = toward it).
   *  CHANGED(fix_core) D1 (CONTRACT §35.20): `dist` = this fighter's sidestep arc length in metres (its step.distM, e.g.
   *  0.85 johnny / 1.219 bruno / 1.715 rerun) so the view can scale the sidestep clip's lateral travel to it */
  step?: { kind: 'none' | 'sidestep' | 'sidewalk' | 'settle'; frame: number; side: number; dir: 'in' | 'out' | ''; dist?: number };
}

/** CHANGED(SIM) P2 (CONTRACT §28.4): one goon of BRAWL BREAK. */
export interface GoonSnap {
  slot: number;
  kind: string;
  kindIdx: number;
  x: number;
  y: number;
  /** CHANGED(SIM3D): world z (m) and yaw (radians, three.js rotation.y); always set by the sim */
  z?: number;
  yaw?: number;
  facing: number;
  state: number;
  stateName: string;
  animId: number;
  animFrame: number;
  prevAnimId: number;
  prevAnimFrame: number;
  blendT: number;
  hp: number;
  hpMax: number;
  hitstop: number;
  telegraph: boolean;
  token: boolean;
  moveName: string;
  down: boolean;
}

/** CHANGED(SIM) P2 (CONTRACT §28.4): bonus-round state. */
export interface BrawlSnap {
  mode: 'brawl' | 'heckler';
  score: number;
  ratings: number;
  grade: number;
  mult: number;
  timeLeft: number;
  timeLeftF: number;
  wave: number;
  spawned: number;
  downed: number;
  combo: number;
  parries: number;
  perfects: number;
  hitsTaken: number;
  goons: GoonSnap[];
  /** CHANGED(SIM3D) (CONTRACT §35.8): the soft-lock goon slot the player faces (-1 none) */
  target?: number;
}

export type MatchPhase = 'intro' | 'fight' | 'ko' | 'timeover' | 'roundEnd' | 'matchEnd';

export interface MatchSnap {
  frame: number;
  phase: MatchPhase;
  phaseFrame: number;
  round: number;
  timer: number; // seconds shown (ceil); -1 = infinite
  wins: [number, number];
  cinematic: { active: boolean; fighter: number; cueId: number; frame: number; frames: number };
  winner: number; // -1 undecided / drawn match
  draw: boolean;
  roundWinner: number; // -1 none, 0 | 1, 2 draw round
  slowmo: boolean;
  freeze: number;
  /** CHANGED(integrator): live projectiles for the view (§17.1 request; metres, vx in m/s, moveId per §17 rule 1,
   *  kind 0 projectile / 1 ball / 2 heckle object). Read-only copy; never part of the state or the checksum. */
  proj?: Array<{ slot: number; owner: number; x: number; y: number; vx: number; moveId: number; kind: number; alive: boolean; obj?: number;
    /** CHANGED(SIM3D): world z (m), vz (m/s), travel yaw (radians) */
    z?: number; vz?: number; yaw?: number }>;
  /** CHANGED(SIM3D) (CONTRACT §35.3): camera normal = float unit vector [x, z] in the ground plane; the view camera sits
   *  on +camN from the pair midpoint (the sim owns the basis, the view smooths it) */
  camN?: [number, number];
  /** CHANGED(SIM3D): the ring this match is fought in (metres / radians; constant per match) */
  ring?: RingSnap;
  /** CHANGED(SIM) P2 (CONTRACT §28.4): present in `brawl` / `heckler` matches */
  brawl?: BrawlSnap;
}

/** CHANGED(SIM3D) (CONTRACT §35.2 / §35.11): the ring boundary. circle: radius; poly: apothem (centre -> side), sides,
 *  rot = yaw (radians) of side 0's outward normal (circle: sector 0's centre); centre [x, z] (m). */
export interface RingSnap {
  shape: 'circle' | 'poly';
  radius: number;
  sides: number;
  rot: number;
  centre: [number, number];
}

/** §4.5 / §18.1 */
export interface SimEvent {
  frame: number;
  type: number;
  a: number;
  b: number;
  c: number;
  d: number;
}
