# GENESIS — POWERS-GROWTH: the god grows as belief grows (binding spec, draft for owner sign-off)

Lead designer, 2026-11-15. This document merges three designs: **FOL** (The Following), **RCH** (The Reach) and **TEL** (The Telling). Where they disagree, this document decides. Nothing here has been built or run: every number is a first calibration, and stage 0 (§9) measures before anything is fixed. No files were written; this text is the whole deliverable.

The owner's ruling (2026-11-15, verbatim): *"powers should reveal as faith/etc. develops - or something like that. i believe black and white works like this where the main player gets stronger and can perform bigger miracles the more people that believe in him - this is a great way to keep players pushing through."*

Clock (ARC): 1 tick = 1 game minute, 1 day = 1 440 ticks, 1 year = 12 days. At 1x a day is 24 real minutes; at 100x it is about 14 s.

**The judgement in brief**

| Design | Kept | Dropped, and why |
|---|---|---|
| FOL (core) | One whole number, five named standings, a band of powers per standing, faith-only measure, miracles widen with standing, law-absent means unbound | The permanent scenario floors (replaced by a timed start, TEL) |
| RCH | The untouched-world rule, a timed penalty for a broken covenant, the "N of M believe" town line, spending worship to reach one band higher | Per-place clamping of every brush (hard to read, 229 param audits, "I asked for a mountain and got a hill") and sign-form disasters (seven new behaviours) |
| TEL | Timed start standing for developed scenarios, the broken word as the only penalty on the god's own conduct, the one-pulse reveal moment | Six domains times five circles (too much surface), tales and rites state, hidden silhouettes (the player must see what exists) |

---------------------------------------------------------------------------------------------------------------------

## 0. Purpose
1. Give the player a reason to keep playing: the more people believe, the greater the works the god can do.
2. Belief is **faith alone**. Awe, gratitude and fear all raise it, so the game does not prefer a kind god or a severe one.
3. Every power is always visible. A power out of reach says in plain words what opens it. There is no score screen.
4. What the people do (pride, defiance, forgetting) can shrink the god's reach. The maker's hands are never lost.
5. This amends CONTRACT pillars 1 and 3: "every power from the start" becomes "every power in sight from the start, in reach as belief grows". Old saves and the sandbox toggle keep the old rule.

## 1. The rule in plain words
- The people give the god a **standing**, in five steps: **Unknown, Whispered, Known, Worshipped, Most High**. It is what they call the god, and it is recorded in the Book of Ages.
- Each standing opens a **band** of powers by scale: the maker's hands, signs, local miracles, regional acts, world-shaping acts.
- The standing comes from the **Following**: how many living people believe, with deep believers counted twice.
- The 14 sigil miracles the god already holds also grow **wider** with each standing above their own.
- Standing rises one step at a time when the Following is large enough and has held. It falls one step when the Following has stayed well below the line for most of a year.
- A world no people have ever lived on is free clay: everything works on it.
- Tower answers, defiance answers, covenant vows, prayer answers, the Hand and time are never out of reach.

## 2. The measure
Player god only (g = 0), all worlds, in agent index order. All inputs are existing fields.

| Term | Definition |
|---|---|
| believer | living person with `A.faith[s*GODS+0] >= 0.30` (the line at which the sim already reads a natural disaster as the god's). Counts 1 |
| devout | the same person with faith `>= 0.55`. Counts 2 in total |
| Following **F** | believers + devout, a whole number |
| popMax | highest total living population ever seen, a ratchet, minimum 12 |
| Share **S** | `F / (2 * popMax)` |

- Not read: trust (`A.love`), fear, loyalty, regard, `worshipBy`, hearts. Each of those weighs kindness and severity differently.
- Counted once per game day in `relDaily`. While the standing is Unknown, also counted at the end of any tick in which a god-0 act was witnessed, so the first rise is not held back by the daily tick.
- The ratchet on popMax means killing unbelievers cannot raise S.
- One wonder gives +0.25 faith, which is under the 0.30 line. A person becomes a believer on the second witnessed act. This is deliberate (slow pacing; a single stunt does not make a believer).

**Modifiers (they read the people's state, never the player's answer)**

| State of the town | Effect on its people's count |
|---|---|
| pride at or above `ARC.proud` | devout count 1, not 2 |
| in open defiance (from the act until answered or lapsed) | count 0 |
| in Open Rebellion (when built, ARC §11) | count 0 |
| the god broke its covenant with this town, for 12 days (one year) after the break | devout count 1, plain believers count 0 |

## 3. Standings and bands

### 3.1 Thresholds (`REACH` table in `src/sim/god/reach.ts`; law `reach.scale`, default 1, multiplies every F number)

| Tier | Standing | Rises when | Held for | Band |
|---|---|---|---|---|
| 0 | Unknown | always | - | the maker's hands |
| 1 | Whispered | F >= 3 | 0 days | signs |
| 2 | Known | F >= 20, or S >= 0.35 | 2 days | local miracles |
| 3 | Worshipped | F >= 70, or S >= 0.60 with F >= 30 | 3 days | regional acts |
| 4 | Most High | F >= 200, or S >= 0.80 with F >= 60 | 6 days | world-shaping acts |

- **Fall:** F below 0.7 x the tier's number **and** S below 0.7 x its share, for 10 days in a row. Then one step down, and the 10-day count starts again.
- A fall cancels nothing already running (a disaster in progress, a held season).
- `minWrath` 0.85 on the largest disasters still applies on top, unchanged. Restraint mode is unchanged and independent.

### 3.2 Bands (new `tier` field on all 229 entries of `src/data/powers.json`; the counts are 110 + 13 + 39 + 45 + 22)

**Tier 0, the maker's hands (110, never locked)**
- Shape (17): `raise lower flatten smooth roughen crater mountains dig-sea paint-sand paint-snow paint-soil paint-ash paint-ice paint-rock paint-lava pin-biome pave`
- Water (6): `pour-water take-water drain rain spring river`
- Sky (18): the 15 `weather-*` powers, `clear-skies wind lightning`
- Time (7): `speed step rewind edit-past save load resume`
- Worlds (5): `add-air atmosphere warmth seed-species recall-ship`
- Life (8): `plant forest paint-biome animals cull breed tame cure`
- Peoples (15): `people found birth gift heal-person kill-person move-person age-person role build possess possess-move possess-act rename-person rename-settlement`
- Fire (2): `ignite extinguish`
- Hand (7): `grab throw release place drop slap stroke`
- Disasters (1): `cancel-disaster`
- Laws (6): `wrath restraint rival rival-remove natural-disasters repeal`
- Signs (18): `omen-rainbow answer-prayer prophet-call prophet-foretell prophet-abandon tower-confuse tower-strike tower-warn tower-let vow-no-flood vow-spare-the-many vow-gentle vow-warn-first vow-none answer-wrath answer-mercy answer-sign answer-patience`
- This band holds help (`rain heal-person gift`), harm (`lightning ignite kill-person weather-hail`), wonder (`omen-rainbow weather-aurora-storm`) and the warned road (`prophet-call prophet-foretell`). Every road to belief starts here. Content test enforces it.

**Tier 1, signs (13)**
`omen sacred-place sacred-animal disciple disciple-order inspire teach forbid sway-belief cast water-miracle fire-miracle wood-miracle`

**Tier 2, local miracles (39)**
- Sigils (10): `food-miracle heal-miracle forest-miracle storm-miracle calm fertility teach-miracle fireball shield meteor-miracle`
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

### 3.3 Bigger miracles inside a band
- For the 14 sigil powers, `CastOpts.power` is multiplied by `1 + 0.25 * (standing - the power's tier)`.
- Example: `water-miracle` (tier 1) is x1.0 at Whispered and x1.75 at Most High. `lightning` (tier 0) is x2.0 at Most High.
- The existing worship bonus (x1.0 to 1.5) still applies. The largest product is 3.0, inside the 0.05..5 clamp.

### 3.4 Free clay (from RCH)
- A world on which no person has ever lived is unbound: every power aimed at it works at any standing.
- The first day a world holds a living person, it is marked peopled for good. Its people dying out does not free it again.
- Star powers (`star-kind star-brightness star-flare`) are free only while no world of that star is marked peopled. `birth-world` is free while no world in the system is peopled.

### 3.5 Reaching beyond (from RCH; optional, stage 6)
- The god may cast one power from the **next** band by spending 4 x its data `cost` in worship. Its data `cooldown` then applies, doubled.
- It never reaches into the Most High band.
- This gives the worship pool a use in default mode. Worship comes from faith, so it is neutral too.

## 4. What can be lost, and the floor

| Cause | What happens | Way back |
|---|---|---|
| The god is unseen | Faith fades 1% a day (0.3% if seen in the last 3 days). F drops slowly | Be seen: any witnessed act |
| Pride, the Tower | A proud town's devout count once. All four Tower answers stay free | Pride ending by any road restores the count |
| Open defiance | The town counts 0 until answered or lapsed. An answer within the 10-day grace costs nothing | Any of the four defiance answers |
| Shrine burned | Worship flow drops (existing), so less potency and less reaching beyond. The standing is not touched | Rebuild |
| Covenant kept | Existing `keptBy` halves faith decay. No new rule | - |
| Covenant broken by the god | The covenant towns count as in §2 for one year. This is the only penalty on the god's own conduct, and it punishes a broken word, not severity | Time, and being seen |
| Open Rebellion (unbuilt) | Rebel towns count 0. This is its mechanical stake: the god sinks one step every 10 days | Answer it; climb again |

**The floor**
- Tier 0 is never lost. It holds 110 powers and every kind of belief-making act.
- Arc answers are exempt at every standing, including when an answer fires a higher-band power internally (`tower-strike`, `answer-wrath`).
- A fall is one step per 10 days at most, and it is announced when the count starts.
- `reach.best` (the highest standing ever held) is remembered for the Book only. It does not hold powers open.

## 5. The first hour
Game time is given first because the real time depends on play speed. The default play speed was not checked.

| When | Standing | What the player has and sees |
|---|---|---|
| Start, empty world (`barren`, `sandbox`) | Unknown, free clay | Everything works on the empty world. The card reads "No one lives here yet." |
| Start, peopled (`shore`, 30 people) | Unknown | 110 powers. Card: "No one knows you yet. Whispered when three believe." |
| Second witnessed act (day 1) | Whispered | Three witnesses pass faith 0.30. Signs open: omens, sacred places, disciples, the water, fire and wood miracles. First Book line |
| Days 5 to 25 (target: within year 1 to 3) | Known | 20 follow, or about a third of a small people counted double. Local miracles open: food, healing, storm, calm, flood, bless and curse, giving a law, peace and war |
| End of the hour and beyond (target: year 6 to 15) | toward Worshipped | Card: "Worshipped when 70 follow (41 now)." The player deepens belief and grows or founds towns. Regional acts sit dimmed in the wheel with their line |
| Several sessions (target: a generation, 25 years or more) | Most High | Needs about 100 deep believers or more. This is the long game |

- `fewhands` (12 people): Known at F >= 9 by the share path. Worshipped needs F >= 30, so the people must first grow past 15. That is the push the owner asked for.
- Developed scenarios start with a standing for a limited time (§7.5), so a spacefaring start is not a god with nothing.

## 6. UI
No new screen. No number is presented as a score. Every power is always shown.

- **The one place for standing: the god's card (`ui/hud.ts:495-546`).** One line under the name: "They call you the Whispered. 14 believe, three deeply." Below it the next step: "Known when 20 follow." While a fall is counting: "Fewer speak your name. Nine days."
- **Wheel (`ui/radial.ts` `layPowers`).** New class `gn-rad-locked` beside `gn-rad-need`: dimmed, with a small mark of the standing needed. Tooltip: "Beyond your reach. Opens when you are Worshipped: 70 follow." Newly opened powers pulse once.
- **Palette (`ui/palette.ts` `powerRows`).** A badge with the standing name on locked rows; the sub text carries the same line. Typed names still find the row.
- **Power card (`ui/tools.ts`, beside `renderNeed`).** The unlock line. For sigils: "Wider at your standing: x1.5." With stage 6: a "Reach beyond: 120 worship" button.
- **`ui/powers.ts`.** `lockedBy(p)` and `reachShort(p)` beside `minWrathOf` and `wrathShort`, fed by `powersQuery`.
- **Town popover (`ui/living.ts`).** "22 of 30 believe." Plus "They count for nothing while they defy you" when that applies.
- **Refusals.** The sim returns the sentence, so wheel, gesture, freeform and typed commands all read the same.
- **Moments.** A toast, one pulse and a Book line on each rise or fall. One new SFX cue. The approved music is untouched.
- **Settings (`ui/settings.ts`).** "Belief bounds my power", beside Restraint. On for new games; old saves load with it off.
- **Text.** One short "Standing" section in `ui/help.ts` and `ui/controlstext.ts`.

Chronicle lines (ARC §0.3 voice, each at most 140 characters), for example:
- "In {town} they speak of the god in low voices."
- "The god is known in {town}, and they leave bread at the stone."
- "From {town} to the far hills they worship the god."
- "Fewer speak of the god now. In {town} the stone stands bare."

## 7. Sim contract

### 7.1 New file `src/sim/god/reach.ts`
`REACH` table, `followingOf(u)`, `reachDaily(u)` (called from `relDaily`), `reachAllows(u, power, actor, p)`, `reachPower(u, power)`.

### 7.2 State (all optional; absent when unbound)
- Law `reach.bound` in `god.laws` (already saved). Absent means unbound.
- `GodState.reach?: { tier, best, up, down, popMax, f, believers, devout, startTier?, startUntil? }`, all whole numbers. Written by `toJson` only when present.
- Peopled marks: `reach.peopled:<planetId>` in the existing `since` map.
- No new typed arrays. `SAVE_MINOR` stays 5.

### 7.3 Gate
- `src/sim/god/powers.ts`, `installPowerHooks` `before`, next to `restraintCheck`: for god 0 only, when `reach.bound` is set, skipping `PLUMBING`, tier 0, free clay targets and arc-origin commands.
- The gate reads the stored `reach.tier`. It never recounts at command time, so replay, rewind and mid-day load refuse the same commands.
- Refusal text: "Beyond your reach. Worshipped when 70 follow; 41 now."
- `castMiracle` multiplies `opts.power` by `reachPower`.
- Rival gods and natural disasters are never gated.

### 7.4 Commands, events, queries
- Command `meta.reach { bound }` (in `PLUMBING`), for the settings toggle.
- Stage 6: cast param `beyond: true`, charged through `spendWorship` and `god.cooldowns`.
- Events `reach.rose { from, to, f }`, `reach.fell { from, to, f }`, `reach.falling { days }`. Each needs an audio cue or an explicit `null`.
- Query `reach` in `REL_QUERIES`: `{ bound, tier, believers, devout, f, share, next: { tier, f, share }, falling, best }`. Mirrored in the snapshot (`sim.ts`) and `client/worldview.ts`.
- `powersQuery` adds `tier` and `locked` to each power, as it adds `minWrath`.

### 7.5 Scenarios (`src/data/scenarios.json`, `world/scenarios.ts`)
Optional `standing` and `standingDays`. The standing is held as a floor for that many days, then the real measure rules. `standingDays: 0` means for good.

| Scenario | standing | standingDays |
|---|---|---|
| `twoworlds-late`, `system` | 2 | 60 |
| `babel`, `coldforge` | 1 | 60 |
| `lookdev` | 4 | 0 |
| all others | 0 | - |

### 7.6 Save migration
- A save with no `reach.bound` law loads unbound, writes no reach state and hashes byte-identical to today.
- The client's new-game path sets `reach.bound`. A bare headless `Universe` does not, so existing tests and golden hashes stand.
- A no-op `reach` step is appended to `LIVING_MIGRATIONS` for the record.

### 7.7 Determinism
Whole-number counting in agent index order, once a day (plus the tier-0 witness recount, inside the command path). No RNG. Sorted keys on save.

### 7.8 To verify in code before stage 2
- Whether `tower-strike` and `answer-wrath` call the registry or the handlers directly. If the registry, they need an origin flag.
- How the 0.35 per-act settlement budget divides among witnesses (it sets how fast F grows).
- Whether `powerOf` can map an odd-parameter command to a lower-tier power and slip the gate.

## 8. Tests and acceptance

**Unit (`tests/reach.test.ts`)**
- Each threshold; the hold days; the 10-day fall; one step at a time.
- popMax ratchet: killing unbelievers does not raise the tier.
- Pride, defiance and broken-covenant modifiers; rivals ungated; arc answers exempt; free clay and its permanent mark.
- `content.test.ts`: every power has a tier; counts are 110 / 13 / 39 / 45 / 22; tier 0 holds help, harm, wonder and foretelling; the `barren` creation chain is all tier 0 or free clay.
- Unchanged because unbound: `omnipotence.test.ts` (22 phrases), `determinism.test.ts`, `arc-determinism.test.ts`, `save-continue.test.ts`. Add one bound save-continue case and one bound determinism case.

**Seeded probes (`_harness/probes/reach.ts`, seeds per LIVING §6.4)**

| Probe | Target |
|---|---|
| Neutrality: helper, warned punisher (default wrath), sign-giver; `shore`, same seed, 2 years | same standing within one step; F within 25% of each other |
| Pace on `shore` and `twoworlds`, one witnessed act per day | Whispered by day 3; Known between day 12 and day 36; Worshipped between year 6 and year 15 |
| Silent god after reaching Known | first fall no sooner than 20 days after the last act |
| Fear farming: tier-0 lightning by a town every day | not faster to Known than the helper script |
| Small people: `fewhands` | Known reachable; Worshipped not before the people pass 15 |
| Old save | loads unbound; hash identical to the pre-change build |

If a pace target fails, tune `reach.scale` and the devout line first. If neutrality fails, tune the witness gains per kind (`belief.gain`), not the gate.

## 9. Build order

| Stage | Work | Model |
|---|---|---|
| 0 | Probe only, no gameplay change: log F, believers and devout per day for the three scripted gods on four scenarios. Fix the numbers in §3.1 from it | opus |
| 1 | `reach.ts`: measure, standings, rise and fall, state, save, query, events. Unit and determinism tests. Gate still off | opus |
| 2 | Tag `powers.json` with `tier` by script plus override list; content tests | sonnet |
| 3 | The gate in the `before` hook, exemptions, free clay, miracle widening, `disaster-random` filter, the §7.8 checks | opus |
| 4 | UI: god's card line, wheel, palette, power card, town popover, settings toggle, help text, UI tests | sonnet |
| 5 | Arc hooks (pride, defiance, broken covenant), chronicle lines, Book line, SFX cue, scenario start standings | sonnet, opus review of the arc hooks |
| 6 | Reaching beyond (optional) | sonnet |
| 7 | Full probe pass against §8, tuning, spec edits to CONTRACT pillars 1 and 3, ARC and STATUS | opus |

## 10. Open decisions for the owner

1. **Default.** New games start with belief bounding the god; old saves load unbound and can turn it on in settings. *Recommended: yes to both.* It keeps every existing world and the pure sandbox.
2. **Do powers go out of reach again when belief falls?** *Recommended: yes*, with the 10-day grace, one step at a time, and tier 0 never lost. A permanent ratchet would make pride, defiance and rebellion cost nothing.
3. **Free clay.** A world no one has ever lived on takes every power. *Recommended: yes.* Without it, `barren` and `sandbox` players cannot set gravity or spin before people exist. The cost is that a world's largest powers close on the day its first people arrive.
4. **Reaching beyond** (spend worship to cast one band higher). *Recommended: build it last, after playtest.* It softens the wait but adds a second rule to learn.
5. **Pride weighs on "let it stand".** That Tower answer may leave a town proud for longer, so its deep believers count once for longer. *Recommended: accept it.* It follows from the people's pride, not from the answer; the neutrality probe will show whether it distorts.

Noted, not a decision here: the catalogue still holds the Hand powers `slap` and `stroke`, which the standing "no slapping" ruling appears to cover. They are placed in tier 0 only because they exist; removing them is a separate task.

---------------------------------------------------------------------------------------------------------------------

## Summary for the owner
1. The god now grows as belief grows: more believers means greater works, as you asked.
2. The people give the god one of five standings: Unknown, Whispered, Known, Worshipped, Most High.
3. Each standing opens a band of powers, from small signs up to moving worlds; the 14 miracles also get wider.
4. Belief is counted from faith only, which awe, gratitude and fear all raise, so a kind god and a severe god grow alike.
5. Every power is always visible in the wheel; a locked one says in words what opens it. There is no score screen.
6. A new player starts with 110 powers that can never be lost, including every way to earn belief.
7. An empty world is free clay: everything works on it until people live there.
8. Pride, open defiance and a covenant the god breaks shrink the Following; a standing is lost only after most of a year, one step at a time.
9. Tower answers, defiance answers, covenant vows and prayer answers are always available.
10. Old saves are untouched and load unbound; a settings toggle keeps the old sandbox for anyone who wants it.
11. Nothing is built yet and no number has been run; stage 0 measures real belief growth before the thresholds are fixed.
12. Five decisions need your answer (§10); the recommended answers are yes, yes, yes, later, accept.