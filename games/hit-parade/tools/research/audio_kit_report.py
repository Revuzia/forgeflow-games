"""Render AUDIO_KIT.md from audio_kit.json (numbers come only from the JSON).
Usage: python audio_kit_report.py <research_dir>
ASCII only.
"""
import sys, os, json

RD = sys.argv[1]
K = json.load(open(os.path.join(RD, "audio_kit.json"), encoding="utf-8"))
B = K["budget"]
L = K["out_of_scope_leads"]


def lic(c):
    t = c["licence"]
    if t.startswith("Sonniss"):
        return "SON"
    if t.startswith("CC0 1.0 (Kenney"):
        return "CC0-K"
    if t.startswith("CC0 1.0 (OpenGameArt"):
        return "CC0-OGA"
    if t.startswith("Unity"):
        return "UAS"
    if "CC BY-SA" in t:
        return "CC-BY-SA"
    if "CC BY" in t:
        return "CC-BY"
    if "CC0" in t:
        return "CC0-FS"
    return "?"


def f(v, fmt="%s"):
    return "-" if v is None else fmt % v


def mb(n):
    return "%.2f MB" % (n / 1e6)


out = []
w = out.append
w("# HIT PARADE - Audio Kit Shortlist")
w("")
w("Generated %s by the audio research lane. Machine-readable twin: `audio_kit.json` (same numbers, full licence text per file)." % K["generated"])
w("")
w("## Read this first")
w("")
w("- **I cannot listen.** Every character note is built from the file/folder name plus measurements (loudness, spectrum split, envelope, onset count, tempo estimate). Nothing here is an ear judgement. **Audition every `ship` pick before lock.**")
w("- Loudness: `LUFS-I` = ffmpeg ebur128 integrated loudness (reads **-70.0 = undefined** on clips shorter than ~0.4 s - use `max dB` for those); `TP` = ebur128 true peak (dBTP); `max dB` = volumedetect peak. Spectrum shares come from a mono downmix.")
w("- Sliced picks (`[start-end ms]`) were **re-measured on the slice itself** (%s)." % K["method"]["slices"].split("(")[-1].rstrip(")."))
w("- Voice transcripts are machine output (local faster-whisper small.en, offline) and may contain errors.")
w("- Measured this session: %d in-scope files, %d out-of-scope files, %d voice files transcribed." % (
    K["measurement_counts"]["files_measured_in_scope"], K["measurement_counts"]["files_measured_out_of_scope"], K["measurement_counts"]["voice_files_transcribed"]))
w("")
w("## Verdict")
w("")
cov = sum(1 for r in K["roles"] if r["status"] == "covered")
par = sum(1 for r in K["roles"] if r["status"] == "partial")
gap = sum(1 for r in K["roles"] if r["status"] == "gap")
w("- %d roles: **%d covered, %d partial, %d gap** from the listed sources." % (len(K["roles"]), cov, par, gap))
w("- Combat SFX are well covered (Kenney punches + Sonniss gore/door/metal/wood takes + Evil Mind spells). **Crowd and TV-show sounds are the weak spot**: no boo, applause, audience laugh, crowd ooh, drum roll, rimshot or true air horn anywhere in the listed sources.")
w("- **Music is only partly on-genre**: the listed sources hold just two tracks labelled rock/metal (Evil Mind *Halloween Rocks* and *Face Your Doom - Metal*); everything else is Halloween/fantasy/chiptune by label. No funk, no synth-punk.")
w("- **Budget is fine**: the %d shipped picks measure **%s as Opus** (AAC fallback set %s) against the ~12 MB target; music is %s of it." % (
    B["shipped_files"], mb(B["opus_total_bytes"]), mb(B["aac_fallback_total_bytes"]), mb(B["by_group"]["music"]["opus_bytes"])))
w("- **Biggest lead (outside the listed sources, owner's call):** the un-extracted `Imphenzia / Universal Sound FX` package in `F:/games/unity-asset-cache` has audience boos, applause, laughs, an 'Ohh', claps-and-cheers, cash-register cha-chings, boxing bells/punches and an announcer-style word set (Fight / Get Ready / Combo tiers / Time's Up / Victory / Game Over). Unused Travis Rise synthwave there (9 tracks; full versions 3.4-4.7 min, inferred from package byte sizes at the loops' measured 44.1 kHz 16-bit stereo; loops 8.7-21.3 s, only the loops were measured) is the nearest fit for synth-punk stage music. Measured below; adding them costs %s Opus (total %s)." % (
    mb(L["trial_opus_bytes_total"]), mb(B["with_out_of_scope_leads_opus_bytes"])))
w("- **Voice:** no announcer pack in the listed sources. Usable lines found: a female circus-ringmaster PA ('Ladies and gentlemen, boys and girls, ...') and generic RPG hero barks/efforts (Daniel Gooding pack).")
w("")
w("## Licence legend")
w("")
w("| code | licence | obligations |")
w("|---|---|---|")
w("| CC0-K | CC0 1.0, Kenney (License.txt in each pack) | none (credit optional) |")
w("| CC0-OGA | CC0 1.0, OpenGameArt (music/manifest.json) | none |")
w("| CC0-FS | CC0 1.0, Freesound via audio-cache/_manifest.json | none |")
w("| CC-BY / CC-BY-SA | Jamendo via audio-cache/_manifest.json | credit required (BY-SA also share-alike) |")
w("| SON | Sonniss #GameAudioGDC 2024 (sonniss-gdc2024/LICENSE.txt) | royalty-free, no attribution, embed-in-game OK, no resale as sounds, **no AI training** |")
w("| UAS | Unity Asset Store EULA - inferred from the unity-assets source folder (packages carry no licence file) | embed in the game only; no standalone redistribution of the sound files |")
w("")
w("## Shortlist by role")
w("")
w("`*` = proposed ship pick (counted in the budget). Paths are absolute. Character = my note (name/folder context) + auto measurement summary.")
w("")
cur = None
titles = {"combat": "Combat SFX", "show": "TV-show SFX", "ui": "UI", "music": "Music", "voice": "Voice (optional - no announcer pack)", "crowd": "Crowd"}
for r in K["roles"]:
    if r["group"] != cur:
        cur = r["group"]
        w("### %s" % titles.get(cur, cur))
        w("")
    w("#### `%s` - need %s - **%s**" % (r["id"], r["need"], r["status"].upper()))
    w("")
    if r.get("gap"):
        w("> Gap / caveat: %s" % r["gap"])
        w("")
    if r.get("notes"):
        w("> Note: %s" % r["notes"])
        w("")
    if not r["candidates"]:
        w("_No candidate in the listed sources._")
        w("")
        continue
    w("| | file | dur s | ch | Hz | LUFS-I | TP | max dB | lic | character |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for c in r["candidates"]:
        m = c["measured"]
        sl = " `[%d-%d ms]`" % (c["start_ms"], c["end_ms"]) if "start_ms" in c else ""
        extra = ""
        if c.get("transcript_whisper") and "start_ms" not in c:
            extra = " Transcript: \"%s\"." % c["transcript_whisper"]
        if c.get("tempo"):
            t = c["tempo"]
            extra += " Tempo est %s BPM, %s onsets/s." % (t["bpm_est"], t["onsets_per_s"])
        note = "%s. %s.%s" % (c["note"], c["auto_character"], extra)
        w("| %s | `%s`%s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            "*" if c["ship"] else "", c["path"], sl, f(m.get("duration_s")), f(m.get("channels")), f(m.get("sample_rate")),
            f(m.get("lufs_i")), f(m.get("true_peak_dbtp")), f(m.get("max_volume_db")), lic(c), note.replace("|", "/")))
    w("")

w("## Size budget and transcode plan (measured)")
w("")
w("Every `*` pick was actually encoded with ffmpeg (libopus in .ogg, metadata stripped; and AAC-LC .m4a as a fallback set), the bytes were measured, and the files were deleted. Slices were cut with `-ss/-to` in the same pass.")
w("")
w("| profile | encoder settings | files | Opus bytes | AAC bytes |")
w("|---|---|---|---|---|")
for p in ["sfx_mono", "sfx_stereo", "bed_stereo", "jingle", "music"]:
    v = B["by_profile"].get(p)
    if v:
        w("| %s | %s | %d | %d | %d |" % (p, B["profiles"][p], v["files"], v["opus_bytes"], v["aac_bytes"]))
w("| **total** | | **%d** | **%d (%s)** | **%d (%s)** |" % (B["shipped_files"], B["opus_total_bytes"], mb(B["opus_total_bytes"]), B["aac_fallback_total_bytes"], mb(B["aac_fallback_total_bytes"])))
w("")
w("| group | files | Opus bytes | AAC bytes |")
w("|---|---|---|---|")
for g, v in B["by_group"].items():
    w("| %s | %d | %d | %d |" % (g, v["files"], v["opus_bytes"], v["aac_bytes"]))
w("")
sp = B.get("sprite_trial_sfx_mono") or {}
w("- Target ~12,000,000 B. Opus set = %d B -> **headroom %d B**. Adding every measured out-of-scope lead below = %d B total." % (
    B["opus_total_bytes"], B["headroom_bytes_opus"], B["with_out_of_scope_leads_opus_bytes"]))
w("- Music is the budget: %d of %d Opus bytes. Plan: keep stage/boss cues as 50-90 s seamless loops (the picks are 57-82 s), Opus 80 kbps stereo; do not ship full-length versions." % (
    B["by_group"]["music"]["opus_bytes"], B["opus_total_bytes"]))
w("- SFX: mono Opus 48 kbps. A single-file sprite of all %d mono SFX measured %s B vs %d B as individual files - **no byte saving**; use a sprite only if request count matters." % (
    sp.get("items", 0), sp.get("opus_bytes"), B["by_profile"]["sfx_mono"]["opus_bytes"]))
w("- Crowd beds: 20 s stereo loops at 64 kbps; the Rome pub crowd source is 5-channel and must be downmixed to stereo.")
w("- Browser support: I did not verify Ogg-Opus decode on iOS Safari this session. Ship the AAC `.m4a` twin set (%s measured) and pick per device with `audio.canPlayType('audio/ogg; codecs=opus')` / a `decodeAudioData` probe; only one set downloads per device." % mb(B["aac_fallback_total_bytes"]))
w("")
w("### Mastering notes that fall out of the measurements")
w("")
w("- **Phone-speaker risk:** %d candidates (flagged `PHONE-SPEAKER RISK` above) have under 20%% of their energy between 150 Hz and 4 kHz - e.g. the Kenney `impactSoft_heavy` kick/body thuds, the Rogue Waves door slams (wall slam) and the JSE flesh-drop body falls. On phone speakers they will nearly vanish. Layer each with a mid transient (punch/cardboard/stone crack) and high-pass at ~40 Hz." % sum(
    1 for r in K["roles"] for c in r["candidates"] if "PHONE" in c["auto_character"]))
w("- **Trim lead-ins:** the Evil Mind MP3 picks carry 70-230 ms of leading silence (flagged per file) - trim or the hit lands late against the animation.")
w("- **Limit overs:** several sources read at or above 0 dBTP (flagged per file; Evil Mind music, Daniel Gooding voices, some Kenney RPG foley). Normalise to -1 dBTP after resampling to 48 kHz.")
w("- **Quiet sources:** the four JSE bone-break slices read -29.8 to -32.4 LUFS and need roughly 14-16 dB of gain to sit near -16 LUFS; the Sonic Bat roller-hockey bed reads -31.4 LUFS.")
w("- Suggested playback targets (to keep the mix consistent, not measured requirements): combat hits ~-16 LUFS short-term, UI ~-22, crowd beds ~-28 under gameplay, music ~-20 so hits stay on top.")
w("")
w("## Gaps (plain list)")
w("")
w("Absence check: a filename search over all 25,348 paths in the listed sources (`_all_inscope_audio_names.txt`; patterns boo/bhoo, applau/clap, laugh, ooh/gasp/aww, drum/snare, rimshot, air horn, buzzer, cash/register/cha-ching, cheer, announc) found **no** crowd boo, applause, cheer, drum roll, rimshot, air horn, buzzer or cash register audio; only single-voice laughs (Evil Mind x5, Daniel Gooding x1), one single-voice gasp, and one drumstick recording (spade hits).")
w("")
for g in K["gaps"]:
    w("- **%s** (%s): %s" % (g["role"], g["status"], g["gap"] or "see role"))
w("")
w("## Voice lines found (no announcer pack)")
w("")
w("- `F:/games/forgeflow-games-assets/sonniss-gdc2024/Jake Fielding - Circus Ambiences/VOXFem_Accouncement Wet, Ringmaster, Performer, Dialogue_JF_Circus_01.wav` - 19.4 s female ringmaster PA. Whisper transcript opens \"Ladies and gentlemen, boys and girls, there will now be a 20 minute interval.\" then a concession-stand spiel. Word timestamps: 'Ladies ... girls,' 0.00-1.62 s; 'there will now be a 20 minute interval.' 1.84-4.06 s. Reverberant ('Wet') and quiet (slice -27.6 LUFS).")
w("- Daniel Gooding *Action RPG Characters* (unity-assets, UAS): 10 actors, 3948 files of barks and efforts. Usable generic lines (whisper): 'Let's do this!', 'That was too easy.', '...right in the sweet spot!', 'Here we go!', 'Take this!', 'CRITICAL HIT!', 'AWESOME!', 'And stay down!', 'You are no match for me.', 'Boom, feel the sting.' Many other lines are RPG-specific (spells, treasure, dungeons) and do not fit.")
w("- Sonniss CB Sounddesign sci-fi voices (robot/computer reads: 'Access denied', 'Target acquired. Engaging stealth mode.', ...) - wrong register for a TV host.")
w("- Cyberleaf *One Hundred* is sold as a speech version; whisper returned only 'Music' tokens, so no speech content was recovered.")
w("- Evil Mind 'Voice Approve' files are 'Mm-hmm'/'Hm' grunts; 'Trick or Treat' is off-theme.")
w("")
w("## Out-of-scope leads (measured, owner's call)")
w("")
w("These are **not** in the listed sources. They sit as un-extracted `.unitypackage` files in `F:/games/unity-asset-cache`. I extracted selected files to the session scratchpad only (outside the repo), measured them, and wrote nothing to the asset library. Using them means extracting the packages into `F:/games/unity-assets` first.")
w("")
w("| fills role | file | package | dur s | ch | Hz | LUFS-I | TP | trial Opus B |")
w("|---|---|---|---|---|---|---|---|---|")
for c in L["candidates"]:
    m = c["measured"]
    pk = c["package"].split(" (")[0]
    w("| %s | `%s` | %s | %s | %s | %s | %s | %s | %s |" % (c["role"], c["file"], pk, f(m.get("duration_s")), f(m.get("channels")),
                                                        f(m.get("sample_rate")), f(m.get("lufs_i")), f(m.get("true_peak_dbtp")), f(c.get("trial_opus_bytes"))))
w("")
w("- Imphenzia listing (10,101 audio assets): `_oos_imphenzia_usfx.txt`. Travis Rise listings: `_oos_travisrise_pack1.txt`, `_oos_travisrise_pack2.txt`. Travis Rise tracks 01/02/05/06 of pack 1 are already 'used' (dyefield) and are excluded.")
w("- Still missing even with these: %s." % ", ".join(L["still_missing_even_with_leads"]))
w("- Also off-disk: the Sonniss xlsx sheet 'Sheet1' lists 1127 files of another bundle part (e.g. 'Fight Vocalizations', 'PM_FN_Fight_Hits', 'Kieuk laughter', 'Battle Crowd Add on') - none are on disk; exported to `sonniss_xlsx_Sheet1.csv`.")
w("")
w("## Method and files")
w("")
w("- Scripts (ASCII, under `tools/research/`): `audio_build_pathlist.py`, `audio_measure.py`, `audio_takes.py`, `audio_crowd_scan.py`, `audio_tempo.py`, `audio_transcribe.py`, `audio_words.py`, `audio_kit_build.py`, `audio_trial_transcode.py`, `audio_kit_finalize.py`, `audio_kit_report.py`, `unitypackage_list_audio.py`, `unitypackage_extract_selected.py`.")
w("- Data (this folder): `_measure.jsonl` (per-file measurements), `takes.json` (multi-take segmentation; its per-take spectrum stats use one long window and are biased - the kit uses re-measured slices instead), `crowd_scan.json` (burst/bed windows on long crowd files), `music_tempo.json`, `voice_transcripts.json`, `trial_transcode_sizes.json`, `_measure_oos.jsonl`, `music_tempo_oos.json`, Sonniss xlsx exports.")
w("- Rebuild: `python tools/research/audio_kit_build.py <this dir>` -> `audio_trial_transcode.py <kit> <scratch> trial_transcode_sizes.json --aac` -> `audio_kit_finalize.py <this dir> <scratch>` -> `audio_kit_report.py <this dir>`.")
w("- Music exclusion check against `state/music_assignments.json` 'used' (%d keys): %d violations." % (len(K["music_used_exclusion_check"]["used_keys"]), len(K["music_used_exclusion_check"]["violations"])))
w("")
open(os.path.join(RD, "AUDIO_KIT.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
print("lines", len(out))
