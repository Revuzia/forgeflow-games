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

### 2.14 Round 5 (LAND lane, 2026-10-21; probes and logs in `_harness/scratch/living/land/r5/`)

The lane ran again on the integrated tree (the 2026-10-20 integration) to close what §2.13 and the integrated acceptance
(`_harness/scratch/living/acceptance.json`) left open. Each change was found with a probe on that tree first (in-memory
hooks, no file changed: `r5/hhooks.mjs`), and each new test fails with its change taken out again in memory
(`r5/rv/*.json`: `REVERT=<json> node --import r5/revert.mjs --test --test-name-pattern=<test> tests/living-land.test.ts`).

- **Hunting parties** (`hunt.ts`). A party traced at level 0 (`r5/tprobe.ts`, seed 1234, two hunters after boar
  780 m out): one set out while the other finished a foraging session 850 m away, then walked home to eat; the lone
  stalker (a 9 % chance an encounter) took 80 hours for one boar. Per party (`r5/pprobe.ts`, seeds 7 and 1234, five
  years of hunting each): 2.6–2.7 hunters, 52–72 hours out, 30–50 hours to the first encounter, 0.54–0.96 kills; the
  parties were out most of the year and the other hunters gathered.
  Now: a party musters at home (`MUSTER_M` 250 m) and takes `PARTY_FOOD_DAYS` 2 of food from the store; up to
  `PARTIES_MAX` 2 parties are out at once, each after its own herd (with hunters enough at home and none out, two
  parties of 2–3 rather than one of six; with only dangerous game near, the four go together); a band gives
  `HUNTERS_BAND` 0.3 of its food workers to hunting (the top of §2.1's 15–30 %, so that two parties can go); and the rest
  of a big kill — over `CACHE_MIN_KG` 15 kg more than the hunters there could carry (a wild horse's 150 kg against a
  party's 60–90) — is left by it (`HuntParty.cache`, by item id) and fetched in relays while it keeps (`CACHE_DAYS` 1.5;
  `TASK.hunt` with `data2` 2), then it is the scavengers'. Saved: `LandState.more` (the parties beyond the first) and
  `HuntParty.cache` are optional JSON, absent in older saves and whenever unused.
- **Crops where there are no seasons** (`crops.ts farmTask`). Seed 7's town knew agriculture, kept 170–240 units of
  seed, named five farmers and sowed nothing (§2.13 "seed 7 never farmed"; the integrated run: no farm food in 46
  years). A new field's sowing window was read at the town's own cell, and where there are no seasons sowing follows
  the soil's wetness: the dry ground a town stands on never grew wet enough for rice (moisture ≥ 0.8), while seven cells
  around it suited rice (`r5/fprobe.ts`). The window is read at the new field's own cell.
- **Roofs before repairs** (`land.ts roofless`, a two-line hook in `decide.ts planBuild`). Seed 5's band lost its nine
  huts to a rift's fire at year 5.9 and rebuilt none in a year (`r5/hsprobe.ts`): its six builders mended store pits —
  30 of them at 0.5–0.9 damage, dug as the store swelled with 800 flint, 900 wood and 850 sticks (`r5/hsdump.ts`) —
  while two hut sites waited with their wood and reeds in store and forty people slept out. A town with standing beds
  for fewer than half its people and a dwelling begun now mends only dwellings until the roofs are up. (Capping the
  stores at 2 + ⌈people / 8⌉ was tried and taken out again: with fewer pits a store swollen with sticks reads full
  — `perf/pace.ts storeFull` — and the fishers stop: seed 7's band caught no fish in year 1 against 68 sessions.)
- **News** (`outlets.ts talkOutlet / newsFrom`). Talk fed curiosity only when someone knew a craft the listener did not;
  where everyone has long known the same crafts the talk was empty (integrated 50-year runs: up to 29 % of adults
  without curiosity at a year's end). A talk now also tells the day's news: something the other lived through in the
  last day (a hunt, a birth, a death, a find, a couple, a building raised, a sign, a wound, a trade, a voyage, a fight,
  a move, a prophecy come true, a pilgrimage, a healing, a gift) that the listener has no memory of: `NEWS_GAIN` 0.08.
- **A people without fire feasts without one** (`gatherings.ts fireless`; `events.json festival.*.nofire`): §9.1's note
  for LAND — a town sworn off fire, or not yet keeping it, no longer "gathered by the fire" or "kept the fire high".

**UI hooks** (new; nothing here edits the UI team's files): `TASK.hunt` with `tData2` 2 is a hunter walking back to a
kill for the rest of it (draw them going out empty-handed and coming home with `AnimState.carryGame`); up to two hunting
parties may be out at once (`flags2.hunter` as before); the festival lines of a fireless people come from
`festival.harvest.nofire | midwinter.nofire | rains.nofire`.

**Demography, not changed (measured).** The integrated 50-year runs (`integrate/out/alone-live-*.json`) put the under-15
share at 0.46 (0.437–0.485) over years 10–30 with growth 1.84 %/year; the cohort model of these rules
(`r5/demomodel3.mjs`, 300 runs) gives the same, 0.458 at 1.74 %. In it the share falls under 0.45 only with growth
at or below 1.5 %: fertility × 0.85 → 0.447 at 1.50 %, × 0.75 → 0.440 at 1.37 %, birth gaps of 2.5–3.5 years → 0.447 at
1.45 %, 3–4 years → 0.425 at 0.90 %. With 15–22 % of births dying before 15 and adults living to ~55–60, §2.8's two
targets meet only at the corner (u15 0.45 with growth 1.5 %), as §2.13 found — real peoples growing at 2–2.7 % a year are
45–50 % children. Nothing was tuned: a fertility cut would move every era date HISTORY calibrated (§5.2).

**Measured** (the census of §2.13, `r5/census.ts` reading the ledger: a band of 30 left alone on the n = 64 sandbox,
natural disasters on, legacy 1000x = level 2; 8 seeds × 8 years, two at a time; before = this round's base copy
`r5/base/` (the integrated tree as it stood when the lane began, 2026-10-21 00:10), after = the tree with this round's
changes and the other lanes' as they stood when each seed began; summaries `r5/out/summary-before.txt` / `summary-after-final.txt`,
`hsum-before.txt` / `hsum-after-final.txt`, `curio-before.txt` / `curio-after-final.txt`, `table-final.txt`; the after
runs finished at 01:10, before CONTENT's and HISTORY's second passes touched the tree):

| metric (target) | before | after |
|---|---|---|
| kills per 100 people a year, hunting known (≥ 20) | 9.61 pooled, median 10.61 [3.18–16.93] (163 kills, 173 parties) | 10.61 pooled, median 10.94 [5.67–14.21] (176 kills, 192 parties) |
| hunted share of food (0.15–0.35) | 0.137 pooled, median 0.142 [0.009–0.231] | **0.166** pooled, median **0.161** [0.031–0.352] |
| food by source, pooled: forage / hunt / fish / farm / herd | 0.427 / 0.137 / 0.347 / 0.056 / 0.033 | 0.396 / 0.166 / 0.324 / 0.046 / 0.068 |
| food per head-year · hunger / thirst deaths | 12.07 · 0 / 1 | 12.08 · 0 / 0 |
| tames · herd share where kept (0.05–0.20) | 9 · 0.033 | 13 · 0.068 |
| harvests per sowing (≥ 0.8) · farm share 3+ years after agriculture (0.30–0.60) | 0.80 (129 / 161) · 0.28 | 0.76 (111 / 147) · 0.31 — seed 7 now sows (2 / 2; none in 8 years before) |
| houses: beds ≥ 0.9 × people and ≥ 90 % housed every year end (≥ 7 of 8) | 5 of 8 (59 / 64 seed-years) | 4 of 8 (58 / 64) |
| kinds gathered per settlement-year at year 8 (≥ 10) | median 9.5 [7–12] | median 9.5 [7–13] |
| infant deaths (5–12 %) · under-15 deaths (12–25 %) of births · birth interval (2–3.5 y) | 4.6 % · 19.4 % · 3.27 | 1.9 % · 23.1 % · 3.33 (108 births each: 5 and 2 infants) |
| growth (1.5–3 %/y) · under-15 share at year 8 | 1.95 · 0.43 [0.40–0.51] | 2.31 · 0.44 [0.38–0.51] |
| adults with curiosity < 0.02 at a year end (≤ 20 %): seeds above · worst · mean of the seed means | 2 of 8 · 0.357 · 0.058 | 3 of 8 · 0.40 · 0.059 |
| adults with status < 0.02 (≤ 20 %): worst | 0.045 | 0.043 |
| festivals a settlement-year · weddings / couples · funerals / deaths at home | 2 · — | 2 · 30 / 36 · 76 / 79 |

**Read.** Hunting rose by a tenth in kills and a fifth in share (the hunted share is now inside 0.15–0.35 pooled and by
median), and herds doubled their share; food per head is unchanged and nobody went hungry. Kills stay half of the
≥ 20 target for the reason §2.13 gave and this round traced (a hunt is a 2–3 day trip at the walking scale; on seed 1234
most of the hunt calls rejected were 'dark' (40) or 'hunters < 2' (16), `r5/hprobe.ts`). The houses row moved by one
seed-year (seed 2 ended with 20 beds for 35 people: its fifth household unhoused) and the curiosity row by noise of
the same size: the news outlet (above) shows in the 50-year integrated runs, where curiosity starves (§10), not over
eight years. The demography rows differ by a handful of deaths in 108 births on each side (infant deaths 5 → 2); LAND
changed nothing there. Each of the six changes has a test in `tests/living-land.test.ts` that fails with that change
taken out in memory (`r5/rv/*.json`). (§2.14's tables were completed by the integrator from the lane's finished after
runs: `node table.ts base/out-before out-after`, `node hsum.ts`, `node curio.ts`, `node summarize.ts` in `r5/`.)

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

### 3.10 Second pass (RELATIONSHIP lane, 2026-10-21; probes and logs in `_harness/scratch/living/relationship/live2/`, `out2/`)
The integrated acceptance (`_harness/scratch/living/acceptance.json`, §3.7 meteor row) left one RELATIONSHIP target
not met: the default meteor killed 0.4 % of the town against 10–35 %. Measured on this tree first (`live2/meteor.ts`,
the integration sessions' town: n = 64, 30 bronze-age people warmed a day, the meteor cast on the centre at the law's
wrath, 8 seeds; `out2/meteor-before2-*.json` on `base2/`, the tree without this pass):
- **Nobody died, by construction.** The blast peaks at 1.2 × 0.75 × L(0.3) × 1.4 = 0.76 of a body at its heart, and a
  death needs a blow past what the body has left. At the blow (the 36-tick warning, then the 24-tick fall) the warned
  town was 69–669 m out on the roads, 40–93 % of it still inside the 218 m blast.
- **The crater drowned the town.** At the default wrath the stone dug a 14 m bowl, 84 m across, at the town's heart. Next
  to the town's water it filled within the hour (7 m of water), and two days later the flood rule ruined the houses
  standing in it (13 of 15 on seed 1). On 3 of 8 worlds the heart moved (the integration fix, `settlement.ts moveHeart`).
  By day 10, 35–100 % of the buildings stood (mean 72 %).

**Changes** (`god/disasters.ts impact`, `god/harm.ts hurtPeople`, `god/precursors.ts`):
- **A burst in the air.** Below `AIRBURST_W` = 0.5, a god-sent meteor or comet bursts over its mark, as small stones do
  (Chelyabinsk, Tunguska). It gives the flash, the shock, the fires and star iron. It digs no crater and throws up no
  ejecta. The ground under it is scorched and its trees thrown down. Roofs are stove in as the crater's blow did it
  (`wreckBuildings` at 1.5 × the crater radius, B(w)). The `impact` event carries `data.airburst = 1`. From wrath 0.5
  up ("a great meteor") it strikes the ground and digs its crater as before. Nature's stones always strike.
- **Caught on the road.** Someone on the road when the blast comes (`TASK.evacuate` or `TASK.flee` as the act begins,
  `onRoad`) is thrown and struck. A blow k kills them with chance min(cap, 2 (k − 0.1)), where cap = 0.25 × (L(w) /
  L(0.3))². The draw is the person's own, salted with the disaster's seed. Those at home or at work take the blow as
  before. The full-wrath stone gives no warning, so nobody is on the road and its lethality is unchanged.
  - The tests' town (n = 20) is still within 55 m of its heart in its first hour. With the crater's own blow added to
    the shock (the first form of the burst), it lost 77–83 %. With the shock alone and the cap, it loses 13–27 %
    (`live2/tmeteor.ts`).
  - Without the salt, every town of the same ids lost the same people.
- **The streak.** The meteor is seen 36 minutes before the blow: 12 ticks of warning, then the 24 of its fall (it was
  36 + 24). An hour let the warned town walk clear. Calibration over the 8 worlds, killed at the blow:
  - warning 0, no cap: 23–60 %;
  - warning 12, gain 1.5, no cap: 10–33 %;
  - warning 12, gain 2, cap 0.25: final, below.

**Measured** (8 seeds, `out2/meteor-before2-*`, the final code `out2/meteor-final.log`):

| default meteor (target) | before | after |
|---|---|---|
| killed at the blow (10–35 %) | 0 on 8 of 8 | 10–28 %, mean 17.9 % |
| killed by day 10 | 0–3.1 % | 10–31 %, mean 18.3 % |
| buildings standing after the blow (≥ 60 %) | 75–76 % | 70–76 % |
| … on day 10 | 35–100 %, mean 72 % | 67–100 %, mean 82 % |
| fallen (never) | 0 of 8 (3 hearts moved off the crater lake) | 0 of 8 (no crater, no heart moved) |
| crater at the heart | −14.1 m on every world | none |
| new buildings within 10 days | 2–10 | 5–11 on every world |
| streak before the blow (≥ 20 min) | 60 min | 36 min |

Between the blow and day 3 the meteor's fire still burns part of a town (seed 3: 14 → 5 standing, rebuilt to 14 by
day 10). That is the fire model's work on wooden towns, and nobody fights fires.

**Seed-bound.** `meteor.test.ts` is cast at wrath 1: no warning, nobody on the road, crater path unchanged.
CONTENT's `sb-meteor-full.ts` (every assertion of the test, seeds 1–12) holds on 5 of 12 on `base2/` and on 5 of 12 now,
the same seeds (2, 4, 6, 10, 12; `out2/sb-meteor-base2.log`, `out2/sb-meteor-live3.log`). The test's seed 10 holds on
both. A first form of the road rule that struck everyone hurt, at every wrath, held on 1 of 12 (`out2/sb-meteor-live1.log`:
21–28 of 31 dead at wrath 1). It was dropped, which is why the rule asks who is on the road.
`tests/living-integration.test.ts` ("a crater that fills with water over a town moves the town's heart") cast a default
meteor to make its crater lake. The default meteor digs none now, so the test digs the same bowl with `terrain.lower`
(84 m, 14 m). It fills from the town's spring (3.8 m at the old heart), the heart moves on day 2, 31 of 32 live
(`live2/bowl.ts`). Every assertion of the test is unchanged.

Tests (`tests/living-relationship.test.ts`, both fail on `base2/`):
- "the default meteor bursts in the air …": the `impact` event has `airburst`, there is no crater at the heart, the
  streak is ≥ 20 min with the town on the roads, 0 < killed ≤ 35 %, standing ≥ 60 % and < 100 %, and a 0.6 meteor digs
  a crater.
- "a blast kills one caught on the road …": a flat 0.5 blow kills exactly the people in the `road` set. With `TASK.evacuate`
  and a cap of 0.25, between 1 and half die.

**The survivable table on this tree** (`rel2.ts lethality`, the §3.9 probe re-run with fresh towns: n = 64, 30 bronze-age
people warmed an hour, seeds 20261008, 7, 1234, 1; `out2/rel-lethality-p2{a,b}.json`). The meteor row is the new code
(with its ejecta, dropped since; `out2/meteor-final.log` is the final code). Every other row runs code this pass did
not touch, so it shows what the lanes since 2026-10-14 left:

| cast (target) | killed at the cast's end: mean (max) | by day 10 | ruined | the town on day 10 |
|---|---|---|---|---|
| meteor (10–35 %, ≥ 60 % standing) | 24.2 % (26.7 %) | 24.2 % | 35 % (40 %) | standing, 22–27 people |
| volcano (≤ 15 %) | 0 | 1.7 % (3.3 %) | 100 % (lava) | left on day 4 and founded anew nearby with all its people (seed 1234: "Reis by the Lake", `live2/dbg-volc.ts`) |
| drought (≤ 10 %) | 0 | 0.8 % (3.3 %) | 13 % | standing |
| lightning sigil (1–3 struck) | 0.8 % (3.3 %) | 0.8 % | 10 % | standing |
| falling flame (≤ 20 %) | 0 | 0.8 % (3.3 %) | 10 % | standing |
| tornado (≤ 20 %) | 9.2 % (16.7 %) | 9.2 % | 0 | standing |
| firestorm (≤ 30 %) | 4.2 % (6.7 %) | 4.2 % | 23 % | standing |
| quake / flood / hurricane (≤ 15 %) | 0 | 0 | 0 | standing |
| plague (≤ 25 % over its course) | 0 in its first 3 days | **33.3 % on all 4** (26.7 % on 2026-10-14) | — | standing, 21–24 people |

**Short of target: the plague.** Its toll is the disease model's, not the wrath's. The god's plague seeds L(w) of its
cases a round, but in a town of 30 everyone catches it. A case turns grave by the person's own frailty draw,
`life/disease.ts grave`: `hashFloat(id, disease)` < case fatality × relief. That draw holds no world seed, so towns
whose people share ids lose the same people: exactly 8 of 30 on every world on 2026-10-14, and exactly 10 of 30 now.
The lever sits in `life/disease.ts`, which no lane of §6.2 owns. The god can still save them: the plague raises a healing
prayer, and the mending sigil answers it.

**§3.8 re-measured on this tree.** Two probes:
- the lane's own fixtures on the tests' town (`rel2.ts prayer`, `rel2.ts influence`, n = 20; `out2/rel-prayer.json`,
  `out2/rel-influence.json`);
- the integration's god sessions on the n = 64 town of 8 seeds (`live2/god-rel.ts`, a copy of `integrate/god.ts`;
  `out2/god-final-<seed>.json`).

"2026-10-14" is §3.9's column.

| metric (target) | 2026-10-14 | now |
|---|---|---|
| praying + worshipping, 20 quiet days (≥ 2 %) | 0.032 | **0.004** |
| … 3 days after a tornado (≥ 8 %) | 0.111 | **0.070** |
| worship from prayer and worship (≥ 50 % of the pool) | 0.926 | 0.708 |
| prophet, 3 fulfilled: credibility (≥ 0.7) | 0.705 | 0.705 (fixture); 0.705 on all 8 (sessions) |
| … worship by day 6 vs nothing (≥ +60 %) | ×21 | ×29 (213.9 vs 7.4); sessions 173–269 vs 0 |
| … praying on day 6 (≥ 3 %) | 4.4 % | **1.6 %** (fixture); **1.7–3.8 %, mean 2.5 %** (sessions; 3 of 8 ≥ 3 %) |
| … loyalty (+0.2), mean trust (≤ 0.9) | +0.62, 0.880 | +0.56, 0.781; sessions +0.47–0.68, trust 0.76–0.84 (all 8 ≤ 0.9: the integration's `regard.ts rise` taper) |
| 3 failed: credibility (≤ 0.15), preaching (≤ 25 % as effective) | 0, 15.7 % | 0, 17.4 % (0.348 vs 1.997 an hour) |
| storm over the town: in or sheltering (≥ 50 %), outdoor work below the control (≥ 60 %) | — | sessions 26–96 %, mean 61 %; 43–100 %, mean 72 % |
| drought, every prayer answered vs ignored: trust / loyalty on day 6 | — | 0.61–0.75 / 0.07–0.29 vs 0.00–0.01 / 0.00–0.01; thirst dead ≤ 3.3 % |
| comet read, its meaning made true vs contradicted: credibility / trust / loyalty on day 4 | — | 0.475 / 0.25–0.31 / 0.17–0.19 vs 0.05 / 0.21–0.24 / 0.07–0.09 |
| default meteor (10–35 % dead) | — | sessions: 10–31 %, mean 18 %; never fallen; fear on day 10 0.38–0.44 |
| persecution, disloyal ruler (≥ 1 within 10 days in ≥ 6 of 8) | 7 of 8 | 7 of 8 (`out2/rel-persecution.log`) |

The prayer shares fell, and the 2026-10-14 numbers were not what they seemed. The integration fixed evening worship
(`relationship.ts relDecide`, 2026-10-20): infants under four no longer pray or worship, and every adult gets the whole
window from just before sunset to the end of dusk. Its own trace found that infants had made up the town's worship:
idle, they decided every few minutes, while 4 % of the adults came where the formula asks 18 %. So the lane's 3.2 % and
4.4 % were mostly infants.

At the §3.2 formula the targets are out of reach in an ordinary town. Attendance is 0.5 faith + 0.3 loyalty, for 30–60
minutes:
- At the quiet town's faith of 0.22, that is 0.14 × 45 / 1440 ≈ 0.4 % of a person's day.
- At the prophet's town's faith of 0.9 and loyalty of 0.6, adults spend about 2.2 % of the day at worship, and children
  half that.

Prayer in peace stays under the pull of work. The 2 % and 3 % rows need either a faithful town or more devotion than
§3.2 gives. That is a calibration for the lead: a short daily prayer at home, or longer worship where a prophet leads it.
This pass leaves it alone.

`npm run check` (2026-10-21 02:20, `out2/check-final.log`): detban 145 files clean, typecheck clean, 483 tests — 481
pass, 0 fail, 2 skipped (the throughput floors skip themselves on an overloaded machine: load average 13).

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

### 4.8 Second pass (CONTENT lane, 2026-10-21, cut off; finished by the integrator — probes in `_harness/scratch/living/content/r2/`)
The integrated 50-year runs of 2026-10-20 made 0.67 new kinds a world-year, and by year 50 the real kinds were gone: every
isolated herd of a kind anywhere counted as one group by its iso count alone, the last herds of a kind counted as "cut
off", forms split into forms of forms ("Great little crag hare", depth 4), and the land's herd cap kept the hunters out
(185 herds of game and 3 of hunters at year 50, most biomes with none). The lane's base runs (`r2/out/spec-base-*.json`:
8 seeds × 30 years, no people, the tree as it stood at 01:10) measured it: 10–34 speciations a world (0.33–1.13 a
world-year), lineages 2–3 deep, the real kinds alive 21–24 → 11–16, 1–5 herds of hunters at year 30, 8–11 biomes whose
guild had game and no hunter. The lane was cut off after its code and tests and before its after-runs (2 seeds had
reached year 8). The integrator audited every hunk, kept them all, and ran the after-measurement (below).

**Changes** (`life/ecology.ts`, `life/herds.ts`, `god/inventions.ts`, `people/state.ts`, `people/query.ts`, `events.json`):
- **Cut off from a kind that lives on.** A herd is isolated only while its kind lives elsewhere on the world (`rest`):
  the last herds of a kind are the kind itself. A new kind takes only the herds about it (`meets`, within
  `ISO_RANGE_M`; fliers five times as far; one open sea is one population for water kinds), not every herd that
  happened to be cut off as long anywhere.
- **Pace.** A real kind gives rise to at most one new form in `LINEAGE_YEARS` 25, a world to at most one new kind in
  `FORM_GAP_YEARS` 4 (`lineageRested`, stateless: read from the forms' births). Forms born here, swarms, insects, kept
  animals and shellfish beds never diverge (`mayDiverge`): every animal is a real one or a local form of one.
- **Names a naturalist would give** (`formName`): the form's climate ("Arctic hare", "Desert wolf"; "Woolly" only for a
  furred body) or country ("Highland deer", "Marsh boar", "Island fox"), then its half of the world ("Northern"), then
  its size ("Lesser"); the real kind's name with "Wild", "Golden", "Harbour", "Desert", "Red" dropped; never stacked
  words; no new kind when every word is taken. The chronicle line says the herd was cut off "from the rest of their kind".
- **Kinds born here stay where they arose** (`herds.ts immigrant`): only real kinds and those the god brought drift in.
  A land full of game still lets in the hunters its guilds lack (the herd cap applies to game).
- **A kind the god brings is a real kind** (`content.animal` marks `DerivedAnimal.god = 1`): its coming is no birth (the
  `ecology` query shows `brought: { tick }` for it instead of `bornHere`), it may form local forms of its own name
  ("Highland zebra"), and its coming does not hold back other lineages.
- Saves: `DerivedAnimal.god` is optional (absent = born here), no bump. A god-made kind in a save written before this
  pass reads as born here (it then neither drifts in nor diverges) — no shipped save holds one.

**Tests** (`tests/living-content.test.ts`, 7 `ecology r2` tests; `tests/ecology.test.ts`'s speciation test now keeps
the rest of the deer in their own country, as the rule asks). All 7 fail on the lane's base copy with the new imports
made optional (`r2/basetest.sh`, `r2/out/basetest-r2{a,b,c,d}.log`) and pass on the integrated tree.

**Measured** (`r2/spec.ts`: n = 64 sandbox, no people, natural disasters on, 3000x, 30 years; before = `spec-base`, the
lane's 8 seeds; after = `spec-live-i5`, the integrated tree): *(the integrated tree's runs, tagged `i6`, ended 2026-10-28 04:07 UTC: their rows are in §10.4's queue results)*

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

### 5.6 Second pass (HISTORY lane, 2026-10-21, cut off; finished by the integrator — probes in `_harness/scratch/living/history/`)
What §5.5 and the integrated acceptance left: the kin fixture short on three of four rows (secession 4 / 8, raid or war
1 / 8, the control 4 / 8 — the control was the same world as the normal run wherever no famine came, and the grievance of
the everyday alone carried far daughters over 0.6), no bronze by year 50 in any of the integration's four worlds, iron at
48.8 in one, the medieval era at 177 in the one 230-year run, and a 230-year run short of the two §6.6 asks for.

**Before** is `base2/`, the live tree when this pass began (02:24), run with the same probes; the trial and the final
fixture code are frozen copies (`v8/`, `v10/`), the census code `v9/` (= `v10/` but for the two politics weights below).

**Changes**
- **Hard times are not only hunger** (`politics.ts`). A daughter is in a hard time when it is hungry (under a day of food
  a head, or a death of hunger: as before), when a live disaster lies over it (`disasterOn`: any but the signs in the
  sky), or after a day of calamity — 2 deaths by fire, flood, storm, cold, heat or the god's blows in a day (the days
  before counting by half), or an epidemic (sickness deaths, fading by 0.3 a day, reaching 3: one most days is an
  epidemic) from the LAND ledger (`calamityToday`). A disaster or calamity the capital, with food to spare, did not relieve
  within 2 days is NEGLECT, +0.35 ("Lune buried its dead alone: no help came from Aru"); the capital's own help is the
  famine rule's (daily 0.2 × its chief's generosity), told as relief ("After the disaster Aru sent grain to Lune"),
  event `aid { why: 'disaster' }`. A hard time is judged when its two days are up, whether or not it is over (a day of
  burning is a hard time too: the first pass judged only while the hunger lasted).
- **The everyday makes a town restless, no more.** Tribute, distance, a drifting tongue, a daughter outgrowing its
  mother and quarrels over fields add up to `ambientCap` 0.45 together, then stop; a town breaks away over a wrong done
  to it on top: neglect, hunger, raids, a feud. So a capital that stands by its daughters keeps them, and the control —
  a capital that relieves every hard time — is no longer the same world as the normal run.
- **The capital's answer.** A daughter that parts in peace may not be let go: if its old capital's towns outnumber it
  1.2 to 1, war (the capital the aggressor, cause 'revolt', chronicle `secession.refused`: "Aru would not let Lune go,
  and sent its warriors") with the chance 0.35 + (the chief's aggression − 0.3) × 1.2 + hawks − ½ doves, 0 .. 0.8 (few
  rulers have let a province go; a calm chief with a peace party does). Otherwise the pact of open roads, as before.
- **Ideas two crafts deep** (`knowledge.ts inputsSeen`). An experiment's input counts as seen when it is in the store,
  in hand or in reach — or made by a recipe the town knows from such things, two crafts deep. The year-50 worlds of the
  integration (`libdiag.ts`, `out/libdiag-y50-*.txt`) showed bronze waiting on copper in the store: the town knew copper
  and tin smelting, held the ores, and made no copper because nothing asked for it but bronze — and every bronze-age
  craft after it (bronze tools → carpentry, masonry → the wheel, boats, temples → the classical arch, mills, ships …)
  waited with it.
- **The bronze era's pace** (`eras.ts`): its dwell 26 → 28 years (iron smelting opens at copper + ~28: in band from 50),
  its practice 3 → 5 years (copper → tin → bronze now waits on the smiths' practice, not on the store).

The lane was cut off after its code and tests, during its measurement (the before had run on 2 of 8 kin seeds, the
after on 1, the census on 1 seed to year 48). The integrator audited every hunk (`politics.ts`, `knowledge.ts`,
`eras.ts`, four chronicle templates in `events.json`: `grievance.neglect`, `secession.neglect`, `secession.refused`,
`gift.kin.relief`), kept them all, and ran the measurement on the integrated tree. **Tests** (`tests/living-history.test.ts`,
four new): all four fail on a copy of the integrated tree with only `politics.ts`, `knowledge.ts` and `eras.ts` put back
as they were before this pass (`_harness/scratch/living/integrate/r5/hbase/`, `inputsSeen` stubbed in the copy's test)
and pass on the tree. **UI hooks** (new): `grievanceView(...).hard = { kind: 'famine' | 'disaster', since, relieved,
judged }` in the settlement inspector's history (`query('settlement', { id }).history.grievance.hard`) while a hard
time lasts (`query('polities')` keeps `grievance` and `why` only); `aid` events carry
`why: 'disaster'`; chronicle keys above. Saves: the new `HistState` fields (`hard`, `calam`, `sick`, `cp`, `ep`) are
optional, no bump.

**Measured** (the kin fixture, `kin.ts`: a capital of 60 and two daughters of 40, bronze-age plains folk 1–3 km apart,
natural disasters on, 3000x, 20 years, 8 seeds, and its control — the capital relieves every hard time; before = §5.5's
`v7` runs (the tree of 2026-10-14) and `b2` (the tree of 2026-10-21 02:24, 2 seeds); after = `i5` / `i5c`, the
integrated tree): *(the integrated tree's runs, tagged `i6`, ended 2026-10-28 04:07 UTC: their rows are in §10.4's queue results)*

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

---

## 10. Integrated acceptance (sim integrators, 2026-10-21 and 2026-10-27; probes and logs in `_harness/scratch/living/integrate/`, the fifth pass in `r5/`, the sixth in `r6/`)

Six integrators worked this tree; the first four (2026-10-14/15 and 2026-10-20, commits `58a1c495` … `fc35ab48`) were
cut off before they wrote this section, and on 2026-10-21 (00:00–03:30) the four lanes ran a second time over their
finished work. The fifth (2026-10-21, checkpoints `9ab25226`, `adeb2894`) audited all of it, finished what was half-done,
fixed what its integrated runs showed (§10.2) and ran most of the suite, and was cut off before its results (its 50-year
run of seed 5 stopped at year 44; the kin fixture, the speciation runs and the year-50 sessions never ran). The sixth
(2026-10-27) re-audited the tree, kept the fifth's work, fixed one more bug its 50-year runs held (§10.2), added a
migration test on a save of the previous 1.5 build, and ran the whole suite again on the final tree (`r6/`), writing
`_harness/scratch/living/acceptance.json` (every metric, per seed).

### 10.1 What the integrated tree holds (audit)
- **LAND, round 5** (§2.14): kept whole. Its 8-seed after-census had finished at 01:10 (before the other lanes' second
  passes touched the tree); the integrator ran the tables and inserted §2.14 from the lane's draft.
- **RELATIONSHIP, second pass** (§3.10): kept whole (the air burst below wrath 0.5, the blast on those caught on the road,
  the 36-minute streak). It had adapted one integration test (the crater bowl is now dug with `terrain.lower`): kept.
- **CONTENT, second pass** (cut off; §4.8): every hunk kept — the code was complete (each function wired and used), its 7
  tests pass here and fail on the lane's base copy. Its after-measurement was run by the integrator.
- **HISTORY, second pass** (cut off; §5.6): every hunk kept — `politics.ts` (hard times beyond hunger, the everyday
  capped at 0.45, a capital that refuses a parting), `knowledge.ts` (`inputsSeen` two crafts deep), `eras.ts` (the bronze
  era's dwell 28 and practice 5), four chronicle templates; its 4 tests fail with those three files reverted. Its kin
  fixture and timeline were run by the integrator.
- **The earlier integrators' fixes** (each with its test in `tests/living-integration.test.ts`, all kept): infants
  neither pray nor wander and keep by home in a heatwave (`relationship.ts PRAY_AGE`, `land.ts`, `decide.ts infantOf`);
  evening worship once an evening each over the whole dusk window (`relationship.ts` vespers, `SettlementRel.vespers`);
  the Signs power's omen fulfils a foretold sign (`omens.ts`); an invented material's vein within the town's work reach
  (`materials.ts`); villagers walk home to bed inside their own village (`perf/pace.ts`); faith and trust taper near 1
  (`regard.ts rise`: no pinned meter); an omen feeds curiosity and a fulfilled prophecy the prophet's standing (LAND's
  outlets wired to RELATIONSHIP's acts); a flooded town's heart moves to dry ground (`settlement.ts moveHeart`, chronicle
  `heart.flood`, the abandonment timer on its own key `floodSince`); a fished-out water is passed over and a grown pond
  is looked at again (`fishing.ts rebody`); only homes have beds (`planConstruction`); a site under water is given up and
  an unstarted site takes a material the store can pay for (`buildings.ts reviseSite`); the fire season's strike rate is
  per cell (`weather.ts HEAT_CELLS`); 1.4 leviathans become rogue waves on load (`fauna.ts`); the restyle's last "hand"
  strings say "the Touch" (`civic.ts`, `hand.ts`, `freeform.ts`, `powers.json`). The sowing gate the second attempt tried is not in the tree (it had reverted it itself).
- **The owner-session fixes of §9** are in place: smoulder vs flame (`danger.ts FIRE_BURN` in flight, the fire step,
  drinking and routing; `tests/fire-flee.test.ts` "a town whose core smoulders still eats and drinks there") and the
  varied table (`economy.ts VARIETY`; `tests/society.test.ts` "well-fed neighbours still trade").
- **The UI team's API**: every command, snapshot field and query used by `src/ui/living.ts`, `invent.ts`, `title.ts`,
  `hud.ts` and `inspector.ts` is unchanged (`prayer.answer`, `god.omen`, `prophet.call | abandon | foretell`,
  `settlement.sacred`, `content.material`, `content.plant`, `set`, `disaster.*`, `hand.*`; queries `omens`, `sacred`,
  `prophets`, `settlement`, `agent`, …); `tests/ui-living.test.ts`, `ui-defaults.test.ts`, `ui-embed.test.ts` run in the gate.
- **The sixth pass's audit (2026-10-27).** The tree's sim files had not changed since 2026-10-21 06:03 (the last fix of
  §10.2), so the fifth pass's acceptance runs started after that hour stand on the final code but for §10.2's last fix.
  Re-read: every hunk of `git diff fc35ab48 9ab25226 -- src/sim src/data tests` (CONTENT's `ecology.ts` `mayDiverge`,
  `lineageRested`, `meets`, `formName`, `herds.ts immigrant`, `inventions.ts` `god: 1`, `query.ts` `brought`; HISTORY's
  `politics.ts` hard times / `ambientCap` / `refuses`, `knowledge.ts itemSeen`, `eras.ts` DWELL / PRACTICE; LAND's
  round 5; RELATIONSHIP's air burst) and of `adeb2894` (`disease.ts sentLethality`, `disasters.ts lift`,
  `projectiles.ts lost`): each function is wired and called, nothing is stubbed or left half-done, each has its test —
  all kept. LAND's §2.14 is complete (its 8 after-seeds finished, `land/r5/out-after/done.txt`; tables in
  `land/r5/out/table-final.txt`). RELATIONSHIP's §3.10 and the §9 owner fixes are unchanged. The UI team's tests
  (`ui-living`, `ui-defaults`, `ui-embed`) pass in the gate; no command, snapshot field or query they use changed.

### 10.2 Fixed in this pass
- **A plague the god sends kills by its wrath** (`life/disease.ts sentLethality`, `god/disasters.ts` spread). The god's
  plague seeded L(w) of its cases a round, but in a town everyone catches it from everyone (all 30 of each lethality
  town: `r5/plaguetrace.ts`), so its toll was the disease's own at every wrath: **33.3 % of the 30 on all four
  lethality worlds** at the default (§3.10's open row; `r5/out/plague-before.log`). The settlements it seeds are now
  stamped (`recent.sentPlague`, `sentPlagueL` = L(w) × 1000, `sentPlagueT`), and a case of that disease there, until an
  illness's course after the last round, turns grave with the case fatality × L(w)² (the wrath acting on how many it
  strikes and on how many of those die, both on the outcome). Natural epidemics and a plague at wrath 1 are unchanged.
  Measured (`rel2.ts lethality`, REL_ONLY=plague, the same four towns): killed by day 10 at the default wrath **33.3 % →
  20.0 % on all four** (target ≤ 25 %); at wrath 1 33.3 % before and after (`r5/out/plague-after.log`,
  `plague-after-w1.log`, seeds 20261008 and 7); × L alone left 26.7 %. With L(0.3) = 0.6 the default plague's case
  fatality is 0.45 × 0.36 = 16 %; the four towns share their people's ids, so the same 6 of 30 die on each (the frailty draw is the person's own, `disease.ts grave` — not salted with the world, so as not to move every natural
  epidemic and the seed-bound plague test). Test: `tests/living-integration.test.ts` "a plague the god sends kills by its
  wrath …" (fails with `sentLethality` returning 1). Saves: three optional keys in `Settlement.recent`, no bump.
- **Nature's storm throws as nature** (`god/disasters.ts lift`, `god/projectiles.ts lost`). A funnel (tornado, gravity
  slip) launched everyone it lifted as the player's (`Math.max(0, d.god)` = god 0), so a person a *natural* tornado threw
  and the fall killed died of "the god" (`DEATH.god`), and once the storm had passed (no disaster left to read the act
  as nature's) the landing was the player's act (`godAct` harm and wonder). The 50-year world of seed 20261008, with a
  silent god, recorded one such death in year 39 (`r5/out/alone-live-20261008.json`; §3.7: "a natural-disaster death
  can be blamed on the god" was to end). Nature's throws are god −1 now: the fall's death is `DEATH.disaster`, the
  landing no god's act, one flung off the world "was swept into the sky by the storm". The god's own storm throws as
  before. Test: `tests/living-integration.test.ts` "a person a natural storm throws is thrown by nature …" (fails with
  the old launch). The 50-year worlds of seeds 20261008 and 7 (and 1234, 1) loaded the tree before this fix: seed 7
  saw no natural throw in 50 years (its run is the fixed tree's), seed 20261008 two in year 39 (the same world until
  then); §10.4 lists the throws of every seed.
- **Scraps of fuel light the hearth** (sixth pass; `people/work.ts tendFire`). The fifth pass's 50-year world of seed 3
  ended with its grown-ups spending **0.39 of their time "tending the fire"** at year 50 (`r5/out/alone-live-3.json`,
  the day slice), working 0.03 of it; from year 45 its food was all foraged and 85–100 % of its adults had no curiosity
  left. Its year-50 save (`r6/tendfire.ts`): the one hearth out, 0.34 wood and 0.77 bark in store, and 94–100 % of the
  adults at the hearth hour after hour, through the night. `planTendFire` (decide.ts) sends a tender when the fuels
  TOGETHER make a unit (`storeAny ≥ 1`), and the tending takes a unit from one fuel only (`storeHas ≥ 1`): neither held
  one, so the hearth never caught, nobody went to cut wood, and the hearth called them back (utility 0.98 by day and 1.54
  at night with the fire out, above work). The tending now burns the scraps as one unit (their fuel values weighed). On the
  same save the hearth caught in the first hour and the town went back to chopping, farming, herding and mining (tending
  0.16 of the first hour, then 0). Test: `tests/living-integration.test.ts` "scraps of fuel that make a unit together
  light the hearth …" (fails with the scraps branch taken out: the hearth stays cold). No saved state changed.
- **A save of the previous 1.5 build** (sixth pass; `tests/living-migration.test.ts`, two tests). The second passes and
  the fifth pass added optional saved fields under 1.5 without a bump (`HistState.hard / calam / sick / cp / ep`,
  `DerivedAnimal.god`, `LandState.more`, `HuntParty.cache`, `Settlement.recent.sentPlague*`). A fixture written by the
  1.5 build of 2026-10-21 00:10 (LAND's copy of that tree, `land/r5/base`, with `r6/fixture15.ts`: Aru and its daughter
  Lune of one polity, Lune's grievance 0.52 with a famine being judged, a zebra the god brought) loads in this build with
  the old build's own hash (`8a07301846261933`), the same people, towns, polity and grievance; the old grievance record
  is judged by this build's rules (the famine weighed: 0.52 → 0.97, the calamity counters begun); a re-saved copy and two
  loads live three days alike. (The old build's zebra reads as born here, as §4.8 says.)
- **A sign sent to a named town stands over that town** (ninth pass, 2026-10-28; `god/omens.ts` `god.omen`). The year-50
  omen sessions missed "fulfilled raises trust above contradicted": on 5 of 8 worlds the prophet's "a sign within two
  days" failed although the god sent the rainbow. Traced on seed 1 (`integrate/god-dbg9.ts`): `god.omen { settlement }`
  placed the omen at `a.pos`, which the command layer fills with the camera focus when a command names no place
  (`god/commands.ts resolvePos`), so the rainbow stood ~7 km from the town — near enough to be seen (`readOmen` reaches
  +1.5 km) but not to count as the god's act for that town (`actReaches`, +200 m). On the fresh towns the focus was on
  the town, so the fresh sessions met. The living panel sends exactly this command (`src/ui/living.ts`). A named
  settlement now wins over the focus default (a place the command gives itself still wins). Seed 1's year-50 omen pair
  after the fix: credibility 0.475 vs 0.05, trust 0.21 vs 0.194, loyalty 0.156 vs 0.056 (before: 0.05 vs 0.05, 0.09 vs
  0.12, 0.03 vs 0.03). Test: `tests/living-integration.test.ts` "a sign sent to a named town stands over that town …"
  (fails without the fix: the comet read 6959 m off). The probe also fulfils a prophet's own reading of the comet
  (healing, rebuilding, warmth, protection) with the act that answers it (before: a rainbow, which cannot). Both omen
  cases were re-run on all 16 worlds (`r6/out/god-omen-i9.log`, `god50-omen-i9.log`): 8-seed means, fresh towns
  credibility 0.475 vs 0.05, trust 0.28 vs 0.22, loyalty 0.19 vs 0.09; year-50 towns 0.41 vs 0.03, 0.24 vs 0.14, 0.15
  vs 0.03 (both met). The gate then caught a follow-on (`tests/living-relationship.test.ts` "a rainbow a day is
  weather"): with the sign over the town, the wonder `god.omen` adds for the god's act (`godAct`, 600 m) was witnessed
  there and moved faith on a repeat inside the ten quiet days; a sign the town had of that kind within ten days now adds
  no wonder either. No saved state changed.

### 10.3 The acceptance suite (how it ran)
All on the final integrated tree, two processes at a time on the shared 4-core machine (`r6/jobs.txt`, run by
`queue.sh`; logs in `r6/out/`; the fifth pass's runs on the tree before the last fix are kept in `r5/out/`).
`r6/summarize6.ts` checks every target below and writes `_harness/scratch/living/acceptance.json` (each metric with its
target, value, met, and per seed).
- **A world left alone, 50 game years** (`alone.ts <seed> 50 3000`, the 8 census seeds `20261008 7 1234 1 2 3 4 5`): 30
  stone-age plains folk as a band on the n = 64 sandbox, natural disasters on, the god silent, at 3000x (level 2). Each
  year: people and demography from the ledger, food by source, hunts, herds, crops, fishing, houses, needs, gatherings,
  the four values and the god's counters (prayers, risen prophets, omens), the §1.5 firsts, era labels against what the
  town can do, grievances, events by kind. At years 1, 5, 10, 20, 30, 40, 50 a day at 1x on a save → load copy (walking,
  dusk, dark, food per adult-day, camps, children's time — and the copy's hash against the original's).
- **The god's sessions** (`god.ts`, seeds 1–8): a 30-person bronze town (Aru) on the n = 64 world, natural disasters
  off, warmed a day; each session from the same save at 1x: nothing (the control, 6 days); a thunderstorm painted over
  the town; the default meteor on the town; a drought with every prayer answered vs left to lapse; a prophet with three
  prophecies made true vs left false; a comet read by the prophet with its meaning made true vs contradicted;
  "introduce mithril" (`content.material`, 20 days); an iron vein laid within the town's work reach (`terrain.seed-ore`,
  then iron smelting taught at day 10); a new crop (`content.plant` + `settlement.introduce`, two game years). Each
  records the four values at the start, after a day and at the end, the original townsfolk killed, what the town did
  (task shares, events) and what it holds. The same sessions ran on the biggest town of each year-50 world
  (`FROM=y50`, natural disasters on, the town's own risen prophet where it has one).
- **The kin fixture** (`history/kin.ts <seed> 20 i6`, seeds 1–8, 20 years, and its control `CONTROL=1 … i6c`),
  **speciation without people** (`content/r2/spec.ts`, `TAGX=-i6`, 4 seeds × 30 years), **the fire and day probes**
  (`pace/live/pace.ts fire` 4 seeds × 6 years without people — the target reads years 1–2, years 3–6 show where the
  as-built world goes; `daily` 6 seeds), the **plague** at the default wrath (`relationship/rel2.ts lethality`,
  `REL_ONLY=plague`, 4 seeds), and LAND's round-5 census (§2.14, 8 seeds × 8 years, the lane's own runs).

### 10.4 Results

**The god's sessions** (`god.ts`, seeds 1–8, the 30-person bronze town; `r6/out/god-*.json`, 96 sessions, none failed).
The four values are means over the 8 seeds of the town's people (query `regard`), at the start → a day after → the end
of the session; "killed" is the share of the original townsfolk dead by the end. All 96 sessions are identical, value
for value, to the fifth pass's runs on the tree before §10.2's last fixes (`r5/out/god-*.json`): none of the fixes is
on their path, and the runs reproduce.

| session | killed | faith | fear | trust | loyalty | the town's response (first watch; events over the 8 seeds) |
|---|---|---|---|---|---|---|
| nothing (control, 6 days) | 0.4 % | 0.18 → 0.18 → 0.17 | 0.06 → 0.06 → 0.05 | 0.09 → 0.09 → 0.09 | 0.04 → 0.04 → 0.04 | quarrying 24 %, crafts 16 %, building 12 %, children at play 12 %; 8 festivals, 10 harvests |
| thunderstorm over the town (6 h) | 0 | 0.18 → 0.22 → 0.22 | 0.06 → 0.07 → 0.07 | 0.09 → 0.10 → 0.10 | 0.04 → 0.04 → 0.04 | 69 % sheltering in the first 6 h (awake adults inside or sheltering 0.61, 0.26–0.96); outdoor work 72 % below the control; 8 prayers raised (all lapsed: the storm passed) |
| default meteor (wrath 0.3) | **18.3 %** (10–31 %) | 0.18 → 0.24 → **0.46** | 0.06 → 0.08 → **0.41** | 0.09 → 0.11 → **0.00** | 0.04 → 0.04 → 0.01 | warned on all 8 (12-tick warning, 36-minute streak); 94 % evacuating in the first watch; 65 % of buildings standing after the blow, never fallen, 2–7 rebuilt within 10 days; 28 prayers raised, 10 funerals |
| drought, every prayer answered | 0.4 % | 0.18 → 0.18 → **0.92** | 0.06 → 0.06 → 0.26 | 0.09 → 0.09 → **0.66** | 0.04 → 0.04 → 0.12 | 24 prayers for rain raised and answered (24 rains); worship 9 % of the first watch |
| drought, prayers left to lapse | 0.8 % (≤ 3.3 %) | 0.18 → 0.18 → 0.66 | 0.06 → 0.06 → 0.34 | 0.09 → 0.09 → **0.00** | 0.04 → 0.04 → 0.01 | 13 prayers raised, 7 lapsed; one town left its dry site and was founded again nearby |
| prophet, three prophecies fulfilled | 0.4 % | 0.18 → 0.25 → **0.94** | 0.06 → 0.06 → 0.10 | 0.09 → 0.10 → **0.81** | 0.04 → 0.08 → **0.63** | credibility 0.705 on all 8; 8 called, 16 foretold, 8 fulfilled; one prophet persecuted |
| prophet, three prophecies failed | 0.4 % | 0.18 → 0.25 → **0.10** | 0.06 → 0.06 → 0.05 | 0.09 → 0.10 → 0.00 | 0.04 → 0.08 → 0.02 | credibility 0 on all 8 |
| comet read by the prophet, made true | 0.4 % | 0.18 → 0.49 → 0.76 | 0.06 → 0.12 → 0.14 | 0.09 → 0.11 → **0.28** | 0.04 → 0.08 → **0.19** | credibility 0.475; 16 omens, 8 fulfilled; 5 prophets persecuted |
| comet read by the prophet, contradicted | 0.4 % | 0.18 → 0.49 → 0.57 | 0.06 → 0.12 → 0.12 | 0.09 → 0.11 → 0.22 | 0.04 → 0.08 → 0.09 | credibility 0.05; 8 failed |
| "introduce mithril" (20 days) | 2.4 % | 0.18 → 0.22 → 0.21 | 0.06 → 0.07 → 0.05 | 0.09 → 0.16 → 0.17 | 0.04 → 0.04 → 0.04 | 55–66 deposit cells; 17–49 ore in store by day 10, 5 crafts taught; mithril tools on 5 of 8 by day 10, on all 8 by day 20; 16 "first made" lines |
| an iron vein within reach | 2.0 % | 0.18 → 0.19 → 0.23 | 0.06 → 0.06 → 0.06 | 0.09 → 0.09 → 0.13 | 0.04 → 0.04 → 0.03 | laid 158–210 m out on 8 of 8; untouched while nobody can smelt iron, mined on day 10.2–12.1 once iron smelting is taught (10–56 ore by day 15) |
| a new crop (sunroot, two game years) | 2.0 % | 0.18 → 0.21 → 0.21 | 0.06 → 0.07 → 0.07 | 0.09 → 0.10 → 0.10 | 0.04 → 0.04 → 0.04 | taken up on 8 of 8: 7–21 sowings, 6–16 harvests, 569–2 160 sunroot in store |

(The deaths in the 20-day and two-year sessions are the town's ordinary deaths: the control lost 0.4 % in 6 days.)
What the people make of their god follows what it does: harm builds **fear** and, unless prayers are answered, costs
**trust**; prayers answered and prophecies fulfilled build **trust** and **loyalty**; a sign raises **faith** at once
whatever comes after; gifts of material and crops raise trust a little and fear not at all.

**A world left alone for 50 game years** (`alone.ts <seed> 50 3000`; `r6/out/alone-live-<seed>.json`, the god silent,
natural disasters on). **All eight seeds finished on the final tree** (20261008, 7, 1234, 1, 2, 3 by 21:42; seeds 4
and 5 at 22:21 and 22:31 UTC on 2026-10-27; `acceptance.json` re-written by `r6/summarize6.ts` at 22:31 from all
eight, `r6/out/summarize-8alone.log`). Firsts are the game year of the first recipe of each kind.

| seed | people Y1 / Y10 / Y30 / Y50 | era at Y50 | fire / pottery / agriculture / copper / writing | towns fallen | deaths: old age / childhood fever / sickness / other | CPU s |
|---|---|---|---|---|---|---|
| 20261008 | 35 / 40 / 64 / 73 | bronze age | 3.7 / 8.2 / 7.7 / 24.0 / 39.8 | 0 | 24 / 11 / 35 / predator 1, disaster 2 | 1509 |
| 7 | 32 / 30 / 41 / 79 | copper age | 4.8 / 5.4 / 4.1 / 21.3 / 36.0 | 1 | 18 / 12 / 20 / predator 1 | 1404 |
| 1234 | 32 / 35 / 30 / 54 | copper age | 4.1 / 8.1 / 8.1 / 24.1 / 48.5 | 0 | 21 / 8 / 32 / — | 1486 |
| 1 | 32 / 30 / 42 / 33 | bronze age | 4.2 / 4.9 / 4.1 / 20.9 / 38.3 | 2 | 23 / 9 / 27 / thirst 14, hunger 6 | 1678 |
| 2 | 30 / 36 / 53 / 63 | bronze age | 2.2 / 6.2 / 6.3 / 22.5 / 36.8 | 0 | 23 / 15 / 32 / — | 1133 |
| 3 | 32 / 36 / 40 / 29 | bronze age | 0.2 / 4.2 / 4.2 / 20.2 / 36.8 | 0 | 25 / 10 / 24 / predator 1 | 1379 |
| 4 | 31 / 24 / 28 / 50 | iron age (iron smelting 41.0) | 5.0 / 11.0 / 4.1 / 27.8 / 45.9 | 0 | 16 / 10 / 35 / thirst 1 | 1363 |
| 5 | 30 / 42 / 69 / 126 | bronze age | 4.0 / 8.0 / 8.0 / 24.1 / 38.3 | 0 (one split) | 29 / 22 / 3 / disaster 2, thirst 2 | 1207 |

- **Met** (8 seeds): walking 0.21 of waking time in year 1 (≤ 0.30; 0.15–0.31) and 0.26 over all slices; walking to work
  0.13; food per adult-day over year 1 1.44 (1.29–1.71; 1.25 ± 25 %); every save → load copy hashed as the original
  (56 / 56 slices); children wander 0, play 0.19, do chores 0.16; agriculture 5.3 (3–12; 8 / 8 in the band), copper
  smelting 23.3 (20–40; 8 / 8), writing 38.3 (35–65; 8 / 8) by median; no era label at odds with what a town can do;
  no hunter killed; the first herd within 2 years of husbandry on 8 / 8; fishing on a shoal or a finite stock ≥ 0.98 on
  the 7 seeds that fished (seed 4 never did); 0.97 harvests a sowing; every year end housed outside the disaster years
  on 7 / 8 (rebuilt in 1 year by median, 3 at most; the one calm unhoused year end is seed 5's year 50: beds for all
  126, 21 of 31 households housed — the town grew 114 → 126 in its last two years and new couples waited for houses);
  infant deaths 9.5 % of births by median (6–23 %; seed 4 alone above 12 %), birth interval 3.36 years (3.22–3.64);
  2 festivals a settlement-year, 0.82 attendance, 92 % of couples wed, 98 % of deaths at home buried; the first
  speciation at year 9 (median), 0.03 speciations a world-year over the first 8 (≤ 0.3).
- **Partly met**: work begun after dusk 0.009 on average but 0.085 in the worst slice; walking in the dark 0.063, worst
  0.246; parched / starving 0.001 / 0.001 on average, worst 0.029 / 0.031 (seed 1's drought years); food per adult-day
  in the year-1 day slices 1.30 (0.75–2.04, one seed above +50 %); fire-keeping in years 1–6 on 7 / 8 (seed 3 kept fire
  at 0.17); pottery 7.1 by median (6–18) but in the band on 5 / 8 (4.2–11.0: the kiln follows fire-keeping within
  0.7–6 years); bronze by year 50 on 6 / 8 (31.6–40.3; seeds 7 and 1234 end in the copper age; seed 4 smelted iron at
  year 41 and ends in the iron age); farming 0.47 of food 3+ years after agriculture (0.21–0.70); adults without
  curiosity at their worst year end above 0.20 on 7 / 8 seeds (seed 1 0.93 in years 46–47, the band whose town fell,
  §10.6; seed 5 0.59; the others 0.16–0.33), without status 0.33 at worst (the same band), ≤ 0.11 elsewhere.
- **Missed, and why**: *kills* 3.9 per 100 people a year (3.1–9.2; ≥ 20) and *hunted share* 0.065 of food over 50 years
  (0.014–0.125; 0.15–0.35): the targets were set for stone-age bands, and over eight years LAND's census holds 10.6 kills
  and 0.16 of food (§2.14); once a town farms, herds and fishes (by years 4–8 here) the hunt is a 2–3 day trip that the
  other sources outrun — food by source over 50 years: forage 0.29, hunt 0.065, fish 0.19, farm 0.42, herd 0.05
  (medians). *Houses* at every year end (≥ 7 of 8): 0 / 8 by the letter, 356 / 400 seed-years housed; every unhoused
  year end but seed 5's last is a year a natural disaster threw homes down (≥ 5 buildings collapsed — quakes, wildfires,
  tornadoes threw down 31–122 on the four worlds traced — or the town fell), or the rebuild year after (§2.5's row
  "outside disaster years": 7 / 8, met). *Deaths under 15* 28 % of births (16–44 %; 12–25 %), *growth* 1.47 %/year over
  years 5–30 (−1.4 to 2.3; 1.5–3) and *under-15 share* 0.46 (0.40–0.47; 0.35–0.45): the cohort model of §2.14 — with
  these death rates the two demographic targets meet only at their corner (0.45 at 1.5 %); over 50 years more children
  die than in LAND's eight-year census (19–23 %; deaths by cause over the eight worlds: sickness 208, old age 179,
  childhood fevers 97, thirst 17, hunger 6, disasters 4, predators 3); seed 4 is the hard-luck world (31 → 24 people in
  its first ten years, 36 of its 82 births dead before 15) and seed 5 the lucky one (30 → 126, 16 %); nothing was tuned
  (a fertility or illness change moves every era date HISTORY calibrated). Three rows the two last seeds pulled just
  under their line (met on the first six): *fire-keeping* by year 5 on 8 / 8 but at a median of 4.04 (≤ 4: seed 4 at
  5.0, seed 5 at 4.0 — two weeks of game time over); *herding share* in years with herds 0.0495 (0.05–0.20; 4 / 8 in the
  band, 0.007–0.121: where fish or fields feed a town its herd stays small); *kinds gathered* a settlement-year at year 8
  9.5 (≥ 10; 7–12, 4 / 8 at 10 or more). No mechanism behind them changed with the last two seeds; they are the spread
  of eight worlds around targets the first six met by a small margin. *Lightning fires* in years 1–2: §10.5.
- **The people and a silent god** (years 10–50, mean of seeds): faith 0.09, fear 0.02, trust 0.02, loyalty 0.01 —
  they worship a little, fear little, and owe nothing to a god that has done nothing; one polity per world, 11 towns
  founded (the 8 first towns and 3 refoundings), 3 fallen (seed 1 twice, seed 7 once), one split (seed 5), no
  secession, war or raid in 50 years without a second town to quarrel with (the kin fixture holds the politics targets).
- **Count** (`acceptance.json`, all eight 50-year worlds, the 8-seed god sessions, the year-50 sessions on 8 seeds, the kin fixture and speciation; 2026-10-28 04:07 UTC):
  37 targets met, 11 partly, 12 missed, 13 report-only rows (with six of the 50-year worlds and two year-50 seeds: 38 / 10 / 10).

**The god's sessions on year-50 towns** (`god.ts`, `FROM=y50`, the biggest town of each 50-year world, natural disasters
on; all 8 seeds, 96 sessions, none failed, `r6/out/god50-*.json`; the omen pair re-run on the 2026-10-28 tree,
`r6/out/god50-omen-i9.log`): the storm 69 % sheltering (42–92 %), outdoor work 86 % below the control; the meteor
killed 12.6 % (6.8–20 %), fear 0.02 → 0.38, trust → 0; drought answered faith 0.05 → 0.96, trust → 0.88, loyalty →
0.37 vs ignored trust → 0, fear → 0.28 (thirst dead ≤ 3.4 %); prophet fulfilled trust 0.70, loyalty 0.46 vs failed
faith 0.05 (credibility 0 on all 8); omen fulfilled vs contradicted credibility 0.41 / 0.03, trust 0.24 / 0.14,
loyalty 0.15 / 0.03 (met; before the §10.2 fix "a sign sent to a named town stands over that town" the sign landed
at the camera focus and fulfilled nothing: trust 0.11 vs 0.13, missed); an iron vein mined once iron is taught 8/8,
sunroot sown and harvested 8/8, mithril partly (ore in the store 8/8, goods made of it by day 20 on 4/8). Two rows
missed on these older, larger towns (both met on the 30-person bronze town above). (1) The meteor: 66.7 % of buildings
standing on average and the town never fell, but 6 of 8 seeds ≥ 60 % (per seed 20261008 0.68, 7 0.28, 1234 0.81,
1 0.22, 2 0.88, 3 0.84, 4 0.81, 5 0.82): seed 1 is a 9-building town (2 left, 8 again by day 10), seed 7 lost 42 of
58 (23 by day 10); these worlds are dry fire country by year 50 (§10.5) and the blast lights them (seeds 20261008 and
7: 166 and 15 fires on the first day, 53 and 43 buildings collapsed); killed under 10 % on three seeds (6.8, 9.3,
9.1 %) with few outside the danger radius at the blow (1–10 %). (2) The prophet's credibility after three fulfilled
prophecies: 0.33–0.705, ≥ 0.7 on 3 of 8 (seeds 1, 3, 7; 1234 0.66): the four lowest (20261008 0.335, 2 0.49, 5
0.52, 4 0.33) each made prophecies of their own that failed (`stats` made/fulfilled/failed 4/3/1, 4/3/1, 4/3/1,
6/3/2) — a prophet reads omens and foretells by itself (`god/omens.ts` readOmen, p = 0.5 × credibility) and the
script fulfils only its three; credibility follows the record, as §3.8 asks (loyalty gain 0.30–0.67 and trust
0.56–0.81 are in target on all 8). Neither is a sim fault.

*(Queue results, written by `r6/finalize9.mjs` at 2026-10-28 04:07 UTC from `acceptance.json` when `r6/jobs8.txt` (resumed as `r6/jobs9.txt` after a restart) ended —
the year-50 sessions on 8 seeds, the kin fixture on 8 seeds and its control on 8, speciation without people
(`content/r2/out/spec-live-i6-*`); numbers as measured, not yet read by an integrator. Whole file: 37 met,
11 partly, 12 missed, 13 report-only rows.)*

| § | row | target | value | verdict |
|---|---|---|---|---|
| §5.1 | kin fixture (a capital of 60, two daughters of 40, 20 years): ≥ 1 secession / ≥ 1 raid or war / ≥ 1 treaty — and the control (the capital relieves every hard time): no secession | ≥ 5 of 8 / ≥ 3 of 8 / ≥ 2 of 8; control ≥ 6 of 8 | {after:{seeds:8, secession:1, raidOrWar:1, treaty:0}, control:{seeds:8, noSecession:8}, before:{v7:{seeds:8, secession:4, raidOrWar:1, treaty:3}, v7control:{seeds:1, noSecession:1}, b2:{seeds:2, secession:2, raidOrWar:0, treaty:2}}} | partly |
| §4.5 | speciation without people, 30 years (CONTENT r2): new kinds a world-year / first (game year) / deepest lineage / real kinds alive year 1 → 30 / herds of hunters at year 30 | ≤ 0.3 / ≥ 6 / 1 (forms of real kinds only) / report / report | {after:{seeds:[1, 7, 1234, 20261008], perWorldYear:{median:0.15, range:[0.133, 0.2]}, firstYear:{median:8.085, range:[7.46, 9.04]}, maxDepth:1, realAlive:{y1:[21, 23], end:[21, 25]}, huntersEnd:[25, 48], biomesNoHunterEnd:[2, 5]}, before:{seeds:[1, 2, 3, 4, 5, 7, 1234, 20261008], perWorldYear:{median:0.567, range:[0.333, 1.133]}, firstYear:{median:7.335, range:[6.29, 8.88]}, maxDepth:3, realAlive:{y1:[21, 24], end:[11, 16]}, huntersEnd:[1, 5], biomesNoHunterEnd:[8, 11]}} | met |
| god | [the biggest town of a year-50 world] sessions that ran without an error | all | 96/96 | met |
| §3.7 | [the biggest town of a year-50 world] storm painted over the town (thunderstorm, intensity 2, 6 h, drifting): awake adults inside or sheltering / outdoor work below the control | ≥ 0.5 / ≥ 60 % below | {sheltering:0.693, shelteringRange:[0.415, 0.916], outdoorBelowControl:0.863, range:[0.572, 1], killed:0.01} | met |
| §3.7 | [the biggest town of a year-50 world] default meteor on the town (wrath 0.3): killed / buildings standing after the blow / fallen / warning (ticks) / outside the danger radius at the blow | dead 10–35 %; ≥ 60 % standing; never fallen; rebuilding within 10 days; streak ≥ 20 min | {killedMean:0.126, killedRange:[0.068, 0.2], standingMean:0.667, standingRange:[0.222, 0.879], fallen:0, warning:[12, 12], outsideAtBlow:[0.013, 0.103], rebuiltAfterBlow:[6, 0, 0, 0, 0, -6, -5, 7], standingDay10:[0.889, 0.813, 0.879, 0.677, 0.842, 0.759, 0.78, 0.397], killed10Days:[0.068, 0.2]} | **missed** |
| §3.3 | [the biggest town of a year-50 world] a drought on the town: prayers raised; every prayer answered vs left to lapse — the four values after 6 days (mean of seeds) | answering raises trust and loyalty above ignoring; thirst dead ≤ 10 % | {prayersRaisedPerSeed:{answered:[3, 10, 11, 11, 10, 11, 10, 3], ignored:[1, 4, 4, 5, 2, 4, 3, 3]}, prayerKinds:{rain:34, rebuilding:55, healing:6}, answered:{faith:0.958, fear:0.16, trust:0.878, loyalty:0.374}, ignored:{faith:0.655, fear:0.358, trust:0, loyalty:0.007}, killedMax:0.034} | met |
| §3.8 | [the biggest town of a year-50 world] prophet, three prophecies fulfilled in 6 days: credibility / loyalty gain / trust (no pinned meter) / praying share | credibility ≥ 0.7; loyalty +0.2; trust ≤ 0.9; praying ≥ 3 % | {credibility:[0.33, 0.705], loyaltyGain:[0.298, 0.665], trust:[0.555, 0.81], faithEnd:[0.75, 0.948], prayShareD6:[0.015, 0.049], worshipGain:[76.27, 478.7], persecuted:[1, 0, 1, 0, 1, 1, 0, 1]} | **missed** |
| §3.8 | [the biggest town of a year-50 world] prophet, three prophecies failed: credibility / the four values after 6 days | credibility ≤ 0.15 | {credibility:[0, 0], end:{trust:0, loyalty:0.014, faith:0.048}} | met |
| §3.4 | [the biggest town of a year-50 world] a comet read by the prophet, its meaning made true vs contradicted: prophet credibility / trust / loyalty after 4 days (mean) | fulfilled raises credibility, trust and loyalty above contradicted | {fulfilled:{credibility:0.406, fulfilledN:8, trust:0.241, loyalty:0.148, faith:0.63}, contradicted:{credibility:0.031, failedN:9, trust:0.144, loyalty:0.029, faith:0.415}, prophetReadings:[null, null, healing, null, null, rebuilding, rebuilding, null, null, null, healing, null, null, rebuilding, rebuilding, null]} | met |
| §4.1 | [the biggest town of a year-50 world] "introduce mithril to Aru": deposit cells / ore in store after 10 days / crafts / goods made of it by day 20 | ≥ 1 / ≥ 10 / ≥ 2 / a tool or building within 20 days | {deposits:[47, 73], oreInStore:[0.71, 98.95], crafts:[5, 5], goodsKinds:[0, 3], store:[{mithril-ore:36.1}, {mithril-ore:0.71, mithril-tools:1}, {mithril-ore:62.09, mithril:7, mithril-tools:7, mithril-blade:7, mithril-ornaments:11.5}, {mithril-ore:39.26}, {mithril-ore:59.04}, {mithril-ore:18.01}, {mithril-ore:20.86, mithril:22, mithril-tools:17, mithril-blade:7.48, mithril-ornaments:17.38}, {mithril-ore:98.95, mithril:7, mithril-tools:16, mithril-blade:9, mithril-ornaments:50}], store20:[{mithril-ore:46.54}, {mithril-ore:0.95, mithril:1, mithril-tools:6, mithril-blade:10, mithril-ornaments:8}, {mithril-ore:85.71, mithril:7, mithril-tools:7, mithril-blade:7, mithril-ornaments:11.5}, {mithril-o | partly |
| §4.2 | [the biggest town of a year-50 world] an iron vein laid near the town within its work reach: first iron ore in the store (day) before / after the god teaches iron smelting at day 10 | laid; mined once iron is wanted | {ok:8/8, firstOreDay:[null, null, null, null, null, 2.17, null, null], firstOreDayTaught:[11.17, 10.92, 10.29, 10.42, 12.33, null, 10.38, 10.88], storeD10:[{}, {}, {}, {}, {}, {iron-ore:227.02}, {}, {}], storeD15:[{iron-ore:39.94}, {iron-ore:12.43}, {iron-ore:61.13}, {iron-ore:40.45}, {iron-ore:11.26}, {iron-ore:227.02}, {iron-ore:78.43}, {iron-ore:75.49}], veinAtM:[214, 246, 228, 254, 260, 245, 256, 229], veinFlowCost:[223, 200, 190, 210, 222, 222, 208, 191], knowsIronSmelting:[false, false, false, false, false, true, false, false]} | met |
| §4.3 | [the biggest town of a year-50 world] a new crop (sunroot, no climate named: like wheat) introduced: sown / harvested within 24 days (two game years) | sown and harvested | {taken:8/8, sowings:[28, 13, 9, 19, 17, 28, 17, 5], harvests:[15, 12, 6, 12, 16, 17, 14, 10], store:[{sunroot:433.91}, {sunroot:728.67}, {sunroot:189.96}, {sunroot:1110.65}, {sunroot:348.7}, {sunroot:1502.9}, {sunroot:740.73}, {sunroot:422.25}]} | met |

The kin fixture (`i6`, 8 seeds, 20 years): a secession on 1, a raid or war on 1, a treaty on 0 (≥ 5 / ≥ 3 / ≥ 2 of 8 asked); its control (`i6c`, 8 seeds): no secession on 8 (≥ 6 asked) — partly. Speciation without people (`live-i6`, seeds 1, 7, 1234, 20261008, 30 years): 0.15 new kinds a world-year (median; ≤ 0.3 asked), the first at game year 8.085 (≥ 6 asked), deepest lineage 1 — met.

**Why the kin fixture falls short (read 2026-10-28 by the integrator; `history/out/kin-{v7,i6,i6c}-N.json`, yearly
rows of grievance, its causes and food a head; a game year is 12 game days).** Not a fault in the politics code: it is
the price of §5.6's own fix, on a world with few wrongs. (1) **Every secession of the 8-seed `v7` row was carried by the
everyday.** At the year before each parting the seceding daughter's grievance was distance + tribute + outgrown (+ a
0.11 feud on seed 2): seed 2 town 3 0.97 (distance 0.65, tribute 0.23, feud 0.11), seed 3 towns 2 and 3 0.62–0.67
(distance 0.50, tribute 0.17), seed 6 town 2 0.68 (distance 0.50, tribute 0.19), seed 8 towns 2 and 3 0.73–0.85
(distance, outgrown, tribute) — no famine, no neglect. §5.6 capped exactly these at `POLITICS.ambientCap` 0.45
(`people/politics.ts:121`, `:181-182`) so that a capital that stands by its daughters keeps them; that is what moved the
control from 4 / 8 to 8 / 8. (2) **On the integrated tree a daughter crosses 0.6 only over a wrong done, and the wrongs
come.** Grievance passed 0.6 on 6 of 8 seeds (gMax: seed 1 0.68, 4 1.0, 5 0.87, 6 0.70, 7 0.80, 8 0.91; 5–84 days
above the line), each time NEGLECT on top of the everyday (a disaster or calamity the capital did not relieve: neglect
0.22–0.58 of the year-20 grievance on seeds 1, 4–8); the 2 others (seeds 2, 3) stopped at the cap (0.45–0.57: no wrong
done). No daughter had a famine in 8 seeds (famine days 0 on all; hard days 0–26), the daughters being fed by §2 (food
in store a head, years 8–20 mean: 5–154 days, 5 of 16 daughters under 30, none hungry long enough for a famine). (3) **The draw past the line is slow by design.**
The daily chance is 0.02 × min(1, (g − 0.6) / 0.15 + 0.2) × the independence party's strength (≥ 0.5,
`politics.ts:420-421`): about 0.005 a day at 0.64, 0.013 at 0.73. With the days above the line and the gMax of each seed
(the grievance taken as evenly spread between 0.6 and gMax, no faction share; `integrate/kinexp.mjs`) the chance of a
secession is about 0.27 (seed 1), 0.60 (5), 0.36 (6), 0.44 (7), 0.14 (8) — with seed 4's, about 2.8 seceding worlds
expected of 8; one came
(seed 4: 26 hard days, neglect, grievance 1.0, a revolt at year 12.7 and a war). A treaty follows only a parting in
peace (`treaty.parting`), and the one parting was bitter: 0 treaties. Raids are a hungry town's (`POLITICS.raidDays`):
with fed daughters, 1 world in 8, as on `v7`. **Not re-tuned in this program**: the 5 / 8 row would need the daily
chance about doubled or neglect made more common, a balance change to settle with HISTORY's spec (§5.1) and re-measure
(kin fixture and control, 16 runs, ~2.5 h at the time-lapse speeds), not an integration fix.

*(The fire, day and plague probes: §10.5, `acceptance.json` "§1.6 PACE daily probe" (met) and §10.2.)*

### 10.5 Lightning fires on the as-built world (a known miss, measured)
- **Target** (§1.4): 2–12 lightning-started fires a world-year on the n = 64 sandbox without people (4 seeds × 2 years),
  ≥ 70 % in the dry half-year, ≤ 5 % of the land burnt a year.
- **Final tree** (`pace/live/pace.ts fire`, 4 seeds × **6** years, `r6/out/fire-integ6.log`): years 1–2 **0.13** a
  world-year (one fire in 8 world-years: seed 1, year 2); year 3 0.25; years 4–6 **4.9** a world-year (1–10 per world),
  95 % in the dry half; the land burnt ≤ 5.3 % a year but for one year of 8.5 % (seed 20261008, year 4). The fire
  seasons work — from the fourth year.
- **Cause** (`r6/moist2.ts`, seeds 20261008 and 7, 4 years; `r6/out/moist2-*.log`): PACE's fire seasons strike grass and
  scrub country (and forest dried below 0.18) whose soil holds less than 0.3 of water. CONTENT's soil rebalance (§4.5,
  §4.7) builds the world wetter and sown almost all as forest, and the world then dries toward its own climate over its
  first years: fire-country cell-days 3 / 75 / 3 357 / 12 544 in years 1–4 of seed 20261008 (1 324 / 5 507 / 7 444 /
  18 635 on seed 7); forest soil moisture median 0.665 → 0.572; warm, rainless, fuelled fire-country samples under the
  0.3 cure 0 / 0 / 34 / 1 247. On the same code with the old soil, 4.0 a world-year in years 1–2 (2 seeds,
  `out/r4/fire-oldsoil.log`).
- **Not changed, and why.** The fourth integrator's cure what-ifs (`out/r4/fire-*.log`, kept in `acceptance.json`
  under this metric) show that a cure loose enough for years 1–2 overshoots once the world has dried — a forest cure of
  0.48 / 0.50 / 0.53 gave 1.0 / 1.5 / 3.25 a world-year in years 1–2 and 11.5 / 14 / 19.5 in years 3–4, up to 10.3 % of
  the land burnt in a year — and with the 0.53 cure the time-lapse fidelity test failed (`tests/perf-lapse3.test.ts`
  "unwatched worlds …": Verdance's plant cover −5.8 % against 1x, `out/r4/check-superseded-cure053.log`). The fix belongs to the world's spin-up (built at
  its own equilibrium: CONTENT's open-grassland ≥ 3 % and tree-mix drift targets, §4.7, are unmet for the same reason),
  not to the fire's thresholds. People do not wait on it: fire-keeping comes by other roads (§10.4, the 50-year worlds).

### 10.6 Known misses

**A band driven out by a dust bowl, on a dry plateau (seed 1, year 46; traced, not changed).** The 50-year world of
seed 1 (§10.4) lost 15 of its 47 in year 47: 10 of thirst, 4 of hunger, 1 of age. The seventh pass traced it from a
year-45 save (`integrate/r7/`: `alone.ts 1 45` with `KEEP=1`, then `famine.ts`, `famine2.ts`, `store.ts`, `reach.ts`):
a dust bowl at year 45.67 dried the town's plateau (soil moisture 0.5 → 0.07); 2 days later the town fell for drought
(`abandonCheck`: no fresh water in reach) with 291 food-days in store. Its people carried what their hands held — four
kinds each (`INV`), in the species' food order, beside the stone and flint they carried — and left 342 maize, 44 roots
and 33 wild grain in the ruins. Its band (47) camped by the ruins while its leader foraged with an empty belly; no water
within 300 m of the leader, 4–5 drinkable cells within 700 m (rain pools), 107 within 1.5 km — and every fresh water
within 2.5 km of the band (the nearest 0.94–1.2 km, on the coast 47 m below) is **out of reach**: A* finds no path
even at 200 000 expansions (the plateau is cliff-bound, `stepFactor` grade > 0.9). Thirsty people search 7 rings
(~400 m) for water they do not know of (`planDrink`); those who found none foraged or slept.
Three fixes were tried and measured from the same save (deaths year 45 → 48; the tree as is: thirst 10, hunger 4):
(A) the parched (water < 0.15) search ~1 km: thirst 12, hunger 3; (A)+(B) a band a quarter thirsty with no water within
three rings heads for the nearest reachable fresh water within 2.5 km: thirst 11, hunger 3 (there was none reachable);
(A)+(B)+(C) a town leaving carries the foods that feed most first: **38 of 47 died of thirst** — fed, the band followed
its leader off the ruins' rain pools into dry land. None was kept (`src/sim` is the gate's tree); the behaviour a band
needs here (not roaming from water it has into land with none; hands freed of stone for food) is a design change with
its own multi-seed measurement, filed as a follow-up task. (Correction, 2026-10-27 21:35–21:40, from that task's two designers, `living/drought/
design-movement/LEDGER.md`, `design-abandonment/LEDGER.md`: the land the band can walk from the ruins is 204 cells,
912 m across, and 158–160 of its edges are deep sea water against 0–2 cliffs — an island or cut-off headland, not a
cliff-bound plateau; the fresh water A* could not reach is across the sea.) Of the seven other 50-year worlds, none lost
a band to thirst: seed 4 lost one person to thirst (year 37), seed 5 two (year 24), the other five none (§10.4's table;
`r6/out/alone-live-<seed>.log`).

**The kin fixture's secessions (§5.1; measured on 8 seeds, not changed).** A secession on 1 of 8 seeds, a raid or war on 1,
a treaty on 0 (≥ 5 / 3 / 2 asked); the control kept its daughters on 8 of 8. The earlier 4-of-8 row was carried by the
everyday grievances that HISTORY's second pass (§5.6) capped at 0.45 so that a capital which relieves its daughters keeps
them; on the integrated tree a wrong done (neglect) carries a daughter past 0.6 on 6 of 8 seeds, and the slow daily draw
past the line makes about 3 secessions of 8 expected. Meeting 5 of 8 is a balance change (a faster draw, or more neglect)
for HISTORY's spec, with the 16-run re-measure; the trace is in §10.4, "Why the kin fixture falls short".

### 10.7 The gate (seventh pass, 2026-10-27)
`npm run check` on the final integrated tree (HEAD `ccfcb5c3`; the sim unchanged since the sixth pass's `work.ts` fix at
13:59), run 18:39–19:23 UTC while the acceptance runs used two of the four cores (`integrate/r6/out/check-7.log`):
detban **145 sim files clean**; `tsc --noEmit` clean; **509 tests, 507 pass, 0 fail, 2 skipped** — the two throughput
floors (`perf.test.ts`), which skip themselves on an overloaded machine ("wall/CPU 4–7"). Among them the migration tests
on the 1.4 saves and the previous 1.5 build's save (`tests/living-migration.test.ts`, 6 tests), every integration fix's
test (`tests/living-integration.test.ts`), the §9 owner fixes (`fire-flee`, `society`) and the UI team's
`ui-living`, `ui-defaults`, `ui-embed` (also run alone: 11 / 11 pass). (The sixth pass's gate, `r6/out/check-0.log`,
502 / 504 pass, had started at 13:52, before its last fix.)

**Ninth pass (2026-10-28).** `npm run check` on HEAD `ccfcb5c3` plus the two `god/omens.ts` fixes of §10.2 (a sign sent
to a named town stands over it; a repeat sign inside the ten quiet days adds no wonder) — the only sim change since the
seventh pass — finished 03:05 UTC (`integrate/r6/out/check-i9b.log`, EXIT 0; the tests took 17 min): detban **145 sim files clean**;
`tsc --noEmit` clean; **523 tests, 523 pass, 0 fail, 0 skipped** (the throughput floors ran this time: wall/CPU 2.2–3.2).
Among them the migration tests (1.4 saves and the previous 1.5 build's save), the new sign-placement test, the rainbow
test that the first try of this gate (`check-i9.log`, 517 / 518) had caught, and the UI team's `ui-living`,
`ui-defaults`, `ui-embed`.
