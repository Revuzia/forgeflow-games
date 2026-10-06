# Squish Keeper: handoff (2026-10-06, stopped by the owner)

The owner stopped all running work at about 12:15 UTC on 2026-10-06. This page says what is done, what was in progress and where
it stopped, what is not started, what is still open, and how to continue.

## Where things are

| Item | Value |
|---|---|
| Repo, branch | `Revuzia/forgeflow-games`, branch `claude/exciting-faraday-2dakqx`; never push elsewhere and never open a PR unless asked |
| Game folder | `games/wobblehoard` (the player-facing name is **Squish Keeper**; internal ids and the `wobblehoard:v1:*` save keys keep the old name on purpose) |
| Last tested build | `db8f8ac`: Hoard, switching, XP sparks. It booted with 0 errors on desktop and phone sizes and is the build on the owner's private preview link |
| Preview link | https://claude.ai/artifact/SYhacMhtF63CuzYXqcVXAp (private to the owner) |
| CDN deploy | Runs from the owner's PC only: Cloudflare and Supabase keys are not in the cloud environment. Steps are below |
| Specs | `_spec/`: DESIGN, CONTRACT, CATALOG, COLLECTION, MERGE, TRADE, SOUND, SQUISHY_SCIENCE, REFERENCES, NEXT_STEPS, **CUT** (new), **FUN** (new) |
| Working briefs and verdicts | `_handoff/briefs/` (COMMON rules plus the per-lane briefs); `_handoff/verify_physics/VERDICT.md` and `_handoff/verify_render/VERDICT.md`, with the checkers' scripts beside them. The scripts were written against throwaway snapshot folders, so fix their paths before reuse |

### CDN deploy (on the owner's PC, PowerShell)
```
cd "C:\Users\TestRun\Claude Claw\forgeflow-games"
git fetch origin claude/exciting-faraday-2dakqx
git worktree add "..\squish-keeper-build" <tested commit, e.g. db8f8ac>
cd "..\squish-keeper-build\games\wobblehoard"
npm install
npm run build
python "C:\Users\TestRun\Claude Claw\forgeflow-games\pipeline\deploy_game.py" --game-dir dist --slug squish-keeper --dry-run
python "C:\Users\TestRun\Claude Claw\forgeflow-games\pipeline\deploy_game.py" --game-dir dist --slug squish-keeper
```
After the deploy, the game is at https://forgeflow-games-cdn.isimcha85.workers.dev/squish-keeper/index.html. A first deploy is
registered as **unpublished**: it is playable by link but not listed. Remove the worktree afterwards with
`git worktree remove "..\squish-keeper-build"`.

## Done and verified

- **Design and data.** 50 species in 6 tiers. The economy uses MERGE_COST = 2. A capsule takes about 3.0 to 3.6 active minutes,
  re-simulated after the XP change.
- **Collection (practice, local).** Store, stacks, ghost economy, restock, tasks, merge with an odds digest, and two-tab safety.
  Probes: collection 71/71, merge 22/22, economy 152/152.
- **Shell.**
  - The rewrite (14 modules) with ceremonies, the skip gate, burst spacing, settings v2, a strict CSP and no dev tools in the bundle.
  - The Hoard gallery, switching anytime (a quick switcher of 5, the `[` `]` keys, persistence), the merge pad, the play mat and offline states.
  - Visible XP: sparks into the meter, a pending arc while holding, a calm glow.
  - Checks: browser harness 290/290 (run in batches), probe_app 160/160.
- **Audio.**
  - Rounds 1 to 3, plus the room-dip fix (no pumping; independently re-checked PASS).
  - The cut and reconnect voices with pitch (CUT checks 65/65) and the music-volume-1 fix.
- **XP rules.** Ordinary tapping always earns. A stretch held pays 1.0 + 0.55 SP per second, up to 3 s. `previewTouch` drives the
  pending arc.
- **Rename to Squish Keeper**, including the game metadata and the deploy slug `squish-keeper`.
- **Physics, at checkpoint 47 (`c3fa0cb`), as reported by its engineer and not yet independently re-verified.**
  - Fix round 2: hops 64/300 to 0, full-pull creases 111/608 to 2, rub creases 35/445 to 4, starter wobble restored.
  - Body-to-body contact with `bump` events.
  - Pick up and toss (`metrics.carried`).
  - Cut primitives (`measureCut`, `setNeck`, `setFrac`, pieces and chunks); probe_cut 16/16.
  - The pull level is the target distance over maxPull (half 0.5, full 1.0 for every family). `release` fires on
    max(compression, press).

## In progress when stopped (resume these first)

1. **Shell SHELL-4: toy tray, Snap (photo), the Cut tool, toss and bump wiring.** The code is in, committed in the handoff commit,
   but its engineer never reported, so treat it as unverified:
   - `src/ui/toyTray.ts`, `src/ui/snapBar.ts`, `src/ui/cutBar.ts`;
   - `src/shell/cut.ts` (the piece manager, about 500 lines);
   - changes in `game.ts`, `hudBinding.ts`, `bodies.ts`, `mat.ts`, `feedback.ts`;
   - about 370 new lines in `_harness/browser_shell.mjs` and more node checks.

   To do:
   - Run tsc, `node _harness/shellview/node_checks.ts`, `node _harness/probe_app.ts` and the browser harness sections. Fix what fails.
   - Finish the Cut tool on the REAL physics: `CUT.md` checks X01 to X10; cuts into 2, 4 and 6 pieces; drag to reconnect;
     Reconnect all; the reconnect-on-leave paths; a toss of a piece.
   - Route `lift` and `toss` (`metrics.carried`) and `bump` to audio and haptics.
   - Decide whether `CALIBRATION.bendWithPress` can retire now that `release` includes press. Keep it if a dome press still reads
     compression 0, and make sure the meter is never paid twice.
   - Fix the meter status line peeking out under the Hoard card, and long species names cut off on the phone name tag.
   - Screenshots: the tray, Snap and a saved PNG, a 4-piece cut mid-neck and right after separation, the mat stack.
2. **Render: part A fixes, part B (RENDER-3) and part C (cut visuals).** The code is in, and its engineer never reported:
   - `src/render/cutfx.ts` (the seam, bridge and parting pieces);
   - `setCutSeam`, `setBridge`, `partPieces` and `AddBodyOpts.chunk` in `stage.ts`;
   - chain flash checks and the gallery, glow, strands, mat and capspot sections in `browser_render.mjs`;
   - capsule placement with safe insets, the per-species material, strands.

   To do:
   - Re-run the render verifier's repro scripts (`_handoff/verify_render/`) for every finding in its VERDICT. The MAJOR was the
     chained-ceremony flash; there were 12 minors.
   - Fix the phone capsule landing in front of the squishy (see `_shots/shell/hud_phone_with_hoard.png`; the shell now sends real
     safe insets).
   - Fix the camera jump when `setBody` is called with mat bodies out.
   - Prove with a bundle grep that the dev stage members (`createStageDev`) are out of production.
   - Run the full render harness once.
3. **Independent physics re-verification of checkpoint 47.** It was started and stopped with no verdict. Re-run it with the scripts
   in `_handoff/verify_physics/`: hop, pullset, rubset, attack, cer_iso, the realistic and drag sets, plus a phase 2 attack (cuts
   down to 1/8, six deep; random reconnect orders; tosses at 6 m/s; a mixed stack of 5; NaN inputs; determinism; allocation) and a
   quiet perf measurement.

## Not started

- **Stamp and Roll tools** (`FUN.md`): a physics round for kinematic tool shapes, then render, shell and audio.
- **Float tray** (`FUN.md`, later).
- **Trading.**
  - Required by the original brief. The full design is in `_spec/TRADE.md`, with SQL drafts NOT APPLIED.
  - Real trading needs a server, and the server needs the owner's hosting decision (D-6) and age and consent decision (D-5).
  - Next step: build the client trade module and UI against an in-repo mock host that enforces `TRADE.md`'s rules, behind a clear
    "online play" gate.
- **Stage C.**
  - `README.md`.
  - `public/thumbnail.png`, 1280x720, rendered from the game.
  - Integration gates G3, G4 and G6, and a full playthrough: earn, open, collect, switch, merge, cut, toss, Snap.
  - An independent final review.
  - A doc re-quote pass: DESIGN 5.0's canonical sim hash, the "3.1 min" in CONTRACT G4m and DESIGN risk 5, and NEXT_STEPS status.
- **Optional:** rename the `games/wobblehoard` folder (deploy settings depend on it, so only if the owner wants it).

## Open issues (honest)

- **Physics perf.** Most families take 1.8 to 2.3 ms per frame against the 2.0 ms bar (starter 1.63) at load 4 to 6. No cheap
  win is left without changing the substep count; it needs a quiet re-measure, then perhaps substep tiering on low quality.
  - With collide, 5 whole bodies cost about 10 ms per frame.
- **Physics rare creases.**
  - Remaining, each 1 to 2 frames:
    - 2 of 612 full pulls;
    - 4 of 449 rubs;
    - a few slime, putty and kneadle rest creases.
  - probe_species is 22/31.
  - The neck waist is 0.3, not 0.15.
  - A neck held at t = 1 for a second creases.
  - Plastic memory still captures repeated bursts with fingers down.
- **Silhouettes still weak:** wrigglo, pastrel, thumbly, boingle, crimpo.
- **Load-sensitive timing checks** (cold JIT, live audio playout) fail on a busy 4-core machine and pass when run alone.
- **Nobody has listened** to any sound. Render has been checked only on SwiftShader, never on a real GPU or iOS.

## Owner decisions still open

- D-6 hosting (blocks real trading).
- D-5 age and consent.
- A trademark check of "Squish Keeper" and the 50 species names.
- Whether trading stays mandatory.
- D-15 colourway variants.
- Whether to rename the folder and slug.

## How the work was run (what worked)

- **Lanes with strict file ownership:** PHYS, RENDER, AUDIO, SHELL, ECON (meter), CORE and data. All cross-lane seams live in
  `src/contracts.ts` and are additive only.
- **Machine and checks.**
  - At most 2 heavy jobs on the 4-core machine.
  - One browser per engineer, on its own port: render 5364, shell 5366, audio 5367, physics 5368, verifiers 5370 to 5373.
  - Run targeted harness sections while iterating, and the full harness once per stage.
- **Independent verification** of every physics, render and audio change, sized to risk. It caught real bugs every time. Fix rounds
  are time-boxed to at most 2 per finding.
- **Commits.** Commit and push a checkpoint after every landing. Run tsc before every commit, and never commit `.pyc` files, images
  or secrets.

## Prompt to continue

Paste this into a new session on this repository:

> Continue Squish Keeper (folder `games/wobblehoard`, branch `claude/exciting-faraday-2dakqx`). First read
> `games/wobblehoard/_handoff/HANDOFF.md` completely, then `_handoff/briefs/COMMON.md`, `_spec/CUT.md` and `_spec/FUN.md`.
>
> 1. Resume the three items under "In progress when stopped", in this order: verify and finish the render work; verify and finish
>    SHELL-4 (toy tray, Snap, Cut tool on the real physics, toss and bump wiring); re-verify physics checkpoint 47 independently
>    with the scripts in `_handoff/verify_physics/`.
> 2. Use fresh agents with the lane briefs in `_handoff/briefs/`, updated with where each lane stopped. Run independent
>    verification for physics, render and audio changes. Keep to at most 2 heavy jobs at a time on this machine.
> 3. When those pass, refresh my private preview artifact (https://claude.ai/artifact/SYhacMhtF63CuzYXqcVXAp) with a boot-checked
>    build, and give me the tested commit for the CDN.
> 4. Then do "Not started" in this order: Stamp and Roll tools; the trade client against a mock host; Stage C (README, thumbnail,
>    gates, playthrough, final independent review, doc re-quote pass).
>
> Commit and push a checkpoint after each landing. Do not open a PR or deploy anything without asking me. Give me short progress
> updates in plain language.
