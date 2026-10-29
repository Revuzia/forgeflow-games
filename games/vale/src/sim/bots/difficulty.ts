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
// game a tier that `readsWaves` sends the nearest healthy laner to ANSWER a threatened road (a dive or a
// stacked wave at a structure, or a stacked wave deep in its half before it gets there) while the rest
// keep the plan — a lead is not thrown away to Wicks crashing into an empty road. Objectives
// are tiered too: how early the team gathers before a (public) spawn, whether it takes one at even numbers,
// and whether it contests an enemy start; a lead is never pressed over a live or imminent objective.
// W4 refix (G1/G3): a tier with `objectiveSense` (veteran) reads whether its team can take a camp now (team damage vs
// the camp's health), keeps one call and one siege target instead of walking between them, never leaves a threatened
// road for a camp, gives up on a camp that is not falling, and keeps fighters under 45 % health out of its sieges.

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
  /** team brain (W4 G1/G3 refix): reads whether the team can take an objective NOW — its fighters' damage against the
   *  camp's health — takes a long one (a camp the team needs more than 15 s for) only with a fighter more, never
   *  waits at its door while a road is under threat, and gives up on one that is not falling (60 s before it tries
   *  again); keeps fighters under 45 % health out of its sieges and objective calls */
  readonly objectiveSense: boolean;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  // (W4 G3 refix: novice is a beginner's opponent — slower to see, aim, last-hit and combo, and slower to act on the
  // team's calls — so a veteran's play shows in the result; still perception and execution only. Integ done:5: one
  // step further on the same knobs — later reactions, wider aim, more missed last hits, rarer dodges and kites, noisier
  // reads, slower combos, staying in a losing fight longer and answering the team's calls later — veteran beats it in
  // 39/40 and 38/40 mirrored games on soak seeds 1-20 / 21-40 (was 36 / 32), 150/160 over seeds 1-80 (was 129); no stat,
  // Gleam or rule changes, and no other suite plays novice)
  novice: {
    id: 'novice', reaction: 0.7, reactionJitter: 0.2, aimErrorDeg: 20, leadSkill: 0.15,
    lastHitSigma: 0.25, lastHitMiss: 0.45, dodgeChance: 0.05, kiteSkill: 0.05,
    intentFollow: 0.5, recallBias: -0.12, retreatBias: -0.12, knowsCooldowns: false,
    decisionNoise: 0.2, focusDiscipline: 0.1, abilityEvery: 0.85,
    macroDelay: 10, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 10, objectiveEven: 0, contests: false, objectiveSense: false,
  },
  adept: {
    id: 'adept', reaction: 0.25, reactionJitter: 0.07, aimErrorDeg: 6, leadSkill: 0.75,
    lastHitSigma: 0.05, lastHitMiss: 0.07, dodgeChance: 0.5, kiteSkill: 0.55,
    intentFollow: 0.85, recallBias: 0, retreatBias: 0, knowsCooldowns: false,
    decisionNoise: 0.06, focusDiscipline: 0.65, abilityEvery: 0.3,
    macroDelay: 2.5, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 30, objectiveEven: 0.55, contests: false, objectiveSense: false,
  },
  veteran: {
    id: 'veteran', reaction: 0.12, reactionJitter: 0.04, aimErrorDeg: 2.5, leadSkill: 0.95,
    lastHitSigma: 0.03, lastHitMiss: 0.03, dodgeChance: 0.85, kiteSkill: 0.9,
    intentFollow: 1, recallBias: 0.04, retreatBias: 0.03, knowsCooldowns: true,
    decisionNoise: 0.03, focusDiscipline: 1, abilityEvery: 0.2,
    macroDelay: 0, convertsLeads: true, leadGleam: 1500, readsWaves: true,
    objectiveLead: 50, objectiveEven: 0.68, contests: true, objectiveSense: true,
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
