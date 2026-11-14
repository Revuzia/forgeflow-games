"""Pinhole camera framing calculator for HIT PARADE camera recommendations.

Computes, for a vertical FOV (three.js PerspectiveCamera.fov is VERTICAL):
  - distance needed for a subject of height H to fill fraction f of frame height
  - fill fraction at a given distance
  - horizontal FOV at 16:9 and at 9:19.5 (portrait phone) / 19.5:9 (landscape phone)
  - distance needed to keep a group of radius R in frame horizontally
Also converts the UE5 third-person template default (TargetArmLength 400 cm,
FieldOfView 90 deg HORIZONTAL) to vertical FOV and fill fraction for comparison.

ASCII only. Usage: python camera_framing.py
"""
import math

H = 1.8  # hero height, metres


def vfov_from_hfov(hfov_deg, aspect):
    return math.degrees(2 * math.atan(math.tan(math.radians(hfov_deg) / 2) / aspect))


def hfov_from_vfov(vfov_deg, aspect):
    return math.degrees(2 * math.atan(math.tan(math.radians(vfov_deg) / 2) * aspect))


def dist_for_fill(vfov_deg, fill, h=H):
    visible = h / fill
    return (visible / 2) / math.tan(math.radians(vfov_deg) / 2)


def fill_at(vfov_deg, d, h=H):
    visible = 2 * d * math.tan(math.radians(vfov_deg) / 2)
    return h / visible


def dist_for_group(vfov_deg, aspect, radius, margin=1.15):
    hf = math.radians(hfov_from_vfov(vfov_deg, aspect))
    return (radius * margin) / math.tan(hf / 2)


def main():
    a169 = 16 / 9
    ue_v = vfov_from_hfov(90, a169)
    print("UE5 template: hFOV 90 @16:9 -> vFOV %.1f deg; fill of 1.8 m at 4.0 m = %.0f%%"
          % (ue_v, 100 * fill_at(ue_v, 4.0)))
    print()
    print("vFOV | dist for 60%% fill | 50%% | 40%% | hFOV@16:9 | hFOV@19.5:9")
    for v in (45, 50, 55, 60, 65):
        print("%4d | %6.2f m | %6.2f m | %6.2f m | %5.1f | %5.1f" % (
            v, dist_for_fill(v, 0.60), dist_for_fill(v, 0.50), dist_for_fill(v, 0.40),
            hfov_from_vfov(v, a169), hfov_from_vfov(v, 19.5 / 9)))
    print()
    print("Group framing: distance so a ring of radius R around the hero fits horizontally (15% margin)")
    print("R(m) | vFOV55@16:9 | vFOV60@16:9 | vFOV60@9:19.5 portrait")
    for r in (2.0, 3.0, 4.0, 5.0, 6.0):
        print("%4.1f | %6.2f m | %6.2f m | %6.2f m" % (
            r, dist_for_group(55, a169, r), dist_for_group(60, a169, r),
            dist_for_group(60, 9 / 19.5, r)))
    print()
    for v, d in ((55, 3.0), (55, 2.2), (60, 5.0), (50, 2.2)):
        print("vFOV %d at %.1f m -> hero fills %.0f%% of frame height" % (v, d, 100 * fill_at(v, d)))


if __name__ == "__main__":
    main()
