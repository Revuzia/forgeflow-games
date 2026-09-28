import sys
p = 'src/core/types.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:80]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""export type BossId = 'caisson4' | 'irongully' | 'parkade6';   // v2: parkade6 = GRID-EAST's boss (FEATURES_V2 §10)
export const BOSS_IDS: readonly BossId[] = ['caisson4', 'irongully', 'parkade6'];""",
"""/** The three city bosses (v2: parkade6 = GRID-EAST's boss, FEATURES_V2 §10). BIOMES[*].boss narrows to this. */
export type MainBossId = 'caisson4' | 'irongully' | 'parkade6';
/** The three gatekeepers (GATEKEEPERS.md §2). */
export type GateId = 'stencil1' | 'cordon2' | 'switchboard5';
/** GATEKEEPERS §7.2: gatekeepers run on the shared boss framework, in the w.boss slot. */
export type BossId = MainBossId | GateId;
/** BOSS_IDS keeps its meaning (the city bosses; goals, rematchOrder); its type narrows to MainBossId. */
export const BOSS_IDS: readonly MainBossId[] = ['caisson4', 'irongully', 'parkade6'];
export const GATE_IDS: readonly GateId[] = ['stencil1', 'cordon2', 'switchboard5'];
/** Slot = the Size the fight guards: 1..3 the gatekeeper for the Size 1..3 breach, 4 the city boss
 *  (the Size V finale), 0 none. GATE_OF_SLOT[s] for s 1..3. */
export type GateSlot = 0 | 1 | 2 | 3 | 4;
export const GATE_OF_SLOT: readonly (GateId | null)[] = [null, 'stencil1', 'cordon2', 'switchboard5', null];
export type BossRole = 'main' | 'gate';
/** true for the three gatekeeper ids (type guard). */
export function isGateId(id: string): id is GateId { return id === 'stencil1' || id === 'cordon2' || id === 'switchboard5'; }""")

rep("""  | 'carLob';                                                                 // v2 hostile: PARKADE-6's lobbed car (lob, circle tell like 'plate')
""", """  | 'carLob'                                                                  // v2 hostile: PARKADE-6's lobbed car (lob, circle tell like 'plate')
  | 'paintCan' | 'sawhorse' | 'callFlare';                                    // GATEKEEPERS §7.2: hostile lobs, circle/capsule tells
""")

rep("""export type HazardKind = 'wire' | 'magma' | 'bloom' | 'spore' | 'frost' | 'fire' | 'oil';""",
"""export type HazardKind = 'wire' | 'magma' | 'bloom' | 'spore' | 'frost' | 'fire' | 'oil'
  | 'paint';   // GATEKEEPERS §7.2: WET PAINT (slow only, owner 'boss')""")

rep("""  subtitle: string;
  data: Record<string, number>;
}

// ─────────────────────────────── upgrades""", """  subtitle: string;
  data: Record<string, number>;
  // ── GATEKEEPERS §7.2 (BossStateAddV3) ──
  role: BossRole;
  /** the Size this fight guards (1..4); 0 for a rematch in EXTENDED COVERAGE */
  slot: GateSlot;
}

// ─────────────────────────────── upgrades""")

rep("""  | { type: 'revive'; x: number; z: number };                                          // perk_stay_of_demolition revive
""", """  | { type: 'revive'; x: number; z: number }                                           // perk_stay_of_demolition revive
  // ── GATEKEEPERS §7.2 (SimEventAddV3). The city boss keeps 'bossSpawn' / 'bossDefeated'. ──
  | { type: 'gateLocked'; slot: GateSlot; capped: boolean }        // size held (SIZE LOCKED); slot 4 = the city boss is due
  | { type: 'gateSpawn'; gate: GateId; slot: GateSlot; rematch: boolean }
  | { type: 'gateDefeated'; gate: GateId; slot: GateSlot; x: number; z: number; fightS: number; rematch: boolean }
  | { type: 'gateEscalate'; level: 1 | 2 | 3 }
  | { type: 'gateReposition'; x: number; z: number }                // the gatekeeper cut the titan off
  | { type: 'gateRam'; x: number; z: number }                       // the stuck rule's RAMMING THROUGH (§3.0)
  | { type: 'finale'; on: boolean };                                // on: same tick as the city boss's kill + rankUp 4
""")

rep("""  | 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch';   // v2 (FEATURES_V2 §2.5)""",
"""  | 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch'    // v2 (FEATURES_V2 §2.5)
  | 'gate1' | 'gate2' | 'gate3' | 'gateEscalate' | 'gateRematch' | 'finale';   // GATEKEEPERS §6.6""")

rep("""  tally: RunTally;         // createTally()
  endless: EndlessState | null;   // null until continueEndless()
}""", """  tally: RunTally;         // createTally()
  endless: EndlessState | null;   // null until continueEndless()
  // ── GATEKEEPERS §7.2 (WorldAddV3) ──
  gates: GatesState;       // meta/gates.ts createGates()
}""")

rep("""  boss: BossId;
  /** enemy weight multipliers""", """  boss: MainBossId;
  /** enemy weight multipliers""")

rep("""  attacks: { id: string; name: string; subtitle: string; phase: 1 | 2 | 3 }[];
}""", """  attacks: { id: string; name: string; subtitle: string; phase: 1 | 2 | 3 }[];
  // ── GATEKEEPERS §7.2 (BossDefAddV3). Main bosses: role 'main', slot 4, kicker ''. ──
  role: BossRole;
  slot: GateSlot;
  /** small line above the nameplate name, e.g. 'GATEKEEPER · SIZE I HEIGHT LIMIT' ('' = none) */
  kicker: string;
}""")

rep("""  hookT: number;           // world.t of the last 'ability' event (-1 = none)
  hookPickups: number; hookKills: number;
}""", """  hookT: number;           // world.t of the last 'ability' event (-1 = none)
  hookPickups: number; hookKills: number;
  // ── GATEKEEPERS §7.2 (RunTallyAddV3; meta/tally.ts, event-derived; lane K1a fills the cases) ──
  gateKills: number;
  gateCleanKills: number;                              // gate kills with gateFightDmg === 0 at the kill
  gateTotalFightS: number;                             // Σ spawn→kill of slots 1..3 (Infinity until all three died)
  gateTippedFastS: number;                             // STENCIL-1: seconds from spawn to its first TIPPED OVER (Infinity)
  gateStallsBestFight: number;                         // CORDON-2: most STALLED in one fight
  gateSwitchFastS: number;                             // SWITCHBOARD-5: fastest spawn→kill (Infinity)
  gateRematches: number;                               // gatekeeper rematches won this run (EXTENDED COVERAGE)
  gateStaggersThisFight: number;                       // bookkeeping (reset on gateSpawn)
  gateFightDmg: number;                                // titan damage taken since the live gate fight spawned (reset on gateSpawn)
}""")

rep("""export type PerkId = 'perk_petty_cash' | 'perk_red_tape' | 'perk_warm_mic' | 'perk_safety_inspection' | 'perk_stay_of_demolition' | 'perk_tip_line';
export const PERK_IDS""", """export type PerkId = 'perk_petty_cash' | 'perk_red_tape' | 'perk_warm_mic' | 'perk_safety_inspection' | 'perk_stay_of_demolition' | 'perk_tip_line'
  | 'perk_deferred_maintenance';   // GATEKEEPERS §6.5 (lane K2c adds it to PERK_IDS with the goal that unlocks it)
/** The perks the select screen offers and probe_meta counts. K0 leaves perk_deferred_maintenance OUT (no goal unlocks it yet). */
export const PERK_IDS""")

rep("""  | 'props' | 'overloadSites' | 'tier4CollapseFrac' | 'bossKillsLife' | 'staggersBestFight' | 'boats' | 'fastClearS';""",
"""  | 'props' | 'overloadSites' | 'tier4CollapseFrac' | 'bossKillsLife' | 'staggersBestFight' | 'boats' | 'fastClearS'
  // GATEKEEPERS §6.5 (lane K2c fills goalProgress; K0 returns the neutral value)
  | 'gateTippedFastS' | 'gateStallsBestFight' | 'gateSwitchFastS' | 'gateCleanKills' | 'gateTotalFightS' | 'gateRematchesLife';""")

s = s.rstrip('\n') + """

// ═══════════════════════════════ GATEKEEPERS (§7.2 — merged by lane K0) ═══════════════════════════════
/** World.gates (meta/gates.ts). Deterministic, THREE-free. */
export interface GatesState {
  /** highest Size rank the titan may hold: 0 at the start; r after gate r's kill; 4 after the city boss's kill */
  unlocked: RankIndex;
  /** the breach the titan is waiting at (level ≥ RANK_LEVELS[slot] or the time cap, rank = slot − 1); 0 = none */
  pending: GateSlot;
  /** the fight alive right now (w.boss is it); 0 = none */
  active: GateSlot;
  capped: boolean;         // the pending lock came from the time cap (level below the gate level)
  lockT: number;           // world.t the pending lock began (-1)
  dueT: number;            // world.t the pending fight spawns (Infinity while nothing is pending)
  lastBreachT: number;     // world.t of the last gate breach (-1) — GATES.chainGapS
  spawnT: number[];        // index = slot 1..4 → spawn world.t (NaN until)
  killT: number[];         // index = slot 1..4 → kill world.t (NaN until)
  fightS: number;          // Σ seconds a gatekeeper or the city boss has been alive this run
  pressure: 0 | 1 | 2 | 3; // containment escalation of the live gate fight
  ignoredS: number;        // seconds since the titan last damaged the live gatekeeper
  engagedS: number;        // seconds of the live gate fight in which the titan damaged it within 5 s (fatigue clock)
  farS: number;            // seconds the titan has been farther than GATES.repositionRingMul × spawnRing
  dpsWin: number;          // titan damage to the gatekeeper in the current TUMBLING 1 s window (GATES.dpsCapFrac; damageBoss writes it)
  dpsWinT: number;         // start of that window (world.t); a hit at w.t >= dpsWinT + 1 starts a new window (dpsWin = 0)
  liveFightS: number;      // seconds since the live gate fight's intro ended (fatigue floor: clock = max(engagedS, 0.5 × liveFightS))
  lastAddHitT: number;     // world.t the titan last damaged one of the live gatekeeper's adds (-Infinity) — engagement rule (b)
  breachDue: GateSlot;     // set by defeat(); flushGateBreach() at the end of stepWorld runs the breach on that tick (0 = none)
  mainEarliestT: number;   // GATES.mainEarliestS (copied at createGates so a cheat/probe can move it)
  rematchN: [number, number, number];  // gatekeeper rematches defeated, by GATE_IDS index (EXTENDED COVERAGE)
  rematchSeq: number;      // alternation index of the EXTENDED COVERAGE rotation (even = gatekeeper, odd = city boss)
  finaleT: number;         // > 0: the Size V finale is running (s left)
  finaleDone: boolean;     // the finale ended → checkRunEnd clears the run
  mainKillT: number;       // world.t of the city boss's kill (-1) — becomes run.endT on clear
  topUpLevels: number;     // levels granted by time-cap top-ups this run (probe telemetry)
  rematchGates: number;    // gatekeeper rematches defeated in EXTENDED COVERAGE
}
"""
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok types.ts')
