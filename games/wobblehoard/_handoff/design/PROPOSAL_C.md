# PROPOSAL C: PLAYGROUND, systems first (lean, robust, ships on a mid-range phone)

Designer C (technical-director angle), 2026-11-15. One complete answer to the eleven questions of `DIRECTION.md` section 5, in order, after a
one-page spine (section 0) that leads with my angle. Read: STATUS, COMMON, SESSION3, DIRECTION (with the 1b owner clarification: at least 8 places
beyond Home), the five seam maps, `_spec/DESIGN.md` 1-7, FUN, CUT, LOCK, UI, REFERENCES, CATALOG, SQUISHY_SCIENCE 4, and the code where cited
(`src/contracts.ts`, `src/data/materials.ts` 436-453, `src/data/species.ts`, `src/core/genome.ts` 140-144, `src/shell/game.ts` 548-562,
`src/shell/boot.ts` 95-97, `src/shell/mat.ts` 22-24, `src/shell/cut.ts` 38-40, `src/core/settings.ts` 108-110, `src/collection/constants.ts` 23-26,
`src/collection/ghost.ts` 183-196, `src/ui/theme.ts` 4-13, `vite.config.ts` 24). I built nothing and ran nothing (section 13 says what I did not check).
Every name here is a proposal until the name and language gates (`_harness/probe_catalog.ts` section 7) pass it.

---

## 0. The spine: the fewest systems that make all five asks true

A phone at 60 fps on `med` has about 6 ms of physics a frame. One awake detail-3 body already costs 0.69 to 0.87 ms on a quiet container and 1.6 to
2.3 ms under load (PHYS map 4 and 6). So the design starts from one fact: **most of the time, most characters must cost almost nothing**, and every
feature is chosen so that it can be true while bodies sleep.

**Ten rules.**
| # | Rule | Why (evidence) |
|---|---|---|
| R1 | **The ground is flat, y = 0, under every play area.** Places differ by per-body ground modifiers (grip, glue, peel, drag), ground patches, props and zones. No height field. Hills are backdrop or a buried static sphere. | A height field is PHYS E1: ~20 sites, supported gravity and tack tuned flat, "large, high risk". Decals, particles, marks, capsule rest and ceremonies all assume y = 0 (RENDER map 1, 6, 7). |
| R2 | **Props are chunky rigid shapes**: 3 primitives (sphere, capsule, box) on 4 joints (fixed, hinge1, slider1, free). Minimum thickness 0.16 m, minimum ball radius 0.20 m. At most ONE free prop (a ball) per place. | Particles-only contact: anything thinner than the mean edge (0.07 m at detail 3, 0.14 m at detail 2) can slip between particles (PHYS map 2). |
| R3 | **Nothing climbs.** Every autonomous use is floor-reachable: lips at most 0.12 m on a capsule edge, seats and pads at floor level. The player lifts squishies onto high things with the existing pick-up and toss. | `moveTo` is a horizontal rigid glide (PHYS map 3); a hop over 4 cm fires `land` into audio and haptics. |
| R4 | **Life is mostly in the eyes.** Gaze, blinks, expressions and bubbles are render-only. Each squishy spends at least 60% of its time in still behaviours, so its body sleeps. | A resting body still costs the full step today (0.69 ms); asleep it should cost ~0.01 ms. |
| R5 | **One brain per squishy, one LIFE world per place, decided in one central step.** A cut squishy keeps ONE brain that steers its pieces as a group. | No messaging, no double booking, pieces add no brains. |
| R6 | **One attention budget** for every autonomous bubble, voice, prop sound and particle. Autonomy never vibrates the phone and never moves the camera. | D4; the audio room-dip trap (AUDIO map 1: autonomous sounds through `registerFx` would hold the music down forever). |
| R7 | **Autonomy can never pay.** LIFE has no intent that reaches `fingerDown` or `grab*`; only player fingers make `poke`, `release`, `snap`. | `collection.feed` pays `release` and `snap` (CORE map 3, SHELL map 1). |
| R8 | **Data is tiny, ship it all; code is lazy.** All place, life and quest data is in the first load (at most 12 KB minified); only each place's render and audio code is a lazy chunk. | No async data paths to test; quests and LIFE can check any place offline. |
| R9 | **Measure, do not guess.** The awake budget is measured physics milliseconds at run time; the static caps (10.1) are upper bounds. | The phone factor is unmeasured (13). |
| R10 | **Node first.** Every rule has a node probe before any browser run (10.4). | The browser harness is slow under SwiftShader; the full render run is 52 min (RENDER map 8). |

**The seven systems** (everything else is content on top of them):
| System | What it is | Lane and files | Slice |
|---|---|---|---|
| S-GROUND | per-body modifiers (grip, glue, peel, drag, density, catch, bounce), ground patches, place bounds | PHYS `softbody.ts` (E2, E3) | S1 |
| S-PROPS | one `PropWorld`: packed shapes, hinge1 / slider1 / free states, impulse accumulators, one-frame-lag two-way coupling, prop raycast and taps | PHYS new `src/physics/props.ts` (E4, E5) | S1 static + hinge1 + ball; S2 slider1 |
| S-ZONES | water (buoyancy + drag), wind, current, magnet as physics; warm, cold, wet, echo as flags for looks, sounds and LIFE | PHYS `props.ts` (E6) + data | S1 flags; S2 water; S3 wind, current, magnet |
| S-MOVE | scoot, hop, glide, lean, wiggle, settle; the touch gate; `auto` on land events | PHYS `softbody.ts` (E7, E8, E9) | S1 |
| S-SLEEP | rest test, freeze, wake rules, sleeper pairs skipped in collide, render mesh skip, detail-2 background wholes chosen at spawn | PHYS (E10, E11) + RENDER | S1 |
| S-LIFE | pure deterministic brains (snapshot in, intents out, zero allocation) + the pure attention budget + voice planning | LIFE `src/life/**` | S1 |
| S-JOURNAL | typed event bus, quest rules over events, pure reducer, journal store under its own key | SHELL bus, CORE `src/core/quests.ts`, COLLECTION `src/collection/journal*.ts`, DATA `src/data/quests.ts` | S1 |

---

## 1. The places

### 1.0 What every place is made of (the shared library)

**The 14 mechanisms.** Every thing in every place is one of these, with data parameters. Two-way coupling: the body's substep pass treats the prop as
kinematic and accumulates the correction it applied; the prop integrates those impulses once per frame after all bodies stepped (PHYS E4/E5).
| # | Mechanism | Shape and joint | Parameters (allowed range, checked by DT-01) | Two-way? |
|---|---|---|---|---|
| M1 | block | box, fixed | size each axis 0.16..3 m, mu 0.3..1.5 | no |
| M2 | bar | capsule, fixed | r 0.08..0.3, length 0.3..3 m | no |
| M3 | mound | sphere, fixed, centre below ground | r 0.6..1.2, top 0.15..0.3 m | no |
| M4 | bowl | 8 to 12 capsules on a ring, fixed | ring r 0.5..0.8, capsule r 0.07..0.1, lip at most 0.12 m, a 50..70 degree gap to the front | no |
| M5 | ramp | box, fixed, tilted | angle at most 16 degrees, mu 0.05..0.6, capsule side rails | no |
| M6 | pool | water zone + a rim of bars + one sloped entry | surface 0.06..0.9 m, entry lip at most 0.12 m | via the zone |
| M7 | seesaw | box on hinge1 (horizontal axis) | pivot 0.12..0.2 m, limit at most 14 deg, I 0.3..0.8, damping 0.6..1.5 /s | yes |
| M8 | swing | capsule seat on hinge1 hung from a pivot | rope 1.2..1.8 m, limit at most 35 deg, damping 0.15..0.4 /s | yes |
| M9 | spinner | disc box on hinge1 (vertical axis), optional motor | r 0.5..0.8, rim lip at most 0.10 m, motor at most 0.4 rad/s (rim at most 0.3 m/s) | yes |
| M10 | chime | small capsule or box on hinge1, strikes a note | note from D major pentatonic, limit 25 deg, damping 0.8 | yes (light) |
| M11 | spring | disc box on slider1 (vertical), active gain | top at most 0.12 m, f 2..4 Hz, gain 1.0..1.25, apex cap at most 0.35 m | yes |
| M12 | floater | box or capsule ring on slider1 in water, wave drive | bob at most 0.04 m at most 0.4 Hz; anchored in x and z (or on a spinner arm) | yes |
| M13 | ball | sphere, free (3 translation, spin is look only) | r 0.20..0.30, mass 0.15..0.4 body masses, roll damping 0.3..1.5 /s, speed clamp 2.0 m/s | yes |
| M14 | switch | a flag on any thing: a tap toggles a zone, a motor, or a sound | toggles only; never moves a body | no |

**The 8 zone kinds** (axis-aligned boxes or discs; strength 0..1):
| Zone | Physics? | Effect |
|---|---|---|
| water | YES | whole-body buoyancy `a_up = g x f_sub / density` (f_sub = submerged share of the bounding sphere), drag 2.5 /s on the velocity relative to the water, supported gravity off when f_sub > 0.15; shallow (surface at most 0.18 m) gives drag and splash only |
| wind | YES | uniform acceleration `catch(family) x strength x 1.2 m/s^2`, gusts by data; below 0.25 m/s^2 it never wakes a sleeper (look-only ruffle) |
| current | YES | water velocity field (a ring), at most 0.2 m/s |
| magnet | YES | pulls bead squeeze bodies only, at most 1.0 m/s^2, falloff 1/(1+d^2) |
| warm | no (flag) | looks (toast, gloss), poses through LIFE, dries soak |
| cold | no (flag) | looks (frost, snow cap), LIFE shiver and speed |
| wet | grip only | wet look, grip x0.8 (sticky stretch and slime x1.0), foams soak |
| echo | no (flag) | audio: every creature syllable gets one scheduled repeat |

**Ground patches**: discs or boxes with their own modifiers (ice, rug, wet sand, moss). The shell reads the patch under each body's centre at 10 Hz
and writes that body's modifiers; physics eases every modifier over 0.3 s (PHYS map 5: write through a Float64Array, never object fields).

**The place frame** (every place): play bounds (disc or rounded rect, at most 7 x 5 m); the **ceremony pad**, a clear disc r 1.2 m at (0, 0) with no
thing in it; 6 spawn spots at least 0.9 m from every thing; a camera box (aim, yaw range, pitch 0.15..0.9, zoom 0.7..1.6); a light preset; a sky
preset; a weather preset; an ambience recipe id; a music style id. Coordinates: x to the right, z negative = away from the default camera
(as `matLayout`'s portrait chevron, `stage.ts` 88).

### 1.1 Home: "The Dusk Mat" (built today; S1 adds its things)
**Look.** Unchanged: the dusk sky dome, the felt mat (`felt #2a2150`) under the amber softbox key and the lagoon rim, evening, no weather. The new
things sit on the back rim (r 2.9 to 3.2 m, z < 0), clear of the `matLayout` slots and the pad. **Ground**: felt, all modifiers 1.0, so every existing
probe row stays valid. **Bounds**: today's corral for mat bodies; a disc r 3.1 m when LIFE drives them. **Zones**: Lamp Glow (warm 0.4, disc r 0.8).
| Thing | Mechanism | You can | They do by themselves |
|---|---|---|---|
| Snooze Basket | M4 bowl, 9 capsules r 0.07 on ring r 0.6, lip 0.12 | Drop or toss a squishy in | A sleepy one curls up; friends pile in |
| Felt Ball | M13 ball r 0.22, mass 0.2, roll damping 0.6 /s | Tap it to roll it | Chase it, bump it, pass it between two |
| Lamp Glow | M1 block 0.3 x 0.6 x 0.3 + warm 0.4 + M14 switch | Tap: dim or bright | Bask in it (sun bubble); marshmallows go faintly golden (toast at most 0.3) |
| Keepsake Shelf | M1 block 2.4 x 0.3 x 0.4 + up to 16 keepsakes (7.9) | Tap a keepsake: it rings or glows and says where it came from | Look at a new keepsake with a sparkle |

### 1.2 Hearthlog Cabin (the owner's forest log cabin; **slice S1**)
**Look.** Inside a small log cabin on an evening deep in the woods. Round-log walls in plum and dusk; a stone hearth whose firelight is the amber key
(warmer than Home); a window at the back where snow falls past dark pines (a backdrop card, flakes only behind the pane) gives the lagoon rim; a
braided rug in coral and cream; warm brown floorboards. Embers drift up from the hearth (additive, cap 24 / 16 / 8, x0.3 in Calm, none with reduced motion).
**Ground.** Boards: grip 0.9, glue 1.0, peel 1.0, drag 1.0, no marks. Rug patch: disc r 1.6 at (0.3, 0.2), grip 1.25, glue 1.1.
**Bounds.** Rounded rect hx 3.4, hz 2.4 about (0, -0.3); log walls (M1, 0.3 m thick, 2.4 m high) on the back and both sides; the front is open with the
existing soft rim bounce (RIM_BOUNCE 0.35). **Zones.** Hearth Warmth: warm 1.0, disc r 1.5 at (-2.3, -1.6). Window Draught: cold 0.3, box 1.8 x 1.2 at (2.6, -2.2).
**Spawn spots.** (-1.6, 0.6), (1.6, 0.6), (0, 1.4), (-0.6, -0.9), (0.9, -0.6), (-2.6, 0.9).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Hearth | M1 block 1.4 x 0.9 x 0.5 at (-2.3, -2.3) + warm zone + M14 switch | Tap: the fire puffs up for 5 s (more embers, crackle) | Bask; marshmallows toast golden, mochi rises, slime oozes flat, slow-rise dries out (2.2) |
| Rocker Board | M7 seesaw at (2.1, -1.2): board 1.6 x 0.16 x 0.6, capsule ends, pivot 0.16 m, limit 12 deg, I 0.45, damping 0.9 | Poke an end to rock it; set squishies on the ends | One scoots onto the low end; two make a teeter (small hops in turn rock it) |
| Yarn Ball | M13 ball r 0.24, mass 0.2, roll damping 0.5 /s, starts at (0.9, 0.9) | Tap to roll it | Chase, bump, pass it between friends; sticky ones carry it a little |
| Cushion Swing | M8 swing, pivot (1.2, 1.9, -2.0), rope 1.75 m, capsule seat r 0.09 x 0.9 at 0.15 m, limit 35 deg, damping 0.25 | Toss a squishy on, poke the seat to push | Push a friend on it (scoot into the seat from behind) |
| Snug Basket | M4 bowl, ring r 0.65, 10 capsules, by the hearth at (-1.0, -1.9) | Drop squishies in | Pile up and nap, warm from the hearth |
| Music Box | M1 block 0.45 x 0.32 x 0.32 at (2.7, 0.4) + M14 switch | Tap: a 4-bar tune in D (the music bed's mallets step aside) | Sway on the beat and sing along in harmony (B09) |

### 1.3 Ripple Shore (the owner's beach; S2)
**Look.** A sandy cove in late-afternoon sun: sky from lagoon at the top to warm cream at the horizon, a deep lagoon sea band at the back with slow white
surf lines, amber-cream sand that turns felt-dark where it is wet, a few dark rocks. The sun is the key (cream-amber, high), sea light the rim. A few
spray motes. Ceremony dim on (7.0 of section 9.6).
**Ground.** Sand: grip 1.35, glue 0.8, peel 0.9, drag 1.1, prints that fade in 40 s. Wet Sand patch (band at the back): grip 1.1, darker prints, wet look 0.4.
**Zones.** Tide Pool (water, surface 0.55 m); Surf Edge (shallow water band at the back, surface 0.10 m rising to 0.18 m on a wave every 7 to 10 s); Sun (warm 0.4, whole place).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Tide Pool | M6 pool, disc r 1.3, rim of rock bars r 0.14, one sloped sand entry 1.0 m wide | Toss squishies in, poke them under | Scoot in by the entry; float, bob, splash; heavy ones sit on the bottom |
| Bob-Ring | M12 floater in the pool: 8 capsules r 0.08 on ring r 0.45, bob 0.03 m at 0.3 Hz | Drop a squishy on it | Float over and rest on it |
| Driftwood Log | M2 bar r 0.18, length 2.0 | Roll squishies along it | Peekaboo over it, lean on it in pairs |
| Shell Chimes | M10 chime x5 (capsules r 0.08 x 0.2) on a post, notes D5 E5 F#5 A5 B5 | Tap each shell | Bump past them and play a little tune; the sea breeze rings them |
| Pebble Ball | M13 ball r 0.22, mass 0.3, roll damping 1.2 /s (sand) | Tap to roll it | Pass it; it stops sooner in the sand |
| Sand Mound | M3 mound r 0.9 centred at y -0.65 (top 0.25 m) | Set a squishy on top: it slides off | Lean against it; jelly and gummy slide off fastest |

### 1.4 Frostbell Ridge (the owner's snowy mountain; S2)
**Look.** A high snowy ledge on a clear, cold morning: pale lagoon sky to cream at the horizon, a low sun (cream key, long light), dusk-blue shadows,
mountain silhouettes, packed snow with a band-limited sparkle, a frozen pond with a dark gloss, a little steaming pool. Flakes drift (normal blend,
cap 80 / 60 / 30). Ceremony dim on.
**Ground.** Packed snow: grip 1.0, glue 0.9, drag 1.05, prints fade in 90 s; a snow cap builds on still bodies (0 to 0.3 over 10 s). Ice Pond patch:
disc r 1.4, grip x the family ice factor (2.1), drag 0.25, no prints.
**Zones.** Mountain Cold (cold 0.6, whole place); Steam Pool (water surface 0.45 + warm 1.0); Wind Gap (wind gusts across the back third every 9 to 14 s for 2 s, strength 0.6).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Ice Pond | ground patch (flat) | Flick squishies across it | A scoot turns into a long glide; firm ones zoom, sticky ones barely move |
| Glide Ramp | M5 ramp 2.0 x 0.16 x 0.9 at 14 deg, top 0.55 m, mu 0.1, rails | Set a squishy at the top | Slide down onto the ice when set there; the others watch and cheer |
| Steam Pool | M6 pool r 1.0, warm | Toss squishies in | Scoot in, float, the frost melts off |
| Icicle Bells | M10 chime x4, notes A4 D5 E5 A5 | Tap each one | Ring them when they pass; the wind gusts ring them too |
| Snowdrift Nest | M4 bowl, snow look | Drop squishies in | Pile up and nap out of the wind |
| Snowball | M13 ball r 0.25, mass 0.35, roll damping 0.6 /s | Tap to roll it | Push it to a friend |

### 1.5 Puddlebrook Garden (S2)
**Look.** A corner of a garden in soft rain at dusk: giant leaves overhead (backdrop cards, one real drip leaf), dark loam, puddles that mirror the plum
sky, coral mushroom caps, grey stepping stones. Rain streaks (normal blend, cap 120 / 80 / 40); showers come and go (40 s on, 30 s off). Dim cream key, lagoon rim.
**Ground.** Damp loam: grip 0.85, wet trails that fade in 20 s. Puddle patches x3: shallow water, surface 0.08 m.
**Zones.** Rain (wet, whole place, shower envelope); Puddles (shallow water); Leaf Drip (wet 1.0 under the drip leaf).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Puddles | M6 pool, shallow, discs r 0.6..0.9, no rim | Toss a squishy in for a big splash | Hop into puddles (puddle jumps), splash |
| Leaf Teeter | M7 seesaw, leaf 1.8 x 0.16 x 0.8 on a pebble pivot 0.16 m, limit 10 deg | Poke an end | Teeter in pairs |
| Mushroom Bouncer | M11 spring, cap r 0.45, top 0.12 m, 3 Hz, gain 1.2, apex cap 0.3 m | Drop a squishy on it | Scoot on, hop once, bounce higher and higher (at most 5 bounces) |
| Drip Leaf | M1 block (stalk) + wet zone + M14 switch | Tap: the leaf tips a shower | Stand under it for a shower; foams soak and squirt |
| Stepping Stones | M1 block x4, 0.5 x 0.16 x 0.4 in a line | Line squishies up on them | Follow the leader along the stones |
| Seed Pod | M13 ball r 0.2, mass 0.15, rattles | Tap to roll it | Roll it, chase it |

### 1.6 Fizzwell Tub (S3)
**Look.** Inside a big old bathtub at lamplight: a copper tap and plum enamel walls at the back, warm water in deep lagoon with a soft caustic shimmer,
foam islands, rising bubbles (normal-blend spheres, cap 40 / 30 / 15), steam at the top. Amber lamp key, lagoon rim from the water. Bodies below the
surface get the underwater tint (9.6).
**Ground.** Tub floor (all under water): grip 0.7, glue 0.8. **Zones.** Bath (water, surface 0.9 m over the whole play area: light families float, heavy
ones rest on the floor); Tap Swirl (current ring r 1.0 around the tap, 0.15 m/s, while the tap runs); Warm Water (warm 0.6).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Bob Boat | M12 floater on an M9 spinner arm (r 1.0) driven by the swirl | Drop a squishy in it | Float to it and ride round the tub |
| Soap Slide | M5 ramp from the rim, mu 0.05 | Set a squishy at the top | Slide down with a splash when set there |
| Sponge Raft | M12 floater 1.0 x 0.2 x 0.7 | Drop squishies on it | Rest on it; foams on it soak, others dry |
| Bubble Patch | wet zone + bubble particles | Poke squishies through it | Float in it and fizz (bubble bubbles, giggly trills) |
| Tap | M1 block + M14 switch | Tap: run the water (swirl and bubbles on or off) | Drift round on the swirl |

### 1.7 Cogwhistle Bench (S3)
**Look.** A tinker's workbench at night under one brass desk lamp: a dark wood top with grain, a felt pad, cogs and springs, a pegboard in plum, the
lamp's amber cone as the key, a cool lagoon window glow as the rim; dust motes in the cone (additive).
**Ground.** Bench top: grip 1.0, dust prints fade in 15 s. Felt Pad patch: grip 1.3. **Zones.** Magnet Field (magnet 0.8, disc r 1.2: bead squeeze
only); Lamp Warm (warm 0.5 in the cone footprint).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Spinning Cog | M9 spinner r 0.7, rim lip 0.10 m, motor 0.25 rad/s while wound | Wind it, set squishies on it | Scoot on and ride round; get a little dizzy (swirl) |
| Wind-up Key | M1 block + M14 switch | Tap: winds the cog for 30 s | Watch it turn |
| Spring Plate | M11 spring r 0.4, top 0.10 m, 4 Hz, gain 1.1, apex 0.25 m | Drop a squishy on it | Scoot on, boing |
| Horseshoe Magnet | M1 block + magnet zone | Tap: magnet on or off | Bead squeezes roll to it and rattle; the rest look puzzled |
| Marble Ramp | M5 ramp 12 deg with rails, mu 0.2 | Set a squishy at the top | Roll down when set there |
| Brass Bell | M10 chime, one bell, note D5 | Tap it | Bump it: ding |

### 1.8 Lanternroof (S3)
**Look.** A flat rooftop terrace on a clear moonlit night: ink sky with slowly twinkling stars (shader, no flashing), a big pale cream moon, city
silhouettes far below in dusk, a string of paper lanterns in amber and coral as the warm key, the moon as the cool rim, a chimney breathing warm air.
**Ground.** Roof tiles: grip 1.1, no marks. **Zones.** Night Breeze (wind gusts every 6 to 10 s for 2.5 s, strength 0.8); Chimney Warmth (warm 0.8, disc r 1.0); Moon Puddle (shallow water 0.06 m).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Lantern Line | M10 chime x5 low lanterns, glow brighter when bumped, notes D5..B5 | Tap each lantern | Bump them as they pass: glow and ping |
| Vane Disc | M9 spinner r 0.6, no motor, turned by gusts | Push it round | Ride it when the breeze turns it |
| Clothesline Hammock | M8 swing | Toss a squishy in, push | Push a friend |
| Chimney Nook | M4 bowl in the chimney warmth | Drop squishies in | Pile up and nap in the warm |
| Moon Puddle | M6 pool, shallow | Toss a squishy in | Sit by it and gaze at the moon (moon bubble) |
| Skylight Cushion | M11 spring, soft, gain 1.15 | Drop a squishy on it | Boing |

### 1.9 Echo Hollow (S3)
**Look.** A hollow under the hill lit only by crystals: walls in ink and plum, crystal clusters glowing lagoon and dusk-violet, a glow pool that throws
light ripples, drips that catch the light, slow glow motes (additive). A rock dome instead of a sky. Crystal light is the key (lagoon), a crack of
daylight the amber rim.
**Ground.** Smooth stone: grip 0.8, drag 0.95, wet trails fade in 25 s. Glow Moss patch: grip 1.2, glowing prints fade in 10 s.
**Zones.** Echo (whole place, audio); Cave Cool (cold 0.3); Glow Pool (water surface 0.4: floating bodies get +0.3 core glow); Drips (wet spots x3).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Singing Crystals | M1 block x5 (0.3 x 0.6 x 0.3) in a row, each rings D5 E5 F#5 A5 B5 when bumped | Tap them in turn: a tune | Scoot along the row and play a scale |
| Glow Pool | M6 pool r 1.1 | Toss squishies in | Float and glow brighter |
| Stone Slide | M5 ramp 14 deg, mu 0.15 | Set a squishy at the top | Slide down when set there |
| Pebble Bowl | M4 bowl | Drop squishies in | Pile up and nap |
| Echo Stone | M1 block + M14 switch | Tap: for 20 s every voice echoes twice | Call into the cave and answer the echo |

### 1.10 Cloudloft (S3)
**Look.** On top of the clouds at sunrise: sky from dusk-violet down to amber at the horizon, a low warm sun (amber key), a cream rim, a cloud floor
with a soft sheen, drifting wisps (normal blend), a banded arch in amber, coral and lagoon at 60% chroma (not pastel). Ceremony dim on.
**Ground.** Cloud: grip 0.8, glue 0.6, peel 0.6, drag 1.15, soft dents fade in 6 s. **Zones.** Updraft (wind with a vertical part, disc r 1.0,
strength 0.9 up); Breeze (gusts 0.4); Sun (warm 0.4).
| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Puff Pads | M11 spring x3, soft, 2.5 Hz, gain 1.25, apex cap 0.35 m, in a triangle 1.4 m apart | Drop squishies on them | Bounce, and once in a while bounce from pad to pad |
| Updraft | wind zone (vertical) + swirl look | Toss a light one into it | Marshmallows lift and hover; heavy ones just feel lighter |
| Kite Swing | M8 swing | Toss a squishy on, push | Push a friend |
| Rainbow Arch | M2 bar x3 (r 0.16) forming an arch | Toss squishies through it | Parade under it |
| Cloud Nest | M4 bowl | Drop squishies in | Pile up and nap |

### 1.11 What a tenth (or eleventh) place costs
Example: **Toasty Counter**, a kitchen counter with a flour-dusted top (grip 1.3, white prints), a warm oven door (warm 1.0), a cold fridge shelf
(cold 0.5), a mixing bowl (M4), a rolling pin (M13 with a capsule shape flag; it pairs with FUN's Roll tool later), cookie-cutter stamps (M1 x3).
Cost: **data** about 1.5 KB (ground, 2 zones, 5 things, 6 spawn spots, camera, presets, 10 quest lines); **render chunk** at most 45 KB (sky and light
presets, a ground shader variant from the shared noise, 3 backdrop cards, the shared prop kit); **audio recipe** at most 6 KB (3 or 4 layers from
existing blocks); **no physics code, no LIFE code, no quest code**. The per-place probe rows (DT-01..06, RD-01..03, AU-06) run on it automatically.
About 2 engineer-days of content plus one browser pass.

---

## 2. "In their own way"

### 2.1 The per-family numbers (new table `FAMILY_REACT` in `src/data/life.ts`; `MATERIAL_FAMILIES` is not touched, probe_materials 34-37)
P = physics, L = look, S = sound, B = behaviour (LIFE). Density is relative to water (below 1 floats; equilibrium submerged share = density).
| Family | density P | soaked density P | wind catch P | ice grip factor P | spring gain P | soak rate /s L,P | warm pose B,P (squash) | cold B | print depth / life L |
|---|---|---|---|---|---|---|---|---|---|
| slowrise | 0.35 | 0.90 | 0.8 (0.3 soaked) | 0.35 | 0.5 | 0.18 | 1.0, dries 0.1 /s | slower (scoot x0.6) | 0.7 / 12 s |
| marshmallow | 0.25 | 0.40 | 1.0 | 0.30 | 0.6 | 0.06 | 1.0, toasts | fluffs, frost x0.5 | 0.4 / 6 s |
| mochidough | 1.05 | 1.05 | 0.2 | 0.40 | 0.45 | 0.03 | 1.06 (rises) | stiff (scoot x0.7) | 0.8 / 40 s |
| jellygel | 0.97 | 0.97 | 0.35 | 0.15 | 1.1 | 0 | 0.90 (relaxes) | shivers | 0.25 / 8 s |
| waterfill | 0.95 | 0.95 | 0.25 | 0.15 | 1.0 | 0 | 1.0, steams | shivers | 0.2 / 6 s |
| putty | 1.25 | 1.25 | 0.1 | 0.45 | 0.4 | 0 | 0.95 (softens) | stiff (scoot x0.7) | 1.0 / 120 s |
| stickystretch | 0.93 | 0.93 | 0.15 | 0.70 | 0.6 (sticks 0.4 s) | 0 | 0.92 (sags) | shivers | 0.4 / 20 s |
| slimegoo | 1.08 | 1.08 | 0.1 | 0.80 | 0.5 (sticks 0.6 s) | 0 | 0.80 (oozes flat) | slow ooze (x0.5) | 0.6 / 30 s trail |
| firmsilicone | 1.15 | 1.15 | 0.3 | 0.08 | 1.25 | 0 | 1.0 (basks) | zippy (x1.15) | 0.15 / 5 s |
| popdome | 0.60 | 0.60 | 0.6 | 0.10 | 1.2 | 0 | 1.0 (basks) | zippy (x1.15) | 0.15 / 5 s ring |
| gummy | 1.12 | 1.12 | 0.3 | 0.12 | 1.15 | 0 | 0.90 (glossy) | shivers | 0.25 / 8 s |
| beadsqueeze | 1.45 | 1.45 | 0.15 | 0.25 | 0.8 | 0.02 | 1.0 (basks) | clinky rattle | 0.6 / 30 s bumpy |

Rules that keep this robust: **no run-time stiffness or damping change** (PHYS E12 needs every family re-gated; cut). Physics reactions use only four
channels: water (density, drag), ground modifiers (ice factor, grip, wet), field forces (catch, magnet) and the spring gain. The poses are
`setSquash` targets eased over 1.5 s (volume preserved by construction). Everything else is a look uniform (frost, wet, sand, toast, snow; RENDER
map 3) or a sound. A pose is ended by any touch, and putty and mochi poses are capped at 20 s so plastic memory never captures them (PHYS map 7).

### 2.2 Reaction table A: water, rain, warmth, cold, ice (12 families x every place's zones)
| Family | Deep water (pools, bath) | Shallow water, puddles, surf | Rain, drips, spray | Warmth (hearth, sun, steam, chimney, lamp) | Cold (snow, draught, cave) | Ice, soap, slick floors |
|---|---|---|---|---|---|---|
| slowrise | floats high P, soaks and sinks lower over 6 s P, squirts when you squeeze it L S | soaks from the bottom L, soft plip S | soaks, darker L; drips when squeezed L | dries out L, sleepy bask B | rises even slower B, frost on top L | short glide P |
| marshmallow | floats highest and bobs P, goes soggy L | barely wets L, puff S | soggy and dark L | toasts golden, never burnt L, sizzle-pop S | fluffs up, little frost L | short glide P |
| mochidough | sinks slowly, sits on the bottom P, tacky look L | squelchy steps S, wet print L | shiny and tacky L | rises like dough P (pose 1.06) | stiff and slow B, matte L | sticky, short glide P |
| jellygel | floats low, mostly under P, glows through the water L | wobbly splash L S | water beads on the gloss L | relaxes a bit flatter P, extra gloss L | shivers P (wiggle 7 Hz), frosty rim L | glides far P |
| waterfill | floats just under, sloshes for long P, clear water in water L | sloshy splash, glug S | drops run down the skin L | steam wisps L | shivers P, slow slosh L | glides and sloshes P |
| putty | sinks and sits P, dull gloss L | deep long print L, thup S | keeps drip dimples L | softens, sags a little P | stiff and slow B | barely slides P |
| stickystretch | floats low P, sticks to floaters P (tack) | sticks, peel sound S | drops cling to it L | sags, stringier L | shivers P | clings, hardly slides P |
| slimegoo | sinks slowly, spreads on the bottom P | oozes a wet trail L | glossier, drippy S | oozes flat P | slow ooze B | hardly slides, leaves a trail P L |
| firmsilicone | sinks, bounces off the floor P | skips and splashes S | water beads off L | basks B | zippy B | fastest glide P |
| popdome | floats upright like a cap P | plink splash S | water rings on top L | basks B | zippy B | fast glide P |
| gummy | sinks slowly P | chewy splash S | shiny L | glossy and relaxed P L | shivers P | glides P |
| beadsqueeze | sinks fast, rattles on the floor P S | crunchy splash S | rattly drips S | basks, softer rattle S | crisp, clinky rattle S | spins and rattles P S |

### 2.3 Reaction table B: soft ground, wind, bouncers, rides
| Family | Sand, snow, cloud, dust, moss prints | Wind, gusts, updraft | Spring pads (mushroom, plate, puffs, cushion) | Rides (seesaw, swing, spinner, floater, boat) |
|---|---|---|---|---|
| slowrise | slow print that rises back L | drifts when dry P, stays put soaked P | sinks in, small boing P | sinks into the seat, rides calmly L |
| marshmallow | light quick print L | drifts and tumbles P; hovers in the updraft (0.3 m) P | soft boing P | bounces off the end of a seesaw P |
| mochidough | deep print for 40 s L | stays put, ruffle L | thud, little boing P | sits heavy, rocks the seesaw down P |
| jellygel | quick shiny print L | leans and wobbles P (lean via LIFE) | good boing, long wobble P | wobbles all the way round L P |
| waterfill | wet print L | sways, sloshes P | sloshy boing P | sloshes on every swing P (existing slosh) |
| putty | deepest print, lasts 2 min L | stays put L | thud, no boing P | takes the seat's shape for a while P (memory) |
| stickystretch | sticky print L | clings to the ground P | sticks to the pad, then peels off with a thwop P S | sticks to the seat, never falls off P |
| slimegoo | wet trail L | clings P | sticks, slow peel P S | slides off slowly P |
| firmsilicone | faint print L | leans P | best boing, highest P | bounces off the ends P |
| popdome | ring print L | slides like a cap P; lifts 0.1 m in the updraft P | high boing P | rides upright P |
| gummy | quick print L | leans P | quick high boing P | bounces a little P |
| beadsqueeze | bumpy print L | stays put, rattles S | rattly boing P S | rattles on every turn S |

### 2.4 Reaction table C: balls, nests, chimes, magnets
| Family | Balls | Nests and baskets (nap) | Chimes, bells, crystals, lanterns | Magnet |
|---|---|---|---|---|
| slowrise | nudges it gently B | sinks in and naps longest B (energy refill x1.5) | pats them softly, quiet ring S | looks puzzled B |
| marshmallow | nudges it gently B | squashes into a pillow P | soft pat S | looks puzzled B |
| mochidough | stops it dead P | settles heavy, keeps the basket print P | dull tap S | looks puzzled B |
| jellygel | chases it, hops into it B P | piles on top of others P | clear ring S | looks puzzled B |
| waterfill | chases it, sloshes B P | sloshes to sleep L | ring with a glug S | looks puzzled B |
| putty | sits on it P | takes the basket's shape P | dull tap S | looks puzzled B |
| stickystretch | carries it a little (high prop friction) P | sticks to a friend in the pile P | sticks, then ticks off S | looks puzzled B |
| slimegoo | slows it down P | oozes over the edge, a little P | wet tap S | looks puzzled B |
| firmsilicone | boinks it far B P | bounces in, settles last B | loudest ring S | looks puzzled B |
| popdome | boinks it B P | sits in it like a lid P | bright ring S | looks puzzled B |
| gummy | chases it first B | piles on top P | chewy ring S | looks puzzled B |
| beadsqueeze | rolls with it B | settles with one rattle S | rattly ring S | rolls to it and rattles P S |

### 2.5 Which places have which channels (so the tables cover every place by construction)
| Place | deep water | shallow | wet | warm | cold | ice/slick | prints | wind | spring | rides | ball | nest | chimes | magnet | echo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | | | | x | | | | | | | x | x | x (keepsakes) | | |
| Hearthlog | | | | x | x | | | | | x | x | x | (music box) | | |
| Ripple Shore | x | x | x | x | | | x | | | x | x | | x | | |
| Frostbell | x | | | x | x | x | x | x | | | x | x | x | | |
| Puddlebrook | | x | x | | | | x | | x | x | x | | | | |
| Fizzwell | x | | x | x | | x | | | | x | | | | | |
| Cogwhistle | | | | x | | x | x | | x | x | | | x | x | |
| Lanternroof | | x | | x | | | | x | x | x | | x | x | | |
| Echo Hollow | x | | x | | x | x | x | | | | | x | x | | x |
| Cloudloft | | | | x | | | x | x | x | x | | x | | | |
DT-06 checks that every family has at least 3 non-empty reactions in every place (counting the cells above for that place's channels).

### 2.6 Favourites and best friends (deterministic, discovered by the player)
**Favourite place** (authored, 50 rows, `satisfies Record<SpeciesId, PlaceId>`; every place has at least 4 species and at least 1 Common, DT-03):
| Place | Species (Common first) |
|---|---|
| Hearthlog Cabin | dollop, crimpo, thumbly, capnap, hushpuff, pastrel |
| Ripple Shore | puddlo, crumbit, tadpolo, swishel, granulo, tidelume |
| Frostbell Ridge | boingle, hooplet, diademo, caromel, constello |
| Puddlebrook Garden | munchip, sproutle, wrigglo, acornel, petalop, marigel |
| Fizzwell Tub | plumpet, glugbean, gloopsy, rattlebead, glimglop |
| Cogwhistle Bench | cushlet, kneadle, burrbin, thudge, flipdome, fossilo |
| Lanternroof | chunkle, zingle, taffelin, selenuff, somnuff, skeinara |
| Echo Hollow | dimpla, knubby, spirelo, cindergoo, ambrosel, prismelo |
| Cloudloft | twangle, wisplet, nuzzo, slumbrel |
Dollop, the starter, loves Hearthlog: the first discovery happens in the first ten minutes (7.10).

**Favourite thing** (derived): the first thing in its favourite place whose mechanism comes earliest in its family's list; ties by thing order.
slowrise: bowl, floater, swing, block. marshmallow: bowl, spring, swing, ball. mochidough: bowl, seesaw, block, ball. jellygel: spring, ball,
seesaw, swing. waterfill: pool, floater, swing, chime. putty: block, bowl, ramp, seesaw. stickystretch: swing, ball, ramp, spinner. slimegoo: ramp,
pool, bowl, block. firmsilicone: spring, ramp, ball, spinner. popdome: spring, chime, spinner, floater. gummy: ball, spring, seesaw, chime.
beadsqueeze: chime, spinner, ball, block. (DT-03 checks every species resolves to a real thing.)

**Best friends**: 25 authored pairs, all cross-lane, tier gap at most 1 (a Common's friend is a Common):
| Tier | Pairs |
|---|---|
| Common (7) | dollop + crimpo; plumpet + wisplet; twangle + chunkle; puddlo + boingle; glugbean + thumbly; crumbit + cushlet; munchip + dimpla |
| Uncommon (5) | nuzzo + capnap; tadpolo + swishel; granulo + sproutle; wrigglo + knubby; acornel + hooplet |
| Uncommon + Rare (1) | kneadle + burrbin |
| Rare (4) | spirelo + diademo; zingle + gloopsy; petalop + marigel; hushpuff + thudge |
| Rare + Epic (1) | slumbrel + caromel |
| Epic (3) | taffelin + cindergoo; rattlebead + pastrel; selenuff + flipdome |
| Legendary (2) | ambrosel + fossilo; tidelume + glimglop |
| Legendary + Mythic (1) | somnuff + constello |
| Mythic (1) | skeinara + prismelo |
**Instance twist**: `mulberry32(genome.seed ^ 0x6c1fe0a7)` (a new salt, not one of the three in CORE map 1) picks one "secret second favourite thing"
from any place, discovered later (bit 15 of 7.8). Traits and favourites are pure functions of the genome, so a traded or merged squishy carries them.

---

## 3. Life

### 3.1 Traits (pure function of the genome; never stored)
| Trait | Formula (all clamped 0..1; `t` = seeded twist +-0.08) | Shown to the player as |
|---|---|---|
| playful | 0.15 + 0.85 x bounce + t | "Bouncy" |
| steady | firmness + t | "Steady" |
| curious | 0.1 + 0.9 x stretch + (eyeStyle wide: 0.15) + t | "Curious" |
| cuddly | 0.6 x size + (eyeStyle oval: 0.25) + 0.15 x feelOf().tacky + t | "Cuddly" |
| sleepy | (eyeStyle sleepy: 0.5) + 0.3 x (1 - bounce) + 0.2 x feelOf().slowRise + t | "Sleepy" |
The Journal page shows the top two words ("Bouncy and curious"). The signature touch (catalog `signature`) is the touch it loves most.

### 3.2 Needs and moods
Three needs, each 0..1 in `Float32Array`s: **energy** (falls 0.010 /s while moving, 0.002 /s still; rises 0.05 /s napping), **company** (hunger:
rises 0.004 /s alone, falls 0.15 per greet and 0.3 per nuzzle or song), **curiosity** (hunger: rises 0.006 /s, x1.5 in a new place; falls 0.3 per new
thing used, 0.1 per old one). Mood is derived, never stored: **sleepy** (energy < 0.25), **lonely** (company > 0.8), **restless** (curiosity > 0.8),
**happy** (all needs under 0.6 and a positive event in the last 30 s), **sulky** (B12 only), else **content**. Tuned so a 5-minute visit shows per
squishy about 1 nap, 3 or 4 greets and 2 or 3 thing uses (LF-09 measures it).

### 3.3 Behaviours (utility scoring; argmax with +0.15 for the current one; ties by behaviour id, then character index)
| Id | Behaviour | Trigger (gate) | Score | Lasts | Moves? | Shows | Ends |
|---|---|---|---|---|---|---|---|
| B01 | Rest | always | 0.20 | 3..8 s | no (sleeps) | breathing, blinks | a higher score |
| B02 | Look about | always | 0.25 + 0.3 curious | 2..5 s | no | gaze to the nearest interesting point; the camera 20% of the time | time |
| B03 | Notice | a thing or squishy within 2.0 m not seen this visit; the ball moving nearby | 0.9, once per target per visit | 1.5 s | no | gaze, wide eyes, "question" or "oh" | time |
| B04 | Wander | curiosity > 0.4 and a mover token | 0.3 + 0.5 x curious x curiosity | 4..10 s | scoot 0.8..2.0 m | gaze ahead | arrival, or blocked for 2 s |
| B05 | Greet | another within 1.6 m, this pair not greeted for 90 s, company > 0.3 | 0.8 + 0.06 x friend points (max +0.3) | 2.5 s | lean to face, one small hop | "hello" ripple; call and answer | done; Social GREET |
| B06 | Nuzzle | pair at 2 hearts (best friends at 1), both free | 0.6 + 0.4 cuddly | 3..6 s | scoot to touch (gap 0.03 m), lean in 0.08 R, wiggle 3 Hz | heart (twin hearts for best friends), purr | time; Social NUZZLE |
| B07 | Copy | saw a squishy hop or use a thing in the last 6 s | 0.5 + 0.4 playful | as the leader's | as the leader's | star or swirl, chirp | done; Social COPY |
| B08 | Play with a thing | curiosity > 0.5, or its favourite thing is here | 0.5 + 0.5 curiosity + 0.3 (favourite) + affinity/3 | 6..20 s | scoot to the use spot, then the mechanism use (3.4) | per mechanism | time, or energy < 0.3; Use event |
| B09 | Sing together | the music box is on, or 2+ happy squishies within 2.5 m at a music field change; at most once per 2 min per place | 0.7 | 2 bars (7.3 s at 66 BPM) | sway on the beat | notes; hums in harmony (5.3) | 2 bars; Social SING |
| B10 | Pile up and nap | energy < 0.25 (0.35 in night places), a bowl here or a sleeping friend | 0.8 + 0.4 sleepy | 30..90 s | scoot into the bowl or beside the sleeper, settle | sleepy eyes; one zzz at the start only | energy > 0.9, a touch, a toss nearby; Social PILE |
| B11 | Comfort | a sulking squishy within 3 m, cuddly >= 0.4, at least 1 heart | 0.9 | 4 s | scoot to touch, lean in | "cuddle" then "all better" on both | the sulk ends; Social COMFORT |
| B12 | Sulk | its wish showed 3 min unnoticed, or its best friend just left for another place; once per 10 min | 0.6 | at most 60 s | scoot 0.5 m aside, turn away | little raincloud, low coo | a squeeze held 0.4 s or more, a comfort, a tap on its wish, or 60 s |
| B13 | Show a wish | a need > 0.8 not met here (7.7), no open wish of its own, at most 3 open | 0.7 | until granted | no | thought bubble with the wish icon | granted (sparkle) or the session ends |
| B14 | Follow the leader | 3+ awake-able squishies, a leader with playful >= 0.6 | 0.5 | 10..20 s | leader scoots a loop, the others follow 0.7 m apart | star on the leader, a chirp at each turn | loop done; Social PARADE |
| B15 | Watch the player | the player touches another squishy within 3 m | 0.6 | while the touch lasts | no | gaze at it; "oh" once if it is tossed | the touch ends |
| B16 | Cheer | a quest completes, a capsule lands, a friend arrives (shell-scripted) | 1.0 | 1.2 s | one small hop | star or sparkle, trill | done |
| B17 | Zone reaction | first entry into a warm, cold, wet, water or wind zone this visit | 0.95, once per zone per visit | 2..4 s | the family pose (2.1) | sun, flame, snowflake, droplet or bubbles | done; React event |
Cooldowns per character live in a `Float32Array(n x 17)`; greet cooldowns per pair in a `Float32Array(16 x 16)`.

### 3.4 How a squishy moves by itself (PHYS drivers; every one paused by the touch gate)
| Primitive | Exact recipe | Cost and safety |
|---|---|---|
| **Scoot** (default) | `moveTo(target, 0.08)` (at most 0.24 m/s) + `setSquash` sway 2.5 Hz +-5% (an inchworm) + `lean` 0.05 R toward travel. Speed x the family cold factor (2.1). | no airtime, no events; the glide is not in V, so the rest test also checks drivers (PHYS map 4) |
| **Hop** | anticipation `setSquash(0.82, 0.12 s)`, then `hop(vx <= 0.4, vy 0.75, vz)` (apex 2.8 cm) with glue and peel suspended for 10 substeps; in the air the squash eases to 1.08, landing is physics. Autonomous apex at most 3.5 cm (vy <= 0.84 m/s), so the land speed stays under the 0.9 m/s `land` threshold. At most one hop per 0.8 s per body; putty and mochi at most one per 6 s. | no land event by construction; spring pads that launch higher mark their landings `auto` |
| **Glide** | on a patch with grip under 0.5: `nudge` 0.6..1.0 m/s horizontal, then friction carries it | the ice and soap fun is real momentum |
| **Lean** | goal shear toward a point, at most 0.1 R (PHYS E8) | a shear, not a rotation (the righting torque fights a rotation) |
| **Wiggle** | goal sway 2..4 Hz at most 0.05 R (sing, nuzzle); 7 Hz 0.015 R for 0.5 s (shiver) | `tremble` is fixed at 17 Hz, so this is new |
| **Settle** | release every driver; physics sleeps after the rest test | |
**Mechanism uses**: bowl: scoot in, settle. seesaw: scoot onto the low end; with a partner, small hops in turn rock it. swing: push it (scoot into
the seat from behind); ride only when the player puts it there. spinner: scoot on over the lip (at most 0.10 m), ride. spring: scoot on, one small
hop, the pad's gain does the rest (at most 5 bounces). ball: scoot or hop into it, chase. floater: float to it inside a pool, rest. chime: bump past it.
ramp: cannot climb (R3), watch and cheer at the bottom; slide when the player sets it at the top. pool: scoot in by the entry, float. switch:
player only. block, bar, mound: lean on it, peekaboo behind it.

### 3.5 What the player's touch does to the brain
Instant: the physics gate (E9) eases out every LIFE driver within 0.1 s while `fingers > 0 || grabbed || carried`; the host drops that character's
queued actions; the brain enters **Held** (gaze follows the pointer as today; no autonomous bubble or voice from it). On release: if the touch kind
matches its signature touch, a heart or sparkle (60% chance, through the budget at P2), warmth +1 (at most 5 per squishy per day), and the first time
a discovery ("Dollop loves a squeeze"). A toss gives a "whee" swirl; three tosses within 20 s give "a little dizzy" and 5 s of rest. **Play never
causes a sulk.** After a touch, 1.5 s of grace before new LIFE motion, so the player can keep playing. With the Autonomy setting off, LIFE keeps
only gaze, blinks, expressions and wish bubbles.

### 3.6 Keeping squishies inside the place
Three layers: (1) physics `setBounds` (disc or rounded rect) with the existing rim bounce, replacing the home-spot corral for LIFE-driven bodies
(PHYS E3: the corral would glide a wanderer back home at 0.35 m/s); (2) LIFE never targets a point outside the bounds shrunk by R + 0.2 m, or
inside a thing's footprint except its use spot; (3) walls are static boxes. The camera box always contains the bounds. LF-06 and PH-02 check it.

### 3.7 When LIFE pauses (motion and voices; gaze keeps working)
A ceremony, the Hoard open, the Travel or Journal sheet open, the Snap tool (poses freeze for the photo), the Cut tool in hand and every cut neck or
join (pieces stay under the blade), a hidden tab. Calm effects do not pause it; they lower the caps (5.4).

---

## 4. Social play

### 4.1 Pair and group interactions
| Interaction | Starts | Emote | Voices | Physics | Ends | Friendship points |
|---|---|---|---|---|---|---|
| Greet | B05 | "hello" ripple on both | A: chirp + coo; B answers 0.35..0.7 s later, same rhythm, contour mirrored | lean to face, one small hop | 2.5 s | +1 (once per pair per visit) |
| Nuzzle | B06 | heart / twin hearts | purr, purr back | scoot to touch, lean in, wiggle 3 Hz | 3..6 s | +2 |
| Copy | B07 | star on the copier | chirp at the leader's pitch +1 step | the same action | action done | +1 |
| Pass the ball | two within 2.5 m of the ball, one playful | ball | chirp at each touch of the ball | scoot or hop into the ball toward the partner | 3 passes or the ball stops | +1 |
| Teeter | two on one seesaw | swirl | trill at each tip | small hops in turn | 6..12 s | +2 |
| Push the swing | one on a swing (put there by the player), a friend near | star on the pusher | coo from the rider at each swing | scoot into the seat | 3 pushes | +1 |
| Follow the leader | B14 | star on the leader | chirp at each turn, answers down the line | scoot in a line, 0.7 m gaps | loop done | +1 each neighbour pair |
| Sing together | B09 | notes | hums in harmony (5.3) | sway on the beat | 2 bars | +2 each pair |
| Pile-up nap | B10 with 2+ | one zzz | one soft yawn for the pile | scoot into the bowl, touch, sleep | the pile wakes | +3 each touching pair |
| Comfort | B11 | cuddle, then "all better" on both | low coo, then a rising chirp | scoot to touch, lean in | the sulk ends | +2 |
| Peekaboo | two on opposite sides of a block, bar or mound | question, then sparkle | chirp, giggly trill | lean out and back, 2 or 3 times | 4 s | +1 |
| Duet (best friends at 3 hearts) | both present and free, once per visit | twin hearts + notes | a two-voice phrase in thirds | sway | 2 bars | +2 |

### 4.2 Friendship: storage and unlocks
Per **species pair** (not per instance: it survives merges and trades, and the player learns "Dollop and Crimpo are friends"). Points are a `u8`;
hearts at 3 / 8 / 16 / 30 / 50 points. Daily cap 6 points per pair per UTC day (best friends x2 points, cap 12). Stored sparse, at most 160 pairs
(1225 possible); when full, the lowest-point pair under 1 heart is dropped. Unlocks: 1 heart, they greet with a heart; 2, they nuzzle on their own; 3,
a Journal friend card and (best friends) the Duet; 4, they always nap side by side; 5, one asks to come along when you travel with the other (a wish).
The first time a best-friend pair greets: twin hearts and a Journal reveal (discovery bit 3).

### 4.3 Warmth (per instance; the word "Heart" is taken by the favourite flag, CORE map 4)
0..100 per Hoard item, at most 100 items (the shelf cap). +1 per touch it loves (at most 5 a day), +3 per wish granted, +2 for a visit to its favourite
place (once a day). Never falls. At 25 it looks at the camera more; at 50 it greets you when you arrive in a place (a hop toward the camera); at 75 it
sometimes shows a "hint" wish that points at an undiscovered fact; at 100 a tiny star on its Journal page. A merge result starts at max(parents)/2.

---

## 5. Emotes and voices

### 5.1 Squishmoji (24 icons, SDF-drawn in one fragment shader, no texture, our own shapes)
| # | Icon | Drawn as | Meaning | Used by |
|---|---|---|---|---|
| 1 | heart | two circles + a triangle, coral | I like you | greet friends, nuzzle |
| 2 | twin hearts | two small overlapping hearts | best friends | best-friend pairs only |
| 3 | note | an eighth note, amber | la la | singing, music box |
| 4 | sparkle | a four-point star burst, cream | wow, something new | discovery, wish granted |
| 5 | question | a curl and a dot, lagoon | what's that? | notice |
| 6 | oh | a drop-shaped mark and a dot | oh! | surprise, being cut, a toss |
| 7 | zzz | three stacked z strokes | sleepy | nap (once at the start) |
| 8 | sun | disc + 8 short rays, amber | warm and happy | sun, lamp |
| 9 | flame | a teardrop flame, coral | toasty | hearth, chimney |
| 10 | snowflake | six spokes, lagoon | brr | cold zones |
| 11 | droplet | a teardrop, lagoon | wet, splash | water, rain, puddles |
| 12 | bubbles | three circles of three sizes | bubbly | floating, the tub |
| 13 | swirl | a spiral | whee, dizzy | spinner, slides, tosses |
| 14 | star | a five-point star, amber | I did it | after using a thing, cheer |
| 15 | raincloud | a cloud with two drops, dusk | a bit grumpy | sulk |
| 16 | all better | a three-band arch | feeling better | comfort, a sulk ends |
| 17 | hello | three nested arcs | hello! | greet |
| 18 | shell | a fan of 5 ribs | found a beach treasure | Ripple Shore |
| 19 | leaf | an almond with a midrib | a garden thing | Puddlebrook |
| 20 | moon | a crescent, cream | night, the moon | Lanternroof, bedtime |
| 21 | bell | a bell outline and a clapper | ding | chimes, bells, crystals |
| 22 | ball | a circle with a seam | let's play | pass the ball, a play wish |
| 23 | postcard | a small card with a sky band | I want to go to a place | wishes only |
| 24 | cuddle | two arcs facing each other | come close | nuzzle and comfort wishes |
Bubble styles: **say** (round, with a tail toward the body), **think** (round, with three trailing dots; wishes only), **group** (double outline,
smaller icon, one to three dots for how many pieces). Fill cream `#fff1d6` at 0.92, outline ink `#14102a`, icon colours from the palette tokens;
icon against fill at least 3:1 (RD-04).

### 5.2 Bubble rules
Size: 30 CSS px across on a phone (icon 20 px), 36 px on desktop, group bubbles 24 / 28 px. Anchor: the body's top + 0.25 R, kept inside the
HUD safe insets and pushed apart sideways when two overlap (1-D push on the screen boxes). Life: in 0.15 s, hold, out 0.25 s; say bubbles live
1.6 s; think bubbles stay until granted (they settle at alpha 0.85 with a 0.5 Hz bob, no bob in Calm). The same icon from the same character or group
is dropped within 4 s. Reduced motion and Calm: fade only, no pop. Bubbles are 3D (one instanced draw) and are hidden in Snap photos (a stage flag).
Sound off: every voice exchange has a bubble equivalent; wishes are also told once in the polite live region ("Dollop has a wish: a warm place"),
at most once per 20 s.

### 5.3 Voices (procedural, no samples, no words)
**Syllables** (one oscillator with a cached `PeriodicWave` per flavour, one envelope gain, an optional formant biquad, a panner only off centre:
3 or 4 nodes, AUDIO map 5): chirp (rise 2 pentatonic steps over 90 ms), coo (fall 2 steps over 200 ms), purr (180 ms flat, 28 Hz amplitude flutter),
hum (380 ms flat, 5 Hz vibrato +-12 cents), trill (3 notes x 55 ms up the scale), yawn (500 ms, a slow 3-step fall with breath noise), chitter
(4 x 40 ms falling), peep (pieces: a 45 ms blip). A phrase is 1 to 3 syllables chosen by the behaviour (greet chirp + coo, happy trill, sleepy
yawn, curious rising chirp, sulk a low coo one octave down).
**Pitch.** Whole squishy: `660 Hz x pitchRatio(genome)` (genome.ts 140-144, about 0.70..1.43) snapped to the nearest D major pentatonic note in
A4..B5 (440, 494, 587, 659, 740, 880, 988 Hz). Pieces: the whole's note x `(0.5/frac)^0.4` (CUT's `popSize`) snapped into D6..D7 (1175..2349 Hz), 7 dB
quieter, above the mallet's top note (AUDIO map 3). Always snapped, music on or off.
**Timbre** by the 6 cut flavours (`FAMILY_FLAVOUR`, `src/audio/cut.ts` 35): gel clear (harmonics 1, 0.3, 0.1); sticky nasal (1, 0.6, 0.5, 0.3 +
band-pass 1.6 kHz Q 3); foam breathy (1, 0.15 + 20% noise through a band-pass at 2f); beads grainy (3 ms ticks at the onset, 12 /s flutter); dough
dark (1, 0.5, 0.2, low-pass 1.2 kHz); firm bright (1, 0.7, 0.5, 0.4, 0.3, a small upward onset chirp).
**Call and response.** The answer waits 0.35..0.7 s (seeded), keeps the call's rhythm, mirrors its contour, and sits a pentatonic third or fourth
away. At most 2 exchanges per greet.
**Harmony.** Only in Sing together and Duet: `musicClock()` gives the SOUNDING field and bar time; each singer takes a different rest tone of that
field (root, fifth, ninth), enters on the next bar line and hums on the eighth grid for 2 bars; at most 3 singers voiced on desktop, 2 on a phone,
the rest sway. With the music off it uses the home field (D, A, E) on its own 66 BPM grid.
**Levels and mix.** Whole syllable peak -24 dBFS at chatter 1.0 (effects -17..-4, music about -29 long-term), pieces -31. A new `chatter` input gain
created after `music` in the chain (the harness labels the first three gains, AUDIO map 1), its own rng stream (no draw from `engRng`), voice
priority -1 (stolen before any player sound), kinds NOT in `ROOM_KINDS` (no music dip). Chatter is silent during ceremonies and for 1 s after.
Echo Hollow: one scheduled repeat at +220 ms, -12 dB, low-passed, counted as half a voice (no DelayNode: it broke reproducible renders, SOUND.md).

### 5.4 The attention budget (exact caps; "phone" = coarse pointer or a viewport under 700 CSS px wide)
| Channel (autonomous only) | Phone | Phone, Calm | Desktop | Desktop, Calm |
|---|---|---|---|---|
| bubbles on screen at once | 2 (+1 kept for a wish) | 1 (+1) | 4 (+1) | 2 (+1) |
| bubble starts (refill /s, burst) | 0.8 /s, 2 | 0.4 /s, 1 | 1.5 /s, 3 | 0.7 /s, 2 |
| creature voices at once | 2 | 1 | 3 | 1 |
| syllable starts (refill /s, burst) | 3 /s, 4 | 1.5 /s, 2 | 4 /s, 6 | 2 /s, 3 |
| prop sounds from autonomy | 2 /s | 1 /s | 3 /s | 1.5 /s |
| effect particles from autonomy | 24 /s | 8 /s | 48 /s | 16 /s |
| haptics from autonomy | 0 | 0 | 0 | 0 |
| camera moves from autonomy | 0 | 0 | 0 | 0 |
**Priority** of a request: class (P1 wish or quest moment 3.0, P2 whole squishy 2.0, P3 piece group 1.0) + (1 - distance from the screen centre,
normalised 0..1) + 0.3 for a friend pair + 0.2 for a first-time event - 0.5 for the same icon in the last 10 s. Requests that find the bucket
empty are dropped, not queued (P1 waits up to 2 s). Off-screen characters never show bubbles and sound 6 dB quieter. **The player comes first**:
player-caused feedback goes through today's `feedback.ts` path and is never budgeted; while the player touches anything, P2 and P3 bubbles stop and
other voices duck 6 dB and slow to 1 syllable /s, until 0.6 s after the release. Bumps between two untouched bodies closing under 0.8 m/s are silent.
The audio engine keeps a hard backstop of its own (a pure `ChatterLimiter` like `BumpLimiter`) at the desktop numbers, so a shell bug cannot flood it.

---

## 6. Pieces

### 6.1 What a piece can and cannot do
**Can**: scoot, small hops (apex at most 2 cm), glide on ice, float and sink by its family density, react to zones (looks and poses scaled by size),
ride and bounce on things, roll the ball, huddle, join a song as part of one group voice. **Cannot** (eyes-only rule: chunks have no face): gaze,
expressions, wishes, sulks, greets of their own, solo voices, friendship points of their own. The face piece keeps its eyes and leads the group.

### 6.2 Groups share feedback
All pieces of one squishy form one **group** under its one brain. A group has at most 1 bubble and 1 voice at a time (a group voice is one voice with
2 or 3 detuned oscillators at +-10 cents, at one piece's level + 2 dB, AUDIO map 3). Piece events of the same kind within 0.5 s merge into one
group bubble with dots for the count (up to 3). Piece-to-piece bumps inside a group are silent unless the player caused them. Group repertoire:
**Huddle** (pieces scoot toward the face piece when left alone for 20 s, a gentle gathering, never sad), **Hop together** (a jiggle wave: hops
staggered 0.12 s apart), **Follow** (pieces trail the face piece), **Join in** (copy a nearby whole squishy's thing use as a group), **Use a
thing** (float, slide, bounce, ride, nap in a bowl).

### 6.3 Character caps (upper bounds; the run-time awake budget of 10.2 can only lower what moves)
| Quality | Whole squishies on screen | of them detail 3 | Pieces of the one cut squishy | Characters in all | Autonomous movers at once | Brains |
|---|---|---|---|---|---|---|
| low | 3 | 1 (the active one) | 4 | 5 | 1 (a piece group counts 1) | 3 |
| med | 4 | 2 | 6 | 8 | 2 | 4 |
| high | 6 | 6 | 6 | 10 | 4 | 6 |
Pieces allowed by a cut = min(MAX_PIECES[tier] (cut.ts 38), characters - other wholes); a refused cut uses today's polite "as many pieces as it can
make". **The party stays when you cut** (today a cut empties the mat, cut.ts 244-247: re-specified here, CUT.md 2 rule 2 still holds for leaving).
Detail-2 wholes are chosen at spawn (the active squishy and the most recently touched stay detail 3); no run-time swap in S1 or S2 (the swap pops
the body upright and ticks the luminance, PHYS map 4). Species that fail the detail-2 gate (PH-13) always spawn at detail 3 and count double.

### 6.4 The brain when a squishy is cut or made whole
Cut: the brain stays; mood "surprised" for 2 s ("oh" group bubble once, wide eyes on the face piece), then "playful" for the pieces; needs freeze
except energy. Reconnect: nothing for partial joins; **whole again**: one sparkle and a trill, B16 Cheer, discovery bit 12 ("its pieces like to
play") the first time it happened while the pieces used a thing. Leaving a place reconnects first (CUT.md rule 2).

---

## 7. Purpose: the Journal

### 7.1 Structure
The **Journal** has four tabs: **Quests** (11 chapters: Home, the 9 places, and "Friends Everywhere"), **Squishies** (50 pages: discoveries,
traits, favourite place and thing once found, best friend once met, warmth), **Friends** (pairs with hearts), **Keepsakes** (a shelf of 16). Each
finished quest gives one **stamp**; stamps open places (7.6). Each chapter has 8 main quests (the 8th is the finale) and 2 bonus quests.

### 7.2 Typed events (the only input of the quest reducer; produced by the shell from physics, LIFE and UI; preallocated records, 9.9)
`Visit(place)`, `Bring(place, n)` (n squishies present), `Touch(kind: squeeze | stretch | toss | snap, species)` (copied from the same mapped touch the
meter sees; counts even when the capsule table is full), `Use(thing, mech, kind, species)` (kinds ROCK, SWING, SPIN, ROLL, BOUNCE, RING, NAP, FLOAT_ON,
SLIDE, SWITCH), `React(kind, species, family, place)` (FLOAT, SINK, SOAK, SQUIRT, TOAST, RISE, WARM, SHIVER, FROST, SNOWCAP, GLIDE, SPLASH, DRIFT, LIFT,
RATTLE, GLOW, GAZE_SKY), `Social(kind, a, b, n)` (GREET, NUZZLE, COPY, PASS, TEETER, PUSH, PARADE, SING, PILE, COMFORT, PEEK, DUET), `Friend(a, b, level,
best)`, `Wish(kind: SHOWN | SEEN | GRANTED, species)`, `Discover(species, bit)`, `PieceUse(kind, n, place)`, `Cut(n)`, `Whole()`, `Photo(n, hasBestPair)`,
`Capsule(tier, isNew)`, `Merge()`, `Ui(kind: JOURNAL | TRAVEL)`.

### 7.3 The rule grammar
A quest is 1 to 3 **clauses**, all required (`within: 'visit'` makes them share one visit). A clause: `{ ev, place?, thing?, mech?, kind?, family?,
species?, minN?, count, distinct?: 'species' | 'family' | 'thing' | 'pair' | 'place' }`. Progress is a `u16` counter, or a bitset for `distinct`
(species 64 bits, families 16, things 16, places 16, pairs a 64-bit hash set capped at 32). **Fairness rules** (QU-03): no quest needs a tap; a main
quest may name a family only if that family has at least 2 Common species (jellygel, waterfill, gummy, marshmallow, mochidough), otherwise it is a
bonus; no main quest names a species above Uncommon; every clause is reachable at `low` caps (3 wholes).

### 7.4 Chapters (main 1-8, bonus B1-B2). Rule shorthand: `Ev{fields} x count`.
**Home: "First Days"** (finale reward: 1 capsule, the Felt Star keepsake, Hearthlog opens)
| # | Title (player text) | Rule |
|---|---|---|
| 1 | Give Dollop a gentle squeeze | Touch{squeeze} x1 (held 0.4 s or more) |
| 2 | Stretch it out and let go | Touch{stretch} x1 (pull level 0.35 or more) |
| 3 | Open your first capsule | Capsule{} x1 |
| 4 | Bring a friend out to play | Bring{home, minN 2} x1 |
| 5 | Watch them say hello | Social{GREET} x1 |
| 6 | Open your Journal | Ui{JOURNAL} x1 |
| 7 | Dollop has a wish | Wish{SEEN} x1 |
| 8 | Off to the cabin! | Visit{hearthlog} x1 |
| B1 | Roll the felt ball | Use{feltball, ROLL} x3 |
| B2 | Nap time in the basket | Social{PILE, thing snoozebasket} x1, or Use{snoozebasket, NAP} x1 |

**Hearthlog Cabin: "By the Fire"** (finale: 1 capsule, the Ember Pinecone)
| # | Title | Rule |
|---|---|---|
| 1 | Come in from the snow | Visit{hearthlog} x1 |
| 2 | Cozy by the fire | React{WARM, hearthlog} x2, distinct species |
| 3 | Rock the rocker board | Use{rockerboard, ROCK} x3 |
| 4 | Chase the yarn ball | Use{yarnball, ROLL} x5 |
| 5 | Two on the board | Social{TEETER, hearthlog} x1 |
| 6 | Little bits by the fire | PieceUse{WARM, hearthlog, minN 3} x1 |
| 7 | Sing with the music box | Social{SING, hearthlog, minN 2} x1 |
| 8 | Snug as can be | Social{PILE, thing snugbasket, minN 3} x1 |
| B1 | Toasty and golden | React{TOAST or RISE, hearthlog} x1 (a marshmallow or a mochi) |
| B2 | Push a friend on the swing | Social{PUSH, hearthlog} x2 |

**The other places** (same slots: 1 arrive, 2 the place's zone reaction, 3 and 4 two things, 5 a social moment, 6 pieces, 7 a favourite found, 8 finale):
| Place (keepsake) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 (finale) | Bonus |
|---|---|---|---|---|---|---|---|---|---|
| Ripple Shore (Sea-glass Pebble) | Sand and sea: Visit | Float like a puff: React{FLOAT} x2 distinct | Ride the bob-ring: Use{bobring, FLOAT_ON} x2 | Shell song: Use{shellchimes, RING} x5 | Pass the pebble: Social{PASS} x2 | Bits in the pool: PieceUse{FLOAT, minN 3} | Who loves the shore?: Discover{FAV_PLACE, ripple} x1 | Sunset song: Social{SING, minN 3} | Soak and squirt: React{SQUIRT}; Slide off the mound: Use{sandmound, SLIDE} x2 |
| Frostbell Ridge (Tiny Frost Bell) | Hello, snow: Visit | Frosty friends: React{FROST} x2 distinct | Zoom on the ice: Use{icepond, SLIDE} x3 | Down the glide ramp: Use{glideramp, SLIDE} x2 | Warm hugs: Social{NUZZLE} x1 | Bits on ice: PieceUse{GLIDE, minN 3} | Who loves the snow?: Discover{FAV_PLACE} | All in the steam pool: React{WARM, thing steampool, minN 3} (one visit) | Ring the icicles: Use{iciclebells, RING} x8; Snow hats: React{SNOWCAP} x2 |
| Puddlebrook Garden (Raindrop Bead) | Pitter-patter: Visit | Splash!: React{SPLASH} x3 distinct | Teeter on a leaf: Use{leafteeter, ROCK} x3 | Boing on the mushroom: Use{mushroom, BOUNCE} x5 | Follow the leader: Social{PARADE, minN 3} | Puddle bits: PieceUse{SPLASH, minN 3} | Who loves the rain?: Discover{FAV_PLACE} | Rainy day nap: Social{PILE, minN 3} | Shower time: React{SOAK} x1; Stone hops: Use{steppingstones, BOUNCE or ROLL} x4 |
| Fizzwell Tub (Bubble Ring) | Bubbles up!: Visit | Floaters and sinkers: React{FLOAT or SINK} x4 distinct family | All aboard the boat: Use{bobboat, FLOAT_ON} x2 | Whee, soap slide: Use{soapslide, SLIDE} x3 | Splash together: Social{GREET} x3 | Bubbly bits: PieceUse{FLOAT, minN 4} | Who loves the bath?: Discover{FAV_PLACE} | Bath-time choir: Social{SING, minN 3} | Round the swirl: Use{bobboat, SPIN} x2; Squeaky clean: React{SQUIRT} x1 |
| Cogwhistle Bench (Little Brass Cog) | Tick, tock: Visit | Warm lamp: React{WARM} x2 distinct | Round on the cog: Use{cog, SPIN} x3 | Spring plate boing: Use{springplate, BOUNCE} x5 | Copy me!: Social{COPY} x2 | Bits on the cog: PieceUse{SPIN, minN 3} | Who loves the bench?: Discover{FAV_PLACE} | The big machine: Use{cog, SPIN} + Use{springplate, BOUNCE} + Use{brassbell, RING}, within one visit | Magnet rattle: React{RATTLE} x1; Ding: Use{brassbell, RING} x5 |
| Lanternroof (Paper Lantern) | Up on the roof: Visit | Moon watchers: React{GAZE_SKY} x2 distinct | Lantern taps: Use{lanternline, RING} x5 | Ride the vane: Use{vanedisc, SPIN} x2 | Hold on, breeze!: React{DRIFT} x2 distinct | Bits in the breeze: PieceUse{DRIFT, minN 3} | Who loves the night?: Discover{FAV_PLACE} | Chimney cuddle: Social{PILE, thing chimneynook, minN 3} | Hammock push: Social{PUSH} x2; Skylight boing: Use{skylight, BOUNCE} x4 |
| Echo Hollow (Glow Crystal) | Hello, hello, hello: Visit | Glow bath: React{GLOW} x2 distinct | Crystal scale: Use{crystals, RING} x5 distinct thing part | Stone slide: Use{stoneslide, SLIDE} x2 | Echo talk: Social{GREET} x3 | Glowing bits: PieceUse{GLOW, minN 3} | Who loves the cave?: Discover{FAV_PLACE} | Cave choir: Social{SING, minN 3} | Call the echo: Use{echostone, SWITCH} x1 + Social{GREET} x1; Cave nap: Social{PILE} x1 |
| Cloudloft (Cloud Puff) | Above the clouds: Visit | Puff pad boing: Use{puffpads, BOUNCE} x5 | Pad to pad: Use{puffpads, BOUNCE} x3 distinct thing part | Float on the updraft: React{LIFT} x2 distinct | Kite swing: Use{kiteswing, SWING} x3 | Bouncy bits: PieceUse{BOUNCE, minN 3} | Who loves the sky?: Discover{FAV_PLACE} | Sunrise parade: Social{PARADE, minN 3} | Under the arch: Social{PARADE, thing rainbowarch} x1; Cloud nap: Social{PILE} x1 |

**Friends Everywhere** (opens after 2 chapter finales; finale: 1 capsule, the Friendship Frame)
| # | Title | Rule |
|---|---|---|
| 1 | Five new hellos | Social{GREET} x5, distinct pair |
| 2 | A real friendship | Friend{level 2} x1 |
| 3 | Best friends found | Friend{best} x1 |
| 4 | A song in three places | Social{SING} x3, distinct place |
| 5 | World travellers | Visit{} x5, distinct place |
| 6 | Favourite places | Discover{FAV_PLACE} x5, distinct species |
| 7 | Every kind of feel | React{} x8, distinct family |
| 8 | Picture of friends | Photo{minN 4, hasBestPair} x1 |
| B1 | Bits everywhere | PieceUse{} x3, distinct place |
| B2 | Wishes come true | Wish{GRANTED} x10 |
Totals: 11 chapters x 10 = 110 quests and stamps. Quest ids are append-only indexes (as species idx), so saves never break.

### 7.5 Rewards (every one is one-time)
| Reward | When | Economy effect |
|---|---|---|
| Stamp | every quest | none (opens places) |
| Capsule | each chapter finale: at most 11 for life | bounded, proven in 7.11 |
| Keepsake | each chapter finale (11) + 5 friendship keepsakes (7.9) | none |
| Discovery | many events (7.8) | none |
| Place | stamp thresholds (7.6) | none |

### 7.6 The order places open
| Place | Stamps needed | Also |
|---|---|---|
| Home | 0 | |
| Hearthlog Cabin | Home finale (8 stamps of Home's 8 main) | day 1 |
| Ripple Shore | 12 | |
| Frostbell Ridge | 18 | |
| Puddlebrook Garden | 25 | |
| Fizzwell Tub | 32 | |
| Cogwhistle Bench | 40 | |
| Lanternroof | 48 | |
| Echo Hollow | 56 | |
| Cloudloft | 64 | |
After the first two, **at most one new place opens per UTC day** ("A new postcard arrived!"). Nothing waits or is lost; it only spreads the world
over the first weeks. A place not yet shipped (S2, S3) is skipped by the rule; its stamps are not lost.

### 7.7 Wishes
| Wish | Icon in the think bubble | Comes from | Granted when |
|---|---|---|---|
| Visit my favourite place (once known) | postcard + the place's sky colour | curiosity > 0.8 away from it | you travel there with it |
| Play with a kind of thing | the mechanism icon (ball, bell, swirl, star) | curiosity > 0.8, no such thing here | it uses one |
| Meet a friend | cuddle + the friend's body colour | company > 0.8 | that friend is in the same place |
| Hold me | heart | company > 0.8 and no touch for 3 min | its signature touch, once |
| Nap | zzz | energy < 0.2, no bowl here | it naps (anywhere, B10) |
| Warm up / cool down | flame / snowflake | cold for 60 s / warm for 120 s | it enters the opposite zone |
| Sing | note | happy for 60 s | a Sing with it |
| Splash | droplet | in a water place, never wet this visit | a water React |
At most 1 wish per squishy, 3 open in all, a new wish at most every 3 minutes per squishy. Tapping a wish (or focusing it and pressing Enter) shows one
plain line ("Dollop wishes to visit a warm place.") and counts as SEEN. A wish quietly fades at the end of the session. Granted: sparkle, trill, warmth +3.

### 7.8 Discoveries per species (a 16-bit mask)
0 met (owned), 1 favourite place, 2 favourite thing, 3 best friend, 4 the touch it loves, 5 water reaction, 6 warm reaction, 7 cold reaction, 8 ice or
ground reaction, 9 wind reaction, 10 heard it sing, 11 napped, 12 its pieces played, 13 first trait word, 14 second trait word, 15 its secret second
favourite thing. Each is set by the matching event the first time; the species page fills a dot per bit (16 per species, 800 in all).

### 7.9 Keepsakes (16; each one shows on the Home Keepsake Shelf and has its own little sound)
Felt Star (Home), Ember Pinecone (Hearthlog), Sea-glass Pebble (Ripple), Tiny Frost Bell (Frostbell), Raindrop Bead (Puddlebrook), Bubble Ring
(Fizzwell), Little Brass Cog (Cogwhistle), Paper Lantern (Lanternroof), Glow Crystal (Echo Hollow), Cloud Puff (Cloudloft), Friendship Frame (Friends
Everywhere), Friendship Ribbon (first pair at 3 hearts), Twin Hearts (first best-friend pair met), Ribbon Garland (5 pairs at 3 hearts), Songbook (a Sing
in every shipped place), Big Heart Quilt (all 25 best-friend pairs met: a long collecting goal that leans on trading, with no economy change).

### 7.10 The first ten minutes (a new player)
| Time | What happens | Quest |
|---|---|---|
| 0:00 | Title, "Wake it up". Dollop on the Dusk Mat. The tracker pill: "Give Dollop a gentle squeeze". | H1 |
| 0:15 | A held squeeze: stamp ("Squishies love to be held"). The pending arc teaches the meter. | H1 done, H2 shown |
| 0:35 | A stretch and let go: stamp. Dollop looks at the Felt Ball (B03 Notice, "question"). | H2 done, H3 |
| 1:20 | The meter fills (first capsule about 77 s, DESIGN 5.4); open it: a new squishy. | H3 done, H4 |
| 1:50 | Bring it out with the mat chip. LIFE is told to greet within 5 s (onboarding override): hello ripples and a chirp exchange. | H4, H5 done |
| 2:30 | The tracker says "Open your Journal": Dollop's page already has 3 dots (met, a trait, the touch it loves). | H6 done |
| 3:00 | Dollop shows a think bubble with a flame (a guaranteed first wish). Tap it: "Dollop wishes for a warm place." | H7 done |
| 3:20 | Home finale: Felt Star on the shelf, a capsule gift, "A new postcard arrived: Hearthlog Cabin". The Places chip glows once (no pulse). | H8 shown |
| 3:40 | Places, pick Hearthlog, Dollop and the new friend come along (loading 0.5..1.5 s under the fade). | H8 done; Hearthlog 1 done |
| 4:00 | Dollop scoots to the hearth: flame bubble, the wish is granted (sparkle), discovery "favourite place". | Hearthlog 2 progress |
| 5:00 | The yarn ball, the rocker board: the player pokes and tosses, the squishies chase and teeter. Second capsule around now. | 3, 4, 5 |
| 7:00 | The Music Box: a 4-bar tune, both sway and hum in harmony. | 7 |
| 8:30 | Energy low: they pile into the Snug Basket (needs 3, so the tracker says "Bring one more friend to nap"). | 8 waits |
| 10:00 | The third capsule (about 9 min with the 30 / 50 / 75 ramp), three squishies, the pile: chapter finale. | finale |
Existing players (migration, 9.10): Home 1 to 4 are completed from the Hoard (opened 1 or more capsules, owns 2 or more), so they start at 5.

### 7.11 A returning player, and the economy proof
**Day 2**: the restock pick and 2 tasks as today; open wishes from yesterday are gone, new ones appear gently (no guilt); Ripple Shore can open
(12 stamps); the Hearthlog bonus quests. **Day 7**: 4 or 5 places, about 30 stamps, a few pairs at 2 or 3 hearts, keepsakes on the Home shelf,
the cross chapter open. **Day 30**: most places open; the long goals are friendships, the 800 discovery dots, the Big Heart Quilt (find every best
friend: collecting and trading with purpose) and the Songbook.

**Proof that the pace holds.** (1) **The meter is untouched**: LIFE has no finger or grab intent (R7, LF-05), so autonomy makes no `poke`, `release` or
`snap`; `bump` and `land` pay nothing (`meterfeed.ts` 43-65); the quest reducer imports no meter function (QU-01 import rule) and is never fed from
`ghostFeed`. So the paying styles' 3.2 to 3.7 active minutes per capsule (DESIGN 5.4) are unchanged by construction, and MERGE_COST stays 2 (it flips
only near 1.5 min a capsule). (2) **Quest capsules are one-time and few**: at most 11 for life, one per chapter finale, granted through the task-capsule
path (origin `task`, ORIGINS is append-only) and capped by TASK_CAPSULE_CAP 10 (a full queue waits in the Journal as a gift, never lost),
idempotent by a hoard bitset (9.10). (3) **They arrive slowly**: the one-place-a-day rule allows at most 2 on day 1 and 1 a day after. **Effect**: a
regular player earns about 6.0 capsules per active day (DESIGN 5.4, sim C). Week 1 at most 6 quest capsules: +14% over 42, so the regular's effective
3.5 min a capsule becomes about 3.1 that week (inside 3 to 4); the fastest paying style (3.2) becomes about 2.8 for that week only. Over 30 active days:
+11 over about 180, +6%. All 50 species (247 / 153 days solo / trade, sim K) move by about 2 active days. **Lever** if the owner wants every style at
3.0 or more in week 1: finales of Home and Hearthlog give a keepsake only (9 capsules for life). The sim gets a "quest" source (a fixed list of one-time
capsules on the finale days); section C and K are re-quoted (QU-06).

---

## 8. Screens (built on `theme.ts` tokens and `h()`, CSSOM only, UI.md bar; z through tokens)

### 8.1 Where things go on a 390 x 844 phone (portrait)
| Zone | Today | With PLAYGROUND |
|---|---|---|
| Top row, 0..56 px | wordmark (about 170 px at 4.4vw) left; mute + gear (2 x 44) right | + **Journal** button (44 x 44, book icon) in the about 76 px left free, left of mute |
| Row 2, 60..92 px | empty (the reveal plate appears at +70 px, centred) | left: the **Places chip** (32 px high pill, the place's name, max 150 px, ellipsis); right: the **tracker pill** (32 px high, max 170 px). Both hide while a plate or the offline banner shows (`body[data-plate]`) |
| Middle | the 3D scene | + 3D bubbles above bodies (never under the insets) |
| Bottom | name tag, Hoard, Toys, mat chip, meter ring | unchanged. The mat chip opens the party picker in places too |
| Tap targets | 44 px | 44 px; the pills are 32 px tall with a 44 px hit area (6 px padding) |
At 320 x 568: the Places chip shows an icon and 8 characters; the tracker shows an icon and "2/3". Every new element joins the Snap hide list
(`hoard.css` 392-393) and lives inside `.hud-top` so `reportInsets` measures it for `setSafeInsets`.

### 8.2 Travel and the party ("Places" sheet)
Phone: a full-height sheet (z 7, like the phone Hoard; `suspend('covered')`). Desktop: a centred panel 720 x 560 (`holdInput('travel')`). It opens
only when idle (`whenIdle`: never during a ceremony). Content: a 2-column grid of postcards (phone: 167 x 112 px each; desktop 3 columns of 216 x 140):
a CSS gradient of the place's sky colours, the name, a stamp count, and for a closed place "Needs 12 stamps" or "Comes tomorrow" (dim text 4.5:1).
Under the grid, "Who's coming?": chips of squishies (44 px, coloured dot + name) up to the character cap of 6.3, the current party preselected. One
primary button "Go to Ripple Shore". Going: `leaving()` (reconnect pieces, release locks, release everything), a 0.4 s screen crossfade (the
ScreenFx snapshot fade, not a flash), the chunk loads under it (preloaded on idle when a place opens, 9.11), the party spawns at the spawn spots.
Keyboard **P** opens it; arrows move between postcards; Enter picks; Esc closes.

### 8.3 The Journal
Phone: a full-height sheet with 4 tabs on top (Quests, Squishies, Friends, Keepsakes; 44 px tall segmented control). Desktop: a 760 x 620 panel
with the tabs as a left rail. **Quests**: the current place's chapter open first; each quest is a row (stamp circle 28 px, title, progress "2/3" in
tabular numerals, a one-line hint under it in dim text); bonus quests under a thin rule. **Squishies**: a grid of 50 small plinth cards (unknown
species are dark silhouettes, as the Hoard); a page shows 16 discovery dots, the two trait words, favourite place and thing (once found), best friend
(once met), warmth as a small glow ring. **Friends**: pairs with 1 to 5 hearts. **Keepsakes**: the 16 slots. Keyboard **J**; it sits before the Hoard in
the Escape chain (tray, Settings, Journal, Places, Hoard, tool, plate).

### 8.4 The tracker pill
Shows one quest: the first unfinished main quest of the place you are in (Home: First Days); a tap opens the Journal there. Text truncates, never
wraps. When it progresses, the number ticks with a 160 ms spring (fade only in Calm).

### 8.5 Wish bubbles
3D think bubbles (5.1). Tapping one (a screen hit-test on its box) shows a small glass card above it for 3 s with one line and, if useful, a button
("Go to Hearthlog"). Keyboard: Tab cycles squishies; a focused squishy with a wish shows the card; Enter acts.

### 8.6 The quest-complete moment
Queued like a ceremony: never within 1 s of a burst, never over a reveal. It takes the plate slot (top +70 px) for 2.2 s: a stamp shape springs in
(scale 0.6 to 1, 220 ms, no flash), "Quest done: Rock the rocker board", one soft procedural stamp sound in D, one polite live-region line. A finale
adds the keepsake rising into its slot and "A gift is waiting" on the capsule dock. Several in a row queue 1.2 s apart.

### 8.7 Keepsakes
On the Home shelf in 3D and in the Journal tab. Tapping one in 3D plays its sound and shows its one line ("Found at Frostbell Ridge").

### 8.8 Settings (two new rows)
"Squishy chatter" slider (0..1, default 0.6; 0 mutes creature voices only); "Squishies move on their own" switch (default on). Place sounds follow the
Music slider (no third key: fewer settings, the same ear).

### 8.9 Desktop
The top bar has room for everything in one row: wordmark, Places chip, tracker pill (max 280 px), Journal, mute, gear. Hover states on mouse only.

### 8.10 Keyboard and access
J Journal, P Places (P and J are free: `keyboard.ts` 67-122 uses Space, Enter, Esc, [ ] T C H G M, arrows, + and -). Every Use quest can be done by
keyboard: a focused squishy's name tag popover gets "Go play with..." listing the place's things; picking one asks LIFE for that use (a player-asked
intent, P1). Reduced motion and Calm: fades only, hops x0.6, no wiggle. Sound off: bubbles carry every meaning. All new text 4.5:1, parts 3:1, every
new colour pair added to `CONTRAST_PAIRS`.

---

## 9. Architecture

### 9.1 Files and owners (D12)
| Lane | New or changed files |
|---|---|
| DATA | `src/data/places.ts` (all 10 places, the mechanism ranges), `src/data/life.ts` (FAMILY_REACT, favourites, best friends, behaviours, wish table, squishmoji ids), `src/data/quests.ts` (chapters, quests, keepsakes). All flat in `src/data` (probe_genome reads it non-recursively). |
| LIFE | `src/life/world.ts` (SoA state), `step.ts` (lifeStep), `brain.ts` (scores), `social.ts` (pairs and groups), `attention.ts` (the pure budget), `voice.ts` (phrase planning), `wish.ts`, `traits.ts` |
| CORE | `src/core/quests.ts` (the pure reducer), `src/core/settings.ts` (2 keys) |
| COLLECTION | `src/collection/journal.ts` (sanitize, serialize, merge), `journal_store.ts` (store, two tabs), `constants.ts` (key), `ghost.ts` (`ghostQuestCapsule`), `types.ts` + `index.ts` (Collection members) |
| PHYS | `src/physics/props.ts` (PropWorld), `softbody.ts` (mods, bounds, prop pass, zones, drivers, touch gate, sleep, `auto`) |
| RENDER | `src/render/place.ts` (PlaceLook host), `places/<id>.ts` (lazy), `props.ts` (kit), `emotes.ts`, `marks.ts`, `water.ts`; `face.ts`, `material.ts`, `bodyview.ts`, `stage.ts`, `particles.ts` changes |
| AUDIO | `src/audio/creature.ts`, `ambience.ts`, `props.ts`, `places/<id>.ts` (lazy); `chain.ts`, `engine.ts`, `music.ts` changes |
| SHELL | `src/shell/life.ts` (host), `attention.ts` (wiring), `party.ts`, `events.ts` (bus), `quests.ts` (host), `places.ts` (travel), `game.ts` order; `src/ui/travel.ts`, `src/ui/journal/*`, `src/ui/tracker.ts` (both sheets lazy) |

### 9.2 The data model (TypeScript sketch; `erasableSyntaxOnly`: no enums, `as const` objects)
```ts
// src/data/places.ts
export const PLACE_IDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'puddlebrook', 'fizzwell', 'cogwhistle', 'lanternroof', 'echohollow', 'cloudloft'] as const; // append-only: idx is saved
export type PlaceId = (typeof PLACE_IDS)[number];
export type MechId = 'block' | 'bar' | 'mound' | 'bowl' | 'ramp' | 'pool' | 'seesaw' | 'swing' | 'spinner' | 'chime' | 'spring' | 'floater' | 'ball';
export type ZoneKind = 'water' | 'wind' | 'current' | 'magnet' | 'warm' | 'cold' | 'wet' | 'echo';
export interface GroundMods { readonly grip: number; readonly glue: number; readonly peel: number; readonly drag: number }
export interface GroundDef extends GroundMods { readonly marks: 'none' | 'print' | 'trail' | 'dust' | 'dent' | 'glow'; readonly markLifeS: number; readonly look: string }
export interface Area { readonly shape: 'disc' | 'box'; readonly x: number; readonly z: number; readonly r?: number; readonly hx?: number; readonly hz?: number; readonly yaw?: number }
export interface PatchDef extends Area { readonly id: string; readonly mods: Partial<GroundMods>; readonly ice?: boolean; readonly wetLook?: number }
export interface ZoneDef extends Area {
  readonly id: string; readonly kind: ZoneKind; readonly strength: number;   // 0..1
  readonly surfaceY?: number;                                                // water: surface height (m)
  readonly wave?: { readonly amp: number; readonly periodS: [number, number] }; // surf
  readonly dir?: readonly [number, number, number];                          // wind / current direction
  readonly gust?: { readonly everyS: [number, number]; readonly forS: number };
  readonly shower?: { readonly onS: number; readonly offS: number };
  readonly switchable?: boolean;
}
export interface ThingDef {
  readonly id: string; readonly name: string; readonly line: string;         // player text (gated)
  readonly mech: MechId; readonly x: number; readonly z: number; readonly yaw: number;
  readonly size: readonly [number, number, number];                          // per mech: box half-sizes, or [r, len, 0], or [ringR, capR, lip]
  readonly mu: number; readonly p: Readonly<Record<string, number>>;         // mech params (ranges in MECH_RANGES, checked by DT-01)
  readonly zone?: string; readonly switch?: 'zone' | 'motor' | 'tune' | 'shower' | 'echo' | 'fire';
  readonly notes?: readonly number[];                                         // chimes: D major pentatonic MIDI notes
  readonly useSpot?: readonly [number, number];                               // where LIFE goes to use it
  readonly look: string; readonly sound: string;                              // render kit id, audio voice id
}
export interface PlaceDef {
  readonly id: PlaceId; readonly idx: number; readonly name: string; readonly blurb: string;
  readonly stampsToOpen: number; readonly shipped: boolean; readonly night: boolean;
  readonly ground: GroundDef; readonly patches: readonly PatchDef[]; readonly zones: readonly ZoneDef[]; readonly things: readonly ThingDef[];
  readonly bounds: Area & { readonly rim: number }; readonly walls: readonly Area[];
  readonly spawn: readonly (readonly [number, number])[];                      // 6 spots
  readonly camera: { readonly aim: readonly [number, number, number]; readonly yaw: readonly [number, number]; readonly pitch: readonly [number, number] };
  readonly light: string; readonly sky: string; readonly weather: string; readonly ambience: string; readonly music: string; readonly ceremonyDim: number;
}
export const PLACES: readonly PlaceDef[];

// src/data/life.ts
export interface FamilyReact {
  readonly density: number; readonly soakedDensity: number; readonly windCatch: number; readonly iceGrip: number; readonly springGain: number;
  readonly springStickS: number; readonly soakRate: number; readonly warmPose: number; readonly coldSpeed: number; readonly shiver: boolean;
  readonly toast: boolean; readonly printDepth: number; readonly printLifeS: number; readonly mechPrefs: readonly MechId[];
}
export const FAMILY_REACT: Record<MaterialFamilyId, FamilyReact>;
export const FAVOURITE_PLACE: Record<SpeciesId, PlaceId>;
export const BEST_FRIEND: Record<SpeciesId, SpeciesId>;              // symmetric, checked by DT-04
export const EMOTE = { heart: 1, twinHearts: 2, note: 3, sparkle: 4, question: 5, oh: 6, zzz: 7, sun: 8, flame: 9, snowflake: 10, droplet: 11, bubbles: 12,
  swirl: 13, star: 14, raincloud: 15, allBetter: 16, hello: 17, shell: 18, leaf: 19, moon: 20, bell: 21, ball: 22, postcard: 23, cuddle: 24 } as const;
```

### 9.3 The LIFE step (snapshot in, intents out; pure, deterministic, zero allocation)
```ts
// types in src/contracts.ts (type-only, additive); values in src/life
export interface LifeSnapshot {            // filled IN PLACE by the shell host at each think tick (10 Hz)
  n: number; t: number;                    // characters, sim seconds (simTime, never a wall clock)
  place: number; phone: boolean; calm: boolean; autonomy: boolean; hush: boolean;    // hush = the awake budget is over (10.2)
  musicField: number; musicOn: boolean; musicBoxOn: boolean;
  kind: Uint8Array;      // 0 whole, 1 face piece, 2 chunk
  group: Int8Array;      // index of the owning whole (pieces); self for wholes
  species: Uint8Array; family: Uint8Array; frac: Float32Array; r: Float32Array;
  x: Float32Array; y: Float32Array; z: Float32Array; vx: Float32Array; vz: Float32Array;
  sx: Float32Array; sy: Float32Array;      // screen position 0..1 (for attention); NaN when off screen
  flags: Uint16Array;    // TOUCHED 1, CARRIED 2, ASLEEP 4, GROUNDED 8, ON_PROP 16, DETAIL2 32, IN_WATER 64, IN_WARM 128, IN_COLD 256, IN_WET 512, IN_WIND 1024, TOSSED 2048
  zoneId: Int8Array; propId: Int8Array; submerged: Float32Array;
  traits: Float32Array;  // n x 5 (playful, steady, curious, cuddly, sleepy), from traits.ts at spawn
  thingX: Float32Array; thingZ: Float32Array; thingState: Float32Array;  // live poses of movable things (ball, seesaw angle, ...)
  bumpA: Int8Array; bumpB: Int8Array; nBumps: number;                    // body-body contacts this tick
  touchKind: Int8Array;  // per character: the player's last touch kind this tick (-1 none)
}
export interface LifeIntents {              // fixed capacity 64, reset each tick
  n: number;
  kind: Uint8Array;     // GAZE 1, SCOOT 2, HOP 3, SQUASH 4, LEAN 5, WIGGLE 6, GLIDE 7, SETTLE 8, EXPRESS 9, EMOTE 10, VOICE 11, CANCEL 12
  who: Uint8Array; delayS: Float32Array;    // start after delayS (the host keeps at most 4 queued actions per character)
  a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array;  // target x, y, z, speed / amount, frequency ...
  icon: Uint8Array; style: Uint8Array; prio: Float32Array; groupKey: Int16Array;
}
export interface LifeEvents { n: number; kind: Uint8Array; a: Uint8Array; b: Uint8Array; n2: Uint8Array; thing: Int8Array; sub: Uint8Array } // Social, Use, React, Wish, Discover (cap 32)

// src/life/step.ts
export function createLifeWorld(seed: number, place: PlaceDef, maxChars: number): LifeWorld;   // allocates once
export function lifeAdd(w: LifeWorld, slot: number, g: Genome, kind: 0 | 1 | 2, group: number): void; // at spawn, cut, join (not per frame)
export function lifeStep(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  out.n = 0; ev.n = 0;
  integrateNeeds(w, s);                       // needs, zone entries -> React events (once per zone per visit)
  for (let i = 0; i < s.n; i++) {
    if (s.flags[i] & (1 | 2)) { held(w, s, i, out); continue; }          // touch overrides at once (CANCEL + gaze released to the pointer)
    if (s.kind[i] === 2) continue;                                        // chunks follow their group brain
    if (w.left[i] > 0 && !interrupted(w, s, i)) { continueBehaviour(w, s, i, out, ev); continue; }
    choose(w, s, i, out, ev);                                             // utility argmax + pair and group locks (both partners set in this call)
  }
  planVoices(w, s, out);                      // call and response, harmony slots
  attentionFilter(w.att, s, out);             // drops or merges EMOTE / VOICE intents in place (5.4); no allocation
}
```
Per-character random streams: `mulberry32(genome.seed ^ 0x6c1fe0a7 ^ place.idx)` held in a `Uint32Array`, so one squishy's draws never shift
another's. Cost target 0.1 ms per tick at 16 characters (LF-03).

### 9.4 Contract additions (`src/contracts.ts`, every member optional and additive)
```ts
// physics
export interface SoftEvent { /* existing */ auto?: boolean; /* true: not caused by the player (hop, pad, a fall the player did not throw) */ prop?: number; /* 'bump' against prop index */ }
export interface SoftMetrics { /* existing */ asleep?: boolean; submerged?: number; zoneMask?: number; onProp?: number }
export interface SoftBodyLike {
  /** 8 eased modifiers: 0 grip, 1 glue, 2 peel, 3 drag, 4 density, 5 wind catch, 6 spring gain, 7 reserved. Written by the shell at 10 Hz; eased over 0.3 s. */
  readonly mods?: Float64Array;
  setBounds?(shape: 0 | 1, cx: number, cz: number, a: number, b: number, rim: number): void;  // 0 disc (a = r), 1 rounded rect (a, b half sizes)
  setHome?(x: number, z: number, deadZone: number): void;
  setPropWorld?(w: PropWorldLike | null): void;
  /* LIFE drivers: paused and eased out while fingers > 0, grabbed or carried; ceremony drivers are not affected */
  setSquash?(s: number, tauS: number): void;          // 0.75..1.12, volume preserving (y x s, x and z x 1/sqrt(s))
  hop?(vx: number, vy: number, vz: number): boolean;  // false if not grounded, touched, or within 0.8 s of the last hop; vy clamped 0..2.5
  lean?(dx: number, dz: number, amount: number): void;  // goal shear, amount 0..0.1 R
  wiggle?(hz: number, amp: number): void;              // 0 amp stops
  sleepEnabled?: boolean; wake?(): void;
}
export interface PropWorldLike {
  readonly count: number;
  readonly poses: Float32Array;                         // 8 per prop: x, y, z, qx, qy, qz, qw, state; written by endFrame
  beginFrame(): void;                                   // clear accumulators (before the bodies step)
  endFrame(dt: number): void;                           // integrate hinge1 / slider1 / free props from this frame's impulses
  setZoneOn(zone: number, on: boolean): void; setMotor(prop: number, on: boolean): void;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number;   // prop index or -1 (no allocation)
  poke(prop: number, ix: number, iy: number, iz: number): void;                              // a player tap
  drainStrikes(out: Float32Array): number;              // chimes and pads struck: [prop, intensity, auto] triples
}
// render (StageLike)
loadPlace?(id: string): Promise<boolean>; setPlace?(id: string | null, fadeS: number): boolean; bindProps?(poses: Float32Array, count: number): void;
setBodyGaze?(id: number, x: number, y: number, z: number, weight: number): void;           // weight 0 releases to the pointer and idle wander
setBodyExpression?(id: number, expr: 0 | 1 | 2 | 3 | 4 | 5, amount: number): void;          // none, happy, sleepy, surprised, shy, proud (eyes only, no blush)
setBodyLook?(id: number, frost: number, wet: number, sand: number, toast: number, snow: number): void;
setBodyWater?(id: number, surfaceY: number): void;                                         // NaN: not in water
setBodyAsleep?(id: number, asleep: boolean): void;                                          // skip the fine-mesh update
emote?(slot: number, bodyId: number, icon: number, style: 0 | 1 | 2, lifeS: number, dots: number): void; clearEmote?(slot: number): void; readonly emoteSlots?: number;
stampMark?(kind: number, x: number, z: number, angle: number, size: number, lifeS: number): void;
bodyScreen?(id: number, out: Float32Array): boolean;                                       // x, y (0..1), rPx; false off screen
// audio (SquishAudio, AudioSettings)
interface AudioSettings { chatter?: number }
creature?(p: { syl: number; deg: number; flavour: number; register: 0 | 1; pitch: number; pan: number; level: number; group?: number; echo?: boolean; atBar?: boolean }): boolean;
loadAmbience?(place: string): Promise<boolean>; setAmbience?(p: { place?: string | null; on?: boolean; volume?: number }): void;
prop?(p: { kind: number; intensity: number; note?: number; pan?: number; auto: boolean }): void;
musicClock?(out: Float64Array): boolean;                                                    // [field sounding now, barT0, bpm, ctxNow]
musicBox?(p: { on: boolean }): void; setMusicStyle?(style: string): void;                    // the default style must stay bit-identical
// settings
interface Settings { chatter?: number; autonomy?: boolean }
// debug hook (dev only)
life?(): unknown; quests?(): unknown; travel?(place: string): Promise<boolean>;
```

### 9.5 Physics additions (detail)
**Ground modifiers.** `mods[0..3]` scale `tableMu`, `glue`, `groundDamp` and a now-mutable `dragF` (PHYS map 5: drag is baked at :766 and applied to
the whole velocity at :2658, so ice needs it). **Bounds**: `matCorral` gets a place-bounds branch (disc or rounded rect) and `setHome` (PHYS E3).
**Prop pass**: between the fingertip pass and the table pass (softbody :2197-2217), once per substep, against the PropWorld's packed `Float64Array`
(stride 24: kind, joint, centre, half sizes, quaternion, velocity, angular velocity, mu, owner prop). Per body per frame the shell does not filter:
the body tests each prop's bounding sphere against `bR` and skips far ones. Closest-point projection for sphere, capsule (segment) and oriented box;
Coulomb friction with the prop's surface velocity; the touched particles join the fold-limit list as the table's do (:2238), so prop edges cannot
crease skin. The mass-weighted correction goes into the prop's impulse and moment accumulators. **Joints** (`props.ts`, pure): hinge1 is one angle
with I, damping, limits and an optional motor; slider1 is one offset with k, damping, active gain (spring pads add `gain x the body's mods[6]` of the
returned impulse, apex capped) and an optional wave drive; the free ball integrates translation with roll damping, a ground contact at y = r, walls
and bounds, a 2.0 m/s clamp. All integrate once per frame (one-frame lag: stable for heavy damped props; the ball is clamped). **Zones** (per frame,
whole-body share): water buoyancy and drag (supported gravity off when submerged > 0.15; slosh still works because it pushes when not supported),
wind, current, magnet; the wake threshold 0.25 m/s^2. **Drivers**: `setSquash` scales the goal GB anisotropically in `frameUpdate` (:2391-2397),
`hop` = nudge + glue and peel x0 for 10 substeps (:2218, :2275), `lean` = goal shear, `wiggle` = low-frequency sway. **Touch gate** at the substep
start (:1849-1853). **Sleep**: rest test = kinetic < 0.02 and |centre velocity| < 0.01 m/s and grounded (or floating at rest) and no driver, timer
or easing active (the list in PHYS map 4) for 0.5 s; freeze X, V, XP, goal, accumulators; memory families sleep only after MEM converged; wake on
finger, grab, nudge, any driver, gravity, setFrac, setNeck, reset, a mods change, a prop or zone that starts touching it, or a contact from an awake
body; `collide` skips sleeper pairs and wakes a sleeper touched by an awake body. Float mode never sleeps (its bob) unless the place says "floating
rest" (then the stage bobs the sleeping body visually: render offset 0.02 m at 0.3 Hz). **`auto`** is set on `land` unless the body was thrown by the
player since its last landing. **Bump memory**: MAX_OTHERS 16 keyed `bodyId & 15` aliases past 16 bodies (:276, :1405); widen to 32 slots keyed by a
shell-assigned slot index.

### 9.6 Render additions
`PlaceLook` host in `place.ts`: sky params (`Table.setSky`, the 9 colour uniforms and fog, table.ts 198-204) or a per-place sky shader; a ground mesh
with its own `onBeforeCompile` noise (top at y = 0; the felt is Home's); backdrop cards (renderOrder -99..-51, low poly: they are drawn twice on med
and high); lights as stage fields with the jelly `uKeyDir/uRimDir/uKeyCol/uRimCol` and `KEY_TINT` re-derived per place (material.ts 329-338, 386-390);
env panels as data with `EnvHub.rebuild` and disposal of the old cube. **Ceremony dim**: bright places lerp the sky 30% toward Home dusk over 0.4 s
during a ceremony, so the additive light still reads and the flash probes pass (RD-03). **Props kit**: shared geometries and materials per kind,
`InstancedMesh` for repeated statics, plain meshes for movers, poses from `bindProps`; opaque props at renderOrder 0..9 before the jellies.
**Water**: one translucent surface plane drawn after the jellies with depth test on and depth write off, plus `uWaterY` per body for the underwater
tint. **Looks**: `uFrost`, `uWet`, `uSand`, `uToast` (+ `uHeatPos`), `uSnow` in the jelly program, cache key `wh-jelly-v5`, each checked on the low
tier path. **Faces**: per-body gaze and the five expressions as eased channels in face.ts; **no blush and no mouth** (REFERENCES 3). **Emotes**: one
instanced alpha-blended billboard draw, SDF icons in the fragment shader, renderOrder 40+, depth test off, pool of 8 slots. **Marks**: one ring buffer
of instanced quads (64 / 48 / 24 by tier). **Weather**: `Particles` with a `blending` option (normal blend for snow, rain, bubbles). **Cheaper bodies**:
`setBodyAsleep` skips JellyView's per-frame fine-mesh evaluation; chunks and detail-2 background wholes use the low fine mesh (2562 verts) on med;
the eyes still blink on sleeping bodies (face update is cheap). **Camera in places**: the place's camera box, a slow party-centroid follow (0.5 s time
constant) clamped to the box, so wandering bodies never make it hunt. Snap hides bubbles.

### 9.7 Audio additions
Chain: `chatter` and `ambience` input gains created after `music` (the harness tap order). `creature.ts`: the syllables, flavours, pitch snapping,
group voice, `ChatterLimiter`, priority -1, its own rng stream. `ambience.ts`: an `AmbienceBed` shaped like `MusicBed` (own bus, fades, the 100 ms
scheduler, a shallow -6 dB room dip keyed by player effects; it never asks for room) that joins `freeAll` and `freeMusic` on pause and mute.
`places/<id>.ts` recipes (lazy): Hearthlog crackle (Poisson clicks 4..9 /s, 2..5 kHz) + low hearth rumble (120..300 Hz breathing at 0.1 Hz) + a log creak
every 25..50 s; Ripple surf swells (low-passed noise 300..900 Hz, a wave every 6..11 s, bubble fizz on the pull-back) + a wandering breeze band;
Frostbell gusts (600..2500 Hz, synced to the Wind Gap zone) + crisp near-silence + rare distant bell partials in D; Puddlebrook patter (dense micro-ticks
30..80 /s, 3..8 kHz, shower envelope) + drips (bubbles r 1.5..3 mm); Fizzwell lapping (200..600 Hz) + the tap stream (1..3 kHz) + bubble pops; Cogwhistle
a soft clock tick on the music's beat (from `musicClock`) + rare spring boings; Lanternroof night gusts (400..1600 Hz) + paper rustle; Echo Hollow drips
with their echo + a very quiet air tone; Cloudloft a high soft wind and slow whooshes. **No birds, insects or animal calls** (D10: the squishies are the
only creatures). `props.ts`: ball, creak, chime, splash, crunch, fire pop, boing, music box (it mutes the bed's mallets while it plays). Player-triggered
prop sounds may use `registerFx`; autonomous ones never do. `MusicStyle` per place changes field weights and mallet timbre only (same key D, same
66 BPM, so ceremonies and REJOIN_RUN stay in tune); the default style is bit-identical (AU-07).

### 9.8 The shell frame (`game.ts simStep`, 548-562, with the new steps in order)
1. gestures, `flushPendingUps`; 2. **LIFE act**: the host applies due queued actions (moveTo, squash, hop, lean, wiggle, glide) for characters it owns
(the arbiter: finger > cut or ceremony > LIFE); 3. `propWorld.beginFrame()`, `bodies.step(dt)` (collide, then step), `propWorld.endFrame(dt)`,
`stage.bindProps`; 4. `drain()`: SoftEvents to feedback **with their source body** (per-body pitch and pan, SHELL map 2), to `collection.feed` only for
player-caused kinds, and into the event bus; 5. **every 6th step (10 Hz): LIFE sense and think**: fill the snapshot in place, `lifeStep`, express
(bubbles, voices, gaze, expressions) through the attention wiring, LifeEvents into the bus; 6. timers, feedback, cut, capsules, ceremonies; 7. **quest
host**: drains the bus into `applyQuestEvent`, friendship and discoveries; completed quests queue their moment; the journal store saves batched (at
most once per 2 s, never per frame). The dev hook's `step` runs all of it, so LIFE is deterministic under the harness.

### 9.9 Quests and the event bus (TypeScript sketch)
```ts
// src/shell/events.ts: a preallocated ring (never emit(): it allocates rest arguments, SHELL map 1)
export interface GameEventRing { n: number; ev: Uint8Array; place: Uint8Array; thing: Int8Array; a: Uint8Array; b: Uint8Array; fam: Uint8Array; sub: Uint8Array; count: Uint8Array; flag: Uint8Array } // cap 64
// src/data/quests.ts
export interface Clause { readonly ev: number; readonly place?: PlaceId; readonly thing?: string; readonly mech?: MechId; readonly sub?: readonly number[];
  readonly family?: MaterialFamilyId; readonly species?: SpeciesId; readonly minN?: number; readonly count: number; readonly distinct?: 'species' | 'family' | 'thing' | 'pair' | 'place' }
export interface QuestDef { readonly idx: number; readonly id: string; readonly chapter: number; readonly main: boolean; readonly title: string; readonly hint: string;
  readonly clauses: readonly Clause[]; readonly withinVisit?: boolean; readonly finale?: { readonly capsule: boolean; readonly keepsake: number } }
// src/core/quests.ts: pure, allocation-free, no clock (day injected), imports no meter or drops function except daySeed / weekKeyOf
export interface QuestState { done: Uint32Array /* 4 words = 128 quests */; prog: Uint16Array /* idx x 3 clauses */; bits: Uint32Array /* idx x 3 x 2 words */; visit: number }
export function applyQuestEvent(st: QuestState, e: GameEventRing, i: number, defs: readonly QuestDef[], active: Int16Array, nActive: number, done: Int16Array): number; // returns how many completed
```

### 9.10 Save format and migration
**Journal** under its own key `wobblehoard:v2:journal` (CORE map 4: old builds never read it, so a rollback cannot eat it), `v: 1`, cap 16 000 chars
(PARK_MAX_CHARS 20 000 parks it whole), its own sanitize / serialize / park / two-tab store cloned from `createHoardStore` (store.ts 498-600), and
`JOURNAL_MIGRATIONS = []` through `migrateVersioned` from day one.
```json
{ "v": 1, "dev": "<deviceId>", "st": 42, "qd": "<base64 128-bit done set>", "qp": [[17, 2, 0, 0, "<bits>"]],
  "ds": [[0, 4127], [10, 3]], "fr": [[0, 10, 9], [3, 12, 4]], "fd": [[10, 4]], "wm": [["<itemId>", 37]],
  "ks": 3, "pl": 7, "pv": [5, 3, 1], "ul": 20407, "wi": [["<itemId>", 3, 1, 20407]], "cur": { "p": 1, "party": ["<itemId>"] }, "day": 20407 }
```
`qd` done set, `qp` in-progress (at most 40), `ds` discovery masks, `fr` friendship [a, b, points] (at most 160), `fd` today's points per pair, `wm`
warmth (at most 100, pruned to ids on the shelf at load), `ks` keepsakes, `pl` places open, `pv` visits, `ul` the day of the last opening, `wi` open
wishes (at most 3), `cur` place and party. Worst case about 6.8 KB (CO-02). **Two tabs**: every field only grows or is a max, so the merge is a union
or a max (simpler than `rebaseHoard`). **Capsule idempotency**: the Hoard owns capsules, so `ghostQuestCapsule(save, chapter)` sets a bit in a new
validated hoard field `questGifts` (migrated by absence, HOARD_VERSION stays 2) in the SAME write as the `ghostTaskCapsules` increment; on load, a
finale marked done in the journal but missing from `questGifts` is granted then. A full task queue (TASK_CAPSULE_CAP 10) leaves the bit unset and the
Journal shows "A gift is waiting". **Migration**: an absent journal is built from the Hoard (met bits for owned species; Home 1 to 4 done when opened
>= 1 and owned >= 2). A newer `v` is read-only in memory. **Settings**: `chatter`, `autonomy` by absence (`SETTING_KEYS`, `OPTIONAL_UNITS`,
`OPTIONAL_BOOLS`, settings.ts 108-110); v stays 2.

### 9.11 Lazy loading
First load (boot already imports physics, stage and audio, boot.ts 95-97): all data, LIFE, the reducer, the journal store, the event bus, the attention
wiring, emotes, creature voices, the prop pass and the Home things. Lazy: one shared **"away" chunk** (PlaceLook host, props kit, water, marks, prop
voices, the ambience bed, the Travel and Journal sheets) and one chunk per place (`render/places/<id>.ts` + `audio/places/<id>.ts`, loaded together by
`import()` with the bare `'three'` specifier so three stays in the stage chunk). When a place opens, its chunk is preloaded on the next idle 2 s.
The G0 gate in `vite.config.ts` (one 1.2 MB total today, line 24) becomes two gates **before any place chunk lands**: first load and total (10.3).

---

## 10. Budgets and proof

### 10.1 Character caps by quality: section 6.3. The 30 ms refusal (`mat.ts` 24) becomes the awake-budget refusal of 10.2.

### 10.2 Frame budget (a mid-range phone, `med`, 16.7 ms)
| Subsystem | Budget (device ms, mean) | How it is held |
|---|---|---|
| physics (all bodies, props, zones) | 6.0 (low 4.0, high 10.0) | sleep, detail 2 at spawn, at most 2 autonomous movers on med; the **awake budget**: the shell times `bodies.step` with `performance.now`; above 85% of budget for 0.5 s, LIFE gets `hush` (no new motion, rest test 0.25 s); above 130% for 2 s, no new character comes out |
| LIFE + attention + quest host | 0.4 | 10 Hz think, at most 0.1 ms a tick (LF-03) |
| shell (gestures, feedback, cut, bus) | 0.6 | |
| UI | 1.0 | the UI.md bar |
| render CPU (mesh updates, culling, uniforms) | 4.5 | asleep bodies skip mesh updates; chunks and background wholes use the low fine mesh |
| audio main thread | 0.5 | at most 10 chatter nodes, 14 ambience nodes steady |
| GC and slack | 3.7 | zero allocation per frame in physics, LIFE, the bus and the reducer; render at most 8.9 KB a frame as today |
Expected quiet-container cost of the med cap scenario (4 wholes, 1 touched): 0.87 (touched, detail 3) + 0.9 (one LIFE mover, detail 3) + 2 x 0.01
(asleep) + about 0.2 (props near the awake ones) = about 2.0 ms. With an assumed phone factor of 3 that is 6 ms: exactly the budget, which is why the
awake budget is measured at run time (R9). PF-01 measures it with Chromium's CPU throttle at 4x.

### 10.3 Size budget (tighter than D9)
| Part | Budget | Note |
|---|---|---|
| today's build | 1139 KB | deployed 2683d349 (STATUS) |
| UI overhaul + SHELL-4 allowance | +90 KB | UI.md 2.7 |
| PLAYGROUND first-load code and data | +60 KB | LIFE 12, data 12, emotes 6, creature voices 6, prop pass + sleep + drivers 10, bus + hosts + journal store 10, settings + tracker 4 |
| **first load** | **at most 1290 KB** (D9 allows 1300) | gate SZ-01 |
| shared "away" chunk | at most 120 KB | |
| each place chunk | at most 45 KB (9 x 45 = 405) | |
| **whole build** | **at most 1850 KB** (D9 allows 2000) | gate SZ-02 |

### 10.4 Test strategy (node first; the browser only proves what node cannot)
1. **Pure lanes in node** (LIFE, DATA, CORE, COLLECTION): deterministic scripts, allocation measured like probe_cut (0 B per 120 frames, :473-499),
   import purity scanners, generated minimal event scripts that must complete every quest, storm tests for the budget.
2. **Physics in node** (`_harness/probe_playground.ts` with `--quick`): every mechanism x 12 families x 3 genomes + pieces at detail 2, hops,
   sleep, water, zones, determinism, cost ratios. The 50-species detail-2 sweep is a heavy job (`--full`), run once per round.
3. **The shell in node** (`node_checks.ts` new section with a moving mock body and the real `SoftBody` as in 7g): host order, touch override, the
   party through a ceremony, cut with a party, the bus, `collection.feed` spies.
4. **Audio offline** (`engine_offline.js`): chatter and ambience stems with the room checks flipped (AUDIO map 5).
5. **Browser last**: per place boot, flash, layout at 390 x 844 and 320 x 568, perf with CPU throttle 4x, screenshots judged by eye.

### 10.5 Acceptance checklist (ids per lane; N = node, B = browser, O = offline audio)
| Id | Check | Bar |
|---|---|---|
| DT-01 N | every PlaceDef: things inside bounds, none in the pad (r 1.2), at least 0.9 m from spawn spots, params inside MECH_RANGES, thickness >= 0.16 m, ball r >= 0.20, lips <= 0.12 m | all pass |
| DT-02 N | every name, line, quest title, hint, keepsake and squishmoji name passes the deny gate, the language gate and the pop dome promise words (gate moved to `_harness/name_gate.ts`, probe_catalog unchanged) | 0 hits |
| DT-03 N | favourites: 50 species resolve to a place and a thing; each place >= 4 species and >= 1 Common | all |
| DT-04 N | best friends: a perfect matching, symmetric, 25 of 25 cross-lane, tier gap <= 1 | all |
| DT-05 N | FAMILY_REACT covers 12 families, values in range | all |
| DT-06 N | every family has >= 3 non-empty reactions in every place | all |
| DT-07 N | data modules flat, acyclic, each loads first in bare node (probe_genome) | all |
| DT-08 N | player text: titles <= 32 chars, hints <= 90, at most one "!" per text, no word over 12 letters | all |
| LF-01 N | determinism: same seed and snapshot script, identical intent hash over 10 sim minutes, 3 seeds | equal |
| LF-02 N | allocation in lifeStep after warm-up | 0 B over 6000 ticks |
| LF-03 N | cost at 16 characters | <= 0.1 ms a tick (median) |
| LF-04 N | a touched character gets 0 motion intents in the same tick and its queue is cancelled | always |
| LF-05 N | 30 sim minutes of LIFE only on the real SoftBody: 0 poke, release, snap events; 0 SP; 0 task progress | 0 |
| LF-06 N | no SCOOT or HOP target outside bounds - (R + 0.2) | 0 |
| LF-07 N | storm (10 wholes + 30 pieces requesting 50 /s): no cap of 5.4 exceeded; Calm halves | 0 over |
| LF-08 N | 6 pieces doing one action within 0.5 s give 1 bubble and 1 voice | exact |
| LF-09 N | every behaviour B01-B17 fires in its scripted scenario; the 5-minute default visit gives per squishy 1 nap, 3..4 greets, 2..3 uses (+-1) | all |
| LF-10 N | motion duty <= 40% per character over 10 min; movers <= the 6.3 cap | <= |
| LF-11 N | no character in two joint behaviours at once | 0 |
| LF-12 N | import purity of `src/life/**` (no three, physics, render, audio, ui, shell, DOM, timers, Date.now, Math.random) | 0 |
| PH-01 N | ice glide distance after a 0.8 m/s nudge per family within +-25% of the 2.1 table; sand stops a slide within 0.3 s | all |
| PH-02 N | 100 random tosses stay inside the bounds + 0.1 m | all |
| PH-03 N | static props (block, bar, bowl, mound) x 12 families x 3 genomes + detail-2 pieces: drop and scoot-into: no fold > 120 deg, no NaN, no particle inside a prop > 1% R | all |
| PH-04 N | seesaw and swing with 2 bodies for 60 s: angle within limits, energy only decays | all |
| PH-05 N | ball: speed <= clamp, never through a wall at full speed, rests within 6 s | all |
| PH-06 N | hop: apex within +-25% of target (12 families x 3 genomes, pieces); no land event at apex <= 3.5 cm; no second hop; no fold > 120 deg; putty and mochi 10 hops in 60 s leave a dent < 0.02 R | all |
| PH-07 N | squash, lean, wiggle keep volume inside the family band (G1) | all |
| PH-08 N | fingerDown during a LIFE driver eases it out within 0.1 s; ceremony drivers untouched | all |
| PH-09 N | sleep within 1.0 s at rest; asleep step <= 0.03 ms; wakes on each listed cause; sleeper pairs skipped; zero position jump on wake | all |
| PH-10 N | determinism with props, zones and sleep; the re-baselined hash rows listed in the report | equal |
| PH-11 N | allocation with props, zones and drivers | 0 B per 120 frames |
| PH-12 N | an awake detail-3 body with 4 props in reach costs <= 1.25x the same body without | <= |
| PH-13 N (heavy) | 50 species at detail 2: rest, press, pull, hop rows; failures go on the DETAIL3_ONLY list | listed |
| PH-14 N | `auto` on hop, pad and fall landings; not on a player toss | exact |
| PH-15 N (S2) | water: float share within +-15% of density for 12 families; no NaN with slosh; clean exits | all |
| PH-16 N (S2) | spring pad apex <= cap for every family; sticky stick time within +-0.1 s | all |
| PH-17 N (S3) | wind, current, magnet accelerations within bounds; no wake under 0.25 m/s^2 | all |
| QU-01 N | reducer pure and allocation-free; `src/core/quests.ts` imports no meter function and no capsule roll text (probe I03) | 0 |
| QU-02 N | every quest completes from its generated minimal event script; replaying the script twice changes nothing | all |
| QU-03 N | fairness rules of 7.3 | all |
| QU-04 N | quest capsules: <= 11 for life, idempotent under replay, reloads and two tabs | exact |
| QU-05 N | probe_economy rows: LIFE-only 30 min = 0 SP; quest capsules per day <= 2 on day 1 and <= 1 after | exact |
| QU-06 N (heavy) | sim_economy with the quest source: meter pace of paying styles unchanged (3.2..3.7); C and K re-quoted | in band |
| CO-01 N | journal store: save, load, hostile JSON, park, newer read-only | all |
| CO-02 N | worst-case journal <= 16 000 chars | <= |
| CO-03 N | two-tab merge is a union or max for every field | all |
| CO-04 N | migration from a v2 hoard completes Home 1 to 4 as 7.10 says | exact |
| CO-05 N | merge warmth = max(parents)/2; warmth ids pruned to the shelf | exact |
| RD-01 B | each place boots (`place=<id>`): 0 console problems; the `sky` section passes | all |
| RD-02 B | gallery of 50 species in each place: closest pair >= 10/255; med/low drift p90 <= 15.8 | all |
| RD-03 B | flash gate per place for every ceremony tier, with the ceremony dim | <= 2 flashes /s |
| RD-04 B | bubbles >= 30 CSS px on 390 x 844, icon against fill >= 3:1, never under the insets | all |
| RD-05 B | 4 asleep bodies cost <= 0.3x the CPU update of 4 awake ones | <= |
| RD-06 B | 6 pieces vs 2 whole frame ratio with the low chunk mesh | <= 1.2 (today 1.32..1.45) |
| RD-07 B | 10 place swaps: programs, textures and geometries back to the Home baseline; context loss restored in a place | equal |
| RD-08 B | set and props of a place <= 60 draw calls | <= |
| RD-09 B | Calm and reduced motion: bubbles fade only, weather x0.3 / none | all |
| RD-10 B | expressions are eyes only (no blush, no mouth) | visual pass |
| AU-01 O | creature syllables: peak -30..-18 dBFS at chatter 1, no click (step < 0.25), tail < -60 dB, on D pentatonic +-10 cents | all |
| AU-02 O | the 6 flavours pairwise >= 3 dB apart in at least one third-octave band | all |
| AU-03 O | storm of 50 requests /s: <= 2 live chatter groups (phone), peak <= one voice + 3 dB | all |
| AU-04 O | music stem pumping metrics unchanged with chatter and ambience running | equal |
| AU-05 O | player effects over chatter and ambience: in-band >= 8 dB | all |
| AU-06 O | each ambience >= 6 dB under the music long-term; pause and mute free its nodes within 0.2 s | all |
| AU-07 O | every existing seeded render bit-identical (new rng streams, default MusicStyle) | equal |
| AU-08 O | sung notes on the sounding field's rest tones +-10 cents, on the eighth grid +-15 ms | all |
| AU-09 O | chatter silent during ceremonies and 1 s after | 0 |
| SH-01 N | LIFE host deterministic under `DebugHook.step`; intents applied the next step | equal |
| SH-02 N | the party is re-placed within 0.5 s after a ceremony ends, after travel and after a Hoard card preview | all |
| SH-03 N | cut with a party: the party stays; the piece limit = min(MAX_PIECES, characters - others) | exact |
| SH-04 N | event bus and hosts allocate 0 B per frame | 0 |
| SH-05 N | a spy on `collection.feed` sees only player-caused events | 0 others |
| SH-06 N | bumps between two untouched bodies under 0.8 m/s make no sound | 0 |
| SH-07 N | travel: reconnect, release locks, then swap; never during a ceremony | all |
| SH-08 N | settings `chatter`, `autonomy` saved by absence, applied live | all |
| SH-09 B | keyboard only: J, P, the Escape order, a Use quest via "Go play with..." | all |
| SH-10 B | 390 x 844 and 320 x 568: no overlap of tracker, Places chip, plate; targets >= 44 px; contrast measured | all |
| SH-11 B | quest moments >= 1 s from bursts, never over a reveal, one live line each | all |
| PF-01 B | med cap scenario in Hearthlog, CPU throttle 4x: physics <= 6.0 ms, LIFE + hosts <= 0.4, UI <= 1.0 (means) | <= |
| PF-02 B | low cap scenario: physics <= 4.0 | <= |
| PF-03 B | cut scenario (3 wholes + 5 pieces, med): physics <= 6.0 | <= |
| PF-04 B | 10-minute soak: no GC pause > 8 ms from src; frame mean stable within 5% | all |
| SZ-01 B | first load <= 1290 KB | <= |
| SZ-02 B | whole build <= 1850 KB; each place chunk <= 45 KB; away chunk <= 120 KB | <= |
| SZ-03 B | no dev names in the production bundle (the existing `bundle` grep + place chunks) | 0 |

---

## 11. What to cut, the slices, the build order

### 11.1 Cut, on purpose
Height fields and slopes in the ground; run-time stiffness or damping changes; per-particle buoyancy bulges; mass-aware collide (it changes tuned
stack rows); run-time detail swaps (S1, S2); more than one free prop per place; sleds, carts and anything else that drives; climbing and boost hops;
dragging props; ceremonies with party members stepping aside (hide, then re-place, as today); autonomous haptics and camera moves; DelayNode echoes;
retuning the music per place; animal sounds; per-instance favourites beyond the one secret twist; any pop or flip reaction for pop dome (not built,
materials.ts 301-305); bubbles in Snap photos.

### 11.2 Slice S1 (one complete place, life, social play, pieces, the first chapters)
Places: Home things + **Hearthlog Cabin**. Physics: ground mods, bounds, static props, hinge1 (seesaw, swing), the ball, drivers, touch gate, sleep,
`auto`, detail-2 wholes at spawn. Zones: warm and cold as flags only (no physics water yet). LIFE: everything in 3 and 4, the budget, voices. Render:
place host, Hearthlog chunk, props kit, gaze, expressions, emotes, the toast and frost looks, marks off, sleep skip, chunk low mesh. Audio: chatter,
creature voices, ambience bed + Hearthlog recipe, prop voices (ball, creak, music box, fire pop). Shell: bus, party, hosts, travel, Journal, tracker,
wishes, settings. Quests: Home, Hearthlog, Friends Everywhere (its place quests complete as places arrive). Why the cabin first: it shows all five
asks with the fewest new physics features (no water, no slopes, no wind), and warmth already makes all 12 families differ (2.2).

### 11.3 Slice S2 (water and cold): Ripple Shore, Frostbell Ridge, Puddlebrook Garden
New: the water zone (deep and shallow), floater, spring pad, ramp, chimes (hinge1, already built), ice and wet patches, prints (marks), snow and rain
weather, the underwater tint and surface, ceremony dim. Building water once opens three places.

### 11.4 Slice S3 (fields and echo): Fizzwell Tub, Cogwhistle Bench, Lanternroof, Echo Hollow, Cloudloft
New: wind (gusts, updraft), current, magnet, spinner with motor, the echo. Everything else is content from the library.

### 11.5 Build order and dependencies
| Step | Work (lanes in parallel) | Needs |
|---|---|---|
| 0 | Gates first: G0 split into first load and total (SZ-01/02); `name_gate.ts` extracted; `probe_life_imports.ts`; contract members added by the synthesizer | none |
| 1 (node only) | DATA (places, life, quests); LIFE (world, brains, attention, voice planning) against scripted snapshots; CORE + COLLECTION (reducer, journal store, `ghostQuestCapsule`); PHYS (mods, bounds, drivers, touch gate, sleep, `auto`) | 0 |
| 2 | PHYS PropWorld (static, hinge1, ball); RENDER place host, emotes, gaze, expressions, looks, sleep skip, chunk mesh; AUDIO chatter bus, creature voices, ambience bed, `musicClock`; SHELL bus, party, LIFE host, attention wiring, quest host | 1 |
| 3 | Hearthlog content (render chunk, audio recipe), Journal UI, Travel, tracker, wishes, onboarding override | 2 |
| 4 | S1 verification: node checks, then browser, perf with throttle; a fix round; independent verifiers (physics; LIFE + shell; render + audio) | 3 |
| 5 | S2 (water first, then the three places) | 4 |
| 6 | S3 (fields, then the five places) | 5 |
**Fitting the existing queue** (STATUS): steps 0 and 1 except PHYS touch no file of SHELL-4 or the UI overhaul, so they can run beside them. The
PHYS part of step 1 edits the table pass, as the queued physics round 3 (the pull-into-the-ground floor, LOCK) does: run round 3 first, then
PLAYGROUND physics on top of the fixed floor code, in one physics owner's hands. The UI overhaul's tokens and components come before step 3's screens.

### 11.6 Top risks and what limits each
| Risk | Limit |
|---|---|
| The phone factor is worse than 3 | the awake budget is measured (R9); caps fall automatically; PF-01 on throttled Chromium before S1 ships |
| Prop edges crease skin | touched particles in the fold-limit list; thickness and lip rules; PH-03 on 12 families x 3 genomes |
| Detail-2 wholes look faceted or fail rows | spawn-time choice only, DETAIL3_ONLY list from PH-13, render low mesh only on med |
| Chatter is not cute | every voice is behind a slider and a cap; the first-listen checklist is part of the S1 verification (nobody has heard the existing sounds either, AUDIO map 6) |
| Water looks wrong around jellies | S2, not S1; one plane + one uniform; the per-place gallery (RD-02) |
| Quest capsules move the week-1 pace | the lever in 7.11 |

---

## 12. Where I push on the decisions (I still design within each)
- **D7**: I agree, and narrow it: background bodies are lighter only by a **spawn-time** detail choice and by sleep. No run-time detail swap in S1 or
  S2 (it pops the body upright and ticks the luminance, PHYS map 4). If S3 still needs more, a swap only while asleep and off-centre.
- **D9**: tightened to 1290 KB first load and 1850 KB total, because all data ships in the first load (R8) and the place code is small when
  places are data on a shared library.
- **D4**: I add two caps the decision does not name: autonomous haptics are always 0 and autonomy never moves the camera. A phone that buzzes
  for something the player did not do feels broken.
- **D12**: the attention arithmetic is pure and lives in `src/life/attention.ts` (node-testable, deterministic); the shell only wires it to the stage
  and audio. Same lane boundaries, one file moved to where it can be tested.
- **D6**: I limit "simple dynamic colliders" to 1-DOF joints plus one free ball per place. More free props need a world-level substep loop, a large
  refactor (PHYS map 2).
- **The RENDER map's "shy with a cheek blush"** conflicts with REFERENCES 3 ("no faces with mouths or blush"): shy here is gaze only.

## 13. What I did not check
I ran no probe, no tsc, no build and no browser. No timing in this file is mine: the physics numbers are the PHYS map's (one quiet run each),
the render numbers the RENDER map's, the economy numbers DESIGN 5.4's. Not measured by anyone: any phone (the factor of 3 in 10.2 is an assumption),
a detail-2 whole's look, hops of any kind, props against soft bodies, water, sleep, the cost of a place's env bake at travel, per-chunk sizes (my KB
budgets are estimates from source sizes: `src/render` 420 KB of source, `src/audio` 228 KB). The scoot over a 0.12 m capsule lip is unproven; if
PH-03 fails, lips drop to 0.06 m. I did not run the name gate on any name here (Glimmer-like names were avoided on purpose: "glimmet" is one edit
away in the wide list). I did not open `src/shell/feedback.ts`, `src/input/keyboard.ts` or `src/collection/store.ts` beyond the maps' line references,
and I did not read PROPOSAL_A (the panel works independently).
