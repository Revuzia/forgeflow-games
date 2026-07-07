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
