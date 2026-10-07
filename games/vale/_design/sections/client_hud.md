# Client screens, HUD and cue map (content lane, 2026-10-07)

What the client shows and says, and which sound plays when. The look is law in `STYLE_BIBLE.md` (grid, states, HUD density, palette); the voice is `WORLD.md` §5; ids come from `VOCAB.md`. This file is the design source for the UI lane (`src/ui/screens/*`, HUD) and the AUDIO lane's trigger table. The data it describes lives in:

| File | What it holds |
|---|---|
| `content/client.json` | nav (6), the Mode Dial slots (RIFT, BRIDGE, FRAY, the uncarved hour), home (headline, feature, 4 tiles), menu scene, 25 tips |
| `content/strings.en.json` | 1,371 dot-namespaced UI strings (§14) |
| `content/store.json` | Candles only; 32 offers, 8 shelves, starter skins and wallet |
| `content/bot_names.json` | 60 handles for bot seats |
| `content/version.json` | `2026.10.0` |

Every file parses against `src/contracts/catalog.ts` (zod strict) and passes `node tools/build_content.ts --check --allow-missing-assets` with 0 errors, including the deny-list names check. The only warnings are art that does not exist yet.

---

## 1. Flow

```
home ──► play ──► mode dial ──► queue select ──► queue ──► ready check ──► draft ──► loadout ──► loading ──► match ──► post-game
 ▲        │         (RIFT · BRIDGE · FRAY ·       (Quick · Draft ·   (search,      (found,       (RIFT draft,  (finalize    (wipe,       (HUD)      (banner,
 │        │          uncarved hour)               Ranked · Co-op ·    cancel)       accept)       BRIDGE Lot,   panel)       tips)                   rewards)
 │        │                                       Standard)                                       FRAY pick)
 │        ├──► practice / custom (setup screens) ─────────────────────────────────────────────────► loading ──► match
 └────────┴─────────────────────────────────── play again / return home ◄──────────────────────────────────────────────┘
```

| Step | Trigger | Route | Transition | Music |
|---|---|---|---|---|
| Home to Play | nav, feature CTA, tile | `play` | forward (clockwise, enters from the right) | `mus_menu` |
| Mode dial | pick a mode | stays on `play` | gnomon shadow swings clockwise to the station, 360 ms | `mus_menu` |
| Queue select | pick a queue under the dial | stays on `play` | panel swap, 160 ms | `mus_menu` |
| Find match | CTA bottom-right | `queue` (Session `queue` event, state `searching`) | forward | `mus_menu` |
| Ready check | state `found` | `queue` (modal over the search) | `ui_queue_pop`, window title flashes | `mus_menu` ducked |
| Draft | `draft` event | `draft` (reset) | forward | `mus_draft` |
| Finalize (loadout) | `DraftState.phase = finalize` | same screen, panel swap | 240 ms | `mus_draft` |
| Loading | `loading` event | `loading` (reset) | shadow-line wipe, 900 ms | none (bed fades) |
| Match | `match` event | `match` (reset) | fade; the wipe has already run | `mus_match_<mode>` |
| Post-game | `postgame` event | `postgame` (reset) | shadow-line wipe, 900 ms | stinger, then `mus_postgame` |
| Play again | CTA | `queue` with the last request (`Session.playAgain`) | forward | `mus_menu` |
| Return home | secondary | `home` (reset) | back | `mus_menu` |

Rules of the flow:
- The match flow owns the screen. Session events drive it (`queue`, `draft`, `loading`, `match`, `postgame`); nothing in the nav can be reached from draft, loading or match except Settings through the in-match menu.
- Leaving a matchmade draft is a dodge. A confirm modal says so first (`draft.leave.*`), then the toast and lockout come from `queue.dodged` + `queue.lockout`.
- Any queue error or decline returns to `play` with a toast (`queue.timeout`, `queue.declined`, `queue.cancelled`).
- Esc goes Back everywhere except the ready check (no accidental decline), the match (opens the in-match menu) and rebinding (cancels the rebind).

---

## 2. Screen inventory

Route params are plain strings (`router.go(screen, params)`).

| Screen id | Params | Reached from | Shows | Chalk CTA (bottom-right) |
|---|---|---|---|---|
| `home` | none | boot, Return home, nav | headline, feature card, 4 tiles, the 3D Rim | Play RIFT (feature CTA) |
| `play` | `mode?` `queue?` | nav, home CTAs | Mode Dial, queue cards, party, role pickers or fighter preset | Find match / Start practice / Start game |
| `queue` | none | Session `queue` events | search timer, cancel, ready check | Cancel search / Ready |
| `draft` | none | Session `draft` events | bans, picks, Lot or Fray pick, finalize panel | Ban / Lock in |
| `loadout` | `fighter?` | Collection fighter detail | spells, boons, default skin for one fighter (same panel as finalize) | Save |
| `loading` | none | Session `loading` | map card, tip, progress, seat ticks | none (auto) |
| `match` | none | Session `match` | the HUD (§4) | none |
| `postgame` | none | Session `postgame` | banner, rewards, rating, scoreboard, graph | Play again |
| `collection` | `tab?` `fighter?` | nav, tile | fighter grid and detail, skin grid | Equip / Play as |
| `shop` | `shelf?` `sku?` | nav, empty-state buttons | shelves from `store.json`, balance | Buy |
| `profile` | `tab?` | nav, tile | overview, history, rating, rename, reset | Change name |
| `settings` | `tab?` | nav, in-match menu | five tabs (§12) | none (changes save as you make them) |
| `practice` | none | tile, play | practice switches (infinite Gleam, no cooldowns, targets, level) | Start practice |
| `custom` | none | play | mode, map, seats, bots | Start game |

Param values: `mode` is a mode id (`rift`, `bridge`, `fray`), `queue` a queue id, `tab` one of the tab ids below, `fighter` a fighter id, `shelf` a shelf id, `sku` an offer sku. `collection.tab`: `fighters` or `skins`. `profile.tab`: `overview`, `history`, `rating`. `settings.tab`: `video`, `audio`, `controls`, `access`, `gameplay`.

Modals (all use the Modal component, one chalk CTA, Esc closes): purchase confirm, purchase insufficient, rename, profile reset, leave draft, leave match, ready check, trade request.

States every screen implements (STYLE_BIBLE States row): hover = focus ring, pressed 1 px down with sound on pointerdown, selected keeps a chalk hour-tick, disabled says why, locked is a dashed border plus the unlock path (never grey), loading is a final-size skeleton with a shadow sweep, empty is one drawing + one sentence + one action, error is a HARM rule + Retry, timed is a ring sweep that turns HARM in the last 5 s, new is a gloam dot.

---

## 3. Screens in detail

### 3.1 Home
- **Shows:** `home.headline` ("Long light on the Vale") and `home.sub` over the live Rim; the feature card (`feature.art`, title, body, CTA to `play` with `mode=rift`); four tiles in a row: Ranked season (to `play`, `queue=rift_ranked`), The Almanac (to `profile`; no Almanac screen exists in this slice, the tile says it is not open yet), Sparring practice (to `practice`), Your collection (to `collection`, `tab=skins`).
- **States:** loading (skeleton cards while the catalog art decodes), ranked tile locked below level 20 (dashed border, `state.locked.queue`), Almanac tile carries the gloam "new" dot and is never a CTA.
- **Strings:** `client.json` for all copy; `state.locked.*` for the lock line.
- **Sound:** `ui_hover`, `ui_click`, `ui_confirm` on the feature CTA.

### 3.2 Play: Mode Dial, queue select, party
- **Mode Dial** (columns 1-6, the 3D Rim in 7-12): four stations drawn from `client.modeSlots` in order. RIFT is three roads crossed by the noon line, BRIDGE one line over an arc, FRAY a ring of ten ticks, the uncarved hour an empty tick with a dashed outline. The selected station has the chalk hour-tick; `note` is the one-line subtitle.
- **Reserved slot:** dashed border, `The uncarved hour`, `A new mode will be cut here.` It is focusable but not selectable (`state.locked.reserved`). Adding a record with a mode id to `modeSlots` carves it with no code change.
- **Queue select:** below the dial, one card per queue of the chosen mode, ordered by `queue.order`: RIFT Quick, Draft, Ranked, Co-op; BRIDGE Standard; FRAY Standard. Card: `queue.name`, `queue.desc`, kind chip (`play.queue.kind.*`), length ("About 25 min"), reward line (win, loss, the per-minute rate and cap, `play.queue.first_win`, the FRAY placement note), bans (`play.queue.bans`), bots line. Custom game and Practice are two quiet links under the cards.
- **Locks:** `unlockLevel` above the profile level makes the card locked: dashed border, "Reach level 20 to play Ranked." (`state.locked.queue`). Ranked also shows `play.queue.ranked_provisional` until the 5 placement matches are done.
- **Party panel:** you plus bot allies. A stepper sets bot party members (`Session.setPartyBots`); queues with `partyMax` 1 show `play.solo_only`. Open seats are filled with bots (`play.queue.bots_fill`).
- **RIFT roles:** primary and secondary role pickers (`play.roles.*`) for `draft` and `ranked` queues, using the five positions from `roles.json`. `role_preset` (Quick) shows the preset panel instead: pick role and fighter now (`play.preset.*`); the CTA stays disabled with `play.preset.missing` until a fighter is chosen.
- **CTA label by queue kind:** quick, standard, ranked, coop: Find match (`btn.find_match`); practice: Start practice; custom: Start game.
- **States:** a locked queue, a lockout after a dodge (CTA disabled, `queue.lockout_banner`), an offline notice (`state.offline`; local matches still work).

### 3.3 Queue and ready check
- **Searching:** `queue.searching` ("Searching · 1:24 · usually under 2:00") over a slow ring, a Cancel search button, and `queue.bots_note`. The elapsed time is `SessionEvent.elapsed`, the estimate `estimate`.
- **Found:** `ready.title` ("Match found"), `ready.sub` ("RIFT · Ranked. Ready in 12 s."), a timed ring (`readyTimer` of `readyMax`, HARM in the last 5 s), Ready and Decline. After Ready: `ready.accepted` and `ready.waiting` ("Waiting for the others · 3 of 5 ready"). Timer out: `queue.timeout`.
- **Declined or dodged:** back to `play`, toast from `queue.declined` / `queue.dodged`, lockout line from `queue.lockout`.
- **Sound:** `ui_queue_search` on start and as a soft pulse every 8 s, `ui_queue_pop` on found, `ui_accept` on Ready, `ui_back` on cancel.

### 3.4 Draft (RIFT: ban, pick, finalize)
- **Layout:** your team's five seats on the left, the other team's on the right, the fighter grid in the middle with class / role / search filters (`draft.filter.*`), bans along the top edge, the phase title and a timer ring top-centre.
- **Ban phase** (20 s, hidden and simultaneous): the prompt is `draft.ban.prompt`; your team's bans are visible to you, the other team's show as hidden slots until the reveal (`draft.ban.revealed`). A fighter an ally is hovering cannot be banned (`error.draft.ally_hover`). CTA: Ban (`ui_ban`).
- **Pick phase** (snaking 1-2-2-2-2-1, 20 s a turn): the active seats glow; `draft.pick.your_turn` or `draft.pick.turn_of`. Your hover is shown to allies (`draft.pick.hover_hint`). Fighters are marked Available, Taken, Banned or Yours (`draft.state.*`). CTA: Lock in, disabled with `draft.pick.lock_disabled` until something is hovered. Timeout locks the hover (`draft.pick.timeout`).
- **Blind (Co-op):** `draft.pick.blind`; picks reveal together (`draft.pick.blind_revealed`).
- **Finalize** (15 s): the loadout panel (§3.6) with skin, spells, boons, and the trade list (`draft.trade.*`). A trade is a request the other seat accepts; incoming requests also toast (`toast.trade_incoming`).
- **Log:** the session's draft log is shown as a quiet one-line ticker (`draft.log.*`).
- **Leave:** Esc or Back opens the dodge confirm (`draft.leave.*`).
- **States:** waiting on other seats (`draft.seat.thinking`), bots shown with a bot tag, an unavailable fighter (`error.draft.unavailable`), reconnect (`state.reconnecting`).

### 3.5 BRIDGE: the Lot, and FRAY: pick
- **BRIDGE Lot** is its own layout, see §10.
- **FRAY pick** (25 s, `ffa_pick`): the fighter grid with no bans; nine other seat chips along the top show locked fighters as they arrive (`fray.pick.taken`). Your seat chip carries your seat colour and glyph (`fray.seat.you`). If two players lock the same fighter the first lock keeps it (`fray.pick.first_lock`). A seat with nothing left is assigned a random fighter (`fray.pick.none_left`).

### 3.6 Loadout (finalize panel, and the `loadout` screen)
- **Shows:** the skin carousel (owned skins; unowned ones are dashed with "In the shop for {price}"), 2 battle-spell slots (5 in FRAY, where there are no boons), 2 boon slots restricted to one path (Shadeline, Warmstone, Hourturn) with the path tabs, and spell and boon tooltips from `setup.json` (`desc`, cooldown line `loadout.cooldown`).
- **Rules shown as text, not hidden:** `loadout.path_one` ("Boons must come from one path."), `loadout.not_here` for a spell or boon outside the mode's pool, `loadout.needs_full` until every slot is filled.
- **Actions:** `Session.draft({a:'skin'})`, `{a:'loadout'}`, and on the standalone screen `Session.saveLoadout`. `Use last loadout` restores `Profile.loadouts[fighter]`.
- **Today the finalize timer is the only thing that ends the phase.** Lock in saves and shows `loadout.locked_in`; if SESSION adds an early-out when every human confirms, the button already exists.

### 3.7 Loading
- **Shows:** the map name and flavour line (`loading.title`, `loading.flavour.<mode>`), one tip at a time from `client.tips` (random start, then in order, every 8 s, `loading.tip_n`), a thin progress bar (`loading.progress`), and a chip per seat (up to ten) with a tick as each seat is ready (`loading.seat_ready`).
- **States:** waiting for others (`loading.waiting`), asset error (`state.error.match` + Retry). The shadow-line wipe starts the screen and ends it; no sound but the bed fading.

### 3.8 Post-game
- **Banner** (Display, results are the only place Display XL appears): `postgame.victory.title` or `postgame.defeat.title` with the sub-line for the mode (`postgame.victory.sub.rift` and so on). FRAY shows `fray.place_of` ("2nd of 10") with `postgame.fray.sub.<n>`. The match reason (`postgame.reason.*`) and length (`postgame.duration`) sit under it.
- **Rewards:** one ledger row per `GrantSummary.lines[].label`, resolved through `grant.<label>`, with the amount in Candles or XP; currency ticks up over 1,200 ms (`ui_currency_tick`); a total; the account level bar (`postgame.level.*`) and `toast.level_up`-style callout on a level change (`ui_level_account`). Nothing granted shows `postgame.rewards.practice`, `postgame.rewards.left` or `postgame.rewards.none`.
- **Rating** (ranked only): `postgame.rating.change`, `up` / `down`, tier change lines, placement matches `postgame.rating.placing`.
- **Tabs:** Summary (your stats, `postgame.stats.*`), Scoreboard (§8, or the Hour Board in FRAY), Graph (`goldGraph`, labelled `postgame.graph.title`; above the line your team led).
- **Next:** Play again (chalk), Choose another mode, Return home. Play again is disabled with `postgame.queue_again_locked` while a lockout runs.
- **Tone:** defeat is dignified. No red, no mocking sub-lines; the banner uses the same plate as victory with the defeat sting and a held B4.
- **Sound:** `m_victory_sting` / `m_defeat_sting` / `m_placement_sting` once, then `mus_postgame`; `ui_reward_reveal` as the rewards panel opens.

### 3.9 Collection
- **Fighters tab:** a grid of the 16 launch fighters, filters by class, role and origin (the `aubade` / `serenade` / `hourless` tags, `collection.origin.*`), search. Detail: the fighter on the plinth in the Rim, class and role, `job` line, lore, the passive and four abilities with icons, difficulty (`difficulty.<n>`), the resource, and the skin strip. Every fighter is free to play (`collection.free_note`).
- **Skins tab:** all skins grouped by fighter, with owned / equipped / in-the-shop states (`collection.skin.*`). Equip needs ownership; locked skins show the price and a link to the shop.
- **Empty:** `state.empty.collection` ("No skins for Tavrel yet.") with Browse the shop.
- **Sound:** `ui_hover_fighter` over fighter cards, `ui_equip` on equip.

### 3.10 Shop
- **Shows:** the balance (Candles glyph and number) at top right; shelves from `store.json` in order: Featured (hero, 4 cards), New (row), then one row per class. A card shows the splash, skin name, fighter, tier chip (`shop.tier.*`), price, and the gloam "New" badge from the offer's `badge`.
- **Buy:** confirm modal `shop.confirm.body` ("Buy First Bell Pavise for 2,250 Candles?") with the balance left; after the session confirms, `shop.bought` ("First Bell Pavise is yours. Equip it?") with Equip now / Not now. Sound `ui_purchase`, then `ui_equip` on equip.
- **Insufficient Candles:** the Buy button stays enabled; the modal `shop.insufficient.*` says how many Candles are missing and offers Play a match. `ui_error`, no charge.
- **Owned** cards show Owned or Equipped. A failed purchase says `shop.error` and that nothing was charged.
- **No premium currency in this slice.** No Prisms, no real-money copy anywhere. `shop.earn_hint` says Candles come from playing.

### 3.11 Profile
- **Overview:** display name with Change name (`error.rename.*`), level and XP bar, wallet, record (wins and losses), most played fighter, and the browser-storage note. **History:** the last 50 matches (`profile.history.*`), each with result or placement, mode, fighter, T / F / A, length, Candles and rating change. **Rating:** tier emblem, rating, peak, games, next tier, provisional progress.
- **Reset:** a modal that says exactly what returns to defaults and that it cannot be undone (`profile.reset.*`).
- **States:** history empty (`profile.history.empty`), rating locked (`profile.rating.locked`) or none (`profile.rating.none`).

### 3.12 Practice and Custom
- **Practice:** four switches (infinite Gleam, no cooldowns, training targets 0-20, starting level), `practice.no_rewards`. In match, the practice panel (`practice.panel.*`) offers +5,000 Gleam, level up, refresh cooldowns, toggle cooldowns, place a target, return to life, reset match and a speed control up to 16x.
- **Custom:** mode, map, ten seat rows (you, bot, open) with bot difficulty (`custom.difficulty_*`), per-seat fighter or random, `custom.no_rewards`. Start is disabled until you are in a seat (`custom.need_seat`).

---

## 4. HUD

Mapped to the bible's HUD density table (1080p; scale with `access.hudScale`). Screen share is element pixels over 2,073,600.

### 4.1 Budget

| Element | Where | Size | Share | RIFT | BRIDGE | FRAY |
|---|---|---|---|---|---|---|
| Dial Bar | bottom centre | 640 x 132 | 4.07% | yes | yes | yes |
| Minimap | bottom right (swappable left) | 352 x 198 · 384 x 96 · 232 disc | 3.36 · 1.78 · 2.60% | 3.36 | 1.78 | 2.60 |
| Sky strip | top centre | 720 x 48 | 1.67% | yes | yes | yes |
| Ally frames | left edge | 4 x 168 x 52 | 1.69% | yes | yes | no |
| Hour Board | top right | 220 x 236 | 2.50% | no | no | yes |
| **Always-on total** | | | | **10.79%** | **9.20%** | **10.84%** |
| Kill feed (3 rows) | top right (FRAY: under the Hour Board) | contextual | 1.46% | peak | peak | peak |
| Announcer | under the strip | about 480 x 75 | 1.73% | peak | peak | peak |
| Feed (chat region) | bottom left | about 360 x 154 | 2.67% | peak | peak | peak |
| **Peak total** | | | | 16.65% | 15.06% | 16.70% |

The always-on total stays at or under 11%, the peak under 17%. The centre 40% x 50% of the screen holds no HUD. The bible's chat region has no chat in this slice (the session has no chat bind), so the bottom-left box is the **feed**: ally pings, shop refusals, first-run hints (`hint.*`), surrender votes. Same size, same budget.

### 4.2 Dial Bar (bottom centre)
- **Portrait** with a level ring (`PlayerView.xp / xpToNext`, level number centred), the passive as a small badge on its corner, a gloam dot while `skillPoints > 0`.
- **HP bar over the resource bar.** HP: `EntityView.hp / maxHp` with ticks every 100 and heavy ticks every 1,000 (`gameplay.healthBarTicks`), a hatched Dawnglass shield segment, and a Noonwhite damage trail (150 ms hold, 450 ms out). Resource row: Light `#8F86F0` (pool), Tally `#E8C27A` (builds), Heat `#D96A4A` hatched (a full bar overheats; the lock-out shows as a sweeping hatch), Unlit shows no row. Row colour comes from `resources.json`, the fighter's `resource` picks the model.
- **Gleam** as a Mono number beside the bars (`PlayerView.gold`), `hud.gleam_tip` on hover.
- **Abilities:** a1, a2, a3 at 64 px and the ultimate at 76 px, each with the key chip (from `settings.controls.binds`), rank pips (`AbilityView.rank / maxRank`), cost, and a clockwise cooldown shadow from 12 o'clock with the remaining seconds in 22/700 Mono. A `canLevel` ability shows a chalk "+" and `hud.ability.level_up`. Not enough resource tints the cost HARM; silence draws a diagonal bar. Recast windows show a ring (`hud.ability.recast`).
- **Battle spells:** two 48 px slots. **Items:** 3 x 2 grid, each with a number key chip and a cooldown shadow for actives (`itemCooldowns`).
- **Tooltips** (hover or focus, 150 ms): name, cooldown, cost, range in metres, rank line, `desc`. At most two sentences of explanation; numbers carry units.

### 4.3 Minimap
- RIFT 352 x 198 (three roads and the noon line), BRIDGE 384 x 96 (the span and the Snap), FRAY a 232 px disc (the plate, ten hour-marks on the rim). It sits bottom right and can swap left (`gameplay.minimapSide`); `access.minimapScale` resizes it.
- **Marks:** terrain from the map's `minimap.png` (fog applies value x0.55 and saturation x0.4 to the unseen; the Standing Shadow keeps colour and a hard edge); structures; fighters as portrait dots (ally round, enemy with the heading wedge, you a solid ring with a gnomon wedge); Wicks as small dots; objectives with their timers; the camera rectangle; ping markers (§5).
- **Input:** click moves the camera, right-click moves your fighter, the ping key pings at the cursor.
- **Shape codes** (identical in every colour palette): self double-frame, ally rounded, enemy chevron or notched, neutral square.

### 4.4 Sky strip (top centre)
- **RIFT:** your team's structures down and takedowns on the left, the other team's on the right, `Match time` m:ss in the middle, objective chips under it (Sunsplinter, Longshade, Glasshorn, Resinback) with a ring sweep to respawn from `WorldView.objectives` (`hud.objective_returns`); sudden death turns the clock HARM and shows `hud.sudden_death`.
- **BRIDGE:** takedowns and structures, clock, the Mending Sunmote timers.
- **FRAY:** `Ends at {t}` and the first-to-12 line (`hud.fray.first_to`); no team score.
- Pregame: `hud.pregame` replaces the clock; the strip shows the countdown with `m_countdown` in the last 5 s.

### 4.5 Ally frames and the Hour Board
- **Ally frames** (RIFT, BRIDGE): the four other seats, 168 x 52 each: round portrait, level, HP bar over a thin resource bar, an ultimate-ready tick, and the respawn timer when down (`hud.dead.respawn`). Ordered by role; a click centres the camera on that ally. `gameplay.showAllyIndicators` hides them.
- **Hour Board** (FRAY): §9.

### 4.6 Kill feed, announcer, feed
- **Kill feed** (3 rows, newest on top, 6 s): `killfeed.*` lines with portrait chips and the side or seat mark. Your own rows get the Noonwhite double frame. Wording is takedown and fall, never kill or slain; the one plain label that stays is Death recap, because players look for it.
- **Announcer banner** under the sky strip: two lines (title in h1 24/28, sub in body-s). Minor events show 2.4 s, major 3.6 s, one at a time with a queue of 2. Lookup and texts are in §6. It is also the subtitle (`access.subtitles`).
- **Feed** (bottom left): up to 5 lines for 6 s each. Contents: ally ping log lines, `announce.shop_denied.*` refusals, `hint.*` first-run hints, surrender votes.

### 4.7 In-world
- **Overhead bar:** head + 0.35 m, fixed screen size, HP 82 x 9 over resource 82 x 4 on an 80% ink plate; ticks every 100 HP, heavy every 1,000; name at 12/14 600 with a 2 px ink outline. Colours by relationship (self Noonwhite, ally azure, enemy marigold, neutral Dialstone); shape codes on the bar ends. Wick bars show only when damaged or targeted.
- **Telegraphs** (overlay pass, 1 px dark outer keyline): from `area` events. `telegraph: 'everyone'` enemy areas fill 16% growing to 30% as they land, with a 90% edge at 3 px; ally areas edge at 45%; your own aim 8% fill and 60% edge. Overlaps cap at 40%. Delayed areas sweep clockwise and land as the circle closes. Never white, never above 2 Hz, identical on every quality tier.
- **Damage numbers:** your outgoing hits and heals of 5% max HP or more, merged per 0.5 s, at most 8 on screen (`gameplay.showDamageNumbers`). Physical Chalkstone upright, magic Orchid-rose with an oval chip in tooltips and the recap, piercing ink with a 2 px Noonwhite halo, heal Sap with a "+" that always rises, shield Dawnglass hatched.
- **Status icons** under the bar (`status.*.name` and `.tip`).
- **Needle shadow ring:** a structure's attack range drawn as a ring on the ground when an enemy fighter is within 4 m of it, so "stay outside the ring" is learnable.

### 4.8 States
- **Pregame:** shopping, ability levelling and pings allowed; movement dropped. `hud.pregame_shop`.
- **Recall:** a ring fills around the portrait over the recall time; `hud.recall_progress`; `m_recall_start`, then `m_recall_done`. Cancel shows `hud.recall_cancelled`. BRIDGE has no recall (`hud.no_recall`).
- **Down:** the Dial Bar dims to 60%, a respawn ring with `hud.dead.respawn` replaces the portrait ring, the death recap (§7) opens, and shopping is allowed where the mode allows it (`hud.dead.shop`, BRIDGE and FRAY rules). Allies' frames keep updating.
- **Shop** (RIFT at base, BRIDGE at base or while down, FRAY at a Lampwright cart): a panel left of centre with search, suggested items, the component tree and buy / sell / undo (`hud.shopui.*`); refusals show as a feed line and `ui_error`.
- **Surrender vote** (RIFT 12:00, BRIDGE 8:00; 4 of 5): a plate under the announcer with the tally (`hud.surrender.tally`), Yes and No keys; result lines `surrender_passed` / `surrender_failed`.
- **In-match menu** (Esc): Resume, Settings, Leave match (`hud.menu.leave_confirm` states that leaving counts as a loss and earns nothing).

---

## 5. Ping language

Nine pings, one per `PingKind`. There is no chat in this slice, so pings are the whole team vocabulary. Names are original and plain (they do not repeat the reference games' wording).

| Kind | Name | Meaning | Marker (24 px, ally colour, drawn once on the ground and once on the minimap) | Cue |
|---|---|---|---|---|
| `alert` | Look here | draw eyes to a spot | two concentric rings, one ripple | `m_ping_alert` |
| `danger` | Trouble here | something dangerous is here | a downward wedge with a "!" cut in it; the brightest edge | `m_ping_danger` |
| `onMyWay` | Heading there | I am coming | a gnomon wedge from the sender toward the spot | `m_ping_onmyway` |
| `missing` | Out of sight | an enemy left my sight | a dashed ring with a gap | `m_ping_missing` |
| `assist` | Need a hand | come and help | two wedges pointing inward | `m_ping_assist` |
| `push` | Press on | push forward here | three chevrons pointing along the attack direction | `m_ping_push` |
| `vision` | Lamp wanted | light this spot | a small lamp with a dashed 9 m ring | `m_ping_vision` |
| `objective` | Claim it | take this objective | square corner brackets (a plate) | `m_ping_objective` |
| `retreat` | Pull back | leave this spot | three chevrons pointing toward your own base | `m_ping_retreat` |

- **Wheel:** hold the ping key (default G) to open a nine-slot wheel at the cursor, move toward a slot, release to send. A tap sends `alert`. A ping on the minimap uses the cursor position. Slot order, clockwise from 12 o'clock: Look here, Trouble here, Heading there, Out of sight, Need a hand, Press on, Lamp wanted, Claim it, Pull back. The wheel shows glyph and name (`ping.<kind>.name`); the desc shows on hover (`ping.<kind>.desc`).
- **Targets:** `missing`, `danger` and `objective` can carry a target entity (an enemy last seen, an objective unit); the marker sticks to it.
- **Visibility:** only your team sees them. The marker lasts 4 s and fades; each sender shows at most 3 at once. Pings never change colour with the team, only with the viewer's relationship (ally azure).
- **Limit:** 5 pings per 4 s per seat (a sim rule); the 6th shows `ping.limit`.
- **Log:** an ally's ping adds one line to the feed (`ping.<kind>.log`, for example "tilda_rimwalk needs a hand"). Your own ping adds none.
- **FRAY:** nobody shares your side, so the wheel is disabled with `ping.unavailable_fray`. Pings still reach your own team of one and are shown to nobody else.
- **Accessibility:** every marker is a distinct shape, so none depends on colour. `access.subtitles` does not gate the feed line (it is information, not announcer text).

---

## 6. Announcer and kill-feed lookup

The announcer has tonal stingers, no voice, so the banner and the feed carry the words. `announce.*` strings are looked up by the sim's announce key, then a variant, then `.title` and `.sub`.

| Sim emits | Lookup | Params the UI adds |
|---|---|---|
| `match_start` | `announce.match_start.<mode>` (rift, bridge, fray, practice) | none |
| `first_blood` | `announce.first_blood` | `name` (the player) |
| `multikill` `{n}` | `announce.multikill.<n>` for 2-5 | `name` |
| `takedown.streak` (derived) | `announce.streak.<n>` for 3-6, `.7` for 7 or more | `name`, `n` |
| `shutdown` `{gold, victim}` | `announce.shutdown` | `name`, `victim` (resolved from the player id), `gold` |
| `structure_destroyed` `{def, by}` | `announce.structure_destroyed.<family>.<own\|foe\|spec>` | `team` for `spec` |
| `structure_respawned` `{def}` | `announce.structure_respawned.<family>.<side>` | `team` for `spec` |
| `objective_taken` `{unit}` | `announce.objective_taken.<unit>.<own\|foe\|spec>`, `.other` for any other unit | `team` for `spec` |
| team wipe (derived) | `announce.team_wipe.<own\|foe\|spec>` | `team` for `spec` |
| `eliminated` `{placement}` | `announce.eliminated.you` or `.other` | `name`, `ord`, `total` |
| `sudden_death` | `announce.sudden_death` | none |
| `surrender_vote` `{yes,no,needed}` | `announce.surrender_vote` | the three counts |
| `surrender_passed` / `surrender_failed` | `announce.surrender_<result>` | none |
| `shop_denied` `{item, reason}` | `announce.shop_denied.<reason>` (`access` resolves to `access_rift`, `access_bridge` or `access_fray` first) | none |
| `practice` `{action}` | `announce.practice.<action>` | none |
| match end | `announce.victory` / `announce.defeat`, replaced by the post-game banner | none |

- **Structure family:** `needle_outer`, `needle_inner` and `needle_bell` map to `needle`; `lantern` and `hourbell` stand alone; anything else is `other`.
- **Side:** `own` when the fallen structure or the objective-taker is the viewer's team, `foe` when it is the other team, `spec` for a spectator (names the side with `{team}`: Aubade or Serenade).
- **Derived events:** the sim emits streaks only as `takedown.streak` and has no team-wipe event, so the client derives both: streak at 3 and above on each of your takedowns; a wipe when every fighter of a team is down at once (RIFT and BRIDGE).
- **Texts:**

| Moment | Title | Sub |
|---|---|---|
| First takedown | First takedown | `{name}` opens the count. |
| 2 / 3 / 4 / 5 in a row | Two tolls / Three tolls / Four tolls / Full peal | `{name}` takes two in quick succession. ... takes five in a row. Every bell is ringing. |
| Streak 3 / 4 / 5 / 6 / 7+ | Kindled / Burning / Blazing / Noonbright / Beyond shadow | `{name}` has 3 takedowns without falling. |
| Streak ended | Run ended | `{name}` ends the run of `{victim}`. +`{gold}` Gleam. |
| Team wipe | **Lamps out** | Your whole team is down. Regroup when the first of you returns. |
| Needle falls | Your Needle has fallen / Enemy Needle down | Hold the next one. / The road is open. Press on. |
| Lantern falls | Your Lantern has fallen / Enemy Lantern down | The other team gains Lanternwake until it relights. / Your team gains Lanternwake until it relights. |
| Hourbell falls | Your Hourbell has fallen silent / Their Hourbell is silent | The light holds for another day. / The match is yours. |
| Sunsplinter | Sunsplinter taken / lost | Your team gains a Splinter. |
| Longshade | Longshade falls / lost | The Long Shade is yours for the siege. |
| Glasshorn / Resinback | Glasshorn taken / Resinback taken | Your team gains Clearglass / Resinburn for 90 s. |
| Sudden death | Sudden death | Structures lose their protection and respawns slow down. |
| FRAY out | `{name}` is out / You are out | Placed 7th of 10. / Your hour ends here. 7th of 10. |

- **Kill feed lines** (`killfeed.*`): "tilda_rimwalk took down juniper_dial", "... with ines_at_dusk and kit_lanterns", "x fell to a Needle", "Lamps out for Serenade". Tone: nobody is "killed", "slain" or "owned".
- **Ordinals** come from `ordinal.1` to `ordinal.10`; `ordinal.n` ("{n}th") is the fallback.

---

## 7. Death recap

Opens 1.2 s after your fighter falls (never during the final-blow effect), anchored left of centre so the centre 40% x 50% stays free, 360 px wide. It never blocks the shop or the map and closes on respawn, Esc or its Close button.

- **Header:** `recap.taken_down_by` ("Taken down by Longshade") or `recap.fell_to` for a structure or Wick; the killer's portrait; `recap.respawn` countdown.
- **Body:** `recap.window` ("Damage taken in the last 15 s"), then one row per source from `SimApi.damageLog(player)` grouped by source: portrait, name, ability (or `recap.basic`), a stacked bar by damage type, the total, and `recap.ago` for the last hit. Rows sort by total, largest first. A grand `recap.total` closes the list.
- **Damage types:** physical (Chalkstone, upright numerals), magic (Orchid-rose, oval chip), piercing (ink with a halo, "Ignores armor and resist"); each with its `dmg.<type>_tip`. Piercing is the wording for damage that ignores armor and resist; the phrase "true damage" is never shown.
- **One tip line** from the dominant type: `recap.tip.phys`, `.magic`, `.pierce`, `.mixed`, plus `recap.tip.burst` when the whole sum landed inside 2 s. Factual, never a verdict.
- **Empty:** `recap.none` (a structure or a self-inflicted fall).
- **Sound:** `m_self_down` on the fall, no extra cue on the panel.

---

## 8. Scoreboard

Hold the scoreboard key (default Tab) in a match, or open the Scoreboard tab post-game. Not always-on, so it may cover the centre while held.

- **Team modes:** two blocks of five rows, Aubade on the left or top as on the map for spectators, "Your team" above "The other team" for players (`score.team.*`). Block header: kills and structures down for the team, and the Gleam lead for you.
- **Columns** (`score.col.*`): Player (portrait, name, bot tag), Fighter, Role (RIFT), Lv, T / F / A (takedowns, falls, assists), Wicks, Gleam, Items (6 slots), and on hover Damage, Taken, Healing, Streak, Bounty. Hover and focus show the stat tooltips (`stat.<key>.name` and `.tip`).
- **Rows:** your row has the double frame, allies rounded ends, enemies chevron ends. Down players dim to 60% with their respawn timer. Fog rules apply: enemy items and levels are shown as last seen, enemy Gleam is hidden (a dash).
- **Post-game** adds the finished stats (damage, healing, structure damage, items) and marks the best in the match per column with a chalk hour-tick.
- **FRAY:** the Hour Board (§9) opens expanded with the full columns instead of two blocks.

---

## 9. FRAY Hour Board

Top right, 220 x 236 (2.50%); the kill feed docks directly under it. Ten rows of about 23 px (type never below 12 px).

- **Row:** place number, seat glyph and seat colour chip, name, lives pips (4), takedowns (Mono). Your row is Noonwhite with the double frame and your glyph; every other row uses its seat colour from the bible's table (Crimson, Olive, Lime, Green, Cyan, Blue, Indigo, Violet, Plum, Rose) with its glyph. `fray.seat.<n>` holds the colour names; the roman numeral (I to X) is drawn by code, because the string `VI` trips the deny-list entry "Vi" and so is not stored in `strings.en.json`.
- **Order:** fighters still in are ranked by takedowns then damage to fighters; fighters out sit below in placement order and keep their place (`hourboard.hint`). The leader gets a round wedge marker.
- **Out:** the row dims, lives pips empty, the cell reads `Out` and the final place (`hourboard.out`).
- **Header:** `hourboard.title`, and `First to 12` with a progress ring around the leader's score. Time limit under it when under 2 minutes.
- **Seat colour legibility:** Crimson, Olive, Violet and Plum take a 1 px chalk keyline; Lime and Cyan an ink keyline. The glyph is the sure key: filled or hollow, round or straight, upright or diagonal.
- **Options:** Stamp-forward (glyphs at 150%, fill at 60%) is the default with any colourblind mode; Simple colours draws every other fighter in the enemy colour with its glyph (`settings.access.fray.*`).
- **On the Dial Bar** your seat colour lines the bar plate and your lives show as 4 pips beside the portrait; `hud.fray.lives`.
- **Post-game:** the board expands, the final order is fixed, and the banner reads `fray.place_of` with the placement line.

---

## 10. BRIDGE Lot UI

BRIDGE draft (`random_bench`), the Lot window runs 25 s, then a 10 s finalize. Data comes from `DraftState` (`seats`, `bench[team]`, `timer`) and `queues.bridge_standard.bench` (size 2, 1 draw). The size is data: the UI never hard-codes 2 or 1.

- **Layout:** left, "Your draw" (large splash, name, class, a one-line job); centre, **the Lot** (`lot.team_lot`): the team's bench as fighter cards, each with a Swap button; right, the team's five seats with their current fighters, shown as drawn; top, the 25 s ring and `lot.window`; bottom, the ticker of Lot activity (`lot.teammate_swapped`, `lot.teammate_drew`).
- **Swap:** pressing Swap on a bench card sends `{a:'benchSwap', fighter}`. Your old fighter takes that card's place on the Lot (`lot.swap_hint`), so a teammate can take it. The cards cross over in 360 ms; `lot.swap_done` toasts.
- **Draw again:** one button, `lot.draw_again`, with `lot.draw_left` or `lot.draw_none`; sends `{a:'reroll'}`. The old fighter joins the Lot (`lot.draw_hint`); the Lot keeps its newest cards.
- **No Keep button:** staying with your draw takes no action; the window simply ends. If every seat is quiet the screen says nothing more than the timer.
- **Finalize:** the loadout panel (skin, spells, boons) and trades, as in RIFT.
- **States:** the Lot is empty (`state.empty.lot`), no draws left, the swap target was taken a moment earlier (`error.draft.not_on_bench`), the last 5 s turn the ring HARM.
- **Fiction:** the gorge-keepers send fighters across by lot, so the draw is shown with a lot-drawing motion, never a "shuffle".
- **Sound:** `ui_hover_fighter` on cards, `ui_click` on Swap, `ui_lockin` when your draw is confirmed at the end of the window (and as the finalize starts), `ui_notify` for teammate swaps.

---

## 11. Spectator-clarity rules

Spectators have no side, so relationship colours do not apply. These rules hold for any spectator view (and for the post-game replay graph and scoreboard):

1. Sides use their absolute colours and marks: Aubade is Dawn azure `#3F9CFF` with the spire mark, Serenade is Dusk marigold `#FF9A1F` with the dome mark. Spectators never see Noonwhite (no self) or the ally/enemy swap.
2. Every colour is paired with its mark and its shape code (rounded bar ends and ring for one side, chevron ends and notched ring for the other). Text names the side next to the mark: "Aubade ▲", "Serenade ◠" (`team.spectator_a`, `team.spectator_b`).
3. Screen-left is Aubade and screen-right is Serenade, in the map, the sky strip, the scoreboard and the kill feed, so a viewer never has to learn a mapping.
4. Announcer strings use the `.spec` variants with `{team}`, never "your" or "their".
5. Telegraphs are drawn in the caster's side colour (fill 16 to 30%, edge 90%, 3 px) with the caster's mark at the origin, because "enemy" is meaningless to a spectator; the edge is still the brightest part.
6. FRAY uses the seat colours and glyphs for every seat, with Stamp-forward as the default for any colourblind mode.
7. The grade and fog: spectators see the full map (no fog desaturation) and may toggle a team's vision overlay. The Standing Shadow still keeps colour and a hard edge.
8. The camera is the spectator range (20 to 44 m zoom); the personal Dial Bar is replaced by a read-only inspector for the followed fighter (portrait, HP, resource, ability cooldowns).
9. No text under 12 px at any scale, and every state (down, respawning, recalling) has an icon as well as a dim.

---

## 12. Settings inventory

Five tabs; changes save as you make them. Copy lives in `settings.<tab>.<field>.label` and `.desc`, options in `.opt.<value>`. Defaults are `src/session/settings.ts`.

| Tab | Setting | Control | Default | Range or options |
|---|---|---|---|---|
| Video | Quality preset | segmented | High | Low, Medium, High, Ultra, Custom (a manual change sets Custom) |
| Video | Render scale | slider | 1.0 | 0.5 to 2 |
| Video | Shadows | segmented | Medium | Off, Low, Medium, High |
| Video | Ambient occlusion | segmented | Half | Off, Half resolution, Full resolution |
| Video | Bloom | toggle | On | |
| Video | Edge smoothing | segmented | SMAA | Off, SMAA, MSAA |
| Video | Effects detail | segmented | Many | Few, Some, Many |
| Video | Scenery detail | segmented | Dense | Sparse, Normal, Dense |
| Video | Frame rate limit | select | Uncapped | Uncapped, 30, 60, 120, 144 |
| Video | Sharpness (max pixel ratio) | slider | 1 | 0.5 to 4 |
| Video | Fullscreen | toggle | Off | |
| Audio | Master, Music, Effects, Announcer, Interface, Ambience | sliders | 80, 60, 80, 90, 70, 60% | 0 to 100% |
| Audio | Mute in the background | toggle | On | |
| Controls | Keys: Ability 1-3, Ultimate, Battle spells 1-2, Item slots 1-6, Recall, Open shop, Scoreboard (hold), Ping (hold), Attack-move, Stop, Camera lock, Centre camera (hold), Self-cast modifier | keycaps | Q W E R · D F · 1-6 · B P Tab G A S Y Space Left Alt | any key or mouse button; a conflict moves the key and says so (`toast.bind_conflict`) |
| Controls | Quick cast | toggle | Off | |
| Controls | Lock camera to your fighter | toggle | Off | |
| Controls | Edge pan | toggle | On | |
| Controls | Pan speed | slider | 50% | 0 to 100% |
| Controls | Attack on move | toggle | Off | |
| Controls | Self-cast key | keycap | Left Alt | |
| Accessibility | Colourblind mode | segmented | Off | Off, Deutan (green-weak), Protan (red-weak), Tritan (blue-yellow); each shows its swatches and `opt_desc` |
| Accessibility | Team colours | swatches | Noonwhite, Dawn azure, Dusk marigold, Dialstone | override self and enemy; a pair under delta-E 20 warns (`settings.access.colors.warn`) |
| Accessibility | FRAY seat colours | segmented | Automatic | Automatic, Standard, Stamp-forward, Simple colours |
| Accessibility | UI scale | slider | 100% | UI offers 80 to 150% (nothing renders below 12 px) |
| Accessibility | HUD scale, Minimap scale | sliders | 100% | 50 to 200% |
| Accessibility | Reduce motion | toggle | Off | 120 ms fades, camera cuts |
| Accessibility | Screen shake | slider | 100% | 0 to 100% |
| Accessibility | Subtitles | toggle | On | announcer text |
| Gameplay | Damage numbers | toggle | On | |
| Gameplay | Ally indicators | toggle | On | |
| Gameplay | Health bar ticks | toggle | On | |
| Gameplay | Minimap side | segmented | Right | Right, Left |

- **Video ladder** (a preset sets all of these at once; `fpsCap` and `fullscreen` are never touched): Low 0.75 / shadows 1 / AO off / bloom off / AA off / effects 0 / scenery 0 / DPR 1; Medium 0.9 / 2 / half / on / SMAA / 1 / 1 / 1; High 1.0 / 2 / half / on / SMAA / 2 / 2 / 1; Ultra 1.0 / 3 / full / on / SMAA / 2 / 2 / 2. Telegraphs look identical on every tier (`settings.video.note`).
- **Colourblind modes** change relationship colours per the bible (deutan and protan move enemies to `#FFC21F`, tritan to `#FF3D6E`, deutan and tritan move allies to `#2FA8FF`) and Stamp-forward becomes the FRAY default. Shape codes are on in every mode.
- **FRAY seat colours** is a UI-only preference today (`UiPrefs.frayColors`, stored per device). Request to SESSION: promote it to `Settings.access.frayColors`.
- **Reset:** Reset this tab and Reset to defaults, both with a one-line confirm.

---

## 13. Audio cue map

Cue ids are VOCAB's; the engine decides voices, ducking (voice over sfx over music) and the buses. UI cues fire on pointerdown, not click; hover is rate-limited to the token minimum. The simulation is silent: every match cue comes from a `SimEvent` or `WorldView` change, and the UI never plays a sound for what the sim already says.

### 13.1 Menu and UI

| Cue | Fires on |
|---|---|
| `ui_hover` | pointer or focus entering a button, tab, card, row |
| `ui_hover_fighter` | pointer or focus entering a fighter card (draft, collection, Lot) |
| `ui_click` | pointerdown on any control with no cue of its own |
| `ui_confirm` | primary CTA (Find match, Continue, Start), modal confirm, nav change to a new screen |
| `ui_back` | Back, Esc, Cancel, Close, Decline, leaving a screen |
| `ui_tab` | tab or segmented change (settings tabs, collection tabs, profile tabs) |
| `ui_toggle` | toggle, checkbox, a selected option |
| `ui_slider` | slider drag, one tick per step (rate-limited) |
| `ui_error` | refused action: locked queue, insufficient Candles, shop refusal in match, invalid draft action, error toast |
| `ui_notify` | info or ok toast, party change, incoming trade request, teammate Lot swap |
| `ui_queue_search` | search starts, then a soft pulse every 8 s |
| `ui_queue_pop` | ready check appears (found) |
| `ui_accept` | Ready pressed, trade accepted |
| `ui_lockin` | Lock in (pick, Fray pick, finalize), Lot window ends on your fighter |
| `ui_ban` | ban submitted |
| `ui_purchase` | store purchase confirmed by the session |
| `ui_equip` | skin equipped |
| `ui_currency_tick` | Candles counting up or down (post-game, shop balance), rate-limited |
| `ui_reward_reveal` | post-game rewards panel opens |
| `ui_level_account` | account level up |
| `ui_shop_buy` / `ui_shop_sell` / `ui_shop_undo` | the in-match shop: `buy`, `sell` events and the undo command |

### 13.2 Match events

| Cue | Fires on |
|---|---|
| `m_countdown` | each of the last 5 seconds of `phase = pregame` |
| `m_match_start` | announce `match_start` |
| `m_level_up` | `levelUp` for your seat |
| `m_gleam` | `gold` event for your seat (rate-limited) |
| `m_takedown` | `takedown` where you are the killer or an assist |
| `m_ally_down` | `death` of an ally fighter other than you |
| `m_self_down` | `death` of your fighter |
| `m_respawn` | `respawn` for your seat |
| `m_wave_spawn` | `wave` (RIFT, BRIDGE), low and at most once per wave |
| `m_recall_start` / `m_recall_done` | `recall` state `start` / `done` for your seat |
| `m_sunmote` | `pickup` of a Sunmote by your seat |
| `m_enemy_windup` | an enemy `area` or `cast` with a T3 or higher wind-up in view (the shared shade-breath swell), spatial |
| `m_ping_<kind>` | `ping` from an ally, one cue per kind (alert, danger, onmyway, missing, assist, push, vision, objective, retreat) |
| `m_objective_ally` / `m_objective_enemy` | announce `objective_taken`, own side or other side |
| `m_structure_ally_fall` / `m_structure_enemy_fall` | announce `structure_destroyed`, your structure or theirs |
| `m_announce_major` | `first_blood`, `multikill` 3 to 5, streak 5 and above, team wipe, Lantern or Longshade events |
| `m_announce_minor` | `multikill` 2, streak 3 and 4, `shutdown`, surrender result, structure respawned |
| `m_sudden_death` | announce `sudden_death` |
| `m_eliminated` | FRAY `eliminated` for any seat (yours also plays `m_self_down`) |
| `m_victory_sting` | match end, your team won (team modes) |
| `m_defeat_sting` | match end, your team lost; the held B4, never mocking |
| `m_placement_sting` | FRAY end, any placement (the G#4 ending) |

### 13.3 Combat (spatial, listener at the camera target)

Cues named by an ability's `present.sfx` or a `hit` / `area` event's `sfx` field play as authored. When none is named, the fallback by event:

| Event | Fallback cue |
|---|---|
| `attack` | `c_swing_light` or `c_swing_heavy` (melee), `c_shot_bow`, `c_shot_bolt_lumen` or `c_shot_bolt_shade` (ranged by attack art), `c_thrown` |
| `projectile` | `c_proj_whoosh` |
| `damage` | `c_hit_phys_light`, `c_hit_phys_heavy`, `c_hit_magic`, `c_hit_true` by `dtype` and size; `c_crit` when `crit` |
| `cast` | `c_cast_lumen` or `c_cast_shade` by the ability's VFX family; `c_cast_charge` while a cast has a long wind-up; `c_cast_big` for T3+ |
| ultimate | `c_ult_windup` at the start of the cast, `c_ult_release` at the effect |
| `dash` / `blink` | `c_dash` / `c_blink` |
| `area` | `c_slam`, `c_burst_lumen`, `c_burst_shade` by shape and VFX family; a zone plays `c_zone_loop` for its duration |
| `status` | `c_stun`, `c_slow`, `c_root` (other kinds use `c_buff`) |
| `heal` / `shield` | `c_heal` / `c_shield` |
| summon | `c_summon` |
| structure attack | `c_needle_shot` on fire, `c_needle_hit` on impact |
| `death` of a fighter | `c_death_shatter` |
| `death` of a Wick | `c_wick_die` |
| monster events | `c_monster_roar` on aggro or a big cast, `c_monster_hit` on its hits |
| `structure` | `c_structure_fall` (plus the `m_structure_*_fall` announcer cue) |

### 13.4 Music

| Id | When | Notes |
|---|---|---|
| `mus_menu` (60 BPM) | home, play, queue, collection, shop, profile, settings, practice, custom | crossfade 1.2 s; ducked during the ready check |
| `mus_draft` (90 BPM) | draft, Lot, Fray pick, loadout, loading | enters on the draft route |
| `mus_match_rift` / `mus_match_bridge` / `mus_match_fray` (120 BPM) | match | the `intense` layer fades in (2 bars) while 3 or more fighters are in a fight, an Hourbell is under attack, a FRAY seat is on its last life, or sudden death is on; out after 8 s of quiet |
| `mus_postgame` (60 BPM) | post-game | starts when the sting ends |

The motif is A4, E5, D5, B4 and is ended by F#5 (RIFT, victory), G4 (BRIDGE), G#4 (FRAY) or a held B4 (defeat).

---

## 14. Strings: conventions

`content/strings.en.json` is one flat object of dot-namespaced keys, read through `CatalogView.t(key, fallback, params)`.

- **Placeholders** are `{name}` with a word-character name. `{n}` is a bare number (formatted with thousands separators). `{t}`, `{elapsed}` and `{estimate}` are durations that **already include their unit** ("12 s", "1:24"), so the strings never write "{t} s". `{price}` is a formatted amount with the currency ("2,250 Candles"); `{ord}` is `ordinal.<n>`; `{key}` and the action placeholders in `hint.*` are key labels from the player's binds.
- **Namespaces:** `app`, `nav`, `common`, `ordinal`, `btn`, `state` (loading, empty, error, locked), `error` (purchase, equip, draft reasons, rename), `toast` (60 characters or fewer), `play`, `custom`, `practice`, `party`, `queue`, `ready`, `draft`, `lot`, `fray`, `loadout`, `loading`, `team`, `hud`, `ping`, `announce`, `killfeed`, `recap`, `dmg`, `score`, `hourboard`, `stat`, `difficulty`, `status`, `hint`, `a11y`, `postgame`, `grant`, `shop`, `collection`, `profile`, `settings`.
- **Keys the code already reads:** `ready.title`, `queue.lockout`, `queue.timeout`, `queue.declined`, `queue.dodged`, `queue.cancelled`, `session.default_name`. `queue.lockout` starts with a space on purpose, because the toast concatenates it after the reason.
- **Grant lines:** `GrantSummary.lines[].label` maps to `grant.<label>`: `victory`, `defeat`, `minutes_played`, `cap`, `placement`, `account_xp`, `first_win`, `first_win_xp`, `no_rewards`, `left_match`.
- **Session reason codes** map to `error.purchase.<reason>`, `error.equip.<reason>` and `error.draft.<reason>`.
- **Voice** (WORLD §5): second person, present tense, sentence case, exact numbers with units, no exclamation marks, dignified defeat. World words appear only in celebration, flavour and announcer slots. Errors, settings, payments and reports are plain English. Everything passes the deny-list prose rules; the only deliberate omissions are the roman seat numerals (see §9) and the phrase "true damage" (reworded to "piercing", "ignores armor and resist").

---

## 15. Open items for other lanes

- **UI:** draw roman numerals I to X for FRAY seats in code. Resolve `{key}` placeholders in `hint.*` from the player's binds. Format `{t}` with `fmtWait` and `{price}` with the currency name from the catalog.
- **UI:** the Almanac tile points at `profile` because no Almanac screen exists in this slice. When it does, change that tile's `screen`.
- **UI / ART:** icons and art this content references and that do not exist yet: `assets/ui/icons/nav/{home,play,collection,shop,profile,settings}.svg`, `assets/ui/icons/currency/candles.svg`, `assets/ui/home/{feature,tile_ranked,tile_almanac,tile_practice,tile_collection}.webp`, `assets/maps/menu_rim/scene.glb`.
- **SESSION:** promote the FRAY seat colour option to `Settings.access.frayColors`. Derive streak and team-wipe announcements, or emit them as announce keys (`streak`, `team_wipe`).
- **SESSION:** the draft host ends the bench and finalize phases only on their timers. An early-out when every human has confirmed would shorten BRIDGE and RIFT drafts.
- **LEAD:** `ROSTER.md` §2.2 assumes a Lot of 3 and a full deal of 16 fighters; `queues.json` sets `bench.size` 2 (14 of 16 dealt), as `modes_economy.md` §5 says. The UI reads the queue; fix the ROSTER paragraph.
- **LEAD:** `store.json` is generated. After a skin is added run `node tools/gen_store.ts` (or `--check`). Legend skins would cost 3,600 Candles; the 1,350 Prisms row in `modes_economy.md` §8 is out of scope for this slice (no premium currency).
