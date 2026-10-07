// VALE sim — mode rules registry (CONTRACT §5.5).
//
// One ModeRules per RulesParams.end.kind, chosen from the resolved rules (mode.rules ⊕
// queue.rules); code branches on the KIND, never on mode/queue ids. A ModeRules only decides
// scoring and the end: everything else (waves, structures, camps, economy) is driven by the same
// rules for every mode. Practice is a queue kind layered on top (modes/practice.ts).

import type { RulesParamsT } from '../../contracts/catalog.ts';
import type { Entity } from '../entity.ts';
import type { World } from '../world.ts';
import { coreRules } from './core.ts';
import { lastStandingRules } from './last_standing_or_score.ts';
import type { Outcome } from './match.ts';
import { scoreRules } from './score.ts';

export type EndKind = RulesParamsT['end']['kind'];

export interface ModeRules {
  readonly kind: EndKind;
  /** after seats spawned: lives, scores */
  init(w: World): void;
  /** hooks.death, after economy and unit systems ran for this death */
  onDeath(w: World, victim: Entity, killer: Entity | null): void;
  /** 'modes' phase while live: an Outcome ends the match */
  check(w: World): Outcome | null;
}

const RULES: Readonly<Record<EndKind, () => ModeRules>> = {
  core: coreRules,
  last_standing_or_score: lastStandingRules,
  score: scoreRules,
};

export function modeRulesFor(kind: EndKind): ModeRules {
  const make = RULES[kind];
  if (!make) throw new Error(`modes: no rules for end.kind '${kind}'`);
  return make();
}

/** free-for-all: more than two teams among the seats (Fray gives every seat its own team) */
export function isFfa(w: World): boolean {
  return new Set(w.setup.seats.map((s) => s.team)).size > 2;
}
