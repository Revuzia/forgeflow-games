"""Build the HIT PARADE audio kit shortlist (audio_kit.json) from measured data.

Usage: python audio_kit_build.py <research_dir>
Inputs in <research_dir>: _measure.jsonl, takes.json, crowd_scan.json,
voice_transcripts.json, music_tempo.json.
Candidates are declared below by a regex that must match exactly ONE measured
path (fails loudly otherwise). Sliced candidates (start_ms/end_ms) are
re-measured on the slice itself with ffmpeg (ebur128 + volumedetect + a numpy
spectral pass). Output: <research_dir>/audio_kit.json . ASCII only.
"""
import sys, os, re, json, subprocess
import numpy as np

RD = sys.argv[1]
MEAS = {}
for l in open(os.path.join(RD, "_measure.jsonl"), encoding="utf-8"):
    r = json.loads(l)
    MEAS[r["path"]] = r
PATHS = sorted(MEAS)
CROWD = json.load(open(os.path.join(RD, "crowd_scan.json"), encoding="utf-8")) if os.path.exists(os.path.join(RD, "crowd_scan.json")) else {}
VOICE = json.load(open(os.path.join(RD, "voice_transcripts.json"), encoding="utf-8"))
TEMPO = json.load(open(os.path.join(RD, "music_tempo.json"), encoding="utf-8"))


def P(rx):
    m = [p for p in PATHS if re.search(rx, p)]
    if len(m) != 1:
        raise SystemExit("regex %r matched %d paths: %s" % (rx, len(m), m[:5]))
    return m[0]


def C(rx, note, ship=False, s=None, e=None, profile=None):
    d = {"path": P(rx), "note": note, "ship": ship}
    if s is not None:
        d["start_ms"] = s
        d["end_ms"] = e
    if profile:
        d["profile"] = profile
    return d


def licence(path):
    if "/sonniss-gdc2024/" in path:
        return "Sonniss #GameAudioGDC 2024 licence: royalty-free, commercial OK, no attribution, embed in game OK, no resale as sounds, NO AI training (sonniss-gdc2024/LICENSE.txt)"
    if re.search(r"/(impact-sounds|interface-sounds|rpg-audio)/|/_downloaded/ui-audio/", path):
        return "CC0 1.0 (Kenney; License.txt in pack folder)"
    if "/forgeflow-games-assets/music/" in path:
        return "CC0 1.0 (OpenGameArt; music/manifest.json)"
    if "/audio-cache/" in path:
        man = json.load(open("F:/games/forgeflow-games-assets/_downloaded/audio-cache/_manifest.json", encoding="utf-8"))
        v = man.get(os.path.basename(path), {})
        return "%s (%s, '%s' by %s; audio-cache/_manifest.json)%s" % (
            v.get("license"), v.get("source"), v.get("title"), v.get("author"),
            " - ATTRIBUTION REQUIRED" if "BY" in str(v.get("license")) else "")
    if "/unity-assets/" in path:
        return "Unity Asset Store EULA (no licence file in package; embed-in-game use, no standalone redistribution) - inferred from source folder"
    return "unknown"


def source(path):
    for k, v in [("/sonniss-gdc2024/", "Sonniss GDC 2024 / " ), ("/impact-sounds/", "Kenney Impact Sounds"),
                 ("/interface-sounds/", "Kenney Interface Sounds"), ("/rpg-audio/", "Kenney RPG Audio"),
                 ("/ui-audio/", "Kenney UI SFX Set"), ("/forgeflow-games-assets/music/", "OpenGameArt CC0 music"),
                 ("/audio-cache/", "audio-cache (Freesound/Jamendo/OGA)")]:
        if k in path:
            if k == "/sonniss-gdc2024/":
                return v + path.split("/sonniss-gdc2024/")[1].split("/")[0]
            return v
    if "/unity-assets/" in path:
        return "Unity: " + path.split("/unity-assets/")[1].split("/")[0].replace("__", " / ")
    return "?"


def run(cmd, binary=False):
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.stdout if binary else p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def measure_slice(path, s, e):
    ss, to = "%.3f" % (s / 1000.0), "%.3f" % (e / 1000.0)
    _, err = run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-ss", ss, "-to", to, "-i", path,
                  "-af", "ebur128=peak=true,volumedetect", "-f", "null", "-"])
    out = {}
    summ = err[err.rfind("Summary:"):] if "Summary:" in err else ""
    m = re.search(r"I:\s+(-?[\d.]+)\s+LUFS", summ)
    out["lufs_i"] = float(m.group(1)) if m else None
    m = re.search(r"Peak:\s+(-?[\d.]+|-inf)\s+dBFS", summ)
    out["true_peak_dbtp"] = float(m.group(1)) if m and "inf" not in m.group(1) else None
    m = re.search(r"mean_volume:\s+(-?[\d.]+) dB", err)
    out["mean_volume_db"] = float(m.group(1)) if m else None
    m = re.search(r"max_volume:\s+(-?[\d.]+) dB", err)
    out["max_volume_db"] = float(m.group(1)) if m else None
    raw, _ = run(["ffmpeg", "-nostdin", "-v", "error", "-ss", ss, "-to", to, "-i", path, "-ac", "1", "-ar", "44100",
                  "-f", "f32le", "-"], binary=True)
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    if len(x) > 1024:
        n = 2048
        seg = np.pad(x, (0, max(0, n - len(x))))
        step = 1024
        k = 1 + (len(seg) - n) // step
        spec = np.zeros(n // 2 + 1)
        for i in range(k):
            spec += np.abs(np.fft.rfft(seg[i * step:i * step + n] * np.hanning(n))) ** 2
        f = np.fft.rfftfreq(n, 1 / 44100.0)
        t = spec.sum() + 1e-18
        out["centroid_hz"] = int((spec * f).sum() / t)
        out["band_lt150"] = round(float(spec[f < 150].sum() / t), 3)
        out["band_150_1k"] = round(float(spec[(f >= 150) & (f < 1000)].sum() / t), 3)
        out["band_1k_4k"] = round(float(spec[(f >= 1000) & (f < 4000)].sum() / t), 3)
        out["band_gt4k"] = round(float(spec[f >= 4000].sum() / t), 3)
        ps = spec[1:] + 1e-18
        out["flatness"] = round(float(np.exp(np.mean(np.log(ps))) / np.mean(ps)), 4)
    out["duration_s"] = round((e - s) / 1000.0, 3)
    return out


KEEP = ["duration_s", "channels", "sample_rate", "codec", "size_bytes", "lufs_i", "true_peak_dbtp", "mean_volume_db",
        "max_volume_db", "centroid_hz", "band_lt150", "band_150_1k", "band_1k_4k", "band_gt4k", "flatness",
        "onset_ms", "decay30_ms", "transients", "lead_silence_ms", "env100_spread_db", "lra_lu"]


def auto_desc(m):
    bits = []
    lt, lo, mid, hi = (m.get("band_lt150") or 0), (m.get("band_150_1k") or 0), (m.get("band_1k_4k") or 0), (m.get("band_gt4k") or 0)
    if lt >= 0.6:
        bits.append("sub/low-heavy (%.0f%% <150 Hz)" % (lt * 100))
    elif lo >= 0.6:
        bits.append("low-mid body (%.0f%% 150-1k)" % (lo * 100))
    elif hi >= 0.5:
        bits.append("bright top (%.0f%% >4 kHz)" % (hi * 100))
    elif mid >= 0.5:
        bits.append("mid-forward (%.0f%% 1-4k)" % (mid * 100))
    else:
        bits.append("broadband")
    fl = m.get("flatness")
    if fl is not None:
        if fl >= 0.2:
            bits.append("noise-like (flatness %.2f)" % fl)
    tp = m.get("true_peak_dbtp")
    if tp is not None and tp > -0.1:
        bits.append("true peak %+.1f dBTP -> needs limiting" % tp)
    L = m.get("lufs_i")
    if L is not None and L > -69 and L < -30:
        bits.append("quiet source (%.1f LUFS) -> needs gain" % L)
    ph = (m.get("band_150_1k") or 0) + (m.get("band_1k_4k") or 0)
    if lt >= 0.6 and ph < 0.2:
        bits.append("PHONE-SPEAKER RISK: only %.0f%% of energy in 150 Hz-4 kHz" % (ph * 100))
    ls = m.get("lead_silence_ms") or 0
    if ls >= 60:
        bits.append("%d ms lead-in -> trim" % ls)
    return "; ".join(bits)


# ---------------------------------------------------------------- the kit ----
K_IMP = r"forgeflow-games-assets/impact-sounds/Audio/"
K_INT = r"forgeflow-games-assets/interface-sounds/Audio/"
K_RPG = r"forgeflow-games-assets/rpg-audio/Audio/"
K_UI = r"_downloaded/ui-audio/Audio/"
EM = r"Medieval Fantasy Audio Bundle/"
EH = r"Halloween Audio Kit/"
DG = r"Vocal Files/"

ROLES = []


def role(id, group, need, profile, status, candidates, gap=None, notes=None):
    ROLES.append({"id": id, "group": group, "need": need, "profile": profile, "status": status,
                  "candidates": candidates, "gap": gap, "notes": notes})


FC = r"FGHTImpt_Fight Combo x4"
role("punch_light", "combat", "6+ variants", "sfx_mono", "covered", [
    C(K_IMP + r"impactPunch_medium_000", "Kenney punch (medium) - short dull thump, no crack; body layer", True),
    C(K_IMP + r"impactPunch_medium_001", "Kenney punch (medium) variant", True),
    C(K_IMP + r"impactPunch_medium_003", "Kenney punch (medium) variant", True),
    C(K_IMP + r"impactPunch_medium_004", "Kenney punch (medium) variant", True),
    C(FC, "Anime 'fight combo x4' hit 1 (slice at measured transient) - snappier mid layer", True, 40, 240),
    C(FC, "fight combo hit 2 (slice)", True, 240, 440),
    C(FC, "fight combo hit 3 (slice)", False, 440, 630),
    C(FC, "fight combo hit 4 with tail (slice)", False, 630, 1080),
], notes="Kenney punches carry the body; layer a 1-4 kHz slap/snap (slap role) on top for the crack the reference has.")

role("punch_heavy", "combat", "6+ variants", "sfx_mono", "covered", [
    C(K_IMP + r"impactPunch_heavy_000", "Kenney heavy punch - low thud (73% <150 Hz)", True),
    C(K_IMP + r"impactPunch_heavy_002", "Kenney heavy punch variant (84% <150 Hz)", True),
    C(K_IMP + r"impactPunch_heavy_003", "Kenney heavy punch variant", True),
    C(r"Axe Flesh Hit_JSE_MW", "JSE 'two-handed axe flesh hit' take 2 - meaty mid-high smack, sliced", True, 2420, 3150),
    C(r"Axe Flesh Hit_JSE_MW", "axe flesh hit take 4 (slice) - lower-pitched take", True, 7230, 7800),
    C(EM + r"FX/Impact Flesh 3", "Evil Mind 'Impact Flesh 3' - low fleshy hit; 200 ms lead-in to trim", True),
    C(EM + r"FX/Impact 1\.mp3", "Evil Mind 'Impact 1' - blunt body impact; 220 ms lead-in", False),
    C(r"Noise_Punch_006", "Doex 90s-anime 'noise punch' - designed cartoon super-punch (finisher layer)", False),
])

role("kick", "combat", "1+ (3 ideal)", "sfx_mono", "partial", [
    C(K_IMP + r"impactSoft_heavy_001", "Kenney soft heavy impact - pure sub thump (99.9% <150 Hz); kick body", True),
    C(K_IMP + r"impactSoft_heavy_003", "variant", True),
    C(r"WEAPArmr_Metal Shield Block Hits", "JSE shield-block hit take 2 (slice) - low thump with a knock on top", True, 2410, 3200),
    C(EM + r"FX/Impact 4\.mp3", "Evil Mind 'Impact 4' - blunt impact; 200 ms lead-in", False),
], gap="No file named/foleyed as a kick in any source. Build kick = sub thump + punch_heavy layer + whoosh_light pre-roll.")

role("body_blow_thud", "combat", "3+", "sfx_mono", "covered", [
    C(K_IMP + r"impactSoft_heavy_000", "Kenney soft heavy impact - deep body thud", True),
    C(K_IMP + r"impactSoft_heavy_004", "variant", True),
    C(r"OBJPack_Big Cardboard Box Impact", "big cardboard box impact - hollow boomy thud (227 Hz centroid)", True),
    C(r"UI_Noisy_Impact_09", "Doex 'noisy impact' - loud designed thump (-9.4 LUFS)", False),
    C(EM + r"FX/Impact 6\.mp3", "Evil Mind 'Impact 6' - blunt low impact", False),
])

BB = r"GOREBone_Bone Breaks Celery 01"
role("bone_crunch", "combat", "3+", "sfx_mono", "covered", [
    C(BB, "JSE gore mini pack 'bone breaks (celery)' take 1 - crunchy bright snap cluster; quiet -> gain", True, 0, 1600),
    C(BB, "take 4 (slice)", True, 5130, 6300),
    C(BB, "take 7 (slice)", True, 11290, 12300),
    C(BB, "take 8 (slice)", False, 14340, 15250),
    C(EM + r"FX/Impact Bonebreak", "Evil Mind 'Impact Bonebreak' - short low crack+thud, 3 transients", True),
    C(r"WOODBrk_Snap09", "InMotion wood snap main crack (slice) - dry bright snap to layer under bone", False, 540, 800),
])

role("slap", "combat", "2+", "sfx_mono", "partial", [
    C(r"UIClick_Hand Pop UI Diminished 1", "Rogue Waves kawaii 'hand pop' - short hand/skin pop (84% 1-4 kHz)", True),
    C(K_IMP + r"impactGeneric_light_004", "Kenney generic light impact - 140 ms tap (bright-ish, 761 Hz centroid)", True),
    C(K_RPG + r"bookClose", "Kenney book close - flat smack, 230 ms", False),
    C(FC, "combo hit 1 (slice) as slap body", False, 40, 240),
], gap="No recorded skin slap in any source. Stand-ins are hand pop / light taps; a real slap needs a recording (or layer hand-pop + light tap).")

role("whoosh_light", "combat", "3+", "sfx_mono", "covered", [
    C(EH + r"FX/Slash\.mp3", "Evil Mind 'Slash' - short airy swish (95% >4 kHz, noise-like)", True),
    C(K_RPG + r"knifeSlice2", "Kenney knife slice - fast bright swipe 0.57 s", True),
    C(K_RPG + r"knifeSlice\.ogg", "Kenney knife slice variant", True),
    C(r"WHSH_Pure SciFi-Whoosh Fast 03", "Rescopic 'pure sci-fi whoosh fast' - trim to first 450 ms for a jab", False, 0, 450),
    C(EM + r"FX/Sword 6", "Evil Mind 'Sword 6' - noisy swish (flatness 0.27)", False),
])

role("whoosh_heavy", "combat", "2+", "sfx_mono", "covered", [
    C(r"WHSH_Airy-Whoosh Wind Gust 11", "Rescopic airy whoosh/wind gust - big low swing, 4.5 s (trim)", True, 300, 1500),
    C(r"WHSH_Deviant-Whoosh Flabby Slow 09", "Rescopic 'deviant whoosh flabby slow' - slow heavy swing (trim)", True, 900, 2300),
    C(r"WHSH_Sci-Fi Heavy Whoosh_MWSFX_CF 29", "Mechanical Wave sci-fi heavy whoosh - sub-heavy (99% <150 Hz), finisher wind-up", False, 0, 2000),
    C(r"WHOOSH PASS SF LOW", "Chupapsound low pass-by whoosh; quiet (-27.9 LUFS)", False),
    C(EM + r"Update 1.3/Spells/Spell - Air 2", "Evil Mind 'Spell - Air 2' - airy rush 1.9 s", False),
])

role("grab_cloth", "combat", "3+", "sfx_mono", "covered", [
    C(K_RPG + r"cloth1", "Kenney cloth rustle - grab", True),
    C(K_RPG + r"cloth3", "Kenney cloth rustle variant", True),
    C(r"NEO008", "TheWorkRoom dry neoprene movement take (slice) - rubbery cloth grab", True, 5260, 5600),
    C(r"NEO008", "neoprene take (slice)", False, 14410, 14720),
    C(r"CLOTHRip_CottonRips92", "InMotion torn T-shirt rip (slice) - shirt-grab tear accent", True, 50, 230),
    C(r"CLOTHRip_CottonRips74", "torn T-shirt rip, longer (slice)", False, 820, 1300),
    C(EM + r"Update 1.3/Coins and Inventory/Equip \(Clothes\)", "Evil Mind 'Equip (Clothes)' - cloth handling 1.2 s", False),
])

FD = r"GOREFlsh_Flesh Drops on Floor 03"
role("body_fall", "combat", "3+", "sfx_mono", "covered", [
    C(FD, "JSE gore 'flesh drops on floor' take (slice) - heavy low thud", True, 2230, 2800),
    C(FD, "flesh drop take (slice) - low thud", True, 4590, 5150),
    C(FD, "flesh drop take (slice) - very low thud", True, 13700, 14200),
    C(FD, "flesh drop take (slice)", False, 16590, 17100),
    C(K_IMP + r"impactPlate_heavy_004", "Kenney heavy plate impact - low slam 0.56 s", False),
    C(r"Flexible Sewer Pipe Big - Broken - DROP - Thump", "PP big sewer-pipe drop thump, last take (slice)", False, 15010, 15500),
])

DS = r"DOORCreak_Wooden Door, Door Slams, Impacts, 3"
role("wall_slam", "combat", "3+", "sfx_mono", "covered", [
    C(DS, "Rogue Waves wooden door slam take 1 (slice) - deep boomy slam", True, 0, 700),
    C(DS, "door slam take 2 (slice) - loudest of the six", True, 2250, 3050),
    C(DS, "door slam take 4 (slice)", True, 8500, 9350),
    C(DS, "door slam take 5 (slice)", False, 11120, 11950),
    C(K_RPG + r"doorClose_3", "Kenney door close - hot (+1.5 dBTP), mid slam", False),
    C(r"Bluezone_BC0297_stone_impact_015", "Bluezone stone impact - bright stone crack layer for brick walls", False),
])

GS = r"GORESplt_Gore Splatter 01"
role("wet_splat", "combat", "3+", "sfx_mono", "covered", [
    C(GS, "JSE gore splatter take 1 (slice) - wet squelch, ~4 kHz centroid", True, 0, 1350),
    C(GS, "gore splatter take 3 (slice)", True, 4800, 5450),
    C(GS, "gore splatter take 4 (slice)", True, 7200, 8100),
    C(FD, "flesh-drop take with splash tail (slice)", False, 9510, 10400),
    C(r"DSGNMisc_Gore Downshifter", "Mechanical Wave designed 'gore downshifter' - finisher splat design", False),
    C(r"Bluezone_BC0298_designed_water_impact_006", "Bluezone designed water impact - big wet boom (92% <150 Hz)", False),
])

role("glass_break", "combat", "2+", "sfx_mono", "covered", [
    C(r"GLASBrk_Glass Break Hit_04", "Mechanical Wave glass break hit - bright shatter (91% >4 kHz), 1.16 s", True),
    C(r"Bluezone_BC0292_alien_tripod_debris_glass_falling_003", "Bluezone glass debris falling - shatter tail", True),
    C(r"Vases_Breaking_1", "ElvGames vase breaking - ceramic/glass smash", False),
    C(EM + r"FX/Spell - Ice Broken", "Evil Mind 'Ice Broken' - glassy crackle cluster", False),
    C(r"SBvfe2_Glass 114", "Sonic Bat glass foley - small glass hit, quiet", False),
])

IR = r"Iron - Thick - HIT - Hammer"
role("metal_pipe_clang", "combat", "3+", "sfx_mono", "covered", [
    C(IR, "PP metal hit sweeteners: thick iron hit with hammer, take 1 (slice incl. ring)", True, 0, 1700),
    C(IR, "thick iron hit take 3 (slice)", True, 3570, 5250),
    C(r"METLImpt_Metal Impact-03", "Mechanical Wave metal impact - mid clang (86% 1-4 kHz)", True),
    C(r"Oil Barrel - HIT - Hammer - Take 2", "oil barrel hammer hit take 1 (slice) - hollow low-mid bong", False, 0, 1500),
    C(K_IMP + r"impactMetal_heavy_001", "Kenney heavy metal impact - short clank", False),
    C(r"Bluezone_BC0297_stone_impact_steel_bar_01_010", "Bluezone steel bar impact", False),
])

role("wooden_bat_crack", "combat", "2+", "sfx_mono", "covered", [
    C(r"WOODBrk_Snap09", "InMotion wood snap (slice) - dry crack, 4.2 kHz centroid", True, 540, 900),
    C(r"WOODImpt_Drops20", "InMotion wood drop - hard wooden knock (95% 1-4 kHz)", True),
    C(EM + r"FX/Stick 1", "Evil Mind 'Stick 1' - wooden stick hit; 120 ms lead-in", True),
    C(r"WOODCrsh_Designed Wood Crash And Debris 13", "David Dumais designed wood crash - bat-breaks-on-body variant", False),
    C(r"Wood_Breaking_1", "ElvGames wood breaking - splinter", False),
    C(K_IMP + r"impactPlank_medium_001", "Kenney plank impact - wooden thump", False),
])

role("electric_zap", "combat", "2+", "sfx_mono", "covered", [
    C(EM + r"FX/Spell - Electric Shock 2", "Evil Mind 'Electric Shock 2' - bright zap 0.7 s (86% >4 kHz)", True),
    C(EM + r"FX/Spell - Electric Shock 1", "Evil Mind 'Electric Shock 1' - zap 1.3 s", True),
    C(r"SCIMisc_Zap Short 14", "Rescopic 'zap short' - 2.1 s designed zap", True),
    C(r"electricity_surge_discharge_electrical_arc_crackling", "Bluezone electrical arc surge/crackle - 3.5 s, loud (-11.2 LUFS)", False),
    C(r"electricity_texture_sizzling_crackling_006", "Bluezone sizzling crackle - noise-like loop for live wires", False),
])

SR_ = r"AIRBrst_Steam Release Short 03"
role("fire_whoosh", "combat", "2+", "sfx_mono", "covered", [
    C(EM + r"FX/Spell - Fireball 2", "Evil Mind 'Fireball 2' - boomy fire whoosh 1.2 s (45% <150 Hz)", True),
    C(EM + r"FX/Spell - Fireball 1", "Evil Mind 'Fireball 1' - fire whoosh 0.9 s", True),
    C(r"27,Searing", "Orbital Emitter 'Searing' - designed burn/sear transition, 6 s (trim)", False, 0, 2500),
    C(SR_, "JSE steam release burst (slice) - hissing flame-jet stand-in (94% >4 kHz)", False, 0, 1000),
    C(EM + r"FX/Spell - Fire Loop", "Evil Mind 'Fire Loop' - quiet burning loop 9.7 s (-33 LUFS)", False),
])

role("explosion", "combat", "2+", "sfx_stereo", "covered", [
    C(r"EXPLReal_Medium Realistic Explosion 15", "David Dumais medium realistic explosion - 2.4 s, 75% <150 Hz", True),
    C(r"steampunk_weapon_flare_shot_explosion_003", "Bluezone flare-shot explosion - 2.3 s punchy", True),
    C(r"Tank Mine - EXPLOSION", "PP tank mine explosion (distant) - 1.8 s boom (slice)", False, 820, 2700),
    C(r"DESTRCrsh_Designed Car Explosion", "David Dumais car explosion w/ metal + glass - 5.1 s (env kill)", False),
    C(EM + r"FX/Cannon", "Evil Mind 'Cannon' - low boom 3 s", False),
])

# ---- crowd: filled from crowd_scan.json below (bursts/beds on sports crowds)
CROWD_FILES = {
    "bball_m": r"SBbma_Masculine U-18 Match 004", "bball_f": r"SBbma_Feminine League Match 010",
    "futsal_m": r"SBfma_Masculine League Match 001", "futsal_f": r"SBfma_Feminine League Match 004",
    "hand_m": r"SBhma_Masculine League Match 002", "hand_f": r"SBhma_Feminine EHF European Cup Match 002",
    "hockey_m": r"SBrhma_Masculine League Match 007", "hockey_f": r"SBrhma_Feminine League Match 004",
    "pub": r"AMBRest_Rome_Indoor-PubCrowd", "protest": r"SAPST01",
}

# ---- show
role("air_horn", "show", "1-2", "sfx_mono", "partial", [
    C(r"Man Lions Coach - VAR SFX - Horn Various", "PP MAN Lions coach (bus) horn blast (slice) - brassy 2.4 kHz centroid; closest to an air horn", True, 59900, 60900),
    C(r"Man Lions Coach - VAR SFX - Horn Various", "coach horn, long blast (slice)", True, 89900, 93000),
    C(r"Man Lions Coach - VAR SFX - Horn Various", "coach horn short toot (slice)", False, 5100, 5900),
    C(r"VEHHorn_Audi Q7", "Dramatic Cat Audi Q7 car horn short (slice) - comedic honk", False, 40, 340),
    C(r"Ferrari 458 Straight Pipes - t11 - VAR SFX - Horn", "PP Ferrari horn (slice) - car horn", False, 350, 1600),
], gap="No stadium/party air horn recording. A bus horn is the nearest in pitch/brass; a true air-horn blast is a gap.")

role("bell_ding", "show", "1-2", "sfx_mono", "covered", [
    C(r"BELLHand_Metallic Bell_ 22", "Mechanical Wave metallic hand bell - bright ring (90% >4 kHz) - round bell/ding", True, 0, 1450),
    C(r"80,TheGong", "Orbital Emitter 'The Gong' - gong hit 6.5 s - episode/round start", True),
    C(K_IMP + r"impactBell_heavy_000", "Kenney heavy bell impact - low bell 1.5 s", False),
    C(EH + r"FX/Church Bell 2\.mp3", "Evil Mind church bell 2 - 2.1 s", False),
    C(r"Spade - HIT - Drumstick - Ring - Mute", "PP spade struck with drumstick (slice) - ringing 'ting'", False, 2330, 4300),
])

role("drum_roll", "show", "1", "sfx_stereo", "gap", [
    C(r"Spade - HIT - Drumstick - Ring - Mute", "only drumstick recording in scope (single hits) - NOT a roll", False, 2330, 2500),
], gap="No drum roll in the listed sources: a filename search for drum/snare found only this drumstick-on-spade recording (single hits). Needs a sourced or synthesised roll.")

role("rimshot", "show", "1", "sfx_mono", "gap", [
    C(r"Spade - HIT - Drumstick - Ring - Mute", "drumstick-on-spade tick (slice) - rimshot-ish proxy", False, 4420, 4700),
    C(K_IMP + r"impactWood_light_002", "Kenney light wood impact - woodblock-like tock proxy", False),
], gap="No rimshot / 'ba-dum-tss' in scope. Proxies only.")

role("cash_register", "show", "1", "sfx_mono", "partial", [
    C(EM + r"Update 1.3/Coins and Inventory/Coins Bag 2", "Evil Mind coins bag - coin jingle (95% >4 kHz)", True),
    C(EM + r"Update 1.3/Coins and Inventory/Coins 3", "Evil Mind coins 3 - coin spill 1.1 s", False),
    C(K_RPG + r"handleCoins\.ogg", "Kenney handle coins - coin jingle 0.85 s", False),
    C(r"4631aacc_fs_646673", "Freesound 'Coin Pickup SFX [1]' (CC0) - arcade coin", False),
    C(r"industrial_lever_switch_014", "Bluezone industrial lever switch - mechanical ka-chunk to layer before the coins", False),
], gap="No cash-register 'ka-ching' recording. Build = lever ka-chunk + coin jingle + bell_ding.")

role("buzzer", "show", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"error_006", "Kenney error 006 - low buzz 0.5 s (61% <150 Hz)", True),
    C(K_INT + r"error_005", "Kenney error 005 - low buzz 0.5 s", False),
    C(r"Beechcraft Baron 58 - t12 - VAR SFX - Stall Warning", "PP aircraft stall-warning horn (slice) - harsh continuous warning tone", True, 11570, 13070),
    C(r"retrofuturistic_computer_alarm_005", "Bluezone retro computer alarm - 4.2 s bright alarm", False),
    C(r"BEEPAppl_Microwave, Beeps", "UberDuo microwave beep (slice) - 2 kHz timer beep", False, 7680, 8250),
])

PS = r"Pick Scrape Down, Short, Overdriven"
role("jingle_sting", "show", "4+ short stings", "jingle", "partial", [
    C(PS, "Rogue Waves 'metal tensions': overdriven guitar pick-scrape sting (slice) - rock sting", True, 0, 1150),
    C(PS, "overdriven pick-scrape sting 2 (slice)", True, 3990, 5200),
    C(PS, "overdriven pick-scrape, long (slice)", False, 8650, 10450),
    C(r"STINGER_Battle_Starts", "Corentin 8-bit 'Battle Starts' stinger 1.15 s - round start", True),
    C(r"02_Jingle_ Level Clear 2", "Chris Kohler 8-bit jingle 'Level Clear 2' 4.2 s - round won", True),
    C(r"77fb9d9e_fs_528958", "Freesound Beetlemuse 'Level Up / Mission Complete' (CC0) 3.4 s", False),
    C(EH + r"FX/Puntuation Sound", "Evil Mind 'Puntuation Sound' - 0.21 s bright score tick (use per score tick)", True),
    C(r"Comedic_006", "Doex 90s-anime 'comedic' sting (4 identical copies in file; slice 1)", False, 0, 780),
], gap="Chiptune/fantasy flavoured stings dominate; only the overdriven guitar scrapes are rock. No TV-show brass/band stings.")

role("commercial_break_sting", "show", "1-2", "jingle", "partial", [
    C(r"UBL_Lo-Tech_70_one_shot_key_Amin", "Used Bin Loops lo-tech degraded-tape key one-shot (A minor) - VHS/ad-bumper feel", True),
    C(r"UBL_Lo-Tech_110_one_shot_pad_Dmin", "lo-tech degraded-tape pad one-shot (D minor)", False),
    C(r"VOXFem_Accouncement Wet, Ringmaster", "Jake Fielding circus ringmaster PA: 'there will now be a 20 minute interval.' (slice, whisper words 1.84-4.06 s)", True, 1800, 4300),
    C(r"08,DragonReveal - dramatic and recap", "Orbital Emitter 'Dragon reveal - dramatic and recap' transition 11 s (trim)", False, 0, 3500),
    C(r"MUS026", "TheWorkRoom 'music spill' - music heard through a wall (break muzak candidate)", False),
], gap="No purpose-made 'we'll be right back' TV sting; proposal is a lo-tech tape one-shot + the ringmaster interval line.")

# ---- UI
role("ui_move", "ui", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"tick_002", "Kenney tick - 23 ms", True),
    C(K_INT + r"select_002", "Kenney select 002 - 43 ms low tick", False),
    C(K_UI + r"rollover2", "Kenney UI rollover 2 - 57 ms", True),
    C(r"UIClick_UI Click 33_CB", "CB Sounddesign UI click 33 - 150 ms", False),
])
role("ui_select", "ui", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"select_003", "Kenney select 003 - 0.38 s", True),
    C(K_INT + r"switch_002", "Kenney switch 002", False),
    C(r"UIClick_Select Middle 29", "Rescopic UI select middle 29 - 0.59 s", True),
    C(K_UI + r"click3", "Kenney UI click 3", False),
])
role("ui_confirm", "ui", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"confirmation_002", "Kenney confirmation 002 - 0.54 s chime", True),
    C(K_INT + r"confirmation_004", "Kenney confirmation 004", False),
    C(r"UIAlert_Confirm Middle 12", "Rescopic UI confirm middle 12 - 1.0 s", True),
    C(r"UIMisc_Feedback 36 up", "CB Sounddesign feedback up - 0.78 s", False),
])
role("ui_back", "ui", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"back_001", "Kenney back 001 - 64 ms", True),
    C(K_INT + r"back_003", "Kenney back 003", False),
    C(K_INT + r"minimize_005", "Kenney minimize 005 - 0.53 s down-sweep", False),
    C(r"UI_Decline_1", "ElvGames UI decline", False),
])
role("ui_error", "ui", "1-2", "sfx_mono", "covered", [
    C(K_INT + r"error_003", "Kenney error 003 - 0.53 s", True),
    C(K_INT + r"error_008", "Kenney error 008 - 0.14 s", False),
    C(K_INT + r"error_006", "shared with buzzer", False),
])

# ---- music
role("music_menu", "music", "1", "music", "partial", [
    C(EH + r"Update 1.1/Music/Hey Ho Jack-O", "Evil Mind 'Hey Ho Jack-O' 56.9 s, est 136 BPM, 3.5 onsets/s (bouncy)", True),
    C(EH + r"Music/Generic Halloween Menu", "Evil Mind 'Generic Halloween Menu' 58 s, est 123 BPM - Halloween-themed", False),
    C(r"12\.2_LOOP_Conviction", "Florian Stracker 16-bit 'Conviction' loop 50.9 s, -9.3 LUFS", False),
], gap="Nothing labelled rock/funk/synth for a menu; genre fit unverified (cannot listen).")
role("music_stage", "music", "5 tracks", "music", "partial", [
    C(EH + r"Music/Halloween Rocks", "Evil Mind 'Halloween Rocks' 59 s, est 129 BPM - only in-scope track labelled rock besides the boss metal", True),
    C(EH + r"Update 1.4/Music/Freak Invasion", "Evil Mind 'Freak Invasion' 73.9 s, est 129 BPM, loud/dense (-7.9 LUFS, 2 dB spread)", True),
    C(EH + r"Update 1.4/Music/Spooky Lands", "Evil Mind 'Spooky Lands' 73.9 s, est 129 BPM, -8.3 LUFS", True),
    C(EM + r"Music/Bloody Battlefield", "Evil Mind 'Bloody Battlefield' 56.8 s, est 136 BPM, -9.8 LUFS", True),
    C(EM + r"Music/The Evil Emperor", "Evil Mind 'The Evil Emperor' 75.6 s, est 129 BPM", True),
    C(r"06\.2_LOOP_Battle_to_the_Blood", "Florian Stracker 16-bit 'Battle to the Blood' loop 112 s, est 172 BPM", False),
    C(r"03 Random Battle Encounter", "Chris Kohler 8-bit 'Random Battle Encounter' 60 s, est 161 BPM", False),
    C(r"ec48a7db_jam_690198", "Jamendo 'Electric Chronic' (Social Bot 73XT) 8-bit chiptune 225 s - CC BY 3.0 needs credit", False),
], gap="Brief asks gritty rock / metal / synth-punk / funk. In scope only 'Halloween Rocks' is labelled rock; the rest are Halloween/fantasy/chiptune by label. Unused Travis Rise synthwave (outside listed sources) is the nearest synth fit.")
role("music_boss", "music", "1", "music", "covered", [
    C(EH + r"Update 1.5/Music/Face Your Doom \(A Halloween Final Boss\) - Metal", "Evil Mind 'Face Your Doom (A Halloween Final Boss) - Metal' 82.3 s - labelled metal + boss", True),
    C(EH + r"Update 1.5/Music/Face Your Doom \(A Halloween Final Boss\) - Orchestral", "same cue, orchestral mix (phase-2 or intro)", False),
    C(r"LOOP_4_Let's_Fight", "Corentin 8-bit 'Let's Fight! (Battle/Boss)' loop 88.6 s", False),
])
role("music_results_jingle", "music", "1", "jingle", "covered", [
    C(r"01_Jingle_ Level Clear 1", "Chris Kohler 8-bit jingle 'Level Clear 1' 12 s", True),
    C(r"03_Jingle_ Game Over", "Chris Kohler 8-bit jingle 'Game Over' 11.3 s (loss screen)", True),
    C(r"forgeflow-games-assets/music/game_over\.ogg", "OGA CC0 game_over 17.1 s (not in 'used')", False),
    C(EM + r"Music/Team Celebration", "Evil Mind 'Team Celebration' 49.9 s - trim first 8-10 s for a win fanfare", False, 0, 9000),
])

# ---- voice (no announcer pack; usable barks found)
role("voice_host_lines", "voice", "optional", "sfx_mono", "partial", [
    C(r"VOXFem_Accouncement Wet, Ringmaster", "female ringmaster PA 'Ladies and gentlemen, boys and girls,' (slice; whisper words 0.00-1.62 s) - show open", True, 0, 1750),
    C(r"Jamaal/Stout/CriticalHit/Male_CriticalHit_03", "'CRITICAL HIT!' (whisper) - usable as host/hype shout", True),
    C(r"Jamaal/Dark/CriticalHit/Male_CriticalHit_02", "'Critical Hit' (whisper) - darker read", False),
    C(r"Edwyn/CriticalHit/Male_CriticalHit_03", "'AWESOME!' (whisper) - hype shout", False),
], gap="No announcer/host voice pack. Only the ringmaster PA line and generic RPG barks are usable.")
role("voice_fighter_barks", "voice", "optional", "sfx_mono", "covered", [
    C(r"Patrick/Cocky/Male_BattleStart_01", "'Let's do this!' (whisper)", True),
    C(r"Patrick/Cocky/Male_BattleWon_02", "'That was too easy.' (whisper)", True),
    C(r"Patrick/Cocky/Male_CriticalHit_02", "'...right in the sweet spot!' (whisper)", True),
    C(r"Jamaal/Stout/BattleStart/Male_BattleStart_07", "'Here we go!' (whisper)", True),
    C(r"Jamaal/Stout/CriticalHit/Male_CriticalHit_02", "'Take this!' (whisper)", True),
    C(r"Edwyn/CriticalHit/Male_CriticalHit_01", "'And stay down!' (whisper)", False),
    C(r"KarenK/CriticalHit/Female_CriticalHit_02", "'Boom, feel the sting.' (whisper) - female fighter", False),
    C(r"Jamaal/Dark/BattleStart/Male_BattleStart_02", "'You are no match for me.' (whisper) - boss intro", False),
])
role("voice_efforts", "voice", "optional", "sfx_mono", "covered", [
    C(r"Jamaal/Stout/AA_GenericBattleSounds/Male_Attack_01", "male attack grunt", True),
    C(r"Jamaal/Stout/AA_GenericBattleSounds/Male_Attack_02", "male attack grunt", True),
    C(r"Jamaal/Stout/AA_GenericBattleSounds/Male_Hurt_01", "male hurt", True),
    C(r"Jamaal/Stout/AA_GenericBattleSounds/Male_Hurt_02", "male hurt", True),
    C(r"Jamaal/Stout/AA_GenericBattleSounds/Male_Death_01", "male death (KO)", True),
    C(r"Patrick/Cocky/GenericBattleSounds/Male_Attack_01", "second male voice attack", False),
    C(r"Patrick/Cocky/GenericBattleSounds/Male_Hurt_01", "second male voice hurt", False),
    C(r"Jamaal/Dark/Rage/Male_Rage_01", "'AHHHH' rage roar 3 s (whisper) - finisher/special", False),
])


def add_crowd_roles():
    def CR(key, s0, s1, note, ship=False, profile="bed_stereo"):
        d = {"path": P(CROWD_FILES[key]), "start_ms": int(s0 * 1000), "end_ms": int(s1 * 1000), "ship": ship, "note": note}
        if profile:
            d["profile"] = profile
        return d
    role("crowd_cheer_loop", "crowd", "1-2 loops", "bed_stereo", "partial", [
        CR("hand_f", 108, 128, "Sonic Bat handball (EHF cup) spectators, 20 s window: 500 ms-RMS spread 4.4 dB, seam step 0.7 dB, level -23.0 dBFS", True),
        CR("hockey_f", 2, 22, "Sonic Bat roller-hockey spectators, 20 s: spread 2.9 dB, seam 0.2 dB, flatness 0.197 (noise-like crowd)", True),
        CR("protest", 20, 40, "TheWorkRoom protest crowd (chanting), 20 s: spread 2.5 dB, seam 0.3 dB, level -14.2 dBFS - dense rowdy layer for high ratings", False),
        CR("pub", 110, 130, "Sculptunes Rome indoor pub crowd, 20 s: spread 2.6 dB, seam 1.5 dB - murmur bed for low ratings", False),
        CR("bball_m", 378, 398, "Sonic Bat basketball U-18 spectators, 20 s: spread 8.1 dB (lively), seam 1.4 dB", False),
        CR("hockey_m", 102, 122, "Sonic Bat roller-hockey spectators, 20 s: spread 5.3 dB, seam 1.4 dB", False),
    ], gap="Real sports-hall spectators and a protest crowd, not a TV studio audience; 'cheer' energy unverified by ear. Windows chosen by measured steadiness (crowd_scan.json beds).")
    role("crowd_cheer_burst", "crowd", "2+", "sfx_stereo", "partial", [
        CR("hand_m", 459.5, 464.5, "handball (men) loudest 3 s window +20.7 dB over file median (window widened for decay)", True, "sfx_stereo"),
        CR("bball_f", 152.0, 157.0, "basketball (women) +18.4 dB over median", True, "sfx_stereo"),
        CR("bball_m", 214.5, 219.5, "basketball U-18 +15.9 dB over median", True, "sfx_stereo"),
        CR("hand_m", 249.5, 254.5, "handball (men) +19.9 dB; flatness 0.013 = tonal content (whistle/horn?) - audition", False, "sfx_stereo"),
        CR("hockey_f", 439.0, 444.0, "roller hockey +16.2 dB over median", False, "sfx_stereo"),
        CR("futsal_f", 139.0, 144.0, "futsal +15.2 dB over median, flatness 0.094", False, "sfx_stereo"),
    ], gap="Burst windows are the measured loudest moments of spectator recordings - could be cheers, whistles, horns or ball impacts; audition before lock.")
    role("crowd_boo", "crowd", "1+", "sfx_stereo", "gap", [
        CR("protest", 195.0, 200.0, "protest crowd loudest window (+6.0 dB) - hostile chant, NOT a boo", False, "sfx_stereo"),
    ], gap="No booing crowd anywhere in scope.")
    role("crowd_gasp_ooh", "crowd", "1+", "sfx_mono", "gap", [
        C(r"HMNBrth_Human, Adult, Male, Breath, Surprise, Gasp", "UberDuo single male surprise gasp (slice) - one voice, not a crowd", False, 150, 700),
    ], gap="No crowd 'ooh'/gasp. Stacking the single gasp with pitch variants is a weak stand-in.")
    role("crowd_applause", "crowd", "1+", "sfx_stereo", "gap", [],
         gap="No applause recording found by name in any source; sports-hall beds may contain clapping but unverified.")
    role("crowd_laugh", "crowd", "1+", "sfx_mono", "gap", [
        C(EH + r"FX/Evil Laughter 2", "Evil Mind evil laughter - single villain laugh (host/boss), not an audience", False),
        C(EH + r"FX/Wicht Laughter 1", "Evil Mind 'Wicht' (witch) laughter - single cackle", False),
    ], gap="No audience/sitcom laugh. Only single-character villain laughs.")


add_crowd_roles()


def finish():
    out_roles = []
    nslice = 0
    for r in ROLES:
        cands = []
        for c in r["candidates"]:
            m = MEAS[c["path"]]
            d = {"path": c["path"], "source": source(c["path"]), "licence": licence(c["path"]),
                 "ship": c.get("ship", False), "note": c["note"]}
            base = {k: m.get(k) for k in KEEP}
            if "start_ms" in c:
                d["start_ms"], d["end_ms"] = c["start_ms"], c["end_ms"]
                sm = measure_slice(c["path"], c["start_ms"], c["end_ms"])
                nslice += 1
                d["measured"] = dict(base)
                d["measured"].update(sm)
                d["measured"]["slice_of_file_s"] = m.get("duration_s")
                for k in ["onset_ms", "decay30_ms", "transients", "lead_silence_ms", "env100_spread_db", "lra_lu"]:
                    d["measured"].pop(k, None)
            else:
                d["measured"] = base
            if c.get("profile"):
                d["profile"] = c["profile"]
            mm = d["measured"]
            if mm.get("band_150_1k") is not None:
                mm["share_150_4k"] = round((mm.get("band_150_1k") or 0) + (mm.get("band_1k_4k") or 0), 3)
            d["auto_character"] = auto_desc(d["measured"])
            tr = VOICE.get(c["path"])
            if tr and "text" in tr:
                d["transcript_whisper"] = tr["text"]
            tp = TEMPO.get(c["path"])
            if tp and "bpm_est" in tp:
                d["tempo"] = tp
            cands.append(d)
        rr = dict(r)
        rr["candidates"] = cands
        out_roles.append(rr)
    return out_roles, nslice


roles, nslice = finish()
kit = {
    "game": "HIT PARADE",
    "generated": "2026-09-29",
    "method": {
        "measured_with": "ffprobe (format), ffmpeg ebur128=peak=true + volumedetect (loudness), numpy on ffmpeg mono downmix (spectrum, envelope); tools/research/audio_measure.py, audio_takes.py, audio_crowd_scan.py, audio_tempo.py, audio_kit_build.py",
        "listening": "NONE - the researcher cannot listen. Character notes come from file/folder names plus measurements. Every pick must be auditioned before lock.",
        "lufs_note": "Integrated LUFS is undefined for clips under ~0.4 s (ebur128 reports -70.0); use max_volume_db / true_peak_dbtp for those.",
        "downmix_note": "centroid/band shares come from ffmpeg's default mono downmix; loudness fields come from the original channels.",
        "slices": "start_ms/end_ms candidates were re-measured on the slice (%d slices)." % nslice,
        "voice": "transcripts are machine output from a locally cached faster-whisper small.en model (offline); may contain errors.",
    },
    "roles": roles,
}
json.dump(kit, open(os.path.join(RD, "audio_kit.json"), "w", encoding="utf-8"), indent=1)
ship = sum(1 for r in roles for c in r["candidates"] if c["ship"])
print("roles", len(roles), "candidates", sum(len(r["candidates"]) for r in roles), "ship", ship, "slices", nslice)
for r in roles:
    print("%-24s %-8s %d cands, %d ship" % (r["id"], r["status"], len(r["candidates"]), sum(1 for c in r["candidates"] if c["ship"])))
