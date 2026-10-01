# BLOCKTOOTH

> *You eat the street. You outgrow the block.*

**BLOCKTOOTH** is an original isometric (3/4 view) survivor-like. A tiny monster wakes up in a
zebra crossing, eats parked cars and kiosks, outgrows the shops, then the offices, then the
skyline. It gets through five **SIZE** ranks while a municipal news desk (WARD-7, "Ward Seven Municipal
Alert") panics on air. HALVARD CIVIL DEFENSE sends androids, drones, buggies, APCs, tanks and
artillery walkers, and an elite breach-dozer. Every Size ceiling has a **HEIGHT LIMIT**: at LV 7, 16
and 27 a **gatekeeper** (STENCIL-1, CORDON-2, SWITCHBOARD-5) holds the titan at its Size until it is
beaten, and at LV 35 each city's own containment boss guards the last breach: **PARKADE-6** (a
walking multi-storey car park, GRID-EAST), **IRON GULLY** (a snow-clearance walker, WHITE STACKS) or
**CAISSON-4** (a caisson crane, LOCKWATER). Every miniboss and boss is a HALVARD **machine**, never a
monster: the titan is the only monster in town. Its kill is the **VICTORY FINALE**: the last MASS BREACH to Size V and a short rampage.
Level-ups open 3-card **MUTATION REPORT** drafts. The run ends on the front page of *THE WARD SEVEN
WITNESS*: **THE CITY GOT SMALLER.** A clear can be pushed on into **EXTENDED COVERAGE** (endless).

**A run takes about 20 minutes** (owner decision, 2026-09-30: "go with 20 minutes"). Measured with the gate
bot (medians): STENCIL-1 at LV 7 comes at about 3:15, CORDON-2 at LV 16 at about 7:55, SWITCHBOARD-5 at
LV 27 at about 12:50, and LV 35 and the city boss at about 17:35. The kill comes at about 19:40, then the
10 s finale; a player-like bot clears at about 21:00. Early levels come as fast as before (LV 2 at about
14 s). From Size II each level costs 1.85–2.45 × the XP of the 10-minute run, rising with the level.
Enemy pressure per Size is unchanged and ramps over the longer run. OVERLOAD SITES, power-ups and RELIEF
DEPOTS keep their per-minute cadence, so a run sees about twice as many. Size IV gets one RAMROD, and its pressure
builds from half to full toward the city boss (`_spec/GATEKEEPERS.md` §5.1b, §9 decision 11).

The look is a Saturday-morning monster comic built as a clean 3D diorama: faceted low-poly shapes,
toon ramps, thick ink outlines, painted palettes and long soft shadows. Everything is procedural:
geometry, animation, music and sound effects. No gore: stepped-on things puff into dust, bolts
and springs.

* 4 titans: **MOLO** (smash tank), **VOLT-KITE** (chain assassin), **HEARTHBACK** (eruption
  fortress), **BRIARWICK** (area control)
* 3 cities: **GRID-EAST** (day, commercial blocks), **WHITE STACKS** (snowed industrial park),
  **LOCKWATER** (flooded container port at night)
* 206 data-driven card definitions (currently; `probe_upgrades`): generic cards, 72 titan-locked
  cards, cards that unlock through goals (the 5 gatekeeper cards among them), and 15 **evolutions**
  (RESTRUCTURED cards: a maxed base card plus its partner, offered in a draft, never rolled)
* 46 goals (50 unlock items) and 7 starting perks (`probe_meta`)

v2 (`_spec/FEATURES_V2.md`) adds: the charged ultimate **UPROAR** (one per titan), the ability bar +
ACTIVE panel + UPROAR meter + objective tracker HUD, map objectives (**OVERLOAD SITE**, **RELIEF
DEPOT**, **RECORDS ANNEX**), map power-ups (**RED LIGHT**, **RUSH HOUR**, **BACK PAY**, **CLEANUP
CREW**, **DEMOLITION NOTICE**), draft **BANISH** / **LOCK**, 40 goals with unlocks, starting perks and
titan palettes (**GOALS & RECORDS**), the unique GRID-EAST boss PARKADE-6, the endless mode, and a
cinematic opening (the **WARD-7 STREET CAM**).

The gatekeepers (`_spec/GATEKEEPERS.md`, rev 2) add the three Size gates, the city boss re-scaled to
fight a Size IV titan, the VICTORY FINALE, and gatekeeper rematches in EXTENDED COVERAGE (see
[Gatekeepers](#gatekeepers-the-height-limit) below).

The titan pass (`_spec/CONTRACT.md` §8 / §16, `_spec/FEATURES_V2.md` §7.7–§7.8, `_spec/GATEKEEPERS.md` §3.6)
adds BRIARWICK's seed-pod kit, the VOLT-KITE remodel, **build slots** in the draft and the bosses'
space-denial rings (see [Titan pass](#titan-pass-titans-build-slots-rings) below).

---

## Titan pass: titans, build slots, rings

* **BRIARWICK** (horned garden-beast with a seed ruff; kit `titans/kits/briarwick.ts`). **BURR LASH**
  (every 1.0 s, 3.2 body-heights, 5.8 at Size I) is a vine whip off the horns: on the move it cracks only
  within 45° of the heading, down a lane through foes, and stays on that lane while it still hits; standing
  still or hemmed in it whips whatever is nearest. It plants a **SEED POD** where it lands. Pods ripen in 2 s
  and burst when anything touches them (18 dmg, tangles foes, heals a little) and set off ripe pods
  nearby, each link 10 % harder. The HOOK **POP-UP PARK** (Space, 8 s): a horn-stamp ring burst, 4 ripe
  seeds thrown at the nearest foes, then every pod within 12 body-heights goes off in one rolling
  chain. The DASH **BRAMBLE BOUND** drops 2 pods. The SEED POD cap is 10 (the GREENBELT DECREE replants
  the garden as 10 pods). The ACTIVE panel shows `PODS n · RIPE n`; a chain calls `×5 / ×8 / ×12 / ×16 /
  ×20 IN BLOOM!`. Goal **FULL BLOOM**: one pop chains 15 more pods in one run (`cascadeBest` ≥ 15).
* **VOLT-KITE** remodel (v4): a charged raptor-cat under twin kite sails with a static crest. **FORK-ARC**
  jumps 3.8 body-heights and forks to 3 more; every 2nd strike **GROUNDS** a short LIVE WIRE, which
  RECAST: DETONATE (Space, 8 s cooldown) blows with the dash wires. Its three palettes are the canonical indigo,
  SODIUM LAMP and SLEET (a steel hide under a slate saddle, so it reads on WHITE STACKS snow).
* **Build slots** (`upgrades/draft.ts`, FEATURES_V2 §7.7). A run holds **8** distinct cards (`SLOTS n/8`
  in the draft header). Each card carries a tab: **NEW — TAKES A SLOT**, **UPGRADE LV a → b**, **SHARES
  A SLOT** (the missing half of a started evolution recipe: a recipe's two halves share one slot, and the
  evolution keeps it) or **ONE-OFF — NO SLOT** (a card with 1 stack files outside the slots). Once the
  slots are full (`SLOTS FULL — UPGRADES ONLY`), drafts offer only cards that need no new slot. Every
  draft still shows 3: when nothing is left to deepen, the offer is padded with **OFF THE RECORD**
  rewards: **SICK DAY** (heal 25 % max HP), **HOT TIP** (UPROAR +35 %), **HARD HAT** (a shield of
  30 % max HP). They cannot be rerolled, banished or locked. **BANISH never works on a card you own**
  (it would freeze the card in a slot it can never leave): the ✕ is struck through and a press shows
  `CAN'T BANISH — YOU OWN IT`.
* **Space-denial rings** (GATEKEEPERS §3.6), the counter to dash spam. Some circle tells carry a ring
  around the same centre that fires with them: a straight dash out of the circle lands in the ring,
  while a titan that walks out and stops stands in a dry moat between the two. The rigs answer with
  space and never touch the dash itself: STENCIL-1's paint SPLASH (and its dash answer in phase 3),
  CORDON-2's dash answer (phase 2+), SWITCHBOARD-5's RINGBACK, PARKADE-6's SKID dash answer.
* **Cards**: 8 slots made card LEVEL matter, so 119 cards gained a max stack; MOLO's CURB BITE text now
  says 22 dmg (the code's value).

---

## Gatekeepers: the HEIGHT LIMIT

`RANK_LEVELS` is unchanged (`[1, 7, 16, 27, 35]`), but reaching a Size level no longer breaches by
itself. Each breach needs a kill:

| LV reached | fight | guards | titan during the fight | on the kill |
|---|---|---|---|---|
| 7 | **STENCIL-1**, HALVARD ROAD-MARKING UNIT | Size I → II | Size I, held at its ceiling | MASS BREACH to Size II |
| 16 | **CORDON-2**, HALVARD CROWD-BARRIER UNIT | Size II → III | Size II, held | MASS BREACH to Size III |
| 27 | **SWITCHBOARD-5**, HALVARD MOBILE SWITCHBOARD | Size III → IV | Size III, held | MASS BREACH to Size IV |
| 35 | the city boss (PARKADE-6 / IRON GULLY / CAISSON-4) | Size IV → V | Size IV, held (50 m) | the VICTORY FINALE, then the front page |

* **The lock** (`meta/gates.ts`). The level-up that reaches the gate level does not rank up. It locks
  the gate instead: the `gateLocked` event, an alert, a padlock sting, and the GROW bar turns full and
  hazard-striped with `SIZE LOCKED — STENCIL-1 EN ROUTE`, then `SIZE LOCKED — BEAT STENCIL-1` once it
  arrives. XP, levels and drafts keep flowing. The body's height stops at the Size ceiling (a "strain"
  beat instead of the grow pop), and every level banked during the hold is paid back in the breach.
  The pacing catch-up is off while a fight is alive.
* **Arrival.** 1.5 s after the lock the gatekeeper spawns off-screen ahead of the titan (an edge arrow
  points at it). It then drives in over a 3 s invulnerable intro, with the nameplate in its
  `GATEKEEPER` variant. The city boss keeps its own 4 s intro and never arrives before 16:35 (995 s);
  a titan at LV 35 earlier than that waits at Size IV with a countdown on the GROW bar.
* **The fights.** Each gatekeeper has a meter, a stagger and a weak point that opens after its own
  attack: STENCIL-1 (STRIPE RUN, PAINT BUCKETS, DOUBLE LINE, U-TURN; hit the open paint **DRUM** during
  the REFILL → SPILL → TIPPED OVER; its **WET PAINT** slows), CORDON-2 (SHIELD SHOVE, SAWHORSE TOSS,
  BACKFIRE, SQUAD BEHIND THE LINE; get behind the wall and hit the **PACK** → STALL → STALLED),
  SWITCHBOARD-5 (CALL-IN, PUT THROUGH adds, HOLD MUSIC, RELOCATE; hit the **DISHES** as the crown turns →
  FEEDBACK → LINES DOWN, which also stuns its adds). No single gatekeeper hit takes more than 40 % of the
  titan's max HP, and the damage the titan deals is capped at 6 % of the rig's HP per 1-s window (UPROAR
  hits exempt).
* **Running away does not help.** Past its band a gatekeeper hunts the titan; a titan more than
  2.2 × the spawn ring away for 4 s is cut off (it re-enters ahead: `CUTTING YOU OFF`). Time spent not
  engaged raises **containment pressure** (0–3: more spawns, shorter attack gaps, more damage), and
  fatigue runs on `max(engaged time, 0.5 × fight time)`, so every fight is bounded.
* **Time caps.** A starved run still reaches every fight: the gates lock at 305 / 635 / 930 s and the
  city boss at 1 250 s even below the level, and a capped kill tops the level up (the drafts are owed).
  Even with every cap firing and every fight at its longest, the city boss dies by 1 425.5 s (23:45).
* **The kill** breaches on the same tick (`LIMIT LIFTED` stamp, then the MASS BREACH banner), drops a
  chest and adds +40 UPROAR. A titan that dies in a gate fight gets the sub-head
  `HELD AT SIZE II BY CORDON-2` on its front page.
* **VICTORY FINALE.** The city boss's kill is the last MASS BREACH to Size V. For 10 s every enemy is
  stunned, hostile tells and shots are cancelled, the titan cannot be hurt, 120 civilians flee through
  the streets, and the live banner **THE CITY GOT SMALLER.** plays. Drafts owed during the finale
  wait. After 3 s a `SKIP [ENTER]` / `SKIP [A]` hint appears. The clear time on the front page is the
  kill, not the end of the finale.
* **EXTENDED COVERAGE** (KEEP GOING) continues at Size V. Every 75 s a rematch arrives, alternating a
  gatekeeper (`HEIGHT LIMIT REISSUED`, kicker `REISSUED · SIZE V`, 100 000 HP × (1 + 0.5 n)) and the
  next city boss. A gatekeeper rematch guards nothing (no breach) and pays a chest, a power-up and
  1 500 score. The endless front page adds `REISSUED n`.
* **Meta.** Six goals (TIPPED OFF, LINE CROSSED, HANG UP, WITHOUT A DENT, OVER THE LIMIT, REISSUED)
  unlock five cards (Fresh Coat, Sawhorse Stack, Call Waiting, Blanket Exemption, Carbon Copy) and the
  perk **DEFERRED MAINTENANCE** (every gatekeeper arrives with its meter at 25 %).

---

## Run it

```bash
npm install && npm run dev
```

Open **http://localhost:5178**. The port is fixed (`strictPort`) because the test harness expects it.

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server on :5178 (no-store headers, `/__shot` + `/__report` endpoints) |
| `npm run build` | production build into `dist/` (`base: './'`, so it can be hosted from any sub-path) |
| `npm run preview` | serve `dist/` on :5179 |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `_harness/` and `vite.config.ts` |
| `npm run probe` | headless simulation gate (`node _harness/probe_sim.ts`) |

It needs a browser with **WebGL 2**. Without it the page shows a "NO SIGNAL" card instead of a
blank canvas. If boot fails, a "TECHNICAL DIFFICULTIES" card shows the error.

## Controls

| action | keyboard | gamepad (standard mapping) |
|---|---|---|
| move | WASD / arrow keys (screen-relative) | left stick / d-pad |
| **HOOK** (titan ability) | Space | A |
| **DASH** | Shift | B / RB |
| **zoom** the camera out / in (see more of the city) | mouse wheel · `-` / `=` (numpad `−` / `+`) held | right stick down / up |
| reset the zoom to the automatic framing | Z | R3 (right-stick click) |
| **UPROAR** (charged ultimate; fires when the meter is full) | E | Y / RT |
| pause (never ends a run) | Esc / P | Start |
| menus: move / confirm / back | arrows · Enter · Esc | d-pad · A · B |
| draft: pick card / reroll | 1 / 2 / 3 (or ←→ + Enter) · R | A · X |
| draft: **BANISH** the focused card (removed for the run; the slot refills; refused on a card you own) | X | hold Y 0.6 s (a tap does nothing) |
| draft: **LOCK** / unlock the focused card (held into the next draft) | C | LB |
| title / select: open **GOALS & RECORDS** | G | X |
| goals screen: tabs / rows / back | ← → · ↑ ↓ · Esc | d-pad · B |
| skip the **VICTORY FINALE** (after 3 s, once `SKIP` shows) | Enter | A |
| clear front page: **KEEP GOING** (endless) | K | focus it + A |
| skip the cinematic opening | any key | any button |
| debug overlay | F1 | — |

The zoom is a multiplier on the automatic framing (0.55× to 2×, and never past 12 m or 880 m of camera
distance; from LV 34 the 880 m cap binds, so at Size V the zoom-out tops out at ≈ 1.4–1.6× — at 880 m the
whole district already fits the view). It stays through Size breaches, resets on Z and at the start of every run, and only works in
play: over a menu the wheel scrolls the menu. It is view-only, so the simulation never sees it.

The game also auto-pauses when the tab is hidden or the window loses focus (alt-tab, another monitor,
the page around an embedding iframe). Movement keys held through a pause or a draft keep walking the
titan on resume; the Space/Enter/digit that closed the screen never leaks into play.

## URL parameters

| param | effect |
|---|---|
| `?seed=N` | run seed (the city layout, spawns and loot are deterministic from it) |
| `?titan=molo\|voltkite\|hearthback\|briarwick` | titan for `autostart`, or the one pre-selected on the select screen |
| `?biome=grideast\|whitestacks\|lockwater` | biome, the same way |
| `?autostart=1` | skip title + select and go straight to loading → slate (defaults: molo / grideast / random seed) |
| `?noslate=1` | skip the open slate (also skipped on retry) |
| `?quality=0\|1\|2` | quality for this session only (low: DPR 1, no shadows · med: DPR ≤ 1.25 · high: DPR ≤ 1.5) |
| `?dev=1` | enables `window.__BT__.cheat.*` (and `?rscale=`) |
| `?dynres=0` | adaptive render scale off: the drawing buffer stays at the quality DPR (see below) |
| `?rscale=0.3…1` | with `?dev=1` only: pins the render scale at this value (no adaptation; perf attribution) |
| `?prof=1` | frame profiler (`render/frameprof.ts`, `window.__BTPROF__`): per-section wall ms, GPU timer, LoAF, worst 50 frames |
| `?warmui=0` | skips the one-time compositor pre-warm of the MUTATION REPORT during loading (A/B only) |
| `?cine=0\|1\|2` | v2: this session's opening: 0 = the legacy freeze-frame slate · 1 = SHORT cinematic · 2 = FULL cinematic (overrides Settings → Opening; `?noslate=1` still skips both) |
| `?meta=fresh\|full` | v2, with `?dev=1` only: an in-memory profile, nothing unlocked (`fresh`) or everything unlocked (`full`); saved storage is untouched |
| `?perk=<PerkId>` | v2, with `?dev=1` only: the starting perk for the run (`perk_petty_cash`, `perk_red_tape`, `perk_warm_mic`, `perk_safety_inspection`, `perk_stay_of_demolition`, `perk_tip_line`) |
| `?endless=1` | v2, with `?dev=1` only: the clear front page picks KEEP GOING by itself (harness runs) |

## Screens

```
boot → title ⇄ GOALS & RECORDS
         └→ select (titan · perk · palette, then biome) ⇄ GOALS & RECORDS
              └→ loading → opening (cinematic, or the legacy slate) → play ⇄ draft / pause → end (tabloid)
                                                                                 ├ KEEP GOING (clear only → endless play)
                                                                                 ├ RETRY  (same titan + biome, new seed)
                                                                                 ├ CHANGE TITAN (select)
                                                                                 └ TITLE
```

* **Loading**: `createWorld`, mount every view, then warm the shaders (`compileAsync` with a render
  target bound, then once more for the canvas) before the first visible frame. Once per page it
  also replays the real draft deal-in animation on a near-transparent copy of the MUTATION REPORT,
  so the browser compiles its compositor shaders during loading and not in the first draft.
* **Opening** (v2, FEATURES_V2 §11): the **WARD-7 STREET CAM** cinematic. FULL (6.85 s): a signal
  cut, a street-level news-cam shot with a crash zoom onto the Size I titan, a close-up with a blink
  and a snarl, then a crane up and back into the gameplay camera, which starts play. SHORT (≈ 3 s:
  close-up, crane, hand-off) plays on RETRY, for a titan × city pair already seen in full, and when
  Settings → Opening is SHORT. With **Reduce motion** on, the REDUCED cut has no crane (close-up, then
  the hand-off). Any key or button skips it (0.25 s blend to the gameplay pose). The sim stays frozen
  and `screen` stays `'slate'` throughout. Settings → Opening OFF, `?cine=0`, or no camera-safe
  close-up pose (`CineCam.plan()` returns null) plays the legacy **slate** instead: one rendered
  frame, the sim frozen, the WARD-7 freeze-frame lower third (`UNIDENTIFIED MASS — …`) waiting for
  any key.
* **GOALS & RECORDS** (v2, from the title or select with G / pad X): tabs GENERAL, one per titan,
  CITIES and RECORDS (a 4 × 3 table of bests). Each goal row shows its progress, a FILED stamp when
  done and what it unlocks. Esc returns to the same screen, step and titan.
* **Select** (v2): the titan card shows YOUR BEST ON FILE, the NEXT PERMIT PENDING slip names the
  closest unlock, and two more rows under the titans pick the **starting perk** (one per run, `none`
  always available) and the titan's **palette** (the portrait re-renders in it).
* **Draft** (v2 additions): an evolution appears as a RESTRUCTURED card when its recipe is ready;
  BANISH (X) removes the focused card for the rest of the run and refills the slot (never a card you
  already own), LOCK (C) holds it into the next draft; the charges left are shown in the header, new
  cards carry a NEW ribbon. Titan pass: the header counts `SLOTS n/8` and every card shows its slot tab
  (see [Titan pass](#titan-pass-titans-build-slots-rings)).
* **Pause** (v2): the LOADOUT panel lists every owned card with its glyph, stacks and text, the
  perk, and the banish / lock charges left. **Settings** gained *Reduce motion* and
  *Opening: OFF / SHORT / FULL*.
* **Front page** (v2): after a clear, KEEP GOING (K) undoes the ending and continues as
  **EXTENDED COVERAGE**: escalating waves and boss rematches, scored separately (best time and
  score per titan × city). The run then ends on the EXTENDED COVERAGE EDITION (*IT WOULD NOT
  LEAVE.*). NEW ON THE RECORD lists the goals met during the run.
* **Draft**: when a level-up (or an elite's chest) is owed, the sim freezes inside that same tick.
  The frame that froze it draws the world; the MUTATION REPORT opens one frame later (`draftArmed`),
  and that frame keeps the last picture instead of redrawing, so the DOM build and the world draw
  never share a frame. The 3-card report then repeats until no draft is owed.
* **Frame hold** (`holdCanvas`, draft and pause): the views are frozen, so the canvas is not redrawn
  under the modal; it keeps showing the last live frame. It redraws once only if the canvas size,
  DPR or shadow setting changes while the modal is open (settings in the pause menu).
* **Rank-up**: hit-stop (sim time × 0.15 for 0.25 s; HOOK/DASH presses stay buffered across the
  slowed ticks), a camera punch + zoom-out, the full-width **MASS BREACH** banner, a shockwave ring,
  and a roar + news sting. A level-up owed in the same moment waits until the sting has played
  (2.3 s, play continues meanwhile), then the draft opens.
* **Adaptive render scale** (`DynRes`, `game.ts`; live play only): the display interval is the
  fastest 1-s p10 frame time seen this session. Each 1-s window counts missed vsyncs, meaning frames
  slower than 1.5 × that interval whose previous frame's main-thread work stayed under 0.75 × the
  interval (resolution cannot fix a CPU-bound frame). At ≥ 3 % misses the scale drops by 0.1 (0.2 at
  ≥ 6 %, 0.3 at ≥ 15 %; floor 0.6). After 30 s of windows under 1 % it rises by 0.1
  (`UP_CLEAN_S = 30`, because every step reallocates the MSAA buffer, a 50–65 ms stall). The 0.75 s after a step
  is not judged. A level that fails within 6 s of a step up is locked out for 60 s. The scale
  multiplies only the drawing-buffer DPR; the CSS size stays the same. `__BT__.state().renderScale`
  and `.dynres` expose it.
* **Run end**: the sim stops. After a 2.5 s aftermath (dust still settling, hostile telegraphs
  fading out), one frame is rendered and captured as the tabloid's front-page photo; telegraphs and
  hazard paint are left out of that photo so the subject is the titan.

## Project layout

```
index.html              canvas#game, #ui overlay root, #boot / #nogpu / #fatal cards
vite.config.ts          :5178 strictPort, base './', no-store, POST /__shot + /__report, es2022
src/
  main.ts               entry: WebGL2 check → App → test surface → boot; fatal reporting
  game.ts               App: the state machine + per-frame wiring of every module
  testsurface.ts        window.__BT__ (gates/harness) + window.__PAUSE__ (portal)
  core/                 types, config (tuning + size/camera formulas), math, rng, world (tick order),
                        loop (fixed-step GameLoop), input (keys + gamepad), debug (F1), save
  data/                 titans, biomes, enemies, bosses, upgrades, strings (all copy); v2: upgrades_v2,
                        evolutions, ultimates, objectives, powerups, goals, perks, palettes, cine,
                        strings_hud, strings_screens; gatekeepers: upgrades_gate, strings_gate
  meta/                 v2 sim: ultimate (UPROAR), objectives, powerups, tally, goals, perks, profile, endless;
                        gates (the Size gates: lock, fight bookkeeping, pressure, breach, finale)
  city/                 citygen, citysim, traffic (sim) · meshkit, cityview (view)
  titans/               titansim + kits/* (sim) · models, anim, titanview, portraits (view)
  combat/               spatial, damage, targeting, projectiles, telegraphs, hazards, pickups (sim)
  ai/                   enemies, director, bosses/* incl. parkade6 and the gatekeepers stencil1, cordon2,
                        switchboard5 (sim) · enemyview, bossview, foemodels, foemodels_parkade, foemodels_gate (view)
  upgrades/             stats, engine (triggers, frenzy, shield), draft (3-card offers)
  render/               renderer, camera, materials, lighting, env, warmup,
                        telegraphview, projectileview, hazardview, fx, debris (Rapier), civilians, pickupview;
                        v2: ultview, objectiveview, powerupview, markerview, cinecam
  ui/                   hud, broadcast (slate, MASS BREACH, alerts, tabloid), bossbar, select, draft,
                        menus (title, pause, settings), dom helpers, styles.css; v2: abilitybar, icons,
                        tracker, markers, toast, goals, cine (overlay), hud_v2.css, screens_v2.css
  audio/                audio (engine, limiter, buses), sfx (procedural voices), music (procedural score)
_harness/               probes (node), bot, and the browser gates (bootcheck, playtest, perfcheck, shots)
_spec/CONTRACT.md       the build contract (names, exports, numbers, file ownership)
_spec/FEATURES_V2.md    the v2 feature contract (owner items 2–8) + features_v2_types.ts
_spec/GATEKEEPERS.md    the gatekeeper contract (rev 2): the Size gates, the finale, rematches, the build plan
```

## Architecture

**Sim/view split.** The simulation (`src/core`, `city/citygen|citysim|traffic`, `titans/titansim`
+ kits, `combat/*`, `ai/enemies|director|bosses`, `upgrades/*`, `data/*`) never imports three.js
or touches the DOM, and runs under plain `node` (Node 22 type stripping). Views read sim state and
the per-tick `SimEvent` list. They never write gameplay state.

**Determinism.** Every random draw comes from a per-system mulberry32 stream (`world.rng.city |
spawn | ai | combat | loot | boss`), all seeded from the run seed. No `Math.random` and no clocks
run in the sim. The same seed and the same inputs produce the same state hash (the probe gate
checks this).

**Fixed tick (30 Hz).** `GameLoop` feeds real frame time × `timeScale` into an accumulator and
runs at most 5 ticks per frame. When the sim is frozen (slate, draft, pause, run end) the
accumulator is **discarded** every frame, so resuming never fast-forwards. Views interpolate
between the previous and current tick with `alpha`.

Tick order (`stepWorld`, `core/world.ts`):

```
events cleared → snapshot prev poses → tick/t++ → stepCity → rebuildEnemyGrid → stepTitan →
stepDirector → stepEnemies → stepBoss → rebuildEnemyGrid → stepProjectiles → stepTelegraphs →
stepHazards → stepPickups → stepUpgrades → processTriggers → peakRank → checkRunEnd → compact/30
```

Frame order (`game.ts`): `input.update` → sim ticks (each copies its events into the frame list
and a 400-event ring) → camera rig → lighting → every view → HUD / boss bar / broadcast / audio →
render. Every async continuation is guarded by a run **epoch**, so a timer or await from a finished
run cannot touch the next one. Loads are serialised, so a view is never mounted twice.

**Conventions.** 1 unit = 1 m, Y up, ground at y = 0. Heading θ points along (sin θ, cos θ), and
models face +Z, so `rotation.y = heading`. The camera yaw is a fixed 45° (the camera sits at +X+Z
of its target).

### Size and camera formulas

`src/core/config.ts` is the source of truth (the growth rows of its economy table, `RANK_LEVELS`,
`titanHeightAt`, `FRAMING`, `CAMERA_ZOOM`, `cameraDistance`). **SIZE is driven by LEVEL**: XP is the
one progression currency, every level-up makes the body bigger, and reaching `RANK_LEVELS[r]` is the
**MASS BREACH** into Size r. (Mass is retired: loot still carries it, but only to size the pickup
meshes; `titan.mass` is a legacy mirror of the SIZE bar. The HUD and debug overlay read
`sizeProgress()` / `levelsToNextSize()`.)

| Size | reached at | body H on entry → last level | per-level step | hp× | dmg× | flattens on contact | auto D, first → last level | on screen, foot → head | on screen, silhouette (VOLT-KITE · MOLO) | pitch |
|---|---|---|---|---|---|---|---|---|---|---|
| I | LV 1 | 1.2 → 2.66 m | +17 % | 1.0 | 1 | tier 0 (cars, kiosks, lamps, trees) | 33.9 → 54.9 m | 3.9 → 5.4 % | 9.3 → 12.3 % · 13.5 → 18.4 % | 54° |
| II | LV 7 | 5 → 9.89 m | +8.9 % | 1.8 | 3 | ≤ 1 (shops, buses, containers) | 82.8 → 134 m | 6.6 → 8.2 % | 15.6 → 19.5 % · 23.0 → 28.1 % | 54° |
| III | LV 16 | 14 → 24.2 m | +5.6 % | 3.2 | 8 | ≤ 2 (midrise, sheds, tanks) | 173 → 265 m | 9.0 → 10.2 % | 21.2 → 24.2 % · 30.8 → 34.8 % | 54° |
| IV | LV 27 | 32 → 47.3 m | +5.7 % | 5.5 | 20 | ≤ 3 (office blocks, towers) | 331 → 457 m | 10.7 → 11.3 % | 25.4 (LV 27) · 36.7 (LV 27) | 54° |
| V | LV 35 | 60 → 63.5 → 67.2 m (2 levels) | +5.8 % | 9.0 | 45 | ≤ 4 (megatowers) + the boss | 560 → 617 m | 11.9 → 12.0 % | 28.2 → 28.3 % · 40.7 → 41.0 % | 54° |

Two on-screen measures, both projected through the live camera (settled, zoom 1): **foot → head** is the
titan's base-to-crown segment; **silhouette** is the vertical extent of every posed body vertex, averaged
over 4 headings — what the player actually sees (long bodies read 2.4–3.4× foot → head). Both rise at every
level AND at every breach. Growth sequence (real keys to LV 8, `cheat.level` after), silhouette share,
LV 1 / 6 / 7 / 8 / 15 / 16 / 17 / 26 / 27 / 28 / 35 / 36:
VOLT-KITE 9.3 / 12.3 / 15.6 / 16.1 / 19.5 / 21.2 / 21.4 / 24.2 / 25.4 / 25.7 / 28.2 / 28.3 % ·
MOLO 13.5 / 18.4 / 23.0 / 23.5 / 28.1 / 30.8 / 31.0 / 34.8 / 36.7 / 37.0 / 40.7 / 41.0 %
(foot → head 3.9 / 5.4 / 6.6 / 6.9 / 8.2 / 9.0 / 9.1 / 10.2 / 10.7 / 10.8 / 11.9 / 12.0 %).

* `H = titanHeightAt(rank, level)`: geometric across a Size's levels, and the breach level is one
  more step × `BREACH_JUMP` (→ II ×1.88, → III ×1.42, → IV ×1.32, → V ×1.27). A level-up tweens the
  body over `LEVEL_GROW_S` = 0.45 s, a breach over `GROW_TWEEN_S` = 0.9 s (easeOutBack); the view adds a
  squash-and-stretch pop and a ground ring. Collision radius = 0.42 H.
* Titan ability radii and ranges are given in **titan heights**, so every kit scales with growth.
* Camera (`config.ts cameraDistance` / `frameDistance` + `FRAMING`; `render/camera.ts` springs toward it):

```
k      = 2·tan(fov/2), fov = 30°
D*(H)  : ln D* = ln D1 + κ1·x + c·x²,  x = ln(H / 1.2)          (config.ts cameraDistance, FRAMING)
         ONE curve for the whole run: D1 = 1.2 / (0.066·k) = 33.9 m (analytic share H/(D·k) 6.6 % at
         LV 1), κ1 = 0.573, c = 0.0367 solved so the Size V entry sits at share 0.20 (D 560 m). The local
         exponent κ1 + 2c·x rises gently from 0.573 to 0.86 and stays < 1, so D never decreases as the
         body grows and the titan's share RISES with every level and every MASS BREACH (the body jumps
         × BREACH_JUMP, the camera follows the same curve and pulls back less). No per-rank reset: the
         old per-rank framing pulled back 2.9–3.5× at a breach while the body grew 1.3–1.9×, so the
         monster looked SMALLER after its biggest growth moments. The slope eases up (instead of one κ)
         so Size I stays put (the spawn ring and GATE 2's Size II band) while the late game opens up: one
         κ = 0.573 filled ~47 % of the screen with VOLT-KITE's Size V silhouette (~70 % with MOLO's).
         Size I still opens wide: a whole intersection, the baby titan small on its zebra.
frame  = frameDistance(w): D*, widened while a boss is alive (see "Boss framing"), never below it
D      → critically damped spring toward frame, ω = 4/s
zoom   : × player zoom (wheel / - = / right stick; Z resets), ln-smoothed ω = 11/s,
         clamped to CAMERA_ZOOM 0.55×…2× and 12 m ≤ D ≤ 880 m (binds from LV 34; perfcheck --zoom max)
punch  : on rankUp, D × (1 − 0.08·(1 − easeOutCubic(τ/1.2))), τ ∈ [0, 1.2] s
target = titan (interpolated) + v·0.25 s (smoothed, ω = 6/s) + up·0.45 H
         + the boss-framing offset (frameOffset; 0 without a boss; smoothed ω = 5/s)
pitch  → RANKS[r].pitchDeg = 54° at every Size (ω = 3/s); yaw fixed 45°
camPos = target + D·(cos p·sin yaw, sin p, cos p·cos yaw)
near/far = max(0.1, 0.02 D) / 6 D + 400
shake  : trauma model (amplitude², decay 1.6/s), off when Settings → screen shake is off
```

* **Boss framing** (`config.ts bossFrameNeed` / `BOSS_FRAME`, held by `ai/director.ts`): while a boss
  is alive the default-zoom view keeps the boss rig, every live boss telegraph and the titan in frame,
  below the boss nameplate (top 20 % of the screen), with a 12 % margin elsewhere — projected exactly
  through the rig's camera. It widens the distance (never below the curve, at most 2× it) and, when the
  fight is lopsided, slides the look target toward the fight's centre. The widening is held 1.6 s and
  released at 1/s, so the camera does not pump with every attack. Measured at LV 37 (curve 617 m,
  `bossframe.py`, the tell 70–92 % through its windup, MOLO): IRON GULLY's DOUBLE STAMP 659 m (the only one that
  widens, 1.07×) · AUGER BLAST cone 618 m · boom sweep, leg stomp, winch, PLOUGH RUN on the curve itself (617 m) —
  every framed point in view, 0 outside, the widest tell at |ndc| 0.79.
* **Telegraph x-ray vs the titan** (`render/telegraphview.ts`): hostile paint is x-rayed through
  whatever hides it (a boss cone behind towers still reads), EXCEPT through the titan's own body — a
  fragment whose view ray passes through the titan's body volume (its bind-pose box in model space +
  10 %, the live model matrix, tested exactly per fragment) is not x-rayed at all. Stacked rocket
  circles under a Size II MOLO used to paint a pink swirl over its head and torso; now the ground decal
  around the feet carries the warning and the body stays clean.
* **Spawn ring** (`ai/enemies.ts`): the sim reads `spawnView` = the same framing (`frameDistance` +
  the boss offset, plus a replica of the rig's own spring so a boss-framing release cannot expose a
  spawn), never the player zoom, so it stays deterministic. Candidates go just past the edge of the
  visible ground in their direction (the 54°, 16:9 trapezoid: near edge 0.52·D·k, far edge 0.77·D·k,
  half-widths 0.74 / 1.10·D·k, + 0.04·D·k), are snapped to the street grid, and are then CHECKED
  through the default-zoom camera (`screenOut`: the exact projection, the camera's lead included,
  pulled 7 m toward the titan); the nearest candidate that is truly off-screen wins, and when none is,
  the least-visible one is walked outward along its street until it is. Enemies more than 1.9 × D·k
  away are recycled back onto the ring.
  Measured (`_harness/scratch/view/spawnvis2.py` = spawnvis + each spawn's source, 20 s per level at
  1×): 0 ring spawns first seen on screen at LV 1 / 6 / 7 / 15 / 16 / 26 / 27 / 35 (boss alive) / 40
  (of 6 / 6 / 31 / 34 / 27 / 27 / 34 / 48 / 70 spawns); the only in-view arrivals are BULWARK squads
  dropped from an APC that is already on screen (by design). Zoomed out to 2×
  the spawns are on screen by design (`scratch/final/spawnzoom.py`); they arrive with enemyview's
  0.32 s pop-in plus an fx arrival beat (`enemySpawn`: a dust kick and a thin ground ring, only when
  the spawn point is in view, at most 6 per frame — `scratch/final/spawnpop.py` shows it).

### Bosses: sized in titan heights

The metre sizes in CONTRACT §10 were the first design. At Size V they were smaller than the titan,
so they have been replaced. Every boss tell is authored in **titan heights**. `bossH(w, b)` in
`ai/bosses/index.ts` is the titan height latched at spawn, and it is latched again if the titan
ranks up mid-fight. Current shapes:

* CAISSON-4: hook drop r 0.55 H, hook lane w 0.5 H, winch oval 1.4 H × 1.0 H, boom sweep 2.6 H, leg stomp rig + 1.0 H
* IRON GULLY (a gritter and V-plough on four hydraulic stamp legs): AUGER BLAST cone 3.0 H, DOUBLE STAMP rings 0–1.1 H
  and 1.1–2.0 H, spreader plates r 0.4 H, PLOUGH RUN lane w 0.7 H (sim ids `coneBreath` / `pawSlam` / `plateVolley` /
  `ridgeCharge`; the AUGER BLAST spray deals at most 55 % of max HP in total)

Every windup comes from `fairWindup()`: 0.35 s reaction + 0.15 s acceleration + the walk-out
distance ÷ the titan's current top speed × `ESCAPE_K` (1.1 / 1.0 / 0.9 for phases 1 / 2 / 3).
`watchDash` answers dash-spam with a walkable drop at the dash end. HP is `BossDef.hp × BOSS_HP_SCALE`
(1.15 at Size V). No single hit deals more than 55 % of the titan's max HP, and structural fatigue
starts after 90 s. Dash-refund cards pay back recharge time, not whole charges (VOLT-KITE cards 20 %,
Peak Commute 50 %). The measured numbers are in the `config.ts` BOSS rows.

## Test surface and harness

With the dev server up, `window.__BT__` exposes:

* `state()`: screen, titan/biome/seed, tick, rank, HP, position, drafts, boss, run and renderer counters
* `world`: the live world, read-only
* `newRun({titan, biome, seed, skipSlate})`, `freeze(on)`, `step(n, input)` (only while frozen), `dismiss()`
* `cheat.{xp, level, rank, mass, god, spawn, boss, killAll, noSpawns, heal, time}` (only with `?dev=1`). `level(n)` and
  `rank(r)` go through the sim's real level/rank-ups (`growToRank`) and queue no drafts; `mass(n)` is deprecated
  (n % of the current level's XP bar)
* `shot(name)`: saves the canvas to `_shots/<name>.png` via `POST /__shot/<name>`
* `perf()`, `events(n)`
* v2 (FEATURES_V2 §13.3): `newRun({…, meta?})` takes a `RunMeta`; `state().v2` =
  `{ult: {charge, phase, fired, ready, r, invulnT}, objectives: [{id, kind, x, z, t, life, target, targetId}],
  powerups: [{id, kind, x, z, t}], power: {redLightT, rushHourT}, endless, tally: {ults, objectives, powerups,
  evolutions, banishes, locks, rerolls}, map: {overloadsDone, reliefsDone, annexesDone}, meta, cine: {shot, t} | null,
  draft: {banishLeft, lockLeft, locked, banished} | null, profile: {done, newUnlocks}}`. `cine` is set only while
  the cinematic opening plays (`shot` = `signal | street | closeup | crane | handoff`).
* `state().v2dom`, a read-only DOM snapshot for real-input checks, read from fixed `data-v2` attributes:
  `{barSlots, barBadges, activeCdText, meterPct, trackerRows, markers, toasts}`
* v2 dev cheats (`?dev=1`; they only set up state, every acceptance action is a real key, button or walk):
  `cheat.ult(points = 100)`, `cheat.powerup(kind)` (3 H ahead), `cheat.objective(kind, ahead?)`,
  `cheat.endless(autoPick = true)` (fields and kills the city's boss; `false` leaves KEEP GOING to a real K),
  `cheat.evolveReady(evoId)`, `cheat.bossSpawn(id)` (any boss incl. `parkade6`), `cheat.tillOpen(s)` (PARKADE-6)
* Gatekeepers (GATEKEEPERS §7.3): `state().gates` = the `GatesState` fields (`unlocked`, `pending`, `active`,
  `dueT`, `pressure`, `engagedS`, `liveFightS`, `killT`, `finaleT`, `finaleDone`, `mainKillT`, `rematchN`, …) plus the
  live gatekeeper (`live`: id, HP, meter, `drumOpen` / `overheated` / `folded`, `weakMask`). Dev cheats (`?dev=1`, set-up only):
  `cheat.gateLock(slot)` (1–4, through the real lock path), `cheat.gateKill()` (kills the live fight and runs its breach),
  `cheat.gateHp(frac)`, `cheat.gatesOpen(n)` (opens gates 1..n without fights, then the Size the level implies),
  `cheat.finaleSkip()` (the Enter / A path), and `cheat.bossSpawn(id)` also takes `stencil1 | cordon2 | switchboard5`.
  `cheat.rank(r)` and `cheat.level(n)` are a documented bypass: they open every gate up to the Size they jump to
  (`growToRank`), so use `cheat.xp` + a real eat to reach a gate the way play does (playtest_gate step 1).

`window.__PAUSE__ = {pause, resume, toggle}` is the portal contract.

The dev server also accepts `POST /__report/<name>` (JSON), which it writes to `_harness/_reports/<name>.json`.

### Gates (CONTRACT §15): a build is done only when all of these pass, observed

```bash
npx tsc --noEmit -p tsconfig.json          # 1. 0 type errors
node _harness/probe_sim.ts --det 2         # 2. 4 titans × 3 biomes: no NaN/throw, determinism, pacing bands → "GATE 2: PASS"
for p in ai city combat econ titan upgrades; do node _harness/probe_$p.ts; done   #    lane probes (all must exit 0)
python _harness/bootcheck.py --titan T --biome B   # 3. autostart → slate (baby titan ON a zebra) → real key → play, 0 errors (run all 12)
python _harness/playtest.py --matrix       # 4. real keys from the title (4 titan/biome pairs): menus, slate, move, eat, draft, HOOK, DASH,
                                           #    camera zoom (real wheel out, '=' held in, Z reset)
python _harness/perfcheck.py               # 5. Size V + 250 enemies: p99 ≤ 22 ms, ≤ 450 draws. Run it ALONE, nothing else on the GPU
python _harness/perfcheck.py --zoom max    #    the same with the camera held at its max zoom-out (real wheel; D ≈ 680–700 m at Size V)
python _harness/shots.py                   # 6. screenshot battery (_shots/) for the visual critic pass
python _harness/scratch/final/leakcheck.py # newRun ×7: geometries / textures / programs come back to the same values
python _harness/scratch/final/blankprobe.py   # setQuality after a render never shows a blank canvas (0 blank frames)
python _harness/scratch/final/growthseq.py --out DIR --levels 1,6,7,8,15,16,17,26,27,28,35,36 --real-max 8
                                           #    the titan's screen share must rise across every size-up
python _harness/scratch/view/spawnvis.py --level L   # new enemies first seen INSIDE the viewport at the auto framing (must be 0)
python _harness/scratch/view/spawnvis2.py --level L  #    the same, split into ring spawns (must be 0) and BULWARK drops
python _harness/scratch/view/bossframe.py --out DIR  # boss attacks frozen late in the windup: boss + every boss tell in frame
node _harness/scratch/view/framing_table.ts          # D and the share per level (must be monotonic)
```

v2 (FEATURES_V2 §15.5) adds to that battery:

```bash
node _harness/probe_sim.ts --det 2 --meta fresh   # GATE 2 with nothing unlocked, and again with
node _harness/probe_sim.ts --det 2 --meta full    #   everything unlocked; both print the §0.6 lines (deaths ≥ 1)
for p in ult evolutions boss3 map meta endless icons; do node _harness/probe_$p.ts; done   # the 7 v2 probes (exit 0)
python _harness/bootcheck.py --titan T --biome B [--cine 0|1|2]   # cinematic-aware: a real key skips it, the zebra
                                                                  #   check runs on the FIRST play frame
python _harness/playtest_v2.py --require-all  # real-input v2 playtest, 11 steps: G goals, E UPROAR, power-up and
                                              #   objective walk-ins, X banish / C lock, K endless, profile across a
                                              #   reload, HUD DOM vs state, gamepad (stubbed standard pad),
                                              #   Settings → Opening OFF / SHORT / Reduce motion, cinematic skip + zebra
python _harness/perfcheck.py --v2             # perf (a): Size V + 250 enemies + 3 objectives + 3 power-ups + one
                                              #   UPROAR in the window; also the p99 over the UPROAR window alone
python _harness/perfcheck.py --boss parkade6 --enemies 150   # perf (b): the PARKADE-6 fight; both ALONE, p99 ≤ 22 ms, ≤ 450 draws
python _harness/scratch/g3/perfquiet.py --n 5 --out DIR --extra=--v2   # perfcheck only in GPU-quiet windows (shared box)
python _harness/scratch/final/leakcheck.py --cine 1   # the newRun ×7 leak check through the cinematic opening
python _harness/shots.py --groups v2fx,v2hud,cine,screens,parkade   # the v2 shot additions (§15.4)
```

The gatekeepers (GATEKEEPERS §8.3 / §8.4) add:

```bash
node _harness/probe_sim.ts --det 2 --meta fresh|full   # GATE 2 on the GATE2_V3 bands (gate spawn / breach bands,
                                                       #   city-boss spawn 995–1 265 s, clears in 17–24 min,
                                                       #   levels per city fight; GATEKEEPERS §5.3)
node _harness/probe_gatekeepers.ts            # 246 checks, cases 1–16 of §5.4 (summon, no breach without the kill,
                                              #   beatable, weak points, fair tells, volley geometry, avoider, soaked
                                              #   fighter, time caps, finale, city boss at Size IV, rematches,
                                              #   determinism, RAMROD, stuck rule, tick-end breach); --quick, --only 1,2,6b
python _harness/playtest_gate.py              # real input: 1 the SIZE LOCKED bar + GATEKEEPER nameplate from a real eat,
                                              #   2 a kill with a real attack (gateDefeated + rankUp 1 on one frame, MASS BREACH),
                                              #   2b STENCIL-1 tipped over with no HP cheat, 3 avoidance (pressure ≥ 2, stays
                                              #   within 2.2 × spawnRing), 4 the finale + real Enter → the clear tabloid at the
                                              #   kill time, 5 real K → a REISSUED · SIZE V rematch, 6 pad A skips the finale
python _harness/perfcheck.py --gate c|d|e --enemies 150   # (c) SWITCHBOARD-5 at Size III + adds + an UPROAR,
                                              #   (d) STENCIL-1 P3 with 10 WET PAINT hazards held live (HazardView ≤ 0.2 ms),
                                              #   (e) the Size V finale with the 120-civilian surge; p99 ≤ 22 ms, ≤ 450 draws, ALONE
python _harness/scratch/final/leakcheck.py --gate 1   # newRun ×7 with a gatekeeper rig built each cycle
python _harness/shots.py --groups gates       # 19 shots: the three rigs' tells and staggers, the city bosses at
                                              #   Size IV, GROW-bar lock at 1280 / 1920, the finale, heldBy, a rematch
```

Start the server once as `BT_FROZEN=1 npx vite --port 5178 --strictPort`, with no HMR and no file
watching, so an edit cannot reload a page mid-test. Otherwise the browser gates start `npx vite`
themselves when :5178 is not serving (`--no-serve` turns that off). `--headless` runs a gate without
a window, using the same GPU flags; gate 5 is only valid headed. Perf attribution:
`python _harness/scratch/perfprof.py` (perfcheck with `?prof=1`), then `profsum.py` / `profcat.py`
on the JSON it writes. Boss threat (node only): `node _harness/scratch/boss_threat_pool.ts`.

## Credits and licences

* Game code, procedural geometry and animation, and the procedural WebAudio music and sound
  effects: original work for BLOCKTOOTH. All names in the game are original.
* [three.js](https://threejs.org) 0.186: MIT
* [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.20, debris physics only): Apache-2.0
* Fonts via [Fontsource](https://fontsource.org), bundled locally with no runtime network loads:
  **Anton**, **Barlow Condensed** and **Space Mono**, all under the SIL Open Font License 1.1
* Built with [Vite](https://vite.dev) (MIT) and [TypeScript](https://www.typescriptlang.org) (Apache-2.0)
