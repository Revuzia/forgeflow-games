# GENESIS — `?bench=`: one link, one results file (ledger)

Purpose: a Mac test round was 8-16 URLs opened, landed, settled and recorded by hand, and the Mac's numbers swing 2-3x
with the machine's load, so single runs said little. `?bench=<plan>` runs a list of variants INTERLEAVED and repeated
(A B C A B C ...) by itself and ends on one results page with one text file.

Files: `src/render/bench.ts` (pure: plans, URL encodings, step order, step URL, report parsing, median / min / max,
the results text), `src/ui/benchpanel.ts` (the runner, the progress line, the results page), a two-line hook in
`src/main.ts` (a dynamic import, only when the URL has `bench=`: normal play loads none of it), tests
`tests/render-bench.test.ts`, the SwiftShader end-to-end probe `_harness/arc-work/bench-e2e.mjs`.

## What the Mac user does
1. Clean Chrome, one tab, window as in the earlier rounds (the canvas size is in the results), plugged in, other
   rendering tabs closed.
2. Open ONE link:
   `<BASE>/index.html?bench=water`      (or `terrain`, `full`, `noise`, or a link the lead sends)
3. Leave the window in front and do not touch it. A line at the top says the step, the variant and the time left;
   "Abort" ends the run early and still shows what was measured.
4. When the page says "GENESIS bench: ..." with a table, the results file has been downloaded (if Chrome did not
   download it: "Download results (.txt)", or "Copy"). Send that one file back.
The tab title shows `BENCH 4/15 <variant>` during the run and `BENCH DONE` at the end. `<BASE>/index.html?bench=last`
shows the last finished run's text again (kept in this browser's local storage).

## How it works
- The launch page reads the plan, writes it into sessionStorage (`genesis.bench.v1`: plan, order, next step, results)
  and replaces itself with step 1. It boots no world.
- A step is a page load of: the BASE parameters (everything in the launch URL that is not a bench parameter;
  `scenario=babel&seed=307987276` when the link names no scenario) + the variant's parameters laid over them +
  `quality=<preset>` (Ultra unless `bpreset=`; a variant's own `quality=` wins) + `bench=run&brun=<id>&bstep=<i>`.
  The switches are read at load (perfswitch.ts), hence the reload per step.
- The step waits for the world (`__GENESIS__.ready`), then places the camera at the STANDARD LANDING as a camera
  spec: orbit over 18 N / 35 W, heading 0, the automatic tilt, distance = the boot distance (2.6 radii) x
  exp(0.0013 x (4 x -800 + 2 x 80)) — the hand protocol's "wheel 4 x 10 ticks in, 2 out" in the orbit camera's own
  zoom formula. The altitude it lands at is in the results (column `alt m`).
- Then the settle time (30 s; a variant running with `tcache=1` gets 60 s so the cache fills), then the recording
  window (15 s). During the window the page runs its own requestAnimationFrame callback and takes the wall time
  between two callbacks as a frame interval (the numbers the summary uses: fps = frames counted / the time from the
  first callback to the end of the window, p50 and p95 of the intervals) and runs the perf report over the same
  seconds (its HEADLINE, main ms, `perf fixes` line, js heap and the whole text are kept; both sets of numbers are
  printed side by side per step). `tcstat` is taken at the landing, at the start of the recording and at its end
  (the terrain cache writes it every 64 frames: empty until then).
- The result goes into sessionStorage and the page replaces itself with the next step; after the last step, with the
  results page (`bstep=done`, no world booted).
- Failures do not stop the run: a world that is not ready within `bload` seconds (240), a fatal / retry card, a lost
  WebGL context, a window with no frames, a reload or a tab crash during a step (the reloaded page finds its own step
  marked in flight) are each recorded as FAILED with the reason, and the next step runs.
- Validity: a step whose page was hidden, or whose window lost the keyboard focus, during the settle time or the
  recording is marked INVALID (reason given) and left out of the summary; its numbers and report stay in the file. A
  step does not start counting while the page is hidden (the line says WAITING). The page asks for a screen wake lock.
- Results page: per variant the median / min / max of fps and of the interval p50 across its valid repeats (n of
  planned), median p95, median main ms, the fps ratio to the first variant; warnings (failed / invalid steps, a build
  or canvas size that changed mid-run, landing altitudes that differ); the order run; then the full text: summary,
  every step with raf and report numbers side by side, the terrain cache lines, and every step's raw perf report.

## URL syntax
`?bench=<plan>[&<bench options>][&<base parameters for every step>]`

`<plan>` is one of
- a built-in name: `water`, `terrain`, `full`, `noise` (below);
- `custom` with a typed list `&bv=<list>`: variants separated by `|`, each `label~params`; inside the parameters `;`
  stands for `&` and `:` for `=`, so nothing needs percent-encoding:
  `?bench=custom&bv=N~|fast~wfast:3;wshade3:nossr|nowater~water:0`
  (no `~`: the parameters are their own label; a bare word is a label for the unchanged game; percent-encoded `&` `=`
  work too; a parameter value that itself holds `:` `;` `|` `~` needs the JSON form). `bv=` after a built-in name
  ADDS variants to it: `?bench=water&bv=P+seamold~scene:0;shadows:0;wfast:3;wshade3:seamold`;
- base64url of JSON (safe in any chat or mail): a list `[["label","a=1&b=2"], ...]` or an object
  `{"name":"round21","variants":[...],"reps":5,"settle":30,"rec":15,"base":"wclock=100"}`. Raw (percent-encoded) JSON
  works too. Make one with:
  `node -e "import('./src/render/bench.ts').then(m=>console.log(m.encodePlan([['N',''],['fix','tcache=1&wfast=3']])))"`
- `last`: no run, the last finished run's text.

Bench options (all optional):
| parameter | default | meaning |
|---|---|---|
| `breps` | 3 | interleaved repeats of the whole list |
| `bsettle` | 30 | seconds between the landing and the recording |
| `bsettletc` | 60 (or 2 x `bsettle` when that is given) | the same for variants with `tcache=1` |
| `brec` | 15 | seconds recorded |
| `bload` | 240 | seconds a world may take to load before the step is FAILED |
| `bpreset` | ultra | the preset every step is forced to (`quality=` in the link means the same) |
| `border` | seq | `rot`: each repeat starts one variant later (A B C, B C A, C A B) |
| `bfocus` | 1 | `0`: a lost keyboard focus does not invalidate a step (a hidden page still does) |
| `bauto` | 1 | `0`: no automatic download at the end |
| `bdist` | - | the landing's orbit distance in metres, in place of the wheel-zoom distance |
| `bcam` | - | a whole camera spec as JSON (app.ts `CameraSpec`) in place of the standard landing |
Anything else in the link is a base parameter for every step (`gltrace=0`, `wclock=100`, another `scenario=` / `seed=`).

Examples
- `<BASE>/index.html?bench=water` — 5 variants x 3 = 15 steps, about 18 min.
- `<BASE>/index.html?bench=terrain` — 9 variants x 3 = 27 steps, about 45 min.
- `<BASE>/index.html?bench=full&breps=5` — N against every fix, 5 pairs.
- `<BASE>/index.html?bench=noise` — the unchanged game twice per repeat: how far apart two runs of one build are now.
- `<BASE>/index.html?bench=custom&bv=P~scene:0;shadows:0|ssrall~scene:0;shadows:0;wfast:3;wshade3:ssrall|mask~scene:0;shadows:0;wfast:3&breps=4`
- quick trial of the machinery: `<BASE>/index.html?bench=noise&breps=1&bsettle=3&brec=3`

## Built-in plans (P = `scene=0&shadows=0`, FIX = `tcache=1&wfast=3&deepbed=1`)
- `water`: P · P+wfast3 (`wfast=3`) · P+wfast3+nossr (`wfast=3&wshade3=nossr`) · P+wfrag0 (`wfrag=0`) · P+water0 (`water=0`)
- `terrain`: N · N+tcache (`tcache=1`) · FIX · FIX+water0 · FIX+shadows0 · FIX+msaa0 · FIX+hide (`hide=veg,cover,life`) ·
  FIX+P · FIX+rscale.5 (`rscale=0.5`) — the frame bisect on top of the combined fix
- `full`: N · FIX
- `noise`: N-a · N-b (identical)

## Limits
- The bench runs inside the page: if the page's own script does not load at all (network down, a 404 after a deploy),
  nothing can record that; the run stops on that page. Reload it: the step is then recorded as failed and the run goes on.
- The load timeout is a timer on the page's main thread: while the world's boot blocks that thread the timer cannot
  fire, so a `bload` shorter than the boot ends late (seen on SwiftShader: `bload=5` ended a step after 109 s).
- Plan and results live in the tab's sessionStorage: a run cannot be continued in another tab or after the tab is
  closed (only the finished text survives, under `?bench=last`). About 5 MB: if it fills, the oldest raw reports are
  dropped and the numbers kept.
- The window size and device pixel ratio are NOT forced: earlier rounds forced 1686x963 at 1x by hand. Set the window
  the same way before opening the link; the results print the canvas line and warn when it changes mid-run.
- The game clock runs during the settle time, so a 60 s settle (tcache variants) records about half a game minute
  later than a 30 s one. For equal clocks give both: `bsettle=60&bsettletc=60`.
- The preset is forced by `quality=` in the step URL (what Settings sets, without touching the stored preference);
  the other graphics toggles of Settings stay as stored in that browser.
- The perf report runs during the window as in the hand protocol (its GL call tracing included; `gltrace=0` and
  `gputimer=0` as base parameters switch those off for every step).
- At very low frame rates a short window holds few intervals (1 fps x 15 s = 15): use `brec=30` there.
- Focus: Chrome reports a lost focus when the user clicks another window even if the game stays visible; such a step is
  marked invalid by design. `bfocus=0` relaxes that.

## Verification (2026-11-19, on top of 44281251)
- Unit: `node --test tests/render-bench.test.ts` (11 tests: plans, the `bv` list and base64url / JSON encodings and
  their round trips, options and base, the interleaved order, a step's URL, the tcache settle, the landing distance,
  frame statistics, report parsing against a real PerfRecorder report and a Mac round's lines, median / min / max,
  warnings, the results text).
- End to end, SwiftShader, `_harness/arc-work/bench-e2e.mjs` (opens ONE launch link, touches nothing, waits for the
  results page; logs in `_harness/scratch/arc/bench/`):
  * Ultra, 2 variants x 2 repeats (`bv=N~|P~scene:0;shadows:0&breps=2&bsettle=2&brec=2`): order N P N P, every step
    landed at 59.7 m (the hand protocol's altitude), results page + automatic download + the button's download +
    Copy, downloaded text == the panel's text, 0 page errors. Panel screenshot looked at.
  * `bload=5`: all four steps FAILED "not loaded after 5 s", the run went on to the results page by itself.
  * a `blur` event during step 3 -> that step INVALID ("window lost focus ..."), left out of the summary; Abort in
    step 4 -> results page "ABORTED after 3 of 4 steps" with what was measured.
  SwiftShader draws one frame of the full scene in 2-25 s here, so those three runs prove the machinery, not the
  numbers: windows of a few seconds held 0-2 frames (hence the "fewer than 10 frames" warning and the
  frames-over-window fps).
  * final code, a scene light enough to give frames (Low 320x180, scene / water / clouds / shadows off; A = base,
    B = `rscale=0.5`, 2 repeats, `bsettle=3&brec=25`, 188 s in all): A 30.9 / 30.7 fps, B 44.2 / 39.1 fps (767-1103
    frames a window); the page's own fps equals the perf report's HEADLINE fps in all four steps (30.9 / 44.2 /
    30.6-30.7 / 39-39.1); summary A median 30.8 (30.7-30.9), B 41.7 (39.1-44.2), x 1.35; 59.7 m every step; no
    warnings; download == panel text; 0 page errors. Panel screenshot looked at
    (`_harness/scratch/arc/bench/out/final-results.png`).
- NOT verified here: real numbers on the Mac; a hidden page (headless Chrome is never hidden; the blur path was);
  `tcstat` capture on a live terrain cache (it appears after 64 frames; unit-tested on a report line only); the
  wake lock; Chrome's own download prompt for the automatic download; a real tab crash (the reload path is the same
  code: a step that finds itself already in flight).
