# WORLD 5 — RAINBOW · Integration Contract

Vocabulary is fixed: WORLD (this is the 5th) → 3 STAGES (`rainbow-1/2/3`) → CHECKPOINTS
inside each stage. Never call a checkpoint a stage.

## Exact integration points (verified against source 2026-09-15)

| Surface | File:anchor | Change |
|---|---|---|
| World order / unlock chain | `runtime/core/save.js:36` `DEFAULT_WORLD_ORDER = ['neon','foundry','spire','temple']` | append `'rainbow'` — world 5 then unlocks when ALL of temple is cleared (owner's sequential rule, already enforced by save.js) |
| World catalog | `runtime/data/index.js` WORLDS array (temple entry ends `stages: ['temple-1'...]`) | add entry `{id:'rainbow', name, subtitle, theme:'rainbow', accent, blurb, stages:[...]}` |
| Stage import map | `runtime/data/index.js:~307` | three lazy imports `'rainbow-N': () => import('./stages/rainbow-N.js')` |
| Theme | `runtime/world/themes.js` (keys: neon/foundry/spire/temple/hub, each ~130-160 lines) | new `rainbow:` block with the SAME key set as `temple:` |
| Hub portal | `runtime/data/stages/hub.js` — `portals:[{world,p,yaw}]` at cardinals ±20.6, plus `portalArch({deg,tint,label,sub,floorTop})` | 5th portal + arch; placement is a design decision (diagonal at deg 45 with its own floor plate, or elevated ring) — must be reachable and wired through `portals[]` |
| Boot copy | `runtime/boot.js:415` "valid ids look like neon-1 … temple-3" | extend |
| Portal card copy | `content.json` / `game_meta.json` ("four worlds" language) | five worlds |

## Movement envelope (CONTRACT.md §0 — do not exceed)
Jump apex 2.09 m (full hold). Flat gap: safe 4.4 m, max 5.29. Sprint gap: safe 6.4, max 7.50.
Airtime 0.615 s. Player r 0.35, h 1.8, eye 1.62, crouch height 1.05. Sprint 12.2 m/s, run 8.6.

## Hazard engine contract
- Modules live in `runtime/hazards/` (chase, crushers, lasers, lava, movers, pendulum,
  rotors, spikes, surfaces, vanish; dispatch via `hazards/index.js` + `world/stage.js`).
- Every hazard is a PURE function of the stage clock: `update(t, dt)` / `reset(t)`.
  No `Math.random()` at runtime — deterministic seeds (`mulberry32`) in data only.
- Kill volumes via `hz.kills`, colliders via `hz.colliders`. `_placeBuilt` registers both.

## Laws learned the hard way in THIS project (violations have all shipped and all hurt)
1. **Pendulum blade `{w,h,d}`**: `w` = span ACROSS the swing (kill half-span `w*0.34`);
   `d` = THICKNESS (kill radius `max(d*1.15, h*0.30)`). temple-3 shipped these swapped —
   3.45 m kill spheres, six impossible axes.
2. **Topology**: a blade sweeping ALONG a narrow deck never vacates the lane — impassable
   regardless of timing — unless its arc exits by HEIGHT (raised pivot, extremes past the
   deck ends, bottom clearing 1.8 m + margin over the ends) or a side ledge exists.
   Cross-route sweeps are the default-safe shape. EVERY axe-class hazard must pass
   `_harness/axecheck.mjs` AND have either an all-phase-safe staging zone (`_staging.mjs`
   pattern) or a visible flank ledge. Legibility furniture (ledges, GOLD teaching signs)
   is part of the design language — "fair on the phase chart" is not enough.
3. **vanish**: `crumble` loses solidity at `crackDelay` (`chunkLife` is debris DRAWING
   time only). `cycle` period = on+warn+off; warn is still solid. A refuge tile must be
   `cycle` or solid, never crumble.
4. **Checkpoints**: never inside any hazard's reach (respawncheck: 0 unprompted deaths,
   swept per checkpoint). Rising `clockOffset` per checkpoint so a respawn is a rerun.
5. **GLARE — owner has flagged this repeatedly across games**: `glow:` on a platform is a
   COLOR whose channels act as emissive multipliers. A rainbow world is the maximum-risk
   glare trap. Hold emissive surface luminance ~3-8× scene, thin accents not planes,
   judge dark-adapted. Saturated hues on TRIM and LIGHT, not on giant faces.
6. **Colour readability**: any colour-coded mechanic pairs colour with a SECOND channel
   (shape, pattern, motion, position) — colourblind players must read it.
7. **Content floor per stage** (reachcheck): ≥45 objects, ≥150 m, ≥4 checkpoints incl.
   cp0, ≥8 hazards from ≥4 families. House bar (temple): ~100 objects, 300-400 m,
   8-12 checkpoints. Rainbow is world 5: hardest in the game, but every challenge FAIR
   by laws 2-4.
8. Object array tails are append-friendly; inserting mid-array shifts indices referenced
   in comments — prefer appends or renumber comments.

## Ship gates (all must pass before deploy)
`modulecheck` 54+3/0 · `reachcheck` 16/0 · `geomcheck` 16/0 · `axecheck` all PASSABLE ·
`respawncheck all` 0 unprompted · staging map for every axe-class · live probes for each
NEW trap archetype (control that must die + pass that must survive) · dark-adapted
screenshot review for glare.
