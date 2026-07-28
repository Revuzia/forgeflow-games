# ForgeFlow Game-Building Doctrine

Read this BEFORE building or fixing any game. Every rule here was paid for with
a real defect in a shipped ForgeFlow game or verified against a real external
project — nothing is a vibe. Each entry states the mechanism, because a rule
whose mechanism you understand transfers to situations the rule's author never
saw. Sources: the Colosseum 2026-07 rebuild (measured end to end), the 17-game
FFG catalogue, and the 2026-07-27 reference review (Claude-of-Duty, MengTo
Skills, img2threejs, Operation Ironhold — digests in `reference_review_2026-07/`).

The `## PROMPT CORE` section at the bottom is machine-injected into build
prompts by `pipeline/engine/learn.doctrine_block()`. Keep it under 60 lines and
keep every line load-bearing.

---

## 1. Meshy / auto-rigged character pipeline

- **The exporter's materials are wrong, every time.** Meshy omits
  metallicFactor/roughnessFactor (glTF defaults both to 1.0 → diffuse =
  albedo×(1−metalness) = ZERO — bodies ignore all lights) and binds the albedo
  as a full-strength emissive. Repair AT LOAD, once, for every body:
  metalness 0, roughness ~0.78, emissive black + map null, specular 1.0.
  Never fix per-file; the next generated body arrives broken the same way.
- **The bind pose is degenerate. Never render, measure, or pose against it.**
  Measured: `Skeleton.pose()` collapsed Head/Hips/LeftLeg/RightForeArm into a
  1 cm ball. Consequences already paid: equipment solved against garbage,
  an impostor bake photographed a crumpled blob. The only trustworthy poses:
  (a) the glTF node TRS snapshotted at Actor construction BEFORE any mixer
  touches a bone, (b) a running clip. `Actor` does both — go through it.
- **Bone-local axes are arbitrary, per bone AND per archetype.** Never write
  per-bone Euler guesses. Solve every attachment/pose in WORLD space and
  express the result in the bone's frame (`inv(boneWorld) × desiredWorld`).
  And constrain a FULL BASIS, not one axis: `setFromUnitVectors` leaves roll
  free — that was the sideways-helmet bug. Pin +Y to the anatomical axis and
  +Z to the body's forward, projected.
- **Body-worn things that are world-oriented by definition (belts, cuirasses)
  must be re-solved EVERY FRAME**, not baked at attach — the pelvis animates;
  a belt does not go with it (measured 58° of drift). Limb/helmet pieces follow
  their bone; trunk pieces follow the world.
- **Invalidate pose-solver memos whenever mounts rebuild** (weapon swap etc.)
  or the solver writes into a detached orphan while the visible mesh keeps its
  attach-time pose. Clear the memo at the single place mounts are created.
- **Clips: strip `.scale` tracks and `(Shoulder|Arm|Hand).position` tracks on
  load** (Meshy bakes a Hips scale that shrinks walkers, and arm-position
  tracks cause a permanent shrug).
- **Authoring new clips in Blender headless works** (tools/author_clips.py
  pattern): pose via `pose_bone.matrix` in WORLD axes, parents first, on top of
  captured REST matrices; keyframe rotation_quaternion. Blender is Z-UP; a glTF
  import maps three's +Z forward to Blender +Y. PURGE all other actions before
  export or they ship in the GLB and `animations[0]` plays the wrong clip.
  The murmillo spine chain is REVERSE-NAMED: Hips→Spine02(lowest)→Spine01→Spine.
- **Never Meshy-rig quadrupeds** (auto-rig is humanoid-only). Sketchfab/staged
  GLBs with embedded clips for beasts and mounts.

## 2. Combat feel (third-person melee, but the principles generalize)

- **Anchor timing to measured human motion, not vibes.** Full swing cycles
  1.5–2.5 s (fencing lunge 568 ms delivery, kendo men strike 759 ms, hooks
  586–657 ms, instrumented spear thrust 4.65 m/s; recovery carries the
  majority of every measured cycle). One committed attack per ~3 s overall
  rhythm (elite boxing/Muay Thai time-motion). Anything faster reads as
  flailing; the "7 hits in 3 seconds" build was unplayable AND unreadable.
- **Attacks step INTO the blow.** If velocity is zero during windup/active,
  defenders trivially back out of everything (measured: 67% of active frames
  beyond reach, 6/30 swings landing). Lunge toward a target locked at commit,
  capped ~80% of reach.
- **The view's strike frame must align to the SIM's actual windup** —
  including skill/wound modifiers and resolve-tick lag — or no STRIKE_FRAC
  table can be right for more than one fighter state (measured ±150 ms drift).
  Better: clips authored with DESIGNED strike frames.
- **Buffer inputs ~0.35 s** and fire on the first valid tick; edge-triggered
  presses during windup+active otherwise vanish (the single cheapest
  feel-transforming fix; Souls/DMC standard).
- **Make the parry reachable, then prove it.** Command lag + phase gates ate a
  0.16 s window entirely (0 parries in 25 timed blocks). 0.25 s + attack-cancel
  into guard made it real (29 parries, same harness). If a skill mechanic can't
  be hit by a scripted optimal player, a human has no chance.
- **Simultaneous attacks must CLASH** (both stop, rebound, sparks) — otherwise
  mutual clean hits read as no-contact. Deterministic, with a per-pair cooldown
  and seed-jittered staggers or identical timings phase-lock into an infinite
  bind (a probe caught a bout stalled exactly so).
- **Guard-break is a STATE that mends at a stamina threshold, and the breaking
  blow lands (reduced)** — an event that pins stamina at its own trigger
  condition re-fires forever for zero damage (26% of all swings, measured).
- **AI honesty rules:** roll reactions ONCE per incoming swing and latch
  (per-tick rerolls turn p into 1−(1−p)^12 ≈ certainty — the whole skill table
  becomes decorative); count BLOWS not decision ticks for burst limits; commit
  while mid-swing (a reactive layer that can cancel its own attacks goes
  0-for-20); cap simultaneous attackers with tokens; give bots reaction delay
  300–800 ms + ~0.018 rad aim jitter (Operation Ironhold's fairness constants).
- **Every bout ends.** A no-timeout fight WILL stall on some seed. Referee
  verdict on remaining condition after N seconds per ENGAGEMENT (reset on new
  spawns so multi-stage fights still play out).
- **A timeout verdict must never reward passivity.** `>=` on an hp-fraction
  comparison awards full-hp-vs-full-hp TIES to the player, so pure kiting beat
  the hardest bouts (measured 3/3 zero-contact wins at ~163 s). Strict
  advantage only, and zero-contact rules AGAINST the player.
- **Poise, or spam interrupts everything.** With unconditional
  hit-interrupts-windup, a masher stagger-cancelled every AI swing (68
  interrupts/30 bouts; no enemy ever finished an attack) and beat timed play
  at every tier below champion. Interrupts land only in the EARLY windup
  (~first 45%) with ~1.6 s immunity after each.
- **Blocks must PUNISH, not just absorb.** 44 blocks + 5 parries produced zero
  counter-hits — so blocking never beat mashing. A direction-MATCHED block or
  parry arms an AI riposte (immediate counter with poise). Cooldown it
  (~2.2 s): granted on EVERY block, a same-skill attacker landed ZERO hits in
  15 s — a wall, not a skill curve. Tune between those measured rails.
- **Telegraph honesty extends to the DODGE.** If i-frames (0.28 s) expire
  before a slow attack lands (0.62 s windup), reacting to the TELL is
  punished and only frame-guessing the impact works (measured 6/30 vs 14/20
  wins). Vs big lunging attackers, honour a dodge STARTED anywhere inside the
  attacker's windup (grace scaled to that attacker's own windup) — and give a
  dodged lunge extra recover, so evasion opens the counter-window instead of
  merely not-losing.
- **The tutorial opponent is a TEACHER, its own AI band.** Gate-on-win
  tutorials with a normal-band opponent hard-wall novices (0/21 measured, with
  the taught verb literally disabled by kit rules). Tutor band: long latency,
  near-zero punish, meaningful blockChance (it DEMONSTRATES the verb), spacer
  patience for wide openings — and make sure the taught verb WORKS with the
  tutorial's issued kit (shieldless block was silently inert: ~1000 held
  ticks, 0 blocking ticks).
- **Acceptance-test feel with persona playtests.** Scripted personas driving
  the REAL sim headlessly — rusher (never blocks), duelist (timed/directional),
  novice (350–500 ms delayed inputs) on identical seeds — turn "does skill beat
  spam?", "can a beginner learn?", "does kiting win?" into measured numbers.
  Re-run the same personas after every combat-layer change; verdicts that
  don't ROUND UP (a claim "beatable at ≥1/3" fails at 6/30 even though the
  build improved) are what keep fixes honest.
- **Fast closing speeds need SUB-TICK impact resolution** (joust: 22 m/s
  crosses a lance-reach in <2 ticks; solve the crossing instant inside the
  tick and resolve both sides there — never whoever-ticked-first).

## 3. Rendering & performance (three.js/WebGL, no build step)

- **Pre-warm shaders with a render target BOUND**, then again for the canvas:
  `renderer.compileAsync` ×2 before frame 1. Programs are keyed per
  target-format variant; canvas-only compiles left 25/47 of Claude-of-Duty's
  programs wasted and every first effect hitched. Colosseum verified: 34
  programs at boot, 0 new during first combat.
- **Visible-light COUNT is a shader-permutation key.** Fixed light pools
  (visible:true, intensity 0), never add/remove at runtime (+33–36 recompiles
  at 640–900 ms measured in the source project).
- **Trust only honest counters:** `renderer.info.autoReset = false` + reset
  per FRAME, or with any composer the numbers describe the last pass only
  (this hid ~2× of real cost).
- **Report p99 and attribute hitches, not averages** (94 fps static benchmark
  vs p99 4–9 fps in the same project). Hitch + program-count jump = shader
  compile; + texture jump = upload stall.
- **Crowds at scale are IMPOSTORS**, not geometry: bake the real character
  into an atlas (from an Actor — see §1 bind-pose rule), billboard cards,
  UNLIT material (the bake is already lit), keep animation as vertex-shader
  work. Two bake gotchas, both hit: `render()` auto-clears the whole target
  per call (autoClear off + scissor per cell), and the bind pose (see §1).
- **Standing doctrine (all FFG 3D):** strip GLB-embedded lights; DPR cap 1.5;
  shadow map 1024; Draco+WebP every character (7.9 MB → ~165 KB is normal);
  `frustumCulled = false` on skinned meshes (bind-pose bounds lie).
- **Never gate boot on a fat asset** (a 4.4 MB tiger held Colosseum's title
  screen; load per-bout via the requiredBodies pattern).
- **Procedural geometry with explicit normals: fix winding BY CONSTRUCTION**
  (a helper that makes every triangle agree with its declared normal). A sign
  flip in a sweep reversed handedness and FrontSide culled 32 board triangles;
  hand-auditing quad order was got wrong twice before the constructive fix.
- **UVs: emit parametric charts in metres/TILE at build time.** An all-zero uv
  attribute is why complete PBR sets sat unused for a month — the maps "worked"
  but sampled one texel.

## 4. Simulation architecture

- **Sims are THREE-free and deterministic**, driven by fixed-dt command
  streams. Each independent system owns its OWN mulberry32 stream (a joust
  replayed from a seed must not depend on whether a melee ran).
- **The view reads events, never writes gameplay.** One bridge file owns
  sim→scene translation.
- **Guard every deferred callback with an epoch/token.** An unguarded
  `setTimeout(endMatch, 3200)` from a finished bout nulled the NEXT match mid
  `await` — 4 of 28 ladder bouts simply unplayable. Bump an epoch per
  start; stale timers no-op.
- **Referential integrity is a gate, not a hope:** every content reference
  (bout→opponent, clipMap→clip-in-GLB, spawn→entity) must resolve, checked at
  build time. Colosseum's champion bouts spawned EMPTY for weeks because
  `start()` read a different field than the specs listed.
- **When state mutates in a shared table** (e.g. FEEL constants), retune
  against the DOWNSTREAM systems that consume it (a swing-cycle change silently
  made held-guards unbreakable because block cost was tuned for old cadence).

## 5. Verification doctrine (how we know anything)

- **Done = observed effect in the LIVE system.** Compiles/probe-passes are
  proxies. The loop that works: headless probes per sim module (`tools/
  probe_*.mjs`, deterministic, exit-code) + the in-page test surface
  (`window.__FFG3D__.__test`: startMatch/fight/step/capture/equip/placeActor)
  + screenshot capture via a render-target POST to the dev server
  (`/__shot/`) so a hidden tab can still produce pixels.
- **Measure at the layer the player sees.** Two Blender measurements of trunk
  pitch disagreed with each other AND with the renderer (19° vs 36° vs the
  real 48°). Armature-space is not camera-space. When numbers conflict,
  instrument the running game and let it arbitrate.
- **Instrument the real path, not a proxy:** dispatch real KeyboardEvent/
  MouseEvent through the input layer to test input features (the buffer test
  through `T.fight()` would have bypassed the buffer entirely).
- **Play the game to find what audits can't.** The unreachable parry, the
  stalemate meta, the floating rider — all found by scripted PLAY with
  event-count instrumentation, not by reading code. Autoplay bots + event
  counters per bout are cheap and merciless.
- **Verify the DEPLOYED game:** after upload, fetch the live URL, check the
  version marker and one new-code fingerprint, then run one real bout on
  production via the test surface. Exit-code-0 deploys have lied (zero-byte
  logs, stale-looking CDN from a bad grep — probe with a marker that actually
  exists in the new code).
- **A pause that only the rAF path respects cannot be tested** — gate the
  step function itself, and discard the accumulator during pause or resume
  fast-forwards the debt.

## 6. Shell & platform contracts (every FFG game)

- `window.__PAUSE__ = { pause, resume, toggle }` — the portal button and
  fullscreen-exit drive it. ESC pauses (overlay: Resume/Settings/confirm-
  Forfeit); ESC must NEVER destroy a bout silently, and forfeit routes through
  the same verdict path as a loss so economy/records stay real.
- Menu `screenBefore` must be ASSIGNED on navigation or every Back button
  guesses (Settings→Back stranded players in the wrong screen for months).
- Gate menu/shop hotkeys while a bout is live (Tab opened the armoury over a
  running fight; clicks fired attacks).
- `boot.js?v=N` cache-bust on EVERY iteration; ES modules cache hard and a
  bumped boot does not bust its imports — serve dev with no-store.
- Store copy is a CONTRACT: never advertise a mode that does not exist in the
  code (Colosseum shipped "mounted jousting" with zero joust code; it took a
  full sim+view build to make the page honest).

## 7. Assets & deploy

- **No primitive hero assets, ever** (established FFG standard; the reviewed
  projects that used box-people/box-guns are explicitly NOT our bar). Meshy
  for humanoids, staged GLBs for creatures/mounts, procedural only for
  props/architecture behind a visual-quality gate.
- R2 deploy withholds dev-only dirs (tools/, _src, .git); purge the CDN cache;
  the pages/portal prerender refresh is part of the deploy, not optional.
- Deploys race safely with concurrent sessions (CAS push rejections can be
  spurious — fetch and compare before diagnosing).
- Keep per-asset provenance (imported/generated/procedural + license). MengTo
  Skills corpus is MIT — vendored in `vendor/mengto-skills/` with attribution.

## 8. Reference shelf

- `reference_review_2026-07/` — full adopt-now/later/skip analysis of
  Claude-of-Duty (perf forensics; NO netcode inside), MengTo Skills (19
  game-dev SKILL.md files, vendored), img2threejs (photo→model; not our
  pipeline), Operation Ironhold (5-prompt FPS; PROMPTS.md + autoplay-bot
  patterns; bot-fairness constants adopted in §2).
- `research_*.json` — the May 2026 Phaser-era research (2D; superseded for 3D
  work but still valid for 2D titles).
- `pipeline/engine/learnings.jsonl` — the append-only failure log; add to it
  via `learn.record()` whenever a gate or a player finds something this file
  should have prevented.

---

## PROMPT CORE

GAME DOCTRINE (paid-for rules — obey; full rationale in pipeline/knowledge/GAME_DOCTRINE.md):
1. Meshy materials are broken at export: repair at load (metalness 0, roughness .78, emissive off). The BIND POSE is degenerate: never render/measure/pose against it — use an Actor under a running clip or the construction-time TRS snapshot.
2. Never guess bone-local Eulers: solve attachments/poses in WORLD space, full basis (+Y anatomical, +Z forward), express in the bone frame. Re-solve world-oriented trunk pieces every frame.
3. Combat timing anchors to measured human motion: 1.5–2.5 s swing cycles, ~3 s between committed attacks, recovery majority-share. Attacks LUNGE into reach (attackers rooted in place = nothing lands). Buffer inputs 0.35 s. Parry windows ≥0.25 s with attack-cancel into guard — then PROVE reachability with a scripted optimal player.
4. AI: roll reactions once per incoming swing and latch; count blows, not ticks; commit while swinging; ≤2 attack tokens; 300–800 ms reaction delay + aim jitter for bots.
5. Simultaneous attacks clash (stop+rebound+cooldown+jittered stagger); guard-break is a state that mends at a threshold; every engagement has a referee timeout; fast closings resolve impacts sub-tick.
6. Sims are THREE-free, fixed-dt, deterministic, one rng stream per system; view reads events only; every deferred callback carries an epoch guard; every content reference must resolve (gate it).
7. Rendering: compileAsync pre-warm with an RT bound (then canvas); fixed light pools (count = shader permutation); info.autoReset=false; report p99 + hitch attribution, never averages; crowds are baked-from-real-body unlit impostors; strip GLB lights; DPR ≤1.5; Draco+WebP bodies; never gate boot on a fat asset; procedural geometry fixes winding by construction; emit real UVs (metres/tile).
8. Shell: window.__PAUSE__ contract; ESC pauses (never destroys); forfeit = real loss through the verdict path; assign screenBefore; gate hotkeys during bouts; bump boot.js?v=N every iteration.
9. Verify in the LIVE system at the player's layer: headless probes + in-page test surface + capture-to-file screenshots + scripted PLAY with event counters; instrument real input paths; verify the deployed URL with a new-code fingerprint plus one production bout. Done = observed effect.
10. No primitive hero assets. Store copy never claims a mode the code lacks.
