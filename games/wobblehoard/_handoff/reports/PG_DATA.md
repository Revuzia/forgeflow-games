# PG_DATA running report (the world as data: places, life tables, quests, their text, and the data probe)

Brief: `_handoff/briefs/PG_DATA.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_data/`.
Started 2026-11-16 by a fresh engineer (no earlier PG_DATA report existed). Baseline: `npx tsc --noEmit -p tsconfig.json` clean (exit 0, 1.9 s) at HEAD f0d24138.

## Status table (update after every step)
| Step | What | State |
|---|---|---|
**State at engineer 2's stop (2026-11-16): S0 DONE and S1's data DONE.** `npx tsc --noEmit -p tsconfig.json` clean;
`node _harness/probe_pg_data.ts` **exit 0, every row ok** (T6, DT-01 Home + Hearthlog wide + tall at 0 problems, DT-02..DT-16); DT-01 for the eight
S2 / S3 places prints `info ... PENDING its slice` with their problem counts (their tall layouts are a first draft: S2 / S3 work, not done).

| Step | What | State |
|---|---|---|
| 1 | `src/data/life.ts` id tables and tables | DONE (engineer 1); re-checked against LIFE by engineer 2 (step C) |
| 2 | `src/data/places.ts` | DONE (engineer 1); data model re-checked against PB 6 (step C) |
| 3 | `src/data/place_<id>.ts` x 10 | Home and Hearthlog DONE and re-checked value by value (step B), one cabin cell fixed (step D); S2 / S3: wide as written, TALL = FIRST DRAFT (their slice) |
| 4 | `src/data/quests.ts` | DONE (engineer 1); all 110 rules read back against QUESTS 6 (steps B, E) |
| 5 | `src/data/journal_text.ts` | DONE (engineer 1); DT-02 / DT-08 pass; S1 copy squirt-free (step C) |
| 6 | `_harness/name_gate.ts` | DONE (engineer 1); T6 passes |
| 7 | `_harness/probe_pg_data.ts` (DT-01..16, T6) | DONE: DT-03 and DT-09 fixed (step A), P5 free prop and DT-10 soaked table added (step C), teeth tested by mutation (step B) |

## Engineer 2 (took over 2026-11-16 09:03 UTC, HEAD 1965cd2c2 "saved after a usage-limit cutoff")
Engineer 1 was cut off after step 3's report entry (06:18) but had already written quests.ts, journal_text.ts, name_gate.ts and the probe
(06:20-06:29). As found: `npx tsc --noEmit -p tsconfig.json` clean (1.5 s); `node _harness/probe_pg_data.ts` (1.9 s) exits 1 on two rows:
- DT-03: `spirelo: favourite crystals has no self event, ride or switch` (the probe skipped every block, but LIFE 5.3 lists "chime, bell,
  crystal, lantern: bump past it" as a by-itself use; the Singing Crystals are tuned M1 blocks with verb RING).
- DT-09: `I7 "Down the glide ramp" has no verb for USE | E3 "Crystal scale" has no verb for USE | U7 "Roll the cloud ball" has no verb for SOCIAL`
  (the hand-reviewed keyword table lacks these words; the titles are QUESTS 6's own).

### E2 step A (09:20): the two failing rows fixed (probe only; no data changed)
- DT-03: a block favourite now counts as a by-itself use when it is a **tuned** block with verb RING (LIFE 5.3's "chime, bell, crystal,
  lantern: bump past it"); every other block still needs a zone or patch, a ride or a switch. This is the spec's rule, not a loosening: the
  previous code skipped every block, which contradicted LIFE 5.3 for the crystals only (the other 10 block favourites pass by switch or patch).
- DT-09: three words added to the hand-reviewed keyword table, each for one QUESTS 6 title, with the reason in the probe: USE "down" (I7 "Down
  the glide ramp" = slide down it, USE SLIDE), USE "scale" (E3 "Crystal scale" = play a scale by ringing, PLACES 4.9), SOCIAL "roll" (U7 "Roll
  the cloud ball" = S12 pass, "each in turn boops the ball toward the other"). **For the designer:** E3's title is a noun phrase; Q7 asks a
  title to say what you do ("Ring the crystals" would). Not changed (the titles are the spec's).
- Result: `node _harness/probe_pg_data.ts` **exit 0, every row ok** (1.9 s): T6, DT-01 Home + Hearthlog wide + tall (0 problems each), DT-02 to
  DT-16. DT-01 for the eight S2 / S3 places stays `info ... PENDING its slice` (ripple 8 / 14, frostbell 8 / 10, rainleaf 4 / 9, fizzwell 4 / 6,
  cogwhistle 5 / 11, lanternroof 14 / 21, echohollow 8 / 10, cloudloft 11 / 46 problems wide / tall; `--verbose` lists them).
- `node _harness/probe_genome.ts`: the module-graph rows green with my 14 files in ("src/core + src/data value-import graph is acyclic (28
  modules, 43 edges)", "every src/core and src/data module loads FIRST in a fresh node process"). `npx tsc --noEmit -p tsconfig.json` clean.

### Bytes after steps 4-7 (09:22; scratch `pg_data/bytes.mjs`, 14.3's one-file rolldown build, minify, every import external)
| module | min B | gzip B |
|---|---|---|
| places.ts | 4 484 | 1 992 |
| life.ts | 18 618 | 6 376 |
| quests.ts | 9 758 | 3 439 |
| journal_text.ts | 16 294 | 5 864 |
| place_home.ts | 3 140 | 1 332 |
| place_hearthlog.ts | 3 934 | 1 671 |
| ripple / frostbell / rainleaf / fizzwell / cogwhistle / lanternroof / echohollow / cloudloft | 3 635 / 4 068 / 3 684 / 3 690 / 3 416 / 3 683 / 3 715 / 3 503 | 1 523 / 1 663 / 1 493 / 1 441 / 1 439 / 1 526 / 1 491 / 1 472 |
- **Life chunk data** (places + life + quests + place_home): **36 000 B** minified (the designer's stand-in estimate: 42 KB as objects, 29 KB
  packed); inside the 150 KB life chunk, so no overflow packing is needed. journal_text 16.3 KB (estimate 18 KB) inside the 45 KB screens chunk.
- **First load: 0 B of mine today**: no module outside `src/data` imports places / life / quests / journal_text / place_* yet (grep of `src`;
  only `src/contracts.ts` names them in comments). SZ-01 measures the real build.

## Plan / order
life.ts id tables first (PG_LIFE, PG_RENDER, PG_AUDIO code against them), then places.ts, Home and Hearthlog modules, quests.ts, name_gate.ts,
the probe, journal_text.ts, then the S2 / S3 place modules (wide as PLACES writes them, tall laid under P7).

## For PG_LIFE, PG_RENDER, PG_AUDIO, PG_QUESTS: the id tables are IN (2026-11-16, step 1a; tsc clean)
`src/data/life.ts`: `EMOTE` (24, 1-based, 0 none), `EXPR` (0 none..5 proud), `SYL` (0 chirp..7 peep), `TOUCH` (POKE 0, SQUEEZE 1, STRETCH 2,
TOSS 3, CARRY 4, SQUEEZE_1S 5, STRETCH_06 6, CUT 7, TOSS_HARD 8; -1 none in the snapshot), `INTENT` (1..12), `LIFE_FLAG` (bits, RIDE = 4096),
`LIFE_EV` (SOCIAL 1, USE 2, REACT 3, WISH 4, DISCOVER 5, PIECES 6, SIGNATURE 7), `SCRIPT` (FIRST_PLAY 1..SQUIRTED 6), `WISH_KIND` (PLACE 1..WARM 8),
`LOOK` (frost 0, wet 1, soak 2, sand 3, snow 4, toast 5 = lifeLooks' out order), `THING_KIND` (bits ball 1, bell 2, droplet 4, note 8, flame 16,
sun 32), `REACT_KIND` (FLOAT 1..LOVE 23), `SOCIAL_KIND` (GREET 1..TWIRL 19), `USE_VERB` (ROLL 1..STEP 15), `SALTS`.
`src/data/places.ts`: `PLACE_IDS`, `THING_IDS` (62), `MECH`, `ZONE`, `MARK`, `PROP_SOUND`, types `PlaceId`, `ThingId`.
**Design choice:** `REACT_KIND`, `SOCIAL_KIND` and `USE_VERB` are defined in `life.ts` (LIFE produces them; `REACT_TRIGGERS` and `SOCIAL`
need them) and **re-exported by `quests.ts`** (the brief lists them there), because quests.ts needs `TOUCH` and `WISH_KIND` from life.ts and a
two-way value import would be a cycle (probe_genome's module-graph row).

## Step 1-3 (2026-11-16): life.ts, places.ts, the ten place modules
- `life.ts` also holds: `FAMILY_REACT` (PLACES 2.4, `satisfies Record<MaterialFamilyId, ...>`; `flavour` uses `FLAVOUR` 0 gel .. 5 firm =
  audio/cut.ts order; `catchSoaked` 0.3 for slow-rise; `mechPrefs` = B04 affinity, my reading of PLACES 3), `GAITS` (LIFE 5.2, S1 vy <= 0.84),
  `HOP`, `LOOK_RATES`, `LOOK_ADD` (the host's lifeAddLook amounts), `NEEDS`, `WHO`, `BEHAVIOURS` (B01..B20), `BRAIN` (behaviour numbers),
  `SOCIAL` (S01..S18 with points, radius, duration, kind), `FRIENDSHIP`, `WARMTH`, `TRAIT_WORDS` (+ `TRAIT_MEDIANS`), `BUBBLE_WORDS` and
  `BUBBLE_MEANINGS` (per EMOTE id), `STAR_MEANINGS`, `CHANNEL` / `PHYS_ARG` / `RPOSE` / `PARTICLE` / `REACT_SOUND` / `BEHAV_COLD_GAIT`,
  `DEFAULT_COLUMNS`, `DEFAULT_REACTIONS` (packed, unpacked at load by a PURE call), `REACT_COND`, `REACT_TRIGGERS` (23 rows), `SPECIES_LIFE`.
- `places.ts` also holds: `SIGNATURE`, `FINALE`, the types (`Area`, `GroundMods`, `PatchDef`, `ZoneDef`, `ThingDef`, `Spot`, `LayoutDef`,
  `PlaceDef`, `Reaction`), `cells()` (unpacks a place's packed reaction cells), `ownsArea()` (a zone or patch belongs to the thing whose `zone`
  / `patch` equals its id or its id's part before the first '.': the three Splash Spots, the steam pool's warm twin), `PLACE_INFO`, `THING_KINDS`,
  `MECH_RANGES`, `loadPlaceDef` (a switch of ten dynamic imports).
- **Additions to section 6's shapes (my own files, optional fields):** `ZoneDef.falloff` [full-strength radius, edge strength] (the cabin's
  Fireside Warmth: 1.0 inside 0.8 m, 0.4 at 1.8 m), `ZoneDef.glow` (the Glow Pool), `FamilyReact.catchSoaked`. Yaw is in radians; a ring's yaw is
  its gap direction (atan2(z, x)); `ThingDef.size` per mech is documented on the interface.
- **Reaction channels (D-80).** I parsed PLACES 3 and 4's tables and mapped each cell's words, tag by tag, to a channel (scratch
  `pg_data/cells.mjs` + `gen.mjs`, which also emitted the place modules; the TS modules are now the source). A physics (P) cell's channel is
  `PHYS` with the family number it rides on (water density, grip, prop contact, pad gain, field catch) unless it names a pose number, which is
  `POSE`. Home 60/60 and Hearthlog 84/84 cells have a channel (62 and 92 channel entries). **9 S2/S3 cells name no channel and do not ship
  (back to the designer):** frostbell Steam Pool jellygel "wades, glows L"; fizzwell Bath Water jellygel "wades, glows through the water L";
  cogwhistle Lamp Warm jellygel "glows warm L" and waterfill "a warm glow L"; lanternroof Night Breeze putty "stays put L", Lantern Line mochidough
  and putty "a dull bump L", Moon Dish marshmallow "gazes up, the moonlight on its sugar L" and jellygel "the moon glints in it L" (each is the
  place's light, D-80, or a word with no mechanism).
- **FN-02's fireplace cells:** jellygel POSE 92, marshmallow LOOK toast 0.60 + BEHAV 5 (the hop back), mochidough POSE 106, slimegoo POSE 82:
  four different looks or poses, each with its channel.
- **Home** (`place_home.ts`): `unit: 'slot'`, `spawn: 'matLayout'`, every thing's WIDE spot / `fromN` in the ThingDef and its TALL spot in
  `tall.things`, the use spots, the Keepsake Shelf 1.2 x 0.45 x 0.30 (half 0.6, 0.225, 0.15), Lamp Warmth r 1.2: exactly PLACES 4.1's table.
  `arrives.after` keys: `'start'` (Felt Ball, Music Box), `'firstHello'` (Snooze Rug), `'firstCapsule'` (Warm Lamp), `'finale:home'`
  (Keepsake Shelf), `'finale:hearthlog'` (Bounce Pad; the shell also waits for the flush pad, S2). The Felt Ball has no fixed use spot (LIFE
  stands behind the ball toward its roll). Home's `bounds` (a disc r 3.4, the felt) is nominal: the corral is the shell's rectangle (D-87).
- **Hearthlog** (`place_hearthlog.ts`): PLACES 4.2's two layouts as written (revision 4): kettle (3.15, -1.95), swing pivot (0, -1.7) and
  tall (-0.93, -2.29) along z (yaw pi/2), push spots (2.0, -1.7) / (-0.93, -0.29), tall yarn ball (1.25, 2.15), the six wide and five tall spawn
  spots, the basket's gap +x wide and +z tall; thing id `hearth` named Fireplace; zones Fireside Warmth (r 1.8, falloff [0.8, 0.4]) and Window
  Chill (wide 1.8 x 1.2, tall 0.8 x 1.0); walls 0.3 m thick at the inner faces of PLACES 4.2.
- **S2 / S3 places:** the wide layout as PLACES 4.3-4.10 writes it, with my reading where the page gives no number (marked in the spec
  generator; e.g. Rainleaf's three Splash Spots at (1.6, 1.55) r 0.65, (-0.2, 1.95) r 0.6, (2.8, 0.5) r 0.55; the Stepping Stones a box at
  (-1.6, 1.75); Cloudloft's Sunbow Arch in the back band at (-1.75, -1.95); Frostbell's Wind Gap and Cloudloft's Breeze boxes kept to
  z < -1.25 so no wind reaches the pad, P6). Their TALL layouts are a **first draft** (the wide arrangement scaled x 0.37, z x 1.25), clearly
  marked in each module: NOT laid under P7. DT-01 lists their problems; their slice lays them.

### Bytes after step 3 (14.3's one-file rolldown build, scratch `pg_data/bytes.mjs`)
| module | min B | gzip B |
|---|---|---|
| places.ts | 4 484 | 1 992 |
| life.ts | 18 550 | 6 356 |
| place_home.ts | 3 140 | 1 332 |
| place_hearthlog.ts | 3 934 | 1 671 |
| the 8 others | 3 416 .. 4 068 | 1 439 .. 1 663 |

### E2 step B (09:40): S0 / S1 content re-checked against the specs, and the probe's teeth tested
- **Home** (`place_home.ts`) against PLACES 4.1's revision 4 table, value by value: every TALL / WIDE spot, `fromN`, use spot, the shelf 1.2 x
  0.45 x 0.30 (half 0.6 / 0.225 / 0.15), the lamp base 0.36 x 0.20 x 0.36 with its 0.6 m shade, Lamp Warmth r 1.2 (warm 0.4), the rug r 0.7
  grip 1.15, the pad r 0.40 gain 1.1 apex 0.30: **all as written**. DT-01's Home row (`--verbose`), slot gap at the worst scale, all "ok":

  | Thing | TALL spot, fromN, slot gap | WIDE spot, fromN, slot gap | PLACES 4.1's gap (TALL; WIDE) |
  |---|---|---|---|
  | Felt Ball | (0, 0.9), 1, 0.10 m | (0.85, -0.75), 1, 0.08 m | 0.10; 0.08 (needs 0.05) |
  | Music Box | (0.75, 1.55), 2, 0.76 m | (2.25, -1.05), 2, 0.29 m | 0.76; 0.29 |
  | Snooze Rug | (0.3, 0), 2, walk-on | (0, -0.35), 2, walk-on | a walk-on patch |
  | Warm Lamp | (-1.05, 0.45), 3, 0.28 m | (-0.6, -2.35), 3, 1.33 m | 0.28; 1.33 |
  | Keepsake Shelf | (0.2, -2.5), 2, 0.28 m | (0.9, -1.6), 1, 0.73 m | 0.28; 0.73 |
  | Bounce Pad | (-0.8, 1.75), 3, 0.74 m | (-0.75, -1.25), 3, 0.29 m | 0.74; 0.29 |

  The probe's camera model (built from stage.ts's text at run time) reproduces the designer's numbers to the centimetre. Checked for every
  party from `fromN` to 5, scales 0.8..1.25 in 0.05 steps, both frames: in view (corners at y 0 and the top inside the insets), not behind a
  slot body or another shown thing, use spots wholly in view and clear of the other slot bodies, the lamp's use spot inside its glow and off its
  base, the pad's on the pad, the rug's second napper against slot 0, the rug centre within 0.65 m of slot 0, every slot centre inside the
  corral rectangle (visibleTable plus every slot body + 0.05 m, D-87). **HUD insets: still the assumed ones** (390 x 844: 151 / 170 / 16 / 60;
  1280 x 800: 120 / 150 / 24 / 24, the `HUD_INSETS` table at the top of the Home row). No measured table exists yet (grep of src / _harness:
  only the probe has one; the UI overhaul has not run). When the overhaul's insets are measured, they go into `HUD_INSETS` and any failing spot
  is re-laid by this lane (PB 11.13). Not re-laid now: nothing fails on the assumed insets.
- **Hearthlog** (`place_hearthlog.ts`) against PLACES 4.2's revision 4 table, value by value: both bounds and wall faces (0.3 m walls at the
  inner faces), fireplace, fire point, Window Chill (1.8 x 1.2 wide, 0.8 x 1.0 tall), the kettle (3.15, -1.95) / (-1.98, -3.44), the swing
  pivots (0, 1.62, -1.7) along x and (-0.93, 1.62, -2.29) along z with push spots (2.0, -1.7) / (-0.93, -0.29), the rocker (1.55, 2.05) /
  (0.03, 3.0) with riders +-0.75 and pivot 0.24 at 8 degrees, the basket gap +x / +z, the yarn ball (-1.35, 1.9) / (1.25, 2.15), the rug, the 6
  + 5 spawn spots, every size: **all as written; DT-01 0 problems in each layout, no move.**
- **Quests 6.0, 6.1, 6.10** (`quests.ts`) against QUESTS 6, clause by clause: all as written (H3 K*, H8 WISH GRANTED v PLACE, H9 by PLAYER x3,
  H10 PILE minN 2 on the rug, C2 / C4 distinct species, C6 PIECES WARM minN 3, C8 USE hearth SWITCH by PLAYER + SING minN 3 with
  `playerClause` 0, C9 TOAST or RISE, X1 distinct pair, X4 / X5 / X9 distinct place, X6 x4 distinct family, X7 sameSpecies x3, X8 PHOTO minN 3
  + BEST_PAIR flag, X10 by PLAYER x5); `playerClause` only on C8, R8, I8, G8, X8; I8's first clause by PLAYER. HOME_TEXT equals QUESTS 6.0's
  titles and hints.
- **Mutation tests** (scratch copy `pg_data/mut/`, never the repo): (1) the **revision 3 cabin** (kettle (2.6, -1.95), swing pivots z -1.85
  and (-1.08, -2.88), yarn (1.07, 2.07)) FAILS DT-01: wide 43 problems (the rider of R 0.625 is 0.55 m from the back wall, 0.075 m in: PLACES'
  own figure), tall 33 (the rider reaches z -3.58, outside the bounds: CONFIRM N3's figure); (2) the rocker's pivot at 0.20 fails the floor rule
  (needs 0.232) in both layouts; (3) Home's TALL Felt Ball at (0, 0.6) fails the slot gap (-0.14 m), the TALL shelf at fromN 1 fails "n1 out of
  view; behind a body", the WIDE Music Box at fromN 1 fails "n1 out of view" (PLACES 4.1: one squishy's view holds only the body and the ball).
  The real tree passes all three.

### E2 step C (09:55): two probe rows made stricter (P5, PLACES 2.5); data unchanged
- DT-01 now also checks P5's "at most one free prop (a ball)" per place (it checked only 8 moving props and 20 primitives): every place has at
  most one ball, 0 new problems.
- DT-10 now computes the **soaked** half of the float table the brief asks for ("every family density, dry and soaked"): it prints it
  (`slowrise FFs/sss soaked, marshmallow FFF/sss soaked`, the rest dry only), checks PLACES 2.5's own share figures for the 0.28 m pool
  (0.282 / 0.191 / 0.128 at R 0.40 / 0.50 / 0.625, to 0.0015), that soaked slow-rise and marshmallow sit at every band (PLACES 2.5's row), and
  that no soaked family floats in any deep water zone of any place. All pass.
- Life tables re-checked by hand against the specs (no change needed): BEHAVIOURS B01..B20 base scores, cooldowns, per-visit flags and Who (LIFE
  4); SOCIAL S01..S18 points, radii, durations and Who (LIFE 6.1); GAITS (LIFE 5.2, all 12 rows); REACT_TRIGGERS' 23 rows (LIFE 4.2: condition,
  once / event, cooldown, thing source); the id orders of REACT_KIND, SOCIAL_KIND and USE_VERB equal QUESTS 4's lists; the data model's field
  names and export lists equal PLAYGROUND_BUILD 6 (the additions are optional fields only: `ZoneDef.falloff`, `ZoneDef.glow`,
  `FamilyReact.catchSoaked`).
- S1 copy: no squirt line is reachable in an S1 build (the one squirt text is R7's title and hint, a Ripple Shore quest, hidden until S2 ships;
  FAMILY_LINES' slow-rise water line is "floats, then soaks and settles").

### E2 step D (10:10): every S0 / S1 reaction cell read back against its words; one cell fixed
- Decoded every channel of Home (60 cells), Hearthlog (84 cells) and PLACES 3.1's default columns (pool, shallow, rain, warm, cold: 60 cells)
  and compared each with its words (scratch `pg_data/grid.ts`, `pg_data/defs.ts`). All agree but one: **Hearthlog, Singing Kettle x slowrise**
  ("the steam makes it dewy (wet look) L") was mapped to PARTICLE steam; the cell's effect is the wet look, so it is now **LOOK wet 0.20**,
  and its neighbour marshmallow "dewy L" goes from wet 0.30 to **0.20** too: the kettle's steam adds exactly wet +0.2 (PLACES 4.2), the only
  number the page gives. `src/data/place_hearthlog.ts` packed cells `5,0,1,5,1` -> `5,0,1,4,120` and `5,1,1,4,130` -> `5,1,1,4,120`.
  Hearthlog still has 7+ channelled cells per family (DT-06 ok); tsc clean; probe exit 0.
- FN-02's fireplace cells (decoded): jellygel POSE 0.92; marshmallow LOOK toast 0.60 + BEHAV B05 (the hop back); mochidough POSE 1.06; slimegoo
  POSE 0.82: four different poses / looks, each channelled.

### E2 step E (10:30): the whole node suite once, and all 110 quest rules read back
- `node _harness/run_probes.ts` (one heavy job, under my 900 s timeout, at HEAD 1965cd2c2 plus this lane's edits): **probe_pg_data PASS (1.8
  s)**, probe_genome PASS (3.0 s, its module-graph rows green with my 14 modules), probe_app, catalog, collection_imports, cut (149.6 s), economy,
  families, gestures, materials, merge PASS; probe_collection FAIL on C08 only (the known allocation row that predates this session);
  **probe_softbody FAIL on one row, G1 hostile fuzz "f1b1s0z1: inverted mesh @frame 705"** (physics; no physics file changed in the tree:
  `git status` shows only my three files); probe_species was still running when my 900 s timeout stopped the run (exit 124), so it has
  **no result** here. Nothing of mine left running.
- **All 110 quest rules** printed from `quests.ts` beside QUESTS 6's rule column (scratch `pg_data/rules.ts`): every clause, count, distinct,
  minN, by, place / thing, K / K* and `playerClause` agrees (H3 the only K*; playerClause 0 on C8, R8, I8, G8, X8).

### E2 step F (10:45): PLACES 3.2 / 3.3's default columns read back; two default cells fixed (`src/data/life.ts` DEFAULT_REACTIONS)
- Decoded the other 11 default columns (ice, ground, air, pad, ride, ball, ring, chime, magnet, echo, tune: 132 cells) against PLACES 3.2 /
  3.3. Two did not say what the words say:
  - **chime x stickystretch** "the chime sways after it leaves L" was RPOSE sway, a pose of the *body*; the thing that sways is the chime,
    dragged by the sticky body's grip (P11: "a sticky body grips a prop by friction"), so it is now **PHYS contact** (cell `1,1,3,2` ->
    `1,1,1,3`).
  - **tune x putty** "leans on the beat B" was BEHAV B18 (answer a thing: a gaze and a call); the words are a lean, so it is now **RPOSE lean**
    (cell `1,3,7,18` -> `1,3,3,1`). (firmsilicone "hops on the beat" and popdome "taps on the beat" stay B18, the one behaviour that answers a
    tune; no "hop on the beat" behaviour exists. For the designer if they want a hop there.)
- The rest agree (some L / B tags carry a physics or behaviour channel because that is what produces the words, e.g. ride x slowrise "sinks into
  the seat" = PHYS contact + B20; ring x waterfill "sloshes to sleep" = B06). DT-06 ok, tsc clean, probe_pg_data exit 0, probe_genome's two
  module rows ok. life.ts now 18 617 B min / 6 379 B gzip (was 18 618 / 6 376); life-chunk data 35 999 B.
- **Not done (S2 / S3):** the same kind of read-back of the eight S2 / S3 places' own cells (e.g. Shell Chimes x stickystretch may carry the
  same body-sway mapping); their slices do it with DT-06.

### Notes for the next engineer and the other lanes
- **Tripwire:** DT-01's Home row rebuilds the camera from `src/render/stage.ts`'s text (the slot tables, fov 35, pitch 0.27, TARGET_Y 0.42 and
  seven code snippets of `fitDistance` / `framingFor` / the aim). When PG_RENDER changes Home's framing (S0's "Home's camera rule"), the row
  fails with "stage.ts camera changed (...)": then update the model in `stageModel()` / `cam()` to the new code and re-check every Home spot
  (re-lay what fails, at most 3 for `fromN`), never relax the row.
- `loadPlaceDef` lists all ten places, so an S1 build carries eight unshipped place data chunks (about 3.4 to 4.1 KB each, lazy, never loaded
  while Travel hides them). If SZ-02's whole build goes over 2000 KB, 14.3 step 2 drops the unshipped ones from it.
- Bytes after step D: place_hearthlog.ts 3 936 B min / 1 671 B gzip (+2 B); every other module as in the step 4-7 table; life-chunk data
  36 000 B.

## For the designer (open items found by this lane; nothing here blocks S0 or S1)
1. **9 S2 / S3 reaction cells name no channel** and do not ship (engineer 1, listed under steps 1-3 above): Frostbell Steam Pool x jellygel,
   Fizzwell Bath Water x jellygel, Cogwhistle Lamp Warm x jellygel and x waterfill, Lanternroof Night Breeze x putty, Lantern Line x mochidough
   and x putty, Moon Dish x marshmallow and x jellygel. Each family still has 3+ channelled cells there (DT-06 ok).
2. **The kettle's steam radius**: PLACES 4.2 says 1.2 m, LIFE 3.1 says 0.6 m. `LOOK_ADD.kettleSteam` follows the thing's page (1.2 m).
3. **E3 "Crystal scale"** is a noun title (Q7: a title says what you do); DT-09 accepts "scale" as a USE word by review. "Ring the crystals"
   would read as a verb.
4. **Home's HUD insets** are still the earlier fixer's assumed ones (PB 11.13); no measured table exists. When the UI overhaul measures them,
   PG_DATA puts them in `_harness/probe_pg_data.ts` `HUD_INSETS` and re-lays any Home spot that then fails.

## What engineer 2 did NOT check or do (stop at 2026-11-16 ~10:35; tsc clean, probe exit 0)
- **S2 / S3 places (not in this run's scope):** their tall layouts are engineer 1's first draft (the wide arrangement scaled), not laid under
  P7; their DT-01 problems stand (ripple 8 / 14, frostbell 8 / 10, rainleaf 4 / 9, fizzwell 4 / 6, cogwhistle 5 / 11, lanternroof 14 / 21,
  echohollow 8 / 10, cloudloft 11 / 46, wide / tall; `node _harness/probe_pg_data.ts --verbose` lists each). Their reaction cells were not
  read back word by word (Home's, Hearthlog's and all 16 of PLACES 3's default columns were; DT-06 only proves every cell has a valid
  channel). Each slice re-lays, adds the place to `STRICT_PLACES` and reports every move.
- **Home on the real HUD insets:** not measured (no table exists yet; the UI overhaul fills it). Checked only on the assumed insets.
- **No browser, no build:** nothing here ran in a page; SZ-01 / SZ-02 (the real build sizes) are the orchestrator's. My bytes are the 14.3
  one-file rolldown build per module.
- **The probe_species row of the node suite** has no result (my timeout stopped it); probe_softbody's G1 hostile fuzz failure is physics'.
- I did not re-derive LIFE's numbers that are not in my tables (the motion gate, the caps), nor check how PG_LIFE / PG_SHELL read these tables.

## Round 2 (engineer 3, started 2026-11-16, HEAD 8dc806641)
Scope: (1) DT-01 Home's camera tripwire fails on HEAD; (2) slice S2 (Ripple Shore, Frostbell Ridge, Rainleaf Garden) both layouts at 0 DT-01
problems, every reaction cell read back against PLACES.md, their quests / wishes / facts against QUESTS.md, and the designer notes resolved;
(3) S3 as far as it gets. Constraint for this run: nothing under `src/physics`, `src/shell`, `src/ui`, `src/input` or `vite.config.ts` is edited
(newer code is on the owner's PC); requests for those lanes are written below.

As found: `npx tsc --noEmit -p tsconfig.json` clean (1.4 s); `node _harness/probe_pg_data.ts` (1.6 s) **exit 1** on one row:
`FAIL DT-01 Home ... stage.ts camera changed (fov 35, pitch NaN, TARGET_Y 0.42, slots 5/5, missing: )`. Every other row ok; S2 / S3 DT-01
PENDING counts unchanged from engineer 2 (ripple 8 / 14, frostbell 8 / 10, rainleaf 4 / 9, fizzwell 4 / 6, cogwhistle 5 / 11, lanternroof 14 / 21,
echohollow 8 / 10, cloudloft 11 / 46). No request to PG_DATA is open in the other PG_* reports (PG_RENDER: "nothing blocking"; PG_QUESTS: an
optional note that `THING_PLACE` / `PLACE_CAPS` could move to data, QU-14 already cross-checks them).

### R2 step 1: DT-01 Home's camera tripwire re-read against HEAD's stage.ts (probe only; no data changed) - DONE
- Cause: PG_RENDER moved the rig's start pitch into `const REST_PITCH = 0.27` (stage.ts 111; `let yaw = 0, pitch = REST_PITCH` at 278), so the
  probe's literal regex read NaN. What else changed in the camera (git diff 1965cd2c2..8dc806641 -- src/render/stage.ts): with LIFE at Home
  (`autoFraming`) every body is framed at its mat slot (`framePoint`: the k-th whole body at slot k x bodyScale), one body is aimed at its slot x 0.6
  and its rest centre height (`restAim`: `p.restCy`), and `visibleTable()` reports the rest framing at REST_PITCH. That is the slot-body model
  the probe already used (bodies at the slots, round, R = 0.5 x scale, restCy = R): **the framing did not really change**, so no Home spot was
  re-laid.
- Probe change (`_harness/probe_pg_data.ts` `stageModel()`): the pitch is resolved through `REST_PITCH`'s own `const` when the rig names it
  (a literal still works); all 7 old snippets stay required, and 9 new ones are pinned: the slot framing (`sl = camera.aspect < 0.9 ? MAT_SLOTS_TALL
  : MAT_SLOTS_WIDE`, `slotXZ = sl[i] x bodyScale`), restAim's aim (x / z x 0.6, `restCy` height), the `autoFraming && !p.playerMoving` branch,
  the one-body reach (restHalfW x 1.06 + 0.05 x scale), `fitDistance`, and visibleTable's distance and `REST_PITCH`. Nothing was loosened.
- Teeth (scratch `pg_data/mut2/`, a copy of the probe reading a mutated copy of stage.ts; the repo untouched): REST_PITCH 0.30 -> FAIL "pitch
  0.3"; slots not x bodyScale -> FAIL "missing: slotXZ.x ..."; aim x 1.0 -> FAIL "missing: aimOut.x ..."; the rig back to a literal 0.27 -> ok;
  tall slots moved to z -1.1 -> the model reads the new slots and re-checks every spot (ok: still clear), as in round 1.
- Result: `node _harness/probe_pg_data.ts` **exit 0** (1.6 s). Home row, slot gap at the worst scale, identical to round 1's table: TALL Felt
  Ball 0.10, Music Box 0.76, Rug walk-on, Lamp 0.28, Shelf 0.28, Pad 0.74; WIDE 0.08, 0.29, walk-on, 1.33, 0.73, 0.29; all "ok".
  `npx tsc --noEmit -p tsconfig.json` clean. HUD insets: still the assumed table (no measured one exists yet; grep of src / reports).

### R2 step 1 re-verified (engineer 4, a second round-2 run; HEAD def44f133; the first round-2 run was cut off after step 1)
- As found at def44f133: tsc clean (1.4 s); `node _harness/probe_pg_data.ts` exit 0 (1.9 s), every row ok, S2 / S3 PENDING counts as above.
- Read stage.ts's camera myself against the probe's `cam()`: `framePoint` (slot k x bodyScale when `autoFraming`), `framingFor` (one body:
  want = max(bodyScale, (restHalfW x 1.06 + 0.05 x scale) / hwPer) = max(s, 0.58 s / hwPer) for a round body; several: reach r = max(restRadius
  x 1.25, restHalfW x 1.12) = 0.625 s, want from the reach box, `multi` true since `solo` needs a capsule), `restAim` (slot x 0.6, y = TARGET_Y x
  want + max(0, restCy - TARGET_Y x want) x 0.7), `updateCamera` (multi: aim (mx, TARGET_Y x bodyScale, mz x 0.8); distance camScale x base;
  position aim + d (0, sin p, cos p)), `applySize` (aspect = cssW / cssH, no view offset), `visibleTable` (rest framing, REST_PITCH). The model
  matches: **the framing did not change, no Home spot re-laid** (engineer 3's finding confirmed).
- Two strengthenings (nothing loosened): (a) the one-body aim now reads slot 0 x 0.6 from the slot table (it was a literal 0: right today,
  but blind to a moved slot 0); (b) the corral check now compares the model's visible-table box with `src/render/homeview.ts`
  `visibleTableAt` (the pure function `stage.visibleTable` calls) at every frame, party and scale, to 1e-6. Teeth: a scratch copy with the
  model's far clip at -3.3 instead of -3.4 FAILS "the model's visible table [-0.44,-3.30,0.34,0.97] differs from homeview.visibleTableAt
  [-0.44,-3.40,0.34,0.97]"; the real probe passes (all 2 x 5 x 10 boxes agree).
- Result: tsc clean; probe exit 0; Home spots and slot gaps unchanged (TALL 0.10 / 0.76 / walk-on / 0.28 / 0.28 / 0.74; WIDE 0.08 / 0.29 /
  walk-on / 1.33 / 0.73 / 0.29). **Step 1 DONE.**

### R2 step 2a: DT-01 made complete for every ride and floater (probe only), then Ripple Shore laid in both layouts
- **Probe rules added (stricter; nothing loosened):** (1) every ride's rider spots, not only swings and seesaws (the brief's "every ride's seat
  and rider spots inside the bounds", D-91 "every ride keeps its rider's whole path"): a ramp's path from its top to its foot, a mound's top, a
  floater's centre, each with a rider of R 0.625 clear of walls and 0.625 m from other colliders; (2) a floater lies wholly inside a deep water
  zone (surface over 0.12 m), inside the zone's full depth (the zone shrunk by its `ramp`, P4: the depth ramp makes a floating body a sitter, PB
  8.7); (3) a pool stands on its own water zone in each layout; (4) a ring's gap waypoint is read with `p.way` as LIFE's `copyPlace` lays it
  (was a literal 0.6: equal today). `places.ts` now documents the ramp convention (a ramp slopes down toward its local +x; the existing
  Glide Ramp yaw already pointed downhill toward the ice). Home, Hearthlog: still 0 / 0.
- New problems these rules found in the drafts: Ripple's mound rider 0.45 m from the log; Frostbell's Glide Ramp rider path out of the bounds
  (4); Fizzwell and Echo Hollow rides (their slices).
- **Ripple Shore, WIDE (PLACES 4.3 + 3 moves):** Driftwood Log (-2.4, -1.4) yaw 0 -> **(-2.45, -1.4) laid along z (yaw pi/2), 0.05 m**: along
  x its left peek spot was at x -4.10, outside the bounds, and no move of 0.5 m or less fixes that (the spot is 1.7 m from the log's centre);
  PLACES gives no orientation for the log, so this is a reading, not a re-design. Peek spots (-3.33, -0.8) / (-1.57, -0.8) (0.7 m beyond the
  log's sides, near its front end). Shell Chimes (-2.8, 0.6) -> **(-2.8, 0.85), 0.25 m** (0.3 m clear of the log's front end). Sand Mound (-1.2,
  -1.9) -> **(-0.75, -1.75), 0.474 m** (it reached z -2.52, outside the walls' rectangle, overlapped the log, and its rider was 0.45 m from it).
  Spawn re-picked (six, the closest pair 1.72 m; none in water): (-0.025, 0.825), (2.575, 1.575), (0.925, -1.575), (-1.375, -0.325), (-1.575,
  1.575), (1.575, 0.175).
- **Ripple Shore, TALL (laid under P7):** pool (1.403, -2.07) with the Bob Ring at (1.2, -1.77) (its rider inside the bounds, the ring 0.36 m
  from the pool's centre: inside the full depth), the log along z at (-0.3, -2.7) with peek spots (-1.18, -2.76) / (0.58, -2.76), Shell Chimes
  along z at (-1.62, -1.34), Pebble Ball (-1.0, 2.6), Sand Mound (0.8, 2.75); Surf Edge a back strip (0, -3.25) 4.6 x 0.9, Wet Sand (0, -2.45)
  4.6 x 0.7, Sun the bounds; five spawn spots (0.375, 0.975), (-0.425, 0.375), (-0.425, 1.575), (0.425, -0.175), (-0.375, -0.775), the closest
  pair 1.00 m. Why this shape: the log needs both peek spots inside the 2.5 m wide bounds, so it must lie along z in the middle; in front it
  cut the spawn column to 4 spots (scratch search `pg_data/r2/opt.ts`, 4 seeds), at the back with the mound in front it holds 5.
- Result: `ripple` added to `STRICT_PLACES`; DT-01 Ripple wide 0 / tall 0; tsc clean; probe exit 0. Scratch tools: `pg_data/r2/mkdt01.mjs`
  (slices the probe's DT-01 code verbatim), `lay.ts` (merge a candidate, pick spawn spots, run checkPlace), `opt.ts` (random search).

### R2 step 2b: Frostbell Ridge laid in both layouts (and four more probe rules)
- **Probe rules added (stricter):** (1) PLACES' ramp endings: the Glide Ramp's foot lies on the ice (4.4 "ending at the ice"), the Soap Slide's
  in the water (4.6), in each layout (`RAMP_FOOT`); (2) a ring's inner spot gets the body check (bounds, walls, 0.625 m from every OTHER
  collider; it had only a bounds check, so a ball left inside a nest passed); (3) a chime set's static frame (at least its hang height, 0.5 m
  here) may not stand in P7's low front band (the band rule skipped chimes as moving props); (4) **re-specified, with the reason in the probe:**
  a ramp's rider path starts at its top **rider spot**, the top end less the smallest body's radius (0.40 m), not at the top edge: a set
  body's centre cannot sit on the edge (half of it would hang off the board), as the swing and seesaw rows take the rider's centre (the seat;
  `p.rider` inside the board's ends). Written 1 hour earlier as "the top end" by me in this run; changed before any place depended on it.
  Without it the Glide Ramp needs a 0.507 m move (scan `pg_data/r2/ramp.ts`: the smallest move over yaw 90..180 keeping its footprint in the
  rectangle and its path in the rounded corner).
- **Frostbell Ridge, WIDE (PLACES 4.4 + 3 moves):** Glide Ramp (2.9, -1.9) yaw 135 deg -> **(2.88, -1.41) yaw 90 deg, 0.490 m**: at the
  corner it stood 0.5 m outside the walls' rectangle and its rider left the rounded bounds; at yaw 135 deg the smallest fix is 0.71 m, so it is
  turned to slide toward the camera, its foot (2.88, -0.44) on the Ice Pond (PLACES gives no yaw, only "ending at the ice"). Icicle Bells
  (-2.9, 0.7) -> **(-3.1, 0.3), 0.447 m**; Snowdrift Nest (-1.9, 1.7) -> **(-1.6, 1.4), 0.424 m** (it reached z 2.7, outside the rectangle,
  and overlapped the bells; PLACES 4.4 says it is "to be re-checked by DT-01 in the S2 re-lay"). Spawn re-picked (six, the closest 1.40 m,
  none on the ice or in water): (0.375, -0.175), (2.575, 1.575), (-1.575, -0.475), (0.625, -1.575), (1.625, 0.525), (-0.775, 0.675).
- **Frostbell Ridge, TALL (laid under P7):** Ice Pond (1.083, -2.394) back right with the Glide Ramp along z at (1.082, -2.154) sliding toward
  the camera onto it (foot 1.21 m from the ice's centre), Steam Pool (-1.2, -2.0) back left, Icicle Bells across the very back (-1.4, -3.4) yaw
  0, just behind the water's edge, Shake Pine (1.673, -0.725) in the right strip (a body of R 0.4 at the bounds' edge still reaches its
  trunk), Snowdrift Nest (0.433, 2.391) in the front band (it is 0.2 m tall) with its gap toward the pad, Snowball (-1.22, 2.378); Mountain
  Cold the bounds, Wind Gap the back band (0, -2.5) 4.6 x 2.4 (1.3 m from the pad's centre); five spawn spots off the ice and the water,
  the closest 1.01 m. Search: `pg_data/r2/opt.ts` (the nest in the back costs a spawn spot; every search that left the bells over the steam
  pool was re-laid by hand).
- **For the designer (not changed):** the Ice Pond reaches into the pad (wide 0.50 m, as PLACES 4.4 places it; tall 0.22 m). P6 bars things
  and physics ZONES from the pad; the ice is a ground patch of a thing (mech 0), which DT-01 does not test. The cabin's rug (a patch, no
  ThingDef) also reaches the pad. Say if patches should stay out of the pad too.
- Result: `frostbell` added to `STRICT_PLACES`; DT-01 Frostbell wide 0 / tall 0, Ripple 0 / 0, Hearthlog 0 / 0, Home ok; tsc clean; probe exit 0.

### R2 step 2c: Rainleaf Garden laid in both layouts -> all three S2 places strict at 0 / 0
- **WIDE (PLACES 4.5, no thing moved):** the draft's wide failed only its spawn spots (two outside the bounds shrunk by 0.825, both 0.75 m
  from a thing); re-picked six, the closest 1.94 m: (-1.025, -0.375), (2.575, 1.575), (-2.575, 1.575), (0.925, 0.325), (-0.625, 1.525), (0.525,
  -1.575). Two data fixes: the third Splash Spot r 0.55 -> **0.6** (PLACES 4.5: "r 0.6 to 0.9"); the **Leaf Drip zone** (-1.6, -2.0) ->
  **(-1.6, -1.25)**, 0.75 m in front of the stalk ("wet 1.0 under the drip leaf"; centred on the 0.2 m stalk, a body of R 0.625 could not stand
  in its middle: 0.1 + 0.625 > 0.6), with a new **use spot** for the Drip Leaf there, so LIFE has a target under the leaf and DT-01 checks it.
- **TALL (laid under P7):** Leaf Teeter across the back (-0.432, -2.894) along x (riders (-1.08, -2.89) / (0.22, -2.89), inside the rounded
  corner), Drip Leaf (1.121, -2.315) with its drip and use spot at (1.121, -1.565), Moss Bouncer (-1.493, -1.467) in the left strip (its edge
  inside the bounds, so a body walks on), Stepping Stones (0, -1.75) between the teeter and the pad, Splash Spots (-0.9, 2.4) r 0.65, (0.9, 2.4)
  r 0.6, (0, 3.0) r 0.6 across the front band, Seed Pod (1.0, 1.5); five spawn spots out of the water, the closest 1.11 m.
- Result: `rainleaf` added to `STRICT_PLACES`. **DT-01: Home ok, Hearthlog 0 / 0, Ripple 0 / 0, Frostbell 0 / 0, Rainleaf 0 / 0**; tsc clean;
  probe exit 0. Next: S2's reaction cells word by word, then its quests / wishes / facts.

### R2 step 3: S2's reaction cells read back word by word; the designer notes resolved
Method: scratch `pg_data/r2/side.ts <place>` prints every PLACES 4.x cell's words beside the channels the module ships (decoded), and
`cellfix.ts` rewrites a module's packed cells. Ripple 84 cells, Frostbell 84, Rainleaf 72 read one by one.
- **Ripple Shore, 5 cells fixed:** Sand and Sun x waterfill "dries clear" LOOK soak falling -> **LOOK wet falling** (waterfill never soaks,
  soak 0 / s; its look is the wet one); Sand and Sun x firmsilicone "grippy and clean" and x popdome "clean" RPOSE lean -> **LOOK sand
  falling** (the old mapper's `lean\b` matched inside "clean"; "clean" = the smooth bodies shed the sand, the documented level 1 "falling toward
  0"; I first tried a new "level 0 = stays clean" meaning, DT-06 rejected it as undocumented, so I used the documented one instead of widening
  the validator); Shell Chimes x jellygel "clear ring, chirps the note back" strike -> **strike + voice**; Shell Chimes x stickystretch "the
  shell sways after it leaves" RPOSE sway -> **PHYS contact** (the prop sways, dragged by the grip: engineer 2's fix of the default chime
  column, same words). The other 79 agree with their words.
- **Frostbell Ridge, 6 cells fixed:** Snow and Cold x waterfill "frosts first, its voice a step lower L S": frost -> **frost + SOUND voice**
  (the S had no channel; the cold zone lowers every creature phrase, 2.2); Steam Pool x marshmallow "the frost melts off" frost 0.5 -> **frost
  falling**; Steam Pool x jellygel "wades, glows" (no channel) -> **LOOK wet 0.3** (designer note 1); Shake Pine x jellygel "snow cap, wiggles
  half of it off L B": snow -> **snow + RPOSE wiggle** (the B had no channel); Snowball x gummy "chases it P" PHYS contact -> **BEHAV B04** (a
  chase is the use behaviour, as the default ball column's "chases it first B"; the designer tagged it P: the tag is kept, noted below);
  Icicle Bells x stickystretch "the bell sways after it leaves" RPOSE sway -> **PHYS contact**. The other 78 agree.
- **Rainleaf Garden: all 72 agree** (Rain and Drip Leaf maps to the Rain zone; the Leaf Drip zone takes PLACES 3.1's rain column, the same
  words). For the designer: PLACES 4.5 gives the Stepping Stones patch "no prints", yet its family column is twelve prints (shipped as MARK
  print / trail; the patch itself has no mark, so the shell leaves none on the stones). Say which is meant.
- **Designer notes, resolved (and why):**
  1. **The 9 cells with no channel** now each carry the channel of what they do (each matches its neighbours in the same column; "glow" is
     the place's light, D-80, never the channel): Frostbell Steam Pool x jellygel "wades, glows" -> LOOK wet 0.3 (as "wades L", "wades,
     shines L" there); Fizzwell Bath Water x jellygel "wades, glows through the water" -> LOOK wet 0.3 (as "wades, shiny", "wades, shines");
     Cogwhistle Lamp Warm x jellygel "glows warm" -> LOOK wet 0.3 (the gloss: gummy's "glossy L" there, PLACES 3.1 warm "more gloss L"),
     x waterfill "a warm glow" -> PARTICLE steam (PLACES 3.1 warm: "steam wisps rise"); Lanternroof Night Breeze x putty "stays put" -> PHYS
     field (putty's catch 0.10: the breeze barely moves it; "grips the tiles P" there is PHYS field), Lantern Line x mochidough and x putty "a
     dull bump" -> PHYS contact (a heavy body's bump: the lantern's glow is the prop's own), Moon Dish x marshmallow "gazes up, the moonlight
     on its sugar" -> BEHAV B13 (as every "gazes up" there), x jellygel "the moon glints in it" -> LOOK wet 0.3 (as waterfill's "the moon shows
     through its water L" there). **0 cells without a channel remain in any place**; DT-06 per-family minimum now home 5, hearthlog 7, ripple 7,
     frostbell 7, rainleaf 6, fizzwell 6, cogwhistle 6, lanternroof 6 (was 4), echohollow 6, cloudloft 7.
  2. **Kettle steam radius:** PLACES 4.2 (1.2 m) wins over LIFE 3.1 ("within 0.6 m"), the orchestrator's ruling. `LOOK_ADD.kettleSteam.r` was
     already 1.2; its comment in `src/data/life.ts` now records the ruling instead of an open question. No code in `src/life` holds a radius
     (the host applies it). LIFE.md 3.1's "0.6 m" still reads the old number: the designer's page to fix.
  3. **The noun title:** E3 "Crystal scale" -> **"Ring the crystals"** in `journal_text.ts` (Q7: "a title says what you do, and its verb
     matches its rule's event"; E3 is USE RING x3 distinct part; the sibling titles are "Ring the shells" R3 and "Ring the icicles" I9; 17
     chars, DT-02 / DT-08 ok). DT-09's keyword table loses the USE word "scale" engineer 2 added for that title alone (stricter); QUESTS.md 6
     still prints the old title: the designer's page to fix.
- Result: tsc clean; probe exit 0 (DT-02 0 hits, DT-06, DT-08, DT-09, DT-10 ok).

### R2 step 4: S2's quests, wishes and facts checked against QUESTS.md
- **Rules (R1-R10, I1-I10, G1-G10):** printed from `quests.ts` beside QUESTS 6's rule column (scratch `pg_data/rules.ts`): all 30 agree clause
  by clause (thing / place filters, counts, distinct, minN, by PLAYER and `playerClause` 0 on the finales R8, I8, G8; F1 = DISCOVER PLACE).
- **Titles and hints** (scratch `pg_data/r2/qtext.ts`, exact string compare): 29 of 30 equal QUESTS 6. **R9** ships "Set squishies on the Sand
  Mound two times." where QUESTS 6 writes "...Sand Mound." for a x2 rule: kept, because Q7 (and DT-09) require every hint to say its count
  ("two times" for x2); QUESTS 6's R9 hint is the designer's to fix.
- **Chapters 2-4:** names "Sun and Splash" / "Frost and Glide" / "Rainy Day Play", opening at 12 / 20 / 28 stamps, finales R8 / I8 / G8 (idx
  27 / 37 / 47), keepsakes Sea-glass Pebble / Tiny Frost Bell / Raindrop Bead (bits 2-4, QUESTS 10), gift lists boingle-hooplet-knubby /
  munchip-sproutle-acornel / plumpet-glugbean-tadpolo: all as QUESTS 6 / 10 and PLACES 5.
- **Favourites (facts F1 / F2, wishes):** the 16 S2 rows of `SPECIES_LIFE` equal PLACES 5 (puddlo, crumbit, swishel, granulo, tidelume;
  boingle, knubby, hooplet, diademo, constello; munchip, sproutle, wrigglo, acornel, petalop, marigel, with their things and catalog idx).
  DT-03 confirms each favourite has a self event, a ride or a switch.
- **Wishes (QUESTS 8):** thing-kind masks ripple 7 (ball, bell, droplet), frostbell 7, rainleaf 5 (ball, droplet), recounted from the icons
  and checked by DT-16; the rides (Bob Ring, Sand Mound, Glide Ramp, Leaf Teeter) carry the star ride wish (DT-12); the card and button
  templates in `WISH_LINES` fit QUESTS 8 ("{name} wants a ride on the {thing}." where 8's example says "down the Glide Ramp": an example).
- **Thing names** (THING_TEXT) equal PLACES 4.3-4.5's; keyboard labels "Shake the pine" (PLACES 4.4, D-93), "Tap the Drip Leaf" (G7's hint).
- **Completable now, not before:** R5 "Peekaboo by the log" (SOCIAL PEEK on the log) needs both peek spots inside LIFE's targets; on the draft
  the left spot lay outside the bounds in both layouts. G7's shower now has a use spot under the leaf. I7 and G3's rides keep their riders in
  the bounds in both layouts (DT-01).

### R2 step 5: slice S3 begins. Fizzwell Tub laid and read back; S3's quests checked
- **Probe rule refined (my own rule from step 2a, corrected before it shipped):** a floater lies wholly in a deep water zone (M12) and its
  **centre** is at full depth, the ramp lying only along the water's **open** edges (PLACES 4.6: the bath's ramp is "from its front edge"; the
  back and sides are the tub's walls). Step 2a had shrunk every edge and the whole footprint; that is more than the spec says (a floater is a
  wave-driven slider "in a water zone"; what needs full depth is where a floating body rests on or in it). Ripple's Bob Ring still passes
  (centre 0.36 m from the pool's centre).
- **Fizzwell Tub, WIDE (PLACES 4.6):** Soap Slide yaw +90 deg -> **-90 deg** and 0.01 m forward, (2.6, -0.75) -> (2.6, -0.74): PLACES puts its
  top at z 0.3 and its foot in the water at z -1.8, so it slopes down toward -z; the draft had it rising into the water (the new foot rule
  caught it); the 0.01 m keeps its foot rider 0.633 m from the back wall (was 0.623 < 0.625). Sponge Raft (1.2, -1.95) -> **(1.2, -1.75),
  0.2 m** (its rider of R 0.625 was 0.45 m from the back wall; at -1.75 its centre is at the bath's full depth, z <= -1.65). Spawn re-picked (six,
  the closest 2.04 m, none in the water). DT-01 0 problems.
- **Fizzwell Tub, TALL (laid under P7):** the tub's back wall at the tall frame's edge (inner face z -3.7; the draft copied the cabin's -3.75,
  which put a tap against it outside the frame), Tap (0.195, -3.55) against it with its swirl, Bath Water across the back band (0, -2.475)
  4.6 x 2.45 (z -3.7 to -1.25), the Soap Slide (0.917, -1.725) yaw -120 deg from the mat at (1.43, -0.84) down into the swirl at (0.40, -2.61),
  the Swirl Ride (-0.609, -1.842) wholly under water and reachable, the Sponge Raft (-0.827, -2.993), the Bubble Patch (-0.149, -2.553); the Bath
  Mat everything in front; five spawn spots, the closest 1.04 m. DT-01 0 problems. `fizzwell` added to `STRICT_PLACES`.
- **Fizzwell's 72 cells read back:** 70 agree; two named a second effect with no channel: Bubble Patch x slimegoo "glossy and bubbly" wet ->
  **wet + PARTICLE bubbles**; x gummy "fizzes, a giggly trill" voice -> **SOUND fizz + voice**. (Bath Water x jellygel: designer note, step 3.)
- **S3 quests (W, L, E, U and T):** all 50 rules equal QUESTS 6.5-6.9 clause by clause (`pg_data/rules.ts`); all 50 titles and hints equal
  QUESTS 6 but E3 (my step 3 change); chapters 5-9 (Bath Time / Tick and Spin / Moon and Lanterns / Hello, Hello / Above the Clouds) open at
  36 / 45 / 54 / 63 / 72 stamps with finales T8 / W8 / L8 / E8 / U8 (idx 57 / 67 / 77 / 87 / 97), keepsakes bits 5-9, no gift; the favourites
  of every place equal PLACES 5 (scratch `pg_data/r2/favs3.ts`; PLACES 5 still names the cabin's thing "Hearth", renamed "Fireplace" in rev 3).

### R2 step 6: Cogwhistle Bench laid and read back
- **WIDE (PLACES 4.7, no thing moved):** the **Tick Clock is 0.25 x 0.7 x 0.16 m**, not 0.15 m deep (PLACES 4.7's size breaks its own P2 / M1
  minimum part of 0.16 m, the contact-particle bound; the rule wins, 1 cm; for the designer). Spawn re-picked (six, the closest 1.67 m):
  (1.575, -0.225), (-2.575, 1.575), (-0.825, -0.075), (1.925, 1.575), (-0.525, 1.575), (0.225, -1.375). DT-01 0 problems.
- **TALL (laid under P7):** Spinning Cog (0.9, -2.286) back right with its Wind-up Key (0.623, -3.5) behind it (as the wide layout keeps them
  together), Horseshoe Magnet (-1.6, -2.186) back left with its field (r 1.2, physics: 2.71 m from the pad's centre), Little Bell (1.62, -1.1)
  and Tick Clock (1.368, 0.354) in the right strip, Steel Marble (-1.066, 1.305), Spring Plate (0.858, 2.85) front right (inside the rounded
  corner, so a body steps on); Lamp Warm (-0.6, -1.8) r 1, Felt Pad (0, 0.25) r 1.2; five spawn spots, the closest 1.20 m. Search
  `pg_data/r2/opt.ts` (3 seeds, all 0 problems; seed 1 kept the key by the cog; its Little Bell, deep in a back corner a small body could not
  reach, was moved by hand to the right strip). DT-01 0 problems. `cogwhistle` added to `STRICT_PLACES`.
- **Cells (84) read back, 3 fixed:** Tick Clock x putty "leans on the beat" B18 -> **RPOSE lean** (engineer 2's fix of the same words in the
  default tune column); Little Bell x stickystretch "the bell sways after it leaves" RPOSE sway -> **PHYS contact**; Lamp Warm x marshmallow "a
  faint golden glow" toast 0.60 -> **toast 0.30** ("faint": Home's Warm Lamp gives 0.30 for the same faint toast). Lamp Warm x jellygel /
  waterfill: designer notes, step 3. The other 79 agree.

### R2 step 7: Lanternroof laid and read back (and one more probe rule)
- **Probe rule added:** a swing hangs from a frame, beam or line at its pivot height (M8, 1.5 m and more; the hammock's clothesline 1.52 m),
  so P7's low front band holds no swing (the same reasoning as the chime frame, step 2b; the band rule had skipped swings as moving props).
  The cabin's swing (back band) still passes. Without it the search hung the tall hammock in the front band, in front of the party.
- **WIDE (PLACES 4.8 + 2 moves):** Lantern Line (-1.6, -1.9) -> **(-1.6, -1.85), 0.05 m** (its last lantern swung 0.04 m into the back
  parapet); Clothesline Hammock (2.4, 1.0) -> **(2.16, 1.0), 0.24 m** (its rider of R 0.625 came 0.39 m from the side parapet), its push spot
  (0.49, 1.0) -> (0.25, 1.0) with it; the **hammock's seat is 0.9 m long**, not 1.0 m (PLACES 4.8's size is outside M8's own range, total
  length 0.5..0.9, revision 3; the rule wins; for the designer). Spawn re-picked (six, the closest 1.38 m). DT-01 0 problems.
- **TALL (laid under P7):** back parapet at the frame's edge (inner face z -3.7), the sides, and the low front parapet just past the bounds
  (inner face z 3.1; the draft had none, PLACES 4.8 asks for one); Lantern Line across the very back (-0.8, -3.35); the Clothesline Hammock
  (-1.245, -1.708) swinging along z at the left of the back band, its push spot (-1.245, 0.202) at its front end (along x, or pushed from
  behind, every push spot falls outside the 2.5 m wide bounds); Moon Dish (-0.868, -2.2) beside it; Vane Disc (1.0, -2.341); Chimney Corner
  (1.528, -0.513) in the right strip with its nap patch 0.3 m toward the room (as in the wide); Star Scope (-0.517, 2.9) in the front band
  (0.4 m, P7); the **Night Breeze over the back band** (0, -2.475) 4.6 x 2.45, 1.25 m from the pad's centre, so the lanterns, the vane and the
  hammock are in it; five spawn spots, the closest 1.10 m. `lanternroof` added to `STRICT_PLACES`. (The hammock first sat at x -1.25, on the
  bounds' edge: with the module's yaw 1.571 instead of pi/2 the rider path left the bounds by 0.0001 m, which the probe caught; 5 mm inward.)
- **Cells (72) read back, 6 fixed:** Lantern Line x stickystretch "the lantern sways after it leaves" RPOSE sway -> PHYS contact; x slimegoo
  "a wet bump" LOOK wet -> **PHYS contact** (a lantern does not wet the body; the bump is the contact, as "a dull bump" there); Chimney Corner
  x marshmallow "toasts faintly" toast 0.60 -> **0.30**; Night Breeze x stickystretch and x slimegoo "grips the tiles" PHYS field -> **PHYS
  grip** (a grounded body is out of the wind's reach, P11; what the words name is its grip on the tiles); Moon Dish x slowrise "gazes up,
  dozes" B06 -> **B13 + B06**. The 3 designer-note cells: step 3. The other 63 agree.
- **For the designer / PG_PHYS (not changed):** in the WIDE layout the Night Breeze is engineer 1's box over the right band (x 1.25..3.4: the
  vane and the hammock are in it); the Lantern Line (back left) is not, although PLACES 4.8 says "the lanterns sway". A breeze over the whole
  place would reach the pad (P6). Either the lanterns sway on the gust timer place-wide (a look), or the breeze becomes a back band in the wide
  layout too (it would then miss the hammock). Say which.

### R2 step 8: Echo Hollow: blocked on the designer (a move over 0.5 m); one more probe gap closed
- **Probe gap closed:** DT-01 modelled every M1 block as one box, but a row of blocks (the Singing Crystals: `p.n` 5 over `p.span` 2 m,
  bowed `p.curve` 0.15 m) is five; `primitives()` already counted five. `footprints()` now lays the row as `places.ts` documents multi-part
  things (parts evenly over the span along the yaw axis), bowed toward local +z at the middle (now documented in `places.ts`; no consumer
  reads it yet: only the cabin is rendered). It exposed the real overlap: the Hum Rock sat 0.57 m inside the crystal row's end.
- **Why it is blocked:** behind the pad the back band is 1.2 m deep (z -2.4 to -1.2) and the Hum Rock (M3 r 0.9, top 0.25: a footprint 1.245 m
  across) must stay 1.2 m from the pad's centre and inside the walls' rectangle, so behind the pad it needs |x| >= 0.40; on the left the 2 m
  crystal row (to x -0.8) is there. No layout with every move at 0.5 m or less exists (`pg_data/r2/opt.ts`, 3 seeds: the best leaves the rock
  0.05 m in the pad); with 0.9 m allowed still none. **Proposal for the designer (not applied):** the Hum Rock into the left band in front of
  the crystals, about (-1.715, -0.74) (a 1.68 m move, "forward" as PLACES 4.9 asks), its peek spots (-3.04, -0.53) / (-0.39, -0.53), the
  crystals 0.16 m to (-1.909, -1.973): 0 problems, six spawn spots 1.56 m apart. The Stone Slide, the Glow Pool, the moss bed and the Echo
  Stone pass where PLACES puts them. The TALL layout was not laid (the Hum Rock's two peek spots, 2.65 m apart along x, do not both fit in the
  2.5 m wide tall bounds: they will need to sit at the rock's front diagonals; a designer decision too).
- **Echo Hollow's cells (72) read back, 3 fixed** (data only; the layout stays PENDING): Glow Pool x waterfill "the glow shows through its
  water" LOOK wet -> **PARTICLE glow** (in the Glow Pool the glow is the zone's own effect, `ZoneDef.glow`, "wading ones a glow rim", as every
  other glow cell there); Hum Rock x slowrise "leans on it, dozes" RPOSE lean -> **lean + B06**; Hum Rock x stickystretch "grips it" B12 (the
  POSE behaviour: the old mapper's `grips it` rule) -> **PHYS contact** (a sticky body grips a prop by friction, P11). No other cell in any
  place carries B12. The other 69 agree.

### R2 step 9: Cloudloft: WIDE laid (0 problems), TALL blocked on the designer; cells read back
- **WIDE (PLACES 4.10 + 3 moves):** the updraft's Puff Pad (2.2, -0.8) -> **(2.61, -0.52), 0.497 m** (still wholly in the Updraft, r 1.0
  around (2.2, -0.8): "one pad stands in the updraft"); Cloud Nest (2.6, 1.3) -> **(2.32, 1.26), 0.283 m** (it reached x 3.65, outside the
  rectangle: PLACES "until the S3 re-lay"); Cloud Ball (-0.9, 1.7) -> **(-0.97, 2.02), 0.328 m** (0.52 m from the Kite Swing's push spot
  (-0.4, 1.1)). The free floor around the pad was a 2 x 2 m blob that held no six spawn spots 1.25 m apart; these moves open it: six, the
  closest 1.32 m (-0.575, 0.525), (1.725, -1.575), (1.275, 0.725), (0.525, -0.625), (-0.825, -0.775), (0.225, 1.575). DT-01 wide 0 problems.
- **TALL: not laid, back to the designer.** The three Puff Pads are one ThingDef whose parts 1 and 2 sit at `p.x1..z2`, one triangle for both
  layouts (a `Spot` has no part positions), and PLACES 4.10's coordinates make it 4.4 m wide ((2.2, -0.8), (-2.2, -0.6), (0, -1.9)): the tall
  frame (3.6 m at the pad) cannot hold it. PLACES 4.10 also says "in a triangle 1.6 m apart", which would fit. Designer: which is meant? If
  1.6 m, the wide coordinates change too; if the wide spread stays, the data model needs per-layout part spots (an optional `Spot.parts`,
  my file, plus the prop host reading it). The place stays PENDING (wide 0, tall 48 problems).
- **Cells (84) read back: all agree** (Cloud and Sun = the cloud's dents and the sun zone; Updraft PHYS field; Puff Pads PHYS pad; the Sunbow
  Arch's parade = S05 follow the leader, B105).
- **For the designer:** PLACES 4.10's "Puff Pads ... in a triangle 1.6 m apart" against its own coordinates (2.55 to 4.4 m apart), above.

### R2 state at the end of this run (engineer 4)
| Part of the scope | State |
|---|---|
| (1) DT-01 Home's camera tripwire | DONE: model re-read against stage.ts, framing unchanged, no Home spot re-laid; two strengthenings (slot-0 aim, `visibleTableAt` cross-check) |
| (2) S2: Ripple, Frostbell, Rainleaf | DONE: both layouts 0 DT-01 problems (strict rows), 240 cells read back (11 fixed), quests / wishes / facts checked, designer notes resolved |
| (3) S3: Fizzwell, Cogwhistle, Lanternroof | DONE the same way: both layouts 0 problems (strict rows), cells read back (11 fixed) |
| (3) S3: Echo Hollow | NOT DONE: needs a move over 0.5 m (designer); cells read back (3 fixed); still PENDING (10 / 20) |
| (3) S3: Cloudloft | HALF: wide 0 problems; tall blocked (the Puff Pads' triangle, designer); cells read back (all agree); still PENDING (0 / 48) |

- **Final numbers:** `npx tsc --noEmit -p tsconfig.json` clean; `node _harness/probe_pg_data.ts` **exit 0, 31 ok rows, 0 FAIL** (1.6 s): DT-01
  strict for Home, Hearthlog, Ripple, Frostbell, Rainleaf, Fizzwell, Cogwhistle, Lanternroof (wide and tall, 0 problems each); PENDING infos
  Echo Hollow 10 / 20, Cloudloft 0 / 48. probe_genome exit 0 (module-graph rows green), probe_quests exit 0, probe_journal exit 0 (QU-14 still
  derives THING_PLACE / PLACE_CAPS from the PlaceDefs: no thing or capability changed). probe_life exit 1 on **LF-02 only** (lifeStep
  allocation, 104 928 B per 1000 ticks: PG_LIFE's open row; src/life is being edited concurrently by PG_LIFE in this tree, not by me).
- **Bytes** (14.3's one-file build, `pg_data/bytes.mjs`): places 4 484 / 1 992 gzip, life 18 617 / 6 379, quests 9 758 / 3 439, journal_text
  16 298 / 5 857, place_home 3 140, hearthlog 3 936, ripple 3 686, frostbell 4 134, rainleaf 3 746, fizzwell 3 780, cogwhistle 3 494, lanternroof
  3 838, echohollow 3 722, cloudloft 3 527 B min (1 465 .. 1 691 B gzip each); **life-chunk data 35 999 B** (unchanged). First load: still 0 B of mine.
- **Files changed by me this run:** `_harness/probe_pg_data.ts`, `src/data/places.ts` (two doc comments: the ramp's downhill axis, a block
  row's curve), `src/data/life.ts` (the kettle ruling's comment), `src/data/journal_text.ts` (E3's title), `src/data/place_{ripple, frostbell,
  rainleaf, fizzwell, cogwhistle, lanternroof, echohollow, cloudloft}.ts`, this report. Nothing under src/physics, src/shell, src/ui, src/input,
  vite.config.ts. No git write. Nothing of mine left running (`ps` clean).
- **Probe rules added this run (all stricter, each with its reason in the probe):** every ride's rider spots (ramp path, mound top, floater
  centre); a floater wholly in deep water with its centre at full depth (ramp at open edges only); a pool on its own zone; the ring waypoint
  read with `p.way`; a ring's inner spot body check; the ramp endings (Glide Ramp on the ice, Soap Slide in the water); chime and swing frames
  out of the front band; a block row's real footprint; the corral box cross-checked with `homeview.visibleTableAt`; the one-body aim from slot 0.
  DT-09 lost its "scale" exception. **Re-specified (reasons in the probe):** a ramp's rider path starts at its top rider spot (top end less
  0.40 m), not the top edge.

### Requests to other lanes (not editable this run, or not mine)
- **PG_SHELL (src/shell, the place and prop hosts):** (1) a ramp slopes down toward its local +x (`places.ts` ThingDef doc); set a ramp rider at
  its top rider spot, the top end less ~0.40 m (what DT-01 checks); (2) a block row (`p.n`, `p.span`, `p.curve`: the Singing Crystals) lays its
  parts evenly along the yaw axis, bowed toward local +z; (3) the Drip Leaf now has a `useSpot` under its leaf and its Leaf Drip zone sits 0.75 m
  in front of the stalk (wide (-1.6, -1.25), tall (1.121, -1.565)); (4) `LOOK_ADD.kettleSteam.r` is 1.2 m (the orchestrator's ruling); (5)
  "clean" cells are LOOK sand at level 1 (falling): firm silicone and pop domes shed the sand at Ripple.
- **PG_PHYS (src/physics):** a water zone's depth ramp lies along its open edges only; where a box zone meets a wall (Fizzwell's bath, both
  layouts) there is none (PLACES 4.6). The Lanternroof hammock's seat is 0.9 m (M8's top), not PLACES 4.8's 1.0 m.
- **PG_RENDER:** the S2 places and Fizzwell / Cogwhistle / Lanternroof now have laid tall layouts (positions and some yaws changed: Ripple's
  log along z, Frostbell's ramp facing the camera, Fizzwell's slide downhill toward -z, the tall Lanternroof's low front parapet).
- **The designer:** (1) Echo Hollow's Hum Rock needs a move over 0.5 m (step 8's proposal); (2) Cloudloft's Puff Pads: "1.6 m apart" or the
  4.4 m wide coordinates (step 9); (3) the Ice Pond reaches into the pad (step 2b); (4) Rainleaf's Stepping Stones: "no prints" against a column
  of prints (step 3); (5) Lanternroof's breeze and "the lanterns sway" (step 7); (6) PLACES' own sizes outside their own ranges: the Tick Clock
  0.15 m deep (P2), the hammock seat 1.0 m (M8), the third Splash Spot r 0.55 (4.5's 0.6 to 0.9): data follows the rules; (7) QUESTS 6's R9
  hint lacks its count and E3's old title (steps 3-4); LIFE 3.1 still says 0.6 m for the kettle; PLACES 5 still names the cabin's "Hearth";
  (8) Frostbell Snowball x gummy "chases it" is tagged P but is a behaviour (shipped B04 with the P tag).

### Not done or not checked (plainly)
- Echo Hollow (both layouts) and Cloudloft's tall layout are not laid (designer decisions, above); both stay PENDING in DT-01.
- Home on the real HUD insets: still the assumed table (no measured one exists yet).
- No browser and no build: nothing ran in a page; the layouts were checked only by DT-01's geometry (no render or physics run of any place).
- The whole node suite (`run_probes.ts`, a heavy job) was not run this round; only probe_pg_data, probe_genome, probe_quests, probe_journal and
  probe_life (results above).
- Rainleaf's Stepping Stones cells and the Moss Bed's plain "print" cells were kept as written (designer items, not re-mapped).
