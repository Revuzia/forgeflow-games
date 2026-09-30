// HIT PARADE - view-side structural types (lane VIEW, CONTRACT §4.6, §5.2, §6.3, §16, §17).
//
// The view reads other lanes' objects through these STRUCTURAL shapes: each lists only the fields the view touches,
// typed loosely enough that SIM's GameData / FighterSnap / MatchSnap / MatchCfg / SimEvent are assignable without an
// import. The view therefore compiles and runs its lab before (and independently of) the sim, and game.ts passes the
// real objects straight in. Snapshots are the ONLY thing the view reads from the sim (CONTRACT §4.6).

/** CONTRACT §4.5 / §18.1 - one sim event (ints). */
export interface ViewEvent { frame: number; type: number; a: number; b: number; c: number; d: number }

type Flag = boolean | number | undefined;

/** CONTRACT §4.6 FighterSnap (+ §19 SIM additions), the fields the view reads. */
export interface ViewFighterSnap {
  x: number; y: number; facing: number;
  moveId?: number;
  animId: number; animFrame: number; prevAnimId: number; prevAnimFrame: number; blendT: number;
  hitstop?: number;
  hp?: number; hpMax?: number;
  showtime?: number; nerve?: number; stageFright?: Flag;
  flags?: { invuln?: Flag; armor?: Flag; counter?: Flag; stance?: number | boolean; taunting?: Flag; ko?: Flag };
  airborne?: boolean; crouching?: boolean;
  moveName?: string; moveKind?: string;
  /** P2: frames into the current move (prop show / hide rules) */
  moveFrame?: number;
}

/** CONTRACT §4.6 MatchSnap (+ §19.7), the fields the view reads. */
export interface ViewMatchSnap {
  frame: number;
  phase?: number | string;
  round?: number;
  cinematic?: { active: boolean | number; fighter: number; cueId: number; frame: number; frames?: number };
  winner?: number;
  slowmo?: boolean | number;
  freeze?: boolean | number;
  /** optional projectile list (the view draws what is there; CONTRACT §17.1 / §24.10) */
  proj?: ReadonlyArray<ViewProjectile>;
  /** P2 BRAWL BREAK / HECKLER TOSS (CONTRACT §28.4 MatchSnap.brawl) */
  brawl?: { mode?: string; score?: number; goons?: ReadonlyArray<ViewGoon> };
}

/** kind 0 projectile, 1 ball, 2 heckle object (§24.10) */
export interface ViewProjectile { slot: number; owner: number; x: number; y: number; vx?: number; vy?: number; moveId?: number; kind?: number; alive?: boolean | number; obj?: number | string }

/** CONTRACT §28.4 GoonSnap: a BRAWL BREAK goon as the view reads it (every field but slot / x optional) */
export interface ViewGoon {
  slot: number; x: number; y?: number; facing?: number;
  /** goon body id ('goon_hardhat' ... = lane ASSETS' goon_* GLB) */
  kind?: number | string; kindIdx?: number;
  animId?: number; animFrame?: number; prevAnimId?: number; prevAnimFrame?: number; blendT?: number;
  /** a shared clip name when a pose is reported by name (lab) */
  clip?: string; clipFrame?: number;
  hp?: number; hpMax?: number; hitstop?: number; state?: number | string; stateName?: string; telegraph?: boolean; moveName?: string;
  /** §28.4: holds an attack token (walking in / winding up) */
  token?: boolean;
  alive?: boolean | number; down?: boolean | number;
}

/** CONTRACT §4.1 MatchCfg, the fields the view reads. */
export interface ViewMatchCfg {
  mode: string;
  stage: string;
  p: ReadonlyArray<{ fighter: string; color: number }>;
}

/** CONTRACT §5.2 Move, the fields the view reads. */
export interface ViewMove {
  kind?: string;
  name?: string;
  startup?: number; active?: number; recovery?: number;
  anim?: { clip: string; warp?: ReadonlyArray<ReadonlyArray<number>> };
  /** §5.2 + §20.2 extras (anim / victim / shots / fx timelines) - view/prime.ts reads them */
  cinematic?: {
    frames: number; cue?: string; hits?: ReadonlyArray<ReadonlyArray<number>>;
    anim?: ReadonlyArray<ReadonlyArray<number | string>>; victim?: ReadonlyArray<ReadonlyArray<number | string>>;
    shots?: ReadonlyArray<ReadonlyArray<number | string>>; fx?: ReadonlyArray<ReadonlyArray<number | string>>;
    ratings?: number | ReadonlyArray<number>; endGapM?: number;
  };
  projectile?: { clip?: string; strength?: string; speed?: number; life?: number; box?: ReadonlyArray<number>; y?: number; ground?: boolean; vy?: number; g?: number; hits?: number };
  strength?: string;
}

/** CONTRACT §5.2 fighter file, the fields the view reads. `toon` is an optional VIEW-read override. */
export interface ViewFighterDef {
  id?: string;
  name?: string;
  body?: string;
  heightM?: number;
  colors?: ReadonlyArray<{ name?: string; tint?: string | null }>;
  moves: Readonly<Record<string, ViewMove>>;
  intro?: string;
  win?: ReadonlyArray<string>;
  taunt?: string;
  toon?: { profile?: string; detailBias?: number; saturation?: number; value?: number; rim?: number };
}

/** CONTRACT §6.3 per-clip facts (clips.json); the view needs dur and loop. */
export interface ViewClipFacts { dur: number; frames?: number; contact?: number | null; loop?: boolean; marks?: Record<string, number>; apexY?: number | null }

/** CONTRACT §17 rule 2 anim table entry. */
export interface AnimRef { clip: string; warp: ReadonlyArray<ReadonlyArray<number>> | null; loop: boolean; moveId: number }

/** CONTRACT §16 GameData, the fields the view reads. */
export interface ViewGameData {
  fighters: Readonly<Record<string, ViewFighterDef>>;
  clips?: Readonly<Record<string, unknown>>;
  stages?: unknown;
  system?: unknown;
  anims?: Readonly<Record<string, ReadonlyArray<AnimRef>>>;
  /** data/strings.json (the slate reads `hud.combo.prime`) */
  strings?: Readonly<Record<string, string>>;
  /** §28.4 goon anim tables per goon id (34 shared + the goon moves) */
  goonAnims?: Readonly<Record<string, ReadonlyArray<AnimRef>>>;
}

/** CONTRACT §17.1 view settings (SHELL maps the player settings onto it, §18.7). Every field optional. */
export interface ViewSettings {
  splatter?: 'splatter' | 'sparks' | 'confetti';
  screenShake?: number;
  reduceFlashing?: boolean;
  cinematicCamera?: 'full' | 'short';
  bloom?: boolean;
}

export const DEFAULT_VIEW_SETTINGS: Required<ViewSettings> = {
  splatter: 'splatter', screenShake: 1, reduceFlashing: false, cinematicCamera: 'full', bloom: false,
};

export function flagOn(v: Flag | number | boolean | undefined): boolean {
  return v === true || (typeof v === 'number' && v !== 0);
}
