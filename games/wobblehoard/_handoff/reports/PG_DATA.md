# PG_DATA running report (the world as data: places, life tables, quests, their text, and the data probe)

Brief: `_handoff/briefs/PG_DATA.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_data/`.
Started 2026-11-16 by a fresh engineer (no earlier PG_DATA report existed). Baseline: `npx tsc --noEmit -p tsconfig.json` clean (exit 0, 1.9 s) at HEAD f0d24138.

## Status table (update after every step)
| Step | What | State |
|---|---|---|
| 1 | `src/data/life.ts` id tables and tables | DONE (tsc clean) |
| 2 | `src/data/places.ts` | DONE (tsc clean) |
| 3 | `src/data/place_<id>.ts` x 10 | DONE for Home and Hearthlog (PLACES 4.1 / 4.2 as written); S2 / S3: wide as written, TALL = FIRST DRAFT (not laid) |
| 4 | `src/data/quests.ts` | not started |
| 5 | `src/data/journal_text.ts` | not started |
| 6 | `_harness/name_gate.ts` | not started |
| 7 | `_harness/probe_pg_data.ts` (DT-01..16, T6) | not started |

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
