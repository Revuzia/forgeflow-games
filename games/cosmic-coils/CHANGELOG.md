# Cosmic Coils — CHANGELOG

## 8 — 2026-07-09 · Arcade polish batch (leaderboard, countdown, combo, touch, auto-quality)
- **Global leaderboard** (`runtime/net/leaderboard.js`, Records → 🌍 GLOBAL tab):
  reads the public top-20 and submits each run (once) to the registry Supabase
  project via the anon-safe `cc_submit_score` RPC. Fully degrades to device-local
  records when offline / not yet migrated. **Activation is one manual step**:
  apply `supabase/migrations/0007_cosmic_coils_leaderboard.sql` in the Dashboard
  SQL editor (the project has no programmatic DDL path here) — until then the
  board silently shows local records. Client verified against live PostgREST
  (correct read/submit shapes; 404-on-missing-table handled).
- **Match-start countdown**: 3·2·1·GO! flourish on every match start (visual only —
  the snake moves under its spawn shield; no input gating).
- **Combo HUD**: the existing eat-combo (previously audio-only) now shows a
  "COMBO ×N" chip with a draining timer bar when you chain gems.
- **On-screen touch controls**: a real left joystick + right BOOST button appear on
  touch devices (or `?touch=1`); the invisible-drag fallback is disabled when they're up.
- **FPS-adaptive quality**: if the framerate stays below 45 for ~4s the game drops one
  graphics tier (HIGH→MEDIUM→LOW) with a toast; never auto-raises; a manual pick in
  Settings takes precedence.
- `?v=` → 8.

## 7 — 2026-07-09 · Local polish + production-like preview
- **Local bundle/minify**: `npm run build` / `npm run preview` (esbuild → `dist/`,
  three.js still CDN via importmap). Source debug: `npm run dev`.
- **World size**: planet radius **48 → 96** (4× surface); food target **330 → 1200**.
- **Snake size cap removed**: `MASS_CAP = Infinity` (was 620 ≈ display length 1488).
  Body samples soft-capped at `SEG_MAX=2048` for GPU/collision only; path ring 16k.
- **World glow/ring**: thinner/dimmer atmosphere rim, lower liquid/emissive/sun/hemi,
  bloom base ~0.48 (was 0.85), exposure 0.92.
- **Essence brightness**: muted tier-9 color + pulse; quieter eat burst; lower food glow.
- **Essence pickup UI**: no more “+N essence!” toast (mass still awarded; rare gems keep callout).
- **Arcade polish**: 🏆 "NEW PERSONAL BEST!" celebration toast + extra shake when a
  run beats your device record; single-player auto-pauses when the tab loses focus
  (online matches keep running — you can't freeze a shared game).
- `?v=` → 7 (source); dist bundle has no cache-bust query.

## 6 — 2026-07-07 · Owner round 5 (stubby start)
- Hatchlings now start at ~6 segments (was 24). The old segCount had a `16`
  base that floored every snake at 16+ segments; new formula `max(5, round(1 +
  mass×0.5))` gives a slither.io-style short worm at spawn and keeps growth
  visible (mass 50→26, 100→51, capped 460). `?v=` → 6.

## 5 — 2026-07-07 · Owner round 4 (blizzard realism, 3 graphics tiers)
- Blizzards no longer produce lightning/thunder (snow doesn't storm that way);
  Verdant rain and Abyss voidstorms keep theirs.
- Graphics setting is now LOW / MEDIUM / HIGH: pixel-ratio caps 1.0/1.2/1.5,
  bloom ×0.62/×0.85/×1.0, weather+cloud particle budgets ×0.5/×0.75/×1.0.
- `?v=` → 5.

## 4 — 2026-07-07 · Owner playtest round 3 (self-collision fix, F3, skies)
- **Self-collision actually works now.** The v3 neck window was sized off the
  boost-circle CIRCUMFERENCE (~29u) — longer than a small/medium snake's whole
  body, so "I hit my tail and lived". The geometry only needs ~3.2u of neck
  (scaled for girth): tail hits kill, hard curls and S-curves stay safe,
  sustained full loops still die. New selftest case reproduces the owner's
  exact tail-hit at mass 60 (58 asserts total).
- **F3 debug overlay**: FPS + frame/worst ms, draw calls, triangles, programs,
  geometries, textures, quality/DPR/zoom/bloom, biome/weather + live modifiers,
  snakes/segments/food counts, player mass/segs/boost-ramp, net room state,
  sensitivity.
- **Richer skies, per biome**: drifting cloud layers on all five worlds
  (biome-tinted: white cumulus, ember smoke, glacier wisps, dune haze, abyss
  nebular puffs) · 🌈 **rainbow arcs over Verdant after rain showers** ·
  **animated aurora curtains during Glacier's aurora events**. All three are
  a single cheap mesh/points layer each; LOW quality halves weather + cloud
  particle budgets so storms stay smooth on weak machines.
- `?v=` → 4.

## 3 — 2026-07-07 · Owner playtest round 2 (unified boost + settings)
- **W, LMB and SPACE are now ONE control: BOOST** (round-1's separate free
  W-throttle read as "W doesn't boost"). Boost now RAMPS 1.0×→1.78× over ~0.9s
  of holding ("longer you hold, faster it goes"), mass drain scales with the
  ramp, and it stays floor-gated — too small to burn means no boost at all,
  by design. Releasing glides back down over ~0.45s. Boost sources are
  tracked independently so releasing one key never cancels another.
- **S and RMB remain the slow lever** (ramped to −28%), ignored while boosting.
- **⚙️ SETTINGS menu** (main menu + mouse-sens in pause): mouse sensitivity
  0.5–2.5 (default 1.3 — addresses "keyboard responds faster than mouse"),
  invert steering, graphics quality HIGH/LOW (LOW = DPR 1.0 + reduced bloom),
  music/SFX volumes. All persisted per device.
- Selftest 56 → 57 (ramp-up assertion; drain/floor tests updated for ramp
  physics, incl. the intended ~0.45s glide-down after losing boost).
- `?v=` → 3.

## 2 — 2026-07-07 · Owner playtest round 1 (controls + self-collision)
- **Steering un-inverted** (A/D and mouse were mirrored): in the sim frame
  positive steer turns LEFT, so screen-right inputs now map to −1
  (A=+1, D=−1, mouse/touch negated). Proven by a headless camera-basis check
  (dot(newHeading, screenRight) = 0.996 for steer −1).
- **Throttle**: hold **W** to build speed up to +42% (free, ~1s ramp), **S or
  RIGHT-CLICK** eases down to −28%; releases decay back to neutral; BOOST
  (Space/LMB) overrides throttle. Context menu suppressed on the canvas.
- **Mouse-wheel camera zoom** (0.75×–2.3×, smoothed).
- **Self-collision is ON**: crossing your own body is death (classic snake
  rule; credited to yourself, no kill awarded, essence still drops). A
  boost-aware "neck window" exempts the tightest legal bend, so hard curls
  and S-slaloms are always safe — only a sustained full loop kills. Bot AI
  scans its own body past the same window so bots avoid self-crossings too.
- HUD hint / how-to / meta control text updated. Sim selftest 46 → 56 asserts
  (throttle speeds + mass-free, boost override, curl/slalom safety, full-loop
  death, self-credit, essence-on-self-death).
- `?v=` bumped to 2 (module cache rule).

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
