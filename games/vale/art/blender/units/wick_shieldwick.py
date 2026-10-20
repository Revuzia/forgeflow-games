"""shieldwick: the melee Wick (1.1 m). Round shield on the left arm, a short lamp-mace in the right.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_shieldwick.py -- [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]
    Blender -b --factory-startup --python art/blender/proto/wick_shieldwick_fit.py -- [--faction aubade]   # silhouette fit check

Builds shieldwick_aubade + shieldwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's shieldwick.glb (frozen: legacy_props below and the legacy body in wick_common are untouched).
Brief: _design/units/wicks.md (§0 hard rules, §3.1 shieldwick, §4 accent, §5.2 projection). Concepts:
_design/concept/wicks/shieldwick_{aubade,serenade}.webp. Progress log: art/renders/units/_wick_shieldwick_progress.md.

ART 2.0 (HANDOFF.md): numpy SDF volumes fitted to each concept on a 5/10 cm grid (the fit overlay:
proto/wick_shieldwick_fit.py), the concept painting projected occlusion-aware onto the game mesh, normals + AO
baked from the sculpt. Coordinates: Blender, Z up, the model faces -Y, the wick's RIGHT hand (the mace) at -X.

  Aubade (west, dawn)    rounded linen cowl with a carved chalk rim, a short two-ball chalk knob (crown 1.00 m,
                         knob top 1.08 m = 7 % of the figure), an accent seam brow -> crown -> nape; straight-fold
                         blue-grey cloak with a pointed hem, a dark ironstone hem band and a chalk stole; chalk
                         disc shield (vertical rib with short spire points, dawnglass ring + accent boss); a tall
                         four-sided chalk lantern-mace with accent windows and a pointed cap.
  Serenade (east, dusk)  low broad sand-felt dome (crown 1.08 m) on a thick dark rolled collar, an accent crown
                         band over the brow, a sand mantle; wide umber bell cloak with two ironstone hem bands;
                         domed ironstone shield with four sandstone pads, lampresin ring + accent boss; a squat
                         round caged lantern (accent globe) on a walnut haft.
Shared (the job silhouette): the same rig, clips and layout: the disc on the left arm turned ~40 degrees out,
the lantern-mace raised on the right, the hood ~1/3 of the height, boots under a bell cloak.

Hard rule §0.1: neither hood is pointed or conical. The Aubade concept's small hood flap is dropped (the nape
is swept back and down instead); its only point-like forms are the knob (8 cm), the shield rib points and the
lantern cap. No face: the hood hollow is an ink lining with one soft accent volume set back inside it.

Not in wick_common, implemented here (wrapped, not forked):
  * per-faction arm joints (rig_extras): the concepts' fists; prop.R re-aimed up the mace haft, prop.L along the
    shield's face normal, so the clips aim the mace and the shield directly;
  * bespoke clips idle / run / attack1 / death (brief §3.1 motion) on a minion-sized leg (short swing, quick
    cadence, planted feet at the content moveSpeed);
  * PALETTE FIT: the projected painting is moved part by part onto the faction palette (median -> role colour,
    per channel in linear light, the painted detail kept), which grades the Serenade concept's saturation, lifts
    the top band and darkens the Aubade hem band (brief §2.3-§2.4, §5.2). common.hifi.project.paint_object is
    wrapped at import time; the wrapper only acts on a PROJECTION that carries "palette_fit".
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import wick_common as wc  # noqa: E402
from wick_common import sdf  # noqa: E402
from wick_common import Ellipsoid, Lathe, Sculpt, Torus  # noqa: E402
from common import anim, fighter, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project  # noqa: E402
from common.hifi.sdf import Blend, Capsule, Prim, RoundBox, RoundCone, Sphere, Tube  # noqa: E402

NOISE = sdf.Noise(29)
VOXEL = 0.0045


# ── extra SDF prims (module-local) ──────────────────────────────────────────────────────────────────
class Bell(Prim):
    """Elliptic loft about a vertical axis: half-width a(z), half-depth b(z), centre y cy(z), piecewise linear
    over zs; the bottom at hem(x, y) (default zs[0]), the top cut at zs[-1]. Approximate distance."""

    def __init__(self, zs, a, b, cy=0.0, cx=0.0, hem=None):
        self.zs = np.asarray(zs, dtype=np.float64)
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.cy = np.broadcast_to(np.asarray(cy, dtype=np.float64), self.zs.shape).copy()
        self.cx = float(cx)
        self.hem = hem

    def bounds(self):
        A, B = self.a.max(), self.b.max()
        return (np.array([self.cx - A, self.cy.min() - B, self.zs[0] - 0.06]),
                np.array([self.cx + A, self.cy.max() + B, self.zs[-1]]))

    def d(self, P):
        z = P[:, 2]
        a = np.interp(z, self.zs, self.a)
        b = np.interp(z, self.zs, self.b)
        cy = np.interp(z, self.zs, self.cy)
        x, y = P[:, 0] - self.cx, P[:, 1] - cy
        q = np.sqrt((x / a) ** 2 + (y / b) ** 2)
        dr = (q - 1.0) * np.minimum(a, b)
        bot = self.hem(x, P[:, 1]) if self.hem is not None else self.zs[0]
        return np.maximum(np.maximum(dr, bot - z), z - self.zs[-1])


class Shell(Prim):
    """The skin between `inn` inside and `out` outside another prim's surface (bands, stoles, linings)."""

    def __init__(self, base: Prim, out: float, inn: float = 0.0):
        self.base, self.out, self.inn = base, float(out), float(inn)

    def bounds(self):
        lo, hi = self.base.bounds()
        return lo - self.out, hi + self.out

    def d(self, P):
        d = self.base.d(P)
        return np.maximum(d - self.out, -d - self.inn)


class Inter(Prim):
    """Hard intersection of prims; bounds of the first (or given)."""

    def __init__(self, *prims, bounds=None):
        self.prims = prims
        self._b = bounds

    def bounds(self):
        return self._b if self._b is not None else self.prims[0].bounds()

    def d(self, P):
        out = self.prims[0].d(P)
        for p in self.prims[1:]:
            out = np.maximum(out, p.d(P))
        return out


class Fn(Prim):
    """A distance-like field from a function of P (cuts: bands by height, strips), with explicit bounds."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def tri_wave(phi, n):
    """0 at n evenly spaced tips round the hem (the first one at the front, phi = -90 deg), 1 between them."""
    u = (phi + math.pi / 2) * n / (2 * math.pi)
    return np.abs((u % 1.0) - 0.5) * 2.0


def folds(amp, freq, phase=0.0, zfade=None, sharp=1.0):
    """Vertical cloth folds round the Z axis (radial ridges by azimuth), warped by noise."""
    def fn(P):
        ang = np.arctan2(P[:, 1], P[:, 0])
        s = np.abs(np.sin(ang * freq + phase + 0.5 * NOISE(P, 3.0)))
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return a * (s ** sharp * 2.0 - 1.0) * -0.5
    return fn


def felt(amp, freq=11.0):
    """Soft felt lumps (Serenade felt and the rolled collar)."""
    return lambda P: amp * NOISE.fbm(P, freq, 2)


def surface_point(prim: Prim, origin, direction, t0=0.0, t1=0.6, iters=40) -> np.ndarray:
    """The first zero of prim.d along origin + t * direction (bisection from inside to outside)."""
    o = np.asarray(origin, dtype=np.float64)
    dr = np.asarray(direction, dtype=np.float64)
    dr = dr / np.linalg.norm(dr)
    lo, hi = t0, t1
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if prim.d((o + dr * mid)[None, :])[0] < 0:
            lo = mid
        else:
            hi = mid
    return o + dr * 0.5 * (lo + hi)


def ring_axes(normal, sx=1.0, sy=1.0):
    """Torus frame with local Z = `normal`, X near world X; the ring's radius scaled by sx (X) and sy (Y)."""
    F = sdf.frame(normal, (1.0, 0.0, 0.0))
    return np.diag([1.0 / sx, 1.0 / sy, 1.0]) @ F


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


# ── the two cultures: measurements off each concept (metres; the wick's right hand at -X, front -Y) ─────
# S = shoulder joint (the rig's), E elbow, W wrist, G the grip (mitt centre; the mace haft runs through G.R)
FACTION = {
    "aubade": {
        "plate_height": 1.04,                     # plate top row 236 (the knob base) on the measuring grid
        "E": {"R": (-0.215, 0.035, 0.480), "L": (0.215, 0.035, 0.475)},
        "W": {"R": (-0.268, -0.015, 0.428), "L": (0.240, -0.020, 0.375)},
        "G": {"R": (-0.305, -0.050, 0.398), "L": (0.250, -0.045, 0.325)},
        "mace_u": unit((-0.257, 0.0, 0.966)),     # haft axis (pommel 0.263 -> cap tip 0.745), 15 deg out
        "shield_c": (0.210, -0.135, 0.441), "shield_turn": 40.0, "shield_r": 0.230,
    },
    "serenade": {
        "plate_height": 1.08,                     # plate top row 220 = the dome crown
        "E": {"R": (-0.235, 0.035, 0.515), "L": (0.235, 0.035, 0.515)},
        "W": {"R": (-0.278, -0.020, 0.468), "L": (0.275, -0.020, 0.465)},
        "G": {"R": (-0.335, -0.060, 0.400), "L": (0.300, -0.045, 0.390)},
        "mace_u": unit((-0.280, 0.0, 0.960)),
        "shield_c": (0.240, -0.160, 0.440), "shield_turn": 41.0, "shield_r": 0.220,
    },
}
ANKLE_X = 0.115


def shoulder(side: str) -> np.ndarray:
    """The rig's shoulder joint (rig._layout with PROPORTIONS below)."""
    return np.array([(-1 if side == "R" else 1) * 0.16, 0.018, 0.566])


def shield_frame(F):
    """(centre, normal n, in-plane horizontal t, up) of the shield: the face turned `shield_turn` out from -Y."""
    a = math.radians(F["shield_turn"])
    n = np.array([math.sin(a), -math.cos(a), 0.0])
    t = np.array([math.cos(a), math.sin(a), 0.0])
    return np.asarray(F["shield_c"], dtype=np.float64), n, t, np.array([0.0, 0.0, 1.0])


# ── parts: (name, Sculpt, voxel scale, material role, bind, tris) ─────────────────────────────────────
def _arm_parts(F, out, sleeve_r, mitt, cuff_role, cuff_kind):
    """Sleeves (upper arm -> forearm by distance), forearm wraps / cuffs, mitts, per side."""
    for s in ("R", "L"):
        S = shoulder(s)
        E, W, G = (np.asarray(F[k][s]) for k in ("E", "W", "G"))
        fd = unit(W - E)
        sl = Sculpt(f"sleeve_{s}")
        sl.add(RoundCone(tuple(S + np.array([0, 0, -0.01])), tuple(E), sleeve_r[0], sleeve_r[1]), k=0.0)
        sl.add(RoundCone(tuple(E), tuple(W + fd * 0.005), sleeve_r[1], sleeve_r[2]), k=0.03)
        sl.add(Sphere(tuple(E + np.array([0, 0.01, 0])), sleeve_r[1] * 1.04), k=0.02)
        out.append((f"sleeve_{s}", sl, 1.0, "cloth", ("dblend", f"upper_arm.{s}", f"forearm.{s}", tuple(E), tuple(fd), -0.025, 0.025), 90))
        cf = Sculpt(f"{cuff_kind}_{s}")
        if cuff_kind == "wraps":
            for i, tt in enumerate((0.12, 0.42, 0.72)):
                c = E + (W - E) * tt
                cf.add(Torus(tuple(c), sleeve_r[1] * 0.98, 0.0135, axes=sdf.frame(fd + np.array([0, 0, 0.12 * (i - 1)]))), k=0.006)
        else:
            cf.add(Torus(tuple(W - fd * 0.012), sleeve_r[2] * 0.98, 0.017, axes=sdf.frame(fd)), k=0.0)
        out.append((f"{cuff_kind}_{s}", cf, 0.8, cuff_role, f"bone:forearm.{s}", 60))
        hd = unit(G - W)
        m = Sculpt(f"mitt_{s}")
        m.add(Ellipsoid(tuple(G), mitt, axes=sdf.frame(hd, (1.0, 0.0, 0.0))), k=0.0)
        m.add(RoundCone(tuple(W + hd * 0.005), tuple(G), mitt[0] * 0.78, mitt[0] * 0.92), k=0.02)
        # the thumb: a lobe on the inner-front side, over the grip
        inward = np.array([1.0 if s == "R" else -1.0, -0.6, 0.35])
        tb = G + unit(inward) * (mitt[0] * 0.85)
        m.add(Capsule(tuple(G + unit(inward) * 0.02 + np.array([0, 0, 0.02])), tuple(tb), mitt[0] * 0.42), k=0.012)
        out.append((f"mitt_{s}", m, 0.8, "leather", f"bone:hand.{s}", 64))


def _legs_boots(out, boot_half, boot_r, toe_out=10.0):
    for s, sx in (("R", -1.0), ("L", 1.0)):
        an = np.array([sx * ANKLE_X, 0.02, 0.055])
        lg = Sculpt(f"leg_{s}")
        lg.add(Capsule(tuple(an + np.array([0, 0.0, 0.03])), tuple(an + np.array([sx * -0.02, -0.01, 0.17])), 0.036), k=0.0)
        out.append((f"leg_{s}", lg, 1.2, "under", f"bone:shin.{s}", 16))
        b = Sculpt(f"boot_{s}")
        rz = sdf.rot_z(sx * toe_out)
        c = an + np.array([0.0, -0.045, -0.01])
        b.add(RoundBox(tuple(c), boot_half, boot_r, axes=rz.T), k=0.0)
        b.add(Ellipsoid(tuple(an + np.array([0, 0.0, 0.035])), (boot_half[0] * 0.95, boot_half[0] * 1.0, 0.06)), k=0.03)
        b.inter(sdf.HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
        out.append((f"boot_{s}", b, 1.0, "leather", f"bone:foot.{s}", 70))


def parts_aubade(F) -> list:
    out = []
    cloak_bind = ("zblend", "hips", "chest", 0.40, 0.60)

    # CLOAK: a straight-fold bell, shoulders x 0.205 at 0.55 -> hem x 0.262 at 0.10, eight shallow hem points
    def hem(x, y):
        phi = np.arctan2(y - 0.015, x)
        return 0.100 + 0.024 * tri_wave(phi, 8)
    bell = Bell([0.095, 0.15, 0.30, 0.45, 0.55, 0.635], [0.262, 0.258, 0.240, 0.222, 0.205, 0.150],
                [0.216, 0.210, 0.192, 0.172, 0.158, 0.118], cy=0.015, hem=hem)
    cloak_p = Blend([("add", bell.displaced(folds(0.011, 5.5, 0.4, zfade=(0.60, 0.15), sharp=0.7), 0.011), 0.0),
                     ("add", Ellipsoid((0, 0.015, 0.548), (0.207, 0.160, 0.072)), 0.04)])
    cloak = Sculpt("cloak")
    cloak.add(cloak_p, k=0.0)
    out.append(("cloak", cloak, 1.0, "cloth", cloak_bind, 500))
    # the ironstone hem band (6-7 cm over the points; brief §2.4: the feet band reads dark)
    band = Sculpt("hem_band")
    bcut = Fn(lambda P: P[:, 2] - (0.168 + 0.024 * tri_wave(np.arctan2(P[:, 1] - 0.015, P[:, 0]), 8)),
              (-0.3, -0.26, 0.06), (0.3, 0.26, 0.21))
    band.add(Inter(Shell(cloak_p, 0.0065, 0.004), bcut, bounds=bcut.bounds()), k=0.0)
    out.append(("hem_band", band, 0.8, "ironstone", cloak_bind, 110))
    # the chalk stole: two strips down the front with pointed ends (front view x -0.155..-0.09 and 0..0.066)
    stole = Sculpt("stole")
    for xc, w in ((-0.122, 0.031), (0.033, 0.032)):
        strip = Fn(lambda P, xc=xc, w=w: np.maximum.reduce([np.abs(P[:, 0] - xc) - w, P[:, 2] - 0.585,
                                                           (0.132 + 1.3 * np.abs(P[:, 0] - xc)) - P[:, 2], P[:, 1] + 0.02]),
                   (xc - w - 0.01, -0.30, 0.12), (xc + w + 0.01, 0.0, 0.60))
        stole.add(Inter(Shell(cloak_p, 0.012, 0.004), strip, bounds=strip.bounds()), k=0.0)
    out.append(("stole", stole, 0.8, "chalk", cloak_bind, 90))
    # the linen scarf under the hood: a soft roll with a V-point at the front
    scarf = Sculpt("scarf")
    scarf.add(Torus((-0.01, 0.012, 0.618), 0.128, 0.050, rz=0.040), k=0.0)
    scarf.add(RoundCone((-0.03, -0.115, 0.628), (-0.05, -0.160, 0.560), 0.055, 0.018), k=0.04)
    scarf.add(Ellipsoid((-0.01, 0.012, 0.635), (0.16, 0.14, 0.035)), k=0.03)
    out.append(("scarf", scarf, 1.0, "cloth2", "bone:chest", 130))

    # HOOD: a rounded cowl (dome 1.01 m), a bell flare at the base, the nape swept back and down; the opening
    # an upright ellipse 0.29 x 0.25 m centred (-0.02, 0.778) framed by a carved chalk rim
    hc = np.array([-0.02, 0.035, 0.81])
    open_c = np.array([-0.02, -0.15, 0.776])
    lip_n = unit((0.0, -0.97, 0.20))
    outer = Blend([("add", Ellipsoid(tuple(hc), (0.205, 0.215, 0.200)), 0.0),
                   ("add", Ellipsoid((-0.02, 0.050, 0.700), (0.214, 0.214, 0.085)), 0.06),
                   ("add", Ellipsoid((-0.02, 0.145, 0.738), (0.165, 0.105, 0.115)), 0.05),
                   ("add", Torus((-0.02, -0.166, 0.778), 0.166, 0.036, axes=ring_axes(lip_n, 1.0, 0.84)), 0.04)])
    carve = Ellipsoid(tuple(open_c), (0.145, 0.25, 0.123))
    hood = Sculpt("hood")
    hood.add(outer, k=0.0)
    hood.sub(Ellipsoid(tuple(open_c), (0.157, 0.262, 0.135)), k=0.018)
    out.append(("hood", hood, 1.0, "cloth2", "bone:head", 430))
    lining = Sculpt("hood_lining")
    lining.add(Inter(Shell(carve, 0.022, 0.0), outer, bounds=carve.bounds()), k=0.0)
    out.append(("hood_lining", lining, 1.0, "ink", "bone:head", 380))
    rim = Sculpt("hood_rim")
    rim.add(Torus((-0.02, -0.188, 0.779), 0.166, 0.022, axes=ring_axes(lip_n, 1.0, 0.845), rz=0.015), k=0.0)
    out.append(("hood_rim", rim, 0.7, "chalk", "bone:head", 130))
    # the accent seam: brow (above the rim) -> over the crown -> down the back to the nape
    pts = []
    for th in (50, 62, 75, 90, 105, 120, 135, 150, 165, 180, 196):
        a = math.radians(th)
        p = surface_point(outer, hc + np.array([0, 0, -0.02]), (0.0, -math.cos(a), math.sin(a)), 0.05, 0.5)
        nrm = unit(p - (hc + np.array([0, 0, -0.02])))
        pts.append(tuple(p - nrm * 0.004))
    seam = Sculpt("hood_seam")
    seam.add(Tube(pts, [0.022] * len(pts), k=0.01), k=0.0)
    out.append(("hood_seam", seam, 0.7, "accent", "bone:head", 70))
    knob = Sculpt("knob")
    top = surface_point(outer, hc, (0, 0, 1), 0.05, 0.4)
    kz = top[2] - 0.006
    knob.add(Torus((-0.02, top[1], kz + 0.004), 0.026, 0.011), k=0.0)
    knob.add(Sphere((-0.02, top[1], kz + 0.031), 0.031), k=0.008)
    knob.add(Sphere((-0.02, top[1], kz + 0.066), 0.019), k=0.004)
    out.append(("knob", knob, 0.6, "chalk", "bone:head", 110))
    light = Sculpt("hood_light")
    light.add(Ellipsoid((-0.02, 0.020, 0.735), (0.088, 0.040, 0.056)), k=0.0)
    out.append(("hood_light", light, 0.8, "accent", "bone:head", 130))

    # ARMS, LEGS
    _arm_parts(F, out, (0.050, 0.047, 0.045), (0.050, 0.046, 0.058), "chalk", "wraps")
    _legs_boots(out, (0.062, 0.090, 0.046), 0.034)

    # SHIELD (left hand): a chalk disc 0.46 m, convex face, raised rim, a vertical rib with short spire points
    c, n, t, up = shield_frame(F)
    R = F["shield_r"]
    axl = np.stack([t, up, n])                      # local Z = n (the face looks out along n)

    def disc_prof(r, z):
        face = 0.010 + 0.016 * (1 - np.clip(r / R, 0, 1) ** 2)
        return np.maximum(np.maximum(r - R, -0.022 - z), z - face)
    sh = Sculpt("shield")
    sh.add(Lathe(tuple(c), disc_prof, R + 0.01, -0.03, 0.04, axes=axl), k=0.0)
    sh.add(Torus(tuple(c + n * 0.010), R - 0.016, 0.017, axes=axl, rz=0.016), k=0.006)
    rib_lo, rib_hi = c - up * (R + 0.03) + n * 0.022, c + up * (R + 0.075) + n * 0.022
    sh.add(RoundCone(tuple(c + n * 0.03), tuple(rib_hi), 0.024, 0.004), k=0.01)
    sh.add(RoundCone(tuple(c + n * 0.03), tuple(rib_lo), 0.024, 0.006), k=0.01)
    sh.add(Ellipsoid(tuple(c + n * 0.03), (0.075, 0.075, 0.016), axes=axl), k=0.02)
    out.append(("shield", sh, 0.8, "chalk", "bone:hand.L", 210))
    ring = Sculpt("shield_ring")
    ring.add(Torus(tuple(c + n * 0.044), 0.060, 0.013, axes=axl), k=0.0)
    out.append(("shield_ring", ring, 0.6, "dawnglass", "bone:hand.L", 40))
    boss = Sculpt("shield_boss")
    boss.add(Ellipsoid(tuple(c + n * 0.046), (0.058, 0.058, 0.028), axes=axl), k=0.0)
    # the inlaid accent ring on the face (the concept's inner ring line), crossed by the rib
    zf = 0.010 + 0.016 * (1 - (0.150 / R) ** 2)
    boss.add(Torus(tuple(c + n * (zf - 0.002)), 0.150, 0.013, axes=axl, rz=0.010), k=0.0)
    out.append(("shield_boss", boss, 0.6, "accent", "bone:hand.L", 100))

    # LANTERN-MACE (right hand): pale ash haft through the fist, a tall four-sided chalk lantern 0.12 m wide with
    # accent windows, a pointed chalk cap (tip 0.745 m)
    G = np.asarray(F["G"]["R"])
    u = F["mace_u"]
    fr = np.stack([unit(np.cross((0.0, -1.0, 0.0), u)), np.array([0.0, -1.0, 0.0]), u])   # local Z = u
    lax = sdf.rot_z(45.0) @ fr                                                              # the lantern turned 45 deg
    at = lambda s: G + u * s                                                                 # noqa: E731
    haft = Sculpt("haft")
    haft.add(Capsule(tuple(at(-0.125)), tuple(at(0.12)), 0.022), k=0.0)
    out.append(("haft", haft, 0.8, "wood", "bone:hand.R", 50))
    lan = Sculpt("lantern")
    lan.add(RoundCone(tuple(at(-0.155)), tuple(at(-0.115)), 0.016, 0.030), k=0.0)                # pommel
    lan.add(RoundBox(tuple(at(0.112)), (0.050, 0.050, 0.014), 0.008, axes=lax), k=0.0)            # base plate
    lan.add(RoundCone(tuple(at(0.07)), tuple(at(0.105)), 0.024, 0.036), k=0.01)                    # neck
    for i in range(4):
        a = math.radians(45 + 90 * i)
        off = (lax[0] * math.cos(a) + lax[1] * math.sin(a)) * 0.064
        lan.add(Capsule(tuple(at(0.12) + off), tuple(at(0.235) + off), 0.0125), k=0.004)          # corner posts
    lan.add(RoundBox(tuple(at(0.243)), (0.058, 0.058, 0.012), 0.008, axes=lax), k=0.006)          # top plate
    lan.add(RoundCone(tuple(at(0.25)), tuple(at(0.345)), 0.050, 0.004), k=0.01)                    # pointed cap
    lan.add(Sphere(tuple(at(0.30)), 0.012), k=0.0)
    out.append(("lantern", lan, 0.6, "chalk", "bone:hand.R", 150))
    core = Sculpt("lantern_core")
    core.add(RoundBox(tuple(at(0.178)), (0.051, 0.051, 0.062), 0.012, axes=lax), k=0.0)
    out.append(("lantern_core", core, 0.7, "accent", "bone:hand.R", 40))
    return out


def parts_serenade(F) -> list:
    out = []
    cloak_bind = ("zblend", "hips", "chest", 0.40, 0.60)

    # CLOAK: a wide umber bell, hem x 0.31 at 0.06, soft rounded folds
    def hem(x, y):
        return 0.063 + 0.006 * np.sin(np.arctan2(y, x) * 5.0)
    bell = Bell([0.057, 0.10, 0.16, 0.30, 0.45, 0.56, 0.640], [0.312, 0.305, 0.294, 0.272, 0.255, 0.238, 0.180],
                [0.258, 0.252, 0.242, 0.222, 0.202, 0.186, 0.140], cy=0.02, hem=hem)
    cloak_p = Blend([("add", bell.displaced(lambda P: folds(0.010, 3.5, 1.1, zfade=(0.55, 0.12), sharp=1.6)(P)
                                            + felt(0.0025, 14.0)(P), 0.0125), 0.0),
                     ("add", Ellipsoid((0, 0.02, 0.560), (0.238, 0.186, 0.075)), 0.04),
                     ("add", Bell([0.057, 0.08, 0.135], [0.312, 0.310, 0.296], [0.260, 0.258, 0.245], cy=0.02, hem=hem), 0.02)])
    cloak = Sculpt("cloak")
    cloak.add(cloak_p, k=0.0)
    out.append(("cloak", cloak, 1.0, "cloth", cloak_bind, 470))
    band = Sculpt("hem_bands")
    bcut = Fn(lambda P: np.minimum(np.maximum(P[:, 2] - 0.207, 0.171 - P[:, 2]), P[:, 2] - 0.090),
              (-0.34, -0.30, 0.03), (0.34, 0.30, 0.22))
    band.add(Inter(Shell(cloak_p, 0.007, 0.004), bcut, bounds=bcut.bounds()), k=0.0)
    out.append(("hem_bands", band, 0.8, "ironstone", cloak_bind, 120))
    # the sand mantle: a short cape over the shoulders, two rounded front flaps with a V between them
    def mantle_hem(x, y):
        front = np.clip(-(y - 0.01) / 0.12, 0.0, 1.0)
        flap = 0.552 + 0.042 * ((np.abs(x) - 0.13) / 0.13) ** 2
        v = 0.075 * np.clip(1.0 - np.abs(x) / 0.045, 0.0, 1.0)
        back = 0.566 + 0.008 * np.sin(np.abs(x) * 30.0)
        return back * (1 - front) + (flap + v) * front
    mantle = Sculpt("mantle")
    mbell = Bell([0.545, 0.58, 0.63, 0.67, 0.705], [0.276, 0.270, 0.252, 0.225, 0.180],
                 [0.226, 0.221, 0.205, 0.185, 0.150], cy=0.015, hem=mantle_hem)
    mantle.add(mbell.displaced(felt(0.003, 12.0), 0.003), k=0.0)
    mantle.add(Ellipsoid((0, 0.015, 0.640), (0.27, 0.22, 0.05)), k=0.03)
    out.append(("mantle", mantle, 1.0, "cloth2", "bone:chest", 160))
    collar = Sculpt("collar")
    collar.add(Torus((0.0, 0.012, 0.738), 0.165, 0.088, rz=0.084).displaced(felt(0.004, 10.0), 0.004), k=0.0)
    out.append(("collar", collar, 1.0, "ironstone", "bone:chest", 180))

    # HOOD: a broad sand-felt dome (crown 1.085, 0.42 m wide) sinking into the collar; arch opening 0.30 m
    hc = np.array([0.0, 0.010, 0.880])
    open_c = np.array([0.0, -0.165, 0.800])
    outer = Blend([("add", Ellipsoid(tuple(hc), (0.210, 0.215, 0.205)), 0.0),
                   ("add", RoundCone((0, 0.010, 0.86), (0, 0.010, 0.72), 0.207, 0.198), 0.03)])
    carve = Ellipsoid(tuple(open_c), (0.150, 0.25, 0.155))
    hood = Sculpt("hood")
    hood.add(outer.ops[0][1].displaced(felt(0.0025, 13.0), 0.0025), k=0.0)
    hood.add(outer.ops[1][1], k=0.03)
    hood.sub(Ellipsoid(tuple(open_c), (0.162, 0.262, 0.167)), k=0.016)
    out.append(("hood", hood, 1.0, "cloth2", "bone:head", 400))
    lining = Sculpt("hood_lining")
    lining.add(Inter(Shell(carve, 0.022, 0.0), outer, bounds=carve.bounds()), k=0.0)
    out.append(("hood_lining", lining, 1.0, "ink", "bone:head", 380))
    # the rolled felt lip round the opening: a tube along the cut edge, on the dome's curved front
    lip = []
    for i in range(15):
        psi = math.radians(-112 + 224 * i / 14)
        x, z = 0.172 * math.sin(psi), 0.800 + 0.176 * math.cos(psi)
        p = surface_point(outer, (x, 0.010, z), (0.0, -1.0, 0.0), 0.0, 0.5)
        lip.append((x, p[1] + 0.012, z))
    rim = Sculpt("hood_rim")
    rim.add(Tube(lip, [0.026] * len(lip), k=0.0).displaced(felt(0.002, 14.0), 0.002), k=0.0)
    out.append(("hood_rim", rim, 0.8, "cloth2", "bone:head", 140))
    # the accent crown band: over the brow (front/back z 1.02) and down the sides (z 0.93), on the dome
    pts = []
    for i in range(25):
        phi = -math.pi + 2 * math.pi * i / 24
        z = 0.930 + 0.090 * math.sin(phi) ** 2
        p = surface_point(outer, (hc[0], hc[1], z), (math.cos(phi), math.sin(phi), 0.0), 0.02, 0.4)
        pts.append(tuple(p - np.array([math.cos(phi), math.sin(phi), 0.0]) * 0.006))
    band2 = Sculpt("crown_band")
    band2.add(Tube(pts, [0.023] * len(pts), k=0.0), k=0.0)
    out.append(("crown_band", band2, 0.7, "accent", "bone:head", 90))
    light = Sculpt("hood_light")
    light.add(Ellipsoid((0.0, 0.005, 0.785), (0.090, 0.040, 0.058)), k=0.0)
    out.append(("hood_light", light, 0.8, "accent", "bone:head", 130))

    # ARMS, LEGS
    _arm_parts(F, out, (0.058, 0.056, 0.060), (0.064, 0.060, 0.078), "ironstone", "cuff")
    _legs_boots(out, (0.062, 0.088, 0.046), 0.036)

    # SHIELD (left hand): a low ironstone dome 0.44 m with a rim, four sandstone pads, lampresin ring, accent boss
    c, n, t, up = shield_frame(F)
    R = F["shield_r"]
    axl = np.stack([t, up, n])

    def dome_prof(r, z):
        face = 0.008 + 0.040 * (1 - np.clip(r / R, 0, 1) ** 2)
        return np.maximum(np.maximum(r - R, -0.022 - z), z - face)
    sh = Sculpt("shield")
    sh.add(Lathe(tuple(c), dome_prof, R + 0.01, -0.03, 0.06, axes=axl).displaced(felt(0.002, 16.0), 0.002), k=0.0)
    sh.add(Torus(tuple(c + n * 0.004), R - 0.010, 0.020, axes=axl, rz=0.019), k=0.005)
    out.append(("shield", sh, 0.8, "ironstone", "bone:hand.L", 210))
    pads = Sculpt("shield_pads")
    for ang in (90.0, 0.0, 270.0, 180.0):
        a = math.radians(ang)
        rr = 0.125
        d2 = t * math.cos(a) + up * math.sin(a)
        zf = 0.008 + 0.040 * (1 - (rr / R) ** 2)
        pc = c + d2 * rr + n * (zf + 0.002)
        pads.add(Ellipsoid(tuple(pc), (0.048, 0.040, 0.013), axes=np.stack([unit(np.cross(n, d2)), d2, n])), k=0.0)
    out.append(("shield_pads", pads, 0.7, "sandstone", "bone:hand.L", 90))
    ring = Sculpt("shield_ring")
    ring.add(Torus(tuple(c + n * 0.050), 0.064, 0.015, axes=axl), k=0.0)
    out.append(("shield_ring", ring, 0.6, "lampresin", "bone:hand.L", 40))
    boss = Sculpt("shield_boss")
    boss.add(Ellipsoid(tuple(c + n * 0.050), (0.060, 0.060, 0.030), axes=axl), k=0.0)
    out.append(("shield_boss", boss, 0.6, "accent", "bone:hand.L", 50))

    # LANTERN-MACE (right hand): walnut haft, a squat round caged lantern (accent globe r 0.066), domed lid, ring
    G = np.asarray(F["G"]["R"])
    u = F["mace_u"]
    fr = np.stack([unit(np.cross((0.0, -1.0, 0.0), u)), np.array([0.0, -1.0, 0.0]), u])
    at = lambda s: G + u * s                                                                 # noqa: E731
    haft = Sculpt("haft")
    haft.add(Capsule(tuple(at(-0.13)), tuple(at(0.07)), 0.023), k=0.0)
    haft.add(RoundCone(tuple(at(-0.165)), tuple(at(-0.12)), 0.030, 0.022), k=0.012)
    out.append(("haft", haft, 0.8, "wood_dark", "bone:hand.R", 50))
    gc = at(0.146)
    cage = Sculpt("lantern")
    cage.add(Torus(tuple(at(0.074)), 0.034, 0.012, axes=fr), k=0.0)                               # base collar
    cage.add(RoundCone(tuple(at(0.06)), tuple(at(0.085)), 0.026, 0.040), k=0.008)
    for ang in (45.0, 135.0):
        a = math.radians(ang)
        pn = fr[0] * math.cos(a) + fr[1] * math.sin(a)                                            # meridian plane normal
        cage.add(Torus(tuple(gc), 0.074, 0.0078, axes=sdf.frame(pn, u)), k=0.0)
    cage.add(Ellipsoid(tuple(at(0.205)), (0.064, 0.064, 0.036), axes=fr), k=0.006)                # domed lid
    cage.add(Torus(tuple(at(0.201)), 0.064, 0.011, axes=fr), k=0.004)
    cage.add(Torus(tuple(at(0.258)), 0.019, 0.009, axes=sdf.frame(fr[1], u)), k=0.0)             # hanging ring
    cage.add(Capsule(tuple(at(0.23)), tuple(at(0.243)), 0.012), k=0.004)
    out.append(("lantern", cage, 0.6, "ironstone", "bone:hand.R", 140))
    core = Sculpt("lantern_core")
    core.add(Ellipsoid(tuple(gc), (0.071, 0.071, 0.064), axes=fr), k=0.0)
    out.append(("lantern_core", core, 0.7, "accent", "bone:hand.R", 50))
    return out


def make_low(high, name, col, tris, vox):
    """The game mesh of one part: the sculpt decimated to `tris`; where that stalls (surface nets leave non-manifold
    edges on thin shells, which stop the collapse decimator) a voxel remesh first, then the decimation."""
    import bpy
    from common import mesh
    low = mesh.duplicate(high, f"{name}_low", col)
    if mesh.decimate_to(low, tris, symmetric=False) <= tris * 1.1:
        low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))
        return low
    me = low.data
    bpy.data.objects.remove(low)
    bpy.data.meshes.remove(me)
    low = mesh.duplicate(high, f"{name}_low", col)
    m = low.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = max(0.0035, vox)
    m.adaptivity = 0.0
    mesh.apply_modifiers(low)
    mesh.decimate_to(low, tris, symmetric=False)
    low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))
    return low


# ── projection: plates graded for glow, then the palette fit (brief §5.2) ─────────────────────────────────
# Painted-median targets per part (hex, strength). The painting carries its own light, so a part's MEDIAN lands
# a step under its palette albedo (brief §2.3): lit planes then read at the palette value on screen instead of
# blowing out under the game sun. The Aubade hood keeps the concept's blue linen (L* 67, 21 % sat) rather than the
# near-white #BFC6CC (a pale hood read badly and too close to the banned look); the Serenade felt keeps its sand
# warmth inside the marigold band's 40 % limit.
AUBADE_CHALK = ("#CBC7BD", 0.9)                  # chalk #D6D3CA, a step down
PALETTE_FIT = {
    "aubade": {"hood": ("#93A7BA", 0.95), "scarf": ("#8597A9", 0.8), "hood_lining": ("#0E0F12", 1.0),
               "hood_rim": AUBADE_CHALK, "stole": AUBADE_CHALK, "shield": AUBADE_CHALK, "lantern": AUBADE_CHALK,
               "wraps_R": AUBADE_CHALK, "wraps_L": AUBADE_CHALK,
               "cloak": ("#62748A", 0.95), "sleeve_R": ("#62748A", 0.9), "sleeve_L": ("#62748A", 0.9),
               "hem_band": ("#3E434A", 1.0), "mitt_R": ("#3E4248", 0.8), "mitt_L": ("#3E4248", 0.8),
               "boot_R": ("#36373B", 0.8), "boot_L": ("#36373B", 0.8), "haft": ("#B2A48C", 0.8)},
    "serenade": {"hood": ("#B0916C", 0.95), "mantle": ("#B79A74", 0.95), "hood_rim": ("#9C8A70", 0.9),
                 "hood_lining": ("#100E0B", 1.0), "collar": ("#4B4039", 0.8),
                 "cloak": ("#765E4E", 0.95), "sleeve_R": ("#765E4E", 0.9), "sleeve_L": ("#765E4E", 0.9),
                 "hem_bands": ("#3F3530", 0.95), "cuff_R": ("#3F3530", 0.8), "cuff_L": ("#3F3530", 0.8),
                 "mitt_R": ("#45362C", 0.8), "mitt_L": ("#45362C", 0.8), "boot_R": ("#45362C", 0.8), "boot_L": ("#45362C", 0.8),
                 "shield": ("#4B4039", 0.8), "shield_pads": ("#AD9C80", 0.95), "haft": ("#5A4436", 0.8),
                 "lantern": ("#4B4039", 0.8)},
}
FLAT = {"aubade": {"knob": "#D0CCC2", "leg_R": "#3A3F47", "leg_L": "#3A3F47", "shield_ring": "#A9C4DC"},
        "serenade": {"leg_R": "#3B302A", "leg_L": "#3B302A", "shield_ring": "#A97F4C"}}
GLOW = {"aubade": (0.85, 0.20), "serenade": (0.80, 0.50)}


# Painted glow and painted accent lines to erase before projecting (brief §4, §5.4): accent geometry carries all the
# light, so the concept's painted halos, flame, lantern panes, boss glow and seams are refilled from the paint
# round them. Region-limited (model metres on each plate) so the Serenade's ochre pads and mantle keep their colour.
#   (sides, ("rect", x0, x1, z0, z1) | ("ell", cx, cz, rx, rz), test(r, g, b, v, s) -> mask)
ERASE = {
    "aubade": [
        (("front",), ("ell", -0.02, 0.778, 0.142, 0.121), lambda r, g, b, v, s: v > 0.30),               # hood flame
        (("front",), ("rect", -0.26, 0.22, 0.84, 1.12), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.74)),  # seams
        (("back",), ("rect", -0.06, 0.06, 0.66, 1.12), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.70)),
        (("front", "back"), ("rect", -0.48, -0.25, 0.46, 0.70), lambda r, g, b, v, s: (b - r > 0.06) & (v > 0.55)),  # panes
        (("front",), ("rect", 0.17, 0.34, 0.36, 0.52), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.55)),  # boss
    ],
    "serenade": [
        (("front", "back"), ("rect", -0.25, 0.25, 0.87, 1.10),
         lambda r, g, b, v, s: ((s > 0.38) & (v > 0.70) & (r > b)) | (v > 0.86)),                          # band
        (("front",), ("ell", 0.0, 0.80, 0.138, 0.143), lambda r, g, b, v, s: v > 0.30),                  # hood glow
        (("front", "back"), ("rect", -0.48, -0.28, 0.44, 0.64), lambda r, g, b, v, s: (s > 0.45) & (v > 0.55)),  # globe
        (("front",), ("rect", 0.24, 0.38, 0.36, 0.51), lambda r, g, b, v, s: v > 0.55),                  # boss
    ],
}


def erase_plates(concept: str, src_tag: str, out_tag: str, height: float, rules: list, edge: int = 0) -> str:
    """Copy <concept>_<src_tag> plates to <concept>_<out_tag> with the rule regions refilled (nearest kept paint,
    softened), and the outer `edge` px of the figure cut (the concept's pale rim-light outline, which the default
    9 px erosion leaves on the Serenade sheet) re-padded from inside. Returns the new concept id. Cached on the
    source mtime + rules + edge."""
    import json
    cache = os.path.join(scene.CACHE_DIR, "concept")
    sid, oid = f"{concept}_{src_tag}", f"{concept}_{out_tag}"
    meta = json.load(open(os.path.join(cache, f"{sid}_plates.json")))
    import inspect
    src = [repr((sides, shape)) + inspect.getsource(test).strip() for sides, shape, test in rules]
    key = [os.path.getmtime(os.path.join(cache, f"{sid}_{s_}.png")) for s_ in ("front", "back")] + [src, edge, 5]
    done = os.path.join(cache, f"{oid}_plates.json")
    if os.path.isfile(done) and json.load(open(done)).get("erase") == key:
        return oid
    keep = project.load_rgb(os.path.join(cache, f"{concept}_mask.png"))[..., 0] > 0.5
    if edge:
        inner = project.blur(keep.astype(np.float32), edge * 0.6) > 0.985
    for side in ("front", "back"):
        img = np.clip(project.load_rgb(os.path.join(cache, f"{sid}_{side}.png")), 0, 1)
        H, W = img.shape[:2]
        if edge:
            iy, ix = project.nearest_index(inner)
            img = np.where(inner[..., None], img, project.blur(img[iy, ix], 2.0))
        info = meta[side]
        k = (info["ground"] - info["top"]) / height
        sign = 1.0 if side == "front" else -1.0
        yy, xx = np.mgrid[0:H, 0:W]
        X = (xx + 0.5 - info["cx"]) * sign / k
        Z = (info["ground"] - (yy + 0.5)) / k
        half = (xx < W // 2) if side == "front" else (xx >= W // 2)
        r, g, b = img[..., 0], img[..., 1], img[..., 2]
        v = img.max(axis=2)
        sat = (v - img.min(axis=2)) / np.maximum(v, 1e-4)
        m = np.zeros((H, W), dtype=bool)
        for sides, shape, test in rules:
            if side not in sides:
                continue
            if shape[0] == "rect":
                _, x0, x1, z0, z1 = shape
                reg = (X >= x0) & (X <= x1) & (Z >= z0) & (Z <= z1)
            else:
                _, cx, cz, rx, rz = shape
                reg = ((X - cx) / rx) ** 2 + ((Z - cz) / rz) ** 2 <= 1.0
            m |= reg & half & test(r, g, b, v, sat)
        if m.any():
            m = project.blur(m.astype(np.float32), 1.5) > 0.05
            iy, ix = project.nearest_index(~m)
            fill = project.blur(img[iy, ix], 3.0)
            a = project.blur(m.astype(np.float32), 1.5)[..., None]
            img = img * (1 - a) + fill * a
        project.save_rgb(np.clip(img, 0, 1), os.path.join(cache, f"{oid}_{side}.png"))
    with open(done, "w") as f:
        json.dump(dict(meta, id=oid, erase=key), f, indent=2)
    scene.log(f"erased plates {oid}: {len(rules)} rules")
    return oid


# TOP PLATES (HANDOFF Art 2.0 step 3): the 52-degree camera reads the hood crown first, and a front/back projection
# streaks the silhouette's top-edge highlight across every near-flat top (it painted the crowns near-white). Each
# listed part's top takes a painted field instead: the part's own cloth (median of a clean plate region, so the fit
# below still lands it on the palette), the concept's key light from front-left, posterised brush patches, and
# soft radial folds (Aubade linen) or felt mottling (Serenade).
#   part: (ext m, [(side, x0, x1, z0, z1) sample regions], folds, mottle)
TOPS = {
    "aubade": {"hood": (0.30, [("back", -0.16, -0.05, 0.76, 0.96), ("back", 0.05, 0.16, 0.76, 0.96)], 9, 0.0),
               "cloak": (0.32, [("back", -0.20, 0.20, 0.28, 0.50)], 0, 0.0),
               "scarf": (0.30, [("back", -0.18, 0.18, 0.60, 0.66)], 0, 0.0)},
    "serenade": {"hood": (0.30, [("back", -0.15, 0.15, 0.80, 0.96)], 0, 0.05),
                 "collar": (0.32, [("back", -0.20, 0.20, 0.68, 0.79)], 0, 0.06),
                 "mantle": (0.34, [("back", -0.20, 0.20, 0.585, 0.665)], 0, 0.05),
                 "cloak": (0.36, [("back", -0.20, 0.20, 0.25, 0.50)], 0, 0.04)},
}


def top_plates(concept: str, height: float, spec: dict, seed: int = 5) -> dict:
    """Write art/.cache/concept/<concept>_top_<part>.png for each part in `spec` (X, Y in [-ext, ext], image up =
    +Y = the back); returns the PROJECTION["tops"] dict {part: (file, ext)}."""
    import json
    cache = os.path.join(scene.CACHE_DIR, "concept")
    meta = json.load(open(os.path.join(cache, f"{concept}_plates.json")))
    plates = {sd: project.load_rgb(os.path.join(cache, f"{concept}_{sd}.png")) for sd in ("front", "back")}
    rng = np.random.default_rng(seed)
    N = 512
    out = {}
    for name, (ext, regions, nfolds, mottle) in spec.items():
        px = []
        for side, x0, x1, z0, z1 in regions:
            info = meta[side]
            k = (info["ground"] - info["top"]) / height
            sign = 1.0 if side == "front" else -1.0
            xs = sorted((info["cx"] + sign * x0 * k, info["cx"] + sign * x1 * k))
            ys = sorted((info["ground"] - z1 * k, info["ground"] - z0 * k))
            px.append(plates[side][int(ys[0]):int(ys[1]), int(xs[0]):int(xs[1])].reshape(-1, 3))
        px = np.concatenate(px, axis=0)
        base = np.median(px, axis=0)
        spread = np.clip(np.percentile(px.mean(axis=1), 80) - np.percentile(px.mean(axis=1), 20), 0.02, 0.12)
        i, j = np.mgrid[0:N, 0:N]
        X = (j + 0.5) / N * 2 * ext - ext
        Y = (1 - (i + 0.5) / N) * 2 * ext - ext
        lit = 1.0 + 0.11 * np.clip((-X * 0.6 - Y * 0.8) / (0.6 * ext), -1, 1)
        blot = project.blur(rng.standard_normal((N, N)).astype(np.float32), 10.0)
        blot = np.round(blot / (np.abs(blot).max() + 1e-6) * 3) / 3
        field = lit * (1.0 + 0.6 * spread * blot)
        if mottle:
            m = project.blur(rng.standard_normal((N, N)).astype(np.float32), 2.5)
            field *= 1.0 + mottle * m / (np.abs(m).max() + 1e-6)
        if nfolds:
            ang = np.arctan2(Y - 0.035, X + 0.02)
            r = np.hypot(X + 0.02, Y - 0.035)
            f = np.abs(np.sin(ang * nfolds * 0.5 + 0.7 + 0.4 * project.blur(rng.standard_normal((N, N)).astype(np.float32), 30.0) * 40))
            field *= 1.0 - 0.07 * (1 - f) ** 3 * np.clip((r - 0.05) / 0.08, 0, 1)
        img = np.clip(base[None, None, :] * field[..., None], 0, 1)
        img = project.blur(img, 1.0)
        rel = f"{concept}_top_{name}.png"
        project.save_rgb(img, os.path.join(cache, rel))
        out[name] = (rel, ext)
    scene.log(f"top plates {concept}: {sorted(out)}")
    return out


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def palette_fit(img, maps, names, fit: dict, log=print):
    """Each listed part's painted median moves onto its palette colour, per channel in linear light, by
    `strength` (0 keeps the painting, 1 lands exactly on the palette); the painted detail rides along."""
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = _lin(img)
    out = lin.copy()
    for name, (hexcol, strength) in fit.items():
        if name not in names:
            continue
        i = names.index(name)
        own = part == i
        if not own.any():
            continue
        med = np.median(lin[own], axis=0)
        tgt = _lin(scene.hex_srgb(hexcol))
        gain = np.clip((tgt / np.maximum(med, 1e-4)) ** strength, 0.2, 5.0)
        out[pid == i] = lin[pid == i] * gain
        log(f"  palette fit {name}: median {np.round(_srgb(med), 3).tolist()} -> {hexcol} x{strength} gain {np.round(gain, 2).tolist()}")
    return _srgb(out).astype(np.float32)


if not getattr(project.paint_object, "_palette_fit", False):
    _paint_object = project.paint_object

    def _paint_object_fit(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        fit = cfg.get("palette_fit")
        if not fit:
            return _paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
        img, maps = _paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
        img = palette_fit(img, maps, names, fit, log=log)
        return (img, maps) if return_maps else img
    _paint_object_fit._palette_fit = True
    project.paint_object = _paint_object_fit


# ── motion (brief §3.1) ─────────────────────────────────────────────────────────────────────────────────
P_ = anim.P
RUN_SPEED = 3.25          # content moveSpeed


class Shieldwick(wc.Wick):
    KIND_ID = "shieldwick"
    HEIGHT = 1.1

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.F = FACTION[faction]
        # minion rig: crown 1.00, skull base 0.716 (the hood pivot), shoulders x 0.16 at 0.566, hips 0.362, ankles
        # x 0.115 at 0.055; the arms are re-placed per concept in rig_extras
        self.PROPORTIONS = rig.proportions(height=1.0, head=0.33, neck=0.05, shoulder_width=0.32, hip_width=0.14, leg=0.31,
                                           thigh_frac=0.5, arm=0.20, upper_arm_frac=0.5, hand=0.08, foot=0.16,
                                           ankle_height=0.055, spine_curve=0.0, stance=0.045, toe_out_deg=10.0,
                                           knee_bend=0.012, a_pose_deg=60.0, arm_forward_deg=10.0, elbow_bend_deg=20.0,
                                           shoulder_drop=0.10)
        self.MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="guard", run_ref_speed=RUN_SPEED)
        self.AO_INTO_BASE = 0.30
        concept = f"wicks/shieldwick_{faction}"
        self.PROJECTION = wc.graded_projection(concept, self.F["plate_height"], glow=GLOW[faction], tag="sw")
        self.PROJECTION["concept"] = erase_plates(concept, "sw", "swe", self.F["plate_height"], ERASE[faction],
                                                  edge={"aubade": 3, "serenade": 7}[faction])
        self.PROJECTION["tops"] = top_plates(self.PROJECTION["concept"], self.F["plate_height"], TOPS[faction])
        self.PROJECTION["palette_fit"] = dict(PALETTE_FIT[faction])
        self.PROJECTION["flat"] = dict(FLAT[faction])

    # ── geometry ────────────────────────────────────────────────────────────────────────────────────
    def sculpts(self) -> list:
        return parts_aubade(self.F) if self.faction == "aubade" else parts_serenade(self.F)

    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        for name, S, vs, role, bind, tris in self.sculpts():
            v, q = S.mesh(VOXEL * vs)
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[role])
            P.append(fighter.Part(name, high=ob, low=make_low(ob, name, ctx.col, tris, VOXEL * vs * 1.25), tris=tris, bind=bind))
        return P

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        wl = ctx.info.side("wrist", "L")
        wc.legacy_weapon(self, ctx, part, "ironstone", (0.07, 0.07, 0.09))
        sd = Sculpt("shield")
        c = (wl.x + 0.06 * k, wl.y - 0.06 * k, wl.z + 0.06 * k)
        sd.add(Lathe(c, lambda r, z: np.maximum(r - 0.2 * k, np.abs(z) - 0.025 * k), 0.22 * k, -0.04 * k, 0.04 * k,
                     axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
        sd.add(Torus(c, 0.2 * k, 0.02 * k, axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
        part("shield", sd, "stone", "bone:hand.L", 300)
        boss = Sculpt("boss")
        n = np.array([0.6, -0.8, 0.0])
        bp = np.array(c) + n * 0.03 * k
        boss.add(Ellipsoid(tuple(bp), (0.085 * k, 0.085 * k, 0.04 * k), axes=sdf.frame(tuple(n))), k=0.0)
        part("boss", boss, "accent", "bone:hand.L", 100)

    # ── rig ────────────────────────────────────────────────────────────────────────────────────────────
    def rig_extras(self, ctx) -> None:
        """The concept's arms: elbow, wrist and grip per side; prop.R along the mace haft (+Y up the haft, +Z
        front), prop.L along the shield's face normal (+Y out of the face, +Z up)."""
        if self.faction == wc.LEGACY:
            return
        import bpy
        from mathutils import Vector as V
        info = ctx.info
        arm = info.armature
        F = self.F
        scene.select_only([arm], arm)
        bpy.ops.object.mode_set(mode="EDIT")
        eb = arm.data.edit_bones
        for s in ("R", "L"):
            sh = V(eb[f"upper_arm.{s}"].head)
            el, wr, g = (V(tuple(F[k][s])) for k in ("E", "W", "G"))
            up_d, fo_d, hd = (el - sh).normalized(), (wr - el).normalized(), (g - wr).normalized()
            eb[f"upper_arm.{s}"].tail = el
            eb[f"forearm.{s}"].head = el
            eb[f"forearm.{s}"].tail = wr
            eb[f"hand.{s}"].head = wr
            eb[f"hand.{s}"].tail = wr + hd * 0.06
            # rolls: local +Z = the direction of flexion (rig.py: +X rotation flexes)
            eb[f"upper_arm.{s}"].align_roll(fo_d - up_d * fo_d.dot(up_d))
            eb[f"forearm.{s}"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
            eb[f"hand.{s}"].align_roll(-up_d - hd * (-up_d).dot(hd))
            info.joints[f"elbow.{s}"], info.joints[f"wrist.{s}"] = el, wr
            info.joints[f"knuckle.{s}"] = wr + hd * 0.06
            info.joints[f"palm.{s}"] = g
            info.joints[f"forearm_dir.{s}"] = fo_d
            info.joints[f"arm_dir.{s}"] = up_d
        gR = V(tuple(F["G"]["R"]))
        eb["prop.R"].head = gR
        eb["prop.R"].tail = gR + V(tuple(F["mace_u"])) * 0.12
        eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
        c, n, t, up = shield_frame(F)
        gL = V(tuple(F["G"]["L"]))
        eb["prop.L"].head = gL
        eb["prop.L"].tail = gL + V(tuple(n)) * 0.12
        eb["prop.L"].align_roll(V((0.0, 0.0, 1.0)))
        bpy.ops.object.mode_set(mode="OBJECT")
        for b in arm.data.bones:
            info.lengths[b.name] = b.length

    # ── clips ──────────────────────────────────────────────────────────────────────────────────────────
    def _arm_len(self, s):
        S = shoulder(s)
        E, W = np.asarray(self.F["E"][s]), np.asarray(self.F["W"][s])
        return np.linalg.norm(E - S) + np.linalg.norm(W - E)

    def _rel(self, s, d=(0.0, 0.0, 0.0)):
        """Wrist target in arm lengths from the shoulder (chest frame): the rest wrist moved by d metres."""
        W = np.asarray(self.F["W"][s]) + np.asarray(d)
        return tuple((W - shoulder(s)) / self._arm_len(s))

    def _pose(self, torso=None, hips=(0.0, 0.0, -0.012), dR=(0, 0, 0), aimR=None, dL=(0, 0, 0), aimL=None,
              feet=None, poleR=(-0.8, 0.5, -0.3), poleL=(0.8, 0.5, -0.3), wR=1.0, wL=1.0, extra=None):
        """A full pose: torso rotations (deg), hips offset (m), wrists moved from rest by dR / dL (m, chest frame),
        the mace haft direction aimR and the shield face direction aimL (character space), feet targets."""
        u = tuple(self.F["mace_u"])
        _, n, _, _ = shield_frame(self.F)
        p = P_(**(torso or {}))
        p["hips_loc"] = tuple(hips)
        ik = {"hand.R": HandTarget(rel=self._rel("R", dR), pole=poleR, weight=wR),
              "hand.L": HandTarget(rel=self._rel("L", dL), pole=poleL, weight=wL),
              "aim.R": Aim(tuple(aimR or u)), "aim.L": Aim(tuple(aimL or n))}
        f = feet or {}
        ik["foot.L"] = FootTarget(tuple(f.get("l", (0.0, -0.01, 0.0))), f.get("pl", 0.0), f.get("yl", 6.0), 0.0, f.get("kl", 0.0))
        ik["foot.R"] = FootTarget(tuple(f.get("r", (0.0, 0.01, 0.0))), f.get("pr", 0.0), f.get("yr", -6.0), 0.0, f.get("kr", 0.0))
        p["ik"] = ik
        if extra:
            p.update(P_(**extra))
        return p

    def guard(self):
        """Idle carry (concept pose): the shield lifted to chest height and turned a little more to the front,
        the mace upright at the right side."""
        return self._pose(dict(hips=(2, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), neck=(-1, 0, 0), head=(-2, 0, 0)),
                          dL=(-0.01, -0.02, 0.045), aimL=tuple(unit((0.55, -0.83, 0.08))))

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        G = self.guard()
        u = np.asarray(self.F["mace_u"])
        out = {}

        # idle (72 f): breathing bob, the hood scanning left then right once, the lantern swinging a few degrees
        def idle_s(t):
            b = anim.osc(t, 2)
            scan = 14.0 * math.sin(2 * math.pi * t) * (0.6 + 0.4 * abs(math.sin(2 * math.pi * t)))
            p = anim.add(G, P_(chest=(1.4 * b, 0, 0), spine=(0.6 * b, 0, 0), neck=(-0.8 * b, scan * 0.35, 0),
                               head=(-0.6 * b, scan * 0.65, 0), shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.2 * b)))
            ik = dict(p["ik"])
            sw = math.sin(2 * math.pi * (2 * t + 0.15))
            ik["aim.R"] = Aim(tuple(unit(u + np.array([0.06 * sw, 0.05 * math.cos(2 * math.pi * 2 * t), 0.0]))))
            for s in ("R", "L"):
                h = ik[f"hand.{s}"]
                ik[f"hand.{s}"] = HandTarget(rel=(h.rel[0], h.rel[1], h.rel[2] + 0.02 * anim.osc(t, 2, 0.1 if s == "R" else 0.18)),
                                             pole=h.pole)
            p["ik"] = ik
            hx, hy, hz = p["hips_loc"]
            p["hips_loc"] = (hx, hy, hz - 0.006 * (0.5 + 0.5 * b))
            return p
        out["idle"] = anim.Clip("idle", 72, True, idle_s)
        out["run"] = self._run()
        out["attack1"] = self._attack1(G)
        out["death"] = self._death(G, ctx)
        return out

    def _run(self) -> anim.Clip:
        """A quick waddling run at the content moveSpeed: 12 frames (2 steps), planted feet move back at exactly
        RUN_SPEED during contact; short swing lifts for the minion leg; the shield tucked to the chest, the mace
        arm pumping, the hood level."""
        v = RUN_SPEED
        N = 12
        T = N / anim.FPS
        c = 0.22
        Ls = v * c * T
        swing = [(0.00, Ls / 2, 0.0, -18.0), (0.20, Ls / 2 + 0.03, 0.055, -34.0), (0.45, 0.04, 0.085, -20.0),
                 (0.70, -Ls / 2 - 0.03, 0.055, -2.0), (0.88, -Ls / 2 - 0.012, 0.018, 6.0), (1.00, -Ls / 2, 0.0, 6.0)]

        def swing_at(s):
            for i in range(1, len(swing)):
                if s <= swing[i][0]:
                    a, b = swing[i - 1], swing[i]
                    w = anim.sine((s - a[0]) / (b[0] - a[0]))
                    return tuple(a[k] + (b[k] - a[k]) * w for k in (1, 2, 3))
            return swing[-1][1:]

        def foot_at(q):
            q %= 1.0
            if q < c:
                w = q / c
                return (0.0, -Ls / 2 + Ls * w, 0.0), 6.0 * (1 - anim.sine(min(1.0, w / 0.3))) - 18.0 * max(0.0, (w - 0.6) / 0.4) ** 1.6
            dy, dz, pitch = swing_at((q - c) / (1 - c))
            return (0.0, dy, dz), pitch

        u = np.asarray(self.F["mace_u"])
        def sample(t):
            q = t % 1.0
            fl, pl = foot_at(q)
            fr_, pr = foot_at(q + 0.5)
            bob = 0.022
            z = -0.022 - bob * 0.5 * (1 + math.cos(2 * math.pi * (2 * q - c)))
            x = 0.014 * math.cos(2 * math.pi * (q - c / 2))
            yaw = -6.0 * math.cos(2 * math.pi * q)
            roll = 6.0 * math.sin(2 * math.pi * (q - c / 2))              # the waddle
            sw = math.cos(2 * math.pi * (q - 0.04))                          # + = left foot forward -> mace arm forward
            torso = dict(hips=(7, yaw, roll), spine=(3, -yaw * 0.5, -roll * 0.6), chest=(2 + 1.2 * math.cos(4 * math.pi * q), -yaw * 0.4, -roll * 0.3),
                         neck=(-5, yaw * 0.3, roll * 0.5), head=(-5, yaw * 0.3, roll * 0.4))
            p = self._pose(torso, hips=(x, 0.0, z),
                           dR=(0.0, -0.075 * sw, 0.035 + 0.025 * sw), aimR=tuple(unit(u + np.array([0.0, -0.45 * sw - 0.15, 0.0]))),
                           dL=(-0.035, -0.06, 0.075), aimL=tuple(unit((0.35, -0.93, 0.05))),
                           feet=dict(l=(0.012 + fl[0], fl[1] - 0.01, fl[2]), pl=pl, yl=-3.0,
                                     r=(-0.012 + fr_[0], fr_[1] - 0.01, fr_[2]), pr=pr, yr=3.0))
            return p
        return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3), "cycle_s": round(T, 3)})

    def _attack1(self, G) -> anim.Clip:
        """Shield shove (anticipation) -> overhead mace chop landing at the impact frame (40 %) -> recoil back
        behind the shield (25 frames; the renderer maps 40 % onto the 0.35 s windup)."""
        N = 25
        u = np.asarray(self.F["mace_u"])
        fwd = dict(l=(0.0, -0.06, 0.0), r=(0.0, 0.03, 0.0))
        shove = self._pose(dict(hips=(6, -10, 0), spine=(5, -8, 0), chest=(4, -6, 0), neck=(-4, 6, 0), head=(-5, 8, 0)),
                           hips=(0.0, -0.025, -0.02), dR=(0.02, 0.05, -0.02), aimR=tuple(unit((-0.35, 0.35, 0.87))),
                           dL=(-0.03, -0.11, 0.06), aimL=tuple(unit((0.15, -0.99, 0.05))), feet=fwd)
        wind = self._pose(dict(hips=(-3, 12, 0), spine=(-4, 10, 0), chest=(-6, 12, 0), neck=(2, -8, 0), head=(4, -10, 0)),
                          hips=(0.0, 0.02, -0.01), dR=(0.06, 0.02, 0.30), aimR=tuple(unit((-0.10, 0.45, 0.89))),
                          dL=(-0.02, -0.08, 0.04), aimL=tuple(unit((0.3, -0.95, 0.05))), feet=fwd, poleR=(-0.9, 0.2, 0.4))
        hit = self._pose(dict(hips=(12, -10, 0), spine=(9, -8, 0), chest=(8, -8, 0), neck=(-6, 6, 0), head=(-8, 8, 0)),
                         hips=(0.0, -0.05, -0.045), dR=(0.13, -0.17, 0.03), aimR=tuple(unit((0.15, -0.95, -0.25))),
                         dL=(0.0, -0.02, 0.0), aimL=tuple(unit((0.6, -0.8, -0.05))), feet=fwd, poleR=(-0.9, 0.4, -0.2))
        fol = self._pose(dict(hips=(14, -12, 0), spine=(10, -9, 0), chest=(9, -9, 0), neck=(-7, 7, 0), head=(-9, 9, 0)),
                         hips=(0.0, -0.055, -0.05), dR=(0.14, -0.15, -0.03), aimR=tuple(unit((0.15, -0.85, -0.5))),
                         dL=(0.0, -0.01, -0.01), aimL=tuple(unit((0.62, -0.78, -0.08))), feet=fwd, poleR=(-0.9, 0.4, -0.2))
        recoil = self._pose(dict(hips=(-2, 4, 0), spine=(-2, 3, 0), chest=(-2, 3, 0), neck=(1, -2, 0), head=(1, -3, 0)),
                            hips=(0.0, 0.015, -0.02), dR=(0.02, 0.02, 0.0), aimR=tuple(u),
                            dL=(-0.03, -0.07, 0.07), aimL=tuple(unit((0.35, -0.94, 0.05))))
        coil = anim.lerp_pose(G, wind, 1.06)
        keys = [(0.0, G, "linear"), (0.12, shove, "out"), (0.26, wind, "inout"), (0.33, coil, "out"),
                (anim.IMPACT, hit, "accel"), (0.48, anim.lerp_pose(hit, fol, 0.4), "out"), (0.62, fol, "out"),
                (0.80, recoil, "inout"), (1.0, G, "settle")]
        return anim.Clip("attack1", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    def _death(self, G, ctx) -> anim.Clip:
        """Hit -> the knees buckle and the wick sits back -> tips forward onto the shield and lies over it, the lantern
        on the ground (40 frames; ends at rest)."""
        N = 40
        hip_h = ctx.info.armature.data.bones["hips"].head_local.z
        hit = self._pose(dict(hips=(-6, 8, 0), spine=(-8, 4, 0), chest=(-10, 4, 0), neck=(-8, 0, 0), head=(-12, 6, 0)),
                         hips=(0.0, 0.04, -0.01), dR=(-0.03, 0.04, 0.06), aimR=tuple(unit((-0.5, 0.2, 0.84))),
                         dL=(0.02, 0.03, 0.03), aimL=tuple(unit((0.7, -0.7, 0.15))))
        sit = self._pose(dict(hips=(-12, 6, 0), spine=(4, 2, 0), chest=(6, 2, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                         hips=(0.0, 0.07, -hip_h * 0.40), dR=(-0.03, -0.02, -0.05), aimR=tuple(unit((-0.6, -0.2, 0.77))),
                         dL=(0.0, -0.05, -0.02), aimL=tuple(unit((0.5, -0.8, -0.3))),
                         feet=dict(l=(0.01, -0.06, 0.0), r=(-0.01, -0.04, 0.0), pl=10.0, pr=10.0))
        tip = self._pose(dict(hips=(40, 4, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                         hips=(0.0, -0.06, -hip_h * 0.55), dR=(-0.05, -0.08, -0.06), aimR=tuple(unit((-0.7, -0.6, 0.2))),
                         dL=(0.0, -0.10, -0.10), aimL=tuple(unit((0.2, -0.3, -0.93))),
                         feet=dict(l=(0.01, -0.02, 0.0), r=(-0.01, 0.0, 0.0), pl=-10.0, pr=-10.0))
        down = self._pose(dict(hips=(74, 2, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-6, 0, 0), head=(-8, 4, 6)),
                          hips=(0.0, -0.20, -hip_h + 0.19), dR=(-0.08, -0.06, -0.10), aimR=tuple(unit((-0.9, -0.3, -0.2))),
                          dL=(0.0, -0.12, -0.12), aimL=tuple(unit((0.05, 0.1, -0.99))), wR=1.0)
        down["ik"].pop("foot.L")
        down["ik"].pop("foot.R")
        down.update(P_(thigh_L=(6, 0, 5), shin_L=(-8, 0, 0), foot_L=(-25, 0, 0), thigh_R=(10, 0, -5), shin_R=(-14, 0, 0), foot_R=(-25, 0, 0)))
        bounce = anim.add(down, P_(spine=(-4, 0, 0), chest=(-3, 0, 0), head=(-4, 0, 0)))
        bounce["hips_loc"] = (0.0, -0.20, -hip_h + 0.21)
        rest = anim.add(down, P_(head=(0, -4, 0)))
        rest["hips_loc"] = (0.0, -0.20, -hip_h + 0.185)
        keys = [(0.0, G, "linear"), (0.10, hit, "snap"), (0.34, sit, "inout"), (0.52, tip, "in"), (0.66, down, "in"),
                (0.74, bounce, "out"), (0.84, rest, "inout"), (1.0, rest, "linear")]
        return anim.Clip("death", N, False, anim.keyed(keys))


KINDS = [Shieldwick]

if __name__ == "__main__":
    wc.run(KINDS)
