# Cosmic Coils — CHANGELOG

## 1 — 2026-07-06 · Initial release
Complete multiplayer snake-battle arena on miniature living planets. Built from
scratch for this game (no assets, models, textures, music or effects reused from
any other ForgeFlow title).

**Core**
- Deterministic sphere-surface sim (`runtime/sim/serpent.js`): great-circle
  movement + steering, trail-following bodies, mass→length/girth/turn-rate
  scaling, gem tiers + magnet pickup, boost (drain + dropped pellets + floor),
  head-vs-body & head-on collisions, spawn shields, essence drops (58% of mass,
  deterministic ids), seeded weather schedule, utility-AI serpents
  (seek/avoid/hunt/flee/boost personalities). 46-assert node selftest
  (`serpent.selftest.cjs`).
- 5 biomes — Verdant, Ember, Glacier, Dune, Abyss — each with its own xAI-
  generated ground texture (triplanar, vein-glow channel masks), vertex-tinted
  displaced terrain (sim-exact heights), inner liquid glow sphere, procedural
  multi-part props (2 draw calls per type), nebula/starfield sky shader,
  atmosphere rim, fog, sun/hemi palette, ambient motes and 2 weather events
  (rain/fireflies, ashstorm/emberrain, blizzard/aurora, sandstorm/heatwave,
  sporestorm/voidstorm) with visibility/speed/turn/food-surge effects +
  lightning & thunder in heavy storms. Random biome every match.
- Rendering: ONE InstancedMesh for all snake segments (per-instance color with
  emissive injection → every serpent glows its palette under UnrealBloom), one
  for all gems; per-snake head groups with steering-tracked pupils, crown for
  the leader, canvas name sprites; pooled particle bursts (eat/death/kill),
  boost trails, weather sheets in a player bubble. ACES + bloom, DPR ≤ 1.5,
  no shadow maps. Steady 50+ fps with 12 serpents + ~500 gems.
- 100% procedural Web Audio: per-biome generative score (scale/tempo/timbre per
  biome), boost/storm noise layers, synthesized SFX. `__AUDIO_CTX__` wired to
  the page control bar.
- UI: animated menu over a live attract planet (name, 10 skin palettes with
  canvas previews, records, how-to), HUD (length/kills/rank, live leaderboard,
  boost meter, weather chip with approaching-storm warning, kill feed, toasts,
  azimuthal minimap), death/respawn screens, pause with volume sliders,
  local top-10 records, touch controls (left-drag steer, right-hold boost).

**Online multiplayer** (Supabase Realtime WebSockets — NetPlay transport)
- Room codes + shared PUBLIC arena; up to 12 humans/room; owner-authority
  model: each human simulates + streams its own serpent 10Hz, host simulates
  AI + food (bot stream 8Hz, food deltas 4Hz + 12s keyframes), deaths decided
  by the dying client, deterministic essence ids, per-client food id prefixes.
- Drop-in joins: a late joiner takes over a LIVE AI serpent (body inherited via
  path seeding); leavers hand their serpent back to an AI brain (bye/pagehide +
  10s silence watchdog, dead-slot respawn scheduling); dynamic host migration
  (lowest peer id); match time sync for weather lockstep.
- Verified with 3 concurrent clients: state streaming, food-count convergence,
  networked kills/essence/respawns, mid-match takeover with 88-segment body
  inheritance, disconnect adoption. Spawn-path audit trail via `__CC__.audit()`.

**Debug** — `window.__CC__`: state(), synchronous fastForward(s), startPractice
(biome), killPlayer(), respawn(), setSteer/setBoost, spawnFoodAtPlayer(tier),
audit(), world(), sim.
