# PETS: VOICES (each squishy speaks in its own way)

Designer memo, 2026-10-08. Read-only on the game. Prototype: plain node, no WebAudio, WAVs in `_handoff/design/voices/` (README lists each file).
**Nobody has listened to any of it.** The numbers below say the synthesis does what the design says; whether it is cute is the owner's ear.

## 1. What exists today
No per-species audio exists (`src/audio`: material and physics sounds only). `pitchRatio(genome)` (`src/core/genome.ts:140`) already lowers pitch with size and raises it with firmness; `face.ts:10` says "no mouth"; `announcer.say()` is the live region; `AudioSettings.music` (0..1, 0 = off) is the model for a voice volume.

## 2. Recommendation (the cutest achievable design)
**Sung-name babble: real phoneme formants, but the name is SUNG, not spoken.** A small Klatt-style synthesiser (glottal pulse, five resonators, nasal pole-zero, noise bursts) renders the species' own syllables ("Dol-lop", "Twan-gle", "Kneadle") on a short tune in the music's D major pentatonic, in a small-creature register. Two alternatives were weighed:
- *Animalese* (a blip per letter): cheap, but the name is lost and every species sounds alike. Rejected.
- *True phoneme speech*: sounds like a speech chip, and at cute pitches (440 to 740 Hz) vowels blur because harmonics are wider apart than the formants. Rejected.
- **Chosen**: the hybrid. The name is recognisable by its consonants and stressed vowel, the tune makes it a character. Honest limit: at the highest voices (boingle, 659 to 740 Hz) the vowels will blur; whether a child hears "Dollop" must be tested by ear. A setting "Name clarity: Clear / Coo" (coo = vowels only, no consonants) is the fallback and also the safest for sound-sensitive players.
- Nothing imitates any franchise: a voice is a pure function of the name, family and catalog numbers; no cry or jingle is taken from anywhere.

## 3. The mapping: species row to voice (pure function, no stored voice data except one respelling string per species)
| Input | Becomes |
|---|---|
| species id | `RESP` respelling (50 short strings, ~600 B): `dollop` = `da.lXp`, `twangle` = `twAN.gXl`, stress marks, vowels a A e E i I o O u U x X R Y J W ~ (phon.ts); consonants b p d t g k C(ch) j f v s z S T h m n N l r w y |
| species id (hash) | the name's TUNE: a seeded walk (steps -3..+4 pentatonic degrees) over the syllables, centred on the register; last syllable rises two semitones (a question-like lilt). Home vowel (the stressed vowel) and signature consonant (first consonant) are reused by the emotions, so a giggle and a happy cry carry the species' own sounds |
| size (0 to 1) | register `-20 semitones per unit of size`; formant scale `1.32 - 0.9 (size - 0.5)` clamped 1.0 to 1.7 (a big squishy has a lower voice AND a longer vocal tract, so its vowels darken) |
| firmness | `+4 semitones per unit` (the same sign as `pitchRatio`) |
| bounce | tempo `0.85 + 0.45 bounce` (bouncy ones talk faster) |
| tier | flourish (below) |
| id hash | one of six ticklish zones (crown, belly, left cheek, right cheek, back, underside) |

Measured across the 50 name-cries: mean f0 from -12.4 semitones re 440 Hz (kneadle, putty) to +8.4 (boingle, firm silicone); every note is capped at F#5 (740 Hz).

**Family timbre** (12 rows): jelly gel bubbly (Minnaert bubbles, f0 = 3.26 / r from `src/audio/dsp.ts`, on vowels and syllable ends); sticky stretch nasal, wide vibrato, scoops; water fill dark, sloshing formants, bubbles; bead squeeze rattly (34 noise grains a second gate the voice); gummy plain; slime goo gurgly (28 Hz flutter, jitter, many small bubbles); marshmallow and slow-rise foam breathy and dark (low-pass 3.6 and 3.3 kHz); mochi nasal and soft; putty low, muffled, creaky (low-pass 1.9 kHz); firm silicone squeaky (pulsed squeak carrier); pop dome a tiny "pip" at each syllable.

**Rarity flourish** (name, happy and cheer only; none in Calm): common plain; uncommon a two-note chime on the last vowel; rare a soft echo of the last syllable a fifth up; epic the whole cry doubled an octave up; legendary the last vowel blooms into a three-voice major chord; **mythic the cry doubles into a soft chord (a fifth up and an octave down), the three bells of its reveal motif (`MYTHIC_MOTIFS`) end it, a short reverb tail (1.53 s, 0.83 s in Calm).**

## 4. The emotion set (20 kinds built; each is a phrase function of the profile)
hello/name; happy (three rising syllables); cheer; giggle when tickled (five breathy "hi" notes, 46 ms apart, tickle zone differs per species); yawn (0.93 s, glides down about an octave); hungry grumble (a stomach rumble with big slow bubbles, then "mm?"); nom (three closed-mouth hums, two bubble pops); glug (a falling "gu", two bubbles); **psst** (a leak: shaped noise, narrowed and sinking, no pitch; at -31 dBFS it is the quietest kind); sigh (relief after a patch, 0.78 s); sneeze (inhale, then "choo"); hiccup (0.23 s); little song (five notes at the music's 66 BPM, kept in the key of the music); boop, eep, wheee, oof, purr, snore, hmm. Prosody: happy rises, sleepy falls (yawn and sigh end well below where they start), grumble sits low and ends upward.

## 5. Rules for when a squishy may speak
Quiet by default: the name-cry plays on the first show of a squishy in a session, on its reveal (after the tier motif ends, never over it) and when the player taps its name tag.
- **Gesture rule**: nothing while any finger is down or a grab is held (`touch.fingerDown`, `grabActive`); a voice that was due waits up to 1.2 s then is dropped, never queued.
- **Rate**: one voice at a time, global gap 4 s, at most 6 per minute; care sounds (nom, glug) in one chain may follow each other at 0.4 s. Idle chatter: at most one unprompted cry per 60 to 120 s, only after 20 s without a gesture, never in Calm.
- **Over effects and music**: skipped within 400 ms of any effect; during a ceremony (capsule, reveal, merge, Mythic duck) nothing. Voices ask the music for room like an effect (`ROOM_KINDS.voice = -18 dB`; the music is already down while the player plays).
- **Cut pieces (up to six)**: only the face piece speaks (the chunks have no eyes and are mute); at a cut the smaller piece may say one "eep" at -6 dB, a semitone shift of `-12 log2(cbrt(frac))` (a half-size piece sings 4 semitones higher), at most one piece-voice per 600 ms. Voice polyphony is capped at 2 live groups; a third is dropped, not stolen.
- **Switches and captions**: Settings gains `voices?: boolean` (default on), `voiceVolume?: number` (0..1, squared taper, default 0.5) and `voiceCaptions?: boolean` (default on); Calm effects: -6 dB, no flourish, no giggle, gap x1.5. Voices off renders nothing (no CPU, no buffers). Each voice returns its caption ("Dollop says its name", `CAPTION` table) which the shell sends to `announcer.say()` and to a speech-bubble element (visual only, `aria-hidden`, 1.6 s).
- **Sound-sensitivity safety**: every voice leaves the synthesiser at active RMS -26 dBFS and a peak ceiling of -12 dBFS (a poke measures -23.6 RMS, -9.9 peak, `SOUND.md`), so voices sit 2.4 dB under a poke; the volume setting can only attenuate. Pitch cap 740 Hz. 4 ms fade-in, 20 ms fade-out, no DC. No kind starts faster than 6 ms from 1% to 50% of its peak. First voice of a session starts 2 s after unlock, never at unlock.

## 6. Where it plugs in (additive, optional)
`contracts.ts`: `SquishAudio.voice?(p: { species: string; kind: VoiceKind; size?: number; firmness?: number; pitchSt?: number; pan?: number; calm?: boolean }): { durationS: number; caption: string } | null` (null = throttled or off), `AudioSettings.voice?: number` (0 = off, as `music`).
`engine.ts`: add `'voice'` to `KINDS` and `ROOM_KINDS`; a `voice` method after `rejoin`: `accept('voice')`, render (or take from a cache) a 22050 Hz `AudioBuffer`, one `AudioBufferSourceNode` into a `Bag` (kind `'voice'`, priority 1) into `chain.plain`; register with `registerFx`. A new `VoiceLimiter` beside `BumpLimiter`/`CutLimiter` holds the rate rules. **Nodes per voice: 2 (gain, buffer source), 3 with pan**, against 8 to 40 for existing effects. The face has no mouth: v1 drives the pet from `meta.nuclei` (syllable onset times, returned with each render) with a tiny `body.nudge` belly bob per syllable (the jelly wobbles with its own voice) and widens the eyes; `mouthTrack(score)` (60 Hz, 0..1) exists for a later mouth.

## 7. Cost
- **CPU** (render on the main thread, once per call, node here under load from other jobs): name-cry 0.56 s: best 5 ms, median 7 to 11 ms; giggle 1 s: 8 to 11 ms; yawn 0.93 s: 10 to 18 ms; the 3 s song 25 to 55 ms; the Mythic chord (three voices plus reverb) 39 to 72 ms. In the browser, render the current squishy's name in an idle callback at spawn, the Mythic's at the capsule pre-roll, others on demand (they are never time-critical). A 24-buffer cache is about 1.5 MB (49 to 132 KB per cry as Float32).
- **Bytes** (rolldown, minified, tree-shaken, the engine glue not included): all 20 kinds plus flourishes **26.5 KB raw, 11.2 KB gzip**; 12 kinds 25.4 KB; the five core kinds (name, happy, giggle, yawn, grumble) with flourishes 23.6 KB; without flourishes 20.8 KB; name only 19.6 KB. Parts: DSP core 6.5 KB, phoneme tables 2.5 KB, respellings and family textures 3.9 KB. Glue, settings rows and captions are not written (estimate 3 to 4 KB). G0 counts raw bytes of the output folder, so **about 30 KB of the 86 KB left under 1229 KB (1143 used); with the UI overhaul's 90 KB the gate is already over, so the owner's gate decision must come first.** No asset files: zero samples.

## 8. What was measured (script `m_tests.ts`, all numbers from this session)
| Check | Result |
|---|---|
| Determinism | same species and kind give the same bytes (hash 6cfc6bae for dollop name); different species differ |
| Safety sweep, 50 species x 20 kinds = 1000 renders | 0 NaN; 0 over the -12 dBFS ceiling; 0 clipped samples; 0 non-zero edge samples (first and last sample exactly 0); worst DC 1.5e-6; fastest onset 6 ms (5th percentile 9 ms) |
| Level per kind (active RMS) | name -29.4 to -25.2; happy -33.6 to -25.3; giggle -28.4 to -26.0; yawn -27.0; grumble -28.0; psst -30.8; purr -29.0; song -31.6 to -25.2 |
| Pitch accuracy vs the plan (10 species, vowel frames, YIN) | median 6.1 cents, 90th percentile 19 cents (vibrato is +-12 to 40 cents and is inside this) |
| Resonator cascade (impulse response peaks vs planned F1..F3, 8 vowels) | worst error 1.2% |
| LPC formants of the rendered audio | **inconclusive**: at f0 of 220 to 250 Hz the harmonics are too sparse for LPC to resolve formants (thudge F1 669 vs 748 planned); the impulse-response row above is the formant evidence |
| Species distance, all 1225 pairs of name-cries (heuristic units: 1.0 = 1.5 semitones of pitch, or 3 dB of spectrum, or 20% of duration) | min 1.28 (twangle / munchip), 5th percentile 3.04, median 6.39, max 20.2; 7 pairs under 2, none under 1; same-family pairs average 4.66, different-family 7.01 (timbre part 2.42 versus 3.97) |
| Instance variation (5 Dollops, size 0.43 to 0.57, firmness 0.30 to 0.46) | largest distance between two Dollops 2.53, nearest other jelly species 3.13: **a thin margin**. Known defect: at size 0.55 the name tune changes (`[9,7]` becomes `[7,4]` semitones) because the walk is centred on the instance register and snaps differently; fix: key the tune on the species alone and add the instance shift in plain semitones |
| Calm | Mythic cry 0.83 s, peak -21.2, RMS -31.7 dBFS (normal 1.53 s, -12.9, -25.8) |

## 9. Honest limits
1. Nothing here was heard. Consonant loudness was set by measuring each consonant's RMS against its vowel (a table in `calib.ts`), not by ear; plosives, sibilants and "psst" are the likeliest to need a retune.
2. The distance score is a design heuristic, not psychoacoustics: it says the cries are not copies, not that a child can tell them apart.
3. Formants are textbook adult-male averages, scaled; above 600 Hz vowels blur. The 740 Hz cap and the "Coo" fallback exist for that.
4. Respellings were written from the spelling; speakers of other languages may read a name differently.
5. Real-time WebAudio was not tested; the engine glue (`voice()`, `VoiceLimiter`) is designed here, not built. Voices pay nothing in the meter economy.
