/**
 * BLACKRIDGE personas — R29 union (combat_spec §8.2 + harness_plan §2.5).
 *
 * Data only, no I/O. Injected by playprobe.py as a classic script (exports
 * stripped), same regex as shots.js. The actual DRIVING lives in
 * core/test/autoplay.js (in-page, REAL KeyboardEvent/MouseEvent dispatch —
 * doctrine §5); each persona here names the autoplay profile it runs and the
 * pass bars playprobe asserts. `optimal` = Tactician and inherits Tactician's
 * bars verbatim (R29).
 *
 * Bars are Part 5.4 FROZEN wording transcribed to numbers. Rates are over
 * the seed battery actually run; combat_spec's official battery is 20 seeds
 * per persona — playprobe defaults to the shared 3-seed smoke list and
 * `--seeds` scales it up for the real gate.
 */

// The playprobe battery runs every persona over the SAME seed list so a
// combat change is measured on identical matches (harness_plan §5).
export const SEEDS = [11, 23, 47];

export const PERSONAS = {
  rusher: {
    profile: "rusher",
    seedOffset: 0,
    desc: "tac-sprint at nearest bot, hip fire inside 15 m, never reloads until empty",
    bars: {
      // Part 5.4: clears beat 1 on Regular >= 50%; full mission >= 25%.
      // Beat-1 clear is not separately observable from outside yet — the
      // full-mission rate is asserted; beat-level rates come with a mission
      // beat counter (needsElsewhere A1: expose current beat in sim.state).
      fullMissionWinRate: 0.25,
      // dies to flanks/tokens, NOT sub-band reactions: every death must
      // trace to a bot shot fired >= reaction-min after confirm (A5's
      // fairness probe owns the trace; playprobe asserts death VARIETY)
      diesToDistinctArchetypes: 2, // across the seed battery
    },
  },
  optimal: {
    profile: "optimal",
    seedOffset: 100,
    desc: "Tactician: cover-to-cover, ADS bursts 3-5, relocates, frags clusters, retreats <40 hp",
    bars: {
      fullMissionWinRate: 0.70,   // Regular-mix (the shipped authored mix)
      endBeatHpMedian: 50,
      beatsNoviceEverySeed: true, // skill is real: optimal > novice per seed
    },
  },
  novice: {
    profile: "novice",
    seedOffset: 200,
    desc: "400-500 ms delayed inputs, walks, wide aim jitter, forgets to reload",
    bars: {
      fullMissionWinRate: 0.40,   // Recruit-mix bar (authored mix is harder; report-only until difficulty selector exists — R30)
      medianDeathsPerRun: 4,      // <= 4 (checkpoint respawns)
      survivesSeconds: 60,        // survives >= 60 s median (fairness floor)
    },
  },
  camper: {
    profile: "camper",
    seedOffset: 300,
    desc: "holds one position, fires only on LOS — the anti-passivity probe",
    bars: {
      neverWinsPassively: true,   // camper must not win by standing still
      botsDislodge: true,         // bots flank/press: damageTaken > 0 within the timer
      stuckBotSeconds: 0,
      everyMatchEnds: true,       // phase reaches won/lost OR the engagement referee kept cycling
    },
  },
};

// Fairness-feel bar (Part 5.4, persona-independent): median time from FIRST
// bot damage on the player to player death when caught in the open —
// >= 1.2 s on Regular, >= 0.7 s on Veteran. playprobe measures it from
// autoplay's playerDeaths[] + timeToFirstContact on the rusher battery.
export const FAIRNESS_FEEL = { minOpenDeathSecondsRegular: 1.2, minOpenDeathSecondsVeteran: 0.7 };

// Parity assertions (the honest-HUD checks, Part 5.4 verbatim). Read side:
// sim counters via __test.counters(); HUD side via hud.counts() when A10
// lands it (needsElsewhere), killfeed rows via DOM as fallback.
export const PARITY = [
  { name: "hitmarkers", sim: "shotsHit", hud: "hitmarkers" },
  { name: "ammo", sim: "ammoAfterReload", hud: "ammoShown" },
  { name: "killfeed", sim: "killsPlusDeaths", hud: "killfeedRows" },
];
