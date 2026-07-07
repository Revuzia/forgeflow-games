# Arcane Realms TCG — Changelog

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
