# GENESIS — POWERS-GROWTH v2: the god grows as belief grows, by two roads, and spends what the people gather (binding spec, final draft for owner sign-off)

Lead designer, 2026-11-15. This replaces v1 whole. v1 was approved "all recommended"; v2 changes what the three new rulings require, and what two reviews of the v2 draft found. Changed sections are marked **(v2)**. Nothing here has been built or run: every number is a first calibration, and stage 0 (§9) measures before anything is fixed. No files were written; this text is the whole deliverable.

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

## 1. The rule in plain words (v2)
- The people give the god a **standing**, in five steps: **Unknown, Whispered, Known, Worshipped, Most High**.
- Each standing opens a **band** of powers by scale: the maker's hands, signs, local miracles, regional acts, world-shaping acts.
- The standing comes from the **Following**: how many grown, living people believe. A believer who trusts the god, or who fears the god, counts twice.
- Believers **gather worship** every day by their own rites. Each town has a daily measure it can give; connected towns and towns the god has lately been seen in give more.
- Powers above the maker's hands **cost worship**. When the pool is empty the god waits, or works with the free hands, until the people have given again.
- The 14 sigil miracles grow **wider** with each standing above their own.
- Standing rises one step at a time when the Following is large enough and has held. It falls one step when the Following has stayed well below the line for most of a year. Spending never lowers standing.
- A world no people have ever lived on is free clay: everything works on it, at no cost.
- Tower answers, defiance answers, covenant vows, prayer answers, the Hand (with `slap` and `stroke`) and time are never out of reach and never cost anything.

## 2. The measure (v2)
Player god only (g = 0), all worlds, in agent index order. Inputs are existing per-person fields: `A.faith`, `A.love` (the UI says trust), `A.fear`, and the child flag.

### 2.1 The two roads

| Term | Definition |
|---|---|
| believer | a living, **grown** person (not `AgentFlag.child`) with `faith >= 0.30 - 1e-4` (the tolerance `defiance.ts` already uses on these float32 columns). Counts 1 |
| on the road of trust | a believer whose trust reached `REACH.trustLine` (0.50) with `love >= fear`. Stays on it while `love >= REACH.trustKeep` (0.50) |
| on the road of fear | a believer whose fear reached `REACH.fearLine` (0.35) with `fear > love`. Stays on it while `fear >= REACH.fearKeep` (0.04) |
| Following **F** | believers + those on a road, a whole number. A person on a road counts 2 in total |
| popMax | the highest grown population seen, minimum 12. It eases down by 2% of itself a year toward the present population (§2.2) |
| Share **S** | `F / (2 x popMax)` |

- A person is on one road at a time. A person on a road moves to the other only when the other value reaches its line and is the larger; a tie goes to trust. A mixed world needs no rule: every person adds to the same F.
- Faith is required on both roads. Fear without belief counts for nothing, and so does goodwill without belief.
- **Why the keep lines differ.** In the existing sim fear fades 4.5% a day unseen (1% seen) and trust 0.5% a day. With one line each, a silent god would lose a feared following in about 18 days and a trusted one in about 67. The low `fearKeep` holds a person on the road of fear for about 65 days from fear 0.8, so the two roads last the same time unattended. Faith itself (1% a day unseen) then ends both at about 70 days. `regard.ts` rates are not changed. Stage 0 sets `fearKeep` so the two hold times match within 15%.
- There is **no terror cliff** in the count. A terrified believer still counts 2. Terror lowers what they give (§3.6), by a taper.
- Road membership is one byte per person (`A.road`: 0 none, 1 trust, 2 fear), present only in bound worlds (§7.2).
- Not read: loyalty, regard, hearts, `worshipBy`.
- Counted once per game day in `relDaily`. While the standing is Unknown, also counted at the end of any tick in which a god-0 act was witnessed.
- One wonder gives +0.25 faith, under the line. A person becomes a believer on the second witnessed act. This is deliberate.

### 2.2 Why neither road can be farmed
- **Killing unbelievers** does not raise S in any useful time: popMax eases down only 2% a year. The dead count for nothing and give nothing. (The easing exists so a people that starved back from 40 to 15 through no act of the god is not shut out of the share path for good.)
- **Making people** does not raise F. When belief bounds the god, a person made by the god's hand (`people`, `birth`, `introduce-people`) starts with no regard for god 0: faith, trust and fear 0 (the `freshen` inheritance of 0.6 x the town's mean faith is kept for children born to the people). A made person must be won like anyone, and meanwhile raises popMax. Children never count. The makers are also heavy hands (§3.2).
- **Building temples** does not multiply a hamlet. When bound, a temple's place factor is `1 + min(1, grown believers in the town / 20)`, so a temple is worth 2 only with a congregation of 20. Shrine 1, hearth 0.5, else 0.3, as today.
- **Terror** is tapered: a person's gift is whole up to fear 0.80 and falls in a straight line to nothing at fear 1.0. The existing 0.35 cap on what one act can move a town's mean fear still applies.
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

### 3.1 Thresholds (`REACH` table in `src/sim/god/reach.ts`; `REACH.scale`, default 1, multiplies every F number)

| Tier | Standing | Rises when | Held for | Band |
|---|---|---|---|---|
| 0 | Unknown | always | - | the maker's hands |
| 1 | Whispered | F >= 3 | 0 days | signs |
| 2 | Known | F >= 20, or S >= 0.35 | 2 days | local miracles |
| 3 | Worshipped | F >= 70, or S >= 0.60 with F >= 30 | 3 days | regional acts |
| 4 | Most High | F >= 200, or S >= 0.80 with F >= 60 | 6 days | world-shaping acts |

- **Fall:** F below 0.7 x the tier's number **and** S below 0.7 x its share, for 10 days in a row. Then one step down, and the count starts again. Whispered has no share number: it falls on F below 0.7 x 3 (F of 2 or less) alone.
- A fall cancels nothing already running.
- `minWrath` 0.85 on the largest disasters still applies on top, unchanged.

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

**Heavy hands (new in v2; §10 decision 5).** Ruling (c) says the god cannot cast without limit, and a review showed that free tier 0 could otherwise drown, burn or starve a town, make believers and raise temples at no cost. So, when belief bounds the god, the tier 0 powers below stay in reach at every standing but are **priced at their existing data cost** in the cases given. They are free while the standing is Unknown, on free clay, and on any world with no living person (so a dead world can always be re-seeded).

| Group | Powers | Priced when |
|---|---|---|
| Makers of people | `people` (50) `birth` (4) `found` (10) `age-person` (5) `breed` (8) | aimed at a peopled world |
| Worship places | `build` of a shrine (20) or temple-kind building (60); other buildings keep data cost 15 and stay free | aimed at a peopled world |
| Hostile weather | `weather-acid-rain weather-blood-rain weather-blizzard weather-hail weather-heatwave weather-cold-snap weather-sandstorm weather-ashfall weather-monsoon` (6 each) | the painted area touches a living settlement's bounds |
| Unmaking the ground | `dig-sea` (20) `pour-water` (5) `crater` (10) `lower` (4) `take-water` (5) `drain` (8) `cull` (8) | the target is within a living settlement's bounds (for `cull`, its herds) |
| World air and heat | `add-air` `atmosphere` (100) `warmth` (80) | aimed at a peopled world |

- **Always free, everywhere** (the floor): help `rain gift heal-person cure plant`; harm `lightning ignite kill-person`; wonder `omen-rainbow weather-aurora-storm`; the warned road `prophet-call prophet-foretell`; the Hand; time; all answers. Content test enforces that this set holds help, harm, wonder and foretelling.
- **Free harms are single-target and cannot be chained.** When bound, `REACH.freeCooldown` applies per power: `lightning` 60 min (its data value), `ignite` 30, `kill-person` 30. No free help carries a cooldown. Content test: every free harm is single-target and cooled; no free power harms an area.

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
- It only works when 3 x the price fits under the cap. At Known (cap 320 or more) a disaster at 240 fits. At Whispered (cap about 89) the local miracles up to 29 fit.

### 3.6 The gathered resource: worship (v2)

**One pool.** The existing worship pool (`ps.worship[0]`, per planet, summed by `worshipOf`) is the one thing spent. Trust and fear both fill it (§10 decision 1).

**One rite, one formula, both roads.** When bound, what one person's rite is worth is:

`rite(p) = 2.5 x faith x (1 + 0.5 x onRoad) x place x (0.5 + piety) x calm x roadYield`

| Part | Meaning |
|---|---|
| onRoad | 1 if the person is on either road (§2.1), else 0. Holding both trust and fear pays no more than holding one |
| place | the town's best finished worship place: temple `1 + min(1, grown believers / 20)`, shrine 1, hearth 0.5, else 0.3 |
| calm | 1 up to fear 0.80, falling in a straight line to 0 at fear 1.0 |
| roadYield | `REACH.trustYield` or `REACH.fearYield` (both 1.0), the two knobs stage 0 uses to equalise the roads |

- When bound, `worshipYield` returns this in place of today's `faith + 0.5 fear` formula, and `addWorship` credits the god `worshipYield` chose (one selection rule, `faith + 0.5 x max(love, fear)`, floor 0.05). Unbound worlds keep today's two rules untouched.

**The town's daily measure.** Once a day, in `reachDaily`, each town gets:

`measure = attended x link x modifier x (sum of rite(p) over its counted believers)`

- Every source below credits through one function, `credit()` (§7.3), which pays only what is left of the town's measure that day and only what fits under the cap. The rest is not paid.
- So the measure is the most a town can give in a day whatever happens in it. All farms by repetition end here (§2.2).
- **attended:** 1.0 if a god-0 act was witnessed in the town within the last 3 days (the stamp the faith decay already reads), else 0.5. A world left on fast-forward gathers at half and loses believers to the existing decay.
- **modifier:** §2.3.

**Sources (all exist except the threshold offering; all pay into the town's measure)**

| Source | Who | Paid | Road counted as |
|---|---|---|---|
| Evening worship | those the existing dusk roll draws (unchanged roll) | `rite(p)` | the person's |
| Prayer (need, hardship, matins, kneeling at the god's passing, possession, a disciple's order) | anyone praying | `rite(p)` at place 0.5 | the person's |
| Sermon | a prophet preaching | `rite(p) x (1 + credibility)` | the prophet's |
| Offering of surplus | a town with a temple-kind building and food to spare | `0.5 x food taken`, share `0.05 x max(mean loyalty, mean fear of its believers)` | trust if mean trust >= mean fear, else fear |
| Feast of the gods (`godsFeast`) | towns with mean trust 0.5 or more | `0.5 x attendance`, as today | trust |
| Sacrifice (`sacrifice()`) | towns whose mean fear exceeds trust by 0.3, with a temple-kind building, 30% of days | `0.1 x grown members`, at most 5 (today: a flat 5) | fear |
| **Threshold offering** (new) | a believer on the road of fear, by roll `0.5 faith + 0.3 fear` (hash of id and day) | `rite(p)`; x1.25 if the town has food to spare and the person burns 0.1 of a food item | fear |

- **The threshold offering** answers the evening worship that fear keeps people from. One hour before the dusk window, the person walks to the shrine, temple or hearth, leaves a portion at the door and goes home (10 ticks of work).
  - It is a new task, `TASK.offer`, appended to the task enum and used only in bound worlds. It is **not** `TASK.worship`.
  - It is not entered in `vespers.went`, so `dusk.today`, `dusk.low` and the emptied shrine at dusk (ARC §1.2) do not move.
  - The heart-sign reader (`arc.ts`) maps it to the existing fear sign, never to `pray` (ARC §1.3).
  - The existing dusk roll then runs unchanged for everyone. A person may do both; the town's measure stops double pay.
- The feast pays only the trust road and the sacrifice only the fear road. Both are inside the measure and both are in the 15% equality target.
- The sacrifice's `+0.01 fear` to the town is kept.

**"As the people connect."** Each town's measure is multiplied by its **link**, `1 + 0.15 x (T + P + K)`, from 1.00 to 1.45. It is worked out in `reachDaily` and stored; a day's credits use the value stored the day before.

| Part | Meaning | Value |
|---|---|---|
| T, trade | the town's rolling traded value (`st.traded`, already decays 3% a day) | `min(1, traded / 30)` |
| P, pilgrims | pilgrims left from or arrived at the town within the last year | 0 or 1 |
| K, kin in the faith | other living towns this town knows in which at least half the grown people are believers | `min(1, towns / 3)` |

- Link reads no trust or fear, so it favours neither road.
- Founding many hamlets does not multiply anything: the measure is a sum over people, the sacrifice is per member, and K is capped at 3 towns.

**The least gift.** Once a day, for the god as a whole: if the day's total gathering on all worlds is below `4 + 0.1 x F` (total F) and at least one believer lives, the difference is credited to the world with the most believers (lowest id on a tie), under the cap. It is outside the town measures. One believer on each of many worlds earns it once.

**Income, first calibration.** A town's measure is about `1.0 x F` a day at a shrine (faith 0.5, piety 0.5) and up to twice that at a full temple. Stage 0 measures how much of the measure each road fills without help, and sets the two yields.

**The cap.** The pool holds at most `capBase[tier] + 3 x F`:

| Standing | capBase | Cap at the threshold F | Cap at the fall line (0.7 x) | Costliest power of the band |
|---|---|---|---|---|
| Unknown | 40 | 40 | - | 100 (heavy hands, free at Unknown) |
| Whispered | 80 | 89 | 86 | 20 |
| Known | 260 | 320 | 302 | 60 |
| Worshipped | 640 | 850 | 787 | 80 |
| Most High | 2 600 | 3 200 | 3 020 | 3 000 (`erase-world`) |

- The cap is enforced **at each credit**: `paid = min(amount, town measure left, max(0, cap - total pool))`, added to the crediting planet's pool. Nothing is taken back later.
- Worship gathered while the pool is full is lost. The gauge is simply full.
- If a fall lowers the cap below what is held, nothing is taken away. The pool gathers no more until it has been spent down.
- Content test: no power costs more than the cap at its own band's **fall line**, and every heavy hand costs no more than the Whispered cap.

**Prices.** The price of a power is its `cost` in `powers.json` x `restraint.costScale` (default 1) x `REACH.priceScale[tier]` (default 1 each; the stage 0 knob for the real-time wait). Its `cooldown` (ticks) applies after a cast that succeeds.

| Band | Charged? | Cheapest | Typical (median) | Costliest | Cooldowns in data |
|---|---|---|---|---|---|
| 0 hands | only the heavy hands, on settled ground | 4 | 6 | 100 | `lightning` 60 min; `REACH.freeCooldown` |
| 1 signs | yes | 5 | 10 | 20 | 30 to 60 min on six |
| 2 local | yes | 10 | 20 | 60 | 1 to 4 h on fourteen |
| 3 regional | yes | 20 | 80 | 80 | 2 h on disasters, 8 h on two |
| 4 world | yes | 60 | 400 | 3 000 | 12 h to 3 days |

- `disciple-order` (tier 1) has no cost in data and stays free. Prayers and sermons it starts pay into the town's measure like any other.
- A power is charged once per command. Held brushes must charge per stroke, not per frame (§7.8).
- **A cast that fails costs nothing.** The charge is checked before the handler and taken only after it succeeds (§7.3). A covenant refusal, a bad target or "no people here" spends no worship and starts no cooldown.

**Always free.** The free floor of tier 0 (§3.2); all story answers; time, save and load; free clay; plumbing commands; rival gods' acts and natural disasters.

**Answering by deed.** ARC §3.3 classifies the god's answer from its first deed on the town and shows no answer menu. So the **first god-0 act on a town with an open defiance (within the 10-day grace) or an open Tower decision is free and ungated up to tier 2**, once per open question. An `omen` as a sign, or a `food-miracle` as mercy, can always be given, whatever the pool or standing. Commands the arc code sends itself carry `origin: 'arc'` and are neither gated nor charged; the client boundary strips that field from player commands.

**A first gift.** The first time ever the god reaches a standing (tier above `reach.best`), the pool is given one typical cast of the new band: 10, 20, 80, 400. `reach.best` only goes up and survives every change of the setting (§7.6), so it cannot be farmed.

**Time is free, and the spec says so.** `speed` is tier 0, so waiting can be shortened by fast-forward. What bounds it:
- The cap: a full pool gathers nothing, so fast-forward cannot hoard beyond one cap.
- Attendance: unattended towns give half, and faith and fear fade, so a long fast-forward shrinks the Following.
- Cooldowns run in game time; the largest are 3 days.
- This is accepted as the limit of the challenge rather than hidden (§10 decision 6). Stage 0 records the default play speed and sets `REACH.priceScale` and the least gift so that, **at the default speed, the wait for the cheapest power of the open band from an empty pool is 3 to 8 real minutes**, at every standing.

**No death spiral: the guarantee, with numbers**
1. Every act that makes a believer on either road is on the free floor: `rain`, `gift`, `heal-person`, `lightning`, `ignite`, `omen-rainbow`, `prophet-call`. An empty pool never stops the god being seen.
2. Worship comes from the people's own rites. The pool refills with no action by the player.
3. The least gift is `4 + 0.1 x F` a day while one believer lives. From an empty pool the cheapest power of the open band is affordable from that alone within 3 game days: Whispered 10 / 4.3 = 2.3 days; Known 10 / 6 = 1.7; Worshipped 20 / 11 = 1.8; Most High 60 / 24 = 2.5.
4. With no believers the standing is Unknown, where the whole of tier 0 is free, heavy hands included. A world with no living person can always be re-seeded for nothing.
5. The pool never goes below zero. There is no debt, no upkeep and no decay. A refused or failed cast charges nothing.
6. Nothing already running is cancelled for want of worship.
7. Spending never lowers standing, and a low pool never causes a fall.
8. Hunger stops only the offering of surplus, the sacrifice and the burnt portion. Evening worship, prayer, the threshold offering and the least gift need no food.
9. An open defiance or Tower question can always be answered by deed, free (above).

### 3.7 One system with restraint mode (v2)
`restraintCheck` in `belief.ts` becomes two functions, `chargeCheck` and `chargeCommit` (§7.3). There is one price list, one pool and one refusal path. The setting has three positions, and one legacy state:

| Setting | `'reach.bound' in laws` | `settings.restraint` | What is charged |
|---|---|---|---|
| **Unbound** (sandbox; all old saves) | no | off | nothing; every power open; bonus potency as today |
| **Belief bounds my power** (new games) | yes | off | tiers 1 to 4 and the heavy hands for god 0; reaching beyond at 3 x |
| **Strict** | yes | on | as above, and every tier 0 power that carries a cost is charged everywhere; rivals pay as they do today |
| *Restraint (old save)* | no | on | exactly today's behaviour: everything charged, nothing gated, no cap, no measure, no least gift |

- The legacy state cannot be chosen. The settings control shows it as a fourth, read-only label, "Restraint (old save)". Moving the control off it is one-way, and the control says so before it moves.
- In Strict the least gift still applies, and `gift`, `ignite`, `omen-rainbow` have their cost waived, so the guarantee holds there too.

## 4. What can be lost, and the floor (v2)

| Cause | What happens | Way back |
|---|---|---|
| The god is unseen | Faith fades 1% a day (0.3% if seen in the last 3 days). The town's measure halves after 3 days. Both roads hold about 65 to 70 days, then F drops | Be seen: any witnessed act |
| The pool is spent | Bands 1 to 4 and the heavy hands wait. The free floor and all answers still work | The people give again every day; at least `4 + 0.1 x F` |
| Pride, the Tower | A proud town's road counts become single. All four Tower answers stay free | Pride ending by any road restores the count |
| Open defiance | The town counts 0 and gives nothing until answered or lapsed. The first deed in answer is free | Any answer |
| Terror | Above fear 0.80 a person gives less, and nothing at 1.0. The count is not touched | Fear fades by itself |
| Shrine burned | The town's place factor drops, so its measure drops. The standing is not touched | Rebuild |
| The god's record of help (`keptBy`, existing) | Help within 2 years raises faith gains and halves faith decay; unprovoked harm subtracts. No new rule | - |
| Covenant broken by the god | The covenant towns count as in §2.3 and give half for one year. This punishes a broken word, not severity | Time, and being seen |
| Open Rebellion (unbuilt) | Rebel towns count 0 and give nothing | Answer it; climb again |

**The floor**
- The free floor of tier 0 is never lost and never charged.
- Arc answers are exempt at every standing and free, including when an answer fires a higher-band power internally.
- A fall is one step per 10 days at most, and it is announced when the count starts.
- `reach.best` is remembered for the Book and the first gift. It does not hold powers open.

**What remains unequal between the roads, stated plainly (§10 decision 3).** The existing sim treats the two differently in ways this spec does not remove:

| Asymmetry in the existing sim | What v2 does about it |
|---|---|
| Fear is quicker to raise (two harms) than trust (two to four helps) and quicker to fade | `fearKeep` equalises how long each road holds unattended. The quicker rise is kept: fear is the faster road to start |
| Loyalty relaxes toward `faith x (trust + 0.5 fear)`, so feared towns have lower loyalty: fewer at the evening, fewer temples wanted (`templeWanted` needs mean loyalty above 0.3), smaller offerings, easier conversion by a rival | The threshold offering replaces the evening. When bound, `templeWanted` also passes when half the town's grown people are on the road of fear. The offering share reads `max(loyalty, fear)`. Rival conversion is not changed |
| `keptBy` raises faith gains from help by up to x1.8 and halves faith decay | Not changed. Measured in stage 0; `fearYield` and `fearLine` are tuned against it |
| Flight from a feared god, and the `burn` defiance, remove people and shrines only on the road of fear | Not changed. These are the people acting, which the god answers |

The probes of §8 require the two roads within 15% on standing, income and sustainable casts. If stage 0 cannot reach that with the knobs above, the lead reports the gap to the owner before stage 1 rather than hiding it in a yield.

## 5. The first hour (v2)
Game time is given first because the real time depends on play speed. The default play speed was not checked; stage 0 records it.

| When | Standing | What the player has and sees |
|---|---|---|
| Start, empty world (`barren`, `sandbox`) | Unknown, free clay | Everything works and costs nothing. The card reads "No one lives here yet." |
| Start, peopled (`shore`, 30 people) | Unknown | All 110 hands free. Card: "No one knows you yet. Whispered when three believe." |
| Second witnessed act (day 1 to 3) | Whispered | Three witnesses pass faith 0.30. Signs open, and the first gift (10 worship) pays for the first omen at once |
| Days 3 to 12 | Whispered | The gauge fills by about 4 to 8 a day. A sign every day or two; free acts in between. The player learns that the people fill the gauge |
| Days 5 to 25 (target: within year 1 to 3) | Known | 20 follow. Local miracles open with a gift of 20. About one local miracle a day can be kept up |
| Target: year 6 to 15 | toward Worshipped | Card: "Worshipped when 70 follow (41 now)." The player deepens belief, lets towns grow, and sees linked towns give more. A disaster can be reached for early at 240 |
| Target: a generation, 25 years or more | Most High | About one world-shaping act every two days; `erase-world` takes more than a year of saving |

- `fewhands` (12 people): Known at F >= 9 by the share path. Worshipped needs F >= 30, so the people must first grow past 15.
- Developed scenarios start with a standing for a limited time and with the pool half full (§7.5).

## 6. UI (v2)
No new screen. Every power is always shown.

- **The god's card (`ui/hud.ts:495-546`).** One thin gauge under the existing worship number (held against the cap) and one line: "They call you the Whispered. 14 follow, most in trust, some in fear." Below it the next step: "Known when 20 follow." While a fall is counting: "Fewer speak your name. Nine days."
- **Trust and fear are told in words, never as two numbers or a bar** (§10 decision 7): "all in trust", "most in trust, some in fear", "as many in fear as in trust", and the mirror forms. This keeps it from reading as an alignment tally. The Following and the worship pool are numbers, because the player needs them to plan.
- **Gauge tooltip.** "Worship 46 of 89. The people gave 9 yesterday, more in trust than in fear."
- **Spending.** The existing floating "-15 worship" on the card now shows on every paid cast.
- **Power card (`ui/tools.ts`, beside `renderNeed`).** One cost line: "Costs 15 worship." Free powers say nothing. A heavy hand: "Free on empty ground. Among the people: 6 worship." One band up: "Beyond your reach. Reach for it: 240 worship." Sigils: "Wider at your standing: x1.5." On cooldown: the existing "still gathering strength" line.
- **Three states in the wheel (`ui/radial.ts` `layPowers`) and the palette (`ui/palette.ts`).**
  - Open and affordable: normal.
  - Open but not affordable: new class `gn-rad-poor`, cost numeral dimmed. Tooltip: "Storm needs 15 worship. 9 is gathered. About a day more."
  - Locked: class `gn-rad-locked`, dimmed, with a small mark of the standing needed. Tooltip: "Beyond your reach. Opens when you are Worshipped: 70 follow."
  - Newly opened powers pulse once.
- **Refusals** come from the sim as sentences, so wheel, gesture, freeform and typed commands read the same. The wait is `ceil((price - pool) / yesterday's income)` days. If yesterday's income was zero: "No one gives to you yet. Be seen."
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

## 10. Open decisions for the owner (v2)

Decisions 1 to 5 of v1 are settled ("all recommended") and `slap` and `stroke` are kept. Eight new ones:

1. **One pool or two.** *Recommended: one pool, called worship, filled by both roads.* Two pools would make every cast a choice of payer and would make a mixed world weaker than a pure one.
2. **The words.** The roads are "in trust" and "in fear"; the resource is "worship". *Recommended: accept.* This is also where to correct my reading of "fear and benevolence".
3. **How equal is equal.** The two roads are built to give the same standing, income and casts within 15%, and to last the same time when the god is silent. Fear stays the faster road to start, and a feared people may still flee or burn a shrine, which a trusted people do not. *Recommended: accept this as "equally strong".* The other choice is to change the fear and trust rates in the sim itself, which would move every arc number already tuned.
4. **Restraint becomes "Strict".** The old toggle becomes the third position of one setting. Old saves that had it on keep it under a read-only label. *Recommended: yes.*
5. **Heavy hands.** v1's free band was approved before ruling (c). As drafted, a short list of the maker's hands costs worship when used among the people: making people, raising shrines and temples, hostile weather over a town, digging or flooding inside a town, changing a peopled world's air and heat (§3.2). Single acts of help, harm and wonder stay free. *Recommended: yes.* Without it the god can drown or burn a town, and make followers, without limit. The other choice is to keep all 110 free and accept that the pool limits only the larger half of the powers.
6. **Fast-forward shortens the wait.** Time controls are free, so a player can speed the clock while the people gather. The cap, the halved giving of unattended towns and the fading of belief bound it, and the prices are set for a wait of 3 to 8 real minutes at normal speed. *Recommended: accept.* The other choice is to make gathering slow down at high speed, which breaks the deterministic clock rule.
7. **Trust and fear in words, not numbers.** The card says "most in trust, some in fear" rather than "nine in trust, five in fear", so it does not read as an alignment tally. The Following and the worship gauge stay as numbers. *Recommended: yes.*
8. **Leaving the bounds.** A player may switch to Unbound at any time; it is the sandbox. *Recommended: allow it, and write one line in the Book of Ages when it happens.*

---------------------------------------------------------------------------------------------------------------------

## Summary for the owner
1. The god still grows as belief grows: five standings, Unknown to Most High, each opening a larger band of powers.
2. There are two roads to standing: people who believe and trust the god, and people who believe and fear the god. Each counts double, and a mixed world simply adds up.
3. Both roads need belief first, both are built to be equally strong within 15%, and neither is called good or evil.
4. The people gather worship every day by their own rites: evening worship and prayer, or an offering left in fear at the shrine door.
5. Each town has a daily measure it can give. Nothing the god does (tormenting a town, walking among it, ordering prayers) can draw out more.
6. Towns that trade, send pilgrims and know other believing towns give up to 45% more. Towns the god has not been seen in for three days give half.
7. Signs, miracles and disasters cost worship, so the god can run out and must wait for the people to give again.
8. Single acts of help, harm and wonder, the Hand with `slap` and `stroke`, and every story answer are always free.
9. New, and needing your answer: a short list of the basic powers (making people, raising temples, hostile weather or digging inside a town) costs worship when used among the people.
10. You can never be stuck: an empty pool refills by itself, the cheapest power of your band is back within three game days, and a failed cast costs nothing.
11. Old saves load unbound and unchanged, and the full sandbox stays a setting. Nothing is built yet; stage 0 measures before numbers are fixed.
12. Eight decisions need your answer (§10). I recommend yes to all eight; numbers 3, 5 and 6 are the ones to read.

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