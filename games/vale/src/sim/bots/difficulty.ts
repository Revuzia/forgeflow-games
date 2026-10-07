// VALE bots — difficulty profiles (CONTRACT §5.7, research r09 §5.5).
//
// Difficulty is perception and execution, NEVER stats or gold: a profile only changes how fast a
// bot notices things (reaction delay, sampled per stimulus), how well it aims (aim error, lead),
// how cleanly it last-hits (timing noise, skipped opportunities), how often it dodges a perceived
// telegraph, how well it kites, and how well it decides (follows team intents, recalls on time,
// tracks enemy cooldowns). Every random draw comes from the bot's seeded stream.

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
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  novice: {
    id: 'novice', reaction: 0.45, reactionJitter: 0.12, aimErrorDeg: 12, leadSkill: 0.35,
    lastHitSigma: 0.16, lastHitMiss: 0.3, dodgeChance: 0.15, kiteSkill: 0.15,
    intentFollow: 0.55, recallBias: -0.12, retreatBias: -0.08, knowsCooldowns: false,
    decisionNoise: 0.12, focusDiscipline: 0.25, abilityEvery: 0.5,
  },
  adept: {
    id: 'adept', reaction: 0.25, reactionJitter: 0.07, aimErrorDeg: 6, leadSkill: 0.75,
    lastHitSigma: 0.07, lastHitMiss: 0.1, dodgeChance: 0.5, kiteSkill: 0.55,
    intentFollow: 0.85, recallBias: 0, retreatBias: 0, knowsCooldowns: false,
    decisionNoise: 0.06, focusDiscipline: 0.65, abilityEvery: 0.3,
  },
  veteran: {
    id: 'veteran', reaction: 0.12, reactionJitter: 0.04, aimErrorDeg: 2.5, leadSkill: 0.95,
    lastHitSigma: 0.03, lastHitMiss: 0.03, dodgeChance: 0.85, kiteSkill: 0.9,
    intentFollow: 1, recallBias: 0.04, retreatBias: 0.03, knowsCooldowns: true,
    decisionNoise: 0.03, focusDiscipline: 1, abilityEvery: 0.2,
  },
};

export function difficultyOf(id: string | undefined): DifficultyProfile {
  return id === 'novice' || id === 'adept' || id === 'veteran' ? DIFFICULTIES[id] : DIFFICULTIES.adept;
}
