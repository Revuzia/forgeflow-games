# BLACKRIDGE — Showcase Map Design: "MERIDIAN WARD"

**Deliverable:** single showcase map + mission for BLACKRIDGE v1 (modern-military FPS, browser Three.js r172, no build step).
**Quality bar:** MW2019→MWIII-era *look and feel* — original IP throughout; no CoD names, maps, or assets.
**Doctrine compliance:** written against `pipeline/knowledge/GAME_DOCTRINE.md` (§2 combat feel, §3 rendering/perf, §5 verification, §6 shell, §7 assets) and `reference_review_2026-07/adoption_plan.json` (fixed light pools, p99 gates, referential-integrity gate, bot-fairness constants). Every rule cited inline where it constrains a design choice.

---

## 0. Scene direction decision: night urban rain vs. golden-hour port

**Alternative considered — golden-hour industrial port:** a low warm sun over cranes, containers, and water gives long shadows, warm/cool color contrast, and strong silhouettes. It is a legitimate AAA look. Rejected on four grounds, all specific to *our* stack:

1. **Shadow budget kills it.** Doctrine caps the shadow map at 1024 (§3 standing doctrine). Golden hour IS long grazing shadows; 1024 texels across a 120 m playfield is ~12 cm/texel — visible acne/peter-panning on every long shadow, exactly where the eye goes. Night needs one soft moon shadow that nobody scrutinizes.
2. **Daylight exposes what we can't afford.** Uniform sky light reveals texture tiling, low-poly silhouettes, and missing GI. We have no baked GI and the adoption plan explicitly **skipped** the full AAA post chain (GTAO/TAA/motion blur) for perf — the tools that sell clean daylight. Night+rain replaces diffuse detail with specular detail: normal maps + wet roughness + emissive practicals generate per-pixel richness the geometry doesn't have.
3. **Night plays to what the kernel already has.** AgX/ACES tonemapping + UnrealBloom are verified present (adoption plan, `render_quality_gate.py` markers). Bloom on sodium lamps and neon is free production value; bloom on a daylight port is nothing.
4. **Fog is a perf feature at night.** Exponential height fog lets us fade distant geometry into skyglow, cap draw distance, and hide LOD/skybox seams. Daylight fog reads as haze/overcast and fights the golden-hour premise.

**DECISION: night urban rain.** Rain-slick asphalt, planar-reflection puddles, sodium + neon practicals, layered fog. This is the confirmed direction; everything below assumes it.

---

## 1. Map concept + fiction (original IP)

**City:** Zarov — a fictional Black-Sea-adjacent free-port city.
**District:** **Meridian Ward** — the old tannery-and-market quarter wedged between the freight canal and the customs terminal. Sodium streetlights, hangul-free invented signage (Zarov Latin/Cyrillic-flavored invented brand names only — see §7 IP rules), tram wires, market kiosks, container cranes on the skyline.
**Situation:** A rolling storm blackout has cut the district's grid; only isolated feeder circuits (one market block, the tramline, the customs floodlights) still hold. Under cover of the outage, **Vektor Ancile** — a delisted PMC turned arms broker — is moving **CINDERLOCK**, a stolen missile-guidance module, through the ward to a freighter that sails at dawn.
**Player:** RAVEN 2-1, lead of a two-man joint task-force element (partner is voice/radio only in v1 — no companion AI). **Operation BLACKRIDGE:** infiltrate from the canal, seize CINDERLOCK at the handoff point, and hold Customs Gate 9 until extraction.
**Why combat happens here:** Vektor Ancile has locked the ward down with checkpoint teams while the handoff happens — the player is inside their cordon, moving against the flow of their patrols. Every set-piece is a cordon layer: quay patrol → alley checkpoints → the market screen-line → the handoff guard → the boulevard overwatch → the gate QRF.

**Naming note:** All names above (Zarov, Meridian Ward, Vektor Ancile, CINDERLOCK, RAVEN 2-1, Lanternwalk, Gate 9) are invented for this project. Nothing references CoD factions, operators, maps, or missions.

---

## 2. Layout blueprint

### 2.1 Coordinate convention

- Origin at map center. **+X = east, +Z = south, Y up** (three.js default camera forward is −Z = north). All positions in metres as `(x, y, z)`.
- Playable bounds: X ∈ [−60, +60], Z ∈ [−60, +60] (120 × 120 m).
- Mission axis runs **south → north** (Z +52 → Z −58).

### 2.2 Overview map (north = up = −Z)

```
Z=-60 ┌────────────────────────────────────────────────────────────┐
      │  CUSTOMS YARD / GATE 9          [exfil gate (0,-58)]       │
      │  flood towers (-14,-44) (+18,-44)  gatehouse (+8,-52)      │
Z=-40 ├──────────┬──────────────────────┬───────┬─────────────────┤
      │ TANNERY  │  MARKET STREET       │ STORM │ TRAM PLATFORM   │
      │ ALLEYS   │  (X -12..0)          │GALLERY│ (deck y=+4.5)   │
      │ (west    │                      │(X 16..│ Z -40..-52      │
Z=-20 │  lane)   ├───────────┐          │  24,  ├─────────────────┤
      │ X -60..  │ PALE      │ MERIDIAN │ flank)│ TRAMLINE        │
      │   -40    │ LANTERN   │ MARKET   │       │ BOULEVARD       │
      │          │ ARCADE    │ PLAZA    │       │ roadway         │
      │ dog-legs │ (2 story, │ X -25..  │       │ X +28..+46      │
Z=  0 │ at Z+18, │ X -40..   │   +15    │       │                 │
      │    Z-6   │   -25,    │ Z -18..  │       │ 78 m clear      │
      │          │ Z -20..+6)│   +18    │       │ centre lane     │
Z=+18 │          ├───────────┘          │       │                 │
      │          │   (kiosks, cars,     │       │                 │
      │          │    puddle group)     │       │ barricade Z+38  │
Z=+40 ├──────────┴──────────────────────┴───────┴─────────────────┤
      │  DOCKSIDE CUT (quay Z +42..+54)   player spawn (-38,0,+50)│
Z=+54 │  ~~~~~~~~~ freight canal (water, non-playable) ~~~~~~~~~~ │
Z=+60 └────────────────────────────────────────────────────────────┘
       X=-60        X=-25          X=+15  X=+24  X=+28      X=+60
```

### 2.3 Three lanes + flank (CoD lane discipline)

| Lane | Zone | Width | Sightline band | Character |
|---|---|---|---|---|
| **West** | Tannery Alleys | 4–6 m | **CQB 5–14 m** (two dog-legs at Z +18 and Z −6 break every line) | shotgun/SMG lane, steam + scaffolding, darkest |
| **Center** | Meridian Market plaza → Market Street | plaza 40 × 36 m, street 12 m | **mid 20–40 m** (kiosks and cars cap diagonals at ~38 m) | rifle lane, the showcase space, brightest |
| **East** | Tramline Boulevard | roadway 18 m | **long 78 m** (south barricade face at Z +38 → tram platform face at Z −40, center lane deliberately kept clear) | marksman lane, sodium pools receding into fog |
| **Flank** | Storm Gallery | 3.5 m | CQB 8–18 m | covered service arcade X +16..+24, Z +14..−34; connects plaza (door at Z +10) to boulevard north end (door at Z −30). Lets players bypass the 78 m lane at the cost of a dark CQB run |

**Cross-cuts** (lane-to-lane connectors, one every 25–35 m of mission axis, per lane discipline):
- C1: quay → alley mouth at (−44, 0, +42) and quay → plaza ramp at (−10, 0, +42)
- C2: alley → arcade west door at (−40, 0, −2); arcade east doors → plaza at (−25, 0, −12) and (−25, 0, +2)
- C3: plaza → gallery door at (+16, 0, +10); plaza NE cut → boulevard at (+26, 0, −20)
- C4: gallery → boulevard at (+24, 0, −30); boulevard → customs yard mouths at (−4, 0, −40) (market street) and (+34, 0, −40) (boulevard)

### 2.4 POIs (named, referenced by spawns/beats/shots — IDs are the content keys)

| POI id | Name | Bounds / anchor | Role |
|---|---|---|---|
| `poi_dock` | Dockside Cut | Z +42..+54 quay | infil, tutorializes movement/ADS |
| `poi_alleys` | Tannery Alleys | X −60..−40 | CQB lane |
| `poi_arcade` | Pale Lantern Arcade | X −40..−25, Z −20..+6, 2 floors | **the accessible interior**; CINDERLOCK handoff room upstairs |
| `poi_plaza` | Meridian Market | X −25..+15, Z −18..+18 | main set-piece, hero screenshot space |
| `poi_gallery` | Storm Gallery | X +16..+24, Z +14..−34 | flank route |
| `poi_blvd` | Tramline Boulevard | X +28..+46, Z +40..−40 | the 60 m+ lane |
| `poi_platform` | Tram Platform | Z −40..−52, deck y +4.5 | **the overlook** (stairs at X +30, ramp at X +46); enemy marksman perch, then player overwatch option |
| `poi_customs` | Customs Yard / Gate 9 | X −18..+24, Z −40..−60 | exfil defense arena |

### 2.5 Verticality

- **Interior:** Pale Lantern Arcade — ground floor (shuttered shop stalls, 6–12 m sightlines) + upper floor at y +4.2 (balcony ring over a central lightwell; east windows overlook the plaza at 22–35 m — a mid-range perch that never sees the boulevard). Stairs at NW (−38, −16) and SE (−27, +4) corners — two entrances, no dead-end camping.
- **Overlook:** Tram Platform at y +4.5 — sees the full boulevard (78 m) and the customs yard mouths (~30 m), but NOT into the plaza (arcade block masks it). Two access points (stairs + ramp) per no-single-choke rule.
- Everything else is ground level ±0.4 m (curbs, quay steps). No ladders in v1 (animation cost).

### 2.6 Cover density rhythm

Pocket–corridor–pocket: combat pockets hold cover at 3–5 m spacing; connectors are deliberately sparse (risk in transit) —

| Space | Cover pieces | Spacing | Notes |
|---|---|---|---|
| Quay | 5 (crates, bollard cluster, van) | ~8 m | light — teach, don't fight |
| Alleys | 9 (dumpsters ×6, van, scaffold bays ×2) | 3–5 m per pocket, bare between dog-legs | |
| Plaza | 14 (cars ×6, kiosks ×5, planters ×3) | 4–6 m | densest; every kiosk waist-high plus awning = soft head cover |
| Market street | 4 (car ×2, barrier ×2) | ~10 m | thin on purpose — pre-gate sprint |
| Gallery | 5 (dumpsters ×2, shelving ×3) | 4 m | |
| Boulevard | 9 (cars ×7 at roadway EDGES only, planter ×2) | edges 6–8 m; **center lane clear** | the long lane stays honest |
| Customs yard | 18 (jersey ×12, sandbag emplacements ×6) | 3–4 m near gate, sparse at mouths | defense arena: strong at the gate, weak where waves enter |

### 2.7 Player path through the mission beats

`poi_dock` (spawn −38, 0, +50) → east along quay → C1 alley mouth → `poi_alleys` north through both dog-legs → C2 arcade west door *or* continue to plaza via alley exit at (−44, 0, −28) → `poi_plaza` (main fight) → `poi_arcade` upstairs (CINDERLOCK) → exit east doors → C3 gallery *or* NE cut → `poi_blvd` north (or `poi_gallery` flank) → optional `poi_platform` climb → yard mouths → `poi_customs` → hold → exfil gate (0, −58). Backtracking is never required; every beat's exit faces the next beat's entrance.

---

## 3. Lighting plan

### 3.1 Light budget (doctrine §3: visible-light COUNT is a shader-permutation key — fixed pool, allocated at boot, `visible:true, intensity 0` when parked, NEVER added/removed at runtime)

| Pool slot | Count | Type | Shadows |
|---|---|---|---|
| `moon` | 1 | DirectionalLight | **the only shadow caster**, 1024 map (doctrine cap) |
| `keySpots[0..7]` | 8 | SpotLight | none |
| `fx[0..3]` | 4 | PointLight | none — muzzle flashes ×2, explosion, scripted transformer arc |
| **Total** | **13** | | fixed for the whole session |

Everything else that *looks* like a light is **emissive material + additive glow sprite + baked ground-pool gradient decal** — zero shader permutations. The blackout set-piece (§6 beat 3) animates *intensities and emissive maps only*; the pool never changes size.

### 3.2 Key light

- **Moon/skyglow:** directional from azimuth 310° (NW), elevation 38°. Color `#5a6b8c` (~7500 K, storm-filtered), intensity low (≈0.25 of key). Its 1024 shadow is soft (PCF, radius 4) — it exists to ground props and give roofline silhouettes, not to draw crisp shadows.
- **Ambient/hemisphere:** sky `#1a2030` / ground `#0a0c10`, very low — the darkness floor. City skyglow tint `#2a2418` (sodium-polluted) mixed into the hemisphere ground term so up-facing surfaces stay cool and walls catch faint warmth.

### 3.3 Practicals map (every powered light source, with position + color temp)

**REAL lights (the 8 keySpots):**

| id | Position (x, y, z) | Aim | Type | Color temp / hex | Cone | Notes |
|---|---|---|---|---|---|---|
| `L_QUAY` | (−30, 6.5, +47) | straight down | sodium | 2200 K `#ff9a3c` | 55° | infil key; god-ray cone |
| `L_ALLEY_A` | (−52, 5.5, +24) | down, 10° S | sodium wall bracket | 2200 K `#ff9a3c` | 60° | lights first dog-leg; steam vent sits in its beam |
| `L_PLAZA_KEY` | (−5, 9.0, 0) | straight down | aggregate "neon bounce" | `#c86ee0` magenta-white | 85° wide | ONE real light standing in for the sum of all plaza signage; dies in the blackout, relights at 40 % cyan `#4adcd6` |
| `L_ARCADE_SKY` | (−32, 7.8, −8) | straight down | cool shaft | 7500 K `#7c8fb8` | 35° tight | skylight shaft to arcade lightwell floor; god-ray home |
| `L_BLVD_1` | (+36, 7.0, +20) | down | sodium | 2200 K `#ff9a3c` | 50° | boulevard pool 1 |
| `L_BLVD_3` | (+36, 7.0, −28) | down | sodium | 2200 K `#ff9a3c` | 50° | boulevard pool 3 (pool 2 at Z −4 is FAKE: emissive head + cone card + ground decal — interleaving real/fake pools is invisible at night and saves a slot) |
| `L_FLOOD_W` | (−14, 9.0, −44) | aimed S, 25° down | metal-halide flood | 5600 K `#dce8ff` | 40° | customs; backlights incoming waves |
| `L_FLOOD_E` | (+18, 9.0, −44) | aimed S, 25° down | metal-halide flood | 5600 K `#dce8ff` | 40° | customs |

**FAKE practicals (emissive + glow sprite + pool decal; zero real lights):** all remaining sodium street heads (quay ×2, alley second dog-leg, market street ×3, boulevard pool 2), every neon sign (plaza east wall: 5 signs — invented brands, e.g. "ЗАРОВ НОЧЬ" club sign magenta `#e83ea8`, "MERIDIAN 24" cyan `#38d8d0`, noodle-stall red `#ff4040`, pharmacy-cross green `#3cff88`, pawnshop amber `#ffb340`), ~18 lit windows (2700–3000 K `#ffc88a`, random on/off mask), kiosk string bulbs (2400 K), tram-platform fluorescent strip (4000 K `#cfe0d8`, flickers), gatehouse interior (3000 K), car headlight pair on the abandoned boulevard car (Z +8, aimed into rain — pure glow cards).

### 3.4 Zone contrast plan (exposure rhythm along the mission axis)

Dark → warm pocket → FLOOD → dark → rhythmic pools → warm interior → harsh white. Relative scene brightness targets (plaza pre-blackout = 100 %):

| Zone | Level | Palette |
|---|---|---|
| Dockside Cut | 6 % | cool moon + one sodium pool |
| Tannery Alleys | 12 % pockets / 3 % gaps | sodium orange vs blue-black; the dog-legs are the dark beats |
| Meridian Market | **100 %**, post-blackout 35 % | magenta/cyan neon over wet asphalt — the money zone |
| Storm Gallery | 8 % | near-dark; muzzle flashes carry it |
| Tramline Boulevard | 10–40 % rhythmic | sodium pool / dark / pool / dark — silhouettes at range |
| Arcade interior | 25 % | warm tungsten stalls + one cool skylight shaft |
| Customs Yard | 80 % | harsh 5600 K floods, hard rain streaks in beams |

### 3.5 God-ray shafts (volumetric fakes — additive cone meshes with radial-falloff texture, camera-angle fade, NO real volumetrics)

Exactly five, each with a purpose: `L_QUAY` (infil establishing), `L_ALLEY_A` (steam vent inside the cone — shot S2), `L_ARCADE_SKY` (the interior beauty shaft — shot S4), `L_FLOOD_W` + `L_FLOOD_E` (rain-filled defense beams — shot S6). Cone cards double-faded: by view angle (avoid edge-on billboard reveal) and by camera distance <2 m (avoid clipping through).

---

## 4. Prop dressing plan

### 4.1 Ground-contact rules (critic hard-fail prevention — these are BUILD-TIME gates, not hopes; doctrine §4 referential integrity + §5 probes)

1. **Every prop Y comes from a raycast** against the ground mesh at placement time, then sinks **1.5 cm** into the surface. No hand-typed Y values.
2. **Build probe `probe_prop_contact.mjs`:** for every placed prop, raycast down from all 4 bottom-AABB corners; **gap > 0 mm or penetration > 3 cm = gate FAIL** (floating/clipping is an instant critic fail — make it an instant build fail first).
3. **Base decals mandatory** on every prop with footprint > 0.3 m²: AO blob + grime ring for cars/dumpsters/kiosks/planters; edge-wear chip decal at jersey-barrier bases; rust-drip streak under every pole bracket and AC unit. Decals are one atlas, one material.
4. **Slope rule:** nothing placed on slope > 8° unless shimmed by a visible wedge prop; wheeled props align to surface normal (wheels touch, body tilts).
5. **Wall-mounted props** (signs, brackets, AC units) get a mount plate flush to the wall — no cantilevered geometry floating 5 cm off a facade.

### 4.2 Per-zone dressing with density counts

| Zone | Props (count) | Puddles | Overhead |
|---|---|---|---|
| **Dockside Cut** | shipping crates ×6, bollards ×8, coiled rope ×3, delivery van ×1, pallet stacks ×4, chain-link gate ×1 | quay-edge sheet 10 × 2 m + 3 small | crane silhouette (skybox layer), one catenary cable quay-to-warehouse with 2 hanging lamps (dead) |
| **Tannery Alleys** | dumpsters ×6, scaffold bays ×2 (with tarps), abandoned van ×1, trash bags ×8 clusters, cardboard stacks ×5, AC units ×6 (wall), fire-escape fragment ×1 (non-climbable, above head height), **steam vents ×2** (at (−52, 0, +20) inside `L_ALLEY_A` beam; at (−46, 0, −14)) | 8 small (0.5–1.5 m, at downspout bases and dumpster corners) | laundry lines ×2 + power cable runs ×4 with sag (catenary curve, 3-segment) |
| **Pale Lantern Arcade** | shop stalls ×8 (shuttered ×5, dressed ×3: fabric bolts, electronics, produce), central kiosk ×1, balcony railing run, ceiling fans ×3 (one turning slowly), stacked chairs ×4, **handoff table upstairs** (CINDERLOCK case) | 1 — rain through the broken skylight pane pools on the lightwell floor (2 m, under the god-ray) | lightwell string bulbs ×2 runs (dead), hanging shop signs ×6 |
| **Meridian Market** | parked cars ×6 (two with alarm-blink emissive dot), market kiosks ×5 (awnings, string bulbs), planters ×3, newspaper boxes ×4, phone booth ×1, trash bags ×6, scattered-paper decal patches ×10, **steam manhole ×1** at (+2, 0, +12), transformer pole at (+14, 6, −6) (blackout set-piece source) | **hero puddle group: 3 puddles 4–7 m across at plaza center (−8..+8, +2..+14)** — the planar-reflection zone (§5.3); 6 satellite puddles at curb drains | **6 catenary spans** wall-to-wall with hanging lamps (2 lit fake, 4 dead) — the signature look-up shot; sign cables ×4 |
| **Storm Gallery** | steel shelving ×3, dumpsters ×2, mop bucket ×1, breaker boxes ×3 (wall), **steam vent ×1** at (+20, 0, −10) | 2 (roof leaks: drip particle column into each) | conduit runs + one flickering fluorescent stub (emissive flicker, fake) |
| **Tramline Boulevard** | parked cars ×7 (edges only — center lane stays clear), tram shelter ×1 (Z −2, east side), planters ×2, bus-stop bench ×1, newspaper drift decals ×8, tram tracks inset in asphalt (geometry strip + spec mask) | continuous gutter strips 0.5 m wide both edges (full length); 4 crown puddles in track ruts | **tram catenary wires ×2 continuous runs full length** (converge to vanishing point — critical for shot S5), support gantries every 20 m ×4 |
| **Tram Platform** | benches ×2, ticket machine ×1, route-map board ×1, trash bin ×2, sandbag nest ×1 (marksman position, added by fiction: Vektor emplacement) | deck sheet-wetness only (no deep puddles — it drains) | platform canopy over half the deck |
| **Customs Yard** | jersey barriers ×12, sandbag emplacements ×6, cargo trucks ×2, guard hut ×1, flood towers ×2, chain-link + gate ×1 (exfil), fuel drums ×4 (grouped, explodable — uses `fx` pool light), pallet stacks ×3, **steam vent ×1** at (−6, 0, −46) | 5 medium in wheel ruts | gate gantry + camera posts ×2 |

**Totals for sanity:** cars/vans/trucks 17, dumpsters 8, kiosks/stalls 14, jersey barriers 12, steam vents 5, catenary/cable spans 19, puddle features ~30. Prop meshes come from the procedural-props track *behind the visual-quality gate* (doctrine §7 — procedural allowed for props/architecture, never hero assets; characters/weapons are Meshy/staged per the weapons designer's track).

---

## 5. Skybox / weather

### 5.1 Layered night sky

1. **Dome gradient** (innermost shading, fragment or big-triangle dome): zenith `#05070d` → mid `#0d1220` → horizon `#232a3a` with a sodium-pollution band `#3a2f1e` blended in the S/SE horizon quadrant (toward the port — fiction-consistent). No stars above the storm (clean, and saves a texture).
2. **Cloud layer:** inner dome shell with a tiling broken-cloud alpha texture, scrolling wind-driven at ~0.004 uv/s from the west; underlit by the city (emissive tint `#1c1a22`, brighter near horizon). Two shells at slightly different radii/speeds give cheap parallax depth.
3. **Distant city silhouette parallax:** 3 billboard rings at radii **300 m / 600 m / 1000 m** — flat black building-cutout strips with emissive window-dot texture (density falls with distance), plus landmark silhouettes: 2 container cranes + freighter (S horizon, over the canal — the fiction's ship), a TV tower (NW), mid-rise blocks elsewhere. Rings sit at finite distances so camera translation produces true parallax; height fog blends their bases so they never hard-edge against the dome. Aviation-warning red blink dots ×3 on the cranes/tower (slow 2 s pulse, emissive only).

### 5.2 Fog (the depth-layering armature)

Exponential height fog, driftwake convention (`fogDensity` + `fogHeightFalloff` + `fogStart`):
- `fogDensity 0.010` /m, `fogHeightFalloff 0.06` /m (haze hugs the street), `fogStart 18` m, fog color = horizon color `#232a3a` warmed toward `#2e2a26` when looking S/SE (sodium skyglow direction).
- **Readability check (design constraint, verify in-engine):** at 78 m (boulevard lane) transmittance ≈ e^−0.78 ≈ 0.46 — targets stay readable as backlit silhouettes against sodium pool 3 and the platform fluorescent. If playtest says the marksman duel reads muddy, drop density toward 0.008 before touching lights.
- Every sodium pool gets a faint fog-disc card (additive, 15 % opacity) so pools "glow into" the haze — depth cue at zero cost.

### 5.3 Rain system spec

- **Streak layer:** instanced quads, **2,800 instances** in a camera-following box 24 × 16 × 24 m (respawn at top on exit). Velocity 9–13 m/s down + 1.2 m/s west wind shear; quad stretched along velocity 0.4–0.7 m; soft vertical-gradient alpha; NormalBlending at low opacity (additive washes out against neon), but instances inside a practical's cone get a brightness boost via a per-instance light-proximity factor (cheap: distance to the 3 nearest key-spot positions, computed on spawn).
- **Splash layer:** pool of **220** ring-billboard sprites cycling on ground points within 12 m of the camera, biased 3:1 toward puddle masks; 3-frame ring flipbook, 0.25 s life.
- **Drip columns:** 6 placed emitters (gallery leaks ×2, arcade skylight ×1, awning edges ×3) — thin repeating streak + splash at base.
- **Occlusion volumes:** rain must NOT fall indoors. 4 AABB exclusion volumes: arcade (both floors), gallery, gatehouse, tram-shelter canopy. Spawn test is a box check, not a raycast. **Build probe:** camera placed inside each volume for 120 frames → zero streak instances render inside (screenshot-diff or instance-position assert).
- **Audio hook (for the audio track):** exterior rain loop crossfades to interior muffle + roof-patter inside the four volumes.

### 5.4 Wetness material response

- **Global wet pass at material setup (not per-frame):** all up-facing exterior surfaces get roughness pulled down (asphalt 0.85 → 0.35, concrete → 0.45, metal → 0.25) and albedo darkened ×0.7 (wet-darkening). Walls get a subtle streak overlay only below 1 m (splash zone) — vertical surfaces don't mirror.
- **Puddle areas:** puddle mask in vertex color (or a dedicated ground-atlas channel): mask interior = roughness 0.05, animated ripple normal (two scrolling normal maps, counter-phase, ~0.8 Hz — rain-agitated, not pond-calm), metalness 0, envMap intensity high.
- **Planar reflection — plaza hero puddles ONLY:** one mirrored render of the plaza set (neon wall, kiosks, characters) into a **512 px render target, updated every 2nd frame, plaza-scoped layer mask** (skybox + neon wall + chars + kiosks only; ~40 draws). Blend into the 3 hero puddles by mask, distorted by the ripple normal. Everything outside the plaza uses the static night envMap (cube, baked once at load from plaza center — also the source for car/window glints). This is the single most AAA-selling pixel investment on the map and it is budgeted: one extra 512 pass at 30 Hz.
  - **Perf guard (adoption plan p99 doctrine):** the planar pass toggles off automatically if the dynamic-resolution scaler is already at floor; puddles fall back to envMap — verify no visible pop (envMap is the same scene, blurrier).
- **Rain-streak refraction on glass:** kiosk/arcade windows get a static droplet normal texture + slow drip scroll — fake, cheap, sells everywhere it's seen.
- **Character wetness (note to character track):** rim-spec boost + roughness 0.35 on shoulders/helmets of all bodies (after the doctrine §1 Meshy material repair — metalness 0, roughness base 0.78, emissive off — the wet override applies on top, shoulders/head only).

---

## 6. Mission beats (v1, 10–15 min target: ~12–14 min)

**Spawn referential integrity (doctrine §4 + adoption plan contract-gate item):** every beat below references spawn IDs defined in `content.json` → `spawns[]`; the contract gate must verify every `beat.spawnRefs[*]` resolves to a defined spawn AND every defined spawn sits inside the nav-walkable bound of its POI. A dangling ref is a **build failure**, not a silent no-spawn (the Colosseum empty-bout class).

**Bot caps:** max **8 simultaneous** live bots (skinned Meshy bodies, Draco+WebP per doctrine — no impostors needed at this cap); per-beat totals below are cumulative through waves. AI uses the adopted fairness constants: 300–800 ms LOS-to-first-shot delay, ~0.018 rad aim jitter, ≤2 simultaneous attack tokens, muzzle-block raycast (never fire through cover).

| # | Beat (set-piece name) | Time | POI | What happens | Spawns (id @ pos) |
|---|---|---|---|---|---|
| 1 | **WET INSERTION** | 0:00–1:30 | `poi_dock` | Player exits canal skiff at (−38, 0, +50). Radio VO establishes CINDERLOCK + the dawn deadline. Two quay patrol bots walk a scripted loop; first contact teaches ADS + cover. | `sp_dock_1` @ (−18, 0, +48), `sp_dock_2` @ (+2, 0, +46) |
| 2 | **ALLEY SWEEP** | 1:30–3:30 | `poi_alleys` | Checkpoint team holds the dog-legs; CQB through steam and sodium pockets. 5 bots: 2 fwd, 3 reinforce from the north dog-leg on first shot. | `sp_alley_1` @ (−50, 0, +26), `sp_alley_2` @ (−54, 0, +14), `sp_alley_3..5` @ (−46, 0, −2) / (−52, 0, −10) / (−44, 0, −20) |
| 3 | **MARKET BLACKOUT** | 3:30–6:30 | `poi_plaza` | The showcase. Wave A (5 bots) fights across the kiosk field under full neon. At wave A ≤ 2 alive, the transformer at (+14, 6, −6) blows (fx-pool arc light + sparks + thump): `L_PLAZA_KEY` and all neon emissives die over 0.4 s → 2 s of moon-and-muzzle darkness → emergency circuit relights at 35 % cyan. Wave B (4 bots) pushes in the dark. **Lighting is animated intensity/emissive-swap ONLY — the pool never resizes (doctrine §3).** | wave A `sp_plaza_a1..a5` @ (−2, 0, −14) / (+8, 0, −8) / (−14, 0, −6) / (+12, 0, +4) / (−8, 0, −16); wave B `sp_plaza_b1..b4` @ (−12, 0, −38) / (−4, 0, −40) / (+18, 0, +12·gallery door) / (−25, 0, −12·arcade east door) |
| 4 | **THE HANDOFF** | 6:30–8:30 | `poi_arcade` | Interior CQB: 4 bots hold the ground-floor stalls and balcony. CINDERLOCK case on the handoff table upstairs (−34, 4.2, −12); pickup triggers beat 5 radio + spawns nothing (no pickup-ambush cliché; pressure comes NEXT beat). | `sp_arc_1` @ (−36, 0, −4), `sp_arc_2` @ (−29, 0, −14), `sp_arc_3` @ (−38, 4.2, −14), `sp_arc_4` @ (−28, 4.2, +2) |
| 5 | **LONG RAIN** | 8:30–11:00 | `poi_blvd` / `poi_platform` | Exiting the arcade, a marksman on the tram platform owns the boulevard center lane (scope glint + tracer discipline; fires on the fairness constants, no insta-beam). 5 bots leapfrog car-to-car up the edges. Player choices: duel long from the barricade line, push the edges, or flank via `poi_gallery`. Platform is player-ownable afterward (overwatch into beat 6's yard mouths — reward for clearing it). | `sp_marks_1` @ (+38, 4.5, −46·platform nest), `sp_blvd_1..5` @ (+30, 0, −2) / (+44, 0, −6) / (+30, 0, −18) / (+44, 0, −24) / (+36, 0, −34) |
| 6 | **HOLD GATE 9** | 11:00–14:00 | `poi_customs` | Exfil defense at the gate. 3 waves from the two yard mouths (market street + boulevard): 5 / 6 / 7 bots (cap 8 live). Wave 3 includes 2 heavies (armored Meshy variant). Fuel-drum group is the player's set-piece tool (fx-pool explosion light). Extraction truck arrives at 14:00 through Gate 9 → mission end screen. Timer + waves end deterministically (doctrine: every engagement ends; no referee needed — the truck IS the clock). | wave 1 `sp_cust_w1_1..5` @ mouth spread (−8..0, 0, −40); wave 2 `sp_cust_w2_1..6` @ (+30..+38, 0, −40); wave 3 `sp_cust_w3_1..7` @ both mouths + `sp_cust_heavy_1..2` @ (−4, 0, −40) / (+34, 0, −40) |

Bot total across the mission: 2+5+9+4+6+18 = **44** engaged, ≤ 8 alive at once. Failure = respawn at beat checkpoint (each beat start is a checkpoint; doctrine §6 shell: ESC pauses, never destroys; forfeit routes through the loss path).

---

## 7. IP hygiene rules (bind the art pass)

- No CoD names/logos/UI likenesses; no real-world brand marks on signage — invented brands only (§3.3 list is the canon set; extend in `content.json` `signage[]`).
- No real city/street names; Zarov fiction only. No real military unit insignia; Vektor Ancile patch + RAVEN element tag are original marks.
- Weapon names are original designations (weapons track owns them) — never manufacturer trade names.

---

## 8. SHOT BATTERY — six critic framings

Marketing-screenshot framings, chosen the way a AAA publisher shoots a vertical slice: one establishing, one hero, two mood/CQB, one scale, one action-defense. Camera spec: `pos` + `lookAt` in map coordinates, FOV in degrees vertical, **time = mission clock** (drives which set-piece state is live). Integration per doctrine §5: framings live in `content.json` → `shots[]` (contract-gate-validated), driven via `window.__FFG3D__.__test.placeShot(name)` + `/__shot/` render-target POST so a hidden tab still produces pixels; the blind A/B harness (shared-global battery) consumes the same table.

| # | Scenario name | Time | Camera pos | lookAt | FOV | Must be in frame | Critic pass hints |
|---|---|---|---|---|---|---|---|
| S1 | `dock_infil_skyline` | 0:05 | (−38, 1.7, +50) | (−10, 6, +90) | 58 | canal water, freighter + crane silhouettes on the S horizon ring, `L_QUAY` god-ray right of frame, rain streaks against the glow | horizon layers separate by fog depth; water gets skyglow spec; no hard skybox seam |
| S2 | `alley_steam_cqb` | 2:10 | (−52, 1.6, +30) | (−52, 1.4, +14) | 50 | steam vent plume backlit inside `L_ALLEY_A` sodium cone, one bot silhouette at ~11 m, dumpster + scaffold flanks, wet ground bounce | steam is volumetric-bright where the beam crosses it; silhouette readable; puddle mirrors the sodium head |
| S3 | `market_neon_rain` **(hero)** | 4:10 | (−22, 1.5, +14) | (+10, 5, −10) | 55 | full pre-blackout neon wall (all 5 signs), hero puddle group bottom-third with **planar reflections of the signs**, ≥2 bots in the kiosk field, muzzle flash live (fx pool), catenary lamps overhead, rain visible against neon | reflection tracks the neon wall; bloom blooms signs not the whole frame; kiosk awnings drip; nothing floats |
| S4 | `arcade_god_rays` | 7:00 | (−36, 5.2, +2) | (−31.5, 0.5, −9) | 60 | upper-balcony view down the lightwell: `L_ARCADE_SKY` shaft hitting the wet floor pool, drip column sparkling in the beam, shuttered stalls in warm dark, CINDERLOCK table edge-lit at frame left | single-shaft chiaroscuro; interior has ZERO rain streaks (occlusion volume proof); balcony rail leads the eye |
| S5 | `boulevard_long_rain` | 9:00 | (+37, 1.8, +36) | (+37, 4.5, −44) | 48 | the full 78 m lane: sodium pools 1-2-3 receding into fog, tram wires converging to vanishing point, platform fluorescent + marksman glint at far end, car-edge cover flanks, gutter reflections running the full depth | pool/dark rhythm legible to ≥3 pools; far platform readable through fog (§5.2 transmittance check); wires unbroken catenaries |
| S6 | `gate9_floodlight_stand` | 12:30 | (0, 1.5, −52) | (+6, 2.5, −38) | 55 | from behind sandbags: both flood god-ray beams full of rain, wave-3 bots (incl. 1 heavy) entering the mouths backlit, jersey-barrier field, fuel drums frame-right, gate gantry shadow across foreground | rim-lit silhouettes against 5600 K; beams read volumetric; sandbag contact decals visible in the harsh light |

Battery rules: all six shots at DPR 1.5, post chain on (AgX/ACES + bloom), captured after `compileAsync` pre-warm (adoption item — no first-effect hitch pollutes the capture), fixed seed for bot poses/rain phase so A/B runs are comparable (doctrine §4 determinism).

---

## 9. Open handoffs to sibling tracks

- **Geometry/blockout track:** §2 coordinates are the contract; nav bake must cover every spawn in §6 (gate-checked).
- **Weapons track:** sightline bands (§2.3) assume SMG/shotgun (west), AR (center), DMR (east) effectiveness envelopes — confirm ballistics match 14 / 40 / 78 m bands.
- **Character track:** wet-shoulder override (§5.4) on top of doctrine §1 Meshy repair; heavy variant needed for beat 6.
- **Audio track:** rain interior/exterior crossfade volumes (§5.3), transformer thump (beat 3), tram-wire hum on the boulevard.
- **Perf gate:** the planar-reflection pass (§5.3) and 2,800-instance rain are the two named perf risks — both have specified degradation paths; p99 + hitch attribution per adoption plan is the verdict, not average FPS.
