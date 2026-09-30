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
  /** optional projectile list (the view draws what is there; CONTRACT §17.1) */
  proj?: ReadonlyArray<ViewProjectile>;
}

export interface ViewProjectile { slot: number; owner: number; x: number; y: number; vx?: number; moveId?: number; alive?: boolean | number }

/** CONTRACT §4.1 MatchCfg, the fields the view reads. */
export interface ViewMatchCfg {
  mode: string;
  stage: string;
  p: ReadonlyArray<{ fighter: string; color: number }>;
}

/** CONTRACT §5.2 Move, the fields the view reads. */
export interface ViewMove {
  kind?: string;
  startup?: number; active?: number; recovery?: number;
  anim?: { clip: string; warp?: ReadonlyArray<ReadonlyArray<number>> };
  cinematic?: { frames: number; cue?: string };
  projectile?: { clip?: string; strength?: string };
  strength?: string;
}

/** CONTRACT §5.2 fighter file, the fields the view reads. `toon` is an optional VIEW-read override. */
export interface ViewFighterDef {
  id?: string;
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
export interface ViewClipFacts { dur: number; frames?: number; contact?: number | null; loop?: boolean }

/** CONTRACT §17 rule 2 anim table entry. */
export interface AnimRef { clip: string; warp: ReadonlyArray<ReadonlyArray<number>> | null; loop: boolean; moveId: number }

/** CONTRACT §16 GameData, the fields the view reads. */
export interface ViewGameData {
  fighters: Readonly<Record<string, ViewFighterDef>>;
  clips?: Readonly<Record<string, unknown>>;
  stages?: unknown;
  system?: unknown;
  anims?: Readonly<Record<string, ReadonlyArray<AnimRef>>>;
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
