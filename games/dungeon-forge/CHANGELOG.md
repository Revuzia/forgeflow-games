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
