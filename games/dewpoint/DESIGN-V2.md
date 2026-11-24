# DEWPOINT v2 — level standard and art direction

This file OVERRIDES the "Look" section of DESIGN.md and the level-length guidance in
DESIGN.md, DESIGN-ELEMENTS.md and LEVELS.md. Everything else in those files stands
(hard rules, save key `dewpoint.save.v1`, published level ids, architecture, elements).

## 1. Level standard (owner's decision)

Measured benchmark: a comparable published game in this genre has levels whose own
scripted demo runs take about 42–97 s, rising through the game; every level is one long
journey of five named areas, 5–9 checkpoints, 130–235 m of travel. Our v1 levels were
14–39 s. That is the gap to close.

**Length** — measured as the scripted reference route `solve()` in the headless sim, with
no idle waiting beyond what a mechanism forces:

| Level | `solve()` route time |
|---|---|
| Levels 1–11 of a campaign | 60–120 s (level 1 near 60, rising steadily to ~110–120 by level 11) |
| Level 12, the finale | 100–150 s |

A test in each level's test file must assert its route time is inside its band.

**Shape** — every level is a journey of 4–5 distinct **areas**, each with its own name
(`areas: [{ name, ... }]`, shown briefly on entry), its own look/props, a checkpoint at
its start, and one clear job: teach → practise → twist → combine → payoff. No area is a
corridor walk; every 10–15 seconds the player does something that matters.

**Difficulty curve** — across the twelve levels of a campaign:
- Levels 1–4 (easy): one idea per area, nothing lethal without a visible warning, the
  solution is in view when the problem is, mistakes cost seconds. A new player should
  never be stuck for more than ~20 s.
- Levels 5–8 (medium): areas combine two known ideas; order starts to matter; one
  optional harder side-route per level.
- Levels 9–12 (hard): multi-step puzzles where the player must plan (order, resource,
  timing), set-ups whose payoff is two areas later, and a finale that uses everything.
Difficulty comes from thinking, never from pixel-precise jumps, blind leaps or hidden
information.

**Unchanged** — level ids and names stay (saves are keyed by id). Collectibles stay at
exactly 3 per level with the same indices 0–2 (saved data). When expanding an existing
level, keep its existing puzzle beats as areas of the longer level and add new areas
around them; do not throw good beats away.

**Proofs** — as before, for every level: `solve`, `solveAll`, zero deaths, deterministic,
"cannot be skipped" tests for every gate, plus (where anything is permanent) a test that
the level cannot be made unwinnable. Never weaken a test to make it pass.

**Budget** — levels are now ~3× longer, so content must not cost 3× to draw: design in
areas so only one or two are in view; the renderer culls/merges by area. Target stays at
or under ~48 draw calls in any view.

## 2. Art direction: "storybook kiln works"

The v1 look (dark night, small pools of light) is retired. The owner wants the bright,
confident, hand-drawn toon style that the best games in this genre use, with clearly
better design polish in every menu and control. Our own identity — never an imitation of
another game's characters, palette, props, layouts or UI.

- **Rendering**: cel shading (2–3 flat light bands, soft-edged), bold dark ink outlines
  on heroes, props and level geometry (line weight consistent on screen, slightly
  wobbly/hand-inked, never aliased or shimmering), flat saturated colour with subtle
  painted texture (brush grain, tile and brick drawn as line-work, not photographic
  noise), coloured shadows (never grey/black), a big painted sky.
- **Light and palette**: bright and warm. Time of day gives each chapter its identity
  instead of darkness: e.g. dawn mist → golden morning → high noon → amber dusk → blue
  hour with lit windows. Water campaign leans teal/cream/coral; Fire leans
  charcoal/ember/gold with real darkness only where fire should glow against it; Clay
  leans terracotta/sage/bone. Each of the nine themes stays recognisably its own place.
- **Heroes**: Mote (drop), Cinder (coal/flame), Dab (clay). Not humanoid: no arms, legs
  or bodies copied from anything. Big expressive eyes, strong silhouette per form, ink
  outline, squash and stretch, highlights drawn as shapes.
- **FIRE MUST LOOK LIKE FIRE**: Cinder is made of living flame, not an orange blob with
  eyes. Layered animated flame tongues that lick upward and trail behind when moving,
  flicker and breathe, a hot white-yellow core grading to orange and deep red at the
  tips, flying sparks and embers, heat shimmer above, light that flickers on the
  surroundings, a scorch/glow trail. Each form is a different fire: ember = a small
  bright coal with a single dancing flame; blaze = a roaring tall bonfire; smoke = dark
  curling volumes with ember flecks; spark = a crackling white-gold star with arcs.
  Everything Cinder touches in the Fire campaign burns convincingly: wood catches,
  chars, collapses in sparks; fuses spit; braziers roar; the Fire HUD and menus feel hot.
- **UI design (must be MUCH better than typical for the genre)**: one coherent design
  system — type scale, spacing grid, colour tokens per element, corner radii, outline
  weight and drop-shadow style shared by every component; chunky tactile buttons with
  hover / press / focus / disabled states and springy micro-animation; clear hierarchy
  (one primary action per screen); nothing overlaps or truncates at any size; generous
  touch targets (≥48 px), safe-area aware; keyboard/gamepad focus navigation in every
  menu; smooth screen transitions; an element-select screen that feels like choosing a
  character; a level select that shows the journey (chapters, areas, collectibles, best
  time) rather than a grid of ids; a level-complete moment that celebrates; a HUD that
  is minimal in play and never covers the path. All drawn in CSS/canvas/inline SVG with
  system fonts styled well (no web fonts, no external assets). Respect reducedMotion.
- **Small windows**: the UI is designed for 360 x 360 and up. Below that (a narrow desktop pane, a split
  screen) it is laid out as if the window were 360 wide and scaled down as ONE unit (`--ui-scale`, set by
  `src/ui/scale.js`; down to 260 px wide stays legible), never by letting parts overflow or wrap. In CSS use
  `--uvw` / `--uvh` (the window in UI pixels), not `vw` / `vh`. A button label is one line, never broken
  inside a word. `tests/layout.test.js` builds every screen in a headless browser at 260 to 1920 px wide and
  fails on anything off screen, wrapped, truncated or overlapping (`tests/layout/audit.js` has the rules).
- **Performance is part of the art direction**: mid phone, 60 fps. Outlines and cel bands
  must be done cheaply (measure the options: inverted hull vs one screen-space edge
  pass vs shader rim) and scale down by quality tier without losing the look.
