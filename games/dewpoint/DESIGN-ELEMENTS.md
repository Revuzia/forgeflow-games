# DEWPOINT — three elements (extension to DESIGN.md)

DESIGN.md still applies in full (hard rules, look, architecture, save key). This file adds
two more playable elements. The player picks an element on the title screen and plays
that element's own 12-level campaign. Same kiln works, same engine, different body,
different rules, different puzzles.

| Element | Hero | Campaign | Level ids | Status |
|---|---|---|---|---|
| Water | **Mote**, a drop | The Wet Road | `l01`..`l12` (published — never rename) | shipped |
| Fire | **Cinder**, a live coal | The Lit Road | `f01`..`f12` | new |
| Clay | **Dab**, a thumb of clay | The Thrown Road | `c01`..`c12` | new |

Water's levels, physics numbers, tests and save data must keep working unchanged. Every
water test that passes today must still pass, untouched.

## Principles
- An element is DATA: an element definition lists its four forms; each form is a set of
  movement parameters plus capability flags (e.g. `heavy`, `passesGrate`, `passesLowGap`,
  `blownByFan`, `pressesLight`, `pressesHeavy`, `floatsUp`, `sinks`, `conducts`,
  `ignites`, `burns`, `climbsRough`, `immuneHeat`, `dousedByWater` ...). Mechanisms react
  to flags, never to a hard-coded form or element name. Water is re-expressed in this
  scheme with byte-identical behaviour (its scripted solutions are the regression proof).
- Each element must feel like a different game in the hands, not a reskin: different
  default movement, a different "gauge" economy, a different relationship to the hazards.
  What kills one element feeds another.
- Levels belong to exactly one element (`element: 'water'|'fire'|'clay'`, default
  `'water'`). A level may only use pieces that make sense for its element.
- Controls are identical across elements: move, jump, four form buttons. One addition:
  pressing the button of the form you are ALREADY in triggers that form's *special*, if
  it has one (water has none, so water is unchanged).

## Fire — Cinder
A fist-sized glowing coal with two bright eyes. Warm oranges against the cool night;
Cinder is a moving light source (cheap: emissive + light pool, no extra shadow light).
Fire's economy is **heat**: a gauge that every strong form spends and that only fuel
(braziers, coal scuttles, burning something) refills. Water is death.

| Form | Move | Does | Weak to |
|---|---|---|---|
| **Ember** (default) | nimble run, good jump | lights lanterns, braziers and fuses by touch; safe, spends no heat | water (pool, drip, sprinkler) = respawn |
| **Blaze** | slower, tall flame, slight float on its own updraft (long gentle jumps) | burns wooden planks/crates/rope away, melts ice blocks and wax, trips heat sensors, boils pools into passable steam for a moment | drains heat fast; fans push it hard; frost zones force it back to ember |
| **Smoke** | drifts, rises until it meets a ceiling then slides along it | passes grates, carried by fans, ignores plates; can't light anything | heat gauge drains; sprinklers knock it down to ember |
| **Spark** | tiny, very fast, short hop | rides wire rails from terminal to terminal, fits pinholes, sets off gas pockets (blast opens weak walls / launches Cinder), powers a machine while sitting on its terminal | drains heat fastest; can't press any plate; any water |

Fire-only pieces: `wood` (burnable block/plank/crate/rope), `fuse` (burns along its
length, fires a signal at the end — timing puzzles), `lantern`/`brazier` (lit = signal
source; braziers refuel and act as checkpoints), `iceblock`, `wax` (melts and lowers what
stands on it), `pool`/`drip`/`sprinkler` (water hazards, drips are timed), `wire`
(spark rail between `terminal`s), `gas` (pocket), `heat sensor`, `coal` (heat pickup).
Collectible: 3 **glow-stones** per level (stored in the same `shards` array).

## Clay — Dab
A soft thumb-pressed lump with two pressed-in eyes, cream/terracotta. Clay's economy is
**moisture**: too wet and it runs, too dry and it crumbles, fired and it can never be
soft again until it is soaked. The world changes Dab's state as much as the player does.

| Form | Move | Does | Weak to |
|---|---|---|---|
| **Clay** (default, plastic) | medium run, modest jump | sticks: climbs `rough` walls and hangs under rough ceilings for a few seconds; can be pushed by pistons without harm | kiln heat zones fire it (forced Stone); pools soak it (forced Slip) |
| **Slip** (liquid clay) | fast downhill, slow uphill, no jump | pours through floor slots and low gaps; fills a `mould` — leave the mould and a cast block stays behind | fans dry it (forced Dust) |
| **Stone** (fired) | heavy, slow, tiny jump | presses heavy plates, smashes panes by falling, walks through fire and hot floor, sinks. **Special:** shed a shell — leaves one stone block where Dab stands (pushable, weighs plates, a step up); shedding a new one crumbles the old | can't climb, can't be un-fired except by a pool |
| **Dust** | light cloud that FALLS slowly and is carried far by fans | pours down through grates, rides fan streams across chasms, ignores plates | any water turns it back to Clay; settles and reforms as Clay when its gauge runs out |

Clay-only pieces: `rough` surface flag on walls/ceilings, `mould` (+ the cast block it
makes), `piston`, `pool` (soak), kiln `heat` zones that fire, `shell` blocks, `sieve`
(grate that only dust falls through), `wheel` (spinning potter's wheel platform that
flings by form weight). Collectible: 3 **maker's marks** per level (same `shards` array).

## Campaign shape (each new element)
12 levels in 3 chapters of 4, same pacing rules as Water: one idea taught safely, tested,
then combined; 3 collectibles; checkpoints; input-aware hints; a scripted solvability
proof plus "cannot be skipped" tests per level. Chapters:
- Fire: 1 *Pilot Light* (ember, lighting, fuses, water as danger) · 2 *Flue* (blaze,
  smoke, wood, ice, fans) · 3 *Live Wire* (spark, wires, gas, heat economy, finale).
- Clay: 1 *Wedging* (clay climbing, slip, slots) · 2 *Bisque* (stone, shells, heat zones,
  plates) · 3 *Glost* (dust, fans, moulds, wheels, finale).
Each campaign has its own theme set for the renderer (fire: `pilot`, `flue`, `wire`;
clay: `wedge`, `bisque`, `glost`) with fallback like the existing themes.

## UI
Title screen: choose element (three large cards with the hero, a one-line pitch and that
campaign's progress), then Play/Continue and Levels for that element. The HUD form bar,
gauge, hints, icons, colours and level-complete wording follow the active element.
Level select shows only the chosen element's chapters, with an easy way to switch.

## Save (additive only — key stays `dewpoint.save.v1`)
Existing fields keep their meaning. Level results for all elements go in the existing
`levels` map under their ids. New optional fields: `element: 'water'|'fire'|'clay'`
(last chosen; default `'water'`) and `lastBy: { water?: id, fire?: id, clay?: id }`.
`last` keeps its meaning (last level played, any element). A save written by the
water-only version must load with nothing lost; a save written by the new version must
not break if read by code that ignores the new fields.

## Audio (additive to the Audio API)
`audio.setElement(el)` selects the movement/ambience family; `setForm(form)` then takes
that element's form names. New SFX names: `ignite, flare, smoke_puff, spark_zip,
wire_ride, fuse_burn, wood_burn, ice_melt, wax_melt, gas_blast, extinguish, coal,
squish, slip_pour, fire_harden, shell_shed, shell_crumble, dust_puff, soak, mould_cast,
piston, wheel_spin, climb_stick`. All existing names and behaviour unchanged.
