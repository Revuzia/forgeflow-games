# GENESIS — ARC: hearts, the tower, defiance, the covenant, the Book of Ages (binding spec)

Lead designer, 2026-11-06. **This document is the spec the implementers build from.** It merges three designs
(`_harness/scratch/arc/design-systems.md` **SYS**, `design-player.md` **PLY**, `design-scripture.md` **SCR**) using the
three review judgements. Where those designs disagree, **this document decides**, and the decision is final for every
lane. The designs are kept for background only: a lane that finds a contradiction follows ARC.md and records it in its
ledger. It does not reopen the design.

The owner's request (2026-11-06, verbatim): *"does the game show moods of the people, if they fear, or are angry, or want
to rebel? they should be able to try to rebel and fight back - obviously they cant but im thinking tower of babel. I want
this to be like GENESIS in the torah if they rebel, or fight back, and gd intervenes etc. ... consider if this game has a
real purpose other than just allowing the player to blow things up or burn things"*. The approved plan: *"build all 5,
start with moods and the tower and do not stop until all of the options are done"*.

Clock (LIVING §1.1): 1 tick = 1 game minute. `x.day` = 1 440 ticks. `x.year` = 12 days = 17 280 ticks. A generation is
**25 years**. At 100x a year takes about 2.9 real minutes; at 300x about 58 s.

---------------------------------------------------------------------------------------------------------------------

## 0. Purpose, tone, rules

### 0.1 The purpose (the answer to the owner's last question)
**The game's purpose is the story a world tells about its god.** That story is written by what the god does and does
not do, and it is read back in the people's own words. Destruction is one sentence of the story, and it is remembered.
Patience, mercy, warning and a kept promise are other sentences, and they are remembered longer. The player makes
**the Book** (§5), a scripture of their people and their god. There are no points and no win state. The question the
player is left with moves from "what can I destroy" to "what kind of god have I been, and what will they say of me".

Two rules govern the whole arc:
1. **You notice it without clicking** (PLY). Every state in this arc has a near sign (body language), a mid sign (crowds,
   the town at dusk), a far sign (the glyph on the HUD name chip, the Hearts layer) and a chronicle line. Panels explain
   things, but they never carry the only signal.
2. **The god answers; the people remember. Nothing resets** (PLY). Every answer is a fact of the god's character (its
   epithets, §5.4) and moves the next generation's starting values (memory, §0.4). Memory fades over generations
   unless something keeps it alive (§0.4).

### 0.2 The arc is recognised, never scripted
The movements of Genesis (Making, a time of plenty with a near god, the first wrong, pride, flood and bow, tower and
scattering, the wanderers) are recognised by the age-namer (§5.2) **when the sim produces them**. Nothing forces them.
A world left alone gets quiet ages. A wrathful god gets flood after flood. A patient god may never see a tower struck.

### 0.3 Voice (binding on every new player-facing string: events.json additions, `data/scripture.json`, UI text)
1. Short declarative sentences, mostly under 18 words, with at most one comma clause. **Every line is at most 140
   characters** (a chronicle row at 888x500 wraps to two lines at about 140).
2. Concrete before abstract. Say what they did ("they threw stones at the storm"), not what it means ("they rebelled").
   Meaning belongs in the Book's character lines.
3. The player is **"the god"**: lower case, never named, never a title. Each tongue's own word for the god
   (`wordFor`, §6.6) may appear in italics as the people's word. Rival gods keep their invented names.
4. **No quoted or near-quoted scripture, and no archaic grammar.** Plain modern English with old rhythms (parataxis,
   repetition). The builders' intent is paraphrased. These forms are banned outright: "a tower whose top touches the
   sky", "let us build a tower to the heavens and make a name for ourselves" in quotation marks, "set my/your bow in the
   cloud(s)", "set a bow of colours", "let there be", "in the beginning", "be fruitful".
5. Invented proper names only (towns, people, tongues come from the sim). Real natural nouns are fine and preferred
   (starlings, a halo round the sun, cedar).
6. The people's point of view. The narrator never judges the player: no "cruel", "evil", "good god". Judgement belongs
   to the people ("they call it a punishment") and to the Book's character lines.
7. **Two readings for every sign**: the trusted reading where trust ≥ fear, else the feared one (the `OMENS[kind]
   .trusted / .feared` pattern of god/omens.ts).
8. Numbers in words up to twelve, digits above. Survivable wrath shows in the words: "the builders fled before it fell",
   not a toll, unless someone died (then the count, plainly, once).
9. **No slider numbers in sacred text.** A vow is "Always gentle", never "wrath ≤ 0.3".
10. The age kind for the time of plenty is internally `plenty`. Its names avoid "Garden" (§5.2).

**Banned words** (enforced by `tests/scripture_lint.test.ts`, §8.0). The check is case-insensitive and whole-word, and it
runs on **new text only**: events.json entries whose id starts with `heart.`, `tower.`, `defy.`, `covenant.`, `age.`,
`legend.`, `remember.`; all of `data/scripture.json`; and `query('story')` output on the test seeds. The list:
`babel, babylon, shinar, eden, adam, eve, noah, ararat, nimrod, abraham, abram, isaac, jacob, israel, moses, sinai,
canaan, egypt, jerusalem, yahweh, jehovah, elohim, adonai, allah, jesus, christ, satan, lucifer, genesis, thee, thou,
thy, thine, unto, begat, behold, smite, verily, hath, doth, garden`, plus the phrase list of rule 4. Also banned:
case-sensitive `God` used as a name in mid-sentence ("The god" at a sentence start is fine), and any `{placeholder}`
left unfilled. ("lord" is deliberately left off the list because existing rival epithets use it.) The internal id
`babel` (scenario, SFX cue) is code, not player text.

### 0.4 Memory: the shared model of consequence (SYS memory, SCR remembrance, PLY heritage merged into one)
`SettlementRel.memory = { wrath, patience, mercy, sign, humbled, betrayed, kept, proud }`. Each is a non-negative tally
(+1 per event unless stated otherwise). Its **weight** `w` is the stored tally itself. Decay is applied yearly in
`arcYearly` and is not recomputed:
- No keeper: every tally × `0.5^(1/25)` ≈ **0.9727 a year** (halves in a generation).
- **Landmark keeper:** while a struck tower's rubble, a scattered or abandoned tower's shell, or a sacred place made by
  an ARC event stands inside the town's territory (within 3 km of its centre), the tallies that event raised decay at
  **0.99 a year**. A tally raised by an event is linked through `ArcEvent.id` (§6.1).
- **Legend keeper** (stage C3, §5.6): a town's first retelling of an event restores that event's tally to
  `max(current, 0.6 × peak)`. **This happens once per event per town.** Later retellings change the text but do not
  refresh the tally, so memory slows down and still fades.
- **Daughters** (`Settlement.parent`, at founding) inherit `memory × 0.7`, `pride × 0.8`, `defiance × 0.5`. **Households
  that move** (the scattering, fearMigration, budding) carry `memory × 0.5` into the receiving town, merged by max.

What memory does. All of these are clamped biases on existing daily targets, and every one stays inside LIVING's
0.35-per-act rule:

| memory | effect |
|---|---|
| `wrath` w | newborn fear `+0.05 w` (cap +0.2); where trust < 0.3 the defiance target gets `+0.08 × min(1, w)` (bitterness); where trust ≥ 0.3 the pride target gets `−0.05 × min(1, w)` (humility) |
| `patience` w | defiance target `−0.04 × min(1, w)`; pride target `+0.03 × min(1, w)` (they take patience as permission) |
| `mercy` w | newborn trust `+0.05 w` (cap +0.2); defiance target `−0.10 × min(1, w)`; revolt needs fear > trust + 0.4 + 0.05 × min(1, w) |
| `sign` w | the 3-day "no sign of the god" before faith drifts becomes `3 + 2 × min(2, w)` days |
| `humbled` w | pride target `−0.25 × min(1, w)`; a tower leader needs pride ≥ `0.62 + 0.1 × min(1, w)` |
| `betrayed` w | trust ceiling `max(0.5, 0.9 − 0.2 w)` (continuous: the scar fades over generations, it does not vanish at a threshold); trust gains × `1 / (1 + w)` |
| `kept` w | trust floor `min(0.3, 0.1 w)`; prayer-lapse penalty × `1 / (1 + 0.5 w)` |
| `proud` w | pride target `+0.05 × min(1, w)`; faith target `−0.03 × min(1, w)` |

**The newborn hook lives in `god/regard.ts freshen()`** (regard.ts:119). That is where a new person's regard is seeded
from the town means. Add an optional `bias?: { fear: number; trust: number }` argument that `freshen` adds after
seeding, clamped to 0..1. Its callers pass `arcNewbornBias(x, st)` from arc.ts. No hook goes into demography.ts.

### 0.5 Owner rules this arc keeps (acceptance §8.7 checks each)
Survivable wrath by default (`WRATH_DEFAULT 0.3`). Real animals only. No creature. Nothing Black & White-like. The 21
authored .ogg files and **their stinger mappings are unchanged**: new events get **new SFX cues** through
`audio/eventmap.ts` and `audio/sfx.ts`, and no new event is routed to an authored stinger (`answered`, `wrath`, `sign`,
`fulfilled`). No quality preset value is lowered (the quality.ts diff may only add keys). Determinism: `hashFloat`
with a fresh salt for every roll, settlements in `ps.settlements` order, records sorted on save, no `Math.random`, no
`Date`, no Map-iteration order. The god's marks are light, never icons (render/signs/signs.ts): **people's signs are
poses, and town glyphs live on the DOM name chip, never in world space.**

### 0.6 Where the code lives
Sim: **`src/sim/god/arc.ts`** (hearts, pride, defiance, memory, covenant, the daily, hourly and yearly entry points),
**`src/sim/god/tower.ts`** (the tower and its commands), **`src/sim/god/story.ts`** (ages, annals, the story query,
Generations, epithets), **`src/sim/god/legends.ts`** (stage C3: legends and `wordFor`). Hooks go into
`god/relationship.ts` exactly where their siblings already sit:
`relationshipDaily` after `conversions`; `relationshipHourly` after `naturalOmens`; `afterAct` / `endAct` (acts);
`r.before` (the covenant pre-check); `relSnapPlanet` (views); `relQuery` + `REL_QUERIES` (queries).
Text: chronicle lines in `src/data/events.json` (the `tell` path); the Book, age names, character lines, captions and
memory phrases in **new `src/data/scripture.json`**. Tunables: one exported `ARC` object in arc.ts (pattern:
`POLITICS`, politics.ts:96), and every number in this spec marked *(ARC)* is a key in it.

---------------------------------------------------------------------------------------------------------------------

## 1. VISIBLE MOODS (stage A)

### 1.1 The per-person heart (derived; no new SoA column: flags2 is full, types.ts:274)
For a grown member `s` and god 0, `i = s*GODS`. `b` is the boldness trait and `mood = A.mood[s]`. The first rule that
holds wins:

| heart | rule |
|---|---|
| defiant | settlement `defiance ≥ 0.45` AND `b ≥ 0.5` AND `fear[i] < 0.7` AND `love[i] < 0.35` |
| fearful | `fear[i] ≥ 0.5` AND `fear[i] > love[i] + 0.1` |
| devoted | `faith[i] ≥ 0.5` AND `love[i] ≥ fear[i]` AND `loyalty[i] ≥ 0.35` |
| restless | `mood < 0.45` OR (`faith[i] < 0.35` AND `love[i] < 0.3` AND settlement `pride ≥ 0.5`) |
| quiet | otherwise |

Cohort members count at the cohort means (the way `meansNow` does, regard.ts:515).

### 1.2 The settlement heart (`heartsDaily(x, st)`, arc.ts; once a day per town that is neither a band nor fallen)
A single members pass computes hearts, pride inputs and dusk together (§2.1 and §3.1 share it):
- Shares over grown members: `devoted, fearful, restless, defiant` (they sum to at most 1; the rest are quiet).
- `kind` = the largest share if it is ≥ **0.30** *(ARC)*, else `'quiet'`. A new kind is **taken only after it has held
  3 consecutive days** (`pending`). `since` is the tick it was taken.
- **Pride is not a band.** `proud = pride ≥ 0.6` is a separate flag that is drawn as a rim or second mark (§1.4). This
  keeps a proud and fearful town from flipping between bands.
- **Dusk:** `dusk.today` = the share of grown members in `vespers.went` when the window closes (relationship.ts:505);
  `dusk.ema += (today − ema) / 12`. The flag `dusk.low` is set when `ema` falls below **0.25** from above **0.45**, and
  cleared when it climbs back above 0.45.
- Event `{ t: 'heart', planet, pos, ref, data: { settlement, from, to } }` on a kind change after hysteresis.
  Event `{ t: 'heart.proud', ... data: { settlement, proud } }` when the flag flips.

### 1.3 The per-agent sign (computed in `relSnapPlanet` per agent; no state)
`MoverBlock.heart[k]`, where the first rule that holds wins:

| value (`HeartSign`) | sign | when |
|---|---|---|
| 1 `pray` | praying | task is `TASK.pray`, `TASK.worship` or `TASK.pilgrimage` |
| 2 `fist` | raised fist | task is `TASK.defy`, OR (the person is defiant AND a god-0 storm, disaster or lightning is over the town now) |
| 3 `fear` | looking up in fear | the person is fearful AND (sheltering or evacuating, OR an omen or god act touched the town in the last 2 h, OR outdoors with the town's `kind = 'fearful'` and `hashFloat(id, hour, 0x4ea1) < 0.15`) |
| 4 `celebrate` | celebrating | `flags2 & festive`, OR the person is devoted AND a help act or answered prayer touched the town in the last 6 h |
| 5 `hurl` | throwing at the sky | task is `TASK.defy` with `tData = DEFY.hurl` |
| 0 | none | otherwise |

**No per-head mood motes.** (PLY's heart motes are cut: they read as a game-UI plumbob.) Poses and crowd knots carry
the signal near the camera, and the chip glyph and the Hearts layer carry it far away.

### 1.4 What the player sees
- **Near (≤ 28 m, `PEOPLE_NEAR`):** poses from the sign (render, §6.9): pray (existing `AnimState.pray` 5), cheer
  (existing 21), and the new `lookUp` 40, `fist` 41, `hurl` 42, `curse` 43. Work tasks keep their own animation; a sign
  pose applies only when the person is idle, walking, socialising or on `TASK.defy`.
- **Mid:** crowds. At dusk the vespers walk to the shrine either happens or does not. A defiant town's curse gathering
  (§3.2) is a knot of 4-12 people in the open with fists raised.
- **Far:** the **heart glyph** on the town's DOM name chip in the HUD, after the prayer lamp. SVG icons in ui/icons.ts:
  `heart-devoted` (raised open hands), `heart-fearful` (an eye looking up), `heart-restless` (a wavy murmur line),
  `heart-defiant` (a fist), plus a small **stepped-tower mark** after it when `proud`. The glyph is 11 px at 888x500 and
  is shown only when `kind ≠ 'quiet'` (or when proud). Its title tooltip is the caption ("Aru: they watch the sky"). On a
  new defiant act (`SettlementView.defiant` ≤ 2 days old) the fist glyph pulses for 10 s real time.
- **The Hearts map layer** (ui/overlays.ts LAYERS): `{ id: 'hearts', label: 'Hearts', icon: 'heart', fields:
  ['territory'], live: true }`. A categorical territory fill by `kind`: devoted warm gold, fearful cold violet, restless
  ochre, defiant crimson, quiet unshaded. Alpha is `0.35 + 0.5 × share`. **Proud adds a thin bright rim.** Every palette,
  colour-blind ones included, gets distinct hues from the overlay's palette table. The legend uses the captions, not ids.
  Hover text is in words, never raw numbers: "Aru · They watch the sky (about half) · proud · 9 of 40 came at dusk".
- **Captions** (scripture.json `caption.*`): devoted "They bow at dusk" · fearful "They watch the sky" · restless "They
  murmur" · defiant "They raise their fists" · proud "They boast" · quiet "They go about their days".
- **Inspector, person** (ui/inspector.ts:452-468): a one-line caption above the Mood/Trust/Fear bars, in words: "Hesh
  raises a fist at the sky" / "Hesh is afraid of the sky" / "Hesh loves the god" / "Hesh murmurs against the god" /
  "Hesh goes about the day". The agent detail query (people/query.ts) adds `heart: HeartKind`.
- **Inspector, settlement:** a "Hearts" section. The caption and share in words ("They watch the sky: about half"), four
  share bars Devoted / Afraid / Restless / Defiant, `Pride` and `Defiance` bars (classes `gn-pride`, `gn-defy`) with
  `prideWhy` as words on hover ("rich, long unpunished, little faith"), "At dusk: 9 of 40 at the shrine (a year ago,
  24)", "They call the god *Ashenu*" (stage C3, else omitted), and "They remember: the fallen tower · the rain after the
  stones" (≤ 3 phrases from memory weights ≥ 0.3, scripture.json `remember.*`).

### 1.5 Chronicle lines (events.json, kind `god`, weight 1 unless noted; each id at most once per town per 2 years, through `told`)
| id | when | variants |
|---|---|---|
| `heart.nobow` | `dusk.low` set | "In {settlement} they no longer bow at dusk." / "The shrine of {settlement} stands empty at evening." |
| `heart.bowagain` | `dusk.low` cleared | "At dusk in {settlement} they bow again." |
| `heart.fearful` | kind becomes fearful | "In {settlement} they watch the sky and speak quietly." / "{settlement} goes about its work with one eye on the clouds." |
| `heart.restless` | kind becomes restless | "In {settlement} they murmur against the god." / "There is grumbling in {settlement}: what has the god done for us?" |
| `heart.defiant` (w2) | kind becomes defiant | "In {settlement} they raise their fists at the sky." |
| `heart.devoted` | kind becomes devoted from fearful, restless or defiant | "{settlement} has turned its face to the god again." |
| `heart.proud` | proud flag set | "In {settlement} they say they need no god." / "{settlement} boasts of its walls and its granaries." |
| `heart.cowed` (w2) | kind goes from defiant to fearful within 10 days of a god-0 harm | "{settlement} put down its stones." |

### 1.6 Audio (new SFX cues only)
`heart` with `to = defiant` → new cue `crowd.jeer` (news, gain 0.45, gap 6). `to = devoted` → new cue `crowd.hymn`
(news, 0.4, gap 6). Every other kind and `heart.proud` → `null` (they are frequent and silent).

---------------------------------------------------------------------------------------------------------------------

## 2. PRIDE AND THE TOWER (stage A)

### 2.1 Pride (per settlement, daily, in the shared members pass)
Parts, each 0..1, written to `prideWhy`:
- **P prosperity** = `clamp((q − 2) / 4)`, where `q` is the mean of `st.age.hist[k][2]` (the prosperity samples
  `agesDaily` already keeps, chronicle.ts:209).
- **T technology** = `clamp((eraIdx − 1) / 3)` with `ERAS` (content.ts:209): stone/fire 0, clay 0.33, bronze 0.67,
  iron and later 1.
- **U unity** = `clamp((k − 1) / 3) × (1 − grievance)`, where `k` counts the towns of the same species within 15 km with
  `langDistance ≤ 0.45`, itself included, and `grievance = st.hist?.grievance ?? 0`.
- **L long unpunished** = `clamp(yrs / 15)`, where `yrs = (tick − r.lastHarm) / year`. **`r.lastHarm` is a persistent
  tick** written at `endAct` for every god-0 harm on the town (fix a; `r.acts` is capped at 12, regard.ts:225, and must
  not be used for this). If the town was never harmed, the count starts from `r.since.arc0` (its founding tick, or the
  load tick for a migrated save).
- **F unbelief** = `1 − means[0]`. (Owner ruling 2026-11-08: "its not about g-d being kind or unkind. he is just. they act, the player reacts." Pride comes from the people's own state; the god's kindness neither feeds nor prevents it. The r1 'chosen' term is removed.)

`target = clamp(0.22 P + 0.18 T + 0.18 U + 0.22 L + 0.20 F − 0.6 × max(0, fear − 0.3) + memory biases (§0.4))`. The
target is 0 when population < 40. `pride += (target − pride) × 0.02` a day (half-life ≈ 35 days ≈ 3 years).
**Clamp:** the tower's builder boost (§2.4) cannot lift pride above `target + 0.15`.

Sanity values (they are tests, §8.2): year 2, stone age, unharmed, faith 0.5 → **0.20 ± 0.03**. Year 30, bronze, 3 kin
towns, never harmed, faith 0.3 → **0.73 ± 0.03**. Harmed last year with fear 0.6 → **0.37 ± 0.03**.

### 2.2 When they build (`towerYearly`, tower.ts: one check per planet per year, on year-day `hash32(planet.id) % 12`, plus a daily check while the trigger is armed)
Every condition must hold:
1. World age ≥ **10 years** *(ARC `towerMinYear`)*, counted from the planet's first settlement. No tower on the planet is
   `rising`, and ≥ **20 years** *(ARC)* have passed since the last tower on this planet ended (a finished or standing
   tower counts as ended at its finish).
2. A **leader** town: not a band, pride ≥ **0.62** (+ humbled bias, §0.4), population ≥ **50** (was 60; stint-5 probe: the
   proud towns of unattended worlds peak at 47-56 people), era ≥ clay, knows
   `mudbrick`, `bricks` or `masonry`, not at war, no famine (`hist.famine < 0`), and no god-0 harm on it in the last
   **2 years** (`lastHarm`).
3. A **builders' league**: ≥ 2 towns (the leader included) of its species within 12 km, each with pride ≥ **0.50** and
   `langDistance ≤ 0.45` to the leader ("one speech"). A kin village below the pride floor (population < 40, whose
   pride target is 0 by §2.1) joins without the pride test when the leader qualifies: the villages follow the city
   (stint-4 change, measured: unattended daughters stay under 40, so no league ever formed). At most 6 towns join,
   nearest first.
4. The roll `hashFloat(planet.id, year, 0x70e1, worldSeed) < ARC.towerChance × clamp((pride_leader − 0.6) / 0.3)`, with
   **`ARC.towerChance = 0.25`** (probe-tuned in stint 5 within 0.06-0.30; the world seed was added because every
   sandbox world's first planet has the same id, so all seeds rolled the same years).

The `tower.begin { settlement }` debug command (§6.4) skips 1, 3 and 4 (it still needs ≥ 1 town and a site) and forms
the league from towns within 12 km.

### 2.3 The tower record and its labour
State is `TowerState` (§6.1). The site is the flattest land cell 300-1 500 m from the host centre toward the league
centroid, with no building within 60 m and slope < 0.08 (lowest slope wins; ties go to the lower cell id). Its name is
"the Tower of {placeRoot(host tongue)}" (names.ts placeRoot), e.g. "the Tower of Kel-Amar". The goal height depends on
the era: clay 60 m, bronze 80 m, iron/classical 100 m, medieval and later 120 m. The tower has 12 m tiers, at most 10:
`tiers = floor(height / 12) + 1`.

**A building record gives the labour a target** (fixes SYS's flaw: `work.ts` build resolves `ps.building(tTarget)`).
Append a new building `great-tower` at the end of `data/buildings.json`: function `wonder`, `footprint 14` (a radius in
metres: the tower's core blocks pathing at the site; the ramp and courtyard stay walkable), capacity 0, storage 0,
materials `["mudbrick","bricks","stone"]`, recipe `mudbrick`, cost 0 (the tower draws material daily, see below), `work`
1e9 (it is never "finished" by the building path), hp 2000, decay 0, height 0 (**render draws it from `TowerView`, and
the BuildingBlock renderer must skip `great-tower`**), era clay. Placing it at `tower.begun` goes through the building
store directly at the chosen cell (not the placer), and `TowerState.building` holds its id.

Daily (`towerDaily`): builders `B = Σ over league towns of max(4, round(0.06 × grown_t))` (the least crew was 2 until
stint 5: unattended towns of ~50 sent 2 each and a league of two took 8 years to reach half its goal, T4). Each builder-day takes 1 unit
of the tower's material from the host store. League towns send tribute to the host store at the same rate (store
transfers, no haul agents). Without material the rate halves, except that builders who know `mudbrick` mould what the stores lack at the tower's
foot (stint-5 change: no unattended store ever held tower material, so every tower rose at half rate and missed T4). Growth is `dh = 0.12 × B × (have ? 1 : 0.5) / (1 + height
/ goal)` m/day: 3 towns of ~80 (B ≈ 12) raise an 80 m tower in about 6 years, and 6 towns in about 3. **Visible
builders:** up to **12** host members per work period get `TASK.build` with `tTarget = TowerState.building` (a relDecide
hook, the same TaskSpec path relDecide uses for worship, relationship.ts:262). The rest of `B` is counted, not walked.

While the tower is rising, in league towns: pride +0.002/day (with the §2.1 clamp); faith toward god 0 −0.0015/day;
prayer utility × 0.7; vespers attendance × 0.8.
**One speech** (SCR): every 2 years, each league town's `langLine` tail converges to the host's. The last element is set
equal to the host's last element and `langLine[0]` is never touched. The aim is that the league's pairwise
`langDistance` is **≤ 0.18 after 2 years of building**, so the confusion is a visible reversal. Also while rising:
`hist.why.tongue` and grievance between league kin −0.001/day.

Organic end: hardship `h ≥ 0.6` in the host for 10 days → a 50 % roll (`0x70e2`) abandons it. The host falling, or the
league shrinking to 1 town, also abandons it.

Omens: at 25 %, 50 % and 75 % of `goal`, a natural omen at the tower through the omens.ts path (`god: -1`). It is picked
by fit: a murmuration of starlings circling the tower and not landing (always fits), a halo round the sun (daylight), or
lightning on the scaffold during a storm (needs a storm; no damage). Each omen carries both readings (§2.7).

### 2.4 The god's answers (commands in category `Signs`; `tower` defaults to the planet's rising or standing tower)
Each answer is given once per tower, except that **strike** or **confuse** may follow `warn` (refused) or `let` /
silence on a standing tower. Every answer pushes an `ArcEvent` (§6.1) and the memory named here.

| answer | effect | lasting |
|---|---|---|
| **Confuse their tongues** `tower.confuse` | For each league town, k = 0, 1: `langSeed = driftLanguage(langSeed, st.id ^ hash32(tick, k))`, then `language = langSeed` (fix e). `langLine` gets the two new drifts appended, and is then trimmed **keeping `langLine[0]`**: `langLine = [line[0], ...line.slice(1).concat(d1, d2).slice(-11)]`. **Two drifts, not a new root**, so pairwise distance between former kin is ≥ **0.72** and kinship stays traceable for the Generations prose (the judges split 2-1; this document decides two drifts). Existing towns keep their names (`recent.keepName`). New daughter towns take names from the new tongue, and `styleVariant` follows `langSeed`/`language` (culture.ts:430), so **their houses look different from then on**. Polity opinions between league polities −0.25. Inside one polity: `hist.why.tongue += 0.25` and grievance +0.15. **The scattering:** each league town sends 20-35 % of its households (`0x70e3`) out, to found daughter towns ≥ 4 km away through the existing budding path where land allows, else to `moveHousehold` to the nearest town of another tongue line. Status becomes `scattered`, work stops, and the tower stays at its height and weathers. Regard is a wonder-kind act with no deaths: faith +0.15, fear +0.10, trust −0.05. Pride × 0.4. | `memory.humbled += 1`. The shell is a landmark. Age "The Scattering at {host}". The per-pair "they no longer know" line (§2.7). |
| **Strike it down** `tower.strike { wrath?, covenant? }` (in `WRATHFUL`) | A harm act at the tower, wrath-scaled like any WRATHFUL cast. The top `ceil(tiers × (0.4 + 0.6 w))` tiers fall. Deaths among builders on site = `round(lethality(w) × onSite × 0.5)`, which is survivable at the default 0.3. If a prophet warned (`warned`) and was refused, the act is foretold **and** provoked (trust −0.05 instead of −0.20). Builders flee first if foretold. Pride × 0.5. Where trust < 0.3 and fear < 0.5: defiance +0.2, and a **rebuild** roll each year for 10 years (`0x70e4`, chance 0.15 while pride ≥ 0.6) that starts a new tower with `rebuildOf` on the same site. Status becomes `struck`. | `memory.wrath += 1`. The rubble mound never clears (landmark). Age "The Fall of the Tower of {host}". |
| **Send a prophet to warn** `tower.warn { agent? }` | Uses `agent`, else the god's prophet in a league town. If there is neither, it fails with: "No prophet speaks for you among the builders. Call one first ('make Hesh my prophet')." The prophet preaches at the site for 5 days (TASK.preach). On day 5 each league town rolls `heed = clamp(0.1 + cred × (0.4 + faith₀) − 0.15 pride + 0.3 fear + 0.1 trust + 0.15 × refusals, 0.05, 0.9)` (`0x70e5`, world-seeded; faith₀ = faith before the tower's own drain, refusals = warnings this town refused before; r1 change: at 0.6 pride the roll sat at its floor on every babel seed). If the host heeds, or fewer than two towns are left building, the league is broken and that counts as every town heeding. A heeding town leaves the league: pride −0.25, faith +0.10, trust +0.05, loyalty +0.05, `memory.patience += 1`. A refusing town gets defiance +0.1, and with a `pride` chance the prophet is persecuted (existing `silenced`). If every town heeds, the tower is `abandoned`, and **the unfinished tower becomes a sacred place** (sacred.ts site, "where {prophet} spoke"; a landmark). It counts as a prophecy for credibility (+0.1 per heeding town, −0.05 if none heed). A later strike counts as foretold. If refused, the card reopens with *warn* disabled for 1 year. | Age "The Warning at {host}" when any town heeds. |
| **Let it stand** `tower.let` | The god's word is known: trust +0.05, read as favour. The tower runs to `goal`, becomes `finished`, and a fire burns on top every night. While it stands (and the league's pride ≥ 0.6): league faith drifts an extra −0.3 %/day (capped at −0.25 in total), the loyalty target × 0.8, and the rival-conversion threshold −0.05. Also: **grievance between league towns is halved at once and their secession pressure is reduced** (`hist.why.tongue × 0.5`; fix f: **there is no polity merge**), discovery rate +5 % in league towns, and the golden-age check uses q − 0.5. Later prophets in the league start with credibility −0.1. The god can still answer later: strike and confuse stay available on a standing tower (the tower's inspector card reopens the Decision card). | `memory.proud += 1`. Age "The Age of the Tower of {host}". |
| **Silence** (no answer by `finished`) | As `let`, but `answer: 'none'` and faith −0.05 at completion. Chronicled as an answer ("The god did not answer, and the tower of {host} stood.") and counted in `godActs.silence`. | `memory.proud += 1`. |

Every `tower.*` command fails cleanly when there is no tower to answer: "Nobody is building a tower on this world."

### 2.5 The Decision card (ui/decision.ts, new; reused by §4) — the one canonical placement and timing
- **Placement:** top-centre, 380 px wide, at most 186 px tall (was 170: the four answers need two lines of words
  each at 888x500), under the HUD's top row. It never covers the time controls, the selection or the inspector: with
  the inspector open it sits left, under the time panel; when the news column (bottom-left toasts) would meet it, it
  steps right of the news if it fits, else the news column yields its top to it (the newest news stays). It is **not modal**: the world keeps running and stays clickable.
- **Timing (canonical):** first offered when the tower reaches **25 % of `goal`** (event `tower.choice`; at 100x this is
  about 4-7 real minutes after `tower.begun`). Offered again **once at 75 %** if it is still unanswered. No card appears
  at `tower.begun` (only a toast with "Look at it", because there is nothing to see yet).
- **"Slow down for great moments"** (settings, default on): when a Decision card opens with the sim faster than 30x,
  the speed eases to 10x. The previous speed is restored on answer or "Decide later".
- **"Decide later"** or Esc collapses the card to a **HUD pill** (top-centre under the HUD's top row, where the card
  was: at 888x500 the time panel is at the far left, so nothing fits left of it) ("The tower at Kel-Amar" /
  "A vow to Aru?"). The pill reopens the card and lasts until the choice expires (tower finished; offer closed).
- **Keys 1-4** choose while the card has focus. Each button sends its command. The result toast echoes the outcome.
- **Content** (the tower):
  > **A tower rises at Kel-Amar** · year 2 of the work · 38 m of about 80 · three towns of one speech
  > The towns say they want it seen from everywhere, and their name never forgotten.
  > [1] **Confuse their tongues**: they will scatter, and speak apart for generations.
  > [2] **Strike it down**: they will fear you; some will hate you.
  > [3] **Send a prophet to warn them**: they may listen. (shows the prophet's name; disabled with a reason)
  > [4] **Let it stand**: they will be great, and need you less.
  > [Look at it] [Decide later]
- The tower's inspector card (picking the tower): name, height and goal, tiers, builders today, league towns with each
  town's pride in words, years building, material, the answer so far, and the same buttons while it can be answered.

### 2.6 Render, audio
- Render (`src/render/life/tower.ts`, new; data from `PlanetSnap.towers`): a stepped ziggurat with `tiers` blocks of
  12 m, each set back × 0.82, and a ramp stair on one face. It uses meshkit with the material's existing building
  texture (buildingmat.ts) and **the host's culture style variant**, so it reads as theirs and real. While `rising`:
  timber scaffold and ladders round the top tier, a partial top tier (`height mod 12`), brick piles at the foot, dust
  within `particleBudget`, and the real builders. `struck`: the fallen tiers as a rubble mound around the base,
  scorched, with a one-time collapse effect within `particleBudget`. `scattered` / `abandoned`: no scaffold, the top
  tier crumbled, and a weathering term that grows with years since `ended`. `finished`: a top fire at night (the
  existing night-lights path). **Geometry is identical at every preset** (one mesh per tower). Shadows, particles and
  SSAO follow the preset. Materials are warmed behind the loading screen (**no shader compile after t=0**, the macfix
  rule). At orbit it is a speck with its shadow, with no beacon.
- **Confusion effect:** a ring of hue-shifting light spreading 8 km from the tower (a decal like the omen ring,
  signs.ts), and the towns' building tint easing to their new style variant over 2 game days.
- Audio (new SFX cues): `tower.begun` → `toil.drums` (news, 0.5, gap 30); `tower.tier` → `toil.chant` (news, 0.4, gap
  30); `tower.choice` → `ui.great` (a soft gong, new); `tower.confused` → **`babel.babble`** (god, 0.8: 6-10 voice
  grains, pitch-scattered apart over 4 s, voices.ts formants, synth only); `tower.struck` → `masonry.collapse` (new),
  layered on the dispatched miracle's own cue; `tower.finished` → `crowd.cheer`; `tower.warned` → `null` (the prophet's
  existing cues play).

### 2.7 Chronicle (events.json, kind `god`, weight 3 unless noted)
- `tower.begun`: "The towns of {league} came together at {host} and began a tower. 'Let it reach the sky,' they said,
  'and let our name last.'" / "At {host} the people of {count} towns laid the first course of a tower, to be seen from
  everywhere." / "'We will build so high the god will have to look at us,' said {agent} of {host}, and the towns began."
- `tower.tier` (w1, at 25/50/75 %): "The tower of {host} rose past the height of the tallest tree." / "The tower of
  {host} could be seen from {other}." / "At evening the tower's shadow covered all of {host}."
- `tower.omen` (w1): "Birds circled the tower of {host} and would not land. In {settlement} they called it {reading}."
  Readings (trusted / feared): starlings "a sign to stop" / "a sign the god is watching"; halo "the god sees them" /
  "the god's eye is on them"; scaffold lightning "a warning" / "the god's anger is near".
- `tower.warned` (w2): "{prophet} stood at the foot of the tower and told the builders to go home."
  `tower.heeded` (w2): "{prophet} spoke for five days. On the sixth the builders of {settlement} went home."
  `tower.refused` (w2): "They laughed at {prophet} at {host}, and the work went on."
- `tower.confused`: "At {host} the builders could not understand each other. They put down their tools and went home,
  each to its own tongue." / "Overnight the speech of {league} came apart. The tower stood, and no one climbed it."
  Then **once per formerly kin pair** (stage A says it with tongue names; stage C3 upgrades it to `wordFor`):
  `tower.apart` (w2) "In {a} the tower is *{wordA}*; in {b} it is *{wordB}*. They no longer know they mean the same
  thing." (Stage A fallback: "{a} and {b} no longer understand each other.")
- `tower.struck`: at 0 dead "Fire came down on the tower of {host}. The builders fled before it fell." / with dead "The
  tower of {host} fell, and {dead} died beneath it." Where trust < 0.3 it adds "They swore they would build again."
  `tower.rebuilt` (w2): "They built again at {host}, on the stones of the first."
- `tower.finished`: "The tower of {host} was finished. Its fire burned every night, and the god let it stand." /
  silence: "The tower of {host} was finished. The god did not answer."
- `tower.abandoned` (w2): "Hunger came to {host}, and the tower was left unfinished."

---------------------------------------------------------------------------------------------------------------------

## 3. OPEN DEFIANCE (stage B)

### 3.1 Defiance (per settlement, daily, in the shared pass)
`r.harmLoad` is a **persistent decaying tally** (fix a). At `endAct`, for every god-0 harm on the town:
`harmLoad += w_k × (1 + dead / 10)`, where `w_k` is 1 unprovoked and 0.5 provoked or foretold. Each day `harmLoad ×=
0.5^(1/12)` (it halves in a year). `load = min(1, harmLoad / 3)`.
`target = clamp(0.6 load + 0.4 pride − 0.5 trust − 0.8 × max(0, fear − 0.6) + 0.08 × min(lapses, 3) / 3 + memory biases
(§0.4))`, and `defiance += (target − defiance) × 0.03` a day.
**Terror suppresses** (at fear 0.85 the term is −0.2): a crushed people cowers (fearful), and a proud, wronged people
defies. After any harm on the town with trust < 0.4: `defiance += 0.1 × (1 − fear)` at once.

### 3.2 Their acts (one roll per town per day per kind; `DEFY` ids, each kind with its own cooldown in `defied`)
The rolls are `hashFloat(st.id, day, 0xdef1..0xdef4) < 0.25 × (defiance − threshold) / (1 − threshold) + 0.1`.
Escalation: `burn` and `idol` need a `curse` or `hurl` in the last 2 years.

| kind | condition | what happens (futile, visible) | cooldown |
|---|---|---|---|
| `curse` (DEFY 1) | defiance ≥ 0.45, at the dusk window | defiant members skip vespers. Up to 12 gather in the open facing the last harm or the storm, with `TASK.defy` (`tData` 1) for 30-60 min: `fist` / `curse` poses | 3 days |
| `hurl` (DEFY 2) | defiance ≥ 0.45 AND a god-0 storm, disaster or lightning over or within 1 km of the territory (an hourly check during the act) | up to **8** grown members with boldness ≥ 0.6 get `TASK.defy` (`tData` 2) for 20-40 min. They walk out under the sky and throw stones and spears upward. **The projectiles are render-only** (fix c: never god/projectiles.ts). No effect on the storm. They are exposed: the storm's normal harm applies to people outdoors. | 1 day |
| `burn` (DEFY 3) | defiance ≥ 0.70 AND trust < 0.15 AND fear < 0.6 AND the town has a god-0 shrine or temple | they set fire to it through the **people's** fire path (`fire.ignite` at the building, only its footprint). It is not a god act and has no regard deltas. The worship place is lost. | 2 years |
| `idol` (DEFY 4) | defiance ≥ 0.60 AND faith < 0.35 | if a rival god holds faith ≥ 0.2 here, its faith +0.1 (rivals.ts). Otherwise they raise an **idol**: a new building `idol` appended to buildings.json (function `idol`, footprint 1, height 3, materials wood/fieldstone/stone, work 200, era stone; a carved standing post or stone of their own design, never a creature). While it stands: loyalty target × 0.8, the rival-conversion threshold −0.05, and its prayers lapse (told once). At most one idol per town (`r.idol`). | 3 years |
| cast out | the existing revolt (relationship.ts:542), unchanged; it now also adds defiance +0.1 | — | — |

Event `{ t: 'defy', planet, pos, ref, data: { settlement, kind: 'curse'|'hurl'|'burn'|'idol', count } }`. Each act opens
`r.answer = { tick, kind }` (the window for §3.3).

### 3.3 How the god answers: classified from the god's deeds (no button menu)
The **first** god-0 act on the town within **10 days** of the open defiant act classifies the answer. If there is none,
the answer is patience at day 10. Each answer: `memory.<answer> += 1`, `godActs[planet].<answer> += 1`, an `ArcEvent`
(kind `answer`), event `{ t: 'defy.answered', data: { settlement, how } }`, and `r.answer` closes.

| answer | read when | effect now |
|---|---|---|
| **wrath** | any god-0 harm on it | **The harm counts as it is** (unprovoked stays unprovoked: trust −0.20; defiance does not make harm "provoked", so punishment is never cheap in trust). There is no instant defiance cut: the act's fear rise feeds the terror term in §3.1, so a people pushed past fear 0.6 cowers on its own (`heart.cowed`). Where trust < 0.2 and pride > 0.5: defiance +0.1 (martyrs). `memory.wrath` raises the next generation's defiance where trust is low (§0.4). |
| **mercy** | a help act on it (the mercy rule, LIVING §3.1) | trust gain × 1.5, defiance −0.2, fear −0.05 |
| **sign** | a wonder or omen with no harm, or a prophet's word there | faith +0.10, fear +0.05, defiance −0.1 |
| **patience** | no god-0 act on it for 10 days | defiance −0.05, trust +0.02. If there is still no god-0 harm on the town a year after the act: trust +0.05, and defiance decays twice as fast for a year (`defy.patience` line). |

The command **`defiance.answer { settlement, how }`** performs the canonical act for free text and tests: wrath sends
`miracle.lightning` beside (not on) the crowd, idol or burned shrine (the wrath slider applies; survivable); mercy sends
a gift of food (gifts.ts); sign sends `god.omen` (the kind chosen by the omens.ts fit); patience records
`r.since.patience = tick` and does nothing else. **The UI never shows an answer menu.** The first act of each kind per
town raises a toast in the voice ("In Aru they are throwing stones at your storm") whose only button is "Look".

### 3.4 Views, UI, render, audio
- `SettlementView.defiant?: { kind, tick }` (the latest act, ≤ 2 days old); `SettlementView.heart.defiance`.
- The settlement inspector's "What the god answered" line, in words from memory: "struck twice, shown mercy once".
- Render: `hurl` arcs are instanced pebbles or short spears on ballistic arcs from the hands, rising 15-25 m and
  falling back short. They are **render-only**, driven by `MoverBlock.heart == 5` and the agent's position. At most
  **64** are in flight per view, within the preset's existing `particleBudget`, and they never add a pass. The poses are
  `fist`, `curse` and `hurl`. The burning shrine is the existing fire. The idol is a buildinggen post (a carved standing
  stone or wooden post, 3 m, coloured by the culture style).
- Audio: `defy` → new cue `crowd.shout` (news, 0.5, gap 8, variant = kind); `burn` also gets the existing fire cue
  through the fire event; `idol` → new cue `stone.knock` (news, 0.35, gap 20); `defy.answered` → `null`.

### 3.5 Chronicle (kind `god`)
- `defy.curse` (w1): "At dusk in {settlement} they cursed the sky." / "The people of {settlement} stood in the rain and
  shouted at the clouds."
- `defy.hurl` (w2): "In {settlement} they threw stones at the storm. The stones fell back on their fields." / "{agent}
  of {settlement} threw a spear at the lightning, and it came down in the river."
- `defy.burn` (w3): "{settlement} burned the god's shrine." / "The shrine of {settlement} burned, and no one carried
  water."
- `defy.idol` (w2): "{settlement} carved a god of its own and set it in the square." Once, on lapses: `defy.idolmute`
  (w1) "Three prayers to the carved god of {settlement}, and nothing came."
- `defy.idoldown` (w2, the idol razed when the heart turns devoted): "{settlement} threw down its carved god and swept the
  old shrine."
- Answers: `defy.mercy` (w2) "They threw stones, and the god sent rain on {settlement}." (the help's own noun:
  rain/bread/healing) · `defy.wrath` (w2) "The god answered the stones of {settlement} with fire." · `defy.sign` (w1)
  "{omen} over {settlement}, the morning after the stones." · `defy.patience` (w2) "The god bore the anger of
  {settlement} for a year and did not strike." · silence at 10 days (w1) "The sky did not answer {settlement}."

---------------------------------------------------------------------------------------------------------------------

## 4. COVENANT (stage C)

### 4.1 A great destruction (one set of thresholds, canonical)
`ActCtx` gains **`ruined: Record<string, number>`** (fix b): buildings brought to 0 hp per settlement key
(`"<planet>:<sid>"`). It is recorded in harm.ts wherever a building is ruined inside an act's context, beside `dead`.
At `endAct` (regard.ts:198, when an act's whole life closes; disasters merge their records by `key`), an act is
**great** if any one of these holds:
- it killed ≥ **20** people on one planet; or
- it killed ≥ **25 %** of a town's population **and** ≥ **8** people (an absolute floor: a lightning bolt killing three
  in a hamlet is not great); or
- it ruined ≥ **40 %** of a town's buildings **and** ≥ **5** buildings.
For a god act (`god == 0`) this pushes an offer `{ id, planet, act: key, kind, name, settlements: [survivor towns it
touched, sorted], dead, household?, until: tick + 1 year }`. At most one offer is open per planet (a newer one replaces
it), and event `covenant.offered` fires **1-3 days later** (after the funerals; `0xc0e2`). A natural great disaster
(`god: -1`) also opens an offer, at most once per 30 years per planet. Its wording carries the people's reading: "The
survivors of {name} look to the sky, whoever sent it."
**The surviving household** (SCR, simplified: no bearer tracking): in the worst-hit town, the household with the most
living members who were inside the act's radius (ties go to the lowest household id). Its name (`clanOf`) is stored
with the offer and the covenant, and the chronicle and the Book mention it. No arrays of descendants are kept.

### 4.2 Making it
**`covenant.make { vow: 'no-flood'|'spare-the-many'|'gentle'|'warn-first', offer?: int }`** (category `Signs`). Without
an open offer it fails: "There is no one to make a covenant with: a covenant follows a great destruction."
`covenant.decline {}` closes the offer (`ArcEvent` kind `answer`, god `none`; chronicled as silence).

| vow | in words (UI, chronicle) | the god binds itself to |
|---|---|---|
| `no-flood` | "Never again by water" | no flood, tsunami, tidal wave or rogue wave from `disaster.spawn`; no painted storm that kills by flood |
| `spare-the-many` | "Never again so many" | never kill more than 10 in one act |
| `gentle` | "Always gentle" | never cast harm above wrath 0.3 (the `god.wrath` law and the per-cast `wrath`) |
| `warn-first` | "Always warn first" | never strike a covenant town unwarned: every harm on it foretold (an omen ≤ 2 days before, or a prophet's prophecy) |

One kept covenant per planet at a time. At making, every covenant town (within the 0.35 rule): trust +0.15, fear −0.10,
faith +0.10, loyalty +0.05. **"Once broken, twice doubted":** if `godActs[planet].broken > 0`, these gains are halved.
The offer closes. While kept: prayer-lapse penalties × 0.5; fearMigration needs 5 days, not 3; `memory.kept += 0.1` per
kept year; chronicle at 10, 25, 50 and 100 years.
**Natural doubt:** a natural flood (god −1) that kills in a `no-flood` covenant town is not a break, but it costs trust
−0.05 there, with the line "{settlement} asks why the god let the waters rise."

### 4.3 The sign: a real, scheduled rainbow (SCR; the owner's real-phenomena rule)
At making, the sim **schedules** the bow (`Covenant.signAt`): the first hour within the next game day when the sun
stands **5°-40°** above the horizon over the covenant towns' centroid. At that hour it paints a light passing shower and
then the existing `rainbow` weather over each covenant town (the weather the rainbow omen uses, omens.ts:61). The
physical rainbow render (render/fx/rainbow.ts) then draws a true antisolar bow. **There is no covenant-scale or
simultaneous omen rainbow.** The `covenant.made` chronicle line is written **when the bow appears** (event `covenant.bow`),
not at the command. Afterwards, after each daylight rain over a covenant town with the sun at 5°-40°, there is a 30 %
chance (`0xc0e1`) of a natural rainbow, read as the remembered promise: faith +0.02, trust +0.01, at most once per 10
days per town. After a break it reads as a reproach (fear +0.01 instead).
**The gathering:** at the bow, the survivors who are outdoors and within 300 m of the town centre get `TASK.gather` (new
`GATHER_KIND` value `covenant`, appended) for 1 game hour, looking up (`lookUp` pose), then kneeling (`pray`).

### 4.4 Keeping and breaking
- **Pre-check** (`r.before`, relationship.ts:95): a harmful command (the `WRATHFUL` set plus `disaster.spawn`) that would
  plainly break the vow (a flood kind under `no-flood`, `wrath > 0.3` under `gentle`, no omen or prophecy on the target
  town under `warn-first`, an estimated toll > 10 under `spare-the-many` when the estimate is available) is **refused**.
  The result is `{ ok: false, msg, refusal: { kind: 'covenant', covenant: id, vow } }`, with the msg "You promised the
  people of Aru never again to destroy by water. To break your promise, say so: '…, and break my covenant'."
- Every WRATHFUL command gets the param **`covenant: { type: 'enum', values: ['keep','break'], default: 'keep' }`**,
  added in the same wrapper that adds `wrath` (relationship.ts:79-84). With `break` the command runs.
- **UI confirm (PLY):** when a button or power cast returns `refusal.kind === 'covenant'`, the UI shows a small confirm:
  "This breaks your promise to the people of Aru. They will remember." **[Break it] [Hold]**. Break it resends the same
  command with `covenant: 'break'`. Free text uses "…, and break my covenant" (§6.5).
- **Post-check** (`endAct`): `spare-the-many` breaks when an act's deaths exceed 10 even though the cast looked small.
  Any vow breaks if a harmful act ran with `covenant: 'break'`.
- **Broken:** in covenant towns, trust −0.30, faith −0.05, fear +0.20, loyalty −0.15, defiance +0.15;
  `memory.betrayed += 1` (the continuous ceiling, §0.4). The status becomes `broken`, and `godActs.broken += 1`. A new
  covenant is possible only after another great destruction, at half the gains. A week later the people answer
  (`covenant.answer`).
- **The wrath slider notch (PLY):** under `gentle`, the HUD wrath slider shows a notch at 0.3 with the tooltip "Your
  promise to Aru: always gentle". The handle can pass it, and passing it shows the same confirm on the next harmful cast.

### 4.5 UI, render, audio
- On `covenant.offered`: the **Decision card** (§2.5, same component, placement and pill):
  > **After the Flood of Aru** · 61 dead · three towns struck · the house of Hesh came through it whole
  > The survivors look to the sky.
  > [1] Never again by water · [2] Never again so many · [3] Always gentle · [4] Always warn first
  > [Say nothing] [Decide later]
  The offer lasts 1 game year. "Say nothing" sends `covenant.decline`.
- The God window (ui/living.ts) gets a **Promises** section: each covenant, its vow in words, "kept 14 years" or
  "broken in year N", the household, the towns. The settlement inspector shows "Under the promise of year 140 (kept)".
- Render: the physical rainbow at the scheduled hour (nothing new). The Hearts layer draws a faint spectral rim for
  covenant towns at Medium and above; Low draws a single soft white rim (the same information; no preset is lowered).
  The break draws a cold violet ring through each covenant town (the omen ring decal, recoloured).
- Audio (new SFX cues only): `covenant.bow` → `covenant.chime` (god, 0.7, a slow rising bell cluster); `covenant.broken`
  → `covenant.chime.broken` (the same cluster detuned and cut, news, 0.7); `covenant.kept` → `ui.great`;
  `covenant.offered` → `null`; a refused cast → the UI cue `ui.deny`.

### 4.6 Chronicle (kind `god`, weight 3 unless noted)
- `covenant.offered` (w2): "After the {event}, the survivors of {settlement} looked to the sky and waited." With a
  household: "Of {settlement}, {household} came through the {event} whole: {count} of them."
- `covenant.made` (at the bow): "A bow stood over {towns} after the rain. The god had promised {vowWords}." /
  "{household} saw the bow over {settlement} and said: the god has bound itself." Vow words: "never again to destroy
  them by water" / "never again to take so many" / "always to be gentle" / "never to strike unwarned".
- `covenant.remembered` (w1, at most once per generation per town): "Rain over {settlement}, and after it the bow. They
  say: the god remembers." / after a break: "The bow over {settlement} again. They turn their faces from it."
- `covenant.kept` (w2): "{years} years, and the god has kept its promise to {settlement}."
- `covenant.broken`: "The god broke its promise to {towns}. {dead} died by {means}." / "The god had promised {vowWords},
  and did not keep it."
- `covenant.answer` (w2, a week after a break): trusted before "In {settlement} they say: if the god breaks its word,
  whose word is good?" / feared before "In {settlement} they say: we were fools to believe it."
- `covenant.doubt` (w1): "{settlement} asks why the god let the waters rise."
- `covenant.declined` (w2): "The survivors of {settlement} waited, and the sky said nothing."

---------------------------------------------------------------------------------------------------------------------

## 5. THE CHRONICLE OF AGES: the Book (stage C)

### 5.1 The spine: annals, godActs and the ArcEvent register
- **Annals** (yearly, on the planet's year-day 0): push `[year, regard, faith, fear, trust, loyalty, pride, defiance,
  pop]`, population-weighted and rounded to 0.01, into `annals[planet]` (at most 400 rows).
- **godActs[planet]**: tallies `help, harm, wrath, mercy, patience, sign, silence, covenant, broken, confuse, strike,
  warn, let` and `silenceYears` (years with no god-0 act on the planet).
- **ArcEvent register** (`RelState.arcEvents`, §6.1): one record per defining moment (a great destruction, the tower
  begun or answered, a defiance answer, a covenant made, kept at a milestone or broken, the first wrong, a wandering,
  othergods). All are kept; a 230-year world holds about 40-120. Ages open from these, memory tallies link to them, and
  legends retell them. They are separate from the chronicle because the chronicle is capped prose.

### 5.2 Ages (`AgeRecord`, §6.1; `ageDaily` in story.ts)
At most one age is open per planet, and a new one closes it. A **defining event** opens an age at once. A
**condition age** needs its condition held for the stated span, and needs the open age to be ≥ 3 years old (it never
closes an event age younger than 3 years). The same kind cannot reopen within 3 years: it extends the open one.
Precedence on one day: great destruction, scattering, fall, covenant, broken vow > tower > warning > condition ages.
A repeated kind is numbered ("The Second Flood of Aru"). The name variant is `hash32(planet, tick, hashStr(kind)) % n`
(salt `0xa9e1`), and the names live in scripture.json `ages.<kind>`.

| kind | opens on | names (variants) |
|---|---|---|
| `making` | world start (shown when firsts exist) | "The Days of Making" · "Before the People" |
| `plenty` | the first settlement; it lasts while there is no god-0 harm on the planet and mean hardship < 0.3 | "The Years of Plenty at {town}" · "When the God Walked Near" |
| (`plenty` closes on the **first wrong**) | the first of: a god-0 harm ActRecord on the planet, a `war` event, a death by famine (only the existing event and cause ids; the sim lane uses whichever exist and drops the rest) | closing line "And the years of plenty ended, when {cause}." |
| `proud` | the planet's population-mean pride ≥ 0.55 for 2 years | "The Proud Years" · "The Age of Full Granaries" |
| `flood` / `fire` / `ruin` | a great destruction by water / by fire, meteor or volcano / otherwise | "The Flood of {town}" · "The Age of the Flood" · "When the Waters Took {town}"; "The Burning of {town}" · "The Years of Ash"; "The Ruin of {town}" · "The Breaking of {town}" |
| `tower` | `tower.begun` | "The Years of Building at {town}" · "The Age of the Tower" |
| `scattering` | `tower.confused` | "The Scattering at {town}" · "The Breaking of Speech" · "When {town} Forgot Its Kin" |
| `fall` | `tower.struck` | "The Fall of the Tower of {town}" · "The Years Under the Rubble" |
| `warning` | `tower.heeded` (any town) | "The Warning at {town}" |
| `builders` | `tower.finished` | "The Age of the Tower of {town}" · "The Years of the Standing Tower" |
| `covenant` | `covenant.bow` | "The Age of the Bow" · "The Years of the Promise" |
| `brokenvow` | `covenant.broken` | "The Age of the Broken Promise" · "The Years Without a Word" |
| `defiance` | ≥ 40 % of the planet's people in towns with kind `defiant` for 1 year | "The Years of Stones Against the Sky" · "The Age of Raised Fists" |
| `dread` | regard < −0.33 for 3 years | "The Age of Dread" · "The Years of Watching the Sky" |
| `trust` | regard > 0.33 for 5 years | "The Gentle Years" · "The Age of Trust" |
| `silence` | 10 years without a god-0 act | "The Long Silence" · "The Years the God Was Still" |
| `wandering` | ≥ 25 % of the planet's people moved home within 3 years | "The Wandering of the {people}" · "The Years on the Road" |
| `golden` / `dark` | the most populous town's `age.golden` / `age.dark` (chronicle.ts:244), only while no event age is younger than 3 years | "The Golden Age of {town}" / "The Dark Age of {town}" |
| `othergods` | ≥ 50 % of the planet's people converted to rivals | "The Age of Other Gods" · "When {rival} Was Worshipped" |

Event `{ t: 'chronicle.age', planet, data: { age, kind, name } }`. The id is **not `age`**, which is already the per-town
golden/dark event (eventmap.ts:229). Chronicle entry kind `age`, weight 3: "So began {name}."
The brief's examples ("The Age of the Flood", "The Scattering at Kel-Amar") are produced verbatim by these rules.

### 5.3 The story (`query('story', { planet?, settlement? })`, story.ts: pure, computed on demand, never stored)
```ts
interface StoryView {
  planet: number;
  title: string;                       // "The Book of the {people} of {planet}" (scripture.json title.*)
  opening: string;                     // 1-3 sentences from the planet's firsts (air, sea, rain, life, forest)
  people: { character: PeopleChar; line: string };
  god: { character: GodChar; line: string; epithet: string };
  ages: { id: number; name: string; kind: string; from: number /*year*/; to: number | null;
          paragraphs: string[]; told?: string /* stage C3: "As it is told now in {town}: ..." */ }[];
  generations: string[];               // the towns' family tree, as prose, at most 12 sentences
  promises: string[];                  // one sentence per covenant
  closing: string;                     // never "The End"
  note?: string;                       // migrated worlds: "What came before is remembered only in the chronicle."
}
type PeopleChar = 'fear'|'trust'|'pride'|'defiance'|'faith'|'forgetting'|'many-minds';
type GodChar = 'wrath'|'mercy'|'patience'|'wonders'|'silence'|'faithfulness';
```
- **People's character**, from the annals' means over the last 25 years (or all years): `fear` if mean(fear − trust) >
  0.2; `trust` if mean(trust − fear) > 0.2; `pride` if mean pride ≥ 0.5; `defiance` if mean defiance ≥ 0.35; `faith` if
  faith ≥ 0.6; `forgetting` if faith < 0.25; else `many-minds`. The first that holds, in this order:
  defiance, pride, fear, trust, faith, forgetting, many-minds.
- **God's character**, from `godActs`: the largest of wrath (harm + wrath + strike), mercy, patience (+ warn, let),
  wonders (sign + help without need), silence (silenceYears ≥ 40 % of years), faithfulness (a covenant kept ≥ 20 years
  outranks the others).
- **Lines** (scripture.json `character.*`). People: "They were a people of fear: they bowed, and did not love." · "They
  were a people of trust: they asked, and waited, and were not often let down." · "They were a proud people: they built
  to be seen." · "They were a people who answered back." · "They were a faithful people: at dusk they bowed." · "They
  were a people who forgot: the god became a story told to children." · "They were many peoples, and did not agree
  about their god." God: "Their god was quick to anger." · "Their god struck, and then healed." · "Their god watched,
  and waited, and seldom struck." · "Their god spoke in signs." · "Their god was mostly silent." · "Their god kept its
  word."
- **Paragraphs** for each age: its opening sentence (scripture.json `open.<kind>`, e.g. scattering "At {town} they had
  one speech, and built."), then the age's chronicle entries of weight ≥ 2 on that planet (`chronicleSince`,
  chronicle.ts:135) turned into past narrative (the "Year N." prefix stripped; at most 2 repeats of a template id), then
  the god's part, then the closing (how it ended, i.e. the next age's cause; the open age ends "And so it is now."). At
  most **8 sentences** per age (heaviest first, then by time). From the second great destruction on, an opening may
  refer back ("As in the Flood of Aru, the water came at night.", a 50 % hash choice).
- **Generations** (SCR), from `Settlement.parent`, `founded`, `fallen` and the scattering: one sentence per family of
  towns, oldest root first, largest families first, at most 12. "From Aru came Tesh and Vorn. From Tesh came Lune, by
  the sea. Vorn was lost in the Flood of Vorn. From the scattering at Kel-Amar came Isk, Huru and Penth, who speak
  apart." Where `langDistance` between a town and its parent is ≥ 0.72: "…, who no longer speak as their mothers did."
- **Promises:** "After the Flood of Aru the god promised the house of Hesh never again to destroy them by water. It has
  kept that promise 23 years."
- **Closing** by the god's character: "The story is not finished. What will the god do next?" (wrath, wonders) / "The
  story is not finished. They are still waiting to see." (silence, patience, mercy) / "The story is not finished. The
  promise holds." (faithfulness). **Never "The End".** No win condition and no score: the Book is the result.
- `settlement` narrows the query to one town's book ("The Book of Aru"): the ages it lived through, its legends and its
  memory lines.
- Cost: under **20 ms** at 1 500 agents on a 200-year world.

### 5.4 Epithets ("What they call you")
`epithet` is chosen from the god's tallies and the ages, using the strongest one or two traits at or above their
thresholds (scripture.json `epithet.*`): "the One Who Drowned the World" (a flood age), "the Confounder of Tongues"
(confuse), "the Breaker of Towers" (strike), "the Patient", "the Merciful", "the One Who Keeps Its Word" / "the
Oathbreaker", "the Silent One", "the Terrible" (a dread age), "the Giver of Rain" (most answered prayers are for rain).
Two traits join as "the One Who Drowned the World, who keeps its word". Otherwise it is simply "the god". It is never a
real deity's name.

### 5.5 UI
- **The Book**: the Chronicle panel (ui/chronicle.ts) gets tabs **Book** (the default when ≥ 1 age exists) and **Every
  day** (today's view). Order: title, opening, the two character lines, "What they call you: {epithet}", the ages oldest
  first (heading in the game's serif display face, "years 31-44" small and grey under it, the paragraphs, then the
  "As it is told now" line in italics), Generations, Promises, and the closing line. One column at 888x500 in the
  panel's existing scroll. Chronicle lines inside an age are clickable to fly there.
- **Export**: the existing MD / HTML / TXT export exports the Book when it is shown, as "The Book of the {people} of
  {planet}.md".
- **HUD age line**: the current age's name under the date, small caps, 10 px: "THE AGE OF THE BOW · year 212".
- **Title card**: when a new age begins, a centred card for 4 s real time that fades and never blocks input: "Here
  begins *The Scattering at Kel-Amar*."
- **HUD book button** opens the Book. A settlement card has "Read the book of Aru".
- **Saves**: the save card shows the age name and the epithet (ui/saves.ts meta: `age`, `epithet`). The title's
  Continue line reads "Continue: the Age of the Bow, year 212".
- Audio: `chronicle.age` → the existing `age.golden` / `age.dark` SFX by tone (dark for flood, fire, ruin, fall,
  brokenvow, dread, defiance, silence and dark; golden for the rest), gap 30. Opening the Book plays nothing new.

### 5.6 Legends and the words of each tongue (stage C3, the last item; `god/legends.ts`)
- **`wordFor(st, concept)`** is a pure function: `word(phonologyOf(c, st.species), st.language, hashStr(concept) ^
  0x60d, 2, 3)` (names.ts:39). Its concepts are `god`, `tower`, `flood` and `bow`. It powers "They call the god
  *Ashenu*" (inspector, `query('hearts')`), the `tower.apart` line (§2.7), and the legends.
- **Legends:** a town retells its heaviest arc event (an `ArcEvent` linked to its memory, or a weight-3 god story in
  `culture.stories`) **12 years** after the event, and then once a generation (25 years). Each retelling makes a
  `Legend` (§6.1; at most 6 per town, the oldest and lightest dropped). Drift rules (`hashFloat(st.id, event, gen,
  0x1e9e)`) apply 1-2 changes per generation: numbers grow into a story number (seven, twelve, forty, a hundred, a
  thousand); the place moves home ("our fathers built it here"); the name changes into this town's word; from gen 2 on a
  cause drawn from the town's memory is added (wrath-heavy "because they were proud"; mercy-heavy "and the god forgave
  them"; patience-heavy "and the god let them be, and watched"); and the town's heart colours the telling (fearful as
  punishment, devoted as a lesson, defiant as "the god feared what we could do", which raises the defiance target
  +0.02). Chronicle `legend.retold` (kind `culture`, w1): "In {settlement} they tell it now: {legend}". The Book puts
  the newest legend about an age in its "As it is told now" line, so the reader sees the distance between what
  happened and what is remembered. **The 140-character cap applies to the composed legend.** Composition drops the
  optional clauses until it fits.
- The memory refresh rule is in §0.4 (once per event per town).

### 5.7 Deferred to an optional phase 2 (not built in this arc)
Festivals of remembrance and days of ashes; a Keeper line with bearer tracking; the covenant household picker;
polity merge for "let it stand"; per-head heart motes. A lane must not start these without a new owner decision.

---------------------------------------------------------------------------------------------------------------------

## 6. CONTRACTS (names and types are binding; UI and render may stub them through `window.__GENESIS__` until the sim lands)

### 6.1 Sim state (src/sim/god/state.ts; all optional; created on first touch or empty in `emptyRel()`)
```ts
export type HeartKind = 'devoted' | 'fearful' | 'restless' | 'defiant' | 'quiet';
export type DefyKind = 'curse' | 'hurl' | 'burn' | 'idol';
export type Vow = 'no-flood' | 'spare-the-many' | 'gentle' | 'warn-first';
export interface Memory { wrath: number; patience: number; mercy: number; sign: number; humbled: number;
  betrayed: number; kept: number; proud: number; peak?: Record<string, number> /* ArcEvent id -> peak tally (legends) */;
  refreshed?: number[] /* ArcEvent ids already refreshed by a legend here, sorted */ }

interface SettlementRel {               // ...existing fields...
  pride?: number;
  prideWhy?: { P: number; T: number; U: number; L: number; F: number };
  defiance?: number;
  defied?: Partial<Record<DefyKind, number>>;          // tick of the last act per kind
  answer?: { tick: number; kind: DefyKind } | null;    // an open defiant act awaiting the god's answer (10 days)
  hearts?: { devoted: number; fearful: number; restless: number; defiant: number; kind: HeartKind; proud: boolean;
             since: number; pending?: { kind: HeartKind; from: number } };
  memory?: Memory;
  memEvents?: number[];                 // ArcEvent ids that raised this town's memory (sorted; for landmarks/legends)
  dusk?: { ema: number; today: number; low: boolean; yearAgo: number };
  told?: Record<string, number>;        // chronicle throttle: line id -> tick last told
  lastHarm?: number;                    // FIX a: tick of the last god-0 harm on it (-1 / absent: never)
  harmLoad?: number;                    // FIX a: decaying harm tally (halves yearly)
  idol?: number;                        // building id of its standing idol
  legends?: Legend[];                   // stage C3
}

interface RelState {                    // ...existing fields...
  towers?: TowerState[];                // ended ones kept, at most 8 per planet (oldest ended dropped)
  covenants?: Covenant[];
  offers?: CovenantOffer[];
  ages?: AgeRecord[];
  annals?: Record<string, number[][]>;  // planet id -> rows [year, regard, faith, fear, trust, loyalty, pride, defiance, pop]
  godActs?: Record<string, Record<string, number>>;   // planet id -> tallies (§5.1)
  arcEvents?: ArcEvent[];               // push (tick) order
}

export interface TowerState {
  id: number; planet: number; host: number; league: number[];          // settlement ids, sorted
  name: string; cell: number; pos: V3; building: number;                // great-tower building id
  material: 'mudbrick' | 'brick' | 'stone';
  begun: number; ended: number;                                         // ticks (-1 open)
  height: number; goal: number; tiers: number; builders: number;
  status: 'rising' | 'finished' | 'scattered' | 'struck' | 'abandoned';
  answer: 'none' | 'confuse' | 'strike' | 'warn' | 'let'; answeredAt: number;
  choiceAt: number;                                                     // tick the card was first offered (-1)
  choices: number;                                                      // times offered (0..2)
  warned?: { agent: number; tick: number; heeded: number[]; refused: number[]; disabledUntil: number };
  omens: number;                                                        // 0..3
  rebuildOf?: number; converged: number;                                // tick of the last one-speech step
}
export interface CovenantOffer { id: number; planet: number; act: string; kind: 'flood'|'fire'|'ruin'; name: string;
  settlements: number[]; dead: number; household?: { id: number; name: string; count: number };
  opens: number /* tick the card shows */; until: number; natural: boolean }
export interface Covenant { id: number; planet: number; made: number; vow: Vow; after: string /* offer name */;
  settlements: number[]; household?: { id: number; name: string }; status: 'kept' | 'broken'; broken: number;
  breakAct?: string; signAt: number /* scheduled bow tick, -1 done */; told: number /* last milestone years */;
  halved: boolean }
export interface AgeRecord { id: number; planet: number; kind: string; name: string; place?: number;
  begun: number; ended: number /* -1 open */; event?: number /* ArcEvent id */; closing?: string; n: number /* "Second" */ }
export interface ArcEvent { id: number; planet: number; tick: number;
  kind: 'great'|'tower'|'confuse'|'strike'|'warn'|'let'|'defiance'|'answer'|'covenant'|'kept'|'broken'|'firstwrong'|
        'wandering'|'silence'|'othergods';
  name: string; towns: number[]; god: 'wrath'|'mercy'|'patience'|'sign'|'promise'|'broken'|'none'; dead: number; ref?: number }
export interface Legend { id: number; event: number; town: number; gen: number; text: string; told: number }
```
`toJson` sorts the keys of `annals`, `godActs`, `defied`, `told` and `memory.peak` (the way it does `st` and `stats`,
state.ts:423). Arrays of ids are kept sorted ascending.
`ActCtx` (regard.ts:156) gains **`ruined: Record<string, number>`** (fix b), filled in harm.ts.
New ids: **`TASK.defy = 59`** (people/defs.ts; `tData` = `DEFY` id: curse 1, hurl 2, burn 3, idol 4); `GATHER_KIND`
gains `covenant` (appended). Buildings `great-tower` and `idol` are appended at the end of buildings.json.

### 6.2 Views (src/sim/types.ts; all additive)
```ts
export const AnimState = { ...existing, lookUp: 40, fist: 41, hurl: 42, curse: 43 } as const;  // 31-36 are RANIM (crowds.ts:89)
export const HeartSign = { none: 0, pray: 1, fist: 2, fear: 3, celebrate: 4, hurl: 5 } as const;
interface MoverBlock { /* ... */ heart?: Uint8Array /* HeartSign per agent, `count` long */ }
interface SettlementView { /* ... */
  heart?: { kind: HeartKind; proud: boolean; devoted: number; fearful: number; restless: number; defiant: number;
            pride: number; defiance: number; dusk: number; duskYearAgo: number; caption: string; line: string;
            theyCall?: string; remember: string[]; answered: string /* "struck twice, shown mercy once" or "" */ };
  defiant?: { kind: DefyKind; tick: number };          // latest act, <= 2 days old
  covenant?: { id: number; vow: Vow; status: 'kept'|'broken'; year: number };
}
interface TowerView { id: number; pos: V3; cell: number; name: string; host: number; league: number[];
  height: number /* what stands */; goal: number; tiers: number /* struck: the count before the fall (render heaps the difference) */;
  material: 'mudbrick'|'brick'|'stone'; style: number /* host styleVariant */;
  status: TowerState['status']; builders: number; begun: number; ended: number; answer: TowerState['answer'];
  choiceOpen: boolean; canAnswer: ('confuse'|'strike'|'warn'|'let')[]; warnBlocked?: string }
interface PlanetSnap { /* ... */
  towers?: TowerView[];
  covenant?: { id: number; vow: Vow; status: 'kept'|'broken'; years: number; towns: number[] } | null;
  covenantOffer?: { id: number; name: string; dead: number; towns: number[]; household?: string; until: number } | null;
  age?: { id: number; name: string; kind: string; since: number } | null;
  epithet?: string;
}
```
`line` is the town's current mood sentence ('' when quiet). `caption` comes from §1.4. All strings are already
composed by the sim (in the voice); the UI never builds sacred text itself.

### 6.3 Events (`{ t, planet, pos?, ref?, data }`; the audio map must give every one a cue or an explicit `null`)
`heart` {settlement, from, to} · `heart.proud` {settlement, proud} · `tower.begun` {tower, league} · `tower.tier`
{tower, tiers, height} · `tower.omen` {tower, kind, settlement, reading} · `tower.choice` {tower} · `tower.warned`
{tower, agent} · `tower.heeded` {tower, settlement} · `tower.refused` {tower, settlement} · `tower.confused` {tower,
towns, scattered, founded} · `tower.struck` {tower, dead, tiers} · `tower.finished` {tower, answer} · `tower.abandoned`
{tower} · `tower.rebuilt` {tower, of} · `defy` {settlement, kind, count} · `defy.answered` {settlement, how} ·
`covenant.offered` {offer} · `covenant.bow` {covenant} · `covenant.made` {covenant, vow} · `covenant.kept` {covenant,
years} · `covenant.refused` {covenant, cmd} · `covenant.broken` {covenant, act} · `chronicle.age` {age, kind, name} ·
`legend.retold` {settlement, legend}.

### 6.4 Commands (category `Signs` unless noted; they register in tower.ts / arc.ts)
| command | params | notes |
|---|---|---|
| `tower.confuse` | `{ tower?: int }` | §2.4 |
| `tower.strike` | `{ tower?: int, wrath?: number, covenant?: 'keep'|'break' }` | in `WRATHFUL` |
| `tower.warn` | `{ tower?: int, agent?: int }` | |
| `tower.let` | `{ tower?: int }` | |
| `defiance.answer` | `{ settlement: int, how: 'wrath'|'mercy'|'sign'|'patience', covenant?: 'keep'|'break' }` | wrath is WRATHFUL |
| `covenant.make` | `{ vow: Vow, offer?: int }` | |
| `covenant.decline` | `{ offer?: int }` | |
| every WRATHFUL cmd | `+ covenant: 'keep'|'break'` (default keep) | §4.4 refusal: `CommandResult.refusal?: { kind: 'covenant'; covenant: number; vow: Vow }` (additive field) |
| `tower.begin` (Debug) | `{ settlement: int }` | §2.2; tests and shots |
| `pride.set` (Debug) | `{ settlement: int, value: number }` | sets pride and holds the target ≥ value for 30 days |
| `defiance.set` (Debug) | `{ settlement: int, value: number }` | the same, for defiance |
| `covenant.offer` (Debug) | `{ settlement: int }` | opens an offer as if a great flood had struck it (no deaths) |
| `arc.age` (Debug) | `{ kind: string }` | opens a named age (title card shots) |

### 6.5 Free text (god/freeform-signs.ts `intentSigns`, before the act verbs; negations refuse as for prophets)
| phrases | command |
|---|---|
| "confuse their tongues", "confound their speech", "scatter the builders", "break their speech", "make them speak different languages", "give them many tongues", "let them not understand each other" | `tower.confuse` |
| "strike down the tower", "throw down / topple / destroy / break the tower", "bring the tower down" | `tower.strike` (size words → `wrath` via `signsWrath`) |
| "warn the builders", "send a prophet to (warn) {town}", "tell them to stop building", "tell {prophet} to warn {town} about the tower" | `tower.warn` |
| "let the tower stand", "let them build", "leave them be", "let them reach the sky" | `tower.let` |
| "what are they building", "why are they building a tower", "why are they proud" | answered from `query('towers')`: "The towns of Aru, Tesh and Vorn are building a tower at Aru, 38 m of 80. They say they want a name that lasts." |
| "make a covenant", "make a promise to them", "promise never to flood them again", "swear never to destroy them by water", "promise to spare them", "promise to be gentle", "promise to always warn them", "set a rainbow as my promise" | `covenant.make` (vow from the words: water/flood → no-flood; many/spare/kill → spare-the-many; gentle/anger → gentle; warn → warn-first; none named → asks "Promise what? Never again by water, never again so many, always gentle, or always warn first.") |
| "…, and break my covenant", "…, and break my promise", "I break my promise" (on a harmful clause) | sets `covenant: 'break'` on that clause's harmful command. Alone, with no harmful clause: "A promise is broken by a deed, not a word." |
| "be merciful to {town}", "forgive {town}", "send them rain anyway" / "show {town} a sign" / "be patient with {town}", "let them curse", "ignore them" / "punish {town} for their defiance" | `defiance.answer { how }` |
| "what do they feel", "are they angry", "do they want to rebel", "how do the people of {town} feel", "why are they angry" | answered (`cx.answered`) from `query('hearts')`, in the voice: "In Aru most watch the sky (about half); some raise their fists. Two days ago they threw stones at your storm." |
| "what did I promise" | answered from `query('covenants')` |
| "tell me our story", "read the story (of {town})", "what kind of people are they", "what kind of god am I" | UI intent `open-book` (+ answers with the two character lines and the epithet) |

### 6.6 Queries (`relQuery` + `REL_QUERIES`)
- `query('hearts', { settlement? })` → `{ planet, settlement, name, kind, proud, devoted, fearful, restless, defiant,
  pride, prideWhy, defiance, defied, memory, dusk, caption, line, theyCall?, remember }[]`.
- `query('towers', { planet? })` → `TowerView & { hostName, leagueNames, years, prides: number[] }`.
- `query('defiance', { settlement })` → `{ level, load, acts: { kind, tick }[], answers: { how, tick }[] }` (from
  arcEvents).
- `query('covenants', { planet? })` → covenants and open offers with `townNames`, `yearsKept`, `vowWords`.
- `query('ages', { planet? })` → `AgeRecord[]`.
- `query('story', { planet?, settlement? })` → `StoryView` (§5.3).
- Agent detail (people/query.ts) adds `heart: HeartKind`.

### 6.7 Test surface (`window.__GENESIS__`, src/testsurface.ts, UI lane)
Adds `arc: { hearts(): unknown; towers(): unknown; story(planet?): unknown; stub(kind: 'hearts'|'towers'|'covenant'|
'age', data): void }`. `stub` lets the UI and render lanes inject `SettlementView.heart` / `PlanetSnap.towers` /
`covenantOffer` / `age` into the next snapshot before the sim lands. It is removed from the stub path (kept as a no-op)
once stage C is green.

### 6.8 Scenario
`babel` in `src/data/scenarios.json` (appended): the sandbox world at the bronze era, 4 towns of one species within
10 km sharing one language line (pairwise `langDistance ≤ 0.18`), each with 70-110 people, mudbrick known, and pride
preset to 0.7 (the scenario sets `pride` and `r.since.arc0` 20 years back). In it, a tower must begin within 30 game
days and the first Decision card must open within 2 years.

### 6.9 Render contract
Poses for `AnimState` 40-43 (crowds.ts `livingAnim`, bodies.ts rig: arm and head angles, at the same cost as `cheer`).
`render/life/tower.ts` reads `PlanetSnap.towers`. `render/signs/defiance.ts` holds the hurl arcs. The BuildingBlock
renderer skips `great-tower`. Nothing in world space is an icon.

---------------------------------------------------------------------------------------------------------------------

## 7. Save migration

- **The version stays 1.5** (no format change: all new state is JSON inside `god.rel` and optional per-town fields).
  Append `const arc: HeaderStep = () => {};` to `LIVING_MIGRATIONS` in `src/sim/core/migrate15.ts` (after `history`).
  Its doc comment lists the defaults: `towers, covenants, offers, ages, arcEvents` = `[]` and `annals, godActs` = `{}`,
  set in `emptyRel()` and loaded through the `{ ...emptyRel(), ...copy(j.rel) }` spread (state.ts:450). Do **not**
  bump SAVE_MINOR and do **not** add migrate16.ts.
- **Lazy, in the sim, on the first ARC daily of a town** (HeaderSteps are header-only and cannot do this):
  `memory = zeros`; `r.since.arc0 = load tick` (so `L` starts at 0, and an old world does not build a tower in its first
  years); `lastHarm` = the newest god-0 harm tick still in `r.acts`, else absent; `harmLoad` estimated from `r.acts`;
  `pride` initialised **to its current target** (not 0), so a prosperous old world shows pride at once; `defiance = 0`;
  `hearts` computed that day with no hysteresis wait.
- **An old world's past is not invented.** On the first ARC yearly of a migrated planet: one `making` age is added (if
  firsts exist) and the open age is set from the condition rules (dread, trust, silence, else `plenty` when no harm was
  ever recorded, else `golden`/`dark` from the biggest town) with `begun` = the load tick. The Book adds the `note`
  "What came before is remembered only in the chronicle." Old chronicle entries still feed the earliest age's
  paragraphs by span.
- Content: `great-tower` and `idol` are appended to buildings.json, so older saves remap by id (`ID_REGISTRIES`,
  life/fauna.ts:146; 1.4 saves use `IDS_14`, an unchanged prefix). `TASK.defy` 59 and AnimState 40-43 are appended
  ids, and old saves never hold them.
- Determinism salts: tower `0x70e1..0x70e5`; defiance `0xdef1..0xdef4`; covenant `0xc0e1` (remembered bow), `0xc0e2`
  (offer delay); age names `0xa9e1`; agent fear glance `0x4ea1`; legends `0x1e9e`, `0x1e9f`. Hearts are a pure function
  of the columns. The scheduled bow hour depends only on sun elevation. `wordFor` is a hash.

---------------------------------------------------------------------------------------------------------------------

## 8. Acceptance (measurable; probe `_harness/probes/arc.ts`, run through `slot.sh`; seeds per LIVING §6.4)

### 8.0 Tests (focused `node --test tests/<file>.test.ts`; then the suite once through slot.sh)
`arc-hearts`, `arc-pride`, `arc-tower`, `arc-defiance`, `arc-covenant`, `arc-ages`, `arc-story`, `arc-save`,
`arc-freeform`, `arc-determinism`, `arc-legends` (C3), **`scripture_lint`**, and the `tests/audio*.test.ts` extension
(every §6.3 event has a cue or `null`; no new event maps to `answered`/`wrath`/`sign`/`fulfilled`). UI and render lanes:
`tests/ui-arc*.test.ts`, `tests/render-arc*.test.ts`.
`scripture_lint` checks all new text (§0.3) and `query('story')` on seeds 1-4 after a scripted 120-year arc run: no
banned word or phrase, every line ≤ 140 characters, no unfilled `{…}`, and every sentence starts with a capital letter.

### 8.1 Moods (stage A)
- M1: `SettlementView.heart` is present for 100 % of non-band towns after day 2 (4 seeds).
- M2: there is not much noise: the median town changes kind ≤ 1 time per 6 game days (4 seeds × 30 years), and
  `heart.nobow` fires at most once per town per 2 years.
- M3: in a scripted harsh run (an unprovoked lethal storm every 4 months for 3 years at wrath 0.3), a town turns
  `fearful` within 1 year on ≥ 6 of 8 seeds, and `heart.nobow` fires on ≥ 4 of 8. In a scripted kind run (answered
  prayers, gifts), ≥ 6 of 8 have a `devoted` town within 2 years.
- M4 (shot, verdict in ledger): at 888x500, a fearful village at about 120 m shows ≥ 5 agents in `lookUp`/`fist` poses
  without clicking, and the HUD chip glyph is legible at orbit and region views.
- M5: the Hearts layer's 4 kinds plus the proud rim are pairwise distinct (ΔE ≥ 15) in the standard and colour-blind
  palettes.

### 8.2 Pride and the tower (stage A)
- T1: the three pride sanity values of §2.1, ± 0.03.
- T2: **unattended**, 8 seeds × 60 years (sandbox, no god): a tower is begun on **2-5 of 8** seeds, **none before year
  10**, the median first attempt is in years 15-35, and no seed has more than 2 attempts. (Attended pacing is dropped by the owner's ruling: the people act, the god
  reacts; there is no target for how a god's behaviour speeds the tower.)
- T3: `babel` scenario: begun ≤ 30 game days; first `tower.choice` ≤ 2 years (2-8 real minutes at 100x); 4 shots at
  25/50/75/100 % show clearly different heights, builders on the ramp, and scaffold on the top tier.
- T4: every attempt reaches ≥ 50 % of goal in ≤ 6 years unless abandoned or answered; ≥ 2 omens are told per tower that
  reaches 75 %; ≥ 1 real builder agent is on site in ≥ 80 % of sampled work hours.
- T5: one speech: league pairwise `langDistance ≤ 0.18` after 2 years of building (4/4 seeds of `babel`).
- T6: **confuse:** pairwise `langDistance ≥ 0.72` for all league pairs; `langLine[0]` unchanged; `langSeed` and
  `styleVariant` changed in every league town (a shot shows the new house tint in ≥ 2 towns); ≥ 1 new town or ≥ 20 % of
  households moved per league town within 30 days; relation opinions ≥ 0.2 lower; 0 deaths by the act itself (owner 2026-11-08: "confusing the tongues i would imagine would indirectly kill families" — deaths of the scattered from cold, hunger or the road are expected, counted and told in the chronicle); one `tower.apart` line per
  pair, at most once.
- T7: **strike** at default wrath: deaths ≤ 50 % of builders on site and ≤ 10 in total on 8/8 seeds; the rubble is
  still there 50 years later.
- T8: **warn:** heeding is **very rare** (owner 2026-11-08): per town the heed chance is at most 0.2 and typically under 0.05, so most warnings are refused; the heed roll reproduces (same seed, same outcome); a heeded warning leaves a sacred place at the site;
  a later strike after a refusal is foretold and provoked.
- T9: **let:** finished at goal; league grievance halved; no polity merge happens; strike and confuse still work on the
  standing tower.
- T10: commands fail cleanly with no tower; the Decision card opens at 25 % and at most once more at 75 %, is not modal,
  and "Decide later" leaves a pill (UI test plus shot).

### 8.3 Defiance (stage B)
- D1: terror suppresses: at fear 0.9 there are no `hurl` acts; `hurl` happens only during a god storm; the `burn`
  cooldown is 2 years; an idol is raised with a building record.
- D2: in the harsh run, a `hurl` happens on ≥ 4 of 8 seeds; ≤ 10 % of town-years are `defiant` in the 60-year
  unattended run, with ≤ 1 `burn` per seed.
- D3 (shot): a defiant town plus a god storm (`defiance.set` + `weather` command) shows ≥ 4 `hurl` agents and visible
  arcs; the storm is unchanged.
- D4: mercy after a `hurl` lowers defiance by ≥ 0.15 within 3 days; patience is classified at day 10 when nothing was
  done; wrath on a proud, low-trust town raises defiance (martyrs) on ≥ 5/8 seeds; **wrath never costs less trust than
  the same harm on a town that did not defy** (unit test).
- D5: generations: paired seeds (mercy answers vs wrath answers, trust < 0.3 before) give a mean defiance at year +25
  that is lower after mercy by ≥ 0.1 on ≥ 3/4 seeds, and a newborn mean trust that differs by ≥ 0.05 after 10 years.
  Memory halves in 25 years (± 2 %) with no keeper and is ≥ 0.70 of the original with a rubble landmark. Daughters
  inherit × 0.7.

### 8.4 Covenant (stage C)
- C1: thresholds: a 25-death flood opens exactly 1 offer, shown 1-3 days later; 3 dead in a 10-person hamlet opens none;
  `ruined` is recorded per town.
- C2: `covenant.make { vow: 'no-flood' }` raises the covenant towns' mean trust by 0.10-0.15; the rainbow weather is over
  every covenant town within 24 game hours at sun elevation 5°-40° (100 %); `covenant.made` is told at the bow.
- C3: the next flood command is refused with `refusal.kind === 'covenant'`; it runs with `covenant: 'break'`; the UI
  confirm dialog appears for a button cast (UI test); breaking drops mean trust by ≥ 0.25, and trust stays ≤ 0.9 − 0.2 w
  for 25 years; a second covenant's gains are halved.
- C4: `spare-the-many` breaks post hoc at 11 deaths; a natural flood in a no-flood town is not a break and gives the
  doubt line.

### 8.5 The Book (stage C)
- B1: every unattended 60-year seed has ≥ 3 ages; the scripted arc run (a flood then a covenant, pride then a tower then
  confuse, defiance then mercy) has, in order, a flood age, `covenant`, `tower` and `scattering` ages with the §5.2 names
  on 4/4 seeds.
- B2: `query('story')` returns a title, opening, both characters, an epithet, ≤ 8 sentences per age, generations ≤ 12
  sentences, and a closing that is never "The End"; under 20 ms at 1 500 agents; a migrated save has ≥ 1 age and the
  `note`.
- B3: the HUD age line and the title card appear (shot via `arc.age`); the save card shows the age and epithet; export
  MD contains every age heading.
- B4 (C3): ≥ 1 legend line per seed by year 30 of the scripted run; gen-2 text differs from gen-1; each legend ≤ 140
  characters; a legend refresh happens once per event per town.

### 8.6 Gates (every stage)
`npm run check` green (detban clean on arc.ts, tower.ts, story.ts, legends.ts); determinism (same seed + log ⇒ same
hash, with the arc scenario: tower → confuse, flood → covenant → break, defiance → mercy; save at year 40, load, run to
80 ⇒ the same hash as a straight run); the old-save fixture loads, ticks 3 days and has pride and hearts with `towers:
[]`; L1 throughput at 1 500 agents within **2 %** of before (perf_worker); no snapshot hitch over 8 ms added; **no shader
compile after t=0** (macfix probe) in the `babel` shot run; frame time delta ≤ 0.5 ms at High; `npm run build` OK;
`node _harness/cdn.mjs` PASS.

### 8.7 Owner rules (every stage)
The 21 .ogg hashes are unchanged and the stinger mappings in authored.ts/eventmap.ts are unchanged; the quality.ts
preset diff contains additions only; no creature or fantasy noun in new text; real animals only; survivable default
(T7); `scripture_lint` green.

---------------------------------------------------------------------------------------------------------------------

## 9. Lanes, file ownership, build order

### 9.1 Ownership (edit only your lane's files; read a file right before editing it; never revert another's work)
- **sim**: `src/sim/**`, `src/data/**`, `tests/**` except `tests/ui*`, `tests/render*`, `tests/audio*`. This includes
  god/arc.ts, tower.ts, story.ts, legends.ts; the hooks in relationship.ts, regard.ts (`freshen` bias, `lastHarm`,
  `harmLoad`, `ruined`), harm.ts (`ruined`), state.ts, people/defs.ts (`TASK.defy`), people/work.ts (only if the tower
  target needs it), people/culture.ts (confuse and one-speech helpers), types.ts (the views of §6.2), core/migrate15.ts,
  freeform-signs.ts, events.json, buildings.json, scenarios.json (`babel`), the new scripture.json, and `_harness/probes/arc.ts`.
- **ui**: `src/ui/**`, `src/app.ts`, `src/main.ts`, `src/testsurface.ts`, `index.html`, `src/client/**`,
  `src/audio/eventmap.ts` and `src/audio/sfx.ts` (**new SFX cues only; never the music**), `tests/ui*`, `tests/audio*`.
  This includes ui/decision.ts (new), overlays (Hearts), the hud (chip glyphs, the age line, the title card, the pill,
  the wrath notch, the slow-down setting), inspector, chronicle (the Book tab), living (Promises, Towers), saves (meta),
  icons, toasts, and the covenant confirm.
- **render**: `src/render/**`, `tests/render*`, `tests/godgen*`. This includes render/life/tower.ts (new), crowds.ts and
  bodies.ts (poses 40-43), render/signs/defiance.ts (hurl arcs), the confusion ring and broken-vow ring decals, the
  idol mesh, the covenant rim on the Hearts layer if it is drawn in render, the material warm-up, and skipping
  `great-tower` in BuildingBlock.

### 9.2 Build order (each stage is gated by §8.6 before the next one starts its sim work; UI and render may run ahead on stubs, §6.7)
- **Stage A also builds §10 (the river's warning before a flood)**: sim lane (precursors, disasters, shelter wiring,
  events.json lines, test, 8-seed measurement); ui lane (the warning toast and chronicle line through the existing
  warning path, a flood SFX cue only if one is missing); render lane (the rising, browning river during the warning).
- **Stage A: §1 Moods + §2 Pride and the Tower.** Sim order: the state and views of §6.1-6.2 first (so the other lanes
  can build against them), then hearts, dusk, pride (with `lastHarm`), then the tower (record, labour, one speech,
  omens, the four answers, the debug commands, the `babel` scenario), then the freeform phrases and the events.json lines.
  UI: the chip glyphs, the Hearts layer, the inspector, the Decision card, the pill, slow-down, and the tower card.
  Render: poses, the tower, the confusion ring, the house-tint transition.
- **Stage B: §3 Defiance.** `harmLoad`, the acts (`TASK.defy`, `idol`), the classification of answers,
  `defiance.answer`, and memory with its yearly decay, landmarks and the newborn bias in `freshen`. Render: the hurl
  arcs, the idol. UI: toasts, the inspector's "What the god answered".
- **Stage C: §4 Covenant + §5 the Book.** C1: `ruined`, great acts, offers, vows, the pre-check and post-check, the
  scheduled bow, the covenant confirm and wrath notch. C2: annals, godActs, arcEvents, ages, story, epithets,
  Generations, the Book UI, the HUD age line, the title card, save meta. C3 (last): `wordFor` and legends (with the
  `tower.apart` upgrade).
- After stage C: the 8-seed acceptance probe and the shot set (M4, T3, T6, D3, C2, B3) through slot.sh, and a ledger
  entry with every verdict. Then STATUS.md is updated with the measured results.

---------------------------------------------------------------------------------------------------------------------

## 10. The river's warning before a flood (owner amendment, 2026-11-06; built in stage A)

The owner: *"add the flood warning signs fix"*. Today a flood is the only water disaster with no warning: a volcano
rumbles, the sea draws back before a tsunami, but a flood simply arrives (god/precursors.ts `WARNED` lacks `flood`), so
people caught in it escape only on foot. The fix is a realism fix, not a new feature; there is no Great Flood (the owner
declined it).

### 10.1 Natural floods (`disasters.natural`, needs wet + settled)
- A natural flood gets a **warning phase** before the water arrives: 6-12 game hours (hashFloat on the disaster id), set
  as `d.st.Wn` like the volcano's. During it: heavy rain over the catchment upstream (the weather/precip field raised
  there, not over the town only), and the river visibly **rising and running brown** at the settlement's banks (the
  disaster view carries `params.warning = 1`, render hook H5, as for the others).
- Every settlement in reach gets the existing EVACUATE order through `warningStart`: the wet path in people/shelter.ts
  sends them to the highest dry ground beyond the radius, with what food and water they carry, until the water falls.
- Chronicle (events.json, invented wording, no scripture): e.g. `warning.flood` "The river at {settlement} runs high and
  brown; the people carry what they can to the hill." and an all-clear line when they come home.
- Fishers out in boats row in (the existing rowIn rule) once the warning starts.
- **Contract as built (sim lane, stint 1):** during the warning the flood's `DisasterView.params` carries `warning: 1`,
  `rise` (0..1, how far the river has risen toward the flood; for the render lane's banks) and `silt: 1` (the water runs
  brown); all three are removed when the water comes. The upstream rain is a pinned `rain` weather system held in
  `d.st.wU`. The water also really climbs in the channel: cells within the flood radius already holding > 0.3 m of
  river gain `FLOOD_RISE` = 0.4 m in all over the warning (hourly steps; dry ground stays dry). The warning event is `{ t: 'warning', data: { kind: 'flood', id } }`, then `warning.end` the same as the
  others. The evacuation record gains `kind?: string` (`RelSettlement.evacuate.kind`, the disaster kind). Chronicle ids:
  `warning.flood` (w2) and the all-clear `flood.home` (w1, told when a flood's order is lifted and the town stands).

- **Contract as built (sim lane r2, findings #5/#9):** an evacuation order now also holds people on a mission (caravans,
  gift bearers, war bands, crews; not those afloat): standing in its radius, walking into it, or with either end of
  their errand under an order, they are interrupted and get the evacuation (`godHooks.missionEvacuate`, people/hooks.ts;
  `missionEvacuation`, god/precursors.ts); the errand goes on when the order lifts. Weariness no longer holds anyone
  under an order (the tired walk out and sleep beyond it). A warned flood's own 'Flood on X.' chronicle line waits for
  the water (`d.st.Ch`); the `evacuate` line is told as happening ("X leaves its homes before the flood comes."); the
  flood omen readings name the god ("the god washes them clean" / "the god sends the water against them").

### 10.2 Floods the god sends (`water.flood`, `disaster.spawn flood`)
- Unchanged in principle: a cast's own `warning` decides (the player's choice, §3.7 of LIVING). Add `flood` to the kinds
  the people can SEE coming when the cast carries a warning, so the rising river shows and the order goes out; at
  wrath 1 or `warning: 0` no warning, as today. A warned flood counts as **foretold** in regard.ts (faith and fear, trust kept).
- **Contract as built (sim lane r1, findings #3/#7/#13):** `warningTicks(u, 'flood', w)` gives a flood its own warning
  without a cast override: 360-720 ticks at wrath <= 0.5 (hashed on the wrath), falling linearly from 540 to 0 over wrath
  0.5..1 (none at wrath 1). `disaster.spawn flood` and every other god-sent flood therefore warn at the default wrath; the
  omen flood (omens.ts, a sign) passes `warning: 0`. `WARNED` (seenComing) deliberately does NOT list `flood`: a flood with
  `warning: 0` at a gentle wrath must come unseen, as the player chose. **`water.flood`** (the palette's Water power and the
  free-text flood) takes the same `warning` param; when its warning is > 0 and a living town lies in reach
  (`radius x 1.5 + territory + 100` m) it creates a flood `DisasterState` with `st.Cf = 1` (a cast flood: radius = the
  cast's, intensity `(height/5)^2` so its start water is the cast's height, life `CAST_FLOOD_AFTER` = 360 ticks after the
  water) — the same warning event, evacuation, rising brown river (`params.warning/rise/silt`) and chronicle as §10.1, then
  only the cast's water bursts out at the warning's end (no rain, no further water). The command result carries the
  disaster ref. With no warning (wrath 1, `warning: 0`) or nobody in reach, the water comes at once as before.
- **Natural floods on a world that is not wet as a whole (r1 #4/#14):** `riverFlood` (disasters.ts) rolls after the other
  kinds each planet-day on its own hash stream: on a non-`wet` world, on a day when a heavy rain system (rain-type weather,
  precip >= `rain`'s) covers a town with land water > 0.3 m within `territory + 400` m, `RIVER_FLOOD_DAY` = 0.25 x the
  `disasters.natural` law brings a natural flood at that water, with the §10.1 warning. Towns with no water by them never
  flood (most sandbox towns sit in dry hills).

### 10.3 Acceptance
- `tests/flood-warning.test.ts` (fails before): a natural flood on a settled river has Wn in [360, 720] ticks, emits a
  `warning` event with kind `flood`, issues an evacuation to higher ground for every settlement in reach, and nobody is
  harmed before the warning ends; a god flood with `warning: 0` has none.
- 8 seeds x 25 years (through slot.sh): deaths from natural floods fall versus the pre-change baseline (report both);
  >= 80 % of natural floods that reach a town evacuate it before the water; no other disaster's numbers move.
- A screenshot (looked at) of a river during the warning: higher and browner than the same river the day before.

