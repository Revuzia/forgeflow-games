# one-shot splice: insert parts_block.py into the build script and wire build()
import os
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
s = open(p, encoding="utf-8").read()
block = open(os.path.join(HERE, "parts_block.py"), encoding="utf-8").read()
anchor = "def build_muzzle_device(cfg, muzzle_y, bore_z, mats):"
assert s.count(anchor) == 1
if "def split_region(" not in s:
    s = s.replace(anchor, block + anchor)

old = "    parts += build_scope(cfg, bore_z, mats, z_ads)\n"
assert old in s
s = s.replace(old, (
    "    if (cfg.get(\"scope\") or {}).get(\"solid\"):\n"
    "        parts += build_scope_solid(cfg, bore_z, mats)\n"
    "    else:\n"
    "        parts += build_scope(cfg, bore_z, mats, z_ads)\n"))

old = "    sight_z = bore_z + cfg[\"sight_h\"]\n"
assert s.count(old) == 1
s = s.replace(old, (
    "    # animatable parts (mag / pump): cut from the base, or authored when the\n"
    "    # magazine lives inside the grip. They are separate NODES in the GLB.\n"
    "    extras = []\n"
    "    for key in (\"mag\", \"pump\"):\n"
    "        reg = cfg.get(key)\n"
    "        if not reg:\n"
    "            continue\n"
    "        if reg.get(\"authored\"):\n"
    "            extras.append(author_mag(reg, mats))\n"
    "        else:\n"
    "            extras.append(split_region(base, key, reg))\n") + old)

old = "    shade_smooth(base, 52)\n"
assert s.count(old) == 1
s = s.replace(old, old + "    for ex in extras:\n        shade_smooth(ex, 52)\n")
a = "    for o in parts + [mz, ej, sg]:\n        o.select_set(True)"
assert a in s
s = s.replace(a, "    for o in parts + extras + [mz, ej, sg]:\n        o.select_set(True)")
b = "    for o in parts + [mz, ej, sg]:\n        if getattr(o, \"type\", None) != \"MESH\":"
assert b in s
s = s.replace(b, "    for o in parts + extras + [mz, ej, sg]:\n        if getattr(o, \"type\", None) != \"MESH\":")
open(p, "w", encoding="utf-8").write(s)
print("spliced")
