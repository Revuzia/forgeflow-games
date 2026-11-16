# PG_DATA lane brief: the world as data (places, life tables, quests, their text) and the data probe

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. You are one of eight PLAYGROUND lanes (`_spec/PLAYGROUND_BUILD.md` 5). Paths are relative to `games/wobblehoard` ("G").

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: each place's
PlaceDef is its **own lazy module** `src/data/place_<id>.ts`, and the id tables, the life tables and the quest rules ship in the **life chunk**,
not the first load (D-69; your first-load cap is 4 KB); every place has a **tall layout** beside its wide one (D-68); Home's spots are in slot
units and its spawn is `'matLayout'` (D-67); the cabin is re-laid in both layouts (use PLACES 4.2's numbers as written); every reaction cell
carries a **channel**, and the cell words do not ship except the family lines (D-80); new tables `REACT_TRIGGERS` (D-72), `THING_KINDS`,
`CHANNEL`, `DEFAULT_REACTIONS`, `FAMILY_LINES`, `PLACE_INFO`; new DT rules (the seesaw floor rule, a ring's clear opening, a capsule's total
length, no physics zone in the pad, both layouts) and rows DT-15 and DT-16; CS-05 applies to names only; three renames and four word fixes in the
cells; "kind" means a family in every player line (D-82).

## You own
- `src/data/places.ts`, **`src/data/place_<id>.ts` (one per place, ten files)**, `src/data/life.ts`, `src/data/quests.ts`,
  `src/data/journal_text.ts` (all new)
- `_harness/name_gate.ts` (new: an importable copy of the real name gate), `_harness/probe_pg_data.ts` (new: DT-01 to DT-16)
- Running report: **`_handoff/reports/PG_DATA.md`** (update it after every finished step, with commands and real numbers)
- Port: none (node only). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_data/`

## You must not touch
`src/data/catalog.ts`, `materials.ts`, `shapes.ts`, `species.ts`, `palette.ts` (other lanes); `src/core/**` (`rng.ts` is the orchestrator's frozen
file, `quests.ts` is PG_QUESTS'); `_harness/probe_catalog.ts` (you copy its gate, never edit it: task T6); `src/contracts.ts` (report a needed
member instead); anything in `src/life`, `src/shell`, `src/ui`, `src/render`, `src/audio`, `src/physics`, `src/collection`. No git write command.

## Read (completely)
- `_spec/PLACES.md`: all of it, both revisions. 4.2 (Hearthlog Cabin) is re-laid in **both layouts** by a script with DT-01's revised rules
  (`final_cabin2.mjs`, 0 problems each): use its numbers as written, one size per thing for both layouts.
- `_spec/LIFE.md` 2 (traits), 3 and 3.1 (needs, looks, `LOOK_RATES`), 4, 4.1 and **4.2** (behaviours with B20, `SCRIPT` ids, `REACT_TRIGGERS`),
  5.2 (gaits), 6.1 (social moments and their points), 7.1 (the 24 squishmoji), 8.2 (syllables), 11 (salts), 12 (the TOUCH ids it needs).
- `_spec/QUESTS.md`: all, above all 3 (only completable quests are shown), 4 (event kinds), 5 (the rule grammar), 6 (all 110 quests), 8
  (wishes), 9 (facts), 10 (keepsakes), 15 (the lines).
- `_spec/PLAYGROUND_BUILD.md` 2 (decisions D-01 to D-84), **6 (the data model: field names and export lists, revision 3)**, 13 (first load versus
  lazy), 14.3 (size, your 4 KB cap and the per-step byte report), 18 (the DATA rows), 20 (the gate run), 23.
- Code: `src/data/catalog.ts` (SPECIES order = the catalog idx, families, `signature`), `src/data/materials.ts` (`MaterialFamilyId`,
  `MATERIAL_FAMILIES[f].name`, the family names the Journal shows), the gate in `_harness/probe_catalog.ts` 76-298, the module-graph rule in
  `_harness/probe_genome.ts` 85-120, the PLAYGROUND block of `src/contracts.ts`.

## Rules for these modules
- `erasableSyntaxOnly`: `as const` objects, no enums; relative imports end in `.ts`.
- Flat files directly in `src/data` (probe_genome lists `src/data` non-recursively; `place_<id>.ts` too). Value imports only from
  `./catalog.ts`, `./materials.ts` and each other, with no cycle; every module must load first in a fresh node process (probe_genome's two rows).
  Never import `src/core/quests.ts`, `src/life/**` or anything with a DOM.
- `SPECIES_LIFE` uses `satisfies Record<SpeciesId, SpeciesLife>`, so a missing species fails the typecheck.
- Every id list is **append-only** (places, things, quests, keepsakes, emotes, facts, REACT kinds, USE verbs): DT-14 freezes them in a lock list.
- The id unions (`PlaceId`, `ThingId`) live here, never in contracts.ts (D-43): a new place is a data change, not a contract change.
- **What loads when (D-69):** `places.ts`, `life.ts`, `quests.ts` and `place_home.ts` are in the life chunk (after the first frame of play); each
  other `place_<id>.ts` loads with its place through `loadPlaceDef(id)` (a dynamic import, prefetched on idle when the place opens);
  `journal_text.ts` is lazy (the screens chunk and the away chunk import it), never imported from `places.ts`, `life.ts`, `quests.ts` or a place
  module. The first load holds at most 4 KB of yours (any id table boot code needs; SZ-01, SZ-03).

## Build: S0 (now; step 0 of PLAYGROUND_BUILD 16). All of it is data, so build every place now: the probes check all of it.
Land in this order, because PG_LIFE, PG_RENDER and PG_AUDIO code against your tables:
1. `life.ts` id tables first: `EMOTE` (24), `EXPR`, `SYL` (8), `TOUCH` (with SQUEEZE_1S, STRETCH_06, CUT, TOSS_HARD), `INTENT`, `LIFE_FLAG` (with
   **RIDE**), `LIFE_EV`, `SCRIPT` (FIRST_PLAY, FIRST_WISH, PLAY_WITH, POSE, CHEER, SQUIRTED), `WISH_KIND`, `LOOK`; then `SALTS` (LIFE 11),
   `FAMILY_REACT` (PLACES 2.4), `GAITS` (LIFE 5.2, S1 vy at most 0.84), `LOOK_RATES` (LIFE 3.1), `BEHAVIOURS` (B01 to **B20** scores and
   cooldowns), `SOCIAL` (S01 to S18 with their points and Who), `TRAIT_WORDS`, `BUBBLE_WORDS`, `SPECIES_LIFE` (PLACES 5), **`REACT_TRIGGERS`**
   (LIFE 4.2: kind, condition, argument, once per visit or per event, cooldown, how `thing` is set), **`CHANNEL`** and **`DEFAULT_REACTIONS`**
   (PLACES 3 as `{ tag, chan, arg }` per mechanism or zone kind and family). Tell PG_LIFE in your report the moment the id tables are in.
2. `places.ts`: `PLACE_IDS`, `THING_IDS` (62, in the order of PLAYGROUND_BUILD 6), `MECH`, `ZONE`, `MARK`, `PROP_SOUND`, `MECH_RANGES` (PLACES
   2.1, revision 3: M4 ring r 0.85..1.10 and gap 90..130 degrees, M7 board 1.6..2.4 m and pivot 0.12..0.30 m, M8 seat total length 0.5..0.9 m),
   **`PLACE_INFO`** (id, idx, name, coined, stampsToOpen, shipped, night, sky), **`THING_KINDS`** (a bit per wish glyph kind each place has: ball,
   bell, droplet, note, flame, sun; DT-16), `loadPlaceDef`. `stampsToOpen`: home 0, hearthlog `'firstWish'`, then 12, 20, 28, 36, 45, 54, 63, 72
   (QUESTS 7). `shipped: true` for home and hearthlog only; the orchestrator flips the others when their slice ships. `coined` words as PLACES 7
   lists.
3. **The ten `place_<id>.ts` modules** from PLACES 4.1 to 4.10: each PlaceDef with its things, zones, patches, the **wide layout** (the PlaceDef's
   own fields) and **`tall: LayoutDef`** (bounds with their corner radius, walls, spawn, one `Spot` (x, z, yaw, use, peek) per ThingDef and one Area
   per zone and patch, in the same order), camera, presets, and **`reactions`**: each per-thing cell of PLACES 4 as `{ target, family, tag, chan,
   arg }` (D-80; a cell whose words have no channel goes back to the designer, never ships as words). **Home** (`place_home.ts`): `spawn:
   'matLayout'`, `unit: 'slot'`, the Felt Ball's spots TALL (0, 0.9) and WIDE (0.85, -0.75) as PLACES 4.1 gives them, and **the other five spots
   laid by you** against DT-01's Home row and RD-16 (report each spot with its slot gap at scale 0.8 / 1.0 / 1.25 and the party size at which it
   comes into view); each `arrives.after` as a short event key the shell reads (for example `'start'`, `'firstHello'`, `'firstCapsule'`,
   `'finale:home'`, `'finale:hearthlog'`), listed in your report; the Bounce Pad's arrival also waits for the flush pad (S2 physics): the shell
   checks that, not your data. **The cabin** (`place_hearthlog.ts`): PLACES 4.2's two layouts exactly (the thing id stays `hearth`, its name is
   "Fireplace"; the zones are "Fireside Warmth" and "Window Chill"). **S2 and S3 places**: the wide layout as PLACES writes it and a tall layout you
   lay under P7 (both checked by DT-01; a place whose things do not fit the tall frame, or need a move over 0.5 m, comes back to the designer).
4. `quests.ts`: `EV`, `REACT_KIND` (with LOVE), `SOCIAL_KIND`, `USE_VERB`, `WISH_STATE`, `FACT`; all 110 `QUESTS` as `Clause` rules exactly as QUESTS 6
   writes them (I8's first clause has `by: 1`; X10 has `by: 1`; a `distinct 'part'` reads `v`); `playerClause` on the five gift finales C8, R8,
   I8, G8, X8; `CHAPTERS`; `KEEPSAKES` (20); `GIFT_LISTS` (PLACES 5: five lists of three); `HOME_TEXT` (chapter 0 titles and hints).
5. `journal_text.ts`: `QUEST_TEXT`, `THING_TEXT`, `KEEPSAKE_TEXT`, `FACT_LINES` (templates per fact and family with the name filled in, not 600
   typed lines; the F3 hint names the friend's favourite place only while it has shipped, else "Its best friend is a {family name} squishy."; the
   F11 hint "Bring out two {name}s."), **`FAMILY_LINES`** (the F4 to F7 line of each family from PLACES 3: 12 x 4), `WISH_LINES`, `GIFT_LINES`
   (a line names a place only while it has shipped, else "Three new friends for you."; Friends Everywhere's "Three squishies that are hard to
   find."). The per-thing cell words of PLACES 4 do not ship (their channels do). Plain, kind words a seven-year-old can read (QUESTS Q10);
   "kind" only ever means a family.
6. `name_gate.ts`: copy the gate functions of probe_catalog.ts 76-298 unchanged (`denyReason`, `compoundReason`, `unsafeReason`, `denyReasonText`,
   `unsafeReasonText` and their lists) into an importable module. One probe row checks that the copied sources still match probe_catalog's text, so
   a later gate change is noticed (T6). Never loosen it.
7. `probe_pg_data.ts`: DT-01 to DT-16, plus the T6 row. `_harness/run_probes.ts` runs every `probe_*.ts` automatically: keep it to a few seconds,
   print one line per row, exit 1 on any failure.

How to build the hard rows:
- **DT-01** implements PLACES P2 to P7 **in each layout** with footprints: boxes (yaw respected), rings as capsule arcs minus their gap, balls as
  discs, capsules by their **total** length (both caps included), and **swept ranges for moving props** (a swing sweeps rope x sin(limit) along its
  swing axis plus the seat radius; a seesaw's footprint is its board; a chime sweeps its hang length x sin 25 degrees). Rules: colliders inside the
  walls' rectangle (wide) or **the tall frame** (abs x at most 1.82 - 0.128 z, z from -3.7 to 3.4, PLACES P7); use spots and peek spots inside the
  rounded bounds; nothing in the pad (r 1.2) and **no physics zone (water, current, wind, updraft, magnet) reaching into it** (warm, cold, wet and
  echo flags may reach its edge, P6); spawn spots at least 5, at least 0.9 m from every thing, inside the bounds shrunk by 0.825 m, at least 1.0 m
  apart (1.25 m where the place allows); every ride's seat and rider spots inside the bounds; thing-to-thing clearance at least 0.3 m (walls
  excepted); static front-band things at most 0.4 m tall; every part at least 0.16 m thick, a ball r at least 0.20; at most 8 moving props and 20
  primitives (D-55); **a seesaw's floor rule** pivot >= (L / 2) sin(limit) + (t / 2) cos(limit) and at least 0.6 m from a board end to a wall;
  **a ring's clear opening** (the gap chord minus both segment radii) at least 1.35 m; water at most 0.30 m; ramps at most 16 degrees; pads and
  turntables flush; swing seat speed sqrt(2 x 10 x L x (1 - cos limit)) at most 2.0 m/s (the physics' GRAVITY is 10, `src/physics/params.ts` 16).
  **Home's row** (spots in slot units): every thing at least 0.275 m from every body of every `stage.matLayout` slot (both frames, 1 to 5 bodies,
  body scale 0.8 to 1.25, R = 0.5 x scale; the slots of stage.ts 87-88), the free Felt Ball at least 0.05 m; things 0.3 m apart. You may reproduce
  the cabin check with PLACES 4.2's table: expect 0 problems in each layout.
- **DT-03** adds: every favourite thing has an event its fan makes by itself (a USE, or a REACT whose thing it is), or is a ride, or is a switch
  (counted when the player switches it with the fan watching within 1.5 m).
- **DT-06** counts only cells **with a real channel** (a pose target, a render pose, a look and its level, a particle preset, a sound id or a
  behaviour id); at least 3 per family in every place.
- **DT-10** generates the float table from share(h, R) = h^2 (3R - h) / (4 R^3) for every family density (dry and soaked) x the radius bands
  0.40 / 0.50 / 0.625 x every water zone, compares it with every reaction cell that says "floats" or "wades / sits", and checks the eye line (rest
  radius x (0.95 + sin 3 degrees) at the smallest instance size) at least 0.10 m above every water surface where bodies rest.
- **DT-11**: the six salts differ from each other, from the 16 constants and the 2 base seeds LIFE 11 lists, and the row re-greps `src` for
  `^ 0x` and `mulberry32(0x` so a new salt elsewhere is caught.
- **DT-02** uses the gate split of PLACES 7 (coined words: NAME rules; everything else: PROSE rules) over every name, every player line **and every
  reaction cell of PLACES 3 and 4** (they are the source of the family lines), the pop dome rule (P15), the copy words of QUESTS Q10 (sad, lonely,
  grumpy, hurt, misses you, come back, hurry) and **CS-05 on names only** (places, things, zones, patches, keepsakes, chapters: no word of 4+
  letters sharing a species' first four letters; no coined word within edit distance 2 of a species name; unique coined prefixes). The designer's
  run of the same code over 1042 texts and the new names gave 0 hits in player text (PLAYGROUND_BUILD 20).
- **DT-09** is a keyword table you review by hand (title verb to event kind), printed by the probe.
- **DT-15**: every REACT kind a quest or fact uses has a `REACT_TRIGGERS` row; every quest rule that filters a REACT by thing names a thing that
  owns a zone or patch (`ThingDef.zone`, `ThingDef.patch`) or is a `lifeAddLook` source.
- **DT-16**: `THING_KINDS` equals the kinds of the things in each place.

## Build: S1 (Hearthlog Cabin ships)
- DT-01 passes for Home and Hearthlog in both layouts with no move; if one is needed, move by at most 0.5 m and report before and after.
- Every Home, Hearthlog and Friends Everywhere string passes DT-02 and DT-08; the fireplace cells FN-02 needs exist for jellygel, marshmallow,
  mochidough and slimegoo (four different looks or poses, each with its channel).
- QUESTS 6.0, 6.1 and 6.10 rules are final (PG_QUESTS generates a minimal event script per quest from them: QU-02).

## Build: S2 (Ripple Shore, Frostbell Ridge, Rainleaf Garden) and S3 (the other five)
Only Hearthlog's positions have been through DT-01's geometry (PLACES 4.11 note). For each place of the slice: lay its tall layout, run DT-01 on
both layouts, move what fails (at most 0.5 m, or re-orient a swing or seesaw), report every move with the rule it fixed, regenerate DT-10 for its
water, re-run DT-02 on its text, check every cell's channel (DT-06). Known now: Ripple's Driftwood Log and Echo Hollow's Hum Rock must move forward
so their peek spots lie inside LIFE's targets; Fizzwell's water is hand-placed at z < -1.25 (PLACES 4.6, not yet DT-01 checked); Cloudloft's arch
goes in the back band (4.10). The orchestrator flips `shipped` when the slice is verified.

## Acceptance ids you must make pass
DT-01 to DT-16 and the T6 row (PLAYGROUND_BUILD 18), node, in `_harness/probe_pg_data.ts`; probe_genome's module-graph rows stay green with your
files in; `npx tsc --noEmit -p tsconfig.json` clean after every step.

## Budgets
- **First load: at most 4 KB of yours** (PLAYGROUND_BUILD 14.3). The life chunk (at most 110 KB in all) carries `places.ts`, `life.ts`, `quests.ts`
  and `place_home.ts` (about 16 KB of data by 14.3's estimate); each other place module about 3 to 6 KB, inside its place's 45 KB with the render
  and audio chunks; `journal_text.ts` about 18 KB, inside the 45 KB screens chunk. After every step report the minified bytes of each module
  (14.3's one-file rolldown build) and its gzip size (`node -e` with `zlib.gzipSync`); SZ-01 measures the real build at S0.
- The journal save must stay under 16 000 characters (CO-02): keep every saved index small (ids are indexes, never strings, in the save).

## Done means
All DT rows pass with the numbers in your report; every move listed; Home's five spots listed with their checks; the byte counts listed; what
you did not check said plainly.
