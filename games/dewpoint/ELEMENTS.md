# DEWPOINT - how to add an element

An element (Water, Fire, and next Clay) is **data plus a few small modules that plug in**. The
engine never asks "is this ice?" or "is this the fire campaign?": it reads the current form's
movement model and capability flags, and calls the hooks of the element's *packs*.
This file is the recipe. Fire was added by following it; `src/sim/elements/fire.js`,
`src/sim/packs/fire.js`, `src/render/hero/cinder.js` and `src/render/world-fire.js` are the worked
example to copy from. Design intent is in `DESIGN-ELEMENTS.md`; the level format is in `LEVELS.md`.

Contents: 1 What the engine promises - 2 Checklist - 3 The element definition - 4 Form flags -
5 Zones, kiln fire, running water - 6 Specials - 7 Packs (your own pieces) - 8 UI table, icons,
hint tokens - 9 Hero view - 10 Piece views and themes - 11 Audio - 12 Save - 13 Levels and
registry - 14 Tests you get for free, and tests you must write - 15 Rules that keep Water safe

---

## 1. What the engine promises

- `src/sim/sim.js`, `collide.js`, `level.js`, `signals.js` contain **no form name and no element
  name** (`tests/elements.test.js` greps for them). If your element needs the core to behave
  differently, add a *flag* that every element could set, give it a neutral default, and read the
  flag. Never write `if (form === 'stone')`.
- Water is frozen. `tests/golden-water.test.js` replays the twelve Water levels against traces
  recorded from the v1 build and requires them bit-identical (position, velocity, form and gauge
  at every sample, a hash over every tick, the finish tick). If it fails after your change, your
  change altered Water: fix the change. Never regenerate `tests/fixtures/water-golden.json`.
- Form names are unique across all elements (`liquid ice steam film`, `ember blaze smoke spark`,
  and Clay's `clay slip stone dust`). The registry refuses a duplicate.
- Controls are the same for every element: move, jump, four form buttons. Pressing the button of
  the form you are already in is that form's *special*, if it has one.

## 2. Checklist

Create (replace `clay` / `dab` with your element and hero):

| # | File | What |
|---|---|---|
| 1 | `src/sim/elements/clay.js` | the element definition (section 3) |
| 2 | `src/sim/packs/clay.js` | your own pieces, if any (section 7) |
| 3 | `src/render/hero/dab.js` | the hero view, a `HeroView` subclass (section 9) |
| 4 | `src/render/world-clay.js` | how your pieces look (section 10) |
| 5 | `src/levels/c01.js` ... | levels, with `element: 'clay'` (section 13) |
| 6 | `tests/solutions/c01.js` ... | scripted proofs (LEVELS.md section 8) |
| 7 | `tests/clay-forms.test.js`, `tests/clay-pieces.test.js`, `tests/levels-c01-c0N.test.js` | section 14 |

Edit (one or two lines each):

| # | File | What |
|---|---|---|
| 8 | `src/sim/elements/index.js` | `import clay from './clay.js'` and add it to `list` |
| 9 | `src/render/hero/index.js` | add `clay: DabView` to `HEROES` |
| 10 | `src/render/world.js` | add your `buildClayViews` to `PACK_VIEWS`; add a `clay` entry to `ELEMENT_LOOK` (collectible look, low-gap hint colour) |
| 11 | `src/render/themes.js` (+ `textures.js` if you need new surfaces) | themes `wedge`, `bisque`, `glost` (section 10) |
| 12 | `src/levels/index.js` | import the levels, put them in `campaigns.clay.levels` |
| 13 | `LEVELS.md` | a section like section 10 (Fire): every piece, every number, the gotchas |

Already done for all three elements, nothing to add: the UI table (`src/ui/elements.js`: names,
pitch, form buttons, colours, wording), the icons (`src/ui/icons.js`: `clay slip stone dust`, the
maker's mark, the `dab` portrait, the moisture gauge), the hint tokens (generated from the UI
table: `{clay} {slip} {stone} {dust}` and `{shed}`), the save fields, the campaign entry with its
three chapter names, the title card (it stops saying "coming soon" the moment
`campaigns.clay.levels` is not empty) and the audio (`audio.setElement('clay')` and Clay's form
and SFX names already exist in `src/audio.js`). Check each against your design and change the
data if the design moved.

Then run `node tests/run.js`. The generic tests (section 14) tell you what is still missing.

## 3. The element definition

`src/sim/elements/<id>.js` default-exports one object. The registry validates it at import time
and throws an error that names the element and the field.

```js
import { PIECE_TYPES } from '../piecetypes.js';   // the 25 shared piece types, if you allow them all
import myPack from '../packs/clay.js';

export default {
  id: 'clay',                    // lower-case; also the value of level.element and of the save's `element`
  name: 'Clay',                  // must equal the UI table's name
  hero: 'Dab',                   // used in test failure messages ("Dab died (water) at ...")
  campaign: 'The Thrown Road',   // must equal campaigns.clay.name
  forms: ['clay', 'slip', 'stone', 'dust'],   // exactly four, in BUTTON ORDER (keys 1 2 3 4; pad X Y B RB)
  defaultForm: 'clay',           // the respawn form. Every level must allow it. It must not drain the gauge.

  gauge: {
    name: 'moisture',            // for readers; the HUD's wording comes from the UI table
    max: 10,                     // the gauge runs 0..max
    start: 10,                   // value at level start and after a respawn (a level can override: level.startGauge)
    refill: 0,                   // per second regained while standing (or floating) in a form that does not drain. 0 = never by itself
  },

  formDefs: { clay: {...}, slip: {...}, stone: {...}, dust: {...} },   // section 4

  zones: { heatvent: {...}, frost: {...}, cold: {...}, hotfloor: {...} },   // section 5 (omit a zone type to ignore it)
  kilnFire: 'kill',              // the shared `fire` piece: 'kill' (respawn) or { feed: n } (gauge per second, harmless)

  pieces: [...],                 // every piece type a level of this element may use: shared ones you allow + your packs' types
  packs: [myPack],               // element-only mechanisms (section 7). [] if you have none
  specials: { shed(sim, p, env) { ... } },   // section 6. {} if no form has one
};
```

`pieces` is a whitelist. A level that uses a type not in it fails to load with
`"crate" is not a piece Fire levels can use`. Leave out shared pieces that only answer to another
element's forms (Fire leaves out `crate`, `ember`, `sprout`, `electrodes`, `hotfloor`). The
registry checks that every type your packs provide is listed.

## 4. Form definitions: movement parameters plus capability flags

Each entry of `formDefs` is one flat object. **Everything is optional except what its movement
model needs**; a missing flag means "no".

### Body and movement model (required)

| field | meaning |
|---|---|
| `r`, `h` | collider: an upright cylinder, radius and height in metres. A form change is refused (and remembered for 0.5 s) while the new body does not fit. |
| `move` | `'walk'` (runs, stops, jumps: liquid, film, ember, blaze, spark) - `'slide'` (momentum, low friction, rides ramps: ice) - `'float'` (no gravity, rises, steered drift: steam, smoke) |
| `speed` | top speed from input, m/s |
| `step`, `airStep` | ledge height climbed without jumping, on the ground and in the air (0 is fine) |

`walk` also needs `accel`, `decel`, `airAccel`, `airDecel` (m/s^2). Optional: `jump` (take-off
speed, m/s; absent = cannot jump), `fallMul` (extra gravity while falling), `cutMul` (extra
gravity while rising with jump released: variable jump height), `gravMul` (scales gravity itself:
blaze uses 0.385 to float), `maxFall` (fall speed limit, m/s; default 24).

`slide` needs `accel`, `friction`, `airAccel`, `maxSpeed`, `launchMin` (upward slope speed at
which it leaves a ramp crest), `waterGravity`; optional `jump`, `fallMul`, `cutMul`.

`float` needs `accel`, `drag`, `rise` (m/s upward), `riseAccel`, `windAccel` (how hard a fan drags
it to wind speed). A floating form is never "grounded": it presses nothing and cannot jump.

Gravity is 26 m/s^2, so a jump of take-off speed `v` peaks at about `v*v / 52` metres (before
`gravMul`). Measure, do not calculate: copy `tests/measure-fire.js`.

### Capability flags the CORE reads

| flag | type | effect |
|---|---|---|
| `pressesLight` | bool | presses a light `plate` while standing on it. Absent: the plate gives a "denied" cue. |
| `pressesHeavy` | bool | presses a `heavy` plate too |
| `smashesPanes` | bool | breaks a `pane` when it hits it at the pane's speed (sideways or from above) |
| `pushesCrates` | bool | shoves a `crate` while grounded (capped at 2.4 m/s) |
| `wallBounce` | bool | bounces a little off walls it hits hard |
| `passesGrate` | bool | goes straight through `grate` pieces |
| `passesSlot` | bool | goes straight through `slot` floors (drops between the slats) |
| `floats` + `floatDepth` | bool + m | floats on a `current` with its feet `floatDepth` under the surface, is carried by its flow, swims at 60 % speed, can jump out |
| `sinks` | bool | (with `waterGravity`) sinks through a `current` slowly, with a splash |
| `dousedByWater` | bool | a `current` it touches respawns it (cause `'water'`) |
| `windCarry` | number | carried sideways at this fraction of a fan's strength (liquid 0.75, ember 0.5, blaze 1.3; absent = fans do not move it). Float forms are dragged to wind speed regardless. |
| `updraftAccel` | number | m/s^2 of lift per m/s of upward fan strength |
| `conducts` | bool | closes `electrodes` while lying between them |
| `douses` | bool | puts out `ember` piles by touch |
| `waters` | bool | grows `sprout`s by coming near |
| `drain` | number | gauge spent per second while in this form. At 0 the hero falls back to the default form (cause `'gauge'`); if the default form is *bigger* it waits until that fits. |
| `minStart` | number | gauge needed to switch into this form voluntarily (required when `drain` is set; refusal reason `'gauge'`) |
| `special` | string | name of this form's special in the element's `specials` (section 6) |
| `sfxEnter`, `sfxLeave` | string | SFX played when the hero becomes this form; if the new form has no `sfxEnter`, the old form's `sfxLeave` is played instead (how the default form sounds on return) |

To add a core flag: read it where the behaviour lives (`p.caps.myFlag` - `p.caps` is always the
current form's definition), default it to "off", add a row here, and test both a form that has it
and one that does not. `p.caps` is also what collision uses: a solid with `pass: 'passesGrate'`
lets through any body whose caps have that flag set.

### Flags read by packs

A pack reads whatever flags it likes from `p.caps`. The two existing packs define these, and a
new element can reuse the pieces just by setting them:

| flag | pack | effect |
|---|---|---|
| `water: { pool, drip, spray }` | hazards | how the form meets `pool`, `drip`, `sprinkler`. Each is `'die'`, `'ignore'`, `{ boil: cost }` (pool), `{ evaporate: cost }` (drip), `{ drain: perSecond }` (spray) or `{ to: 'form', back: true }` (become that form; `back` shoves it out of the water). No `water` flag at all = water does nothing to this form. **Clay: `pool: { to: 'slip' }` gives "pools soak it", dust: `{ to: 'clay' }`.** |
| `ignites` | fire | lights lanterns, braziers and fuses by touch |
| `burns` | fire | sets `wood` alight by touch (and is paid its `fuel`) |
| `melts` | fire | melts `iceblock` and `wax` by touch |
| `tripsHeat` | fire | trips `heatsensor` |
| `sparksGas` | fire | sets off `gas` by touch |
| `ridesWires` | fire | rides a `wire` from a `terminal` |
| `powers` | fire | makes a `terminal` emit while standing on it |
| `blastScale` | fire | how hard a gas blast throws it (default 1) |

## 5. Zones, kiln fire, running water

The four shared zone pieces (`heatvent`, `frost`, `cold`, `hotfloor`) do nothing by themselves:
`zones[type]` says what each does to *your* element. A reaction is an object with any of:

| field | effect while the hero is inside the zone |
|---|---|
| `force: 'form'` | the hero is turned into that form (as soon as it fits) and no other form can be chosen (refusal reason `'zone'`) |
| `fill: true` | (with `force`) the gauge is held full |
| `hold: true` | the gauge does not drain |
| `demote: { from: 'to' }` | a hero in form `from` is turned into `to` |
| `ifFits: true` | a demotion waits until the new form fits (use it when `to` could be embedded where `from` passes, e.g. inside a grate) |
| `refuse: { form: 'reason' }` | that form cannot be chosen inside; the denied event carries your reason string |

Water: `heatvent: { force: 'steam', fill: true }`, `frost: { force: 'ice' }`,
`cold: { demote: { steam: 'liquid' }, ifFits: true, refuse: { steam: 'cold' } }`,
`hotfloor: { demote: { ice: 'liquid' }, refuse: { ice: 'hot' } }`.
Fire: `heatvent: { hold: true }`, `frost: { demote: { blaze: 'ember' }, refuse: { blaze: 'frost' } }`,
`cold: { demote: { smoke: 'ember' }, refuse: { smoke: 'cold' } }`.
For Clay's kiln `heat` zones that fire it, the shared `heatvent` with `{ force: 'stone' }` may be
all you need. The registry rejects a reaction that names a form the element does not have.

`kilnFire` decides the shared `fire` piece: `'kill'` or `{ feed: n }`.
The shared `current` piece (running water) acts through the form flags `floats`, `sinks` and
`dousedByWater`.

## 6. Specials

A form with `special: 'name'` gets `specials.name(sim, p, env)` called when the player presses
that form's button while already in it. Return `false` to refuse (the player gets the "denied"
cue, event `{ type: 'denied', reason: 'special' }`); anything else means it happened, and the sim
emits `{ type: 'special', name, form, x, y, z }` for the renderer and audio. Inside:

- `p` is the player (`p.x p.y p.z p.vx p.vy p.vz p.grounded p.gauge p.form ...`). You may set its
  velocity. `p.airSpecial` is yours to use for "once per time in the air": the core clears it on
  every landing and respawn.
- `sim.addGauge(n)` adds to (or with a negative number takes from) the gauge, clamped.
- `sim.sfx(name)` plays a sound at the hero; `sim.ev({ type: 'burst', kind: '...', x, y, z })`
  tells the renderer.
- `sim.launch(vx, vy, vz)` throws the hero (the horizontal part rides on top of player control
  until it lands or hits a wall).
- A special that makes a piece (Stone's shell) should keep that piece in your pack's lists, so
  the pack's hooks move it, weigh plates with it and draw it. `ctx.makeCrate` (section 7) builds
  a free rigid box the core already knows how to drop, carry on movers and weigh plates with.

Fire's only special is Blaze's **flare** (`src/sim/elements/fire.js`): 2 heat, sets the upward
speed to 4.4 m/s, once per airtime.

## 7. Packs: an element's own pieces

A pack is one object with a list of piece `types` and optional hooks. The loader and the sim call
the hooks at fixed points of the tick; an element with `packs: []` (Water) costs nothing.
Copy `src/sim/packs/hazards.js` (three simple pieces) before reading `fire.js` (twelve).

```js
export default {
  name: 'clay',
  types: ['mould', 'piston', ...],

  init(L, ctx) {},              // once per level, before pieces: create your lists (L.moulds = [] ...)
  build(type, def, p, c) {},    // once per piece of one of your types: validate `def`, fill the runtime piece `p`
  finish(L, ctx) {},            // once, after all pieces: cross-references (wire -> terminals), final validation
  settle(sim) {},               // once, at t = 0: put things in the state their signal starts in; add fields to sim.player
  actuators(sim, dt) {},        // every tick, BEFORE crates and the hero move: timers, motion, anything driven by signals
  control(sim, p, inp, dt) {},  // every tick: return true to take the hero over completely this tick (riding a wire)
  hazards(sim, p, env, dt) {},  // every tick, before the hero moves: return true if you respawned the hero
  triggers(sim, alive, dt) {},  // every tick, AFTER the hero moved: touch tests, and S.emit(...) for your signals
  respawn(sim, cause) {},       // the hero respawned (cause 'restart' = the player pressed R)
  teleport(sim) {},             // debug teleport: drop any state tied to where the hero was
  fingerprint(sim, out) {},     // push your dynamic state onto `out` (determinism tests)
};
```

**`build(type, def, p, c)`** - `p` already has `{ type, id, index, def }`. `c` gives you:

| helper | does |
|---|---|
| `c.pf(msg)` | throw a load error that names the level, the piece index, id and type |
| `c.box()` | read and normalise `def.box` into `p.box`, grow the level bounds |
| `c.thin(box)` | reject a solid thinner than 0.1 m |
| `c.vec3(v, name, c.pf)`, `c.num(v, default)` | validated readers |
| `c.onNode()` | compile `def.on` into a signal node (or null); read it later with `sim.signals.read(node)` |
| `c.emit(required)` | declare `def.emit` as a channel this piece raises; returns its name (or null) |
| `c.solid(p, 'box', box, extra)` | add a collision solid owned by `p`; returns it. Set `solid.active = false` to remove it, change `y1` etc. to move it and set `solid.dy` (and `dx`, `dz`) to how far it moved THIS tick so riders are carried. `extra.pass: 'flagName'` lets forms with that flag through. |
| `c.makeCrate(p, pos, size)` | make `p` a free rigid box (falls, rides movers, weighs plates, appears in `L.crates`). Set `p.gone = true` to take it out for good. |
| `c.grow(box)` | include a box in the level bounds (camera, default kill height) |
| `c.L`, `c.E`, `c.signals`, `c.fail`, `c.where`, `c.minSolid`, `c.dirs` | the level being built, the element, the signals, level-wide error, "piece #3 (gas)", 0.1, direction vectors |

Rules for hooks:

- **Signals**: raise a channel with `sim.signals.emit(name)` *every tick it is true*, in
  `triggers` (that is when the core's own triggers emit; signals are evaluated right after).
- **Touch tests**: `sim._bodyInBox(p, box, marginXZ, marginY)` (negative margins reach further
  out). Test capability flags (`p.caps.myFlag === true`), never `p.form`.
- **Killing the hero**: `sim.respawn('yourCause')` and return true from `hazards`.
- **Events and sound**: `sim.sfx(name, intensity, x, y, z)`; `sim.ev({ type: 'burst', kind, x, y, z, piece: p.index })`.
  The renderer's piece views listen for the burst kinds (section 10).
- **Checkpoints of your own** (Fire's brazier): set `sim.checkpoint = piece` (clear the old one's
  `current` flag), emit `{ type: 'checkpoint', index: piece.index, x, y, z }`, and give the piece
  `pos` and optionally `fullGauge: true` (a respawn there refills the gauge).
- **Never softlock**: anything the hero can use up must come back on respawn (Fire's coal) or be
  re-triggerable (fuses with `regrow`, gas pockets that refill).
- Deterministic only: no `Math.random`, no time of day. Everything is a function of ticks.

## 8. UI table, icons, hint tokens

`src/ui/elements.js` has one entry per element: `name`, `hero`, `campaign`, `pitch` (one line,
<= 48 characters, for the title card), `tagline`, `accent` / `accentDeep` (CSS colours), four
`forms` in button order (`id`, `label`, `button` = the word touch hints use, `color`, optional
`special`), `gauge: { name, meter }` (`meter: true` draws a bar of its own above the form
buttons; do that when the gauge does not refill by itself), `collectible: { one, many, label }`,
`deaths` (the statistic's label on the level-complete panel) and `win` (the banner).

From that table the HUD builds its form bar and touch grid, the menus build the title card, the
level-select tab and the level-complete panel, and `src/ui/prompts.js` **generates the hint
tokens**: `{formId}` -> "press 3" / "tap the stone button" / "press B", and `{special}` -> the
same plus "again". So level hints for Clay may use `{clay} {slip} {stone} {dust} {shed}` today.
`tests/campaigns.test.js` refuses a hint that uses another element's token.

Icons are inline SVG strings in `src/ui/icons.js`: `ICONS[formId]` for each form (48x48,
`currentColor`), `HERO_ICONS[element]` (the portrait), `COLLECTIBLE_ICONS[element]` (full and
empty), `GAUGE_ICONS[element]`. Form colours in the form bar are CSS: `.form-<id>` and
`.form-<id>.active` in `src/ui/ui.css` (Clay's are there).

The HUD needs nothing else: `hud.setLevel(name, elementId)` (called by `main.js`) switches
everything, and the gauge comes from the sim (`sim.G.max`, each form's `drain` and `minStart`).

## 9. Hero view

`src/render/hero/base.js` (`HeroView`) owns everything the heroes share: the two procedural eyes
and where they look (toward the camera in three-quarter view, back over the shoulder when running
away, at interesting things when idle), blinks and expressions, the cross-morph between bodies,
squash-and-stretch spring, the form-change ring, the mark straight below (a jump aid), the
see-through silhouette behind walls, and pop-in / pop-out. Read its header comment: it lists the
hooks. A subclass supplies:

```js
export class DabView extends HeroView {
  constructor(particles, prints) {
    super(particles, prints, {
      forms: ['clay', 'slip', 'stone', 'dust'],
      formColors: { clay: [r, g, b], ... },        // 0..1; used for the light it throws and by your bursts
      lid: { clay: 0x..., ... },                   // eyelid colour per form: the body's own colour
      eye: { w: 0.11, h: 0.14, d: 0.07,            // half-extents of an eye, metres
             white: [r, g, b], iris: [r, g, b], dark: [r, g, b], outline: [r, g, b] },
      ghost: 0x...,                                // silhouette colour
      turn: { stone: 5 },                          // optional: how fast a form's body turns (default 12)
      mark: { color: [r, g, b], additive: false }, // the mark below: a dark shadow, or (additive) a pool of light
    });
    // build one Object3D per form, then:
    this.addBody('clay', mesh);                    // opts: { shadow, ghost: 'all' | 'first' | 'none', ghostScale }
    ...
    this.timed.push(material, ...);                // ShaderMaterials that want uTime / uFlash / uLightDir every frame
    this.finish();                                 // builds the eyes, ring and mark; throws if a form has no body
  }
  poseBody(k, body, s, target, b, c) {}            // per visible body per frame: scale by s (morph x pop), squash, lean
  afterBodies(c) {}                                // per frame: uniforms, puffs, flames
  face(form, c) { return { ey, ez, ex, tilt, es, toe }; }   // where the eyes sit on that body (metres; es = eye scale)
  mood(form, p, c) { return { frozen, lowGauge, low, order }; }   // expression inputs; order = eye renderOrder
  trails(c) {}                                     // particles left behind (this.emitAcc is a timer you reset)
  heroEvent(e, sim, P, p) {}                       // bursts for 'form', 'special', 'burst' (jump, land, yours), 'respawn', 'fuel'
  groundMark(form, h, c) { return { size, alpha }; }
  light(form, p, c) { return { color, power, range }; }   // the one hero light takes this (Mote: 14; Cinder: 6..26)
  interests(L, consider) {}                        // optional: things your hero glances at (call consider(pos))
}
```

Requirements, checked by `tests/ui-elements.test.js` for every element that has levels: a body
for each of the element's forms, only the current form's body visible after the morph, the eyes
placed (finite, above the feet) for every form, a light and a ground mark for every form.

Design rules that made Mote and Cinder read on a phone: eyes about a third of the body's width
each, on the camera-facing side, never hidden by the body's own effects (`mood().order` 16 draws
them after puffs and flames); a silhouette that changes clearly per form; no more than about
four draw calls per body. Respect `c.rm` (reduced motion): no jitter, slower sway, fewer
particles. The renderer adds no light for a hero: it has one non-shadow `PointLight` that takes
`light()`.

Register the class in `src/render/hero/index.js`. An element without a hero view is drawn as
Mote rather than not at all, which is useful for a first playtest and fails the test above.

## 10. Piece views and themes

`src/render/world-fire.js` is the pattern: one exported `build<Name>Views(ctx)` that returns at
once when the level has none of its lists, registered in `PACK_VIEWS` in `src/render/world.js`.
`ctx` is `{ sim, L, T, theme, P, G, fx, pool, decor, glow, group, views, own, handlers, outline, blocks }`:

- `decor` / `glow`: the level's merged metalwork and always-glowing geometry (`GeoBuilder`).
  Anything static goes here and costs **no draw call**.
- `fx` + `pool(centre, radius, colour, strength, slot)`: baked light pools, beams and volumes
  whose brightness you drive per frame through `fx.dyn[slot]` (`fx.slot(initial)` reserves one).
- `P` particles (`P.spawn`, `P.burst`), `G` glow sprites (`G.add` returns a handle you mutate).
- `views.push({ update(dt, alpha, time) {} })`: follow sim state; interpolate with `alpha`.
- `handlers.push((e) => {})`: react to sim events (your `burst` kinds).
- `own(obj)`: dispose it with the level. `group.add(mesh)` for your own meshes.

**Budget: a level must stay at or under about 48 draw calls** on high quality including the
shadow pass (`__dew.stats().drawCalls`). Fire spends at most five (six with shadows) on all its
pieces together by instancing: one `InstancedMesh` for every box-like changing thing (kind and
progress in a per-instance attribute, painted in the fragment shader), one for small glowing
bits, one merged mesh for all cords, one for all water surfaces. Do the same: count kinds, not
pieces.

Do not call `renderer.compile(scene)` or otherwise link shader programs you may not draw: a
program that is linked and then deleted (when the level is disposed) without ever being drawn
makes Chrome log `GL_INVALID_VALUE: glGetProgramiv` warnings. See `Renderer._warmFade`.

**Themes** (`src/render/themes.js`): add your names to `THEME_NAMES` and an entry each to
`THEMES` with every key the existing ones have (`tests/themes.test.js` lists them: fog, sky,
hemi, key, surfaces for all six block materials, trim, lamp, ambient, backdrop, ...). `ambient`
is one of `'drips' | 'dust' | 'embers'` and `backdrop` one of `'works' | 'loft' | 'kiln'` unless
you add new ones in `renderer.js` / `backdrop.js`. New surface textures are painters in
`textures.js` (`PAINTERS`); `slabs({ seed, bg, tones, ... })` paints a slab floor in any palette.
An unknown theme name falls back to `'slip'`, silently, so `tests/campaigns.test.js` checks that
each level's theme exists.

## 11. Audio

`src/audio.js` already knows all three elements. The game calls, in this order (`src/main.js`):
`audio.setElement(sim.element.id)` whenever a level is loaded, **then** `audio.setForm(form)`
(a form name only means something inside its element), and `audio.playSfx(name)` for every
`sfx` event the sim emits. So an element's sounds are chosen in the sim: form changes through
`sfxEnter` / `sfxLeave`, everything else through `sim.sfx('name')` in your pack. Use the names
listed in DESIGN.md and DESIGN-ELEMENTS.md ("Audio"); an unknown name is ignored by the audio
module, silently.

## 12. Save

Nothing to do. Level results for every element live in the one `levels` map under their ids, and
the two optional fields `element` and `lastBy` already accept `'clay'`
(`src/save.js`, `tests/save-elements.test.js`). Never add a field without a test that an old save
still loads, and never change what an existing field means.

## 13. Levels and registry

A level names its element: `element: 'clay'` (absent means water - the twelve published water
levels have no such field and must not gain one). Level ids are `<prefix>NN` in play order
(`c01` ...). In `src/levels/index.js` import each level and append it to
`campaigns.clay.levels`; the chapters are already there. `getLevel`, `nextLevelId` and
`levelIndex` work per campaign: "next" never leaves a campaign. The title card, the level-select
tab and the progress counts follow from the registry.

`level.startGauge` (0..max) overrides the element's starting gauge for one level.

## 14. Tests

**You get these by registering** (they loop over every element / every non-water campaign):

- `tests/elements.test.js` - the definition's schema; the engine core names no form or element.
- `tests/ui-elements.test.js` - UI table matches the sim (same forms, same order, same specials);
  a token per form and special for all three input methods; a hero view with a body, face, light
  and ground mark per form; themes exist.
- `tests/campaigns.test.js` - for every level: loads with no warnings, exactly 3 collectibles, at
  least one checkpoint, hint wording (tokens only, the element's own, <= 118 characters on every
  input method), stable spawn, idle 20 s is safe, `solve` and `solveAll` in
  `tests/solutions/<id>.js` reach the exit without a death, deterministically.
- `tests/golden-water.test.js`, and every older water test - must stay green, untouched.

**You must write** (copy the Fire files):

- `tests/<el>-forms.test.js` - per form: speed, jump height and length, the gauge (drain per
  second, what happens at empty, `minStart`), every flag it has *and a form that lacks it*, its
  reaction to each shared piece you allow (plates, fans, grates, slots, zones, kiln fire, running
  water), the special (fires, costs, is refused when it should be), determinism.
- `tests/<el>-pieces.test.js` - per piece: the form that should trigger it does, the others do
  not; timings equal the documented defaults; signals; what happens on respawn; loader errors.
- `tests/levels-<ids>.test.js` - "cannot be skipped": for each gate of each level, the wrong
  forms fail and nothing can be jumped, floated or walked around. Use `at()` and `hold()` from
  `tests/lib/fire.js`.
- A `tests/measure-<el>.js` (not a test: a tool) that prints the design numbers LEVELS.md quotes.

Helpers: `tests/lib/mini.js` builds a flat test level (`run(pieces, { element: 'clay' })`),
`tests/lib/play.js` is the scripted player (`r.special()` presses the current form's button;
`r.form(x)` refuses to press the button of the form you are in when that would fire a special).

**Mutation-check your tests**: break each behaviour on purpose, one at a time (water does not
kill, the gauge does not drain, the special is free, a piece answers to the wrong form ...) and
confirm `node tests/run.js` fails every time. Fire's list of thirty is in the final report of
the Fire work; a test suite that lets a broken rule through is the usual way an element rots.

## 15. Rules that keep Water safe

- Do not edit `src/sim/elements/water.js`, the water levels, their solutions or the older tests.
- Do not rename the save key, a level id, a form name, a piece type or an SFX name.
- If you touch `sim.js`, `collide.js` or `level.js`: add a flag with a default that changes
  nothing, run `node tests/run.js golden`, and keep the diff small enough to read.
- New shared numbers go in the element or pack that owns them, not in `src/sim/constants.js`
  (those are Water's and the engine's).
