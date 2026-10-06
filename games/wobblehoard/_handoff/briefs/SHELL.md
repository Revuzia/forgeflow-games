# SHELL lane brief: finish SHELL-2b, add the visible XP feedback

> **Session 2 (2026-10-06): read RESUME.md right after COMMON.md. It supersedes the paths, the machine rules and the "where the previous engineer stopped" parts below (the work moved to the owner's Windows PC). Verification charters: VERIFY.md.**

**You own:**
- `src/shell/**`, `src/ui/**` (including `src/ui/hoard/**`), `src/input/**`, `src/main.ts`, `src/app.ts`, `index.html`
- `src/core/settings.ts`
- `_harness/browser_shell.mjs`, `_harness/shellview/**`, `_harness/probe_app.ts`
- additive `Settings` fields in `src/contracts.ts`

Your port is 5366. Your scratch folder is `scratchpad/shell3/`.

**Where the previous engineer stopped.** SHELL-2a (the shell rewrite) is complete and accepted: 14 modules in `src/shell`,
`ShellCollection` wired to `src/collection`, ceremonies with a 350 ms skip gate and 1.0 s burst spacing, settings v2, the audit
fixes, a strict CSP, and dev tools kept out of the bundle. SHELL-2b was in progress when it stopped (`git diff 21d75d2..HEAD --
src/shell src/ui _harness/browser_shell.mjs _harness/shellview`). Already built:
- `src/ui/hoard/{panel,merge,hold,types}.ts`, `src/ui/hoard.css`
- `src/shell/{mat,playHistory,hoardEnv}.ts`
- harness sections U01, U02 and U08

It had just fixed an awaited open in `node_checks` and was re-running the `--only=hoard-loop` harness, then writing the remaining
Hoard harness sections. Read `_shots/shell` and `_harness/_reports/shell.json`, if present, to see the last results.

## Part 1: finish SHELL-2b (the scope is unchanged)

Read `_spec/COLLECTION.md` section 9 (9.1-9.10), 10 and 11 (U01-U09, G4m); `_spec/MERGE.md` (all); `src/collection/types.ts` and `copy.ts`.

1. **Hoard.** Open it from `ui.hud.slot` at any time a ceremony is not running; while a ceremony runs, the open is queued until it
   ends. The cabinet shows 50 stacks in catalog order, with owned and unowned states as 9.2 describes. Include filters and sorts,
   and label it as the Practice shelf for a guest. The detail card shows the live squishy (`game.focusInstance` /
   `restorePrimary`), a heart, and **Play with this one**.
2. **OWNER REQUIREMENT: switch squishies at any time, in one action.**
   - **Play with this one** swaps at once (atomic `bodies.swapTo`, the name plate updates, a live-region line).
   - A compact **quick switcher** in the HUD shows the last 5 played and hearted squishies with their procedural icons. It must
     work on 390x844 and 1280x800 without cluttering the play view. The `[` and `]` keys switch too, when shortcuts are on, and
     are ignored in form controls.
   - The play squishy persists across reloads.
   - A switch requested during a ceremony applies right after it ends.
3. Species icons (9.8): procedural, cached, no images.
4. Capsule dock: up to 5 waiting capsules.
5. Restock (pick one of three per day) and the Tasks panel.
6. Merge pad per `MERGE.md`:
   - preview lines with odds and NEW tags, tier-up chance and why, merges left today, and the last-copy modal;
   - a 0.5 s hold, then `game.collection.merge(ids, digest)`, then `game.playMerge(r.parents, r)`;
   - on `odds_changed`, re-show the preview;
   - Tidy-up.
7. Play mat (B1): bring 2-5 squishies onto the mat (at most 3 on low) through the `bodies.ts` seam and `stage.addBody`, and put
   them back with one tap. Body-to-body contact arrives from physics later this round: when `body.collide` exists, call
   `body.collide(others)` once per frame before `step()` for every mat body, and route `bump` events to `audio.bump` and a light haptic.
8. Accessibility and states:
   - every panel is keyboard-operable, with focus management and Escape;
   - live-region lines for capsule ready, reveal, merge result, restock and switches;
   - reflow at 320 CSS px and reduced motion;
   - the empty, error and offline states of 9.9.
9. The three title and wordmark checks: `.title-mark` textContent is 'SQUISHKEEPER', and the h1 and `.wordmark` read 'SQUISH KEEPER'.

## Part 2: visible XP (`_spec/FUN.md` section 2; owner request)

An ECON engineer is changing the meter rules in parallel (`src/core/meter.ts` and `src/collection/meterfeed.ts`):
- a held stretch will pay per second, like a squeeze;
- ordinary tapping will always pay a little;
- the collection will gain a pure preview function for the pending gain of a touch in progress. Feature-detect it. Until it lands,
  compute the pending arc from the squeeze or stretch hold time with the published pay constants.

Build the UI side:
1. **Sparks.** Each paying touch sends a few small sparks from the touch point to the meter ring, which then fills with a short
   ease. Under Calm effects, use a soft glow on the ring instead of sparks. Keep it cheap and allocation-free per frame; DOM or
   canvas, your choice.
2. **Pending arc.** While a squeeze or a stretch is held, a lighter pending arc on the ring grows in real time. On release it banks
   (it becomes real fill) or disappears if nothing was paid.
3. Add harness checks:
   - a single quick poke visibly moves the ring;
   - a 3 s stretch shows a growing pending arc that banks on release;
   - Calm effects shows no sparks.

## Report
- What you built, per item, with the screenshot paths you judged.
- U01-U09 and the MERGE section 10 checks, with counts; the harness totals.
- Bundle size.
- Frame cost with 3 and 5 bodies.
- Known issues.

Time box: about 5 hours.
