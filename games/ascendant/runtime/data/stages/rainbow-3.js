/**
 * ASCENDANT — PRISM CROWN 3 : "WHITE LIGHT"
 * runtime/data/stages/rainbow-3.js
 *
 * The graduation exam, and the last stage of the game. Five movements, one per
 * world, each quoting a signature beat of that world's third stage on sight —
 * NEON's shattering rain-glass stair, FOUNDRY's rising flood, SPIRE's wind arc,
 * TEMPLE's machine deck — each with a new-trap overlay; then THE SEVEN STAIR,
 * the game's only 7-gate prism relay, and the coda: a floor of white light
 * rising out of the cloud sea while you hold the last climb (brief §7
 * rainbow-3, executed verbatim; white = all seven colours = all five worlds).
 *
 * SHAPE      Measured by `node _harness/reachcheck.mjs rainbow-3`, not
 *            estimated: 415 m of travel, 104 gameplay objects, 75 landable
 *            surfaces, 12 checkpoints (cp0..cp11), 3 coins, 64 dynamic hazards
 *            across 17 families. The 3 reported "orphan" surfaces are the
 *            three crusher HEADS — parked iron nothing can or should stand on
 *            (temple-3 ships the same two).
 *
 *            DIFFICULTY PASS 2026-09-15 (owner: "a little TOO easy... TOO many
 *            platforms"): the sub-2.5 m hop carpet was deleted or pulled apart
 *            and every oversized deck shrunk, benchmarked past temple-3 on
 *            _harness/gapstats.mjs — gap p50 3.00 / p75 4.00 (temple-3 2.90 /
 *            3.31), trivial hops 25% (40%), demanding >=4.4 m hops 20% (12%,
 *            the finale tops the whole game), deck area p50 16.0 / p75 33.9.
 *            No prismgate, bloom, laser or other hazard def was touched; every
 *            gate keeps >= 1.8 m of staging before its plane; no required hop
 *            exceeds 7.0 m and every route jump stays in the safe envelope
 *            (reachcheck: zero warnings). Three vanish tiles deleted. Mix:
 *
 *              prismgate 9 · bloom 7 (4 low / 3 high) · vanish 5 · laser 5 ·
 *              lasergrid 2 · risinglava 1 · crusher 3 · saw 2 · rotor 5 ·
 *              pendulum 4 · ice 6 · wind 3 · mover 6 · conveyor 2 ·
 *              jumppad 2 · speedpad 1 · chase 1 (Y-axis)
 *
 *            NOTE vs brief §7 mix table: the table says "prismgate 8", but the
 *            binding movement text mandates 1 (I: the slow gate over the
 *            rain-glass) + 1 (III: the slots:'y' updraft gate) + 7 (V: the
 *            Seven Stair relay) = 9 — the same table-vs-movements conflict
 *            rainbow-1 hit, resolved the same way: the movements win.
 *
 *            Six movements (brief §7):
 *
 *   I    NEON REMEMBERED     x   0 –  80   rain-glass vanish descent + slow gate
 *   II   THE RISING TIDE     x  80 – 160   risinglava basin, LOW blooms on islands
 *   III  THE SPIRE WIND      x 160 – 240   ice arc, shear wind, pendulums, y-gate
 *   IV   THE TEMPLE ENGINE   x 240 – 320   rotors/saws/belts, LOW+HIGH bloom clock
 *   V    THE SEVEN STAIR     x 320 – 392   7-gate relay, one band per step
 *   CODA THE WHITE GATE      x 392 – 413   the white floor rises; step through
 *
 * CHECKPOINT CLOCKS: brief table verbatim — x 0/40/80/118/160/198/240/268/294/
 *   320/350/378, clockOffset 0/7/15/24/34/45/57/70/84/99/115/132, strictly
 *   rising so every respawn is a rerun of the same light show (contract law 4).
 *   Every checkpoint is PRE-spike, >= 1.7 m outside every bloom rmax circle and
 *   >= 5 m from every prismgate plane (rainbow-1's hand-check standard; the
 *   tightest margins are quoted at each cp below).
 *
 * PRISM GATE LAW (§4, enforced by hazards/index.js SEMANTIC): period ==
 *   seq.length * (dwell + travel) to 1e-6; window >= 1.6 x 2.2; worst CYCLIC
 *   slot pitch / travel <= 6.4 m/s. The Seven Stair relay deliberately does NOT
 *   run the naive [0..6] spectrum at travel 0.5 — that wrap is 6 slots in one
 *   slide and the validator refuses it. Instead seq [0,1,2,3,4,5,6,3] walks the
 *   spectrum one band at a time and returns through band 3: worst hop 3 slots =
 *   5.00 m per 0.8 s travel = 6.25 m/s, legal, and period lands on exactly
 *   16.0 s so the whole court (gates + both stair blooms at 8.0 s) shares a
 *   16 s superperiod (law §6-1 ceiling, met with nothing to spare).
 *
 * SEVEN STAIR RELAY (§6-2, data-enforced): all 7 gates share period 16.0 and
 *   group 'sevenstair'; phases step by 1.4/16 per gate, which shifts each
 *   gate's dwell 0.6 s later than its predecessor's (stop spacing 2.0 s, shift
 *   -1.4 = +0.6 mod 2.0) — dwellOverlap 0.6 s per handoff, floor 0.4. The
 *   intended line rides the opening chain up the stair ("the window climbs the
 *   stair with you", taught by rainbow-1 IV); the patient line waits <= 2.0 s
 *   at any staging deck for the next dwell anywhere along the lattice.
 *
 * COLOUR BLOOM LAW (§5): band = hue = speed (SPEED_BY_BAND: red/orange 6.0,
 *   yellow/green 4.2, blue+ 3.0 m/s). The remix uses the classes the earlier
 *   stages taught: LOW green/blue in the Tide (jump), LOW yellow + HIGH indigo
 *   on one clock in the Engine, HIGH indigo/violet on the Stair (duck, mid-
 *   relay). Every rmax circle is contained by its deck to within 0.3 m; every
 *   emitter deck >= 2.4 m wide; period >= life + quiet and life >= 0.74 s on
 *   all seven (margins in the beat comments).
 *
 * SHARED CLOCKS (§6-1, all courts <= 16 s): I gate court 14.0 s flat · II bloom
 *   basin 6.0 s · III arc court LCM(3.4, 2.55, 5.1, 10.2) = 10.2 s · IV engine
 *   LCM(3, 1.5, 4, 2, 6) = 12.0 s · V stair LCM(16, 8) = 16.0 s.
 *
 * THE WHITE GATE (coda): a Y-axis chase per the temple-3 collapse doctrine —
 *   axis 'y' is load-bearing (chase.js kill depth points DOWN into empty sky),
 *   footprint x 321..412 starts past movement IV's last surface (x <= 318.9)
 *   so it is structurally incapable of touching a player still in the Engine
 *   at ANY clock value. Arms at t = 140 (cp11 pins the race at clock 132),
 *   rises at 1.6 m/s, visible for its whole life, and parks at 22.5 — 0.8 m
 *   under the White Gate floor (top 23.3), the one surface it never takes.
 *   Timeline: base court top 11.5 taken at t 168.4, summit 22.0 at 175.0,
 *   parked at 175.3; par 215 s meets the light on the climb. Glare spec §3:
 *   the lethal front is a <= 0.4 m IVORY leading edge with a HOT thread on a
 *   dark volumetric smoke body — never a lit plane (deco at the coda).
 *
 * REACH BUDGET USED (safe limits, CONTRACT §0): stair rises are 1.25–1.4 over
 *   gaps 2.6–3.2 since the difficulty pass — each checked against the
 *   dy-adjusted run-safe reach (3.51 m at +1.4), never the flat number; the
 *   descending 4.2–4.5 m leaps in I sit inside run-safe at their drops, and
 *   the long flats (5.5–6.4 m in I/II/V) are sprint-class with the drop or a
 *   runway paying for them (II: 9.6 m runway, 5.6 m flat gap; V: the 11.1 m
 *   landing runway, 5.9 m near-flat gap; the 8.8 m cp11 step under gate 6
 *   stays gap-free — the sprint there is against the LIGHT). Jump pads copy
 *   rainbow-1's proven numbers: power 5.0, dy 3.4, landing decks swallow the
 *   whole walk..sprint band (spans quoted at BEAT 15 and BEAT 21).
 *
 * HEIGHT LADDER: 6.0 (spawn) -> 2.0 (rain-glass descent, DOWN — Neon's stair
 *   shatters under you) -> 1.6..3.4 (tide islands) -> 3.4..8.0 (wind arc) ->
 *   11.4 (updraft gallery) -> 9.4..12.8 (engine decks) -> 11.5 (stair base) ->
 *   20.7 (seventh step) -> 22.0 (summit) -> 23.3 (White Gate) -> 24.5 (finish).
 *
 * RHYTHM — measured, not intended (`node _harness/geomcheck.mjs rainbow-3`):
 *   48 distinct platform footprints, gap coefficient of variation 0.44, no
 *   run of identical obstacles past 2, longest run without a height change
 *   over 0.75 m = 35.6 m (the BEAT 7 shelf still breaks the tide basin at
 *   +1.3). Zero problems on both gates; the one surviving warning is the
 *   cp8->cp9 arc crossing the parting-stamp crusher, which is the intended
 *   timed gate: period 4.0 s, head parked clear for ~3 s of it, and the hop
 *   under it is 1.0 m.
 *
 * VALIDATOR PROOF (run this session, not assumed): all 67 hazard defs pass
 *   hazards/index.js REQUIRED + SEMANTIC (16 prismgate/bloom among them);
 *   validateSharedClockLaws returns ok for all five courts — I 14 s, II 6 s,
 *   III 10.2 s, IV 12 s, V 16 s superperiods, all <= 16 — and
 *   relayDwellOverlap measures 0.600 s on every one of the six 'sevenstair'
 *   handoffs (law floor 0.4).
 *
 * GLARE (law 5, §3 budget): walking surfaces are OPAL-class stone with DARK
 *   structural glows; band hue lives ONLY on the hazard modules' own filaments
 *   and rings and on trim strips <= 0.3 m (metronome notches 0.14 m). HOT is
 *   reserved for lethal reads: laser beams, the white front's thread. The white
 *   coda is dark smoke volume + one thin IVORY edge, luminance held to trim
 *   levels — the dark-adapted scene stays dark until the light below it rises.
 *
 * DETERMINISM: every timed object is a pure function of the stage clock
 *   (CONTRACT §16); the only seeds are on the far cloud dressing.
 */

const GOLD = 0xffc35c; // teaching signs + embossed pips (§3)
const IVORY = 0xfff8e6; // safe edges + the white front's leading edge
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
  id: 'rainbow-3',
  world: 'rainbow',
  name: 'WHITE LIGHT',
  subtitle: 'Every lesson, in every colour, all at once',
  par: 215000,
  difficulty: 10,

  spawn: { p: [-1.0, 6.6, 0], yaw: 0 },
  killY: -60,

  /* Twelve checkpoints, brief table verbatim (x / clockOffset), each pre-spike
     and swept clear — tightest margin quoted per cp. */
  checkpoints: [
    { p: [1.0, 6.1, 0], yaw: 0, clockOffset: 0 }, // 0 spawn deck
    { p: [40.0, 3.3, 0], yaw: 0, clockOffset: 7 }, // 1 shattering stair / gate-1 staging (plane 47.2: 7.2 m)
    { p: [80.0, 2.1, 0], yaw: 0, clockOffset: 15 }, // 2 Rising Tide basin rim (B1 circle edge 4.4 m; lava at clock 15 still at -5.0)
    { p: [118.0, 2.5, 0.4], yaw: 0, clockOffset: 24 }, // 3 mid-tide islands (B2 9.1 m past its circle, B3 15.2 m)
    { p: [160.0, 3.5, 0], yaw: 0, clockOffset: 34 }, // 4 Spire Wind arc entry (pd1 footprint 12.4 m off)
    { p: [198.0, 8.1, 0], yaw: 0, clockOffset: 45 }, // 5 updraft gate + pendulums (gate plane 213.6: 15.6 m; pd4 x-footprint 6.4 m)
    { p: [240.0, 10.7, 0], yaw: 0, clockOffset: 57 }, // 6 Temple Engine entry (rotor r1 disc 9.4 m off)
    { p: [268.0, 10.5, 5.0], yaw: 0, clockOffset: 70 }, // 7 backward belt, side slab (crusher c2 footprint 0.75 m clear in x, 2.0 m in z)
    { p: [294.0, 12.9, -4.2], yaw: 0, clockOffset: 84 }, // 8 double-bloom clock (B4 at 5.49 m >= 3.6+1.7; B5 at 6.2 m >= 4.0+1.7)
    { p: [320.0, 11.6, 0], yaw: 0, clockOffset: 99 }, // 9 Seven Stair base (gate-0 plane 328.4: 8.4 m; chase arms at 140, clock here 99)
    { p: [350.0, 16.7, -3.4], yaw: 0, clockOffset: 115 }, // 10 mid-relay landing (B6 at 5.37 m >= 3.4+1.7; g2 plane 8.6 m, g3 10.6 m)
    { p: [378.0, 19.9, -3.0], yaw: 0, clockOffset: 132 }, // 11 coda — pins the race (g5 plane 5.8 m, g6 plane 10.9 m; chase arms 8 s after this clock)
  ],

  finish: { p: [409.9, 25.0, 0], yaw: 0 },

  /* Three coins, each an alternate line with a cost: a lava-side perch under
     the bloom clock, an orbit ride off the engine's north rail, and a ledge
     slung UNDER the mid-relay landing while the relay runs overhead. */
  coins: [
    { p: [112.6, 2.6, 7.0] }, // II  — perch over the tide, two ring-reads out
    { p: [300.6, 14.0, 10.4] }, // IV  — orbit tile's far sweep, off the engine rail
    { p: [352.8, 15.3, -7.6] }, // V   — under the stair, the relay overhead
  ],

  objects: [
    /* ============================================================================ */
    /* MOVEMENT I — NEON REMEMBERED (x 0-80)                                        */
    /* The shattering-stair quote: rain-glass vanish steps DESCENDING under a slow  */
    /* prismgate, lasers between the steps. The exam opens by going DOWN — the      */
    /* first light you ever climbed is the first light you now descend.             */
    /* ============================================================================ */

    /* BEAT 1 — THE THRESHOLD. Solid ground, the name, the whole spire visible. */
    { kind: 'platform', p: [-3.4, 5.3, 0], s: [4.0, 1, 4.0], mat: 'stone', glow: SLATE }, // back apron, top 5.8
    { kind: 'platform', p: [1.2, 5.5, 0], s: [7.6, 1, 4.6], mat: 'stone', glow: SLATE }, // spawn deck, top 6.0 — a threshold, not a plaza: the exam starts at the edge

    { kind: 'text', p: [-3.4, 8.6, 0], rot: [0, -Math.PI / 2, 0], text: 'WHITE LIGHT', size: 0.86, color: GOLD },
    { kind: 'text', p: [-3.4, 7.9, 0], rot: [0, -Math.PI / 2, 0], text: 'PRISM CROWN  ·  III', size: 0.28, color: DUSK },
    { kind: 'text', p: [-3.4, 7.35, 0], rot: [0, -Math.PI / 2, 0], text: 'every lesson, in every colour, all at once', size: 0.24, color: HOT },
    { kind: 'deco', kindOf: 'arch', p: [6.8, 10.7, 0], s: [1.4, 1.1, 12.0], mat: 'obsidian', tint: 0xff7ad9 },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 8.4, 5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 8.4, -5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [2.0, 10.1, 0], color: 0xfff0d0, intensity: 10, distance: 24 },
    { kind: 'text', p: [8.4, 8.2, -3.2], rot: [0, -Math.PI / 2, 0], text: 'NEON REMEMBERED', size: 0.44, color: GOLD },
    { kind: 'text', p: [8.4, 7.65, -3.2], rot: [0, -Math.PI / 2, 0], text: 'the stair shatters  ·  it always did', size: 0.22, color: DUSK },

    /* BEAT 2 — THE RAIN-GLASS DESCENT. The stepping-stone stair is gone: three
       shattering tiles now hang a real jump apart (3.9 / 4.0 / 4.5 m, all
       descending, all inside the run-safe envelope), with the neon dojo's own
       light between them: a bar to jump at +0.55 over the second tile and a
       bar to crouch at +1.75 on the third, both on the tiles' 3.0/3.5 s duty.
       The alphabet check now costs commitment — miss a beat and the glass is
       gone before the next leap. */
    { kind: 'platform', p: [10.6, 4.7, 1.2], s: [3.4, 1, 3.8], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.90 off the spawn deck, -0.8, top 5.2 — the last solid step
    { kind: 'vanish', p: [18.3, 4.2, 1.6], s: [4.0, 1, 3.2], mat: 'panel', cycle: { on: 2.1, off: 1.0, warn: 0.4, phase: 0 } }, // gap 4.00, -0.5, top 4.7
    { kind: 'laser', a: [19.9, 5.3, -0.4], b: [19.9, 5.3, 3.6], radius: 0.12, color: HOT, cycle: { on: 1.7, off: 1.4, warn: 0.4, phase: 0.3 } }, // 0.55 over v2's deck — jump the bar on the tile
    { kind: 'vanish', p: [26.6, 3.4, -0.8], s: [3.6, 1, 3.4], mat: 'panel', cycle: { on: 2.1, off: 1.0, warn: 0.4, phase: 0.7 } }, // gap 4.50, -0.8, top 3.9
    { kind: 'laser', a: [28.2, 5.65, -2.5], b: [28.2, 5.65, 0.9], radius: 0.12, color: HOT, cycle: { on: 2.0, off: 1.5, warn: 0.4, phase: 0.6 } }, // 1.75 over v3 — crouch on the blink
    {
      kind: 'mover',
      p: [31.8, 3.2, 0.4],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      motion: { type: 'linear', to: [37.4, 2.9, -0.4], period: 5.0, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // the one slab that does NOT shatter — gap 1.70 to board, top 3.7 -> 3.4

    /* BEAT 3 — GATE 1: THE SLOW DOOR. The exam's only teaching-tier gate: seq
       [6,4,2,0] runs the spectrum BACKWARD (you are descending — violet lives
       at the top of the ladder), dwell 2.0 s, travel 1.5 s, period 14.0.
       Worst cyclic hop is the wrap 0->6: 6 slots x 1.567 m = 9.40 m / 1.5 s =
       6.27 m/s, under the 6.4 law. Sill = court top 3.2 (p.y 5.2 = 3.2 + 2.0).
       Whole court before the plane is all-phase-safe staging; flank ledge
       right, outside the lattice edge z 5.5. CP1 on the staging deck. */
    { kind: 'platform', p: [43.9, 2.7, 0], s: [10.2, 1, 10.4], mat: 'stone', glow: SLATE }, // flush with the mover's far pose — gate court, top 3.2
    { kind: 'prismgate', p: [47.2, 5.2, 0], s: [0.4, 4.0, 11.0], seq: [6, 4, 2, 0], dwell: 1.85, travel: 1.65, period: 14 },
    { kind: 'text', p: [42.0, 5.6, -3.6], rot: [0, -Math.PI / 2, 0], text: 'THE SPECTRUM RUNS DOWN', size: 0.36, color: GOLD },
    { kind: 'text', p: [42.0, 5.05, -3.6], rot: [0, -Math.PI / 2, 0], text: 'violet high  ·  red low  ·  same door', size: 0.22, color: DUSK },
    { kind: 'light', p: [44.6, 6.0, 0], color: MINT, intensity: 9, distance: 18 },

    /* THE METRONOME TOWER (§4 channel 6 court furniture): the notched spectrum
       ladder from rainbow-1, red at the bottom, violet at the top — every notch
       0.14 m (glare: hue on trim <= 0.3 m). */
    { kind: 'deco', kindOf: 'post', p: [42.6, 4.9, 6.6], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 3.65, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 4.10, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 4.55, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 5.00, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 5.45, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 5.90, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [42.6, 6.35, 6.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },

    /* BEAT 4 — OUT OF THE GLASS. One shattering tile a 4.3 m leap off the
       court, the two-beam crouch rack (the dojo's parting shot), then the
       long way out: a 5.6 m sprint to the last tile and a bar jumped
       mid-flight on the 4.2 m exit. The brisk-tile carpet is gone. */
    { kind: 'vanish', p: [54.5, 2.4, 1.6], s: [2.4, 1, 3.0], mat: 'panel', cycle: { on: 2.1, off: 1.0, warn: 0.4, phase: 0.25 } }, // gap 4.30, -0.3, top 2.9
    { kind: 'platform', p: [58.8, 1.9, 1.0], s: [4.2, 1, 3.8], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.00 — the rack landing, top 2.4
    {
      kind: 'lasergrid',
      a: [58.6, 4.15, -1.4],
      b: [58.6, 4.15, 3.4],
      count: 2,
      spacing: 2.0,
      offset: [1, 0, 0], // beams at x 57.6 and 59.6, both 1.75 m up — crouch through
      stagger: 0.6,
      radius: 0.11,
      color: HOT,
      cycle: { on: 1.6, off: 1.5, warn: 0.4, phase: 0.2 },
    },
    { kind: 'vanish', p: [68.0, 1.4, 0.8], s: [3.0, 1, 2.8], mat: 'panel', cycle: { on: 2.1, off: 1.0, warn: 0.4, phase: 0 } }, // gap 5.60 sprint out of the rack, -0.5, top 1.9
    { kind: 'laser', a: [72.6, 2.45, -1.0], b: [72.6, 2.45, 2.6], radius: 0.12, color: HOT, cycle: { on: 1.7, off: 1.4, warn: 0.4, phase: 0 } }, // 0.55 over the exit line, mid-gap — jump out THROUGH the blink

    /* BEAT 5 — THE BASIN RIM (CP2). The glass ends on stone; below, the flood. */
    { kind: 'platform', p: [77.5, 1.5, 0], s: [7.6, 1, 4.4], mat: 'stone', glow: SLATE, stripe: true }, // gap 4.20, +0.1 — CP2, top 2.0
    { kind: 'text', p: [74.2, 4.2, -3.4], rot: [0, -Math.PI / 2, 0], text: 'THE RISING TIDE', size: 0.44, color: GOLD },
    { kind: 'text', p: [74.2, 3.65, -3.4], rot: [0, -Math.PI / 2, 0], text: 'the tide sets the pace  ·  the rings set the feet', size: 0.22, color: DUSK },
    { kind: 'light', p: [77.0, 4.4, 0], color: MINT, intensity: 9, distance: 16 },

    /* ============================================================================ */
    /* MOVEMENT II — THE RISING TIDE (x 80-160)                                     */
    /* foundry-3's flood quoted: risinglava in a basin of island slabs while LOW    */
    /* blooms pulse across them. The tide arms at t 15, climbs at 0.08 m/s and      */
    /* parks at 0.7 — 0.9 m under the lowest island top (1.6) and 0.5 under the     */
    /* coin perch (1.2): it takes the AIR, never an authored surface, exactly       */
    /* the temple-3 rising-floor convention.                                        */
    /* Every emitter deck contains its rmax circle; one 6.0 s clock for all three.  */
    /* ============================================================================ */

    /* THE TIDE. `rising.from` matches p.y + s.y/2 = -5.0 (temple-3 convention);
       basin x 78..162 spans the whole movement and nothing else. */
    { kind: 'risinglava', p: [120, -6.5, 0], s: [84, 3, 26], rising: { from: -5.0, to: 0.7, speed: 0.08, delay: 15 } },

    /* BEAT 6 — FIRST ISLAND + THE GREEN RING. Band 3 (4.2 m/s — the class
       rainbow-2 RED named on its sign), rmax 3.2: life 0.762 s >= 0.74, period
       6.0 >= 0.762 + 1.2. Circle x 82.2..88.6 = the deck exactly. */
    { kind: 'platform', p: [85.4, 1.1, 1.0], s: [6.4, 1, 6.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.20, -0.4, top 1.6
    { kind: 'bloom', p: [85.4, 1.6, 1.0], rmax: 3.2, band: 3, period: 6.0 },

    /* BEAT 7 — GLASS OVER THE FLOOD. A 3.1 m hop up to the shelf, then the
       shelf's whole reason to exist: a 6.4 m falling sprint clean over the
       water onto the second ring's island — blue this time (3.0 m/s), half a
       phase against the green: one clock, two speeds, and the tide under the
       whole flight. The shattering stepping tile between them is gone. */
    { kind: 'platform', p: [93.5, 2.4, -1.8], s: [3.6, 1, 3.6], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.10, +1.3 — the shelf that keeps the basin from reading flat, top 2.9
    { kind: 'platform', p: [105.2, 1.3, 0.6], s: [7.0, 1, 7.0], mat: 'stone', glow: SLATE }, // gap 6.40 sprint, -1.1 — bloom island 2, top 1.8
    { kind: 'bloom', p: [105.2, 1.8, 0.6], rmax: 3.5, band: 4, period: 6.0, phase: 0.5 }, // circle 101.7..108.7 = the deck exactly

    /* BEAT 8 — GLAZED + COIN 1. The ice shelf beside the second ring; the coin
       perch hangs off its south rail over the tide — two ring-reads out and
       two back, and the tide underneath the whole errand. */
    { kind: 'ice', p: [113.8, 2.1, 2.4], s: [3.6, 1, 3.8] }, // gap 3.30, +0.8, top 2.6
    { kind: 'platform', p: [112.6, 0.85, 7.0], s: [2.6, 0.7, 2.6], mat: 'panel', glow: SLATE, stripe: true }, // COIN 1 perch, top 1.2 — walk off the ice rail, jump back up
    { kind: 'text', p: [109.2, 4.4, 2.4], rot: [0, -Math.PI / 2, 0], text: 'GLAZED', size: 0.32, color: FROST },

    /* BEAT 9 — THE REST (CP3), barely: a perch, not a plaza. A 2.9 m hop
       boards the shuttle over the widest water. */
    { kind: 'platform', p: [118.4, 1.9, 0.4], s: [3.2, 1, 3.6], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.20 off the ice, -0.2 — CP3, top 2.4
    {
      kind: 'mover',
      p: [124.4, 2.0, -1.2],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      motion: { type: 'linear', to: [130.6, 2.4, 1.0], period: 5.5, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // gap 1.30 to board, top 2.5 -> 2.9 — the ferry across the deep pool

    /* BEAT 10 — THE THIRD RING, UP A SHELF. Green again but the island sits
       0.9 above the ferry — the height jolt that keeps the basin from reading
       as a corridor. Circle x 133.2..140.0 in deck 132.9..140.3. */
    { kind: 'platform', p: [136.6, 2.8, 0.2], s: [6.8, 1, 6.8], mat: 'stone', glow: SLATE }, // ride the ferry to its far pose, then hop +0.4 — top 3.3, deck = the ring's circle exactly
    { kind: 'bloom', p: [136.6, 3.3, 0.2], rmax: 3.4, band: 3, period: 6.0, phase: 0.25 }, // life 0.810 s
    { kind: 'text', p: [133.0, 5.6, -3.0], rot: [0, -Math.PI / 2, 0], text: 'ONE CLOCK  ·  THREE RINGS', size: 0.30, color: GOLD },

    /* BEAT 11 — THE SPRINT SHELF. One shattering tile down, then the movement's
       required sprint: a 9.6 m runway and a 5.6 m FLAT gap (sprint safe 6.4,
       runway law >= 8 m). The tide below is the reason to commit. */
    { kind: 'vanish', p: [144.4, 2.5, -1.2], s: [2.8, 1, 3.0], mat: 'panel', cycle: { on: 1.9, off: 0.9, warn: 0.4, phase: 0.5 } }, // gap 3.00, -0.3, top 3.0 — lands flush on the runway's lip
    { kind: 'platform', p: [149.4, 2.7, 0.6], s: [9.6, 1, 5.4], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.40, +0.2 — THE RUNWAY, top 3.2
    { kind: 'text', p: [146.2, 5.0, -2.6], rot: [0, -Math.PI / 2, 0], text: 'RUN THE LIGHT OUT', size: 0.34, color: GOLD },
    { kind: 'platform', p: [163.4, 2.9, 0], s: [7.2, 1, 8.6], mat: 'stone', glow: SLATE }, // SPRINT gap 5.60 flat — CP4 court, top 3.4

    /* ============================================================================ */
    /* MOVEMENT III — THE SPIRE WIND (x 160-240)                                    */
    /* spire-3 quoted: an ice arc over nothing in cross-shear wind (the shear       */
    /* FLIPS mid-arc), four censers swinging ACROSS the arc — cross-route per       */
    /* contract law 2, every blade bottom 0.4-0.55 clear of its slab top — then     */
    /* the updraft shaft and the slots:'y' gate from rainbow-1 IV, at exam tempo.   */
    /* Court clock: pendulums 3.4 / 2.55 / 5.1 / 3.4 s + gate 10.2 s, LCM 10.2 s.   */
    /* ============================================================================ */

    /* BEAT 12 — THE ARC. Five glazed slabs curving z +2.4 -> +5.2 -> +1.0 while
       the shear shoves +z for the first half and -z for the second — the sign
       says which half you are in; the curve is the second channel. Every slab
       is a pane now, not a landing: ~3 m wide, a full 2.9-3.2 m rising jump
       apart, in wind, on ice, under the censers. */
    { kind: 'text', p: [166.6, 6.4, -3.6], rot: [0, -Math.PI / 2, 0], text: 'THE SPIRE WIND', size: 0.44, color: GOLD },
    { kind: 'text', p: [166.6, 5.85, -3.6], rot: [0, -Math.PI / 2, 0], text: 'the wind flips at the crown of the arc', size: 0.22, color: DUSK },
    { kind: 'ice', p: [169.4, 3.6, 2.4], s: [3.2, 1, 3.6] }, // gap 0.80, +0.7, top 4.1
    { kind: 'ice', p: [175.4, 4.4, 4.6], s: [3.0, 1, 3.4] }, // gap 2.90, +0.8, top 4.9
    { kind: 'ice', p: [181.6, 5.2, 5.2], s: [3.0, 1, 3.4] }, // gap 3.20, +0.8, top 5.7
    { kind: 'ice', p: [187.6, 6.0, 3.6], s: [2.8, 1, 3.2] }, // gap 3.10, +0.8, top 6.5
    { kind: 'ice', p: [193.6, 6.7, 1.0], s: [2.8, 1, 3.2] }, // gap 3.20, +0.7, top 7.2
    { kind: 'wind', p: [174.0, 7.6, 3.0], s: [16, 5, 12], dir: [0, 0, 1], power: 10, color: FROST }, // x 166..182 — shoves OUT (+z)
    { kind: 'wind', p: [190.0, 8.4, 3.0], s: [14, 5, 12], dir: [0, 0, -1], power: 12, color: FROST }, // x 183..197 — shoves BACK (-z), harder

    /* THE CENSERS — four blades ACROSS the arc (axis [1,0,0]: swing plane is
       the z lane, thin in x). Blade bottoms clear their slab tops by 0.40-0.55
       (kills a standing head, never the floor — geomcheck's clipping bar).
       Periods 3.4 / 2.55 / 5.1 / 3.4 — all divide the gate's 10.2 s. */
    { kind: 'pendulum', p: [175.4, 8.6, 4.6], len: 2.6, amp: 0.85, period: 3.4, phase: 0.0, axis: [1, 0, 0], blade: { w: 2.2, h: 1.1, d: 0.4 } }, // bottom 5.45, slab top 4.9
    { kind: 'pendulum', p: [181.6, 10.15, 5.2], len: 2.9, amp: 0.8, period: 2.55, phase: 0.3, axis: [1, 0, 0], blade: { w: 2.0, h: 1.1, d: 0.38 } }, // bottom 6.70, slab top 5.7 — the tallest read on the arc
    { kind: 'pendulum', p: [187.6, 10.3, 3.6], len: 2.8, amp: 0.9, period: 5.1, phase: 0.6, axis: [1, 0, 0], blade: { w: 2.4, h: 1.2, d: 0.42 } }, // bottom 6.90, slab top 6.5
    { kind: 'pendulum', p: [193.2, 11.2, 1.0], len: 3.0, amp: 0.75, period: 3.4, phase: 0.5, axis: [1, 0, 0], blade: { w: 2.2, h: 1.2, d: 0.4 } }, // bottom 7.60, slab top 7.2

    /* BEAT 13 — THE LANDING (CP5), then pad or lift, your pick — the rainbow-1
       shaft quoted at height. Pad maths (rainbow-1's proven pair): power 5.0,
       dy 3.24 to the gallery; walk entry lands 4.11 m out, held-sprint 9.93 m;
       the gallery spans 3.95..11.85 m from the launch lip. No entry speed
       misses. The lift is the patient line on the same wall. */
    { kind: 'platform', p: [200.2, 7.5, 0.3], s: [6.8, 1, 5.0], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.80, +0.8 — CP5, top 8.0
    { kind: 'jumppad', p: [202.2, 8.08, 1.4], s: [2.6, 0.16, 2.6], power: 5.0, dir: [0, 1, 0] },
    {
      kind: 'mover',
      p: [205.4, 7.9, -2.4],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      motion: { type: 'elevator', to: [208.8, 10.9, -2.4], speed: 2.0, dwell: 0.4, hold: 2.0 },
    }, // board at top 8.4, ride to 11.4 — the patient line
    { kind: 'wind', p: [209.0, 13.4, 1.2], s: [7, 8, 6], dir: [0, 1, 0], power: 9, color: FROST }, // the updraft that fills the shaft
    { kind: 'platform', p: [208.45, 10.9, 1.4], s: [7.9, 1, 4.0], mat: 'stone', glow: SLATE, stripe: true }, // THE GALLERY, top 11.4 — spans 3.95..11.85 from the pad lip, swallows the 4.11..9.93 entry band

    /* BEAT 14 — THE CLIMBING DOOR, EXAM TEMPO (slots:'y'). Same grammar as
       rainbow-1 BEAT 17 — seq [1,3,5] climbs the ladder, period 10.2 s — but
       now it shares its court with four censers. The crossing is the house
       3.4 m at +0.9 through the MIDDLE window (h 3.6 swallows the whole arc).
       Flank ledge rides the shaft wall outside the lattice (z 5.6). */
    { kind: 'prismgate', p: [213.6, 13.9, 1.4], s: [0.4, 7.0, 6.0], slots: 'y', seq: [1, 3, 5], dwell: 2.4, travel: 1.0, period: 10.2, window: { w: 1.6, h: 3.6 } },
    { kind: 'platform', p: [217.5, 11.8, 1.4], s: [3.4, 1, 3.4], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.40, +0.9 THROUGH the middle window, top 12.3
    { kind: 'text', p: [210.4, 15.4, -1.6], rot: [0, -Math.PI / 2, 0], text: 'THE DOOR STILL CLIMBS', size: 0.30, color: GOLD },

    /* BEAT 15 — DOWN TO THE ENGINE. A panel step, then twin counter-phased
       shuttles (pick a lane — they land either side of the Engine's door). */
    { kind: 'platform', p: [224.0, 11.4, -0.6], s: [3.2, 1, 3.6], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.20, -0.4, top 11.9
    {
      kind: 'mover',
      p: [228.6, 10.6, -0.6],
      s: [3.2, 1, 3.2],
      mat: 'metal',
      motion: { type: 'linear', to: [235.4, 10.1, 0.6], period: 5.0, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // NORTH lane — gap 1.90 to board, top 11.1 -> 10.6
    {
      kind: 'mover',
      p: [228.6, 10.6, -5.8],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      motion: { type: 'linear', to: [235.4, 10.1, -4.6], period: 5.0, phase: 0.5, ease: 'sine', dwell: 0.5 },
    }, // SOUTH lane — counter-phased: one of the two is always inbound

    /* ============================================================================ */
    /* MOVEMENT IV — THE TEMPLE ENGINE (x 240-320)                                  */
    /* temple-3's machine deck quoted: rotors, saws, a BACKWARD belt, crushers —    */
    /* the densest dressing in the stage, and the read is the temple's own: only    */
    /* what glows HOT or swings ends the run. The overlay is the double bloom —     */
    /* one LOW (yellow, 4.2 m/s) + one HIGH (indigo, 3.0 m/s) on ONE 6 s clock.     */
    /* Court clock: LCM(3, 1.5, 4, 2, 6) = 12.0 s.                                  */
    /* ============================================================================ */

    /* BEAT 16 — THE ENGINE DOOR (CP6) — a landing pad, then a 3.0 m flat jump
       onto the helpful belt: the Engine takes no walk-ins. */
    { kind: 'platform', p: [240.7, 10.1, 0], s: [5.4, 1, 5.0], mat: 'stone', glow: SLATE }, // gap 1.00 off either shuttle — CP6, top 10.6
    { kind: 'text', p: [239.0, 13.3, -3.8], rot: [0, -Math.PI / 2, 0], text: 'THE TEMPLE ENGINE', size: 0.44, color: GOLD },
    { kind: 'text', p: [239.0, 12.75, -3.8], rot: [0, -Math.PI / 2, 0], text: 'four things here can kill you  ·  all four glow', size: 0.22, color: DUSK },
    { kind: 'light', p: [242.0, 13.6, 0], color: MINT, intensity: 9, distance: 18 },

    /* BEAT 17 — THE GAUNTLET: a belt that HELPS (into the bar's timing, which
       is the trap), a prayer bar, a saw through a slot, a windmill. */
    { kind: 'conveyor', p: [249.4, 10.1, 0.4], s: [6.0, 1, 4.8], dir: [1, 0, 0], power: 3, mat: 'conveyor' }, // gap 0.40, flat, top 10.6 — the helpful belt
    { kind: 'rotor', p: [250.4, 11.9, 0.4], style: 'bar', arms: 2, len: 2.2, thick: 0.4, period: 3.0, phase: 0, axis: [0, 1, 0] }, // bar 1.3 over the belt — jump it as it comes round
    { kind: 'platform', p: [258.7, 9.7, 0.4], s: [7.4, 1, 4.4], mat: 'metal', glow: SLATE }, // gap 2.60, -0.4 — the machine deck sags under its own iron, top 10.2
    { kind: 'saw', p: [255.8, 9.1, 0.4], style: 'saw', len: 1.9, thick: 0.26, period: 1.5, phase: 0, axis: [0, 0, 1], mount: 0 }, // 0.8 m of tooth up through the flagstones
    { kind: 'rotor', p: [259.0, 15.4, 0.4], style: 'windmill', arms: 2, len: 4.4, thick: 0.4, period: 4.0, phase: 0.25, axis: [0, 0, 1] }, // lowest 10.8 — 0.6 over the deck, 0.8 clear of the crusher block
    { kind: 'speedpad', p: [261.4, 10.28, 0.4], s: [2.4, 0.16, 2.4], dir: [1, 0, 0], power: 4 }, // the launch INTO the backward belt

    /* BEAT 18 — THE BACKWARD BELT (CP7 on the side slab). Belt power 4.5
       against you (half authority — refusing the ride is always possible),
       two crushers over it on the court's 3 s beat, half a phase apart. */
    { kind: 'conveyor', p: [268.4, 9.7, 0.4], s: [11.0, 1, 4.6], dir: [-1, 0, 0], power: 4.5, mat: 'conveyor' }, // gap 0.90, -0.4, top 10.2 — AGAINST you
    { kind: 'crusher', p: [265.8, 14.2, 0.4], s: [3.2, 1.3, 4.4], axis: [0, -1, 0], travel: 3.2, period: 3.0, phase: 0, dwell: 0.6, mat: 'metal' }, // head parks at 13.55, strikes to 10.35
    { kind: 'crusher', p: [270.6, 14.4, 0.4], s: [3.0, 1.3, 4.4], axis: [0, -1, 0], travel: 3.4, period: 3.0, phase: 0.5, dwell: 0.6, mat: 'metal' }, // counter-beat — one gap is always walking
    { kind: 'platform', p: [266.4, 9.9, 5.0], s: [3.6, 1, 3.2], mat: 'stone', glow: SLATE, stripe: true }, // CP7 side slab, top 10.4 — off the belt, out of both heads
    { kind: 'text', p: [263.4, 12.6, 5.2], rot: [0, -Math.PI / 2, 0], text: 'THE BELT IS STILL A CHOICE', size: 0.28, color: GOLD },

    /* BEAT 19 — THE DIP. A saw guards the hop off the belt; the deck drops to
       9.4 under a flat hammer disc (duck), and the only way back up is light. */
    { kind: 'saw', p: [275.8, 9.1, 0.4], style: 'saw', len: 1.9, thick: 0.26, period: 2.0, phase: 0.4, axis: [0, 0, 1], mount: 0 }, // teeth to 11.0, in the gap itself
    { kind: 'platform', p: [278.9, 8.9, 0], s: [7.2, 1, 4.6], mat: 'stone', glow: SLATE, stripe: true }, // gap 1.40, -0.8 — the dip, top 9.4
    { kind: 'rotor', p: [280.6, 11.0, 0], style: 'hammer', arms: 1, len: 2.0, thick: 0.5, period: 4.0, phase: 0.5, axis: [0, 1, 0] }, // disc 10.75..11.25 — crouch head 10.45 clears by 0.30
    { kind: 'jumppad', p: [283.6, 9.48, 0], s: [2.8, 0.16, 2.8], power: 5.0, dir: [0, 1, 0] }, // the way up: dy 3.24 to the bloom court

    /* BEAT 20 — THE DOUBLE BLOOM (CP8). One clock, two grammars: yellow LOW
       (4.2 m/s — jump) at half a phase against indigo HIGH (3.0 m/s — duck).
       Circles: B4 x 285.8..293.0 / z -4.8..2.4, B5 x 290.2..298.2 / z -2..6 —
       both inside the court (285.4..298.4, z -4.9..6.1). Pad entry band
       4.11..9.93 from the lip 282.25 lands 286.4..292.2 — all on the court.
       CP8 in the south-west corner: 5.49 m from B4 (floor 5.3), 6.2 from B5
       (floor 5.7). The bar rotor over the north rail ducks like the hammer. */
    { kind: 'platform', p: [291.9, 12.3, 0.6], s: [13.0, 1, 11.0], mat: 'stone', glow: SLATE }, // THE BLOOM COURT, top 12.8
    { kind: 'bloom', p: [289.4, 12.8, -1.2], rmax: 3.6, band: 2, period: 6.0, phase: 0 }, // LOW yellow ON the deck top 12.8 — life 0.857 s, band top 1.0 <= 1.1 cap
    { kind: 'bloom', p: [294.2, 12.8, 2.0], rmax: 4.0, band: 5, period: 6.0, phase: 0.5, ring: 'high' }, // HIGH indigo ON the deck top 12.8 — band 1.25..2.75, crouch 1.05 clears by 0.20
    { kind: 'rotor', p: [290.8, 14.6, 4.6], style: 'bar', arms: 2, len: 1.9, thick: 0.36, period: 3.0, phase: 0.5, axis: [0, 1, 0] }, // bar 1.6-2.0 over the deck at the north rail
    { kind: 'text', p: [286.4, 15.6, -4.6], rot: [0, -Math.PI / 2, 0], text: 'LOW ROLLS — JUMP  ·  HIGH HANGS — DUCK', size: 0.32, color: GOLD },
    { kind: 'light', p: [291.9, 15.8, 0.6], color: 0xfff0d0, intensity: 8, distance: 22 },

    /* COIN 2 — THE ORBIT. A tile circling off the court's north rail on the
       bloom clock (6 s); the coin hangs over its far sweep. Board on the near
       pass, ride out through both rings' countdowns, step back on the return. */
    {
      kind: 'mover',
      p: [300.6, 12.3, 8.4],
      s: [2.6, 1, 2.6],
      mat: 'metal',
      motion: { type: 'orbit', radius: 2.0, axis: 'y', period: 6.0, phase: 0.25 },
    }, // orbit centre — near pass at z 6.4, 0.9 m off the court's NE corner
    { kind: 'deco', kindOf: 'ring', p: [300.6, 12.4, 8.4], s: [4.6, 0.12, 4.6], mat: 'emissive', tint: GOLD }, // the lit orbit track

    /* BEAT 21 — OUT OF THE ENGINE: three narrow slats down under the last
       blades and the two-beam rack — each a real 2.6-3.0 m jump, none wider
       than a doorstep — ending short of x 319, so the White Gate's footprint
       (x 321..412) cannot reach anything in this movement. */
    { kind: 'platform', p: [302.4, 12.0, -0.8], s: [2.8, 1, 4.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 2.60, -0.3, top 12.5
    { kind: 'laser', a: [301.8, 13.05, -3.3], b: [301.8, 13.05, 1.7], radius: 0.12, color: HOT, cycle: { on: 1.6, off: 1.4, warn: 0.4, phase: 0.2 } }, // 0.55 over the step — jump
    { kind: 'rotor', p: [305.2, 17.1, -0.8], style: 'windmill', arms: 3, len: 4.2, thick: 0.4, period: 4.0, phase: 0, axis: [0, 0, 1] }, // lowest 12.7 — 0.2 over the step
    { kind: 'platform', p: [308.4, 11.6, 0.8], s: [3.2, 1, 4.0], mat: 'panel', glow: SLATE, stripe: true }, // gap 3.00, -0.4, top 12.1
    {
      kind: 'lasergrid',
      a: [308.6, 13.85, -1.5],
      b: [308.6, 13.85, 3.1],
      count: 2,
      spacing: 2.0,
      offset: [1, 0, 0], // beams at x 307.6 and 309.6, both 1.75 up — crouch out
      stagger: 0.6,
      radius: 0.11,
      color: HOT,
      cycle: { on: 1.5, off: 1.5, warn: 0.4, phase: 0.5 },
    },
    { kind: 'platform', p: [314.4, 11.2, 0], s: [3.6, 1, 4.4], mat: 'stone', glow: SLATE, stripe: true }, // gap 2.60, -0.4, top 11.7 — ends x 316.2, 4.8 short of the footprint
    { kind: 'crusher', p: [313.6, 15.0, 0], s: [3.0, 1.2, 4.6], axis: [0, -1, 0], travel: 2.6, period: 4.0, phase: 0.25, dwell: 0.5, mat: 'metal' }, // the Engine's parting stamp — strikes to 11.8, 0.1 over the step

    /* ============================================================================ */
    /* MOVEMENT V — THE SEVEN STAIR (x 320-392)                                     */
    /* Seven band steps to the spire, a gate on every step, ALL SEVEN on one 16 s   */
    /* clock in relay group 'sevenstair' (§6-2): seq [0,1,2,3,4,5,6,3] — the        */
    /* spectrum one band at a time, home through green-adjacent 3 — dwell 1.2,      */
    /* travel 0.8, phases stepping 1.4/16 so each gate's window opens 0.6 s after   */
    /* its predecessor's (overlap 0.6 >= 0.4). Worst hop 3 slots = 5.00 m / 0.8 s   */
    /* = 6.25 m/s. Every step's front 1.8 m is staging; since the difficulty     */
    /* pass the steps are 3.9-4.0 m slivers a 2.6-3.2 m rising jump apart, so    */
    /* the climb is jumped, never walked. (Gate flank ledges were                */
    /* removed on the owner's call 2026-09-16 — the sevenstair is climbed THROUGH */
    /* its windows, or not at all.)                                                */
    /* ledge outside the lattice (z +/-5.8), sides alternating. Blooms on the       */
    /* landing and summit run period 8 — court superperiod exactly 16 s.            */
    /* ============================================================================ */

    /* BEAT 22 — THE STAIR BASE (CP9) + the second metronome tower. A ledge,
       not a court: the stair starts with a 3.2 m rising jump off it. */
    { kind: 'platform', p: [321.1, 11.0, 0], s: [4.6, 1, 6.0], mat: 'stone', glow: SLATE }, // gap 2.60, -0.2 — CP9, top 11.5
    { kind: 'text', p: [318.0, 14.6, -4.2], rot: [0, -Math.PI / 2, 0], text: 'THE SEVEN STAIR', size: 0.5, color: GOLD },
    { kind: 'text', p: [318.0, 14.0, -4.2], rot: [0, -Math.PI / 2, 0], text: 'one band a step  ·  the window climbs with you', size: 0.24, color: DUSK },
    { kind: 'deco', kindOf: 'post', p: [319.6, 13.7, 4.4], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 12.45, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 12.90, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 13.35, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 13.80, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 14.25, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 14.70, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [319.6, 15.15, 4.4], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },
    { kind: 'light', p: [321.0, 14.8, 0], color: MINT, intensity: 10, distance: 20 },

    /* BEAT 23 — STEPS ONE TO THREE (RED, ORANGE, YELLOW). Rises 1.4/1.35/1.25
       over REAL gaps now — 3.2/2.6/2.6 m, each step a 3.9-4.0 m sliver with
       exactly 1.8 m of staging before its plane — so every handoff in the
       dwell chain (g0 -> g1 -> g2 at 0.6 s spacing) is bought with a rising
       jump, not a stroll. */
    { kind: 'platform', p: [328.55, 12.4, 0], s: [3.9, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 1, top 12.9, gap 3.20 +1.4
    { kind: 'prismgate', p: [328.4, 15.15, 0], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 0, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 0 } },
    { kind: 'platform', p: [335.05, 13.75, 0.2], s: [3.9, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 2, top 14.25, gap 2.60 +1.35
    { kind: 'prismgate', p: [334.9, 16.5, 0.2], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 1.4 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 1 } },
    { kind: 'platform', p: [341.6, 15.0, -0.2], s: [4.0, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 3, top 15.5, gap 2.60 +1.25
    { kind: 'prismgate', p: [341.4, 17.75, -0.2], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 2.8 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 2 } },

    /* BEAT 24 — THE MID-RELAY LANDING (CP10) + the HIGH ring that guards it.
       Indigo, rmax 3.4, period 8 (half the relay: the court repeats every
       16 s exactly). Circle x 349..355.8 / z -2..4.8, inside the landing;
       CP10 at 5.37 m >= 3.4 + 1.7. COIN 3 hangs UNDER the south rail. */
    { kind: 'platform', p: [351.95, 16.1, 0.1], s: [11.1, 1, 9.4], mat: 'stone', glow: SLATE }, // THE LANDING, top 16.6, gap 2.80 +1.1
    { kind: 'bloom', p: [352.4, 16.6, 1.4], rmax: 3.4, band: 5, period: 8.0, ring: 'high' }, // ON the landing top 16.6 (band 1.25..2.75 over deck) — duck it mid-relay, life 1.133 s
    { kind: 'text', p: [347.2, 19.4, -4.4], rot: [0, -Math.PI / 2, 0], text: 'HALF THE CLIMB  ·  ALL THE CLOCK', size: 0.30, color: GOLD },
    { kind: 'platform', p: [347.9, 14.65, -7.2], s: [2.6, 0.5, 2.2], mat: 'panel', glow: SLATE, stripe: true }, // coin stair, top 14.9 — walk off the south rail
    { kind: 'platform', p: [353.6, 13.65, -7.6], s: [2.6, 0.5, 2.2], mat: 'panel', glow: SLATE, stripe: true }, // COIN 3 ledge, top 13.9, a 3.1 m falling jump on — the relay thunders overhead
    { kind: 'light', p: [350.9, 19.6, 0], color: 0xfff0d0, intensity: 8, distance: 22 },

    /* BEAT 25 — THE SPRINT AND STEPS FOUR TO SEVEN (GREEN, BLUE, INDIGO,
       VIOLET). The landing is an 11.1 m runway; the 5.9 m gap to step 4 is
       the stage's second required sprint, near-FLAT (+0.2). Then the last
       four gates on 3.9 m slivers 2.8 m apart, cp11 on the 8.8 m violet
       runway 5.8 m before gate 6's plane — the race is pinned there and the
       White Gate arms 8 s later. */
    { kind: 'platform', p: [365.35, 16.3, 0.4], s: [3.9, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 4, top 16.8 — SPRINT gap 5.90 flat
    { kind: 'prismgate', p: [365.2, 19.05, 0.4], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 4.2 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 3 } },
    { kind: 'platform', p: [372.05, 17.6, -0.4], s: [3.9, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 5, top 18.1, gap 2.80 +1.3
    { kind: 'prismgate', p: [371.9, 20.35, -0.4], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 5.6 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 4 } },
    { kind: 'platform', p: [381.2, 18.9, 0], s: [8.8, 1, 8.7], mat: 'stone', glow: SLATE }, // step 6 — the CP11 runway, top 19.4, gap 2.80 +1.3
    { kind: 'prismgate', p: [383.8, 21.65, 0], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 7.0 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 5 } },
    { kind: 'text', p: [377.0, 22.8, -4.2], rot: [0, -Math.PI / 2, 0], text: 'THE LIGHT CLIMBS — SO DO YOU', size: 0.36, color: GOLD },
    { kind: 'platform', p: [389.05, 20.2, 0.2], s: [3.9, 1, 8.7], mat: 'stone', glow: SLATE, stripe: true }, // step 7, top 20.7, gap 1.50
    { kind: 'prismgate', p: [388.9, 22.95, 0.2], s: [0.4, 4.5, 11.6], seq: [0, 1, 2, 3, 4, 5, 6, 3], dwell: 1.1, travel: 0.9, period: 16, phase: 8.4 / 16, window: { w: 1.6, h: 2.6 }, relay: { group: 'sevenstair', index: 6 } },

    /* ============================================================================ */
    /* CODA — THE WHITE GATE (x 392-413)                                            */
    /* The floor of white light. A Y-axis chase per the temple-3 collapse doctrine  */
    /* — the axis is load-bearing: chase.js kill depth points DOWN into empty sky,  */
    /* and the footprint (x 321..412, z -22..22) starts past movement IV's last     */
    /* surface (315.9), so it cannot touch a player still in the Engine at any      */
    /* clock value. Arms t = 140 (cp11 clock 132), climbs 1.6 m/s, takes the base   */
    /* court (11.5) at 168.4 and the summit (22.0) at 175.0, and parks at 22.5 —    */
    /* 0.8 m under the White Gate floor (23.3), the one surface it never takes.     */
    /* Glare §3: the front's read is a <= 0.4 m IVORY leading edge with a HOT       */
    /* thread over a dark smoke volume — the deco below builds exactly that at      */
    /* the gate mouth; the scene itself stays dark.                                 */
    /* ============================================================================ */

    {
      kind: 'chase',
      axis: 'y',
      from: -34,
      to: 22.5,
      speed: 1.6,
      delay: 140,
      mat: 'void',
      p: [366.5, 0, 0],
      s: [91, 4, 44],
      color: HOT,
    },

    /* BEAT 26 — THE SUMMIT. The last HIGH ring (violet — the slowest, deepest
       band) guards the approach: crouch under it with the light rising at
       your back. Circle x 392.5..399.7 / z -3.6..3.6, inside the court. */
    { kind: 'platform', p: [396.1, 21.5, 0], s: [7.2, 1, 7.2], mat: 'stone', glow: SLATE }, // THE SUMMIT, top 22.0, gap 1.50 — deck = the violet ring's circle exactly
    { kind: 'bloom', p: [396.1, 22.0, 0], rmax: 3.6, band: 6, period: 8.0, phase: 0.5, ring: 'high' }, // ON the summit top 22.0 (band 1.25..2.75 over deck) — life 1.2 s, duck the deepest colour
    { kind: 'text', p: [393.2, 25.0, -4.4], rot: [0, -Math.PI / 2, 0], text: 'WHITE IS ALL SEVEN', size: 0.36, color: GOLD },

    /* BEAT 27 — THE WHITE GATE ITSELF. A 2.6 m rising leap off the summit,
       THROUGH the last light's blink mid-gap — and the door is just a door:
       IVORY frame, HOT thread, dark smoke body. Step through white into the
       violet finish. */
    { kind: 'platform', p: [404.6, 22.8, 0], s: [4.6, 1, 6.4], mat: 'stone', glow: SLATE, stripe: true }, // THE WHITE GATE floor, top 23.3, gap 2.60, +1.3
    { kind: 'laser', a: [401.2, 23.85, -4.0], b: [401.2, 23.85, 4.4], radius: 0.12, color: HOT, cycle: { on: 1.6, off: 1.4, warn: 0.4, phase: 0 } }, // 0.55 over the floor's plane, hanging in the gap — the first light you ever jumped, one last time, jumped in flight
    { kind: 'deco', kindOf: 'screen', p: [404.6, 26.4, -5.6], s: [0.5, 6.0, 2.0], mat: 'obsidian', tint: SMOKE }, // dark volumetric body, south rib
    { kind: 'deco', kindOf: 'screen', p: [404.6, 26.4, 5.6], s: [0.5, 6.0, 2.0], mat: 'obsidian', tint: SMOKE }, // north rib
    { kind: 'deco', kindOf: 'arch', p: [404.6, 28.6, 0], s: [1.6, 1.2, 12.0], mat: 'obsidian', tint: SMOKE }, // the smoke lintel
    { kind: 'deco', kindOf: 'rail', p: [404.6, 27.6, 0], s: [0.1, 0.35, 9.6], mat: 'emissive', tint: IVORY }, // the <= 0.4 m luminous leading edge
    { kind: 'deco', kindOf: 'rail', p: [404.6, 27.38, 0], s: [0.06, 0.06, 9.6], mat: 'emissive', tint: HOT }, // the HOT thread under it
    { kind: 'text', p: [400.6, 25.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE WHITE GATE', size: 0.5, color: IVORY },

    /* BEAT 28 — FINISH. Violet 0xd9b6ff, used for nothing else all game. */
    { kind: 'platform', p: [411.6, 24.0, 0], s: [4.2, 1, 5.6], mat: 'obsidian', glow: FINISH, stripe: true }, // gap 2.60, +1.2 — FINISH, top 24.5: the last jump of the game is a real one
    { kind: 'deco', kindOf: 'pillar', p: [409.9, 27.4, 4.9], s: [1.5, 6.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [409.9, 27.4, -4.9], s: [1.5, 6.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [413.2, 26.9, 0], s: [0.7, 3.2, 0.7], mat: 'emissive', tint: FINISH },
    { kind: 'text', p: [406.8, 27.2, 0], rot: [0, -Math.PI / 2, 0], text: 'WHITE LIGHT', size: 0.5, color: FINISH },
    { kind: 'light', p: [409.9, 28.0, 0], color: FINISH, intensity: 20, distance: 36 },

    /* ============================================================================ */
    /* DRESSING — all of it at |z| >= 12, above y 26 or below y -8: out of every    */
    /* play corridor, no flat lit top edges, luminance at distant-scenery levels.   */
    /* The seven-band sky arc from the hub is visible again here, far south of      */
    /* the coda — the world you started under, seen from its crown.                 */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [90, -18, 28], s: [8, 32, 8], count: 7, spread: [220, 20, 22], seed: 7103, tint: 0x8f86a8 },
    { kind: 'deco', kindOf: 'monolith', p: [280, -16, -30], s: [10, 36, 10], count: 7, spread: [210, 24, 24], seed: 7207, tint: 0x7d739c },
    { kind: 'deco', kindOf: 'shard', p: [190, 6, 22], s: [2.6, 8.0, 2.6], count: 6, spread: [240, 18, 14], seed: 7331, tint: 0xbfb3e0 },
    { kind: 'deco', kindOf: 'pillar', p: [140, -10, -20], s: [1.8, 22.0, 1.8], count: 8, spread: [280, 12, 10], seed: 7411, tint: 0x6c6288 },
    { kind: 'deco', kindOf: 'cloud', p: [170, -28, 0], s: [24, 3.2, 24], count: 14, spread: [360, 10, 110], seed: 7523, scale: 2.2, tint: 0xffffff },
    { kind: 'deco', kindOf: 'cloud', p: [200, -46, 0], s: [32, 4.0, 32], count: 10, spread: [380, 12, 140], seed: 7649, scale: 2.8, tint: 0xe6ecf8 },

    /* Path lights, one per movement — cool and dim, the hazards carry the hue. */
    { kind: 'light', p: [24, 8.2, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [110, 6.0, 0], color: 0xfff0d0, intensity: 7, distance: 26 },
    { kind: 'light', p: [182, 9.6, 3.4], color: FROST, intensity: 8, distance: 26 },
    { kind: 'light', p: [262, 13.8, 0.4], color: 0xfff0d0, intensity: 8, distance: 26 },
    { kind: 'light', p: [368, 22.4, 0], color: 0xfff0d0, intensity: 8, distance: 28 },
  ],
};
