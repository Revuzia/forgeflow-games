# AUDIO lane brief: the cut and reconnect voices, and one music fix

> **Session 2 (2026-10-06): read RESUME.md right after COMMON.md. It supersedes the paths, the machine rules and the "where the previous engineer stopped" parts below (the work moved to the owner's Windows PC). Verification charters: VERIFY.md.**

**You own:**
- `src/audio/**`
- `_harness/probe_audio.mjs`, `_harness/audioview/**`
- the audio sections of `_spec/SOUND.md`

Your port is 5367. Your scratch folder is `scratchpad/audio5/`.

**Read:** `_spec/SOUND.md` (all, especially "Round 3" and "Room for the effects"), `src/contracts.ts` (`SquishAudio`, including the
new optional `cut` and `rejoin` marked CUT), `_spec/CUT.md` (sections 1-4), and `src/audio/**`. Audio round 3 and its fix are
verified: the room dip holds under play with no pumping. The checker's workspace is `scratchpad/verify_audio3/`; its scripts are
run.mjs, ana_pump.mjs and ana_place.mjs, and they drive the real engine offline.

## Build

1. **`cut({ phase: 'start' | 'separate', frac, neckS?, family?, pan?, calm? })`**
   - **'start'**: a wet, sticky slice that lasts `neckS` (default 0.25 s): a tearing, squelching band whose pitch rises as the waist thins.
   - **'separate'**: a soft pop as the pieces part, with 1-3 tiny bubbles. Pitch follows the smaller piece's `frac`: small pieces sound higher.
   - Family flavour per `CUT.md` section 3: longer and stringier for sticky and slime; crisp for gel; muffled for foam; a slight
     crunch for beads.
2. **`rejoin({ frac, all?, calm? })`**: a gloopy merge "blorp" sized by the merged fraction. `all: true` adds a gentle rising
   flourish as the squishy becomes whole again. It must not resemble the merge-ceremony burst.
3. Both voices are original recipes in our existing synthesis style (no samples, no imitation of any reference sound). They make
   room in the music like every other effect (`registerFx` and the room hold). They are rate-limited: 10 cuts within 2 s must not
   pile up. Calm mode is softer.
4. **One pre-existing minor from the checker.** At music volume 1, two large, low-pitched pops sit under the pad. The pad's dip
   deepens by only 0.72 x the volume boost, so under an effect the pad is about 1.7 dB louder than at the default level, which
   contradicts the music.ts comment. Fix it, for example with pad dip = 0.72 * ROOM_DB - boost, and check that the pumping metrics
   still hold.
5. **Checks** in `probe_audio` and its views:
   - levels within -20..-1 dBFS peak;
   - the separation gates against the music (in-band >= 8 dB, K-weighted >= 10 LU);
   - rate limiting;
   - calm softer;
   - no clicks at start or end;
   - each family variant distinct.

   Render spectrograms for each voice, look at them, and describe what a human should listen for.

## Report
- The recipes.
- The measured levels and separation.
- The probe counts.
- Spectrogram paths.
- What to listen for.
- Known issues.

Time box: about 3 hours.
