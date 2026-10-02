# WOBBLEHOARD — build contract (vertical slice 1)

Working title. The slice: **one original squishy, DOLLOP, that you can poke, squish, pull and release, in real-time 3D
soft-body physics, with original procedural sound.** Everything else (collection, blend, trade) is a later module and
is outlined in `COLLECTION.md`, `MERGE.md`, `TRADE.md`; the slice only has to leave the right seams for them.

The typed seams are in `src/contracts.ts` (and `src/core/genome.ts`). This file is the prose that goes with them.
If the two disagree, `src/contracts.ts` wins; fix the prose.

## 1. Stack (and why)

| Choice | Why |
|---|---|
| **Three.js 0.186 + TypeScript + Vite** | The repo's house stack for 3D games (BLOCKTOOTH, HIT PARADE, DYEFIELD); plays instantly in the portal iframe on desktop *and* phones with no download or export step. WebGL2 `MeshPhysicalMaterial` gives transmission, thickness, attenuation and clearcoat out of the box = translucent jelly. |
| **Custom soft body (XPBD + shape matching), ~600 particles on the CPU** | Real volume-preserving squash-and-stretch, deterministic, testable under plain `node`, no WASM. Rapier is a rigid-body engine; Godot/Unity would add a 20-50 MB web export for a feature (soft body) they do not ship out of the box either. |
| **WebAudio synthesis, zero audio files** | Original by construction, tiny, and every voice can be driven by physics (pitch from compression, level from speed). Same voice code renders offline for the audio probe. |
| Blender | Not needed: the body is procedural (icosphere + genome-driven rest shape). Blender stays the tool for *future* hand-authored species shells. |

## 2. File ownership (lanes never edit each other's files)

| Lane | Owns | Does not touch |
|---|---|---|
| PHYS | `src/physics/**`, `_harness/probe_softbody.ts`, `_harness/probe_*physics*.ts` | everything else |
| AUDIO | `src/audio/**`, `_harness/probe_audio.mjs`, `_spec/SOUND.md` | everything else |
| RENDER | `src/render/**`, `_harness/browser_render.mjs` | everything else |
| SHELL | `src/main.ts`, `src/input/**`, `src/ui/**`, `src/core/settings.ts`, `src/core/save.ts`, `index.html`, `_harness/browser_*.mjs` (except render) | physics, audio, render internals |
| DOCS | `_spec/DESIGN.md`, `COLLECTION.md`, `MERGE.md`, `TRADE.md`, `README.md`, `public/game_meta.json` | `src/**` |

Shared and frozen unless a lane adds an optional field and reports it: `src/contracts.ts`, `src/core/genome.ts`, `src/core/rng.ts`.

## 3. Conventions

* TypeScript `strict`, `erasableSyntaxOnly` (no `enum`, no `namespace`, no constructor parameter properties) so files run
  under plain `node` type-stripping. **Relative imports carry the `.ts` extension.** `import type` for types
  (`verbatimModuleSyntax`).
* No dependencies beyond `three`. No third-party assets of any kind: no audio files, textures, models, fonts, HDRIs.
  Everything is procedural. (The only binary in the folder is the cover `public/thumbnail.png`, rendered from the game itself.)
* `src/physics/**` imports nothing from `three` or the DOM, and never calls `Math.random()` or `Date.now()`: same genome +
  same seed + same input script = identical `stateHash()`.
* Hot loops use typed arrays and allocate nothing per step. The physics step budget is in section 6.
* UI strings are plain English, short, and original. No reference to any other game, brand or character.
* Commit hygiene: each lane leaves `npm run typecheck` green for its own files. Do not run `git commit`; the orchestrator commits.

## 4. Physics contract (PHYS)

`export class SoftBody implements SoftBodyLike` in `src/physics/softbody.ts`, constructed from a `Genome`
(`new SoftBody(genome, { detail?: number, seed?: number })`). `detail` is the icosphere subdivision level: 3 = 642 verts
(default), 4 = 2562 verts (offline/quality only).

Required behaviour:

* **Rest shape**: DOLLOP is a squat blob with a soft swirl-peak on top (whipped-cream dollop): a sphere with rest radius
  ~0.5 x `lerp(0.8, 1.25, genome.size)`, flattened ~0.8 in Y, plus a narrow raised peak at +Y. The peak is the secondary-motion
  showpiece: it must flop and recover. The shape is a pure function of (species, direction) so future species slot in.
* **Squash and stretch emerge from physics**: volume is (softly) conserved, so pressing a dent makes the rest bulge;
  pulling a lobe thins the neck. No scale hacks. `metrics.volume` stays within 0.85..1.15 under any input and returns to
  1.00 +/- 0.015.
* **Recommended technique** (free to deviate if the gates hold): particles = mesh vertices; XPBD with small substeps
  (e.g. 6-10 substeps, 1 iteration each); edge-distance constraints (compliance from `genome.stretch`); a global
  volume/pressure constraint; global shape matching toward the rest shape with a robust polar-decomposition rotation
  (stiffness from `genome.firmness`); internal-velocity damping relative to the rigid motion (from `genome.bounce`, so it
  jiggles but the whole body is not drag-limited); table plane at y = 0 with Coulomb friction; finger = kinematic sphere
  that projects penetrating particles out; pull = soft attachment of a Gaussian neighbourhood to a world target.
* **Fingers**: `fingerDown` places the tip just outside the surface along `dir`; the body eases the tip toward the
  `fingerPressure` target depth (critically damped, response ~80 ms) so a quick tap is a poke and a held press is a
  squeeze. Tip radius ~0.2 x restRadius, growing toward ~0.45 x restRadius with pressure (fingertip -> palm). `fingerMove`
  rubs along the surface. `fingerUp` retracts the tip fast (<= 60 ms) so the body springs back and overshoots.
  Two fingers = pinch; they must not tunnel through each other or invert the mesh.
* **Gravity vs float**: `gravity=false` removes gravity and adds a weak hover spring toward y ~ 1.0 x restRadius + 0.35
  with a slow bob; a finger shove then makes the body drift and ease back. Switching is instant and keeps the shape.
* **Events** (`drainEvents`): `poke` on first contact (intensity = normalised closing speed), `press` once a finger has
  held >= 0.18 s, `release` when a finger lifts while compression > 0.08, `land` on a table impact above a small speed,
  `grab`, `snap`. No event spam: at most one event per kind per finger per 50 ms.
* **Metrics** as documented on `SoftMetrics`; `strain[]` updated every step (the renderer colours the "pressure blush" with it).
* Robustness: any input sequence (random fingers, grabs, nudges, dt from 1/240 to 1/10, NaN-free inputs) must never produce
  NaN/Infinity, never invert the mesh (signed volume > 0, no particle inside the table), and the body must settle to rest.

## 5. Audio contract (AUDIO)

`export function createAudio(): SquishAudio` in `src/audio/engine.ts`, voices in `src/audio/voices.ts` written as functions of
`(ctx: BaseAudioContext, out: AudioNode, t0: number, params)` so the SAME code renders live and in an `OfflineAudioContext`.

Voices (all synthesised; **no samples, no copied waveforms; the designs are ours**):

| Voice | Character |
|---|---|
| `poke` | a soft wet "thup": ~120-260 Hz sine body with a fast downward glide + a short band-passed noise "skin" transient; 80-180 ms; intensity -> level and brightness |
| `squishStart` (held) | continuous squelch while pressed: band-passed/low-passed noise through 2-3 moving resonances ("bubbly" formants) whose centre rises with `compression` and whose level follows `|rate|`; granular little bubble ticks while it moves; silent when still |
| `release` | the "bloop" back: an upward-gliding sine pair + a damped wobble (amplitude-modulated 12-30 Hz, decaying) whose depth and pitch come from the compression that was released; 200-450 ms |
| `land` | a low soft "plop"/thud on the table, 60-140 ms |
| `pop` | a bubble pop: ~2-5 ms click + a quick upward-chirped sine "blip" + tiny air noise; size shifts pitch |
| `blend` | a blender: motor whirr that spools up (saw/pulse through resonant filter, rising then wavering), liquid slosh (filtered noise with slow LFO), occasional glassy clinks, then a rising "finished" flourish (soft bell cluster); ~2.5-4 s |

Every voice takes a `pitch` ratio and varies +/-3% per call (seeded round-robin, never identical twice). Master chain:
`voices -> bus gain -> soft clip/limiter (DynamicsCompressor + waveshaper safety) -> master gain -> destination`, plus an
analyser for the harness peak readout. `squishBoost` adds up to +9 dB to poke/squish/release, still under the limiter.
No clicks: every voice has attack/release ramps. Respect autoplay policy: nothing is created until `unlock()`.
`_spec/SOUND.md` documents each voice's recipe and the measured numbers from the audio probe.

## 6. Quality gates

| Gate | Check | Pass |
|---|---|---|
| G0 | `npm run typecheck`, `npm run build` | clean; `dist/` < 1.2 MB total (three tree-shaken) |
| G1 | `_harness/probe_softbody.ts` (node) | volume within 0.85..1.15 under max squeeze and recovers to 1 +/- 0.015 in <= 3 s; shape returns to within 3% of rest radius RMS (rotation/translation removed) <= 4 s after release; settles (kinetic < 0.02) <= 5 s; underdamped (>= 2 visible height oscillations after a hard release, `bounce` high) with decay time constant 0.5-2.0 s; the peak flops (peak tip displaces >= 25% restRadius from rest under a side poke); fuzz: 200 runs x 1500 random events, dt in [1/240, 1/10] -> 0 NaN, 0 mesh inversions, 0 table penetrations > 1% restRadius; determinism: identical `stateHash` for identical scripts; float mode: stays within 1.5 m of origin and returns to hover after a shove |
| G1p | perf in node | mean `step()` <= 2.0 ms and p99 <= 5 ms at detail 3 on this container |
| G2 | `_harness/probe_audio.mjs` (Chromium OfflineAudioContext) | every voice: peak -20..-1 dBFS, |DC| < 0.01, no sample jump > 0.25 at start/end, tail < -60 dB by the end, non-silent >= its minimum duration, two renders with different pitch/seed differ >= 3% in dominant frequency; spectrogram PNG per voice in `_harness/_renders/` (not committed) |
| G3 | `_harness/browser_*.mjs` (Chromium + SwiftShader) | boots with 0 console errors/warnings and 0 failed requests; canvas not blank; screenshots: rest, mid-poke, held squish, release t+80 ms / t+250 ms, pull, float mode, 6 genomes; drag-orbit works; Settings panel works |
| G4 | input | synthetic mouse and touch (incl. two-finger pinch) produce the matching `SoftEvent`s and audio voice starts via `window.__WH__.state()` |
| G5 | originality | no assets, no reference names; palette recorded; sounds synthesised; reviewer checklist in `_spec/DESIGN.md` |
| G6 | mobile | 390x844 touch emulation: no horizontal scroll, controls reachable, hint text readable |

## 7. Visual direction (RENDER, SHELL) — original, deliberately unlike pastel-kawaii shelves

* **Palette** (tokens, keep them in one `src/ui/theme.ts`/CSS vars): ink-indigo `#14102a` (background), plum `#2a1744`,
  dusk violet `#5b3a86`, felt mat `#2a2150`, sodium amber `#ffb347` (key light), cold lagoon `#59d6e6` (rim light), ember
  coral `#ff5a4d` (core glow / accents), cream `#fff1d6` (text). DOLLOP itself: translucent apricot-amber body (hue 32),
  ember-coral core.
* **Look**: a toy photographed on a dark felt play-mat under a warm softbox with a cool rim light: glossy specular
  highlights from procedural softbox panels (a tiny `PMREMGenerator.fromScene` environment built in code), translucent
  body with thickness-based absorption, glowing core that brightens when squeezed, a coloured light pool under the body
  (fake caustic) that widens when it squashes. Round, soft, readable at phone size.
* **Subsurface feel without a subsurface pass**: thickness/attenuation (transmission tiers), view-dependent rim/fresnel glow,
  core halo, and a **pressure blush**: compressed regions (`strain < 1`) saturate and warm up, stretched regions (`> 1`)
  go paler and clearer, like real jelly toys.
* **Face**: two glossy ink-dark eyes attached to the surface (they ride the squash, they are not floating), blink, follow the
  pointer, widen when squeezed, squint into happy arcs on release. Style from `genome.eyeStyle`. No mouth.
* **FX**: trapped-air bubbles that rise and pop on a fast release, glitter inside the body (positions stored as
  triangle + barycentric + depth so they ride the deformation), a ring/dust puff on landing. All cheap instanced geometry/points.
* **Quality tiers**: `high` = transmission at full res + MSAA + DPR <= 2; `med` = transmission at 0.5 res; `low` = no
  transmission (alpha-blended fresnel + core glow). `auto` samples frame time. The fine render mesh (>= ~5k verts) can be
  smoothed from the ~642-vertex sim mesh (Phong-tessellation style) so silhouettes are round.

## 8. Shell, input and settings (SHELL)

* Full-viewport canvas, DOM overlay (`#ui`), mobile-first, `touch-action: none`, safe-area insets, `dvh`.
* Boot/title card ("tap to wake it up") doubles as the audio-unlock gesture. Wordmark WOBBLEHOARD, our own typography
  (system font stack, heavy rounded weight; no web fonts).
* **Gestures**: tap = poke; press-and-hold = squish (pressure ramps ~0.9 s to full, `fingerPressure`); press then drag
  along the surface = rub; press on the body then drag *away* (> 14 px from the press point, outward) = pull/stretch
  (`grab`); drag on empty space = orbit; wheel / pinch on empty space = zoom; two fingers on the body = pinch (two
  `fingerDown`s). Keyboard: `Space` = poke the centre, `G` toggles gravity, `M` mutes. Escape closes the panel.
* **Settings panel** (gear, top-right): Volume, Louder squish, Haptics (navigator.vibrate; hidden when unsupported),
  Screen shake (0 = off; default 0 if `prefers-reduced-motion`), Gravity <-> Float, Quality. Persist to `localStorage`
  under `wobblehoard:v1:settings` with try/catch (private mode must not break anything).
* Haptics: poke = 8 ms tick, squeeze = low-rate pulse scaled by rate, release = 18 ms thump, pop = 6 ms.
* Screen shake: `release`/`land`/`poke` events call `stage.shake(intensity)`.
* HUD: wordmark, gear, a one-line hint that fades after the first interaction, and a small readout of the squishy's name.
  No score, no currency, no timers in this slice.
* URL: `?genome=<seed|g1.code>` `?float=1` `?quality=low|med|high` `?dev=1` (exposes `window.__WH__`, shows a tiny stats
  overlay) `?mute=1` `?lab=1` (sound lab: buttons for poke / squish / release / land / pop / blend, dev only).
* Errors: a boot failure shows a friendly card (what failed, "reload"), never a blank screen. WebGL2 missing = explain.
* The page pauses sim + audio when the tab is hidden.

## 9. Debug hook

`window.__WH__` (only with `?dev=1`): see `DebugHook` in `src/contracts.ts`. `step()` + `pause()` give reproducible frames.

## 10. Orchestration notes

* Each lane runs its own dev server on its own port (`npx vite --port <p> --strictPort`): PHYS 5362, AUDIO 5363, RENDER 5364,
  SHELL 5365, integration 5360. Helpers: `_harness/pw.mjs` (`startVite`, `launch`).
* Screenshots go to `_shots/` (gitignored). Reports to `_harness/_reports/` (gitignored). Audio renders to `_harness/_renders/` (gitignored).
* While a lane's collaborators are unfinished, code against `src/contracts.ts` and a local stub; never edit another lane's files.
