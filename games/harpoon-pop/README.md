# Harpoon Pop

A Pang / Buster Bros. / Bubble Trouble style arcade game in Three.js (r160, loaded from jsDelivr).
One `index.html`, no build step, no asset files. Open it directly or from any static server.

## Play
- **Move:** ← → or A / D. **Fire:** Space, ↑ or Z. **Pause:** P. **Sound / music:** M / N.
- **2-player co-op:** on the title screen press ← → to pick **2 PLAYERS** (or press 2). P1 uses ← → and Space / ↑ / Z. P2 uses A / D and W. Each diver has their own lives, weapon and shield. The score is shared, with a per-player breakdown on the stage-clear screen. If one diver goes down, the stage continues and they return next stage. The stage restarts only when both are down. P2 is the silver-helmeted diver with the pink foot glow.
- Touch devices get on-screen ◀ ▶ FIRE buttons.

## What's in it
- Classic rules: fixed bounce height per bubble size, split on hit, one wire on screen, touch = lose a life, per-stage timer, stage restarts on death.
- Scoring: combo multiplier up to ×8, **APEX** (hit at the top of the arc), **JUGGLE** (hit a fresh split), **CLOSE** (near-miss triggers bullet-time), **DARING** (grab a power-up under a bubble), **BLOCKED** (wire stops a stinger).
- Power-ups: double wire (twice = triple), power wire (sticks to the ceiling), rapid fire, slow-mo, force field, dynamite, 1UP.
- Bomb bubbles cause chain reactions, glass shelves break, and from stage 3 a Stinger drone telegraphs (red glow and shake) and then lobs stingers at you.
- 12 hand-built world-tour stages, then generated stages. Arcade CONTINUE countdown. Top-5 local best runs.
- Juice: hitstop, trauma screen shake, bloom, chromatic aberration, burst shells, dynamic pop lights, GPU particles, squash and stretch, fireworks, and music that is muffled during bullet-time.

## Code map (`index.html`)
`§0` config tables (sizes, items, levels: add stages/power-ups here) · `§2` audio · `§3` input · `§4` state/levels · `§5` player + weapons · `§6` bubbles · `§6b` enemies · `§7` rules · `§8` power-ups · `§9` juice · `§10` 2D HUD/menus · `§11` 3D scene · `§12` loop.
Gameplay runs in a 960×540 2D space; the renderer only reads `game` state, so logic and visuals stay independent.

## Tests
`python tests/playtest.py <this folder> <out dir>` drives the real game in headless Chromium on the GPU. It checks input, every power-up, enemies, continue/game-over, audio output level, all stages and the co-op rules, and writes screenshots. Set `HP_GL=swiftshader` to force software GL (it can't handle very long sessions). Add `--quick` to run 3 stages instead of 15.

## Originality
Everything is original and generated in code. The page loads no asset files: only three.js from jsDelivr and two Google Fonts. The test harness fails if anything else is fetched.
- **Pip the harpoon diver:** built from Three.js geometry (lathe-turned suit, brass helmet with a glowing porthole and expressive eyes, air tanks, hose and launcher), with an ink outline and a hand-animated procedural rig (run, idle blinks and glances, aim and recoil, victory hop, knock-out tumble).
- **Stinger drone:** a procedural mechanical wasp with a curling stinger abdomen, iridescent wings and a red eye that heats up while charging.
- **Music:** five original compositions ("Bubble Skyline", "Harpoon Hustle", "Pop Goes the World", "Stinger Swarm", "Last Bubble"), sequenced in `Sound` and played by a Web Audio synth band.
- **SFX:** all synthesized (oscillators, filtered noise, FM).
