# Authoring a DYEFIELD map module

`art/blender/build_map.py` is the **shared map pipeline** (CONTRACT §3.1, CONTRACT_ART_P6_8 §14).
It has no map-specific code. Each map has one builder module, `art/blender/map_<id>.py`, that
authors that map's geometry through a `ctx` object. The pipeline does everything else: atlas, AO,
export and QA renders. `map_pier18.py` is the reference module.

```
python art/build.py map <id>                       # the official build (writes art/gltf + art/renders)
python art/build.py map <id> --layout data/layouts/<id>.json   # lane build before maps.json is merged
  extra flags: --no-render  --quick-render  --samples N  --no-ao  --ao-samples N  --ao-distance M
               --out-dir <dir>   (write GLB/AO/stats/renders elsewhere; committed outputs untouched)
```
`build.py` hides Blender's console under the machine's console silencer. To see the log lines, run
`"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup
--python-exit-code 1 --python art/blender/build_map.py -- --map <id> [flags]` from the game folder.

## 1. Data: `maps.json` entry + layout file

| where | what |
|---|---|
| `data/maps.json` → `maps[i]` | runtime metadata (orchestrator-owned): `id status name … symmetry bounds killY waterY paint scoring minimap spawns lighting (mist)` plus `"layout": "layouts/<id>.json"` |
| `data/layouts/<id>.json` | `{"id", "meta": {…}, "brushes": [...], …map-specific props}` (lane-owned) |

- **Layout resolution:** `--layout <path>` first, then `maps.json` `layout`, then inline
  `brushes` (Pier 18's legacy form). The path may be absolute, relative to the game folder, or
  relative to `data/`.
- **`meta`** holds your proposed runtime block (`symmetry bounds killY waterY paint scoring minimap
  spawns lighting mist…`); the orchestrator merges it into `maps.json`. How it combines with
  `maps.json`:
  - normally, `meta` only fills keys that `maps.json` is missing;
  - with `--layout`, `meta` **overrides** them (it is your newest proposal), and the log lists the
    overridden keys;
  - a map whose status is still `planned` builds anyway (the log prints a NOTE).
- `symmetry`, `bounds`, `spawns` and `lighting` are required after the merge. `paint` defaults to
  `{"texelsPerMeter": 10, "atlasMax": 2048}`.
- Everything else in the layout (e.g. `"props": {...}`) belongs to your module: `build()` receives
  the whole layout dict.

## 2. Coordinates

- Data, brushes, `pos`, `eye`, `look` and **all extras** use runtime/glTF coordinates: Y-up, metres.
  SUNCREW (side A) is at −Z. Yaw 0 faces +Z and yaw +90 faces +X.
- `common.Geo` buckets and bmesh work in **Blender** coordinates (Z-up). Convert at the boundary
  with `ctx.g2b(x, y, z)` / `ctx.b2g(v)`: `g2b(x, y, z) = Blender (x, −z, y)` and
  `b2g(X, Y, Z) = glTF (X, Z, −Y)`.
- `ctx.place(pos, yaw, scale)` is the world matrix for an asset authored in the asset-local frame
  (origin at its base, up +Z, forward Blender −Y).

## 3. Brushes

Every brush has `kind` and `id`. `"mirror": true` adds the symmetry partner:
- `rot180` maps (x, y, z) → (−x, y, −z);
- ids become `<id>_m`, and every expanded brush carries `_base` = the authored id;
- the mirror also rotates `min/max`, `center`, `pos`, `points` and the 3-vectors
  `vel launch conveyor dir target land`, adds 180 to `yaw`, flips `rise`, and swaps `team` A↔B.

After module `FIXUPS` and the mirror, the expanded list is `ctx.brushes`. The pipeline warns on
positive-volume AABB overlaps between solid kinds. Exempt the floors and slabs that other solids sit
inside with `"overlapOk": true` on the brush, or list their ids in the module's `OVERLAP_OK`.

| kind | fields | built by |
|---|---|---|
| `box`, `curb` | `min max mat` | `arch.box_bm(b, top=, side=)` / `arch.nosed_box_bms(b, dirs, width)` |
| `ramp` | `min max rise(+x/-x/+z/-z) mat lip` | `arch.ramp_bm(b)` (lip strip in the `lip` material; default hazard) |
| `stairs` | `min max rise mat steps nose` | `arch.stairs_bms(b)` (+ `arch.stairs_col_bm(b)` into a `col_` bucket) |
| `crate` | `center(bottom) size yaw` | `ctx.build_crates()` → `paint_crate`, one `df_group` per crate |
| `planter` | `center size[w,h,d] yaw palm` | `ctx.build_planters()` |
| `spawnpad` | `center(top) radius team` | `ctx.build_spawnpads()` → `solid_pad_A/B` (+ `arch.pad_pockets()` for flush pads) |
| `deco` | `asset pos yaw scale collide text bucket` | `ctx.build_deco()` via the asset handlers |

- Built-in deco assets: `lamp`, `bollard` (solid when `collide`; on a waterfront map a seeded 2 of 3
  get a mooring rope, and `"rope"` forces it on or off), `billboard` (→ `deco_<id>`), `banner`,
  `lighthouse`, `cranes`, `islands`, `sailboat`, `buoy` (`variant`), `pennant` (`team`).
- Add your own asset, or override a built-in, with `ctx.register_deco(asset, fn(ctx, brush, matrix))`
  (Pier 18 registers `pilings` and `breakwater` this way).
- Map-specific kinds (e.g. `conveyor`, `press`, `wreck`) are just brushes your module reads with
  `ctx.brushes_of("conveyor")`. Any `min/max/center/pos/points/vel…` fields on them get mirrored for
  you.

## 4. The module contract

```python
# art/blender/map_<id>.py
FIXUPS = {}                       # optional: {brush_id: {field: value, "why": "..."}} applied before mirroring
OVERLAP_OK = {"floor"}            # optional: authored ids exempt from the AABB overlap warning (slabs, floors)

def build(mdef: dict, layout: dict, ctx) -> None:
    ctx.define_material("M_steel", "#8FA3B8", rough=0.45, metal=0.6)   # before first use
    arch = ctx.arch(["M_concrete", "M_hazard", "M_steel"])           # bmesh material_index = list position
    floor = ctx.brush("floor")
    ops = []
    for b in ctx.brushes:
        if b is floor: continue
        if b["kind"] == "box":    ops.append((f"_op_{b['id']}", arch.box_bm(b)))
        if b["kind"] == "ramp":   ops.append((f"_op_{b['id']}", arch.ramp_bm(b)))
        if b["kind"] == "stairs":
            ops += [(f"_op_{b['id']}_{k}", bm) for k, bm in enumerate(arch.stairs_bms(b))]
            ctx.bucket("col_stairs").add_bm(arch.stairs_col_bm(b), "M_concrete")
    bm = arch.union(arch.box_bm(floor), ops, arch.pad_pockets(ctx.brushes_of("spawnpad")))
    arch.bevel_convex(bm, 0.045)                   # convex edges > 30 deg, 2 segments
    arch.grid_cut(bm, "concrete", -22, 22, -32, 32, 4)
    ctx.geos.update(arch.to_geos(bm, arch.default_classify("solid_undersides")))
    bm.free()
    ctx.build_crates(); ctx.build_spawnpads(); ctx.build_deco()
    ctx.set_extras("conveyor_ramp_A", df_conveyor=[0.0, 0.7, 2.2])
    ctx.add_light("light_sodium_1", [0, 7.5, -12], "#FFB35C", 3.0, 14.0)
    ctx.add_camera("nest", eye=(0, 10.6, 1.5), look=(0, 1.0, -20), fov=60)
```

What the module produces is **named geometry**, and nothing else:
- each `ctx.bucket("<prefix><name>")` (a `common.Geo`: world-space Blender verts, per-face `M_*`
  names) becomes one object/node;
- or it can build a bpy mesh object itself and hand it over with `ctx.add_object(ob)`. The
  pipeline applies its transform, and adds `UVMap` if it is missing (paint objects must not carry
  modifiers).

The module must **not**:
- unwrap the atlas, export, create `mapinfo`/`spawn_*`, or render;
- write into `art/gltf` or `art/renders`. The pipeline does all of that.

## 5. `ctx` reference

| member | purpose |
|---|---|
| `mdef`, `layout`, `map_id`, `brushes`, `notes`, `team_hex` | merged map entry, raw layout, id, expanded brushes, fixup notes, `{'M_pad_A': hex, 'M_pad_B': hex}` |
| `brush(id)`, `brushes_of(*kinds)`, `ground_y(x, z)` | lookups (`ground_y` = top of the highest box/curb over x, z) |
| `g2b`, `b2g`, `place(pos, yaw, scale)`, `seed(*parts)`, `rng(*parts)` | coordinates and deterministic randomness (never unseeded) |
| `C`, `D`, `log` | `common` (Geo, bm_box/bm_cylinder/bm_lathe/bm_tube, boolean_chain, …), `deco_assets` (crate_unit, planter, palm, spawn_pad, lamp, bollard, billboard, banner, buoy, pennant, pilings, breakwater, lighthouse, cranes, islands, sailboat …), logger |
| `mat(name, hex=None)`, `define_material(name, hex, rough, metal, emis, double)` | M_* materials (plain Principled; the runtime swaps them by name) |
| `bucket(name)` → `Geo` | `.add_bm(bm, "M_x", matrix)`, `.extend(geo, matrix, group=)`, `.add_mesh_data(me, mats, matrix)` |
| `arch(mats, default="concrete", lip="hazard")` → `Arch` | `box_bm nosed_box_bms ramp_bm stairs_bms stairs_col_bm pad_pockets union bevel_convex grid_cut default_classify to_geos idx` |
| `build_crates(bucket)`, `build_planters(...)`, `build_spawnpads(depth)`, `build_deco()`, `register_deco(asset, fn)` | the generic prop kinds |
| `add_object(ob, extras)` | a module-built mesh object |
| `set_extras(node, **kv)` | node extras (glTF coordinates) |
| `add_empty(name, pos, yaw, extras)`, `add_light(name, pos, color, intensity, range)` | exported empties; `light_*` get `df_light` |
| `info[k] = v` | extra `mapinfo` extras (after the pipeline's `df_*`) |
| `summary[k] = v` | extra keys in `art/renders/map_<id>_stats.json` |
| `cameras`, `add_camera(name, eye, look, fov, res, clip_start, before, after)` | QA stations (see §8) |
| `add_preview_shader(mat, fn(ctx, nt, bsdf, base_rgb) -> socket)`, `sh.*` (node helpers: `math mix uv pos edge_dist white sock`), `render_hooks.append(fn(ctx, scene))`, `render_light_scale` | QA-render looks only (never exported) |
| `ao` = `{enabled, samples, distance, size, exclude_prefixes, dilate_px}` | AO bake settings (see §7) |

`Arch.to_geos(bm, classify)` splits the unioned bmesh into buckets. `classify(face)` returns a
bucket name, or `None` to drop the face. `default_classify(bottoms)` sends down-facing faces to
`bottoms` and everything else to `paint_<material>`. Write your own when some faces must not be
paintable (Pier 18: faces on the slab's outer edge go to `solid_pier_skirt`; faces inside a pad
pocket are dropped).

## 6. Node prefixes and extras (the runtime contract)

| prefix | runtime | paint | transforms | extras |
|---|---|---|---|---|
| `paint_*` | visible, collides | **yes**, and gets the atlas | applied | — |
| `solid_*` | visible, collides | no | applied | — |
| `grate_*` | visible (alpha-tested grid), collides | no; dye falls through | applied | — |
| `conveyor_*` | visible, collides, a moving belt | no | applied | `df_conveyor: [vx, vy, vz]` m/s (**required**) |
| `spring_*` | visible tide-spring pad, stand-on trigger | no | applied | `df_launch: [vx, vy, vz]` m/s (**required**) |
| `col_*` | invisible, collides | no | applied | — |
| `oob_*` | invisible volume (feet inside = WASHED, cause 'sea') | — | applied | a closed box mesh (WARN if not closed) |
| `deco_*` | visible, no collision | no | as authored | — |
| `water_*` | visible, no collision | no | as authored | — |
| `light_*` (empty) | ≤ 6 become real point lights; the rest are emissive-only | — | — | `df_light: {color:'#RRGGBB', intensity, range}` (**required**) |

- Any other mesh prefix fails the build.
- Nodes are exported in the order
  `paint_ solid_ grate_ conveyor_ spring_ col_ oob_ deco_ water_`, each group sorted by name.
  After them come `mapinfo`, `spawn_A`, `spawn_B`, then the module's empties.
- Only faces a player can see or reach belong in `paint_*`. Bottoms, faces flush against other
  solids and skirts go in `solid_*`, or are dropped.
- `mapinfo` extras (pipeline):
  - `df_map_id`, `df_atlas_size`, `df_texels_per_meter`, `df_paint_area`, `df_version`;
  - `df_atlas_islands`, `df_atlas_margin_px`, `df_atlas_overlap_texels`, `df_paint_tris`;
  - then `ctx.info`, then `df_ao`.
- Budgets: GLB ≤ 8 MB, ≤ 250k triangles in total, ≤ 120k triangles in `paint_*`.

## 7. Shared post-steps (what happens after `build()`)

1. **Realise:** buckets and module objects are created in prefix order, extras are attached and
   §14.2 is validated, and `UVMap` (UV0) is set to metres by box projection.
2. **Atlas** (UV2 `Atlas`, all `paint_*` together):
   - smart project at 60°, with every `df_group` instance (crate) in its own pass;
   - average island scale, then pack with a 4 px margin (the best clean pass is kept);
   - atlas size = the smallest of 512/1024/2048 (≤ `paint.atlasMax`) that reaches ≥ 80 % of
     `paint.texelsPerMeter`;
   - the build **fails** if no size packs with zero overlap and zero margin or border violations;
   - writes `art/renders/map_<id>_atlas.png`.
3. **AO bake** (§14.3):
   - Cycles AO, ≤ 64 samples, 2.0 m distance; it runs on the GPU (OptiX/CUDA) when one is present,
     else on the CPU;
   - it bakes every `paint_*` surface into Atlas space. Every render-visible object occludes,
     except `ctx.ao["exclude_prefixes"]` (default `col_ oob_ water_`);
   - output: `art/gltf/map_<id>_ao.png`, 8-bit greyscale. The size matches the atlas up to 1024
     and is half the atlas at 2048;
   - the bake is dilated 16 px into the gutters, and unused texels are white;
   - the image uses standard glTF orientation: PNG row 0 = `TEXCOORD_1` v 0 (verified by sampling
     the exported UVs);
   - `mapinfo.df_ao = "map_<id>_ao.png"`;
   - the stats JSON gets `ao` (histogram, percentiles and a `sane` flag). `sane` means not flat,
     crate sides near their base darker than higher up, and floor hugging a crate darker than open
     floor.
4. **Export** `art/gltf/map_<id>.glb`: Y-up, extras on, modifiers applied, no images.
   `art/renders/map_<id>_stats.json` gets the atlas + AO stats and `ctx.summary`.
5. **QA renders** (EEVEE, AgX Punchy) → `art/renders/map_<id>_<station>.png`:
   - default stations: `top` (ortho, SUNCREW at the bottom, screen-right = −X like the minimap),
     `persp` (player's eye from the SUNCREW spawn toward mid), `aerial` (3/4 lobby view);
   - add stations with `ctx.add_camera`, or edit `ctx.cameras["top"]["ortho_scale"]` and similar;
     `before`/`after` hooks can hide a roof for a cut-away;
   - lighting preset `kind: "interior"` renders an ambient-coloured world, a key light along
     `keyDir` and no sea;
   - `light_*` empties become point lights (`intensity × ctx.render_light_scale` W);
   - `col_*` and `oob_*` are hidden.

## 8. New-map checklist

1. `data/layouts/<id>.json` with `meta` and `brushes`; `art/blender/map_<id>.py` with
   `build(mdef, layout, ctx)`.
2. `python art/build.py map <id> --layout data/layouts/<id>.json` builds clean. Check that:
   - the atlas reports zero overlaps;
   - the stats JSON shows `ao.sane` true;
   - you have read every QA render and iterated.
3. `python art/build.py check` must be OK. It validates maps with `status: "built"` in
   `maps.json`, so hand the `meta` block to the orchestrator for the merge. Until then, run
   `python -c "import sys; sys.path.insert(0,'art'); import build; print(build.check_map('art/gltf/map_<id>.glb','<id>'))"`.
4. Keep everything deterministic: seeded randomness only, and no set iteration over bmesh
   elements (use `dict.fromkeys` to keep an order). `Geo.canonicalize()` orders faces by geometry,
   so rebuilds are byte-stable.
