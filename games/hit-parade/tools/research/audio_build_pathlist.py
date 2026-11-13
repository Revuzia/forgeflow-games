"""Build the list of audio files to measure for the HIT PARADE audio kit.
Writes <out_dir>/_paths_measure.txt . ASCII only.
"""
import os, sys, json, glob, re

OUT = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/audio"
FA = "F:/games/forgeflow-games-assets"
UA = "F:/games/unity-assets"
AUD = (".wav", ".ogg", ".mp3", ".flac", ".aif", ".aiff")

paths = []

def add_glob(pattern):
    for f in sorted(glob.glob(pattern, recursive=True)):
        if f.lower().endswith(AUD):
            paths.append(f.replace("\\", "/"))

# Kenney packs (main copies; _downloaded/impact-sounds and interface-sounds are byte-identical)
for d in ["impact-sounds", "interface-sounds", "rpg-audio", "_downloaded/ui-audio"]:
    add_glob(FA + "/" + d + "/Audio/*")
add_glob(FA + "/music/*")
add_glob(FA + "/_downloaded/audio-cache/**/*")

# Sonniss: keyword subset of the 609 on-disk WAVs
KW = re.compile(r"punch|fght|hit|impact|impt|slap|whoosh|whsh|swing|bone|gore|flsh|splt|splat|glass|glas|"
                r"metl|metal|iron|barrel|spade|toolbox|wood|snap|crsh|crash|zap|elec|voltage|surge|spark|"
                r"fire|sear|steam release|expl|boom|rpg - firing|mine|crowd|walla|match|pubcrowd|protest|sapst|"
                r"cafeteria|supermarket|gasp|breath|exhale|horn|bell|gong|braam|bram|stall warning|beeps|alarm|"
                r"comedic|powerup|riser|reveal|stngr|lo-tech|music spill|mus0|vox|voice|mothership|android|"
                r"detected|acquired|orders|insufficient|ui|click|select|confirm|feedback|zoom|counter|window|"
                r"cloth|rip|mask|neo0|neow|grab|cardboard box impact|sewer pipe|cupboard|door slams|cannon|"
                r"flare|shot pulse|ricochet|rattle scrap|guitar|interference|dive bomb|pick scrape|comb|whammy|"
                r"noisy|droid-ui|game night|chess|dice", re.I)
idx = json.load(open(FA + "/sonniss-gdc2024/sonniss_index.json", encoding="utf-8"))
SKIP = re.compile(r"ambisonic|atmos|7\.1\.4|impulse response|amb - ", re.I)
for f in idx["files"]:
    p = f["path"]
    if KW.search(p) and not SKIP.search(p):
        paths.append(FA + "/sonniss-gdc2024/" + p)

# unity-assets
EM = UA + "/Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects/Assets/Medieval Fantasy Audio Bundle"
EH = UA + "/Evil Mind__Halloween Audio Kit Music Ambience Effects/Assets/Halloween Audio Kit"
add_glob(EM + "/FX/*")
add_glob(EM + "/Music/*")
add_glob(EM + "/Update/*")
add_glob(EM + "/Update 1.3/Misc/*")
add_glob(EM + "/Update 1.3/Spells/*")
add_glob(EM + "/Update 1.3/Coins and Inventory/Coin*")
add_glob(EM + "/Update 1.3/Coins and Inventory/Equip (Clothes).mp3")
add_glob(EM + "/Update 1.3/Coins and Inventory/Equip (Leather).mp3")
add_glob(EH + "/FX/*")
add_glob(EH + "/Music/*")
add_glob(EH + "/Update 1.1/**/*")
add_glob(EH + "/Update 1.4/**/*")
add_glob(EH + "/Update 1.5/**/*")
# music packs (loop versions preferred; plus stingers/jingles)
add_glob(UA + "/Florian Stracker__The Heros Path Free 16bit Adventure Game Music/**/OGG/*")
add_glob(UA + "/Florian Stracker__Retro-Fit Adventure Free 8-Bit Video Game Music/**/OGG/*")
add_glob(UA + "/Chris Kohler__8-Bit RPG Adventure Music Pack/**/*.wav")
add_glob(UA + "/Corentin Guezenoc__8-bit Platformer Vertical Slice Kit/**/*.wav")
add_glob(UA + "/GWriterStudio__8Bit Music - 062022/**/*.wav")
add_glob(UA + "/Cyberleaf Studio__Deep Space - Music Pack/**/*.wav")
add_glob(UA + "/ElvGames__2D TopDown Tilesets RPG Game Asset Bundle/**/*.wav")
add_glob(UA + "/ElvGames__2D Platformer Tilesets Bundle 16x16 Pixelart/**/*.wav")
# voice pack subset: fighter efforts + short barks
DG = UA + "/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files"
for sub in ["Patrick/Cocky/GenericBattleSounds/*", "Patrick/Cocky/*.wav",
            "Jamaal/Stout/AA_GenericBattleSounds/*", "Jamaal/Stout/BattleStart/*", "Jamaal/Stout/BattleWon/*",
            "Jamaal/Stout/CriticalHit/*", "Jamaal/Stout/Emotions/*",
            "Jamaal/Dark/AA_GenericBattleSounds/*", "Jamaal/Dark/BattleStart/*", "Jamaal/Dark/CriticalHit/*",
            "Clifford/AA_GeneralBattleSounds/*", "Nile/AA_GeneralAttackSounds/*",
            "Samuel/AA_GeneralAttackSounds/*", "KarenK/AA_GenericBattleSounds/*",
            "Kimlinh/AA_GenericBattleSounds/*", "Rina_Chan/AA_GenericBattleSounds/*"]:
    add_glob(DG + "/" + sub)

paths = list(dict.fromkeys(paths))
with open(OUT + "/_paths_measure.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(paths) + "\n")
print(len(paths))
