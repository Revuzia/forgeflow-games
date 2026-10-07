# SHELL-4 report (lane SHELL; running report, updated after every finished item)

Branch claude/exciting-faraday-2dakqx, local HEAD f01e476d at start. Nothing committed by this engineer (the orchestrator commits).
Scratch: `SC` = `C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967\3b1103ab-0174-4d88-adc9-dd448a718f0d\scratchpad\shell4\` (logs `SC\*.log`, filmstrips `SC\base_film`, `SC\new_film`).
As-found snapshot of HEAD (for before-numbers): `C:\Users\TestRun\AppData\Local\Temp\vs4\games\wobblehoard` (HEAD + my debugHook.ts; node_modules is a junction: remove with `cmd /c rmdir`).

## Status table (running)
| # | Step | Status | Key number |
|---|------|--------|-----------|
| 0 | baseline (as found) | measured | tsc clean; node_checks 114/114; probe_app 183/183; probe_gestures 128/128; probe_cut 17/17 in 621 s (logs `SC\base_*.log`) |
| 1 | portable harness, capsule-loop row, xp section | edits done, NOT yet run | prod-build runs vite.js with process.execPath; capsule-loop row is a real held press (ring must be 0 before) |
| 2 | whole browser shell harness in batches | not started | |
| 3 | Cut tool on the real physics, X01 to X10 | in progress | as-found: Reconnect all bridge visible ~0.05 s (surface gap 0.023 m at the start, -0.23 m after 0.07 s, -0.48 m after 0.12 s; wrigglo, 1280x800); parting gap 0.005 .. 0.03 m (slime strand = short thick band, see `SC\base_film\sheet_base_wrigglo.png`). Fix written: held bridge gap (cut.ts flowOf / flowD / follow), SETTLE_GAP trial 0.16 |
| 4 | lift / toss / bump routed + haptic, spied on the real engine | in progress | lift had NO haptic: now a tick (feedback.ts liftNow); dev hook spyStart / spyCalls (call-through spies on the real engine + haptics); harness section feel-routes written, not yet run |
| 5 | CALIBRATION.bendWithPress decision | rows written, not yet run | node_checks 7f (through the whole game on the real SoftBody) |
| 6 | UI faults (meter line, long names, hint pill) | in progress | hint pill: slides clear of the capsule's tap circle (hudBinding.ts avoidCapsule + CSS --hint-dx); sections hint-capsule, phone-names written, not yet run |
| 7 | two touches never lift (gesture-level) | section two-touch written, not yet run | |
| 8 | screenshots judged | not started | |
| 9 | final run + bundle | not started | |

## As found: the four never-run SHELL-4 browser sections on the committed tree (HEAD snapshot, `SC\asfound_shell4_sections.log`; port 5367)
`node _harness/browser_shell.mjs --port=5367 --only=toys-tray,snap-mat,cut-real,toys-phone`: **38/39 passed** (toys-tray 9/9 in 37 s; snap-mat 11/11 in 135 s; cut-real 12/13 in 354 s; toys-phone 8/8 in 51 s). The one failure, verbatim:
`FAIL toss a piece: a chunk pulled past 1.15 x maxPull is carried (lift), thrown on the let-go (toss) and lands; still two pieces  {"carried":false,"lift":0,"toss":0,"land":0,"kinds":["poke","release","grab","snap"],"pieces":1}`
Root cause (a TEST fault, fixed at the root in the harness, no threshold touched): the check pressed the chunk's shoulder that FACES the face piece; on that ray the nearer body is the face piece, so the finger pulled the face piece a little and let go while touching the chunk, which is a join (pieces 1, nothing carried). The check now grabs the chunk's OUTER shoulder (away from the face piece), pulls away from it, and also reports which body was grabbed.
Checks that already proved themselves with the real physics and stage as found: the real mouse swipe cutting a real SoftBody into two pieces (blade drawn, neck busy, shares 0.662 + 0.338, cut start + separate sounds), Split in two x2 -> 4 pieces, 6 pieces all in frame, Reconnect all whole at the middle of the table, drag-to-reconnect (the chunk dragged onto the face piece and held, a rejoin sound), the mat bump (`carried true, lift 1, toss 1, bump 1` from the physics' own events), a real PNG from Snap (1367919 bytes, 1280x800, sd 39: not blank), every leave path (Hoard, quick switch, hidden 30 s keeps / 60 s reconnects, capsule ceremony, reload). Weakness found in them: the "6 pieces ... a 7th cut is refused in words" row accepted `small` as the 7th result (`r7 small`), so it never proved the LIMIT line; the new cut-x section proves it with the biggest piece's middle (limit) and the edge (small) separately.

## Step 3 measurements so far (real shell, real physics, real stage; `SC\film_real.mjs`, 1280x800 high, wrigglo = slime; gaps are the SURFACE gap between the pieces' skins along the line of centres, from the dev hook pieceGaps)
| what | as found (HEAD, SETTLE_GAP 0.06) | now (held bridge + closed-loop parting gap 0.16) |
|---|---|---|
| parting: gap 0.12 / 0.24 / 0.42 / 0.72 / 1.12 s after the parting | 0.005 / 0.010 / 0.032 / 0.001 / 0.009 m (a short thick curl between touching pieces: `SC\base_film\sheet_base_wrigglo.png`) | 0.196 / 0.201 / 0.182 / 0.156 / 0.138 m (a long gooey thread, snaps at about 0.6 s: `SC\new_film\sheet_ctl_wrigglo.png`) |
| Reconnect all (2 pieces): time the skins are apart (bridge drawn) | 0.02 s (gap 0.023 m at the start, -0.23 m after 0.07 s, -0.48 m after 0.12 s) | 0.50 s (gap 0.039 at 0.02 s, peak 0.109 m at 0.28 s, closes at 0.52 s, whole at 1.22 s) |

## Known PHYS issue, reproduced once in the real shell (section cut-swell, `SC\live_b1_cutx.log`; high quality, 1280x800; highest particle of the squishy or its pieces during the cut, sampled every 0.05 s)
| species (family) | rest top | highest point | x rest | when |
|---|---|---|---|---|
| dollop (gel, control) | 1.01 m | 1.15 m | x1.14 | +0.317 s |
| thudge (putty) | 0.97 m | 1.79 m | **x1.84** | +0.417 s |
| boingle (firm silicone) | 0.76 m | 1.47 m | **x1.94** | +0.467 s |
Not papered over: the shell does not clamp, hide or reframe it (the render lane's headroom stopgap in stage.ts framingFor is the only mitigation). PHYS owns neckGoal (softbody.ts).

## Node rows run once on the live tree (`SC\nodechecks_run1.log`: 123/124 on the first run; the one failure was my own new haptics row, whose assumption was wrong, see below)
- 7f CALIBRATION.bendWithPress, through the whole game on the real SoftBody, dome-top press held 1.3 s: with the bend compression 0.25 / press 1.00, without it compression 0.03 / press 1.00; one release event each (intensity 1.00 / 1.00), one release sound, one release in the stats, one squelch voice; the meter holds 1.4800 SP, which is exactly one feed of that release into a fresh collection (1.4800 SP): never paid twice. **Decision: KEEP the bend** (a flat dome press still reads compression 0.03, about 0, so without it the toy only dents instead of squashing into the table); the row is a guard: it fails the day the flat press reads 0.1 or more.
- 7g the Cut tool on the REAL SoftBody through the whole game (mock stage): X01 0.501 + 0.499; the chunk steered to a 0.163 m surface gap 0.5 s after the cut and let go after SETTLE_S; X06 sp 0 -> 0; second cut 0.251 + 0.250 + 0.499; X04 Reconnect all ends in a FRESH whole SoftBody (frac 1), 148 setBridge calls, skins apart 0.78 s of the 1.2 s; X05 a switch of squishy while cut reconnects first.
- First-run failure verbatim: `FAIL SHELL-4 haptics: the lift plays a light tick (haptics.poke, once) ... plain: tick 2, thump 1; shift: tick 1`. Cause: the real body reports a `poke` SoftEvent when a pull starts (every pull has one tick), so the Shift pull that never lifts has 1 and the lone pull 1 + the lift's. The row was my own (new) and is re-specified to what is true: the lift adds exactly ONE tick (plain 2 minus Shift 1) and the throw's snap one thump.

## Log
- Read COMMON, RESUME, SHELL, NOTES_FOR_SHELL_CUT, CUT.md, FUN.md, LOCK.md s2, INPUT_SHIFT, VERIFY_INPUT_SHIFT, RENDER_R, VERIFY_RENDER_B_R1; read cut.ts, toyTray.ts, snapBar.ts, cutBar.ts, game.ts, bodies.ts, mat.ts, feedback.ts, feel.ts, hudBinding.ts, debugHook.ts.
- Step 1 edits in `_harness/browser_shell.mjs`: (a) prod-build: `spawnSync(process.execPath, [node_modules/vite/bin/vite.js, 'build', ...])`; (b) capsule-loop row "meter: a real poke moves the ring" is now a real mouse press held 1.2 s of sim time (the hook pauses and steps while the real button is down) and asserts the ring was 0 before.
- Source edits so far (all inside my lane): `src/shell/debugHook.ts` (spyStart / spyReset / spyCalls, pieceGaps(at), faceAnchor, stageViews, tools().body.top), `src/shell/cut.ts` (JOIN_S 0.5 -> 0.8, BRIDGE_HOLD_S 0.3, BRIDGE_GAP_K 0.3, flowOf / flowD / follow, SETTLE_GAP), `src/shell/feedback.ts` (liftNow: lift tick), `src/shell/hudBinding.ts` + `src/ui/styles.css` (hint pill avoids the capsule).
- Harness: browser_shell.mjs new sections cut-x, cut-low, feel-routes, hint-capsule, phone-names, two-touch; node_checks.ts: haptics row on the plain pull, 7f calibration rows.
