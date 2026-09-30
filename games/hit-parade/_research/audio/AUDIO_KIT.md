# HIT PARADE - Audio Kit Shortlist

Generated 2026-09-29 by the audio research lane. Machine-readable twin: `audio_kit.json` (same numbers, full licence text per file).

## Read this first

- **I cannot listen.** Every character note is built from the file/folder name plus measurements (loudness, spectrum split, envelope, onset count, tempo estimate). Nothing here is an ear judgement. **Audition every `ship` pick before lock.**
- Loudness: `LUFS-I` = ffmpeg ebur128 integrated loudness (reads **-70.0 = undefined** on clips shorter than ~0.4 s - use `max dB` for those); `TP` = ebur128 true peak (dBTP); `max dB` = volumedetect peak. Spectrum shares come from a mono downmix.
- Sliced picks (`[start-end ms]`) were **re-measured on the slice itself** (74 slices).
- Voice transcripts are machine output (local faster-whisper small.en, offline) and may contain errors.
- Measured this session: 1344 in-scope files, 147 out-of-scope files, 96 voice files transcribed.

## Verdict

- 44 roles: **27 covered, 11 partial, 6 gap** from the listed sources.
- Combat SFX are well covered (Kenney punches + Sonniss gore/door/metal/wood takes + Evil Mind spells). **Crowd and TV-show sounds are the weak spot**: no boo, applause, audience laugh, crowd ooh, drum roll, rimshot or true air horn anywhere in the listed sources.
- **Music is only partly on-genre**: the listed sources hold just two tracks labelled rock/metal (Evil Mind *Halloween Rocks* and *Face Your Doom - Metal*); everything else is Halloween/fantasy/chiptune by label. No funk, no synth-punk.
- **Budget is fine**: the 105 shipped picks measure **6.64 MB as Opus** (AAC fallback set 8.90 MB) against the ~12 MB target; music is 5.47 MB of it.
- **Biggest lead (outside the listed sources, owner's call):** the un-extracted `Imphenzia / Universal Sound FX` package in `F:/games/unity-asset-cache` has audience boos, applause, laughs, an 'Ohh', claps-and-cheers, cash-register cha-chings, boxing bells/punches and an announcer-style word set (Fight / Get Ready / Combo tiers / Time's Up / Victory / Game Over). Unused Travis Rise synthwave there (9 tracks; full versions 3.4-4.7 min, inferred from package byte sizes at the loops' measured 44.1 kHz 16-bit stereo; loops 8.7-21.3 s, only the loops were measured) is the nearest fit for synth-punk stage music. Measured below; adding them costs 1.72 MB Opus (total 8.36 MB).
- **Voice:** no announcer pack in the listed sources. Usable lines found: a female circus-ringmaster PA ('Ladies and gentlemen, boys and girls, ...') and generic RPG hero barks/efforts (Daniel Gooding pack).

## Licence legend

| code | licence | obligations |
|---|---|---|
| CC0-K | CC0 1.0, Kenney (License.txt in each pack) | none (credit optional) |
| CC0-OGA | CC0 1.0, OpenGameArt (music/manifest.json) | none |
| CC0-FS | CC0 1.0, Freesound via audio-cache/_manifest.json | none |
| CC-BY / CC-BY-SA | Jamendo via audio-cache/_manifest.json | credit required (BY-SA also share-alike) |
| SON | Sonniss #GameAudioGDC 2024 (sonniss-gdc2024/LICENSE.txt) | royalty-free, no attribution, embed-in-game OK, no resale as sounds, **no AI training** |
| UAS | Unity Asset Store EULA - inferred from the unity-assets source folder (packages carry no licence file) | embed in the game only; no standalone redistribution of the sound files |

## Shortlist by role

`*` = proposed ship pick (counted in the budget). Paths are absolute. Character = my note (name/folder context) + auto measurement summary.

### Combat SFX

#### `punch_light` - need 6+ variants - **COVERED**

> Note: Kenney punches carry the body; layer a 1-4 kHz slap/snap (slap role) on top for the crack the reference has.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_medium_000.ogg` | 0.431 | 2 | 44100 | -16.6 | -1.1 | -1.1 | CC0-K | Kenney punch (medium) - short dull thump, no crack; body layer. low-mid body (60% 150-1k). |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_medium_001.ogg` | 0.405 | 2 | 44100 | -16.5 | -1.1 | -1.1 | CC0-K | Kenney punch (medium) variant. low-mid body (62% 150-1k). |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_medium_003.ogg` | 0.455 | 2 | 44100 | -16.7 | -0.9 | -0.9 | CC0-K | Kenney punch (medium) variant. low-mid body (68% 150-1k). |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_medium_004.ogg` | 0.543 | 2 | 44100 | -16.1 | -1.0 | -1.0 | CC0-K | Kenney punch (medium) variant. low-mid body (65% 150-1k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Anime Studio/FGHTImpt_Fight Combo x4_RogueWaves_AnimeStudio.wav` `[40-240 ms]` | 0.2 | 2 | 96000 | -70.0 | -7.5 | -7.5 | SON | Anime 'fight combo x4' hit 1 (slice at measured transient) - snappier mid layer. broadband. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Anime Studio/FGHTImpt_Fight Combo x4_RogueWaves_AnimeStudio.wav` `[240-440 ms]` | 0.2 | 2 | 96000 | -70.0 | -7.0 | -7.0 | SON | fight combo hit 2 (slice). broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Anime Studio/FGHTImpt_Fight Combo x4_RogueWaves_AnimeStudio.wav` `[440-630 ms]` | 0.19 | 2 | 96000 | -70.0 | -4.9 | -4.9 | SON | fight combo hit 3 (slice). sub/low-heavy (72% <150 Hz). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Anime Studio/FGHTImpt_Fight Combo x4_RogueWaves_AnimeStudio.wav` `[630-1080 ms]` | 0.45 | 2 | 96000 | -20.2 | -3.2 | -3.2 | SON | fight combo hit 4 with tail (slice). broadband. |

#### `punch_heavy` - need 6+ variants - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_heavy_000.ogg` | 0.649 | 2 | 44100 | -17.8 | -1.0 | -1.0 | CC0-K | Kenney heavy punch - low thud (73% <150 Hz). sub/low-heavy (73% <150 Hz). |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_heavy_002.ogg` | 0.457 | 2 | 44100 | -15.1 | -1.0 | -1.0 | CC0-K | Kenney heavy punch variant (84% <150 Hz). sub/low-heavy (84% <150 Hz); PHONE-SPEAKER RISK: only 16% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPunch_heavy_003.ogg` | 0.474 | 2 | 44100 | -15.4 | -0.9 | -0.9 | CC0-K | Kenney heavy punch variant. sub/low-heavy (76% <150 Hz). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Melee Weapons/WEAPAxe_Long Two-Handed Axe Flesh Hit_JSE_MW.wav` `[2420-3150 ms]` | 0.73 | 2 | 96000 | -16.7 | -3.9 | -4.0 | SON | JSE 'two-handed axe flesh hit' take 2 - meaty mid-high smack, sliced. broadband. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Melee Weapons/WEAPAxe_Long Two-Handed Axe Flesh Hit_JSE_MW.wav` `[7230-7800 ms]` | 0.57 | 2 | 96000 | -15.8 | -3.9 | -4.0 | SON | axe flesh hit take 4 (slice) - lower-pitched take. broadband. |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Impact Flesh 3.mp3` | 0.913 | 2 | 44100 | -23.1 | -6.2 | -6.2 | UAS | Evil Mind 'Impact Flesh 3' - low fleshy hit; 200 ms lead-in to trim. sub/low-heavy (76% <150 Hz); PHONE-SPEAKER RISK: only 15% of energy in 150 Hz-4 kHz; 190 ms lead-in -> trim. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Impact 1.mp3` | 0.678 | 2 | 44100 | -21.6 | -3.0 | -3.0 | UAS | Evil Mind 'Impact 1' - blunt body impact; 220 ms lead-in. broadband; 200 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Doex Studio - 90s Anime SFX Pack/Noise_Punch_006.wav` | 2.064 | 2 | 96000 | -12.0 | -1.4 | -1.4 | SON | Doex 90s-anime 'noise punch' - designed cartoon super-punch (finisher layer). broadband; 60 ms lead-in -> trim. |

#### `kick` - need 1+ (3 ideal) - **PARTIAL**

> Gap / caveat: No file named/foleyed as a kick in any source. Build kick = sub thump + punch_heavy layer + whoosh_light pre-roll.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactSoft_heavy_001.ogg` | 0.572 | 2 | 44100 | -18.4 | -1.0 | -1.0 | CC0-K | Kenney soft heavy impact - pure sub thump (99.9% <150 Hz); kick body. sub/low-heavy (100% <150 Hz); PHONE-SPEAKER RISK: only 0% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactSoft_heavy_003.ogg` | 0.544 | 2 | 44100 | -18.7 | -1.0 | -1.0 | CC0-K | variant. sub/low-heavy (100% <150 Hz); PHONE-SPEAKER RISK: only 0% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Melee Weapons/WEAPArmr_Metal Shield Block Hits_JSE_MW.wav` `[2410-3200 ms]` | 0.79 | 2 | 96000 | -20.2 | -5.9 | -6.0 | SON | JSE shield-block hit take 2 (slice) - low thump with a knock on top. sub/low-heavy (68% <150 Hz). |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Impact 4.mp3` | 0.548 | 2 | 44100 | -23.0 | -2.9 | -3.0 | UAS | Evil Mind 'Impact 4' - blunt impact; 200 ms lead-in. sub/low-heavy (61% <150 Hz); 190 ms lead-in -> trim. |

#### `body_blow_thud` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactSoft_heavy_000.ogg` | 0.505 | 2 | 44100 | -15.8 | -0.9 | -0.9 | CC0-K | Kenney soft heavy impact - deep body thud. sub/low-heavy (100% <150 Hz); PHONE-SPEAKER RISK: only 0% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactSoft_heavy_004.ogg` | 0.501 | 2 | 44100 | -15.8 | -1.0 | -1.0 | CC0-K | variant. sub/low-heavy (100% <150 Hz); PHONE-SPEAKER RISK: only 0% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Cardboard and Paper/OBJPack_Big Cardboard Box Impact_ 02_MWSFX_CDAP.wav` | 0.661 | 2 | 96000 | -15.0 | -1.0 | -1.0 | SON | big cardboard box impact - hollow boomy thud (227 Hz centroid). broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Doex Studio - Qantum UI/UI_Noisy_Impact_09.wav` | 0.773 | 2 | 96000 | -9.4 | -2.8 | -2.8 | SON | Doex 'noisy impact' - loud designed thump (-9.4 LUFS). sub/low-heavy (63% <150 Hz). |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Impact 6.mp3` | 0.939 | 2 | 44100 | -25.3 | -3.0 | -3.0 | UAS | Evil Mind 'Impact 6' - blunt low impact. sub/low-heavy (68% <150 Hz); 160 ms lead-in -> trim. |

#### `bone_crunch` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREBone_Bone Breaks Celery 01_JSE_GMP.wav` `[0-1600 ms]` | 1.6 | 2 | 96000 | -29.8 | -6.0 | -6.0 | SON | JSE gore mini pack 'bone breaks (celery)' take 1 - crunchy bright snap cluster; quiet -> gain. bright top (54% >4 kHz); noise-like (flatness 0.23). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREBone_Bone Breaks Celery 01_JSE_GMP.wav` `[5130-6300 ms]` | 1.17 | 2 | 96000 | -32.4 | -5.9 | -6.0 | SON | take 4 (slice). mid-forward (54% 1-4k); noise-like (flatness 0.24); quiet source (-32.4 LUFS) -> needs gain. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREBone_Bone Breaks Celery 01_JSE_GMP.wav` `[11290-12300 ms]` | 1.01 | 2 | 96000 | -32.2 | -5.8 | -6.0 | SON | take 7 (slice). bright top (79% >4 kHz); quiet source (-32.2 LUFS) -> needs gain. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREBone_Bone Breaks Celery 01_JSE_GMP.wav` `[14340-15250 ms]` | 0.91 | 2 | 96000 | -30.7 | -5.9 | -6.0 | SON | take 8 (slice). broadband; quiet source (-30.7 LUFS) -> needs gain. |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Impact Bonebreak.mp3` | 0.391 | 2 | 44100 | -70.0 | -5.9 | -6.0 | UAS | Evil Mind 'Impact Bonebreak' - short low crack+thud, 3 transients. sub/low-heavy (73% <150 Hz); 70 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/InMotionAudio - Wood/WOODBrk_Snap09_InMotionAudio_Wood.wav` `[540-800 ms]` | 0.26 | 2 | 96000 | -70.0 | -0.1 | -0.3 | SON | InMotion wood snap main crack (slice) - dry bright snap to layer under bone. mid-forward (58% 1-4k). |

#### `slap` - need 2+ - **PARTIAL**

> Gap / caveat: No recorded skin slap in any source. Stand-ins are hand pop / light taps; a real slap needs a recording (or layer hand-pop + light tap).

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Kawaii UI/UIClick_Hand Pop UI Diminished 1_RogueWaves_KawaiiUI.wav` | 0.221 | 2 | 96000 | -70.0 | -2.1 | -2.1 | SON | Rogue Waves kawaii 'hand pop' - short hand/skin pop (84% 1-4 kHz). mid-forward (84% 1-4k). |
| * | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactGeneric_light_004.ogg` | 0.14 | 2 | 44100 | -70.0 | -0.9 | -0.9 | CC0-K | Kenney generic light impact - 140 ms tap (bright-ish, 761 Hz centroid). broadband. |
|  | `F:/games/forgeflow-games-assets/rpg-audio/Audio/bookClose.ogg` | 0.231 | 2 | 48000 | -70.0 | 0.9 | 0.0 | CC0-K | Kenney book close - flat smack, 230 ms. low-mid body (89% 150-1k); true peak +0.9 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Anime Studio/FGHTImpt_Fight Combo x4_RogueWaves_AnimeStudio.wav` `[40-240 ms]` | 0.2 | 2 | 96000 | -70.0 | -7.5 | -7.5 | SON | combo hit 1 (slice) as slap body. broadband. |

#### `whoosh_light` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/FX/Slash.mp3` | 0.704 | 2 | 44100 | -24.2 | -4.4 | -4.5 | UAS | Evil Mind 'Slash' - short airy swish (95% >4 kHz, noise-like). bright top (95% >4 kHz); noise-like (flatness 0.22). |
| * | `F:/games/forgeflow-games-assets/rpg-audio/Audio/knifeSlice2.ogg` | 0.569 | 2 | 48000 | -11.7 | 0.6 | -0.0 | CC0-K | Kenney knife slice - fast bright swipe 0.57 s. bright top (73% >4 kHz); true peak +0.6 dBTP -> needs limiting. |
| * | `F:/games/forgeflow-games-assets/rpg-audio/Audio/knifeSlice.ogg` | 0.6 | 2 | 48000 | -13.7 | -1.3 | -1.3 | CC0-K | Kenney knife slice variant. bright top (64% >4 kHz); 80 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - Distinct Whooshes/WHSH_Pure SciFi-Whoosh Fast 03_RSCPC_DW.wav` `[0-450 ms]` | 0.45 | 2 | 96000 | -20.8 | -2.5 | -2.6 | SON | Rescopic 'pure sci-fi whoosh fast' - trim to first 450 ms for a jab. sub/low-heavy (79% <150 Hz); PHONE-SPEAKER RISK: only 20% of energy in 150 Hz-4 kHz. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Sword 6.mp3` | 0.965 | 2 | 44100 | -18.2 | -5.4 | -5.8 | UAS | Evil Mind 'Sword 6' - noisy swish (flatness 0.27). bright top (94% >4 kHz); noise-like (flatness 0.27). |

#### `whoosh_heavy` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav` `[300-1500 ms]` | 1.2 | 2 | 96000 | -8.6 | -0.2 | -0.2 | SON | Rescopic airy whoosh/wind gust - big low swing, 4.5 s (trim). sub/low-heavy (69% <150 Hz). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - Distinct Whooshes/WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav` `[900-2300 ms]` | 1.4 | 2 | 96000 | -11.3 | -0.2 | -0.2 | SON | Rescopic 'deviant whoosh flabby slow' - slow heavy swing (trim). broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Cinematic Feel/WHSH_Sci-Fi Heavy Whoosh_MWSFX_CF 29.wav` `[0-2000 ms]` | 2.0 | 2 | 96000 | -20.9 | -3.7 | -3.7 | SON | Mechanical Wave sci-fi heavy whoosh - sub-heavy (99% <150 Hz), finisher wind-up. sub/low-heavy (100% <150 Hz); PHONE-SPEAKER RISK: only 0% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Chupapsound - Essential Scifi/WHOOSH PASS SF LOW.wav` | 3.787 | 1 | 48000 | -27.9 | -10.7 | -10.7 | SON | Chupapsound low pass-by whoosh; quiet (-27.9 LUFS). sub/low-heavy (90% <150 Hz); PHONE-SPEAKER RISK: only 10% of energy in 150 Hz-4 kHz; 410 ms lead-in -> trim. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Update 1.3/Spells/Spell - Air 2.mp3` | 1.909 | 2 | 44100 | -14.5 | -0.3 | -0.3 | UAS | Evil Mind 'Spell - Air 2' - airy rush 1.9 s. low-mid body (70% 150-1k); 90 ms lead-in -> trim. |

#### `grab_cloth` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/rpg-audio/Audio/cloth1.ogg` | 0.661 | 2 | 48000 | -22.9 | -3.5 | -3.5 | CC0-K | Kenney cloth rustle - grab. broadband. |
| * | `F:/games/forgeflow-games-assets/rpg-audio/Audio/cloth3.ogg` | 0.477 | 2 | 48000 | -27.8 | -10.1 | -10.1 | CC0-K | Kenney cloth rustle variant. broadband. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/TheWorkRoom Audio Post - Neoprene - Dry - Wetsuit/NEO008.wav` `[5260-5600 ms]` | 0.34 | 1 | 96000 | -70.0 | -0.7 | -1.0 | SON | TheWorkRoom dry neoprene movement take (slice) - rubbery cloth grab. broadband; noise-like (flatness 0.48). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/TheWorkRoom Audio Post - Neoprene - Dry - Wetsuit/NEO008.wav` `[14410-14720 ms]` | 0.31 | 1 | 96000 | -70.0 | -1.0 | -1.0 | SON | neoprene take (slice). broadband; noise-like (flatness 0.29). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/InMotionAudio - Torn T-Shirt/CLOTHRip_CottonRips92_InMotionAudio_TornTShirt.wav` `[50-230 ms]` | 0.18 | 2 | 96000 | -70.0 | -0.6 | -1.0 | SON | InMotion torn T-shirt rip (slice) - shirt-grab tear accent. broadband; noise-like (flatness 0.20). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/InMotionAudio - Torn T-Shirt/CLOTHRip_CottonRips74_InMotionAudio_TornTShirt.wav` `[820-1300 ms]` | 0.48 | 2 | 96000 | -19.6 | -1.0 | -1.0 | SON | torn T-shirt rip, longer (slice). bright top (66% >4 kHz); noise-like (flatness 0.34). |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Update 1.3/Coins and Inventory/Equip (Clothes).mp3` | 1.178 | 2 | 44100 | -26.4 | -10.1 | -10.1 | UAS | Evil Mind 'Equip (Clothes)' - cloth handling 1.2 s. sub/low-heavy (64% <150 Hz). |

#### `body_fall` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav` `[2230-2800 ms]` | 0.57 | 2 | 96000 | -24.9 | -6.0 | -6.0 | SON | JSE gore 'flesh drops on floor' take (slice) - heavy low thud. sub/low-heavy (73% <150 Hz); PHONE-SPEAKER RISK: only 14% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav` `[4590-5150 ms]` | 0.56 | 2 | 96000 | -26.7 | -6.0 | -6.0 | SON | flesh drop take (slice) - low thud. sub/low-heavy (63% <150 Hz); PHONE-SPEAKER RISK: only 14% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav` `[13700-14200 ms]` | 0.5 | 2 | 96000 | -26.4 | -6.0 | -6.0 | SON | flesh drop take (slice) - very low thud. sub/low-heavy (77% <150 Hz). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav` `[16590-17100 ms]` | 0.51 | 2 | 96000 | -26.3 | -5.9 | -6.0 | SON | flesh drop take (slice). mid-forward (50% 1-4k). |
|  | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPlate_heavy_004.ogg` | 0.559 | 2 | 44100 | -23.6 | -0.6 | -0.6 | CC0-K | Kenney heavy plate impact - low slam 0.56 s. sub/low-heavy (90% <150 Hz); PHONE-SPEAKER RISK: only 10% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Plastic Textures Library/Flexible Sewer Pipe Big - Broken - DROP - Thump - Mono.wav` `[15010-15500 ms]` | 0.49 | 1 | 192000 | -23.2 | -1.0 | -1.0 | SON | PP big sewer-pipe drop thump, last take (slice). broadband. |

#### `wall_slam` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Door Slams, Impacts, 3_RogueWaves_CreakingDoor.wav` `[0-700 ms]` | 0.7 | 2 | 96000 | -22.5 | -2.9 | -2.9 | SON | Rogue Waves wooden door slam take 1 (slice) - deep boomy slam. sub/low-heavy (87% <150 Hz); PHONE-SPEAKER RISK: only 13% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Door Slams, Impacts, 3_RogueWaves_CreakingDoor.wav` `[2250-3050 ms]` | 0.8 | 2 | 96000 | -20.2 | -0.2 | -0.2 | SON | door slam take 2 (slice) - loudest of the six. sub/low-heavy (92% <150 Hz); PHONE-SPEAKER RISK: only 7% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Door Slams, Impacts, 3_RogueWaves_CreakingDoor.wav` `[8500-9350 ms]` | 0.85 | 2 | 96000 | -19.4 | -0.6 | -0.6 | SON | door slam take 4 (slice). sub/low-heavy (82% <150 Hz); PHONE-SPEAKER RISK: only 18% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Creaking Door/DOORCreak_Wooden Door, Door Slams, Impacts, 3_RogueWaves_CreakingDoor.wav` `[11120-11950 ms]` | 0.83 | 2 | 96000 | -19.4 | -0.9 | -0.9 | SON | door slam take 5 (slice). sub/low-heavy (83% <150 Hz); PHONE-SPEAKER RISK: only 17% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/rpg-audio/Audio/doorClose_3.ogg` | 0.714 | 2 | 48000 | -8.2 | 1.5 | 0.0 | CC0-K | Kenney door close - hot (+1.5 dBTP), mid slam. broadband; true peak +1.5 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_015.wav` | 1.6 | 2 | 96000 | -19.2 | -0.2 | -0.2 | SON | Bluezone stone impact - bright stone crack layer for brick walls. mid-forward (63% 1-4k). |

#### `wet_splat` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GORESplt_Gore Splatter 01_JSE_GMP.wav` `[0-1350 ms]` | 1.35 | 2 | 96000 | -22.5 | -6.0 | -6.0 | SON | JSE gore splatter take 1 (slice) - wet squelch, ~4 kHz centroid. mid-forward (54% 1-4k); noise-like (flatness 0.20). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GORESplt_Gore Splatter 01_JSE_GMP.wav` `[4800-5450 ms]` | 0.65 | 2 | 96000 | -21.0 | -6.0 | -6.0 | SON | gore splatter take 3 (slice). mid-forward (51% 1-4k); noise-like (flatness 0.20). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GORESplt_Gore Splatter 01_JSE_GMP.wav` `[7200-8100 ms]` | 0.9 | 2 | 96000 | -21.4 | -4.1 | -6.0 | SON | gore splatter take 4 (slice). bright top (53% >4 kHz); noise-like (flatness 0.42). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Gore Mini Pack/GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav` `[9510-10400 ms]` | 0.89 | 2 | 96000 | -26.4 | -6.0 | -6.0 | SON | flesh-drop take with splash tail (slice). sub/low-heavy (89% <150 Hz); PHONE-SPEAKER RISK: only 4% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Cinematic Feel/DSGNMisc_Gore Downshifter_MWSFX_CF 01.wav` | 7.296 | 2 | 96000 | -13.8 | -1.0 | -1.0 | SON | Mechanical Wave designed 'gore downshifter' - finisher splat design. mid-forward (56% 1-4k); 80 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Designed Water/Bluezone_BC0298_designed_water_impact_006.wav` | 3.3 | 2 | 96000 | -11.6 | -0.2 | -0.2 | SON | Bluezone designed water impact - big wet boom (92% <150 Hz). sub/low-heavy (92% <150 Hz); PHONE-SPEAKER RISK: only 8% of energy in 150 Hz-4 kHz. |

#### `glass_break` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Glass/GLASBrk_Glass Break Hit_04_MWSFX_GL.wav` | 1.16 | 2 | 96000 | -16.8 | -1.5 | -1.5 | SON | Mechanical Wave glass break hit - bright shatter (91% >4 kHz), 1.16 s. bright top (86% >4 kHz); noise-like (flatness 0.23). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Alien Tripod/Bluezone_BC0292_alien_tripod_debris_glass_falling_003.wav` | 1.5 | 2 | 96000 | -14.0 | 0.0 | -0.2 | SON | Bluezone glass debris falling - shatter tail. bright top (76% >4 kHz); true peak +0.0 dBTP -> needs limiting. |
|  | `F:/games/unity-assets/ElvGames__2D Platformer Tilesets Bundle 16x16 Pixelart/Assets/ElvGames/Platformer Series/Sound Effects/Vases_Breaking_1.wav` | 2.067 | 2 | 48000 | -19.1 | 0.0 | 0.0 | UAS | ElvGames vase breaking - ceramic/glass smash. mid-forward (66% 1-4k); true peak +0.0 dBTP -> needs limiting; 70 ms lead-in -> trim. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Ice Broken.mp3` | 2.139 | 2 | 44100 | -19.9 | -3.0 | -3.0 | UAS | Evil Mind 'Ice Broken' - glassy crackle cluster. broadband; noise-like (flatness 0.36); 80 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Videogame Foley Essentials Vol. II/SBvfe2_Glass 114.wav` | 0.713 | 1 | 192000 | -42.9 | -17.0 | -17.0 | SON | Sonic Bat glass foley - small glass hit, quiet. bright top (87% >4 kHz); noise-like (flatness 0.54); quiet source (-42.9 LUFS) -> needs gain. |

#### `metal_pipe_clang` - need 3+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Iron - Thick - HIT - Hammer.wav` `[0-1700 ms]` | 1.7 | 1 | 192000 | -24.2 | -2.0 | -2.0 | SON | PP metal hit sweeteners: thick iron hit with hammer, take 1 (slice incl. ring). mid-forward (55% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Iron - Thick - HIT - Hammer.wav` `[3570-5250 ms]` | 1.68 | 1 | 192000 | -24.8 | -3.6 | -3.6 | SON | thick iron hit take 3 (slice). mid-forward (67% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Torturing Metal/METLImpt_Metal Impact-03_MWSFX_TM.wav` | 1.46 | 2 | 96000 | -16.5 | -0.3 | -0.6 | SON | Mechanical Wave metal impact - mid clang (86% 1-4 kHz). mid-forward (86% 1-4k); 70 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Oil Barrel - HIT - Hammer - Take 2.wav` `[0-1500 ms]` | 1.5 | 1 | 192000 | -24.9 | -3.4 | -3.4 | SON | oil barrel hammer hit take 1 (slice) - hollow low-mid bong. low-mid body (69% 150-1k). |
|  | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactMetal_heavy_001.ogg` | 0.359 | 2 | 44100 | -70.0 | -1.1 | -1.1 | CC0-K | Kenney heavy metal impact - short clank. mid-forward (71% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Stone Impact/Bluezone_BC0297_stone_impact_steel_bar_01_010.wav` | 0.8 | 2 | 96000 | -21.6 | 0.1 | -0.2 | SON | Bluezone steel bar impact. broadband; true peak +0.1 dBTP -> needs limiting. |

#### `wooden_bat_crack` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/InMotionAudio - Wood/WOODBrk_Snap09_InMotionAudio_Wood.wav` `[540-900 ms]` | 0.36 | 2 | 96000 | -70.0 | -0.1 | -0.3 | SON | InMotion wood snap (slice) - dry crack, 4.2 kHz centroid. mid-forward (58% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/InMotionAudio - Wood/WOODImpt_Drops20_InMotionAudio_Wood.wav` | 0.622 | 2 | 96000 | -19.4 | -0.3 | -0.3 | SON | InMotion wood drop - hard wooden knock (95% 1-4 kHz). mid-forward (95% 1-4k). |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Stick 1.mp3` | 0.809 | 2 | 44100 | -18.2 | -1.3 | -1.3 | UAS | Evil Mind 'Stick 1' - wooden stick hit; 120 ms lead-in. low-mid body (68% 150-1k); 100 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/DavidDumais - Explosion SFX Pack/WOODCrsh_Designed Wood Crash And Debris 13_DDUMAIS_NONE.wav` | 1.725 | 2 | 96000 | -15.5 | -1.0 | -1.0 | SON | David Dumais designed wood crash - bat-breaks-on-body variant. broadband. |
|  | `F:/games/unity-assets/ElvGames__2D Platformer Tilesets Bundle 16x16 Pixelart/Assets/ElvGames/Platformer Series/Sound Effects/Wood_Breaking_1.wav` | 0.542 | 2 | 48000 | -18.7 | -1.5 | -1.6 | UAS | ElvGames wood breaking - splinter. broadband. |
|  | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactPlank_medium_001.ogg` | 0.779 | 2 | 44100 | -16.3 | -1.0 | -1.0 | CC0-K | Kenney plank impact - wooden thump. broadband. |

#### `electric_zap` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Electric Shock 2.mp3` | 0.704 | 2 | 44100 | -12.6 | -4.0 | -4.1 | UAS | Evil Mind 'Electric Shock 2' - bright zap 0.7 s (86% >4 kHz). bright top (86% >4 kHz). |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Electric Shock 1.mp3` | 1.33 | 2 | 44100 | -17.5 | -7.8 | -8.0 | UAS | Evil Mind 'Electric Shock 1' - zap 1.3 s. bright top (68% >4 kHz). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - Parallax/SCIMisc_Zap Short 14_RSCPC_PX.wav` | 2.137 | 2 | 96000 | -12.1 | -2.0 | -2.1 | SON | Rescopic 'zap short' - 2.1 s designed zap. broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_surge_discharge_electrical_arc_crackling_002_01.wav` | 3.52 | 2 | 96000 | -11.2 | 0.0 | -0.2 | SON | Bluezone electrical arc surge/crackle - 3.5 s, loud (-11.2 LUFS). broadband; true peak +0.0 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_texture_sizzling_crackling_006.wav` | 2.82 | 2 | 96000 | -22.1 | 0.6 | -0.2 | SON | Bluezone sizzling crackle - noise-like loop for live wires. bright top (92% >4 kHz); noise-like (flatness 0.88); true peak +0.6 dBTP -> needs limiting. |

#### `fire_whoosh` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Fireball 2.mp3` | 1.174 | 2 | 44100 | -14.6 | -0.2 | -0.2 | UAS | Evil Mind 'Fireball 2' - boomy fire whoosh 1.2 s (45% <150 Hz). broadband; 230 ms lead-in -> trim. |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Fireball 1.mp3` | 0.887 | 2 | 44100 | -14.8 | -1.1 | -1.1 | UAS | Evil Mind 'Fireball 1' - fire whoosh 0.9 s. broadband; 200 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/27,Searing.wav` `[0-2500 ms]` | 2.5 | 2 | 96000 | -17.1 | -5.3 | -5.3 | SON | Orbital Emitter 'Searing' - designed burn/sear transition, 6 s (trim). broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Justsoundeffects - Steampunk Gadgets/AIRBrst_Steam Release Short 03_JSE_SG_Mono.wav` `[0-1000 ms]` | 1.0 | 1 | 96000 | -16.5 | -4.6 | -4.6 | SON | JSE steam release burst (slice) - hissing flame-jet stand-in (94% >4 kHz). bright top (95% >4 kHz); noise-like (flatness 0.69). |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Spell - Fire Loop.mp3` | 9.677 | 2 | 44100 | -33.0 | -18.8 | -19.5 | UAS | Evil Mind 'Fire Loop' - quiet burning loop 9.7 s (-33 LUFS). broadband; quiet source (-33.0 LUFS) -> needs gain. |

#### `explosion` - need 2+ - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/DavidDumais - Explosion SFX Pack/EXPLReal_Medium Realistic Explosion 15_DDUMAIS_NONE.wav` | 2.361 | 2 | 96000 | -13.8 | -1.0 | -1.0 | SON | David Dumais medium realistic explosion - 2.4 s, 75% <150 Hz. sub/low-heavy (75% <150 Hz). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Steampunk Weapon And Textures/Bluezone_BC0296_steampunk_weapon_flare_shot_explosion_003.wav` | 2.299 | 2 | 96000 | -15.1 | 0.1 | -0.2 | SON | Bluezone flare-shot explosion - 2.3 s punchy. sub/low-heavy (84% <150 Hz); true peak +0.1 dBTP -> needs limiting; PHONE-SPEAKER RISK: only 12% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Warfare 2 Library/Tank Mine - EXPLOSION - Mounted on Metal Beam - DISTANT - AMBEO BLD.wav` `[820-2700 ms]` | 1.88 | 1 | 96000 | -24.6 | -3.0 | -3.9 | SON | PP tank mine explosion (distant) - 1.8 s boom (slice). sub/low-heavy (80% <150 Hz); PHONE-SPEAKER RISK: only 18% of energy in 150 Hz-4 kHz. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/DavidDumais - Explosion SFX Pack/DESTRCrsh_Designed Car Explosion With Metal Breaking And Glass Shattering  06_DDUMAIS_NONE.wav` | 5.139 | 2 | 96000 | -11.9 | -1.0 | -1.0 | SON | David Dumais car explosion w/ metal + glass - 5.1 s (env kill). sub/low-heavy (70% <150 Hz). |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/FX/Cannon.mp3` | 3.026 | 2 | 44100 | -15.5 | -1.2 | -1.2 | UAS | Evil Mind 'Cannon' - low boom 3 s. sub/low-heavy (85% <150 Hz); PHONE-SPEAKER RISK: only 15% of energy in 150 Hz-4 kHz; 130 ms lead-in -> trim. |

### TV-show SFX

#### `air_horn` - need 1-2 - **PARTIAL**

> Gap / caveat: No stadium/party air horn recording. A bus horn is the nearest in pitch/brass; a true air-horn blast is a gap.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Vehicle Doors and More Library/Man Lions Coach - VAR SFX - Horn Various - Mono - RSM191.wav` `[59900-60900 ms]` | 1.0 | 1 | 96000 | -8.2 | -0.3 | -0.4 | SON | PP MAN Lions coach (bus) horn blast (slice) - brassy 2.4 kHz centroid; closest to an air horn. mid-forward (72% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Vehicle Doors and More Library/Man Lions Coach - VAR SFX - Horn Various - Mono - RSM191.wav` `[89900-93000 ms]` | 3.1 | 1 | 96000 | -11.6 | -2.9 | -2.9 | SON | coach horn, long blast (slice). mid-forward (54% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Vehicle Doors and More Library/Man Lions Coach - VAR SFX - Horn Various - Mono - RSM191.wav` `[5100-5900 ms]` | 0.8 | 1 | 96000 | -9.0 | -6.4 | -6.6 | SON | coach horn short toot (slice). mid-forward (74% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Dramatic Cat - Audi Q7/VEHHorn_Audi Q7 EXTERIOR Horn Short And Long MONO_DRCA_AUQ7_Kmr81i.wav` `[40-340 ms]` | 0.3 | 1 | 96000 | -70.0 | -1.1 | -1.1 | SON | Dramatic Cat Audi Q7 car horn short (slice) - comedic honk. low-mid body (73% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - Ferrari 458 2013/Ferrari 458 Straight Pipes - t11 - VAR SFX - Horn Various - Wide AB - MKH8060.wav` `[350-1600 ms]` | 1.25 | 2 | 96000 | -17.4 | -7.9 | -7.9 | SON | PP Ferrari horn (slice) - car horn. low-mid body (63% 150-1k). |

#### `bell_ding` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Mechanical Wave - Sound Effects Collection/BELLHand_Metallic Bell_ 22_MWSFX_SEC.wav` `[0-1450 ms]` | 1.45 | 2 | 96000 | -15.7 | -1.5 | -1.8 | SON | Mechanical Wave metallic hand bell - bright ring (90% >4 kHz) - round bell/ding. bright top (91% >4 kHz). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/80,TheGong.wav` | 6.521 | 2 | 96000 | -18.0 | -5.6 | -5.6 | SON | Orbital Emitter 'The Gong' - gong hit 6.5 s - episode/round start. broadband; 120 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactBell_heavy_000.ogg` | 1.48 | 2 | 44100 | -24.6 | -1.1 | -1.1 | CC0-K | Kenney heavy bell impact - low bell 1.5 s. low-mid body (98% 150-1k). |
|  | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/FX/Church Bell 2.mp3` | 2.113 | 2 | 44100 | -20.7 | -9.4 | -9.4 | UAS | Evil Mind church bell 2 - 2.1 s. mid-forward (88% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Spade - HIT - Drumstick - Ring - Mute.wav` `[2330-4300 ms]` | 1.97 | 1 | 192000 | -22.6 | -1.0 | -1.0 | SON | PP spade struck with drumstick (slice) - ringing 'ting'. bright top (88% >4 kHz); noise-like (flatness 0.32). |

#### `drum_roll` - need 1 - **GAP**

> Gap / caveat: No drum roll in the listed sources: a filename search for drum/snare found only this drumstick-on-spade recording (single hits). Needs a sourced or synthesised roll.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Spade - HIT - Drumstick - Ring - Mute.wav` `[2330-2500 ms]` | 0.17 | 1 | 192000 | -70.0 | -1.0 | -1.0 | SON | only drumstick recording in scope (single hits) - NOT a roll. bright top (89% >4 kHz); noise-like (flatness 0.32). |

#### `rimshot` - need 1 - **GAP**

> Gap / caveat: No rimshot / 'ba-dum-tss' in scope. Proxies only.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - The Metal Hit Sweeteners Library/Spade - HIT - Drumstick - Ring - Mute.wav` `[4420-4700 ms]` | 0.28 | 1 | 192000 | -70.0 | -1.3 | -1.3 | SON | drumstick-on-spade tick (slice) - rimshot-ish proxy. bright top (84% >4 kHz). |
|  | `F:/games/forgeflow-games-assets/impact-sounds/Audio/impactWood_light_002.ogg` | 0.266 | 2 | 44100 | -70.0 | -1.1 | -1.1 | CC0-K | Kenney light wood impact - woodblock-like tock proxy. low-mid body (99% 150-1k). |

#### `cash_register` - need 1 - **PARTIAL**

> Gap / caveat: No cash-register 'ka-ching' recording. Build = lever ka-chunk + coin jingle + bell_ding.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Update 1.3/Coins and Inventory/Coins Bag 2.mp3` | 0.866 | 2 | 44100 | -12.5 | 0.5 | -0.2 | UAS | Evil Mind coins bag - coin jingle (95% >4 kHz). bright top (95% >4 kHz); noise-like (flatness 0.39); true peak +0.5 dBTP -> needs limiting. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Update 1.3/Coins and Inventory/Coins 3.mp3` | 1.075 | 2 | 44100 | -17.3 | 0.2 | -0.4 | UAS | Evil Mind coins 3 - coin spill 1.1 s. broadband; true peak +0.2 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/rpg-audio/Audio/handleCoins.ogg` | 0.846 | 2 | 48000 | -20.9 | 1.0 | 0.0 | CC0-K | Kenney handle coins - coin jingle 0.85 s. bright top (94% >4 kHz); true peak +1.0 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/_downloaded/audio-cache/sfx/4631aacc_fs_646673.ogg` | 1.496 | 2 | 44100 | -21.3 | -5.1 | -5.1 | CC0-FS | Freesound 'Coin Pickup SFX [1]' (CC0) - arcade coin. sub/low-heavy (75% <150 Hz); 70 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Industrial Lever Switch/Bluezone_BC0302_industrial_lever_switch_014.wav` | 1.625 | 2 | 96000 | -10.8 | -0.2 | -0.2 | SON | Bluezone industrial lever switch - mechanical ka-chunk to layer before the coins. broadband. |

#### `buzzer` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/error_006.ogg` | 0.5 | 1 | 44100 | -19.8 | -0.8 | -0.8 | CC0-K | Kenney error 006 - low buzz 0.5 s (61% <150 Hz). sub/low-heavy (61% <150 Hz). |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/error_005.ogg` | 0.5 | 1 | 44100 | -20.9 | -1.0 | -1.0 | CC0-K | Kenney error 005 - low buzz 0.5 s. sub/low-heavy (80% <150 Hz); PHONE-SPEAKER RISK: only 20% of energy in 150 Hz-4 kHz. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Pole Position - Beechcraft Baron 58 1969/Beechcraft Baron 58 - t12 - VAR SFX - Stall Warning - MS Decoded - RSM191.wav` `[11570-13070 ms]` | 1.5 | 2 | 96000 | -12.3 | -5.1 | -5.1 | SON | PP aircraft stall-warning horn (slice) - harsh continuous warning tone. mid-forward (56% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/BluezoneCorp - Retrofuturistic Computer/Bluezone_BC0304_retrofuturistic_computer_alarm_005.wav` | 4.182 | 2 | 96000 | -13.0 | 0.0 | -0.2 | SON | Bluezone retro computer alarm - 4.2 s bright alarm. bright top (79% >4 kHz); true peak +0.0 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/UberDuo - The Mountain Townhouse Audio Playset/BEEPAppl_Microwave, Beeps_UberDuo_TOWN.wav` `[7680-8250 ms]` | 0.57 | 2 | 192000 | -34.0 | -26.7 | -26.7 | SON | UberDuo microwave beep (slice) - 2 kHz timer beep. mid-forward (99% 1-4k); quiet source (-34.0 LUFS) -> needs gain. |

#### `jingle_sting` - need 4+ short stings - **PARTIAL**

> Gap / caveat: Chiptune/fantasy flavoured stings dominate; only the overdriven guitar scrapes are rock. No TV-show brass/band stings.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Metal Tensions/MUSCStngr_Pick Scrape Down, Short, Overdriven_RogueWaves_MetalTensions.wav` `[0-1150 ms]` | 1.15 | 1 | 96000 | -14.8 | -6.9 | -6.9 | SON | Rogue Waves 'metal tensions': overdriven guitar pick-scrape sting (slice) - rock sting. mid-forward (60% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Metal Tensions/MUSCStngr_Pick Scrape Down, Short, Overdriven_RogueWaves_MetalTensions.wav` `[3990-5200 ms]` | 1.21 | 1 | 96000 | -15.3 | -7.5 | -7.6 | SON | overdriven pick-scrape sting 2 (slice). mid-forward (52% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rogue Waves - Metal Tensions/MUSCStngr_Pick Scrape Down, Short, Overdriven_RogueWaves_MetalTensions.wav` `[8650-10450 ms]` | 1.8 | 1 | 96000 | -16.1 | -6.7 | -6.7 | SON | overdriven pick-scrape, long (slice). broadband. |
| * | `F:/games/unity-assets/Corentin Guezenoc__8-bit Platformer Vertical Slice Kit/Assets/8-bit Platformer Music Pack/STINGER_Battle_Starts.wav` | 1.154 | 2 | 44100 | -6.1 | -1.0 | -1.0 | UAS | Corentin 8-bit 'Battle Starts' stinger 1.15 s - round start. sub/low-heavy (90% <150 Hz); PHONE-SPEAKER RISK: only 10% of energy in 150 Hz-4 kHz. |
| * | `F:/games/unity-assets/Chris Kohler__8-Bit RPG Adventure Music Pack/Assets/8-Bit RPG Adventure Music Pack v1.1/Tracks WAV/Jingles+SFX/02_Jingle_ Level Clear 2.wav` | 4.154 | 2 | 44100 | -8.8 | -0.1 | -0.5 | UAS | Chris Kohler 8-bit jingle 'Level Clear 2' 4.2 s - round won. broadband; 460 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/_downloaded/audio-cache/sfx/77fb9d9e_fs_528958.ogg` | 3.431 | 2 | 44100 | -15.8 | -2.3 | -2.3 | CC0-FS | Freesound Beetlemuse 'Level Up / Mission Complete' (CC0) 3.4 s. sub/low-heavy (90% <150 Hz); PHONE-SPEAKER RISK: only 8% of energy in 150 Hz-4 kHz. |
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/FX/Puntuation Sound.mp3` | 0.209 | 2 | 44100 | -70.0 | -7.2 | -7.2 | UAS | Evil Mind 'Puntuation Sound' - 0.21 s bright score tick (use per score tick). bright top (96% >4 kHz). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Doex Studio - 90s Anime SFX Pack/Comedic_006.wav` `[0-780 ms]` | 0.78 | 2 | 96000 | -22.7 | -9.0 | -9.0 | SON | Doex 90s-anime 'comedic' sting (4 identical copies in file; slice 1). broadband. |

#### `commercial_break_sting` - need 1-2 - **PARTIAL**

> Gap / caveat: No purpose-made 'we'll be right back' TV sting; proposal is a lo-tech tape one-shot + the ringmaster interval line.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Used Bin Loops - Lo-Tech Premium Degraded Tape FX/UBL_Lo-Tech_70_one_shot_key_Amin.wav` | 6.858 | 2 | 48000 | -12.1 | -1.0 | -1.0 | SON | Used Bin Loops lo-tech degraded-tape key one-shot (A minor) - VHS/ad-bumper feel. low-mid body (99% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Used Bin Loops - Lo-Tech Premium Degraded Tape FX/UBL_Lo-Tech_110_one_shot_pad_Dmin.wav` | 12.981 | 2 | 48000 | -14.5 | -1.1 | -1.1 | SON | lo-tech degraded-tape pad one-shot (D minor). low-mid body (78% 150-1k); 80 ms lead-in -> trim. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Jake Fielding - Circus Ambiences/VOXFem_Accouncement Wet, Ringmaster, Performer, Dialogue_JF_Circus_01.wav` `[1800-4300 ms]` | 2.5 | 2 | 48000 | -27.6 | -13.3 | -13.3 | SON | Jake Fielding circus ringmaster PA: 'there will now be a 20 minute interval.' (slice, whisper words 1.84-4.06 s). mid-forward (71% 1-4k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/08,DragonReveal - dramatic and recap.wav` `[0-3500 ms]` | 3.5 | 2 | 96000 | -20.3 | -5.5 | -5.5 | SON | Orbital Emitter 'Dragon reveal - dramatic and recap' transition 11 s (trim). sub/low-heavy (62% <150 Hz). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/TheWorkRoom Audio Post - Music Spill/MUS026.wav` | 35.79 | 2 | 48000 | -11.1 | -1.0 | -1.0 | SON | TheWorkRoom 'music spill' - music heard through a wall (break muzak candidate). sub/low-heavy (83% <150 Hz); PHONE-SPEAKER RISK: only 17% of energy in 150 Hz-4 kHz. |

### UI

#### `ui_move` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/tick_002.ogg` | 0.023 | 1 | 44100 | -70.0 | 1.1 | -1.2 | CC0-K | Kenney tick - 23 ms. broadband; true peak +1.1 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/select_002.ogg` | 0.043 | 2 | 44100 | -70.0 | -0.9 | -1.0 | CC0-K | Kenney select 002 - 43 ms low tick. low-mid body (71% 150-1k). |
| * | `F:/games/forgeflow-games-assets/_downloaded/ui-audio/Audio/rollover2.ogg` | 0.057 | 2 | 44100 | -70.0 | -1.7 | -1.8 | CC0-K | Kenney UI rollover 2 - 57 ms. low-mid body (77% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav` | 0.147 | 2 | 48000 | -70.0 | -2.9 | -3.0 | SON | CB Sounddesign UI click 33 - 150 ms. mid-forward (54% 1-4k). |

#### `ui_select` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/select_003.ogg` | 0.383 | 1 | 44100 | -70.0 | -0.8 | -0.8 | CC0-K | Kenney select 003 - 0.38 s. mid-forward (74% 1-4k). |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/switch_002.ogg` | 0.611 | 2 | 44100 | -21.8 | -0.9 | -0.9 | CC0-K | Kenney switch 002. mid-forward (62% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - User Interaction/UIClick_Select Middle 29_RSCPC_USIN.wav` | 0.589 | 2 | 96000 | -15.8 | -3.2 | -3.2 | SON | Rescopic UI select middle 29 - 0.59 s. broadband; noise-like (flatness 0.25). |
|  | `F:/games/forgeflow-games-assets/_downloaded/ui-audio/Audio/click3.ogg` | 0.086 | 2 | 44100 | -70.0 | -0.7 | -0.8 | CC0-K | Kenney UI click 3. mid-forward (66% 1-4k). |

#### `ui_confirm` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/confirmation_002.ogg` | 0.539 | 1 | 44100 | -13.3 | -0.9 | -1.0 | CC0-K | Kenney confirmation 002 - 0.54 s chime. mid-forward (95% 1-4k). |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/confirmation_004.ogg` | 0.49 | 1 | 44100 | -10.3 | -0.9 | -0.9 | CC0-K | Kenney confirmation 004. mid-forward (66% 1-4k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Rescopic Sound - User Interaction/UIAlert_Confirm Middle 12_RSCPC_USIN.wav` | 1.043 | 2 | 96000 | -17.3 | -4.7 | -4.7 | SON | Rescopic UI confirm middle 12 - 1.0 s. broadband. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/CB Sounddesign - Activation 2/UIMisc_Feedback 36 up_CB Sounddesign_ACTIVATION2.wav` | 0.779 | 2 | 48000 | -15.2 | -2.6 | -3.0 | SON | CB Sounddesign feedback up - 0.78 s. mid-forward (57% 1-4k). |

#### `ui_back` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/back_001.ogg` | 0.064 | 1 | 44100 | -70.0 | -0.9 | -1.0 | CC0-K | Kenney back 001 - 64 ms. mid-forward (61% 1-4k). |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/back_003.ogg` | 0.093 | 1 | 44100 | -70.0 | 0.1 | -0.9 | CC0-K | Kenney back 003. broadband; true peak +0.1 dBTP -> needs limiting. |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/minimize_005.ogg` | 0.526 | 1 | 44100 | -14.6 | -0.6 | -0.8 | CC0-K | Kenney minimize 005 - 0.53 s down-sweep. bright top (92% >4 kHz). |
|  | `F:/games/unity-assets/ElvGames__2D Platformer Tilesets Bundle 16x16 Pixelart/Assets/ElvGames/Platformer Series/Sound Effects/UI_Decline_1.wav` | 0.534 | 2 | 48000 | -21.1 | -1.0 | -1.0 | UAS | ElvGames UI decline. mid-forward (66% 1-4k); 70 ms lead-in -> trim. |

#### `ui_error` - need 1-2 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/interface-sounds/Audio/error_003.ogg` | 0.533 | 2 | 44100 | -15.9 | -0.2 | -0.5 | CC0-K | Kenney error 003 - 0.53 s. mid-forward (66% 1-4k). |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/error_008.ogg` | 0.139 | 1 | 44100 | -70.0 | -0.9 | -1.0 | CC0-K | Kenney error 008 - 0.14 s. broadband. |
|  | `F:/games/forgeflow-games-assets/interface-sounds/Audio/error_006.ogg` | 0.5 | 1 | 44100 | -19.8 | -0.8 | -0.8 | CC0-K | shared with buzzer. sub/low-heavy (61% <150 Hz). |

### Music

#### `music_menu` - need 1 - **PARTIAL**

> Gap / caveat: Nothing labelled rock/funk/synth for a menu; genre fit unverified (cannot listen).

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Update 1.1/Music/Hey Ho Jack-O.mp3` | 56.928 | 2 | 48000 | -17.4 | -2.1 | -2.1 | UAS | Evil Mind 'Hey Ho Jack-O' 56.9 s, est 136 BPM, 3.5 onsets/s (bouncy). broadband. Tempo est 136.0 BPM, 3.51 onsets/s. |
|  | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Music/Generic Halloween Menu.mp3` | 57.957 | 2 | 44100 | -14.6 | -2.4 | -2.5 | UAS | Evil Mind 'Generic Halloween Menu' 58 s, est 123 BPM - Halloween-themed. broadband. Tempo est 123.0 BPM, 2.02 onsets/s. |
|  | `F:/games/unity-assets/Florian Stracker__The Heros Path Free 16bit Adventure Game Music/Assets/TheHerosPath/The Hero's Path (Free 16bit Video Game Music)/OGG/12.2_LOOP_Conviction_by_Florian_Stracker.ogg` | 50.898 | 2 | 44100 | -9.3 | 0.0 | -0.0 | UAS | Florian Stracker 16-bit 'Conviction' loop 50.9 s, -9.3 LUFS. low-mid body (86% 150-1k); true peak +0.0 dBTP -> needs limiting. Tempo est 152.0 BPM, 1.95 onsets/s. |

#### `music_stage` - need 5 tracks - **PARTIAL**

> Gap / caveat: Brief asks gritty rock / metal / synth-punk / funk. In scope only 'Halloween Rocks' is labelled rock; the rest are Halloween/fantasy/chiptune by label. Unused Travis Rise synthwave (outside listed sources) is the nearest synth fit.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Music/Halloween Rocks.mp3` | 59.001 | 2 | 44100 | -19.3 | -3.2 | -3.2 | UAS | Evil Mind 'Halloween Rocks' 59 s, est 129 BPM - only in-scope track labelled rock besides the boss metal. sub/low-heavy (73% <150 Hz). Tempo est 129.2 BPM, 3.0 onsets/s. |
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Update 1.4/Music/Freak Invasion.mp3` | 73.872 | 2 | 48000 | -7.9 | 1.0 | 0.0 | UAS | Evil Mind 'Freak Invasion' 73.9 s, est 129 BPM, loud/dense (-7.9 LUFS, 2 dB spread). broadband; true peak +1.0 dBTP -> needs limiting. Tempo est 129.2 BPM, 2.6 onsets/s. |
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Update 1.4/Music/Spooky Lands.mp3` | 73.872 | 2 | 48000 | -8.3 | 0.7 | 0.0 | UAS | Evil Mind 'Spooky Lands' 73.9 s, est 129 BPM, -8.3 LUFS. sub/low-heavy (65% <150 Hz); true peak +0.7 dBTP -> needs limiting. Tempo est 129.2 BPM, 2.48 onsets/s. |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Music/Bloody Battlefield.mp3` | 56.836 | 2 | 44100 | -9.8 | -0.0 | -0.0 | UAS | Evil Mind 'Bloody Battlefield' 56.8 s, est 136 BPM, -9.8 LUFS. broadband; true peak -0.0 dBTP -> needs limiting. Tempo est 136.0 BPM, 1.46 onsets/s. |
| * | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Music/The Evil Emperor.mp3` | 75.642 | 2 | 44100 | -10.2 | 0.1 | -0.0 | UAS | Evil Mind 'The Evil Emperor' 75.6 s, est 129 BPM. low-mid body (65% 150-1k); true peak +0.1 dBTP -> needs limiting. Tempo est 129.2 BPM, 1.81 onsets/s. |
|  | `F:/games/unity-assets/Florian Stracker__The Heros Path Free 16bit Adventure Game Music/Assets/TheHerosPath/The Hero's Path (Free 16bit Video Game Music)/OGG/06.2_LOOP_Battle_to_the_Blood_by_Florian_Stracker.ogg` | 112.075 | 2 | 44100 | -13.3 | 0.0 | -0.0 | UAS | Florian Stracker 16-bit 'Battle to the Blood' loop 112 s, est 172 BPM. broadband; true peak +0.0 dBTP -> needs limiting. Tempo est 172.3 BPM, 2.79 onsets/s. |
|  | `F:/games/unity-assets/Chris Kohler__8-Bit RPG Adventure Music Pack/Assets/8-Bit RPG Adventure Music Pack v1.1/Tracks WAV/03 Random Battle Encounter.wav` | 60.0 | 2 | 44100 | -10.0 | -0.3 | -0.5 | UAS | Chris Kohler 8-bit 'Random Battle Encounter' 60 s, est 161 BPM. broadband. Tempo est 161.5 BPM, 3.93 onsets/s. |
|  | `F:/games/forgeflow-games-assets/_downloaded/audio-cache/music/ec48a7db_jam_690198.mp3` | 224.877 | 2 | 44100 | -9.0 | 1.0 | -0.0 | CC-BY | Jamendo 'Electric Chronic' (Social Bot 73XT) 8-bit chiptune 225 s - CC BY 3.0 needs credit. sub/low-heavy (62% <150 Hz); true peak +1.0 dBTP -> needs limiting. Tempo est 80.7 BPM, 2.16 onsets/s. |

#### `music_boss` - need 1 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Update 1.5/Music/Face Your Doom (A Halloween Final Boss) - Metal.mp3` | 82.32 | 2 | 48000 | -13.9 | -0.0 | -0.1 | UAS | Evil Mind 'Face Your Doom (A Halloween Final Boss) - Metal' 82.3 s - labelled metal + boss. broadband; true peak -0.0 dBTP -> needs limiting. Tempo est 103.4 BPM, 2.44 onsets/s. |
|  | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/Update 1.5/Music/Face Your Doom (A Halloween Final Boss) - Orchestral.mp3` | 82.32 | 2 | 48000 | -14.7 | -2.4 | -2.5 | UAS | same cue, orchestral mix (phase-2 or intro). broadband. Tempo est 83.4 BPM, 2.9 onsets/s. |
|  | `F:/games/unity-assets/Corentin Guezenoc__8-bit Platformer Vertical Slice Kit/Assets/8-bit Platformer Music Pack/LOOP_4_Let's_Fight.wav` | 88.615 | 2 | 44100 | -13.9 | -1.0 | -1.0 | UAS | Corentin 8-bit 'Let's Fight! (Battle/Boss)' loop 88.6 s. sub/low-heavy (95% <150 Hz); PHONE-SPEAKER RISK: only 4% of energy in 150 Hz-4 kHz. Tempo est 86.1 BPM, 2.41 onsets/s. |

#### `music_results_jingle` - need 1 - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Chris Kohler__8-Bit RPG Adventure Music Pack/Assets/8-Bit RPG Adventure Music Pack v1.1/Tracks WAV/Jingles+SFX/01_Jingle_ Level Clear 1.wav` | 12.0 | 2 | 44100 | -9.2 | -0.5 | -0.5 | UAS | Chris Kohler 8-bit jingle 'Level Clear 1' 12 s. broadband. |
| * | `F:/games/unity-assets/Chris Kohler__8-Bit RPG Adventure Music Pack/Assets/8-Bit RPG Adventure Music Pack v1.1/Tracks WAV/Jingles+SFX/03_Jingle_ Game Over.wav` | 11.333 | 2 | 44100 | -8.9 | 0.1 | -0.5 | UAS | Chris Kohler 8-bit jingle 'Game Over' 11.3 s (loss screen). broadband; true peak +0.1 dBTP -> needs limiting; 420 ms lead-in -> trim. |
|  | `F:/games/forgeflow-games-assets/music/game_over.ogg` | 17.143 | 2 | 44100 | -19.6 | -8.2 | -8.3 | CC0-OGA | OGA CC0 game_over 17.1 s (not in 'used'). broadband. Tempo est 112.3 BPM, 4.26 onsets/s. |
|  | `F:/games/unity-assets/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle/Music/Team Celebration.mp3` `[0-9000 ms]` | 9.0 | 2 | 44100 | -12.4 | -0.1 | -0.1 | UAS | Evil Mind 'Team Celebration' 49.9 s - trim first 8-10 s for a win fanfare. broadband. Tempo est 123.0 BPM, 3.46 onsets/s. |

### Voice (optional - no announcer pack)

#### `voice_host_lines` - need optional - **PARTIAL**

> Gap / caveat: No announcer/host voice pack. Only the ringmaster PA line and generic RPG barks are usable.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Jake Fielding - Circus Ambiences/VOXFem_Accouncement Wet, Ringmaster, Performer, Dialogue_JF_Circus_01.wav` `[0-1750 ms]` | 1.75 | 2 | 48000 | -27.6 | -14.7 | -14.7 | SON | female ringmaster PA 'Ladies and gentlemen, boys and girls,' (slice; whisper words 0.00-1.62 s) - show open. broadband. |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/CriticalHit/Male_CriticalHit_03_Jamaal5.wav` | 0.915 | 1 | 96000 | -13.1 | 0.0 | 0.0 | UAS | 'CRITICAL HIT!' (whisper) - usable as host/hype shout. low-mid body (61% 150-1k); true peak +0.0 dBTP -> needs limiting. Transcript: "CRITICAL HIT!". |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Dark/CriticalHit/Male_CriticalHit_02_Jamaal4.wav` | 1.056 | 1 | 96000 | -13.7 | 0.0 | 0.0 | UAS | 'Critical Hit' (whisper) - darker read. broadband; true peak +0.0 dBTP -> needs limiting. Transcript: "Critical Hit". |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Edwyn/CriticalHit/Male_CriticalHit_03_Edwyn.wav` | 0.94 | 1 | 96000 | -13.6 | -1.0 | -1.0 | UAS | 'AWESOME!' (whisper) - hype shout. low-mid body (66% 150-1k). Transcript: "AWESOME!". |

#### `voice_fighter_barks` - need optional - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Patrick/Cocky/Male_BattleStart_01_Patrick2.wav` | 1.07 | 1 | 96000 | -13.7 | 0.0 | 0.0 | UAS | 'Let's do this!' (whisper). low-mid body (61% 150-1k); true peak +0.0 dBTP -> needs limiting. Transcript: "Let's do this!". |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Patrick/Cocky/Male_BattleWon_02_Patrick2.wav` | 1.521 | 1 | 96000 | -13.2 | 0.0 | -0.0 | UAS | 'That was too easy.' (whisper). broadband; true peak +0.0 dBTP -> needs limiting. Transcript: "That was too easy.". |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Patrick/Cocky/Male_CriticalHit_02_Patrick2.wav` | 1.334 | 1 | 96000 | -13.5 | -0.0 | -0.0 | UAS | '...right in the sweet spot!' (whisper). low-mid body (73% 150-1k); true peak -0.0 dBTP -> needs limiting. Transcript: "right in the sweet spot!". |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/BattleStart/Male_BattleStart_07_Jamaal5.wav` | 0.895 | 1 | 96000 | -11.5 | 0.0 | 0.0 | UAS | 'Here we go!' (whisper). low-mid body (64% 150-1k); true peak +0.0 dBTP -> needs limiting. Transcript: "Here we go!". |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/CriticalHit/Male_CriticalHit_02_Jamaal5.wav` | 0.87 | 1 | 96000 | -12.4 | 0.0 | 0.0 | UAS | 'Take this!' (whisper). broadband; true peak +0.0 dBTP -> needs limiting. Transcript: "Take this!". |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Edwyn/CriticalHit/Male_CriticalHit_01_Edwyn.wav` | 1.225 | 1 | 96000 | -14.2 | -1.0 | -1.0 | UAS | 'And stay down!' (whisper). mid-forward (54% 1-4k). Transcript: "And stay down!". |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/KarenK/CriticalHit/Female_CriticalHit_02_KarenK.wav` | 1.741 | 1 | 96000 | -18.7 | 0.0 | 0.0 | UAS | 'Boom, feel the sting.' (whisper) - female fighter. low-mid body (60% 150-1k); true peak +0.0 dBTP -> needs limiting. Transcript: "Boom, feel the sting.". |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Dark/BattleStart/Male_BattleStart_02_Jamaal4.wav` | 1.796 | 1 | 96000 | -14.4 | 0.0 | 0.0 | UAS | 'You are no match for me.' (whisper) - boss intro. broadband; true peak +0.0 dBTP -> needs limiting. Transcript: "You are no match for me.". |

#### `voice_efforts` - need optional - **COVERED**

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/AA_GenericBattleSounds/Male_Attack_01_Jamaal5.wav` | 0.173 | 1 | 96000 | -70.0 | 0.0 | 0.0 | UAS | male attack grunt. low-mid body (88% 150-1k); true peak +0.0 dBTP -> needs limiting. |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/AA_GenericBattleSounds/Male_Attack_02_Jamaal5.wav` | 0.474 | 1 | 96000 | -12.0 | 0.0 | 0.0 | UAS | male attack grunt. broadband; true peak +0.0 dBTP -> needs limiting. |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/AA_GenericBattleSounds/Male_Hurt_01_Jamaal5.wav` | 0.505 | 1 | 96000 | -14.8 | 0.0 | -0.0 | UAS | male hurt. low-mid body (71% 150-1k); true peak +0.0 dBTP -> needs limiting. |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/AA_GenericBattleSounds/Male_Hurt_02_Jamaal5.wav` | 0.468 | 1 | 96000 | -11.2 | -0.0 | -0.0 | UAS | male hurt. low-mid body (74% 150-1k); true peak -0.0 dBTP -> needs limiting. |
| * | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Stout/AA_GenericBattleSounds/Male_Death_01_Jamaal5.wav` | 1.07 | 1 | 96000 | -12.5 | 0.0 | 0.0 | UAS | male death (KO). low-mid body (61% 150-1k); true peak +0.0 dBTP -> needs limiting. |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Patrick/Cocky/GenericBattleSounds/Male_Attack_01_Patrick2.wav` | 0.22 | 1 | 96000 | -70.0 | 0.0 | 0.0 | UAS | second male voice attack. low-mid body (62% 150-1k); true peak +0.0 dBTP -> needs limiting. |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Patrick/Cocky/GenericBattleSounds/Male_Hurt_01_Patrick2.wav` | 0.543 | 1 | 96000 | -13.6 | -0.0 | -0.0 | UAS | second male voice hurt. mid-forward (53% 1-4k); true peak -0.0 dBTP -> needs limiting. |
|  | `F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files/Jamaal/Dark/Rage/Male_Rage_01_Jamaal4.wav` | 2.974 | 1 | 96000 | -12.0 | 0.0 | 0.0 | UAS | 'AHHHH' rage roar 3 s (whisper) - finisher/special. mid-forward (58% 1-4k); true peak +0.0 dBTP -> needs limiting. Transcript: "AHHHHHHHHH". |

### Crowd

#### `crowd_cheer_loop` - need 1-2 loops - **PARTIAL**

> Gap / caveat: Real sports-hall spectators and a protest crowd, not a TV studio audience; 'cheer' energy unverified by ear. Windows chosen by measured steadiness (crowd_scan.json beds).

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Handball Match Ambience/SBhma_Feminine EHF European Cup Match 002.wav` `[108000-128000 ms]` | 20.0 | 2 | 96000 | -22.2 | -10.1 | -10.1 | SON | Sonic Bat handball (EHF cup) spectators, 20 s window: 500 ms-RMS spread 4.4 dB, seam step 0.7 dB, level -23.0 dBFS. low-mid body (81% 150-1k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Roller Hockey Match Ambience/SBrhma_Feminine League Match 004.wav` `[2000-22000 ms]` | 20.0 | 2 | 96000 | -31.4 | -12.3 | -12.3 | SON | Sonic Bat roller-hockey spectators, 20 s: spread 2.9 dB, seam 0.2 dB, flatness 0.197 (noise-like crowd). low-mid body (69% 150-1k); quiet source (-31.4 LUFS) -> needs gain. |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/TheWorkRoom Audio Post - South African Ambiences - Protests/SAPST01.wav` `[20000-40000 ms]` | 20.0 | 2 | 48000 | -14.4 | -3.0 | -3.0 | SON | TheWorkRoom protest crowd (chanting), 20 s: spread 2.5 dB, seam 0.3 dB, level -14.2 dBFS - dense rowdy layer for high ratings. low-mid body (77% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sculptunes - Rome - Urban City Surround/AMBRest_Rome_Indoor-PubCrowd-InteriorCrowd.wav` `[110000-130000 ms]` | 20.0 | 5 | 96000 | -18.0 | -2.6 | -2.6 | SON | Sculptunes Rome indoor pub crowd, 20 s: spread 2.6 dB, seam 1.5 dB - murmur bed for low ratings. low-mid body (77% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Basketball Match Ambience/SBbma_Masculine U-18 Match 004.wav` `[378000-398000 ms]` | 20.0 | 2 | 96000 | -22.1 | -5.2 | -5.2 | SON | Sonic Bat basketball U-18 spectators, 20 s: spread 8.1 dB (lively), seam 1.4 dB. low-mid body (80% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Roller Hockey Match Ambience/SBrhma_Masculine League Match 007.wav` `[102000-122000 ms]` | 20.0 | 2 | 96000 | -27.3 | -0.1 | -0.1 | SON | Sonic Bat roller-hockey spectators, 20 s: spread 5.3 dB, seam 1.4 dB. low-mid body (70% 150-1k). |

#### `crowd_cheer_burst` - need 2+ - **PARTIAL**

> Gap / caveat: Burst windows are the measured loudest moments of spectator recordings - could be cheers, whistles, horns or ball impacts; audition before lock.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Handball Match Ambience/SBhma_Masculine League Match 002.wav` `[459500-464500 ms]` | 5.0 | 2 | 96000 | -13.2 | -0.0 | -0.1 | SON | handball (men) loudest 3 s window +20.7 dB over file median (window widened for decay). low-mid body (87% 150-1k); true peak -0.0 dBTP -> needs limiting. |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Basketball Match Ambience/SBbma_Feminine League Match 010.wav` `[152000-157000 ms]` | 5.0 | 2 | 96000 | -13.1 | -0.5 | -0.5 | SON | basketball (women) +18.4 dB over median. low-mid body (93% 150-1k). |
| * | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Basketball Match Ambience/SBbma_Masculine U-18 Match 004.wav` `[214500-219500 ms]` | 5.0 | 2 | 96000 | -15.2 | -1.2 | -1.2 | SON | basketball U-18 +15.9 dB over median. low-mid body (80% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Handball Match Ambience/SBhma_Masculine League Match 002.wav` `[249500-254500 ms]` | 5.0 | 2 | 96000 | -15.0 | -1.9 | -1.9 | SON | handball (men) +19.9 dB; flatness 0.013 = tonal content (whistle/horn?) - audition. low-mid body (94% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Roller Hockey Match Ambience/SBrhma_Feminine League Match 004.wav` `[439000-444000 ms]` | 5.0 | 2 | 96000 | -18.9 | -1.8 | -1.8 | SON | roller hockey +16.2 dB over median. low-mid body (90% 150-1k). |
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/Sonic Bat - Futsal Match Ambience/SBfma_Feminine League Match 004.wav` `[139000-144000 ms]` | 5.0 | 2 | 96000 | -18.8 | 0.0 | -0.1 | SON | futsal +15.2 dB over median, flatness 0.094. low-mid body (62% 150-1k); true peak +0.0 dBTP -> needs limiting. |

#### `crowd_boo` - need 1+ - **GAP**

> Gap / caveat: No booing crowd anywhere in scope.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/TheWorkRoom Audio Post - South African Ambiences - Protests/SAPST01.wav` `[195000-200000 ms]` | 5.0 | 2 | 48000 | -11.5 | -3.0 | -3.0 | SON | protest crowd loudest window (+6.0 dB) - hostile chant, NOT a boo. low-mid body (71% 150-1k). |

#### `crowd_gasp_ooh` - need 1+ - **GAP**

> Gap / caveat: No crowd 'ooh'/gasp. Stacking the single gasp with pitch variants is a weak stand-in.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
|  | `F:/games/forgeflow-games-assets/sonniss-gdc2024/UberDuo - Inhale – Owen – Character Playset/HMNBrth_Human, Adult, Male, Breath, Surprise, Gasp_UberDuo_INHL_17.wav` `[150-700 ms]` | 0.55 | 2 | 96000 | -18.7 | -6.4 | -6.4 | SON | UberDuo single male surprise gasp (slice) - one voice, not a crowd. broadband. |

#### `crowd_applause` - need 1+ - **GAP**

> Gap / caveat: No applause recording found by name in any source; sports-hall beds may contain clapping but unverified.

_No candidate in the listed sources._

#### `crowd_laugh` - need 1+ - **GAP**

> Gap / caveat: No audience/sitcom laugh. Only single-character villain laughs.

| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |
|---|---|---|---|---|---|---|---|---|---|
|  | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/FX/Evil Laughter 2.mp3` | 4.356 | 2 | 44100 | -21.8 | -3.9 | -3.9 | UAS | Evil Mind evil laughter - single villain laugh (host/boss), not an audience. low-mid body (81% 150-1k); 70 ms lead-in -> trim. |
|  | `F:/games/unity-assets/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit/FX/Wicht Laughter 1.mp3` | 3.234 | 2 | 44100 | -19.9 | -7.9 | -8.0 | UAS | Evil Mind 'Wicht' (witch) laughter - single cackle. mid-forward (89% 1-4k). |

## Size budget and transcode plan (measured)

Every `*` pick was actually encoded with ffmpeg (libopus in .ogg, metadata stripped; and AAC-LC .m4a as a fallback set), the bytes were measured, and the files were deleted. Slices were cut with `-ss/-to` in the same pass.

| profile | encoder settings | files | Opus bytes | AAC bytes |
|---|---|---|---|---|
| sfx_mono | Opus mono 48 kHz 48 kbps VBR | 82 | 477450 | 665444 |
| sfx_stereo | Opus stereo 48 kHz 64 kbps VBR | 5 | 160721 | 243635 |
| bed_stereo | Opus stereo 48 kHz 64 kbps VBR | 2 | 315694 | 489678 |
| jingle | Opus stereo 48 kHz 96 kbps VBR | 9 | 561649 | 661455 |
| music | Opus stereo 48 kHz 80 kbps VBR | 7 | 5125992 | 6842506 |
| **total** | | **105** | **6641506 (6.64 MB)** | **8902718 (8.90 MB)** |

| group | files | Opus bytes | AAC bytes |
|---|---|---|---|
| combat | 57 | 303013 | 457475 |
| show | 14 | 330935 | 409557 |
| ui | 8 | 22527 | 34347 |
| music | 9 | 5468032 | 7221809 |
| voice | 12 | 72306 | 104743 |
| crowd | 5 | 444693 | 674787 |

- Target ~12,000,000 B. Opus set = 6641506 B -> **headroom 5358494 B**. Adding every measured out-of-scope lead below = 8361427 B total.
- Music is the budget: 5468032 of 6641506 Opus bytes. Plan: keep stage/boss cues as 50-90 s seamless loops (the picks are 57-82 s), Opus 80 kbps stereo; do not ship full-length versions.
- SFX: mono Opus 48 kbps. A single-file sprite of all 82 mono SFX measured 553072 B vs 477450 B as individual files - **no byte saving**; use a sprite only if request count matters.
- Crowd beds: 20 s stereo loops at 64 kbps; the Rome pub crowd source is 5-channel and must be downmixed to stereo.
- Browser support: I did not verify Ogg-Opus decode on iOS Safari this session. Ship the AAC `.m4a` twin set (8.90 MB measured) and pick per device with `audio.canPlayType('audio/ogg; codecs=opus')` / a `decodeAudioData` probe; only one set downloads per device.

### Mastering notes that fall out of the measurements

- **Phone-speaker risk:** 26 candidates (flagged `PHONE-SPEAKER RISK` above) have under 20% of their energy between 150 Hz and 4 kHz - e.g. the Kenney `impactSoft_heavy` kick/body thuds, the Rogue Waves door slams (wall slam) and the JSE flesh-drop body falls. On phone speakers they will nearly vanish. Layer each with a mid transient (punch/cardboard/stone crack) and high-pass at ~40 Hz.
- **Trim lead-ins:** the Evil Mind MP3 picks carry 70-230 ms of leading silence (flagged per file) - trim or the hit lands late against the animation.
- **Limit overs:** several sources read at or above 0 dBTP (flagged per file; Evil Mind music, Daniel Gooding voices, some Kenney RPG foley). Normalise to -1 dBTP after resampling to 48 kHz.
- **Quiet sources:** the four JSE bone-break slices read -29.8 to -32.4 LUFS and need roughly 14-16 dB of gain to sit near -16 LUFS; the Sonic Bat roller-hockey bed reads -31.4 LUFS.
- Suggested playback targets (to keep the mix consistent, not measured requirements): combat hits ~-16 LUFS short-term, UI ~-22, crowd beds ~-28 under gameplay, music ~-20 so hits stay on top.

## Gaps (plain list)

Absence check: a filename search over all 25,348 paths in the listed sources (`_all_inscope_audio_names.txt`; patterns boo/bhoo, applau/clap, laugh, ooh/gasp/aww, drum/snare, rimshot, air horn, buzzer, cash/register/cha-ching, cheer, announc) found **no** crowd boo, applause, cheer, drum roll, rimshot, air horn, buzzer or cash register audio; only single-voice laughs (Evil Mind x5, Daniel Gooding x1), one single-voice gasp, and one drumstick recording (spade hits).

- **kick** (partial): No file named/foleyed as a kick in any source. Build kick = sub thump + punch_heavy layer + whoosh_light pre-roll.
- **slap** (partial): No recorded skin slap in any source. Stand-ins are hand pop / light taps; a real slap needs a recording (or layer hand-pop + light tap).
- **air_horn** (partial): No stadium/party air horn recording. A bus horn is the nearest in pitch/brass; a true air-horn blast is a gap.
- **drum_roll** (gap): No drum roll in the listed sources: a filename search for drum/snare found only this drumstick-on-spade recording (single hits). Needs a sourced or synthesised roll.
- **rimshot** (gap): No rimshot / 'ba-dum-tss' in scope. Proxies only.
- **cash_register** (partial): No cash-register 'ka-ching' recording. Build = lever ka-chunk + coin jingle + bell_ding.
- **jingle_sting** (partial): Chiptune/fantasy flavoured stings dominate; only the overdriven guitar scrapes are rock. No TV-show brass/band stings.
- **commercial_break_sting** (partial): No purpose-made 'we'll be right back' TV sting; proposal is a lo-tech tape one-shot + the ringmaster interval line.
- **music_menu** (partial): Nothing labelled rock/funk/synth for a menu; genre fit unverified (cannot listen).
- **music_stage** (partial): Brief asks gritty rock / metal / synth-punk / funk. In scope only 'Halloween Rocks' is labelled rock; the rest are Halloween/fantasy/chiptune by label. Unused Travis Rise synthwave (outside listed sources) is the nearest synth fit.
- **voice_host_lines** (partial): No announcer/host voice pack. Only the ringmaster PA line and generic RPG barks are usable.
- **crowd_cheer_loop** (partial): Real sports-hall spectators and a protest crowd, not a TV studio audience; 'cheer' energy unverified by ear. Windows chosen by measured steadiness (crowd_scan.json beds).
- **crowd_cheer_burst** (partial): Burst windows are the measured loudest moments of spectator recordings - could be cheers, whistles, horns or ball impacts; audition before lock.
- **crowd_boo** (gap): No booing crowd anywhere in scope.
- **crowd_gasp_ooh** (gap): No crowd 'ooh'/gasp. Stacking the single gasp with pitch variants is a weak stand-in.
- **crowd_applause** (gap): No applause recording found by name in any source; sports-hall beds may contain clapping but unverified.
- **crowd_laugh** (gap): No audience/sitcom laugh. Only single-character villain laughs.

## Voice lines found (no announcer pack)

- `F:/games/forgeflow-games-assets/sonniss-gdc2024/Jake Fielding - Circus Ambiences/VOXFem_Accouncement Wet, Ringmaster, Performer, Dialogue_JF_Circus_01.wav` - 19.4 s female ringmaster PA. Whisper transcript opens "Ladies and gentlemen, boys and girls, there will now be a 20 minute interval." then a concession-stand spiel. Word timestamps: 'Ladies ... girls,' 0.00-1.62 s; 'there will now be a 20 minute interval.' 1.84-4.06 s. Reverberant ('Wet') and quiet (slice -27.6 LUFS).
- Daniel Gooding *Action RPG Characters* (unity-assets, UAS): 10 actors, 3948 files of barks and efforts. Usable generic lines (whisper): 'Let's do this!', 'That was too easy.', '...right in the sweet spot!', 'Here we go!', 'Take this!', 'CRITICAL HIT!', 'AWESOME!', 'And stay down!', 'You are no match for me.', 'Boom, feel the sting.' Many other lines are RPG-specific (spells, treasure, dungeons) and do not fit.
- Sonniss CB Sounddesign sci-fi voices (robot/computer reads: 'Access denied', 'Target acquired. Engaging stealth mode.', ...) - wrong register for a TV host.
- Cyberleaf *One Hundred* is sold as a speech version; whisper returned only 'Music' tokens, so no speech content was recovered.
- Evil Mind 'Voice Approve' files are 'Mm-hmm'/'Hm' grunts; 'Trick or Treat' is off-theme.

## Out-of-scope leads (measured, owner's call)

These are **not** in the listed sources. They sit as un-extracted `.unitypackage` files in `F:/games/unity-asset-cache`. I extracted selected files to the session scratchpad only (outside the repo), measured them, and wrote nothing to the asset library. Using them means extracting the packages into `F:/games/unity-assets` first.

| fills role | file | package | dur s | ch | Hz | LUFS-I | TP | trial Opus B |
|---|---|---|---|---|---|---|---|---|
| crowd_boo | `AUDIENCE_Bhoos_01_stereo.wav` | Imphenzia / Universal Sound FX | 2.334 | 2 | 44100 | -11.8 | -0.5 | 20160 |
| crowd_boo | `AUDIENCE_Bhoos_04_stereo.wav` | Imphenzia / Universal Sound FX | 5.099 | 2 | 44100 | -12.0 | -0.5 | 40974 |
| crowd_boo | `AUDIENCE_Bhoos_06_Short_stereo.wav` | Imphenzia / Universal Sound FX | 1.539 | 2 | 44100 | -10.6 | -0.5 | 13464 |
| crowd_boo | `AUDIENCE_Claps_and_Bhoos_01_stereo.wav` | Imphenzia / Universal Sound FX | 2.916 | 2 | 44100 | -15.8 | -0.5 | 27570 |
| crowd_applause | `AUDIENCE_Clapping_Hall_03_stereo.wav` | Imphenzia / Universal Sound FX | 4.007 | 2 | 44100 | -14.6 | -0.6 | 35348 |
| crowd_applause | `AUDIENCE_Clapping_Hall_06_loop_stereo.wav` | Imphenzia / Universal Sound FX | 2.119 | 2 | 44100 | -12.9 | -0.6 | 18911 |
| crowd_applause | `AUDIENCE_Claps_Multi_02_stereo.wav` | Imphenzia / Universal Sound FX | 0.435 | 2 | 44100 | -13.4 | -0.4 | 4487 |
| crowd_cheer_burst | `AUDIENCE_Claps_and_Cheers_05_stereo.wav` | Imphenzia / Universal Sound FX | 3.552 | 2 | 44100 | -8.0 | -0.5 | 38390 |
| crowd_cheer_burst | `AUDIENCE_Claps_and_Cheers_07_stereo.wav` | Imphenzia / Universal Sound FX | 3.323 | 2 | 44100 | -9.5 | -0.5 | 37814 |
| crowd_cheer_burst | `AUDIENCE_Claps_and_Cheers_13_stereo.wav` | Imphenzia / Universal Sound FX | 2.92 | 2 | 44100 | -8.3 | -0.5 | 33440 |
| crowd_cheer_loop | `CROWD_Cheer_On_01_mono_loop.wav` | Imphenzia / Universal Sound FX | 8.018 | 1 | 44100 | -17.2 | -0.9 | 54132 |
| crowd_cheer_loop | `AUDIENCE_Stomp_Stomp_Clap_loop_stereo.wav` | Imphenzia / Universal Sound FX | 1.424 | 2 | 44100 | -14.9 | -0.5 | 12009 |
| crowd_cheer_loop | `AUDIENCE_Claps_and_Stomp_Loop_01_stereo.wav` | Imphenzia / Universal Sound FX | 2.396 | 2 | 44100 | -13.1 | -0.4 | 26509 |
| crowd_gasp_ooh | `AUDIENCE_Ohh_01_stereo.wav` | Imphenzia / Universal Sound FX | 3.357 | 2 | 44100 | -12.0 | -0.5 | 26459 |
| crowd_gasp_ooh | `AUDIENCE_Ouch_Claps_stereo.wav` | Imphenzia / Universal Sound FX | 2.382 | 2 | 44100 | -20.0 | -0.4 | 24112 |
| crowd_laugh | `AUDIENCE_Hahaha_02_stereo.wav` | Imphenzia / Universal Sound FX | 2.397 | 2 | 44100 | -10.6 | -0.5 | 21105 |
| crowd_laugh | `AUDIENCE_Hahaha_03_stereo.wav` | Imphenzia / Universal Sound FX | 1.626 | 2 | 44100 | -10.2 | -0.5 | 13880 |
| crowd_laugh | `AUDIENCE_Claps_Laugh_Increase_01_stereo.wav` | Imphenzia / Universal Sound FX | 5.402 | 2 | 44100 | -17.5 | -0.5 | 55445 |
| cash_register | `CASH_REGISTER_Cha-ching_02_mono.wav` | Imphenzia / Universal Sound FX | 1.473 | 1 | 44100 | -20.6 | -0.9 | 9877 |
| cash_register | `CASH_REGISTER_Cha-ching_05_mono.wav` | Imphenzia / Universal Sound FX | 0.711 | 1 | 44100 | -19.3 | -1.0 | 4604 |
| bell_ding | `BOXING_Bell_3_Rings_02_mono.wav` | Imphenzia / Universal Sound FX | 1.01 | 1 | 44100 | -11.1 | -0.4 | 8920 |
| bell_ding | `BOXING_Bell_Ring_01_mono.wav` | Imphenzia / Universal Sound FX | 2.026 | 1 | 44100 | -14.9 | -1.0 | 16223 |
| punch_light | `BOXING_Jab_03_mono.wav` | Imphenzia / Universal Sound FX | 0.355 | 1 | 44100 | -70.0 | -1.0 | 2067 |
| punch_light | `BOXING_Jab_05_mono.wav` | Imphenzia / Universal Sound FX | 0.181 | 1 | 44100 | -70.0 | -2.1 | 1221 |
| punch_light | `BOXING_Jab_06_mono.wav` | Imphenzia / Universal Sound FX | 0.201 | 1 | 44100 | -70.0 | -1.5 | 1314 |
| punch_heavy | `BOXING_Punch_02_mono.wav` | Imphenzia / Universal Sound FX | 0.595 | 1 | 44100 | -22.4 | -1.1 | 3495 |
| punch_heavy | `BOXING_Punch_06_mono.wav` | Imphenzia / Universal Sound FX | 0.798 | 1 | 44100 | -20.1 | -0.7 | 4169 |
| punch_heavy | `BOXING_Punch_10_mono.wav` | Imphenzia / Universal Sound FX | 0.469 | 1 | 44100 | -18.9 | -0.9 | 2790 |
| voice_announcer | `VOICE_MALE_Get_Ready_1_Aggressive_mono.wav` | Imphenzia / Universal Sound FX | 1.112 | 1 | 44100 | -9.6 | -0.4 | 8259 |
| voice_announcer | `VOICE_MALE_Fight_3_Aggressive_mono.wav` | Imphenzia / Universal Sound FX | 0.622 | 1 | 44100 | -11.8 | -0.4 | 4068 |
| voice_announcer | `VOICE_MALE_Combo_Triple_mono.wav` | Imphenzia / Universal Sound FX | 1.085 | 1 | 44100 | -11.2 | -0.5 | 6930 |
| voice_announcer | `VOICE_MALE_Combo_Mega_mono.wav` | Imphenzia / Universal Sound FX | 1.505 | 1 | 44100 | -8.7 | -0.4 | 11037 |
| voice_announcer | `VOICE_MALE_Combo_Monster_Aggressive_mono.wav` | Imphenzia / Universal Sound FX | 2.102 | 1 | 44100 | -8.8 | 0.1 | 14622 |
| voice_announcer | `VOICE_MALE_Time's_Up_1_mono.wav` | Imphenzia / Universal Sound FX | 0.748 | 1 | 44100 | -12.8 | -0.4 | 4757 |
| voice_announcer | `VOICE_MALE_Victory_2_Aggressive_mono.wav` | Imphenzia / Universal Sound FX | 1.027 | 1 | 44100 | -10.3 | -0.4 | 7800 |
| voice_announcer | `VOICE_MALE_Game_Over_2_Aggressive_mono.wav` | Imphenzia / Universal Sound FX | 1.262 | 1 | 44100 | -8.2 | -0.4 | 10185 |
| music_stage | `02_TR_Outbreak_LOOP_01.wav` | Travis Rise / SynthWave Music Pack 2 | 19.2 | 2 | 44100 | -8.8 | -0.7 | 197578 |
| music_stage | `03_TR_Disorder_LOOP_01.wav` | Travis Rise / SynthWave Music Pack 2 | 19.2 | 2 | 44100 | -7.9 | -0.3 | 208775 |
| music_stage | `04_TR_Anxiety_LOOP_01.wav` | Travis Rise / SynthWave Music Pack 2 | 19.2 | 2 | 44100 | -7.7 | -0.3 | 211001 |
| music_stage | `05_TR_Chasm_LOOP_01.wav` | Travis Rise / SynthWave Music Pack 2 | 19.199 | 2 | 44100 | -9.3 | -0.3 | 189289 |
| music_stage | `WAV_TR_07_RETROWAVE_LOOP_01.wav` | Travis Rise / SynthWave Music Pack | 19.2 | 2 | 44100 | -10.1 | 0.4 | 196948 |
| music_stage | `04_TR_ElectricPhase_LOOP_01.wav` | Travis Rise / SynthWave Music Pack | 8.727 | 2 | 44100 | -10.3 | 0.2 | 89783 |

- Imphenzia listing (10,101 audio assets): `_oos_imphenzia_usfx.txt`. Travis Rise listings: `_oos_travisrise_pack1.txt`, `_oos_travisrise_pack2.txt`. Travis Rise tracks 01/02/05/06 of pack 1 are already 'used' (dyefield) and are excluded.
- Still missing even with these: drum roll, rimshot, air horn (true), buzzer by name, funk / gritty rock music, TV-show brass stings.
- Also off-disk: the Sonniss xlsx sheet 'Sheet1' lists 1127 files of another bundle part (e.g. 'Fight Vocalizations', 'PM_FN_Fight_Hits', 'Kieuk laughter', 'Battle Crowd Add on') - none are on disk; exported to `sonniss_xlsx_Sheet1.csv`.

## Method and files

- Scripts (ASCII, under `tools/research/`): `audio_build_pathlist.py`, `audio_measure.py`, `audio_takes.py`, `audio_crowd_scan.py`, `audio_tempo.py`, `audio_transcribe.py`, `audio_words.py`, `audio_kit_build.py`, `audio_trial_transcode.py`, `audio_kit_finalize.py`, `audio_kit_report.py`, `unitypackage_list_audio.py`, `unitypackage_extract_selected.py`.
- Data (this folder): `_measure.jsonl` (per-file measurements), `takes.json` (multi-take segmentation; its per-take spectrum stats use one long window and are biased - the kit uses re-measured slices instead), `crowd_scan.json` (burst/bed windows on long crowd files), `music_tempo.json`, `voice_transcripts.json`, `trial_transcode_sizes.json`, `_measure_oos.jsonl`, `music_tempo_oos.json`, Sonniss xlsx exports.
- Rebuild: `python tools/research/audio_kit_build.py <this dir>` -> `audio_trial_transcode.py <kit> <scratch> trial_transcode_sizes.json --aac` -> `audio_kit_finalize.py <this dir> <scratch>` -> `audio_kit_report.py <this dir>`.
- Music exclusion check against `state/music_assignments.json` 'used' (10 keys): 0 violations.

