# DEWPOINT — design contract

An original 3D physics puzzle-platformer for the browser. You are **Mote**, a single
drop of water that has woken up inside a shut-down ceramics works at night, and you
change state — liquid, ice, steam, film — to get through it.

Genre inspiration: "play as water that changes state" platformers. This is NOT a copy of
any existing game: own name, own character, own world, own levels, own look. Do not
imitate another game's level names, layouts, character design or palette.

## Hard rules (apply to every contributor)
- No network at runtime. No external assets: every mesh, texture, sound and font is
  generated in code. The only third-party file is `vendor/three.module.min.js` (local).
- No paywall, ads, currency, analytics or tracking.
- Save key is `dewpoint.save.v1` in localStorage. It is published: never rename it, never
  change the meaning of an existing field; only add fields, and tolerate missing/corrupt data.
- Must run by opening over a plain static server (`python -m http.server`), ES modules,
  no build step.
- Must play well on desktop (keyboard + mouse) AND phone (touch, portrait and landscape,
  360x640 upward). 60 fps target on a mid phone: cap devicePixelRatio at 2, keep draw
  calls and shadow cost modest, offer automatic quality drop if frame time is poor.
- Fix real causes, verify by measurement, report honestly what is unverified.

## Look
Night-time kiln works: dark indigo/charcoal space, glazed-tile floors in deep teal and
cream, ember-orange kiln glow as the warm accent, cyan for water/Mote. Soft toon-ish
shading with one shadow-casting key light plus glow accents; fog for depth. Chunky,
readable shapes. Mote is NOT humanoid: a wobbling droplet body with two simple eyes,
whose silhouette changes clearly per form (the face must read at a glance from the default camera, on a phone: big eyes, three-quarter view, a glance back when running away):
- **Liquid**: jiggly teardrop/blob (squash & stretch from velocity), leaves fading wet prints.
- **Ice**: faceted crystal block, sharp highlights, slides.
- **Steam**: a loose cluster of soft translucent puffs, drifts up.
- **Film**: a thin flat shimmering sheet hugging the floor.
Form changes get a short morph + particle burst + sound.

## Forms (the core mechanic)
| Form | Move | Special | Weak to |
|---|---|---|---|
| Liquid (default) | run, jump (coyote time + jump buffer), air control | puts out embers, waters sprouts (grows a climbable/platform plant), carried by water currents | — |
| Ice | heavy, low friction, small jump, momentum | presses heavy plates, smashes cracked panes when fast, rides ramps, not pushed by fans, sinks, can push crates | melts back to liquid on hot floor |
| Steam | no gravity: rises slowly, steerable drift, very light | passes through grates, lifted/pushed strongly by fans and updrafts, ignores plates | limited by a steam gauge (~4 s, refills on ground as non-steam); cold zones condense it to liquid |
| Film | slow crawl, no jump | slips under low gaps, flows through floor slots, conducts between two electrodes to close a circuit | fans don't move it |

World zones can also force a state (heat vent -> steam, frost zone -> ice) so puzzles can
take choice away as well as give it. Falling off the world or touching kiln fire respawns
at the last checkpoint (fast, no lives, no penalty).

## Mechanisms (level building blocks)
Static blocks/ramps, moving platforms, light plate (any grounded form but steam), heavy
plate (ice or crate only), doors/gates driven by signals, fans/updrafts, grates (steam
only), low gaps (film only), cracked panes (fast ice), pushable crates (simple rigid
boxes), embers (block until doused by liquid), sprouts, electrode pairs, heat vents,
frost zones, water currents, hot floor, kiln fire, checkpoints, collectible glaze shards
(optional, 3 per level), exit kiln-door. Signals: any trigger can drive any actuator
through named channels with AND/OR/latch.

## Levels
Data-driven: each level is a plain JS object (id, name, spawn, pieces[], signals, hint
strings). Levels live in `src/levels/` one file each, registered in `src/levels/index.js`.
Target for v1: 12 levels in 3 chapters, each teaching one idea then combining. Every
level must be proven solvable by a scripted test (see Testing).
A short hint line shows contextually (first encounter of a mechanism), dismissible. Hint text never names a key or button: it is written with {tokens} that the HUD fills in for the input in use (keyboard, touch or gamepad), live (LEVELS.md section 4a). On a phone it is a slim translucent strip of two or three lines that lets touches through.

## Controls
Desktop: WASD/arrows move (camera-relative), Space jump, 1/2/3/4 or Q/E to change form,
mouse drag (or right stick-less auto-follow) to orbit camera, R restart from checkpoint,
Esc/P pause. Phone: left virtual stick, drag on the right half to orbit, a jump button,
four form buttons (big, thumb-reachable, show which is active and the steam gauge).
Camera: third-person follow with collision avoidance; only the player turns it (no auto-recentre). Thin walls that stand between the camera and Mote fade away in a soft dithered cut-away (so the camera keeps its distance); thick geometry still pulls the camera in - but never closer than 3 m: below that it rises (or dips) over the obstacle, orbits round it, or stays back and cuts it away, and it is never inside geometry (src/render/camera.js). Moving never turns the camera under the player: the controls follow the player's own orbit only; when the camera swings round a wall to find room, that is a small offset of the picture, not of the controls.
Gamepad support is a nice-to-have.

## Architecture (so work can be split and tested)
- `index.html`, `src/main.js` — boot, loop (fixed 1/120 s sim step, interpolated render).
- `src/sim/` — pure deterministic simulation, **no DOM, no three.js imports**: player
  controller, forms, collision (AABB/OBB vs capsule/sphere/box), crates, mechanisms,
  signals. Runs in Node for tests.
- `src/render/` — three.js scene built from the sim state; procedural meshes/materials.
- `src/ui/` — HUD, menus (title, level select with shards, pause, settings), touch controls.
- `src/audio.js` — procedural WebAudio (see Audio API).
- `src/save.js` — the only code touching localStorage.
- `src/levels/` — level data.
- `tests/` — Node tests: `node tests/run.js` runs unit tests and, per level, a scripted
  input sequence that must reach the exit in the headless sim.
- Debug hook: `window.__dew` exposing `{sim, loadLevel(id), setForm(f), teleport(x,y,z),
  completeLevel(), stats()}` (stats = fps, frame ms, draw calls) for measured verification.

## Audio API (contract between engine and audio module)
`src/audio.js` exports `audio` with: `init()` (call on first user gesture), `setMuted(b)`,
`setVolume(music, sfx)` (0..1 each), `playSfx(name, {intensity=1, pan=0}={})`,
`setForm(form)` (changes the looping ambience/movement layer), `setMusic(mood)` where
mood is `'menu'|'calm'|'tense'|'win'|null`, `suspend()`, `resume()`.
SFX names: `jump, land, splash, freeze, melt, vaporize, condense, flatten, unflatten,
plate_down, plate_up, door_open, door_close, fan, pane_crack, pane_smash, crate_push,
ember_douse, sprout_grow, spark, checkpoint, shard, respawn, level_complete, ui_tap, ui_back, denied`.
Every call must be safe before `init()` and when AudioContext is unavailable (no throw).

## Save shape (v1)
`{ v:1, levels:{ [id]:{ done:boolean, shards:number[], bestMs:number } }, last:string,
settings:{ music:number, sfx:number, muted:boolean, quality:'auto'|'low'|'high',
invertY:boolean, sensitivity:number, reducedMotion:boolean } }`
