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

## 6. SHIPPED IN THE PARITY RELEASE (P1 + P2 + P3, 2026-10-27) — every new audio file, its source and licence

86 new files in `assets/audio/sfx/`, all CC0 1.0, $0. Raw downloads stayed in dev-only folders (F:/lc_p23/audio/dl/), never shipped; each file was cut,
faded, normalised and encoded (mono 44.1 kHz Ogg Vorbis) by the lanes' deterministic builders. Licences re-checked on the source pages 2026-10-20
(P2) and 2026-10-27 (footsteps). The same records ship beside the files: `assets/audio/sfx/P1B-SOURCES.txt`, `assets/audio/sfx/P23-SOURCES.txt`.
Authors credited as a courtesy (CC0 asks for no attribution): The Free Firearm Sound Library by Ben Jaszczak, Brian Nelson, Kevin Heras and
Matthew Nanney; Potapooo; qubodup; thebardofblasphemy; Nocturnal_Vanguard; mvVoiceActing; Fantozzi; TinyWorlds; rubberduck; Peludo (its page asks
games to reference its itch.io page - a request, not a licence term); Kenney.

### P1 (lane P1-B): 7 files built from local Kenney packs (no download)

| file | source take | source URL | licence |
|---|---|---|---|
| hit_flesh_0.ogg, hit_flesh_1.ogg | Kenney Impact Sounds 1.0: impactPunch_medium_000 / _002 | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| hit_shield_0.ogg, hit_shield_1.ogg | Kenney Interface Sounds 1.0: glass_002 / glass_003 | https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| shield_break_0.ogg | Kenney Impact Sounds 1.0 impactGlass_heavy_000 + _002 and Kenney Interface Sounds 1.0 glass_004, layered | https://kenney.nl/assets/impact-sounds , https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| explosion_0.ogg, explosion_1.ogg | Kenney Impact Sounds 1.0 impactPunch_heavy_000 / _002, impactSoft_heavy_000, impactWood_light_001 / _003, impactPlank_medium_001, pitched and layered, + a seeded procedural rumble (own work) | https://kenney.nl/assets/impact-sounds | CC0 1.0 (+ own work) |

### P2 / P3 (lane audio): 63 files (guns, vocals) + 16 footsteps (fix round)

| file | source take | source URL | licence |
|---|---|---|---|
| gd_pistol_mid_0.ogg | FFSL A_34P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_pistol_mid_1.ogg | FFSL A_34P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_pistol_far_0.ogg | FFSL A_39.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_pistol_far_1.ogg | FFSL A_39.wav event 1 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_smg_mid_0.ogg | FFSL G_20P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_smg_mid_1.ogg | FFSL G_20P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_smg_far_0.ogg | FFSL G_19.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_smg_far_1.ogg | FFSL G_19.wav event 1 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_ar_mid_0.ogg | FFSL C_31P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_ar_mid_1.ogg | FFSL C_31P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_ar_far_0.ogg | FFSL C_17.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_ar_far_1.ogg | FFSL C_17.wav event 1 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_shotgun_mid_0.ogg | FFSL N_26P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_shotgun_mid_1.ogg | FFSL N_26P.wav event 2 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_sniper_mid_0.ogg | FFSL M_26P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_sniper_mid_1.ogg | FFSL M_26P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_sniper_far_0.ogg | FFSL M_23.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_sniper_far_1.ogg | FFSL M_23.wav event 1 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| shot_dmr_0.ogg | FFSL U_14P.wav event 0 (near distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| shot_dmr_1.ogg | FFSL U_14P.wav event 2 (near distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| shot_dmr_2.ogg | FFSL U_14P.wav event 3 (near distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_dmr_mid_0.ogg | FFSL U_19P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_dmr_mid_1.ogg | FFSL U_19P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_dmr_far_0.ogg | FFSL U_18.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_dmr_far_1.ogg | FFSL U_18.wav event 1 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| shot_burst_0.ogg | FFSL D_32P.wav event 0 (near distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| shot_burst_1.ogg | FFSL D_32P.wav event 1 (near distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_burst_mid_0.ogg | FFSL D_24P.wav event 0 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_burst_mid_1.ogg | FFSL D_24P.wav event 1 (mid distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_burst_far_0.ogg | FFSL D_25.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| gd_burst_far_1.ogg | FFSL D_26.wav event 0 (far distance) | https://github.com/buddingmonkey/FreeFirearmsSFXLibrary (licence authority https://opengameart.org/content/the-free-firearm-sound-library) | CC0 1.0 |
| vo_m1_hurt_0.ogg | 714596.ogg 0.00-0.60 s | https://freesound.org/people/Potapooo/sounds/714596/ | CC0 1.0 |
| vo_m1_hurt_1.ogg | 714597.ogg 0.00-0.49 s | https://freesound.org/people/Potapooo/sounds/714597/ | CC0 1.0 |
| vo_m1_hurt_2.ogg | 714598.ogg 0.00-0.43 s | https://freesound.org/people/Potapooo/sounds/714598/ | CC0 1.0 |
| vo_m1_hurt_3.ogg | 714599.ogg 0.00-0.57 s | https://freesound.org/people/Potapooo/sounds/714599/ | CC0 1.0 |
| vo_m1_downed_0.ogg | 714592.ogg 0.00-0.93 s | https://freesound.org/people/Potapooo/sounds/714592/ | CC0 1.0 |
| vo_m1_downed_1.ogg | 714593.ogg 0.00-1.24 s | https://freesound.org/people/Potapooo/sounds/714593/ | CC0 1.0 |
| vo_m1_death_0.ogg | 714594.ogg 0.00-1.37 s | https://freesound.org/people/Potapooo/sounds/714594/ | CC0 1.0 |
| vo_m1_death_1.ogg | 714595.ogg 0.00-0.89 s | https://freesound.org/people/Potapooo/sounds/714595/ | CC0 1.0 |
| vo_m1_revive_0.ogg | 714583.ogg 0.00-0.57 s | https://freesound.org/people/Potapooo/sounds/714583/ | CC0 1.0 |
| vo_m1_revive_1.ogg | 714585.ogg 0.00-0.76 s | https://freesound.org/people/Potapooo/sounds/714585/ | CC0 1.0 |
| vo_m2_hurt_0.ogg | slightscream-01.flac 0.00-0.45 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_hurt_1.ogg | slightscream-03.flac 0.00-0.56 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_hurt_2.ogg | slightscream-08.flac 0.00-0.41 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_hurt_3.ogg | slightscream-11.flac 0.00-0.33 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_hurt_4.ogg | slightscream-12.flac 0.00-0.38 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_downed_0.ogg | slightscream-10.flac 0.00-0.73 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_downed_1.ogg | slightscream-15.flac 0.00-0.79 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_revive_0.ogg | slightscream-14.flac 0.00-0.60 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_revive_1.ogg | slightscream-05.flac 0.00-0.69 s | https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds | CC0 1.0 |
| vo_m2_death_0.ogg | death_pain_grunts.wav 0.50-1.84 s | https://opengameart.org/content/grunts-male-death-and-pain | CC0 1.0 |
| vo_m2_death_1.ogg | death_pain_grunts.wav 14.46-16.06 s | https://opengameart.org/content/grunts-male-death-and-pain | CC0 1.0 |
| vo_m2_death_2.ogg | death_pain_grunts.wav 35.98-37.26 s | https://opengameart.org/content/grunts-male-death-and-pain | CC0 1.0 |
| vo_f_hurt_0.ogg | female_hurt_grunts_groans_1.ogg 3.72-4.10 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_hurt_1.ogg | female_hurt_grunts_groans_1.ogg 2.10-2.68 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_hurt_2.ogg | female_hurt_grunts_groans_1.ogg 0.44-1.12 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_hurt_3.ogg | 855460.mp3 0.58-1.18 s | https://freesound.org/people/mvVoiceActing/sounds/855460/ | CC0 1.0 |
| vo_f_hurt_4.ogg | 855460.mp3 2.06-2.60 s | https://freesound.org/people/mvVoiceActing/sounds/855460/ | CC0 1.0 |
| vo_f_downed_0.ogg | female_hurt_grunts_groans_1.ogg 4.96-6.08 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_downed_1.ogg | female_hurt_grunts_groans_1.ogg 9.38-10.26 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_death_0.ogg | female_hurt_grunts_groans_1.ogg 11.70-12.52 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_death_1.ogg | female_hurt_grunts_groans_1.ogg 7.34-8.08 s | https://opengameart.org/content/female-hurt-grunts-groans | CC0 1.0 |
| vo_f_revive_0.ogg | 855460.mp3 3.48-4.04 s | https://freesound.org/people/mvVoiceActing/sounds/855460/ | CC0 1.0 |
| step_sand_000.ogg | Fantozzi-SandL1.flac (Fantozzi, OGA, submitted by qubodup) | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | CC0 1.0 |
| step_sand_001.ogg | Fantozzi-SandR1.flac (Fantozzi, OGA, submitted by qubodup) | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | CC0 1.0 |
| step_sand_002.ogg | Fantozzi-SandL2.flac (Fantozzi, OGA, submitted by qubodup) | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | CC0 1.0 |
| step_sand_003.ogg | Fantozzi-SandR3.flac (Fantozzi, OGA, submitted by qubodup) | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | CC0 1.0 |
| step_dirt_000.ogg | [kdd]DifferentSteps gravel.ogg (TinyWorlds) | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | CC0 1.0 |
| step_dirt_001.ogg | [kdd]DifferentSteps mud02.ogg (TinyWorlds) | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | CC0 1.0 |
| step_dirt_002.ogg | sfx100v2_footstep_01.ogg (rubberduck) | https://opengameart.org/content/100-cc0-sfx-2 | CC0 1.0 |
| step_dirt_003.ogg | sfx100v2_footstep_02.ogg (rubberduck) | https://opengameart.org/content/100-cc0-sfx-2 | CC0 1.0 |
| step_water_000.ogg | sfx100v2_footstep_wet_01.ogg (rubberduck) | https://opengameart.org/content/100-cc0-sfx-2 | CC0 1.0 |
| step_water_001.ogg | sfx100v2_footstep_wet_02.ogg (rubberduck) | https://opengameart.org/content/100-cc0-sfx-2 | CC0 1.0 |
| step_water_002.ogg | sfx100v2_footstep_wet_03.ogg (rubberduck) | https://opengameart.org/content/100-cc0-sfx-2 | CC0 1.0 |
| step_water_003.ogg | splash2.wav 0.66-1.12 s at rate 1.25 (Peludo) | https://opengameart.org/content/water-splash-and-sand-footsteps | CC0 1.0 |
| step_metal_000.ogg | Kenney footstep_concrete_000 + impactTin_medium_000 (-1 dB) + impactMetal_light_001 (rate 0.8, -11 dB), layered | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| step_metal_001.ogg | Kenney footstep_concrete_001 + impactTin_medium_001 (-1 dB) + impactMetal_light_002 (rate 0.8, -11 dB), layered | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| step_metal_002.ogg | Kenney footstep_concrete_002 + impactTin_medium_002 (-1 dB) + impactMetal_light_003 (rate 0.8, -11 dB), layered | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| step_metal_003.ogg | Kenney footstep_concrete_003 + impactTin_medium_003 (-1 dB) + impactMetal_light_004 (rate 0.8, -11 dB), layered | https://kenney.nl/assets/impact-sounds | CC0 1.0 |

---

## W10 R2B - recorded ambience, foley, reloads, water (2026-11-14)

99 new files in `assets/audio/sfx/` (1,449,113 B), mono 48 kHz Ogg Vorbis, cut / mixed / levelled / encoded deterministically by
`F:/lc_p23/w10/r2/R2B/build1/tools/build_w10_sfx.py` (dev-only, never shipped) from free packs already on F: - no spend. Two licences:

- **Kenney CC0 1.0** (rpg-audio, impact-sounds, interface-sounds; `F:/games/forgeflow-games-assets/<pack>/License.txt`): public domain, no attribution needed (credited anyway).
- **Sonniss GDC 2024 Game Audio Bundle** (`F:/games/forgeflow-games-assets/sonniss-gdc2024/LICENSE.txt`): royalty-free, commercial use, may ship embedded in a game, no attribution required; NOT CC0 - the raw library may not be redistributed or used for AI training. Each file below is a cut / mix inside the game build, never a raw pack file. Credited in CREDITS.md anyway.

Selection note: the takes were chosen from measured structure (onset lists, loudness windows), not by ear - no listening test was possible in the build lane.
The per-clip loudness trims live in `runtime/3d/royale/audio.js` CLIP_DB (generated by `tools/loudtable.py`).

| file | bytes | source | licence |
|---|---|---|---|
| rl_pistol_out_0.ogg | 5541 | Sonniss GDC 2024: Pole Position - Desert Eagle .44/Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav (event 1 @1.30 s) | Sonniss GDC 2024 licence |
| rl_pistol_out_1.ogg | 5380 | Sonniss GDC 2024: Pole Position - Desert Eagle .44/Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav (event 11 @8.85 s) | Sonniss GDC 2024 licence |
| rl_pistol_in_0.ogg | 5340 | Sonniss GDC 2024: Pole Position - Desert Eagle .44/Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav (event 7 @4.92 s) | Sonniss GDC 2024 licence |
| rl_pistol_in_1.ogg | 5256 | Sonniss GDC 2024: Pole Position - Desert Eagle .44/Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav (event 19 @14.39 s) | Sonniss GDC 2024 licence |
| rl_pistol_slide_0.ogg | 5655 | Sonniss GDC 2024: Pole Position - Desert Eagle .44/Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav (event 24 @17.31 s) | Sonniss GDC 2024 licence |
| rl_rifle_out_0.ogg | 8694 | Sonniss GDC 2024: Dramatic Cat - SVD Dragunov/GUNMech_SVD Dragunov 7.62×54R SOURCE Magazine Insert Slow_DRCA_DRAG_CO-100K.wav (event 2 @3.26 s) | Sonniss GDC 2024 licence |
| rl_rifle_out_1.ogg | 6931 | Sonniss GDC 2024: Dramatic Cat - SVD Dragunov/GUNMech_SVD Dragunov 7.62×54R SOURCE Magazine Insert Slow_DRCA_DRAG_CO-100K.wav (event 7 @9.27 s) | Sonniss GDC 2024 licence |
| rl_rifle_in_0.ogg | 3950 | Sonniss GDC 2024: Dramatic Cat - SVD Dragunov/GUNMech_SVD Dragunov 7.62×54R SOURCE Magazine Insert Slow_DRCA_DRAG_CO-100K.wav (event 4 @4.09 s) | Sonniss GDC 2024 licence |
| rl_rifle_in_1.ogg | 4121 | Sonniss GDC 2024: Dramatic Cat - SVD Dragunov/GUNMech_SVD Dragunov 7.62×54R SOURCE Magazine Insert Slow_DRCA_DRAG_CO-100K.wav (event 9 @9.92 s) | Sonniss GDC 2024 licence |
| rl_rifle_rack_0.ogg | 4296 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 6 @6.02 s) | Sonniss GDC 2024 licence |
| rl_rifle_rack_1.ogg | 5025 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 3 @3.71 s) | Sonniss GDC 2024 licence |
| rl_shell_0.ogg | 6120 | Sonniss GDC 2024: Pole Position - Colt Python .357 Magnum/Colt Python 357 Magnum - VAR SFX - Loading Gun - CO100K.wav (event 1 @0.54 s) | Sonniss GDC 2024 licence |
| rl_shell_1.ogg | 3705 | Sonniss GDC 2024: Pole Position - Colt Python .357 Magnum/Colt Python 357 Magnum - VAR SFX - Loading Gun - CO100K.wav (event 15 @15.81 s) | Sonniss GDC 2024 licence |
| rl_shell_2.ogg | 3781 | Sonniss GDC 2024: Pole Position - Colt Python .357 Magnum/Colt Python 357 Magnum - VAR SFX - Loading Gun - CO100K.wav (event 5 @3.95 s) | Sonniss GDC 2024 licence |
| rl_pump_0.ogg | 10398 | Sonniss GDC 2024: Pole Position - Franchi SPAS-12 Combat Shotgun/SPAS-12 - VAR SFX - Pump Action Fast - Close - MS - MKH418s.wav (0.17-1.00 s, back + forward) | Sonniss GDC 2024 licence |
| rl_pump_1.ogg | 9673 | Sonniss GDC 2024: Pole Position - Franchi SPAS-12 Combat Shotgun/SPAS-12 - VAR SFX - Pump Action Fast - Close - MS - MKH418s.wav (2.08-2.75 s, back + forward) | Sonniss GDC 2024 licence |
| rl_bolt_open_0.ogg | 4557 | Sonniss GDC 2024: Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - VAR SFX - Shell Ejections - Take 2 - CO100k.wav (event 5 @9.44 s) | Sonniss GDC 2024 licence |
| rl_bolt_open_1.ogg | 5686 | Sonniss GDC 2024: Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - VAR SFX - Shell Ejections - Take 2 - CO100k.wav (event 15 @17.65 s) | Sonniss GDC 2024 licence |
| rl_bolt_close_0.ogg | 4514 | Sonniss GDC 2024: Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - VAR SFX - Shell Ejections - Take 2 - CO100k.wav (event 1 @2.47 s) | Sonniss GDC 2024 licence |
| rl_bolt_close_1.ogg | 5918 | Sonniss GDC 2024: Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - VAR SFX - Shell Ejections - Take 2 - CO100k.wav (event 21 @25.36 s) | Sonniss GDC 2024 licence |
| rl_break_open_0.ogg | 5017 | Sonniss GDC 2024: Pole Position - Smith & Wesson .38 Chiefs Special Model 60/Smith & Wesson 60 - VAR SFX - Open Close Revovler with Shells - XY - RSM191.wav (event 0 @0.70 s) | Sonniss GDC 2024 licence |
| rl_break_close_0.ogg | 3793 | Sonniss GDC 2024: Pole Position - Smith & Wesson .38 Chiefs Special Model 60/Smith & Wesson 60 - VAR SFX - Open Close Revovler with Shells - XY - RSM191.wav (event 6 @8.68 s) | Sonniss GDC 2024 licence |
| rl_break_close_1.ogg | 4883 | Sonniss GDC 2024: Pole Position - Smith & Wesson .38 Chiefs Special Model 60/Smith & Wesson 60 - VAR SFX - Open Close Revovler with Shells - XY - RSM191.wav (event 4 @5.57 s) | Sonniss GDC 2024 licence |
| rl_ln_shell_0.ogg | 6521 | Sonniss GDC 2024: Dramatic Cat - Saiga-12/GUNMech_Saiga 12 Cal.12 SOURCE Chamber Eject Bullet_DRCA_SG12_MKH416.wav (event 0 @0.28 s) | Sonniss GDC 2024 licence |
| rl_ln_shell_1.ogg | 9862 | Sonniss GDC 2024: Dramatic Cat - Saiga-12/GUNMech_Saiga 12 Cal.12 SOURCE Chamber Eject Bullet_DRCA_SG12_MKH416.wav (event 2 @4.28 s) | Sonniss GDC 2024 licence |
| equip_0.ogg | 9463 | Kenney: rpg-audio/Audio/clothBelt.ogg + Kenney: rpg-audio/Audio/metalLatch.ogg (-8 dB @90 ms) | Kenney CC0 1.0 |
| equip_1.ogg | 6971 | Kenney: rpg-audio/Audio/cloth3.ogg + Kenney: rpg-audio/Audio/metalClick.ogg (-6 dB @70 ms) | Kenney CC0 1.0 |
| equip_2.ogg | 8325 | Kenney: rpg-audio/Audio/clothBelt2.ogg + Kenney: rpg-audio/Audio/metalLatch.ogg (-9 dB @110 ms) | Kenney CC0 1.0 |
| dry_fire_0.ogg | 4927 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 10 @12.18 s) | Sonniss GDC 2024 licence |
| dry_fire_1.ogg | 4846 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 11 @12.40 s) | Sonniss GDC 2024 licence |
| rl_cancel_0.ogg | 6102 | Kenney: rpg-audio/Audio/cloth4.ogg | Kenney CC0 1.0 |
| shot_launcher_0.ogg | 9434 | Sonniss GDC 2024: Pole Position - The Warfare 2 Library/Haubits FH77 Howitzer - FIRING - Multiple Shots 2 - FRONT - MKH8060.wav (shot @0.10 s, 1.45x speed) | Sonniss GDC 2024 licence |
| shot_launcher_1.ogg | 9326 | Sonniss GDC 2024: Pole Position - The Warfare 2 Library/Haubits FH77 Howitzer - FIRING - Multiple Shots 2 - FRONT - MKH8060.wav (shot @29.79 s, 1.45x speed) | Sonniss GDC 2024 licence |
| gren_throw_0.ogg | 7372 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav (1.20-1.75 s, hp 300 Hz) | Sonniss GDC 2024 licence |
| gren_throw_1.ogg | 7349 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav (1.50-2.05 s, hp 300 Hz) | Sonniss GDC 2024 licence |
| gren_pin_0.ogg | 4785 | Kenney: rpg-audio/Audio/metalLatch.ogg (1.25x speed) | Kenney CC0 1.0 |
| gren_bounce_0.ogg | 4254 | Kenney: impact-sounds/Audio/impactMetal_medium_000.ogg | Kenney CC0 1.0 |
| gren_bounce_1.ogg | 3867 | Kenney: impact-sounds/Audio/impactMetal_medium_001.ogg | Kenney CC0 1.0 |
| gren_bounce_2.ogg | 4024 | Kenney: impact-sounds/Audio/impactTin_medium_002.ogg | Kenney CC0 1.0 |
| pickup_0.ogg | 5366 | Kenney: rpg-audio/Audio/handleSmallLeather.ogg | Kenney CC0 1.0 |
| pickup_1.ogg | 5397 | Kenney: rpg-audio/Audio/handleSmallLeather2.ogg | Kenney CC0 1.0 |
| pickup_2.ogg | 7877 | Kenney: rpg-audio/Audio/clothBelt2.ogg | Kenney CC0 1.0 |
| chest_open_0.ogg | 7308 | Kenney: rpg-audio/Audio/creak1.ogg + Kenney: impact-sounds/Audio/impactWood_light_000.ogg (@420 ms -4 dB) | Kenney CC0 1.0 |
| chest_open_1.ogg | 8399 | Kenney: rpg-audio/Audio/creak2.ogg + Kenney: impact-sounds/Audio/impactWood_light_002.ogg (@600 ms -4 dB) | Kenney CC0 1.0 |
| heal_start_0.ogg | 5878 | Sonniss GDC 2024: InMotionAudio - Torn T-Shirt/CLOTHRip_CottonRips13_InMotionAudio_TornTShirt.wav (whole) | Sonniss GDC 2024 licence |
| heal_start_1.ogg | 11540 | Sonniss GDC 2024: InMotionAudio - Torn T-Shirt/CLOTHRip_CottonRips44_InMotionAudio_TornTShirt.wav (whole) | Sonniss GDC 2024 licence |
| heal_done_0.ogg | 4549 | Sonniss GDC 2024: InMotionAudio - Mask Foley/FOLYMisc_BluePPEMask_Elastic09_InMotionAudio_MaskFoley.wav (event 2 @1.11 s, elastic snap) | Sonniss GDC 2024 licence |
| heal_done_1.ogg | 9281 | Kenney: rpg-audio/Audio/clothBelt.ogg | Kenney CC0 1.0 |
| prop_break_0.ogg | 9475 | Sonniss GDC 2024: InMotionAudio - Wood/WOODBrk_Snap09_InMotionAudio_Wood.wav (0.28-1.00 s) + Kenney: impact-sounds/Audio/impactWood_heavy_000.ogg (@250 ms -3 dB) | Sonniss GDC 2024 licence + Kenney CC0 1.0 |
| prop_break_1.ogg | 5849 | Kenney: impact-sounds/Audio/impactWood_heavy_002.ogg + Kenney: impact-sounds/Audio/impactPlank_medium_003.ogg (@70 ms -3 dB) | Kenney CC0 1.0 |
| drop_open_0.ogg | 9819 | Kenney: rpg-audio/Audio/metalLatch.ogg + Sonniss GDC 2024: Mechanical Wave - Torturing Metal/METLCrsh_Drop Fall Metal Rattle Scrap Debris_06_MWSFX_TM.wav (whole @120 ms -4 dB) | Sonniss GDC 2024 licence + Kenney CC0 1.0 |
| drop_land_0.ogg | 6693 | Sonniss GDC 2024: Pole Position - The Metal Hit Sweeteners Library/Toolbox - DROP.wav (event 1) + Sonniss GDC 2024: Pole Position - The Metal Hit Sweeteners Library/Oil Barrel - HIT - Hammer - Take 2.wav (event 0 -6 dB) | Sonniss GDC 2024 licence |
| drop_land_1.ogg | 7446 | Sonniss GDC 2024: Pole Position - The Metal Hit Sweeteners Library/Toolbox - DROP.wav (event 5) + Sonniss GDC 2024: Pole Position - The Metal Hit Sweeteners Library/Oil Barrel - HIT - Hammer - Take 2.wav (event 3 -6 dB) | Sonniss GDC 2024 licence |
| body_fall_0.ogg | 6070 | Kenney: impact-sounds/Audio/impactSoft_heavy_000.ogg + Kenney: rpg-audio/Audio/cloth2.ogg (-6 dB) | Kenney CC0 1.0 |
| body_fall_1.ogg | 6113 | Kenney: impact-sounds/Audio/impactSoft_heavy_002.ogg + Kenney: rpg-audio/Audio/cloth2.ogg (-6 dB) | Kenney CC0 1.0 |
| hurt_thud_0.ogg | 5153 | Kenney: impact-sounds/Audio/impactPunch_medium_000.ogg | Kenney CC0 1.0 |
| hurt_thud_1.ogg | 5979 | Kenney: impact-sounds/Audio/impactPunch_medium_002.ogg | Kenney CC0 1.0 |
| weapon_drop_0.ogg | 4719 | Kenney: impact-sounds/Audio/impactMetal_light_003.ogg + Kenney: impact-sounds/Audio/impactSoft_medium_000.ogg (-3 dB) | Kenney CC0 1.0 |
| weapon_drop_1.ogg | 4123 | Kenney: impact-sounds/Audio/impactMetal_light_004.ogg + Kenney: impact-sounds/Audio/impactSoft_medium_002.ogg (-3 dB) | Kenney CC0 1.0 |
| smoke_pop_0.ogg | 4084 | Kenney: impact-sounds/Audio/impactTin_medium_000.ogg | Kenney CC0 1.0 |
| smoke_hiss_0.ogg | 35707 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRFizz_Fizzing Effervescent Tablets 03_JSE_WIM_Mono.wav (6.0-11.5 s, hp 1.8 kHz, 1.8 s fade) | Sonniss GDC 2024 licence |
| smoke_fade_0.ogg | 12998 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav (0.6-2.6 s, lp 2.5 kHz) | Sonniss GDC 2024 licence |
| scope_0.ogg | 4522 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 4 @4.43 s) | Sonniss GDC 2024 licence |
| scope_1.ogg | 4423 | Sonniss GDC 2024: Pole Position - Beretta 1201 F/Beretta 1201F - VAR SFX - Failed Racking Movements - MS Decoded - MKH418S.wav (event 13 @17.62 s) | Sonniss GDC 2024 licence |
| chute_open_0.ogg | 13681 | Sonniss GDC 2024: Pole Position - The Skydiving and Parachute Library/Parachutist - EXT - PARACHUTE DEPLOY - Distant 3 - RSM191.wav (0.15-1.60 s) | Sonniss GDC 2024 licence |
| chute_cut_0.ogg | 7080 | Kenney: rpg-audio/Audio/knifeSlice.ogg + Kenney: rpg-audio/Audio/cloth3.ogg (@50 ms -4 dB) | Kenney CC0 1.0 |
| launch_whoosh_0.ogg | 13208 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Pure SciFi-Whoosh Fast 03_RSCPC_DW.wav (whole) | Sonniss GDC 2024 licence |
| whiz_0.ogg | 4206 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav (1.55-1.66 s, hp 2 kHz) | Sonniss GDC 2024 licence |
| whiz_1.ogg | 4255 | Sonniss GDC 2024: Rescopic Sound - Distinct Whooshes/WHSH_Watery-Whoosh FIzzy Fast 03_RSCPC_DW.wav (1.20-1.31 s, hp 2 kHz) | Sonniss GDC 2024 licence |
| storm_surge_0.ogg | 18253 | Sonniss GDC 2024: Pole Position - Wind In Trees/Wind - Cherry Tree - Strong - Bed - On Ground - ORTF - CMC6.wav (70.0-72.6 s, lp 1.6 kHz, 0.6 s swell in, 1.2 s out) | Sonniss GDC 2024 licence |
| storm_surge_1.ogg | 18225 | Sonniss GDC 2024: Pole Position - Wind In Trees/Wind - Cherry Tree - Strong - Bed - On Ground - ORTF - CMC6.wav (110.0-112.6 s, lp 1.6 kHz, 0.6 s swell in, 1.2 s out) | Sonniss GDC 2024 licence |
| storm_zap_0.ogg | 6801 | Sonniss GDC 2024: BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_surge_discharge_electrical_arc_crackling_002_01.wav (0.40-0.85 s) | Sonniss GDC 2024 licence |
| storm_zap_1.ogg | 7691 | Sonniss GDC 2024: BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_texture_sizzling_crackling_006.wav (0.60-1.05 s) | Sonniss GDC 2024 licence |
| splash_0.ogg | 23520 | Sonniss GDC 2024: InMotionAudio - Submerge/WATRImpt_Impact20_InMotionAudio_Submerge.wav (whole) | Sonniss GDC 2024 licence |
| splash_1.ogg | 17332 | Sonniss GDC 2024: BluezoneCorp - Designed Water/Bluezone_BC0298_designed_water_impact_006.wav (0-1.9 s) | Sonniss GDC 2024 licence |
| swim_0.ogg | 11944 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRMvmt_Soft Movement 01_JSE_WIM.wav (event 1 5.09-5.99 s) | Sonniss GDC 2024 licence |
| swim_1.ogg | 11710 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRMvmt_Soft Movement 01_JSE_WIM.wav (event 2 9.14-10.04 s) | Sonniss GDC 2024 licence |
| swim_2.ogg | 11932 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRMvmt_Soft Movement 01_JSE_WIM.wav (event 3 13.12-14.02 s) | Sonniss GDC 2024 licence |
| swim_3.ogg | 10766 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRMvmt_Soft Movement 01_JSE_WIM.wav (event 4 17.34-18.24 s) | Sonniss GDC 2024 licence |
| uw_bed_0.ogg | 51136 | Sonniss GDC 2024: Justsoundeffects - Water in Motion/WATRUndwtr_Evolving Underwater Bubbles_JSE_WIM.wav (seamless 10 s loop from 28.5 s, lp 1.8 kHz) | Sonniss GDC 2024 licence |
| jump_0.ogg | 8278 | Kenney: rpg-audio/Audio/cloth1.ogg + Kenney: rpg-audio/Audio/beltHandle1.ogg (-8 dB) | Kenney CC0 1.0 |
| jump_1.ogg | 7350 | Kenney: rpg-audio/Audio/cloth3.ogg + Kenney: rpg-audio/Audio/beltHandle2.ogg (-8 dB) | Kenney CC0 1.0 |
| land_0.ogg | 6425 | Kenney: rpg-audio/Audio/footstep05.ogg + Kenney: rpg-audio/Audio/cloth2.ogg (-5 dB) | Kenney CC0 1.0 |
| land_1.ogg | 6336 | Kenney: rpg-audio/Audio/footstep06.ogg + Kenney: rpg-audio/Audio/cloth4.ogg (-5 dB) | Kenney CC0 1.0 |
| land_2.ogg | 8100 | Kenney: rpg-audio/Audio/footstep08.ogg + Kenney: rpg-audio/Audio/cloth1.ogg (-5 dB) | Kenney CC0 1.0 |
| land_hard_0.ogg | 9106 | Kenney: impact-sounds/Audio/impactPunch_heavy_000.ogg + Kenney: rpg-audio/Audio/footstep06.ogg (-2 dB) + Kenney: rpg-audio/Audio/clothBelt.ogg (-8 dB) | Kenney CC0 1.0 |
| land_hard_1.ogg | 9204 | Kenney: impact-sounds/Audio/impactPunch_heavy_003.ogg + Kenney: rpg-audio/Audio/footstep09.ogg (-2 dB) + Kenney: rpg-audio/Audio/clothBelt.ogg (-8 dB) | Kenney CC0 1.0 |
| mantle_0.ogg | 6290 | Kenney: impact-sounds/Audio/impactSoft_medium_001.ogg + Kenney: rpg-audio/Audio/cloth2.ogg (-4 dB) | Kenney CC0 1.0 |
| mantle_1.ogg | 6321 | Kenney: impact-sounds/Audio/impactSoft_medium_003.ogg + Kenney: rpg-audio/Audio/cloth2.ogg (-4 dB) | Kenney CC0 1.0 |
| slide_0.ogg | 8856 | Sonniss GDC 2024: InMotionAudio - Mask Foley/FOLYMisc_FabricMask_Movement06_InMotionAudio_MaskFoley.wav (0.3-1.05 s) + Kenney: rpg-audio/Audio/footstep03.ogg (-6 dB) | Sonniss GDC 2024 licence + Kenney CC0 1.0 |
| slide_1.ogg | 8929 | Sonniss GDC 2024: InMotionAudio - Mask Foley/FOLYMisc_FabricMask_Movement06_InMotionAudio_MaskFoley.wav (2.2-2.95 s) + Kenney: rpg-audio/Audio/footstep07.ogg (-6 dB) | Sonniss GDC 2024 licence + Kenney CC0 1.0 |
| slide_end_0.ogg | 6272 | Kenney: rpg-audio/Audio/footstep02.ogg + Kenney: rpg-audio/Audio/cloth4.ogg (-4 dB) | Kenney CC0 1.0 |
| ui_alert_0.ogg | 3494 | Kenney: interface-sounds/Audio/bong_001.ogg | Kenney CC0 1.0 |
| amb_forest_bed.ogg | 125342 | Sonniss GDC 2024: Justsoundeffects - Forest Ambiences/AMBForst_Spring Noon Deciduous Forest Gentle Wind Leaves Rustling Blackbird Raven in Background_JSE_FA.wav (seamless 20 s loop from 76.5 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
| amb_forest_wind.ogg | 102365 | Sonniss GDC 2024: Pole Position - Wind In Trees/Wind - Oak - Calm - Close - Inside Canopy - XY - MKH8060.wav (seamless 16 s loop from 78.0 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
| amb_tropical_bed.ogg | 123197 | Sonniss GDC 2024: Nick McMahan - Cascadia Shore Waves/WATRSurf_Ocean Medium to Large Rocks 02 Loop_Cascadia Shore Waves.wav (seamless 20 s loop from 65.5 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
| amb_tropical_wind.ogg | 103347 | Sonniss GDC 2024: Pole Position - Wind In Trees/Wind - Aspen - Gusts - Close - Inside Canopy - XY - MKH8060.wav (seamless 16 s loop from 65.5 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
| amb_savanna_bed.ogg | 130424 | Sonniss GDC 2024: Systematic Sound - General Ambience Series - Rural Countryside 01/AMBRurl_Field Wheat Dry Sizzle Insects Wind Soft_SYSO_SYSO011.wav (seamless 20 s loop from 119.5 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
| amb_savanna_wind.ogg | 103307 | Sonniss GDC 2024: Systematic Sound - General Ambience Series - Rural Countryside 01/AMBRurl_Meadow Open Plane Windy Deep Rumble_SYSO_SYSO011-1.wav (seamless 16 s loop from 212.5 s, 1.5 s equal-power seam) | Sonniss GDC 2024 licence |
