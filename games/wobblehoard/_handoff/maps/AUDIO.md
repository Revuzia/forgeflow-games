# SEAM MAP: AUDIO lane for PLAYGROUND (read-only analysis, 2026-11-15)

Scope read: every file in `src/audio/` (engine, chain, dsp, voices (skimmed past poke), ceremony (skimmed), music, interact, cut),
`src/contracts.ts` 201-284 (SquishAudio) and the Settings block (~425-445), `src/core/genome.ts` 140-144 (`pitchRatio`),
`src/core/settings.ts` 93-109, `_spec/SOUND.md` (master chain, engine behaviour, round 3, room, audio-4, CUT, known issues),
`_harness/probe_audio.mjs` (head), `_harness/audioview/engine_offline.js`, `room_checks.mjs`, `play_scenarios.mjs` (heads),
`cut_checks.mjs` (check list). Nothing was built, run or listened to. No shell file was touched.

## Summary

- One AudioContext, made inside `unlock()` (engine.ts:383-397). Three inputs, `boost` / `plain` / `music`, feed one stereo bus,
  then a 20 Hz high-pass, a safety limiter (release 12 ms), a soft clip at -1 dBFS, a duck gain, the master gain and an analyser
  (chain.ts:46-76). Every voice is a pure `(ctx, out, t0, params)` function with a seeded rng, so live and offline renders match.
- The music bed is in D major / G lydian (one collection: D E F# G A B C#), 66 BPM, four fields (home, lift, dusk, glow), each held
  8/12/16 bars (music.ts:21, 258-272). From outside you can read the field index only through the harness readout
  `detailStats().music.field` (engine.ts:735). That index is the field the composer is PLANNING, up to about one bar (3.6 s) ahead of
  what you hear (music.ts:717). Every pitch in D major pentatonic (D E F# A B) is safe over all four fields.
- Every effect voice calls `registerFx`, which makes the music "make room": melody -24 dB, pad -17.3 dB, held until 4.5 s after the
  effect ends, then a 2 s fade back (music.ts:61-101, engine.ts:216-219). **That is the main trap for PLAYGROUND.** If autonomous
  chatter, ambience events or prop sounds go through `registerFx`, the music is never heard again while squishies are awake. Kinds
  that are not in `ROOM_KINDS` (music.ts:129-134) get no dip, so a new kind is opt-in. It is safe by default.
- Voices are fairly heavy: about 15-25 nodes and about 0.5 ms of main-thread time per trigger (SOUND.md 1109). The cheapest reliable
  creature syllable is one oscillator with a cached `PeriodicWave` per family, one envelope gain and one panner (3-4 nodes, pitch
  contour by automation). A shared group voice adds one detuned oscillator.
- There is no ambience bus, no place concept, no chatter bus or setting, no per-voice spatial model (only `pan`), one shared
  `BumpLimiter`, one shared strand voice, and no lazy loading (engine.ts imports every voice module statically, 13-21).
- Nobody has listened to anything (SOUND.md 3-10). Every "cute" or "wet" is a design intent. The harness has the tools to gate new
  voices the same way the effects were gated: in-band, K-weighted, exposure, and pumping against the music alone.

## 1. Buses, master chain, music, room dip, limiters, mute / pause / unlock

**Chain** (chain.ts:46-76): `boost` (poke, squish, release; "louder squish" up to +9 dB, chain.ts:12-16) and `plain` (everything
else, ceremonies, round 3, cut) and `music` (gain `musicGain(v)`: 0.45 = 0 dB, 0.225 = -12 dB, 1 = +6 dB, chain.ts:19-25) go into
`bus` (explicitly stereo, 74), then `hp` 20 Hz, then a compressor (thr -6, knee 6, ratio 12, att 2 ms, rel 12 ms, 59), then a
soft clip (ceiling 0.89, 2x oversample, 60-62), then `duckG` (`duck(db, ms)`, att tc 18 ms, rel tc 70 ms, 97-106), then `master`
(squared taper, 0 when muted, 15, 84), then the analyser (fftSize 32768, 65-67), then the destination. The chain has 10 nodes. Order
matters to the harness: `engine_offline.js:42` labels the FIRST THREE `createGain()` calls as boost / plain / music. Any new input
gain must be created after `music`, and the harness must tap it by its own index (the 4th gain today is `bus`, chain.ts:52).

**Music** (music.ts): `Composer` (324-452) is pure and seeded (seed = engine seed ^ 0x2f6b3c1d, engine.ts:91). The same composer
lives for the whole engine, so the piece continues across music on/off. Fields: home D add9 (D4 A4 E5) with D major pentatonic;
lift Gmaj7 (G4 B4 F#5) with G lydian minus the 4th; dusk Bm/F# (F#4 B4 D5) with B minor pentatonic; glow Asus2/E (E4 A4 B4) with A
major pentatonic (258-263). Drift weights 265-270. The mallet plays from A4 to D6 (440-1175 Hz, MEL_LO/HI 204-205). Nothing goes
below D4 (294 Hz): 60-290 Hz is kept for the squishies' bodies (202-203). Two-bar call/answer phrases on an eighth grid, swing 0.045
(25-27, 286-288). Levels: pad -28.8, mallet -12.5, bubble -21.5 dB, long-term about -29 dBFS at music 0.45 (209-216). `MusicBed`
(605-912) schedules 0.4 s ahead from a 100 ms timer (33-34, engine.ts:138-183), caps itself at 6 live notes (2 kept for pads,
30-31, 753) and has its own bus: room dips then duck, fade-in 2.5 s, fade-out 1.4 s, pause fade 0.15 s (648-676).
`MusicBedOptions.pitch` (599) can retune the whole score, but the engine never passes it (engine.ts:157). Tempo and fields are module
constants, with no style parameter.

**Two ways the music steps back.** (a) A slow duck of -9 dB (att tc 0.12, rel tc 0.5; music.ts:41-43, 779-794), keyed by the
ceremonies (`musicDuck`, engine.ts:187-193; capsule 534, reveal 551, merge 568, 582). (b) The room dip `makeRoom` (807-871), keyed by
every one-shot through `registerFx` (engine.ts:216) using `oneShotRoom` (music.ts:178-184), and by the held squish and strand per
update (`squishRoom` / `strandRoom`, 191-197; engine.ts:449, 680). The deepest active hold wins (a staircase). The return is
dB-linear at 12 dB/s. The dip deepens by the music boost above default (`roomDb` 156-159, `roomPadShare` 76-79). Fast kinds that
reach music that is "up" start 12 ms later (24 ms at music 1) so the dip clears first (`roomClearDelay` 115-126, engine.ts:317).
Slow-onset voices declare `onset` and the dip waits for it (dsp.ts:118-120, interact.ts:173).

**Caps and limiters.** `MAX_VOICES` 24 live groups, plus up to 40 alive counting voices that are fading out (engine.ts:23-25). The
steal order is lowest `priority` first, then oldest (56, 253-271): one-shots 0 < held squish 1 < ceremonies 2 (ceremony.ts:444,
644, 690). `BumpLimiter` (interact.ts:90-123): ignores intensity < 0.04, gap 60 ms unless 1.6x harder, a bucket of 4 refilled at
6/s, softening 1/(1+0.35n) over 0.5 s. One global instance (engine.ts:105). `CutLimiter` (cut.ts:509-538): slice / pop gap 0.1 /
0.06 s, cap 3, refill 1.5/s; rejoin cap 3, refill 3/s; whole-again once per 0.6 s. Capsule grab: once per 70 ms (engine.ts:517-520).
Strand: one held voice per engine, updates thinned to one per 8 ms (107, 674-677). Music restarts once per 300 ms at most, and at
most 6 sessions can be retiring (42-44).

**Mute, pause, unlock.** Before `unlock()` every call is a no-op and adds 1 to `dropped` (306-308). `unlock()` creates the context,
`resume()`s it and plays a silent buffer synchronously inside the gesture. It never waits for resume() longer than 1.2 s, and a
second call kicks resume again (gestureKick, 376-406). An iOS `audioSession` is 'playback', or 'ambient' while muted (348-356).
Muted: `accept()` counts the call and returns null (310), `setSettings` kills every live group in 30 ms (415), and the music retires
(116, 143-148). `setPaused(true)`: the music fades in 0.15 s, then everything is freed and the context is suspended (768-798). A
trigger while the context is not running is dropped and kicks `resume()` at most 4 times a second (293-299). **Any new continuous
source (ambience, held chatter) must join `freeAll` / `freeMusic` on pause and on mute**, or it keeps running after the 'ended'
events stop arriving (SOUND.md 84-93).

## 2. An ambience bed per place

**What exists.** A seeded 2.5 s noise buffer, looped at a random offset per source (dsp.ts:47-60, 200-207). The Minnaert `bubble`
(297-325). Tick trains like the lift peel and the cut grains (`rexp` Poisson, interact.ts:142-150; dsp.ts:24). Breathing gain
schedules like the pad's (music.ts:493-503). A lookahead scheduler pattern (MusicBed.advance, 714-742).

**What to add.** (1) An `ambience` input gain in chain.ts, created after `music` (see the harness note in section 1). It goes through
the same limiter, mute and master. (2) A new `src/audio/ambience.ts` with an `AmbienceBed` class shaped like `MusicBed`: its own bus
(fade in 3-4 s, fade out, pause fade, an optional shallow room gain), one or two continuous noise layers plus a seeded event layer
scheduled by the same 100 ms tick. Put the place recipes in lazily imported modules (`src/audio/places/<id>.ts`, `import()` from the
engine, so Vite splits them; D5). (3) An optional, additive `setAmbience?(p: { place?: string; on?: boolean; volume?: number })`.
Pick the place by id, and do the crossfade on travel inside the engine (about 2 s).

**Recipes with existing blocks.** Surf: low-passed noise (300-900 Hz) under a slow swell envelope (a wave every 6-11 s, seeded),
plus a fizz of tiny bubbles (radius 0.4-1 mm) as each wave pulls back. Sea wind: a band-passed noise whose centre wanders on a
0.05-0.1 Hz sine. Mountain wind: a wider, higher band (600-2500 Hz) in gusts. Snow hush: very little. Lower everything and add a
high, quiet shelf, mostly silence. Fire crackle: Poisson clicks (2-3 ms band-passed noise like strandSnap's click, interact.ts:347-355)
at 3-12/s, plus rare pops. Night forest: a dark wind bed and a slow seeded creak. Crickets or birds would be animal sounds. D10 bans
new animal characters, so a designer must decide (open question 4).

**How it relates to the music.** Layer it, do not replace the music. The ambience sits under the music and has its own volume (or
shares `music`, open question 2). Keep the D collection in every place. Retuning with `MusicBedOptions.pitch` would put the
ceremonies' fixed tunings (ceremony.ts:35-37) and the whole-again run (`REJOIN_RUN`, cut.ts:400) out of key. Vary the place's mood by
field weights, tempo and mallet timbre instead. That needs a `MusicStyle` argument to Composer and MusicBed, and the default must stay
bit-identical, or the determinism and repetition checks break. **The room dip:** ambience is broadband and continuous, so it masks the
effects in their own bands just as the pad did. Either give it its own shallow dip, keyed by the same requests (for example -6 dB for
the noise layers, events suppressed while dipped), or keep it at least about 20 dB under the effects' in-band levels and gate it with
`separation()`. It must never ask for room itself.

**Cost.** About 6-12 nodes for the continuous layers, plus 2 nodes per event bubble or click. Scheduling would cost about what the
music's tick costs (0.031 ms mean, SOUND.md 640). Risk: a 2.5 s noise loop can be heard as a repeat in a slow, steady wind. Use two
sources at different `playbackRate`s, or a longer per-place buffer built once at unlock (one-time CPU cost, about 1 MB at 48 kHz per
5 s mono).

## 3. Small creature voices

**Pitch.** `pitchRatio(genome)` (genome.ts:140-144) = 2^(semis/12), where semis = -(size-0.5)*7 + (firmness-0.5)*4 + ±0.75 random.
So the ratio runs from about 0.70 to 1.43, the range every voice already clamps to 0.5-2 (voices.ts:28-32). The shell passes it today
(shell/feedback.ts:77, shell/cut.ts:220). For a voice "in key": take a base note (for example A5 880 Hz for a whole squishy), multiply
by the ratio, and snap the result to the nearest D major pentatonic note in the target register. That is safe over every field (see
the summary), and `REJOIN_RUN` already does it (cut.ts:400). Pieces: go up by `popSize(frac)` = (0.5/frac)^0.4 (cut.ts:129), x1.74 for
a 1/8 piece, then snap. That puts pieces at 1.2-2.4 kHz, above the mallet's top note (D6 1175 Hz), which is the same trick as the
snap's blip (interact.ts:356-357). Pieces also sit 6-8 dB quieter.

**Timbre by family.** Reuse `FAMILY_FLAVOUR` / `cutFlavour` (cut.ts:35-50), which maps 12 families onto 6 flavours. Each flavour gets
one cached `harmonicWave` (dsp.ts:63-74) plus one formant biquad. Gel: clear, few harmonics. Sticky: nasal, with a narrow band. Foam:
low-passed and breathy (noise mix). Beads: a granular tick onset. Dough: dark. Firm: bright and squeaky.

**Syllables** (no words, D3). A syllable is a 60-250 ms pitch contour on one oscillator: chirp (a rise), coo (a fall), purr (a 25-35
Hz amplitude flutter), hum (flat with a light vibrato), trill (2-4 fast notes). A phrase is 1-4 syllables drawn from a per-species
seeded rng. Call and response: the answer reuses the call's rhythm with its contour mirrored, the way the composer already writes
answers (music.ts:393-401). LIFE (or the shell) passes `{speaker, replyTo?}`, and audio stays stateless apart from its limiter.
Harmony: several voices "singing" take notes from the current field's `rest` tones (music.ts:247), quantised to the music's eighth grid
(`SLOT_S`, music.ts:25). That needs a new read-only accessor, `musicClock?(): { field, barT0, bpm } | null`, giving the field that is
SOUNDING at currentTime. Today's `detailStats` field runs ahead (section 1). A group voice for N pieces is one voice with 2-3 detuned
oscillators (±8-15 cents) at the level of one piece + 2 dB. It is never N voices.

**Budget (where it lives).** The global attention budget (D4) belongs to LIFE or the shell, which choose who speaks. Audio keeps a
hard backstop, a pure `ChatterLimiter` shaped like `BumpLimiter`, tested with synthetic time. Starting numbers for the designers: at
most 2 creature voices at once (1 when Calm), at most 3 syllable starts per second (1.5 when Calm), pieces softened 1/(1+0.35n) like
bumps. Add a `priority` of -1 so chatter is always stolen before a player's poke (engine.ts:56 accepts negatives). Chatter must NOT go
through `registerFx` (leave its kind out of `ROOM_KINDS`). The music stays up and the voices sit beside it in key. Volume: a 4th or 5th
chain input `chatter`. Add an optional `AudioSettings.chatter` and `Settings.chatter`. Settings and storage are not in the audio lane:
core/settings.ts:108-109 needs the key and a units entry. New kinds must take their round-robin phase from a separate rng stream, as
the CUT kinds do (engine.ts:82-85). Adding them to `KINDS` and drawing from `engRng` would shift every existing seed and break the
bit-exact renders. Better still, give chatter its own rng for every draw, because `accept()` draws `engRng` once per call (312).

## 4. Prop sounds from existing blocks

| Prop | Recipe from what exists | New code |
|---|---|---|
| Bouncing ball | `bump` / `land` body (a pitch-gliding plucked harmonic wave, interact.ts:49-65) with a higher, rubbery pitch and a short noise slap | `ball(ctx,out,t0,{intensity,size})` plus its own `BumpLimiter` instance (a resting ball calls per contact) |
| Creaking seesaw | `strand`: a stick-slip pulse striking a resonance, held, with dead-man switches (interact.ts:253-334) at a lower mode (300-700 Hz) | a second held voice keyed by prop id. The engine holds ONE strand (engine.ts:107), so it needs a map of held props |
| Chimes | ceremony `CHIME` / `BELL` partials (ceremony.ts:270-271) with the `note()` helper, tuned to D pentatonic like `REJOIN_RUN` | `chime(...,{note})`. Wind-driven chimes belong to the ambience event layer |
| Splash | a burst of bubbles (`bubble`, dsp.ts:297) plus band-passed noise falling in pitch (like bump's slap, interact.ts:67-74) | `splash(...,{size,depth})`. A water zone can repeat small ones (rate-limited) |
| Snow crunch | the lift peel's Poisson micro-ticks (interact.ts:142-150), low-passed and denser; the beads crunch in cut.ts (`crunch: 16`, cut.ts:84) | `crunch(...,{weight})`. Called per step or landing, through a limiter |
| Fire pop | strandSnap's click and blip (interact.ts:347-364) plus 1-2 sparks (tiny high bubbles) | in the ambience event layer, plus a louder one-shot when a squishy toasts |
| Music box | `mallet()` (music.ts:519-558) up an octave with CHIME partials, notes from the current field | `musicBox` voice. While it plays it should take over the melody (ask the bed to mute its mallets, or play on the bed's own bus) so two melodies never clash |

Room: a sound the player triggers (they kicked the ball, opened the music box) may use `registerFx`. A prop moving by itself (wind
chimes, a ball rolling after a squishy's hop) must not, or the music stays down.

## 5. CPU cost, node counts, the cheapest phone voice, harness gating

**Today (measured, SOUND.md).** About 15-25 nodes and about 0.5 ms main thread per trigger (1109). Master chain 10 nodes. Pad 19
nodes. Music live nodes max 116 over 600 s, music tick mean 0.031 ms (640). A held squish at a high rate makes up to about 95
two-node bubbles a second (1110). Blend 8 s x 8: 34 nodes in the call; Mythic reveal 36; Legendary merge 65 (108, 650-651). A leak test of
5000 triggers returns to 10 nodes (645). NOT measured: audio-thread (render) cost, any phone, any browser but Chromium 141. Playout glitch
checks are load-sensitive here, and headless playout uses a null sink (1107).

**Cheapest reliable voice on a phone.** One `OscillatorNode` with a cached `PeriodicWave` (built once per context per family,
dsp.ts:63), one envelope `GainNode`, an optional formant `BiquadFilter`, and a panner only if the voice is off centre (`Bag` adds one
only then, dsp.ts:159). Contours and vibrato go into `frequency`/`detune` automation (`setTargetAtTime`, `setValueCurveAtTime`),
never extra LFO nodes. Free nodes on 'ended' through `Bag`. 3-4 nodes and one source per syllable, against 15-25 for an effect. No
DelayNode or ConvolverNode (a DelayNode echo made renders irreproducible, SOUND.md 657-660). At the 2 voices / 3 syllables per second
cap that is under 10 extra live nodes.

**How the harness gates.** `engine_offline.js` runs the REAL engine on an OfflineAudioContext with its timers locked to the audio clock,
scripted `events: [{t, op, a}]`, and returns stems `mix` / `music` / `fx` (engine_offline.js:28-100). `room_checks.mjs` measures:
`separation()` (in-band over the 1/3-octave bands that hold 70% of the effect's energy, >= 8 dB; K-weighted over the effect's loudest
20 ms frames, >= 10 LU; A-weighted reported, 67-95), `exposure()` (the music >= 8 dB down at most 40 ms before the effect, 97-108),
`pumpMetrics()` (the music stem's gain over the music alone: std <= 3 dB, 1 s loudness change p90 <= the music alone's, back within
1 dB <= 8 s, 110-143, gates at 187-189). Scenarios are seeded (play_scenarios.mjs:78-148). `cut_checks.mjs` shows the per-voice
pattern: peak -20..-1 dBFS, no click (step < 0.25), tail < -60 dBFS, > 6 kHz < 15%, flavours pairwise >= 3 dB apart, calm >= 2.5 dB
softer, the limiter pure and through the engine (111-300). **For chatter, flip the roles:** (a) a player effect over chatter, in-band
>= 8 dB (chatter must never mask touch); (b) the music stem with chatter running: pumping metrics unchanged (proves it does not ask
for room); (c) a chatter stem (a new tap) under the music's long-term RMS by a set margin, pitch on a D pentatonic note within ±10
cents (the bubble-tuning check exists in music_checks); (d) a storm: 10 squishies and 30 pieces asking for 50 syllables/s gives
<= 2 live chatter groups and the peak <= one voice + 3 dB.

## Extension points

| What to add | Where | How hard | Risk |
|---|---|---|---|
| `ambience` (and `chatter`) input gains | chain.ts:49-51, `MasterChain` 27-44, `apply` 82-96 | small | harness tap order (engine_offline.js:42); default output must stay bit-identical |
| `AmbienceBed` + lazily loaded place recipes | new `src/audio/ambience.ts`, `src/audio/places/*.ts`; engine timer 138-183 | medium-large | loop repetition; masking effects; pause and mute cleanup |
| `setAmbience?`, `voice?`/`chatter?`, `prop?` members, `musicClock?` | `src/contracts.ts` SquishAudio (additive, optional) | small (contract), owned by the synthesizer | naming churn across lanes |
| Creature voice synthesis (syllables, flavours, snapping to key) | new `src/audio/creature.ts`, reusing cut.ts:35-50, dsp.ts:63 | medium | unheard "cuteness"; mid-range overlap with the mallet |
| `ChatterLimiter` + priority -1 + a group voice | creature.ts + engine.ts (accept 306-319, steal 253-271) | small-medium | double budgeting with LIFE; a starved player sound if the priority is wrong |
| A separate rng stream for the new kinds | engine.ts:79-85 | small | forgetting it shifts every seed and fails the determinism checks |
| Field "sounding now" accessor | music.ts (log `fieldLog` 334 against bar time) + engine | small | off by one bar at field changes |
| `MusicStyle` per place (tempo, field weights, timbre) | music.ts constants 21-27, 265-272 into constructor args | medium | default path must stay identical; probe constants quoted in SOUND.md |
| Prop voices (ball, creak, chime, splash, crunch, pop, music box) | new `src/audio/props.ts`; held-prop map in engine | medium | room dip on autonomous props; a creak needs its own dead-man |
| Chatter / ambience settings | core/settings.ts:93-109 (not the audio lane) | small | the storage migration rule (`wobblehoard:v1:*`) |
| Harness: chatter and ambience stems + new gates | engine_offline.js, room_checks.mjs, a new `life_checks.mjs` | medium | heavy runs (10-30 min); load-sensitive live checks |

## Constraints and numbers

- Effects stand >= 8 dB in-band and >= 10 LU K-weighted above the music on every isolated placement (room_checks.mjs:241-242).
  Pumping: std <= 3 dB (187). Exposure <= 40 ms for fast kinds (251). Any new kind that enters `ROOM_KINDS` must pass all of these.
- The output ceiling is -1 dBFS (soft clip 0.89). Voice dry peaks are about -17 to -4 dBFS. Music about -29 dBFS long-term at 0.45.
- Registers: bodies 60-290 Hz; pad 294-740 Hz; mallet 440-1175 Hz; effects' key band 0.4-2.4 kHz (music.ts:62-63); snap blip >= 1150
  Hz. Creature voices for whole squishies will overlap the mallet. Pieces above 1.2 kHz avoid it.
- Polyphony 24 / 40 alive; music 6 live notes; bump 4 burst, 6/s; cut 3 burst, 1.5/s; grab 1 per 70 ms; strand one voice.
- Determinism: same seed means the same session (createAudio seed default 0x57a15b00). Live and offline must match to <= 2e-5.
- Unlock only in a gesture. Before that, every call is counted as `dropped`. Autonomous chatter before the first tap inflates
  `stats().dropped` (harmless, but probes that read `dropped` will see it).
- Zero samples, no DelayNode echo, seeded noise only, no `Math.random` (SOUND.md 11-14).
- Doc drift: SOUND.md:998 still says `cut`/`rejoin` take no `pitch`, but the contract has had it since then (contracts.ts:273, 276)
  and cut_checks checks it (200).

## 6. Known open audio items and risks

- **Nothing has been heard** (SOUND.md 3-10). Not the music, not the room dips, not the audio-4 hold, not the cut voices. The first
  listen checklists are at SOUND.md 1017-1100. New creature voices would be the first sounds whose whole point is charm, and that
  cannot be measured.
- **The room hold design**: while the player plays, the melody sits at -24 dB and only the pad remains (SOUND.md 1126, 1193). With
  PLAYGROUND, play is near-constant, so the music is effectively a pad unless autonomous sounds stay out of the room. This is the
  biggest seam decision.
- **Key clash, not yet checked by ear:** the ceremony motifs are rooted on C5 (ceremony.ts:35; C E G triads at 286-366) and the Mythic
  on A4 with +3 semitones (C natural, 37-39). C natural is outside the music's D collection (C#). The music is only ducked -9 dB under
  them. If voices "fall into key" during a ceremony, there are two keys at once. Never measured.
- Untested: iPhone (audio session, unlock retry with a mock only), any browser but Chromium 141, audio-thread cost, a phone speaker.
  Low bodies (the cut pop 175 Hz, the Mythic 55 Hz) disappear on phone speakers (SOUND.md 1006, 1116).
- One strand voice and one bump limiter are shared by every squishy (SOUND.md 1171). Several squishies at once will merge
  strands and thin out bumps across pairs. That is fine as a calm feature, wrong if a designer expects one per squishy.
- First fast effect after a rest: 12 ms late (24 ms at music 1), unjudged on touch (SOUND.md 1204).
- Music seed fixed: every launch opens the same way unless the shell passes a per-session seed (SOUND.md 1176).
- Pumped voices (blend, reveal, merge) drop pieces after a main-thread stall > 0.4-0.5 s. More bodies mean longer frames, which makes
  this more likely during a ceremony (SOUND.md 1187).
- The physics did not exist when bump / lift / toss / strand were designed. They have been driven by scripts, the sound lab and
  SHELL-4 (SOUND.md 1169). Their behaviour in a multi-body pile is unmeasured.
- Not checked by me: voices.ts past poke (squish internals, blend), ceremony.ts bodies, music_checks.mjs, engine_tests*.js, view.js,
  the shell's exact call sites and rates (only greps), bundle size of `src/audio` (not in any report).

## Open questions for the designers

1. Do autonomous sounds (chatter, ambience events, props that move by themselves) ever make room in the music? Proposal: never. Only
   player-caused sounds keep the dip.
2. One volume for "Music and places", or separate Music / Ambience / Chatter sliders? (Each slider is a chain gain plus a settings key.)
3. Should the music change per place (tempo, fields, timbre) or stay one score with a different ambience? Retuning the key is not
   recommended (ceremonies and the whole-again run are fixed).
4. Night forest and beach: are insects, birds or gulls allowed as ambience (D10 bans animal characters, not necessarily their sounds)?
5. Are creature voices in harmony with the music always, or only during a "sing together" behaviour? While the music is off, do they
   still snap to D pentatonic (recommended, for consistency)?
6. The exact chatter caps (phone / desktop, normal / Calm). Audio's backstop proposal: 2 at once, 3 starts/s; Calm 1 and 1.5.
7. Should the ceremonies move into the D collection (so voices and stingers never clash), or should chatter fall silent during
   ceremonies? The second is simpler, and the ceremony owns the moment anyway.
8. How far does a voice carry: pan only (today), or a level falloff by distance from the middle of the frame (D4 "near the middle
   first")? Who computes it, the shell or audio?
