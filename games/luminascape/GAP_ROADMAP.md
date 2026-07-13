I have everything I need. The CHANGELOG confirms what to exclude (ponds, move+duplicate, save slots, night windows, seasons, waves/foam, particle paint, part-editor, cloudy preset, window/door shapes, paintable grass, forest gizmo, undo/redo, procedural clouds, ground fog, 459+26 assets, rich audio). Here are the two deliverables.

---

# LuminaScape — Synthesis: Gap Roadmap + Asset Plan

## PART 1 — PRIORITIZED GAP ROADMAP

### 🎯 TOP 6 NEXT (highest bang-for-buck, in order)

1. **Photo Mode** — the screenshot IS the product in a goal-less builder; both research streams rank it #1 for shareability. Free-fly cam + hide UI + tilt-shift/DOF + download button.
2. **HDRI sky + image-based lighting** — single biggest *visual* leap; the game still has only a procedural dome. Swap `scene.environment`/`background` via `RGBELoader`, cross-fade by time/weather. (Asset already in the download plan below.)
3. **World share (export/import + copy-code)** — worlds are already JSON; today they die on the device. This is the community engine (Townscaper/Sims Gallery). gzip+base64 → clipboard + file import.
4. **Rotation snap + free/precise rotate on placement** — Tiny Glade's #1 request, easy win; yaw is already tracked. Shift=free / default 15° snap + rotate ring on ghost.
5. **InstancedMesh + LOD for placed props** — silent perf killer: every placed tree/rock/building is its own draw call, so dense (screenshot-worthy) worlds tank on mid/mobile. Batch identical props; billboard far LOD.
6. **First-run onboarding / coach-marks** — protects all the depth already built; a blank void with 9 tools bounces first-timers. 4-step guided beats + "Load a sample world."

> Why this six: #1–#3 form the shareability triad (make → look great → pass around) that drove word-of-mouth for the genre leaders; #4 and #6 are cheap ergonomics/discoverability wins; #5 is the durable fix that unlocks the bigger worlds the other five make people want to build.

---

### P0 — Must-have to feel complete

| Gap | Why it matters | Feasibility (single-file Three.js) | Implementation sketch |
|-----|---------------|-----------------------------------|----------------------|
| **Photo Mode** (free-fly cam, hide UI, tilt-shift/DOF/vignette, aspect presets, hi-res + download) | The share loop; only a *debug* `__MS__.shot` exists, no player-facing capture | Med — composer + `shot()` render path already exist; add detached cam + `BokehPass`/tilt-shift pass + P-key overlay | New "📷" mode dims toolbar, adds DOF + rule-of-thirds guides, exports PNG at 2×/4× via blob download |
| **HDRI sky + IBL** | Biggest visual upgrade; grounded lighting + water reflections vs flat dome | Med — vendor `RGBELoader`; load `.hdr` to `scene.environment`+`background` | Cross-fade 6 HDRIs by day/night + weather; keep dome as fallback |
| **World share: export/import file + copy-code** | Worlds are trapped in localStorage; sharing = retention for goal-less builders | Med — already serialize to JSON | gzip+base64 → "Copy World Code" / "Paste to Load"; + Export/Import `.json` file (also fixes browser-clear data loss) |
| **Rotation snap + free/precise rotate on place** | Tiny Glade top request; Sims ALT/`<>` combo; game has rotate but no snap/precise-on-place | Easy — yaw already tracked | Shift=free vs 15°/45° snap toggle; rotate ring + numeric readout on the placement ghost |
| **InstancedMesh + 2-tier LOD for placed props** | Every placed prop = its own draw call; dense worlds tank on mid/mobile (DPR governor can't fix draw-call count) | Med-Hard — instancing only used for grass/fence-posts today | Group identical props into per-model `InstancedMesh`; `THREE.LOD` swaps distant trees to billboards/impostors |
| **First-run onboarding / coach-marks + empty-state** | 9 tools + ~1,100 assets over an empty void bounces newcomers; only a single `#hint` line today | Easy-Med | Dismissible 4-step walkthrough ("Sculpt a hill → Paint grass → Plant a tree → Dig a river") + "Try a demo world" seed on empty title |

### P1 — High value

| Gap | Why it matters | Feasibility | Implementation sketch |
|-----|---------------|-------------|----------------------|
| **Marquee multi-select → move/rotate/duplicate/delete group** | Move/dup exist for ONE object only (Wave 9); group ops save real tedium | Med — erase-area already proves the drag-box pattern | Drag-box in Edit collects entries → shared transform + one batched undo |
| **Camera framing: focus-on-selection + orbit-pivot + zoom-to-cursor** | Makes screenshots look intentional; game pans (WASD) but can't frame what you clicked | Med | Double-click object → cam eases to an `orbitTarget`; RMB-drag orbits pivot; wheel zooms toward cursor raycast |
| **Path-drives-architecture** (path→wall = door, →fence = gate, →slope = steps, →water = stepping stones) | Tiny Glade's *signature* delight; game has roads + manual fence→gate but no path-authored openings | Med — reuse the existing window/door-shape rebuild as a cut; slope→terrace the road mesh | On road endpoint hitting a building/fence bbox, trigger door-shape cut; auto-terrace on slope. (Respects "no bridges" — stepping-stones/steps only) |
| **Blueprint / prefab stamping** (save a selection as a reusable kit: cottage-with-garden, orchard, village block) | Repetitive builds are tedious one-by-one; Sims blueprint reuse | Med — builds on group-select + JSON serialize | Serialize multi-object selection → named "kit" → re-instantiate terrain-followed on click |
| **GIF / short-clip capture** (5s auto-orbit + day→night sweep → WebM) | Auto-clip of a sunset-to-night world is inherently viral ("marketing gold") | Med — `MediaRecorder` on canvas | "🎬 Record clip" runs auto-orbit + time sweep, exports WebM |
| **Mobile / touch support** (pinch-zoom, 2-finger orbit/pan, larger tap targets, responsive toolbar) | Arcade traffic is heavily mobile; code is pointer-events only | Med | `touchmove` gesture layer (pinch=zoom, 1-finger=paint, 2-finger=orbit/pan) + compact toolbar under ~700px |
| **Explicit quality tiers + FPS readout** | Governor exists internally but isn't a user choice; weak-hardware users can't self-rescue | Easy | Settings dropdown: Low/Balanced/Beautiful (shadows, bloom, grass cap, DPR) + "Show FPS" toggle |
| **Copy-style / eyedropper** (pick a building's paint+style, apply to another) | Beloved Sims build tool; rich part-editor exists but no way to copy a look | Easy | Stash `_sel.partTint/partStyle` to clipboard; "apply look" on next selection |

### P2 — Nice-to-have

| Gap | Why it matters | Feasibility | Implementation sketch |
|-----|---------------|-------------|----------------------|
| **Persistent plant growth stages** (saplings → mature trees on the season clock) | Garden Life's core loop; current rain→grow is a transient flourish, not persistent | Med | Per-plant `age` that scales/swaps GLB (`sapling`→`_full`) on the season clock already running |
| **Ambient life reactivity** (butterflies gather at flowers, birds land in trees, animals graze near water) | Terra Nil's emotional reward — life reacting to what you built | Med | Bias existing wander/critter spawns toward flower/water/tree density (hook into grazing + particle paint) |
| **Minimap / world overview + click-to-recenter** | Worlds hit 29 chunks with no overhead view | Easy | Top-down ortho render of heightfield to a corner canvas; click recenters cam target |
| **Colorblind-safe UI + non-color cues** | Top-4 a11y ask; 4-channel paint + 12 ground types + green selection lean on color | Med | Colorblind LUT + labeled swatches + selection outline/glow (not only green) |
| **Remappable keys + UI text-size scale** | A11y top-4; WASD/hotkeys hardcoded, no font scaling | Med | Key-rebind panel + UI scale slider |
| **Undo history panel + named checkpoints** | Undo/redo exist but depth is invisible; users trust bolder edits when they see it | Easy | Surface stack depth + "pin checkpoint" list |
| **Text/sign labels & waypoints** | Storytelling/diorama captions (Summerhouse signs) | Easy | Editable text-texture overlay on existing signpost props |
| **Positional/per-biome audio + UI SFX** | Audio is rich but global; positional water/forest beds + soft UI clicks add polish | Med | `PositionalAudio` for water/forest + subtle UI click SFX |
| **Postcard/frame export presets + watermark** | Curated output raises share appeal | Easy | Optional decorative frame + "made in LuminaScape" stamp on export |
| **Autosave + quota/corruption guard** | localStorage can hit quota/corrupt | Easy-Med | Debounced autosave + try/catch quota toast |

*Excluded (already shipped — verified against CHANGELOG): ponds/lakes, move+duplicate (single), named save slots, night-lit windows, seasons on live clock, wind waves + shoreline foam, particle paint (fireflies/butterflies), leaf-drop, building part-editor + window/door shape swap, cloudy/overcast preset, ground fog, procedural clouds, paintable grass + erase-drag, forest resize gizmo, undo/redo, 12-type terrain paint, rivers/oceans/ponds/auto-beach, weather + disasters, day/night + sleep cycles, procedural ambient audio, ~1,100 assets, Play mode. **Bridges intentionally omitted per owner** — path→steps/stepping-stones only, never spans.*

---

## PART 2 — ASSET ACQUISITION PLAN (ACTIONABLE)

**Already local — do NOT re-download:** Poly.Pizza 3,689 GLBs at `F:\AssetLibrary\polypizza\<cat>\<ID>.glb` (indexed in `_manifest.json`; `static.poly.pizza` bare-curl 403s the bot anyway — always copy from disk). Kenney/fantasy kits at `F:\3d-asset-packs`. 459 lazy `xtra/` + 26 garden GLBs already wired.

**The genuine download gaps** (nothing local): HDRI skies, PBR ground/water textures, water normal map, Kenney particle/foliage sprite PNGs. Model *gaps* (fish/birds/market/farm/seasonal) are covered by copy-from-disk, not download.

### Ranked plan

| # | What | Source | License | Wires into | Priority |
|---|------|--------|---------|-----------|----------|
| 1 | 6 HDRI skies (clear/partly/sunset/puresky/overcast/night) | Poly Haven (direct CDN) | CC0 | `scene.environment`+`background` via `RGBELoader`, cross-fade by time/weather (gap #2 above) | **P0** |
| 2 | Water normal map | three.js repo | CC0 | drop-in `waterNormals` for the `Water.js` already running → real ripples/foam | **P0** |
| 3 | 7 PBR ground sets (grass/dirt/rock/sand/snow/mud/forest-floor) | ambientCG | CC0 | `map`/`normalMap`/`roughnessMap` on existing `makeGroundMat` per-channel — **behind a flag**, do NOT add splat channels (CHANGELOG deferred this twice) | P1 |
| 4 | Kenney Particle Pack + Foliage Sprites | Kenney (direct) | CC0 | `map` on additive Points/Sprite for fireflies/smoke/thunder; billboard grass/leaf cards | P1 |
| 5 | Model gap fills (fish/birds/market/farm/seasonal) | **local `F:\AssetLibrary\polypizza`** | CC0/CC-BY | copy to `assets/models/xtra/<kit>/`, register in `_XTRA_DATA` (Wave 8 `_LAZY` path) | P1 (copy, not download) |
| 6 | On-demand specific-model gaps (a pose/prop) | Sketchfab API (key present) | CC0 | GLB to `xtra/` — signed URL expires 300s, curl immediately | P2 |
| 7 | Fresh nature GLBs by keyword | Poly.Pizza API (key present) | CC0/CC-BY | pull NEW-not-on-disk models to `xtra/` | P2 |

---

### 🚀 RUN THESE NOW (copy-pasteable — Git-Bash/curl, from the game dir)

```bash
# ── target dirs ──────────────────────────────────────────────
cd "C:/Users/TestRun/Claude Claw/deliverables/demos/meadowsmith/assets"
mkdir -p hdri ground water sprites models/xtra

# ── 1. HDRI SKIES (P0, no key) — all 6 slugs pre-resolved to direct CDN URLs ──
#     Wire: RGBELoader → scene.environment + scene.background, cross-fade by time/weather
curl -Lo hdri/day_clear.hdr      "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/syferfontein_1d_clear_2k.hdr"
curl -Lo hdri/day_partly.hdr     "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_2k.hdr"
curl -Lo hdri/sunset.hdr         "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/the_sky_is_on_fire_2k.hdr"
curl -Lo hdri/sunset_puresky.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/belfast_sunset_puresky_2k.hdr"
curl -Lo hdri/overcast.hdr       "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_puresky_2k.hdr"   # pairs with existing Cloudy preset
curl -Lo hdri/night.hdr          "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/moonless_golf_2k.hdr"

# ── 2. WATER NORMAL (P0, no key) — drop-in for the Water.js already in-game ──
curl -Lo water/waternormals.jpg  "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg"

# ── 3. PBR GROUND SETS (P1, no key, ambientCG 302 → curl -L) — wire per-channel behind a flag ──
#     Each zip = _Color + _NormalGL + _Roughness + _AO + _Displacement (JPG)
curl -Lo ground/grass.zip        "https://ambientcg.com/get?file=Grass004_2K-JPG.zip"    # R channel (grass)
curl -Lo ground/dirt.zip         "https://ambientcg.com/get?file=Ground037_2K-JPG.zip"   # G channel (damp earth/moss)
curl -Lo ground/rock.zip         "https://ambientcg.com/get?file=Rock030_2K-JPG.zip"     # B channel + auto-slope rock
curl -Lo ground/sand.zip         "https://ambientcg.com/get?file=Ground027_2K-JPG.zip"   # A channel / auto-beach
curl -Lo ground/snow.zip         "https://ambientcg.com/get?file=Snow006_2K-JPG.zip"     # winter-season floor
curl -Lo ground/mud.zip          "https://ambientcg.com/get?file=Ground036_2K-JPG.zip"   # paint12 'wetmud'
curl -Lo ground/forestfloor.zip  "https://ambientcg.com/get?file=Ground068_2K-JPG.zip"   # paint12 'moss'/'forest'

# ── 4. KENNEY PARTICLE + FOLIAGE SPRITES (P1, no key) — content-hash paths verified live ──
#     Wire: particle PNGs → map on fireflies/smoke/thunder Points; foliage → billboard grass/leaf cards
curl -Lo sprites/particle-pack.zip   "https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip"     # (VERIFY: Kenney rotates hash on re-upload; if 404, scrape Download href on kenney.nl/assets/particle-pack)
curl -Lo sprites/foliage-sprites.zip "https://kenney.nl/media/pages/assets/foliage-sprites/b65bd70c69-1677495980/kenney_foliage-sprites.zip"  # (VERIFY: same hash caveat, kenney.nl/assets/foliage-sprites)

# ── 5. SKETCHFAB CC0 gap-fill (P2, KEY PRESENT: sketchfab) — signed URL expires 300s, runs inline ──
UIDX=$(curl -s "https://api.sketchfab.com/v3/search?type=models&downloadable=true&license=cc0&q=lily+pad&count=1" | python -c "import sys,json;print(json.load(sys.stdin)['results'][0]['uid'])")
curl -s "https://api.sketchfab.com/v3/models/$UIDX/download" -H "Authorization: Token 32c5c3ac0afe456fa5c9646d726b80ef" | python -c "import sys,json;print(json.load(sys.stdin)['glb']['url'])" | xargs -I{} curl -Lo models/xtra/lilypad_sf.glb "{}"

# ── 6. POLY.PIZZA fresh nature pull (P2, KEY PRESENT: polypizza) — only for models NOT already on F:\ ──
curl -s "https://api.poly.pizza/v1.1/search/garden?Limit=20" -H "x-auth-token: 08463d3403b345a58cfccb6094e4c85b" \
  | python -c "import sys,json;[print(m['Download']) for m in json.load(sys.stdin)['results']]" \
  | while read u; do curl -L -O --output-dir models/xtra "$u"; done
```

**Model gap fills (copy from disk — do NOT curl; `static.poly.pizza` 403s the bot):**
```bash
# Fish (nothing swims in the new ponds yet): Mandarin/Mackerel/Cardinal/Clownfish/Goldfish + frog
# Birds (extend the flock): Seagull/Sparrow/Great Tit/Raven/Chicken/Eagle + birdhouse
# Market: Tent(s) as stall canopies + Crate/Crate-of-Buns as goods
# Farm: Barn/Small Barn/Silo/Haystack/Windmill/Wheelbarrow/Gate
# Seasonal: Pumpkin/Candy Corn + Street/Hanging/Candle lanterns
# grep the ID across polypizza subfolders (birds/fish=animals/, tents/crates=objects|buildings/), then:
cp "F:/AssetLibrary/polypizza/animals/h6M5zlF5Yx.glb" "assets/models/xtra/fish/h6M5zlF5Yx.glb"   # example: Mandarin Fish (CC0)
# Register each in _XTRA_DATA (name→[group,path]) + append CC-BY attributions to xtra/CREDITS.txt
```

### Notes / flags
- **Keys present & used:** `sketchfab` (Token auth, cmd #5), `polypizza` (x-auth-token, cmd #6). No key needed for Poly Haven, ambientCG, Kenney, three.js repo.
- **`(VERIFY)` items:** the two Kenney URLs — content-hash path segments were live at report time but Kenney rotates the hash on re-upload. If either 404s, WebFetch `kenney.nl/assets/particle-pack` (or `/foliage-sprites`) and grab the current Download href.
- **ambientCG** 302-redirects to `acg-download.struffelproductions.com` — `curl -L` is required (already in the commands).
- **HDRIs (#1)** touch lighting — load as `scene.environment` via a vendored `RGBELoader` (r160 addon, no build step); keep the procedural dome as fallback. Wave 5 already flagged HDRI as the intended next atmosphere pass.
- **PBR ground (#3)** — CHANGELOG **deferred this twice**; gate behind a flag, feed the *existing* `makeGroundMat` per-channel maps, do NOT add splat channels; empty/failed load must fall back to current material.
- **itch.io packs** (Quaternius/KayKit) intentionally omitted from RUN-NOW: no stable hotlink and no itch API key in `api_config.json` (owner can generate one at itch.io/user/settings/api-keys). The Poly.Pizza library on disk already covers the low-poly nature niche, so this is not blocking.