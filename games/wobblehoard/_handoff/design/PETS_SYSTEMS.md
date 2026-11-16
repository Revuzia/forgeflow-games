# PETS_SYSTEMS: lanes, data model and save, the wants clock, the economy, tasks and achievements, seams, budgets, tests, slices, risks

**Lens:** SYSTEMS, ECONOMY, SAVE AND BUILD PLAN (one of the PETS design lenses; voices, toys, care, physics and ideas have their own memos).
**Date:** 2026-10-08. **Status:** design memo, read-only on the game. Nothing under `src/`, `_harness/`, `public/` or another game's folder was touched; no git command was run.
**Owner's words (2026-10-08):** per-squishy voices ("like Pokemon ... say their name, or do cute and fun things"), real toys (a ball, a stick), pets that you feed, give water and
"refill" after a leak, "more interactions, and consider other ideas". The tray the code calls "Toys" holds TOOLS (`src/ui/toyTray.ts:1-3`); `_spec/UI.md:17` (decision 7) frees the word.

**Evidence convention.** **[C]** I read the file this session (`path:line`). **[R]** I ran it this session (command and output in appendix A). **[M]** I computed it from a table or a formula.
**[P]** it comes from my prototype (`proto/`, appendix A), which is designer's scratch code, not game code. **[S]** spec only: I designed it, nothing measured. A claim without a tag is my
design decision. Nobody has listened to any sound (SOUND.md:3), and I did not listen to anything either.

**Scratch folder (everything I ran is here):** `C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967\3b1103ab-0174-4d88-adc9-dd448a718f0d\scratchpad\pets\systems\`
(called `SC` below). Prototype: `SC\proto\care\{registry,engine,store}.ts`, `SC\proto\probe.ts`, `SC\proto\economy.ts`; size and physics micro-benchmarks: `SC\size\`; outputs: `SC\out\`.

---

## 0. The answer in one page

### 0.1 Twenty-five decisions (each is defended in the section named)

| # | Decision | Section |
|---|---|---|
| SYS-1 | A new **CARE lane** owns `src/care/**`: pure TypeScript, no DOM, no three, no `Date.now`, no `Math.random`, no `performance.now` (same rule as `src/core`, `CONTRACT.md:52`). | 1.1 |
| SYS-2 | Per-squishy pet data lives in **its own key `wobblehoard:v2:pets`**, not in the Hoard row and not in `HoardSave`. The Hoard row is a fixed 8-or-9-element tuple that rejects anything longer (`store.ts:85`), and the Hoard serializer writes a fixed field list (`store.ts:259-265`), so an extra field would be silently erased by any older tab or build. | 1.3 |
| SYS-3 | **Saved** per pet: bond points, nickname index, tricks mask, accessories, "favourite found" bits, a day tally. **Saved globally**: lifetime counters, voices heard (256-bit mask), shelf unlocks (monotone). **Session only**: wants, drives, mood, toys on the mat, voice-gate state. Favourites are derived from the item id and never stored. | 1.4, 1.6 |
| SYS-4 | Envelope version 1 with the repo's migration pattern (`save.ts:71-73`, probe row A03), a "newer build" mode that never overwrites, unknown row columns carried through, a parked backup slot. | 1.7 |
| SYS-5 | Orphans (a pet whose item was blended away) are pruned **only** when the Hoard loaded cleanly and **never more than a quarter of the rows at once**; removed rows are parked, not destroyed. | 1.9 |
| SYS-6 | **Naming a squishy hearts it** (existing `Collection.setFav`), and a heart already protects from merge, Tidy-up and trade (`types.ts:168`, COLLECTION.md:560). No new protection code. | 1.9 |
| SYS-7 | **The clock is attended play seconds**, never wall time: it advances only while the game is live and the player touched something in the last 20 s. An hour of an idle open tab advances it by 20 s [P: 19.98 s]. The only date read is the UTC day number, for the daily bond cap. | 2.1 |
| SYS-8 | **Six wants** (food, water, patch, play, wash, rest), session-only, at most one visible, at most 6 a session, 75 to 135 attended seconds apart, a first-minute grace, a 60 s life, back-off when ignored (x2, x4, x8, then the pet stops asking for the session), and a **Quiet pets** switch. Measured [P]: a responder sees 5.7 wants per 15 minutes with a bubble on screen 7.5% of the time; an ignorer sees at most 3 and 17% of the time. | 2.2-2.6 |
| SYS-9 | **Bond** is points that only grow (levels at 5, 15, 35, 70, 120), capped at 10 a pet a UTC day and 14 a session. It unlocks looks, abilities and shelf items, **never** squish points, odds, merge or trade value. | 3.5 |
| SYS-10 | **Economy E0 (recommended): care pays no squish points of its own.** A care gesture that physically is a hold or a stretch pays by the existing rule, nothing else. This is the owner's own rule (`FUN.md:47-48`). | 3.1-3.4 |
| SYS-11 | **Measured cost of E0** [R, P]: an attentive carer (4 wants a session answered, 6-9% of the time in care) earns **7-9% fewer SP per minute**; care designed to be quick halves that to 3-6%; the population mean moves **+9% minutes per capsule if everyone cared attentively, +2.8% at a 30% engagement**. The tax is time, not a rule. | 3.3 |
| SYS-12 | Options to repay the tax (owner's choice, recommended OFF in the first publication): E1 a token dividend (1.5 SP per fulfilled want), E2 a time-neutral dividend (6 SP per want, daily cap 24 SP). Both are farm-proof at the daily cap (24 SP a day = 0.24 capsule) [R]. | 3.2-3.4 |
| SYS-13 | **Scripted touches never reach the meter.** Any reaction that presses the body through the finger path is tagged and dropped from `collection.feed`, haptics and `audio.poke` (the IDEAS lens P1 risk); a probe plays 1000 scripted presses and requires 0.000 SP. | 3.6 |
| SYS-14 | **No care task in the paid task pool in v1.** A care task cannot be judged from the touch log the server replays (`drops.ts:9-10`); the E3 analysis shows what it would do (+2.3 capsules a week for a casual player, nothing for regular and devoted players: the weekly cap already binds). Pet "wishes" and achievements are the rewards. | 4.1 |
| SYS-15 | **Achievements**: 8 in the first publication (4 bronze, 4 silver = 80 XP), 16 for pets overall (260 XP); derived from the pets save, posted only as `forgeflow:achievement { achievementSlug }`, nothing else leaves the device. Seeding the rows is a production database write: the owner's yes first. | 4.2-4.4 |
| SYS-16 | **Settings** gain four optional fields (`voices`, `voiceVolume`, `captions`, `invitations`); absence means "never chose", as for every round-2 field (`settings.ts:93-96`). | 1.10 |
| SYS-17 | **Every seam is optional and feature-detected.** Slices 1 and 2 (voices, moods, names, bond, feed, water) need **no change in `src/physics`**: the existing `burstOpen`, `nudge`, `moveTo`, `tremble` already give the gulp, the hop, the shiver and the speech pulse (`softbody.ts:1194-1229`). New physics members are needed from slice 3 (inflation) and slice 4 (colliders). | 5 |
| SYS-18 | **Voice gate** (rate limits, ceiling, switch, captions, live-region policy) is a system rule, not an audio detail: 1.2 s per pet, 0.4 s global, 2 at once, idle chatter at most 1 per 20 s per mat, never in the first 10 s, live-region lines only for named events. | 2.7, 5.4 |
| SYS-19 | **Budget**: the whole feature set is about **119 KB** of raw minified code (range 83-155), slices 1+2 about 59 KB. With the UI overhaul (90 KB) the current gate G0 (1229 KB) fails before pets: 1143 + 90 = 1233. Recommended: **G0 1,300 KB for the first publication, 1,400 KB when the later slices land** (the IDEAS lens suggests 1,500 KB for its extra phases). The owner decides. | 6 |
| SYS-20 | **Frame budget**: all care JavaScript 0.05 ms a frame (measured 0.0001-0.0006 ms [P]); toys 0.15 ms for three touching toys (measured 0.025 ms for a ball, 0.087 ms for a stick, per frame on one body [R]); the swallow bulge 0.05 ms for the 0.5 s it runs. Toys are refused when the mat is busy (`mat.ts:24`). | 6.2 |
| SYS-21 | **Care is gated, not nagging**: not live during ceremonies, panels, the Snap tool, a cut squishy (pieces are not pets), a hidden tab or a lost GL context. | 2.3 |
| SYS-22 | **Tests**: `probe_care.ts` (node, 40+ checks, I prototyped 26 [P]), `sim_care.ts` (the economy rows), voice gates in `probe_audio.mjs`, physics gates per new member, a `care` section in `browser_shell.mjs` with independent measurements, and three independent verifiers per slice (`RESUME.md:95-102`). | 7 |
| SYS-23 | **Slices**: S1 voices + moods + names + bond; S2 feed and water; S3 leak and refill; S4 toys; S5 the rest. **First publication: S1 + S2** (59 KB, no physics change, one audio lane round, two shell rounds). Toys-first is possible with a proxy toy (S4a, no physics change). | 8 |
| SYS-24 | **Privacy**: no new personal data, no free text, nothing from the pets save leaves the device; the portal receives only achievement slugs. | 1.9 |
| SYS-25 | The code names `toyTray.ts`, `ToyTray`, `createToyTray`, aria-label "Toys" are renamed to Tools by the UI overhaul; pets then own the word "Toys" (the shelf). | 5.5 |

### 0.2 Things I found that change the plan

1. **The Hoard row cannot carry pet data, and a Hoard field would not survive an older tab.** `sanitizeRow` returns null for any row not 8 or 9 elements long (`src/collection/store.ts:85`); `sanitizeHoard` rebuilds the save from a fixed list of fields (`store.ts:225-256`) and `serializeHoard` writes a fixed list (`store.ts:259-265`). A pet field added there is dropped by the deployed CDN build (commit 2683d349, `STATUS.md:4`) the first time it writes. A sibling key is the only layout that survives an older tab, a rollback, and a corrupt Hoard. The repo already does this for the play history (`wobblehoard:v2:play`, `src/shell/playHistory.ts:10`) and the profile (`wobblehoard:v1:profile`).
2. **Slices 1 and 2 need no physics change.** The speech pulse is `burstOpen(0.06..0.12)` (the IDEAS lens's option A, `PETS_IDEAS.md:410`), the gulp is `burstOpen`, the hop and the "come here" are `nudge` and `moveTo`, the shiver is `tremble` (`softbody.ts:1194, 1213, 1223, 1229`; `contracts.ts:145-155`). The first physics seam is slice 3 (`setInflation`); the first real contact is slice 4. This takes the riskiest lane (the 2841-line `softbody.ts`, which has a TRUE CUT round, a LOCK round and a verification pending, `STATUS.md:31-37`) off the critical path of the first publication.
3. **The owner already decided the economy rule.** `FUN.md:47-48`: "Activities pay through the same touch kinds ... cutting, reconnecting, stacking and taking photos pay nothing extra." Care follows it: pays when, and only when, the hand really squeezes or stretches. That makes E0 the consistent choice, not a design preference of mine.
4. **E0 is not free for the player: it costs time.** The care episode keeps the hands off the body. I measured it with the real meter: an attentive carer earns 7-9% fewer SP per minute (section 3.3). That is a real, quotable consequence the owner should see before choosing.
5. **The bundle gate fails before pets.** `1143 + 90 = 1233 KB > 1229 KB` (`STATUS.md:4`, `UI.md:26`), and the G0 gate counts the whole `dist/` including a 167,602-byte `thumbnail.png` ([C] `dist/` listing). Pets add about 59 KB for the first publication and about 119 KB in all (section 6).
6. **Heart already is protection.** `types.ts:168` and COLLECTION.md:560 say a hearted squishy is protected from merge, Tidy-up and trade; the Hoard card already lists a "Nickname" action (a pick from the 24-name list) that is **not stored anywhere yet** (`types.ts:34`). Pets supply the missing storage.
7. **Achievements need rows in a production table, and XP comes only from them.** The portal's `forgeflow:achievement { achievementSlug }` looks up `(game_id, slug)`; tiers map to 5/15/30/60 XP; the rows are seeded by a service-role RPC (`supabase/migrations/0003_achievements_friends_activity.sql:60-72`, `0005_registry_service_writes.sql:58-59`, `games/blocktooth/_spec/online/platform.md:90, 96`). `PUBLISH_CHECKLIST.md` and `_spec/PORTAL.md` do **not exist** yet (`ls _handoff/design _spec`, 2026-10-08 11:3x) [R].
8. **The face has no mouth by a written rule.** `DESIGN.md:701` and `CONTRACT.md:211`. Eating and speaking therefore have to be body language (engulf; speech pulse). I treat that as a fixed constraint and list it as an owner question (section 10, Q3).
9. **A second designer reached the same arithmetic.** `PETS_IDEAS.md:633` recommends a gate of 1,500 KB; its byte calibration (about 30 B per source line, `PETS_IDEAS.md:85`) matches mine (I measured 18-34 B per code line, section 6.1). Its laws L1 to L10 (`PETS_IDEAS.md:133-146`) and its 20 dark patterns (`PETS_IDEAS.md:643-668`) are adopted here as the product contract.

### 0.3 What I built and ran (so the numbers below are measurements, not opinions)

| What | Result |
|---|---|
| `SC\proto\care\*` (registry, engine, store: about 480 lines) | Typechecks clean under the game's own TypeScript 7 with `--strict --erasableSyntaxOnly --verbatimModuleSyntax --isolatedModules` [R] |
| `SC\proto\probe.ts` (26 checks: determinism, no wall clock, idle freeze, governor invariants under fuzz, no-loss under 800,000 random calls, save envelope, two tabs, prune guards, cost, progression) | **26 / 26 pass** [R] (`SC\out\probe4.txt`) |
| `SC\proto\economy.ts` (the real `meter.ts` + the prototype governor, 4 archetypes, 6 scenarios each, 120 sessions of 10 attended minutes per cell, plus a 24-hour farming bot) | Section 3.3 [R] (`SC\out\economy3.txt`) |
| `node _harness\sim_economy.ts --micro` (the unmodified canonical micro section) | Baseline reproduced: squeezer 30.6, puller 28.7, mixed 27.2, poker 13.4 SP/min; bots held to the 40 SP/min valve [R] (`SC\out\baseline_micro.txt`) |
| `SC\size\build.mjs` (the repo's own bundler, `vite build` library mode, minify on) | Prototype 13,624 B raw / 4,925 B gzip for 406 code lines; calibration modules 18-34 B per code line [R] |
| `SC\size\phys_bench.mjs` (the two hot loops a toy contact adds, 642 particles) | Section 6.2 [R] |

**Limits, said plainly.** The machine is shared and was heavily loaded by other jobs (dozens of node and tsx processes), so timings are quoted as best-of-7 with the median beside them. The prototype omits the
store wrapper (throttle, timers, subscription), the achievement evaluator, the copy ids, the voice gate and the idle voice, the cut/Snap gating and the mood "curious"; those are specified below [S], not measured.
The sibling lenses (voices, toys, care, physics) had not written their memos when I looked (`_handoff/design/` held `PETS_IDEAS.md` and the CUT2 memos only), so every item name (foods, toys, accessories, tricks) is a placeholder id to be reconciled in `_spec/PETS.md`.

---

## 1. Lanes, data model, save, version and migration

### 1.1 Lanes and file ownership

`CONTRACT.md:25-43` defines the lanes and says lanes never edit each other's files. Pets add one lane and touch every other lane through **optional** members only.

| Lane | New files | Edited files (additive) | Notes |
|---|---|---|---|
| **CARE** (new) | `src/care/registry.ts`, `engine.ts`, `store.ts`, `achievements.ts`, `copy.ts`, `nicks.ts`, `index.ts`; `_harness/probe_care.ts`, `_harness/sim_care.ts` | none outside `src/care` and `_harness` | Pure TS under `node`. Imports nothing from `three`, the DOM, `core/meter.ts`, `core/drops.ts`, `core/merge.ts` or `core/rarity.ts` (a probe enforces it). May import `core/rng.ts`, `data/catalog.ts` (family and species names), `core/settings.ts` (`StorageLike` type only). |
| **SHELL** | `src/shell/care.ts` (controller, effect executor), `src/ui/careBubble.ts`, `src/ui/captions.ts`, `src/ui/nickPicker.ts` | `game.ts` (about 40 lines: `drainBody` notes, `simStep` update, identity and mat hooks, live gating, dispose), `boot.ts` (create the pets store beside the profile and the Hoard, share the one `subscribe`, flush on hide), `hudBinding.ts`, `settingsCtl.ts`, `src/core/settings.ts` (4 optional fields), `src/ui/settingsPanel.ts`, `src/ui/hoard/*` (card: heard mark, bond, nickname), `debugHook.ts` (dev-only `care`) | The UI overhaul builds the dock, the shelf and the item-picker (`UI.md:17`); pets only add data rows to them. |
| **AUDIO** | `src/audio/pet.ts` (species voices), `src/audio/care.ts` (care sounds) | `engine.ts` (two optional members, a limiter, priority), `_harness/probe_audio.mjs` (voice gates), `_spec/SOUND.md` | Voice recipes are data (appendix C sizes). |
| **RENDER** | `src/render/pet.ts` (expression layer, accessories later), `src/render/toys.ts`, `src/render/food.ts` | `stage.ts` (optional members), `fx.ts` (new `FxKind`s) | |
| **PHYS** | `src/physics/toys.ts` (slice 4) | `softbody.ts` (optional members from slice 3: `setInflation`; slice 4: `setColliders`, `contactReaction`; later `swallow`) | After TRUE CUT and the LOCK round (`STATUS.md:33-34`). Shares its collider primitive with the planned Stamp and Roll tools (`FUN.md:58-59`). |
| **INTEGRATION** | none | `src/contracts.ts` (additive types, `Settings` fields, `FxKind`), `_harness/mocks.ts`, `_harness/run_probes.ts` needs no change (it picks up every `probe_*.ts`, `run_probes.ts:7-9`) | |
| **CORE** | none for E0 | only if the owner chooses E1/E2/E3: `core/meter.ts`, `core/drops.ts`, `collection/ghost.ts`, `sim_economy.ts` | The canonical sim hash (`DESIGN.md:131`) stays unchanged under E0: a gate. |
| **DOCS** | `_spec/PETS.md` (after the fold) | `DESIGN.md` 5.4 note, `CONTRACT.md` lane table and section 6 gates | |

**Ordering constraint.** TRUE CUT edits `src/shell/cut.ts`, `game.ts`, `bodies.ts`, `hudBinding.ts`, `cutBar.ts` (`CUT2_RED_PRODUCT.md` cites `game.ts:623`, `bodies.ts:109`, `cutBar.ts:47`), and the PHYS lane edits `softbody.ts`. All pet edits to those files are small and are made in **one "care seam" change** after the TRUE CUT shell round is committed; everything else is new files that collide with nothing.

### 1.2 Vocabulary

| Term | Meaning |
|---|---|
| **Pet** | The care record of one `HoardItem` (practice ghost or, later, a real item). A squishy without a record is a pet with all defaults; the record is created on its first bond event, nickname or trick. |
| **Attended seconds** | The only clock. Seconds of a live frame in which the player touched something in the last 20 s (2.1). |
| **Want** | A gentle invitation (a small picture bubble) that the active pet shows; never a meter, never a timer ring, never repeated, gone by itself in 60 attended seconds. |
| **Bond** | Points a pet earns from shared play; only goes up; unlocks looks and abilities. |
| **Shelf** | The data list of care items (foods, drinks, toys, fixes, wear) the dock shows; unlimited quantities; no currency. |
| **Session** | One page load (one `createCare` instance). Wants, caps per session and the grace period live here. |
| **Effect** | A numeric command the care engine queues (a want appeared, a joy, a level) and the shell executes (voice, face, bulge, bubble, caption). |

### 1.3 Where the data lives (three options, one choice)

| Option | How | Survives an older tab / rollback | Blast radius | Verdict |
|---|---|---|---|---|
| A. In the Hoard row | a 10th element | **No**: `store.ts:85` returns null for `length > 9`, the row is dropped, the load status becomes `repaired` and the original is parked (`store.ts:391-393`). Every pet would be reported as a damaged save. | the audited Hoard (`probe_collection.ts`, 929 lines) | **Rejected** |
| B. A new field of `HoardSave` | `pets: ...` beside `ghosts` | **No**: `sanitizeHoard` (`store.ts:225-256`) and `serializeHoard` (`store.ts:259-265`) list their fields; an older build drops it on its next write. Two-tab merge (`rebaseHoard`, `store.ts:423-465`) would need pet rules too. | the Hoard store and its merge | **Rejected** |
| **C. Its own key `wobblehoard:v2:pets`** | a sibling envelope, validated against the Hoard's item ids | **Yes**: an older build never reads or writes it | only `src/care/store.ts` | **Chosen** |

Precedent: `PLAY_KEY = 'wobblehoard:v2:play'` (`playHistory.ts:10`), "Stored under its own key ... Ids only, validated on load; nothing here is ever sent anywhere". Backup slots follow the repo's pattern (`PROFILE_BACKUP_KEY`, `HOARD_BACKUP_KEY`):

| Key | Content |
|---|---|
| `wobblehoard:v2:pets` | the envelope (1.4) |
| `wobblehoard:v2:pets.unreadable` | an unreadable blob, at most 20,000 characters, never replaced by a less recoverable one (`PARK_MAX_CHARS`, `constants.ts:27`; the salvage-ranking rule of `hoardSalvageValue`, `store.ts:308-315`) |
| `wobblehoard:v2:pets.pruned` | the rows removed by an orphan prune (1.9), most recent 20,000 characters |

The key names follow "storage keys ... `wobblehoard:*` must never be renamed" (`COMMON.md:43-44`).

### 1.4 The record and the envelope (exact)

```
wobblehoard:v2:pets = {
  "v": 1,
  "rows":   [ PetRow, ... ],              // at most 400
  "totals": [ n0 .. n23 ],                // 24 lifetime counters, TOTALS order
  "heard":  [ w0 .. w7 ],                 // 8 x 32 bits: bit = species idx 0..255 (a voice the player has heard)
  "unlock": { "foods": mask16, "toys": mask16, "accs": mask16 }   // shelf items unlocked by bond; monotone
}
PetRow = [ id, bond, nick, tricks, accs, found, dayKey, dayBond, ...tail ]
```

| Column | Type / range | Meaning | Notes |
|---|---|---|---|
| `id` | string `^[A-Za-z0-9_-]{1,64}$` | the `HoardItem.id` (ghost `g-` + 12 base36, later a server UUID) | `ID_PATTERN`, `constants.ts:45` |
| `bond` | integer 0 .. 960 | bond points | level = number of thresholds reached; thresholds `[0, 5, 15, 35, 70, 120]` |
| `nick` | integer -1 .. 47 | index into the nickname list (-1 = none) | list of 24 exists in `ui/names.ts:5-9`; CARE owns the canonical 48 (append-only), `ui/names.ts` imports it later |
| `tricks` | 16-bit mask | tricks learned | registry `TRICKS`, append-only |
| `accs` | 10 bits | two accessory slots of 5 bits (0 = none) | slot 2 unlocks at bond level 4 |
| `found` | 2 bits | bit 0 favourite food found, bit 1 favourite toy found | the favourite itself is derived (1.5) |
| `dayKey` | integer | UTC day of the bond tally (-1 = none) | the only wall-calendar value; clamped to the Date range |
| `dayBond` | integer 0 .. 1000 | bond earned on `dayKey` | the 10-a-day cap |
| `...tail` | numbers | **unknown columns of a newer build**, at most 8, carried through verbatim | forward compatibility |

**Measured size [P]:** one row is 33 bytes of JSON (`g-cre66i9s,8,-1,0,0,1,20001,8`); 8 pets with some care are 412 bytes (52 bytes a pet including the envelope). The cap of 400 rows is about 14 KB. Typical players bond with 3 to 10 squishies, so the key is under 1 KB.

**Counters (`TOTALS`, append-only):** feeds, drinks, patches, refills, plays, washes, rests, cuddles, calls, named, tricks, favourites (12 used of 24).
**Why counters and not a log:** achievements are a pure function of this save (4.3); a log would be personal behaviour data and would grow.

### 1.5 The registry (append-only lists, like `SPECIES`)

`src/data/species.ts:1-23` states the rule this copies: **never reorder, delete or reuse an index**, because an index is stored.

| List | Entries today | Max | Stored as |
|---|---|---|---|
| `WANTS` | food, water, patch, play, wash, rest | 6 | not stored (session) ; `FX.WANT` payload |
| `MOODS` | content, happy, peckish, thirsty, floppy, wiggly, gunky, sleepy, dizzy | 16 | not stored (derived) |
| `VOICE_KINDS` [S] | name, hum, giggle, oh, yum, sip, sigh, yawn, cheer, ask-food, ask-water, ask-patch, ask-play, ask-wash, ask-rest, pip | 32 | not stored |
| `FOODS` | 3 at the start + 3 unlocked by bond (ids f0..f5; names by the care lens) | 16 | `unlock.foods` |
| `TOYS` | the ball and the stick at the start (the owner's examples) + 2 unlocked | 16 | `unlock.toys` |
| `ACCS` | 2 at the start + 3 unlocked | 16 | `unlock.accs`, `PetRow.accs` |
| `TRICKS` | defined by the voices/ideas lenses | 16 | `PetRow.tricks` |
| `TOTALS` | 12 | 24 | `totals[]` |
| `NICKS` | 48 (the 24 of `ui/names.ts` + 24 new) | 48 | `PetRow.nick` |

**Derived, never stored (the IDEAS lens P6, `PETS_IDEAS.md:159`):** favourite food = `fnv1a(id ^ 0xf00d) % 5`, favourite toy = `fnv1a(id ^ 0x70f) % 4`. They are among the first five foods and first four toys, which never change. The same id gives the same favourite on every device and nothing needs saving; "found" bits record only that the player discovered it.

**Name screening.** Every new nickname passes the same two lists the species names passed: `_harness/data/deny_pokemon.json` and `deny_creatures.json` (probe_catalog section 7, `species.ts:14-20`). The probe is part of `probe_care.ts`.

### 1.6 What is saved and what is session-only

| State | Saved? | Why |
|---|---|---|
| bond points, nickname, tricks, accessories, found bits, day tally | **saved** per pet | the relationship; only grows |
| lifetime counters, voices heard, shelf unlocks | **saved** globally | achievements and the shelf; monotone, so a blended-away pet never costs the player an unlock |
| the current want, its age, the ignore count, caps used this session | session only | wants are invitations of the moment (2.2); a reload starts calm |
| drives and accumulators (squeeze seconds, tosses, strands, touches since play) | session only | they are the clock's inputs (2.4) |
| mood | derived each frame | never stored |
| toys on the mat, food on the table, a half-finished patch | session only | the shelf is the home; a reload puts everything away |
| the voice gate (last voice times, buckets) | session only | |
| which pet is "active" | session only (the play history already stores which squishy was last played, `playHistory.ts`) | |

**Consequence (a design choice with a price).** A reload clears every need. That is the "leaving the game never hurts a squishy" rule made literal, and it keeps short sessions clean: each session opens with a calm pet, a 60 s grace, then at most a few small invitations. The price is that needs can never create a reason to return; I accept it because the owner's rule is "no guilt".

### 1.7 Version, migration, forward compatibility, failures

| Case | Behaviour | Pattern copied from |
|---|---|---|
| fresh (no key) | empty save, **nothing is written until the first bond event** | `playHistory.ts` writes only on `note` |
| older version (`v` < 1: none yet) | step migration table `PETS_MIGRATIONS[n]` turns v n into v n+1, the pre-migration text is kept once under `.v<n>` | `save.ts:71-73, 366` |
| `PETS_VERSION` raised without a step | `probe_care.ts` check fails (row A03 pattern) | `probe_collection.ts:116-117` |
| newer version (`v` > 1) | **run on an in-memory empty save, never overwrite** (status `newer`); the player's pets appear when they update | `save.ts:157, 225`; `store.ts:386-389` |
| row with extra columns from a newer build | carried through verbatim, at most 8 numbers [P: S4 passes] | `settings.ts:170-188` carries unknown keys of a newer blob |
| unreadable JSON | parked under `.unreadable` unless the slot holds something more recoverable; fresh save | `save.ts:231-238` |
| hostile values | every column clamped; bad rows dropped and counted; the count is reported; the original is parked if any row was dropped | `store.ts:225-256, 391-393` |
| storage refuses writes | read back after write; `failing` state reported; the game keeps going | `store.ts:556-557` |
| no storage (private mode) | in memory only | `memoryStorage` fallback, `settings.ts:46` |

[P] checks S1-S4: round trip byte for byte; thirteen hostile inputs (null, numbers, wrong shapes, 500 rows, NaN, 1e99) never throw and always produce a bounded valid save; a v2 envelope is reported `newer`; tail columns survive.

### 1.8 Two tabs, writes, flush

The profile and the Hoard stores already have a re-read-before-write guard and an injected `subscribe` (the window `storage` event, one shared listener, `boot.ts:73, 99, 102`). The pets store reuses that exact subscription.

* **Write throttle:** 2000 ms, like the others (`SAVE_THROTTLE_MS`, `constants.ts:29`). Care events are rare, so a write is at most one per care act.
* **Flush:** on `visibilitychange` hidden, `pagehide` and `dispose`, wired next to `collection.flush()` (`game.ts:859`).
* **Merge (three-way, from a common base)** [P S5, S6 pass]: every field is grow-only, so the merge is conflict-free and order-independent: bond = max, tricks and found = OR, totals = theirs + (ours - base), heard and unlock masks = OR, nickname = the side that changed it (else whichever exists), accessories = the side that changed them, day tally = the later day, else max.
* A pet row is never "deleted" by a merge; only the prune (1.9) removes rows.

### 1.9 The Hoard item, the Practice shelf, merge, trade, cut, privacy

**The Practice shelf rule (COLLECTION C-6, `COLLECTION.md:51`: "Guests get a Practice shelf; 'claim on sign-in' grants nothing").** Pet data is device-only for every item, practice or real. A pet record is **keyed by item id** and never promoted, copied to a server or compared with one. There is nothing to forge: bond cannot be exchanged for an item, a tier, squish points or a trade, so a hand-edited pets save mints nothing (the worst case: someone gives their own squishy 960 bond points).

| Situation | Rule | Evidence / check |
|---|---|---|
| A squishy without an item (`?genome=` preview, `identity.itemId === null`, `bodies.ts:21`) | no pet record, no persistence; voices still play, wants never appear | probe: `focus(null)` is a no-op |
| **Merge (blend)** consumes two parents (`MergeOk.parents`, `types.ts:299`) | the parents' rows are removed (parked, 1.3), the result starts fresh with an optional **heritage**: `+floor(best parent bond / 12)` points, at most 3 | the ceremony text stays positive; the result item is a new id |
| Naming a pet | calls `collection.setFav([id], true)` **once** (the heart protects from merge, Tidy-up and trade, `types.ts:168`); the player can un-heart it later; the merge pad shows "has a name" when a named pet is selected | COLLECTION.md:560 |
| **Trade** (real ledger, planned) | the item changes owner; the receiver has no row, so bond restarts at 0; the giver's row is pruned by 1.9. Bond is never shown on the board or in a trade card, so it cannot become a price. | tier parity, `DESIGN.md` 5.7 and 5.8 |
| **Cut** | care is suspended while the squishy is in pieces (`cut.pieceCount > 1`); pieces are not pets (`ExtraBody.piece`, `bodies.ts:35`); **Reconnect all** resumes it. Wants are not cleared. | |
| **Snap** | no bubbles, no wants, no voices while the Snap tool is in hand (a clean frame) | `setTool('snap')` puts the capsule away the same way (`game.ts:436`) |
| **Ceremony** (capsule, merge) | not live; the new squishy gets its "hello" voice at the `reveal` beat | `ceremonies.active` |
| **Orphans** | at load and after each Hoard change, rows whose id the Hoard no longer has are removed **only if** the Hoard load status is `ok`, `fresh` or `migrated` (never `loading`, `recovered`, `repaired`, `newer`, `unavailable`, `store.ts:317-325`) **and** at most `max(2, floor(rows/4))` rows would go; otherwise nothing is removed. Removed rows go to `.pruned`. | [P] S7, S8, S9 pass: "everything is gone" removes nothing |
| **Privacy** | no free text anywhere (`DESIGN.md:671-679`); the nickname is an index; nothing from the pets save is sent in any `wh_*` call or any bridge message; the portal gets only `{ type: 'forgeflow:achievement', achievementSlug }` | grep `postMessage` in `src/care` returns 0 |
| **Clock skew** | a player who sets the device date back resets only the **bond day tally**; the per-kind caps (2 for the first of a kind, 1 for a repeat) and the 14-per-session cap still bound the gain to 14 points a session. Cosmetic only; no monetary value exists. | [P] Q3: spamming every care act 240 times pays 10 |

### 1.10 Settings (additive, optional)

`Settings` fields are added the way round 2 added theirs (`contracts.ts:428-442`, `settings.ts:93-110`): optional, absence = "never chose", the default is supplied at use time.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `voices` | boolean | true | species voices and care sounds that are voices; **its own switch**, independent of the master volume and the mute |
| `voiceVolume` | 0..1 | 0.7 | relative to master; a separate peak ceiling is set by a test chime (IDEAS AC-02) |
| `captions` | boolean | true | speech bubbles and live-region lines for voices; kept when muted (sound off keeps every visual cue, `DESIGN.md:610`) |
| `invitations` | boolean | true | pets may show wants; **false = "Quiet pets"**: nothing is ever asked, manual care still works |

`SETTING_KEYS` and the `OPTIONAL_UNITS` / `OPTIONAL_BOOLS` lists in `settings.ts:108-110` gain these; `saveSettings` already carries unknown keys of a newer blob (`settings.ts:170-188`). `calm` (follows `prefers-reduced-motion`) is read as before: no bubble bob, no hearts, speech pulse capped at 2%, no hops.

---

## 2. The clock: how wants appear without wall time

### 2.1 The rule and the definition

**No code path in `src/care` reads a wall clock.** `Care.update(dt, live, touching)` receives the simulation step; the UTC day number enters only through an injected `dayKey()` and is read only when bond is granted (the daily cap). A probe instruments `Date.now`, `performance.now` and `Math.random` while a 12-minute session runs and requires zero reads [P D3: 0 reads]. This is the `CONTRACT.md:52` rule for `src/core`, extended to `src/care`.

**Attended seconds** (per pet) advance by `dt` only when all of these hold:

| Condition | Where it already exists | Why |
|---|---|---|
| `live`: the phase is `play`, no pause reason (hidden, context lost, covered), no input hold, no ceremony, the tool is not Snap, the squishy is not in pieces | `inputLive()` is `phase === 'play' && reasons.size === 0 && holds.size === 0 && !ceremonies.active` (`game.ts:614`); Snap and Cut are `tool` (`game.ts:67`) | an open panel, a hidden tab or a reveal must not tick the clock |
| the player did something in the last **20 s** (`idleFreezeS`) | `touching` is `driver.touch.contact()` (`game.ts:392`) or a care act in progress | a tab left open on a phone earns and costs nothing |

[P]: **an hour with nobody touching** advances the attended clock by 19.98 s and raises no want and no bond (check D4); **an hour not live** advances nothing (D5); the same seed and the same script give an identical want log and an identical save (D1).

**What "away" does.** Nothing. There is no read of the elapsed time between sessions, so there is nothing to decay, nothing to catch up, no "welcome back" counter. A year-long gap leaves the save byte-identical except for what the player does next. A verifier sets the clock a year ahead and diffs the save (`PETS_IDEAS.md:137`, law L1).

### 2.2 The six wants

A want is a gentle invitation: a small picture bubble on the active pet that leaves by itself. Never a meter, a counter, a ring, a sad face or a repeat (laws L2, L5). The triggers are **events or attended seconds**, accumulated per pet per session.

| # | Want | Trigger (accumulator) | Threshold | What answers it | Reset |
|---|---|---|---|---|---|
| 0 | **food** | attended seconds since it last ate (or since the session began) | 140 s, jittered +-30% per pet | any food (a pet is never refused: an unasked snack is welcome and pays the same bond rules) | on any food; on a fade |
| 1 | **water** | seconds of squeezes held 0.4 s or more since it last drank | 36 s; **18 s for liquid families** (water fill, bead squeeze: they slosh) | any drink | on any drink; on a fade |
| 2 | **patch** (a tiny soft spot) | a **hard event**: a toss landing of 0.85 or more, a full stretch (level 0.97) held 2 s, a hard toy hit of 0.9 (slice 4); then a 35% chance | one pending leak at a time; 240 attended s between leaks | patch, then refill to 0.95 of its size | on the refill; on a fade |
| 3 | **play** | touches since the last toy play (only offered when a toy is on the shelf) | 14 | any toy played with | on a toy; on a fade |
| 4 | **wash** | strand snaps since the last wash, **tacky families only** (sticky stretch, slime goo) | 5 | the sponge / bubbles | on a wash; on a fade |
| 5 | **rest** | tosses and lifts since the last rest, or attended seconds since the last rest | 3 tosses or 300 s | the cushion | on a rest; on a fade |

Precedence when several are due: **comfort first**: patch, rest, water, food, wash, play. One want at a time, per pet and on the mat. Material classes (`FAMILY_CLASS`): plain (8 families), liquid (waterfill, beadsqueeze), tacky (stickystretch, slimegoo).

**Mood is derived**, never stored: `dizzy` (a toss in the last 4 attended s) > `floppy` (patch open) > `sleepy` > `thirsty` > `peckish` > `gunky` > `wiggly` (play) > `happy` (a care act in the last 8 s) > `content`. The face, the voice kind and the bubble read the mood.

### 2.3 The governor (constants, with the reason for each)

| Constant | Value | Why |
|---|---|---|
| `idleFreezeS` | 20 s | an open tab costs nothing |
| `graceS` | 60 attended s after a focus (a switch, a session start) | a short session of three minutes sees at most one invitation; switching squishies is not nagged |
| `gapS` | 75 to 135 s (uniform) from the end of the last want | about one invitation every two minutes at most |
| `ttlS` | 60 attended s | an unanswered want fades quietly (a soft "sigh" voice, no distress; mood returns to content) |
| `ignoreStop` / `ignoreBackoffMax` | 3 / x8 | each unanswered want doubles the next gap (x2, x4, x8); after 3 in a row the pet stops asking for the rest of the session |
| `globalGapS` | 20 s | on a mat of five, one pet asks at a time |
| `sessionCap` | 6 wants per pet per session | even a devoted player is not worked |
| `dismissQuietS` | 300 attended s | the bubble has a quiet "not now"; that kind sleeps for five minutes |
| fade quiet | 120 s for the kind that faded | |
| `invitations` setting | false = none | **Quiet pets** |
| only the **active** pet asks | the play body or the mat pet the fingers last touched | the others may speak idly (2.7) but never ask |

A reply (any care act that answers a need) resets the ignore count; a **cuddle or a call does not** (an ignorer who hugs the pet is still ignoring its invitations, [P] after the fix).

### 2.4 What feeds the accumulators (all of it already exists)

`SoftEvent`s are drained per body in `drainBody` (`game.ts:525-548`), which already knows which body the event is from (`b === activeBody()` or an `ExtraBody` with an `itemId`, `bodies.ts:32-36`). The shell adds one call per mapped event; each is allocation-free.

| Existing source | Care call | Effect on the pet |
|---|---|---|
| `SoftEvent poke` (a tap) | `noteTouch(id)` | `accPlay` + 1; keeps the attended clock alive |
| `release` with `heldFor` >= 0.4 s (`meterfeed.ts:49-54`) | `noteSqueeze(id, heldFor)` | `accWater` += heldFor; a hold of 1.5 s or more on a calm pet is a **cuddle** (bond + 1, at most one per 60 attended s, 3 a session) |
| `snap` (`meterfeed.ts:55-61`; intensity = pull level, `heldFor`) | `notePull(id, level, heldFor)` | a level >= 0.97 held >= 2 s is a hard event (leak chance) |
| `land` (intensity) | `noteLand(id, intensity)` | >= 0.85: a hard event |
| a carried body thrown (`feedback.ts:186-189`) | `noteToss(id, speed)` | `accRest` + 1, `dizzy` for 4 s |
| `metrics.strands` break (`feedback.ts:253-256`) | `noteStrand(id)` | `accWash` + 1 (tacky families only count) |
| toy world hit (slice 4) | `noteHit(id, intensity)` | >= 0.9: a hard event |
| the shell: a care act | `act(id, kind, arg)` | see 3.5 |

[P] costs: `noteTouch`/`noteSqueeze`/`noteToss` take 50 ns each when the machine is quiet (910 ns loaded); `update()` with five pets on the mat takes 0.138 us a frame at its best of 7 runs (median 0.187, max 0.414; an earlier loaded run gave 0.616 best / 7.4 median) and grows the heap by 5 KB over 2.8 million frames (check P2). The budget I set for all care JavaScript is 0.05 ms a frame.

### 2.5 Fade, dismiss, and what an ignored want costs: nothing

* A want older than 60 attended seconds **fades**: a quiet effect, the mood returns to content, the accumulator resets, the kind sleeps for 120 s, the ignore count rises. **There is no consequence for the pet**: no state worsens, no bond is lost, nothing is flagged for later.
* **A leak never outlives its want.** When the patch want fades or is dismissed, the shell calls `setInflation(1, 6)`: the soft spot seals itself and the pet rounds back out over 6 s. A pet is never left deflated, there is no "ill" state, and nothing about a leak is saved (a reload also ends it).
* "Not now" (the bubble's quiet button, or Escape on it) is the same, with a 300 s sleep.
* A pet with an open want that the player never answers is **never shown as sad**: the bubble is a picture with positive affect (law L2), the eye emote list is closed (`PETS_IDEAS.md:138`).

### 2.6 What the governor does to real play [P, `SC\out\probe4.txt`]

120 sessions of 15 attended minutes, four player types, fuzzed event streams; one pet each.

| Player | Wants per 15 min | Faded | Bubble on screen | Bond per session |
|---|---|---|---|---|
| responder (answers 90% in 2-9 s) | 5.67 (cap 6) | 11% | **7.5%** of the time | 9.4 |
| slow (70%, 15-50 s) | 4.93 | 25% | 21.6% | 8.2 |
| ignorer (never answers) | **2.67** (never more than 3) | 93% | 17.1% | 3.0 |
| frantic (answers in 0.2-0.5 s, touches 4 times a second) | 6.00 (the cap) | 0% | 0.3% | 8.9 |

Checks that pass [P]: consecutive wants are at least 75 attended seconds apart (min seen 75.0 s, G1); no pet is offered more than 6 (G2); an ignorer is offered at most 3 (G6); the effect queue never overflows (G3); bond never exceeds 10 a day or 14 a session (G4); the bubble is on screen at most 30% of a session (max seen 25.3%, G5); **no field of the save ever decreases** across 800,000 random calls (N1).

**What a short session looks like.** A three-minute session: the first invitation can appear no earlier than 60 s; with the typical 75-135 s gap there are 1 or 2 in three minutes, usually one. A ten-minute session sees about 4.2 wants offered [R economy3]. "Short sessions must feel good" holds because nothing is waiting at the start and the cap is small.

### 2.7 The voice gate (a system rule; the voices lens designs the sounds)

All pet sound goes through one function in the shell so the rate limits cannot be bypassed. Numbers adopt `PETS_IDEAS.md:156` (P3) and add the live-region policy.

| Rule | Value |
|---|---|
| per pet, between two cries | >= 1.2 s |
| globally, between two cry starts | >= 0.4 s; at most 2 sounding at once |
| idle chatter (no touch) | at most 1 per 20 s per mat and never in the first 10 s of a session; it obeys the `voices` switch, not `invitations` (which only controls wants) |
| a cry that answers a touch | at most one per 1.5 s per pet; never while that pet's fingers are down on it |
| never during | a ceremony, the Snap tool, a cut in progress, the first 400 ms after a switch |
| level | peak -20 to -9 dBFS after the chain at master 1 for answers, <= -16 for idle chatter; the music "makes room" under it like under any effect voice (`SOUND.md` round 3) |
| ceiling | the player's `voiceVolume` and a separate hard peak ceiling set by a test chime (IDEAS AC-02) |
| polyphony | priority between one-shots (0) and a held squish (1): a cry is never stolen by a flurry of pokes and never steals a ceremony voice (the engine has priorities 0/1/2, `SOUND.md:101`) |
| rough handling | a toss or a hard landing makes a surprised or delighted cry, **never a pain sound** (law L6, dark pattern 14) |
| **captions** | every cry produces one caption, derived from the species name and the cry kind (16 templates, no per-species strings): "Dollop says its name", "Dollop hums". On screen as a bubble (if `captions`), and in the live region **only for named events**: a greeting on switch, a want appearing, a want answered, a level up. Idle chatter and answers to touches get the bubble only, so a screen reader is never flooded (the announcer merges bursts within 250 ms, `announcer.ts:3`, but is still polite and sequential). At most one live-region line per 4 s. |
| `muted` / `voices` off | silence is exact; the bubble and the speech pulse remain ("sound off keeps every visual cue", `DESIGN.md:610`) |

### 2.8 Away, hidden, resumed, skewed

| Situation | What happens |
|---|---|
| tab hidden / `pagehide` / phone call | the sim and audio pause (`setPaused`, `game.ts:508-520`); the care clock does not advance; saves flush |
| tab hidden more than 60 s (`HIDDEN_RECONNECT_MS`) | the cut squishy reconnects (existing); care is unchanged |
| WebGL context lost | `suspend('context')`; not live |
| reload | a fresh session: no wants, 60 s grace, caps reset; bond, names, unlocks persist |
| device date moved | only the bond day tally is affected (1.9) |
| daylight saving, time zones | irrelevant (UTC day number only) |
| two tabs open | each tab has its own session; the saves merge grow-only (1.8) |

---

## 3. The economy

### 3.1 What is fixed already (read this session)

| Rule | Where |
|---|---|
| taps pay nothing; a squeeze held >= 0.4 s pays 0.7 + 0.6/s (hold counted to 3 s), +0.5 soft pop at 1.8 s; a stretched release pays 1.0 + 0.65/s; medley +2; freshness (tau 2.4 s squeeze, 3.0 s pull, floor 0.03); valve 40 SP/min; 100 SP = a capsule (30, 50, 75 first); 12 capsules a day from play | `meter.ts:65-117`; `DESIGN.md:251-262` |
| **"Activities pay through the same touch kinds. A toss pays like a pull; a stamp or a roll pays like a squeeze ...; cutting, reconnecting, stacking and taking photos pay nothing extra."** | `FUN.md:47-48` (owner direction, 2026-10-06) |
| tasks pay one capsule each, 2 offered a day, at most 5 a week, judged by the server from the touch log | `drops.ts:115-117, 130`; `DESIGN.md:316` |
| no streaks, no countdown FOMO, no guilt, caps framed as rest | `DESIGN.md:689` |
| no paywall, ads or currency; no paid randomness | `DESIGN.md:665-669` |
| the canonical sim output hash, which every quoted number rests on | `DESIGN.md:125-133`; headline numbers now 3.5 min/capsule, 247 / 153 days (`DESIGN.md:246-248`) |

Baseline reproduced this session [R, `SC\out\baseline_micro.txt`]: poker 13.4, squeezer 30.6, puller 28.7, mixed 27.2, tapper 11.1, holder 31.0 SP/min; the population mix averages 23.1 SP/min = 4.3 min per capsule; bots are held to the valve (best squeeze 39.9, held stretches 39.2, cycler 40.0).

### 3.2 The options (what each one is)

| | Rule | New code in | Server impact |
|---|---|---|---|
| **E0** (recommended) | Care pays nothing of its own. A care gesture that physically is a hold or a stretch of the body (a held squeeze to pump a refill, a cuddle) pays exactly by the existing rule, with the existing freshness, valve and cap. Care is rewarded in **bond**, looks, abilities, shelf items and achievements. | none in `core`, `collection` or the sim | none |
| E1 | E0 + a **token dividend** per fulfilled want: 1.5 SP x freshness, once per want | `meter.ts` (a new touch kind or a grant), `ghost.ts`, `meterfeed.ts` | a new play-report kind `[3, wantKind, dtMs]` with its own freshness, valve share and cap |
| E2 | E0 + a **time-neutral dividend**: 6 SP x freshness per fulfilled want | as E1 | as E1 |
| E3 | care tasks join the paid task pool ("Give someone a drink" pays a capsule, within the 5 a week) | `drops.ts` (`TaskDef.metric`), `ghost.ts` (`bumpTasks`), probe rows | the server cannot judge care from the touch log (`drops.ts:9-10`); it needs care events too |

Dividend rule used in the simulation (E1/E2): `pay = D x clamp(((t - tLast) / 90 s)^2, 0.03, 1)`, once per fulfilled want, daily dividend cap 24 SP, counted toward the daily capsule cap and the valve in a real build.

### 3.3 Measurements [R]: the real meter, the prototype governor

`SC\proto\economy.ts`: free-play touches use exactly the sim's human model (`sim_economy.ts:128-178`: kind by archetype, hold lengths, pauses); the wants come from the governor, fed by those same touches; an answered want keeps the hands busy for a per-kind time (food 7-11 s, water 6-9, patch+refill 10-15, play 20-40, wash 8-12, rest 4-7); the player starts 2-9 s after the want appears and keeps playing meanwhile. 120 sessions of 10 attended minutes per cell, the same seeds in every scenario. "Holds" = a refill is a held press on the body (3-8 s) and half the acts end with a cuddle (1-2.5 s); "quick" = every episode is half as long.

SP per minute (change against the same archetype with no care at all), and minutes per capsule at 100 SP:

| Archetype | No care | Attentive 90%, drag-only care (E0) | + care has holds (E0) | + token dividend 1.5 (E1) | + dividend 6 (E2) | Quick care x0.5 (E0) | Casual 50% (E0) |
|---|---|---|---|---|---|---|---|
| poker | 13.4 (7.45 min) | 12.2 (-9%, 8.22) | 12.5 (-7%) | 12.7 (-5%) | 14.2 (+6%, 7.05) | 12.7 (-5%) | 12.8 (-4%) |
| squeezer | 30.6 (3.27) | 28.3 (-7%, 3.53) | 28.5 (-7%) | 28.9 (-6%, 3.47) | 30.3 (-1%, 3.30) | 29.2 (-4%, 3.42) | 29.6 (-3%) |
| puller | 28.6 (3.50) | 26.0 (-9%, 3.85) | 26.3 (-8%) | 26.5 (-7%) | 27.9 (-2%, 3.58) | 27.0 (-6%, 3.71) | 27.3 (-4%) |
| mixed | 27.0 (3.71) | 24.6 (-9%, 4.06) | 24.9 (-8%) | 25.2 (-7%) | 26.6 (-1%, 3.76) | 25.6 (-5%, 3.90) | 25.8 (-4%) |

Other columns of the same run: wants offered / answered per 10-minute session 4.1-4.3 / 3.7-4.0 (attentive) and 3.0-3.2 / 1.5-1.8 (casual); share of time with the hands in care 6-9% (attentive), 3-5% (quick, casual); the busiest rolling minute of the touches alone is 37-40 SP, at the 40 SP valve. (E2's busiest minute shows 41-46 only because my sim adds the dividend outside the valve; a real build passes it through the valve, so it is clamped at 40.)

**What the table says.**

1. **E0 costs the attentive carer 7-9% of SP per minute, and that is purely time**: 6-9% of the session is spent with the hands on the shelf (plus the touch in progress when the episode starts, plus 0.8 s to start again). Tax per fulfilled want = (answered wants a minute x (episode seconds + 2.3 s)) / 60 of the session. Holds inside the care repay only 0-2 points (the pay cap is 3 s and freshness still applies).
2. **Quick care halves the tax** (-3% to -6%). The design lever is to keep a care act short (a drag and a drop is 3-5 s; toy play is longer but is the player's choice, not an invitation).
3. **A token dividend (E1) repays about 1.5-2 points; a time-neutral dividend (E2, 6 SP) repays 6-8 points.** The break-even dividend per fulfilled want is 6.1 SP (squeezer), 7.0 (puller), 6.5 (mixed), 3.2 (poker) [M from the table: loss per minute / answered wants per minute].
4. **Population effect [M]** with the sim's mix (poker .38, squeezer .27, puller .15, mixed .20): no care 23.04 SP/min = **4.34 min per capsule**; everyone attentive under E0 21.10 = **4.74 (+9.2%)**; everyone quick 21.88 = 4.57 (+5.3%); everyone casual 22.11 = 4.52 (+4.2%); E1 attentive 21.66 = 4.62 (+6.4%); E2 attentive 23.08 = 4.33 (-0.2%). Realistically only a share alpha of play time is spent in attentive care: the effect is alpha x 9.2%. **At 30% it is +2.8%: the regular median 3.5 min becomes 3.6, "all 50" for a regular willing trader moves 247 / 153 days (`DESIGN.md:248`) by about +7 / +4 days.** The paying-style band of 3.0 to 3.8 min (`DESIGN.md:284`) is left by the puller (3.85) and the mixed style (4.06) only if they are fully attentive carers with long episodes.
5. **Farming is not a path under any option [R].** A bot that taps once a second to keep the attended clock alive, answers every want in 0.3 s and reloads the page every 20 minutes (the worst case for the session cap) is offered 18 wants an hour; with E1 or E2 the daily dividend cap (24 SP) binds: **0.017 SP/min, 24 SP a day = 0.24 of a capsule a day**, against the 40 SP/min valve and 12 capsules a day for touching. Under E0 it earns exactly 0.000.
6. Care never opens a cheaper way to earn: the leak/refill loop is at most one leak per 240 attended seconds, so a refill hold of 3 s (2.65 SP at full freshness, less after) is worth at most 0.7 SP/min even if a player could trigger leaks at will; the existing remaining cheap path (a 0.4 s press every 2.4 s = 23.5 SP/min, `STATUS.md:41`) is unchanged.

### 3.4 Recommendation and guardrails

**Ship E0.** Reasons, in order of weight: (1) it is the owner's own rule (`FUN.md:47-48`); (2) it changes no number in `DESIGN.md` 5.0-5.12, so the pending doc re-quote pass (`STATUS.md:37`) does not grow; (3) the server contract is untouched: care events never need to be replayed or judged; (4) care that pays invites optimising a pet, which is the chore loop the dark-pattern list refuses (`PETS_IDEAS.md:654`, row 6); (5) the cost is measured and bounded (section 3.3) and falls with the design lever of short care.

**State the cost to the owner in one line:** "Playing with the pets is time not spent squeezing: an attentive carer collects capsules about 7-9% slower in those sessions; designing care to be quick halves it; a small payment per fulfilled want (E2) would cancel it, and I recommend waiting for real play data before adding one."

**Guardrails (all testable, section 7):**

| Guard | Test |
|---|---|
| `src/care` imports nothing from `core/meter.ts`, `core/drops.ts`, `core/merge.ts`, `core/rarity.ts` | static scan in `probe_care.ts` |
| the canonical sim output is byte-identical after every pets slice | `node _harness/sim_economy.ts \| grep -v '^(elapsed' \| sha256sum` equals `DESIGN.md:131-132` (or the re-quoted value) |
| no care function returns or takes squish points, capsules or item ids | type-level: the `Care` interface has none; a probe calls every method and diffs the Hoard text and the meter state (equal) |
| freshness is per touch **kind**, not per squishy (`meter.ts:46`), so five squishies do not multiply pay | existing |
| a scripted press never pays (3.6) | probe row: 1000 scripted reactions pay 0.000 SP |

### 3.5 What bond unlocks (and what it never does)

Bond levels (points): 0, 5, 15, 35, 70, 120. Unlocks are **looks, abilities and shelf items**. Placeholder names; the care and voices lenses name them.

| Level | Name (placeholder) | Pet ability | Global shelf unlock |
|---|---|---|---|
| 0 | New friend | answers a call by turning its eyes | the starter shelf: 3 foods, 2 toys (ball, stick), 2 accessories |
| 1 | Knows you | choose a nickname (a pick from the list; hearts it); **comes when called** (`moveTo`, Calm: turns instead) | |
| 2 | Likes you | its first trick; first accessory slot | + food 3, + accessory 2 |
| 3 | Trusts you | its favourites get a glow hint on the shelf; fetches a thrown toy (slice 4) | + food 4, + toy 2 |
| 4 | Best friend | second accessory slot; sways with the music | + toy 3, + accessory 3 |
| 5 | Inseparable | a signature idle; the name plate heart turns gold | + food 5, + accessory 4 |

Unlocks are **monotone and global**: blending the pet away never takes a shelf item back (`unlock` is not derived from living pets). **Bond never changes** squish points, capsule odds, merge odds or `rollMerge`, trade value or the board, or anything the server mints. It is not shown on a trade card.

Grind check [P, `SC\out\probe4.txt`, 20 seeds, 90 days, one pet, median days to each level]:

| Player | L1 | L2 | L3 | L4 | L5 | wants per session |
|---|---|---|---|---|---|---|
| casual (1 x 4 min, 4 days in 7) | 2 | 6 | 15 | 28 | **50** | 1.5 |
| regular (2 x 10 min, 5 days in 7) | 1 | 2 | 5 | 10 | **18** | 4.3 |
| devoted (3 x 15 min, every day) | 1 | 2 | 4 | 7 | **12** | 6.0 |
| one 60-minute binge, then 1 x 10 daily | 1 | 2 | 4 | 8 | 14 | 4.5 |

The 10-a-day cap makes 12 days the fastest possible level 5; a 60-minute binge gains the same 10 points as a short session (cap 14 a session, 10 a day), so there is nothing to grind and nothing to hurry. Level 5 is reachable by a casual player in about seven weeks; nothing is lost on the way.

### 3.6 Scripted touches must never pay (the one real economy risk)

The IDEAS lens found it (`PETS_IDEAS.md:154, 681`): a reaction that presses the body through the finger path (`fingerDown`, `fingerPressure`, `fingerUp`, a "ghost finger" for hiccups, sympathetic wobble, echo) emits `poke`/`release` like a real finger, and `drainBody` feeds every event to `collection.feed` (`game.ts:542`) and to `audio.poke` (`feedback.ts:123`). A scripted press held 0.4 s or more would pay. Rules:

1. Every scripted press lasts at most 0.3 s and is tagged by the shell (`driver.touch.scripted`, a counter) when it is issued.
2. `drainBody` drops tagged events **before** `collection.feed`, the haptics, `audio.poke`, the gain sparks and the statistics.
3. Only when both finger slots are free; never while the player's fingers are down on that body.
4. Probe (node, on the real `SoftBody`): 1000 scripted reactions pay **0.000 SP** and leave the meter state byte-identical; browser check: the ring does not move during a voice-pulse and hiccup script.

### 3.7 The simulation rows to add (CORE lane; in a new file so the canonical hash does not move)

`_harness/sim_care.ts` imports the exported pieces of `sim_economy.ts` (`BEHAV`, `playStream` model, `measureStyle`; the file runs nothing on import: `if (import.meta.main) main()`, `sim_economy.ts` last line) and the care engine. Rows:

| Row | Content | Pass |
|---|---|---|
| R1 | the table of 3.3 (4 archetypes x 6 scenarios, 120 sessions x 10 min) | E0 tax per archetype <= 10% attentive, <= 6% quick; reproduces within +-1 point on another seed set |
| R2 | population effect for engagement alpha = 0, 10, 30, 60, 100% | alpha = 30% moves minutes per capsule by <= 3.5%; the regular median stays <= 3.7 min |
| R3 | farm bots: reload every 20 min, answers in 0.3 s, 24 h | E0 = 0.000; E1/E2 <= 0.017 SP/min and <= 24 SP/day |
| R4 | the cheapest path with care: the best squeeze-at-freshness script plus a refill hold on every leak | total <= the valve (40) and the existing 39.9 plus the refill (<= 0.7 SP/min) |
| R5 | scripted-touch guard: 1000 reactions | 0.000 SP |
| R6 (only if E3 is chosen) | tasks: the pool grows from 8 to 8 + 6 care tasks; P(at least one care task offered a day) = 1 - C(8,2)/C(14,2) = 69%; completion probability for care tasks 0.9 | casual players gain +2.3 task capsules a week [M below], regular and devoted 0 (the weekly cap already binds) |

The E3 estimate [M] uses the sim's own task model (`sim_economy.ts:551`: completion chance per offered task 0.4 / 0.6 / 0.8 for casual / regular / devoted, active-day chance 0.4 / 0.7 / 0.9 from `DEFAULTS`, 2 offered a day, 5 a week). Expected task capsules a week today: casual 7 x 0.4 x 2 x 0.4 = 2.24; regular 5.88 and devoted 10.1, both capped at 5. If care tasks lifted the casual completion chance to 0.8: 4.48 a week (+2.2). A casual player's capsules from play are about 2.31 per active day x 0.4 x 7 = 6.5 a week, so tasks would add about a third to their income. That is a real change for 40% of the assumed population and is the reason E3 is deferred.

---

## 4. Tasks and achievements

### 4.1 Tasks: no paid care task in the first publication

`TASK_DEFS` has 8 tasks (`drops.ts:131-140`); two are offered a day, each pays one capsule, five a week at most (`drops.ts:115-117`), and **completion is judged by the server from the touch log** (`drops.ts:9-10`; `COLLECTION.md` 7.5). A care act is not in that log. Adding a paid care task means a new play-report kind (`[3, careKind, dtMs]`), a server counter and a rate limit: a protocol change to an unbuilt server. The analysis in 3.7 (row R6) also shows it would add about a third to a casual player's capsule income. So:

| | v1 |
|---|---|
| paid care tasks | **none** |
| "wishes" | the active pet's want bubbles themselves (section 2). They are not a list, have no count and pay nothing |
| "Firsts" (IDEAS CO-06) | a small sticker the first time each thing happens (first snack, sip, patch, toy, name, trick, favourite), shown once as a toast and kept in the pet book (Hoard card); **no counts, nothing can be missed or expire** |

If the owner later chooses E3, the change set is exactly this (CORE lane, with the server spec): `TaskDef.metric` gains `'care'` with `param` = care kind; six new tasks (ids kept forever, `drops.ts:132` note: "offers are seeded by id"): `care-snack` "Give someone a snack", `care-drink` "Give someone a drink", `care-patch` "Patch up a soft spot", `care-play` "Play with a toy for ten seconds", `care-wash` "Give someone a wash", `care-rest` "Tuck someone in for a rest"; `PROGRESS_KEYS` follows `TASK_DEFS` automatically (`store.ts:176`); `bumpTasks` (`ghost.ts:65-79`) gains one line per metric; `Collection.noteCare?(kind)` (optional, additive); the sim row R6; and the server's care counters. None of it is needed to publish.

### 4.2 What the portal gives (read this session)

| Fact | Evidence |
|---|---|
| The game posts `window.parent.postMessage({ type: 'forgeflow:achievement', achievementSlug }, '*')`; the portal looks up `(game_id, slug)`, inserts the unlock and adds XP | `games/blocktooth/src/net/portal.ts:303-312` (post); `games/blocktooth/_spec/online/platform.md:90` (portal action); `src/lib/gameBridge.ts:124-131, 181-231` |
| Tier maps to XP: bronze 5, silver 15, gold 30, diamond 60; `slug` unique within a game; columns `name, description, tier, points, secret, icon` | `supabase/migrations/0003_achievements_friends_activity.sql:60-72` |
| **XP comes only from achievements**; the platform level is the sum of achievement points | `platform.md:96` |
| Guests and standalone play are no-ops; the game never learns who is signed in except through `forgeflow:whoami` / `forgeflow:identity` | `platform.md:96-100`; `portal.ts:7-11` |
| Per account per page, post each slug once; on sign-in, catch up every goal already on file | `portal.ts:216-221, 303-321` |
| The rows must exist first: they are seeded by `seed_game_achievements(bigint, jsonb)`, executable by the **service role only** (a production database write) | `0005_registry_service_writes.sql:58-59`; `platform.md:35-38` |
| At most 60 achievement rows per game | my session-2 notes from reading the portal; the function body is not in `supabase/migrations`, so **verify before seeding** |
| `_spec/PORTAL.md` and `_handoff/design/PUBLISH_CHECKLIST.md` | **do not exist** (listing of `_spec` and `_handoff/design`, 2026-10-08) [R] |
| The UI work includes achievements and trophy screens and parity with Blocktooth | `UI.md:15-16` (decisions 5 and 6) |

### 4.3 The pet achievements (16; 8 in the first publication)

Pure function `doneSlugs(save): string[]` in `src/care/achievements.ts`, derived only from the pets save (no log, no clock). Kind wording; no streaks, no timers, nothing that can be missed. Names and descriptions are placeholders for the copy lens.

| # | Slug | Name | Condition (from the save) | Tier | XP | Slice | Secret |
|---|---|---|---|---|---|---|---|
| 1 | `hello-voice` | Say hello | at least 1 voice heard (`heard` has a bit) | bronze | 5 | S1 | no |
| 2 | `own-name` | A name of its own | `named` >= 1 | bronze | 5 | S1 | no |
| 3 | `first-snack` | First snack | `feeds` >= 1 | bronze | 5 | S2 | no |
| 4 | `first-sip` | First sip | `drinks` >= 1 | bronze | 5 | S2 | no |
| 5 | `likes-you` | Likes you | any pet at bond level >= 2 | silver | 15 | S1 | no |
| 6 | `ten-voices` | Ten voices | 10 or more distinct voices heard | silver | 15 | S1 | no |
| 7 | `favourite-found` | Found a favourite | `favourites` >= 1 | silver | 15 | S2 | no |
| 8 | `five-friends` | Five new friends | 5 or more pets at bond level >= 1 | silver | 15 | S1 | no |
| | | | **first publication (S1 + S2): 8 rows = 4 bronze + 4 silver = 80 XP** | | | | |
| 9 | `soft-spot` | Patched up | `refills` >= 1 | bronze | 5 | S3 | no |
| 10 | `play-time` | Play time | `plays` >= 1 | bronze | 5 | S4 | no |
| 11 | `first-trick` | A first trick | `tricks` >= 1 | bronze | 5 | S5 | no |
| 12 | `a-little-of-everything` | A little of everything | `feeds`, `drinks`, `refills`, `plays`, `washes`, `rests` all >= 1 | silver | 15 | S5 | no |
| 13 | `best-friend` | Best friend | any pet at bond level >= 4 | gold | 30 | S5 | no |
| 14 | `inseparable` | Inseparable | any pet at bond level 5 | gold | 30 | S5 | **yes** |
| 15 | `a-chorus` | A chorus | 25 or more distinct voices heard | gold | 30 | S5 | no |
| 16 | `every-voice` | Every voice | all 50 original voices heard (bits 0..49; fixed, so seasons do not change the meaning) | diamond | 60 | S5 | no |
| | | | **later updates: 8 rows = 3 bronze + 1 silver + 3 gold + 1 diamond = 180 XP** | | | | |

Sum check [M]: bronze #1, 2, 3, 4, 9, 10, 11 = 7 x 5 = 35; silver #5, 6, 7, 8, 12 = 5 x 15 = 75; gold #13, 14, 15 = 3 x 30 = 90; diamond #16 = 60; **16 rows, 260 XP** (80 in the first publication, 180 later). The first-publication eight are #1 to #8.

* The 16 rows leave room under a 60-row limit for the core achievements the portal plan lists (about 20, not yet written). **260 XP is large next to a typical game's total** (unknown until PORTAL.md exists): if the core set is lighter, pets would be most of the game's XP. The owner may prefer to drop the diamond or demote gold to silver; the slugs are independent.
* Voices heard counts only voices of species the player **owns** (a voice can only be played for an owned squishy), so #1, #6, #15 and #16 reward collecting, not grinding.

### 4.4 Sending them

* CARE exposes `care.achievements(): string[]` (pure) and an event `care.on('milestone', slug)`; **SHELL's portal module** (from the PORTAL plan) posts `{ type: 'forgeflow:achievement', achievementSlug }` and nothing else, once per slug per account per page, caught up at sign-in from the save. CARE never touches `postMessage`.
* **Payload rule (probe):** every outgoing message from the care path has exactly the keys `type` and `achievementSlug`; no id, nickname, bond or count.
* A **local trophy list** (the pet book) shows the same 16 as pictures with their conditions, so a guest sees what they are working toward; nothing about it needs the portal.
* **Gate (owner's yes):** seeding the rows, publishing, and any change to the portal are separate approvals (`STATUS.md:4, 36`). Until then the bridge is exercised against a local host, as the Blocktooth spec recommends (`platform.md` section 3.3: "Test against a local bridge host instead").

---

## 5. Contract seams (all additive, all optional, all feature-detected)

The rule of `contracts.ts:1-3` and `CONTRACT.md:39-41`: change the shared file only by adding optional members; consumers feature-detect; mocks keep compiling. Every row below says what happens when the member is absent.

### 5.0 Which slices need which seam (the headline)

| Seam | Needed by | Exists today? |
|---|---|---|
| `SquishAudio.voice`, `careSound`, `AudioSettings.voices/voiceVolume` | S1 | no (new, AUDIO) |
| `StageLike.setExpression`, `FxKind` additions | S1 | no (new, RENDER) |
| speech pulse, gulp, hop, shiver, come-here | S1, S2 | **yes**: `burstOpen`, `nudge`, `tremble`, `moveTo` (`softbody.ts:1194-1229`, `contracts.ts:145-155`) |
| `StageLike.bulge`, `setFood` | S2 | no (new, RENDER; the swallow can be render-only) |
| `SoftBodyLike.swallow` | S2 (upgrade, optional) | no (PHYS, later) |
| `SoftBodyLike.setInflation`, `inflation` | S3 | no (PHYS) |
| `SoftBodyLike.setColliders`, `contactReaction`; `ToyWorld`; `StageLike.setToys` | S4 | no (PHYS, RENDER) |
| `StageLike.setWear`, `Settings.*` | S5 / S1 | `Settings` fields S1 |

**Slices 1 and 2 touch no file in `src/physics`.**

### 5.1 INTEGRATION: `src/contracts.ts` (additive)

```ts
// Settings (optional; absence = never chose; defaults in core/settings.ts optionalDefaults)
voices?: boolean;        // default true
voiceVolume?: number;    // 0..1, default 0.7
captions?: boolean;      // default true
invitations?: boolean;   // default true; false = Quiet pets
// AudioSettings (optional)
voices?: boolean; voiceVolume?: number;
// FxKind: 'bubbles' | 'glitter' | 'dust' | 'ring'  ->  + 'crumbs' | 'drops' | 'hearts' | 'sparkle' | 'zzz' | 'note'
```

### 5.2 AUDIO (`SquishAudio`, optional members)

| Member | Signature | Behaviour | Absent |
|---|---|---|---|
| `voice` | `voice?(p: { species: number; kind: number; mood?: number; intensity?: number; pitch?: number; pan?: number; calm?: boolean; soft?: boolean; live?: { compressionRate?: number; volume?: number; slosh?: number } }): { durationS: number; onsets: readonly number[]; amp: number } \| null` | one species voice of one kind; the return value gives the shell the syllable onsets for the speech pulse and the caption timing; `null` when the engine's own limiter, the switch or the ceiling refuses it; recipes are data (50 species x ~28 B) plus 16 kind modifiers; **the engine limiter is a second line of defence** behind the shell's gate (2.7), like `BumpLimiter` | no voices; captions and the pulse still run (silent "seen voices", IDEAS AC-03) |
| `careSound` | `careSound?(p: { kind: number; pitch?: number; pan?: number; calm?: boolean; level?: number }): void` | munch, gulp, sip, lap, hiss, pump, pat, refilled boing, toy clack/boing, sponge, bubbles, snore, level chime; each a short synthesised voice in the existing style | silent |
| `setSettings({ voices, voiceVolume })` | existing method, two more optional fields | `voices` false: `voice` returns null; a care sound that is a voice is also silenced | |
| limits | one-shot priority class, voices at **priority 1** (above pokes, below ceremonies; `SOUND.md:101`), at most 2 sounding, each ends with a 20 ms fade when stolen, the music makes room under them (round-3 behaviour) | | |
| gates (G2 extension) | per voice: peak -20 to -9 dBFS, abs DC < 0.01, no sample step > 0.25 at start and end, tail < -60 dB, 120 to 900 ms (idle chatter <= 450 ms), non-silent for its minimum, **pairwise distinctness over the 1,225 species pairs** (8 numbers per voice, z-scored distance >= 1.0, `PETS_IDEAS.md:421-424`), two renders with different seeds differ by >= 3% in dominant frequency; and no sample, loop or recording (the code is synthesis only) | | |

### 5.3 RENDER (`StageLike`, optional members)

| Member | Signature | Behaviour | Absent |
|---|---|---|---|
| `setExpression` | `setExpression?(bodyId: number, e: { mood: number; level: number; look?: V3 \| null }): void` | the existing face changes with mood: lids (sleepy), a wider eye (oh), happy arcs (happy), a blush level, a glance toward `look` (the shelf item or the toy); **no mouth** (`DESIGN.md:701`, `face.ts:11-12`); a closed list of six emotes (heart, star, spiral, sleepy, wide, content; `PETS_IDEAS.md:138`) | the face as today |
| `bulge` | `bulge?(bodyId: number, from: V3, to: V3, amp: number, seconds: number): void` | render-side travelling swell of the jelly mesh from `from` to `to` (the swallow), conserving the look of volume; Calm: smaller and slower | `burstOpen(0.15)` alone (a gulp pulse) |
| `setFood` | `setFood?(items: readonly { id: number; kind: number; x: number; y: number; z: number; s: number }[]): void` | procedural food and drops in flight or resting | food is not drawn; care acts still work through the dock |
| `setToys` | `setToys?(toys: readonly { id: number; kind: number; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; r: number; len: number }[]): void` | ball (with a stripe shader), stick (a capsule with a grain pattern), later more; one draw call each | no toys |
| `setWear` | `setWear?(bodyId: number, ids: readonly number[]): void` | anchored accessories through the same rest mapper as the eyes (`face.ts:3-8`) | none |
| FX | `spawnFx` kinds `crumbs`, `drops`, `hearts`, `sparkle`, `zzz`, `note` | on the existing particle system; counts x0.3 in Calm (`DESIGN.md:609`), rings become fades, nothing flashes (the flash governor applies, `DESIGN.md:606-608`) | unknown kinds ignored |
| budget | at most 12 extra draw calls for five squishies with toys and wear; no new full-screen pass | | |

### 5.4 PHYS (`SoftBodyLike`, optional members; the file order is after TRUE CUT and LOCK)

| Member | Slice | Signature and contract | Absent |
|---|---|---|---|
| hop-to, come-here, hop, shiver (**exist**) | S1 | `moveTo(p, stiffness)`: a kinematic spring of the centre of mass toward a world point, horizontal only on the table, stiffness clamped to 0.1..4, `null` releases (`softbody.ts:1213-1220`); a hop is a `nudge` with an upward component (clamped to `MAX_NUDGE`, `softbody.ts:1194-1202`); a shiver is `tremble(amp)` (`softbody.ts:1223-1226`); in Calm the pet turns its eyes instead of moving | none needed |
| `swallow` | S2 upgrade | `swallow?(from: V3, to: V3, size: number, seconds: number): void`: a travelling radial inflation of the **goal** shape from the entry point toward the core; amplitude <= 0.12 R; the volume constraint holds the volume (+-3%); deterministic, allocation-free, every value safe; cost <= 0.05 ms for its 0.5 s (measured 0.035 ms with an `exp` falloff, 3-4x less with a polynomial) | the render `bulge` and `burstOpen(0.15)` |
| `setInflation` / `inflation` | S3 | `setInflation?(f: number, seconds: number): void`, f clamped to [0.7, 1]: moves the goal stiffness by (0.35 + 0.65 f) and the volume target to f together (bleed families through their existing volume target `vt`, `softbody.ts:429`; others through the rest volume) with a smoothstep; **fires no `bump`, no `land`, no `snap`**; `metrics.volume` follows; the renderer reads `strain` and `inflation` for wrinkles; `setFrac` is **not** reused: its range is 1/8..1 and CUT reads `frac` as "the part of the whole this piece is" (`contracts.ts:157-161`) | the leak is only drawn (droop and wrinkle in the shader); the pet is still floppy-looking and the refill still works |
| `setColliders` / `contactReaction` | S4 | `setColliders?(shapes: readonly { kind: 0 \| 1; x: number; y: number; z: number; bx: number; by: number; bz: number; r: number; vx: number; vy: number; vz: number }[]): void` (sphere or capsule, body world space, set once a frame before `step()`); inside the substeps particles are pushed out along the shape normal with the finger-tip friction and fold limits (the tip code of `softbody.ts:1770, 2128` is the template); `contactReaction?(out: V3): number` returns the summed reaction of the last step so the toy world can integrate it; **no `SoftEvent` is emitted** (toy events come from the toy world) | toys use the proxy ellipsoid (S4a) |
| toy world | S4 | `src/physics/toys.ts` `createToyWorld()`: up to 3 rigid toys (sphere, capsule), the same gravity constant (`params.ts` `GRAVITY` = 10), the table plane, toy-toy contact, the mat corral, `step(dt, bodies)`, `drainEvents` returning `ToyEvent { kind: hit | land | roll | rest, toy, body, intensity, at }`, deterministic, allocation-free | |
| shared primitive | S4 | the same collider shapes serve the planned **Stamp** and **Roll** tools (`FUN.md:58-59`); build once | |
| tests | | volume within the per-family band (CONTRACT 4.3), mesh volume **recomputed from `positions` and `indices`** (not the body's own `metrics.volume`), no NaN, no inversion, no table penetration > 1% of the rest radius over 200 fuzz runs x 1500 events, determinism (`stateHash`), no allocation, perf (6.2) | |

### 5.5 SHELL (`src/shell/care.ts` and the hooks in `game.ts`)

Controller `createCareController(d)` with a **narrow port** (so node probes run it with the mocks of `_harness/mocks.ts`): `body(itemId)`, `audio`, `stage`, `hoard` (`item`, `setFav`, `onChange`, `storage()`), `settings()`, `say(text)`, `bubble`, `captions`, `portal`, `simTime`.

| Hook (file) | What it does |
|---|---|
| `drainBody` (`game.ts:525`) | for each event of a body whose id is known (`activeBody` or an `ExtraBody.itemId`): `care.noteTouch/noteSqueeze/notePull/noteLand/noteToss/noteStrand`; **tagged scripted events are dropped here first** (3.6) |
| `simStep` (`game.ts:557`) | after `drain()`: `care.update(dt, live, touching)`; then drain the effect ring into the executor |
| `bodies.swapTo(..., { itemId, nickname })` (`game.ts:697` passes `nickname: null` today) | pass `care.nickOf(itemId)`; call `care.focus(itemId, family)` on a switch, `care.blur` on a leave |
| mat (`mat.ts:30-47`) | `mat.onChange` -> focus/blur the extras; pieces (`ExtraBody.piece`) are never pets |
| tools | `setTool('snap')`, a cut in progress, `ceremonies.active`, panels (`holdInput`), hidden/context lost -> `live = false` |
| lifecycle | `care.flush()` beside `collection.flush()` on hide, pagehide, dispose (`game.ts:859`) |
| collection | `collection.onChange` -> `prune(has)` with the guards of 1.9; `collection.storage().load` decides "trusted" |
| settings | `voices`, `voiceVolume`, `captions`, `invitations` -> audio, captions, `quiet()` |
| portal | `care.on('milestone')` -> the portal module |
| dev | `window.__WH__.care` (dev only, `import.meta.env.DEV`; grep-proven out of the production bundle like the other debug hooks, `SHELL_4.md` step 9): `state()`, `advance(attendedSeconds)` in 0.1 s steps, `forceWant(kind)`, `grantBond(n)`, `reset()` |

**Effects the executor runs** (the effect ring holds numbers; strings are looked up in `copy.ts`):

| Effect | Actions |
|---|---|
| `WANT(id, kind)` | show the bubble on that pet (an icon, no text, no counter); mood chip; **one** live-region line ("Dollop would like a snack"); an `ask-*` voice through the gate; the face glances toward the shelf |
| `FADE(id, kind)` | the bubble shrinks into a sparkle (Calm: a fade); a `sigh` voice (rare); nothing else |
| `JOY(id, bond)` | a `yum`/`giggle`/`cheer` voice, `burstOpen(0.10)` (Calm: 0.04), hearts fx, a +bond tick on the name plate heart; a caption |
| `LEVEL(id, n)` | a toast ("Dollop Likes you"), the heart fills, a chime; the live region |
| `UNLOCK` | the new shelf item gets a "new" mark (until first used; no counter) |
| `HEARD(species)` | the Hoard card's speaker mark; the first time, a caption |

**UI requirements** (the UI overhaul builds the components; these are the acceptance rules for the care content):

1. **Keyboard path for everything**: Tab reaches the dock's Care group; Arrow keys move within it; Enter picks an item; with more than one pet on the mat the next step selects the target with the arrow keys; Enter gives. No pointer is ever required. Single-key shortcuts only when `shortcuts` is on (WCAG 2.1.4).
2. **Single-pointer alternative to dragging** (WCAG 2.5.7): tap the item, then tap the pet; drag from the shelf is an extra.
3. Targets >= 44 CSS px, reflow at 320 px (`UI.md:25`).
4. The want bubble is a focusable button named for what it offers ("Dollop would like a snack. Give a snack"); Escape or the quiet button = "Not now".
5. The name plate shows a mood chip and 0 to 5 hearts with a text alternative ("Likes you").
6. Calm and reduced motion: no bubble bob, no hearts, no hops, speech pulse <= 2%; sparks off (the XP sparks already are, `FUN.md:39-40`).
7. No flash above the budget (2 luminance flashes in 1 s, `DESIGN.md:606`).
8. The word "Toys" belongs to the shelf; the old tray's names (`toyTray.ts`, `ToyTray`, `createToyTray`, the aria-label "Toys", `hudBinding.ts:11-12, 46, 97`) become Tools (`UI.md:17`).

### 5.6 CORE and the collection

Under E0 nothing changes. Under E1/E2/E3 (owner's choice): `meter.ts` (a care touch kind with its own tau and floor, daily dividend cap, share of the valve), `ghost.ts`, `meterfeed.ts` (`MappedTouch`), `drops.ts`, `sim_economy.ts` rows R1-R6, `probe_economy.ts`, and the DESIGN 5.4 table. Optional additive `Collection.noteCare?(kind)` only for E3.

### 5.7 What breaks if a lane is late (the fallback matrix)

| Late | Player sees | Still works |
|---|---|---|
| PHYS (no `swallow`, `setInflation`, colliders) | gulp pulses instead of a travelling bulge; a leak drawn but not physically floppy; toys by proxy | S1, S2 fully; S3 degraded; S4a |
| RENDER (no `setExpression`) | the old face; mood only in the chip and the voice | everything |
| AUDIO (no `voice`) | silent pets: captions and the pulse only | wants, care, bond |
| UI overhaul dock/shelf late | a plain button row in the HUD for Feed and Water | S1; S2 with the placeholder dock |
| TRUE CUT late | no change (pets treat a cut squishy as "not now") | everything |

---

## 6. Performance and bundle budget

### 6.1 Bytes (against G0)

**How the byte numbers were made [R].** G0 counts the raw bytes of `dist/` (`vite.config.ts:24, 171-182`; `dist/` today also holds a 167,602-byte `thumbnail.png`, `game_meta.json` and `index.html`), in KiB (`b / 1024`). I bundled my prototype with the repo's own bundler (`vite build`, library mode, minify on): **13,624 B raw, 4,925 B gzip for 406 code lines** (registry + engine + store: the whole wants/bond/save logic). Calibration on existing modules, same method: `core/save.ts` + `settings.ts` + `genome.ts` + `rng.ts` + `species.ts` = 617 code lines -> 11,385 B (18.5 B per code line); `settings.ts` + `playHistory.ts` + `rng.ts` = 201 code lines -> 6,058 B (30 B); the IDEAS lens measured 24 to 34 B per source line on six modules (`PETS_IDEAS.md:76-85`). I price code at **25 B per code line (range 18-34)** plus data, and give a +-30% range. The real `src/care` is the prototype plus the store wrapper (throttle, timers, subscription, the newer/backup/pruned slots), the achievement evaluator, the copy ids and the voice gate: about 21 KB.

**Matrix (KB raw minified; S = slice, section 8):**

| Lane | S1 voices, moods, names, bond | S2 feed, water | S3 leak, refill | S4 toys | S5 the rest | Total |
|---|---|---|---|---|---|---|
| CARE (`src/care`) | 12.0 | 4.0 | 1.5 | 1.5 | 2.5 | 21.5 |
| SHELL (`src/shell`, hooks) | 4.0 | 2.0 | 1.0 | 3.0 | 2.0 | 12.0 |
| UI (`src/ui`, CSS, icons) | 9.0 | 6.0 | 2.0 | 2.5 | 4.0 | 23.5 |
| AUDIO | 9.4 | 2.5 | 2.5 | 2.5 | 3.0 | 19.9 |
| PHYS | 0 | 0 | 1.5 | 10.5 | 1.0 | 13.0 |
| RENDER | 3.0 | 7.0 | 3.5 | 7.5 | 8.0 | 29.0 |
| **Slice total** | **37.4** | **21.5** | **12.0** | **27.5** | **20.5** | **118.9** |

What is in each cell, in words: S1 CARE = registry, save and merge, bond, moods, heard, nicknames, achievements, copy ids, voice gate; AUDIO 9.4 = the voice synthesiser (about 250 lines, 7 KB) + 50 recipes (about 1.4 KB) + kind modifiers; UI 9 = captions bubble, name-plate chip and hearts, nickname picker, settings rows, Hoard card marks, icons, about 1.5 KB of CSS; RENDER 3 = the expression layer. S2 RENDER 7 = procedural foods, drop and crumb fx, the render-side bulge. S4 PHYS 10.5 = toy world (200 lines) + colliders and reaction (about 120 lines in `softbody.ts`) + glue; RENDER 7.5 = ball, stick and their materials. S5 RENDER 8 = accessories (5), wash foam and the cushion (3).

**Plausible range +-30%: 83 to 155 KB for everything; 41 to 77 KB for S1 + S2.** The sibling estimate is the same size: the IDEAS lens priced its ten editorial ideas at 42 to 73 KB without the voice core (10 to 16 KB) (`PETS_IDEAS.md:386-398, 631`); several of them are inside my slices.

**The gate (KiB, G0 = 1.2 MB = 1229 KB):**

| Build | KB used | Over 1229? | Margin at 1.30 MB (1331 KB) | Margin at 1.40 MB (1434 KB) | Margin at 1.50 MB (1536 KB) |
|---|---|---|---|---|---|
| today (`STATUS.md:4`) | 1143 | no | 188 | 291 | 393 |
| + UI overhaul (about 90) | 1233 | **yes, by 4** | 98 | 201 | 303 |
| + S1 (37.4) | 1270 | yes | 61 | 164 | 266 |
| **+ S2 (21.5): first publication** | **1292** | yes | **39** | 142 | 244 |
| + S3 (12.0) | 1304 | yes | 27 | 130 | 232 |
| + S4 (27.5) | 1331 | yes | **0 (at the gate)** | 102 | 204 |
| + S5 (20.5): everything | 1352 | yes | -21 | 82 | 184 |
| everything, pets +30% | 1388 | yes | -57 | 46 | 148 |
| everything + the IDEAS lens's other phases (about 60-107 KB, an upper bound: it overlaps my S1 and S5, `PETS_IDEAS.md:612-631`) | 1412-1459 | yes | no | -25 to 22 | 77-124 |

**Recommendation (the owner decides):** the gate fails before pets, so it has to move whatever is built. **Raise G0 to 1.30 MB for the first publication** (UI + S1 + S2 = 1292 KB, 39 KB margin, still 1310 KB at +30% on pets) **and to 1.40 MB when S4 and S5 land** (1352 KB, 82 KB margin, 1388 KB at +30%). If the IDEAS lens's further phases are also wanted, its 1.5 MB is the right number. Keep the size budget as a per-feature ledger (the matrix above) so a regression is attributable.

Levers if the owner wants to keep 1229 KB instead [S, unmeasured]: (a) the 167,602-byte thumbnail counts toward the gate; a quantised 1280 x 720 PNG of the same title card is likely 60 to 80 KB, which would buy about 90 to 105 KB without touching code (I did not recompress it); (b) ship only S1 (37.4 KB) and shrink the UI to about 51 KB; (c) drop S4 and S5. None of them reduces the pets, they only defer them. Transfer size is a third of the raw bytes (the prototype gzips to 36%), so the pets cost the player about 43 KB over the wire for everything and 21 KB for the first publication; `three` (the 686 KB stage chunk, `dist/assets`) stays the dominant cost.

### 6.2 Milliseconds (per 60 Hz frame; the physics bar is 2.0 ms, G1p, `CONTRACT.md:186`)

| Feature | Typical | Worst | Basis | Budget |
|---|---|---|---|---|
| care engine `update()` with 5 pets on the mat | 0.0002 ms | 0.0006 ms | [P] best of 7: 0.138 us quiet, 0.616 us under heavy load; heap +5 KB over 2.8 M frames | **all care JavaScript 0.05 ms** |
| `note*` calls from `drainBody` | 0.00005 ms per event | 0.001 ms | [P] 50 ns quiet, 910 ns loaded | included |
| effect executor (a few effects a second) | 0.01 ms | 0.05 ms | [S] | included |
| want bubble, captions, hearts (DOM, `transform` and `opacity` only) | 0.05 ms | 0.2 ms | [S] | inside the UI's own 1 ms (`UI.md:26`) |
| speech pulse `burstOpen(0.06..0.12)` | 0.005 ms per call, at most 8 a second | 0.01 ms | [M] two O(n) loops over 642 particles (`softbody.ts:1229-1247`) | 0.01 ms per call |
| swallow bulge (goal pass, only while it runs) | 0.035 ms for 0.5 s | 0.1 ms | [R] 35 us with an `exp` falloff; a polynomial falloff is 3-4x cheaper | **0.05 ms** |
| `setInflation` | about 0 | 0.005 ms | [S] scalar changes of two goal parameters | 0.01 ms |
| a ball touching the body | 0.025 ms | 0.06 ms | [R] 4.16 us per substep x 6 | per touching sphere 0.03 ms |
| a stick (capsule) touching the body | 0.087 ms | 0.15 ms | [R] 14.5 us per substep x 6 | per touching capsule 0.09 ms |
| three toys all touching one body | 0.137 ms | 0.3 ms | [R] 2 spheres + 1 capsule | **0.15 ms (typical), 0.35 ms (worst)** |
| a toy far from any body | about 0.002 ms | | [S] bounding-sphere early-out; without it 3.8 us x 6 = 0.023 ms | |
| toy world integrator, 3 rigid bodies | 0.01 ms | | [S] | included in the 0.15 |
| render: expression layer, 1 toy draw call each | 0.02 ms JS | 0.2 ms GPU on SwiftShader | [S] | at most 12 extra draw calls |
| a voice start (graph build) | one-time 1-2 ms | | [S] the existing voices are built per call the same way | at most 24 nodes per voice, at most 2 sounding |
| **Typical total, S1 + S2** | **< 0.1 ms** | 0.3 ms | | |
| **Worst total, S4 with 3 toys on 5 bodies** | | **< 0.5 ms** (but see below) | | |

Micro-benchmark method (`SC\size\phys_bench.mjs`) [R]: 642 particles (detail 3), typed arrays, plain JS; the narrow phase of a sphere and of a capsule (closest point on the segment per particle) and the bulge pass; best of 9 runs of 20,000 calls. The machine was heavily loaded: the medians were 10-14x the minima (sphere 57 us median vs 4.2 us best), so the *best* is the cost and the median shows the contention. A real contact adds fold limits and friction; I priced it at 2x in the budget.

**The context that matters more than these numbers:** the physics bar is 2.0 ms for ONE body, 1.8 to 2.3 ms is already measured at load 4 to 6, and **five bodies with contact cost about 10 ms a frame** (`RESUME.md` section 2, `STATUS.md` known open; `SHELL_4.md` frame cost: 5 bodies 8.0 ms physics, 34.9 ms step + render under SwiftShader). So pets must degrade **first**: when `stage.stats().frameMsEma` is above `FRAME_BUSY_MS` (30 ms, `mat.ts:24`) no toy comes out and no new want is offered; toys per quality tier mirror the mat (`MAT_LIMIT` 3/4/5, `mat.ts:22`): low 1, med 2, high 3; a toy is a rigid shape, never a `SoftBody`, so it never takes a mat slot (the IDEAS lens's trampoline sheet, which is a SoftBody and costs 2 ms, is a different case, `PETS_IDEAS.md:63`).

### 6.3 Storage and memory

| Item | Size |
|---|---|
| `wobblehoard:v2:pets` | 0.3 to 1 KB typical; 14 KB at the 400-row cap [P: 33 B a row] |
| backup slots | each at most 20,000 characters |
| per-frame allocation | 0 [P P2: +5 KB over 2.8 million frames, i.e. noise] |
| heap | the care engine is about 12 KB of retained objects for 5 pets (sessions, typed arrays, the 64-entry effect ring) [S] |
| localStorage writes | at most one per 2 s, only after a bond event; a fresh profile writes nothing |

---

## 7. Tests

**Principle (from `RESUME.md:95-102` and the repo's habit):** every claim in this memo has a check that fails the day it stops being true; no threshold is loosened; a claim about a body is measured with a **second instrument** (not the code under test reporting on itself); the implementer's own probe proves nothing until an independent verifier's repro passes too (`RESUME.md:36-38`).

### 7.1 Node probes (`_harness/probe_care.ts`, picked up automatically by `run_probes.ts:7-9`)

I prototyped 26 of these [P, all pass]; the rest are specified [S].

| ID | Check | Independent measurement / method | Status |
|---|---|---|---|
| A01 | the registries are append-only: a locked copy of every list (`WANTS`, `MOODS`, `VOICE_KINDS`, `FOODS`, `TOYS`, `ACCS`, `TRICKS`, `TOTALS`, `NICKS`) is compared (the `IDX_LOCK` pattern of `probe_catalog.ts`) | the locked copy lives in the probe | S |
| A02 | every nickname passes `deny_pokemon.json` and `deny_creatures.json` and is at least 2 edits from every entry, and from the 50 species names | the same lists the species names were screened against | S |
| A03 | `PETS_VERSION` raised without a step in `PETS_MIGRATIONS` fails | mirrors `probe_collection.ts:116-117` | S |
| A04 | **copy lint**: every string in `care/copy.ts` is plain, short (bubble <= 40 chars, live line <= 80), and contains none of: die, dead, sick, starv, hungry!, neglect, lonely, miss you, forgot, hurry, quick!, now!, last chance, don't let, "your pet needs", a countdown or a count of days | a banned-word list in the probe; the words of `PETS_IDEAS.md:652` rule 4 | S |
| B01 | same seed and script -> identical want log and save | two runs, FNV hash | P D1 |
| B02 | no `Date.now`, `performance.now`, `Math.random` read in a 12-minute session | the three are replaced by counting spies | P D3 |
| B03 | an hour untouched advances the attended clock by <= 20 s, no want, no bond; an hour not live advances nothing | | P D4, D5 |
| B04 | a clock set a year ahead (the injected `dayKey` jumps 365) changes nothing but the day tally | diff of the serialized save | S |
| C01 | wants >= 75 attended s apart, <= 6 a session, <= 3 for an ignorer, the queue never overflows, the bubble is on screen <= 30% | fuzz: 120 sessions x 4 player types | P G1-G6 |
| C02 | precedence: with all accumulators due, the order is patch, rest, water, food, wash, play | | S |
| C03 | `invitations` off: no want in 15 busy minutes; manual care still works | | P Q1, Q2 |
| C04 | live gating: `update(dt, false, ...)` while a ceremony, Snap, a cut squishy, a hidden tab: no change | | S |
| C05 | mood derivation table for every state | | S |
| D01 | bond: day cap 10, session cap 14, exact level thresholds (4 -> 5 at 5, 14 -> 15 at 15), monotone | | P G4, Q3 |
| D02 | **no field decreases** across 800,000 random calls, with day jumps forward and back | | P N1 |
| D03 | the favourite is a pure function of the id and is among the first five foods / four toys | | S |
| E01 | save: round trip byte for byte; hostile inputs; `newer` never writes (a spy storage counts 0 writes); tail columns carried | | P S1-S4 (+ the write spy S) |
| E02 | two tabs: grow-only three-way merge, order independent | | P S5, S6 |
| E03 | prune: one blended pet removed and parked; "everything gone" removes nothing; never while the Hoard is not trusted | | P S7-S9 |
| E04 | storage failure: quota error on write -> `failing`, the game continues, the next success clears it | `guardStorage` with a throwing `setItem` | S |
| E05 | **real Collection**: build a `createCollection` on memory storage, name a pet (-> `fav` flag set via `setFav`), merge the pair (-> row parked, result fresh), corrupt the Hoard text (-> `recovered`, pets untouched) | the Hoard text and the pets text are compared before and after | S |
| F01 | `src/care` imports nothing from `core/meter`, `core/drops`, `core/merge`, `core/rarity`, `three`, the DOM | a static scan of the import lines | S |
| F02 | **economy isolation**: after 10,000 random care calls the meter state and the Hoard text are byte-identical | | S |
| F03 | **scripted touches pay 0.000 SP**: 1000 scripted reactions on the real `SoftBody` through the shell's drain | the meter state before and after | S |
| F04 | the canonical sim output hash is unchanged | `node _harness/sim_economy.ts | grep -v '^(elapsed' | sha256sum` against `DESIGN.md:131-132` (390 s: a heavy job, run once per slice by CORE) | S |
| G01 | `update()` with 5 pets < 5 us best of 7; zero allocation | [P P1: 0.138 us; P2: 5 KB] | P P1, P2 |
| H01 | achievements: monotone; each slug in the portal seed list; payload keys are exactly `type` and `achievementSlug` | the seed list is a JSON file shared with PORTAL.md | S |
| H02 | `doneSlugs` of an empty save is empty; of a maxed save is all 16 | | S |
| I01 | progression: median days to each bond level for the four player types stay within +-25% of 3.5 (appendix B) | seeded | P section 6 |

### 7.2 Economy rows (`_harness/sim_care.ts`, CORE lane)

R1-R6 of section 3.7, with the pass conditions given there. R1 reproduces the table of 3.3 within +-1 point on a different seed set.

### 7.3 Audio gates (`probe_audio.mjs` additions, AUDIO lane)

| Check | Pass |
|---|---|
| each of the 50 voices x 3 moods x 3 intensities | peak -20 to -9 dBFS, abs DC < 0.01, no step > 0.25, tail < -60 dB, 120-900 ms (idle <= 450 ms), not silent |
| distinctness | all 1,225 species pairs at z-scored distance >= 1.0 over 8 numbers (f0, two formants, glide, vibrato, bubble density, syllables, length) |
| seeds | two renders with different seeds differ >= 3% in dominant frequency; the same seed is bit-identical |
| the voice limiter | 100 calls in 5 s start at most the gate's allowance (through the REAL engine, as the room checks do) |
| `voices` false | `stats().started.voice` stays 0 over a scripted run; `muted` exact silence |
| music makes room | the existing room-dip gate extended to voices |
| no samples | the bundle contains no audio file or decoded buffer (grep of `dist/`) |
| originality | a human panel hears all 50 blind; the test cannot prove "sounds like nothing else" (`PETS_IDEAS.md:424`); **nobody has listened to any sound yet** (`SOUND.md:3`) |

### 7.4 Physics gates per new member (PHYS lane; each with a verifier-owned repro)

| Member | Checks (second instrument in brackets) |
|---|---|
| `setInflation` | volume reaches f within 2% in 1.2 `seconds` and recovers to 1 +- 0.015 within 4 s [mesh volume recomputed from `positions` and `indices`, not `metrics.volume`]; 12 families x 2 genomes; no `bump`/`land`/`snap` event; determinism hash; 200 fuzz runs; no allocation; shape back within 3% RMS |
| `swallow` | the bulge peak travels along the requested path within 0.1 R [vertex displacement read from `positions`]; volume +-3%; no crease past 120 degrees; Calm amplitude <= 40% |
| `setColliders` / `contactReaction` | a ball dropped from 0.5 m: penetration <= 0.1 of its radius [min particle-to-centre distance]; reaction impulse equals the ball's momentum change +-5% [integrate the toy independently]; no particle passes through (`min dist > 0`); stick poke dent depth; no NaN, no inversion, no table penetration > 1% over 200 fuzz runs x 1500 events; determinism; allocation 0; cost against 6.2 |
| toy world | rest on the table, toy-toy, corral; 3 toys + 5 bodies: frame cost within 6.2 |

### 7.5 Browser checks (`browser_shell.mjs`, new section `care`; SwiftShader; independent instruments in brackets)

| ID | Check | Second instrument |
|---|---|---|
| K1 | keyboard-only: Tab to the Care group, Enter on Food, choose the pet, Enter: the pet's bond rises and the live region says the expected line | the pointer event count is 0 (CDP trace); `announcer.last` |
| K2 | a real CDP touch drag from the shelf onto the squishy completes exactly one act; the tap-item-then-tap-pet path does the same | `care.totals` delta of 1; touch target rectangles >= 44 px (`getBoundingClientRect`) |
| K3 | `voices` off: `audio.stats().started.voice` stays 0 across a scripted play-through; captions still appear when muted | the engine's own counters |
| K4 | live region: exactly 1 line per want appearance and at most 1 per 4 s; idle chatter produces none | `announcer.last` log with timestamps |
| K5 | Calm / reduced motion: the bubble has no animation, no hearts, no hop; speech pulse <= 2% | computed style `animation-name: none`; body `positions` extent over the pulse |
| K6 | nothing in storage until the first bond event; after a nickname the pets key has 1 row; the Hoard text is **byte-identical** after any number of care acts (except the heart) | `localStorage` reads |
| K7 | corrupt pets key: the game boots, no console error, the blob sits in `.unreadable`, the Hoard is untouched | console log; storage reads |
| K8 | reload: nickname and bond persist; wants do not (60 s grace again) | `care` dev state |
| K9 | scripted reactions do not move the ring | `meterFill` before/after a hiccup script |
| K10 | frame cost with 5 bodies + 2 toys vs baseline; the busy guard refuses toys above 30 ms | `stage.stats().frameMsEma`; the physics step probe |
| K11 | the production bundle: no `__WH__.care`, no dev strings; size within the new gate; strict CSP: 0 violations, no inline style or script from the new UI | `dist/` grep; `securitypolicyviolation` events |
| K12 | screenshot matrix: bubble, dock Care group, hearts, captions, nickname picker at 1280x800, 390x844, 320x568 x normal, Calm, high contrast | judged by eye by the implementer **and** the art-director verifier (`UI.md:41`) |
| K13 | portal stub: each slug posted once per account per page, none as a guest, payload keys exactly `type` and `achievementSlug`; sign-in catch-up posts the held slugs | a stub host page recording `message` events (`platform.md` section 3.3: a local bridge host) |
| K14 | a leak/refill and a swallow on a real body (S2/S3): volume and extent over time | `positions` + `indices` recomputed |

### 7.6 Verification protocol

Per slice, **three fresh independent verifiers** (`RESUME.md:95-102`), each reading the implementer's report only after a first pass: (1) **care, economy and save** (the node probes, the sim rows, the storage and portal checks, a hostile-save fuzz, "does absence change anything?" with a clock a year ahead); (2) **audio, originality and sound sensitivity** (the gates of 7.3, a listening panel for rough-play cries, the 50 voices blind, the voice off switch really silent); (3) **shell, accessibility and performance** (K1-K14, WCAG 2.2 AA items of `UI.md:25`, keyboard walk, small phones, frame cost). A PASS needs no MAJOR, no regression, `tsc` clean, no console or page error (`RESUME.md:99-100`). S3 and S4 add a **physics verifier** with the repros of 7.4.

**New gate for `CONTRACT.md` section 6 (G10, CARE):** `node _harness/probe_care.ts` exits 0; the economy rows R1-R5 hold; the canonical sim hash is unchanged (E0); the browser `care` section passes; the bundle is inside the (new) G0.

---

## 8. Build order: slices that each ship value

Effort is in engineer-days of a lane engineer including that lane's own probes; independent verification adds about 40% (`RESUME.md:95-102`; the same scale as `PETS_IDEAS.md:383`). These are [S] estimates by analogy, not measurements. Bytes are the matrix of 6.1.

### 8.1 The five slices

| | What the player can do after it | Lanes and files (new -> edited) | KB | Physics change? |
|---|---|---|---|---|
| **S1 It talks and knows you** | every squishy has its own voice (its name, a hum, a giggle, a surprised "oh"); it greets you when you switch to it or when it comes out of a capsule; it answers touches in character; its face and chip show its mood; **Voices**, **Voice volume**, **Captions** and **Quiet pets** in Settings; give a squishy a **nickname** from a list (it gets a heart and cannot be blended by accident); hug it (a held squeeze) and call it (it turns or comes over) to grow a bond of up to 5 hearts; the Hoard card shows which voices you have heard; Firsts stickers; 5 of the 8 first achievements (#1, #2, #5, #6, #8) | CARE: registry, engine (moods, bond, heard), store, achievements, copy, nicks. AUDIO: `pet.ts` (voices), engine members. RENDER: `pet.ts` (expression). SHELL/UI: `care.ts`, captions, name-plate chip, nickname picker, settings rows, Hoard card marks, portal hook | 37.4 | **none** (`burstOpen`, `moveTo`, `tremble`, `nudge` exist) |
| **S2 It eats and drinks** | the pet sometimes asks (a small picture bubble, never twice, gone by itself) for a snack or a drink; pick food or a drink from the shelf and give it by drag, by tap-then-tap or by keyboard; it swallows (the jelly bulges and the bulge travels in), burbles, and shows a favourite; bond grows, new foods unlock; achievements #3, #4, #7 | CARE: wants engine (food, water), favourites, unlocks. UI: Care group in the dock, bubble, shelf rows. RENDER: foods, crumb and drop fx, the render bulge. AUDIO: munch, gulp, sip, ask voices | 21.5 | **none** (render bulge + `burstOpen`); `swallow` is an optional upgrade |
| **S3 It leaks and you refill** | a hard toss or a full stretch can open a tiny soft spot: a soft hiss, the squishy goes a little floppy; put a patch on it, then pump it back up (a held press on the body: a real squeeze, so it pays by the usual rule); it rounds out with a happy boing; if you do nothing the spot seals itself | PHYS: `setInflation`. RENDER: droop and wrinkle. AUDIO: hiss, pump, pat, boing. CARE: the patch want. UI: Fix group (patch, pump) | 12.0 | **yes: one member**, after TRUE CUT and LOCK |
| **S4 Toys** | a ball and a stick (and more later) on a shelf; drop them on the mat; the ball squashes into the jelly and bounces, the stick dents it, a squishy chases a rolling ball; "play" wants; bond via play | PHYS: `toys.ts`, `setColliders`, `contactReaction`. RENDER: `toys.ts`. AUDIO: toy sounds. SHELL/UI: toy placing, dragging, keyboard path, the busy guard | 27.5 | **yes**, after the cp47 verification |
| **S5 The rest** | wash (sponge and bubbles, for sticky families especially), rest (a cushion; it settles and breathes slowly), accessories, tricks and signature moves, sway to the music, photo props, the remaining achievements, the IDEAS top ten as chosen | per idea | 20.5 | one setter per idea at most |

**S4a (proxy toys), a fallback that ships toys without the physics lane.** The ball and the stick are rigid shapes in the shell (a tiny integrator, the same gravity); each squishy is represented by its bounding ellipsoid (`center`, `restRadius`, the vertical squash from `metrics.compression`); on contact the shell calls `nudge` and `burstOpen(0.08)` and the renderer draws a dent where the ball met the jelly (the `bulge` machinery reversed). About 17 KB (SHELL 3, RENDER 7.5, AUDIO 2.5, CARE 1.5, UI 2.5), no PHYS. Honest cost: the jelly does not really deform around the ball (the game's edge), and a fast ball can look as if it passes through a stretched squishy. Nothing is saved (toys are session-only), so S4b replaces S4a with no migration.

### 8.2 Dependencies on the queued work (`STATUS.md:31-37`)

| Queued item | Effect on pets | Handling |
|---|---|---|
| 1 UI overhaul (toolbar instead of Toys, drawn jelly type, parity with Blocktooth and Dyefield, achievements screens) | S1 needs its settings panel, the HUD name plate and the announcer; S2 needs the dock, the shelf and the item-picker | CARE, AUDIO and RENDER start at once (disjoint files); the pet UI is authored in the new UI kit after its batch 2 (settings) and batch 3 (Hoard, tray and bars), never in the old styles; UI.md decision 7 already makes the shelf data-driven |
| 1b TRUE CUT + Minis | the same shell files (`game.ts`, `bodies.ts`, `cut.ts`, `hudBinding.ts`, `cutBar.ts`) | all pet edits to those files land as **one care-seam change** after the TRUE CUT shell round is committed; a cut squishy is "not now" for care |
| 1b/3 LOCK, multi-pull, ground fix, neck swell (PHYS round 3) | the same `softbody.ts` | S3 and S4 physics members are a later PHYS round; the LOCK rule "locks are never saved" matches pets (session-only state); more finger slots (5) mean the scripted-touch tag must cover them |
| 2 independent physics verification of checkpoint 47 | the colliders build on that body | S4 starts after its verdict |
| 4 refresh the preview artifact | each slice yields a private preview for the owner to try, and to **listen** (nobody has) | the owner's ears gate S1 |
| 5 ffgames (achievements, bridge, `game_meta.json`, thumbnail, README) | the pet achievements join the list; the thumbnail recompression is a G0 lever | owner's yes before any deploy or database write |
| 6 Stamp and Roll tools | they need the same collider shapes as S4 | build the primitive once, in S4 |

### 8.3 The parallel plan

```
now           UI overhaul build ........................................
              TRUE CUT build ............................
              PETS S1: CARE core + AUDIO voices + RENDER expression ..........   (disjoint files, no shell edits yet)
UI batch 2 -> S1 shell and UI wiring + the one care-seam commit (after TRUE CUT's shell round)
              S1 verification x3 -> fix round -> S1 DONE (private preview: the owner listens)
UI batch 3 -> S2 build (dock Care group, shelf, bubble) -> verification x3 -> S2 DONE
              ===> PUBLICATION CANDIDATE: UI + S1 + S2 (G0 raised to 1.30 MB; owner's yes to deploy)
PHYS round 3 (ground fix, LOCK, neck swell) -> PHYS care round: setInflation -> S3 (verify incl. physics) -> update U1
cp47 verdict -> PHYS: colliders + toy world -> S4 (verify incl. physics) -> update U2   (S4a can go earlier)
S5 picks, one value-per-KB idea at a time, as updates
```

Estimated effort [S]: S1 CARE 3 d, AUDIO 8-12 d (50 voices, the distinctness test, the panel), RENDER 2 d, SHELL/UI 5 d, verification +40% -> about 25-31 d of effort, 10-12 working days elapsed with four lanes in parallel. S2: CARE 1, SHELL/UI 4, RENDER 4, AUDIO 2 -> about 15 d, 6 days elapsed. S3: PHYS 4, RENDER 2, AUDIO 1.5, other 2 -> 13 d. S4: PHYS 8, RENDER 3, AUDIO 1.5, SHELL/UI 4, CARE 1 -> 25 d. S4a: about 12 d.

### 8.4 First publication versus first update

| Candidate | In the first publication? | Why |
|---|---|---|
| **S1 voices, moods, names, bond** | **yes** | the owner's first question; no physics change; the safest large delight; it is the most visible difference between this toy and any other |
| **S2 feed and water** | **yes** | the owner asked for it by name; no physics change (render bulge + `burstOpen`); gives the pets a reason to be touched with a purpose; keeps the bond loop real |
| S3 leak and refill | update 1 | needs one physics member and the physics verifier; the owner asked for it by name, so it should follow soon |
| S4 toys (real contact) | update 2 | the biggest physics and performance risk (five bodies already cost 8-10 ms); it shares the Stamp and Roll primitive |
| S4a proxy toys | **only if the owner wants toys in the first publication** | ships toys without PHYS at about 17 KB, with the honest loss of true deformation |
| S5 | updates, one idea at a time | |

Criteria for anything in the first publication: no new member in `src/physics`; three independent verifiers PASS; the bundle inside the (raised) gate; every player-facing string passes the copy lint; the canonical sim hash unchanged; the 8 achievements tested against a local bridge host (the rows are seeded only after the owner's yes); **the owner has listened to the voices**.

### 8.5 Definition of done for a slice

1. `tsc` clean for the whole tree (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, not `npx`: `RESUME.md:30-33`).
2. `probe_care.ts` and every other probe exits 0; the existing browser harness still passes (473 / 473 at SHELL-4); the new `care` section passes.
3. The canonical sim hash is unchanged (F04), or the change is the owner's decision with re-quoted numbers.
4. The bundle is inside the current gate; the per-feature ledger row is filled in with the real bytes.
5. Calm, reduced motion, high contrast, forced colors, 320 px reflow, keyboard walk (K1-K13).
6. Voices off and muted are silent; captions work with sound off.
7. Three independent verifiers PASS with their own repros (7.6).
8. A private preview artifact exists for the owner; **nothing is deployed without the owner's yes** (`STATUS.md:4`).
9. The report lists what was not done and every number has a command next to it (`RESUME.md:88-93`).

---

## 9. Risk list

L = likelihood, I = impact (H / M / L). "Detect" is the check that would show it.

| # | Risk | L | I | Mitigation | Detect |
|---|---|---|---|---|---|
| R1 | **Wants become nagging** (a guilt loop, the thing the owner forbade) | M | H | the governor (2.3): grace, gaps, back-off to silence, 6 a session, Quiet pets; no counters, no sad faces, a closed emote list; copy lint (A04) | G1-G6, K4; a playtest with a 3-minute and a 15-minute session |
| R2 | **Sound annoyance or startle** (repeated cries, loud peaks, shrill timbres) | H | H | the voice gate (2.7), a ceiling set by a test chime, a soft preset, idle chatter 1 per 20 s, captions, its own switch; no pain sounds | 7.3 gates; a human panel; **nobody has listened to any sound yet** |
| R3 | **A voice resembles a franchise's cry** (originality) | M | H | synthesis only in the game's own palette (bloops, bubbles, gel formants), no chip-square timbre, no name-only cry; distinctness test; blind panel; no sample (grep of `dist/`) | 7.3; DESIGN 9 checklist row "Sounds" |
| R4 | **Bundle gate** (fails before pets) | H | M | the ledger (6.1), the owner's decision, the levers (thumbnail, deferring S4/S5) | `vite build` G0 plugin (`vite.config.ts:171-182`) |
| R5 | **Frame cost of toys on a mat that already costs 8-10 ms** | H | H | toys are rigid shapes, never SoftBodies; 1/2/3 by quality; busy guard at 30 ms; budget 0.15 ms; S4a fallback | K10; the physics frame probe |
| R6 | **Soft-body glitches from collider pushes** (creases, inversions, pass-through) | M | H | the finger-tip friction and fold limits as the template; 200 fuzz runs x 12 families; a verifier-owned repro; the proxy fallback | 7.4; independent mesh-volume check |
| R7 | **A leak reads as a sick or broken pet** (a loss-state perception) | M | H | a tiny soft spot, floppy never ill, positive-affect bubble, seals itself on fade (2.5), always ends in a happy boing, Calm variant, screenshot review by the owner | K12; the copy lint; owner's review |
| R8 | **Save bugs lose bonds** | L | M | own key, backups, grow-only merge, `newer` mode, hostile-input fuzz | E01-E05, N1 |
| R9 | **A prune deletes valid pets after a Hoard hiccup** | M | M | prune only if the Hoard loaded cleanly and at most a quarter of the rows; removed rows are parked | S7-S9, E05 |
| R10 | **Merge regret** (a bonded pet blended away) | M | M | naming hearts it; the merge pad says "has a name"; hold-to-confirm already exists; heritage; parked rows | K-merge row in the browser section |
| R11 | **Bond becomes a price** in trade | L | H | never shown on the board or a trade card; the receiver starts at 0; no bond data in any `wh_*` call | grep `src/care` for outbound calls; payload test |
| R12 | **Privacy** (free text, data to the portal) | L | H | a nickname is an index into a list; nothing leaves the device except achievement slugs with exactly two keys | H01, K13 |
| R13 | **Accessibility gaps** (drag-only, live-region chatter, small targets) | M | M | keyboard path, tap-then-tap alternative (WCAG 2.5.7), live lines only for named events, 44 px targets | K1, K2, K4 |
| R14 | **Calm / reduced motion regressions** | M | M | every effect has a Calm variant listed in 5.5; the checks run each under Calm | K5 |
| R15 | **The economy tax annoys carers** (7-9% slower in care sessions) | M | L | quick care by design (halves it), the E2 option, a one-line disclosure to the owner | R1-R2 rows; aggregate (never personal) telemetry if the owner wants it |
| R16 | **Scripted touches pay** (ghost fingers) | M | H | tag and drop before the meter, haptics and `audio.poke`; press <= 0.3 s | F03, K9 |
| R17 | **Shared-file collisions** with TRUE CUT, LOCK and the UI overhaul | H | M | new files for almost everything; one care-seam change after TRUE CUT; physics members in a later round | `git diff --stat` per slice by the orchestrator |
| R18 | **The UI overhaul's dock or shelf is late** | M | M | S2 can use a plain button row; the shelf is a data list so only the picture changes | schedule |
| R19 | **Verification load** (three verifiers per slice, an agent usage limit about every two hours, `STATUS.md:43`) | H | M | small slices, running reports in `_handoff/reports/`, parallel lanes | the calendar |
| R20 | **The portal is not ready** (PORTAL.md and PUBLISH_CHECKLIST.md do not exist; the rows need the owner's yes) | H | M | the bridge no-ops without rows and as a guest; a local bridge host for the checks; achievements shipped dormant | K13 |
| R21 | **Clock skew** (a player moves the device date) | L | L | only the bond day tally can be reset; the per-kind and per-session caps bound the gain to 14 a session; cosmetic | Q3 |
| R22 | **Scope creep** (86 ideas) | H | M | slices, the ledger, the rule "if it has no jiggle it must be nearly free" (L10), one idea at a time in S5 | the byte ledger |
| R23 | **An unsafe or look-alike nickname** | L | M | the 48-name list passes the species gates (A02) | A02 |
| R24 | **iOS audio session** (voices before the audio unlock; the ringer switch) | M | L | voices only after `unlock()` (the engine already no-ops before it, `SOUND.md:65`); the audio session rules in SOUND.md:75-79 apply | existing audio gates |
| R25 | **The mouth question surfaces late** and changes the face | M | M | decide now (Q3); the design assumes no mouth | owner question |
| R26 | **Naming hearts a squishy and surprises the player** (they cannot blend it) | M | L | one clear line in the picker ("Named friends are kept safe from blending. You can change that in the Hoard.") | copy review |
| R27 | **Reload clears needs** (some players expect persistence) | L | L | by design (1.6); the pet book still shows everything that is kept | the owner's call |
| R28 | **Two lenses decide the same item differently** (foods, toys, tricks, voice kinds) | H | L | the registries are append-only data; names reconcile in `_spec/PETS.md`; ids are placeholders here | the fold |

---

## 10. Questions for the owner (genuine product choices), each with my recommendation

1. **The bundle gate.** The UI overhaul alone passes 1229 KB (1143 + 90 = 1233); pets add about 59 KB for the first publication and about 119 KB in all. **Recommend** raising G0 to **1.30 MB** for the first publication and **1.40 MB** when the toys and the rest land (the IDEAS lens suggests 1.5 MB if its extra phases are also wanted); keep the per-feature ledger (6.1) so a regression has a name. Alternative: recompress the 167 KB thumbnail (about 90-105 KB, unmeasured) and ship less.
2. **Does care pay squish points?** **Recommend no (E0)**, which is the owner's own rule (`FUN.md:47-48`). The cost, measured: an attentive carer collects capsules about 7-9% slower in those sessions (quick care: 3-6%); the population moves +2.8% at a 30% engagement. If the owner wants the tax repaid: E2 pays 6 SP per fulfilled want, daily cap 24 SP (0.24 of a capsule), farm-proof, and means a server protocol change. **Recommend waiting for real play data.**
3. **Do squishies get a mouth?** The written rule is "two glossy eyes, no mouth" (`DESIGN.md:701`, `CONTRACT.md:211`). **Recommend no mouth:** eating is the jelly engulfing the food (a travelling bulge), speaking is the whole body pulsing (`burstOpen`), both the soft-body edge. Alternative: a small dimple that opens for under a second while it eats or speaks.
4. **What is in the first publication?** **Recommend S1 + S2** (voices, moods, names, bond, feed and water): no physics change, 59 KB. Leak/refill and toys follow as updates 1 and 2. If toys must be in the first publication, use the proxy toys (S4a) and accept the loss of true deformation.
5. **Naming hearts a squishy** (so it cannot be blended or traded by accident). **Recommend yes**, with one clear line, un-heartable.
6. **Voices default on?** **Recommend on at 0.7**, with a one-line first-run sound question (normal, soft, off; `PETS_IDEAS.md:714`) that also sets the ceiling, and a captions default on.
7. **Free-text nicknames?** **Recommend no:** a 48-name list (the existing rule, `DESIGN.md:671-679`).
8. **Pet XP on the portal.** 16 achievements = 260 XP, 80 in the first publication. **Recommend** keeping the first eight and letting the owner set the tiers of the rest once the core achievements exist; consider dropping the diamond.
9. **Should the receiver of a traded pet inherit its bond?** **Recommend no** (bond restarts at 0; it can never be a price).
10. **Needs across sessions.** **Recommend session-only** (a reload clears every want): leaving never hurts a squishy.
11. **Quiet pets default.** **Recommend invitations on**, with the grace and back-off; the switch is one tap away.
12. **Telemetry.** The economy figures rest on assumed behaviour (`DESIGN.md:719` risk 5). If the owner wants a number from real players, an **aggregate, anonymous** count (care sessions, wants answered) is enough to decide E2; it needs the owner's yes and a privacy line. **Recommend not collecting anything in the first publication.**

---

## Appendix A. What I read and ran

**Read (path:line cited above):** `_handoff/briefs/RESUME.md`, `COMMON.md`; `_handoff/STATUS.md`; `_spec/DESIGN.md` 5.0-5.4, 6.5-6.7, 7.1, 8, 9, 10; `FUN.md`; `UI.md`; `CONTRACT.md`; `LOCK.md`; `SOUND.md` (structure, master chain, engine behaviour); `COLLECTION.md` (C-6, Hoard card); `src/contracts.ts`; `src/core/{save,meter,drops,settings}.ts`; `src/collection/{types,store,constants,index,meterfeed}.ts` and `ghost.ts` (task counting); `src/shell/{game,bodies,mat,feedback,playHistory,boot,hudBinding}.ts`; `src/ui/{announcer,toyTray,names}.ts`; `src/render/face.ts` (header); `src/physics/softbody.ts` (public members, 1194-1331, constants), `params.ts`; `_harness/{sim_economy,probe_catalog,run_probes}.ts`; the portal files `games/blocktooth/src/net/portal.ts`, `_spec/online/platform.md`, `src/lib/gameBridge.ts`, `supabase/migrations/0003`, `0005`; the sibling memo `_handoff/design/PETS_IDEAS.md`; `CUT2_RED_PRODUCT.md` (for the shell files TRUE CUT touches).

**Absence claims (the search that found nothing):** `PUBLISH_CHECKLIST.md` and `_spec/PORTAL.md` and `_spec/PETS.md`: `ls _handoff/design _spec` (2026-10-08 11:3x), none listed. `achievement` in `games/wobblehoard` outside `_spec` and `_handoff`: Grep, 0 hits in `src/`. A pet or nickname field in the save: `src/collection/types.ts:34` ("nicknames from a fixed list are not stored yet"). `seed_game_achievements` body: not in `supabase/migrations` (only the REVOKE/GRANT, `0005:58-59`).

**Ran (all from the game folder, one process at a time, everything killed afterwards):**

| Command | Result file |
|---|---|
| `node _harness/sim_economy.ts --micro` | `SC\out\baseline_micro.txt` (8 s) |
| `node --expose-gc SC\proto\probe.ts` | `SC\out\probe4.txt`: 26 / 26 (about 3 min under load) |
| `node SC\proto\economy.ts 120` | `SC\out\economy3.txt` (about 60-100 s) |
| `node SC\size\build.mjs <entry> <outdir>` for `entry_care`, `entry_save`, `entry_hoardstore`, `entry_meterfeed_drops`, `entry_settings_playhist` | raw / gzip sizes (section 6.1) |
| `node SC\size\phys_bench.mjs` | section 6.2 |
| `node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --erasableSyntaxOnly --verbatimModuleSyntax --isolatedModules --allowImportingTsExtensions ... SC\proto\care\*.ts` | clean, exit 0 |

An earlier run of the economy script had a modelling error (it suppressed free play during the 2-9 s the player took to respond); I found it by checking that the care share of time (6%) could not explain a 11% loss, fixed it (free play continues until the episode starts) and reran. The numbers in this memo are from the corrected run (`economy3.txt`); `economy1.txt` and `economy2.txt` are the superseded runs and should be ignored.

## Appendix B. Raw numbers

**Probe `SC\out\probe4.txt` (26 checks):** D1-D5 determinism, no wall clock, idle freeze; G1-G6 governor; Q1-Q3 quiet and never-refused and spam cap; N1 monotone under 800,000 calls; S1-S9 save, hostile, newer, tail, two tabs, prune; P1-P2 cost.
Cost: `update()` with 5 pets 0.138 / 0.187 / 0.414 us (best / median / max of 7 x 400,000 frames) in the last run; 0.616 / 7.37 / 13.2 us in an earlier run under heavy load; `note*` 50 ns quiet, 910 ns loaded; heap +5.4 KB over 2.8 M frames. Save: a row is 33 B, 8 pets 412 B.
Progression (days to bond level, median of 20 seeds, 90 days): see 3.5.

**Economy `SC\out\economy3.txt`:** the table of 3.3; the farm bot: 18.0 wants an hour; dividend 0 -> 0.000 SP/min; dividends 1.5 and 6 -> 0.017 SP/min (24 SP a day).

**Size:** prototype 13,624 B raw / 4,925 B gzip (406 code lines, 33.6 B per code line); `save.ts` and deps 11,385 B (617 code lines, 18.5 B per line); `settings.ts` + `playHistory.ts` + `rng.ts` 6,058 B (201 lines, 30 B per line); the stores with the catalog data 64-74 KB (not a per-line measure).

**Physics micro-benchmark (best of 9; median in brackets; loaded machine):** sphere touching 4.16 us per substep (57 us); sphere far 3.80 us (14.7 us); capsule touching 14.5 us (30 us); bulge pass 35 us (110 us) once a frame. Per 60 Hz frame (6 substeps): ball 0.025 ms; ball + stick 0.112 ms; three toys 0.137 ms; against the 2.0 ms bar: 5.6%.

## Appendix C. File-by-file list

| File | Lane | New / edited | Slice | Notes |
|---|---|---|---|---|
| `src/care/registry.ts` | CARE | new | S1 | the lists and constants of 1.5, 2.3, 2.2, 3.5 (about 100 lines) |
| `src/care/engine.ts` | CARE | new | S1 (moods, bond, heard), S2 (wants) | the prototype is 270 lines |
| `src/care/store.ts` | CARE | new | S1 | sanitize, serialize, rebase, prune + `createPetStore` (throttle, timers, subscribe, backup slots) |
| `src/care/achievements.ts` | CARE | new | S1 | `doneSlugs(save)` |
| `src/care/copy.ts`, `nicks.ts` | CARE | new | S1 | strings by id, the 48 names |
| `src/care/index.ts` | CARE | new | S1 | `createCare`, `createPets` |
| `_harness/probe_care.ts`, `sim_care.ts` | CARE / CORE | new | S1 | 7.1, 3.7 |
| `src/shell/care.ts` | SHELL | new | S1 | controller + executor |
| `src/shell/game.ts` | SHELL | edited (about 40 lines) | S1 | after TRUE CUT's shell round |
| `src/shell/boot.ts`, `hudBinding.ts`, `settingsCtl.ts`, `src/core/settings.ts` | SHELL | edited | S1 | |
| `src/ui/careBubble.ts`, `captions.ts`, `nickPicker.ts`, settings rows, Hoard card | SHELL (UI) | new / edited | S1, S2 | in the new UI kit |
| `src/audio/pet.ts`, `care.ts`, `engine.ts` | AUDIO | new / edited | S1.. | `_spec/SOUND.md` updated |
| `src/render/pet.ts`, `food.ts`, `toys.ts`, `fx.ts`, `stage.ts` | RENDER | new / edited | S1.. | |
| `src/physics/toys.ts`, `softbody.ts` | PHYS | new / edited | S3, S4 | |
| `src/contracts.ts`, `_harness/mocks.ts` | INTEGRATION | edited (additive) | S1.. | 5.1 |
| `_spec/PETS.md`, `CONTRACT.md` lane table and G10 | DOCS | new / edited | after the fold | |

## Appendix D. Copy rules for every care string (the lint of A04)

* Verbs that invite: "would like", "might enjoy", "is thinking about". Banned: urgency (now, hurry, quick, last chance, don't let), blame or loss (die, dead, sick, starving, neglect, forgot, lonely, miss you, abandoned, "your pet needs"), counters of days or streaks, exclamation marks on a want, red or alarm wording.
* The word for the spot is "soft spot" or "tiny hiss"; the actions are "Patch" and "Refill". (The word "leak" already names the capsule's tell-light, `PETS_IDEAS.md:56`.)
* Bubble text <= 40 characters, live-region line <= 80, no all-caps shouting; Calm and screen-reader variants say the same thing.
* Equal buttons: "Not now" and "Keep playing" have equal size and tone (`PETS_IDEAS.md:667`, row 19).
* Every string is screened by the species-name gates (`probe_catalog.ts:743-754`, `denyReasonText` and `unsafeReasonText`); those functions are local to that probe, so either export them from a shared module (a CORE change) or add the care strings to that probe's list.

## Appendix E. Index of the facts this memo stands on

`store.ts:85, 176, 225-256, 259-265, 308-315, 317-325, 391-393, 423-465, 554-557`; `constants.ts:23-45`; `types.ts:34, 76, 121-148, 168, 299`; `playHistory.ts:10, 35`; `save.ts:31-36, 71-73, 157, 225, 231-238, 366`; `settings.ts:13, 93-110, 170-188`; `meter.ts:28-55, 65-117`; `drops.ts:9-10, 115-117, 130-140`; `ghost.ts:65-79`; `game.ts:67, 392, 429-440, 508-520, 525-548, 557, 614, 697, 859`; `bodies.ts:17-36`; `mat.ts:22, 24, 30-47`; `feedback.ts:112, 121-123, 186-189, 253-256`; `boot.ts:72-73, 99, 102`; `announcer.ts:3`; `softbody.ts:429, 1194-1331, 1770, 2128`; `params.ts:11`; `contracts.ts:36-44, 112-195, 219-282, 287, 296-303, 355-417, 421-442`; `CONTRACT.md:25-52, 184-195`; `DESIGN.md:125-133, 246-262, 284, 316, 604-611, 665-679, 689, 701`; `FUN.md:39-47, 58-59`; `UI.md:15-17, 25-26`; `STATUS.md:4, 28, 31-43`; `RESUME.md:30-38, 88-102`; `COLLECTION.md:51, 560`; `vite.config.ts:24, 171-182`; `sim_economy.ts:128-178, 551`; `PETS_IDEAS.md:56, 76-85, 133-146, 154-161, 383-424, 612-633, 643-668, 681`.
