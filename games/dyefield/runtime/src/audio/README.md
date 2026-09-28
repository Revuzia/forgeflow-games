# DYEFIELD audio (CONTRACT_P6_11 §21)

WebAudio music + SFX for the lobby and the match. One integration surface: `createAudio()` in `index.ts`.

| file | what |
|---|---|
| `index.ts` | `createAudio(opts): GameAudio`: the only thing the game imports |
| `types.ts` | public types (`AudioFrame`, `GameAudio`, `MusicCue`, …) |
| `router.ts` | SimEvents + frame → sound commands. Pure, deterministic, runs in node (`EVENT_SOUNDS` = the event map) |
| `engine.ts` | the WebAudio backend: buses, 3D panners, voice pool, loops, music sequencer, ducking |
| `voices.ts` | the one-shot voice limit (24; the lowest score is stolen) |
| `seam.ts` | loop-seam fix-up shared by the engine and the probe |
| `manifest.ts` | **generated**: asset URLs, sprite regions, music sections, per-sound levels |
| `CREDITS.json` | **generated**: every track/pack, author and licence, plus ready-made `lines` for the CREDITS screen |
| `assets/*.ogg` | **generated**: `sfx.ogg` (one mono sprite) + `music_{lobby,match,final,victory,defeat}.ogg` |
| `build/build_audio.py` | the generator for the three generated items above |

Payload: 2.6 MB (budget 8 MB). All files are Ogg Vorbis at 44.1 kHz, ≤ 128 kb/s. The files are referenced as
`new URL('./assets/x.ogg', import.meta.url)`, so Vite emits hashed copies into `dist/assets/`. `publicDir` stays
`false` and needs no config change.

## Integration (integrator lane)

1. **Create once at boot** (`main.ts`), with the saved volumes:
   ```ts
   import { createAudio } from './audio/index.ts';
   const audio = createAudio({ volumes: { master, music, sfx } });   // 0..1 each
   ```
   Suggested defaults for the settings lane: master 0.8, music 0.45, sfx 0.9. These are also the engine's
   own defaults when no volumes are given; the category levels in `router.ts` are balanced against them.
   Nothing sounds, and no AudioContext exists, until the context is unlocked.

2. **Unlock on the first gesture.** `createAudio` attaches one-shot `pointerdown` / `keydown` / `touchstart`
   listeners (capture phase) that call `unlock()`, so this is automatic. For certainty, also call
   `void audio.unlock()` inside the first real click handler: the lobby's first menu click, or the
   CLICK TO PLAY card's click before `requestLock()`. `unlock()` never rejects and never blocks. `ui()` also
   unlocks on first use.

3. **Lobby / menus.**
   * On showing the lobby: `audio.playMusic('lobby')`. The harbour ambience starts too.
   * Menu sounds: `audio.ui('hover')` on focus/hover, `audio.ui('click')` on activate, `audio.ui('back')` on
     Esc/back, and `audio.ui('start')` on START. These use the UI bus: never ducked and never paused.
   * Settings sliders: `audio.setVolumes({ master, music, sfx })`. They apply live.

4. **Every frame in the match** (`Game.frame()`, after `this.drainEvents()` and `const vdt = …`). This must
   run **every** frame, including frames with no events: `Game.drainEvents()` returns early on an empty queue,
   so call it from `frame()`, not from inside `drainEvents()`:
   ```ts
   const w = this.world, cam = this.p.cam.camera, e = cam.matrixWorld.elements;
   audio.onEvents(this.drained, {
     listener: { x: e[12], y: e[13], z: e[14], fx: -e[8], fy: -e[9], fz: -e[10], ux: e[4], uy: e[5], uz: e[6] },
     runners: w.runners, me: HUMAN, map: this.p.def.id,
     phase: w.phase, timeLeft: w.timeLeft, countdown: w.countdown,
     projectiles: w.projectiles, conveyors: this.p.geo.features?.conveyors,
   });
   audio.update(vdt);   // the same dt the visuals use (0 while paused)
   ```
   `this.drained` is the array `drainEvents()` filled this frame. It is cleared at the start of each drain, so
   it is empty on quiet frames. The router reads it synchronously and keeps nothing. With `phase`, `timeLeft`
   and `countdown` passed, the 3-2-1 beeps start when the countdown actually runs (not behind the CLICK TO
   PLAY card), and the final-10 ticks are exact.

5. **The match drives its own music.** Do not call `playMusic` for it: the countdown fades the lobby and
   prefetches the match cues; horn `start` starts `match`; horn `minute` switches to `final` on the next bar
   (the final-minute intensification); horn `final10` lifts it +1.5 dB and starts the 9…1 ticks; horn `end`
   fades it out. The horns themselves (and their ducking) come from the sim's `horn` events. Use
   `audio.horn(kind)` only to sound a horn outside the sim (it is de-duplicated against the sim's own horn
   within 1 s).

6. **Slates.**
   * Death slate: automatic (`washed` on the human → splash + a 1.4 s duck).
   * Victory slate (`matchFlow`, where `showVictory` is called):
     `audio.playMusic(res.winner === this.human.team || res.winner === 0 ? 'victory' : 'defeat')`.
   * PLAY AGAIN: nothing. The new world's countdown takes over. LOBBY: `audio.playMusic('lobby')`.
   * Any other slate can call `audio.duck(seconds, music = 0.5, sfx = 0.6)`.

7. **Pause** (ESC / focus or pointer-lock loss): `audio.setPaused(true)`; on RESUME `audio.setPaused(false)`.
   World sounds and loops go silent and the music drops to 40 %. UI sounds stay. A hidden tab suspends the
   AudioContext by itself (`suspendWhenHidden`, default on).

8. **Credits screen**: `import credits from './audio/CREDITS.json'` and show `credits.lines`.

9. **Harness**: `audio.stats()` returns `{ unlocked, state, cue, voices, peakVoices, stolen, rejected, loops,
   played, decoded, errors }`. It is worth exposing on the test surface (for example `window.__df.audio()`),
   so a browser run can assert that music is playing and nothing failed to decode.

## What sounds when

`EVENT_SOUNDS` in `router.ts` is the event map, and typecheck forces every `SimEvent` type into it. In short:

* **Per-kit fire**: MIST-RASP squirt, SHEET-DRUM flick (plus windup) and rolling loop, NEEDLE-GLINT
  charge whine (procedural; enemies hear it within 22 m) and release crack, POP-WELL bloomp and blast.
* **World**: splats pitch-varied by size (impacts ≥ 0.75 m only, nearest first, ≤ 14/s), slick in/out, swim
  loop and refill gurgle (the human), others' swimming within 10 m, hit marker / hit taken, washed (splash +
  confirm chime when you washed them), respawn spout, JELLY CHARGE throw/land (fizz)/pop, CLOUDBURST
  throw + thunder + a rain loop at each hovering cell, WELLSPRING leap + slam, tide-spring launch, belt hum
  near conveyors, a map ambience bed (harbour; Lockwell = works).
* **Flow**: countdown beeps, the score horn (start with a GO beep / minute double blast / final-10 blast
  and ticks / end), and ducking under horns and the death slate.
* **3D**: world sounds use PannerNodes (equal-power, inverse distance per category, same model as
  `router.distModel`). The human's own sounds are 2D. Sounds estimated below −48 dB at the listener are
  never started.
* **Limits**: 24 one-shot voices (score = priority + estimated level; horns and UI are priority 10) and
  12 loops. A master limiter (DynamicsCompressor) catches pile-ups.

## Rebuild / verify

```
python runtime/src/audio/build/build_audio.py [--cache DIR]   # ffmpeg + numpy/scipy; ~1.5 min
node _harness/probe_audio.ts                                    # the gate (files + event map + 2 bot matches)
node _harness/probe_audio.ts --files                            # files only (seconds)
```
The build unpacks the four Travis Rise loop sets from the `.unitypackage` on F: into `--cache` on first run.
It is deterministic. The four tracks are registered for the slug `dyefield` in
`C:/Users/TestRun/Claude Claw/state/music_assignments.json` (`assignments.dyefield` + `used`) so no other game
reuses them.

## Sources

* Music: "SynthWave Music Pack" by Travis Rise (Unity Asset Store): Revelation (lobby + victory stinger),
  Chasing The Stars (match, 120 bpm), Hyper Drive (final minute, 140 bpm), 8-bit Hero (defeat stinger).
* SFX: Kenney Interface Sounds + Impact Sounds (CC0); Sonniss #GameAudioGDC 2024 (royalty-free, no
  attribution required): BluezoneCorp, Bolt, InMotionAudio, Jake Fielding, Justsoundeffects, Rescopic Sound,
  Rogue Waves, Sonik Sound Library; the horns, beeps, squirts, spring and roller are synthesised in the build.

## Known limits

* Ogg Vorbis: Chrome, Edge and Firefox decode it. On a browser that cannot decode the sprite, the countdown
  beeps, ticks, horns and splats fall back to oscillator/noise stand-ins (`engine.fallback`) and everything
  else is silent. `stats().errors` reports the decode failure.
* Decoded music is ~0.4 MB per second held: the lobby set (57.6 s) or the match set (match + final +
  stingers, ~108 s). Only the set in use is kept.
