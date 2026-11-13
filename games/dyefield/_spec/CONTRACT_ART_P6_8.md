# DYEFIELD — art contract for phases 6–8 (kits, Lockwell Works, Cinder Reef)

Companion to `CONTRACT.md` (PART I §3 asset formats still apply). The orchestrator owns this file.
The runtime side of these features (conveyor motion, springs, grates, out-of-bounds, mist,
interior lighting, AO) is built in the phase 6–8 runtime workflow **against the exact node names
and extras defined here**, so art must follow them literally.

## §14 Map format extensions (all maps)

### §14.1 Builder layout (refactor of `art/blender/build_map.py`)
- `build_map.py` becomes the **shared pipeline**: it reads `data/maps.json`, loads the map's
  layout, calls the per-map builder module, then runs the shared steps (atlas unwrap and pack,
  atlas stats and overlap check, AO bake, export, QA renders).
- Each map has its own builder module `art/blender/map_<id>.py` exposing
  `build(mdef: dict, layout: dict, ctx) -> None`. It creates Blender objects that follow the
  naming rules below; `ctx` gives the shared helpers (materials, bevel boxes, ramps, deco
  assets). `map_pier18.py` holds what is Pier-18-specific today (plate, pennants, over-water
  boards…). The Pier 18 GLB rebuilt through the new pipeline must have **identical node names
  and triangle counts, and `df_paint_area` within 0.1 %** of the committed one.
- The layout (brush list, map-specific props) lives in **`data/layouts/<id>.json`**, referenced
  from `maps.json` by `"layout": "layouts/<id>.json"`. Pier 18 keeps its inline `brushes`
  (legacy, still supported). Runtime-facing metadata (spawns, bounds, killY, waterY, lighting,
  paint, scoring, minimap, mist) stays in `maps.json`. The map lanes put their proposed metadata
  block in the layout file under `"meta"`, and the orchestrator merges it into `maps.json`.
- Brush kinds are generic where possible (box, ramp, stairs, crate, curb, planter, spawnpad,
  deco). Map-specific kinds are implemented in that map's module.

### §14.2 New node prefixes (runtime contract)

| prefix | visible | runners collide | paint/projectiles | extras (node custom props) |
|---|---|---|---|---|
| `grate_*` | yes (alpha-tested grid) | **yes** | **pass through** (not paintable; dye falls through) | — |
| `conveyor_*` | yes | yes | not paintable (a moving belt) | `df_conveyor: [vx, vy, vz]` world m/s applied to grounded runners standing on it |
| `spring_*` | yes (tide-spring pad) | yes | not paintable | `df_launch: [vx, vy, vz]` m/s launch velocity (a stand-on trigger) |
| `oob_*` | no | no (volume trigger) | — | a closed box mesh; feet inside = WASHED (cause 'sea') |
| `light_*` (empty) | — | — | — | `df_light: {color:'#RRGGBB', intensity, range}`; the runtime picks ≤ 6 as real point lights and treats the rest as emissive-only |

Existing prefixes are unchanged: `paint_`, `solid_`, `deco_`, `col_`, `water_`.

### §14.3 AO / light bake (all three maps, including a Pier 18 rebuild)
- Bake ambient occlusion (Cycles, headless; GPU if available, else CPU, ≤ 64 samples) for the
  `paint_*` surfaces into the **atlas UV2 space**. Save it as `art/gltf/map_<id>_ao.png` (8-bit
  grey, atlas-sized or half, dilated into gutters) and record it in `mapinfo` extras as
  `df_ao: "map_<id>_ao.png"`. The runtime multiplies indirect light by it.
- Optionally bake `solid_*` AO into vertex colors (`Col`).

### §14.4 Lighting presets (`maps.json` → `lighting.presets.<name>`)
- `"kind": "outdoor"` (default; the existing fields).
- `"kind": "interior"` adds:
  - `ambient` (hex) and `ambientIntensity`;
  - `keyDir` ([x, y, z], the skylight-down key) with `keyColor` and `keyIntensity`;
  - `fogColor` and `fogDensity`;
  - `skyVisible: false`, plus `windowGlow` (hex) for skylight panes;
  - `stripColor` (fluorescent emissive) and `sodiumColor` (practicals).
- Cinder adds a `"mist": { "hideRange": 25, "density": 0.012, "color": "#..." }` block at map
  level. Swimmers (moving or not) beyond `hideRange` are hidden from enemies, and the fog reads
  as light mist.

## §15 LOCKWELL WORKS — layout brief (lane LOCKWELL)

A different sport from Pier 18: **height is the map**. It is interior, close quarters and vertical.
- **Footprint:** interior ≈ 44 m (x) × 64 m (z), rot180-symmetric. Outer shell walls 13 m tall,
  roof with skylight strips (visible panes, rain streaks), no ocean horizon.
- **Floor 1, PRESS HALL (y 0):**
  - a central hall ≈ 18 m wide down the length;
  - two big press machines (paintable housings, 3.5 m tall) that split the hall into lanes;
  - crate stacks and pallets;
  - loading docks at each end, where the **team spawns** stand on a 1.0 m raised dock at
    z ≈ ±28;
  - **two conveyor ramps** (one per team, mirrored) rising from floor 1 to the mezzanine
    (≈ 4.5 m over ≈ 14 m), carrying you *uphill* toward mid at ≈ 2.2 m/s;
  - stairwells in the four corners.
- **Floor 2, MEZZANINE (y 4.5):**
  - galleries along both long walls (≈ 9 m deep), with small offices (door gaps, windows) and a
    loading-dock lip overlooking the hall;
  - two cross-bridges over the hall at z ≈ ±9;
  - the **faces of the mezzanine (the 4.5 m walls from floor 1) are paintable climb shortcuts**
    (wall-slick), marked by chevron trims at their base.
- **Floor 3, CRANE-WALK (y 9):**
  - `grate_` catwalks along the crane rail down the centre and around the crane cab;
  - the **crane cab nest** at mid (x 0, z 0) has a solid paintable floor (the charger nest) with
    a long lane down the hall;
  - reached by two stairwells from the mezzanine and by paintable climb walls.
  - The grates are NOT paintable, and dye falls through them.
- **Lighting preset `"works"` (interior):**
  - cool fluorescent strip lights (emissive strips in `M_strip` material) plus sodium
    practicals (`light_` empties ≤ 12, with the runtime choosing the 6 nearest);
  - skylight panes glowing dim overcast;
  - fog dark blue-grey;
  - a tight, slightly contrasty look.
- **Materials:** add `M_steel`, `M_grate`, `M_belt`, `M_press`, `M_brick`, `M_strip`,
  `M_skylight`, `M_office`, `M_dock` (all prefixed `M_`, with sensible Principled colors).
  Paintable floors are concrete/steel plate, not plaza tiles.
- Paint budget: the paintable area will be larger, so pick the atlas size per the §3.1 rule
  (2048 is allowed).
- The layout must be fair (rot180), every area must be reachable by walking (stairs, conveyor,
  ramps) — **wall-slick is a shortcut, never the only route**, except to the crane cab if you
  also give it stairs — and there must be no one-way traps.
- QA renders: `map_lockwell_top.png` (with the floors color-coded or cut away),
  `map_lockwell_persp.png` (from the SUNCREW dock), `map_lockwell_nest.png` (from the crane cab
  looking down the hall), `map_lockwell_interior.png` (mezzanine view).

## §16 CINDER REEF — layout brief (lane CINDER)

A broken atoll with land–water risk crossings: **rotation tax**. There are no plaza tiles.
- **Footprint:** ≈ 72 m (x) × 96 m (z) of play space, rot180-symmetric; surrounding sea to the
  horizon, water level `waterY` ≈ −0.6; `killY` below the channel beds.
- **Team beaches** at z ≈ ±38: wet-sand terrain (a gentle heightfield, paintable), with the spawn
  pad on a low basalt shelf.
- **Three land masses:**
  - WEST ISLE and EAST ISLE (x ≈ ±20, z ≈ 0): basalt shelves and rock outcrops (paintable rock
    tops and faces), ~1–3 m tall;
  - MID ISLE (x 0, z 0): high ground ≈ 3.5 m with a **rusted wreck hull** lying on it. Its deck
    is paintable steel, its hull sides are paintable climb walls, and there are holes to shoot
    through. It is the high-risk, high-reward centre.
- **Deep channels** (`oob_` volumes under a visible water surface, unpaintable, instant wash)
  separate each beach from the isles and the isles from Mid Isle.
- **Crossings:**
  - plank **bridges** (paintable wood, ~2.5 m wide, rope rails as deco/solid);
  - **shallow sandbars** (paintable wet sand just above the waterline, slick-able, narrow and
    exposed);
  - **tide-springs** (`spring_` pads) that launch you across a channel onto the next land
    (compute `df_launch` so the arc lands on the target with margin; document the landing
    point).
  Each beach reaches each side isle by at least two routes, and Mid Isle is reachable from each
  side isle by a bridge or a spring.
- **Ground materials:** add `M_wetsand`, `M_basalt`, `M_wreck` (rust plus paint chips),
  `M_plank`, `M_rope`, `M_kelp`, `M_coral_rock`, `M_shallows`, all prefixed `M_`.
- **Lighting preset `"reef"`** (outdoor, overcast warm late afternoon) plus the map-level `mist`
  block (hideRange 25).
- Charger water-lanes: long sightlines across channels from beach shelves. Shooter rotations
  come from the multiple crossings.
- QA renders: `map_cinder_top.png`, `map_cinder_persp.png` (from the SUNCREW beach),
  `map_cinder_mid.png` (Mid Isle wreck), `map_cinder_crossing.png` (a sandbar or bridge
  crossing).

## §17 Kits, sub and special art + hero clips (lane KITS)

- **Kit GLBs** (Blender −Y barrel, grip at the origin, a `muzzle` empty; toy-chunky, readable at
  gameplay distance from behind; neutral base plus `M_kit_dye` team-tinted parts; ≤ 3k tris
  each):
  - `kit_sheet_drum.glb` (ROLLER): a wide drum roller (~1.1 m drum on a handle held two-handed).
    Empties `drum` (spin axis +X) and `muzzle` at the drum's floor contact.
  - `kit_needle_glint.glb` (CHARGER): a long slim charge sprayer (~0.85 m) with a charge chamber
    (`M_kit_dye` glow) and a scope. Empties `muzzle` and `scope` (glint origin).
  - `kit_pop_well.glb` (BLASTER): a chunky bulbous launcher (~0.55 m) with a big round chamber.
    Empty `muzzle`.
- `sub_jelly_charge.glb`: a throwable jelly capsule (~0.28 m), a wobbly dome with a
  `M_kit_dye` core. Include a flattened **puddle** variant node `jelly_puddle` (hidden by
  default).
- `special_cloudburst.glb`: a floating rain cell, i.e. a stylized puffy cloud cluster (~2.4 m)
  over a small spinning buoy-core with `M_kit_dye` glow. Empties `rain` (rain emitter centre)
  and `core`. WELLSPRING needs no model (FX only).
- **Hero clips added to `tide_runner.glb`**, keeping all existing ones:
  - `roll`: full-body roller push loop, both hands on the handle;
  - `flick`: upper body, overhead roller fling;
  - `charge`: upper body, charger shouldered with a steady hold;
  - `blast`: upper body, blaster recoil;
  - `throw`: upper body, overhand sub throw;
  - `special_throw`: upper body, a big two-handed toss;
  - `slam`: full body, WELLSPRING leap and ground slam, ~1.1 s;
  - `hold_two`: upper body, a two-handed idle hold for roller/charger.
  Two-handed kits: the left hand reaches the kit, verified by FK distance < 3 cm to a `grip_L`
  empty on each two-handed kit.
- **QA renders:** `kit_all.png` (all four kits side by side from 3/4 and from the gameplay
  camera behind the hero), `kit_held_<id>.png` (hero holding each kit in its aim pose),
  `hero_clips_p6.png`, `sub_special.png`.
- `art/build.py check` extended by the orchestrator to validate the new GLBs; lanes report exact
  node names.
