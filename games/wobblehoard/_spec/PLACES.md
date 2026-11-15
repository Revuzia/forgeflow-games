# PLACES: where squishies go, and what they do there

**Status:** final design, 2026-11-15, written by the PLAYGROUND synthesizer from the owner's request (`_handoff/design/DIRECTION.md` 1 and 1b),
the three proposals and the three judgements in `_handoff/design/`. Read with [`LIFE.md`](LIFE.md) (what squishies do by themselves),
[`QUESTS.md`](QUESTS.md) (the Journal) and [`PLAYGROUND_BUILD.md`](PLAYGROUND_BUILD.md) (how it is built, budgets, checks, the decisions table).
Where this page and a proposal differ, this page wins. Paths are relative to `games/wobblehoard`.

**Owner asks this page serves:** ask 1 (places: Home plus nine places beyond it, the owner's beach, snowy mountain and log cabin among them)
and ask 2 (things in each place that every material family uses in its own way). The checks named here (DT-, PH-, RD-, FN-, CS-) are defined in
`PLAYGROUND_BUILD.md` section 18.

Coordinates: metres, x to the right, **z toward the default camera** (positive z is the front), y up. Sizes are full sizes unless marked "half".

---

## 1. Rules every place follows

| # | Rule | Why (evidence) |
|---|---|---|
| P1 | **The ground under the play area is flat, at y = 0.** Places differ by ground patches, per-body ground modifiers, props and zones. Hills, dunes, mountains and walls far away are backdrop cards only. | A height field touches about 20 physics sites tuned on a flat table (PHYS map 1, E1 "large, high risk"); decals, marks, the capsule rest and every ceremony assume y = 0 (RENDER map 1, 6, 7). |
| P2 | **Every collider part is at least 0.16 m thick** (box sides, capsule and ring segment diameters, posts); a ball's radius is at least 0.20 m. | Contact is particle only; the largest mean edge that can touch a prop is a detail-2 piece of a big body, 0.123 m; 1.3 x that is 0.16 m (JUDGE_FEASIBILITY F18). |
| P3 | **Nothing climbs.** Every use a squishy starts by itself is at floor level: in or out of a ring through its gap, onto a flush pad or a flush turntable, into shallow water, past a chime, against a block. Seesaws, swing seats, rafts, ramp tops and mound tops are **rides the player sets up** (pick up and drop, toss, or the keyboard's "Go play with..."). A squishy that wants a ride shows a **ride wish** (a star in a thought bubble) beside it. | A hop over 4 cm reaches the `land` threshold (softbody.ts 155, 2285); `moveTo` is a horizontal glide (softbody.ts 1863-1873), so a 0.16 m lip is unproven (JUDGE_FEASIBILITY K9); the ride wish gives the player a purpose (JUDGE_FUN F13). |
| P4 | **Water is shallow everywhere:** a water surface is at most **0.30 m** above the ground (pools, baths, the steam pool, the glow pool; puddles, surf and dishes 0.04 to 0.12 m). No rims to climb: the edge of the water is a render-only ring (foam, bubbles, steam, glowing moss, frost) that hides the water's side, and a 0.4 m depth ramp in physics so nothing pops at the edge. | The lowest eye anchor of any whole squishy is about 0.40 m (R 0.40 at an eye elevation of 3 degrees): every resting body keeps its eyes above water, so nothing ever looks like drowning (JUDGE_FUN F11, JUDGE_COHERENCE M12). Who floats is generated from data (2.5). |
| P5 | **At most 8 moving props and 20 collider primitives per place** (a ring counts its segments, at most 6); at most **one free prop** (a ball). Every moving prop is a 1-DOF joint (hinge or slider) or the one ball. | Props integrate once a frame with a one-frame lag, stable only for damped 1-DOF joints and one clamped ball (PHYS map 2, E5); the broad phase is a bounding-sphere test per primitive per substep, so the cap keeps it small (PH-12 measures it). |
| P6 | **A clear ceremony pad**: a disc of r 1.2 m at (0, 0) with no thing in it; the capsule lands there and the reveal plays there. **Six spawn spots**, each at least 0.9 m from every thing. | Ceremonies assume a clear pad at (0, 0) on y = 0 (RENDER map 7); a body brought onto an occupied spot pops out (STATUS known open). |
| P7 | **Default frame:** play bounds a rounded rectangle, half sizes 3.4 x 2.4 m, corner radius 0.8, centred at (0, 0); the soft rim bounce of today (RIM_BOUNCE 0.35) at the open front; walls and parapets are static boxes. Things sit in four bands around the pad: left and right (abs x 1.3 to 3.4), back (z -2.4 to -1.3) and front (z 1.3 to 2.4, low things only, at most 0.4 m tall, so nothing hides the party from the camera). | A body is 0.8 to 1.25 m across (R 0.4 to 0.625, shape.ts 68); 6.8 x 4.8 m holds 5 wholes with room to move. |
| P8 | **The camera frames the whole play bounds** (`StageLike.setPlayBounds`); the player orbits (yaw within 60 degrees of the place's front, pitch 0.15 to 0.9 rad) and zooms (0.7 to 1.6) as today. **Autonomy never moves the camera.** | JUDGE_COHERENCE M10: a follow of a wandering party is autonomous camera motion. |
| P9 | **Colours are mixes of the 8 `theme.ts` tokens** in OKLCH (ink, plum, dusk, felt, amber, lagoon, coral, cream; `src/ui/theme.ts` 4-13) with their derived tones; no other hue. Words like "brass", "copper" or "wood" in this page name the thing, not a new colour: the look is an amber, coral or plum mix. No pastel (L at least 0.80 with chroma under 0.09 is forbidden, the probe_catalog pastel rule). **Play-area mean linear luminance at most 0.35** (CS-06), so the additive glows, light pools and rings still read; a bright place keeps the ceremony dim (eases in at least 1.0 s, counted by the flash probe). | JUDGE_COHERENCE M13; the look is built on a dark backdrop (RENDER map 7). |
| P10 | **No animals and no people**: things are objects, plants and weather; no bird, insect or animal sounds in any ambience. The squishies are the only creatures. | DIRECTION D10. |
| P11 | **Physics reactions use only these channels:** water (density, drag, current for floating bodies), ground modifiers (grip, glue, peel, drag, ice), prop contact (friction, the body's own stiffness, bounce, slosh and plastic memory), pad gain, warm and cold **poses** (`setSquash`, only while the family's memory has converged), and wind or updraft **on airborne or floating bodies only**. Everything else is a look (L), a sound (S) or a behaviour (B). No run-time stiffness or damping change; no tack or strings on props (a sticky body grips a prop by friction, and its strands when it leaves are a look the shell triggers). | Wind on a grounded body needs 15 to 27 m/s^2 to slide it (softbody.ts 2221, 2245-2250): it does nothing visible (JUDGE_FEASIBILITY K3, F8). Tack is table-only and strands come from fingertips only (softbody.ts 2241-2271, 2825-2831; F9). A stiffness change re-gates 12 families (PHYS map 5). |
| P12 | **Tabletop gravity in every place.** The Float setting applies only to a single squishy at Home with autonomy paused; elsewhere the shell overrides it once, with the line "Here your squishies stand on the ground." | The float hover pulls every body to the world origin (softbody.ts 1918-1926): a party in float mode collapses to the middle (JUDGE_FEASIBILITY F10). |
| P13 | **One signature verb per place, found nowhere else, and one finale spectacle per place** (looks and sound only, inside the flash gate, a slow fade in Calm). No mechanism is the headline of more than 3 places. | JUDGE_FUN F12, 6.2. |
| P14 | **Weather particles** have caps per tier, x0.3 in Calm and none with reduced motion; snow, rain, bubbles and wisps use the normal-blend particle twin (an additive flake vanishes on a pale sky); embers and sparkles stay additive. | RENDER map 1. |
| P15 | **Pop dome is never promised a pop, a flip or a snap** in any text (its bistable snap is planned, not built: materials.ts 301-305). | CORE map 2(b). |
| P16 | **Every name passes the gate split of section 7** and the place-versus-species rule (CS-05). | JUDGE_COHERENCE M6. |

---

## 2. The shared library: everything in every place is built from it

### 2.1 The 14 mechanisms (`MECH` ids in `src/data/places.ts`; parameter ranges in `MECH_RANGES`, checked by DT-01)

| Id | Mechanism | Shape and joint | Parameters (allowed range) | Moves? | A squishy uses it by itself? |
|---|---|---|---|---|---|
| M1 | block | box, fixed | each side 0.16..3.0 m; mu 0.3..1.5 | no | leans on it, hides behind it (peekaboo), bumps it (a strike if it is tuned) |
| M2 | bar | capsule, fixed (lying, standing or as an arch) | r 0.08..0.30, length 0.3..3.0 m | no | leans on it, parades under an arch |
| M3 | mound | sphere, fixed, centre below ground | r 0.6..1.2, top 0.15..0.30 m above ground | no | leans against it; on top only when set there (it slides off) |
| M4 | ring (nest) | 4 to 6 capsule segments on a circle, fixed, lying on the floor, with a gap to the front | ring r 0.70..1.00; segment r 0.08..0.10 (top 0.16..0.20 m); gap 80..110 degrees and a gap chord of at least 1.0 m | no | walks in and out through the gap; naps inside (a body inside is grounded, so it can sleep) |
| M5 | ramp | box, fixed, tilted, with capsule side rails | angle at most 16 degrees; top at most 0.55 m; mu 0.05..0.6 | no | **ride**: slides down when the player sets it at the top; asks with a ride wish |
| M6 | pool | a water zone over flat ground with a render-only edge ring | surface 0.04..0.30 m; a 0.4 m physics depth ramp at the edge | via the zone | walks in and out anywhere; floats or wades by its family (2.5) |
| M7 | seesaw | box board on hinge1 (horizontal axis) | board thickness at least 0.16; pivot 0.12..0.20 m; limit at most 14 degrees; I 0.3..0.8; damping 0.6..1.5 /s | yes | **ride**: two the player sets on it teeter by themselves (small hops in turn) |
| M8 | swing | capsule seat on hinge1 hung from a pivot | rope 1.2..1.5 m; limit at most 30 degrees (seat speed at most 2.0 m/s: v = sqrt(2 g L (1 - cos limit)), 1.94 m/s at 1.4 m and 30 degrees); seat r 0.08..0.10 at 0.15..0.22 m; damping 0.15..0.4 /s | yes | pushes a friend's seat from behind (floor level); riding is a **ride** |
| M9 | turntable | disc box on hinge1 (vertical axis), **flush: its top at y = 0**, optional motor | r 0.5..0.8; motor at most 0.4 rad/s (rim at most 0.3 m/s) | yes | walks onto it and rides round |
| M10 | chime | small capsule or box hanging on hinge1 at body height, struck by contact | note from D major pentatonic (MIDI 62..83); limit 25 degrees; damping 0.8 /s; hang height 0.30..0.70 m | yes (light) | bumps past it: it swings and rings |
| M11 | pad | disc box on slider1 (vertical), **flush: top at y = 0 at rest**, kicks up when struck | r 0.35..0.6; travel up at most 0.10 m; gain 1.0..1.25 x the family's bounce gain; apex cap at most 0.35 m; at most 5 bounces in a row | yes | walks on, one small hop, and the pad does the rest |
| M12 | floater | box or ring of capsules on slider1 in a water zone, wave drive, anchored in x and z | bob at most 0.04 m at at most 0.4 Hz | yes | a floating squishy drifts into it and rests; a sitter pushes it; on top is a **ride** |
| M13 | ball | sphere, free (3 translations; spin is look only) | r 0.20..0.30; mass 0.10..0.40 body masses (a body mass = (R / 0.5)^3 x frac); roll damping 0.3..1.5 /s; speed clamp 2.0 m/s; optional flags: steel (a magnet pulls it), rattle | yes | boops it, chases it, passes it |
| M14 | switch | a flag on any thing: a tap toggles a zone, a motor, a tune, a shower, an echo or the fire | toggles only; never moves a body | no | never (player only); squishies watch and react |

**Why flush pads and turntables:** a pad or a turntable with its top at y = 0 has no lip, so a squishy walks onto it at floor level and the table
pass and the prop pass agree at rest. The pad never goes below the ground (the table holds every particle at y >= 0): it **kicks up** when a body
lands on it (velocity = gain x landing speed, capped by the apex). This is the one place this page changes a proposal's mechanism (C's pads had a
0.12 m lip, C's spinner a 0.10 m rim lip); PLAYGROUND_BUILD.md decision D-21.

### 2.2 The 9 zone kinds (`ZONE` ids; axis-aligned boxes or discs, strength 0..1)

| Zone | Physics? | Effect |
|---|---|---|
| water | YES | Whole-body buoyancy as a **gravity scale**: g_eff = g x (1 - f_sub / density), f_sub = the submerged share of the body's bounding sphere, density = the family's (2.4) x its soak. When g_eff >= 0 the body is a **sitter** and today's supported fade applies (it rests and may sleep); when g_eff < 0 it **floats** (rises until f_sub = density) with water drag 2.5 /s on the velocity relative to the water. Shallow water (surface at most 0.12 m) gives drag, splash and wet only. No per-particle buoyancy. |
| current | YES (floating only) | a water velocity field (a ring or a band), at most 0.15 m/s; moves floating bodies and floaters; a sitter only gets a wet look ripple |
| wind | YES (airborne or floating only) | gusts by data (every 6..45 s for 1.6..2.5 s); acceleration catch(family) x strength x 1.2 m/s^2 on airborne or floating bodies only; on the ground it is a LIFE "hold on" pose (a render lean into the gust) and looks (ruffles, snow streaks); under 0.25 m/s^2 it never wakes a sleeper |
| updraft | YES (airborne only) | an airborne body inside the column falls with gravity x (1 - 0.4 x catch): a marshmallow tossed or bounced into it floats down at 0.6 g |
| magnet | YES (props only) | pulls a ball with the steel flag at most 0.8 m/s^2, falloff 1 / (1 + d^2); bodies are never pulled: bead squeezes scoot toward it by themselves (LIFE) and rattle |
| warm | no (flag) | looks (toast, gloss, glow), warm poses through LIFE, dries soak at 0.1 /s, rest need rises faster |
| cold | no (flag) | looks (frost, snow cap), LIFE shiver (render sway 7 Hz) and the family's cold speed, voices a semitone lower before the snap to key |
| wet | grip only | wet look; grip x 0.8 (sticky stretch and slime x 1.0); foams soak at their soak rate |
| echo | no (flag) | audio: every creature phrase gets one scheduled repeat (+220 ms, -12 dB, low-passed; no DelayNode) |

**Ground patches** are discs or boxes with their own modifiers and marks (ice, rug, wet sand, moss, stepping stones, a felt pad, a bath mat). The
shell reads the patch under each body's centre at 10 Hz and writes that body's `mods` (contracts.ts PLAYGROUND); physics eases every modifier over
0.3 s. Ice: grip = the family's ice grip (2.4) and drag 0.25 (drag is baked today and applied to the whole velocity, softbody.ts 766, 2658: ice
needs it mutable).

**Ground marks** (`MARK` ids: print, trail, dust, dent, glow): one ring buffer of instanced quads per place (64 / 48 / 24 by tier), stamped by
the shell on landings and every 0.25 m of travel, depth and life from the family (2.4) x the place's ground factor.

### 2.3 The place frame (every PlaceDef)

Play bounds (P7), walls, the pad (P6), six spawn spots, a camera framing box and its limits (P8), a light preset (key, rim and fill as token mixes;
the jelly light uniforms and white balance follow it), a sky preset (the 9 sky uniforms of `table.ts` 198-204, or a place sky shader), a ground
look (a ground mesh with its own noise, top at y = 0; the felt is Home's), 3 to 6 backdrop cards, a weather preset, an ambience recipe id, a
music style id, a ceremony-dim amount, a signature verb event id and a finale spectacle id.

### 2.4 The family numbers (`FAMILY_REACT: Record<MaterialFamilyId, FamilyReact>` in `src/data/life.ts`; `MATERIAL_FAMILIES` is not touched, probe_materials.ts 34-37)

| Family | density dry / soaked | soak per s | ice grip x | catch | bounce gain | warm pose (squash target) | cold speed x | print depth / life | gait (LIFE.md 5.2) | voice flavour |
|---|---|---|---|---|---|---|---|---|---|---|
| slowrise | 0.15 / 1.20 | 0.18 | 0.35 | 0.8 (0.3 soaked) | 0.5 | 1.00 (it dries) | 0.6 | 0.7 / 12 s | sink | foam |
| marshmallow | 0.11 / 0.40 | 0.06 | 0.30 | 1.0 | 0.6 | 1.00 (toast look) | 1.0 (it fluffs) | 0.4 / 6 s | pad | foam |
| mochidough | 1.10 | 0 | 0.40 | 0.2 | 0.45 | 1.06 (it rises) | 0.7 | 0.8 / 40 s | plod | dough |
| jellygel | 1.02 | 0 | 0.15 | 0.35 | 1.10 | 0.92 (it relaxes) | 1.0 + shiver | 0.25 / 8 s | jiggle | gel |
| waterfill | 1.00 | 0 | 0.15 | 0.25 | 1.00 | 1.00 (steam look) | 1.0 + shiver | 0.2 / 6 s | slosh | gel |
| putty | 1.25 | 0 | 0.45 | 0.10 | 0.40 | 0.97 (it softens) | 0.7 | 1.0 / 120 s | shuffle | dough |
| stickystretch | 1.05 | 0 | 0.70 | 0.15 | 0.60 (the pad holds it 0.4 s) | 0.95 (it sags) | 1.0 + shiver | 0.4 / 20 s | peel | sticky |
| slimegoo | 1.08 | 0 | 0.80 | 0.10 | 0.50 (held 0.6 s) | 0.82 (it oozes flat) | 0.5 | 0.6 / 30 s trail | ooze | sticky |
| firmsilicone | 1.15 | 0 | 0.08 | 0.10 | 1.25 | 1.00 (basks) | 1.15 | 0.15 / 5 s | boing | firm |
| popdome | 0.14 | 0 | 0.10 | 0.6 | 1.20 | 1.00 (basks) | 1.15 | 0.15 / 5 s ring | bob | firm |
| gummy | 1.10 | 0 | 0.12 | 0.3 | 1.15 | 0.92 (glossy) | 1.0 + shiver | 0.25 / 8 s | chew | gel |
| beadsqueeze | 1.45 | 0 | 0.25 | 0.15 | 0.80 | 1.00 (basks) | 1.0 (clinky) | 0.6 / 30 s bumpy | crunch | beads |

Reasons for the numbers: densities are a **toy's** densities, chosen so the families read differently in 0.28 m of water (2.5): the foams and the
pop dome cap float (a puffy foam toy and an air-trapping dome), everything else wades, and a soaked foam sinks back to the floor. Ice grip ranks
the glide: firm silicone (2.25 x 0.08 = 0.18 effective mu) zooms, sticky stretch (2.75 x 0.70 = 1.9) barely moves (PH-08 checks the ranking).
Warm poses are `setSquash` targets eased over 1.5 s and ended by any touch; putty, mochi and bead squeeze pose only while their memory has
converged (max |MEM - Q| < 0.02 R, LIFE.md 5.4), so a Stamp print still heals as FUN 1 says. The voice flavours are the six of
`src/audio/cut.ts` 35-41.

### 2.5 Who floats: the generated float table (DT-10, never typed by hand)

A body resting on the floor floats when the submerged share of its sphere at that depth is more than its density: share(h, R) = h^2 (3R - h) / (4 R^3).
For the standard pool surface **0.28 m**: share = 0.282 at R 0.40, 0.191 at R 0.50, 0.128 at R 0.625. So:

| Family | R 0.40 | R 0.50 | R 0.625 | What a child sees |
|---|---|---|---|---|
| marshmallow (0.11) | floats | floats | floats | rides highest, drifts with the current, bobs on the waves |
| pop dome (0.14) | floats | floats | sits | floats upright like a little boat (the three pop domes are R 0.45 to 0.48, so they float) |
| slow-rise, dry (0.15) | floats | floats | sits | floats, then soaks over about 6 s and settles to the floor; dries and floats again later |
| slow-rise and marshmallow, soaked (1.20 / 0.40) | sits | sits | sits | settles to the floor, squirts when squeezed |
| every other family (1.00 to 1.45) | sits | sits | sits | wades: stands in the water with its eyes well above it |

The data probe computes this per family x radius band x every water zone and fails if a reaction cell in sections 3 and 4 says "floats" where the
table says "sits" (or the reverse). It also checks the eye line: the lowest eye anchor of every species (rest radius x (0.95 + sin 3 deg) at the
smallest instance size) stays at least 0.10 m above every water surface where bodies can rest (CS-07). Floating bodies rise, so their eyes rise.

---

## 3. The families in places: the default reaction by channel

When a thing has no cell of its own in section 4, its reactions come from these tables, by its mechanism and zones. So a tenth place gets every
family's reactions by construction (DT-06 checks that every family has at least 3 non-empty reactions in every place). Tags: **P** physics (felt),
**L** look, **S** sound, **B** behaviour (LIFE).

### 3.1 Water, warmth and cold

| Family | Pool (0.28 m) | Shallow (puddle, surf, dish) | Rain, drips, showers | Warm (hearth, sun, steam, chimney, lamp) | Cold (snow, draught, cave, mountain) |
|---|---|---|---|---|---|
| slowrise | floats, soaks over 6 s, settles P; squirts when squeezed L S | soaks from below L, soft plip S | soaks, darker L; drips when squeezed L | dries out L, sleepy bask B | rises even slower B, frost on top L |
| marshmallow | floats highest, drifts, bobs P | barely wets L, a puff S | soggy and dark L | toasts golden, never burnt L, sizzle pop S | fluffs up, a little frost L |
| mochidough | wades, a tacky shine L | squelchy steps S, wet print L | shiny and tacky L | rises like dough (pose 1.06) P | stiff and slow (scoot x0.7) B, matte L |
| jellygel | wades, glints through the water L | wobbly splash S | water beads on the gloss L | relaxes a little flatter (0.92) P, more gloss L | shivers B, frosty rim L |
| waterfill | wades, clear water in water L | sloshy splash S | drops run down its skin L | steam wisps L | shivers B, a slower slosh look L |
| putty | wades like a rock P, dull gloss L | deep long print L, thup S | keeps drip dimples L | softens a little (0.97) P | stiff and slow B |
| stickystretch | wades, drops cling L | sticks a moment, peel sound S | drops cling to it L | sags, stringier look L | shivers B |
| slimegoo | wades and spreads a slick ring L | oozes a wet trail L | glossier, drippy L S | oozes flat (0.82) P | slow ooze (x0.5) B |
| firmsilicone | wades, splashes on landing S | skips and splashes S | water beads off L | basks B | zippy (x1.15) B |
| popdome | floats upright like a little boat P | plink splash S | water rings on top L | basks B | zippy B |
| gummy | wades, a little shine L | chewy splash S | shiny L | glossy and relaxed (0.92) P L | shivers B |
| beadsqueeze | wades, a muffled rattle under water S | crunchy splash S | rattly drips S | basks, softer rattle S | crisp, clinky rattle S |

### 3.2 Ground, air, pads and rides

| Family | Ice and slick floors | Sand, snow, cloud, dust, moss | Airborne in wind or an updraft | Pads (M11) | Rides set up by the player (M5, M7, M8, M9, M12) |
|---|---|---|---|---|---|
| slowrise | short glide P | slow print that rises back L | drifts a little when dry P | sinks in, small boing P | sinks into the seat, rides calmly L B |
| marshmallow | short glide, spins slowly P | light quick print L | floats down slowest, drifts most P | soft boing P | rocks softly, squashes on each tip P |
| mochidough | sticky, short glide P | deep print for 40 s L | falls almost straight P | thud, little boing P | sags onto the seat, rocks slowly P |
| jellygel | glides far P | quick shiny print L | a little slower fall P | good boing, long wobble P | wobbles all the way round P |
| waterfill | glides and sloshes P | wet print L | a little slower fall P | sloshy boing P | sloshes against the motion P (the inner slosh) |
| putty | barely slides P | deepest print, lasts 2 min L | falls straight P | thud, no boing P | takes the seat's shape for a while P (memory) |
| stickystretch | clings, hardly slides P | sticky print L | falls almost straight P | sticks 0.4 s, then springs P | grips the seat P |
| slimegoo | hardly slides, leaves a trail P L | wet trail L | falls straight P | sticks 0.6 s, slow peel P | slides off slowly P |
| firmsilicone | fastest glide P | faint print L | falls fast P | best boing, highest P | bounces off the ends P |
| popdome | fast glide P | ring print L | floats down slowly like a cap P | high boing P | rides upright P |
| gummy | glides P | quick print L | a little slower fall P | quick high boing P | bounces a little P |
| beadsqueeze | spins and rattles P S | bumpy print L | falls fastest, rattles S | rattly boing P S | rattles on every turn S |

### 3.3 Balls, rings, chimes, the magnet, echoes and tunes

| Family | Balls (M13) | Rings, nests, nap spots | Chimes, bells, crystals (M10, tuned M1) | Magnet field | Echo | A tune (music box, kettle, clock) |
|---|---|---|---|---|---|---|
| slowrise | nudges it gently B | sinks in and naps longest B | pats them softly, quiet ring S | looks puzzled, watches the marble B | a soft, low answer S | sways slowly, dozes B |
| marshmallow | barely moves it P | squashes into a pillow P | soft pat S | watches the marble B | breathy answer S | sways B |
| mochidough | stops it dead P | settles heavy, keeps the ring's print P | dull tap S | watches B | warm hum answer S | sways B |
| jellygel | boops it far P | piles on top of others P | clear ring S | boops the marble P | clear answer S | sways, wobbling B |
| waterfill | boops it, sloshes P | sloshes to sleep L | ring with a glug S | boops it P | gurgly answer S | sways, slosh in time B |
| putty | sits on it, it stops P | takes the ring's shape P | dull tap S | stops the marble dead P | low hum answer S | leans on the beat B |
| stickystretch | carries it a little (grip) P | sticks to a friend in the pile, strands when it leaves L | the chime sways after it leaves L | carries the marble a little P | nasal answer S | sways B |
| slimegoo | slows it down P | oozes over the edge a little P | wet tap S | slows the marble P | wet answer S | sways B |
| firmsilicone | boinks it far P | bounces in, settles last B | loudest ring S | boinks the marble far P | bright answer S | hops on the beat B |
| popdome | taps it, it rolls P | sits in it like a lid P | bright ring S | taps it P | squeaky answer S | taps on the beat B |
| gummy | chases it first B | piles on top P | chewy ring S | chases the marble first B | candy answer S | sways B |
| beadsqueeze | rolls with it S | settles with one rattle S | rattly ring S | scoots toward the magnet and rattles B S | rattly answer S | rattles in time S |

### 3.4 Which places have which channels (DT-06 reads this)

| Place | pool | shallow | rain | warm | cold | ice | prints | wind or updraft | pads | rides | ball | ring | chimes | magnet | echo | tune |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | | | | x | | | | | x | | x | x | | | | x |
| Hearthlog Cabin | | | | x | x | | | | | x | x | x | | | | x |
| Ripple Shore | x | x | | x | | | x | | | x | x | | x | | | |
| Frostbell Ridge | x | | | x | x | x | x | x | | x | x | x | x | | | |
| Rainleaf Garden | | x | x | | | | x | | x | x | x | | | | | |
| Fizzwell Tub | x | | x | x | | x | | | | x | | | | | | |
| Cogwhistle Bench | | | | x | | | x | | x | x | x | | x | x | | x |
| Lanternroof | | x | | x | | | | x | | x | | | | | | |
| Echo Hollow | x | x | | | x | x | x | | | x | | | x | | x | |
| Cloudloft | | | | x | | | x | x | x | x | x | x | | | | |

---

## 4. The ten places

Each place lists its look, ground, zones, things (with the mechanism and numbers), the family-by-thing table (the cells that override section 3),
its **signature verb** and **finale spectacle**, and its sound. Positions are design intent: the data lane may move a thing by up to 0.5 m to pass
DT-01 and must report each move. Ambience recipes are built from the existing synthesis blocks (AUDIO map 2 and 4); no animal sounds.

### 4.1 Home (idx 0; today's felt mat; S0 and S1)

**Look.** Unchanged: the dusk sky dome, the dark felt mat (felt token) under the amber softbox key and the lagoon rim, evening, no weather. With no
thing out it is today's frame bit for bit. **Ground** felt, every modifier 1.0, so every existing probe row stays valid. **Bounds** today's corral
for mat bodies; a disc of r 3.1 m when LIFE drives them. **Spawn** today's `stage.matLayout(n)` slots (stage.ts 87-88; nested). **Zones** Lamp
Warmth (warm 0.4, disc r 0.8 around the Warm Lamp).

**Things arrive one by one** (so minute 0 stays clean and Home grows as you play). They stand in six spots clear of the mat slots: front centre
(0, 1.6), back centre (0, -2.85), back corners (+-2.4, -1.4) and front corners (+-2.2, 1.6). Checked by a script against stage.ts 87-88 (both
layouts, up to 5 bodies, body scale 0.8 to 1.25, every body taken as R 0.625): the smallest gap between a thing's edge and a body is 0.17 m (a
shelf corner) and at least 0.26 m for every other thing. A ring does not fit there (a 0.7 m ring overlapped a body by up to 0.25 m), so Home's
nap spot is a flat patch, the Snooze Rug.

| Thing | Arrives | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|---|
| Felt Ball | at the start | M13 ball r 0.22, mass 0.2, roll damping 0.6 /s, at (0, 1.6) | tap or flick it to roll it | notice it, hop to it, boop it (the first minute, QUESTS 9); pass it between two |
| Music Box | at the start | M1 block 0.40 x 0.30 x 0.30 + M14 tune, at (2.4, -1.4) | tap it: an 8-bar tune in the sounding field (the bed mutes its mallets), at most once per 12 s | sway on the beat and sing along (Sing together) |
| Snooze Rug | after the first hello | ground patch, a darker stitched felt disc r 0.7 at (-2.3, -1.3), grip 1.15, a nap spot (rest falls twice as fast) | carry a sleepy one there | sleepy ones go there to nap; two or more make a snuggle pile |
| Warm Lamp | after the first capsule | M1 base 0.36 x 0.20 x 0.36 + warm zone r 0.8 + M14 dim and bright, at (2.2, 1.6) | tap it: dim or bright | bask in the glow (sun bubble); marshmallows go faintly golden (toast at most 0.3) |
| Keepsake Shelf | with the Home finale | M1 block 1.8 x 0.32 x 0.36 at (0, -2.85), holds up to 20 keepsakes (QUESTS 7) | tap a keepsake: it rings or glows and says where it came from | look at a new keepsake with a sparkle |
| Bounce Pad | after the Hearthlog finale | M11 pad r 0.40, flush, gain 1.1, apex cap 0.30 m, at (-2.2, 1.6) | drop a squishy on it: boing | bouncy ones walk on and bounce three times |

| Family | Felt Ball | Snooze Rug | Warm Lamp | Music Box | Bounce Pad |
|---|---|---|---|---|---|
| slowrise | nudges it gently B | naps first and longest B | dozes in the glow B | hums low and slow S | sinks in, small boing P |
| marshmallow | barely moves it P | squashes flat as it naps P | faint golden glow L | breathy coo S | soft boing P |
| mochidough | stops it dead P | naps and flattens P | rises a little (1.04) P | warm hum S | thud, little boing P |
| jellygel | boops it far P | dozes when tired B | glows warm through L | clear chirps S | good boing, long wobble P |
| waterfill | boops it, sloshes P | dozes as its slosh settles P | warm core glow L | gurgly coo S | sloshy boing P |
| putty | sits on it, it stops P | naps and holds a dent P | softens a little P | low hum S | thud, no boing P |
| stickystretch | carries it a little P | naps beside a friend, strands when it leaves L | sags a little P | nasal trill S | sticks, then springs P |
| slimegoo | slows it down P | spreads out flat L B | oozes flatter P | wet hum S | sticks, slow peel P |
| firmsilicone | boinks it far P | rarely naps, it would rather play B | basks B | bright chirps S | best boing, highest P |
| popdome | taps it, it rolls P | naps at the edge B | basks B | squeaky chirps S | high boing P |
| gummy | chases it first B | dozes in a pile B | glossy look L | candy chirp S | quick high boing P |
| beadsqueeze | rolls with it S | naps as its beads settle P S | basks, softer rattle S | rattly trill S | rattly boing P S |

**Signature verb:** things arrive one by one, and the keepsake shelf rings. **Finale spectacle:** the first wish comes true as you travel (the
postcard in Dollop's thought bubble unfolds into the place). **Sound:** today's music bed, no ambience. **Music style** `home` (bit-identical).

### 4.2 Hearthlog Cabin (idx 1; the owner's forest log cabin; **slice S1**)

**Look.** Inside a small log cabin on an evening deep in the woods. Round-log walls in plum and dusk; a stone hearth whose firelight is the amber
key, warmer than Home; a window at the back where snow falls past dark pines (a backdrop card; the flakes stay behind the pane) gives the lagoon
rim; a braided rug in coral and cream on dusk-dark floorboards. Embers drift up from the hearth (additive, 24 / 16 / 8 by tier, x0.3 in Calm, none
with reduced motion). Mean luminance about 0.20 (no ceremony dim needed).
**Ground** boards: grip 0.9, glue 1.0, peel 1.0, drag 1.0, no marks. **Rug** patch: disc r 1.4 at (0.8, 0.9), grip 1.25, glue 1.1, a nap spot.
**Walls** log walls (M1, 0.3 m thick, 2.4 m tall) on the back and both sides; the front is open with the rim bounce.
**Zones** Hearth Warmth: warm 1.0 inside 0.8 m of the hearth, falling to 0.4 at 1.8 m, centred at (-2.4, -1.6). Window Draught: cold 0.3, box
1.8 x 1.2 at (2.4, -1.9). **Spawn** (-1.5, 0.6), (1.5, 0.6), (0, 1.5), (-0.6, -0.9), (0.8, -0.8), (2.4, 0.9).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Hearth | M1 block 1.4 x 0.9 x 0.5 at (-2.4, -2.15) + Hearth Warmth + M14 fire: the fire puffs up for 5 s (more embers, a louder crackle) | tap it: the fire grows | bask; marshmallows toast golden and **hop round to toast their other side**; mochi rises; slime oozes flat; slow-rise dries out |
| Rocker Board | M7 seesaw at (2.4, -0.6): board 1.6 x 0.16 x 0.6, pivot 0.16 m, limit 12 degrees, I 0.45, damping 0.9 /s | poke an end to rock it; set two squishies on the ends | **ride**: two set on it teeter by themselves; one alone shows a star wish for a partner |
| Yarn Ball | M13 ball r 0.24, mass 0.2, roll damping 0.5 /s, starts at (1.0, 1.5) | tap or flick it | chase it, boop it, pass it between friends; sticky ones carry it a little |
| Pillow Swing | M8 swing, pivot (-1.6, 1.62, -1.9), rope 1.4 m, seat capsule r 0.09 x 0.9 m at 0.22 m, limit 30 degrees, damping 0.25 /s | set a squishy on the seat; poke the seat to push | push a friend's seat from behind; ride is a **ride** |
| Snug Basket | M4 ring r 0.90, 6 segments r 0.09, gap 100 degrees toward the room, at (-2.4, 0.0), inside the warmth | drop squishies in | pile up and nap, warm from the hearth (a pile of 3 fits) |
| Singing Kettle | M1 stove block 0.5 x 0.5 x 0.4 + a kettle sphere r 0.22 on top, at (2.6, -1.95) + M14 tune; it also sings by itself every 30 to 50 s (seeded) with a steam puff (wet look +0.2 within 0.6 m for 4 s) | tap it: it sings now | everyone turns to look; the chatty ones **answer the kettle** with their own call (Use LISTEN) |

| Family | Hearth Warmth | Rocker Board | Yarn Ball | Pillow Swing | Snug Basket | Singing Kettle | Window Draught |
|---|---|---|---|---|---|---|---|
| slowrise | dries out, sleepy bask L B | sinks into the board, rocks calmly P | nudges it gently B | sinks into the seat L | naps first and longest B | the steam soaks it a little L | rises even slower B |
| marshmallow | toasts golden, then turns round L B | rocks softly, squashes on each tip P | barely moves it P | puffs up as it swings L | squashes into a pillow P | dewy L | fluffs up, a little frost L |
| mochidough | rises like dough (1.06) P | sags onto the board, rocks slowly P | stops it dead P | sags into the seat P | settles heavy P | answers with a warm hum S | stiff and slow B |
| jellygel | relaxes flatter (0.92), glows warm L P | wobbles as it rocks P | boops it far P | wobbles all the way round P | piles on top P | answers with a clear chirp S | shivers B |
| waterfill | steam wisps L | sloshes against the rock P | boops it, sloshes P | the water inside goes the other way to the swing P | sloshes to sleep L | gurgles back S | a slower slosh look L |
| putty | softens and sags (0.97) P | thuds on the low end P | sits on it P | takes the seat's shape for a while P | takes the basket's shape P | answers low S | stiff and slow B |
| stickystretch | sags, stringier look L | grips the board P | carries it a little P | grips the seat P | sticks to a friend, strands when it leaves L | nasal trill S | shivers B |
| slimegoo | oozes flat (0.82) P | oozes along the board P | slows it down P | slides off slowly P | oozes over the edge P | wet hum S | slow ooze B |
| firmsilicone | basks B | rocks it hard, bounces on each tip P | boinks it far P | big swings P | bounces in, settles last B | bright chirp S | zippy B |
| popdome | basks B | stiff rock P | taps it P | rides upright P | sits in it like a lid P | squeaky chirp S | zippy B |
| gummy | glossy and relaxed (0.92) P L | rocks, chews P | chases it first B | bounces a little P | piles on top P | candy chirp S | shivers B |
| beadsqueeze | basks, softer rattle S | rattles like beans in a pot S | rolls with it S | rattles at the top S | settles with one rattle S | rattly trill S | clinky rattle S |

**Signature verb:** marshmallows toast and turn round; the kettle sings and they answer. **Finale spectacle:** the fire swells and everyone sings
with the music (two bars on the sounding field, the embers rise in time; Calm: a slow glow). **Sound:** ambience = Poisson crackle 4 to 9 per s at 2 to
5 kHz, a low hearth rumble (120 to 300 Hz breathing at 0.1 Hz), a log creak every 25 to 50 s, a soft window hush; prop sounds creak (the rocker, a
held voice keyed by prop), ball, chime-less kettle tune, fire puff. **Music style** `cabin` (more dusk and home fields, a warmer low-passed mallet).
**Why S1:** it shows all five asks with the least new physics (no water, no ramps, no field forces): warmth poses already make the families differ
in their bodies, and the hinge, the ball and the ring are the only mechanisms it needs (JUDGE_FEASIBILITY 6, JUDGE_COHERENCE 5.2).

### 4.3 Ripple Shore (idx 2; the owner's beach; S2)

**Look.** A sandy cove in late-afternoon gold: a lagoon sky lifted toward cream at the horizon (zenith kept at or under L 0.55), a deep lagoon
sea band at the back with slow cream surf lines, amber-cream sand that turns felt-dark where it is wet, a few dark rocks; the low sun is the
cream-amber key, the sea light the rim; a few warm spray motes. Mean luminance about 0.32 with the ceremony dim on.
**Ground** sand: grip 1.35, glue 0.8, peel 0.9, drag 1.1, prints fade in 40 s. Wet Sand patch (the band nearest the surf): grip 1.1, darker prints.
**Zones** Rock Pool (water, surface 0.28 m, disc r 1.3 at (2.3, -1.1), a gentle current ring of 0.08 m/s); Surf Edge (shallow water, a band at
the back, z < -1.9, surface 0.06 m rising to 0.12 m on a wave every 7 to 10 s: splash and wet); Sun (warm 0.4, the whole place).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Rock Pool | M6 pool r 1.3, foam and rock edge ring (render), current ring 0.08 m/s | toss or carry squishies in | walk in and out; floaters float and drift round, the rest wade |
| Bob Ring | M12 floater ring r 0.45 of 6 capsule segments r 0.08, bob 0.03 m at 0.3 Hz, in the pool | drop a floater into it | a floating one drifts into the ring and rests there; a wader pushes it |
| Driftwood Log | M2 bar r 0.18, length 2.0, lying at (-2.4, -1.4) | set a squishy on it (it rolls off) | peekaboo over it; two lean on it side by side |
| Shell Chimes | M10 x5 hanging capsules r 0.08 x 0.20 on an M2 frame (posts r 0.08), notes D5 E5 F#5 A5 B5, at (-2.8, 0.6) | tap each shell | bump past them and play a little tune; a wave's breeze rings one now and then |
| Pebble Ball | M13 ball r 0.22, mass 0.3, roll damping 1.2 /s (it stops sooner in sand), at (0.9, 1.6) | tap or flick it | pass it; chase it into the surf |
| Sand Mound | M3 sphere r 0.9, top 0.25 m, at (-1.2, -1.9) | set a squishy on top: it slides off | lean against it; jelly and gummy slide off fastest |

| Family | Rock Pool | Surf Edge | Sand and Sun | Bob Ring | Shell Chimes | Pebble Ball | Sand Mound |
|---|---|---|---|---|---|---|---|
| slowrise | floats, soaks over 6 s, settles P L | soaks from below L | dries and rises in the sun L | drifts into the ring and rests (dry) P | taps one shell softly S | nudges it B | slides off slowly P |
| marshmallow | floats highest, drifts round P | barely wets, a puff S | sandy powder look L | drifts into the ring P | soft tap S | barely moves it P | slides off softly P |
| mochidough | wades, picks up wet sand L | squelchy steps S | deep prints that last 40 s L | pushes the ring P | dull tap S | stops it dead P | slides off slowly, sandy L |
| jellygel | wades, glints through the water L | wobbly splash S | sandy speckles L, basks B | pushes the ring, wobbles P | clear ring, chirps the note back S | boops it far P | slides off fast P |
| waterfill | wades and sloshes P | sloshy splash S | dries clear L | sloshes beside the ring P | gurgles the note back S | boops it, sloshes P | slides off, sloshes P |
| putty | wades like a rock P | deep long print L | deepest prints, heal in 2 min L | thuds the ring away P | dull tap S | sits on it, it stops P | sits on top, barely slides P |
| stickystretch | wades, sand clings L | sticks a moment, peel sound S | coated in sand L | grips the ring P | the shell sways after it leaves L | carries it a little P | grips the mound, slow slide P |
| slimegoo | wades, a slick ring on the water L | oozes a wet trail L | collects sand L | slows the ring P | wet tap S | slows it down P | oozes down slowly P |
| firmsilicone | wades, splashes S | skips and splashes S | grippy and clean L | bumps the ring away P | loudest ring S | boinks it far P | slides off fastest P |
| popdome | floats upright like a little boat P | plink splash S | clean L | bobs in the ring P | bright ring S | taps it P | slides off fast P |
| gummy | wades, a little shine L | chewy splash S | sandy freckles L | pushes the ring P | candy chirp S | chases it first B | slides off fast P |
| beadsqueeze | wades, a muffled rattle S | crunchy splash S | crunches the sand S | rattles against the ring S | rattly ring S | rolls with it S | crunchy slide P S |

**Signature verb:** soak a foam in the pool, then squeeze it to **squirt a friend** (the squirt game: the player's squeeze of a soaked foam sends a
12-drop arc, 4 in Calm, at the nearest squishy in front; it blinks wide, then giggles). **Finale spectacle:** the sky warms to sunset and they snuggle
in a row. **Sound:** low-passed surf swells (300 to 900 Hz, a wave every 6 to 11 s) with a bubble fizz on the pull-back, a wandering sea breeze
band; no gulls. **Music style** `shore` (more lift and glow fields).

### 4.4 Frostbell Ridge (idx 3; the owner's snowy mountain; S2)

**Look.** A high snowy ledge on a clear, cold morning: a lagoon sky fading to cream at the horizon, a low cream sun with long light, dusk-blue
shadows, plum mountain silhouettes, packed snow (cream with lagoon and dusk, held at L 0.80 or under, so the jellies still read) with a
band-limited sparkle, a frozen pond with a dark gloss and a little steaming pool. Flakes drift (normal blend, 80 / 60 / 30). Ceremony dim on.
**Ground** packed snow: grip 1.0, glue 0.9, drag 1.05, prints fade in 90 s; a snow cap builds on still bodies (look 0 to 0.3 over 10 s).
**Ice Pond** patch: disc r 1.4 at (1.9, -0.9): grip = the family's ice grip, drag 0.25, no prints.
**Zones** Mountain Cold (cold 0.6, the whole place); Steam Pool (water, surface 0.26 m, + warm 1.0, disc r 1.0 at (-2.3, -1.2)); Wind Gap (wind
gusts across the back third every 9 to 14 s for 2 s, strength 0.6: airborne bodies drift, grounded ones hold on, snow streaks).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Ice Pond | ground patch | flick a squishy across it | a scoot onto it becomes a long glide (a nudge of 0.6 to 1.0 m/s): firm ones zoom, sticky ones barely move |
| Glide Ramp | M5 ramp 2.0 x 0.16 x 0.9 at 14 degrees, top 0.50 m, mu 0.10, rails, ending at the ice, at (2.9, -1.9) | set a squishy at the top | **ride**: slides down onto the ice when set there; the others watch and cheer; a star wish asks for it |
| Steam Pool | M6 pool r 1.0, a steam edge ring (render) | toss a chilly one in | walk in and warm up; the frost melts off |
| Icicle Bells | M10 x4 hanging bars r 0.08 x 0.25, notes A4 D5 E5 A5, under an M2 rail, at (-2.9, 0.7) | tap each one | ring them when they pass; a wind gust rings them too |
| Snowdrift Nest | M4 ring r 0.85, 5 segments r 0.10 (snow look), gap 100 degrees, at (-1.9, 1.7) | drop squishies in | pile up and nap out of the wind |
| Snowball | M13 ball r 0.25, mass 0.35, roll damping 0.6 /s, at (0.6, 1.6) | tap or flick it | push it to a friend: it rolls into them and leaves them snowy (+0.3) |
| Shake Pine | M2 trunk r 0.12, 1.2 m tall + a branch on M8 hinge1 (capsule r 0.08, 0.5 m, pivot at 0.95 m, limit 20 degrees, damping 2 /s), at (-0.6, -2.0) | tap it: it shakes | a bump on the trunk at 0.3 m/s or more swings the branch: a snow puff falls on anyone within 0.7 m (snow +0.5, a wow) |

| Family | Snow and Cold | Ice Pond and Glide Ramp | Steam Pool | Shake Pine | Snowball | Icicle Bells | Snowdrift Nest |
|---|---|---|---|---|---|---|---|
| slowrise | frosts slowly, rises even slower L B | short glide P | floats if small, soaks P | snow cap, a slow wow L B | nudges it B | pats them softly S | sinks in and naps longest B |
| marshmallow | a frosted sugar crust L | short glide, spins slowly P | floats highest; the frost melts off P L | snowy cap L | barely moves it P | soft pat S | squashes into a pillow P |
| mochidough | frost dusting, stiff and slow L B | slow, sticky glide P | wades and rises in the steam (1.06) P | snowy L | stops it dead P | dull tap S | settles heavy, keeps the print P |
| jellygel | frost on its gloss, shivers L B | glides far, wobbles P | wades, glows L | snow cap, wiggles half of it off L B | boops it P | clear ring S | piles on top P |
| waterfill | frosts first, its voice a step lower L S | glides and sloshes P | wades, steam wisps L | snowy L | boops it, sloshes P | ring with a glug S | sloshes to sleep L |
| putty | stiff-looking frost, slow L B | barely slides P | wades slowly P | the snowball dents it P | sits on it P | dull tap S | takes the nest's shape P |
| stickystretch | frost L | grips the ice, barely moves P | wades L | snowy L | carries it a little P | the bell sways after it leaves L | sticks to a friend in the pile L |
| slimegoo | frosty glaze, slow ooze L B | oozes, does not slide P | wades and spreads P | snowy L | slows it P | wet tap S | oozes over the edge P |
| firmsilicone | zippy in the cold B | skates far with a squeak P S | wades, skips S | snowy, shakes it off fast L | boinks it far P | loudest ring S | bounces in, settles last B |
| popdome | zippy B | slides flat P | floats upright P | snowy cap like a hat L | taps it P | bright ring S | sits in it like a lid P |
| gummy | shivers B | glides P | wades, shines L | snowy L | chases it P | chewy ring S | piles on top P |
| beadsqueeze | crunches every step S | spins and rattles across P S | wades, rattles S | rattles under the snow S | shoves it P | rattly ring S | settles with one rattle S |

**Signature verb:** glide on the ice pond; a bump on the pine drops a snow cap on a friend. **Finale spectacle:** the snow slows and the stars come
out over a snuggle. **Sound:** gusts at 600 to 2500 Hz synced to the Wind Gap, crisp near-silence between, a snow crunch on prints, rare distant bell
partials in D. **Music style** `ridge` (glow and home fields, a sparser mallet).

### 4.5 Rainleaf Garden (idx 4; S2)

**Look.** A corner of a garden in soft rain at dusk: giant leaves overhead (backdrop cards, one real drip leaf), dark loam, shallow splash spots
that mirror the plum sky, coral mushroom caps on the cards, flat grey-dusk stepping stones set into the loam. Rain streaks (normal blend, 120 / 80
/ 40); showers come and go (40 s on, 30 s off). A dim cream key, a lagoon rim.
**Ground** damp loam: grip 0.85, wet trails fade in 20 s. **Stepping Stones** patch: a curved path of 6 flush stones (grip 1.1, no prints).
**Zones** Rain (wet, the whole place, with the shower envelope); Splash Spots (three shallow water discs, surface 0.06 to 0.08 m, r 0.6 to 0.9);
Leaf Drip (wet 1.0 under the drip leaf, a disc r 0.6).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Splash Spots | M6 x3 shallow pools, no edge ring (a puddle needs none) | toss a squishy in: a big splash | hop into them: **puddle jumps** (a small hop that lands in the water: splash, wet) |
| Leaf Teeter | M7 seesaw: a leaf board 1.8 x 0.16 x 0.8 on a pebble pivot 0.16 m, limit 10 degrees, at (2.4, -0.9) | poke an end; set two on it | **ride**: two set on it teeter |
| Moss Bouncer | M11 pad r 0.45, flush, a soft moss look, gain 1.2, apex cap 0.30 m, at (-2.4, -0.3) | drop a squishy on it | walk on, a little hop, boing, boing |
| Drip Leaf | M1 stalk 0.20 x 1.6 x 0.20 + a leaf card + Leaf Drip zone + M14 shower, at (-1.6, -2.0) | tap it: the leaf tips a shower | stand under it for a shower; foams soak and then squirt |
| Stepping Stones | ground patch path | line squishies up on it | follow the leader along the stones |
| Seed Pod | M13 ball r 0.20, mass 0.15, the rattle flag, at (0.8, 1.6) | tap or flick it | roll it, chase it (it rattles as it rolls) |

| Family | Rain and Drip Leaf | Splash Spots | Leaf Teeter | Moss Bouncer | Stepping Stones | Seed Pod |
|---|---|---|---|---|---|---|
| slowrise | soaks, darker, drips when squeezed L | soaks from below L | sinks into the leaf, rocks calmly P | sinks in, small boing P | a slow print that rises back L | nudges it B |
| marshmallow | soggy and dark, dries later L | barely wets, a puff S | rocks softly P | soft boing P | a light print L | barely moves it P |
| mochidough | shiny and tacky L | squelchy steps S | sags onto the leaf P | thud, little boing P | a deep print for 40 s L | stops it dead P |
| jellygel | water beads on the gloss L | wobbly splash S | wobbles as it tips P | good boing, long wobble P | a quick shiny print L | boops it far P |
| waterfill | drops run down its skin L | sloshy splash S | sloshes on every tip P | sloshy boing P | a wet print L | boops it, sloshes P |
| putty | keeps drip dimples L | a deep long print L | thuds on the low end P | thud, no boing P | the deepest print, 2 min L | sits on it P |
| stickystretch | drops cling to it L | sticks a moment, peel sound S | grips the leaf P | sticks, then springs P | a sticky print L | carries it a little P |
| slimegoo | glossier, drippy L S | oozes a wet trail L | oozes along the leaf P | sticks, slow peel P | a wet trail L | slows it P |
| firmsilicone | water beads off L | skips and splashes S | rocks it hard P | best boing, highest P | a faint print L | boinks it far P |
| popdome | water rings on top L | plink splash S | stiff tip P | high boing P | a ring print L | taps it P |
| gummy | shiny L | chewy splash S | rocks, chews P | quick high boing P | a quick print L | chases it first B |
| beadsqueeze | rattly drips S | crunchy splash S | rattles on each tip S | rattly boing P S | a bumpy print L | rattles with it S |

**Signature verb:** puddle jumps; the drip leaf showers whoever is under it. **Finale spectacle:** the rain stops and the leaves drip one by one in
key (five drips on D pentatonic, a falling-tone sparkle each; Calm: three, slower). **Sound:** dense patter micro-ticks (30 to 80 per s, 3 to 8 kHz,
with the shower envelope), drips as small bubbles (r 1.5 to 3 mm), a soft leaf rustle. **Music style** `garden` (home and lift fields).

### 4.6 Fizzwell Tub (idx 5; S3; it also fulfils FUN.md's "Float" activity)

**Look.** Inside a big old bathtub at lamplight: amber-deep taps and plum enamel walls at the back, warm water in deep lagoon with a soft caustic
shimmer over the **back half** of the tub floor, a coral-and-cream bath mat on the dry front half (where the pad is), foam islands, rising bubbles
(normal blend, 40 / 30 / 15), a little steam at the top. An amber lamp key, a lagoon rim from the water. Bodies in the water get the
under-the-waterline tint.
**Ground** tub floor: grip 0.7, glue 0.8; **Bath Mat** patch (the front half): grip 1.3. **Walls** the tub's sides (M1, 0.3 m thick) on the
back and both sides.
**Zones** Bath Water (water, surface 0.28 m, a box over the back half, z < -0.2, with the 0.4 m depth ramp at its front edge); Tap Swirl (current ring
r 1.0 around the tap, 0.12 m/s, while the tap runs); Warm Water (warm 0.6 inside the bath water); Bubble Patch (wet, a disc r 0.7, with bubbles).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Bath Water | M6 pool, the back half, a foam edge ring at its front edge | toss or carry squishies in | walk in and out; floaters float and bob, sitters sit **side by side with them** |
| Tap | M1 block 0.4 x 0.5 x 0.3 at (0, -2.2) + M14 water on or off (the swirl, the bubbles, the swirl ride's motor) | tap it: the water runs | everyone looks; floaters drift round on the swirl |
| Swirl Ride | M9 turntable r 0.7, flush, under the water at (-2.0, -1.4), motor 0.2 rad/s while the tap runs | set squishies on it | walk onto it and **ride round on the tap swirl** |
| Soap Slide | M5 ramp from the tub's right side into the water, 12 degrees, top 0.45 m, mu 0.05, at (2.8, -1.2) | set a squishy at the top | **ride**: slides in with a splash; a star wish asks for it |
| Sponge Raft | M12 floater box 1.0 x 0.20 x 0.7, bob 0.03 m at 0.25 Hz, anchored at (2.0, -1.6) | drop squishies on it | a floating one drifts against it; on top is a **ride** (foams on it dry out) |
| Bubble Patch | zone + bubble particles, a disc r 0.7 at (-0.6, -1.7) | poke squishies through it | stand in it and fizz (bubbles cling, a giggly trill) |

| Family | Bath Water | Tap and Swirl | Swirl Ride | Sponge Raft | Bubble Patch | Soap Slide |
|---|---|---|---|---|---|---|
| slowrise | floats if small, then soaks and settles P L | drifts round while it floats P | rides round calmly P | drinks the raft's water, settles L | fizzes, darker L | slides in slowly P |
| marshmallow | floats highest, bobs P | drifts round the tap P | rides round softly P | dries out on the raft L | fizzes, a soft puff S | slides in softly P |
| mochidough | wades, shiny L | stays put B | rides round, sagging P | sags onto the raft P | fizzy dimples L | a sticky, slow slide P |
| jellygel | wades, glows through the water L | wobbles in the ripples L | wobbles round P | wobbles on the raft P | bubbles cling and glitter L | slides far, splash S |
| waterfill | wades, clear water in water L | sloshes as the swirl passes L | sloshes round P | sloshes on the raft P | gurgles S | slides and sloshes P |
| putty | wades like a rock P | stays put B | takes the disc's shape a little P | takes the raft's shape P | dimpled by bubbles L | barely slides P |
| stickystretch | wades, drops cling L | stays put B | grips, rides round P | grips the raft P | bubbles cling L | grips, slow ride P |
| slimegoo | wades and spreads, a slick ring L | stays put B | slides outward slowly P | oozes over the edge P | glossy and bubbly L | a slow slide, a trail L |
| firmsilicone | wades, splashes S | stays put B | rides round fast P | bounces on the raft P | fizzes S | the fastest slide, a big splash P S |
| popdome | floats upright like a little boat P | drifts round the tap P | rides upright P | sits on it like a lid P | bubbles ring its top L | a fast slide P |
| gummy | wades, shines L | stays put B | rides round P | bounces a little P | fizzes, a giggly trill S | a fast slide P |
| beadsqueeze | wades, rattles under water S | stays put B | rattles on every turn S | rattles on the raft S | rattles in the bubbles S | a crunchy slide S |

**Signature verb:** floaters bob and sitters sit, side by side; ride round on the tap swirl. **Finale spectacle:** bubbles rise in a slow column
around the party. **Sound:** lapping (200 to 600 Hz), the tap's stream (1 to 3 kHz) while it runs, bubble pops. **Music style** `bath` (glow field,
a rounder mallet).

### 4.7 Cogwhistle Bench (idx 6; S3)

**Look.** A tinker's workbench at night under one desk lamp: a dark wood-grain top in plum and dusk, a felt pad, amber-deep cogs and springs, a
pegboard in plum, the lamp's amber cone as the key, a cool lagoon window glow as the rim; dust motes in the cone (additive).
**Ground** bench top: grip 1.0, dust prints fade in 15 s. **Felt Pad** patch: disc r 1.2, grip 1.3.
**Zones** Magnet Field (magnet 0.8, disc r 1.2 around the magnet: pulls the steel marble only); Lamp Warm (warm 0.5 in the cone's footprint).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Spinning Cog | M9 turntable r 0.7, flush, a cog-tooth look, motor 0.25 rad/s while wound, at (-2.3, -0.8) | wind it with the key; set squishies on it | walk on and **ride it round**; a little dizzy after (a swirl) |
| Wind-up Key | M1 block 0.3 x 0.3 x 0.3 + M14 motor: the cog turns for 30 s, at (-2.4, -2.0) | tap it | watch the cog start |
| Spring Plate | M11 pad r 0.40, flush, gain 1.1, apex cap 0.25 m, at (2.2, -1.4) | drop a squishy on it | walk on, boing |
| Horseshoe Magnet | M1 block 0.5 x 0.4 x 0.3 + Magnet Field + M14 on or off, at (2.6, 0.6) | tap it: on or off | bead squeezes scoot toward it and rattle; the rest look puzzled |
| Steel Marble | M13 ball r 0.20, mass 0.25, the steel flag, roll damping 0.5 /s, at (0.6, 1.6) | tap or flick it | boop it; **the magnet rolls it** to itself when it is on |
| Tick Clock | M1 tall box 0.25 x 0.7 x 0.15 at (0.9, -2.2); its pendulum is render only; it ticks on every music beat (66 BPM) | tap it: it chimes the hour (one bell, in key) | everyone within 1.5 m sways on the beat (a render sway) |
| Little Bell | M10 one bell (box 0.2 x 0.25 x 0.2 on hinge1), note D5, at (-0.9, -2.0) | tap it | bump it: ding |

| Family | Spinning Cog | Spring Plate | Magnet and Steel Marble | Tick Clock | Little Bell | Lamp Warm and dust |
|---|---|---|---|---|---|---|
| slowrise | rides round calmly P | sinks in, small boing P | watches the marble roll B | sways slowly, dozes B | pats it softly S | dozes in the lamp light B |
| marshmallow | rides round softly P | soft boing P | watches the marble B | sways B | soft pat S | a faint golden glow L |
| mochidough | rides round, sagging P | thud, little boing P | watches B | sways B | dull tap S | rises a little P |
| jellygel | wobbles round P | good boing, long wobble P | boops the marble P | sways, wobbling B | clear ding S | glows warm L |
| waterfill | sloshes round P | sloshy boing P | boops it P | sways, the slosh in time B | ding with a glug S | a warm glow L |
| putty | takes the cog's shape for a while P | thud, no boing P | stops the marble dead P | leans on the beat B | dull tap S | softens a little P |
| stickystretch | grips, rides round P | sticks, then springs P | carries the marble a little P | sways B | the bell sways after it leaves L | sags a little P |
| slimegoo | slides outward slowly P | sticks, slow peel P | slows the marble P | sways B | wet tap S | oozes flatter P |
| firmsilicone | rides round fast P | best boing P | boinks the marble far P | hops on the beat B | loudest ding S | basks B |
| popdome | rides upright P | high boing P | taps it P | taps on the beat B | bright ding S | basks B |
| gummy | rides round P | quick high boing P | chases the marble first B | sways B | candy ding S | glossy L |
| beadsqueeze | rattles on every turn S | rattly boing P S | scoots toward the magnet and rattles B S | rattles in time S | rattly ring S | basks B |

**Signature verb:** wind the cog and ride it round; the magnet rolls the steel marble. **Finale spectacle:** the cog, the spring plate and the bell
play one tune together (a four-note figure on the beat). **Sound:** a soft clock tick on the music's beat (from `musicClock`), rare spring boings, a
lamp hum. **Music style** `bench` (lift field, a drier mallet).

### 4.8 Lanternroof (idx 7; S3)

**Look.** A flat rooftop terrace on a clear moonlit night: an ink sky with slowly twinkling stars (a shader, never a flash), a big cream moon, city
silhouettes far below in dusk, a string of paper lanterns in amber and coral as the warm key, the moon as the cool rim, a chimney breathing warm air.
**A parapet** on the back and both sides (M1, 0.3 m thick, 0.6 m tall) and a low one at the front (0.3 m, just outside the bounds), so a toss
never looks like a fall off a roof.
**Ground** roof tiles: grip 1.1, no marks. **Chimney Corner** patch: a warm nap spot, disc r 0.9.
**Zones** Night Breeze (wind gusts every 6 to 10 s for 2.5 s, strength 0.8: airborne bodies drift, the vane turns, the lanterns sway, grounded ones
hold on); Chimney Warmth (warm 0.8, disc r 1.0); Moon Dish (shallow water 0.06 m, a disc r 0.6).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Lantern Line | M10 x5 low paper lanterns (box 0.22 x 0.28 x 0.22) hung from a line at 0.40 to 0.70 m, at (-2.6, -1.7) to (-0.6, -2.1); each glows brighter for 3 s when bumped (light, a paper rustle, no note) | tap each lantern | bump them as they pass: they glow |
| Vane Disc | M9 turntable r 0.6, flush, no motor; each gust turns it a little (a torque on the prop), at (2.3, -0.7) | push it round with a poke | ride it when the breeze turns it |
| Clothesline Hammock | M8 swing (a cloth seat capsule r 0.10 x 1.0 m), rope 1.3 m, limit 28 degrees, at (2.4, 1.0) | set a squishy on it; poke to push | push a friend's hammock from behind |
| Chimney Corner | M1 chimney 0.6 x 1.4 x 0.6 at (-2.6, 0.6) + Chimney Warmth + the Chimney Corner patch | drop sleepy ones there | pile up and nap in the warm |
| Moon Dish | M6 shallow dish r 0.6 at (0.9, 1.7) | toss a squishy in | sit by it and **gaze at the moon** (a moon bubble) |
| Star Scope | M1 block 0.3 x 0.5 x 0.3 + M14: a slow comet crosses the sky (no flash, about 6 s), at (-0.9, 1.7) | tap it | everyone looks up at the comet |

| Family | Night Breeze | Lantern Line | Vane Disc | Clothesline Hammock | Chimney Corner | Moon Dish and Star Scope |
|---|---|---|---|---|---|---|
| slowrise | holds on with a slow lean B | glows a lantern softly L | rides round calmly P | sinks into the cloth L | naps first and longest B | gazes up, dozes B |
| marshmallow | leans into the gust, ruffled L B | a soft bump, a warm glow L | rides round softly P | squashes into the cloth P | toasts faintly L | gazes up, the moonlight on its sugar L |
| mochidough | stays put, ruffled L | a dull bump L | rides round, sagging P | sags into the cloth P | rises a little P | gazes up B |
| jellygel | sways in the breeze B | a clear glow L | wobbles round P | wobbles in the hammock P | relaxes flatter P | the moon glints in it L |
| waterfill | sways, a slosh look L | a glow with a glug S | sloshes round P | sloshes as it swings P | steam wisps L | the moon shows through its water L |
| putty | stays put L | a dull bump L | takes the disc's shape a little P | takes the hammock's shape P | softens P | gazes up B |
| stickystretch | grips the tiles P | the lantern sways after it leaves L | grips, rides round P | grips the cloth P | sags, stringier L | gazes up B |
| slimegoo | grips the tiles P | a wet bump L | slides outward slowly P | oozes over the edge P | oozes flat P | gazes up B |
| firmsilicone | leans hard into the gust B | a bright glow L | rides round fast P | big swings P | basks B | gazes up B |
| popdome | holds on like a cap B | a bright glow L | rides upright P | a stiff swing P | basks B | gazes up B |
| gummy | wobbles B | a candy glow L | rides round P | bounces a little P | glossy L | gazes up B |
| beadsqueeze | barely notices, rattles S | a rattly bump S | rattles round S | rattles at the top S | basks, a soft rattle S | gazes up B |

**Signature verb:** gaze at the moon; the breeze turns the vane they sit on. **Finale spectacle:** the lanterns glow one by one in time with their
song. **Sound:** night gusts (400 to 1600 Hz), paper rustle, a far city hum (very low, no traffic sounds). **Music style** `roof` (dusk field, a
soft mallet).

### 4.9 Echo Hollow (idx 8; S3)

**Look.** A hollow under the hill lit only by crystals: walls in ink and plum, crystal clusters glowing lagoon and dusk-violet, a glow pool that
throws light ripples, drips that catch the light, slow glow motes (additive). A rock dome instead of a sky. Crystal light is the key (lagoon), a crack
of daylight the amber rim.
**Ground** smooth stone: grip 0.8, drag 0.95, wet trails fade in 25 s. **Glow Moss Bed** patch: disc r 1.0, grip 1.2, glowing prints fade in 10 s,
a nap spot.
**Zones** Echo (the whole place, audio); Cave Cool (cold 0.3); Glow Pool (water, surface 0.26 m, disc r 1.1: floating bodies get +0.3 core glow,
wading ones a glow rim); Drips (wet spots x3, r 0.4).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Singing Crystals | M1 x5 blocks 0.3 x 0.6 x 0.3 in a curved row, each rings D5 E5 F#5 A5 B5 when bumped (a struck tuned block), at (-2.8, -1.6) to (-0.8, -2.1) | tap them in turn: a tune | walk along the row and play a scale |
| Glow Pool | M6 pool r 1.1, a glowing-moss edge ring, at (2.2, -1.0) | toss squishies in | walk in; floaters float and glow brighter |
| Stone Slide | M5 ramp 14 degrees, top 0.50 m, mu 0.15, rails, at (2.9, 1.2) | set a squishy at the top | **ride**: slides down when set there; a star wish asks for it |
| Glow Moss Bed | ground patch at (-2.2, 1.0) | drop sleepy ones there | pile up and nap; their prints glow |
| Echo Stone | M1 block 0.5 x 0.4 x 0.5 + M14 echo boost: for 20 s every voice echoes twice, at (0.8, 1.7) | tap it | **call into the cave and answer the echo** (Echo talk) |
| Hum Rock | M3 mound r 0.9, top 0.25 m, at (-0.6, -2.0) | set a squishy on top (it slides off) | peekaboo behind it; lean on it |

| Family | Echo (voices) | Singing Crystals | Glow Pool | Stone Slide | Glow Moss Bed | Hum Rock |
|---|---|---|---|---|---|---|
| slowrise | a soft, low answer S | pats them softly S | floats if small, glows brighter P L | slides slowly P | naps longest, glowing prints L B | leans on it, dozes B |
| marshmallow | a breathy answer S | soft pat S | floats and glows P L | slides softly P | a light glowing print L | peekaboo B |
| mochidough | a warm hum answer S | dull tap S | wades, a soft glow L | a slow sticky slide P | a deep glowing print L | leans on it B |
| jellygel | a clear answer S | clear ring S | wades, glows right through L | glides far P | a quick glowing print L | peekaboo, wobbles B |
| waterfill | a gurgly answer S | ring with a glug S | wades, the glow shows through its water L | slides and sloshes P | a wet glowing print L | peekaboo B |
| putty | a low hum answer S | dull tap S | wades slowly, a glow on top L | barely slides P | the deepest glowing print L | takes a little of its shape P |
| stickystretch | a nasal answer S | strands off the crystal L | wades, glows L | grips, a slow slide P | a sticky print L | grips it B |
| slimegoo | a wet answer S | wet tap S | wades and spreads a glowing ring L | a slow slide, a glowing trail L | a glowing trail L | oozes against it P |
| firmsilicone | a bright answer S | loudest ring S | wades, splashes S | the fastest slide P | a faint print L | peekaboo, quick B |
| popdome | a squeaky answer S | bright ring S | floats upright, glows P L | a fast slide P | a ring print L | peekaboo B |
| gummy | a candy answer S | chewy ring S | wades, shines L | a fast slide P | a quick print L | peekaboo B |
| beadsqueeze | a rattly answer S | rattly ring S | wades, rattles S | a crunchy slide S | a bumpy glowing print L | rattles against it S |

**Signature verb:** call into the cave and answer the echo. **Finale spectacle:** the crystals glow a scale as they sing. **Sound:** drips with
their echo, a very quiet air tone, the echo on every creature voice (audio rule, AUDIO map 5: no DelayNode). **Music style** `hollow` (glow field,
longer note tails, still no delay node).

### 4.10 Cloudloft (idx 9; S3)

**Look.** On top of the clouds at sunrise: the sky from dusk-violet down to amber at the horizon, a low warm sun (amber key), a cream rim, a cloud
floor with a soft sheen (cream mixed with dusk, under L 0.80), drifting wisps (normal blend), a banded **Sunbow Arch** in amber, coral and lagoon at
60% chroma (not pastel). Ceremony dim on.
**Ground** cloud: grip 0.8, glue 0.6, peel 0.6, drag 1.15, soft dents fade in 6 s.
**Zones** Updraft (an updraft column, disc r 1.0 at (2.2, -0.8): airborne bodies fall slower by their catch); Breeze (gusts 0.4); Sun (warm 0.4).

| Thing | Mechanism and numbers | You can | They do by themselves |
|---|---|---|---|
| Puff Pads | M11 x3 pads r 0.45, flush, soft, gain 1.25, apex cap 0.35 m, in a triangle 1.6 m apart; one pad stands in the updraft, at (2.2, -0.8), (-2.2, -0.6), (0, -1.9) | drop squishies on them | walk on and bounce; three bounce **in turn**, like a little wave |
| Updraft | zone + a swirl look | toss a light one into it | **marshmallows float down slowly**, after a toss or a bounce on the pad inside it |
| Kite Swing | M8 swing, rope 1.4 m, limit 30 degrees, seat r 0.09 x 0.9 m, at (-2.4, 1.1) | set a squishy on it; poke to push | push a friend's seat from behind |
| Sunbow Arch | M2 x3 bars r 0.16 forming an arch 1.6 m wide and 1.3 m high, at (0.9, 1.6) | toss squishies through it | parade under it |
| Cloud Nest | M4 ring r 0.85, 5 segments r 0.10 (cloud look), gap 100 degrees, at (2.6, 1.3) | drop squishies in | pile up and nap |
| Cloud Ball | M13 ball r 0.26, mass 0.12, roll damping 0.8 /s; in the updraft it falls slowly too, at (-0.9, 1.7) | tap or flick it | pass it; chase it |

| Family | Cloud and Sun | Updraft | Puff Pads | Kite Swing | Sunbow Arch | Cloud Nest | Cloud Ball |
|---|---|---|---|---|---|---|---|
| slowrise | soft dents that fade L | floats down slowly when dry P | sinks in, small boing P | sinks into the seat L | parades slowly B | naps longest B | nudges it B |
| marshmallow | light dents L | floats down slowest, like a puff P | soft boing; on the updraft pad it floats down slowly P | rides softly P | parades B | squashes into a pillow P | barely moves it P |
| mochidough | deep dents L | falls almost straight P | thud, little boing P | sags into the seat P | plods along B | settles heavy P | stops it dead P |
| jellygel | quick dents L | falls a little slower P | good boing, long wobble P | wobbles all the way round P | parades, wobbling B | piles on top P | boops it far P |
| waterfill | soft dents L | falls a little slower P | sloshy boing P | sloshes against the swing P | parades B | sloshes to sleep L | boops it, sloshes P |
| putty | the deepest dents L | falls straight P | thud, no boing P | takes the seat's shape P | shuffles along B | takes the nest's shape P | sits on it P |
| stickystretch | sticky dents L | falls almost straight P | sticks, then springs P | grips the seat P | parades B | sticks to a friend, strands when it leaves L | carries it a little P |
| slimegoo | a wet trail L | falls straight P | sticks, slow peel P | slides off slowly P | oozes along B | oozes over the edge P | slows it P |
| firmsilicone | faint dents L | falls fast P | best boing, highest P | big swings P | parades, hopping B | bounces in, settles last B | boinks it far P |
| popdome | ring dents L | floats down slowly like a cap P | high boing P | rides upright P | parades B | sits in it like a lid P | taps it P |
| gummy | quick dents L | falls a little slower P | quick high boing P | bounces a little P | parades B | piles on top P | chases it first B |
| beadsqueeze | bumpy dents L | falls fastest, rattles S | rattly boing P S | rattles at the top S | parades, rattling S | settles with one rattle S | rolls with it S |

**Signature verb:** marshmallows float in the updraft; they bounce on the puff pads in turn. **Finale spectacle:** the sun rises and a soft bow of
light arcs over the parade. **Sound:** a high soft wind, slow whooshes, a puff on each pad bounce. **Music style** `cloud` (lift and glow fields).

### 4.11 The place set at a glance

| Place | Slice | Opens (QUESTS 6) | Moving props | Collider primitives | Water | Fans (favourite place) |
|---|---|---|---|---|---|---|
| Home | S0 | at the start | 1 (+1 pad later) | 5 | none | none (everyone's home) |
| Hearthlog Cabin | S1 | when the first wish shows | 3 | 15 | none | 6 |
| Ripple Shore | S2 | 12 stamps | 4 | 19 | pool 0.28, surf 0.06..0.12 | 5 |
| Frostbell Ridge | S2 | 20 stamps | 6 | 18 | steam pool 0.26 | 5 |
| Rainleaf Garden | S2 | 28 stamps | 3 | 6 | spots 0.06..0.08 | 6 |
| Fizzwell Tub | S3 | 36 stamps | 4 | 9 | bath 0.28 | 6 |
| Cogwhistle Bench | S3 | 45 stamps | 4 | 8 | none | 5 |
| Lanternroof | S3 | 54 stamps | 7 | 15 | dish 0.06 | 6 |
| Echo Hollow | S3 | 63 stamps | 0 | 11 | glow pool 0.26 | 6 |
| Cloudloft | S3 | 72 stamps | 5 | 11 | none | 5 |

(Primitive counts include walls and parapets; DT-01 recounts them from the data.)

---

## 5. Favourites and best friends (discovered by the player; `SPECIES_LIFE` in `src/data/life.ts`)

**Rules a probe locks (DT-03, DT-04).** 50 rows, `satisfies Record<SpeciesId, SpeciesLife>`, so a missing species fails tsc. Every place beyond Home
has at least 4 fans and at least 1 Common fan; every family has fans in at least 2 places; the favourite thing stands in the favourite place.
Best friends are 25 symmetric pairs (a perfect matching), every pair across lanes, tier gap at most 1, so a new player's Commons have Common friends.
Favourites belong to the **species** (one learnable fact: "every Dollop loves Hearthlog Cabin"); traits are per instance (LIFE.md 2). I checked
every rule with a script over `src/data/catalog.ts` (fans per place 5 or 6, Common fans 1 to 3, families in 2 to 5 places, 25 pairs, 0 problems).

| Place | Species (catalog idx) and favourite thing |
|---|---|
| Hearthlog Cabin | Dollop (0) Yarn Ball; Crimpo (10) Hearth; Thumbly (11) Rocker Board; Capnap (21) Snug Basket; Hushpuff (31) Hearth; Pastrel (39) Singing Kettle |
| Ripple Shore | Puddlo (3) Rock Pool; Crumbit (5) Shell Chimes; Swishel (16) Pebble Ball; Granulo (17) Sand Mound; Tidelume (43) Bob Ring |
| Frostbell Ridge | Boingle (12) Ice Pond; Hooplet (24) Glide Ramp; Knubby (22) Steam Pool; Diademo (34) Icicle Bells; Constello (48) Snowdrift Nest |
| Rainleaf Garden | Munchip (7) Moss Bouncer; Sproutle (18) Seed Pod; Wrigglo (19) Splash Spots; Acornel (20) Drip Leaf; Petalop (27) Leaf Teeter; Marigel (29) Stepping Stones |
| Fizzwell Tub | Plumpet (1) Sponge Raft; Glugbean (4) Bath Water; Tadpolo (15) Swirl Ride; Gloopsy (30) Soap Slide; Rattlebead (36) Bubble Patch; Glimglop (44) Tap |
| Cogwhistle Bench | Cushlet (9) Spring Plate; Kneadle (23) Spinning Cog; Burrbin (28) Horseshoe Magnet; Thudge (33) Tick Clock; Flipdome (40) Little Bell |
| Lanternroof | Chunkle (6) Lantern Line; Zingle (26) Clothesline Hammock; Taffelin (35) Vane Disc; Selenuff (38) Moon Dish; Somnuff (45) Chimney Corner; Skeinara (47) Star Scope |
| Echo Hollow | Dimpla (13) Echo Stone; Spirelo (25) Singing Crystals; Cindergoo (37) Glow Pool; Ambrosel (42) Stone Slide; Prismelo (49) Glow Moss Bed; Fossilo (46) Hum Rock |
| Cloudloft | Twangle (2) Kite Swing; Wisplet (8) Updraft; Nuzzo (14) Cloud Ball; Slumbrel (32) Cloud Nest; Caromel (41) Puff Pads |

Dollop, the starter, loves Hearthlog Cabin, the first new place: its first wish is the first trip (QUESTS 9).

**Best friends** (25 pairs; Commons pair with Commons):
| Tier | Pairs |
|---|---|
| Common (7) | Dollop and Crimpo; Plumpet and Wisplet; Twangle and Chunkle; Puddlo and Boingle; Glugbean and Thumbly; Crumbit and Cushlet; Munchip and Dimpla |
| Uncommon (5) | Nuzzo and Capnap; Tadpolo and Swishel; Granulo and Sproutle; Wrigglo and Knubby; Acornel and Hooplet |
| Uncommon and Rare (1) | Kneadle and Burrbin (the stud print: Burrbin's studs leave a dotted print on Kneadle that heals over 40 s) |
| Rare (4) | Spirelo and Diademo; Zingle and Gloopsy; Petalop and Marigel; Hushpuff and Thudge |
| Rare and Epic (1) | Slumbrel and Caromel |
| Epic (3) | Taffelin and Cindergoo; Rattlebead and Pastrel; Selenuff and Flipdome |
| Legendary (2) | Ambrosel and Fossilo; Tidelume and Glimglop |
| Legendary and Mythic (1) | Somnuff and Constello |
| Mythic (1) | Skeinara and Prismelo |

**Gift lists** (QUESTS 8; each list is 3 Common or Uncommon species who love the next place, so the gift points you onward):
| Finale | The gift: pick one | The card's line |
|---|---|---|
| Hearthlog Cabin | Puddlo, Crumbit, Swishel | "All three love Ripple Shore." |
| Ripple Shore | Boingle, Hooplet, Knubby | "All three love Frostbell Ridge." |
| Frostbell Ridge | Munchip, Sproutle, Acornel | "All three love Rainleaf Garden." |
| Rainleaf Garden | Plumpet, Glugbean, Tadpolo | "All three love Fizzwell Tub." |
| Friends Everywhere | Capnap, Kneadle, Wrigglo | "Three kinds that are hard to find." (slow-rise, putty and slime goo have no Common) |

---

## 6. What a tenth place costs (and how to add one)

Example: **Toasty Counter**, a kitchen counter with a flour-dusted top (grip 1.3, cream prints), a warm oven door (warm 1.0), a cold shelf (cold 0.5),
a mixing bowl (M4 ring), a rolling pin (M13 with a capsule shape flag; it pairs with FUN's Roll tool later) and cookie-cutter stamps (M1 x3).

| Part | Cost | Where |
|---|---|---|
| Data (numbers and the place name) | about 1.5 KB in the first load | `src/data/places.ts` (one PlaceDef, its things, zones, patches, spawn spots, camera, presets) |
| Text (thing names, lines, 10 quest titles and hints, a keepsake) | about 2 KB in the lazy text module | `src/data/journal_text.ts` |
| Render chunk (sky and light presets, a ground shader variant from the shared noise, 3 backdrop cards, kit pieces) and audio recipe (3 or 4 layers from existing blocks) | at most 45 KB together | `src/render/places/<id>.ts`, `src/audio/places/<id>.ts` |
| Quests | one chapter of 10 lines of data | `src/data/quests.ts` |
| Reactions | none by default (section 3 by construction); optional per-thing cells | `src/data/life.ts` |
| Physics, LIFE, quest or shell code | none | |
| Checks | automatic: DT-01..14, RD-01..04, RD-07, RD-13, AU-06 run on every PlaceDef | |

About two engineer-days of content plus one browser pass. The size gate grows by the place's chunk: PLAYGROUND_BUILD.md 14.4 has room for one more
place inside the 1900 KB total, and D9's 2000 KB allows two more.

---

## 7. Names and the gate

Every name here was screened on 2026-11-15 with the real gate code of `_harness/probe_catalog.ts` 76-298 (copied into a scratch module, behaviour
unchanged): **0 hits**. The split the checks use from now on (JUDGE_COHERENCE M6):
- **Coined single words** (Hearthlog, Frostbell, Rainleaf, Fizzwell, Cogwhistle, Lanternroof, Cloudloft, Sunbow) go through the NAME rules
  (`denyReason`, `compoundReason`, `unsafeReason`) and are marked `coined: true` in the data.
- **Every other name and all copy** go through the PROSE rules (`denyReasonText`, `unsafeReasonText`). Ordinary words such as Shell, Box, Moon,
  Echo or Pool fail the NAME rules by design and pass the PROSE rules.
- **Place and thing words against species (CS-05):** no word of 4 or more letters may share a species' first four letters, and no coined word may be
  within edit distance 2 of a species name; no two coined words share a prefix. This renamed four of the proposals' names: Cushion Swing became the
  Pillow Swing (Cushlet), Tide Pool the Rock Pool (Tidelume), Puddles the Splash Spots and Moon Puddle the Moon Dish (Puddlo), and Puddlebrook
  Garden became **Rainleaf Garden**. "Nook" (a known game's shopkeeper and shop) and "Pals" are not used anywhere.
- The setting label is **"Voices"** ("Squishy chatter" fails the PROSE gate: "chatter" contains a 6-letter French term).

## 8. Not decided here, and not checked

Not decided here: what squishies do by themselves (LIFE.md), quests and rewards (QUESTS.md), budgets and code (PLAYGROUND_BUILD.md). Not checked by
me: any physics behaviour in this page (every P cell is a design target for PH-01 to PH-21); how any place looks or sounds (nobody has rendered or
heard one); the luminance numbers (estimates until RD-13 measures them); exact positions against DT-01 (the data lane runs it).
