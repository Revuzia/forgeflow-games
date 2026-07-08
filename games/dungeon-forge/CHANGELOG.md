# Dungeon Forge — CHANGELOG

## v1.0 — 2026-07-07
Initial release.
- **Builder**: cell-grid painting + room stamping across up to 5 floors, doors with
  a per-door 🔒 lock toggle, keys placeable on the floor / inside chests / on
  enemies, stairs that auto-cut their landing, chests, spike + vent traps,
  torches/neon lights with color presets, themed decor, spawn + exit portal,
  live solvability checker (key/lock flood-fill).
- **Two themes**: Classic Fantasy Dungeon (Kenney modular dungeon kit; skeletons,
  spiders, zombies, ghosts, slimes, orc brutes, demon lord) and Sci-Fi Robot
  Facility (Kenney modular space kit; drones, security bots, androids, plasma
  turrets, war mechs, hive alien).
- **Escape mode**: third/first-person controller, melee + mana bolts, enemy AI
  (patrol → LOS aggro → A* chase → attack), traps, chest loot by difficulty
  (gold/potions/energy/charms), locked doors consuming keys, multi-floor stairs,
  exit portal with run timer, deaths + respawns, results screen.
- **Multiplayer** (Supabase Realtime relay, NetPlay transport): 4-letter room
  codes; real-time co-building with shared ops + live peer cursors; co-op escape
  with owner-authority players @10Hz, host-authority enemies @7Hz, relayed world
  events, drop-in late joins with full keyframe (build) / world snapshot (play);
  host migration by lowest peer id.
- **Sharing**: localStorage saves, URL share codes (deflate + base64url), cloud
  publish under short codes with per-dungeon fastest-escape leaderboards
  (migration 0006, tables df_dungeons/df_scores).
- **Selftest**: `node runtime/sim/dungeon.selftest.cjs` — 56 assertions over the
  model, ops determinism, solvability, escape sim combat/keys/traps/exit.

## v1.1 — 2026-07-07 (same-day major update)
- **Original Meshy-generated player party** (replaces reused rigs): Knight,
  Barbarian, Sorceress, Rogue — AI-generated, auto-rigged 24-joint humanoids
  with Walk/Run clips (armature-retargeted); Idle from bind clip; attack/hit/
  death as procedural bone overlays. Textures repacked to 1024px (~750KB/char).
- **Visible equipment on bones**: chest loot now drops weapon upgrades (tier
  I-III, +12% dmg each, weapon grows + tints bronze/steel/gold in the RightHand
  bone) and armor (tier I-III, 10% soak each, chest plate + shoulder pads on
  Spine02) — visible to co-op partners over the wire (pst carries tiers).
- **Terrain cells**: LAVA (burns 10/tick through i-frames, embers, glow), WATER
  (55% wade speed, translucent animated sheet) and RAISED platforms (+1.1u,
  auto step-wedges at every lower edge; players/enemies smooth-step up/down).
  Painted with 3 new builder brushes; syncs in co-build; minimap colors.
- **D&D-style combat feedback**: soft target lock (facing cone) with red ring
  under the target + top-center enemy plate (name, HP x/y), floating damage
  numbers (gold = yours, red = incoming, armor math visible), slight aim assist.
- **Industry-standard settings** (persisted): music/SFX volume, mouse
  sensitivity, invert Y, quality (bloom/pixel-ratio), FPS counter — gear icon
  in menu + builder + Esc pause overlay (resume/settings/quit).
- **Proper main screen**: key-art background with slow zoom + dark vignette.
- **Big-map performance**: nearest-10 torch light gating + distance-gated enemy
  mixers — 30-room / 808-cell / 10-enemy map at 0.83 ms/frame (was 34 ms).
- Cloud tables df_dungeons/df_scores are LIVE (migration 0006 applied via
  Management API) — publish codes + global leaderboards fully working.
- Selftest grown to 91 assertions: terrain, targeting, equipment, 1/10/20/30-room
  scale + solvability, full 13-enemy roster kill tests (both themes).

## v1.2 — 2026-07-07 (classes + real combat FX)
- **Four playable classes** picked on the main menu, each a distinct kit:
  - Knight — sword + round shield (blocks 45% frontal), RMB shield bash (stun)
  - Barbarian — two-handed war axe, heavy combos, RMB Crush (2.2× finisher)
  - Sorceress — fire bolt (burn DoT) + frost bolt on R (slow), staff w/ glow orb
  - Rogue — dual daggers, fastest attacks, stacking poison (to 3 stacks)
- **3-hit combo system**: LMB chains stage 1 → 2 → finisher within the combo
  window; each stage its own damage + its own Meshy animation clip; combo
  counter in the HUD.
- **Real Meshy combat animations** (library action ids → clip-only GLBs,
  ~50KB each, retargeted by the shared 24-joint skeleton): slash1/slash2/
  finisher/parry/cast1/cast2/hit/death per class — no more weak procedural
  swings. 21 clips generated via pipeline/meshy_anims.py.
- **Class weapons on bones**: procedural 2H axe / arcane staff+orb / daggers,
  knight shield on the left hand — all tier-tinted, synced to co-op peers.
- **High-quality elemental FX** (layered particles + flash lights + auras):
  fire (embers + smoke + orange flash + burning aura), frost (ice shards +
  blue flash + material freeze-tint + drips), poison (green splash + bubbling
  aura), shield-bash/crush shockwave rings + camera shake; colored floating
  damage numbers per element (orange burn / green poison / cyan frost / gold).
- **Enemy status effects**: burn & poison DoT (poison stacks), frost slows
  movement + tints the enemy icy, bash/crush stun freezes their AI.
- Selftest → 101 assertions (adds class combos, bash stun, shield block,
  burn/frost/poison, barbarian crush). Event-path harness confirms every
  class emits the render events the FX layer consumes.

## v1.3 — 2026-07-07 (idle fix + merchants)
- **Fixed the "arms-out" A-pose**: generated a real neutral IDLE animation
  (Meshy action 0) for all four classes — they now stand naturally with arms
  at their sides in the menu 3D preview AND in escape mode (was the base bind
  pose). Clip-only GLBs (~70KB each) retargeted on the shared skeleton.
- **Merchant / NPC system** — the dungeon builder can now place vendors:
  - New 🛒 Merchant tool; procedural market stall + shopkeeper + coins + awning.
  - Click a placed merchant to toggle what it sells (potions, energy, weapon
    upgrade, armor upgrade, damage charm — each priced in gold).
  - In escape, walk up and press **E** to open the shop; buy with gold you find
    in chests (players now start with 40 gold so the opening vendor is usable).
    Purchases grant/equip immediately and show on the character.
  - Featured sample dungeons place a starter merchant by the entrance.
  - Merchants are solid; stock persists through save/share; MP-safe.
- Selftest → 111 assertions (adds merchant placement, solidity, stock
  roundtrip/edit, buy flow, gold/tier caps).

## v1.3.1 — 2026-07-07 (menu preview scale fix)
- **Fixed the menu 3D class preview rendering a giant head-only close-up.**
  CharPreview scaled off `Box3.setFromObject`, which reads a Meshy skinned
  rig's degenerate bind bounds → tiny measured height → model blown up ~15×.
  Now poses the idle clip and measures BONE world positions (the same path the
  in-game actors use), so all four classes show the full figure on the pedestal.
  Verified live in-browser: Knight/Barbarian/Sorceress/Rogue all frame correctly.
- Full in-browser verification pass (Chrome MCP): weapon parents to RightHand
  (Δ0), shield to left hand, armor (plate + 2 pauldrons) to Spine02; merchant
  stall renders, E opens the shop, buy deducts gold with live affordability
  gating + max-tier reject; builder places merchants and the per-vendor stock
  toggle panel works.

## v1.3.2 — 2026-07-07 (arms-down idle — real fix)
- **The A-pose "arms flung out" is finally fixed.** Investigation (live bone
  measurement + FK on the whole Meshy idle library) proved the problem was NOT
  a missing clip: the auto-rig bound every character in an A-pose and ALL of
  Meshy's idle presets (0, 11, 12, 243, 336, 338, …) keep the arms out (hands
  land ≥0.9 torso-heights from the body). Swapping the action can't fix it.
- New `relaxArms()` in assets.js rotates the upper-arm/forearm bones so the arms
  hang at the sides (hands drop from +0.2 above the hips to −0.25 below, radial
  1.14→0.6). Applied every frame after the mixer runs — in the menu 3D preview
  (always) and in escape (fades in only while standing idle, so walk/attack
  clips read normally). Weapons/shields ride the corrected hand bones, so they
  now rest naturally at the character's side instead of sticking out.
- Verified live across all four classes in the menu preview.

## v1.3.3 — 2026-07-07 (real combat animations actually play)
- **Fixed: attacks were using the crude procedural swing, not the Meshy combat
  clips.** `_makeActor` only registered idle/walk/run/death in `a.actions`, so
  `_playCombat`'s lookup of C_slash1/C_slash2/C_finisher/C_parry/C_melee/
  C_cast1/C_cast2/C_hit always missed and fell back to `_procStart`. The v1.2
  clips were loaded on the template but never bound. Now every `C_*` clip is
  registered — verified live: knight LMB plays C_slash1→C_slash2→C_finisher
  (real sword swings), confirmed on screen mid-slash.

## v1.4 — 2026-07-07 (roster expansion — library enemies)
- **+6 enemies from the CC0 creature library** (Quaternius, gltf→glb→texture-shrunk):
  - Fantasy: Imp (fast harasser), Myconid (tanky mushroom), Cyclops (brute).
  - Sci-Fi: Ooze Alien (blob), War Bot (mech), Xeno Brute.
  Each has idle/walk/run/attack/death/hit clips mapped via creatureClips; per-type
  render heights tuned. Verified live: all 6 load, animate, chase, and deal damage.
  Roster now 10 fantasy / 9 sci-fi. Builder enemy picker auto-lists them.
- Selftest → 117 (roster kill-tests auto-cover the new enemies).
- (Original Meshy-generated enemies — cultist/ogre/cyborg/sentinel — generated,
  integration in progress.)

## v1.4.1 — 2026-07-07 (critical: entry crashes + can't-enter-builder + retaliation)
- **FIXED the "can't enter builder" blocker**: menu-triggered modals (the Build
  and Play pickers) opened *inside* the HUD stacking context (z=20), which the
  menu overlay (z=30) painted over — so the picker was invisible and unclickable.
  Raised the HUD layer above the menu (still pointer-events:none, menu stays
  clickable). Build/Play/host pickers now appear. Verified live.
- **FIXED the KeyW TypeError flood** (image 4): escape AND builder read
  this.keys/this.camDist in update() before the async enter() ran _bindInput().
  Now input/camera state is initialized in the constructor and update() is gated
  behind a `ready` flag set at the end of enter(). No more per-frame crash.
- **Enemy retaliation**: any hit now aggros the enemy onto its attacker — a
  projectile from across the room or a no-line-of-sight sneak strike provokes it
  (previously only proximity/LOS aggro'd). Close-range aggro widened to ~1 cell.
- **+4 original Meshy enemies** (cultist/ogre · cyborg/sentinel) — rigged
  humanoids with walk/run + relaxed idle; roster now 12 fantasy / 11 sci-fi.
  Selftest 121.

## v1.4.2 — 2026-07-07 (builder UX: undo, drag-move, room preview)
- **Undo / Redo**: ↶/↷ buttons in the top bar + Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z).
  Snapshot-based, one step per gesture (a whole paint-drag or room = one undo).
  Verified: place→undo→redo round-trips exactly.
- **Select → drag to move**: pick an object with Select, then drag it to any
  floor cell (objEdit now allows x/z). Verified: chest relocates live.
- **Room live preview**: dragging the Room tool now shows a translucent rectangle
  of the exact area before you release, so you see what you're stamping.
- Hint bar updated; Room vs Floor now clearly distinct (Room = drag a whole
  rectangle, Floor = paint individual cells/corridors).

## v1.4.3 — 2026-07-07 (builder /loop batch 1: favicon, Floor=drag-rect, starter)
- Favicon added (emoji SVG data-URI) — clears the two favicon.ico 404s.
- **Merged Floor + Room**: the Floor tool now drags a rectangle (single click =
  one cell) with a live preview; the separate Room tool is removed. Verified:
  a 3-cell drag fills a 3×3 area.
- Starter dungeon spawn + exit now sit at OPPOSITE corners (7 cells apart), not
  lined up — and both are draggable.

## v1.4.4 — 2026-07-07 (/loop batch 2: floors, chest texture, stairs)
- **Multi-floor clarity (D)**: when editing a floor, the floor below now renders
  as a faint 14%-opacity ghost (its lights off) instead of a full-opacity layer
  stacked right under the current one. Verified: floor-below opacity 0.14 vs 1.0.
- **Untextured chest fixed (G)**: chest + crate/candles/coffin/debris/lantern/
  pillar (and sci-fi cables) referenced an external Textures/colormap.png that
  wasn't bundled in the props folder — so they rendered white/untextured. Copied
  the kit's colormap into props/{theme}/Textures/. Verified: chest hasMap → true.
- **Stairs verified (F)**: walking onto a stairs cell climbs to the next floor —
  confirmed live (player floor 0 → Floor 2/2 at the landing by the exit).
