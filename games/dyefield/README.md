# DYEFIELD — Harbor Cup • 4 v 4 · Free-for-all

> Stain the arena. The floor is the scoreboard.

**DYEFIELD** is an original third-person turf-paint arena game with two modes: **TEAMS · 4 v 4**
and an eight-runner **FREE-FOR-ALL**. **Tide-runners** — kid-scale coastal athletes — fight for the
**HARBOR CUP**: in teams, **SUNCREW** (amber-orange) against **GULF CREW** (violet-blue); in
free-for-all, every runner is a crew of one. Your own dye is a highway and a refill pool, and
everyone else's dye is glue. When the horn sounds, whoever covers more of the floor wins.

## Run it (one command)

```bash
npm install && npm run dev
```

Open **http://localhost:5186**. The port is fixed (`strictPort`) because the harness expects it.
A browser with **WebGL 2** is required.

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server on :5186 (serves `runtime/`, no-store headers, `/__shot` + `/__report` harness endpoints) |
| `npm run build` | production build into `dist/` (`base: './'`, so it can be hosted from any sub-path) |
| `npm run typecheck` | `tsc --noEmit` over runtime, harness and config |
| `npm run probe` | headless sim gates (`node _harness/probe_paint.ts`, …) — deterministic, exit-code |
| `npm run art` | rebuild every Blender asset headless (`python art/build.py all`). The GLBs it produces are **committed**, so you only need Blender to *change* art. |

## STACK DECISION

**Winner: Three.js r186 + TypeScript + Vite (runtime), Rapier 0.20 (collision/character
controller), and Blender 5.1.2 headless for all authored art (hero, weapons, the three maps
and prop kits, exported as glTF).**

The rubric was scored in the open against what is actually installed on the build machine on
2026-09-24: Unity 6000.3.9f1, Blender 5.1.2, Node 22.20, Playwright, and an RTX A2000. Godot is
**not** installed.

| # | criterion | Three.js + TS + Vite (+ Blender) | Unity 6 URP (+ Blender) | Godot 4 (+ Blender) |
|---|---|---|---|---|
| 1 | swim-in-paint + coverage correctness | **9**: the paint buffer lives in a THREE-free TS sim that runs unchanged in Node, so coverage is proven by exit-code probes; dirty rows upload with `texSubImage2D` (`Texture.updateRanges`) | 8: same design in C#; tests go through batchmode EditMode runs (minutes each); WebGL `Apply()` re-uploads the whole texture | 7: `ImageTexture.update` re-uploads everything; web export runs the Compatibility renderer |
| 2 | character read, animation, juice | 8: skinned glTF clips, `AnimationMixer` cross-fades and additive layers, custom GLSL for glossy dye, post FX | **9**: Mecanim and Animation Rigging are the best tooling here (VFX Graph is unavailable on WebGL) | 8 |
| 3 | three authored maps, not recolored boxes | 8: maps are built in Blender from `data/maps.json` (bevels, rocks, wrecks, sand terrain) and the paint UV2 is authored there | 8: same Blender pipeline; ProBuilder needs the editor UI | 8 |
| 4 | bot 4 v 4 that feels like a match | **9**: a whole 3:00 match with 8 bots simulates headless in Node in seconds, so pacing and coverage are measured, not guessed | 7 | 7 |
| 5 | time-to-playable vs quality ceiling | **9**: HMR in seconds; the ceiling is WebGL 2, which is the ship target for *every* option | 5: WebGL builds take 5–15 min each, URP-on-WebGL feature cuts, 20–40 MB downloads | 4: needs a download and install first; the web export wants cross-origin isolation |
| 6 | one-command run | **10**: `npm install && npm run dev` | 5: needs this exact editor build, or a prebuilt WebGL served by hand | 6 |
| | **total** | **53** | 42 | 40 |

**Why it wins.** Every ForgeFlow title ships browser-playable through the portal (R2/CDN plus
the Supabase registry). The deliverable is a WebGL game whichever engine builds it. That
removes Unity's main advantage, desktop-class rendering, and keeps its main cost: a slow
build-test loop. The source clip itself is a browser game (its frames show a `vercel.app`
pointer-lock banner). So the look this genre needs is reachable in WebGL. It becomes a
question of shaders and art direction, not engine features. Three.js lets the paint buffer be
**one TypeScript module**, and that module is the source of truth everywhere. The Node probe,
the bots and the browser renderer all read the same texels.

**Re-scored 2026-09-24 after Godot 4.7.2 became available on the build machine** (owner-installed;
editor present, web export templates not yet installed). Godot moves from 4 to 5 on criterion 5,
for a total of ≈ 41. Its web export still runs the Compatibility (GL ES 3) renderer, re-uploads the
whole `ImageTexture` on update, and cannot use C# on the web. The brief also forbids changing
engines mid-project unless the current one physically cannot do the paint buffer, and phase 2
proved that Three.js can. **The decision stands.** The ship target for every option is the web
build.

**What Blender authors** (headless `bpy` scripts in `art/blender/`, committed as the source of
truth; outputs in `art/gltf/`):
- the tide-runner hero: mesh, rig, the hair-crest bone chain and every animation clip;
- the four kit models, JELLY CHARGE and the CLOUDBURST cell;
- all three maps, built from the layouts in `data/maps.json`. That covers architecture, bevels,
  trims, rocks, wrecks and sand terrain, **and the paint-atlas UV2** (non-overlapping, packed
  by area);
- prop kits and set dressing (crates, planters, palms, lamps, cranes, catwalk grates, buoys,
  wreck plates, and the HARBOR CUP / TIDE CO. boards);
- optional AO/light bakes, which reuse the atlas UV2.

**What the runtime owns:**
- the paint/coverage buffer (CPU truth, GPU mirror);
- collision and character control (Rapier trimesh + kinematic controller);
- swim, slog and drink rules; kits, projectiles, sub and special;
- bots and the match clock;
- the stylized surface shaders and dye shading;
- sky, water, per-map lighting and post FX;
- the DOM UI (lobby, loadout, HUD, pause, remap); audio.

**Rejected:**
- **Unity 6 URP:** strongest animation tooling. But the ship target is WebGL, and there it loses
  VFX Graph and compute, has the slowest verify loop (a WebGL build per check), the heaviest
  download, and a harness this build machine cannot drive through the editor UI. It would be the
  pick for a desktop-only release.
- **Godot 4:** not installed, and the web export uses the Compatibility renderer. It has no edge
  on any criterion that decides this game.
- **Three.js alone (procedural boxes):** fastest to a sketch, but it breaks pillar 4 and the
  no-primitives standard. Blender is in the stack precisely so the maps and hero are authored.

## Maps

| id | name | type | favors |
|---|---|---|---|
| `pier18` | **PIER 18 PLAZA** | open coastal sports court, wide mid-range deathball | shooter + roller |
| `lockwell` | **LOCKWELL WORKS** | vertical three-floor industrial interior | blaster + charger |
| `cinder` | **CINDER REEF** | broken atoll with land–water risk crossings | charger water-lanes + shooter rotations |

See `_spec/DESIGN.md` for the IP lock, the map thumbnails and the coverage + swim plan, and
`_spec/CONTRACT.md` for the module contract, data formats and gates.

## Play it

**Live (CDN, unpublished in the catalog):** https://forgeflow-games-cdn.isimcha85.workers.dev/dyefield/index.html

**Two modes** (PLAY → MODE):
- **TEAMS · 4 v 4** (the default): SUNCREW vs GULF CREW, and the crew with more turf wins.
- **FREE-FOR-ALL**: 8 runners (you + 7 bots), each a crew of one in its own colour (amber, violet,
  lime, magenta, sky, coral, sunflower or jade), each with a shape mark for colorblind play. Everyone
  respawns on their own drop pad, and the most turf at the horn wins. The HUD shows your share, rank
  and a live top 3; the victory slate shows a podium and the full standings.

Title → **PLAY** (mode, map, time of day on Pier 18, bot skill BREEZE / SWELL / STORM) → **START**. **LOADOUT**
picks the kit and crew and has a name field. **SETTINGS** has key remap (with conflict detection),
sensitivity, invert Y, colorblind marks, master/music/SFX volume, render quality, reduce motion and
show FPS. **HOW TO PLAY** and **CREDITS** are on the title menu.

| action | default key |
|---|---|
| move / look | WASD / mouse (click to capture) |
| fire (MIST-RASP stream · SHEET-DRUM roll, tap to flick · NEEDLE-GLINT hold to charge, release · POP-WELL burst) | LMB |
| slick into your own color (swim, hide, **drink** to refill the tank) | hold SHIFT |
| jump | SPACE |
| JELLY CHARGE (sub, ~70 % tank) | E or RMB |
| special when the gauge is full (CLOUDBURST / WELLSPRING) | Q |
| pause (resume, settings, how to play, quit match, control legend) | ESC |
| debug panel (coverage %, tank, map, fps, move state, atlas, render scale) | F1 |

Dev query params (harness only): `?mode=teams|ffa`, `?map=`, `?kit=`, `?bots=breeze|swell|storm`, `?seed=`,
`?matchSeconds=`, `?preset=noon|golden`, `?quality=auto|high|low`, `?autostart=1`, `?dev=1` (test
hooks on `window.__DF__`).

## Build status by phase

| phase | scope | status |
|---|---|---|
| 0 | stack decision + repo that boots | done |
| 1 | athlete moving on Pier 18 | done: Blender-authored tide-runner (26 bones, 22 clips), Rapier kinematic controller |
| 2 | coverage buffer + paint write + live minimap | done: the CPU paint atlas is the source of truth; the GPU mirror uploads dirty rows only |
| 3 | swim / slog / tank drink | done: SLICK (8.4 m/s, 36 %/s refill), SLOG, WALL-SLICK up own-dyed walls, own pad = own dye |
| 4 | MIST-RASP + dry click when empty | done |
| 5 | 3:00 match + 7 bots | done: countdown, horns, WASHED BY slate, 3 s respawn, victory slate, bots paint/fight/refill/chase |
| 6 | four kits + sub + special | done: SHEET-DRUM, NEEDLE-GLINT, POP-WELL, JELLY CHARGE, CLOUDBURST, WELLSPRING; bot kit tactics |
| 7 | LOCKWELL WORKS | done: 3 floors, conveyors, grated crane-walk, wall-slick shortcuts, interior lighting |
| 8 | CINDER REEF | done: atoll, wreck, bridges, sandbars, tide-springs, deep channels, mist |
| 9 | lobby, loadout, map select | done: live 3D lobby, mannequin loadout, settings, how to play, credits, pause |
| 10 | juice, audio, score horn, per-map lighting | done: shake/markers/vignette/stains/confetti; music + 57 SFX + horn |
| 11 | harden, pause, README | done: leak-flat across matches, adaptive resolution, focus-loss pause, context-loss card |
| ship | CDN deploy | done: `dyefield-1.0.0` live and verified (files, marker, cover md5, live boot + live match) |
| FFA | free-for-all mode (owner request 2026-09-28) | done: 8 crews, fair FFA spawns on all 3 maps, FFA HUD + standings; teams unchanged (all 12 teams determinism hashes identical until the shared bot fixes were enabled, then re-validated on 8 seeds); `dyefield-1.1.0` |

**What is better BECAUSE of the chosen stack:**
- **Phases 0–2:** the paint and movement sim runs under plain `node`, so the paint, move, swim,
  combat, match, kits, nav and bot gates are all exit-code probes that finish in seconds. The paint
  atlas is one TypeScript module shared by the probes, the sim and the browser.
- **Phases 3–5:** a full 3:00 eight-bot match simulates headless in about 10 s. Bot pacing,
  coverage, stuck detection and determinism are measured over 8 seeds per map instead of eyeballed.
- **Phase 6:** kits are data (`data/weapons.json`). Balance changes were measured with mixed-lineup
  bot matches in node before any browser run.
- **Phases 7–8:** Blender builds each map from data, including the paint UV2, an AO bake on UV2 and
  node extras for conveyors, springs and lights. The runtime reads the same GLB in the browser and
  in node.
- **Phases 9–11:** everything is DOM + WebGL on one Vite page, deployed as static files to the
  portal CDN with no plugin or native build step.

## Gates (run from this folder)

`npm run typecheck` · `node _harness/probe_{paint,move,swim,combat,match,kits,audio}.ts` ·
`node _harness/probe_nav.ts --map {pier18,lockwell,cinder}` · `node _harness/probe_bots.ts [--map id] [--lineup mixed] [--seeds 1..8]` ·
`python art/build.py check` · `python _harness/bootcheck.py [--headless] [--base URL]` ·
`python _harness/menus.py` · `python _harness/playtest.py --map id --kit id` ·
`python _harness/perfcheck.py --map id` · `python _harness/abperf.py` (interleaved GPU A/B).

Final QA (G12): all 12 map × kit combinations passed a real-input playtest. On the Intel UHD iGPU at
1600×900 and a 50 Hz display, every map held ~50 fps with p99 20.7 ms (Pier 18), 23.4 ms (Lockwell,
adaptive scale 0.75–0.9) and 21.4 ms (Cinder).

## Data & art

`data/teams.json` (crews, colorblind palette) · `data/weapons.json` (kits, sub, specials, balance
log) · `data/maps.json` + `data/layouts/*.json` (arenas). `art/blender/*.py` builds every GLB
headless (`npm run art`), and `art/build.py check` enforces the asset contract. The spec lives in
`_spec/`.

## Credits

An original 4 v 4 and free-for-all turf-paint shooter.

- Built with Three.js, Rapier, Vite and TypeScript; all 3D art authored in Blender (headless scripts).
- Music: "Revelation", "Chasing The Stars", "Hyper Drive" and "8-bit Hero" from the SynthWave Music
  Pack by Travis Rise (Unity Asset Store).
- Sound effects: Kenney (CC0) Interface Sounds + Impact Sounds; Sonniss #GameAudioGDC 2024
  (BluezoneCorp, Bolt, InMotionAudio, Jake Fielding, Justsoundeffects, Rescopic Sound, Rogue
  Waves, Sonik Sound Library). Horns, beeps, squirts and the spring were synthesised for DYEFIELD.
- Fonts: Lilita One, Nunito (SIL Open Font License, via @fontsource).
- ForgeFlow Labs.
