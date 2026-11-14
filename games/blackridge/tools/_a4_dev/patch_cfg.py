import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
s = open(p, encoding="utf-8").read()

def rep(old, new, cnt=1):
    global s
    assert s.count(old) == cnt, (old[:70], s.count(old))
    s = s.replace(old, new)

# warden: magazine splits off the base
rep('''        "eject": {"y": 0.045, "z_rel": -0.004},
        "sights": "iron",
        "arms": True,
    },
    "vesper"''', '''        "eject": {"y": 0.045, "z_rel": -0.004},
        "sights": "iron",
        "mag": {"y0": 0.095, "y1": 0.215, "z_max": -0.012},   # AR box magazine
        "arms": True,
    },
    "vesper"''')

# vesper: the magazine is inside the grip -> authored box
rep('''        "eject": {"y": 0.035, "z_rel": -0.004},
        "sights": "iron_low",
        "arms": True,
    },
    "corvus"''', '''        "eject": {"y": 0.035, "z_rel": -0.004},
        "sights": "iron_low",
        "mag": {"authored": True, "cy": -0.030, "wy": 0.042, "wx": 0.024, "z0": -0.096, "z1": -0.020},
        "arms": True,
    },
    "corvus"''')

# corvus: solid optic + box magazine
rep('''        "scope": {"axis_rel": 0.098, "y_ocular": -0.088, "y_obj": 0.012,
                  "clear_r": 0.0076, "wall": 0.0028, "rim_wall": 0.0030,
                  "turret_r": 0.0060, "turret_stand": 0.0080,
                  "y_turret": -0.030, "mount_base_rel": 0.045},''',
    '''        # PRESENTATION PASS: solid optic (build_scope_solid). The full-screen scope
        # overlay is the sight picture now; this model is what the player sees at the
        # hip and through the raise / zoom-in. axis_rel stays 0.098 (= sightY 0.123).
        "scope": {"solid": True, "axis_rel": 0.098, "y_ocular": -0.105, "y_obj": 0.185,
                  "tube_r": 0.0155, "y_turret": 0.040, "mount_base_rel": 0.045,
                  "mounts": (-0.035, 0.085)},''')
rep('''        "eject": {"y": 0.10, "z_rel": -0.002},
        "sights": "none",
        "stock_fix": {"gap_x_raw": 0.60, "shift_raw": -0.085},
        "arms": True,''', '''        "eject": {"y": 0.10, "z_rel": -0.002},
        "sights": "none",
        "stock_fix": {"gap_x_raw": 0.60, "shift_raw": -0.085},
        "mag": {"y0": -0.140, "y1": -0.050, "z_max": -0.020},   # box magazine
        "arms": True,''')

# pike: authored mag inside the grip
rep('''        "eject": {"y": 0.01, "z_rel": -0.002},
        "sights": "pistol",
        "arms": True,''', '''        "eject": {"y": 0.01, "z_rel": -0.002},
        "sights": "pistol",
        "mag": {"authored": True, "cy": 0.0, "wy": 0.056, "wx": 0.024, "z0": -0.074, "z1": -0.012},
        "arms": True,''')

# breaker: pump forend splits off
rep('''        "eject": {"y": 0.090, "z_rel": 0.004},
        "sights": "iron_low",
        "arms": True,
    },''', '''        "eject": {"y": 0.090, "z_rel": 0.004},
        "sights": "iron_low",
        "pump": {"y0": 0.205, "y1": 0.455, "z_min": 0.028, "z_max": 0.078},   # pump forend
        "arms": True,
    },''')
rep('"iron_base_rel": 0.016,    # barrel/receiver top', '"iron_base_rel": 0.011,    # barrel/receiver top')
open(p, "w", encoding="utf-8").write(s)
print("patched")
