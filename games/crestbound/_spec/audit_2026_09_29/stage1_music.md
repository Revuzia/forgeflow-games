# Stage 1 — music lane (PROGRESS, kept current)

Owner files: `runtime/core/audio.js` (music part), `assets/music/`, the `crestbound` entries in
`C:/Users/TestRun/Claude Claw/state/music_assignments.json`.

## Findings so far (2026-09-30)

- DYEFIELD: `runtime/src/audio/manifest.ts` + `engine.ts`; Ogg Vorbis ≤128 kb/s + an AAC-LC `.m4a` twin per file
  (WebKit before 18.4 has no Ogg). Tracks come from Unity Asset Store packs unpacked under
  `F:/games/unity-assets/<Publisher>__<Pack>/`, registered as `<author>/<pack>/<track>` keys.
- `pipeline/assets/music/` holds only 7 Kenney/OGA oggs; 5 already in `used`, the 2 left are `game_over`, `victory`.
- `state/music_assignments.json` `used` (read 2026-09-30): 6 Kenney oggs, Travis Rise SynthWave 1 (01,02,03,04,05,06,07),
  SynthWave 2 (01-06), Evil Mind Halloween Audio Kit (Halloween Rocks, Retro Madness). Nothing from Florian Stracker,
  Chris Kohler, Corentin Guezenoc, Evil Mind Medieval Fantasy, GWriterStudio.
- Grep over `games/` + `pipeline/*.py` for Stracker / Hero's Path / Medieval Fantasy / Kohler: no text hit.
- Candidate packs (extracted, owned): Florian Stracker "The Hero's Path" (12 × 16-bit, START+LOOP pairs, doc says
  play START once then LOOP forever), Evil Mind "Medieval Fantasy Audio Bundle" (11 music mp3 + 23 short "Event" cues
  1.3–8 s), Chris Kohler 8-bit RPG (has Level Clear / Key Item jingles, but 8-bit), Florian Stracker Retro-Fit (8-bit).

- OUT OF SCOPE, found: `games/aether-isles/assets/audio/theme_green_fields.mp3` (47.58 s) and `theme_village.mp3`
  (47.97 s) are Evil Mind Medieval Fantasy "The Green Fields" (47.58 s) and "Retro Village Style" (47.97 s) — the
  durations match to the centisecond and the names match — but neither is in `music_assignments.json`. So the
  registry is NOT complete for games older than it; I avoided both tracks. Recommend registering them to aether-isles.

## Choice (made 2026-09-30; not listened — headless box; chosen by name + pack doc + measured descriptors)

Descriptors from `scratchpad/features.py` + `specs.py` (tempo by onset autocorrelation, key by Krumhansl chroma,
perc = HPSS percussive energy share, low = energy share < 250 Hz), and a spectrogram montage read by eye.

| cue | track | pack (author) | why |
|---|---|---|---|
| keep | 07 The Maple Sprout (LOOP) | The Hero's Path (Florian Stracker) | D major, no drums (perc 0.03), no bass (low 0.00), warm plucked line (centroid 1.3 kHz) — the hub's "held breath" |
| verdant | 02 Valley Grounds (LOOP) | The Hero's Path | G major, the busiest (4.8 onsets/s), bass + drums bounce, a field/overworld name |
| ember | 08 Besiege the Castle (LOOP) | The Hero's Path | A minor, marching block-chord stabs, 68 % of energy < 250 Hz — driving and heavy |
| rime | 04 Sleep In (LOOP) | The Hero's Path | G major, no drums (0.05), no bass (0.02), thin legato lines, brighter (2.3 kHz) — airy and still |
| azure | 03 Breaking the Chains (LOOP) | The Hero's Path | B-flat major, legato melody over a steady pulse, bright (2.2 kHz) — flowing |
| boss | 06 Battle to the Blood (LOOP) | The Hero's Path | G minor, the fastest (172 bpm) and densest, a battle title |
| fanfare | Jingle "Key Item Obtained 1" | 8-Bit RPG Adventure Music Pack (Chris Kohler) | 3.7 s, purpose-made "got the key item" jingle, ends on a B-flat major third |
| clear | Jingle "Level Clear 2" | 8-Bit RPG Adventure Music Pack (Chris Kohler) | 4.2 s, purpose-made level-clear jingle, ends on C major |

Caveats: the two jingles are 8-bit (NES-style) while the loops are 16-bit (SNES-style) — the catalog has no 16-bit
short cues (Hero's Path has none; the Medieval "Event" cues are swells/hits, not fanfares, by spectrogram). "Sleep In"
for the ice realm is a judgement from texture (thin, bass-less, legato), not from a cold key.
LOOP files only: the pack's START files are not sample-aligned with the LOOPs (measured body diff 0.29–0.66 RMS with a
2–4 sample lag), so an intro+loop splice would need its own seam work; the 1.2 s fade-in covers the LOOP's head.

## Status (resume run 2, 2026-09-30 — read the code, these lines are current)
- [x] choose tracks (table above)
- [x] encode ogg + m4a into assets/music (build_music.py; manifest.js + CREDITS.json generated)
- [x] wire streaming playback in audio.js (fetch per realm, decode after gesture, sample-exact loop, 1.2 s crossfade,
      music bus = volume slider + duck + underwater filter, procedural bed fallback, `?music=synth`)
- [x] resume run 2: added module-level `export function setMusicMood()`; stopAll() now stops the recorded loop +
      jingle; dispose() unhooks the gesture listeners and frees decoded buffers
- [x] esbuild parse audio.js + manifest.js OK; modulecheck 71 modules, 0 failing (resume run 2)
- [x] COMMITTED 6f2c52a9 (audio.js + assets/music + this note)
- [x] musiccheck.py (assets/music/_build/) keep --moods: 22 of 23 PASS; the 1 FAIL was 12 keep GLB requests
      `net::ERR_ABORTED` (not music; another subsystem under load) -> the check is now scoped to music requests
- [x] REGISTERED 2026-09-30 21:41 via build_music.register() (the generator's own function, no re-encode): 8 keys to
      assignments.crestbound, `used` 21 -> 29, every other slug + count byte-identical; backup
      `state/music_assignments.json.bak_crestbound_music` (2178 B, the pre-change file). NOT committed (outer repo; ship step).
- [x] uniqueness re-checked by AUDIO, not names: ffprobe durations of 2,017 audio files under games/ + pipeline/assets
      vs the 13 source WAVs (START + LOOP): the only game hits are games/_bisect/s1crbase + s1crnew (bisect COPIES of
      crestbound itself); the Kohler pack also sits unpacked in pipeline/assets/_downloaded (a catalog, no game); the
      rest are sonniss sfx whose length happens to be within 0.12 s (names: impacts, whooshes, voice barks).
- [x] bootcheck --headless keep: BOOTS CLEAN (state keep, 0 console / page / window errors, 0 shader diags, 181 draws)
- [x] bootcheck --headless verdant-1: BOOTS CLEAN on the 2nd run (state playing, 210 draws, 0 errors); the 1st run's only
      problem was `screenshot failed: Target page, context or browser has been closed` (box at 70-90 Chromes)
- [x] musiccheck verdant-1 --moods: 23/23 PASS (ogg); --music m4a --moods: 23/23 PASS; --music synth reference: PASS

## Harness facts learned this run
- The shared `serve_nocache.py :8788` has the stdlib listen backlog of 5; with 60+ Chromes from parallel lanes,
  Chrome's module burst gets `net::ERR_CONNECTION_REFUSED` (util.js, tuning.js, post.js measured) and the page sticks at
  INITIALISING. Workaround (no shared file edited): a private server for this lane with `request_queue_size = 256`,
  scratchpad `lane_server.py`, `http://127.0.0.1:8797/...`, passed to bootcheck/musiccheck via --url/--base.
- Under that load bootcheck's leave_title (fixed 45 s) timed out while the click was still loading the Keep; the
  state sampled after settle was 'keep', 0 console / page / window errors, 0 shader diagnostics.

## musiccheck keep --moods (2026-09-30, box loaded: bootcheck read 1 frame per several seconds)
- before the click: no AudioContext, nothing playing, keep.ogg bytes (1,063,866) already fetched (bytes only).
- real mouse click on NEW GAME -> playing keep, ctx running, ogg, decoded 94.63 s, level 0.412 (to -21 LUFS).
  It took 122 s on the loaded box (the Keep build on the same main thread); re-measure on a quiet box.
- AnalyserNode tapped on the music bus: RMS 0.020-0.058; music volume 0 -> RMS 0 x5; restored 0.6 -> 0.048-0.058.
- setMusicMood('boss') -> boss after 5.2 s (on-demand fetch + decode); RMS across the 1.2 s crossfade every
  100 ms: min 0.0215, no gap. 'course' -> keep. 'fanfare' -> jingle plays, loop duck 0.160, then 1.000 and back.
  'clear' (from boss) -> jingle + loop back to keep. module export `setMusicMood` is a function. decoded 37.5 MB.
- network: manifest.js 200, keep.ogg 200 (1,063,866 B), fanfare.ogg 200 (52,159), clear.ogg 200 (53,554),
  boss.ogg 200 (1,543,702).

## musiccheck verdant-1 (2026-09-30, after the registry write)
- `--autoplay-policy=user-gesture-required` is NOT enough in headless: a direct ?course= boot (game.js calls
  startAudio() with no gesture) still read ctx 'running'. The check now suspends the context to model a desktop
  Chrome, then a real mouse click: audio.js's own gesture hook resumes it and verdant plays 2.43 s later (page clock).
- verdant: ogg, decoded 111.994 s, level 0.437; tapped RMS mean 0.0342 (4 s); music 0 -> 0 x5; boss 5.9 s on demand
  (bytes prefetched, the decode is the cost; the course track keeps playing meanwhile); crossfade RMS min 0.0184.
- m4a (`?music=m4a`, the WebKit path): decoded 112.013 s = the padded length, i.e. Chrome honours the MP4 edit list
  (offset 0); RMS mean 0.0346; all moods pass. The no-edit-list branch (offset = 1024 samples) is NOT exercised here.
- LOUDNESS vs the procedural bed it replaces (same tap, same 4 s window, verdant-1): bed mean RMS 0.0348, recorded
  0.0342 (ogg) / 0.0346 (m4a) -> within 0.2 dB, so the sfx/music balance the game was tuned with is kept.
- network (ogg run): manifest.js, keep.ogg 1,063,866, fanfare.ogg 52,159, verdant.ogg 1,508,219, clear.ogg 53,554,
  boss.ogg 1,543,702 — all 200, all before the click (bytes only). ?music=synth fetches manifest.js only.

## Download size (measured)
Ogg set 8,282,782 B (7.9 MiB) for all 8 cues; AAC set 10,820,638 B — a browser takes ONE set, on demand: the title
fetches keep (1.06 MB) + the two jingles (0.1 MB); each realm adds its track (1.2-1.5 MB) + boss (1.5 MB, once).
Decoded PCM is evicted to the playing loop + the home track + jingles: measured 37.5 MB (keep) / 43.9 MB (verdant).

## API for stage 2 (bosses, crests)
```js
import { setMusicMood } from '../core/audio.js';   // or game.audio.setMusicMood(...)
setMusicMood('boss');      // boss track, 1.2 s crossfade (course track stays decoded for the way back)
setMusicMood('course');    // back to the realm's track
if (!setMusicMood('fanfare')) audio.stinger('crest');   // crest jingle over a dipped loop; false = use the procedural stinger
setMusicMood('clear');     // course-clear jingle; the loop returns to the course track
```
Returns true when a recorded cue handled it. Until stage 2 wires bosses explicitly, setMood('boss') (the Warden
engage the game already reports) switches to the boss track and releases it 4 s after the mood drops.
'fanfare'/'clear' are NOT auto-played by audio.js: game.js still plays the procedural crest stinger (other lane's
file); stage 2 decides where the jingles replace it.
