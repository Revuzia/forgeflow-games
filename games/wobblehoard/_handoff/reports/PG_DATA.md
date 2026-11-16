# PG_DATA running report (the world as data: places, life tables, quests, their text, and the data probe)

Brief: `_handoff/briefs/PG_DATA.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_data/`.
Started 2026-11-16 by a fresh engineer (no earlier PG_DATA report existed). Baseline: `npx tsc --noEmit -p tsconfig.json` clean (exit 0, 1.9 s) at HEAD f0d24138.

## Status table (update after every step)
| Step | What | State |
|---|---|---|
| 1 | `src/data/life.ts` id tables and tables | in progress |
| 2 | `src/data/places.ts` | not started |
| 3 | `src/data/place_<id>.ts` x 10 | not started |
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
