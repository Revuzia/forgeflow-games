import os
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
s = open(p, encoding="utf-8").read()

def rep(old, new, cnt=1):
    global s
    assert s.count(old) == cnt, (old[:80], s.count(old))
    s = s.replace(old, new)

# breaker: eject port on the receiver window, no plate dressing, sights on the receiver top
rep('''        "iron_base_rel": 0.011,    # barrel/receiver top
        "iron": {"rear_y": 0.050, "front_y": 0.700},''',
    '''        "iron_base_rel": 0.018,    # receiver top (ghost-ring base)
        "iron": {"rear_y": 0.118, "front_y": 0.715, "front_base_rel": 0.010},''')
rep('''        "eject": {"y": 0.090, "z_rel": 0.004},
        "sights": "iron_low",
        "pump":''', '''        "eject": {"y": 0.150, "z_rel": 0.082, "plate": False},
        "sights": "iron_low",
        "pump":''')

# eject plate: optional
rep('''    e = cfg.get("eject")
    if not e:
        return [], None
    y, z = e["y"], e["z_rel"]
''', '''    e = cfg.get("eject")
    if not e:
        return [], None
    y, z = e["y"], e["z_rel"]
    if e.get("plate") is False:
        return [], (right_x + 0.006, y, z)
''')

# sights: separate front base height
rep("def build_sights(kind, rail_top_z, sight_z, y_front, y_rear, mats):",
    "def build_sights(kind, rail_top_z, sight_z, y_front, y_rear, mats, front_top_z=None):")
rep('''        tower_h = (sight_z - rail_top_z) * 0.55
        objs.append(box("fs_tower", 0, y_front, rail_top_z + tower_h / 2, 0.014, 0.016, tower_h, mats["metal"]))
        post_h = (sight_z - rail_top_z) - tower_h
        objs.append(box("fs_post", 0, y_front, rail_top_z + tower_h + post_h / 2, 0.0022, 0.0035, post_h, mats["metal"], bevel=0.0004))
        # protective ears
        for sx in (-1, 1):
            objs.append(box(f"fs_ear{sx}", sx * 0.0085, y_front, rail_top_z + tower_h * 0.9, 0.003, 0.014, tower_h * 1.15, mats["metal"]))''',
    '''        ftz = rail_top_z if front_top_z is None else front_top_z
        tower_h = (sight_z - ftz) * 0.55
        objs.append(box("fs_tower", 0, y_front, ftz + tower_h / 2, 0.014, 0.016, tower_h, mats["metal"]))
        post_h = (sight_z - ftz) - tower_h
        objs.append(box("fs_post", 0, y_front, ftz + tower_h + post_h / 2, 0.0022, 0.0035, post_h, mats["metal"], bevel=0.0004))
        # protective ears
        for sx in (-1, 1):
            objs.append(box(f"fs_ear{sx}", sx * 0.0085, y_front, ftz + tower_h * 0.9, 0.003, 0.014, tower_h * 1.15, mats["metal"]))''')
rep('''        parts += build_sights(cfg["sights"], base_z, sight_z, y_front, y_rear, mats)''',
    '''        fb = iron.get("front_base_rel")
        parts += build_sights(cfg["sights"], base_z, sight_z, y_front, y_rear, mats,
                              front_top_z=(bore_z + fb) if fb is not None else None)''')

# breaker arms
rep('''    "pike": [
        ("R", (0.034, -0.050, -0.020)''', '''    "breaker": [
        ("R", (0.036, -0.085, -0.020), (0.0, 1.0, 0.10), (-1.0, 0.0, 0.0),
         {"index_curl": (10, 14, 8)}),
        ("L", (-0.085, 0.340, 0.020), (1.0, 0.05, 0.25), (0.15, 0.0, 1.0), {}),
    ],
    "pike": [
        ("R", (0.034, -0.050, -0.020)''')
open(p, "w", encoding="utf-8").write(s)
print("patched2")
