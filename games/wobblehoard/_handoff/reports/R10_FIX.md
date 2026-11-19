# R10_FIX: round 10, the single FIX engineer (any file under src and _harness; ports 5364 to 5369). No git write command is run.

Brief: the orchestrator's round-10 task. Started 2026-11-19 ~05:10 UTC at HEAD 408ec9fb8 (= d2bd392ea's tree + the verifier's report).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r10_fix/` (`S/` below).
Inputs read: VERDICT_R9.md (provisional verdict 05:00: NOT READY; (c) low tier Hearthlog 5/4, Ripple 2/2, Frostbell 5/2, Rainleaf 4/2, Lanternroof 1/5, Cloudloft 3/2), SESSION3.md, R9_FIX.md.

## Status
| item | what | state |
|---|---|---|
| 1 | browser vs node: 3+ different things used on their own in 180 s at all six places, 1280x800 + 390x844, low + high tier; probe_life_selfuse tall + 180 s | PARTLY: causes found, three host fixes, probe SU-04 added; the bar is NOT met (node numbers below); no browser run |
| 2 | Rainleaf phone stuck squishies; general unstick | cause found (= item 1's cause 1, asleep waiting for the wake); turn rule + unstick detour; not browser-checked |
| 3 | download size: total < 2000 KB, first-play closure delta <= 70 KB, life set at Wake <= 150 KB, vite build T1 gate | A1 fixed (three.core back to 207,179 B); T1 gate added and FAILS the build (2082.6 KB); A2 and A3 not done |

## 1. Browser vs node sim: why (in progress, 06:30 UTC)
**The node probe reproduces the browser** once it runs what the browser ran: `_harness/probe_life_selfuse.ts` takes `frame=wide|tall` (390x844: the TALL layouts and
the phone flag) and `tier=low|med|high` (the tier the stage reports; it was hard-wired 'high', 1280x800 only). Party Dollop + Glimglop (slime) + Crimpo (dough), 180 s
(`S/base1.log`): tall low Ripple 3, Lanternroof 4, **Rainleaf 1, Frostbell 1, Cloudloft 2**; wide low **Ripple 1**, Lanternroof 3, Rainleaf 5, Frostbell 3, **Cloudloft 2**;
tall high 3 / 5 / 4 / 4 / 3. (SQ-01's pool spot is the wide layout's: it fails by construction in `frame=tall`; fixed below.)
**Causes found by trace** (`S/tr.ts`, 0.5 s samples of LIFE's behaviour, phase, mover token, wait flag, body asleep / scooting / hushed):
1. The quality tier sets LIFE's awake budget (attention.ts: low unitCap 1.06, moverCap 1 = ONE awake whole; med 1.345, one; high 2.494, two). At low, a sleeping
   squishy's use could start only when the one awake squishy fell asleep by itself: an awake one idling, riding, napping awake held the wake, and the others sat in
   "USE x" phase 0 asleep, retrying every 8 s (the verdict's "USE seedpod 77 s while moving 0.21 m").
2. The over-budget rule's count (round 5): excess / one whole's wake, rounded up. A walker bumping a sleeper wakes it (2 wholes + their touching pair = 2.28 against
   1.06), the count said TWO sleeps, and the second was the walker itself (hushed 4 s, its walk lost). In the tall layouts (2.8 m wide) a party of three stands close,
   so nearly every walk at the low tier ended this way within 1 s.
3. A sleeper is a wall a scoot cannot move: the walker pushing a re-slept body made 2 to 3 cm per 0.5 s.
4. The slow families walk 0.05 (slime) to 0.07 m/s (dough) in practice; tall layouts are 6 m deep, so one walk can take 20 to 60 s, and the floor starts at 60 s.

**Fixes (all in the lazy life chunk `src/shell/later-life.ts`, places other than Home and the cabin only; LIFE's caps, usesFull, cooldowns and SU-03 unchanged)**:
- the TURN (world.ts `lifeWaitsTurn`, `lifeBusy`, `lifeUsesOf`, exported by step.ts): one sleeping squishy whose by-itself use waits for its wake, while LIFE's mover token is
  free, counts its wake as pending in the over-budget rule; the sleeps it needs take only squishies doing nothing that moves (no LIFE walk, no moment, not touched or
  riding), the one that used most first. The cap is unchanged: the waiter wakes into the room another's sleep made.
- the excess is counted down by what each sleep really frees (a whole's wake + the pair unit of every awake body it touches); an awake squishy standing still sleeps
  before a walker; the farthest scoot is stopped only when no such one is awake.
- the body a LIFE walker is pushing past is not slept while they touch (as round 6 spares the bodies an asked squishy touches).
- dev only: lifeDebug's `wait`, the host debug's `scoot` / `hush` per squishy.
**Tried and reverted**: no thing-less moments (chat, snuggle, peekaboo...) under the floor (social.ts): no better (`S/eval_v2.log`).
**Node numbers after (party as the browser's, 180 s, one run each; `S/eval_v1.log`)**, before -> after:
| frame / tier | Ripple | Frostbell | Rainleaf | Lanternroof | Cloudloft |
|---|---|---|---|---|---|
| tall low | 3 -> **2** | 1 -> 4 | 1 -> **2** | 4 -> 4 | 2 -> 3 |
| wide low | 1 -> 3 | 3 -> 5 | 5 -> 3 | 3 -> 3 | 2 -> 3 |
| tall high | 3 -> **2** | 4 -> 3 | 4 -> 4 | 5 -> 5 | 3 -> 3 |
| wide high | - -> 4 | - -> 5 | - -> 3 | - -> 5 | - -> **2** |
Better at the low tier (sum 29 -> 32 over the two low rows), still failing: Ripple tall, Rainleaf tall low, Cloudloft wide high. Runs are chaotic (a trace run of the same
case gave 3 where the plain run gave 1), so single runs are weak evidence. **Remaining causes, not fixed**: slow families (slime 0.05 m/s measured) on the 6 m deep tall
layouts spend 20 to 60 s per walk; joint moments (snuggle 16 to 22 s, peekaboo up to 40 s) take the one awake slot at the low tier; the floor starts at 60 s
(FLOOR_AFTER_S, kept: R9 needed it for node_checks). Next step I would take: let the floor act from the arrival in places other than the cabin and re-run node_checks;
pick the NEAREST new thing under the floor at the low tier (walk cost), and cap a thing-less moment's length while the floor is unmet.
**Probe**: `_harness/probe_life_selfuse.ts` `frame=wide|tall`, `tier=low|med|high`; new **SU-04** in the default run: Dollop + Glimglop + Crimpo, 180 s, every place, at
tall/low, wide/low, tall/high, wide/high, at least 3 things each (`--no-su4` skips it). It FAILS today, as the browser does. SQ-01 uses the Rock Pool of the layout in use.
node_checks 185/185 after these host changes (`S/nc1.log`, 96 s).

## 2. Rainleaf phone: two squishies held for 2.5 minutes
Cause (trace `S/tr2_rain_tl.log`): not a wall; both were ASLEEP in a use's first phase waiting for their wake (item 1 cause 1), retrying every 8 s, while the one awake
squishy rode the Leaf Teeter or napped awake. The turn rule gives them the wake. **General unstick** (later-life.ts `unstick`): round 9's lift (a LIFE scoot with no
headway for 4 s, the spot more than 1 m away) gave up whenever the straight 0.6 m step met another body or the bounds; it now tries 0.6 and 1.2 rad to either side.
Not browser-checked.

## 3. Download size
- **A1 fixed**: the +14.9 KB in `three.core` (first play) came from `src/render/places/cloudloft.ts`'s Sunbow Arch: `THREE.TubeGeometry` over a `CurvePath` of
  `LineCurve3` / `QuadraticBezierCurve3`, their only users; three.js is one module, so a lazy place pulled them into the first-play chunk. Replaced by `archTube()`
  (same grid, order, normals, uvs; compared with TubeGeometry in node: positions within 3e-5 m, normals 8e-5, uvs and index identical). Build (`S/dist1`):
  `three.core` **207,179 B** (HEAD 222,068; live 23c684a60 207,179), so the verifier's +75.5 KB delta becomes about **+60.6 KB** (cap 70) by the same files.
- **T1 gate** (vite.config.ts `sizeBudget`): every file under `dist/assets` at most 2000 KB (decimal); `vite build` prints `[T1]` and FAILS over it. It fails NOW:
  **2082.6 KB** (A3 open: 83 KB over). The deploy build cannot pass until A3 is done (or the owner moves the cap: not my call).
- **A2 (life set at Wake 182.5 KB: later-life 69.7 + later-brain 112.9) and A3 (total): NOT done** (no time). PLAYGROUND_BUILD 14.3's overflow order applies: pack
  tables, then move what is not needed at once into a lazier named chunk (place-only host and brain code, the dev debug view).

## Tried after (reverted): the floor from the arrival (FLOOR_AFTER_S 0), single runs: Ripple tall low 2, Rainleaf tall low 3, Ripple tall high 3, Cloudloft wide high 2.
Not convincing on one run each and R9 needed the 60 s for node_checks, so it is back at 60. Hypothesis for Ripple tall, not checked: the Shell Chimes stand at z -3.10,
outside the tall bounds (hz 3.0), and the Sand Mound at x 1.33 against hx 1.4: their use points may fall outside the shrunk bounds, leaving the slime and dough
the ball, the log and the pool.

## Regression (this tree; `S/*.log`)
tsc clean. node_checks 185/185; probe_app 188/188; probe_playground --quick 74/74; probe_pg_lifequests 16/16; probe_chatter 42/42; probe_life 127 ok / 1 (LF-02,
known); probe_r8_features 9/9; renderview pg_node_checks 40/0; probe_pg_data 44 ok / 1 (DT-18 silhouette, known); probe_quests all run ok (3 NOT RUN, as before);
probe_journal all; probe_trophies 31/31; probe_merge 22/22; probe_gestures 160/160. probe_life_selfuse (full, with SU-04): see below.

**probe_life_selfuse, full default run on this tree (`S/su_full.log`, 37 min on a loaded machine; the unstick detour of item 2 was edited in after it started)**:
SQ-01 x2 ok; **SU-01 ok at all six places, 5 of 5 parties** (min / median / max: Hearthlog 5/5/6, Ripple 3/4/5, Frostbell 5/5/6, Rainleaf 3/4/5, Lanternroof 4/4/5,
Cloudloft 3/4/4; R9's were 5/5/6, 3/3/4, 4/5/5, 3/5/5, 3/4/5, 3/4/4); SU-02 6 of 6; SU-03 ok (most 7 episodes, host records at most 10). **SU-04 (new): 16 of 24 ok, 8 FAIL**:
| place | tall low | wide low | tall high | wide high |
|---|---|---|---|---|
| Hearthlog | 4 | 4 | **2** | 6 |
| Ripple | 3 | **2** | 3 | 3 |
| Frostbell | **2** | 4 | **2** | 4 |
| Rainleaf | 3 | 4 | **2** | 3 |
| Lanternroof | 4 | **2** | 5 | 4 |
| Cloudloft | **2** | 3 | **2** | 4 |
(Hearthlog is untouched by this round: the cabin keeps round 8's LIFE and the host's old rule, so its tall-high 2 is the existing behaviour.) Item 1 stays OPEN: the
owner's bar is not met in node at 180 s, and no browser run was made this round (it would only confirm the node failures).

## Files changed
src/shell/later-life.ts (turn rule, excess counted by what a sleep frees, idle before walker, pushed body spared, unstick detour, dev debug scoot/hush);
src/life/world.ts (lifeWaitsTurn, lifeBusy, lifeUsesOf); src/life/step.ts (exports; lifeDebug `wait`); src/render/places/cloudloft.ts (archTube for the Sunbow Arch);
vite.config.ts (T1 gate); _harness/probe_life_selfuse.ts (frame=, tier=, SU-04, SQ-01 pool per layout); this report.
No process of mine is left running.
