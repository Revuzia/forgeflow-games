# DEWPOINT level reference

Everything a level author needs: the data format, every piece type with every field, the
numbers Mote's movement gives you to design with, and how to prove a level solvable.

The loader (`src/sim/level.js`) validates all of this and throws an error naming the level,
the piece index and the field, so a typo fails at load time (and in `node tests/run.js`).

Contents: 1 Conventions - 2 Level object - 3 Signals - 4 Pieces - 5 Design numbers -
6 Rules of thumb and gotchas - 7 Adding a level - 8 Proving a level solvable - 9 Previewing in the browser -
**10 Fire levels (Cinder): pieces, numbers, gotchas, scripting**

Sections 1-9 describe the Water campaign (Mote) and everything the elements share: the level
object, signals, the shared pieces, how to prove and preview a level. A level belongs to exactly
one element (`element: 'water' | 'fire'`, default water). Section 10 is everything that is
different for Fire; a Fire level author needs sections 1-4a, 7-9 and 10.

---

## 1. Conventions

- Units are metres and seconds. **Y is up.** X and Z are the floor plane.
- Volumes are `box: [x0, y0, z0, x1, y1, z1]` - two opposite corners, in either order.
- Points are `pos: [x, y, z]`. For things that stand on a floor, `y` is the floor's top.
- Mote's position is its **feet** (bottom centre). Its collider is an upright cylinder.
- Directions are strings: `'+x' '-x' '+y' '-y' '+z' '-z'`.
- The three shipped levels run along **+X** with `camYaw: -90`. Do the same unless you have a reason.
- The simulation is deterministic and runs at a fixed 120 Hz. Nothing in a level may depend on frame rate.
- Solids must be at least **0.1 m** thick on every axis (the loader rejects thinner ones; that is the
  thickness the collision code guarantees against tunnelling).

## 2. The level object

One file per level in `src/levels/`, default-exporting a plain object:

```js
export default {
  id: 'l04',                    // required. 'lNN' (water) or 'fNN' (fire), unique, matches the file name and play order
  element: 'water',             // 'water' (default; the published water levels leave it out) or 'fire' (section 10)
  name: 'Kiln Draught',         // required. <= 24 characters (HUD and level card)
  chapter: 2,                   // 1-based; must exist in `chapters` in src/levels/index.js. Default 1
  theme: 'loft',                // look: 'slip' | 'loft' | 'kiln'. Default 'slip' (see below)
  spawn: [0, 0, 0],             // required. Mote's feet at the start
  camYaw: -90,                  // degrees. 0 looks toward -z, -90 toward +x, 90 toward -x, 180 toward +z. Default 0
  music: 'calm',                // 'calm' | 'tense' | null. Default 'calm'
  forms: ['liquid', 'film'],    // forms the player may choose. Default: all four. Must include 'liquid'
  killY: -12,                   // falling below this respawns. Default: lowest solid bottom - 8
  hints: { start: '...', key: '...' },  // hint strings with {tokens}; `start` shows when the level begins (section 4a)
  areas: [{ name: 'The Drip Tray', box: [-9, -7, 40, 7] }],  // optional. Named areas, in route order: box is [x0, z0, x1, z1] on the floor plane (below)
  signals: { name: expr },      // derived signal channels (section 3)
  pieces: [ /* section 4 */ ],
};
```

- `areas` is optional and purely for the view (the sim ignores it). Each entry is `{ name, box }` with
  `box: [x0, z0, x1, z1]` - a world-space rectangle on the floor plane, **no y**, corners in either
  order. List them in the order the route passes through them.
  - The HUD shows an area's name in a banner the first time Mote enters its rectangle, keeps it under
    the level name while Mote is inside, and the pause menu and level select list them. Where two
    rectangles overlap the earlier one wins; in a gap between rectangles the last area stays current.
  - Keep names to **26 characters**, unique within the level, and put `spawn` and the exit inside a
    rectangle (`tests/areas.test.js` checks all of this for registered levels; a malformed entry is
    ignored at runtime rather than breaking the level).
  - The renderer merges the static geometry of each area into one mesh and stops drawing areas
    beyond the haze (about 100 m), so make the rectangles cover everything that belongs to the area,
    walls and side rooms included, and keep one area under ~56 m long (a longer one is split in
    two for drawing; that costs nothing but culls less). A piece outside every rectangle is
    drawn with the nearest area. Levels without `areas` are cut into 40 m slices for the same economy.
  - Budget: any view should stay at or under ~48 draw calls. Doors, platforms, crates, plates and
    Fire's wood / ice / wax are one batched draw however many there are; each fan rotor, sprout
    and live electrode arc in view is one draw of its own (`__dew.stats().drawCalls`, section 9).

- `forms` only limits what the player can *select*. Zones still force any form (a heat vent makes
  steam in a level where steam is locked). Locked forms show a padlock in the HUD.
- Respawn is always as liquid with a full steam gauge, at the last checkpoint touched (or `spawn`).
- `theme` is purely visual (the sim ignores it) and picks the chapter look in `src/render/themes.js`:
  `'slip'` (chapter 1, dawn mist: teal/cream glazed tile, coral brick, the works in the haze behind),
  `'loft'` (chapter 2, golden morning: honey floorboards, whitewash, teal nosings, roof trusses, sun shafts),
  `'kiln'` (chapter 3, amber dusk: coral firebrick, plum walls, a furnace bed far below, inside the great kiln).
  (The v2 look, DESIGN-V2.md section 2: bright, cel-shaded, inked. Time of day tells chapters apart, not darkness.)
  A block's `mat` is painted per theme: its top faces (walkable) and its sides (walls) get different
  textures, so e.g. `'tile'` is glazed tile in the slip room and floorboards in the loft. A missing or
  unknown theme falls back to `'slip'`; `tests/themes.test.js` rejects unknown names in registered levels.

## 3. Signals

Triggers raise **channels**; actuators read them. A channel is just a name.

- A trigger piece names its channel with `emit: 'name'`. Several triggers may emit the same
  channel: it is true while **any** of them is active (OR).
- An actuator piece reads with `on: <expression>`.
- `level.signals` defines extra named channels from expressions. They may reference each other in
  any order. Cycles, unknown operators and emitting a derived channel are load errors. A channel
  that is read but never emitted or defined produces a warning (and the level tests fail on warnings).

Expression grammar:

| Expression | True when |
|---|---|
| `'name'` | channel `name` is true |
| `'!name'` | channel `name` is false |
| `true` / `false` | constant |
| `{ and: [e, ...] }` | every operand is true |
| `{ or: [e, ...] }` | any operand is true |
| `{ not: e }` | operand is false |
| `{ xor: [a, b] }` | exactly one is true |
| `{ latch: e }` | `e` has ever been true (stays on for good) |
| `{ latch: e, reset: r }` | latched by `e`, cleared while `r` is true (reset wins) |
| `{ toggle: e }` | flips each time `e` goes from false to true |
| `{ hold: e, for: s }` | `e` is true, or was true within the last `s` seconds (a timer) |
| `{ delay: e, for: s }` | `e` has been continuously true for at least `s` seconds |

Operands nest freely: `{ latch: { and: ['plateA', { not: 'sensorB' }] } }`.
Values are evaluated once per tick; an actuator sees a value at most one tick (1/120 s) old.
An actuator whose signal is already true at t = 0 (e.g. a door on `'!plate'`) starts in that
state silently.

## 4. Pieces

Every piece is `{ type, ...fields }`. All accept an optional `id` (string) - it appears in error
messages and is handy in tests. "Trigger" pieces need `emit`; "actuator" pieces take `on`.
Zones and fans may also take `on` and are simply inactive while it is false.

### 4.1 Solid geometry

| type | fields | notes |
|---|---|---|
| `block` | `box`, `mat` | Static box. `mat`: `'tile'` (teal glazed, default), `'cream'`, `'brick'`, `'dark'`, `'metal'`, `'clay'`. Purely visual. |
| `ramp` | `box`, `up`, `mat` | Wedge filling the box under a plane that rises from `y0` to `y1` in direction `up` (`'+x' '-x' '+z' '-z'`). Slope = rise / run; keep it <= 1 (steeper warns). Its back and sides are walls. |
| `mover` | `box`, `to`, `speed`, `pause`, `delay`, `mode`, `on`, `mat` | Moving platform. `box` is position A; `to: [dx, dy, dz]` is the offset to B. `speed` m/s (default 2, max 6). `mode: 'loop'` (default) shuttles A-B-A waiting `pause` s (default 1) at each end, after an initial `delay` s; with `on` it only runs while the signal is true. `mode: 'toggle'` (needs `on`) rests at A when false and travels to B when true - a lift or bridge. Carries Mote and crates; jumping off keeps its velocity. Movers pass through other geometry; if one squeezes Mote against a wall, Mote respawns. |
| `door` | `box`, `on`, `slide`, `time` | Solid when closed. Opens while `on` is true by sliding its own extent along `slide`: `'down'` (default; sinks away and stops colliding), `'up'`, or `'+x' '-x' '+z' '-z'`. `time` s to travel (default 0.6). It will not close on Mote or a crate - it waits. |
| `crate` | `pos`, `size` | Pushable box. `pos` = bottom centre. `size` = number or `[w, h, d]`, default 1, minimum 0.4. Only **ice** on the ground can push it, along X or Z, at up to 2.4 m/s. It falls off ledges, rides movers, presses both kinds of plate, and Mote can stand on it. It stops at walls and at ramps (it will ride up a lip of <= 0.1 m such as a plate). If it leaves the world it reappears at `pos`; pressing R puts every crate back. |
| `pane` | `box`, `speed`, `emit` | Cracked glass. Solid until **ice** hits it at >= `speed` m/s measured along the contact normal (default 5.5), sideways or from above. Slower hits just crack audibly. Optional `emit` is true once broken. |
| `ember` | `box`, `emit` | Glowing ember pile. Solid to everything until **liquid** touches it, then it is doused for good. Optional `emit` is true once doused. |
| `grate` | `box` | Solid to everything except **steam**. Vertical (wall) or horizontal (floor/ceiling). |
| `slot` | `box` | Slatted floor: solid to everything except **film**, which drops through. |
| `sprout` | `pos`, `height`, `axis`, `emit` | A bud at `pos`. When **liquid** comes within 0.95 m it grows for 1 s into a beanstalk of one-way leaf platforms (pass up/sideways through them, land on top). `height` = top leaf height above `pos` (default 3, min 0.6). Leaves: `n = ceil(height / 1.2)`, leaf *i* at `height * i / n`; lower leaves are 1.4 m square and alternate +0.45 / -0.45 m along `axis` (`'x'` default, or `'z'`), the top leaf is 1.8 m square and centred. Climb by hopping straight up beside the stalk. Optional `emit` is true once grown. |
| `prop` | `pos`, `kind`, `rot`, `scale`, `solid` | Scenery. `kind`: `'lamp'`, `'pots'`, `'kiln'`, `'pipe'`, `'shelf'`, `'chimney'`. `rot` degrees about Y (kiln mouth direction: 0 faces +z, 90 faces +x; pipe/shelf length: 0 along x, 90 along z). `scale` default 1. Each kind has a box collider (lamp 0.28 x 2.1 x 0.28, pots about 1.4 x 0.55 x 1.7, kiln 2.1 x 1.8 x 2.1, pipe 3.3 x 0.58 x 0.4, shelf 2.2 x 1.8 x 0.56, chimney 1.2 x 6 x 1.2, all times `scale`); set `solid: false` for dressing out of reach. Lamps and kilns glow warm. |

### 4.2 Triggers

| type | fields | notes |
|---|---|---|
| `plate` | `pos`, `size`, `heavy`, `emit` | Pressure plate. `pos` = centre on the floor; `size: [w(x), d(z)]`, default `[1.4, 1.4]`. It is a 0.06 m lip. **Light** (default): pressed by any grounded form except steam, or a crate. **Heavy** (`heavy: true`): only ice or a crate (a drop or film on it gets a "denied" cue). `emit` is true while pressed. |
| `electrodes` | `box`, `emit`, `axis` | Two posts at the ends of `box` along `axis` (`'x'`/`'z'`, default: the longer side). `emit` is true while **film** lies on the floor between them (centre inside the box). Keep the box about 1.2-1.6 m long. |
| `sensor` | `box`, `emit`, `forms`, `crates`, `visible` | Generic zone trigger: true while Mote overlaps it. `forms: ['steam']` limits which forms count; `crates: true` also counts crates. Draws a faint floor outline unless `visible: false`. |

`pane`, `ember`, `sprout` and `checkpoint` can also emit (see their rows).

### 4.3 Zones and fans

A zone affects Mote while Mote's body overlaps its `box` (with a small forgiving margin).
All take an optional `on`.

| type | fields | notes |
|---|---|---|
| `fan` | `box`, `dir`, `strength`, `on` | Airflow filling `box` in direction `dir`; the rotor is drawn on the upstream face. `strength` = wind speed in m/s (default 8). **Steam** is dragged to wind speed (plus its own 3.4 m/s of steering; a `'+y'` fan is an updraft). **Liquid** is carried at 0.75 x strength sideways and gets a slightly higher jump in an updraft. **Ice and film are not moved.** |
| `heatvent` | `box`, `on` | Forces **steam** and holds the gauge full while inside. No other form can be chosen inside. |
| `frost` | `box`, `on` | Forces **ice**. No other form can be chosen inside. |
| `cold` | `box`, `on` | Condenses **steam** to liquid and refuses vaporising inside. Other forms are unaffected. |
| `hotfloor` | `box`, `on` | Melts **ice** to liquid and refuses freezing. Make the box a thin slab just above the floor (0.3 m tall). |
| `fire` | `box`, `on` | Kiln fire: touching it respawns Mote at the checkpoint (any form). |
| `current` | `box`, `flow`, `on` | Water. The surface is the top of the box. `flow: [vx, vz]` m/s. **Liquid and film float** (feet 0.28 / 0.05 m below the surface), are carried at the flow speed, swim at 60 % speed and can jump out. **Ice sinks** to whatever is under the water and is not carried. Steam ignores it. Make it at least 0.6 m deep and put a solid bed under it. |

A forced form change that would not fit (e.g. frost while film is under a low wall) waits until it does.

### 4.4 Progress pieces

| type | fields | notes |
|---|---|---|
| `checkpoint` | `pos`, `r`, `emit` | Lamp post. Lights when Mote comes within `r` (default 1.1 m) horizontally at about floor height. Respawn point from then on. Optional `emit` is true once lit. |
| `shard` | `pos` | Glaze shard, collected when Mote's body centre comes within 0.85 m. `pos` is the shard's centre: about 0.7 m above a floor for an easy one. **Exactly three per level**; their order in `pieces` is their index in the save. |
| `exit` | `pos`, `face`, `on` | The kiln door that ends the level. Trigger volume: 1.5 x 1.6 x 1.5 m centred on `pos` (y = floor). The kiln is drawn behind it; `face` (`'+x' '-x' '+z' '-z'`, default `'-x'`) is the way its mouth looks, i.e. the side the player arrives from. The kiln model reaches 1.4 m behind `pos` - leave that space, ideally a wall. With `on`, it stays shuttered until the signal is true. Exactly one per level. |
| `hint` | `box`, `key` | Shows `level.hints[key]` the first time Mote enters the box. Put one before the first encounter with each mechanism. Hints are dismissible, and at most 118 characters once their tokens are filled in (see 4a). |

### 4a. Writing hints: never name a key or a button

The same hint is shown to someone on a keyboard, someone on a phone and someone on a gamepad, so a
hint string must not say "WASD", "Space", "press 2", "tap" or "button". Write a **{token}** where
the control goes; the HUD (`src/ui/prompts.js`) fills in the words for the input method in use, and
re-words a hint that is already on screen if the player switches device.

| Token | Keyboard + mouse | Touch | Gamepad | Use it as |
|---|---|---|---|---|
| `{move}` | WASD | the left stick | the left stick | a noun: "Move with {move}." |
| `{jump}` | Space | the jump button | A | a noun: "Jump with {jump}." |
| `{liquid}` | press 1 | tap the drop button | press X | a clause: "{liquid} to rain down." |
| `{ice}` | press 2 | tap the ice button | press Y | a clause: "{ice} to freeze." |
| `{steam}` | press 3 | tap the steam button | press B | a clause: "{steam} to boil." |
| `{film}` | press 4 | tap the film button | press RB | a clause: "{film} to flatten." |
| `{restart}` | press R | tap pause, then Back to checkpoint | press Back | a clause: "Jammed? {restart}." |

- A token at the start of a sentence is capitalised for you ("Press 2 to freeze.", "Tap the ice button to freeze.").
- The action tokens already contain their verb. Do not write "press {ice}".
- Keep a hint short: the phone card shows two or three lines. The limit (118 characters, tested for
  every input method with the tokens filled in) is for the longest wording, which is touch.
- To add a token, add a row to `TOKENS` in `src/ui/prompts.js` with wording for all three input
  methods; `tests/prompts.test.js` fails if any is missing, if a level uses an unknown token, or if
  a hint hard-codes a control name.

## 5. Design numbers

Measured from the sim by `node tests/measure.js` (re-run it if `src/sim/constants.js` changes).
Constants live in `src/sim/constants.js`.

### Mote's body

| form | radius | height | notes |
|---|---|---|---|
| liquid | 0.38 | 0.70 | |
| ice | 0.38 | 0.76 | |
| steam | 0.38 | 0.70 | |
| film | 0.38 | 0.12 | fits under any gap > 0.12; **use 0.25-0.3 m gaps** |

A doorway should be at least 1 m wide (2.4 m is comfortable) and 1 m tall.
A form change is refused if the new body does not fit; the request is remembered for 0.5 s and
fires as soon as there is room (so pressing "liquid" while crawling out from under a wall works).

### Liquid

| | |
|---|---|
| run speed | 5.2 m/s, reached in 0.10 s; stops in 0.28 m |
| jump apex | 1.52 m held; 0.57 m for the shortest tap (variable height) |
| highest ledge it can jump onto | 1.65 m - **design for <= 1.4 m** |
| longest gap, running jump | 3.5 m level; 3.9 m landing 1 m lower; 4.3 m landing 2 m lower; 2.9 m landing 1 m higher - **design for <= 3.0 m level** |
| step-up without jumping | 0.35 m |
| forgiveness | 0.10 s coyote time, 0.12 s jump buffer |
| in an updraft of strength 6 | jump apex 1.93 m |

### Ice

| | |
|---|---|
| top speed from input | 6.5 m/s, reached in 0.81 s over 2.65 m |
| coasting from top speed | 8.75 m with the stick released; 2.09 m braking against it |
| jump apex / highest ledge | 0.54 m / 0.55 m |
| longest gap, running jump | 2.8 m level |
| step-up without jumping | 0.15 m (a 0.7 m kerb reliably fences ice in) |
| speed at the foot of a ramp (starting at ~6.5 m/s) | 1 m drop over 2 m: 8.1; 2 over 4: 10.1; 3 over 6: 11.9; 3 over 8: 12.3; 4 over 8: 13.4; 6 over 12: 15.0 (the cap) |
| climbing a 2 m ramp | from a standstill at its foot only if slope <= 0.3; with a full run-up, any slope up to 0.75 |
| off a kicker (1 m rise over 2.5 m, landing 1 m lower) | entry 6.5 m/s: 2.1 m; 9: 2.2 m; 12: 4.2 m; 15: 6.9 m |
| pane threshold | default 5.5 m/s: a 1.5 m flat run-up breaks it. **Use `speed: 9` or more to require a downhill run** |

Ice launches off the crest of a ramp when it is climbing faster than 1.5 m/s vertically; liquid and film never do.

### Steam

| | |
|---|---|
| gauge | 4.0 s; needs 0.4 s to vaporise; refills in 2.0 s, only while grounded (or floating) and not steam |
| rise | 1.4 m/s: **5.5 m of climb on a full gauge** |
| drift | 3.4 m/s: 13 m of level travel on a full gauge (rising all the while); **design for 13 m** (measured 13.6) |
| jump, then boil at the top | **7.3 m of climb**: a drop that jumps first and presses steam at the apex climbs 7.3 m from the floor, not 5.5 |
| in an updraft, full gauge | strength 4: 21 m; 6: 28 m; 8: 36 m; 12: 47 m |
| in a tail wind, full gauge | strength 4: 29 m; 6: 36 m; 8: 43 m; 12: 57 m |

Steam cannot descend by itself: it condenses (button, empty gauge or a cold zone) and falls as liquid.
To make a climb steam-only, make it taller than 1.65 m and shorter than 5.5 m; to make it
fan-only, make it taller than 5.5 m. To make a crossing fan-only, make it longer than 13 m.
**Warning:** a gate that must stop steam (a wall, a cliff, a doorway) has to be taller than **7.3 m** above the
highest spot a cloud can start from, or roofed - 5.5 m only holds against a player who never jumps first. Wide
walls (at least 9 m each side of the path) stop a cloud flying round; a cold zone over a place refuses steam there.

### Film

| | |
|---|---|
| crawl | 2.2 m/s; cannot jump; step-up 0.12 m |
| ignores | fans; passes `slot` floors; presses light plates; closes `electrodes` |

### Fans against liquid

Net speed walking straight into a head wind: strength 2: 3.7 m/s; 4: 2.2; 6: 0.7; **7 and above: cannot advance.**

## 6. Rules of thumb and gotchas

- **Behind the spawn** (opposite `camYaw`) keep 8 m free of walls taller than about 1 m, or the
  camera starts cramped against them. A 0.8 m parapet is fine.
- The camera tilts up over low obstacles and pulls in front of tall ones; panes, crates, plates,
  slots and thin props never block it. Long corridors narrower than about 3 m feel tight.
- Floors float in a dark hall: anything without an edge is a fall. Give ice sections a 0.7 m kerb.
- Put a `fire` or nothing under gaps; a fall or fire costs the player about half a second.
- Doors on plates: a plate only holds while pressed. Use `{ latch: 'p' }` for "press once",
  `{ hold: 'p', for: 5 }` for a timed dash, a crate for "hold it open".
- A `heavy` plate plus a crate near it is the standard ice lesson; the crate must be pushed along
  X or Z in a straight line and cannot be pulled, so leave room behind it and never let it be
  pushed into a corner the solution needs it out of (R resets crates).
- Film nooks: a shelf with a 0.3 m gap under it hides a shard only film can reach.
- A `hotfloor` in front of a heavy plate, or a `frost` zone in front of a grate, takes a choice
  away - that is what they are for.
- Do not overlap two forcing zones (heat vent and frost).
- Props are solid: do not put one where the spawn point or the reference route passes.
- Everything is tested with real inputs, so design to the "design for" numbers above, not the limits.

House rules enforced by `tests/levels.test.js`: ids are `l01, l02, ...` in play order; the level
loads with **no warnings**; exactly **3 shards**; at least **one checkpoint**; a `hints.start`
line; every hint is used by a `hint` piece, names no key or button, uses only known {tokens} and is
<= 118 characters in every input mode (`tests/prompts.test.js`); the spawn point is on solid
ground and nothing pushes Mote off it; an idle player neither dies nor wins; and the two
solvability scripts below exist and pass.

## 7. Adding a level

1. Create `src/levels/lNN.js` (copy the header of `l01.js`). For a Fire level: `fNN.js`, copy `f01.js`.
2. Import it in `src/levels/index.js` and append it to `levels` (Fire: to `campaigns.fire.levels`).
   Add a chapter to `chapters` there if you start a new one (the level-select screen groups by
   chapter and unlocks each level when the one before it in the same campaign is done).
3. Create `tests/solutions/lNN.js` (next section).
4. Run `node tests/run.js` (or `node tests/run.js lNN` for just that level's tests).

## 8. Proving a level solvable

`tests/solutions/lNN.js` must export two functions. Each receives a `Runner` (`tests/lib/play.js`)
that plays the level in the headless sim using **only real inputs** (stick, jump, form, restart):

```js
export function solve(r) { ... r.expectExit(); }      // reach the exit, no deaths
export function solveAll(r) { ... r.expectExit(); }   // reach the exit with all 3 shards
```

Steps return the runner, so they chain. Coordinates are world x and z.

| step | does |
|---|---|
| `r.walkTo(x, z, opts)` | Hold the stick toward (x, z) until within `tol` (0.2 m). Works for every form (steam drifts; ice is steered with braking so it does not overshoot). Fails with a "stuck" report if no progress for 1.5 s. opts: `tol`, `timeout`, `slow` (false = full stick to the end), `stuck` (0 disables), `y` (also require feet near this height). |
| `r.path([[x, z], ...], opts)` | Several `walkTo`s. |
| `r.jumpTo(x, z, opts)` | Jump from where Mote stands, steer to (x, z) in the air, finish grounded within `tol` (0.35). opts: `run` (metres of run-up toward the target before jumping - use it for long gaps), `hold` (seconds to hold jump; default the whole rise), `tol`, `timeout`. |
| `r.jump(hold, mx, mz)` | Press jump for `hold` seconds with the stick at (mx, mz). |
| `r.form('ice')` | One press of a form button; asserts the form took (waits out the 0.5 s buffer). `{ expect: false }` to test a refusal. |
| `r.wait(seconds, { mx, mz, jump })` | Do nothing, or hold an input. |
| `r.move(mx, mz, seconds, jump)` | Hold a raw world-space stick direction. |
| `r.waitUntil(pred, opts)` | Tick until `pred(sim, player)` is true. opts: `timeout` (10 s), `label`, and an input to hold meanwhile: `mx`/`mz`, `jump`, or `toward: [x, z]`. This is how you ride a mover, push a crate, float as steam. |
| `r.stop(opts)` | Brake until nearly still (ice needs this before lining something up). `coast: true` releases the stick instead. |
| `r.restart()` | Press R. |
| `r.dying(fn)` | Run steps in which a death is expected (otherwise any death fails the script). |
| `r.expect(pred, label)`, `r.expectSignal(name, value)`, `r.expectShards(n)` | Assertions - sprinkle them so a failure says what broke. |
| `r.expectExit({ timeout, toward })` | The level must be complete within `timeout` (2 s). End both functions with it. |

Handy in predicates: `sim.signals.get('name')`, `sim.level.doors[i].open` (0..1),
`sim.level.crates[i].body.x`, `sim.level.panes[i].broken`, `sim.level.movers[i].solid.y1`,
`sim.shardsTaken.length`, `sim.checkpoint`, and on the player `p.x p.y p.z p.vx p.vy p.vz
p.form p.grounded p.floating p.gauge`. Piece lists are in `pieces` order within their type.

When a step fails you get the level, the step number, what it was doing and Mote's state, e.g.

```
[l02 step 3: stop] Mote died (fall) at (8.23, -9.12, 8.57)
  t=2.49s pos=(0, 0.02, 0) vel=(0, 0, 0) form=liquid grounded=false gauge=4.00 deaths=1
```

`play(level, { trace: true })` prints every step as it starts. For a quick experiment:

```js
import { play } from './tests/lib/play.js';
import level from './src/levels/l04.js';
const r = play(level, { trace: true });
r.walkTo(5, 0).form('steam').waitUntil((s, p) => p.y > 3, { mx: 1 });
console.log(r.state());
```

Good scripts follow the route a player would take and assert the lesson of the level along the
way (the door opened *because* the crate is on the plate). Also consider a negative test like
those in `tests/levelformat.test.js` ("without film, liquid cannot pass") for the level's key gate.
For unit-style experiments with single mechanisms, `tests/lib/mini.js` builds a throwaway level
on a flat floor: `run([{ type: 'fan', ... }])`.

## 9. Previewing in the browser

Serve the folder (`python -m http.server 8080`) and open it. In the console, `window.__dew` has:

| call | does |
|---|---|
| `__dew.loadLevel('l04')` | start a registered level (unlock state is ignored) |
| `__dew.loadData(levelObject)` | start an unregistered level object (never written to the save) |
| `__dew.teleport(x, y, z)` | move Mote |
| `__dew.setForm('steam')` | force a form (ignores locks, zones and the gauge; still refuses if it does not fit) |
| `__dew.completeLevel()` | finish the level |
| `__dew.sim` | the live `Sim` (same object the tests drive) |
| `__dew.stats()` | `{ fps, frameMs, cpuMs, drawCalls, triangles, quality, pixelRatio, ... }` |
| `__dew.bench(n)` | draw `n` frames back to back with the GPU forced to finish each: honest ms per frame even when the tab's animation timer is throttled |
| `__dew.advance(seconds)` | run the game forward right now with the current inputs (for automated checks in a throttled tab) |

Keep an eye on `drawCalls` (the shipped levels are 33-45 including the shadow pass). Each
door, mover, crate, plate, pane, sprout, fan, shard and checkpoint is one or two draw calls;
blocks, ramps, grates, slots and props are merged and cost nothing extra.

---

## 10. Fire levels (Cinder)

A Fire level is a level with `element: 'fire'`. The hero is **Cinder**, a live coal, with four
forms: **ember** (default), **blaze**, **smoke**, **spark**. The level object, signals, hints and
the proof scripts work exactly as in sections 2, 3, 4a and 8; this section lists what is different.
Numbers are measured by `node tests/measure-fire.js` (re-run it if `src/sim/elements/fire.js` or
`src/sim/packs/*.js` change) and the constants live in those files.

```js
export default {
  id: 'f04',                    // 'fNN', in play order (f01..f12)
  element: 'fire',              // required for a Fire level
  name: 'Up the Flue',          // <= 24 characters
  chapter: 2,                   // 1 Pilot Light, 2 Flue, 3 Live Wire
  theme: 'flue',                // 'pilot' | 'flue' | 'wire' (chapter looks; see below)
  spawn: [0, 0, 0], camYaw: -90, music: 'calm',
  forms: ['ember', 'blaze', 'smoke'],   // forms offered. Default: all four. Must include 'ember'
  startGauge: 10,               // heat at the start and on a respawn before any brazier is lit (0..10, default 10)
  hints: { start: '...' }, signals: {}, pieces: [],
};
```

Themes: `'pilot'` (blue hour: slate flags, blue-charcoal brick, gold edges), `'flue'` (night in the
stack: soot brick, a red glow from below, sparks rising), `'wire'` (deep night, a gold moon: charcoal
enamel tile with brass inlay). All three are dark on purpose - the only dark themes in the game -
so that Cinder is the light. Block `mat`s mean the same as in section 4.1.

The three collectibles are **glow-stones**: still `{ type: 'shard', pos }`, exactly three.

### 10.1 The forms at a glance

| | ember | blaze | smoke | spark |
|---|---|---|---|---|
| body radius x height (m) | 0.30 x 0.56 | 0.34 x **1.05** | 0.34 x 0.60 | **0.14 x 0.26** |
| moves | runs 6.2 m/s, best jumper | walks 4.2 m/s, floaty | no gravity: rises 1.9 m/s, drifts 3 m/s | darts 9.5 m/s, short hop |
| heat per second | none | 1.25 (8 s on a full gauge) | 1.0 (10 s) | 2 (5 s) |
| heat needed to switch to it | - | 0.5 | 0.7 | 0.5 |
| lights lanterns, braziers, fuses | yes | yes | **no** | yes |
| burns wood, melts ice and wax, trips heat sensors | no | **yes** | no | no |
| sets off gas, rides wires, powers a terminal | no | no | no | **yes** |
| light plate | presses | presses | never (it floats) | **cannot** (denied cue) |
| heavy plate | no | no | no | no (use a wood crate) |
| grate | blocked | blocked | **passes** | blocked |
| slot floor | stands on it | stands on it | blocked (it rises anyway) | **drops through** |
| fan (sideways) | carried at 0.5 x strength | carried at **1.3 x** strength | dragged to wind speed | not moved |
| pool | put out | **boils it** (2 heat) | put out | put out |
| drip | put out | turns it to steam (1 heat) | knocked down to an ember | put out |
| sprinkler | put out | passes, +5 heat per second | turned back as an ember, alive | put out |
| special (press its button again) | - | **flare**: +4.4 m/s upward, 2 heat, once per airtime | - | - |

When the heat runs out, a blaze, smoke or spark falls back to an ember where it is (a spark in a
space too small for an ember stays a spark until it has room). An ember is always safe to be,
and never spends heat. "Put out" is a respawn at the last lit brazier (or checkpoint, or spawn),
as an ember, with a full gauge at a brazier and `startGauge` otherwise.

The hint tokens for Fire are `{ember}` `{blaze}` `{smoke}` `{spark}` (keyboard "press 2", touch
"tap the blaze button", pad "press Y") and `{flare}` for the special ("press 2 again", "tap the
blaze button again", "press Y again"). `{move}`, `{jump}` and `{restart}` are shared. A Fire
level may not use Water's form tokens (the tests refuse it).

### 10.2 Design numbers

"Design for" is what a player does comfortably; the limit is what the sim allows frame-perfectly.

**Ember**

| | limit | design for |
|---|---|---|
| run speed | 6.2 m/s, reached in 0.09 s; stops in 0.30 m | |
| jump apex | 1.73 m held; 0.60 m shortest tap | |
| highest ledge it can jump onto | 1.85 m | **<= 1.5 m** |
| longest gap, running jump | 4.3 m level; 4.7 m landing 1 m lower; 5.1 m landing 2 m lower; 3.7 m landing 1 m higher | **<= 3.6 m level** |
| step-up without jumping | 0.3 m | |
| to stop an ember | a gap > 4.6 m level (more if the far side is lower), a ledge > 2.0 m, a wall 3 m tall | |

**Blaze**

| | limit | design for |
|---|---|---|
| walk speed | 4.2 m/s, reached in 0.17 s; stops in 0.42 m | |
| jump apex | 1.49 m held; 0.94 m shortest tap (it floats: gravity is about 10 m/s^2, fall speed capped at 7 m/s) | |
| highest ledge, plain jump | 1.60 m | <= 1.3 m |
| longest gap, plain jump | 5.1 m level; 5.8 m 1 m lower; 6.5 m 2 m lower; 4.1 m 1 m higher | <= 4.4 m level |
| jump + flare at the top | apex 2.43 m; ledge 2.55 m; gap 7.5 m level, 8.2 m 1 m lower, 6.8 m 1 m higher | **ledge <= 2.1 m, gap <= 6.3 m** |
| flare from the ground | rises 0.95 m (less than a jump: it is for mid-air) | |
| to need the flare | a gap of 5.5-6.3 m, or a ledge of 1.8-2.1 m (an ember cannot do either) | |
| to stop a blaze entirely | a gap > 8.5 m level (9 m or more if the far side is lower), a ledge > 2.8 m, **any beam lower than 1.05 m** | |
| heat for common things | 1.25 per second; flare 2; boil a pool 2; a drip 1; 5 per second extra in a sprinkler; +1.5 back for each wood piece it lights (rope +0.5) | |

A blaze is the tallest form: a gap **0.75-0.85 m** high passes an ember and stops a blaze (that
is the standard "go back to ember" lesson). It boils a pool from 0.25 m away, before it touches
the water.

**Smoke**

| | |
|---|---|
| rise / drift | 1.9 m/s up / 3.0 m/s sideways (it cannot descend by itself: drop out as an ember) |
| on a full gauge (10 s) | 18.8 m of climb with no ceiling; 29 m of level drift under a ceiling |
| in a tail wind, full gauge | strength 4: about 58 m; 8: 69 m; 12: 77 m |
| ceilings | it rises until it meets one and slides along it; give every smoke section a ceiling or a top, and use the heat budget (`startGauge`, braziers, coal) to bound its range |

To make a climb smoke-only: taller than 2.8 m with no way round, and put a grate, a ceiling route
or a gap wider than 8.5 m in it. To bound a smoke flight, start the section with less heat
(a level's `startGauge`, or simply distance from the last brazier: 1 heat = 1 s = 1.9 m up).

**Spark**

| | limit | design for |
|---|---|---|
| speed | 9.5 m/s, reached in 0.21 s (acceleration 45 m/s^2); stops in 0.46 m. A key tap of 0.15 s moves it about 0.75 m (it was 1.55 m), so a keyboard can line it up within 0.4 m; a held key is still the full dash | design the spark's rooms so that precise lining up is done against a wall or a stop, never by a 0.1 m nudge |
| jump apex / highest ledge | 0.50 m / 0.55 m | <= 0.4 m |
| longest gap | 3.3 m level; 4.3 m 1 m lower; cannot land 1 m higher | <= 2.6 m |
| step-up | 0.14 m | |
| fits | any opening wider than 0.28 m and taller than 0.26 m | **make pinholes 0.45 x 0.45 m**; a low gap 0.3-0.5 m high passes a spark only |
| 5 s on a full gauge | about 45 m of running: enough for one dash, not for wandering | |

**Fans** (net speed walking straight into a head wind = own speed - carry x strength)

| strength | 2 | 4 | 6 | 8 | 12 |
|---|---|---|---|---|---|
| ember | 5.2 | 4.2 | 3.2 | 2.2 | 0.2 (stalls at 12.4) |
| blaze | 1.6 | driven back | driven back | driven back | driven back (stalls at 3.2) |
| spark | 9.5 | 9.5 | 9.5 | 9.5 | 9.5 |

An upward fan lifts an airborne ember a little (0.9 m/s^2 per unit of strength) and a blaze more (1.6).

### 10.3 Fire pieces

All accept `id`. "Trigger" pieces take `emit`; pieces marked `on` take a signal expression.
Every state they keep survives a respawn unless the row says otherwise.

**Things to light**

| type | fields | notes |
|---|---|---|
| `lantern` | `pos`, `r`, `mount`, `lit`, `emit` | A lamp. `pos` is the flame. Lit for good when an ember, blaze or spark comes within `r` (default 1.0 m, measured from the middle of the hero's body to `pos`). `emit` is true while lit. `mount`: `'post'` (default: stands on the floor below, put `pos` 0.9-1.0 m above the floor), `'hang'` (a chain upward), `'wall'` (a bracket). `lit: true` starts lit. A lantern 0.95 m up is lit by walking within about 0.7 m of its post; one higher than 1.9 m needs a jump. Smoke cannot light it. |
| `brazier` | `pos`, `r`, `lit`, `emit` | **Fire's checkpoint.** `pos` on the floor. An ember, blaze or spark within `r` (default 1.2 m) lights it; from then on any form that comes within `r` makes it the respawn point and has its heat refilled (30 per second: full in a third of a second). A respawn at a brazier returns with a full gauge. `emit` is true once lit. It is 0.7 m tall and not solid. **Every Fire level needs at least one**; put the first within a few seconds of the spawn and one after every hard section. |
| `fuse` | `path`, `rate`, `regrow`, `on`, `emit` (required) | A cord that burns from its first point to its last. `path`: two or more points `[x, y, z]` (lay it 0.05 m above floors and 0.05-0.12 m off walls). It is lit when an ember, blaze or spark comes within about 0.85 m of **the first point only** (or when `on` is true), burns at `rate` m/s (default 1.6), and `emit` becomes true when the flame reaches the end: **delay = length / rate**. Without `regrow` it stays spent and `emit` stays true for good. With `regrow: s` it emits for `s` seconds, then is whole again and can be relit: that makes a timed window that can always be retried. Standing on the first point relights it the moment it has regrown. Not solid; water does not put it out. |
| `coal` | `pos`, `heat` | A lump of fuel: +`heat` (default 4) when the middle of the hero's body comes within 0.8 m. Left alone if the gauge is already full. **Comes back whenever the hero respawns**, so wasted heat is never a dead end. `pos` 0.5 m above a floor. |

**Things a blaze changes**

| type | fields | notes |
|---|---|---|
| `wood` | `kind`, `box` or `pos`+`size` or `from`+`to`, `burn`, `fuel`, `spread`, `on`, `emit` | Burnable timber. A **blaze** touching it (within 0.14 m) sets it alight; it stays solid while it burns for `burn` seconds and is then gone for good (a restart does not bring it back). The blaze is paid `fuel` heat at once. `emit` is true once it is gone. `on`: catches fire when the signal is true (a fuse can burn a bridge from afar; no fuel is paid). `kind`: `'block'` (default; `box`; burn 1.6 s, fuel 1.5), `'plank'` (`box`, usually thin; 1.0 s, 1.5), `'crate'` (`pos` = bottom centre, `size` number or `[w, h, d]`, min 0.4; a free box that falls, rides movers and **weighs light and heavy plates**; nobody can push it; 1.2 s, 1.5), `'rope'` (`from`, `to`: two points; not solid; a blaze within about 0.8 m of the line burns it through in 0.6 s, fuel 0.5 - tie its `emit` to a door or a `toggle` mover to drop a bridge or a gate). **Fire spreads**: when a piece is half burnt, every wood piece within 0.08 m of it catches too (set `spread: false` on a piece to keep it out of that, in both directions). Leave a gap of 0.1 m or more between wood that must burn separately. |
| `iceblock` | `box`, `melt`, `emit` | A solid block of ice. A blaze touching it melts it in `melt` seconds of touch (default 1.5; progress is kept if the blaze steps away, it never refreezes), then it is gone. `emit` is true once gone. Nothing else affects it. |
| `wax` | `box`, `melt`, `min`, `emit` | A solid block that **sags** while a blaze touches it (standing on it counts): its top sinks from the box's top to `min` metres above its base (default 0.12) over `melt` seconds of touch (default 2.5), carrying down whatever stands on it - the blaze, a wood crate onto a plate. It never rises again. `emit` is true once fully sagged. A stub of 0.12 m can be stepped over by every form. |
| `heatsensor` | `box`, `emit` (required) | True while a **blaze** is inside the box, or while burning wood overlaps it. Latch it (`{ latch: 'hs' }`) for "show it a flame once". Drawn as an iron plate in the floor with a glowing eye; not solid. |

**Things a spark uses**

| type | fields | notes |
|---|---|---|
| `terminal` | `pos`, `id` (required), `emit` | A post on the floor (0.33 m tall, not solid). Alone it is a socket: `emit` is true while a **spark** stands on it (its body surface within 0.6 m of the post, 0.74 m from the middle; it was 0.4 m). With a wire it is a station. Keep two posts at least 1.5 m apart. |
| `wire` | `from`, `to`, `via`, `speed`, `on` | A rail between two terminals (by `id`). A spark that touches either terminal is carried to the other at `speed` m/s (default 14, max 30) along the wire: from 0.3 m above the first post, through the `via` points `[x, y, z]`, to 0.3 m above the second. **On the wire nothing touches it**: no water, no walls, no heat spent, no input. It arrives standing on the far terminal (which it powers, if that has `emit`) and is not sent back until it has stepped 0.9 m away. With `on`, a dead wire carries nothing until the signal is true. One wire per terminal (use `via` for a long run). Run wires over pools and through sprinklers: that is what they are for. Shards on the wire are collected on the way. |
| `gas` | `box`, `launch`, `radius`, `refill`, `on` | A pocket of gas. It goes off when a **spark** enters it, or when `on` goes from false to true (a fuse, a plate). The blast: breaks every `weakwall` and `pane` within `radius` (default 2.5 m, measured between boxes); sets off other pockets within `radius` 0.12 s later; and **throws whoever is in the pocket** (any form, within 0.25 m of the box) with velocity `launch` `[vx, vy, vz]` m/s (default `[0, 13, 0]`) times the form's weight factor (ember 1, blaze 0.85, smoke 0.6, spark 1.25). The sideways part is kept until the hero lands or hits a wall; the player can still steer. The pocket fills again after `refill` seconds (default 5; 0 = one blast only). A blast never hurts. |
| `weakwall` | `box`, `emit` | A cracked wall: solid until a gas blast reaches it, then gone for good. `emit` is true once broken. Nothing else breaks it. |

Launch arcs with no stick input (height above the pocket floor, distance, time in the air):

| `launch` | ember | blaze | spark |
|---|---|---|---|
| `[0, 13, 0]` (default) | up 3.2 m, 0.9 s | up 6.0 m, 2.4 s | up 5.0 m, 1.1 s |
| `[6, 11, 0]` | up 2.3 m, along 4.6 m | up 4.3 m, along 10.2 m | up 3.6 m, along 7.1 m |
| `[10, 8, 0]` | up 1.2 m, along 5.6 m | up 2.3 m, along 12.2 m | up 1.9 m, along 8.7 m |

Design a launch for one form and test it with the others: a blaze floats twice as far as an ember.

**Water**

| type | fields | notes |
|---|---|---|
| `pool` | `box`, `boil`, `on` | Still water filling `box` (its top is the surface). Touching it puts out an ember, a spark and smoke. A **blaze** within 0.25 m boils it instead: 2 heat, and for `boil` seconds (default 3) the water is gone and anything may walk across the bed; then it is back, and whoever is still in it is put out (a blaze boils it again if it has the heat). A blaze with less than 2 heat is put out like the rest. Put a solid bed under it (a `block` 0.5-0.7 m below the rim: every form can jump out of a basin up to 0.5 m deep; a spark needs it <= 0.4 m) and make the surface 0.05-0.15 m below the rim. With `on`, the pool is only there while the signal is true. |
| `drip` | `pos`, `drop`, `period`, `offset`, `speed`, `on` | A pipe end at `pos` that lets go a drop every `period` seconds (default 1.6), the first after `offset` seconds (default 0). The drop falls at a constant `speed` (default 4.5 m/s) for `drop` metres (default: down to the first block or ramp top below). Only the falling drop is dangerous (radius 0.16 m): an ember or spark it touches is put out, a blaze turns it to steam for 1 heat, smoke is knocked down to an ember. The column is clear from the moment a drop lands until the next reaches head height. `period` must be longer than the fall (`drop / speed`). A drip is a point: to make it a gate, put it over a walkway about 1.5 m wide with water or a wall either side. |
| `sprinkler` | `box`, `period`, `duty`, `offset`, `on` | Spray filling `box`. Inside it an ember or spark is put out; a blaze survives but loses 5 extra heat per second (a 2 m curtain costs about 4 heat; a long one drains it, and then puts the ember out); smoke is turned back: it becomes an ember just outside the spray, alive. By default it sprays all the time; with `period` (seconds) and `duty` (fraction of each period it sprays, default 0.5) it pulses; with `on` it follows a signal (the usual valve: `on: '!fuse'` with a fuse that has `regrow`). Reach it across the whole passage and at least 3 m high, or an ember jumps over. |

**Fire and the shared pieces** (section 4). Allowed in a Fire level: `block ramp mover door pane
grate slot plate sensor fan heatvent frost cold fire current checkpoint shard exit hint prop`.
Not allowed (the loader says so): `crate` (use `wood` kind `'crate'`), `ember`, `sprout`,
`electrodes`, `hotfloor`.

| piece | in a Fire level |
|---|---|
| `plate` | light: pressed by an ember, a blaze or a wood crate; a spark gets the "denied" cue; smoke never. `heavy`: only a wood crate. |
| `pane` | broken only by a gas blast in reach. |
| `grate` | smoke passes; everything else is blocked. |
| `slot` | a spark drops through; ember and blaze stand on it. |
| `fan` | see the fan table. Smoke is dragged to wind speed; sparks ignore it. |
| `frost` | a blaze inside is turned back to an ember and cannot flare up there. The other forms pass. |
| `cold` | smoke inside is turned back to an ember and cannot be chosen there. |
| `heatvent` | no form spends heat inside (it does not force a form and does not refill). |
| `fire` | **fuel**: +3 heat per second while inside, and it never harms. |
| `current` | running water: puts out any form that touches it and cannot be boiled. |
| `checkpoint` | works (a respawn there has `startGauge` heat, not a full gauge). Prefer braziers. |
| `sensor` | `forms: ['blaze']` etc. take Fire's form names. |
| `mover`, `door`, `ramp`, `block`, `exit`, `hint`, `prop` | as for Water. |

### 10.4 Gotchas

- **Heat is the budget.** Decide for each section how much heat the reference route spends and
  where it comes back. A full gauge is 8 s of blaze, 10 s of smoke or 5 s of spark, minus 2 per
  flare and per boiled pool. Put a brazier (or coal) before anything that needs a strong form,
  and never let the only way forward depend on heat the player may already have spent: coal
  returns on respawn and braziers always refuel, so a brazier in reach is what makes a section fair.
- A blaze **cannot stop burning what it touches**. Wood it brushes past is lit. Keep wood the
  player must not burn yet (a bridge to cross as an ember) away from where a blaze has to walk,
  or make it the lesson. Remember that fire spreads through touching wood.
- Burnt wood, melted ice, sagged wax, broken walls and lit lanterns are forever (even across a
  restart from the checkpoint). Never make one of them necessary *after* the player can have
  destroyed it. If something must be retried, use a fuse with `regrow`, a gas pocket (it
  refills) or a sprinkler on a signal.
- The flare makes gaps up to 7.5 m and ledges up to 2.55 m reachable by a blaze. To make
  something need another answer (a bridge, a wire, smoke), make the gap 9 m or the ledge 3 m.
- An ember jumps 1.85 m up and 4.3 m along. A wall meant to stop it is 3 m; a pool meant to be
  jumped is at most 3.6 m wide; a pool that must not be jumped is 5 m or more (and 9 m if a
  blaze must not flare over it either - or simply roof it).
- Smoke rises: a sprinkler or pool only stops it if the passage has a ceiling low enough to hold
  it in the water's reach. Give smoke sections a ceiling, always.
- A spark is fast and short-lived: it covers 9.5 m a second for 5 s. Put terminals and gas where
  it arrives with heat to spare, and remember it cannot press plates or jump more than 0.5 m.
- Keyboard comfort (proved by `tests/solutions-kb/f01.js ... f12.js`, which play every level with
  W/A/S/D, Space and the form keys at human speed): a player on keys moves in full-speed steps, so
  give a timed window at least 5 s of slack for a 0.15 s reaction plus the walk, make every
  hop a stone or raft at least 2.4 m long with gaps of 1.7-2.0 m, put a coal before every pool and
  every run of spark rooms (a keyboard route burns about 1.3 times the heat of the reference route),
  and line a spark up on a pinhole with a stop (a low block beside the hole that it runs into) rather
  than asking for 0.1 m of precision. A lantern a spark must light has `r: 1.5` (a spark stands 0.8 m
  below a lantern at 0.95 m).
- Drips and sprinklers are only as readable as their surroundings: put them where the camera
  sees the nozzle and the floor under it. Each drip draws a ring where its drop lands and a bead
  that swells before it falls.
- Pools glow: they are the brightest cold thing in a Fire level, on purpose. Do not put a
  glow-stone where the only light on it is a pool's.
- The spawn rule of section 6 still holds (8 m clear behind the spawn). A brazier is not solid,
  but a lantern on a post is drawn where you put it: keep it off the reference route's line.

House rules for Fire levels (`tests/campaigns.test.js`): ids `f01, f02, ...` in play order;
`element: 'fire'`; a chapter and a theme that exist; no load warnings; exactly 3 glow-stones; at
least one brazier (or checkpoint); a `hints.start` line; every hint used, written with Fire's
tokens only, <= 118 characters on every input method; a stable spawn; an idle player neither
dies nor wins for 20 s; and `solve` / `solveAll` in `tests/solutions/fNN.js` reach the exit
without a death, twice the same.

### 10.5 Scripting Fire levels

The Runner of section 8 drives Cinder unchanged (`walkTo`, `jumpTo`, `form('blaze')`,
`waitUntil` ...). Additions and differences:

| step | does |
|---|---|
| `r.special(opts)` | Press the button of the form Cinder is already in (Blaze: flare). Asserts the special fired; `{ expect: false }` asserts it was refused. `mx`, `mz`, `jump` hold inputs during the press. |
| `r.form('blaze')` | As before - but if Cinder is **already** a blaze it fails with "pressing its button again would fire its special": use `r.special()` when you mean it, or test `r.p.form` first. |
| `r.dying(fn)` | Deaths by water have cause `'water'`. |

A jump with a flare at the top, the way the f03 script does it:

```js
r.waitUntil((s, p) => p.x >= 53.5, { mx: 1, label: 'run-up' })
 .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 1, jump: true, timeout: 2, label: 'top of the jump' })
 .special({ mx: 1, jump: true })
 .waitUntil((s, p) => p.grounded, { mx: 1, timeout: 4, label: 'lands' });
```

Handy in predicates (lists are in `pieces` order within their type; find by `id` with
`s.level.woods.find((w) => w.id === 'bridge')`):

| list | fields |
|---|---|
| `s.level.woods` | `state` (0 sound, 1 burning, 2 gone), `t` (0..1 burnt), `kind` |
| `s.level.fuses` | `state` (0 ready, 1 burning, 2 spent), `d` (metres burnt), `len` |
| `s.level.lanterns`, `s.level.braziers` | `lit`; braziers also `current`. `s.checkpoint` is the brazier (or checkpoint) that holds the respawn |
| `s.level.iceblocks` | `t` (0..1 melted), `gone` |
| `s.level.waxes` | `t` (0..1 sagged), `solid.y1` (its top now) |
| `s.level.pools` | `wet` (water is there now), `steamT` (seconds of boil left) |
| `s.level.drips` | `live` (a drop is falling), `y` (its height), `clock`, `period`, `fallT` |
| `s.level.sprinklers` | `wet` (spraying now) |
| `s.level.terminals`, `s.level.wires` | `live` (powered) / `active` (carries); on the player `p.ride` (non-null while on a wire) |
| `s.level.gases` | `full`, `blasts` (how many times it has gone off) |
| `s.level.weakwalls` | `broken` |
| `s.level.heatsensors` | `live` |
| `s.level.coals` | `taken` |
| player | `p.gauge` is heat (0..10); `p.form`; `p.airSpecial` (the flare has been used since the last landing) |

To wait for a drip, wait for a drop to fall and land, then go:

```js
r.waitUntil((s) => s.level.drips[0].live, { timeout: 4 })
 .waitUntil((s) => !s.level.drips[0].live, { timeout: 4 })
 .walkTo(33.75, 0);
```

For unit-style experiments use `tests/lib/fire.js`: `frun(pieces, extra)` is `run()` on a flat
Fire level (`extra.startGauge`, `extra.forms` ...); `at(level, x, y, z, form, gauge)` places
Cinder in a level (deaths allowed) and `hold(r, mx, mz, seconds, { jump })` pushes a stick and
returns the extremes reached - the two helpers every "cannot be skipped" test in
`tests/levels-f01-f03.test.js` is built from. Write such a test for every gate: the wrong forms
must fail, and the gate must not be jumped, floated or flared round.

### 10.6 Previewing and the draw-call budget

`__dew.loadLevel('f02')`, `__dew.setForm('blaze')` (ignores locks and heat) and
`__dew.teleport(x, y, z)` work as in section 9. `__dew.sim.player.gauge = 10` refills heat.
`__dew.element` is the element chosen on the title screen, `__dew.selectElement('fire')` chooses
one as the title screen does (only while the title is showing), `__dew.toTitle()` goes there.

Fire's own pieces cost at most six draw calls **in total**, however many there are (they are
instanced and merged: see the header of `src/render/world-fire.js`), so the budget is spent as
in Water: each door, mover and plate is one to three. Keep a level at or under **48** on high
quality (`__dew.stats().drawCalls`); the first three Fire levels measure 37-43 (f01 43, f02 37, f03 40) with 14.7-15.6 thousand triangles, against 40-46 and 16.6-27.6 thousand for Water.

### 10.7 Decisions taken where DESIGN-ELEMENTS.md left a number or an edge case open

Recorded so that later levels and Clay are built on the same rules. Each is enforced by a test in
`tests/fire-forms.test.js` or `tests/fire-pieces.test.js`.

| question | decision | why |
|---|---|---|
| How big is the heat gauge and what does each form cost? | 0..10. Ember 0, smoke 1.0/s, blaze 1.25/s, spark 2/s; 0.5-0.7 needed to switch. | Whole numbers a designer can budget in their head: a full gauge is 10 s of smoke, 8 s of blaze, 5 s of spark. |
| Which forms have a special? | Only Blaze: **flare** (2 heat, +4.4 m/s upward, once per airtime). | It makes "its own updraft" something the player does, turns heat into reach, and gives the special input one clear meaning to learn. Wires, gas, lanterns work by touch so they need no button. |
| What happens when the heat runs out? | Back to an ember where it stands (a spark with no room waits as a spark). Never a death. | Running out is a mistake to recover from, not a punishment; ember is always safe. |
| Does anything refuel besides braziers and coal? | Lighting wood pays the blaze back (+1.5; rope +0.5), and the shared kiln `fire` piece feeds +3 per second. | "What kills one element feeds another", and burning is never a net loss. |
| Brazier: how fast, and what on respawn? | 30 heat per second within 1.2 m (in effect instant); a respawn there has a full gauge. | Touching a brazier should simply mean "full". |
| Does coal come back? | Yes, on every respawn (death or restart). | Fuel that can be wasted for good would allow dead ends. |
| Water against each form | Ember, spark: put out by pool, drip, sprinkler. Smoke: put out by a pool it touches; a drip or sprinkler knocks it down to an ember (a sprinkler also pushes it back out, so it lands dry). Blaze: boils a pool (2 heat, 3 s), turns a drip to steam (1 heat), walks through a sprinkler at +5 heat per second. Running water (`current`) puts out everything and cannot be boiled. | The table in the design, made exact; a blaze is the costly answer to water, never a free one. "Knocked down" must leave smoke alive or it would just be another death. |
| Drips: how are they timed? | A fixed period from a fixed offset on the sim clock; a constant fall speed (4.5 m/s); only the falling drop is dangerous. | Deterministic and readable: watch one fall, then go. |
| Who lights things? | Ember, blaze and spark; never smoke. | The design says smoke "can't light anything"; the others are all flame. |
| Who sets off gas? | Only a spark by touch, or a signal (so a fuse can). The blast throws whoever stands in the pocket, any form. | Keeps ember "safe" as the design says, and makes fuse-timed launches possible. |
| Launches | A fixed velocity per pocket (level data), scaled by form (spark 1.25, ember 1, blaze 0.85, smoke 0.6); the sideways part is kept until landing. | A designer can aim it and read the arc from a table. |
| Weak walls | A piece of their own (`weakwall`); a blast also shatters `pane`s in reach. | The design names "weak walls" without a piece. |
| Wires | Touching a terminal as a spark starts the ride; 14 m/s; nothing touches a spark on a wire and it spends no heat; no return trip until it steps 0.9 m off; one wire per terminal. | A rail should be a commitment and a safe passage, and must not ping-pong. |
| Fuses | Lit only at their first point; `emit` at the end; optional `regrow` turns the result into a timed window that can be retried. | One obvious place to touch; timing puzzles that never dead-end. |
| Wood | Stays solid while it burns, then is gone for good; fire spreads to touching wood at half burnt; `spread: false` opts out. | Collapse is the payoff; spreading makes a line of planks a slow fuse. |
| Wax | Sags only while heated, never recovers, carries down what stands on it. | "Lowers what stands on it." |
| Fans | Ember 0.5 x strength, blaze 1.3 x, spark unmoved, smoke dragged to wind speed. | "Fans push [blaze] hard"; a coal is heavier than a drop; a spark needs a job no other form has. |
| Zones | Frost turns a blaze back to an ember; cold turns smoke back; a heat vent stops heat being spent; hot floor is not a Fire piece. | Each takes one form away, as zones do for Water. |
| Plates | Ember and blaze press light plates; spark cannot; nothing but a wood crate presses a heavy one. | The design: spark "can't press any plate". |
| Slots and grates | A spark drops through a slot floor; smoke passes grates. | Reuse of the two shared see-through pieces, one per light form. |
| Body sizes | Ember 0.30 x 0.56, blaze 0.34 x 1.05, smoke 0.34 x 0.60, spark 0.14 x 0.26. | A blaze too tall for a beam and a spark that fits a pinhole are puzzles for free. |
| Where does Cinder's light come from? | The one existing hero light takes Cinder's colour and power per form, and the mark below Cinder is a warm pool of light instead of a shadow. | No extra light, no extra draw call. |
