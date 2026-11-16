# PG_AUDIO lane brief: little voices, place ambience and the sounds of things, all procedural

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: the tunes (D-81): the
Music Box plays 8 bars (29.1 s) at most once per 40 s and a second tap stops it, and the kettle **whistles one bar (3.6 s)** every 45 to 90 s,
never within 60 s of a Music Box tune, so with no input tunes sound at most 20% of a cabin visit (AU-14); `creature()` and `prop()` keep no
reference to the caller's reused object (AU-11); LIFE decides on sim time only, so `musicClock` feeds only the `at` the shell maps after LIFE
decided, and a sung degree may be re-voiced here onto the sounding field's rest tones (D-66); the touch duck is for a finger, a grab or a carry,
never a lock alone (AU-13, D-84); prop strikes carry a cause, and a weather strike is still a sound; your first-load share is capped at 8 KB.

**Revision 4 (2026-11-16, after `_handoff/design/CONFIRM.md`; PLAYGROUND_BUILD.md D-85 to D-93).** What changed for you: the **away chunk** that
holds your ambience bed and the place prop voices is capped at **90 KB** with the render place host (D-92: report your share at S1's first step);
a keyboard "Tap it yourself" now rings chimes, bells, crystals and lanterns part by part and shakes the Shake Pine through the same
`drainStrikes` path as a pointer tap (cause 0, D-93); S03's **soft boop** on low and med makes no physics bump (the contact is at 0.04 m/s), so the
boop's sound is its voice phrase only (a chirp, then the target's giggle trill, LIFE 6.1); `auto` bumps now also include a LIFE body bumping a
locked body nobody touches (D-86), which you play as a budgeted soft variant like any other `auto` event.

## You own
- `src/audio/**`: new `creature.ts`, `ambience.ts`, `props.ts`, `places/<id>.ts` (one recipe per place, inside that place's lazy chunk); additions to
  `engine.ts`, the master chain and `music.ts`
- `_harness/probe_audio.mjs`, `_harness/audioview/**` (new `life_checks.mjs`), `_harness/probe_chatter.ts` (new node probe for AU-10)
- Running report: **`_handoff/reports/PG_AUDIO.md`**. Port 5367. Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_audio/`
- Port note: the shell's prod-build row serves on 5366 + 1 = **5367**. Before each browser run check the port is free (`ss -ltn | grep 5367`), and
  say in your report when you hold it.

## You must not touch
`src/life` (LIFE plans every phrase, D-59), `src/shell`, `src/ui`, `src/render`, `src/physics`, `src/data`, `src/core`, `src/collection`. Contract
changes: additive and optional in the PLAYGROUND block only, reported. No git write command.

## When you may start
Now (step 0), in the offline harness: the creature voices, the chatter bus, the limiter, `musicClock` and Home's prop voices need nobody else. Until
PG_LIFE's `lifePhrase` lands, drive `creature()` with fixture phrases in your harness (and say which rows used fixtures).

## Read (completely)
`_spec/LIFE.md` **8 (your voice spec: syllables, motif, pitch, timbre, phrases, harmony, the mix; 8.4 sim time)**, 7.2 (sound off: every phrase has
its bubble), 10.1 and 10.2 (the voice caps and the touch duck), 12 (`lifePhrase`, who plans and who synthesises); `_spec/PLACES.md` 2.2 (the echo
zone), 3.3 (chimes, echo, tunes), every place's "Sound" and "Music style" lines (4.1 to 4.10; the cabin's kettle in 4.2), P10 (no animal sounds);
`_spec/PLAYGROUND_BUILD.md` 2 (D-27, D-28, D-51, D-59, **D-66, D-81, D-84**), 7 (the `SquishAudio` and `AudioSettings` members), **10 (your
spec)**, 13, 14.2, 14.3 (your 8 KB first-load cap), 18 (the AUDIO rows AU-01 to AU-14), 19; `_spec/SOUND.md` (the room-for-effects rules);
`_handoff/maps/AUDIO.md`; `src/contracts.ts` PLAYGROUND (`creature`, `prop`, `musicBox`, `musicClock` and the reuse rule in its header);
`src/audio/cut.ts` 33-41 (`FAMILY_FLAVOUR`) and 129 (`popSize`), `music.ts` 21-25 and 256-264 (fields, 66 BPM) and 129 (`ROOM_KINDS`),
`interact.ts` 90-123 (`BumpLimiter`), `engine.ts` 79-91 (the rng streams) and 216 (`registerFx`); `_harness/audioview/engine_offline.js` 42 (it
labels the first three `createGain()` calls boost, plain and music).

## Build: S0 "Life at Home" (first load)
1. The **`chatter` and `ambience` input gains**, created **after** `music` so the harness labels stay right; with both at their defaults every
   existing seeded render is bit-identical (AU-07). `AudioSettings.chatter` (the "Voices" slider, default 0.6) and `ambience` ("Place sounds",
   default 0.5).
2. **`creature(p)`**: synthesise the phrase LIFE planned (up to 4 syllables, 4 floats each), **copying what you need from `p` and its arrays during
   the call** (the shell reuses one object; AU-11 changes it right after the call and expects nothing scheduled to change). The 8 syllable shapes of
   LIFE 8.2 (chirp, coo, purr with a precomputed 28 Hz gain curve, hum, trill, yawn, chitter, peep), the 6 flavours (gel, sticky, foam, beads,
   dough, firm) by a cached `PeriodicWave` each plus one formant biquad; one oscillator, one envelope gain, a panner only off centre: **at most 4
   nodes per syllable**; contours by `frequency` and `detune` automation only (no extra LFO node, **no DelayNode**). **Pitch, as LIFE 8.2 writes
   it:** D5 x `pitch`, snapped to D major pentatonic (D E F# A B) from A4 to D6 (440 to 1175 Hz) for wholes; **pieces x `popSize(frac)` = (0.5 /
   frac)^0.4 (audio/cut.ts 129), snapped from D6 to D7 (1175 to 2349 Hz), 7 dB quieter**; a cold place one semitone lower before the snap. A sung
   note LIFE planned as a pentatonic degree may be re-voiced onto the sounding field's rest tones (root, fifth, ninth) here, which changes no LIFE
   decision. The group voice (2 or 3 detuned oscillators, +-10 cents, at one piece's level + 2 dB). The echo: one scheduled repeat at +220 ms,
   -12 dB, low-passed, half a voice. Priority -1 (stolen before any player sound), never in `ROOM_KINDS`, its own rng stream from `CHATTER_SALT`
   (never `engRng`), silent during ceremonies and for 1 s after; **while the player touches (a finger down, a grab or a carry; never a lock
   alone)**, other voices duck 6 dB and slow to 1 syllable a second until 0.6 s after release (AU-13).
3. A pure **`ChatterLimiter`** shaped like `BumpLimiter`, at the desktop caps (3 voices at once, 4 starts a second, burst 6), as a backstop the
   shell cannot flood (AU-05, AU-10).
4. **`musicClock(out)`**: the field SOUNDING now (from the composer's field log against bar time: the `detailStats` readout runs up to a bar ahead),
   bar start, bpm, now, the eighth-slot length; false before unlock or with the music off. It is read only by the shell, for `creature()`'s `at`
   and the render sway phase **after LIFE has decided**; it never enters LIFE's snapshot (LF-26, SH-01).
5. **`musicBox({ on, tune })`** (D-81): the bed mutes its own mallets while a tune plays. **The Music Box**: 8 bars (29.1 s at 66 BPM) in the
   sounding field, at most one start per 40 s, a second tap (`on: false`) stops it. **The kettle** (S1): a 1-bar whistle (3.6 s), by itself every
   45 to 90 s (the shell's seeded timer), never within 60 s of a Music Box tune. AU-14: with no input, tunes sound at most 20% of a 10-minute
   cabin visit.
6. Home's prop voices through `prop()` (copying `p` during the call, AU-11): the felt ball's soft roll and bump, the music box. The budgeted soft
   `auto` land and bump variants the shell calls for every autonomous event (lands, prop bumps **and body bumps**, D-62): they never call
   `registerFx` (a sound that moved by itself never asks the music for room).

## Build: S1 "Hearthlog Cabin" (the away chunk and the cabin chunk)
7. **`ambience.ts`**: an `AmbienceBed` shaped like `MusicBed`: its own bus, 3 s fade in, 2 s crossfade on travel, the 100 ms tick, two noise sources
   at different rates so the 2.5 s noise loop never shows, a shallow -6 dB dip under player effects, never asking for room; it joins `freeAll` and
   `freeMusic` on pause and mute. `loadAmbience(place)` (a lazy import), `setAmbience({ place, on, volume })`.
8. **`places/hearthlog.ts`**: Poisson crackle 4 to 9 a second at 2 to 5 kHz, a low fireplace rumble (120 to 300 Hz breathing at 0.1 Hz), a log
   creak every 25 to 50 s, a soft window hush; and `setMusicStyle('cabin')` (more dusk and home fields, a warmer low-passed mallet; `'home'` is
   bit-identical, AU-07). **The kettle's voice is its 1-bar whistle through `musicBox`** (a tap whistles at once); the fire puff a short swell of
   the crackle.
9. `props.ts` for the cabin: `creak` (a held voice per prop key with a dead-man switch: the rocker, the swing), `ball` (the yarn ball), the fire puff.
   A sound the player caused (a strike with cause 0) may use `registerFx`; one that moved by itself (cause 1, a body, or 2, the weather) never does.
10. The finale's sound: two bars of everyone singing on the sounding field (the phrases come from LIFE; you voice at most 3 singers on a desktop and
    2 on a phone).

## Build: S2 and S3
S2: `chime` and `bell` (tuned to D major pentatonic, struck by contact with the strike intensity; a wave's breeze or a gust rings them as a sound
only), `splash`, `crunch`, `rustle`, `boing` (pads); the Ripple Shore, Frostbell Ridge and Rainleaf Garden recipes and styles (surf swells and a sea
breeze with no gulls; gusts synced to the Wind Gap and a crisp near-silence; dense patter and drips as small bubbles; PLACES 4.3 to 4.5). S3: `tick`
on the beat from `musicClock`, `whoosh`, the Echo Stone's double echo for 20 s, and the five other recipes and styles (PLACES 4.6 to 4.10). No
animal or traffic sounds, ever.

## Acceptance ids you must make pass
**AU-01 to AU-14.** The "O" rows are OfflineAudioContext renders in headless Chromium through `probe_audio.mjs` and `life_checks.mjs` (a heavy job:
one at a time, on 5367); AU-10 is node (`probe_chatter.ts`, picked up by `run_probes.ts`: keep it light). AU-08 needs LIFE's planner for the sung
phrase: until it lands, use a fixture and mark AU-08 provisional. AU-14 runs a scripted 10-minute cabin visit with no input (node timers or the
offline render). Also write, in your report, a **first-listen checklist** for the verifier and the owner (nobody has heard any of these sounds):
what each syllable, flavour, the kettle's whistle and each place should sound like, and what would count as wrong.

## Budgets
Audio main thread at most 0.5 ms a frame; at most 10 chatter nodes and 14 ambience nodes steady (AU-11: 5000 syllables return to the baseline node
count); a whole squishy's syllable peak at most -20 dBFS at Voices 100% (about -24 dBFS at the default 0.6), pieces 7 dB lower; player effects at
least 8 dB in-band and 10 LU K-weighted above chatter and ambience (AU-03); each ambience at least 6 dB under the music long term (AU-06); the music
stem's pumping metrics unchanged (AU-04). **Size:** your first-load share at most **8 KB** minified (the buses, `musicClock`, creature synthesis,
the limiter, Home's prop voices); each place recipe 4 to 6 KB inside its 45 KB place chunk (PLAYGROUND_BUILD 14.3); after every step report the
minified bytes of each new or grown module (14.3's one-file rolldown build).

## Never
A sample, a word, speech or an animal sound; a DelayNode; a draw from `engRng`; chatter in `ROOM_KINDS`; a change to an existing seeded render; a
phrase planned in audio (LIFE does it); a reference kept to the caller's `p` or `phrase`; an 8-bar kettle tune.
