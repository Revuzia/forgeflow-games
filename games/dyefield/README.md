# DYEFIELD — Harbor Cup • 4 v 4

> Two crews stain an arena. The floor is the scoreboard.

**DYEFIELD** is an original third-person 4 v 4 turf-paint arena game. **Tide-runners** —
kid-scale coastal athletes — fight for the **HARBOR CUP**: **SUNCREW** (amber-orange) against
**GULF CREW** (violet-blue). Your own dye is a highway and a refill pool, and enemy dye is glue.
When the horn sounds, the crew that covers more of the floor wins.

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

## Build status by phase

| phase | scope | status |
|---|---|---|
| 0 | stack decision + repo that boots | done: `npm install && npm run dev` boots clean |
| 1 | athlete moving on Pier 18 | done: Blender-authored tide-runner (26 bones, 14 clips) walks, jumps and climbs ramps on the Blender-built Pier 18 (Rapier KCC) |
| 2 | coverage buffer + paint write + live minimap | done: hold LMB to dye the tiles under your feet; the CPU atlas is the truth; glossy dye shader, coverage bar and minimap update live |
| 3 | swim / slog / tank drink | next |
| 4–11 | kits, match, bots, Lockwell, Cinder, lobby, juice, harden | planned |

**What is better BECAUSE of the chosen stack (phases 0–2):**
- **Phase 0:** one command runs the game, and the whole paint and movement sim runs under plain
  `node`, so gates G1/G2 are exit-code probes that take about 1 s (73 paint checks, 11 movement
  checks).
- **Phase 1:** the Blender-authored rig and clips load straight into three's `AnimationMixer`
  (the upper-body `brush` layers over locomotion). Rapier's kinematic controller gives autostep,
  slope limits and snap-to-ground on the authored trimesh without hand-written collision.
- **Phase 2:** the paint atlas is *one* TypeScript module shared by the Node probe, the sim and
  the browser. Its GPU mirror uploads only dirty rows (`Texture.addUpdateRange`). On Pier 18 the
  atlas is 1024², 412k surface texels, and builds in about 0.15 s; a 1 m splat costs about
  0.05 ms.

## Controls (phase 2)

| action | key |
|---|---|
| move / look | WASD / mouse (click to capture) |
| jump | SPACE |
| dye the tiles under your feet (phase-2 brush; the MIST-RASP kit replaces it in phase 4) | hold LMB |
| debug panel (coverage %, tank, map, fps, move state, atlas, render scale) | F1 |
| pause | ESC |

Dev query params: `?map=pier18`, `?preset=noon|golden`, `?quality=auto|high|low`, `?dev=1`
(test hooks on `window.__DF__`).

## Credits

An original 4 v 4 turf-paint shooter.
