# CRESTBOUND — Course Design Briefs (12 courses after BAILEY MEADOW)

Every course is an SM64-scale open diorama (100–140 m across, 35–60 m of verticality),
with MULTIPLE routes to the main crest, a secret, a set-piece, ≥ 4 checkpoints placed
BEFORE difficulty spikes, 7 crests (open · sigils · coins · secret · boss-or-timed ·
race · power/extra), 8 sigils on optional lines, ≥ 100 coins (place ~112), and
≥ 6 hazard/critter FAMILIES remixed (never 40 of one thing). Every landable jump
target has `stripe:true`. Required paths respect the single-jump-safe envelope unless the
approach provides the run-up (then long/triple, stated in a comment). All hazards are
functions of the course clock. Coordinates: yaw 0 faces −Z; p = CENTRE, s = FULL size.

Difficulty ramp (1–10): verdant-1 (1) → verdant-2 (2) → verdant-3 (3) → ember-1 (4) →
ember-2 (5) → ember-3 (6) → ember-4 (6) → rime-1 (5) → rime-2 (6) → rime-3 (7) →
azure-1 (7) → azure-2 (8) → azure-3 (10).

---
## verdant-2 — GNASHER FORT  (difficulty 2, gate 1 crest)
A ruined hill-fort of three concentric walls climbing a knoll, teaching precision +
moving geometry. Terrain: a single big knoll (r 45, h 22) with terraces (flats) at 0 / 7 /
14 / 21 m and a moat (water) around the base.
- Beats: (1) moat causeway with two `sinker` stones; (2) outer wall — climb via `net`,
  walk the rampart, three `mover` (linear) carts on rails across a breach; (3) middle wall —
  `rotor` bars (2 arms, slow) on the walkway, `vanish` flagstones over the courtyard, a
  `breakable` portcullis (pound) → inner court; (4) inner keep tower with a `mill` lift
  and a wall-kick shaft (3.2 m) to the roof; (5) the roof: open crest on the flagpole plinth.
- Critters: 2 gnashers on chains flanking the main gate (post-pound frees one → secret
  cage crest under the stairs), 4 bumblers on the terraces, 2 skitters over the moat.
- Crests: open (roof) · sigils (8 around the three ramparts + one in the moat floor) ·
  coins · secret (freed gnasher cage) · race (portcullis → roof in 50 s) · boss (Warden
  in the inner court after the portcullis) · power: 'metal' hat sinks you to walk the
  moat floor for a sunken crest (metal + current).
- Checkpoints: causeway, outer breach, inner court, tower base.
- Families: sinker, mover, rotor, vanish, breakable, mill, net, water, current, jumppad.
- Set-piece: the roof flagpole ride — a `pendulum`-free finale: three `mover` orbit
  platforms circling the tower you hop between while the mill arms sweep.

## verdant-3 — WINDMILL HEIGHTS  (difficulty 3, gate 3 crests)
A stepped valley of terraced farms rising to a ridge of five windmills. Terrain: ridge
(a→b) with 4 flats; a river (water, `current` downstream) cutting the valley; wheat
fields (grass colour override) and stone terraces (stairs).
- Beats: (1) river hop across `sinker` logs riding the current; (2) terrace stairs with
  `conveyor` hay belts you must run against; (3) the first mill: `mill` (4 arms) — ride a
  blade up to the granary roof; (4) the ridge path: `pendulum` sacks between mills,
  `rotor` (windmill-style 3-arm) gates; (5) the fifth mill is huge (6 arms, period 9 s) —
  its blades carry you to the sky platform with the open crest.
- Critters: bumblers on the terraces, skitters around mills, a gnasher guarding the granary.
- Crests: open (sky platform) · sigils (on 8 mill roofs/terraces/river bed) · coins ·
  secret (a `breakable` granary floor → cellar crest) · race (valley floor → 5th mill top
  in 65 s; teaches long jumps: place 3 long-jump gaps ≥ 6 m runup) · timed (a `vanish`
  staircase that appears for 20 s after pounding a bell — crest at its top) · power 'wing'
  from a nest on mill 3 + `rings` (10) around the ridge → crest.
- Checkpoints: river bank, granary, ridge path midpoint, 5th mill base.
- Families: sinker, current, conveyor, mill, pendulum, rotor, vanish, breakable, rings, jumppad.
- Set-piece: the 6-arm mill ride — the arms pass a hanging coin arc; jump at the top.

## ember-1 — MAGMA WORKS  (difficulty 4, gate 5 crests)
A foundry cavern: a lava lake with iron catwalks, sinking slag platforms, a great crucible.
No terrain (cavern floor is lava/obsidian platforms); sky 'furnace'; heat shimmer.
- Beats: (1) obsidian shore with `lava` pops → catwalk (grate) with `flame` vents on a
  cycle; (2) the sinking platform field: 9 `sinker` slag rafts (delay 0.6 s) across the
  lake; (3) the smelter: `conveyor` belts feeding a `crusher` hopper (jump the ingots);
  (4) the crucible tower: spiral catwalk with `rotor` chains, a wall-kick chimney (3 m),
  `mover` buckets on a chain (orbit) to the crown; (5) the crown: open crest on the crane hook.
- Critters: bumblers in iron helmets (heat-proof), skitters (fire flies), Warden in the
  slag pit.
- Crests: open · sigils (8: rafts, belts, chimney, under the crane) · coins · secret
  (a `breakable` slag crust → cool cave with the crest) · boss (Warden, slag-pit arena,
  lava ring — the charge into the arena wall) · race (shore → crown in 60 s) ·
  power 'metal' (walk the lava floor for 20 s to a crest at the lake centre — metal
  hat makes lava non-lethal: implement as player.power==='metal' ignoring kind 'lava').
- Checkpoints: shore, raft field end, smelter, crucible base.
- Families: lava, flame, sinker, conveyor, crusher, rotor, mover, wallkick shaft, jumppad, beam.
- Set-piece: the crucible tips on a 30 s cycle (a huge `mover` rotate) pouring a lava
  curtain across the catwalk — time the crossing.

## ember-2 — PISTON HALLS  (difficulty 5, gate 8 crests)
An industrial gauntlet of pistons, crushers and conveyors inside the foundry's engine.
Linear-ish but with three parallel decks (upper maintenance gantry, mid piston hall,
lower coolant channel with water + current).
- Beats: (1) the piston hall: 12 `crusher` pistons in staggered phases (3 groups of 4 with
  different periods) — read the rhythm; (2) the conveyor sorter: `conveyor` belts crossing
  with `breakable` crates and `speedpad` launches over gaps; (3) the gantry: `beam` pulse
  lasers between pylons, `vanish` grates, a `seesaw` walkway; (4) the coolant channel:
  swim tunnels with `current` and `bubbles`, air pockets; (5) the engine core: a
  `rotor` 4-arm flywheel you cross to the open crest.
- Critters: skitters, bumblers on belts, a gnasher chained in the sorter.
- Crests: open (core) · sigils (8: pistons tops, belts, channel floor, gantry) · coins ·
  secret (a `breakable` wall behind piston 7 → hidden lift crest) · timed (a `cannon`
  shot to a floating grate that vanishes after 25 s) · race (hall → core in 55 s) ·
  boss (Warden on the flywheel deck).
- Checkpoints: hall start, sorter end, gantry, channel exit.
- Families: crusher, conveyor, breakable, speedpad, beam, vanish, seesaw, water, current, rotor, cannon.
- Set-piece: the flywheel — 4 arms, period 6 s, carrying platforms that rise and fall.

## ember-3 — CINDER CHASE  (difficulty 6, gate 12 crests)
A vertical volcano shaft: rising lava (`chase` axis y) drives a climb up rotating rings,
with a cannon to the summit. The course has a calm outer rim (no chase) and the shaft.
- Beats: (1) rim: lava pools, `jumppad` geysers, a cannon that fires you into the shaft
  entrance; (2) the shaft climb (chase lava rises 1.0 m/s after a 6 s delay): `rotor`
  rings (bars), `mover` elevator plates, wall-kick chimneys (two, 3.2 m), `vanish`
  ledges, `flame` jets; (3) the summit crater: open crest on the caldera lip.
- Critters: skitters in the shaft, bumblers on the rim, a Warden in the crater.
- Crests: open · sigils (8: rim pools + shaft ledges) · coins · secret (a side cave in
  the shaft reachable by a long jump from elevator 2 — `breakable` crust inside) · boss ·
  race (rim → summit before the lava in a fixed 70 s, timer via race pads) · power
  'wing' at the summit + `rings` (12) spiralling down the outside of the volcano → crest.
- Checkpoints: rim, shaft entrance (chase resets on respawn — resetFrom rewinds the
  clock), shaft midpoint (clockOffset so the lava is fair), summit.
- Families: lava, risinglava/chase, jumppad, cannon, rotor, mover, vanish, flame, rings.
- Set-piece: the chase — the lava's glow lights the shaft from below as it rises.

## ember-4 — SUNSCAR NECROPOLIS  (difficulty 6, gate 15 crests)
A desert of dunes around a pyramid, with quicksand pools, sandboard slides, a buried
tomb, and a cannon between the pylons. Terrain: dunes (noise amp 3, freq 0.05) + the
pyramid as a `building` style 'temple' (stepped, four faces of stairs) + a sunken
plaza (flat) with `quicksand`. Sky 'sunset', sand dust ambient.
- Beats: (1) dunes with `quicksand` pools and coin arcs; (2) the pylons: a `cannon`
  shot onto the pyramid's second tier; (3) the pyramid faces: `stairs` + `sandboard`
  slides down the other faces (fast, low friction, a speed floor); (4) the tomb (interior
  building): `crusher` sarcophagus lids, `beam` tripwires, `vanish` floor glyphs, a
  `rotor` scarab wheel; (5) the apex: open crest on the capstone.
- Critters: bumblers (mummified), skitters (scarabs), a gnasher at the tomb door.
- Crests: open (apex) · sigils (8: 4 on the pyramid tiers, 2 in the tomb, 2 in quicksand
  pools — pound the pool's centre stone to drain it: `breakable` under quicksand) ·
  coins · secret (the tomb's deepest room behind a `breakable` glyph wall) · race (a
  sandboard slalom from the apex down to the plaza through 8 `rings` in 40 s — rings
  count as gates) · timed (a sun-dial `vanish` bridge that appears for 30 s after
  pounding the dial) · boss (Warden in the plaza arena).
- Checkpoints: dunes, pylons, tomb entrance, pyramid tier 3.
- Families: quicksand, cannon, stairs, sandboard, crusher, beam, vanish, rotor, breakable, rings.
- Set-piece: the sandboard descent under the setting sun with dust trails.

## rime-1 — FROST COTTAGE  (difficulty 5, gate 18 crests)
A snowed-in alpine village on a slope, teaching slope slides + ice. Terrain: a long
hillside (ridge a→b, 25 m rise) with flats for the cottages; a frozen lake (ice surface
over water — implement as an `ice` platform above a water volume with a `breakable`
ice hole); snowdrifts, pines (climbable), fog dense, sky 'aurora' at dusk.
- Beats: (1) the frozen lake (ice: drift, learn stopping); (2) the village: rooftop
  hopping (cottage buildings, stripe roofs), `pendulum` bells in the chapel, a `mover`
  sleigh lift; (3) the hillside: steep `ramp` sections > slideDeg — you slide, and must
  jump to a ledge (teach slope recovery), `snowdrift` decor that hides `sinker` snow
  pads; (4) the summit chapel: open crest in the belfry (wall-kick up the bell tower).
- Critters: bumblers in scarves, skitters (snow owls), a gnasher at the barn.
- Crests: open · sigils (8: rooftops, lake bottom (dive through the ice hole), pine tops,
  belfry) · coins · secret (the barn loft behind a `breakable` hay wall) · race (lake →
  belfry in 60 s) · timed (a `vanish` ice bridge over the gorge that exists for 20 s after
  ringing the chapel bell (pound)) · power 'vanish' (walk through the ice wall to a
  frozen cave crest — implement as player.power==='vanish' ignoring colliders in group
  'ghostwall').
- Checkpoints: lake shore, village square, hillside ledge, chapel.
- Families: ice, ramp/slope, pendulum, mover, sinker, breakable, vanish, water, tree(climb), jumppad.
- Set-piece: the hillside slide — a 40 m slope you can ride on purpose (slide state) with
  gates of coins, ending in a ramp jump onto the chapel roof.

## rime-2 — GLACIER SLIDE  (difficulty 6, gate 22 crests)
A mountain of ice with a great luge chute (the slide race) and a crystal cavern. The
chute is a sequence of `ramp`/`sandboard`-type slope pieces (surface 'ice') with banked
turns (rotated ramps), gaps, and coin lines; the rest of the course is a climb back up.
- Beats: (1) the summit start of the chute; (2) THE SLIDE: 180 m of ice chute with 6
  banked turns, 3 gaps (jump from the slide), a `rotor` ice-wheel, `iceShard` bursts;
  ends in the frozen lake; (3) the climb: `mover` ice blocks, `pendulum` icicles,
  `vanish` snow bridges, a crystal cavern with `beam` refracted lights, wall-kick crevasse;
  (4) the peak: open crest.
- Critters: skitters, bumblers (penguins in spirit — but original: "waddlers"), a Warden
  (yeti-like armour) in the cavern.
- Crests: open (peak) · sigils (8 along the slide's risky lines + cavern) · coins · secret
  (a hidden branch of the slide behind a `breakable` ice wall → a second chute to the
  crest) · race (the slide: summit → lake in 45 s) · boss (Warden) · timed (crystal cave
  `vanish` platforms after a pound on the crystal).
- Checkpoints: summit, slide midpoint (a flat), lake, cavern.
- Families: ice slide, ramp, rotor, mover, pendulum, vanish, beam, breakable, water, jumppad.
- Set-piece: the slide itself — camera pulled back, speed lines, aurora overhead.

## rime-3 — BLIZZARD PEAK  (difficulty 7, gate 26 crests)
The tallest mountain: a spiral ascent through blizzard wind, with pendulums, mills
(snow-driven), crushers of ice, and a wind-torn rope bridge. Terrain: a cone mountain
(hill r 60, h 50) with a spiral path carved as flats; `wind` volumes across exposed
ledges; fog thick; snow heavy; sky 'aurora' night.
- Beats: (1) the base camp; (2) the spiral: `wind` pushes across ledges (lean in),
  `pendulum` logs, `mill` snow wheels; (3) the rope `bridge` (sagging, planks missing —
  gaps 3–4 m), `vanish` ice patches; (4) the crusher cave (ice `crusher` + `beam`);
  (5) the peak shrine: open crest inside a ring of `rotor` prayer wheels; a Warden
  guards the shrine gate.
- Critters: skitters (storm birds), bumblers, gnasher at the cave, Warden.
- Crests: open · sigils (8: spiral ledges, bridge, cave, under the shrine) · coins ·
  secret (an ice cave behind the waterfall (frozen) — `breakable`) · boss · race (base →
  peak in 90 s) · power 'wing' at the peak + `rings` (14) descending the mountain through
  the blizzard → crest at base camp.
- Checkpoints: base camp, spiral 1/3, bridge end, cave exit, shrine.
- Families: wind, pendulum, mill, bridge, vanish, crusher, beam, rotor, rings, ice.
- Set-piece: the rope bridge in the wind — planks swing (mover oscillate) as gusts pulse.

## azure-1 — TIDEWELL TEMPLE  (difficulty 7, gate 30 crests)
A flooded sea-temple on a sunlit lagoon: swim tunnels, currents, a rising tide, and a
sanctum reached by draining pools. Terrain: a lagoon floor (sand) with a temple
`building` style 'temple' half-submerged; water volume covers the lagoon (surface y 0);
sky 'sanctum' noon; caustics.
- Beats: (1) the lagoon: swim, `current` streams between reefs, air pockets, `bubbles`;
  (2) the outer temple: `mover` tide gates, `beam` light tripwires under water (non-lethal
  when submerged? NO — lethal: readable), `sinker` lily platforms; (3) the tide switch:
  pound a pedestal → the lagoon water volume LOWERS 4 m over 10 s (a `mover`-driven water
  volume: implement as the water def's surfaceY animated by a trigger; hazards/fluids
  'tide' behaviour) revealing the inner court; (4) the inner court: `rotor` water wheels,
  `vanish` stepping stones, a swim tunnel maze with `current`; (5) the sanctum: open crest.
- Critters: skitters (gulls), bumblers (crabs — original "clickers"), a gnasher (eel-ish)
  chained in the tunnel maze, Warden in the drained court.
- Crests: open · sigils (8: 4 underwater, 4 on the temple) · coins (many underwater rings)
  · secret (a chest behind a `breakable` coral wall, needs the 'metal' hat to sink to it)
  · boss · race (the swim gauntlet through 10 `rings` underwater in 60 s) · timed (the
  tide: reach the sanctum before the tide refills in 90 s).
- Checkpoints: lagoon shore, outer temple, tide switch, inner court.
- Families: water, current, mover, beam, sinker, rotor, vanish, breakable, rings, tide.
- Set-piece: the drain — water pouring off the steps, revealing the court.

## azure-2 — GEARHEART TOWER  (difficulty 8, gate 35 crests)
A clockwork tower whose rooms ROTATE: climb inside a mechanism of gears, seesaws,
pendulum escapements and timed beams. No terrain; the tower is stacked `building`
'tower' rings with `rotor` floors (whole-room rotation: implement as a `rotor` with
style 'room' — a wide disc with walls as arms) and `mover` rotate platforms.
- Beats: (1) the gear yard (outside): `rotor` cogs you ride, `conveyor` chains;
  (2) the rotating rooms: 4 floors, each a `rotor` room turning at a different period,
  doors only line up on a beat; (3) the escapement: `pendulum` pallets and `crusher`
  hammers on the tick; (4) the bell chamber: `seesaw` beams and `beam` tripwires
  between the gears; (5) the clock face (outside, top): open crest on the hour hand's
  tip (the hand is a slow `rotor`).
- Critters: skitters (clockwork moths), bumblers (wind-up), gnasher (spring-loaded), Warden
  on the bell deck.
- Crests: open · sigils (8: cog tops, room corners, escapement, face numerals) · coins ·
  secret (the pendulum well below the tower, `breakable` grate) · boss · race (yard →
  face in 80 s) · timed (pound the master gear → the tower speeds up ×2 for 30 s and a
  door to the crest vault lines up).
- Checkpoints: yard, room 2, escapement, bell chamber.
- Families: rotor(room), conveyor, mover, pendulum, crusher, seesaw, beam, breakable, vanish, cannon(one).
- Set-piece: the tower speed-up — everything ticks twice as fast.

## azure-3 — PRISM RIDE  (difficulty 10, gate 40 crests, FINALE gauntlet)
Sky rails and rainbow roads above the clouds: the finale combining ≥ 4 families per
segment. Floating islands (flats on a high heightfield? no — pure platforms), `rings`
wing sections, `current` air streams, a `cannon` between island clusters, `mover`
sky-rail carts on long orbit/linear paths, `vanish` rainbow tiles, `pendulum`
prisms, `beam` light bridges (walkable when ON, absent when OFF — walkable `vanish`
variant), and a final gauntlet over the void.
- Beats: (1) the rail station: `mover` carts across the void (long linear, period 14 s);
  (2) the prism gardens: `pendulum` prisms + `vanish` rainbow tiles + `beam` bridges;
  (3) the wing run: pick up 'wing' → 16 `rings` through `current` streams (missing three
  rings drops you to a cloud shelf — fair); (4) the cannon isles: `cannon` shots between
  three islands with `rotor` spokes; (5) THE GAUNTLET: a 90 m rainbow road with crushers
  (prism hammers), rotors, vanish tiles, wind, movers and a rising cloud (`chase`) —
  ends at the Grand Pedestal: open crest.
- Critters: skitters (prism birds), bumblers, gnasher on a cloud, the final Warden (2×
  hp = 5? No: keep 3 hits but faster telegraphs: def.tempo 1.4).
- Crests: open (grand pedestal) · sigils (8 along the risky lines) · coins · secret (a
  hidden island under the station reached by a long jump + dive) · boss · race (station →
  pedestal in 120 s) · power 'wing' rings crest.
- Checkpoints: station, gardens end, wing landing, cannon isle 3, gauntlet midpoint.
- Families: mover, pendulum, vanish, beam, rings, current, cannon, rotor, crusher, wind, chase.
- Set-piece: the gauntlet under the rainbow arc with the sanctum sky.

---
## Keep secrets (already in keep.js): basement grate (pound), secret slide (10 crests),
balcony long-jump arc, courtyard wall-kick tower, Old Fen's six lines, finale gate (60).

## Powers (implement in controller/game): 'wing' — after a jump3 or from a wing pickup,
holding jump enters `fly` (gentle glide, pitch by stick, 30 s, `rings` refresh 5 s); 'metal'
— heavy, sinks in water, lava non-lethal, 20 s; 'vanish' — pass 'ghostwall' colliders, 20 s.
