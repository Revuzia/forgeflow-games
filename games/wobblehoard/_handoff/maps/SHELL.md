# SEAM MAP: SHELL lane (src/shell, src/ui, src/input, core/settings.ts, index.html, shell harness), for PLAYGROUND

Read-only analysis, 2026-11-15, tree at HEAD 5c747018 plus the SHELL-4 engineer's uncommitted `_harness/browser_shell.mjs` (the only
modified file in `git status`). Line numbers are for that tree and will drift as SHELL-4 lands. I ran nothing heavy: no tsc, no probes,
no browser. Everything below comes from reading the code and the reports.

## Summary
- **One frame, one function.** `game.ts simStep` (548-562) runs gestures, then the driver, then `bodies.step` (collide, then step),
  then drain, timers, feedback, cut, capsules, ceremonies, then the `onStep` hooks. `present` (564-570) runs after it. The rAF loop and
  `DebugHook.step` both go through `simStep`, so anything put in there is deterministic under the harness for free.
- **A LIFE host fits in two places.** Its brains step after `drain()`, where they can see this frame's events. Its intents (hop, lean,
  look) are applied just before the next `bodies.step`. Emotes and voices go out through one attention budget owned by the shell. The
  cheapest first version is a `game.onStep` hook (561). It is deterministic, but its intents land one frame late.
- **Bodies.** There is one play body plus `extras` (`bodies.ts` 32-36, 92). The mat squishies and the cut pieces are both extras
  (`piece: true` marks the pieces). The limits: mat 3/4/5 by quality, pieces 4/6/6. A cut empties the mat first (`cut.ts` 244-247), and
  every ceremony empties the mat (`game.ts` 381). So today a party and pieces never exist together, and a party does not survive opening
  a capsule.
- **Typed game events are thin.** `ShellEvents` (`game.ts` 139-160) has no event for "brought out", "met", "used a thing", "visited",
  "tossed", "landed after a toss" or "photo saved". Its `cut` event fires only for a swipe (650). `'joined'` is declared (159) but never
  emitted. A quest host needs a new, typed, allocation-light event bus.
- **The free HUD space on a 390 x 844 phone** is the top row between the wordmark and the mute and gear buttons (about 90 px), the right
  edge between the top bar and the meter ring, and nothing else. The bottom row is full (name tag | Hoard, Toys, mat chip | ring).
- **Build new screens on `theme.ts` tokens and `h()`, through the CSSOM only.** `_spec/UI.md` will replace the literal radii, shadows,
  sizes and glyphs. Do not copy the per-screen literals in `styles.css` / `hoard.css`.

## 1. The frame order, and where LIFE plugs in
`frame(ts)` (`game.ts` 572-588):
1. Pause gates. Any `reasons` (hidden, context, covered) returns with no step (573). `clock.paused` (debug pause) only renders (574).
2. dt is clamped to `TUNING.maxDt` (582). The fps EMA is updated.
3. `simStep(dt)` (548-562), in this order:
   a. `gestures.update(clock.now())`: the gesture machine's timers (tap / press / pull commit).
   b. `driver.flushPendingUps()`: delayed finger-ups.
   c. `bodies.step(dt)` (`bodies.ts` 171-175). First every contact body calls `collide(others)` (172, one call per body, from lists
      rebuilt only when the mat or the play body changes: 96-102). Then the play body steps, then each extra.
   d. `simTime += dt`, `stepCount++`, then `driver.notePress()`.
   e. `drain()` (541-546). For each body, `drainEvents` goes into a preallocated buffer, then the 32-slot debug ring, then
      `feedback.handle`, then `collection.feed` (533). The gain cue is computed only when someone listens (532). Then `feedback.sweep()`.
   f. `timers.run(simTime)`: sim-time one-shot timers (`clock.ts` 415-445).
   g. `feedback.update(dt)`: held voices, strands, lift detection.
   h. `cut.update(dt)`: neck and join timelines, the touch-to-join check, chunk steering.
   i. `capsules.update()`, then `ceremonies.update()` (a queued ceremony starts once the 1 s burst spacing has passed).
   j. `stepHooks` (561), in insertion order, each guarded.
4. `present(dt)`: `stage.update(dt, frameInput)` (eyes follow `pointerNdc`), then `stage.render()`.

**Where a LIFE host goes** (the designers choose; the shell builds it):
- *Sense and decide* right after `drain()` (between e and f). The world snapshot is filled in place from `bodies.body` and
  `bodies.extras`: centres (for an apart extra, add `xb.position`, 516-545), `metrics.fingers / grabbed / carried`, the piece flag, and
  this step's `bump` / `land` events (copied into the host's own ring while draining).
- *Act* at the top of the next `simStep`, after `driver.flushPendingUps()` and before `bodies.step` (between b and c). Intents become
  `nudge` / `moveTo` / a future `hop`, so the physics integrates them in the same step.
- *Express* (emote bubbles, voices) through the shell's attention budget (D4). Render and audio calls are made here, never from `src/life`.
- First version: `game.onStep(fn)` (831). It runs after everything, inside both rAF and `DebugHook.step`. The cost is one frame of
  latency, which is invisible.

**What the host must never do:**
- **Allocate per frame.** `emit()` uses rest arguments (283-286, `...a`), so firing a `ShellEvent` allocates: never emit per frame.
- **Block.** No sync storage writes per frame; persist journal and friendship progress through the collection's batched save.
- **Fight a finger.** `driver.touch.contact()` (`driver.ts` 100) covers only the *active* body. For every other body read
  `metrics.fingers > 0 || metrics.grabbed || metrics.carried`.
- **Touch the brain-free cases.** The brain is off while `!game.input.live` (`game.ts` 605: no ceremony, hold or pause), while cut
  `busy`, and while the Snap or Cut tool is in hand (decision needed).
- **Use the finger API.** Never call `fingerDown` / `grab*` for autonomy. Those make `poke` / `release` / `snap` events, and
  `collection.feed` pays `release` and `snap` (`meterfeed.ts` 43-65), which would be idle income.
- **Fight `moveTo`.** It already has owners: cut steering (`cut.ts` 194-215) and join flows call `moveTo(null)`, which would cancel a
  brain's target. One arbiter is needed, with the priority finger > cut / ceremony > LIFE.

## 2. Bodies: who owns what, ids, limits, picking
- **Play body.** `bodies.body` with `identity {genome, tier, itemId, nickname}` (`bodies.ts` 17-24). `swapTo` builds the new body first
  and then commits it atomically (125-131). `adopt` takes a ceremony's result body (132-134). Every swap runs `beforeSwap` (which calls
  `releaseEverything`) and `afterSwap` (`game.ts` 361-371: gravity, float mode, the ring cleared, `feedback.resetBody`, `identity` emitted
  unless `silent`).
- **Extras.** `ExtraBody {id, body, genome, tier, itemId, position, shared, piece?}` (`bodies.ts` 32-36). `id` is the *stage view id*,
  and it changes when the body is re-added (`placeExtras` 151-159, and `setBody` re-shows all of them, 112-115). There is no stable id. A
  LIFE host must key its brains by `SoftBodyLike` object identity, or by the `itemId` of a mat squishy, never by the view id.
  - `shared`: the extra lives in the play body's world space and collides. It is built `at` its spot (`mat.ts` 290-296, and
    `boot.ts` 111-112 turns `at` into `PieceOpts {frac:1, chunk:false, at}`). Apart extras simulate at their own origin and are drawn
    offset.
  - `piece`: a chunk of the play squishy (`cut.ts` 291-305). Piece 0 (the face piece) *is* the play body.
- **Who creates and removes bodies.** `mat.ts` (add / remove / clear, 284-319), `cut.ts` (part / joined / whole), `ceremonies.ts`
  (adopt) and `game.ts` (switchTo / setGenome / focusInstance). Nothing else. A party manager must be one more such owner, inside `src/shell`.
- **Limits.**
  - `MAT_LIMIT` low 3 / med 4 / high 5, the play body included (`mat.ts` 199). The pieces count against it (280).
  - `MAX_PIECES` low 4 / med 6 / high 6, `PIECE_MIN` 1/8 (`cut.ts` 38-40).
  - The frame-time guard: `FRAME_BUSY_MS` 30 against `stage.stats().frameMsEma`, checked only when at least one extra is already out
    (`mat.ts` 201, 281). The harness lifts it with `shell.matBusyMs`.
  - The stage's auto quality drops a tier above about 24 ms (`contracts.ts` setQuality doc). **Nothing trims the mat when the tier
    drops.** `limit` is read live, but only `add` checks it.
- **How a press picks a body.** `pickBody` (`game.ts` 445-458) runs only when extras exist, no gesture is active and nothing is
  touching (617). It casts one camera ray against the play body and every extra and takes the nearest hit. A miss keeps the last active
  body. While a touch lasts, the fingers stay on that body. `host` maps screen space into the active body's space (340).
- **What feedback assumes.** Feedback reads `activeBody` / `activeGenome` (351). So a `bump` or `land` on a non-active body is pitched as
  the active one ("close enough for a thud", 514-515), and lift / toss follow only the active body (`feedback.ts` 10-14). A social
  scene needs per-body pitch, so the event source must be passed into `feedback.handle`.
- **What a party in a place needs beyond today's mat:**
  1. Stable character ids, and a brain table keyed by them.
  2. A layout that belongs to the place, not only `stage.matLayout(n)` (`mat.ts` 254-261), plus walking room. The "home spot" is a
     corral in the physics (`cut.ts` 24-25): a body built at a spot stays tied to it.
  3. Party plus pieces at once. Today a cut clears the mat (`cut.ts` 244). This rule must be re-specified, with a combined character
     cap.
  4. Surviving a ceremony (`game.ts` 381 clears the mat) and a Hoard card preview: re-place the party after the ceremony ends (386).
  5. Trimming on a quality drop, and sleep-aware cost (D7), instead of the 30 ms refusal alone.
  6. Per-body feedback identity (pitch, pan, the event source).
  7. Brought-out and put-back events that carry the `itemId`. Today there is only `mat.onChange(fn)`, with no payload (320).

## 3. How the overlays gate each other, and what new screens need
- **Input gates.** `inputLive` = phase play, and no pause reasons, no `holds`, no ceremony (605).
  - `holdInput(reason, on)` (819-822) holds pointer input but **the sim keeps running**. Its one user today is the Hoard, while the shelf
    is open and no card is up (`hoardEnv.ts` 113, `panel.ts` 527).
  - `suspend('covered')` pauses the sim and the audio. It is used by the phone Hoard sheet (`panel.ts` 526).
  - Ceremonies consume taps (613) and queue behind each other with `BURST_SPACING_MS` 1000 (`ceremonies.ts` 30, 102-119). The Hoard
    waits for them with `whenIdle` / `busy` (`hoardEnv.ts`).
  - A switch asked for during a ceremony is queued (`pendingSwitch`, 687-692, 807).
- **Leave paths.** Any leave calls `leaving()` (425-428), which releases everything and reconnects instantly. These are: a ceremony
  start (381, which also sets the Hand tool and clears the mat), a switch, a card preview, and a tab hidden more than 60 s (814). The
  Hoard's `beforeOpen` calls the *animated* reconnect on desktop (`hoardEnv.ts` 106-110).
- **Tools.** `setTool` (429-440) releases everything. Snap puts the capsule away. Cut and Snap bypass the gesture machine entirely
  (614-615). The toy tray holds no input. It sets `body[data-toys=open]`, which hides the quick switcher and the hint (`hoard.css` 316,
  381).
- **The Escape order** (`hudBinding.ts` 375-381): tray, then Settings, then Hoard, then the tool back to the Hand, then the plate.
- **Snap hides by CSS list** (`hoard.css` 392-393): `.hud .plate .toast .sparks .net-banner .play-target .toys`. Every new DOM overlay
  (tracker, bubbles if they are DOM) must join that list, or the designers decide it shows in photos (a 3D bubble would).
- **Fitting the new screens:**
  - **Travel.** A full sheet, like the phone Hoard: `suspend('covered')` on a phone, `holdInput('travel')` on desktop. Never during a
    ceremony (use `whenIdle`). It calls `leaving()` and keeps the party (party re-placement in the new place). One HUD button. The
    bottom-centre slot (`hud.slot`, `hudBinding.ts` 87) is already three items wide on a phone, so put it in the Toys tray or in the top
    row.
  - **Journal.** The same sheet pattern as the Hoard (z 7, `hoard.css` 44-45). Free key **J** (used: Space, Enter, Esc, [ ] T C H G M,
    arrows, + and -; `keyboard.ts` 67-122). Insert it into the Escape chain before the Hoard.
  - **Quest tracker.** One pill in the top row between the wordmark and the actions (about 90 px free at 390 px; the wordmark is
    clamp(15px, 4.4vw, 22px) with .14em tracking, `styles.css` 78-80), or right-aligned under the top bar. Careful: the reveal plate
    (top +70 px, z 5) and the offline banner (top +64 px) are both centred. Keep the tracker inside `.hud-top` so `reportInsets`
    (`hudBinding.ts` 121-142) still measures it for `setSafeInsets`.
  - **Wish bubbles.** In 3D, or as DOM placed from `host.bodyScreen()`-style projection (the play target does this every 250 ms, 330).
    They must slide clear of the capsule like the hint pill does (`avoidCapsule`, 337-357, using `g.capsules.screenPoint()`).
  - **Quest-complete moment.** It must queue like a ceremony: never within 1 s of a burst, never over a reveal. Reuse the plate slot (top
    +70 px) after the plate has gone (`PLATE_MS`), and say it once through the single polite live region (`announcer.ts` 15). The toast
    (bottom +24 px, z 15, 3.2 s) collides with the hint and the bottom row on a phone.
- **Free HUD slots on a 390 x 844 phone:** the top row centre and the right edge between the top bar and the meter. Taken: above the
  name tag (quick switcher, bottom +86 px, up to 5 x 44 px, four under 359 px), the hint (bottom +92 px, +146 px with the switcher),
  the Cut bar (bottom +84 px).

## 4. Events into the collection, and where a quest host listens
- **Path.** `drainBody` sends each `SoftEvent` to `collection.feed(ev, epochNow())` (533). Shift-pull twins are skipped (527-529). The
  collection maps only poke, release (held at least the minimum) and snap (`meterfeed.ts` 43-65). `bump` and `land` pay nothing.
- **Tasks** are counted inside the collection from the same feed. `TASK_DEFS` metrics are only `stretch | softPops | pokes | squeezes |
  medleys | snaps` (`drops.ts` 118-139). `profile.bump(stat)` counts `pokes / squishes / pulls / releases` (`feedback.ts` 35, 122-169).
- **Shell to collection port.** `PortEvent` is only `capsule | notice | external` (`collectionPort.ts` 55-58).
  `collection.onChange` re-reads the meter (400, 465).
- **Typed game events today** (`ShellEvents`, 139-160): interaction, settings, identity, mute, phase, meter, capsuleReady, message,
  ceremony (start / reveal / end with `RevealInfo`), paused, notice, gain, tool, blade, cut. Also `mat.onChange` (no payload),
  `hoard.onChange`, `history.note` (363).
- **Missing for quests:**

| Quest needs | Today | Where to raise it |
|---|---|---|
| A squishy brought out / put back | `mat.onChange()`, no payload | `mat.ts` add 301, remove 310, clear 318 (emit an `itemId`) |
| Two squishies met | the physics `bump` per body, fed nowhere useful | `drainBody`: a first `bump` per pair of distinct `itemId`s; needs the source body |
| A thing used / a place visited | nothing (no props, no places) | the new prop and place managers in `src/shell` |
| A cut / a reconnect | `cut` fires on a swipe only (650); Split in two and Reconnect all from the Cut bar emit nothing (`hudBinding.ts` 251-253); `'joined'` is never emitted (159) | inside `cut.ts` `part` 263-307 and `joined` / `whole` 310-345: one `onCut` hook |
| A toss / a toss landing | `feedback.ts` internal `lifted` flag (80, 186-188) | expose lift / toss / land-after-toss from feedback |
| A photo saved | DOM only (`hudBinding.ts` 280-284) | a `game.notePhoto()` seam |
| A capsule / merge reveal | `ceremony` end with `RevealInfo` | already typed |

- **The quest host** should listen to one new allocation-free bus. Use preallocated records, the same pattern as the debug ring
  (319-324). Do not use `emit()`. Fed from the producers above. It is checked against `src/core/quests.ts` rules, and progress goes to
  the collection store (which batches its own saves).

## 5. Settings, save, the dev hook, the node checks
- **Adding a setting** (chatter volume, autonomy on or off):
  - `Settings` in `contracts.ts` 421-442, as an optional field (additive).
  - `SETTING_KEYS`, `OPTIONAL_UNITS / OPTIONAL_BOOLS`, `optionalDefaults`, `resolveSettings` (`settings.ts` 94-110).
  - `sanitizeSettings` picks it up through those lists (131-140), and `saveSettings` writes it only once chosen (182-183).
  - Migration is by absence. No version bump is needed: v stays 2 (14). A newer blob's unknown keys are carried only when
    `prev.v > 2` (176), so a v2 build rewriting a v2 blob drops keys it does not know.
  - Apply it in `settingsCtl.ts` with change detection (60-68), and add a row in `settingsPanel.ts` with `slider()` / `toggle()`, whose
    key unions are hard-coded at 49 and 65 and must be widened.
  - Cover it in node_checks section 6 (858).
- **Save keys.** Settings: `wobblehoard:v1:settings`. Profile: `wobblehoard:v1:profile`. Hoard: `wobblehoard:v2:hoard`
  (`collection/constants.ts` 24). Play history: `wobblehoard:v2:play` (`playHistory.ts` 10). Journal and friendship state belong to the
  collection (D12): either a validated field of the v2 hoard envelope, migrated by absence (`store.ts` 222-263), or a new
  `wobblehoard:v2:journal` key. The collection lane decides. The shell never writes storage per frame.
- **The dev hook** (`debugHook.ts`, dev only, dropped from `vite build`: `boot.ts` 187). `step(dt, n)` (386-397) pauses, advances the
  virtual gesture clock and calls `stepOnce` n times (stage update every 0.05 s, one render at the end). Pointers are 0..1 canvas
  coordinates through the real input port. Harness extras: `shell.matInfo`, `matStepCost`, `tools`, `cutSwipe`, `pieceGaps`,
  `spyStart / spyCalls` (call-through spies on the real audio and haptics), `fill / grant / doTask / nextDay` (the real feed,
  accelerated), `stageInfo`. Add `life()` (brain states, budget counters) and `quests()` here.
- **Determinism.** `simTime` is the dt sum. The gesture clock is virtual while paused (`clock.ts` 394-413). LIFE must take `simTime` and
  a seeded random, never `Date.now`. The epoch clock (`epochNow`) is the collection's alone, and the dev skew pushes it.
- **Node checks without a browser** (`_harness/shellview/node_checks.ts`, 124 checks in the SESSION3 baseline). `rig()` (115-128) =
  `createMockWorld` (`mocks.ts` 255-281: recording body, stage, audio, haptics, a fake clock, `run(app, ms)` calling `app.frame`) + the
  **real** collection in memory on the mock clock + `createApp` + `setPhase('play')`; `upgrade()` (37-) adds a fake round-2 stage. The
  mock body has a **fixed centre** (`mocks.ts` 65), records `nudge` (145), and has no `moveTo` / `collide` / `measureCut` (sections
  patch them in: 494-526, 5d). Sections 0, 7e, 7f, 7g run the **real `SoftBody`** through the whole game. So: LIFE logic in pure
  `src/life` probes; the shell host with a moving mock body (writable centre and metrics); hop and touch override in a 7g-style section.
- **The browser harness.** `browser_shell.mjs` has 48 sections (`--only=`, `--port=`, default 5366). **`prod-build` serves on
  `PORT + 1` (3315), which is 5367, the audio lane's port in SESSION3.** Run it with `--port=` chosen so that `PORT + 1` is free too.

## 6. What the UI overhaul (`_spec/UI.md`, queued first) will change
- **Tokens.** `theme.ts` (today: PALETTE, DERIVED and CONTRAST_PAIRS only, 4-51) gains the type scale, spacing, radii, elevation and
  motion durations / easings. CSS reads them as `--wh-*` (`themeVars`, 54-60).
- **Components.** New shared components (gel buttons, switches, segmented controls, chips, cards, panels, modals, toasts) and one icon
  family. Today's `dom.ts` ICONS (23) and the `toyTray` / cutBar glyphs will be replaced.
- **Screens.** A UI kit page (`_harness/uikit/`). The title (one h1 "SQUISH KEEPER") and the HUD are restyled in batch 1, Settings in
  batch 2, the Hoard, tray and bars in batch 3.
- **Bars.** Contrast 4.5:1 / 3:1 measured on the pixels, 44 px targets, reflow at 320 px, `prefers-contrast`, `forced-colors`, at most
  1 ms of UI per frame, strict CSP. The size budget becomes D9's (first load at most 1300 KB, whole build at most 2000 KB).
- **To survive it:**
  - Every new colour pair goes in `CONTRAST_PAIRS` (probe_app asserts them).
  - No literal radii, shadows or font sizes: those in `hoard.css` 305-427 are the ones that will churn.
  - Screen roots are classed elements built with `h()`, with state in `data-*` attributes on `body` (the existing pattern:
    `data-hoard`, `data-tool`, `data-toys`, `data-calm`).
  - Overlay depth goes through z tokens. Today z is literal: 2 play target, 3 HUD, 4 sparks and blade, 5 plate / banner / cut bar,
    6 settings, 7 Hoard / tray / snap bar, 8 title, 15 toast, 20 error.
  - Player text stays kind, plain English.

## 7. Fragile areas and known open shell items
- **SHELL-4 is not finished** (`SHELL_4.md` status table). Steps 1, 3 to 7 are written, not run. Not started: steps 2, 8 and 9 (the
  whole browser harness, screenshots, the final run and bundle). Two verifiers are still to come. `cut.ts` constants changed in it
  (`JOIN_S` 0.8, `BRIDGE_HOLD_S` 0.3, `SETTLE_GAP` 0.16).
- **The chunk steering is a stopgap** for the physics launching chunks at 1.5 to 14 m/s (`cut.ts` 62-71). It uses `moveTo` and
  conflicts with any LIFE use of `moveTo`.
- **Two-slot assumptions everywhere:** `Slot = 0 | 1` (`gestures.ts` 38); the driver's `fingerDown / grabActive` have length 2
  (`driver.ts` 73-74) and `contact()` hard-codes 0 and 1 (100); `feedback.sweep` loops `f < 2` (271); `SoftEvent.finger` is documented
  as 0 or 1 (`contracts.ts` 52). LOCK / multi-pull (5 fingers) will widen them all. Do not add a third hard-coded user.
- **Mat edge cases:** a tier drop never trims the mat; a body brought onto an occupied slot pops out after 0.3 s (STATUS render minor);
  a ceremony and a cut both clear the mat, and only the cut says so (`cut.ts` 245).
- **Feedback** uses the active body's genome for every body's bumps and lands (351).
- **`emit` allocates per call** (283-285). `mat.count` / `itemIds` / `refusal` filter arrays (263, 273-282). Fine for UI, not per frame.
- **The hint pill and the capsule** avoidance is new and unverified (`hudBinding.ts` 332-357). The phone 4 to 5 body mat is small. The
  Legendary capsule overlap is 0.175 to 0.261 on a 390 x 844 phone (STATUS known open).
- **Known PHYS issues the shell must not paper over:** the cut neck swell (thudge x1.84, boingle x1.94), the pull into the ground, two
  hands creasing, 1.8 to 2.3 ms per body.
- **Process:** `probe_collection` C08 fails before this session too. Agents get cut off: keep running reports.

## Extension points
| What to add | Where | How hard | Risk |
|---|---|---|---|
| LIFE host (snapshot, step, apply, express) | new `src/shell/life.ts`; wired in `game.ts simStep` after `drain()` (sense) and before `bodies.step` (act); first cut via `onStep` 831 | medium | allocation in the hot path; fighting fingers and cut's `moveTo` |
| Attention budget (bubbles, voices, haptics, FX) | new `src/shell/attention.ts`, wrapping the stage / audio / haptics calls from LIFE and pieces | medium | a second path around `feedback.ts` caps; Calm must lower every cap |
| Party manager (place layout, stable ids, survives ceremony and Travel) | evolve `mat.ts`; brain table keyed by body or `itemId` | medium-hard | view ids change on re-add; corral home spot; cut clears the mat |
| Party + pieces together, one character cap | `mat.ts` 280 + `cut.ts` 244-247 | medium | frame budget (5 whole bodies cost about 10 ms); a spec change to CUT.md 2 |
| Per-body feedback identity | `feedback.handle(ev, twin, source)`, `drainBody` 516 | small | Shift-twin logic (527) |
| Typed game-event bus for quests | `game.ts` (preallocated ring), producers in `mat.ts`, `cut.ts`, `feedback.ts`, `hudBinding.ts` (photo) | small-medium | per-frame `emit` allocation if done naively |
| `onCut` / `onJoin` / `onWhole` hooks | `cut.ts` part 307, joined 323-326, whole 329 | small | the Cut-bar paths must fire too |
| Travel sheet | new `src/ui/travel.ts` + `holdInput('travel')` / `suspend('covered')`, `leaving()` first | medium | ceremony queueing; env swap mid-cut |
| Journal sheet + key J | new `src/ui/journal/*`, `keyboard.ts` 86-110, `hudBinding.escape` 375 | medium | the Escape order; focus return |
| Quest tracker pill | inside `.hud-top` (`hud.ts` 63) | small | 90 px at 390 px; long text must truncate, not wrap |
| Wish bubbles / quest-complete moment | stage 3D bubble (render) or DOM via projection; the moment queued like `ceremonies` | medium | flash spacing 1 s; Snap visibility list; one live region |
| Settings: chatter volume, autonomy | `contracts.ts` Settings + `settings.ts` lists + `settingsCtl` + `settingsPanel` 49/65 | small | the key unions in the panel; the node section 6 |
| Dev hook `life()` / `quests()` | `debugHook.ts` ShellDevApi | small | dev only; keep it out of the bundle |
| Node checks for the host | `node_checks.ts` new section using `rig()` with a moving mock body | small | the mock centre is fixed today |

## Constraints and numbers
- Frame: dt clamped to `TUNING.maxDt`. Debug ring 32 events. `FRAME_BUSY_MS` 30. Auto quality drops at about 24 ms. A whole body costs
  1.6 to 2.3 ms; 5 whole bodies with contact about 10 ms.
- Mat 3 / 4 / 5 (low / med / high, the play body included). Pieces 4 / 6 / 6. `PIECE_MIN` 1/8. `MIN_SWIPE_PX` 24.
- Cut timings: `JOIN_HOLD_S` 0.4, `JOIN_S` 0.8, `JOIN_ALL_S` 1.2, `TOUCH_GAP` 0.03 m.
- Hidden more than 60 s reconnects (`HIDDEN_RECONNECT_MS`).
- Ceremonies: `SKIP_GATE_MS` 350, `BURST_SPACING_MS` 1000. `HOLD_TO_OPEN_MS` 500. Plate on screen for `PLATE_MS` of game time.
- The quick switcher holds up to 5 (`QUICK_MAX`). Tap target 44 px, gutter 16 px. Hint min font 12 px.
- Autonomy pays nothing. Release and snap are the only paying kinds, so never drive autonomy through fingers or grabs.
- Strict CSP: no inline style or script. `font-src 'none'`. Zero allocation per step in `simStep` paths. Every seam is optional in
  `contracts.ts`.

## Open questions for the designers
1. Does LIFE pause while the desktop Hoard holds input (the sim still runs), with the Snap or Cut tool in hand, and during a cut neck
   or join?
2. Party and pieces: what is the combined character cap per tier, and does cutting still put the party back on the shelf?
3. After a capsule or merge ceremony, does the party come back automatically (today `mat.clear()`, `game.ts` 381)?
4. Are emotes and wish bubbles 3D (they would show in Snap photos) or DOM (hidden by the Snap list)?
5. Travel and Journal: where do their buttons live on a 390 px phone, given the full bottom row? The tray, the top row, or one "Places"
   button that holds both?
6. Quest-complete: does it take the plate slot, or get its own queued moment? How does it share the single polite live region with
   capsule and identity lines?
7. What happens to the brains on a quality-tier drop below the current party size: trim, sleep, or lighter meshes (D7)?
8. Which "met" rule: a first bump between two distinct `itemId`s per place visit, per day, or ever (bounded friendship storage)?
