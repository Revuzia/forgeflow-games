#!/usr/bin/env python
"""gate - every Last Circle gate in one run: Node selftests, then each browser gate, one verdict table (PLAN section 5).

    python _harness/gate.py --disk                         # the integration run (serves the working copy; no server needed)
    python _harness/gate.py --disk --only bootcheck,leaktest
    python _harness/gate.py --rev 7da063ad --skip mobile,probe_match
    python _harness/gate.py --disk --negative-controls     # also prove rigcheck / portalcheck still FAIL on a planted fault

Node first (`node <file>` for every runtime/**/*.selftest.cjs: royale.selftest.cjs, aimassist.selftest.cjs, the audio pool
selftest when they exist) - they prove the SIM only. Then the browser gates run ONE AT A TIME (one Chrome at a time on this
shared box), each as its own process with the same --base / --disk / --rev / --headed / --gpu flags:

  bootcheck   bootguard   rigcheck (3 seeds)   playtest   portalcheck (--matrix)   framecheck   lifecycle   feelcheck
  layoutcheck (desktop + phones)   mobile (4 devices)   probe_match (>= 6 seeds, storm on)   leaktest (3 ashgrid)
  then the Wave-4 lane gates (_harness/new/<lane>_<name>.py, registered 2026-10-12; the same exit-code convention):
    artb_check   art_a_clips   art_a_canopy   art_a_integration   artb_decode   artb_integration
    stormfx_fx   stormfx_storm   loot_beams_rings   sky_probe (--merged)   sky_lowtier (--merged)
    hud_checks   hud_cycle
    player_dlcount   player_deaths   player_canopy   player_camwall   player_rim   player_dive
    orch_lowpost   orch_progkey   sim_pacing (10 whole matches: the long one)
  then the Wave-5 world-foundation gates (lane 5D, 2026-10-12; each must FAIL on the Wave-4 commit 7f6a9fb2):
    placementcheck (Node only, ~25 s, runs first)   collisioncheck (one Chrome per map)   navcheck (one Chrome per map)
  and the Wave-5 fix-round gates promoted from the lanes' scratch probes (lane F1, 2026-10-13; each also FAILS on 7f6a9fb2):
    worldcheck (Node only, runs second: baked table current, deterministic builds, GLB-failure / table-404 paths, RNG stream vs Wave 4)
    worldlive (one Chrome per map: chests, every ramp, ranger towers, ramp sides, fine fall scan, crosshair)
  and the leftovers-round rows (lane L4-gates, 2026-10-13; each FAILS on the Wave-5 release 3fce7529 and on 7f6a9fb2; heal-pockets reads 94.0 % there on geometry-only
  placements: the Wave-4 sim has no ramp-side collision, so no healer can be pocketed and the misses are other stalls): navcheck heal-pockets (a healer tucked against a ramp gets out within
  2 s; on 7f6a9fb2 it is judged on geometry-only placements: the Wave-4 sim has no ramp-side collision), collisioncheck container-lean + sprints-rocks, worldlive ramps-walk-fine (every ramp of 5 seeds x 3 maps, walk and sprint, every start phase)
  and the Wave-6 city / perf gates (lane 6E, 2026-10-13): placementcheck now also gates the Wave-6 rows (base-edges, doorway-clearance, ramp-start-step, roads-float,
  ground-match at 1e-4 m, pads); citycheck_selftest (the pinned enterable-building detector on a synthetic village, offline); perf_district (calls / triangles at three
  fixed cameras vs a baseline revision - bd523284 in Wave 6, the LIVE build common.LIVE_REV since Wave 7); citykit_probe (lane 6C's C-KIT browser gate); citycheck (INFORMATION in
  Wave 6 - no town was wired into the live game, so its coverage rows were expected to fail; a COUNTED --blocking gate on Savanna since Wave 7, see below)
  perfcheck, orch_lowpost_ab (INFORMATION ONLY: shown, never counted)
  and the Wave-7 rows (lane 7D, 2026-10-14; Savanna = ashgrid is the city pilot, Isla Viva / Deepwood follow in Wave 7b):
    citycheck is now a COUNTED gate (--blocking on ashgrid, 200 seeds; Isla Viva / Deepwood rows stay information); perf_district's default baseline is the LIVE build
    (common.LIVE_REV) and runs on the two unchanged maps too (perf_district_themed); nancheck (Node: no non-finite ground on 200 seeds x 3 maps), lootcheck (Node: probe_loot --gate),
    squadguard_live (the squad version guard in a real browser), framecheck_ashgrid / framecheck_deepwood, layoutcheck_ashgrid / _deepwood, mobile_ashgrid, rigcheck_ashgrid / _deepwood,
    probe_match_ashgrid (replay + census + paths on Savanna), loot_beams_rings_ashgrid, perf_district_phone (the phone tier; COUNTED since the Wave-7 completion round), kitcollide / navcheck_towns (when their lanes land)

--negative-controls adds the planted-fault runs, each of which must exit 1: rigcheck --inject-regression, portalcheck minus
allow-pointer-lock, bootguard j/k --plant no-card and --plant hidden-card, bootcheck --plant lock-drop, feelcheck --plant
kill-marker-short, layoutcheck --only phones --plant no-touch-ui, framecheck --plant forced-layout, loot_beams_rings
(flush-clear, storm-ignore), sky_probe (fog-flat, no-rng-burn, no-handles), sky_lowtier (one-layer-broken); the Wave-5 gates:
placementcheck (y-only-recentre, perimeter-drop, tree-float, stack-float: the built map is mutated in memory; and the Wave-4 commit itself), collisioncheck served from the
Wave-4 commit (--rev 7f6a9fb2), navcheck (nav-l3, raw-strafe, heal-yaw: bots.js / ffg_royale3d.js served patched by a page route), worldcheck
(the Wave-4 commit, stale-table, rng-shift: scratch copies), worldlive (the Wave-4 commit; ramp-sides-open: player.js served patched);
the leftovers-round rows (each pinned to the Wave-5 release 3fce7529, which has the residual they cover): collisioncheck-wave5-release,
collisioncheck --plant container-narrow / rocks-small (the baked table served with the container / rock boxes edited), worldlive-wave5-release,
worldlive --plant ramp-solid (player.js served with every ramp blocking), navcheck-wave5-release, navcheck --plant pocket-raw (ffg_royale3d.js served with
a hook: healers back straight away from their threat);
and feelcheck
--plant blind-sampler, which must exit 2 (a blinded sampler is could-not-judge, never a verdict);
the Wave-6 controls (lane 6E): placementcheck --plant no-pads / door-buried / ramp-lip / roads-lifted / ground-shift (the built map mutated in memory; --quick), placementcheck
--rev bd523284 --rows <the promoted rows> and --rev 7f6a9fb2 --rows ramp-start-step (frozen builds), perf_district --plant extra-calls / extra-tris and --rev bbd6aeae (Isla Viva drop view 525 calls), citycheck --rev bd523284
--blocking (the Wave-5 release has no towns), citykit_probe --plant <each of lane 6C's six>.
The Wave-7 controls (lane 7D): citycheck --rev 60b854d0 --blocking --quick (0 pass / 5 fail), nancheck --rev 60b854d0 (the Wave-6 maps.js has the NaN ground), lootcheck --loot-rev 60b854d0
(the Wave-6 loot.js), squadguard_live --plant no-guard / bare-import, framecheck_ashgrid --plant extra-tris, loot_beams_rings --plant chest-beams-short (both maps), layoutcheck_ashgrid
--plant no-touch-ui, rigcheck_ashgrid --inject-regression, worldcheck --plant rng-shift (now judged on Isla Viva + Deepwood alone: Savanna's stream is changed on purpose).
The Wave-7 fix round (lane 7G, 2026-10-14): feelcheck guards its subject from the lobby and protects the whole landing (it lost its subject to a pistol bot on the default
config, ashgrid seed 4242); hud_cycle compares lobbies on the SAME map (it pins the die roll of the real "Find a new match" click; --plant leak-geometries / leak-textures
must FAIL); warm_programs (new/warm_programs.py, lane 7F's gate) is registered, with --plant no-arm / no-icons and the live Wave-6 build 60b854d0 (--rev,
exits 1) as its controls; framecheck's 10-SPACE-toggle row no longer counts the terrain's lazily built near-LOD chunks (--plant chute-leak must still FAIL it, on Deepwood).

The Wave-7 completion round (lane D5, 2026-10-15): perf_district runs the five Savanna seeds (PERF_SEEDS) against common.LIVE_REV AND against the Wave-6 release (one candidate match per seed judged against
both: the plan's original +40 calls / x1.25 triangles bar, cumulative); genversion (Node: the squad world contract - if the world differs from LIVE_REV's, MAP_GEN_VERSION must have moved); rocksweep (the
real-mover sweep of EVERY isolated rock: 3 maps x 5 seeds, exact count 0; must FAIL on WAVE7_REV and with the old mover served over the tree) and rocksweep_nolip (INFORMATION: the same with the rock lip collider
stripped); navtown's top-storey rows (must FAIL on WAVE7_REV); roofland (bots that glide onto a roof leave it: roof-exit <= 8 s, roof-standstill <= 4 s in total; must FAIL on WAVE7_REV); coldcache (one consistent build for a
cold cache); lane D1's squad fallback cases in squadguard_live (+ squadguard_live_fallback_full); framecheck_deepwood is COUNTED (it passed 18/18 four times); squadguard_live_cdn (INFORMATION in the
integration run: it judges the DEPLOYED build, read-only, not the candidate); simcost (INFORMATION); and the Savanna and Deepwood coverage invocations probe_match_deepwood, sim_pacing_ashgrid / sim_pacing_deepwood,
navcheck_seeds and collisioncheck_seeds. `gate.py --disk --post-deploy` runs the post-deploy check (POST_DEPLOY: coldcache --live, squadguard_live --live, the new perf baseline). See README "Wave-7 completion round".

Each gate's stdout goes to _harness/_reports/gate_<stamp>/<gate>.log and its JSON report to _harness/_reports/. A gate exits
0 pass / 1 fail / 2 could-not-judge; a timeout or a crash of the gate process is could-not-judge. The overall verdict:
any fail -> FAIL (exit 1); else any could-not-judge -> COULD-NOT-JUDGE (exit 2, re-run those gates; never counted as a
pass); else PASS (exit 0).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

WAVE6_REV = "60b854d0"       # the Wave-6 release (live until the Wave-7 deploy): the frozen "must fail" build of the Wave-7 rows (no towns, NaN ground, the old loot.js). NEVER moves
LIVE_REV = C.LIVE_REV        # the build LIVE on the CDN (common.py, moved after every deploy): only the perf baselines read it; no control depends on it
WAVE7_REV = "dd414cb2"       # the Wave-7 release (live from 2026-10-14 to the next deploy): the frozen "must fail" build of the Wave-7 COMPLETION round rows (rocksweep: the player.js support window; the
                             # Savanna top-storey / roof-landing rows: bots; the multi-seed perf rows: draw calls +57 / +42 on seeds 1 / 31337). NEVER moves (LIVE_REV moves after the next deploy; this does not)
PERF_SEEDS = "1,7,1234,2026,31337"   # perf_district: the five Savanna seeds (the city differs per seed; the Wave-7 verify saw seeds 1 and 31337 cost +57 / +42 calls where seed 7 read -105 .. +3)
SQ_CASES = "same,older,newer,v1,preguard-guest,preguard-host,refuse-live"      # squadguard_live: the version-guard cases (Wave 7 lane 7C)
SQ_CASES_FALLBACK = "fallback,fallback-host,fallback-solo"                      # + lane D1's C-FALLBACK cases (a client whose towngen.js/citykit.js failed leaves the squad). The DEPLOYED build (Wave 7) has none of
                                                                                # this: squadguard_live_cdn stays on SQ_CASES until the deploy that carries the fallback, then adds SQ_CASES_FALLBACK (README post-deploy checklist)
PREL5_REV = "874ab0ca"       # the last-circle build BEFORE lane L5 (3474f1c0, 2026-10-04): every chute deploy allocated geometries (200 -> 212 over the 10 SPACE toggles on isla_viva): the frozen "must fail" build of framecheck's
                             # 10-SPACE-toggle row (Wave-7 fix round: the row now excludes the terrain's lazily built chunks and must still see this)
WAVE4_REV = "7f6a9fb2"       # the Wave-4 merge commit: the frozen "must fail" build of the Wave-5 gates
WAVE5B_REV = "bd523284"      # the Wave-5 leftovers release (live; the build Wave 6 starts from): the frozen "must fail" build of the Wave-6 rows and the perf_district baseline
WAVE5_REV = "3fce7529"       # the Wave-5 release ("Wave 5", live): the frozen "must fail" build of the 2026-10-13 leftovers-round rows
                             # (heal-pockets, container-lean, sprints-rocks, ramps-walk-fine): each fails here AND on the Wave-4 commit (heal-pockets there on geometry-only placements: no C-RAMP)

# (name, script, extra args, timeout s, informational)
GATES = [
    # Wave 5 (lane 5D): the permanent gates that SEE the world-foundation defects. placementcheck is Node only (no browser, ~25 s), so
    # it runs first; collisioncheck / navcheck load one Chrome per map and run after leaktest.
    ("placementcheck", "placementcheck.py", [], 1800, False),
    # Wave-5 fix round (lane F1): worldcheck is Node only too (same reason, runs second); worldlive loads one Chrome per map (PRACTICE: ~40 s)
    ("worldcheck", "worldcheck.py", [], 1800, False),
    # Wave 7 (lane 7D), Node only: no non-finite ground on 200 seeds x 3 maps (~4 min), and lane 7C's loot probe (15 builds, ~15 s)
    ("nancheck", "nancheck.py", [], 1800, False),
    # Wave-7 completion round (D5), Node only (~25 s): the squad world contract - if anything a peer must agree on (colliders, ground, POIs, prop anchors, loot points, the settled loot items) differs from
    # the LIVE build's on 3 maps x seeds 1, 7, 1234, MAP_GEN_VERSION must be higher than the live build's. Lane D2 owns the constant and bumps it ONCE; every other lane that changes the world tells D2
    ("genversion", "genversion.py", [], 1800, False),
    ("lootcheck", "lootcheck.py", [], 900, False),
    # NavGrid.bakeTown over the Savanna towns + compounds: every room street -> room -> street, planned by the grid and walked by the real mover (Node, ~1 min)
    ("navtown", "navtown.py", [], 1800, False),
    # Wave-7 completion round (D5, lane D4's roof exit): the match's own 49 bots, 8 Savanna seeds x 120 s, every bot tracked from a NATURAL glide ending on a roof / wall top (feet >= 3.5 m over the terrain):
    # each leaves it within 8 s and none stands still more than 4 s in total (not counting ENGAGE / HEAL). The Wave-7 live build stands 7.5-9 s in total on a roof and needs up to 13 s to leave. Browser, ~2 min
    ("roofland", "roofland.py", [], 3600, False),
    # Wave-7 completion round (D5; promoted from the Wave-7 verify): one consistent build for a player with a cold / stale browser cache - every runtime script requested with the boot's ?v=, none requested twice,
    # the exempt shared files byte-identical to the live build's, the match builds with no fallback. Browser, ~1 min. `coldcache.py --disk --release` (cache bump counted) is run on the release candidate; `--live` after the deploy
    ("coldcache", "coldcache.py", [], 1800, False),
    # lane 7E: the drawn city-kit mesh vs its colliders AT BODY HEIGHT (poke-out <= 0.10 m, phantom <= 0.25 m for EVERY type; collisioncheck measures none of the kit), Node, ~1 min with the census
    ("kitcollide", "kitcollide.py", ["--census", "7,1234,2026"], 1800, False),
    # Wave 6 (lane 6E): the detector's own selftest (Node only, ~2 s) runs with the other Node gates
    ("citycheck_selftest", "citycheck.py", ["--selftest"], 300, False),
    ("bootcheck", "bootcheck.py", [], 3600, False),
    ("bootguard", "bootguard.py", [], 5400, False),
    ("rigcheck", "rigcheck.py", ["--seeds", "7,11,23"], 5400, False),
    ("playtest", "playtest.py", [], 5400, False),
    ("portalcheck", "portalcheck.py", ["--matrix"], 3600, False),
    ("framecheck", "framecheck.py", [], 5400, False),
    # Wave 7 (lane 7D): the default gate only ever ran Isla Viva. Savanna counts; Deepwood is not touched by Wave 7, so its rows are INFORMATION until Wave 7b
    # (its one failing row, 10 SPACE toggles: geometries flat, reads 163 -> 164 on the live build too - see README "Wave 7")
    ("framecheck_ashgrid", "framecheck.py", ["--map", "ashgrid"], 5400, False),
    # Wave-7 completion round: COUNTED (was information until Wave 7b). Its one failing row (10 SPACE toggles) was a lazily built near-LOD terrain chunk, fixed in the definition by the Wave-7 fix round
    # (lane 7G; the same defect on the live build 60b854d0 = not the chute); passed 18/18 four times since. Controls: framecheck_deepwood-plant-chute-leak and the real pre-L5 build (NEGATIVE below)
    ("framecheck_deepwood", "framecheck.py", ["--map", "deepwood"], 5400, False),
    ("lifecycle", "lifecycle.py", [], 3600, False),
    ("feelcheck", "feelcheck.py", [], 3600, False),
    ("layoutcheck", "layoutcheck.py", [], 5400, False),
    ("mobile", "mobile.py", [], 7200, False),
    # Wave 7 (lane 7D): layoutcheck / mobile / rigcheck / probe_match all started on Isla Viva, the one map Wave 7 did not change. Savanna (and, where cheap, Deepwood) too
    ("layoutcheck_ashgrid", "layoutcheck.py", ["--map", "ashgrid"], 5400, False),
    ("layoutcheck_deepwood", "layoutcheck.py", ["--map", "deepwood"], 5400, True),      # information: Deepwood is unchanged in Wave 7; 1 flake in 5 runs (se 667x375: only stick + reload rendered), the other 4 PASS 31 / 31
    ("mobile_ashgrid", "mobile.py", ["--map", "ashgrid"], 7200, False),
    ("rigcheck_ashgrid", "rigcheck.py", ["--seeds", "7,11,23", "--map", "ashgrid"], 5400, False),
    ("rigcheck_deepwood", "rigcheck.py", ["--seeds", "7,11,23", "--map", "deepwood"], 5400, False),
    ("probe_match", "probe_match.py", ["--farwall"], 14400, False),
    # the same-seed replay, the census (>= 3 guns per player) and the path search on SAVANNA: 3 whole matches (11 twice, 12), ~2 min
    ("probe_match_ashgrid", "probe_match.py", ["--runs", "11:ashgrid,11:ashgrid,12:ashgrid", "--paths-maps", "ashgrid", "--small-run"], 7200, False),
    ("leaktest", "leaktest.py", [], 7200, False),
    ("collisioncheck", "collisioncheck.py", [], 5400, False),
    ("worldlive", "worldlive.py", [], 5400, False),
    # Wave-7 completion round (D5): the REAL-MOVER SWEEP - every isolated rock of 3 maps x 5 seeds x 8 angles with the game's own mover (13,432 sprints, ~4 min): exactly 0 end inside a rock. The sampled
    # sprints-rocks row (192 sprints) cannot see a 1-in-3,000 mover defect (the player.js 6 mm support window: 5 sprints walked 0.57-1.26 m into a rock on the Wave-7 build). rocksweep_nolip: the same with
    # the rock lip collider stripped from the served table = "the mover fix alone closes the window, the lip is redundant" (INFORMATION: the lip ships either way)
    ("rocksweep", "rocksweep.py", [], 3600, False),
    ("rocksweep_nolip", "rocksweep.py", ["--strip-lip"], 3600, True),       # INFORMATION: a QUESTION about the bake config (is the lip redundant?), not a bar on the game - the lip ships either way
    ("navcheck", "navcheck.py", [], 5400, False),
    # ---- Wave 6 (lane 6E). perf_district: calls + triangles at 3 fixed cameras vs the baseline revision (Wave 7: common.LIVE_REV; the baseline numbers are cached per commit,
    # so the run loads ONE match); citykit_probe is lane 6C's C-KIT gate.
    # Wave-7 completion round (D5): the five Savanna seeds (PERF_SEEDS) vs the LIVE build (no regression since the last deploy) AND vs the Wave-6 release (the plan's original +40 calls / x1.25 triangles bar:
    # the cumulative cost of the city). ONE candidate match per seed is judged against both baselines (rows "[ashgrid s31337 vs 60b854d0]"); every baseline is cached per commit x map x seed, so only the
    # first run against a new baseline loads the extra matches (~1 min each)
    ("perf_district", "perf_district.py", ["--seeds", PERF_SEEDS, "--baseline", LIVE_REV + "," + WAVE6_REV], 7200, False),
    ("citykit_probe", "citykit_probe.py", [], 3600, False),
    # Wave 7: the kit inside a real Savanna match (inmatch-warm: 0 new programs, inmatch-cost: <= +40 calls / <= 25 % triangles per frame). The collider count is no longer a literal (it moved with every manifest)
    ("citykit_probe_inmatch", "citykit_probe.py", ["--in-match"], 3600, False),
    # Wave 7: citycheck is a PERMANENT BLOCKING gate on Savanna (200 seeds; Node ~3.5 min + one Chrome for the detector parity). Isla Viva / Deepwood rows are printed as
    # "would PASS / would FAIL" information until Wave 7b gives them towns (--block-maps)
    ("citycheck", "citycheck.py", ["--blocking", "--block-maps", "ashgrid", "--seeds-n", "200"], 3600, False),
    # the same views vs the LIVE build on the two maps Wave 7 did not change (worlds are byte-identical: a regression guard), and the PHONE tier on Savanna (INFORMATION)
    ("perf_district_themed", "perf_district.py", ["--maps", "isla_viva,deepwood"], 3600, False),
    # Wave-7 completion round: COUNTED (was INFORMATION: the Wave-7 build read x1.247 of the x1.25 triangle bar at the phone endgame). After lane D2's tree LOD / draw-call merge the phone tier reads triangles
    # x0.60-0.70 and world calls -1 .. -67 against the live build on seeds 1, 7, 31337 (the real margin); seeds 1 and 31337 are the heavy cities. The same three views, a Pixel 7 context
    ("perf_district_phone", "perf_district.py", ["--phone", "--seeds", "1,7,31337"], 3600, False),
    # lane 7C's squad version guard (MAP_GEN_VERSION in the handshake), two real pages and the real lobby; ~35 s, 61 rows. preguard cases serve the build WITHOUT the guard (60b854d0, fixed)
    ("squadguard_live", "squadguard_live.py", ["--cases", SQ_CASES + "," + SQ_CASES_FALLBACK], 3600, False),
    # lane D1's REAL fallback path (--full): towngen.js / citykit.js requests aborted on the guest, a whole Savanna match on each page (~1 min): the guest really falls back, leaves, plays on solo; the host's copy of it becomes a bot
    ("squadguard_live_fallback_full", "squadguard_live.py", ["--full", "--cases", "fallback-full"], 3600, False),
    # Wave-7 completion round (D5): the SAME cases against the DEPLOYED build (common.LIVE_BASE over the network; read-only, the relay is a stand-in, nothing of production is touched; 63 rows, ~2 min).
    # INFORMATION here: it judges the build that is live, not the candidate in the working copy. It is a COUNTED part of every post-deploy check (README): `python _harness/squadguard_live.py --live`
    ("squadguard_live_cdn", "squadguard_live.py", ["--live", "--cases", SQ_CASES + "," + SQ_CASES_FALLBACK], 1800, True),
    # the loot rows on Savanna: every row except `rings` / `glare` (their A/B needs a SAND patch, which Savanna has none of: the Isla Viva run judges them). chestview judges open-sky chests
    ("loot_beams_rings_ashgrid", "new/loot_beams_rings.py", ["--map", "ashgrid", "--only", "gpusync,pools,clamp,ceilpix,pickup,deaths,chestview,stormfade"], 5400, False),
    # ---- Wave-4 lane gates: _harness/new/<lane>_<name>.py, registered 2026-10-12. Same convention as every gate above (0 pass /
    # 1 fail / 2 could-not-judge, one VERDICT line, JSON in _reports/); all take the common flags, so --disk / --rev / --base /
    # --headed / --gpu pass through. None needs a rAF (they step frames); each lane gate's --isolate / --overlay-root is a
    # lane-development convenience and is NOT used here: the integration run judges the whole working copy (or --rev).
    # ART-B first: artb_check reads files on disk (no browser), so a bad manifest fails in seconds.
    ("artb_check", "new/artb_check.py", [], 600, False),
    ("art_a_clips", "new/art_a_clips.py", [], 3600, False),
    ("art_a_canopy", "new/art_a_canopy.py", [], 3600, False),
    ("art_a_integration", "new/art_a_integration.py", [], 5400, False),
    ("artb_decode", "new/artb_decode.py", [], 3600, False),
    ("artb_integration", "new/artb_integration.py", [], 3600, False),
    ("stormfx_fx", "new/stormfx_fx.py", [], 3600, False),
    ("stormfx_storm", "new/stormfx_storm.py", [], 5400, False),
    ("loot_beams_rings", "new/loot_beams_rings.py", [], 5400, False),
    # sky_*: by default they serve git HEAD + ONLY the working-copy maps.js (a before/after rig that ignores --disk/--rev);
    # --merged = a plain working-copy run, one browser, absolute rows only (the integration pass their docstrings name)
    ("sky_probe", "new/sky_probe.py", ["--merged"], 5400, False),
    ("sky_lowtier", "new/sky_lowtier.py", ["--merged"], 3600, False),
    ("hud_checks", "new/hud_checks.py", [], 5400, False),
    ("hud_cycle", "new/hud_cycle.py", [], 5400, False),
    ("player_dlcount", "new/player_dlcount.py", [], 5400, False),
    ("player_deaths", "new/player_deaths.py", [], 5400, False),
    ("player_canopy", "new/player_canopy.py", [], 5400, False),
    ("player_camwall", "new/player_camwall.py", [], 5400, False),
    ("player_rim", "new/player_rim.py", [], 3600, False),
    ("player_dive", "new/player_dive.py", [], 3600, False),
    ("orch_lowpost", "new/orch_lowpost.py", [], 5400, False),
    ("orch_progkey", "new/orch_progkey.py", [], 3600, False),
    # Wave-7 fix round (lane 7G, promoted from lane 7F's scratch gate): NOTHING is compiled, created or uploaded by a second renderer or a shadow-pass flip in the
    # middle of a match - 3 maps x seeds 1, 7, each one whole match to second 306 (about 3 min per map x seed); exact counts, see README "Wave-7 fix round"
    ("warm_programs", "new/warm_programs.py", [], 5400, False),
    ("sim_pacing", "new/sim_pacing.py", [], 14400, False),
    # Wave-7 completion round (D5) coverage: sim_pacing / probe_match / navcheck / collisioncheck judged Savanna and Deepwood with ONE seed each, and their same-seed REPLAY row only ever ran on Isla Viva
    # (probe_match_ashgrid, since Wave 7, replays Savanna). Each entry below is one Chrome, time-boxed; the wall time of every one is in README "Wave-7 completion round". sim_pacing needs SIX distinct
    # (seed, map) runs (its median / circle rows are over them: fewer = could-not-judge), so each map gets six seeds plus the first one repeated as the replay pair
    ("sim_pacing_ashgrid", "new/sim_pacing.py", ["--runs", "51001:ashgrid,51001:ashgrid,51002:ashgrid,51003:ashgrid,51004:ashgrid,51005:ashgrid,51006:ashgrid"], 7200, False),
    ("sim_pacing_deepwood", "new/sim_pacing.py", ["--runs", "51101:deepwood,51101:deepwood,51102:deepwood,51103:deepwood,51104:deepwood,51105:deepwood,51106:deepwood"], 7200, False),
    ("probe_match_deepwood", "probe_match.py", ["--runs", "13:deepwood,13:deepwood,23:deepwood", "--paths-maps", "deepwood", "--small-run"], 7200, False),
    # other seeds than the default run's (tick seed 5 / 13, walk seeds 11, 5 / 13, 23) on the two maps whose rooms and bots Wave 7 changed or could have changed; the pocket half (fixed seeds 1, 7, 1234) is not repeated
    ("navcheck_seeds", "navcheck.py", ["--maps", "ashgrid,deepwood", "--only", "ticks,rooms", "--tick-seed", "21", "--walk-seeds", "21,22"], 7200, False),
    # the default run is seed 7; seed 31337 is where the rock residuals of Wave 7 sat. Savanna and Deepwood only (Isla Viva has 20-28 rocks per seed and passes at every seed)
    ("collisioncheck_seeds", "collisioncheck.py", ["--maps", "ashgrid,deepwood", "--seed", "31337"], 5400, False),
    # INFORMATION: what the sim costs per tick and how many frames hitch, this tree against the live build (A B A B). Never fails on a ratio; exit 2 only when nothing could be measured
    ("simcost", "simcost.py", [], 5400, True),
    ("perfcheck", "perfcheck.py", [], 7200, True),
    # information only (never exits 1): LOW tier with vs without the composer, interleaved ABAB. --no-lp drops its lc_liveprobe
    # arms (rAF windows - perfcheck above already reports those); the stepped GPU-synced bench stays
    ("orch_lowpost_ab", "new/orch_lowpost_ab.py", ["--no-lp"], 5400, True),
]
# planted faults that MUST make a passing gate fail (the gate's own falsifier)
# The post-deploy check (`python _harness/gate.py --disk --post-deploy`, README "Wave-7 completion round"): run it AFTER the CDN has the new build and AFTER common.LIVE_REV was moved to the deployed commit. Every row
# counts. (name, script, extra args, timeout s). The first two judge the DEPLOYED build over the network (read-only; the squad relay is a stand-in, no production data is touched); the third caches the new perf baseline
# (the working copy against itself, x1.000 everywhere) so the next round starts from the build that is live.
POST_DEPLOY = [
    ("postdeploy_coldcache", "coldcache.py", ["--live"], 1800),                                       # one consistent build for a cold cache AND live-rev: common.LIVE_REV is the deployed commit
    ("postdeploy_squadguard_live", "squadguard_live.py", ["--live", "--cases", SQ_CASES + "," + SQ_CASES_FALLBACK], 1800),   # the version guard + the fallback, against the deployed build
    ("postdeploy_perf_baseline", "perf_district.py", ["--identical"], 3600),                                         # the new baseline: --disk working copy vs LIVE_REV, row identical-to-baseline (x1.000: run with the deployed tree checked out)
]

NEGATIVE = [
    ("rigcheck-injected", "rigcheck.py", ["--seeds", "7", "--inject-regression"], 3600),
    ("portalcheck-minus-pointer-lock", "portalcheck.py", ["--drop-token", "allow-pointer-lock"], 3600),
    # Wave-2 L1F: the j/k card judge must FAIL when no card is painted / the card is hidden, and the lock row when the
    # lock drops while the player is alive (bootguard / bootcheck --plant)
    ("bootguard-plant-no-card", "bootguard.py", ["--cases", "j,k", "--plant", "no-card"], 1800),
    ("bootguard-plant-hidden-card", "bootguard.py", ["--cases", "j,k", "--plant", "hidden-card"], 1800),
    ("bootcheck-plant-lock-drop", "bootcheck.py", ["--plant", "lock-drop"], 3600),
    ("bootcheck-plant-w-dead", "bootcheck.py", ["--plant", "w-dead"], 3600),
    # Wave-3 H-harness: the kill-marker row must FAIL on a 50 ms kill hold; a blind sampler (the Wave-2 ordering defect)
    # must be COULD-NOT-JUDGE (expected exit 2), never a verdict; the phone overlap rows must not pass with no touch controls
    ("feelcheck-plant-kill-marker-short", "feelcheck.py", ["--plant", "kill-marker-short"], 1800),
    ("feelcheck-plant-blind-sampler", "feelcheck.py", ["--plant", "blind-sampler"], 1800, 2),
    ("layoutcheck-plant-no-touch-ui", "layoutcheck.py", ["--only", "phones", "--plant", "no-touch-ui"], 3600),
    # forced layouts are counted from a stack-traced trace now: a planted style-write + offsetWidth updater must FAIL both rows
    ("framecheck-plant-forced-layout", "framecheck.py", ["--plant", "forced-layout"], 3600),
    # Wave-4 lane falsifiers (each documented "MUST fail", each measured to exit 1 on 2026-10-12). The sky plants run WITHOUT
    # --merged: --merged skips the maps.js override the plant rides on
    ("loot_beams_rings-plant-flush-clear", "new/loot_beams_rings.py", ["--only", "gpusync", "--plant", "flush-clear"], 1800),
    ("loot_beams_rings-plant-storm-ignore", "new/loot_beams_rings.py", ["--only", "stormfade", "--plant", "storm-ignore"], 1800),
    ("sky_probe-plant-fog-flat", "new/sky_probe.py", ["--plant", "fog-flat"], 1800),
    ("sky_probe-plant-no-rng-burn", "new/sky_probe.py", ["--plant", "no-rng-burn"], 1800),
    ("sky_probe-plant-no-handles", "new/sky_probe.py", ["--plant", "no-handles"], 1800),
    ("sky_lowtier-plant-one-layer-broken", "new/sky_lowtier.py", ["--plant", "one-layer-broken"], 1800),
    # Wave-5 lane 5D. placementcheck: the BUILT map is mutated in memory (rocks back on their Wave-4 offset, the 0.35 m perimeter drop
    # back, one tree lifted 0.30 m); collisioncheck: the Wave-4 commit itself is served (pinned: `--rev` in the extra args makes run_gate
    # skip the integration run's --rev / --disk); navcheck: bots.js / ffg_royale3d.js are served patched by a page route.
    ("placementcheck-plant-y-only-recentre", "placementcheck.py", ["--plant", "y-only-recentre"], 900),
    ("placementcheck-plant-perimeter-drop", "placementcheck.py", ["--plant", "perimeter-drop"], 900),
    ("placementcheck-plant-tree-float", "placementcheck.py", ["--plant", "tree-float"], 900),
    ("collisioncheck-wave4-commit", "collisioncheck.py", ["--rev", WAVE4_REV], 3600),
    ("navcheck-plant-nav-l3", "navcheck.py", ["--plant", "nav-l3"], 3600),
    ("navcheck-plant-raw-strafe", "navcheck.py", ["--plant", "raw-strafe"], 3600),
    ("navcheck-plant-heal-yaw", "navcheck.py", ["--plant", "heal-yaw"], 3600),
    # Wave-5 fix round (lane F1). placementcheck stack-float: ONE stacked upper container is lifted 0.30 m (the stack-support rule must not forgive
    # it). worldcheck: the Wave-4 commit itself (a client whose GLBs fail builds other colliders), a stale table (edited in a scratch copy), one
    # extra RNG draw (a scratch copy of maps.js). worldlive: the Wave-4 commit, and player.js served with ramps that never block.
    ("placementcheck-plant-stack-float", "placementcheck.py", ["--plant", "stack-float"], 900),
    ("placementcheck-wave4-commit", "placementcheck.py", ["--rev", WAVE4_REV], 900),
    ("worldcheck-wave4-commit", "worldcheck.py", ["--rev", WAVE4_REV], 900),
    ("worldcheck-plant-stale-table", "worldcheck.py", ["--plant", "stale-table"], 900),
    ("worldcheck-plant-rng-shift", "worldcheck.py", ["--plant", "rng-shift"], 900),
    ("worldlive-wave4-commit", "worldlive.py", ["--rev", WAVE4_REV], 3600),
    ("worldlive-plant-ramp-sides-open", "worldlive.py", ["--plant", "ramp-sides-open"], 3600),
    # Leftovers round (lane L4-gates, 2026-10-13). The release-pinned runs prove each new row still SEES the residual it was written for on the build that
    # had it (a `--rev` in the extra args pins the run: the integration run's own --rev / --disk do not apply); the plants prove it sees a fresh fault
    # on the working tree: the baked collider table served with the container / rock boxes edited, player.js with every ramp blocking.
    ("collisioncheck-wave5-release", "collisioncheck.py", ["--rev", WAVE5_REV], 3600),
    ("collisioncheck-plant-container-narrow", "collisioncheck.py", ["--plant", "container-narrow"], 1800),
    ("collisioncheck-plant-rocks-small", "collisioncheck.py", ["--plant", "rocks-small"], 1800),
    ("worldlive-wave5-release", "worldlive.py", ["--rev", WAVE5_REV], 3600),
    ("worldlive-plant-ramp-solid", "worldlive.py", ["--plant", "ramp-solid"], 3600),
    ("navcheck-wave5-release", "navcheck.py", ["--rev", WAVE5_REV], 3600),
    # heal-pockets: the same hook as heal-yaw serves ffg_royale3d.js; every healing bot backs straight away from its threat with no look at the walls.
    # (heal-pockets also fails on the Wave-4 commit, at 94.0 % on geometry-only placements: its sim has no ramp-side collision; not registered, ~90 s.)
    ("navcheck-plant-pocket-raw", "navcheck.py", ["--plant", "pocket-raw"], 3600),
    # ---- Wave 6 (lane 6E). placementcheck: the five new rows each see a planted fault (the built map mutated in memory, seed 7 only) and the promoted rows FAIL on the
    # frozen Wave-5 leftovers release; ramp-start-step already passes there (lane 5A / L2 fixed the ramp authoring in Wave 5) so its frozen proof is the Wave-4 commit.
    ("placementcheck-plant-no-pads", "placementcheck.py", ["--plant", "no-pads", "--quick"], 900),
    ("placementcheck-plant-door-buried", "placementcheck.py", ["--plant", "door-buried", "--quick"], 900),
    ("placementcheck-plant-ramp-lip", "placementcheck.py", ["--plant", "ramp-lip", "--quick"], 900),
    ("placementcheck-plant-roads-lifted", "placementcheck.py", ["--plant", "roads-lifted", "--quick"], 900),
    ("placementcheck-plant-ground-shift", "placementcheck.py", ["--plant", "ground-shift", "--quick"], 900),
    ("placementcheck-wave5-release-wave6-rows", "placementcheck.py", ["--rev", WAVE5B_REV, "--rows", "base-edges,doorway-clearance,roads-float,pads,ground-match"], 900),
    ("placementcheck-wave4-commit-ramp-start", "placementcheck.py", ["--rev", WAVE4_REV, "--rows", "ramp-start-step"], 900),
    # perf_district: +60 always-drawn meshes (calls) and +820k always-drawn triangles (the cost rows); the Wave-5 release is itself the baseline, so there is no frozen proof
    ("perf_district-plant-extra-calls", "perf_district.py", ["--plant", "extra-calls"], 1800),
    ("perf_district-plant-extra-tris", "perf_district.py", ["--plant", "extra-tris"], 1800),
    # (the plants are sized from the baselines' own numbers since the completion round: the candidate is lighter than the live build, a fixed +60 meshes / +820k triangles no longer crossed the bars)
    ("perf_district_phone-plant-extra-tris", "perf_district.py", ["--phone", "--seeds", "7", "--plant", "extra-tris"], 1800),
    ("perf_district_phone-plant-extra-calls", "perf_district.py", ["--phone", "--seeds", "7", "--plant", "extra-calls"], 1800),
    # a frozen proof: the research HEAD of the world plan (bbd6aeae, before Wave 4's cloud / loot-beam savings) on Isla Viva reads 525 drop-view calls (464 world alone, +235 over bd523284)
    ("perf_district-bbd6aeae-isla-viva", "perf_district.py", ["--rev", "bbd6aeae", "--baseline", WAVE5B_REV, "--maps", "isla_viva"], 1800),
    # citycheck: the Wave-5 leftovers release has no towns: every coverage / town / endgame row of Savanna must FAIL (Node only, 30 seeds: a quick control)
    ("citycheck-wave5-release-blocking", "citycheck.py", ["--rev", WAVE5B_REV, "--blocking", "--quick"], 1800),
    # citykit_probe: lane 6C's own planted faults (a patched citykit.js served by a page route)
    ("citykit_probe-plant-no-spheres", "citykit_probe.py", ["--plant", "no-spheres"], 1800),
    ("citykit_probe-plant-leak", "citykit_probe.py", ["--plant", "leak"], 1800),
    ("citykit_probe-plant-glb-colliders", "citykit_probe.py", ["--plant", "glb-colliders"], 1800),
    ("citykit_probe-plant-q1-sign", "citykit_probe.py", ["--plant", "q1-sign"], 1800),
    ("citykit_probe-plant-mesh-flip", "citykit_probe.py", ["--plant", "mesh-flip"], 1800),
    ("citykit_probe-plant-no-far", "citykit_probe.py", ["--plant", "no-far"], 1800),
    # ---- Wave 7 (lane 7D). The Wave-6 release (60b854d0, pinned: it stays the "must fail" build after the Wave-7 deploy) wherever the plan says Wave 7 fixes something.
    # citycheck: the Wave-6 Savanna has no towns (the plan's control; the Wave-5 release one above stays): 0 pass / 5 fail
    ("citycheck-wave6-release-blocking", "citycheck.py", ["--rev", WAVE6_REV, "--blocking", "--quick"], 1800),
    # nancheck: the Wave-6 maps.js reads a non-finite ground on Savanna seed 14, Isla Viva 17, Deepwood 12 (quick = seeds 1..40)
    ("nancheck-wave6-release", "nancheck.py", ["--rev", WAVE6_REV, "--quick"], 1800),
    # lootcheck: the Wave-6 loot.js on this tree's maps leaves loot inside solids / hovering / through roofs (4 of 8 rows)
    ("lootcheck-wave6-loot-js", "lootcheck.py", ["--loot-rev", WAVE6_REV], 900),
    # squadguard_live: a page that sends no version (no-guard) and one whose net.js imports maps.js bare (a second, stale instance: bare-import) must both be caught
    ("squadguard_live-plant-no-guard", "squadguard_live.py", ["--cases", "older", "--plant", "no-guard"], 1800),
    ("squadguard_live-plant-bare-import", "squadguard_live.py", ["--cases", "same", "--plant", "bare-import"], 1800),
    # lane D1's C-FALLBACK: a client that NOTICES its map fell back and stays in the squad anyway (plant), and the real Wave-7 build (WAVE7_REV: no fallback logic at all) must fail the fallback cases
    ("squadguard_live-plant-no-fallback", "squadguard_live.py", ["--cases", "fallback,fallback-host", "--plant", "no-fallback"], 1800),
    ("squadguard_live-wave7-live-no-fallback", "squadguard_live.py", ["--rev", WAVE7_REV, "--cases", SQ_CASES_FALLBACK], 1800),
    ("squadguard_live_fallback_full-plant-no-fallback", "squadguard_live.py", ["--full", "--cases", "fallback-full", "--plant", "no-fallback"], 1800),
    # framecheck_ashgrid: +820k always-drawn triangles must break the relative drop-frame-1 row (x1.51 of the live build)
    ("framecheck_ashgrid-plant-extra-tris", "framecheck.py", ["--map", "ashgrid", "--plant", "extra-tris"], 1800),
    # loot_beams_rings chestview (open-sky chests only): every beam capped at a 60 m fade-out must fail it on both maps
    ("loot_beams_rings-plant-chest-beams-short", "new/loot_beams_rings.py", ["--only", "chestview", "--plant", "chest-beams-short"], 1800),
    ("loot_beams_rings_ashgrid-plant-chest-beams-short", "new/loot_beams_rings.py", ["--map", "ashgrid", "--only", "chestview", "--plant", "chest-beams-short"], 1800),
    # the Savanna invocations of the phone / rig gates can still fail
    ("layoutcheck_ashgrid-plant-no-touch-ui", "layoutcheck.py", ["--map", "ashgrid", "--only", "phones", "--plant", "no-touch-ui"], 3600),
    ("rigcheck_ashgrid-injected", "rigcheck.py", ["--seeds", "7", "--map", "ashgrid", "--inject-regression"], 3600),
    # navtown: the town grid baked with 3 m indoor cells (no door fits): the room rows must collapse
    ("navtown-plant-coarse-indoor", "navtown.py", ["--plant", "coarse-indoor"], 1800),
    # navtown on the Wave-7 live build (WAVE7_REV, pinned): the stair landing slab starts 0.61 m past the ramp end, the whole storey above is an island for the planner: town-top-rooms 22/24, 18/21, 23/26
    ("navtown-wave7-live", "navtown.py", ["--rev", WAVE7_REV], 1800),
    # roofland on the Wave-7 live build (WAVE7_REV, pinned): bots that land on a roof stand (roof-standstill / roof-exit FAIL on seeds 21-28)
    ("roofland-wave7-live", "roofland.py", ["--rev", WAVE7_REV], 3600),
    # kitcollide: the colliders that shipped in Wave 6 (27 of 81 kit types poke > 0.10 m out of their collider) and lane 7E's four planted faults
    ("kitcollide-wave6-release", "kitcollide.py", ["--rev", WAVE6_REV], 1800),
    ("kitcollide-plant-shrink", "kitcollide.py", ["--plant", "shrink"], 1800),
    ("kitcollide-plant-grow", "kitcollide.py", ["--plant", "grow"], 1800),
    ("kitcollide-plant-q1-sign", "kitcollide.py", ["--plant", "q1-sign"], 1800),
    ("kitcollide-plant-stale-table", "kitcollide.py", ["--plant", "stale-table"], 1800),
    # ---- Wave-7 fix round (lane 7G). warm_programs: ffg_warmup.js served without armDepthVariants / hud.js served without the lobby icon pre-render (each a patched copy
    # served by a page route, nothing on disk is edited), and the LIVE Wave-6 build itself (60b854d0, pinned: 3 pass / 4 fail on ashgrid + Deepwood - a late shadow-depth
    # program, drop-frame-1 icon renderer); one map x seed each is enough for the plants
    ("warm_programs-plant-no-arm", "new/warm_programs.py", ["--maps", "ashgrid", "--seeds", "1", "--plant", "no-arm"], 1800),
    ("warm_programs-plant-no-icons", "new/warm_programs.py", ["--maps", "ashgrid", "--seeds", "1", "--plant", "no-icons"], 1800),
    ("warm_programs-live-60b854d0", "new/warm_programs.py", ["--rev", WAVE6_REV, "--maps", "ashgrid,deepwood"], 1800),
    # hud_cycle: a resource leaked every round and never disposed must break the same-map comparison (24 geometries / 5 textures per round; the bars are
    # +-30 / +-5 across the two rounds the rows compare; programs are information: the count moves by several without a leak)
    ("hud_cycle-plant-leak-geometries", "new/hud_cycle.py", ["--plant", "leak-geometries"], 1800),
    ("hud_cycle-plant-leak-textures", "new/hud_cycle.py", ["--plant", "leak-textures"], 1800),
    # framecheck_deepwood: the 10-SPACE-toggle row now excludes the terrain's lazily built near-LOD chunks; a chute deploy that allocates a geometry and never frees it
    # must still break it (on Deepwood, the map where the terrain share moved the raw count)
    ("framecheck_deepwood-plant-chute-leak", "framecheck.py", ["--map", "deepwood", "--plant", "chute-leak"], 1800),
    # ... and a REAL frozen build with the defect: the build before L5 (chutes allocate ~3 geometries per deploy). Only the sections it needs run; its sampled-frames programs row fails too
    ("framecheck_deepwood-pre-L5-chute-defect", "framecheck.py", ["--rev", PREL5_REV, "--map", "isla_viva", "--skip", "shadow,cluster,alloc,qc,cadence,match,layout"], 1800),
    # ---- Wave-7 completion round (lane D5). rocksweep: the Wave-7 live build (WAVE7_REV, pinned: the player.js support window) must fail 5 sprints of 13,432 (ashgrid seed 31337 rock 40; deepwood seed 1 rock 118,
    # seed 1234 rock 64, seed 2026 rocks 90 and 4); and the old mover served over THIS tree must fail on Deepwood alone (the plant works on any tree state: it restores the defect)
    ("rocksweep-wave7-live", "rocksweep.py", ["--rev", WAVE7_REV], 3600),
    ("rocksweep-plant-old-mover", "rocksweep.py", ["--maps", "deepwood", "--seeds", "1,1234,2026", "--plant", "old-mover"], 1800),
    # perf_district over seeds: the Wave-7 live build against the Wave-6 release on the two seeds where the city costs the most (calls +57 / +42 over the +40 bar) - seed 7 alone is green there
    ("perf_district-wave7-live-vs-wave6-seeds", "perf_district.py", ["--rev", WAVE7_REV, "--baseline", WAVE6_REV, "--seeds", "1,31337"], 2400),
    # squadguard_live against the deployed build: the same two plants as the working-copy runs (a guard that never reports a mismatch; a net.js that imports maps.js bare) must be caught over the network too
    # genversion: the Wave-7 release against the Wave-6 one with its MAP_GEN_VERSION set back to 2 (a scratch copy): the worlds differ in 9 of 9 builds and the version did not move
    ("genversion-plant-no-bump", "genversion.py", ["--rev", WAVE7_REV, "--live-rev", WAVE6_REV, "--plant", "no-bump"], 900),
    # coldcache: net.js importing maps.js without the ?v= (the Wave-7 verify's bare-import defect) must fail cold-versioned and cold-once
    ("coldcache-plant-bare-import", "coldcache.py", ["--plant", "bare-import"], 1800),
    # perf_district --identical (the post-deploy baseline row) on two builds that are NOT the same (the Wave-7 release against the Wave-6 one): must FAIL
    ("perf_district-identical-different-builds", "perf_district.py", ["--rev", WAVE7_REV, "--baseline", WAVE6_REV, "--seeds", "7", "--identical"], 1800),
    # collisioncheck_seeds can still fail: rocks 16 cm too small on seed 31337 (49 % of the Savanna + Deepwood rock sprints end inside a rock). navcheck_seeds has NO plant of its own: navcheck's plants degrade the
    # window planner (nav-l3 etc.), which Savanna's towns do not use (the nav grid plans there) and Deepwood has too few upper rooms to judge (CNJ, tried 2026-10-15); its controls are navcheck's own plants on Isla Viva (default invocation)
    ("collisioncheck_seeds-plant-rocks-small", "collisioncheck.py", ["--maps", "ashgrid,deepwood", "--seed", "31337", "--plant", "rocks-small"], 3600),
    ("squadguard_live_cdn-plant-no-guard", "squadguard_live.py", ["--live", "--cases", "older", "--plant", "no-guard"], 1800),
    ("squadguard_live_cdn-plant-bare-import", "squadguard_live.py", ["--live", "--cases", "same", "--plant", "bare-import"], 1800),
    # coldcache --live with --expect-rev pointing at a build that is NOT live (the Wave-6 release): the live-rev row (common.LIVE_REV is the deployed commit) must FAIL
    ("coldcache-live-wrong-live-rev", "coldcache.py", ["--live", "--expect-rev", WAVE6_REV], 1800),
]


def node_selftests():
    files = sorted(glob.glob(os.path.join(C.ROOT, "runtime", "**", "*.selftest.cjs"), recursive=True))
    out = []
    for f in files:
        rel = os.path.relpath(f, C.ROOT).replace(os.sep, "/")
        t0 = time.time()
        try:
            r = subprocess.run(["node", f], cwd=C.ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
            code = 0 if r.returncode == 0 else 1
            tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-3:]
        except subprocess.TimeoutExpired:
            code, tail = 2, ["timeout after 900 s"]
        except FileNotFoundError:
            code, tail = 2, ["node not found on PATH"]
        out.append({"name": "node " + rel, "exit": code, "wall": round(time.time() - t0, 1), "tail": tail})
        print("  %-4s node %s (%.0f s) %s" % ({0: "PASS", 1: "FAIL", 2: "CNJ "}[code], rel, time.time() - t0, " | ".join(tail)[:200]), flush=True)
    return out


def run_gate(name, script, extra, timeout, args, logdir):
    cmd = [sys.executable, "-u", os.path.join(C.HERE, script)] + list(extra)
    pinned_base = "--live" in extra or "--base" in extra       # judges the DEPLOYED build over the network (squadguard_live --live): no --disk / --rev / --base of the run applies
    if "--rev" in extra or pinned_base:
        pass                                    # pinned to a frozen commit (a negative control): the run's own --rev / --disk do not apply
    elif args.rev:
        cmd += ["--rev", args.rev]
    elif args.disk:
        cmd += ["--disk"]
    if args.base != C.DEFAULT_BASE and not pinned_base:
        cmd += ["--base", args.base]
    if args.headed:
        cmd += ["--headed"]
    if args.gpu and args.gpu != "d3d11" and name != "mobile":
        cmd += ["--gpu", args.gpu]
    log = os.path.join(logdir, name + ".log")
    t0 = time.time()
    verdict = None
    print("\n=== %s  %s  (%s)" % (name, " ".join(cmd[2:]), time.strftime("%H:%M:%S")), flush=True)
    try:
        with open(log, "w", encoding="utf-8") as fh:
            p = subprocess.run(cmd, cwd=C.ROOT, stdout=fh, stderr=subprocess.STDOUT, timeout=timeout,
                               env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        code = p.returncode if p.returncode in (0, 1, 2) else 2
    except subprocess.TimeoutExpired:
        code = 2
        verdict = "timeout after %d s" % timeout
    try:
        lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
        vl = [ln for ln in lines if ln.startswith("VERDICT ")]
        rl = [ln for ln in lines if ln.startswith("REPORT ")]
        if vl and not verdict:
            verdict = vl[-1][len("VERDICT "):]
        report = rl[-1][len("REPORT "):] if rl else None
    except Exception:
        report = None
    if verdict is None:
        verdict = "no verdict line (gate process exit %s)" % code
    print("    -> exit %d  %s  [%.0f s]  log %s" % (code, verdict, time.time() - t0, log), flush=True)
    return {"name": name, "exit": code, "verdict": verdict, "wall": round(time.time() - t0, 1), "log": log, "report": report}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", default=None, help="comma list of gate names")
    ap.add_argument("--skip", default="", help="comma list of gate names to skip")
    ap.add_argument("--no-node", action="store_true", help="skip the Node selftests")
    ap.add_argument("--negative-controls", action="store_true", help="also run the planted-fault runs (each must exit 1)")
    ap.add_argument("--post-deploy", action="store_true", help="run ONLY the post-deploy check (POST_DEPLOY: coldcache --live, squadguard_live --live, the perf baseline); every row counts")
    args = ap.parse_args()
    only = set(x for x in (args.only or "").split(",") if x) or None
    skip = set(x for x in args.skip.split(",") if x)
    stamp = C.stamp()
    logdir = os.path.join(C.REPORTS, "gate_%s" % stamp)
    os.makedirs(logdir, exist_ok=True)
    n, err = C.automated_chromes()
    print("gate: %s | other automated Chromes: %s | logs %s" % (
        ("git " + args.rev) if args.rev else ("working copy (--disk)" if args.disk else args.base), n if err is None else err, logdir), flush=True)
    rows = []
    if args.post_deploy:
        for name, script, extra, timeout in POST_DEPLOY:
            if (only is not None and name not in only) or name in skip:
                continue
            r = run_gate(name, script, extra, timeout, args, logdir)
            r["info"] = False
            rows.append(r)
        args.no_node = True
        gates_to_run = []
    else:
        gates_to_run = GATES
    if not args.no_node and (only is None or "node" in only):
        print("\n=== Node selftests (the SIM only; always the WORKING COPY, even with --rev)", flush=True)
        rows += [dict(r, info=False) for r in node_selftests()]
    for name, script, extra, timeout, info in gates_to_run:
        if (only is not None and name not in only) or name in skip:
            continue
        r = run_gate(name, script, extra, timeout, args, logdir)
        r["info"] = info
        rows.append(r)
    if args.negative_controls and not args.post_deploy:
        for ent in NEGATIVE:
            name, script, extra, timeout = ent[:4]
            want = ent[4] if len(ent) > 4 else 1
            if only is not None and name.split("-")[0] not in only:
                continue
            r = run_gate(name, script, extra, timeout, args, logdir)
            r["negative"] = True
            r["info"] = False
            r["gateExit"] = r["exit"]
            if want == 1:
                # a planted fault must FAIL the gate: exit 1 is the pass here
                r["exit"] = {1: 0, 0: 1}.get(r["exit"], 2)
            else:
                # a blinded measurement must be COULD-NOT-JUDGE: exit 2 is the pass here; a verdict either way is a harness defect
                r["exit"] = 0 if r["exit"] == want else 1
            r["verdict"] = ("planted fault detected (exit %d as required) - " % want if r["exit"] == 0 else
                            "planted fault NOT detected (gate exit %s, wanted %d) - " % (r["gateExit"], want)) + r["verdict"]
            rows.append(r)
    counted = [r for r in rows if not r.get("info")]
    code = 1 if any(r["exit"] == 1 for r in counted) else (2 if any(r["exit"] == 2 for r in counted) or not counted else 0)
    print("\n" + "=" * 110)
    print("LAST CIRCLE GATE TABLE  %s  (%s)" % (time.strftime("%Y-%m-%d %H:%M"), ("git " + args.rev) if args.rev else ("working copy" if args.disk else args.base)))
    for r in rows:
        tag = {0: "PASS", 1: "FAIL", 2: "CNJ "}[r["exit"]] + (" (info)" if r.get("info") else "")
        print("  %-12s %-34s %6.0f s  %s" % (tag, r["name"], r.get("wall", 0), str(r.get("verdict") or " | ".join(r.get("tail") or []))[:150]))
    print("OVERALL: %s" % {0: "PASS", 1: "FAIL", 2: "COULD-NOT-JUDGE (re-run the CNJ gates; never counted as a pass)"}[code])
    out = os.path.join(logdir, "gate_table.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"stamp": stamp, "args": vars(args), "otherChromes": n, "rows": rows, "exit": code}, fh, indent=1)
    print("REPORT %s" % out)
    return code


if __name__ == "__main__":
    sys.exit(main())
