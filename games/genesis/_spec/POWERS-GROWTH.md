# GENESIS — POWERS-GROWTH v3: the god grows as belief grows, by two roads that go hand in hand, and every power is paid for from what the people gather (binding spec; stage 1 built)

**v3, 2026-11-16.** This amends v2 in place for the owner's rulings of 2026-11-16 (first and second set) and for what stage 0 measured. Changed text is marked **(v3)**; where a (v2) passage and a (v3) passage disagree, v3 rules. Stage 1 (the sim core: `src/sim/god/reach.ts`, the gate, the pool, save, queries, `tier` / `price` / `free` on every power) is built and tested; the numbers in §3 are the built `REACH` table and the probe results in §8 are measured, not estimated. What is specified but not yet built is listed in §9.

The 2026-11-16 rulings (verbatim):
- (d) *"i dont think just the basic powers should cost worship, i think all should. obviously larger powers may require more worship - of course this all heals over time."*
- (e) *"trust and fear can be shown on a bar perhaps - also trust shouldnt wipe fear or vice versa, they can go hand in hand. fear is like the negative version to earn trust, and worship is the positive version - depends on the kind of g-d you want to be."*
- (f) slow pacing: Whispered in the first session, Known after a few hours of play, Most High only in a long game.
- (g) second set: *"yes things that arent powers over the world should be free. but also very basic spells should be free as well. the pool cannot refill without believers though"*

**What v3 changes, in brief (v3)**

| Area | v2 | v3 |
|---|---|---|
| What costs worship | bands 1 to 4, plus a short list of "heavy hands" | **every power**, by size (`price` in `powers.json`), except the free list (§3.2) |
| What is free | most of band 0 | what is not a power over the world (the clock, save and load, the camera, possession's movement, the Hand, names, the settings, every story answer) and **seven very basic spells**: `rain`, `heal-person`, `plant`, `gift`, `extinguish`, `lightning`, `ignite` (owner 2026-11-16, third: not the rainbow) |
| Refilling | a "least gift" of `4 + 0.1 F` a day | **no income without believers.** The pool refills only from the people's rites. No least gift, no trickle |
| No dead end | the least gift | the free basics (small helps and small harms, each also seen as a wonder), the starting pool of a new world (40), free clay, and no charge on a failed cast (§3.6) |
| The two roads | one road at a time | **a person may be on both.** Neither erases the other, in the count or in the sim (§2.1, §4) |
| A person on both roads | n/a | counts 2, the same as on one road: a mixed god is neither weaker nor stronger (§2.1) |
| Trust and fear in the UI | words only | **two bars** on the god's card (§6) |
| Belief no one witnessed | counted | **does not count**: a town counts once it has seen the god act (§2.1) |
| Pace | Known in days 5 to 25 | holds of 1 / 30 / 150 / 360 days and lines of 3 / 30 / 150 / 500 (§3.1, arithmetic in §5) |
| Terror **(v3)** | Above fear 0.80 a person gives less, down to four fifths at 1.0. The count is not touched | Fear fades by itself |

Lead designer, 2026-11-15 (v2 text follows, amended in place). v1 was approved "all recommended"; v2 changed what three rulings required and what two reviews found.

The owner's rulings (verbatim):
- 2026-11-15, first: *"powers should reveal as faith/etc. develops - or something like that. i believe black and white works like this where the main player gets stronger and can perform bigger miracles the more people that believe in him - this is a great way to keep players pushing through."*
- 2026-11-15, second set: *"all recommended"* on v1 §10.
- (a) *"keep slap and stroke."*
- (b) *"there should be two ways to attain those powers i think - belief and worship or whatever it is we use, or fear and benevolence. both technically show g-d's existence."*
- (c) *"i like the idea of GATHERING BELIEF or FEAR as the game goes on and the npcs connect, this way you cannot infinitely cast/use skills, you can run out and need to regain adding a challenge. like you said 'spend worship'."*

Reading taken of (b): the first road is belief held in trust (the people's answer to benevolence), the second is belief held in fear. If the owner meant something else, §10 decision 2 is where to say so.

Clock (ARC): 1 tick = 1 game minute, 1 day = 1 440 ticks, 1 year = 12 days. At 1x a day is 24 real minutes; at 100x it is about 14 s.

**What v2 changes, in brief**

| Area | v1 | v2 |
|---|---|---|
| Who counts double | deep faith (`faith >= 0.55`) | a grown believer on the road of **trust** or the road of **fear** (§2) |
| Using a power | free once the band is open | bands 1 to 4 **cost worship** from a pool the people fill (§3.6) |
| The maker's hands | all free | free, except a short list of **heavy hands** that are priced on settled ground (§3.2, §10 decision 5) |
| The pool | bonus potency only | the one spendable resource, with a cap that grows with standing (§3.6) |
| How much a town can give | unlimited, per act | a **daily measure** per town; nothing the god does can make a town give more than it (§3.6) |
| Fear as a source | half weight inside evening worship | a threshold offering made in fear; one symmetric yield formula for both roads (§3.6) |
| Restraint mode | separate | the same charge code; "Strict" is one position of one setting (§3.7) |
| Reaching beyond | optional | part of the economy: 3 x the price, one band up (§3.5) |
| `slap`, `stroke` | flagged for removal | kept, band 0, free |

Code facts this builds on (read, not run):
- `GodState.law(k)` returns **1** for any law that is not set (`state.ts:584`). New switches must therefore be tested by key presence, never through `law()`.
- Worship reaches the pool `ps.worship[g]` by four writers: `addWorship` (`people/culture.ts:250`, via the `worshipYield` hook in `god/relationship.ts:491`), `offerings()` and `godsFeast` (`relationship.ts`), and `sacrifice()` (`culture.ts:397`, a flat +5 on 30% of days in a fearful town with a temple).
- Today's yield is `2.5 x (faith + 0.5 fear) x place x (0.5 + piety)`: it pays for fear and ignores trust. `addWorship` picks the god by `love + 0.5 fear`, `worshipYield` by `faith + 0.5 fear`.
- Prayer is not once a day. The prayer task is utility-driven and rises with hardship; `god.seen` (plumbing, sent every few seconds in walk mode) makes the trusting kneel and pray (`seen.ts:72`); `possess-act` and `disciple-order` can also start paid prayers.
- `restraintCheck` runs in the registry `before` hook (`powers.ts:89`) and spends before the handler runs. A handler that then fails has already been charged.
- Evening attendance is about `0.5 faith + 0.3 loyalty`; `duskKeep` keeps most hearts of kind `fearful` (fear 0.5 or more, fear above love + 0.1) at home. Children do not attend.
- The 14 sigil powers are: `water-miracle fire-miracle wood-miracle` (tier 1), `food-miracle heal-miracle forest-miracle storm-miracle calm fertility teach-miracle fireball shield` (tier 2), `lightning` (tier 0), `disaster-meteor` (tier 3). `meteor-miracle` has no sigil.
- One logged test run (a prophet's town, about 30 people) shows roughly 700 worship gathered: prayers 300, evening worship 250, sermons 130. It is a single log line, not a measurement.

---------------------------------------------------------------------------------------------------------------------

## 0. Purpose (v2)
1. Give the player a reason to keep playing: the more people believe, the greater the works the god can do.
2. There are **two roads** to standing: belief held in trust and belief held in fear. Both prove the god exists. Neither is called good or evil, and there is no alignment meter.
3. Great works are **spent from what the people gather**. The god can run out and must wait for the people to give again.
4. Every power is always visible. A power out of reach, or not yet paid for, says in plain words what it needs. There is no score screen.
5. What the people do (pride, defiance, forgetting) can shrink the god's reach. The free hands are never lost.
6. This amends binding text, and the amendments are part of stage 7:
   - CONTRACT pillars 1 and 3: "every power from the start" becomes "every power in sight from the start, in reach as belief grows, paid for from worship".
   - **ARC §0.5 "Nothing Black & White-like"** (checked in ARC §8.7) is narrowed by the 2026-11-15 ruling to: "no creature, no good or evil alignment, no alignment look". Growth of power with belief is now an owner rule.
   - ARC §0.1 "no points" and §5.3 "no score": worship is a store the god spends, shown as a gauge on the god's card, and the Following is shown as the people's count toward the next name. Neither is totalled, ranked or shown at an ending.
   - Old saves and the sandbox setting keep the old rule.

## 1. The rule in plain words (v3)
- The people give the god a **standing**, in five steps: **Unknown, Whispered, Known, Worshipped, Most High**.
- Each standing opens a **band** of powers by scale: the maker's hands, signs, local miracles, regional acts, world-shaping acts.
- The standing comes from the **Following**: how many grown, living people, in towns that have seen the god act, believe. A believer who trusts the god, or fears the god, or both, counts twice.
- **Trust and fear go hand in hand.** One person, and one people, can hold both. Neither wipes the other out.
- Believers **gather worship** every day by their own rites. Each town has a daily measure it can give. **With no believers nothing is gathered.**
- **Every power costs worship, by its size**, and the pool heals as the people give again. A handful of very basic spells, the Hand, the clock and every story answer cost nothing.
- Standing rises one step at a time when the Following has held at the next line long enough. It falls one step when the Following has stayed well below the line for a year. Spending never lowers standing.
- A world no people have ever lived on is free clay: everything works on it, at no cost.
- A cast that fails, or is refused, costs nothing.

## 2. The measure (v2)
Player god only (g = 0), all worlds, in agent index order. Inputs are existing per-person fields: `A.faith`, `A.love` (the UI says trust), `A.fear`, and the child flag.

### 2.1 The two roads (v3)

| Term | Definition |
|---|---|
| a town the god is known in | a living settlement in which a god-0 act has been witnessed (not a natural event, not a rival's act). Stamped in the witness path (`reachSeen`), dropped when the town falls |
| believer | a living, **grown** person (not `AgentFlag.child`) of such a town with `faith >= 0.30 - 1e-4`. Counts 1 |
| on the road of trust | a believer whose trust (`love`) is at `REACH.trustLine` (0.50) or more. Stays on it while `love >= REACH.trustKeep` (0.50) |
| on the road of fear | a believer whose fear is at `REACH.fearLine` (0.35) or more. Stays on it while `fear >= REACH.fearKeep` (0.04) |
| on both | both of the above at once. Allowed, common under mixed play, and under severe play once a struck town rallies |
| Following **F** | the sum over believers of `1 + min(1, onTrust + onFear)`. A believer on one road counts 2; **on both roads, still 2** |
| popMax | the highest grown population seen, minimum 12, easing down 2% of itself a year toward the present population |
| Share **S** | `F / (2 x popMax)` |

- **How a person on both roads counts (v3).** Each road contributes 1 on top of the believer's own 1, and the sum of the two contributions is capped at 1. So n people on trust plus n on fear, 2n people on one road, and 2n people on both all give F = 4n. A mixed god is not weaker than a pure one, and holding both cannot be farmed for more. The two **bars** (§6) each count everyone on their road, so a person on both lengthens both bars.
- **Belief no one witnessed does not count (v3).** Stage 0 showed that with no acts at all a people still comes to believe (`babel` reached F >= 200 by day 43 with a silent god). Under v3 such a town counts for nothing until the god has been seen in it once. After that, everything its people come to believe counts, including children born into the faith when they are grown. Measured: a silent god stays Unknown with F = 0 for 48 days on `shore` (§8).
- Faith is required on both roads. Fear without belief counts for nothing, and so does goodwill without belief.
- **Why the keep lines differ.** Fear fades 4.5% a day unseen and trust 0.5%. The low `fearKeep` holds a person on the road of fear about as long as trust holds unattended. `regard.ts` decay rates are not changed.
- There is **no terror cliff**. A terrified believer still counts 2, and gives a fifth less at fear 1.0 (§3.6).
- Road membership is kept per person as a bit mask (1 trust, 2 fear, 3 both) in `reach.roads[planet][agent id]`, written only in bound worlds, rebuilt at every count.
- Not read: loyalty, regard, hearts, `worshipBy`.
- Counted once per game day (every 1 440 ticks) in `reachDaily`.


### 2.2 Why neither road can be farmed
- **Killing unbelievers** does not raise S in any useful time: popMax eases down only 2% a year. The dead count for nothing and give nothing. (The easing exists so a people that starved back from 40 to 15 through no act of the god is not shut out of the share path for good.)
- **Making people** does not raise F. When belief bounds the god, a person made by the god's hand (`people`, `birth`, `introduce-people`) starts with no regard for god 0: faith, trust and fear 0 (the `freshen` inheritance of 0.6 x the town's mean faith is kept for children born to the people). A made person must be won like anyone, and meanwhile raises popMax. Children never count. The makers are priced like every power (§3.2).
- **Building temples** does not multiply a hamlet. When bound, a temple's place factor is `1 + min(1, grown believers in the town / 20)`, so a temple is worth 2 only with a congregation of 20. Shrine 1, hearth 0.5, else 0.3, as today.
- **Terror** is tapered **(v3)**: a person's gift is whole up to fear 0.80 and falls in a straight line to four fifths at fear 1.0 (`REACH.terror` 0.2). v2 let it fall to nothing; the probe showed that this ended the road of fear's income under steady severity (0.1 a day against 40 for help), which contradicts ruling (e). The town's daily measure is what stops terror farming.
- **Cruelty** already costs trust and loyalty and raises defiance; a defiant town counts 0 and gives nothing. The existing flight from a feared god removes people.
- **Bribery** has the same kind of ceiling: trust tapers over its upper half (`riseTrust`), and one act cannot move a town's mean trust by more than 0.35.
- **Worship cannot be drawn out by the god's acts.** Each town has a daily measure (§3.6). Hardship prayers, prayers started by the god walking among the people, by possession or by a disciple's order, and repeated rites all pay into the same measure and stop paying when it is full. A hundred lightning strokes, or a starving town praying all day, gather no more than a calm town at its evening worship.

### 2.3 Modifiers (they read the people's state, never the player's answer)

| State of the town | Effect on its people's count | Effect on its daily measure |
|---|---|---|
| pride at or above `ARC.proud` | people on a road count 1, not 2 | unchanged |
| in open defiance (from the act until answered or lapsed) | count 0 | 0 |
| in Open Rebellion (when built, ARC §11) | count 0 | 0 |
| the god broke its covenant with this town, for 12 days after the break | people on a road count 1, plain believers count 0 | halved |

All four are applied at the moment worship is credited (§7.3), not after the fact.

## 3. Standings and bands

### 3.1 Thresholds (v3) (`REACH` table in `src/sim/god/reach.ts`, as built)

| Tier | Standing | The line | Held for | Band |
|---|---|---|---|---|
| 0 | Unknown | always | - | the maker's hands |
| 1 | Whispered | F >= 3 | 1 day | signs |
| 2 | Known | F >= 30, or S >= 0.50 with F >= 12 | 30 days | local miracles |
| 3 | Worshipped | F >= 150, or S >= 0.70 with F >= 60 | 150 days | regional acts |
| 4 | Most High | F >= 500, or S >= 0.85 with F >= 200 | 360 days | world-shaping acts |

- **The hold.** Each day the line of the next standing is met, `up` grows by `clamp(F / line, 1, 2)` days: a Following twice the line holds twice as fast, never faster. A day under the line takes 2 held days back (never below 0). The standing rises when `up` reaches the hold, and `up` starts again from 0.
- **Fall, with grace:** F below 0.7 x the tier's line **and** the share path below 0.7 x its numbers, for 12 days in a row (one game year). Then one step down, and the count starts again. A single day back above the fall line ends the count. `reach.falling` is emitted on the first day, `reach.fell` on the step.
- A fall cancels nothing already running.
- `minWrath` 0.85 on the largest disasters still applies on top, unchanged.
- The arithmetic of the pace is in §5; the measured times are in §8.

### 3.2 Bands (v2) (new `tier` field on all 229 entries of `src/data/powers.json`; counts 110 + 13 + 39 + 45 + 22)

**Tier 0, the maker's hands (110, never locked)**
- Shape (17): `raise lower flatten smooth roughen crater mountains dig-sea paint-sand paint-snow paint-soil paint-ash paint-ice paint-rock paint-lava pin-biome pave`
- Water (6): `pour-water take-water drain rain spring river`
- Sky (18): the 15 `weather-*` powers, `clear-skies wind lightning`
- Time (7): `speed step rewind edit-past save load resume`
- Worlds (5): `add-air atmosphere warmth seed-species recall-ship`
- Life (8): `plant forest paint-biome animals cull breed tame cure`
- Peoples (15): `people found birth gift heal-person kill-person move-person age-person role build possess possess-move possess-act rename-person rename-settlement`
- Fire (2): `ignite extinguish`
- Hand (7): `grab throw release place drop slap stroke` (**kept by owner ruling**)
- Disasters (1): `cancel-disaster`
- Laws (6): `wrath restraint rival rival-remove natural-disasters repeal`
- Signs (18): `omen-rainbow answer-prayer prophet-call prophet-foretell prophet-abandon tower-confuse tower-strike tower-warn tower-let vow-no-flood vow-spare-the-many vow-gentle vow-warn-first vow-none answer-wrath answer-mercy answer-sign answer-patience`

**Every power has a price; a short list is free (v3; replaces v2's "heavy hands").** Each entry of `powers.json` now carries `tier`, `price` (worship, in a bound world) and, on the free list, `free: true`. The old `cost` field is unchanged and is still what the legacy restraint mode charges (§3.7), so no unbound world moves. The fields are written by `_harness/probes/reach-tag-powers.mjs` (idempotent).

| Band | `price` rule | Cheapest | Median | Costliest |
|---|---|---|---|---|
| 0 hands | half the old cost, at least 1, at most 40 | 1 (`move-person`) | 3 | 40 (`add-air`, `atmosphere`, `warmth`, `seed-species`) |
| 1 signs | the old cost | 5 | 10 | 20 |
| 2 local | the old cost | 10 | 20 | 50 (`kill-area`) |
| 3 regional | the old cost x 1.25 | 25 | 100 | 100 |
| 4 world | the old cost | 60 | 400 | 3 000 (`erase-world`) |

- **Size.** The price is multiplied by `max(1, radius / the power's default radius)`, by `max(1, power)` for a cast, and by `max(1, scale)` for a disaster, then by `restraint.costScale`. A brush twice as wide costs twice.
- **The free list (49), by the owner's second and third rulings of 2026-11-16.**
  - Not powers over the world: `speed step rewind edit-past save load resume` (the clock, save and load), the camera (not a power), `possess possess-move possess-act` (the god's own body), the Hand `grab throw release place drop slap stroke`, `rename-person rename-settlement`, the settings `wrath restraint natural-disasters rival rival-remove`, `cancel-disaster`, `recall-ship`, `prophet-abandon`, `disciple-order`.
  - The story answers: `answer-prayer`, `tower-confuse tower-strike tower-warn tower-let`, `vow-no-flood vow-spare-the-many vow-gentle vow-warn-first vow-none`, `answer-wrath answer-mercy answer-sign answer-patience`. A deed an answer fires through the registry is part of the answer and is not gated or charged.
  - **The very basic spells (7) (v3, third ruling: "not rainbow, needs to be other basic things").** Help: `rain` (a shower), `heal-person` (one person), `plant` (a patch of green), `gift` (a small gift of food to one town), `extinguish` (put out a small fire). Harm: `lightning` (one stroke), `ignite` (a small fire, 60 m). Each is single-target or small, and each is witnessed, so a god with an empty pool and no believers can always begin again by either road. Rain and the small fire are also read as wonders by those who see them.
  - `omen-rainbow` is **not** free: it is a sign, priced at the smallest sign price (5), and stays in band 0.
  - `wind` was considered and left priced (3): its default is a wind over the whole world held for three days, which is not a small act. `extinguish` takes its place as the nearest basic equivalent, and pairs with `ignite`.
- **The free spells cannot replace priced powers.** In a bound world they carry `REACH.freeCooldown`: `rain` 60 minutes, `lightning` 60, `ignite` 60, `gift` 120, `heal-person` 30, `extinguish` 30; `plant` has none. And they are free **at their own size only**: cast with a wider radius or more power than the default, a free spell costs half its old cost x the size (a 600 m `ignite` costs 30).
- Content rule (tested): every power that is not free has a price above 0; no band-0 price exceeds the starting pool (40); the cheapest price of each band is no lower than that of the band below.


**Tier 1, signs (13)**
`omen sacred-place sacred-animal disciple disciple-order inspire teach forbid sway-belief cast water-miracle fire-miracle wood-miracle`

**Tier 2, local miracles (39)**
- Sigils (9): `food-miracle heal-miracle forest-miracle storm-miracle calm fertility teach-miracle fireball shield`; and `meteor-miracle` (no sigil)
- Life (5): `heal-area bless curse kill-area invent-animal`
- Peoples (6): `peace war treaty split merge move-settlement`
- Ideas (13): `forget withdraw silence-town introduce-item introduce-idea introduce-artifact introduce-animal introduce-crop introduce-disease introduce-people introduce-substance invent-thing invent-idea`
- Other (5): `flood omen-eclipse give-law set-hour invent-weather`

**Tier 3, regional acts (45)**
- Disasters at cost 80 (28): `disaster-meteor disaster-meteor-shower disaster-swarm disaster-volcano disaster-quake disaster-sinkhole disaster-rift disaster-flood disaster-tsunami disaster-drought disaster-hurricane disaster-tornado disaster-wildfire disaster-firestorm disaster-plague disaster-blight disaster-infestation disaster-solar-flare disaster-gravity-slip disaster-magnetic-storm disaster-acid-rain disaster-heat-wave disaster-dust-bowl disaster-glass-storm disaster-overgrowth disaster-leviathan disaster-forgetting-fog disaster-stampede`
- Disaster handling (4): `disaster-random scale-disaster move-disaster freeze-disaster`. `disaster-random` zeroes kinds above the current tier, the way `randomDisaster` already zeroes kinds the wrath forbids.
- Other (13): `tsunami-wave raise-seas lower-seas world-weather hold-season raze extinct set-law species-law freeze-sun day-length year-length magnetism`

**Tier 4, world-shaping acts (22)**
- Disasters at cost 400 (7): `disaster-comet disaster-supervolcano disaster-impact-winter disaster-eclipse disaster-moon-fall disaster-rogue-flyby disaster-ice-age`
- Worlds and Time (15): `axial-tilt remove-air gravity spin star-kind star-brightness star-flare move-world birth-world crack-world erase-world add-moon moon-fall launch-ship destroy-ship`

### 3.3 Bigger miracles inside a band (v2)
- For the 13 sigil powers that take `CastOpts.power`, it is multiplied by `1 + 0.25 x (standing - the power's tier)`. `water-miracle` (tier 1) is x1.0 at Whispered and x1.75 at Most High. `lightning` (tier 0) is x2.0 at Most High.
- `disaster-meteor` (a `disaster.spawn`, no `CastOpts.power`): its `scale` is multiplied the same way, so x1.25 at Most High.
- **Price follows size.** `miracle.cast` accepts `power` up to 5 and a radius up to 20 000 m. When bound, the price is multiplied by `max(1, power) x max(1, radius / the sigil's default radius)`.
- When bound, the old automatic worship bonus (`miraclePotency`) is off, because the power is paid for up front, as in restraint mode today. Unbound worlds keep it.

### 3.4 Free clay (v2)
- A world on which no person has ever lived is unbound: every power aimed at it works at any standing and costs nothing.
- The world is marked peopled **in the command path, the moment a person exists on it** (the `after` hook of any people-making command, and a ship's landing), with the daily pass as a backstop. Its people dying out does not free it again.
- Star powers (`star-kind star-brightness star-flare`) and **every tier 4 power** are free only while no world of the same system is marked peopled. `move-world` or `crack-world` on an empty neighbour of a peopled world is bound.

### 3.5 Reaching beyond (v2)
- The god may cast a power from the **next** band up by paying **3 x** its price. Its data `cooldown` then applies, doubled.
- It never reaches into the Most High band.
- It is a price multiplier inside the one charge function (§3.7).
- It only works when 3 x the price fits under the cap **(v3)**: at Unknown (cap 40 or more) a sign at 30 fits; at Known (cap 350 at F 30) a regional act at 300 fits; local miracles from Whispered fit up to 29.

### 3.6 The gathered resource: worship (v2)

**One pool.** The existing worship pool (`ps.worship[0]`, per planet, summed by `worshipOf`) is the one thing spent. Trust and fear both fill it (§10 decision 1).

**The town's daily measure (v3, as built).** Once a day, in `reachDaily`, each town the god is known in gets:

`measure = REACH.rite (1.0) x attended x place x (sum over its believers of faith x (1.5 if on a road, else 1) x (0.5 + piety) x calm)`

| Part | Meaning |
|---|---|
| on a road | either road, or both: the same 1.5. Trust and fear pay alike at equal faith, and holding both pays no more than one |
| place | the town's best finished worship place: temple `1 + min(1, believers / 20)`, shrine 1, hearth 0.5, else 0.3 |
| calm | 1 up to fear 0.80, falling in a straight line to 0.8 at fear 1.0 |
| attended | 1.0 if a god-0 act was witnessed in the town within the last 3 days, else 0.5 |

- **One writer.** In a bound world the player god's pool is written only by `credit(u, planet, town, amount)`: `paid = min(amount, measure - given today, cap - pool)`. The four existing writers (`addWorship` for prayer, evening worship and sermons; `offerings`; `godsFeast`; `sacrifice`, which pays `0.1 x members`, at most 5) call it. Their own formulas are unchanged; the measure is what bounds and equalises them.
- So the measure is the most a town can give in a day whatever happens in it. All farms by repetition end here (§2.2).
- **The offering at the door.** Fear keeps people from the evening worship, so at the day's end `reachDaily` pays, through `credit`, the part of the measure owed by the town's believers on the road of fear, as far as the day's rites left it unfilled. This is the v2 "threshold offering" in its accounting form; the visible task (`TASK.offer`: a portion left at the shrine door before dusk) is stage 3 and changes no number.
- **Both roads earn (v3, measured).** `shore`, day 12, one seed: the measure was 38.0 a day under help, 35.3 under severity, 38.4 mixed, and each was filled within 1%. Over a long run severity earns less only because it kills (§8).
- The day's giving is tallied by road for the UI: a believer on trust gives by trust, on fear by fear, on both half by each (`gathered.trust`, `gathered.fear`).
- **No income without believers (v3, owner ruling g).** There is no least gift and no trickle. A town with no believers has no measure, and a god with no believers gathers nothing. Tested: empty pool, no believers, three days: the pool is still 0.
- **"As the people connect"** (stage 3, not built; until then the link is 1). Each town's measure is multiplied by its link, `1 + 0.15 x (T + P + K)`, from 1.00 to 1.45: T = `min(1, st.traded / 30)`; P = 1 if pilgrims left from or arrived at the town within the last year; K = `min(1, n / 3)` for n other living towns it knows in which at least half the grown people are believers. Worked out in `reachDaily`; a day's credits use the value stored the day before. It reads no trust or fear, so it favours neither road.

**Income, measured.** About 1.6 worship a day per believer on a road at a shrine (`shore`: 38 a day from 23 believers; `babel`: 250 to 480 a day from 190 to 260 believers), so roughly `0.8 x F`. `REACH.rite` is the one knob.

**The cap (v3).** The pool holds at most `capBase[tier] + 3 x F`:

| Standing | capBase | Cap at the line | Costliest power of the band |
|---|---|---|---|
| Unknown | 40 | 40 | 40 |
| Whispered | 80 | 89 | 20 |
| Known | 260 | 350 | 50 |
| Worshipped | 640 | 1 090 | 100 |
| Most High | 2 600 | 4 100 | 3 000 |

- The cap is enforced **at each credit**. Worship gathered while the pool is full is lost. If a fall lowers the cap below what is held, nothing is taken away; the pool gathers no more until it has been spent down.
- **A new world's pool (v3).** A brand-new bound world starts with `REACH.start` = 40 worship (the Unknown cap): enough for any one basic power, or a dozen small ones. A world bound later by the setting keeps what it had and is given nothing.
- **A first gift.** The first time ever the god reaches a standing, the pool is given one typical cast of the new band (10, 20, 100, 400), under the cap. `reach.best` only goes up, so it cannot be farmed.

**Prices** are in §3.2. A power is charged once per command. Its data `cooldown` applies after a cast that succeeds.

**A cast that fails costs nothing (built).** `chargeCheck` runs in the registry's `before` hook and changes nothing; `chargeCommit` runs in `after` and only when the handler returned ok. A refusal by the gate, a covenant refusal, a bad target or "no such idea" spends no worship and starts no cooldown.

**Always free.** The free list of §3.2; free clay (§3.4); plumbing commands; rival gods' acts and natural disasters.

**Answering by deed.** As v2: the first god-0 act on a town with an open defiance or Tower question is free and ungated up to tier 2, once per open question (stage 6). Built now: any command a handler dispatches itself (an answer firing its deed) is never gated or charged.

**Time is free.** As v2. The cap, the halved giving of unattended towns and the fading of belief bound what fast-forward can gather.

**No dead end: the guarantee, with numbers (v3)**
1. **The free basics always work**, at any standing, with an empty pool: `rain`, `gift`, `heal-person`, `plant`, `extinguish` (help) and `lightning`, `ignite` (harm). Each is witnessed, so each can make believers on its road.
2. **Believers refill the pool.** Tested from the worst case (`tests/reach-charge.test.ts`): pool 0, every person's faith, trust and fear set to 0, only three free spells cast (`gift`, `rain`, `lightning`, about four a day each as their cooldowns allow). Believers appear, the standing leaves Unknown and the pool is above 0 within 12 game days; a priced power is then cast.
3. **A new world starts with 40**, so the first acts on a peopled world are not all free spells.
4. **Free clay is free.** A world no one has lived on takes every power at no cost, at any standing (a tier 4 act only while no world is peopled). A dead world can be re-seeded: `people` costs 25, under the Unknown cap, and the free spells above earn it.
5. **A failed or refused cast charges nothing** and starts no cooldown. The pool never goes below zero. There is no debt, no upkeep and no decay.
6. Nothing already running is cancelled for want of worship. Spending never lowers standing, and a low pool never causes a fall.
7. What is NOT promised any more: income with no believers. A god who has spent everything and lost every believer has the free spells, and nothing else, until someone believes again. That is the owner's ruling (g).


### 3.7 One system with restraint mode (v2)
**(v3, as built)** One hook in `powers.ts` is the one charge path. In a bound world god 0 goes through `chargeCheck` / `chargeCommit` (`reach.ts`), which use the same pool, the same `cooldowns` map, the same `restraint.costScale` law and the same refusal channel as `restraintCheck`; rivals, and everyone in an unbound world, go through `restraintCheck` exactly as before. The setting has three positions, and one legacy state:

| Setting | `'reach.bound' in laws` | `settings.restraint` | What is charged |
|---|---|---|---|
| **Unbound** (sandbox; all old saves) | no | off | nothing; every power open; bonus potency as today |
| **Belief bounds my power** (new games) | yes | off | **(v3)** every power for god 0 except the free list; reaching beyond at 3 x |
| **Strict** | yes | on | **(v3)** as above; rivals pay as they do today. With every power already priced, Strict adds only the rivals' costs (stage 4 decides whether to keep the position) |
| *Restraint (old save)* | no | on | exactly today's behaviour: everything charged, nothing gated, no cap, no measure, no least gift |

- The legacy state cannot be chosen. The settings control shows it as a fourth, read-only label, "Restraint (old save)". Moving the control off it is one-way, and the control says so before it moves.
- **(v3)** There is no least gift in any position. The free list is free in Strict too.

## 4. What can be lost, and the floor (v2)

| Cause | What happens | Way back |
|---|---|---|
| The god is unseen | Faith fades 1% a day (0.3% if seen in the last 3 days). The town's measure halves after 3 days. Both roads hold about 65 to 70 days, then F drops | Be seen: any witnessed act |
| The pool is spent **(v3)** | Every priced power waits. The free list and all answers still work | The people give again every day, up to their measure. With no believers: the free spells, until someone believes |
| Pride, the Tower | A proud town's road counts become single. All four Tower answers stay free | Pride ending by any road restores the count |
| Open defiance | The town counts 0 and gives nothing until answered or lapsed. The first deed in answer is free | Any answer |
| Terror | Above fear 0.80 a person gives less, and nothing at 1.0. The count is not touched | Fear fades by itself |
| Shrine burned | The town's place factor drops, so its measure drops. The standing is not touched | Rebuild |
| The god's record of help (`keptBy`, existing) | Help within 2 years raises faith gains and halves faith decay; unprovoked harm subtracts. No new rule | - |
| Covenant broken by the god | The covenant towns count as in §2.3 and give half for one year. This punishes a broken word, not severity | Time, and being seen |
| Open Rebellion (unbuilt) | Rebel towns count 0 and give nothing | Answer it; climb again |

**The floor**
- The free list (§3.2) is never lost and never charged.
- Arc answers are exempt at every standing and free, including when an answer fires a higher-band power internally.
- A fall is one step per 10 days at most, and it is announced when the count starts.
- `reach.best` is remembered for the Book and the first gift. It does not hold powers open.

**Trust and fear go hand in hand: what changes in the sim, in bound worlds only (v3, ruling e).**

A review of `regard.ts` found three places where one value is moved down by an act that raises the other. In an **unbound** world all three stay exactly as tuned for the arc (tested: the mercy rule still eases fear there). In a **bound** world, for god 0:

| Where (`witnessAct`) | Unbound (unchanged) | Bound (v3) | Why |
|---|---|---|---|
| Mercy: help within 3 days after the god's harm | fear `- 0.10 x m` | fear is not moved | help must not wipe fear; fear fades only by its own daily decay |
| A harm the town provoked | trust `- 0.05 x m` | trust is not moved | a deserved harm must not wipe trust |
| A harm that was foretold | trust not moved | the same | already so |
| Unprovoked harm (cruelty) | trust `- 0.20 x m x cruelty`, loyalty `- 0.05` | trust `- 0.10 x m x cruelty`; loyalty as before | cruelty still has a price, at half: this is the people's judgment of an unjust act, not fear erasing trust (§10, decision 3) |

- Not changed anywhere: the daily decays (fear 4.5% / 1%, trust 0.5%), the 0.35 per-act budget, the rally of a struck town (which already raises trust beside fear), `keptBy`, the hearts, pride, defiance. So every arc number in an unbound world stands, and ARC tests are untouched.
- Measured in bound worlds (§8): under mixed play the whole believing town of `shore` is on **both** roads by day 12 (23 on trust, 21 on fear, 21 on both), and stays so. Under severity alone a struck town that rallies is on both roads by day 24. Under help alone no one fears.
- Both roads earn standing (the count, §2.1) and worship (the measure, §3.6) by the same formulas.


**What remains unequal between the roads, stated plainly (§10 decision 3).** The existing sim treats the two differently in ways this spec does not remove:

| Asymmetry in the existing sim | What v2 does about it |
|---|---|
| Fear is quicker to raise (two harms) than trust (two to four helps) and quicker to fade | `fearKeep` equalises how long each road holds unattended. The quicker rise is kept: fear is the faster road to start |
| Loyalty relaxes toward `faith x (trust + 0.5 fear)`, so feared towns have lower loyalty: fewer at the evening, fewer temples wanted (`templeWanted` needs mean loyalty above 0.3), smaller offerings, easier conversion by a rival | The threshold offering replaces the evening. When bound, `templeWanted` also passes when half the town's grown people are on the road of fear. The offering share reads `max(loyalty, fear)`. Rival conversion is not changed |
| `keptBy` raises faith gains from help by up to x1.8 and halves faith decay | Not changed. Measured in stage 0; `fearYield` and `fearLine` are tuned against it |
| Flight from a feared god, and the `burn` defiance, remove people and shrines only on the road of fear | Not changed. These are the people acting, which the god answers |

The probes of §8 require the two roads within 15% on standing, income and sustainable casts. If stage 0 cannot reach that with the knobs above, the lead reports the gap to the owner before stage 1 rather than hiding it in a yield.

## 5. The pace (v3): the arithmetic, and what a session looks like

**What stage 0 found.** With today's rates any act crosses F >= 3, 20 and 70 inside 1 to 2 game days, 10 to 20 times faster than wanted, because one witnessed act gives +0.15 to +0.25 faith to a whole town and the believer line is 0.30. A silent god also gains believers (`babel` F >= 200 by day 43).

**What v3 does about it, without touching `regard.ts`.**
1. Belief no one witnessed does not count (§2.1). A silent god stays Unknown.
2. The believer line stays at 0.30. Raising it would not help: faith reaches 0.55 for a whole town in a day.
3. The pace is carried by the **hold** and by **larger lines**. A town can be converted in two days, but the name spreads only as fast as the belief lasts.

**The arithmetic.** Clock: 1 day = 1 440 ticks = 24 real minutes at 1x; 1 year = 12 days. Real time below assumes the player averages about 5x over a session (1 real hour is about 12 game days, one game year); at a steady 1x multiply the hours by 5.

| Standing | Line | Hold | Earliest (F at twice the line: hold / 2) | Typical (F at 1 to 1.5 x the line) | Real time at about 5x |
|---|---|---|---|---|---|
| Whispered | F 3 | 1 day | day 1 to 2: the count is daily, and two or three witnessed acts make 3 believers | day 1 to 4 | the first 10 to 20 minutes; the first session |
| Known | F 30 | 30 days | day 2 + 15 = day 17 | day 2 + 20 to 30 = day 22 to 32 | 1.5 to 3 hours |
| Worshipped | F 150 | 150 days | day 17 + 75 = day 92 (year 8) | day 120 to 180 (year 10 to 15) | 8 to 15 hours |
| Most High | F 500 | 360 days | day 92 + 180 = day 272 (year 23) | day 450 or more (year 38 or more), and only for a people of 250 grown or a people of 100 grown nearly all on a road | 23 hours at the very least; a long game |

- A one-town world of 23 grown people (`shore`) tops out at F = 46: Known by the F line (speed 46 / 30 = 1.5, so 20 days), Worshipped only after the people have grown past 30 grown (S >= 0.70 needs F >= 60). That is intended: a greater name needs a greater people.
- The measured times (§8) match: Whispered day 1 to 4, Known day 17 to 29, Worshipped day 92 to 94 on `babel`, Most High not reached in 35 years on `babel`.
- The one knob for pace is `REACH.hold`. Halving it halves every time above.

**A session, peopled world (`shore`)**

| When | Standing | What the player has and sees |
|---|---|---|
| Start | Unknown | Pool 40 of 40. Every band-0 power works and costs a little; the seven basic spells cost nothing. Card: "No one knows you yet. Whispered when three believe." |
| Day 1 to 4 | Whispered | Signs open; a first gift of 10. The pool begins to fill from the people's rites (3 to 5 a day at first, about 38 a day once the town believes) |
| Day 4 to 20 | Whispered | The card shows the hold filling: "Known when 30 have followed for a season (12 of 30 days)." A sign and several small acts a day can be kept up |
| Day 20 to 30 | Known | Local miracles open with a gift of 20. About two local miracles a day can be kept up in a town of 23 believers |
| Years 8 to 15 | Worshipped | Needs a larger people or several towns |
| Year 25 and later | Most High | A long game |

- Empty worlds (`barren`, `sandbox`): free clay. Everything works and costs nothing. The card reads "No one lives here yet."

## 6. UI (v2)
No new screen. Every power is always shown.

- **The god's card (`ui/hud.ts:495-546`) (v3).** Four things, in this order:
  1. **The standing name**: "They call you the Whispered." Below it the next step and its hold: "Known when 30 follow (14 now)." or "Known when they have followed a season: 12 of 30 days." While a fall is counting: "Fewer speak your name. Nine days."
  2. **The worship gauge**: one thin gauge under the existing worship number, held against the cap ("46 of 89").
  3. **Two bars, side by side or stacked: Trust and Fear (v3, ruling e).** Each is the part of the grown people who believe and are on that road (`trustShare`, `fearShare`, 0 to 1). They are independent: both can be full at once, and a person on both roads lengthens both. Labels are the plain words "Trust" and "Fear".
  4. Nothing else. **No alignment meter, no single bar running from one to the other, no "good", "evil", "kind", "cruel", "light" or "dark" anywhere**, and the two bars are never subtracted, compared or coloured as right and wrong. Suggested colours: the existing trust and fear hues of the heart signs.
- The Following and the worship pool are numbers, because the player needs them to plan. The bars carry no number; their tooltip says "23 trust you" / "21 fear you" / "21 of them both".

- **Gauge tooltip.** "Worship 46 of 89. The people gave 9 yesterday, 6 in trust and 3 in fear." With no believers: "No one gives to you yet."
- **Spending.** The existing floating "-15 worship" on the card now shows on every paid cast.
- **Power card (`ui/tools.ts`, beside `renderNeed`) (v3).** One cost line on every priced power: "Costs 15 worship." Wider or stronger than the default: "Costs 30 worship at this size." Free powers say "Free." One band up: "Beyond your standing: 300 worship." On cooldown: the existing "still gathering strength" line. On free clay: "Free on empty ground."
- **Three states in the wheel (`ui/radial.ts` `layPowers`) and the palette (`ui/palette.ts`).**
  - Open and affordable: normal.
  - Open but not affordable: new class `gn-rad-poor`, cost numeral dimmed. Tooltip: "Storm needs 15 worship. 9 is gathered. About a day more."
  - Locked: class `gn-rad-locked`, dimmed, with a small mark of the standing needed. Tooltip: "Beyond your reach. Opens when you are Worshipped: 70 follow."
  - Newly opened powers pulse once.
- **Refusals** come from the sim as sentences (built), so wheel, gesture, freeform and typed commands read the same: "Beyond your reach. Plenty opens when you are Known: 30 follow, 0 now." / "Gift needs 3 worship; 2 is gathered. About a day more." With no believers: "... No one gives to you yet. Be seen: rain, a small gift and a stroke of lightning are always yours."
- **`ui/powers.ts`.** `lockedBy(p)`, `reachShort(p)`, `priceOf(p)`, `affordable(p)` beside `minWrathOf` and `wrathShort`, fed by `powersQuery`.
- **Town popover (`ui/living.ts`).** "22 of 30 believe, most in trust. They gave 12 yesterday." Plus, as they apply: "They have given all they will today." / "Trade and pilgrims carry your name here." / "You have not been seen here; they give less." / "They count for nothing while they defy you."
- **Moments.** A toast, one pulse and a Book line on each rise or fall. One new SFX cue. The approved music is untouched.
- **Settings (`ui/settings.ts`).** One control with three positions replaces the Restraint toggle: "Unbound / Belief bounds my power / Strict", plus the read-only "Restraint (old save)" label where it applies. New games start on the second; old saves load on the first.
- **Text.** One short "Standing and worship" section in `ui/help.ts` and `ui/controlstext.ts`. All player-facing text needs owner approval, as before.

Chronicle lines (ARC §0.3 voice, each at most 140 characters), for example:
- "In {town} they speak of the god in low voices."
- "The god is known in {town}, and they leave bread at the stone."
- "In {town} they leave a portion at the shrine door before dark and do not stay."
- "From {town} to the far hills they worship the god."
- "Fewer speak of the god now. In {town} the stone stands bare."

## 7. Sim contract (v2)

### 7.0 What stage 1 built, where it differs from the v2 contract below (v3)
The v2 text of §7.1 to §7.8 stands except as listed here; the code is the reference.
- **Files.** `reach.ts` exports `REACH`, `isBound`, `setBound(u, on, fresh)`, `reachSeen`, `credit(u, planet, sid, amount)`, `reachDaily(u)`, `capOf`, `priceOf(u, power, cmd)`, `chargeCheck`, `chargeCommit`, `reachView`, `reachPowerView`. `restraintCheck` is not split: it stays the unbound and rival path, and the hook in `powers.ts` chooses.
- **The switch** is `GodState.bound` (`'reach.bound' in laws`). `SimOptions.bound` binds a brand-new world and gives the starting pool; the worker passes `bound: options.bound !== false`, so a new game is bound and a bare headless `Sim` (every existing test) is not.
- **State.** `GodState.reach?: { tier, best, up, down, popMax, f, believers, trust, fear, both, inc, incT, incF, day, seen, towns, roads, peopled }`. `seen["planet:town"]` is the tick of the last witnessed god-0 act; `towns["planet:town"] = { m, g, ff, fd }` is the day's measure, what was given, the part given by fear and the part owed at the door; `roads[planet][agent id]` is the bit mask; `peopled[planet]` marks free clay as used. Roads are in the god state, not a per-agent column, so `SAVE_MINOR` is unchanged and an unbound save is byte-identical.
- **The daily pass** runs for the god as a whole at `tick % 1440 === 917`, after which the measures for the coming day are set.
- **Command** `meta.reach { bound }` (plumbing). **Events** `reach.rose { from, to, f, name }`, `reach.fell { from, to, f, name }`, `reach.falling { days, tier }`, `worship.spent { power, amount, beyond }`, `reach.unbound {}`. No `worship.short`: a refusal changes nothing and emits nothing; the sentence is the command result.
- **Query** `reach` (and `Snapshot.reach`, present only when bound): `{ bound, tier, standing, best, following, believers, trust, fear, both, trustShare, fearShare, share, pool, cap, gathered: { total, trust, fear }, measure, given, next: { tier, standing, f, share, shareF, held, hold } | null, falling }`.
- **`powersQuery`** carries each power's `tier`, `price`, `free` always, and when bound `priceNow` (with 3 x if beyond), `locked`, `beyond`, `affordable`, `reason` (the plain sentence, or null) and `readyAt`.
- **Nested commands.** A command dispatched by a handler (a prayer or defiance answer firing its deed) is never gated or charged. This covers the arc's own casts; the `origin: 'arc'` flag of v2 is not needed for them.


### 7.1 Files
- New `src/sim/god/reach.ts`: the `REACH` table (thresholds, lines, keeps, yields, caps, price scales, free cooldowns, the heavy-hand list); `isBound(u)`; `followingOf(u)`; `reachDaily(u)` (roads, count, rise and fall, popMax easing, link, town measures, least gift); `rite(x, s, st)`; `credit(x, st, amount, road)`; `reachAllows`, `reachPower`, `capOf(u)`, `linkOf(x, st)`, `priceOf(u, power, cmd, p)`.
- `src/sim/god/belief.ts`: `restraintCheck` becomes `chargeCheck` and `chargeCommit`; `miraclePotency` returns `base` when bound.
- `src/sim/god/powers.ts`: `installPowerHooks` calls `chargeCheck` in `before` and `chargeCommit` in `after` when `res.ok`; sets the peopled mark in `after`.
- `src/sim/god/relationship.ts`, all behind `isBound`: `worshipYield` returns `rite`; `offerings()` and `godsFeast` pay through `credit`; `relDecide` rolls the threshold offering one hour before the dusk window; `templeWanted` gains the road-of-fear clause.
- `src/sim/people/culture.ts`, behind `isBound`: `addWorship` takes the god from `worshipYield`'s rule and pays through `credit`; `sacrifice()` pays `0.1 x grown members` (at most 5) through `credit`.
- `src/sim/god/regard.ts`, behind `isBound`: `freshen` is skipped for god 0 on a person made by the god's hand. No rate changes.
- `src/sim/people/defs.ts`: `TASK.offer` appended. `src/sim/god/arc.ts`: the sign reader maps it to the fear sign.

### 7.2 State (all optional; absent in a world that was never bound)
- **The switch is key presence**: `'reach.bound' in god.laws`. It is never read through `law()`, which returns 1 for a missing key.
- **Nothing is added to `defaultLaws()`.** Lines, keeps, yields and scales are constants in `REACH`. An optional law of the same name overrides one, read as `laws[k] ?? REACH[k]`. `restraint.costScale` is reused as it is.
- `GodState.reach?: { tier, best, up, down, popMax, f, believers, trust, fear, gT, gF, everBound, startTier?, startUntil? }`. Counts are whole numbers; `popMax`, `gT`, `gF` are hundredths. Written by `toJson` only when present. **Once written it is kept for good**, also while the setting is Unbound (§7.6).
- Per person: `A.road`, one optional Uint8 column per planet, created when the world is first bound, following the other per-agent columns through compaction.
- Per town, in the existing rel `since` map: `link` (hundredths), `measure` and `gave` (hundredths, reset in `reachDaily`), `gaveT`, `gaveF`, `pilgT`.
- Peopled marks: `reach.peopled:<planetId>` in the existing `since` map.
- The pool is the existing saved `ps.worship`. The cap is computed, not saved.
- `SAVE_MINOR` stays 5 if the save format carries an optional named column; otherwise see §7.8.

### 7.3 Gate, charge and credit
- **`chargeCheck(u, cmd, power, god, p)`** in the `before` hook. For god 0 when bound, in order: skip `PLUMBING` and `origin: 'arc'`; skip free clay targets; skip the first deed on a town with an open defiance or Tower question (up to tier 2); skip tier 0 unless it is a heavy hand in its priced case, has a free cooldown, or the setting is Strict; check the tier (one band up at 3 x, never tier 4); check the cooldown; compute `priceOf` and check the pool. It returns a refusal sentence or a pending charge. It changes nothing.
- **`chargeCommit`** in the `after` hook, only when `res.ok`: spends the pending price from the pool (the target planet's pool first, then the others in id order), sets the cooldown, emits `worship.spent`. On failure it does nothing.
- The gate reads the stored `reach.tier` and the stored pool. It never recounts at command time, so replay, rewind and mid-day load refuse the same commands.
- **`credit(x, st, amount, road)`**, the only writer of god 0's pool in a bound world: `paid = min(amount, st.measure - st.gave, max(0, capOf(u) - worshipOf(u)))`; adds `paid` to `st.gave`, to `gaveT` or `gaveF`, to `st.worshipBy[0]` and to `x.ps.worship[0]`, rounded to hundredths. The four existing writers call it when bound. Towns with a zero measure (defiance, rebellion) pay nothing.
- Refusal texts: "Beyond your reach. Worshipped when 70 follow; 41 now." and "Storm needs 15 worship; 9 is gathered. About a day more."
- `castMiracle` multiplies `opts.power` by `reachPower`; `disaster.spawn` for `disaster-meteor` multiplies `scale`.
- Rival gods and natural disasters are never gated; rivals are charged only in Strict and in the legacy state, as today, by today's formulas.

### 7.4 Commands, events, queries
- Command `meta.reach { bound }` (in `PLUMBING`), with `meta.restraint`, for the setting.
- No `beyond` parameter: a cast one band up is priced at 3 x and reported as such in the result.
- Events `reach.rose { from, to, f }`, `reach.fell { from, to, f }`, `reach.falling { days }`, `worship.spent { power, amount, beyond }`, `worship.short { power, need, have }`, `reach.unbound {}`. Each needs an audio cue or an explicit `null`.
- Query `reach` in `REL_QUERIES`: `{ bound, strict, legacy, tier, believers, trust, fear, f, share, next: { tier, f, share }, falling, best, pool, cap, gathered: { trust, fear } }`. Mirrored in the snapshot (`sim.ts`) and `client/worldview.ts`. The UI turns `trust` and `fear` into words.
- `powersQuery` adds `tier`, `locked`, `price`, `heavy`, `affordable` and `readyAt` to each power.
- `SettlementView` adds `gave`, `measure`, `link`, `attended`.

### 7.5 Scenarios (`src/data/scenarios.json`, `world/scenarios.ts`)
Optional `standing` and `standingDays`. The standing is held as a floor for that many days, then the real measure rules. `standingDays: 0` means for good. A scenario with a starting standing starts with the pool at half its cap.

| Scenario | standing | standingDays |
|---|---|---|
| `twoworlds-late`, `system` | 2 | 60 |
| `babel`, `coldforge` | 1 | 60 |
| `lookdev` | 4 | 0 |
| all others | 0 | - |

### 7.6 Save migration and the setting
- A save with no `reach.bound` key and no `reach` state loads unbound, writes no reach state, runs no offering, link, measure, least gift or cap, uses today's yield formulas, and hashes byte-identical to today. A test asserts that an unbound universe's `toJson` is unchanged.
- An old save with restraint on keeps today's behaviour exactly (the legacy state).
- **First bind of a world never bound:** its pool is kept whole even above the cap, and gathers no more until spent down. `everBound` is set.
- **Switching to Unbound is the sandbox and is allowed.** The `reach` state (`best`, `popMax`, the peopled marks, `A.road`) is kept. Worship gathers by today's uncapped rules while unbound.
- **Every later bind** clamps the pool to the cap. `best` is not reset, so first gifts are not paid again.
- Whether leaving the bounds is written in the Book of Ages ("The god set the measure aside.") is §10 decision 8.
- The client's new-game path sets `reach.bound`. A bare headless `Universe` does not, so existing tests and golden hashes stand.
- A no-op `reach` step is appended to `LIVING_MIGRATIONS` for the record.

### 7.7 Determinism
Whole-number counting in agent index order, once a day (plus the Unknown-standing witness recount, inside the command path). The offering roll is a hash of person id and day, with its own salt; it draws from no shared stream and leaves the dusk roll's draws unchanged. Pool arithmetic rounds to hundredths. Towns in id order, planets in id order. No RNG. Sorted keys on save.

### 7.8 To verify in code before the stage named
- Stage 1: whether the save format can carry an optional per-agent column without a `SAVE_MINOR` change. If not, roads go in the `since` map keyed by agent id, and unbound saves stay byte-identical either way.
- Stage 1: how the 0.35 per-act settlement budget divides among witnesses (it sets how fast F grows).
- Stage 3: what `Settlement.seen` holds (K reads it), and where a pilgrim's home and destination can be stamped.
- Stage 3: which stamp the faith decay reads for "seen in the last 3 days", and that it is per town.
- Stage 4: whether `tower-strike` and `answer-wrath` go through the registry (then they carry `origin: 'arc'`) or call handlers directly.
- Stage 4: that `omen-rainbow` (tier 0) is classified as the "sign" answer by ARC §3.3.
- Stage 4: whether `powerOf` can map an odd-parameter command to a lower-tier power and slip the gate or the price.
- Stage 4: whether held brushes (`raise-seas`, `world-weather`, the hostile weathers) dispatch once per stroke or once per frame.
- Stage 4: how a settlement's bounds are read for the heavy-hand test, and the group size `people` makes.

## 8. Tests and acceptance (v2)

**Unit (`tests/reach.test.ts`)**
- Each threshold; the hold days; the 10-day fall; one step at a time; Whispered falls on F alone.
- The two roads: each counts 2; fear without faith counts 0; children count 0; a tie goes to trust; a person at fear 0.95 still counts 2 and gives a quarter; road kept down to its keep line and lost below it.
- popMax eases 2% a year; killing unbelievers does not raise the tier within 5 years.
- A person made by the god's hand has faith 0 for god 0 when bound; a born child inherits as today.
- Temple place factor by congregation; sacrifice by members, at most 5.
- The measure: a town cannot be credited more than its measure in a day by any mix of sources; prayers started by `god.seen`, `possess-act` and `disciple-order` stop paying when it is full; attended 1.0 and 0.5; link 1.00 to 1.45 from yesterday's value.
- `rite`: trust and fear pay alike at equal faith; holding both pays no more than one.
- Pride, defiance and broken-covenant modifiers on count and measure; rivals ungated; arc-origin commands exempt; the first deed on an open defiance is free up to tier 2, once.
- Charge: free floor free; heavy hands priced only in their cases, free at Unknown and on a world with no living person; price = cost x scales; sigil price follows power and radius; 3 x one band up; never tier 4; cooldown doubled beyond; free cooldowns on `lightning`, `ignite`, `kill-person`.
- **A covenant-refused disaster, a bad target and "no people here" cost nothing and start no cooldown.** Pool never negative.
- Cap enforced per credit; overflow lost; a pool above the cap after a fall is kept. Least gift once per day for the god, not per world. First gift once per standing.
- Free clay: the mark is set in the same command that places the first person; a tier 4 act on an empty world in a peopled system is bound.
- The setting: an old restraint save charges exactly as before; `law('reach.bound')` is never called (lint or grep test); unbind then bind clamps the pool and pays no first gift again; `reach.best` survives.
- `content.test.ts`: every power has a tier; counts are 110 / 13 / 39 / 45 / 22; the free floor holds help, harm, wonder and foretelling; no free power harms an area; the `barren` creation chain is all free; no price above the cap at its band's fall line; every tier 1 to 4 power has a cost or is on the free list.
- Unchanged because unbound: `omnipotence.test.ts`, `determinism.test.ts`, `arc-determinism.test.ts`, `save-continue.test.ts`. Add one bound save-continue case (saved mid-day, with a part-used measure) and one bound determinism case that includes spending.

**Stage 1 tests and the pacing probe, as built (v3)**

Tests: `tests/reach-measure.test.ts` (the measure; un-witnessed belief; both roads and the both-roads case; mixed equals pure; keep lines; bound-only regard changes; rise, hold, grace and fall with events), `tests/reach-charge.test.ts` (starting pool; price by size; tiers and prices on all 229 powers; out of reach, unaffordable and failed casts cost nothing; the free list and free cooldowns; free clay; the unbound sandbox; the no-dead-end run from an empty pool and no believers), `tests/reach-save.test.ts` (an unbound world writes no reach state and loads unbound; the setting; determinism of two bound runs; a mid-day save with a part-used measure continues tick for tick).

Probe: `node _harness/probes/reach-pacing.ts <scenario> <help|severe|mixed|free|none> <seed> [days] [n]`. The scripted god acts twice a game day (severe: once) at the largest town and takes the first act of its list the gate allows, so it plays inside its standing and its pool. Planet `n = 20`. Day each standing was first reached:

| World | God | Seeds | Whispered | Known | Worshipped | Most High | Notes at the end of the run |
|---|---|---|---|---|---|---|---|
| target (§5) | | | day 1 to 6 | day 17 to 60 | day 92 to 300 | day 272 at the earliest; a long game | |
| `shore` (30 people) | help | 1, 2, 3 | 2, 2, 2 | 22, 22, 22 | not in 60 days (people too few) | - | day 60: F 46 to 50, all on trust, gathering 39 to 40 a day |
| `shore` | severe | 1, 2, 3 | 2, 2, 2 | 26, 29, 25 | - | - | day 60: people 14 to 20 of 30, F 20, 10 on both roads, gathering 13 a day |
| `shore` | mixed | 1, 2, 3 | 1, 1, 1 | 21, 21, 21 | - | - | day 60: F 34 to 50, every believer on both roads, gathering 23 to 32 a day |
| `shore` | free spells only (seed 1 re-run with gift, rain, lightning: 1 and 22; seed 2 with the earlier list) | 1, 2 | 1, 1 | 22, 22 | - | - | never spent; pool 386 |
| `shore` | silent | 1, 2 | never | never | - | - | F 0 for 60 days, pool unchanged at 40 |
| `babel` (370 people, 4 towns) | help | 1 | 4 | 19 | 94 | not in 420 days | day 420: F 476, 204 on trust, 66 on fear, pool at its cap of 2 068 |
| `babel` | severe | 1 | 2 | 17 | 92 | not in 200 days | day 192: people 256 of 368, F 305, 124 on trust, 113 on fear |
| `babel` | mixed | 1 | 3 | 18 | 94 | not in 200 days | day 192: F 378, 188 on trust, 100 on fear, 99 on both |

- Against the owner's pace: Whispered in the first session (day 1 to 4: 24 to 96 minutes at 1x, the first minutes at speed); Known after a few hours (day 17 to 29: 1.5 to 2.5 hours at about 5x, 7 to 12 hours at a steady 1x); Most High only in a long game (not reached in 35 game years by a people of 400).
- The three kinds of god reach each standing within 1 to 7 days of each other. Severity is the slower and poorer road only because it kills: `shore` loses a third to a half of its people in 60 days at one harsh act a day.
- **Known gap:** on `babel` the pool sits at its cap from year 1 (gathering 250 to 480 a day against the probe's spending of about 32 a day). In a large believing world worship is plentiful; the challenge of running out is felt in small worlds and early. `REACH.rite` (1.0) is the knob (§10, decision 2).
- Runs are single-seed on `babel`; the v2 probe list below still stands for stage 7 with 8 seeds.

**The v2 probe list (for stage 7; targets superseded by §5 where they give days)**


**Seeded probes (`_harness/probes/reach.ts`, 8 seeds per LIVING §6.4)**

Four scripted gods: **the keeper of trust** (helps and answers prayers), **the keeper of fear** (warned punishments at default wrath, nobody killed by intent), **the mixed god** (alternates by town), **the god of harm then mercy** (strikes, then helps the same town).

| Probe | Target |
|---|---|
| Time to the first sign, `shore`, one witnessed act a day | Whispered and the first sign by day 3 on both roads; the second sign by day 6 |
| Time to Known, `shore` and `twoworlds` | between day 12 and day 36 on both roads; the two medians within 15% |
| Time to Worshipped | between year 6 and year 15; the two medians within 15% |
| Neutrality over 2 years, same seed | same standing within one step; F within 15% across the four gods |
| Income per believer per day at equal faith | trust, fear and harm-then-mercy within 15% |
| Share of the measure filled without help, and temple rate and mean loyalty, by road | reported; the filled share within 15% between roads |
| Sustainable typical casts of the standing's own band per game year, F held at the threshold for 3 years | Whispered 4 to 6; Known 10 to 14; Worshipped 9 to 12; Most High 5 to 7. All gods within 15% of each other |
| Silent god after reaching Known | first fall no sooner than 20 days after the last act; the two roads within 15% |
| Natural disaster on a god-fearing town against a trusting town | income loss within 15% of each other |
| Connection: one town of 60 against three linked towns of 20 | the linked world gathers 20% to 45% more |
| Run dry: spend to zero at each standing, then do nothing | cheapest power of the band affordable again within 3 days; no fall caused |
| **Real-time wait** for the cheapest power of the band from empty, at 1x, default and maximum speed | 3 to 8 real minutes at the default speed; the other two reported |
| **Fast-forward**: reach Known, then run 5 years untouched at maximum speed | the pool ends at or under one cap; the standing has fallen |
| **Hardship farming**: keep a believing town starving or burning with free hands only | gathers no more than the keeper of fear |
| **Walk-mode farming**, **disciple-order farming**, **possess-pray farming** | each gathers no more than the town's measure, and no more than 15% above the keeper of trust doing nothing extra |
| **Terror farming**: free lightning by a town as often as its cooldown allows | not faster to Known than the keeper of trust; gathers no more than the keeper of fear |
| **Spawn farming**: `people` and `birth` into a devout town as the pool allows | not faster to any standing than the keeper of trust |
| **Temple spam**: a temple in each of 20 hamlets | gathers within 10% of the same people with shrines |
| **Setting toggle**: unbind, run 5 years, bind | the pool is at or under the cap; no first gift paid twice |
| Killing unbelievers | S and standing do not rise within 5 years |
| Small people: `fewhands`; and a people that grew to 40 and starved to 15 | Known reachable; Worshipped not before the people pass 15; the share path reopens for the starved people within 20 years |
| ARC §1 in a bound world, a frightened town | `dusk.low` and the fearful share of heart signs within tolerance of the unbound run |
| Old save, and old save with restraint on | load unbound or legacy; hash identical to the pre-change build |

Tuning order if a target fails: for pace, `REACH.scale`; for road balance in the count, `fearLine`, then `fearKeep`, then `trustLine`; for road balance in the gathering, `fearYield`; for casts per year, `restraint.costScale`; for the real-time wait, `REACH.priceScale` and the least gift. Do not tune the gains or decay in `regard.ts`, and do not tune by the god's behaviour.

## 9. Build order (v2)

**(v3) Status.** Built in one stint as "stage 1, the sim core": all of v2 stage 1 (measure, roads, standings, state, save, query, events, switch), stage 2 (the `tier`, `price`, `free` tags), the core of stage 3 (`credit`, the town measure, attended, the cap, the first gift, temple factor, sacrifice and feast through `credit`, the door offering in its accounting form) and the core of stage 4 (`chargeCheck` / `chargeCommit`, prices by size, reaching beyond, the free list and its cooldowns, free clay, nested-command exemption).
**Not built yet:** the link factor, the visible `TASK.offer`, the `templeWanted` fear clause, the made-person rule, miracle widening by standing (§3.3), the Strict position, the pride / defiance / broken-covenant modifiers and the first-deed rule (§2.3, §3.6), scenario start standings (§7.5), audio cues, and all UI (§6). The table below is the v2 order and still names where each belongs.

| Stage | Work | Model |
|---|---|---|
| 0 | Measurement probes only, no gameplay change. For the four scripted gods on four scenarios, 8 seeds: per day, believers, on each road, F; worship per source (including sacrifice and feast) and per town; prayers per person per day, by cause; attendance, loyalty and temple rate by road; trade, pilgrim and known-town values; days each road holds unattended. Record the default play speed. Fix §3.1, the lines and keeps, the two yields, the cap table and the price scales. Report to the owner if the roads cannot be brought within 15% | opus |
| 1 | `reach.ts`: the two-road measure with `A.road`, standings, rise and fall, popMax, state, save, query, events; key-presence switch. Unit and determinism tests. Gate and charge still off | opus |
| 2 | Tag `powers.json` with `tier` by script plus override list; the heavy-hand and free-floor lists; content tests | sonnet |
| 3 | Gathering: `rite`, `credit`, the town measure, attended, link, threshold offering and `TASK.offer`, sacrifice and feast through `credit`, least gift, cap, first gift, made-person rule, temple factor, all behind `isBound`. Income and farming probes | opus |
| 4 | `chargeCheck` / `chargeCommit`: the gate, prices, heavy hands, cooldowns, reaching beyond, exemptions, first-deed rule, `origin: 'arc'`, free clay, miracle widening and sized prices, `disaster-random` filter, the merge with restraint and the legacy state, the §7.8 checks | opus |
| 5 | UI: card line and gauge, words for the roads, three wheel states, palette, power card, town popover, the setting with its legacy label, help text, UI tests | sonnet |
| 6 | Arc hooks (pride, defiance, broken covenant on count and measure), chronicle lines, Book line, SFX cue, scenario start standings and pools, the bound ARC §1 probe | sonnet, opus review of the arc hooks |
| 7 | Full probe pass against §8, tuning, spec edits to CONTRACT pillars 1 and 3, §8.8 and §11.4, ARC §0.1, §0.5, §5.3 and §8.7, and STATUS | opus |

## 10. Decisions (v3): all settled

The owner answered the four v3 decisions on 2026-11-16 (third set): *"yes, all recommended - but not rainbow, needs to be other basic things. maybe 2-3 others."*

1. **The free spells: changed.** `omen-rainbow` is priced (5). `rain`, `heal-person`, `plant` and `lightning` stay free, and `gift`, `ignite` and `extinguish` are added (§3.2). `wind` was the lead's third suggestion; it is world-wide by default, so `extinguish` was taken instead.
2. **How plentiful worship is: kept** (`REACH.rite` 1.0) until the owner has played with the UI; then revisit.
3. **Cruelty costs trust at half in bound worlds: accepted.**
4. **The pace: accepted**, holds of 1 / 30 / 150 / 360 game days.
5. The five reach events are registered silent in the audio map (owner: yes) until the SFX stage gives them cues.

Still the lead's reading, built as read: possession, renaming, the settings (`wrath`, `natural-disasters`, rival gods) and `cancel-disaster` are free as "not powers over the world".

---------------------------------------------------------------------------------------------------------------------

## Summary for the owner (v3)
1. The god still grows as belief grows: five standings, Unknown to Most High, each opening a larger band of powers.
2. There are two roads, trust and fear, and they go hand in hand: one person can trust and fear the god at once, and neither wipes the other out.
3. A believer on either road, or on both, counts double. A god who is both kind and severe is exactly as strong as one who is only kind or only severe.
4. Belief only counts in towns that have seen you act. A silent god stays Unknown.
5. Every power costs worship, more for bigger powers and for bigger sizes of the same power.
6. Free: the clock, save and load, the camera, the Hand, every story answer, and seven very basic spells (rain, heal one person, plant, a small gift of food, put out a fire, a stroke of lightning, a small fire). The rainbow is a sign and costs a little.
7. The pool heals only from believers. Each town gives up to a daily measure; with no believers nothing comes in.
8. You can never be stuck: the free spells make believers by either road, a new world starts with 40 worship, an empty world is free clay, and a failed cast costs nothing.
9. The pace is slow on purpose: Whispered in the first session, Known after about 20 to 30 game days, Worshipped after about 8 game years, Most High only in a long game with a large people.
10. The card will show your standing name, the worship gauge and two bars, Trust and Fear. No alignment meter and no good or evil words.
11. Old saves load unbound and unchanged; the sandbox stays a setting. The sim core is built and tested; the UI is not.
12. No decision is open (§10).

---------------------------------------------------------------------------------------------------------------------

## Review log
Two reviews of the v2 draft. Each blocker and major problem, and how this text resolves it. Nothing below has been tested; the fixes are design changes with probes attached.

| # | Severity | Problem | Resolution |
|---|---|---|---|
| 1 | blocker | Prayer is not once a day; hardship drives repeat paid prayers (a free misery farm) | Each town has a daily measure; every source pays through `credit()` and stops when it is full (§2.2, §3.6, §7.3). The false "once a day" claim is removed. Hardship-farming probe added |
| 2 | blocker | `god.seen` kneeling, `possess-act` and `disciple-order` refill the pool on demand, trust road only | Same measure: these prayers pay into it and no further. Three farming probes added (§8) |
| 3 | blocker | Tier 0 gives free believers (`people`, `birth` inherit faith) and free temples | A god-made person starts with no regard for god 0 when bound; children never count; temple place factor needs a congregation of 20; makers and worship places are heavy hands (§2.2, §3.2). Spawn and temple probes added |
| 4 | blocker | `law()` returns 1 for a missing key, so "absent means unbound" fails and the new line laws read 1 | The switch is key presence; all values are `REACH` constants with `laws[k] ?? default`; nothing added to `defaultLaws()`; a test asserts unbound `toJson` is unchanged (§7.2, §7.6) |
| 5 | major | Time is free, so regaining is "hold fast-forward"; at 1x the Whispered wait is 30 to 60 real minutes | Unattended towns give half; the cap bounds hoarding; a real-time wait target of 3 to 8 minutes at default speed with `REACH.priceScale` as the knob; the remaining limit is stated and put to the owner (§3.6, §10 decision 6). Two probes added |
| 6 | major | Free tier 0 substitutes for paid harm; ruling (c) not applied to tier 0; price ignores `power` and radius | Heavy hands priced on settled ground; free harms single-target with cooldowns; sigil price follows power and radius; owner decision 5 (§3.2, §3.3) |
| 7 | major | The yield formula pays for fear and ignores trust; trust plus fear beats either road | One symmetric `rite` formula with a flat road bonus; one god-selection rule when bound; harm-then-mercy god added to the probes (§3.6) |
| 8 | major | Fear road cheaper to gain, costlier to hold, with a cliff at fear 0.90 | Cliff replaced by a yield taper from 0.80 to 1.0, count untouched; `fearKeep` (0.04) holds the road as long as trust holds unattended; natural-disaster probe added (§2.1, §3.6) |
| 9 | major | Structural asymmetries not disclosed (loyalty, temples, offerings, `keptBy`, flight, `burn`) | Listed in §4 with what is compensated (offering replaces the evening; `templeWanted` and offering share read fear when bound) and what is not; owner decision 3; stage 0 must report if 15% cannot be met |
| 10 | major | The setting can be toggled to hoard, re-earn first gifts, or cast free | Reach state kept for good once bound; every later bind clamps the pool; `best` never resets; Unbound is stated to be the sandbox; owner decision 8 (§7.6). Toggle probe added |
| 11 | major | `sacrifice` and `godsFeast` missing from the source table; flat +5 per hamlet | Both listed, both through `credit`; sacrifice becomes 0.1 per grown member, at most 5; counted by road (§3.6) |
| 12 | major | Modifiers and cap applied after the fact cannot work: writers credit at act time; "cowering stay home" was false | Modifiers, link and cap are applied at each credit inside `credit()`; the four writers are listed in §7.1; the `wPrev` scheme is dropped; the cowering claim is removed |
| 13 | major | Threshold offering defined two ways, neither matching the heart kind `fearful` | One definition: believers on the road of fear, own roll `0.5 faith + 0.3 fear`, one hour before dusk; the dusk roll unchanged (§3.6) |
| 14 | major | The offering would fill the shrine at dusk and read as the `pray` sign, breaking ARC §1.2 and §1.3 | New `TASK.offer`, not in `vespers.went`, mapped to the fear sign, run before the dusk window; bound-world ARC §1 probe added |
| 15 | major | ARC §0.5 "Nothing Black & White-like", §0.1 and §5.3 contradicted and not named; per-road numbers read as an alignment tally | Named as amended in §0 item 6 and stage 7; the road split is shown in words only; owner decision 7 |
| 16 | major | "A refused cast charges nothing" was untrue: the charge ran before the handler | `chargeCheck` before, `chargeCommit` after and only on success; unit test for a covenant-refused disaster (§7.3) |

Minor items also fixed: the least gift is once per day for the god (§3.6); the peopled mark is set in the command path and tier 4 on free clay is bound in a peopled system (§3.4); popMax eases 2% a year and the Most High cap base is 2 600 so `erase-world` fits at the fall line (§2.1, §3.6); Whispered falls on F alone (§3.1); the `keptBy` row no longer speaks of covenants (§4); the sigil list is corrected and widening is defined for `disaster-meteor` (§3.2, §3.3); cooldown counts corrected to six and fourteen; the believer line uses the `1e-4` tolerance; story answers by deed are free up to tier 2 and the `origin: 'arc'` flag is decided (§3.6); the legacy restraint state has a read-only label (§3.7); the cap is defined per credit on the crediting planet (§3.6).

Not resolved here, left to named stages: the checks in §7.8 (save format for the optional column, witness budget, `Settlement.seen`, registry paths, brush dispatch, settlement bounds). Rival conversion of low-loyalty feared towns is unchanged and is measured in stage 0, not compensated.