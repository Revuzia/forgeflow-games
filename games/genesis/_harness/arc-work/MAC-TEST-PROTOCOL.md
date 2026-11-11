# GENESIS — Mac performance test protocol (for the owner's local tester)

Purpose: measure the preview build on the owner's Apple M5 MacBook in Chrome, the same way every time, so each fix can
be judged by numbers. Paste the full report text of every run back to the GENESIS cloud session.

## Before you start
- Use Chrome. Close or stop every other tab that renders (Vale, video, other games): they share the GPU.
- Plug the Mac in. Let it cool for a minute between runs if the case is warm.
- Window size: leave Chrome maximised as usual (the report records the canvas size).

## Build
Preview: https://forgeflow-games-cdn.isimcha85.workers.dev/genesis-preview/index.html
Hard-reload once (Cmd+Shift+R) so the newest build loads. The report's first line shows the build and every URL switch.

## One run (repeat identically for every variant)
1. Open the variant's URL (table below). Start a new world with the same seed as before (the earlier runs used the
   seed that gives the town "Rubolhin by the Lake"; if the seed is not shown, use the default new world and write down
   which town you zoom to).
2. Set the quality preset named in the table (Settings, or F10). Leave everything else default.
3. Zoom from orbit straight down to the town, to about 100 m altitude. Wait 10 s (warm-up).
4. Press Shift+F12 to open the perf overlay. Click "Record 20 s".
5. During the 20 s: pan slowly around the town, zoom out to ~200 m and back to ~80 m, pan again. Same moves each run.
   Do not open menus or the powers wheel.
6. Click "Copy report" (if the clipboard is blocked the text is shown selected: Cmd+C). Paste it into a text file
   named after the variant.
7. Also note in one line: how it FEELS (smooth / slightly choppy / choppy / slideshow), and anything odd you saw
   (white flashes, trees or ground popping in, holes, flicker, shadows jumping).

## Variants for the current build
| # | name | URL ending | preset |
|---|------|-----------|--------|
| 1 | ultra | `index.html` | Ultra |
| 2 | high | `index.html` | High |
| 3 | ultra-nospan | `index.html?span=0` | Ultra |
| 4 | ultra-nopreupload | `index.html?preupload=0` | Ultra |
| 5 | ultra-nofartrees | `index.html?fartrees=0` | Ultra |
| 6 | ultra-nozcons | `index.html?zcons=0` | Ultra |

Variants 3-6 switch ONE fix off each, to show what that fix is worth. When a new build adds switches, the GENESIS
session will send an updated table.

## Extra checks (look, don't measure)
- Descend slowly from orbit (2 km) to 50 m over a forest: do trees exist all the way down, or pop in / grow as a disc?
- Fly fast from orbit into a town through the clouds: any white frames?
- Evening (low sun) near hills: long shadows present and steady?
- Vale in the same Chrome for comparison (stop its rendering afterwards): note its fps.

## What to send back
All report texts (one per variant) plus the one-line feel notes, in the order of the table.
