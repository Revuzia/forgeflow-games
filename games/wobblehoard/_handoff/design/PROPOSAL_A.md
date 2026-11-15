# PROPOSAL A: PLAYGROUND, toy first (cozy life)

Designer A, 2026-11-15. Angle: **the squishies feel alive in the first minute, and purpose grows out of caring for them.** Every moment
below comes out of what this code base is uniquely good at: squash, stretch, slosh, tack, plastic memory and pieces. Answers the eleven
questions of `DIRECTION.md` section 5 in order, inside D1 to D12. Paths are relative to `games/wobblehoard`.

**Read for this:** `STATUS.md`, `briefs/COMMON.md`, `briefs/SESSION3.md`, `design/DIRECTION.md`, the five maps in `_handoff/maps/`, `_spec/DESIGN.md`
1 to 7, `FUN.md`, `CUT.md`, `LOCK.md`, `UI.md`, `REFERENCES.md`, `CATALOG.md`, `SQUISHY_SCIENCE.md` 4, `src/contracts.ts`, `src/core/genome.ts`,
`rng.ts`, `settings.ts`, `src/shell/game.ts` 540-570, `mat.ts`, `cut.ts` 36-42, `src/ui/theme.ts`, `src/core/drops.ts` 112-149.
**Ran (light, scratch only):** (1) a name screen over every new name against the same lists `probe_catalog.ts` uses (equality, contains for 5+
letters, edit distance 1, plus a stricter per-word pass; it does NOT run the `spoken()` sound-alike rule or the language-safety gate); (2) the
trait formulas of 3.1 over the 50 species templates; (3) a check of the favourites table of 2.3 (counts per place, friend symmetry, cross-lane,
tier gap). Nothing else: no tsc needed (no code written), no browser, no build, no perf run. Every millisecond quoted is from a map; every prop,
hop and zone number is a design target to calibrate in the PHYS probes.

---

## 0. The first minute (why a child and an adult smile)

Today Dollop sits on the felt and waits for a finger. In PLAYGROUND, the moment you stop touching it, it **does something**:

1. **0:20, alone.** You let go. Dollop blinks, looks at the Felt Ball (its eyes turn first, then a lean), a tiny question bubble. It
   gathers itself (a squash), hops three wobbly hops, boops the ball, watches it roll, and its eyes curve happy. A coo: its own
   three-note call, the same tune every Dollop has, at its own pitch.
2. **1:30, a newcomer.** The first capsule opens and the new squishy stays out. Dollop turns, does a little hello hop, calls; the
   newcomer answers with the same rhythm turned upside down. Two voices, one tiny conversation, no words.
3. **4:10, the sea.** Dollop's thought bubble shows a wave. You say yes. At Fizzwash Cove it bounds into the Shallows; a water-filled
   Puddlo bobs in the surge, its liquid core sloshing a beat behind its skin; a marshmallow Wisplet floats like a cork, **soaks up
   the sea and sinks lower**. You squeeze Wisplet: **it squirts** a little arc of water at Puddlo, who blinks wide, then giggles.

More moments the systems below produce (each one names its mechanism):

| # | Moment | What makes it real |
|---|---|---|
| M1 | Boingle hops onto the Ice Pond and skates across with a squeak, bumps the Snowball, which rolls into a drift | ground mods mu x0.12, drag x0.25 (PHYS E2); firm silicone's own bounce; prop roll |
| M2 | Twangle tries the Sled Slope and sticks halfway, then peels down in little tugs, strings flashing | sticky's tack 0.9 / strings 0.85 against a tilted box prop; existing strand render |
| M3 | Kneadle shuffles through the Soft Drift leaving deep prints; Burrbin (its best friend) nuzzles it and leaves a **dotted print of its studs** that heals over 40 s | putty memStiff 5, healTau 40 s; studs are Burrbin's real silhouette |
| M4 | A marshmallow toasts golden on the fire side, then hops round to toast its other side | `uToast` look with a heat point; LIFE "turn" hop |
| M5 | The Tick Clock ticks with the music; everyone near it sways on the beat | music clock at 66 BPM; wiggle driver at 1.1 Hz |
| M6 | Three sleepy ones pile up on the Rug, eyes close, zzz; **the physics actually sleeps them**; one poke and they blink and shuffle | LIFE nap = physics sleep (E10) |
| M7 | Dollop cut into four: the chunks follow the face piece in tiny scoot hops like ducklings; when it sings, they hum along higher | flock brain, piece voices x popSize |
| M8 | A water-filled one on the Pine Swing: the swing goes left, the water inside goes right | slosh 0.45 @ 2.6 Hz against a pendulum prop |
| M9 | You toss Caromel onto the Puff Cushion: boing, it flies, lands dizzy (swirl), shakes itself, sparkles | carry and toss (built), spring prop, wiggle |
| M10 | Caromel bumps the Shake Pine; snow falls on Tadpolo, who gets a white cap, a wow, and wiggles half of it off | pendulum branch, `uSnow` look |
| M11 | Slime on the Warm Stone spreads flatter and leaves strings when it oozes away | slime gait (lean + glide), tack strands |
| M12 | A slow-rise Capnap sits in the Shallows, drinks the sea and settles to the sand; on the Sun Patch it dries and slowly rises again | soak state, density from soak, slow-rise air return 1.45 s |
| M13 | The Kettle sings; every squishy turns to look; the chatty ones answer it | gaze per body; call and response with an object |
| M14 | You drop Boingle on one end of the Driftwood Seesaw; Wisplet on the other end goes up and floats down soft as a feather | hinge prop impulse from the fall; marshmallow gait |
| M15 | A pull-lover shows a wish with two outward arrows; you stretch it; a big happy hop, a heart, and one more glow of warmth | wish W4 on the species' signature touch |

Purpose is the Journal (section 7): every one of these moments is something the Journal asks for, notices, or remembers.

---

## 1. The places

All four places share one rule: **flat ground at y = 0 under the whole play area** (PHYS E2 + E3, small), never a height field (E1, large, high
risk, `maps/PHYS.md:203`). Slopes are tilted box props; dunes, mountains and walls are backdrop only. Every place has a dry **pad** at its front
centre (ceremonies, capsule drop), at least 1.0 m from every prop, and 5 **spawn spots**. Colours are mixes of the existing tokens (`src/ui/theme.ts`
PALETTE: ink #14102a, plum #2a1744, dusk #5b3a86, felt #2a2150, amber #ffb347, lagoon #59d6e6, coral #ff5a4d, cream #fff1d6). No place is bright white:
the look is built on a dark backdrop (additive glows, `maps/RENDER.md:186-190`), so every place keeps its sky's upper half at dusk or deeper.

Coordinates: metres, x to the right, z toward the camera, y up. "Self" = what squishies do by themselves; "You" = what the player does.
Collider sizes are half-extents (hx, hy, hz) or radii. Every collider is at least 0.16 m thick (the detail-2 mean edge is 0.14 m: thinner props
tunnel between particles, `maps/PHYS.md:81-82`).

### 1.1 Home: "the Felt Nook"

**Look.** Today's dusk felt mat (`table.ts`), unchanged, plus a **Keepsake Shelf** backdrop (a plum wooden shelf behind the mat, 16 slots, section 7.6).
**Ground.** Felt: all ground modifiers 1. Bounds: the existing disc (R 3.5 m, corral as today). Pad (0, 0). Spawn: `matLayout(n)` as today.

| Thing | Collider and mechanism | You | Self |
|---|---|---|---|
| **Puff Cushion** (-1.7, -0.7) | box 0.45 x 0.12 x 0.45 on a vertical spring: 2.2 Hz, damping ratio 0.25, travel 0.10 m | tap it: it boings; drop a squishy on it: it bounces | bouncy ones hop on and bounce three times; cuddly ones sink into it and rest |
| **Music Box** (1.8, -1.0) | static box 0.25 x 0.18 x 0.18 | tap it: an 8-bar tune (once per 12 s) | chatty ones boop it to start it; everyone within 1.5 m sways and sings along (S05) |
| **Felt Ramp** (1.7, 0.7) | static box 0.6 x 0.08 x 0.3, pitched 15 degrees, top edge 0.28 m, with a step box 0.14 m behind its high end (two rises of 0.14 m) | carry a squishy to the top and let go | climbers (2.2) hop the step and slide down; slippery ones zoom, sticky ones creep |
| **Felt Ball** (-0.6, 0.9) | sphere r 0.18, rolling (vmax 2.5 m/s, rolling drag 0.6 /s, restitution 0.5) | flick it | bouncy ones boop it; two friends pass it back and forth (S11) |
| **Nap Patch** (-1.6, 0.9) | zone: circle r 0.7, a darker stitched felt; grip x1.15; nap spot (rest falls twice as fast) | carry a sleepy one there | sleepy ones go there to nap; three or more make a snuggle pile (S06) |

### 1.2 Fizzwash Cove (the beach)

**Look.** Late afternoon turning golden, no clock. Sky: dusk at the zenith lifted 20% toward lagoon, sinking to an amber horizon with a cream sun
disc low on the left; three soft noise clouds. Sea: lagoon at the shore deepening to felt far out, a cream foam line that fizzes on each wave.
Sand: cream 70% + amber 30%, shaded toward plum. Backdrop: low dune silhouettes and two leaning driftwood posts (plum), fogged to the horizon.
Weather: a few drifting sea-spray motes (additive, x0.3 Calm, none in reduced motion). Light: warm key (cream-amber) from the left front at 35
degrees elevation, lagoon rim from the sea, dusk fill.
**Ground.** Sand: mu x1.3, glue x1.1, peel x1.0, drag x1.05; footprints (marks 'sand', 48 on med, last 25 s). Bounds: rounded box hx 2.8, hz 1.8,
corner r 0.6. Pad (0, 0.5). Spawn (0, 0.2), (0.85, 0.15), (-0.85, 0.15), (0.5, 1.1), (-0.5, 1.1).

**Zones.** **Shallows**: water, x -2.8..2.8, z -1.8..-0.6, surface y 0.42, a surge current along z (period 7 s, 0.12 m/s peak, seeded phase): floaters
drift in and out. **Sun Patch**: warm and dry, circle r 0.8 at (-1.7, 1.0): dries wet x3, a sun bubble, basking.

| Thing | Collider and mechanism | You | Self |
|---|---|---|---|
| **Sunball** (-0.7, 0.8) | sphere r 0.22, rolling (vmax 3.0, drag 0.4 /s on sand, 0.9 in water, restitution 0.65); floats (density 0.2) | flick it | bouncy ones boop it, pairs pass it, a floater nudges it along the surf |
| **Bob Ring** (-0.8, -1.2) | ring of 8 capsules (tube r 0.08, ring r 0.42) on a float mechanism: bob 0.25 Hz x 0.03 m, vertical spring 1.5 Hz, damping 0.3, drift along x within +-0.4 m | tap it: it bobs toward the shore; drop a squishy into it | floaters hop in and ride; a water-filled one sits in the middle and sloshes |
| **Driftwood Seesaw** (1.7, 0.8) | box 0.8 x 0.08 x 0.22 on a hinge (axis z, pivot y 0.18), +-16 degrees, damping 1.2 /s | press one end; drop a squishy on an end | two take turns (duo, S08): one hops, the other goes up |
| **Dune Slide** (-2.1, -0.1) | static box 0.7 x 0.08 x 0.32 pitched 18 degrees down toward the sea, top 0.28 m, step box 0.14 m at the back | carry one to the top | climbers hop up and slide into the Shallows with a splash |
| **Shell Chimes** (2.3, -0.4) | two static post capsules r 0.08 and three hanging shell capsules r 0.08 between y 0.30 and 0.60 (static; they sway in the render from the contact impulse) | tap a shell: a note | curious ones boop the shells; singers sing the note back |

### 1.3 Flurrytop (the snowy mountain)

**Look.** Blue-hour morning with gentle snowfall. Sky: ink at the zenith to a lagoon-dusk horizon; a faint cream glow where the sun will rise.
Snow: cream 60% + lagoon 25% + dusk 15% (bluish, mid-luminance about 0.55, never white, so cream snowflakes read on it). Backdrop: layered
plum peaks and pine silhouettes fogged lagoon. Weather: snowflakes (normal-blend particles, 120 / 80 / 40 by tier, x0.3 Calm, none in reduced
motion); wind gusts streak them. Light: cool cream key from the front above, lagoon rim, dusk fill.
**Ground.** Packed snow: mu x0.75, glue x0.6, peel x1.0, drag x1.0; light prints (marks 'snow', 40 s). **Cold air** everywhere: frost builds
(look) at each family's rate (2.1), voices drop one semitone, and a shiver (the existing 17 Hz `tremble`, amp 0.3, 0.5 s) when frost crosses
0.5. **Wind gusts** every 25 to 45 s (seeded), 1.8 s, 0.5 m/s^2 along +x: only families with density under 0.6 drift. Bounds hx 2.8, hz 1.8.
Pad (0, 0.6). Spawn (0, 0.3), (0.85, 0.4), (-0.85, 0.4), (0.4, 1.2), (-0.4, 1.2).

**Zones.** **Ice Pond**: circle r 1.0 at (1.2, -0.4): mu x0.12, glue x0.2, peel x0.5, drag x0.25. **Soft Drift**: circle r 0.9 at (-1.5, 0.7):
mu x1.2, drag x1.6, deep prints (size x2, 60 s). **Warm Stone** heat: circle r 0.6 (below).

| Thing | Collider and mechanism | You | Self |
|---|---|---|---|
| **Sled Slope** (-1.9, -0.9) | static box 0.8 x 0.08 x 0.35 pitched 16 degrees down toward +x (toward the pond), top 0.28 m, step box 0.14 m | carry one to the top | climbers hop up and slide; slippery ones glide on across the Ice Pond |
| **Snowball** (0.2, 0.9) | sphere r 0.26, rolling (vmax 2.2, drag 0.5 on snow, 0.08 on ice, restitution 0.25) | flick it | bouncy ones push it; it rolls into a friend, who gets snowy (+0.3) |
| **Shake Pine** (-0.3, -1.5) | static trunk capsule r 0.12 (height 1.2 m) + a branch pendulum (capsule r 0.08, length 0.5 m, pivot y 0.95, +-20 degrees, damping 2 /s) | tap it: it shakes | a bump of 0.3 m/s or more on the trunk swings the branch: a snow puff falls on bodies within 0.7 m (snowy +0.5, a wow) |
| **Warm Stone** (2.1, 0.8) | static box 0.45 x 0.08 x 0.35 + a warm zone r 0.6 (frost -0.05 /s, snow -0.1 /s), steam wisps | carry a chilly one onto it | chilly ones walk to it and sit; slime oozes flatter on it (M11) |
| **Pine Swing** (0.3, -1.4) | seat box 0.32 x 0.08 x 0.22 on a pendulum (rope 0.9 m, pivot y 1.14, seat top 0.14 m), +-28 degrees, damping 0.25 /s; ropes are render only | drag the seat, or push the squishy on it | climbers hop on; a water-filled one sloshes against the swing (M8) |

### 1.4 Toastwood Cabin (the forest log cabin)

**Look.** Night, inside. Walls: plum logs with amber-deep (#e8862a) grain; floor: amber-deep darkened 55% in planks; a coral-and-dusk woven Rug;
a stone hearth with an amber and coral fire; a window at the back left: lagoon night with cream snowflakes falling outside, pines in plum.
Weather: embers (additive, 30 / 20 / 10, x0.3 Calm, none in reduced motion) rising from the fire. Light: amber lamp key from the front left,
coral hearth rim from the back, plum fill.
**Ground.** Wood: all modifiers 1, no marks. Bounds hx 2.6, hz 1.6. Pad (0, 0.7). Spawn (0, 0.4), (0.8, 0.5), (-0.8, 0.5), (0.4, 1.2), (-0.4, 1.2).

**Zones.** **Rug**: rounded box hx 1.1, hz 0.7 at (0, 0.4): grip x1.3, nap spot. **Fire Glow**: circle r 1.1 at (0, -1.0): warm (toast by family,
frost -0.08 /s, wet -0.05 /s), voices warmer (a lower formant).

| Thing | Collider and mechanism | You | Self |
|---|---|---|---|
| **Hearth** (0, -1.75) | static box 0.8 x 0.25 x 0.25 (the stone step); fire is render and audio | tap it: the fire grows for 3 s, crackles | foam and dough sit in the Fire Glow and toast; a marshmallow turns round halfway (M4) |
| **Rocker** (-1.7, -0.2) | seat box 0.45 x 0.08 x 0.35 on a hinge (axis x, pivot y 0.12), +-12 degrees, damping 0.8 /s, two seats | press it: it rocks | two rock together (duo); a sleepy one naps on it while it rocks slower and slower |
| **Kettle** (2.0, -1.2) | static sphere r 0.22 on a stove box 0.3 x 0.15 x 0.3 | tap it: it sings | it sings by itself every 30 to 50 s (seeded) with a steam puff (zone r 0.6 for 4 s, dewy look +0.2); chatty ones hum back (M13) |
| **Book Steps** (1.7, 0.2) | three static boxes 0.3 x 0.06 x 0.3, tops at 0.12 / 0.24 / 0.36 m, stepped back | carry one to the top | climbers hop up step by step to the top: a proud star (T4) |
| **Tick Clock** (-2.2, -1.3) | static tall box 0.25 x 0.7 x 0.15; the pendulum is render only; it ticks on every music beat (66 BPM) | tap it: it chimes the hour (one bell, in key) | everyone within 1.5 m sways on the beat (M5) |

---

## 2. "In their own way"

### 2.1 The family reaction data (`src/data/places.ts` `FAMILY_REACT: Record<MaterialFamilyId, FamilyReact>`)

New per-family numbers; `MATERIAL_FAMILIES` is not touched (`probe_materials.ts:34-37` locks its keys). **P** = physics (felt), **L** = look,
**S** = sound, **B** = behaviour (LIFE).

| family | density (P, water) | soak /s (L, B) | sand pick (L) | frost /s (L) | toast /s (L) | hop scale (P) | gait (P, B) | voice flavour (S) |
|---|---|---|---|---|---|---|---|---|
| slowrise | 0.35, soaked 0.95 | 0.50 | 0.4 | 0.008 | 0.03 | 0.5 | **sink**: long squash, small rise, 0.5 hops/s | foam (breathy) |
| marshmallow | 0.30, soaked 0.70 | 0.35 | 0.5 | 0.008 | **0.08** (golden in 12 s) | 0.8 | **pad**: floaty hop, deep 0.75 anticipation | foam |
| mochidough | 1.15 | 0.10 | 0.7 | 0.010 | 0.05 (crust) | 0.6 | **plod**: lean, then a small hop | dough (dark) |
| jellygel | 0.92 | 0 | 0.25 | 0.020 | 0.015 | 1.0 | **jiggle**: medium hop, long wobble after landing | gel (clear) |
| waterfill | 0.98 | 0 | 0.15 | **0.025** | 0.015 | 0.95 | **slosh**: low hop, waits for its slosh to settle | gel |
| putty | 1.25 | 0 | 0.8 | 0.010 | 0.02 | 0 | **shuffle**: lean + glide 0.12 m/s, never hops (no repeated squash: its memory would keep the dent, `maps/PHYS.md:195`) | dough |
| stickystretch | 0.95 | 0 | **1.0** | 0.018 | 0.015 | 0.85 | **peel**: hop with glue only half suspended, strings at take-off | sticky (nasal) |
| slimegoo | 1.05 | 0 | **1.0** | 0.015 | 0.015 | 0 | **ooze**: lean + glide 0.10 m/s with strands | sticky |
| firmsilicone | 1.10 | 0 | 0.1 | 0.015 | 0.015 | **1.3** | **boing**: big quick hops, a double bounce on landing, 1.4 hops/s | firm (bright) |
| popdome | 0.80 | 0 | 0.1 | 0.015 | 0.015 | 1.2 | **bob**: short stiff hops, lands flat | firm |
| gummy | 1.02 | 0 | 0.4 | 0.020 | 0.015 | 1.0 | **chew**: quick small hops, 1.6 hops/s | gel |
| beadsqueeze | 1.40 | 0 | 0.3 | 0.012 | 0.015 | 0.6 | **crunch**: low hop, a crunch tick on landing | beads (granular) |

Rules. Hop heights: scoot 0.04 m, hop 0.08 m, big 0.12 m, climb 0.18 m, each x hop scale; a family may climb (a 0.14 m step) only when 0.18 x
scale >= 0.14, i.e. scale >= 0.8: firm, popdome, jelly, gummy, waterfill, sticky, marshmallow. The others need the player's hand: the toy
teaches you who needs help. Soak raises density toward the soaked value; drying (air 0.02 /s, Sun Patch x3, Fire Glow x2) lowers it. Looks
are 0..1 per body and eased by the stage; cold, warm, wet, sandy and snowy **never** change stiffness or damping in v1 (re-gating 12 families of
hop, press, rub and pull rows is the cost, `maps/PHYS.md:159-160`). Pop dome: no text may promise a pop or a flip (`materials.ts:301-305`).

### 2.2 Reactions by place (each cell: what happens, tagged P / L / S / B)

**Home (Felt Nook)**

| family | Puff Cushion | Felt Ramp | Felt Ball | Music Box | Nap Patch |
|---|---|---|---|---|---|
| slowrise | sinks deep, rises slowly (P) | needs a hand up (B) | pushes it a little (P) | hums low, slow (S) | **naps first**, long zzz (B) |
| marshmallow | squashes flat, puffs back (P) | climbs, drifts down soft (P) | barely moves it (P) | breathy coo (S) | naps, sinks a little (B) |
| mochidough | sags, keeps a dent 3 s (P) | needs a hand up (B) | nudges it slowly (P) | warm hum (S) | naps, flattens (P, B) |
| jellygel | bounces 3 times, wobbles (P) | climbs, wobbly slide (P) | boops it far (P) | clear chirps (S) | dozes when tired (B) |
| waterfill | slow bounce, sloshes (P) | climbs, sloshes at the bottom (P) | boops it (P) | gurgly coo (S) | dozes, slosh settles (P) |
| putty | lands with a thud, no bounce (P) | carried up, oozes down slow (P) | leans on it, it sticks a moment (P) | low hum (S) | naps, holds the dent (P) |
| stickystretch | sticks, peels off with strings (P) | creeps down in tugs (M2) (P) | ball sticks a moment (P) | nasal trill (S) | naps rarely (B) |
| slimegoo | oozes over the edge (P) | carried up, slides down leaving strings (P) | ball rolls through it (P) | wet hum (S) | spreads out flat (L, B) |
| firmsilicone | big boing, double bounce (P) | climbs, shoots off the end (P) | kicks it fast (P) | bright chirps (S) | never naps here (B) |
| popdome | stiff boing (P) | climbs, slides flat (P) | taps it (P) | squeaky chirps (S) | naps on the edge (B) |
| gummy | quick bounce (P) | climbs, chewy slide (P) | boops it (P) | candy chirp (S) | dozes (B) |
| beadsqueeze | lands with a crunch (P, S) | needs a hand up (B) | pushes it, rattles (S) | rattly trill (S) | naps, lumps settle (P) |

**Fizzwash Cove**

| family | Shallows | Sand and Sun Patch | Sunball | Bob Ring and Seesaw | Dune Slide | Shell Chimes |
|---|---|---|---|---|---|---|
| slowrise | floats high, **soaks** and settles to the sand (M12) (P, L) | dries and rises on the Sun Patch (L, P) | pushes it with its nose (P) | rides high, then soaked sinks the ring (P) | needs a hand; slides slow (P) | taps one shell (S) |
| marshmallow | **floats like a cork**, soaks slowly; **squirts when squeezed** (S09) (P, L, S) | gets sandy, dries fast (L) | barely moves it (P) | floats up off the seesaw (M14) (P) | climbs, drifts down (P) | soft tap (S) |
| mochidough | wades, picks up wet sand (L) | sandy crust, footprints deep (L) | nudges it slowly (P) | sits heavy on the low end (P) | carried up, plods down (P) | thump (S) |
| jellygel | floats low, wobbles with the surge, glows in the sun (P, L) | sandy speckles (L); **basks** (B) | **boops it far** (P) | rides the ring, wobbles (P) | climbs, splashes in (P, S) | boops; chirps the note back (S) |
| waterfill | **bobs in the surge, core sloshes a beat behind** (P) | dries clear (L) | boops it (P) | **sits in the ring and sloshes** (P) | climbs, big splash (P, S) | gurgle answer (S) |
| putty | wades slowly, sand prints kept for ages (P, L) | deep prints that heal over 40 s (P) | leans; it sticks (P) | thuds on the low end (P) | carried up, oozes down (P) | dull tap (S) |
| stickystretch | wades; wet tack loosens (L) | **coated in sand** (sand pick 1.0) (L) | ball sticks to it, rolls off (P) | sticks to the plank, strings (P) | sticks halfway, peels down (P) | sticks to a shell, lets go: twang (S) |
| slimegoo | sits and spreads (P) | **coated in sand**, washes off in the sea (L) | swallows the ball a moment (P) | oozes along the plank (P) | carried up, slides with strings (P) | wet tap (S) |
| firmsilicone | wades, splashes on landing (P, S) | grippy, clean (L) | **kicks it far** (P) | **launches the other end** (P) | climbs, shoots into the sea (P) | rings all three (S) |
| popdome | floats like a cap (P) | clean (L) | taps it (P) | bobs on the ring (P) | climbs, flat slide (P) | bright tap (S) |
| gummy | wades, a little bob (P) | sandy freckles (L) | boops it (P) | rides, chews (B) | climbs, chewy slide (P) | candy chirp (S) |
| beadsqueeze | sinks to the bottom, rattles (P, S) | crunches sand (S) | shoves it (P) | heavy end (P) | needs a hand; crunchy slide (P, S) | rattle (S) |

**Flurrytop**

| family | Snow and cold air | Ice Pond | Soft Drift | Sled Slope | Snowball and Shake Pine | Warm Stone | Pine Swing |
|---|---|---|---|---|---|---|---|
| slowrise | frosts slowly; rises even slower (L) | slides a little (P) | **sinks in, slow print** (P, L) | needs a hand (B) | buried in snow (L) | warms, puffs up (L) | needs a hand; sways (P) |
| marshmallow | frosted sugar crust (L); **drifts in gusts** (P) | spins slowly (P) | sinks, light prints (L) | climbs, drifts down (P) | snowy cap (L) | **warmest spot**: sits (B) | floats off the seat at the top (P) |
| mochidough | frost dusting (L) | slow slide (P) | **keeps prints** (P) | needs a hand (B) | snowy (L) | softens on top (L) | heavy swing (P) |
| jellygel | frost on its gloss (L), shivers (P) | glides well, wobbles (P) | prints (L) | climbs, glides on (P) | snow cap, wiggles it off (M10) | glows, unfrosts (L) | wobbles on the seat (P) |
| waterfill | **frosts first**, voice lower (L, S) | glides, sloshes (P) | prints (L) | climbs, slides, sloshes | snowy (L) | unfrosts (L) | **sloshes against the swing** (M8) (P) |
| putty | stiff-looking frost (L) | crawls (P) | **deep prints, heal in 40 s** (M3) (P) | carried up, oozes down (P) | snowball dents it (P) | sags warm (L) | heavy, slow swing (P) |
| stickystretch | frost (L) | **sticks to the ice**, barely moves (P) | grips (P) | **sticks halfway, peels down** (P) | snowball sticks to it (P) | strings soften (L) | grips the seat (P) |
| slimegoo | frosty glaze (L), slow (B) | oozes, does not slide (P) | spreads (P) | carried up, slides with strings | snowy (L) | **oozes flatter** (M11) (L, B) | oozes over the seat (P) |
| firmsilicone | frost (L) | **skates far with a squeak** (M1) (P, S) | bounces out (P) | climbs, shoots across the pond (P) | **pushes the Snowball** (B) | brief warm (L) | big swings (P) |
| popdome | frost (L) | slides flat (P) | bounces (P) | climbs, slides flat (P) | taps the pine (P) | warms (L) | stiff swing (P) |
| gummy | frost (L) | glides (P) | prints (L) | climbs, glides (P) | snowy (L) | softens look (L) | chewy swing (P) |
| beadsqueeze | crunches every step (S) | rattles across (P, S) | **crunch prints** (S, L) | needs a hand; crunchy slide | shoves the Snowball (P) | warms (L) | rattles at the top (S) |

**Toastwood Cabin**

| family | Wood and Rug | Fire Glow (Hearth) | Kettle steam | Rocker | Book Steps | Tick Clock |
|---|---|---|---|---|---|---|
| slowrise | naps on the Rug first (B) | toasty edges, sleepy (L, B) | soaks a little steam (L) | naps while it rocks (B) | needs a hand (B) | sways slowly, dozes (B) |
| marshmallow | soft pad gait (P) | **toasts golden, turns round** (M4) (L, B) | dewy (L) | rocks, drifts up (P) | climbs, proud star (B) | sways (B) |
| mochidough | plods (P) | **toasty crust** (L) | dewy, warm hum (L, S) | sits heavy, rocks deep (P) | needs a hand (B) | sways (B) |
| jellygel | jiggles (P) | glows warm through (L) | shiny wet (L) | rocks, wobbles (P) | climbs to the top (B) | sways, wobbling (B, P) |
| waterfill | sloshes on the Rug (P) | warm glow (L) | dewy (L) | **sloshes opposite the rock** (P) | climbs (B) | sways, slosh in time (P) |
| putty | shuffles (P) | warm sheen (L) | dewy (L) | heavy rock (P) | needs a hand (B) | leans on the beat (B) |
| stickystretch | sticks to the Rug a moment (P) | strings go glossy (L) | wet tack (L) | sticks to the seat (P) | climbs, sticks to each step (P) | sways (B) |
| slimegoo | oozes across (P) | **oozes softer** (L) | wet shine (L) | oozes over the edge (P) | needs a hand (B) | sways (B) |
| firmsilicone | bounces on the boards (P, S) | warm (L) | squeaky wet (L, S) | **rocks it hard** (P) | **hops to the top fast** (B) | hops on the beat (B) |
| popdome | bobs (P) | warm (L) | wet (L) | stiff rock (P) | climbs (B) | taps on the beat (B) |
| gummy | chews along (P) | **goes soft-looking** (L) | shiny (L) | chews, rocks (P) | climbs (B) | sways (B) |
| beadsqueeze | rattles on the boards (S) | warm rattle (S) | dewy (L) | **rattles like beans in a pot** (S) | needs a hand (B) | rattles in time (S) |

### 2.3 Favourite place, favourite thing, best friend (per species, `src/data/life.ts`)

**Derivation (deterministic, then frozen as a typed table `satisfies Record<SpeciesId, SpeciesLife>`):** favourite place = the family's place
(waterfill, jellygel, slimegoo: Cove; stickystretch, firmsilicone, putty, beadsqueeze: Flurrytop; marshmallow, gummy, mochidough: Toastwood;
popdome, slowrise: Home), with three overrides (Burrbin and Thumbly: Home, Rattlebead: Toastwood) so the counts are **Home 8, Cove 14, Flurrytop
14, Toastwood 14** (checked by script). Favourite thing = the family's two picks in that place, alternating by catalog order within the family,
with three hand edits so **every thing (zone things included: Shallows, Sun Patch, Ice Pond, Soft Drift, Nap Patch, Rug) is somebody's favourite**. Best friend = **25 symmetric pairs, every pair across lanes, tier gap at
most 1** (checked: 22 pairs gap 0, 3 gap 1: Kneadle and Burrbin, Hushpuff and Rattlebead, Glimglop and Constello), so a new player's Commons have Common friends. The **starter Dollop** loves the Cove and the Sunball,
and its best friend is Boingle (a Common): the onboarding wish (7.7) is Dollop's.

| idx | species | place | thing | best friend | | idx | species | place | thing | best friend |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Dollop | Cove | Sunball | Boingle | | 25 | Spirelo | Cove | Shell Chimes | Diademo |
| 1 | Plumpet | Cove | Sun Patch | Cushlet | | 26 | Zingle | Flurrytop | Sled Slope | Slumbrel |
| 2 | Twangle | Flurrytop | Sled Slope | Thumbly | | 27 | Petalop | Cove | Driftwood Seesaw | Marigel |
| 3 | Puddlo | Cove | Bob Ring | Wisplet | | 28 | Burrbin | Home | Felt Ball | Kneadle |
| 4 | Glugbean | Cove | Driftwood Seesaw | Crimpo | | 29 | Marigel | Toastwood | Book Steps | Petalop |
| 5 | Crumbit | Flurrytop | Snowball | Munchip | | 30 | Gloopsy | Cove | Shallows | Thudge |
| 6 | Chunkle | Toastwood | Rocker | Dimpla | | 31 | Hushpuff | Toastwood | Rug | Rattlebead |
| 7 | Munchip | Toastwood | Book Steps | Crumbit | | 32 | Slumbrel | Home | Puff Cushion | Zingle |
| 8 | Wisplet | Toastwood | Hearth | Puddlo | | 33 | Thudge | Flurrytop | Warm Stone | Gloopsy |
| 9 | Cushlet | Toastwood | Rug | Plumpet | | 34 | Diademo | Home | Music Box | Spirelo |
| 10 | Crimpo | Toastwood | Kettle | Glugbean | | 35 | Taffelin | Flurrytop | Pine Swing | Caromel |
| 11 | Thumbly | Home | Felt Ramp | Twangle | | 36 | Rattlebead | Toastwood | Tick Clock | Hushpuff |
| 12 | Boingle | Flurrytop | Ice Pond | Dollop | | 37 | Cindergoo | Cove | Dune Slide | Selenuff |
| 13 | Dimpla | Home | Puff Cushion | Chunkle | | 38 | Selenuff | Toastwood | Hearth | Cindergoo |
| 14 | Nuzzo | Cove | Sunball | Knubby | | 39 | Pastrel | Toastwood | Kettle | Flipdome |
| 15 | Tadpolo | Flurrytop | Pine Swing | Wrigglo | | 40 | Flipdome | Home | Puff Cushion | Pastrel |
| 16 | Swishel | Cove | Bob Ring | Capnap | | 41 | Caromel | Flurrytop | Ice Pond | Taffelin |
| 17 | Granulo | Flurrytop | Shake Pine | Acornel | | 42 | Ambrosel | Cove | Sunball | Somnuff |
| 18 | Sproutle | Toastwood | Rocker | Hooplet | | 43 | Tidelume | Cove | Bob Ring | Fossilo |
| 19 | Wrigglo | Cove | Dune Slide | Tadpolo | | 44 | Glimglop | Cove | Shallows | Constello |
| 20 | Acornel | Toastwood | Hearth | Granulo | | 45 | Somnuff | Home | Nap Patch | Ambrosel |
| 21 | Capnap | Home | Nap Patch | Swishel | | 46 | Fossilo | Flurrytop | Soft Drift | Tidelume |
| 22 | Knubby | Toastwood | Rug | Nuzzo | | 47 | Skeinara | Flurrytop | Sled Slope | Prismelo |
| 23 | Kneadle | Flurrytop | Soft Drift | Burrbin | | 48 | Constello | Flurrytop | Snowball | Glimglop |
| 24 | Hooplet | Flurrytop | Snowball | Sproutle | | 49 | Prismelo | Toastwood | Rocker | Skeinara |

Pairs that make moments: Puddlo and Wisplet (a puddle and a cloud: the squirt game), Swishel and Capnap (water bowl and sponge), Kneadle and
Burrbin (the stud print, M3), Hushpuff and Rattlebead (the hush that calms a rattle: Rattlebead's crunch voice softens near it), Cindergoo and
Selenuff (flame and moon), Glimglop and Constello (a galaxy and its stars: a Legendary and a Mythic, a long goal that trade helps with).
**Per instance** (later discovery, slice 3): `mulberry32(genome.seed ^ 0x3c6ef372)` picks one of the favourite place's other things as "this one
also likes", shown on its Journal page once seen. The species favourite stays the main fact.

---

## 3. Life

### 3.1 Personality: five traits, pure functions of the genome (`src/life/traits.ts`)

Never stored, so a traded or merged squishy carries its personality. `fv = feelOf(MATERIAL_FAMILIES[family].physics)` (`materials.ts:439`);
`EYE_NOTICE` = wide 1, oval 0.6, dot 0.45, sleepy 0.15; `EYE_SLEEP` = sleepy 1, oval 0.25, dot 0.2, wide 0; `j()` = +-0.08 from
`mulberry32(seed ^ 0x7a11fe5d)` (a new salt, not one of the three in use, `maps/CORE.md:41`).

| trait (word in the Journal) | formula (clamped 0..1) | catalog spread (min / median / max, measured on the 50 templates) | drives |
|---|---|---|---|
| pep ("bouncy") | 0.55 bounce + 0.35 fv.bouncy + 0.1 [signature poke] + j | 0.20 / 0.54 / 0.90 | wander, boop, ball play, hop rate |
| curious ("curious") | 0.45 stretch + 0.35 EYE_NOTICE + 0.2 fv.stretchy + j | 0.32 / 0.58 / 0.94 | notice, copycat, climbing, peeking |
| cuddly ("cuddly") | 0.5 (1 - firmness) + 0.3 fv.squashy + 0.2 [signature squeeze] + j | 0.08 / 0.36 / 0.81 | nuzzle, comfort, snuggle pile |
| chatty ("chatty") | 0.25 + 0.35 EYE_NOTICE + 0.25 gloss + j | 0.38 / 0.65 / 0.83 | how often it speaks, singing, answering things |
| sleepy ("dozy") | 0.6 EYE_SLEEP + 0.4 fv.slowRise + j | 0.06 / 0.37 / 0.82 | rest need, naps |

The Journal shows the two traits furthest above their catalog medians (0.54 / 0.58 / 0.36 / 0.65 / 0.37). Measured top trait over the 50 templates:
cuddly 16, sleepy 12, bouncy 11, curious 9, chatty 2 (chatty is a voice trait, rarely a headline: fine). Dollop reads "bouncy and curious";
Capnap "dozy and cuddly"; Boingle "bouncy and chatty". Instances of one species differ a little (Dollop's pep over 200 seeds: p5 0.65, p95 0.80).

### 3.2 Needs and moods (gentle, never harmful)

Three needs, 0..1, per whole squishy while it is out; they only ever cause a behaviour or a wish, never a loss. Rates are per second x
(0.5 + the trait).

| need | rises | falls | at 0.8 |
|---|---|---|---|
| play | +0.010 awake and untouched (x pep) | -0.3 a thing use; -0.4 its signature touch; -0.2 any touch | a "Play with me" wish or a thing |
| company | +0.008 when nobody is within 2 m (x chatty) | -0.5 any social; -0.2 a nearby friend | a friend wish |
| rest | +0.004 awake, +0.010 while hopping (x sleepy); x1.5 in the Cabin | -0.02 napping | nap |

**Comfort** is not a need but the body's looks: frost, wet (for non-soakers), sand or snow above 0.5 make it seek the remedy (Warm Stone, Fire
Glow, Sun Patch, the Shallows) or show a remedy wish. **Mood** (for the face) is derived: *happy* after joy in the last 8 s; *sleepy* rest > 0.7;
*wistful* company > 0.8 (looks around); else *content*. All needs start at 0.2 on arrival; travel resets play and company to 0.2.

### 3.3 Behaviours (`src/data/life.ts` `BEHAVIOURS`, run by `src/life/brain.ts`)

The brain thinks at 10 Hz (every 6th frame, staggered by character index); motion intents run every frame in between. Choice = highest utility
(base x trait x need) + seeded noise (+-0.05) + 0.15 hysteresis for the current behaviour, after cooldowns. W = whole squishy, F = face piece, C = chunk.

| id | behaviour | trigger (exact) | motion | emote / voice | ends | cooldown | who |
|---|---|---|---|---|---|---|---|
| B01 | idle | nothing else scores > 0.2 | breathe, blink, look around every 2.2-5.8 s | none | anything else | none | W F C |
| B02 | wander | play > 0.3, nothing of interest within 1.5 m, untouched 4 s | 2-5 gait steps to a random point inside bounds - 0.4 m | none | arrived | 6 s | W F |
| B03 | notice | a body arrives, a prop moves within 1.0 m, or a land / bump within 1.5 m | gaze first (0.15 s), then lean 0.6 toward it | question (curious > 0.6) | 1.5 s | 4 s per source | W F |
| B04 | use a thing | play > 0.4 and a free thing within 3 m (favourite x3, a climbing thing only if it can climb) | walk there, then the family's verb (2.2) | heart if favourite, sparkle else; joy call | verb done (3-8 s) | 10 s per thing | W F |
| B05 | bask / remedy | a comfort look > 0.5, or sun / warm zone within 2 m and sleepy > 0.5 | walk to the zone, settle (squash 0.95) | sun, flame, droplet (by zone) | look < 0.1 or 15 s | 20 s | W F |
| B06 | nap | rest > 0.75, or sleepy > 0.6 on a nap spot within 2 m | walk to the nap spot, squash 0.92, sleepy eyes; **physics sleep allowed** | zzz (shared in a pile) | touch, rest < 0.2, or 20-40 s | 30 s | W F C |
| B07 | show a wish | a need or comfort > 0.8 that maps to a wish (7.4), no wish open on this body, at most 2 on screen | face the camera, one small hop | thought bubble with the wish glyph; a rising "question" phrase | granted, or put away | 12 s between re-glances | W F |
| B08 | sulk | its partner was put away mid-social, or another took its thing | turn away 30 degrees, squash 0.97 | huff; one low coo | 3 s, or any touch (then giggle) | 60 s | W |
| B09 | afterglow | the player released, snapped or poked it | spring back (physics), gaze to the camera | heart for its signature touch, else sparkle or giggle | 1.5 s | none | W F C |
| B10 | arrive | travel ended | one arrival hop | sparkle (one shared bubble) | 1 s | per visit | W F C |
| B11 | love its place | first 10 s in its favourite place, once per visit | big hop, wiggle 3 Hz for 0.6 s | heart + sparkle, the joy call | 2 s | per visit | W F |
| B12 | come back | outside bounds - 0.4 m after a toss | gait toward the pad | none | inside | none | W F C |
| B13 | pose | the Snap tool is picked, or "Pose!" in the Snap bar | stop, face the camera, happy eyes | one sparkle | the tool changes | none | W F |
| B14 | watch | a ceremony or a cut starts nearby (slice 3: audience) | gaze at the pad | wow at the burst | the ceremony ends | none | W F |
| P01 | follow | a chunk more than 0.6 m from its face piece | scoot hops (0.03 m) behind it in a line | none | within 0.4 m | none | C |
| P02 | huddle | the face piece idle for 3 s | gather within 0.6 m of it | none | the face piece moves | none | C |

Social behaviours S01 to S11 are in section 4. Brains are **off** while `!game.input.live` (ceremony, hold, pause; `game.ts:605`), during a cut
neck or join on that body, and on the desktop while the Hoard holds input (bodies keep simulating and may sleep). With the Cut tool in hand the
other squishies stay put (no wander); with the Snap tool they pose (B13). The setting "Let them play by themselves" off = only B01, B03, B06 (when
put on a nap spot), B09 and B13 run: they still look, react and emote, but never travel or use things.

### 3.4 How a squishy moves by itself

A **hop** is two intents a LIFE step apart, both from `src/life` (it owns the timing): `SQUASH(s = 0.82 x family anticipation, 0.12 s)` (new
physics driver `setSquash`, volume preserving: y x s, x and z x 1/sqrt(s), `maps/PHYS.md:103-104`), then `HOP(vx, vy, vz)` (new `hop()`: a nudge
with glue and peel suspended for 10 substeps, so the same impulse leaves the table at the same height in every family). vy = sqrt(2 g h), g = 10:
scoot 0.04 m = 0.89 m/s, hop 0.08 m = 1.26 m/s, big 0.12 m = 1.55 m/s, climb 0.18 m = 1.90 m/s, each x the family hop scale; horizontal 0.25 to 0.5
m/s along the gait direction. A **step** of a walking gait is one scoot; gaits chain steps at the family rate (2.1). Putty and slime **never hop**:
they lean (goal shear, at most 0.1 R) toward the target and glide (`moveTo`, stiffness 0.3, so 0.9 m/s cap, eased; real speed set by LIFE 0.10-0.12
m/s). **Landing** from an autonomous hop or a prop launch carries `auto: true` on its `land` event, so the shell routes it through the attention
budget instead of the player's feedback (`maps/PHYS.md:107-108`). **Lean** = goal shear toward a point; **wiggle** = side-to-side shear 2-4 Hz,
<= 0.05 R; **gaze** = `stage.setBodyGaze`; **expression** = `stage.setBodyExpression` (happy, sleepy, surprised, proud, shy: shy is gaze down and
away with a lowered lid, **no blush**, `REFERENCES.md` 3).

### 3.5 What the player's touch does to the brain

Any finger, grab, lock or carry on a body (`metrics.fingers > 0 || grabbed || carried`, or a lock) sets its brain to HELD **in the same step**:
pending intents are dropped, the physics touch gate (PHYS E9) pauses the LIFE drivers and eases them out over 0.12 s (a cut-off would pop), its
gaze goes to the pointer. On release: B09 afterglow (1.5 s), then the brain resumes with play need lowered. Its partner in a social moment
waits 2 s, then does a small "your turn" hop. A tossed squishy that lands faster than 3 m/s shows a swirl (dizzy) and wiggles. Touch never pays
more or less because of LIFE; LIFE never touches the meter (7.9).

### 3.6 Kept inside the place

Physics: `setBounds(rounded box)` replaces the home-circle corral in a place (PHYS E3): the same brake and glide back, about the place's box, not
a body's home spot. LIFE: every target is clamped to bounds - 0.4 m; a body outside it runs B12. Things and zones are inside the bounds by data
(check DA-02).

---

## 4. Social play

| id | interaction | starts when | emote | voice exchange | physics | ends | friendship |
|---|---|---|---|---|---|---|---|
| S01 | greet | first sight of another awake body this visit, within 2 m | hello (on the starter), sprout on a first ever meeting | starter: its motif's first two syllables; other: the mirrored reply | one hello hop toward it (0.08 m) | the reply | +2 |
| S02 | nuzzle | both idle within 1.0 m and (pals, or cuddly > 0.6) | one shared heart between them (two hearts if best pals) | a hummed duet, third apart | both lean 0.1 R toward each other, the last 0.2 m by `moveTo` 0.3 until touching | 4 s | +3 |
| S03 | boop | pep > 0.6, another idle within 1.2 m | giggle on the booped one | chirp, then a giggle trill | a hop into it at 0.4 m/s (a soft `bump`, intensity about 0.13) | the wobble settles | +2 |
| S04 | copycat | a curious friend within 2 m sees a hop or thing use | star on the copier | the copier repeats the leader's phrase one step higher | the same hop or verb 0.6 s later; chains up to 3 (follow the leader) | chain end | +3 |
| S05 | sing together | 2+ near a singing spot (Music Box, Hearth, rung Shell Chimes), or 2 chatty pals idle | two notes (one shared bubble) | each sings its motif on the music's eighth grid, in harmony (5.3) for 1 to 2 bars | sway (wiggle) at 1.1 Hz | the bars end | +4 per pair |
| S06 | snuggle pile | 2+ with rest > 0.6 within 1.5 m of a nap spot (or the Cabin at night) | zzz, one shared | a falling coo each, then silence | hop together into contact, squash 0.9, **physics sleep** | a touch or 30 s | +5 per pair |
| S07 | comfort | a body sulking, frosty or soaked; a friend (met+) with cuddly > 0.5 within 2.5 m | heart on the comforter | a low hum, the other answers higher | the comforter walks over and leans on it 3 s | 3 s | +3 |
| S08 | duo thing | two on a two-seat thing (Seesaw, Rocker) or one on the Swing with a friend beside | giggle, then star | alternating chirps on each swing or tilt | they take turns hopping on their end | 3-6 cycles | +4 |
| S09 | squirt game | the player squeezes a soaked foam (soak > 0.3) with another body within 1.2 m in front of it | wow on the target, then giggle | a splash, the target's surprised chirp | a spray FX arc (12 drops, 4 in Calm) 0.4 s; target wet +0.3; soaker soak -0.4 | 1.5 s | +3 |
| S10 | peekaboo (slice 3) | a curious body behind a thing from the camera's view, a friend near | question, then sparkle when found | a rising chirp, a giggle | it leans out and back twice | found | +3 |
| S11 | pass the ball | two pep > 0.5 within 3 m of a ball | ball (wants to play) | chirp on each boop | each boops the ball toward the other (prop poke) | 4 passes or a miss | +3 |

**Friendship** is per species pair (survives merges, simple to learn: "Puddlo and Wisplet are pals"). Points from the table above, x1.5 for a
best-friend species pair, **capped at 20 per pair per visit and 40 per pair per UTC day**, never decaying. Levels: **Met** (1+), **Pals** (40+, one
day at the earliest), **Best pals** (120+, three days at the earliest). Unlocks: Met: they greet with call and reply every time they meet. Pals:
nuzzle and duet for any pair (the cuddly gate is lifted), shared bubbles. Best pals: their own **twirl** (two hops each around one another, a
duet with a held last note), a pair card in the Journal; a best-friend species pair at Best pals stamps both species' D4 discovery and counts
toward the friend keepsakes (7.6). Storage: sparse rows `[idxA < idxB, level, points, dayPoints, day]`, at most 128 rows (1225 possible); when
full, the lowest Met row that is not a best-friend pair is dropped first. Per instance, the player's own bond is **warmth** (not "heart", which
already means the favourite flag, `maps/CORE.md:185`): +1 per granted wish (max 1 per wish), +1 per day for its signature touch (max 2 a day),
5 glows maximum; at 3 it greets you with a hop toward the camera when brought out, at 5 its hops leave a faint sparkle trail. A merge result
starts at the higher parent's warmth (nothing is lost).

---

## 5. Emotes and voices

### 5.1 Squishmoji (`src/data/life.ts` `SQUISHMOJI`; drawn by `src/render/emotes.ts`)

Icons are ink line art (#14102a, so 16:1 on the bubble) with one accent fill, inside a cream (#fff1d6, 92%) round bubble with a thin plum
(#2a1744) outline that reads on bright and dark skies. Each icon is a list of at most 6 SDF primitives (circle, segment, arc, triangle) in a small
data table, evaluated in one fragment shader: no texture, no image, CSP-safe, crisp at any DPR. Names passed the name screen.

| id | name | drawing | meaning | typical source |
|---|---|---|---|---|
| 0 | heart | heart, coral fill | "I love this!" | favourite thing, signature touch, nuzzle |
| 1 | two hearts | two hearts, coral | "Best pals!" | best-pal nuzzle, twirl |
| 2 | note | one eighth note, lagoon | "La la!" | singing alone |
| 3 | two notes | two joined notes, lagoon | "Let's sing!" | sing together |
| 4 | sparkle | four-point twinkle, amber | "Ooh, new!" | discovery, arrival, whole again |
| 5 | question | "?", dusk | "What's that?" | notice |
| 6 | wow | burst outline with a dot, amber | "Whoa!" | splashed, snow fell, fast slide, a cut nearby |
| 7 | zzz | three z's stepping up, dusk | "Sleepy..." | nap, snuggle pile |
| 8 | sun | disc with 8 rays, amber | "Warm and sunny" | Sun Patch |
| 9 | snowflake | six-arm flake, lagoon | "Brr, chilly" | frost, cold air |
| 10 | flame | flame, coral and amber | "Toasty!" | Fire Glow |
| 11 | droplet | drop, lagoon | "I'm wet!" | soaked, splashed, steam |
| 12 | shell | fan shell, cream and coral | "Look, a shell!" | Cove sand, Shell Chimes |
| 13 | leaf | one leaf, felt green-dusk | "So peaceful" | calm idle outdoors |
| 14 | swirl | spiral, dusk | "Dizzy!" | toss, slide, swing |
| 15 | huff | little puff cloud | "Hmph!" | sulk |
| 16 | hello | three short arcs | "Hi there!" | greet |
| 17 | ball | ball with a seam, amber | "Play with me!" | play need, pass the ball |
| 18 | star | five-point star, amber | "I did it!" | top of the Book Steps, a long glide, copycat |
| 19 | giggle | wavy squiggle | "Hee hee!" | boop, tickle, squirt target after the surprise |
| 20 | sprout | two-leaf sprout | "New friend!" | first ever meeting, level up |
| 21 | moon | crescent, cream | "Calm and cozy" | Cabin idle, night window |
| 22 | warm mug | mug with steam | "So cozy" | warmed up, Kettle |
| 23 | splash | three drops flying | "Splash!" | slide into water, squirt |

**Wish glyphs** (inside a thought bubble with three trailing dots): Home (felt disc), Cove (wave), Flurrytop (peak), Toastwood (cabin roof),
friend (a gem in the friend species' body colour), squeeze (two inward arrows), stretch (two outward arrows), boop (a dot with a ring), nap (zzz),
sing (note), ball, slide, swing, warm (flame), dry (sun), wash (wave), whole again (two halves). 17 glyphs, the same SDF table (41 icons total).

**Bubble rules.** At most 1 bubble per body. Pop in 0.15 s (scale 0.6 to 1.0 with a 1.08 overshoot), hold 1.2 s, fade 0.25 s; Calm: fade in
0.25 s, no scale, no overshoot. Size on screen: 34 CSS px phone, 40 desktop; a shared or group bubble x1.15; a wish 40 / 46 px. Anchor: 1.3 x
restRadius above the body's top, kept inside the frame room and the HUD safe insets (`setSafeInsets`), stacked upward when two overlap, slid
clear of the capsule like the hint pill. Never over the reveal plate. The **first three bubbles a new player sees** show a one-word label under them
("loves it", "hello", "curious"); after that only with **Words under bubbles** on. Tapping any bubble shows its meaning for 2 s (quest H7). Wish
bubbles stay until granted; after 8 s they shrink to a 14 px dot that can be tapped to grow again. Bubbles are 3D (render), so they appear in
photos; the Snap bar has "Bubbles in photo" (default on).

### 5.2 Voices (`src/audio/creature.ts`)

**Cheapest voice** (`maps/AUDIO.md:166-171`): one oscillator with a cached `PeriodicWave` per flavour (the six of `FAMILY_FLAVOUR`, `cut.ts:35-50`),
one envelope gain, one formant biquad, a panner only off centre: 3-4 nodes. Contours by `frequency` / `detune` automation only.
**Syllables:** chirp (rise +5 semitones in 90 ms), coo (fall -4 in 160 ms), purr (flat 180 ms with a 28 Hz amplitude flutter by a precomputed
gain curve), hum (flat 220 ms, +-15 cents vibrato curve), trill (3 notes of 55 ms stepping the pentatonic scale).
**Species motif:** 3 syllables and 2 intervals (-2..+2 pentatonic steps) from `mulberry32(hashString(speciesId) ^ 0x2545f491)`, syllable types weighted by
flavour (foam: coo, purr; firm: chirp, trill; gel: chirp, coo, hum; sticky: chirp, coo; beads: trill, purr; dough: hum, coo). **Every Dollop has
the same three-note call** at its own pitch: children learn who is calling.
**Phrases:** greet = the first two syllables; reply = the caller's rhythm with the contour mirrored (the composer's answer rule, `music.ts:393-401`);
joy = motif + a rising trill; sleepy = one slow falling coo; wish = motif ending on an upward chirp; sing = the motif's notes taken from the current
field's rest tones on the eighth grid; group (pieces) = one voice of 2-3 oscillators detuned +-10 cents.
**Pitch:** wholes: D5 (587 Hz) x `pitchRatio(genome)` (`genome.ts:140-144`, about 0.70 to 1.43) snapped to the nearest D major pentatonic note
(D E F# A B) in A4..D6 (440-1175 Hz); cold places -1 semitone before snapping. Pieces: x `popSize(frac)` = (0.5 / frac)^0.4, snapped in D6..D7
(1175-2349 Hz), 7 dB quieter. Pentatonic is safe over all four music fields (`maps/AUDIO.md:16-17`), with the music on or off.
**Harmony:** in a sing, the first singer takes the field's first rest tone, the next a third or a fifth above from the same rest set, placed on
the eighth grid from a new read-only `musicClock()` (the SOUNDING field, not the planned one, `maps/AUDIO.md:128-130`).
**Never makes room:** creature kinds stay out of `ROOM_KINDS`, so the music is never dipped by chatter; chatter has priority -1 (stolen before any
player sound); its own rng stream (no draw from `engRng`). Chatter goes silent during ceremonies (the ceremony owns the moment and its C-rooted
motifs, `maps/AUDIO.md:225-227`). Level: dry peak at most -18 dBFS at chatter 0.6, so player effects stand >= 8 dB in-band above it.
**Sound off:** every voice phrase has an emote that carries the same meaning (greet = hello, joy = heart or sparkle, wish = the wish bubble,
sing = notes, sleepy = zzz); the mapping is a total table (check UI-03).

### 5.3 The attention budget (`src/life/attention.ts`, pure; applied by `src/shell/lifeHost.ts`)

One arbiter for everything autonomous: bubbles, voices, autonomous landing and prop sounds, effect particles. **Autonomy never vibrates** (0 haptics).
Requests carry a score: base (P0 the touched body or the one answering it 100, whole 50, face piece 40, chunk flock 20, a wish +15) + 20 x (1 -
normalised distance from the frame centre) + 10 if this behaviour was not shown in the last 20 s. Highest first; ties by character index.
"Phone" = coarse pointer or the short side under 600 CSS px.

| cap (rolling 1 s unless "at once") | phone | phone Calm | desktop | desktop Calm |
|---|---|---|---|---|
| bubbles on screen at once (wishes included, wishes at most 2) | 3 | 2 | 4 | 2 |
| bubble starts per second | 1.5 | 0.75 | 2 | 1 |
| gap between two bubbles of one body | 2.5 s | 4 s | 2.5 s | 4 s |
| creature voices at once (a group voice counts 1) | 2 | 1 | 2 | 1 |
| syllable starts per second | 3 | 1.5 | 4 | 1.5 |
| autonomous land / bump / prop sounds per second | 2 | 1 | 3 | 1 |
| autonomous particle bursts per second / particles per burst | 2 / 6 | 0.6 / 2 | 3 / 8 | 1 / 3 |
| haptics from autonomy | 0 | 0 | 0 | 0 |

Audio keeps its own backstop `ChatterLimiter` (the `BumpLimiter` shape, `interact.ts:90-123`) at the desktop row, so a shell bug can never flood.
A request that loses is dropped, never queued (no backlog of stale emotes).

---

## 6. Pieces

**Can:** hop (scoot only, 0.03 m), wiggle, lean, follow the face piece (P01), huddle (P02), nap in a pile, bob and float, slide, get wet, sandy,
frosty, snowy or toasty, ring the Shell Chimes, push a ball, hum along. **Cannot:** wish, greet one by one, sing a solo, gain friendship or
warmth (their deeds count for the parent instance and species), climb. The **face piece** keeps the eyes, the brain, the traits and the needs, and
behaves like a small whole (no wishes except "whole again").

**One flock, one voice, one bubble.** Only one squishy can be in pieces at a time (CUT.md 2.4 limits pieces of ONE squishy; cutting another party
member first reconnects the first, animated). Its chunks form one flock with the face piece as leader: one flock brain picks one shared behaviour;
**the flock gets at most one bubble** (at the flock's centroid, x1.15) **and one group voice** (2-3 detuned oscillators, never N voices) at a time,
scored at base 20, so with many characters the pieces are the first to go quiet. Calm: the flock is silent except for one hum when the face piece
sings.

**Character caps** (whole squishies + pieces on screen; the cut squishy counts as its pieces). Costs from `maps/PHYS.md:172-180`: an awake
detail-3 body 1.6-2.3 ms (loaded machine); resting 0.69 ms (detail 3) vs 0.17 ms (detail 2); six detail-2 pieces with all-pairs collide 1.15 ms;
a touching pair +0.22 ms. Assumed (to measure, PH-09): an awake detail-2 whole about 0.5 ms; an asleep body about 0.02 ms.

| tier | whole squishies | of which detail 3 | pieces (of one squishy) | characters at once | awake at once (the rest asleep) | physics estimate, worst awake case |
|---|---|---|---|---|---|---|
| low | 3 | 1 (the active one) | 4 | 6 | 4 | 2.0 + 3 x 0.5 + 0.4 = 3.9 ms |
| med | 4 | 1 | 6 | 8 | 5 | 2.0 + 4 x 0.5 + 0.5 = 4.5 ms |
| high | 5 | 2 | 6 | 10 | 7 | 2 x 2.0 + 5 x 0.5 + 0.7 = 7.2 ms |

Pieces allowed = min(MAX_PIECES, characters cap - (wholes - 1)): with 4 wholes out on med, a cut makes at most 5 pieces. Party members that are
not the active body are built at detail 2 on low and med from the moment they come out (no run-time swap: a swap pops the body upright and ticks
the luminance, `maps/PHYS.md:140-142`); the render draws them and every chunk with the low fine mesh (2562 verts). A tier drop trims the party to
the new cap (the farthest from the frame centre that is not the active body goes back to the shelf with a soft "see you soon" hop, announced).

**The brain on a cut and on whole again.** At the cut, the parent brain moves to the face piece (needs and traits kept); the chunks join the flock;
every other party member does one shared wow, and the most curious walks over to look (B03). After 45 s in pieces the face piece may wish
"whole again" (glyph: two halves). On Reconnect all: the flock dissolves, the whole squishy does a whole-again hop and sparkle, and up to two
friends nearby cheer (one shared sparkle). Nothing about a cut is stored (CUT.md rule 1).

---

## 7. Purpose: the Journal

### 7.1 Shape

The **Journal** (key J, the book button) has four tabs: **Pages** (quests in chapters, one chapter per place), **Squishies** (6 discoveries per
species), **Friends** (pairs and levels) and **Keepsakes** (16, also shown on the Home shelf). Quest = a page; a done page gets a stamp. No timers,
no fail states, no streaks; nothing can be lost; a page can always still be done later. **The next place opens when 5 pages of the current
chapter are done**, so one hard page never blocks; the chapter finale opens at 7 of 9 (Home: at the wish).

### 7.2 Typed events (`src/core/quests.ts` `PlayEvent`, produced by the shell and the LIFE host into a preallocated ring, never `emit()`)

`visit(place)`, `touch(kind squeeze|pull|poke, heldS, level)` (a copy of the meter's mapped touch: it pays nothing here), `thing(thing, by self|player,
species)`, `social(kind, a, b)`, `look(look sandy|wet|frosty|snowy|toasty, species, amount)`, `float(species, seconds)`, `glide(species, metres,
zone)`, `mark(zone)`, `nap(zone, count)`, `sing(place, count)`, `wish(state shown|granted, species, wish)`, `discover(species, fact)`, `friend(a, b,
level)`, `reveal(tier, isNew)`, `party(size)`, `emoteTap(emote)`, `squirt(from, to)`, `wash(species)`, `warmed(species, thing)`, `reachTop(thing,
species)`, `propHit(thing, species)`, `together(place, count, happyS)`, `cut(pieces)`, `whole(species)`, `photo(place, count)`. Each record:
`{ kind, place, species (idx or 255), family, thing, other, by, a, b }`, all numbers.

### 7.3 The chapters (`src/data/quests.ts`; rules are checked by the reducer from events alone)

Rule forms: `count` (n events matching), `seconds` (a summed by a), `max` (a single event with a >= n). "any" = any species.

**Chapter 0: Hello, Home** (onboarding; finale = the first wish)

| id | page (player text) | rule |
|---|---|---|
| H1 | Give your squishy a long squeeze | count 1 `touch` kind squeeze, heldS >= 1 |
| H2 | Stretch it and let it go | count 1 `touch` kind pull, level >= 0.35 |
| H3 | Watch it play by itself | count 1 `thing` by self, place home |
| H4 | Open a capsule | count 1 `reveal` |
| H5 | Have two squishies out at once | max `party` a >= 2 |
| H6 | See them say hello | count 1 `social` greet |
| H7 | Tap a bubble to see what it means | count 1 `emoteTap` |
| H* | A wish comes true | count 1 `wish` granted. Reward: keepsake **Felt Star**; Fizzwash Cove opens |

**Chapter 1: Fizzwash Cove**

| id | page | rule |
|---|---|---|
| C1 | Take a trip to Fizzwash Cove | count 1 `visit` cove |
| C2 | Let a squishy float for five seconds | max `float` a >= 5, place cove |
| C3 | Bounce the Sunball three times | count 3 `thing` sunball |
| C4 | Ring the Shell Chimes | count 1 `thing` shellchimes |
| C5 | Two squishies on the Driftwood Seesaw | count 1 `social` duo, thing seesaw |
| C6 | Get a squishy sandy, then wash it in the sea | count 1 `wash` (fires when a body with sand >= 0.5 enters the Shallows) |
| C7 | Squeeze a soaked puff so it squirts a friend | count 1 `squirt` (needs a marshmallow or slow-rise squishy: Wisplet and Cushlet are Commons) |
| C8 | Sing a beach song together | count 1 `sing` place cove, a >= 2 |
| C9 | Find out a squishy's favourite place | count 1 `discover` fact place |
| C* | Sunset hug (opens at 7 of 9) | max `together` place cove, count >= 3, happyS >= 8: the sky warms to sunset and they nuzzle in a row. Reward: keepsake **Tide Glass**, a **gift capsule** (once ever) |

**Chapter 2: Flurrytop**

| id | page | rule |
|---|---|---|
| F1 | Take a trip to Flurrytop | count 1 `visit` peak |
| F2 | Slide down the Sled Slope | count 1 `thing` sledslope |
| F3 | Glide across the Ice Pond | max `glide` zone icepond, a >= 1.5 m |
| F4 | Make tracks in the Soft Drift | count 8 `mark` softdrift |
| F5 | Shake snow off the Shake Pine | count 1 `thing` shakepine |
| F6 | Warm a chilly squishy on the Warm Stone | count 1 `warmed` thing warmstone (frost went from >= 0.5 to 0) |
| F7 | Give a squishy a ride on the Pine Swing | count 1 `thing` pineswing, by player |
| F8 | Roll the Snowball into a friend | count 1 `propHit` snowball |
| F9 | See one squishy comfort another | count 1 `social` comfort |
| F* | Snowy snuggle (opens at 7 of 9) | max `nap` place peak, count >= 3 for 10 s: the snow slows and stars come out. Reward: **Snowglobe**, a gift capsule |

**Chapter 3: Toastwood Cabin**

| id | page | rule |
|---|---|---|
| T1 | Take a trip to Toastwood Cabin | count 1 `visit` cabin |
| T2 | Warm a squishy by the Hearth until it glows | max `look` toasty, a >= 0.6 |
| T3 | Rock the Rocker with two squishies | count 1 `social` duo, thing rocker |
| T4 | Hop to the top of the Book Steps | count 1 `reachTop` booksteps |
| T5 | Hear the Kettle sing | count 1 `thing` kettle |
| T6 | Sway to the Tick Clock together | count 1 `social` sway, thing tickclock, a >= 2 |
| T7 | Have a nap on the Rug | count 1 `nap` zone rug |
| T8 | Make three wishes come true | count 3 `wish` granted (counted from the chapter's start) |
| T9 | Help two squishies become pals | count 1 `friend` level >= 2 (from the chapter's start) |
| T* | Fireside song (opens at 7 of 9) | max `sing` place cabin, count >= 3, near the Hearth: a two-bar song with the music. Reward: **Ember Jar**, a gift capsule, a gold Journal cover |

Every finale needs 3 squishies, so it works on `low` (3 wholes). Pages that need a family the player may not own (C7) are optional by design (5 of 9 opens
the next place). Unlock order: Home, Cove, Flurrytop, Toastwood; a player may revisit any open place at any time.

### 7.4 Wishes

A wish is a thought bubble over a squishy (B07). It never expires, never fails, and does not nag: at most 1 per body and 2 on screen, a re-glance
every 12 s, a dot after 8 s. Tap it for a card with one kind sentence and one button.

| wish | glyph | shown when | granted when |
|---|---|---|---|
| W1 visit | the place | play > 0.8, its favourite place is open and not here (the onboarding wish: Dollop, the Cove) | it arrives there |
| W2 thing | slide / swing / ball / ... | play > 0.8 in its favourite place | it uses its favourite thing (by itself or carried there) |
| W3 friend | friend gem | company > 0.8, its best-friend species is owned and not out | that species is brought out |
| W4 touch | squeeze / stretch / boop | play > 0.6 and 3+ minutes since its signature touch | you do that touch (squeeze >= 1 s, stretch >= 0.35, or a tap) |
| W5 nap | zzz | rest > 0.8 and no nap spot within 2 m | it naps (carry it to a nap spot) |
| W6 sing | note | chatty > 0.6, company > 0.5 | it sings with another |
| W7 remedy | warm / dry / wash | a look > 0.7 for 20 s | the look falls under 0.1 |
| W8 whole again | two halves | in pieces for 45 s | Reconnect all |

**Daily Wishes:** each UTC day, `daySeed(deviceId, day, 'wishes')` (`drops.ts`) picks 3 owned species and a wish each; the Journal lists them
("Today: Crimpo wishes for the Kettle"); they appear in play when that squishy is out. They pay warmth and discoveries only.

### 7.5 Discoveries (6 per species, 300 stamps, a 6-bit mask each)

| bit | discovery (Journal line once found) | found when |
|---|---|---|
| D1 | "Met Dollop." | it is brought out once |
| D2 | "Dollop loves Fizzwash Cove." | B11 plays in its favourite place |
| D3 | "Dollop's favourite thing is the Sunball." | it uses its favourite thing 3 times (by itself, or with your hand for a species that cannot climb) |
| D4 | "Dollop's best friend is Boingle." | both out together and one social between them |
| D5 | "Dollop's song" (a play button replays the motif) | it sings with any other squishy |
| D6 | "In water, Dollop bobs and wobbles." (the family's line) | a family reaction is seen (float, soak, glide, toast, crunch, ooze) |

Unknown facts show "???" and a hint ("Take Dollop on a trip to find out"). A full page gets a gold edge.

### 7.6 Keepsakes (16; bit set; procedural little objects on the Home shelf and in the Journal)

| keepsake | how | | keepsake | how |
|---|---|---|---|---|
| Felt Star | Chapter 0 finale | | Sand Star | first Pals |
| Tide Glass | Chapter 1 finale | | Pine Charm | first Best pals |
| Snowglobe | Chapter 2 finale | | Wool Scarf | 5 best-friend pairs found (D4) |
| Ember Jar | Chapter 3 finale | | Acorn Cap | 10 pairs at Pals |
| Sun Shell | 5 full species pages | | Shell Comb | all 25 best-friend pairs found |
| Fir Cone | 10 full pages | | Button | 10 wishes granted |
| Warm Mug | 20 full pages | | Thimble | 50 wishes granted |
| Cozy Quilt | 35 full pages | | Ribbon | all 50 pages full |

### 7.7 The first ten minutes (a new player; economy times from DESIGN 5.4: first capsule 77 s, ramp 30 / 50 / 75 SP)

| time | what happens | pages |
|---|---|---|
| 0:00 | Title, "Wake it up". Home: Dollop on the felt; the Puff Cushion, Music Box, Felt Ramp, Felt Ball and Nap Patch around it. The tracker pill appears: book + "0/7". The hint says "Hold to squeeze". | |
| 0:05-0:40 | You poke: Dollop's signature is poke, so its first bubble is a heart with the word "loves it". A long squeeze: the first stamp lands ("Page done!"). | H1 |
| 0:40 | You pause 6 s. Dollop notices the Felt Ball (question, "curious"), three hops, boops it, sparkles. If you never pause, the newcomer does it at about 2:00. | H3 |
| ~1:00 | A stretch and let go. | H2 |
| 1:17 | The meter fills; the capsule drops (built). | |
| 1:30 | You open it. The newcomer **stays out** (new rule: a new squishy comes out to say hello if the mat has room). Hello hop, call, mirrored reply, "hello" and a sprout. | H4 H5 H6 |
| 2:00-3:30 | Free play. Squishies play by themselves between touches. After 2 min, if no bubble was tapped, the tracker shows "Tap a bubble". About 3:00, capsule 2 (50 SP). | H7 |
| ~3:30 | 60 s after the first reveal (5:00 at the latest), Dollop faces you: a thought bubble with a wave. Tap: "Dollop dreams of the sea. Shall we visit Fizzwash Cove?" [Let's go] [Not now]. "Not now" leaves a dot and makes the Places button glow. | |
| 4:00 | Travel: the Cove card says "New!", the party row already holds who is out. Go. A 0.5 s crossfade, the surf fades in over 2 s. | |
| 4:10 | Arrival hops (one shared sparkle). The wish is granted: Chapter 0 finale, the Felt Star drops beside them, plate "Wish granted! Keepsake: Felt Star." Dollop's love moment (B11): "Dollop loves Fizzwash Cove." | H* C1 C9 |
| 4:30-6:00 | Dollop bounds into the Shallows and wades with the surge; a floater floats. You flick the Sunball, Dollop boops it back. About 5:30 capsule 3 (75 SP) opens on the Cove's pad. | C2 C3 (1-2 of 3) |
| 6:00-10:00 | You tap the Shell Chimes, Dollop sings the note back; a sticky one gets sandy and washes in the sea; with 3 out, a beach song. | C3 C4 C6 C8 |

About 12 stamps in 10 minutes, one every 50 s at first, then slower. By 10:00 Chapter 0 is done and the Cove has 4 to 6 of 9.

### 7.8 Day 2, day 7, day 30

**Day 2:** the game opens where you left (the Cove, your party). Three Daily Wishes, the Restock and the two tasks as today. You finish the Cove
pages; the sunset hug (finale) gives the Tide Glass and a gift capsule; Flurrytop opens (it opened at 5 pages). First Pals possible (40 points).
**Day 7:** Flurrytop mostly done, Toastwood open; 2 to 4 Pals, maybe a first Best pals (120 points take 3 days at the cap); 20 to 30 discovery
stamps; 4 to 6 keepsakes. **Day 30:** Toastwood finished and the gold cover; the long tail is the collection itself, seen through the Journal:
every new species is a new page of 6 facts (300 stamps), 25 best-friend pairs (the rare ones, like Glimglop and Constello, need owning both: the
Hoard, merges and trade give the Journal its tail), the keepsake shelf, Daily Wishes, and warmth on your favourites. None of it is a timer.

### 7.9 The economy: what touches it, and why the pace holds

- **Only 3 capsules, once ever:** one per chapter finale (Cove, Flurrytop, Toastwood), at most 1 per UTC day, through the existing task-capsule path
  (`ghostTaskCapsules`, origin `'task'`, a new grant function in `collection/ghost.ts`, the only client file allowed to call the roll, probe I03), inside
  TASK_CAPSULE_CAP 10. If the cap is full or a second finale lands on the same day, the gift **waits in the Journal** ("Your gift is ready") and is
  collected on the next open; nothing is lost. No SP is ever granted. Everything else (keepsakes, discoveries, places, warmth, friendship) is not
  economy.
- **The meter is untouched by construction.** LIFE has no finger, grab or lock intent (type-level), so autonomy can never make a `poke`, `release`
  or `snap` (the only paying kinds, `meterfeed.ts:43-65`). Autonomous hops and props make only `land` and `bump`, which pay 0; and every event with
  `auto` or `prop` set is dropped before `collection.feed` anyway. The quest reducer never calls the meter, and counts touches even when 5 capsules
  wait (`ghost.ts:95` does not apply to it).
- **Proof rows:** EC-01 (a 10-minute party of 5 wholes and 6 pieces, every place, no input: exactly 0 SP, 0 task progress, 0 capsules); EC-02
  (`sim_economy.ts` gains a "quest" source: 3 one-time capsules on assumed days 2, 5 and 10 for a regular player). Section C (active minutes a
  capsule: 3.2 to 3.7 for the paying styles, regular median 3.5) is unchanged because the meter is unchanged; section K moves by about 3 / 6.0 = 0.5
  active days (a regular opens about 6 capsules an active day), so 247 / 153 days to all 50 should move by at most 1 day, to be re-quoted from the run.
  MERGE_COST 2 stands.

---

## 8. Screens (follow `_spec/UI.md`: tokens, `h()`, CSSOM only, 44 px targets, 4.5:1 text, 3:1 parts, reflow at 320)

**Phone, 390 x 844 (portrait).** Free today: the top row centre (about 90 px) and the right edge between the top bar and the meter ring
(`maps/SHELL.md:21-23, 138-140`).
- **Tracker pill:** inside `.hud-top`, centred, 88 x 36 px: a 20 px book glyph and "4/9" in tabular numerals (15 px). Tap or J: the Journal at the
  current chapter. A completed page makes it glow lagoon for 2 s (a fade in Calm). Pinning a page in the Journal shows its first words in a
  one-line drop-down card (358 x 44) under the top bar for 4 s after each change, then it folds back.
- **Places button:** right edge, 44 x 44 round gel button at right 16, top 80, signpost glyph, an 8 px dot in the current place's colour. P opens Travel.
- **Wish bubble:** 3D in the scene (40 px); its tap target is a 44 x 44 invisible hit area from the same projection the play target uses
  (every 250 ms) and slides clear of the capsule (`avoidCapsule`).
- **Wish card:** in the plate slot (top + 70 px), 358 x 96: the species' tier gem and colour swatch, one sentence (16 px), two 44 px buttons.
- **Page-done moment:** the plate slot, 358 x 64: a stamp glyph, "Page done!" (heading 17 px) and the page text (body 15 px, one line, ellipsis),
  "4 of 9" right; 2.4 s; queued like a ceremony (never within 1 s of a burst, never over a reveal); one polite live-region line.
- **Finale moment:** 3.5 s in the scene: the keepsake drops beside the party like a capsule and they hop; plate "Keepsake: Tide Glass. Flurrytop is
  open!"; music duck -6 dB for 1 s; Calm: no drop, a fade.
- **Travel sheet:** a bottom sheet 390 x 620 (top at 224 px), `suspend('covered')`. Title "Where to?" (title 22 px). A 2 x 2 grid of place cards
  171 x 176 (gap 16): a little CSS-gradient scene (sky band, ground band, one or two shapes, no images), the name (heading 17 px), "4 of 9 pages" or the
  lock line "Opens after 5 Cove pages" (caption 13 px), a "You are here" chip. **Bring along:** a row of the party chips, 56 x 56 (gem and
  colour swatch, name 12 px under), up to the tier's whole-squishy cap, plus a "Change" chip that opens a small picker from the Hoard. A primary
  button "Go to Flurrytop" 358 x 52. Order: leaving() (reconnect, release locks) first, then travel.
- **Journal:** a full sheet 390 x 844 (z 7, like the phone Hoard): header 56 px (back, "Journal", chapter "4 of 9"), a segmented control of 4 tabs
  (86 x 44 each). *Pages*: chapter cards 358 x 72 (place colour band, progress, keepsake slot), page rows 358 x 60 (stamp box 32 px, text up to two
  lines at 16 px, count "2/3", a pin toggle 44 x 44). *Squishies*: a 3-column grid of 110 x 136 cards (swatch, gem, name, 6 stamp dots); a species
  page (pushed) with the two trait words, the 6 discovery lines, "Play its song", warmth (5 dots). *Friends*: rows with two gems, two names, the
  level word and a 5-dot bar; best-friend pairs marked with two hearts once found. *Keepsakes*: a 4 x 4 shelf of 80 x 80 slots, locked ones as soft
  outlines with the "how" line. A **Wishes now** list at the top of Pages (each with a button: "Bring Boingle", "Go to the Cove") makes every wish
  keyboard-grantable.
- **Phone landscape and 320 x 568:** the tracker shrinks to the glyph and the count (60 px); the Travel grid becomes one column of 4 short cards (288 x 96).

**Desktop, 1280 x 800.** The top bar right group becomes [Places] [Journal] [mute] [gear] (44 px, tooltips). The tracker pill shows the glyph,
the count and the pinned page text (up to 280 px). Travel: a centred modal 760 x 540 with 4 cards in a row (168 x 220), the party row, a 240 x 48 Go
button, `holdInput('travel')`. Journal: a two-page book 1040 x 640 (left page: lists; right page: the detail), the tabs as ribbons on the top edge.

**Settings (two rows each, in the existing panel):** Sound: **Squishy chatter** slider (default 60%), **Place sounds** slider (default 50%). Play:
**Let them play by themselves** switch (default on), **Words under bubbles** switch (default off). Snap bar: **Bubbles in photo** (on) and a **Pose!**
button (B13). Keys: J Journal, P Places (both free, `keyboard.ts:67-122`); Escape order: tray, Settings, Journal or Travel, Hoard, tool, plate.
Every new DOM overlay joins the Snap hide list (`hoard.css:392-393`); bubbles are 3D and governed by "Bubbles in photo".

---

## 9. Architecture

### 9.1 Data model (`src/data/places.ts`; flat module, imports only `../core/*.ts` leaves, `./catalog.ts`, `./materials.ts`)

```ts
export type PlaceId = 'home' | 'cove' | 'peak' | 'cabin';
export type ThingId = 'cushion' | 'musicbox' | 'feltramp' | 'feltball' | 'nappatch' | 'sunball' | 'bobring' | 'seesaw' | 'duneslide' | 'shellchimes'
  | 'shallows' | 'sunpatch' | 'sledslope' | 'snowball' | 'shakepine' | 'warmstone' | 'pineswing' | 'icepond' | 'softdrift'
  | 'hearth' | 'rocker' | 'kettle' | 'booksteps' | 'tickclock' | 'rug';   // the Fire Glow and Warm Stone heat are the `zone` of their thing
export interface GroundMods { readonly mu: number; readonly glue: number; readonly peel: number; readonly drag: number } // multipliers, Home = 1
export type Collider =
  | { readonly shape: 'sphere'; readonly r: number }
  | { readonly shape: 'box'; readonly hx: number; readonly hy: number; readonly hz: number; readonly pitchDeg?: number }
  | { readonly shape: 'capsule'; readonly r: number; readonly half: number }
  | { readonly shape: 'set'; readonly parts: readonly { readonly c: Collider; readonly at: readonly [number, number, number] }[] }; // ring, steps, chimes
export type Mechanism =
  | { readonly kind: 'static' }
  | { readonly kind: 'roll'; readonly vmax: number; readonly drag: number; readonly dragWater?: number; readonly restitution: number; readonly density?: number }
  | { readonly kind: 'hinge'; readonly axis: 'x' | 'z'; readonly pivotY: number; readonly limitDeg: number; readonly damping: number }
  | { readonly kind: 'pendulum'; readonly pivotY: number; readonly length: number; readonly limitDeg: number; readonly damping: number }
  | { readonly kind: 'spring'; readonly hz: number; readonly zeta: number; readonly travel: number }
  | { readonly kind: 'float'; readonly bobHz: number; readonly bobAmp: number; readonly hz: number; readonly zeta: number; readonly driftX: number };
export type ZoneKind = 'water' | 'warm' | 'cold' | 'wind' | 'grip' | 'nap' | 'soft' | 'sun';
export interface ZoneDef {
  readonly id: ThingId | 'air'; readonly kind: ZoneKind;
  readonly area: { readonly circle: readonly [number, number, number] } | { readonly box: readonly [number, number, number, number, number] } | 'all'; // [x,z,r] | [x,z,hx,hz,cornerR]
  readonly mods?: Partial<GroundMods>; readonly surfaceY?: number; readonly surge?: { readonly periodS: number; readonly speed: number };
  readonly rate?: number; readonly gust?: { readonly everyS: readonly [number, number]; readonly durS: number; readonly accel: number; readonly maxDensity: number };
}
export type Verb = 'bounce' | 'boop' | 'ride' | 'slide' | 'ring' | 'sit' | 'rock' | 'climb' | 'sway' | 'shake' | 'listen' | 'nap' | 'float' | 'push';
export interface ThingDef {
  readonly id: ThingId; readonly place: PlaceId; readonly name: string; readonly at: readonly [number, number, number]; readonly yawDeg: number;
  readonly collider?: Collider; readonly mech: Mechanism; readonly zone?: ZoneDef; readonly seats: 0 | 1 | 2; readonly needsClimb: boolean;
  readonly verb: Verb; readonly tap: 'poke' | 'play' | 'none'; readonly sound: PropSound; readonly glyph: number; // squishmoji / wish glyph index
}
export interface PlaceDef {
  readonly id: PlaceId; readonly name: string; readonly chapter: 0 | 1 | 2 | 3;
  readonly ground: GroundMods & { readonly marks: 'none' | 'sand' | 'snow'; readonly markLifeS: number };
  readonly bounds: { readonly hx: number; readonly hz: number; readonly cornerR: number } | { readonly disc: number };
  readonly pad: readonly [number, number]; readonly spawn: readonly (readonly [number, number])[];
  readonly things: readonly ThingId[]; readonly zones: readonly ZoneDef[]; readonly cold: boolean; readonly night: boolean;
  readonly camera: { readonly target: readonly [number, number, number]; readonly pitch: number; readonly dist: number; readonly viewBox: readonly [number, number] };
  readonly musicStyle: 'home' | 'cove' | 'peak' | 'cabin'; readonly ambience: PlaceId; readonly opensAfter: { readonly chapter: number; readonly pages: number } | null;
}
export type Gait = 'sink' | 'pad' | 'plod' | 'jiggle' | 'slosh' | 'shuffle' | 'peel' | 'ooze' | 'boing' | 'bob' | 'chew' | 'crunch';
export interface FamilyReact {
  readonly density: number; readonly soakedDensity: number; readonly soak: number; readonly sandPick: number; readonly frost: number; readonly toast: number;
  readonly hopScale: number; readonly gait: Gait; readonly stepsPerS: number; readonly anticipation: number; readonly flavour: VoiceFlavour; readonly waterLine: string;
}
export const PLACES: Readonly<Record<PlaceId, PlaceDef>>;  export const THINGS: Readonly<Record<ThingId, ThingDef>>;
export const FAMILY_REACT: Readonly<Record<MaterialFamilyId, FamilyReact>>;
```

`src/data/life.ts`: `SPECIES_LIFE: Readonly<Record<SpeciesId, { place: PlaceId; thing: ThingId; friend: SpeciesId }>>`, `SQUISHMOJI` (id, name,
meaning, icon index), `WISH_GLYPHS`, `BEHAVIOURS` (id, base, trait weights, need, cooldownS, who mask), `SOCIAL` (id, points, gates), `TRAIT_MEDIANS`.
`src/data/quests.ts`: `CHAPTERS`, `QUESTS` (id, chapter, text, hint, rule), `KEEPSAKES`, `WISHES`, `DISCOVERY_LINES`. All texts through the shared name
gate (DA-03). Size estimate minified: places 6 KB, life 8 KB, quests 9 KB.

### 9.2 The LIFE step (`src/life/**`: no DOM, no three, no physics import, no clock, no Math.random; `erasableSyntaxOnly`: no enums, const objects)

```ts
export const LIFE_MAX = 16;                        // characters (10 is the high cap; headroom for travel overlap)
export const F = { TOUCHED: 1, GROUNDED: 2, AIRBORNE: 4, ASLEEP: 8, IN_WATER: 16, PIECE: 32, FACE: 64, VISIBLE: 128, CARRIED: 256 } as const;
export interface LifeSnapshot {                    // filled IN PLACE by the shell host after drain(); never reallocated
  n: number; t: number; dt: number; placeIdx: number; quality: number; calm: boolean; phone: boolean; autonomy: boolean;
  readonly x: Float32Array; readonly z: Float32Array; readonly y: Float32Array; readonly vx: Float32Array; readonly vz: Float32Array; // LIFE_MAX each
  readonly r: Float32Array; readonly screenX: Float32Array; readonly screenY: Float32Array; readonly submerged: Float32Array;
  readonly flags: Uint16Array; readonly species: Uint8Array; readonly family: Uint8Array; readonly flock: Int8Array; // -1 or the face piece index
  readonly looks: Float32Array;                    // LIFE_MAX x 5: wet sand frost toast snow (owned by the host's look model)
  readonly propX: Float32Array; readonly propZ: Float32Array; readonly propBusy: Uint8Array; propN: number;
  evN: number; readonly evKind: Uint8Array; readonly evA: Uint8Array; readonly evB: Int8Array; readonly evV: Float32Array; // 64 slots: land, bump, propHit, touch
}
export const IK = { SQUASH: 1, HOP: 2, GLIDE: 3, LEAN: 4, WIGGLE: 5, GAZE: 6, EXPR: 7, SLEEP_OK: 8, WAKE: 9, PROP_POKE: 10 } as const;
export interface LifeIntents { n: number; readonly kind: Uint8Array; readonly who: Uint8Array; readonly a: Float32Array; readonly b: Float32Array; readonly c: Float32Array; readonly d: Float32Array } // 64 slots
export const XK = { EMOTE: 1, VOICE: 2, FX: 3, SOUND: 4 } as const;
export interface LifeExpress { n: number; readonly kind: Uint8Array; readonly who: Uint8Array; readonly id: Uint8Array; readonly reply: Int8Array; readonly score: Float32Array } // 32 slots
export interface CastMember { readonly key: number; readonly genome: Genome; readonly itemId: string | null; readonly piece: boolean; readonly face: boolean; readonly frac: number }
export interface LifeWorld {
  setCast(cast: readonly CastMember[]): void;     // on change only (may allocate); keys are the shell's stable character ids
  setPlace(id: PlaceId, visitSeed: number): void;
  step(s: LifeSnapshot, out: LifeIntents, ex: LifeExpress, play: PlayEventSink): void; // zero allocation; <= 0.08 ms at n = 16 (node, LI-04)
  readonly needs: Float32Array; readonly behaviour: Uint8Array; // read-only views for the dev hook
}
export interface PlayEventSink {                   // the shell's preallocated 64-slot ring (7.2); numbers only, never emit()
  push(kind: number, place: number, species: number, family: number, thing: number, other: number, by: number, a: number, b: number): void;
}
export function createLife(opts: { seed: number }): LifeWorld;
export interface AttentionCaps { bubbles: number; bubbleStartsPerS: number; bodyGapS: number; voices: number; syllablesPerS: number; autoSoundsPerS: number; fxPerS: number; fxParticles: number }
export function createAttention(): { grant(ex: LifeExpress, t: number, caps: AttentionCaps, out: LifeExpress): void };
```

**Frame order** (`game.ts simStep`, `maps/SHELL.md:27-52`): (b') *act*: apply last step's intents to bodies (after `flushPendingUps`, before `bodies.step`)
through one arbiter with the priority finger > cut / ceremony > LIFE (cut steering keeps its `moveTo`); then bodies step, props step (once, after
every body), drain; (e') *sense*: the host fills the snapshot in place from bodies, props and this step's events (copied into its own 64-slot ring
while draining), runs `life.step`, runs `attention.grant`, and calls the stage and audio for the granted expressions only. First version as a
`game.onStep` hook (one frame of latency, invisible).

### 9.3 Contract additions (`src/contracts.ts`, all optional, additive, marked `PLAYGROUND`)

```ts
/* physics */
export interface GroundModsLike { mu: number; glue: number; peel: number; drag: number }
export interface PlayBounds { cx: number; cz: number; hx: number; hz: number; cornerR: number }
export interface PropWorldLike {                   // src/physics/props.ts; filled from PlaceDef by the shell
  readonly count: number;
  readonly shapes: Float64Array;                   // stride 16: kind, px py pz, qx qy qz qw, dims x3, mu, restitution, flags
  readonly impulses: Float64Array;                 // stride 6: linear xyz + angular xyz collected from every body this frame
  readonly zones: Float64Array;                    // stride 16: kind, area, surfaceY, surge, rate, mods x4, gust
  time: number;
  step(dt: number): void;                          // integrate moving props once per frame after all bodies stepped; clamps speeds
  poke(i: number, vx: number, vy: number, vz: number): void;
  pose(i: number, out: Float32Array, offset: number): void; // 7 floats
}
// SoftBodyLike, optional members:
//   setWorld?(w: PropWorldLike | null): void;   setGroundMods?(m: GroundModsLike, easeS?: number): void;   setBounds?(b: PlayBounds | null): void;
//   setSquash?(s: number, seconds: number): void;   hop?(vx: number, vy: number, vz: number, peel?: number): boolean;
//   lean?(x: number, z: number, amount: number): void;   wiggle?(hz: number, amp: number, seconds: number): void;
//   setDensity?(d: number): void;   setSleepAllowed?(on: boolean): void;
// SoftMetrics, optional: asleep?: boolean; submerged?: number; airborne?: boolean
// SoftEvent, optional: auto?: boolean (made by a LIFE hop or a prop launch); prop?: number (a bump against prop i)
/* render: StageLike, optional */
//   loadPlace?(id: string): Promise<void>;   setPlace?(id: string | null): void;     // null = Home; swap under the ScreenFx crossfade
//   setPropPoses?(poses: Float32Array, count: number): void;                          // 7 floats per prop, place order
//   setBodyLook?(id: number, wet: number, sand: number, frost: number, toast: number, snow: number): void;
//   setBodyGaze?(id: number, x: number, y: number, z: number, on: boolean): void;
//   setBodyExpression?(id: number, expr: 'none' | 'happy' | 'sleepy' | 'surprised' | 'proud' | 'shy', amount: number): void;
//   showEmote?(bodyId: number, icon: number, kind: 'bubble' | 'wish' | 'group', scale?: number): number; // slot or -1
//   clearEmote?(slot: number): void;   pickEmote?(xCss: number, yCss: number): number;  // slot under a tap or -1
//   stampMark?(x: number, z: number, angle: number, size: number, kind: number): void;
//   bodyScreenPoint?(id: number, out: Float32Array): boolean;                          // x, y CSS px and r, zero allocation (DebugHook.bodyScreen is another thing)
// AddBodyOpts, optional: lite?: boolean (low fine mesh). FxKind adds 'spray' | 'snowpuff' | 'embers' | 'steam'.
/* audio: SquishAudio, optional */
//   setAmbience?(p: { place?: string; on?: boolean; volume?: number }): void;
//   voice?(p: { flavour: number; motif: number; phrase: number; pitch: number; group?: number; pan?: number; reply?: number; calm?: boolean }): boolean;
//   prop?(p: { kind: string; intensity: number; id?: number; held?: number; pan?: number }): void;
//   musicClock?(out: { field: number; barT0: number; bpm: number }): boolean;
//   setMusicStyle?(style: string): void;              // default 'home' is bit-identical to today
// AudioSettings, optional: chatter?: number; ambience?: number
/* shell */
// Settings, optional: chatter?: number (0.6); ambience?: number (0.5); autonomy?: boolean (true); bubbleWords?: boolean (false)
// DebugHook, optional: life?(): {...}; quests?(): {...}; travel?(place: string): Promise<void>
```

Collection interface (`collection/types.ts`, additive): `journal(): JournalView`, `applyPlay(ev: PlayEvent): void` (batched save),
`collectGift(): GiftResult`, `onJournal(fn)`. The collection never imports `src/life` (I01): LIFE events reach it through the shell.

### 9.4 Physics additions (by `maps/PHYS.md` extension id)

E9 touch gate (first); E7 `setSquash` + `hop` with glue and peel suspended for 10 substeps (peel argument 0.5 for sticky's half tack), `auto` on the
next land; E8 lean and wiggle; E10 sleep (rest test: kinetic < 0.02, |vc| < 0.01 m/s, grounded, no driver, for 0.5 s; memory families only after
MEM converged; wake on every listed cause; `collide` skips sleeper pairs; opt-in so old hash rows stay); E11 detail-2 wholes gated (fold, press, pull,
hop rows at detail 2); E13 bump memory keyed beyond 16; E2 ground modifiers through a small Float64Array (mutable `dragF` for ice); E3 `setBounds`;
E4 the prop contact pass (sphere, box, capsule, set) between the fingertip and table passes, touched particles joining the fold-limit list; E5
`props.ts` (roll, hinge, pendulum, spring, float), one-frame lag, speed clamps (ball 3 m/s); E6 water (per-particle buoyancy g / density below the
surface, drag toward the surge velocity, supported gravity off) and wind (uniform acceleration for density < 0.6). **Not built:** E1 height field,
E12 stiffness modifiers, any reuse of the float hover for water.

### 9.5 Render additions

`PlaceLook` objects in lazily imported `src/render/places/{cove,peak,cabin}.ts` sharing `places/kit.ts` (prop meshes, instanced statics, prop shadows);
`setPlace` swaps sky uniforms (the sky shader is parametric, `table.ts:26-29`), the ground mesh (felt hidden), backdrop cards, weather particles
(a normal-blend option on `Particles` for snow), lights as stage fields with the jelly light uniforms and `KEY_TINT` re-derived from the place key,
env panels as data through `EnvHub.rebuild` with the old cube disposed (`maps/RENDER.md:71-78`). Body looks `uWet uSand uFrost uToast uSnow` (+ `uHeatPos`)
in the jelly program (cache key v5), each checked on the WH_LOW path. Face: per-body gaze and the five expressions (no blush). `EmoteBubbles`: one
instanced alpha-blended draw at renderOrder 40+, depthTest off, the SDF icon table. `GroundMarks`: a ring buffer (64 / 48 / 24), one draw. Lite fine
mesh for background wholes and chunks, and **no fine-mesh update for a sleeping body** (today every view re-evaluates every frame,
`maps/RENDER.md:208-209`). Place camera: frame the party's box clamped to the place's view box, a 1.2 s critically damped ease, a 0.35 m dead band, back
to the place view 6 s after the last orbit. Ceremonies in slice 1 and 2 keep today's hide-all on the place's pad and the shell re-places the party after;
slice 3 adds the audience (B14).

### 9.6 Audio additions

`chatter` and `ambience` input gains created **after** the existing chain (so the harness's first gains keep their indices, `maps/AUDIO.md:36-38`);
`AmbienceBed` (a `MusicBed`-shaped bus, 3 s fade in, 2 s crossfade on travel, joins `freeAll` / `freeMusic` on pause and mute) with lazy recipes
`src/audio/places/{cove,peak,cabin}.ts`: Cove surf swell every 6-11 s + bubble fizz + sea wind; Flurrytop wind gusts in sync with the physics gust
seed + snow hush + crunch on marks; Cabin fire crackle 3-12 /s + rare pops + window rain hush + the Kettle and Tick Clock voices. **No animal sounds**
(no gulls, birds or crickets: D10's spirit). `creature.ts` (5.2) + `ChatterLimiter`; `props.ts` voices: ball (bump body, rubbery), creak (a held voice per
prop id, its own dead-man), chime (CHIME partials tuned to the field), splash (bubbles + falling noise), crunch (dense ticks), fire stoke, music box
(takes the melody: the bed mutes its mallets while it plays), kettle hum (field root), clock tick (on the beat, -34 dBFS). A player-caused prop sound
may make room; a prop that moves by itself never does. `MusicStyle` per place: field weights and mallet timbre only, the key stays D (cove: more lift and
glow; peak: glow and home, sparser mallet; cabin: dusk and home, a warmer low-passed mallet); `home` is bit-identical.

### 9.7 Save format and migration

New key **`wobblehoard:v2:journal`** (the hoard key and `HOARD_VERSION` 2 are untouched; old builds never read this key, so a rollback cannot eat it):

```json
{ "v": 1,
  "q": [[0, 2, 1], [1, 1, 0]],            "ch": [7, 3, 0, 0],      "pl": 3, "pv": 3,
  "d": [63, 5, 0],                         "f": [[0, 12, 2, 55, 14, 20406]],
  "k": 5, "w": [[0, 1, 20406]], "dw": [20406, 3, 17, 1, 9, 4, 22, 0],
  "wm": { "g_k3v9": 3 }, "g": { "paid": 1, "ready": 0, "day": 20406 }, "at": { "p": 1, "party": ["g_k3v9", "g_x1aa"] } }
```

`q`: per quest index [state 0 locked | 1 open | 2 done, counter (tenths for seconds rules)], about 40 rows. `ch`: per chapter bits (open, next place
opened, finale done, gift paid). `pl` / `pv`: places opened / visited bit sets. `d`: 50 discovery masks (6 bits) by species idx. `f`: friendship rows
[idxA, idxB, level, points, dayPoints, day] <= 128. `k`: keepsake bits (16). `w`: open wishes [species idx, wish, since day] <= 3. `dw`: today's day + 3
[species, wish] + done bits. `wm`: warmth by ghost id, <= 100, pruned on load to ids still on the shelf. `g`: gift capsules paid (<= 3), waiting, last day.
`at`: last place and party ids (<= 5). **Bounds:** the worst case is about 7 KB; the store refuses to write over 16 000 chars (parks whole under
PARK_MAX_CHARS 20 000). **Load:** absent = fresh; `v` > 1 = read-only in memory, never written ('newer', like the hoard); malformed or failing
sanitize = parked to `wobblehoard:v2:journal.unreadable` and fresh, reported 'repaired'. **Two tabs:** re-read before write; merge is union for
bit sets and done states, max for counters, points, warmth and `g.paid` (so a gift is paid at most once across tabs), last writer for `at`. Future
versions go through `migrateVersioned` with a `JOURNAL_MIGRATIONS` table (`save.ts:82-97`). **Settings** gain optional keys migrated by absence (v stays
2; `settings.ts:94-110` lists, `settingsPanel.ts` key unions at 49 and 65).

### 9.8 Lazy loading

First load: the entry, the stage chunk (with Home, the props kit core, bubbles and looks), the three data modules, `src/life`, `src/core/quests.ts`, the
journal store, the shell hosts, `creature.ts` and `ambience.ts` (without recipes). Lazy: `src/render/places/*.ts`, `src/audio/places/*.ts` (imported
by `stage.loadPlace` and `audio.setAmbience`, bare `'three'` specifier so three stays in the shared chunk), and one `screens` chunk (`src/ui/journal/*`,
`src/ui/travel.ts`) prefetched 30 s after the first reveal. A place's chunks are prefetched in idle time as soon as it opens.

---

## 10. Budgets and proof

### 10.1 Frame budget (mid-range phone, `med`, 16.7 ms; desktop-equivalent physics targets in brackets)

| subsystem | budget | how it is held |
|---|---|---|
| physics (bodies, collide, props) | 6.0 ms (4.5 ms on this container) | caps of section 6, detail 2 for background, sleep |
| props step + zones | 0.3 ms | at most 8 moving props per place |
| LIFE step + attention + host fill | 0.4 ms | 10 Hz brains, typed arrays, n <= 16 |
| render CPU (fine-mesh updates, uniforms, sort) | 4.0 ms | lite meshes, sleepers skipped |
| draw calls | <= 110 on med in the Cove with a full cast | instanced statics, 1 bubble draw, 1 marks draw |
| audio main thread | 0.4 ms mean | <= 4 syllables /s x about 0.1 ms + ambience tick 0.03 ms |
| UI | <= 1.0 ms | `UI.md` 2.7 |
| slack | 4.6 ms | |

### 10.2 Size budget (tighter than D9)

First load **<= 1280 KB** (D9: 1300; today about 1139 KB, `STATUS.md`): additions estimated at about 100 KB (data 23, LIFE 16, quests reducer and
journal store 10, shell hosts 14, render stage additions 24, creature and ambience bed 10). Each place: render chunk <= 45 KB, audio chunk <= 10 KB;
screens chunk <= 30 KB. Whole build **<= 1600 KB** (D9: 2000). The `vite.config.ts` G0 gate becomes first-load vs total before any place chunk lands.
Journal save <= 16 000 chars.

### 10.3 Acceptance checklist (node probes first, then browser)

**DATA** (`_harness/probe_playground_data.ts`, node)
- DA-01 `satisfies Record<...>` coverage; favourites as 2.3: place counts 8 / 14 / 14 / 14, every favourite thing in its favourite place, friends
  symmetric, never self, across lanes, tier gap <= 1; every ThingId (zone things included) is somebody's favourite.
- DA-02 Every prop inside its bounds, >= 0.5 m from every spawn spot, >= 1.0 m from the pad; every collider >= 0.16 m thick.
- DA-03 The shared `_harness/name_gate.ts` (moved out of `probe_catalog.ts`, behaviour byte-identical) passes every new name and text; pop dome promise
  words absent from every text.
- DA-04 Every player string <= 90 chars, sentences <= 12 words, mean word length <= 4.8 letters; COPY gate rules.
- DA-05 Import graph: the data modules load first in bare node and keep the core + data graph acyclic (`probe_genome.ts:87-120` extended).

**LIFE** (`_harness/probe_life.ts`, `probe_life_imports.ts`, node)
- LI-01 Imports: only `./`, `../core/`, `../data/`, `../contracts.ts` (type); no three, physics, render, audio, ui, shell, DOM, timers, Date, Math.random, performance.
- LI-02 Determinism: one seed + one scripted snapshot sequence gives the same intents and expressions over 10 000 steps (hash equal).
- LI-03 Zero allocation: 10 000 steps at n = 16 after warm-up: no scavenge in the window.
- LI-04 Cost: <= 0.08 ms mean per step at n = 16 on this container.
- LI-05 Touch: a TOUCHED flag drops that character's intents in the same step; none while touched or carried; afterglow emote within 0.2 s of release.
- LI-06 Bounds: no target outside bounds - 0.4 m in 30 simulated minutes.
- LI-07 Coverage: every behaviour B01-B14, P01-P02 and S01-S11 fires in a 20-minute scripted party run per place; none faster than its cooldown.
- LI-08 Attention storm: 10 wholes + 30 pieces asking 50 emotes /s and 50 syllables /s never exceed any cap of 5.3 in any rolling second, in all four
  columns; P0 is never starved.
- LI-09 Pieces: a flock of 6 shows at most 1 bubble and 1 group voice at a time.
- LI-10 No paying intents: no finger, grab or lock intent kind exists; a grep check finds no `fingerDown`, `grab` or `lockGrab` call in `src/shell/lifeHost.ts`.
- LI-11 Wishes: <= 1 per body, <= 2 on screen, never expire; the onboarding wish appears by 5:00 of play in the scripted new-player run.
- LI-12 Friendship: <= 20 points per pair per visit, <= 40 per day, <= 128 rows, eviction never drops a best-friend pair.

**QUESTS and COLLECTION** (node)
- QU-01 `core/quests.ts` purity: allowed imports, no clock, the word for the capsule roll absent (I03).
- QU-02 Every page has a scripted event list that completes it and a near miss that does not (float 4.9 s, 7 of 8 marks).
- QU-03 Next place at 5 pages, finale at 7, rewards once; replaying events after done changes nothing.
- QU-04 Touch pages count while 5 capsules wait.
- QU-05 10 000 events: no allocation after warm-up.
- CO-01 Journal store round trip; hostile blobs (huge arrays, wrong types, v 2, NaN) are refused or parked; the maximum-bounds blob <= 16 000 chars.
- CO-02 Two-tab merge: union / max; a gift is paid at most once across two tabs.
- CO-03 Gift capsules: <= 3 ever, <= 1 per UTC day, origin 'task', inside TASK_CAPSULE_CAP; when full they wait, never lost.
- CO-04 `probe_collection` 73/74 (C08 known), `probe_collection_imports` unchanged.

**ECON** (node; EC-02 is a heavy job, once)
- EC-01 10-minute party run (5 wholes, 6 pieces, each place, LIFE on, no input): exactly 0 SP, 0 task progress, 0 capsules.
- EC-02 `sim_economy.ts` with the quest source: section C unchanged, section K re-quoted (expected shift <= 1 day).
- EC-03 Shell node check: every `auto` or `prop` event is dropped before `collection.feed`.

**PHYS** (`_harness/probe_playground.ts`, node, `--quick` light; PH-09 heavy, once)
- PH-01 Hops (scoot, hop, big, climb where allowed) for 12 families x 2 genomes, detail-2 wholes and 1/8 pieces: apex within +-30% of target x hop scale,
  no fold > 120 degrees, no second hop, land carries `auto`.
- PH-02 Touch gate: LIFE drivers paused within 1 substep, eased out <= 0.15 s; ceremony drivers unaffected.
- PH-03 Sleep: a resting body sleeps within 1.0 s; asleep cost <= 0.03 ms; wakes on every listed cause; stateHash deterministic with sleep on.
- PH-04 Detail-2 wholes: 50 species rest 3 s with creep <= 2 mm; press, pull and hop rows pass at detail 2.
- PH-05 Ground: pushed at 1 m/s on the Ice Pond, firm silicone glides >= 1.5 m and sticky stretch <= 0.5 m; on sand every family stops sooner than on felt.
- PH-06 Props: penetration <= 2 mm after each substep for sphere, box, capsule; pressing onto a box edge at 2 m/s folds no family > 120 degrees; seesaw,
  swing, cushion, rocker stable 60 s with 3 bodies (finite, energy decays).
- PH-07 Water: density < 1 floats (submerged share within 0.1 of the expected for the 0.42 m depth); density > 1 wades grounded; supported gravity off;
  slosh families slosh; no NaN.
- PH-08 Bounds hold a body hopped at the edge within bounds + 0.1 m.
- PH-09 Perf: the cast of section 6 per tier, props on, two asleep: low <= 3.9 ms, med <= 4.5, high <= 7.2 ms per frame on this container (quiet).
- PH-10 64 bodies made over a session: no swallowed bump.
- PH-11 A scripted place session (props, zones, hops, sleep) has the same stateHash twice.

**RENDER** (`browser_render.mjs` new sections `place`, `props`, `emote`, `marks`; port 5364)
- RE-01 Each place: sky section passes (no seams or bands at 4 aspects x 3 pitches), no blank frame, 0 console errors; body colour identity vs Home
  within the med / low bar (median 9.1, p90 15.8, max 20.6 today).
- RE-02 `cer` and `chains` flash sections pass in every place.
- RE-03 Bubbles: one draw for all; icons >= 3:1 on the bubble; inside the safe insets at 390 x 844 and 320 x 568; Calm = fade only.
- RE-04 Looks at 0 are pixel-identical to v4 on the gallery; each look visible on the low tier.
- RE-05 Lite: background wholes and chunks on med draw <= 2562 fine verts; sleeping bodies do 0 fine-mesh updates.
- RE-06 10 round trips Home and Cove: programs, textures, geometries back to baseline +-2; context loss in a place restores.
- RE-07 <= 110 draw calls on med in the Cove with a full cast.

**AUDIO** (offline harness `life_checks.mjs`)
- AU-01 Output bit-identical to today with chatter and ambience absent and style 'home'.
- AU-02 Chatter never asks for room: the music stem's pumping metrics unchanged (std <= 3 dB, p90 unchanged).
- AU-03 A player effect over chatter: in-band >= 8 dB, K-weighted >= 10 LU.
- AU-04 Every voice pitch on D major pentatonic +-10 cents; pieces >= 1.17 kHz.
- AU-05 Storm: 50 requests /s give <= 2 live chatter groups (1 Calm), peak <= one voice + 3 dB.
- AU-06 Ambience: >= 20 dB under effects in-band (or its own dip); 0 live ambience nodes 0.2 s after pause or mute; two-rate loops (no 2.5 s seam).
- AU-07 <= 4 nodes per syllable; 5000 syllables return to the baseline node count.
- AU-08 No creature voice starts during a ceremony.

**SHELL and UI** (`node_checks.ts` sections with a moving mock body, then `browser_shell.mjs` sections `life`, `travel`, `journal`)
- SH-01 The party survives a capsule ceremony, a merge, a Hoard preview, a cut (the cut one becomes pieces, the others stay) and travel (re-placed on spawn spots).
- SH-02 Stable character ids across re-adds (keyed by item id or body object, never the view id, `maps/SHELL.md:72-74`).
- SH-03 Character caps per tier; a tier drop trims the farthest non-active member, announced.
- SH-04 Escape order; every new DOM overlay in the Snap hide list.
- SH-05 Keyboard only: J, P, arrows, Enter, Esc: read a page, travel to the Cove with a party, grant a wish from Wishes now.
- SH-06 A page-done plate is never within 1 s of a burst nor over a reveal; one polite line each.
- SH-07 Autonomy off: no wander, thing or social intent is applied; reactions and emotes on touch remain.
- SH-08 390 x 844 and 320 x 568: tracker, Places, wish card, Travel and Journal fit, 44 px targets, no overlap with the capsule or the meter ring.
- SH-09 New settings round-trip; absent = defaults; node section 6.
- UI-01 New colour pairs in `CONTRAST_PAIRS`, passing. UI-02 Reduced motion and Calm: bubbles fade only, travel is a crossfade, no camera moves.
  UI-03 Sound off: the voice-to-emote table is total.
- PF-01 G0 gate re-specified: first load <= 1280 KB, total <= 1600 KB, each place chunk within 10.2.

---

## 11. What to cut: the slices and the build order

**S0, an internal milestone: "Life at Home"** (proves the hard parts on today's mat; shippable as a preview). PHYS E9, E7, E8, E10, E11, E13; LIFE
traits, brain, B01-B13, S01-S06 and S11, attention, flock (P01, P02); render gaze, expressions, emote bubbles, lite meshes, sleeper skip; audio creature
voices, chatter bus, limiter, `musicClock`; shell LIFE host, party manager (stable ids, survives ceremony and cut, combined caps), event ring, tracker
pill, a Journal with Chapter 0 only, settings rows; data for Home and all 50 species; the Home things as **static and spring props only** (Puff Cushion,
Music Box, Felt Ball rolling, Felt Ramp, Nap Patch) because E4 and E5 arrive with them; core quests reducer and journal store.

**S1, the first shippable slice: "Fizzwash Cove"** = S0 + the place system (PlaceLook, setPlace, ground mods, bounds, water zone, props with roll, hinge
and float), the Cove's 5 things and 2 zones, looks wet and sand, marks, the Travel sheet, wish cards, page-done and finale moments, the gift capsule
path, ambience bed with the Cove recipe, prop voices (ball, creak, chime, splash), Chapter 1, the squirt game, EC-01 and EC-02.

**S2 "Flurrytop":** ice and wind (mutable drag, gusts), pendulum props (swing, pine branch), frost and snow looks, snow weather particles, crunch, the
peak recipe, Chapter 2. **S3 "Toastwood Cabin":** warm zones and toast, the rocker and kettle, the clock on the music beat, embers, the cabin recipe,
Chapter 3, ceremony audience (B14), peekaboo (S10), per-instance "also likes", Daily Wishes. Stamp, Roll, LOCK and multi-pull, trade and the UI overhaul
stay queued as they are; nothing here designs them away (new screens use the `theme.ts` tokens the UI overhaul will extend).

**Build order and dependencies** (lanes in parallel where the arrows allow):

| step | lane | work | needs |
|---|---|---|---|
| 1 | synthesizer | contract members of 9.3; `places.ts`, `life.ts`, `quests.ts` types and S0 data; `name_gate.ts` | nothing |
| 2a | PHYS | E9, E7, E8, E10, E11, E13 + probe_playground rows PH-01 to PH-04, PH-10, PH-11 | 1 |
| 2b | LIFE | traits, brain, attention, flock, LI-01 to LI-12 against a fake world | 1 |
| 2c | CORE / COLLECTION | quests reducer, journal store, gift grant, QU and CO rows | 1 |
| 2d | AUDIO | creature voices, chatter bus, limiter, musicClock, AU-01 to AU-05, AU-07, AU-08 | 1 |
| 2e | RENDER | gaze, expressions, bubbles, lite meshes, sleeper skip, RE-03 to RE-05 | 1 |
| 3 | SHELL | LIFE host, party manager, event ring, tracker, Journal (chapter 0), settings, Home props wiring; SH-01 to SH-09 | 2a-2e |
| 4 | PHYS | E2, E3, E4, E5, E6 + PH-05 to PH-09 | 2a |
| 5 | RENDER + AUDIO | Cove look, props kit, looks, marks, camera; ambience bed, Cove recipe, prop voices; RE-01, RE-02, RE-06, RE-07, AU-06 | 2d, 2e, 4 |
| 6 | SHELL + ECON | Travel, wishes, moments, gift path, Chapter 1 data; EC-01 to EC-03; then two independent verifiers (physics; shell and play) | 3, 4, 5 |
| 7, 8 | all | S2, then S3, each with its own verifier pass | 6 |

---

## Where I would push back (and still design within the decisions)

1. **D9:** tighten to a first load of 1280 KB and a whole build of 1600 KB. Three places of procedural looks and recipes do not need 860 KB, and a loose
   ceiling invites drift.
2. **D4:** autonomy should cause **zero** haptics, not a budgeted few. Vibration that the player did not cause feels like a notification, and it adds nothing
   a bubble does not already say.
3. **D1** "any touch overrides the brain at once": the brain flips at once, but the physics drivers must ease out over about 0.12 s; a hard cut would pop
   the goal shape under the finger.
4. **D7:** no run-time detail swap for background bodies. Build party members at detail 2 on low and med from the start; a swap at rest pops the body
   upright and ticks the luminance, which a player would see far more often than a slightly coarser background squishy.

**Not checked by me:** any code path beyond the files listed at the top; every millisecond above apart from those quoted from the maps; how detail-2
wholes and lite meshes look; prop contact against real folds; water buoyancy on real bodies; whether a 0.18 m climb hop launches any species past the
fold gate; the bake time of a place's environment; per-chunk sizes; how any voice sounds (nobody has heard the audio yet, `maps/AUDIO.md:219-221`); the
sound-alike and language-safety halves of the name gate.
