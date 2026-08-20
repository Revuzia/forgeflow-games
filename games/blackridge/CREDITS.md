# BLACKRIDGE — Asset Provenance & Credits

Per-asset provenance ledger (doctrine §7). Every shipped asset appears here
with source + license BEFORE ship; producing lanes append their rows when the
asset lands. Format follows last-circle's CREDITS.

## Shipped now (wave 1)

| Asset | Kind | Source | License |
|---|---|---|---|
| `assets/vendor/three/**` (three.js r172: build + examples/jsm GLTFLoader, DRACOLoader, SkeletonUtils, BufferGeometryUtils) | vendored library | copied from `games/colosseum/assets/vendor/three/` (originally threejs.org r172) | MIT |
| `assets/vendor/draco/**` (draco_decoder.js/.wasm, draco_wasm_wrapper.js) | vendored decoder | copied from the three.js r172 examples draco distribution (Google Draco) | Apache-2.0 |
| `game_controls.js` | FFG page furniture | byte-copy from `games/colosseum/game_controls.js` (ForgeFlow internal, v2 2026-07-10) | internal |
| Boot screen, favicon, page CSS | procedural | original for BLACKRIDGE (A0) | original |

## Shipped (waves 2–3 — exact files + bytes in `assets/manifest.json`)

| Asset | Kind | Source | License |
|---|---|---|---|
| `assets/textures/*` (asphalt/concrete/plaster/cobble/wood sets, albedo+rough+normal WebP) | imported | Poly Haven texture sets via `pipeline/assets/_downloaded/polyhaven-textures/` (normals Sobel-generated from displacement at build time by `tools/prep_level_assets.py`) | CC0 |
| `assets/textures/iron_plate_*` | imported | `pipeline/assets/generated-materials/` (FFG generated) | original (FFG) |
| `assets/props/*.glb` (vehicles, street props) | imported | Kenney / Quaternius cc0-city kit via `pipeline/assets/_downloaded/cc0-city/` (per its SOURCES.json) | CC0 |
| All other level textures (facade/trim/emissive/neon/decal/glow/ripple/metal/burlap/tarp) | procedural | canvas-generated at load (`core/level/materials.js`) | original |
| `assets/weapons/{warden,vesper,corvus,pike}.glb` (FP viewmodels, weapon + rig-cut gloved hands) | generated | `tools/a4_build_fp_weapons.py` from `games/last-circle` Meshy bases `wpn_{ar,smg,sniper,pistol}.glb` + `soldier.glb` rig-cut arms (Meshy, owner account, original IP per last-circle CREDITS.md) + authored procedural dressing + numpy-generated PBR textures | original (FFG Meshy) |
| `assets/chars/soldier.glb`, `assets/chars/juggernaut.glb` (Draco+WebP repacks) | imported | `games/last-circle/assets/chars/meshy/` (Meshy, ForgeFlow account) | original (FFG Meshy) |
| `assets/chars/clip_*.glb` (rifle idle/walk/run/crouch/reload, hit, death_a — animation-only) | imported | last-circle baked `soldier_*` clip set (clip_death_b/c REMOVED — foreign rig lineage, see manifest.a8 note) | original (FFG Meshy) |
| `assets/chars/wpn3p_{ar,smg,sniper}.glb` (bot-carried weapons) | imported | `games/last-circle/assets/props/meshy_wpn/` | original (FFG Meshy) |
| `assets/audio/sfx/*` (gun bodies, footsteps, impacts, foley, UI) | imported | FFSL CC0 slices + Kenney CC0 via `games/last-circle/assets/audio/sfx/` (license txts in-dir) | CC0 |
| `assets/audio/beds/*`, `assets/audio/oneshots/*` (ambience beds, thunder, explosions, Corvus layers) | imported | Sonniss GDC 2024 slices (44.1 kHz OGG re-encodes via ffmpeg `-vn`; never raw WAVs) — license captured at `assets/audio/SONNISS-LICENSE.txt` | Sonniss GDC royalty-free |
| Music (entire adaptive score) | procedural | Web-Audio synthesis (R14, `core/audio/music.js`) — no files | original |
| `assets/fonts/oswald-400-latin.woff2` | imported | Google Fonts "Oswald" v57 latin subset (via `pipeline/assets/_downloaded/fonts/Oswald/Oswald_02.woff2`) | SIL OFL 1.1 |
| HUD (crosshair, compass, killfeed glyphs), sky/cloud/ring textures, rain geometry | procedural | canvas / seeded-procedural (mulberry32, R21) | original |

**Sonniss NO-AI-TRAINING clause**: `assets/audio/**` must never be fed to any
generative-audio pipeline (Suno included) — per the captured license terms.

NOT shipped by ruling: Poly Haven HDRIs (R18 — env comes from sky.env() PMREM
+ the plaza-baked cube), swat.glb / chibi soldier (R15), Mixamo raw files
(Adobe terms — baked-only if used).

## W1 (iter03) — FP viewmodel source survey

No new external assets were fetched for the iter03 first-person-weapon work; the
existing `games/last-circle` Meshy bases were re-surveyed and re-qualified, and
the rebuild is entirely generator-side (`tools/a4_build_fp_weapons.py`). All six
last-circle Meshy weapon GLBs were rendered in isolation on a neutral mid-grey
with even three-point lighting and judged at first-person range; measured
triangle counts (Blender import, this session):

| Source (`games/last-circle/assets/props/meshy_wpn/`) | verts | tris | verdict |
|---|---|---|---|
| `wpn_ar.glb` | 4,908 | 5,943 | **selected** — Warden. Clean M4-pattern carbine: M-LOK handguard, birdcage device, real rail, stock, mag |
| `wpn_smg.glb` | 4,620 | 5,962 | **selected** — Vesper |
| `wpn_sniper.glb` | 4,479 | 6,143 | **selected** — Corvus. Bolt gun + scope; stock ships detached and is welded by the build tool |
| `wpn_pistol.glb` | 4,482 | 5,955 | **selected** — Pike |
| `wpn_shotgun.glb` | 4,704 | 6,088 | not used — no shotgun in the loadout |
| `wpn_glauncher.glb` | 4,506 | 6,169 | not used — no launcher in the loadout |

All six are original ForgeFlow Meshy generations (owner account), same lineage
as the entry above; nothing here changes the licence position. Every one of them
imports **split along its UV seams** (wpn_ar: 4,908 verts for 5,943 tris, welding
to 2,921 at 0.4 mm), as does `soldier.glb` (214,760 verts, 20,010 boundary
edges). That is a property of the source, not of the build — the generator now
welds before it cuts.
