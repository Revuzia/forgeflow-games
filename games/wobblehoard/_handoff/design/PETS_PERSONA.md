# PETS_PERSONA: what makes each squishy feel alive

Design only; nothing under `src/` was touched. Numbers: my probes (scratch `pets/persona/`, loaded PC, minimums). Nothing was seen or heard.

## 1. What exists, and the limit that shapes the design
- Face (`render/face.ts:196-219`): seeded blinks, eyes follow `pointerNdc`, widen when squeezed, happy arcs on spring-back. No mouth, no other mood. No pose, mood or nickname storage (`collection/types.ts:35`).
- Physics drivers: `nudge`, `burstOpen`, `setFold`, `tremble`, `moveTo` (`softbody.ts:1194-1247`); `game.onStep` runs a hook each sim step (`game.ts:570`).
- **Measured: a nudge is not a hop.** Dollop and Boingle stay down up to 5 m/s (7 m/s: 72-79 cm); Kneadle hops at 2.0 (17 cm), Capnap/Wrigglo at 2.6. A lean from one nudge fades in under 0.7 s. `burstOpen(.3)` is a clean puff (+5-10% wide, settles in 0.25-0.57 s). `setFold(.3)` changes height 0.89x-1.31x by species. So behaviours ride on a **render-only pose layer**; physics drivers are for puffs, shivers, folds, slapstick.

## 2. Personality from data
Five axes (0..1) from the catalog (`axes.ts`): PEP, COZY, NERVE, CURIO, DOZE = family prior + bounce/firmness/stretch/size/eye style/signature touch/tier (firm silicone NERVE .8, slow-rise DOZE .95). +-6% per instance from the genome seed, so two Dollops differ. Mood word = the species' strongest axis (50 distinct, all in its own top 3). Toy = one of 10 tags (ball, stick, ring, bell, cushion, feather, spinner, blocks, bubbles, lantern; map to the TOYS lens objects). Food = family's modal food of the CARE prototype (CARE draws the real favourite). Ticklish spot = a catalog feature direction.

| Name | Mood | Toy | Food | Ticklish | Signature | Idle habit |
|---|---|---|---|---|---|---|
| Dollop | Cheery | ball | plumdrop | swirl-peak tip | Peak-flop | peak leans after pointer |
| Plumpet | Jolly | ball | plumdrop | round tummy | Roly-poly rock | hums while rocking |
| Twangle | Fidgety | stick | honeybead | pointed tip | Tip-twang | tip twitches |
| Puddlo | Placid | bubbles | frostwhirl | middle of the puddle | Spread and ripple | slow blink, lazy slosh |
| Glugbean | Chatty | bell | frostwhirl | the dip on top | Glug-roll | burps a bubble |
| Crumbit | Sturdy | blocks | sprinklet | top stalk | Bead-shuffle | settling bounce, beads crunch |
| Chunkle | Earnest | blocks | plumdrop | top corners | Straight-face giggle | sternly squints at pointer |
| Munchip | Perky | ring | plumdrop | notch at the top of the heart | Heartbeat | quick chew, looks innocent |
| Wisplet | Dreamy | cushion | toastcloud | middle puff | Cloud-lift | drifts sideways |
| Cushlet | Mellow | cushion | toastcloud | a top corner | Flop-and-fluff | long sigh, corner droops |
| Crimpo | Warm | spinner | honeybead | crimped seam | Fold-and-fan | wiggles along its seam |
| Thumbly | Rosy | feather | honeybead | both cheeks | Cheek-puff | smooths its own dimple |
| Boingle | Plucky | ball | crumblet | nose tip | Rear-and-boing | stares, double blink |
| Dimpla | Steady | bell | honeybead | centre button | Button-press | one click-bounce |
| Nuzzo | Snuggly | cushion | plumdrop | both ears | Palm-nuzzle | ear flick |
| Tadpolo | Inquisitive | bubbles | honeybead | tail knob | Tail-flick swim | tail wag |
| Swishel | Serene | bubbles | frostwhirl | rim of the dish | Dish-swish | ripple circles the dish |
| Granulo | Eager | spinner | sprinklet | top point | Star-shimmy | points twitch in turn |
| Sproutle | Peppy | spinner | plumdrop | the two tufts | Tuft-waggle | grows 5% taller, plops |
| Wrigglo | Nosy | stick | sprinklet | raised head | Inchworm | periscope look-around |
| Acornel | Shy | blocks | toastcloud | under the cap rim | Cap-pull peek | peek, duck, peek |
| Capnap | Drowsy | cushion | frostwhirl | cap edge | Mushroom nap | nods off, startles awake |
| Knubby | Agreeable | ball | honeybead | the big thumb | Thumbs-up nod | nods to the music |
| Kneadle | Patient | blocks | crumblet | the dimple | Loaf-tuck | dimple, then smooths flat |
| Hooplet | Zippy | ring | crumblet | top dimple | Triple-boing | dimples deepen in turn |
| Spirelo | Proud | ring | plumdrop | horn tip | Horn-toss | squints at its own horn |
| Zingle | Zesty | stick | honeybead | tail knob | Zing-stretch | ripple along the crest |
| Petalop | Graceful | feather | frostwhirl | petal tips | Bloom | petals sway in a wave |
| Burrbin | Feisty | ball | sprinklet | between two studs | Burr-up | stud ripple round the body |
| Marigel | Sunny | spinner | plumdrop | glowing heart | Petal-twirl | tilts petals to pointer |
| Gloopsy | Silly | bubbles | sprinklet | drippy feet | Silk-string | drip forms, plops |
| Hushpuff | Gentle | cushion | toastcloud | ear tufts | Shh | ear tuft twitches |
| Slumbrel | Unhurried | lantern | frostwhirl | shell swirl | Shell-retreat | slow-motion blink |
| Thudge | Stalwart | ball | crumblet | small dent on its front | Boulder-stomp | contented rumble |
| Diademo | Regal | ring | honeybead | crown points | Coronation | adjusts crown, head tilt |
| Taffelin | Daring | stick | honeybead | tail tip | Comet-streak | sheds glitter specks |
| Rattlebead | Merry | bell | sprinklet | top knob | Rattle-dance | shakes to hear itself |
| Cindergoo | Spirited | lantern | sprinklet | flame tip | Flicker-dance | tip sways like a flame |
| Selenuff | Soothing | lantern | toastcloud | horn curls | Lullaby | crescent yawn |
| Pastrel | Toasty | feather | honeybead | curled ends | Croissant-curl | ends curl, one then other |
| Flipdome | Deliberate | blocks | honeybead | back knob | Flip-pop | back knob wiggles |
| Caromel | Frisky | ball | crumblet | back stud | Ricochet | tiny bounces on the spot |
| Ambrosel | Beaming | lantern | plumdrop | wing tips | Wing-flutter bow | crown glints |
| Tidelume | Tranquil | bubbles | frostwhirl | fan tail | Swim-glide | fins flutter |
| Glimglop | Impish | bubbles | sprinklet | trailing glob | Glop-glimmer | drips glitter |
| Somnuff | Sleepy | cushion | frostwhirl | drooping ears | Dream-drift | sways, eyes one-third open |
| Fossilo | Wise | blocks | crumblet | the horn | Statue pose | tilts horn to pointer |
| Skeinara | Elegant | feather | honeybead | ribbon tail tip | Thread-weave | ribbon tail draws a lazy S |
| Constello | Wondering | lantern | sprinklet | top star point | Constellation | star points drift round |
| Prismelo | Brilliant | bell | plumdrop | facet points | Facet-chime | tilts to catch light |

## 3. Moods and body language
Five moods (joy, shy, curious, excited, dizzy) decay alone (tau 36/11/14/8.7/3.6 s); nothing is stored, leaving costs nothing. sy = height scale, volume kept.
| State | Body | Face | Cue |
|---|---|---|---|
| Happy hop | sy .88, lift 0.3 R in 0.5 s, land sy .90 + `audio.land` + dust | happy arcs | happy |
| Sleepy slump | sy .82-.96, breathing +-3% at .25 Hz | droop | yawn |
| Shy | sy .88, lean away | blush, look aside | psst |
| Proud puff | swell +6% | sparkle | boop |
| Curious lean | 0.09 R toward pointer | wide | hmm |
| Dance | yaw 7 deg at .55 Hz (half the 66 BPM beat) | happy | song |
| Sneeze | tremble .4, `burstOpen .45`, dust | squeeze-shut | sneeze |
| Dizzy (hard toss) | yaw wobble 12 deg, 3 s | X/spiral | oof |
**New faces** (`setExpr(name, tau)`, weights eased): happy-closed hold, sparkle (glint x2), droop (the `sleepy` lid made dynamic), X/spiral (shader branch), tongue, blush. Sounds are the VOICE lens kinds (`voice/src/plan.ts`).

## 4. Signature tricks by material (21 kinds; names in the table)
Slime: Gloopsy pulls a silk string to the pointer (existing `StrandTube`; needs `stage.strandTo`). Putty/mochi: Crimpo folds and fans (`setFold .25` then `burstOpen .3`; measured 1.08x tall, 0.86x wide, rest in 0.3 s). Pop dome: Dimpla presses flat and pops (pose + ring; the real snap is not built, `catalog.ts:56`: a pose, honestly). Beads: Crumbit shivers (tremble + nudge).

## 5. Autonomous behaviour (the Director)
Tick 0.5 s; attempts 0.10/s x (.6+.8 PEP) x (1-.5 DOZE). Classes: micro (glance, twitch, settle), small (look-around, stretch, hop, yawn, hum, lean), medium (sneeze, hiccup, scoot, dance, signature), show (full signature). A class starts only 3/5/12/25 s after the last touch; costs 0/1/2/3 of a 4-point budget (+1 per 14 s); same act again after 90 s; non-micro acts on the mat 6 s apart; unprompted voices one per 30 s and only if Voices = All. Naps after ~200 s idle (70 s if sleepy) for 40-110 s, wakes itself with a stretch; touch wakes it cheerfully.
**Never during:** a finger, grab, carry, non-Hand tool, ceremony, panel, hidden tab, an unsettled body, or a frame average over 24 ms (then micro only). A touch ends any act in ~120 ms.
**Calm / reduced motion:** every motion op is dropped, poses halve and slow 1.5x, durations x0.65; faces, captions, voices stay.
**Simulation** (mocked actuators, 50 species x 2 seeds x 20 min): untouched, median 2.0 acts/min per squishy (0.82 Capnap to 3.13 Hooplet), 0.28 medium and 0.10 show; a signature move every ~3.5 awake minutes; at most 3 non-micro acts in any 20 s, 6.1 s minimum gap; voiced 0.57/min, 30 s gap; asleep 22% (12% Hooplet, 56% Wisplet). Calm ON: 1.4/min and **0 motion ops**.

## 6. Bond and names
Bond points are CARE's. Persona adds an 8-sector touch map per item; after 12 touches the top sector is its favourite spot: a purr-lean and giggle when rubbed. The ticklish spot's first rub is "found it!" once.
**Nicknames:** fixed list, no free text. Not in `HoardSave` rows (`store.ts:93` rejects unknown flags): a sidecar `itemId -> index` in CARE's `wobblehoard:v1:pets` blob; saves untouched. List = the 24 of `ui/names.ts` (indices kept) + 72 new, all passed through the species-name gate (verbatim slices of `probe_catalog.ts`; list in scratch `names_final.json`). The gate refuses the existing "Marlo" (one edit from "mario"): swap in "Merri". It refused 15 candidates (Button, Lemon, Mochi...).

## 7. Needs per lane
- **Physics:** nothing new for the top ten.
- **Render:** `render/pose.ts` hooked in `BodyProxy.sync` (eased sy/puff/lean/yaw/lift + 3 gaussian bulges on the proxy's copy, after the puppet, before the table re-seat). Tested: identity 0 mm, squat/stretch volume 1.000, foot 0 mm, 0.018-0.125 ms per posed body-frame, idle bodies 0. Plus `face.setExpr` and optional `StageLike.setPose?/setExpr?`. The sim mesh is not posed, so a touch ends the pose first.
- **Audio:** none for motion. The director calls `audio.land` and dust itself (a render hop makes no `land` event). Dance needs the beat phase (`musicInst` is private, `engine.ts:93`): a 5-line export or a free 66 BPM clock.
- **Shell:** `director.ts` on `game.onStep`, fed by `feedback.handle` and `driver.touch.contact()`.

## 8. The ten best, by delight per effort
| # | Behaviour | Effort | Uses |
|---|---|---|---|
| 1 | Pose layer + breathing + settle (the base) | M | render |
| 2 | Expressions: happy-closed, sparkle, droop, blush | S | face |
| 3 | Curious lean toward the pointer | S | pose, eyes |
| 4 | Happy hop, landing squash, dust, land sound | S | pose, audio.land |
| 5 | Nap cycle, dream bubbles, cheerful wake | S | pose, face, fx |
| 6 | Ticklish-spot giggle + learned favourite spot | M | hit to rest-local, touch map |
| 7 | Sneeze / hiccup / yawn slapstick | S | burst, tremble, nudge |
| 8 | First 8 signature moves (tipFlop, stretchSnap, rockRoll, puffSigh, slumpFluff, hopLand, buttonPress, peekHide) | M | pose, drivers |
| 9 | Fixed-list nicknames | S | UI, storage |
| 10 | Dance to the music bed | M | shimmy, beat export |

## 9. Bytes and honesty
Estimate, not built: ~15-20 KB raw minified for this lens (rows 3.5, Director 7, pose 2, faces 3, names 1), before voices. With the UI (~90 KB) and the other PETS lenses this needs the owner's call on the 1229 KB gate (1143 KB used). Pays no Squish Points; taps stay free. No loss state: moods decay, naps end, being away changes nothing. Prototype: `pets/persona/proto/`.
