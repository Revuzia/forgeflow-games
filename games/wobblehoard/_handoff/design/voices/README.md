# Voice prototype renders (PETS lens: VOICES)

Nobody has listened to these. They were made on a machine with no speakers. Judge the cuteness, the readability of the names and the
"does it sound like a toy or a creature" question by ear; the memo `../PETS_VOICE.md` says what was measured and what was not.

All files: 22050 Hz, mono, 16-bit PCM, written by hand (no WebAudio, no samples). Level: active RMS about -26 dBFS, peak at or below
-12 dBFS (the in-game design ceiling, before the master chain). Every file is deterministic: the same species and kind always renders the
same bytes. 49 files, 1.93 MB.

Eight species chosen to span size, family and rarity. For each one, five files: `<id>_name.wav` (the name-cry: its name sung on its own
tune), `<id>_happy.wav`, `<id>_giggle.wav` (tickled), `<id>_yawn.wav` (sleepy), `<id>_grumble.wav` (hungry tummy, then a small "mm?").

| id | tier | family | size | what to listen for |
|---|---|---|---|---|
| dollop | common | jelly gel | mid | bubbly: tiny Minnaert bubbles on the vowels; "Dol-lop" |
| twangle | common | sticky stretch | small | nasal, wide vibrato, scooping up; "Twan-gle" |
| boingle | common | firm silicone | small | squeaky, highest voice (up to F#5, 740 Hz); "Boin-gle" |
| thudge | rare | putty | mid-large | low, muffled, a little creaky; one syllable "Thudge" |
| hushpuff | rare | marshmallow | large | breathy and dark; "Hush-puff" |
| rattlebead | epic | bead squeeze | mid | rattly (grain bursts gate the voice); the voice doubles an octave up (epic) |
| glimglop | legendary | slime goo | mid-large | gurgly (amplitude flutter plus many small bubbles); last vowel blooms into a 3-voice chord (legendary) |
| prismelo | mythic | gummy | mid-large | the cry doubles into a soft chord (fifth up, octave down), ends on its reveal motif (the third Mythic motif, `MYTHIC_MOTIFS[2]` in `src/audio/ceremony.ts`) with a short airy tail; longest file (1.5 s) |

Two extra name-cries from the owner's list: `kneadle_name.wav` (putty, the lowest voice of the 50) and `wrigglo_name.wav` (slime goo).

`extras/` (Dollop only, the other emotion kinds): `dollop_nom.wav` (eating), `dollop_glug.wav` (drinking), `dollop_psst.wav` (a leak hissing;
noise only, no pitch), `dollop_sigh.wav` (relieved after a patch), `dollop_sneeze.wav` (inhale then "choo"), `dollop_hiccup.wav`, and
`prismelo_name_calm.wav` (the Calm effects version: 6 dB quieter, no chord, 0.8 s).

A 3 s "little song" (`song`, five notes in the music's D major pentatonic at the music's 66 BPM) renders too but was left out to keep this
folder under 2 MB. The other kinds in the code (`boop`, `eep`, `wheee`, `oof`, `purr`, `snore`, `yay`, `hmm`) are not rendered here.

Source of the renderer (plain TypeScript, runs with `node`): the scratch folder `scratchpad/pets/voice/` (`render_final.ts` re-creates this
folder; `m_tests.ts` and `m_names.ts` are the measurements).
