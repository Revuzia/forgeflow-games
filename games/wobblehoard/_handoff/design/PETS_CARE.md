# PETS_CARE: the care loop (wants, feeding, water, the leak, wash, rest)

Lens: THE CARE LOOP (one of six PETS designers). 2026-10-08. Design only; nothing in the game was edited. Evidence: `src/` read this session; prototypes in the scratch folder `pets/care/` (`pet.ts` director, `sim_care.ts`, and a patched COPY of the physics with `probe_sag.ts` / `probe_bulge.ts`). Nobody has seen or heard any of it: look and sound are intent, the physics and director numbers are measurements, and the player behaviour in the sim is assumed.

## 1. Verified starting point
- No pet state exists: `grep -rnw "pet|pets|hunger|thirst" src` = 0 hits; "sleepy" is only a permanent eye shape (`core/genome.ts:22`, 12 species). No species-specific audio (`grep species src/audio` = 0). The face has eyes and no mouth (`render/face.ts:6-10`).
- The soft body has `setFold`, `burstOpen`, `tremble`, `nudge`, `setFrac`, slosh and air-bleed (`physics/softbody.ts:1194-1313, 2068, 2334`), but NO volume target apart from shape (deflation), NO non-uniform squash (slump) and NO movable bump (a swallowed lump). `grep setSag|setAir|setBulge src` = 0.
- Size gate: the task says G0 = 1229 KB, but `vite.config.ts:27-31` now says G0 = 3 MB raw and G0b = 600 KB gzip for first-play files, with `later-*` chunks excluded (pets named). I cannot tell whether that is approved; see section 9.

## 2. Wants (invitations, never needs)
Nine: **peckish** (treat), **thirsty**, **leaky**, **grubby** (wash), **sleepy**, **company** (needs other squishies in the Hoard), **playful** (needs toys), **cuddly** (after a hard toss or bump), **shiny**. A want shows as a pose (eyes, a hop, a mouth dimple), a distinct-shaped icon bubble (button, 44 px), ONE soft call, and a caption in the live region ("Dollop would like a drink."). No bar, no gauge; the name plate shows one word (Content, Peckish, Warm, Snug...). Touching a squishy with a wish makes it glance at the Care button.

**Rationing (the cap on nagging).** Active play time only. At most 1 visible per squishy, 2 on the mat; 30 s life, then it fades and that want rests 8 min (10 after an answer). Gap between asks 90 s, DOUBLING for each ask that faded unanswered (90, 180, 360, 720 s), reset by any answer; at most 3 in 5 min, 5 per squishy and 8 in all per hour. Icon needs the pointer up 3 s; the call waits for 6 s. None during ceremonies, panels, Cut/Snap, cut pieces. Settings: Pet wishes On / Fewer / Off.

## 3. The reward: bond, never a currency or penalty
Per squishy `bp` only goes up: 0/20/60/130/240 = New friend, Pal, Buddy, Best friend, Forever friend (a four-quarter heart ring plus the word). Answering a wish pays 2 to 8 points (+2 for its favourite treat; the whole leak mend pays 8 once); unprompted care pays a third (min 1, 3 an hour). A **warmth bucket** (24, refilling 24 per day) bounds it. It unlocks only delight: a follow-the-finger behaviour, a signature trick per family (triple wobble, rattle-shake, spider-web grab...), bows/scarf/heart-ring accessories, a nickname from the fixed list (needs a slot: `collection/types.ts:35`), keepsake patch stickers.
**Ties:** care pays 0 squish points; while a care item is armed the shell does not report the contact to the meter (a plain cuddle is a normal squeeze and pays as today). No task, no capsule. A newly revealed squishy gets a "first treat" wish. The Hoard card shows the heart ring.

## 4. Across sessions (exact)
Stored per item id in `wobblehoard:v1:pets` (~14-45 bytes each, capped at 300 entries): `bp`, bucket, treat-tried mask, accessory, nickname index, patch. NOT stored: wants, leaks, deflation, sleep, suds. A new session starts every want at a seeded 0-0.35 (the comfortable floor); nothing builds while away. A day away only earns a warmer greeting and a full bucket. Hidden over 60 s (the `HIDDEN_RECONNECT_MS` rule): transient states ease back to normal. Care never touches the server item or a trade.

## 5. Care actions
T = touch, M = mouse, K = keyboard (`K` opens Care, arrows pick, Enter arms, reticle moves, Space drops; every action also has tap-item-then-tap-squishy, and a "do it for me" assist).

| # | Action | Gesture | Soft-body response | Sound | State | Reward |
|---|---|---|---|---|---|---|
| 1 | Feed a treat | T/M drag item onto it; K as above | mouth dimple opens, fingertip presses it in, a LUMP travels mouth to core in 0.9 s, gulp hop, core warms | munch/nom, gulp, species yum | tried bit; Warm 150 s | 4 (+2 fav) |
| 2 | Give a drink | hold the cup over it 1-3 s | each drop rings the skin; Liquid Core sloshes harder per drop; foam soaks and sags; putty beads off and shakes; Fizzwink hiccups | slurp/glug/drip | tried bit; Quenched 120 s | 3 (+2) |
| 3 | Plug the leak | press and hold on the hole | thumb dent, seep stops, ticklish shiver | psst gates off, giggle | PLUGGED | (mend) |
| 4 | Patch it | drag sticker / putty blob / tape onto the hole | patch presses flat, wrinkles relax, sticky families strand | crinkle-pat | PATCHED, a nub appears | (mend) |
| 5 | Pump (air families) | dock on nub; tap 8 times or hold (auto) | 8 steps of swell, last `burstOpen`, sag to 0 | pump pitch rises, whoosh+boing | PLUMP | 8 once |
| 6 | Top up (liquid) | dropper, hold bulb, 7 drops | drops plip in, body lifts and sloshes | drip x7 | PLUMP | 8 once |
| 7 | Scoop beads (Bead) | sweep the loose beads in, pour | beads rattle in, body firms (jam) | rattle | PLUMP | 8 once |
| 8 | Soap up | rub the sponge back and forth (K: hold Space) | real low-pressure finger rub; surface-anchored foam rides the deformation; done at 70% coverage (6-10 s) | stick-slip squeak (pitch follows speed) | grubby 0 | 3 for the wash |
| 9 | Rinse and dry | hold the shower cup 1.6 s; towel 5 pats | suds pop top-down; glossy families wet-dog shake (`tremble`), absorbers need the towel | pour, shake | Fresh 240 s | in 8 |
| 10 | Brush and shine | 10 long strokes | bright band per stroke, one sparkle ramp | swish, chime | Shiny 300 s | 2 |
| 11 | Tuck in | drag the blanket / moon | lights ease to 0.6, curls (`setFold` 0.3), volume breathes at 0.2 Hz, yawn on waking | lullaby (music box), quiet snore | Rested 300 s | 3 |
| 12 | Cuddle | hold gently 1.2 s | leans into the finger, melts and springs back | purr | Snug 120 s | 2 (and pays as a squeeze) |
| 13 | Pat / Tickle | 3 taps / scribble | hops / `tremble` 0.5 | pat, giggle | none / playful 0 | 0 (taps are free) / 3 |
| 14 | Introduce a friend | bring a second squishy out | they bump-greet (existing `bump`) | species hellos | company 0 | 3 each, 1/pair/hour |
| 15 | Quick answer / Not now | tap the bubble / long-press it | right item flies in and does it / it fades | pip | that squishy rests 30 min | base only / none |

Nothing is wrong: a wrong item gives a smaller reaction, never a negative one; no fullness limit (a burp after 4 treats).

## 6. Foods and drinks (original; all screened with the project's own name rules)
**Treats:** Crumblet (crunchy biscuit), Plumdrop (glossy plum gum drop), Honeybead (amber syrup pearl that bursts in the core), Frostwhirl (cold cream swirl; a shiver), Sprinklet (sprinkles scatter as glitter inside), Toastcloud (warm fluff; puffs up foam). **Drinks:** Dewdrop (water), Fizzwink (bubbles and a hiccup), Hushmilk (soft; nudges sleepy), Sunsip (golden nectar). Run through the `probe_catalog.ts` rules against 1599 entries plus all 1023 species and Digimon/Neopets/Moshi: all ten clear (nearest: Crumblet~Crustle 3, Fizzwink~Litwick 4). NOT checked: the "read aloud" rule and other franchises' items/berries (the repo holds no list). A squishy's favourite is derived from `hash(seed)` weighted by family (not stored).

## 7. Families differ
Ringers (jelly, silicone, dome, gummy) hop and ring after a gulp; Absorbers (marshmallow, slow-rise, mochi) soak and need the towel, slow-rise wrings out when squeezed and rises over ~4 s after a refill; Plastics (putty, mochi, slime) keep a dent and come back lumpy until "worked in"; Sloshers (Liquid Core, Bead) react to every drop or rattle; Reachers (sticky, slime) stretch toward the treat with a virtual grab. Leak: air families hiss bubbles and take the pump, liquid families drip and take the dropper, Bead spills 6-10 beads for the scoop. Pop Dome: the bistable pop is NOT built (`materials.ts` `planned`), so no text may promise a pop or flip.

## 8. The leak, as a puzzle (never scary, never permanent)
A tiny fill-seam lets go a pinprick; it giggles when found. **Find** (a dark ring that rides the skin; wrinkles; eyes glance at it at 6 s; a faint static ring at 12 s; a gentle camera beckon at 20 s except in Calm; the `psst` is quiet and pulsed, silent after 12 s unless the pointer is within 1.5 R, then a hot-and-cold locator, also the blind path) -> **Plug** with a thumb -> **Patch** (6 stickers, putty blob, 4 tapes; leaves a nub) -> **Fill** (pump 8 strokes / dropper 7 / scoop). Median 28 s, target p90 under 45 s. Floor: never below 0.70 of rest height, ignored forever it just stays droopy; never saved; over-pumping clicks "full"; nothing bursts. The patch stays as a keepsake (Settings: Keep patches). Deflation: `L(t) = Lmax(1 - exp(-t/25 s))`, `setAir(1-0.16L)`, `setSag(0.14L)`; Buddy+ may hide the hole on the side; Forever friend is shown it at once.
**Measured (patched COPY of the physics, one species per family, template and soft genome):** at air 0.84 / sag 0.14 height was 0.65-0.85 of rest, creases at most 76 deg while deflating (limit 120), 110 deg at worst for a poke while deflated (the same 110-111 without deflation for sticky stretch). Honest gaps: Liquid Core 0.68 and soft putty 0.65 are UNDER the 0.70 floor (hence Lmax 0.8, unverified); at air 0.78 / sag 0.20 Liquid Core falls to 0.57 (too much); after the refill kick Liquid Core and putty did not settle within 3% in 6 s (not investigated). The lump, mouth dimple and curl: surface moved 0.09-0.60 R (gummy 0.60 is the largest), creases at most 56 deg, volume 1.000.

## 9. Loops, simulation, state vs physics, cost
- **30 s:** one gentle daily treat wish at ~18 s (first session of the day), answer it in ~6 s, a hop and hearts. **5 min:** 1.7 wishes on average, one answered mend or wash if the player wants. **Daily:** answer a wish or two; bond ticks up to 24 points a day at most; nothing is owed.
- **Sim (60 days, assumed notice/answer rates):** a 40 s visit meets exactly 1 wish (18 s); 12 min meets 3.8; worst-case any 60 s: 1, any 300 s: 3, any hour: 8. A player who never answers is asked 3 times in 10 min (then gaps of 6 and 12 min) and loses nothing. Leaks: 0.275 per 12-min session. Bond tiers (Pal/Buddy/Best/Forever, day reached): micro 1 x 40 s 4/16/33/-, casual 5/13/33/58, regular 1/4/8/18, devoted 0/2/5/9. Farm bound: an instant-answer bot 16.2 BP a day, a spam bot 24.4, the most any squishy gained in any 24 h was 47. Bond buys only cosmetics.
- **Physics-driven:** the swallow lump, dimple, droop and boing, slosh, soak, shake, finger rub, curl. **UI/state-driven:** wants, bubbles, shelves, bond, captions, assists. **Physics asks (3 hooks, ~120 lines, prototyped on a copy only):** `setSag`, `setAir`, `setBulge` (two slots). Render: props, suds, patch SDFs, wet sheen, wrinkles, scene exposure.
- **Cost (estimate, not built):** ~2500-3500 lines at 25-30 minified bytes a line (measured on `cut.ts` 25.8, `interact.ts` 25.2, `toyTray.ts` 31.5 B/line) = about 65-95 KB raw, 28-40 KB gzip. Against the old 1229 KB gate it does NOT fit beside the UI overhaul (~86 KB headroom, UI ~90 KB): the owner must raise it OR accept the `later-care` lazy chunk (0 bytes first-play) under the new G0b if that rule is approved.

## 10. Open questions for the owner
1. Which size gate stands? 2. Keep care at 0 squish points (recommended) or let a mend pay like a squeeze? 3. Default Keep patches on? 4. Should the Care button show a badge dot for an open wish (recommended) or stay plain?

Appendix files (scratch, not in the game): `pets/care/pet.ts`, `sim_care.ts`, `sim_output.txt`, `probe_sag.ts`, `probe_bulge.ts`, `make_proto.mjs`, `sag_0.84_0.14.txt`, `bulge_0.22.txt`.
