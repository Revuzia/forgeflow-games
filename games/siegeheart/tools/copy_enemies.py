"""Copy the recast enemy models (all UNUSED by any prior game) into assets/models/enemies.
Self-contained .glb are copied flat; .gltf get their sibling buffers/textures copied into a subfolder."""
import json, os, shutil, struct, sys

SRC = r"F:/games/forgeflow-games-assets/3d-models"
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "models", "enemies")
os.makedirs(DST, exist_ok=True)

PICKS = {
    # W1 Colosseum
    "brawler":    "ultimate-monsters/Orc Enemy.glb",
    "arenabull":  "polypizza/animals/Bull.glb",
    "tribal":     "ultimate-monsters/Tribal.glb",
    "harrier":    "ultimate-monsters/Birb.glb",
    "warhorse":   "polypizza/animals/Horse.glb",
    "giant":      "polypizza/monsters/Giant.glb",
    # W2 Gothic
    "brute":      "polypizza/monsters/Enemy Large.glb",
    "rat":        "polypizza/animals/Rat.glb",
    "risen":      "polypizza/aliens/Zombie.glb",
    "fiend":      "ultimate-monsters/Demon-LnfIziKv4o.glb",
    "cryptknight":"polypizza/monsters/Skeleton-1XZD9G.glb",
    "cyclops":    "quaternius/cute-monsters/Cyclops.gltf",
    # W3 Sky
    "strider":    "ultimate-monsters/Alpaking.glb",
    "skywhale":   "ultimate-monsters/Fish-ypEYhCImAB.glb",
    "cloudray":   "ultimate-monsters/Fish.glb",
    "stormgull":  "ultimate-monsters/Pigeon.glb",
    "puffling":   "ultimate-monsters/Chicken.glb",
    "skyherald":  "polypizza/monsters/Animated Wizard.glb",
    "skyshark":   "polypizza/animals/Shark.glb",
    # W4 Crystal
    "shardblob":  "ultimate-monsters/Green Spiky Blob.glb",
    "pinkblob":   "ultimate-monsters/Pink Blob.glb",
    "cactoro":    "ultimate-monsters/Cactoro.glb",
    "glimmerbee": "polypizza/animals/Bee Enemy.glb",
    "facetstag":  "ultimate-monsters/Monkroose.glb",
    "geodesaur":  "ultimate-monsters/Dino.glb",
    # W5 Dwarven
    "mineauto":   "polypizza/monsters/Robot Enemy.glb",
    "powderimp":  "polypizza/monsters/Enemy Small.glb",
    "orehauler":  "polypizza/monsters/Robot Enemy Large.glb",
    "gyrodrone":  "polypizza/monsters/Robot Enemy Flying.glb",
    "forgewalker":"polypizza/monsters/Robot Enemy Legs Gun.glb",
    "forgemech":  "quaternius/animated-mech/Textured_glTF_Stan.gltf",
}

def glb_anims(path):
    with open(path, "rb") as f:
        magic = f.read(4)
        if magic != b"glTF": return None
        f.read(8)
        clen, _ = struct.unpack("<II", f.read(8))
        j = json.loads(f.read(clen).decode())
        return [a.get("name", "?") for a in j.get("animations", [])]

def copy_gltf_with_deps(src, name):
    """Copy a .gltf and its referenced sibling files into DST/<name>/."""
    sub = os.path.join(DST, name)
    os.makedirs(sub, exist_ok=True)
    j = json.load(open(src, encoding="utf-8"))
    base = os.path.dirname(src)
    deps = set()
    for buf in j.get("buffers", []):
        if buf.get("uri") and not buf["uri"].startswith("data:"): deps.add(buf["uri"])
    for img in j.get("images", []):
        if img.get("uri") and not img["uri"].startswith("data:"): deps.add(img["uri"])
    shutil.copy2(src, os.path.join(sub, name + ".gltf"))
    ok = True
    for d in deps:
        dp = os.path.normpath(os.path.join(base, d))
        if os.path.exists(dp):
            target = os.path.join(sub, d.replace("\\", "/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(dp, target)
        else:
            print(f"  !! missing dep {d}"); ok = False
    anims = [a.get("name", "?") for a in j.get("animations", [])]
    return ok, anims, sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(sub) for f in fs)

total = 0
fails = []
for name, rel in PICKS.items():
    src = os.path.join(SRC, rel)
    if not os.path.exists(src):
        print(f"MISSING {name}: {rel}"); fails.append(name); continue
    if rel.endswith(".gltf"):
        ok, anims, size = copy_gltf_with_deps(src, name)
        if not ok: fails.append(name)
        print(f"OK {name:12s} [gltf+deps] {size//1024:5d}KB anims={[a.split('|')[-1] for a in (anims or [])][:6]}")
        total += size
    else:
        dst = os.path.join(DST, name + ".glb")
        shutil.copy2(src, dst)
        size = os.path.getsize(dst); total += size
        anims = glb_anims(dst) or []
        print(f"OK {name:12s} {size//1024:5d}KB anims={[a.split('|')[-1] for a in anims][:6]}")

print(f"\nTOTAL {total/1024/1024:.1f} MB; FAILS: {fails or 'none'}")
sys.exit(1 if fails else 0)
