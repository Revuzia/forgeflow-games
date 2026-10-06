# WOBBLEHOARD — sound design and measurements

**Nobody has listened to any of this yet, including the round-3 music bed and its fix (the room dips, the breathing pad,
the louder strand, the retuned bubbles), the audio-4 fix (the music held down while you play instead of pumping, the
slow-onset dips, the 12 ms clear-the-way delay, the strand's corrected AM, the unlock retry) and the CUT round (the slice, the
separation pop, the rejoin "blorp" and the whole-again flourish; the pad's dip and the clearing delay at a music volume above
the default).** The machine that built it has no speakers and no human ears were involved.
Every claim below is a measurement (levels, durations, pitch trajectories, spectrograms viewed as images) or a design
intent. "Sounds soft/wet/cute" is **unverified**; the checklists at the end are for the first person who plugs in
headphones. Treat the numbers as "the synthesis does what the design says", not as "it sounds good".

All sounds are synthesised in code from oscillators, filters and seeded noise. There are no samples, no audio files, no
downloaded or copied waveforms; the designs are ours and are not modelled on any game's effects. Variation comes only from
`src/core/rng.ts` `mulberry32` streams, never `Math.random`.

## Files

| File | Role |
|---|---|
| `src/audio/voices.ts` | the six voices, `(ctx, out, t0, params)`, identical live and offline |
| `src/audio/dsp.ts` | helpers: seeded noise buffer, `Bag` (owns a voice's nodes, frees them on `ended`), Minnaert `bubble()`, soft-clip curve, node bookkeeping |
| `src/audio/chain.ts` | master chain (now with a smooth `duck`), shared by the engine and the offline probe |
| `src/audio/ceremony.ts` | round 2: meter-full, capsule beats, six tier reveals, merge charge + burst (DESIGN 6.1-6.7) |
| `src/audio/engine.ts` | `createAudio(opts?)`: lazy context, polyphony cap, stealing, settings, stats, pause; round 3: music sessions + ducking, bump limiter, held strand |
| `src/audio/music.ts` | round 3: the generative music bed. `Composer` (pure, seeded score) + `MusicBed` (one playing session: lookahead scheduler, pad, felt mallet with its own echo, bubble graces, duck, fades) |
| `src/audio/interact.ts` | round 3: `bump`, `BumpLimiter`, `lift`, `toss`, `strand` (held), `strandSnap` |
| `src/audio/cut.ts` | CUT round: `cutSlice` (cut phase 'start'), `cutPop` (phase 'separate'), `rejoin` (+ `all`), the six cut flavours (`FAMILY_FLAVOUR`), `CutLimiter` |
| `_harness/probe_audio.mjs` | gate G2 + sanity + engine stress (Chromium). `node _harness/probe_audio.mjs` (add `--voices=poke,pop` to iterate; `--no-engine` skips the ~2 min live part, `--no-ceremony` skips the round-2 gates, `--skip-voices` skips round 1, `--no-round3` skips round 3, `--only3` runs only round 3; audio-4 fix: `--no-room` skips the real-engine room checks, `--only-room` runs only them; a full run takes ~10 min on an idle machine, 30+ on this loaded container) |
| `_harness/audioview/engine_offline.js`, `play_scenarios.mjs`, `room_checks.mjs` | audio-4 fix: the REAL engine (`createAudio()`) run on an OfflineAudioContext with its timers locked to the audio clock (adapted from the independent audio-3 verifier's driver), seeded play scenarios (continuous, sparse, bursts, isolated placements) and the gates on them: pumping, isolated separation, the exposed gate, the clear-the-way latency |
| `_harness/audioview/cut_checks.mjs` | CUT round: the gates of the cut / rejoin voices (levels and clicks over every flavour, piece size, neck and calm; what the parameters do; each family distinct; calm softer; the rate limit, pure and through the real engine; separation from the music through the real engine at music 0.45 and 1). `node _harness/probe_audio.mjs --only-cut` runs only them (~10 min on this loaded container), `--no-cut` skips them; a full run includes them |
| `_harness/audioview/` | `index.html` sound lab (live engine, buttons/sliders, ceremony controls; round 3: music toggle + volume, bump/lift/toss, hold-to-stretch strand), `view.js` offline render API (voices, full ceremonies, duck; round 3: `renderMusic`, `renderMix`, `simulateMusic`, `composeOnly`, `bumpLimiterRun`), `engine_tests.js`, `engine_tests3.js` (round-3 live engine), `ceremony_checks.mjs` (round-2 gates), `music_checks.mjs` (round-3 gates), `analysis.mjs` (FFT, metrics, pitch tracker, spectral peaks/spread, PNG/WAV writers) |
| `_harness/_renders/` (gitignored) | per voice: `<v>.wav`, `<v>.png` spectrogram, `<v>_min/_max.wav`, `<v>_pitch0.80/1.25.wav`; `all_voices.wav` (every voice in order, 0.5 s apart); `report.json`, `engine_report.json`; round 2: `reveal_<tier>.png/.wav`, `reveal_mythic_v0..2`, `ceremony_capsule_<tier>`, `ceremony_merge_<tier>`, `merge_charge_*`, `meterFull`, `capsule_*`; round 3: `music_seed1_90s.wav`, `music_seed2_90s.wav`, `music_seed1_30s.png`, `music_seed2_30s.png`, `music_startstop.png`, `music_duck.png`, `mix.wav/.png`, `bump/lift/toss/strand/strandSnap.wav/.png`, `strand_orphan.png`, `round3_voices.wav`, `engine_report3.json`; round-3 fix: `mix_sweep.wav/.png` (music + effects at random pitch and timing), `mix_sweep_music.png` (the music stem with its room dips), `music_room.png`, `strand_real.png` (the strand alone at realistic call rates); audio-4 fix: `room_sparse_music.png` (the music stem under sparse play, real engine), `room_sparse_mix.wav`, `room_bursts_mix.wav` (master output of sparse / burst play with the music), `room_sparse_gain.csv` (the music's gain over the music alone, 50 ms frames); CUT round: `cut_slice.png/.wav`, `cut_pop`, `rejoin`, `rejoin_all` (the canonical calls), `cut_gel` / `cut_sticky` / `cut_foam` / `cut_beads` / `cut_dough` / `cut_firm` `.png/.wav` (a whole cut per flavour: the slice, then the separation pop), `cut_storm.png/.wav` (10 cuts in 2 s through the real engine), `cut_story_mix.wav/.png` (six cuts, three rejoins and whole again over the music, real engine), `cut_voices.wav` (every CUT render in order, 0.5 s apart) |

## Master chain

```
voices -> [boost gain (poke/squish/release) | plain gain (land/pop/blend, ceremonies, bump/lift/toss/strand)
          | music gain (round 3: the music session, musicGain(settings.music))] -> bus gain (always stereo) -> 20 Hz high-pass
       -> DynamicsCompressor (threshold -6 dB, knee 6, ratio 12, attack 2 ms, release 12 ms)
       -> WaveShaper soft clip (transparent below 0.55, tanh knee, hard ceiling 0.89 = -1 dBFS, 2x oversampled)
       -> duck gain (1.0 unless a duck() is running) -> master gain -> AnalyserNode (fftSize 32768, for stats().peak) -> destination
```

* Round 3 changed two things here, nothing else (same nodes, same compressor and soft-clip settings, release still 12 ms):
  a third input (`music`) and an explicitly stereo `bus` (`channelCount 2, 'explicit', 'speakers'`). With the default
  `'max'` mode the chain switched between mono and stereo processing whenever a panned voice started or freed itself, and
  each switch restarted a channel's filter/limiter state: measured as run-to-run differences of up to 6e-4 (and up to
  8e-2 with the compressor bypassed) right at those moments. A mono voice is upmixed L = R and a mono destination downmixes
  (L + R) / 2, so every mono measurement below is unchanged (all 372 round-1/2 checks still pass).

* `master` (0..1) is a squared taper: 0.5 = -12 dB. `muted` is exact silence. Both sit after the limiter, so they never
  change what the limiter does. Engine default: master 0.8 (-3.9 dB), squishBoost 0, muted false.
* `squishBoost` 0..1 = 0..+9 dB on the boost bus. Measured at 1.0: poke +8.1 dB RMS, release +7.7, squish +6.0 (the
  limiter takes the rest); the output peak stays <= -1.5 dBFS.
* The output ceiling is -1 dBFS by construction (soft-clip curve), whatever the sum of voices does.
* **Finding that shaped the chain:** Chromium's `DynamicsCompressorNode` starts each event after silence from a reduced
  gain that recovers at the `release` rate. With release 0.12-1 s a 5 ms burst lost 7-11 dB and a 20 ms burst 3-5 dB, for
  any threshold/ratio (even ratio 1). With release <= 12 ms the loss is gone (5 ms burst -0.2 dB; sustained tones get the
  node's fixed +2.1 dB make-up). Hence release 12 ms: it is a safety limiter, not a sound-shaper. The loss is a property of
  the node, so other browsers may differ a little; the probe only measures Chromium 141.
* Measured through the probe, voices leave about 0 dB (short hits) to +3 dB (sustained) above their dry level.

## Engine behaviour

* Nothing exists before `unlock()`; every method before then is a no-op that is counted in `stats().dropped`.
  `unlock()` creates the context inside the gesture (also tries `webkitAudioContext`), calls `resume()` and starts a
  one-sample silent buffer (iOS) synchronously in the call, before anything is awaited (round-3 audit fix: the buffer used
  to start only after awaiting `resume()`, i.e. after the gesture had ended; a probe check simulates a context that starts
  suspended), never awaits `resume()` for longer than 1.2 s (it can stay pending without a gesture), and is idempotent and
  concurrency-safe (one context, ever). Audio-4 fix: a call that arrives while an earlier `unlock()` is still pending gets the
  same promise but, if the context is not running, calls `resume()` and starts the silent buffer again, synchronously, inside
  its own gesture. Before, `lifecycle.ts`'s `unlockAudio()` on `visibilitychange` (not a gesture) left a pending promise, and a
  tap within the next 1.2 s got that promise with no `resume()` inside the tap: on iOS the context stayed suspended until a
  later trigger kicked it (probe, with a mock context that only resumes inside a "gesture").
* **iOS audio session (round-3 audit fix, a decision):** where `navigator.audioSession` exists (Safari 16.4+), the engine
  sets its `type` to `'playback'` when it creates the context with sound on, and to `'ambient'` while muted (back to
  `'playback'` on unmute). With `'playback'` the hardware ringer switch does not silence the game (sound is one of the
  three non-colour rarity cues, DESIGN 6.6) but, like a video, it pauses the user's own music app; with `'ambient'`
  (muted) the game gives the session back. Feature-detected, a no-op elsewhere; **never tested on an iPhone**.
* If the context later becomes `suspended`/`interrupted` (phone call, tab discard), the next trigger is dropped and kicks
  `resume()` (rate-limited to 4/s), so the first tap after a gesture-blocked interruption recovers audio.
* `setPaused(true)` (tab hidden): frees every live voice at once and suspends the context; `setPaused(false)` resumes.
  The SHELL should call `audio.setPaused?.(document.hidden)` on `visibilitychange` (optional method, additive).
  Round-3 audit fix: freeing a voice now STOPS its sources before disconnecting them (`Bag.free`). Before, a held squish
  or a charging merge freed by a pause kept its never-ending sources running on the context (16 of 48 never ended in the
  audit's repro) while `stats().liveNodes` said 0; the probe now patches `start()` and checks that every source started
  around a pause cycle reaches `ended` (47/47). A second `setPaused(true)` (visibilitychange + pagehide) neither skips the
  music's 0.15 s fade nor shortens the pending suspend.
* Polyphony: 24 live voice groups. The 25th steals the oldest one-shot (the held squish is only stolen if nothing else
  is left) with a 20 ms linear fade. Voices still fading do not count against 24 but are capped at 40 alive in total.
* Every node is disconnected on `ended`; a 0.5 s housekeeping timer reaps anything past its end time + 1.5 s whose
  `ended` never arrived, and auto-ends a held squish nobody has updated for 6 s. A held squish also carries a dead-man's
  switch: each `update()` re-schedules a fade to silence 0.4 s later, so a stalled caller can never leave it droning.
* Variation: each call gets `jitter = 1 + 0.03*(2*phase-1)` where `phase` advances by the golden ratio per kind (so two
  consecutive calls of one kind differ by >= ~2.3% in pitch, never repeat, stay within +/-3%) plus a fresh sub-seed from
  the engine's seeded stream for bubble sizes/timings/noise offsets. `createAudio({seed})` makes a session reproducible.
* `stats()`: `{started, state, sampleRate, peak, live, liveNodes, dropped}`. `state` is the context state or `"locked"`
  before unlock. `peak` is linear (0..1), the maximum |sample| at the destination since the previous `stats()` call
  (reads only the newest `elapsed` samples of the analyser's 0.68 s ring; returns `NaN` if any NaN reaches the output).
  `started[kind]` counts accepted triggers, including ones swallowed by mute.
* Round 2 additions: voices have a stealing `priority` (one-shots 0 < held squish 1 < reveal/merge 2), so a flurry of pokes
  never steals a ceremony voice; a live `mergeStart` schedules only its first 0.2 s of squelch/tick layers (0.5 s before
  the round-3 audit fix; `MERGE_FIRST_SLICE_S` in engine.ts) and an 80 ms build pump (running only while something is pending) schedules the rest 0.5 s ahead;
  round-3 audit fix: the same pump now also builds a `blend`'s bubble stream, clinks and flourish (only the first 0.5 s is
  built in the call) and the notes, ladder, sparkle and shimmer of a `reveal` or merge `burst` that start more than 0.6 s
  after the call (`Bag.defer`: the random draws stay in the call, so a live voice is the same sound as its offline render;
  pieces a stalled main thread made late are dropped, never started in the past; a stopped or stolen voice drops what is
  left). Measured in one call: blend 8 s x 8: 34 nodes (was ~586), Mythic reveal + tier-up + new: 36 (was 137);
  `capsuleBeat('grab')` builds its squeak wave once per context (it used to build a `PeriodicWave` per call) and is
  throttled to one squeak per 70 ms so a
  per-frame caller cannot stack them; a Mythic `reveal()` ducks the master by itself (`mythicDuck`); `stats()` also returns
  `liveKinds` (live groups by kind). `started` gained `meterFull`, `capsule`, `reveal`, `merge`, `mergeBurst`, `duck`.
* All numbers are sanitised at the engine boundary (NaN/Infinity/strings/negatives/huge) and again inside each voice;
  `update/end` `atTime` is ignored/clamped live (a far-future time would strand a voice).
* Round 3: the shared 2.5 s seeded noise buffer is built inside `unlock()` instead of lazily by the first voice that needs it.
  Measured: the first music note's scheduler tick took 28 ms because of it (now 1.2 ms); the first poke of a session paid
  the same one-time cost before.

## Voices

Levels below are **after the master chain at master = 1, squishBoost = 0**, measured by the probe on the canonical
parameters (poke intensity 0.6, release compression 0.7, land intensity 0.6, pop size 0.5, blend count 3 / 2.2 s, squish
press-rub-release script). "Active" = span of 5 ms windows above -45 dBFS. "min/max" = peak at parameter 0 / 1.

| Voice | peak | active RMS | active | min .. max peak | dominant (centroid) | > 6 kHz |
|---|---|---|---|---|---|---|
| poke | -9.9 dBFS | -23.6 dBFS | 105 ms | -17.7 .. -7.5 | 164 Hz (459) | 0.02% |
| squish | -7.5 | -28.7 | 2925 ms (script) | n/a (12 seeds: -11.2 .. -4.2) | 574 Hz (1345) | 0.42% |
| release | -9.4 | -23.7 | 270 ms | -17.0 .. -4.7 | 164 Hz (300) | 0.00% |
| land | -11.0 | -23.0 | 85 ms | -18.6 .. -6.6 | 129 Hz (197) | 0.00% |
| pop | -12.2 | -23.5 | 45 ms | -11.0 .. -12.3 (size) | 1242 Hz (1452) | 1.63% |
| blend | -8.8 | -23.7 | 3065 ms | n/a | 117 Hz (574) | 0.03% |

Pitch ratio test (same seed, pitch 0.8 vs 1.25, expected x1.5625): poke x1.58, squish x1.56, release x1.50, land x1.56,
pop x1.51, blend x1.71 (dominant frequency of the whole render). Genome extremes (0.70 and 1.43): still < 4% above 6 kHz
and inside the level window.

### poke — "thup" (80-180 ms; measured 105 ms)

* Body: one oscillator with a 4-harmonic wave `[1, .55, .2, .07]` (so it is audible on phone speakers that cannot make
  120 Hz), starting at `(168 + 92 i) * pitch` Hz and falling to `(112 + 30 i) * pitch` Hz with time constant 22 ms (fast
  downward glide), through a low-pass that closes from `(1500 + 1900 i)` to 520 Hz (tc 30 ms). Amplitude: 3.5 ms attack,
  exponential decay tau 34 ms (soft) to 24 ms (hard).
* Skin: seeded noise through a band-pass at `(950 + 1250 i) * pitch`, Q 1, 2 ms attack, tau 9.5 ms.
* Wet: with probability `0.45 + 0.4 i` one Minnaert bubble, radius 2.2-4.6 mm / pitch, 7-28 ms after the hit.
* `intensity` i -> level (-19.5 .. -9.5 dB before the chain), start pitch, brightness, transient size.
* Measured: body glides 200 -> 135 Hz (x0.67); no sample step > 0.13 at the extremes.

### squish (held) — continuous squelch

`squishStart()` returns `{update(p, atTime?), end(fade?, atTime?)}`; call `update` every frame with the physics metrics.

* Gurgle bed: noise -> irregular amplitude flutter (two LFOs, 17-23 Hz and 29-35 Hz) -> three band-pass resonances at
  `[430, 980, 2050] * scale` Hz, Q 5.5/6.5/5.5, where `scale = (0.62 + 1.25 compression) * (1 + 0.2 * dir) * pitch`
  (`dir` is the smoothed sign of `rate`: formants jump up when squeezing, drop when springing back) and each resonance
  wanders on two slow LFOs of its own (+/-150 cents at 3-7 Hz, +/-90 cents at 7-13 Hz). Plus a "wet skin" band-pass
  (Q 2.2) at `620..3000 Hz` following compression. 130 Hz high-pass, 4.6 kHz low-pass.
* Bubbles (the main layer): Poisson stream, rate `95 * a^1.05 * (0.7 .. 1.2 with compression)` per second, where
  `a = clamp((|rate| - 0.04) / 2.6)`; radii log-uniform 0.4-6 mm, multiplied by `1.15 -> 0.62` as compression grows
  and divided by pitch; amplitude grows with radius^1.3. Each bubble chirps up ~30% as it settles. Bubble bus: 2x high-pass
  at 170 Hz (no low "tock" at each onset), low-pass 5 kHz. Round-3 audit fix: each window of the stream is filled once; a
  second `update()` that reads the same audio clock (two display frames in one audio callback: 120 Hz screens, Android's
  larger buffers) adds no bubbles. Before, four calls per audio step made 56% more bubbles for the same gesture; now the
  count is identical (probe, same seed: 103 = 103).
* Level follows `a^0.85` (attack tc 12 ms, release tc 40 ms). `rate = 0` -> exact silence; so does a stalled caller.
* Measured (scripted gesture: press 0.1-1.0 s to c=0.8, hold, rub at 2.5 Hz +/-0.1, hold, release 0.15 s):
  holds -91.5 / -77.7 dBFS (rub -31.2 dBFS); `rate` steps 0 / 0.3 / 0.6 / 1.2 / 2.5 per second give
  -240 / -44.2 / -32.7 / -27.7 / -20.7 dB RMS and back to -78.8 dBFS at 0 (silence); constant compression with rate 0 for 2 s:
  peak < -80 dBFS; spectral centroid 1593 Hz while squeezing at c < 0.2 -> 2165 Hz while rubbing at c = 0.8 (x1.36).
  Live (engine, 60 Hz updates): audible while moving, output peak exactly 0 700 ms after the rate went to 0.

### release — "bloop" back (200-450 ms; measured 270 ms at c = 0.7)

* Two sines: `(178 - 66 c) * pitch` Hz and its octave (x2.012, level 0.34), gliding up by `x(1.75 + 1.05 c)`
  asymptotically (no corner), then a slow droop; length `0.2 + 0.25 c` s, tau = length / 4.6.
* Wobble: amplitude modulation at `(30 - 16 c)` Hz (14-30 Hz) of depth `0.22 + 0.42 c`, decaying (tc 90 ms after 40 ms).
* A puff of band-passed noise at `1400..2200 Hz`, and `1 + 4 c` escaping bubbles (1.2-5.5 mm).
* Measured: pair glides 175.5 -> 322.7 Hz (x1.84); envelope modulation 19 Hz, depth 23%.

### land — soft plop/thud (60-140 ms; measured 85 ms)

* Body sine+2 harmonics `[1, .42, .12]` falling `(150 + 50 i)` -> `(60 + 12 i)` Hz (tc 26 ms), low-passed noise thump
  (cutoff `330 + 150 i` Hz, tau 13 ms), and one 6-9 mm bubble "plop" at ~400-700 Hz.
* Measured: body 154.6 -> 76.9 Hz (x0.50).

### pop — bubble pop (45 ms active)

* Click: noise through a band-pass at `1900..2700 Hz`, 2-5 ms long (random), 0.4 ms attack.
* Blip: sine chirping up x1.95 in 17 ms from `(1500 .. 620 by size) * pitch` Hz, tau 7.5-13 ms.
* Air: band-passed noise at 2.8 kHz, tau 16 ms.
* Measured: 1171 -> 2056 Hz (x1.76); click peak 0.246 vs blip peak 0.154; size 0 vs 1: 1699 vs 750 Hz.

### blend — blender (2.2 s of motor + 0.9 s flourish = 3.07 s active; `durationS` default 2.2, clamped 0.8-8)

* Motor: two detuned saws at `112 * pitch * (1 - 0.025 (count-1))` Hz spooling 26 Hz -> x1.14 over 0.8 s (exponential),
  settling with vibrato (0.75 Hz +/-55 cents, 2.7 Hz +/-22 cents) through a resonant low-pass (Q 4.5) whose cutoff rises
  240 -> 1500 Hz and wanders, a thin sine whine at x6 the fundamental, and grit (noise 0.9-3.2 kHz). Spools down 0.22 s
  before the end.
* Slosh: noise through a band-pass at 520 Hz (Q 1.7) with slow level and centre LFOs (~1 Hz), plus a Poisson bubble
  stream (9 + 3.5 count per second, 1.6-6.2 mm).
* Clinks: `2 + count` (max 6) glassy tinks, three decaying sines at x1 / x2.32 / x3.87 of 1.5-2.3 kHz.
* Finish: four rising bell notes (523 Hz x 1, 1.25, 1.5, 2) starting 0, 72, 164 and 276 ms into the flourish, each with 2.76x and 5.4x partials, last one
  rings tau 0.2 s.
* `stop()` fades everything in 150 ms (no flourish).
* Live (round-3 audit fix), only the first 0.5 s of the bubble stream, clinks and flourish is built in the call and the
  engine's pump builds the rest 0.5 s ahead (an 8 s blend of 8 used to build ~586 nodes in one call; now 34); `stop()` drops
  what is not built yet. Offline renders build everything at once and are unchanged.
* Measured: motor partial 37.8 -> 113.1 Hz (x2.99 in the first second); flourish loudest peak 528 -> 1056 Hz.

## What was measured (gate G2 and extras)

`node _harness/probe_audio.mjs` (rounds 1 and 2 together, before round 3): **372/372 checks pass, exit 0** (the 218 round-1 checks, listed here, plus 154 ceremony and engine checks, listed in the round-2 section). Round 3 adds 183 checks (154 in its first version, 29 more with the round-3 fix; section "Round 3"); the round-1/2 checks are unchanged and still pass. Gate G2 as worded in CONTRACT.md section 6, per voice:
peak -20..-1 dBFS; |DC| < 0.01 (worst 2.9e-5); no sample step > 0.25 at start/end (worst 0.073, also at min/max parameters:
0.129); tail < -60 dBFS at the end of the voice's declared life + 50 ms (worst -118 dBFS); non-silent >= minimum duration
(poke 80 ms, release 200, land 60, blend 2.5 s; pop 30 ms and squish 1.5 s are my own minima); different pitch/seed differ
>= 3% in dominant frequency (x1.5 for 0.8 vs 1.25). Spectrogram PNG per voice written. The level window and the click
check were additionally enforced for 12 seeds x min/canonical/max parameters (peak -19.3 .. -3.5 dBFS overall).

Extras: not harsh (< 15% of energy above 6 kHz; worst 1.63%, pop); active RMS -34..-14 (worst -28.7 squish); poke and land
glide down, release and pop glide up, motor spools up, flourish rises, formants rise with compression; squish silent at
rate 0; pan -1 puts >= 209 dB more energy in the left channel; hostile parameters (NaN, +/-Infinity, negative pitch) give finite
audio; stealing a voice mid-note fades with no click (step < 0.07, < -73 dBFS 45 ms later); same seed renders agree to
-80 dBFS (Chromium's own float noise is ~1e-5); master 0.5 = -12.0 dB; muted = exact silence.

Live engine (headless Chromium 141, real `AudioContext` at 44.1 kHz, `--mute-audio` so the audio clock runs on a null sink):

* Before `unlock()` all methods are safe no-ops and **no AudioContext is constructed**; `unlock()` x3 (two concurrent)
  gives exactly one context; `webkitAudioContext` fallback works; with no WebAudio at all `unlock()` resolves with `ready=false`.
* 30 taps/s for 6 s (poke/release/land/pop rotation + held squishes): 180 triggers, max 13 live groups / 184 live nodes,
  0 live groups and 0 live nodes afterwards, JS heap +0.1 MB after GC, **0 audio-thread fallback (underrun) events over
  7.6 s played** (`AudioPlayoutStats`), mean cost 0.52 ms per trigger on the main thread.
* 5000 voices as fast as the page can issue them (770/s, with blends and held squishes mixed in): all 5000 accepted,
  max 40 live groups / 2411 live nodes, 76310 nodes created = 76310 disconnected (counted independently at the WebAudio
  API surface by patching `create*` and `disconnect`), 0 live afterwards, heap +0.2 MB, output peak <= 0.55, finite.
  Under that 25x-realistic storm the playout stats did report 31 fallback events (310 ms of 6.8 s): not a gate, but real.
* Hostile parameters on every voice (NaN, +/-Infinity, -1, 5, null, strings, objects, 1e9): 0 exceptions, finite output.
* Mute, pause/resume, external suspension and recovery, dispose: all behave (see `engine_report.json`).

## Round 2: reveal and merge ceremony (DESIGN 6.1-6.7)

**Still unheard by any human**, like everything else here. Everything below is measured from rendered samples and
spectrogram PNGs I looked at; "the escalation feels like a reward" is a design intent, not a finding.

New API (optional members of `SquishAudio`, exactly the signatures in `src/contracts.ts`; two additive extras are marked **+**):
`meterFull({quiet, pitch})`, `capsuleBeat({beat: 'grab'|'crack'|'burst', progress, tier, pitch})`,
`reveal({tier, tierUp, isNew, mythicVariant, durationS, calm, pitch})`, `mergeStart({tier, chargeS, calm, pitch}) -> {burst({tier, tierUp,
mythicVariant, durationS **+**}), stop()}`, `duck({db, ms})`. Unknown tiers fall back to Common; every number is sanitised.
`calm` multiplies every duration by 0.65 INSIDE the voice (pass the normal-mode `durationS`/`chargeS`), removes the
whoosh/shimmer/crack, slows attacks, softens the pop (low-passed, -5 dB) and lowers the level by 2.5 dB.
Round-3 audit fix: `capsuleBeat` gained an optional `calm` too (additive, `src/contracts.ts`). Before, the calm burst
existed in `ceremony.ts` but no `SquishAudio` call could reach it. Now `calm` gives the low-passed, softer burst pop and
quieter stinger, and grab and crack 2.5 dB softer with slower edges (live check: three calm Rare bursts peak 0.151-0.159
against 0.218-0.316 for normal ones).

### Time map the shell should follow (these are the DESIGN 6.1/6.3 numbers)

| | Common / Uncommon | Rare / Epic / Legendary / Mythic |
|---|---|---|
| 0 | `capsuleBeat grab` (call again at 0.18 s with a higher `progress` if it likes) | same |
| 0.35 s | `capsuleBeat crack` (takes no tier, never) | same |
| 0.65 s | `capsuleBeat burst {tier}` | `reveal({tier})`: its first 0.3/0.5/0.8/1.0 s are the pre-roll swell (Mythic: 250 ms hush, engine ducks the master) |
| burst | n/a | `capsuleBeat burst {tier}` at 0.65 s + pre-roll |
| B3 | `reveal({tier})` at 1.0 s (D = 0.6 / 1.0 s) | the motif lands 0.35 s after the burst; `reveal` ends at 0.65 s + D |
| merge | `mergeStart({tier})` at 0, `burst({tier, tierUp})` at `chargeS` (T3); the burst carries the motif, no separate `reveal()` | same |

Default `durationS` of `reveal` is what is left of the DESIGN 6.1 capsule budget: 0.6 / 1.0 / 1.95 / 2.55 / 3.25 / 3.85 s
(Rare+: measured from the call at 0.65 s, so every capsule open ends exactly at 1.6 / 2.0 / 2.6 / 3.2 / 3.9 / 4.5 s). Any
other `durationS` stretches the timeline (pre-roll and gap keep their absolute lengths, notes and ring-outs scale; a
very long `durationS` on a short cue is just a longer soft afterglow). Default merge: `chargeS` 1.3 / 1.5 / 1.8 / 2.1 / 2.4 / 2.8 s and burst
0.9 / 1.1 / 1.4 / 1.7 / 2.1 / 2.4 s = the DESIGN 6.1 merge budgets 2.2 / 2.6 / 3.2 / 3.8 / 4.5 / 5.2 s.

### meterFull (about 180 ms)
Two sine plucks, D5 (587.3 Hz x pitch) then A5 (880 Hz, a fifth up, 72 ms later), each with a 2nd partial and (not when `quiet`) a 3 ms band-passed noise
pluck tick at 3.2 kHz. `quiet` is 6 dB lower, no tick, slower attack. Measured: active 175 ms, peak -10.0 dBFS (quiet -16.6), notes 587.3 -> 880.0 Hz (x1.498).

### capsuleBeat
* `grab`: a squeak, odd-harmonic wave `[1, 0, .22, 0, .08]` starting at `420 + 400 progress` Hz and rising x1.4 (tc 70 ms) with a 9-12 Hz vibrato, plus a narrow
  band of noise (the rub). 215 ms, peak -13.1 dBFS. progress 0.1 -> 0.9: 539 -> 891 Hz (x1.65); rises x1.22 within the call.
* `crack`: a dry shell tick, a 3 ms band-passed noise burst at ~3.3 kHz + a 1.35 kHz tock and a quieter echo tick 26 ms later; 45 ms active, peak about -13 dBFS,
  7.5% above 6 kHz (the brightest thing in the lane; limit 15%). **The function has no tier parameter**; renders with and
  without a tier argument are identical for all six tiers (probe check), so the tier is not audible before the burst.
* `burst`: the existing `pop` voice + a short tier stinger (<= 0.4 s): Common mini-bloop, Uncommon chime, Rare bell + fifth, Epic saw stab + note, Legendary choir
  stab + chord, Mythic sub-bass hit + bell. Peaks -10.2 .. -8.2 dBFS and RMS -25.4 .. -23.2 (all within 3 dB), pairwise different (norm. difference >= 0.85),
  first 6 ms always carry the pop click (>= 0.235 peak).

### reveal (the six signatures; numbers at default durations, pitch 1, post-chain, master 1)

| Tier | recipe | end (s) | spectral peaks | spread (oct) | peak dBFS | RMS dBFS | > 6 kHz |
|---|---|---|---|---|---|---|---|
| Common | sine pair 180 -> 262 Hz (x pitch) + octave partner, 180 ms bloop, then a soft 262/393 Hz glow to the end | 0.595 | 7 | 1.41 | -7.6 | -23.5 | 0.00% |
| Uncommon | the bloop + a two-note chime C5 (523.3 Hz) and E5 (659.3 Hz), a major third, 4-partial glockenspiel tone | 1.00 | 10 | 2.68 | -7.8 | -22.1 | 0.00% |
| Rare | 0.3 s hum swell (185 Hz + octave) under a 0.35 s gap, then a bell cluster: C5 and G5 (a fifth), each with 3 inharmonic partials (x1, x2.76, x5.4), + a 5-sine shimmer (3.1-4.7 kHz, 8 Hz tremble) | 1.95 | 13 | 3.55 | -7.0 | -22.6 | 0.00% |
| Epic | 0.5 s low saw swell (98 -> 131 Hz through a low-pass sweeping to 800 Hz), soft whoosh (noise band-pass 450 -> 4800 Hz), 4-note rising arpeggio C5 E5 G5 C6 (an octave), 5-partial notes | 2.555 | 23 | 4.02 | -7.9 | -22.3 | 0.05% |
| Legendary | 0.8 s formant "choir" (3 chord voices x 2 detuned saws through "ah" formants 730/1090/2440 Hz + a chest low-pass, 5 Hz vibrato), a rising sine sweep 260 -> 3000 Hz, then a rolled bell chord C5 E5 G5 D6 (C5 to D6 = a major ninth) + whoosh | 3.255 | 25 | 4.46 | -6.4 | -22.8 | 0.08% |
| Mythic | 250 ms hush, sub-bass swell (A1, 55 Hz + 110 + 165) and a 4-voice choir pad, then a unique 3-note motif (A4 + [0,7,14] / [12,5,8] / [5,12,3] semitones for variants 0/1/2) in 6-partial bells, two drone bells (A3, E4), a shimmer on the last note | 3.855 | 32 | 5.15 | -5.6 | -21.4 | 0.01% |

* "spectral peaks" = local maxima standing >= 8 dB above their neighbourhood and within 38 dB of the strongest in the averaged spectrum (60 Hz - 9 kHz);
  "spread" = octaves between the 2% and 98% points of cumulative energy. Both are my own definitions, chosen before I saw
  the final numbers, and the design was changed until they rose tier by tier.
* Escalation measured: duration, peak count and spread all strictly increase; peaks within 2.3 dB (-7.9 .. -5.6), RMS within 2.1 dB (-23.5 .. -21.4), Mythic
  not quieter than Common. Nothing clips (highest tier peak -5.6 dBFS; with tierUp + isNew -4.6).
* Measured from FFT peaks (pitch 1, jitter 1): Uncommon third x1.260 (523.3 / 659.2 Hz), Rare fifth x1.498 (523.3 / 784.0), Legendary ninth x2.245 (523.3 / 1174.6),
  Epic arpeggio 523.3 -> 659.3 -> 784.0 -> 1046.6 Hz (x2.000), Rare inharmonic partials at 1444 / 2826 Hz, Mythic motifs 440-659-988 Hz, 880-588-698 Hz, 586-880-523 Hz
  (pairwise 19-21 semitones apart in total, different contours, matching the documented semitones to +/-0.5), same length and loudness for all three.
* Durations: requested `durationS` = 1.6 / 2.0 / 2.6 / 3.2 / 3.9 / 4.5 s gives audible ends 1.59 / 2.00 / 2.60 / 3.20 / 3.90 / 4.50 s (never beyond +5 ms);
  0.4 .. 6.5 s all within +/-1% of the request; default durations within +/-1% too.
* `tierUp` adds a 9-note rising ladder (C4 -> C6, ~0.4 s): pitch at 0.3-0.5 s / at 0.1-0.16 s is x2.41 with it and x1.02 without. `isNew` adds a three-sine sparkle after the last
  note (+13.7 dB at 2.3-4.2 kHz). Both raise the peak count on every tier (e.g. 7,10,13,23,25,32 -> 15,19,25,29,29,41).
* `calm`: every tier x0.65 in length, 1.2 - 3.6 dB lower peak, smaller or equal largest sample step (0.014..0.063 vs 0.015..0.090), no extra brightness.

### mergeStart / burst
* Charge (T0-T2, `chargeS`): hum = 80 Hz sine + 2nd partial (fading in) + faint 3rd (so phone speakers hear something) gliding x1.5 (a perfect fifth) over `chargeS`;
  the existing `squish` voice driven by a scripted press (compression 0 -> 0.9, rate about 1/s with a 1.6 Hz wobble and a T0 squash spike); a noise-tick stream (3 ms band-passed
  noise ticks, Poisson, 5 -> 70 per second exponentially). **The charge does not depend on the tier** (it only picks the default `chargeS`): the tier tell in DESIGN 6.4
  is visual here; audio stays neutral until the burst. If nobody calls `burst()` or `stop()` the hum fades by itself 0.25-0.45 s after the charge.
* Measured: hum 80.0 Hz start, x1.495 over 1.3 s; 2nd partial relative level -16.1 -> -6.1 dB; squelch spectral centroid 1222 -> 2403 Hz (x1.97); ticks 3.1/s -> 43.1/s;
  charge peak -10.6 .. -7.8 dBFS, RMS -22.0 .. -21.7.
* `burst`: a "foomp" of band-passed noise (1.1 kHz) + a high-passed "crack" (2.5-5.5 kHz, 20 ms) + the tier motif of `reveal()` without pre-roll (-2 dB), + the ladder on tier-up.
  Lengths 0.90 / 1.10 / 1.40 / 1.71 / 2.11 / 2.41 s (budget remainder); noise transient adds >= 10 dB at 2.5-8 kHz in the first 30 ms on every tier.
* `stop()`: 150 ms fade, silent after (< -70 dBFS), no click.
* Full ceremonies rendered end to end offline: capsule (grab, crack, burst, reveal) ends at 1.60 / 2.00 / 2.60 / 3.21 / 3.91 / 4.51 s (budgets 1.6 / 2.0 / 2.6 / 3.2 / 3.9 / 4.5);
  merge ends at 2.20 / 2.60 / 3.20 / 3.81 / 4.50 / 5.21 s (budgets 2.2 / 2.6 / 3.2 / 3.8 / 4.5 / 5.2). Peaks: capsule -6.5 .. -5.7 dBFS, merge -7.9 .. -3.8 (Rare, at the
  burst), largest sample step 0.20. Calm Mythic: 2.93 s and 3.38 s (x0.65), peaks 3.5 / 2.5 dB lower.

### duck
`duck({db, ms})` is a gain node between the soft-clip and the master gain, driven only by exponential ramps (attack time constant 18 ms, release 70 ms): -12 dB held
measured -12.0 dB, recovers to 0.0 dB, at most 0.57 dB of level change per millisecond (limit 1.2), no sample discontinuity; NaN/Infinity arguments are clamped
(-36..0 dB, 20 ms..4 s). Live, on a steady blend: -19.5 dB while ducked, back afterwards. The Mythic reveal ducks -14 dB for 250 ms (calm: -7 dB, 163 ms) by itself.

### Round-2 checks (154 new, all pass)
Per class: peak -20..-1 dBFS, |DC| < 0.01 (worst 6.4e-5), no jump > 0.25 at start/end (worst 0.182, the crack), tail < -60 dBFS (worst -78 dBFS: the Mythic burst stinger),
energy above 6 kHz < 15% (worst 7.5%: the crack; every reveal <= 0.08%, so the 20% shimmer allowance was not needed), active RMS -34..-14, no NaN, largest step < 0.25
(worst 0.201, the Legendary merge); durations, intervals, escalation, calm, tier-agnostic grab/crack, noise transient, ticks, hum, squelch, stop(), dead-man, duck smoothness,
26 hostile offline renders. Live engine: hostile arguments on every new method (0 exceptions, output <= 0.45), `started` counters, 80 pokes in one tick leave a live reveal and merge
untouched, 5000 ceremony triggers (4758 accepted, the rest throttled grabs; max 40 live groups, max 2488 live nodes, 190981 nodes created = 190981 disconnected counted at the WebAudio
surface, 0 live afterwards, heap +0.4 MB), `mergeStart` costs 1.9 ms on the main thread (85 of 221 nodes up front), a live Mythic capsule + Mythic merge with pokes at 8/s: 0 playout
fallback events over 10 s and the slowest trigger 2.8 ms.

## Round 3: music bed and play-mat sounds

**Still unheard by any human**, including the round-3 fix described here. Every claim below is a measurement from rendered
samples or a spectrogram PNG that I looked at; "warm", "playful", "calm", "sticky" and "thin" are design intents, not
findings. Nothing here is sampled, downloaded or modelled on the reference clip's music: the score below is generated by our
own rules, and the reference clip was never used as an audio source (REFERENCES.md).

**What the round-3 fix changed and why** (independent verifiers measured these on the first version):

1. *The ">= 8 dB effects over music" claim did not hold in general.* It had been measured on one fixed 20 s sequence at pitch
   ratio 1; over 330 placements at other pitches, timings and seeds, 25 fell under 8 dB (a soft toss 5 dB UNDER the pads, a poke
   3.4 dB and a pop 0.6 dB over a coinciding mallet). Root cause: the music and the effects share 0.3-3 kHz, so no register
   can be carved out for the music, and a fixed level cannot stay under every effect at every moment. Fix: the music now
   **makes room for every effect** (a fast, sidechain-style dip keyed by each effect voice, see "Room for the effects"), and
   the probe tests the worst case across seeds, random timings (many effects arriving alone, onto music at full level) and
   the whole genome pitch range 0.70..1.43.
2. *Perceptually the music did not sit below the effects.* The continuous pad was the strongest component, in the ear's
   sensitive region. Over each effect's loudest frames the music came within 0-7 dB (A-weighted: soft bumps and lands
   were UNDER it). Fix: the pad is darker (sines, no triangles), breathes tone by tone and answers the melody (it swells in
   rests) and now carries about the same energy as the sparse mallet instead of 3-5 dB more; under any effect the melody
   dips 24 dB and the pad 17 dB. Added: a
   loudness check, **K-weighted (ITU-R BS.1770) over each effect's own loudest 20 ms frames, >= 10 LU for every
   placement**, with A-weighted figures reported next to it.
3. *The "tuned" bubbles were sharp* (+33..+38 cents energy-weighted, +59..+80 at the spectral peak), because the bubble
   glided up 5% from the note. Fix: a 1% settle that starts 0.6 of itself below the note. Measured -3.7..-2.4 cents
   (energy-weighted) and +3.8..+5.8 cents (spectral peak) for every note A5..D7 at three score pitches.
4. *The held strand was far too quiet* (-28.6 dBFS peak in a realistic stretch, gate -20..-1; held at tension 0.8 -47 dBFS
   RMS). Its sound came from one weak high harmonic of a low saw passed through a narrow band-pass. Fix: the strand's own
   mode is struck directly (see the recipe). Measured -13.2 dBFS at every realistic call pattern (30-120 Hz, jittered, on
   the audio clock's grid), within 0.05 dB of each other; held at 0.8: -25.8 dBFS RMS.

### API (optional members of `SquishAudio`, additive; exact types in `src/contracts.ts`)

| Member | What it does |
|---|---|
| `setMusic?({ on?, volume? })` | `on` starts/stops the music bed; `volume` 0..1 is the same value as `AudioSettings.music`. Default: off, volume 0.45. Never starts before `unlock()` (a `setMusic({on:true})` made earlier starts it inside `unlock()`). |
| `AudioSettings.music?` | 0..1, relative to master. 0.45 = 0 dB = the designed level (about -29 dBFS long-term at master 1); below 0.45 a squared taper like master (0.225 = -12 dB); above, a gentle rise to +6 dB at 1; 0 = off (no session, no CPU). `setSettings({music})` and `setMusic({volume})` set the same value. The room dips deepen by the music's gain above 0.45 (+6 dB deeper at 1). |
| `bump?({ intensity, pitch?, pan? })` | Two squishies collided. Rate-limited inside (see `BumpLimiter`), so call it per contact event. |
| `lift?({ pitch?, pan? })` | A squishy pulled past its limit unsticks from the mat and is picked up. |
| `toss?({ speed, pan? })` | It was thrown. `speed` 0..1. |
| `strand?({ tension, snap?, pitch?, pan? })` | Call EVERY FRAME while a tacky strand stretches (`tension` 0..1), at whatever rate the render loop runs (30-120 Hz, jittered: measured the same). The engine keeps one held voice (created on the first call with tension >= 0.02) and ends it by itself: silent 0.15 s and freed 0.4-0.6 s after the calls stop. `snap: true` ends it at once and plays the snap. `pitch` is taken from the first call of a gesture. |
| `capsuleBeat?({ ..., calm? })` | Round-3 audit fix: `calm` (optional) now reaches the calm capsule beats (see Round 2). |
| `detailStats?()` | Harness readout: `music { on, playing, sessions, field, liveNotes, maxLiveNotes, notes, dropped, ticks, tickMsMean, tickMsMax, tickMsRecentP99, tickMsRecentMax, ducked, volume }`, `throttled { bump, strand }`. `ducked` = the slow ceremony duck holds or a room dip of more than 1 dB is requested right now. |

`stats().started` gained `bump`, `lift`, `toss`, `strand` (held voices created, not per-frame calls), `strandSnap`, `music`
(sessions started). The new voices go to the plain bus (`squishBoost` does not change them).

### The music: composition rules (our own)

* **Pulse.** 66 BPM, 4/4 (a bar = 3.64 s), an eighth-note grid with a light lazy swing (off-beats 4.5% of a beat late) and
  +/-8 ms of looseness (never ahead of the bar line).
* **One collection, four fields.** Every pitch comes from D major / G lydian (D E F# G A B C#), so no drift can clash.
  All pads sit between D4 and F#5 (294-740 Hz).

  | Field | Pad (MIDI) | Mallet pitch classes | Phrase endings on |
  |---|---|---|---|
  | home | D add9: D4 A4 E5 (62 69 76) | D E F# A B (D major pentatonic) | D F# A |
  | lift | G maj7 shell, lydian: G4 B4 F#5 (67 71 78) | G A B C# D F# (C# = the lydian colour) | G B D |
  | dusk | B minor over F#: F#4 B4 D5 (66 71 74) | B D E F# A (B minor pentatonic) | B D F# |
  | glow | A sus2 over E: E4 A4 B4 (64 69 71) | A B C# E F# (A major pentatonic) | A C# E |

* **Drift.** A field lasts 8, 12 or 16 bars (29, 44 or 58 s; weights 0.35 / 0.4 / 0.25), then moves along fixed edges:
  home -> lift .4 / dusk .35 / glow .25; lift -> home .5 / dusk .3 / glow .2; dusk -> lift .35 / glow .35 / home .3;
  glow -> home .6 / dusk .4. Nothing returns to the field it just left; glow mostly resolves home. The piece opens in home
  with a resting bar; half the new fields open with a resting bar too (the pad blooms alone).
* **Phrases.** Two-bar units: call + answer (.5), call + rest (.27), rest + call (.14), rest + rest (.09); never more than
  two empty bars in a row (a phrase rest, a field's opening rest and a rest + rest phrase used to add up to 18 s of pad
  alone). Rhythm cells per sounding bar (eighth slots): {0}, {0,3}, {0,3,6}, {0,4}, {0,2,4}, {2,4,7}, {0,6,7}, {0,1,4},
  {3,6}, {0,2,3,6}, {1,4}, {2,5}, {4,6,7}; about two thirds start on the downbeat. With p = 0.3 an answer "rhymes": the
  call's rhythm displaced by one eighth and its contour mirrored, never an exact copy.
* **Melody.** A random walk on the field's scale in the mallet register A4-D6 (69-86): steps of +/-1 (.26 each), +/-2 (.12/.13),
  +/-3 (.06/.07), +4 (.03), -4 (.02), repeat (.05), pulled back toward F5 (77) near the edges. The last note of an answer
  (or of a call followed by rest) resolves to the nearest phrase-ending tone. Velocity 0.62, +0.1 on the downbeat, +/-0.06
  (a narrower spread than round 3's first version: the loudest notes were the ones that covered soft effects), x0.86 on
  endings; pan follows pitch (+/-0.35).
* **The pad answers the melody.** In a bar with no mallet note the pad swells +5 dB, in a one-note bar +2.5 dB, under busier
  bars it sits back (time constant 1 s, moving 0.5 s ahead of the bar line). Planned with the bar, so live and offline
  renders schedule the same automation.
* **Bubbles (the game's own voice, tuned).** Grace: with p = 0.16 a note gets one Minnaert bubble an octave above it,
  50-75 ms ahead (never across a bar line). Trail: with p = 0.3 a phrase ending is followed by 2-3 bubbles rising through
  the next scale degrees an octave up, 75-100 ms apart (only when the trail fits inside the bar).
* **Never loops.** The composer is one seeded `mulberry32` stream (seed from `createAudio({seed})`, separate from the
  effects' stream). Same seed = the same piece, bit for bit up to Chromium float noise; the stream never repeats.

### The music: synthesis

Session levels are calibrated for a long-term RMS of about -29 dBFS at music 0.45 / master 1 (measured -29.4 / -29.2 for the
probe's seeds 1 / 2 before the pad fill, -28.4..-28.9 for four seeds after it; band -30..-24). The pad and the melody now
carry about equal energy, the pad's spread over time (it breathes and fills rests) and the melody's in sparse notes.

* **Pad.** Per tone: a soft sine (a whisper of 2nd and 3rd harmonic, -24 / -34 dB) plus a sine partner at 0.4 detuned so
  the pair beats slowly (0.12-0.3 Hz, a different rate per tone), all drifting +/-3.5 cents on a 0.08-0.14 Hz LFO, through one
  gentle 900 Hz low-pass (no triangles: their 880 / 1320 Hz harmonics were steady lines in every spectrogram). Levels
  low/mid/top 0.5 / 0.7 / 1. **Each tone breathes on its own seeded schedule**: it swells to 0.75-1 of its peak (rise 1.8-3.5
  s, hold 1-4.5 s), sinks back to its floor (fall 2.5-4.5 s; root -9 dB, middle -13, top -16) and rests there 0.5-5 s, so
  at any moment one, two or three tones are up and the chord's colour keeps moving. Chord attack tc 1.2 s from the
  field's first bar; release (tc 1.3 s) from 0.6 s before the field ends; sources stop 8 s after the release starts.
* **Felt mallet.** Sine fundamental + octave (0.16) + a marimba-like x3.98 partial (0.07); decay time constant 0.39 s at
  600 Hz (x (600/f)^0.35; 30% longer than the first version, so a note carries more energy for its peak); partial taus x1 /
  x0.45 / x0.18; 4 ms attack; each partial glides exponentially to -44 dB at five time constants and ramps to zero in 20
  ms. A 6 ms low-passed (1.3 kHz) noise "felt" contact. **Its echo is part of the note**: fundamental and octave again 3/4
  of a beat later (0.68 s), at 0.28 (-11 dB), 8 ms attack, on the other side of the stereo field.
* **Bubbles.** `musicBubble()`: the game's `bubble()` with a 1% upward settle (17 cents; the game's bubbles chirp ~30%),
  started 0.6 of the settle below the note, `soft` 2.2.
* **Session bus.** (pads -> pad fill -> pad room dip) + (mallets, echoes, bubbles -> melody room dip) -> slow duck -> fade-in
  -> fade-out -> pause fade -> out, explicitly stereo for its whole life. Fade-in: a raised-cosine `setValueCurveAtTime`
  0 -> 1 over 2.5 s; fade-out: 1 -> 0 over 1.4 s; the pause fade 0.15 s on its own node (so `setPaused(true)` during a 1.4 s
  music-off fade still silences within 0.15 s). Each curve runs once on its own gain node, so nothing is ever cancelled.
  No mallet in the first 1.2 s.
* **Slow duck (ceremonies).** -9 dB, `setTargetAtTime` only (attack tc 0.12 s, release tc 0.5 s); holds extend while asked;
  the 100 ms tick releases it when the last hold has passed.
* **Polyphony.** At most 6 sounding note groups per session by node lifetime: two slots kept for the pads, four for mallets +
  bubbles; a note that does not fit is dropped (8 of 346 in 10 minutes with the longer mallet ring).
* **Scheduler.** Live: the engine calls `advance(now + 0.4 s)` and `pollDuck(now)` from a 100 ms timer that only runs while a
  session plays or fades. `advance` plans whole bars (composer) one bar ahead but builds the nodes of a note only once its
  onset is inside the lookahead; a note that is already late (a stalled main thread) is dropped, a late pad starts now if
  its field has more than a second left. Offline, the probe calls `advance` once for the whole render; both give the same
  samples (checked, below).

### Room for the effects (round-3 fix, re-shaped by the audio-4 fix): the music steps back while you play

* **Who asks.** Every effect one-shot (poke, release, land, pop, blend, meterFull, capsule beats, bump, lift, toss,
  strandSnap) asks for a dip from the moment it is called (or from its onset, below) until **4.5 s after its own end**
  (`ROOM_TAIL_S`, the activity hold; it was 0.8 s). The held squish asks every update, by its own level: no dip below
  |rate| 0.15 /s (the squelch is then 40 dB under its maximum), the full dip from 0.7 /s, in proportion (dB) between. The
  held strand asks the same way by tension: no dip below 0.15, full from 0.5 (audio-4 fix; was 0..0.35), going down with a
  40 ms time constant. Each held update holds 0.25 s plus the same 4.5 s activity hold (requests are rounded: depth down to
  0.5 dB, end up to a 0.25 s grid, so a voice updated every frame re-plans a few times a second). Reveal and merge keep the
  slow -9 dB duck (capsule beats get both). The rule lives in `music.ts` (`oneShotRoom`, `squishRoom`, `strandRoom`,
  `roomClearDelay`, `ROOM_*`); the engine and the offline mix renders call the same functions.
* **How deep.** The melody (mallets, echoes, bubbles: tonal transients in the effects' own band, the part that most often
  covers a soft effect) dips 24 dB, the pad 0.72 of that in dB (17.3 dB), so a soft dark carpet stays under the play. With
  the music slider above 0.45 both dips deepen by the music's whole extra gain (at 1: 30 dB / 23.3 dB), so the music under an
  effect is never louder than at the default level. CUT-round fix: the pad used to deepen by only 0.72 of the extra gain (at 1:
  21.6 dB, i.e. 1.7 dB louder under an effect than at the default level, which contradicted this rule); now its share follows
  the volume (`music.ts roomPadShare`: the full pad dip is 0.72 x ROOM_DB - boost, a partial dip keeps the proportion).
  Probe: at music 1 the pad and the melody under a full dip sit at their default-volume level (see "Cut and reconnect",
  measured).
* **How fast down.** Attack time constant 1.5 ms for the melody (a note already ringing is the masker to remove), 6 ms for
  the pad (a sustained chord cut in 1.5 ms showed a splatter stripe at every dip onset in the spectrogram), starting 4 ms
  before the effect (the engine schedules every effect that far ahead of the call).
  * *Slow-onset voices wait (audio-4 fix).* A voice may declare `onset`: when it starts to be heard (within ~20 dB of its
    loudest). The lift declares its peel time minus 15 ms (its peel ticks stay more than 20 dB under the suction "thwop"
    that follows 50-80 ms later), the blend 90 ms (its motor spools up); their dip starts 5 ms before that instead of at
    the call. The toss declares none: its whoosh is audible from 30-60 ms but loud only from 70-115 ms, and a soft toss is
    hardly louder than the undipped pad in its own band (800-1600 Hz), so every later dip that was tried broke the in-band
    gate on isolated tosses (4.4-6.7 dB, gate 8).
  * *A fast effect onto music that is up waits 12 ms (audio-4 fix).* When the music's room level is above -6 dB (nobody
    has played for ~6 s), a poke, release, land, pop, bump, snap, meterFull or capsule beat starts 16 ms after its call
    instead of 4 ms (`ROOM_CLEAR_S`), so the dip has already removed a mallet note that was ringing when it was called.
    Before, a soft pop landing ~25 ms after a note began measured 8.4 LU over its loudest 20 ms frames: the frames that
    straddle its onset still held the undipped note (no causal dip can remove what was heard before the call). During play
    the music is already down and effects keep the 4 ms lookahead; slow-onset voices never wait. **Cost: the first tap after
    a rest sounds 12 ms later than the others** (probe: 16.0 / 4.0 / 4.0 ms for music up / down / off). CUT-round fix: the
    wait grows with the music volume above its default (`ROOM_CLEAR_S x (1 + boost / 6 dB)`: 24 ms at music 1, probe 28 ms
    after the call), because at the slider's top two large, low-pitched pops onto a pad that was up still sat under it after
    the pad fix (the independent verifier's music-1 placements; numbers in "Cut and reconnect", measured). The separation
    pop and the rejoin wait the same way.
* **How it comes back (audio-4 fix).** After the last hold the music returns **dB-linearly** (a fade: 24 dB in 2.0 s on the
  melody, 17.3 dB in 2.0 s on the pad, `ROOM_RETURN_S`), built from 0.2 s `setTargetAtTime` steps toward that line (setTarget
  only, so a later re-plan can take over anywhere without a jump). It was an exponential release (time constants 0.6 / 0.9 s),
  which from -17 dB gains ~6 dB in its first 0.25 s: a rebound. Back within 1 dB about 6.5-6.8 s after the last effect ends.
* **Holds stack as a staircase** (`MusicBed.makeRoom`): at every moment the deepest active hold wins; when it ends the next
  deepest takes over (a soft call never cuts a deeper one short); then the music returns. Calls come in time order, the only
  cancellation is of the room nodes' own future plan (and whatever a same-time request had planned at that instant is
  re-stated, so two requests in one audio quantum can never cancel each other's dip), so the gain never jumps.
* **What it means for a listener (not heard yet):** while you play, at any pace, the melody effectively rests (-24 dB) and a
  quiet pad (-17 dB) stays; it no longer comes and goes between taps. Rest for about 4.5 s and the music fades back in over
  2 s. Whether that reads as "the music makes way while I play" or as "the music goes away while I play" is the first thing
  to check by ear.

**Why this design (measured, music stem against the same music alone, the independent audio-3 verifier's scenarios and
metrics, engine seed 11, 60 s of play):**

| | sparse play (0.53 /s): gain std, 1 s loudness change p90 | play in bursts (5 s on / 5 s off) | isolated effects |
|---|---|---|---|
| round 3 (0.8 s tail, 0.6 / 0.9 s exponential release) | 7.64 dB, 20.2 LU | 8.41 dB, 16.8 LU | worst K 8.4 LU (a pop on a ringing note) |
| verifier's variant C (3 s tail, 1.0 / 1.5 s release) | 2.65 dB, 6.7 LU | 4.97 dB, 10.9 LU | not measured |
| pad-only activity hold (the melody keeps 0.8 s) | 3.24 dB, 12.4 LU | 4.75 dB, 13.5 LU | not measured |
| **chosen: 4.5 s activity hold on both layers, 2 s dB-linear return** | **2.09 dB, 6.0 LU** | **2.23 dB, 6.3 LU** | **see "What was measured (audio-4)"** |

Variant C's numbers are the verifier's. The music alone changes by 9.8 LU (p90) per second on its own (its phrasing). Holding
only the pad let the melody's notes pop back between effects over a dipped pad, which swung the stem about as much as variant
C in bursts and more than the music alone in both. The 4.5 s hold is what bridges the 5 s pauses of burst play; a shorter one
(variant C's 3 s) let the music swell back into most of them.

### The music: engine behaviour

* `unlock()` builds the context and, if music is wanted, starts a session inside the gesture. A session also (re)starts when
  the context reaches `running` (statechange), on `setPaused(false)`, on unmute and when the volume leaves 0.
* Stops (1.4 s fade): `setMusic({on:false})`, `muted`, music volume 0. Pause: `setPaused(true)` fades every session still
  sounding within 0.15 s (also one in a 1.4 s fade) and the effects (30 ms), suspends the context once they are silent and
  frees everything; without music it behaves exactly as before (immediate). A second `setPaused(true)` changes nothing.
  Resume starts a new session (fade-in 2.5 s); the composer continues where it was, it does not restart the piece.
* Ceremony duck: `capsuleBeat` (all three beats), `reveal`, `mergeStart` and its `burst` hold the slow duck until the voice's
  own end time. A session that starts during a ceremony (music switched on, unmuted or resumed mid-reveal) is ducked from
  its first note (round-3 fix; before, it played at full level over the ceremony). Master `duck()` (the Mythic pre-roll)
  still acts on everything. The held squish no longer uses the slow duck: it makes room by its level (above).
* A toggle storm cannot allocate a session per call: sessions start at most every 300 ms (later requests are deferred to the
  tick) and at most 6 fading sessions are kept.

### Interaction voices (round 3)

Levels after the master chain at master 1, canonical parameters (bump intensity 0.6, toss speed 0.6, snap tension 0.8,
strand: the scripted 1.45 s stretch + snap; the strand alone: the realistic stretch below).

| Voice | Recipe | peak | active RMS | active | min .. max peak (12 seeds) |
|---|---|---|---|---|---|
| bump | two thuds 14-34 ms apart (sooner when harder): 4-harmonic body falling `(122+74i)*pitch` Hz x0.64..0.56, the second x1.2-1.38 higher at 0.7; a wet slap (noise band-pass 1.3-2.6 kHz falling to x0.55 in 12 ms); 0-2 suction bubbles 1.8-4.2 mm | -10.3 dBFS | -22.4 | 115 ms | -19.2 .. -5.4 (intensity 0..1) |
| lift | peel: Poisson micro-ticks band-passed at 2.4 kHz, accelerating 80 -> 450 /s over 50-80 ms; thwop: a round tone sweeping UP 150 -> 360 Hz (tc 18 ms), air rushing in (low-passed noise opening 400 -> 1400 Hz), a trapped 2.5-4 mm bubble | -9.5 | -22.3 | 145 ms | -10.2 .. -8.9 |
| toss | (round-3 fix) a band of noise swept `400*pitch` Hz -> `min((900+2000*speed)*pitch, 3000)` Hz at 42% of its length -> back to 500 Hz, band-pass Q 2.6 (slow: a soft, followable "fff") -> 1.2 (fast), a high-pass at 0.6x the low end (no rumble), a low-pass `min((1700+2800*speed)*pitch, 4500)` Hz, a 9-13 Hz flutter; length 0.42 -> 0.26 s as speed rises; level `-5.5 .. -5 dB` by speed^1.5 (most of the soft-to-hard range now comes from bandwidth and brightness) | -9.0 | -26.0 | 205 ms | -19.2 .. -7.2 (speed 0..1) |
| strand (held) | (round-3 fix) the strand's own mode struck directly: a squeak carrier (sine + a whisper of 2nd harmonic, +/-12 cents tremble at 5-7 Hz) at `(1100+2100*T)*pitch` Hz, amplitude-pulsed by a stick-slip pulse train (cosine-phase pulse wave) at `(38+170*T^1.4)*pitch` Hz whose rate wobbles +/-70 and +/-35 cents (irregular slips); pulse depth 0.95 at T = 0 (separate creaks) -> 0.5 at T = 1 (a gritty continuous squeak); a band-pass (Q 2.6) and a low-pass at 2.2x follow the carrier; level `T^0.75 * (0.5 + 0.5 * motion)`, motion = |dT/dt| one-pole smoothed (60 ms), updates on the same audio-clock step merged | alone: -13.2 (with the snap: -7.2) | -23.0 (stretch + snap) | 1.37 s of the 1.45 s gesture + snap | alone, 12 seeds: -13.3 .. -13.1; with snap: -7.8 .. -5.6 |
| strandSnap | a 2-3 ms band-passed click (1.9 kHz), a round blip 1.15-1.3 kHz chirping up x1.6, a recoil flick 1.6-1.85 kHz falling to x0.5, then 1-3 tiny bubbles 0.7-1.6 mm (2-4.6 kHz) | -12.5 | -24.7 | 85 ms | -15.5 .. -10.4 (tension 0..1) |

* **Strand AM (audio-4 fix).** The stick-slip AM is `a(t) = base + mod * pulse(t)` and was meant to span `(1 - depth) .. 1`.
  The slip pulse (a normalised cosine-harmonic wave) has its own minimum at -0.136, not 0, and the first version set
  `base = 1 - depth`, so at depth 0.95 (tension 0) the gain swung -0.064 .. 0.886: a faint phase-inverted carrier between the
  slips and every slip 1 dB short. Now `base = 1 - d - d * min / (1 - min)` (`interact.ts strandAm`), checked on the real
  slip wave: 0.050 .. 1.000 at depth 0.95, 0.250 .. 1.000 at 0.75, 0.500 .. 1.000 at 0.5. The level was NOT re-calibrated,
  so the strand is a little louder than the round-3 numbers in the table: a realistic stretch peaks at -12.4 .. -12.5 dBFS
  (was -13.2), held still at 0.8 -24.5 dBFS RMS (was -25.8), at 0.2 -37.5 (was -39.7); live, stretch -12.5 dBFS peak, a held
  0.8 -16.1 dBFS peak (was -16.6).
* Measured (same seed, parameter extremes): bump intensity 0 -> 1 = -17.0 -> -5.8 dBFS peak, spectral centroid 146 -> 348 Hz;
  toss speed 0.1 -> 1 = -16.2 -> -7.4 dBFS, centroid 1082 -> 2855 Hz, its own -20 dB span 230 -> 130 ms; strand held still at
  tension 0.2 vs 0.8 = -39.7 -> -25.8 dBFS RMS (first version: -58.8 -> -47.3), resonance 1560 -> 2852 Hz; within one stretch
  gesture the squeak rises 1583 -> 2838 Hz; snap at tension 0 vs 1 = -13.6 -> -10.6 dBFS.
* Toss at the genome's top pitch 1.43 and speed 1 (12 seeds): max sample step 0.213 and 2.1% of the energy above 6 kHz (first
  version: 0.371 and 13.9%).
* **The strand at realistic call rates** (offline, strand alone, no snap; calls placed where the live engine sees them, on the
  audio clock's grid): a 1.2 s stretch to 0.85 + 0.25 s hold peaks at -13.2 dBFS whether called at 30 Hz with 30% jitter,
  45 Hz with 40% jitter on 10 ms audio callbacks, 60 Hz with 20% jitter on the 128-sample grid, 120 Hz on 10 ms callbacks
  (2-3 calls per step) or 60 Hz exact (spread 0.05 dB peak, 0.32 dB in the loudest 100 ms RMS); 12 seeds at jittered 32-54 Hz:
  -13.3..-13.1 dBFS. Live (the real engine, ~30 Hz jittered calls from timers, master 1): stretch peak -13.2 dBFS, a held 0.8
  -16.6 dBFS peak, freed after the calls stop.
* Pitch ratio 0.8 vs 1.25 (expected x1.5625, dominant frequency): bump x1.40, lift x1.44, snap x1.41, strand x1.57; toss
  centroid x1.49. Every voice: |DC| < 1e-5, tails -100 to -240 dBFS, > 6 kHz <= 0.17% at pitch 1.
* **Bump rate limit** (`BumpLimiter`, pure, also unit-checked with synthetic times): intensity < 0.04 is ignored (and so is a
  call with a non-finite clock: a NaN time used to poison the token bucket for good); two accepted bumps are >= 60 ms apart
  unless the new one is x1.6 harder; token bucket of 4 refilled at 6 /s; each bump accepted in the last 0.5 s makes the next
  one softer (x 1 / (1 + 0.35 n)). A pile settling (a bump every frame for 2 s) gives 15 taps at least 67 ms apart that
  soften (0.50 -> 0.29 intensity), not 120.
* **Strand cleanup** has three independent layers: every update re-arms a gain dead-man (silent 0.15 s after the last update,
  -65 dB another 0.15 s later) and keeps the sources' `stop()` 0.4-0.6 s ahead (a re-stoppable source: the last call wins,
  verified in Chromium 141; wrapped in try/catch); and the engine sweep ends any strand not updated for 0.4 s. Offline, a
  caller that simply stops at 0.8 s leaves the voice at -86.5 dBFS from +0.3 s, its sources ended 0.45 s after the last
  update and its nodes freed; live, the voice is gone 0.8 s after the last call.

### What was measured (round 3)

(The round-3 numbers as they were measured then. Where the audio-4 fix changed the design or the numbers, "What was measured
(audio-4 fix)" below has the current ones.)

`node _harness/probe_audio.mjs --only3` runs just this round (offline gates + live engine, ~16 min on a loaded container);
`--no-round3` skips it; a full run does rounds 1-3. Last full run: **554 of 555 checks pass (372 round-1/2 + 183 round-3). The one failure is the load-sensitive live playout check of the 9 s realistic session (1 audio fallback event over 9.0 s played, with the container at a load average of ~18 from other lanes); it passed (0 events) in the full run before (which failed only on two of my own new checks, corrected since: see known issues) and in a round-3-only run of the same final code right after (`--only3`: **183/183**, 0 fallback events)**. Numbers below are from that run unless
marked.

**Music, 90 s offline renders, seeds 1 and 2** (through the master chain, master 1, music 0.45): long-term RMS -28.7 / -28.9 dBFS
(band -30..-24), peak -11.7 / -13.1 dBFS (the limiter never acts), crest 17.0 / 15.8 dB, 99.9% of the energy below 2.5 kHz, 0.000%
above 6 kHz, every 10 s window within 2.4 dB of the long-term RMS (+/-3 allowed). Pitch set: every scored note in its
field's set and sounding over its own field; from the AUDIO, every isolated mallet note's strongest peak is the scored note
(worst 3.1 cents), and the three strongest pad peaks mid-field are the pad's pitch classes in every field. **Bubbles:**
energy-weighted pitch -3.7..-2.4 cents, spectral peak +3.8..+5.8 cents for every grace/trail note A5..D7 at score pitch 0.9 / 1 /
1.12 (gate +/-10).

**No repetition, determinism, behaviour** (unchanged rules, re-measured): onset autocorrelation < 0.7 and pitch-aware < 0.5 at
every lag 0.5-60 s for both seeds and 24 more scores; a 15 s loop control scores 1.000; same seed twice and live-like sliced
scheduling vs one-go agree to <= 2e-5; fade-in, stop, pause and resume never click (2nd difference and steps <= the unfaded
music) and are exact silence after their fades; the -9 dB ceremony duck as before.

**Separation, robustly** (section "mix robustness"): 4 music seeds (one is the engine's default composer seed) x 90 s, 20
effect variants (soft / medium / hard poke, release, land, pop, bump, toss; lift; snap; a strand stretch + snap called at a
random 30-60 Hz with 30% jitter on the audio clock's grid; a press-rub-release squish), each at a random pitch ratio in
0.70..1.43, at seeded random times (gaps log-uniform 0.15-4 s, so many arrive alone after a pause onto music at full
level); the music stem carries exactly the dips the engine would ask for. Per effect: in-band separation as the round-3
probe defined it (the 1/3-octave bands holding 70% of the effect's energy, over the frames within 20 dB of its loudest), and
loudness over the effect's own loudest 20 ms frames (within 10 dB of its loudest; effect over music, summed over exactly
those frames), K-weighted (BS.1770) and A-weighted.

| | worst placement | median | gate |
|---|---|---|---|
| in-band | 12.4 dB (a 0.15 toss, seed 2, pitch 0.75) | 54.3 dB | >= 8 dB, every placement |
| K-weighted | 11.7 LU (a 0.2 poke, seed 17, pitch 0.81) | 27.7 LU | >= 10 LU, every placement |
| A-weighted | 3.8 dB (a 0.2 poke, the engine's seed, pitch 0.80); 8 of 190 under 10 dB | 26.1 dB | reported (see known issues) |
| music volume 1 (+6 dB), 2 seeds x 60 s | in-band 11.8 dB; K worst 9.2 LU, 1 of 67 under 10 LU | | in-band >= 8 dB |

A separate scratch sweep (5 seeds x 120 s, 354 placements, the same rule) gave in-band >= 11.8 dB, K >= 11.6 LU, A-weighted
under 10 dB in 8 placements (worst 3.6 dB). Before the room dips, on the same kind of sweep (4 seeds x 90 s, effects 0.15-1.15 s apart, measured on the code as an
interrupted earlier fix attempt had left it: no dips, the pad already 5 dB under the verified first version, the music at
-31 dBFS): 9 of 295 placements under 8 dB in-band (worst -2.5 dB), 179 under 10 LU (worst -2.5 LU), 204 under 10 dB
A-weighted (worst -9.1 dB).

**The room dip itself** (section "music room dip"): melody -24.00 dB and pad -17.28 dB while held; the pad within 1 dB of
its depth 33 ms after the call; back within 1 dB 1.88 s after the hold ends, at most 1.04 dB per 20 ms, untouched outside
(< 0.01 dB); no click (steps and 2nd differences in and around the dip below the undipped music's); overlapping holds stack
as a staircase (pad -17.3 dB under a deep hold, then -4.7 dB under the shallow one it sat in (-4.3 expected), then -0.01 dB); the rule (`roomDb`,
`squishRoomDb`, `strandRoomDb`) checked value by value.

**The original 20 s mix sequence** (3 seeds x 13 effects, pitch 1): worst 20.4 dB in-band (a poke, seed 6; first version: 9.0 dB), the
mix equals the stems' sum to below -75 dB.

**Long run.** 3000 composed bars: every drift on a declared edge, every length 8/12/16 bars, every note in its field's set
and inside its own bar. 600 s scheduled like the live engine: scheduler cost per tick mean 0.031 ms, live notes <= 6
throughout (8 of 346 dropped by the cap), live audio nodes max 116, 0 after stop + free.

**Live engine** (headless Chromium 141, real `AudioContext`, `--mute-audio`): everything listed for the first version still
holds (no-ops before `unlock()`, one session at unlock, fade-in, scheduler cost, <= 6 live notes, ceremony duck, mute / volume
0 / pause / resume, hostile arguments, 200 toggles, bump limit, strand cleanup, 5000-trigger leak test back to the 10
master-chain nodes, dispose). New: a poke makes the music dip at once and it comes back ~2 s later; a session started
mid-reveal is ducked; `setPaused(true)` twice keeps the fade; the strand at ~30 Hz jittered calls peaks at -13.2 dBFS; every
source started around a pause cycle with a held squish and a charging merge reaches `ended` (47/47); calm capsule bursts peak
0.15-0.16 against 0.22-0.32; the silent buffer starts inside `unlock()` on a context that starts suspended; a 1.2 s main-thread
stall mid-merge schedules nothing into the past; one squeak `PeriodicWave` per context; blend 8 s x 8 / Mythic reveal /
Legendary merge build 34 / 36 / 65 nodes in the call (the old merge first slice: 85) and a stopped blend
builds nothing more; a held squish updated four times per audio step makes exactly as many bubbles as once (103 = 103; was
+56%); the iOS audio session goes playback / ambient / playback with sound on / muted / on.

### Findings that shaped round 3

* **A DelayNode echo made renders irreproducible.** With a ping-pong echo (DelayNode feedback), two identical offline renders
  differed by up to 2e-2; feed-forward, the live-like (sliced) render still differed from the one-go render by 1e-2. The
  echo now lives inside each note (scheduled oscillators), so live and offline renders agree.
* **Mono/stereo switching.** Whenever a panned node was connected or freed mid-render, the bus and the master chain switched
  between mono and stereo processing and restarted the new channel's filter/limiter state. Fixed by an explicitly stereo
  session bus and an explicitly stereo master bus (see Master chain).
* **Bubbles must not outlive their bag.** bump, lift and snap keep one source alive until the last bubble.
* **The first pad voicing masked the squishies** (D3-E4: the release over a G3 pad stood 0.9 dB above it); the pad moved to
  D4-F#5. That was not enough on its own (see the fix list at the top of this section): no register is free of effects.
* **Fixed separation was the wrong model.** A level that clears the effects on one sequence fails on another (a soft toss
  at pitch 0.9 on a lift-field pad: -5 dB). Only time-domain room (the dips) clears every placement; the worst remaining
  cases are always a note that had already started a few ms before a soft effect (causal: no dip can remove it).
* **A sparse melody carrying the level made it swing** (10 s windows -32.9..-26.8 dBFS with the phrasing) and delayed the
  fade-in's arrival at the steady level to the first note (3.7 s); the pad answering the melody (+5 dB in empty bars) brought
  the windows back to within 2.4 dB.
* **A fast dip on a sustained pad is itself audible** (a splatter stripe at every dip onset in the music stem's
  spectrogram): the pad got a 6 ms attack and a slower 0.9 s recovery, the melody keeps 1.5 ms.
* **The strand's level came from the filter, not the source.** A saw at 38-208 Hz through a Q-12 band-pass at 1.1-3.2 kHz
  passes one ~1/15-amplitude harmonic. Striking the mode directly made it 8.5 dB louder at the same nominal level (+7 dB more was
  then set on purpose), call-rate independent and thinner (the old high-tension sound was a 0.9-9 kHz saw comb, "kazoo").
* **A glide and a tuning do not mix.** A 5% chirp starting on the note reads 33-80 cents sharp depending on the measure;
  the two measures only agree within +/-10 cents when the glide itself is that small.

### What was measured (audio-4 fix)

The independent audio-3 verifier failed round 3 on one major and five minors; its scripts (a real-engine offline driver,
seeded play scenarios, pumping and placement analyses) were reproduced first (identical numbers on the round-3 code) and
then turned into permanent probe checks (`room_checks.mjs`, run inside `--only3` and the full run; `--only-room` alone takes
~4 min). Before = the round-3 code, after = this code; same scenarios, same seeds.

**Probe.** Last full run: **571 of 573 checks pass** (372 round-1/2 + 201 round-3 and audio-4: 183 round-3 checks, 16 new
room checks, the strand AM check, the unlock-retry check). The two failures were load-sensitive live checks (load average
17-23 from other lanes): the round-1 "30 taps/s: 0 playout fallback events" (1 event, 10 ms, over 7.5 s) and the round-3
audit "merge charge with a 1.2 s main-thread stall: nothing started in the past" (1 source 8 ms late); re-run alone right
after, both live groups passed in full (47/47 and 37/37: 0 fallback events, 0 late sources), and a round-3-only run of the
same code passed 201/201. Two round-3 live checks were re-specified for the new design, not loosened: "a poke makes the music
dip and it comes back about 2 s later" is now "dips at once, is still down 2.6 s later, lets go ~4.5 s after the poke", and
"recovers when the squish goes quiet" is now "still down 1 s into the quiet spell, lets go 5.3 s into it". The round-3 room
rule check now reads the declared constants instead of the old literal thresholds.

The probe's own isolated set (3 engine seeds x 240 s, 83 placements, music 0.45): in-band worst 13.2 dB (a squeeze), K worst
12.6 LU (a pop), A worst 10.6 dB, 0 under 10 dB; exposed gate (gated) max 20 ms (a lift); reported: toss 95 ms (median 75),
squish 140 (median 102), blend 80 (median 25). At music 1 (17): in-band 11.2 dB, K 14.9 LU, A 6.7 dB.

**1. Pumping (major).** The music stem against the same music with no play (engine seed 11, 60 s of play then 16 s of rest).
"Cycles" = the verifier's dip-and-swell count (the gain recovers >= 6 dB and is cut again >= 6 dB); "1 s change" = the change
of the music's momentary loudness (400 ms windows) over 1 s; the music alone measures 3.7 LU (median) / 9.8 LU (p90).

| scenario | before: cycles/min (median swing), gain std, 1 s change p50 / p90 | after | gate (new) |
|---|---|---|---|
| sparse (one gesture, then a 1-4 s rest; 0.53 /s) | 23 (19.3 dB), 7.64 dB, 9.6 / 20.2 LU | 9 (6.7 dB), 2.09 dB, 2.5 / 6.0 LU | std <= 3 dB, p90 <= music alone |
| bursts (5 s on at 3.5-5 /s, 5 s off) | 11 (19.1 dB), 8.41 dB, 3.7 / 16.8 LU | 11 (8.4 dB), 2.23 dB, 2.6 / 6.3 LU | same |
| dense (3-6 interactions /s) | 10 (8.4 dB), 2.67 dB, 2.7 / 6.4 LU | 9 (6.7 dB), 2.14 dB, 2.5 / 6.0 LU | same |

The remaining 9-11 "cycles" a minute are not gain changes: with the dip held constant, the stem's level over the music alone
moves between -17 dB (pad alone sounding) and -24 dB (a mallet note sounding) as the melody comes and goes; the round-3 dense
scenario, which also never came back up, showed the same 9-10 a minute. During play the gain's 95th percentile is now
-17.3 dB (sparse) / -17.1 dB (bursts) against -0.7 / -0.1 dB before (the music used to come all the way back between
gestures). After play stops the music is back within 1 dB 6.5-6.7 s after the last effect ends (gate <= 8 s).

**2-4. Separation.** Isolated placements are the hard case now: with a 4.5 s activity hold almost every effect in the
verifier's placement set (rests of 0.3-3.7 s) and in the round-3 probe's sweep (0.15-4 s) lands on music that is already
down. So the probe now also places effects 8-9.5 s apart, each onto music at full level, through the real engine (3 seeds x
240 s; the scratch runs below used 4 seeds x 240 s with different scenario seeds):

| | before: in-band / K / A worst (count under 8 dB / 10 LU / 10 dB) | after |
|---|---|---|
| isolated, music 0.45 (128 placements) | 13.9 dB / **8.4 LU** (a pop ~25 ms after a mallet note began) / 3.9 dB (0 / 1 / 9) | 16.4 dB / 13.7 LU / 10.5 dB (0 / 0 / 0) |
| isolated, music 1 (17) | 18.1 dB / **5.0 LU** / 0.7 dB (0 / 3 / 6) | 21.5 dB / 13.8 LU / 9.8 dB (0 / 0 / 1) |
| verifier's placements, music 0.45 (266, mostly onto dipped music) | 12.9 dB / 10.0 LU / 1.3 dB (0 / 0 / 6) | 12.9 dB / 12.6 LU / 1.3 dB (0 / 0 / 5) |
| verifier's placements, music 1 (43) | 13.7 dB / **2.8 LU** (a release at c 0.24 on a ringing note) / 1.9 dB (0 / 1 / 4) | 16.5 dB / 13.5 LU / 8.6 dB (0 / 0 / 1) |
| round-3 probe sweep (renderMix, 190 placements) | 12.4 dB / 11.7 LU / 3.8 dB (0 / 0 / 8) | 12.4 dB / 16.1 LU / 6.9 dB (0 / 0 / 3) |
| round-3 probe sweep at music 1 (67) | 11.8 dB / 9.2 LU (0 / 1 / -) | 11.8 dB / 12.1 LU (0 / 0 / -) |

The K-weighted shortfalls before were all one mechanism: a mallet note that began 20-30 ms before a short effect was called
sat, undipped, in the 20 ms frames that straddle the effect's onset. The 12 ms clear-the-way delay for fast effects onto
music that is up (above) removed them; at music volume 1 the worst is now 13.5-14.9 LU (finding 4).

**3. The exposed gate** (how long the music is already >= 8 dB down before the effect is within 10 dB of its own peak;
measured against the music alone, isolated placements; median / max in ms; the probe gates <= 40 ms for the fast one-shots,
the lift and the strand, and reports the rest):

| kind | before | after |
|---|---|---|
| lift | 67.5 / 80 | 15 / 20 |
| strand | 37.5 / 105 | 0 / 0 |
| blend | 115 / 175 | 27.5 / 87.5 |
| fast one-shots (poke, pop, land, bump, release, snap) | 0-5 / 7.5 | 5-12.5 / 17.5 (the music now clears 12 ms before them) |
| toss | 82.5 / 102.5 | unchanged (dip at the call, see "Room for the effects") |
| squish | 50 / 100 | unchanged (its in-band margin, 10-19 dB isolated, is the thinnest; its loudest bubble comes at a random moment) |

The verifier's own exposure measure compares with the 300 ms before the call, which also fires when a note simply decays;
on its placement set it still reports up to 50 ms (a lift), 123 ms (a strand, a squish) for effects that met music already
dipped by an earlier effect; against the music alone those are 0.

**5. Unlock retry.** Mock iOS context (starts suspended, `resume()` settles only inside a "gesture"): an `unlock()` 300 ms after
a gesture-less one: before, 0 `resume()` and 0 silent buffers inside the tap and the context stayed suspended; after, 1 and 1
inside the tap, and it runs.

**2. Strand AM.** At depth 0.95 / 0.75 / 0.5 the gain now spans 0.050..1.000 / 0.250..1.000 / 0.500..1.000 (before
-0.064..0.886 / 0.160..0.910 / 0.440..0.940); levels in "Interaction voices".

**The room dip itself** (probe, section "music room dip"): melody -24.00 dB and pad -17.28 dB while held, the pad within 1 dB
of its depth 33 ms after the call; back within 1 dB 1.90 s after the hold ends (before 1.88 s), at most 0.32 dB per 20 ms
(before 1.04: the old exponential release's first jump), untouched outside (0.000 dB); staircase -17.3 / -4.3 / -0.00 dB.

## Cut and reconnect (CUT round): the slice, the separation pop, the rejoin, whole again

**Unheard, like everything else here.** `_spec/CUT.md` sections 1-4: a squishy is sliced along a swipe (the waist pinches for
about 0.25 s, the pieces part), pieces can be cut again, and pieces flow back together one by one or all at once. Every claim
below is a measurement from rendered samples or a spectrogram PNG I looked at; "wet", "stringy", "crisp", "muffled", "gloopy"
and "gentle" are design intents, not findings. The recipes are our own; nothing is sampled or modelled on the reference clip.

### API (optional members of `SquishAudio`, exactly the signatures in `src/contracts.ts`, marked CUT)

| Member | What it does |
|---|---|
| `cut?({ phase: 'start', frac, neckS?, family?, pan?, calm? })` | The waist starts to form: a wet slice that lasts `neckS` (default 0.25 s, clamped 0.08-1.5 s) and climbs in pitch as the waist thins. `frac` = the smaller piece's fraction of the whole squishy (0.05..1; smaller = a little higher and lighter), `family` = the material family id (src/data/materials.ts; unknown = jelly gel). |
| `cut?({ phase: 'separate', frac, family?, pan?, calm? })` | The pieces part: a soft pop with 1-3 tiny bubbles; its pitch follows `frac` (1/8 of the whole sounds x1.74 higher than a half). |
| `rejoin?({ frac, all?, pan?, calm? })` | Two pieces flowed together: a gloopy "blorp" sized by `frac`, the merged piece's fraction of the whole (bigger = lower, longer, fuller). `all: true`: the squishy is whole again; adds a gentle rising flourish. |

`pitch?` (both calls, added to the contract after the first CUT report): the squishy's own pitch ratio (genome size, default 1,
clamped 0.5-2) scales every frequency and bubble size like the other voices' pitch, never the level (whole again keeps its run in
the music's key); probe: pitch 0.8 -> 1.25 moves the centroid x1.42 (slice), x1.52 (pop), x1.42 (rejoin), x1.13 (whole again),
and every voice x flavour at pitch 0.7 / 0.8 / 1.25 / 1.43 peaks at -14.2..-7.5 dBFS (60 renders; `--only-cut` 65/65).
`stats().started` gained `cut` (slices), `cutPop` (separation pops) and `rejoin`; `detailStats().throttled` gained `cut` and
`rejoin` (calls the rate limiter swallowed). Both voices go to the plain bus (`squishBoost` does not change them) and make room
in the music like every other effect (`registerFx`, the 4.5 s activity hold). The CUT kinds take their per-kind starting phase
from a stream of their own, so adding them changed none of the earlier voices' per-call seeds (a session with the same seed and
no cuts is bit-for-bit what it was; the probe's pumping numbers below are identical to the audio-4 ones).

### Flavours (CUT.md section 3)

| Flavour | Families | Slice | Separation pop |
|---|---|---|---|
| gel (crisp) | jellygel, gummy, waterfill | a bright tear 750 -> 2100 Hz (Q 4.5), short clean grains 70 -> 420 /s, a lively bubble stream (38 /s), short tail (0.14 neck) | a clean, bright plup, breath of air |
| sticky (longer, stringier) | stickystretch, slimegoo | a lower, wetter tear 430 -> 1350 Hz, many bigger (lower) bubbles (72 /s, x1.4 radius), and a stick-slip string from 0.3 of the neck that keeps stretching to 1.85 necks (560 -> 1500 Hz, slips 22 -> 95 /s) | softer, lower plup with a 130 ms stringy creak climbing behind it |
| foam (muffled) | slowrise, marshmallow | everything under a 1.1 kHz low-pass: a soft, slow tear 380 -> 1050 Hz, few bubbles | a puffy, low-passed pop |
| beads (a slight crunch) | beadsqueeze | a darker, wider, gritty tear 450 -> 1250 Hz (Q 2.5) with 16 bead ticks (2.1-3.4 kHz decaying sines, 3-6 ms) scattered through it | 3-5 bead ticks on the pop |
| dough (slow, sharp, dry) | putty, mochidough | a dense, dry tear (1.1 ms grains up to 560 /s, Q 5), almost no water, 3.2 kHz low-pass | a dull pop |
| firm (it resists) | firmsilicone, popdome | a tight, high tear 950 -> 2600 Hz (Q 6) with a short rubbery squeak (1250 -> 2500 Hz, fast slips) late in the neck; the shell gives it the longer 0.4 s neck | a snappy pop with a quick recoil flick |

### The slice (`cut.ts cutSlice`, phase 'start')

* **Tear.** Seeded noise feeds (a) a continuous hiss (0 -> 0.3 at 0.3 of the neck -> full at 0.9) and (b) a Poisson stream of
  torn-fibre micro-grains (1.1-4 ms, 30% attack; rate accelerating from the flavour's low to its high rate with progress^1.4;
  each 0.6-1 x the progress envelope 0.07 + 0.93 u^1.3, so about -20 dB of its peak a tenth of the way in), both through one
  band-pass whose centre glides exponentially from the flavour's low to its high band edge x size (start capped at 1.6 kHz, top
  at 3 kHz) over the neck: the pitch rises as the waist thins. The grains gate the noise before the filter (gating after it
  smeared every grain down to 50 Hz in the first spectrograms).
* **Squelch.** The same noise with an irregular flutter (13-19 Hz and 23-31 Hz) through two formants at 0.5x (Q 6) and 1.15x
  (Q 5) of the tear band, climbing with it; up to 0.25 at 0.3 of the neck, full at 0.88, then an exponential fade over the tail.
* **Bubbles.** A Poisson stream (rate x 0.3 -> 1 over the neck), at least two per slice; radii 1.2-4 mm x (1.25 -> 0.7 over the
  neck) / size, so they rise as it thins; never smaller than 1 mm.
* **String** (sticky, firm) and **crunch** (beads) as in the table. Through a 160 Hz high-pass and the flavour's low-pass.
* **Size and speed.** Size = (0.5 / frac)^0.25 x the +/-3% per-call jitter (1/8: x1.41); a smaller piece is also a lighter
  slice (level x (frac / 0.5)^0.12: -1.4 dB at 1/8), a quick neck a little snappier ((0.25 / neckS)^0.15: +1 dB at 0.12 s).
* **Room.** It builds over the neck, so it declares an onset (0.1 of the neck, about -20 dB of its peak): the music's dip waits
  for that. A later dip (0.3 of the neck, where it is within ~10 dB) was tried and measured: a muffled slice's early part then
  sat over the full music (in-band 9.0 dB at music 0.45 and 1.3 dB at music 1, isolated cuts), so the music makes way as the
  slice is first heard and its exposed gate is reported, not gated (like the toss).

### The separation pop (`cutPop`, phase 'separate')

* **Plup:** a [1, .28, .08] tone at 880 Hz x size x flavour (0.88-1.18; <= 2.6 kHz) gliding 0.8 -> 1.12 of that (time
  constant 12 ms): a rounded blip rising as the cavity between the pieces opens, no hard click; attack 0.8-3.5 ms, decay 11-26
  ms by flavour. Size = (0.5 / frac)^0.4: 1/8 x1.74, 1/4 x1.32, 1/2 x1, whole x0.76.
* **Body:** the pieces spring apart: a [1, .45, .15] thump at 175 Hz x sqrt(size x flavour), falling x0.72 (20 ms), 0.55 of the
  plup's level, decay 18 ms; it sits below the music's register (the pad starts at D4, 294 Hz).
* **Air:** band-passed noise at 1.5 kHz x size, 8 ms (none when calm). **Flavour:** as in the table.
* **Bubbles:** 1-3 (calm 1-2), radius 0.9-2 mm / size^0.6, never above 4.2 kHz, 18-80 ms after the pop.

### The rejoin (`rejoin`)

* Size z = (frac / 0.5)^0.35 (whole: 1.27, 1/8: 0.62); the tone settles near 1.05 x 290 Hz / z (measured: whole 246 Hz, 1/8
  527 Hz); length 0.22 + 0.22 frac s; level -17 .. -13.5 dB (dry) by sqrt(frac).
* **"bl"**: the necks touch: 3 + round(3 frac) merge bubbles (1.8-3.6 mm x sqrt(z), under ~2.3 kHz even as they chirp) in the
  first 50 ms, and a soft squelch (noise band-passed 1000 / z -> 480 / z Hz in 70 ms, Q 2.5, low-passed 1.6 kHz; 5 ms attack).
* **"orp"** (from 12 ms): a [1, .5, .22, .09] tone at 1.32 x the pitch gliding down to it (30 ms) and settling 5% up, through a
  low-pass closing 2400 / z -> 700 / z Hz (the blob darkening), wobbling (13 - 4 frac Hz, depth 0.32 dying away in ~0.12 s);
  attack 8 ms (calm 20). **"p"**: one closing bubble (2.5-3.5 mm) at 0.7-0.85 of its length.
* **Whole again (`all`)**: from 0.16 s a run of six tuned bubbles D5 E5 F#5 A5 B5 D6 (the music's own bubble, 1% settle; D major
  pentatonic, inside the collection every music field uses) 65 ms apart, over a soft glow from 0.28 s (D5 + A5 sines, 4.8 Hz
  +/-6 cent vibrato) that swells for 0.25 s and has faded 0.95 s after it began (the voice ends about 1.25 s after the call). Calm: four bubbles, 85 ms apart, softer and shorter. It has nothing of the
  merge ceremony burst (no noise "foomp" or crack, no bells, no tier motif) and nothing of the blender's bell flourish (no
  inharmonic partials).

### Rate limit and calm

* **`CutLimiter`** (pure; the engine keeps one for cuts and one for rejoins): slices at least 0.1 s apart, a burst of 3 then
  1.5 per second; separation pops 0.06 s apart, 3 then 1.5 /s; rejoins 0.08 s apart, 3 then 3 /s. Each accepted call of the same
  kind in the last 1 s (rejoins 0.6 s) makes the next one softer (x 1 / (1 + 0.3 n); rejoins 0.25 n). Whole again always plays,
  but not twice within 0.6 s. The engine also keeps the slice monophonic: a new slice fades the one still sounding (40 ms).
* **Calm** (DESIGN 6.6): 4 dB softer (the pop 6 dB), slower grain edges, darker (slice low-pass <= 3 kHz, pop <= 1.4 kHz), fewer
  bubbles, no breath of air, softer ticks and string, slower rejoin attack, a shorter and softer flourish.

### What was measured (CUT round)

`node _harness/probe_audio.mjs --only-cut` runs this round's 63 checks (64 with the page-error check; ~10 min on this loaded
container); a full run includes them. Last full run: **641 of 643 checks pass** (the 573 of the audio-4 fix + 70 new: 63 CUT
checks, the music-volume-1 pad check, the music-volume-1 latency check, 4 live-engine CUT checks in `engine_tests3.js` and the
lab page's CUT row). The two failures are the load-sensitive live playout checks again (round 1 "30 taps/s": 2 fallback events,
20 ms over 7.5 s; round 3 "9 s realistic session": 2 events over 9.0 s), with the container at a load average of 12-15 from the
other lanes; neither plays a CUT voice. Re-run right after on the same code, both groups passed in full: the round-1 live engine
group 51/51 (0 fallback events over 7.6 s) and a round-3-only run 190/190 (0 fallback events over 9.0 s).

**Levels** (post-chain, master 1; canonical: jelly gel, frac 0.5, neck 0.25 s; the "whole space" is every flavour x piece size
x neck x calm, two seeds each, plus 12 seeds at the canonical call):

| Voice | peak | active RMS | active | whole space: peak (renders) | max step | > 6 kHz |
|---|---|---|---|---|---|---|
| slice | -12.8 dBFS | -26.6 | 240 ms | -18.9 .. -5.3 (228) | 0.185 | <= 2.19% |
| separation pop | -11.0 | -23.9 | 75 ms | -17.8 .. -9.4 (108) | 0.112 | <= 0.07% |
| rejoin (frac 0.5) | -9.2 | -25.3 | 280 ms | -16.3 .. -7.5 (32) | 0.052 | 0.00% |
| rejoin all | -6.8 | -24.2 | 850 ms | -13.7 .. -7.2 (18) | 0.049 | 0.00% |

Every render: start/end sample and the steps within 2 ms of either end 0.000-0.035 (wet and dry; gate 0.25), tail at the
declared end -101 dBFS or lower, |DC| < 1e-5, finite with hostile arguments, pan -1 >= 211 dB left, the same seed identical to
1e-5. (Before the band and bubble caps a small, firm or gel piece's loudest moment reached a 0.248 sample step: high-frequency
noise at -6 dBFS, not a click, but too close to the gate; the caps and the lighter small pieces brought it to 0.185.)

**What the parameters do.** The slice's centroid (250-5000 Hz) over the last third of the neck vs the first: gel x1.61, sticky
x1.25, foam x1.47, beads x1.46, dough x1.84, firm x1.54 (gate >= 1.2). Its span within 30 dB of its loudest 10 ms follows the
neck: 0.18 / 0.27 / 0.49 / 1.00 s for necks of 0.15 / 0.25 / 0.5 / 1.0 s. The pop's plup by piece size 1/8, 1/4, 1/2, whole:
1559, 1207, 926, 703 Hz (monotonic; 1/8 vs 1/2 x1.68); the slice's centroid 2672, 2373, 2098, 1788 Hz. 1-3 bubbles after every
pop (1-2 calm), every flavour x 20 seeds. The rejoin by merged fraction 1/8, 1/4, 1/2, whole: 527, 410, 316, 246 Hz, 0.24 ->
0.38 s. Whole again: the run measures 585.8 / 658.3 / 739.5 / 878.1 / 987.6 / 1175.6 Hz (D5..D6, -4..+1 cents) and lasts 0.5 s
longer than a plain rejoin. Not the merge burst: 2.5-8 kHz energy in the first 30 ms 38.9 dB under the burst's (both at their
own levels), 1/3-octave profiles 28.0 dB (whole again) and 21.4 dB (rejoin) RMS apart.

**Each family distinct.** Slice spectra (3 seeds averaged) pairwise 3.8-17.7 dB RMS apart (closest sticky/dough; gate 3 dB);
pop spectra 4.0-13.5 dB (closest gel/firm; gate 2 dB). Sticky's slice spans 0.44 s against gel's 0.28 s; centroids gel 2241,
sticky 1254, foam 954 Hz; foam's share of energy above 2 kHz is -22.7 dB (slice) and -26.0 dB (pop) against gel's -2.8 / -3.2
dB; beads' slice has 5.3 short 2-4.2 kHz transients against gel's 1.0. The thresholds of the two pairwise checks were set before
measuring; the first design failed them (gel and beads 2.4-2.9 dB apart: the beads' tear was a gel tear with ticks), and the
beads were redesigned (a darker, wider tear, fewer bubbles, more ticks), not the thresholds.

**Calm.** For every voice and flavour, 3 seeds each: peak and active RMS at least 2.7 dB lower (worst -2.8 dB peak, -2.7 dB RMS;
gate -2.5), no larger sample step, no higher centroid. (A first calm with longer grains came out as loud as the normal slice in
dough: a longer grain rings a narrow band up higher. Calm now keeps the grains' length and slows their edges.)

**Rate limit.** Pure: 10 cuts in 2 s (a start and a separate each, 0.2 s apart) play 5 slices at 1.00 / 0.77 / 0.63 / 0.53 /
0.77 and 5 pops likewise; 6 rejoins in 0.25 s play 3 (1.00 / 0.80 / 0.67) and whole again plays, a second whole again 0.2 s
later does not, everything is back at full level after 3 s of quiet. Real engine offline (no music): the 10 cuts peak at -8.9
dBFS against -7.3 for one cut alone, their loudest 0.5 s RMS -25.9 against -27.0 dBFS, at most 3 voice groups alive, 5 slices
and 5 pops played, 10 calls throttled. Live engine (`engine_tests3.js`): 1500 cut / rejoin / poke calls in 1.6 s with the music
on played 5 slices, 5 pops and 10 rejoins (590 + 590 throttled), at most 35 groups and 392 nodes, peak 0.541, and drained back
to 0 groups, 0 nodes and the 10 chain nodes at the API surface; cut / rejoin before `unlock()` are counted no-ops (no context);
hostile arguments: 0 exceptions.

**Separation from the music** (real engine run offline, `engine_offline.js`; each cut, pop alone, rejoin or whole again placed
8-9.5 s after the last, onto music at full level; random family, piece size 1/8-1/2, neck 0.18-0.45 s, 25% calm; the probe's
measures from "What was measured (audio-4 fix)"):

| | placements | in-band worst (median) | K worst (median) | A worst | exposed gate (max, ms) |
|---|---|---|---|---|---|
| music 0.45, 3 engine seeds x 200 s | 85 (25 cuts, 34 pops, 16 rejoins, 10 whole again) | 12.0 dB (43.2), a calm rejoin | 12.3 LU (24.7), a calm gel pop | 13.1 dB, 0 under 10 | pop 10, rejoin 27, whole again 30 (gate 40); slice 230 (median 118), reported |
| music 1, seed 55 x 160 s | 23 | 12.8 dB, a calm marshmallow slice | 13.8 LU | 10.2 dB | |

Per kind at music 0.45 (worst in-band / K / A): slice 15.6 dB / 15.9 LU / 17.1 dB, pop 17.7 / 12.3 / 17.0, rejoin 12.0 / 15.8 /
13.1, whole again 20.4 / 20.7 / 20.5. The rejoin's "orp" first started 35 ms in: its exposed gate measured 42 ms (whole again
55 ms); it now starts 12 ms in.

**The music-volume-1 fix** (the independent audio-3 verifier's pre-existing minor). Two changes, each measured on the verifier's
own music-1 placement set (its scenario 704, engine seed 55, 41 isolated effects, its `ana_place.mjs`), re-run through the real
engine with identical effect seeds:

| | in-band: worst, under 8 dB | K: worst, under 10 LU | A: worst, under 10 dB | medians in-band / K / A |
|---|---|---|---|---|
| before (HEAD) | 4.5 dB (a large, low pop, 630/794 Hz bands), 2 (pops 4.5 and 6.0) | 8.2 LU, 3 | 9.1 dB, 4 | 38.7 / 22.3 / 19.8 |
| pad dip = 0.72 x ROOM_DB - boost only | 4.7 dB, 2 (4.7, 6.2) | 8.6 LU, 2 | 9.4 dB, 1 | 40.1 / 23.4 / 21.5 |
| + clearing delay x2 at music 1 (this code) | 12.5 dB, 0 | 10.2 LU, 0 | 9.4 dB, 1 (a strand) | 43.0 / 25.9 / 24.1 |

The pad fix alone moved those two pops by only 0.2 dB: what covered them was the undipped pad of the 15-25 ms before and around
the call (for the first of them the pad was up with the lift field's F#5, 740 Hz, in the pop's own band), which no dip can
remove; at music 1 that pad is 6 dB louder. Doubling the clear-the-way delay at music 1 (24 ms instead of 12) gives the pad's 6 ms dip time to act first.
Probe: the pad and the melody under a full dip at music 1 sit at their default-volume level (0.00 / -0.00 dB; the pad's dip
-23.28 dB = 0.72 x ROOM_DB - 6); a poke onto music that is up starts 28.0 ms after its call at music 1 (16.0 at the default,
4.0 with the music down or off). The probe's own isolated music-1 set (17 placements): in-band worst 16.3 dB (was 11.2), K 19.1
LU (was 14.9), A 10.6 dB (was 6.7); the round-3 renderMix sweep at music 1: in-band 13.5 dB (was 11.8), K 13.1 LU (was 12.1).

**Pumping still holds.** At the default volume nothing changed (the probe, engine seed 11: sparse / bursts / dense gain std
2.09 / 2.23 / 2.14 dB, 1 s loudness change p90 6.0 / 6.3 / 6.0 LU against 9.8 for the music alone, back within 1 dB 6.74 / 6.57 /
6.49 s after the last effect: identical to the audio-4 numbers). At music 1 (the verifier's scenarios and its `ana_pump.mjs`,
before -> after): sparse std 2.49 -> 2.12 dB, dip-and-swell cycles 18 -> 9 /min, 1 s change p90 5.4 -> 6.0 LU; bursts 2.61 ->
2.27 dB, 18 -> 11 /min, 5.7 -> 6.3 LU; dense 2.55 -> 2.19 dB, 18 -> 9 /min, 5.4 -> 6.0 LU (music alone 9.8 LU); the music's
level during play (p50 of its gain over the same music alone) -22.2 -> -23.9 dB: 6 dB deeper than at the default volume
(-17.9 dB), so under play the music sits at the same absolute level whatever the slider says.

### Findings that shaped the CUT round

* **Gate the noise before the band-pass.** Torn-fibre grains gated after the filter spread every grain down to 50 Hz (vertical
  stripes in every slice spectrogram); gating the noise first keeps each grain inside the climbing band.
* **The loudest moment of a noisy voice is a max statistic.** The first slices ranged 12 dB in peak over the parameter space
  (random grains, sometimes no bubble at all in a short neck): the level now rides on the continuous hiss and squelch, the grains
  vary 0.6-1 instead of 0.35-1, there are always at least two bubbles, and a quick neck / a big piece are trimmed by +-1 dB.
* **A dip that waits for a building sound costs separation.** See the slice's room above (9.0 / 1.3 dB in-band).
* **A fixed starting-phase draw per voice kind shifts every seed.** Adding three kinds to the engine's per-kind round-robin
  consumed three more draws of the engine's seeded stream at creation and changed every later voice's per-call seed (the
  first comparison with HEAD differed in every effect). The CUT kinds now draw from a stream of their own.
* **At music 1 the pad was not what covered the low pops.** See the table above: the pre-call pad was.

### When the shell should call what (CUT)

| Call | When | From |
|---|---|---|
| `cut({ phase: 'start', frac, neckS, family, pan, calm })` | once, when the waist starts to form (the shell starts `setNeck`) | `frac` = the smaller side's share of the WHOLE squishy (`measureCut` of the body x the body's own `frac`), `neckS` = the neck time the shell animates (about 0.25 s; 0.4 s for firm silicone and pop dome), `family` = the genome's material family id, `pan` = `panOfPoint(cut centre)`, `calm` = Calm effects |
| `cut({ phase: 'separate', frac, family, pan, calm })` | once, when the neck parts (the t = 1 swap to two pieces) | same values |
| `rejoin({ frac, pan, calm })` | each time a piece has flowed into another (the giver removed) | `frac` = the merged piece's share of the whole |
| `rejoin({ frac: 1, all: true, pan, calm })` | once, when the squishy is whole again (the end of Reconnect all, or the reconnect that makes it whole); the per-piece merges of Reconnect all may call `rejoin({ frac })` each: the limiter keeps 3 | |
| nothing | a refused cut (too small, too many pieces), the instant reconnect when the squishy is off screen | |

The separation pop of sticky and slime already carries a short stringy creak, and the slice a stretching string: do not also
drive `strand()` for the strand drawn between the parting pieces (the two would double up).

### What a human should listen for (CUT)

Play `cut_gel.wav`, `cut_sticky.wav`, `cut_foam.wav`, `cut_beads.wav`, `cut_dough.wav`, `cut_firm.wav` (a whole cut each: the
slice, then the pop), `rejoin.wav`, `rejoin_all.wav`, `cut_storm.wav` (10 cuts in 2 s) and `cut_story_mix.wav` (six cuts, three
rejoins and whole again over the music), or use the "Cut and reconnect" row of the sound lab.

- [ ] **Slice**: does it read as a wet jelly being cut (a squelchy tear whose pitch climbs as the waist thins), or as paper
      tearing, static, or a zipper? Does its length feel tied to the pinch on screen?
- [ ] **Families**: gel crisp, slime long and stringy, marshmallow muffled, beads with a slight crunch, putty dry and dense, pop
      dome rubbery: can you tell them apart blind? Is the slime's string charming or a creaky door?
- [ ] **Separation pop**: a soft "plup" as the pieces part, not a drum hit, a thud or a UI click? Does a small chunk sound
      smaller (higher) than a half? Are the 1-3 tiny bubbles a nice wet tail or fussy?
- [ ] **Rejoin**: a gloopy "blorp" (two blobs flowing into one), not a burp, a boing or a drum? Do bigger merges sound bigger?
- [ ] **Whole again**: a gentle, rising "complete" flourish that is clearly not the merge ceremony or the blender's finish? Is
      the soft glow under it too long or too sweet? In tune with the music when it is on?
- [ ] **10 quick cuts**: does it thin out and soften gracefully, or does the cut-off of the previous slice sound chopped?
- [ ] **Calm**: softer and rounder, still clearly the same family?
- [ ] **Music**: the music makes way as the slice starts (it waits until the slice is first heard). Does the dip ever arrive
      noticeably before the slice is audible?

### Known issues (CUT round)

* CUT: **unheard.** Every word of character above ("wet", "stringy", "crisp", "muffled", "gloopy", "gentle") is a design intent.
* CUT: **the slice's exposed gate is reported, not gated**: the music is >= 8 dB down up to 230 ms (median 118) before a slice is
  within 10 dB of its own peak, because the slice builds over the whole neck and the dip starts when it is first heard (about
  -20 dB). A later dip failed the in-band gate (above). Whether the music audibly leaves before the slice is there is unverified.
* CUT: **no `pitch`**: the contract's `cut` / `rejoin` take no genome pitch ratio, so a big and a small squishy cut the same way
  apart from the piece's fraction. An optional `pitch?` on both (additive) would let them follow the genome like every other
  voice; not added (contracts.ts is not in the audio lane).
* CUT: **one slice at a time**: two squishies cut within one neck time share the slice (the first is faded in 40 ms). Slices and
  pops have separate token buckets: a throttled slice can still get its pop, and the other way round.
* CUT: `frac` must be the share of the WHOLE squishy; a piece's body-local share would make pieces of pieces sound too big.
* CUT: the dough (putty, mochi) and firm (silicone, pop dome) flavours are my reading of CUT.md section 3; the brief named only
  gel, sticky, foam and beads.
* CUT: the separation pop's body (175 Hz x size) is below what phone speakers play; its plup (700-1560 Hz) and partials carry it.
* CUT: whole again is tuned to D major pentatonic without the per-call jitter (in tune with every music field); its soft glow (a
  sustained fifth for ~1 s) may read as too sweet. The tuned bubbles show the same broadband onset stripes in a spectrogram as the
  music's own bubbles (no click by the probe's step measures).
* CUT: the rejoin glides down like the poke's and the land's bodies, slower and with merge bubbles and a wobble; on a phone
  speaker it may still be heard as a slow "thup".
* CUT: muted cut / rejoin calls still spend the limiter's tokens (harmless: nothing plays).
* Music-volume-1 fix: at music 1 the first fast effect after a rest now sounds 24 ms later than the others (28 ms after its
  call instead of 4; at the default level 12 ms later, as before). The verifier's music-1 set still has one A-weighted placement under 10 dB (a strand, 9.4 dB) and
  its worst K-weighted placement is 10.2 LU; these were not changed.

## What a human should listen for (first listen)

Play `_harness/_renders/all_voices.wav` (poke, squish, release, land, pop, blend, 0.5 s apart) and the `_min` / `_max` /
`_pitch0.80` / `_pitch1.25` variants, or open the sound lab (`npx vite --port 5363`, then `/_harness/audioview/index.html`).
Check:

- [ ] **Poke**: reads as a soft, slightly wet "thup" on a squishy toy (not a drum hit, not a beep). Is the little wet blip
      on top charming or annoying on every tap? Does intensity feel natural from ghost-touch to hard tap?
- [ ] **Squish**: while pressing, does the movement itself make the sound (stops dead when you hold still, speeds up when you
      rub)? Is it "wet and bubbly" or "hissy/boiling"? Does the 17-35 Hz flutter sound granular or like a tremolo/motorboat?
      Do the rising formants on squeeze and falling ones on spring-back read as air going in and out?
- [ ] **Release**: an upward "bloop" with a quick wobble; does it match the visual spring-back? Is the wobble cute or seasick?
- [ ] **Land**: a low soft plop; is it too low/inaudible on laptop speakers? Does it clash with the poke when both happen?
- [ ] **Pop**: click, then a quick upward blip; does it read as a bubble (not a coin/UI ping)? 2-5 ms click harsh on headphones?
- [ ] **Blend**: a motor that spools up and wavers, slosh, a few glass clinks, then a rising bell. Does the motor sound like a
      blender or like an electric razor/bee? Is the bell flourish "finished!" or too musical/sweet?
- [ ] **Loudness balance**: peaks are poke -10, squish -7.5, release -9.4, land -11, pop -12, blend -9 dBFS. Does anything
      jump out? Is the default master (0.8 = -3.9 dB) right? Does "Louder squish" (+9 dB) get harsh or just loud?
- [ ] **Pitch variety**: `pitch0.80` (big, firm... lower) vs `pitch1.25`: still the same toy, just smaller/bigger? Does the +/-3%
      per-call variation make repeated pokes feel alive rather than machine-gunned?
- [ ] **No clicks or pops** anywhere (the probe says none above 0.13 sample step; ears decide), including when 24+ voices overlap
      and the oldest is stolen.
- [ ] On a phone speaker: poke/land/release have audible mid harmonics (body fundamentals are below 260 Hz and would vanish).

Round 2 (play `reveal_<tier>.wav` in order, then `ceremony_capsule_<tier>.wav` and `ceremony_merge_<tier>.wav`, `reveal_mythic_v0..2.wav`, `meterFull.wav`, or use the ceremony row of the sound lab):

- [ ] **Escalation**: is each tier clearly "more" than the one before without being louder (Common soft bloop -> Uncommon chime -> Rare bells -> Epic swell/arpeggio ->
      Legendary choir/chord -> Mythic)? Can you name the tier blind, from the sound alone? (DESIGN 6.6: sound is one of the three non-colour cues.)
- [ ] **Intervals**: do the Uncommon third, Rare fifth and Legendary ninth sound like what they are, or like a detuned toy? Do the three Mythic motifs read as three different tunes, each one
      "belonging" to a species?
- [ ] **Pre-roll**: do Rare/Epic/Legendary/Mythic build tension before the burst, and does the Mythic 250 ms hush read as "something big is about to happen" rather than as a dropout?
- [ ] **Burst vs motif**: does the pop + short stinger at the burst feel like the shell breaking, and the motif 0.35 s later like the reveal, without doubling?
- [ ] **No spoilers**: do grab and crack sound identical for every tier (they should)?
- [ ] **Merge**: hum rising a fifth, squelch brightening, ticks getting denser: does it read as "pressure building"? Is the burst a satisfying release? Is the 80 Hz hum audible at all on your speakers (the 160/240 Hz partials carry it)?
- [ ] **Tier-up ladder and NEW sparkle**: a rising flourish on top of the motif, not a second melody fighting it? Is the sparkle charming or shrill?
- [ ] **Calm**: shorter, softer, no sudden edges, still clearly the right tier?
- [ ] **Duck**: does the Mythic duck feel smooth (no pumping, no click)? Is -14 dB for 250 ms the right depth?
- [ ] **Meter full**: a pleasant two-note "plink-plonk", not alarm-like, and quiet enough while squeezing?

### When the shell should call what (round 3)

| Call | When | From |
|---|---|---|
| `setMusic({ on: music > 0, volume: music })` | once at boot (it is safe before `unlock()`; the music starts inside the unlock gesture) and whenever the Music slider moves. `setSettings({ music })` is equivalent for the volume. | `Settings.music` (new shell setting, default 0.45) |
| nothing | mute, master, tab hidden (`setPaused`), the ceremony duck and the room dips under every effect (squish and strand included) are handled inside the engine: the shell does not duck or stop the music itself | |
| `bump({ intensity, pitch, pan })` | the rising edge of a body-to-body contact (two bodies start touching), once per contact; not every frame of a resting contact. `intensity = clamp(|v_rel . n| / 2.5 m/s, 0, 1)` (relative normal speed at contact); skip below ~0.04 (the engine ignores those anyway). `pitch` = the mean `pitchRatio` of the two genomes, `pan` = `panOfPoint(contact point)`. The engine thins a settling pile by itself. | PHYS stage B contact events; until they exist, the shell can detect it from body centres: the rising edge of distance(centreA, centreB) < 0.95 (rA + rB) (the 0.95 keeps two bodies merely resting side by side from re-triggering; this matches the round-3 api_for_shell note, which an earlier SOUND.md contradicted) |
| `lift({ pitch, pan })` | once, when a pulled body passes its family's pull limit and comes off the mat (picked up): the rising edge of "grabbed and no longer grounded", or of `metrics.stretch >= 1` while grabbed | PHYS pick-up transition / `metrics.grabbed`, `metrics.grounded`, `metrics.stretch` |
| `toss({ speed, pan })` | once, when a picked-up body is let go with speed: `speed = clamp(|v_release| / 4 m/s, 0, 1)`, only if `speed > 0.1` | the body's centre velocity at `grabRelease` |
| `strand({ tension, pitch, pan })` | EVERY FRAME while a tacky strand exists (Sticky Stretch, Slime Goo), at the render loop's own rate (30-120 Hz and jitter make no difference), `tension` 0..1 = strand length / its breaking length (or `metrics.stretch` during a tacky pull until render/PHYS expose a strand length); just stop calling when it relaxes | render strands / PHYS tack |
| `strand({ tension, snap: true, pitch, pan })` | once, when the strand breaks (necks past its limit). It already contains 1-3 bubble pops: do not also schedule `pop()` bubbles for the same snap | the strand-break event |

### What a human should listen for (round 3)

Play `music_seed1_90s.wav` and `music_seed2_90s.wav`, then `mix_sweep.wav` (music + effects at random pitches and times; the
music stepping back is the point to judge), `mix.wav`, `round3_voices.wav` (bump, lift, toss, strand snap, strand stretch +
snap), or use the round-3 row of the sound lab (music toggle and slider, Bump, Lift, Toss, hold Strand).

- [ ] **Mood**: does the bed read as gentle, warm and a little playful (a toy under a warm lamp at dusk), or as sleepy,
      sad, or "hold music"? Is 66 BPM with a light swing calm without dragging?
- [ ] **Pad**: sines that breathe tone by tone and swell when the melody rests. Alive and warm, or vague and seasick? Does the
      swelling in empty bars feel like an answer to the melody or like a volume knob being turned?
- [ ] **Field changes**: do home -> lift (lydian C#) -> dusk -> glow drifts feel like light changing, or are they unnoticeable?
- [ ] **Mallet and echo**: a soft wooden/felt toy instrument (not a music box, not a ringtone)? Its ring is 30% longer than
      in the first version: warmer or muddier? Is the -11 dB echo on the other side spacious or distracting?
- [ ] **Bubbles in the music**: they now settle only 1% (in tune). Do they still read as a wink to the squishies' bubbles,
      or have they become plain "plinks"?
- [ ] **The room dips (the main question)**: under every effect the melody drops 24 dB in ~2 ms and the pad 17 dB in ~20 ms;
      audio-4 fix: the music now STAYS down while you play at any pace (until 4.5 s after the last effect) and then fades
      back in over 2 s. Play `room_sparse_mix.wav` (a gesture every 1-4 s) and `room_bursts_mix.wav` (5 s on, 5 s off) from
      `_harness/_renders/`: is it steady, or do you still hear it come and go? Does the music "making way" feel natural or
      like it has been switched off while you play? Does the 2 s return after a rest feel like a gentle fade-in or a swell?
      Is the quick drop of a ringing mallet note ever heard as a click or a chopped note? Is the soft pad left underneath
      enough to still feel "music is on"? Does the first tap after a rest feel any later than the others (it is, by 12 ms)?
- [ ] **Balance**: with the music at the default (0.45), are the softest effects (a 0.2 poke, a 0.15 bump, a 0.15 toss) clearly
      in front? Is the music too loud or too quiet when nobody plays? At the slider's top (music 1)?
- [ ] **Ceremony duck**: under a capsule/reveal/merge the music dips 9 dB (slowly) and comes back in ~0.9 s. Smooth?
- [ ] **Start/stop/pause**: no click at the 2.5 s fade-in, the 1.4 s fade-out or the 0.15 s tab-hide fade?
- [ ] **Bump**: a soft double thud with a wet slap, not a drum or a punch? A settling pile: a few thinning taps?
- [ ] **Lift**: does the crackle-then-"thwop" read as unsticking from a tacky mat? It ends on a small bubble like the bump
      does: too similar?
- [ ] **Toss**: a soft whoosh you can follow up and down (narrow when slow, wider when fast), not wind noise or a sword swish?
- [ ] **Strand**: separate creaks that tighten into a thin squeak as it stretches? Loud enough now, or too loud / shrill when
      held for seconds (a held 0.8 is -25.8 dBFS RMS around 2.8 kHz)? Is the snap satisfying?

## Known issues and caveats

* Unverified by ear (above). All tuning was done from spectrograms and numbers.
* CUT round: the cut and rejoin voices have their own list, "Known issues (CUT round)" in "Cut and reconnect".
* The chain's compressor is Chromium-tuned (release 12 ms). Other browsers' `DynamicsCompressorNode` may treat very short
  events differently; levels could differ by a few dB for the 2-5 ms pop click. Not tested outside Chromium 141.
* Headless playout has a null sink: "0 fallback events" is evidence for the 30 taps/s case on this container, not a
  guarantee on a phone. Under a 770 voices/s storm it does glitch.
* Per-trigger main-thread cost is ~0.5 ms here (about 15-25 nodes per voice, plus bubbles); fine at 30 taps/s, not free.
* A held squish at high rate creates up to ~95 two-node bubbles per second; each lives 10-260 ms.
* `blend` ignores the physics: it is a pre-scheduled one-shot (`stop()` cuts it).
* Same-seed repeatability is bit-exact for the voice code only up to Chromium's own float noise (~1e-5); not tested elsewhere.
* Round 2: the reveal `durationS` semantics (time from the call; Rare+ include the pre-roll) are mine, derived from DESIGN 6.1/6.3, because the contract only says "fits the budget".
  The shell must follow the time map above for the sounds to land on the visuals.
* Round 2: the merge charge audio is tier-neutral (the visual tell in DESIGN 6.4 has no audio twin); say so if you want a subtle audible tell.
* Round 2: the Mythic sub-bass (55 Hz) is inaudible on phone and laptop speakers; its 110/165 Hz partials and the choir carry the swell there. On headphones it is the loudest energy in that tier.
* Round 2: the Rare merge ceremony peaks at -3.8 dBFS at the burst (tier-up ladder + bells + noise transient); still 2.8 dB under the ceiling, but it is the hottest thing in the lane.
* Round 2: under a storm of 500 ceremony triggers per second (the leak test, about 17x anything a player can do) the playout stats reported 737 fallback events over 16 s; realistic
  ceremonies measured 0. The same caveat as before: the null audio sink of headless Chromium says nothing about phones.
* Round 2 (corrected in round 3): `mergeStart` schedules its first 0.2 s of squelch/ticks in the call (`MERGE_FIRST_SLICE_S` in engine.ts; this text said 0.12 s until the audio-4 fix, which did not match the code) and the 80 ms pump the rest, 0.5 s ahead. A main thread stalled for longer than that leaves a GAP in both the squelch and the ticks (only the pre-scheduled hum continues; the old text said the ticks continue, which was wrong). Round-3 audit fix: after a stall the missed slices are skipped instead of being piled onto "now" with start times in the past (probe: a 1.2 s busy-wait mid-charge, then 0 sources started late). The same holds for every pumped voice (blend, reveal, burst): late pieces are dropped.
* Round 2 spectral "peak count" and "spread" are definitions I made up to quantify "richer" and "wider"; they are monotone by construction of the design, not evidence that listeners will hear richness.
* In-flight bubbles on a context that is closed or suspended keep their (already disconnected) nodes until the page releases
  them; the bookkeeping counter shows 2 nodes after the dispose test. They are not connected to anything.
* Round 3: **still unheard**, like everything else, including the round-3 fix. The music's "mood" and the feel of the room
  dips are entirely unverified; the rules were chosen on paper and checked only for what can be measured.
* Round 3: **the room dips are a strong design choice**: while the player keeps playing, the melody is effectively silent
  (-24 dB) and only a soft pad (-17 dB) remains; since the audio-4 fix it stays that way through pauses of up to 4.5 s and
  fades back over 2 s after that (before: ~2 s after every effect, which pumped in casual play). That is what clears every
  effect in every placement; it may also read as pumping or as the music "going away" during play. Shallower dips fail the
  measured requirements (at -12/-12 dB with 0.3 s release: K-weighted worst 1.0 LU, the strand aside; at -14/-18 with no
  tail: 7.9 LU for a soft toss under a mallet).
* Round 3: **A-weighted, a few soft low effects are still within 10 dB of the music** over their loudest 20 ms frames (in the
  last full run 8 of 190 placements, worst 3.8 dB (a 0.2 poke, the engine's seed, pitch 0.80); 8 of 190 under 10 dB; the scratch sweep: 8 of 354, worst 3.6 dB): a 0.2 poke or a 0.15 bump landing
  within a few ms of a mallet attack that had already started before the effect was called. Over the rest of the effect the
  same placements are 10-15 dB clear. No causal dip can remove a note that began before the effect; A-weighting also
  discounts their 60-300 Hz bodies by 10-20 dB. K-weighting (the gate) passes everywhere. (Audio-4 fix: the 12 ms
  clear-the-way delay for fast effects onto music that is up removes most of this: isolated placements now measure A-weighted
  >= 10.5 dB at the default volume, the round-3 sweep 3 of 190 under 10 dB, worst 6.9 dB.)
* Round 3: at music volume 1 (+6 dB, the slider's top) the dips deepen by 6 dB and in-band separation holds (>= 8 dB), but
  K-weighted 1 of 67 placements falls under 10 LU (worst 9.2 LU: a 0.3 land, the same kind of onset collision with a 6 dB louder pre-onset note).
  (Audio-4 fix: the verifier then found 2.8 LU (a soft release on a ringing note) and the new isolated test 5.0 LU (a bump);
  with the 12 ms clear-the-way delay they measure 13.5 and 13.8 LU, and the sweep 12.1 LU, 0 of 67 under 10.)
  (CUT round: the verifier's music-1 set still had two large, low-pitched pops at 4.5 / 6.0 dB in-band and the pad's dip
  deepened by only 0.72 of the boost; the pad now dips by the whole boost and the clearing delay doubles at music 1: 12.5 dB
  worst in-band on that set, 0 under 8 dB; see "Cut and reconnect", measured.)
* Round 3: the loudness check is my own definition (K- and A-weighted level of the effect over the music, summed over the
  effect's own loudest 20 ms frames, within 10 dB of its loudest). EBU short-term loudness (3 s) would dilute a 45 ms pop to
  nothing; a 100 ms window caps short effects because it includes undipped music before the onset. Gating every placement
  of soft, medium and hard variants (not a median) was decided before the final numbers were known.
* Round 3: thresholds of my NEW round-3-fix checks were set with these measurements in view: the room-dip recovery bound
  (<= 1.5 dB per 20 ms: an exponential return from -17 dB starts at ~1-1.2 dB per 20 ms), the merge first-slice node count
  (fewer than the old 0.5 s slice measured with the same counter, instead of an absolute bound I had guessed), the
  strand-hold audibility (>= -32 dBFS RMS, set between the old -47 and the new -25.8). The full run before the last one
  failed two of these new checks, and both were looked into rather than loosened: the merge's first slice was not smaller
  (87 nodes vs 85) because the engine handed the voice to the pump AND advanced it to +0.5 s in the same call (a real bug,
  fixed: the pump now takes over from its first tick; 65 nodes); and the room-dip check's "untouched outside" window began
  4 s after the hold, where the pad's 0.9 s recovery time constant still leaves 0.09 dB by arithmetic (the window now begins
  at 6 s, 6.7 time constants: 0.01 dB measured). No
  round-1/2 check and no round-3 check of the first version was changed, except: the round-3 engine check "music ducks under
  a loud held squish" now reads `ducked`, which covers the room dip (the squish no longer uses the slow duck), and the mix
  render it shares (`renderMix`) applies the engine's room rule, so the original 20 s mix check now measures the music the
  engine would actually play.
* Round 3: the live playout-glitch checks are load-sensitive on this shared container (the load average reached 16-21 during
  the final runs from other lanes' probes). The last full run failed exactly that check once (1 fallback event over 9.0 s of
  the realistic session); it passed in the run before; the first version's builder saw 2 events in 1 of 4 runs. Per-pad node
  count went down (19 instead of 26: no triangles, one filter, fewer LFOs), mallets live ~30% longer, and the room dips add
  two automated gains per session, so I do not expect a real change in audio-thread cost, but this was not measured on the
  audio thread itself.
* Round 3: the physics for bump / lift / toss / strand does not exist yet (stage B): the call map below proposes the metrics,
  and these voices have only been driven by scripts and the sound lab, never by the simulation.
* Round 3: one strand voice per engine: two strands at once share it (the latest call's tension and pan win). Its pitch is
  fixed by the first call of a gesture.
* Round 3: bump / lift / toss / strand are on the plain bus: "Louder squish" does not affect them.
* Round 3: bump and lift both end on a small tonal bubble (~1-1.9 kHz); the critic thought they share a family resemblance.
  Not changed (polish; lift's peel ticks are what tells them apart).
* Round 3: the music's seed comes from `createAudio({seed})` (default fixed), so every launch plays the same opening unless the
  shell passes a per-session seed (it also varies the effects, which is harmless).
* Round 3: if the shell does not call `setPaused` on `visibilitychange`, a hidden tab's throttled timers (>= 1 s) outrun the
  0.4 s lookahead: mallet notes get dropped as late (the pad keeps sounding). With `setPaused` (already recommended) the music
  fades out instead.
* Round 3: home and dusk share a melody pitch set (D major pentatonic = B minor pentatonic); only the pad and the resting tones
  tell them apart. A field holds one chord 29-58 s (now breathing tone by tone and swelling in rests, so less of a drone).
* Round 3: re-stopping a source (`stop()` called again, last call wins) is verified only in Chromium 141. Elsewhere the strand
  still ends through its gain dead-man and the engine's 0.4 s sweep.
* Round 3: the iOS audio-session choice (`'playback'` with sound on) pauses other apps' audio while the game is open and
  unmuted; nobody has tried it on an iPhone.
* Round 3: pieces of a pumped voice (blend, reveal, burst, merge charge) that a stalled main thread made late are dropped, so
  a stall longer than ~0.4-0.5 s during a reveal loses some of its later notes (the old all-at-once build lost nothing but
  cost up to 137 nodes in one call).
* Audio-4 fix: **still unheard.** The fix was chosen and tuned on measurements only (the verifier's pumping metrics, separation
  and exposure on rendered stems). Whether the held-down music feels like "making way" or like "switched off while I play",
  and whether the 2 s fade back after a 4.5 s rest feels natural, is unverified.
* Audio-4 fix: **during any play the music is a quiet pad**: the melody sits 24 dB down (inaudible), the pad 17 dB down, for as
  long as the player keeps interacting at least every ~4.5 s. That is the price of no pumping with dips deep enough for every
  isolated placement; shallower dips failed separation in round 3, and a pad-only hold (the melody coming back between
  effects) measured almost as much swing as before in burst play (std 4.75 dB, 1 s change p90 13.5 LU).
* Audio-4 fix: **the toss and the squish keep their early dip**, so the exposed-gate target (<= 40 ms) is NOT met for them:
  toss median 82 ms / max ~100 ms, squish median 50 / max ~100-140 ms (the probe reports them, ungated). The toss's whoosh is
  audible (within 20 dB of its peak) from 30-60 ms but within 10 dB only from 70-115 ms, and a soft toss is about as loud as
  the undipped pad in its own band: every later dip tried (from 0.1 x its length, or with a soft -6/-7.5 dB first stage) broke
  the in-band gate on an isolated soft toss (4.4-6.7 dB, gate 8). The squish's loudness is a random bubble stream; its
  in-band margin on isolated squeezes (10-19 dB depending on the placement set) is the thinnest of all, so its dip was not delayed either. The blend still
  exceeds 40 ms in some placements (max 87.5 ms; its loudest frame is often the late flourish), reported, not gated.
* Audio-4 fix: **the first fast effect after a rest sounds 12 ms later** than the others (16 ms after its call instead of 4,
  only while the music is up; never with the music off or during play). Nobody has judged whether that is noticeable on a
  touch screen.
* Audio-4 fix: the strand's dip now starts later (tension 0.15, full at 0.5, 40 ms attack): its K-weighted margin on isolated
  stretches dropped from ~21 to 12.8-14.7 LU (gate 10); its in-band margin stays above 25 dB.
* Audio-4 fix: the strand AM correction made the strand slightly louder (realistic stretch -12.4 dBFS peak instead of -13.2,
  held 0.8 -24.5 dBFS RMS instead of -25.8, held 0.2 -37.5 instead of -39.7); the level was not re-calibrated.
* Audio-4 fix: the pumping gates rest on three synthetic scenarios (the verifier's generators, one engine seed): real players
  will differ. The "cycles per minute" figure counts the melody/pad balance moving inside a constant dip (see the measured
  section), so it is reported, not gated; the gates are the gain's standard deviation and the 1 s loudness change.
* Audio-4 fix: the round-3 probe's renderMix sweep and the verifier's placement set now mostly test music that is already
  down (their rests are shorter than the 4.5 s hold); the isolated real-engine placements (`room_checks.mjs`) are the real
  separation test. The real-engine driver fakes the engine's timers and locks them to the audio clock (`engine_offline.js`):
  it tests the engine's logic, not a browser's timer jitter.
* Audio-4 fix: the unlock retry is tested only with a mock context (headless Chromium starts contexts running); never on an
  iPhone.
