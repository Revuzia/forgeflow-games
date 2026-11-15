# PROPOSAL B: purpose first (the Journal)

Designer B of three, 2026-11-15. Input: `_handoff/design/DIRECTION.md` (D1 to D12), the five seam maps in `_handoff/maps/`, `_spec/DESIGN.md` 1 to 7,
`FUN.md`, `CUT.md`, `LOCK.md`, `UI.md`, `REFERENCES.md`, `CATALOG.md`, `SQUISHY_SCIENCE.md` 4, and the code where a map was not enough. Paths are relative to
G = `games/wobblehoard`. Section numbers 1 to 11 answer DIRECTION section 5 questions 1 to 11 in order; section 0 states the angle; section 12 says where I
disagree. Player text in quotes is final copy (plain English a seven-year-old can read).

**What I checked and what I did not.** I read the maps, the specs and the code I cite (line numbers are HEAD 5c747018 plus the SHELL-4 WIP diff). I ran one
read-only node script that screens my new names against the deny lists in `_harness/probe_catalog.ts` and `_harness/data/*.json`. My script is stricter than
the real gate: it splits words and also flags a deny entry that *contains* my word. Every name it flagged was renamed (for example "Tide Pool" hit `pooh` at
edit distance 1, "Lantern" hit `lanturn`, "Pine Cone" contains `pineco`, "Snow Globe" hit `snom`, "twin" hit `twix`, "Seal" hit `seel`). The real prose rule (`denyReasonText`, which I read but
did not run) skips edit-distance hits between two words of 5 letters or fewer and checks the wide lists only for exact words. So the three quest titles my
script still flags ("Float like a boat", "Snow prints", "Lamp lullaby") pass it. QU06 screens everything for real. I ran no tsc, no probe, no browser and
no build. Every cost below is quoted from a map or a report (the PHYS map measured them on this container). Every minute, day and fact
count marked "est." is my estimate from the economy numbers in DESIGN 5.4 and 5.9, not a playtest. The phone speed factor is unknown.

## 0. The angle: why a player comes back

Today the toy has one loop: touch, meter, capsule, merge. It feels good for a session, then asks "why tomorrow?". My answer is a **Journal** that turns
what the squishies do into things you *learn* and *keep*. It never turns play into a currency.

| Reason to return | What it is | How long it lasts | What it never does |
|---|---|---|---|
| **A story you can finish** | 4 chapters (one per place), 37 quests written as rules over typed events, each finale opens the next place | about 2 active hours (est.), so chapters 1 to 4 end around day 6 to 8 for a regular player | no timers, no lock-outs, no quest needs a rare squishy |
| **A book you never quite finish** | a page per species with 12 facts to discover (600 in all), 25 best-friend pairs, 24 keepsakes, a Gold Ribbon per full page | months: it rides the collection's own arc (all 50 species in 247 days solo or 153 with trade, DESIGN 5.4) | no random rewards for completing a set (the kompu-gacha rule of DESIGN 5.11) |
| **Friends that remember** | friendship between species pairs, warmth per squishy, wishes that point at undiscovered facts | grows forever, never decays | no guilt: needs reset when a squishy comes out, nothing is lost by being away |

Three rules hold everywhere in this proposal:
1. **The Journal pays no squish points and no capsules.** Its only economy touch is four *chosen* gift squishies for life (section 7.12).
2. **Autonomy earns nothing.** LIFE never calls a finger or grab API. The only paying kinds are `release` (held 0.4 s or more) and `snap`
   (`src/collection/meterfeed.ts` 43-65), and only a player's finger makes them.
3. **Every quest can be finished with Commons**, and no quest asks for more than 10 of one deed.

## 1. The places

Shared rules for every place (they keep the physics, the decals and the ceremonies valid):
- **The ground under the play area is flat, at y = 0.** No height field (PHYS map E1 is large and high risk). Slopes are props.
- **The play area** is a rounded box 6.4 x 4.4 m (`hx` 3.2, `hz` 2.2, corner radius 1.0). Home keeps today's felt disc R 3.5 with its corral. A squishy is
  0.8 to 1.25 m across (R 0.4 to 0.625, `shape.ts` 68), so five fit with room to hop.
- **A pad** (circle r 1.0 m, no prop inside) holds the capsule and the reveal. **Five spawn spots** take the party. **Walk circles** are where LIFE may send a
  squishy.
- **Brightness cap:** the mean linear luminance of the play area stays at or under 0.35. The beach is golden hour, not noon. The burst ramp (alpha 0.25,
  `flash.ts`), the light pools and the rings are all additive and were tuned on a dark felt (RENDER map 7). Each place re-runs the flash gate.
- **Palette:** every colour is a mix of the 8 tokens in `src/ui/theme.ts` 4-13 (ink, plum, dusk, felt, amber, lagoon, coral, cream), done in OKLCH by
  `src/render/oklch.ts`. There is no new hue family.
- **Colliders:** at most 12 prop shapes per place (sphere, capsule, box, plane), and at most 6 moving props.
- **Entry rule for things a squishy uses by itself:** the seat or the board sits no higher than 0.12 m above the ground, with a bevelled edge of 20 degrees or
  less. A squishy can only hop 1 to 3.6 cm (section 3.4), so it cannot climb higher. The tall rides (Sand Slide, Sled Hill) are **player rides**: the player
  carries a squishy up (pull past the limit, carry, let go). The squishy *asks* for a ride with a wish, which gives the player the purpose.

### 1.1 Home: **Dusk Nook** (chapter 1)
**Look.** Today's set, kept bit-identical when no thing is present: the dusk-indigo felt mat, the amber softbox key, the lagoon rim, the procedural dusk sky
(`table.ts`). It is evening indoors. New are a felt shelf edge at the back and things that arrive one by one (below), so minute 0 is as clean as today.
**Ground.** Felt: grip, glue, peel and drag at x1.0 (identical). **Zones:** `warm` lamp pool (disc r 1.4 m under the key; mild, look only) and `cosy`
over the cushion.

| Thing (arrives) | Physics | The player | Squishies by themselves |
|---|---|---|---|
| **Music Box** (from the start) | static box 0.40 x 0.30 x 0.30 | taps it: an 8-bar tune in the current music field | the ones within 2 m sway and sing along (sing together) |
| **Bumper Ball** (after the first greet, quest n5) | dynamic sphere r 0.28, mass 0.15 of a body, restitution 0.5, speed clamp 3 m/s | flicks it (a tap on the ball pushes it at 1.2 m/s away from the camera ray) | playful ones nudge it with a hop into it; a pair passes it back and forth |
| **Snooze Cushion** (after chapter 1) | static box 1.2 x 0.10 x 0.9, bevelled edge, grip x1.3, `cosy` zone | drops a squishy on it | sleepy ones scoot on and nap; friends pile up |
| **Tilt Board** (after chapter 2) | 1-DOF hinge: box 1.6 x 0.08 x 0.5, pivot 0.10 m high, limit 14 deg, damping ratio 0.3 | puts one squishy on each end | two playful ones rock it: one scoots on, the other hops at the high end |

### 1.2 The beach: **Sunfizz Cove** (chapter 2, the first new place)
**Look.** Late golden hour. The sky runs from cream with a little amber at the horizon to a lagoon-tinted dusk at the zenith (zenith kept at or under L 0.55).
The sand is amber mixed into plum (a warm taupe) with band-limited ripples in the ground shader (the felt pattern `table.ts` 112-124 is the model). Behind
the play area a low sea in lagoon mixed with ink catches a long amber glint. Three flat-card driftwood and dune-grass silhouettes stand at the back. A
light sea breeze moves the grass on the cards. There are no birds and no animal sounds. Weather: a few warm dust motes (additive particles, 20 / 32 / 40 by
tier, x0.3 in Calm, none with reduced motion).
**Ground.** Damp sand: grip x1.3, glue x1.15, peel x1.1, drag x1.0. Sand **prints** last 20 s, and 40 s for putty and mochi.
**Zones:** `water` over the Tide Puddle (surface at y 0.75, a current of 0.12 m/s toward the basin's low side); `sun` patch (disc r 1.5 m, warm: rest
need rises x2, looks glow); `wet` band (1.0 m around the puddle: grip x1.1, wet look).

| Thing | Physics | The player | Squishies by themselves |
|---|---|---|---|
| **Tide Puddle** | a rock basin 2.0 m across: 4 static capsule rims r 0.12, 0.8 m tall, plus the `water` zone 0.75 m deep | tosses or carries a squishy in, lifts it out | floaters bob and drift; sinkers sit with their tops out; after 30 to 90 s each hops out by itself (a "water hop", section 3.4) |
| **Beach Ball** | dynamic sphere r 0.32, mass 0.10 of a body, restitution 0.6, roll damping 0.4/s, speed clamp 3 m/s | flicks it | two playful ones pass it; a lone one chases it |
| **Sand Slide** | a static dune block 0.8 x 0.45 x 0.8 plus a ramp box 1.8 x 0.10 x 0.8 tilted 14 deg, prop mu 0.15 x the family's `slip` | carries a squishy to the top and lets go | asks for a ride (a wish with the star icon); slides down when placed; with gate PH12 passed, may glide up by itself (stretch goal) |
| **Drift Raft** | a floater box 0.9 x 0.08 x 0.7 in the puddle: a buoyancy spring in y, bob 0.02 m at 0.4 Hz, drift damping 0.5/s | drops a squishy on it | sunbathes on it; sleepy ones nap there |
| **Driftwood Chimes** | a static capsule post r 0.05, 1.0 m tall; the chime bar sways in render only | taps it (5 notes up the D pentatonic) | a squishy that bumps the post rings it; three near it start a song |

### 1.3 The snowy mountain: **Hushpeak** (chapter 3)
**Look.** Blue hour after sunset. The zenith is ink mixed with dusk, the horizon a lagoon-cream glow, and far peaks stand as fogged violet cards. The snow is
cream mixed with lagoon, held at or under L 0.80 so the jellies still read. A glow lamp pours an amber pool. Soft snow falls as a normal-blend particle twin
(RENDER map 1: an additive snowflake would vanish on a white sky), 60 / 90 / 120 flakes by tier, x0.3 in Calm, none with reduced motion. A gust lifts the
snow every 9 to 15 s.
**Ground.** Packed snow: grip x1.1, glue x1.0, drag x1.05. **Prints** last 30 s (60 s for putty and mochi), drawn as a darker, flatter patch in the ground
shader. **Zones:** `ice` (box 1.6 x 1.0: grip x0.10 times the family's ice factor, glue x0.3, peel x0.3, drag x0.25); `cold` everywhere (look and
behaviour only); `wind` gusts (1.6 s long, 0.5 m/s^2 times the family's `windShare`, seeded); `warm` around the Glow Lamp (disc r 1.2).

| Thing | Physics | The player | Squishies by themselves |
|---|---|---|---|
| **Sled Hill** | static block 0.9 x 0.46 x 0.9 plus a ramp 2.2 m tilted 12 deg, prop mu 0.06 x `slip` | carries one to the top | asks for a ride; slides; firm and gummy ones go farthest |
| **Ice Pond** | the `ice` zone plus a flat look (no collider) | gives a gentle push (a press with a drag, as on any squishy) | hop onto it and glide; smooth families glide a long way |
| **Bouncy Bough** | 1-DOF spring: board 1.0 x 0.08 x 0.5 at 0.12 m, travel 0.12 m under one body, damping ratio 0.25 | drops one on it | playful ones scoot on and bounce with small squashes |
| **Snowball** | dynamic sphere r 0.30, mass 0.30 of a body, roll damping 0.6/s, speed clamp 2 m/s | flicks it | two push it together; it leaves a trail of prints |
| **Glow Lamp** | static capsule post r 0.06, 1.2 m tall, plus a `warm` zone | taps it (it glows brighter for 10 s) | chilly ones go and warm up; sleepy ones nap at its foot |

### 1.4 The forest log cabin: **Hearthpine Cabin** (chapter 4)
**Look.** Night inside a small log cabin. The walls and floor are plum and dusk wood with plank grooves in the ground shader. The hearth throws amber and
coral light that breathes slowly (under 0.5 Hz, never a flicker train). A window card at the back shows ink sky, lagoon moonlight and snowy pine
silhouettes. Embers rise over the hearth (additive, 12 / 18 / 24, none with reduced motion). The rug is felt-coloured with cream stitching.
**Ground.** Wood floor: grip x0.9, glue x0.9. **Zones:** `warm` hearth (strength falls off over r 2.0 m; strong inside 0.8 m), `cosy` rug (box 2.2 x 1.4,
grip x1.4), `cold` window draught (box 1.0 x 1.0 at the window, mild).

| Thing | Physics | The player | Squishies by themselves |
|---|---|---|---|
| **Hearth** | static box guard 1.4 x 0.5 x 0.5 at the back wall plus the `warm` zone | taps it (logs settle, a soft crackle) | warm up; marshmallow ones toast; sleepy ones doze nearby |
| **Rocking Seat** | 1-DOF hinge rocker: seat box 0.9 x 0.08 x 0.8 at 0.12 m, limit 12 deg, a soft return spring | rocks it with a flick | sleepy ones scoot on and rock to sleep |
| **Yarn Ball** | dynamic sphere r 0.22, mass 0.08 of a body; sticky and slime families grip it (prop mu 1.4) | flicks it | playful ones roll it; it clings to the stretchy ones for a moment |
| **Swing Basket** | 1-DOF pendulum: seat box 0.9 x 0.08 x 0.8 hung 1.2 m from y 1.32 (seat at 0.12 m), limit 25 deg, damping 0.15/s | pushes it | two share it; water-filled ones slosh as it swings |
| **Wool Rug** | the `cosy` zone, render mesh only | drops squishies on it | nap piles happen here first |

## 2. "In their own way"

### 2.1 The family numbers (new data in `src/data/life.ts`; MATERIAL_FAMILIES stays untouched, `probe_materials.ts` 34-37)
`density` is relative to water (it sets the float line), `iceMu` multiplies ice grip, `slip` multiplies slide friction (lower slides faster), `soak` is how
fast a foam drinks water (in seconds), `windShare` scales wind, `printHold` scales how long marks last.

| family | density | iceMu | slip | soak s | windShare | printHold | hop style (3.4) | heat look | cold look |
|---|---|---|---|---|---|---|---|---|---|
| slowrise | 0.40 (0.90 once soaked) | 0.50 | 0.60 | 20 | 0.80 | 1.5 | soft hop | naps sooner | snow sticks (`snow`) |
| marshmallow | 0.30 | 0.50 | 0.55 | 40 | 1.00 | 1.2 | soft hop | **toasts** (`toast`) | snow sticks |
| mochidough | 1.10 | 0.40 | 0.70 | none | 0.20 | 2.0 | scoot | shiny, a slow sag look | frost |
| jellygel | 0.88 | 0.20 | 0.35 | none | 0.25 | 1.0 | hop | core glows warmer | frost |
| waterfill | 0.80 | 0.25 | 0.40 | none | 0.20 | 1.0 | wobbly hop | core glows warmer | frost, then a slower slosh look |
| putty | 1.20 | 0.45 | 0.75 | none | 0.10 | 2.0 | scoot | glossy, soft look | frost |
| stickystretch | 0.92 | 0.70 | 0.90 | none | 0.20 | 1.0 | hop with a peel | stringier look | frost |
| slimegoo | 1.00 | 0.60 | 0.80 | none | 0.15 | 1.0 | scoot | oozes (a wet spread look) | frost, moves slower |
| firmsilicone | 1.15 | 0.10 | 0.25 | none | 0.15 | 0.8 | crisp hop | no change | frost |
| popdome | 0.60 | 0.10 | 0.25 | none | 0.50 | 0.8 | crisp hop | no change | frost |
| gummy | 1.05 | 0.15 | 0.30 | none | 0.20 | 0.9 | hop | soft and shiny (`soften`) | frost |
| beadsqueeze | 1.35 | 0.35 | 0.55 | none | 0.05 | 1.2 | wobbly hop | no change | frost |

Float check (sphere model, a body resting on the basin floor in 0.75 m of water): a body of R 0.5 has 84% of its volume under water, so every family with
density under 0.84 floats (marshmallow, slow-rise, pop dome, water fill). Jelly gel (0.88) and sticky stretch (0.92) are nearly weightless and bob on the
floor. Slime (1.00) drifts with the current. The rest sit with their tops out. A big body (R 0.625) has only 65% under, so it floats only below 0.65: "big ones
sit in the shallows". A soaked slow-rise foam (density climbing to 0.90 over 20 s) **sinks slowly**. That is a real physics reaction, because the density is
an input of the water zone. It then dries over 60 s on sand.

### 2.2 The reaction table (P = physics, L = look, S = sound, B = behaviour)
Physics reactions use only density, ice and slide friction, wind share, buoyancy, slosh in water and the prop mechanisms. **No family's stiffness or damping
changes at run time.** Cold stiffness and warm softness are looks and behaviour. A stiffness change would force the hop, press, rub and pull rows to be
re-gated (PHYS map 5: 12 of 50 species launched after a retune).

| family | Cove water | Cove sand, sun, slide | Peak snow, ice, wind, bough | Peak cold, Glow Lamp | Cabin hearth | Cabin rug, swing, yarn |
|---|---|---|---|---|---|---|
| slowrise | floats high (P), soaks, sinks slowly (P), darkens (L), a squirt of droplets when squeezed wet (L, S) | prints (L), naps in the sun first (B) | sinks into snow, slow prints (L), drifts in gusts (P) | snow cap (L), dozes by the lamp (B) | naps fast (B), dries (L) | nap pile leader (B) |
| marshmallow | floats highest and bobs (P), a little wet (L), sighs (S) | sandy powder look (L), soft hops (B) | blown farthest by gusts (P, windShare 1.0), skids on ice (P) | snow cap (L), shivers (B) | **toasts golden on the fire side** (L `toast`), toasty crackle (S) | sinks into the rug (L) |
| mochidough | sinks and sits (P), sand sticks when it climbs out (L) | deep prints that last 40 s (L), slow on the slide (P) | deep snow prints (L), slow glide (P) | frost, hops less (B) | shiny, settles low (L) | grips the rug (P) |
| jellygel | bobs on the floor (P), clear body glints (L), "blip" (S) | glows in the sun (L) | glides far on ice (P), wobbles on the bough (P) | frost crust (L), shivers (B) | warm core glow (L) | wobbles on the swing (P) |
| waterfill | floats low and sloshes on every ripple (P: the slosh push runs in water, `softbody.ts` 2346), double slosh sound (S) | slides well (P) | glides (P), sways on the bough (P) | frost, then a slower slosh look (L) | warm glow (L) | sloshes as the basket swings (P), gloop (S) |
| putty | sinks (P), glossy wet (L) | prints that last 40 s (L), slowest on the slide (P) | deepest prints (L), barely glides (P) | frost, "stiff in the cold": no hops (B) | glossy soft look (L) | none |
| stickystretch | bobs (P), sand clings when out (L) | grips the slide, slow ride (P), picks up sand speckles (L) | grips the ice, short glide (P), clings to the bough and swings (P) | frost (L) | stringy look (L) | the yarn clings to it (P, prop mu 1.4) |
| slimegoo | drifts with the current (P), a shiny slick ring on the water (L), "blorp" (S) | collects sand (L), oozes in the sun (B) | slow on snow (B), short glide (P) | frost, moves slower (B) | oozes and spreads (L), naps (B) | the yarn clings to it (P) |
| firmsilicone | sinks quickly, bounces off the floor (P), "boop" (S) | **fastest on the slide** (P, slip 0.25) | **fastest on ice** (P, iceMu 0.10), highest on the bough (P) | frost (L), squeaks on snow (S) | no change | skitters on the wood (P), kicks the yarn far (P) |
| popdome | **floats dome-up like a little boat** and turns slowly in the current (P) | fast on the slide (P) | fast on ice (P), springs back fast on the bough (P) | frost (L) | no change | none |
| gummy | sinks slowly (P), shines (L), "glub" (S) | fast slide (P), softens in the sun (L, B lazier) | long glide (P) | frost (L) | soft and shiny (L) | none |
| beadsqueeze | sinks fast and sits (P), a muffled rattle under water (S) | crunches on sand (S), sand sticks (L) | loud snow crunch (S), barely moves in wind (P) | frost (L) | a warm rattle (S) | rattles on the wood floor (S) |

Home (Dusk Nook) is neutral on purpose: "at home everyone is just themselves". The only Home reactions are the lamp pool's warm core glow (L) and the
cushion naps (B).

### 2.3 Favourite place, favourite thing and best friend (50 rows, authored, `Record<SpeciesId, SpeciesLife>` in `src/data/life.ts`)
Rules a probe locks: every place has 11 to 13 fans and at least 3 Common fans; every thing is someone's favourite; every family spans at least 2 places;
best friends are 25 symmetric pairs, all **cross-lane**, and paired inside a tier wherever the counts allow (Common 7 pairs, Uncommon 5, Rare 5, Epic 3,
Legendary 2, Mythic 1; the four left over make Kneadle-Flipdome and Somnuff-Constello). Commons befriend Commons, so a new player can find a pair in the first
days. The favourite thing always sits in the favourite place, so the two are found together.

| idx | species | place | thing | best friend | idx | species | place | thing | best friend |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Dollop | Nook | Bumper Ball | Crimpo | 25 | Spirelo | Peak | Bouncy Bough | Diademo |
| 1 | Plumpet | Cove | Beach Ball | Cushlet | 26 | Zingle | Cabin | Yarn Ball | Slumbrel |
| 2 | Twangle | Nook | Tilt Board | Boingle | 27 | Petalop | Cove | Driftwood Chimes | Marigel |
| 3 | Puddlo | Cove | Tide Puddle | Dimpla | 28 | Burrbin | Nook | Bumper Ball | Thudge |
| 4 | Glugbean | Peak | Ice Pond | Thumbly | 29 | Marigel | Nook | Music Box | Petalop |
| 5 | Crumbit | Cove | Sand Slide | Munchip | 30 | Gloopsy | Cabin | Swing Basket | Hushpuff |
| 6 | Chunkle | Peak | Sled Hill | Wisplet | 31 | Hushpuff | Peak | Glow Lamp | Gloopsy |
| 7 | Munchip | Cabin | Rocking Seat | Crumbit | 32 | Slumbrel | Cove | Drift Raft | Zingle |
| 8 | Wisplet | Cabin | Hearth | Chunkle | 33 | Thudge | Peak | Sled Hill | Burrbin |
| 9 | Cushlet | Nook | Snooze Cushion | Plumpet | 34 | Diademo | Nook | Music Box | Spirelo |
| 10 | Crimpo | Cabin | Hearth | Dollop | 35 | Taffelin | Peak | Sled Hill | Selenuff |
| 11 | Thumbly | Peak | Snowball | Glugbean | 36 | Rattlebead | Cove | Beach Ball | Caromel |
| 12 | Boingle | Peak | Ice Pond | Twangle | 37 | Cindergoo | Cabin | Hearth | Pastrel |
| 13 | Dimpla | Cove | Drift Raft | Puddlo | 38 | Selenuff | Cabin | Rocking Seat | Taffelin |
| 14 | Nuzzo | Cabin | Wool Rug | Acornel | 39 | Pastrel | Cabin | Wool Rug | Cindergoo |
| 15 | Tadpolo | Cove | Tide Puddle | Swishel | 40 | Flipdome | Peak | Ice Pond | Kneadle |
| 16 | Swishel | Nook | Music Box | Tadpolo | 41 | Caromel | Nook | Bumper Ball | Rattlebead |
| 17 | Granulo | Peak | Glow Lamp | Hooplet | 42 | Ambrosel | Cove | Driftwood Chimes | Tidelume |
| 18 | Sproutle | Cabin | Swing Basket | Capnap | 43 | Tidelume | Cove | Tide Puddle | Ambrosel |
| 19 | Wrigglo | Cove | Sand Slide | Knubby | 44 | Glimglop | Peak | Glow Lamp | Fossilo |
| 20 | Acornel | Cabin | Yarn Ball | Nuzzo | 45 | Somnuff | Cabin | Swing Basket | Constello |
| 21 | Capnap | Nook | Snooze Cushion | Sproutle | 46 | Fossilo | Cove | Sand Slide | Glimglop |
| 22 | Knubby | Peak | Snowball | Wrigglo | 47 | Skeinara | Nook | Tilt Board | Prismelo |
| 23 | Kneadle | Nook | Tilt Board | Flipdome | 48 | Constello | Cabin | Rocking Seat | Somnuff |
| 24 | Hooplet | Peak | Bouncy Bough | Granulo | 49 | Prismelo | Cove | Driftwood Chimes | Skeinara |

Counts: Nook 11, Cove 13, Peak 13, Cabin 13. Common fans: Nook 3, Cove 4, Peak 4, Cabin 3. Every family has 2 to 4 places. Every thing has 2 or 3 fans.
**Per-instance twist:** one of 6 quirks from `mulberry32(genome.seed ^ 0x6a09e667)` (a new salt; the map lists the three salts already in use). The quirks
are: hums when alone, spins once before a nap, looks up at the sky, follows the pointer with its eyes for longer, tidies (nudges the ball back toward the
middle), wakes first in a pile. Quirks are flavour only and are not stored.

## 3. Life

### 3.1 Personality traits (a pure function of the genome: `traitsOf(g)` in `src/life/traits.ts`)
Every trait is clamped to 0..1. `[x]` is 1 when true. The catalog spreads are firmness 0.25..0.8, bounce 0.2..0.9, stretch 0.25..0.95 and size 0.35..0.7
(CORE map 1), so every trait really varies.

| trait | formula | what it changes |
|---|---|---|
| **bouncy** (playful) | 0.15 + 0.7 bounce + 0.15 [eyes wide] | play need rises faster; copies hops; uses balls and boughs |
| **curious** | 0.2 + 0.6 stretch + 0.2 [eyes wide] | perception radius 1.2 + 1.0 x curious metres; notices first; shows `query` |
| **cuddly** (social) | 0.2 + 0.5 (1 - firmness) + 0.3 [eyes oval] | company need rises faster; greets and nuzzles more |
| **dozy** (restful) | 0.1 + 0.4 size + 0.5 [eyes sleepy] | rest need rises faster; naps longer; joins piles |
| **steady** (bold) | 0.2 + 0.7 firmness + 0.1 [eyes dot] | less shy; comforts others; keeps its spot in wind |
| **likes** | the species' `signature` touch (poke 19, squeeze 20, pull 11 species, `catalog.ts` 88) | that touch makes it beam (`sparkle`), once a session discovers fact F9 |

Because traits come from the genome, a merged, traded or restocked squishy carries its personality for free. No trait is stored.

### 3.2 Needs and moods (session state only, never saved)
Needs are 0..1 and rise per minute of **sim time while the squishy is out**. They start at company 0.3, play 0.4, rest 0.2 each time a squishy comes
out. Being away therefore never makes a squishy "needier". There is no neglect state, no decay and no guilt.

| need | rises | satisfied by |
|---|---|---|
| company | 0.08 x (0.6 + cuddly) per min | greet -0.3, chat -0.2, nuzzle -0.4, a player's touch -0.3, a song -0.3 |
| play | 0.15 x (0.6 + bouncy) per min (+0.1 when a ball rolls past) | using a thing -0.5, copying -0.2, a toss by the player -0.4 |
| rest | 0.05 x (0.6 + dozy) per min, x2 in `sun`, `warm` and `cosy` zones, +0.05 after a slide, toss or splash | a nap (it falls to 0 over the nap) |

The **mood** is derived, not stored: sleepy (rest over 0.7), playful (play over 0.6), wants company (company over 0.8), chilly or toasty (from the zone and
the family's comfort score), otherwise content. A mood only picks emotes and behaviours. It is never shown as a number.

### 3.3 Behaviours (utility scored; each character thinks every 0.5 s at a staggered offset, so at most 2 think per frame at 12 characters)
The highest score wins, and the current behaviour gets a +0.15 hysteresis. All emotes and voices go through the attention budget (5.4) and may be dropped.

| # | behaviour | trigger (score) | motion | emote | voice | ends | cooldown |
|---|---|---|---|---|---|---|---|
| 1 | idle | always 0.1 | breathe; gaze wanders to the nearest interesting point | none | none | anything better | none |
| 2 | notice | a new character or thing enters the perception radius (0.9, once per target per visit) | gaze 1.2 s, lean 0.06 R toward it | `query` if curious > 0.5 | one chirp | 1.5 s | per target per visit |
| 3 | wander | play > 0.4 and nothing in reach (0.3 + 0.4 play) | a chain of 2 to 5 hops to a walk point within 1.5 m | none | none | arrives, or 6 s | 8 s |
| 4 | greet | another whole squishy within 1.2 m, not greeted this visit (0.8) | turns, one hop toward it | `wave` (both) | call and answer | 2.5 s | per pair per visit |
| 5 | chat | a met pal within 1.5 m, both idle (0.35 + 0.3 company) | small leans toward each other | `chirp` (first only) | 2 to 4 exchanges | 3 to 5 s | 20 to 40 s per pair |
| 6 | nuzzle | a pal (level 2+) or its best friend within 3 m, company > 0.6 (0.4 + 0.5 company) | hops next to it, leans into contact 1.5 s | `snug` | purr | 3 s | 45 s |
| 7 | copy | a neighbour within 1.5 m hops and self bouncy > 0.5 (0.5 bouncy) | repeats the hop 0.4 s later, up to 4 hops | `sparkle` at the end (1 in 4) | a peep per hop (group voice) | the leader stops | 20 s |
| 8 | mirror dance | another of the **same species** within 2 m (0.9, once per visit) | mirrored hops with no delay | `pair` | unison hum | 4 s | per visit |
| 9 | use a thing | play > 0.5 and a usable thing within 3 m (0.3 + 0.5 play + 0.3 [favourite] + family affinity) | per thing: approach, scoot on, push, sit | the thing's icon (`ball`, `star`, `drop`, `note`, `cosy`) | per thing | done, or 12 s | 15 s per thing |
| 10 | sing together | 2+ idle within 2 m and a trigger (Music Box, Driftwood Chimes, Hearth tapped) or a pal and company > 0.5 (0.6) | slow side-to-side lean at 0.5 Hz | `note` (one shared bubble) | harmony, 2 to 4 bars | 8 to 16 s | 60 s |
| 11 | nap and pile | rest + 0.35 [cosy, sun or warm zone] + 0.3 [a sleeping friend near] > 0.75 | hops to the cosy spot or next to the sleeper, then sleeps (the body really sleeps, 9.5) | `zzz` (one per pile) | a hum that fades, then silence | a touch, or rest < 0.1 (60 to 120 s) | 90 s |
| 12 | comfort | a pal or best friend within 2.5 m had a hard landing (> 0.6), was cut, or is chilly; self steady > 0.4 or a pal (0.85) | hops over and nuzzles | `snug` | coo, coo | 3 s | 30 s |
| 13 | react to a zone | it enters a zone with a family reaction (0.7, once per zone per visit) | the family's way: shiver wiggle 3 Hz, float, slow down | `flake`, `sun`, `cosy`, `drop` | one short syllable | 2 s | per zone per visit |
| 14 | huff | the ball it was chasing is taken away, or a toss it did not like (steady < 0.3) (0.5, once) | turns away 2 s | `puff` | a low coo | a touch or a greet turns it into `sparkle` | 5 min |
| 15 | show a wish | the wish scheduler (7.6) gives it a slot | looks toward the place, thing or friend | thought bubble with an icon | a rising trill | granted, or it goes back to the shelf | per 7.6 |
| 16 | watch | the player touches another character within 3 m (0.6) | gaze at the touched one | none | none | the touch ends | none |
| 17 | held | any finger, grab, lock or carry on it | none (override) | none | (feedback.ts plays the player's sounds) | release, then a 1.5 s after-glow | none |
| 18 | shy arrival | warmth < 5 and the first 20 s after it first comes out | keeps 0.5 m of extra distance, gaze down | none | none | 20 s, or a touch | once per squishy |

**Huff is never about the player's absence.** It fires only for something in the scene (the ball rolled away), never when the game opens, and never more
than once in 5 minutes per squishy. A squishy that "misses you" would be a guilt nudge (UK Children's Code, DESIGN 3.2). There is none.

### 3.4 How a squishy moves by itself
A **hop** is an anticipation squash plus an impulse. LIFE calls `setSquash(s, t)`, then `hop(vx, vy, vz)` when the squash bottoms out. Physics suspends
glue and peel damping for 10 substeps so every family leaves the ground (the glue differs about 5x between families, PHYS map 3).
Height h = vy^2 / 2g with g = 10: **vy at most 0.85 m/s**, so h is at most 3.6 cm and the landing is slower than the 0.9 m/s `land` threshold
(`softbody.ts` :2285). So an autonomous hop fires no land sound and no haptic by construction.

| family group | squash s | squash time | vy m/s | horizontal m/s | style |
|---|---|---|---|---|---|
| firm silicone, pop dome | 0.88 | 0.10 s | 0.80 | 0.70 | crisp hop with a small rebound |
| jelly gel, gummy, sticky stretch | 0.85 | 0.12 s | 0.75 | 0.60 | hop (sticky: glue x0.5 only, so a visible peel) |
| water fill, bead squeeze | 0.84 | 0.14 s | 0.70 | 0.55 | hop, then a slosh or rattle sway |
| marshmallow, slow-rise | 0.80 | 0.16 s | 0.60 | 0.50 | soft hop; slow-rise lands flat and rises |
| mochi, putty, slime | 0.90 (putty 0.92, at most 1 squash every 2 s) | 0.18 s | 0.45 | a 0.25 m/s glide | scoot: a short hop plus a `moveTo` glide (it oozes along) |

Pieces hop with vy x0.8 and horizontal x cbrt(frac). The putty limit avoids the known memory capture of repeated squashes (PHYS map 7). A **water hop**
(only when submerged > 0.3) may use vy up to 2.0 m/s to leave the Tide Puddle. Its landing on sand does fire `land`: the shell routes it through the
attention budget as a soft "plop", never through `feedback.ts`. **Lean** is a goal shear of at most 0.1 R toward a point. **Wiggle** is a side shear at
1 to 4 Hz of at most 0.05 R. **Gaze** is the per-body look target (render). Long trips chain hops every 0.35 to 0.5 s (about 0.25 m/s on average).

### 3.5 What the player's touch does to the brain
- **At once:** any `fingers > 0 || grabbed || carried` (or a lock, LOCK.md) puts the character in `held`. Its intents are cleared in the same step, and the
  physics touch gate (PHYS E9) eases the LIFE drivers out over 0.1 s. The face follows the pointer as today. LIFE issues no intent for a character touched in
  the last 0.25 s.
- **On release:** 1.5 s of after-glow, standing still. If the touch was its `likes` kind, it beams (`sparkle`, a squint, a `beam` chirp) and the shell emits
  `signature` once a session. After a toss it shows `dizzy` on landing for 1.5 s, then `sparkle` if bouncy > 0.5, else `query`.
- **Others watch:** idle characters within 3 m look at the touched one (behaviour 16).
- **The player's touch satisfies company** (-0.3), so playing with one squishy is caring for it.

### 3.6 Keeping squishies inside the place
Four layers. (1) Physics bounds: `setBounds` (a rounded box per place, PHYS E3), with today's rim bounce of 0.35. (2) LIFE only targets points inside walk
circles, minus a keep-out of 0.4 m around every thing and the pad. (3) The water current returns floaters toward the basin's low side, and every squishy
hops out within 90 s. (4) A tossed body that lands outside the walk circles is glided back at 0.35 m/s (the corral's own speed, `params.ts` 141) once it
rests. `setHome(x, z)` moves the corral centre to where a LIFE body last rested, so the corral never drags it back to its spawn spot (PHYS map 1).

### 3.7 When the brains pause
LIFE issues **no new movement** (needs keep their values) while: a ceremony runs (`!game.input.live`, `game.ts` 605), a cut neck or join runs (`cut` busy),
the Cut tool is in hand (they hold still so cutting is easy), the Travel or Journal sheet is open, or the desktop Hoard holds input. With the **Snap** tool
in hand they **pose**: every face turns to the camera and nobody moves. With **"Squishies move on their own" off**, LIFE keeps gaze, expressions and the
touch reactions, and issues no hop, lean, wiggle or `moveTo`.

## 4. Social play

### 4.1 Pair and group interactions
"Size" counts characters, and pieces count (section 6). Points go to the species pair (4.2). A pair earns at most 20 points a UTC day.

| interaction | starts when | emote | voice exchange | physics | ends | friendship |
|---|---|---|---|---|---|---|
| greet | two wholes within 1.2 m, not greeted this visit | `wave` on both | A: chirp-chirp; B, 250 to 450 ms later: the mirrored contour | one hop toward | 2.5 s | +1 (once per pair per visit) |
| chat | two met squishies within 1.5 m, both idle | `chirp` on the first | 2 to 4 alternating syllables from each one's voice print | leans | 3 to 5 s | +1 per chat, at most 3 a visit |
| nuzzle | pals or best friends, company > 0.6 | `snug` | both purr | hop adjacent, lean into a real contact (`collide`) | 3 s | +2 |
| copy (follow the leader) | a bouncy one hops near another bouncy one | `sparkle` at the end | one shared peep per hop | hop chains | the leader stops | +1 |
| mirror dance | two of the same species within 2 m | `pair` | a unison hum | mirrored hops | 4 s | none (same species); fact F11 |
| sing together | 2+ idle with a trigger or a pal | one shared `note` | harmony on the field's chord tones (5.3) | gentle sway | 8 to 16 s | +1 per pair, at most 3 pairs a song |
| play together | two use one moving thing (ball pass, Tilt Board, Swing Basket, Snowball push) | `ball` | a chirp on each contact | the prop mechanism | play need < 0.2 for both | +2 |
| nap pile | 2+ asleep within 1.6 m of each other | one `zzz` for the pile | a hum fading to silence | bodies sleep | a touch wakes one; the rest wake over 1 to 3 s | +1 per pair per pile |
| comfort | 3.3 behaviour 12 | `snug` | coo, coo | hop over, lean | 3 s | +2 |

### 4.2 Friendship: storage and what it unlocks
Friendship belongs to a **species pair** (the Journal is about species: "who its friends are"). It is stored as `[idxLo, idxHi, points]` with points
0..255, at most **128 pairs** (of 1225 possible). When full, the Met-only pair with the fewest points is dropped. A pair at Pals or above is never dropped.
Nothing decays.

| level | points | unlocks |
|---|---|---|
| Met | 1+ | listed on the Friends tab; they chat |
| Pals | 12+ | they nuzzle and comfort each other; they greet with their own **duet** (a 2-note call fixed for the pair, from both species seeds); for a best-friend pair, fact F3 and a "Best friends" mark |
| Close pals | 40+ | they choose each other for nap piles first; with a third pal they sing a 3-part harmony; a best-friend pair at Close pals gets a Gold Ribbon on their Friends row |

Pace (est.): two squishies out together for 15 minutes earn about 8 to 12 points (greet 1, chats 3, nuzzles 4, a song 1, a pile 1, play 2). So Pals takes 1
or 2 sessions and Close pals 3 or 4 sessions over at least 2 days (the 20 a day cap).

## 5. Emotes ("squishmoji") and voices

### 5.1 The 24 squishmoji (drawn as SDF icons in one shader, no texture, no font, no system emoji, D2)
Each icon is made from 1 to 4 primitives (circle, ring, capsule, triangle, arc). The style is soft round strokes, cream on plum.

| id | drawing | meaning | id | drawing | meaning |
|---|---|---|---|---|---|
| `snug` | two round blobs touching | I like you (nuzzle, comfort, friendship) | `seashell` | a spiral arc in a cone | wants Sunfizz Cove; the Cove's icon |
| `wave` | an arc with three short ticks | Hello! | `pine` | three stacked triangles | wants Hushpeak; the Peak's icon |
| `chirp` | three nested sound arcs | chatting | `cabin` | a box with a roof and chimney | wants Hearthpine Cabin; the Cabin's icon |
| `note` | a music note | singing | `lamp` | a dome lamp with a glow ring | wants to go home; Dusk Nook's icon |
| `sparkle` | a four-point twinkle | Yay, that was fun | `ball` | a circle with a seam arc | let's play |
| `query` | a curly question mark | What's that? | `star` | a five-point star | I did it! A big ride, please |
| `wow` | a round burst ring | Oh! | `moon` | a crescent | bedtime, a cosy spot please |
| `dizzy` | a spiral | dizzy (after a toss or a slide) | `puff` | a small cloud puff | hmph (the ball rolled away) |
| `zzz` | three little z strokes | sleepy, napping | `squeeze` | two soft brackets pressing a dot | wish: a slow squeeze |
| `sun` | a disc with short rays | warm and happy | `stretch` | a dot with two rounded arrows | wish: a big stretch |
| `flake` | a six-arm snowflake | chilly | `drop` | a water drop | splash, wet, wants water |
| `cosy` | a small flame | cosy and warm (hearth) | `pair` | two identical blobs, mirrored | twins (mirror dance) |

There is **no heart icon**. "Heart" already names the protection mark in the Hoard (DESIGN 5.6; `FLAG_FAV`, `store.ts` 44). A heart bubble would teach
the wrong word. Affection is `snug`.

### 5.2 Bubble rules
- **Speech bubble:** a rounded box of 40 x 36 CSS px on a phone (46 x 42 on desktop) with a 6 px tail toward the squishy. Fill plum `#2a1744` at 92%
  alpha, rim 1.5 px lagoon at 70%, icon cream `#fff1d6` (cream on plum is far above 4.5:1; probe UI02 measures it on each sky). **Thought bubble** (wishes):
  three overlapping circles in dusk `#5b3a86` and two trailing dots.
- **Anchor:** 1.25 R above the body centre. Two bubbles stay at least 44 px apart on screen (shifted sideways using the frame-room data, `bodyview.ts` 52)
  and are clamped inside the safe insets.
- **Motion:** a pop from scale 0.6 to 1.0 in 160 ms with a 6% overshoot, held 1.6 s, then a 200 ms fade. Calm and reduced motion: fade only, no scale.
  A bubble is never a flash: alpha only, no white burst.
- **Wish bubbles** stay 6 s, then shrink to a 14 px dot above the squishy. The dot counts 0.25 of a bubble. It re-opens for 4 s every 45 s, on pointer
  hover, or on keyboard focus of that squishy.
- **Pieces** share one bubble per parent, anchored on the face piece (or on the largest chunk when the face piece is off screen).
- **Snap photos** include the bubbles (they are 3D). The Snap bar gets a "Bubbles" switch (default on).

### 5.3 Voices (procedural, `src/audio/creature.ts`, no samples, no words)
- **Pitch.** A whole squishy's base note is A5 (880 Hz) x `pitchRatio(g)` (`genome.ts` 140-144: about 0.70 to 1.43), snapped to the nearest D major
  pentatonic note (D E F# A B) from D5 to D6 (587 to 1175 Hz). A piece multiplies by `popSize(frac)` = (0.5 / frac)^0.4 (`audio/cut.ts` 129; x1.74 for 1/8),
  snapped from D6 to D7 (1175 to 2349 Hz). That is above the mallet's top note (D6, AUDIO map 3) and 7 dB quieter.
- **Timbre.** One cached `PeriodicWave` per flavour plus one formant biquad. The flavours are the 6 of `FAMILY_FLAVOUR` (`audio/cut.ts` 35-42): gel clear
  (few harmonics), sticky nasal (narrow band), foam breathy (a noise mix), beads (a granular tick onset), dough dark, firm bright.
- **Syllables** (one oscillator, contour by automation, 3 to 4 nodes each): chirp (a rise of +4 semitones in 90 ms), coo (a fall of -3 in 160 ms), purr
  (flat, 28 Hz amplitude flutter, 240 ms), hum (flat, 5 Hz vibrato of +-15 cents, 300 ms), trill (3 notes up the pentatonic, 50 ms each), peep (pieces:
  a 40 ms blip).
- **Voice print.** Each species picks 3 favourite syllables and a rhythm from `mulberry32(hashString(id) ^ 0x3c6ef372)` (a new salt). Two Dollops sound
  alike, slightly apart in pitch.
- **Phrases (what a sound means):** greet = chirp-chirp; answer = the mirrored contour with the same rhythm (as the composer answers, `music.ts` 393-401);
  chat = 2 or 3 print syllables; nuzzle = purr; wish = chirp plus a trill ending a fifth up (asking); granted = a trill up plus a hum; nap = a long falling
  coo, then silence; comfort = coo, coo; huff = one low coo (-5 semitones); beam = a chirp an octave up; copy = shared peeps.
- **Call and response.** The answer starts 250 to 450 ms after the call ends (seeded). LIFE passes `replyTo` and audio stays stateless apart from its limiter.
- **Harmony.** A sing-together takes the field's chord tones (`music.ts` 247) on the eighth grid (`SLOT_S`, `music.ts` 25) through a new
  `musicClock()` accessor that reports the field that is **sounding now** (the harness readout runs up to a bar ahead, AUDIO map 1). Voices take the root,
  third and fifth in the order they join. With music off: the home field (D add9) on the same 66 BPM grid.
- **Levels.** A whole squishy peaks at -18 dBFS at Voices 60%; pieces at -25; a piece group at one piece plus 2 dB (never N voices). Pan follows screen x
  (-0.6..0.6). The gain falls with distance from the frame centre: x (1 - 0.5 d / d_max).
- **Never in the room.** Chatter never calls `registerFx`, so the music never dips for it (AUDIO map 1). It takes priority -1, so it is stolen before any
  player sound (`engine.ts` 56). It draws from its own rng stream, so existing seeds stay bit-exact. It is silent during ceremonies (this avoids the C/C#
  key clash, AUDIO map 6), for 2 s after the whole-again flourish, and while any finger is down (no new syllable starts; the touched squishy may answer once on
  release).

### 5.4 The attention budget (`src/shell/attention.ts`, sim time, token buckets; audio keeps its own pure `ChatterLimiter` as a backstop)
Profile: **phone** = coarse pointer and the short viewport side under 600 CSS px; otherwise desktop. Calm follows the existing setting.

| channel (autonomous only) | phone | phone Calm | desktop | desktop Calm |
|---|---|---|---|---|
| bubbles on screen at once (a wish dot counts 0.25) | 3 | 2 | 5 | 3 |
| bubble starts per second (bucket size / refill) | 2 / 1.5 | 1 / 0.5 | 3 / 2.5 | 2 / 1.0 |
| minimum gap between two bubbles of one character | 4 s | 8 s | 3 s | 6 s |
| creature voice groups live at once | 2 | 1 | 3 | 1 |
| syllable starts per second (bucket size / refill) | 4 / 3 | 2 / 1.5 | 5 / 4 | 2 / 2 |
| piece groups: bubbles / voices | 1 / 1 in total | 1 / 1 | 2 / 1 | 1 / 1 |
| haptics from autonomous behaviour | **0** | 0 | 0 | 0 |
| autonomous effect particles live (splash, snow puffs, toast sparks) | 12 | 4 | 24 | 8 |
| land and bump sounds from untouched bodies (budgeted "soft" variants) | 2 per s | 1 per s | 3 per s | 1 per s |

**Priority** (the highest wins a slot): 1. a character the player touches or touched in the last 1.5 s; 2. wish bubbles; 3. whole squishies, nearest the
frame centre first; 4. piece groups. Ties go to the older request. Losers are **dropped, not queued**; only wishes persist as state and show again when the
budget frees. A body counts as untouched when no finger touched it in the last 1.0 s; its `land` and `bump` events go to the budget instead of
`feedback.ts`. That closes the PHYS map's warning that prop launches would reach audio and haptics.

## 6. Pieces

| a piece can | a piece cannot |
|---|---|
| hop (vy x0.8), lean toward its face piece, float, sink, glide and slide (the physics is free) | make wishes, greet, chat, nuzzle or huff on its own |
| join a song as one group voice; join a nap pile; count toward a quest's size ("pieces count") | gain friendship (its deeds credit nothing to the pair table) |
| react to zones (looks apply to pieces for free, RENDER map 3) | show its own bubble (one bubble per parent squishy) |
| bump the balls and ring the chimes | wander farther than 1.2 m from its face piece |

**The brain on a cut.** The parent's brain moves to the face piece (it keeps the eyes, CUT.md 1). Each chunk gets a `PieceMind`: steering only. Chunks keep
slots on a small arc behind the face piece and hop when it hops, staggered 0.15 to 0.35 s: a little **piece parade**. Chunk needs are frozen except rest.
On the cut itself: one `query` on the face piece and one `wow` for the group. LIFE never joins pieces back by itself: that would undo the player's act.
**When whole again:** the brain continues on the whole body, stays silent for 2 s (the whole-again flourish owns the moment, `rejoin({ all })`), then
shows one `sparkle`.

**Character caps by quality.** Today the mat holds 3 / 4 / 5 wholes, all awake (`mat.ts` 22), and a cut empties the mat (`cut.ts` 244-247). New rule: a
**cost budget in units**. An awake whole costs 1, a sleeping whole 0.05, and a piece 1/3 (CUT X08 bounds 6 pieces at 2 wholes).

| tier | budget (units) | awake wholes max | wholes on screen max (the rest asleep) | pieces max | characters max |
|---|---|---|---|---|---|
| low | 3.0 | 2 | 3 | 4 | 6 |
| med | 4.0 | 3 | 4 | 6 | 8 |
| high | 5.0 | 4 | 5 | 6 | 10 |

Proof from the PHYS map's quiet-machine measurements (a resting detail-3 body 0.69 ms, a pressed one 0.87, a touching pair +0.22, 6 detail-2 pieces with
all-pairs collide 1.15 ms):
- **med, new worst case** (3 awake, one pressed, 1 asleep, 3 touching pairs, props): 0.69 x 2 + 0.87 + 0.02 + 0.66 + props 0.3 (est.) = **3.2 ms**.
  Today's med mat (4 awake, 3 touching pairs) is 0.69 x 3 + 0.87 + 0.66 = **3.6 ms**. Ratio 0.90.
- **med with pieces** (2 awake, 6 pieces, 1 asleep, 2 piece-whole pairs): 1.56 + 1.15 + 0.02 + 0.44 = **3.2 ms**.
- **low** (1 touching pair on both sides) 1.80 ms against today's 2.47. **high** (4 touching pairs on both sides) 3.84 against 4.51.

So **no tier costs more physics than today's mat**, because sleep does the work. The loaded machine is about x2.5 on every term (1.6 to 2.3 against 0.69),
and that factor applies to both sides of each comparison.

A cut **keeps the party** (a change to CUT.md section 2 and to `cut.ts` 244-247, where a cut clears the mat today). If the units would overflow, the shell first puts the farthest
untouched whole to sleep; if that is not enough, it refuses: "It's busy here. Put one squishy back on the shelf to cut." When the tier drops, the shell
sleeps untouched wholes first. Only if the wholes still exceed the cap does it send the most recently brought out, untouched one to the shelf, with the
line "Plumpet went back to the shelf for a rest."

## 7. Purpose: the Journal

### 7.1 What the Journal holds
- **Story:** 4 chapters (Dusk Nook, Sunfizz Cove, Hushpeak, Hearthpine Cabin), 37 quests, a finale per chapter, the open wishes at the top.
- **Squishies:** a page per species with 12 facts (7.7). A page with all of F0 to F10 gets a **Gold Ribbon**; F11 (a mirror dance, which needs two copies)
  adds a small `pair` mark to it.
- **Friends:** every pair met, its level, the best-friend marks.
- **Keepsakes:** 24 small objects (7.8), and later a shelf at Home.
- It is practice-only on this device, like the ghosts. It holds aggregates only (no touch log), so it could move to a server unchanged (COLLECTION 7.10).

### 7.2 The event vocabulary (typed, produced by named code; one flat reusable record on the hot path)
`PlayEvent` is the documented union. On the hot path the shell writes the same data into a preallocated flat record, `PlayEventRec { k, place, a, b, c,
size, v, flags, m0, m1 }`, where `m0` and `m1` are a 64-bit mask of the species present (`idx` at most 49 today, at most 63 before the mask must widen).

| k | fields | produced by | when |
|---|---|---|---|
| `visit` | place | shell place manager | arrival after Travel, once |
| `stay` | place, sp | LIFE host | a species spends 20 s awake in a place, once per visit |
| `party` | place, size, pieces | shell party manager | the party changes |
| `out` | sp | `mat.ts` add (today only `onChange` with no payload, `mat.ts` 320) | brought out |
| `touch` | kind (squeeze / pull / poke), amount, sp, place | shell `drainBody`, a copy of `MappedTouch` (`meterfeed.ts`), **player input only** | each touch, also while the capsule table is full |
| `use` | thing, sp, by (self / player), v = seconds | LIFE host and the prop manager | a thing was used |
| `react` | r (a ReactionId), sp, family, place, piece flag, v | LIFE host (zone entries) and the shell (looks applied) | a family reaction happened |
| `social` | s (a SocialKind), a, b, size, place, thing, m0/m1 | LIFE host | an interaction completed |
| `wish` | sp, w, granted | LIFE host | shown or granted |
| `cut`, `whole` | pieces / maxPieces, place | `shell/cut.ts` part and whole (a new `onCut` hook; today `'joined'` is never emitted, SHELL map 4) | a cut session |
| `toss` | sp, into (zone or thing) | `feedback.ts` lift and toss (exposed) plus where it landed | a player toss |
| `photo` | place, size | `hudBinding.ts` Snap save (a new `game.notePhoto()`) | a saved photo |
| `gain` | sp, how (capsule / restock / merge / gift), isNew | ceremony end (`RevealInfo`) and the restock and gift claims | a squishy arrives |
| `signature` | sp | LIFE host | it beamed at its favourite touch |
| `mirror` | sp | LIFE host | a mirror dance |
| `warm` | sp, level | collection (journal) | a squishy's warmth crosses 10 / 30 / 60 / 100 |

### 7.3 The rule language (data in `src/data/quests.ts`, checked by `applyPlayEvent` in `src/core/quests.ts`)
A rule matches one event kind with filters and counts matches. `distinct` counts distinct values (kept in a set of at most 8 per quest). `near` means the
event happened within 1.6 m of that thing. `pieces` sizes count pieces. Example: `{ ev: 'social', s: 'nap', minSize: 3, near: 'glowLamp', count: 1 }`.
Two **derived** kinds can be matched too: `fact` (a fact was found) and `friend` (a pair reached a level). The reducer produces them, so they need no shell
producer.

### 7.4 Chapters and quests (37). All quests of an open chapter are open at once and nothing inside a chapter is locked; the tracker suggests them in order
**Chapter 1, Dusk Nook: "First Friends"** (opens at the start; the finale opens when 7 of n1..n9 are done)

| id | title | hint | rule | est. |
|---|---|---|---|---|
| n1 | Say hello | Squeeze your squishy for a moment. | `touch` squeeze, amount >= 0.4, x1 | 0:10 |
| n2 | A big stretch | Stretch it, then let go. | `touch` pull, amount >= 0.35, x1 | 0:25 |
| n3 | A new friend | Pick today's gift, or open a capsule. | `gain` any, x1 | 0:55 |
| n4 | Two together | Bring out two squishies at once. | `party` size >= 2 | 1:05 |
| n5 | Hello, hello | Watch two squishies greet each other. | `social` greet, x1 | 1:15 |
| n6 | Ball time | Let a squishy play with the Bumper Ball. | `use` bumperBall, any, x1 | 2:00 |
| n7 | Fill the meter | Hold and stretch to fill the meter, then open the capsule. | `gain` how = capsule, x1 | 2:15 |
| n8 | Sing along | Tap the Music Box. Who sings? | `social` sing, place nook, x1 | 2:50 |
| n9 | A wish | Give a squishy what it wishes for. | `wish` granted, x1 | 3:15 |
| n10 | **Friends photo** (finale) | Take a photo of two friends together. | `photo` size >= 2 | 4:15 |

Finale reward: keepsake **Felt Star**; a gift pick of **Plumpet, Puddlo or Crumbit** ("All three love Sunfizz Cove"); **Sunfizz Cove opens**; the Snooze
Cushion arrives at Home.

**Chapter 2, Sunfizz Cove: "Sun and Splash"** (the finale opens at 6 of c1..c8)

| id | title | hint | rule |
|---|---|---|---|
| c1 | Sandy hello | Go to Sunfizz Cove. | `visit` cove |
| c2 | Float like a boat | Let a squishy float in the Tide Puddle. | `react` float, place cove, x1 |
| c3 | Splash | Toss a squishy into the water. | `toss` into water, x1 |
| c4 | Slide down | Give three rides down the Sand Slide. | `use` sandSlide, x3 |
| c5 | Ball for two | Two squishies play with the Beach Ball. | `social` play, thing beachBall, size >= 2 |
| c6 | Every way is fine | See three kinds of squishy in the water. | `react` float/sink/soak/slosh, place cove, distinct family, x3 |
| c7 | Sun nap | Two squishies nap in the sun. | `social` nap, size >= 2, zone sun |
| c8 | Piece parade | Cut a squishy into three, then make it whole. | `whole` maxPieces >= 3, place cove |
| c9 | **Chime song** (finale) | Three sing by the Driftwood Chimes. Pieces count. | `social` sing, size >= 3, near driftChimes, pieces |

Finale: keepsake **Sea Glass**; a gift pick of **Glugbean, Thumbly or Boingle** (Peak lovers; Glugbean and Thumbly are best friends, and Boingle is
Twangle's); **Hushpeak opens**; the Tilt Board arrives at Home.

**Chapter 3, Hushpeak: "Frost and Glow"** (the finale opens at 6 of p1..p8)

| id | title | hint | rule |
|---|---|---|---|
| p1 | Snowy hello | Go to Hushpeak. | `visit` peak |
| p2 | Wheee | Give a ride down the Sled Hill. | `use` sledHill, x1 |
| p3 | Ice skaters | Let two kinds of squishy glide on the Ice Pond. | `react` glide, distinct family, x2 |
| p4 | Snow prints | Leave ten prints in the snow. | `react` print, place peak, x10 |
| p5 | Boing | Bounce on the Bouncy Bough three times. | `use` bouncyBough, x3 |
| p6 | Warm up | Help a chilly squishy warm up by the Glow Lamp. | `react` warmUp, place peak, x1 |
| p7 | Snowball team | Two squishies push the Snowball together. | `social` play, thing snowball, size >= 2 |
| p8 | Brrr, a hug | See a squishy comfort a chilly friend. | `social` comfort, place peak, x1 |
| p9 | **Lamp lullaby** (finale) | Three nap together by the Glow Lamp. Pieces count. | `social` nap, size >= 3, near glowLamp, pieces |

Finale: keepsake **Woolly Hat**; a gift pick of **Wisplet, Crimpo or Munchip** (Cabin lovers; Crimpo is the starter Dollop's best friend);
**Hearthpine Cabin opens**.

**Chapter 4, Hearthpine Cabin: "Cozy Nights"** (the finale opens at 6 of h1..h8)

| id | title | hint | rule |
|---|---|---|---|
| h1 | Knock knock | Go to Hearthpine Cabin. | `visit` cabin |
| h2 | Toasty | Let a squishy warm up by the Hearth. | `react` warmUp/toast/soften/ooze, near hearth, x1 |
| h3 | Rock-a-bye | Watch a squishy rock in the Rocking Seat. | `use` rockingSeat, x1 |
| h4 | Swing for two | Two squishies share the Swing Basket. | `social` play, thing swingBasket, size >= 2 |
| h5 | Yarn tumble | Let a squishy roll the Yarn Ball. | `use` yarnBall, x1 |
| h6 | Rug pile | Make a nap pile of four on the Wool Rug. Pieces count. | `social` nap, size >= 4, near woolRug, pieces |
| h7 | Fireside song | Four sing by the Hearth. Pieces count. | `social` sing, size >= 4, near hearth, pieces |
| h8 | Best friends | Find a pair of best friends. | `fact` F3, x1 |
| h9 | **Goodnight, everyone** (finale) | Everyone in your party naps together. | `social` nap, size = party size (>= 3), place cabin, pieces |

Finale: keepsake **Fir Cone**; a gift pick of **Swishel, Capnap or Kneadle** (Uncommons that love Home; Capnap and Kneadle are the cheapest way into
slow-rise and putty, the two families with no Common); a closing line: "Every squishy has a page in your Journal. Fill them all, one day at a time."

**Can everything be done with Commons?** Yes. A probe (QU01) checks every rule statically. Sizes up to 4 are reachable on low quality (2 awake wholes,
1 asleep, 1 cut into pieces: 2 + 4 pieces = 6 characters, 2.4 units). The family-specific steps need only families that have a Common (marshmallow for
toasting: Wisplet, Cushlet). h8 is reachable with the gifts alone (Dollop plus Crimpo; Glugbean plus Thumbly).

### 7.5 Unlock order and why
**Nook, then Cove, then Peak, then Cabin.** The Cove is bright and readable, and it shows the clearest "own way" contrast (float or sink). The Peak brings ice,
wind and ramps. The Cabin is the warm, slow ending with fire and nap piles. Each place opens at its previous finale, **or** once 7 quests of the previous
chapter are done (6 for chapters 2 and 3), so nobody is stuck behind one quest. After an unlock the next place's chunk prefetches in idle time (9.9).

### 7.6 Wishes
| wish | icon in the thought bubble | caption (on tap) | granted when |
|---|---|---|---|
| a place | `seashell` / `pine` / `cabin` / `lamp` | "Puddlo wishes for the seaside." | it arrives in that place in the party |
| a kind of thing | `ball` / `star` (a ride) / `drop` (water) / `moon` (a cosy spot) / `note` (music) / `cosy` (warmth) | "Twangle wants a big ride." | it uses any thing of that kind (its favourite counts double toward fact F2) |
| a friend | `snug` | "Crimpo wants to see Dollop." (only squishies you own) | they greet or nuzzle |
| a slow squeeze / a big stretch | `squeeze` / `stretch` | "Glugbean wishes for a slow squeeze." | the player squeezes it for 1 s or more / pulls it to level 0.6 or more |
| a nap / a song | `zzz` / `note` | "Wisplet is sleepy." | it naps / it sings in a group |

**Caps:** at most 1 open wish per squishy, 2 on screen, 3 kept in the Journal (a 4th quietly replaces the oldest). A new wish needs 180 s of play since that
squishy's last one, and 120 s since any new wish on screen. The **first wish is scripted**: 90 s after the first greet, the newest squishy wishes for a slow
squeeze (the easiest grant). **Wishes steer discovery:** while a species' favourite place or thing is undiscovered, 40% of its place and thing wishes point at
it. **Nothing is lost:** a wish has no visible timer. When the squishy goes back to the shelf the wish "rests" in the Journal list ("Puddlo still wishes for
the seaside. No hurry."). A grant gives warmth +5, fact F8, a `sparkle` and a happy trill. It gives no points and no capsule.

### 7.7 Discoveries: 12 facts per species (16-bit mask per species, 600 in all; derived in `core/quests.ts` from the events, using `SPECIES_LIFE`)
| fact | Journal line (example) | rule |
|---|---|---|
| F0 met | "You met Puddlo." | `gain` or `out` of the species |
| F1 favourite place | "Puddlo loves Sunfizz Cove." | `stay` in its `SPECIES_LIFE` place |
| F2 favourite thing | "Its favourite thing is the Tide Puddle." | `use` of its thing |
| F3 best friend | "Its best friend is Dimpla." | the pair reaches Pals (12) |
| F4 water way | "In water, Puddlo floats and sloshes." | `react` float/sink/soak/slosh at the Cove |
| F5 snow way | "On ice, it glides a long way." | `react` glide/frost/snowcap/print/drift at the Peak |
| F6 fire way | "By the fire, it glows warm." | `react` toast/soften/ooze/glow/warmUp by the Hearth |
| F7 its song | "It sings with friends." | `social` sing, size >= 3, with it in the mask |
| F8 its wish | "It wished for the seaside." | `wish` granted |
| F9 its touch | "It loves a poke." | `signature` |
| F10 nap spot | "It naps in a pile." | `social` nap, size >= 2, with it |
| F11 mirror dance | "Two Puddlos dance alike!" | `mirror` |

Until a fact is found, the page shows a hint, never a blank: "Found by visiting the place it loves." Best friend before F3: "Its best friend loves Hearthpine
Cabin" (the friend's favourite place). That points the player at a specific species without a gate.

### 7.8 Keepsakes (24, a 32-bit set; objects and plants only, D10)
| place | keepsake: how it is found |
|---|---|
| Nook | **Felt Star** (finale 1) · **Button**: two nap on the Snooze Cushion · **Thimble**: squishies push the Bumper Ball 10 times by themselves · **Spool**: a squishy reaches warmth 30 · **Marble**: see a mirror dance · **Wind-up Key**: three sing to the Music Box |
| Cove | **Sea Glass** (finale 2) · **Sun Hat**: a squishy rides the Drift Raft for 30 s · **Smooth Pebble**: three different squishies ride the Sand Slide · **Paper Boat**: three pieces float · **Sand Pail**: 10 prints in the sand · **Beach Flag**: toss a squishy onto the Drift Raft |
| Peak | **Woolly Hat** (finale 3) · **Icicle**: a glide of 3 m on the Ice Pond · **Snowdome**: four sing by the Glow Lamp · **Tiny Sled**: five rides down the Sled Hill · **Scarf**: two kinds warm up at the lamp · **Frost Crystal**: five kinds get frosty |
| Cabin | **Fir Cone** (finale 4) · **Cocoa Mug**: a marshmallow squishy toasts · **Acorn Cap**: three different squishies roll the Yarn Ball · **Patchwork Square**: a pile of five on the Wool Rug · **Wooden Spoon**: two pals share the Swing Basket · **Toffee Tin**: six sing by the Hearth (pieces count) |

The Journal shows unfound keepsakes as dashed outlines with the hint above. Later (after S3) found keepsakes stand on a felt shelf at the back of Dusk Nook,
drawn as small procedural objects (one instanced draw).

### 7.9 Warmth (per squishy, not "Heart")
0..100 per ghost id. It grows by +1 for each squeeze of 1 s or more or each pull to level 0.6 or more by the player (at most +8 per squishy per day), +5 for a
granted wish, and +2 for a nap at its favourite place (once a day). It **never decays**. Thresholds: 10 = "knows you" (looks at your pointer more, no shy
arrival); 30 = "comfy" (its quirk shows); 60 = "close" (answers your touch with its duet); 100 = "dear" (a small mark on its Hoard card). **A merge keeps
the love:** the result gets the larger of its parents' warmth. A traded squishy (later) arrives at 0 and does a shy arrival. Warmth is behaviour and
looks only.

### 7.10 The first ten minutes, minute by minute (a regular player at about 29 SP per minute while holding and stretching; all times est.)
| time | what happens | quests done |
|---|---|---|
| 0:00 | "Wake it up". Dollop on the felt. The tracker pill: "Say hello: squeeze Dollop for a moment." The Music Box sits at the shelf edge. | 0 |
| 0:10 | A squeeze of 0.4 s or more. Plate: "Done: Say hello · 1 of 10". Pill: "A big stretch". | 1 |
| 0:25 | Stretch and let go. Pill: "A new friend: pick today's gift". Tapping the pill opens the Hoard's Restock (the daily pick exists today, `ghost.ts` 152-166). | 2 |
| 0:55 | Picks Glugbean. Pill: "Two together: bring Glugbean out" (the pill's action brings it out). | 3 |
| 1:05 | Two on the mat. Glugbean's shy arrival: it looks down. Within 2 to 4 s: `query` bubbles, then `wave` bubbles, a chirp-chirp and an answer. | 5 |
| 1:30 | The Bumper Ball rolls in from the shelf edge ("A ball!" in the live region). Dollop notices it (`query`) and hops into it within 10 to 30 s, or the player flicks it. | 6 (at 2:00) |
| 1:50 | The meter fills (30 SP; the 77 s median of DESIGN 5.4 plus the Restock detour). The capsule lands; the pill says "Open the capsule". | |
| 2:15 | Opens it: Munchip (say). The reveal plays; the party is put back after it. | 7 |
| 2:30 | Pill: "Sing along: tap the Music Box". A tap: an 8-bar tune; both sway with one shared `note` bubble and hum in harmony. | 8 (at 2:50) |
| 2:45 | The scripted first wish: a thought bubble over Glugbean with the `squeeze` icon. Pill: "A wish: Glugbean wants a slow squeeze." | |
| 3:15 | A 1 s squeeze: `sparkle`, a happy trill. A new Journal line: "Glugbean wished for a slow squeeze." | 9 |
| 3:30 | Finale open. Pill: "Friends photo". Toys, then Snap, then Save (the bubbles show in the photo). | |
| 4:15 | **Chapter done.** Plate: "Chapter done: First Friends. A gift is waiting." Felt Star found. The Places button appears with one 400 ms scale-in. The Cove chunk starts to prefetch. | 10 |
| 4:30 | Journal, then the gift: Plumpet, Puddlo or Crumbit. Picks Puddlo. | |
| 5:00 | Places: Sunfizz Cove, with Dollop, Glugbean, Munchip and Puddlo (med: 4 wholes, 3 awake). Go: a 0.6 s snapshot crossfade (`screenfx.ts` 79). | |
| 5:15 | Surf ambience. The party hops off the spawn spots. | c1 |
| 5:40 | Puddlo has stayed 20 s: `sparkle`. A Journal dot: "Puddlo loves Sunfizz Cove." | F1 |
| 6:00 | Tosses Puddlo into the Tide Puddle: splash, it floats and sloshes. | c3, c2 (+F4) |
| 7:00 to 8:00 | Carries three squishies up the Sand Slide (Glugbean shows a `star` wish first). | c4 |
| 8:30 to 9:30 | The Beach Ball rolls; Dollop and Munchip pass it. | c5 |
| 10:00 | **15 quests done, 5 squishies, 2 places, 6 to 10 facts, 1 keepsake, 1 wish granted, 0 points paid by the Journal.** | |

A **poker** (13.5 SP/min, mostly taps, DESIGN 5.4) fills the first meter at about 134 s. n7 then comes later, but the chapter still finishes on time: the finale
needs only 7 of 9 and the second squishy comes from the Restock. A player who **only taps** never fills the meter (0 SP, by the owner's rule), so n1, n2
and n7 wait for a first hold. Their hints teach holding, and nothing else in the chapter is blocked.

### 7.11 Day 2, day 7, day 30 (a regular player: about 2 sessions of 10 to 15 minutes on 70% of days; numbers est. unless cited)
| day | where they are | what pulls them back (nothing pushes) |
|---|---|---|
| 1 | Chapter 1 done; the Cove chapter half done; about 5 species; 8 to 15 facts | a wish left open in the Journal; the Cove half explored |
| 2 | The Cove finale (about 25 to 35 minutes for chapter 2); Hushpeak opens; gift Glugbean, Thumbly or Boingle; the first best-friend pair likely (Glugbean and Thumbly) | the Journal opens where they left it; the daily tasks and the restock gift (both exist); open wishes "No hurry" |
| 7 | Chapters 3 and 4 likely done (all 37 quests about 1.5 to 2 active hours); about 20 species (DESIGN 5.9 week 1 mean 20.1); 80 to 120 facts; 3 to 6 best friends; 8 to 12 keepsakes | the Keeper's book: new species open new pages; wishes point at undiscovered favourites; Close pals pairs |
| 30 | about 35 species (week 4 mean 34.7, DESIGN 5.9); about 250 of 600 facts; 10 to 14 best-friend pairs (both members owned for about half of the 25); 16 to 20 keepsakes; 8 to 15 Gold Ribbons | every capsule says "a new page" or "a twin for a mirror dance"; merges bring pages; the last Mythic pages and ribbons ride the 247 / 153-day collection arc |

### 7.12 The economy proof
| reward | touches the economy? | bound | effect on the tested pace |
|---|---|---|---|
| squish points from the Journal or LIFE | **no**: `core/quests.ts` imports no meter function (import probe), LIFE never calls finger APIs (the only paying kinds, `meterfeed.ts` 43-65) | 0 | none |
| capsules from the Journal | **no** | 0 | none |
| gift picks (one chosen squishy per finale) | yes, items | **4 for life**: 3 Commons and 1 Uncommon, from fixed lists shown to the player | below |
| keepsakes, facts, ribbons, warmth, friendship, place unlocks | no (looks, behaviour, content) | n/a | none |
| daily tasks and restock | unchanged (2 tasks a day, 5 a week; 1 pick a day) | as today | none |

**The pace (active minutes per capsule) cannot move.** It is a property of the meter alone, and nothing new feeds it except player touches at the same pay
(the valve at 40 SP a minute and the 12-a-day cap still bound everything, `meter.ts` 108-116). The gate stays: paying styles at 3.0 to 3.8 active minutes a
capsule (probe_economy rows 221-224), measured 3.2 / 3.5 / 3.7 / 3.2 (ECON_NOTAP 58-66). MERGE_COST 2 stands: it flips only at about 1.5 minutes.

**Gifts, in numbers.** A regular player gets about 6.0 play capsules plus 1 restock pick per active day (DESIGN 5.4 sim C) plus up to 5 task capsules a week:
about **5.6 items per calendar day**, so about 168 items by day 30 and about 1380 by day 247. Four gifts are 2.4% of the items at day 30 and 0.3% of the
items to finish. **They cannot touch the binding tail:** all 50 is bound by the Mythic and Legendary rows (a specific Mythic is 600 capsules to a first copy,
DESIGN 5.2), and gifts are Common and Uncommon only.
**The most a gift can save:** a specific Common arrives by capsule at 4.2 x 5.45% = 0.23 a day plus by restock at 3/25 = 0.12 a day, so it is about 2.9 days
away. A specific Uncommon arrives at 4.2 x 1.18% + 0.12 = 0.17 a day, about 5.9 days away. So the four gifts save at most about 3 x 2.9 + 5.9 = 14.6
species-days on rows that finish by day 9 (Common) and 19 (Uncommon) anyway (DESIGN 5.11, the old canonical run). **Merges:** 4 extra items allow at most
2 extra merges for life, each a Common or Uncommon lottery ticket (tier-up 30% / 25%), against about 21 merges by day 247 (8.5 per 100 days, sim O).
**Verdict:** the all-50 day (247 solo, 153 with trade) moves by less than 1 day (est.); sim K must re-quote it (EC04).

**Origin.** Gifts use origin `'restock'` (an existing code, `store.ts` 50) through a new `ghostGrantGift` in `ghost.ts`. That function builds the genome
with `speciesBaseGenome` (no roll), just as `ghostClaimRestock` does. A new origin code would be dropped by every older build's `sanitizeRow` and the save
parked (CORE map 3). The word rollCapsule never appears outside ghost.ts (probe I03). At GHOST_CAP 100 the gift **waits** in the Journal: "Your shelf is
full. Your gift will wait here."

### 7.13 The dark-pattern audit
| pattern | here? | why not |
|---|---|---|
| streaks, daily login rewards | no | the Journal has no day counter; the existing restock and tasks keep their "never accumulate guilt" rule (DESIGN 8.4) |
| countdowns, limited-time quests, FOMO | no | every quest, wish and keepsake is permanent; no wish shows a timer |
| loss, decay, neglect | no | needs reset on coming out; warmth and friendship never fall; nothing can be failed |
| guilt copy ("sad", "lonely", "misses you") | no | a copy rule (UI06); huff is about the ball, never the player |
| random rewards for finishing a set (kompu gacha) | no | the gifts are chosen from fixed, shown lists; keepsakes are fixed |
| nags and notifications | no | no push; the Journal shows one small dot for something new, never a number |
| variable rewards to keep tapping | no | wishes are spaced (120 to 180 s), capped, and never paid |
| social pressure between players | no | friendship is between squishies only |
| grind | no | no quest needs more than 10 of one deed; all 37 take about 2 hours |
| idle income | no | autonomy pays 0 (EC02) |

### 7.14 Collecting, merging and trading gain meaning
- **Collecting.** Every new species opens a page with 12 facts, a favourite place to visit, and a best friend to find. A capsule reveal of a new species adds
  "New page in your Journal" to the plate. A **repeat** is no longer flat: two of one kind do a mirror dance (F11) before you merge them. That gives spares a
  use besides merging (DESIGN risk 6: "dozens of repeat Commons could feel flat").
- **Merging.** Facts belong to the species, so merging copies away never loses Journal progress. The result keeps the larger warmth. A result of a species
  you lack opens a page, and the preview can say so.
- **Trading (later, server).** Hints name *specific* species ("Its best friend is Slumbrel"). That gives an exact reason to trade, which is exactly what
  trading is for (DESIGN 5.8: "merge is random, trade is exact"). An optional "best friends I have not met" list can pre-fill the wants board (opt-in,
  species icons, no text, TRADE rules). Journal progress itself is never traded or shown to anyone.

## 8. Screens (built on `theme.ts` tokens and `h()`, CSSOM only; restyled with the UI overhaul, `_spec/UI.md`)

### 8.1 Phone, 390 x 844 (S = the safe-area top inset, 47 px on a notch phone)
| element | position | size | behaviour |
|---|---|---|---|
| top bar (exists) | y S+8 | 44 tall | wordmark x 16..~190; mute x 278; gear x 330 |
| **Journal button** (new) | x 330, y S+60 | 44 x 44 | book icon; one 6 px amber dot when something is new (a gift, an unseen fact or keepsake) |
| **Places button** (new) | x 330, y S+112 | 44 x 44 | signpost icon; hidden until the Cove opens, then one 400 ms scale-in |
| **Quest pill** (new) | x 16, y S+64, max right edge 318 | 36 tall (44 px hit area), width 120..302 | chapter icon 20 px plus a 15 px title, truncated with an ellipsis; "2 of 3" for counts; tap = Journal at that quest; fades out (150 ms) while the reveal plate or a quest moment uses the plate slot (top +70) |
| wish caption (DOM) | under the 3D wish bubble | max 240 wide | 2.5 s; slides clear of the capsule (`avoidCapsule`, `hudBinding.ts` 337-357) |
| bottom row | unchanged | | name tag, Hoard / Toys / mat chip, meter ring |

The shell reports a top inset of S+104 and a right inset of 60 px through `setSafeInsets` (`hudBinding.ts` 121-142), so the capsule lands clear. At 320 x 568
the pill shrinks to at most 236 px and the column moves to x 260.

### 8.2 Desktop, 1280 x 800
The top-right cluster holds Journal, Places, mute and gear (4 x 44 with 8 px gaps), with labels on hover and focus ("Journal (J)", "Places (P)"). The quest
pill sits at x 24, y 72, max 360 wide, 40 tall, 16 px text: "Next: Ball time".

### 8.3 Travel ("Places")
**Phone:** a full-height sheet (z 7, like the phone Hoard) with `suspend('covered')`, so the sim pauses. Header "Places" plus close. Four place cards,
112 px each: a 96 x 96 CSS-gradient tile from the place palette (no image), the name (17 px), one mood line (13 px dim, for example "Warm sand and a fizzy
sea"), "3 of yours love it" (counted from known F1 facts only), and a status chip: Here / Open / "Opens after Chapter 2". Then "Bring along": slots up to
the tier's wholes cap (3 / 4 / 5), 56 px species icons from `speciesIcon.ts`, and "Change", which opens a 4-column shelf grid. Footer: a 52 px primary
button, "Go to Sunfizz Cove".
**Desktop:** a 760 x 520 modal with `holdInput('travel')`. Place cards in a 2 x 2 grid (220 x 180 each) on the left, the party column (280 px) on the right.
**Flow:** `leaving()` (it reconnects a cut and releases locks), a 0.6 s snapshot crossfade, the place chunk (prefetched), props and zones set, bodies
rebuilt at the spawn spots, LIFE reset to the place, the `visit` event, the ambience crossfade (2 s). It is refused during a ceremony (`whenIdle`). If loading
takes over 300 ms the line "Packing up..." shows. A load failure keeps the player where they were: "Sunfizz Cove did not load. Try again."

### 8.4 The Journal
**Phone:** a full sheet (z 7), header "Journal" plus close (44 px), then a 44 px segmented control: Story | Squishies | Friends | Keepsakes.
- **Story:** an "Open wishes" card (when any are open: species icon plus caption, 56 px rows). Chapter cards: an 8 px gradient strip from the place
  palette, the name, "6 of 9". Quest rows are 56 px: a check circle (24 px), the title (16 px), the hint (13 px dim) and a 4 px progress bar for counts. The
  finale row shows the keepsake and gift icons. Locked chapters collapse to one line: "Opens when you finish Chapter 1." A **gift card** when ready: three
  104 x 120 species tiles (icon, name, family, "New", "Dollop's best friend" when true), then "Bring Crimpo home?" with Yes and "Not yet" (the gift waits
  forever).
- **Squishies:** a 5-column grid of 64 px tiles. Each tile has the species icon and a ring of 12 dots (facts found). An unowned species shows a dim
  silhouette, as the Hoard does. **Page:** icon 96 px, name, family line, 12 fact rows (an icon plus the line, or the hint), a friends row, the ribbons.
- **Friends:** 56 px rows: two icons, the names, the level as 1 to 3 small filled rounded squares (no hearts), and a "Best friends" tag.
- **Keepsakes:** a 4-column grid of 80 px cells. Found: the drawn icon and the name. Unfound: a dashed outline; tapping shows the hint.
**Desktop:** a centred 960 x 600 "open book" (two 472 px pages and a 16 px spine) with `holdInput('journal')`. The squishies keep living behind a 60% scrim.
The tabs are a vertical list on the left page. The Journal UI is its own lazy chunk, loaded on first open (9.9).

### 8.5 Moments
- **Quest done:** the plate slot (top +70, centred, max 320 px), 2.4 s (never shortened: it is reading time), slide-in 180 ms (Calm: fade). Text "Done:
  Ball time · 4 of 10". A soft UI chime (`ui({ kind })`, UI.md 5) and one 10 ms haptic tick (player-caused). Queue: FIFO of at most 3 with at least 2.6 s
  between them; never within 1 s of a burst; never during a ceremony or the reveal plate; more than 3 become "3 quests done". Live region (polite, one
  region, `announcer.ts` 15): "Quest done: Ball time."
- **Chapter done:** the same slot, 4 s, two lines plus a 44 px "See your gift" button (focusable; Esc dismisses). Live region: "Chapter done: First Friends. A
  gift is waiting in your Journal."
- **Facts:** no plate (they are frequent). The squishy shows `sparkle`, the Journal button gets its dot, and the live region says at most one every 10 s:
  "New: Puddlo loves Sunfizz Cove."
- **Keepsake found:** the plate slot, 2.4 s: "Found: Sea Glass".

### 8.6 Settings, keys, Snap, accessibility
- **Sound:** "Music" (exists); **"Voices"** (a slider, default 60%); **"Place sounds"** (a slider, default 50%). **Play:** **"Squishies move on their own"**
  (a switch, default on; help line: "When off, they stay where you put them. They still look around and chirp.").
- **Keys** (when shortcuts are on): **J** Journal, **P** Places (both free today, `keyboard.ts` 67-122). Escape order: tray, Settings, Journal, Places,
  Hoard, tool, plate.
- **Snap** hides the DOM pill, the column and the captions (they join the `hoard.css` 392-393 list). The 3D bubbles stay unless switched off.
- **Keyboard-only play:** the Journal lists open wishes as text, and "Show me" focuses that squishy. Every quest has a keyboard path: the Music Box and the
  balls are focusable 3D targets in the focus ring the play target already uses; Travel is a sheet; nap and song quests need only waiting. **Sound off:**
  every voice meaning is also an emote (D11). **Reduced motion and Calm:** caps from 5.4, fades instead of pops, no weather particles with reduced motion.

## 9. Architecture

### 9.1 Contract additions (`src/contracts.ts`; every member optional and additive; the synthesizer applies them)
```ts
/* PLAYGROUND (optional, additive) */
export type PlaceId = 'nook' | 'cove' | 'peak' | 'cabin';
export type ZoneKind = 'water' | 'warm' | 'cold' | 'ice' | 'cosy' | 'wind' | 'sun' | 'wet';
export type EmoteId = 'snug' | 'wave' | 'chirp' | 'note' | 'sparkle' | 'query' | 'wow' | 'dizzy' | 'zzz' | 'sun' | 'flake' | 'cosy' | 'seashell' | 'pine'
  | 'cabin' | 'lamp' | 'ball' | 'star' | 'moon' | 'puff' | 'squeeze' | 'stretch' | 'drop' | 'pair';
export type BodyLook = 'wet' | 'sand' | 'frost' | 'snow' | 'toast' | 'soften';
export type FaceExpr = 'none' | 'happy' | 'sleepy' | 'surprised' | 'shy' | 'proud';   // shy = gaze down and lids lower; NO blush (REFERENCES 3)
export type Phrase = 'greet' | 'answer' | 'chat' | 'purr' | 'sing' | 'wish' | 'granted' | 'nap' | 'coo' | 'huff' | 'beam' | 'peep';
export type PropSound = 'ball' | 'creak' | 'chime' | 'splash' | 'crunch' | 'crackle' | 'musicBox' | 'boing' | 'thump';
// contracts.ts stays types-only: PROP_STRIDE = 16 and ZONE_STRIDE = 12 live in src/physics/props.ts.
// shape: [type 1 sphere | 2 capsule | 3 box | 4 plane, x, y, z, qx, qy, qz, qw, a, b, c, mu, restitution, tackScale, flags, id]
// zone:  [kind, shape 0 box | 1 disc, x, y0, z, hx|r, y1, hz, strength, flowX, flowZ, flags]

export interface SoftMetrics { zones?: number /* ZoneKind bit mask at the centre */; submerged?: number /* 0..1 */; onProp?: number /* shape or -1 */ }
export interface SoftBodyLike {  // additions (doubles only on change, never per substep: the HeapNumber rule, softbody.ts 3-7)
  setProps?(shapes: Float64Array | null, count: number): void;
  readonly propLoad?: Float64Array;   // 4 per shape: impulse x, y, z and contact count this frame; PropWorld reads and zeroes it
  setZones?(zones: Float64Array | null, count: number): void;
  setGround?(grip: number, glue: number, peel: number, drag: number): void;   // multipliers eased over 0.3 s; (1,1,1,1) = today, bit-identical
  setLifeParams?(density: number, iceMu: number, slip: number, windShare: number): void;
  setBounds?(cx: number, cz: number, hx: number, hz: number, round: number): void;  setHome?(x: number, z: number): void;
  setSquash?(s: number, seconds: number): void;        // 0.75..1.15, a volume-preserving goal squash
  hop?(vx: number, vy: number, vz: number): boolean;   // false when held, airborne, asleep or ceremony-driven; vy <= 0.85 (2.0 if submerged > 0.3)
  lean?(dx: number, dz: number, amount: number): void; // a goal shear, at most 0.1 R
  wiggle?(amount: number, hz: number): void;           // at most 0.05 R, 1..4 Hz
  allowSleep?: boolean;  readonly asleep?: boolean;  wake?(): void;
}
export interface PropWorldLike {
  readonly count: number;
  readonly shapes: Float64Array;    // PROP_STRIDE per shape, rewritten by integrate()
  readonly poses: Float32Array;     // 7 per prop for the stage
  readonly state: Float32Array;     // 1 per prop: angle, travel or speed (for sounds and LIFE)
  integrate(dt: number, bodies: readonly SoftBodyLike[]): void;   // once per frame after every body stepped; one-frame lag
  push(prop: number, vx: number, vy: number, vz: number): void;   // a player flick or tap
  reset(): void;
  stateHash(): number;
}
export interface StageLike {     // additions
  setPlace?(id: PlaceId): Promise<boolean>;                        // lazy import of src/render/places/<id>.ts; 'nook' is built in
  addProp?(kind: string, index: number): number;  setPropPoses?(poses: Float32Array, count: number): void;  setPropState?(id: number, v: number): void;
  setBodyLook?(id: number, look: BodyLook, amount: number): void;  setHeat?(x: number, y: number, z: number, strength: number): void;
  setWater?(level: number | null): void;                           // the water-line tint in the jelly
  setBodyGaze?(id: number, x: number, y: number, z: number, on: boolean): void;  setBodyExpression?(id: number, e: FaceExpr, amount: number): void;
  showEmote?(id: number, icon: EmoteId, thought: boolean, groupOf: number): number;   // a handle; 0 = refused (pool full)
  hideEmote?(handle: number): void;
  stampMark?(kind: number, x: number, z: number, angle: number, size: number, life: number): void;
  setPlayArea?(cx: number, cz: number, hx: number, hz: number): void;  setObstacles?(xz: Float32Array, r: Float32Array, n: number): void;  // framing, capsule spot
  bodyScreen?(id: number): { x: number; y: number; r: number } | null;    // allocates: UI only
}
export interface CreatureCall { speaker: number; species: number; family: string; pitch: number; frac?: number; phrase: Phrase; replyTo?: number;
  group?: number; pan?: number; gain?: number; calm?: boolean; degree?: number }
export interface SquishAudio {   // additions
  setAmbience?(p: { place?: PlaceId | null; volume?: number }): void;
  creature?(c: CreatureCall): boolean;    // false = refused by the backstop limiter
  prop?(p: { kind: PropSound; intensity: number; pan?: number; self?: boolean; key?: number }): void;
  musicClock?(): { field: number; barT0: number; slotS: number; now: number } | null;
}
export interface AudioSettings { chatter?: number; ambience?: number }
export interface Settings { chatter?: number; ambience?: number; autonomy?: boolean }
```

### 9.2 Data model (flat modules in `src/data/`, data only, imports only core leaves, `catalog.ts` and `materials.ts`, CORE map 1 and 5)
```ts
// src/data/places.ts
export interface ZoneDef { kind: ZoneKind; shape: 'box' | 'disc'; x: number; z: number; hx: number; hz: number; y0: number; y1: number; strength: number;
  flow?: readonly [number, number]; gust?: { periodMin: number; periodMax: number; dur: number; accel: number; dirX: number; dirZ: number } }
export type Mech = { kind: 'static' } | { kind: 'ball'; mass: number; rollDamp: number; maxSpeed: number; restitution: number }
  | { kind: 'hinge'; axis: 'x' | 'z'; pivotY: number; limitDeg: number; inertia: number; dampRatio: number; spring: number }
  | { kind: 'pendulum'; pivotY: number; length: number; limitDeg: number; damp: number }
  | { kind: 'spring'; travel: number; dampRatio: number } | { kind: 'floater'; bob: number; bobHz: number; driftDamp: number };
export interface ColliderDef { type: 'sphere' | 'capsule' | 'box' | 'plane'; a: number; b: number; c: number; mu: number; restitution: number;
  at: readonly [number, number, number]; yawDeg: number; tiltDeg: number }
export type ThingKind = 'ball' | 'ride' | 'water' | 'cosy' | 'music' | 'warm' | 'bounce';
export interface ThingDef { id: ThingId; name: string; place: PlaceId; kind: ThingKind; colliders: readonly ColliderDef[]; mech: Mech;
  use: { by: 'self' | 'player' | 'both'; approach: number; seats: number; seconds: number }; player: 'flick' | 'tap' | 'place' | 'push';
  sound: PropSound; emote: EmoteId; arrives?: { afterQuest: string } }
export interface PlaceDef { id: PlaceId; name: string; mood: string; chapter: 0 | 1 | 2 | 3; unlock: { finale: string | null; orQuests: number };
  ground: { grip: number; glue: number; peel: number; drag: number; marks: 'none' | 'sand' | 'snow'; markLife: number };
  bounds: { cx: number; cz: number; hx: number; hz: number; round: number }; pad: { x: number; z: number; r: number };
  spawn: readonly (readonly [number, number])[]; walk: readonly { x: number; z: number; r: number }[]; zones: readonly ZoneDef[];
  things: readonly ThingDef[]; music: { fieldWeights?: readonly number[] } }
export const PLACES: Readonly<Record<PlaceId, PlaceDef>>;
// src/data/life.ts
export interface FamilyReaction { density: number; soakedDensity?: number; soakS?: number; iceMu: number; slip: number; windShare: number;
  printHold: number; hop: { squash: number; squashS: number; vy: number; vh: number; mode: 'hop' | 'scoot' };
  heat: BodyLook | 'glow' | 'none'; cold: 'frost' | 'snow'; comfort: Partial<Record<ZoneKind, number>> }   // comfort -1..1
export const FAMILY_REACTIONS: Readonly<Record<MaterialFamilyId, FamilyReaction>>;
export interface SpeciesLife { place: PlaceId; thing: ThingId; friend: SpeciesId }
export const SPECIES_LIFE = { dollop: { place: 'nook', thing: 'bumperBall', friend: 'crimpo' }, /* 49 more */ } satisfies Record<SpeciesId, SpeciesLife>;
// src/data/quests.ts
export interface QuestRule { ev: EvKind; count: number; place?: PlaceId; thing?: ThingId; near?: ThingId; zone?: ZoneKind; kind?: string;
  r?: readonly ReactionId[]; s?: SocialKind; minSize?: number; partySize?: boolean; minAmount?: number; pieces?: boolean;
  distinct?: 'family' | 'species' | 'pair' | 'thing'; fact?: number; pals?: boolean; how?: 'capsule' | 'restock' | 'merge' | 'gift' }
export interface QuestDef { id: string; chapter: 0 | 1 | 2 | 3; order: number; title: string; hint: string; rule: QuestRule; seq?: boolean;
  finale?: { needs: number; keepsake: number; gift: readonly SpeciesId[]; unlock: PlaceId | null } }
export interface KeepsakeDef { bit: number; name: string; place: PlaceId; hint: string; rule: QuestRule }
```

### 9.3 The LIFE step (`src/life/**`: pure TS, no DOM, no three, no clock, no Math.random; struct-of-arrays, capacity 12)
```ts
export interface LifeWorld {            // filled IN PLACE by the shell host every frame (no allocation)
  n: number; place: number; t: number; dt: number; calm: boolean; autonomy: boolean; quiet: boolean;   // quiet = ceremony, cut, a tool, a sheet
  slot: Uint8Array; kind: Uint8Array /* 0 whole, 1 face piece, 2 chunk */; parent: Int8Array; species: Uint8Array; family: Uint8Array;
  x: Float32Array; y: Float32Array; z: Float32Array; vx: Float32Array; vz: Float32Array; r: Float32Array;
  held: Uint8Array; heldAgo: Float32Array; asleep: Uint8Array; grounded: Uint8Array; zones: Uint16Array; submerged: Float32Array; warmth: Uint8Array;
  thingN: number; thingKind: Uint8Array; thingX: Float32Array; thingZ: Float32Array; thingState: Float32Array; thingBusy: Uint8Array;
  evN: number; evKind: Uint8Array; evA: Uint8Array; evB: Int8Array; evV: Float32Array;   // this frame's bump, land, toss, cut and whole
  pointerOn: boolean; pointerX: number; pointerZ: number; touched: number;
  friend: Uint8Array;                   // 50 x 50 levels 0..3, rebuilt by the host only on a friend event
}
export interface LifeOut {              // preallocated by the host, rewritten by step()
  op: Uint8Array; ax: Float32Array; ay: Float32Array; az: Float32Array; amt: Float32Array;   // NONE, HOP, SQUASH, LEAN, WIGGLE, GLIDE, STOP, SLEEP, WAKE
  gazeOn: Uint8Array; gx: Float32Array; gy: Float32Array; gz: Float32Array; expr: Uint8Array; exprAmt: Float32Array;
  reqN: number; reqWho: Uint8Array; reqIcon: Uint8Array; reqThought: Uint8Array; reqPhrase: Uint8Array; reqReply: Int8Array; reqPrio: Float32Array;
  deedN: number; deedK: Uint8Array; deedA: Int16Array; deedB: Int16Array; deedC: Int16Array; deedSize: Uint8Array; deedM0: Uint32Array; deedM1: Uint32Array;
}
export interface Life {
  add(slot: number, g: Genome, speciesIdx: number, familyIdx: number, kind: 0 | 1 | 2, parentSlot: number, warmth: number): void;
  remove(slot: number): void;
  setPlace(place: PlaceId): void;
  step(w: LifeWorld, out: LifeOut): void;   // deterministic: the same seed and world script give the same out, byte for byte
  reset(seed: number): void;                 // rng = mulberry32(seed ^ 0x4bd6e3b1), a new salt
  stateHash(): number;
}
```
**The host** (`src/shell/life.ts`) senses after `drain()` and acts before the next `bodies.step` (`game.ts` 548-562). The first version uses `onStep`
(`game.ts` 831), with one frame of lag. It keys brains by a stable `CharId` (the view id changes on re-add, SHELL map 2). It applies intents only on change.
It is the **one arbiter of `moveTo`**: finger > cut and ceremony > LIFE. Cut steering (`cut.ts` 194-215) keeps priority. It converts deeds into
`PlayEventRec`s on the bus, and requests into `attention.ts`.
**The bus** (`src/shell/playBus.ts`) is a ring of 64 preallocated records, never `emit()` (it allocates, `game.ts` 283-286). It is drained once a frame into
`collection.feedPlay(rec, nowMs)`.

### 9.4 Quests core and Journal state
`src/core/quests.ts`: `applyPlayEvent(state: JournalState, e: PlayEventRec, dayKey: number, out: JournalEffects): void`. It is pure, allocation-free
after warm-up, and has no clock or rng (`dayKey` is injected). It matches quests and keepsakes, derives facts F0 to F11, adds friendship points (with the 20 a
day pair cap), and writes effects (quest done, keepsake, fact, friend level, unlock, gift ready) into a reusable `JournalEffects` record. It imports only
`../data/quests.ts`, `../data/life.ts`, `../data/catalog.ts` and `./rng.ts`. `src/collection/journal.ts` holds sanitize, serialize, the two-tab merge and
backfill. `journal_store.ts` is cloned from `createHoardStore` (`store.ts` 498-600). Additions to the Collection interface (`types.ts` 354-409):
`journal?(): JournalView`, `feedPlay?(e: PlayEventRec, nowMs: number): void`, `claimGift?(chapter: number, pick: SpeciesId): Promise<ClaimResult>`,
`warmthOf?(itemId: string): number`, and `CollectionEvent` gains `quest`, `fact`, `keepsake`, `friend`, `unlock` and `gift`. The merge path in `index.ts`
carries warmth to the result.

### 9.5 Physics additions (`src/physics/**`; E numbers from the PHYS map; NOT built: E1 height field, E11 run-time detail swaps, E12 stiffness modifiers)
| # | addition | where | cost | risk and gate |
|---|---|---|---|---|
| P1 | E9 touch gate: LIFE drivers pause and ease out while fingers, grab, lock or carry | substep start :1849-1853 | ~0 | must not touch ceremony drivers (PH02) |
| P2 | E7 `setSquash` plus `hop` (glue and peel suspended for 10 substeps) | frameUpdate GB :2391-2397, table pass :2218, :2275 | ~0 | per-family height; putty memory (PH01) |
| P3 | E8 `lean`, `wiggle` | frameUpdate | ~0 | the righting torque (kUp 40) fights a rotation, so use shear (PH01) |
| P4 | E10 sleep: rest test (kinetic < 0.02, \|vc\| < 0.01 m/s, grounded, no driver or timer, 0.5 s), freeze, wake rules, sleeper pairs skipped in `collide` | step :863, collide :1331 | saves ~0.69 ms per resting body | hash rows change: opt-in (`allowSleep`), re-baseline (PH03) |
| P5 | E13 bump memory beyond 16 bodies (key slots by a compact per-session index) | :276, :1405 | ~0 | B2 rows (PH10) |
| P6 | E3 `setBounds`, `setHome` | matCorral :1600-1620 | ~0 | PH07 |
| P7 | E4 prop contact pass (sphere, capsule, box, plane; a bounding-sphere skip; touched prop particles join the fold-limit list) | between :2197 and :2217 | O(n) per near shape per substep; a far prop ~0 | creases at prop edges; props thinner than 0.07 m tunnel, so every prop is at least 0.08 m thick (PH06) |
| P8 | E5 `PropWorld` (`src/physics/props.ts`): ball, hinge, pendulum, spring, floater; per-frame integration of `propLoad`; speed clamps | new pure module | under 0.05 ms for 6 movers (est.) | one-frame lag (PH06) |
| P9 | E2 ground modifiers plus mutable `dragF` (ice needs drag, `:766`, `:2658`) | `this.p` fields through a Float64Array (the `settleDoubles` rule :224-230) | ~0 | PH05 |
| P10 | E6 water (whole-body buoyancy g x s / density, drag 2.5 1/s x s relative to the flow, supported gravity off, the slosh push enabled) and wind (whole-body acceleration x windShare) | predict loop :1929-1933 | ~0.01 ms per body in water (est.) | float / slosh interplay (PH04) |
| P11 | the grab and carry floor from LOCK.md 4, using the same ground and props | physics round 3 (queued) | ~0 | **a prerequisite**: props make "below the ground" common (PHYS map 7) |
| P12 | `_harness/probe_playground.ts` with `--quick` | harness | light quick run | none |

The ramps: on a tilted box the body is above y = 0, so supported gravity (`:1906-1916`) does not fade gravity and the body slides under gravity (PHYS map
open question 2 answered: on flat ground it stays put as today; on a ramp prop it slides). The glide up a ramp by itself is gate PH12, a stretch goal.

### 9.6 Render additions (`src/render/**`)
- **The place look:** `setPlace(id)` lazily imports `src/render/places/<id>.ts`, which returns a `PlaceLook` (the sky uniforms through a new `Table.setSky`,
  the ground mesh replacing the felt, 3 to 6 backdrop cards at renderOrder -99..-51, weather particles with a normal-blend option on `Particles`, env
  panels as data for `EnvHub.rebuild`, which must now dispose the old cube, the three lights as stage fields, the jelly `uKeyCol/uRimCol/uKeyDir/uRimDir`
  and `KEY_TINT` re-derived from the place key, `material.ts` 329-338 and 386-390). Home stays the default look in the stage chunk. Context loss rebuilds the
  place env in `onRestored` (`stage.ts` 615-625).
- **Props:** a `PropKit` per place chunk (shared geometries and MeshStandardMaterial plus `hub.apply`); static repeats as one `InstancedMesh` per kind; movers
  as plain meshes posed by `setPropPoses`. Opaque props render at orders 0..9, before the jellies. The water surface joins the jelly sort.
- **Body looks:** 6 eased float uniforms (`uWet`, `uSand`, `uFrost`, `uSnow`, `uToast` with `uHeatPos`, `uSoften`) in the existing program, cache key
  `wh-jelly-v4` to v5 (`material.ts` 500). Each needs a WH_LOW check. The gallery and the med / low colour identity must pass with every look at 0.
- **Faces:** a per-body gaze target (`face.ts` 259-275; the pointer wins on the touched body); expressions as eased channels: sleepy (openY 0.25 plus droop),
  surprised (wide plus a smaller `uIris`), shy (gaze down, lids lower, no blush), proud (gaze up, eye line lifted). Chunks express through emotes and motion
  only.
- **Emotes:** `EmoteBubbles`: one instanced, alpha-blended draw at renderOrder 40+, depthTest off, the 24 SDF icons in one fragment shader, a pool like
  `Particles` (zero allocation).
- **Marks:** a `GroundMarks` ring buffer of 64 / 48 / 24 quads by tier, 1 draw, the decal alpha trick (`decals.ts` 100-104).
- **Lighter pieces:** chunks use the low fine mesh (2562 verts) on med and high (today they keep 5762, RENDER map 8). That cuts piece triangles about 55%.
- **Camera in a place:** frames the play area, follows the party centroid at 0.6 weight with a 0.5 m dead zone and 1.5 s smoothing (no hunting). Orbit yaw
  is within +-60 degrees of the place front, zoom 0.8..1.4.
- **Ceremonies in a place:** the capsule lands on the place's pad (`setObstacles` keeps it clear of props). The reveal keeps today's "others slide off and
  hide", and the shell puts the party back afterwards (`game.ts` 381-386: `mat.clear()` becomes party stash and restore). Merges stay in the Hoard.

### 9.7 Audio additions (`src/audio/**`)
- **Two chain inputs**, `ambience` and `chatter`, created **after** `music` (the harness labels the first three `createGain()` calls, `engine_offline.js` 42;
  the 4th today is `bus`, `chain.ts` 52). Default output stays bit-identical.
- **`AmbienceBed`** (`src/audio/ambience.ts`): shaped like `MusicBed` (fade in 3 s, out 1.4 s, the pause fade). Recipes in lazy `src/audio/places/*.ts`.
  Cove: low-passed surf swells every 6 to 11 s plus a bubble fizz on each pull-back, and a band-passed sea wind. Peak: gusts at 600 to 2500 Hz, then near
  silence. Cabin: Poisson crackle at 3 to 12 per second plus a rare log settle and a slow creak. **No animal sounds** (no gulls, birds or crickets). The
  ambience never asks for room; it takes its own -6 dB dip when the room dip is active. It joins `freeAll` and `freeMusic` on pause and on mute. Two buffers at
  different playback rates hide the 2.5 s loop.
- **`creature.ts`:** section 5.3, 3 to 4 nodes per syllable (an oscillator with a cached PeriodicWave, an envelope, a formant, a panner only off-centre).
  A pure `ChatterLimiter` backstop (2 live, 3 starts per second; 1 and 1.5 in Calm), priority -1, its own rng.
- **`props.ts`:** ball (the bump body pitched up), creak (a strand-style stick-slip at 300 to 700 Hz, a held voice per prop id with a dead-man switch),
  chime and music box (the CHIME partials on D pentatonic; while the music box plays, the bed mutes its mallets), splash (bubbles plus a falling noise),
  crunch (Poisson micro-ticks), crackle, boing, thump. A sound the player causes may use `registerFx`; a prop moving by itself never does.
- **`musicClock()`** from the composer's field log against bar time. Optional per-place field weights through a `MusicStyle` argument. The default stays
  bit-identical. No retuning (the ceremony motifs and `REJOIN_RUN` are fixed, AUDIO map 2).

### 9.8 Save format and migration
New key **`wobblehoard:v2:journal`** (its own store; old builds never read it, so a rollback cannot eat it; the Hoard stays v2 untouched, no HOARD_VERSION
bump, CORE map 4):
```json
{ "v": 1, "bf": 1,
  "q": { "n1": 2, "c4": [1, 2], "c6": [1, 2, [3, 7]] },
  "ch": 3, "pl": 3,
  "sp": [4095, 6, 0],
  "fr": [[0, 10, 14], [3, 13, 9]],
  "ks": 7,
  "wi": [[3, 0, 1, 20412]],
  "wa": { "g-k2j9x0a1b2c3": 37 },
  "gi": [1], "gc": 1,
  "st": { "visits": 6, "photos": 2 } }
```
- `q`: a quest id maps to a state (0 open, 2 done) or `[state, count, distinct-set (at most 8)]`. `ch`: finales done (bits). `pl`: places open (bits). `sp`: 50
  fact masks (uint16). `fr`: at most 128 pairs `[lo, hi, points]`. `ks`: a 24-bit set. `wi`: at most 3 `[speciesIdx, wishKind, arg, sinceDay]`. `wa`: at most
  100 warmth entries, pruned on load to ids still on the shelf. `gi`: gifts waiting (chapter indexes). `gc`: gifts claimed (bits). `st`: small counters.
- Size: about 5 KB at full fill (the CORE map's estimate). **Hard cap 16 000 characters** (it parks whole under PARK_MAX_CHARS 20 000). Unreadable blobs are
  parked at `wobblehoard:v2:journal.unreadable`.
- **Migration:** a missing key creates v1. A future v2 uses `migrateVersioned` (`save.ts` 82-97) with a step table from day one. A blob newer than the build
  is used read-only in memory and never written (as `loadHoard` does).
- **Backfill** (once, `bf`): F0 for every owned species; n3 done if `ghostOpened > 0`, `ghostRestockDay !== null` or more than one ghost; n7 done if
  `ghostOpened > 0`. Returning players never redo the onboarding they already did.
- **Two tabs:** every field only grows, so the merge is a union or a max (quest state max, counts max, facts OR, friendship max per pair, keepsakes OR, warmth
  max, gifts claimed OR, waiting = finales done minus claimed, wishes = the newest 3 of the union).
- **Settings:** `chatter`, `ambience` and `autonomy` join `SETTING_KEYS` / `OPTIONAL_UNITS` / `OPTIONAL_BOOLS` (`settings.ts` 108-110). Migration is by
  absence; v stays 2.

### 9.9 Lazy loading
In the first load: `src/data/places.ts`, `life.ts` and `quests.ts` (all four places' data), `src/life/**`, `core/quests.ts`, the journal state, the
tracker pill, emotes, creature voices, the Nook props, the physics additions. Lazy chunks: `render/places/{cove,peak,cabin}.ts`,
`audio/places/{cove,peak,cabin}.ts`, `ui/journal/*.ts` (first open), `ui/travel.ts` (first open). Every lazy module imports `three` by the bare specifier, so
Rollup keeps three in the stage chunk (RENDER map 1). After an unlock, the next place prefetches with a low-priority `import()` in idle time. The G0 gate in
`vite.config.ts` must become **first load versus total** before any place chunk lands (D9).

## 10. Budgets and proof

### 10.1 Character caps: section 6 (units 3 / 4 / 5; wholes 3 / 4 / 5 with 2 / 3 / 4 awake; pieces 4 / 6 / 6; characters 6 / 8 / 10)

### 10.2 Frame budget (med, a mid phone at 60 fps = 16.7 ms; "ref" = the PHYS map's quiet container)
| subsystem | budget | how it is checked |
|---|---|---|
| physics, every body plus props and zones | **at most today's 4-body mat at the same tier** (ref 3.6 ms med) | PH09 ratio <= 1.0 |
| LIFE step, 10 characters | 0.30 ms ref | LI10 (node) |
| attention budget, bus, quests reducer | 0.10 ms ref per frame | SH02, QU03 |
| render CPU, scene update | ratio to Home with the same bodies <= 1.25 (props, bubbles, marks, weather) | RE06 |
| audio main thread | <= 0.6 ms average (music tick 0.031 ms, SOUND.md 640, plus at most 4 syllables a second) | AU07 |
| UI | <= 1 ms (UI.md 2.7) | UI bar |
| headroom | >= 3 ms | the 24 ms tier drop and the 30 ms refusal stay as they are |

### 10.3 Size budget (tightens D9)
| part | budget | estimate (not measured) |
|---|---|---|
| first load (entry, stage chunk, everything before play) | **<= 1280 KB** | 1139 today + about 110 (LIFE 20, data 18, quests and journal 18, shell host and attention 20, emotes and looks 14, creature voice 10, physics 12) |
| each place chunk (render plus audio plus prop kit) | <= 80 KB | about 40 + 10 + 20 |
| Journal chunk / Travel chunk | <= 40 KB / <= 12 KB | about 25 / 8 |
| whole build | **<= 1650 KB** | about 1250 + 3 x 70 + 33 |

### 10.4 Acceptance checklist (node probes first, browser second; each has an id a verifier can run)
**LIFE** (node: `_harness/probe_life.ts`, `probe_life_imports.ts`)
- **LI01** determinism: 8 characters in a 10-minute scripted world; the same seed gives the same hash of every `LifeOut` in 3 runs of 3, another seed differs.
  **LI02** zero allocation: a 0 B heap delta over 3600 steps after warm-up (the probe_cut method, :473-499).
- **LI03** touch override: with `held` set, no motion intent for that slot in the same step, and none for 0.25 s after release. **LI04** coverage: each of
  the 18 behaviours fires at least once in a scripted world; huff never fires in a session's first 60 s.
- **LI05** bounds: 100 000 sampled targets all fall inside walk circles and outside keep-outs. **LI06** imports: no three, physics, render, audio, ui,
  shell, DOM, timers, Date.now, Math.random or performance.now.
- **LI07** pieces: 6 pieces of one parent make at most 1 bubble request per 3 s, and 0 wishes or friendship deeds. **LI08** wishes: at most 1 per
  squishy, 2 on screen, 3 stored, at least 120 s apart; the scripted first wish appears 90 +- 5 s after the first greet.
- **LI09** Calm: every request rate is at or under the Calm column of 5.4. **LI10** cost: a step for 10 characters averages at most 0.30 ms here.

**Quests and Journal** (node: `probe_quests.ts`, `probe_journal.ts`)
- **QU01** every quest and keepsake rule is satisfiable with Commons only (a static walk over the rules, `SPECIES_LIFE` and `FAMILY_REACTIONS`). **QU02**
  every `EvKind` a rule uses has a named producer (a static table); no count is over 10.
- **QU03** `applyPlayEvent` is deterministic and allocation-free (0 B over 10 000 events). **QU04** a scripted regular-player event stream finishes
  chapter 1 within 6 simulated minutes and all four chapters within 150.
- **QU05** each place opens at its finale or at the 7 / 6 / 6 quest count, never earlier. **QU06** text gate: every title, hint, name, keepsake, caption
  and Journal line passes the deny, safety and pop-dome promise-word gates, moved into an exported `_harness/name_gate.ts` with byte-identical behaviour
  in `probe_catalog.ts` (CORE map 6).
- **QU07** `SPECIES_LIFE`: 50 rows; friends symmetric, cross-lane, never self; 11..13 fans per place with at least 3 Common fans; every thing has a fan;
  every family spans at least 2 places.
- **CO01** a journal filled to every cap serialises under 16 000 characters. **CO02** the two-tab merge is a union or max for every field, and merging a
  blob with itself is the identity. **CO03** an unreadable blob is parked whole and replaced; a newer one is read-only.
- **CO04** no journal operation touches the Hoard key or its bytes; `probe_collection_imports` I01 to I07 still pass. **CO05** backfill marks F0, n3 and
  n7 from an existing shelf exactly once. **CO06** a merge result gets the larger warmth of its parents.
- **CO07** `claimGift` takes only listed species, once per chapter, with origin `'restock'`; at the shelf cap it refuses and the gift keeps waiting.

**Economy** (node; the full sim is one heavy job, run once)
- **EC01** the probe_economy pace rows (3.0 to 3.8 active minutes a capsule) pass unchanged. **EC02** the real shell (node rig) with the LIFE host, 4
  mock bodies hopping and the real collection: 30 simulated minutes with no player input give exactly 0 SP, 0 task progress and 0 capsules.
- **EC03** gifts for life at most 4; quest capsules 0; SP grants 0 (core/quests.ts has no meter import). **EC04** `sim_economy.ts` with 4 gift picks
  on days 1, 2, 4 and 7 for regular players: re-quote section C (unchanged by construction) and section K (all 50 moves by less than 1 day).

**Physics** (node: `probe_playground.ts`, `--quick` available)
- **PH01** hops over 12 families x (template, soft-corner) genomes plus detail-2 pieces: height <= 3.6 cm, no `land` event, no fold over 120 degrees, no
  second hop, a putty dent back under 0.01 R within 40 s. **PH02** a finger down cancels squash, hop, lean, wiggle and the LIFE `moveTo` within 1 frame;
  ceremony drivers are unaffected.
- **PH03** sleep: rests after 0.5 s; wakes on a finger, a nudge, a contact from an awake body or a prop; a sleeper costs <= 0.05 ms; reset is
  bit-identical. **PH04** water: float lines by density within +-0.03 m for R 0.5; a soaked slow-rise sinks within 30 s; no NaN over 10 minutes; the
  water hop leaves the basin.
- **PH05** ice glide distances rank in `iceMu` order (Spearman >= 0.8 over 12 families). **PH06** the Tilt Board, Swing Basket, Bouncy Bough, Rocking
  Seat, Drift Raft and three balls stay stable for 10 minutes with 3 bodies on them, under their speed clamps; nothing tunnels a 0.08 m prop at 6 m/s.
- **PH07** bounds hold for 200 random 6 m/s tosses. **PH08** zero allocation per step with 12 props and 4 zones. **PH09** the section-6 med worst case
  against today's 4-body mat: ratio <= 1.0 (best of 5). **PH10** bump events stay right past 40 bodies made in one session.
- **PH11** the grab and carry floor: a lone finger dragged 1 m below the ground folds no species past 120 degrees (LOCK.md 4). **PH12** (stretch goal) a
  LIFE glide up each ramp reaches the top within 6 s for every family, or LIFE never tries it.

**Audio** (offline harness: `life_checks.mjs`)
- **AU01** with chatter running, the music stem's pumping is unchanged (std <= 3 dB, back within 1 dB in <= 8 s). **AU02** a poke over chatter stands
  >= 8 dB in-band and >= 10 LU K-weighted above it. **AU03** every creature note is on D pentatonic within +-10 cents.
- **AU04** storm: 10 squishies and 30 pieces asking for 50 syllables a second give at most 2 live groups and a peak of at most one voice + 3 dB. **AU05**
  pause and mute free every ambience and chatter node within 0.2 s. **AU06** every existing seeded render stays bit-exact.
- **AU07** at most 4 nodes per syllable and 0.15 ms of main thread per trigger. **AU08** Calm chatter is at least 2.5 dB softer, with no trills.

**Render** (browser: `browser_render.mjs`, new sections `place`, `props`, `emote`, `marks`, plus reruns of `sky`, `cer`, `chains`, `perf`, `gallery`)
- **RE01** each place: sky seams at 4 aspects x 3 pitches, no blank frame, no console problem. **RE02** body colour identity per place against Home within
  the med / low bar (median 9.1, p90 15.8, max 20.6 /255, RENDER map 3) with looks at 0.
- **RE03** flash gate per place: `cer`, `chains` and 10 rapid cuts give at most 2 flashes in any 1 s. **RE04** bubbles: 1 draw; cream on plum >= 4.5:1;
  the bubble edge >= 3:1 on every place's sky pixels; never inside the HUD insets.
- **RE05** the 50-species gallery is unchanged with looks at 0 (closest pair >= 13.14 /255). **RE06** frame ratio per place (med, 4 bodies, 6 props, 3
  bubbles) against Home with 4 bodies <= 1.25. **RE07** context loss in each place restores sky, ground, props and env.
- **RE08** leaving a place returns programs and textures to Home's counts. **RE09** Calm: no bubble scale, particles x0.3; reduced motion: no weather.

**Shell and UI** (node checks, then `browser_shell.mjs`)
- **SH01** the LIFE host runs after `drain()` and before `bodies.step`, 0 B per frame over 600 frames. **SH02** the PlayEvent bus allocates nothing; 64
  events in one frame all arrive in order. **SH03** Travel keeps the party, reconnects a cut, releases locks, waits out a ceremony, announces arrival.
- **SH04** party plus pieces respect the units table at each tier; an overflowing cut sleeps one whole first, then refuses kindly. **SH05** after a
  capsule reveal in a place the party is back on its spots within 0.5 s. **SH06** a tier drop sleeps, then shelves, with the kind line.
- **SH07** keys J and P and the Escape order; focus returns to the opener. **SH08** Snap hides the pill, the column and the captions; bubbles only with
  the switch on. **SH09** the new settings migrate by absence and drive the chain gains. **SH10** autonomy off: 0 motion intents, gaze and reactions stay.
- **UI01** at 390 x 844 and 320 x 568 the pill, column, captions, capsule, meter and name tag never overlap (bounding boxes). **UI02** new text >= 4.5:1,
  UI parts >= 3:1 on real pixels. **UI03** every new target >= 44 px. **UI04** a keyboard walk of the Journal and Travel with names on every control.
  **UI05** copy: titles of at most 8 words, hints of at most 14, no "!!", no guilt words, one live region.

**Size** (build): **SZ01** first load <= 1280 KB; **SZ02** each place chunk <= 80 KB; **SZ03** total <= 1650 KB; **SZ04** no place module in the first-load
graph. **Cross-lane** (browser, last): **X01** a fresh profile plays chapter 1 in the real shell through the dev hook, deterministically, travels to the
Cove and finishes c1 to c3, with a screenshot at each quest.

## 11. What to cut, and the build order

### 11.1 Slices
| slice | contents | playable result |
|---|---|---|
| **S1a, foundations at Home** (milestone, can ship alone) | LIFE (all 18 behaviours, pieces), attention budget, emotes, voices, the gaze and expressions, hop, lean, wiggle, the touch gate, sleep, the Journal core plus chapter 1, the Music Box and Bumper Ball, the tracker, the Journal sheet, the moments, the settings | the Nook comes alive: social squishies, a purpose from minute 0, chapter 1 in about 5 minutes |
| **S1, the first release** (S1a plus the Cove) | the place system (render, audio, physics props and zones), Sunfizz Cove fully, water, sand, the Travel sheet, chapter 2, gifts, keepsakes, facts F0 to F4 and F7 to F11 | the owner's asks 1 to 5 are visibly true in one new place |
| S2 | Hushpeak: ice, wind, the Sled Hill, Bouncy Bough, Snowball, Glow Lamp, snow prints, chapter 3, F5 | |
| S3 | Hearthpine Cabin: Hearth, toast, Rocking Seat, Swing Basket, Yarn Ball, Wool Rug, chapter 4, F6, the keepsake shelf at Home | |
| later | autonomous ramp climbing (PH12); per-place music styles; trading hooks (7.14) | |

**Cut first if time runs short** (in this order): the Tilt Board, the Drift Raft, wind, the keepsake shelf, mirror dance, quirks, the per-place music
style. **Never cut:** the attention budget, the zero-SP rule and its probe, the touch override, sleep, the Calm caps, the text gate.

### 11.2 Build order and dependencies (one heavy job per agent)
| step | lane | work | depends on |
|---|---|---|---|
| 0 | all | SHELL-4 finished and verified; physics round 3 (the ground and carry floor, P11) | in progress / queued (STATUS) |
| 1 | synthesizer | the contract members of 9.1, a clean tsc | the specs |
| 2 | WORLD data | `places.ts` (4 places), `life.ts` (families, 50 rows), `quests.ts` (37 quests, 24 keepsakes); `name_gate.ts`, QU06, QU07 | 1 |
| 3 | CORE | `core/quests.ts` reducer, facts, friendship; QU01 to QU05 | 2 |
| 4 | COLLECTION | `journal.ts`, `journal_store.ts`, `ghostGrantGift`, the interface members; CO01 to CO07 | 3 |
| 5 | LIFE | `src/life/**` against a mock world; LI01 to LI10 | 2 (parallel with 3 and 4) |
| 6 | PHYS-A | P1 to P6; PH01 to PH03, PH07, PH10 | 0, 1 |
| 7 | AUDIO-A | chain inputs, `creature.ts`, the limiter, `musicClock`, the music box and ball voices; AU01 to AU04, AU06 to AU08 | 1 |
| 8 | RENDER-A | emotes, gaze, expressions, the Nook props, the pose seam, low-mesh chunks; RE04, RE05, RE09 | 1 |
| 9 | PHYS-B | P7, P8 (props, PropWorld); PH06, PH08, PH09 | 6 |
| 10 | SHELL-A, UI | the LIFE host, bus, attention, party plus pieces, Journal sheet, tracker, moments, settings; SH01, SH02, SH04, SH06 to SH10, UI01 to UI05; **milestone S1a** | 4, 5, 6, 7, 8, 9; the UI overhaul tokens if landed |
| 11 | ECON | EC01 to EC03; then EC04 (heavy, once) | 4, 10 |
| 12 | PHYS-C | P9, P10 (ground, water, wind); PH04, PH05 | 9 |
| 13 | RENDER-B | the place look system, the Cove look, body looks, marks, the place camera; RE01 to RE03, RE06 to RE08 | 8, the D9 size gate change |
| 14 | AUDIO-B | `AmbienceBed`, the Cove recipe, splash, crunch, chimes; AU05 | 7 |
| 15 | SHELL-B | the place manager, Travel, lazy loading and prefetch, the Cove things, chapter 2 wiring; SH03, SH05, SZ01 to SZ04, X01; **release S1** | 10, 12, 13, 14 |
| 16 | VERIFY | independent verifiers per lane (physics, render, audio, shell and UI, economy), then the owner's preview | 15 |
| 17 | S2, S3 | repeat steps 12 to 16 per place; the data already exists from step 2 | 16 |

The queued work stays (DIRECTION 2): the UI overhaul goes first (the new screens are built on its tokens), LOCK and multi-pull (LIFE reads
`metrics.fingers > 0`, so five fingers work as they are), Stamp and Roll, trading, and the ffgames portal.

## 12. Where I disagree (and still design within the decision)

1. **D2's example list includes a heart.** I left it out. "Heart" is already the player-facing name of the protection mark (DESIGN 5.6), and a heart bubble
   over a squishy would read as "this one is hearted". Affection is `snug` (two blobs touching). Every other D2 icon is in the set.
2. **D7 allows lighter background bodies.** I do not swap the mesh detail of a visible body at run time in this feature. The swap rebuilds the body upright,
   loses its dents, allocates, and causes a known luminance tick (PHYS map 4, RENDER map 9). Sleep alone keeps every tier at or under today's physics cost
   (section 6). Detail 2 stays for small pieces, as today. If the frame budget is missed on a real phone, the first remedy is to lower the awake cap, not to
   swap meshes.
3. **D8 allows bounded capsule and SP rewards.** I use none. Four chosen gift squishies are the Journal's only economy touch. A quest that pays a capsule
   teaches "do chores for loot"; a quest that opens a place, a page or a friendship teaches "look closer". The pace proof is then by construction, not by
   simulation.
4. **D5 says place code loads when the place is first opened.** I also prefetch the next place's chunk in idle time once it unlocks, so the first trip has no
   wait. It is still lazy: nothing loads before the unlock.
