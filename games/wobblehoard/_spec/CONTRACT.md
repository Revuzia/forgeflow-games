# WOBBLEHOARD: build contract (current build, revised 2026-10-05)

Working title. This is the contract the lanes build against **as of 2026-10-05**. It replaces the slice-1 contract of 2026-10-02: that slice (**one original
squishy, DOLLOP, that you can poke, squish, pull and release, in real-time 3D soft-body physics, with original procedural sound**) is built, and
the game is growing into a collection toy (50 species, capsules, merge, trade: [`DESIGN.md`](DESIGN.md)). Section 13 lists what changed against
the slice-1 text. Section numbers 3, 4, 6, 7 and 8 are kept from the slice-1 contract because code and probes cite them.

The typed seams are `src/contracts.ts` and the shared pure modules `src/core/genome.ts` and `src/core/rng.ts`; this file is the prose that goes
with them. **If the two disagree, `src/contracts.ts` wins; fix the prose.** The status of every module (built, wired into the app, spec only, with
the date and result of its last gate run) is kept in **one** table: [`NEXT_STEPS.md`](NEXT_STEPS.md) section 1. This file states obligations.

**Status words.** **Built**: in the tree, and its gate passed at the date given. **In progress**: a lane is changing it now (2026-10-05); the
interface written here is the target, do not depend on details that are not written here. **Planned**: specified, no code yet.

## 1. Stack (and why)

| Choice | Why |
|---|---|
| **Three.js 0.186 + TypeScript 7.0 + Vite 8.3** (`package.json`) | The repo's house stack for 3D games (BLOCKTOOTH, HIT PARADE, DYEFIELD); plays instantly in the portal iframe on desktop *and* phones with no download or export step. WebGL2 `MeshPhysicalMaterial` gives transmission, thickness, attenuation and clearcoat out of the box = translucent jelly. |
| **Custom soft body (XPBD + shape matching), about 640 particles on the CPU** | Real volume-preserving squash-and-stretch, deterministic, testable under plain `node`, no WASM. Rapier is a rigid-body engine; Godot/Unity would add a 20-50 MB web export for a feature (soft body) they do not ship out of the box either. |
| **WebAudio synthesis, zero audio files** | Original by construction, tiny, and every voice can be driven by physics (pitch from compression, level from speed). Same voice code renders offline for the audio probe. |
| **Pure TypeScript game logic** (`src/core`, `src/data`) | The same modules run in the browser, in the node probes, in the economy sim and (planned) verbatim in the server host (COLLECTION.md C-1). |
| Blender | Not needed: every body is procedural (icosphere + a rest-shape recipe from `src/data/shapes.ts`). Blender stays the tool for *future* hand-authored species shells. |

## 2. Lanes and file ownership (as of 2026-10-05)

Lanes never edit each other's files. A lane that needs a change in another lane's file asks for it through the orchestrator, or reports it.

| Lane | Owns | Status |
|---|---|---|
| PHYS | `src/physics/**`, `_harness/probe_softbody.ts`, `_harness/browser_physics.mjs`, `_harness/physview/**` | Slice: built. Round 2 (section 4.2): **in progress** |
| AUDIO | `src/audio/**`, `_harness/probe_audio.mjs`, `_harness/audioview/**`, `_spec/SOUND.md` | Slice and round 2: built (landed 2026-10-02). Round 3 (section 5.3): **in progress** |
| RENDER | `src/render/**`, `_harness/browser_render.mjs`, `_harness/renderview/**` | Slice: built. Round 2 (section 7.3): implemented in `src/render/stage.ts`; audit fixes **in progress** |
| SHELL | `src/app.ts`, `src/main.ts`, `src/input/**`, `src/ui/**`, `src/core/settings.ts`, `src/core/save.ts`, `index.html`, `_harness/browser_shell.mjs`, `_harness/probe_app.ts`, `_harness/probe_gestures.ts` | Slice: built (2026-10-02). Wiring the round-2/3 members and the collection loop: **planned** (a later stage rewrites these files) |
| CORE (catalog and economy) | `src/core/rarity.ts`, `src/core/meter.ts`, `src/core/drops.ts`, `src/core/merge.ts`; `src/data/**` (`catalog.ts`, `species.ts`, `materials.ts`, `shapes.ts`, `palette.ts`); `_harness/probe_economy.ts`, `probe_catalog.ts`, `probe_genome.ts`, `probe_materials.ts`, `sim_economy.ts`, `gen_catalog_doc.ts`; `_spec/CATALOG.md` (generated: never edit by hand) | Built (2026-10-02). A species rename is **in progress** |
| DOCS | `_spec/DESIGN.md`, `CONTRACT.md`, `NEXT_STEPS.md`, `COLLECTION.md`, `MERGE.md`, `TRADE.md`, `SQUISHY_SCIENCE.md`, `REFERENCES.md` | Current |
| INTEGRATION (the orchestrator) | `src/contracts.ts`, `src/core/genome.ts`, `src/core/rng.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`, `_harness/pw.mjs`, `_harness/mocks.ts`, `_harness/run_probes.ts`, `public/**`, commits | Current |

* **Shared and frozen:** `src/contracts.ts`, `src/core/genome.ts`, `src/core/rng.ts` change only **additively** (an optional member or field, never a
  rename or a removal), and every change is reported. Round-2 and round-3 members are declared optional so mocks keep compiling; consumers
  feature-detect them.
* **Server and portal files** (`supabase/migrations/**`, `supabase/functions/wh-api/**`, the portal's `src/lib/gameBridge.ts`): **planned**; no lane
  writes them yet. The owner applies migrations and deploys the portal by hand (COLLECTION.md 8.2, TRADE.md 17).

## 3. Conventions

* TypeScript `strict`, `erasableSyntaxOnly` (no `enum`, no `namespace`, no constructor parameter properties) so files run
  under plain `node` type-stripping. **Relative imports carry the `.ts` extension.** `import type` for types (`verbatimModuleSyntax`).
* No dependencies beyond `three`. No third-party assets of any kind: no audio files, textures, models, fonts, HDRIs.
  Everything is procedural. (The only binary the folder may hold is the cover `public/thumbnail.png`, to be rendered from the game itself; it does
  not exist yet, so a deploy today would let `pipeline/deploy_game.py` generate a cover from `game_meta.json`'s `art_direction` instead.)
* `src/physics/**`, `src/core/**` and `src/data/**` import nothing from `three` or the DOM, and never call `Math.random()` or `Date.now()`.
  (The only reads of a clock or a random source are injectable defaults: `newInstance`'s default `id` and `now` in `genome.ts`, and `save.ts`'s default
  `now`; a deterministic caller passes its own.) Randomness goes through `src/core/rng.ts` or an **injected random function** (`drops.ts` and `merge.ts` accept one; the server passes a CSPRNG).
  Physics: same genome + same seed + same input script = identical `stateHash()`.
* Hot loops use typed arrays and allocate nothing per step. The physics step budget is gate G1p (section 6).
* UI strings are plain English, short, and original. No reference to any other game, brand or character.
* Each lane leaves `npx tsc --noEmit -p tsconfig.json` clean **for the whole tree** and reports another lane's breakage instead of editing it.
  Lanes do not run `git commit`; the orchestrator commits.

## 4. Physics contract (PHYS)

### 4.1 Built (slice 1)

`export class SoftBody implements SoftBodyLike` in `src/physics/softbody.ts`, constructed from a `Genome`
(`new SoftBody(genome, { detail?: number, seed?: number })`). `detail` is the icosphere subdivision level: 3 = 642 verts
(default), 4 = 2562 verts (offline/quality only).

* **Rest shape (slice)**: DOLLOP is a squat blob with a soft swirl-peak on top (whipped-cream dollop): a sphere with rest radius
  about 0.5 x `lerp(0.8, 1.25, genome.size)`, flattened about 0.8 in Y, plus a narrow raised peak at +Y. The peak is the secondary-motion
  showpiece: it must flop and recover. The shape is a pure function of (species, direction) so other species slot in (4.2).
* **Squash and stretch emerge from physics**: volume is (softly) conserved, so pressing a dent makes the rest bulge;
  pulling a lobe thins the neck. No scale hacks. The volume band is per family (4.3).
* **Technique** (free to deviate if the gates hold): particles = mesh vertices; XPBD with small substeps; edge-distance constraints
  (compliance from `genome.stretch`); a global volume/pressure constraint; global shape matching toward the rest shape with a robust
  polar-decomposition rotation (stiffness from `genome.firmness`); internal-velocity damping relative to the rigid motion (from `genome.bounce`);
  table plane at y = 0 with Coulomb friction; finger = kinematic sphere that projects penetrating particles out; pull = soft attachment of a
  Gaussian neighbourhood to a world target.
* **Fingers**: `fingerDown` places the tip just outside the surface along `dir`; the body eases the tip toward the `fingerPressure` target depth
  (critically damped, response about 80 ms) so a quick tap is a poke and a held press is a squeeze. Tip radius about 0.2 x restRadius, growing toward
  about 0.45 x restRadius with pressure. `fingerMove` rubs along the surface. `fingerUp` retracts the tip fast (60 ms or less) so the body springs back
  and overshoots. Two fingers = pinch; they must not tunnel through each other or invert the mesh.
* **Gravity vs float**: `gravity=false` removes gravity and adds a weak hover spring toward y about 1.0 x restRadius + 0.35 with a slow bob;
  a finger shove then makes the body drift and ease back. Switching is instant and keeps the shape.
* **Events** (`drainEvents`): `poke` on first contact (intensity = normalised closing speed), `press` once a finger has held 0.18 s or more,
  `release` when a finger lifts while compression > 0.08, `land` on a table impact above a small speed, `grab`, `snap`. At most one event per kind
  per finger per 50 ms. The meter (DESIGN 5.4) reads `release.heldFor` and `snap.intensity`: their meaning is part of this contract (gate G4m).
* **Metrics** as documented on `SoftMetrics`; `strain[]` updated every step (the renderer colours the pressure blush with it).
* **Optional extras (built):** `tip(id)` (the fingertip sphere, for a finger ghost) and `warmUp()` (pay the JIT warm-up at load).
* **Robustness**: any input sequence (random fingers, grabs, nudges, dt from 1/240 to 1/10, NaN-free inputs) must never produce NaN/Infinity,
  never invert the mesh (signed volume > 0, no particle inside the table, no local skin fold left behind), and the body must settle to rest.

### 4.2 Round 2 (in progress)

All of these are declared in `src/contracts.ts` (optional members) or come from `src/data/**`. At checkpoints `fc60963` (2026-10-05 06:37 UTC) and
`f14d3b8` (15:24 UTC) `src/physics/softbody.ts` fills `metrics.press` and `metrics.reaction`; the material families, the species rest shapes, the ceremony drivers and the
per-family band are not in it yet (the rewrite is in progress and its gate has not been re-run on those parts).

* **Material families.** The body applies the family of the genome's species (`familyOf(species)` in `src/data/catalog.ts`) through
  `resolveMaterial(familyId, genome).solver` (`src/data/materials.ts`): scale factors on PHYS's own tuned parameters (the Jelly Gel family at a
  neutral genome is the reference, all factors 1) plus the new features: volume target with air bleed, memory arm, jam, tack, slosh, snap.
  The mechanism and cost of each are in [`SQUISHY_SCIENCE.md`](SQUISHY_SCIENCE.md) section 3.
* **Species rest shapes.** The rest shape of every species is its recipe in `src/data/shapes.ts` (`evalShape`; Dollop's recipe reproduces the
  slice-1 rest shape, `probe_catalog.ts` checks the fit).
* **Metrics** `press?` (deepest single-finger indentation, 0..1) and `reaction?` (normalised summed finger-projection correction, a firmness
  signal for audio and haptics). Consumers treat `undefined` as 0.
* **Ceremony drivers** `setFold?(t)`, `moveTo?(p, stiffness)`, `tremble?(amp)`, `burstOpen?(strength)` for the merge ceremony and the capsule
  reveal. The renderer feature-detects them and falls back to a procedural puppet when absent (it does at checkpoints `fc60963` and `f14d3b8`).
* **Stage B (planned, NEXT_STEPS section 4):** several bodies on the mat with body-to-body contact, pick-up and toss, long pulls, tack strands.
  These need new contract members; none is declared yet.

### 4.3 The volume band per family (gate G1)

The slice-1 band (0.85..1.15 under any input) is false for compressible families by design (SQUISHY_SCIENCE 3.2: foam, marshmallow, beads and the dome
go to 0.65-0.82). The band is therefore **per family**, derived from `src/data/materials.ts` so the gate and the data cannot drift:

* lower bound `L_f = min(0.85, 1 - volBleedMax_f - 0.05)`; upper bound 1.15 for every family;
* back to 1 +/- 0.015 within `max(3 s, 4 x airReturnTau_f)` after release (**proposed**; PHYS confirms it with the round-2 probe);
* shape recovery and settle times keep the slice-1 numbers for Jelly Gel (DOLLOP). For the other families PHYS proposes per-family numbers from
  `recovery95` and `hold` (SQUISHY_SCIENCE section 4) with the round-2 probe; families that keep a dent by design (Mochi Dough, Bounce Putty,
  Bead Squeeze) are judged on the dent they keep, not on a full return.

The table as of 2026-10-05 (the probe must compute it from `materials.ts`, not copy it). Regenerate it with:
`node --input-type=module -e "import { MATERIAL_FAMILIES as F } from './src/data/materials.ts'; for (const [id, f] of Object.entries(F)) { const p = f.physics; console.log(id, p.volBleedMax, Math.min(0.85, 1 - p.volBleedMax - 0.05).toFixed(2), Math.max(3, 4 * p.airReturnTau).toFixed(1)); }"`

| Family | `volBleedMax` | Volume lower bound | Upper bound | Back to 1 +/- 0.015 within (proposed) |
|---|---|---|---|---|
| Slow-Rise Foam (`slowrise`) | 0.55 | 0.40 | 1.15 | 5.8 s |
| Marshmallow Puff (`marshmallow`) | 0.35 | 0.60 | 1.15 | 3.0 s |
| Mochi Dough (`mochidough`) | 0.05 | 0.85 | 1.15 | 3.0 s |
| Jelly Gel (`jellygel`) | 0 | 0.85 | 1.15 | 3.0 s |
| Liquid Core (`waterfill`) | 0 | 0.85 | 1.15 | 3.0 s |
| Bounce Putty (`putty`) | 0 | 0.85 | 1.15 | 3.0 s |
| Sticky Stretch (`stickystretch`) | 0 | 0.85 | 1.15 | 3.0 s |
| Slime Goo (`slimegoo`) | 0 | 0.85 | 1.15 | 3.0 s |
| Firm Silicone (`firmsilicone`) | 0.02 | 0.85 | 1.15 | 3.0 s |
| Pop Dome (`popdome`) | 0.3 | 0.65 | 1.15 | 3.0 s |
| Gummy Jelly (`gummy`) | 0 | 0.85 | 1.15 | 3.0 s |
| Bead Squeeze (`beadsqueeze`) | 0.18 | 0.77 | 1.15 | 3.0 s |

Until round 2 lands, `probe_softbody.ts` checks the slice-1 band on DOLLOP-like genomes, which is the Jelly Gel row of this table.

## 5. Audio contract (AUDIO)

`export function createAudio(): SquishAudio` in `src/audio/engine.ts`; voices are functions of `(ctx: BaseAudioContext, out: AudioNode, t0, params)`
so the SAME code renders live and in an `OfflineAudioContext`. **[`SOUND.md`](SOUND.md) is authoritative** for every recipe, the master chain as
built and the measured numbers; this section is the obligation.

### 5.1 Built (slice 1)

| Voice | Character |
|---|---|
| `poke` | a soft wet "thup": a sine body with a fast downward glide + a short band-passed noise "skin" transient; intensity -> level and brightness |
| `squishStart` (held) | continuous squelch while pressed: noise through moving resonances whose centre rises with `compression` and whose level follows the rate; silent when still |
| `release` | the "bloop" back: an upward-gliding sine pair + a damped wobble whose depth and pitch come from the compression released |
| `land` | a low soft "plop"/thud on the table |
| `pop` | a bubble pop: a click + a quick upward-chirped sine "blip" + tiny air noise; size shifts pitch |
| `blend` | a blender: motor whirr, liquid slosh, glassy clinks, then a rising "finished" flourish |

Every voice takes a `pitch` ratio and varies +/-3% per call (seeded round-robin). A limiter is always on; `squishBoost` adds up to +9 dB to
poke/squish/release under it. No clicks: every voice has attack and release ramps. Autoplay policy: nothing is created until `unlock()`.
Optional built extras: `setPaused`, `dispose`, the extended `stats()`.

### 5.2 Round 2 (built, landed 2026-10-02; not called by the app yet)

`meterFull({quiet})` (the two-note plink-plonk), `capsuleBeat({beat: 'grab' | 'crack' | 'burst', progress, tier})`, `reveal({tier, tierUp, isNew,
mythicVariant, durationS, calm})` (the tier motif of DESIGN 6.5), `mergeStart({tier, chargeS, calm})` returning `{burst(...), stop()}` (merge
T0 to T3), `duck({db, ms})` (the 250 ms Mythic pre-roll duck). Signatures: `src/contracts.ts`.

### 5.3 Round 3 (in progress)

`setMusic({on, volume})` and `AudioSettings.music` (a generative ambient bed: 2.5 s fade in, 1.4 s fade out, never before `unlock()`, follows
pause and mute, ducks under ceremonies and a loud held squish), `bump({intensity})` (two squishies collide; rate-limited inside), `lift()`
(a squishy is picked up), `toss({speed})`, `strand({tension, snap})` (a held tacky strand; called every frame while it stretches), and the
harness readout `detailStats()`. These serve stage B (NEXT_STEPS section 4).

## 6. Quality gates

Gate results live in gitignored files (`_harness/_reports/`, `_harness/_renders/`), so the last result and its date are recorded in
NEXT_STEPS.md section 1 (and the audio numbers in SOUND.md).

| Gate | Lane | Check | Pass | Status |
|---|---|---|---|---|
| G0 | all | `npx tsc --noEmit -p tsconfig.json`, `npm run build` | clean for the whole tree; `dist/` < 1.2 MB total (three tree-shaken); `vite build` itself fails over the budget (`vite.config.ts`) | Built (822 KB on 2026-10-05) |
| G1 | PHYS | `node _harness/probe_softbody.ts` | volume inside the **per-family band of 4.3** under max squeeze and back to 1 +/- 0.015 in time; shape back within 3% of rest radius RMS (rotation and translation removed) 4 s or less after release (Jelly Gel; other families 4.3); settles (kinetic < 0.02) in 5 s or less; underdamped (2 or more visible height oscillations after a hard release, `bounce` high) with decay time constant 0.5-2.0 s; the peak flops (peak tip displaces 25% restRadius or more under a side poke); no local skin fold left after any press; fuzz: 200 runs x 1500 random events, dt in [1/240, 1/10] -> 0 NaN, 0 mesh inversions, 0 table penetrations > 1% restRadius; determinism: identical `stateHash` for identical scripts; float mode: stays within 1.5 m of origin and returns to hover after a shove | Slice built; per-family band in progress |
| G1p | PHYS | perf in node | mean `step()` 2.0 ms or less and p99 5 ms or less at detail 3 on this container; no per-step allocation | Built |
| G2 | AUDIO | `node _harness/probe_audio.mjs` (Chromium OfflineAudioContext) | every voice: peak -20..-1 dBFS, abs DC < 0.01, no sample jump > 0.25 at start/end, tail < -60 dB by the end, non-silent for its minimum duration, two renders with different pitch/seed differ by 3% or more in dominant frequency; round-2 ceremony and engine checks and round-3 music checks as listed in SOUND.md | Rounds 1-2 built; round 3 in progress |
| G3 | RENDER, SHELL | `node _harness/browser_render.mjs`, `node _harness/browser_shell.mjs` (Chromium + SwiftShader) | boots with 0 console errors/warnings and 0 failed requests; canvas not blank; screenshots: rest, mid-poke, held squish, release t+80 ms / t+250 ms, pull, float mode, 6 genomes; drag-orbit works; Settings panel works | Built |
| G4 | SHELL | `browser_shell.mjs` | synthetic mouse and touch (incl. two-finger pinch) produce the matching `SoftEvent`s and audio voice starts via `window.__WH__.state()`; keyboard controls of section 8 | Built |
| **G4m** | SHELL, PHYS | the meter feed (DESIGN risk 12) | with the meter wired: real mouse and touch input through `window.__WH__` produce `SoftEvent`s that `src/collection/meterfeed.ts` maps exactly as DESIGN 5.4 says (`poke` -> poke; `release` with `heldFor` 0.4 s or more -> squeeze with that hold; `snap` with `intensity` 0.35 or more -> pull, below it the quarter rate), and the preview ring equals `addInteraction` folded over the same touches; physics side: `release.heldFor` equals the press time within one frame, and a full pull of the starter genome released at its reach gives `snap.intensity` of 0.35 or more | **Planned** (needs the shell wiring) |
| G5 | DOCS, all | originality | no assets, no reference names; palette recorded; sounds synthesised; reviewer checklists in DESIGN section 9 and REFERENCES section 3 | Built |
| G6 | SHELL | mobile | 390x844 touch emulation: no horizontal scroll, controls reachable, hint text readable | Built |
| **G7** | RENDER, AUDIO | ceremonies and the flash budget (DESIGN 6.1 to 6.6) | render, round-2 block of `browser_render.mjs`: every tier's capsule reveal and merge ceremony (plus tier-up, 3 parents, quick pop) within 10% of the DESIGN 6.1 budget, beats once and in order, the DESIGN 6.3 escalation row exactly with ONE light ramp, mean-luminance transitions 3 or fewer in any rolling second, `skip()` lands on the same final frame and never hides the result, the Calm variant of every tier; the FlashGovernor under adversarial input (2 flashes a second or fewer, flash alpha 0.25 or less, rings 500 ms apart or more, ember coral and lagoon cyan never alternating faster than 2 Hz, none in calm mode). Audio: the round-2 ceremony checks of `probe_audio.mjs` | Built, one render check failing (NEXT_STEPS section 1) |
| **G8** | CORE | `npm run probe` (every `_harness/probe_*.ts` under node; the CORE ones are `probe_economy.ts`, `probe_catalog.ts`, `probe_genome.ts`, `probe_materials.ts`) | all exit 0; `CATALOG.md` regenerated by `node _harness/gen_catalog_doc.ts` after any catalog change; after any change to `src/core` or `src/data`, the canonical sim (DESIGN 5.0) is re-run and its hash compared before any number is re-quoted | Built |
| **G9** | server (no lane yet) | the host suite (COLLECTION Appendix C), the SQL suite (TRADE Appendix C) and the migration's own self-test block with its privilege audit (COLLECTION A.7), on a **staging** Supabase project through PostgREST and the Edge Function | all pass; the privilege audit shows no change to any non-WH object | **Planned** on staging. On a scratch PostgreSQL 16 the drafts passed 149 + 36 checks on 2026-10-02 and, after the 2026-10-05 security revisions, 170 + 37 checks plus the A.7 audit and its negative test on 2026-10-05 (NEXT_STEPS section 1) |

## 7. Visual direction and render contract (RENDER, SHELL)

### 7.1 Palette and look (built): original, deliberately unlike pastel-kawaii shelves

* **Palette** (tokens in one place, `src/ui/theme.ts` / CSS vars): ink-indigo `#14102a` (background), plum `#2a1744`,
  dusk violet `#5b3a86`, felt mat `#2a2150`, sodium amber `#ffb347` (key light), cold lagoon `#59d6e6` (rim light), ember
  coral `#ff5a4d` (core glow / accents), cream `#fff1d6` (text). DOLLOP itself: translucent apricot-amber body (hue 32), ember-coral core.
  Tier colours (DESIGN 5.3) come from these tokens.
* **Look**: a toy photographed on a dark felt play-mat under a warm softbox with a cool rim light: glossy specular highlights from procedural
  softbox panels (a tiny `PMREMGenerator.fromScene` environment built in code), translucent body with thickness-based absorption, glowing core
  that brightens when squeezed, a coloured light pool under the body that widens when it squashes.
* **Subsurface feel without a subsurface pass**: thickness/attenuation, view-dependent rim/fresnel glow, core halo, and a **pressure blush**:
  compressed regions (`strain < 1`) saturate and warm up, stretched regions (`> 1`) go paler and clearer.
* **Face**: two glossy ink-dark eyes attached to the surface (they ride the squash), blink, follow the pointer, widen when squeezed, squint into
  happy arcs on release. Style from `genome.eyeStyle`. **No mouth.**
* **FX**: trapped-air bubbles that rise and pop on a fast release, glitter inside the body that rides the deformation, a ring/dust puff on landing.
* **Quality tiers**: `high` = transmission at full res + MSAA + DPR 2 or less; `med` = transmission at 0.5 res; `low` = no transmission (alpha-blended
  fresnel + core glow). `auto` samples frame time.

### 7.2 Stage (built, slice 1)

`StageLike` in `src/contracts.ts`: `setBody`, `update`, `render`, `resize`, `orbit`, `zoom`, `shake`, `setShakeScale`, `setQuality`,
`setFloatMode`, `spawnFx`, `dispose`, `stats`.

### 7.3 Stage round 2 (built in `src/render/stage.ts`; not called by the app yet)

* **Several bodies:** `addBody(body, genome, {tier, position})`, `removeBody`, `clearBodies`, `primaryBodyId`; `setBody` is `clearBodies` + `addBody`.
* **Rarity look:** `setBodyTier(id, tier)` applies the tier layer of DESIGN 5.3 on top of the genome look.
* **Ceremonies, result first:** `dropCapsule()` returns a `CapsuleHandle` (tap and hold test, squeeze progress); `playCapsuleReveal(spec, hooks)` and
  `playMergeCeremony(spec, hooks)` take the **already decided** result (the server decides before any animation starts: DESIGN 6) and return a
  `CeremonyHandle` (`done`, `skip()`, `duration`, the result body the shell adopts afterwards). Beats are reported through `onBeat` so the shell
  fires audio and haptics in sync (`'preroll'` starts the audio swell for Rare and up).
* **Calm effects:** `setCalmEffects(on)`: no camera moves, no slow motion, particles x0.3, rings become fades, durations x0.65, no pulses, no screen flash.
* **Flash budget (always on):** a FlashGovernor clamps luminance flashes as gate G7 states.

## 8. Shell, input and settings (SHELL)

**Built (slice 1):**

* Full-viewport canvas, DOM overlay (`#ui`), mobile-first, `touch-action: none`, safe-area insets, `dvh`.
* Boot/title card ("tap to wake it up") doubles as the audio-unlock gesture. Wordmark WOBBLEHOARD, our own typography
  (system font stack, heavy rounded weight; no web fonts).
* **Gestures**: tap = poke; press-and-hold = squish (pressure ramps about 0.9 s to full, `fingerPressure`); press then drag along the surface = rub;
  press on the body then drag *away* (more than 14 px from the press point, outward) = pull/stretch (`grab`); drag on empty space = orbit;
  wheel / pinch on empty space = zoom; two fingers on the body = pinch (two `fingerDown`s).
* **Keyboard** (`src/input/keyboard.ts`): `Space` tap = poke the centre, `Space` held = squish (a synthetic pointer at the body's centre, so it runs the
  same gesture code as a finger), `G` toggles gravity, `M` mutes, `Escape` closes the panel; for people who cannot drag, the **arrow keys orbit**
  and **`+` / `-` zoom**. Shortcuts stay out of the way of focused controls.
* **Settings panel** (gear, top-right): Volume, Louder squish, Haptics (`navigator.vibrate`; hidden when unsupported), Screen shake (0 = off;
  default 0 if `prefers-reduced-motion`), Gravity (table) or Float, Quality. Persisted to `localStorage` under `wobblehoard:v1:settings` with
  try/catch (private mode must not break anything).
* Haptics: poke = 8 ms tick, squeeze = low-rate pulse scaled by rate, release = 18 ms thump, pop = 6 ms. Screen shake on `release`/`land`/`poke`.
* HUD: wordmark, gear, a one-line hint that fades after the first interaction, and the squishy's name. No score, no currency, no timers.
* URL: `?genome=<seed|g1.code>` `?float=1` `?quality=low|med|high` `?dev=1` (exposes `window.__WH__`, shows a stats overlay) `?mute=1`
  `?lab=1` (sound lab, dev only).
* Errors: a boot failure shows a friendly card (what failed, "reload"), never a blank screen. WebGL2 missing = explain.
* The page pauses sim and audio when the tab is hidden.

**Planned (each needs an additive field in `Settings` in `src/contracts.ts`, owned by INTEGRATION):**

* **Calm effects** (on by default when `prefers-reduced-motion` is set; DESIGN 6.6), **Skip animations** and **Fast open** (DESIGN 6.1 and 6.6).
* **Music** volume (the audio side, `AudioSettings.music`, exists in the contract; stage B item B7) and **Extra squish** depth (stage B item B8).
* The collection HUD: meter ring, capsule table, Hoard button, Daily gift, Today panel (COLLECTION.md section 9); the round-2 stage and audio
  members wired in the result-first order of COLLECTION.md section 10 and MERGE.md section 7.

## 9. Debug hook

`window.__WH__` (only with `?dev=1`): see `DebugHook` in `src/contracts.ts`. `step()` + `pause()` give reproducible frames. Optional (built):
`bodyScreen()` (where the squishy is on screen).

## 10. Orchestration: ports and harness commands

| Port | Who | Where it is set |
|---|---|---|
| 5360 | integration dev server (`npm run dev`) | `vite.config.ts` |
| 5361 | integration preview (`vite preview`) | `vite.config.ts` |
| 5362 | PHYS (`browser_physics.mjs`) | the script |
| 5363 | AUDIO (`probe_audio.mjs --port=`) | the script |
| 5364 | RENDER (`browser_render.mjs`) | the script |
| 5365 | SHELL (`browser_shell.mjs --port=`) | the script |

Each browser script starts its own Vite (`npx vite --port <p> --strictPort`, helper `startVite` in `_harness/pw.mjs`) or reuses one already
answering on that port. Playwright is not a package dependency: `pw.mjs` resolves it from `node_modules` or the global install.

| Command | What |
|---|---|
| `npm run typecheck` (= `npx tsc --noEmit -p tsconfig.json`) | G0, the whole tree |
| `npm run build` | G0, `dist/` |
| `npm run probe` / `npm run check` | every `_harness/probe_*.ts` under node (G1, G8 and the shell probes) / typecheck then probes |
| `node _harness/probe_softbody.ts [--quick]` | G1, G1p (report: `_harness/_reports/probe_softbody.json`) |
| `node _harness/browser_physics.mjs [scenario ...]` | physics filmstrips (`_shots/phys/`) |
| `node _harness/probe_audio.mjs [--voices=a,b] [--no-engine] [--no-round3 or --only3] [--port=5363]` | G2, G7 audio (`_harness/_renders/`) |
| `node _harness/browser_render.mjs [--body=MODE] [--quick] [--no-perf]` (MODE: `stub`, `real` or `auto`) | G3 render, G7 render (`_harness/_reports/browser_render.json`, `_shots/render/`) |
| `node _harness/browser_shell.mjs [--quick] [--port=5365] [--only=a,b]` | G3 shell, G4, G6 (`_harness/_reports/shell.json`, `_shots/shell/`) |
| `node _harness/sim_economy.ts [--quick] [--n 5000] [--long 450]` | the economy sim (DESIGN 5.0; the full run takes about 5 minutes) |
| `node _harness/gen_catalog_doc.ts` | regenerates `_spec/CATALOG.md` |
| `npm run probe:physics-film`, `probe:audio`, `probe:render`, `probe:shell` | the four browser harnesses above with no arguments (`browser_physics.mjs`, `probe_audio.mjs`, `browser_render.mjs`, `browser_shell.mjs`); `npm run probe:browser` runs audio, render and shell in turn. Arguments pass through after `--` (for example `npm run probe:shell -- --quick`) |
| `npm run deploy:dry` / `npm run deploy` | build, then `python ../../pipeline/deploy_game.py --game-dir dist --slug wobblehoard` with `--dry-run` (prints the upload plan) / for real (after `npm run check`). **Deploying is the owner's step; lanes never run `deploy`.** `deploy_game.py` refuses the game folder itself (its `index.html` loads `.ts`): only `dist/` is deployable (`DEPLOY.md`, Vite games) |

Screenshots go to `_shots/` (gitignored), reports to `_harness/_reports/` (gitignored), audio renders to `_harness/_renders/` (gitignored).
They arrive through the dev and preview servers' `POST /__shot/<name>` and `POST /__report/<name>` (`vite.config.ts`; never part of a build), which
answer only same-origin requests to a loopback host: a request whose `Origin` is another site or port, or whose `Sec-Fetch-Site` is not
`same-origin`, gets 403 and writes nothing. Harness pages served by the same server and Node scripts (no `Origin`) are unaffected.
While a lane's collaborators are unfinished, code against `src/contracts.ts` and a local stub (`_harness/mocks.ts`); never edit another lane's files.

## 11. Core economy and data contract (CORE; built)

* `src/data/catalog.ts`: the 50 species (tier, material family, lane, signature touch, look, shape recipe, palette). The id list itself is the leaf
  module `src/data/species.ts` (re-exported by `catalog.ts` and `genome.ts`). **`idx` is stored in share strings and is append-only forever** (never
  reorder or reuse an index); after launch an `id` is never renamed either (a slug also salts the species' base genome). Before launch the CORE lane
  may rename a species if `probe_catalog.ts` passes and `CATALOG.md` is regenerated (`species.ts` records each pre-launch rename by idx).
* `src/core/rarity.ts`: the six tiers, the public odds (76.3 / 13 / 6 / 2.8 / 1.4 / 0.5%), `TIER_STYLE` (gem shape, frame colour).
* `src/core/meter.ts`: the Squish meter of DESIGN 5.4 (pay table, freshness, double-tap gate, medley, valve, onboarding ramp, daily caps, UTC day).
* `src/core/drops.ts`: `rollCapsule` (tier by the public odds, species uniform inside the tier, genome seed; random source injected), restock, tasks.
* `src/core/merge.ts`: `MERGE_COST = 2` (one literal, read by everything), `previewMerge` (exact odds, no randomness), `rollMerge` (exactly three draws
  in a fixed order; a refused selection consumes none).
* `src/core/genome.ts` (shared): the `g1.` share string (26 bytes, species index in one byte; hostile input decodes to `null`), quantisation,
  `SquishyInstance`. The string is **canonical**: `encodeGenome` quantises first and throws a `RangeError` for an unknown species, pattern or eye
  style; `decodeGenome` accepts only the exact string `encodeGenome` writes (no alias spellings); `canonicalGenome` validates a genome from outside.
  Genomes compare with `genomeEquals` (equal canonical forms), never with `JSON.stringify`.
* `src/data/materials.ts`, `src/data/shapes.ts`: the 12 material families and the rest-shape language (4.2). **One source per look field:**
  `resolveMaterial(family, genome).look` passes the genome's translucency, gloss, coreGlow and glitter through unchanged (the species look in
  `catalog.ts`, so the tier ordering of DESIGN 5.3 holds in what the renderer gets; `probe_catalog.ts` checks the resolved tier means); the family
  supplies only the surface fields a genome does not carry (roughness, subsurface, fuzz, grain, thickness, blush, stretchPale).
* `src/data/palette.ts`: genome to body and core colour (OKLCH formulas); `src/render/oklch.ts` must draw with exactly these. `probe_catalog.ts`
  compares the two every run and reports a drift as SEAM-DRIFT; it fails the run only with `WH_STRICT_SEAMS=1` (integration runs), because the fix
  belongs to the render lane.
* **The server will run these modules verbatim** (COLLECTION.md C-1); a vendor script and a hash probe will enforce it (planned).

## 12. Module seams that are planned (COLLECTION, MERGE, TRADE)

* **Only the server writes real items.** The game iframe never mints, never rolls a real capsule or merge, and never holds a token; it calls
  allow-listed functions through the portal bridge (`forgeflow:rpc` / `forgeflow:rpc_result`, COLLECTION.md section 8).
* Function names, payloads and error codes are owned by the module documents: COLLECTION.md 7.4 (mint and reads), MERGE.md section 4 (merge),
  TRADE.md section 7 (trade and social). The shared error copy is TRADE.md 7.3.
* Storage keys reserved: `wobblehoard:v2:hoard` (the local Hoard; COLLECTION.md 5.1). The local save never contains the parameters of an op that
  consumes, chooses or moves items, and is never replayed blindly (COLLECTION.md 7.7).
* `contracts.ts` needs no change for these modules. `genome.ts` and `save.ts` need the additive origin kind `'restock'` (COLLECTION.md 3.5);
  `Settings` needs the additive fields of section 8.

## 13. What changed against the slice-1 contract (2026-10-02)

* Lanes CORE and INTEGRATION added; DOCS owns all `_spec` files except `SOUND.md` (AUDIO) and `CATALOG.md` (CORE, generated).
* G1's single volume band became the per-family band of 4.3 (the slice-1 band is its Jelly Gel row). Gates G4m, G7, G8 and G9 added.
* Physics round 2, audio rounds 2 and 3 and render round 2 documented from `src/contracts.ts` (4.2, 5.2, 5.3, 7.3).
* Section 8 now lists the keyboard controls as built (`Space` hold, arrows, `+` / `-`) and the planned settings (Calm effects, Skip animations,
  Fast open, Music, Extra squish).
* The DOCS row no longer lists `README.md` or `public/game_meta.json` (INTEGRATION owns the package files and `public/**`).
