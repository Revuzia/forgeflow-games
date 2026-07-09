# Arcane Realms TCG — Changelog

## v1.3.9 — 2026-07-09 (Campaign story rework, goons, final boss, hero visibility)

### Campaign is a real story now — goons per step, boss as the finale
- Each chapter's first three battles are now fought against a **different goon**
  (a lieutenant of that realm's Warden) — not the boss talking every round. The
  goon speaks with **their own card art and name** (orange nameplate), and the
  dialogue is **multi-line and story-connected**: you're crossing the five realms
  to reach the failing **Arcane Nexus**, and each Warden's minions test you before
  the Warden yields their **Seal** and warns of the darkness beneath.
- The chapter boss (Thornqueen, Lich-Lord, Flame-Khan, Tidecaller, Lightwarden)
  is now strictly the **4th/final battle** of its chapter, and gives you a Seal.
- Ch5's finale re-framed: Lightwarden Serathiel reveals the five Seals were never
  holding the realms apart — they were **caging Aetherion**, the world-before-it-
  was-divided.

### New final chapter — "The Sundered Nexus" (Chapter 6)
- A true endgame: **Aetherion, the Convergence** — a boss that is **all five
  biomes fused into one** (ember + tide + grove + dawn + grave), with a 30-card
  deck drawn from every realm's legendaries, epics, and rares. New xAI-generated
  portrait (`cm_convergence.jpg`).
- Three escalating goon battles first (Echo of Ash and Root, The Hollow Crown,
  The Fivefold Mirror), then Aetherion at the Nexus core. Rewards preserve full
  card obtainability; "Champion of the Nexus" achievement now = clear all **24**
  battles. World-map adds the ch6 nodes converging on the map's heart.

### 3D hero characters clearly visible + hand-count icon removed
- The enemy 3D hero was raised and **brought forward** off the hand row so it's no
  longer occluded — both heroes now read prominently (verified in-match).
- The **✋ hand-count HUD icon is gone** (both players).

Selftest 214 (6 chapters / 24 battles, obtainability preserved). Cache-bust
`?v=13` → `?v=14`.

## v1.3.8 — 2026-07-09 (Fixed minis, multi-attack, 3D hero characters)

### All 9 broken sketchfab minis replaced with Meshy models
- The original curated sketchfab minis had broken rigs/degenerate bounds — the
  dragon sprawled flat "in the ground", the reaper sank under the board, and
  one even loaded as a wireframe bed. `Box3` couldn't measure them, so the
  feet-on-table normalization failed. **Regenerated all 9 via Meshy from card
  art** (the proven pipeline); they now stand correctly — the dragon has wings,
  every model reads on-model. `MINI_MAP` reset to standard Meshy params.
  (270 credits, 30/model; gltf-transform optimized to 1.2–6.6 MB.)

### Multi-attack queue
- Line up several attacks before resolving: click a creature → click its target
  and it **queues** (a committed orange arrow persists); repeat for more, then
  press **⚔ Attack (N)** — or End Turn — and they all resolve in order. Attacks
  made illegal by earlier ones (e.g. a target that died) are skipped.

### 3D hero characters (replaces the flat portrait disc)
- Each realm's hero is now a **3D Meshy character** (from the portrait art)
  standing behind its side, facing you, with a gentle idle sway — instead of a
  flat circular image. 6 heroes generated + optimized (1.6–5.2 MB). The hero is
  still clickable/targetable (the disc ring remains as the glow/target base).

Selftest 208→214 (hero-asset gates). Cache-bust `?v=12` → `?v=13`.

## v1.3.7 — 2026-07-07 (Pause menu, no card-pop, frozen icon, lower hand)

- **In-match pause menu is now full-featured.** The gear opens Music, Effects,
  Rich particles, Screen shake, Fast animations, Gameplay tips, plus **Resume /
  Concede / 🏠 Main Menu** — the standard pause-menu set, not just music/effects.
- **Cards no longer pop/tap when attacking or dying.** Removed the exhaust
  scale-shrink (cards held a constant size; the dim + 💤 badge and the mini
  lunge convey "used"). Death now sinks + fades instead of scaling down.
- **Frozen shows a ❄ badge** top-right (priority over the 💤 exhaust marker).
- **Hand lowered** so more of the board — and the hero area — is visible.

Selftest 208/208. Cache-bust `?v=11` → `?v=12`.

_Next: replacing the 9 broken curated sketchfab minis with Meshy versions
(regenerating), 3D hero characters, and a multi-attack queue._

## v1.3.6 — 2026-07-07 (Enemy hand backs read as proper cards)

- **Enemy hand no longer foreshortens into squares.** The opponent's face-down
  hand row was tilted *away* from the camera (`rotX +0.5`) at the far table
  edge, so from the high viewing angle the backs compressed into small squares.
  Now they tilt *toward* the camera (`rotX -0.42`) like the player's own hand,
  brought slightly forward and up-scaled — the backs read as proper portrait
  cards. (This is why clearing cache didn't help: the hand row was the same in
  every build; only the board cards had ever been tilted.)

Selftest 208/208. Cache-bust `?v=10` → `?v=11`.

## v1.3.5 — 2026-07-07 (Nameplate corners, board card cleanup, clean hover)

Owner feedback on the on-board card readout.

- **Stat orbs back to the card's bottom corners** (attack bottom-left, health
  bottom-right) via exact `mesh.localToWorld` corner projection — no longer
  clustered centered below.
- **Exhaust 💤 → top-right corner**; keyword badges → top-left corner.
- **Swift badge removed** (owner) — it only matters the turn of summon and the
  keyword still shows in the full card on hover. Guard/Flying/etc. still shown.
- **Cost gem removed from board creatures** — the top-left number was mana cost
  (irrelevant in play, mistaken for attack). Cost still shows in hand and on
  the hover card. Board creatures now read cleanly: attack + health only.
- **Hover shows the full card, overlapping everything.** Viewing a board
  creature enlarges to the complete rules-text card and now hides ALL orbs/
  badges so nothing bleeds over it.

Selftest 208/208. Cache-bust `?v=9` → `?v=10`.

## v1.3.4 — 2026-07-07 (Mini polish: nameplates, facing, no card-shake, Guard hint)

- **Stat orbs never cover the models.** Moved atk/hp orbs + keyword/exhaust
  badges to an **HTML overlay** (`#np-layer`) positioned a fixed number of
  pixels *below* each creature on screen — always readable, always clear of
  the animated body, for near and far models alike (world-space orbs fought
  perspective). Crisp CSS gems; hidden while a card is hover-enlarged.
- **All models face the viewing player.** Dropped the 180° flip on enemy
  minis — mine and the enemy's both face the camera so you see every model's
  front (in PvP each client sees both sides facing themselves).
- **Cards no longer tap/tip/shake on attack.** The attack lunge now moves the
  **3D model**, not the card — the card holds perfectly still (verified: card
  position unchanged through a lunge). Commons (no mini) do a flat forward
  slide with no lift/shake.
- **Guard reminder.** When an enemy Guard blocks your attack, a toast explains
  it ("🛡 Blocked by Guard — destroy the enemy Guard first"), plus a one-time
  coach tip the first time a Guard constrains your targets.

Selftest 208/208. Cache-bust `?v=8` → `?v=9`.

## v1.3.3 — 2026-07-07 (Meshy 3D minis: full legendary+epic coverage, board polish)

### 3D minis — every legendary & epic creature now has one
- Generated the 13 remaining creatures (4 legendaries + 9 epics) via **Meshy
  Image-to-3D from each card's art**, so the model IS the card's character.
  All 13 legendaries + all 9 epics (22/22 marquee creatures) now spawn a mini.
- Raw Meshy output is 20–57 MB each (4K textures, 340k tris); a
  `gltf-transform` pass (512px webp + ~6% decimate + vertex quantization)
  brings each to **0.7–2.5 MB** with no visible quality loss. Tool +
  `tools/gen_meshy_minis.py` committed; raw GLBs gitignored.
- Cost: 476 credits for 13 models (clean rate **30/model**).

### Tier hierarchy: legendaries grand, epics plain
- **Legendaries**: idle animation (breathing bob + yaw sway), a realm ground
  glow disc + rim light, and **element-based FX auras** — ember embers, tide
  frost mist, grove spores, dawn light motes, grave shadow wisps, neutral
  arcane sparkles.
- **Epics**: the bare model — smaller scale (1.25–1.4 vs 1.5–1.7), no FX, no
  disc, no idle. Clear visual step-down from legendaries.

### Board readability & camera
- **Stat orbs (atk/hp) and keyword/exhaust badges now always render on top**
  of the 3D minis (`depthTest:false`) — health & damage are never hidden,
  even under a big model or a neighbour's overhang.
- **Scroll-wheel zoom**: dolly in to inspect cards & animated legendaries,
  scroll back out to the default framing.
- Board cards shrunk (less overlap); **enemy cards tilt toward the camera** so
  they read as rectangles, not foreshortened squares; enemy hero portrait
  moved back to clear the card row.
- Mini footprints clamped tighter (~a card width) so wide models (treant,
  colossus) don't sprawl over neighbours.

### Selection highlight
- Replaced the thick green under-glow with a **crisp thin frame**, and added a
  **Settings → Highlight color** swatch picker (cyan/green/gold/violet/pink/white).

Selftest 208/208. Cache-bust `?v=7` → `?v=8`.

## v1.3.2 — 2026-07-07 (New-player experience: tutorial, coach tips, no phases, exhaust rework)

Owner feedback pass (3 screenshots).

### Exhaust replaces tapping
- Creatures **no longer rotate 90°** after attacking. A spent creature now
  **dims (52% darker), shrinks slightly, and shows a 💤 badge** top-right —
  clearly "used" at a glance without turning the card. All user-facing copy
  says "exhausted" instead of "tapped".

### Phase UI removed — the game just flows
- The DRAW/MAIN/COMBAT/END strip and the "To Combat" button are **gone**.
  Attacking a creature auto-enters combat behind the scenes (this already
  worked — the button was redundant). SPACE now simply ends your turn.
- The "creatures after combat" rule is taught contextually (see tips) and
  the blocked-action toast explains it plainly.

### Coach tips for new players (Settings ▸ "Gameplay tips")
- One-time dismissible hints that appear top-center at the right moment:
  how to play cards (first match), how to attack (first ready creature),
  "attacking locks out summoning this turn" (first main-phase attack with
  creatures still in hand), and what exhaustion means (first attack).
- Each shows once ever (persisted); the Settings toggle disables them, and
  re-enabling resets the seen-list so they play again.

### How to Play — 6-page illustrated tutorial from the main menu
- 📜 menu entry between Collection and Settings: The Goal → Playing Cards →
  Attacking → Order Matters → all 11 Keywords → Grow Your Legend
  (campaign/packs/deck builder/PvP). Last page flows straight into
  deck-select ("To Battle").

### Layout fixes
- **Deck-select + online-lobby modals are now dead-centered** (a stray
  `position:relative` was overriding the centering wrapper).
- **Short viewports** (hub iframe, small laptops): compact menu — vh-scaled
  title/buttons, tighter panel, footer hidden, panel scrolls as a backstop.
  No more footer overlapping the Collection button.
- Cache-bust `?v=5` → `?v=6`; selftest 160/160.

## v1.3.1 — 2026-07-07 (Main-menu polish + published on forgeflowgames.com)

- **Main menu redesigned** (owner feedback: uneven button sizes): uniform
  400px plaque buttons in an ornate blurred panel with gold corner accents,
  circular icon medallions, centered smallcaps labels, hover lift + gold rim
  + sheen sweep, staggered entrance animation, flourish divider under the
  title. "Play vs AI" is now a solid-gold hero button. Footer reads v1.3.
- **Published to forgeflowgames.com**: registry row flipped
  `unpublished → published` at owner request (was deployed dark per the
  publish-toggle rule). Verified live on the hub.
- Cache-bust `?v=4` → `?v=5`; selftest 160/160.

## v1.3.0 — 2026-07-07 (Spell FX, world map, 3D legendary minis)

Owner-directed pass #3 (2 reference screenshots + hybrid-3D green light).

### Three.js spell FX — every spell now has a choreography
- New FX kernel: `projectile()` comet (quadratic-bezier arc, white-hot core in
  a colored halo, ember trail, **traveling PointLight** that sweeps the board,
  resolves at impact so damage lands with the hit), `explosion`, `frostNova`,
  `holyPillar`, `shadowRend` (implosion→burst), `natureBurst`, `aoeSweep`.
- `match.spellChoreography()` routes every `play-spell` event by realm+intent:
  offensive single-target = comet from caster hero → detonation (the Fireball
  moment); AoE = comet → staggered sweep across targets; heals/buffs/utility
  get pillar/burst variants. Camera shake on big hits.
- Verified in-engine: Fireball cast → mana 10→6, card to grave, target 7hp→2,
  comet + explosion FX fire (screenshot-verified with a slowed test comet).

### Campaign world map (replaces the vertical chapter list)
- New generated 5-region fantasy map (`worldmap.jpg`): Verdant Marches forest,
  Sunken Crypts marsh, Ashen Peaks volcanoes, Drowned Depths maelstrom,
  Celestial Spires — one region per chapter, labeled with commander names.
- Battles are medallion nodes placed on the art; the route is drawn as an SVG
  trail — solid gold behind cleared battles, dotted toward locked ones; nodes
  show cleared ✓ / next / locked / boss-crown states.

### Hybrid 3D — battlefield diorama + legendary minis
- Board diorama: 4 corner braziers (flickering PointLights + ember emitters)
  and 2 slow-spinning realm crystals frame the table.
- **3D minis for legendaries**: when a mapped legendary hits the board, its
  GLB spawns scale-in on the card and idles (AnimationMixer where the model
  has clips), follows lunges, hovers+bobs for flyers, and despawns in a gold
  burst on death. Lazy-loaded (zero payload until a legendary is played),
  parse-cached per file.
- 9 curated models (~21 MB in `assets/minis/`, picked by eye from the unused
  sketchfab haul over two lineup passes): Pyraxis dragon, Vulkarrion,
  Morthul, Nyxathra, Nerivia leviathan, Maelstra, Sylvaris, Solmara,
  Chronarch Vex.
- Normalization pipeline: height-target scale → ground-footprint clamp
  (per-model cap; wingspan-dominant dragon gets 3.0), feet-on-table, GLB
  light stripping (fps rule), metalness/roughness clamps for our mood
  lighting, realm-colored ground glow disc + per-mini rim light, shared key
  light over the mid-board gap.
- vendored `GLTFLoader.js` + `BufferGeometryUtils.js` (three 0.172).

### Fixes
- **Blank card art** (reward reveals, first-draw races): the compositor now
  re-queues a draw when art finishes loading instead of caching the
  placeholder frame (`cardtex.js` redraw-on-load).
- AI-turn zombie loop: the async foe-turn driver re-checks its guards after
  each wait, so a suspended/finished match can never act on the wrong turn.
- Selftest: +20 checks (worldmap asset, MINI_MAP↔GLB↔legendary integrity) —
  **160/160 green** (`--assets`).
- Cache-bust bumped `?v=3` → `?v=4` across every import.

## v1.2.0 — 2026-07-07 (Campaign, 60 new cards, premium targeting)

Owner-directed pass #2 (reference screenshots + notes).

### Campaign Mode — "Trials of the Realms" (NEW)
- 5 chapters × 4 battles across the realms (Verdant Marches, Sunken Crypts,
  Ashen Peaks, Drowned Depths, Celestial Spires), each with a commander NPC
  (5 new generated portraits), pre-battle dialogue in speech bubbles
  (advance/skip), story win-lines, and boss battles with campaign twists
  (boss HP up to 40, ambush boards, commander head-starts, extra cards).
- Difficulty ramps squire → knight → archmage across the arc.
- **Rewards & progression**: gold + 2–3 guaranteed card unlocks per battle
  (bosses grant rares/epics + a chapter card back), weighted random pack
  pulls, replay rewards. Progress persists (localStorage), losses offer
  instant Retry with a different deck.
- **Collection is now progression-based**: the full 117-card base set is
  owned from the start (all starter decks + PvP untouched); the 60-card
  expansion unlocks via campaign, achievements, and Arcane Packs (100 g,
  weighted toward unowned rarity). Locked cards show 🔒 + unlock hints in
  the deck builder/collection; Smart Fill respects ownership.
- **8 achievements** (win counts, rarity collection, full clear) granting
  gold, specific cards, and 2 exclusive card backs, with unlock toasts.
- **Card backs**: 8 total (7 newly generated) — equip in the gallery; shows
  on your deck, hand, and face-down traps in every mode, including online
  (choice is exchanged in the multiplayer handshake).
- Selftest proves 100% obtainability: all 20 battles + achievements + packs
  = complete 177-card collection.

### 60 new cards — "Trials of the Realms" expansion
- 10 per realm + 10 neutral (16 C / 21 U / 12 R / 5 E / 6 L), all with fresh
  generated art. New engine ops: multi-hit (Cinder Storm), enemy discard
  (Mindtheft), conditional mass-bounce (Abyssal Kraken), graveyard-to-hand
  (Boneweaver), Soul Transfer (captured-ATK damage), rarity-filtered random
  adds (Aurelion), minHp removal filter (Judicator's Verdict), random-friendly
  buffs, specific-card adds. Every card covered by the per-card selftest.

### Targeting & readability (per feedback)
- **Premium targeting arrow**: solid glowing curved arc (SVG gradient +
  blur glow + flowing energy shine + ornate head) — no more dotted line.
  Attacks = ember gold; spells = arcane gold→cyan.
- **Spells are click-to-cast**: click a targeted spell → the card rises to a
  casting pose and stays there; the arrow follows your cursor; click the
  target to cast. Esc/right-click cancels. Drag still works everywhere.
- **Hover = the real card, in front** (no duplicate previews anywhere):
  hand cards lift + enlarge 1.62×; board cards enlarge in place 1.72× and
  swap to the full rules-text face; collection/deck-builder cells scale
  1.5× in place. Idle hand bob removed — cards hold still until hovered.
- **Affordability at a glance**: unaffordable hand cards are dimmed to 45%,
  playable ones glow green; board attacker glow only appears in Combat.
- Layout: camera pulled back — the hand no longer covers the board and
  nothing clips at any tested aspect; board cards sit perfectly flat (the
  tilt made tapped cards sink into the table); hero discs 28% smaller and
  repositioned clear of the rows.
- Fixed: online game-over screen crashed on the difficulty label.

## v1.1.0 — 2026-07-06 (polish + PvP multiplayer)

Owner-directed improvement pass (reference screenshot + notes).

### Online multiplayer (NEW)
- **Play vs Other Players**: Quick Match (auto-pairing lobby), Create Room
  (shareable 4-letter code), Join Room. Menu button + lobby screen.
- Transport: Supabase Realtime Broadcast/Presence (pure WebSocket relay,
  $0, no server) — `runtime/net/netplay.js`, fresh implementation of the
  proven FFG relay pattern. Works from any origin once deployed.
- Protocol: deterministic lockstep — decks exchanged at handshake, host picks
  the seed, both clients build identical engine states; every action is
  broadcast and replayed. Post-action state hash detects desyncs and triggers
  host-authoritative resync. Handshake messages retry until acked.
- Disconnect handling: presence-based, 15 s grace then auto-win; concede works.
- Verified live with two browser clients: identical rng/hands/boards through
  full turn cycles in both directions.

### Combat targeting (REWORKED per request)
- Click your creature → it highlights, a red dashed targeting arrow follows
  the cursor, legal targets glow red (hero ring pulses) → click the target to
  strike. Esc/right-click/empty-click cancels; clicking another of your
  creatures switches selection. Drag-release-on-target still works too.
  Attacking from Main auto-advances to Combat on confirm.

### Readability / UI polish (per reference image)
- **Board cards are now Hearthstone-style**: full-bleed art, large name
  banner, tribe line, cost gem — rules text lives in hover/inspect instead of
  4-pt type. Stat chips enlarged ~30%.
- **No more clipped numbers**: hand raised and re-arced fully inside the
  viewport at all aspect ratios; enemy hand pulled inside the top edge;
  stat gems no longer cut off.
- **Hover preview everywhere**: hand, board, own traps, deck builder, and
  collection all pop a large crisp card preview (with live buffs/status line)
  rendered in front of everything, beside the cursor. Hand cards also lift,
  enlarge, and render above neighbors (depth-test off while hovered).
- Targeting-arrow SVG layer had a default 300×150 viewport — arrows now span
  the full screen. Hover preview hides when a selection begins.
- Game-over screen vertically centered; menu W/L record refreshes live.

### Balance
- Deathweave Pact: +2 Abyssal Fiend (−1 Soul Harvest, −1 Adventurer's Map)
  after a 25% round-robin winrate; now 33% (band 33–67%, median 17 turns).

### Cache
- `?v=` bumped to 2 across index.html and ALL runtime imports (redeploy rule).

## v1.0.0 — 2026-07-06 (initial release)

Complete 2D digital collectible card game in Three.js/WebGL. MTG × Hearthstone
hybrid with D&D-fantasy flavor. Built end-to-end in one session.

### Game
- 117 unique collectible cards (+11 tokens) across 5 realms + Neutral;
  rarities Common→Legendary, every card with original xAI-generated artwork,
  rules text, and flavor text.
- Hearthstone-style auto-mana (cap 10) + MTG-style tapping: attackers rotate
  90°, untap at turn start; Frozen skips an untap.
- Phases: DRAW → MAIN → COMBAT → END (one-way combat; spells castable in
  combat, creatures only in main).
- 11 keywords: Guard, Swift, Flying, Stealth, Ward, Lifesteal, Venomous,
  Cleave, Piercing, Regenerate X, Frenzy +X — plus Rally / Last Rites triggers
  and ATK auras.
- Trap cards (face-down, trigger on enemy actions): counterspell, attack
  punishes, corpse theft, vengeance.
- Second-player compensation: +1 card and the Arcane Ember (0-cost +1 mana).
- Fatigue on empty deck; 6-creature board; 10-card hand; 60-turn safety.
- 6 starter decks (one per archetype pair) + full deck builder (create/edit/
  save/delete, 2-realm rule, ≤2 copies / ≤1 legendary, live mana curve,
  Smart Fill) + collection browser with search/realm/type/rarity/cost filters.
- AI: turn-local greedy action-sequence search + heuristic evaluation + exact
  lethal solver (burn + attacks through Guards). Sees no hidden information
  (enemy hand/deck/traps stripped from its view). Three difficulties: Squire
  (noise + blunders), Knight (full greedy), Archmage (adds 2-step lookahead).

### Presentation
- Three.js board: generated battlefield table, hero discs, deck stacks,
  fanned hands, drag-to-play, drag-to-attack with SVG targeting arrow,
  slot ghost, hover lift, target highlighting, damage floaters, turn banners.
- Tap = smooth 90° rotation; freeze tint + snowfall; death dissolve; attack
  lunge + screen shake; Epic/Legendary play banners with particle bursts,
  ring shockwaves, and idle golden auras on legendaries.
- Card compositor: 512×768 canvas cards — realm gradients, rarity frames
  (legendary gold filigree, epic rune diamonds), cost/ATK/HP gems, keyword
  badges, live stat chips (green buffed / red damaged).
- Original procedural WebAudio score (menu theme + two battle themes +
  victory/defeat stings) and ~20 synthesized SFX. No reused assets anywhere.
- Match HUD: hero plates with portraits/HP orbs/mana crystals, phase bar,
  hover inspect panel, right-click card inspect with keyword glossary,
  toasts, victory/defeat screen with stats and persistent W/L record.

### Testing
- `node selftest.mjs` — 108 checks: engine invariants, every card resolves,
  all keyword semantics, all trap triggers, signature card behaviors, AI
  lethal lines, quick AI-vs-AI matches.
- `node selftest.mjs --matches` — 36-game round-robin: all decks 33–67%
  winrate, median 17 turns.
- `node selftest.mjs --assets` — every card art + UI asset present.
- Browser-verified via scripted playtests: menus, deck builder, collection,
  inspect, drag-play, drag-attack, tap rotation, trap reveal, freeze, AI
  turns, legendary FX, victory screen.

### Fixed during playtest
- Double-tween conflict left tap rotation stuck at 0 in throttled tabs —
  tweens now kill predecessors and advance on wall-clock time.
- Own-hero target glow not cleared after casting a friendly-target spell.
- AI overvalued tiny heals (piecewise hero-HP weighting).
- Game-over screen vertical centering; stale menu W/L record.
- Deathweave Pact buffed (+2 Abyssal Fiend) after 25% round-robin winrate.
