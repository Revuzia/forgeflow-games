// GENESIS — the god layer's hooks into the peoples' decisions (CONTRACT.md §11.1): a POSSESSED person does what the
// player orders (god/possess.ts), a DISCIPLE carries its god's will before its own wants (god/disciples.ts), and a
// person held by the hand or flying through the air makes no decisions until set down (god/hand.ts). The god layer
// fills these in at load; the peoples code never imports the god layer (no import cycle).

import type { PCtx } from './ctx.ts';
import type { TaskSpec } from './tasks.ts';
import type { Settlement } from './state.ts';

export const godHooks: {
  /** the next order of a possessed agent (null: stand and wait) */
  possessed: ((x: PCtx, s: number) => TaskSpec | null) | null;
  /** a disciple's task by its standing order (null: live as usual this turn) */
  disciple: ((x: PCtx, s: number, st: Settlement | undefined, night: boolean) => TaskSpec | null) | null;
  /** is this agent in the god's hand or in flight (no decisions) */
  held: ((x: PCtx, s: number) => boolean) | null;
  /**
   * additive (SIM phase 4, space/ships.ts): the task of an agent enlisted for a ship (mission id −ship id: building,
   * fuelling or crewing it at the pad); null lets it live as usual this turn
   */
  crew: ((x: PCtx, s: number, st: Settlement | undefined) => TaskSpec | null) | null;
  /**
   * additive (LIVING RELATIONSHIP, god/relationship.ts): the people and their god in a settled agent's decision — prayer
   * from faith and hardship (U is decide.ts's utility table, C its candidate indices: adjusted in place), shelter from a
   * storm, an evacuation, evening worship, a pilgrimage, a prophet's preaching. A task returned is started at once.
   */
  relation: ((x: PCtx, s: number, st: Settlement, U: Float64Array, C: Readonly<Record<string, number>>, night: boolean) => TaskSpec | null) | null;
  /** additive (LIVING RELATIONSHIP): the worship a finished prayer / worship / sermon yields (null: the old rule) */
  worship: ((x: PCtx, s: number, st: Settlement, kind: number) => number) | null;
  /** additive (LIVING RELATIONSHIP): a settlement raises a temple only where faith and loyalty hold (else a shrine) */
  templeWanted: ((x: PCtx, st: Settlement) => boolean) | null;
  /**
   * additive (LIVING RELATIONSHIP, god/wrath.ts): the scale on harm done now by the people code's own area harm (an
   * impact's blast, people.ts harmArea / damageArea) — L lethality, R reach, B on buildings — inside a god's act sent with a wrath; null
   * outside one (nature's harm, its own law alone)
   */
  harmScale: (() => { L: number; R: number; B: number } | null) | null;
  /** additive (LIVING RELATIONSHIP, god/regard.ts): a person of settlement sid was killed by the act in progress */
  noteDeath: ((planet: number, sid: number) => void) | null;
} = { possessed: null, disciple: null, held: null, crew: null, relation: null, worship: null, templeWanted: null, harmScale: null, noteDeath: null };
