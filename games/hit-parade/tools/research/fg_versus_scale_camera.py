"""Derive HIT PARADE versus spacing (metres) and side-on camera distances.

Inputs are the SF6 roster medians measured by fg_sf6_class_stats.py
(_research/fighting/sf6_class_stats.txt). SuperCombo does not define the SF6
distance unit in the pages we read, so we only borrow RATIOS and convert with an
explicit, tunable scale K (metres per SF6 unit). K is anchored on one
assumption: an average SF6 standing light (median atkRange 1.13 u) should reach
~0.85 m from the body centre for a 1.8 m fighter (arm ~0.7 m + shoulder offset),
giving K = 0.85 / 1.13 = 0.75 m/u.

Camera model: side-on pinhole camera on the +Z axis looking at the fight plane
(z = 0). three.js PerspectiveCamera.fov is VERTICAL. For fighter separation s
(centre to centre), the frame must hold s/2 + body half-width + margin on each
side horizontally, and fighter height + headroom vertically.
ASCII only. Usage: python fg_versus_scale_camera.py
"""
import math

K = 0.85 / 1.13          # metres per SF6 unit (assumption, see docstring)
H = 1.8                  # fighter height, m
BODY_HALF = 0.35         # half body width incl. guard pose, m
MARGIN = 0.9             # screen-edge breathing room beyond each body, m
HEADROOM = 0.45          # space above head, m (floor shown below feet too)

SF6 = [  # (label, SF6 median value, unit)  from sf6_class_stats.txt
    ("throw range", 0.80, "u"),
    ("standing light reach (atkRange)", 1.13, "u"),
    ("crouching light reach", 1.08, "u"),
    ("standing medium reach", 1.47, "u"),
    ("crouching medium reach", 1.45, "u"),
    ("standing heavy reach", 1.77, "u"),
    ("sweep reach", 1.84, "u"),
    ("drive impact reach", 2.52, "u"),
    ("forward dash distance", 1.41, "u"),
    ("back dash distance", 0.90, "u"),
    ("forward jump distance", 1.90, "u"),
    ("jump apex", 2.12, "u"),
    ("forward walk speed", 0.047, "u/f"),
    ("back walk speed", 0.032, "u/f"),
    ("light pushback on block", 0.36, "u"),
]


def hfov(vfov_deg, aspect):
    return math.degrees(2 * math.atan(math.tan(math.radians(vfov_deg) / 2) * aspect))


def dist_for_sep(sep, vfov_deg, aspect):
    half_w = sep / 2 + BODY_HALF + MARGIN
    d_h = half_w / math.tan(math.radians(hfov(vfov_deg, aspect)) / 2)
    half_h = (H + HEADROOM) / 2 + 0.25  # a little floor below the feet
    d_v = half_h / math.tan(math.radians(vfov_deg) / 2)
    return max(d_h, d_v), d_h, d_v


def fill(d, vfov_deg):
    return H / (2 * d * math.tan(math.radians(vfov_deg) / 2))


def main():
    print("Scale K = %.3f m per SF6 unit (assumption: 1.13 u light reach = 0.85 m)" % K)
    print("%-34s %9s %10s" % ("SF6 median", "SF6", "HIT PARADE"))
    for label, v, unit in SF6:
        if unit == "u/f":
            print("%-34s %6.3f u/f %6.2f m/s" % (label, v, v * K * 60))
        else:
            print("%-34s %6.2f u   %6.2f m" % (label, v, v * K))
    print()
    print("Side-on camera distance (m) to frame separation s; fighter fill %% of frame height")
    for aspect_name, aspect in (("16:9", 16 / 9), ("19.5:9 phone", 19.5 / 9), ("4:3", 4 / 3)):
        print("aspect %s" % aspect_name)
        print("  s(m) | vFOV30 d / fill | vFOV35 d / fill | vFOV40 d / fill")
        for sep in (0.8, 1.2, 1.8, 2.5, 3.0, 4.0, 5.0, 6.0):
            cells = []
            for v in (30, 35, 40):
                d, _, _ = dist_for_sep(sep, v, aspect)
                cells.append("%5.2f / %3.0f%%" % (d, 100 * fill(d, v)))
            print("  %4.1f | %s | %s | %s" % (sep, cells[0], cells[1], cells[2]))
    print()
    # the minimum distance is set by the vertical need (full body + headroom)
    for v in (30, 35, 40):
        _, _, dv = dist_for_sep(0.0, v, 16 / 9)
        print("vFOV %d: vertical floor distance %.2f m (fill %.0f%%)" % (v, dv, 100 * fill(dv, v)))
    print()
    # perspective depth distortion: relative size change for a 0.5 m depth offset
    for v in (30, 35, 40, 55):
        d, _, _ = dist_for_sep(3.0, v, 16 / 9)
        print("vFOV %d at s=3.0 m: camera %.2f m; an object 0.5 m nearer the camera looks %.0f%% bigger"
              % (v, d, 100 * (d / (d - 0.5) - 1)))


if __name__ == "__main__":
    main()
