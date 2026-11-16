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
