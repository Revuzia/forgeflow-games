# R14_ROOMS: bigger rooms and the camera for them (round 14, 2026-11-23)

Owner (played the live game 6c495e9c1): "Make sq footage of rooms wider and volume bigger to allow easier exploration for our squishies."
Engineer: ROOMS (data, render, bounds / corral, camera, LIFE ranges, their probes). Ports 5364 to 5366. No git writes.
Other engineers are in the tree at the same time (R14_MULTICUT edits src/shell/cut.ts and _harness/probe_partycut.ts: a tsc error there is theirs).
Run browser things with `WH_FROZEN=1` (no HMR): their edits reload a dev page mid-run otherwise.

## State (update after EVERY finished item; a restart can cut this off at any time)

- [x] 0. Read in, baseline numbers
- [x] 1. Design (below)
- [x] 2a. Data: the six places re-laid (wide + tall)
- [x] 2b. Data: Home re-laid (DT-18 silhouette passes)
- [x] 3. Physics bounds / corral / ceilings / toss caps / float heights (WALL_H 3.4, TOSS_MAX 7.5, HOVER 0.6, pad apex cap 0.5; Home disc with 2+ out). Browser check pending.
- [~] 4. Render: felt, clip, glow, decor rocks, garden cards, cloud tint, the cabin's walls 3.3 m DONE; full picture review of every place pending
- [~] 5. Camera: written and in the node model (95 rows ok); edge chips written; browser proof (pan, carry scroll, chips, zoom) pending
- [x] 6. LIFE ranges and SU-04: 24 of 24 ok on the new layouts WITHOUT a crawl speed change (SU-05: the one known cabin flip-flop, glimglop 131.5 s, as before me)
- [x] 7. Probes: probe_pg_data 95 ok / 0 FAIL; probe_playground 74/74
- [ ] 8. Browser run 1280x800 and 390x844 at every place; screenshots judged; fixes
- [ ] 9. Performance before / after (3 out, low tier)
- [ ] 10. Regression list, build size, the decision written in PLAYGROUND_BUILD.md

NOTE: this decision is **D-104** (D-103 is R14_MULTICUT's "cut several at once"); my comments and rows were renumbered from D-103 to D-104 on 2026-11-23.

## 0. Baseline (the tree at 6c495e9c1 + nothing of mine), this machine

- `npx tsc --noEmit -p tsconfig.json`: clean. `probe_pg_data`: 44 ok, 1 FAIL (DT-18 silhouette, known). `probe_playground` (quick set): 74/74 in 45 s.
- Frame time, 3 out, LOW tier, 1280x800, dev build, SwiftShader (`WH_FROZEN=1 node _harness/rooms_perf.mjs --out=rooms_perf_before`; JSON in `_harness/_reports/rooms_perf_before.json`):

| place | sim ms | draw ms | calls | tris |
|---|---|---|---|---|
| home | 2.16 | 830.3 | 42 | 32922 |
| hearthlog | 2.17 | 819.1 | 56 | 32182 |
| ripple | 2.16 | 680.2 | 59 | 37058 |
| frostbell | 1.22 | 755.3 | 59 | 34964 |
| rainleaf | 1.89 | 738.7 | 51 | 33414 |
| lanternroof | 3.24 | 636.1 | 64 | 38174 |
| cloudloft | 1.91 | 881.2 | 52 | 70294 |

(draw is the software rasteriser: judge the AFTER numbers against these, same script.)

- The LIVE room data is frozen in `_harness/data/live_rooms_6c495e9c1.json` (bounds, walls, spawn, every spot, zone and patch of both layouts): the ratio rows compare against it.

## 1. Design

Sizes (floor area vs live): wide 11.0 x 7.8 m (was 6.8 x 4.8: x2.63, sides x1.62); tall 4.6 x 9.8 m (was 2.8 x 6.0: x2.68; the cabin was 2.5 wide: x3.0; Cloudloft tall
5.8 x 9.8, was 3.6 x 6.0: x2.63); Home a disc of r 5.5 slot units (was 3.4: x2.62). Walls stand 0.15 m outside the bounds.
Things keep their sizes; floor areas grow moderately (pools r 1.3 -> 1.8, the Ice Pond 1.4 -> 2.1, the rug 1.4 -> 2.0, the updraft 1.0 -> 1.4, splash spots 0.6 -> 0.8).
Far corners get a thing or a nap / peek spot each (the cabin's kettle and Snug Basket by the fire; Ripple's drift log peek spots back left, chimes front left;
Frostbell's nest front left, ramp back right; Rainleaf's puddle back right, stones front left; Lanternroof's chimney nap front left; Cloudloft's nest front right).

Tools: `_harness/rooms_relay.ts draft|apply [place]` writes `_harness/data/rooms_plan_r14.json` (the plan, edited by hand) into `src/data/place_<id>.ts`
(numbers only: every other byte of the modules is kept). Re-run `apply` after editing the plan.

Camera (the plan; see section 5 when built):
- A place keeps `fitPlace` of its whole bounds = the WHOLE-ROOM view (zoomed all the way out). The lens is picked with RD-17's bars scaled by the live / new size
  ratio, so a view of the live room's size inside the new room looks exactly like today's view.
- The view is a similar sub-rectangle of the room: centre C on the floor and factor z (1 = whole room): aim = C + z (A - C0), distance = z D. C is clamped so the
  sub-rectangle stays in the room. HUD-safe by similarity.
- Default (auto): C and z frame the party's live box with a margin; z between "today's size" (0.62) and "70 % of today's size" (0.88). When the party does not fit,
  the one in hand, else the play squishy, stays in view; the others are hinted at the frame's edge (a chip; a tap brings the camera to it).
- In hand: the view follows the held squishy; near a frame edge it scrolls (edge easing), so one carry reaches any spot.
- Player: wheel / pinch zoom from the whole room to a close view (the zoom the player sets stays); two-finger drag pans on touch, Shift + right-drag pans with a mouse
  (the plain right-drag still turns the view); the pan eases back to the party after a few seconds or when a squishy is picked up.
- Home: one squishy out = today's camera and things, bit for bit. Two or more out: the same director on Home's own rig (live box, 70 % floor, pan, zoom to the room).
- The director is `src/render/roomcam.ts` in the lazy `later-lifelook` chunk; `stage.ts` (first load) only gets small hooks.

## 2a. Data: the six places (done)

`node _harness/probe_pg_data.ts`: every "DT-01 <place> wide / tall" row 0 problems with the re-specified frame rules:
- the frame a thing must stand in = the layout's own bounds rectangle (was P7's fixed wide rectangle / phone trapezoid), reason written at the row;
- the low front band keeps its share of the depth: z > 1.3 x hz / live hz (2.11 wide, 2.12 tall).

## Progress notes (2026-11-23, mid-run; everything below is IN THE TREE)

- Data: `node _harness/probe_pg_data.ts`: 95 ok, 0 FAIL (was 44 ok + 1 FAIL): DT-01 layouts and whole-room views 0 problems for all seven; DT-18 silhouette PASSES
  (Home re-laid: the Music Box, the lamp, the shelf and the pad stand beside and in front of the party row, never behind a slot; the WIDE Keepsake Shelf is
  `fromN: 2` now, as on a phone: with one out on a desktop it no longer shows); 49 new DT-19 rows (area ratios, the room camera with three out and with the party
  spread, the whole-room view, Home's felt and its room camera).
- Camera numbers from the node model (the director's own code, `roomShot` in probe_pg_data): wide 1280x800: three out at spawn = view factor 0.62, a 1 m squishy
  154 px = 101 % of the live 153 px; spread to three corners = factor 0.86, 111 px = 72 %; whole room = 95 px (62 %). Tall 390x844: spawn 89 px mid = 96 % of the
  live 92; spread 66 px = 71 %; whole room 56 px. Home, two to five out: at least 74 % of today's size by itself; zoomed out the whole felt is in frame.
- Heights: PROPS.WALL_H 2.4 -> 3.4, softbody TOSS_MAX 6 -> 7.5 m/s, HOVER_ABOVE 0.35 -> 0.6 (probe_softbody's hover row re-specified), pad apex cap 0.35 -> 0.5
  in MECH_RANGES with Home's Bounce Pad and the Moss Bouncer at 0.42 (the Puff Pads stay 0.35: at 0.5 PH-17's in-the-updraft row fails, its premise is the cap).
- `probe_playground` (quick set) on the new layouts: 74/74 (one row made data-driven: the Night Breeze toss point moved with the band).
- Render so far: Home's felt r 5.6 and table clip 5.5; the lamp glow r 1.6; decor rocks and Rainleaf's garden cards moved out with the bounds; Ripple's rock ring
  count follows the pool's radius; Cloudloft's cloud floor is tinted under standing bodies (uTint). The cabin's walls are still 2.4 m in the look (TODO 3.4).
- Edge chips: `src/ui/later-room.ts` + `room.css`, attached in `ui/later-play.ts` (not yet seen in a browser).
- SU-04 (`probe_life_selfuse.ts --su4-only`) on the new layouts: 24 of 24 ok (3 to 6 things used by themselves in 180 s at every place, wide and tall), with NO crawl
  speed change (LIFE's reach and wander ranges grew instead). SU-05 still shows the one known cabin flip-flop (glimglop 131.5 s, 4 switches), as before this work.

## Pictures and the browser check (2026-11-23, after the mid-run notes)

- The decision is written at the END of `_spec/PLAYGROUND_BUILD.md` as **D-104** (owner's words, 2026-11-23).
- Pictures of every place, both frames, default view and whole-room view: `_harness/_renders/rooms/c_<frame>_<place>_<default|room>.png` (`rooms_shots.mjs`, high tier).
  Judged: the desktop set reads well (the cabin is a big room with 3.3 m log walls; Ripple, Frostbell, Rainleaf, Lanternroof, Cloudloft have open floor between
  the things and something in every far corner; Home's whole felt stands between the HUD rows). Found and FIXED from the pictures:
  1. a tall (phone) room stood about 55 px right of the frame's middle, its right wall on the frame's edge: a height-bound fit scores every aim across the room
     the same and the leftmost one won. `placeview.ts fitPlayBounds`: equal scores go to the aim that centres the room in the band.
  2. the cabin's boards ran 40 m to every side, so a phone's whole-room view showed "more floor outside the cabin" past the side walls: the boards now end at the
     side and back walls' outer faces (and still run 20 m toward the camera).
  3. the cabin's drawn walls were 2.4 m: 3.3 m now (11 logs), the side cards as long as the new walls.
- FOUND BY THE BROWSER CHECK and FIXED: the edge chips' layer (`.rm-hints`) took EVERY press meant for the stage (`#ui > * { pointer-events: auto }` out-ranked the
  layer's `pointer-events: none`): no wheel, no carry, no turn. `room.css`: `#ui > .rm-hints` out-ranks it. (Would have shipped a dead stage: the rows below guard it.)
- `_harness/browser_rooms.mjs` (new): real input on 1280 x 800 and 390 x 844 at every place with three out: the trip by the Places sheet, default view, whole-room
  view by the wheel / a pinch, close view, pan (Shift + right button / two fingers), the published turn, ONE carry front to far back corner, the edge chips and a
  tap on one, a hard toss at the wall, console errors. Results below when the full run is done.

- FOUND BY THE BROWSER CHECK and FIXED (a published weakness the bigger rooms make matter): a squishy lifted by its SIDE (a sideways drag: the only lift when it
  stands high in the frame) RAN AWAY from the hand at over 1 m/s, out past the bounds (to x = 8.8 m at Home, 11.8 m in one run). `later-life.ts carryPoint`
  measured the hand's lead from the body's centre; a body lifted sideways hangs a rest radius BESIDE the hand (physics startCarry), so the hand's target never
  reached the pointer and the centre's target stayed ahead of the centre. The lead is now measured from where the hand hangs (centre minus the pick-up direction
  x rest radius); a lift straight up is as before (base = centre). After it: Home front (0.59, 4.36) reached within 0.40 m, cabin front within 0.35 m.
- The cabin opens by the first wish, not by stamps: the check seeds `pl` in the save (as the wish sets it) besides the stamps.
- Edge chips: they sat under the hint pill at the bottom edge and could sit on the Journal / Places column: the chips' box now ends above the toolbar and the
  hint pill, and a chip slides off the HUD's pieces inside the band (`later-room.ts` AVOID).

- Browser check, first passing subset (desktop, the cabin): 10 of 11 rows (trip by the Places sheet, default view, whole room by the wheel, close view, pan,
  the published turn, edge chip + click, hard toss 5.7 m/s stays inside, 0 console errors); the carry itself worked (front (4.25, 3.17) to the far back corner
  (-4.63, -3.02), 0.18 m from the spot, the view moved 8.1 m under the hand) and only its "scroll" flag read 0: a paused frame's zero-time update recomputed
  the flag. `roomcam.ts run`: a frame of no time changes nothing. The full runs (desktop, then phone) follow.

- First full desktop run (7 places, 71 rows): 63 ok, 8 FAIL; every one of the 8 was the CHECK's own handling, not the game (a press that landed on a
  neighbour squishy at Home's close view; the friends had walked over to the carried one so nobody was out of view for the chip row; a pan toward a wall the
  view already touched; a corner spot occupied by a thing (Rainleaf's Drip Leaf); a fling with no room on screen; an open place's 0.6 m rim counted as
  "outside"). The check was made honest about each (free press side, pan away to get a squishy out of view, corner = the nearest free floor, going round
  things, a fling sized to the frame, the rim) and is being rerun.

- Desktop Home: ALL rows ok (one out = the published camera, disc r 211 px centred; three out: default view, whole felt by the wheel, close view, pan, turn,
  ONE carry front (0.76, 5.17) to the far back side (-3.45, -3.31), chip "Go to Dollop" + click "Looking at Dollop.", hard toss 7.7 m/s stays on the felt,
  0 console errors).
- FOUND BY THE BROWSER CHECK and FIXED: a squishy lifted from the FRONT of a room (a long drag up the frame) hangs 1.4 m up, well under the finger on screen;
  the edge scroll looked only at the body's middle, so with the finger on the frame's top edge the view crept at 0.035 m/s and the squishy never reached the
  back (stuck 4 m short in the cabin). The FINGER that holds a body now scrolls the view too (`roomcam.ts finger()`, the stage passes the frame's pointer;
  `ROOM_CAM.edgeP` 0.72 .. 0.96 of the band), whichever of the two asks for more.

## Log

- 2026-11-23: baseline, live data frozen, plan written and applied for all seven; DT-01 places 0 problems. Next: the camera (roomcam.ts, placeview bars, stage hooks).
