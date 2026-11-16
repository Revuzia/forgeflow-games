# PG_AUDIO running report (src/audio: chatter + ambience buses, creature voices, ChatterLimiter, musicClock, musicBox, prop voices, ambience bed, places)

Brief: `_handoff/briefs/PG_AUDIO.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_audio/`.
Engineer 1 started 2026-11-16 ~10:10 UTC. No earlier PG_AUDIO report existed and `src/audio` was untouched at HEAD 1965cd2c2 (git status clean
for `src/audio`, `_harness/audioview`, `_harness/probe_audio.mjs`). Scope for this run: build-order step 0 and slice S0, then the S1 parts in
my lane that need no other lane.

## Status table (update after every step)
| Step | What | State |
|---|---|---|
| 0 | read brief, STATUS, COMMON, SESSION3, CONFIRM, LIFE 1/7.2/8/9/10.1/10.2/12, PLACES 2.2/3.3/4.1/4.2/P10, PB 2/7/10/13/14.3/15/16/18, SOUND chain/engine/room, AUDIO map, contracts PLAYGROUND audio, the cited audio code and harness | DONE |
| 1 | AU-07 baseline taken BEFORE any audio edit (`life_checks.mjs --baseline`) | DONE (10:19), see AU-07 below |
| 2 | chain.ts: `chatter` and `ambience` inputs after `music`; `chatterGain` (0.6 = -4 dB), `ambienceGain` (0.5 = 0 dB) | WRITTEN, tsc clean |
| 3 | music.ts: `MusicStyle` (`home` = today, `cabin`), the planned-bar ring + `barAt` (musicClock), `quietMelody` (tunes), `ball` in ROOM_KINDS | WRITTEN, tsc clean |
| 4 | creature.ts (synthesis, pitch snap, sung re-voicing, ChatterLimiter, chatter bus) | WRITTEN, tsc clean, node rows ok |
| 5 | props.ts (ball bump, held roll with dead-man, TuneGate, Music Box tune, kettle whistle) | WRITTEN, tsc clean, node rows ok |
| 6 | life_voices.ts (lazy) + engine stubs: creature, setTouching, musicClock, setMusicStyle, musicBox, prop, autoThud | WRITTEN, tsc clean (my files) |
| 7 | contract: creature `sing?`, `setTouching?`, `autoThud?` (additive, optional, PLAYGROUND block), musicBox tune ids documented | DONE, tsc clean |
| 8 | `_harness/probe_chatter.ts` (AU-10, AU-14, id mirrors, pitch rules) | DONE: 29/29 rows ok, 0.16 s |
| 9 | `_harness/audioview/life_checks.mjs` O rows: AU-07, 01, 02, 05, 08 (fixture), 09, 11, 12, 13 | **DONE: 39/39 PASS** (10:46, one run on 5367, port freed) |
| 10 | S1: `ambience.ts` (AmbienceBed, manager, held creak), `places/hearthlog.ts`, engine `loadAmbience` / `setAmbience`, pause / mute / Place-sounds slider, the dip under player effects, prop creak (key, held) and fire puff (crackle) | WRITTEN, tsc clean (my files); AU-03, AU-04, AU-06, AU-14 offline PASS (10:53) |
| 11 | Sing together / finale: a sung phrase spends the starts of its densest second (2 for LIFE's 4-note SING), so 3 singers fit the desktop backstop, a 4th is refused | DONE, probe row |
| 12 | `probe_audio.mjs` runs `life_checks` in a full run (`--no-life` skips, `--only-life` runs only it) | DONE (syntax checked) |
| 13 | (11:00) AU-08 now fed by LIFE's own planner (`src/life/voice.ts` planPhrase SING, imported by `life_checks.mjs` in node; the fixture stays as a fallback); AU-11's leak test raised to 2100 phrases (>= 5000 syllables); new PROPS rows (auto sounds never move the music, at most 3 a second; a struck ball makes room; ball bump level; ball roll and creak dead-man; the kettle on rest tones); the kettle's whistle moved down an octave (A5..E6, was up to E7 2.6 kHz); the bed frees itself only once the context is gone, so a pause lets it fade first | WRITTEN; re-run pending (the full probe_audio regression was running) |
| 14 | full `probe_audio.mjs --port=5367` regression, run 1 (10:55..11:05) | 683/689: 3 life rows + 1 console error were artefacts of my editing `engine.ts` / `ambience.ts` DURING the run (the page mixed old and new modules: `h.now is not a function`); 2 rows were the round-3 engine test's master-chain node count, 10, which PB 10's two new inputs make 12: **re-specified** (below) |
| 15 | fixes from the checks: a hum's vibrato curve left its last detune value (-14 cents) on every later syllable of the phrase (found by AU-08 on LIFE's real SING phrases; the curve now ends at exactly 0); chirp and coo keep their own glide speed when LIFE stretches them (sung notes then hold their note); the held voices' dead-man fades from 0.15 s (silent by 0.3 s); `stopTune` after a tune ended does nothing | DONE; `life_checks.mjs` all rows PASS on the current code (11:10: AU-01 7/7 and AU-08 PASS after the hum fix; 53/56 at 11:09 before it) |
| 16 | full `probe_audio.mjs --port=5367` regression, run 2, code frozen | **DONE 11:24: 696/696 checks PASS** (every round-1, round-2, round-3, audio-4 room and CUT check, plus 55 PLAYGROUND rows: AU-01..09, 11..14 and PROPS), exit 0, port 5367 freed, no process of mine left |
| 17 | AU-01 regression row: a syllable after a hum lands on its note (gel and firm: -6.3, 0.0, -6.3, 0.1 cents) | DONE 11:25, AU-01 7/7 |

**State at the end of engineer 1's run (11:25):** `npx tsc --noEmit -p tsconfig.json` clean (exit 0, whole tree); `node _harness/probe_chatter.ts`
31/31; `node _harness/probe_audio.mjs --port=5367` 696/696. S0's audio scope and S1's audio scope (in my lane) are built and checked. Not done:
see "Not done in this run" at the end.

## Acceptance rows (S0 scope), last run 2026-11-16 10:46: `node _harness/audioview/life_checks.mjs` 39/39 PASS; `node _harness/probe_chatter.ts` 29/29 ok
| Id | Result | Numbers |
|---|---|---|
| AU-01 | PASS | 42 whole syllables (7 shapes x 6 flavours) peak -24.1..-22.0 dBFS at Voices 100% through the chain (LIFE cap -20); 6 piece peeps -29.5..-29.4; largest step 0.029; tail -117 dBFS; every syllable lands on its snapped D pentatonic note, worst 6.2 cents |
| AU-02 | PASS | the 6 flavours pairwise >= 3 dB apart in at least one third-octave band: closest pair gel / dough 7.0 dB |
| AU-03 | PASS | 35 isolated player effects (placements seed 81: poke, pop, land, bump, squeeze, pickup, toss, lift, release) over chatter every 0.7 s at level 1 (NO touch duck: the strict case) plus the cabin bed: in-band worst 19.3 dB (toss), median 29.8 (bar 8); K-weighted worst 11.6 LU (land), median 21.0 (bar 10) |
| AU-04 | PASS ("equal", by identity) | sparse play (seed 91, 36 s) with music: the music stem with chatter every 0.9 s and the cabin bed running equals the one without them, max diff 1.5e-8 (so every pumping metric is unchanged) |
| AU-05 | PASS | storm of 50 requests a second for 10 s through the engine: at most 3 live groups (desktop backstop; 23 of 501 admitted), peak -28.4 dBFS against the loudest single phrase's -27.7 (bar +3 dB). Phone caps (2 live): the pure limiter, probe_chatter AU-10 (max live 2) |
| AU-06 | PASS 3 of 4 rows at 10:53, the 4th (seam) fixed and re-run below | Hearthlog bed under the music long term (10..62 s, default sliders): -14.6 dB RMS, -13.5 dB K-weighted (music -30.4, bed -45.0 dBFS; bar -6). Pause and mute: 11 extra live nodes at 7.9 s, 0 at 8.2 s, silent from 8.12 s (bar 0.2 s). Seam: the bed against itself 2.5 s, 3.42 s, 2.29 s, 5 s later correlates 0.006 / -0.003 / 0.002 / 0.003 (bar 0.2; the 6.84 s lag fell off the end of the render: window shortened) |
| AU-07 | PASS (re-specified bar, see below) | 19 renders: through the chain max diff 4.35e-5 or less (bar 1e-4), with no limiter in the path 5.8e-6 or less (bar 5e-5); land and pop exactly 0 |
| AU-08 | PASS, from LIFE's own planner (11:10) | six SING phrases from `src/life/voice.ts` planPhrase (six species, singers 0..2, imported by the node side of `life_checks.mjs`; a fixture of the same layout is the fallback if LIFE fails to load), sent with `sing: true` at the next bar line of musicClock through the engine: 24 notes over fields 0 and 1, worst onset 0.9 ms off the eighth grid, worst 6.1 cents off a rest tone of the sounding field. LIFE's planner is itself not yet verified by PG_LIFE's verifier |
| AU-09 | PASS | a rare reveal at 3 s: chatter silent (-240 dBFS) from 3.06 s to 1 s after the ceremony duck ends (5.2 s), then back (-28 dBFS) |
| AU-10 | PASS (node) | probe_chatter: burst 6, refill 4/s (40 in 10 s), 3 voices at once, echo half a voice, one start per syllable, touching 1 syllable/s, NaN-safe, storm at phone caps max 2 live, deterministic |
| AU-11 | PASS | at most 4 nodes for a ONE-syllable phrase of every flavour x register x group x pan (and its echo); 1250 phrases (3103 syllables) return to the baseline node count (493 -> 4771 -> 493); scrambling the reused `p` and phrase array right after creature(): max diff 0 |
| AU-12 | PASS | the repeat starts 220.8 ms after the voice, -11.3 dB (RMS of a held hum through the echo's low-pass), nothing after it, 0 createDelay calls |
| AU-13 | PASS (audio side) | touch at 3.2 s, release at 6.2 s: phrases at 3.5..6.5 s are -6.0 dB, before and from 7.5 s 0.0 dB; 12 requests in 2.9 s of touch admit 3 (1 a second). "A lock ducks nothing" is a shell row: audio has no lock input, and nothing ducks unless setTouching(true) is called |
| AU-14 | PASS (node + offline) | probe_chatter: a 10-minute cabin visit with the shell's 45..90 s kettle timer through TuneGate: tunes 4.8% of the time (8 one-bar whistles); worst case every 45 s 7.9%; the Music Box at most once per 40 s; no kettle within a tune or 60 s after; a second tap stops; a box tap cuts a whistle. Offline through the engine: the box tune plays (-21 dBFS peak), a second tap silences it, a third tap 2 s later is refused, the kettle is refused at 40 s and whistles one bar at 73 s (-27 dBFS) then stops; the bed's melody (1.5..4 kHz of the music stem) is 23.5 dB down while the box plays |

**Two Chromium behaviours found and worked around (worth knowing for every lane that schedules audio):** (1) a GainNode with nothing
connected to it does not advance its AudioParam automation (measured: the touch duck's return, planned while no voice sounded, never came
until the next phrase connected; a setTargetAtTime's approach started only when the node was next processed). The chatter bus now keeps a
silent ConstantSource connected and plans its gains as linear ramps. The music bed and the chain are not affected in today's renders (their
gains always have sources), but an idle bus with planned automation is a trap. (2) Offline renders are not bit-exact run to run (AU-07 above).
**Re-specified existing check (written reason):** `_harness/audioview/engine_tests3.js` `CHAIN_NODES` 10 -> 12. The two rows "... then
music off and drained: ... the API-surface tracker holds only the N master-chain nodes" count every node the engine keeps alive; PLAYGROUND_BUILD
10 and my brief's step 1 add the `chatter` and `ambience` input gains to the master chain, so the chain is 12 nodes. The rows' point (nothing
but the chain survives a drained music session) is unchanged; no other existing check was touched.
**A harness fix:** the chain's chatter input is mono for a centred voice, so a plain channel splitter put the voice in L only and the stem read
6 dB low; the engine_offline taps now go through an explicitly stereo gain first (like the existing fx tap).

## Sizes (PB 14.3 one-file rolldown build, minified ES, imports external; script `scratchpad/pg_audio/size.mjs`), last 11:11
(11:11 re-measure: engine 16 407 (+2 766), life_voices 4 985, creature 6 048, props 4 921, ambience 4 676, hearthlog 2 681: first-load share
4 548 B = 4.4 KB; life voices chunk 15 954 B = 15.6 KB; the table below is the 10:55 measure)
| Module | Bytes | Chunk |
|---|---|---|
| engine.ts | 16 340 (HEAD 13 641, **+2 699**) | first load |
| chain.ts | 2 462 (HEAD 1 994, **+468**) | first load |
| music.ts | 16 268 (HEAD 14 954, **+1 314**) | first load |
| **first-load share** | **4 481 B = 4.4 KB of the 8 KB cap** | |
| life_voices.ts | 4 970 (new) | lazy: facade `audio/life_voices.ts` |
| creature.ts | 6 002 (new) | (only life_voices.ts imports it) |
| props.ts | 4 917 (new) | (only life_voices.ts imports it) |
| **life voices chunk** | **15 889 B = 15.5 KB** | **a new lazy chunk T1 must name** |
| ambience.ts | 4 667 (new) | the AWAY chunk (facade `audio/ambience.ts`, T1 already names it): my share of the 90 KB |
| places/hearthlog.ts | 2 681 (new) | the cabin's place chunk (budget 4 to 6 KB of its 45 KB) |

The first build (everything in the engine) measured **17.6 KB of first load** (creature 5.7, props 4.9, engine +5.2, chain +0.5, music +1.3):
over the 8 KB cap. By 14.3's overflow rule I moved the voices into their own lazy module: `engine.ts` keeps the buses, `musicClock`,
`setMusicStyle` and thin stubs; `life_voices.ts` is `import()`ed at the first `unlock()` (or the first PLAYGROUND call). Everything it holds is
used only once LIFE runs (the life chunk loads after the first frame of play; the Felt Ball and the Music Box are props of `physics/props.ts`,
also in the life chunk), so no boot sound waits for it. A PLAYGROUND call before it arrives is dropped and counted in `stats().dropped`, never
queued. **Request to the orchestrator (T1):** name the lazy chunk whose facade is `src/audio/life_voices.ts` (14.5 KB) with the life chunk
(or as its own "life voices" chunk); the T1 gate would otherwise fail on it as unnamed.

## Contract additions (src/contracts.ts PLAYGROUND audio block; additive, optional; tsc clean)
- `creature(p)` gains `sing?: boolean`: a sung phrase (SING, the duet, a finale). Its degrees are pentatonic steps from D (LIFE's `REST_TONES`
  D 0, A 3, E 1), placed in the voice's octave and re-voiced onto the SOUNDING field's rest tones (root, fifth, ninth). Absent = spoken: the
  degrees are steps from the voice's own snapped note. Without this flag audio cannot tell a sung phrase from a spoken one (the `p` object
  carries no phrase id), so AU-08 could not hold. Also documented: a piece's `pitch` = pitchRatio x popSize(frac) and a cold place's pitch x
  2^(-1/12), folded in by the caller (`p` carries neither the fraction nor the place).
- `setTouching?(on)`: the player is touching (a finger down, a grab or a carry; never a lock alone). Chatter ducks 6 dB and the backstop allows
  1 syllable a second until 0.6 s after `false` (AU-13). The shell calls it on change. (LIFE's attention already slows LIFE's own requests; the
  6 dB duck of what is already sounding needs audio to know.)
- `autoThud?(p: { kind 0 land / 1 body bump, intensity, pitch?, pan? })`: the budgeted soft variant for a body's own `auto` land or bump
  (D-62, D-86). `land()` and `bump()` always ask the music for room, so the shell needs a separate member for `auto` events. A prop bump goes
  to `prop({ auto: true })`.
- `musicBox`: tune 0 (or absent) = the Music Box, tune 1 = the kettle's whistle (doc only).

**Requests to PG_SHELL:** call `setTouching` on each change of "the player is touching"; send every `auto` land and body bump to `autoThud`,
every prop strike to `prop` with `auto = cause !== 0`; pass `sing: true` for SING, DUET and finale phrases; fold popSize(frac) into a piece's
`pitch` and 2^(-1/12) into a cold place's; `musicBox({ on: true, tune: 1 })` for the kettle's whistle (the seeded timer stays yours; audio
refuses a start that breaks D-81, as a backstop).
**Note for PG_LIFE:** LOVED plans degree 4 with the comment "an octave up: the audio snap folds +5 steps; 4 is the cap". Audio plays degrees
literally (the contract's -4..4 steps), so LOVED sounds 4 pentatonic steps up (a sixth), not an octave. If an octave matters, the contract
range cannot carry it; nothing in audio folds.

## AU-07 (every existing seeded render unchanged): re-specified bar, with the reason
**Finding:** this Chromium's OfflineAudioContext renders are **not bit-exact run to run, even with unchanged code**. Measured at the baseline
(same code, same page, rendered twice): through the master chain up to **4.35e-5** (rare capsule; music bed 1.1e-5 to 2.1e-5), with no
limiter in the path (the engine's music and fx taps, dry voices) up to 1.16e-5 (most under 3e-8). So "bit-identical" (hash equality) fails on
the old code against itself. **AU-07's bar as built:** against the renders taken before any PLAYGROUND edit, max |difference| at most
**1e-4** through the chain (2.3x the largest same-code difference) and **5e-5** with no limiter in the path; an rng shift, a moved note or a
changed gain moves a render by 1e-3 or more. 19 renders: the real engine offline with music and every existing effect (mix / music / fx stems),
without music (mix / fx), the default seed's 40 s of music (mix / music), five voices through the chain and dry, a 40 s music bed and a rare
capsule ceremony (`au07Renders` in `life_checks.mjs`). Full renders kept in `_harness/_renders/life/au07_base/` (gitignored, this container);
`_harness/audioview/au07_baseline.json` keeps each render's 0.1 s block energies, so a fresh container can still check (1e-3 relative).

## Design notes (what is built and why)
- **Node budget, at most 4 a syllable (AU-11):** one voice group per PHRASE: head gain (the envelope) [+ panner] + one oscillator + the
  flavour's formant biquad. Foam's breath is a cached band-limited noise buffer (baked around 1.6 kHz) whose band is moved to 2f by
  `playbackRate`, so it needs no filter node; a piece's group voice is two oscillators (+-10 cents) and no formant; the echo is a second group
  (+220 ms, -12 dB, low-passed). Every syllable's envelope is one `setValueCurveAtTime` curve on the head (the purr's 28 Hz flutter and the beads'
  3 ms onset ticks live inside it); contours are `frequency` / `detune` automation. Persistent chatter nodes: 2 (the headroom gain and the duck).
- **Pitch:** whole = D5 x pitch snapped to D pentatonic in A4..D6; piece = D6 x pitch snapped in D6..D7, 7 dB quieter; spoken degrees are
  pentatonic steps from that note; every contour lands on its note (chirp rises into it, coo falls into it, trill climbs from it).
- **Headroom (AU-05, "peak at most one voice + 3 dB"):** the bus gain is planned from the phrases sounding together: wherever their amplitudes
  add up past 1.41 of one whole voice, the bus comes down by exactly that much, 12 ms before the new voice, and back after.
- **Ceremonies (AU-09):** a ceremony start (any `musicDuck`) fades every creature group; a phrase starting before the ceremony's end + 1 s is
  refused.
- **No engRng draw:** the PLAYGROUND kinds never call `accept()` (it draws engRng and the round-robin phase); `acceptPg` does the same
  bookkeeping with no draw, and every PLAYGROUND draw comes from `seed ^ 0x1b873593` (SALTS.chatter). None of the new kinds is in `KINDS`.
- **Tunes (D-81):** `TuneGate` (pure) keeps the Music Box to one start per 40 s, a second tap (`on: false`) stops it, the kettle never within a
  tune or 60 s after one, a box tap cuts a whistle. A tune starts on the next eighth of the music's own grid; the bed's melody rests meanwhile
  (`quietMelody`: notes inside are not built, the melody bus fades out 0.1 s and back 0.5 s; the pad plays on). The Music Box's tune is our own
  8-bar figure read in the scale of the field sounding at each note (built bar by bar by the engine's pump); the kettle's whistle is one bar on
  the field's rest tones (fifth, ninth, root), high up.
- **`musicClock`:** the bed keeps a ring of the last 8 planned bars (start time, field); `barAt(now)` gives the bar SOUNDING now, not the one
  the composer is planning.
- **Styles:** `setMusicStyle('cabin')` re-weights the field drift toward dusk and home and puts a 1.5 kHz low-pass on each mallet note; `home`
  is FIELD_NEXT and no filter (the node is only built for a style that asks), and pick() draws exactly one number whatever the weights.

## Port
5367 is held only while a `life_checks.mjs` run is going (one heavy job at a time); free otherwise.

## Other lanes seen
tsc errors at 10:53 and 11:30 in `src/render/emotes.ts` and `src/render/homekit.ts` (PG_RENDER's files, mid-edit); none in my files.

## Requests to other lanes (also in the summary)
- **Orchestrator (T1, `vite.config.ts`):** name the lazy chunk with facade `src/audio/life_voices.ts` (15.5 KB; it loads at the first unlock,
  used only once LIFE runs): sum it with the life chunk, or as its own named chunk. The away chunk already names `audio/ambience.ts`; the
  cabin chunk is `audio/places/hearthlog.ts` (imported by `ambience.ts`'s recipe map, one dynamic import per place).
- **PG_SHELL:** `setTouching` on each change of "the player is touching" (finger, grab, carry; never a lock alone); every `auto` land and
  body bump to `autoThud` (kind 0 / 1), every prop strike to `prop` with `auto = cause !== 0` (a held rocker / swing creak: `prop({ kind:
  creak, key: prop index, held: speed 0..1, auto })` every frame while it moves; the fire: `prop({ kind: crackle })` puffs the bed for 5 s);
  `sing: true` on SING, DUET and finale phrases; a piece's `pitch` x popSize(frac) and a cold place's x 2^(-1/12); `musicBox({ on: true,
  tune: 1 })` for the kettle (your seeded timer; audio refuses a start that breaks D-81); `loadAmbience('hearthlog')` when the cabin opens,
  then `setAmbience({ place: 'hearthlog', on: true })` on arrival and `{ place: null }` at Home, and `setMusicStyle('cabin')` / `'home'`;
  `setSettings({ chatter, ambience })` from the two new sliders (defaults 0.6 and 0.5).
- **PG_LIFE:** (1) LIFE's attention charges every syllable of a phrase at its start (`voiceOk`: `a.sylTok < nSyl`), so Sing together with 3
  singers x 4 notes = 12 starts against a burst of 6 (desktop) or 4 (phone) refuses the second singer; audio charges the densest second of a
  phrase (2 for a SING phrase) so it never blocks the three. (2) LOVED's degree 4 plays as 4 pentatonic steps (a sixth), not an octave.
- **PG_VERIFY (audio charter):** the first-listen checklist below; `node _harness/audioview/life_checks.mjs` (port 5367) and
  `node _harness/probe_chatter.ts`.

## First-listen checklist (nobody has heard any of this; for the verifier and the owner)
Play `_harness/_renders/` WAVs or the sound lab; better, the game with headphones and then a phone speaker. For each line: what it should
sound like, then what counts as WRONG.
- **The voices overall:** tiny, soft, wordless, sing-song; always in tune with the music (D major pentatonic). WRONG: words or speech-like
  vowels, anything that sounds like a bird, a cat, a mouse or any animal, a harsh buzz, a voice louder than a poke, a voice out of tune.
- **chirp** a short rising "pwip?" landing on its note. WRONG: a slide that ends sharp or flat, a click at the start.
- **coo** a soft falling "oo" that settles onto its note. WRONG: sad or moaning; too long.
- **purr** a flat, fluttering "rrr" (28 flutters a second). WRONG: a motorboat or engine; a real cat's purr.
- **hum** a steady "mmm" with a faint wobble (+-15 cents). WRONG: seasick wobble, a drone that sounds like a machine.
- **trill** three quick notes stepping up ("di-di-di"). WRONG: a bird trill, a doorbell.
- **yawn** a slow three-step fall with a breath. (LIFE does not plan it yet.) WRONG: a human yawn.
- **chitter** four quick falling blips. WRONG: a squirrel or insect.
- **peep** (pieces) a tiny high blip, a group of pieces as one slightly chorused blip. WRONG: N separate peeps at once, piercing.
- **Flavours** (the same phrase): gel clear and pure; sticky nasal ("nyee"); foam breathy and soft; beads grainy with a tiny rattle at
  the start; dough dark and round; firm bright with a little upward scoop. WRONG: two flavours you cannot tell apart; foam's breath louder
  than its tone; sticky shrill.
- **Echo** (Echo Hollow, later): one soft, darker repeat about a fifth of a second later. WRONG: two or more repeats, a metallic flanging.
- **Sing together:** each singer on a different note of the music's own chord, on its beat. WRONG: a clash with the music, singers out of
  time with the mallet's grid.
- **The touch duck:** while a finger is on a squishy the others' voices drop a little (6 dB) and slow down; back 0.6 s after letting go.
  WRONG: voices cut off dead; pumping.
- **During a capsule reveal or a merge:** no voices at all, and none for a second after. WRONG: any chatter over a ceremony.
- **The felt ball:** a soft muffled "thup" when struck, a faint brush while rolling. WRONG: a bouncy rubber ball, a basketball.
- **The Music Box:** a gentle high tinkling tune (8 bars, about 29 s) that fits the music; the music's own melody rests while it plays.
  A second tap stops it. WRONG: two melodies at once, a tune in a different key, clicks.
- **The kettle's whistle:** one bar (3.6 s): a soft breathy whistle rising onto a note, stepping up, settling, fading. WRONG: a shrill
  real-kettle scream, longer than one bar, more often than about once a minute.
- **Hearthlog Cabin ambience:** a low fireplace roar that breathes slowly, small dry crackles (a few a second, sometimes more), a log
  creaking now and then, a very quiet airy hush; well under the music. A tap on the fire: 5 s of livelier crackle and a slightly bigger
  roar. WRONG: rain-like hiss, a loop you can hear repeating, crackles like static or clicks in the speaker, birds, wind howling, anything
  louder than the music.
- **The rocker and swing creak:** a slow wooden creak that follows the motion and stops when it stops. WRONG: a door squeal, a creak that
  keeps going after the thing stopped.
- **Cabin music style:** more of the dusky and home chords, a softer, darker mallet. WRONG: a different key or tempo from Home.

## Not done in this run (S1 parts in my lane, and later)
- The cabin finale (two bars of everyone singing) is LIFE's phrases sent with `sing: true` (built and checked on a fixture, AU-08); the
  finale itself is the shell's and LIFE's. AU-08 from LIFE's real planner output waits for PG_LIFE's planner to feed it.
- (Done at 11:00: PROPS rows check the ball roll and creak dead-man, the auto variants' 3-a-second cap and that they never move the music.)
- S2 and S3 thing voices (chime, bell, splash, crunch, rustle, boing, tick, whoosh) and the other eight place recipes and styles.
- The Music Box tune has no pitch-on-key check of its own (it is built from the field's scale); the kettle's whistle has one (PROPS: D, A,
  E within 10 cents with the music off).
- AU-05's "2 live groups" is checked at the phone caps on the pure limiter (node); the engine itself runs the desktop backstop (3), because
  audio is never told the tier (LIFE's attention applies the phone caps).
- The yarn ball and the felt ball share one ball voice (`prop` carries no size).
- Nothing has been listened to. The first-listen checklist above is for the verifier and the owner.

---

# Round 2 (engineer 3, 2026-11-16; scope: S2 and S3 audio in my lane)
The cut-off round-2 engineer left nothing at HEAD 7efee6677 (no audio file, no report line changed since 8dc806641): I started from
round 1's state. Constraint for this run: no edit under src/physics, src/shell, src/ui, src/input or vite.config.ts (requests below).

## Round 2 status table (update after every step)
| Step | What | State |
|---|---|---|
| R2-1 | contract (PLAYGROUND audio block, additive, optional): `prop.size`, `creature.echoes`, `setAmbience.weather`; docs for the held kinds and the place key | DONE, tsc clean |
| R2-2 | music.ts: `MusicStyle` gains optional `tau`, `echo`, `thin` (absent = today's note: `home` unchanged); styles shore, ridge, garden, bath, bench, roof, hollow, cloud; ROOM_KINDS `thing` | WRITTEN, tsc clean |
| R2-3 | `src/audio/things.ts` (away chunk, re-exported by ambience.ts): chime, bell, splash, crunch, rustle, boing, tick, whoosh strikes + `heldNoise` (rustle / whoosh held, dead-man) | WRITTEN, tsc clean |
| R2-4 | ambience.ts: 8 new recipes in RECIPES, `AMB_ALIAS` (PlaceDef.ambience ids -> place ids), `AmbEnv.barAt` for recipes, `weather()`, helpers `layer`, `WeatherClock`, `patterCurve` | WRITTEN, tsc clean |
| R2-5 | places/ripple.ts, frostbell.ts, rainleaf.ts (S2), fizzwell.ts, cogwhistle.ts, lanternroof.ts, echohollow.ts, cloudloft.ts (S3) | WRITTEN, tsc clean |
| R2-6 | life_voices.ts: prop() routes every PROP_SOUND kind (strikes; rustle / whoosh held); tick on the music's eighth grid; `size` to the ball; `echoes: 2` second repeat; engine: away() exposes STRIKE / heldNoise, AmbHost.barAt, setAmbience weather | WRITTEN, tsc clean |
| R2-7 | props.ts ballBump: size sets pitch (0.22/r)^2 and length (felt 230 Hz, yarn 193 Hz) | WRITTEN, tsc clean |
| R2-8a | probe_chatter: 10 new rows (IDS: every PROP_SOUND kind has a voice, every thing sound in the place data has one, every place's ambience and music id resolve; PITCH: data notes D pentatonic, snap within a semitone; STYLE: 10 styles keep FIELD_NEXT's drifts, each favours its fields, home has no tau/echo/thin, ridge thins 34.9%; AMB: WeatherClock 9..14 s and the shell's 30 s lead, patter curve 213 ticks for 240 asked) | DONE: `node _harness/probe_chatter.ts` **42/42 ok** |
| R2-8b | life_checks.mjs `r2Checks`: THINGS (7 rows), ECHO (1) | DONE 1st run: **9/9 PASS** (THINGS, ECHO, page), port 5367 freed. The auto-budget row then rewritten to count admitted strikes from the engine's throttle counter (onsets cannot be counted under 2.5 s bell rings: the first version measured 2 onsets, a meaningless pass) |
| R2-8c | `--only=BOX,STYLE2,THINGS` run: **12/12 PASS** (STYLE2: home set explicitly diff 1.86e-7; the 8 styles -0.9..+1.1 dB of home's level, peaks -18.1..-15.3 dBFS; THINGS auto budget 50 of 320 admitted). BOX found a real bug: the Music Box tune clamped steps +2 and +3 onto D7 (bars 2 and 4: 93 98 98 98 95). **Fixed** in props.ts (anchor E6 instead of A6), and BOX now also checks the written contour and, with the music on from 30 s, each note against the scale of the field musicClock says is sounding | DONE |
| R2-8d | `--only=BOX,AMB2,AU-03` run 1: **11/19**. PASS: BOX 3/3 after the fix (25 notes on D pentatonic, contour as written; music on from 30 s over fields 0 and 2, every note in its field's scale), the weather rows (Frostbell gust +21.4 dB, Rainleaf shower off -11.3 dB), AU-03 ripple (12.2 dB / 12.8 LU) and rainleaf (32.1 / 16.6), the cabin AU-03. Every bed is 14.3..23.3 dB under the music (RMS) and audible (-45.3..-54.3 dBFS). FAIL: 7 beds' node count (+17..+31 against a bar of 14) and AU-03 over Frostbell (K 8.5 LU, toss, in a gust) | DONE |
| R2-8e | fixes: (1) the node rows were partly the harness: the page's node counters are module-wide and a render that ends with sources still scheduled leaves its count behind (a scratch run showed cloudloft at a constant 9 nodes for 225 samples, where the row said +17), so each bed is now measured against a no-bed run made right before it (same bar, 14); (2) a real excess: drips, pops and the shore's fizz made 2 nodes a bubble 0.4 s ahead (ripple peaked at +21..+31): they now share one `BubbleChannel` per bed (1 oscillator + 1 gain for the bed's life, each bubble an automation); the bench's rare spring is 2 nodes instead of a 6-node boing; (3) Frostbell gust peak -21 -> -25 dB (AU-03 K) | WRITTEN, tsc clean |
| R2-8f | re-run `--only=AMB2`: **14/14 PASS**. Beds under the music (RMS / K): ripple -15.4/-14.8, frostbell -20.3/-17.4, rainleaf -21.3/-17.8, fizzwell -19.3/-18.7, cogwhistle -23.5/-25.1, lanternroof -14.3/-13.8, echohollow -19.8/-20.2, cloudloft -17.9/-15.1 dB (bar -6); bed levels -45.3..-54.5 dBFS RMS; nodes over the no-bed run +9..+14 (lanternroof +14 = 9 steady + a 5-node paper rustle; bar 14). Frostbell follows the shell's gust +17.3 dB; Rainleaf shower off -11.3 dB. AU-03 over the S2 beds (18 placements each, weather on at 6 and 20 s): ripple 12.2 dB / 12.8 LU, rainleaf 32.3 / 16.6, frostbell 17.0 / 12.6 | DONE |
| R2-9 | full `probe_audio.mjs --port=5367` regression | running (port 5367 held) |
| R2-9 | full `probe_audio.mjs --port=5367` | pending |

## Round 2 sizes (14.3 one-file rolldown, minified ES, imports external; `scratchpad/pg_audio/size.mjs`; measured after R2-7)
(Re-measured after R2-8e: ambience.ts 7 142 (+680, BubbleChannel), so the away chunk's audio is 12.4 KB; places/ripple 1 000, rainleaf 804,
fizzwell 883, cogwhistle 1 389 (its own 2-node spring), echohollow 614; engine, music, life voices unchanged.)
| Module | Bytes | Chunk |
|---|---|---|
| engine.ts | 16 560 (HEAD-before-PLAYGROUND 13 641, +2 919; round 1 +2 766) | first load |
| chain.ts | 2 462 (+468, unchanged this round) | first load |
| music.ts | 17 425 (+2 471; round 1 +1 314: the 8 styles and tau / echo / thin add 1.16 KB) | first load |
| **first-load share** | **5 858 B = 5.7 KB of the 8 KB cap** (round 1: 4.4 KB) | |
| life_voices.ts 5 793 (+808: the thing routing, the held kinds, echoes), creature.ts 6 048, props.ts 4 982 | **16.8 KB** | the life voices lazy chunk (T1 must name it; round 1's request stands) |
| ambience.ts 6 462 (+1 786: 8 recipe entries, AMB_ALIAS, weather, helpers) + things.ts 5 222 (new) | **11.7 KB** of the away chunk's 90 (with render's 7.9 KB: 19.6 KB) | away |
| places/ripple 975, frostbell 1 200, rainleaf 779, fizzwell 858, cogwhistle 889, lanternroof 784, echohollow 588, cloudloft 739 | 0.6..1.2 KB each | each place's own chunk (budget 4 to 6 KB: under it; the shared pieces live in the away chunk) |

## Round 2 contract additions (src/contracts.ts PLAYGROUND audio block; additive, optional; tsc clean)
- `prop(p).size?`: the thing's size in m (a ball its radius, THINGS size[0]): felt ball 0.22 -> 230 Hz, yarn ball 0.24 -> 193 Hz (pitch
  (0.22 / r)^2, body length (r / 0.22)^2): measured 234 / 196 Hz, 3.07 semitones apart. The doc also names the held kinds (ball roll, creak,
  rustle, whoosh with `key` + `held`); every other kind is a strike.
- `creature(p).echoes?`: 2 while the Echo Stone is on (PLACES 4.9 "every voice echoes twice"): a second scheduled repeat at +440 ms, 12 dB
  under the first (measured 440.2 ms, -12.0 dB); no DelayNode. The backstop counts such a phrase as 2 voices (one echo: 1.5).
- `setAmbience(p).weather?`: 0..1, the place's weather event starting now (a Wind Gap gust, a Surf Edge wave, the Rainleaf shower on 1 /
  off 0, the Fizzwell Tap running 1 / off 0, a Lanternroof or Cloudloft gust). Without it each recipe keeps its own seeded timer (the
  physics everyS ranges from the place data); after one, the shell leads for 30 s. The place key may be the place id or PlaceDef.ambience.

## Round 2 requests to other lanes (I may not edit src/shell, src/physics, src/ui, src/input, vite.config.ts this run)
- **PG_SHELL:** (1) `prop({ ..., size: thing.size[0] })` for every ball (felt, yarn, pebble, cloud, steel marble) so balls sound apart;
  (2) every `drainStrikes` quad to `prop({ kind: thing.sound, intensity, note: thing.notes[part], auto: cause !== 0, pan })` (chimes, bells,
  crystals: `note` = that part's MIDI note; pads: kind boing); (3) held motion every frame while it moves: the Shake Pine `prop({ kind: 11
  rustle, key: prop, held: speed 0..1 })`, the slides and rides (Glide Ramp, Soap Slide, Stone Slide, Swirl Ride, Updraft) `prop({ kind: 12
  whoosh, key, held })`; a splash on each water entry `prop({ kind: 4 })`, a snow print `prop({ kind: 5 crunch, auto: true })`; the cogs
  and the wind-up key `prop({ kind: 9 tick })` (audio puts it on the music's eighth grid); (4) `setAmbience({ weather })` when physics starts
  a gust or a wave, and 1 / 0 when the Rainleaf shower or the Fizzwell Tap turns on / off; (5) `creature({ echo: true, echoes: 2 })` while
  the Echo Stone's 20 s run, `echo: true` everywhere else in Echo Hollow; (6) `loadAmbience(place.id)` (or place.ambience) when the place
  opens, `setMusicStyle(place.music)` on arrival; (7) a cold place's voice pitch x 2^(-1/12) (Frostbell) as round 1 said.
- **PG_PHYSICS:** nothing new needed; `drainStrikes` causes 0 / 1 / 2 are what audio's budget keys on. If a gust or a wave start could be
  read (an event or a phase), the shell can forward it as `weather`.
- **Orchestrator (T1, vite.config.ts):** name the life voices chunk (16.8 KB now) as round 1 asked; the away chunk now holds
  `audio/things.ts` too (imported by `audio/ambience.ts`); the eight new `audio/places/<id>.ts` are one dynamic import each from
  `ambience.ts` and belong with their place chunk.

## First-listen checklist, round 2 additions (nobody has heard any of these; for the verifier and the owner)
- **chime** (Shell Chimes D5 E5 F#5 A5 B5; Singing Crystals): a clear, glassy "ting" ringing about 1.5 s, a slightly metallic overtone
  that dies first. WRONG: out of tune with the music, a doorbell, a hard click at the strike.
- **bell** (Icicle Bells A4 D5 E5 A5; the Little Bell): rounder and longer than the chime (about 2.5 s), softly bright. WRONG: a church
  bell, a sour (minor-third) bell colour, a ring that sounds after the music has moved on for many seconds.
- **splash**: a short watery "splsh" falling in pitch, then a few tiny bubble blips. WRONG: a toilet flush, white-noise hiss, a long tail.
- **crunch**: dry snow under a step, 0.1..0.2 s of small grains. WRONG: gravel, paper crumpling, a click train.
- **rustle**: leaves or a pine branch shaken, a high soft flutter; held while the Shake Pine shakes, stopping when it stops. WRONG: radio
  static, a steady hiss, a creature scurrying.
- **boing**: a soft low spring "boing" that dips and wobbles back, with a little puff of air. WRONG: a cartoon sproing, a buzzy twang.
- **tick**: a small clean clock tick, alternating tick / tock, landing on the music's beat. WRONG: a metronome beep, a tick off the beat.
- **whoosh**: air rising and falling over about a second; held, following a slide or a ride. WRONG: a jet, a sweep that sounds synthetic.
- **The felt ball and the yarn ball:** both soft thuds; the yarn ball a little lower and fuller. WRONG: indistinguishable, rubbery.
- **The Echo Stone:** for 20 s each voice comes back twice, the second softer and darker. WRONG: more than two repeats, flanging.
- **Music Box tune (fixed this round):** the tune sits around E6 now and keeps its shape (round 1's version repeated its top note D7
  in bars 2 and 4). WRONG: a phrase stuck on one high note.
- **Ripple Shore:** slow low surf, a wave every 7..10 s, a faint fizz as it draws back, a quiet wandering breeze. No gulls. WRONG: a
  storm, a loop you can hear, any bird.
- **Frostbell Ridge:** near silence with a faint high air, a gust every 9..14 s, rarely a far, soft bell note. WRONG: a howling wind, a
  constant hiss, the far bell out of key.
- **Rainleaf Garden:** dense soft rain patter, drips like small bubbles, a leaf rustle; the patter fades when the shower stops (on 40 s,
  off 30 s). WRONG: frying-pan sizzle, frogs, a hiss with no texture.
- **Fizzwell Tub:** soft lapping, bubble pops; the Tap's stream only while it runs. WRONG: a bathroom echo, a drain gurgle.
- **Cogwhistle Bench:** a soft clock ticking on the music's beat, a faint lamp hum on low D, a rare soft spring. WRONG: a hum that buzzes
  or beats against the music, ticks drifting off the beat.
- **Lanternroof:** night gusts, paper lanterns rustling with them, a very low far city hum. WRONG: cars, horns, sirens, a rumble that
  sounds like traffic.
- **Echo Hollow:** drips with two echoes each, a very quiet cave tone on D. WRONG: a drone louder than the drips, a metallic echo.
- **Cloudloft:** a high, soft wind and slow whooshes. WRONG: a gale, a jet.
- **Music styles:** shore and cloud lighter (more lift / glow chords), ridge sparser (about a third of the mallet notes rest), garden
  homely, bath rounder (a softer top), bench drier (no mallet echo, shorter), roof soft and dusky, hollow long tails and a fuller echo.
  WRONG: any key or tempo other than Home's (D, 66 BPM), a style you cannot tell from Home after a minute.
