# RENDER lane brief: finish the render fix round and RENDER-3, then the cut visuals

> **Session 2 (2026-10-06): read RESUME.md right after COMMON.md. It supersedes the paths, the machine rules and the "where the previous engineer stopped" parts below (the work moved to the owner's Windows PC). Verification charters: VERIFY.md.**

**You own:** `src/render/**`, `_harness/renderview/**`, `_harness/browser_render.mjs`, and additive render members in `src/contracts.ts`.
Your port is 5364. Your scratch folder is `scratchpad/render4/`. The previous engineer's drafts are in `scratchpad/render3/`.

**Specs:**
- `_spec/CONTRACT.md` section 7 (palette)
- `_spec/DESIGN.md` 5.3 and section 6 (ceremonies, 6.6 flash safety and calm)
- `_spec/SOUND.md` call-time map
- `_spec/CUT.md`, `_spec/FUN.md`
- `_spec/NEXT_STEPS.md` stage B items B1, B5, B6

## Where the previous engineer stopped

Render round 2 was verified independently: 198/198 and no leaks. The verdict was FAIL on one MAJOR and 12 minors, in
`scratchpad/render_verify/VERDICT.md`, with the verifier's scripts in that folder: adv.mjs, gov_fuzz.mjs, robust.mjs,
alpha_probe.mjs, rawpx.mjs and black2.mjs.

The previous engineer then worked through part A (fixes) and part B (RENDER-3). See `git diff ef5da08..HEAD -- src/render
_harness/browser_render.mjs _harness/renderview` (about 880 lines: `strands.ts` new, plus `material.ts`, `stage.ts`, `bodyview.ts`,
`core.ts`, `oklch.ts`, `capsule.ts`, `ceremony.ts` and `bodyproxy.ts`). Already in that diff:
- a stage B harness section (gallery of 50, contact glow, tack strands, mat bodies);
- `setSafeInsets` with capsule placement clear of the HUD and the bodies;
- the `tip()` passthrough in bodyproxy;
- a merge charge colour fix;
- a stage header line claiming cross-ceremony flash spacing.

It was stopped before verifying all of that. **Do not trust that part A is done: verify it.**

## Part A: prove or finish every finding

Run each of the verifier's repro commands from VERDICT.md against the current code, and fix whatever still fails:
- **MAJOR 1:** chained ceremonies, skip-then-quick-open. Allow at most 3 luminance transitions in any 1 s; aim for 2 or fewer.
  The five back-to-back quick pops count too. Make the chain scenarios permanent checks in `browser_render.mjs`.
- the alpha:true canvas leaving non-opaque pixels;
- `clearBodies` or `removeBody` mid-ceremony orphaning the result;
- a throwing `createBody` leaking the pillar or dome;
- particles cleared on the last frame;
- Epic motes stretching into laser lines while sliding;
- capsule halves reading as hoops or a "mouth";
- the merge T2 tell not reading for Uncommon, Rare and Epic;
- the waiting capsule not moved during a merge;
- calm mode busier at the frame centre;
- dev members (`createStageDev`) shipping in production (prove the fix with vite build + grep);
- per-frame allocations in `MergeRun.dirOf` and the tell array;
- dispose warnings after a context restore;
- `BodyProxy` must forward all `SoftMetrics` fields generically, including `strands`, `slosh` and the coming `pull`;
- the merge zoom for Common;
- phone halos touching the edges;
- Uncommon too subtle;
- the Epic two-tone not showing;
- Legendary and Mythic burst brightness, and the green Mythic aura;
- Epic khaki;
- the harness merge parents must be same-species.

## Part B: finish RENDER-3

1. Per-species look from the catalog, so all 50 are distinguishable at a glance (gallery sheets at 1280x800 and 390x844; Read them
   as an art director).
2. Contact glow (B5).
3. Tack strands (B6), feature-detected on `metrics.strands`.
4. Mat framing for 2-5 bodies on desktop and phone.
5. The capsule kept clear of the HUD's safe insets and the bodies at every aspect ratio, including 568x320 and 320x256.

## Part C: cut visuals (`_spec/CUT.md`; contract members already declared and marked CUT)

1. `AddBodyOpts.chunk`: a piece drawn without a face. It uses the same jelly material, colour, pattern and core glow, at a size that
   follows the body.
2. `setCutSeam(bodyId, plane, t)`: a thin warm seam glow along the plane while the waist forms. It is a glow, never a flash; it is
   softer in calm mode, and the flash governor applies.
3. The parting strand: reuse the tack-strand renderer between the two lobes as they separate (long for the sticky and slime
   families, barely visible for gel).
4. `setBridge(aId, bId, t)`: the reconnect bridge, a glowing neck between two bodies.
5. Up to 6 pieces on the mat, framed, within the frame budget.
6. Harness checks: a stub or real piece body renders without a face; the seam and bridge never breach the flash gate through 10
   rapid cuts and a Reconnect-all (`CUT.md` X09).

## Report
- Per finding: before and after, with the repro result.
- Full harness counts at the end of A and at the end of B and C, run once each.
- The bundle grep proof.
- The gallery sheets you judged.
- The cut visuals, with screenshot paths.
- Contract changes (additive only).
- Known issues.

Time box: about 6 hours. Iterate with targeted harness sections; the full harness takes about 60 min.
