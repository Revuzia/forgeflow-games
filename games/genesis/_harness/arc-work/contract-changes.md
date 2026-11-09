# ARC §6 contract changes (append-only; who, when, what, why)

- 2026-11-07 render (A-render stint 1): §6.2 TowerView — clarified, not changed in type: `height` is what stands, and on
  a `struck` tower `tiers` keeps the tier count before the fall (render/life/tower.ts heaps `tiers - ceil(height/12)`
  fallen tiers as the rubble mound; if the sim recomputes tiers from height the mound falls back to one tier's worth).
  Sim lane: when building tower.strike, lower `height` to the standing remains and leave `tiers` as it was.
- 2026-11-07 sim (A-sim stint 2), §2.3 `great-tower` building: `materials` are `["mudbrick","brick","stone"]` (the
  material id is `brick`; `bricks` is the recipe) and `work` is 1e7 (the content validator caps work at 1e7; tower.ts
  also resets the record's progress to 0 daily so the building path never finishes it).
- 2026-11-07 sim (A-sim stint 2), §2.3 one speech: each league town's whole `langLine` is set to the host's (same root
  only) every 2 years; replacing only the last element cannot reach distance <= 0.18 when the lines differ in length.
- 2026-11-07 sim (A-sim stint 2), §2.3 site: the rules are ranked preferences (toward the league centroid, slope < 0.08,
  then flattest; slope > 0.5 rejected); dry land and no building within 60 m stay hard rules (coarse n=20 test worlds had
  no cell meeting every rule).
- 2026-11-07 sim (A-sim stint 2), §2.4: after `let` on a rising tower, `canAnswer` is ['confuse','strike'] (the
  standing-tower rule applied as soon as the god has let it stand). Template vars gained host, league, prophet,
  reading, a, b, dead (content.ts TEMPLATE_VARS). `tower.omen` is three ids `tower.omen.starlings|halo|lightning`;
  `tower.struck` with dead is `tower.struck.dead`; "They swore they would build again" is its own line `tower.swore`;
  the silent finish is `tower.finished.silent`. The `tower.struck` event's `tiers` is the number of tiers that fell.
- 2026-11-07 sim (A-sim stint 3), §1.2 dusk flags: vespers attendance tops out near 0.25-0.45 even in a faithful town
  (verifier M3: ema max 0.24-0.32), so the absolute 0.25/0.45 band never armed. Now: the town's own peak
  (`since.duskPk`, half-life 2 y toward the ema, frozen while low) arms the flag once it reaches `ARC.duskArm` 0.18;
  high = min(0.45, 0.85 x peak), low = min(0.25, 0.6 x peak). And hearts keep people home: of those the evening draws,
  `ARC.duskKeep` lets go devoted/quiet 1, restless 0.6, fearful 0.3, defiant 0 (relationship.ts vespers; the rest are
  recorded in the new optional `vespers.away`). `dusk.low` is also set when the kept-home ema (`since.duskAw`) is
  >= `ARC.duskAway` 0.1 and above the dusk ema (the shrine empties because of their hearts); cleared at ema >= high
  with kept-home < half the ema. The old absolute case (0.45 -> 0.25) still sets it.
- 2026-11-07 sim (A-sim stint 3), §6.8 `babel`: a scenario PeopleEntry gains `cluster: { towns, km }`, `pride`,
  `prideYears`, `towerArm` (scenarios.ts clusterPeople); `count` is per town in a cluster. Player-facing name "One speech".
- 2026-11-07 UI (A-ui stint 3), §2.5 Decision card placement: at most **186 px** tall (was 170; the four answers need
  their words on two lines at 888x500, measured in arc-babel-card2: scrollHeight 184). The pill sits top-centre where
  the card was (nothing fits left of the far-left time panel). New: when the bottom-left news column would meet the
  card, the card steps right of it (below the worship panel) if it fits, else the news column yields its top.
  No §6 data contract changed. Test surface (§6.7 neighbour): `G.hold('ui')` added for UI-layout shots.

## Stint 4 (A-sim, 2026-11-07 ~07:50Z) — §2.2 (3) league pride test
- Measured (8 seeds x 60 y unattended, _harness/probes/arc.ts; diag _harness/arc-work/probe-towerdiag.ts): 0 towers on 8/8.
  The leader qualifies on ~3/8 seeds (pride 0.64-0.9, pop >= 60 by ~y25), but its daughter villages stay under the §2.1
  pride floor (pop < 40 -> target 0), so the league (>= 2 towns each pride >= 0.5) never forms.
- Change: a kin village of one speech with population < ARC.pridePop (40) joins the league without the pride test when
  the leader qualifies ("the villages follow the city"). tower.ts leagueOf. ARC.md §2.2 (3) edited.

## Stint 5 (A-sim, 2026-11-07 ~09:40Z) — §2.2 (2)/(4), §2.3 material
- Measured: _harness/arc-work/probe-tcand.ts (8 seeds x 60 y, trigger off, every town's raw §2.2 inputs on each check
  day) + offline _harness/arc-work/tcand-eval.mjs over (towerChance, leaderPride, leaderPop, roll base).
- §2.2 (4) roll gains the world seed: `hashFloat(planet.id, year, 0x70e1, u.seed)`. Every sandbox world's first planet
  has the same id, so all 8 seeds rolled low in the same years (all first attempts at y13.8 in one grid cell).
- §2.2 (2) leader population 60 -> 50 (proud unattended towns peak at 47-56 people before they split); §2.2 (4)
  towerChance 0.15 -> 0.25 (inside the sanctioned 0.06-0.30). Offline: 3/8 seeds begin, first years 14.8 / 17.8 / 24.8,
  median 17.8, <= 1 attempt per seed (T2 targets 2-5/8, median 15-35, <= 2). Live re-run: scratch/arc/t2g.log, t2h.log.
- §2.3 material: what the stores lack, builders who know mudbrick mould at the tower's foot (have = 1). No unattended
  store ever held mudbrick/brick/stone-block, so dh was always halved and T4 (>= 50 % in <= 6 y) failed (9.25 y).
- §2.4 let: the rival-conversion threshold is the disciples' conversion bar (faith > 0.5, god/disciples.ts); for a
  rival god in a town under a standing tower it is 0.45.
- §2.3 crew: `B = Σ max(4, round(0.06 × grown))` (least crew 2 -> 4): unattended towns of ~50 sent 2 builders each, so a
  league of two needed 8.1 y for half its goal (T4 wants <= 6). Sanity line now B ≈ 12, ~6 y for 80 m.
- §8.2 TENSION (open, needs an owner/spec call, NOT tuned): attended pacing wants the first tower in years 7-14 on >= 3/8,
  but (a) §2.2 (1) forbids any tower before world year 10, leaving a 4-year window, and (b) a gentle god who answers
  prayers raises faith, and F = 1 − faith is 20 % of pride, so attended leaders sit at 0.15-0.66 by y20 (stint-4
  t2att: 0/8). Options: count the window from year 10 (10-20 y), or give a favoured, prosperous town a pride source
  (e.g. answered prayers raising P), or accept that a kind god delays Babel (which reads true to the arc).

## Stint 6 (A-sim, 2026-11-07 ~10:40Z) — no §6 contract change
- Tunables only (not bold spec numbers): TOWER.shift 360 -> 600 (visible builders' shift; the walk out is ~750 ticks).
  The towerTask hash miss continues to the next tower instead of returning null.
- §2.3 omens: now picked by fit as the spec words it (lightning needs a storm, halo daylight, starlings always). They do
  NOT go through omens.ts readOmen (that would add `starlings`/`halo` to OMEN_KINDS, i.e. to `god.omen`'s enum and the
  UI omen tables, and tell a second chronicle line); the league reads them with the same kind of effects instead
  (god -1, faith +0.1, feared fear +0.05 / trusted trust +0.03, sees_god, an `omen:tower.<kind>` act).
- §2.4 strike after a refused warning: provoked via since.provoked (regard's class gives trust -0.05).
- people/buildings.ts: a ruined `wonder` (great-tower) is never cleared for a new building (the rubble never clears).

## Stint 7 (A-sim, 2026-11-07 ~11:10Z) — no contract change; §8.2 attended-pacing TENSION measured
- Measured (probe-attwhy.ts, 8 seeds x 14 y, gentle god answering every prayer): leader pride at y10 0.48-0.59, at y14
  0.54-0.69 (4/8 >= 0.62); answered prayers cost up to 0.16 pride through F. With §2.2 (1) towerMinYear 10 and the (4)
  roll `0.25 x clamp((pride - 0.6) / 0.3)` the yearly chance in years 10-14 is <= 0.075, so "first tower in 7-14 y on
  >= 3/8 attended" is unreachable as specified; unattended T2 (3/8, median 17.9) is met and would move with any global knob.
- Owner/spec options (pick one; each is a few lines in tower.ts/arc.ts plus a re-run of probe-t2att.sh and probe-t2.sh):
  (a) accept that a kind god delays Babel: restate attended pacing as "first tower in years 10-25 on >= 3/8"; or
  (b) an "attention" term: while the god has acted on the planet in the last 2 years, the §2.2 roll uses
      clamp((pride - 0.55) / 0.2) and towerChance x 2 (unattended worlds untouched); or
  (c) favour as pride: answered prayers count toward P/L instead of lowering F ("they boast of being chosen").

## Stint r1-1 (A-sim-r1, 2026-11-07 ~19:0xZ) — §2.1 and §2.4 changes (ARC.md edited)
- §2.4 heed: `clamp(0.1 + cred(0.4 + faith0) - 0.15 pride + 0.3 fear + 0.1 trust + 0.15 refusals, .05, .9)`, world-seeded
  (`heedDie`). faith0 = faith + since.tDrain (the tower's drain, reset at beginTower); refusals = since.tRefusals. A heeding
  host, or a league left under two towns, is a heeded ending (sacred place) rather than the plain abandon.
- §2.1 F = max(1 - faith, chosen): option (c) for attended pacing. since.chosenN / chosenT on the rel (prayers.ts answered()).
- No view/event/command shape changed. New `since` keys (tDrain, tRefusals, chosenN, chosenT) default absent = 0: old saves fine.
- All tower.ts rolls now take u.seed (salts kept); strike: regard handles trust/noteHarm within STRIKE_R; scatter site bar 3.4;
  hardship never abandons a `let` tower; the first Decision card is level-based (>= 25 %) and a refusal reopens it.

## Owner rulings 2026-11-08 (applied by the lead; binding, do not revert)
- "its not about g-d being kind or unkind. he is just. they act, the player reacts." -> pride F = 1 - faith; the r1
  'chosen' (answered prayers feed pride) term is REMOVED from arc.ts prideParts; T2 attended pacing DROPPED from §8.2.
  Do not tune tower pacing by the god's behaviour. (prayers.ts still counts since.chosenN; unused, harmless.)
- "confusing the tongues i would imagine would indirectly kill families" -> T6: 0 deaths by the act itself; indirect
  deaths of the scattered (cold, hunger, road) are expected, counted and told. Do NOT add starter fuel/winter delays.
- "a warning prophet should be very rare" -> tower.ts heedRoll: heed = clamp(0.02 + 0.08 cred faith0 - 0.05 pride +
  0.06 fear + 0.02 trust + 0.03 refusals, 0.01, 0.2); T8 rewritten. Do not raise it to make warnings succeed.

## Stage B UI (B-ui, 2026-11-08) — §6.7 additive
- `__GENESIS__.arc.stub` gains kind `'events'`: `SimEvent[] | { events?, chronicle? }`, appended once to the next snapshot
  (src/client/arcstub.ts). Test-surface only; no sim view, event or command shape changed. Lets the UI shoot/test the
  `defy` / `defy.answered` toasts and cues before the sim emits them.
- No other §6 change: the UI reads `SettlementView.defiant`, `heart.defiance`, `heart.answered` and the events
  `defy {settlement, kind, count}` / `defy.answered {settlement, how}` exactly as specified.

## Stage A sim r1, stint 2 (A-sim-r1, 2026-11-08) — owner rulings applied in the sim
- Hearts answer the god's record (owner: "he is just"; M3 kind): regard.ts `keptBy(rel, tick, year, god)` = (help/mercy
  acts on the town's record within 2 years − 2 × unprovoked harm) / 4, clamped 0..1 (0 for a god that never helped: the
  unattended world is unchanged). Uses: a help's faith and trust gains × (1 + 0.8 kept) (`KEPT_GAIN`); god 0's loyalty
  relaxes toward faith × clamp(trust + 0.5 fear + 0.3 kept) (`KEPT_LOYALTY`) at 5 % × (1 + kept) a day; faith's daily
  decay × (1 − 0.5 kept). No pride/'chosen' term. M3 kind (A-sim-r1-kind.ts, 40 bread every 3 days, answer any prayer):
  devoted on 7/8 seeds at day 19-23 of 24 (was 0/8).
- T6 confuse indirect deaths: `TowerState.scatter?: { towns, d0, until, lost? }` (optional; old saves without it simply
  have no count). A year after the scattering the daughter towns' cold + hunger deaths are `scatter.lost`, relStat
  'tower.scatterLost', event `tower.lost {tower, lost, towns}` and the chronicle line `tower.lost` (events.json), once.
  The act itself still kills no one and the Book's confuse entry keeps dead 0.

## Stage C UI (C-ui, 2026-11-08) — §6.7 additive (test surface only)
- `__GENESIS__.arc.stub` gains kinds `'story'` (answers query('story'), per planet / settlement), `'covenants'` (answers
  query('covenants')) and `'refusal'` (harmful casts without `covenant: 'break'` return the §4.4 refusal). Client-side only
  (src/client/arcstub.ts, simclient.ts query/cmd); no sim view, event or command shape changed.
- Readings the UI codes to (please match in the sim, or tell C-ui): `PlanetSnap.age.since` = the AgeRecord's `begun` tick
  (the HUD shows "since year N" from it); `query('covenants', { planet })` -> `{ covenants: (Covenant & { townNames,
  yearsKept, vowWords })[], offers }` (a bare array also works); `CovenantOffer` view `name` = "Flood of Aru" (with or
  without "the"), `household` = clanOf's string ("the house of Hesh"); `CommandResult.refusal = { kind: 'covenant',
  covenant, vow }` read via a cast until types.ts adds it.
- §6.5 `open-book` is detected in the UI as well (src/ui/book.ts openBookIntent): the Book opens whatever the sim answers.

## Stage B sim (B-sim, 2026-11-08) — §3 defiance; additive, no §6 shape changed
- Code: new module `src/sim/god/defiance.ts` (§3 level, acts, answers, memory decay/landmarks/daughters/newborn bias,
  views, query, commands) called from arc.ts heartsDaily / relationship.ts hourly; ARC §0.6 lists arc.ts for this, the
  split is organisational only.
- §3.1 harmLoad: counted once per act (`w` 1 / 0.5 provoked-foretold) plus `w × dead / 10` as the act's dead fall
  (regard.ts endAct; a disaster closes its act every step, so the stage-A +1 per endAct over-counted).
- §3.2 terror (D1): nobody goes out to defy when the town's mean fear (yesterday's) or a person's own fear is >= 0.9
  (`DEFY.terror`). The curse is rolled daily, gathered at the town's dusk window by the hourly pass (the defiant
  hearts, up to 12); hurl is rolled once a day at the hourly check while a god-0 storm (weather.paint storm kinds and
  miracle.storm, tracked as `since.gStorm`), a god-0 disaster or a god-0 harm within the hour is within 1 km of the
  territory; throwers are grown, boldness >= 0.6, trust < 0.35. All rolls also take the world seed.
- §3.2 idol where a rival holds them: the rival's faith +0.1, `defy` event with count 0 and line `defy.rival` (new id);
  no building. The idol building is `idol` ("Carved post", recipe `religion`, appended to buildings.json).
- §3.3: an act already under way before the defiant act (a storm that was there) is no answer. A help act on a town
  with an open window is read by the mercy rule (witnessAct). Answer lines: `defy.mercy|wrath|sign|silence`
  (`defy.silence` = the day-10 patience line), `defy.patience` (the year-on line). The `defy.mercy` text names the
  help (`{what}`: rain, bread, healing, calm, gifts). ArcEvent `answer` for every answer except a silence more than once a
  year per town; ArcEvent `defiance` for the first act of a kind per town in 2 years.
- `defiance.answer` is in WRATHFUL (so it takes `wrath` and, later, `covenant`). It dispatches miracle.lightning 150 m
  beside the town (or its idol), settlement.gift bread 40, or god.omen; patience sets `since.patience` only.
- `SettlementView.heart.answered` is composed from per-town answer counts (`since.aWrath..aPatience`), e.g. "struck
  twice, shown mercy once". `query('defiance')` adds `open`, `idol`, `answered`; `acts` come from `defied` (latest per kind).
- §0.4 memory decay is applied in the daily pass once a year per town (`since.memY`); a landmark is a struck,
  scattered or abandoned tower within 3 km whose ArcEvent the town remembers (strike -> wrath, confuse -> humbled,
  warn -> patience). `freshen(A, s, means, bias?)` takes the newborn bias. Households of fearMigration carry memory x 0.5.
- 2026-11-09 lead ruling, recorded by B-sim: §8 D5 rewritten (ARC.md): not idle defiance at +25 y, but the descendants'
  response to the same provocation (harsh protocol, 1 year) 25 years after the mercy-vs-wrath answers: mean defiance or
  mean fear differs by >= 0.1 on >= 3/4, and the town's remember/answered words tell which answer. The post-harm rally
  stays. Memory weights are raised only if that fails (in proportion, D2 unattended kept at 0 acts).
- 2026-11-09 B-sim: §3.3 "a prophet's word there" built: `prophet.foretell` to the prophet's town with an open defiant
  act classifies a sign (defiance.ts answerByWord), told by the new line `defy.word` ("{agent} spoke the god's word in
  {settlement}, the morning after the shouting.").
- 2026-11-09 lead ruling (D5 option 1), built by B-sim: memory scales the REACTION to a new god-0 harm (ARC.md §0.4,
  §3.1): wf = min(1, wrath), wm = min(1, mercy + 0.5 patience + 0.5 sign), k = DEFY.reactK 0.5: the witness fear gain
  x (1 + k wf), trust loss x (1 - k wm), the defiance jolt x (1 - k wf)(1 + k wm) (regard.ts witnessAct, defiance.ts
  harmReaction / harmJolt). D5 accepts a >= 0.1 difference in mean defiance, fear OR trust. The rally is unchanged.
  The earlier memK experiment stays at 1 (spec weights).
