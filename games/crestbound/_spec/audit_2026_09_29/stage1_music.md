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
- [ ] register + back up state file (`python assets/music/_build/build_music.py --register` does both; NOT run yet)
- [ ] bootcheck --headless keep + verdant-1, network log read
- [ ] commit
