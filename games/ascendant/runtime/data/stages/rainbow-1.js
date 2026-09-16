/**
 * ASCENDANT — PRISM CROWN 1 : "FIRST LIGHT"
 * runtime/data/stages/rainbow-1.js
 *
 * The bridge the storm left behind. World 5's opening stage holds temple-3's
 * mechanical ceiling while resetting cognitive load: both new light traps —
 * PRISM GATE ("the window is the door") and COLOUR BLOOM ("jump the LOW ring,
 * duck the HIGH one") — are taught in strict isolation on all-phase-safe
 * staging decks before they are ever combined (brief §7 rainbow-1, verbatim).
 *
 * SHAPE      Measured by `node _harness/reachcheck.mjs rainbow-1`, not estimated:
 *            302.4 m of travel, 69 gameplay objects, 60 landable surfaces,
 *            0 orphans, 9 checkpoints (cp0..cp8), 3 coins, 34 dynamic hazards
 *            across 8 families:
 *
 *              prismgate 9 · bloom 5 · vanish 6 · mover 5 · ice 4 · wind 2 ·
 *              laser 2 · jumppad 1
 *
 *            NOTE vs brief §7 mix table: the table says "prismgate 5", but the
 *            binding movement text mandates 2 (I) + 3 (III: sight-read gate,
 *            mover-thread gate, vanish-under gate) + 1 (IV slots:'y') + 3
 *            (V relay set piece) = 9. The movements win; the "~30 dynamic"
 *            headline still holds (34).
 *
 *            Five movements (brief §7):
 *
 *   I    THE OPAL CAUSEWAY    x   0 –  58   warm-up jumps, two teaching gates
 *   II   THE BLOOM GARDEN     x  58 – 128   LOW blooms: alone, on ice, paired
 *   III  SPLIT LANES          x 128 – 200   three lanes, three gates, pause island
 *   IV   THE LANDING          x 200 – 250   breather, HIGH bloom teach, wind shaft
 *   V    THE REFRACTION HALL  x 250 – 305   3-gate relay on ONE clock, then out
 *
 * CHECKPOINT CLOCKS: every checkpoint pins a rising clockOffset — 0 / 6 / 13 /
 *   21 / 30 / 40 / 51 / 63 / 76 (brief table, verbatim) — so a respawn is a
 *   rerun of the same light show, never a new lottery (contract law 4). Every
 *   checkpoint is PRE-spike and outside every bloom's rmax circle and every
 *   gate's lattice plane (margins quoted at each cp below).
 *
 * PRISM GATE LAW (§4, enforced by hazards/index.js SEMANTIC — quoted here so
 *   the numbers below read as decisions, not accidents):
 *   period == seq.length * (dwell + travel) to 1e-6; window >= 1.6 x 2.2;
 *   worst cyclic slot pitch / travel <= 6.4 m/s (< run 8.6 — always chaseable);
 *   s[0] <= 0.5. Sill of a slots:'z' gate IS its deck: p.y = deckTop + s[1]/2.
 *   Every gate here has an all-phase-safe staging deck BEFORE its plane plus a
 *   flank ledge OUTSIDE its lattice span (contract law 2 house language).
 *   OWNER'S CALL 2026-09-16: every gate walk-around ledge REMOVED, all three
 *   stages. "I especially love your jumping through laser fields - remove the
 *   platform to go around, makes it too easy." The gates are mandatory now;
 *   the all-phase-safe staging decks BEFORE each plane remain (law 2 is about
 *   reading the hazard, not skipping it). Coin V moved onto the relay line.
 *
 * COLOUR BLOOM LAW (§5): band = hue = speed (SPEED_BY_BAND: red/orange 6.0,
 *   yellow/green 4.2, blue+ 3.0 m/s). All five emitters here are band 4 BLUE,
 *   3.0 m/s — the slowest class, this is the teaching stage. period >= life +
 *   quiet; life >= 0.74 s. Emitter decks all >= 2.4 m wide; every rmax circle
 *   is contained by its deck to within 0.3 m so no ring hangs over a jump gap.
 *
 * SHARED CLOCKS (§6): bloom pair + satellite orbit all period 6.0 (LCM 6 s);
 *   split-lanes court is 3.1 / 6.2 / 12.4 s (LCM 12.4 s); the Refraction Hall
 *   relay is 12 s flat with phases 0 / 1.6/12 / 3.2/12 giving a data-enforced
 *   dwellOverlap of exactly 0.6 s per handoff (brief: 0.6; law floor 0.4).
 *
 * RHYTHM — measured, not intended (`node _harness/geomcheck.mjs rainbow-1`):
 *   36 distinct platform footprints, gap coefficient of variation 0.67, never
 *   two identical obstacles in a row, longest run without a height change over
 *   0.75 m = 38.8 m (was 76.2 on the first pass — the garden's near-level
 *   discs drifted under the threshold step by step; BEAT 9 now leaves by
 *   height, +0.1 / -1.7 / +1.5). Zero warnings on both gates.
 *
 * VALIDATOR PROOF (run this session, not assumed): all 14 prismgate/bloom defs
 *   pass hazards/index.js REQUIRED + SEMANTIC; validateSharedClockLaws returns
 *   ok for the refraction relay (dwellOverlap 0.6 s exact), the bloom-pair
 *   court and the split-lanes court (superperiods 6 / 12.4 s, law <= 16).
 *
 * REACH BUDGET USED (safe limits, CONTRACT §0): hardest jumps on the route are
 *   3.40 m at +0.9 (BEAT 2 and the shaft-gate crossing — house number, safe
 *   3.87) and 3.30 m flat (BEAT 2, safe 4.4). NO sprint is required anywhere.
 *   The one jump pad (BEAT 17) has its walk..sprint landing band [4.02, 9.81] m
 *   fully inside the gallery's span [3.85, 10.25] m from the launch lip, so no
 *   entry speed can miss or overshoot the deck.
 *
 * HEIGHT LADDER: 0.5 (causeway) -> 2.2 (gate 2 court) -> 1.1 (garden low) ->
 *   2.6 (split lanes) -> 3.8 (pause island) -> 3.1 (breather) -> 4.4 (shaft
 *   base) -> 8.0 (gallery, off the pad) -> 9.8 (Refraction Hall) -> 12.1 (out).
 *
 * GLARE (law 5, §3 budget): walking surfaces are OPAL-class stone with DARK
 *   structural glows; band hue appears ONLY on the hazard modules' own
 *   filaments/rings and on deco strips <= 0.3 m wide (metronome notches, edge
 *   rails). HOT is reserved for lethal reads. The metronome towers are static
 *   furniture here (notched spectrum ladders + pip legend); the CLIMBING light
 *   of §4 channel 6 lives at module/court level and the gates' own pip-brighten
 *   telegraph carries the timing read meanwhile.
 *
 * DETERMINISM: every timed object is a pure function of the stage clock
 *   (CONTRACT §16). No seeds needed — nothing here scatters at runtime except
 *   the far cloud decks, which carry explicit seeds.
 */

const GOLD = 0xffc35c; // teaching signs + embossed pips (§3)
const IVORY = 0xfff8e6; // safe edges — the brightest thing on a landing
const HOT = 0xff1044; // reserved for things that end the run
const MINT = 0x18d69a; // checkpoint colour (untouched, unique form)
const FINISH = 0xd9b6ff; // palette.finish — used for nothing else
const SMOKE = 0x241f2e; // dark cloudglass structure — the scene stays dark
const DUSK = 0x6f6584; // receding secondary text
const SLATE = 0x3a3452; // structural glow for OPAL walking slabs (dark, law 5)
const FROST = 0xdff0ff; // wind read

// Band 0..6 — hue = slot = speed class (§3 collision ledger lives in themes.js)
const B_RED = 0xff5a4d;
const B_ORANGE = 0xffa03c;
const B_YELLOW = 0xf5e63d;
const B_GREEN = 0x3ddc84;
const B_BLUE = 0x38b6ff;
const B_INDIGO = 0x4f6bff;
const B_VIOLET = 0x9a5cff;

export default {
  id: 'rainbow-1',
  world: 'rainbow',
  name: 'FIRST LIGHT',
  subtitle: 'Every lesson, in every colour, one at a time',
  par: 150000,
  difficulty: 10,

  spawn: { p: [-1.0, 1.1, 0], yaw: 0 },
  killY: -60,

  /* Nine checkpoints, brief table verbatim (x / clockOffset), each pre-spike
     and swept clear: distance to nearest bloom rmax circle / gate plane quoted. */
  checkpoints: [
    { p: [1.0, 0.6, 0], yaw: 0, clockOffset: 0 }, // 0 spawn deck
    { p: [30.0, 1.5, 0], yaw: 0, clockOffset: 6 }, // 1 gate-1 staging deck (plane at 38.4: 8.4 m clear)
    { p: [62.0, 2.3, 1.6], yaw: 0, clockOffset: 13 }, // 2 Bloom Garden entry (B1 circle starts x 66.0: 4.2 m clear)
    { p: [92.0, 1.5, 0.6], yaw: 0, clockOffset: 21 }, // 3 offset bloom pair (B3 at 12.9 m, B2 at 9.8 m)
    { p: [130.6, 1.9, 0.8], yaw: 0, clockOffset: 30 }, // 4 Split Lanes entry (gate-3 plane at 140.6: 10.0 m)
    { p: [166.0, 2.7, -2.6], yaw: 0, clockOffset: 40 }, // 5 vanish-under-gate + pause island (gate-5 plane 185.4)
    { p: [200.6, 3.2, -3.6], yaw: 0, clockOffset: 51 }, // 6 Landing / high-bloom teach (B5 emitter 6.4 m > rmax 4.6 + 1.7)
    { p: [228.0, 8.1, 0.2], yaw: 0, clockOffset: 63 }, // 7 wind shaft gallery (gate-6 plane at 233.0: 5.0 m)
    { p: [250.0, 9.9, 0.2], yaw: 0, clockOffset: 76 }, // 8 Refraction Hall entry (gate-7 plane at 257.8: 7.8 m)
  ],

  finish: { p: [305.6, 12.6, 0], yaw: 0 },

  /* Three coins, each an alternate line with a cost: ride the satellite orbit
     through both rings' reach, hold the breather perch beside the HIGH bloom,
     or walk the hall's bailout ledge to its far end (slower than the relay). */
  coins: [
    { p: [107.4, 3.2, 9.8] }, // II  — satellite orbit, both rings out of phase
    { p: [204.0, 4.2, 8.0] }, // IV  — breather perch beside the HIGH ring
    { p: [267.0, 11.1, 0.2] }, // V   — mid-hall, between gates 2 and 3, ON the relay line
  ],

  objects: [
    /* ============================================================================ */
    /* MOVEMENT I — THE OPAL CAUSEWAY (x 0-58)                                      */
    /* Arrival above the cloud sea; the house three-jump warm-up; then the first    */
    /* prismgate in TOTAL isolation, and a second that only adds stops.             */
    /* ============================================================================ */

    /* BEAT 1 — THE THRESHOLD. Solid ground, the name, the view down the causeway. */
    { kind: 'platform', p: [2, 0, 0], s: [12, 1, 10], mat: 'stone', glow: SLATE },

    { kind: 'text', p: [-3.4, 3.1, 0], rot: [0, -Math.PI / 2, 0], text: 'FIRST LIGHT', size: 0.86, color: GOLD },
    { kind: 'text', p: [-3.4, 2.4, 0], rot: [0, -Math.PI / 2, 0], text: 'PRISM CROWN  ·  I', size: 0.28, color: DUSK },
    { kind: 'text', p: [-3.4, 1.85, 0], rot: [0, -Math.PI / 2, 0], text: 'the light after the storm', size: 0.24, color: HOT },
    { kind: 'deco', kindOf: 'arch', p: [6.8, 5.2, 0], s: [1.4, 1.1, 12.0], mat: 'obsidian', tint: 0xff7ad9 },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 2.9, 5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 2.9, -5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [2.0, 4.6, 0], color: 0xfff0d0, intensity: 10, distance: 24 },

    /* BEAT 2 — THREE STONES, THREE JUMPS (house numbers: 1.3 flat / 3.4 at +0.9
       off-axis / 3.3 flat — the same drill temple-3 opens with, so returning
       players read it as a calibration, not a lesson). */
    { kind: 'platform', p: [11.0, 0, 0], s: [3.4, 1, 5.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 1.30, flat
    { kind: 'platform', p: [17.7, 0.9, 1.8], s: [3.2, 1, 4.6], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.40, +0.9, off-axis
    { kind: 'platform', p: [27.6, 0.9, 0], s: [10.0, 1, 9.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 3.30 — CP1, gate-1 staging deck

    /* THE METRONOME TOWER + LEGEND (§4 channel 6 court furniture): a notched
       spectrum ladder, red at the bottom, violet at the top — slot order IS
       spectral order, and the pip legend under it says so in zero colours.
       Every notch strip is 0.14 m wide (glare budget: hue on trim <= 0.3 m). */
    { kind: 'deco', kindOf: 'post', p: [26.0, 2.6, 6.2], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 1.35, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 1.80, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 2.25, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 2.70, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 3.15, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 3.60, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [26.0, 4.05, 6.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },
    { kind: 'text', p: [26.0, 4.9, 6.2], rot: [0, -Math.PI / 2, 0], text: 'RED LOW · VIOLET HIGH', size: 0.26, color: GOLD },

    { kind: 'text', p: [24.4, 3.6, -3.0], rot: [0, -Math.PI / 2, 0], text: 'THE WINDOW IS THE DOOR', size: 0.44, color: GOLD },
    { kind: 'text', p: [24.4, 3.05, -3.0], rot: [0, -Math.PI / 2, 0], text: 'watch one full pass  ·  enter on a dwell', size: 0.24, color: DUSK },
    { kind: 'light', p: [27.6, 4.2, 0], color: MINT, intensity: 9, distance: 18 },

    /* BEAT 3 — GATE 1, IN TOTAL ISOLATION. Three stops, dwell 2.4 s (teaching
       tier), travel 0.8 s: worst cyclic slot pitch 4.93 m / 0.8 s = 6.17 m/s,
       under the 6.4 chaseable law. Sill = deck top 1.4 (p.y 3.4 = 1.4 + 4.0/2).
       Lattice spans z -4.5..4.5; the whole deck BEFORE the 0.4 m plane is
       all-phase-safe staging, and the flank ledge sits at z 5.4..7.8 — fully
       outside the lattice, visible from the staging deck. */
    { kind: 'platform', p: [38.6, 0.9, 0], s: [10.0, 1, 10.0], mat: 'stone', glow: SLATE }, // gap 1.00 — the gate court
    { kind: 'prismgate', p: [38.6, 3.4, 0], s: [0.4, 4.0, 9.0], seq: [1, 3, 5], dwell: 2.3, travel: 0.9, period: 9.6 },
    { kind: 'deco', kindOf: 'rail', p: [43.2, 1.46, 0], s: [0.1, 0.06, 9.6], mat: 'emissive', tint: IVORY }, // exit edge strip, 0.1 m — the side you aim for

    /* BEAT 4 — GATE 2: SAME VERB, FIVE STOPS. Dwell 2.0, travel 1.0 (period 15):
       the full rising rainbow, one slot per stop — spectral order = slot order,
       and the pip columns count it for colourblind players. Worst cyclic pitch
       is the wrap 5->1: 6.27 m/s, still chaseable. Flank ledge LEFT this time
       (alternating sides is house language). */
    { kind: 'platform', p: [46.8, 1.7, -1.2], s: [4.0, 1, 5.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 1.20, +0.8
    { kind: 'platform', p: [53.8, 1.7, 0], s: [10.0, 1, 10.0], mat: 'stone', glow: SLATE }, // gap 1.00 — gate-2 court, top 2.2
    { kind: 'prismgate', p: [53.8, 4.2, 0], s: [0.4, 4.0, 11.0], seq: [1, 2, 3, 4, 5], dwell: 1.9, travel: 1.1, period: 15 },
    { kind: 'text', p: [50.4, 4.4, -4.2], rot: [0, -Math.PI / 2, 0], text: 'COUNT THE PIPS', size: 0.40, color: GOLD },
    { kind: 'text', p: [50.4, 3.9, -4.2], rot: [0, -Math.PI / 2, 0], text: 'the next slot brightens before the slide', size: 0.22, color: DUSK },
    { kind: 'light', p: [53.8, 5.2, 0], color: 0xfff0d0, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* MOVEMENT II — THE BLOOM GARDEN (x 58-128)                                    */
    /* The second verb: LOW rings, blue (3.0 m/s), on generous etched discs.        */
    /* Alone first, then on ice, then two on one clock. Emitter decks all contain   */
    /* their rmax circle, so no ring ever hangs over a jump gap.                    */
    /* ============================================================================ */

    /* BEAT 5 — GARDEN THRESHOLD (CP2). */
    { kind: 'platform', p: [61.4, 1.7, 1.6], s: [4.4, 1, 4.6], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.40, flat — CP2
    { kind: 'text', p: [59.6, 4.3, 1.6], rot: [0, -Math.PI / 2, 0], text: 'JUMP THE RIPPLE', size: 0.44, color: GOLD },
    { kind: 'text', p: [59.6, 3.75, 1.6], rot: [0, -Math.PI / 2, 0], text: 'the ring passes in a blink  ·  be airborne', size: 0.24, color: DUSK },
    { kind: 'light', p: [61.4, 4.0, 1.6], color: MINT, intensity: 9, distance: 16 },

    /* BEAT 6 — FIRST BLOOM, ALONE. Blue, 3.0 m/s, quiet 2.0 s (teaching beat):
       ring life 1.8 s, then two full dark seconds. rmax 5.4 on a 12 m disc —
       circle x 66.0..76.8 inside deck 65.4..77.4. The sundial/etched rings are
       module furniture; the deck is the classroom. */
    { kind: 'platform', p: [71.4, 0.7, 0], s: [12.0, 1, 12.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.80, -0.5 — the etched disc
    { kind: 'bloom', p: [71.4, 1.2, 0], rmax: 5.4, band: 4, period: 6.0, quiet: 2.0 },

    /* BEAT 7 — BLOOM ON ICE: momentum vs timing. Same band, rmax 3.4 so the
       circle (79.2..86.0) stays on the ice (79.1..86.1); half-phase against B1
       so the two gardens alternate on one 6 s clock. */
    { kind: 'ice', p: [82.6, 1.4, -2.2], s: [7.0, 1, 6.0] }, // gap 1.70, +0.7
    { kind: 'bloom', p: [82.6, 1.9, -2.2], rmax: 3.4, band: 4, period: 6.0, phase: 0.5 },
    { kind: 'text', p: [79.5, 4.2, -2.2], rot: [0, -Math.PI / 2, 0], text: 'GLAZED', size: 0.36, color: FROST },

    /* BEAT 8 — THE REST (CP3), then THE PAIR: two emitters, ONE 6 s clock, half
       a phase apart — cross the corridor where their reaches overlap while the
       far one is dark. rmax circles overhang their court by <= 0.3 m. */
    { kind: 'platform', p: [93.6, 0.9, 0.6], s: [9.0, 1, 9.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 3.00, -0.5 — CP3
    { kind: 'platform', p: [106.4, 1.4, -1.0], s: [13.0, 1, 10.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.80, +0.5 — the pair court
    { kind: 'bloom', p: [104.0, 1.9, -3.6], rmax: 4.2, band: 4, period: 6.0, phase: 0 },
    { kind: 'bloom', p: [109.2, 1.9, 1.4], rmax: 4.2, band: 4, period: 6.0, phase: 0.5 },
    { kind: 'text', p: [95.8, 3.4, 4.4], rot: [0, -Math.PI / 2, 0], text: 'ONE CLOCK  ·  HALF A BEAT APART', size: 0.30, color: GOLD },

    /* COIN 1 — THE SATELLITE. A tile orbiting off the court's north rail on the
       SAME 6 s clock; B4's ring sweeps its boarding corner, so the ride is two
       ring-reads out of phase. Coin hangs over the orbit's far sweep. */
    {
      kind: 'mover',
      p: [107.4, 1.4, 7.8],
      s: [2.6, 1, 2.6],
      mat: 'metal',
      motion: { type: 'orbit', radius: 2.0, axis: 'y', period: 6.0, phase: 0.25 },
    }, // ORBIT CENTRE — tile passes z 5.8..9.8, boarding gap 0.50 off the rail
    { kind: 'deco', kindOf: 'ring', p: [107.4, 1.5, 7.8], s: [4.6, 0.12, 4.6], mat: 'emissive', tint: GOLD }, // the lit orbit track

    /* BEAT 9 — OUT OF THE GARDEN: an ice shelf UP, then the plunge to the low
       road — the garden leaves by height (+0.1 court->shelf, then -1.7 down,
       then +1.5 back out), because 76 m of near-level discs measured as a flat
       corridor on the first geomcheck pass and this is the fix. */
    { kind: 'ice', p: [116.6, 1.5, 2.4], s: [5.0, 1, 5.0] }, // gap 1.20, +0.1, top 2.0
    { kind: 'platform', p: [124.4, -0.2, -0.8], s: [6.4, 1, 6.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 2.10, -1.7 — the garden's low point, top 0.3

    /* ============================================================================ */
    /* MOVEMENT III — SPLIT LANES (x 128-200)                                       */
    /* Three lanes through one court, all on the 12.4 s master clock (LCM of        */
    /* 3.1 / 6.2 / 12.4): CENTRE rides a mover THROUGH gate 4's window; SOUTH       */
    /* skirts the lattice on a second mover; NORTH hops a vanish lane. Then the     */
    /* vanish-under-gate line and the FORCED-PAUSE ISLAND.                          */
    /* ============================================================================ */

    /* BEAT 10 — ENTRY (CP4) and GATE 3, the sight-reading exam: seq [0,2,4,6]
       IS the spectrum, skipping every other band — read the lattice hue, know
       the slot. Dwell 1.6 (mid tier), travel 1.5: wrap pitch 6.27 m/s, legal.
       Deck z -5.0..6.6 covers the full lattice span (z -4.7..6.3). */
    { kind: 'platform', p: [131.8, 1.3, 0.8], s: [6.0, 1, 7.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.20, +1.5 up out of the low road — CP4
    { kind: 'platform', p: [140.8, 1.3, 0.8], s: [8.0, 1, 11.6], mat: 'stone', glow: SLATE }, // gap 2.00, flat — gate-3 court
    { kind: 'prismgate', p: [140.8, 3.8, 0.8], s: [0.4, 4.0, 11.0], seq: [0, 2, 4, 6], dwell: 1.45, travel: 1.65, period: 12.4 },
    { kind: 'text', p: [136.4, 4.6, -3.4], rot: [0, -Math.PI / 2, 0], text: 'READ THE RAINBOW', size: 0.40, color: GOLD },
    { kind: 'text', p: [136.4, 4.05, -3.4], rot: [0, -Math.PI / 2, 0], text: 'red rides far left  ·  violet far right', size: 0.22, color: DUSK },

    /* BEAT 11 — THE THREAD. Gate 4 stands over open sky; the CENTRE mover
       (6.2 s, half the gate's 12.4) carries you through its window: the tile
       crosses the plane at z 0.4 = slot 3's stop, sill 2.2 = tile top at the
       crossing. seq [3,2,4,3] never strays more than one slot from the lane.
       SOUTH mover shuttles at z -7.0..-7.8, clear of the lattice edge -5.1.
       NORTH vanish lane (BEAT 12) clears the other edge at z >= 6.1. */
    {
      kind: 'mover',
      p: [147.6, 1.3, 3.4],
      s: [3.2, 1, 3.4],
      mat: 'metal',
      motion: { type: 'linear', to: [155.2, 2.1, -2.6], period: 6.2, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // CENTRE lane — gap 1.20 to board, top 1.8 -> 2.6
    { kind: 'prismgate', p: [151.4, 4.4, 0.4], s: [0.4, 4.4, 11.0], seq: [3, 2, 4, 3], dwell: 1.6, travel: 1.5, period: 12.4, window: { w: 1.6, h: 2.6 } },
    {
      kind: 'mover',
      p: [147.6, 1.3, -7.0],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      motion: { type: 'linear', to: [155.2, 2.1, -7.8], period: 6.2, phase: 0.5, ease: 'sine', dwell: 0.5 },
    }, // SOUTH lane — rides AROUND the lattice, counter-phased with centre
    { kind: 'vanish', p: [148.6, 1.7, 7.6], s: [2.8, 1, 3.0], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0 } }, // NORTH lane — gap 2.40, +0.4
    { kind: 'vanish', p: [153.4, 1.9, 8.4], s: [2.8, 1, 3.0], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0.5 } }, // gap 2.00, +0.2
    { kind: 'vanish', p: [158.6, 2.1, 3.0], s: [2.8, 1, 3.0], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0.25 } }, // gap 3.39 diagonal, +0.2, back to the axis
    { kind: 'text', p: [144.6, 4.9, 6.4], rot: [0, -Math.PI / 2, 0], text: 'THREE LANES  ·  ONE CLOCK', size: 0.30, color: GOLD },

    { kind: 'platform', p: [159.4, 2.1, -3.0], s: [5.2, 1, 5.2], mat: 'stone', glow: SLATE, stripe: true }, // landing — meets the centre mover's far pose edge-on
    { kind: 'platform', p: [166.2, 2.1, -2.6], s: [6.0, 1, 6.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.20 — CP5

    /* BEAT 12 — VANISH UNDER THE GATE + THE FORCED-PAUSE ISLAND. Two brisk
       tiles (3.1 s cycle), then the island: a 6.2 s cycle tile whose 0.6 s
       warn window (phase 1.0/6.2) lands EXACTLY on gate 5's dwell opens at
       t = 4.6 and 10.8 — the only way forward is to stand ON the blinking
       tile and hop the 2.3 m through the window while it holds. Gate 5's
       window is 3.0 m tall so the hop's full arc fits (feet +0.6..+2.0 at the
       plane, head <= 3.8+2.0+1.8 = 7.6 < sill 3.8 + 3.0 = 6.8? no — a FULL
       HOLD dies on the upper lattice; the island teaches the SHORT hop, and
       the sign says so. A tap-hop's head peaks ~6.4 at the plane.). */
    { kind: 'vanish', p: [172.6, 2.5, -1.0], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0 } }, // gap 1.90, +0.4
    { kind: 'vanish', p: [177.8, 2.9, 1.8], s: [2.8, 1, 3.0], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0.5 } }, // gap 2.30, +0.4
    { kind: 'vanish', p: [183.0, 3.3, 0.4], s: [2.6, 1, 2.8], mat: 'panel', cycle: { on: 3.6, off: 2.0, warn: 0.6, phase: 1.0 / 6.2 } }, // THE PAUSE ISLAND — warn 4.6..5.2 s = gate 5's dwell open
    { kind: 'prismgate', p: [185.6, 6.3, 0.4], s: [0.4, 5.0, 7.0], seq: [4, 3, 2, 3], dwell: 1.6, travel: 1.5, period: 12.4, window: { w: 1.6, h: 3.0 } },
    { kind: 'platform', p: [189.6, 3.3, 0.4], s: [6.0, 1, 7.0], mat: 'stone', glow: SLATE, stripe: true }, // landing — gap 2.30 flat through the window
    { kind: 'text', p: [180.4, 5.8, -2.2], rot: [0, -Math.PI / 2, 0], text: 'BLINKING IS STILL SOLID', size: 0.36, color: GOLD },
    { kind: 'text', p: [180.4, 5.3, -2.2], rot: [0, -Math.PI / 2, 0], text: 'stand the warn  ·  hop low through the door', size: 0.22, color: DUSK },

    /* BEAT 13 — TWO KINDS OF LIGHT YOU ALREADY KNOW (legacy check, court clock):
       a bar at knee height to jump, then a bar at neck height to crouch under
       on the ice slide out — both 3.1 s cycles, LCM with the gates 12.4. */
    { kind: 'laser', a: [191.0, 4.35, -3.1], b: [191.0, 4.35, 3.9], radius: 0.12, color: HOT, cycle: { on: 1.7, off: 1.0, warn: 0.4, phase: 0.2 } }, // 0.55 over the landing — jump
    { kind: 'ice', p: [196.8, 2.6, -1.8], s: [5.0, 1, 5.0] }, // gap 1.70, -0.7
    { kind: 'laser', a: [196.8, 4.85, -4.3], b: [196.8, 4.85, 0.7], radius: 0.12, color: HOT, cycle: { on: 2.1, off: 0.6, warn: 0.4, phase: 0.7 } }, // 1.75 over the ice — crouch, on skates

    /* ============================================================================ */
    /* MOVEMENT IV — THE LANDING (x 200-250)                                        */
    /* Breather + coin; the HIGH bloom taught on the widest deck since the spawn;   */
    /* then the wind shaft and the slots:'y' gate — the aperture climbs, you climb. */
    /* ============================================================================ */

    /* BEAT 14 — THE BREATHER (CP6) and the HIGH RING SCHOOL. B5 is blue and
       slow like everything the garden taught, but it HANGS: band 1.25..2.75 m,
       structurally unjumpable (apex 2.09), crouch 1.05 clears by 0.20. rmax
       circle x 200.8..210.0 inside the deck 199.9..210.9. CP6 sits 6.4 m from
       the emitter, 1.8 m outside the circle. */
    { kind: 'platform', p: [205.4, 2.6, 0.6], s: [11.0, 1, 11.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 0.60, flat — CP6
    { kind: 'bloom', p: [205.4, 3.1, 0.6], rmax: 4.6, band: 4, period: 6.0, ring: 'high' },
    { kind: 'platform', p: [204.0, 2.75, 8.0], s: [2.6, 0.7, 2.6], mat: 'panel', glow: SLATE, stripe: true }, // COIN 2 perch, outside the circle (7.5 m out)
    { kind: 'text', p: [201.0, 5.6, 4.6], rot: [0, -Math.PI / 2, 0], text: 'LOW ROLLS — JUMP  ·  HIGH HANGS — DUCK', size: 0.34, color: GOLD },
    { kind: 'text', p: [201.0, 5.05, 4.6], rot: [0, -Math.PI / 2, 0], text: 'daylight under it means get under it', size: 0.22, color: DUSK },
    { kind: 'light', p: [205.4, 5.6, 0.6], color: MINT, intensity: 9, distance: 20 },

    /* BEAT 15 — CROSSWIND ON ICE (both old verbs, one breath before the shaft). */
    { kind: 'ice', p: [214.6, 3.4, -1.6], s: [5.0, 1, 5.6] }, // gap 1.20, +0.8
    { kind: 'wind', p: [216.5, 6.4, -1.6], s: [8, 5, 10], dir: [0, 0, 1], power: 10, color: FROST }, // x 212.5..220.5, shoves toward +z

    /* BEAT 16 — THE SHAFT BASE. Pad or lift, your pick: the pad is the fast
       line, the elevator is the patient one. Pad maths (measured against
       controller physics): apex 5.0, dy 3.44 to the gallery -> walk entry
       lands 4.02 m out, held-sprint entry 9.81 m; the gallery spans 3.85 to
       10.25 m from the launch lip. No entry speed misses. */
    { kind: 'platform', p: [222.0, 3.9, 1.2], s: [4.6, 1, 4.6], mat: 'stone', glow: SLATE, stripe: true }, // gap 2.60, +0.5
    { kind: 'jumppad', p: [222.6, 4.48, 1.2], s: [2.6, 0.16, 2.6], power: 5.0, dir: [0, 1, 0] },
    {
      kind: 'mover',
      p: [224.9, 4.4, -2.8],
      s: [2.8, 1, 2.8],
      mat: 'metal',
      motion: { type: 'elevator', to: [228.4, 7.5, -2.8], speed: 2.0, dwell: 0.4, hold: 2.0 },
    }, // the patient line — board at top 4.9, ride to 8.0
    { kind: 'wind', p: [226.0, 8.0, 1.2], s: [7, 9, 6], dir: [0, 1, 0], power: 9, color: FROST }, // the updraft that fills the shaft
    { kind: 'platform', p: [228.0, 7.5, 1.2], s: [6.4, 1, 5.0], mat: 'stone', glow: SLATE, stripe: true }, // THE GALLERY, top 8.0 — CP7

    /* BEAT 17 — THE CLIMBING DOOR (slots:'y'). The aperture rides the slot
       ladder UP: seq [1,3,5] climbs one lit stop at a time (10.2 s period,
       aperture speed 3.6 m/s vertical). The crossing is the house 3.4 m at
       +0.9 jump through the MIDDLE stop's window — window h 3.6 (y 8.4..12.0
       at slot 3) swallows the entire arc: full-hold head peaks 11.89 at the
       plane, tap-hop feet bottom out at 8.6. Cross on the middle dwell.
       Flank ledge rides the shaft wall at z 4.3..6.9, outside the wall's
       z -1.8..4.2. */
    { kind: 'prismgate', p: [233.2, 10.2, 1.2], s: [0.4, 7.0, 6.0], slots: 'y', seq: [1, 3, 5], dwell: 2.25, travel: 1.15, period: 10.2, window: { w: 1.6, h: 3.6 } },
    { kind: 'platform', p: [236.2, 8.4, 1.2], s: [3.2, 1, 3.2], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.40, +0.9 THROUGH the middle window
    { kind: 'platform', p: [239.8, 9.3, -1.0], s: [3.0, 1, 3.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 0.50, +0.9, off-axis
    { kind: 'text', p: [230.0, 11.6, -1.8], rot: [0, -Math.PI / 2, 0], text: 'THE DOOR CLIMBS  ·  MEET IT MID-LADDER', size: 0.30, color: GOLD },

    /* ============================================================================ */
    /* MOVEMENT V — THE REFRACTION HALL (x 250-305)                                 */
    /* The set piece: three gates in series on ONE 12 s clock (superperiod 12 s,    */
    /* brief-exact), phases 0 / 1.6/12 / 3.2/12 so every handoff window opens       */
    /* 0.6 s before the previous closes (relay law floor 0.4). One unbroken walk    */
    /* at ~4.5 m/s threads all three on consecutive dwells. Smoked-glass ribs let   */
    /* you see all three windows from the entry deck; the flank ledge runs the      */
    /* hall's full length.                                                          */
    /* ============================================================================ */

    /* BEAT 18 — THE HALL (CP8 before entry, law 4). */
    { kind: 'platform', p: [248.2, 9.3, 0.2], s: [9.0, 1, 8.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 2.40, +0.5 — CP8
    { kind: 'platform', p: [264.0, 9.3, 0.2], s: [22.0, 1, 9.0], mat: 'stone', glow: SLATE }, // gap 0.30 — the hall floor, one unbroken run
    { kind: 'prismgate', p: [258.0, 11.8, 0.2], s: [0.4, 4.0, 9.0], seq: [2, 3, 4, 3], dwell: 2.0, travel: 1.0, period: 12, phase: 0, relay: { group: 'refraction', index: 0 } },
    { kind: 'prismgate', p: [264.0, 11.8, 0.2], s: [0.4, 4.0, 9.0], seq: [2, 3, 4, 3], dwell: 2.0, travel: 1.0, period: 12, phase: 1.6 / 12, relay: { group: 'refraction', index: 1 } }, // opens 0.6 s before gate 0 closes
    { kind: 'prismgate', p: [270.0, 11.8, 0.2], s: [0.4, 4.0, 9.0], seq: [2, 3, 4, 3], dwell: 2.0, travel: 1.0, period: 12, phase: 3.2 / 12, relay: { group: 'refraction', index: 2 } }, // and 0.6 s again
    { kind: 'text', p: [252.4, 12.6, -3.8], rot: [0, -Math.PI / 2, 0], text: 'THE REFRACTION HALL', size: 0.50, color: GOLD },
    { kind: 'text', p: [252.4, 12.0, -3.8], rot: [0, -Math.PI / 2, 0], text: 'one line threads all three  ·  walk with the light', size: 0.24, color: DUSK },

    /* The hall's metronome ladder, at the entry where you plan the run. */
    { kind: 'deco', kindOf: 'post', p: [251.0, 11.0, 5.4], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 9.75, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 10.20, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 10.65, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 11.10, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 11.55, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 12.00, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [251.0, 12.45, 5.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },

    /* Smoked-glass ribs — deco, never solid, never a landing: they read as the
       hall while the windows stay visible through them. */
    { kind: 'deco', kindOf: 'screen', p: [258.0, 12.4, -5.6], s: [0.4, 5.6, 1.8], mat: 'obsidian', tint: SMOKE },
    { kind: 'deco', kindOf: 'screen', p: [264.0, 12.4, -5.6], s: [0.4, 5.6, 1.8], mat: 'obsidian', tint: SMOKE },
    { kind: 'deco', kindOf: 'screen', p: [270.0, 12.4, -5.6], s: [0.4, 5.6, 1.8], mat: 'obsidian', tint: SMOKE },
    { kind: 'deco', kindOf: 'arch', p: [264.0, 15.2, 0.2], s: [14.0, 1.2, 11.0], mat: 'obsidian', tint: SMOKE },

    /* BEAT 19 — OUT OF THE HALL: two rising steps, a shuttle, and the plate. */
    { kind: 'platform', p: [278.6, 9.9, -1.6], s: [4.0, 1, 5.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 1.60, +0.6
    { kind: 'platform', p: [285.2, 10.8, 1.0], s: [4.0, 1, 5.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 2.60, +0.9
    {
      kind: 'mover',
      p: [291.4, 10.8, 1.0],
      s: [3.4, 1, 3.4],
      mat: 'metal',
      motion: { type: 'linear', to: [297.8, 11.6, -0.8], period: 5.0, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // gap 2.50 to board, carries +0.8 across the last void
    { kind: 'platform', p: [304.4, 11.6, 0], s: [8.0, 1, 10.0], mat: 'obsidian', glow: FINISH, stripe: true }, // gap 0.90 — FINISH, top 12.1

    { kind: 'deco', kindOf: 'arch', p: [304.4, 17.4, 0], s: [1.8, 1.4, 11.0], mat: 'obsidian', tint: FINISH },
    { kind: 'deco', kindOf: 'pillar', p: [304.4, 14.6, 5.2], s: [1.5, 6.4, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [304.4, 14.6, -5.2], s: [1.5, 6.4, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [308.0, 14.2, 0], s: [0.7, 3.2, 0.7], mat: 'emissive', tint: FINISH },
    { kind: 'text', p: [301.2, 14.4, 0], rot: [0, -Math.PI / 2, 0], text: 'FIRST LIGHT', size: 0.5, color: FINISH },
    { kind: 'light', p: [304.4, 15.2, 0], color: FINISH, intensity: 20, distance: 36 },

    /* ============================================================================ */
    /* DRESSING — all of it at |z| >= 12, above y 15 or below y -8: out of every    */
    /* play corridor, no flat lit top edges, luminance held to distant-scenery      */
    /* levels (glare budget: the dark-adapted scene stays dark).                    */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [70, -18, 26], s: [8, 32, 8], count: 7, spread: [200, 20, 22], seed: 5101, tint: 0x8f86a8 },
    { kind: 'deco', kindOf: 'monolith', p: [230, -20, -30], s: [10, 36, 10], count: 7, spread: [190, 24, 24], seed: 5209, tint: 0x7d739c },
    { kind: 'deco', kindOf: 'shard', p: [150, 4, 20], s: [2.6, 8.0, 2.6], count: 6, spread: [220, 16, 14], seed: 5323, tint: 0xbfb3e0 },
    { kind: 'deco', kindOf: 'pillar', p: [110, -10, -18], s: [1.8, 22.0, 1.8], count: 8, spread: [260, 12, 10], seed: 5441, tint: 0x6c6288 },
    { kind: 'deco', kindOf: 'cloud', p: [150, -28, 0], s: [24, 3.2, 24], count: 14, spread: [340, 10, 110], seed: 5507, scale: 2.2, tint: 0xffffff },
    { kind: 'deco', kindOf: 'cloud', p: [160, -44, 0], s: [32, 4.0, 32], count: 10, spread: [340, 12, 140], seed: 5651, scale: 2.8, tint: 0xe6ecf8 },

    /* Path lights, one per movement — cool and dim, the hazards carry the hue. */
    { kind: 'light', p: [38, 5.4, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [86, 4.8, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [152, 5.6, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [222, 8.4, 0], color: FROST, intensity: 8, distance: 24 },
    { kind: 'light', p: [264, 13.2, 0.2], color: 0xfff0d0, intensity: 8, distance: 26 },
  ],
};
