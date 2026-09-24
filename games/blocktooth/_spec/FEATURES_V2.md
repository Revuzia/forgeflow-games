# BLOCKTOOTH v2 — Feature Contract (owner items 2–8)

This is the build contract for the seven additions the owner asked for ("Do 2-8"). It is written in
the same register as `_spec/CONTRACT.md` and **extends** it; every rule there still applies (§0 lane
rules, §1 IP lock, §2 conventions, §5 sim architecture, §6 views, §15 gates). Where this file and
CONTRACT.md disagree, this file wins for v2 features only.

The exact TypeScript additions (unions, interfaces, config constants, module signatures) are in
**`_spec/features_v2_types.ts`**. It is a standalone snippet that is typechecked on its own (command in
its header; verified exit 0 after revision 2). Lane L0 merges it into `src/core/*`. Revision 2 also puts
the exact signature of **every view and UI entry point `game.ts` calls** in the snippet (the "APP-SIDE"
section), so L0 can pre-wire `game.ts` once and no later lane needs to touch it.

**Revision 2 (2026-09-24)** resolves every blocker and major finding of the independent review and most
minors. What changed and why is in the **Review log** at the end of this file.

| # | Owner item | Section |
|---|---|---|
| 2 | Charged ultimate ("UPROAR") | §3 |
| 3 | Ability bar + icons + hook cooldown panel + UPROAR meter | §4 |
| 4 | Map objectives (OVERLOAD SITE, RELIEF DEPOT, RECORDS ANNEX) | §5 |
| 5 | Unlocks, goals, "your next unlock", achievements screen | §8 |
| 6 | A unique boss per city (new GRID-EAST boss **PARKADE-6**) | §10 |
| 7 | Cinematic opening (street-level news-cam close-up) | §11 |
| 8 | Evolutions (§7), map power-ups (§6), banish/lock (§7), EXTENDED COVERAGE endless mode (§9), achievements (§8) | §6–§9 |

Build plan, file ownership, order and gates: **§15**. Owner decisions still open: **§16**.

---

## §0 Preconditions and ground rules

1. **The growth workflow lands first.** Level-driven growth, the zoom camera and the HUD SIZE bar are
   being built in files v2 must also touch (`titansim.ts`, `config.ts`, `types.ts`, `upgrades/*`,
   `data/upgrades.ts`, `director.ts`, `bosses/index.ts`, `camera.ts`, `input.ts`, `game.ts`, `hud.ts`,
   `styles.css`, `strings.ts`, `titanview.ts`, `anim.ts`, `lighting.ts`, `cityview.ts`, `README.md`).
   No v2 lane starts until that workflow has merged and its gates pass. v2 numbers below refer to its
   constants by name (`RANK_LEVELS`, `titanHeightAt`, `spawnRing`), never by value, so they survive its
   final tuning. At the time of writing, `config.ts` has `RANK_LEVELS = [1, 7, 16, 27, 35]`.
2. **Lane L0 (SKELETON) runs alone before any other v2 lane** (§2.7). It merges the types and config,
   creates every new module as an inert stub with its exact exports, and pre-wires every call site. After
   L0, the game builds, plays and passes GATE 2 exactly as before; every later lane only fills in its own
   files.
3. **Sim/view split holds.** Everything that changes gameplay is sim code: THREE-free, DOM-free,
   deterministic, random draws only from `world.rng.<stream>`, no clocks. New sim modules live in
   `src/meta/` (ultimate, objectives, power-ups, tally, endless, perks) and `src/ai/bosses/parkade6.ts`.
   Views and UI read state and `SimEvent`s and never write gameplay state.
4. **One new RNG stream, `rng.meta`**, for objective placement, power-up drops, power-up kinds and
   endless skew. Streams are seeded by `hashStr(name)`, so adding one shifts no existing stream. v2 code
   draws from `rng.loot` only in the draft (§7), and only in the new branches (evolution ready, banish
   refill). A run with v2 features switched off (no evolution ready, no banish) draws the loot stream
   exactly as before.
5. **Meta never leaks into the sim mid-run.** Profile unlocks, perk and palette enter a run only
   through `RunOptions.meta` → `w.meta` at `createWorld`. A goal completed mid-run takes effect next
   run. Same seed + same `RunMeta` + same inputs → same state hash.
6. **GATE 2 still holds.** Rank bands II 60–150 s, III 150–300 s, IV 280–450 s, V 400–560 s, boss
   spawn ≤ 560 s, ≥ 8/12 clears in 8–12 min with some deaths, early draft gap median 8–30 s. It must
   pass with a **fresh** profile (`--meta fresh`, the default) and a **full** profile (`--meta full`:
   everything unlocked, no perk). Every sim lane re-runs it before reporting (§15.4). Because each lane
   tunes in isolation, the orchestrator also runs the **combined** GATE 2 (fresh and full) after every
   sim chunk merges (after C1 and after C2), not only in the final battery (§15.1). v2 adds three GATE 2
   reporting lines and one check (L0 adds them to `probe_sim.ts`): the share of all XP granted through
   the UPROAR bank (`w.ult.xpTotal`), through OVERLOAD SITE payouts (`w.map.overloadXp`), and the
   DEMOLITION kill count (`w.map.demolitionKills`); and **at least 1 death across the 12-run matrix**
   (the "with some deaths" leg, made explicit because v2 adds heals, shields and screen clears).
7. **Originality (§1) is absolute for every new name, silhouette and line of copy.** §1 of this file
   is the register of every new name. Two more rules for v2:
   * **No red-cross emblem** anywhere (health crates, heal icons). The red cross on white is a protected
     emblem. Health reads as a **teal bandage "+" on a cream disc**, or a heart.
   * The reference video is used for mechanics and feel only. None of its names, copy ("KAIJU
     SIGHTED!", "ROAR!! CHARGED!", "CHARGED", "SMASH CORE", "CORE EXPOSED", "YOUR NEXT UNLOCK",
     "Best run: …", "All goals", a "★n" level badge), boss designs (a siege centipede), screen
     compositions (the letterboxed close-up with a red tab top-left, a LIVE bug top-right and a street
     sign in the left third; the unlock strip with an "All goals" button at its right end) or Japanese
     UI text may appear. Functional HUD placement the owner explicitly asked for (a bottom row of
     ability icons, a cooldown panel for the active ability) is a genre convention and is allowed; its
     visual treatment (glyphs, frames, meter, badges, copy) must be BLOCKTOOTH's own.

---

## §1 Name register (all new names — use exactly these)

| Thing | Name | Notes |
|---|---|---|
| Ultimate meter | **UPROAR** | HUD meter label; "UPROAR READY" when full (the ONLY "ready" copy: there is no world-space text over the titan) |
| MOLO ultimate | **STREET SWALLOW** | burst word `GLORRP!` |
| VOLT-KITE ultimate | **GRIDLOCK SURGE** | burst word `KZZRAKK!` |
| HEARTHBACK ultimate | **CALDERA BLOWOUT** | burst word `FWOOMB!` |
| BRIARWICK ultimate | **GREENBELT DECREE** | burst word `SKRRITCH!` |
| Objective: energy target | **OVERLOAD SITE** (was "SURGE NODE" in rev 1) | Size II+: GRID-EAST "rooftop transformer", WHITE STACKS "pump house", LOCKWATER "tide relay"; Size I: a parked "utility truck" / "generator container" / "relay container"; done stamp `LOAD SHED` |
| Objective: health crates | **RELIEF DEPOT** | stacked municipal supply crates, teal bandage emblem |
| Objective: chest building | **RECORDS ANNEX** | "the city keeps its paperwork here" |
| Power-up: magnet | **CLEANUP CREW** | every pickup on the map comes home |
| Power-up: bomb | **DEMOLITION NOTICE** | screen clear of regular foes |
| Power-up: freeze | **RED LIGHT** | foes, shots and their paint stop |
| Power-up: frenzy (original) | **RUSH HOUR** | attack speed, move speed, contact smash |
| Power-up: meter fill (original) | **BACK PAY** | UPROAR to full |
| Evolution rarity label | **RESTRUCTURED** | draft stamp for evolution cards |
| Endless mode | **EXTENDED COVERAGE** | opt-in `KEEP GOING` on the clear front page |
| Endless tabloid headline | **IT WOULD NOT LEAVE.** | kicker `EXTENDED COVERAGE EDITION` |
| Goals screen | **GOALS & RECORDS** | from the title (`G`) and the select screens |
| Unlock panel | **NEXT PERMIT PENDING** | select screens (a stamped permit slip, §8.4) |
| Personal-best line | **YOUR BEST ON FILE** | `YOUR BEST ON FILE: LV n · SIZE r · m:ss`, on the focused select card's foot |
| Goals entry chip | **GOALS & RECORDS [G]** | title + select confirm bars |
| Unlock toast | **GOAL MET** | kicker line |
| Level badge | `L2`…`L5`, **`MAX`**, **`EVO`** | ability bar + LOADOUT (no star glyph) |
| GRID-EAST boss | **PARKADE-6** | "HALVARD MOBILE PARKING STRUCTURE", meter **JAM** |
| PARKADE-6 weak point | **the TILL** | a pay-station drawer that slides out of the toll booth; open window "THE TILL IS OPEN", marker `HIT THE TILL` |
| Cinematic cam | **WARD-7 STREET CAM** | lower third keeps `UNIDENTIFIED MASS — …` |

Every name was checked against the current source (`grep -ril` over `src/`, 2026-09-24). Collisions
found and avoided: "Overtime" (cards Overtime Shift / Mandatory Overtime), "Recall" (card Recall
Notice), "WHITEOUT" (IRON GULLY combo), "Kiln" (card Kiln-Fired Plating), "Jaws of Life" (a real
trademark), "Emergency …" (three existing cards). Revision 2 re-ran the check and fixed what rev 1
missed: "SURGE NODE" collided with GRIDLOCK SURGE and the card Surge Protector (→ OVERLOAD SITE; "Fuse
Box" and "Tripped Breaker" are existing cards, "overload" has 0 hits in `src/`); "Pothole Patch" shared
"Pothole" with the card Pothole Report (→ **Manhole Lid**, 0 hits for "manhole"); the goal NIGHT SHIFT
overlapped the card Night-Shift Nurse (→ **EARLY CLOSING**); the goal RESTRUCTURED repeated the evolution
stamp (→ **CHANGE ORDER**); the goal EXTENDED COVERAGE repeated the mode name (→ **STILL ON AIR**).
One overlap is kept on purpose: RELIEF DEPOT and the HEARTHBACK card Pressure Relief Valve share the
common word "relief"; one is a map objective and the other a card, and the rest of each name differs.
Every other new card, perk, goal and palette name repeats no existing upgrade name and none of its
distinctive words.

---

## §2 Shared contract changes (lane L0 applies them)

### 2.1 Unions and new types (`types.ts`)
From `features_v2_types.ts`: `BossId += 'parkade6'`; `StatKey += 'ultCharge' | 'ultPower'`;
`TriggerAction += 'ultCharge'`; `ProjectileKind += 'carLob'`; `RunPhase += 'endless'`;
`AlertKey += 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch'`. New: `UltState`, `Objective`,
`ObjectiveKind`, `PowerUp`, `PowerUpKind`, `MapState`, `EndlessState`, `RunTally`, `RunMeta`, `PerkId`,
`EMPTY_RUN_META`, `ObjectiveTarget`. New fields: `RngStreams.meta`, `TitanInput.ultimate?` (**optional**,
read as `!!input.ultimate`, so the 23 existing `TitanInput` literals in `src/`, `_harness/` and
`_harness/scratch/` that `tsconfig` includes stay valid), `UpgradeDef.evo/locked/perk`,
`UpgradeState.banished/banishLeft/lockLeft/locked`, `World.meta/ult/map/tally/endless`,
`RunOptions.meta?`. `SimEvent` gains the 12 variants of `SimEventAdd`.

Exhaustive records that must gain an entry when the unions grow (L0 fills them, so `tsc` stays at 0;
list from `grep -rn "Record<StatKey\|Record<BossId\|Record<ProjectileKind\|Record<AlertKey"` over `src/`
and `_harness/`, 2026-09-24):

| Union | Records to extend | Entry L0 writes |
|---|---|---|
| `BossId` | `data/bosses.ts BOSSES`, `BOSS_DEFAULT_SUBTITLE`; `ai/bosses/index.ts MODS` | §10.2 def + subtitle; `MODS.parkade6` = the stub module |
| `StatKey` | `data/titans.ts DEFAULTS` (a `StatBlock`), `upgrades/stats.ts baseStatBlock / STAT_KEYS / LIMITS`, `data/upgrades.ts STAT_TEXT`, **`_harness/probe_upgrades.ts` `EXPECT: Record<StatKey, number>` (line 277)** | default 1 / 1; limits `[0.2, 5]` / `[0.1, ∞]`; labels "UPROAR charge rate" / "UPROAR power"; `EXPECT` entries = the defaults |
| `TriggerAction` | `data/upgrades.ts actionText`, `upgrades/engine.ts execute` | text: `add N UPROAR (+N per stack)`; execute → `addUproar(w, amount × stacks)` |
| `ProjectileKind` | `render/projectileview.ts LOOK` | copy of the `plate` look (L7 replaces it) |
| `AlertKey` | `data/strings.ts ALERTS` | copy in §2.5 |

### 2.2 Config constants (`config.ts`)
Copy `ULT`, `ULT_CITY_RANK_MUL`, `ULT_GAP_BAND_S`, `OBJECTIVES`, `POWERUPS`, `DRAFT_V2`, `ENDLESS`,
`PERKS`, `HOOK_WINDOW_S` verbatim from the snippet. They are starting points. The lane that owns the
system tunes them against its probe, and GATE 2 decides. Each lane records what it measured in a
comment table at the top of its module, in the style of the `config.ts` ECONOMY + THREAT table.

### 2.3 Tick order v2 (`world.ts`)
```
events cleared → snapshot prev → tick/t++ → stepCity → rebuildEnemyGrid → stepUltimate* → stepTitan →
stepDirector → stepEndless* → stepEnemies → stepBoss → rebuildEnemyGrid → stepProjectiles →
stepTelegraphs → stepHazards → stepPickups → stepUpgrades → processTriggers →
stepObjectives* → stepPowerups* → chargeUltimate* → stepTally* → peakRank → checkRunEnd(v2) →
compact/30 (+ map arrays)
```
(* = new.) Why this order:
* **`stepUltimate` before `stepTitan`**: the fire (read from `input.ultimate`) sets `ult.invulnT` and
  the roar move multiplier on the same tick, so the titan is never hit or moved at full speed on the
  first roar tick. The pulses use the grid built just before.
* **`stepObjectives` and `stepPowerups` after `processTriggers`**: every `buildingCollapse`,
  `propDestroyed` and `enemyKilled` of the tick, including the ones trigger procs emit (shockwave,
  meteor, Teardown Mandate, Utility Bill …), is in `w.events` when they read it, so a site flattened by
  a proc pays out and a proc kill can drop a power-up. As a second guard, `stepObjectives` also
  **sweeps state**: a bound building found `collapsed` (or a bound prop found `!alive`) without a
  credited event this tick expires the objective (`objectiveExpire`) instead of leaving it stuck.
* Consequence (accepted, documented): kills made **by** a power-up (DEMOLITION NOTICE) happen after
  `processTriggers`, so they do not proc on-kill cards; they still charge UPROAR and count in the tally
  (both run after). Payout **XP is never granted directly** after `processTriggers` (a `levelUp` pushed
  there would be cleared before any trigger saw it): an OVERLOAD SITE pays its XP as one `scrap` pickup
  spawned on the titan (`spawnPickup(w, 'scrap', T.x, T.z, xpFrac × xpToNext(T.level), 0)`), which the
  next tick's `stepPickups` collects before `processTriggers`, so level-up procs fire normally.

`createWorld` also sets `meta: sanitizeRunMeta(opts.meta)`, `ult: createUltState()`,
`map: createMapState()`, `tally: createTally()`, `endless: null`, and calls `applyPerk(w)` after
`recomputeStats(w)` and before `hp = maxHp`. `NO_INPUT` is unchanged (the field is optional).

**`checkRunEnd` v2:**
```ts
if (w.run.result) return;
if (!w.titan.alive) {
  if (tryRevive(w)) return;                           // perk STAY OF DEMOLITION (§8.5)
  w.run.result = 'dead'; w.run.phase = 'dead'; w.run.endT = w.t; push runEnd dead;
} else if (!w.endless && w.director.bossSpawned && w.boss && !w.boss.alive) {
  w.run.result = 'clear'; w.run.phase = 'clear'; w.run.endT = w.t; push runEnd clear;
}
// in endless (w.endless !== null) only the titan's death ends the run
```
`compact` also keeps `w.map.objectives` and `w.map.powerups` short.

### 2.4 Input: two layers, bound where each is actually read

There are two input paths and v2 binds each action on the one that reads it:
* **Gameplay** reads `core/input.ts` Actions (`KEYMAP` + the pad switch in `pollPad`, mode `'game'`).
  v2 adds exactly **one** Action there, `ultimate`.
* **Every modal screen** (title, select, draft, pause, tabloid, goals, cinematic) reads
  `ui/dom.ts UiKeys`, whose `UiPress` carries `act` (from `mapKey` / `PAD_MAP`: pad 0 confirm, 1 back,
  2 reroll, 3 alt, 8 back, 9 pause, d-pad) and `key` (lower-case `KeyboardEvent.key` or `'pad:<n>'`).
  v2 screen bindings are read **from `p.key` inside the screen module**, checked before its
  `switch (p.act)`, exactly as the tabloid already reads R / C / T. **`ui/dom.ts` is not edited by any
  lane** (no new `UiAct`, `mapKey` and `PAD_MAP` unchanged), so no lane needs to own it.

| Action | Keyboard | Gamepad (standard mapping) | Read by |
|---|---|---|---|
| **ultimate** (UPROAR) | **E** | **Y** (3) or **RT** (7) | `core/input.ts` Action, mode `'game'`, buffered and consumed once like `ability` |
| **banish** (draft) | **X** (`p.key === 'x'`) | **hold Y** (`'pad:3'` edge, then held ≥ `DRAFT_V2.banishHoldS` = 0.5 s; a fill ring grows on the card) | `ui/draft.ts` |
| **lock** (draft) | **C** (`'c'`) | **LB** (`'pad:4'`, unmapped in `PAD_MAP` → `act` null) | `ui/draft.ts` |
| **goals** (title, select) | **G** (`'g'`) | **X** (`'pad:2'`; `act` 'reroll', which title and select ignore) | `ui/menus.ts` TitleScreen, `ui/select.ts` |
| **keep going** (clear tabloid) | **K** (`'k'`) | d-pad to the button + **A** | `ui/broadcast.ts` |

The constants are `UI_BIND` in the snippet. Collisions checked against the code, not only `KEYMAP`:
* **Pad Select (8)** stays `'back'` everywhere (it steps the select screen back, `select.ts:139`), so
  it is not used for goals. **Pad Y (3)** stays `'alt'` = confirm on the title and select screens
  (`menus.ts:143`, `select.ts:139`), so it is not used there for anything new; in the draft `'alt'` has
  no case, so Y is free there.
* **Mash protection for BANISH.** Pad Y is UPROAR in play, so a player mashing Y when a level-up draft
  pops could otherwise banish blind. Three guards, all in `ui/draft.ts`: (1) `UiKeys` already
  edge-detects pad buttons against a snapshot taken at `start()`, so a Y still held from play is not a
  press; (2) BANISH ignores presses for `DRAFT_V2.banishArmS` = 0.6 s after the draft opens (on top of
  the draft's `armMs` 260); (3) on pad, BANISH is a **0.5 s hold**, polled through `UiKeysOpts.onFrame`
  with `navigator.getGamepads()` (taps never complete it). Keyboard X is not a gameplay key, so it is a
  single press. LOCK is reversible within the draft (unlocking refunds), so LB is a single press; pad
  RT has no binding in any modal screen.
* Keyboard X / C / G / K are unmapped in `mapKey` today (`act` null), so no existing screen reacts to them.

`actionLabel('ultimate')` returns `E` / `Y`. The "any key" list in `input.ts` already contains Y.
`titanInput()` returns `ultimate` (`true` once within the buffer window), consumed exactly like `ability`.

### 2.5 Copy L0 writes into `strings.ts ALERTS`
| key | title | sub |
|---|---|---|
| overloadSite | `OVERLOAD SITE ON THE GRID` | `A MARKED UTILITY STRUCTURE IS OVERLOADING — RESIDENTS ADVISED TO UNPLUG` |
| recordsAnnex | `RECORDS ANNEX LOCATED` | `SEALED MUNICIPAL PAPERWORK — HALVARD HAS POSTED A GUARD` |
| endless | `EXTENDED COVERAGE` | `THE BROADCAST CONTINUES. SO DOES THE SUBJECT.` |
| rematch | `CONTAINMENT RESUBMITTED` | `HALVARD HAS SENT ANOTHER RIG. IT HAS BEEN REINFORCED.` |

All other new copy lives in two new files (§15.2): `data/strings_hud.ts` (L8) and
`data/strings_screens.ts` (L9). `strings.ts` itself is not edited after L0.

### 2.6 New modules and exact exports
Signatures are the `Mod*` (sim) and `*Api` / `*Add` (app-side) interfaces in the snippet. Summary:

| Module (lane) | Exports |
|---|---|
| `meta/ultimate.ts` (L1, sim) | `createUltState()`, `stepUltimate(w)`, `chargeUltimate(w)`, `addUproar(w, points, raw?)`, `ultRadius(w)`, `ultBankKill(w, x, z, xp, mass): boolean`, `ultMoveMul(w)` |
| `data/ultimates.ts` (L1) | `ULTS: Record<TitanId, UltDef>` |
| `meta/objectives.ts` (L4, sim) | `createMapState()`, `stepObjectives(w)`, `spawnObjective(w, kind)` |
| `meta/powerups.ts` (L4, sim) | `stepPowerups(w)`, `spawnPowerup(w, kind \| null, x, z, forced)`, `redLightActive(w)` |
| `data/objectives.ts`, `data/powerups.ts` (L4) | `OBJECTIVE_BIOME: Record<BiomeId, ObjectiveBiomeCfg>`, `OBJECTIVE_NAMES`, `POWERUP_NAMES`, `POWERUP_DESC` |
| `meta/tally.ts` (L5, sim) | `createTally()`, `stepTally(w)` |
| `meta/endless.ts` (L5, sim) | `continueEndless(w)`, `stepEndless(w)`, `endlessBudgetMul/HpMul/DmgMul(w)`, `endlessBossDmgMul(w)`, `endlessScore(w)`, `rematchOrder(biome)` |
| `meta/perks.ts` (L5, sim) | `sanitizeRunMeta(v)`, `applyPerk(w)`, `tryRevive(w)` |
| `meta/goals.ts` (L5, app-pure) | `goalProgress`, `evalGoals`, `applyRunToProfile`, `unlockedIds`, `runMetaFor`, `nextUnlock`, `unlockLabel`, `markSeen` |
| `meta/profile.ts` (L5, app-pure) | `sanitizeProfile(v)`, `emptyProfile()` |
| `data/goals.ts`, `data/perks.ts`, `data/palettes.ts` (L5) | `GOALS: GoalDef[]`, `PERKS_DEF: Record<PerkId, PerkDef>`, `TITAN_PALETTES: Record<TitanId, [TitanPalette, TitanPalette]>` |
| `core/save.ts` additions (L5) | `loadProfile(): Profile`, `saveProfile(p): boolean`; `Settings.reduceMotion`, `Settings.cinematic` |
| `data/upgrades_v2.ts` (L2) | `UPGRADES_V2_RAW: UpgradeDef[]` (desc `''`; `data/upgrades.ts` fills desc with `describe()` and appends them to `UPGRADES`, see §7.1) |
| `data/evolutions.ts` (L2) | `EVOLUTIONS: readonly EvolutionRow[]` (mirror of the `evo` fields, catalogue order), `EVO_OF_BASE: Readonly<Record<string, string>>` (base id → evo id) |
| `upgrades/draft.ts` additions (L2) | `banishCard(w, id)`, `lockCard(w, id)`, `evolutionsReady(w)` |
| `ai/bosses/parkade6.ts` (L3, sim) | `create`, `step`, `onDamage`, `keepOut` (the BossModule shape) |
| `ai/bosses/index.ts` addition (L0) | `bossUltHit(w, frac, meter): number` |
| `render/ultview.ts` (L6) | `class UltView implements ViewModule` |
| `render/objectiveview.ts` (L6) | `class ObjectiveView implements ViewModule` |
| `render/powerupview.ts` (L6) | `class PowerupView implements ViewModule` |
| `render/markerview.ts` (L6) | `class MarkerView implements ViewModule, MarkerViewApi` (`frame(): MarkerFrame`, ≤ 12 items): projected screen positions for the DOM marker layer |
| `ai/foemodels_parkade.ts` (L7) | `buildParkadeRig(glowMul: number): BossRig`, `type ParkadeRig = BossRig` (L0 exports `BossRig`, `LegRig`, `FlashGroup` from `bossview.ts` unchanged) |
| `ui/icons.ts` (L8) | `GLYPHS: Record<GlyphId, string>`, `iconFor(u): GlyphId`, `glyphSvg(id, fill, sizePx?)`, `rarityFrameClass(u)`, `familyColor(u)` |
| `ui/abilitybar.ts` (L8) | `class AbilityBar implements AbilityBarApi { constructor(root) }` (slots + UPROAR meter + ACTIVE panel) |
| `ui/tracker.ts` (L8) | `class ObjectiveTracker implements TrackerApi { constructor(root) }` |
| `ui/markers.ts` (L8) | `class ScreenMarkers implements MarkersApi { constructor(root) }` |
| `ui/toast.ts` (L8) | `class Toasts implements ToastsApi { constructor(root) }` |
| `ui/goals.ts` (L9) | `class GoalsScreen implements GoalsScreenApi { constructor(root, input) }`, `class NextUnlockPanel implements NextUnlockPanelApi { constructor(host: HTMLElement) }` |
| `ui/menus.ts` changes (L9) | `TitleScreen.run(): Promise<'play' \| 'goals'>` (`TitleScreenApi`); `PauseMenu.open(ctx: PauseCtx \| null)` (`PauseMenuApi`) |
| `ui/select.ts` change (L9) | `SelectScreen.run(opts: SelectRunOpts): Promise<SelectResultV2>` (`SelectScreenApi`) — replaces `run(portraits, initial)` |
| `ui/draft.ts` change (L9) | `DraftScreen.open(w, offer, ctx: DraftCtx): Promise<DraftResultV2>` (`DraftScreenApi`) — replaces `open(w, offer, rerollsLeft)` |
| `ui/broadcast.ts` change (L9) | `Broadcast.tabloid(w, photo, extra: TabloidExtra): Promise<TabloidChoiceV2>` (`BroadcastAdd`) |
| `ui/cine.ts` (L10) | `class CineOverlay implements CineOverlayApi { constructor(root, input) }`: `play(plan, info): Promise<'done' \| 'skipped' \| 'aborted'>`, `setShot(s \| null)`, `skip()`, `clear()` |
| `render/cinecam.ts` (L10) | `class CineCam implements CineCamApi { constructor(camera: PerspectiveCamera) }`: `plan(w, rig, face, variant): CinePlan \| null`, `start(plan)`, `update(dt): boolean`, `skip()`, `stop()`, `shot`, `channels()` |
| `titans/titanview.ts` additions (L0 stub, L10) | `faceAnchor(out: FaceAnchor): boolean`, `setCine(ch: CineChannels \| null): void` (`TitanViewAdd`) |
| `titans/portraits.ts` addition (L0 stub, L10) | `renderPortrait(renderer, id, size, palette: TitanPalette \| null): Promise<string>` (`RenderPortraitFn`) |
| `data/cine.ts` (L10) | `CINE: Record<BiomeId, CineBiome>` (per-biome shot variants, §11.3) |

`MarkerFrame`, `MarkerItem`, `ToastSpec`, `GlyphId` (58 ids), `CineShot`, `CinePlan`, `CamPose`,
`FaceAnchor`, `CineChannels`, `CineBiome`, `CineInfo`, `DraftCtx`, `SelectRunOpts`, `SelectResume`,
`TabloidExtra`, `PauseCtx` are all defined in the snippet. Marker pixel coordinates are CSS px; `angle`
is the edge-arrow direction when off-screen; `dist` is in blocks (m ÷ `CITY.pitch`).

### 2.7 L0 SKELETON: what "inert" means
L0 (the orchestrator, or one agent working alone) does all of the following, then proves nothing changed:
1. Merge §2.1 to §2.5. Add `meta: s('meta')` to `makeStreams`. Initialise the new `UpgradeState`
   fields in `createUpgradeState` (`banished: []`, `banishLeft: DRAFT_V2.banishes`,
   `lockLeft: DRAFT_V2.locks`, `locked: null`) and the new `World` fields in `createWorld` (§2.3).
2. Create every §2.6 module as a **stub with the exact exports**: sim steps are no-ops; `ultRadius`
   returns `max(ULT.rFloorH × H, ULT.rFrac × spawnRing(w))`; `ultBankKill` returns false; `ultMoveMul`,
   `endless*Mul` return 1; `redLightActive` returns false; `continueEndless` returns false; `tryRevive`
   returns false; `sanitizeRunMeta` returns a copy of `EMPTY_RUN_META`; `markSeen` returns its input;
   data arrays are empty; view and UI classes do nothing; `CineCam.plan` returns null (→ legacy slate);
   `TitanView.faceAnchor` returns false; `renderPortrait` returns the canonical portrait;
   `buildParkadeRig` returns a placeholder `BossRig` (a slab and 6 box legs from bossview's own mesh
   helpers, named `'boss:parkade6'`, no posing); `parkade6.ts` is a copy of the smallest boss behaviour
   (stands still, never attacks). The biome still points GRID-EAST at CAISSON-4.
   The changed UI entry points (`TitleScreen.run`, `SelectScreen.run`, `DraftScreen.open`,
   `Broadcast.tabloid`, `PauseMenu.open`) get their **v2 signatures** with today's behaviour: title
   never resolves `'goals'`, select returns `{kind: 'start', …, perk: null, palette: 0}`, the draft
   ignores the new ctx fields and never resolves `{banish}` / `{lock}`, the tabloid ignores `extra`
   and never resolves `'endless'`, the pause menu ignores `ctx`.
3. Pre-wire every call site, so later lanes never edit a file they do not own:
   * `combat/damage.ts killEnemy`: `if (!ultBankKill(w, e.x, e.z, xp, mass)) { …today's scrap loop… }`
     (heal and chest drops unchanged). DEMOLITION kills bank the same way: `meta/powerups.ts` sets
     `w.ult.bankOpen = true` around its kill loop and false after (normal XP, no cap); `stepUltimate`
     flushes the bank every tick.
   * `titans/titansim.ts`: `hurtTitan` returns 0 first thing when `w.ult.invulnT > 0` (covers `dot`,
     unlike `iframeT`); max move speed × `ultMoveMul(w)` in `stepTitan`; incoming damage ×
     `endlessDmgMul(w)`.
   * `ai/bosses/index.ts`: `bossHostile(w, base)` × `endlessBossDmgMul(w)`; `spawnBoss` sets
     `run.phase = 'boss'` only when `!w.run.result && !w.endless` (a rematch keeps `'endless'`).
   * `ai/bossview.ts`: export `BossRig` / `LegRig` / `FlashGroup` (types unchanged); rig construction,
     warm-up loops (today `['caisson4', 'irongully']`, lines ~893–941) and the pose dispatch (~1017,
     1024, 1275) gain a `parkade6` branch calling `buildParkadeRig` and a no-op `poseParkade`, so a
     `parkade6` boss never falls into the IRON GULLY path (today any non-CAISSON id renders as
     `buildGully`, line 893).
   * `titans/titanview.ts`: the `faceAnchor` / `setCine` stubs. `titans/portraits.ts`: the
     `renderPortrait` stub.
   * `ai/director.ts`: `budgetRate × endlessBudgetMul(w)`. Waves are held and the budget does not bank
     while `redLightActive(w)`.
   * `ai/enemies.ts`: spawn HP × `endlessHpMul(w)`. `stepEnemies` skips AI and movement for every enemy
     while `redLightActive(w)` (timers `t` and `cd` do not advance; `flash` still decays).
   * `combat/projectiles.ts`: hostile projectiles owned by `'enemy'` do not move or age under RED LIGHT.
     Boss-owned and titan-owned projectiles are unaffected.
   * `combat/telegraphs.ts`: enemy-owned telegraphs do not advance `t` under RED LIGHT. Boss-owned and
     titan-owned telegraphs are unaffected.
   * `ai/bosses/index.ts`: `bossUltHit` (real implementation, about 15 lines, **body-only and exact**:
     no-op during intro or when dead; the boss loses exactly `min(frac × maxHp, hp)`, credited to
     `parts[0]` in the `bossHit` event; `BOSS_KIND_MUL`, part `hpMul` / `strainMul` and the stagger ×2
     are ignored; the meter gains exactly `meter` through `addMeter`, never derived from the damage;
     `checkPhase`; defeat at 0), and `MODS.parkade6`.
   * `game.ts`: construct `AbilityBar`, `ObjectiveTracker`, `ScreenMarkers`, `Toasts`, `GoalsScreen`,
     `CineOverlay`, `CineCam`, and mount `UltView`, `ObjectiveView`, `PowerupView`, `MarkerView`. Each
     is updated in `drawWorld` next to the HUD. Wire every flow in §13.1 against the stubs, using only
     the snippet's APP-SIDE signatures. Every stub keeps today's behaviour.
   * `testsurface.ts`: `state().v2` and the cheats in §13.3, calling the (stub) module exports.
   * `_harness/bot.ts`: calls `botUltimate(w)` (`_harness/bot_ult.ts`), `botDraftScore(w, id)`
     (`_harness/bot_draft.ts`) and `botDetour(w, out)` (`_harness/bot_map.ts`). Stubs return
     false / null / null. `_harness/probe_sim.ts` gains `--meta fresh|full` and the v2 GATE 2 report
     lines (§0.6: XP shares, DEMOLITION kills, deaths ≥ 1).
4. Gates for L0: `tsc` 0; `node _harness/probe_sim.ts --det 2` → `GATE 2: PASS` with rank-up times
   within ±2 s of the pre-v2 run on seed 1337. The stubs are inert, so the only allowed difference is
   the new stream's construction. Lane probes all exit 0; `bootcheck.py --titan molo --biome grideast`
   passes; `playtest.py --titan voltkite --biome lockwater` passes.

---

## §3 #2 UPROAR: the charged ultimate

### 3.1 Player-facing behaviour
* The **UPROAR** meter (0–100) fills from destruction, kills, taking hits and hitting a boss. When it
  is full, the ready beat fires: the meter flashes and turns gold, a 2-note brass stab plays, and the
  titan's glow parts pulse. The HUD meter reads `UPROAR READY — [E]` (or `[Y]` on pad). There is **no
  text over the titan** (rev 2: the rev-1 world-space `CHARGED` burst copied the reference, §0.7).
* Pressing **E / pad Y / pad RT** fires the titan's ultimate. **ROAR** (0.4–0.6 s): the titan rears and
  roars. It takes no damage of any kind (`ult.invulnT` = the roar length; `hurtTitan` returns 0 first
  thing, `dot` included, L0 pre-wire), moves at 30 % (`ultMoveMul`, read by `stepTitan`; `stepUltimate`
  runs before `stepTitan`, so this holds from the fire tick), and any WINCH/TOW leash on it snaps
  (`T.leash = null` + `leash off` event). At the end of the roar, every hostile **non-boss** projectile
  and every unfired **enemy-owned** telegraph inside the blast radius **R** is deleted. Then comes the
  **BLAST** (titan-specific, 0.6–1.0 s). The meter is frozen for `ULT.lockoutS` = 6 s after firing.
* **R = max(3 H, 0.95 × spawnRing(w))**. `spawnRing` is the sim's "just off-screen" radius at the
  **auto framing** (zoom 1), so UPROAR covers the whole default view at every Size, and it follows
  automatically when the growth lane retunes `FRAMING` / `ringRadius`. It is not "screen-clearing" at
  every manual zoom: zoomed out to `CAMERA_ZOOM.max` = 2.0× the blast covers about the central half of
  the view (the sim never reads the view zoom, by design). Measured on 2026-09-24 with the growth
  workflow's in-flight config (`RANK_LEVELS` 1/7/16/27/35, `ringRadius` = `cameraDistance × CAM_K`;
  scratch script `ringRadius` over each rank's first and last level):

  | Size | first level: H → R | last level: H → R |
  |---|---|---|
  | I | 1.2 m → **28.5 m (23.8 H)** | 2.66 m → 15.3 m (5.8 H) |
  | II | 5.0 m → 67.9 m (13.6 H) | 9.9 m → 55.3 m (5.6 H) |
  | III | 14 m → 156.5 m (11.2 H) | 24.2 m → 127.9 m (5.3 H) |
  | IV | 32 m → 264.3 m (8.3 H) | 47.3 m → 236.4 m (5.0 H) |
  | V | 60 m → **271.4 m (4.5 H)** | 67.2 m → 283.7 m (4.2 H) |

  These numbers **will move** when the growth workflow lands (it is retuning the rank levels to
  5/12/22/32 and the framing). They are illustrative only; nothing below depends on them. `probe_ult`
  (L1) prints this table from the merged config on every run, and all v2 pacing claims are checked by
  GATE 2 after merge (§0.6), not derived from this table. Rev 1's table (Size I 13.3 m ≈ 11 H) was
  stale against the growth camera.
* UPROAR is a **combat** clear. It deals **no damage to buildings or props** (`noCity`). This is a
  deliberate pacing decision: a screen-wide demolition would dump a screen of floor XP at once (with
  R ≈ 24 H at the start of Size I, the whole visible block). The city is still shown shaking (fx dust
  ring, a 6 % camera punch, the shockwave drawn across the rooftops). Owner decision, §16 Q3.
* Kills made while an ultimate is in flight do **not** drop their own scrap. Their XP × `ULT.killXpMul`
  = 0.5 goes into the **UPROAR bank** (`ultBankKill`, L0 pre-wire in `killEnemy`), capped per fire at
  `ULT.xpCapLevelFrac` = **50 % of the XP the current level needs** (`xpToNext(level)`, latched at
  fire); banked XP past the cap is dropped. `stepUltimate` flushes the bank every tick as at most
  `ULT.bankPickupsPerTick` = 6 merged `scrap` pickups at the first banked kill positions. This bounds
  both the pacing (one fire ≤ half a level of XP, at any R) and the per-tick pickup spike (§15.4).
* Every hostile projectile inside R that is deleted at the end of the roar is asserted by `probe_ult`
  (count before/after, boss-owned ones untouched).

### 3.2 Charge sources (points; `chargeUltimate` reads this tick's events)
× `stat(w,'ultCharge')` for everything. City sources are also × `ULT_CITY_RANK_MUL[rank]`
= 1 / 0.7 / 0.4 / 0.22 / 0.12, and only count within `ULT.nearH` = 4 H of the titan, so a boss
crushing the city does not charge the titan.

| Source | Points |
|---|---|
| passive trickle while live and not locked out | 0.6 / s |
| `propDestroyed` | 0.4 |
| `floorBreak` | 0.9 |
| `buildingCollapse` | 2 × (tier + 1) |
| `enemyKilled` | android/squad 0.45 · drone 0.6 · buggy 1.6 · apc 3 · tank 4 · walker 6 · elite 20 |
| `titanHurt` (rage) | 30 × dmg / maxHp (10 % of max HP → +3) |
| `bossHit` | 150 × dmg / boss.maxHp (5 % of the boss → +7.5) |
| OVERLOAD SITE payout (§5) | +35 (via `addUproar`) |
| BACK PAY power-up (§6) | to 100 (raw) |
| cards: trigger action `ultCharge` | p.amount × stacks |

No charge while `ult.phase !== 'idle'` or `ult.lockT > 0`. **Acceptance (probe_ult):** with the
fire-on-ready bot, the median gap between `ultCharged` edges is in `ULT_GAP_BAND_S` = **30–65 s** in
every rank band. Tuning order if it misses: (1) `ULT_CITY_RANK_MUL`, (2) `trickle`, (3) kill points.

### 3.3 Per-titan ultimates (`data/ultimates.ts` + `meta/ultimate.ts`)
Damage numbers are **base** numbers → `titanDamage(w, base) × stat(w,'ultPower')`, one `rollCrit` per
pulse. Radii are fractions of R. Enemies are hit with `enemiesInShape` + `damageEnemy` (never
`damageArea`, so the boss and the city are never touched by that path). The boss is hit only through
`bossUltHit` (§3.4). Every titan kills ≥ 90 % of non-elite enemies inside 0.9 R at every Size with the
`damage` stat at 1. That is why every position inside R takes ≥ 190 base: a Size V STILT MORTAR has about
8 000 HP at 9 min, and 190 × 45 = 8 550.

| Titan | Ultimate | ROAR | BLAST (t after the roar) | Extras |
|---|---|---|---|---|
| **MOLO** (SMASH TANK) | **STREET SWALLOW**: the street caves into a sinkhole mouth and MOLO gulps the block's crowd | 0.55 s | 0.0–0.9 s PULL: `magnetAll(w, R)` once; every crushable enemy inside R is dragged toward the jaws at 0.4 R/s and takes 20 base/s (5 Hz ticks, kind `bite`). **0.9 s SNAP**: circle [0, 0.55] **200** + ring [0.55, 1.0] **190** (kind `bite`, knock 0.3 H/s outward) | on SNAP: heal 12 % maxHp + shield 10 % maxHp (`upgrades.shield`) |
| **VOLT-KITE** (CHAIN ASSASSIN) | **GRIDLOCK SURGE**: the static mane grounds into every streetlight at once | 0.4 s | 4 pulses at 0 / 0.25 / 0.5 / 0.75 s, each circle [0, 1.0] **50** (kind `arc`), stun 0.3 s. The view draws arcs to the 40 nearest; damage hits everything inside R | at blast start: 6 radial LIVE WIRES (hazard `wire`, owner titan, capsule from the titan out to min(0.6 R, 6 H), r 0.25 H × area, life wireDuration + 2 s, same `data` keys voltkite.ts writes, plus `ult: 1`). The oldest wires go first to respect the cap of 6. HOOK right after = a full-screen detonation combo. Detonations until `tally.ultWireUntilT` (the fire time + the wires' life) do not count toward the SIX-WAY SPLICE goal (§8.2) |
| **HEARTHBACK** (ERUPTION FORTRESS) | **CALDERA BLOWOUT**: the dome shell erupts in three rings | 0.6 s | ring [0, 0.45] **200** at 0 s · ring [0.4, 0.75] **190** at 0.3 s · ring [0.7, 1.0] **190** at 0.6 s (kind `vent`, knock 0.6 H/s). The bands overlap, so the seams take two rings | all rings × (1 + 0.6 × shell fill), fill = `kit.stored / kit.cap`; the SHELL is **not** emptied. 6 `magma` hazards (circle r 0.5 H, 5 s, 12 base dps) evenly on the 0.55 R circle |
| **BRIARWICK** (AREA CONTROL) | **GREENBELT DECREE**: a bramble wave rolls out and roots the block | 0.5 s | thorn wave expands 0 → R over 0.6 s; damage at 0.3 s: circle [0, 1.0] **190** (kind `vine`), root = `stun` 3 s, then `slowT` 3 s at `slowMul` 0.6 | **`stat(w,'turretCap')` bloom turrets** (4 at the base cap) evenly on the 0.4 R circle (the engine's `doBloom` data keys + `wild: 1`, life 14 s). They go through the normal cap: the decree **replants** the garden, replacing the oldest turrets, so none is culled the tick it appears (rev 1 spawned 6 against a base cap of 4). `wild` blooms do not count toward FULL BLOOM (§8.2). Heal 20 % maxHp over 4 s (`ult.heal` pool) |

`UltDef` (data file): `{id, name, burst, desc, roarS, blastS, pulses[]}`. The extras are code in
`meta/ultimate.ts`, switched on titan id. Events: `ultFire` at the roar start (x, z, r),
`ultPulse` per pulse (r0/r1 in metres, `n` = pulse index, `kind`), `ultEnd` with the kill count.

### 3.4 Boss interaction
* Every pulse whose outer radius reaches the boss body (`parts[0]` within R + part r) calls
  `bossUltHit(w, ULT.bossCapFrac / pulses, ULT.bossMeter / pulses)`. Over one ultimate the boss loses at
  most **6 % of max HP**, and its meter (STRAIN / FRACTURE / JAM) gains **+0.30**. The tactical use is
  meter first, then UPROAR, then a stagger.
* During the boss intro (`introT > 0`) the boss takes nothing (a wasted UPROAR is the player's call).
* A boss fight lasts about 70–170 s. At a 30–65 s charge cadence (boss hits charge fast) that is 2–4
  ultimates per fight: at most 24 % of the boss and 1.2 meters. `bossUltHit` is body-only and exact
  (§2.7): part `strainMul` never applies, so the meter gain per fire is exactly 0.30 on every boss.
  Risk named by the review: at the top of that range UPROAR shortens a fight noticeably, which pushes
  clears toward the 8-min floor of GATE 2. Guard: `probe_boss3` and `probe_ult` check that the median
  fight length stays in 70–170 s for all three bosses **with UPROAR in use**, and the combined GATE 2
  after C1 (§0.6) checks the clear-time band; the first knob is `ULT.bossCapFrac` (0.06 → 0.04).

### 3.5 Pacing (GATE 2)
UPROAR adds kill XP. Guards, in the order they bind: the **per-fire XP cap** (50 % of the current
level's need, independent of R, so the R table's size does not matter for pacing), the XP multiplier of
0.5, no city damage, and the 30–65 s cadence. At most about one level of XP per two fires, whatever the
Size. The time to FIRST readiness is a tuning target of 45–75 s; the §3.2 numbers are unmeasured
starting points, and `probe_ult` reports the measured value. Kills made by kit attacks during the blast
window also bank (documented simplification). `probe_sim` reports the share of all XP that came through
the bank (§0.6). If a rank band's floor is threatened, lower `ULT.xpCapLevelFrac` first, then
`ULT.killXpMul`. Rev 1's "no city damage ≈ 2 levels" argument used the stale R table; the cap replaces it.

### 3.6 Feedback
* **Ready**: `ultCharged` → the meter goes gold with a CSS shimmer (off under reduce flashing) and its
  label reads `UPROAR READY`; the titan's glow parts pulse (view); sfx `ultReady` (brass 2-note + titan
  chuff). No text is drawn over the titan.
* **Fire**: `ultFire` → app hit-stop `timeScale 0.3` for 0.18 s at blast start, with the input buffer
  widened like the rank-up hit-stop; `CameraRig.punch(0.06, 0.8)` (new method, §15.2 L6); shake by
  size; the titan's burst word (`GLORRP!` …) as a comic stamp **beside the UPROAR meter** (HUD, not over
  the titan); the titan animation `ultimate` clip
  (rear + roar, then the titan's blast pose; titan-view hook §15.2 L6); per-titan FX (§3.7); sfx per titan.
* **Size I**: R is many body heights (about 24 H at LV 1 today), so the ring fills the default view
  around a tiny titan. **Size V**: R is about 4.5 H (about 270 m today). The ring runs off every screen
  edge at zoom 1, the boss (at 60–130 m) is always inside, and the dust wall reads as a horizon-wide
  wave. Both are verified in shots (`ult_<titan>_s1`, `ult_<titan>_s5`, at zoom 1).

### 3.7 View (L6 `render/ultview.ts`)
Driven only by `ultFire` / `ultPulse` / `ultEnd` and `w.ult`. The budget is **≤ 12 draw calls** and
**≤ 0.3 ms of main-thread time per frame** (frameprof) while active, and nothing is allocated per frame.
* shared: an expanding ground ring (instanced flat annulus, toon + outline, ink `#1b1426`), a dust wall
  (instanced billboards, count × quality), and a screen-space radial speed-line overlay (one
  pre-built DOM element in `ui/abilitybar.ts`, animated by transform/opacity only, not WebGL);
* MOLO: sinkhole disc (dark, inverted-cone mesh sinking 0.3 H) plus debris streaks toward the mouth;
* VOLT-KITE: arcs drawn with the existing arc polyline renderer pattern (fx.ts style), 40 nearest per pulse;
* HEARTHBACK: three lava-orange rings (`#ff7a2e` / `#ffb13b`, 3–8× surface luminance, glare bar) and
  pumice chunks;
* BRIARWICK: a bramble ring (instanced thorn segments rising from the ground) and blossom confetti
  (`#ff9ec7`).

---

## §4 #3 Ability bar, icons, ACTIVE panel, UPROAR meter

### 4.1 HUD layout (all sizes in `--u` = max(8 px, min(1vw, 1.7778vh)): 12.8 px at 1280×720, 19.2 px at 1920×1080)

```
┌ WARD-7 bug (unchanged) ─────────────── boss nameplate (unchanged) ─────── counters (unchanged) ┐
│ toasts (under the bug)                                               OBJECTIVE TRACKER (new,    │
│                                                                      replaces the chips column) │
│                                                                                                 │
│                                                                      zoom hint (moved up)       │
│ ┌ status card ┐        [============ UPROAR  74%  [E] ============]    ┌ ACTIVE panel ┐         │
│ │ (hook dial  │        [▣][▣][▣][▣][▣][▣][▣][▣][▣][+7]                 │ glyph  NAME  │         │
│ │  removed)   │                  ability bar (10 slots)                │ [SPACE] ▓▓░ 6s│        │
└ ticker ─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Anchor | Size | 1280×720 | 1920×1080 |
|---|---|---|---|---|
| Status card (unchanged position) | left 1.6u, bottom 3.9u | 23u wide | x 20–315 px | x 31–472 px |
| **Ability bar** | centred, bottom 3.3u | 10 slots × 3.8u + 9 gaps × 0.3u = **40.7u** | slot 48.6 px, bar x 380–901 px, bottom 42 px | slot 73 px, bar x 569–1351 px, bottom 63 px |
| **UPROAR meter** | centred above the bar, bottom 7.55u | 40.7u × 1.1u | 521 × 14 px | 781 × 21 px |
| **ACTIVE panel** (hook) | right 1.6u, bottom 3.3u | 17u × 5.4u | x 1042–1260 px, 218 × 69 px | x 1563–1889 px, 326 × 104 px |
| Zoom hint (moved) | right 1.6u, bottom **9.2u** | unchanged | — | — |
| **Objective tracker** (replaces the chips column) | right 1.6u, top 6.4u | 15.5u wide, rows 2.2u, ≤ 6 rows | — | — |
| Toasts (L8 `Toasts`: goals, RESTRUCTURED, revive) | left 1.6u, top **12.4u**: directly **under** the broadcast `.bt-alert.toast` slot (top 5.4u), never in it | ≤ 26u wide, ≤ 2 stacked | — | — |

No overlaps: the status card's right edge is 24.6u, the bar spans 29.65–70.35u, and the ACTIVE panel
starts at 81.4u. At 4:3 the layout is width-limited and identical in `u`. The broadcast alert toast
(`overloadSite`, `recordsAnnex`, `rematch`, chest and low-HP alerts) keeps its own slot; the
v2 `Toasts` stack starts below its maximum box (L8 measures the tallest broadcast toast at 1280×720
and 1920×1080 and sets the offset in `u`; the `abilitybar_1280/1920` shots are taken with one broadcast
alert and one goal toast live, and the critic checks they do not touch). Everything uses
transform/opacity only per frame (the HUD rule); see §4.7 for the frame-time budget.

**The upgrade chips column is retired in play** (owner decision §16 Q2). The bar shows what is owned,
and the full list with names moves to a **LOADOUT** panel in the pause menu (L9). The status card's
foot keeps the dash pips. The hook dial moves to the ACTIVE panel.

### 4.2 Bar slot content (deterministic, from `w.upgrades`)
1. `L` = owned ids in pick order (`upgrades.order`), excluding `perk` cards.
2. If `|L| ≤ 10`: show all 10 slots in pick order.
3. Otherwise: score each card by `evo 1000 · legendary 500 · epic 300 · has a trigger 200 · rare 100 ·
   common 0 · + 50 if maxed · + 10 × stacks`, keep the top **9** (ties by pick order), show them in pick
   order, and put a **`+N`** slot 10 (N = hidden cards; glyph `plus`, and the pause LOADOUT has the list).
4. A slot animates in (0.25 s scale-pop) when a card is picked or evolved. An evolution replaces its
   base card in place with a gold burst.
5. Trigger cards flash their slot (0.12 s brightness pulse, rate-limited to 4 Hz per slot) on
   `upgradeProc` with their id. That is the bar's "it did something" feedback.

### 4.3 Icon system (`ui/icons.ts`): procedural SVG, no paid image generation
Each glyph is an inline SVG in a 24×24 viewBox: one or two closed paths, 2 px ink stroke `#1b1426`
(`vector-effect: non-scaling-stroke`), fill = family colour, with an optional cream second fill. The
glyph set (`GlyphId`, 58 ids, the union in the snippet), each shape a few simple primitives:

| Group | Glyph ids (shape) |
|---|---|
| survival | `heart` (heart) · `plate` (shield outline with 2 rivets) · `drip` (droplet with +) · `thorn` (3 thorns on an arc) · `fang` (fang + drop) · `brick` (2 bricks) · `halo` (ring over a dot, i-frames) · `bandage` (rounded bar with +) |
| mobility | `boot` (stomping foot) · `dash` (two chevrons) · `hourglass` |
| growth | `arrowUp` (thick up-arrow in a square) · `star` (4-point star) · `dice` (2 pips die) · `cycle` (circular arrow) · `magnet` (horseshoe) · `reach` (open claw with arc) |
| offense | `claw` (3 slashes) · `tempo` (double tick) · `reticle` (circle + cross) · `burst` (8-point starburst) · `bullseye` (crit) · `exclaim` (crit dmg) · `fist` · `links` (2 chain links) · `chunk` (3 rubble chunks) · `wreck` (wrecking ball on a line) |
| smash | `foot` (big footprint) · `ripple` (3 arcs) · `bolt` (zig-zag) |
| hook / ult | `hook` (hook) · `megaphone` (UPROAR) |
| kit | MOLO `jaw` (open jaw), `vortex` (spiral) · VOLT `fork` (forked bolt), `wire` (sagging wire between 2 posts) · HEARTH `dome` (dome with vent), `lava` (drip into pool) · BRIAR `turret` (bud on a stem), `spore` (dotted puff), `vine` (curling vine) |
| trigger-only | `flame` (frenzy) · `meteor` (rock + trail) · `snow` (6-arm flake) |
| meta | `plus` (the +N slot) · `lock` (padlock) · `banish` (X stamp) · `evo` (burst frame overlay) · `overload` (bolt in a square) · `annex` (folder with a seal) · `trafficLight` · `notice` (paper with a stamp) · `rush` (clock + speed lines) · `coin` (stacked coins) · `ribbon` (award rosette) · `swatch` (3 colour chips) · `key` (perk keycard) · **`till`** (pay-station box with a coin slot and a half-open drawer: the PARKADE-6 marker, §10.2) |

**`iconFor(u)`** (the first rule that matches):
1. `u.evo` → the base card's glyph, frame `evolution`.
2. `u` has trigger effects → the first trigger's action glyph: spark → `bolt`, shockwave → `ripple`,
   heal → `bandage`, shield → `plate`, mass → `arrowUp`, xp → `star`, magnet → `magnet`,
   rubbleShot → `chunk`, frenzy → `flame`, cdReduce → `hourglass`, dashRefund → `dash`,
   meteor → `meteor`, arc → `fork`, magma → `lava`, bloom → `turret`, slowField → `snow`,
   ultCharge → `megaphone`.
3. Otherwise the first stat effect's stat glyph: maxHp `heart`, armor `plate`, regen `drip`,
   iframes `halo`, thorns `thorn`, lifesteal `fang`, rubbleHeal `brick`, moveSpeed `boot`,
   dashCharges/dashCooldown/dashDistance `dash`, pickupRadius `reach`, massGain `arrowUp`,
   xpGain `star`, luck `dice`, rerolls `cycle`, damage `claw`, attackRate `tempo`,
   attackRange `reticle`, area `burst`, critChance `bullseye`, critMult `exclaim`, knockback `fist`,
   chains/chainRange `links`, projectiles `chunk`, buildingDamage `wreck`, smashDamage `foot`,
   smashRadius `ripple`, sparkChance `bolt`, abilityCooldown/abilityPower `hook`, biteCleave `jaw`,
   pulseEvery `ripple`, vacuumRadius `vortex`, arcForks `fork`, wireDuration/wireDamage `wire`,
   shellCapacity `dome`, stompDelay `foot`, magmaDuration `lava`, turretCap/turretRate `turret`,
   sporeHeal `spore`, vineLength `vine`, ultCharge/ultPower `megaphone`.

**Family colour** (by `u.tags[0]`): survival coral `#ff6f5e` · mobility teal `#4fb3b0` · growth
gold `#ffd166` · offense red `#e63946` · smash tan `#c9a47a` · kit/hook = the titan's canonical
`accent` · mutation violet `#a07ce8` · ult cream `#f4ecd8`. **`evolution`** has no colour of its own:
an evolution card uses its `tags[1]` (the base card's first tag, §7.3), so it keeps the base card's
family colour and is told apart by its frame. `probe_icons` asserts every `tags[0]` / `tags[1]` value
used by `UPGRADES` maps to a colour.

**Rarity frame** (never colour-only; shape and pattern too): common `#c9bfa6` plain 0.14u border ·
rare `#2f9fa8` double border · epic `#8a63d2` notched corners (clip-path) · legendary `#ffc53d` +
4 corner rivets · **evolution** gold→coral gradient border, an `EVO` corner flag, a slow CSS shimmer
(static under reduce flashing). The colours match `ui/dom.ts RARITY_COLORS`.

**Level badge** (bottom-right chip, Space Mono): stacks `L2`…`L5`; maxed **`MAX`** on a gold chip;
evolution `EVO`. No star glyph (the reference's "★n" badge, §0.7).
**`NEW`** ribbon (draft only) on cards that entered the pool through an unlock the player has not seen
yet (`Profile.newUnlocks`).

The draft dossier cards (L9) also show the glyph in their header, so a card looks the same in the draft
and on the bar. `probe_icons` (L8, node): every `UPGRADES` entry resolves to a glyph id that exists in
`GLYPHS`; every glyph renders to a non-empty path string.

### 4.4 ACTIVE panel (the hook)
Glyph box 4.2u with a **cooldown sweep built from two masked half-discs rotated by `transform`**
(no `conic-gradient` driven by a CSS variable: that repaints every frame and breaks the HUD's
transform/opacity-only rule); the progress is `titan.abilityCd` over a total inferred the way `hud.ts`
infers `hookMax` today (the largest cd seen since the last ready). The seconds text changes at most at
10 Hz. It also shows the
hook NAME (`TITANS[id].hook.name`, Anton 1.3u), key chip `SPACE` / `A`, a thin cooldown bar with
seconds (`6s`, mono), and `READY` in gold when 0. VOLT-KITE adds a wires-out counter `WIRES 3/6` (the
existing kit read). HEARTHBACK shows SHELL fill as a second thin bar (moved from the status card). The
panel pulses when the HOOK fires (`ability` event).

### 4.5 UPROAR meter
A horizontal gauge with 10 tick marks, label `UPROAR`, a percent, and a key chip `E` / `Y`. The fill is
a cream→gold gradient. At 100 % it shows the gold shimmer and the text `UPROAR READY`. During the
6-s lockout it shows a hatched grey fill with `COOLING`. On `ultFire` the meter drains to 0 over the
roar. At Size I the first charge-up of a profile's first run gets a one-time hint toast:
`UPROAR READY — PRESS E` (`Y` on pad).

### 4.6 Objective tracker (top-right)
Up to 6 rows of 2.2u: one per live objective (glyph · name · distance `2.4 BLK` · a life bar), one per
active power-up timer (`RED LIGHT 4.1s`), and one row for the most-advanced **run-scope goal**
(`GOAL · CROWD CONTROL 412 / 1000`, only while ≥ 25 % complete). Rows enter and exit with 0.2 s slides.
Row DOM nodes are pooled (6 created at mount); text changes at most at 4 Hz per row.

### 4.7 Frame-time budget (HUD + DOM)
The latest `_harness/_reports/perfcheck.json` has p99 21.8 ms against the 22 ms budget and 252 of 450
draw calls, so **frame time, not draw calls, binds**. Every v2 lane therefore has a main-thread budget,
measured with the existing `render/frameprof.ts` marks in perfcheck scenario (a):

| Lane | Budget (median added per frame) | Rules |
|---|---|---|
| L6 views (ult, objective, power-up, marker projection) | ≤ 0.3 ms total | instanced; no per-frame allocation; marker projection ≤ 12 items |
| L7 PARKADE rig | ≤ 0.3 ms | as the existing boss rigs |
| L8 HUD DOM (bar, meter, ACTIVE, tracker, markers, toasts) | ≤ 0.2 ms | pooled nodes; transform/opacity only; text writes ≤ 10 Hz; no layout reads in `update` |
| full-screen CSS layers (UPROAR speed lines, RED LIGHT tint, frost, rain) | at most 2 live at once | opacity/transform only, no `backdrop-filter`, no blur; pre-created at mount |

The budgets add up to about 0.8 ms of medians against 0.2 ms of p99 headroom today. Medians and p99
do not add linearly, but the risk is real, so: **L0 re-runs perfcheck after the growth merge and records
the v2 baseline** (p99 and per-mark medians) in its report; the orchestrator's perfcheck after C2 and C3
compares against it. If the combined p99 passes 22 ms, the first recourse is the views' quality tiers
(dust-wall count × quality, marker labels off-screen-only on `low`), never a raised budget.

The UPROAR one-tick spike is bounded in the sim: kills during the ultimate bank their scrap
(≤ `ULT.bankPickupsPerTick` = 6 merged pickups per tick instead of 1–4 per kill, §3.1), and DEMOLITION
banks the same way. Perfcheck reports the p99 over the UPROAR window separately (§15.4).

---

## §5 #4 Map objectives

### 5.1 Types
| Kind | Name | What it is | Completes when | Payout |
|---|---|---|---|---|
| `overloadSite` | **OVERLOAD SITE** | **Size I**: a tagged **static prop** (`target 'prop'`), a parked tier-1 prop when one is in band (GRID-EAST bus / truck, WHITE STACKS container / truck, LOCKWATER container / truck), otherwise a tier-0 static prop of the biome's `overloadPropsS1` list, dressed by the view as a utility unit. **Size II+**: a tagged **building** (`target 'building'`): GRID-EAST "rooftop transformer", WHITE STACKS "pump house", LOCKWATER "tide relay" | its `propDestroyed` / `buildingCollapse` (id match), read **after `processTriggers`** so proc kills count (§2.3) | **+35 UPROAR** (× ultCharge) · XP = `xpFrac` (0.20) × `xpToNext(level)`, paid as one `scrap` pickup on the titan (collected next tick, §2.3) · one **guaranteed power-up** at the site (weighted roll excluding BACK PAY) |
| `reliefDepot` | **RELIEF DEPOT** | a free-standing stack of municipal supply crates (teal bandage emblem), sized max(1.5 m, 0.35 H at placement) | titan circle overlaps its circle (walking or dashing) | **3 `heal` pickups** (existing kind, 10 % maxHp each) burst around it; at ≥ 95 % HP instead **+8 UPROAR** |
| `recordsAnnex` | **RECORDS ANNEX** | a real building tagged for the run; HALVARD posts a guard | its `buildingCollapse` (id match, after `processTriggers`) | a **`chest` pickup** (existing flow → rare+ chest draft; a ready evolution takes slot 0, §7) |

A bound building found `collapsed` (or a bound prop found `!alive`) with **no** matching event this tick
(for example crushed under the boss, whose city events carry `noCredit`) **expires** the objective: it
never sticks, and the boss never pays the titan.

### 5.2 Placement (in citygen terms; `rng.meta`; `meta/objectives.ts`)
**Why Size I is prop-based (rev 2).** Measured with `createWorld` on seed 1337, every biome generates
**zero tier-0 buildings** (tier 0/1/2/3/4 counts: GRID-EAST 0/510/222/110/19, WHITE STACKS
0/259/191/148/7, LOCKWATER 0/239/321/140/18), and Size I has `canFlatten` 0, so rev 1's building rule
could place nothing before the first MASS BREACH. Static props are plentiful (seed 1337: GRID-EAST 58
parked buses and 46 trucks at tier 1, plus hundreds of tier-0 lamps, vending machines and kiosks;
WHITE STACKS 216 containers; LOCKWATER 631 containers). Tier-1 props are "chewable before Size II"
(`Prop.tier` doc in `types.ts`), so a Size I site takes a few hits, not a single step.

* **Size I (prop)**: live static props (`lane === -1`) of the biome's `overloadPropsS1` kinds in the
  band `[0.8, 1.8] × spawnRing`, tier 1 preferred (score × 2), not within 0.5 × `CITY.pitch` of another
  live objective.
* **Size II+ (building)** for OVERLOAD / ANNEX: `!collapsed`, `alive ≥ 1`, `tier === RANKS[rank].canFlatten`
  (falls back to `canFlatten − 1`, never above; Size II's `canFlatten` 1 matches hundreds of tier-1
  buildings in every biome), footprint centre in `[bandMin, bandMax] × spawnRing(w)` (OVERLOAD 0.8–1.8,
  ANNEX 1.0–2.2), not in a block that already holds a live objective.
* Score for both: × 1.5 if ahead of the titan (dot of its heading with the direction > 0), × 1.3 for a
  **corner parcel** (centre within 0.3 × `CITY.pitch` of the block corner nearest an intersection;
  buildings only). Pick among the best `OBJECTIVES.topN` = 12 by weighted `rng.meta`. No candidate →
  retry in 3 s.

RELIEF DEPOT anchor: a live prop whose kind is in `OBJECTIVE_BIOME[b].reliefProps` (GRID-EAST kiosk /
vending / bench; WHITE STACKS drum / container / barrier; LOCKWATER container / drum / forklift),
within 0.5–1.4 × spawnRing. The crate sits on the prop's position; the prop is untouched, and the crate
is an objective entity, not a Prop. Contact radius r = 0.6 × crate size.

Expiry: `life` runs out, the titan gets farther than `OBJECTIVES.strandMul` = 2.8 × spawnRing (left
behind), or the state sweep above → `objectiveExpire`; the scheduler re-places after the respawn delay.
A MASS BREACH re-validates live objectives: a prop-bound OVERLOAD SITE is expired at the breach into
Size II (the next one is a building), and a building-bound one whose tier is now 2+ below `canFlatten`
is expired and re-placed at the new tier.

### 5.3 Counts and schedule per biome
| | GRID-EAST | WHITE STACKS | LOCKWATER |
|---|---|---|---|
| OVERLOAD SITE: first / respawn / life / max active | 25 s / 35 s / 75 s / 1 | 25 s / **30 s** / 75 s / 1 | 25 s / **40 s** / 75 s / 1 |
| RELIEF DEPOT: first / respawn / max active (Size I–II / III+) | 40 s / 40 s / 1 / 2 | same | same |
| RELIEF DEPOT placement rule | only while HP < 85 %, or when none has been placed in the last 90 s | same | same |
| RECORDS ANNEX | one per MASS BREACH (Size II, III, IV, V), 20 s after the breach, life 120 s = **4 per run** | same | same |
| ANNEX guard (via `spawnEnemy`, `rng.spawn` untouched: positions from `rng.meta`) | Size II: one PICKET SQUAD; III+: one BULWARK | same | same |

**Per-run counts are not claimed** (rev 1's "7–10 per run" assumed placements that could not happen at
Size I). `probe_map` measures, per biome, the median OVERLOAD SITE / RELIEF / ANNEX counts over 5 seeds
with the gate bot and **asserts an OVERLOAD median of 5–12 per run and ANNEX = the number of breaches
reached**; the measured numbers go into the comment table at the top of `meta/objectives.ts`. The
per-biome respawn differences (WHITE STACKS denser, LOCKWATER sparser) stay.

Perk **ADVANCE TIP-LINE** (§8.5): +1 OVERLOAD SITE active; markers get 2× the edge-arrow range.

### 5.4 Markers (visible at every zoom)
* **World (L6 `objectiveview.ts`)**: a vertical light column (height 4 H at placement, width 0.12 H,
  kind colour: OVERLOAD gold `#ffd166`, RELIEF teal `#4fb3b0`, ANNEX coral `#ff6f5e`; emissive within the
  glare bar, no bloom). It has a pulsing ground ring around the footprint (dashed band pattern, so it
  is not colour-only) and an icon billboard at the column top (`sizeAttenuation: false`, 34 px at 720p,
  51 px at 1080p). A building OVERLOAD SITE gets crackling roof arcs; a Size I prop site gets a small
  cable spool, a hazard placard and sparks on the prop; the RELIEF DEPOT is a real multi-part crate mesh
  (3 crates + straps + the emblem decal); the ANNEX gets a rooftop filing-cabinet prop with a wax seal.
  At most 4 draw calls per kind (instanced).
* **Screen (L6 `markerview.ts` → L8 `ui/markers.ts`)**: an on-screen label chip under the billboard
  (`OVERLOAD SITE`, `2.4 BLK`), and when off-screen an **edge arrow** clamped to a 3u inset of the screen
  edge, pointing at it, showing the glyph and the distance in blocks. Edge arrows appear for objectives
  within 3 × spawnRing (6× with the tip-line perk) and for power-ups within 1.5 × spawnRing. At most 12
  markers; DOM nodes pooled; positioned by `transform` only.
* **Events → feedback**: `objectiveSpawn` → a HUD tracker row slides in; the first OVERLOAD SITE of a
  run also raises `alert overloadSite`, and every ANNEX raises `alert recordsAnnex`; sfx "municipal
  chime". `objectiveDone` → a gold stamp burst on the marker (`LOAD SHED`, `CRATES OPEN`, `FILES
  SEIZED`), sfx; UPROAR +35 on the meter.

### 5.5 Pacing
Per OVERLOAD SITE: 20 % of the current level's XP need. With the asserted count (5–12 per run) that is
about 1–2.5 levels per run, plus 4 chest drafts from the ANNEXes; the actual share of XP is printed by
`probe_sim` (§0.6: `w.map.overloadXp` over all XP). If a rank band's floor is threatened, lower
`OBJECTIVES.overload.xpFrac` first, then the OVERLOAD respawn. The bot (`_harness/bot_map.ts`) detours
to an OVERLOAD SITE within 1.5 × spawnRing when no threat is painted, to a RELIEF DEPOT when HP < 60 %,
and ignores the ANNEX unless it is on its path. GATE 2 is therefore measured with the systems in use.
`probe_map` includes a case where the tagged building is collapsed by a **trigger shockwave** (a card
proc, not a titan attack) and asserts `objectiveDone` that tick, and a case where a trigger kill drops
a power-up.

---

## §6 #8 Map power-ups

### 6.1 Kinds and effects (`meta/powerups.ts`, collect distance = titan.radius + max(1 m, 0.6 H))
| Kind | Name | Effect |
|---|---|---|
| `cleanup` | **CLEANUP CREW** | `magnetAll(w, Infinity)`: every pickup on the map homes in |
| `demolition` | **DEMOLITION NOTICE** | every **non-elite** enemy within 1.0 × spawnRing dies (`killEnemy`, normal XP); elites take 25 % of max HP; every hostile non-boss projectile within the ring is deleted; boss: `bossUltHit(w, 0.02, 0.1)` |
| `redLight` | **RED LIGHT** | for 6 s (4.5 s while a boss is alive): enemies freeze (AI and movement skipped, pre-wired §2.7), enemy projectiles hang in the air, enemy-owned paint stops counting down, and the director holds its waves. **Bosses ignore it** ("the rig runs its own signals"). The titan is unaffected |
| `rushHour` | **RUSH HOUR** | 10 s: pushes frenzy buffs into `w.upgrades.buffs`: attackRate × 1.5, moveSpeed × 1.2, smashDamage × 2 |
| `backPay` | **BACK PAY** | `addUproar(w, 100, true)`: UPROAR to full |

### 6.2 Drop rules (`rng.meta`)
* From this tick's `enemyKilled`: chance by kind: android/squad 0.002 · drone 0.004 · buggy 0.012 ·
  apc 0.03 · tank 0.035 · walker 0.05 · **elite 1.0**. From `buildingCollapse` of tier ≥ 2: 0.006.
  While a boss is alive, chances × 0.5.
* Random drops keep ≥ `minGapS` = 18 s apart (the elite, OVERLOAD SITE and endless-rematch drops ignore
  the gap). At most `maxAlive` = 3 on the ground. Life 30 s; blinking in the last 5 s.
* Kind weights: CLEANUP 30 · DEMOLITION 18 · RED LIGHT 16 · RUSH HOUR 22 · BACK PAY 14
  (DEMOLITION × 0.5 at Size I). **Expected 5–10 per run.** `probe_map` asserts a median of 4–12.

### 6.3 Look and feedback (L6 `powerupview.ts`)
A floating **civic token**: a hexagonal enamel plate edged in cream, 0.5 H across at spawn height, glyph
embossed on both faces, bobbing and spinning, with a ground ring. Colours: CLEANUP teal, DEMOLITION
coral, RED LIGHT red + amber + green lamps, RUSH HOUR gold, BACK PAY cream/gold. Instanced, at most
5 draw calls. On pickup: a token pop, the kind's glyph and name as a HUD burst (`RED LIGHT!`), and a
tracker row with the timer. RED LIGHT also lays a subtle red-amber screen tint (CSS, off under reduce
flashing) and a ticking sfx. RUSH HOUR adds speed lines on the titan and a siren-swell sfx.

---

## §7 #8 Evolutions, banish, lock, new cards (lane L2)

### 7.1 Data plumbing
New cards live in `data/upgrades_v2.ts` as `UPGRADES_V2_RAW` with `desc: ''`. L0 pre-applies, at the
end of `data/upgrades.ts`:
```ts
import { UPGRADES_V2_RAW } from './upgrades_v2.ts';
for (const u of UPGRADES_V2_RAW) { const d = { ...u, desc: describe(u.effects, u.maxStacks) }; UPGRADES.push(d); UPGRADE_BY_ID[d.id] = d; }
```
Because `upgrades_v2.ts` never imports from `upgrades.ts`, there is no import cycle. Every card uses
the existing effect DSL (stats + triggers); the only new action is `ultCharge`.

`isEligible(w, u)` v2 adds, before the existing checks:
```ts
if (u.evo || u.perk) return false;                                   // evolutions are offered, never rolled
if (u.locked && !w.meta.unlocked.includes(u.id)) return false;
if (w.upgrades.banished.includes(u.id)) return false;
const evo = EVO_OF_BASE[u.id];                                       // rev 2: a base whose evolution is owned
if (evo && (w.upgrades.owned[evo] ?? 0) > 0) return false;           // never comes back (owned[base] was deleted)
```
Without the last line, taking an evolution (which deletes `owned[base]`) would make the base offerable
again (`0 < maxStacks`), and re-maxing it would make the evolution "ready" a second time.

### 7.2 New base-pool cards (2, not locked)
| id | Name | Rarity / max | Effects |
|---|---|---|---|
| `airtime_ledger` | Airtime Ledger | rare / 3 | ultCharge mul +0.12 |
| `press_conference` | Press Conference | rare / 3 | ultPower mul +0.15 |
(These two make "every StatKey is touched by ≥ 1 upgrade" hold for the fresh pool.)

### 7.3 Evolutions (15; offered, never rolled)
Rule: the evolution is **ready** when `owned[evo] === 0` (rev 2: never twice), `owned[base] ===
UPGRADE_BY_ID[base].maxStacks`, `owned[with] ≥ 1`, it is not banished, and (if `locked`) it is in
`w.meta.unlocked`. `probe_evolutions` asserts both re-take cases: after evolving, the base is never
offered again, and `evolutionsReady` never returns an owned evolution. Every evolution is rarity
`legendary`, `maxStacks 1`, tags `['evolution', <base's first tag>]`, `titan` = the base's titan.
**Taking it removes the base card** (`delete owned[base]`; the evo id replaces the base id in `order`);
the companion card stays. Every stat the base touched must be ≥ its maxed-base value after evolving
(`probe_evolutions`).

| # | id | Name | Base (max) + companion | Effects (single stack) | Pool |
|---|---|---|---|---|---|
| 1 | `evo_shear_wall_certificate` | Shear Wall Certificate | load_bearing_gut (5) + rebar_ribcage | maxHp mul +0.8 · armor +24 · on hurt (icd 10) shield 0.12 | base |
| 2 | `evo_teardown_mandate` | Teardown Mandate | condemnation_notice (5) + eminent_domain | buildingDamage mul +0.9 · on collapse (icd 0.3) shockwave r 2.2 dmg 30 | base |
| 3 | `evo_citywide_blackout` | Citywide Blackout | brownout (3) + substation_hum | on hit 20 % (icd 0.3) spark dmg 20 chains 4 · every 2 s arc count 4 dmg 18 | **locked** (G05) |
| 4 | `evo_arterial_bypass` | Arterial Bypass | express_lane (5) + jaywalkers_rhythm | moveSpeed mul +0.45 · on dash (icd 3) frenzy moveSpeed +0.3 5 s · on dash (icd 1) shockwave r 1.2 dmg 14 | base |
| 5 | `evo_bulldozer_clause` | Bulldozer Clause | wrecking_permit (5) + wide_load | smashDamage mul +1.1 · smashRadius mul +0.3 · on smash 8 % (icd 0.4) shockwave r 0.8 dmg 10 | base |
| 6 | `evo_audit_season` | Audit Season | code_violation (5) + double_citation | critChance +0.28 · critMult +0.9 · on crit 30 % (icd 0.8) rubbleShot count 3 dmg 10 | **locked** (G12) |
| 7 | `evo_all_you_can_eat_zoning` | All-You-Can-Eat Zoning | doggy_bag (5) + downspout_suction | pickupRadius mul +1.3 · every 6 s magnet r 14 | base |
| 8 | `evo_full_block_bite` | Full-Block Bite | molo_hinge_variance (4) + molo_curb_appetite | biteCleave +5 · damage mul +0.15 · attackRange mul +0.2 | MOLO, base |
| 9 | `evo_municipal_stomach` | Municipal Stomach | molo_storm_drain_throat (4) + molo_greasy_spoon | vacuumRadius mul +1.0 · abilityPower mul +0.3 · on hook heal 0.1 max HP · on hook shockwave r 2.5 dmg 30 | MOLO, **locked** (M3) |
| 10 | `evo_load_dispatcher` | Load Dispatcher | vk_extra_outlet (4) + vk_power_strip_splitter | arcForks +6 · chains +1 · chainRange mul +0.3 | VOLT, base |
| 11 | `evo_third_rail` | Third Rail | vk_high_voltage_easement (5) + vk_live_wire_permit | wireDamage mul +1.3 · wireDuration +3 · on dash (icd 0.6) arc count 3 dmg 12 | VOLT, **locked** (V3) |
| 12 | `evo_supervolcano_permit` | Supervolcano Permit | hb_thick_crust (5) + hb_stockpot_dome | shellCapacity mul +1.3 · abilityPower mul +0.25 · on hook magma r 2 dps 16 dur 5 | HEARTH, **locked** (H3) |
| 13 | `evo_molten_core_sample` | Molten Core Sample | hb_open_burn_permit (4) + hb_hot_asphalt | magmaDuration +8 · area mul +0.2 · stompDelay −0.15 | HEARTH, base |
| 14 | `evo_urban_forest_act` | Urban Forest Act | bw_fertilizer_runoff (5) + bw_extra_allotment | turretRate mul +1.0 · turretCap +3 | BRIAR, **locked** (B3) |
| 15 | `evo_kudzu_clause` | Kudzu Clause | bw_hedge_easement (5) + bw_bramble_whip | vineLength mul +0.9 · damage mul +0.12 · on hit 6 % (icd 1) slowField r 1.5 dur 2 | BRIAR, base |

Stat clamps (`stats.ts LIMITS`) still apply: moveSpeed ≤ 3, biteCleave ≤ 6, arcForks ≤ 16,
turretCap ≤ 16, vineLength ≤ 4, shellCapacity ≤ 6.

### 7.4 How evolutions are offered (`rollOffer` v2)
**Slots are 0-based everywhere** (the offer array index; the UI labels them 1/2/3).
1. If an offer is open → return it (unchanged).
2. Build the base offer exactly as today (same `rng.loot` draws).
3. **Lock**: if `U.locked` is still eligible, it goes into **slot 0** (the rolled card that sat there
   goes back); `U.locked = null`. Slot 0 shows `HELD FROM LAST REPORT`. **Dedupe**: if the held card was
   also rolled into slot 1 or 2, that duplicate slot is re-rolled once with the same draft kind,
   excluding every id already in the offer (a refill that finds nothing leaves the offer one card
   shorter). A held card that is no longer eligible (maxed through a chest pick, banished) is dropped
   silently and its charge is not refunded.
4. **Evolution**, only if `evolutionsReady(w)` is non-empty:
   * **chest draft** → the first ready evolution (catalogue order) goes into **slot 0**, or **slot 1**
     when a held card occupies slot 0. No extra draw.
   * **level-up draft** → **one extra `rng.loot` draw**: `< DRAFT_V2.evoDraftChance` (0.2) → the first
     ready evolution replaces **slot 2**.
   No evolution ready → no extra draw, so the stream is identical to pre-v2.
5. **Reroll while a card is held** (`rerollOffer`): the held card keeps its slot and only the other
   slots are re-rolled (excluding the held id). `rerollOffer` increments `tally.rerolls` (L2; the app
   never touches the tally).
6. Sources of chest drafts per run: RAMROD elites (1–3), RECORDS ANNEX (4), EXTENDED COVERAGE rematch
   chests. A ready evolution therefore reaches the player within about 1–2 minutes.

### 7.5 Banish and lock (sim: `upgrades/draft.ts`; UI: `ui/draft.ts`)
* **Charges per run**: BANISH `DRAFT_V2.banishes` = 2, LOCK `DRAFT_V2.locks` = 2 (the RED TAPE perk
  adds +1 each). They are shown in the draft header: `REROLL 1 · BANISH 2 · LOCK 2`.
* **BANISH** (`X` / **hold** pad **Y** 0.5 s, or the ✕ corner button on the focused card; bindings and
  mash guards in §2.4): `banishCard(w, id)` needs an open offer containing `id` and `banishLeft > 0`.
  It pushes `id` to `U.banished` (out of the pool for the rest of the run), refills **that slot in
  place** with one fresh roll of the same draft kind that avoids the other cards in the offer
  (`rng.loot`), decrements `banishLeft`, increments `tally.banishes`, and returns the new offer. **Empty
  refill** (the pool has nothing else): the slot is removed and the offer is one card shorter; banishing
  the last card of a 1-card offer is refused (`null`). The card does a rubber-stamp `BANISHED`
  out-animation (0.35 s) and the replacement deals in. Banishing an evolution skips it for this run.
  Banishing the held card clears the hold and refunds its lock charge.
* **LOCK** (`C` / pad **LB**, or the ▣ corner button): `lockCard(w, id)` toggles. Setting a lock needs
  `lockLeft > 0` and spends a charge. Unlocking within the same draft refunds it. Only one card can be
  held; locking another moves the hold and refunds nothing. Picking the held card clears the hold
  without spending more. The held card shows a padlock badge `HELD`; next draft it arrives in slot 0
  (§7.4). `tally.locks++` when a lock is set.
* `DraftScreen.open(w, offer, ctx: DraftCtx)` now resolves `{pick} | {reroll: true} | {banish: string} |
  {lock: string}` (`DraftScreenApi`); the app loop (pre-wired by L0) calls `banishCard` / `lockCard` and
  re-opens with the new offer and a fresh `DraftCtx` without consuming the draft.
* **NEW ribbon bookkeeping**: when the app opens a draft it computes `ctx.newIds = offer ∩
  profile.newUnlocks`, then immediately calls `markSeen(profile, ctx.newIds)` and `saveProfile` (L0
  pre-wire in `game.ts`, try/catch like every profile write). The ribbon therefore shows once per card.
* **Evolution card** in the draft: rarity stamp `RESTRUCTURED`, gold→coral frame, and a header line
  `EVOLVES <BASE NAME>` with base glyph → evo glyph. The foot reads `REPLACES <BASE NAME> · KEEPS <WITH NAME>`.
* Controls hint row: `1/2/3 PICK · R REROLL · X BANISH · C LOCK` (pad: `A PICK · X REROLL · HOLD Y BANISH ·
  LB LOCK`).

### 7.6 Unlockable cards (enter the pool when their goal is met, §8)
`locked: true`, generic unless a titan is named. The unlocking goal is in §8.2.
| id | Name | Rarity / max | Effects |
|---|---|---|---|
| `u_block_captain` | Block Captain | common / 4 | damage mul +0.06 · area mul +0.04 |
| `u_sidewalk_sale` | Sidewalk Sale | common / 5 | pickupRadius mul +0.12 · xpGain mul +0.03 |
| `u_ribbon_cutting` | Ribbon Cutting | epic / 1 | maxHp mul +0.08 · on level-up shockwave r 2.5 dmg 30 |
| `u_rolling_closure` | Rolling Closure | rare / 3 | on kill 10 % (icd 2) slowField r 1.5 dur 3 |
| `u_psa` | Public Service Announcement | epic / 2 | on hook 25 % (icd 4) ultCharge amount 8 |
| `u_bulk_trash_day` | Bulk Trash Day | common / 4 | buildingDamage mul +0.08 · on floor break 6 % (icd 0.4) rubbleShot count 1 dmg 6 |
| `u_utility_bill` | Utility Bill | epic / 2 | every 5 s shockwave r 1.4 dmg 16 |
| `u_night_market` | Night Market | rare / 3 | on pickup 3 % (icd 0.5) ultCharge amount 3 |
| `u_parking_validation` | Parking Validation | common / 4 | dashCooldown mul −0.06 · on dash 20 % (icd 3) heal 0.01 max HP |
| `u_after_hours_permit` | After-Hours Permit | rare / 3 | on hook (icd 6) frenzy attackRate +0.2 for 4 s |
| `u_citizen_hotline` | Citizen Hotline | rare / 3 | on hurt 30 % (icd 3) arc count 3 dmg 10 |
| `u_rent_control` | Rent Control | rare / 3 | armor +5 · thorns +0.2 |
| `u_eviction_notice` | Eviction Notice | epic / 2 | on crush 25 % (icd 0.5) shockwave r 1 dmg 12 |
| `u_street_festival` | Street Festival | rare / 3 | on collapse 30 % (icd 3) magnet r 6 |
| `u_landmark_status` | Landmark Status | legendary / 1 (mutation) | maxHp mul +0.35 · armor +15 · moveSpeed mul −0.1 |
| `u_detour_signage` | Detour Signage | common / 4 | knockback mul +0.15 · moveSpeed mul +0.03 |
| `molo_u_manhole_lid` | Manhole Lid | rare / 3, MOLO | armor +5 · on hook slowField r 3 dur 3 |
| `molo_u_open_mouth_policy` | Open-Mouth Policy | epic / 2, MOLO | vacuumRadius mul +0.2 · on hook xp amount 2 |
| `vk_u_lineman_gloves` | Lineman's Gloves | rare / 3, VOLT | armor +5 · wireDamage mul +0.1 |
| `vk_u_load_shedding_waltz` | Load-Shedding Waltz | rare / 3, VOLT | on dash (icd 1) shockwave r 0.8 dmg 10 |
| `hb_u_geothermal_lease` | Geothermal Lease | rare / 3, HEARTH | regen +0.5 · shellCapacity mul +0.1 |
| `hb_u_ash_cloud_advisory` | Ash Cloud Advisory | epic / 2, HEARTH | on hook slowField r 3 dur 4 dps 8 |
| `bw_u_seed_catalogue` | Seed Catalogue | rare / 3, BRIAR | sporeHeal mul +0.2 · regen +0.3 |
| `bw_u_arbor_day` | Arbor Day | rare / 3, BRIAR | on collapse 40 % (icd 2) bloom dur 16 |

Perk cards (hidden, `perk: true`, never offered or shown on the bar): `perk_card_petty_cash`
(rerolls +1), `perk_card_safety_inspection` (armor +8).

---

## §8 #5 + #8 Goals, achievements, unlocks, perks, palettes

### 8.1 Model
* **Titans stay unlocked** (original spec). Unlocks are: **24 cards** (§7.6), **6 locked evolutions**
  (§7.3), **6 starting perks** (§8.5), **8 titan palettes** (§8.6): 44 unlock items over **40 goals**.
  Every unlock item is referenced by exactly one goal (`probe_meta`).
* A goal is **run-scope** (met inside one run, from the live `RunTally`) or **life-scope** (lifetime
  profile counters, updated at run end). Run-scope goals can be met mid-run: the app evaluates
  `evalGoals` at 1 Hz in play and at run end. A newly met goal saves the profile **immediately**
  (try/catch) and pushes a **toast**; its unlocks take effect **next run**.
* `RunTally` (sim, `meta/tally.ts`, deterministic, event-derived) is the only run input to goals.
  Kit goals are derived from events (`ability`, `pickup`, `enemyKilled`, `wireDetonate` with
  `pts.length / 4` wires, `vent` with `power` = fill, titan-owned `bloom` hazards counted in
  `w.hazards`), never from kit-private state. `HOOK_WINDOW_S` = 1.4 s after an `ability` event.

### 8.2 Goals (40)
`metric` / `target` / `scope` are the `GoalDef` fields. "City" goals carry `biome` (and `boss`). Titan
goals carry `titan`.

**General (15)**
| id | Name | Condition (metric · target · scope) | Unlocks |
|---|---|---|---|
| g_first_broadcast | FIRST BROADCAST | finish any run (runsFinished · 1 · life) | card Block Captain |
| g_zoning_change | ZONING CHANGE | reach SIZE III (peakRank · 2 · run) | card Sidewalk Sale |
| g_skyline_adjusted | SKYLINE ADJUSTED | reach SIZE V (peakRank · 4 · run) | perk PETTY CASH |
| g_city_got_smaller | THE CITY GOT SMALLER | clear any city (clears · 1 · life) | card Ribbon Cutting |
| g_full_programming | FULL PROGRAMMING | clear all three cities, any titans (biomesCleared · 3 · life) | evolution Citywide Blackout |
| g_crowd_control | CROWD CONTROL | 1 000 kills in one run (kills · 1000 · run) | card Rolling Closure |
| g_one_take | ONE TAKE | clear a city without dropping below 25 % HP (cleanClear · 1 · run) | perk STAY OF DEMOLITION |
| g_live_coverage | LIVE COVERAGE | fire UPROAR 10 times in one run (ults · 10 · run) | card Public Service Announcement |
| g_paperwork | PAPERWORK | banish 5 cards (banishesLife · 5 · life) | perk RED TAPE |
| g_urban_renewal | URBAN RENEWAL | level 25 blocks in one run (blocks · 25 · run) | card Bulk Trash Day |
| g_still_on_air | STILL ON AIR | survive 5:00 of extended coverage (endlessS · 300 · run) | card Utility Bill |
| g_double_feature | DOUBLE FEATURE | defeat 2 containment bosses in one run (bossesInRun · 2 · run) | evolution Audit Season |
| g_change_order | CHANGE ORDER | take an evolution (evolutionsLife · 1 · life) | perk ADVANCE TIP-LINE |
| g_signal_boost | SIGNAL BOOST | collect 8 power-ups in one run (powerups · 8 · run) | card Night Market |
| g_running_errands | RUNNING ERRANDS | complete 10 objectives in one run (objectives · 10 · run) | perk WARM MIC |

**Titan (16)**
| id | Name | Condition | Unlocks |
|---|---|---|---|
| g_molo_curbside_pickup | CURBSIDE PICKUP | MOLO: 60 pickups from one GULLET VACUUM (vacuumBest · 60 · run) | MOLO palette TIDEPOOL |
| g_molo_speed_bump | SPEED BUMP | MOLO: crush 300 foes in one run (crushed · 300 · run) | card Manhole Lid |
| g_molo_bite_sized | BITE-SIZED CITY | clear any city with MOLO (titanClears · 1 · life) | evolution Municipal Stomach |
| g_molo_three_course | THREE-COURSE MEAL | clear all three cities with MOLO (titanBiomesCleared · 3 · life) | MOLO palette RUST BELT + card Open-Mouth Policy |
| g_vk_six_way_splice | SIX-WAY SPLICE | VOLT-KITE: detonate 6 LIVE WIRES at once, not counting GRIDLOCK SURGE wires (wiresBest · 6 · run) | VOLT-KITE palette SODIUM LAMP |
| g_vk_power_outage | POWER OUTAGE | VOLT-KITE: 25 kills from one HOOK (hookKillsBest · 25 · run) | card Lineman's Gloves |
| g_vk_grid_down | GRID DOWN | clear any city with VOLT-KITE (titanClears · 1 · life) | evolution Third Rail |
| g_vk_coast_to_coast | COAST-TO-COAST OUTAGE | clear all three with VOLT-KITE (titanBiomesCleared · 3 · life) | palette SLEET + card Load-Shedding Waltz |
| g_hb_full_pressure | FULL PRESSURE | HEARTHBACK: vent a ≥ 95 % SHELL 3 times in one run (fullVents · 3 · run) | HEARTHBACK palette COOLED FLOW |
| g_hb_rolling_boil | ROLLING BOIL | HEARTHBACK: 40 kills from one SHELL VENT (hookKillsBest · 40 · run) | card Geothermal Lease |
| g_hb_warm_welcome | WARM WELCOME | clear any city with HEARTHBACK (titanClears · 1 · life) | evolution Supervolcano Permit |
| g_hb_continental_drift | CONTINENTAL DRIFT | clear all three with HEARTHBACK (titanBiomesCleared · 3 · life) | palette TERRACOTTA + card Ash Cloud Advisory |
| g_bw_full_bloom | FULL BLOOM | BRIARWICK: 8 bloom turrets alive at once, GREENBELT DECREE blooms not counted (bloomsBest · 8 · run) | BRIARWICK palette AUTUMN LOT |
| g_bw_green_thumb | GREEN THUMB | BRIARWICK: heal 2 000 HP in one run (healed · 2000 · run) | card Seed Catalogue |
| g_bw_rewilded | REWILDED | clear any city with BRIARWICK (titanClears · 1 · life) | evolution Urban Forest Act |
| g_bw_canopy_cover | CANOPY COVER | clear all three with BRIARWICK (titanBiomesCleared · 3 · life) | palette NIGHT GARDEN + card Arbor Day |

**City (9)**
| id | Name | Condition | Unlocks |
|---|---|---|---|
| g_ge_curb_appeal | CURB APPEAL | GRID-EAST: flatten 400 street props in one run (props · 400 · run) | card Parking Validation |
| g_ge_parking_violation | PARKING VIOLATION | defeat PARKADE-6 (bossKillsLife, boss parkade6 · 1 · life) | card After-Hours Permit |
| g_ge_rate_hike | RATE HIKE | GRID-EAST: destroy 6 OVERLOAD SITES in one run (overloadSites · 6 · run) | card Citizen Hotline |
| g_ws_cold_storage | COLD STORAGE | WHITE STACKS: topple 60 % of the district's tier-4 structures in one run (tier4CollapseFrac · 0.6 · run; progress shows `x / ceil(0.6 × tier4Total)`) | card Rent Control |
| g_ws_thaw | THAW | defeat IRON GULLY (bossKillsLife, boss irongully · 1 · life) | card Eviction Notice |
| g_ws_hairline | HAIRLINE FRACTURES | stagger IRON GULLY 3 times in one fight, rematches excluded (staggersBestFight, boss irongully → `tally.staggersBestFightBy.irongully` · 3 · run) | perk SAFETY INSPECTION |
| g_lw_shipping_delays | SHIPPING DELAYS | LOCKWATER: sink 60 boats in one run (boats · 60 · run) | card Street Festival |
| g_lw_port_closed | PORT CLOSED | defeat CAISSON-4 (bossKillsLife, boss caisson4 · 1 · life) | card Landmark Status |
| g_lw_early_closing | EARLY CLOSING | clear LOCKWATER in under 9:00 (fastClearS · 540 · run, lowerIsBetter) | card Detour Signage |

Goal descriptions (`desc`) are the condition text above, set in `data/goals.ts`. Metrics with a boss or
biome filter only count runs or fights that match it.

**Reachability (rev 2).** Rev 1's COLD STORAGE asked for 8 tier-4 collapses; over 40 WHITE STACKS seeds
the city generates 3–15 tier-4 buildings (median 10) and 10 of 40 seeds have fewer than 8, so it is now
a fraction of what exists (`tally.tier4Total`, set on the first `stepTally`). `probe_meta` asserts on
seed 1337, per biome and titan the goal applies to: (a) every run-scope target is ≤ what the run can
physically supply (props, boats, tier-4 buildings, OVERLOAD SITES placed and power-ups dropped over one
full gate-bot run); (b) at least 10 run-scope goals are met by the gate bot somewhere in the 12-run
GATE 2 matrix; (c) the GREENBELT DECREE and GRIDLOCK SURGE exclusions (a scripted tally with only ult
blooms / ult wires leaves FULL BLOOM / SIX-WAY SPLICE at 0).

### 8.3 Persistence (`core/save.ts` + `meta/profile.ts`)
* Key **`blocktooth.profile.v1`** holds a `Profile` (snippet). Every read and write is wrapped in
  try/catch, like the existing settings and bests: a sandboxed iframe, private window, disabled storage
  or quota error degrades to an **in-memory profile for the session**, never a crash.
  `sanitizeProfile` coerces field by field (unknown goal ids dropped, non-finite numbers dropped, titan
  and biome ids validated), so a corrupt or hand-edited blob cannot break the select screen.
* Written at: goal met (immediately), run end (`applyRunToProfile`: life counters, `clearedBy`,
  `bossKills`, `newUnlocks`), perk or palette choice on select, first full cinematic watched.
* Bests stay in `blocktooth.best.v1` (unchanged). v2 adds keys: `endlessS`, `endlessScore`,
  `rematches` (§9).
* URL `?meta=fresh|full` (dev only, with `?dev=1`): run with an in-memory empty profile / everything
  unlocked, and do not touch storage. The harness uses it.

### 8.4 Where it shows
* **NEXT PERMIT PENDING slip** (L9 `NextUnlockPanel`, on both select steps). Rev 2 drops rev 1's
  full-width strip (its layout and copy followed the reference's unlock strip, §0.7). It is a
  **tilted manila permit slip** (−3°, 16u × 6.5u) pinned by a paper clip to the **right edge of the
  lore column**, in the WARD-7 package style: a header `NEXT PERMIT PENDING`, the unlock's glyph (card
  glyph, perk `key`, palette `swatch`) and name, the goal name in small caps, a progress bar with
  `x / y`, and a rubber stamp `PENDING` that turns into `ISSUED` the moment the goal is met. It picks
  `nextUnlock(profile, titan, biome)`: incomplete goals that are general or match the focused titan or
  biome, ranked by progress fraction (`best / target`, the inverse for `lowerIsBetter`), ties by list
  order. The titan step passes `biome = null` (general + titan goals). When everything is unlocked it
  reads `EVERY PERMIT ISSUED`.
* **YOUR BEST ON FILE** (L9, the foot of the focused select card, not in the slip):
  `YOUR BEST ON FILE: LV n · SIZE r · m:ss` from the bests for the focused titan (and biome on step 2);
  `NO BROADCASTS ON FILE` when there is none (the existing string).
* **GOALS & RECORDS [G]**: a chip in the select and title **confirm bars** (next to the existing key
  chips), not attached to the slip.
* **Select-screen navigation model (rev 2).** Today `select.ts` maps ↑/↓/←/→ all to `move(±1)`. v2 adds
  a focused **row**: `'cards'` (default) and one extra row per step (`'palette'` on step 1, `'perk'` on
  step 2). **←/→ act on the focused row** (cards: move the focus, exactly as today; palette / perk:
  change the value). **↓ from `cards` focuses the extra row; ↑ returns to `cards`**; ↑/↓ no longer move
  the card focus. Confirm (Enter / A / pad Y `alt`) confirms the step from any row; back (Esc / B /
  Select) steps back as today. The mouse clicks cards, swatches and the perk arrows directly. The
  harness navigates cards with ←/→ (`_harness/common.py` presses ↑/↓ only when ←/→ is stuck, which
  cannot happen on a one-row strip), so its path is unchanged; L9 re-runs `playtest --matrix` to prove it.
* **Perk row** (select step 2, under the biome cards): `STARTING PERK: < NONE | … >`. Locked perks show
  as a padlock with their goal name.
* **Palette row** (select step 1, under the lore column): 3 swatches (canonical + 2), locked ones with
  a padlock and their goal name. On a change the select screen calls `opts.portraitFor(titan, palette)`
  (`SelectRunOpts`, app-provided; `game.ts` caches one data URL per titan × palette and calls
  `renderPortrait`, the L0 stub returning the canonical portrait until L10 fills it) and swaps the image
  when the promise resolves.
* **GOALS & RECORDS screen** (L9 `GoalsScreen`), opened from the **title (`G` / pad X)** and the
  select screens (`G` / pad X; `SelectScreen.run` resolves `{kind: 'goals', resume}` and the app re-runs
  it with `initial = resume` after the goals screen closes, so the player returns to the same step,
  choice and row): a full-screen manila binder in the WARD-7 package style. Tabs across the top:
  `GENERAL · MOLO · VOLT-KITE · HEARTHBACK · BRIARWICK · CITIES · RECORDS`. Rows: glyph, name,
  condition, a progress bar `x / y`, and an unlock chip (the glyph plus the name, or a palette swatch).
  Done rows are stamped `FILED` with the date. RECORDS is a 4 × 3 table of titan × biome bests (level,
  peak SIZE, clear time, extended-coverage time and score). Controls: **←/→ tabs, ↑/↓ rows, Esc / pad B
  back**; the mouse wheel scrolls rows and tabs are clickable. A header count
  reads `27 / 40 GOALS FILED`.
* **Toast** (L8 `Toasts`): `GOAL MET` kicker, the goal name, and `UNLOCKED: <name> — NEXT RUN`,
  4.5 s each, queued at ≥ 3 s apart. Sfx: a news-desk "ding + typewriter". Toasts also fire on
  unlocks from run-end life goals, on top of the tabloid.
* **Tabloid**: a `NEW ON THE RECORD` sidebar lists this run's newly met goals, passed in as
  `TabloidExtra.newGoals` (goal name + unlock label, already resolved by the app from
  `applyRunToProfile(...).newly` plus the goals met live during the run).
* Draft: `NEW` ribbon on newly unlocked cards the first time they are offered (`DraftCtx.newIds`; the
  app then calls `markSeen` + `saveProfile`, §7.5).
* Toasts sit in their own stack **below** the broadcast toast slot (§4.1), never in it.

### 8.5 Starting perks (one per run, chosen on select step 2; `none` is always available)
| id | Name | Effect (applyPerk / tryRevive / map) | Unlocked by |
|---|---|---|---|
| perk_petty_cash | PETTY CASH | +1 reroll per draft (hidden perk card) | g_skyline_adjusted |
| perk_red_tape | RED TAPE | +1 BANISH and +1 LOCK charge | g_paperwork |
| perk_warm_mic | WARM MIC | the run starts with UPROAR full | g_running_errands |
| perk_safety_inspection | SAFETY INSPECTION | +8 armor (hidden perk card) | g_ws_hairline |
| perk_stay_of_demolition | STAY OF DEMOLITION | once per run, lethal damage leaves the titan at 25 % HP with 2 s of full invulnerability (`w.ult.invulnT`, which `hurtTitan` checks first, so damage-over-time is covered too; `iframeT` alone would not cover `dot`) (`revive` event; `WARD-7: THE SUBJECT IS STILL MOVING` toast in the v2 `Toasts` stack) | g_one_take |
| perk_tip_line | ADVANCE TIP-LINE | +1 OVERLOAD SITE active; objective edge arrows reach twice as far | g_change_order |
`probe_meta` runs GATE-2 rank bands for every perk (4 titans × GRID-EAST × 6 perks, seed 1337); a perk
that breaks a band gets its number reduced.

### 8.6 Palettes (`data/palettes.ts`, view-only; `w.meta.palette`)
| Titan | 1 | 2 |
|---|---|---|
| MOLO | **TIDEPOOL** primary `#2f9fb0` · secondary `#1d5e70` · belly `#f1dfb0` · accent `#ffd6a0` · glow `#9ff4ff` · eye `#ffd166` | **RUST BELT** `#b0643a` · `#6e3a22` · `#e8c9a0` · `#f1e4c8` · `#ffcf7a` · `#fff27a` |
| VOLT-KITE | **SODIUM LAMP** `#2b2622` · `#16120f` · `#6b5a45` · `#ffb13b` · `#ffc85e` · `#fff27a` | **SLEET** `#dfe6ee` · `#9aa8b8` · `#ffffff` · `#6ff3ff` · `#6ff3ff` · `#3b3f9e` |
| HEARTHBACK | **COOLED FLOW** `#3a3f47` · `#5d6670` · `#8a8f96` · `#6fd8ff` · `#9ff0ff` · `#e9f1ff` | **TERRACOTTA** `#8e4a3a` · `#5a2f25` · `#c98a5e` · `#ffd166` · `#ffe39a` · `#fff3b0` |
| BRIARWICK | **AUTUMN LOT** `#b8702e` · `#5e3a22` · `#e8c07a` · `#ff6f5e` · `#ffd166` · `#fff3b0` · horns `#f1e4c8` | **NIGHT GARDEN** `#4a3a78` · `#2a2240` · `#9c8fd0` · `#7affc9` · `#b8ff7a` · `#fff3b0` · horns `#d8d0f0` |
Glow and emissive stay within the glare bar (3–8× their surface). `buildTitanModel(id, colors?)` gains
the optional palette (L10), and `titans/portraits.ts` gains `renderPortrait(renderer, id, size,
palette)` (`RenderPortraitFn`; L0 stub, L10 body). `renderPortraits` (the canonical set) is unchanged.
Only `game.ts` calls either (through `SelectRunOpts.portraitFor`, §8.4), so L10 never edits `game.ts`.

---

## §9 #8 EXTENDED COVERAGE (endless mode)

### 9.1 Flow
1. The boss dies → `runEnd clear` → aftermath → the tabloid (clear variant) prints as today. Bests are
   recorded then, so the clear is filed even if the player continues.
2. The clear front page gains a **fourth button, `KEEP GOING [K]`**, placed first in the button row
   with a gold `EXTENDED COVERAGE` tag. **Default focus stays on RETRY**: continuing is an opt-in choice
   (owner decision §16 Q7). Pad: d-pad to it + A.
3. `broadcast.tabloid(w, photo, {newGoals, canContinue: true})` resolves `'endless'` → the app (L0
   pre-wire, `game.ts continueEndlessFlow`), in this order:
   1. `if (!mutate(w => continueEndless(w))) return` (stub → false → the tabloid choice is ignored and
      the app falls back to RETRY, today's default);
   2. **undo the ending state** that `beginEnding` set, or `enterPlay` leaves the sim frozen
      (`loop.simEnabled = !_testFrozen && !this.ending`): `ending = false`, `endResult = null`,
      `endT = 0`, `hitStopT = 0`, `sizeUpHoldT = 0`, `loop.timeScale = 1`, `input.bufferS =
      INPUT_BUFFER_S`, `wantDraft = false`, `draftArmed = false`, `modal = null`;
   3. `bossbar.hide()`, `alert endless`, the biome track at intensity 0.8;
   4. `enterPlay()` (sets `input.mode = 'game'`, clears edges, shows the HUD, unfreezes the sim).
   **Phase**: `run.phase` stays `'endless'` for the rest of the run: the L0 pre-wire makes `spawnBoss`
   set `'boss'` only when `!w.endless` (§2.7), and `stepEndless` re-asserts `'endless'` every tick as a
   belt-and-braces guard. **Rematch damage**: `bossHostile` × `endlessBossDmgMul(w)` is pre-wired by L0
   (§2.7), so L5 only fills `meta/endless.ts`.
4. `continueEndless(w)`: only when `run.result === 'clear'`. Sets `run.result = null`, `run.phase =
   'endless'`, `run.endT = -1`, `w.boss = null` (the dead one), and `w.endless = {startT: w.t,
   rematches: 0, nextBossT: w.t + ENDLESS.bossEveryS, bossIx: 1, nextEliteT: w.t + 30, killsAt,
   tonsAt, score: 0}`. `bossIx` starts at 1 because the city's own boss has just been beaten.
5. The titan's death ends the run (`runEnd dead`, `w.endless` set) → the **EXTENDED COVERAGE
   tabloid**.

### 9.2 Escalation (`meta/endless.ts`; m = minutes since KEEP GOING)
* Director budget × `min(6, 1 + 0.30 m)` (`endlessBudgetMul`). Spawn HP × `(1 + 0.35 m)`
  (`endlessHpMul`), on top of the per-minute ramp. Hostile damage × `min(3, 1 + 0.10 m)`
  (`endlessDmgMul`, applied in `hurtTitan`).
* A RAMROD every 60 s (`spawnEnemy(w, 'elite', …)` on the ring; its chest follows the normal flow).
* **Rematches**: every `ENDLESS.bossEveryS` = 150 s after the previous rematch dies (or after KEEP
  GOING), `spawnBoss(w, order[bossIx % 3])` with `order = rematchOrder(biome)` = [the city's boss, then
  the other two in `BOSS_IDS_V2` order], so GRID-EAST runs PARKADE-6 → CAISSON-4 → IRON GULLY →
  PARKADE-6 …. HP × `(1 + 0.5 n)` (applied by `stepEndless` right after `spawnBoss`) and damage ×
  `(1 + 0.1 n)` (n = rematches so far; `endlessBossDmgMul`, read by the pre-wired `bossHostile`). The `endlessBoss` event and `alert rematch` fire. Regular spawns drop to the usual boss
  share. A dead rematch drops a guaranteed power-up and a **chest**, and `rematches++`.
* The OVERLOAD / RELIEF schedules continue; the ANNEX schedule does not (no more breaches).
* Leveling continues. When the draft pool is exhausted, `hasPendingDraft` is false and drafts stop.

### 9.3 Score, records, tabloid
* `endlessScore = floor(10 × endlessS + 2 × kills since + 5000 × rematches + tons since / 500)`,
  shown live in the tracker (`EXTENDED COVERAGE 3:12 · SCORE 48 210`).
* Bests: `bestKey(t, b, 'endlessS')`, `'endlessScore'`, `'rematches'` (higher wins).
* Tabloid variant: masthead unchanged, kicker **`EXTENDED COVERAGE EDITION`**, headline **`IT WOULD NOT
  LEAVE.`**, sub-heads `ON AIR m:ss · EXTENDED m:ss · REMATCHES WON n · SCORE s`, record stamps as today.
  Buttons: RETRY / CHANGE TITAN / TITLE (no KEEP GOING after a death).
* `probe_endless` (L5): clear via the dev boss kill → `continueEndless` → 12 sim minutes with the gate
  bot (no god). Checks: no NaN or throw; multipliers at m = 1 / 5 / 10 equal the formulas; rematches at
  150 s cadence in the specified order with the HP scale; the score is monotone; death ends the run with
  `result 'dead'` and `w.endless` still set; determinism (same seed and decision tick → same hash).

---

## §10 #6 A unique boss per city

### 10.1 Assignment
| City | Boss | Why |
|---|---|---|
| GRID-EAST (day, commercial blocks) | **PARKADE-6** (new) | a commercial district's own municipal machine |
| WHITE STACKS | IRON GULLY (unchanged) | |
| LOCKWATER | **CAISSON-4** (unchanged; it is a harbour crane rig and wades in from the harbour) | |
L3 flips `BIOMES.grideast.boss` from `'caisson4'` to `'parkade6'` as the **last** step of its lane (end
of C1), after its probes pass and the GATE 2 rows for GRID-EAST pass with PARKADE-6. **Why in C1 and not
after the view lands (review finding, design kept):** GATE 2 and the combined GATE 2 after C1 (§0.6)
must measure GRID-EAST with its real boss, and the flip is sim data. What made it unsafe in rev 1 was
`bossview.ts` rendering every non-CAISSON id as IRON GULLY (line 893). L0 now adds a `parkade6` branch
with a placeholder rig (§2.7), so between C1 and C2 a browser gate on GRID-EAST shows a PARKADE-6
placeholder slab, never the wrong rig or a crash; no C1 lane runs a browser gate, and L7 replaces the
placeholder in C2. `broadcast.ts` line 446
(the tabloid picks the boss name by biome) must read `BOSSES[BIOMES[w.biomeId].boss]` (L9 fixes it).

### 10.2 PARKADE-6: design (sim, lane L3)
**Concept.** HALVARD's answer to a monster in the shopping district is a **six-legged multi-storey
car park that walks**. Four open concrete decks full of parked cars stand on hydraulic stilt legs,
with corner spiral ramps, a **toll booth** for a head carrying a striped **barrier arm** and an amber
**beacon**, and the **TILL**: a heavy pay-station drawer that shoots out of the front of the toll booth
on a telescoping rail whenever the garage launches traffic. Saturday-morning-comic municipal absurdity, no reference to any existing monster or robot.
It is not a centipede (compact, blocky, six legs under a slab), not a humanoid mech, not a crane.

`BOSSES.parkade6 = { id: 'parkade6', name: 'PARKADE-6', title: 'HALVARD MOBILE PARKING STRUCTURE',
meterName: 'JAM', hp: 180000, height: 64, attacks: [
 {id:'rampLaunch', name:'RAMP LAUNCH', subtitle:'RAMP LAUNCH — WATCH FOR FALLING TRAFFIC', phase:1},
 {id:'barrierSwing', name:'BARRIER ARM', subtitle:'BARRIER ARM — GET BEHIND THE BOOTH', phase:1},
 {id:'towChain', name:'TOW CHAIN', subtitle:'TOW CHAIN — STEP OFF THE LINKS', phase:2},
 {id:'deckDrop', name:'DECK DROP', subtitle:'DECK DROP — CLEAR THE FOOTPRINT', phase:2},
 {id:'levelCollapse', name:'LEVEL COLLAPSE', subtitle:'LEVEL COLLAPSE — COUNT THE RINGS, DASH THE LAST', phase:3} ] }`
`BOSS_DEFAULT_SUBTITLE.parkade6 = 'HIT THE TILL WHEN THE DECK OPENS — BUILD JAM'`.
At Size V: HP 180 000 × 1.15 = **207 000** (CAISSON-4 218 500, IRON GULLY 247 250).

**Body and parts** (boss-local, facing +Z; `makePart(name, ox, oz, r, y0, y1, hpMul, strainMul)`):
| part | ox, oz | r | y | hpMul | strainMul |
|---|---|---|---|---|---|
| body (4 decks) | 0, 0 | 22 | 12–56 | 1 | 0.2 |
| legFL / legFR | ±20, 24 | 5 | 0–30 | 1 | 0.8 |
| legML / legMR | ±22, 0 | 5 | 0–30 | 1 | 0.8 |
| legBL / legBR | ±20, −24 | 5 | 0–30 | 1 | 0.8 |
| booth (head) | 0, 32 | 7 | 38–52 | 1.4 | 1.5 |
| arm (barrier pivot housing; the boom itself is visual only) | 9, 35 | 4 | 44–48 | 0.6 | 0.3 |
| **till** closed (stowed in the booth) | 0, 30 | 4 | 40–46 | 0.3 | **0** |
| **till** open (drawer out) | **0, 43** | **8** | 30–40 | **2.0** | **4.0** |

**Why the till is at the front (rev 2).** Rev 1 put the till at the boss centre (0, 0, r 6) inside the
body (r 22), behind a keep-out of about 68 m at Size V. Titan targeting is **planar**
(`combat/targeting.ts nearestBossPart` = the nearest part *surface* in x/z; y spans play no part), so
the body, booth or arm was always nearer, and every area shape reaching the till also overlapped the body
and was split with it (`damage.ts` BOSS_AOE_SPLIT, lines 254–270): the weak point could not be hit. Part
offsets are plain data that `partsToWorld` re-projects every tick (`bosses/index.ts` 203–210), so
`parkade6.ts step` **rewrites the till part's `ox, oz, r, y0, y1, hpMul, strainMul` every tick** from
`b.data.tillOpen`:
* **closed**: the drawer is stowed inside the booth (0, 30, r 4); its surface is 5 m behind the booth's
  face, so the booth (r 7 at oz 32) is always nearer. `strainMul 0`, `hpMul 0.3`.
* **open**: the drawer slides out **12 m past the booth's face** to (0, 43, r 8), at the titan's chest
  height (y 30–40). `keepRange` turns the booth toward the titan (`turnBoss` every tick), and the open
  till is then the **nearest part surface** for a titan within **±25° of the booth's facing at 55 m,
  ±34° at 70 m, ±37° at 90 m and ±41° at 130 m** (computed on 2026-09-24 by a scratch script with the
  exact `nearestBossPart` rule over the part table above; the limit is the front legs, and on the
  arm side the arm's pivot housing at 55 m). Rev 1's arm part at (14, 40, r 6) cut the arm side down to
  ±9°, which is why the arm's hit part is now its pivot housing. From the flanks or the rear the legs
  and body are nearer, which is the intended footwork: **get in front of the booth**.
* An area shape centred on the till (a stomp, a bite cleave) typically also overlaps the booth, so the
  split gives the till 1/2 of the shape (1/3 with the arm): still × 4 strain on that share, which is the
  largest strain source on the rig.
Rig footprint radius `RIG_R = 33` m. **Keep-out** (hard wall, as with CAISSON-4): `RIG_R + titan.radius +
10`; the open till's front surface (51 m from the centre) reaches toward the wall and into the titan's
reach band, like CAISSON-4's legs.
Footwork: `keepRange(w, b, 70, 130, 7, 0.8)`. It turns its booth toward the titan. Entrance: reverses
in from the nearest city edge along the road axis (4 s intro, `entryPoint`), with a reversing-beeper sfx.

**Attacks.** Everything is in titan heights H = `bossH(w, b)`, R = titan radius, windups from
`fairWindup(w, b, escapeM, min, max)` exactly as in `bosses/index.ts`, painted with `bossTelegraph`.
Damage is **base** → `min(bossHostile(w, base), 0.55 × titan.maxHp)` (HIT_CAP 0.55, like the others).
Gaps between attacks `[_, 2.7, 2.1, 1.9]` s; P3 cadence × 0.75. Anti-spam `repeatMul`.

| Phase | Attack | Telegraph (style) | Geometry | Windup | Base dmg | Notes |
|---|---|---|---|---|---|---|
| P1+ | **rampLaunch** | `circle` per car (lobbed `carLob` projectile → auto circle tell) | 4 cars (P2 5, P3 6): first on `leadPoint`, the rest on a 0.9 H ring around it at `rng.boss` angles; each r **0.35 H** | `fairWindup(0.35H + R, 1.2, 2.2)` + 0.18 s × i stagger | 16 each | **opens the TILL** for `TILL_OPEN_S` = 3.5 s (P3 2.5 s) from the launch: subtitle `THE TILL IS OPEN — GET IN FRONT OF THE BOOTH`, `b.data.tillOpen`; the booth holds its facing (turn rate × 0.5) while the till is out |
| P1+ | **barrierSwing** | `cone` | from the booth, half-angle 40°, reach **2.4 H** | fair from the cheaper walk-out (sideways `d·sin 40° + R`, or out past the reach) (1.1–2.2) | 30 | knock 0.8 H/s along the sweep |
| P2+ | **towChain** | **`chain`** (the unused style; `Telegraph.chain` = link points for the view, `shape` = capsule for damage) | booth → 0.8 H past the titan's lead point; links every 0.55 H (5–10 links), link r **0.3 H** | `fairWindup(0.3H + R, 1.0, 2.0)` (sideways walk-out) | 18 | on a hit: **tow** = `T.leash` for 2.0 s pulling toward the booth at 0.3 H/s (`leash` event, chain drawn); moving against it fills JAM 0.10/s. UPROAR snaps it |
| P2+ | **deckDrop** | `ring` | 0 → `RIG_R` + **0.9 H** around the boss | fair from the titan's distance to the outer edge (0.9–2.0) | 40 | the till opens 2.0 s after the slam (decks bounce) |
| P3 | **levelCollapse** | 3 × `ring` | A: 0 → RIG_R + 0.6 H · B: RIG_R + 0.6 H → RIG_R + 1.3 H · C: RIG_R + 1.3 H → RIG_R + 2.0 H | A fair (0.9–2.0), B = A + 0.45 s, C = A + 0.9 s | 36 each | readable as three beats: walk out of A and B, dash C (i-frames) or stand in the cleared inner ring once A has fired |
| any | *dash answer* (`watchDash`, cd `[_, 8, 6, 5]`) | `circle` (a `carLob` "wheel clamp" drop) | r 0.45 H at the dash end + 0.3 (r + R) ahead | fair, k 1 fixed (0.9–2.0) | 8 | same rules as CAISSON-4's trolley follow |

**Weak point and stagger (JAM).** JAM fills by the standard rule (`dealt × strainMul / (0.45 ×
maxHp)`), so it builds mostly by hitting the **TILL while it is open** (strainMul 4, from the front),
with a little from the booth (1.5) and legs (0.8). The tow resist adds 0.10/s and UPROAR adds exactly
+0.30 (`bossUltHit` is body-only, §2.7). Full JAM → **JAMMED**: a 5 s stagger, ×2 damage, the till
forced open for the stagger, the decks sag, and the beacon strobes slowly. Nameplate:
`PARKADE-6 / PHASE n / JAM ▮▮▮▯▯`. Phases at 66 % / 33 %. `parkade6.ts onDamage` accumulates titan damage
per part group in `b.data.part_till / part_booth / part_body / part_legs` (probe telemetry).

**Markers.** While `tillOpen > 0` (and during JAMMED), `markerview.ts` emits a `till` marker at the
till part's world position and height: the `till` glyph (pay-station box with a coin slot, §4.3) with
the label **`HIT THE TILL`**, pixel sized, with an edge arrow if off-screen.

**Acceptance (`probe_boss3`, L3).** 5 seeds, Size V (and one Size IV spawn), with the policy bot port
used by `_harness/scratch/boss_threat.ts`. Tells landed on VOLT-KITE / MOLO fall in **4–16 %** (the
band CAISSON-4 and IRON GULLY sit in); every attack fires at least once in its phases; every
`rampLaunch` opens the till; ≥ 1 JAMMED per 150 s of competent play; no single hit > 55 % of max HP;
every windup ≥ 0.9 s; the titan is never inside the keep-out; median fight 70–170 s with the non-god
gate bot **with UPROAR in use**; **reachability of the weak point**: while the till is open, **≥ 35 %**
of the titan's damage to the boss lands on the till (`part_till` over all `part_*` accumulated only
while `tillOpen > 0`), for MOLO (melee) and VOLT-KITE (ranged) each; and a geometry unit test: titan
placed at the keep-out wall straight ahead of the booth → `findTarget` returns the till part when open
and the booth when closed. Then the GRID-EAST rows of GATE 2 with PARKADE-6: clears and deaths in the same range as
CAISSON-4 had on GRID-EAST (the matrix still needs ≥ 8/12 clears).

### 10.3 PARKADE-6 model and animation brief (lane L7, `ai/foemodels_parkade.ts` + `bossview.ts`)
* **Build**: multi-part faceted low poly (§6.1 look: non-indexed, flat normals, vertex colours,
  `bakeOutlineNormals`, 3.0 px ink hull), authored facing +Z at 64 m. Parts:
  * **4 decks**: thin slabs on a 3 × 4 grid of square pillars, parapet walls banded cream `#f1e4c8`
    and coral `#ff6f5e`, painted bay lines, a big level number decal per deck (`P1`–`P4`);
  * **2 spiral ramps** at the rear corners (helical ramp strips wrapping a core);
  * **6 legs**: upper hydraulic piston (teal `#2f7f86`), lower strut, a foot pad with black/yellow
    hazard stripes;
  * **toll-booth head**: a small cabin with windows and a roof **beacon** (amber `#ffb13b`, emissive
    within the glare bar, rotating); an original sign reading `PAY ON EXIT`;
  * **barrier arm**: a long red/cream striped boom with a counterweight, pivot at the booth;
  * **the TILL**: a chunky pay-station drawer housed in the booth's front, with a coin slot; when open
    it runs out 12 m on a telescoping steel rail and drops to the titan's chest height (y 30–40), gold
    interior glow (3–8× surface). The view places it from the till part's live `ox/oz/y0/y1`;
  * a **tow winch** under the booth with a spooled chain;
  * **parked toy cars**: one `InstancedMesh` (+ outline) of 24 cars across the decks, using the city
    kit's car palette. A car instance hides when it is launched.
* **Silhouette check**: blocky and horizontal (about 50 × 70 m plan, 64 m tall), readable as "a
  building walking" from the isometric camera. Nothing about it resembles a centipede or a
  dinosaur-with-plates, and it is not a humanoid.
* **Animation (procedural)**: **tripod gait** (legs FL, MR, BL / FR, ML, BR alternate; 0.9 s cycle at
  7 m/s; the body bobs 0.6 m), turn in place; **rampLaunch**: a rear deck tilts up 12° over 0.3 s, a
  car slides to the lip and is flung (hide the instance; the projectile view takes over); **barrierSwing**:
  raise 25° in 0.4 s, then sweep 80° synced to fire, then return; the arm idles with a ±10° bob;
  **towChain**: the winch spins and the chain is drawn as instanced links along `Telegraph.chain`, then
  along the leash while it holds; **deckDrop**: the body crouches 6 m then slams, and the decks
  squash 6 %; **levelCollapse**: the decks pancake top to bottom 0.15 s apart, then restack; **till
  open**: the rail telescopes out 12 m in 0.3 s, the drawer drops, and the gold glow ramps up; **JAMMED**: the decks sag 4°, the legs
  splay, the beacon strobes slowly, steam puffs; **defeat**: the legs buckle in sequence, the decks
  slide off like dominoes, and cars spill (debris).
* **Budget**: ≤ 40 draw calls including outlines; no per-frame allocation; instanced cars and links.
  `projectileview.ts LOOK.carLob`: a single toy car mesh (reuse the city kit car geometry), tumbling in
  flight.

---

## §11 #7 Cinematic opening (lanes L10 + L6 hooks)

### 11.1 What it replaces
The open slate (freeze-frame + halftone + lower third + "PRESS ANY KEY") becomes a **street-level
news-cam sequence** that ends by craning up into the gameplay camera and starting play. `Screen` stays
`'slate'` for the whole cinematic (harness semantics are unchanged), and the sim stays frozen, so
nothing in the sim changes. The lower-third copy is kept: `UNIDENTIFIED MASS — DOWNTOWN GRID` etc.
Fallbacks: `Settings.cinematic = 0`, `?cine=0`, and `CineCam.plan()` returning `null` (the L0 stub
always does; L10 returns null when no camera-safe S2 pose exists) all run the legacy freeze-frame slate
unchanged. There is no `'unsupported'` result: the decision is made before `CineOverlay.play` is called,
and `play` resolves only `'done' | 'skipped' | 'aborted'` (`CineOverlayApi`). `?noslate=1` skips both.

**Abort path (L0 pre-wire in `game.ts`).** `closeScreens()`, `dismiss()` and every epoch change
(`newRun`, retry, title) call `cineCam.stop()` (restores fov, near, far and roll immediately and hands
the camera back) and `cineOverlay.clear()` (removes the DOM, resolves `'aborted'`) before anything else,
exactly as they call `broadcast.clear()` for the legacy slate today. The `'slate'` modal therefore
covers both paths. **Clip planes**: `CameraRig.update` sets `near = max(0.1, D × 0.02)` for the gameplay
distance D, which would clip a close-up 2 m from a 1.2 m titan, so `CineCam.start` sets
`plan.near` / `plan.far` (0.05 m / 2 000 m) and restores the rig's values at hand-back or `stop()`.

### 11.2 Shot list (full version, 6.85 s; the titan is at Size I, H ≈ 1.2 m)
| t (s) | Shot | Camera | Titan | Overlay (`ui/cine.ts`) |
|---|---|---|---|---|
| 0.00–0.35 | **SIGNAL** | holds the S1 pose | idle | video static, then the full-bleed **camcorder viewfinder** frame snaps on (4 corner brackets, centre cross, `REC ●`, timecode, battery glyph, all in cream Space Mono); `SIGNAL ACQUIRED` (mono) centre-bottom. No letterbox bars, no top-corner tabs (rev 2, §0.7) |
| 0.35–2.35 | **S1 STREET CAM** (`street`) | at the titan + dir(heading ± 150°) × **7 H**, **bumper height 0.2 H**, looking up past the biome's foreground element (§11.3: a parked toy car's bumper, a snowbank, a boat's gunwale) that fills the **bottom** of the frame; aimed at the face (the head joint). fov 40° → **crash zoom to 24°** over 0.25 s at t = 1.6. Handheld: 0.6° rotational noise at 1.3 Hz + 1 cm jitter | idle sniff, tail flick | the viewfinder frame, `REC ●`, the timecode running |
| 2.35–4.85 | **S2 LOW-ANGLE** (`closeup`, the money shot) | cut to a **low three-quarter profile**: 35° off the head's forward axis, 2.4 H from the face, camera at 0.35 H looking **up** at the jaw line (about 20° up-tilt), fov 30°, a slow 4° orbit across the shot. Not a centred head-on face (the reference's framing, §0.7) | head turns toward the lens (0.4 s) but stays in three-quarter; **BLINK** at 2.9 s (lids close 0.08 s, hold 0.06, open 0.12); **SNARL** at 3.7 s (jaw 35 % open, lip curl, head recoil 4°, 0.5 s) + a small growl sfx | at 2.6 s the **existing slate lower third** slides in from the left along the bottom (today's `broadcast.ts` slate block, unchanged in style and copy: its `BREAKING` label inside the block, `UNIDENTIFIED MASS — <PLACE>`, the sub-line from `STR.slates`, the `SUBJECT: <TITAN> — PROVISIONAL DESIGNATION` chip). The `WARD-7 • LIVE` bug is the HUD's own, in its HUD place (top-left), fading in with the lower third |
| 4.85–6.85 | **S3 CRANE-UP** (`crane`, then `handoff`) | a cubic Bézier from the S2 pose (control points: back 3 H and up 2 H, then above the gameplay target) to the **gameplay pose** (`plan.game`: `rig.reset(w)` + one `rig.update`, read back), `easeInOutCubic`, fov → the rig's | returns to idle | the viewfinder brackets expand off-screen over the last 0.8 s; the lower third collapses into the HUD's WARD-7 bug (translate + scale to the top-left, 0.4 s); the HUD fades in at 6.4 s |
| 6.85 | → **play** | CameraRig takes over (no pop: its state was reset to this exact pose; clip planes restored) | | sim unfreezes, input to `'game'` |

* **Skippable** at any moment with any key or button (via `input.anyPressed()`, with the 0.35 s shared
  guard): 0.25 s crossfade to the gameplay pose, then play. `SKIP ▸ ANY KEY` hint bottom-right after 0.8 s.
* **Short version** (`Settings.cinematic = 1`, and automatically on RETRY and on any titan × biome pair
  whose full version has been seen, `Profile.cineSeen`): S2 compressed to 1.5 s (blink at 0.3 s, snarl
  at 0.8 s) + S3 1.5 s = **3.0 s**.
* **Camera safety**: S1 and S2 candidate positions are tested against `w.city` building AABBs
  (segment titan→camera must not cross a non-collapsed building; the camera itself ≥ 0.5 m from any
  AABB). Try heading offsets [+150°, −150°, 180°, +120°, −120°] and take the first clear one.
* **Reduce motion** (`Settings.reduceMotion`): no handheld shake, no crash zoom, no crane. S2 holds for
  2.0 s with the lower third, then a 0.4 s crossfade to the gameplay pose. The same setting disables
  the camera punch on MASS BREACH and UPROAR (screen shake has its own switch).

### 11.3 Per-biome variants (`data/cine.ts`)
| Biome | S1 staging | Lens / grade | Extra |
|---|---|---|---|
| GRID-EAST (day) | `parkedCar`: a bumper-level shot across the zebra past the nearest parked toy car within 6 H (its bumper and one headlamp fill the bottom fifth of the frame); **no street sign or pole framed in a third** (rev 2: the reference intro frames a street sign in the left third, §0.7) | clean lens, warm grade (CSS overlay tint `#ffe9c9` at 8 %) | sub-line: `PARKING ENFORCEMENT HAS BEEN NOTIFIED` |
| WHITE STACKS (overcast) | `snowbank`: from behind a snowbank prop (camera height 0.3 H) | CSS frost vignette at the frame corners; env snow is already around the camera; cool grade | two breath-puff particles from the nostrils at the snarl (fx hook) |
| LOCKWATER (night) | `hull`: from the water side over a boat's gunwale: boat-bob (camera roll ±1.5° at 0.4 Hz, y ±0.03 H) | rain streaks on the lens (CSS), magenta/cyan rim | neon reflection is already in env |

### 11.4 Hooks (L10 owns them; the files are titan-view files and are free after the growth lane)
Exact types are in the snippet (`TitanViewAdd`, `FaceAnchor`, `CineChannels`, `CinePlan`, `CineShot`,
`CamPose`, `CineBiome`, `CineInfo`, `CineCamApi`, `CineOverlayApi`, `RenderPortraitFn`).
* `TitanView.faceAnchor(out: FaceAnchor): boolean`: fills the world position of the head (or eye) joint,
  the head's unit forward vector and the titan height (from `TitanModel.joints`); false when the model
  is not built yet (→ `plan()` returns null → legacy slate). `FaceAnchor` is THREE-free on purpose, so
  the planner is plain maths over it and `w.city`.
* `TitanView.setCine(ch: CineChannels | null)`: blend channels 0..1 that `TitanAnimator` layers over
  idle (a new `AnimState.cine` field). Each model's lids are a scale-Y on the eye-lid meshes (add lid
  meshes where a model lacks them); the snarl is the jaw joint plus the lip or snout joint.
* `buildTitanModel(id, colors?)` and `renderPortrait(renderer, id, size, palette)` for §8.6.
* `render/cinecam.ts` owns the camera during the sequence (pose, fov, roll, near, far); `CameraRig`
  gains nothing except the read of its reset pose (already public via `camera` after `reset` +
  `update`). Per frame `game.ts` calls `cineCam.update(dt)`, `cineOverlay.setShot(cineCam.shot)` and
  `titanView.setCine(cineCam.channels())`; when `update` returns false it calls `setShot(null)`, and the
  overlay resolves `'done'`.

---

## §12 Audio additions (in the lanes named)
`sfx.ts onEvents` new cases (L6 unless noted), all procedural, voice-limited, distance-attenuated:
`ultCharged` (brass 2-note + titan chuff) · `ultFire` per titan (MOLO wet gulp rumble, VOLT-KITE rising
buzz + thunder crack, HEARTHBACK low whoomp + magma hiss, BRIARWICK woody creak + rustle swell) ·
`ultPulse` (thud per ring, crackle per VOLT pulse) · `objectiveSpawn` (municipal 3-note chime) ·
`objectiveDone` (cash-register ka-ching for OVERLOAD, crate splinter + heal chime for RELIEF, filing-cabinet
slam for ANNEX) · `powerupSpawn` (soft ping) · `powerup` per kind (CLEANUP vacuum swoosh, DEMOLITION
rubber stamp + boom, RED LIGHT ticking clock + pitch-down, RUSH HOUR siren swell, BACK PAY coin cascade)
· `powerupEnd` · `revive` (sting) · `endlessBoss` (siren) · UI: `ui('banish')` stamp, `ui('lock')`
padlock click, `ui('goal')` ding + typewriter. PARKADE-6 voice (L7): reversing beeper on the intro,
hydraulic hiss per step, car launch clunk-whoosh, barrier-arm swing, winch rattle, deck slam, JAMMED
grind. Music: EXTENDED COVERAGE plays the biome track at intensity ≥ 0.8 and switches to `boss` during
rematches.

---

## §13 App integration (L0 pre-wires; lanes fill), test surface, URL params

### 13.1 `game.ts` flows (L0 writes all of them against the stubs; signatures = the snippet's APP-SIDE section)
* **Run start**: `profile = loadProfile()` (in-memory fallback on any storage error);
  `meta = params.meta override ?? runMetaFor(profile, titan, perk, palette)`;
  `createWorld({titan, biome, seed, meta})`.
* **Select**: `select.run({portraits, portraitFor, profile, bests: loadBest(), initial})` →
  `SelectResultV2`. `{kind: 'start', titan, biome, perk, palette}` → save `profile.perk` and
  `profile.palette[titan]` → run start. `{kind: 'goals', resume}` → `goals.open(profile, bests)` → re-run
  `select.run` with `initial = resume`. `null` → title. `portraitFor(titan, palette)` = a per-titan ×
  palette cache over `renderPortrait(renderer, titan, PORTRAIT_PX, palette === 0 ? null :
  TITAN_PALETTES[titan][palette - 1])`; palette 0 returns the canonical portrait.
* **Opening**: `runOpening(ep)`: when `settings.cinematic > 0` (or `?cine`) and not `noslate`,
  `face = titanView.faceAnchor(out)` and `plan = face ? cineCam.plan(w, rig, out, variant) : null`
  (variant: `'reduced'` under reduce motion, `'short'` for setting 1, RETRY or a seen pair, else
  `'full'`). `plan === null` → the legacy slate (`runSlate`, unchanged). Otherwise `modal = 'slate'`,
  `cineCam.start(plan)`, `await cineOverlay.play(plan, info)`; per frame (in `drawWorld`, before the
  render) `cineCam.update(dt)` → `cineOverlay.setShot(cineCam.shot)` → `titanView.setCine(...)`; the
  result `'done' | 'skipped'` → `cineCam.skip()` if still active, `titanView.setCine(null)`, mark
  `profile.cineSeen` for a full play and save, then `enterPlay()`; `'aborted'` → return (the epoch has
  moved on). **Abort path**: `closeScreens()`, `dismiss()` and every epoch change call
  `cineCam.stop()` and `cineOverlay.clear()` (§11.1).
* **Play frame**: after `hud.update`: `abilityBar.update/onEvents`, `tracker.update/onEvents`,
  `markers.update(markerView.frame())`. On `ultFire`: hit-stop `ULT.hitStopScale` for `ULT.hitStopS`,
  input buffer widened, and `rig.punch` unless reduce motion. Goals: 1 Hz `evalGoals(profile, w.tally,
  ctx)` → save → one toast per newly met goal (`Toasts.push`).
* **Draft**: `draft.open(w, offer, {rerollsLeft, banishLeft, lockLeft, locked, newIds})` →
  `DraftResultV2`; `{banish}` → `banishCard`, `{lock}` → `lockCard`, then re-open with the returned offer
  (the draft is not consumed); `{reroll}` → `rerollOffer` as today. `newIds` → `markSeen` + save (§7.5).
  After a pick that is an evolution → a `Toasts` entry `RESTRUCTURED: <NAME>` (2 s).
* **Run end** (`beginEnding`): `applyRunToProfile` → save → toasts; bests incl. the endless keys when
  `w.endless` is set.
* **Tabloid**: `broadcast.tabloid(w, photo, {newGoals, canContinue: result === 'clear' && !w.endless})`
  → `TabloidChoiceV2`; `'endless'` → the §9.1 flow (undo the ending state, then `enterPlay`).
  `?endless=1` makes the app pick `'endless'` itself on a clear (harness).
* **Title**: `TitleScreen.run()` resolves `'play' | 'goals'`; `'goals'` → `GoalsScreen.open(profile,
  bests)` → back to the title.
* **Pause**: `PauseMenu.open({w})`; the `LOADOUT` panel lists every owned card with glyph, name, stacks
  and desc, the perk, and banish/lock charges left, all read from `ctx.w` (no other data source).
* **Settings**: `Reduce motion` (toggle) and `Opening: FULL / SHORT / OFF` (`cinematic` 2/1/0), in the
  existing settings screen (`menus.ts`, L9).

### 13.2 URL params (new)
`?cine=0|1|2` (session override of the opening), `?meta=fresh|full` and `?perk=<PerkId>` (dev only),
`?endless=1` (dev: the clear tabloid auto-picks KEEP GOING, for harness runs). The real-key playtest
(§15.4) does **not** use `?endless=1`: it presses K.

### 13.3 Test surface (`window.__BT__`)
* `state().v2 = { ult: {charge, phase, fired, ready, r, invulnT}, objectives: [{id, kind, x, z, t, life,
  target, targetId}], powerups: [{id, kind, x, z, t}], power: {redLightT, rushHourT}, endless:
  EndlessState | null, tally: {ults, objectives, powerups, evolutions, banishes, locks, rerolls}, map:
  {overloadsDone, reliefsDone, annexesDone}, meta: RunMeta, cine: {shot, t} | null, draft:
  {banishLeft, lockLeft, locked, banished}, profile: {done: string[], newUnlocks: string[]} }`.
* `state().v2dom` (read-only DOM snapshot for real-input checks): `{barSlots: number, barBadges:
  string[], activeCdText: string, meterPct: number, trackerRows: number, markers: number, toasts:
  number}`. L0 writes the reader once in `testsurface.ts` against **fixed data attributes** that L8 must
  put on its nodes (visible nodes only): `[data-v2="bar-slot"]`, `[data-v2="badge"]` (text),
  `[data-v2="active-cd"]` (text), `[data-v2="meter"]` (`data-pct`), `[data-v2="tracker-row"]`,
  `[data-v2="marker"]`, `[data-v2="toast"]`. With the L0 stubs every count is 0.
* `newRun({…, meta?})`.
* Dev cheats (`?dev=1`): `ult(points = 100)`, `powerup(kind)` (spawns 3 H ahead of the titan),
  `objective(kind, ahead?)` (with `ahead` = metres straight ahead of the titan, for walk-in checks),
  `endless()` (kills the boss + auto KEEP GOING), `evolveReady(evoId)` (sets owned stacks to make the
  recipe ready), `bossSpawn(id)` (any boss id incl. parkade6), `tillOpen(s)` (PARKADE-6 only).
All go through `app.mutate`, so their events reach the views like a tick's. Cheats only set state; every
acceptance action in §15.4 is a real key, button or walk.

---

## §14 Pacing and GATE 2: what changes and the tuning order
| System | XP / power added | Guard | First knob if a band breaks |
|---|---|---|---|
| UPROAR | kill XP inside R, every 30–65 s; up to 6 % of a boss per fire | **per-fire XP cap = 50 % of the current level's need** (independent of R), kill XP × 0.5, no city damage | `ULT.xpCapLevelFrac`, then `ULT.killXpMul`, then `ULT_CITY_RANK_MUL`; boss: `ULT.bossCapFrac` |
| OVERLOAD SITE | 20 % of a level per site (median 5–12 per run, asserted by `probe_map`, not claimed) | one active, 30–40 s respawn | `OBJECTIVES.overload.xpFrac` |
| Heals and shields | RELIEF (3 × 10 %), MOLO / BRIARWICK ult heals, MOLO shield, STAY OF DEMOLITION | the GATE 2 **deaths ≥ 1** check (§0.6) | the heal numbers, then RELIEF `hpBelow` |
| RECORDS ANNEX | 4 chest drafts per run | one per breach | `annex.delayAfterBreachS` / chest → heal fallback |
| Power-ups | DEMOLITION kills, CLEANUP pull-in | 18 s gap, 3 alive, weights | `POWERUPS.dropByKill`, DEMOLITION weight |
| Evolutions | power spike mid/late run | recipe gating, 0.2 chance on level-up drafts | `DRAFT_V2.evoDraftChance` |
| Perks | small start bonuses | one per run | the perk's own number |
| PARKADE-6 | GRID-EAST boss difficulty | probe_boss3 bands | `BOSSES.parkade6.hp`, `GAP`, `HIT_CAP` |
Early draft cadence (8–30 s median) is affected only by UPROAR kills and OVERLOAD XP before 180 s. It
is checked by GATE 2 as today. **The combined effect is measured, not argued**: every sim lane tunes
against GATE 2 alone, so the orchestrator runs the combined GATE 2 (fresh and full) after C1 and again
after C2 (§15.1), with the §0.6 reporting lines (XP share through the UPROAR bank and through OVERLOAD
payouts; DEMOLITION kills; deaths ≥ 1). A combined failure is fixed with the first knobs above, in
table order, by the lane that owns the knob.

---

## §15 Build plan

### 15.1 Order and chunks
```
C0  L0 SKELETON (alone; orchestrator or one agent)           → gates: tsc, GATE 2 (±2 s), probes, bootcheck ×1, playtest ×1
C1  L1 ULT-SIM      · L2 DRAFT/EVO-SIM    · L3 BOSS3-SIM      (sim only; disjoint files)
    → orchestrator: COMBINED GATE 2 (--meta fresh AND --meta full) on the merged C1
C2  L4 MAP-SIM      · L5 META/ENDLESS-SIM · L7 PARKADE-VIEW
    → orchestrator: COMBINED GATE 2 (fresh AND full) on the merged C2; perfcheck (b) ALONE
C3  L6 FX+AUDIO-VIEWS · L8 HUD             · L9 SCREENS
    → orchestrator: perfcheck (a) ALONE, bootcheck ×12, playtest --matrix
C4  L10 CINEMATIC (+ titan-view hooks, palettes) → orchestrator: final gate battery, perfcheck ALONE, shots, README
```
Dependencies: C1 needs C0. L7 needs L3's sim (part names, `data.tillOpen`, attack ids), which is why it
is in C2. C3 views and UI need the events and state of C1–C2. L10 runs after C3 because it edits the
same titan-view files as L6 (`anim.ts`, `titanview.ts`) and hangs the portrait re-render on L9's
palette row. No two lanes in one chunk share a file. If only 8 agents are available, merge **L7 into
L3** (one agent does the boss end-to-end: its sim part in C1, its view part in C2; L7's files are
disjoint from every C1 and C2 lane) and **L10 into L9** (one agent does L9's part in **C3** and L10's
part in **C4**, never both in C3, because L10 edits `anim.ts` / `titanview.ts`, which L6 owns in C3).
The merged agents keep each lane's gates.

### 15.2 File ownership (v2). A lane edits only these; a "§section" entry means only that named part
| Lane | Owns (new files) | Edits in existing files (only the named part) |
|---|---|---|
| **L0 SKELETON** | every §2.6 file as a stub; `_harness/bot_ult.ts`, `bot_draft.ts`, `bot_map.ts` stubs | `core/types.ts`, `config.ts`, `rng.ts`, `world.ts`, `input.ts`, `save.ts` (settings fields + profile stubs); the Record completions of §2.1; the pre-wired hooks of §2.7.3 in `damage.ts`, `director.ts`, `enemies.ts`, `projectiles.ts`, `telegraphs.ts`, `titansim.ts`, `bosses/index.ts`, `data/upgrades.ts` (V2 append block), `game.ts`, `testsurface.ts`, `bot.ts`, `probe_sim.ts` (`--meta` + the §0.6 report lines), `_harness/probe_upgrades.ts` (`EXPECT` entries only); `ai/bossview.ts` (export `BossRig` / `LegRig` / `FlashGroup`; the `parkade6` placeholder branch in build, warm-up and pose dispatch); the stub bodies of `titans/titanview.ts` (`faceAnchor`, `setCine`) and `titans/portraits.ts` (`renderPortrait`); the v2 **signatures** (not behaviour) of `ui/menus.ts` `TitleScreen.run` / `PauseMenu.open`, `ui/select.ts` `SelectScreen.run`, `ui/draft.ts` `DraftScreen.open`, `ui/broadcast.ts` `Broadcast.tabloid`. **Not** `ui/dom.ts` (no lane edits it, §2.4) |
| **L1 ULT-SIM** | `meta/ultimate.ts`, `data/ultimates.ts`, `_harness/bot_ult.ts`, `_harness/probe_ult.ts` | none (killXpMul / bossUltHit already wired) |
| **L2 DRAFT/EVO-SIM** | `data/upgrades_v2.ts`, `data/evolutions.ts`, `_harness/bot_draft.ts`, `_harness/probe_evolutions.ts` | `upgrades/draft.ts` (eligibility incl. the `EVO_OF_BASE` rule, lock/evo offer + dedupe, banish/lock, evolutionsReady; `rerollOffer` held-slot rule + `tally.rerolls`; pickUpgrade evo replace + tally), `upgrades/engine.ts` (`ultCharge` execute body), `_harness/probe_upgrades.ts` (v2 coverage rules). L0 already initialises the new `UpgradeState` fields in `createUpgradeState` |
| **L3 BOSS3-SIM** | `ai/bosses/parkade6.ts`, `_harness/probe_boss3.ts` | `data/bosses.ts` (parkade6 entry, final copy), `data/biomes.ts` (**one line**: `grideast.boss`, last step of C1; safe because of L0's placeholder rig, §10.1) |
| **L4 MAP-SIM** | `meta/objectives.ts`, `meta/powerups.ts`, `data/objectives.ts`, `data/powerups.ts`, `_harness/bot_map.ts`, `_harness/probe_map.ts` | none (RED LIGHT and endless hooks pre-wired) |
| **L5 META/ENDLESS-SIM** | `meta/tally.ts`, `meta/endless.ts`, `meta/perks.ts`, `meta/goals.ts`, `meta/profile.ts`, `data/goals.ts`, `data/perks.ts`, `data/palettes.ts`, `_harness/probe_meta.ts`, `_harness/probe_endless.ts` | `core/save.ts` (`loadProfile/saveProfile` bodies) |
| **L6 FX+AUDIO-VIEWS** | `render/ultview.ts`, `render/objectiveview.ts`, `render/powerupview.ts`, `render/markerview.ts` | `audio/sfx.ts` (new event cases + `ui()` kinds), `render/camera.ts` (`punch(frac, s)` method only), `titans/anim.ts` + `titanview.ts` (`ultimate` clip: rear + roar pose, reading `ultFire`) |
| **L7 PARKADE-VIEW** | `ai/foemodels_parkade.ts` | `ai/bossview.ts` (rig registration + `poseParkade` + tow chain draw), `render/projectileview.ts` (`LOOK.carLob` only), `audio/sfx.ts` (PARKADE voice section) |
| **L8 HUD** | `ui/icons.ts`, `ui/abilitybar.ts`, `ui/tracker.ts`, `ui/markers.ts`, `ui/toast.ts`, `ui/hud_v2.css` (imported by `abilitybar.ts`), `data/strings_hud.ts`, `_harness/probe_icons.ts` | `ui/hud.ts` (remove chips column + hook dial; move zoom hint; SHELL bar moves to the ACTIVE panel). Puts the `data-v2` hooks of §13.3 on its nodes. Toasts include the `RESTRUCTURED: <NAME>` evolution toast and the revive toast |
| **L9 SCREENS** | `ui/goals.ts`, `ui/screens_v2.css` (imported by `goals.ts`), `data/strings_screens.ts` | `ui/select.ts` (the row navigation model of §8.4, NEXT PERMIT PENDING slip host, YOUR BEST ON FILE foot, perk row, palette row via `portraitFor`, `G` / pad X → `{kind: 'goals'}`), `ui/menus.ts` (title `G` / pad X + resolves `'goals'`, GOALS & RECORDS chip, pause LOADOUT from `PauseCtx`, settings rows), `ui/draft.ts` (glyph header, banish/lock UI + results incl. the pad-Y hold and the arm guard of §2.4, evolution card, NEW ribbon from `DraftCtx.newIds`), `ui/broadcast.ts` (KEEP GOING + `K`, endless tabloid, NEW ON THE RECORD from `TabloidExtra`, the line 446 boss-name fix). All v2 screen keys are read from `UiPress.key` (§2.4) |
| **L10 CINEMATIC** | `render/cinecam.ts`, `ui/cine.ts`, `data/cine.ts` | `titans/titanview.ts` (`faceAnchor`, `setCine`), `titans/anim.ts` (`cine` channels), `titans/models.ts` (palette param, lids), `titans/portraits.ts` (palette arg), `_harness/bootcheck.py` + `playtest.py` (cinematic-aware: dismiss by key; zebra check on the first play frame) |
| **orchestrator (final)** | — | `README.md`, `_spec/CONTRACT.md` (§16 ownership rows for v2), any cross-lane fix reported as a contract gap |

`game.ts` and `testsurface.ts` are edited **only by L0** (pre-wiring) and the orchestrator. A lane that
finds a missing wire reports a contract gap; it does not edit them.

### 15.3 New probes (node, THREE-free; each exits non-zero on failure)
| Probe | Lane | Asserts (summary; details in the lane's section) |
|---|---|---|
| `probe_ult.ts` | L1 | prints the R table from the merged config (§3.1); R formula; ≥ 90 % non-elite kills inside 0.9 R at Size I and V for all 4 titans; roar invulnerability (0 damage taken, `dot` hazards and active telegraphs included) and the 30 % move from the fire tick; **hostile non-boss projectiles and unfired enemy telegraphs inside R deleted at roar end, boss-owned ones untouched (counts before/after)**; boss −6 % exactly and meter +0.30 exactly; per-fire XP ≤ the cap; ≤ 6 bank pickups per tick at a Size V fire (the §4.7 spike bound); charge cadence median in 30–65 s per rank band; time to first readiness; median boss-fight length 70–170 s with UPROAR in use (all 3 bosses); determinism |
| `probe_evolutions.ts` | L2 | every recipe ready → offered (chest slot 0, or slot 1 behind a held card; level-up slot 2, one 0.2 draw only when ready); evo replaces base; stats ≥ maxed base; **after evolving, the base is never offered again and `evolutionsReady` never lists an owned evo** (re-take cases); lock dedupe (held id also rolled → re-rolled), reroll keeps the held slot, banish empty refill (offer shrinks; last card refused); banish/lock charges and refunds; `tally.rerolls`; unlock filter (fresh excludes, full includes); **no evo ready ⇒ exactly the pre-v2 `rng.loot` draw count** |
| `probe_boss3.ts` | L3 | §10.2 acceptance, including the till-share (≥ 35 % while open, MOLO and VOLT-KITE) and the `findTarget` geometry unit test |
| `probe_map.ts` | L4 | placement bands and tiers (Size I props, Size II+ buildings; every biome places an OVERLOAD SITE in Size I on 5 seeds), payouts (XP as one scrap pickup, collected next tick with level-up procs firing), expiry and the state sweep (a boss-crushed site expires, never sticks), per-biome medians (OVERLOAD 5–12, ANNEX = breaches reached), **a site collapsed by a trigger shockwave pays out that tick; a trigger kill can drop a power-up**, power-up drops (median 4–12, gap, cap), RED LIGHT freezes enemies/enemy shots/enemy paint but not the boss, DEMOLITION (banked pickups ≤ 6 per tick), determinism |
| `probe_meta.ts` | L5 | ≥ 30 goals, unique ids and names; 44 unlock items each referenced once; profile sanitize fuzz (corrupt JSON, wrong types, huge numbers); `applyRunToProfile` idempotent; `nextUnlock` ranking; tally vs a scripted event run; **goal reachability on seed 1337 (§8.2)**; SIX-WAY SPLICE / FULL BLOOM exclusions; HAIRLINE counts the city fight only; perk rank bands (4 titans × 6 perks); STAY OF DEMOLITION revives once and blocks `dot` for 2 s |
| `probe_endless.ts` | L5 | §9.3 |
| `probe_icons.ts` | L8 | every card maps to an existing glyph; the bar ordering rule on synthetic `owned` sets |

### 15.4 Gates each lane must pass (paste the command and the output tail in the report)
| Gate | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` → 0 errors | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| own probe(s) exit 0 | ● | ● | ● | ● | ● | — | — | ● | — | — |
| `node _harness/probe_sim.ts --det 2` → `GATE 2: PASS` (`--meta fresh` **and** `--meta full`) | ● | ● | ● | ● | ● | — | — | — | — | — |
| lane probes `for p in ai city combat econ titan upgrades; do node _harness/probe_$p.ts; done` exit 0 | ● | ● | ● | ● | ● | — | — | — | — | — |
| scratch preview + harsh self-critique of its own shots (CONTRACT §0.5) | — | — | — | — | — | ● | ● | ● | ● | ● |
| `python _harness/bootcheck.py --titan T --biome B` (all 12) | — | — | — | — | — | ● | ● | ● | ● | ● |
| `python _harness/playtest.py --matrix` (real keys) | — | — | — | — | — | ● | — | ● | ● | ● |
| shots added to `_harness/shots.py` and captured | — | — | — | — | — | ● | ● | ● | ● | ● |
| `python _harness/perfcheck.py` — **run by the orchestrator, ALONE**, after each of C2, C3, C4 | | | | | | ● | ● | ● | | ● |

**Real-input v2 playtest (`_harness/playtest_v2.py`, new).** Written by the **orchestrator after C3**
(so no C3 lane shares a harness file), reusing `common.py`; run after C3, after C4 and in the final
battery. Cheats only set up state; every action is a real key, pad button or walk. Steps (each asserts
the named state or DOM read, §13.3):
1. Title: real **G** → the goals screen is up (`screen`), real **Esc** → title. Select: real **G** →
   goals, **Esc** → back on the same step and titan.
2. Play: cheat `ult(100)`; real **E** → `v2.ult.fired ≥ 1` and the sim advanced ≥ 60 ticks after.
3. Power-up walk-in: cheat `powerup('rushHour')` (3 H ahead); hold real **W** until
   `v2.tally.powerups.rushHour` goes up (fail after 6 s).
4. Objective walk-in: cheat `objective('reliefDepot', 3 H ahead)`; hold **W** → `objectiveDone` seen
   (`v2.map.reliefsDone` + 1). Cheat `objective('overloadSite')` at Size I (a prop site 2 H ahead);
   hold **W** + attack keys → `v2.map.overloadsDone` + 1 within 15 s.
5. Draft: open a level-up draft; real **X** → `v2.draft.banishLeft` − 1 and the offer changed; real
   **C** → `v2.draft.locked` set; pick with **1**.
6. Clear → tabloid; real **K** → `v2.endless !== null`, `run.phase === 'endless'`, the sim advances.
7. Profile persistence: meet a goal (cheat the tally to one short of FIRST BROADCAST, then finish a run),
   `location.reload()`, and `v2.profile.done` still contains `g_first_broadcast`.
8. HUD DOM vs state: `v2dom.barSlots` = min(10, owned non-perk cards); each `barBadges` entry matches
   the stacks rule (§4.3) for `state().upgrades`; `activeCdText` = `ceil(titan.abilityCd)` + `s` or
   `READY`; `meterPct` = `round(v2.ult.charge)` ± 1.
9. **Gamepad**: stub `navigator.getGamepads()` with a standard-mapping pad (the harness injects it
   before load); press pad **Y** in play → `ult.fired` + 1; in a draft **hold Y 0.6 s** → a banish,
   **tap Y** → none; **LB** → a lock; pad **X** on the title → goals.
10. Settings: `Opening: OFF` → the legacy slate appears (`screen === 'slate'` with the freeze-frame
    DOM); `SHORT` → the cinematic's `v2.cine.shot` sequence lasts ≤ 3.2 s; `Reduce motion` on → no
    `crane` shot in the sequence.
11. Cinematic dismissed with a real key; the first play frame passes the existing zebra check (L10).

Perfcheck scenarios: (a) today's Size V + 250 enemies, plus 3 objectives, 3 power-ups and one UPROAR
fired inside the measurement window; (b) PARKADE-6 fight + 150 enemies. Both need **p99 ≤ 22 ms,
≤ 450 draw calls**, and scenario (a) **also reports the p99 over the UPROAR window alone** (fire to
`ultEnd` + 0.5 s), which must meet the same 22 ms. The per-lane main-thread budgets of §4.7 are measured
with `frameprof` marks in scenario (a) and printed per lane; a lane over its budget is a failed gate
even when the total p99 passes (the headroom today is 0.2 ms). Shots battery additions: `ult_<titan>_s1`, `ult_<titan>_s5` (8),
`obj_markers_s1/s3/s5`, `powerups_s3`, `abilitybar_1280`, `abilitybar_1920`, `draft_evo_banish_lock`,
`goals_screen`, `select_next_unlock`, `parkade_intro/ramp/barrier/tow/deckdrop/collapse/till_open/jammed`,
`cine_<biome>_s1/s2/s3` (9), `tabloid_endless`. The orchestrator runs the final visual critic pass on
them.

### 15.5 Definition of done (v2)
All §15.4 gates pass as observed, run by the orchestrator in one final battery on a `BT_FROZEN=1`
server: `tsc` 0; GATE 2 PASS fresh + full (with the §0.6 lines and deaths ≥ 1); all 13 probes (6 old +
7 new) exit 0; bootcheck × 12; playtest --matrix; **playtest_v2 (all 11 steps)**; leakcheck (newRun × 7 returns to the same geometries, textures and programs, now
including the new views); blankprobe; perfcheck (a) and (b) alone; shots + critic. README gains
controls (E, X, C, G, K), the new screens, URL params and test-surface fields.

---

## §16 Owner decisions still open (the defaults above are what gets built unless the owner says otherwise)
1. **UPROAR on E / pad Y (and RT).** Q is also free if the owner prefers it.
2. **The upgrade-chips column is retired in play** in favour of the ability bar plus the objective
   tracker; full names move to the pause LOADOUT.
3. **UPROAR does not damage buildings**, to protect the level-driven pacing. Alternative: props only,
   with loot × 0.5 (needs a small citysim hook).
4. **Perks are small** (§8.5) and each is GATE-2-checked. HEAD-START-style level perks were rejected
   for pacing.
5. **PARKADE-6** (a walking multi-storey car park) as the GRID-EAST boss concept.
6. **Cinematic**: full on the first run of each titan × city, short afterwards and on retry; OFF in
   settings restores the freeze-frame slate.
7. **KEEP GOING** is a fourth button on the clear front page; default focus stays on RETRY.

---

## Review log (revision 2, 2026-09-24)

Every finding of the independent review, in the review's order, with its resolution. "Kept" marks a
finding where the rev-1 design stays, with the reason.

### Blockers
| # | Finding | Resolution |
|---|---|---|
| B1 | PARKADE-6's TILL (0, 0, r 6, inside the body) can never be targeted: planar `nearestBossPart` and the AoE split make the body, booth or arm always win | **Fixed (§10.2).** The till part is rewritten every tick: stowed in the booth when closed (0, 30, r 4, strain 0); when open a drawer slides out **in front of the booth** (0, 43, r 8, hpMul 2, strainMul 4). The rig turns its booth toward the titan (and holds facing at half turn rate while the till is out), so the open till is the nearest part surface for a titan within ±25° (55 m) to ±41° (130 m) of the booth's facing, computed with the exact `nearestBossPart` rule over the part table. The arm's hit part moved to its pivot housing (9, 35, r 4), because at (14, 40, r 6) it cut the arm side to ±9°. `probe_boss3` adds a till-share assertion (≥ 35 % of titan damage on the till while open, MOLO and VOLT-KITE) and a `findTarget` geometry unit test. The reviewer's "behind the rig" option was not taken: the rig faces the titan, so a rear till would be the farthest part |
| B2 | `stepObjectives` / `stepPowerups` ran before `processTriggers`, so proc collapses and proc kills were never seen | **Fixed (§2.3).** Both now run after `processTriggers` and before `chargeUltimate`; `stepObjectives` also sweeps state (a collapsed or dead bound target without a credited event expires the objective). OVERLOAD XP is paid as a scrap pickup collected next tick, so level-up procs still fire. `probe_map` adds the trigger-shockwave and trigger-kill cases |
| B3 | `CineShot`, `CinePlan`, `FaceAnchor`, `CineBiome`, `ParkadeRig` undefined; changed UI signatures missing; `play()` union vs `'unsupported'` | **Fixed (snippet APP-SIDE section, §2.6, §11, §13.1).** All Cine* types, `CamPose`, `CineChannels`, `CineInfo`, `CineCamApi`, `CineOverlayApi`, `TitanViewAdd`, `RenderPortraitFn`, `SelectRunOpts` / `SelectResume` / `SelectResultV2` / `SelectScreenApi`, `DraftCtx` / `DraftResultV2` / `DraftScreenApi`, `TabloidExtra` / `TabloidChoiceV2` / `BroadcastAdd`, `PauseCtx` / `PauseMenuApi`, `TitleScreenApi`, `GoalsScreenApi`, `NextUnlockPanelApi`, and the HUD APIs are defined; `ParkadeRig = BossRig` (L0 exports `BossRig`). `play()` resolves `'done'`, `'skipped'` or `'aborted'`; the fallback is decided earlier by `CineCam.plan()` returning null. The snippet typechecks (command in its header, exit 0) |
| B4 | v2 screen bindings were put in `core/input.ts`, which modal screens never read; pad Select and pad Y collide | **Fixed (§2.4, snippet `UI_BIND`).** Only `ultimate` is a `core/input.ts` Action. Screen bindings are read from `UiPress.key` in the screen module (`'x'`, `'c'`, `'g'`, `'k'`, `'pad:3'` hold, `'pad:4'`, `'pad:2'`), checked against `mapKey` and `PAD_MAP` in `ui/dom.ts` (X/C/G/K unmapped; pad 2 = `reroll`, ignored by title and select; pad 4 unmapped). `ui/dom.ts` is not edited by anyone. Pad Select (8) stays back, pad Y stays alt/confirm on title and select. Pad BANISH is a 0.5 s hold with a 0.6 s arm guard, so mashing Y from play cannot banish |
| B5 | Reference copy on screen: "YOUR NEXT UNLOCK", "Best run: …", "All goals", the "CHARGED" burst; reference intro composition | **Fixed (§0.7, §1, §3.1, §3.6, §8.4, §11).** Copy is now **NEXT PERMIT PENDING** (a tilted manila permit slip on the lore column, not a full-width strip), **YOUR BEST ON FILE: LV n · SIZE r · m:ss** (on the focused card's foot, in the game's existing "ON FILE" voice), **GOALS & RECORDS [G]** (a chip in the confirm bar). No text over the titan; the ready state is the meter's **UPROAR READY**, and the titan's burst word sits beside the meter. The cinematic has no letterbox, no top-corner tabs and no street sign in a third: a camcorder viewfinder, a bumper-level S1 past a parked toy car, a low three-quarter S2, and the game's existing slate lower third. §0.7 lists every reference element that may not appear |

### Major issues
| Section | Finding | Resolution |
|---|---|---|
| §10.2 | TILL geometry; y spans irrelevant; hpMul/strainMul has no path | Same as B1 (the y spans are now stated as view-only) |
| §2.3 | tick order | Same as B2 |
| §2.6 / §13.1 | app and UI signatures (a)–(g) | Same as B3. (f) portraits: the select screen calls the app-provided `SelectRunOpts.portraitFor(titan, palette)`, which `game.ts` (L0) implements over `renderPortrait` (L0 stub, L10 body), so L10 never edits `game.ts`. (e) LOADOUT reads only `PauseCtx.w` |
| §2.4 / §7.5 / §8.4 | wrong input layer, pad collisions, select navigation, Y mash | Same as B4, plus the **select row model** (§8.4): ←/→ act on the focused row (cards as today), ↓ enters the palette/perk row, ↑ returns; the harness's ←/→ path is unchanged and L9 re-runs `playtest --matrix` |
| §1 / §3.6 / §8.4 | originality of copy and cinematic framing | Same as B5 |
| §7.3 / §7.4 | a taken evolution makes its base offerable again and the evo ready twice | **Fixed (§7.1, §7.3, snippet).** `isEligible` refuses a base whose evolution is owned (`EVO_OF_BASE`); `evolutionsReady` requires `owned[evo] === 0`; both cases added to `probe_evolutions` |
| §5.2 / §5.3 | no tier-0 buildings exist, so no Size I SURGE NODE | **Fixed (§5.1–§5.3).** Size I OVERLOAD SITES bind to static **props** (tier-1 buses, trucks, containers first, then tier-0 props; plentiful on seed 1337); Size II+ binds to buildings at `canFlatten` (hundreds of tier-1 buildings exist). Rev 1's "7–10 per run" is withdrawn; `probe_map` measures the counts and asserts a median of 5–12 and that every biome places a Size I site. SURGE NODE is renamed **OVERLOAD SITE** (it collided with GRIDLOCK SURGE and Surge Protector) |
| §3.1 / §3.5 / §5.5 / §14 | stale R table; stacked XP, heal and boss-HP sources threaten both GATE 2 legs; isolated tuning; "screen-clearing" false at zoom 2 | **Fixed.** The R table is recomputed from the growth workflow's in-flight config (Size I 28.5 m = 23.8 H … Size V 271 m = 4.5 H) and marked illustrative; `probe_ult` prints it from the merged config. Pacing no longer depends on R: a **per-fire XP cap** (50 % of the current level's need) plus the 0.5 XP multiplier. The orchestrator runs the **combined GATE 2 (fresh and full) after C1 and after C2** (§0.6, §15.1). GATE 2 gains XP-share lines (UPROAR bank, OVERLOAD, DEMOLITION kills) and a **deaths ≥ 1** check; §14 lists the heal sources with their knobs. Boss fights are checked for 70–170 s with UPROAR in use; the first knob is `ULT.bossCapFrac`. "Screen-clearing" is now defined against the auto framing (zoom 1); at zoom 2.0 it covers about the central half, by design |
| §15.4 | frame time binds (p99 21.8 of 22 ms); conic sweep repaints; full-screen layers; Size V UPROAR one-tick spike | **Fixed (§4.4, §4.7, §15.4).** Per-lane main-thread budgets (views ≤ 0.3 ms, PARKADE rig ≤ 0.3 ms, HUD DOM ≤ 0.2 ms), measured with `frameprof` marks; at most 2 full-screen CSS layers live, opacity/transform only; the cooldown sweep is two masked half-discs rotated by transform, with text at ≤ 10 Hz; kills during UPROAR and DEMOLITION **bank** into ≤ 6 merged pickups per tick; perfcheck (a) reports the p99 over the UPROAR window separately; L0 records a post-growth perf baseline, and the first recourse is view quality tiers, never a raised budget |
| §15.1 | the 8-agent plan puts L10 in C3 with L6 on `anim.ts` / `titanview.ts`; L3's biome flip lands before L7's view | **Fixed / kept (§15.1, §10.1).** The merged L9+L10 agent does L9's part in C3 and L10's in C4. **Kept:** L3 still flips `grideast.boss` at the end of C1, because GATE 2 must measure GRID-EAST with its real boss; L0 now adds a `parkade6` placeholder rig in `bossview.ts`, so no browser gate between C1 and C2 can render IRON GULLY or crash (and no C1 lane runs a browser gate) |
| §15.4 | no real-input checks for K, walk-ins, reload persistence, DOM vs state, gamepad, settings; projectile deletion unasserted | **Fixed (§13.3, §15.3, §15.4).** New `_harness/playtest_v2.py` (orchestrator, after C3) with 11 real-input steps: G/Esc, E, power-up and objective walk-ins, X/C in a draft, **K** on the clear tabloid, the profile surviving `location.reload()`, `v2dom` slot/badge/cooldown/meter reads matched to state (fixed `data-v2` hooks that L8 must add), a stubbed standard gamepad (Y, hold Y, LB, pad X), Opening OFF/SHORT and Reduce motion. `probe_ult` asserts projectile and telegraph deletion |
| §9.1 | KEEP GOING leaves the sim frozen (`ending`); `spawnBoss` overwrites `'endless'`; rematch damage has no hook | **Fixed (§9.1, §2.7, snippet `ModEndless`).** The flow resets `ending`, `endResult`, `endT`, `hitStopT`, `sizeUpHoldT`, `timeScale`, the input buffer, the draft flags and `modal`, then calls `enterPlay()` (which sets `input.mode = 'game'`). L0 pre-wires `spawnBoss` to keep `'endless'` and `bossHostile × endlessBossDmgMul(w)`; `stepEndless` re-asserts the phase |

### Minor issues
| Section | Finding | Resolution |
|---|---|---|
| §3.1 / §8.5 | roar invulnerability not pre-wired; `iframeT` does not cover `dot`; the 30 % move has no mechanism and misses the first tick | **Fixed.** `ult.invulnT` is checked first in `hurtTitan` (L0 pre-wire, covers `dot`); `ultMoveMul` is read in `stepTitan`; `stepUltimate` runs **before** `stepTitan`. STAY OF DEMOLITION's 2 s uses the same timer |
| §2.1 / §2.7 | a required `TitanInput.ultimate` breaks 23 literals; `probe_upgrades` EXPECT missing | **Fixed.** `ultimate?: boolean`, read as `!!input.ultimate`; `probe_upgrades.ts` EXPECT is in the §2.1 records table and in L0's ownership row |
| §2.7 / snippet | `bossUltHit` body-only vs "spread like damageBoss" | **Fixed.** Body-only and exact in both places: `min(frac × maxHp, hp)` credited to `parts[0]`; kind multipliers, part multipliers and the stagger ×2 are ignored; the meter gains exactly `meter` |
| §7.4 / §7.5 | lock duplicates, slot index ambiguity, reroll with a lock, empty banish refill, `tally.rerolls` source, NEW flag owner | **Fixed.** 0-based slots everywhere (held card → slot 0; chest evo → slot 0 or 1; level-up evo → slot 2); a duplicate is re-rolled once; reroll keeps the held slot; an empty refill shrinks the offer and the last card cannot be banished; `rerollOffer` (L2) increments `tally.rerolls`; `game.ts` (L0) calls `markSeen` + `saveProfile` when it opens a draft |
| §8.2 | COLD STORAGE seed-dependent; SIX-WAY SPLICE trivial after an UPROAR; 6 ult blooms vs cap 4; HAIRLINE counts rematches | **Fixed.** COLD STORAGE = 60 % of the district's tier-4 buildings (`tier4CollapseFrac`, `tally.tier4Total`); ult-laid wires are excluded from `wiresBest` (`ultWireUntilT`); the decree plants `turretCap` blooms through the normal cap, and `wild` blooms never count toward FULL BLOOM; `staggersBestFightBy[boss]` counts the city fight only; `probe_meta` asserts goal reachability on seed 1337 |
| §1 | name collisions; goal toasts overlapping the broadcast toast | **Fixed.** Pothole Patch → **Manhole Lid**; goal NIGHT SHIFT → **EARLY CLOSING**; goal RESTRUCTURED → **CHANGE ORDER**; goal EXTENDED COVERAGE → **STILL ON AIR**; SURGE NODE → **OVERLOAD SITE**. The v2 `Toasts` stack sits below the broadcast toast slot, checked in the `abilitybar_*` shots. **Kept:** RELIEF DEPOT and the card Pressure Relief Valve share only the common word "relief" (a map objective vs a card) |
| §4.3 | `evolution` tag has no family colour; no till glyph | **Fixed.** Evolutions take the base card's family colour from `tags[1]` and are told apart by the frame; `probe_icons` checks that every tag in use maps to a colour. New glyph **`till`** (58 glyphs) |
| §11 | the cinematic abort path leaves CineCam and the overlay alive; near/far clipping | **Fixed (§11.1, §13.1).** `closeScreens`, `dismiss` and every epoch change call `cineCam.stop()` and `cineOverlay.clear()`; `CineCam.start` sets `plan.near` / `plan.far` and restores the rig's clip planes at hand-back or stop |

### Evidence used in this revision (tool output, 2026-09-24)
* Part geometry: `bosses/index.ts` 185–210 (`makePart`; parts re-projected from `ox/oz` every tick),
  `combat/targeting.ts` 37–48 (`nearestBossPart`, planar surface distance), `damage.ts` 254–270 (AoE
  split), `bosses/index.ts` 369–381 (`keepRange` turns the boss toward the titan). The till windows come
  from a scratch script applying that rule to the §10.2 part table.
* Input: `ui/dom.ts` 242–264 (`mapKey`, `PAD_MAP`) and 231–237 (`UiKeysOpts.onFrame`, `armMs`),
  `ui/menus.ts` 143, `ui/select.ts` 136–140, `ui/broadcast.ts` 408–410, `_harness/common.py` 690–720.
* App flow: `game.ts` 900–1060 (`resetRunState`, `closeScreens`, `runSlate`, `enterPlay`, `beginEnding`).
* Names: `grep -ril` over `src/` for manhole, change order, still on air, early clos, overload, permit
  pending, best on file, goals & records, uproar ready → 0 hits each ("on file" is existing house copy).
* Snippet: `npx tsc --ignoreConfig --noEmit --strict … _spec/features_v2_types.ts` → exit 0.
