VERDICT: fail. There is one major failure: a chain of ceremonies can exceed the flash budget. Everything else is minor. I found no crash, leak or page error, and the harness passes 198/198.

All paths below are in my scratch folder, V = /tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/render_verify. I modified no repo files. I ran no git write commands. I started browsers only on ports 5370 and 5371, and none of my processes are still running.

FAILURES

1. MAJOR (flash safety, DESIGN 6.6): two ceremonies chained by skipping one and opening the next give 4 luminance transitions inside 1 s. The probe definition is a swing of 0.04 or more in mean linear luminance, and more than 3 per rolling second fails.
   - Where: `src/render/flash.ts` and `src/render/ceremony.ts` (`startRamp`, `doBurst`).
   - Why: the FlashGovernor only rations the screen-light ramps (at most 2 per second, at least 480 ms apart). The burst's own light is not governed: the result body appearing, the tier tell, the pool and the particles.
   - The skip crossfade also turns the 400 ms decay into a 120 ms drop.
   - Repro at the harness's own settings: `SEQ=mythicSkipThenQuickCommon FPS=30 node $V/adv.mjs 320 240 low`. That is a Mythic capsule, skip at 1.73 s (after its burst), then a Fast-open quick-pop Common started at 1.81 s. Transitions land at 1.63 / 1.73 / 2.17 / 2.50 s, so 4 in 0.87 s.
   - The same breach at 480x300 med, 60 fps, in `$V/adv.log`:
     - Mythic capsule then quick Uncommon: 4 transitions.
     - Legendary capsule then quick Uncommon: 4.
     - Mythic merge then quick Uncommon: 4.
     - In the first and last of these the governor refused the second ramp, and the luminance still swung.
   - By WCAG's 0.1 swing it is still only 1 general flash.
   - Five back-to-back quick pops sit exactly at the limit: 3 transitions per second as a 1.25 Hz train for 4 s.
   - `$V/gov_fuzz.mjs` confirms the governor alone allows this: two granted ramps at the 0.48 s minimum spacing already make 4 envelope flips in 0.63 s.
   - Fix: gate the burst across ceremonies (for example, delay or soften the next burst until 1 s after the last granted flash), or have the shell refuse a new ceremony within 1 s of a burst.

2. MINOR: the stage leaves non-opaque pixels in an alpha:true canvas. three always creates the context with `alpha: true`.
   - Causes:
     - The decal shadow's custom blending also blends alpha (`decals.ts:89-92`).
     - The transmissive jelly writes its transmission alpha unblended.
   - Measurements (`$V/alpha_probe.mjs`, `$V/rawpx.mjs`):
     - A capsule waiting on the table leaves about 18k pixels at alpha below 1 (1280x800).
     - At calm Common reveal, burst + 9 frames, 51k pixels are below 1 and 17.7k are at alpha 0 with colour values above alpha.
   - In game, the `#stage` CSS gradient is added through those pixels. You get a lighter halo with a hard straight quad edge under the waiting capsule (`out/look/decal_probe/desk_base.png`) and a lavender lift inside the body.
   - Every `toDataURL` capture shows black holes, for example `out/look/calm_1280x800_med/cap_2rare_d_drop.png`. Repro: `node $V/black2.mjs`.
   - The harness luminance and fingerprint probes read these pixels as black. They slightly under-measure calm bursts.

3. MINOR: `clearBodies()`, or `removeBody(h.resultBodyId)`, during a ceremony leaves `primaryBodyId()` pointing at a removed view. `h.resultBody` is then a body with no view, so the adopted squishy is invisible. Repro: `node $V/robust.mjs misuse_mid`. Fix: abort the director as `setBody` already does.

4. MINOR (known, but worse than reported): when `createBody` throws inside `play*()`:
   - Merge: the play body stays hidden, and the orphan parents stay standing.
   - Capsule: the Legendary pillar or Mythic dome leaks into the scene (+2 scene children), and the capsule stays "opening" for good.
   - Repro: `robust.mjs throwing_callbacks`.

5. MINOR: all particles are cleared on the last ceremony frame. The tier-up sparkles go from 16 to 0 in one frame (`out/look/extra_1280x800_med/x_tierUpLast.png` vs `x_tierUpAfter.png`). Common bursts also cut motes early (`ceremony.ts:463,729`).

6. MINOR (art): an Epic play body sliding off for a reveal stretches its orbiting motes into long laser lines across the frame (`rarity.ts:326,336`). Seen in `_shots/render/film/capsule_legendary_0_grab.jpg` and `out/look/extra_1280x800_med/slide_epic_play_b.png`.

7. MINOR (art): at med quality the flying capsule halves sit inside the result body and read as wire hoops. The lower half forms a U "mouth" under the eyes; the face is meant to have no mouth. Seen in the d_drop frames for every tier under `out/look/capsule_1280x800_med/`, and in `film/capsule_epic_4_drop.jpg`.

8. MINOR (art): the merge T2 tell does not read for Uncommon, Rare or Epic in real merges. The tier light is additive, so it whitens a warm ball (Uncommon reads cream, Epic reads pink), and the parents' own tier aura dominates. Seen in `out/look/merge_1280x800_med/mer_1uncommon_c_chargeend.png` and `mer_3epic_c_chargeend.png`.

9. MINOR: a capsule waiting on the table is not moved during a merge, so the parent bodies pass through it (`out/look/extra_1280x800_med/x_at02.png`).

10. MINOR: in calm mode the 0.65 time compression makes the frame centre busier, not calmer.
    - In a 3x3 grid of the frame, Rare to Mythic calm reveals give 4 transitions of 0.1 or more in 1 s, against 2 to 3 in normal mode.
    - The result appears in one frame (+0.19 luminance in that region).
    - The tremble, the capsule rattle and the star twinkle still run in calm.

11. MINOR: `createStage` returns `createStageDev`, so `loseContext`, `restoreContext`, `memory`, `info`, `views` and `renderer` ship in the production bundle (`stage.ts:472`).

12. MINOR: per-frame allocations in ceremony paths. `MergeRun.dirOf()` creates an object per parent per frame (`ceremony.ts:558-579`). The capsule tell array is allocated whenever the tint is refused (`ceremony.ts:364`).

13. MINOR: after a real context loss and restore, disposing objects created before the loss logs about 30 "WebGL INVALID_OPERATION ... does not belong to this context" warnings. This is three.js behaviour, but it would trip a zero-warnings gate.

Known items, confirmed or refuted:
- **Skip not identical to the natural end: confirmed.** Off by 0.13–0.79/255. Skipping at 0 s, 50 ms, burst + 40 ms or end − 50 ms gives the same final frame, and the result is hidden on 0 frames.
- **No 350 ms skip gate: confirmed.** `skip()` works at 0 s.
- **Common merge zoom: confirmed.** `ceremony.ts:554` applies the framing for every tier.
- **Phone halos touch the frame sides: confirmed.** On phone the parents also start clipped at the edges.
- **Uncommon is subtle: confirmed.** Only the lagoon pool and a few flecks.
- **Epic two-tone barely shows: partly refuted.** It is also invisible on translucent bodies, for example the DOLLOP starter and seed 16.
- **Legendary/Mythic bursts are bright: confirmed.** Mean luminance goes from 0.033 to 0.256, and the Mythic capsule peak still has a saturated green aura (`cap_5mythic_c_burstpeak`).
- **Epic khaki: partly persists.** Visible in `cap_3epic_c_burstpeak`.
- **Stale capsule handle not honoured: confirmed.** The reveal takes a fresh standing capsule; no crash.
- **Orange and pink merge parents: harness only.** The harness passes mismatched genomes (`PARENT_SEEDS ['', '3', '8']` in `_harness/renderview/view.ts:159`). In play, `rollMerge` refuses mixed species. With real same-species specs the parents match and the ball is uniform (`out/sheet_merge_desk.png`).

NUMBERS
- **Harness:** my copy (`$V/harness/browser_render.mjs`, port 5370, real soft body) printed ALL RENDER CHECKS PASSED, 198/198, 0 console problems, 66 min.
- **tsc:** clean (exit 0), run twice.
- **Flash, my probe (480x300 med, 60 fps, global mean, worst transitions in any 1 s):**
  - Normal: 2 for every tier of both kinds, and 2 for tier-up, 3-parent and quick pop.
  - Calm capsule: 2 / 2 / 0 / 1 / 1 / 2 (Common to Mythic).
  - Calm merge: 2 / 2 / 0 / 1 / 1 / 1.
  - The harness measures 2 everywhere.
  - Chained ceremonies: 4 (failure 1).
  - Screen alpha peaks at 0.098 to 0.226, cap 0.25.
  - No coral/cyan alternation (governor fuzz, 0 violations).
- **Durations at 60 fps:**
  - All within 1% of budget. Capsule 1.617 / 2.017 / 2.617 / 3.217 / 3.917 / 4.517 s; merge 2.217 / 2.617 / 3.217 / 3.817 / 4.517 / 5.217 s.
  - Calm is ×0.65 within 1%, tier-up Mythic 5.617 s, 3-parent 3.817 s, quick pop 0.800 s.
  - Beats on the SOUND.md map: bursts at 0.65 / 0.65 / 0.95 / 1.15 / 1.45 / 1.65 s for the capsule and 1.3 to 2.8 s for the merge, preroll at 0.65 s.
- **Memory over 20 mixed ceremonies (`robust.json` "twenty"):**
  - Geometries 8–14, cycling by tier.
  - Textures 3, then 4 after the first skip creates the crossfade snapshot.
  - Programs 15–18, scene children 9 throughout, particles 0 at the end.
  - JS heap 14.53–14.70 MB, flat.
  - Determinism: identical frames and state hash across two runs.
  - Dispose mid-ceremony leaves 0 geometries and 0 programs. Overlap, context loss and resize mid-ceremony are clean, and `done` always resolved.
- **Bundle (`vite build` to `$V/dist`, 866 KB of the 1229 KB budget):** no StubBody, renderview, `__RV__` or `lifecycle3`. The stage dev members ship (failure 11). The shell's `__shot` dev hook is in the index chunk; that is outside the render lane.

NOTES
- Contact sheets of my own captures:
  - Desktop: `$V/out/sheet_{merge_desk,capsule_desk,merge3_desk,calm_cap,calm_mer}.png`.
  - Phone: `sheet_{merge_phone,capsule_phone_low,merge3_phone}.png`.
  - Merges use real same-species specs.
  - Rarity escalates unmistakably from Common to Mythic in every final frame.
  - The capsule is neutral before the crack.
  - Each burst is one ramp.
  - The sky has no band at any framing.
  - The low tier has no seam and looks close to med.
- The physics agent just added `strands` and `slosh` to `SoftMetrics` (uncommitted). `BodyProxy.sync` copies metrics field by field (`bodyproxy.ts:348-351`), so new fields read as undefined through the proxy.
- In my test, ceremony bodies left no stale soft-body events for the shell to drain (0 events), so adopting `resultBody` is clean.
- The shell should own:
  - the 350 ms skip gate;
  - stopping the merge hum when 'reveal' arrives without 'burst';
  - not starting a new ceremony within about 1 s of a burst, until failure 1 is fixed in render.