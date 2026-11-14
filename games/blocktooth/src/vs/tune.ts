// BLOCKTOOTH VS — B-VS's own tunables that the VS block in core/config.ts (B-CORE's file) does not carry.
// Every one is a [proposal] for the VP pacing probe, same as the VS block. THREE-free, plain numbers.

export const VSX = {
  /** TTK tuning knob: every rival hit's kit % is multiplied by this before power x size edge x phase (vs_design.md §6.1 calls
   *  the kitPct numbers [proposal]s for a bot sweep to tune toward the ~15 s equal-size TTK). 1 = the design's numbers as written.
   *  MEASURED 2026-10-05 with B-QA's TTK gate (_harness/vs/probe_vs.ts --ttk-only: REGULAR native bots, geared, equal-size 1v1,
   *  4 Sizes x kit pairs x 3 seeds = 120 duels): x1 -> median 64 s (only 20/120 duels end at all); x2 -> 27 s with the old flee rule,
   *  19.1 s with botFleeDelayTicks; x2.2 -> 15.0 s (111/120 end; Size II / III / IV / V = 8.7 / 14.7 / 14.8 / 29.5 s). The design
   *  numbers assume every auto lands; real fights miss about half of them. The pure damage race (time to bring one titan to 50 %)
   *  is 5.3 s, so a 100 % kill is ~11 s when nobody flees: the rest of the median is the flee / chase of the REGULAR brain. */
  pvpMul: 2.2,
  /** the top rival must have dealt at least this fraction of the victim's max HP inside the credit window to be credited
   *  with the KO (below it the death is a PvE / ring death: no killer, no KO XP) */
  killMinFrac: 0.15,
  /** KO XP fades to 0 as the killer's level lead over the victim grows to this many levels (0 = off): no snowballing by farming. MEASURED 2026-10-05: 8 changed nothing (36 matches, 7:00 leader still won 75 %): the leader's runaway is tender XP + body size, not KO XP. Left OFF. */
  koGapZeroLv: 0,
  /** equal-level crown change needs an XP lead of this fraction of the holder's XP bar (no flicker) */
  crownXpMargin: 0.1,
  /** bot RIVAL layer: only rivals within this many body heights (of the larger of the two) are hunted; a fight already on is
   *  followed out to 1.6 x this. The rest of the map is food. */
  botPursueH: 14,
  /** bot RIVAL layer in FINAL NOTICE (no respawn): start a NEW fight only with an edge (HP lead >= 10 %, a bigger Size, or a
   *  crowned target); 0 = off. LAST CALL (the ring is tiny) is never cautious. */
  botFinalCaution: 1,
  /** bot RIVAL layer: ticks a bot keeps fighting after it first qualifies to flee (rookie / regular / veteran: slow to give up a
   *  fight / normal / quick); a decisive duel then ends before the loser can break away */
  botFleeDelayTicks: { rookie: 45, regular: 24, veteran: 9 },
  /** bot RIVAL layer: score weight of the FRONT PAGE crown holder as a target */
  botCrownWeight: 2.0,
  /** bot RIVAL layer: the FRONT PAGE crown holder is hunted from this many times further away (the bounty pulls everyone in) */
  botCrownPursueMul: 3,
  /** bot: seconds a bot waits after a rail offer slides up before it answers (rookie / regular / veteran) */
  botRailDelayS: { rookie: 4, regular: 2.5, veteran: 1.2 },
  /** bot: how close (in the victim's HP fraction) a rival counts as "hurt" / "almost dead" */
  botHurtFrac: 0.6, botFinishFrac: 0.35,
  /** bot: seconds a rival counts as "already fighting someone" after it last took a hit */
  botFightingS: 3,
};
