# Arcane Realms TCG — Changelog

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
