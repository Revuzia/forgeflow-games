# WOBBLEHOARD — sound design and measurements

**Nobody has listened to any of this yet.** The machine that built it has no speakers and no human ears were involved.
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
| `src/audio/chain.ts` | master chain, shared by the engine and the offline probe |
| `src/audio/engine.ts` | `createAudio(opts?)`: lazy context, polyphony cap, stealing, settings, stats, pause |
| `_harness/probe_audio.mjs` | gate G2 + sanity + engine stress (Chromium). `node _harness/probe_audio.mjs` (add `--voices=poke,pop` to iterate, `--no-engine` to skip the ~50 s live part) |
| `_harness/audioview/` | `index.html` sound lab (live engine, buttons/sliders), `view.js` offline render API, `engine_tests.js`, `analysis.mjs` (FFT, metrics, pitch tracker, PNG/WAV writers) |
| `_harness/_renders/` (gitignored) | per voice: `<v>.wav`, `<v>.png` spectrogram, `<v>_min/_max.wav`, `<v>_pitch0.80/1.25.wav`; `all_voices.wav` (every voice in order, 0.5 s apart); `report.json`, `engine_report.json` |

## Master chain

```
voices -> [boost gain (poke/squish/release) | plain gain (land/pop/blend)] -> bus gain -> 20 Hz high-pass
       -> DynamicsCompressor (threshold -6 dB, knee 6, ratio 12, attack 2 ms, release 12 ms)
       -> WaveShaper soft clip (transparent below 0.55, tanh knee, hard ceiling 0.89 = -1 dBFS, 2x oversampled)
       -> master gain -> AnalyserNode (fftSize 32768, for stats().peak) -> destination
```

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
  `unlock()` creates the context inside the gesture (also tries `webkitAudioContext`), calls `resume()`, plays a one-sample
  silent buffer (iOS), never awaits `resume()` for longer than 1.2 s (it can stay pending without a gesture), and is
  idempotent and concurrency-safe (one context, ever).
* If the context later becomes `suspended`/`interrupted` (phone call, tab discard), the next trigger is dropped and kicks
  `resume()` (rate-limited to 4/s), so the first tap after a gesture-blocked interruption recovers audio.
* `setPaused(true)` (tab hidden): frees every live voice at once and suspends the context; `setPaused(false)` resumes.
  The SHELL should call `audio.setPaused?.(document.hidden)` on `visibilitychange` (optional method, additive).
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
* All numbers are sanitised at the engine boundary (NaN/Infinity/strings/negatives/huge) and again inside each voice;
  `update/end` `atTime` is ignored/clamped live (a far-future time would strand a voice).

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
  at 170 Hz (no low "tock" at each onset), low-pass 5 kHz.
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
* Measured: motor partial 37.8 -> 113.1 Hz (x2.99 in the first second); flourish loudest peak 528 -> 1056 Hz.

## What was measured (gate G2 and extras)

`node _harness/probe_audio.mjs` last run: **218/218 checks pass, exit 0**. Gate G2 as worded in CONTRACT.md section 6, per voice:
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

## Known issues and caveats

* Unverified by ear (above). All tuning was done from spectrograms and numbers.
* The chain's compressor is Chromium-tuned (release 12 ms). Other browsers' `DynamicsCompressorNode` may treat very short
  events differently; levels could differ by a few dB for the 2-5 ms pop click. Not tested outside Chromium 141.
* Headless playout has a null sink: "0 fallback events" is evidence for the 30 taps/s case on this container, not a
  guarantee on a phone. Under a 770 voices/s storm it does glitch.
* Per-trigger main-thread cost is ~0.5 ms here (about 15-25 nodes per voice, plus bubbles); fine at 30 taps/s, not free.
* A held squish at high rate creates up to ~95 two-node bubbles per second; each lives 10-260 ms.
* `blend` ignores the physics: it is a pre-scheduled one-shot (`stop()` cuts it).
* Same-seed repeatability is bit-exact for the voice code only up to Chromium's own float noise (~1e-5); not tested elsewhere.
* In-flight bubbles on a context that is closed or suspended keep their (already disconnected) nodes until the page releases
  them; the bookkeeping counter shows 2 nodes after the dispose test. They are not connected to anything.
