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
  /** RIFT's own values of the next few (CW3s r2-bots: RIFT's laning was tuned on them; BRIDGE keeps the bots its G5 pace was measured with: 16.0 min, 14.3 with these). Absent = the general value */
  readonly riftLastHitMiss?: number;
  readonly riftDodgeChance?: number;
  readonly riftShotPatience?: number;
  /** RIFT laning phase (CW3s r2 refix, CL-1: a skilled tier's commits): replaces retreatBias and recallBias on a road */
  readonly riftRetreatBias?: number;
  readonly riftRecallBias?: number;
  /** RIFT laning phase: burst over health at which a target counts as a kill (absent: 0.9) */
  readonly riftKillRead?: number;
  /** RIFT: trade edge against a lane opponent that has not answered a blow (absent: 0.55) */
  readonly riftPassivePress?: number;
  /** chance a perceived telegraph / skillshot is dodged */
  readonly dodgeChance: number;
  /** 0..1 (CW3s refix): how much a far skillshot at a free, moving target that could walk out of it is held back
   *  (0: fires whenever it reaches; 1: waits for a held, committed or nearer target) */
  readonly shotPatience: number;
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
  // ── lane AI (2026-11-15, owner: "defend their base, sneak attack, defend their partners"; owner_rulings 40) ──
  // Every field below is a decision knob, never a stat: how many fighters a threatened structure gets, whether a
  // defender recalls to it, how often a fighter peels for a partner, how long a ganker lurks, how much a fighter fears
  // enemies it cannot see, whether CC is chained, whether the team splits a pusher off and trades objectives cross-map.
  /** structure defence: defenders sent = ceil((enemy fighters there + 1 at an inner / base structure) × defendMatch) */
  readonly defendMatch: number;
  /** structure defence: recalls to a threatened structure when that is faster than walking ('none', 'base' = base
   *  structures only, 'inner' = inner and base) */
  readonly recallDefend: 'none' | 'base' | 'inner';
  /** structure defence: seconds a defender keeps its post after the threat has cleared */
  readonly defendHold: number;
  /** peel: chance (rolled once per episode) that a fighter near a partner being dived or held turns to protect it */
  readonly peelChance: number;
  /** peel: a frontline or warden steps between the partner and the diver */
  readonly peelBodyBlock: boolean;
  /** playing from ahead (RIFT, after the laning phase): with the team 2,000 Gleam or more ahead a fighter leaves a fight
   *  this much health sooner — a lead is kept by not dying, not spent on a coin-flip under a tower */
  readonly aheadCaution: number;
  /** peel in the laning phase: a road partner hit hard (not held) is a dive only below this share of its health — above it
   *  the duo's trade is laning */
  readonly peelLaneHp: number;
  /** ganks: the longest wait (s) in a thicket for the target to step into reach (0: walks straight in) */
  readonly lurkMax: number;
  /** ganks: the approach avoids the enemy's known lamps and the open river */
  readonly avoidVision: boolean;
  /** team fights: a burst or diver fighter with an escape flanks from the side and goes in after the frontline */
  readonly flank: boolean;
  /** fog risk (Σ weighted enemies unseen 6–40 s that could be near) at which a fighter stops pushing deep alone */
  readonly riskCap: number;
  /** leaves a fight early when the visible enemies' burst would take most of its health */
  readonly burstRetreat: boolean;
  /** mid and late game: one fighter with an escape split-pushes the road opposite the siege */
  readonly splitPush: boolean;
  /** group calls are followed at least this often (the intentFollow roll only delays the arrival) */
  readonly groupFollowFloor: number;
  /** objectives: lamps go round the pit before it spawns, and enemy lamps there are cleared */
  readonly visionSetup: boolean;
  /** objectives: the long objective (time to kill over 15 s) is taken at even numbers up to this time to kill (s, 0: never) */
  readonly longshadeTtk: number;
  /** objectives: an enemy objective the team cannot contest is traded for a structure across the map */
  readonly crossTrade: boolean;
  /** objectives: desire at even numbers after 12:00 for a tier with objectiveEven 0 (a beginner's macro) */
  readonly objectiveEvenLate: number;
  /** chance a hard CC is held for the moment a partner's CC on the same target is about to end (chains) */
  readonly ccChain: number;
  /** CC goes on the enemy doing the most damage to the team, not on whatever the fighter is hitting */
  readonly threatCc: boolean;
  /** the build re-reads the match on every shop visit: the fed enemy, the damage mix taken, being behind */
  readonly adaptiveBuild: boolean;
  /** FRAY: waits outside a fight between two others and enters when one is low (chance per fight) */
  readonly thirdParty: number;
  // ── lane AI round 2 (owner_rulings 44) ──
  /** an enemy fighter seen alone in the team's own half of the Dialwood is hunted by up to this many fighters (0: never) */
  readonly punishInvade: number;
  /** ... from this match time (s), once it has been in sight this long (s) */
  readonly punishFrom: number;
  readonly punishDelay: number;
  /** peel: the dived partner is followed under the enemy's tower ('none'; 'low': only a partner under 40 %; 'all': a fit
   *  frontline or support for any partner, as ruling 42) */
  readonly peelDive: 'none' | 'low' | 'all';
  /** a posted or answering defender holds its structure against the stacked wave (ruling 42; a beginner backs off it; adept
   *  too since ruling 55 — its holds kept adept games 3 min longer than the pre-lane bots', p90 34-40 against the 32 bar;
   *  veteran too since ruling 55 — its wave-only posts walked fit defenders up to inner Needles that the stacked wave took
   *  anyway: falls to Wicks beside fit defenders 1.03 → 0.83 a game, the pre-lane bots 0.86) */
  readonly holdWave: boolean;
  /** FRAY: under this share of health with a foe within 10 m and no kill on, a fighter breaks off (toward a heal if one is
   *  near), whether or not it is being hit right now (0: only the old retreat) */
  readonly frayBreak: number;
  /** the core under fighter attack (the Hourbell or a Bell Needle) calls every fit fighter that can be there in time (false: the
   *  count rule, defendMatch × divers) */
  readonly coreAll: boolean;
  /** peel: the designated peeler of a dived partner (the support within 8 m, else the nearest teammate within 12 m) always
   *  answers, whatever peelChance rolls (false: peelChance only) */
  readonly peelFirst: boolean;
  /** a lone enemy fighter on a road in our half, out of its towers' cover, is collapsed on like an invader (from 14:00) */
  readonly collapseRoads: boolean;
  /** closing: ahead with the enemy core open (its middle Lantern down), the team groups and ends — no staging wait */
  readonly closeOut: boolean;
  // ── lane AI round 3 (ruling 55) ──
  /** FRAY: a chase that has not closed on its target for this long (s), out of reach and with no gap-closer ready, is given
   *  up and the target left alone for 6 s (Infinity: never) */
  readonly chaseQuit: number;
  // ── ruling 55 ──
  /** structure defence reads a threat before the structure is hit — enemy fighters beside it, a push coming at the road's
   *  front (a beginner answers only a structure being hit) */
  readonly anticipates: boolean;
  /** RIFT walking plans (ruling 58; ruling 60: 12 s at every tier, veteran's 20 s cost ~0.8 min a game): a calm full-health walk turns back at most once in this many seconds (a fight, a
   *  threat, a rush or a target at hand turns at once) */
  readonly turnLatch: number;
  // ── ruling 60 ──
  /** RIFT structure posts (lane AI G1, rulings 40-55): a threatened own structure gets named defenders. Off at every tier by
   *  ruling 62 (the round-1 package's pace cost: RIFT +1.2 / +2.0 / +2.3 min, 14 and 12 games in 64 reaching 30:00 at adept and
   *  veteran, the posts at every structure class at once); back by ruling 65 at adept (base structures) and veteran (inner and
   *  base) under its pace rule (+1.5 min, no more 30:00 games than the old live opponents); with posts on, the base answer
   *  (thinkBaseAnswer) is the posts' own call */
  readonly guardPosts: boolean;
  // ── ruling 64 ──
  /** RIFT base answer (team.ts thinkBaseAnswer): a base structure (a Lantern, a Bell Needle, the Hourbell) taking enemy
   *  fighters' blows gets the nearest fit fighters within 80 m, as many as hit it (one more at the core), this many seconds
   *  after the hits start; released 1.5 s after the hits stop (Infinity: off). Novice reads it late, 5 s, and not in the
   *  closing game: every earlier or later novice answer measured cost pace */
  readonly baseAnswerDelay: number;
  /** ... and not from this game time on (s; Infinity: always) */
  readonly baseAnswerUntil: number;
  /** ruling 65: the shallowest structure class a post goes to when guardPosts is on (2: base structures only, 1: inner too) */
  readonly guardFrom: 0 | 1 | 2;
  /** ruling 65, pings: seconds between one fighter's pings, pings a team may send in any 10 s, and whether the tier reads
   *  the field well enough to warn (danger) and call a missing road opponent (missing) */
  readonly pingGap: number;
  readonly pingTeam: number;
  readonly pingReads: boolean;
  /** ruling 65: a teammate's assist ping is answered by fit fighters within this many metres (0: never) and at most this many */
  readonly assistReach: number;
  readonly assistMax: number;
  /** ruling 65, play as a team: a road two (or this many) of ours have committed to — at an enemy structure — is joined by the
   *  free fit rest (Infinity: never) */
  readonly joinAt: number;
  /** ruling 65: a group siege waits at its group point up to this many seconds for the teammates still walking in, so they
   *  arrive together (0: no wait) */
  readonly regroupWait: number;
  /** ruling 65: a calm walk stops short of this many enemy fighters in sight together with no teammate beside them (Infinity: off) */
  readonly loneStop: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  // (W4 G3 refix: novice is a beginner's opponent — slower to see, aim, last-hit and combo, and slower to act on the
  // team's calls — so a veteran's play shows in the result; still perception and execution only. Integ done:5: one
  // step further on the same knobs — later reactions, wider aim, more missed last hits, rarer dodges and kites, noisier
  // reads, slower combos, staying in a losing fight longer and answering the team's calls later — veteran beats it in
  // 39/40 and 38/40 mirrored games on soak seeds 1-20 / 21-40 (was 36 / 32), 150/160 over seeds 1-80 (was 129); no stat,
  // Gleam or rule changes, and no other suite plays novice. CW3 gameplay CL-g3: on untuned windows with independent
  // lineups veteran won only 32/40 (seeds 601-620, --lineup shuffle); the macro and intent gap widens again: the team's
  // calls are followed less often (0.4, was 0.5) and an opening or a dive must hold 15 s (was 10). CW3s refix (done:3, fresh
  // seeds 901-920: 33/40): calls followed 0.3, an opening must hold 22 s, dodges 0.02, skillshot lead 0.05, aim 22 deg; refix 2 (still 33/40):
  // reactions 0.85 s, no kiting, focus 0.05, an ability every 1.0 s; r2 refix (33/40 on seeds 3301-3320): a beginner misreads kills and passive laners (read 1.05, press 0.3), an ability every 1.3 s, and takes the early objective only with a fighter more (team.ts)
  novice: {
    id: 'novice', reaction: 0.85, reactionJitter: 0.25, aimErrorDeg: 22, leadSkill: 0.05,
    lastHitSigma: 0.25, lastHitMiss: 0.45, riftKillRead: 1.05, riftPassivePress: 0.3, dodgeChance: 0.02, kiteSkill: 0, shotPatience: 0,
    intentFollow: 0.3, recallBias: -0.12, retreatBias: -0.12, knowsCooldowns: false,
    decisionNoise: 0.2, focusDiscipline: 0.05, abilityEvery: 1.3,
    macroDelay: 22, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 10, objectiveEven: 0, contests: false, objectiveSense: false,
    defendMatch: 0.5, recallDefend: 'none', defendHold: 4, peelChance: 0.3, peelBodyBlock: false, peelLaneHp: 0.5, aheadCaution: 0, lurkMax: 0, avoidVision: false,
    flank: false, riskCap: Infinity, burstRetreat: false, splitPush: false, groupFollowFloor: 0, visionSetup: false,
    longshadeTtk: 0, crossTrade: false, objectiveEvenLate: 0.35, ccChain: 0, threatCc: false, adaptiveBuild: false, thirdParty: 0,
    punishInvade: 0, punishFrom: Infinity, punishDelay: 99, peelDive: 'none', holdWave: false, frayBreak: 0,
    coreAll: false, peelFirst: false, collapseRoads: false, closeOut: false, chaseQuit: Infinity, anticipates: false, turnLatch: 12, guardPosts: false,
    baseAnswerDelay: 5, baseAnswerUntil: 1500,
    guardFrom: 2, pingGap: 15, pingTeam: 2, pingReads: false, assistReach: 30, assistMax: 1, joinAt: 3, regroupWait: 0, loneStop: 4,
  },
  // (CW3s r3, CL-1: adept's longest quiet stretch fell at 3:00-12:00 with the laners 9 m apart at 75 % health; deaths a minute run under veteran's from 5:00 to 13:00. It now contests an enemy start at a camp, the fight veteran's team takes there, and reads a kill as veteran does. A flat +0.08 on the trade edge was tried and dropped: stretch 3.2 min, takedowns by 10:00 7.15 -> 6.70. team.ts thinkGank and bot.ts's roam read widen for every tier: gaps at 8:00-12:00. Laning retreat bias -0.04: takedowns by 10:00 5.95 -> 6.50 on seeds 8101-8120. Untuned seeds 8501-8520 / 8701-8720: stretch 2.7 / 2.8 min, was 3.4 / 3.6)
  adept: {
    id: 'adept', reaction: 0.25, reactionJitter: 0.07, aimErrorDeg: 6, leadSkill: 0.75,
    lastHitSigma: 0.05, lastHitMiss: 0.07, riftLastHitMiss: 0.04, riftRetreatBias: -0.04, riftKillRead: 0.8, riftPassivePress: 0.8, dodgeChance: 0.5, kiteSkill: 0.55, shotPatience: 0,
    intentFollow: 0.85, recallBias: 0, retreatBias: 0, knowsCooldowns: false,
    decisionNoise: 0.06, focusDiscipline: 0.65, abilityEvery: 0.3,
    macroDelay: 2.5, convertsLeads: false, leadGleam: Infinity, readsWaves: false,
    objectiveLead: 30, objectiveEven: 0.55, contests: true, objectiveSense: false,
    defendMatch: 1, recallDefend: 'base', defendHold: 6, peelChance: 0.7, peelBodyBlock: true, peelLaneHp: 0.5, aheadCaution: 0.08, lurkMax: 4, avoidVision: false,
    flank: false, riskCap: 1.5, burstRetreat: true, splitPush: false, groupFollowFloor: 0.9, visionSetup: true,
    longshadeTtk: 45, crossTrade: false, objectiveEvenLate: 0, ccChain: 0.5, threatCc: false, adaptiveBuild: true, thirdParty: 0.6,
    punishInvade: 1, punishFrom: 300, punishDelay: 4, peelDive: 'low', holdWave: false, frayBreak: 0.2,
    coreAll: true, peelFirst: true, collapseRoads: false, closeOut: true, chaseQuit: 1.8, anticipates: true, turnLatch: 12, guardPosts: true,
    baseAnswerDelay: 1, baseAnswerUntil: Infinity,
    guardFrom: 2, pingGap: 10, pingTeam: 3, pingReads: true, assistReach: 45, assistMax: 2, joinAt: 2, regroupWait: 8, loneStop: 3,
  },
  veteran: {
    id: 'veteran', reaction: 0.12, reactionJitter: 0.04, aimErrorDeg: 2.5, leadSkill: 0.95,
    lastHitSigma: 0.03, lastHitMiss: 0.03, riftLastHitMiss: 0.02, dodgeChance: 0.85, kiteSkill: 0.9, shotPatience: 1, riftShotPatience: 0.6,
    intentFollow: 1, recallBias: 0.04, retreatBias: 0.03, riftRetreatBias: -0.02, riftRecallBias: 0, riftKillRead: 0.8, riftPassivePress: 0.8, knowsCooldowns: true,
    decisionNoise: 0.03, focusDiscipline: 1, abilityEvery: 0.2,
    macroDelay: 0, convertsLeads: true, leadGleam: 1500, readsWaves: true,
    objectiveLead: 50, objectiveEven: 0.68, contests: true, objectiveSense: true,
    defendMatch: 1, recallDefend: 'inner', defendHold: 6, peelChance: 1, peelBodyBlock: true, peelLaneHp: 0.65, aheadCaution: 0.05, lurkMax: 8, avoidVision: true,
    flank: true, riskCap: 1.5, burstRetreat: true, splitPush: true, groupFollowFloor: 1, visionSetup: true,
    longshadeTtk: 45, crossTrade: true, objectiveEvenLate: 0, ccChain: 1, threatCc: true, adaptiveBuild: true, thirdParty: 1,
    punishInvade: 2, punishFrom: 180, punishDelay: 1.5, peelDive: 'all', holdWave: false, frayBreak: 0.25,
    coreAll: true, peelFirst: true, collapseRoads: true, closeOut: true, chaseQuit: 1.2, anticipates: true, turnLatch: 12, guardPosts: true,
    baseAnswerDelay: 1, baseAnswerUntil: Infinity,
    guardFrom: 1, pingGap: 10, pingTeam: 3, pingReads: true, assistReach: 55, assistMax: 2, joinAt: 2, regroupWait: 10, loneStop: 3,
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
