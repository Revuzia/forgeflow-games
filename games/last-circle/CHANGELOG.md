# Last Circle — CHANGELOG

Source of truth for this game's history and design decisions.
Design research: `forgeflow-games/state/research_battle_royale.json` (Fortnite building/storm, Final Drop browser formula, PUBG ballistics/loot, Apex shields/feedback).

## 2026-07-21 — The jump animation never played, and the crouch freeze was undone (?v=86, LIVE)

Two animation defects from the full-game sweep, both verified against the actual
shipped GLB rather than taken on trust.

- **THE JUMP CLIP SHOWED ONLY ITS STANDING LEAD-IN.** Decoding
  soldier_jump.glb directly: Meshy's "Basic_Jump" runs 5.93s and the Hips
  translation sits flat at baseline Y 94.7 until t=1.73s, peaking at 253.0 at
  t=2.07s. The game's airtime is 2*jumpV/|gravity| = 2*7.8/22 = 0.709s and the
  clip was played from t=0 — so ONE HUNDRED PERCENT of every visible jump was
  the clip standing still, and the character never appeared to leave the ground.
  playAnim gained a `startAt` seek and jump now begins at t=1.70.
- **THE ?v=51 CROUCH FREEZE WAS BEING UNDONE ONE CALL LATER.** playAnim's
  falsy-zero fix was real, but the vendored kernel's play() then did
  `setEffectiveTimeScale(opts.timeScale || 1)` — the same bug one layer down —
  which only bites when the clip CHANGES, i.e. exactly when you crouch from
  standing. So a stationary crouching player still marched in place. FIXED AT
  THE GENERATOR as well (pipeline/engine/runtime/3d/ffg_kernel_3d.js); 14 games
  vendor a copy of this kernel.

That is the third falsy-zero timeScale of this session (player.js ?v=51,
hud.js ?v=73, kernel here) — same pattern, three layers.

Verified live: crouching from standing leaves the crouch action at timeScale 0
(genuinely frozen); the jump action starts at t=1.70 of a 5.93s clip, so the
0.709s of airtime shows 1.70 -> 2.41 and covers the peak at 2.07.
Selftest 89/89. DRAFT.

## 2026-07-21 — Sound came from the wrong ear, and bullets hit in silence (?v=85, LIVE)

Two audio defects from the full-game sweep.

- **POSITIONAL AUDIO PANNED BACKWARDS.** audio.js derived the camera's right
  vector as `(fwd.z, -fwd.x)` — the exact NEGATION of the right vector the rest
  of the game uses (sim.moveBasis: fwd (-sin,-cos), right (cos,-sin), i.e.
  `(-fwd.z, fwd.x)`; player.js builds its shoulder offset from the sim's
  version). Every positional sound therefore played in the WRONG EAR at every
  heading — gunfire actively told you to look the wrong way, which in a battle
  royale is worse than no positional audio at all.
- Same three lines: the horizontal projection was not normalised, so looking up
  or down shrank fwd's xz length and silently flattened the pan toward centre.
- **BULLET IMPACTS WERE ENTIRELY SILENT.** weapons.js emits four impact surfaces
  (flesh / stone / wood / dirt) and only fx.js listened — for the visual. In a
  shooter the impact is how you learn you MISSED and what you hit instead; rounds
  cracking off a wall beside you are the texture of a firefight. Now voiced,
  short and quiet so full-auto does not become a wall of noise, with flesh left
  to the hitmarker that already owns "you hit them".

Verified live: replicating the shipped pan maths against the sim's canonical
right vector gives +0.8 for a source on your right at yaw 0 / 1.57 / 3.14 /
-1.05 / 2.40 and -0.8 on your left (the sweep measured -0.800 for a right-hand
source before this), and looking up or down no longer flattens it. The impact
listener count is now 1 where it was 0.

Honest limit: a synthetic browser tab cannot start an AudioContext without a
user gesture, so what is verified is registration and the pan MATHS, not audible
output. Selftest 89/89. DRAFT.

## 2026-07-21 — REGRESSION FIX: every match after the first was lit wrong (?v=83, LIVE)

Two lighting defects the full-game sweep caught. The first is mine, from ?v=58.

- **Stale sun target.** ?v=58 made the shadow volume follow the player and
  captured the sun's DIRECTION per match as
  `sun.position - sun.target.position`. But `sun.target` was never reset — it
  sat wherever followShadow parked it at the end of the previous match. The
  sweep replayed the shipped storm math over 3000 seeds and put the final circle
  a median 178 m from origin, which turned the intended ~50deg near-noon key into
  a median ~31deg raking light pointing in a random compass direction, and in
  5.8% of matches pushed the focus past the shadow camera's 400 m far plane so
  the match rendered with NO shadows at all. Correct only on the first match of
  a session. The target is now reset to origin before the direction is taken.
- **The menu never got its tone mapper back.** A match sets NoToneMapping for
  its bright-daylight look (maps.js) and the menu restored only the EXPOSURE, so
  from the second visit onward the cinematic menu rendered unlit. It now restores
  ACESFilmicToneMapping too.

Verified live across four consecutive matches, walking the player far from
origin each time so a stale target would show: sun elevation is 50.2deg every
match with a spread of 0.00deg, while the shadow target still tracks the player
to a different place each match (460,-340 / 520,-380 / 580,-420). Tone mapping
reads 0 (None) in a match and 4 (ACESFilmic) once back in the menu.
Selftest 89/89. DRAFT.

## 2026-07-21 — The two screens that END every match had unclickable buttons (?v=82, LIVE)

The full-game sweep's headline finding, and the worst thing it found.

- Pointer lock is requested on any canvas click (player.js:425) — i.e. the first
  time you shoot. It was released in exactly TWO places in the whole runtime:
  showMenu and togglePause (grep for exitPointerLock returned 2 hits). Neither
  showDeath NOR showPostMatch released it. While pointer lock is held every mouse
  event is delivered to the locked canvas, so the buttons on the death screen
  ("MATCH STATS") and the post-match screen ("PLAY AGAIN" / "MAIN MENU") could not
  be clicked at all. The player had to guess that Esc frees the mouse; nothing
  said so. Those are the two screens that terminate EVERY match.
- Now released by one helper on every overlay the player is expected to click:
  the death screen, the post-match screen, drop select (you choose your landing
  zone by clicking the map), the how-to card, settings, and the online lobby.

Verified live by instrumenting document.exitPointerLock and driving a REAL death
through hurtActor: the death screen releases it (with MATCH STATS present),
endMatch's post-match screen releases it (PLAY AGAIN + MAIN MENU present), and
drop select releases it (map canvas present).

Honest limit: a synthetic test cannot ACQUIRE pointer lock — the browser
requires a real user gesture — so what is verified here is that the release now
fires on those paths, plus the source fact that it previously did not fire at
all. Selftest 89/89. DRAFT.

## 2026-07-21 — E-swap silently destroyed a consumable stack (?v=81, LIVE)

Found by the full-game sweep. Straight data loss.

- The E-swap branch dropped the outgoing item only `if (old.kind === "weapon")`,
  but the overwrite on the very next line was unguarded. So pressing E on a floor
  gun while a CONSUMABLE stack was the active slot replaced the stack with the
  weapon and never spawned it — up to 15 bandages, 6 mini shields or 3 medkits
  gone, with no drop and no warning. The swap branch is reached exactly when you
  are full, which is the normal mid-match state.
- Now the outgoing item is dropped whatever it is, stack count intact.

Verified live: with 15 bandages active and a full inventory, E-swapping onto a
floor sniper puts the sniper in the slot AND leaves a 15-count bandage stack on
the ground (count preserved exactly); swapping while a weapon is active still
drops that weapon. Selftest 89/89. DRAFT.

## 2026-07-21 — REGRESSION FIX: the ?v=64 gun cap froze every bot's loadout (?v=80, LIVE)

Caught by the full-game sweep, and it was mine: a side effect of the carry cap
shipped this morning, not a pre-existing bug.

- ?v=64 moved the 3-gun cap into give() so it applied to bots as well as the
  human. But bots have NO swap path — grep for "swap" across the runtime returns
  only the human's E-swap call sites — so once a bot held three guns (the
  starter pistol from spawn plus the first two it touched) wouldAccept refused
  every weapon forever and pickLoot skipped them entirely. About a minute into
  every match, 49 of 50 arsenals were permanently frozen: chest rolls that are
  55% rare-or-better were wasted, and supply drops — the game's only legendary
  source and its one deliberate contested-POI event — were contested by nobody.
  The endgame got EASIER the longer a match ran, which is backwards.
- Bots may now trade UP at the cap: the worst gun is dropped for a clearly
  better one. The human is untouched — walking over a gun at the cap still
  refuses, and E-swap still swaps the ACTIVE slot.
- **A second bug found while verifying the first:** picking the "worst" gun by
  sustained DPS nominated a LEGENDARY SNIPER (35 rpm) over a common SMG, so a
  bot would have thrown away the best gun it will ever find for a common pistol.
  Worst is now rarity-first, and a trade may never go DOWN in rarity.

Verified live: a bot capped on three commons takes a legendary sniper and stays
at three; a bot holding a legendary sniper REFUSES a common pistol and keeps the
sniper; a same-rarity upgrade (AR over shotgun) still trades; the human is never
auto-traded by walkover and E-swap still works at the cap. Selftest 89/89.
DRAFT.

## 2026-07-21 — Emotes now reach the people you are playing with (?v=78, LIVE)

- Online play has no voice and no text chat, so the two emotes ARE the
  communication channel — and they were never relayed. A friend waving at you
  from a rooftop simply did not happen on your screen. The "emote" event was one
  of the handlers-with-no-listener found earlier today.
- Relayed both ways now, following the same shape as the existing gunfire relay:
  only locally-simulated actors broadcast, and peers replay through the SAME
  playback path the local emote uses, so a remote wave looks identical to yours
  rather than being a second, subtly different system.
- **A hazard caught during verification:** my first version stored
  `a.emoting = "cheer"` (a bare string) while the local path stores `{t: 4.2}`
  and stepActor does `a.emoting.t -= dt`. netRemote actors skip stepActor, so it
  tested clean — but this game deliberately hands a slot back to a BOT when a
  peer disconnects, and that bot WOULD run stepActor and throw on a string in
  strict mode. Now the same {t} shape, and the takeover case is asserted.

Verified live: emoting locally fires the event net.js relays; a peer's emote
plays on their actor with anim "cheer" and the matching {t} shape; and flipping
that peer to a bot mid-emote runs 10 frames of stepActor with NO throw, the
timer correctly ticking 2.40 -> 2.23. Selftest 89/89. DRAFT.

## 2026-07-21 — Sprint was free, so walking was pointless (?v=76, LIVE)

A DELIBERATE BALANCE CHANGE, not a bug fix — stating that plainly because it
changes how every fight and all 49 bots behave.

- The movement spread penalty was a flat 1.4x for any speed over 1 m/s. Walking
  and sprinting therefore cost EXACTLY the same accuracy, so sprint was free and
  plain walking was a strictly dominated state: there was never a reason to
  choose it. (Crouch, added in ?v=49, made that worse by giving a third option
  that beat walking outright.)
- The penalty is now graded by actual speed: still 1.00x, crouch-walk pace
  (~2.7 m/s) 1.20x, walk (6.0) 1.45x, sprint (9.6) 1.72x, capped at 1.8x. Walking
  is now the deliberate middle option it was always supposed to be, and closing
  ground at full sprint costs you the first exchange.
- The first-shot-accuracy test used an exact `movePen === 1` compare, which a
  continuous penalty would have broken silently; it is now a speed tolerance
  (< 0.6 m/s), so a slow creep keeps the bonus.
- Cheap to do safely only because ?v=73 had already collapsed fire() and the
  reticle onto ONE model — the crosshair picked this up for free and shows it.

Verified live: reticle scale still 1.18 / walk 1.55 / sprint 1.77, with
crouch-walk at 0.97; sim spread agrees at 2.175deg walking vs 2.58deg sprinting.
7 new selftest assertions pin the curve and its cap (89 passing, was 82).
DRAFT.

## 2026-07-21 — First-run onboarding (?v=75, LIVE)

- There was no onboarding of ANY kind. This is a browser BR: it gets opened cold
  from a link, with no install, no manual and nobody to ask. Several verbs were
  simply undiscoverable — the parachute redeploy, crouch, and both emotes (which
  appeared in no control surface at all until ?v=67).
- A first-run HOW TO PLAY card now opens once, listing the eleven things that are
  not guessable, and explains the two mechanics a new player will otherwise
  misread: that SHIFT is a toggle, and that the reticle grows when shots will
  scatter. Dismissal is remembered, and the card is reachable any time from the
  menu.
- Deliberately NOT a forced tutorial or a scripted first match — one screen and a
  button. A player who already knows battle royales loses two seconds.

Verified live: first run auto-opens with all 11 key rows and the SHIFT-toggle,
crouch and emote lines present; GOT IT dismisses it and stores the flag; a second
showMenu does NOT auto-open it; the menu button re-opens it on demand.
Selftest 82/82. DRAFT.

## 2026-07-21 — You were locked to your killer's camera (?v=74, LIVE)

- On death, spectating was pinned to whoever killed you and only ever moved on
  when THEY died. With friends in the room that is the worst possible default:
  you sit watching the stranger who shot you while your friend is still playing.
- A / D (or the arrow keys) now step through the survivors, and a readout shows
  who you are watching, how many are left, and the keys. The initial pin to the
  killer is kept — that first moment is worth seeing — it is just no longer a
  cage. Dummies are excluded, so the practice range never appears in the list.

Verified live after a real death (driven through hurtActor): spectating starts
on the killer, D steps s2 -> s3 -> s4, A steps back to s3, the camera focus
follows each change, every target is alive, and the bar reads
"SPECTATING HIGHGROUNDHERA · 49 ALIVE · [A] / [D] TO SWITCH". Selftest 82/82.
DRAFT.

## 2026-07-21 — The crosshair now tells the truth (?v=73, LIVE)

The item the earlier synthesis called "the highest-value one not in the twelve",
and it turned out to be quietly hiding work shipped earlier today.

- fire() computed spread inline; the crosshair guessed with a DIFFERENT, cruder
  formula that knew only `moving` and `ads`. So the reticle never showed:
  crouch (the 38% tighter cone sold in ?v=49 — byte-identical to standing on
  screen), airborne (a 2x penalty), rarity, first-shot accuracy (0.15x, the
  single biggest term), or even the weapon's own base spread — a shotgun (4.0deg)
  and a sniper (0.15deg) drew the SAME reticle. The player was never shown when
  they were accurate.
- Both now read one shared sim.effectiveSpread(). 16 new selftest assertions pin
  the exact behaviour fire() had before the extraction, term by term and in
  combination, so this stayed a refactor and not a balance change (82 passing,
  was 66).
- Rejected on purpose, per the original review: the ADS-settle half of that
  proposal. It is a sniper balance change wearing a HUD fix's clothes and it
  would retune 49 bots.
- **Found while verifying:** my first version wrote `p.lastShotT || -9`, which
  treats a legitimate lastShotT of 0 as missing — so every shot looked like a
  first shot. Same falsy-zero class as the playAnim timeScale bug fixed earlier
  today. The verification caught it because the first-shot reticle and the
  spraying reticle came back identical.

Verified live, reticle scale per state: AR first shot 0.47 vs spraying 1.18;
crouched first shot 0.43; airborne+moving 2.66 vs moving 1.50; shotgun 2.55 vs
sniper first shot 0.40. Selftest 82/82. DRAFT.

## 2026-07-21 — Reload progress + kill attribution names the weapon (?v=71, LIVE)

- **Reload had no progress UI at all** — just the word "RELOADING…" in the ammo
  readout — while healing and chest-opening both show a filling bar. A 4-second
  shotgun reload with no sense of how far along you are is the difference
  between pushing and dying. Added a bar under the crosshair.
- **Kill attribution threw the weapon away.** The kill feed was handed a
  weaponId and built "killer ⚔ victim" without it, and the death screen printed
  the RAW INTERNAL ID — "by CoachCarter (glauncher)". The one place a player
  learns what killed them showed them a variable name. Display names now live in
  sim/royale.js next to the weapon table (WEAPON_NAMES + weaponName()), so the
  feed, the death screen and anything added later share one source.

Verified live: sim maps the six ids plus "storm" to Pistol / SMG / Assault Rifle
/ Shotgun / Sniper / Grenade Launcher / the Storm; the feed row reads
"You ⚔ CoachCarter · Grenade Launcher"; the reload bar is hidden before, fills
0% -> 50% -> 90% across a 4 s shotgun reload, and hides again on ready; and a
real death (driven through hurtActor, not a synthetic event) reads
"#50 of 50 · by CoachCarter (Sniper)". Selftest 66/66. DRAFT.

## 2026-07-21 — Swimming ignored every collider (?v=70, LIVE)

- The swim branch integrated straight into position — `a.pos.x += a.vel.x * dt`
  with no collision test at all, while the ground branch right below it does an
  axis-separated blockedHoriz check. So you swam THROUGH the shipwreck hull and
  through piers, and solid geometry simply did not exist in water.
- Now uses the same axis-separated test. The probe height is raised 0.45 m,
  which widens blockedHoriz's built-in step allowance for a swimmer: a low deck
  near the waterline stays something you can haul out onto, while a hull stops
  you dead. (blockedHoriz already ignores colliders whose top is within STEP_UP,
  so this is a nudge to that existing rule, not a new mechanism.)

Verified live against the real shipwreck hull on isla_viva (15.1 x 18.2 x 3.2 m,
minX 462.44): starting 5 m outside and swimming into it travels 4.55 m and stops
at x 461.99 — 0.45 m short, exactly the player capsule radius — and never enters
the box. Control in the opposite direction covers 9.54 m freely, so swimming
itself is untouched. Selftest 66/66. DRAFT.

## 2026-07-21 — Loot proximity queries were an unindexed full scan (?v=69, LIVE)

- nearby() walked EVERY item and EVERY chest, hypot'ing each one, on every call.
  Bots call it once per frame while looting (bots.js actLoot) on top of a 90 m
  planning query per think, and early in a match dozens of bots are looting at
  once. Now a spatial hash over loot (24 m cells), the same technique maps.js
  already uses for colliders, so a query only touches the cells inside its
  radius. Distance compares are squared, with one sqrt per surviving candidate.
- Items are indexed on spawn (including runtime drops via dropItem) and the grid
  clears with the rest of the loot state between matches.

Verified live: a query centred exactly on each indexed item finds it (0 misses),
and cell-boundary offsets in five directions all still find it (0 misses) —
those are the two tests that are NOT circular. Sorted nearest-first order is
preserved, which callers rely on. Measured cost after the change: 2.4 µs for the
per-frame r=2.4 query and 14.9 µs for the r=90 planning query.

Honest limits of this measurement: I did not keep a before-number for the old
full scan, so no speedup FACTOR is claimed here — the argument is structural
(cells within the radius instead of every entry) plus the absolute costs above.
Two earlier verification attempts also produced false "mismatch" counts because
the reference set was built from nearby() itself at y=0, and nearby() applies a
|dy| < 4 filter — so the reference silently excluded everything not near sea
level. Selftest 66/66. DRAFT.

## 2026-07-21 — SHIFT toggles sprint on and off (?v=68, LIVE)

Owner direction: "Make SHIFT click activate sprint/run, on and off."

- ?v=67 added a HOLD/TOGGLE option but defaulted to HOLD. TOGGLE is now the
  DEFAULT: one press starts running, another stops it, and you never hold the
  key down. HOLD is still available in Settings for anyone who prefers it.
- The latch clears when you stop moving forward, so you cannot wander back into
  a fight still sprinting from three minutes ago with no way to notice, and it
  is cleared with the rest of the input state between matches.

Verified live through the real frame path (input rebuild + world step): walking
covers 5.32 m in one second, one SHIFT press with the key RELEASED covers
8.51 m with input.sprint true, a second press returns it to 5.32 m, and
releasing forward clears the latch.

(Note for future testing: the input struct is rebuilt inside the KERNEL's
updater list, so calling player.update() directly does not exercise the
keyboard path at all — the first two attempts at this verification measured
walking three times and then measured a stale latch left on by the attempt
before. Drive kernel._updaters and zero the latch first.)

## 2026-07-21 — Accessibility + control settings (?v=67, LIVE)

Four UX findings from the gap scan, all of them table stakes for the genre.

- **Field of view had no control at all** — hardcoded 57 (70 sprinting). An FOV
  slider is both standard and a motion-sickness accommodation. Now 50-85, and
  the sprint kick rides on top of whatever you pick.
- **Sprint and ADS were hold-only.** Holding a key or a mouse button for a whole
  match is an accessibility problem, not a preference. Both now offer
  HOLD / TOGGLE. Latches clear with the rest of the input state between matches,
  and HOLD mode ignores a stale latch entirely.
- **Emotes were invisible.** The game ships two (dance on B, cheer on N) and
  they appeared in no control surface and could not be rebound. They are now
  first-class entries in the keybind list, so they route through the same
  remap/conflict/reset machinery as everything else.
- **Rarity was communicated by HUE ALONE**, which is exactly the thing a
  red-green colourblind player cannot read — a legendary and a common differed
  only by the colour of a 3px strip. Weapon slots now carry the tier as a
  numeral (I-V) as well. The pickup line added in ?v=66 already names the tier
  in words, so rarity is now legible three ways.

Verified live: camera FOV follows the slider (57 -> 57, 80 -> 80); a Shift press
latches sprint on and a second press off, while HOLD mode ignores a set latch;
settings lists Field of view, Sprint, Aim down sights and both Emote rows (bound
to B and N); slot chips render I / III / V for rarities 0 / 2 / 4 and consumables
get no numeral. Selftest 66/66. DRAFT.

## 2026-07-21 — Supply drops you can find, loot you can read (?v=66, LIVE)

More lower-ranked gap-scan findings, plus a systematic sweep that found the real
scope of one of them.

- **Supply drops were invisible.** They are the ONLY source of legendary loot,
  and the entire presentation was one flashed line at spawn: no map marker, no
  world beacon, no landed cue. Now tracked and drawn on the minimap and the big
  map — a pulsing gold ring while it falls, a filled diamond once it is down —
  with an announcement on the way in and a flash when it lands.
- **Pickups never said what you picked up.** A blip played and that was all, so
  a legendary was indistinguishable from a common without opening the inventory.
  Now named: "PICKED UP LEGENDARY SNIPER", "PICKED UP BIG SHIELD x2",
  "PICKED UP HEAVY AMMO".
- **Three feedback events were emitted into the void.** A diff of every
  emit("x") against every listener showed hardLand, propBreak and
  supplyDropLanded had no handler anywhere — a heavy landing, a barrel bursting
  and the legendary crate touching down were all silent. All three now have
  positional audio.
  (First pass of that diff reported 22 dead events; that was a bad regex —
  audio.js registers through a bare `on("x")` helper with no dot, so nearly
  every listener in the file was missed. Corrected count was 6, of which these
  three were real gaps; the other three are covered elsewhere or duplicate an
  existing cue.)

Verified live: audio registers exactly one listener for each of the three; the
supply marker tracks spawn -> landed and paints 16 gold pixels on the minimap;
inbound and landed flashes both fire; all three pickup kinds name themselves
correctly. Selftest 66/66. DRAFT.

## 2026-07-21 — Requeue without the round-trip + a career you can see (?v=65, LIVE)

First two of the lower-ranked gap-scan findings.

- **No PLAY AGAIN.** The post-match screen offered only MAIN MENU, so playing a
  second match meant tearing the world down, rebuilding the cinematic 3D menu
  world, re-reading the skin GLBs, and pressing PLAY — a long wait between two
  matches of a browser BR, at exactly the moment the player most wants another
  go. PLAY AGAIN now requeues straight into a fresh random map in the same mode
  (and tears down any net session first, so it cannot inherit a dead room).
- **The career was invisible outside one screen.** Level, XP and the lifetime
  record were computed and stored but only ever rendered on the post-match
  panel, so on returning the next day the menu showed no evidence the player had
  ever played. The menu now carries a compact strip: level, XP bar with the
  exact threshold, lifetime matches/wins/kills/best placement, and the next skin
  unlock with its level.

NOT attempted, deliberately: the unlock track still dead-ends at level 10. There
are only five skin GLBs, so any further reward needs new cosmetic assets — a
Meshy spend and an owner decision about adding characters — and inventing a
hollow reward would be worse than the dead end. The cheapest real option, if
wanted, is level-gated colour variants of the existing five, reusing the
per-actor hue/lightness tinting loadActorModels already applies to bots.

Verified live: menu reads LVL 4, "900 / 2900 XP", "12 matches · 2 wins · 31
kills · best #1", "NEXT: BULWARK @ LVL 6"; the post-match screen offers PLAY
AGAIN and MAIN MENU, and PLAY AGAIN lands in phase "lobby" without passing
through the menu. Selftest 66/66. DRAFT.

## 2026-07-21 — Bots hoarded five guns and twitched beside loot (?v=64, LIVE)

Closes the half of build-order #11 that ?v=62 deliberately left open.

- **The 3-gun carry cap was HUMAN-ONLY.** It lived inside the `a = W.player`
  walkover branch — its own comment explains why it exists ("hoarding 5 guns
  left NO room for shield potions, which read as 'shields don't work'") — while
  give() itself had no cap at all. So a well-looted bot filled all five slots
  with guns and could never pick up a shield or a heal again for the rest of the
  match. The cap now lives in give(), so it applies to every actor. An explicit
  E-swap still works at the cap: it REPLACES the active weapon, so it can never
  raise the count.
- **pickLoot re-selected exactly what give() had just refused.** It scored loot
  by type and distance with no idea whether the item could be taken, so a
  fully-kitted bot walked to a gun, was refused, re-planned, and walked to the
  same gun again — twitching in the open next to loot it could not hold. Both
  now consult one shared predicate (W.wouldAcceptItem) that mirrors give()'s
  rules, so the planner and the taker can never disagree.

Verified live: a bot offered five guns accepts exactly three, and a shield then
FITS (slots read ar / smg / shotgun / mini_shield x2 / empty) — the actual point
of the cap. The predicate agrees with give() on refuse-gun, accept-swap and
accept-ammo. The human is still capped at three and an E-swap at the cap leaves
the count at three. And a capped bot stood directly on a floor AR targeted it 0
times across 12 thinks. Selftest 66/66. DRAFT.

## 2026-07-21 — Online session was never torn down (?v=63, LIVE)

Build-order #12 — the last of the ranked twelve.

- **W.net and the session object were cleared in exactly ONE place: the lobby
  CANCEL button.** Finish an online match, return to the menu, and the session
  stayed live — so every subsequent OFFLINE match kept broadcasting 12 Hz player
  state and 10 Hz bot snapshots into a dead room, replaying phantom events
  against deterministic s0..s49 slot ids that collide by construction.
- Worse for solo players, and a direct consequence of this morning's online-pause
  fix: togglePause reads `!!W.net`, so with a stale session ESC stopped pausing
  OFFLINE matches for the rest of the page session. Reproduced, then fixed.
- Teardown is on the MAIN MENU click rather than inside endMatch, so a future
  REMATCH can still reuse the room.
- **Lobby player count was edge-triggered on a boolean.** ffg_netplay emitted
  "peer" only when `ids.length >= 2` CHANGED, so a room going 2 -> 3 -> 4 never
  re-fired and the lobby sat on its first reading — the host started blind. The
  payload already carried `count`; nobody was ever told about it. Now emits on
  count change too (and on someone leaving), without spamming duplicate syncs.

Verified live: with a stale session ESC leaves paused=false (the symptom),
net.leave() nulls W.net, and offline pause then works again. The real presence
handler — captured out of ffg_netplay.js through a stubbed transport — emits
counts [1,2,3,4,3] across a filling-then-draining room and 0 duplicates on
repeated syncs at the same count. Selftest 66/66. DRAFT.

## 2026-07-20 — Bots stood in the open pulling a dead trigger (?v=62, LIVE)

Build-order #11, first half.

- **ensureGunOut's scoring body was dead code.** Its guard read
  `if (a.weapon && !a.weapon.id.startsWith("consumable")) return;` — and every
  actor is CREATED holding a pistol, so it returned immediately for every bot in
  every match. A bot locked onto the first gun it ever touched, never upgraded,
  and once mag AND reserve hit zero it aimed correctly and pulled a dead trigger
  forever while a loaded pistol sat in slot 0.
- **It was also called from the wrong place** — only actLoot and actEngage — so
  a bot rotating across the map with a dry gun did not re-evaluate until it
  happened to engage someone, which is exactly the moment it needed to already
  be holding a loaded gun. Now runs once per think() for every state (and off
  the per-frame act path entirely).
- **Scoring gained pellets and ammo.** Raw `damage` is PER PELLET, so a
  legendary shotgun scored below the starter pistol; and a dry gun now scores 0
  so it can never win. Verified: a bot holding a pistol upgrades to a loaded
  legendary shotgun.
- **Guarded against thrash:** it never re-equips the slot already held, and only
  acts on a real reason (consumable out, gun dry, or >15% better available).
  equipSlot rebuilds the weapon object, so an unguarded call every think would
  cancel reloads and re-clone the weapon mesh.

Verified live: a bot holding a dry AR swaps to its loaded pistol; a bot holding
a pistol upgrades to a legendary shotgun; 30 thinks while already holding the
best gun produce 0 equip calls, and 20 thinks with EVERY slot dry also produce 0.

STILL OPEN from this build-order item (not attempted here): bots have no 3-gun
carry cap (the human's is inside an `if (a === W.player)` block in loot.js), so a
well-looted bot fills all five slots with guns and can never pick up shields or
heals; and pickLoot re-selects an item give() just refused, producing a twitch
loop. Both are loot.js changes and are tracked in GAP_SCAN.md. DRAFT.

## 2026-07-20 — The kill you just made was the one beat you never saw (?v=60, LIVE)

Build-order #9.

- **announce() had no priority at all.** It was last-write-wins over one shared
  node and one timer, and R._annUntil was assigned once and never read — the
  comment above it claiming "higher-priority calls override" was simply untrue.
  Because match.eliminate() drops the alive count BEFORE the actorDied emit, and
  weapons.update runs before hud.update in the same frame, the "ELIMINATED X"
  banner for the kill that took the lobby to 10/5/2 was overwritten by
  "10 REMAIN" before the browser ever painted it. Zero paints, every time.
- Now prioritised (victory 3 > elimination/level-up 2 > milestone/deploy 1) and
  equal-or-lower calls QUEUE rather than drop — the alive milestone marks itself
  spent in R._aliveMark BEFORE announcing, so a dropped "FINAL 2" was gone for
  the rest of the match. Queue is capped so a kill spree cannot back up forever.
- **The winning kill's banner was destroyed in the frame it was born:** endMatch
  went straight to showPostMatch, which calls hideHUD() and removes the layer the
  announcement lives in. The match cut from a firefight to a DOM panel. Now the
  live world holds ~2.6s on "VICTORY ROYALE" first (phase "over" is already
  whitelisted in the frame gate and already blocks damage), and any key or click
  skips straight to the stats.

Verified live. Ordering: DEPLOY -> kill emitted -> "ELIMINATED WKEYWARRIOR"
survives the same-frame milestone -> at t+2.2s the queued "10 REMAIN" plays.
Victory beat on a clean page: at t+0 and t+1.2s the banner reads VICTORY ROYALE
with the stats grid still absent; by t+3.2s the stats are up. Selftest 66/66.
DRAFT.

## 2026-07-20 — Hit feedback doubled and collapsed (?v=59, LIVE)

Build-order #10. Three defects in the feedback for a single shot.

- **TWO live hitMarker listeners** were registered on the same event (audio.js
  had a sine 1000/1300 ping AND a square 950/1400 one), so every hit played a
  detuned flam — and a 9-pellet shotgun blast fired 18 phase-coherent
  oscillators into a destination with no limiter, which audibly clipped. Removed
  the unguarded duplicate; the surviving one has the null guard and the wider
  headshot pitch split.
- **Per-pellet damage numbers stacked on one pixel.** fx.js spawned a number per
  actorHurt, so a 90-damage blast printed nine coincident "10"s instead of one
  readable "90". Now coalesced per victim per frame — summed, headshot ORed,
  colour precedence head > shield > body — and flushed in update(). The buffer
  is capped because fastForward skips fx.update entirely.
- **A headshot inside a blast was invisible.** The HUD marker was last-write-wins,
  so a body pellet landing after a head pellet reset it to plain white 26px.
  Headshot styling now holds for its duration.

Verified live with a point-blank 9-pellet blast: exactly ONE damage number
reading "90" (matching the 90 dealt), a single registered hitMarker listener,
and a head-then-body pellet sequence leaving the marker yellow at 34px. DRAFT.

## 2026-07-20 — Shadows existed on ~1% of the map (?v=58, LIVE)

Build-order #8.

- The kernel builds the sun with `const d = 80`, so the shadow camera covered a
  160 m box — and NOTHING in the entire runtime ever touched `sun.target`
  (grep: zero references), so that box sat over world origin (0,0,0) for the
  whole match. The maps are 1600 m. Roughly 1% of the playable area had shadows;
  everywhere the player actually fights, characters and buildings rendered as
  flat cutouts — while the 2048/4096 depth pass ran every frame regardless.
- The volume now FOLLOWS the camera focus, keeping the sun's direction (captured
  per match as an offset, because buildMap re-aims the sun for each map's
  daylight). Centre is snapped to whole shadow-texel steps or the world shimmers
  as you walk.
- Extents tightened to 55 m (70 m on high) and set in W.applyGraphics, which
  already owns tier fidelity, rather than in the vendored kernel literal — so
  medium now resolves better than high did before. Added shadow bias
  (-0.0004) and normalBias (0.02); neither was set anywhere.
- No kernel edit was needed: the game's orchestrator adds sun.target to the
  scene and drives it. Last Circle's kernel copy already diverges from the
  pipeline template and 14 games vendor their own, so this keeps the blast
  radius at zero.

Verified live: with the player parked at (600,600) — 848 m from origin, where
there was previously no shadow at all — the character casts a contact shadow on
the sand; moving to (-320,140) the volume tracks within 2 m, the sun direction
is unchanged (0.53, 0.77, 0.35), the centre lands on exact 0.054 m texel steps,
and a palm shadows the grass. DRAFT.

## 2026-07-20 — Challenge XP you could never earn + keybinds that ate each other (?v=57, LIVE)

Build-order #5 and #6.

- **CHALLENGES WERE EVALUATED STRICTLY IN ORDER.** The update polled only
  chs[W._chalIdx] and advanced that pointer solely when the CURRENT challenge
  completed — and pickChallenges always puts CHAL_POOL[0] ("Survive 3 minutes")
  in slot 0. So a player who died at 2:30 with four kills and 600 damage earned
  ZERO challenge XP: the elimination and damage cards were never even polled.
  That withheld 465-625 XP from exactly the player whose match awards ~100-355.
  All three are now evaluated independently; the card still shows one at a time.
- Gated on being ALIVE, which the same change makes newly necessary: dying does
  not end the match and W.t keeps running, so a parallel pass would let a corpse
  in the spectator seat bank "Survive 3 minutes" and "Reach the final 10"
  without playing — the same exploit class already closed for practice mode.
- **REBINDING A KEY NEVER RELEASED THE OLD DEFAULT.** canon() maps physical ->
  canonical and falls through to identity, so after rebinding Map to Q, BOTH Q
  and M opened the map — forever, persisted to lc_settings. The action's default
  key now gets an explicit __unbound sentinel.
- **AND IT SILENTLY KILLED WHATEVER OWNED THE NEW KEY.** Rebinding Move Forward
  onto D left strafe-right unreachable while the settings row still displayed
  "D". Conflicts are now refused with "already: <action>" instead of stealing.
  Unbound actions display "—", and there is a RESET TO DEFAULTS button — until
  now only devtools could undo a bad rebind.

Verified live: at t=150 with 2 kills the elim challenge awards while survive
does not; after dying, t=400 still does not award survive. Rebinding Map to Q
yields {KeyM:"__unbound", KeyQ:"KeyM"} so Q opens the map and M does nothing;
rebinding Forward onto Q is refused with "already: Map" and leaves the remap
untouched; RESET clears it. Selftest 66/66. DRAFT.

## 2026-07-20 — Match teardown leaked ~55 animation mixers PER MATCH (?v=56, LIVE)

Build-order #7. Frame time degraded monotonically the longer you played, with
no in-game recovery — only a page reload.

- The whole teardown was `group.clear()` + `actors.length = 0` + resetBrains().
  Clearing a group detaches meshes but the kernel keeps every AnimationMixer in
  its per-frame update list until an explicit disposeMixer — which nothing
  called. 50 skeletons per match accumulated and kept being ticked forever.
- Teardown now disposes each actor's mixer and its nametag CanvasTexture BEFORE
  the roster is dropped (dispose first, or the references are already gone).
- weapons.reset() returns live rounds to the pool — the projectile list is
  module-level, so rounds fired in one match kept flying in the next with their
  meshes parented to a cleared group. fx.reset() clears floating damage numbers,
  which are DOM nodes and otherwise hang over the menu.
- **A SECOND leak the scan did not catch, found only by measuring:** after
  fixing the roster the count STILL climbed by exactly 5 a match. Five is the
  skin count — preloadMeshySkin builds a throwaway clone per skin purely to warm
  the gltf cache, and kernel.loadCharacter registers that clone's mixer too (its
  own comment says so). Those are never actors, so the roster teardown could not
  see them. Now disposed at the end of the preload.

Verified live across five back-to-back matches: kernel mixer count is 51 every
time (50 rigged actors + 1 baseline), growth 0. Before the second fix the same
measurement read 61 -> 66 -> 71 -> 76. Selftest 66/66. DRAFT.

## 2026-07-20 — Weapon swap fired a hybrid weapon (?v=54, LIVE)

Build-order #4. Two bugs in one code path.

- **Hybrid weapon.** stepWeapon cached `const wpn = a.weapon` BEFORE applying
  inp.slot, so after a swap every read for the rest of that frame — def, cd,
  magAmmo, state — came from the OUTGOING weapon object, while fire() stamps
  `a.weapon.id` and `.rarity` (the INCOMING weapon) onto the projectile.
  Swapping shotgun -> sniper on a live trigger therefore spawned def.pellets = 9
  projectiles each resolving as 105 sniper damage against 200 EHP, and the
  outgoing object's ammo decrement was written to an orphan. The slot switch now
  happens first, and a runtime invariant asserts def describes the weapon whose
  id will be stamped.
- **Swap cancelled the fire-rate timer.** equipSlot handed back a weapon with
  cd: 0, so tap-2-tap-1 double-pumped the shotgun past its 0.857 s cycle. Each
  slot now remembers its own remaining cooldown AND the incoming weapon inherits
  whatever the outgoing one still owed — a timer cannot be dodged by swapping.

Verified live: a plain shotgun shot deals 106 and sets cd 0.857; swapping
shotgun->sniper on the fire edge now deals exactly 105 (one sniper round, not a
9-pellet sniper burst); and fire -> tap 2 -> tap 1 carries the cooldown
0.857 -> 0.84 -> 0.84 with 0 extra damage from the second pump. Selftest 66/66.
DRAFT.

## 2026-07-20 — COVER NOW STOPS BULLETS (?v=53, LIVE)

Build-order #1 from the gap scan, and the biggest gameplay defect in the game:
positioning, peeking and holding a building — the load-bearing BR mechanic —
did not actually exist.

- **The bug:** testSegment only asked whether a sub-step's END POINT landed
  inside a box. Sub-steps run up to 2.5 m (an AR at 300 m/s covers 5 m per frame
  at 60 fps), so a 0.32 m wall — the real thickness on these maps — was only
  caught when the endpoint happened to land inside it, roughly 13% of the time.
  Ramps were worse: `if (c.kind !== "box") continue` skipped every ramp
  collider, so tower interior ramps stopped 0% of shots.
- **The fix:** a proper swept segment-vs-AABB (slab) test, plus a sloped test
  for ramps, both living in sim/royale.js so they are pure and node-testable.
  Impact FX and grenade bounces now use the ENTRY point and the ENTRY FACE
  normal; the old bounce derived its normal from the overshot endpoint.
- Colliders are queried along the WHOLE sub-step, not just around its endpoint —
  otherwise a wall crossed mid-step was never even a candidate.
- **Bot line-of-sight shared the identical flaw** (maps.js losBlocked
  point-sampled every ~3 m and skipped ramps), so bots shot through cover too.
  It now uses the same sweep, chunked into 24 m spans: the collider grid is
  16 m, so sweeping a 200 m sightline in one query would pull ~169 cells and
  slab-test everything in them for every bot against every candidate target.
  Measured after chunking: 0.024 ms per LOS call.
- 15 new selftest assertions (66 total, was 51): the 2.5 m step across a 0.32 m
  wall, entry-face normal, shots over/short/past, segments starting inside,
  ramp surface clamping, ramp hit/clear, nearest-wins, and dead colliders.

Verified live on a real 7 x 3.4 x 0.32 m map wall with shooter and target 10 m
apart across it: firing a full AR burst through the wall deals **0 damage** and
leaves 9 impacts on the wall face, while the same burst at the same range on
open ground deals **100 and kills**. DRAFT.

## 2026-07-20 — Two real defects from the adversarial gap scan (?v=52, LIVE)

A 131-agent scan (8 dimensions, every finding then run past a "prove it already
exists" refuter and a "is it worth building" judge) raised 61 findings; 6 were
refuted as already shipped. These are the first two fixes, both verified against
the source before touching anything.

- **M OPENED THE MAP *AND* MUTED THE GAME — PERMANENTLY.** Two window keydown
  listeners both owned KeyM: game_controls.js toggleMute and player.js
  toggleBigMap. Close the map with ESC and the game stayed muted, across
  reloads, for the whole portal origin. Confirmed live: the test browser was
  still muted from an earlier press. FIXED AT THE GENERATOR: the mute hotkey now
  honours CFG.mute_hotkey (mirroring the fs_hotkey pattern that was already
  there) in pipeline/engine/runtime/game_controls.js and
  pipeline/templates/shared/game_controls.js as well as this game's copy — that
  file ships in 35 games. Last Circle sets mute_hotkey:false because M is its
  map key. The corner mute button is untouched.
- **PARACHUTE A/D STEERING WAS MIRRORED.** The glide derived its strafe axis
  inline as (cos, +sin) while ground movement uses (cos, -sin). The two axes
  were therefore not perpendicular — their dot product is -sin(2*yaw) — so
  holding D under the canopy pulled partly backwards at every non-cardinal
  heading, and sweeping the mouse rotated the drift at double rate. This is the
  opening 30 seconds of every match. Both call sites now consume one shared
  sim.moveBasis(yaw).
- The suite passed 46/46 with that bug live, so the basis is now asserted
  directly in the node selftest (perpendicularity and unit length at 32 headings,
  plus right = forward rotated -90 degrees). 51 passed, 0 failed.

Verified live: holding D at yaw 0 / 0.7 / 2.1 / -1.3 gives right 5.82 and
forward 0.00 at every heading (previously forward went to -3.75 off-axis);
pressing M leaves the mute state unchanged. DRAFT.

## 2026-07-20 — Crouch, finished: authored clip + honest hit capsule (?v=51, LIVE)

Completes the crouch shipped at ?v=49, which deliberately left the hit capsule
at full height because the model could not visibly crouch.

- **Meshy crouch clip.** There is no endpoint to enumerate the action library
  (/openapi/v1/animations/actions parses "actions" as a task id and 400s), so
  candidates came from the published Animation Library Reference: 524
  Cautious_Crouch_Walk_Forward, 523 (backward), 527 Crouch_Walk_Left_with_Gun,
  54 Squat_Stance. Baked all four on soldier and measured them.
  - 54 DISQUALIFIED: head sweeps 1.60 -> 1.27 -> 0.72 over 4.8s. It is a
    squat-down-and-up motion, not a stance you can hold.
  - 527 is a LEFT strafe; 523 is backward. 524 is the forward crouch walk and won.
  Rolled out to all five skins as <skin>_crouch.glb (49 Meshy credits total).
- **heightMult is measured, not guessed: 0.86.** 524 puts the head bone at 1.34m
  (max 1.36 across the cycle) vs 1.62 standing, and the standing capsule sits
  0.18m above the head bone -> 1.36+0.18 = 1.54m -> 0.86. The original 0.62 guess
  would have been a lie: this is a cautious crouch walk, not a deep squat.
- **The capsule only shrinks for an actor that actually HAS the clip**
  (a.hasCrouchClip). If a skin's clip ever fails to bake it still stands upright,
  and shrinking its capsule would reintroduce exactly the shoot-through problem
  this work existed to avoid.
- One clip covers both stances: crouch-walk paced by ground speed, and standing
  still freezes it on a crouched pose instead of marching in place.
- **DEFECT found while wiring it:** playAnim did `(opts && opts.timeScale) || 1`,
  so an explicit timeScale of 0 (falsy) silently became full speed — "freeze this
  clip" did the opposite. Now null-checked.

Verified live: clip resolves on all five skins; capsule 1.80 standing / 1.548
crouched / 1.80 when crouching without the clip; anim = "crouch" moving and
still, timeScale 0.97 moving and 0 still; and a side-by-side capture through the
real input path shows the model visibly folded with its feet on the ground.
Selftest 46/46. DRAFT.

## 2026-07-20 — Crouch (?v=49, LIVE)

grep for crouch|slide|mantle|vault|prone across runtime/ returned nothing (the
only "climb" was a portal-ascent comment, the only "Vaulted" a bot name). The
game had no crouch at all.

- Crouch is a stance with a real trade: 45% movement speed for a 38% tighter
  hipfire cone and a lower camera. Ground-only, and sprinting always wins so you
  stand up to run.
- Bound to C, NOT Ctrl — this is a browser game sitting next to WASD, and
  Ctrl+W closes the tab. Rebindable like any other action (added to ACTIONS).
- Camera dip is eased, not snapped; sim exports actorEyeY()/actorHeight() so
  stance is computed in one place for camera, muzzle origin and hit capsule.

WHAT IS NOT IN THIS CHANGE, and why: the crouch does NOT shrink your hit
capsule. It was built that way first (0.62x profile), which requires the model
to visibly come down. These Meshy rigs have no crouch clip, so a procedural
leg-fold was written and then REJECTED on the evidence: offscreen captures of
standing-vs-crouched showed the character kneeling in mid-air, and a second
attempt with automatic foot re-planting still would not read as a crouch —
there is no IK here to keep the feet planted. Shipping a 1.12m capsule under a
model that plainly still stands would mean shots at a visible head passing
through it, which is worse than having no crouch profile. heightMult is pinned
at 1 with the reasoning recorded in sim/royale.js; it goes to ~0.62 in the same
change that lands an authored crouch clip from the Meshy animation library (the
route the run animation already took).

Verified live by driving real movement frames: 5.32m walking vs 2.39m crouched
in one second (ratio 0.449 against a 0.45 spec), sprint-while-holding-crouch
travels 8.51m with crouching=false, eye height 1.62 -> 0.97, capsule 1.80 in
both stances. Selftest 46/46. DRAFT.

## 2026-07-20 — Death recap (?v=45, LIVE)

The death screen said "#37 of 50 · by CraftyKat (sniper)" and stopped there,
which answers none of the questions you actually have when you die.

- Recap block: FINAL BLOW (range in metres, HEADSHOT when it was one),
  YOU DEALT (damage you did to the person who killed you), THEY HAD LEFT
  (their remaining HP/shield), plus a "SO CLOSE." line when you had them at
  25 HP or less. That last number is the whole point of a death screen.
- W.match.damage only holds per-ATTACKER totals, so "you had them down to 12"
  was not answerable from existing state. hurtActor now also records per-PAIR
  damage (victim.dmgFrom[attackerId]) and the last hit's detail (range,
  headshot, attacker HP/shield at the moment of the blow).

Verified live with a staged fight: foe placed 47m out and chunked to 12 HP,
then killing the player with a headshot produced exactly "47m · HEADSHOT",
"88 damage", "12 HP", and the SO CLOSE line. Selftest 46/46. DRAFT.

## 2026-07-20 — Performance readout (?v=44, LIVE)

A browser game runs on unknown hardware and an unknown network, and the player
had no way to tell a bad connection from a bad GPU from a bad game.

- Opt-in FPS readout (Settings -> Performance readout), colour-coded: green >=50,
  amber 30-49, red <30. Averaged over ~0.5s so it reads as a number, not a strobe.
- Online it also shows SYNC — the age of the freshest state packet from any peer,
  published by net.js as W._netStats.lastSeenAgeMs. Deliberately NOT called
  "ping": net.js records lastSeen timestamps, not round-trip time, so labelling
  it ping would be a lie.
- Defaults to off; persists with the rest of settings.

Verified live by driving hud.update at fixed frame deltas: 60/40/24/12 fps all
read back exactly, colours cross at the right thresholds, SYNC segment appears
only when a net session and stats exist, and the toggle hides the element.
Selftest 46/46. DRAFT.

## 2026-07-20 — Levels now pay out: skin unlocks (?v=43, LIVE)

Levelling granted nothing. The bar filled, the number went up, and the game
handed back no reward — so the whole progression loop (which the previous batch
had just given career stats and a level-up banner) still terminated in nothing.

- MENU_SKINS gained unlockLevel: SGT. BRICK / DASH free, NIGHTFALL at 3,
  BULWARK at 6, STINGER at 10.
- The locker still lets you browse locked skins — seeing what level 10 buys is
  the point — but shows "🔒 LOCKED · REACHES LEVEL n", tints the dot amber, and
  does not equip or persist them.
- player.js reads lc_skin straight from localStorage, so rather than teach it
  about unlocks (and import hud), showMenu sanitises the stored value: a locked
  skin left over from cleared progress is rewritten to the first unlocked one.
- The level-up banner now names the reward — "SKIN UNLOCKED · NIGHTFALL" — or
  points at the next one ("NEXT UNLOCK · BULWARK AT LEVEL 6"). Extracted as the
  pure levelUpSub(lvl) so it is testable without a built world.

Verified live: at level 1 exactly SGT. BRICK + DASH read OPEN and the other
three LOCKED; at level 10 all five OPEN; a seeded lc_skin of "viper" at level 1
was rewritten to "soldier" on boot; levelUpSub returns the right line for levels
1–11. Selftest 46/46. DRAFT.

## 2026-07-20 — PRACTICE RANGE (it was advertised but never existed) (?v=41, LIVE)

The practice lobby promised "RANGE TARGETS SOUTH, MOVEMENT COURSE EAST". Grep
for either string across the whole runtime returned exactly one hit: the
advertisement itself. Practice mode was an empty map with a full loadout.

- **Range built:** five dummies at 12/22/35/55/80m, laid out due south of
  wherever practice drops you and sat on the terrain. They take damage through
  the real pipeline (W.hurtActor), so hitmarkers, damage numbers and headshot
  detection all work — then they reset instead of dying, because a range you can
  permanently delete in six seconds is not a range.
- Dummies are deliberately NOT registered with W.match: they cannot touch
  alive-count, placement, or the victory check (verified: aliveCount stays 1 and
  match.over stays false after 470 damage across all five).
- **Live range readout:** SHOTS · HITS · ACC · HEADSHOTS · DMG · DOWNS.
- **XP/career exploit closed (found while building this):** XP was awarded from
  damage regardless of mode, and the new career record folded in every match.
  With a no-death dummy range that makes levelling a matter of standing still
  and holding the trigger. Practice now earns no XP, completes no challenges and
  banks no career stats, and the post-match screen says so.
- Lobby line now describes what actually exists (no movement course is claimed).

Verified live: 5 dummies rigged and in-scene at the right distances/bearing;
alive after 120 damage with hp reset and pops counted; hurt events still fire per
hit; XP frozen at level 3/120 and career frozen at 7 matches after farming 2400
damage; readout renders "SHOTS 15 · HITS 12 · ACC 80% · HEADSHOTS 3 · DMG 470 ·
DOWNS 2". Selftest 46/46. DRAFT.

## 2026-07-20 — DROP SELECT + match re-entrancy guard (?v=39, LIVE)

The biggest remaining structural gap vs Final Drop and the genre generally: the
opening decision did not exist for the player.

- **DROP SELECT (new):** every bot picks a named POI to land at (bots.assignDrops),
  while the human was dropped "high over a random point" (player.js spawnAll) —
  simultaneously the worst loot odds on the field and the removal of the choice
  every battle royale opens with. New landing-zone map between lobby and drop:
  click any zone (clicks snap to a POI), lock in with DROP, 12s auto-lock so
  online clients advance together. If you never pick, you get the QUIETEST named
  zone instead of a random dump.
- **Contested-zone heat:** the rings are coloured off the bots' ACTUAL declared
  drop targets (assignDrops runs before the lobby), not a guess — QUIET / LIGHT /
  CONTESTED / HOT with the inbound count drawn inside each ring. Verified on
  isla_viva: Banana Farm 10, Jungle Market 9, Volcano Rim 6, Palm Bay 2.
- Chosen LZ is marked on the minimap while you fall (drawMinimap, drop phase only).
- **DEFECT — startMatch re-entrancy:** it clears the world (actors, brains) and
  THEN awaits the map build and model load. A second call landing inside those
  awaits interleaves with the first, and the match ends up with two full rosters.
  Reproduced: two concurrent calls gave 98 actors in a 50-player match. Reachable
  from a fast double-click on PLAY / PLAY AGAIN. Now guarded — verified two
  concurrent calls yield 50 actors on the first call's map.
- Drop-map labels: names moved onto backing pills and counts moved inside the
  rings after a capture showed four labels colliding at the south of the island.

Verified live: player lands at exactly the chosen POI coords with the glide
intact (playerXZ === poiXZ, alt 269, gliding true), 49/49 bots declare targets,
screen opens and closes, phase advances to drop. Sim selftest 46/46. DRAFT.

## 2026-07-20 — BR parity: career stats, match moments + 2 real defects (?v=36, LIVE)

From a code-verified gap analysis vs Final Drop (fetched its shipped 1309-asset
manifest + script bundle) and BR genre conventions. This batch = retention + game
feel + defects. NOTE: building/harvesting stays OUT (owner decision) even though
Final Drop ships it.

- **CAREER STATS (new):** showPostMatch computed kills/damage/accuracy/placement every
  match and threw them away — only {level,xp} persisted. Added a lifetime `career`
  record (matches, wins, kills, damage, bestPlacement, top10s, timeAliveS) folded in
  at match end and surfaced on the post-match screen.
- **LEVEL-UP now exists (DEFECT):** `W.events.emit("levelUp")` fired on every level and
  had ZERO listeners — the bar filled, the level ticked over, and the player was never
  told. Added a "LEVEL n" banner + a post-match LEVEL UP line.
- **MATCH MOMENTS (new):** a big centre-screen announcement layer — "DEPLOY · N PLAYERS"
  at match start, alive-count milestones (25/10/5 remain, FINAL 2), and per-kill
  "ELIMINATED <name>" with streak escalation (DOUBLE/TRIPLE/QUAD KILL, RAMPAGE). The
  match had a flat counter and no rising arc.
- **ONLINE PAUSE EJECT (DEFECT):** ESC set W.paused, which early-returns the whole frame
  pipeline INCLUDING netMod.update — the 12Hz state broadcast stopped and the host's
  silent-guest watchdog swapped you for a bot after 12s. Opening the menu ejected you
  from a match with friends. Online now shows a non-blocking overlay and never freezes
  the sim; offline behaviour unchanged.
- **Docs hazard:** sim/royale.js's header still claimed it owned "the building grid…
  and harvesting". Rewrote it with an explicit NO BUILDING / NO HARVESTING —
  do-not-reintroduce note so a future parity pass can't read it as a spec.

Verified live: career keys present, DEPLOY / LEVEL 7 / ELIMINATED+DOUBLE KILL banners
all render, online pause leaves paused=false with the online note, offline pause still
pauses. Sim selftest 46/46.

## 2026-07-20 — BRIGHT lighting + street furniture + landmarks (?v=32, LIVE)

Visual polish, now that offscreen-render-target capture unlocked real pixel review
(a background browser tab blacks out the default framebuffer, but rendering to a
WebGLRenderTarget + readPixels bypasses the throttle — captures POSTed to a local
cap_server for viewing).

- **LIGHTING (biggest win):** the scene rendered as a muddy dusk — ACES Filmic
  tonemapping was crushing + desaturating everything. Switched matches to
  NoToneMapping with rebalanced lights (sun 2.05 warm, hemisphere 1.25 with a
  lighter ground colour, exposure 1.0) + reduced in-match bloom to 0.14. Result:
  bright vibrant daylight — green grass, tan sand, red roofs read clearly, like the
  reference. Verified by capture on isla + deepwood.
- **Street furniture:** lamp posts, market stalls, benches, hydrants along town
  streets (cosmetic). Towns now read as lived-in settlements.
- **Hero landmarks:** isla lighthouse, ashgrid water tower, deepwood chapel steeple.

## 2026-07-20 — proper UPRIGHT run animation (?v=29, LIVE) — Meshy regen

The gated D10 item, now done (owner authorized the Meshy spend). The shipped run was
Meshy action **16 "RunFast"** which leaned ~55° ("running bent over"), band-aided by a
per-frame spine counter-rotation. Replaced with a proper upright run and the hack deleted.

Pipeline: `pipeline/meshy_lc_run.py` (adapts meshy_rig_anims_v2.py). The 5 rig_task_ids
were gone (expired), so re-rigged from the shipped base GLBs.
- **Bake-off** on soldier: re-rig (5cr) + 5 candidate run actions [14,15,510,534,538]
  (15cr), each measured for torso lean (Hips→Neck world tilt) + foot motion. Pixel-free
  ruler validated first: old RunFast = 54.7° avg, walk = 5.5°.
- Winner: **action 510 "Standard_Forward_Charge"** — 11.7° lean, strongest stride,
  clean retarget onto the shipped base (so a run-clip-only swap works, no full re-rig).
- **Rollout** (32cr): re-rig the other 4 skins + animate 510 + swap all 5 `<skin>_run.glb`.
  Verified shipped: soldier 11.7° / athlete 5.7° / wraith 3.0° / juggernaut 2.9° /
  viper 11.4° avg lean (all upright, foot motion 0.59–0.80 = clean legs).
- Removed the `_runLean` spine counter-rotation block + flags in player.js (at ~3-12°
  it would over-straighten and tip the model backward).
Meshy spend: 20 (bake-off) + 32 (rollout) = 52 credits; balance 5195 → 5143.

## 2026-07-20 — Final Drop parity build (?v=18 → 28, LIVE)

Multi-session /loop closing the gap to the Final Drop reference the owner benchmarks
against. Item-by-item tracker: `PARITY_PROGRESS.md`. Each item was gate-verified (ESM
syntax + sim selftest 46/46) and live-verified on the CDN by driving the frame
pipeline via `k._updaters` and inspecting scene/DOM/state (a hidden/background browser
tab throttles WebGL to black, so pixel screenshots weren't possible — visual QA of the
actual look is pending the owner opening the live URL).

- **Textures (Pass A):** procedural CanvasTexture PBR (grain albedo + Sobel normal maps)
  on terrain (world-planar UV, over the vertex-colour biome tint), all structures
  (brick/panel), and water (ripple). Unified graphics authority `W.applyGraphics` —
  applied at BOOT, drives DPR + shadow-map res + anisotropy per tier and syncs the
  shell `ffg_settings.quality` key, so "High" finally takes effect on load (was inert).
- **World density (Pass B):** road network (nearest-neighbour tree over POIs → textured
  asphalt ribbons) + town-builder (houses on streets, front doors to the road, terracotta
  roofs, parking lots) on isla + deepwood + a new ashgrid savanna outpost; farmland
  (crop rows + barn + silo + fence) for the Farm POIs (isla Banana Farm relocated inland
  off the waterline); distinct biome zones — a deepwood northern SNOW biome + an ashgrid
  eastern DESERT; traversal fixes (interior tower ramp now emerges through a cut
  stairwell hole, overpass ramp reaches its deck, sky-island rim collider 0.86→0.92·rad).
- **Meta + MP (Pass C):** XP/level bar + rotating in-match challenge cards (persistent
  `lc_progress`, match-end XP); both MP MUST desyncs fixed (host-bot chest-opens mirror
  to guests; grenade/barrel splash routes through net authority); barrel-anchored muzzle
  flash; spectator HUD follows `W._camFocus` not the corpse.
- **Polish (Pass D):** menu golden-hour light no longer leaks into matches; headshot
  hitmarker + ping; compass ribbon; umbrella glide (canopy deploys at 110m + gentle auto
  forward-glide); bot coverReflex on sim-time (fastForward determinism); supply-drop
  cadence spread late; remote gunfire FX relay (guests see/hear remote shots); full
  keybind rebind list; +1 selftest (quick tier-mix).
- **Gated / deferred:** D10 real upright RUN clip needs a Meshy regen ($ spend, awaits
  owner OK) — a code-only "measured lean" was tried and reverted (Meshy spine
  `rotation.x` is bind-pose-dominated so an absolute-lean measure reads noise; kept the
  working relative fixed-delta nudge). B5 ramp terracing + B4 street-furniture props are
  optional feel refinements.

## 2026-07-12 — v4.12 destructible world: barrel collision + explosive barrels + shootable trees (?v=18, LIVE)

Owner playtest (vs Final Drop reference): "walked through a barrel — these should be
explosive; shooting trees should damage them; explosives should damage the things
around them." Root cause: `propColliderKinds` (maps.js) listed palm/tree/pine/birch/
rocks/car/container but NOT barrel → barrels had zero collision. Built a destructible-
props system:

- **maps.js:** added `barrel` to `propColliderKinds` (collision restored); each prop
  collider now carries its instance `idx` + `hp` (`propHP`: barrel 1, tree 46, pine 58,
  palm 42, birch 40; rocks/car/container = indestructible cover). New `W.map.destroyProp(col)`
  shrinks the InstancedMesh instance to nothing + marks the collider dead; `queryColliders`
  now skips dead colliders so shots + players pass through the gap.
- **weapons.js:** a direct bullet hit on a destructible prop chips its hp — barrels
  DETONATE on any hit (full splash + knockback), trees drop once hp is gone. `explode()`
  now also levels nearby trees and CHAIN-detonates nearby barrels (depth-capped at 3 to
  bound recursion) — explosions damage the environment, not just actors.

VERIFIED LIVE (ashgrid, 40 barrels/80 trees): destroyProp flips dead false→true and the
collider leaves queryColliders; shooting a barrel point-blank → 2 pistol shots → barrel
destroyed + player HP 100→55 (45 blast dmg). Mouse confirmed 1:1 (HUD reticle `mousePx`
and shot ray `mouseNDC` derive from the same mousemove; point-blank shot landed dead-center).
Sim selftest 45/45.

**Still staged (owner's Final Drop-parity list):** real towns per biome (houses/roads/
cars — currently only trees+sky-islands, "gets boring"); tower/ramp redesign (ramps too
vertical for BR — match Final Drop terracing) — folds in the un-climbable-ramp + platforms-
in-water/steep items from task #40; grenades as a throwable; distinct RUN animation (sprint
exists at 9.6 m/s but plays the walk clip sped up — Meshy run clip leans ~30°, needs
investigation before regen per owner's no-guess rule); scorch/crater decals + tree-fall FX.

## 2026-07-12 — v4.11 gap-review fixes: semi-auto, sniper, grenade, sky, poses, savanna structures (?v=17, LIVE)

Acted on the multi-agent gap review (all 6 subsystem audits completed this session).
Fixes shipped + verified (sim selftest 45/45):

- **Semi-auto fire (weapons.js + player.js):** held LMB used to auto-cycle the
  pistol/sniper/shotgun/launcher (the every-frame input rebuild overwrote the
  single-shot guard). Now auto weapons (SMG/AR) fire while HELD; semi weapons fire
  once per CLICK, gated on a mousedown edge `W._fireEdge` (set on click, cleared on
  release/consume). VERIFIED LIVE frame-by-frame: held pistol → mag 16→15 (ONE shot)
  then flat while held; held SMG → 14 shots. 
- **Sniper (royale.js):** removed `gravity:true` (speed 500→700) — it was the only
  bullet that dropped, so a center hold missed at its own 200-400m band; now hitscan-
  straight like the arsenal, aim = impact.
- **Grenade launcher (weapons.js):** was exploding on walls/crates but bouncing on
  terrain; now bounces off box faces too (detonates on the 2s fuse) — consistent bank-shots.
- **Held-SPACE (player.js):** edge-gated (`!e.repeat`) — key auto-repeat was strobing
  the chute (deploy/cut/deploy) and multi-firing swim strokes.
- **Sky (maps.js):** clouds raised 130-230m→320-460m (no longer pass THROUGH them as
  flat cards during the drop); bird flocks 75-130m→120-180m (clear of islands); sky
  dome now recenters on the camera each frame (no parallax, no far-plane clip at map edges).
- **Per-match updater leak (maps.js):** cloud/bird/water `onUpdate` closures were never
  removed on rebuild → ran forever over detached sprites. Now tracked + spliced out of the
  kernel loop each `buildMap` (self-contained, no shared-kernel change).
- **Poses (pose.js + player.js):** added a `lowReady` carry (gun lowered out of combat,
  snaps to gunReady on ADS/fire — verified live on deepwood); restore the weapon if an actor
  is killed mid-emote (was leaving corpses empty-handed); weighted the spine aim-bend.
- **Savanna structures (maps.js):** warmed the old grey concrete palette (C_CONC/CONC2/
  METAL) to sandstone/adobe so the buildings read as a weathered savanna outpost, not grey
  city blocks. Texture sweep of all 3 maps: every object properly coloured/complete.

**Gap review — remaining OPEN items (filed, not yet fixed):** Movement: interior tower
ramps dead-end into the upper-floor slab (un-climbable, maps.js tower()); overpass ramp
under-shoots the deck; sky-island collider is 0.86× the visible grass (rim fall-through).
UI: two uncoordinated graphics-settings systems (kernel ffg_settings.quality vs LC
lc_settings.graphics) — LC tier never applies at boot; orphaned keybind capture; ESC over
open Settings un-pauses under the modal; spectate shows the corpse's HUD. MP-only: host-bot
chest-opens not mirrored to guests (net.js:36 `a===W.player` → `!a.netRemote`); grenade
splash + remote gunfire fx bypass the net-authority path. Menu bloom/exposure still leaks
into matches (judgement call — established look). Cosmetic: muzzle flash spawns at the eye
not the barrel.

## 2026-07-12 — v4.10 Savanna recolor (grey→colour) + aim-pitch un-invert (?v=16, LIVE)

Owner playtest: dropped into the old `ashgrid` map and reported "you've removed
all colours from the game." Investigated live + in code — NO global desaturation
(isla_viva/deepwood stay fully colourful, verified live). The grey was `ashgrid`
itself: `colorAt` returned `[g,g,g]` pure grey (asphalt) under a grey sky
`#aab6c4` — grey BY DESIGN, predating v4.9. The v4.9 fog thinning just made the
whole grey expanse visible (denser fog used to hide it in haze). A lifeless grey
map is still bad, so:

- **`ashgrid` → "Savanna" (maps.js:19, 104-110, 623):** warm golden-hour sky
  `#e7cf98`, and `colorAt` now returns golden savanna grass with green/ochre
  variation (`fbm`-driven patches) instead of `[g,g,g]`; sandy washes low, warm
  sun-baked bluffs high; island grass tops `#a7ad55`; themeColor warmed to
  `#e0854a`. Fits the acacia trees already on the map. Verified live ground-level
  + drop-in: warm, colourful, alive (was flat grey). mapId key stays `ashgrid`.
- **Aim-pitch UN-INVERTED (player.js:794):** the armed pose layer was called with
  `-a.pitch`, but `input.pitch > 0` = looking UP (verified: mouse-up → +pitch; a
  live mouse-look test read +0.106 on up-look; `aimDir`/camera both use
  `sin(pitch)`), and `tiltDir(+)` raises the muzzle — so the gun/torso tilted the
  WRONG way (down when you looked up) for every armed player. Now passes `a.pitch`
  un-negated. Verified live: look up → pistol raises & points up; look down →
  pistol lowers to the hip.
- Sim selftest 45/45.

**Gap review (multi-agent, this session) — OPEN items, not yet fixed:** HIGH:
semi-auto fire is defeated — the every-frame input rebuild (player.js input
updater) overwrites weapons.js's `inp.fire=false`, so pistol/sniper/shotgun/
launcher auto-repeat while LMB is held (needs a mousedown-EDGE gate). MEDIUM:
sniper round has gravity while all other bullets are hitscan-fast → drops below
the reticle at 200-300m (drop `gravity:true` or add holdover); grenade detonates
on boxes but bounces on terrain (box branch checks `splash` before `bounce`);
menu render-state (bloom + exposure 1.12 + warm sun 1.85) leaks into matches
because buildMap never restores it (architectural — the established look, changing
it is a judgement call); per-match `kernel.onUpdate` closures (cloud/bird/water)
never removed → leak that compounds each match; cloud sprites read as flat cards
at 130-230m (raise altitude + fade near camera); sky dome (r=1312) clips the 2000
far-plane at map corners + parallaxes (recenter on camera). LOW: no low-ready
pose (gun always at chest); emote-holster not restored if killed mid-emote;
muzzle flash originates at the eye not the barrel. Movement/UI-HUD/Bots audits
did not finish (session limit) — re-run needed.

## 2026-07-12 — v4.9 real sky + proper freefall/canopy + click-to-play menu (?v=15, LIVE)

Owner round: "do the falling boneless, realsky and clouds and birds, run to
check mouse look, and fix the menu." All done, verified in live play (pump +
rAF-shim + canvas→JPEG upload pipeline), then deployed to the CDN (?v=15) and
re-verified on the live workers.dev URL.

- **REAL SKY (`maps.js`):** added a gradient sky dome (ShaderMaterial, horizon→
  zenith), 24 drifting cloud groups (soft radial-gradient billboard sprites,
  3–5 puffs each), and 3 looping bird flocks (V-silhouette sprites) — all
  map-agnostic off each map's `sky` colour. Verified from altitude: fluffy
  clouds + V-birds render against the dome (shots `skydive_gamecam`,
  `birds_close`). **Fog thinned** (isla_viva 0.0011→0.0006, ashgrid
  0.0013→0.0007, deepwood 0.0016→0.0009) so the ground no longer washes white
  when you look down while dropping — the dome now covers the far distance, the
  fog is just light atmospheric haze (storm keeps its own heavier weather).
- **PROPER FREEFALL + CANOPY (`pose.js`):** the skydive/hang arm+leg targets
  were single straight lines (no elbow/knee bend) → the "boneless spread-eagle"
  and "arms rammed straight up" the owner flagged. Rebuilt both with real joint
  articulation: skydive = box/arch (upper arms out at shoulder level, forearms
  bent ~90° so hands come up-and-forward; thighs splayed back, knees bent so the
  shins kick up) — verified live (bones: head down-forward, hips up, feet kicked
  up-and-back, hands forward-spread; shot `skydive_fixed`). Canopy hang = upper
  arms reach up-and-out to the risers, forearms angle back up to the toggles
  (bent elbows, not straight up), legs dangle with a slight knee bend — verified
  live under an open chute (shot `hang_frozen`). No Meshy regen — pure runtime
  pose layer.
- **MENU click-to-play (`hud.js`):** removed the separate "▶ DROP IN" button;
  each of the 3 glass mode cards (BATTLE ROYALE / QUICK MATCH / PRACTICE) is now
  the play button — one click launches that mode, with a ▶ chevron affordance
  and a "CHOOSE A MODE TO DEPLOY" hint. Already glassmorphic (backdrop-filter
  blur 18px, saturate 1.35, rounded, blue glow). Verified on the LIVE deploy:
  3 cards, each `onclick` launches, no DROP IN button, glass confirmed.
- **MOUSE-LOOK verified LIVE:** the existing model is correct — any mousedown
  requests pointer lock, then `mousemove`'s `movementX/Y` drive `input.yaw/pitch`
  (cursor-follow aim is the lock-denied fallback). Proven in a live match via
  the RMB-drag path (same yaw code): movementX=140 drove yaw 0.000→−0.246→−0.493,
  movementY drove pitch 0→0.106, and the camera world-dir rotated (−0.057,−0.998)
  → (0.418,−0.904). (Real pointer-lock *engagement* still needs a focused real
  browser — the headless preview tab is `hidden`.)
- Sim selftest 45/45. `HAND_AIM_ROT` gun calibration and the 5-skin roster
  (drifter cut) unchanged.
- **Test-harness note:** reviving a dead actor (`hp:0`) in the verify harness
  leaves `a.obj` detached from the scene (death path `victim.obj.parent.remove`,
  player.js:893) → the body renders nowhere. It is a *test artifact only*
  (normal freefall never kills you); re-add with `k.scene.add(a.obj)` to inspect.

## 2026-07-09 — v4.8 per-skin weapon calibration (level barrel on all 5)

wraith + juggernaut aimed ~35° high with the shared grip rotation (their
Meshy hand-bone rest differs). Auto-calibrated each rig LIVE (measure barrel
world dir → rotate to forward+level) and baked the five per-skin hand
rotations into `HAND_AIM_ROT`. Verified in live play: dot 1.0, muzzle level on
soldier/athlete/wraith/juggernaut/viper (montage in scratchpad).

**Verification-pipeline lesson (never crash the preview again):** driving the
game with a setTimeout pump + rAF shim (needed because the headless tab is
hidden) leaks a WebGL context on every `startMatch`; ~15 restarts wedged the
renderer. Rules: (1) RELOAD the page between skin tests, don't loop
`startMatch`; (2) `clearInterval(window.__pump)` + restore `requestAnimationFrame`
BEFORE any navigate, or CDP navigation hangs 300s on the still-busy page;
(3) cap matches per page load.

## 2026-07-09 — v4.7 HOTFIX: revert per-frame gun aim (it broke the cast)

The v4.6 "skin-independent per-frame barrel aim" was the cause of the viper
body contortion AND the "gun points backward" — verified in LIVE play (see
below). Removed it entirely; the weapon uses the static per-skin grip rotation
set at load. Measured all 5 fighters after the revert: barrel points FORWARD
on every skin (dot 0.97–0.99 soldier/athlete/viper; 0.80 wraith/juggernaut,
which additionally tilt up ~35° — leveling tracked separately). Viper runs
upright, no contortion.

**Verification method fixed for good:** the headless preview tab runs *hidden*,
so `requestAnimationFrame` never fires → the game loop stalls → earlier
"verified" claims were reading frozen state. Live play is now driven via a
setTimeout pump + rAF shim, and frames are captured by copying the WebGL canvas
to a JPEG POSTed to a tiny local upload server (scratchpad/upload_server.py)
and read back as an image. ALWAYS verify through that pipeline, never a static
eval, never a frozen frame.

## 2026-07-09 — v4.6 BLACK-SCREEN fix, upright run, skin-independent gun aim

Owner round 8 (screenshots): matches loaded pitch black, characters ran bent
over with the gun pointing the wrong way. All three root-caused + verified in
real gameplay renders (not just measurements — a lesson below).

- **BLACK MATCHES FIXED**: the concurrent v4.4 menu overhaul's
  `teardownMenuWorld` slammed `scene.background`/fog to dark navy 0x0a1622 at
  **10× fog density (0.012)** as a "placeholder for maps.js" — but teardown
  runs AFTER buildMap, so dense dark fog swallowed every match. Removed the
  override; the map owns the sky (each map's daytime `sky`/`fog` now shows).
- **UPRIGHT RUN**: player locomotion no longer uses the Meshy RunFast clip
  (leans ~30° forward — the "running bent over" the owner kept flagging). All
  ground movement plays the UPRIGHT walk clip, sped up by ground speed to a
  jog/sprint. Movement speed unchanged (9.6 m/s); only posture is upright.
- **SKIN-INDEPENDENT GUN AIM**: the Meshy rigs do NOT share a hand-bone
  orientation — soldier's points forward, **juggernaut's points straight
  DOWN** — so no single hand rotation can aim every gun forward (soldier was
  fine, juggernaut fired backward). The weapon holder is now re-oriented EVERY
  FRAME so the barrel (+Z) points along the actor's aim vector, compensated
  through the (fresh) hand-bone world quaternion. Verified in-render for
  soldier/juggernaut/viper — all point forward. (Lesson: a separate-eval
  measurement read a stale matrix mid-animation and looked broken; the actual
  per-frame render was correct — always confirm with a screenshot.)
- Tracers already shortened in v4.5 (len 4, life .22 — a dash); the long gold
  columns in-scene are LOOT BEAMS (chest markers), not tracers. The pistol/AR
  molded on the soldier's vest is baked into the Meshy model (one skinned
  mesh), not a code-added weapon.

## 2026-07-09 — v4.5 weapon GRIP anchoring, first-person scope, Scrap cut

Owner round 7 (screenshots): guns weren't held IN the hand, Scrap's arms/run
looked broken, you saw your own body when sniping, tracers too long, wanted
mouse-look. Diagnosed each in real gameplay this time (not isolated poses).

- **WEAPON GRIP ANCHORING** (the "hold it in the hand" fix): guns were
  normalized then CENTERED, so the fist held the barrel's midpoint and the
  weapon floated across the chest. Now a data-driven grip anchor (centroid of
  the bottom-third vertex cluster = the handle, à la the Claudecraft "grip y"
  metadata) is placed AT the hand; long guns nudge +Z so the stock clears the
  arm. Verified: pistol / AR / sniper all sit in the fist, barrel forward.
- **SCRAP (drifter) CUT**: measured every rig's idle torso lean — Scrap's
  Meshy rig shipped a **27° baked-in forward slouch** (all 5 others sit at
  1-5°), so his every clip hunched and his arms read broken. Unfixable without
  regen (which risked the same slouch on a "street raider"); owner cut him.
  Roster is now soldier / athlete / wraith / juggernaut / viper (5).
- **FIRST-PERSON SCOPE**: aiming a scoped weapon (sniper) drops to first-person
  at the eye and HIDES your own body, so it no longer blocks the shot (owner:
  "when sniping im in the way of the cursor and can see myself"). Non-scope ADS
  (AR etc.) pulls tight over the right shoulder so the body sits left of a
  clear reticle. Body re-shows the instant ADS releases.
- **MOUSE-LOOK PRIMARY**: any click now grabs pointer lock → moving the mouse
  looks around; RMB is ADS only (was: must hold RMB to drag-look). Cursor-
  follow aim stays as the lock-denied fallback.
- **SHORTER TRACERS** (len 9→4, life 0.4→0.22 — a punchy dash, not a beam) and
  **quieter gunshots** (gains −35%).
- NOTE: this rides on top of the concurrent v4.4 menu overhaul (another
  session) — committed together per owner direction.

## 2026-07-08 — v4.4 AAA menu / UI polish (live Three.js cinematic)

Owner: "I expected this UI to be significantly more polished, more 3js, highly
professional and AAA standard." The menu was CSS gradient + SVG islands with a
tiny character canvas — mid-tier indie, not Fortnite/Apex lobby energy.

- **LIVE 3D MENU BACKDROP** on the main kernel WebGL canvas: procedural tropical
  island (vertex-colored terrain), ocean, purple storm ring (brand), floating
  sky islands, atmospheric dust points, god-ray planes, golden-hour sky shader
  dome, optional real prop GLBs (palm/tree/rocks/pine). Cinematic orbit camera
  + elev bob runs every frame while `phase==="menu"` (`updateMenuWorld`).
- **GLASS UI OVER THE WORLD**: translucent panels with backdrop-blur so the 3D
  scene reads through; Orbitron/Rajdhani type; animated title reveal; mode
  cards with icon tiles + hot selection chrome; glowing DROP IN CTA; top
  season chrome bar. Character bay gets metallic stage floor, blue emissive
  ring, rim/kick lights, ACES tonemap on the preview renderer, corner
  brackets, pulse dots.
- **Loading / lobby / post-match** restyled to the same glass + display-type
  system; shimmer load bar; lobby slot highlight for self.
- Bloom enabled on the menu path for storm-ring glow. Teardown clears menu3d
  group + restores fog when match starts.

## 2026-07-08 — v4.3 FIST SURGERY + full animation-state pass (AAA sweep)

Owner round 6: "hands look mangled… why can't closed be a fist?" + "check ALL
models, ALL animations, ALL bones." The definitive hand finding: a close-up
contact sheet (all 12 hands rendered tile-by-tile) proved **every one of the
six models shipped with OPEN modeled hands** — the "fists" prompt never truly
worked, gloves just hid it at distance. Meshy rigs have NO finger bones and
the rigging API can't add them, so hands can only be closed in the MESH.

- **FIST SURGERY (`tools/curl_fists.mjs`)**: closes hands in the bind
  geometry — verts past the knuckle line get a progressive curl around the
  knuckle axis PLUS quadratic compaction into a fist-center ball, with
  sphere-blended normals (pure rotation looked like mangled hooked fingers —
  owner called it). Finger axis = principal axis of the hand vert cloud via
  covariance power iteration (forearm→hand direction fails on rigs with
  bent-back bind wrists — the athlete's palms-up shrug). Meshy IBMs carry
  non-rigid armature scales → NEVER trust bone matrices for positions; use
  vertex clouds. Backups: *.openhands.bak beside each GLB (gitignored).
  Verified per-hand on a 6-tile close-up sheet (render ALL tiles in ONE
  frame with preserveDrawingBuffer — the buffer wipes between browser frames).
- **JUMP + SWIM clips** (Basic_Jump 86 / Swim_Forward 569, all six rigs,
  ~25cr): airborne actors used to play IDLE (no clip matched "jump");
  swimming was run@0.6. Both verified live (SPACE → jump clip; river → real
  freestyle stroke).
- **AIM PITCH** (AAA upper-body layer): gunReady/reload target dirs tilt with
  the camera's vertical aim + Spine01/Spine02 bend — the gun visibly tracks
  where you aim up/down (verified at steep up-aim).
- **BACKPEDAL** plays the stride in REVERSE (negative setEffectiveTimeScale)
  when moving against facing in combat — no more moonwalking (verified
  ts=-1.31 under ADS+S).
- Meshy balance after: 989cr. gen-scripts live in session scratchpad; the
  temp dir gets purged by the OS — `meshy_lc5.py` silently became 0 BYTES and
  "ran" successfully (empty file exits 0). Check file sizes before batches.

## 2026-07-08 — v4.2 particles were NEVER rendering, emote locker, leg posing, storm feel

Owner round 5. The headline find: **no particle had ever rendered in a match**
— fx.js adds its InstancedMesh to the "fx" scene group once at page init, and
startMatch `g.clear()`s every group before the first match begins. Muzzle
flashes, tracers, impact bursts, explosions: all silently orphaned since the
groups-clear was introduced. That was the real "when shooting i dont see
bullets". Fixed with a self-healing re-adopt in fx.update.

- **TRACERS you can see**: bolts now FLY with the round instead of a static
  140ms muzzle blink; cosmetic speed cap 200 m/s (hitscan 999 m/s crosses the
  screen in one frame — the eye never sees it; the damage ray is already
  resolved). Thicker (0.15), brighter gold, 0.4s life, bigger 3-color muzzle
  flash. Bots' fire uses the same global event → incoming fire reads too.
- **EMOTE LOCKER**: the menu turntable now plays cheer (greeting) → dance
  loop per skin instead of Meshy's arms-out idle ("show his character off").
  Clip files load on demand into the preview mixer; raw-idle + relax layer
  stays as fallback while a skin is still baking.
- **LEG POSING** for skydive (arched back-spread) and canopy hang (legs
  together, slight knee bend) — pose.js now steers UpLeg/Leg/Foot chains too;
  clip legs read wrong mid-air (frozen run stride).
- **STORM FEEL** (owner: "shrinks too much too quickly" + "damage should
  increase the longer you're in it"): standard table rebuilt — 8 phases,
  ~13.5 min, gentler early cuts (~58-64% radius kept vs ~46%); per-actor
  RAMPING storm damage +50% per 6s soaked (cap 3×), decays when back inside
  — verified live: ticks 1,1,1,1,1,1.5×6,2. Final phase still dps 12
  (selftest pins it).
- **RELOAD SFX**: mechanical sequence timed to the weapon's reloadS — mag
  release click → mag drop → seat clunk → slide rack (was two beeps).

## 2026-07-08 — v4.1 runtime arm-pose layer, ramp render fix, per-weapon ADS

Owner round 4 with screenshots: the Meshy ARMED clips retarget broken on these
rigs (Alert folded both arms across the face — "broken bone animation"), menu
idle stood arms-out, the tower ramp rendered backwards ("im in the wall"), and
ADS needed per-weapon zoom. No model regeneration needed — the rigs are fine;
the ARMS are now owned by code.

- **ARM-POSE LAYER (`pose.js`)** — the Dungeon Forge relaxArms technique,
  generalized: every frame AFTER the mixer (kernel updates mixers before game
  updaters) each arm chain is slerped toward actor-local target directions.
  Modes: `relax` (menu/unarmed — arms hang naturally), `gunReady` (two-handed
  gun at chest — replaces ALL armed clips), `skydive` (arms swept back),
  `hang` (hands up on the risers — the canopy shot finally looks real),
  `reload` (muzzle dips, left hand works the receiver, driven by
  weapon.state==="reloading"). Clips own legs/torso; arms always read right on
  every rig. Armed clips (idlearmed/walkarmed/runarmed) NO LONGER LOAD; files
  stay on the CDN. POSES exported for live tuning. **Verify pose work
  UNPAUSED** — W.paused stops the layer but kernel mixers keep running, so
  paused screenshots show the raw clip drifting back (cost 20 min).
- **RAMP RENDER FIX**: addRamp's slab was inverted for dir 2/3 (visual rose
  −Z while the collider rose +Z — players walked "inside the wall" on the
  correct collider) and completely FLAT for dir 0/1 (rotateZ on the slab's
  long axis is a no-op). All four dirs now match supportAt exactly; dir 0/1
  collider footprints also had width/run swapped — fixed (highway ramp is now
  a real 26m run, not a 9m cliff).
- **PER-WEAPON ADS** (`adsFov` in sim): sniper 20 + scope overlay (verified
  via real RMB), AR 42, launcher 45, SMG 47, pistol 48, shotgun 49.
- Menu turntable applies `relax` — the locker pose looks natural, not the
  Meshy library arms-out idle.

## 2026-07-08 — v4.0 fist cast, armed locomotion, portals, cursor-aim, skin locker

Owner playtest round 3 ("characters hold hands out / run odd / don't hold
weapons, shots don't go where the mouse points, no weapon cursors, chests on
roofs unreachable, falling off islands is death — need portals, menu needs
polish"). All fixes verified live with real key/mouse events + screenshots.

- **SIX-FIGHTER FIST CAST**: full regenerated Meshy roster — soldier (SGT.
  BRICK) / athlete (DASH) / drifter (SCRAP, regenerated once: first roll came
  out open-palmed) / wraith (NIGHTFALL, the all-black-with-helmet one) /
  juggernaut (BULWARK) / viper (STINGER) — all prompted "hands clenched into
  tight fists" (Meshy rigs have NO finger bones; open hands can only be fixed
  at generation). Meshy also hallucinated base pedestals under some models
  (athlete stood on a red disc everywhere) — stripped by connected-component
  analysis + a radius/up-normal triangle cut in the GLB optimizer.
- **ARMED LOCOMOTION** (the "hands out / odd run" fix): 18 new Meshy library
  clips — idlearmed=Alert(2), walkarmed=Walk_Forward_While_Shooting(234),
  runarmed=Run_and_Shoot(98) — for all six rigs; armed actors now hold the
  gun up in idle, walk, and run. Anim pace now TRACKS ground speed
  (setEffectiveTimeScale retune, never restart — restart-per-frame stutters).
- **CURSOR AIM**: without pointer lock the shot ray now goes through the OS
  cursor (unproject → capsule/terrain march), the per-weapon reticle RIDES the
  cursor, and the OS arrow is hidden over the canvas during play. Verified:
  bot at NDC(-0.31,0.05), one click, exactly one pistol hit.
- **LAUNCH PORTALS + CHUTE REDEPLOY**: every sky island carries a glowing
  ring portal (+ up to 4 ground portals at POIs) — walk in → ballistic boost
  (~80m, half-gravity) → skydive handover → canopy failsafe at 60m. SPACE in
  any mid-air fall ≥12m AGL re-opens the parachute, so stepping off an island
  is an escape, not a death. Portal whoosh in audio.js.
- **ROOF ACCESS**: every tower() gets an exterior ramp along the +X wall
  (ends short of the parapet; step sideways onto the slab — verified climb to
  y=12.9 on ashgrid), shipwreck gets a boarding plank, deepwood barn a hay
  ramp. Rooftop chests are all reachable on foot now.
- **MENU 2.0**: layered animated backdrop (bobbing sky-island SVGs, drifting
  clouds, rotating storm ring, vignette), gradient title, stacked mode cards,
  and a SKIN LOCKER — live 3D turntable preview (extra WebGLRenderer, real
  meters so no Box3 scaling), ‹/› + dots, choice persists in localStorage
  `lc_skin` and the player spawns as it (bots keep rotating the cast).
- **SPEED AUDIT**: walk 6.0 / sprint 9.6 m/s already exceeds Fortnite
  (~5.7/6.5-7), Apex (~7.4), Warzone (~6.7) — the "feels slow" was fixed-rate
  anims + narrow FOV, not m/s. Base FOV 53→57, sprint 64→70.
- **WEAPON MOUNT AUTO-ALIGN**: Meshy renders some "side view" props at a 3/4
  angle (sniper sat diagonal in its bbox and looked like a scrunched blob in
  hand). The mount now searches yaw for minimum cross-width and flips 180° by
  vertex-density (muzzle end is thin, stock end dense).
- **HARDENING**: brains[] now clears between matches (stale brains from the
  previous match kept thinking into detached actors forever); the human input
  struct is rebuilt every frame from live key/button state (a phantom
  input episode drained the whole pistol reserve mid-test — mx/mz/fire/ads
  can no longer stick); emotes holster the gun (hidden during dance/cheer,
  restored after).
- Meshy spend this round: drifter regen + 18 armed clips ≈ 300cr (2286 start
  → 1079 after). Raw GLBs re-downloadable by task id (state/meshy_raw got
  wiped mid-session by an outside process — task ids in scratchpad state
  JSONs saved the day; download URLs live ~3 days).

## 2026-07-07 — v3.0 Meshy cast + the "did you actually play it" patch

Owner playtest feedback round 2 + new requirement: original AI-generated
characters. Everything below verified live via real MouseEvents/KeyboardEvents
+ screenshots (not just sim runs).

- **MESHY AI CHARACTER CAST** (owner requirement: no reused fantasy rigs):
  4 original battle-royale characters generated on the owner's Meshy account —
  commando / runner / raider / specter — text-to-3d→refine(PBR)→rig(1.8m)→
  animate (idle 0 / walk 30 / run 16 / death 8). 188 credits total (2286→2098).
  Optimized 8MB→~0.7MB base + 25-68KB clip-only GLBs (gltf-transform+sharp,
  512px webp). Clips merged into the cached gltf at load (renamed idle/walk/
  run/death); per-actor hue tints for 50 distinct looks. Old Quaternius chars
  DELETED. **Gotchas:** do NOT bbox-normalize Meshy rigs (bind-pose bbox reads
  ~0.1m from tiny armature scales → 26m giants; rigs are authored at real
  meters). Hand bone = `RightHand`, world scale ~0.065 → scale-compensate the
  weapon holder; grip tuned live to (0, -90°, +90°). Raw GLBs in
  state/meshy_raw (not repo); pipeline scripts in session scratchpad.
- **AIM FIXED — the real bugs found by tracing actual projectiles:**
  (1) fixed-120m camera-convergence missed uphill targets → replaced with a
  true CROSSHAIR RAYCAST (camera ray vs actor capsules + terrain + colliders;
  projectile flies muzzle→that point). (2) **recoil never recovered** — every
  shot permanently kicked pitch up; after a few clicks the reticle sat ~2m
  above the target ("my pistol doesn't work"). Recoil now tracks in
  accumulators and re-centers over ~0.3s. (3) FIRST-SHOT ACCURACY: deliberate
  standing shots get 0.15× spread. Verified: crosshair-on-chest real clicks
  land (4/6 even 0.5m off-center), damage events fire.
- **Drop v2**: SPACE now TOGGLES the parachute open/cut/open repeatedly
  (verified open→cut→open); failsafe auto-deploy 60m first-time / 22m hard
  floor after manual toggles. Freefall pose fixed — belly-DOWN (sign flip;
  was falling face-up "on my back") and near-frozen mid-stride limbs
  (timeScale 0.05; 0.35 looked like jogging in the sky). No forced forward
  drift (AFK players used to slide ~100m into the ocean).
- **Body facing**: characters now turn toward their RUN direction outside
  combat (pure camera-facing read as "running sideways"); they square up to
  the camera while aiming/shooting (1.5s combat window).
- **Movement**: walk 6.0 / sprint 9.6 (9.2 effective, verified via real
  keys), ads 3.8, accel 0.13, sprint FOV 64. Stuck-ADS clears on blur.
- **Combat feedback**: per-PROJECTILE tracers (every weapon, every shotgun
  pellet — bright 22-34m streaks, colored for sniper/GL); damage numbers
  26px w/ stroke; PER-WEAPON CROSSHAIRS (pistol/smg tight cross · AR wide
  cross · shotgun spread ring · sniper fine dot + scope on ADS · GL arc
  chevron) with movement bloom.
- **Audio coverage**: footsteps (stride-distance emitter, self quiet/enemies
  loud), weapon-switch click, parachute deploy whoosh + cut, kill-confirm
  two-tone; chest open/pickup/reload/shield-break already covered. Chests
  verified opening (hold-E 2s channel).
- **NPC battle model** (owner: "run from storms but FIGHT once safe"):
  rotation urgency = meters-past-safety vs time-left (95 only when genuinely
  pressed, 40 when there's time); live enemy ≤40m scores 88+ and dominates.
  Soak: 8/9 living bots in ENGAGE mid-game, 43 gun kills vs 6 storm.
- Shield potions verified end-to-end (pickup room preserved by the ≤3-gun
  auto-pickup cap; slot-select + click → bar rises 0→25).

## 2026-07-05 — v2.1 drop/feel/AI polish (owner screenshot feedback)

- **Skydive + parachute drop** (was: rigid straight-down fall): freefall is
  belly-down (~70° tilt, banks into turns, run-clip limbs read as spread),
  fast fall −20 (dive −34 on SHIFT) with forward air inertia; a composed
  parachute (gored dome + suspension lines, per-actor color) auto-deploys at
  60 m AGL → upright pendulum sway, −5.5 fall; camera tracks the dive
  (pitch bias −0.62 freefall / −0.18 canopy, dist 9-10). Chute removed on
  landing. Bots get the identical sequence.
- **Gun actually in hand**: weapon holder is now parented to the rigs'
  `FistR` bone (scale-compensated) instead of a fixed chest offset that
  floated at head height — guns ride the skeleton through every animation.
  Armed actors use the rigs' `Idle_Weapon`/`Run_Holding` holding poses.
- **Character variety**: 5th rig (wizard) + per-actor procedural hue/light
  shifts on cloned materials — 50 visually distinct opponents (verified:
  red vs blue wizards etc. in a lineup shot).
- **Input fixed for lock-less contexts**: LMB ALWAYS fires (previously the
  first click was swallowed requesting pointer lock — if lock was denied the
  game was unplayable); unlocked = hold-RMB-drag rotates the camera (and
  ADSes); locked = mouse-look + RMB ADS.
- **Storm slowed to real BR pacing**: standard ~10.75 min of storm
  (12-13 min matches), quick ~4 min. Selftest asserts the envelope.
- **Bots fight like players now** (the "ran right past me" fix):
  engage-on-sight outranks everything when the target is LIVE and close;
  ~160° vision cone + unconditional awareness within 15 m; reload = sprint
  for lateral cover; FLEE blends escape vectors toward the circle (never
  flees INTO storm); phase≥4 rotates early; wider skill spread (tier1 7.5°
  err/700 ms → tier5 0.9°/210 ms). Balance loop discovered in soak tests:
  pure aggression gridlocked the lobby into eternal starter-pistol duels
  (0% looting) — fixed with FIGHT FATIGUE (14 s stalemate → break off,
  6 s re-target cooldown) and "distant enemies don't stop an un-geared bot
  from looting" (>35 m). Result: 46/49 gun kills, 3 storm deaths, 75%
  upgraded by late-game, winner with kills.
- Playtested via screenshots: freefall pose, canopy descent (player + bot
  chutes), armed lineup (variety + guns in hands), swimming (player + bot),
  chest beam visible at range; live-fire input verified with real
  MouseEvents (fire w/o pointer lock, RMB-drag rotate 0.53 rad).

## 2026-07-05 — v2.0 pure BR shooter rework (owner direction)

Owner feedback: drop the Fortnite building identity entirely; make it a clean
battle-royale SHOOTER. Full rework in one session:

- **Building/harvesting/materials REMOVED everywhere** — sim (BuildGrid,
  BUILD, MATERIALS gone; selftest now asserts their absence), building.js
  deleted, all build keys/UI/HUD mats, bot wall-up/box/ramp-push behaviors,
  net build mirroring. Map structures remain as static cover.
- **Arsenal = 6 guns**: pistol / SMG / AR / shotgun / sniper / **grenade
  launcher** (new: arcing fused shells, bounce, burst on body hit; replaces
  rocket launcher). Pickaxe melee + hand grenades removed. **Everyone spawns
  with a common pistol** (16 mag + 36 light) — verified all 6 weapons score
  kills in soak tests; storm kills fell from ~30% to 8% of eliminations on
  standard (fights actually resolve).
- **Swimming**: deep water = real swim (surface buoyancy + bob, swim/sprint-swim
  speeds, no shooting while swimming, SPACE = stroke hop, splash FX/audio).
  Replaces the old push-back-to-shore hack.
- **Controls simplified** to WASD / SPACE / SHIFT / LMB / RMB(ADS) / R / E
  (+ 1-5/scroll slots, M map, ESC). Crouch, quick-heal (T), and every build
  key removed; settings keybind list trimmed to match. Scroll now cycles
  weapon slots.
- **Loot rework**: chests are UNMISSABLE (large chest model + gold rarity
  ring + pulsing glow sprite + vertical light beam, all removed on open) and
  take a **2-second HOLD-E channel** (progress ring on the HUD crosshair;
  bots obey the same 2s rule). Items: walk-over auto-pickup whenever there's
  room; **tap E swaps the ground item with your active slot** when full.
  Death drops now include the EQUIPPED weapon (all slots + ammo).
- **Directional indicators** (industry standard): white footstep icons on the
  screen-edge ring for moving players within 30 m (1.4 s per-actor throttle),
  gunfire chevrons for shots 12-250 m away, red arcs toward whoever damaged
  you. All fade ~1 s, positioned by world bearing relative to camera yaw.
- **Neutral characters**: the Quaternius rigs' baked weapon meshes
  (Ranger_Bow / Rogue_Dagger / Warrior_Sword / Cleric_Staff) are stripped at
  load — nobody holds anything except their actual gun (starting pistol is
  now visible in hand from spawn via equip-on-load).
- Bots: FARM state + build behaviors removed; new **flanker** personality
  (arcing strafe pushes) replaces "builder"; suppression reflex = sprint to
  lateral cover when shot by an unseen attacker; chest opens channel 2 s;
  loot brain rewritten around "upgrade off the starter pistol" (14/26 alive
  bots upgraded by t=150 in soak).
- Verified in preview: full matches on isla standard (t≈7:40, 45/49 gun
  kills, winner 6 kills) + deepwood quick; swim/hold-E/indicators/walkover
  all exercised through the real input paths; sim selftest 44/44; zero
  console errors.

## 2026-07-03 — v1.0 initial build (full game, one session)

**What it is:** 50-player third-person battle royale with Fortnite-style building.
1 human + 49 AI opponents (friends can join online and replace bots). Three maps,
three modes, full loot/storm/build/combat loop, win/lose/stats screens.

### Architecture
- FFG 3D kernel (`ffg_kernel_3d.js`, shared with Pirate's Cove/Tide Breakers) + new genre `royale`.
- **Rules core** `runtime/sim/royale.js` — pure, deterministic, node-tested
  (`royale.selftest.cjs`, 47 asserts): weapons/damage/falloff, storm phase math
  (nested seeded circles), BuildGrid (slots, HP ramp, support graph, cascade
  destroy), loot tables, match bookkeeping.
- **Genre modules** `runtime/3d/royale/*`: maps, player, weapons, building,
  loot, storm, bots, hud, audio, fx, net. Orchestrated by `ffg_royale3d.js`
  (shared world object `W`, fixed frame pipeline, `window.__LC__` debug hook
  with synchronous `fastForward` for deterministic testing).
- **Bots are players structurally**: brains write the same input struct the
  keyboard does; movement/weapons/building are one code path.
- **Multiplayer**: Supabase Realtime (NetPlay). World is deterministic from the
  shared seed; only live state relays. Host simulates bots (10Hz snapshots);
  each human simulates themselves (12Hz); hits on remote actors route to their
  owning client. Guests take over bot slots; disconnect → bot brain re-attaches
  (explicit `bye` + 12s host watchdog). Loot item ids are derived from source
  (`f:`/`cb:`/`dd:`/`sd:`/`sw:` prefixes) so pickup mirroring never desyncs.
  VERIFIED live with 2 clients (host tab + same-origin iframe): identical seeds,
  slot takeover, bot snapshots flowing, 0m relay error on player state.

### Maps (seeded procedural, 1600m)
- **Isla Viva** — tropical: radial island, volcano+crater, beaches, 8 POIs
  (Palm Bay, Coco Village, Volcano Rim, Shipwreck Cove, Cliff Temples, Lagoon
  Docks, Jungle Market, Banana Farm), palms/trees instanced + harvestable.
- **Ashgrid** — urban: bowl downtown with multi-floor enterable towers (interior
  ramps, roof chests), overpass, container yard + motor pool (metal), crane
  high-point, rubble cover field.
- **Deepwood** — forest: rolling hills, river+lake carve, ranger towers,
  logging camp, quarry (brick), cabins, fire watch.
- **Proving Grounds** — practice-only: range with distance markers, build lot,
  movement course.
- Batched box-geometry structures (one mesh per color) + InstancedMesh props;
  static collider spatial hash; analytic heightAt shared with minimap render.

### Systems
- Weapons: pickaxe/pistol/SMG/AR/shotgun/sniper/rocket/grenade; rarity tiers
  (+8% dmg, −10% spread per tier); real projectiles with travel + drop
  (sniper/rocket), pellets, splash+knockback, recoil, reload, falloff to 40%.
- Building: wall/floor/ramp/stair; 10 mats; wood/brick/metal HP ramp
  (90→150 / 100→300 / 110→500); door edits; support-graph cascade destroy;
  ghost preview + turbo-build for the human; bots build via the same tryBuild.
- Loot: seeded floor spawns + chests (golden ring, burst on open), supply drops
  (2/match, drift down into next circle), death drops (deterministic, seeded by
  victim id), 5-slot inventory, ammo/mats auto-pickup.
- Storm: 7 phases standard (~8.5 min storm → 10-13 min match), 5 quick (~3.5 min);
  final circle HOLDS at ~10 m (r=0 storm-killed every survivor simultaneously —
  someone must WIN the fight); violet additive wall (hidden pre-shrink +
  practice); minimap current+next rings + outside-veil; warnings + sirens.
- Bots (49): utility state machine (DROP/LOOT/FARM/ROTATE/ENGAGE/FLEE/HEAL/
  CAMP/PUSH/WANDER) over per-bot blackboard; 5 skill tiers (reaction 600→220 ms,
  aim error 6°→1°, build ability none→edit-plays) × 6 personalities (rusher,
  builder, camper, loot_goblin, rotator, sniper); staggered thinking (150/400 ms
  near/far); vision cone + LOS + hearing (shots 250 m); aim model with acquire
  overshoot, tracking warm-up, motion penalty, smooth error wobble; burst fire
  discipline; wall-up reflex on damage; box-up heal; ramp pushes; third-party
  drift; endgame aggression (camp off, +engage, duel aim 0.55×).
- HUD/UI: menu (mode+map cards), lobby fill (50 named slots + countdown), HUD
  (bars, slots w/ rarity, mats, ammo, minimap, kill feed, storm timer, alive,
  interact hints, hitmarkers, damage numbers, storm/hurt tints, sniper scope),
  big map (M), pause, settings (volumes, sensitivity, graphics presets,
  click-to-rebind keymap via canonical-code remap), death→spectate (killer
  hand-off), post-match stats, victory + confetti.
- Audio: procedural Web Audio SFX (per-class gunshots w/ distance+pan to 260 m,
  builds, impacts, shield break, chests, heals, storm sirens, UI); music =
  3 unique Laser Sequence tracks (menu/match/endgame) per no-duplicate rule.
- FX: single 1024-cube InstancedMesh particle pool (muzzle, tracers, impacts,
  explosions, debris, chest bursts) + DOM damage numbers + camera shake.
- Perf: 51 fps / 25 draw calls / ~500 k tris with 50 actors in preview (DPR 1.5,
  shadows 1024); far-bot LOD (cheap physics + frozen mixers >250 m), staggered
  AI, spatial hashes, particle/projectile pooling.

### Bugs found & fixed during preview verification
- **Versioned-import dual-instance**: `import "./x.js"` (bare) alongside
  `import("./x.js?v=")` = TWO module instances (empty genre registry / null K).
  All intra-runtime imports must propagate `?v=`.
- Emitter dropped 4th event arg (tracer dir undefined).
- Build cell `Math.round` → walls a cell above the builder (never grounded).
- Bot plan-stall: state unchanged → onEnter never re-ran → idle forever.
- **Sticky-crouch**: glide-dive set input.crouch, nothing cleared it → every bot
  crawled at 2.2 m/s all match.
- **Mats starvation loop**: nobody could afford a first wall → kills dropped no
  mats → no one EVER built. Fix: 50 starting wood (humans too), Fortnite-scale
  harvest (14+8/swing), 50-count mats pickups. 61-103 builds/match after.
- **r=0 final circle** crowned a corpse (winner at −11 HP); holds at ~10 m now.
- Stale MATCH OVER overlay leaked into the next match (layer cleanup).
- Rock cluster normalized by height → house-sized blob (compact props normalize
  by max dimension).
- Spectated actor's nametag filled the screen (focus tag hidden; tags culled).
- Preview gotchas confirmed: plain `http.server` serves stale ESM (use
  serve_nocache.py); `window.open` blocked (2nd client = same-origin iframe).

### Match-quality numbers (fastForward soak tests)
- Standard/Isla: hot-drop fights from t≈60 s, 40%→88% armed (t=100→300),
  61 builds, winner 1-13 kills, full match 9-11 min, storm kills ≈15/49.
- Quick/Ashgrid: complete in ~6.5 min, 103 builds.
- Deepwood: verified spawn/fights/POIs; player got shotgunned by a bot (good).

### Known limitations (v1)
- Mid-match join syncs t/builds/loot but not in-flight projectiles.
- Bot pathing is steering-based (no navmesh); rare storm stragglers die dumb
  (tier-appropriate, honestly).
- Stairs render stepped but share ramp collision; roof piece not implemented.
- No swimming — deep water pushes back to shore (Fortnite-pre-swim rule).
