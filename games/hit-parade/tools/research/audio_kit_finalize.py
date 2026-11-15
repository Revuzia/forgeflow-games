"""Finalize audio_kit.json: add budget (measured trial transcodes), gaps summary,
out-of-scope leads (measured from scratch extracts), sources and exclusions.
Usage: python audio_kit_finalize.py <research_dir> <scratch_dir>
ASCII only.
"""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audio_trial_transcode import enc, PROFILES, AAC

RD, SC = sys.argv[1], sys.argv[2]
kit = json.load(open(os.path.join(RD, "audio_kit.json"), encoding="utf-8"))
tt = json.load(open(os.path.join(RD, "trial_transcode_sizes.json"), encoding="utf-8"))
oos = {}
for l in open(os.path.join(RD, "_measure_oos.jsonl"), encoding="utf-8"):
    r = json.loads(l)
    oos[os.path.basename(r["path"])] = r
tempo_oos = json.load(open(os.path.join(RD, "music_tempo_oos.json"), encoding="utf-8"))
used = json.load(open("C:/Users/TestRun/Claude Claw/state/music_assignments.json", encoding="utf-8"))["used"]

# ---- exclusion check: no shipped/candidate music may be in "used"
viol = []
for r in kit["roles"]:
    for c in r["candidates"]:
        b = os.path.basename(c["path"])
        for u in used:
            ub = u.split("/")[-1]
            if b == ub or (("Travis Rise" in u) and ub in c["path"]):
                viol.append((r["id"], c["path"], u))
kit["music_used_exclusion_check"] = {"used_keys": list(used.keys()), "violations": viol}

# ---- budget from measured trial transcodes
grp = {r["id"]: r["group"] for r in kit["roles"]}
by_group, by_prof = {}, {}
for x in tt["files"]:
    g = grp[x["role"]]
    by_group.setdefault(g, {"files": 0, "opus_bytes": 0, "aac_bytes": 0})
    by_group[g]["files"] += 1
    by_group[g]["opus_bytes"] += x["opus_bytes"] or 0
    by_group[g]["aac_bytes"] += x.get("aac_bytes") or 0
    p = x["profile"]
    by_prof.setdefault(p, {"files": 0, "opus_bytes": 0, "aac_bytes": 0})
    by_prof[p]["files"] += 1
    by_prof[p]["opus_bytes"] += x["opus_bytes"] or 0
    by_prof[p]["aac_bytes"] += x.get("aac_bytes") or 0
tot_o = sum(x["opus_bytes"] or 0 for x in tt["files"])
tot_a = sum(x.get("aac_bytes") or 0 for x in tt["files"])

# ---- out-of-scope leads (measured); propose a ship list and trial-transcode it
IMP = "Imphenzia / Universal Sound FX (F:/games/unity-asset-cache/Imphenzia/AudioSound FX/Universal Sound FX.unitypackage - NOT extracted into unity-assets)"
TR1 = "Travis Rise / SynthWave Music Pack (F:/games/unity-asset-cache/Travis Rise/AudioMusicElectronic/SynthWave Music Pack.unitypackage; tracks 01,02,05,06 are 'used' by dyefield - these are not)"
TR2 = "Travis Rise / SynthWave Music Pack 2 (F:/games/unity-asset-cache/Travis Rise/AudioMusicElectronic/SynthWave Music Pack 2.unitypackage; no track used)"
LEADS = [
    ("crowd_boo", ["AUDIENCE_Bhoos_01_stereo.wav", "AUDIENCE_Bhoos_04_stereo.wav", "AUDIENCE_Bhoos_06_Short_stereo.wav", "AUDIENCE_Claps_and_Bhoos_01_stereo.wav"], "sfx_stereo", IMP),
    ("crowd_applause", ["AUDIENCE_Clapping_Hall_03_stereo.wav", "AUDIENCE_Clapping_Hall_06_loop_stereo.wav", "AUDIENCE_Claps_Multi_02_stereo.wav"], "sfx_stereo", IMP),
    ("crowd_cheer_burst", ["AUDIENCE_Claps_and_Cheers_05_stereo.wav", "AUDIENCE_Claps_and_Cheers_07_stereo.wav", "AUDIENCE_Claps_and_Cheers_13_stereo.wav"], "sfx_stereo", IMP),
    ("crowd_cheer_loop", ["CROWD_Cheer_On_01_mono_loop.wav", "AUDIENCE_Stomp_Stomp_Clap_loop_stereo.wav", "AUDIENCE_Claps_and_Stomp_Loop_01_stereo.wav"], "bed_stereo", IMP),
    ("crowd_gasp_ooh", ["AUDIENCE_Ohh_01_stereo.wav", "AUDIENCE_Ouch_Claps_stereo.wav"], "sfx_stereo", IMP),
    ("crowd_laugh", ["AUDIENCE_Hahaha_02_stereo.wav", "AUDIENCE_Hahaha_03_stereo.wav", "AUDIENCE_Claps_Laugh_Increase_01_stereo.wav"], "sfx_stereo", IMP),
    ("cash_register", ["CASH_REGISTER_Cha-ching_02_mono.wav", "CASH_REGISTER_Cha-ching_05_mono.wav"], "sfx_mono", IMP),
    ("bell_ding", ["BOXING_Bell_3_Rings_02_mono.wav", "BOXING_Bell_Ring_01_mono.wav"], "sfx_mono", IMP),
    ("punch_light", ["BOXING_Jab_03_mono.wav", "BOXING_Jab_05_mono.wav", "BOXING_Jab_06_mono.wav"], "sfx_mono", IMP),
    ("punch_heavy", ["BOXING_Punch_02_mono.wav", "BOXING_Punch_06_mono.wav", "BOXING_Punch_10_mono.wav"], "sfx_mono", IMP),
    ("voice_announcer", ["VOICE_MALE_Get_Ready_1_Aggressive_mono.wav", "VOICE_MALE_Fight_3_Aggressive_mono.wav", "VOICE_MALE_Combo_Triple_mono.wav",
                         "VOICE_MALE_Combo_Mega_mono.wav", "VOICE_MALE_Combo_Monster_Aggressive_mono.wav", "VOICE_MALE_Time's_Up_1_mono.wav",
                         "VOICE_MALE_Victory_2_Aggressive_mono.wav", "VOICE_MALE_Game_Over_2_Aggressive_mono.wav"], "sfx_mono", IMP),
    ("music_stage", ["02_TR_Outbreak_LOOP_01.wav", "03_TR_Disorder_LOOP_01.wav", "04_TR_Anxiety_LOOP_01.wav", "05_TR_Chasm_LOOP_01.wav",
                     "WAV_TR_07_RETROWAVE_LOOP_01.wav", "04_TR_ElectricPhase_LOOP_01.wav"], "music", None),
]
leads = []
lead_bytes_o = lead_bytes_a = 0
tmp = os.path.join(SC, "trial_oos")
os.makedirs(tmp, exist_ok=True)
for rid, files, prof, src in LEADS:
    for i, b in enumerate(files):
        m = oos[b]
        s = src or (TR2 if re.match(r"0[1-6]_TR_(Beginning|Outbreak|Disorder|Anxiety|Chasm|Arrival)", b) else TR1)
        d = {"role": rid, "file": b, "package": s, "licence": "Unity Asset Store EULA (inferred from source; no licence file)",
             "measured": {k: m.get(k) for k in ["duration_s", "channels", "sample_rate", "lufs_i", "true_peak_dbtp", "max_volume_db",
                                                 "mean_volume_db", "centroid_hz", "band_lt150", "band_150_1k", "band_1k_4k", "band_gt4k", "flatness", "transients"]},
             "note": "filename-derived content (cannot listen)"}
        tp = tempo_oos.get(m["path"])
        if tp:
            d["tempo"] = tp
        dst = os.path.join(tmp, "o.ogg")
        n, err = enc(m["path"], dst, prof)
        if os.path.exists(dst):
            os.remove(dst)
        dst2 = os.path.join(tmp, "o.m4a")
        n2, err2 = enc(m["path"], dst2, prof, table=AAC)
        if os.path.exists(dst2):
            os.remove(dst2)
        d["trial_opus_bytes"], d["trial_aac_bytes"], d["profile"] = n, n2, prof
        lead_bytes_o += n or 0
        lead_bytes_a += n2 or 0
        leads.append(d)

kit["out_of_scope_leads"] = {
    "why": "Found while checking the gaps: these packages sit in F:/games/unity-asset-cache (NOT in the listed sources and NOT extracted into F:/games/unity-assets). Selected files were extracted to the session scratchpad only (outside the repo) and measured; nothing was written to the asset library. Using them needs the owner/orchestrator to extract the packages into F:/games/unity-assets first.",
    "imphenzia_listing": "_oos_imphenzia_usfx.txt (10101 audio assets, pathname + size)",
    "travis_listings": ["_oos_travisrise_pack1.txt", "_oos_travisrise_pack2.txt"],
    "candidates": leads,
    "trial_opus_bytes_total": lead_bytes_o,
    "trial_aac_bytes_total": lead_bytes_a,
    "still_missing_even_with_leads": ["drum roll", "rimshot", "air horn (true)", "buzzer by name", "funk / gritty rock music", "TV-show brass stings"],
}

kit["budget"] = {
    "target_bytes": 12000000,
    "method": "every shipped candidate (ship=true) trial-encoded with ffmpeg (libopus in .ogg, metadata stripped) and AAC-LC .m4a; bytes measured then files deleted",
    "profiles": {"sfx_mono": "Opus mono 48 kHz 48 kbps VBR", "sfx_stereo": "Opus stereo 48 kHz 64 kbps VBR", "bed_stereo": "Opus stereo 48 kHz 64 kbps VBR",
                 "music": "Opus stereo 48 kHz 80 kbps VBR", "jingle": "Opus stereo 48 kHz 96 kbps VBR",
                 "aac_fallback": "AAC-LC 44.1 kHz: 64k mono sfx / 96k stereo sfx+beds / 112k music / 128k jingles"},
    "shipped_files": len(tt["files"]),
    "opus_total_bytes": tot_o,
    "aac_fallback_total_bytes": tot_a,
    "by_group": by_group,
    "by_profile": by_prof,
    "sprite_trial_sfx_mono": tt.get("sprite_sfx_mono"),
    "sprite_vs_individual_note": "sprite bytes vs sum of individual sfx_mono files: %s vs %d" % (
        (tt.get("sprite_sfx_mono") or {}).get("opus_bytes"), by_prof.get("sfx_mono", {}).get("opus_bytes", 0)),
    "headroom_bytes_opus": 12000000 - tot_o,
    "with_out_of_scope_leads_opus_bytes": tot_o + lead_bytes_o,
}

gaps = []
for r in kit["roles"]:
    if r["status"] in ("gap", "partial"):
        gaps.append({"role": r["id"], "status": r["status"], "gap": r.get("gap")})
kit["gaps"] = gaps
kit["sources_surveyed"] = [
    {"path": "F:/games/forgeflow-games-assets/impact-sounds", "what": "Kenney Impact Sounds 1.0", "files": 130, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/interface-sounds", "what": "Kenney Interface Sounds 1.0", "files": 100, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/rpg-audio", "what": "Kenney RPG Audio", "files": 52, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/_downloaded/ui-audio", "what": "Kenney UI SFX Set (different pack from rpg-audio: 0 md5 overlaps)", "files": 52, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/_downloaded/impact-sounds + interface-sounds", "what": "byte-identical copies of the two Kenney packs above (sorted md5 lists equal)", "files": 230, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/music", "what": "OpenGameArt CC0 music; 6 of 8 already 'used'; game_over.ogg + victory.ogg free", "files": 8, "licence": "CC0"},
    {"path": "F:/games/forgeflow-games-assets/_downloaded/audio-cache", "what": "3 music (Jamendo CC BY 3.0, CC BY-SA 3.0; oga_epic_menu.ogg is byte-identical to used cinematic_epic.ogg) + 8 Freesound CC0 sfx (2 duplicate pairs)", "files": 11, "licence": "mixed, see manifest"},
    {"path": "F:/games/forgeflow-games-assets/sonniss-gdc2024", "what": "609 WAV on disk; xlsx sheet 'Copy of Sheet1' = these 609; sheet 'Sheet1' = 1127 files of another bundle part, 0 on disk", "files": 609, "licence": "Sonniss GDC bundle licence"},
    {"path": "F:/games/unity-assets", "what": "13 packages with audio, 4699 files (3948 = Daniel Gooding voice pack)", "files": 4699, "licence": "Unity Asset Store EULA"},
]
kit["measurement_counts"] = {"files_measured_in_scope": sum(1 for _ in open(os.path.join(RD, "_measure.jsonl"), encoding="utf-8")),
                             "files_measured_out_of_scope": len(oos),
                             "voice_files_transcribed": len(json.load(open(os.path.join(RD, "voice_transcripts.json"), encoding="utf-8")))}
json.dump(kit, open(os.path.join(RD, "audio_kit.json"), "w", encoding="utf-8"), indent=1)
print("violations", viol)
print("opus", tot_o, "aac", tot_a, "leads opus", lead_bytes_o, "leads aac", lead_bytes_a, "with leads", tot_o + lead_bytes_o)
print("gaps", len(gaps))
