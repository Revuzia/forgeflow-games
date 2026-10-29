// VALE bots — difficulty profiles (CONTRACT §5.7, research r09 §5.5).
//
// Difficulty is perception and execution, NEVER stats or gold: a profile only changes how fast a
// bot notices things (reaction delay, sampled per stimulus), how well it aims (aim error, lead),
// how cleanly it last-hits (timing noise, skipped opportunities), how often it dodges a perceived
// telegraph, how well it kites, and how well it decides (follows team intents, recalls on time,
// tracks enemy cooldowns). Every random draw comes from the bot's seeded stream.
//
// Macro (W4 gameplay G3): a tier is felt in the result, not only in the kill count. The team brain of
// a team reads its seats' tier (teamDifficulty): `macroDelay` is how long the team takes to act on a
// change — a won fight to cash in, a dive to answer — and `convertsLeads` whether it turns a lead into
// structures without waiting for a won fight: from a Gleam lead of `leadGleam` (public on the
// scoreboard) it groups and sieges while it is not short of bodies, and it walks a won fight on to the
// next structure while the fallen enemies' respawn clocks (public too) say there is time. From the mid
// game the brain sends the nearest fighter to ANSWER a threatened road (a dive or a stacked wave at a
// structure) while the rest keep the plan; a tier that `readsWaves` also meets a stacked wave deep in its
// half before it gets there — a lead is not thrown away to Wicks crashing into an empty road. Objectives
// are tiered too: how early the team gathers before a (public) spawn, whether it takes one at even numbers,
// and whether it contests an enemy start; a lead is never pressed over a live or imminent objective.

export type DifficultyId = 'novice' | 'adept' | 'veteran';

export interface DifficultyProfile {
  readonly id: DifficultyId;
  /** mean reaction delay in seconds for a new stimulus (enemy appears, telegraph, projectile) */
  readonly reaction: number;
  /** ± uniform jitter added to each sampled reaction */
  readonly reactionJitter: number;
  /** σ of the aim heading error in degrees (skillshots) */
  readonly aimErrorDeg: number;
  /** 0..1 weight of the intercept prediction vs the target's current position */
  readonly leadSkill: number;
  /** σ (s) of the timing error on a last-hit impact estimate */
  readonly lastHitSigma: number;
  /** chance a last-hit opportunity is simply missed */
  readonly lastHitMiss: number;
  /** chance a perceived telegraph / skillshot is dodged */
  readonly dodgeChance: number;
  /** 0..1 chance / quality of orb-walking away from melee chasers */
  readonly kiteSkill: number;
  /** chance a team intent (push / defend / objective / group) is followed */
  readonly intentFollow: number;
  /** added to the recall hp threshold (negative: recalls later) */
  readonly recallBias: number;
  /** added to the style's retreat hp threshold (negative: stays in fights too long) */
  readonly retreatBias: number;
  /** remembers enemy ability casts and counts them as spent */
  readonly knowsCooldowns: boolean;
  /** amplitude of the per-decision utility noise */
  readonly decisionNoise: number;
  /** 0..1 weight of team focus fire in target choice */
  readonly focusDiscipline: number;
  /** seconds between ability evaluations (lower = sharper combos) */
  readonly abilityEvery: number;
  /** team brain: seconds an opening (a won fight) or a threat (a dive) must hold before the team acts on it */
  readonly macroDelay: number;
  /** team brain: presses a lead (a Gleam lead of leadGleam or more) into structures, not only won fights */
  readonly convertsLeads: boolean;
  /** team brain: the Gleam lead (Σ goldEarned, team vs team) it presses */
  readonly leadGleam: number;
  /** team brain: sends someone to meet a stacked enemy wave deep in its half before it reaches a structure */
  readonly readsWaves: boolean;
  /** team brain: seconds before an objective camp's (public) spawn the team gathers at it */
  readonly objectiveLead: number;
  /** team brain: desire to take a live objective at EVEN numbers after the early game (0: only with a body more) */
  readonly objectiveEven: number;
  /** team brain: contests an objective the enemy is starting when it is not short of bodies */
  readonly contests: boolean;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  novice: {
    id: 'novice', reaction: 0.45, reactionJitter: 0.12, aimErrorDeg: 12, leadSkill: 0.35,
    lastHitSigma: 0.16, lastHitMiss: 0.3, dodgeChance: 0.15, kiteSkill: 0.15,
    intentFollow: 0.55, recallBias: -0.12, retreatBias: -0.08, knowsCooldowns: false,
    decisionNoise: 0.12, focusDiscipline: 0.25, abilityEvery: 0.5,
    macroDelay: 6, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 10, objectiveEven: 0, contests: false,
  },
  adept: {
    id: 'adept', reaction: 0.25, reactionJitter: 0.07, aimErrorDeg: 6, leadSkill: 0.75,
    lastHitSigma: 0.05, lastHitMiss: 0.07, dodgeChance: 0.5, kiteSkill: 0.55,
    intentFollow: 0.85, recallBias: 0, retreatBias: 0, knowsCooldowns: false,
    decisionNoise: 0.06, focusDiscipline: 0.65, abilityEvery: 0.3,
    macroDelay: 2.5, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 30, objectiveEven: 0.55, contests: false,
  },
  veteran: {
    id: 'veteran', reaction: 0.12, reactionJitter: 0.04, aimErrorDeg: 2.5, leadSkill: 0.95,
    lastHitSigma: 0.03, lastHitMiss: 0.03, dodgeChance: 0.85, kiteSkill: 0.9,
    intentFollow: 1, recallBias: 0.04, retreatBias: 0.03, knowsCooldowns: true,
    decisionNoise: 0.03, focusDiscipline: 1, abilityEvery: 0.2,
    macroDelay: 0, convertsLeads: true, leadGleam: 1500, readsWaves: true,
    objectiveLead: 50, objectiveEven: 0.68, contests: true,
  },
};

export function difficultyOf(id: string | undefined): DifficultyProfile {
  return id === 'novice' || id === 'adept' || id === 'veteran' ? DIFFICULTIES[id] : DIFFICULTIES.adept;
}

/** the tier a team brain plays at: its bot seats' most common tier (ties: the stronger), adept without bots */
export function teamDifficulty(seats: readonly { team: number; controller: string; botDifficulty?: string }[], team: number): DifficultyProfile {
  const n: Record<DifficultyId, number> = { novice: 0, adept: 0, veteran: 0 };
  for (const s of seats) if (s.team === team && s.controller === 'bot') n[difficultyOf(s.botDifficulty).id]++;
  let best: DifficultyId = 'adept', bn = 0;
  for (const id of ['novice', 'adept', 'veteran'] as const) if (n[id] >= bn && n[id] > 0) { best = id; bn = n[id]; }
  return DIFFICULTIES[best];
}
