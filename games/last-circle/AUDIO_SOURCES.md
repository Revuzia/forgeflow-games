# Last Circle — Audio Sourcing Shortlist

**Verification pass done this session:** I re-fetched 16 source pages myself rather than trusting the six hunts. Every row marked **✅ re-verified** below was read on its own page in this session. Rows marked **⚠️ hunt-only** were verified by a hunt but *not* by me — treat those as one-step-weaker evidence. Two claims from the hunts turned out to need correction; both are called out in §5.

---

## 1. RECOMMENDED SET

The smallest commercially-safe set. **Everything here is CC0** — no attribution obligation, no credits-screen maintenance, nothing to track at ship time. I deliberately did *not* put the best-sounding option (SnakeF8) in the recommended set; reasoning in §5.

### A) Weapon reports — 6/6 covered

| Slot | Asset | URL | Licence | Attribution | Size / format |
|---|---|---|---|---|---|
| **All 5 conventional slots** (pistol, SMG, AR, shotgun, sniper) | The Free Firearm Sound Library — cherry-pick 5 files via the GitHub mirror | Licence authority: https://opengameart.org/content/the-free-firearm-sound-library · Files: https://github.com/buddingmonkey/FreeFirearmsSFXLibrary | **CC0** ✅ re-verified. OGA `License(s)` field reads `"CC0"`. Mirror's LICENSE file ✅ re-verified as genuine CC0 1.0 Universal legal code ("Creative Commons Legal Code / CC0 1.0 Universal") | **None.** OGA's Attribution Instructions field says *"These sounds were created and recorded by Ben Jaszczak, Brian Nelson, Kevin Heras, and Matthew Nanney"* — that is a courtesy note, not a licence condition, because CC0 has no attribution clause | Full archive 194 MB (**don't**). Individual WAVs 2.7–17.2 MB at 192 kHz/24-bit — pull 5 files only |
| **Grenade launcher (launch report)** | LeMudCrab — "Grenade Launcher" (M203/M320) | https://freesound.org/people/LeMudCrab/sounds/163458/ | **CC0** ✅ re-verified: *"You can copy, modify, distribute and perform the sound, even for commercial purposes, all without the need of asking permission"* | None | **0.435 s, 37.6 KB, WAV 44.1 kHz/16-bit, MONO** — ships essentially as-is |
| Grenade launcher — 2nd take / variation | qubodup — "M203 Grenade Launcher 1.flac" | https://freesound.org/people/qubodup/sounds/162402/ | **CC0** ✅ re-verified | None | 0.527 s, 57.8 KB, FLAC 44.1 kHz/24-bit, stereo |
| Grenade **detonation** (separate engine event) | Kenney — Sci-fi Sounds → `explosionCrunch_000-004` + `lowFrequency_explosion_000-001` | https://kenney.nl/assets/sci-fi-sounds | **CC0** ✅ re-verified (page License field reads "Creative Commons CC0"). ⚠️ My fetch could *not* re-confirm the "credit appreciated but not required" readme line — that quote is hunt-only | None (CC0) | ~290 KB for all 7, already `.ogg` |

**Weapon-slot mapping inside the Free Firearm Library** (folder names ✅ confirmed by a hunt via the GitHub contents API; I did not re-enumerate them):
pistol → `1911` or `Walther PPQ` · SMG → `Carl Gustav M45_Swedish K` or `PPSh` · assault rifle → `AK-47` or `AR-15` · shotgun → `Mossberg` or `Model 12` · sniper → `Mosin Nagant`, `Tikka` or `Savage 10 .300 Blackout`. **No grenade launcher** in this library — that is why the LeMudCrab file is in the set.

**⚠️ Unresolved: which tree is the dry one.** The two hunts disagree and I did not adjudicate it with my own fetch:
- Hunt A: pull from **`Master Tracks`** — README says they are *"our unprocessed tracks"*, i.e. the raw ones.
- Hunt B: pull from **`Prepared SFX`** and grep `Prepared Master Sheet.csv` for `"near distance"` in the Description column (columns: `Filename,CD,Track,Index,Duration,Description`).

Both point at the same goal. **Do this at download time:** open the CSV, filter for `near distance`, and A/B one Master Track against one "near distance" Prepared file. Whichever has less tail wins. This is a 10-minute check, not a blocker.

**Dedicated fallbacks if a Free-Firearm slot doesn't cut** (all CC0, all ✅ re-verified this session):

| Slot | Asset | URL | Detail |
|---|---|---|---|
| Pistol | johanwestling — `gun_.22mm_7.5mm_9mm_close_single_shots_m10.wav` | https://freesound.org/people/johanwestling/sounds/377786/ | 2:12.522, 37.0 MB, WAV 48 kHz/24-bit stereo. Many discrete close-range single shots from 9mm/7.5mm/.22. Not in a pack — licence is this file's own. Needs slicing |
| Pistol (alt) | Nox_Sound — `Weapon_Revolver_Shots_Stereo.wav` | https://freesound.org/people/Nox_Sound/sounds/541818/ | 7.025 s, 1.9 MB, 48 kHz/24-bit stereo. *"Revolver Gun Shots - 2m // Short Reverb Concrete Wall - (x7)"* — 7 takes = free round-robin. Fold to mono |
| Shotgun | TheGreenEyedGhost — SPAS-12, 4 cartridge loads | https://freesound.org/people/TheGreenEyedGhost/sounds/707794/ | 5.396 s, 1.5 MB, 48 kHz/24-bit **stereo** (the hunt said mono — corrected). Nr7/Nr5/AAA/LG loads in sequence, Zoom H6 + Rode NTG5, Waterval range |

### B) Vocals — 3 of 4 covered cleanly

| Need | Asset | URL | Licence | Attribution | Size |
|---|---|---|---|---|---|
| **Male hurt + jump exhale** | qubodup — 15 vocal male strain/hurt/pain/jump | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | **CC0** ✅ re-verified (relicensed to CC0 as of 2024-08-30) | None — Attribution Instructions field literally reads `[optional] qubodup` | `slightscreams.7z`, 1.4 MB, 15 clips |
| **Male hurt (pre-sliced, best quality)** | MrFossy — Voice: Male Grunts and Screams | https://freesound.org/people/MrFossy/packs/30826/ | **CC0** ✅ re-verified on file 547198 | None | 12 WAVs, already ~0.3 s one-shots (547198 = 0.285 s / 50.0 KB). **No editing needed** |
| **Male death** | thebardofblasphemy — grunts of male death and pain | https://opengameart.org/content/grunts-male-death-and-pain | **CC0** ✅ re-verified; author adds *"You have my blessing to do whatever you want with this sound file"* | None | 4.4 MB single WAV, several takes — needs slicing |
| **Male effort / yells** | Potapooo — Grunts and Yells. Character. Man | https://freesound.org/people/Potapooo/packs/39934/ | **CC0** ✅ re-verified on file 714591 | None | 28 WAVs, filename-categorised (`A_Character_Effort01-09`, `A_Character_Yell01-11`) |
| **Female hurt** | Nocturnal_Vanguard — Female Hurt Grunts & Groans | https://opengameart.org/content/female-hurt-grunts-groans | **CC0** ✅ re-verified; author: *"Whatever SFX I post here, use however you like! No credit required."* | None | `female_hurt_grunts_groans_1.ogg`, 188.8 KB — already .ogg, needs splitting |
| **Female damage (2nd voice)** | mvVoiceActing — girl damage | https://freesound.org/people/mvVoiceActing/sounds/855460/ | **CC0** ✅ re-verified | None | 9.322 s, 146.5 KB, MP3 stereo |
| **Female short grunt (jump)** | Reitanna — `grunt.wav` (+1,146-clip CC0 library) | https://freesound.org/people/Reitanna/sounds/242623/ | **CC0** ✅ re-verified | None | 0.406 s, 35.6 KB, WAV 44.1 kHz **mono** |

**→ See §4 for the one vocal gap: female death vocalisation.**

### C) Ambience (nice-to-have)

| Bed | Asset | URL | Licence | Size |
|---|---|---|---|---|
| **Shoreline** | kkenny101 — Gentle Ocean Waves Loop | https://freesound.org/people/kkenny101/sounds/852826/ | **CC0** ✅ re-verified | 21.769 s, 3.0 MB, WAV 48 kHz/24-bit **MONO**, author states *"A seamless loop"*. → ~150–250 KB as 64–96 kbps Ogg |
| **Forest wind** | BigSoundBank — "Wind in the Trees" (Rambouillet) | https://bigsoundbank.com/forest-wind-in-the-trees-s0904.html | **CC0** ✅ re-verified: *"CC0 (public domain): Free and royalty-free"* | 3:38, **OGG 6.4 MB** (no conversion needed), 48 kHz/16-bit stereo. Optional courtesy credit only |
| Wind texture | kkenny101 — Looping Wind & Noise | https://freesound.org/people/kkenny101/sounds/852845/ | CC0 ⚠️ hunt-only | 34.794 s, 3.2 MB, 48 kHz mono. Synthesised from filtered noise → loops perfectly, no bird/traffic events |
| Forest (pack route) | Nox_Sound — Pack: Ambiances | https://freesound.org/people/Nox_Sound/packs/26791/ | CC0 ⚠️ hunt-only (2 of 252 files checked) | 41 sounds, author-trimmed loops. 96 kHz/24-bit — **must downsample to 44.1 kHz before Ogg encode** |

### Budget check
6 weapon slots × 3–4 variants, trimmed to 0.3–0.9 s, mono, 44.1 kHz, ~96 kbps Ogg ≈ **4–11 KB per file, ~150–250 KB total**. *(Inferred from the verified source durations, not measured.)* Comfortably inside the 1.5 MB ceiling with room for reload foley and vocals.

---

## 2. LICENCE LEDGER

Legend — **Verified?** ✅ = I read the licence on the source page **this session**. 🟡 = a hunt read it on-page, I did not re-check. ❌ = nobody established it.

### Weapons

| Source | Licence | Verified? | Commercial OK? | Attribution |
|---|---|---|---|---|
| Free Firearm Sound Library (OGA) | CC0 | ✅ | **Yes** | None |
| Free Firearm SFX Library (GitHub mirror LICENSE) | CC0 1.0 Universal | ✅ | **Yes** | None |
| LeMudCrab GL /sounds/163458/ | CC0 | ✅ | **Yes** | None |
| qubodup M203 /sounds/162402/ | CC0 | ✅ | **Yes** | None |
| johanwestling /sounds/377786/ | CC0 | ✅ | **Yes** | None |
| Nox_Sound revolver /sounds/541818/ | CC0 | ✅ | **Yes** | None |
| TheGreenEyedGhost SPAS-12 /sounds/707794/ | CC0 | ✅ | **Yes** | None |
| Kenney Sci-fi Sounds | CC0 | ✅ (label) | **Yes** | None |
| qubodup M16 /sounds/187677/ | CC0 | 🟡 | Yes | None |
| qubodup Mk19 /sounds/182792/ | CC0 | 🟡 | Yes | None |
| qubodup M2010 sniper /sounds/855608/ | CC0 | 🟡 | Yes | None |
| qubodup "military sounds" pack (all 305) | **UNKNOWN pack-wide** | ❌ | Per-file only | Per-file |
| wadaltmon Thompson SMG /sounds/258198/ | CC0 | 🟡 | Yes | None |
| Clueless79 Shotgun 02 /sounds/544676/ | CC0 | 🟡 | Yes | None |
| Clueless79 Shotgun 03 /sounds/544675/ | Unknown | ❌ | — | — |
| SuperPhat — 6 files checked of 14 | CC0 (those 6) | 🟡 | Yes (those 6) | None |
| SuperPhat — other 8 files | Unknown | ❌ | — | — |
| mahecic Pocket Pistol — 2 of 7 | CC0 (those 2) | 🟡 | Yes (those 2) | None |
| mahecic Pocket Pistol — other 5 | Unknown | ❌ | — | — |
| johanwestling 9mm pack /packs/21222/ (3 files) | Unknown | ❌ | — | — |
| Tabasco "Gunshot Sounds" (OGA) | CC0 | 🟡 | Yes | None |
| Michel Baradari chaingun/pistol/rifle/shotgun | **CC-BY 3.0** | 🟡 | Yes, **with credit** | ⚠️ Attribution Instructions field is **EMPTY** — no author-specified string exists |
| **SnakeF8 Pack 1** (itch) | **No named licence — prose grant only** | ✅ | Yes, per author's words | *"credit is not needed"* |
| **SnakeF8 Pack 2** (itch) | **No named licence — prose grant only** | ✅ | Yes, per author's words | *"credit is not needed"* |
| lentikula Sci-Fi Weapon Shots (itch) | CC0 (deed linked by author) | 🟡 | Yes | None |
| zblogda X3 Gun Slide (itch) | "CC0" **+ contradictory "Cannot be sold"** | 🟡 | Ambiguous | "No attribution required" |
| Dan Sfx `hgsfx` (itch) | **NONE** | ❌ | **No** | — |
| Graywavstudio AK-47 foley (itch) | **NONE** | ❌ | **No** | — |
| Pixabay mirrors (LeMudCrab, morganpurkis) | Pixabay Content Licence over CC0 originals | 🟡 | Yes | None — but **take the Freesound original**, not the MP3 transcode |
| morganpurkis pistol series (8 files) | CC0 (1 of 8 checked) | 🟡 | Yes (that 1) | None |
| SpringySpringo gun reloads (OGA) | CC0 | 🟡 | Yes | *"Credit isn't required"* |
| qubodup Synthesized Explosion (OGA) | CC0 | 🟡 | Yes | None |

### Vocals

| Source | Licence | Verified? | Commercial OK? | Attribution |
|---|---|---|---|---|
| qubodup 15 vocal male strain/hurt/pain/jump | CC0 (from 2024-08-30) | ✅ | **Yes** | None — `[optional] qubodup` |
| thebardofblasphemy male death/pain | CC0 | ✅ | **Yes** | None |
| Nocturnal_Vanguard female hurt grunts | CC0 | ✅ | **Yes** | None |
| MrFossy pack 30826 (file 547198) | CC0 | ✅ | **Yes** | None |
| MrFossy — other 11 of 12 | CC0 strongly indicated (uploader has 1,921 CC0 sounds) | 🟡 | Likely | Check each page |
| Potapooo pack 39934 (file 714591) | CC0 | ✅ | **Yes** | None |
| Potapooo — remaining 27 | CC0 (facet: 38 of 38 CC0) | 🟡 | Likely all | None |
| Reitanna /sounds/242623/ | CC0 | ✅ | **Yes** | None |
| Reitanna full library (1,146 clips) | CC0 (facet count 1,146 = 1,146) | 🟡 | Likely all | None |
| mvVoiceActing /sounds/855460/ | CC0 | ✅ | **Yes** | None |
| MadamVicious /sounds/218190/ | CC0 | 🟡 | Yes | None |
| Kenney Voiceover Pack (Fighter) — files 1–10 only | CC0 | 🟡 | Yes | None |
| Badre-Eddine hurt/death (OGA) | CC0 | 🟡 | Yes | None |
| Exewin death sounds (OGA) | CC0 | 🟡 | Yes | None |
| salemaudio /sounds/803168/ | CC0 | 🟡 | Yes | None |
| egomassive GruntF /sounds/536750/ | CC0 | 🟡 | Yes | None |
| Vanalosswen female heavy breathing /sounds/572452/ | CC0 | 🟡 | Yes | None |
| _MokeyMokey pack 42824 (1 of 3) | CC0 | 🟡 | Yes | None |
| Kodack Male Grunts /sounds/256603/ | CC0 | 🟡 | Yes | None |
| **SoundBiterSFX /sounds/731505/** | **CC-BY 4.0** ("Attribution 4.0") | ✅ | Yes, **with credit** | See §3 for the exact string + a **newly-found extra term** |
| SoundBiterSFX — same material **on OpenGameArt** | **CC-BY-SA 4.0** | 🟡 | **REJECTED** | — |
| Michel Baradari 11 male pain/death (OGA) | CC-BY 3.0 | 🟡 | Yes, with credit | ⚠️ exact string never captured |
| craigsmith Vintage Voices — Women | CC0 (uploader's declaration over 1930s–60s Hollywood material) | 🟡 | Probably | None — but weaker chain of title |

### Ambience

| Source | Licence | Verified? | Commercial OK? | Attribution |
|---|---|---|---|---|
| kkenny101 /sounds/852826/ | CC0 | ✅ | **Yes** | None |
| BigSoundBank s0904 wind in trees | CC0 | ✅ | **Yes** | None (optional: *"Additional sounds: Joseph SARDIN - BigSoundBank.com"*) |
| kkenny101 /sounds/852845/, /852844/ | CC0 | 🟡 | Yes | None |
| BigSoundBank s1448 small waves | CC0 | 🟡 | Yes | None (optional) |
| Nox_Sound Pack - Ambiances (2 of 252 checked) | CC0 | 🟡 | Likely all 252 | None |
| NickTayloe /sounds/830253/ | CC0 | 🟡 | Yes | None |
| NomadApe /sounds/444921/ | CC0 | 🟡 | Yes | None |
| kyles /sounds/637559/ | CC0 | 🟡 | Yes | None |
| TinyWorlds Forest Ambience (OGA) | CC0 | 🟡 | Yes | None |
| OGA "Beach Ocean Waves" (jasinski) | CC0 on OGA; **upstream Freesound file 18363 never checked** | ❌ upstream | Probably | None |
| JC Sounds Nature Ambient Pack Vol 1 | CC-BY 4.0 | 🟡 | Yes, with credit | ⚠️ no author-specified string |
| Sonniss GDC Bundle | Proprietary royalty-free | 🟡 | Yes-but | No CC licence; redistribution restricted |
| PixelLoops Ultimate Ambient (itch, paid) | **Marketing phrases only** | ❌ | Unknown | Unknown |
| OGA "CC0 Sounds Library" / "Ambient Sounds" collections | **No licence field — curator assertion** | ❌ | **Per-item only** | Per-item |

---

## 3. REJECTED AND WHY

### Hard rejects — do not download

| Asset | Reason |
|---|---|
| **Dan Sfx — "Free Single HandGun Sound Effects Pack"** https://cdansantana.itch.io/hgsfx | **No licence exists.** The only permission is an off-hand comment reply: *"I haven't added any specific license, but feel free to use it!"* That names no scope, no term, is not irrevocable, and does not survive the author changing his mind. **This is the trap in the pile** — it is the highest-spec audio found (24-bit/96 kHz, and it separates RAW from DESIGNED shots, exactly what you want), so it will look attractive. Two later commenters asked the commercial question explicitly and **both went unanswered.** Fix is cheap: message the author, ask him to set the itch License field to CC0, re-verify. Until then, rejected. |
| **Graywavstudio — AK-47 Noises base pack** | Zero licence information anywhere; default is all-rights-reserved. Also contains **no gunshots at all**, only mechanical foley, despite ranking on "gunsounds" tags. |
| **SoundBiterSFX's packs on OpenGameArt** | **CC-BY-SA 4.0** — share-alike fails your bar. Same author's same material is plain CC-BY 4.0 on Freesound. Take the Freesound URL, never the OGA one. |
| **OGA "CC0 Sounds Library" (ETTiNGRiNDER) / "Ambient Sounds" (OwlishMedia)** https://opengameart.org/content/cc0-sounds-library | These are **collections**, not submissions. No licence field on the page — the "CC0" in the title is one curator's assertion about *other people's* uploads. This is precisely the failure mode the brief warns about. Usable as a discovery index only. |
| **Sonniss GDC Game Audio Bundle** | Not a Creative Commons licence, so it fails the stated bar. Its terms prohibit redistribution *"as standalone files"* — and a browser game serves its `.ogg` assets as separately-fetchable static files over HTTP. That is close enough to the prohibited case to need a lawyer's read, which isn't worth it when CC0 covers the need. |
| **PixelLoops "Ultimate Game Ambient Sound Effects Pack"** (paid, $3.59) | Terms are two marketing phrases on a storefront ("Royalty Free", "Commercial Use Allowed"), no licence text, no CC identifier. You cannot establish the actual terms without buying it first. Content fit is excellent, so if you want it: **get the licence text in writing from the seller before purchase.** Also — this is a >$0 spend and needs the approval gate regardless. |

### Conditional — CC-BY, acceptable only if you accept the obligation

| Asset | Status |
|---|---|
| **SoundBiterSFX — NPC/Player Damage Grunts (Male)**, Freesound 731505 | ✅ re-verified **CC-BY 4.0**: *"You are free to share… and to remix… as long as you credit the author of the sound."* Highest production quality on the vocal list (22 distinct grunts in one file). **Attribution string to use:** `Damage grunts by VoiceBosch (SoundBiter) — CC BY 4.0 — https://freesound.org/people/SoundBiterSFX/sounds/731505/` <br>**⚠️ NEW FINDING the hunts missed:** the file description carries an additional term — users may **not** *"replicate the voices featured on SoundBiter SFX through the use of AI technology."* That is outside CC-BY and doesn't affect shipping the audio in a game, but it means the file is **not** a clean CC-BY grant with no side conditions. Log it if you take this file. |
| **Michel Baradari — Chaingun/pistol/rifle/shotgun** (OGA) | CC-BY 3.0, 638.5 KB for 4 weapons. **The page's Attribution Instructions field is EMPTY**, so no author-specified string exists — you must compose one and hope it satisfies. The brief asks for a nameable exact string; there isn't one. Recommend: skip, CC0 covers these slots. |
| **Michel Baradari — 11 male pain/death sounds** (OGA) | Same problem — CC-BY 3.0, exact string never captured on-page. Only worth the obligation if the CC0 vocals come up short on variety. |
| **JC Sounds — Nature Ambient Pack Vol 1** (OGA) | CC-BY 4.0, 26 loops. No author-supplied attribution string. Three fully-CC0 alternatives already cover forest/wind/water. **Skip.** |
| **zblogda — X3 Free Gun Slide Sounds** (itch) | Page says both *"No attribution required | CC0"* **and** *"Cannot be salled [sold]"* — internally contradictory, since CC0 permits resale. Doesn't actually affect you (embedding in a game ≠ reselling the audio standalone), so you satisfy both readings. But it's 70 KB of redundancy — SnakeF8 Pack 2 has slide foley too. Optional. |
| **craigsmith — Vintage Voices: Women** | Tagged CC0, but these are digitised 1930s–60s Hollywood optical negatives transferred by USC Cinema. The CC0 tag is the *uploader's declaration about third-party historical material*, not a first-party waiver. Almost certainly fine — it's a long-standing, widely-used Freesound collection — but it is a weaker chain of title than Reitanna's or MrFossy's own voices. Last-resort female source. |
| **OGA "Beach Ocean Waves" (jasinski)** | OGA page says CC0 and the filenames literally encode `cc0`, but it was extracted from Freesound file 18363 and **nobody opened the upstream page.** Since Freesound mixes licences per file, spot-check https://www.freesound.org/people/jasinski/sounds/18363/ before shipping. kkenny101 and BigSoundBank make this unnecessary. |

### Wrong-fit, not wrong-licence

- **lentikula — Sci-Fi Weapon Shots** (cleanest licence on itch: author links the CC0 deed and writes *"you can use it in whatever project without attribution"*). Laser weapons would read off-brand against Last Circle's modern-military direction. Shelve for a future sci-fi skin, or use at low level as a sweetener transient under a conventional shot.
- **Kenney laser SFX** (`laserSmall/Large/Retro`) — synth sci-fi zaps, wrong for a grounded BR. Kenney has **no realistic firearm reports anywhere**; only the explosion files are useful.

---

## 4. GAPS — where nothing clean was found

**One genuine gap:**

> ### ❌ Female DEATH vocalisation — no verified source
> I re-verified both female candidates myself. Neither page confirms a death sound:
> - Nocturnal_Vanguard's page describes *hurt grunts and groans* only; it does not state the clip count or confirm a death vocalisation.
> - mvVoiceActing 855460 is described as *"Female taking damage"* — damage, not death.
>
> **Recommendation:** audition `female_hurt_grunts_groans_1.ogg` (188.8 KB — a 30-second listen) before assuming it's covered. If there's no death take in there, **keep the synthesised female death sound** and revisit rather than taking on a CC-BY obligation for one clip. A pitch-shifted long groan from the same file is the cheaper fix and keeps the voice consistent.

**Everything else is covered:**
- All six weapon reports: **CC0, no gaps.**
- Male hurt / jump exhale / death: **CC0, three independent sources.**
- Female hurt: **CC0, two sources.**
- Ambience (wind, forest, shoreline): **CC0, and BigSoundBank serves `.ogg` directly with no conversion step.**

---

## 5. REMAINING UNCERTAINTIES — read before downloading

**1. SnakeF8 is the best-sounding option and I still did not recommend it.** I re-verified both pages myself. The grant is verbatim: *"All sounds can be used commercially, and credit is not needed (I would appreciate it a lot though!)."* The audio fit is genuinely the best in the pile — every gunshot ships **with and without natural reverb**, and the dry versions are exactly the source your engine wants. But: **there is no License field on either itch page**, and a prose grant in editable page copy is not irrevocable on its face. That fails a bar written as "CC0 ideal, CC-BY acceptable."

> **⚠️ Correction to the hunt data:** my Pack 2 fetch summary rendered the licence as "Public domain (CC0)". **That is the summariser inferring, not text on the page** — the same response also states *"No License field exists on this page."* Do not record SnakeF8 as CC0 anywhere.

**If you want SnakeF8 anyway** (defensible — two commenters report shipping it in paid Steam/VR titles with the author replying approvingly): (a) archive both pages to web.archive.org **on the day you download**, (b) keep the zip, (c) message the author asking him to set the itch License field to CC0. He has already granted commercial use in writing, so this is likely a yes and removes the ambiguity entirely. That's the highest-value 5 minutes available on this whole task.

**2. Freesound packs are per-file, always.** Pack pages display no licence at all. Where a hunt verified 1–2 files out of a pack — SuperPhat (6 of 14), mahecic (2 of 7), MrFossy (1 of 12 by me), Nox_Sound Ambiances (2 of 252) — **open every page you actually pull.** The strongest evidence obtainable without an API key is the facet-count check (Reitanna: 1,146 total = 1,146 CC0; Potapooo: 38 = 38), and even that is indicative, not per-file proof.

**3. Do NOT bulk-download qubodup's 305-file "military sounds" pack.** A hunt tried twice to prove pack-wide CC0 via the licence filter and Freesound errored both times (*"There was an error while searching, is your query correct?"*). Four files are individually verified CC0 (two of which I re-verified). The other 301 are unestablished.

**4. The GitHub mirror's README has no licence text.** I confirmed the LICENSE *file* is genuine CC0 1.0 legal code, and the OGA submission independently reads CC0. Both hold. **Cite the OpenGameArt page as the licence authority**, use the mirror only as the acquisition route (`raw.githubusercontent.com/buddingmonkey/FreeFirearmsSFXLibrary/master/Prepared%20SFX/<weapon>/<file>.wav`).

**5. Two size/format corrections to the hunt data, found this session:**
- TheGreenEyedGhost SPAS-12 is **stereo**, not mono as one hunt reported. Fold to mono before feeding positional audio.
- The Kenney Sci-fi Sounds "credit appreciated but not required" readme quote could not be re-confirmed by my fetch — only the `Creative Commons CC0` page label was. CC0 requires no credit regardless, so this changes nothing legally.

**6. Adjacent free win not in the brief:** your 282 Kenney clips contain **no firearm mechanics** — no slide rack, no bolt, no magazine. A BR needs reload foley per weapon class. SpringySpringo's CC0 reload set (https://opengameart.org/content/gun-reload-sounds, 3 loose WAVs, ~636 KB, airsoft indoors = dry) covers it at zero obligation. 🟡 hunt-verified only.

---

### Suggested download order (owner approval required — nothing downloaded)
1. `github.com/buddingmonkey/FreeFirearmsSFXLibrary` — 5 cherry-picked files (**not** the 194 MB archive)
2. Freesound 163458 (grenade launcher, 37.6 KB)
3. Freesound 707794 (shotgun) + 541818 (revolver) — as alternates to #1
4. OGA `slightscreams.7z` (1.4 MB) + `death pain grunts.wav` (4.4 MB) + `female_hurt_grunts_groans_1.ogg` (188.8 KB)
5. Freesound pack 30826 — 12 pre-sliced male one-shots, checking each page's licence badge
6. kkenny101 852826 + BigSoundBank s0904 OGG (ambience)
7. Kenney Sci-fi Sounds — extract 7 explosion files only
8. Optional: SpringySpringo reloads