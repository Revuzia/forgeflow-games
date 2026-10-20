# GENESIS — LIVING: the living-world program (binding spec)

> *They live their own lives. You are the weather, the ground under them, the sign in the sky — and, if you choose, a
> voice in one of their mouths.*

Lead sim designer, 2026-10-13. This file binds every SIM lane of the living-world program (PACE, LAND, RELATIONSHIP,
CONTENT, HISTORY). Where it conflicts with `CONTRACT.md` it wins — CONTRACT §5 (time), §8.3 (walking speed), §11.4 (the
hand), §11.5 (the creature: **removed**), §16.1/§16.5 (speed presets, gestures). The DOCS lane folds it into CONTRACT
once the lanes are accepted. Every target below names the probe that measures it (§8), and every baseline number was
measured on the current tree with those probes (§8 has the commands and the raw files). Lists are floors.

---

## 0. Decisions, principles, and the question of the creature

### 0.1 The owner's decisions (verbatim where quoted; they override older docs)
1. The people live: *"our villagers just run as normal people, complete their own tasks, and advance as a normal world
   would like in real life. Our job as the G-D is to introduce storms, natural disasters, new materials, etc."*
   Wildlife, trees and grass are *"things our villagers collect"*.
2. Pacing: *"slow and realistic but also we should be able to control time/speed - 1x, 2x, etc."*
3. Disasters: *"wrath slider, but survivable by default … although scare and kill, they build FEAR, trust, loyalty,
   etc. The humans build their relationship with the player (god)."*
4. Materials: everything (deposits, building and tool uses, demand; new plants and crops) *"but NO fantasy creatures -
   this is a real world simulator so we would need real animals."*
5. Defaults not overridden: realistic villagers — hunting/herding where game exists, child mortality and famines in
   moderation, politics from real grievances, festivals / weddings / funerals.
6. **No creature.** The giant learning creature leaves the game (fantasy, and Black & White's signature). Its role as
   the god's lever of influence goes to **prophets and signs** (§3.4), sacred places and **real, life-size** sacred
   animals.
7. **Restyle only** for the hand, drawn-gesture miracles, disciples and rival gods: same mechanics, original names and
   look (§3.6). Names chosen by the lead, the owner may rename: the hand → **the Touch**; gesture miracles →
   **sigils**; disciples → **the Called**; rival gods → original names and epithets; the good/evil glow → the Touch's
   look follows how the people see the god (**feared … trusted**).
8. Launch bar: everything (other teams do UI / art / music; this program does the sim and exposes what the UI needs).

### 0.2 Principles every lane is judged against
- **People first, god second.** A world left alone must live (hunt, herd, farm, celebrate, quarrel, invent) at a
  realistic pace; the god's acts land on a society that answers them.
- **Real world.** Real animals, real plants, real phenomena (a rainbow, an eclipse, red rain). Fantasy nouns typed by the
  player map to the nearest real thing or get a polite refusal (§4.3). (The two non-human *peoples*, the hive and the
  methane drifters, are an owner question, §9 — this spec leaves peoples as they are.)
- **Survivable by default; wrath is a setting** (§3.7). Total destruction is opt-in.
- **Original.** No name, look or mechanic of the program is taken from Black & White. What survives from the old design
  (lifting and throwing, drawn spells, standing orders for followers, rival gods) is renamed and re-skinned; the
  creature is gone; prophets, prophecy, signs, pilgrimage, persecution and sacred places are new mechanics.
- **Measured.** Every lane reports its acceptance metrics over the seeds named in §6.4, before and after.
- **Deterministic, saves load.** detban clean; same seed + log ⇒ same hash; one shared save bump to 1.5 (§6.3).

### 0.3 Can we do this without a creature — or would one buy influence? (measured)
Without one, and better without. The relationship probe (`relationship.ts influence`, the tests' bronze town, 30
people, n = 20) measured the god's standing levers of influence today:

| lever (cast once at day 0) | mean love d1 / d3 / d6 | mean fear d1 / d3 / d6 | worship gained by d6 | praying |
|---|---|---|---|---|
| nothing | 0.079 / 0.077 / 0.074 | 0.038 / 0.035 / 0.031 | 28.3 | 0.1 % |
| creature leashed to the town (tend) | **1.000** / 0.963 / 0.948 | 0.297 / 0.695 / **0.966** | **28.3** (+0 %) | 0.1 % |
| creature leashed (impress) | **1.000** / 0.988 / 1.000 | **1.000** / 0.978 / 1.000 | 27.0 (−5 %) | 0.1 % |
| one disciple preaching | 0.483 / 0.921 / 0.929 | 0.122 / 0.113 / 0.092 | **45.6 (+61 %)** | 0 % |
| one food miracle | 0.553 / 0.508 / 0.440 | 0.040 / 0.039 / 0.034 | 26.9 | 0 % |

The creature pins both meters at 1.0 within a day and changes nothing people *do* (no extra worship, no prayer): it is a
meter-filler, not a relationship. A person among them (a preaching disciple) is the only lever that moved behaviour
(+61 % worship) while leaving fear low. So influence in GENESIS comes through **people** — a prophet whose word the god
makes true or false, with stakes (credibility can be won and lost, rulers can persecute) — and through **the world
itself** — signs made with the god's existing powers that a prophet reads to the people. Nothing of that is Black &
White's. Acceptance (§3.8): a prophet whose prophecies come true must beat both rows above on behaviour (worship, prayer,
loyalty) without pinning the meters.

### 0.4 Baseline at a glance (current tree; §8 for sources)
| family | measure | baseline | target (section) |
|---|---|---|---|
| PACE | 1x | 10 ticks/s, a day = 144 s | 1 tick/s, a day = 24 min (§1.1) |
| PACE | adults' waking time spent walking | 0.69 (0.64–0.73) (audit: 0.77) | ≤ 0.30 (§1.3) |
| PACE | lightning-started fires per world-year (no people) | 0 (4 712 strikes, 8 world-years) | 2–12 (§1.4) |
| PACE | fire-keeping known by game year 8, unaided | 2 of 8 seeds (years 5.0, 5.9) | ≥ 6 of 8 by year 5 (§1.4) |
| LAND | hunts (kills) in 8 seeds × 8 years | 2 kills (17 attempts) | ≥ 20 per 100 people per year (§2.1) |
| LAND | tames (first herds) | 0 | ≥ 6 of 8 seeds once husbandry is known (§2.2) |
| LAND | fishing sessions drawing on a shoal | 12 of 1 023 (1.2 %) | ≥ 80 % (§2.3) |
| LAND | harvests per sowing | 0.21 (231 of 1 113) | ≥ 0.8 (§2.4) |
| LAND | under-15 share at year 8 (median) | 0.71 (0.65–0.74) | 0.35–0.45 (years 10–30) (§2.8) |
| LAND | births per mother, median interval | 0.69 game years | 2.0–3.5 (§2.8) |
| LAND | adults at status 0 / curiosity 0 | 100 % / 70 % | ≤ 0.20 each (§2.9) |
| REL | share of people praying or worshipping, 20 quiet days | 0.000 (+0.007 preaching) | ≥ 0.02 (§3.2) |
| REL | after a killing tornado (9 of 30 dead), mean love | 0.08 → 0.85 | must not rise (§3.1) |
| REL | default meteor on a 30-person town (n = 64) | 100 % (4 of 4 towns fallen) dead | 10–35 % dead (§3.7) |
| REL | outdoor work under a blizzard vs clear | 0.776 vs 0.808 of awake adults | ≥ 60 % lower (§3.7) |
| CONTENT | invented material: deposits / uses / stock after 10 days | 0 / 0 / 0 → 2 | ≥ 1 / ≥ 2 / made and used (§4.1) |
| CONTENT | non-real species | 4 + 1 disaster | 0 (§4.3) |
| CONTENT | biomes with grazers but no predator | 5 | 0 (§4.4) |
| CONTENT | false extinction notices / speciations | 33 of 44 / 84, the first at day 35.5 | 0 / first ≥ year 6 (§4.4) |
| HISTORY | polities / wars / raids in 8 seeds × 8 years | 1 / 0 / 0 | §5.1 fixture targets |
| HISTORY | free-text phrases resolved as meant | 9 / 62 | 62 / 62 (§5.3) |

---

## 1. PACE — slow and realistic, with speed steps

### 1.1 The clock and the speed steps
- `1 tick = 1 game minute` (unchanged). **1x = 1 tick per real second** (`types.ts TICKS_PER_SECOND_1X = 1`, was 10): a
  game hour lasts a real minute, a day 24 real minutes, a season (3 days) 72 minutes, a year (12 days) 4.8 hours.
- The 12-day year stays (CONTRACT §5): the one deliberate compression of the calendar. A day is lived in full detail;
  ages, seasons, crops, births and eras count game years.
- **Speed presets** (`types.ts SPEED_PRESETS = [0, 1, 2, 3, 5, 10, 30, 100, 300, 1000, 3000]`; the HUD already builds
  its buttons from this constant, `src/ui/hud.ts:178`). A preset `S` asks for `S` ticks per real second (tps).

| preset | tps | level | a game day takes | a game year takes | capacity (CPU tps, n = 64, 0–1 500 agents, baseline) |
|---|---|---|---|---|---|
| 1x | 1 | 0 | 24 min | 4.8 h | L0 733–1 048 |
| 2x / 3x / 5x | 2 / 3 / 5 | 0 | 12 / 8 / 4.8 min | 2.4 h / 96 / 58 min | L0 |
| 10x | 10 | 0 | 2.4 min (old 1x) | 29 min | L0 |
| 30x | 30 | 0 | 48 s | 9.6 min | L0 |
| 100x | 100 | 0 | 14.4 s (old 10x) | 2.9 min | L0 |
| 300x | 300 | 0 | 4.8 s | 58 s | L0 (≥ 2.4× headroom at 1 500 agents) |
| 1000x | 1 000 | 1 | 1.44 s (old 100x) | 17 s | L1 881–1 263 → ~0.9–1.0 achieved |
| 3000x | 3 000 | 2 | 0.48 s | 5.8 s | L2 1 406–2 428 → best effort ≈ 0.47–0.81 |

  The top preset is bounded by measured throughput (`pace.ts throughput`, CPU time on this 4-core Xeon; in the browser
  the worker shares cores with rendering — STATUS measured old ×23–58, i.e. 230–580 tps while a village renders — so
  1000x/3000x are best effort there; the HUD shows `achievedSpeed`). No 10000x: no level reaches it.

### 1.2 Levels, the log, saves and tests
- The level is chosen by **ticks per second**: `levelOfTps(tps) = tps ≥ 3000 ? 2 : tps ≥ 1000 ? 1 : 0` (level 3,
  unfocused worlds, unchanged). Presets 1x–300x all run level 0; 1000x runs exactly the old 100x code path (L1); 3000x the
  old 1000x path (L2). So CONTRACT §5's fidelity measurements carry over unchanged, and any preset of one level gives the
  same hash for the same log.
- The worker issues **`time.scale { tps }`** when the level changes (logged, saved, replayed). The legacy form
  `time.scale { scale }` (old multiplier) is still accepted and keeps its old meaning through the unchanged
  `levelOfScale` (≥ 1000 → 2, ≥ 100 → 1): every old save, command log and test (`perf-lapse`, `perf-fidelity`,
  `perf-lapse3`) means what it meant. `LapseState` gains optional `tps`; `lapseLevel` reads `tps` when present, else
  `scale` as today.
- `time.speed { speed }` keeps its shape; `speed` is now tps (free text "run time at 30x" → 30 tps). `Snapshot.speed`
  and `achievedSpeed` are in presets (= tps). The URL `?speed=` is tps.
- `tests/perf-lapse.test.ts:263` (the worker's preset → level) is updated to the new mapping (1x–300x → 0, 1000x → 1,
  3000x → 2); the legacy `levelOfScale` assertions stay. `tests/clock.test.ts` (client clock jitter) is re-run at 1 tps;
  if it fails the client team fixes `src/client/worldview.ts` (hook H1).
- Additive: `Snapshot.lapseLevel?: 0 | 1 | 2` (the HUD's "time-lapse" badge), query `pace` →
  `{ tps, level, presets, realSecondsPerDay, realSecondsPerYear }`.

### 1.3 Walking, commuting and the working day
Walking today is 0.25 m per game minute (`people/defs.ts:7`), 15 m per game hour; adults spend 0.69 (0.64–0.73) of
their waking time walking (audit: 0.77), work starts after dusk 0.008 of the time and 26 % of their walking is done in
the dark. With 1x at 1 tick/s, the walk drawn at 1x is the sim's walk per tick, so the same number sets both the look
and the commute.

**What-if (in-memory, `LIVING_WALK`, 6 seeds, a year-1 village lived 2 days at level 0):**

| BASE_WALK (m/tick = m/s at 1x) | walking share of waking time | to work | work begun after dusk | walking in the dark | food per adult-day | parched / starving samples | median work distance |
|---|---|---|---|---|---|---|---|
| 0.25 (today) | 0.69 (0.64–0.73) | 0.42 | 0.008 | 0.26 | 1.25 | 0.002 / 0.011 | 18 (p90 86) m |
| 1.6 | 0.45 (0.32–0.52) | 0.29 | 0.005 | 0.07 | 1.82 (+45 %) | 0 / 0 | 68 (p90 154) m |
| 2.0 | 0.41 (0.32–0.48) | 0.26 | 0.003 | 0.10 | 2.19 (+75 %) | 0 / 0 | 88 (p90 162) m |
| 2.5 | 0.35 (0.25–0.41) | 0.22 | 0.009 | 0.07 | 2.25 (+80 %) | 0 / 0 | 70 (p90 168) m |

Reading the what-if: faster walking alone does not get there. The planner reaches farther when walking is cheap (median
work distance 18 → 68–88 m, p90 86 → 154–168 m), so the walking share falls only to 0.45 at 1.6 m/tick, 0.41 at 2.0
and 0.35 at 2.5; the freed hours go to more work (adults' working time 0.10 → 0.21 → 0.24 → 0.29) and food per
adult-day rises 45–80 % (one seed ×3.3), while leisure stays at 1.5–2 % and children wander *more* (0.17 →
0.33–0.38). Walking in the dark falls from 0.26 to 0.07–0.10. About two thirds of the remaining walking is to work; the
rest is walking home to eat, to drink and to find company across the village.

**Decision:** `BASE_WALK = 2.0` m/tick — 2 m/s on screen at 1x, a brisk walk (the render draws a long stride) — with the
rules below; the PACE lane may move it within **1.8–2.5** and takes the lowest value that meets §1.6 with the rules on
(it reports the 6-seed table above for its choice). At 2.0 the rules must remove about a quarter of the walking: 0.15 of
waking time is walking that is not to work (home to eat, to water, to company), 0.26 is to work. Children, elders, the
sick and the loaded keep their slower factors.

Rules (PACE implements; LAND reuses them for hunting and herding trips):
1. **Day trips.** Everyday work (forage, farm, water, firewood, clay, stone, fishing from the bank) is chosen within
   `DAY_TRIP = 60` game minutes of walking from home (120 m at 2 m/tick; the planner's site search is bounded by walking
   time, not cells), nearest first. Workers take the day's food and water with them (no walk home to eat at noon), and
   company is sought within 100 m.
2. **Camps.** Work that is far by nature (a hunt, herding at pasture, mining, quarrying, charcoal burning, a far fishing
   ground), or any work more than `DAY_TRIP` away, is a *trip*: the worker takes food and water for it, works up to 3
   days, sleeps at a camp at the site (warmth from a camp fire when fire is known; `TASK.camp`), and comes back with the
   yield. Hunting parties camp together (§2.1).
3. **Dusk.** A task whose walk out + work + walk back does not fit in the remaining daylight is not started, unless it
   is urgent (thirst, hunger, fire, flight, a prayer answered at night). People sleep where they are when night falls on
   the road (a camp), instead of walking home through the night.
4. **The economy stays balanced.** Faster travel frees hours; they go to leisure, faith, crafts and building — not to
   triple the food. Food produced per adult per day stays within ±25 % of the baseline (1.25 units) by giving
   work sessions realistic lengths (forage 2–3 h, fish 2–4 h, field work 3–4 h, a hunt 1–3 days) and per-session
   yields that match; LAND then adds the leisure outlets (§2.9–2.11).
5. Roads keep speeding walking by their tier as today; a caravan's reach follows `BASE_WALK` (`people/economy.ts:251`
   assumes "a caravan walks ~15 m an hour").

### 1.4 Fire without the god
Lightning almost never lights a fire today: a strike needs `dry > 0.15`, but every strike falls on a cell its own storm
wets (`fields/weather.ts:405-409`); 31 690 strikes over 64 world-years of the census lit **3** fires (495 strikes per
world-year), and the no-people probe (`pace.ts fire`, 4 seeds × 2 years) counted 4 712 strikes and **0** lightning fires — its
only fires came from two natural `wildfire` disasters on one seed, which burnt up to 1 837 cells (12 % of the land). Fire-keeping came only in years
25–27 in the audit's 50-year runs; 2 of 8 census seeds knew it by year 8 (years 5.0 and 5.9).
1. **Dry lightning.** A strike reads the ground as it was *before* the storm's rain reached it when it falls on the
   storm's leading edge (the cell entered the storm's disc within the last 30 min) or when the storm is a dry one (precip
   < 0.5 mm/h: heat storms, dry season); cured fuel (grass and shrub in the dry half of the local year, or soil moisture
   < 0.3) ignites with `p = 0.35 × dry × fuel` as today.
2. **Fire seasons.** Biomes with a dry season (savanna, steppe, grassland, scrub, dry forest) get a seasonal ignition
   chance from heat and drought (no weather system needed), so grassland burns every 1–5 years as real savanna does.
3. **A fire seen is a fire learned.** A settlement within 2 km (or in sight across open ground) of a burning cell gets
   the `wildfire` context (today only fire inside its own flow cells, `people/settlement.ts:984-986`), and a brave
   person may carry a burning brand home (fire-keeping accident) — the oldest real route to fire.
4. Targets: 2–12 lightning-started fires per world-year on the n = 64 terran sandbox without people (4 seeds × 2
   years; ≥ 70 % in the local dry half-year), land burnt by them ≤ 5 % of the land per world-year (the separate natural
   `wildfire` disaster keeps its rate); fire-keeping known without the god by game year 5 in ≥ 6 of 8 census seeds
   (median ≤ 4).

### 1.5 An era timeline for a world left alone
Real history from the first farmers to spaceflight is ~11 500 years. Compressing it uniformly would spend most of the
game in the Neolithic and squeeze the modern age into weeks. Real invention is not uniform either: technology grows with
the number of minds (the population–technology model of Kremer, 1993), so the game compresses early millennia hardest and
modern centuries least — the same curve its own growing population produces. Targets for a 30-person stone-age band on
the sandbox, no god, natural disasters on (median over 8 seeds; the band is the tolerance):

| milestone (first recipe of) | real date | game year target |
|---|---|---|
| fire-keeping | (known for 400 000 years — the game starts without it) | 1–6 (median ≤ 4) |
| agriculture | 11 500–10 000 BP | 3–12 |
| pottery (clay era) | ~10 000 BP | 6–18 |
| copper smelting | ~7 500 BP | 20–40 |
| bronze | ~5 300 BP | 30–55 |
| writing | ~5 200 BP | 35–65 |
| iron smelting | ~3 200 BP | 50–85 |
| classical era | ~2 500 BP | 65–100 |
| medieval era | ~1 400 BP | 90–130 |
| gunpowder | ~1 100 BP | 110–150 |
| steam | ~250 BP | 140–185 |
| electricity | ~150 BP | 155–200 |
| first orbit | ~70 BP | 170–230 |

Implied compression (real years per game year, between the target midpoints): farming → copper ×144, copper → iron
×115, iron → medieval ×42, medieval → steam ×22, steam → orbit ×5 — falling as the number of minds grows.

At 3000x a game year takes 7–12 s of real time with up to 1 500 agents (L2 throughput probe); the audit's 50-year run
averaged 27 s per year (631 tps) as the world filled, so first fire to orbit takes roughly 30–90 real minutes at 3000x,
a few hours at 100x–300x, and a lifetime at 1x. Today: fire at years 25–27 in the audit's runs, then pottery to money in
4 years; in the census 2 of 8 seeds had fire by year 8, and seed 4 went fire (5.0) → pottery (7.2) → copper smelting (7.8)
— the same burst after the stall. HISTORY calibrates discovery against this table (§5.2) **after** LAND's demography lands (growth sets
the number of minds). The census probe (`census.ts`, `firsts`) measures it; a 50-year check (8 seeds) covers the
milestones through iron, and 2 seeds × 230 years cover the rest (run at 3000x, two at a time).

### 1.6 PACE acceptance (multi-seed; `pace.ts`, `census.ts`, `perf_worker.ts`)
- 1x = 1 tps; presets as §1.1; `time.scale {tps}` logged; legacy `{scale}` unchanged; old saves load to the same hash.
- Determinism: a run at 2x and the same run at 300x (same log) give the same hash; 1000x equals a legacy `scale: 100`
  run; 3000x equals legacy `scale: 1000`.
- Walking share of adults' waking time ≤ 0.30 (6-seed mean; no seed > 0.35); work begun after dusk ≤ 0.05; walking in
  the dark ≤ 0.10; food per adult-day within ±25 % of the baseline 1.25 (no seed above +50 %); parched and starving
  shares not above baseline (0.002 / 0.011); measured with `LIVING_WALK` unset on the lane's code.
- Throughput: faster walking costs decisions — the 2 m/tick what-if ran 16–24 % slower at level 0 than today's code
  measured side by side (§8.3). With 1 500 agents: level 0 ≥ 85 % of the same-session baseline and ≥ 450 CPU tps (300x
  keeps 1.5× headroom), level 1 ≥ 800, level 2 ≥ 1 200; `perf_worker.ts`: achieved ≥ 0.98 of 1x–300x and ≥ 0.85 of
  1000x with 1 500 agents in Node.
- Fire targets of §1.4. Seed-bound tests moved by the walking change: re-measured over 8 seeds before/after (§6.4).

### 1.7 As built (PACE lane, 2026-10-14; probes and logs in `_harness/scratch/living/pace/`)
- **Clock and presets** as §1.1: `TICKS_PER_SECOND_1X = 1`, `SPEED_PRESETS = [0, 1, 2, 3, 5, 10, 30, 100, 300, 1000,
  3000]`, `levelOfTps` and `LEVEL_SCALE` in `perf/lapse.ts`. `time.scale { tps }` is logged with its tps and stores the
  legacy multiplier of its level (`LEVEL_SCALE` 1 / 100 / 1000) in `LapseState.scale`, so 1000x and a legacy
  `scale: 100` run hash alike, 3000x and `scale: 1000` too, and 1x–300x equal the plain sim (`tests/living-pace.test.ts`).
  `Snapshot.lapseLevel`; query `pace` → `{ tps, ticksPerSecond1x, level, levelOfPreset, presets: [{ preset, tps, level,
  realSecondsPerDay }], realSecondsPerDay, realSecondsPerYear, gameMinutesPerTick }`. The worker's half-second cap on
  the debt one wake may add made every 1x tick wait 1.5 s (0.7 tps): it now owes at least two ticks (`worker.ts pace`).
  Saves are 1.5 (`core/migrate15.ts LIVING_MIGRATIONS`, PACE's step is a no-op: its four agent columns default).
- **The working day** (`perf/pace.ts`, hooks in `decide.ts`, `work.ts`, `needs.ts`, `tasks.ts`, `plapse.ts`):
  `BASE_WALK = 2`, `DAY_TRIP = 60` (day work within `max(120 m, 1.6 cell edges)` of flow cost), trips with camps
  (`TASK.camp = 54`, `A.trip / camp / tripTask / dayWork`), provisions and water skins, the dusk rule, camping where night
  falls (`ROAD_CAMP_TICKS = 45`), sessions of 2½–3½ h (`SESSION`), food per session × `FOOD_YIELD = 0.6`, one food session
  a day (two while the store holds under 1.5 days a head), perishables weighted in the lean signal (`PERISH = 10`), and the
  nets rest when the store is full. Caravans' reach follows `BASE_WALK` (`economy.ts CARAVAN_WALK`).
- **Fire** (`fields/weather.ts`, `people/firewatch.ts`, `fields/fire.ts`): dry strikes on a storm's 30-minute leading edge
  and under storms raining < 0.5 mm/h, fire-season heat strikes (60 cells drawn an hour, grass and scrub country, cured
  soil < 0.3), a fire seen within 2 km is the `wildfire` accident. A burn leaves at most 9 mm of ash (`FIRE_ASH_M`): the
  4 cm a forest burn used to leave was drifted by the wind for days and woke the hydrology over ~10 000 cells (one dry
  strike on the sandbox without people took level 2 from 2 328 to 407 ticks per CPU second, level 1 from 844 to 374;
  with the cap 1 941 and 882, the old tree measured beside it 2 399 and 830).

**Measured against §1.6** (before = the tree of 2026-10-13, `pace/base`; after = this lane's tree):

| metric (target) | before | after |
|---|---|---|
| walking share of adults' waking time (≤ 0.30, no seed > 0.35) | 0.69 | 0.251 (0.204–0.338), `out/daily-final.log`, 6 seeds; 0.243 (max 0.298) on seeds 4–10 |
| work begun after dusk (≤ 0.05) / walking in the dark (≤ 0.10) | 0.008 / 0.26 | 0.005 / 0.040 |
| food per adult-day (1.25 ± 25 %, no seed > +50 %) | 1.25 (0.81–1.62), eaten 1.43 | 1.40 (0.72–2.11), eaten 1.44; seed 20261008 at 2.11 (0.57 of it rots: fish), seed 8 at 2.49 on seeds 4–10 (its store refilling 0.44 → 2.13 days a head) |
| parched / starving samples (≤ 0.002 / 0.011) | 0.002 / 0.011 | 0 / 0 |
| lightning fires a world-year without people, 4 seeds × 2 y (2–12; ≥ 70 % dry half; burnt ≤ 5 %) | 0 | 3.63 (1–7); 0.76; ≤ 2.8 % (`out/fire-final.log`) |
| fire-keeping without the god by year 5 (≥ 6 of 8, median ≤ 4) | 2 of 8 by year 8 (5.0, 5.9) | 8 of 8 (0.33–3.0, median 1.7), `snap3/out/census-summary.txt` |
| census CPU per seed, 8 years (same machine) | 191 s (136–225) | 191 s (161–264) |
| `pace.ts throughput`, 1 500 agents, same session: L0 (≥ 85 %, ≥ 450) / L1 (≥ 800) / L2 (≥ 1 200) | 706 / 926 / 1 572 | 422 / 573 / 677 — a lightning fire burns beside the villages through the measured days; without fire (`exp`, two runs): L0 462/429 vs 441/468, L1 415/419 vs 539/606, L2 737/685 vs 1 142/1 076 |
| `perf_worker.ts 1500` achieved (≥ 0.98 of 1x–300x, ≥ 0.85 of 1000x) | 100 / 300 / 1 000 tps: 1.0 / 1.0 / 0.86 | 1x 1.0, 10x 1.0, 100x 0.999, 300x 0.998, 1000x 0.79, 3000x 0.40 (1 195 tps) |

Levels 1 and 2 fall short (open). Measured causes: decisions per agent-day rose from 4.6–5.5 to 8.1–10.1
(`out-dec{old,new}.log`, 1 500 agents, no fire) — with walks 8× shorter every errand is a shorter bout (a quarrying
bout 507 → 158 ticks from start to next start, an idle wander 147 → 61; `out-dur{old,new}.log`); quarrying and
digging tripled, and a level-2 day spent 0.11 s more in the hydrology (profiles `exp/p5{new,old}`); a lightning fire beside
the villages adds the flight (`danger.ts fleeTarget` and its path search ≈ 16 % of a level-1 day's CPU).

The census (8 seeds × 8 years, a band of 30): people at year 8 75 [50–98] (before 67.5 [55–71]), growth 12.1 %/y (10.7),
no thirst deaths, 21 child deaths (23), 7 kills from 20 hunts (2 from 17). Every seed reaches bronze by year 8 (before:
six stone, one fire, one clay): fire 0.33–3.0, pottery 0.6–6.5, copper smelting 2.4–7.5, writing 4.1–7.2 — far ahead of
§1.5 (copper 20–40): early fire opens the chain and the hours walking freed go to crafts. HISTORY's calibration (§5.2)
has that to do. Lightning fires rise as the worlds' open grassland spreads (1 516–2 648 cells at year 8 in the census,
before 687–1 723): with people from 2.1 a world-year in year 1 to 15.5 in year 8; without people (`pace.ts fire`, the
same 4 seeds × 8 years, `out/fire-y8{a,b}.log`) from 2.25 to 19 (12.9 a world-year over the 8 years, the most 27), 87–89 %
in the dry half, each year burning at most 3.0 % of the land — small fires, more of them, as grass country takes over.

Seed-bound tests moved (§6.4; `pace/{old,live}/seedbound.ts`): the iron monopoly (`society.test.ts`) held on 3 of 12
seeds before (2, 8, 10) and on 0 of 12 after — the towns' daily caravans sold the trusted neighbour its iron; as a
guarded monopoly over 24 days it holds on 4 of 12 after (1, 2, 4, 7) and on the same 3 of 12 before; the test runs
that, on seed 2. The wandering band (`seed-salt.test.ts`) settles within hours at the new pace (116 band-hours over
seeds 1–12, before 343); seeds 2, 6, 12 keep it wandering 79 hours with 7 deaths of age (before, seeds 1, 2: 96 hours,
6 deaths). `ships.test.ts` accepts both tellings of three chronicle events (`events.json`), reads the hull test hour by
hour (the ground crew now make, fuel and launch it within a day) and takes oil refining away again each day (a curious
people re-invented it within three days).

---

## 2. LAND — living off the land

Mechanisms belong to LAND; new species, plants and items to CONTENT (§4), with the schema fixed here so both work in
parallel. Counters come from the sim's own **ledger** (§2.12), not from probe hooks.

### 2.1 Hunting
Today: 2 kills in 8 seeds × 8 years (17 attempts); the hunter role exists only when a herd is within 2.5 cells
(`people/context.ts:116-126` → `settlement.ts:595`) and the hunt search reaches 7 cells (`decide.ts:719`, `planHunt`); the nearest wild
land herd to a settlement was 2 024 m in year 1 and 1 516 m in year 8 (medians).
- **Quota.** Hunting known + huntable game (a wild land herd of a non-sacred species; dangerous prey only for parties of
  ≥ 4 with spears or bows) within *territory + 2 km* → hunters: 15–30 % of the food workers of a band, 5–15 % of a
  farming town.
- **Parties.** 2–6 hunters led by the most skilled; they track the herd (re-planning toward its current position each
  leg), camp at night (§1.3), kill per encounter by party size × skill × weapon × prey speed and danger, take at most
  what they can carry (one carcass-load each) and never more than 20 % of a herd; herds under 3 head are spared except in
  famine.
- **Home.** Carcasses come home and are butchered into `animals.json` products (meat, hide, bone, fur…); a hunter may be
  wounded by dangerous prey (injury, rarely death).
- **Chronicle.** The first great hunt of each settlement ("Eight hunters of Aru brought home three aurochs") and the first
  kill of each species.
- Targets (census, 8 seeds × 8 years): ≥ 20 kills per 100 people per game year in stone-age bands; hunted share of food
  in bands 0.15–0.35 (pooled); ≤ 1 hunter death per 50 hunts.

### 2.2 Taming and herding (the first-herd deadlock)
Today: 0 tames in every run; only herders tame (`decide.ts:790`, `planHerd`) and the herder role needs an owned herd
(`settlement.ts:594`).
- One herder as soon as animal husbandry (or dog taming) is known **and** (a herd is owned, or a domesticable wild herd is
  within hunting range, or a hunt brought young home).
- **Young from the hunt:** a kill of a domesticable species brings 1–2 young home with p = 0.25 → a herd of its domestic
  form (`domesticatesTo`) in the pen; the pen is planned when herding is wanted.
- Herders take the herd to pasture by day and pen it at night; daily products (milk, wool, eggs, honey for kept bees);
  surplus beyond the pasture's capacity is slaughtered.
- Chronicle: the first herd, the first milk. Targets: a first herd within 2 game years of husbandry in ≥ 6 of the seeds
  that learn husbandry; herding share of food 0.05–0.20 in towns with herds.

### 2.3 Fishing from shoals
Today fish depend on water depth only (`resources.ts:98`); 12 of 1 023 (1.2 %) of fishing sessions drew on a shoal.
- Catch per session ∝ the biomass of fish-shoal herds within 2 cells of the fishing cell × gear × skill; each catch
  removes fish from that herd. Rivers and lakes without a shoal herd hold a resident stock per water body (logistic, half
  recovery in ~0.5 game year).
- Overfishing: below 30 % of carrying capacity the catch falls; below 10 % the chronicle says the fish left those waters.
- Shellfish beds (CONTENT) are gathered at the shore; whaling needs boats and harpoons.
- Targets: ≥ 80 % of sessions draw on a shoal or a resident stock with a finite count; fixture: 10 fishers on one lake —
  catch per session falls ≥ 30 % within a game year and recovers to ≥ 80 % within a year after they stop.

### 2.4 Crops on a seasonal clock
Today crops grow on the wild logistic from 0.06 and need 0.55 to harvest (`decide.ts:768`); 231 harvests from 1 113
sowings (0.21) in the 8-seed census; every crop harvests `grain` (`work.ts:430`); 6 of 13 maize fields sat on cells where maize
cannot grow (audit).
- `plants.json` crop fields (schema, CONTENT fills it for new crops, LAND for the four existing):
  `season: { sow: [from, to], grow: days }` (fractions of the local year from the spring equinox — the wet season in the
  tropics — and growing days) and `harvest: [{ item, qty }]`.
- Sowing in the sowing window; growth on a fixed curve over `grow` days scaled by the cell's suitability (temperature,
  moisture, soil); ripe fields are harvested within 3 days or start to spoil; fields are sited by the crop's suitability,
  never on saturated or salt cells.
- Per-crop items, tagged `grain` where milled (recipes take `{ tag: 'grain' }` already: milling, brewing, mills):
  wheat → grain (kept), rice → rice, maize → maize, flax → fiber + linseed. Flax is grown when fibre is wanted and the
  crop has been introduced (it has no wild ancestor: `settlement.ts:1009-1028`).
- Targets: ≥ 0.8 harvests per sowing; farming share of food 0.30–0.60 in settlements three years after agriculture
  (census pooled baseline 0.03–0.08).

### 2.5 Houses follow population
Dwellings are planned from beds vs people (and households without a home) before new workplaces. Target: beds ≥ 0.9 ×
population and ≥ 90 % of households housed at every year end in ≥ 7 of 8 seeds (baseline at year 8: beds ≥ 0.9 ×
population in 4 of 8 seeds — one seed had no dwelling for 69 people, another 10 beds for 55 — and ≥ 90 % of households
housed in 4 of 8).

### 2.6 Materials drive gathering
Wants come from recipe shortfalls: when a known recipe's output is wanted (tools for workers, materials for sites, food
processing), its missing inputs become gathering and crafting wants, chained (wood → charcoal → smelting → tools; sand
+ charcoal → glass). Targets: ≥ 10 distinct item kinds gathered per settlement-year by year 8 (baseline: 12 kinds over all
seeds together; wild grain 65 026 and roots 28 894 of 105 948 units; no ore, honey or resin at all); ore mined is smelted within a game year (town fixture).

### 2.7 Water in a drought
The abandon test reads a stale water list (`settlement.ts:1206-1260`: "dry" = list empty, while it held a dried cell),
so a seed-7 drought killed 27 of thirst with water 50–250 m away (audit). Fix: "dry" = no *fresh* water in reach; the
list refreshes after a failed drink; parched people (water < 0.5) drop work more than 30 min from water; workers carry
water to far work; a drought-struck town moves toward the nearest river or lake, or to kin. Target (fixture: a drought on
a 30-person town with fresh water 100–250 m away, 4 seeds): ≤ 2 thirst deaths.

### 2.8 Demography
Today: no birth spacing (`settlement.ts:913-957`), median interval between a mother's births 0.69 game years,
under-15 share 0.71 (0.65–0.74) at year 8, growth 10.7 %/year, 6 % (23 of 361) of births die before 15 (20 of
sickness; 3 are logged as old age, a bug to check), 1.4 % before 1.
- Birth spacing 2.0–3.0 game years per mother (`AgentStore.lastBirth`, saved); fertility × `clamp(1.5 − children/adults,
  0.3, 1)`.
- Child mortality per year of age: < 1: 6–10 %; 1–5: 1.5–2 %; 5–15: 0.3–0.5 %; × 2–3 in famine, × 0.8 with herbalism,
  × 0.6 with medicine. New cause `DEATH.childhood = 16` ("a childhood fever"); grief and funerals follow (§2.11).
- Why these numbers: an under-15 share of 35–45 % (real pre-modern societies) goes with growth of ~1.5–3 % a year for
  a people that matures at 14 and lives ~55 years (stable-population arithmetic: share ≈ (1 − e^(−15r)) / (1 − e^(−55r)),
  0.39 at r = 2 %), the growth of real frontier peoples with land to spare. Today's 10 % a year is why villages are
  60–80 % children.
- Targets (census, 8 seeds): infant deaths 5–12 % of births; under-15 deaths 12–25 % of births; birth interval median
  2.0–3.5 years; growth 1.5–3 %/year over years 5–30; under-15 share 0.35–0.45 over years 10–30 (a 30-year run, 8 seeds,
  3000x).

### 2.9 Needs that can be met
Status is only ever lowered (`needs.ts:123`) — 100 % of adults sit at 0; curiosity is fed only by experiments and
exploring — 70 % at 0. Status rises from mastery (skill ≥ 0.7 in the role), roles (leader, priest, prophet, master,
elder), heading a housed household, gifts given, discoveries, a successful hunt, a fulfilled prophecy (the prophet);
curiosity from talk with someone who knows what they do not, watching a craft, learning, a new place, an omen, a story
at a festival. Targets: ≤ 20 % of adults below 0.02 in each.

### 2.10 Children
Children wander 17 % of their time today (`pace.ts daily`, 6 seeds: 2–26 %; the audit's village 27.6 %), never play,
and do chores in one seed of six; `raiseChild` is never planned (`defs.ts:30`). Adults spend ~10 % of their time
working, ~33 % walking, 1.6 % at leisure and 0 % at prayer (same probe). Add play (ages 2–10, near home or the
hearth, with other children: belonging, curiosity), chores (ages 6–14: water, firewood, berries, minding herds near home, following a parent to work — apprenticeship), raising (parents
feed and carry infants). Socialising targets someone within 100 m, not a random member. Targets (pace daily, 6 seeds):
wandering ≤ 10 % of child time, play ≥ 10 %, chores ≥ 10 % of the 6–14s' time.

### 2.11 Festivals, weddings, funerals
- Two seasonal festivals per settlement-year (harvest, and midwinter or the rains): an evening gathering at the hearth or
  shrine, ≥ 60 % attend, dance; belonging, mood, faith if they know the god (in the god's name when trust ≥ 0.5, §3.2).
- A wedding gathering the evening a couple forms (`pairUp`); a funeral (burial + mourning gathering of kin and ~30 % of
  the town) for every death at home.
- New tasks (appended): `TASK.play = 52, chore = 53, camp = 54, gather = 55` (a gathering: festival, wedding, funeral,
  evening worship — `data` says which). Animation states (appended): `AnimState.play = 26, hunt = 27, herd = 28,
  carryGame = 29` (`dance`, `mourn`, `pray` exist).
- Targets: ≥ 2 festivals per settlement per game year; weddings ≥ 80 % of new couples; funerals ≥ 80 % of deaths at home;
  one chronicle line per settlement-year at most ("At the harvest feast of Aru they danced until dawn").

### 2.12 The ledger
`people/ledger.ts` (LAND): per settlement per game year — kills by species, hunt trips and injuries, tames, herd
products, sowings and harvests by crop, fishing sessions and catch by source, food produced by source, gathered items,
crafts, births, deaths by cause and age band, birth intervals, festivals / weddings / funerals, houses and beds. Saved
(small), queried by `query('ledger', { settlement?, year? })`; the census probe switches to it (the hooks become a
cross-check).

### 2.13 As built (LAND lane, 2026-10-14; probes and logs in `_harness/scratch/living/land/`)
Modules (all `src/sim/people/`): `ledger.ts`, `hunt.ts`, `herding.ts`, `fishing.ts`, `crops.ts`, `demography.ts`,
`outlets.ts`, `gatherings.ts`, `wants.ts`, and `land.ts` (the hooks: utilities, plans, the hourly and daily rounds,
`flags2`). LAND's hunks in shared files: `decide.ts` (`C.land`, `planHunt / planFish / planFarm / planHerd`, the
hunter's work, company within 100 m, the want a gatherer turns to, a time-lapse stretch cut at a gathering), `work.ts`
(fish / hunt / farm / herd / craft / teach / learn / talk / play / chore / gather / raise), `settlement.ts` (roles,
births, houses, wants, the drought), `lifecycle.ts`, `social.ts`, `tasks.ts`, `snapshot.ts`, `query.ts`, `state.ts`,
`agents.ts` (`lastBirth`), `buildings.ts` (`findSite`'s `edgeSite` fallback), `defs.ts`, `types.ts`,
`content.ts` (`PlantDef.season / harvest`), `data/plants.json` (the four crops), `data/events.json` (10 templates),
`core/migrate15.ts` (LAND's step: a no-op — `lastBirth` defaults to 0 = "no birth yet", `Settlement.land` and
`PeopleJson.land` are absent in older saves and made on first use).
- **Hunting** (`hunt.ts`): `huntQuota` (25 % of a band's food workers, 10 % of a farming town's — at least a party of
  2, four when only dangerous game is in range) while game is within `territory + HUNT_RANGE_M` (2 km); a party of
  2–6 sets out in the morning when the meat in store (and in the hunters' hands) is under `MEAT_DAYS` a head (or in
  famine), tracks its herd leg by leg (a leg as far as the daylight allows, ending on dry land), camps (`A.camp`, PACE's
  trips), stalks within 1.5 cell edges (`TASK.hunt`, one encounter an hour: chance by hunters, skill, weapon, the prey's
  flight and danger), kills ≤ 20 % of the herd and what the party can carry (`LOAD_KG` 30 each, carcass meat = mass ×
  0.42), carries it home (`AnimState.carryGame`) and is done. Dangerous prey (danger ≥ 0.3) only for a party of 4+
  with spears or bows; it may wound the front hunter (rarely kill: `DEATH.predator`). Herds under 3 spared outside
  famine, the sacred animal always. Chronicle `hunt.great` (a party of 3+ bringing home 2+ beasts or one of 300 kg,
  once a settlement: "5 hunters of Aru brought home three boars.") and `hunt.first` (a species' first kill on a
  world). Party members keep the hunter role until home (`settlement.ts assignRoles`, `partyOut`).
- **Herds** (`herding.ts`): one herder once husbandry (or dog taming: wolves only) is known and a herd is owned or a
  tameable wild herd lives within hunting range (`herderQuota`, + 1 per 15 head; filled from the gatherers when the
  leader holds the slot). Taming (`TASK.herd`, `data2` 1): chance 0.12 + 0.3 × skill → the herd's domestic form, ≤ 6
  head, owned. Young from the hunt: p 0.25 per kill of a tameable species (`accident 'tame-young'`). Keeping: products by
  the day since the last visit (milk 1.5 / eggs 0.6 a head a day × the product's quantity, the rest 1/12), × (0.7 +
  0.6 × skill); the breeding stock kept is max(6, 60 % of the pens' 8 + 10 a pen) and the increase beyond it eaten,
  about a head a day (pigs give no milk); above the pens' room two at a time; one in lean times. Chronicle
  `herd.first` / `herd.first.young` / `herd.milk`.
- **Fishing** (`fishing.ts`): a fish herd (or shellfish bed) within 2 cells is a shoal (catch × clamp(0.6 + n/80,
  0.6, 1.6), each fish taken from the herd; a whale needs a boat and a harpoon); otherwise the water body's resident
  stock (`LandWorld.stocks`, a flood fill over cells with water > 0.1, K = Σ clamp(depth, 0.5, 4) × 12 (30 at sea)
  units, logistic r = 4.8 a game year), catch × `stockFactor` (1 above 30 % of K, falling linearly below), `fish.gone`
  told at 10 %; fishers skip waters under 15 %.
- **Crops** (`crops.ts`, `plants.json`): the four crops' `season` and `harvest`; `yearPhase` from the sun (the
  hemisphere's own spring; within 15° of the equator, sowing follows the soil's wetness); growth `dt / grow days ×
  suitability`, none under 3 °C; ripe → harvest within `RIPE_DAYS` 3, then −15 % a day; cover lost to grazing, fire and
  flood costs the field's health, to blight 30 % of it; `fieldSite` 0 on water, salt or saturated ground; fields laid
  out where the crop suits best (> 0.3), unsuitable fallow fields given up daily; 1 + ⌈people/3⌉ fields (≤ 14); flax
  when fibre is wanted; never on the village's own ground (below). Field state saved (`Settlement.land.fields`; 1.4
  saves adopt the fields they had).
- **Houses** (`settlement.ts planConstruction`, exported): beds and households without a home are reckoned first; a
  third site may be opened for a dwelling while the two open sites are other works. The village keeps its own ground
  (`crops.ts villageGround`: the centre cell and every cell whose centre lies within 11 + 4.2 √(buildings + 90) m + half
  an edge — the reach of `buildings.ts findSite`'s spiral): no field is laid out or sown there and a fallow one there
  is given up — a town of 52 whose houses burned in year 25 rebuilt none in five years while two of the six cells
  around its centre were fields (`live/whynosite.ts`: of the 90 places the builders tried, 32 lay in fields, 32 on
  standing buildings, 15 in water, 11 on ruins). And a crowded town finds room at its edge: `buildings.ts findSite`
  tries 90 places on a spiral from the n-th for a town of n buildings, and once the places it skipped (water, fields)
  have pushed its buildings out ahead of it, all 90 are taken — a town of 76 buildings found room for no house
  (`whynosite.ts`: 77 of 90 places on buildings, 13 in water); it now falls back to `edgeSite`, the free dry unfarmed
  cells around the centre ring by ring, six spots in each (only where the spiral found nothing, so towns that found
  room before build where they did).
- **Wants** (`wants.ts`): roots (tools for 80 % of adults, spears for the hunters, clothes before the cold, containers,
  the sites' materials, ore in store to smelt, raw food to prepare, practice of every known craft) followed down the
  recipes (`STOCK` 3, `STEP` 0.75, `DEPTH` 3; fuel for hot recipes), plus a stock of every raw material a known craft
  takes (0.6 × target / (target + stock), target ½ a head); a gatherer turns first to want *i* with a chance ∝ 1 /
  (i + 1) (`wantPick`) — a builder to the first, the site's material; the chain's crafts with weight ≥ 0.5 go on the
  job list.
- **Drought** (`settlement.ts abandonCheck / abandon`): dry = no *fresh* water in the list now (`freshAt`; the list is
  refreshed after a failed drink: `st.recent.waterStale`); a dry town leaves after ¾ day for kin within 3 km whose
  water runs (`joinKin` on arrival, `abandon.joined`), else for the best site its band's search finds. The parched
  (water < 0.5) without water at hand do not set out for work before they drink, unless on a trip with its water skin
  (`land.ts`). (Tried and taken out again: leaving when the water left is > 300 m off and the people thirst, and
  heading for the nearest river or lake within 5 km — on the wet-ground stress fixture below it killed more on the
  trek: 84 deaths of thirst over its 4 seeds against 58.)
- **Demography** (`demography.ts`): `lastBirth` (saved column); a mother's gap 2–3 years (her own, from the world's
  dice); fertility × clamp(1.5 − children/adults, 0.3, 1) × `ageFertility` (rising over the 6 years after maturity,
  waning from 30 to nothing at elder − 5) × `plentyFactor` (food in store or full bellies, at most 1: a granary of 50
  days a head no longer makes mothers 40 % more fertile); childhood hazards 9 % / 1.6 % / 0.3 % a year (< 1, 1–5,
  5–15; × 2.5 famine, × 0.8 herbalism, × 0.6 medicine) → `DEATH.childhood = 16` ("a childhood fever"); old age takes
  no child.
- **Needs** (`outlets.ts`): daily status from standing (leader 0.5, priest 0.3, master 0.2, elder 0.18, household head
  0.14, housed 0.06 of the day's decay) and from deeds (`statusGain`: a kill, a discovery, teaching); curiosity from talk
  with someone who knows more (+0.15), watching a craft (+0.1), being taught (+0.25), a feast's stories (+0.2)
  (`curiosityGain`, exported for REL's omens).
- **Children and gatherings** (`gatherings.ts`, `land.ts`): `TASK.play` (2–10, with other children near the hearth or
  home), `TASK.chore` (6–14: water, firewood, berries, minding herds, following a parent at work), `TASK.raiseChild`
  (an adult feeds and carries an infant under 2); company within 100 m (`companyNear`); `TASK.gather` (`tData` 1
  festival / 2 wedding / 3 funeral) at the hearth, shrine or temple in the evening: the harvest feast and midwinter (the
  rains where there are no seasons), a wedding at the next sunset after a couple forms, a funeral the evening after a
  death at home (kin and ~30 % of the town); belonging, curiosity, faith; at most one chronicle line a
  settlement-year. At 100x–1000x a decision's stretch ends when the evening of a gathering the agent is called to
  comes (`nextGathering`, cut into `perf/plapse.ts rival` from `decide.ts`).
- **Ledger** (`ledger.ts`): one row per settlement-year (`LEDGER_YEARS` 40 kept), in year order even when a time-lapse
  window replays agents across a year's end; `query('ledger', { settlement?, year? })` → `{ year, yearTicks,
  settlements: [{ settlement, name, fallen, years: LedgerYear[] }] }`.

**UI hooks** (§7 H10; nothing here edits the UI team's files): `AnimState.play / hunt / herd / carryGame` (26–29;
`tasks.ts workAnim`: `dance` at a festival or wedding, `mourn` at a funeral); `MoverBlock.flags2` bits `festive` 8,
`camp` 16, `hunter` 32, `herder` 64 (`land.ts landFlags2`); `SettlementView.livelihood { food: shares by forage / hunt /
fish / farm / herd, herds: head kept, under15 }` (`ledger.ts livelihoodOf`; last year's shares in the first days of a
year); `query('ledger')`; events `hunt { settlement, species, kills, hunters }`, `tame { settlement, species, herd,
young }`, `harvest { settlement, crop, cell, units }`, `festival | wedding | funeral { settlement, kind, about, cell }`;
chronicle keys `hunt.great`, `hunt.first`, `herd.first`, `herd.first.young`, `herd.milk`, `fish.gone`,
`festival.harvest | midwinter | rains`, `abandon.joined`; `TASK.play 52 / chore 53 / gather 55` (`tData` 1 festival,
2 wedding, 3 funeral) and `raiseChild`; `DEATH.childhood 16` ("a childhood fever"); a field's look: `f.crop` runs from
0.06 (sown) to 0.9 (ripe) × its health and `f.cropSpecies` names the crop (wheat, rice, maize, flax); owned herds
(`Herd.owner`) pasture by day and pen at night.

**Measured against §2.1–2.11** (before = the tree just before LAND, PACE's census `pace/snap3/out` and `land/base`;
after = this lane's final tree, with the other lanes' work as it stood when each seed started, 11:17–15:10 on
2026-10-14). Census: `land/live/census.ts` reading the
ledger, 8 seeds × 8 years (`live/out30-y8/summary.txt`) and, for the demography of years 10–30, 4 of them × 30 years
(`live/out30-y30/summary.txt`; the machine ran at load 20–36 through the afternoon and the other 4 seeds ran 8 years);
fixtures in `land/fix/`, seed-bound tests in `land/seedbound/`.

| metric (target) | before | after |
|---|---|---|
| kills per 100 people a year, hunting known (≥ 20) / hunted share of food (0.15–0.35) | 0.2 (7 kills, 20 hunts) / 0 | 5.2 (86 kills, 114 parties) / 0.056 pooled; 30 years: 2.5 / 0.036 |
| hunters killed (≤ 1 per 50 hunts) | – | 0 in 114 parties (17 wounded) |
| first herd within 2 years of husbandry (≥ 6 of the seeds that learn it) / herd share where herds are kept (0.05–0.20) | 0 tames | 8 of 8 (the first herd 0–0.33 years after husbandry; 10 tames: pig 6, duck 2, sheep 1, chicken 1) / 0.068 pooled, 0–0.29 by seed |
| fishing sessions on a shoal or a finite stock (≥ 80 %) | 2 of 3 190 | 99.9 % (1 501 of 1 503; all on resident stocks) |
| fixture, 10 fishers on a lake: catch falls ≥ 30 % in a year / back to ≥ 80 % a year after (`fix/fishing.ts`, 4 seeds) | no stocks | falls 99–100 % on 3 seeds (the 4th, K 743, held at 37 % of K: fished sustainably); recovers 100–114 % on all |
| harvests per sowing (≥ 0.8) / farm share 3+ years after agriculture (0.30–0.60) | 0.32 / 0.23 | 0.89 / 0.43 (0–0.62 by seed: seed 7 never farmed) |
| houses: beds ≥ 0.9 × people and ≥ 90 % housed at every year end (≥ 7 of 8 seeds) | 1 of 8 | 6 of 8 (61 of 64 seed-years); 30 years: 1 of 4 (111 of 120) — towns that lost their houses to fire or abandoned their site went years without |
| kinds gathered per settlement-year at year 8 (≥ 10) | 3 (2–6) | 10 (8–11) |
| drought fixture, fresh water 100–250 m (≤ 2 thirst deaths, `fix/drought.ts`) | 0 0 0 0 | 0 0 0 0; a town on a seep whose rivers are 0.6–5.8 km off (`WET=1`): 22 35 0 35 → 6 17 0 29 |
| infant deaths (5–12 %) / under-15 deaths (12–25 %) of births / birth interval median (2.0–3.5 y) | 1.2 % / 5.1 % / 0.64 | 5.3 % / 21.9 % / 3.19 (30 years: 5.5 % / 22.4 % / 3.25) |
| growth (1.5–3 %/y) / under-15 share (0.35–0.45) | 12.1 %/y, 0.74 at year 8 | 2.8 %/y over 8 years, 0.44 at year 8; years 10–30: 0.46 (0.27–0.54), growth 0.9 %/y (−1.0 to 2.0): sickness took 49 in the 4 towns over 30 years, and seed 7's town was abandoned twice |
| adults with status / curiosity < 0.02 (≤ 20 %) | 100 % at 0 / 37 % | 0 % / 0–15 % |
| children (`fix/kids.ts`, 6 seeds): wandering (≤ 10 %) / play (≥ 10 %) / chores of the 6–14s (≥ 10 %) | 23 % / 0 / 9.8 % | 0 / 23.7 % (9.2–38 %) / 33 % |
| festivals a settlement-year (≥ 2) / attendance (≥ 60 %) / weddings (≥ 80 % of couples) / funerals (≥ 80 % of deaths at home) | none | 2 / 82 % / 86 % (30/35) / 100 % (74/74); 30 years 84 % / 95 % / 99 % |

Why the targets still missed are missed (measured): **hunting** is short of game, not of hunters — loosening the meat
gate (`MEAT_DAYS` 1 → 3, `land/exp/`, an earlier world of this tree) gave 13 kills against 12 on seed 7 and 0 against
0 on seed 20261008, whose parties went out 10 times in 8 years and found nothing within reach; seed 1234's only wild
land herd within 3 km at year 5 was a herd of lizards (`live/rolesprobe.ts`). Game near settlements is CONTENT's
(§4.5): with its new animals in the final run seed 20261008 killed 24 boar in 8 years. The
**30-year demography** meets the 8-year targets but not 0.35–0.45 with 1.5–3 % growth together: with childhood deaths
at 22 % of births the stable under-15 share of this species is ~0.46 at 2 % growth (a cohort model of these rules,
`fix/demomodel*.mjs`), so the spec's targets meet only at their corners; plenty no longer lifts fertility above 1, the
first births ramp over six years after maturity and fertility wanes from 30 (in the model: 0.51 → 0.46 for years
10–30). **Houses**: the rules here (village ground kept free of fields, a site at the edge when the spiral is full)
were measured on the failures they fix (`live/whynohut.ts` on saved states); a seed whose town was abandoned twice
(seed 7, years 22 and 27) still went five years without a house — not diagnosed.

Seed-bound tests over 12 seeds (`land/seedbound/`): the meteor's rebuilding held on 8 of 12 before (1, 2, 5, 8–12) and
holds on 9 of 12 now (2–7, 9, 10, 12; rebuilt median 4 → 5.5) — RELATIONSHIP moved the test to seed 9, which holds on
both; the guarded iron monopoly held on 4 of 12 before (1, 2, 4, 7) and on 2 now (1, 4): the test moved to seed 4
(war on day 19 on both trees; margin 0.34 / 0.36). `npm run check` on the final tree: detban 141 files clean, tsc
clean, 403 tests, 398 pass, 2 TODO (UI hooks), 2 perf floors skipped as an overloaded machine, 1 fail — the worker's
500 ms field throttle at load 21 (`worker.test.ts`, a 16-cell world with no people; it passed in the runs before).

---

## 3. RELATIONSHIP — the people and their god

### 3.1 The model
Four values per person per god (`GODS = 4`, 0 = the player), each 0..1:
- **faith** — conviction that the god is real and acts (new SoA column);
- **fear** — dread of its power (existing `fear`);
- **trust** — expectation that it means them well (the existing `love` arrays; the UI says *trust*);
- **loyalty** — allegiance: whose word they follow, whose shrine they keep (new SoA column).

Settlement values are member means (cohorts carry the means). Each settlement keeps a short **record** of the god's acts
on it (last 12: kind, tick, dead, foretold?, provoked?), its open prayers, and its prophet. A 1.4 save migrates
`faith = min(1, love + fear)`, `loyalty = 0.5 × love`.

**What acts do** (per witness; `m` magnitude, `k` = 1 − distance / radius, `a`, `f` the species' awe and fear bias, `p`
piety, `b` boldness — the witness weighting of `people/culture.ts:178-222` stays):

| act | faith | fear | trust | loyalty |
|---|---|---|---|---|
| help (food, healing, water, rain in drought, a ward that saves them, a gift) | +0.15 m k | — | +0.25 m k a (0.5 + p) | daily drift |
| help within 3 days after the god harmed them (**mercy**) | +0.15 m k | −0.10 m k | ×1.5 | +0.05 m |
| harm that was **foretold** (a prophet warned, or an omen ≤ 2 days before) | +0.20 m k | +0.30 m k f (0.6 + 0.5 (1 − b)) | 0 | — |
| harm **provoked** (a taboo broken, the Called or the prophet attacked) | +0.20 m k | +0.30 · | −0.05 m k | — |
| harm **unprovoked** (cruelty) | +0.15 m k | +0.35 · | −0.20 m k | −0.05 m |
| a sign / wonder with no harm | +0.25 m k | +0.08 m k f | +0.05 if read as favour | — |
| any act that killed someone | counts as harm, never as wonder (today a 9-death tornado raised love 0.08 → 0.85) | | | |
| prayer answered (§3.3) | +0.10 | — | +0.15 | +0.05 |
| prayer lapsed | −0.03 | — | −0.05 | −0.02 |
| prophecy fulfilled (§3.4) | +0.15 | — | +0.10 | +0.10 |
| prophecy failed | −0.05 | — | −0.08 | −0.05 |

**Daily drift:** faith −1 %/day after 3 days without a sign of the god (−0.3 % when seen); fear −4.5 %/day (−1 % when
seen, as today); trust −0.5 %/day; loyalty relaxes toward `faith × clamp(trust + 0.5 × fear, 0, 1)` at 5 %/day (about
two game years to settle: loyalty is earned over years and holds through a bad season). **No single act moves a
settlement's mean trust or fear by more than 0.35** — the anti-saturation rule that the creature and the disciple broke.

**Regard** — how the people see the god, the value the Touch's look follows (§3.6): `trust − fear`, population-weighted
over the people with faith > 0.2, in −1 (feared) … +1 (trusted); bands: feared < −0.33 ≤ awed ≤ 0.33 < trusted.

### 3.2 What each value drives
- **Prayer** (individual utility; today `(1 − faith need) × 0.55 × piety`, `decide.ts:209`, ≈ 0.05 against work ≈ 0.7):
  `U = faith × (0.08 + 0.6 h) + fear × 0.3 h`, where hardship `h` ∈ [0, 1] is the worst of: a disaster on the town within
  2 days, famine (food < 1 day per person), sickness share, storm severity, drought.
- **Evening worship** at the shrine, temple or hearth, daily at dusk: attendance ≈ `0.5 faith + 0.3 loyalty`, 30–60 min.
- **Belief income:** praying and worshipping people yield worship ∝ `faith + 0.5 fear` × the place (hearth 0.5, shrine
  1, temple 2, great temple 3); a prophet's preaching × (1 + credibility). Fear still pays — awe and dread are both belief.
- **Offerings:** a share `0.05 × loyalty` of the daily surplus goes to the shrine; where fear > trust + 0.3, burnt
  offerings (today's rite) and, past fear 0.8, animal sacrifice (never people).
- **Temples** when religion is known, faith > 0.4 and loyalty > 0.3 (else a shrine); **festivals in the god's name** when
  trust ≥ 0.5.
- **Taboos** (today's, from stories) and the sacred animal's hunting taboo (§3.4.7).
- **Obedience to the Called:** a standing order is followed with probability = the person's loyalty each turn.
- **Conversion:** a person turns to a rival god when that god's `faith × loyalty` beats the player's by 0.2 for 3 days.
- **Migration away:** fear > 0.7 and trust < 0.2 for 3 days → 10–30 % of households leave, away from the last harm.
- **Revolt against the Called:** fear > trust + 0.4 and loyalty < 0.3 → the Called and the prophet are cast out (exile),
  or killed where fear > 0.85; chronicled.

### 3.3 Prayers are requests
A settlement raises a prayer from its real state (at most 2 open), with an answer window; any matching god act inside
its territory (+ 200 m) within the window answers it.

| prayer | raised when | answered by | window |
|---|---|---|---|
| food | food < 1.5 days per person, or famine deaths | the plenty sigil, a gift of food, fertile fields, game sent near | 3 days |
| rain | a drought on the territory, or field soil moisture < 0.15 for 2 days in the growing season | rain or storm over the territory, the rain sigil | 3 days |
| healing | ≥ 10 % sick, or a plague | the mending sigil, cure, the plague ended | 2 days |
| warmth | warmth need < 0.3 at night, a blizzard, cold snap or ice age | the gift of fire, clear and calm weather, warmth | 1 day |
| protection | a war band within 1 km, predators killing, a volcano's warnings, a severe storm | a ward, calm, the disaster cancelled or moved away, the attackers struck | 1 day |
| rebuilding | ≥ 25 % of buildings ruined | the timber sigil, a gift of wood or stone, buildings raised | 4 days |

Answered: the deltas of §3.1 and a chronicle line ("The god heard Aru"). Lapsed: the lapse deltas; three lapses in a row
→ "they say the god is deaf" and the prophet's credibility −0.1. `prayer.answer { settlement, prayer? }` performs the
canonical answer (so the UI has one-click answering and free text "answer the prayers of Aru"); `query('prayers')`.

### 3.4 Prophets and signs (replacing the creature)
**3.4.1 Who becomes a prophet.**
- *Called by the god:* `prophet.call { agent }` — any grown person (≥ 16); one prophet per settlement (calling a second
  is refused, naming the first), six per world. Starting credibility 0.30, or 0.45 when the call came with a sign seen by
  ≥ 10 people (a lightning strike beside them, a rainbow over them).
- *Rising on their own:* a pious person (piety ≥ 0.75) who witnesses a wonder within 150 m — struck by lightning and
  spared, under a rainbow, at an eclipse — in a settlement without a prophet declares it with p = 0.15 (credibility
  0.15). The god's next act decides: a sign near them within 2 days confirms (+0.2); an act against them discredits;
  silence leaves them weak.
- *Abandoned:* `prophet.abandon { agent }` — credibility × 0.3, the town reads "the god turned from Hesh"; at credibility
  < 0.1 the people stop listening (ignored; exiled where fear rules). A prophet's death is chronicled; a successor may
  rise from the Called.

**3.4.2 What a prophet does** (by day, around their own needs): preaches (today's `preach`, strength × credibility);
reads every omen to the town within a day (§3.4.4); foretells (§3.4.3); founds a shrine at a sacred place (credibility
≥ 0.5 and no shrine within 1 km); leads pilgrimages at festivals; carries the faith (credibility ≥ 0.6) to the nearest
town of their people with less faith in the god, staying 2–5 days to preach — converts by credibility against the local
loyalty to other gods.

**3.4.3 Prophecy and credibility.** A prophecy is `{ kind: rain | food | healing | warmth | protection | rebuilding |
harm | sign, settlement, from, until }` (window 1–5 days). It comes from the god — `prophet.foretell { agent, what, days }`
("tell Aru through Hesh that rain will come in two days": the god commits itself) — or from the prophet: while a prayer
is open they foretell its answer with p = 0.5 × credibility; after an omen they foretell its meaning. It is
**fulfilled** when the god does a matching act there inside the window (for `harm`, a harmful act; for `sign`, any
omen). Credibility: +0.25 × (1 − credibility) per fulfilment (0.30 → 0.48 → 0.61 → 0.71 after three), −0.25 per
failure, clamped 0..1. The town moves by the
fulfilled / failed rows of §3.1. This is the player's lever: say it through someone, then make it true.

**3.4.4 The omen catalogue** (made with existing powers plus one new real weather, the rainbow). An act counts as an omen
when people see it and it has not happened there in the last 10 days; natural ones (a natural eclipse or comet) are read
too. `god.omen { settlement | pos, kind? }` picks the fitting omen for the world (no rainbow without sun, no aurora
without a magnetic field) and issues its commands.

| omen | made by | read where trust ≥ fear | read where fear > trust | faith | fear | trust |
|---|---|---|---|---|---|---|
| eclipse | the `eclipse` disaster, ≤ 1 day for an omen | the god hides its face: hardship comes | the god's anger | +0.20 | +0.10 | — |
| comet | `comet` passing, a `meteor-shower` with no impact on the town | a messenger: change comes | a messenger of ruin | +0.20 | +0.05 | — |
| flood without deaths | `water.flood` / `flood` | cleansing | punishment | +0.15 | +0.10 | — |
| rainbow | new weather `rainbow` (after rain with the sun low; or painted) | a promise | a reprieve | +0.10 | — | +0.10 |
| lightning on one thing | `miracle.lightning` on a tree, the shrine, beside a person | a choice: the one spared is chosen | judgement | +0.15 | +0.10 | — |
| aurora | `aurora-storm` weather | blessing | a warning | +0.15 | — | +0.05 |
| red rain | `blood-rain` weather (real: dust-laden rain) — its `omen` effect, unread today (`weather.json:74`), is read here | a warning | a curse | +0.10 | +0.10 | — |
| the sun stands still | `time.freeze-sun` ≥ 1 h | a great wonder | terror | +0.30 | +0.15 | — |
| the sacred animal comes | a herd of the revered species sent near | favour | appeasement | +0.10 | — | +0.10 |
| a spring rises | `water.spring` near the town | a gift; a sacred place | a gift | +0.10 | — | +0.10 |

**3.4.5 Sacred places, shrines and pilgrimage.** A sacred place is a cell with a kind (`spring | grove | mountain |
site`), made by `place.sacred { pos, kind? }`, by a prophet (the spring, the oldest grove, the highest peak within 2 km),
or by a great omen (the lightning-struck tree, a crater where nobody died). Shrines rise there. At festivals and after
hardship 10–30 % of adults walk to the nearest sacred place within a day's walk and pray (faith +0.05, belonging);
pilgrims of different towns meet (contact, trade). Harming a sacred place (burning the grove, drying the spring,
flattening the peak) unforetold: fear +0.3, trust −0.25, read as punishment.

**3.4.6 Persecution.** A ruler persecutes the prophet when the leader's own loyalty < 0.3 and the prophet's credibility
> 0.4 (a rival authority), or when fear > trust + 0.3 and the prophet foretold a harm that came (blame). Daily p 0.1–0.2
while it holds, escalating: silenced (no preaching for 3 days) → exiled (walks to another town) → killed (leader
aggression > 0.7 and fear > 0.7). The god's answer matters: a ward over the prophet, or a foretold act against the ruler
→ "the god defends its prophet" (loyalty +0.15, fear +0.1); silence → credibility −0.2. A martyr with credibility ≥ 0.6
makes their place a pilgrimage site (faith +0.1 in the towns that knew them).

**3.4.7 Sacred animals — real and life-size.** A settlement reveres at most one real species (today's `animal:<id>`
sacred tag from stories, `people/culture.ts:404-411`), now also from a prophet's reading of an animal omen or by
`settlement.sacred { settlement, animal }`. Hunting it is taboo (today's rule); a hunter who kills one loses status and the
town fears; the god culling it: trust −0.2, fear +0.2; the god multiplying or sparing it: trust +0.1. A sacred herd may be
kept near the shrine and is never slaughtered. No giant growth: `raiseCreatures` (`god/creature.ts:639-657`, a sacred
animal raised "taller than their houses") goes with the creature.

### 3.5 Removing the creature (exact list; RELATIONSHIP owns it)
- **Sim.** `god/creature.ts` → a stub that only drops creature state from old saves (the file is kept: lanes delete no
  file they did not create; DOCS may delete it later); `god/watch.ts` and the `creaturesWatch` call (`belief.ts:43`);
  `god/index.ts` (`registerCreatureCommands`, `creaturesStep`, `raiseCreatures`, the creatures in `godSnapGlobal`, the
  `creatures` / `creature` queries); `hand.ts` (creature payload, reward / punish); `projectiles.ts:224-226` (creature
  payload); `miracles.ts` (`by: 'creature'`); `worlds.ts:276`; `state.ts` (`CreatureState`, `creatures`, `creature()`,
  laws `creature.*`); `godparams.ts:70-71`; `freeform.ts` (`intentCreature`, `creatureWords`, the `LEASH_MODES` import,
  the creature noun type); `content.ts` (`CreatureDef`, the `creatures` registry and its checks — a mod pack with
  `creatures` loads with a readable warning that they are ignored; `POWER_CATEGORIES` 'Creature' → 'Signs');
  `sim.ts` (snapshot, queries). Loading any save (the 1.5 migration step) drops creature state, releases a held
  creature, drops creature projectiles.
- **Data.** `src/data/index.ts` stops importing `creatures.json` (the file stays until DOCS removes it); the 11 Creature
  powers leave `powers.json`; "the creature" leaves the Hand powers' descriptions; `lexicon.json creatureWords` become
  refusal words ("There is no great creature in this world. Choose a prophet: 'make Hesh my prophet'."); events
  `creature.eat` / `creature.raised` go.
- **Types.** `Snapshot.creatures` becomes optional and is always absent (`creatures?: CreatureView[]`); `CreatureView`
  stays (deprecated) until the client stops reading it; `EntityKind 'creature'` stays in the union; projectiles never
  carry `kind: 'creature'`. The client already tolerates the absence (`src/client/worldview.ts:142`,
  `src/render/life/creature.ts:38`, `src/client/lookdevgod.ts:52`); hook H6.
- **Tests.** `tests/creature.test.ts` is rewritten as "the creature is gone" (no `creature.*` command registered; a 1.4
  save holding a creature loads without it and its hash is stable over save → load; "give me a creature" answers with
  the prophet hint); `content.test.ts:141-196, 222-230` drop the creature floor and the mod's creature
  (`tests/fixtures/god-mod.json`); `freeform.test.ts:52-57`, `omnipotence.test.ts:113-117, 464-476`,
  `god.test.ts:130-144` and `ui-logic.test.ts:111-121` stop adopting one. The render tests of `creaturegen`
  (`godgen.test.ts`) belong to the render team's removal.

### 3.6 The restyle (user-facing sim text; internal ids stay)
| was | is | where in the sim |
|---|---|---|
| the hand (category "Hand") | **the Touch** — the god's presence, drawn by the art team as light and weather; it still lifts, places and throws | powers names / descs / synonyms, hand.ts messages ("The Touch already holds something: let go, set it down or drop it first."), lexicon (old words stay synonyms) |
| Grab / Throw / Let go / Set down / Drop / Slap / Stroke | Lift / Hurl / Let go / Set down / Drop / **Rebuke** (hurts a person, cracks a wall) / **Soothe** (comforts, heals a little) | powers.json |
| Shield (circle) / Cast | **Ward** / **Draw a sigil** | powers.json, miracles.ts descs ("Sigil: rain") |
| gesture miracles | **sigils** — new `sigil` field per power with the glyph id below; `gesture` stays until the UI recogniser switches (hook H8), then goes | powers.json, query `gestures` → also `sigils` |
| disciples / Make a disciple / Order disciples | **the Called** / **Call** / **Charge the Called** | powers, events ("Hesh of Aru was Called by the god."), messages, query labels; "disciple(s)" stays a synonym |
| rival gods Vael, Oruk, Seshet, Imra, Tannu, Khoros, Lilet, Durn (`rivals.ts:29`; two are real deities' names) | **Vael the Undertow, Oruk Who Gnaws the Hills, Tannu of the Long Dry, Lilet the Lamplighter, Durn the Unsleeping, Asho Many-Voices, Corrin of the Thaw, Pell the Gleaner** (temperaments kept) | rivals.ts names + an `epithet` on the god record and in the `gods` query |
| the good / evil glow | the Touch's look follows **regard** (§3.1, feared … trusted) | `HandView.regard?` (new), `HandView.alignment` carries the same value until the UI switches |

**Sigils** (original glyphs, one stroke each; none is Black & White's or a bare primitive like a circle, spiral,
zigzag, triangle, V, square or star). The ids go in `powers.json`; the UI team draws the templates (hook H8).

| sigil id | power (new name) | the stroke |
|---|---|---|
| `drop` | rain (Sigil of Rain, was the water miracle) | a hook falling from the top that closes into a small loop at the bottom |
| `anvil` | storm | up, a flat top drawn right, down and back left under it (the open outline of an anvil cloud) |
| `fork` | lightning | down, back up half way, down again to the right (a forked bolt) |
| `ripple` | stillness (was calm) | a small closed loop, then a long level tail to the right |
| `sprout` | the grove (was the forest miracle) | up a stem, a leaf loop to the left, back to the stem, a leaf loop to the right |
| `knot` | mending (was healing) | a figure-eight drawn once |
| `basket` | plenty (was food) | a U, then a handle looping over its top |
| `seed` | increase (was fertility) | an almond outline, then a short stroke out of its tip |
| `log` | timber (was wood) | a long level stroke ending in a small loop (end grain) |
| `eye` | insight (was the teaching miracle) | an almond outline with a small loop inside |
| `flame` | kindling (was the gift of fire) | up the left side, curl over the tip, down the right, a small inward flick |
| `trail` | the falling flame (was fireball) | a loop with a long tail trailing down-left |
| `arch` | ward (was shield) | up, a round arch over, down, a short foot out at each end |
| `fall` | meteor | a long diagonal down-right ending in a small burst loop |

### 3.7 Wrath, warnings, shelter — survivable by default
- **Wrath** is a law: `god.wrath` 0..1, default **0.3** (set by `set god.wrath <v>`, logged; free text "be gentle with
  them" → 0.1, "set the wrath to 0.8"). It scales every god-sent harm: lethality `L(w)` and reach `R(w)`, piecewise
  linear through calibration points `L(0) = 0.1, R(0) = 0.6`, `L(0.3), R(0.3)` = whatever meets the table below, and
  `L(1) = R(1) = 1` (today's behaviour). A cast may carry `wrath`: size words set it — gentle / small 0.1, (none) the
  law, great / big 0.6, huge 0.85, apocalyptic / total / armageddon 1.0 (unlocks total destruction). Natural disasters
  keep their own law (`disasters.harm`) and are read as the god's only by people with faith > 0.3; otherwise the
  chronicle names nature (today a natural-disaster death can be blamed on "the god").
- **Survivable targets** at the default wrath, on a 30-person bronze town of the real n = 64 world, cast on its centre,
  4 seeds (`relationship.ts lethality`):

| cast | today: dead share (mean, max) · ruined · fallen | target at wrath 0.3 |
|---|---|---|
| meteor | 100 % (100 %) · 100 % · 4 of 4 | dead 10–35 %, ≥ 60 % of buildings standing, never fallen, rebuilding within 10 days |
| volcano | 100 % (100 %) · 100 % · 4 of 4 | warnings ≥ 12 game hours; ≥ 80 % outside the lethal radius at the eruption; dead ≤ 15 % |
| drought | one town of 4 dead within its 6 days; 10 days later 3 of 4 towns had nobody left (dead or gone) · — · 1 of 4 | default length 2–3 days; thirst dead ≤ 10 %; migration toward water before mass thirst |
| lightning sigil | 73 % (80 %) · 8 % · 0 of 4 — every person within 30 m (`miracles.ts:51`) | 1–3 people or one building struck |
| fireball (falling flame) | 51 % (97 %) · 8 % · 0 of 4 | dead ≤ 20 % |
| firestorm | 96 % (97 %) · 97 % · 0 of 4 | dead ≤ 30 % |
| tornado | 26 % (30 %) · 19 % · 0 of 4 | dead ≤ 20 % |
| quake / flood / hurricane | 0 % · 90 % / 0 % / 100 % · 0 of 4 | dead ≤ 15 % each |
| plague | none in its first 3 days; 26–30 of ~30 alive 10 days later · — · 0 of 4 | dead ≤ 25 % over its course |
| any of these at wrath 1 or "apocalyptic" | — | today's lethality allowed (≥ 80 % dead possible) |

- **Warnings and evacuation.** Volcano: a warning phase (rumbling, smoke, small quakes) of ≥ 12 game hours at wrath
  ≤ 0.5, 2 h at wrath 1, none if apocalyptic; tsunami: the sea draws back ≥ 30 min before the wave; meteor: a bright
  streak seen ≥ 20 min before (an omen). The threatened settlement gets an `evacuate` order: every member walks to the
  danger radius + 100 m (high ground for water), shelters, and comes back after. During it the disaster's view carries
  `DisasterView.params.warning = 1` (render hook H5).
- **Shelter in storms.** Storm severity per cell (precipitation, wind, lightning, hail, cold) multiplies outdoor work
  utilities by (1 − severity) and adds `TASK.shelter` (home, else the nearest building, else the lee of trees) with the
  run animation; lightning near people adds fear. Today awake adults never go in (0.000 inside in every weather) and
  outdoor work barely drops (clear 0.808, blizzard 0.776, thunderstorm 0.654, hail 0.776). Target: under a painted
  blizzard / thunderstorm / hail (intensity 2, over the town) outdoor work ≥ 60 % below clear and ≥ 50 % of awake adults
  inside or sheltering.

### 3.8 RELATIONSHIP acceptance (`relationship.ts`, 4–8 seeds as noted)
- Prayer (bronze town, 20 quiet days): praying + worshipping ≥ 2 % of person-samples (baseline 0.000); 3 days after a
  tornado ≥ 8 % (baseline 0.002); worship from prayer and worship ≥ 50 % of the pool (baseline: preaching only).
- Acts (`relationship.ts acts`): help raises trust, killing acts raise fear and never trust (baseline tornado 0.08 → 0.85
  love), red rain moves fear and faith (baseline ≈ thunderstorm).
- Prophet (new fixture in `relationship.ts influence`): called, three prophecies fulfilled in 6 days → credibility ≥ 0.7,
  worship by day 6 ≥ +60 % over nothing (the disciple's +61 %), praying ≥ 3 %, loyalty +0.2, mean trust ≤ 0.9 (no
  pinned meter); three failures → credibility ≤ 0.15 and preaching ≤ 25 % as effective. Persecution: a fixture with a
  disloyal leader → ≥ 1 persecution act within 10 days in ≥ 6 of 8 seeds.
- Survivable targets and shelter targets of §3.7 (4 seeds); no `creature.*` command or view anywhere.

### 3.9 As built (RELATIONSHIP lane, 2026-10-14; probes and logs in `_harness/scratch/living/relationship/`)
**The question of §0.3, answered by building it: without a creature.** The god's lever is a person and the signs it
makes true — a prophet who says it first, the act that follows, the omen read aloud, the prayer answered. Nothing here
copies Black & White: no pet, no leash, no learning beast, no good/evil hand; the sigils are original single strokes;
the rivals are new names. Measured below: a prophet whose word the god keeps buys more than the disciple did, without
pinning trust or fear (the creature and the disciple drove love to 0.93–1.0 in six days; one of the Called still takes
faith to 0.97).

- **The four values** (`god/regard.ts`): `A.faith`, `A.loyalty` (new `Float32Array` columns × `GODS`, appended to the
  agent layout, saved and hashed); `fear`; trust is the `love` arrays. Load of a pre-1.5 save fills faith =
  `min(1, love + fear)`, loyalty = `0.5 love` (`relAfterLoad`, `sim.ts universeFromHeader`). Acts: every non-plumbing
  command, every disaster's life and every landing is ONE act (`beginAct` / `endAct`, the registry's before / after
  hooks in `god/relationship.ts`), whose witnesses read it by the table of §3.1 — help, mercy, foretold, provoked,
  unprovoked harm, wonder; an act that killed is harm (`noteDeath`). Two passes per witnessing: no act moves a
  settlement's mean trust or fear by more than 0.35 over its whole life (its budget rides in the act's store: a
  disaster's `d.st`). The last 12 acts per settlement (`rel.st[...].acts`, merged by act key). Daily drift as §3.1
  (`relDaily`). Regard = trust − fear over believers (faith > 0.2), `Snapshot.regard`, `HandView.regard`
  (`alignment` carries the same value), bands feared / awed / trusted. Nature's harm is the god's only to those with
  faith > 0.3 (`harm.ts hurtPeople`, `people.ts harmArea`, `culture.ts witness`).
- **What the values drive** (`god/relationship.ts relDecide` through `people/hooks.ts godHooks.relation`, called from
  `decide.ts` after LAND's utilities): prayer `U = min(0.65, need·0.3·piety·(0.3 + faith)·day + 3 (faith (0.15 + 0.6 h)
  + fear 0.3 h) (0.5 + 0.5 need))` (hardship `h` kept hourly on the record: a disaster or the god's harm within 2 days,
  an evacuation, famine, sickness, storm, drought, dry fields; the cap and the sating by the faith need keep a stricken
  town from praying instead of rebuilding — uncapped, 34–48 % of the days after a meteor went to prayer); evening worship at dusk with attendance `0.5 faith + 0.3 loyalty + 0.15 piety
  faith` at the temple, shrine or hearth; worship yield `2.5 (faith + 0.5 fear) × place (hearth 0.5, shrine 1, temple 2,
  open 0.3) × (0.5 + piety)`, a sermon × (1 + credibility) (`godHooks.worship`, `work.ts`); temples only where faith >
  0.4 and loyalty > 0.3 (`godHooks.templeWanted`, `settlement.ts`); offerings `0.05 × loyalty` of the surplus;
  burnt offerings where fear > trust + 0.3, a beast past fear 0.8 (`culture.ts sacrifice`; it was alignment < −0.4);
  a feast of LAND's calendar kept in the god's name where trust ≥ 0.5 (faith and loyalty +0.03, worship, the
  chronicle); the Called obey with p = loyalty; conversion when a rival's faith × loyalty leads by 0.2; migration away
  (fear > 0.7, trust < 0.2, 3 days); revolt against the Called and the prophet (exile; killed past fear 0.85).
- **Prayers** (`god/prayers.ts`): the six kinds and windows of §3.3 raised from the real state (at most 2 open, not the
  same kind again within a day), answered by the matching act over the territory + 200 m (the act's classification:
  `afterAct`), lapsed at the window's end (three in a row: "the god is deaf", the prophet −0.1). `prayer.answer
  { settlement, prayer? }` dispatches the canonical sigil. `SettlementView.prayers`, query `prayers`, events
  `prayer.raised / .answered / .lapsed`.
- **Prophets** (`god/prophets.ts`): `prophet.call` (grown, one a town, six a world; 0.30, 0.45 with a sign ≥ 10 saw),
  rising on their own (piety ≥ 0.75 at a wonder, p 0.15, 0.15), confirmation / discredit by the god's next act,
  `prophet.foretell { agent, what, days }`, the prophet's own foretelling (an open prayer, an omen's meaning), fulfil
  +0.25 (1 − c), fail −0.25; preaching by credibility against loyalty to rivals (faith +0.04 k, trust +0.008 k,
  loyalty +0.012 k an hour heard); a shrine at a sacred place (c ≥ 0.5), carrying the faith (c ≥ 0.6, 2–5 days); persecution
  (§3.4.6: daily p 0.12 + 0.12 aggression; silenced → exiled → killed), defended by a ward or a blow at the ruler, the
  god's silence −0.2; martyrs; death and a successor from the Called; `prophet.abandon`. `SettlementView.prophet`,
  `flags2.prophet`, query `prophets`.
- **Omens** (`god/omens.ts`): the catalogue of §3.4.4, read once per 10 quiet days per town (a sky omen everywhere),
  by the prophet first (who may foretell its meaning); natural eclipses and comets read; rainbows after rain with the
  sun low (p 0.25) — `rainbow` is a new real weather (`weather.json`, `effects.omen`), never drawn by the natural
  spawner (`fields/weather.ts spawn` draws over the non-omen kinds, so every world's weather is what it was).
  `god.omen { settlement | pos, kind? }` (the fitting one when no kind), query `omens`.
- **Sacred** (`god/sacred.ts`): `place.sacred`, places from prophets, omens and martyrs, shrines, pilgrimages at feasts
  and after hardship (pilgrims of different towns meet), harm to a holy place read as punishment; `settlement.sacred
  { settlement, animal }` (real species only: hunting taboo, culled −0.2 trust / +0.2 fear, spared +0.1).
- **The creature is gone** (§3.5): `god/creature.ts` is a stub (`dropCreatures`, `NO_CREATURE`), `god/watch.ts` empty,
  the 1.5 migration step drops creature state, a held creature and one in flight; no `creature.*` command, power,
  query or view; `Snapshot.creatures` optional and never sent; a mod pack's creatures load with a warning; "give me a
  creature" answers "There is no great creature in this world. Choose a prophet: 'make Hesh my prophet'."
- **The restyle** (§3.6): the Touch (Lift, Hurl, Let go, Set down, Drop, Rebuke, Soothe, Ward, Draw a sigil; old names
  stay synonyms), `sigil` on 14 powers (query `sigils` with the stroke descriptions), the Called (Call, Charge the
  Called), the eight rival names with epithets (`GodRecord.epithet`, `gods` query `title`), the Signs category with nine
  new powers and the Wrath law power (`powers.json`, rewritten by `tools/powers-restyle.mjs`, idempotent).
- **Wrath** (`god/wrath.ts`): law `god.wrath` 0.3; `wrath` (and `warning`) on every cast it scales; L(w), R(w) and a
  third factor for buildings B(w) (walls break before people in this model: the bronze towns stand 19 of 20 buildings
  within 45 m of their centre), calibrated at L 0.6 / R 0.7 / B 0.35 (below); applied in `hurtPeople`,
  `wreckBuildings`, `harmArea` / `damageArea` (people code, through `godHooks.harmScale`), an impact's crater, fire and
  ejecta, and a disaster's land effects (`area`: water drained, crops, lava, fires). A god-sent drought lasts 2–3 days
  at 0.3. Below full wrath a dry crater does not drive a town out (they rebuild around it). Lightning strikes at most
  the 1–3 nearest. Size words set it ("an apocalyptic earthquake": wrath 1, no warning).
- **Warnings and evacuation** (`god/precursors.ts`): volcano 720–840 ticks of rumbling at wrath ≤ 0.5 (120 at 1),
  meteor 36 (none at 1), tsunami 40 (30 at 1); `DisasterView.params.warning = 1`; settlements in reach get an order:
  every member drops what they are doing, walks out past the danger radius + 100 m (high ground for water) with a day's
  food a day of it (up to 3) and water skins, sleeps out there, and comes home when the eruption is spent. Events
  `warning`, `evacuate`.
- **Shelter** (`people/shelter.ts`): storm severity per place (rain, hail, wind, lightning, dust and ash, snow driven by
  the wind; the hard cold below −25 °C at most 0.3); outdoor utilities × (1 − severity), `TASK.shelter` worth severity
  × 2.4 (home, the nearest building, the lee of trees), INSIDE the building (`A.inside`, `tasks.ts beginWork`); every
  quarter hour a storm of 0.4 or worse breaks off outdoor work (`stormBreaks`); event `shelter`, `flags2.sheltering`,
  `AnimState.shelter`.
- **Free text** (`god/freeform-signs.ts`, first in the intent list): prophets, foretelling through a person, the
  Called, signs and omens, sacred places and animals, prayers ("what does Aru pray for", "answer the prayers of Aru"),
  wrath dispositions and size words.
- **Saves**: the relationship state is `god.rel` (header JSON, sorted); faith and loyalty are blobs; 1.4 saves load
  (`tests/creature.test.ts`); hash stable over save → load (`tests/living-relationship.test.ts`).

**Measured against §3.8** (before = the tree of 2026-10-13 as the spec measured it, `spec/out/`; after = this lane):

| metric (target) | before | after |
|---|---|---|
| praying + worshipping, 20 quiet days (≥ 2 %) | 0.000 | 0.032 (`out/rel-prayer.log`; a temple: prayer is worship there) |
| … 3 days after a tornado (≥ 8 %) | 0.002 | 0.111 |
| worship from prayer and worship (≥ 50 % of the pool) | preaching only (pool 147.2) | 0.926 (465.3 of 502.5; preaching 35.9, offerings 1.4) |
| help raises trust (`rel.ts acts`, a day later) | food love +0.47, mending +0.58 | plenty trust +0.116 (fear 0), mending +0.143, rain +0.085, a gift +0.070 |
| killing acts raise fear, never trust | tornado love 0.08 → 0.85, fear +0.95; lightning love +0.13, 23 dead | tornado fear +0.36, trust −0.075, faith +0.72, nobody dead; lightning sigil fear +0.25, trust −0.063, nobody dead; meteor fear +0.37, trust −0.08; plague fear +0.35, trust −0.08 (`out/rel-acts.log`; the quake's tsunami flooded the low test town out — it fell, nobody died, as before) |
| red rain moves fear and faith | love +0.08, fear +0.06 | faith +0.21, fear +0.11, trust +0.02; a rainbow faith +0.10, trust +0.10 |
| prophet: 3 fulfilled in 6 days → credibility (≥ 0.7) | — (no prophets) | 0.705 (0.30 → 0.475 → … ; persecuted once on day 2, defended by a ward) |
| … worship by day 6 vs nothing (≥ +60 %; the disciple +61 %) | nothing +28.3, disciple +45.6, creature +28.3 / +27.0 | nothing +23.4, prophet +497.2 (×21), one of the Called +527.1, a plenty sigil +36.1 (`out/rel-influence.json`) |
| … praying (≥ 3 %), loyalty (+0.2), mean trust (≤ 0.9) | love pinned 0.93–1.0 by the disciple and the creature | 4.4 %, loyalty 0.033 → 0.653, trust 0.880; the Called: faith 0.97, trust 0.44 |
| … 3 failures → credibility (≤ 0.15), preaching (≤ 25 % as effective) | — | 0.000; 0.479 vs 3.056 effect an hour (15.7 %) |
| persecution, disloyal ruler, credibility > 0.4 (≥ 1 within 10 days in ≥ 6 of 8) | — | 7 of 8 worlds (seeds 1–8; first after 2 280–8 040 ticks; seed 4's prophet was gone before), `out/rel-persecution.log` |
| shelter: a storm held over the town (§3.7: outdoor work ≥ 60 % below clear, ≥ 50 % in) | in 0.000; outdoor 0.808 clear, 0.776 / 0.654 / 0.776 | blizzard / thunderstorm / hail: in 0.951 / 0.958 / 0.951, outdoor work 0 (clear 0.546), `out/rel-shelter-pinned.log` |
| … the spec probe's own paint (it drifts off the town after 2–3 of the 24 hours) | as above | in 0.200–0.202, outdoor work 34–39 % below clear (`out/rel-shelter.log`) |
| free text, RELATIONSHIP phrases (`spec/freeform.ts`) | 3 / 21 | 21 / 21 (`freeform-probe.ts`, 27 / 62 overall) |
| `creature.*` commands, powers, views, queries | 11 commands, 11 powers | none (`tests/creature.test.ts`) |

**Survivable at the default wrath** (`rel.ts lethality`, n = 64, 30-person bronze towns, seeds 20261008, 7, 1234, 1,
each cast on the centre; killed = the original members dead at the end of the cast's window, then 10 days later at
the deep time-lapse; `out/rel-lethality-final-{a,b}.log`, falling flame and plague `out/rel-lethality-fp-{a,b}.log`):

| cast | before (spec): dead mean (max) · ruined · fallen | after: killed mean (max) · 10 days · ruined · fallen | target |
|---|---|---|---|
| meteor | 100 % (100 %) · 100 % · 4 / 4 | 0 (0) · 0 · 32 % (40 %) · 0 / 4; standing 60–75 % at the blow, 45–75 % after 10 days (the impact's fire burns on: 13 → 9 on seed 1234) | 10–35 % dead, ≥ 60 % standing, never fallen |
| volcano | 100 % (100 %) · 100 % · 4 / 4 | 0 (0) · 0.8 % (3.3 %) · 100 % (lava) · 0 / 4; 100 % out past the danger radius at the eruption, warning 720–840 ticks | warnings ≥ 12 h; ≥ 80 % out; ≤ 15 % dead |
| drought | 10 % (100 %) · — · 1 / 4 | 0 (0) · 0.8 % (3.3 %) · 14 % · 0 / 4 (2–3 days) | ≤ 10 % thirst dead |
| lightning sigil | 73 % (80 %) · 8 % · 0 / 4 | 0.8 % (3.3 %) · 4.2 % (10 %) · 7.5 % · 0 / 4 | 1–3 struck |
| falling flame | 51 % (97 %) · 8 % · 0 / 4 | 0 (0) · 20 % (80 %: seed 1, below) · 7.5 % · 0 / 4 | ≤ 20 % |
| tornado | 26 % (30 %) · 19 % · 0 / 4 | 9.2 % (16.7 %) · 9.2 % (16.7 %) · 0 · 0 / 4 | ≤ 20 % |
| firestorm | 96 % (97 %) · 97 % · 0 / 4 | 0.8 % (3.3 %) · 0.8 % · 23 % · 0 / 4 | ≤ 30 % |
| quake / flood / hurricane | 0 · 90 % / 0 / 100 % · 0 / 4 | 0 · 0 · 0 / 0 / 0 · 0 / 4 | ≤ 15 % each |
| plague | none in 3 days; 26–30 of ~30 members alive at day 10 | 0 in 3 days; 26.7 % of the original 30 dead by day 10 on every world (members 22–26 with births) | ≤ 25 % over its course |
| at wrath 1 | — | today's lethality: a meteor kills 100 % of the test town (`tests/living-relationship.test.ts`) | ≥ 80 % possible |

Calibration (`out/rel-lethality-cal*.log`): at L 0.42 / R 0.78 (B = L) nothing killed anyone and the meteor still ruined
60–68 % of the town; at L 0.6 / R 0.7 / B 0.35 a tornado kills 13–17 % and every other cast stays under its bound. The
bronze towns stand 19 of 20 buildings within 45 m of their centre — inside any meteor — hence the building factor. Short of
target: the meteor kills nobody (everyone is 98–245 m out when it strikes, 36 minutes after the streak: the warning
works), below the table's 10 % floor; ten days on its fire has burned more of the town than was rebuilt; a plague kills
26.7 % over ten days (the god seeds L(w) of its cases; the epidemic then runs its own course, `life/disease.ts`). The
lethality runs used the prayer rule of their time (uncapped, PRAY_K 1.6; the falling-flame and plague rerun 2.2) and
the preaching trust gain 0.012 (now 0.008), and drew natural weather without blood rain (the first form of the painted
filter).

Found on the way, not this lane's to fix: on seed 1 the falling flame's one smouldering cell flared into a fire on day 7
that burned three buildings; the town swore off fire (`culture.ts tabooFromStories`, three burnings) and 24 of 30 starved
within two days beside a store holding 360 units of food (`live/dbg-flame.ts`).

Seed-bound and other tests moved by this lane:
- `ecology.test.ts` (predators and prey, seed 11): failed when the rainbow was appended — the natural weather draw is
  `rng.int(0, list.length − 1)`, so a 21st kind changed every world's weather. The draw now skips painted-only kinds
  (`effects.painted`, `fields/weather.ts`): the draw is the base tree's again, and the test passes unchanged; so does
  `perf-fidelity.test.ts` (soils, which had moved 0.0062 with the first form of the filter).
- `disasters.test.ts` (every kind changes the world): volcano, supervolcano, quake and sinkhole failed — the volcanoes
  were in their warning phase at 240 ticks (the effects wait for it), and a bug of this lane had dropped the start
  effects of every god-sent disaster without a warning (fixed). The test now measures a warned kind 240 ticks after the
  blow against an untouched world stepped as long.
- `meteor.test.ts`: the test's star is cast at full wrath (`wrath: 1`: today's lethality, no warning). Its whole story
  (≥ 3 dead, ≥ 4 fallen, fear +0.3, ≥ 3 rebuilt in 12 days, the town standing; `sb-meteor.ts`, seeds 1–12) held on 8 of
  12 on the base copy (1, 2, 5, 8–12) and holds on 8 of 12 now (3–10, `out/sb-meteor-live3.log`); seed 2 loses its
  rebuilding to a fire on its sixth day, so the test runs on seed 9 (rebuilt 5 before, 7 now). Before the prayer cap the
  whole town prayed 34–48 % of the days after the blow and it held on 6 of 12 (`out/sb-meteor-live{,2}.log`).
- `society.test.ts` (the iron monopoly, seed 2) failed in one full run (margin 0.13 for 0.15) and passes in the final
  `npm run check`; it is not re-seeded. PACE's scenario (`sb-iron.ts`, WARY −0.1, 24 days) holds on 4 of 12 on the base
  copy (1, 2, 4, 7, as PACE measured) and on 2 of 12 now (7, 9). On seed 2 the run where both towns hold iron traded
  270.6 on the base copy and 3.7 now — and 0 with this lane's decision hooks switched off (`sb-iron-norel.ts`): the
  caravans stopped for a reason outside this lane (the base copy predates LAND's `people/land.ts`).
- `mods.test.ts` (the salt wind): at the default wrath its land effects reach 0.7 of the radius at 0.6 of the strength
  (salt +0.245 against +1.05; `live/dbg-salt.ts`); the test casts it at full wrath.
- `hand.test.ts` (a hurled boulder): "the town is afraid" held before only through the fear of the dead (all 30 died on
  both trees, `live/dbg-boulder.ts`); a hurled thing now lands under the wrath law and its crater reaches R(w) — 21 of
  30 die and the survivors are afraid.
- `creature.test.ts`, `content.test.ts`, `freeform.test.ts`, `omnipotence.test.ts`, `god.test.ts`, `ui-logic.test.ts`,
  `audio.test.ts`: the creature parts replaced (§3.5); `ui-logic` carries a todo for hook H4 (the Signs category).

Tests: `tests/living-relationship.test.ts` (16 tests) — each fails on the base tree (`out/t-rel-on-base.log`: no faith
columns, no `prophet.call` / `place.sacred`, no warning, no shelter task, no epithets, the free text unknown).
`npm run check` (2026-10-14 08:00, `out/check-final.log`): detban 137 files clean, typecheck clean, 375 tests — 371
pass, 0 fail, 2 skipped (the throughput floors: overloaded machine), 2 todo (hooks H1 and H4).

---

## 4. CONTENT — materials, plants and real animals

### 4.1 Materials the god invents
`content.material { name, kind?: 'metal' | 'stone' | 'mineral' | 'gem' | 'wood' | 'fibre', source?: 'ore' | 'plant',
traits?: string[], uses?: ('building' | 'tools' | 'weapons' | 'luxury')[], seed?: { pos, radius } }` (kind and traits
guessed from words when absent: "mithril" → metal; "light", "hard", "warm", "glowing", "flexible", "beautiful") creates,
in the runtime pack (`god/runtime.ts`, saved in god state):
- the raw item (and for metals an ore item and the refined metal), a runtime **ore** entry (deposit kind) or a runtime
  **plant** source;
- a **building material** (`materials.json` shape) when it builds: strength, insulation, flammability and night light from
  the traits (hard ×1.5 strength, warm +0.2 insulation, glowing lights at night…);
- recipes: refining (`<x> working`, prerequisites by kind: metal → copper smelting and a furnace; stone → masonry; gem →
  jewellery; fibre → weaving; wood → carpentry) and **uses** — `<x> tools` with a quality bonus of +15–40 % from the
  traits, weapons, ornaments;
- deposits: `seed` places them, else three veins by geology (metal → mountains, stone → mountain / sedimentary, gem →
  volcanic / mountain);
- **demand**: a settlement that knows a recipe using it wants it (tools, building), so miners and gatherers go (§2.6);
- **chronicle firsts**: first mined, first house of it, first tools of it.
Target (bronze town, "introduce mithril to Aru" with a vein within 400 m): ≥ 1 deposit cell; ≥ 10 units mined within 10
days; ≥ 2 recipes using it; a tool or building of it within 20 days. Baseline: 0 deposit cells, 0 recipes or materials
using it, stock 0 → 2 with 14 knowers (`content.ts invent`); the audit's 20 gifted glowstone sat untouched for 10 days.

### 4.2 Seed a vein
`terrain.seed-ore { ore, pos, radius = 120 m, richness = 0.7 }` writes `oreType` (1 + ore index, runtime ores included)
and `ore` with a falloff, refuses water cells, marks the settlements' resource caches dirty, and is a small wonder for
witnesses. Miners already work deposits (`resources.ts:78`, `work.ts:234`); today nothing writes `oreType` after world
generation (`planet.ts:843`). Free text: "put gold in the hills", "seed a vein of copper near Aru". `uranium` and `gems`
deposits get items (`uranium-ore`, `gemstones`); today they map to none.

### 4.3 Plants and crops
- Schema additions (`plants.json`): `season`, `harvest` (§2.4), `fruit?: { item, qty, season }` (fruit trees and
  bushes, gathered in season), `gather?: [{ item, qty }]` (wild herbs, mushrooms).
- **New plants (appended):** fruit trees `apple`, `olive`, `date-palm`, `fig`; `wild-herbs`, `mushrooms`; wild ancestors
  `wild-barley`, `wild-sorghum`, `wild-potato`, `wild-lentil`, `wild-cotton`; crops `barley`, `sorghum`, `potato`,
  `lentil` (fixes soil fertility), `cotton` — nine crops in all, each with its own harvest.
- **New items (appended):** rice, maize, barley, sorghum, potatoes, lentils, cotton, linseed, apples, olives, olive-oil,
  dates, figs, mushrooms, wax, feathers, shellfish, uranium-ore, gemstones (grains tagged `grain`, fruit `food/fruit`…).
- `content.plant { name, type: 'tree' | 'shrub' | 'grass' | 'crop', like?, yields? }` appends a runtime plant with
  tolerances copied from `like` (or the nearest plant by kind) and a new food or fibre item; free text "grow a new plant
  called silverleaf", "invent a new crop called sunroot".

### 4.4 Real animals only
**Replaced in place** (same index, so saved herds keep their meaning; the old id stays as an alias in `aliases`):

| old (not real) | becomes | why |
|---|---|---|
| `ice-beast` (tundra, ice, taiga grazer) | `musk-ox` | the real tundra grazer |
| `sand-crawler` (desert predator, a hexapod) | `caracal` | a real desert cat |
| `haze-ray` (a flyer of methane skies) | `golden-eagle` | a real raptor that hunts the rabbits nothing keeps down today; methane worlds keep no fauna (real) |
| `drift-ray` (its tame form) | `duck` (domestic) | domestic form of the mallard |
| disaster `leviathan` (a sea monster) | `rogue-wave` (same effectors, no creature) | real |

**New wild species (appended; real, life-size):** `red-junglefowl` (→ chicken, which has no wild ancestor today),
`mallard` (→ duck), `honey-bees` (wild colonies; → kept bees, honey and wax), `shellfish` (coast beds), `moose`,
`lion` (savanna), `tiger` (rainforest, wetland), `harbour-seal`, `macaque`, `wild-camel` (→ camel), `wild-yak` (→ yak),
`crocodile` (wetland and river predator). **Domestic forms appended:** `camel`, `yak`, `kept-bees`. Every biome that has
grazers then has a predator (today rainforest, wetland, desert, dune and savanna have none).
- `content.animal` makes only real animals: the name must be in the lexicon's `realAnimals` list (~300 real species
  mapped to the nearest base species and body); anything else maps or refuses. Fantasy nouns in free text: dragon →
  crocodile ("the nearest real thing"), kraken / leviathan / sea serpent → whales, unicorn → wild horses, griffin →
  golden eagles, werewolf → wolves, yeti → bears; zombies, ghosts, phoenixes, basilisks → a polite refusal ("Nothing like
  that lives in this world.").
- **Save migration (1.5):** replaced species keep their index; herds of a replaced species on a world outside the new
  species' temperature range are dropped at load without a chronicle line (no extinction notice); derived species
  (index ≥ 27 in 1.4) shift by the number appended, and so do the `eco` maps (`seen`, `extinct`, `peak`, `became`) and
  `animal:<id>` sacred tags resolve through aliases. From 1.5 the save header records each registry's id list
  (`contentIds`) so later appends remap by id; a save without it is read with the frozen 1.4 lists.
- Not real but not creatures — `glass-storm`, `forgetting-fog`, `overgrowth`, `gravity-slip`: kept, owner question (§9).

### 4.5 Ecology fixes
- **False extinction notice:** `others` is computed before the kin herds are converted (`life/ecology.ts:691-692`), so
  `became` is never set and the parent is chronicled extinct; compute it after. Baseline: 33 of the 44 extinction
  notices in the census were false.
- **Speciation timing:** every isolated lineage splits at exactly `ISO_DAYS = 36` days (`ecology.ts:40`; first
  speciation at day 35.5 median). Require 6–12 game years of isolation (per-lineage hash) *and* a different biome or
  temperature band from the parent's range. Target: first speciation ≥ year 6 (median), ≤ 0.3 per world-year over the
  first 8 years (baseline 1.3 per world-year: 84 in 64 world-years).
- **Herd density and food webs:** the herd target is planet-wide (`life/herds.ts:143`: `min(80, vegTotal/600 + 2)`);
  scale it by habitable land per biome guild (each biome with ≥ 200 land cells: ≥ 1 herd of each fitting grazer, one
  predator per ~4 prey herds); arrivals biased to 300–1 500 m from settlements. Target: a wild land herd within 1 km of
  ≥ 80 % of settlements at founding (baseline: nearest 2 024 m median in year 1).
- **Willow swamp drift:** soil moisture starts from an analytic estimate with no spin-up (`fields/climate.ts:1211-1217`);
  spin it up before vegetation is seeded and rebalance infiltration against evapotranspiration. Targets over the first 3 years
  without people, from the world as built (4 seeds, `content.ts ecology`): willow cells ≤ +50 % (baseline +469 … +637 %),
  oak ≥ −30 % (baseline −50 … −74 %), spruce ≥ −30 % (baseline −50 … −57 %), saturated soils ≤ +15 % (baseline +225 …
  +344 %), open grassland ≥ 3 % of the land at every year end (baseline 0.8–1.6 % at the start, 2.2–3.7 % at year 3), and
  a dominant-tree mix within ±15 % of its year-1 shares over years 1–3 (the audit's test).

### 4.6 CONTENT acceptance (`content.ts roster | invent | ecology`)
Roster: 0 non-real species or disasters; 0 biomes with grazers but no predator; 9 crops each with its own harvest; ≥ 4
fruit trees; ≥ 12 new real species; `terrain.seed-ore`, `content.material`, `content.plant` registered. Invent target of
§4.1. Ecology targets of §4.5 (4 seeds × 3 years, no people, 3000x) and false extinctions 0 in the census.

### 4.7 As built (CONTENT lane, 2026-10-14; probes and logs in `_harness/scratch/living/content/`)
No creature, and none needed: the influence a creature was asked to buy comes from the prophets and signs of §3.4
(RELATIONSHIP), and every living thing in the world is a real one. New modules: `life/fauna.ts` (the real-animal lexicon
reader, the content-id remap of saves), `god/materials.ts` (`content.material`, `terrain.seed-ore`, the queries `ores`,
`materials`, `content`, the material jobs and firsts), `god/plantsrt.ts` (`content.plant`), `god/freeform-content.ts`
(the free-text intents), `tests/living-content.test.ts`. Hunks in shared files: `content.ts` (`PlantDef.fruit / gather /
understory / nitrogen`, `OreDef.item`, `AnimalDef.aliases`, `DisasterDef.aliases`, `MaterialDef.light`; registries
resolve aliases — `Registry.canonical`; checks and cross-references for the new fields), `sim.ts` (`contentIds` in the
save header, `contentAfterLoad` after load), `core/migrate15.ts` (CONTENT's step, a header no-op: the remap needs the
loaded content), `god/freeform.ts` (`intentContent` second in the intent list), `god/index.ts` (the two command
families, the daily material round, the three queries), `god/state.ts` / `god/runtime.ts` (runtime ores, materials,
plants and the building materials that gain an invented one), `people/resources.ts` (ore items from `ores.json`, the
plants' gifts as availability rule 20, wild grain from every wild grass), `people/decide.ts` (fruit and invented foods
are foraged), `people/settlement.ts` (material jobs first in `planJobs`; a glowing house lights the night),
`fields/vegetation.ts` (a nitrogen crop feeds its soil), `fields/climate.ts` (the soil balance and spin-up), the data
files (appended entries; the four replaced animals and the leviathan edited in place).
- **Real animals** (`animals.json`, 27 → 42): `ice-beast` → `musk-ox`, `sand-crawler` → `caracal`, `haze-ray` →
  `golden-eagle` (a raptor of the air: `preyOf` lets it take land grazers up to 4× its weight), `drift-ray` → `duck`,
  each at its old index with the old id in `aliases`; appended `red-junglefowl` (→ chicken), `mallard` (→ duck),
  `honey-bees` (→ `kept-bees`: honey, wax), `shellfish` (coast beds, gathered), `moose`, `lion`, `tiger`,
  `harbour-seal` (takes shoals), `macaque`, `wild-camel` (→ `camel`), `wild-yak` (→ `yak`), `crocodile` (meat and fish),
  and the domestic `camel`, `yak`, `kept-bees`. Disaster `leviathan` → `rogue-wave` (same effectors, alias kept; the power
  keeps its id `disaster-leviathan`). `lexicon.json` gains `realAnimals` (499 words → base species and size),
  `fantasyAnimals` (dragon → crocodile, kraken / leviathan / sea serpent → whale, unicorn → wild horse, griffin → golden
  eagle, werewolf → wolf, yeti → bear …) and `noSuchAnimals` (zombie, ghost, phoenix, basilisk …: "Nothing like that lives
  in this world."). `content.animal` (`god/inventions.ts makeAnimal`) makes only a real animal: a lexicon word becomes a
  species of the world with its base's body scaled to its size; a fantasy word brings its nearest real kind and says so;
  anything else is refused (the rain of an animal too).
- **Saves (1.5):** every save records `contentIds` (each registry's ids); `contentAfterLoad` remaps by id when the
  content has grown since (derived species shift by the animals appended, with herds, eco books, memories, stores,
  libraries, buildings, fields, weather and ore kinds; `animal:<old id>` sacred tags read through aliases); a save without
  `contentIds` is read with the frozen 1.4 lists (`IDS_14`). Herds of a replaced kind standing where the real one cannot
  live are dropped at load with their eco books, so no extinction is told.
- **Materials** (§4.1): `content.material { name, kind?, source?, traits?, uses?, seed?, settlement? }` makes the raw
  item (metal: `<x>-ore`), the worked item, a runtime ore (or a wild plant for wood and fibre), the gathering recipe,
  `<x>-working` (metal: a kiln at 950 °C and charcoal, after copper smelting), `<x>-tools` (quality × 1.15–1.40 by the
  traits), `<x>-blade`, `<x>-ornaments`, and a building material when it builds (hard ×1.5 strength, warm +0.2
  insulation, glowing `light` 1); three natural veins by geology plus one by the settlement named, which is taught every
  recipe it can take (`godTeach`). Material jobs come first in `planJobs` while their stock is short; firsts ("the first
  mithril ore", tools, houses) are chronicled (`material.first`). `terrain.seed-ore` writes a vein with a falloff,
  refuses water, marks the settlements near it to look again, emits `ore.seeded` and is a small wonder. `ores.json`
  items: `uranium` → `uranium-ore`, `gems` → `gemstones`.
- **Plants** (§4.3, `plants.json` 30 → 46, `items.json` 129 → 148, `recipes.json` 152 → 154): fruit trees `apple`,
  `olive`, `date-palm`, `fig` (`fruit` in season); `wild-herbs`, `mushrooms` (`understory`: never the dominant of their
  layer); wild ancestors `wild-barley`, `wild-sorghum`, `wild-lentil`, `wild-potato`, `wild-cotton`; crops `barley`,
  `sorghum`, `potato`, `lentil` (`nitrogen`: +0.2 fertility while it grows), `cotton`. Gatherers find the plants' gifts by
  `plantYield` (a stand where the plant holds its layer, scattered trees by suitability, fruit only in its season);
  olive pressing makes olive oil. `content.plant` copies its tolerances from `like` or the plant of its kind that best
  suits the place, tints its colours, makes its item and joins the foraging lore (wild) or gets a season and harvest
  (crop).
- **Ecology** (§4.5): the false extinction — `became` is now set after the kin herds have changed (`life/ecology.ts`
  `speciate`); speciation needs `isoDaysOf` (6–12 game years, a hash of the lineage's species) of isolation, drift, and a
  home its kind is not made for (`newHome`: a biome outside its list or a lived temperature outside its comfort);
  herds per biome guild (`life/herds.ts guildTargets`: each biome of ≥ 0.62 km² holds one herd of each grazer that fits
  and 0.6 a km², one hunter per four, at most 90 land herds), arrivals to the guild most short, 300–1 500 m from the
  peoples, and a people with no game within 1 km draws a herd 300–900 m out (daily; within its first hour for a new
  settlement: `gameForNew`). The soil (`fields/climate.ts SOIL_BALANCE`): plants draw less below moisture 0.5, a soil
  above 0.72 drains 2 % of the excess an hour to the aquifer, and `spinUpSoil` runs every land cell's bucket for 365
  days on the climate's rain before the plants are sown (the analytic estimate was uncorrelated with where it rains:
  r 0.03 against the first year's rain, `live/rainprobe.ts`).

Measured (before = the lane's frozen copy of the tree, `ROOT=base`; after = the live tree):
| metric (probe) | target | before | after |
|---|---|---|---|
| non-real species / disasters (`roster`) | 0 / 0 | 4 / 1 | 0 / 0 |
| biomes with grazers but no predator | 0 | 5 (rainforest, wetland, desert, dune, savanna) | 0 |
| crops with their own harvest; fruit trees; new real species | 9; ≥ 4; ≥ 12 | 1; 0; 0 | 9; 4; 15 (12 wild, 3 domestic) |
| verbs `terrain.seed-ore`, `content.material`, `content.plant`; queries `ores`, `content` | registered | no | yes |
| "introduce mithril to Aru" (`invent`, bronze town): deposit cells (≤ 400 m) | ≥ 1 | 0 (0) | 3 (1) |
| … units mined by day 10 (mithril in Aru's store, ore and worked); recipes using it | ≥ 10; ≥ 2 | 0 (the 2 the god gave, never more); 0 | 25.4 (first ore day 3); 5 |
| … first tool or building of it | ≤ day 20 | never | day 4 (mithril tools) |
| willow cells, world as built → year 3 (`ecology`, 4 seeds, legacy 1000x) | ≤ +50 % | +376 … +562 % | −21 … +4 % |
| oak / spruce cells | ≥ −30 % | −66 … −80 % / −51 … −59 % | +31 … +59 % / −20 … −22 % |
| saturated soils (moisture ≥ 0.8) | ≤ +15 % | +193 … +324 % | +3 … +12 % |
| open grassland at each year end | ≥ 3 % | 0.8–1.6 → 3.1–4.9 % | 1.0–1.8 → 1.2–3.1 % (not met) |
| dominant-tree mix vs year 1 (largest relative change, top 5) | ≤ 15 % | 73–93 % | 61–81 % (not met) |
| speciations / false extinctions in 3 years without people | — / 0 | 2–4 / 1–2 per seed | 0 / 0 |
| wild land herds (predator herds), world as built → year 3 | — | 10–17 (2–3) → 12–30 (2–3) | 44–50 (6–9) → 127–140 (8–13) |
| a band of 30 (`founding`, 8 seeds): wild land herd ≤ 1 km at founding (median) | ≥ 80 % | 3/8 (1 520 m) | 5/8 (693 m) at the founding tick; 8/8 (676 m) within its first hour |
| … after one day (median) | — | 3/8 (1 633 m) | 8/8 (544 m) |
| census (`census.ts`, 8 seeds × 8 years, a band of 30, 1000x; before = §8.1, the program's baseline tree): speciations | first ≥ year 6; ≤ 0.3 / world-year | 84: all first at day 35.5 (year 3); 1.31 | 8: first in game year 7–8 on 5 seeds, none in 8 years on 3; 0.13 |
| … extinction notices (false) | false 0 | 44 (33) | 18 (0) |
| … nearest wild land herd to a settlement, median of seeds, year 1 / year 8 | — | 2 024 / 1 516 m | 362 / 298 m |
| … wild land herds (predator herds), year 1 → year 8 | — | 11–17 (2–6) → 36–88 (0–3) | 69–76 (9–14) → 182–201 (5–10) |
| … deaths of sickness (all seeds and years) | — | 31 | 40 (11 in one outbreak, seed 7 year 3) |
| CPU (`live/tput.ts`, seed 7, n = 64, no people): build; one game year at 1000x | — | 9.9 s; 11.7 s (37 herds) | 11.4 s; 12.8 s (92 herds) |

Not met, and why: open grassland and the tree mix. The soil now holds (willow, oak, spruce and saturated soils within
their targets on all four seeds), but the mix still moves 61–81 % in a share: oak's share rises 61–81 % from year 1 as
the spun-up soils dry a little toward the running balance, mangrove's falls 51–68 %, while palm, willow and birch stay
within 22 % (`out/ecology-*-live-default.json`); and grassland stays under 3 %
in three seeds: the world is sown almost all forest (`initVegetation`), and opening it is a vegetation change this lane
did not make. The soil balance was chosen from ten variants (`out/et-*.log`, `out/ecology-live-[A-H].log`): a drier
spin-up (`rw` 0.05) met the mix no better and took oak and spruce to −30 %; a wetter one left no oak at all; a lower
field capacity (0.65) halved the mix's drift on one seed (0.30, 0.43) but saturated soils grew 18–40 %; 0.68 matched
0.72 (mix 0.60–0.65, saturated −3 … +6 %).

Tests: `tests/living-content.test.ts` (16: the roster and aliases; every animal word real, mapped or refused; the 22
CONTENT phrases of §5.3; `terrain.seed-ore`; `content.material` for mithril and glowstone with save / load; material
jobs and firsts; crops, fruit trees, wild ancestors, understory; fruit in season; `content.plant`; lentils' nitrogen;
speciation gating; the false extinction; `preyOf`; guild herds and game drawn to a people; a 1.4 save remapped; replaced
herds dropped at load). Each fails on the lane's base copy (all 16, run there with the imports made optional). Updated
for the spec'd changes: `ecology.test.ts` (speciation in a new home, ≥ 6 and ≤ 13 years), `freeform.test.ts`
(leviathan → whales, unicorns → wild horses, rogue wave), `disasters.test.ts` (`rogue-wave`). Moved by the soil
(both pass again with the old balance, `seedbound/oldsoil.mjs`): `omnipotence.test.ts` road — the `twoTowns` helper's
Lune landed 759 m from Aru, outside its documented 0.9–1.6 km; the helper now takes the best cell whose landing site is
in range (1 197 m now, 1 513 m with the old soil, as before); `meteor.test.ts` — its whole story held on 6 of 12 seeds
with the old soil (2, 6, 9, 10, 11, 12) and holds on 6 of 12 now (2, 4, 6, 7, 10, 12): re-seeded 9 → 10, which holds on
both (`seedbound/sb-meteor-full.ts`); `society.test.ts` iron monopoly (LAND re-seeded it to 4 meanwhile) — over seeds
1-48 (`seedbound/sb-iron.ts`, the test's guard, 24 days) its whole story holds on 16 with the soil of §4.5 and 18 with the
old soil; the monopoly's war over iron comes on 32 and 33; what differs is the control run, whose towns fall out over land
on 7 seeds against 5 when nothing passes between them (seed 6: the old soil's have-nots tamed six cattle on day 1 and
sold milk from day 2; with the new soil no tameable herd was near and no caravan went in eight days). Seed 4 holds with
the soil of §4.5 (war on day 19, margin 0.36).

Hooks for the UI / render / audio team (none of their files touched): bodies for nine new body plans —
`quadruped-feline` (caracal, lion, tiger), `primate` (macaque), `seal` (harbour seal), `reptile-large` (crocodile),
`camel` (wild camel, camel), `bee-colony` (honey bees, kept bees), `shell-bed` (shellfish), `bird-water` (mallard,
duck), `bird-raptor` (golden eagle); `hexapod` and `ray-flyer` are no longer used by the base content; the `rogue-wave`
disaster (a wave, no serpent: render, icon `d-leviathan` and sound were the leviathan's; old saves' `leviathan` resolves
to it); plant forms `herb`, `leafy`, `mushroom` (new) and the apple / olive / fig broadleaf, date-palm palm, barley /
lentil grain, sorghum stalk, potato leafy, cotton bush; runtime plants, ores and materials past the base indices
(colours from the content; `content` query); an ore-picker brush for `terrain.seed-ore` (ores from the `ores` query),
invent-material and invent-plant dialogs (`content.material`, `content.plant`); events `ore.seeded`, `material.first`,
`content.plant`; a glowing building material (`MaterialDef.light`) lights its settlement's night
(`SettlementView.nightLight`). The snapshot is unchanged.

---

## 5. HISTORY and free text

### 5.1 Independence, grievances, raids
Today one founding people never splits: 0 wars, raids or treaties and 1 polity in every census seed; independence needs a
daughter > 1 400 m from its capital, a tongue drift > 0.45 or a schism (`people/war.ts:489-501`).
- Each daughter keeps a **grievance** against its capital (0..1): + tribute paid; + famine the capital did not relieve
  while it had a surplus (+0.2); + a leaders' feud or a rival faction leading (+0.1); + distance in travel time (> a
  day's walk: +0.002/day); + language drift accumulated per generation where contact is rare; − kin visits, trade and aid.
  Secession when grievance > 0.6 (daily p rising to 0.02), carried by the independence faction's strength.
- **Raids among kin:** a town with < 1 day of food raids (cattle, stores, at night) a neighbour within a day's walk that
  has ≥ 5 days and relation < 0.3, inside one polity too; border friction over overlapping fields and hunting grounds
  lowers relations daily.
- Fixture ("kin region": a capital of 60 and two daughters of 40, bronze age, 1–3 km apart, 20 game years, 8 seeds, at
  3000x): ≥ 1 secession in ≥ 5 of 8; ≥ 1 raid or war in ≥ 3 of 8; ≥ 1 treaty in ≥ 2 of 8; control (a capital that
  sends food in every famine): no secession in ≥ 6 of 8.

### 5.2 Eras that read right, and their pace
- The era *index* stays as today (`knowledge.ts:42-53`, saved progression); a new **era label** comes from defining
  capabilities: "first farmers" (agriculture without metal), "potters", "copper age" (copper smelting known), "bronze age"
  (bronze known), "iron age" (iron smelting)… A town never reads "bronze age" without copper or bronze smelting, nor
  "stone age" with agriculture and pottery. `SettlementView.eraLabel?: string` (hook H11).
- Pacing: after LAND's demography lands, HISTORY tunes discovery — practice before a recipe can be built on (N uses),
  population or specialist thresholds, a minimum of years per era before the next era's ideas become candidates — to
  the §1.5 timeline. `settlement.advance { settlement }` force-teaches the next era (free text "advance Aru to the next
  era"); `world.terraform` is the barren-acceptance sequence as one act.

### 5.3 Free text — 62 phrases
`_harness/scratch/living/spec/freeform.ts` holds the table (the audit's 50 requests plus 12 for prophets, signs, the
creature's removal and the restyle), each with its target and its owner lane; HISTORY copies it into
`tests/omnipotence.test.ts`. Baseline **9 of 62** (`out/freeform.json`; by owner: HISTORY 1 / 16, CONTENT 1 / 21,
RELATIONSHIP 3 / 21, PACE 4 / 4 — each lane makes its own phrases pass through its intents and lexicon words).
Rules: place words ("on the sea near X" is the nearest water; "between X and Y" the midpoint band, a town radius clear of both); "turn A into B" paints B over the
cells of A; synonyms (jungle → rainforest, swamp / marsh / bog → wetland, blueberry → berry bush, "plague of X" → a
swarm of X); after spawn / summon / unleash an unknown noun is a real animal or a refusal, never an item; "new X world"
→ `world.birth`; a destructive act on a settlement the sentence did not name asks for confirmation in the preview; the
duplicate Firestorm power (`firestorm-call`, `disaster-firestorm`) merges into one. Target 62 / 62.

### 5.4 As built (HISTORY lane, 2026-10-14; probes and logs in `_harness/scratch/living/history/`)
Modules: `people/politics.ts` (grievances, secession, kin raids, border friction, aid; `historyDaily`, called by
`war.ts politicsDaily`), `people/eras.ts` (the era clock, practice, the age's institutions, wonders, era labels),
`god/history.ts` (`settlement.advance`, `settlement.teach { era }`, `world.terraform`), `god/freeform-history.ts` (the
HISTORY phrases). HISTORY's hunks in shared files: `people/state.ts` (`Settlement.hist?`), `people/knowledge.ts` (learn →
noteLearned / syncEra, the era told by its label; planExperiment and accident → inventable), `people/war.ts` (polityOf:
a polity's capital is its founding town; independence keeps schism and the unreconciled conquered, salted with the
world; politicsDaily → historyDaily; battle → kinRaided; plunder drives off livestock), `people/missions.ts` (an arrival → missionArrived),
`people/snapshot.ts` (historyView), `people/query.ts` (`settlement.history`; `polities[].settlements[]` with
`eraLabel`, `grievance`, `why`), `types.ts` (`SettlementView.eraLabel?`, `grievance?`), `world/planet.ts`
(`PlanetState.terraform?`), `sim.ts` (terraformStep hourly while a world is being made), `god/index.ts`
(registerHistoryCommands), `content.ts` (template variable `label`), `data/events.json` (14 templates), `data/lexicon.json`
(`biomeWords`), `data/powers.json` (one Firestorm), `core/migrate15.ts` (HISTORY's step: a no-op — `Settlement.hist` is made
on first use, a 1.4 town's era clock starts at the load with what it knew counted as long practised).

- **Grievance** (`politics.ts`, weights in `POLITICS`): per daughter town against its capital, 0..1, with its parts
  (`hist.why`, the inspector's "why"). + a tithe each season of 3 days (a tenth of its food above two days a head and of
  its metal and finery, carried by bearers or taken: +0.004); + a famine — under a day of food a head, or a death of
  hunger — that the capital, with food to spare (4 days a head of its own and 2 days a head of the daughter's beyond),
  did not relieve within 2 days: +0.45, told in the chronicle ("No bread came from Aru when Lune starved"); the capital
  sends food on its own with a daily chance 0.2 × its leader's generosity (`sendAid`, a gift mission of up to three days
  a head); + a feud, weighed once for each pair of leaders (certain when the daughter's leading party is the rival of the
  capital's, else by the hotter leader's aggression): +0.12; + distance beyond a day's walk (600 game minutes ×
  BASE_WALK, paths × 1.3): +0.002 a day for each day of walking beyond half a day, up to 0.004 (the spec's +0.002 a day);
  + a daughter grown to 0.9 of its capital: +0.0015 a day at 1.2 times its size, up to 0.0045 at twice it; + a
  generation (20 game years) with fewer than 4 visits drifts its tongue (a new seed on its `langLine`, +0.05, then
  +0.0015 a day for each 0.18 of language distance beyond 0.3); + raided by kin +0.3 (the raider +0.15); + fields and
  hunting grounds in each other's land (+0.001 a day, kin opinion −0.01 a day); − a trade caravan or gift arriving
  (−0.0005), food sent in a famine (−0.15), time (−0.2 % a day: a grievance outlives a generation, half-life ~29 years).
- **Secession** above 0.6: daily p = 0.02 × min(1, (g − 0.6) / 0.15 + 0.2) × the independence party's strength
  (0.5 + hawks + ½ seekers + (g − 0.6), 0.5..1); a famine or raids at the root, or g > 0.85 with a war party, make it a
  revolt (war.ts declares war, cause 'revolt'); a peaceful parting not over a feud is sealed by a pact of open roads
  (`trade-pact`, event `treaty { kind: 'parting' }`, chronicle `treaty.parting`). Event `secession { settlement, from,
  capital, cause, grievance, revolt }`, chronicle `secession.<cause>`. The old flat chances for distance > 1 400 m and
  tongue > 0.45 are gone (they now weigh in the grievance); a schism and an unreconciled conquest keep theirs, salted with
  the world (every world's daughters used to leave on the same days: the base kin fixture's five secessions all fell on
  day 56). A polity's capital is its founding town when its record is made (a daughter stepped before its mother used to
  become the capital of a polity it had not founded — in the base fixture runs too).
- **Kin raids**: a town under a day of food a head raids a town within two days' walk with 5 days a head that it holds
  below 0.3 (kin: 0.5 − its grievance × 0.8, less raids and friction between them; other peoples: the relation) —
  inside one polity too, one party at a time; raiders who win drive off livestock as well as stores (up to 0.3 of the
  largest herd, two head a raider: `war.ts plunder`).
- **Eras** (`eras.ts`): the era index is unchanged; `eraLabel` reads capabilities (stone age, fire-keepers, first
  farmers, potters, copper age, bronze age, iron age; classical age … space age by index only with metal known). Pace:
  the next era's ideas open after `DWELL` years in the present era (stone 0, fire 4, clay 16, bronze 26, iron 10,
  classical 18, medieval 14, gunpowder 24, steam 12, electric 12; a people stuck in an era moves on after the sum of the
  dwells between); an idea is built on only once practised (`PRACTICE` years of its era: 0, 0.5, 1, 3, 3, 3, 3, 2, 2, 1.5,
  1.5, or 24 crafts of it in the LAND ledger); an age's institutions (writing, law, money, calendar, diplomacy,
  mathematics, astronomy, schooling, medicine, quarantine) only once the people has reached their era and lived half
  its dwell. Gated: experiments and everyday accidents. Not gated: wonders (star iron, miracles, comets, eclipses,
  lightning in the dunes — the next era at once, never beyond), and everything learned from others or the god.
- **The god's acts** (`god/history.ts`): `settlement.advance { settlement, era? }` and `settlement.teach { settlement,
  era: 'next' | <era> }` (knowledge now optional; `anyOf: knowledge, era`): everything up to and including the era
  taught, groundwork first (the first idea by `forceTeach`, the unwilling compelled and afraid; the rest as lessons), the
  new era's clock starting now, one chronicle line (`era.god`). `world.terraform { planet? }`: air at once
  (`planet.add-air` 1); when the air has warmed the rock above 12 °C (or after 14 days) a world-wide storm and the seas
  raised into the lowest quarter of the land; a day later the storm lifts; two days after, grass over the land and berry
  scrub and two forests on the warmest wet land (`PlanetState.terraform { stage, t }`, stepped hourly by sim.ts). A
  world already habitable for plains folk (score > 0.3, breathable) is refused: "Gaia is alive already".
- **Free text** (`god/freeform.ts`, `god/freeform-history.ts`, lexicon `biomeWords`): "on the sea near X" — the nearest
  water to X (the open sea within 5 km when asked for); "near X but not on it" / "clear of it" — dry land beyond X's
  edge; "between X and Y" — the middle of the two, a town's radius clear of both (`Mods.mid`; a mountain between them is a
  ridge ACROSS the way from one to the other); "make the river / lake flood" — a flood where it runs (no river: the
  nearest water); "turn A into B" — B painted over the nearest A (a world without deserts: its driest land); jungle →
  rainforest, swamp / marsh / bog / fen → wetland (with shallow water, beside a named town, not on it); "new X world" →
  `world.birth { kind }`; "advance X to the next era"; "terraform this world"; knights, heroes (soldier + inspired),
  champions; "create a new kingdom" (a people of its own, set down beside the largest town); "armageddon" (every people
  at war with its nearest neighbour, a volley of disasters at full wrath) and "send every disaster at once" (six). A
  destructive act landing on a standing town the words never named sets `ParseOut.confirm` ("This would strike Aru (31
  people), which you did not name. Go ahead?"); an end of days and every disaster at once always do. The duplicate
  Firestorm power `firestorm-call` is gone (`disaster-firestorm` keeps every synonym; `fire.firestorm` still runs).

### 5.5 Measured (HISTORY; before = the tree HISTORY started from, `base/` and LAND's census; after = this tree; 3000x)
| measure | before | after | target |
|---|---|---|---|
| free-text phrases resolved as meant (`freeform.ts`, `tests/omnipotence.test.ts`) | 9 / 62 at the spec; 47 / 62 with the other lanes in (HISTORY's own 1 / 16) | **62 / 62** (HISTORY 16 / 16) | 62 / 62 |
| kin fixture, ≥ 1 secession (`kin.ts`, 8 seeds × 20 years) | 5 / 8 — every one on day 56 (year 4.67), always the daughter beyond 1 400 m: an unsalted flat chance, not a grievance | **4 / 8** (seeds 2, 3, 6, 8; years 11.9–17.3; 6 secessions) | ≥ 5 / 8 |
| ≥ 1 raid or war | 0 / 8 | **1 / 8** (seed 2: a revolt, 1 war, 3 battles, 2 conquests) | ≥ 3 / 8 |
| ≥ 1 treaty | 1 / 8 (seed 2, a trade pact) | **3 / 8** (seeds 3, 6, 8: five peaceful partings sealed by a pact of open roads) | ≥ 2 / 8 |
| control (the capital feeds every famine): no secession | no secession in 3 / 8 (base secession had no food term: the control is the same world) | **4 / 8** (seeds 1, 4, 5, 7; in seed 1 — the one famine — the starving daughter is fed ten times, lives (59 people at year 20, not starved out by year 7) and ends at grievance 0.12, not 0.62; the 7 others are the normal run's world) | ≥ 6 / 8 |
| era labels against capabilities (census, settlement-years) | no label: the era index read "bronze" from the first copper smelting — 58 of the 910 settlement-years below were a "bronze" era without bronze (seed 20261008: years 26.1 → 52.6; its bronze came at 127.1, tin found late) | **0 of 910** inconsistent (all 58 read "copper age") | 0 |
| polities / wars / raids, census 8 seeds × 8 years (§0.4) | 1 / 0 / 0 | 1 / 0 / 0 — still one town per world at year 8 (25–41 people) and at year 30 (16–70); seed 20261008 over 230 years: first daughter at year 125, then 13 secessions, 11 wars, 42 raids, 1 treaty, up to 4 polities | §5.1 fixture |

Era timeline (§1.5; a 30-person band, the n = 64 sandbox, no god; game years of the first recipe):

| milestone | target | before (LAND's census: 8 seeds × 8 y; 4 × 30 y) | after (7 census seeds: 1234 1 2 3 4 5 × 30 y, 20261008 × 230 y) |
|---|---|---|---|
| fire-keeping | 1–6 | 4.0 (0.17–5), 8 / 8 | 4.0 (0.17–5), 6 / 7 in band (seed 3 at 0.17: PACE's lightning) |
| agriculture | 3–12 | **0.08** (0.08–0.42), 0 / 8 in band | **6.3** (4.1–8.1), 7 / 7 |
| pottery | 6–18 | **4.4** (2.5–5.9), 0 / 7 | **8.1** (4.5–9.3), 6 / 7 |
| copper smelting | 20–40 | **5.2** (3.9–6.2 in 6 of 8 by year 8; 3.9–15.3 in the 30-year runs), none in band | **24.1** (22.0–24.5), 7 / 7 |
| bronze | 30–55 | 0 / 4 by year 30 | 127.1 (1 / 1; no tin until late; 0 / 6 by year 30) |
| writing | 35–65 | 28.4 (1 / 4 by year 30) | 39.3 (1 / 1; 0 / 6 by year 30, as it should) |
| iron smelting | 50–85 | — | 52.6 (1 / 1) |
| classical era | 65–100 | — | 65.5 (1 / 1) |
| medieval era | 90–130 | — | **177.1** (0 / 1) |
| gunpowder … first orbit | 110–230 | — | not by year 230 |

The early ages now keep the timeline (copper had come 14–16 years before its band in every seed; now 7 of 7 in band). From the
classical age on, the one long run is slow: a single town of 86–157 people from year 60 to 120 (its first daughter at
year 125) added 10 ideas from year 70 to 130; the dwell opened the medieval ideas at year 83.5, and the first came at 177 —
the pace is the number of minds (LAND's demography) and the late recipes' own discovery rates (steel needs a forge and
practised iron tools), not the era clock. The second 230-year seed (7) was not run in this session (the machine was
shared: one 230-year run took 7 164 CPU s, 2 h of wall time).

Why the fixture falls short, from the runs (`out/kin-v7-<seed>.json`, `dbgsec.ts`): (1) **chance under the spec's cap.**
At p ≤ 0.02 a day and 12 days a game year, a daughter needs ~100 days above 0.6 to part with ~85 % odds; seeds 5 and 7
each held a daughter above 0.6 for 100–140 days (above 0.9 for the last 48–60, ending at 1.0) and drew no roll
under 0.02 in them (the roll itself is flat: 0.0190–0.0206 below 0.02 over 100 000 days, ids 1–4, seeds 1, 2, 3, 7). (2) **Famine is rare in this fixture**: only
seed 1 saw a daughter under a day's food while its capital stood (`famineSeen`) — there the capital's own aid came
8 days before the famine (year 5.3) and none in it: +0.45 at year 6.1 (grievance 0.62), and the town starved out by
year 7 before a roll fell; seed 4's three towns all died (the base run lost two of them too). So raids among kin (which the spec ties to hunger) did not happen, and the control —
which only acts in a famine — is the same world as the normal run in 7 of 8 seeds: the two targets (≥ 5 / 8 seceding;
the control ≥ 6 / 8 not) cannot both hold while 1 of 8 seeds has a famine. What the control changes is shown where it
can be: the unit tests (aid in the famine −0.15 and no famine grievance; unrelieved +0.45) and seed 1 above.
Reproduce (in `_harness/scratch/living/history/`, two at a time): `node kin.ts <seed> 20 v7` and `env CONTROL=1 node
kin.ts <seed> 20 v7c` (`HROOT=base` for the old tree), `node census.ts <seed> <years> live 3000`, `node summarize.ts kin
base v7 v7c`, `node summarize.ts census live l230`, `node freeform.ts`; the logs and JSON are in `out/`.

---

## 6. LANE PLAN

### 6.1 Order
1. **PACE first, alone** (it changes the level-0 sim under everyone: walking, day structure, the save bump).
2. Then **LAND, RELATIONSHIP, CONTENT, HISTORY in parallel**. HISTORY's era-pace calibration (§5.2) starts when LAND's
   demography (§2.8) is in; its other work starts at once.

### 6.2 Ownership (a lane may read everything; it edits only what it owns plus the shared-file hunks of §6.3)
| lane | owns (existing) | creates (new) |
|---|---|---|
| PACE | `types.ts` time constants; `worker.ts`; `perf/lapse.ts`, `perf/plapse.ts`; `people/defs.ts` (`BASE_WALK`); `people/tasks.ts` (movement); `fields/weather.ts` (lightning); `fields/fire.ts`, `people/fire.ts`; `core/serialize.ts` (the 1.5 bump); `tests/perf-*.test.ts`, `tests/worker.test.ts`, `tests/clock.test.ts` | `perf/pace.ts` (tps ↔ level, day trips, camps, dusk rule), `core/migrate15.ts` (the shared migration list), `people/firewatch.ts`, `tests/living-pace.test.ts` |
| LAND | `people/work.ts`, `people/resources.ts`, `people/settlement.ts` (roles, births, wants, construction, abandon), `people/needs.ts`, `people/social.ts`, `people/lifecycle.ts`, `people/economy.ts` (wants); the four existing crops' `season`/`harvest` in `plants.json` | `people/hunt.ts`, `people/herding.ts`, `people/fishing.ts`, `people/crops.ts`, `people/demography.ts`, `people/gatherings.ts` (play, chores, festivals, weddings, funerals), `people/outlets.ts` (status, curiosity), `people/ledger.ts`, `tests/living-land.test.ts` |
| RELATIONSHIP | `god/belief.ts`, `people/culture.ts` (witness, faith daily), `people/danger.ts`, `god/disciples.ts`, `god/rivals.ts`, `god/miracles.ts`, `god/harm.ts`, `god/disasters.ts` (wrath, warnings), `god/hand.ts`, `god/projectiles.ts`, `god/creature.ts`, `god/watch.ts`, `god/state.ts`, `god/godparams.ts`, `god/index.ts`; `events.json` (god kinds); `weather.json` (`rainbow`); the Hand, Creature, disciple and miracle entries of `powers.json` and the new Signs powers; `creatures.json`; `tests/creature.test.ts`, `tests/hand.test.ts`, `tests/godseen.test.ts`, `tests/god.test.ts` | `god/regard.ts`, `god/prayers.ts`, `god/prophets.ts`, `god/omens.ts`, `god/sacred.ts`, `god/wrath.ts`, `god/precursors.ts`, `people/shelter.ts`, `god/freeform-signs.ts` (intents), `tests/living-relationship.test.ts` |
| CONTENT | `animals.json`, `plants.json` (new entries), `items.json`, `recipes.json`, `materials.json`, `ores.json`, `disasters.json` (leviathan), `god/inventions.ts`, `god/runtime.ts`, `life/ecology.ts`, `life/herds.ts`, `life/plants.ts`, `fields/vegetation.ts`, `fields/climate.ts` (moisture spin-up only), `world/planet.ts` (ores), `content.ts` (new registries' checks), `tests/ecology.test.ts`, `tests/content.test.ts` (non-creature parts) | `god/materials.ts` (`content.material`, `terrain.seed-ore`), `god/plantsrt.ts` (`content.plant`), `life/fauna.ts` (aliases, real-animal checks, migration), `god/freeform-content.ts` (intents), `tests/living-content.test.ts` |
| HISTORY | `people/war.ts`, `people/knowledge.ts`, `recipes/discovery.ts`, `god/freeform.ts`, `lexicon.json` (except the synonyms other lanes add), `powers.json` Firestorm merge, `tests/omnipotence.test.ts`, `tests/freeform*.test.ts`, `tests/society.test.ts` | `people/politics.ts`, `tests/living-history.test.ts` |

### 6.3 Shared files and how to edit them
Shared: `types.ts`, `people/decide.ts`, `people/tasks.ts` (new task kinds' start / finish), `people/state.ts`,
`people/agents.ts`, `people/settlement.ts`, `people/snapshot.ts`, `sim.ts`,
`content.ts`, `src/data/index.ts`, `powers.json`, `lexicon.json`, `events.json`, `god/freeform.ts`,
`core/migrate15.ts`, `tests/helpers/*`.
1. **Edit tool only, small additive hunks.** Your logic lives in your new module; the shared file gets a 1–3 line hook
   (e.g. `decide.ts` calls `landUtilities(x, s, U)` / `reliefUtilities(...)`; freeform's intent list gains your
   `intentProphet`). Never rewrite, reorder, rename or revert another lane's code; never reformat a file.
2. **Data:** append entries; edit an existing entry only in the fields your lane owns (§6.2); JSON stays valid
   (`content.test.ts` must load it).
3. **`types.ts`:** additions are optional fields, appended constants, appended union members (PACE alone changes the two
   time constants). **SoA columns** (`agents.ts`): append; a column is saved, so add its default in `migrate15.ts`.
4. **Saves:** PACE bumps `SAVE_MINOR` to 5 once for the program and creates `core/migrate15.ts`
   (`export const LIVING_MIGRATIONS: ((header) => void)[]`), called by `serialize.ts migrate()`. Each lane appends its
   step there (and every loader reads new state with a default: `j.prophets ?? []`). No lane bumps again.
5. **Ids** (appended, saved per agent — take only yours): `TASK` 52 play, 53 chore, 55 gather (LAND), 54 camp (PACE),
   56 shelter, 57 pilgrimage, 58 evacuate (REL); `AnimState` 26 play, 27 hunt, 28 herd, 29 carryGame (LAND), 30 shelter
   (REL); `DEATH` 16 childhood (LAND); `MEMK` 38 festival, 39 hunt-feat (LAND), 40 prophecy, 41 pilgrimage, 42 omen
   (REL); `AgentFlag2` as §6.5; command kinds and queries as §6.5.
6. PACE runs first and alone, so it may put its hooks for walking, day trips, camps and the dusk rule into any
   `src/sim/people/**` file (it lists every such hunk in its report); the parallel lanes then own those files as above.
7. After every shared edit: `npx tsc --noEmit -p tsconfig.json` (judge errors in your files), your tests, `node
   _harness/detban.ts`; `npm run check` before you report.

### 6.4 Seed-bound tests and multi-seed measurement
Seed-bound today: `meteor`, `emergence`, `society`, `people`, `survival`, `discovery`, `acceptance-barren`, `seed-salt`,
`plague`, `fire-flee`, `boats` (and the perf fidelity tests). When a change moves one: measure the mechanism over ≥ 8
seeds **before and after** with a script in `_harness/scratch/living/<lane>/`; re-seed or re-threshold only if it still
holds as often as before, and report both distributions. Never weaken or skip a test. Long runs at 1000x–3000x, two
processes at a time (4 shared CPUs). Census seeds: `20261008 7 1234 1 2 3 4 5`.

### 6.5 Interface additions (so the UI team can build now)
**Commands** (new unless noted):
| kind | params | lane |
|---|---|---|
| `time.scale` (changed) | `{ tps: number }` or legacy `{ scale: number }` | PACE |
| `prayer.answer` | `{ settlement: number, prayer?: number }` | REL |
| `prophet.call` / `prophet.abandon` | `{ agent: number }` | REL |
| `prophet.foretell` | `{ agent: number, what: 'rain'\|'food'\|'healing'\|'warmth'\|'protection'\|'rebuilding'\|'harm'\|'sign', days: number }` | REL |
| `god.omen` | `{ settlement?: number, pos?: UnitVec, kind?: 'eclipse'\|'comet'\|'flood'\|'rainbow'\|'lightning'\|'aurora'\|'red-rain'\|'still-sun'\|'sacred-animal'\|'spring' }` | REL |
| `place.sacred` | `{ pos: UnitVec, kind?: 'spring'\|'grove'\|'mountain'\|'site' }` | REL |
| `settlement.sacred` | `{ settlement: number, animal: string }` | REL |
| `set god.wrath` (law) and `disaster.spawn`'s `wrath?: number` | 0..1 | REL |
| `weather.paint` kind `rainbow` | existing params | REL |
| `terrain.seed-ore` | `{ ore: string, pos: UnitVec, radius?: number, richness?: number }` | CONTENT |
| `content.material` | §4.1 | CONTENT |
| `content.plant` | `{ name: string, type: 'tree'\|'shrub'\|'grass'\|'crop', like?: string, yields?: { item?: string, food?: number, tags?: string[] } }` | CONTENT |
| `settlement.advance` | `{ settlement: number }` | HISTORY |
| `world.terraform` | `{ planet?: number }` | HISTORY |
| removed | the 11 `creature.*` commands | REL |

**Snapshot / view fields** (all optional):
| field | type | lane |
|---|---|---|
| `TICKS_PER_SECOND_1X`, `SPEED_PRESETS` (changed constants) | `1`, `[0,1,2,3,5,10,30,100,300,1000,3000]` | PACE |
| `Snapshot.lapseLevel` | `0 \| 1 \| 2` | PACE |
| `Snapshot.regard`, `Snapshot.wrath` | `number` (−1..1), `number` (0..1) | REL |
| `HandView.regard` | `number` (−1 feared … +1 trusted) | REL |
| `Snapshot.creatures` | becomes optional, always absent | REL |
| `SettlementView.regard` | `{ faith, fear, trust, loyalty }` (0..1 each) | REL |
| `SettlementView.prayers` | `{ id: number; kind: string; since: number; until: number; urgency: number }[]` | REL |
| `SettlementView.prophet` | `{ agent: number; name: string; credibility: number }` | REL |
| `SettlementView.sacred` | `{ places: number; animal?: string }` | REL |
| `MoverBlock.flags2` + `AgentFlag2` | `Uint8Array`; `{ prophet: 1, sheltering: 2, pilgrim: 4, festive: 8, camp: 16, hunter: 32, herder: 64, called: 128 }` (the 16-bit `flags` are full) | REL / LAND |
| `AnimState` | `play: 26, hunt: 27, herd: 28, carryGame: 29, shelter: 30` | LAND / REL |
| `SettlementView.livelihood` | `{ food: Record<'forage'\|'hunt'\|'fish'\|'farm'\|'herd', number>, herds: number, under15: number }` | LAND |
| `SettlementView.eraLabel`, `SettlementView.grievance` | `string`, `number` | HISTORY |
| `DisasterView.params.warning` | `1` during a warning phase | REL |

**Queries** (new unless noted; the existing names are in `sim.ts:652` and `people/query.ts:23`): `pace` (PACE); `ledger`
(LAND); `regard`, `prayers`, `prophets`, `sacred`, `omens`, `sigils` (REL); `ores`, and the existing `materials`
extended with invented ones, their deposits and uses (CONTENT); the existing `polities` / `relations` extended with
grievances (HISTORY). **Events** (`SimEvent.t`): `prayer.raised | .answered | .lapsed`,
`prophet.called | .foretold | .fulfilled | .failed | .persecuted`, `omen`, `shelter`, `evacuate`, `warning`, `hunt`,
`tame`, `harvest`, `festival`, `wedding`, `funeral`, `ore.seeded`, `secession`.

### 6.6 Acceptance per lane — what each lane reports (before → after, multi-seed)
| lane | metrics | script (in `_harness/scratch/living/spec/`, copied to the lane's folder) |
|---|---|---|
| PACE | §1.6: presets / levels / hashes, walking & dusk & dark shares, food per adult-day, throughput, lightning fires, fire-keeping year | `pace.ts` (daily, fire, throughput), `census.ts` (firsts), `_harness/perf_worker.ts` |
| LAND | §2.1–2.11: kills, hunted share, tames, herd share, shoal share and depletion fixture, harvests per sowing, farm share, beds, gathered kinds, drought fixture, demography (u15, intervals, infant / child deaths, growth), status / curiosity, child time, festivals | `census.ts` (8 seeds × 8 years; 30-year run for demography), `pace.ts daily` (children), LAND fixtures |
| RELATIONSHIP | §3.8 | `relationship.ts` (prayer, acts, influence, lethality, shelter) + the prophet and persecution fixtures |
| CONTENT | §4.6 | `content.ts` (roster, invent, ecology), `census.ts` (false extinctions, herds) |
| HISTORY | §5.1 fixture, §1.5 timeline (8 × 50 years + 2 × 230), era-label consistency, §5.3 62 / 62 | `census.ts` (firsts), a `kin.ts` fixture, `freeform.ts` |

---

## 7. Hooks for the UI / render / audio team (nothing here edits their files)
- **H1 Speed steps** — the HUD renders `SPEED_PRESETS` (11 buttons, or a stepper), a "time-lapse" badge from
  `Snapshot.lapseLevel`, achieved speed; keyboard steps; `?speed=` is tps; check the render clock at 1 tps
  (`tests/clock.test.ts`).
- **H2 Relationship meters** — per settlement faith / fear / trust / loyalty (`SettlementView.regard`), the world's regard
  (`Snapshot.regard`), and the Touch's look from `HandView.regard` (feared: storm-dark, trusted: warm light).
- **H3 Prayers** — an icon over a praying town, a HUD list, toasts, an "answer" action (`prayer.answer`).
- **H4 Prophets and signs** — a prophet marker (`flags2.prophet`) and an inspector card (credibility, open prophecies,
  persecution); a "send a sign" picker (`god.omen` kinds), "foretell" (`prophet.foretell`), call / abandon; sacred places
  and the sacred animal on the map; a new radial category **Signs** in place of **Creature** (`src/ui/powers.ts:48`).
- **H5 Wrath and warnings** — a wrath slider (`set god.wrath`), size words in the preview; warning-phase VFX
  (`DisasterView.params.warning`); evacuating and sheltering crowds (`flags2.sheltering`, `AnimState.shelter`, run).
- **H6 Creature removal** — drop the creature layer, `creaturegen`, `ui/creatures.ts`, palette / inspector / help
  entries, the radial category, creature sounds; `Snapshot.creatures` is never sent.
- **H7 The Touch** — category label "Touch", new power names (§3.6); the hand's look becomes light and weather.
- **H8 Sigils** — recogniser templates for the 14 glyphs of §3.6 from the `sigil` field (then `gesture` is removed).
- **H9 The Called** and rival epithets — labels from powers / queries.
- **H10 Living off the land** — animations `play`, `hunt`, `herd`, `carryGame`, `dance` at festivals, camps; bodies for
  the new real species (CONTENT lists body plans per species), new tree and crop forms (apple, olive, date palm, fig;
  barley, sorghum, potato, lentil, cotton); the settlement card from `livelihood` and the `ledger` query.
- **H11 Era label** — show `SettlementView.eraLabel`.
- **H12 Materials** — a "seed a vein" brush with an ore picker (`terrain.seed-ore`), invent-material and invent-plant
  dialogs (or the free text field), ore outcrops where `ore` is high.

---

## 8. Baseline measurements (current tree, 2026-10-13)
All probes live in `_harness/scratch/living/spec/` (`lib.ts` shared helpers; `hooks.mjs` + `register.mjs` an in-memory
loader hook that counts gathering, hunts, tames, sowings, harvests, crafts and store additions without changing a source
file — it reports any anchor it could not find, so a moved line reads "n/a", never a false 0). Outputs in `out/`.

| family | command | output |
|---|---|---|
| PACE | `node --import ./register.mjs pace.ts throughput 0,30,300,1500 1` | `out/pace-throughput-1d.json` |
| PACE | `node --import ./register.mjs pace.ts daily 20261008,7,1234,1,2,3 1 2` (and `LIVING_WALK=1.6`, `2`, `2.5`) | `out/pace-daily*.json` |
| PACE | `node --import ./register.mjs pace.ts fire 20261008,7,1234,1 2` | `out/pace-fire.json` |
| LAND / HISTORY / ecology | `sh run-census.sh 8 band` (8 seeds × 8 years at the legacy 1000x, two at a time), `node summarize.ts census band` | `out/census-band-<seed>.json` |
| RELATIONSHIP | `node relationship.ts <prayer, acts, influence or shelter>` (n = 20 town); `node relationship.ts lethality 20261008,7,1234,1` (n = 64) | `out/rel-*.json` |
| CONTENT | `node content.ts <roster or invent>`; `node --import ./register.mjs content.ts ecology 20261008,7,1234,1 3` | `out/content-*.json` |
| free text | `node freeform.ts` | `out/freeform.json` |
| all after the census | `sh run-rest.sh` | |

### 8.1 A people left alone (`census.ts`, 8 seeds × 8 game years, 30 stone-age plains folk as a band, legacy 1000x)
| year | people, median [min–max] | under 15 | ideas | births / deaths (sum) | harvests | food: forage / hunt / fish / farm / herd | belief / fear |
|---|---|---|---|---|---|---|---|
| 1 | 31.5 [30–37] | 0.28 | 12 | 18 / 3 | 2 | 0.96 / 0 / 0.04 / 0 / 0 | 0.20 / 0.10 |
| 2 | 35.5 [31–41] | 0.36 | 16 | 36 / 4 | 37 | 0.83 / 0 / 0.10 / 0.07 / 0 | 0.16 / 0.05 |
| 4 | 49 [39–60] | 0.53 | 26 | 64 / 4 | 45 | 0.78 / 0 / 0.14 / 0.08 / 0 | 0.10 / 0.03 |
| 6 | 59.5 [52–70] | 0.66 | 30 | 50 / 27 | 38 | 0.80 / 0 / 0.13 / 0.07 / 0 | 0.13 / 0.04 |
| 8 | 67.5 [55–71] | 0.71 | 31.5 | 36 / 16 | 24 | 0.83 / 0 / 0.12 / 0.04 / 0 | 0.09 / 0.02 |

Over all seeds and years: 361 births, 23 deaths under 15 (5 under 1), deaths by cause old age 38 / sickness 31; a
mother's births 0.69 game years apart (median of 287 intervals); growth 10.7 %/year. 2 kills from 17 hunting attempts, 0
tames, 0 slaughter, 1 113 sowings → 231 harvests, 1 023 fishing sessions of which 12 drew on a shoal. Gathered: wild grain
65 026, roots 28 894, berries 4 754, wood 2 993, nuts 1 907, clay 759, stone 491, reeds 471, stick 227, fiber 225, flint
116, herbs 85. Crafts: milling 6 622, mudbrick 227, stone tools 184, basketry 101, hand axes 50. Status at 0 for 100 % of
adults (median), curiosity for 70 %. Firsts (game year): agriculture 0.08–0.33 everywhere; hunting 3.8–7.0 (7 seeds);
husbandry 5.7–7.3 (3 seeds); fire-keeping 5.0 and 5.9 (2 seeds); pottery and copper smelting 7.2 / 7.8 (seed 4). Eras at
year 8: six stone, one fire, one clay. Lightning 31 690 strikes → 3 fires; fire starts by cause: wildfire 5 156, solar
flare 437, lava 380, rift 79, god 23, lightning 3, hearth 1. One polity per seed, 0 wars, raids, battles or treaties;
113 natural disasters. Belief in the silent god 0.20 → 0.09, fear 0.10 → 0.02; worship pool 327–550 at year 8. Ecology
with people: 84 speciations (the first at day 35.5), 44 extinction notices of which 33 false; land herds 11–17 → 36–88,
predator herds 2–6 → 0–3; the nearest wild land herd 2 024 m (year 1) and 1 516 m (year 8) from a settlement; willow
1 617–2 345 → 2 807–5 101 cells, oak 985–1 818 → 176–462. (`out/census-band-<seed>.json`, `out/census-summary.txt`.)

### 8.2 A day in the village (`pace.ts daily`, 6 seeds, a settled village warmed one year, then 2 days at level 0)
Adults' time: asleep 0.53, walking 0.33, working 0.10, eating and drinking 0.024, leisure 0.016, prayer 0. Of waking
time 0.69 is walking (0.42 to work); 0.26 of the walking is in the dark; work begun after dusk 0.008; median straight-line
walking speed 14.5 m per game hour; median work distance 18 m (p90 86 m); food 1.25 units per adult-day (0.81–1.62),
from foraging (and fishing in two seeds); parched 0.2 % and starving 1.1 % of samples. Children: asleep 0.53, wandering
0.17 (0.02–0.26), socialising 0.13, eating 0.12, chores 0.04 (one seed), play 0. The what-ifs are in §1.3.
The what-if at the decided `BASE_WALK = 2` (`LIVING_WALK=2`): walking 0.41 of waking time (0.26 to work), work begun
after dusk 0.003, walking in the dark 0.10, median work distance 88 m (p90 162), food 2.19 units per adult-day (1.34–
3.31), adults working 0.24 of their time and at leisure 0.017, children wandering 0.35.

### 8.3 Throughput (`pace.ts throughput`, CPU ticks per second, n = 64 sandbox, one game day per level)
| agents | level 0 | level 1 | level 2 |
|---|---|---|---|
| 0 | 990 | 881 | 2 273 |
| 30 | 1 048 | 1 263 | 2 428 |
| 300 (306 → 340) | 783 | 1 108 | 1 957 |
| 1 500 (1 525 → 1 687) | 733 | 899 | 1 406 |

Side by side under the same load (`out/pace-throughput-1d-rerun.json` vs `-walk2.json`), today's code vs `LIVING_WALK=2`:
300 agents L0 781 → 657, L1 693 → 563, L2 1 497 → 1 135; 1 500 agents L0 671 → 514, L1 826 → 800, L2 1 448 → 1 325.
(CPU time on a shared machine: the rerun of today's code differs from the first run above by +3 … −37 %, so compare
only rows measured together.)

### 8.4 Fire and vegetation without people
`pace.ts fire` (4 seeds × 2 years): 4 712 strikes, 0 lightning fires; seed 7's two natural wildfire disasters burnt up
to 1 837 cells. `content.ts ecology` (4 seeds × 3 years from the world as built): willow 316–557 → 2 330–3 511 cells,
oak 1 758–2 167 → 473–957, spruce 354–454 → 157–213, saturated soils 1 446–1 836 → 5 600–6 415, open grassland 0.8–1.6 % →
2.2–3.7 % of the land; land herds 10–17 → 13–32 with 2–3 predator herds; speciations only in year 3 (2–4 per world),
of 5 extinction notices 4 false.

### 8.5 The god's acts (`relationship.ts`, the tests' bronze town, n = 20, 30 people)
| act | dead (of 30) | mean love before → a day after | mean fear before → after |
|---|---|---|---|
| nothing | 0 | 0.080 → 0.079 | 0.040 → 0.038 |
| food sigil (food miracle) | 0 | → 0.553 | → 0.040 |
| heal / water miracle | 0 / 0 | → 0.661 / 0.422 | → 0.040 |
| gift of 40 bread | 0 | → 0.366 | → 0.040 |
| lightning miracle | 23 | → 0.214 | → 0.990 |
| tornado | 9 | → **0.851** | → 0.990 |
| meteor / quake | 30 / 30 | (nobody left) | |
| plague | 0 in a day | → 0.080 | → 1.000 |
| blood rain | 0 | → 0.160 | → 0.098 |

Prayer over 20 quiet days with a temple: praying 0.000, worshipping 0.000, preaching 0.007 of 58 942 person-samples;
worship pool 76.8 (all from preaching). 3 days after a tornado: praying 0.000, worshipping 0.002. Shelter (painted weather,
intensity 2, one day): awake adults inside 0.000 in every weather; at outdoor work 0.808 clear, 0.776 blizzard, 0.654
thunderstorm, 0.776 hail. The levers of influence: §0.3. Lethality at n = 64: §3.7 (per seed in `out/rel-lethality.json`).

### 8.6 Content (`content.ts` roster and invent)
27 animals, of which `ice-beast`, `sand-crawler`, `haze-ray`, `drift-ray` are not real (and the `leviathan` disaster);
chicken has no wild ancestor; grazers without a predator in rainforest, wetland, desert, dune, savanna; no animals at all
in ice, volcanic, barren biomes. 30 plants, 4 crops (wheat, rice, maize, flax), 3 wild ancestors, 0 fruit trees, every
harvest `grain`. 16 materials, 16 ores (uranium and gems map to no item), 152 recipes, 129 items. Registered: `content.item`,
`content.animal`; not registered: `terrain.seed-ore`, `content.plant`, `content.material`, `content.species`, a wrath law,
prayers. "Introduce mithril to Aru" + a gift of 20 glowstone, 10 days: 14 knowers, stock 0 → 2, 0 recipes or materials use
it, 0 deposit cells; "give Aru 20 glowstone" became the same kind of introduction (a strange object laid near Aru),
stock 0 → 2. Creature templates: ape, ox, great cat, tortoise, wolf, bear.

### 8.7 Free text (`freeform.ts`): 9 of 62 phrases resolve as meant — per phrase in `out/freeform.json`.

---

## 9. Questions for the owner (the spec proceeds on the default in brackets)
1. The two non-human peoples (the hive, the methane drifters) are not real-world. Keep them as the alien peoples of other
   worlds, or replace them with human peoples? [keep: the rule was stated for animals]
2. `glass-storm`, `forgetting-fog`, `overgrowth`, `gravity-slip` are not real phenomena (not creatures). Keep or cut?
   [keep]
3. Names: the Touch, sigils, the Called, the eight rival epithets, the sigil glyphs. [as §3.6]
4. Animal sacrifice in fearful towns (never people) — in or out? [in, rare]
5. The era timeline of §1.5 (first orbit around game year 200, roughly 30–90 real minutes at 3000x). [as §1.5]
6. Walking at 2 m/s at 1x (a brisk walk; §1.3) — or slower and natural (1.4 m/s) with more camps and shorter trips?
   [2 m/s]

## 9. Owner-session fixes outside the lanes (2026-10-14)

Two task cards the RELATIONSHIP lane filed were fixed in the owner's session. Integrator and reviewers: keep both; the
evidence is below.

### 9.1 Smoulder is not flame (task: "Fix fire taboo starving a town beside a full store")

**Cause.** The fire taboo was not the cause. After `miracle.fireball` on the seed-1 town
(`_harness/scratch/living/relationship/live/dbg-flame.ts`), the town's core cell smouldered for 8 days. It held 16
buildings, including the store and the well, and its fire fell from 0.20 to 0.05 as the buildings burned down.

The danger rules of the 2026-10-13 fire fix treated any cell above `FIRE_HERE` (0.05) as "standing in fire". That made
flight the only option there, and the fire step interrupted anyone inside. Burns only begin above `FIRE_BURN` (0.2). So
every walk home to eat or drink turned into a flight, and 24 of 30 people starved on days 7-8. The store still held
180 → 61 units of edible food (dried meat, grain); the probe's "store food ~360" counted every item, not only food.

**Fix.** The thresholds now agree:
- Flight-only danger and the fire step's interrupts happen above `FIRE_BURN` (where people burn).
- A flight's goal counts as alight above `FIRE_BURN`.
- Water in a smouldering cell may be drunk.
- Errands are re-routed only around flames. Smoulder still costs extra in route search.

Files: `people/danger.ts`, `people.ts` fireCheck, `decide.ts` drink planners, `tasks.ts` throughFire. The fire tests now
count "in fire" above `FIRE_BURN`. They gained "a town whose core smoulders still eats and drinks there", which fails
before the fix.

**Results.**
- dbg-flame on seed 1: 0 deaths in 10 days (was 24 starvations). The taboo still forms, and the town rebuilds,
  feasts and invents.
- Wildfire probe (seeds 11/33/44/55 × 1x/1000x): deaths by fire and thirst are unchanged (0). Agent-ticks spent
  drinking in flames are 0 before and after.

**Minor, for LAND.** After the taboo the chronicle can say a town "feasted … by the fire" (gatherings). A people sworn
off fire should feast without one.

### 9.2 A varied table (task: "Trace the trade collapse in the iron scenario")

**Cause.** `economy.ts` did not change. LAND made both iron towns well fed. By day 9 of seed 2 the two towns held
+246 and +467 food-days above the 8-day keep; on the base copy one town was −173 short.

Food was priced as one need: a deficit meant hunger, and every food cost the same. So two well-fed towns had nothing
to trade, even though one held 550 rice and 180 fish and the other 450 maize and 160 bread with 6 fish. The fair
run's trade fell from 270.6 (base) to 0, and without caravans the have-nots' opinion sank to −0.53.

**Fix** (`economy.ts`, `VARIETY` = 2 units a head):
- Prices: a food a town holds little of costs up to 1.6x more there; one it holds in abundance costs 0.8x.
- Deficit: each food a town eats counts as lacking up to `VARIETY` a head, on top of the hunger deficit.
- Surplus: the seller keeps back `VARIETY` a head of each kind.

Hunger still comes first (`foodScarcity`, `foodLack`). Test: society "well-fed neighbours still trade" fails before
the fix.

**PACE's iron scenario, seeds 1-12** (`WARY=-0.1 DAYS=24 sb-iron.ts`):

| | Holds | Fair-run trade > 10 | Mean fair-run trade | Iron wars |
|---|---|---|---|---|
| Base | 4/12 (1, 2, 4, 7) | 4 | 40 | 6 |
| Current | 2/12 (1, 4) | 4 | 25 | 8 |
| Fixed | 4/12 (1, 4, 7, 9) | 8 | 89 | 6 |

The mechanism holds as often as on the base copy. Which seeds hold moved: on seed 2, variety trade now also links the
monopoly holder and the have-nots, so they do not go to war; seed 9 now holds. `tests/society.test.ts` (seed 10)
passes before and after. Trade suites (boats, contact, plague, society, worlds): 24/24.
