# GENESIS — status after phase 2 (integration)

Phase 1 built the deterministic sim core and the render foundation (kept below as a reference). Phase 2 adds the
peoples, recipes, societies and ecology to the sim and draws them live in the browser: people walk, settle, build,
farm, keep fire, discover, forget, trade, fight, split and fall; herds graze, flee, breed and speciate; the client shows
it all with procedural bodies, buildings, roads, crops, night lights, fire, toasts and an inspector.
**Not built yet (phases 3–5):** the god hand and creature, command palette / radial / freeform field / chronicle panel,
audio, the opening, ships between worlds, saves and settings UI, README / CONTROLS.

## How to run

```
npm install
npm run dev                      # http://localhost:5190/  (the real sim in its worker; default scenario 'lookdev')
npm run check                    # detban + tsc + all node tests (126 tests in 25 files)
npm run build                    # dist/ (app + the sim worker bundle; base './', hostable from any sub-path)
node _harness/shots.mjs _harness/specs/integration.json  # phase 2 live: two peoples on the sandbox over years at 100x
node _harness/shots.mjs _harness/specs/acceptance.json   # CONTRACT §21.1: barren → air → seas → plants → people → fire → 100x
node _harness/shots.mjs _harness/specs/peoples.json      # a band on twoworlds day by day, inspector, toasts (client lane)
node _harness/shots.mjs _harness/specs/life.json         # lookdev town / city / farm / forest / night / fire (render lane)
node _harness/shots.mjs _harness/specs/liveloop.json     # phase 1: barren → air → rain → life → mountain → night
node _harness/perf_people.ts 1500 2                      # Node: the n = 64 world with and without 1 500 agents (CPU time)
node _harness/perf_worker.ts 1500 20 100,1000            # Node: the real worker at 100x / 1000x with 1 500 agents, no renderer
node _harness/perf.mjs --people=1500 --speeds=100,1000 --view=settlement   # browser: achieved speed + frame time
```

URL: `?scenario=barren|sandbox|lookdev|twoworlds|system` `&seed=` (app default 20260) `&speed=`
`&quality=low|medium|high|ultra|cinematic` `&source=worker` (default) `|lookdev` (render-dev generator) `|auto`
`&hour=` `&cam=…` `&ui=0` `&dev=1`. Test surface `window.__GENESIS__` (CONTRACT §18) adds `query`, `poi`, `select`,
`follow`, `click`, `agents`, `buildings`, `toastLife`. Camera POIs include `homestead`, `homestead-coast` (a homestead
with the sea in reach, for coastal folk), `herd` (the biggest grazing herd), `settlement:<id>`, `farm:<id>`, `harbour`,
`burning`, `city/town/village/camp`, `forest`, `forest-edge`, `coast`, `valley`, `river`, `peak`, `desert`.

Shot specs (`_harness/shots.mjs`): `commands` (values may use `"$poi:<name>"`, `"$created"`, and `"as": "<name>"` on a
command keeps what it created as `"$<name>"`, also inside strings: `"$poi:settlement:$plains"`), `wait` (ticks, stepped
as fast as the worker can), `run: {speed, seconds}` (real time at a multiplier), `camera` (an `hour` there scrubs the
sim's sun with `time.set-hour`), `select`, `follow`, `click`, `ui`, `chronicle: true | N` (print the chronicle and save
it as `_shots/<name>.chronicle.txt`), `pick: "agent:settlement:<id>"` (keep one of its people as `"$agent"` for a
camera `target` and `select`).

## Phase 2 — what works

**Content (data, `src/data/**`, validated by `content.ts`):** 5 species (plains folk, coastal folk, the hive, cold
folk, methane drifters), 126 items, 145 recipes from stone tools to rocketry and the generation ship (every one
discoverable; a pack with dead ends, cycles or a hot craft whose only workplace needs the craft is refused), 38
buildings, 16 materials, 27 animals (+ species born by speciation), 8 diseases, 30 plants, 104 chronicle templates,
name phonologies for 5 languages.

**Peoples (sim, `src/sim/people/**`, `recipes/**`):** SoA agents with needs, traits, skills, knowledge bitsets,
memories, faith; event-driven decisions on a time wheel, analytic movement along A* / flow-field routes; day and night
(sleep by their own sun), warmth (shelter, body heat, fire, clothes), food from foraging, hunting, fishing, farming,
herding and cooking. Knowledge: libraries and writing, teaching, watching, talk, experiments, accidents, artifacts, god
teaching that can be refused; loss with the last knower (and the chronicle says so); hoarded secrets. Buildings from what
builders can get, decay, fire, ruins. Settlements: site choice through the year, names from a feature, households,
roles, stores, territory, roads worn by feet, splits with a drifted tongue, abandonment, falls; cohorts beyond the
individual cap and `focus` to bring them back. **Societies:** economy (prices from scarcity, gifts, theft, markets,
caravans and trading boats as real agents), polities and relations, raids, sieges, battles, conquest, treaties,
tribute, factions, leaders, religion and disbelief, taboos and sacred things from the town's stories, first contact by
land and sea, golden and dark ages, boats (rafts → sailships) with docks that grow from use and colonists who cross the
sea. **Ecology:** herds that graze, flee, migrate, breed, starve and are hunted, predator–prey balance, domestication,
speciation and extinction, invasive species, blight, SEIR plagues with medicine. Snapshot blocks (agents, animals,
buildings, settlements, population, worship) and inspector queries; ~40 commands (spawn, teach, gift, introduce, found,
raze, war, peace, split, merge, cull, breed…). All deterministic (same seed + log → same hash; save/load and rewind).

**Life visuals (render, `src/render/life/**`, `gen/**`):** procedural species bodies with GPU vertex animation (walk,
work, carry, pray, sleep, fish, build, chop, dig, dance, flee, mourn…), animals in herds / flocks / shoals / swarms,
buildings per type × material × style × era (scaffolds while rising, rubble when ruined, flames and smoke when
burning), road ribbons by tier with street lamps by era, crops in rows by growth stage, ground cover (grass,
wildflowers, ferns, logs, mushrooms, reeds), trees that cross-fade between three LODs and char near fire, boats under
people afloat, night lights (hearths, windows, lamps, wildfire) and GPU fire / smoke / embers / sparks.

**Client (`src/app.ts`, `src/client/**`, `src/ui/**`):** the live worker's blocks drawn every snapshot (cheap state-only
updates, smoothing of movers), settlement labels, toasts (discoveries, births and deaths gathered per settlement,
founding, splits, falls, refusals, war, plague… clicking one flies there), and the inspector (click a person, building,
herd or settlement: biography, needs, skills, knowledge, family, memories; rule, factions, neighbours, stores, stories,
language) with Look and Follow.

## Phase-2 integration pass

Every sim ↔ client mismatch the lanes reported, resolved:

- **The day was sidereal.** `dayHours` drove one rotation per `dayHours`, so on Gaia (12-day year) the sun came back
  every 1 571 ticks, not 1 440: noon drifted ~2.2 h a day and shots had to wait "solar days". `Universe.spinOf` now
  anchors the rotation to the star's longitude and adds one turn per `dayHours` (the frozen-sun branch already worked
  this way), so `dayHours` is the solar day (CONTRACT §5: a 24 h day = 1 440 ticks; a 12-day year is exactly 12 days).
  Snapshots publish the exact rate as `PlanetParams.spinRate` (additive), which the client's `spinAt` extrapolates with
  (old data falls back to one turn per `dayHours`). Checked on every world of `sandbox` and `system`: the same hour
  every `dayHours × 60` ticks; extrapolation error ≤ 1e-3 rad per 100 ticks. `peoples.json` waits are whole 1 440-tick
  days again.
- **Boats.** `agentBlock` put the carried item in `carry` for people afloat; it is now the boat item (types.ts
  `AgentFlag.boat`), so the client draws raft / boat / sailship from the sim, not a default rowing boat.
- **Fireless dwellings glowed 15 %.** `lightOf` gives hearth-age dwellings no light when the settlement keeps no fire
  (`nightLight = 0`): a people without fire huddles in the dark (§16.1). The client's gate stays as a fallback.
- **Animals crash after speciation** (herd species past the content list): fixed in the live tree by the societies
  lane; verified by a 70-day `twoworlds` run (8 speciations, every snapshot's animal species in range, herd and
  ecology queries every day, no error).
- **A band dropped at a point appeared ~165 m away** (`landingCell` teleported it to the best site within 5 rings).
  A band now stands where the hand put it (the nearest dry land) and *walks* to the site it chose, if it can walk
  there; established peoples (`settled` / above stone) still stand on their site at once.
- **A band spawned with no place (`twoworlds`, no focus) never settled.** Three causes, all fixed:
  (1) the scenario's default "here" was any land near the equator facing the morning sun — on seed 20260 waterless
  dunes; it now prefers habitable ground (the plains folk's site score; airless worlds unchanged);
  (2) a band that saw nothing good within 3 rings did a random walk of 4-cell legs that re-rolled its direction every
  12 h; now its scouts range ~1.2 km (sparse search, near sites preferred), sites it cannot walk to (across a lake, up
  a cliff) are passed over for 10 days (`st.recent`, saved), and when nothing is in reach it walks toward the
  greenest, wettest, flattest land in view, holding a bearing for two days;
  (3) band members followed in straight 3-cell legs that could run into deep water (one 165 m segment was a four-day
  swim) and, at ~15 m per game hour, lasted half a day without a decision — so nobody drank or slept. Legs are now one
  cell along an A* route (swimmers and boat crews may cross water).
- **Fire nobody could feed.** While food was short every gatherer foraged, so a people that knew fire-keeping sat by
  a cold hearth for years (Node probe: 30 days, wood 0, hearth fuel 0). One gatherer in four now fetches firewood
  while a kept hearth's woodpile is low; with fire they then work out cooking, roasting and pottery.
- **Huts that never rose.** For the same reason builders whose site lacked materials fell back to foraging food, so
  nobody fetched stone, reeds or wood: a band's two hut frames stood bare for weeks (browser and Node). A builder now
  fetches its site's materials (they lead the settlement's wants). Node projection of the integration world: 5 huts by
  day 20, 8 huts + a house + a shrine by day 40, 15 buildings and 47 people by day 60 (before: 2 frames at day 17).
- **Villages that fell to ruin while lived in.** Repairs waited behind construction (there is nearly always a site in
  hand), and with no site open nobody held the builder role at all, so huts (thatch lasts ~40 days untended, wood ~70)
  decayed into ruins with people still sleeping in them. A building at damage ≥ 0.6 is now mended before any new
  site, and worn buildings count toward the builder quota.
- **`sc.focus`** compared a scenario planet index with planet ids (moons take ids in between); it now counts the
  scenario's own planets like `peoples[].planet` does.
- **Equator seam (render).** The terrain shader switched autumn / winter at the sign of the latitude, which drew a
  hard line round the equator (very visible on a terraformed Cinder). Seasons now fade toward the equator and scale
  with the axial tilt (`uSeasonAmp`, set from `PlanetParams.axialTilt`).
- **Settlement position of a fresh camp** (the founding cell while its people still gather 30–45 m away): kept as is
  (the place is the place); the client frames bands and bare camps on their people's centroid.

Tests: `tests/acceptance-barren.test.ts` (new, §21.1, below). Two tests were re-pointed at what they mean after the
behaviour changes: `society.test.ts` "iron monopoly" compares the two runs' opinions *on the same day* (the monopoly
run stops at its war on day 8, the fair run went on drifting for 18 days; day for day the fair town is 0.26 warmer,
the test asks for 0.15 — the solar day, not the placement, had moved the fair run's drift);
`emergence.test.ts` asserts the band *laid in* food (≥ 3 days in store at some point) and nobody starved, rather than
food in store at the end of day 8 (the store is eaten down before the first harvest; it passed by 0.5 days before).

## Phase-2 review fixes (fix engineer)

The phase-2 review (53 findings: 9 critical, 25 major, 19 minor) — what was fixed, how it was checked, what was not.
New tests: `tests/fixpass.test.ts` (11), `tests/climate-drift.test.ts` (2), `tests/survival.test.ts` (1), and a temple
test in `tests/render.test.ts`. Survey probes (`_harness/scratch/advrev/survey.ts <scenario> <seed0> <seed1> <days>
[n]`, `_harness/scratch/fix2/peoplediag.ts`, `thirstdiag.ts`, `trace1.ts`, `worlds.mjs`) are kept for the people lane.

**Sim — critical**
- **Shelters never sheltered** (`finishTask` stepped out before the night was integrated): needs are integrated while
  still inside; occupancy is kept against the building entered (`AgentStore.inside`, saved), so a death or a change of
  home no longer leaks a bed. Test: a hut night with the fires out keeps its sleepers warm (fails without the fix:
  warmth 0.45 → 0).
- **Scenario peoples died within weeks.** Causes found and fixed one by one (survey of `twoworlds` seeds 1–5 and
  `system` 1–3, 30 days, n = 64, before → after): a stricter site choice through the year (`siteScore`: the year's
  mean, its seasons and its hottest / coldest hours against the species' limits; no closed hollows that flood; food in
  reach); thirst (a drink must have water; water at hand — this cell or the next, snow for the cold folk, a well — is
  drunk there instead of a half-day walk to the village's spot; a parched body drinks before it eats; a meal or a bath
  by fresh water quenches); walks lived leg by leg (`MAX_LEG` 120 ticks: needs integrate on the road, a need turned
  critical re-plans); heat (water and shade cool; heat-struck people seek water or shade, never the hearth); a
  thermal-harm curve that does not kill at the edge of comfort. Rust's hive, Gaia's plains folk, Murk, Rime and
  Verdance now live through 30 days on every surveyed seed (`system` seed 2 Verdance 60 → 10 before, 62 → 48 after;
  Rime thirst 16 → 0–3; `twoworlds` seed 4 Rust 22 thirst deaths → 7). `tests/survival.test.ts` guards it.
- **Terran worlds cooled for years** (no equilibrium): the energy-balance climate is spun up at build against the
  runtime sky (measured cloud fraction and humidity, snow and sea-ice albedo, cloud long-wave), neighbour heat
  transport and riparian moisture were added, plants and biomes judge by year means (`tempYear` / `lightYear`) and
  peoples by the year's extremes (`tHi` / `tLo`). Drift over five years, n = 24: Gaia −1.74 → −0.1 °C/yr (sandbox),
  −1.63 → −0.1 (twoworlds); Rust +0.33, settling. `tests/climate-drift.test.ts` (fails on the old climate). A world
  given air, moved, spun or tilted forgets its old climate (`resetClimateMemory`, a growing-window mean) — the barren
  acceptance run needs it.
- **No couples, no long-run society:** pairs form daily among the unpartnered grown-ups (`pairUp`), courting grows
  more pressing with time alone. Test: couples within days.

**Sim — major**: `cohort.sick` was missing from new cohorts (hash differed after save/load: fixed, test);
outbreaks rolled only for settlement ids that were multiples of 15 (`outbreakDue`, test); construction deadlock (a
site whose material can no longer be had is switched or given up: `reviseSite`, test); bands that never arrived (goal
progress, give-up, arrival rules); flooding was treated as drought (abandon causes: flood / drought / cold / heat /
famine, chronicled as such); knowledge spreads by watching the next cells, at-risk ideas are taught first, keepers of
lore pass ideas on; agents were frozen mid-task (needs integrate while moving, urgent needs re-plan).

**Sim — minor**: place-fed animals (fish, birds) have a per-cell carrying capacity; a daughter species counts against
its root's herd cap; one ocean is one population and sea / air species take habitat names (no more "Woolly whale" and
three-yearly whale renames); dark ages need a real decline and last at least half a span; chronicle kinds ('hardship')
and texts fixed; eras are climbed, not skipped (most of the previous era first), experiments need their inputs seen and
each own discovery makes the next harder (test); raids teach (`accident 'raid'`). Not done: `maxAgents` stays a soft
cap (a band always keeps a core of four), the people step's fixed overhead (§6.1 budget) — sim perf is the polish lane's.

**Render — critical**
- **Ruins**: a collapse, not a cut-away — each wall breaks at its own ragged height, a gable sometimes stands, nothing
  above the knee but walls, rubble heaps ~1.3× the footprint with fallen timbers, char that weathers to grey-brown over
  days, patchy moss and grass creeping over old ruins; a ruin under a rebuilt house is not drawn and the sim clears a
  ruin when its site is built on.
- **Fire**: roofs burn as a front climbing from the eaves (char behind, an ember band at the front, holes late in the
  burn), 3–6 blazes along each burning ridge and a smoke column, camera-facing flame tongues of varied height with
  capped cores; burning ground is a thin front line along the fire field's contour (constant width from the field's
  gradient), sparse embers and coal patches behind it — not a glowing field.
- **Boats** float on the water surface. **Temples** (below). **Night**: moonlight now lights buildings, roads, trees,
  people, animals and boats (`shaders/moon.glsl.ts`, the brightest moon as a second directional light); the night key
  is 0.013 and the exposure ceiling does not rise at night (was 14), so hearths, windows and lamps lead; street lamps
  light only their pools (the constant +0.12 glow is gone). **Water**: caustics only 0.15–3.2 m deep within ~24 m,
  ridged filaments, stronger absorption and in-scatter (the floor fades within a few metres).

**Temples** are built in their people's tradition (the family of their dwellings — earthen, timber or masonry —
`BuildingSpec.family`, `catalog.dwellingFamily`) and era: a stone circle; then a terraced mudbrick ziggurat (battered
tiers, buttress rhythm, a walled stair, a shrine with a portico on the summit), a great timber hall on a stone platform
(peristyle, steep roof, crossed gable horns) or a colonnaded temple; later a domed hall, a tiered pagoda (swept eaves
with upturned corners, bracket sets, lattice walls, a ringed finial) or a cathedral. Mood dresses it: fearful — dark
basalt behind a walled precinct with a spiked parapet, braziers on the gate pylons, black and red banners, horned skull
totems, a stained altar; benevolent — open, warm stone or whitewash, hedges and flower beds, a paved walk lined with
lanterns, an altar heaped with offerings, bells on the eaves. Test: no pagoda among masons, no ziggurat among timber
folk; fearful has its precinct and braziers, benevolent its lanterns; LOD 1 keeps the silhouette.

**Render — major**: people: matte, less saturated skin with blood in cheeks, ears, knuckles and knees; arms swing
±28° with the elbow bending; rounder neck and shoulders; the tunic reaches over the pelvis (no bare band at the
waist); the belt is an elliptical band on the hips. Far crowds (LOD 2) wear their clothes' colours. Animation blends
mix joint angles per bone and pose once (no collapsing mid-blend). Animals: barrel chest, tucked waist, rounded rump,
haunch and shoulder masses, angled legs with a hock, thicker necks, heads 17 % larger, darker duller coats with a
countershaded belly and per-animal variation. Baobab: grey-brown bark, broad forking crowns with twigs; bark albedo is
clamped. Construction: scaffolds by kind (a ring of saplings for huts, the frame for timber, putlogs only for masonry of
two storeys and more, a ladder and stacked blocks for low masonry), courses rise raggedly, openings stay raw holes
until the walls are up. Thatch: uneven wavy courses, weathering and mended patches, a lumpy cone outline and a straw
fringe at the eave. Houses: yard props by era around each dwelling (woodpiles, barrels, fence runs, kitchen gardens,
carts, washing, drying racks). Plinths: the floor sits at the footprint's mean on gentle slopes, foundations are dark
field stone. Roads: lifted over the relief between samples, dead ends narrow and crumble instead of stopping square,
darker grimy paving, no ribbons through standing water, hysteresis so a scorched way stays continuous. Terrain paths:
only a soft warped trodden tint (the curved ribbons are the paths). Crops: rows of wider clumps out to 150 m. Harbour:
quays of dark stone banded by the water (wet line, weed, depths) with ladders and steps; quays and decks no longer
take the facade lamp glow. Ocean: the glint's roughness comes from the wave slopes the pixel cannot draw (glitter,
not a blur), scattered whitecaps on the open sea (the sea state `uWind` is still a constant 1, not the weather).
Night from orbit: two relaxation passes and a compressed level so a village shows, the glow follows the streets.
Forest: under a closed canopy the trunks and lower crowns get ~0.4× green-tinted sky. Perf: LOD 1 buildings and yard
props cast no shadows.

**Render — minor**: far tree LOD keeps the crown's mass (more sprays and a dense core); ambient bird flocks (songbirds
over woods and fields, gulls on the shores) circle and come down to feed near the camera, and Follow frames fliers at
their altitude; ground stones are darker, warmer, rounder and half-buried; the market is paved at ground level with a
kerb, crates, baskets and sacks under faded awnings; building LOD has a ±10 m hysteresis band; the herd POI frames a
real cluster on dry land; standers vary (hands behind the back, arms folded, a hand on the hip, weight shifts).

**Checked by eye** (`_harness/scratch/fix2/cap.mjs` on the AD's lookdev specs, before = `_harness/scratch/ad2/shots`,
after = `_harness/scratch/fix2/shots*`): L18 / L19 / L20 temples, L22 night city, L24 burning, L26 ruins, L02 village,
L07 street, L08 people, L09 herd (was framed at sea), L10 birds, and the third batch listed below.

Third batch (`_harness/scratch/fix2/batch3.json`): L07 street (paving back and darker, quays banded), L24 burning
(a front line and coals, not a peach field), L23 night orbit, L21 construction, L17 harbour, L11 forest, L14 crops,
L01 camp, L03 town, L22 night city, B10 coast birds (probe: flocks and birds drawn).

**Tests touched for world changes** (the climate fix moves the worlds' water): `society.test.ts` "complementary
settlements trade" now picks the first of a few seeds whose two towns have a road between them (seed 11 put a lake
between them — the boat-trade test covers that case); `plague.test.ts` "medicine" keeps the control town from
stumbling on herbalism in the middle of its plague (it then became a second medicine town), and a grave case is the
person's own frailty to the disease (one draw per person and disease), so the two towns compare like with like.

**Not done (left for their lanes or later):**
- People: hair as strands / cards, ears as embedded shells, clothing shells taking the body's exact weights, skin
  triangles under clothes dropped; idle variety is in, spacing jitter for standers is not.
- Grade, sun / sky balance and aerial haze (`pipeline.ts`, `atmosphere.ts`: the polish lane's, as the review says);
  saturation is still 1.22 (skin was desaturated in the body material instead). Terrain detail relief (`noise.ts`,
  `groundfloor.ts`) and the forest floor are the polish lane's; night-side clouds (`clouds.ts`) too.
- Perf: terrain patches are not instanced per LOD, no multi-draw; crowds keep their LODs (LOD 2 is 240 triangles).
- Houses: no new variant axes (annexes, chimney placement, per-household palettes) beyond the yard props; grass does
  not return between houses.
- Ocean: no cloud reflection beyond the screen-space one; night from orbit still reads as a lit polygon with blocks
  (smoother, villages visible) rather than lights strung along every street.
- Sim: `maxAgents` stays a soft cap (a band keeps a core of four); the people step's fixed overhead is the perf lane's.
  Hot worlds are still hard: Verdance (system seed 2) loses ~20 % in its first month to hunger and heat, cold folk on
  Rime still lose 0–3 to thirst when they work far from melt water.
- Review coverage: no live boat or live bird shot (birds checked on lookdev with the flock probe); one burst frame of
  walking people (L08 b1) shows a faint pale shape at a moving shin that was not explained.

## Acceptance §21.1 — from the barren start

**Node, sim only: `tests/acceptance-barren.test.ts`** (part of `npm test`, 30–40 s). The real `barren` scenario (Cinder,
30 h days, 9.6-day years) at grid n = 32: airless, dry, bare, empty → `planet.add-air` and ~10 days of greenhouse warming
(−40.8 → >10 °C mean; rain on frozen rock only lays snow) → a world storm while the sea level is raised (seas and lakes
fill the craters) → meadow grass and berry scrub, two forests → 30 plains folk at the best place to live → the
god teaches fire keeping and fire making → three Cinder years at full speed. It asserts a settlement stands, ≥ 15 live,
a hearth burned at night, they hold ≥ 3 ideas nobody gave them (discovery events of their own, never `god`), and the
chronicle names them. A run of it tells (abridged): *"A band of plains folk settled at Vuman by the Lake." · "A fire
laid on clay at Vuman by the Lake left a hard red shell. Sekan understood: pottery." · "After many failures the
flint-clan of Vuman worked out cooking." · "In Vuman by the Lake, Ta worked out agriculture. Nobody had shown her
how." · "The clay age began at Vuman by the Lake." · "The golden age of Vuman by the Lake began…" · "Vuman by the Lake
raised its first bread oven." · "After many failures the mason-clan of Vuman worked out houses." · "Rafts was first
understood in Vuman by the Lake, by Kukek."* — 30 discoveries in three Cinder years, none of them placed.

**Browser, live worker, full-size Cinder (n = 64): `_harness/specs/acceptance.json`** → `_shots/acc-01-barren` …
`acc-07-first-night`: the grey cratered rock; the blue limb after air; the world storm filling the seas; green land,
crater lakes and polar snow; the band set down at the `homestead`; the settlement after 120 s at 100x with the inspector
open; the first night by the hearth. The chronicle of that run is saved as `_shots/acc-06-left-at-100x.chronicle.txt`.

## Screenshots (live worker sim, SwiftShader, 1280×720 medium; all looked at)

**A living world on the sandbox (`_harness/specs/integration.json`, one page = one world's history, seed 20260):**
`int-01-world` the bare sandbox after the god sows it (grasses, wild grain, berries, ten forests) ·
`int-02-band-arrives` 40 plains folk walking from where the hand put them among palms and pools ·
`int-03-coastal-folk` 30 coastal folk at a palm grove by the shore (`homestead-coast`) ·
`int-04-herds` deer and wolves in a forest (deer, aurochs, wild horses and wolves set loose) ·
`int-05-camp-day1` the camp: two hut frames, people at the water ·
`int-06-village` after 40 s at 100x (year 2, ×51): "Isobar by the Lake · clay age", discovery toasts ·
`int-07-coastal-village` "Lane of the Singing Water" ·
`int-08-town` after 160 s more at 100x (**136 400 ticks ≈ 9.5 game years, ×85–94**): year 12, bronze age, timber
houses, domed huts and the charred ruins of the year-6 fire on worn roads; toasts of the coastal town's losses ·
`int-09-street` street level (1.7 m) among houses, ruins and a scaffold · `int-10-forest` a forest canopy ·
`int-11-herd-card` the inspector on a herd ("Red deer", 8 animals, grazing, wild) ·
`int-12-inspect-person` the inspector on a person (Humthu, 5, drinking; needs, faith, skills, nature, knowledge —
`_harness/specs/inspect.json`, the same seeded world four days in) ·
`int-13-inspect-settlement` the settlement card (bronze age, 40 souls, Chief Shuthu, factions, 18 born / 18 died,
14 maize fields, 54 ideas) · `int-14-night-village` lit windows and the hearth at night ·
`int-15-night-orbit` the night side from orbit: the one lit village is a small glow (two villages do not make a city) ·
`int-16-burning` the god sets the town alight at dusk: burning buildings and ground ·
`int-16b-burning-oblique` the same from a low angle so the flames read (`_harness/specs/fire.json`, a fresh camp).
The world's chronicle (175 entries) is `_shots/int-16-burning.chronicle.txt`; excerpts: *"Where the plains folk of
Isobar by the Lake threw out seed, grain came up thick. Shuthu saw the meaning: agriculture."* · *"Year 6. Isobar by the
Lake burned."* · *"The plains folk of Isobar by the Lake swore never to make fire again, nor to take it as a gift."* ·
*"Grain left wet in the stores … turned sour and strange. Shuthu drank it anyway, and Isobar by the Lake learned
brewing."* · *"Neduk … raised orphaned cubs by the fire. They stayed: animal husbandry."* · *"Green stones in the kiln
at Isobar by the Lake wept bright metal. Ten learned copper smelting."* · *"Isobar by the Lake entered the bronze age."*
· *"When Saises died, Lane of the Singing Water forgot fishing nets. Nobody had written it down."* · speciation and
extinction of the herds the god set loose (*"…the wolves of Gaia became something new: savanna wolves."*).

**From the barren start (§21.1, `_harness/specs/acceptance.json`):** `acc-01-barren` … `acc-07-first-night` (above).

Earlier lane shots kept in `_shots/`: `peoples-*`, `toasts-*`, `fields-*` (client lane, twoworlds), `life-*` (lookdev
town / city / farm / forest / night / fire), `cint-lookdev-*`, phase-1 `loop-*` and `sc-*`.

## Measurements (phase 2; 4-core Xeon @ 2.1 GHz shared with other engineers' SwiftShader captures, load average 12–21)

**Sim throughput with ~1 500 agents** (CONTRACT §6.1 asks ≥ 1 000 ticks/s on the n = 64 home world):

| measure | world alone | with ~1 600 agents | notes |
|---|---|---|---|
| `perf_people.ts 1500 2`, CPU time | 1 344 ticks/s (0.744 ms/tick) | **781 ticks/s** (1.280 ms/tick) | people 0.54 ms/tick, 0.34 µs per agent per tick; 25 clay-age villages, 521 buildings, 38 herds |
| same, wall time (loaded machine) | 902 | 506 | |
| `perf_worker.ts`, real worker, 30 Hz snapshots, **100x** | | **503 ticks/s** (×52) | 1 509 → 1 399 agents during the run; snapshot round trip p50 17 ms / p95 57 ms |
| `perf_worker.ts`, **1000x** | | **645 ticks/s** (×65) | 1 268 agents; p50 15 ms / p95 71 ms; best effort, never skips work |
| browser, live while SwiftShader renders a village (2–5 M triangles) | | ×23–58 | the worker shares the 4 cores with the software GPU |

Profile of the people step (1 600 agents): decisions ~36 % (planning ~44 % of that, starting tasks ~22 %, needs
~15 %), the hourly settlement step ~37 % (jobs, resources, wants, roles, construction), task completion ~8 %; no single
hot spot. The world systems dominate the rest (climate column kernel, hydrology flux, vegetation).

**Frame time** (SwiftShader, CPU rendering — regressions only, says nothing about a real GPU):

| `perf.mjs --people=1500`, 1280×720 medium, load ≈ 12 | worker achieved | ticks/s seen by the client | wall ms per frame | `render()` CPU |
|---|---|---|---|---|
| settlement view, 100x | ×58 | 430 | 15 100 | 83 ms |
| settlement view, 1000x | ×47 | (no snapshot in the window) | 15 200 | 56 ms |
| orbit view, 100x | ×42 | 222 | 15 100 | 17 ms |
| orbit view, 1000x | ×44 | 186 | 10 100 | 850 ms (one slow frame in a short window) |

Shot runs: 7–67 s per frame (2–5 M triangles, 1 500–2 600 draws) while other engineers' captures shared the CPU; the
same run reported 7.5 s per frame for the airless orbit (179 k triangles). At 100x the worker achieved ×23–51 while a
village view rendered, and ×85–94 over the 160-s run of `int-08` (136 400 ticks).

Client CPU per frame on live data (client lane, 1 508 agents / 510 buildings): LifeLayer.update 2.4 ms (buildings
1.1, crowds 1.1, animals 0.2), WorldView.apply 0.02 ms per snapshot without fields.

## Known gaps

- **Not built yet (phases 3–5):** the god hand, creature, command palette / radial / freeform field / chronicle panel /
  overlays / settings / saves UI, audio, the opening (`?intro` is ignored), ships between worlds (`firstOrbit` exists
  for the launch system to call), photo / dolly / walk cameras, README and CONTROLS.
- **Sim budget missed:** ~780 ticks/s by CPU time with ~1 600 agents on the n = 64 world (CONTRACT §6.1 asks 1 000;
  the world alone runs ~1 340). The people's ~0.54 ms/tick is spread thinly (decisions and their planning ~50 %, the
  hourly settlement step ~35 %, no single hot spot); closing it needs structural work (fewer decisions per agent, a
  slower settlement cadence, multi-cell movement steps). In the browser the worker shares the cores with SwiftShader,
  so live rates there are far lower (×23–58 while a 2–5 M-triangle view renders on this machine).
- ~~**Desert peoples in summer**~~ (Rust's hive dying on the road by day 15): fixed by the review pass (site choice
  through the year, water at hand, the climate's equilibrium) — on `twoworlds` seeds 1–5 the hive grows or holds
  through 30 days (60 → 61–85).
- **Lean hand-to-mouth bands:** settlements often eat their store down to nothing between harvests (no deaths); births
  stay slow (1–3 per band per game year), so "camp → village → town" is mostly more and better buildings and a rising
  era rather than many more people within a few game years. Coastal folk on a coast without stone or wood build little
  (their chosen material is out of reach and construction stalls) — set them down where trees grow (`homestead-coast`).
- **Sandbox is bare by design** ("nothing alive yet"): a people set down there before the god sows plants has nothing
  to eat; the integration spec sows the world first, `perf_worker.ts` uses `vegetation: 1`.
- **Render (SwiftShader only; real-GPU frame rate unmeasured):** the world-storm cloud deck has a stair-stepped limb
  and the clouds read as blocky cells from orbit, bright on the night side (the polish lane's files). Trees and ground
  cover still flip their season per instance at the equator (the terrain no longer does). People switch LOD with a
  hard cut (buildings now have a ±10 m band); no far tree billboards. (Pool caustics and the bright night: fixed in the
  review pass.)
- **Look of the live runs:** night from orbit over small villages is a soft, faint glow; a lake on flat ground draws
  as a hard polygon at night; the year-2 "village" of the live run was still two hut frames (its huts rose later and
  burned in year 6 — the history differs from run to run). (The lava-field fires: fixed in the review pass.)
- **Ecology pace:** isolated land herds speciate after 3 years, so a few game years still bring speciation /
  extinction pairs (sea species no longer isolate within one ocean, fliers range five times as far — review pass).
- **Toast wording:** a "discoveries" toast groups what the god taught (fire making) with what the band worked out.
- **Live boats** are drawn from the sim's boat item now, but no live shot has caught a boat yet (lookdev only).
- Not verified in screenshots: the Follow camera over time, toasts at 1000×, settlement labels from high altitude.

## Phase 1 (reference)

The phase-1 report, unchanged except for the headings.

### What works (phase 1)

**Sim (worker / Node, deterministic):** every §7 field; hydrology (pipes with momentum, sea reservoir, rivers, springs,
erosion, floods, tsunamis), hourly climate (energy balance, greenhouse, lapse rate, humidity advection, rain/snow,
clouds, winds), weather systems, terrain brushes + lava/sand/ash/talus, fire, vegetation (30 species, succession),
biomes, chronicle firsts, save/load (GNSS, including commands queued for the next tick), rewind (compressed
reverse-delta keyframe ring + log), command registry with per-command schema validation and
readable refusals, parameter registry, phase-1 freeform (`set <path> <value>` + power words). Worker pacing with
achieved-speed reporting (3 s sliding window) and throttled transferable field snapshots; the worker sleeps between
tick slices instead of spinning (1.6–5 % of a core at 1x–100x on an idle world).

**Integration:** worker is the default source; snapshot fields/units match what the renderer packs (flow m/tick →
m/s, ice = ground + floating, species = plants.json indices, hour in planet hours); the render clock advances at the
*measured* sim rate (sliding 1.2 s window, capped at the requested speed) so spin, sun and calendar stay smooth when the
sim cannot hold the requested multiplier; the app sends a throttled `focus` command (the sim's default "here");
`shots.mjs` applies commands → steps → camera and logs every command result. Sun direction checked equal between
sim (`sunDirBody`) and client (`bodyQuat`) at hours 0/6/12/18.

**Ground (CONTRACT §4.3, one definition):** `src/sim/grid/surface.ts` now interpolates `surface` with a curved,
Phong-tessellation-style blend (α = 0.75) from per-cell tangent-plane gradients fitted by least squares (|g| capped at
1.2). The sim (`Planet.ground()`, lazily cached on the surface version), the client mirror (WorldView), the terrain and
water vertex shaders (gradients in field texture G) and CPU placement/picking all evaluate the same formula;
`tests/ground.test.ts` checks a float32 JS re-implementation of the GLSL against `groundOffset` on the real packed
textures (max difference 0.08 mm), sim vs client gradients (identical), continuity across 602 edges (≤ 0.4 mm), every
cell interpolated exactly, and accuracy on a smooth relief (RMS 0.24 m curved vs 0.51 m flat facets). The same
function now carries **dunes**: a meridian-aligned ridge pattern (26 m wavelength, gentle stoss / steep lee, sinuous
warp, cross-faded at the antimeridian) whose height follows each cell's sand depth (none on beaches, up to 1.8 m in a
sand sea), evaluated identically on CPU and GPU (`duneNoise`, `duneAmpOf`; field texture D carries the amplitude).

**Shots (all on the real sim unless noted; `_shots/`, regenerate with the specs above):** `loop-01…12` (barren →
air: blue limb and sky → planet-wide storm → crater seas → green where water and warmth allow → a raised range →
sunset → dusk terminator → night), `sc-*` (sandbox, lookdev coast/river/valley/forest/peak, twoworlds and system
views, Rust, Cinder), and the lookdev reference set (`orbit-day`, `valley`, `sunset`, …; the originals are in
`_shots/before/`).

**Render (WebGL2):** HDR pipeline (MSAA, bloom, god rays, auto-exposure, lens flare, AgX + grade + golden-hour
split-tone, FXAA, grain; NaN/Inf pixels are dropped before bloom), physical atmosphere with LUTs and aerial
perspective (black sky when airless), volumetric clouds from the sim's cloud/precip fields organised into weather
(storm spirals from the sim's weather systems, banded decks, cell-scale towers; two-segment shell march so the deck
has a base seen from below; temporal resolve with reprojection), chunked terrain LOD with geomorphing, skirts and a
silhouette-aware split (a round limb from orbit), smooth-shaded layered procedural terrain material (analytic-gradient
micro normals, rock on ridges / peaks / cliffs with scree, beaches, narrow noise-broken wet band, filament caustics),
near-camera instanced ground cover (grass tufts, stones; deterministic per cell, shrink-in at the range edge),
ocean/river water (Gerstner, flow-mapped ripples, refraction/absorption, SSR with reprojection and a ray-crossing
test, shore blend by depth, energy-gated foam, rapids only on fast water, sea ice that fades at the waterline),
cascaded sun shadows, starfield, star (limb darkening and granulation readable up close), orbit lines, orbit/system/fly
cameras, HUD with achieved speed. `?ui=0` / `__GENESIS__` clean captures also hide the portal control bar.

**Trees (no lollipops):** one branching skeleton per variant (trunk → limbs → branches → twigs), crowns of
alpha-tested leaf sprays at the twigs with sky between them; LOD1/LOD2 regroup the same twig tips so silhouettes do not
change; conifers are whorls of needle-spray cards around a dense core; birch, umbrella (acacia / rainforest), palm
(V-section fronds), dead and shrub forms; species, height and leaf colour from the sim's `treeSpecies`/`shrubSpecies`
(plants.json), autumn colour for deciduous species, per-tree lean/girth/brightness, trunk bases blended into the soil,
coverage-preserving alpha at coarse mips. Crowns carry a per-vertex crown depth (inner foliage darker, rim lit), a
single sky-ambient term, per-tree hue / value jitter, clumping, height variance and an understory; trees at the edge
of the vegetation range shrink into the ground per instance (no per-pixel dither confetti).

### Phase-1 review fixes (fix engineer)

All 41 review findings were triaged; every critical and major one is fixed except where noted under Known gaps.
Repro probes live in `_harness/scratch/simrev/` (sim) and `_harness/scratch/fix/` (render captures, `capture.mjs`);
regression tests in `tests/simreview.test.ts`, `tests/determinism.test.ts`, `tests/water.test.ts`,
`tests/worker.test.ts`, `tests/ground.test.ts` and `tests/render.test.ts`.

**Sim**
- *Rain cache vs ocean mask (critical):* `rainingCells()` no longer depends on the ocean mask (the climate pass skips
  sea cells itself), and `computeOcean()` marks it dirty. Save/load sweep: 0 hash mismatches; rewind 6/6.
- *Ocean seeding:* the sea floods from the previous sea (cells still under the level), else the recorded seed cell,
  else the deepest cell, so an inland pit deeper than the sea no longer steals the ocean. Barren → seas keeps its sea.
- *Sea-level ramp vs tsunamis:* the ramp shifts the existing sea by the step and floods only newly drowned cells
  (generation stamp) instead of re-filling the whole ocean, so a running tsunami survives the ramp.
- *Seepage accounting:* seepage is added to `hydro.sourced`; volume drift 0 in `seep_accounting.ts`.
- *Erosion publishing:* surface/sand/soil versions bump only after ≥ 2 cm of accumulated change (or every 30 steps):
  39 bumps vs 485 before over the probe, i.e. far fewer full-field snapshots.
- *Worker pacing:* sleeps with `setTimeout` (≥ 4 ms) between slices, `setImmediate` continuation in Node and a
  generation-tagged `MessageChannel` in browsers; idle 1x world 1.6 % of a core (was a spinning core at 10x/100x).
  Achieved speed: 3 s ring of samples ≥ 12 ms apart, snapping to the requested rate within one tick (1x reads 1.00).
  Node host at 1000x: command latency p50 10 ms.
- *Pinned season:* the sun keeps its true orbital geometry and only the declination is replaced; the frozen-sun spin
  follows the sun longitude, so pinning neither moves the hour nor heats from a fake position (angle error 0°).
  Snapshots publish the sim's own `sunDir`, which the renderer uses (sim and render agree by construction).
- *Keyframe memory:* keyframes form a reverse delta chain (XOR against the next-newer keyframe, byte-plane shuffle,
  zero-run RLE, `src/sim/core/kfcodec.ts`), encoded incrementally (2 MB of raw arrays per tick) under a 64 MB
  encoded budget. Full ring at the default spacing: sandbox 52 MB (was 135), twoworlds 83 MB (228), system 98 MB
  for 9 keyframes (413 MB for 16). Rewind to the oldest keyframe reproduces the lived hash.
- *Brush schemas:* each terrain brush has its own `strength` range (raise/lower 0–1000 m, flatten/smooth 0–1, noise
  0–500, crater 0.05–5), `height` only for flatten, `frequency` only for noise; mountain height and dig-sea depth
  capped at 1000 m; brushes clamp ground to the planet's limits. Dig-sea marks newly drowned cells as sea at once.
- *Talus sleep:* cells go back to sleep once their excess over the angle of repose stops changing (0 awake after a
  big brush settles).
- *`weather.clear` everywhere:* takes `everywhere: true` (freeform "clear weather everywhere" maps to it) and clears
  every system plus the global weather, with a readable message (also when no place can be resolved at all); a local
  clear that finds nothing says so and points at the planet-wide weather.
- *Timewheel overflow:* one overflow entry per id (`inOverflow` set), cancelled/fired entries dropped on migration.
- *Storm winds:* the hourly climate pass re-applies the weather overlay after resetting winds, so storms keep their
  winds through the hour boundary (70/70 ticks).
- *Altitude datum:* temperature lapse uses the planet's reference level, not the current (ramping) sea level.
- *Global weather:* `setGlobalWeather` re-bakes precipitation and cloud exactly (old floor removed) and re-composes sky.
- *Queued commands* are saved and restored with the sim (`queue` in save and keyframe headers).
- *types.ts:* `hourAtLon0` documented as the planet's own hours (0..dayHours).

**Render**
- *Flat shading (critical):* chunk geometry now has a `normal` attribute (shared with the unit-direction positions),
  so three r186 no longer compiles the terrain as FLAT_SHADED. Test in `tests/render.test.ts`.
- *SSR (critical):* rays are reprojected through the planet's body frame into the previous frame, accept a hit only
  on a real depth crossing (no streaks from thick-surface hits), are jittered per frame and fade by distance, screen
  edge and roughness.
- *Water geometry (critical):* ice is resolved before the shore blend and fades at the waterline (filtered cracks);
  rapids only on genuinely fast water; thin sheets lying on slopes fade out (smooth "paper" fade rather than a hard
  discard); where two still basins at different levels share a sim triangle, the lower keeps its flat level below
  its shoreline and the upper sheet thins to nothing at that shoreline (`h = max(lo, min(linear, g + 1.5 (g − lo)))`,
  every switch continuous across sim-triangle edges), so there is neither a tilted pane nor a wall. The literal
  "take the nearest cell's level" of the finding was tried and rejected: it stands a wall on every cell boundary and
  flat polygons of water on straight sim-triangle edges. The suggested clamp of every shore vertex to
  `min(level, ground − 0.05)` was *not* applied: it removes water from whole shore triangles (visible bands of dry
  sea bed at every coast); the shore blend by depth already hides those edges.
- *Clouds (critical + majors):* new density model organised by weather (storm spirals from the sim's systems,
  meandering storm tracks and broken cloud under a planet-wide weather, cell towers), two-segment march through the
  shell (the inner shell no longer cuts the deck), a terminator term using the air above the sample (no blood-red clouds on the night side), temporal resolve with reprojection
  and history reset on camera cuts. Atmosphere upsamples clouds with a depth-aware 3×3 Gaussian.
- *Tone:* AgX lift 0, saturation 1.18, power 1.3; single sky-ambient term (three's `RE_IndirectSpecular` was adding a
  second Lambert term from `iblIrradiance`), specular occlusion and horizon occlusion on rough ground (no blue sheen).
- *Ground material:* analytic-gradient simplex micro normals, rock on convex ridges and peaks (curvature from field
  N.w) and cliffs, scree, beaches, broad low-contrast meadow variation (no camouflage), two relax passes on
  vegetation and moisture, narrow noise-broken wet band skipped under vegetation (and faded where it would be
  thinner than a pixel, which drew dotted outlines round steep pools), filament caustics, worn paths only
  (no area-fill cobbles).
- *Ground cover:* `src/render/life/groundcover.ts` + `src/render/gen/groundgen.ts` (grass tufts, stones; ≤ 2 new
  cells per frame so a cut does not stall; each cell's scatter is cached under a quantised signature of the fields
  it reads, so live snapshots rebuild only cells whose inputs really changed and keep drawing the old scatter until
  then).
- *Trees and hand-over:* see the trees paragraph above.
- *Orbit framing:* orbit preset at hour 16.25 (side-lit, with relief); live-loop orbit shots likewise.
- *Star close-up:* when the disc fills the view the exposure comes from the disc's own radiance (centre ≈ 1.2 before
  AgX), its colour is saturated along its own hue (a G star reads gold with an orange limb, not a white flood or a
  grey moon), limb darkening uses the true line-of-sight angle (the view-space normal's z kept half of it up close),
  the corona is sized to the disc's silhouette (it no longer washes over the limb) and becomes a thin warm rim,
  sunspots are small umbrae in activity belts, granulation visible; orbit lines hide near the star.
- *Snow/ice:* partial snow follows the land, not noise (shaded and pole-facing slopes and hollows keep it, sunny
  convex ground melts out first) with a wide, gentle transition (no dalmatian spots); ice crack pattern filtered.
- *Silhouette LOD:* seen from altitude, patches near the limb split up to 3.5× sooner (cubic in grazing angle; the
  geomorph uses the same factor per vertex), so the limb is round without refining the disc centre; the boost fades
  out below ~a third of a radius of altitude, where nearly every distant patch is edge-on and it only cost draws.
- *Desert:* dune term (see Ground), the `desert` POI requires real sand, low vegetation and moisture and no snow
  (bare-and-dry alone matched the ice cap) and scores the neighbours' bare sand too (a sand sea, not a sandy
  clearing), falling back to the barest sand; shore foam gated by wave energy (still
  ponds have no foam ring).
- *Capture:* `?ui=0` and clean captures hide the ForgeFlow control bar (`.genesis-clean`).

### Measurements, phase 1 (headless Chromium, SwiftShader — CPU rendering; frame times are for regressions only)

Machine: 4-core Xeon @ 2.1 GHz; SwiftShader renders on the same cores the worker uses, so sim rates here are a floor.

| scenario (worker) | requested | achieved | ticks/s | notes |
|---|---|---|---|---|
| sandbox (terran n=64 + moon), orbit view, 1280×720 high | 1x | 1.0x | 10 | |
| | 10x | 10.0x | 109 | |
| | 100x | 95x | 855–1011 | |
| | 1000x | 108–115x | 1021–1164 | CPU-bound: the sim's idle cost is ~0.85 ms/tick; it never skips work |

Node, sim only (`node _harness/perf_sim.ts`, SIM lane): barren 7943 ticks/s idle; sandbox ~1135–1190 idle, ~260 in
planet-wide monsoon; twoworlds ~415, system ~280 over a game day. After the review fixes (same harness, same machine,
run-to-run noise ±25 % on barren): barren 5550–9240 idle / 257–292 in heavy rain (HEAD on the same run: 7150 / 290);
sandbox 1110 idle / 237 in monsoon.

Rewind ring (`_harness/scratch/simrev/keyframe_mem.ts`, default spacing 2880 ticks, ring full): sandbox 52 MB,
twoworlds 83 MB, system 98 MB for 9 keyframes (before: 135 MB, 228 MB, 413 MB for 16 raw copies); a rewind to the
oldest keyframe decodes the whole chain and reproduces the lived hash.

Worker (browser, `_harness/scratch/simrev/worker_cpu.mjs`): an idle sandbox at 1x–100x costs 1.6–5 % of a core (the
old pacing spun a core at 10x and 100x); achieved speed reads 1.00 at 1x. Node host at 1000x: command round trip
p50 10 ms.

Render clock (`tests/clock.test.ts`, 60 Hz frames, jittered 30 Hz integer-tick snapshots): per-frame rate jitter
4.4 % at 1x, 1.5 % at 10x, 3.2 % at 100x, 3.8 % at 1000x-held-at-300x; never backwards; ≤ 0.08 s behind the sim.

Main thread (Node timing of the same code): full snapshot apply incl. curvature gradients 19 ms, first texture
pack 54–68 ms; a typical update (water + flow) 5 ms; an hourly all-fast-fields update ~21 ms.

SwiftShader frame (regression reference only): orbit 1.1–2.4 s/frame (90–280k tris), surface with forest 4–11
s/frame (2.6–7.6M tris, 450–1800 draws); 480×270 low: ~0.3 s/frame. `render()` CPU 25–100 ms. After the review
fixes: the orbit view draws ~725k triangles in ~300 terrain patches (the silhouette-aware split rounds the limb; it
fades out below ~a third of a radius of altitude, which halved the patch count of low views that had paid for it);
surface views 4.7–10M triangles incl. trees and ground cover, 3–4k draws; `render()` CPU 30–140 ms.

### Known gaps (phase 1, still open unless noted above)


- **Sim speed:** ≥ 1000 ticks/s holds only for idle/normal weather on one world; planet-wide heavy rain ~260
  ticks/s; multi-planet scenarios 280–415 ticks/s. 1000x is best effort (the HUD shows the achieved speed).
- **Sim model (SIM lane notes):** sea is a level-held reservoir (no currents/tides); snow melt runs in the hourly
  climate pass; a barren world takes ~10 game days to warm after air (rain on it before then falls as snow);
  freeform is the phase-1 subset; mods apply to the next world; the rewind ring holds ≤ 64 MB encoded plus one raw
  copy of the newest keyframe (a 7-world system therefore keeps ~9 of its 16 keyframes); the
  planet `kind` (palette) stays `barren` after the player terraforms it.
- **Clouds:** organised by the sim's weather (storm spirals, bands, towers) and temporally resolved, but the
  organisation is a density model around the sim's systems, not a fluid simulation; fast camera moves can show a
  frame of history lag at cloud edges. Low-sun cloud reddening is art-directed (extra extinction toward a low sun),
  because the cloud shell sits above a 3 km world's dense air.
- **Air:** optical depth is 1.75× Earth's with a thinner scattering layer (for real sunsets); aerial perspective
  from orbit is reduced to compensate, but orbit views are a little hazier than before.
- **Ground/water:** colour fields are relaxed one step over the cell graph, which softens but does not remove faint
  creases along 50 m sim-triangle edges on flat ground; sim rivers follow cell paths, so channels run straight for a
  few cells (waterlines are noise-broken and fade by depth, the channel itself is the sim's). Steep water sheets are
  drawn as cascades. Patch skirts can show as thin dark dashes for a frame or two while LOD streams in (a camera cut
  now builds up to 320 patches per frame for 4 frames).
- **Per-cell shapes that remain:** a single wet cell on flat ground (a rain pond, an oasis) still reads as a
  polygon with a few straight edges, and from orbit the Rust world's valley vegetation / water patches keep
  sim-triangle outlines: fields are interpolated linearly over sim triangles, and only the ground (and the water
  level between basins) is curved. The lookdev world has no sand sea, so its `desert` POI frames the barest sand
  pocket there is (inside woodland).
- **Lookdev generator (`?source=lookdev`, render-dev only):** its polar coasts step 40–60 m between neighbouring cells,
  so the snowy polar hills still make a jagged rim from orbit. The real sim's rim is smooth.
- **Vegetation:** trees shrink into the canopy layer per instance at the range edge (no dither); cactus, kelp,
  mangrove and willow use the generic forms; no seasonal leaf loss (autumn colour only). Ground cover is grass tufts
  and stones only (no flowers, driftwood or shells yet) within 34 m; it is off at `quality=low`.
- **Main thread:** an hourly update that changes every fast field costs ~21 ms (repack + curvature) on the frame it
  lands; it could move to the worker or be spread over frames.
- **Perf on real GPUs is unmeasured** (all frame times are SwiftShader). FXAA only (no SMAA/TAA). SSR reprojects the
  previous frame (one frame of lag, by design) and fades at screen edges; there are no planar reflections, so what is
  off screen is not reflected. No SSAO (contact darkening comes from crown depth, concavity and horizon occlusion).
- **Roads:** the field draws worn earth only; paved roads as ribbon meshes along the most-worn edges arrive with the
  peoples (phase 2), so the review's ribbon request is deferred, and the old area-fill cobbles are gone.
