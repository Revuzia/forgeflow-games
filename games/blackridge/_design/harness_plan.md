# BLACKRIDGE — Verification Harness Plan

How every claim about this game gets PROVEN. Doctrine §5 is the law here:
**done = observed effect in the live system** — headless probes + in-page test
surface + screenshot capture + scripted play, and finally the DEPLOYED URL.
This plan adapts the driftwake `_harness/` rig (the best-proven rig in the
catalogue) to a first-person shooter.

Companion docs: `_design/visual_target.md` (the scorecard this harness feeds),
`_design/*` (art/combat/architecture specs from the other designers).

---

## 0. Non-negotiables inherited from driftwake (verified in its source)

These are paid-for; every script below keeps them.

1. **HEADED Chrome, never headless.** A hidden tab never fires rAF — the game
   freezes and every probe reads garbage (documented FFG lesson: "hidden
   Browser pane = no rAF = false broken"). Launch exactly as driftwake does:

   ```python
   br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
   FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
            "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
   ```

2. **utf-8 preamble in every script** (Windows consoles are cp1252; a print
   raising mid-report masks the real result):

   ```python
   for _s in (sys.stdout, sys.stderr):
       try: _s.reconfigure(encoding="utf-8", errors="replace")
       except Exception: pass
   ```

3. **Frames, not wall clock, for anything the sim drives.** Under Playwright
   the page renders well below 30 FPS; with the step clamped at 1/30 s,
   N counted rAF frames = exactly N/30 s of simulation on ANY machine. Wall
   clock buys whatever frame count the box delivered (this confound cost
   driftwake six critic rounds on 05-trail-berms). Every timed scenario uses
   the `__sfFrames`-style rAF counter + `untilFrames` / `until(predicate)`
   termination, and the manifest records whether the predicate actually fired.

4. **Pin held inputs with a constant getter** (driftwake `pin()`): pointer
   lock needs a user gesture we cannot forge, and the page's own mouseup/blur
   handlers clear held flags. `Object.defineProperty(input, 'fire',
   {get:()=>true, configurable:true})` is the one write nothing can undo.
   Real *edge* inputs (taps, key presses) still go through real dispatched
   events — pinning is only for *held* state that pointer lock would own.

5. **Record where the shot ended up.** Every capture logs player position,
   yaw/pitch, sim frame count, and scenario seed into `manifest.json`. Two
   frames from the same script showing different ground is invisible in the
   PNG and poison to the critic loop — the manifest is where it shows.

6. **Exit codes are the API.** Every probe returns 0 only when its acceptance
   criterion was OBSERVED. The build loop reads exit codes, not prose.

---

## 1. In-page test surface (the contract the game must ship)

Global: `window.__FPS__` (blackridge's equivalent of driftwake's `SNOWFLOW` /
kernel `__FFG3D__`). Shell contract ids stay per doctrine §6: `#boot`
(loader overlay, gains class `gone`, node removed ~6 s later), `#nogpu`
(gains class `show` on hard failure), `#view` (the canvas), plus
`window.__PAUSE__` and `boot.js?v=N`.

```js
window.__FPS__ = {
  version,            // build fingerprint string, bumped every iteration
  scene, renderer, camera,
  player,             // { position, yaw, pitch, hp, weapon, ammo, input }
  bots,               // live AI roster (read-only views)
  world,              // { heightAt(x,z)?, navQuery?, timeOfDay, rainPhase }
  perfStats,          // { drawCalls, triangles, programs, textures, gpuMs? }
                      //   fed by renderer.info with autoReset=false,
                      //   reset ONCE per frame in the main loop (doctrine §3)
  __test: {
    setScenario(name),     // full deterministic setup — see §5 Determinism
    placePlayer(x,y,z,yaw,pitch),
    give(weaponId), setAmmo(n),
    spawnBot(spec),        // {archetype, x,y,z, seed, frozen?}
    startMatch(opts),      // {seed, botCount, botSkill} — the real mission loop
    freeze(on),            // freeze sim clock + bot AI (for framing only)
    step(nFrames),         // advance the FIXED-dt sim n steps while frozen
    counters(),            // event counters — see §4 playprobe
    hud(show),             // hide/show every HUD element in one call
  },
};
```

Rules:
- The sim is THREE-free, fixed-dt, one mulberry32 stream per system
  (doctrine §4); `setScenario` re-seeds every stream, so the surface is a
  *reader/seeder*, never a second gameplay writer. The view reads events.
- `counters()` values come from SIM events, and the HUD increments its own
  independent tallies — parity between the two is a playprobe assertion.
- The surface ships in production (it is how deployverify works); it is
  behind no flag, does nothing until called, and adds no per-frame cost.

---

## 2. `_harness/` file plan

```
games/blackridge/
  _harness/
    bootcheck.py        # tight loop: does it boot clean? (seconds)
    shots.js            # the six named framings + seed table (data, no I/O)
    shotbattery.py      # drives shots.js -> _shots/iterNN/<scenario>.png
    perfprobe.py        # p99 frame time + hitch attribution
    playprobe.py        # persona bots through the REAL input path
    personas.js         # persona definitions (data, shared by playprobe)
    deployverify.py     # the LIVE URL: fingerprint + one production bot-match
  _shots/
    bootcheck.png
    iter01/ ... iterNN/ # one dir per critic iteration, never overwritten
    scores.jsonl        # append-only critic scores across all iterations
```

### 2.1 `bootcheck.py` — the tight feedback loop

Direct adaptation of driftwake's (keep its structure verbatim where possible):

- URL default `http://localhost:8841/games/blackridge/index.html` (§6 serve).
- Ready predicate: `!!(globalThis.__FPS__ && __FPS__.player && __FPS__.world)`
  (swap for driftwake's `SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig`).
- Keep the `#boot` absence-counts-as-gone logic **with the comment**: the
  loader removes the node ~6 s after `done()`, so `bootGone = !boot ||
  boot.classList.contains('gone')`; `#nogpu.show` is checked separately so
  absence can never hide a hard failure. This exact gotcha cost driftwake a
  false NOT-BOOTING-CLEAN verdict.
- Keep: console capture, SHADER_MARKERS grep for GLSL compile/link failures,
  `window.__err` init-script for uncaught errors/rejections, canvas size
  check, one screenshot to `_shots/bootcheck.png`.
- Add (FPS-specific): print `__FPS__.perfStats.programs` at ready — this is
  the pre-warm baseline the perfprobe compares against (adoption plan:
  compileAsync with a bound RT before frame 1; canvas-only compiles wasted
  25/47 programs in Claude-of-Duty).
- Exit 0 iff ready && bootGone && !nogpu && no shader errors && no page errors.

### 2.2 `shots.js` — the six named framings

Same shape as driftwake's shot objects (`{name, desc, tests, pose(F), settle,
hold?, until?, untilFrames?, walk?, after?}`), driven through
`__FPS__.__test`. Every shot begins with `__test.setScenario(name)` — the
scenario carries the full deterministic setup (§5) — then poses camera and
actors. `window.__sfChrome()`-equivalent hides HUD via `__test.hud(false)`
plus a selector sweep (`#hud, #crosshair, #hitmarker, #killfeed, #ammo,
#compass, #objective, .overlay, #perf`).

The six scenarios (names are the shared vocabulary between shots.js, the
scenario seed table, `visual_target.md`'s scorecard, and `scores.jsonl` —
**if visual_target.md ships different names, ITS names win and shots.js
renames to match; one vocabulary, no mapping tables**):

| name | framing | what it tests (critic dimensions) |
|---|---|---|
| `01-hero-vista` | mission-start overlook, sun low, map's signature landmark mid-frame, weapon lowered | art direction, tonemap/exposure, atmosphere/haze, terrain+architecture materials |
| `02-ads-viewmodel` | aiming down sights at a mid-range target, viewmodel filling lower frame | weapon model quality (no-primitive bar), sight geometry, DOF/FOV feel, hand/sleeve materials |
| `03-firefight` | mid-exchange with 3 bots: muzzle flash lit, tracers in flight, impact dust on cover — frozen via `__test.freeze` + `step()` to a designed frame | fx quality, dynamic light discipline (fixed pool), tracer/impact readability, smoke |
| `04-interior-cqb` | inside a dim structure looking out a bright doorway, one bot silhouetted | interior/exterior exposure contrast, bounce/ambient solution, shadow quality, silhouette readability |
| `05-weather-mood` | exterior under the mission's rain/overcast state, wet-surface response, distant fog | weather fx, wet material response, fog/atmospheric depth, puddle/reflection honesty |
| `06-soldier-closeup` | enemy soldier ~2 m, three-quarter view, mid-animation pose (running clip, never bind pose — doctrine §1) | character model/texture bar, gear/materials, animation pose naturalness, no-primitive bar |

Notes:
- `03-firefight` is the one shot that needs sim advancement to a *designed*
  frame: `setScenario` seeds it, `step(k)` (fixed steps, frozen clock)
  advances to the exact frame where the muzzle flash is lit. Never wall-clock
  it — that is the driftwake 06-surf-wake lesson applied to gunfire.
- Any shot that moves (walking into position) terminates on `until(distance)`
  or `untilFrames`, never a duration; `walk` is only ever the give-up timeout.

### 2.3 `shotbattery.py` — drives the battery, owns the iteration dirs

driftwake's `shoot.py` minus the two-target comparison (no WebGPU reference
here), plus iteration management:

```
python shotbattery.py --iter 3                    # -> _shots/iter03/*.png
python shotbattery.py --iter 3 --shots 02-ads-viewmodel   # subset while fixing
python shotbattery.py --iter 3 --url <cdn url>    # same battery vs deployed
```

- **1920x1080 viewport** (the CoD-bar critic must judge at presentation res;
  driftwake's 1280x720 was for A/B diffing, not absolute quality).
- Fresh page load per shot by default (`--no-reload` opt-out) so fx/decal
  state never carries over between framings.
- Injects `shots.js` as a classic script (same `export`-strip regex).
- Writes `_shots/iterNN/<scenario>.png` + `_shots/iterNN/manifest.json`
  ({url, viewport, git-ish version string from `__FPS__.version`, per-shot:
  seed, endPos, yaw/pitch, simFrames, untilReached, pageErrors}) +
  `console.log`.
- **Never overwrites an existing iterNN dir** — refuses with exit 3. History
  must stay diffable; a re-run of the same iteration goes to `iterNN` only
  after the caller deletes it deliberately.
- Exit 0 only if every requested shot captured AND every `until` fired.

### 2.4 `perfprobe.py` — p99 + hitch attribution

driftwake's rAF-delta sampler, upgraded to the adoption-plan verdict
(doctrine §3: report p99 and attribute hitches, never averages):

- Sampler records, per rAF: `dt`, and `perfStats` counters
  (`programs, textures, drawCalls, triangles`) — cheap reads because the game
  keeps `renderer.info.autoReset = false` and resets once per frame itself.
  The probe ASSERTS that discipline at start: two consecutive frames with
  monotonically exploding drawCalls = autoReset misconfigured = exit 2
  (with any composer the numbers otherwise describe the last pass only).
- Three measured phases, each seeded via `setScenario`:
  1. `perf-static` — 01-hero-vista pose, 10 s idle.
  2. `perf-combat` — `startMatch({seed, botCount: 8})`, persona `rusher`
     driving the player (from personas.js) for 30 s of real fighting:
     muzzle flashes, tracers, impacts, deaths, ragdolls.
  3. `perf-traversal` — scripted sprint across the map's longest sightline
     (streaming/LOD stress).
- Verdict per phase: median / p95 / **p99** / 1% low, plus a hitch table:
  `hitch = dt > max(2*median, median+8ms)`; each hitch row records the
  co-located counter deltas — `programs` jump = shader compile (pre-warm
  hole), `textures` jump = upload stall, neither = CPU/GC.
- **Gate assertions** (exit code):
  - `programs` delta == 0 across the entire perf-combat phase (pre-warm
    complete; first muzzle flash/decal/ragdoll compiles nothing).
  - p99 >= 30 fps equiv (<= 33.3 ms) at DPR 1.5, 1920x1080, on this box;
    p50 >= 60 fps equiv. (Tune floors once; then they are regression rails.)
- Targets: local port by default; `--url` for the CDN build (the deployed
  perf claim comes from deployverify calling this with the live URL).

### 2.5 `playprobe.py` + `personas.js` — scripted play through the REAL input path

Doctrine §2/§5: play finds what audits can't, and the input features must be
tested through the input layer — dispatch real `KeyboardEvent`/`MouseEvent`
(driftwake's `T.fight()` shortcut would have bypassed the input buffer
entirely; same trap here with `__test` fire helpers).

- **Input rules:** movement/actions via
  `window.dispatchEvent(new KeyboardEvent('keydown', {code, bubbles:true}))`;
  trigger via real `mousedown`/`mouseup` (MouseEvent) on the canvas; look via
  pinned yaw/pitch writes ONLY (pointer lock cannot be forged — pin per §0.4
  and say so in the report: look is the one non-real path, everything else is
  real). Reload/weapon-switch/grenade all real key events.
- **Personas** (personas.js, each `{name, seedOffset, tick(F, rng)}`):
  - `rusher` — sprints at nearest bot, hip-fires, never reloads until empty.
  - `optimal` — takes cover, ADS, center-mass aim with 150 ms reaction delay,
    reloads behind cover. The skill ceiling probe.
  - `novice` — 350–500 ms delayed reactions, wide aim jitter, forgets to
    reload. The fairness floor probe.
  - `camper` — holds one position, only fires on LOS. Probes whether bot AI
    can flank/dislodge (anti-passivity: a camper must not win by default).
- **Event counters** (from `__test.counters()`, sim-sourced):
  `shotsFired, shotsHit, headshots, damageDealt, damageTaken, kills, deaths,
  reloads, grenadesThrown, botShotsFired, botShotsHit, botTimeToFirstShotMs[],
  stuckBotSeconds, matchResult, simFrames`.
- **Parity checks** (the honest-HUD assertions):
  - HUD hitmarker count == sim `shotsHit` (view reads events, never invents).
  - HUD ammo == sim ammo after every reload.
  - kill feed entries == sim `kills + deaths`.
- **Verdict assertions** per persona battery (all on identical seeds):
  - `optimal` beats `novice` on every seed (skill is real).
  - `novice` survives ≥ 60 s median (bot fairness: 300–800 ms reaction delay
    + aim jitter constants actually landed — Operation Ironhold constants,
    doctrine §2).
  - Bots never fire through cover: zero `botShotsHit` while target fully
    occluded (muzzle-block raycast honest).
  - `camper` does not win passively; bots dislodge or flank within the match
    timer.
  - `stuckBotSeconds` == 0 (no bot pinned against geometry > 3 s).
  - Every match ENDS (referee/timeout — doctrine §2: every bout ends).
- Output: one JSON row per persona per seed to stdout + exit 0 iff all
  assertions hold. Re-run the whole battery after every combat-layer change;
  verdicts never round up.

### 2.6 `deployverify.py` — prove the DEPLOYED game

Doctrine §5 verbatim: exit-code-0 deploys have lied. After every R2 upload:

1. Fetch `https://forgeflow-games-cdn.isimcha85.workers.dev/blackridge/index.html`
   (and `boot.js?v=N`) — HTTP 200, correct content-type.
2. **Version fingerprint:** page must contain the *current* `__FPS__.version`
   string AND one grep for a marker that exists only in the new code (pick
   the marker from the actual diff each deploy — a bad grep against an old
   marker is how stale CDN slipped through before).
3. Boot the live URL headed (bootcheck logic, `--url` swap): clean boot,
   zero shader errors, zero page errors.
4. **One production bot-match** via the test surface: `startMatch({seed:
   PROD_SEED, botCount: 4})` + `rusher` persona for 60 s; assert counters
   moved (shotsFired > 0, at least one kill or death) and the match ended.
5. Optional `--perf` — run perfprobe's perf-static phase against the CDN.
- Report deployed state SEPARATELY from local readiness. Exit 0 = the live
  game observably plays. CDN edge staleness: if the fingerprint fails, purge
  and re-check once after ~5 min before declaring the deploy bad (doctrine
  §7 purge rule; "action taken, verification pending" is the honest report
  if the window expires).

---

## 3. The critic loop (this drives the whole build)

One iteration = build change → shotbattery → cold critics → fix list →
builders → repeat. The critics are the quality gate; the harness exists to
feed them identical, deterministic frames every round.

### 3.1 Protocol

1. Builder finishes a change set; bumps `__FPS__.version` and `boot.js?v=N`.
2. `python shotbattery.py --iter N` → `_shots/iterN/` (six PNGs + manifest).
   A failed capture (missed `until`, page error) BLOCKS the iteration — never
   score a non-comparable frame (the six-round driftwake lesson).
3. **Critics read the PNGs cold.** Fresh subagent(s), given ONLY:
   `_shots/iterN/*.png` + the scorecard section of `_design/visual_target.md`
   + (from iter 2 on) the previous iteration's PNGs for the same scenarios.
   NO source code, no build notes, no builder chat — a critic who knows what
   was attempted scores the attempt, not the pixels. Two critics minimum on
   ship-decision iterations (75%-consensus pattern for the final call).
4. Critic appends one line per (scenario × dimension) to
   `_shots/scores.jsonl` and emits a ranked fix list (worst tell first,
   phrased as observations: "muzzle flash lights nothing around it", never
   prescriptions).
5. Builders take the fix list, fix at the GENERATOR level (pipeline/module,
   never the PNG's symptom — never-patch-games rule), go to 1.

### 3.2 `scores.jsonl` append format (one JSON object per line)

```json
{"iter": 3, "scenario": "02-ads-viewmodel", "dimension": "weapon_materials",
 "score": 6, "verdict": "CLOSE",
 "worst_tells": ["rail reads as smooth plastic — no roughness variation",
                  "front sight has no thickness at ADS distance"],
 "critic": "critic-a", "ts": "2026-08-19T18:00:00Z", "version": "0.3.1"}
```

- `score`: integer 0–10 against the CoD-bar anchors defined in
  `visual_target.md` (10 = MW2019 screenshot, 5 = typical browser FPS,
  0 = primitive-assets tier).
- `dimension`: from visual_target.md's fixed dimension list — same strings
  every iteration or trends are unplottable.
- `verdict`: `SHIP` (meets bar) / `CLOSE` (one focused fix away) / `FAR`.
- `worst_tells`: concrete, pointable observations; these become the fix list.
- Append-only, never edited; the file IS the build's quality history.

### 3.3 STOP rule

- **Ship bar met:** every scenario's mean score ≥ the ship threshold defined
  in `visual_target.md`, AND no single (scenario × dimension) below its
  floor, on the verdict of ≥ 2 cold critics → stop iterating on visuals,
  proceed to play/perf gates and deploy.
- **Plateau:** 2 consecutive iterations with no improvement in any scenario's
  mean score (compare iterN vs iterN-1 vs iterN-2 from scores.jsonl) →
  STOP burning iterations and escalate to the owner with: the trend table,
  the 3 worst tells, and the builder's honest assessment of what the plateau
  is (asset ceiling? technique gap? needs Meshy/asset spend?). Escalation
  goes through the session outbox (Telegram = automations only).
- Never both-loop: after a plateau escalation, no further iterations until
  the owner answers.

---

## 4. Local serve plan

- **Port 8841.** Census of hardcoded harness ports in the repo this session:
  8799 (driftwake), 8788 (serve_nocache default), 8771, 8875 — all avoided.
  8841 appears nowhere in `games/**/*.py`.
- One command, run from repo root, left running for the whole session:

  ```
  python "C:/Users/TestRun/Claude Claw/forgeflow-games/serve_nocache.py" 8841
  ```

  `serve_nocache.py` already sends `no-store` on everything and serves
  `.js/.glb/.gltf/.wasm/.json` with correct types — reuse as-is, zero new
  server code.
- Game URL: `http://localhost:8841/games/blackridge/index.html`.
- **Cache-bust discipline (doctrine §6):** `index.html` references
  `boot.js?v=N`; N bumps EVERY iteration. ES modules cache hard and a bumped
  boot does not bust its imports — locally `no-store` covers the imports, on
  the CDN the deploy purge + hashed-asset rules cover them; the `?v=N` is
  what makes a stale boot.js impossible on both. `__FPS__.version` mirrors N
  so the manifest and deployverify can assert which build produced a frame.

---

## 5. Determinism — identical framings across iterations

Critics compare iterN against iterN-1 pixel-for-pixel intent; ANY
uncontrolled variation becomes a phantom defect (driftwake round 6). So:

- **Scenario seed table lives in shots.js** (one place, versioned with the
  shots): `SCENARIOS[name] = {seed, timeOfDay, rainPhase, botSeed,
  playerSpawn, botSpecs[]}`. `__test.setScenario(name)` consumes exactly this
  object — the harness passes it in, the game stores nothing scenario-shaped.
- `setScenario` must, atomically:
  - re-seed every mulberry32 stream (one per system — doctrine §4: a bot
    replay must not depend on whether the weather system ran);
  - **freeze time-of-day** at the scenario's sun angle (sky animation, sun
    drift, cloud scroll all halted);
  - **freeze rain/weather phase** at `rainPhase` (particle field seeded and
    phase-locked, puddle ripple phase pinned, wind gusts seeded);
  - zero all transient state: decals, tracers, casings, corpses, sim clock.
- Bots in shot scenarios spawn `frozen: true` (posed under a running clip per
  doctrine §1 — never bind pose — but not thinking); playprobe scenarios
  spawn them live with `botSeed`.
- Sim advancement in scenarios is only ever `step(n)` on the fixed clock or
  frame-counted rAF (`untilFrames`) — never `wait_for_timeout` as a sim
  duration (wall clock is a give-up timeout ONLY, and manifests record when
  it fired instead of the predicate).
- The playprobe persona battery runs every persona over the SAME seed list
  (e.g. seeds 11, 23, 47) so a combat change's effect is measured on
  identical matches, and regressions are attributable to the change, not the
  dice.

---

## 6. Claim → proof map (what each future assertion must cite)

| Claim | Proof artifact |
|---|---|
| "it boots clean" | bootcheck.py exit 0 + `_shots/bootcheck.png` |
| "it looks like the target" | scores.jsonl SHIP verdicts from ≥2 cold critics on `_shots/iterN/` |
| "it runs well" | perfprobe p99 + zero-hitch-attribution table, combat phase |
| "pre-warm works" | perfprobe programs-delta==0 during perf-combat |
| "combat is fair / skill matters" | playprobe persona battery, all assertions, identical seeds |
| "the HUD is honest" | playprobe parity checks (hitmarkers/ammo/killfeed vs sim counters) |
| "the deploy is live" | deployverify exit 0: fingerprint + production bot-match on the CDN URL |

Anything not on this table gets a probe added to `_harness/` before the claim
is made. No probe, no claim.
