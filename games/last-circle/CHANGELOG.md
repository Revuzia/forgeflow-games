# Last Circle — CHANGELOG

Source of truth for this game's history and design decisions.
Design research: `forgeflow-games/state/research_battle_royale.json` (Fortnite building/storm, Final Drop browser formula, PUBG ballistics/loot, Apex shields/feedback).

## 2026-07-03 — v1.0 initial build (full game, one session)

**What it is:** 50-player third-person battle royale with Fortnite-style building.
1 human + 49 AI opponents (friends can join online and replace bots). Three maps,
three modes, full loot/storm/build/combat loop, win/lose/stats screens.

### Architecture
- FFG 3D kernel (`ffg_kernel_3d.js`, shared with Pirate's Cove/Tide Breakers) + new genre `royale`.
- **Rules core** `runtime/sim/royale.js` — pure, deterministic, node-tested
  (`royale.selftest.cjs`, 47 asserts): weapons/damage/falloff, storm phase math
  (nested seeded circles), BuildGrid (slots, HP ramp, support graph, cascade
  destroy), loot tables, match bookkeeping.
- **Genre modules** `runtime/3d/royale/*`: maps, player, weapons, building,
  loot, storm, bots, hud, audio, fx, net. Orchestrated by `ffg_royale3d.js`
  (shared world object `W`, fixed frame pipeline, `window.__LC__` debug hook
  with synchronous `fastForward` for deterministic testing).
- **Bots are players structurally**: brains write the same input struct the
  keyboard does; movement/weapons/building are one code path.
- **Multiplayer**: Supabase Realtime (NetPlay). World is deterministic from the
  shared seed; only live state relays. Host simulates bots (10Hz snapshots);
  each human simulates themselves (12Hz); hits on remote actors route to their
  owning client. Guests take over bot slots; disconnect → bot brain re-attaches
  (explicit `bye` + 12s host watchdog). Loot item ids are derived from source
  (`f:`/`cb:`/`dd:`/`sd:`/`sw:` prefixes) so pickup mirroring never desyncs.
  VERIFIED live with 2 clients (host tab + same-origin iframe): identical seeds,
  slot takeover, bot snapshots flowing, 0m relay error on player state.

### Maps (seeded procedural, 1600m)
- **Isla Viva** — tropical: radial island, volcano+crater, beaches, 8 POIs
  (Palm Bay, Coco Village, Volcano Rim, Shipwreck Cove, Cliff Temples, Lagoon
  Docks, Jungle Market, Banana Farm), palms/trees instanced + harvestable.
- **Ashgrid** — urban: bowl downtown with multi-floor enterable towers (interior
  ramps, roof chests), overpass, container yard + motor pool (metal), crane
  high-point, rubble cover field.
- **Deepwood** — forest: rolling hills, river+lake carve, ranger towers,
  logging camp, quarry (brick), cabins, fire watch.
- **Proving Grounds** — practice-only: range with distance markers, build lot,
  movement course.
- Batched box-geometry structures (one mesh per color) + InstancedMesh props;
  static collider spatial hash; analytic heightAt shared with minimap render.

### Systems
- Weapons: pickaxe/pistol/SMG/AR/shotgun/sniper/rocket/grenade; rarity tiers
  (+8% dmg, −10% spread per tier); real projectiles with travel + drop
  (sniper/rocket), pellets, splash+knockback, recoil, reload, falloff to 40%.
- Building: wall/floor/ramp/stair; 10 mats; wood/brick/metal HP ramp
  (90→150 / 100→300 / 110→500); door edits; support-graph cascade destroy;
  ghost preview + turbo-build for the human; bots build via the same tryBuild.
- Loot: seeded floor spawns + chests (golden ring, burst on open), supply drops
  (2/match, drift down into next circle), death drops (deterministic, seeded by
  victim id), 5-slot inventory, ammo/mats auto-pickup.
- Storm: 7 phases standard (~8.5 min storm → 10-13 min match), 5 quick (~3.5 min);
  final circle HOLDS at ~10 m (r=0 storm-killed every survivor simultaneously —
  someone must WIN the fight); violet additive wall (hidden pre-shrink +
  practice); minimap current+next rings + outside-veil; warnings + sirens.
- Bots (49): utility state machine (DROP/LOOT/FARM/ROTATE/ENGAGE/FLEE/HEAL/
  CAMP/PUSH/WANDER) over per-bot blackboard; 5 skill tiers (reaction 600→220 ms,
  aim error 6°→1°, build ability none→edit-plays) × 6 personalities (rusher,
  builder, camper, loot_goblin, rotator, sniper); staggered thinking (150/400 ms
  near/far); vision cone + LOS + hearing (shots 250 m); aim model with acquire
  overshoot, tracking warm-up, motion penalty, smooth error wobble; burst fire
  discipline; wall-up reflex on damage; box-up heal; ramp pushes; third-party
  drift; endgame aggression (camp off, +engage, duel aim 0.55×).
- HUD/UI: menu (mode+map cards), lobby fill (50 named slots + countdown), HUD
  (bars, slots w/ rarity, mats, ammo, minimap, kill feed, storm timer, alive,
  interact hints, hitmarkers, damage numbers, storm/hurt tints, sniper scope),
  big map (M), pause, settings (volumes, sensitivity, graphics presets,
  click-to-rebind keymap via canonical-code remap), death→spectate (killer
  hand-off), post-match stats, victory + confetti.
- Audio: procedural Web Audio SFX (per-class gunshots w/ distance+pan to 260 m,
  builds, impacts, shield break, chests, heals, storm sirens, UI); music =
  3 unique Laser Sequence tracks (menu/match/endgame) per no-duplicate rule.
- FX: single 1024-cube InstancedMesh particle pool (muzzle, tracers, impacts,
  explosions, debris, chest bursts) + DOM damage numbers + camera shake.
- Perf: 51 fps / 25 draw calls / ~500 k tris with 50 actors in preview (DPR 1.5,
  shadows 1024); far-bot LOD (cheap physics + frozen mixers >250 m), staggered
  AI, spatial hashes, particle/projectile pooling.

### Bugs found & fixed during preview verification
- **Versioned-import dual-instance**: `import "./x.js"` (bare) alongside
  `import("./x.js?v=")` = TWO module instances (empty genre registry / null K).
  All intra-runtime imports must propagate `?v=`.
- Emitter dropped 4th event arg (tracer dir undefined).
- Build cell `Math.round` → walls a cell above the builder (never grounded).
- Bot plan-stall: state unchanged → onEnter never re-ran → idle forever.
- **Sticky-crouch**: glide-dive set input.crouch, nothing cleared it → every bot
  crawled at 2.2 m/s all match.
- **Mats starvation loop**: nobody could afford a first wall → kills dropped no
  mats → no one EVER built. Fix: 50 starting wood (humans too), Fortnite-scale
  harvest (14+8/swing), 50-count mats pickups. 61-103 builds/match after.
- **r=0 final circle** crowned a corpse (winner at −11 HP); holds at ~10 m now.
- Stale MATCH OVER overlay leaked into the next match (layer cleanup).
- Rock cluster normalized by height → house-sized blob (compact props normalize
  by max dimension).
- Spectated actor's nametag filled the screen (focus tag hidden; tags culled).
- Preview gotchas confirmed: plain `http.server` serves stale ESM (use
  serve_nocache.py); `window.open` blocked (2nd client = same-origin iframe).

### Match-quality numbers (fastForward soak tests)
- Standard/Isla: hot-drop fights from t≈60 s, 40%→88% armed (t=100→300),
  61 builds, winner 1-13 kills, full match 9-11 min, storm kills ≈15/49.
- Quick/Ashgrid: complete in ~6.5 min, 103 builds.
- Deepwood: verified spawn/fights/POIs; player got shotgunned by a bot (good).

### Known limitations (v1)
- Mid-match join syncs t/builds/loot but not in-flight projectiles.
- Bot pathing is steering-based (no navmesh); rare storm stragglers die dumb
  (tier-appropriate, honestly).
- Stairs render stepped but share ramp collision; roof piece not implemented.
- No swimming — deep water pushes back to shore (Fortnite-pre-swim rule).
