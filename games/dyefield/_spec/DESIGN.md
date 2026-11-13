# DYEFIELD — design lock

## 1. Original IP lock (five lines)

1. **DYEFIELD** is a seaside turf-paint league, the **HARBOR CUP**. Two crews stain an arena, and the floor is the scoreboard.
2. **TIDE-RUNNERS** are kid-scale coastal athletes: big head, short body, sport shorts, tank top, sneakers and a swept **hair-crest** that takes their crew's color. In their own dye they **slick down**. The body sinks flush with the surface and only the crest cuts through it like a fin, trailing a wake.
3. Crews: **SUNCREW** (amber-orange, mark = sun-disc ◉) vs **GULF CREW** (violet-blue, mark = wave-peak ▲). Every team mark is a *shape* plus a color, so it reads in colorblind modes.
4. Kits: **MIST-RASP** shooter · **SHEET-DRUM** roller · **NEEDLE-GLINT** charger · **POP-WELL** blaster. Sub: **JELLY CHARGE**. Specials: **CLOUDBURST**, **WELLSPRING**.
5. Arenas: **PIER 18 PLAZA** · **LOCKWELL WORKS** · **CINDER REEF**. The only in-world signage is **HARBOR CUP** and **TIDE CO.**

UI copy is fixed to exactly these strings (from the brief): wordmark `DYEFIELD` · mode line
`Harbor Cup • 4 v 4` · loadout hint `Pick your kit — crest sits on the right` · low tank
`Tank low — hold SHIFT on your color to drink` · death slate `WASHED BY {name}` · kill feed
`{A} washed {B}` · victory `THE HARBOR CHOSE A COLOR.` · credits `An original 4 v 4 turf-paint shooter.`
Menu labels PLAY / LOADOUT / SETTINGS / HOW TO PLAY / CREDITS come from the brief's success
criteria.

## 2. How the source clip was used (and not)

The clip (https://x.com/JaydenDavisNC/status/2102828630615421223, 59.3 s, 1920×1080) was watched
in the browser. 40 stills were pulled at 1.5 s intervals with ffmpeg, **into a scratch folder
only**. No frame, name or asset from it is in this repository.

**Ground truth taken (systems and feel):**

| aspect | what the frames show | what DYEFIELD does |
|---|---|---|
| camera | Hero stands ~62–70 % down the frame, about horizontally centered, and fills ~12–15 % of frame height. Pitch ≈ 15–20° down at rest. Wide FOV. | follow cam: pivot 1.35 m, distance 4.3 m, **shoulder offset 0.42 m right** (the brief asks for it; the clip barely has one), vertical FOV 68°, rest pitch −14°, pitch range −65°…+40°; swim tucks the pivot to 0.8 m and pulls in to 3.8 m |
| lobby | menu stack on the left over a live 3D plaza; profile card top-right; current-loadout card bottom-right; key-hint pills bottom-right | same *structure* with our own layout, over a live Pier 18 at noon |
| paint on surfaces | glossy dye with soft raised edges and droplet flecks; dye shows on tiles, ramps and walls; walls take long vertical streaks | a glossy, height-bumped dye shader, sampled per texel from the shared atlas; enemy dye is matte and sticky |
| swim | the runner becomes a small silhouette inside their own color | **slick-down**: body sinks, the crest-fin and a wake ride the surface (not a squid or octopus) |
| HUD rhythm | top-center timer pill between 4 + 4 team crests (downed = ✕ plus a respawn count); special gauge top-right; minimap bottom-left; center reticle with a small vertical tank pipette beside it; kill feed top-right; "low tank" toast bottom-center | same *rhythm*: our crest shapes (◉ / ▲), a TANK pipette, the CLOUDBURST/WELLSPRING gauge, our strings only |
| respawn | dark slate with a big splat and the killer's name, 4→1 countdown ring, then a beam drop onto the pad | `WASHED BY {name}` slate, **3 s** (per brief), then a tide-spout drop onto the team pad |
| stage select | two cards, each with a time-of-day chip; bot skill in 3 tiers; match length 90 s / 3 min | map select across **three different arenas** plus Random; bot skill tiers; 3:00 default |
| loadout | 4 weapon tiles, a stat-bar card, sub + special cards, a live mannequin on a painted disk | same structure with our 5 stat bars (Range / Damage / Fire rate / Mobility / Coverage) |
| pause | PAUSED / RESUME / SETTINGS / HOW TO PLAY / QUIT MATCH, with a control legend | same, plus key remap and colorblind marks |
| lighting | sunset harbor, low sun glare, water horizon, crates and ramps with yellow hazard edges | Pier 18 at noon in the lobby, golden hour optional in match; each map owns its own sky |

**Not taken:** the title lockup and lettering, every weapon, sub and special name, the species,
the squid crest icons, the sponsor signage and headlines, the "splatted" wording, and the
one-wharf map. The clip shows one map with day and dusk variants. DYEFIELD ships three maps with
different movement grammar.

## 3. The three arenas (text thumbnails)

### PIER 18 PLAZA — open coastal sports court (≈ 56 × 84 m, 180° point-symmetric)
```
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~  open sea (out of bounds)  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
   ┌──────────────────── GULF BASE DECK  +1.2 m   ▲ pad ─────────────────────┐
   │   ▣▣        ramp ╲______________________________╱ ramp         ▣▣       │
   │ ┌─────────────┐                                     ┌─────────────┐     │
 ~ │ │  WEST DECK  │  ═══ chevron wall      chevron wall ═══ │  EAST DECK  │  ~ │
 ~ │ │   +2.0 m    │ ramp          ▣                     ramp │   +2.0 m    │  ~ │
   │ │ low crates  │           ╭──────────────╮               │ low crates  │   │
   │ │  sightline  │   ▣       │ BUOY BLOCK   │       ▣       │  sightline  │   │
   │ │  down court │           │   +1.4 m     │               │  down court │   │
   │ │             │ ramp      ╰──────────────╯          ramp │             │   │
 ~ │ └─────────────┘  ═══ chevron wall      chevron wall ═══ └─────────────┘  ~ │
   │   ▣▣        ramp ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲ ramp         ▣▣       │
   └──────────────────── SUNCREW BASE DECK  +1.2 m   ◉ pad ──────────────────┘
```
What makes it unique: a single wide tile plate with **long sightlines**. Low cover only
(crates ≤ 1 m, chevron walls 1.1 m). The two long side decks give height without breaking lines
of sight, so mid-paint wars decide it. The water all round is instant out-of-bounds, which
punishes greedy flanks. It favors the roller (wide flat floor) and the shooter (constant mid
range). It also hosts the 3D lobby.

### LOCKWELL WORKS — vertical industrial interior (three floors)
```
 FLOOR 3  y+9.0  CRANE-WALK  ═╪═╪═ grated catwalk (dye falls through; unpaintable) ═╪═╪═
                 ▓ charger nest on the crane cab ▓ — reached by stairs OR by slicking up a dyed wall
 FLOOR 2  y+4.5  MEZZANINE   offices │ walkways │ loading dock lip │ paintable walls = shortcuts ↑
 FLOOR 1  y 0.0  PRESS HALL  ⇉⇉ conveyor ramps carry you uphill ⇉⇉ │ stairwells ╱╲ │ crate stacks
 no ocean horizon: cool strip lights, sodium practicals, rain-streaked skylights
```
What makes it unique: **height is the map**. Stairwells are slow. A wall dyed in your color is a
fast lane you can slick straight up, so painting a wall is a route decision, not decoration.
Close quarters and a tight FOV favor the POP-WELL blaster's bursts. The crane-walk nest gives the
NEEDLE-GLINT one long lane down the hall. It must feel like a different sport from Pier 18.

### CINDER REEF — broken atoll, land–water risk crossings
```
   SUNCREW BEACH ◉      shallow sandbar (paintable, swim-able)      GULF CREW BEACH ▲
   ░░░░ wet sand ░░░░ ≈≈≈≈≈≈ DEEP CHANNEL (unpaintable, instant wash) ≈≈≈≈≈ ░░░ wet sand ░░
        │  WEST ISLE (basalt shelves)    ⌒ tide-spring jump ⌒     EAST ISLE (basalt)  │
        └── plank bridge ──┐        ╔════ MID ISLE ════╗        ┌── plank bridge ──┘
                           └──────▶ ║  rusted wreck hull║ ◀─────┘
                                    ║  high ground, risky║
   ≈ light mist beyond ~25 m hides swimmers ≈   ground: wet sand · rock · wreck metal — no tiles
```
What makes it unique: **rotation tax**. You cross deep channels only on bridges, sandbars or
tide-spring jumps. Each is a predictable, exposed lane that a charger can hold from a beach.
Mid Isle is high ground you have to *walk* onto, and light mist hides slicked swimmers at range.

## 4. Coverage + swim plan (in Three.js + a THREE-free TS sim)

**One paint atlas is the source of truth.** Every paintable surface on a map (floors, ramps,
walls, crate tops) shares one non-overlapping **UV2 atlas**, authored in Blender. At load, the
sim rasterizes every paintable triangle into that atlas on the CPU. Each covered texel gets its
world position, its normal, the world area it stands for, and a scoring weight. Texels go into a
1 m spatial hash. The texel's team byte is the only paint state in the game:

- **Painting** a splat (sphere or capsule) visits the hash cells it touches and flips texels
  inside the radius. A deterministic per-texel noise gives organic edges. A facing filter keeps
  a splat from painting through a thin wall. Weighted team totals update incrementally, O(1) per
  texel.
- **Coverage %** = Σ(area × weight) per team ÷ Σ(area × weight) over all paintable texels.
  Floors and ramps weigh **1.0**; walls weigh **0.35** (`data/maps.json → scoring.wallWeight`).
  Because it is area-weighted, uneven UV2 density can never bias the score.
- **Swim eligibility, slog penalty and refill** read the texel under the feet: the nearest
  floor texel within 0.35 m. Wall-slicking reads the texel at the wall contact point.
- **Minimap**: every floor texel also owns a minimap pixel (top-most height wins). A texel flip
  repaints its pixel, so the minimap is exact and costs nothing per frame.
- **GPU mirror**: an RGBA8 `DataTexture` of the same atlas. R = SUNCREW, G = GULF CREW,
  B = splat-detail noise, A = paintable. Only dirty rows upload each frame
  (`Texture.addUpdateRange` → `texSubImage2D`). Gutter texels mirror their nearest surface
  texel, so bilinear sampling never bleeds.
- **Shader**: bilinear-sampled dye plus noise gives a smooth organic edge. Friendly dye is glossy
  with a soft height bump from the atlas gradient; enemy dye is matte and sticky-looking.

Budget: Pier 18 at 10 texels/m is about 1 M texels, with typical splats of 300–1,500 texels.
Eight players painting at full rate is well under 1 ms per tick. A coverage query is two
additions.

**Movement states** (fixed 60 Hz sim, Rapier kinematic capsule):

| state | condition | rules |
|---|---|---|
| WALK | neutral floor | 5.2 m/s, jump 6.2 m/s, no refill |
| SLOG | enemy dye underfoot | 2.0 m/s, jump 3.8 m/s, no refill |
| SLICK (swim) | SHIFT held on **own** dye | 8.4 m/s, capsule shrinks to crest height, hidden except crest-fin and wake, **tank refills 36/s** (empty→full ≈ 2.8 s) |
| WALL-SLICK | SHIFT held + pushing into an own-dyed wall | climbs at 5.2 m/s, gravity off; pops onto the ledge at the top |
| AIR | not grounded | gravity 15 m/s², limited air control |

The tank runs 0–100. An empty primary dry-clicks and paints nothing. Neutral and enemy dye never
refill.

## 5. Kits (numbers live in `data/weapons.json`)

| kit | role | identity in one second |
|---|---|---|
| MIST-RASP | shooter | fast stream, mid range, high coverage, low burst |
| SHEET-DRUM | roller | wide floor coat while walking; flattens a foe it rolls over; a tap flicks a vertical column |
| NEEDLE-GLINT | charger | hold to charge, a visible glint line, release for a long splat line; the nest kit |
| POP-WELL | blaster | slow airborne bursts; a direct hit deletes; weak paint per shot |

Sub **JELLY CHARGE**: arc throw, about 70 % tank, lands as a jelly puddle that pops.
Specials charge from paint plus washes. **CLOUDBURST** is a thrown rain cell that soaks a disk of
turf. **WELLSPRING** is a jump-slam that paints a ring and knocks foes back.
