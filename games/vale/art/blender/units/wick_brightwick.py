"""brightwick: the super Wick (1.7 m). Pauldrons, a crown-lamp ring on the hood, a two-hand lamp staff.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_brightwick_plates.py        # plates (both)
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_fit.py -- [--faction aubade]
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_pose.py -- [--faction aubade]
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_hoodlight.py -- [--sweep=...]  # hood light
    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_brightwick.py -- \
        [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds brightwick_aubade + brightwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's brightwick.glb (frozen: `legacy_props` below and wick_common's legacy body). Brief:
_design/units/wicks.md §3.4 (law). Concepts: _design/concept/wicks/brightwick_{aubade,serenade}.webp.
Progress log: art/renders/units/_wick_brightwick_progress.md.

ART 2.0 (HANDOFF "Art 2.0 method", reference fighters/marund.py): numpy SDF volumes fitted to each concept on a
10 cm grid (measured from the plates' masks: cloak, mantle and pauldron widths per height), the concept
painting projected onto the game mesh in the concept's pose, normals + AO baked from the sculpt.

  * Concepts vs brief: the concepts' proportions win (Aubade's rounded cowl rises a little above its crown
    posts, 1.73 m; Serenade's dome pauldrons and wide sand mantle are the widest point, 0.98 m); the brief's
    RULES win: no face (one small soft hood light, deep and low in a dark hollow), rounded hoods only (crown
    posts + flames <= 11 cm, blunt), every glow is `accent` geometry, palette per §2.3-2.4.
  * GAME LOWS: the decimated SDF went ragged on hems and thin plates (cowl teeth, sawtooth mantle, crumpled
    plates), so the big forms get CLEAN lows made here: parametric grids PROJECTED onto each part's SDF
    (`lathe_low`: cloak, mantle, cowl, with a row on every hem / opening edge; `central_low` / `box_low`: the
    pauldron domes and chalk plates), and explicit meshes for bands, rings, posts, panels and lamps. Organic
    parts (hood, rim, sleeves, mitts, boots, staff) keep the decimated sculpt. The SDF stays the bake source.
  * PAINT (`paint_hybrid`): the palette base painted from the sculpt (fold light + valley shadow from the SDF,
    edge wear, mottle, grain, felt nap, the bible's light-top / dark-feet ramp) x a CONTACT SHADOW between parts
    (`contact_ao` on the assembled rest mesh: the bake explodes the parts, so the mantle never shadowed the coat)
    CARRYING THE CONCEPT: (a) its brushwork per material, cut from the graded plates as seamless swatches
    (`SWATCH`, 1:1 in metres, on every texel: sides and backs too); (b) the graded plates projected in the
    concept's pose (`paint_pose`, posed + yawed mesh, own-part visibility, the concept's figure mask, a
    consistency gate) on the parts where that registers (`PROJ_PARTS`: cloak, tabard): per texel the concept's
    strokes (luminance against a 1.8 cm 3D low-pass), its painted fold light (1.8 against 7.5 cm) and its local
    colour breakup. The palette and the geometry drive colour and placement (a misregistered plate cannot move a
    band, double a rim or ghost a boss onto the mantle: that is why the other parts take the swatches only).
  * THE TEAM READ: the accent tint is the only ally/enemy cue. Every light keeps a dark setting on a THIN BEZEL
    (1.5 cm painted, slim slate lamp cups, slate rings at the lantern panes); the lights are placed for every
    facing: the hood core, the crown lamps, the seam, a dawnglass inlay on each pauldron, the stole light and the
    back stripe (Aubade); the crown windows, a lampresin strip on each dome, the sash, the tabard bands + chevron
    and the lantern (Serenade). The accent material is matte (`matte_accent`: 0.25 roughness put a hotspot on
    every lamp).
  * FIX ROUND 3 (values + the hood): the hoods sit at L* <= 65 in game and under the fighters (B5): the part colours
    (PART_HEX) and the top of the RAMP come down, the shared FACTION_PALETTES are untouched; the hood light is ONE
    soft core floating in the dark hollow (FORM "hood_light"), everything seen through the arch is ink (`ink_hollow`,
    the ORM makes it matte + occluded), the Aubade rim a flat carved band (`rim_band`), the Serenade dome cap its
    own clean low (`hood_cap`); paint: `cavity` edge light / seam shadow on every part, firmer folds, felt nap,
    the mantle's draped dip + cast shadow, the rolled collar's twist, the ash staff's grain, knots and ferrule.
    Measured IN GAME (render_bench, both seats; scratch harness ig_bw.mjs): accent-vs-surround Lab dE Aubade ally
    47 (min 35), enemy 62; Serenade ally 61, enemy 71 (min 42); hood L* p90 61-64.
  * FIX ROUND 6 (review r4 major: paint and forms under the Art 2.0 bar): the Serenade capelet a SCALLOPED hem with a
    U dip to the centre back, its drape folds, hem lobes and low columns sharing one function (`mantle_drape`), its
    underside in shadow; the coat's folds painted from the sculpt's fold function (`cloak_fold_w`) + long strokes;
    the pauldron bands clean painted ribbons (edge light, grooves, no cracks / swatch); the sash laid on the coat
    low's own columns (no notch); the forearm wraps a clean helical BANDAGE SPIRAL (`wrap_mesh`) and the mitts clean
    lows with a separate thumb lobe; the glimwick DETAIL TRANSFER (`wick_common.detail_ratio`) on the projected parts
    (+ the Serenade mantle); the reserved marigold band clamped (luminance kept); the Aubade sill sunk 2 cm + inked,
    its hood cap -15 %; the Serenade roll thinned at the sill, the painted spill halved; smaller hood cores and the
    halo's alpha stations in its fall (the shared core + halo). Close-up check: proto/wick_brightwick_glbview.py.
  * FIX ROUND 7 (verify wave-b: the Aubade read as a FACE from the side; the Serenade opening as lips round an O; the
    cores flat discs at 52 deg): Aubade crown TEN smaller lamps 36 deg apart (one over the arch, one on the nape seam,
    a chalk spire facing each side: from any facing 4-6 evenly spaced lamps on the ring's arc, never an isolated level
    pair); the pauldron inlay a short arc on the plate's outer edge only (+-40 deg, was a 220 deg U) and its cap plate
    ~12 L* darker (found by the cap's outer sheet). Serenade: the roll a BROW (round over the arch's top, a flat felt
    edge down the sides, run round the whole outline with a felt sill run), the collar's front flattened under the
    opening (`CollarTorus`) and the sill 1.5 cm higher (a straight felt sill between the opening and the collar); the
    rounded box under the arch no longer pinches the outline (corner 3.4 cm). Both: the hollow floor inked in UV
    (`floor_uv_mask`: its sliver triangles sampled the sill's felt, a lit streak under the core), the hood low's chords
    across the void split (`refine_hollow`), the spill only behind the core; the halo its own profile (HALO_BW: falls
    from the centre, no plateau) leaning back 30 deg toward the gameplay camera.
  * Pauldrons ride the shoulder bone RIGIDLY (blended into the upper arm they crumpled in the guard pose).
  * Same job silhouette in both cultures: the same rig, staff layout (right grip 0.40 m from the foot, left grip
    0.72 m above it, lantern at the upper left) and the same clips; hood, crown, pauldrons, trims, lamp differ.
  * REST = A-pose (CONTRACT §12). The staff rides prop.R (+Y forward through the right fist), modelled along it,
    so `aim.R` = the staff direction and the left hand grips `to_prop=("prop.R", GRIP_L)`.
  * The cloak is a bell on the hips with a little hem swing from each thigh (`bind_cloak`); the death clip is
    ground-solved on the skinned mesh frame by frame (`ground_solve`: nothing below z 0).

Pipeline additions kept in this module (common/ and wick_common.py untouched): the hybrid paint
(`_paint_object`, wraps project.paint_object for `wicks/brightwick*` ids only), the binds `("bw_auto", exclude)`,
`("bw_transfer", part)` and `("bw_cloak",)` (wraps pipeline.bind_part for those tuples only), a deeper bake cage
(`_bake_asset`), the ORM's empty texels filled + per-material roughness before its 256 scale (`_set_image_array`)
and a non-metallic baked material (`_gltf_material`); the last three touch brightwick faction textures only.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import wick_common as wc  # noqa: E402
from common import anim, bake, fighter, mesh, pipeline, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
from wick_common import (Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere,  # noqa: E402
                         Torus)
from common.hifi.sdf import FlatCapsule  # noqa: E402

V3 = np.array
NOISE = sdf.Noise(29)
PNOISE = sdf.Noise(71)        # paint noise
VOXEL = 0.0065
RECESS = 0.05                 # the cloak's front opening: the robe floor sits this far in (local radius)
GRIP_L = 0.72                 # left fist along the staff from the right fist (m)
STAFF_BACK = 0.40             # staff foot behind the right fist (m)
ARM_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("shoulder", "upper_arm", "forearm", "hand", "prop"))
LEG_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("thigh", "shin", "foot", "toe"))
BODY_EXCLUDE = ("root", "neck", "head", "x_hem_1") + ARM_BONES
SLEEVE_EXCLUDE = ("root", "hips", "spine", "neck", "head", "prop.L", "prop.R", "x_hem_1") + LEG_BONES

def snap_hollow(F, ob, tol=0.004, log=print) -> int:
    """(r7, verify wave-b) the decimated hood low's vertices that lie INSIDE the carved hollow (the tombstone
    opening + head space, deeper than `tol`) are pulled back onto its walls: the collapse left spikes of the side
    walls jutting 2-4 cm into the opening at the arch's springing line (lit dark wedges beside the core at eye level,
    ragged teeth at the opening's sides from 52 deg once the rim no longer covered them). Returns the count moved."""
    T = tomb_of(F)
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    d = T.d(co)
    sel = np.nonzero(d < -tol)[0]
    if len(sel) == 0:
        return 0
    Q = co[sel].copy()
    e = 1e-4
    for _ in range(8):
        dq = T.d(Q)
        g = np.stack([T.d(Q + np.eye(3)[i] * e) - T.d(Q - np.eye(3)[i] * e) for i in range(3)], 1) / (2 * e)
        Q = Q - (dq / np.maximum((g * g).sum(1), 1e-6))[:, None] * g
    co[sel] = Q
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    log(f"brightwick: hollow snap moved {len(sel)} hood low vertices (max depth {-float(d[sel].min()) * 100:.1f} cm)")
    return len(sel)


def refine_hollow(F, ob, D, tol=0.010, iters=4, log=print) -> int:
    """(r7, verify wave-b) the decimated hood low's CHORDS across the hollow: the collapse joined vertices on the
    opening's front edge to vertices on the head space's back wall, so whole triangles cut through the void and
    showed as wedges jutting 2-4 cm into the opening at the arch's springing line (pale teeth at its sides from
    52 deg, lit wedges beside the core at eye level). Every triangle whose centre lies inside the void has its
    longest edge split, the new vertex projected onto the hood's own surface (its SDF), until none is left.
    Returns the vertices added."""
    import bmesh
    T = tomb_of(F)
    me = ob.data
    added = 0
    e_ = 1e-4
    for _ in range(iters):
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        cents = np.array([f.calc_center_median()[:] for f in bm.faces], dtype=np.float64)
        bad = np.nonzero(T.d(cents) < -tol)[0]
        if len(bad) == 0:
            bm.free()
            break
        edges = {max(bm.faces[int(i)].edges, key=lambda ed: ed.calc_length()) for i in bad}
        res = bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=1, use_grid_fill=False)
        newv = [g for g in res["geom_split"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        Q = np.array([v.co[:] for v in newv], dtype=np.float64)
        for _k in range(12):
            dq = D.d(Q)
            g = np.stack([D.d(Q + np.eye(3)[i] * e_) - D.d(Q - np.eye(3)[i] * e_) for i in range(3)], 1) / (2 * e_)
            Q = Q - (dq / np.maximum((g * g).sum(1), 1e-6))[:, None] * g
        for v, q in zip(newv, Q):
            v.co = q.tolist()
        added += len(newv)
        bm.to_mesh(me)
        bm.free()
    me.update()
    if added:
        log(f"brightwick: hollow refine split {added} chord edges across the opening")
    return added


# ── per-culture forms (metres; Z up, the wick faces -Y, soles at 0, its right hand at -X) ─────────────────
# measured on the concepts (Aubade 709.3 px/m, Serenade 744 px/m; the plates' masks, widths per height):
#   Aubade   cloak +-0.37 at the chest .. +-0.42 at the hem, pauldrons +-0.17..0.36, hem points at 0.07
#   Serenade coat +-0.31 under the arms .. +-0.40 at z 0.3 (hem 0.16), mantle +-0.44 at its hem (z 0.99),
#            dome pauldrons +-0.25..0.49 at z 1.18-1.36, crown band z 1.58-1.64 just over the opening
FORM = {
    "aubade": {
        # a rounded cowl (the concept: x +-0.17 under the circlet), its dome tapering into a round cap over the
        # circlet (a soft cowl, never a straight-sided helm): x +-0.19 at 1.48, +-0.167 at 1.60, top 1.723
        "hood": ((0.0, 0.02, 1.480), (0.181, 0.201, 0.243)),
        # the opening: the concept's TOMBSTONE arch (x +-0.099, z 1.330-1.560: about the concept's 16 x 18 cm dark
        # hollow inside the chalk rim; a bigger one was a big dark mouth from the 52 deg camera), a
        # rounded head space behind it (`Tomb`): (half width, bottom, arch top, corner radius), back ellipsoid
        # (r6, review r4: from 52 deg the hood's chin under the opening read as a grey sill block with the hollow's
        # serrated floor edge on it, a jaw with teeth) the sill sunk 2 cm, 1.330 -> 1.310: its top under the sight line
        "tomb": ((0.099, 1.310, 1.560, 0.036), ((0.0, -0.10, 1.440), (0.130, 0.190, 0.155))),
        # ONE soft lamp CORE in the head space (brief §0.2, fix round 3): an ellipsoid wider than tall (11 x 7 cm),
        # its front ~2.5-3.5 cm behind the opening (the opening's edge lies at y -0.155 .. -0.18), floating at a third
        # of the arch's height so that BOTH the eye level (under the middle) and the 52 deg camera (over the middle:
        # the deeper a point, the higher it shows from above, and the brow hides the hollow's top) see dark hollow
        # above, below and to both sides of it (the floor under it is ink). The broad tilted slab it replaces (25 x 8 cm on the sill) read as a tongue in an open
        # mouth. The soft falloff is the painted spill on the hollow's walls BEHIND and beside it (`ink_hollow`:
        # the front of the hollow, the sill and the cheeks stay ink). Matte. Centre, radii (local X, depth, up),
        # tilt (deg, top back)
        # (r6: ~0.5 of the sunk opening; the core 4.2 -> 3.5 cm across: the shared halo is 2.07 x the core now, and
        # at the old size it filled 88 % of the opening's width, a lit plate; now it fades out inside the dark)
        "hood_light": ((0.0, -0.118, 1.420), (0.035, 0.021, 0.023), 8.0),
        "shoulder": 0.205,
        # A-line cape: +-0.33 under the pauldrons -> +-0.43 at the hem, deeper toward the hem (side view flares too)
        "cloak_rx": [(0.04, 0.432), (0.25, 0.418), (0.50, 0.400), (0.75, 0.380), (0.95, 0.362), (1.10, 0.338),
                     (1.22, 0.295), (1.30, 0.24), (1.36, 0.17)],
        "cloak_ry": [(0.04, 0.80), (0.50, 0.75), (0.95, 0.68), (1.36, 0.72)],
        # the front opening: half width by height (it widens toward the hem: the coat's edges diverge, the
        # concept), its top under the cowl's V (no dark step above the tabard)
        "open": ([(0.0, 0.232), (0.45, 0.182), (0.90, 0.138), (1.13, 0.124)], 1.13),
        "hem": (0.075, 0.032, 5),                                  # shallow points (lowest z, rise, count)
        "folds": (0.018, 7.0, 0.10),                               # long straight vertical folds (14 around)
        # the concept's WIDE chalk-white stole (20 cm): half width, top, tip, where the V starts
        "tabard": (0.116, 1.215, 0.20, 0.31),
        "pauldron_x": 0.255, "boot": (0.062, 0.105, 0.06),
        "staff_r": 0.024,
        # paint pose (the concept's hold): right wrist, staff direction, front-view yaw (deg)
        "paint": {"wrist_R": (-0.17, -0.25, 0.84), "staff": (0.78, -0.06, 0.62), "yaw": 12.0,
                  "pole_R": (-0.9, 0.3, -0.4), "pole_L": (0.9, 0.2, -0.5)},
    },
    "serenade": {
        # a broad felt DOME seated IN the thick dark rolled collar (the concept): the round cap to 1.715 over the
        # crown band, the felt widening to 0.214 m at 1.40-1.46 and tucking into the collar at 1.34 (the dark roll
        # shows all round it, the front too: never one pale bell flaring into the mantle)
        "hood": ((0.0, 0.02, 1.545), (0.170, 0.178, 0.170)),
        "hood_bell": [(1.34, 0.200), (1.40, 0.214), (1.46, 0.214), (1.51, 0.204), (1.56, 0.186), (1.60, 0.164)],
        # a SHORT arch (the concept: 1.37-1.575; the 26 cm arch read as a tall dark mouth), the collar its sill
        # (r7, verify wave-b: the dark collar roll under the opening + the roll round it = lips round an O) the sill
        # 1.370 -> 1.385 and the collar's front flattened under it (COLLAR_FRONT): a 4 cm band of felt is the arch's
        # straight sill between the dark opening and the collar; its bottom corners 4.5 -> 3.4 cm round (the rounded
        # box under the arch needs 2 x the corner radius <= its height, 7.6 cm now: a bigger corner pinched the
        # outline at the springing line, a notch either side)
        "tomb": ((0.114, 1.385, 1.575, 0.034), ((0.0, -0.10, 1.470), (0.150, 0.205, 0.150))),
        # one soft core floating in the hollow (see the Aubade note): 12 x 7 cm, front ~3.5 cm behind the opening
        # (r6: 5.1 -> 3.9 cm across: the 2.07 x halo filled the broad opening edge to edge, a lit visor from 52 deg)
        "hood_light": ((0.0, -0.124, 1.445), (0.039, 0.021, 0.025), 8.0),
        "shoulder": 0.215,
        "cloak_rx": [(0.13, 0.398), (0.20, 0.405), (0.30, 0.398), (0.45, 0.378), (0.62, 0.350), (0.80, 0.326),
                     (0.98, 0.308), (1.10, 0.288), (1.18, 0.245), (1.24, 0.18)],
        "cloak_ry": [(0.13, 0.80), (0.60, 0.75), (1.00, 0.70), (1.24, 0.72)],
        "open": ([(0.0, 0.190), (0.60, 0.140), (0.95, 0.105), (1.10, 0.080), (1.22, 0.065)], 1.22),
        "hem": (0.155, 0.0, 1),
        "folds": (0.019, 4.5, 0.6),                                # nine soft felt folds (r6: 1.6 -> 1.9 cm)
        "tabard": (0.105, 1.20, 0.37, 0.43),
        "pauldron_x": 0.352, "boot": (0.072, 0.11, 0.065),
        "staff_r": 0.027,
        "paint": {"wrist_R": (-0.29, -0.22, 0.82), "staff": (0.88, -0.05, 0.40), "yaw": 0.0,
                  "pole_R": (-0.9, 0.3, -0.4), "pole_L": (0.9, 0.2, -0.5)},
    },
}
MANTLE = {"rx": [(0.90, 0.449), (0.95, 0.448), (0.99, 0.447), (1.06, 0.438), (1.13, 0.410), (1.19, 0.365), (1.25, 0.300),
                 (1.30, 0.240), (1.335, 0.20)],
          "ry": [(0.90, 0.63), (0.95, 0.64), (1.20, 0.74), (1.335, 0.86)], "hem": 0.99, "notch": (8.5, 12.0, 1.21)}
# (r6, review r4: "a flat slab with a straight hem") the capelet's hem is SCALLOPED: each fold of the drape hangs a
# soft lobe (lowest at 45 k deg, the drape's crests), the cusps between rise; none on the lapels. (depth m, fade deg)
MANTLE_LOBE = (0.018, (26.0, 44.0))
MANTLE_WOB = 0.12           # the drape folds' wobble (rad): small, so the painted folds, the lobes and the low's columns agree


# ── small SDF helpers ────────────────────────────────────────────────────────────────────────────────
def ang(P):
    """world angle around Z: 0 = front (-Y), +90 deg = the wick's left (+X)"""
    return np.arctan2(P[:, 0], -P[:, 1])


class HemCut(sdf.Prim):
    """Inside above a hem line whose height varies around the Z axis: z > z0 + amp * points(angle)."""

    def __init__(self, z0: float, amp: float, n: int, extent: float = 1.0):
        self.z0, self.amp, self.n, self.e = float(z0), float(amp), int(n), float(extent)

    def bounds(self):
        return np.array([-self.e, -self.e, self.z0 - 0.05]), np.array([self.e, self.e, self.z0 + 2.5])

    def d(self, P):
        return hem_line(self.z0, self.amp, self.n, P) - P[:, 2]


class FnCut(sdf.Prim):
    """Inside above z = fn(angle) (a hem drawn as a function of the world angle)."""

    def __init__(self, fn, extent: float = 1.0, zlo: float = 0.0):
        self.fn, self.e, self.zlo = fn, float(extent), float(zlo)

    def bounds(self):
        return np.array([-self.e, -self.e, self.zlo]), np.array([self.e, self.e, self.zlo + 2.5])

    def d(self, P):
        return self.fn(ang(P)) - P[:, 2]


def hem_line(z0, amp, n, P):
    a = ang(P)
    tri = 1.0 - np.abs(((a * n / math.pi) % 2.0) - 1.0)        # 0..1 sawtooth: shallow points
    return z0 + amp * tri


def interp(table, z):
    zs, rs = zip(*table)
    return np.interp(z, zs, rs)


class Bell(sdf.Prim):
    """A lathe bell about the Z axis through (0, cy): radius rx(z) from `rtab`, depth ratio ry(z) from `rytab`
    (the side view flares too), between z0 and z1, `inset` in from its surface (approximate SDF: the radial
    distance along the elliptical ray)."""

    def __init__(self, rtab, rytab, z0, z1, inset=0.0, cy=0.0):
        self.rt, self.yt, self.z0, self.z1, self.inset, self.cy = rtab, rytab, float(z0), float(z1), float(inset), float(cy)
        self.rmax = max(r for _, r in rtab) + 0.06

    def bounds(self):
        return (np.array([-self.rmax, self.cy - self.rmax, self.z0 - 0.03]),
                np.array([self.rmax, self.cy + self.rmax, self.z1 + 0.03]))

    def d(self, P):
        z = P[:, 2]
        R = interp(self.rt, z) - self.inset
        ry = interp(self.yt, z)
        x, y = P[:, 0], P[:, 1] - self.cy
        re = np.sqrt(x * x + (y / ry) ** 2) + 1e-9
        side = (re - R) * np.sqrt(x * x + y * y + 1e-12) / re
        return np.maximum(np.maximum(side, z - self.z1), self.z0 - z)


def folds(amp, freq, wobble=0.5, phase=0.0, ztab=None, sharp=1.6):
    """vertical cloth folds around the Z axis: rounded crests, valleys as sharp as `sharp` (1 = a crease cusp,
    2 = a soft felt trough); faded out near the axis; `ztab` scales the amplitude by height (the cloth hangs in
    folds that open toward the hem)"""
    def fn(P):
        u = ang(P) * freq + phase + wobble * NOISE(P, 3.0)
        r = np.hypot(P[:, 0], P[:, 1])
        a = amp * smooth(0.10, 0.22, r)
        if ztab is not None:
            a = a * interp(ztab, P[:, 2])
        return a * (np.abs(np.sin(u)) ** sharp * 2.0 - 1.0) * -0.5
    return fn


def wraps(a, b, amp=0.004, pitch=0.022):
    """bandage ridges around the segment a -> b"""
    a, b = V3(a, float), V3(b, float)
    u = (b - a) / np.linalg.norm(b - a)

    def fn(P):
        t = (P - a) @ u
        return -amp * np.abs(np.sin(t * math.pi / pitch + 0.6 * NOISE(P, 6.0)))
    return fn


def chips(amp=0.004, freq=16.0):
    """carved chalk: shallow chipped facets"""
    return lambda P: amp * np.clip(NOISE.ridged(P, freq, 2), 0, 1) - amp * 0.4


def ell_surface_y(c, r, x, z, front=True):
    """y on an ellipsoid's front (-Y) or back surface at (x, z); nan outside."""
    q = 1.0 - ((x - c[0]) / r[0]) ** 2 - ((z - c[2]) / r[2]) ** 2
    y = r[1] * np.sqrt(np.maximum(q, 0.0))
    return np.where(q >= 0, c[1] - y if front else c[1] + y, np.nan)


class Tomb(sdf.Prim):
    """The hood's hollow: a TOMBSTONE outline in the XZ plane (an arch of radius w over straight sides, rounded
    bottom corners rc: the concepts' broad opening), extruded along +Y from y0 (in front of the hood) and
    closed at the back by an ellipsoid (a rounded head space): the opening keeps a crisp arch."""

    def __init__(self, w, zb, zt, rc, y0, c, r):
        self.w, self.zb, self.zt, self.rc, self.y0 = float(w), float(zb), float(zt), float(rc), float(y0)
        self.zc = self.zt - self.w
        self.E = Ellipsoid(c, r)

    def bounds(self):
        lo, hi = self.E.bounds()
        return (np.array([-self.w - 0.03, self.y0 - 0.02, self.zb - 0.03]),
                np.array([self.w + 0.03, hi[1] + 0.02, self.zt + 0.03]))

    def outline(self, x, z):
        """the 2D signed distance of the tombstone (x, z)"""
        x = np.abs(x)
        hz, cz = 0.5 * (self.zc - self.zb), 0.5 * (self.zc + self.zb)
        qx, qz = x - (self.w - self.rc), np.abs(z - cz) - (hz - self.rc)
        box = np.hypot(np.maximum(qx, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, qz), 0) - self.rc
        return np.minimum(box, np.where(z >= self.zc, np.hypot(x, z - self.zc) - self.w, 1.0))

    def d(self, P):
        d2 = self.outline(P[:, 0], P[:, 2])
        return np.maximum(np.maximum(d2, self.y0 - P[:, 1]), self.E.d(P))

    def arch(self, n=24):
        """points (x, z) up the left side, over the arch and down the right side, to the bottom corners (the rim:
        the sill below is the scarf / the gorget, never a lower lip)"""
        z0 = self.zb + self.rc * 0.6
        L_side = self.zc - z0
        tot = 2 * L_side + math.pi * self.w
        pts = []
        for i in range(n + 1):
            s = tot * i / n
            if s <= L_side:
                pts.append((-self.w, z0 + s))
            elif s <= L_side + math.pi * self.w:
                a = (s - L_side) / self.w
                pts.append((-self.w * math.cos(a), self.zc + self.w * math.sin(a)))
            else:
                pts.append((self.w, self.zc - (s - L_side - math.pi * self.w)))
        return pts

    def loop(self, n=30):
        """points (x, z) around the outline, starting at the arch top, clockwise seen from the front"""
        pts = []
        L_arc = math.pi * self.w
        L_side = self.zc - (self.zb + self.rc)
        L_corner = 0.5 * math.pi * self.rc
        L_bot = 2 * (self.w - self.rc)
        segs = [L_arc / 2, L_side, L_corner, L_bot, L_corner, L_side, L_arc / 2]
        tot = sum(segs)
        for i in range(n):
            s = tot * i / n
            k = 0
            while s > segs[k] and k < len(segs) - 1:
                s -= segs[k]
                k += 1
            if k == 0:                                         # arch, top -> right (x > 0)
                a = s / self.w
                pts.append((self.w * math.sin(a), self.zc + self.w * math.cos(a)))
            elif k == 1:
                pts.append((self.w, self.zc - s))
            elif k == 2:
                a = s / self.rc
                cx, cz = self.w - self.rc, self.zb + self.rc
                pts.append((cx + self.rc * math.cos(a), cz - self.rc * math.sin(a)))
            elif k == 3:
                pts.append((self.w - self.rc - s, self.zb))
            elif k == 4:
                a = s / self.rc
                cx, cz = -(self.w - self.rc), self.zb + self.rc
                pts.append((cx - self.rc * math.sin(a), cz - self.rc * math.cos(a)))
            elif k == 5:
                pts.append((-self.w, self.zb + self.rc + s))
            else:
                a = s / self.w
                pts.append((-self.w * math.cos(a), self.zc + self.w * math.sin(a)))
        return pts


def tomb_of(F) -> Tomb:
    (w, zb, zt, rc), (ec, er) = F["tomb"]
    return Tomb(w, zb, zt, rc, -0.6, ec, er)


def hood_outer(F) -> sdf.Blend:
    """the hood's outer form without its opening (the band, the rim and the radius queries sit on it)"""
    hc, hr = F["hood"]
    ops = [("add", Ellipsoid(hc, hr), 0.0)]
    if "hood_bell" in F:
        bell = F["hood_bell"]
        ops.append(("add", Bell(bell, [(0.0, 1.0), (2.0, 1.0)], bell[0][0], bell[-1][0], cy=hc[1]), 0.03))
    else:
        # swept back at the nape (the cowl falls back and down, never up), the lower hood flares onto the cowl
        ops += [("add", RoundCone((0, 0.06, 1.47), (0, 0.13, 1.33), 0.150, 0.135), 0.06),
                ("add", Ellipsoid((0, 0.02, 1.36), (0.225, 0.215, 0.085)), 0.05)]
    return sdf.Blend(ops)


_HOOD_R: dict = {}


def hood_radius(F, z):
    """(rx, ry) of the hood's outer surface at height z: rays from the hood axis to the side and the front"""
    key = (id(F), round(float(z), 4))
    if key not in _HOOD_R:
        D = hood_outer(F)
        cy = F["hood"][0][1]
        t = march_in(D, np.array([(0.0, cy, z)] * 2), np.array([(1.0, 0.0, 0.0), (0.0, -1.0, 0.0)]), 0.45, steps=90)
        _HOOD_R[key] = (float(t[0]), float(t[1]))
    return _HOOD_R[key]


def opening_loop(F, n=24, lift=0.0, full=False):
    """the rim path: the tombstone's sides and arch laid on the hood's outer front surface (rays along +Y);
    `full`: the whole outline, round the bottom corners and along the sill, closed (the last point = the first)"""
    T = tomb_of(F)
    D = hood_outer(F)
    xz = T.arch(n) if not full else T.loop(n) + T.loop(n)[:1]
    # march_in finds the outermost crossing coming in from t = rmax: rays from the hood's mid plane toward -Y
    O = np.array([(x, 0.0, z) for x, z in xz])
    t = march_in(D, O, np.tile((0.0, -1.0, 0.0), (len(O), 1)), 0.6, steps=120)
    return [(x, (-float(b) if np.isfinite(b) else -0.2) - lift, z) for (x, z), b in zip(xz, t)]


def loop_tube(S, pts, r, k=0.006, closed=True):
    for i in range(len(pts) if closed else len(pts) - 1):
        S.add(Capsule(pts[i], pts[(i + 1) % len(pts)], r), k=k)


def sdf_of(S: Sculpt):
    """point-evaluable SDF of a sculpt (its op list as one Blend)"""
    return sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])


def onto_surface(D, P, n, reach=0.08, lift=0.0):
    """march each point from P + n*reach back along -n to the zero set of D (bisection); returns the surface
    points lifted by `lift` and the SDF gradient normals there"""
    P, n = np.asarray(P, float), np.asarray(n, float)
    n = n / np.linalg.norm(n, axis=1, keepdims=True)
    lo, hi = np.full(len(P), -reach), np.full(len(P), reach)          # offsets along n: lo inside, hi outside
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        d = D.d(P + n * mid[:, None])
        inside = d < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    S = P + n * (0.5 * (lo + hi))[:, None]
    e = 1e-3
    g = np.stack([D.d(S + np.eye(3)[i] * e) - D.d(S - np.eye(3)[i] * e) for i in range(3)], 1)
    g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-12
    return S + g * lift, g


def march_in(D, O, d, rmax, steps=64):
    """t of the OUTERMOST zero crossing of D on each ray O + t d, marching in from t = rmax (nan: never inside)"""
    O, d = np.asarray(O, float), np.asarray(d, float)
    n = len(O)
    t_in, t_out = np.full(n, np.nan), np.full(n, np.nan)
    prev = np.full(n, float(rmax))
    for t in np.linspace(rmax, 0.0, steps)[1:]:
        idx = np.nonzero(np.isnan(t_in))[0]
        if not len(idx):
            break
        hit = D.d(O[idx] + d[idx] * t) < 0
        t_in[idx[hit]] = t
        t_out[idx[hit]] = prev[idx[hit]]
        prev[idx[~hit]] = t
    ok = ~np.isnan(t_in)
    lo, hi = t_in[ok], t_out[ok]
    Oo, do = O[ok], d[ok]
    for _ in range(26):
        mid = 0.5 * (lo + hi)
        inside = D.d(Oo + do * mid[:, None]) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    t = np.full(n, np.nan)
    t[ok] = 0.5 * (lo + hi)
    return t


# ── explicit low meshes (clean, smooth, never gem-cut) ─────────────────────────────────────────────────
def orient(V, F, outward):
    """flip triangles whose normal points against `outward` (a point inside, or ('dir', d))"""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, c - a)
    if isinstance(outward, tuple) and outward and outward[0] == "dir":
        o = np.broadcast_to(np.asarray(outward[1], float), n.shape)
    else:
        o = (a + b + c) / 3.0 - np.asarray(outward, float)
    flip = (n * o).sum(1) < 0
    F = F.copy()
    F[flip] = F[flip][:, ::-1]
    return F


def wind_like(V, F, i_test, outward_dir):
    """flip ALL of F when triangle i_test faces against outward_dir (consistent grid winding kept)"""
    a, b, c = V[F[i_test, 0]], V[F[i_test, 1]], V[F[i_test, 2]]
    if np.dot(np.cross(b - a, c - a), outward_dir) < 0:
        return F[:, ::-1].copy()
    return F


def grid_faces(nu, nv, closed=True, off=0):
    """two triangles per cell of an (nu columns x nv rows) vertex grid, column-major (i * nv + j)"""
    F = []
    for i in range(nu if closed else nu - 1):
        i2 = (i + 1) % nu
        for j in range(nv - 1):
            a, b, c, d = off + i * nv + j, off + i2 * nv + j, off + i2 * nv + j + 1, off + i * nv + j + 1
            F += [(a, b, c), (a, c, d)]
    return np.array(F, dtype=np.int64)


def lathe_mesh(c, axes, prof, nu, aspect=(1.0, 1.0)):
    """surface of revolution (triangles) about axes[2] through c: prof = [(z, s), ...] in order, s = 0 makes a
    pole; ring radius s * aspect along axes[0] / axes[1]"""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    V, rings = [], []
    for z, s in prof:
        if s <= 1e-7:
            rings.append([len(V)])
            V.append(c + ax[2] * z)
            continue
        idx = []
        for i in range(nu):
            a = 2 * math.pi * (i + 0.5) / nu
            idx.append(len(V))
            V.append(c + ax[0] * math.cos(a) * s * aspect[0] + ax[1] * math.sin(a) * s * aspect[1] + ax[2] * z)
        rings.append(idx)
    F = []
    for A, B in zip(rings[:-1], rings[1:]):
        if len(A) == 1:
            F += [(A[0], B[(i + 1) % nu], B[i]) for i in range(nu)]
        elif len(B) == 1:
            F += [(A[i], A[(i + 1) % nu], B[0]) for i in range(nu)]
        else:
            for i in range(nu):
                j = (i + 1) % nu
                F += [(A[i], A[j], B[j]), (A[i], B[j], B[i])]
    V = np.array(V)
    F = np.array(F, dtype=np.int64)
    # wind outward: per triangle against the axis point at its own height
    cen = V[F].mean(1)
    zc = (cen - c) @ ax[2]
    ref = c[None] + ax[2][None] * zc[:, None]
    a, b, cc = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, cc - a)
    o = cen - ref
    along = np.abs(o).sum(1) < 1e-6
    o[along] = ax[2] * np.sign(zc[along] - np.mean([z for z, _ in prof]))[:, None]
    flip = (n * o).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


def ellipsoid_mesh(c, r, nu=10, nv=6, axes=None):
    ax = np.eye(3) if axes is None else np.asarray(axes, float)
    prof = [(r[2] * math.cos(math.pi * j / nv), math.sin(math.pi * j / nv)) for j in range(nv, -1, -1)]
    return lathe_mesh(c, ax, prof, nu, aspect=(r[0], r[1]))


def taubin(v, q, iters=4, lam=0.5, mu=-0.53):
    """Taubin smoothing (no shrink) of a surface-nets mesh: the voxel layers left faint terraces on smooth
    domes that the normal bake turned into horizontal strata (the Serenade felt dome and mantle)"""
    v = np.asarray(v, dtype=np.float64).copy()
    q = np.asarray(q, dtype=np.int64)
    e = np.concatenate([q[:, [k, (k + 1) % q.shape[1]]] for k in range(q.shape[1])])
    e = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e[:, 0], minlength=len(v)).astype(np.float64)
    ok = deg > 0
    for _ in range(iters):
        for f in (lam, mu):
            acc = np.zeros_like(v)
            np.add.at(acc, e[:, 0], v[e[:, 1]])
            lap = np.zeros_like(v)
            lap[ok] = acc[ok] / deg[ok][:, None] - v[ok]
            v = v + f * lap
    return v


def merge_meshes(meshes):
    V, F, o = [], [], 0
    for v, f in meshes:
        V.append(v)
        F.append(f + o)
        o += len(v)
    return np.concatenate(V), np.concatenate(F)


def ribbon(pts, nrm, width, thick, sink=0.006):
    """a flat strip mesh (quads) along `pts` lying on the surface with normals `nrm`: width x (thick above,
    `sink` below the surface). Clean low geometry for the accent inlays (decimated SDF strips go ragged)."""
    pts, nrm = np.asarray(pts, float), np.asarray(nrm, float)
    n = len(pts)
    width = np.broadcast_to(np.asarray(width, float), (n,))
    tan = np.gradient(pts, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    side = np.cross(tan, nrm)
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    up = np.cross(side, tan)
    V = []
    for i in range(n):
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            V.append(pts[i] + side[i] * sx * width[i] / 2 + up[i] * (thick if sz > 0 else -sink))
    F = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(1, 4):                      # sides + top; the face under the surface is never seen
            k2 = (k + 1) % 4
            F.append((a + k, a + k2, b + k2, b + k))
    F.append((3, 2, 1, 0))
    e = 4 * (n - 1)
    F.append((e + 0, e + 1, e + 2, e + 3))
    F = np.array(F)
    tri = np.concatenate([F[:, [0, 1, 2]], F[:, [0, 2, 3]]])
    V = np.array(V)
    # wind outward from the strip's core (the middle of its section)
    cen = V[tri].mean(1)
    d2 = ((cen[:, None, :] - pts[None]) ** 2).sum(2)
    near = np.argmin(d2, axis=1)
    ref = pts[near] + up[near] * (thick - sink) * 0.5
    a, b, c = V[tri[:, 0]], V[tri[:, 1]], V[tri[:, 2]]
    nn = np.cross(b - a, c - a)
    flip = (nn * (cen - ref)).sum(1) < 0
    tri[flip] = tri[flip][:, ::-1]
    return V, tri


def flat_strip(pts, nrm, width, lift=0.0015):
    """a flat strip (2 triangles per segment, no side walls) lying `lift` over a surface: for long inlays where
    a boxed ribbon would cost 3x the triangles"""
    pts, nrm = np.asarray(pts, float), np.asarray(nrm, float)
    tan = np.gradient(pts, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    side = np.cross(tan, nrm)
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    V = []
    for i in range(len(pts)):
        for sx in (-1.0, 1.0):
            V.append(pts[i] + nrm[i] * lift + side[i] * sx * width / 2)
    V = np.array(V)
    F = []
    for i in range(len(pts) - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        F += [(a, b, c), (a, c, d)]
    F = np.array(F, dtype=np.int64)
    cen = V[F].mean(1)
    near = np.argmin(((cen[:, None, :] - pts[None]) ** 2).sum(2), axis=1)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    flip = (nn * nrm[near]).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


def lathe_low(D, angles_deg, zrows, cy=0.0, rmax=0.75, lip=None, bottom_cap=False, top_cap=False):
    """A clean game low for a bell-like part: a grid of columns (world angles, deg; 0 = front) x rows (zrows(a)
    -> heights, top first), every vertex the OUTERMOST point of the sculpt D on the horizontal ray from the axis
    (0, cy, z). Hems and openings get their own rows / columns, so edges are straight and clean (no decimation
    teeth). lip: [(dr, dz), ...] extra rows under the bottom row, (radius - dr, z_hem + dz): a thick turned hem.
    Returns (V, F) triangles, wound outward."""
    # a column is an angle (deg) or a function of z -> angle (a column that follows a wall down); columns are
    # ordered by their angle at mid height
    fns = [(c if callable(c) else (lambda z, c=c: c)) for c in angles_deg]
    fns.sort(key=lambda f: f(0.7))
    A0 = [math.radians(f(0.7)) for f in fns]
    rows = [np.asarray(zrows(a), float) for a in A0]
    nu, nv = len(fns), len(rows[0])
    O = np.array([(0.0, cy, z) for zs in rows for z in zs])
    ang_ = [math.radians(f(z)) for f, zs in zip(fns, rows) for z in zs]
    d = np.array([(math.sin(a), -math.cos(a), 0.0) for a in ang_])
    t = march_in(D, O, d, rmax).reshape(nu, nv)
    for i in range(nu):                                       # a ray that missed: its column neighbour
        bad = np.isnan(t[i])
        if bad.any():
            good = np.nonzero(~bad)[0]
            t[i, bad] = np.interp(np.nonzero(bad)[0], good, t[i, good]) if len(good) else 0.05
    V = (O + d * t.reshape(-1)[:, None]).reshape(nu, nv, 3)
    if lip:
        ext = []
        for dr, dz in lip:
            e = V[:, -1].copy()
            dd = d.reshape(nu, nv, 3)[:, -1]
            e = e - dd * dr
            e[:, 2] += dz
            ext.append(e)
        V = np.concatenate([V, np.stack(ext, 1)], 1)
    nv2 = V.shape[1]
    Vf = V.reshape(-1, 3)
    F = grid_faces(nu, nv2)
    F = wind_like(Vf, F, 0, Vf[F[0]].mean(0) - np.array((0.0, cy, Vf[F[0]].mean(0)[2])))
    extra_V, extra_F = [Vf], [F]
    o = len(Vf)
    if bottom_cap:
        last = V[:, nv - 1]
        c = np.array((0.0, cy, last[:, 2].mean() + 0.03))
        Fc = np.array([(i * nv2 + nv - 1, ((i + 1) % nu) * nv2 + nv - 1, o) for i in range(nu)], dtype=np.int64)
        extra_V.append(c[None])
        extra_F.append(orient(np.concatenate(extra_V), Fc, ("dir", (0.0, 0.0, -1.0))))
        o += 1
    if top_cap:
        first = V[:, 0]
        c = np.array((0.0, cy, first[:, 2].mean()))
        Fc = np.array([(i * nv2, ((i + 1) % nu) * nv2, o) for i in range(nu)], dtype=np.int64)
        extra_V.append(c[None])
        extra_F.append(orient(np.concatenate(extra_V), Fc, ("dir", (0.0, 0.0, 1.0))))
        o += 1
    return np.concatenate(extra_V), np.concatenate(extra_F)


def central_low(D, c, axes, nu, thetas_deg, rmax=0.4):
    """A clean low for a dome / convex part: rings of rays from a centre `c` (local frame `axes`, rows = local
    X, Y, Z; theta from local +Z), every vertex the outermost point of D on its ray. Poles at theta 0 / 180."""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    dirs, rings = [], []
    for th in thetas_deg:
        t = math.radians(th)
        if th <= 1e-6 or th >= 180 - 1e-6:
            rings.append([len(dirs)])
            dirs.append(ax[2] * math.cos(t))
            continue
        idx = []
        for i in range(nu):
            p = 2 * math.pi * (i + 0.5) / nu
            idx.append(len(dirs))
            dirs.append(ax[0] * math.sin(t) * math.cos(p) + ax[1] * math.sin(t) * math.sin(p) + ax[2] * math.cos(t))
        rings.append(idx)
    dirs = np.array(dirs)
    t = march_in(D, np.tile(c, (len(dirs), 1)), dirs, rmax)
    t = np.where(np.isnan(t), np.nanmin(t), t)
    V = c[None] + dirs * t[:, None]
    F = []
    for A, B in zip(rings[:-1], rings[1:]):
        if len(A) == 1:
            F += [(A[0], B[(i + 1) % nu], B[i]) for i in range(nu)]
        elif len(B) == 1:
            F += [(A[i], A[(i + 1) % nu], B[0]) for i in range(nu)]
        else:
            for i in range(nu):
                j = (i + 1) % nu
                F += [(A[i], A[j], B[j]), (A[i], B[j], B[i])]
    F = np.array(F, dtype=np.int64)
    return V, orient(V, F, c)


def cube_grid(n):
    """points on the surface of the cube [-1, 1]^3 (an n x n grid per face, shared edges merged) + triangles"""
    P, F, key = [], [], {}

    def vid(p):
        k = tuple(np.round(p, 6))
        if k not in key:
            key[k] = len(P)
            P.append(p)
        return key[k]
    for ax_ in range(3):
        for sgn in (-1.0, 1.0):
            u_ax, v_ax = [a for a in range(3) if a != ax_]
            ids = np.zeros((n + 1, n + 1), dtype=np.int64)
            for i in range(n + 1):
                for j in range(n + 1):
                    p = np.zeros(3)
                    p[ax_] = sgn
                    p[u_ax] = -1 + 2 * i / n
                    p[v_ax] = -1 + 2 * j / n
                    ids[i, j] = vid(p)
            for i in range(n):
                for j in range(n):
                    F += [(ids[i, j], ids[i + 1, j], ids[i + 1, j + 1]), (ids[i, j], ids[i + 1, j + 1], ids[i, j + 1])]
    return np.array(P), np.array(F, dtype=np.int64)


def box_low(box: RoundBox, n=2):
    """a clean low for a rounded slab: a cube grid scaled to the box, each vertex projected from the box centre
    onto the box's own SDF (so stacked plates keep their own clean shells)"""
    Q, F = cube_grid(n)
    loc = Q * box.h[None]
    dirs = loc @ box.ax                                           # local -> world (rows of ax are the local axes)
    rmax = np.linalg.norm(loc, axis=1) * 1.2 + 0.03
    dirs = dirs / np.linalg.norm(dirs, axis=1, keepdims=True)
    t = np.array([march_in(box, box.c[None], dirs[i:i + 1], rmax[i], steps=24)[0] for i in range(len(dirs))])
    V = box.c[None] + dirs * t[:, None]
    return V, orient(V, F, box.c)


def band_mesh(cy, z0, z1, rad_fn, t_in, t_out, nu, a_range=None):
    """a band with a rectangular section around the Z axis through (0, cy): inner face rad_fn(z) + t_in, outer
    rad_fn(z) + t_out (rad_fn(z) -> (rx, ry) of the surface it sits on), between z0 and z1. Closed ring, or a C
    from a_range = (a0, a1) deg with end caps. Returns (V, F, surf(a_deg, z) -> outer face point)."""
    closed = a_range is None
    A = (np.radians((np.arange(nu) + 0.5) * 360.0 / nu) if closed
         else np.radians(np.linspace(a_range[0], a_range[1], nu)))
    sec = [(z0, t_in), (z0, t_out), (z1, t_out), (z1, t_in)]

    def pt(a, z, t):
        rx, ry = rad_fn(z)
        return np.array((math.sin(a) * (rx + t), cy - math.cos(a) * (ry + t), z))
    V = np.array([pt(a, z, t) for a in A for z, t in sec])
    F = []
    n_ = len(A)
    for i in range(n_ if closed else n_ - 1):
        i2 = (i + 1) % n_
        for k in range(4):
            k2 = (k + 1) % 4
            a, b, c, d = i * 4 + k, i2 * 4 + k, i2 * 4 + k2, i * 4 + k2
            F += [(a, b, c), (a, c, d)]
    if not closed:
        for i in (0, n_ - 1):
            F += [(i * 4, i * 4 + 1, i * 4 + 2), (i * 4, i * 4 + 2, i * 4 + 3)]
    F = np.array(F, dtype=np.int64)
    zm = 0.5 * (z0 + z1)
    tm = 0.5 * (t_in + t_out)
    cen = V[F].mean(1)
    a_c = np.arctan2(cen[:, 0], -(cen[:, 1] - cy))
    ref = np.array([pt(a, zm, tm) for a in a_c])
    a_, b_, c_ = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nn = np.cross(b_ - a_, c_ - a_)
    flip = (nn * (cen - ref)).sum(1) < 0
    F[flip] = F[flip][:, ::-1]

    def surf(a_deg, z, lift=0.0):
        return pt(math.radians(a_deg), z, t_out + lift)
    return V, F, surf


def disc_on(surf, a_deg, z, r, nseg=8, lift=0.0016, dz_per_m=1.0, rad_fn=None):
    """a round glazing disc on a band face that FOLLOWS its curve: centre + ring points mapped through
    surf(angle, z) (the band's outer face), so nothing stands proud edge-on"""
    c = surf(a_deg, z, lift)
    rx, _ = rad_fn(z) if rad_fn else (0.2, 0.2)
    V = [c]
    for i in range(nseg):
        ph = 2 * math.pi * i / nseg
        da = math.degrees(r * math.cos(ph) / max(rx, 0.05))
        V.append(surf(a_deg + da, z + r * math.sin(ph) * dz_per_m, lift))
    V = np.array(V)
    F = np.array([(0, 1 + i, 1 + (i + 1) % nseg) for i in range(nseg)], dtype=np.int64)
    out = c - np.array((0.0, 0.0, c[2]))
    out[2] = 0.0
    return V, orient(V, F, ("dir", out))


def torus_mesh(c, axes, R, r, nu=16, nv=6, rz=None, ry_scale=1.0, tube=None):
    """an explicit torus (tube radius r, squashed to rz along the local Z), ring scaled by ry_scale on local Y;
    tube(a_rad) -> (r scale, rz scale, z offset) varies the tube round the ring (CollarTorus)"""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    rz = r if rz is None else rz
    V = []
    for i in range(nu):
        a = 2 * math.pi * (i + 0.5) / nu
        ca, sa = math.cos(a), math.sin(a)
        ks, kz, dz = tube(a) if tube is not None else (1.0, 1.0, 0.0)
        for j in range(nv):
            b = 2 * math.pi * j / nv
            rr = R + r * ks * math.cos(b)
            V.append(c + ax[0] * ca * rr + ax[1] * sa * rr * ry_scale + ax[2] * (rz * kz * math.sin(b) + dz))
    V = np.array(V)
    F = []
    for i in range(nu):
        i2 = (i + 1) % nu
        for j in range(nv):
            j2 = (j + 1) % nv
            a_, b_, c_, d_ = i * nv + j, i2 * nv + j, i2 * nv + j2, i * nv + j2
            F += [(a_, b_, c_), (a_, c_, d_)]
    F = np.array(F, dtype=np.int64)
    cen = V[F].mean(1)
    loc = (cen - c) @ ax.T
    aa = np.arctan2(loc[:, 1] / ry_scale, loc[:, 0])
    core = c[None] + ax[0][None] * (np.cos(aa) * R)[:, None] + ax[1][None] * (np.sin(aa) * R * ry_scale)[:, None]
    a_, b_, c_ = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nn = np.cross(b_ - a_, c_ - a_)
    flip = (nn * (cen - core)).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


def shell_mesh(O, ax, r, th, ph, thick, n_th, n_ph, closed=False, edge_fn=None):
    """A curved PLATE: the band theta in `th` (deg from the frame's +Z) x phi in `ph` (deg about +Z from +X; or
    the full ring when `closed`) of the ellipsoid (centre O, frame rows `ax`, radii r), `thick` deep: the outer
    and inner sheets and their edges (clean, closed, wound outward). th[0] == 0 makes a pole (a cap).
    edge_fn(phi_deg) -> extra theta (deg) on the LOWER edge (a pointed lame)."""
    O, ax, r = np.asarray(O, float), np.asarray(ax, float), np.asarray(r, float)
    ri = r - thick
    rm = r - thick * 0.5
    nT, nP = n_th, n_ph
    pole = th[0] <= 1e-6
    phs = (np.arange(nP) * 360.0 / nP) if closed else np.linspace(ph[0], ph[1], nP)

    def tdeg(i, j):
        t = th[0] + (th[1] - th[0]) * i / (nT - 1)
        if edge_fn is not None and i == nT - 1:
            t += float(edge_fn(phs[j]))
        return t

    def pt(t, p, rr):
        t, p = math.radians(t), math.radians(p)
        return (O + ax[0] * rr[0] * math.cos(p) * math.sin(t) + ax[1] * rr[1] * math.sin(p) * math.sin(t)
                + ax[2] * rr[2] * math.cos(t))
    V, idx = [], {}
    for s, rr in (("o", r), ("i", ri)):
        for i in range(nT):
            for j in range(nP):
                if pole and i == 0 and j > 0:
                    idx[(s, i, j)] = idx[(s, 0, 0)]
                    continue
                idx[(s, i, j)] = len(V)
                V.append(pt(tdeg(i, j), phs[j], rr))
    V = np.array(V)
    tris, refs = [], []

    def quad(a, b, c, d, ref):
        for t in ((a, b, c), (a, c, d)):
            if len(set(t)) == 3:
                tris.append(t)
                refs.append(ref)
    jr = range(nP) if closed else range(nP - 1)
    for s in ("o", "i"):
        for i in range(nT - 1):
            for j in jr:
                j2 = (j + 1) % nP
                a, b, c, d = idx[(s, i, j)], idx[(s, i, j2)], idx[(s, i + 1, j2)], idx[(s, i + 1, j)]
                mid = pt(0.5 * (tdeg(i, j) + tdeg(i + 1, j)), phs[j], rm)
                # outer sheet faces away from the mid-surface, inner sheet toward O (away from the mid-surface too)
                quad(a, b, c, d, ("away", mid, s))
    for i_edge, inward in (((nT - 1), -1),) + ((((0), 1),) if not pole else ()):
        for j in jr:
            j2 = (j + 1) % nP
            ref = pt(tdeg(i_edge, j) + inward * 4.0, 0.5 * (phs[j] + phs[j2]) if not (closed and j2 == 0) else phs[j],
                     rm)
            quad(idx[("o", i_edge, j)], idx[("o", i_edge, j2)], idx[("i", i_edge, j2)], idx[("i", i_edge, j)],
                 ("from", ref))
    if not closed:
        for j_edge, inward in ((0, 1), (nP - 1, -1)):
            for i in range(nT - 1):
                ref = pt(0.5 * (tdeg(i, j_edge) + tdeg(i + 1, j_edge)), phs[j_edge] + inward * 4.0, rm)
                quad(idx[("o", i, j_edge)], idx[("o", i + 1, j_edge)], idx[("i", i + 1, j_edge)],
                     idx[("i", i, j_edge)], ("from", ref))
    F = np.array(tris, dtype=np.int64)
    a_, b_, c_ = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b_ - a_, c_ - a_)
    cen = (a_ + b_ + c_) / 3.0
    want = np.zeros_like(n)
    for k, ref in enumerate(refs):
        if ref[0] == "away":
            o = cen[k] - ref[1]
            want[k] = o if ref[2] == "o" else -o
            # the mid-surface point is on the same ray: use the ellipsoid normal direction instead (robust)
            g = (cen[k] - O) @ ax.T / (rm * rm)
            g = g @ ax
            want[k] = g if ref[2] == "o" else -g
        else:
            want[k] = cen[k] - ref[1]
    flip = (n * want).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


# ── the spec ───────────────────────────────────────────────────────────────────────────────────────
class Brightwick(wc.Wick):
    KIND_ID = "brightwick"
    HEIGHT = 1.7

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.F = FORM[faction]
        sw = self.F["shoulder"]
        # VALE_BIPED_1 at minion proportions, fitted to the concepts: head bone 1.34 -> 1.60 inside the hood,
        # shoulder joints x +-0.21 at 1.26, hips at 0.62, ankles x +-0.15 at 0.09, short heavy arms
        self.PROPORTIONS = rig.proportions(height=1.60, head=0.30, neck=0.04, shoulder_width=2 * sw, hip_width=0.20,
                                           leg=0.535, thigh_frac=0.50, arm=0.56, upper_arm_frac=0.56, hand=0.11,
                                           foot=0.21, ankle_height=0.09, stance=0.05, toe_out_deg=8.0, knee_bend=0.012,
                                           spine_curve=0.0, a_pose_deg=64.0, arm_forward_deg=12.0, elbow_bend_deg=22.0,
                                           shoulder_drop=0.04)
        self.MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.3)
        self.AO_INTO_BASE = 0.18             # the paint carries the contact shadow (contact_ao) itself
        # the pipeline paints the base colour through project.paint_object when PROJECTION is set; this id routes
        # it to `paint_hybrid` (the graded plates projected in the paint pose, laid over the painted base)
        self.PROJECTION = {"concept": f"wicks/brightwick_{faction}_bw", "height": 1.70}
        self.parts_info: dict = {}            # part -> (material role, (SDF grid, lo, voxel) or None)
        PAINT[self.PROJECTION["concept"]] = self
        SPECS[self.ID] = self

    # ── model ──
    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        self.parts_info = {}
        matte_accent(ctx.mats.get("accent"))
        wc.halo_material(ctx)
        wc.halo_material(ctx, HALO_BW)
        wc.install_halo_export()
        for name, S, vs, role, bind, tris, uvw, low in self.sculpts(ctx):
            if isinstance(S, tuple):                       # ("mesh", verts, faces): explicit low geometry
                ob = sdf.to_object(f"{name}_low", S[1], S[2], ctx.col)
                ob.data.materials.append(ctx.mats[role])
                self.parts_info[name] = (role, None)
                P.append(fighter.Part(name, low=ob, bind=bind, uv_weight=uvw))
                continue
            vox = VOXEL * vs
            D, lo = S.evaluate(vox)
            v, q = sdf.surface_nets(D, lo, vox)
            v = taubin(v, q)             # (fix pass 5) no voxel terraces: they baked into the normal map as strata
            self.parts_info[name] = (role, (np.clip(D, -0.1, 0.1).astype(np.float32), np.asarray(lo, float), vox))
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[role])
            if low is not None:
                # a clean projected low (see lathe_low / central_low / box_low): the sculpt is only the bake source
                lv, lf = low(sdf_of(S))
                lo_ob = sdf.to_object(f"{name}_low", lv, lf, ctx.col)
                lo_ob.data.materials.append(ctx.mats[role])
                P.append(fighter.Part(name, high=ob, low=lo_ob, bind=bind, uv_weight=uvw))
                continue
            # the game mesh: the pipeline's symmetric collapse stalls on some parts, so the low is made here,
            # symmetric first, plain collapse when that stalls
            lo_ob = mesh.duplicate(ob, f"{name}_low", ctx.col)
            if mesh.decimate_to(lo_ob, tris) > tris * 1.25:
                bpy.data.objects.remove(lo_ob)
                lo_ob = mesh.duplicate(ob, f"{name}_low", ctx.col)
                mesh.decimate_to(lo_ob, tris, symmetric=False)
            if name == "hood":
                snap_hollow(self.F, lo_ob)
                refine_hollow(self.F, lo_ob, sdf_of(S))
            P.append(fighter.Part(name, high=ob, low=lo_ob, tris=tris, bind=bind, uv_weight=uvw))
        return P

    def sculpts(self, ctx) -> list:
        out = []
        budget = TRIS[self.faction]

        def part(name, S, role, bind, tris, vs=1.0, uvw=1.0, low=None):
            out.append((name, S, vs, role, bind, budget.get(name, tris), uvw, low))
        info = ctx.info
        F = self.F
        aub = self.faction == "aubade"
        hood_parts(F, aub, part)
        body_parts(F, aub, info, part)
        arm_parts(F, aub, info, part)
        staff_parts(self, F, aub, info, part)
        return out

    # ── rig ──
    def rig_extras(self, ctx) -> None:
        """ONE extra deform bone, x_hem_1 (CONTRACT §12: extra bones `x_`): a root child at the hem's centre that
        the lower bell rides. The hem stays on the ground while the hips drop (the death: the cloak PILES under
        the falling body instead of toppling as a rigid tube); every clip keys it (it follows the hips' turn and
        lean in the run, the strike and the idle). Not a sway chain: chain_config() returns none."""
        if self.faction == wc.LEGACY:
            return
        rig.add_chain(ctx.info, "hem", "root", [(0.0, 0.0, 0.02), (0.0, 0.0, 0.30)], z_hint=(0.0, -1.0, 0.0))

    def chain_config(self, ctx) -> list:
        return []

    # ── clips ──
    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        skel = anim.Skeleton(ctx.info.armature)
        return clips(self, skel, ctx)

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        info = ctx.info
        hz = (info.j("head_base").z + info.j("crown").z) / 2
        wc.legacy_weapon(self, ctx, part, "ironstone", (0.07, 0.07, 0.09))
        wc.legacy_pole_lamp(self, ctx, part, rise=0.3)
        plates = Sculpt("pauldrons")
        for s in ("L", "R"):
            a = info.side("shoulder", s)
            plates.add(Ellipsoid((a.x, a.y, a.z + 0.04 * k), (0.11 * k, 0.1 * k, 0.06 * k)), k=0.0)
        part("pauldrons", plates, "stone", "bone:chest", 300)
        ring = Sculpt("crown")
        ring.add(Torus((0, 0.02 * k, hz + 0.18 * k), 0.12 * k, 0.025 * k), k=0.0)
        part("crown", ring, "accent", "bone:head", 120)


ACCENT_ROUGH = 0.78         # the accent's roughness on these builds (materials.accent authors 0.25: a glossy
# hotspot on every lamp made the hood light an egg and the crown windows buttons / cabochons; the bible bans gems)


def matte_accent(mat) -> None:
    """a matte accent: the emissive glow carries the read, no specular hotspot (exported as roughnessFactor)"""
    if mat is None or not mat.use_nodes:
        return
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            for ln in list(n.inputs["Roughness"].links):
                mat.node_tree.links.remove(ln)
            n.inputs["Roughness"].default_value = ACCENT_ROUGH


# triangle budget per decimated part (brief §1: brightwick <= 4.0k). Projected and explicit lows count their own
# triangles (their grids are sized in the part functions).
TRIS = {
    # (r6: the forearm wraps and the mitts are explicit clean lows now: wrap_mesh, box_low + the thumb)
    # (r7: the hood 440 -> 390 pays for the ten-lamp crown and the hollow refine's splits; the Serenade hood 310 -> 300
    # for the refine; the halo 10 round)
    "aubade": {"hood": 390, "hood_rim": 110, "legs": 64, "boot_L": 84, "boot_R": 84,
               "sleeves": 150, "staff": 130},
    "serenade": {"hood": 300, "hood_rim": 110, "legs": 40, "boot_L": 84, "boot_R": 84,
                 "sleeves": 138, "cuffs": 48, "staff": 110},
}
PAINT: dict = {}            # paint id -> spec (the hybrid paint looks its spec up here)
SPECS: dict = {}            # build id -> spec (the ORM hook)


# ── hood, crown ──────────────────────────────────────────────────────────────────────────────────────
def hood_parts(F, aub, part):
    hood = Sculpt("hood")
    if aub:
        # a soft linen COWL, not a helm: shallow folds sweep from under the circlet down and back to the nape
        # (the cloth hangs from the crown), fading out over the dome (the circlet and the seam sit on a smooth top)
        hc = F["hood"][0]

        def drape(P):
            # mirror-symmetric (|angle|: no crease down the back), smooth under the seam (|x| < 4 cm)
            a = np.abs(np.arctan2(P[:, 0], -(P[:, 1] - hc[1])))
            back = smooth(40.0, 120.0, np.degrees(a))
            low = 1.0 - smooth(1.50, 1.60, P[:, 2])
            seam = smooth(0.025, 0.055, np.abs(P[:, 0]))
            u = a * 3.5 + (P[:, 2] - 1.45) * 7.0 + 0.5 * NOISE(P, 4.0)
            return -0.010 * (0.35 + 0.65 * back) * low * seam * np.abs(np.sin(u)) ** 1.5
        hood.add(hood_outer(F).displaced(drape, 0.011), k=0.0)
    else:
        hood.add(hood_outer(F), k=0.0)
    # the broad tombstone opening into a rounded head space; its walls are painted ink (no separate lining:
    # a second shell inside read as a lip / tongue)
    hood.sub(tomb_of(F), k=0.010)
    if not aub:
        # (fix round 3) the felt dome's TOP is its own clean low (rings of rays from the dome's centre): decimated,
        # its cap went to a few big facets (a flat triangle on the crown, a polygonal silhouette at close range).
        # The two meet under the crown band.
        hood.inter(HalfSpace((0.0, 0.0, CAP_Z[1]), (0.0, 0.0, 1.0), 2.0), k=0.0)
    part("hood", hood, "cloth2", "bone:head", 620, 1.0, 1.4)
    if not aub:
        hc = np.asarray(F["hood"][0], dtype=np.float64)
        cap = Sculpt("hood_cap")
        cap.add(hood_outer(F), k=0.0)
        cap.inter(HalfSpace((0.0, 0.0, CAP_Z[0]), (0.0, 0.0, -1.0), 2.0), k=0.0)
        part("hood_cap", cap, "cloth2", "bone:head", 0, 1.0, 1.2,
             low=lambda D, hc=hc: central_low(hood_outer(F), hc, np.eye(3), 16, [0.0, 16.0, 31.0, 45.0, 57.0]))
    # the rim round the opening's arch. Aubade (fix round 3): a FLAT CARVED CHALK BAND lying on the cowl (an inner
    # wall turning back into the hollow, chamfers, a flat face 1.1 cm proud, a fall into the linen): the round
    # white tube read as lips round a mouth. Serenade: the rolled dark felt edge (a clean swept tube over the
    # capsule chain it is baked from)
    if aub:
        base = Sculpt("hood_base")
        base.add(hood.ops[0][1], k=0.0)
        rv, rf = rim_band(F, sdf_of(base), RIM_A[0], RIM_A[1], n=15)
        part("hood_rim", ("mesh", rv, rf), "chalk", "bone:head", None, 0.7)
    else:
        rim = Sculpt("hood_rim")
        # (r6, review r4: from 52 deg the thick dark roll all round the opening read as lips) the roll THINS down the
        # arch's sides: full over the brow, a slim felt edge where it meets the collar
        # (r7, verify wave-b: still "lips round an O" at x8 in game) the roll is a BROW only: full (1.6 cm) over the top
        # of the arch, thinning fast through the arch's shoulders to a flat 4.5 mm felt edge down the sides and the
        # lower corners (sunk half into the felt: it turns the edge, it never stands round the opening), so the dark
        # opening reads as an arch under a rolled brim, not a ringed O
        # The FULL outline: with the collar's front lowered, the opening's bottom corners and the sill's edge were the
        # hood low's bare cut (ragged felt / dark notches); the flat edge runs round them and along the sill, where it
        # is painted the felt's own turned edge (`_rim_serenade`), never a dark lower lip
        T_ = tomb_of(F)
        rr_at, flat_at, sink_at = rim_profile_s(T_)
        loop = opening_loop(F, n=30, lift=0.004, full=True)
        loop = [np.array((x_, y_ + sink_at(z_), z_)) for x_, y_, z_ in loop]
        for i in range(len(loop) - 1):
            a_, b_ = loop[i], loop[i + 1]
            side = np.cross(b_ - a_, (0.0, 1.0, 0.0))
            ra, rb = rr_at(a_[2]), rr_at(b_[2])
            rim.add(FlatCapsule(a_, b_, ra, ra * flat_at(a_[2]), rb, rb * flat_at(b_[2]), side=side), k=0.004)
        lo_loop = opening_loop(F, n=18, lift=0.004, full=True)[:-1]
        lo_loop = [(x_, y_ + sink_at(z_), z_) for x_, y_, z_ in lo_loop]
        tv, tf = sweep_tube(lo_loop, [rr_at(p_[2]) * 1.04 for p_ in lo_loop], 5,
                            flat=[flat_at(p_[2]) for p_ in lo_loop], closed=True)
        part("hood_rim", rim, "cloth", "bone:head", 0, 0.7, 1.4, low=lambda D, v=tv, f=tf: (v, f))
    # the hood light (brief §0.2 / §4): ONE soft core, wider than tall, floating in the head space with ink all
    # round it (FORM "hood_light"): a lamp glowing inside the hood. (A broad tilted lens that filled the opening
    # read as a lit visor; a lens or slab low on the sill read as a tongue in a mouth.)
    lc, lr, tilt = F["hood_light"]
    t = math.radians(tilt)
    # its pole axis runs front to back: the outline seen through the arch is the smooth 18-segment equator
    # (never a faceted disc), five rings deep (round from the 52 deg camera too)
    axes = np.array([(1.0, 0.0, 0.0), (0.0, math.sin(t), math.cos(t)), (0.0, -math.cos(t), math.sin(t))])
    # (fix round 4: a hard-edged core with no falloff read as a pupil in a socket) the core is the front of a
    # 16-round ellipsoid, and a HALO cap 1.6 x round it, alpha-blended, its vertex alpha falling from 0.5 over the
    # core's outline to 0 at its rim (wick_common.halo_mesh / inject_halo)
    X, Zu, Yo = axes
    v, f = wc.cap_mesh(lc, X, Yo, Zu, lr[0], lr[1], lr[2], seg=16)
    part("hood_light", ("mesh", v, f), wc.CORE_MAT, "bone:head", None, 0.5)
    # (r6, review r4: "the core reads as a flat disc with a crisp outline") the halo's alpha stations (the export writes
    # the shared profile's alpha at each vertex, linear between rings) moved into the FALL: 0.62 / 0.74 / 0.87 / 1.0
    # (alpha 0.80 / 0.45 / 0.16 / 0) instead of 0.43 / 0.62 / 0.82 / 1.0 (0.82 / 0.80 / 0.26 / 0: one steep step that
    # read as the disc's edge); the same 98 triangles, the plateau inside 0.62 stays flat either way
    # (r7, verify wave-b: "still a flat disc at 52 deg, L* 63 across then 36 within 6 px": the shared profile's plateau
    # (alpha 0.80 out to 0.62 of the halo, 1.3 x the core) composited the core into one flat lit disc, and the brow hid
    # the fall above it) the brightwick halo has its OWN profile (HALO_BW: the shared halo_alpha with its plateau ending
    # at 0.15, so it falls all the way from the centre: core + halo 1.0 / 0.78 / 0.43 / 0.26 / 0.10 / 0 at 0 / 0.30 /
    # 0.435 (the core's outline) / 0.60 / 0.78 / 1.0) and leans back HALO_TILT_BW, facing up toward the gameplay camera:
    # its lower fall comes forward under the core, where the 52 deg sight line sees it below the brow
    th_ = math.radians(HALO_TILT_BW)
    Zh, Yh = np.array((0.0, math.sin(th_), math.cos(th_))), np.array((0.0, -math.cos(th_), math.sin(th_)))
    v, f = wc.halo_mesh(lc, X, Yh, Zh, lr[0], lr[1], lr[2], seg=10, rings=HALO_RINGS_BW)
    part("hood_halo", ("mesh", v, f), HALO_BW, "bone:head", None, 0.5)
    if aub:
        crown_aubade(F, part, hood)
    else:
        crown_serenade(F, part)


RIM_A = (0.034, 0.011)      # the Aubade carved rim band: width on the cowl, height proud of it (m)
# the hood halo (r7): its own kept material + alpha profile (registered in the shared HALO_PROFILES under a brightwick
# name: the export hook writes it like every halo; the other kinds keep theirs), its ring stations (lateral radius /
# its rim: one on the core's outline, the rest down the fall) and its lean (deg, top back)
HALO_BW = "glow_halo_bw"
HALO_PLATEAU_BW = 0.15
HALO_RINGS_BW = (0.0, 0.25, 1.0 / wc.HALO_SCALE, 0.60, 0.78, 1.0)
HALO_TILT_BW = 30.0
wc.HALO_PROFILES.setdefault(HALO_BW, (lambda rho: wc.halo_alpha(rho, wc.HALO_SCALE, HALO_PLATEAU_BW), 1.0))


def rim_profile_s(T):
    """(r7) the Serenade roll along the opening: (half width(z), flatness(z), sink(z)): a round 1.6 cm roll over the
    top of the arch (its upper ~100 deg), falling through the arch's shoulders to a FLAT felt edge down the sides
    (8 mm either side of the cut, 3 mm proud: the felt's turned edge covering the hood low's cut, nothing standing
    round the opening's sides)"""
    zc = T.zc

    def brow(z):
        return float(smooth(zc + 0.020, zc + 0.075, z))

    def rr_at(z):
        return 0.008 + (0.016 - 0.008) * brow(z)

    def flat_at(z):
        return 0.38 + 0.62 * brow(z)

    def sink_at(z):
        return (1.0 - brow(z)) * 0.0048
    return rr_at, flat_at, sink_at


def rim_band(F, D, width, height, n=17, inner=0.016):
    """the Aubade CARVED RIM as a clean low lying on the cowl round the opening's arch (up the left side, over
    the arch, down the right side; the cowl's scarf is the sill): per station an inner wall going straight back
    into the hollow (it covers the hood low's lip: no crumpled polygons at the edge), a chamfer, a flat face
    `height` proud, a chamfer and a fall into the linen. Every band has its own vertices (crisp carved creases,
    never a round tube)."""
    T = tomb_of(F)
    xz = np.array(T.arch(n), dtype=np.float64)
    tg = np.gradient(xz, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True)
    n2 = np.stack([-tg[:, 1], tg[:, 0]], 1)
    cen2 = np.array((0.0, 0.5 * (T.zb + T.zc)))
    n2[((xz - cen2) * n2).sum(1) < 0] *= -1.0
    rows = [(None, None), (0.0, 0.70), (0.005, 1.0), (width - 0.006, 1.0), (width - 0.0015, 0.55), (width + 0.002, -0.25)]
    G = np.zeros((len(xz), len(rows), 3))
    e = 1e-3
    for j, (g, h) in enumerate(rows):
        gg = 0.0 if g is None else g
        q = xz + n2 * gg
        O = np.stack([q[:, 0], np.zeros(len(q)), q[:, 1]], 1)
        t = march_in(D, O, np.tile((0.0, -1.0, 0.0), (len(O), 1)), 0.6, steps=140)
        S = O + np.array((0.0, -1.0, 0.0))[None] * np.nan_to_num(t, nan=0.2)[:, None]
        if g is None:
            G[:, j] = S + np.array((0.0, inner, 0.0))[None] - np.stack([n2[:, 0], np.zeros(len(q)), n2[:, 1]], 1) * 0.002
            continue
        gr = np.stack([D.d(S + np.eye(3)[i] * e) - D.d(S - np.eye(3)[i] * e) for i in range(3)], 1)
        gr /= np.linalg.norm(gr, axis=1, keepdims=True) + 1e-12
        G[:, j] = S + gr * height * h
    V, Fc, band = [], [], []
    for r in range(len(rows) - 1):
        b0 = len(V)
        for k in range(len(xz)):
            V += [G[k, r], G[k, r + 1]]
        for k in range(len(xz) - 1):
            a, b, c, d = b0 + 2 * k, b0 + 2 * k + 1, b0 + 2 * k + 3, b0 + 2 * k + 2
            Fc += [(a, b, c), (a, c, d)]
            band += [r, r]
    V = np.array(V)
    Fc = np.array(Fc, dtype=np.int64)
    cen = V[Fc].mean(1)
    hc = np.asarray(F["hood"][0], dtype=np.float64)
    zmid = 0.5 * (T.zb + T.zt)
    out = cen - hc[None]
    inw = np.array(band) == 0
    axis_pt = np.stack([np.zeros(len(cen)), cen[:, 1], np.full(len(cen), zmid)], 1)
    out[inw] = (axis_pt - cen)[inw]
    nn = np.cross(V[Fc[:, 1]] - V[Fc[:, 0]], V[Fc[:, 2]] - V[Fc[:, 0]])
    flip = (nn * out).sum(1) < 0
    Fc[flip] = Fc[flip][:, ::-1]
    return V, Fc


def sweep_tube(pts, r, nseg=5, out=(0.0, -1.0, 0.0), flat=None, closed=False):
    """a round tube (nseg sides) swept along an open polyline, its frame from `out` (the side it faces); the
    ends are left open (they tuck into the cowl / the collar). `flat` (per station) squashes the section along
    `out`: a flat band lying on the surface (r across, r * flat proud). `closed`: the path is a loop (its last
    station joins the first: no seam)"""
    P = np.asarray(pts, float)
    T = np.gradient(P, axis=0) if not closed else 0.5 * (np.roll(P, -1, 0) - np.roll(P, 1, 0))
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    o = np.asarray(out, float)
    N = o[None] - T * (T @ o)[:, None]
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    B = np.cross(T, N)
    R = np.broadcast_to(np.asarray(r, dtype=np.float64), (len(P),))      # a radius per station (a tapered tube)
    Fl = np.broadcast_to(np.asarray(1.0 if flat is None else flat, dtype=np.float64), (len(P),))
    V = []
    for i in range(len(P)):
        for k in range(nseg):
            a = 2 * math.pi * (k + 0.5) / nseg
            V.append(P[i] + (N[i] * math.cos(a) * Fl[i] + B[i] * math.sin(a)) * R[i])
    V = np.array(V)
    F_ = grid_faces(len(P), nseg, closed=False)
    # grid_faces is column-major (i * nv + j) with i the path index and j the ring index: rings are closed, so
    # add the seam quads between ring vertex nseg-1 and 0
    extra = []
    nP = len(P)
    for i in range(nP - 1 + (1 if closed else 0)):
        i2 = (i + 1) % nP
        a, b, c, d = i * nseg + nseg - 1, i2 * nseg + nseg - 1, i2 * nseg, i * nseg
        extra += [(a, b, c), (a, c, d)]
        if closed and i == nP - 1:
            for j in range(nseg - 1):                     # the loop's closing span (last ring -> first)
                a, b, c, d = i * nseg + j, i2 * nseg + j, i2 * nseg + j + 1, i * nseg + j + 1
                extra += [(a, b, c), (a, c, d)]
    F_ = np.concatenate([F_, np.array(extra, dtype=np.int64)])
    cen = V[F_].mean(1)
    near = np.argmin(((cen[:, None, :] - P[None]) ** 2).sum(2), axis=1)
    ab = np.cross(V[F_[:, 1]] - V[F_[:, 0]], V[F_[:, 2]] - V[F_[:, 0]])
    flip = (ab * (cen - P[near])).sum(1) < 0
    F_[flip] = F_[flip][:, ::-1]
    return V, F_


FLAME = [(0.0, 0.0), (0.008, 0.021), (0.026, 0.020), (0.043, 0.0)]   # a crown lamp: a round-shouldered drop, 4.3 cm
CUP = [(-0.0045, 0.0), (0.0015, 0.023), (0.010, 0.028)]               # its slim slate bezel cup (4 mm past the drop)
SPIRE = [(0.0, 0.015), (0.034, 0.014), (0.064, 0.0)]                   # a chalk spire tower: square shaft, pyramid roof
CROWN_A = (1.584, 1.614)            # the Aubade circlet (z): just over the opening's arch, under the round cap
# (r7, verify wave-b: from the side at 52 deg the six lamps put a LEVEL PAIR (60 / 120 deg) either side of the side
# spire: two eyes over the pauldron's cup, a face) TEN smaller lamps, 36 deg apart, one over the arch (0) and one on the
# seam at the nape (180); the spires between them, so a chalk point faces each side (90 / 270). From any facing the
# near half of the ring shows 4-6 evenly spaced lamps on its arc (never an isolated pair: the inner two always have
# their neighbours at the same spacing, a string of lights round the crown, like the Serenade's ten windows)
CROWN_N = 10


def crown_aubade(F, part, hood):
    """a low CHALK circlet on the cowl (the concept) with ten little chalk SPIRE TOWERS and, between them, ten
    dawnglass LAMPS (accent drops), each seated in a thin dark slate BEZEL cup on the band (the only dark on the
    crown: the light's edge, so the ally azure stands off the chalk). Lamps sit low, the towers rise with them (a
    crown that holds its lamps, never candles on posts). One lamp sits over the arch's crown (a single light above
    the hollow, never a pair), a spire faces each side. Then the accent seam (the Aubade hood mark): a fine lit line
    over the cap from the brow, full width down the back of the cowl to the nape, a thin painted bezel either side."""
    hc, hr = F["hood"]
    z0, z1 = CROWN_A

    def rad(z):
        return hood_radius(F, z)
    band = band_mesh(hc[1], z0, z1, rad, -0.004, 0.018, 16)
    surf = band[2]
    meshes, cups, lamps = [band[:2]], [], []

    def frame_at(a, z, lean):
        base = surf(a, z, -0.006)
        out = base - np.array((0.0, hc[1], base[2]))
        out[2] = 0.0
        out /= np.linalg.norm(out)
        return base, out, sdf.frame(out * lean + np.array((0.0, 0.0, 1.0)), out)
    step = 360.0 / CROWN_N
    for i in range(CROWN_N):
        # spires between the lamps: little four-sided chalk SPIRE TOWERS (a square shaft and a short pyramid roof:
        # the Aubade spire architecture in miniature, never teeth), 4.4 cm over the band's top
        base, out, ax = frame_at(step * i + step / 2, z1 - 0.012, 0.10)
        meshes.append(lathe_mesh(base - ax[2] * 0.008, ax, SPIRE, 4, aspect=(1.0, 1.0)))
        # the lamp: a slim slate bezel cup on the band's top-outer edge and the drop in it
        base, out, ax = frame_at(step * i, z1 - 0.004, 0.22)
        c0 = base - out * 0.007                  # seated on the band's top
        cups.append(lathe_mesh(c0, ax, CUP, 6))
        lamps.append(lathe_mesh(c0 + ax[2] * 0.003, ax, FLAME, 6))
    v, f = merge_meshes(meshes)
    part("crown", ("mesh", v, f), "chalk", "bone:head", None, 0.6)
    v, f = merge_meshes(cups)
    part("crown_cups", ("mesh", v, f), "ironstone", "bone:head", None, 0.6)
    v, f = merge_meshes(lamps)
    part("crown_lamps", ("mesh", v, f), "accent", "bone:head", None, 0.5)
    # the seam: a flush inlaid strip on the meridian, brow -> over the cap -> nape, laid on the hood's real
    # surface (5 cm: a solid light, not a hairline), its slate channel painted round it (`_hood_aubade`)
    aa = np.radians(np.linspace(SEAM_A[0], SEAM_A[1], 14))
    P0 = np.stack([np.zeros_like(aa), hc[1] + hr[1] * np.sin(aa), hc[2] + hr[2] * np.cos(aa)], 1)
    N0 = np.stack([np.zeros_like(aa), np.sin(aa) / hr[1], np.cos(aa) / hr[2]], 1)
    S0, G0 = onto_surface(sdf_of(hood), P0, N0, reach=0.09)
    v, q = ribbon(S0, G0, np.interp(np.degrees(aa), [-50, -40, 50, 62, 120, 130],
                                    [0.022, SEAM_CAP, SEAM_CAP, SEAM_W, SEAM_W, 0.036]), 0.006, sink=0.010)
    part("seam", ("mesh", v, q), "accent", "bone:head", None, 0.5)


SEAM_W = 0.032              # the Aubade hood seam's width down the back of the cowl (m; r4: 3.6 -> 3.2, the 7 % accent cap)
# the seam's span (deg on the hood's meridian from the crown, - = front): from the brow over the cap and down the back
# of the cowl to the nape (the brief's hood mark); over the cap it is a fine lit seam (3 cm), never a crest stripe
SEAM_A = (-50.0, 130.0)
SEAM_CAP = 0.030            # its width over the cap (a fine lit seam, never a crest stripe)
CHANNEL = 0.045
BEZEL = 0.015               # the thin slate bezel painted round each Aubade body light (fix pass 5: the lights keep a
# dark edge for the ally azure, the chalk and the blue-grey stay chalk and blue-grey)


# (fix round 4, review r3: from the 52 deg camera the flush dark band of lit windows under a bald pale dome read as a
# helmet with a lit visor slot / a row of teeth) the lamp ring is a RAISED CIRCLET sitting HIGH ON THE CROWN: a band
# standing 1.2 cm proud of the dome's upper slope (z 1.637-1.69, where the dome turns toward the sky), so the 52 deg
# camera sees it face-on as a ring of lamps round a small felt cap, never a horizontal slit over the opening; its value
# lifted to the ironstone / felt mid (no dark slot). (Tried: a vertical ring lower on the dome read as a tin can, a
# flared coronet round the top as the mouth of a jar.)
CAP_Z = (1.640, 1.652)              # the Serenade felt dome's cap low (its own part) above CAP_Z[0]; the hood below CAP_Z[1]
CROWN_S = (1.637, 1.690)            # the Serenade crown circlet (z) on the dome's upper slope
WINDOWS = [360.0 * k / 10 for k in range(10)]       # (r4: 10 on the smaller upper ring: spaced, one over the arch)       # 12 even, spaced (the concept: round windows with iron between,
# never a string of touching beads): six across the front, one over the arch's crown


def crown_serenade(F, part):
    """a flush ironstone band on the felt dome just over the opening (the concept: z 1.57-1.65) with twelve
    ROUND lampresin windows evenly round it (accent discs that follow the band's curve): seven across the front,
    one over the arch's crown, a ring of lights from every side (an even ring never makes a lit PAIR over the
    hollow: brief §0.2)"""
    hc, hr = F["hood"]
    z0, z1 = CROWN_S

    def rad(z):
        return hood_radius(F, z)
    v, f, surf = band_mesh(hc[1], z0, z1, rad, -0.006, 0.012, 18)
    zc = 0.5 * (z0 + z1)
    part("crown", ("mesh", v, f), "ironstone", "bone:head", None, 0.7)
    # the windows follow the band's slope (dz_per_m < 1: the slanted face is ~1.4 x its height)
    discs = [disc_on(surf, a, zc, 0.0225, nseg=10, rad_fn=rad, dz_per_m=0.72, lift=0.002) for a in WINDOWS]
    v, f = merge_meshes(discs)
    part("crown_lamps", ("mesh", v, f), "accent", "bone:head", None, 0.5)


# ── cowl/collar, pauldrons, mantle, cloak, robe, tabard, legs, boots ──────────────────────────────────────
class OpenCut(sdf.Prim):
    """the cloak's front opening: |x| < half width(z) in front of y_lim, below the top (a rounded top edge)"""

    def __init__(self, wtab, ztop, y_lim=-0.05):
        self.w, self.ztop, self.y = wtab, float(ztop), float(y_lim)

    def bounds(self):
        return np.array([-0.4, -0.8, -0.1]), np.array([0.4, self.y + 0.02, self.ztop + 0.05])

    def d(self, P):
        return np.maximum(np.maximum(np.abs(P[:, 0]) - interp(self.w, P[:, 2]), P[:, 1] - self.y), P[:, 2] - self.ztop)


# (r7, verify wave-b: from 52 deg the collar's thick front roll was the lower lip of an O round the opening) the Serenade
# collar's front, round the local angle -90 deg (the frame's -Y = the wick's front): the tube's radius x (1 - k_r w),
# its height x (1 - k_z w), its centre lowered dz x rz x w; w = 1 within +-span[0] deg, 0 past +-span[1] (the sides
# and the back stay the full roll). Its front top drops 1.388 -> ~1.345, under the hood's felt sill
COLLAR_FRONT = {"k_r": 0.30, "k_z": 0.50, "dz": -0.16, "span": (24.0, 68.0)}


def collar_tube(rz):
    cf = COLLAR_FRONT

    def w_(a_rad):
        da = abs(((math.degrees(a_rad) + 90.0 + 180.0) % 360.0) - 180.0)
        return 1.0 - float(smooth(cf["span"][0], cf["span"][1], da))

    def tube(a_rad):
        w = w_(a_rad)
        return 1.0 - cf["k_r"] * w, 1.0 - cf["k_z"] * w, cf["dz"] * rz * w
    return tube


class CollarTorus(Torus):
    """a Torus whose tube varies round the ring: tube(a_rad) -> (r scale, rz scale, z offset), a = the local angle
    atan2(y, x) in the frame's XY plane (the same parametrisation as torus_mesh)"""

    def __init__(self, c, R, r, axes=None, rz=None, tube=None):
        super().__init__(c, R, r, axes=axes, rz=rz)
        self.tube = tube

    def d(self, P):
        p = self.local(P)
        a = np.arctan2(p[:, 1], p[:, 0])
        ks, kz, dz = self._tube_vec(a)
        r_ = self.r * ks
        q0 = np.hypot(p[:, 0], p[:, 1]) - self.R
        q1 = (p[:, 2] - dz) * (r_ / (self.rz * kz))
        return np.sqrt(q0 * q0 + q1 * q1) - r_

    def _tube_vec(self, a):
        # tabulated round the ring (0.25 deg), looked up per point: the scalar tube() on every voxel would be slow
        if not hasattr(self, "_tab"):
            g = np.radians(np.arange(-180.0, 180.25, 0.25))
            self._tab = (g, np.array([self.tube(float(x)) for x in g]))
        g, tab = self._tab
        return (np.interp(a, g, tab[:, 0]), np.interp(a, g, tab[:, 1]), np.interp(a, g, tab[:, 2]))


def open_hw(F, z):
    return float(interp(F["open"][0], z))


def cloak_open_wedge(F):
    return OpenCut(F["open"][0], F["open"][1])


def wall_angle(F, z, side, recess):
    """world angle (deg) of the ray from the cloak axis that meets the opening's wall at height z, just outside
    (recess 0: on the coat) or just inside (recess RECESS: on the robe floor), on side +-1"""
    tab, ytab = F["cloak_rx"], F["cloak_ry"]
    R = float(interp(tab, z)) - recess
    Ry = R * float(interp(ytab, z))
    x = open_hw(F, z) + (0.010 if recess == 0 else -0.010)
    s2 = (x * x / (Ry * Ry)) / (1.0 - x * x / (R * R) + x * x / (Ry * Ry))
    return side * math.degrees(math.asin(math.sqrt(min(max(s2, 0.0), 0.99))))


def cloak_fold_w(F, aub, P):
    """the cloak sculpt's fold displacement as a paint weight: +1 on a fold's crest (outward) .. -1 in its valley
    (the same phase and wobble as `folds` in cloak_sculpt)"""
    famp, ffreq, fwob = F["folds"]
    u = ang(P) * ffreq + fwob * NOISE(P, 3.0)
    return 2.0 * np.abs(np.sin(u)) ** (1.5 if aub else 2.0) - 1.0


def cloak_sculpt(F, aub):
    tab, ytab = F["cloak_rx"], F["cloak_ry"]
    z0, z1 = tab[0][0], tab[-1][0]
    famp, ffreq, fwob = F["folds"]
    cl = Sculpt("cloak")
    fz = [(0.0, 1.0), (0.6, 0.85), (1.05, 0.45), (1.3, 0.15)]
    cl.add(Bell(tab, ytab, z0 - 0.04, z1).displaced(folds(famp, ffreq, fwob, ztab=fz, sharp=1.5 if aub else 2.0), famp),
           k=0.0)
    hz0, hamp, hn = F["hem"]
    cl.inter(HemCut(hz0, hamp, hn, 0.8), k=0.006)
    robe = Bell(tab, ytab, 0.0, z1, inset=RECESS)          # the floor: RECESS in from the cloak
    cl.sub(sdf.Blend([("add", cloak_open_wedge(F), 0.0), ("sub", robe, 0.0)]), k=0.015)
    return cl


CLOAK_COLS = {"aubade": [0, 11, 37, 54, 72, 90, 108, 126, 144, 162, 180],
              "serenade": [0, 11, 41, 60, 80, 100, 120, 140, 160, 180]}     # the cloak low's fixed columns (deg)


def cloak_low(F, aub):
    """the cloak's game low: columns on every hem point / notch and on both sides of both opening walls (those
    follow the wall down: the opening widens toward the hem), rows top -> hem"""
    hz0, hamp, hn = F["hem"]
    ztop = F["open"][1]
    fixed = CLOAK_COLS["aubade" if aub else "serenade"]
    cols = sorted(set([-c for c in fixed if 0 < c < 180] + fixed))
    walls = []
    for side in (1.0, -1.0):
        for rec in (RECESS, 0.0):
            walls.append(lambda z, side=side, rec=rec: wall_angle(F, min(z, ztop), side, rec))
    cols = cols + walls
    top = F["cloak_rx"][-1][0] - 0.004

    def zrows(a):
        hz = float(hem_line(hz0, hamp, hn, np.array([[math.sin(a), -math.cos(a), 0.0]]))[0]) + 0.004
        # a row just over and just under the opening's top: the step into the recess stays inside 2 cm
        mids = [top - 0.07, ztop + 0.010, ztop - 0.012, 0.98, 0.78, 0.58, 0.40, 0.25] if aub else \
               [ztop + 0.006, ztop - 0.012, 1.04, 0.84, 0.62, 0.42, 0.26]
        return [top] + [z for z in mids if z > hz + 0.03] + [hz]

    nrow = len(zrows(0.0))

    def zr(a):
        z = zrows(a)
        while len(z) < nrow:                                  # keep every column the same length
            i = int(np.argmax(np.diff(-np.array(z))))
            z.insert(i + 1, 0.5 * (z[i] + z[i + 1]))
        return z[:nrow]
    return lambda D: lathe_low(D, cols, zr, rmax=0.70, bottom_cap=True, top_cap=True)


def mantle_hem(a):
    """the Serenade mantle's hem height by azimuth (a = ang(P), 0 = front): rounded lapels in front (bottoms at
    0.975, rounded corners into the notch), the hem rising over the arms, then DIPPING to a soft point at the centre
    back (the concept's draped felt capelet; fix round 3: the straight squared back hem read as a slab)"""
    nl, nh, nz = MANTLE["notch"]
    d = np.abs(np.degrees(a))
    notch = 1.0 - smooth(nl, nh, d)
    # (r6) a broad U to the centre back (0.962 -> 0.950 at the spine, the shoulders' rise kept)
    base = np.interp(d, [0, 16, 46, 70, 92, 120, 148, 166, 180], [0.985, 0.976, 0.978, 1.020, 1.070, 1.052, 1.000, 0.966, 0.950])
    # the scallops: a lobe under every drape crest (45 k deg), rounded, the cusps between narrower
    c = 0.5 + 0.5 * np.cos(np.radians(d) * 8.0)
    amp, (f0, f1) = MANTLE_LOBE
    base = base - amp * smooth(f0, f1, d) * (c ** 0.7 - 0.5)
    return base + notch * (nz - base)


def mantle_drape(P):
    """the capelet's hanging folds (the sculpt's drape and the paint's fold light share it): (valley 0..1, weight):
    sags over the arms and across the back (the fronts beside the lapels a half), deepest toward the hem; the
    valleys at 22.5 + 45 k deg, between the hem's lobes"""
    a = ang(P)
    da_ = np.degrees(np.abs(a))
    back = np.maximum(smooth(50.0, 110.0, da_), 0.5 * smooth(18.0, 34.0, da_))
    low = 1.0 - smooth(1.04, 1.28, P[:, 2])
    return np.abs(np.sin(a * 4.0 + MANTLE_WOB * NOISE(P, 2.5))) ** 1.3, back * low


def body_parts(F, aub, info, part):
    sh = F["shoulder"]
    if aub:
        # COWL: the blue scarf hood-collar: a thick drape round the neck, a V in front and a long V at the back
        cowl = Sculpt("cowl")
        # the scarf lies OVER the coat round the neck (bigger than the coat from 1.26 up, and down the V in front)
        ctab = [(1.08, 0.262), (1.18, 0.266), (1.26, 0.285), (1.32, 0.258), (1.37, 0.215), (1.41, 0.15)]

        def chem(a):
            # a deep V in front under the opening (it hides the robe's top), a shorter V at the back
            return np.interp(np.abs(np.degrees(a)), [0, 24, 60, 112, 180], [1.135, 1.170, 1.272, 1.258, 1.170])

        def roll(P):
            # the scarf's upper roll (the concept's layered cowl): a soft ridge round the neck at 1.27
            return -0.011 * np.exp(-((P[:, 2] - 1.272) / 0.022) ** 2)
        cowl.add(Bell(ctab, [(1.0, 0.92), (1.5, 0.92)], 1.06, 1.41, cy=0.01).displaced(
            lambda P: folds(0.006, 3.0, 0.6, phase=0.4)(P) + roll(P), 0.017), k=0.0)
        cowl.inter(FnCut(chem, 0.6, 1.0), k=0.012)
        cowl.sub(tomb_of(F), k=0.01)                 # nothing of the scarf inside the hood's opening
        cols = [0, 14, 28, 44, 60, 86, 112, 136, 158, 180]
        cols = sorted(set([-c for c in cols if 0 < c < 180] + cols))

        def zr(a):
            hz = float(chem(np.array([a])))
            # below the opening's sill in front, up inside the hood at the sides and the back
            top = float(np.interp(abs(math.degrees(a)), [0, 30, 50], [1.292, 1.300, 1.405]))
            mids = (1.300, 1.272, 1.245, 0.5 * (1.245 + hz) + 0.004)
            rows = [top] + [r for r in mids if hz + 0.015 < r < top - 0.010] + [hz + 0.004]
            while len(rows) < 6:                         # same row count in every column
                i = int(np.argmax(-np.diff(rows)))
                rows.insert(i + 1, 0.5 * (rows[i] + rows[i + 1]))
            return rows
        part("cowl", cowl, "cloth2", ("zblend", "chest", "neck", 1.24, 1.34), 0, 1.0, 1.1,
             low=lambda D: lathe_low(D, cols, zr, cy=0.01, rmax=0.45, lip=[(0.028, 0.012)]))
    else:
        # the thick ROLLED COLLAR (dark felt) the felt dome sits in (the concept): all round the hood's base, high
        # at the back (1.42), its front roll the short arch's dark sill (1.32 +- 0.06), standing out 7 cm past the
        # dome at the sides; then the iron GORGET across the chest under it and the sand MANTLE
        cax = sdf.frame((0, -0.22, 0.976))
        cc, cR, cr, crz = (0, 0.030, 1.372), 0.222, 0.074, 0.066
        # (r7) its FRONT under the opening flattened (COLLAR_FRONT): a lower, slimmer roll there, the felt sill above it
        ctube = collar_tube(crz)
        v, f = torus_mesh(cc, cax, cR, cr, nu=18, nv=5, rz=crz, ry_scale=1.04, tube=ctube)
        col = Sculpt("collar")
        cax_ = np.asarray(cax, dtype=np.float64)

        def twist(P):
            # a ROLLED felt collar (fix round 3: "a plain smooth torus"): the felt wound round the roll in a slow
            # spiral, soft grooves between the turns (the normal map and the fold paint carry them)
            q = (P - np.asarray(cc)[None]) @ cax_.T
            u_ = np.arctan2(q[:, 1], q[:, 0])
            rho = np.hypot(q[:, 0], q[:, 1])
            v_ = np.arctan2(q[:, 2] / crz, rho - cR)
            return -0.0065 * smooth(0.35, 0.95, np.cos(u_ * 13.0 + v_)) + 0.0015 * NOISE(P, 9.0)
        col.add(CollarTorus(cc, cR, cr, axes=cax, rz=crz, tube=ctube).displaced(twist, 0.008), k=0.0)
        part("collar", col, "cloth", ("zblend", "chest", "neck", 1.30, 1.44), 0, 1.0, 1.1,
             low=lambda D, v=v, f=f: (v, f))

        # (fix pass 5: the iron gorget band under the mantle is gone: the mantle and the bib cover it everywhere,
        # and its top edge poked through the mantle under the collar as dark dashes)
        mantle = Sculpt("mantle")
        nl, nh, nz = MANTLE["notch"]

        mhem = mantle_hem

        def drape(P):
            # the felt capelet HANGS (fix round 3: "a flat slab from the back"): deep soft sags over the arms and
            # across the back, gathering toward the dip at the spine, none on the lapels (`mantle_drape`)
            v, w = mantle_drape(P)
            return 0.019 * w * v          # + = inward: the valleys between the hem's lobes
        mantle.add(Bell(MANTLE["rx"], MANTLE["ry"], 0.90, 1.335).displaced(
            lambda P: folds(0.006, 3.0, 0.7, phase=1.1, sharp=2.0)(P) + drape(P), 0.016), k=0.0)
        mantle.inter(FnCut(mhem, 0.7, 0.86), k=0.012)
        # (r6) columns on every lobe centre, every cusp and half way between (the scalloped hem and the drape's
        # crests / valleys land on vertices: the silhouette shows the folds), 4 rows + the turned felt edge
        cols = [0, 4, nl, nh, 16] + list(np.arange(22.5, 180.01, 11.25))
        cols = sorted(set([-c for c in cols if 0 < c < 180] + cols))

        def zr(a):
            hz = float(mhem(np.array([a])))
            return list(np.linspace(1.330, hz + 0.004, 4))
        part("mantle", mantle, "cloth2", ("zblend", "spine", "chest", 0.98, 1.12), 0, 1.0, 1.1,
             low=lambda D: lathe_low(D, cols, zr, rmax=0.62, lip=[(0.026, 0.008), (0.052, 0.044)]))
        # the sand robe between the lapels, just behind them (the concept): the notch showed a deep dark cavity
        zz = np.linspace(0.982, 1.235, 4)
        xs = np.array((-0.088, 0.0, 0.088))
        V = np.array([(x, -float(interp(MANTLE["rx"], z)) * float(interp(MANTLE["ry"], z)) * math.cos(x * 2.0) + 0.016, z)
                      for z in zz for x in xs])
        Fb = grid_faces(len(zz), len(xs), closed=False)
        Fb = wind_like(V, Fb, 0, np.array((0.0, -1.0, 0.0)))
        part("bib", ("mesh", V, Fb), "cloth2", ("zblend", "spine", "chest", 0.98, 1.12), None, 0.5)
    # PAULDRONS
    for s, sx in (("R", -1.0), ("L", 1.0)):
        px = F["pauldron_x"] * sx
        # RIGID on the shoulder bone: blended into the upper arm, the plates crumpled into shards whenever the arms
        # came forward to hold the staff (the guard pose every clip starts from)
        bind = f"bone:shoulder.{s}"
        if aub:
            aubade_pauldron(part, s, sx, px, bind)
        else:
            serenade_pauldron(part, s, sx, px, bind)
    # CLOAK: a SOLID bell, open in front over the tabard (the opening a recess down to the robe floor)
    tab, ytab = F["cloak_rx"], F["cloak_ry"]
    cl_sc = cloak_sculpt(F, aub)
    part("cloak", cl_sc, "cloth", ("bw_cloak",), 0, 1.0, 1.0, low=cloak_low(F, aub))
    cl_d = sdf_of(cl_sc)
    if aub:
        # the back stripe (accent) down the cloak's spine, below the cowl's V: one SOLID 5.6 cm light with a thin
        # painted slate bezel (`_cloak_aubade`), laid ON the folded coat (it floated off the profile on the smooth bell)
        zz = np.linspace(0.36, 1.12, 10)        # (fix round 3: starts at 0.36, not 0.15: no light at the feet)
        P0 = np.stack([np.zeros_like(zz), interp(tab, zz) * interp(ytab, zz), zz], 1)
        S0, G0 = onto_surface(cl_d, P0, np.tile((0.0, 1.0, 0.0), (len(zz), 1)), reach=0.07, lift=0.0015)
        v, q = ribbon(S0, G0, BACK_W, 0.004, sink=0.008)
        part("back_stripe", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.6)
        # (fix round 3: the lit HEM PIPING is gone: a light at the feet broke the light-top / dark-feet read and
        # pushed the accent over the brief's 5-7 %; the side facings keep the pauldron inlays and the back stripe)
        # the chalk bandage belt across the robe floor between the cloak's front edges
        oa = abs(wall_angle(F, 0.965, 1.0, RECESS)) + 2.5
        aa = np.radians(np.linspace(-oa, oa, 9))
        zb_ = 0.965
        Rb = float(interp(tab, zb_)) - RECESS + 0.004
        ry_ = float(interp(ytab, zb_))
        P0 = np.stack([np.sin(aa) * Rb, -np.cos(aa) * Rb * ry_, np.full(len(aa), zb_)], 1)
        N0 = np.stack([np.sin(aa) * ry_, -np.cos(aa), np.zeros(len(aa))], 1)
        N0 /= np.linalg.norm(N0, axis=1, keepdims=True)
        v, q = ribbon(P0, N0, 0.060, 0.022, sink=0.004)
        part("belt", ("mesh", v, q), "cloth2", ("bw_transfer", "cloak"), None, 0.8)      # chalk-linen wraps (the concept)
    else:
        # the SASH (accent) round the waist below the mantle (sides and back: the team read from behind), laid on
        # the felt; in front the tabard's own bands carry it across the opening
        zs_ = SASH_Z
        a_w = abs(wall_angle(F, zs_, 1.0, 0.0)) + 1.0
        # (r6, review r4: "a torn notch at the back seam") the ribbon's stations ARE the cloak low's columns: its
        # chords run parallel to the coat's, so no coat vertex pokes through between two stations
        ccols = sorted({c % 360.0 for c in CLOAK_COLS["serenade"] + [-c for c in CLOAK_COLS["serenade"]]})
        aa = np.radians([a_w] + [c for c in ccols if a_w + 4.0 < c < 360.0 - a_w - 4.0] + [360.0 - a_w])
        # each station is found exactly as the cloak low finds its vertices (the outermost surface on the horizontal
        # ray from the axis at that world angle), then lifted along the surface normal
        dirs = np.stack([np.sin(aa), -np.cos(aa), np.zeros(len(aa))], 1)
        O_ = np.tile((0.0, 0.0, zs_), (len(aa), 1))
        t_ = march_in(cl_d, O_, dirs, 0.70)
        S0 = O_ + dirs * np.nan_to_num(t_, nan=float(interp(tab, zs_)))[:, None]
        e_ = 1e-3
        G0 = np.stack([cl_d.d(S0 + np.eye(3)[i] * e_) - cl_d.d(S0 - np.eye(3)[i] * e_) for i in range(3)], 1)
        G0[:, 2] = 0.0
        G0 /= np.linalg.norm(G0, axis=1, keepdims=True) + 1e-12
        v, q = ribbon(S0 + G0 * 0.0025, G0, SASH_W, 0.005, sink=0.008)
        part("sash", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.6)
    tabard_parts(F, aub, part)
    # LEGS (dark trousers, slim: they live under the bell) and BOOTS
    legs = Sculpt("legs")
    for s in ("L", "R"):
        hp, kn, an = info.side("hip", s), info.side("knee", s), info.side("ankle", s)
        legs.add(RoundCone(tuple(hp), tuple(kn), 0.062, 0.052), k=0.0)
        legs.add(RoundCone(tuple(kn), (an.x, an.y, an.z + 0.03), 0.052, 0.046), k=0.03)
    part("legs", legs, "under", ("bw_auto", ("root", "spine", "chest", "neck", "head", "x_hem_1") + ARM_BONES), 220, 1.0,
         0.5)
    bw, bl, bh = F["boot"]
    for s in ("L", "R"):
        an = info.side("ankle", s)
        b = Sculpt(f"boot_{s}")
        b.add(RoundBox((an.x, an.y - 0.035, bh * 0.75), (bw, bl, bh * 0.75), 0.045), k=0.0)
        b.add(RoundCone((an.x, an.y + 0.005, 0.07), (an.x, an.y + 0.01, 0.145), bw * 0.95, bw * 0.9), k=0.03)
        if aub:
            b.add(RoundCone((an.x, an.y - 0.10, 0.045), (an.x, an.y - 0.150, 0.058), 0.042, 0.024), k=0.03)
        else:
            b.add(Torus((an.x, an.y + 0.005, 0.135), bw * 0.92, 0.016), k=0.01)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
        part(f"boot_{s}", b, "leather", ("zblend", f"foot.{s}", f"shin.{s}", 0.08, 0.14), 150, 1.0, 0.7)


PAULDRON_A = {"O": (0.282, 0.0, 1.268), "tilt": 22.0, "cap": (0.150, 0.156, 0.124)}
CAP_DARK = 0.44             # (r7) the Aubade pauldron's cap plate: linear x (1 - CAP_DARK), about -12 L*
PLATES: dict = {}           # side -> (centre, frame, plates): the paint's carved edges on the Aubade pauldrons


def aubade_frame(sx):
    """the Aubade pauldron's frame: +Z tilted out over the shoulder, +X outward-down, phi -90*sx = the front"""
    t = math.radians(PAULDRON_A["tilt"])
    az = np.array((sx * math.sin(t), 0.0, math.cos(t)))
    return sdf.frame(az, (sx * math.cos(t), 0.0, -math.sin(t)))


def aubade_pauldron(part, s, sx, px, bind):
    """the concept's layered chalk shoulder: a curved CAP over the shoulder and two curved LAMES stepping down
    the arm (each a clean shell plate that sweeps over the shoulder, the lames with a shallow point at the front
    of their lower edge), and two short swept-up BLUNT points on the cap (<= 9 cm): carved chalk"""
    O = np.array(PAULDRON_A["O"]) * np.array((sx, 1.0, 1.0))
    ax = aubade_frame(sx)
    rc = np.array(PAULDRON_A["cap"])
    fr = -90.0 * sx                                            # the front, in phi

    # three crisp STEPPED plates (a cap and two lames, each a clean shell with a straight lower edge: the
    # notched V edges read as a cog from the side)
    plates = [  # (radii, theta, phi, thick, n_th, n_ph, edge)
        (rc, (0.0, 62.0), (-124.0, 124.0), 0.032, 3, 8, None),
        (rc * 1.085, (54.0, 79.0), (-118.0, 118.0), 0.028, 2, 7, None),
        (rc * 1.170, (71.0, 96.0), (-110.0, 110.0), 0.026, 2, 7, None),
    ]
    meshes = []
    for i, (rr, th, ph, tk, nt, npp, ef) in enumerate(plates):
        meshes.append(shell_mesh(O, ax, rr, th, ph, tk, nt, npp, edge_fn=ef))
    # the two points (the concept's chalk horns): broad flat BLADES swept up from the cap (outer-front and
    # inner-back), four-sided and blunt-tipped, <= 10 cm
    for th_, ph_, h in ((42.0, -0.38 * 90.0 * sx, 0.094), (30.0, 1.25 * 90.0 * sx, 0.100)):
        t_, p_ = math.radians(th_), math.radians(ph_)
        base = (O + ax[0] * rc[0] * math.cos(p_) * math.sin(t_) + ax[1] * rc[1] * math.sin(p_) * math.sin(t_)
                + ax[2] * rc[2] * math.cos(t_)) - ax[2] * 0.014
        d = np.array((sx * 0.20, 0.14, 1.0))
        d /= np.linalg.norm(d)
        fr_h = sdf.frame(d, (1.0, 0.0, 0.0))                 # broad seen from the front (the concept)
        meshes.append(lathe_mesh(base - d * 0.012, fr_h, [(0.0, 0.036), (0.45 * h, 0.025), (0.85 * h, 0.008),
                                                           (h, 0.0)], 4, aspect=(1.0, 0.42)))
    v, f = merge_meshes(meshes)
    PLATES[s] = (O, ax, plates)
    part(f"pauldron_{s}", ("mesh", v, f), "chalk", bind, None, 1.2)
    # a DAWNGLASS INLAY (accent) along the middle lame, front -> over the outside -> back: the team read from the
    # side (the pauldrons are the widest point, and the side facings carried the least accent), a lamp line
    # in the chalk, never a gem; its thin slate bezel is painted (`_pauldron_aubade`)
    r1 = rc * 1.085
    phs = np.radians(np.linspace(-INLAY_PH, INLAY_PH, INLAY_N))
    th = math.radians(INLAY_TH)
    pts = np.array([O + ax[0] * r1[0] * math.cos(p_) * math.sin(th) + ax[1] * r1[1] * math.sin(p_) * math.sin(th)
                    + ax[2] * r1[2] * math.cos(th) for p_ in phs])
    nrm = ((pts - O) @ ax.T / (r1 * r1)[None]) @ ax
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    v, f = ribbon(pts + nrm * 0.001, nrm, INLAY_W, 0.003, sink=0.005)
    part(f"pauldron_light_{s}", ("mesh", v, f), "accent", bind, None, 0.4)


# (r7, verify wave-b: from the side at 52 deg the inlay ran front -> outside -> back, 220 deg: a CLOSED U round the pale
# stepped cap, an open mouth with teeth under the crown's lamps) a SHORT ARC on the plate's outer edge only (+-40 deg
# round the outermost point), the cap inside it darker (`_pauldron_aubade`)
INLAY_TH, INLAY_PH, INLAY_W, INLAY_N = 63.0, 40.0, 0.026, 5     # the pauldron inlay: theta on the lame, phi half span, width, stations


PAULDRON_S_Z = 1.226


def serenade_pauldron(part, s, sx, px, bind):
    """a big rounded ironstone dome (the widest point of the figure), a heavy lip at its lower edge, and a round
    sandstone boss at its front with a lampresin lens (accent)"""
    ax = sdf.rot_y(sx * 26)                      # rows = local axes: the dome leans out over the arm
    c = np.array((px, 0.0, PAULDRON_S_Z))        # on the shoulder line, under the arch's sill (never ear-muffs)
    rad = (0.182, 0.208, 0.144)                  # (fix pass 5: bigger: the concept's massive iron domes)
    up = ax[2]
    dome = Sculpt(f"pauldron_{s}")
    dome.add(Ellipsoid(c, rad, axes=ax), k=0.0)
    dome.inter(HalfSpace(c - up * 0.064, -up, 2.0), k=0.015)
    dome.add(Torus(tuple(c - up * 0.056), 0.163, 0.019, axes=ax, rz=0.017), k=0.012)
    D = sdf_of(dome)
    low = central_low(D, c - up * 0.02, ax, 12, [0, 24, 46, 66, 82, 96, 112, 180], rmax=0.32)
    # the boss: a sandstone ring with a lens, at the dome's front-inner shoulder (reads from the front and side)
    bn = V3((-sx * 0.40, -0.74, 0.54))          # the front-inner shoulder, toward the collar (the concept)
    bn /= np.linalg.norm(bn)
    Sb, Gb = onto_surface(D, (c + bn * 0.13)[None], bn[None], reach=0.10)
    bc, bn2 = Sb[0], Gb[0]
    BOSS[("serenade", s)] = (bc, bn2)
    # a FLAT round boss (a low convex disc: the concept's carved sandstone face in an iron rim; the old recessed
    # centre read as a cup / pipe mouth)
    ring = lathe_mesh(bc - bn2 * 0.004, sdf.frame(bn2), [(0.0, 0.066), (0.014, 0.065), (0.021, 0.058),
                                                          (0.025, 0.040), (0.027, 0.0)], 8)
    dome.add(Torus(tuple(bc + bn2 * 0.006), 0.055, 0.012, axes=sdf.frame(bn2)), k=0.006)
    v, f = merge_meshes([low, ring])
    # the boss is the concept's carved SANDSTONE disc in an iron ring (painted; not a light: lit discs on the
    # shoulders read as a face's ears / cheeks from the game camera)
    part(f"pauldron_{s}", dome, "ironstone", bind, 0, 0.7, 1.2, low=lambda D_, v=v, f=f: (v, f))
    # a LAMPRESIN STRIP (accent) set in the iron along the dome's flank, from the back over the outside to the
    # front (stopping short of the boss): the team read from the side (the domes own the side view), a band of
    # light in the banded Serenade manner, never a disc (no ear / cheek lights); iron all round it
    o_l = ax @ np.array((sx, 0.0, 0.0))
    o_l = np.array((o_l[0], o_l[1], 0.0)) / np.hypot(o_l[0], o_l[1])
    f_l = ax @ np.array((0.0, -1.0, 0.0))
    f_l = np.array((f_l[0], f_l[1], 0.0))
    f_l = f_l - o_l * (f_l @ o_l)
    f_l /= np.linalg.norm(f_l)
    r_ = np.asarray(rad)
    th = math.radians(STRIP_S[0])
    P0, N0 = [], []
    for ph in np.radians(np.linspace(STRIP_S[1], STRIP_S[2], 9)):
        dl = (o_l * math.cos(ph) + f_l * math.sin(ph)) * math.sin(th) + np.array((0.0, 0.0, math.cos(th)))
        q = dl * r_
        P0.append(c + q @ ax)
        N0.append((q / (r_ * r_)) @ ax)
    S0, G0 = onto_surface(D, np.array(P0), np.array(N0), reach=0.05)
    sv, sf = ribbon(S0 + G0 * 0.001, G0, STRIP_S[3], 0.003, sink=0.006)
    STRIPS[s] = (S0, STRIP_S[3])
    part(f"pauldron_light_{s}", ("mesh", sv, sf), "accent", bind, None, 0.4)


STRIP_S = (52.0, -100.0, 78.0, 0.026)      # the Serenade dome strip: theta from the dome's top, phi back -> front, width
STRIPS: dict = {}                          # side -> (strip points, width): its iron bezel is painted


BACK_W = 0.042              # the Aubade back stripe's width (m)
TAB_W = 0.038               # the Aubade stole's centre light (m); it ends square at TAB_END, above the stole's V
TAB_END = 0.355             # (a pointed end over the dark belt read as a sword: blade, crossguard, pommel)
SASH_Z, SASH_W = 0.912, 0.070   # the Serenade sash: height, width (m); ironstone borders painted round it
TAB_BANDS = (0.912, 1.004)      # the Serenade tabard's two glowing bands (the lower one continues the sash)
TAB_TOP = 1.115             # its top: just under the cowl's V (its light never runs under the blue-grey scarf)
CHANNEL_HEX = "#171A1E"     # the painted slate channel round every Aubade body light (L* 9): the lights sit in
# dark slate settings, so the ally azure stands off the pale chalk / blue-grey wool (Lab dE >= 35 at the 52 deg
# camera; on bare blue-grey cloth the azure melted into it: dE 19-21)


def tabard_parts(F, aub, part):
    """the TABARD on the robe floor (chalk stole, Aubade / sand felt, Serenade), pointed at the hem: an explicit
    panel (clean edges, a crisp V) + its accent inlays as ribbons on its face"""
    tab, ytab = F["cloak_rx"], F["cloak_ry"]
    hw, ztop, ztip, zv = F["tabard"]
    th = 0.014

    zo = F["open"][1]

    def floor_y(x, z):
        # on the robe floor inside the opening, up onto the coat above the opening's top (the cowl covers it)
        R = float(interp(tab, z)) - RECESS * (1.0 - float(smooth(zo - 0.03, zo + 0.025, z)))
        return -math.sqrt(max(R * R - x * x, 1e-6)) * float(interp(ytab, z)) - 0.008

    zs = list(np.linspace(ztop, zv, 6)) + list(np.linspace(zv, ztip, 4))[1:]
    rows = []
    for z in zs:
        w = hw if z >= zv else hw * (z - ztip) / (zv - ztip)
        xs = [-w, 0.0, w] if w > 1e-4 else [0.0] * 3
        rows.append([(x, floor_y(x, z) - th, z) for x in xs] + [(x, floor_y(x, z), z) for x in (xs[2], xs[0])])
    V = np.array([p for r in rows for p in r])
    m = 5
    Fc = []
    for j in range(len(rows) - 1):
        for i in range(m):
            i2 = (i + 1) % m
            a, b, c, d = j * m + i, j * m + i2, (j + 1) * m + i2, (j + 1) * m + i
            Fc += [(a, b, c), (a, c, d)]
    Fc += [(0, 1, 2), (0, 2, 3), (0, 3, 4)]                # the top edge cap
    Fc = np.array(Fc, dtype=np.int64)
    cen = V[Fc].mean(1)
    zc = cen[:, 2]
    ref = np.stack([np.zeros_like(zc), np.array([floor_y(0.0, z) - th * 0.5 for z in zc]), zc], 1)
    a_, b_, c_ = V[Fc[:, 0]], V[Fc[:, 1]], V[Fc[:, 2]]
    nn = np.cross(b_ - a_, c_ - a_)
    o = cen - ref
    o[:, 0] *= 0.3
    flip = (nn * o).sum(1) < 0
    Fc[flip] = Fc[flip][:, ::-1]
    # drop the degenerate tip triangles
    area = np.linalg.norm(np.cross(V[Fc[:, 1]] - V[Fc[:, 0]], V[Fc[:, 2]] - V[Fc[:, 0]]), axis=1)
    Fc = Fc[area > 1e-9]
    part("tabard", ("mesh", V, Fc), "cloth2" if not aub else "chalk", ("bw_transfer", "cloak"), None, 1.3)

    def front(x, z):
        return np.array((x, floor_y(x, z) - th, z))
    nrm = (0.0, -1.0, 0.0)
    meshes = []
    if aub:
        # ONE solid light down the chalk stole's centre (the brief's accent vertical stripe), ending square above
        # the stole's V; a thin slate bezel is painted round it (`_tabard_aubade`), the stole stays chalk-white
        zz = list(np.linspace(TAB_TOP, TAB_END, 8))
        pts = [front(0.0, z) for z in zz]
        meshes.append(ribbon(pts, np.tile(nrm, (len(pts), 1)), TAB_W, 0.004, sink=0.004))
    else:
        for zc_ in TAB_BANDS:
            pts = [front(x, zc_) + np.array((0, -0.002, 0)) for x in np.linspace(-hw - 0.012, hw + 0.012, 4)]
            meshes.append(ribbon(pts, np.tile(nrm, (len(pts), 1)), 0.060, 0.006, sink=0.006))
        pts = [front(-hw + 0.016, zv + 0.026), front(0.0, ztip + 0.034), front(hw - 0.016, zv + 0.026)]
        pts = [pts[0], 0.5 * (pts[0] + pts[1]), pts[1], 0.5 * (pts[1] + pts[2]), pts[2]]
        meshes.append(ribbon(pts, np.tile(nrm, (len(pts), 1)), 0.050, 0.006, sink=0.004))
    v, q = merge_meshes(meshes)
    part("tabard_light", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.5)


# ── arms: sleeves, wraps/cuffs, mitts ────────────────────────────────────────────────────────────────
def hand_frame(info, s):
    w = np.array(info.side("wrist", s))
    a = np.array(info.joints[f"forearm_dir.{s}"])
    fwd = np.array((0.0, -1.0, 0.0))
    wv = fwd - a * fwd.dot(a)
    wv /= np.linalg.norm(wv)
    t = np.cross(a, wv)
    return w, a, wv, t


# (r6, review r4: "the Aubade forearm wraps and mitts are crumpled and faceted": decimated SDF blobs) the wraps are
# a BANDAGE SPIRAL: a clean helical ribbon round each forearm, every turn's elbow-side edge proud over the turn
# before it (a shingled spiral, the concept's wound linen / leather), on a slim core tube that fills the ends; the
# high (the bake source) carries the same spiral step. (start along elbow -> wrist, turns, step height m)
WRAP = {"aubade": (0.15, 3.5, 0.0055), "serenade": (0.42, 2.5, 0.0050)}
WRAP_SEG = 6                # ribbon stations per turn
WRAP_OVER = 0.075           # each turn overlaps the next by this share of the pitch, either side


def wrap_frame(el, w):
    ax = (w - el) / np.linalg.norm(w - el)
    fr = sdf.frame(ax)
    return ax, fr[0], fr[1]


def wrap_step(a0, ax, e1, e2, pitch, step):
    """the spiral's displacement (sdf convention: - = outward): proud at each turn's elbow-side edge, falling
    toward the wrist-side edge that the next turn covers"""
    def fn(P):
        q = P - a0[None]
        t = q @ ax
        th = np.arctan2(q @ e2, q @ e1)
        u = t / pitch - th / (2 * math.pi)
        f = u - np.floor(u)
        return -step * (1.0 - f) ** 1.3 + 0.0012 * NOISE(P, 9.0)
    return fn


def wrap_mesh(a0, ax, e1, e2, L, r0, r1, turns, step):
    """the clean low of one forearm's wraps: the helical ribbon (2 triangles a station) + the core tube"""
    pitch = L / turns
    n = int(round(turns * WRAP_SEG)) + 1

    def rad(t):
        return r0 + (r1 - r0) * np.clip(t / L, 0.0, 1.0)
    V, F_ = [], []
    for i in range(n):
        th = 2 * math.pi * i / WRAP_SEG
        tc = pitch * (th / (2 * math.pi) + 0.5)
        d = e1 * math.cos(th) + e2 * math.sin(th)
        te = min(max(tc - (0.5 + WRAP_OVER) * pitch, 0.0), L)
        tw = min(max(tc + (0.5 + WRAP_OVER) * pitch, 0.0), L)
        V.append(a0 + ax * te + d * (rad(te) + step))            # the proud elbow-side edge
        V.append(a0 + ax * tw + d * (rad(tw) + 0.0006))          # the tucked wrist-side edge
    for i in range(n - 1):
        a, b, c, d_ = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        F_ += [(a, b, c), (a, c, d_)]
    o = len(V)
    for k in range(6):                                             # the core tube (fills the spiral's ends)
        th = 2 * math.pi * (k + 0.5) / 6
        d = e1 * math.cos(th) + e2 * math.sin(th)
        V.append(a0 + d * (rad(0.0) - 0.002))
        V.append(a0 + ax * L + d * (rad(L) - 0.002))
    for k in range(6):
        k2 = (k + 1) % 6
        a, b, c, d_ = o + 2 * k, o + 2 * k2, o + 2 * k2 + 1, o + 2 * k + 1
        F_ += [(a, b, c), (a, c, d_)]
    V = np.array(V)
    F_ = np.array(F_, dtype=np.int64)
    # wind outward: away from the arm's axis
    cen = V[F_].mean(1)
    tt = (cen - a0[None]) @ ax
    core = a0[None] + tt[:, None] * ax[None]
    nn = np.cross(V[F_[:, 1]] - V[F_[:, 0]], V[F_[:, 2]] - V[F_[:, 0]])
    flip = (nn * (cen - core)).sum(1) < 0
    F_[flip] = F_[flip][:, ::-1]
    return V, F_


def arm_parts(F, aub, info, part):
    sl, wr, cf = Sculpt("sleeves"), Sculpt("forearms"), Sculpt("cuffs")
    w0, turns, step = WRAP["aubade" if aub else "serenade"]
    wraps_low = []
    for s in ("L", "R"):
        sh, el, w = (np.array(info.side(n, s)) for n in ("shoulder", "elbow", "wrist"))
        if aub:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.075, 0.088), k=0.0)          # bell sleeve flaring at the elbow
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.25), 0.088, 0.078), k=0.02)
            r0, r1 = 0.066, 0.060
        else:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.088, 0.100), k=0.0)          # puffy felt sleeve
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.35), 0.100, 0.082), k=0.03)
            cf.add(Torus(tuple(el + (w - el) * 0.36), 0.074, 0.022, axes=sdf.frame(w - el)), k=0.0)   # ironstone cuff
            r0, r1 = 0.066, 0.061
        a0 = el + (w - el) * w0
        L = float(np.linalg.norm(w - a0))
        ax, e1, e2 = wrap_frame(el, w)
        wr.add(RoundCone(tuple(a0), tuple(w), r0, r1).displaced(wrap_step(a0, ax, e1, e2, L / turns, step), step + 0.0012),
               k=0.0)
        wraps_low.append(wrap_mesh(a0, ax, e1, e2, L, r0, r1, turns, step))
    part("sleeves", sl, "cloth", ("bw_auto", SLEEVE_EXCLUDE), 360, 1.0, 1.0)
    wv_, wf_ = merge_meshes(wraps_low)
    part("forearms", wr, "cloth2" if aub else "leather", ("bw_auto", SLEEVE_EXCLUDE), 0, 0.8, 1.0,
         low=lambda D, v=wv_, f=wf_: (v, f))
    if not aub:
        part("cuffs", cf, "ironstone", ("bw_auto", SLEEVE_EXCLUDE), 120, 0.8, 0.8)
    for s in ("L", "R"):
        w, a, wv, t = hand_frame(info, s)
        m = Sculpt(f"mitt_{s}")
        c = w + a * 0.06
        big = 1.0 if aub else 1.08
        ax3 = np.stack([t, wv, a])
        box = RoundBox(tuple(c), (0.052 * big, 0.058 * big, 0.058 * big), 0.042 * big, axes=ax3)
        m.add(box, k=0.0)
        # the THUMB: its own lobe over the staff on the front of the fist (brief §1: a separate lobe), a crease
        # where it meets the mitten (a small blend), its own clean ellipsoid low
        th = c - wv * 0.045 * big + a * -0.01 + t * 0.03 * (1 if s == "L" else -1)
        m.add(Ellipsoid(tuple(th), (0.026, 0.03, 0.022), axes=ax3), k=0.004)
        # (r6) a clean low: the mitten a rounded box projected onto its own SDF (48 tris), the thumb 24
        bv, bf = box_low(box, n=2)
        tv, tf = ellipsoid_mesh(th, (0.026, 0.03, 0.022), nu=6, nv=3, axes=ax3)
        mv, mf = merge_meshes([(bv, bf), (tv, tf)])
        part(f"mitt_{s}", m, "leather", f"bone:hand.{s}", 0, 0.8, 1.0, low=lambda D, v=mv, f=mf: (v, f))


# ── staff + lantern on prop.R ───────────────────────────────────────────────────────────────────────
def staff_frame(info):
    """Rest frame of the held staff: P = the right palm (prop.R head), u = prop.R +Y (forward = toward the
    lantern), v/w = the cross axes (world X, Z)."""
    P = np.array(info.armature.data.bones["prop.R"].head_local)
    u = np.array((0.0, -1.0, 0.0))
    return {"P": P, "u": u, "v": np.array((1.0, 0.0, 0.0)), "w": np.array((0.0, 0.0, 1.0))}


def prop_rotation(info, pose) -> np.ndarray:
    """3x3 rotation that carries prop.R's rest frame to its frame in `pose` (armature space)"""
    skel = anim.Skeleton(info.armature)
    M = skel.fk(anim.resolve(skel, pose))
    return np.array(M["prop.R"].to_3x3()) @ np.array(skel.rest["prop.R"].to_3x3()).T


def staff_up_rest(spec, info) -> np.ndarray:
    """The rest-frame direction (perpendicular to the staff) that points UP while the wick holds the staff in
    the paint pose: the Aubade staff head bends that way so its lantern stands upright on the diagonal."""
    R = prop_rotation(info, paint_pose(spec))
    d = R @ np.array((0.0, -1.0, 0.0))
    up = np.array((0.0, 0.0, 1.0)) - d * d[2]
    n = R.T @ (up / np.linalg.norm(up))
    n[1] = 0.0
    return n / np.linalg.norm(n)


def rodrigues(k, a):
    k = k / np.linalg.norm(k)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


STAFF_P: dict = {}          # faction -> the right palm's rest position (the staff frame's origin: the paint's grain)
STAFF_HEAD: dict = {}       # faction -> the lantern socket's rest position (the staff's dark binding is painted below it)
BEND_S, BEND_DEG = 0.80, 14.0       # Aubade: the staff head bends up 14 deg above the left fist (the lantern
# leans out along the diagonal a little: from behind it never stands as an upright pale column over the hood)
LANTERN_A = {"len": 0.188, "r": (0.050, 0.079)}     # (fix round 3: a little smaller, the accent to 5-7 %) the Aubade lantern's glass: length, foot / eave radius (m)


def ring_mesh(c, axes, r_in, r_out, hw, nu):
    """a flat band ring (rectangular section: r_in..r_out radially, +-hw along the axis) round axes[2]"""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    sec = [(r_in, -hw), (r_out, -hw), (r_out, hw), (r_in, hw)]
    V = []
    for i in range(nu):
        a = 2 * math.pi * (i + 0.5) / nu
        for r, h in sec:
            V.append(c + (ax[0] * math.cos(a) + ax[1] * math.sin(a)) * r + ax[2] * h)
    V = np.array(V)
    F = []
    for i in range(nu):
        i2 = (i + 1) % nu
        for k in range(4):
            k2 = (k + 1) % 4
            a_, b_, c_, d_ = i * 4 + k, i2 * 4 + k, i2 * 4 + k2, i * 4 + k2
            F += [(a_, b_, c_), (a_, c_, d_)]
    F = np.array(F, dtype=np.int64)
    cen = V[F].mean(1)
    loc = (cen - c) @ ax.T
    aa = np.arctan2(loc[:, 1], loc[:, 0])
    rm = 0.5 * (r_in + r_out)
    core = c[None] + (ax[0][None] * np.cos(aa)[:, None] + ax[1][None] * np.sin(aa)[:, None]) * rm
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    flip = (nn * (cen - core)).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


def staff_parts(spec, F, aub, info, part):
    st = staff_frame(info)
    P, u, v, w = st["P"], st["u"], st["v"], st["w"]
    STAFF_P[spec.faction] = np.array(P)

    def at(s, dv=0.0, dw=0.0):
        return tuple(P + u * s + v * dv + w * dw)
    r = F["staff_r"]
    shaft = Sculpt("staff")
    if aub:
        up = staff_up_rest(spec, info)
        # the head frame: bent toward `up` at BEND_S
        Rb = rodrigues(np.cross(u, up), math.radians(BEND_DEG))
        O = P + u * BEND_S
        u2, v2, w2 = Rb @ u, Rb @ v, Rb @ w

        def hat(s, dv=0.0, dw=0.0):
            return tuple(O + u2 * (s - BEND_S) + v2 * dv + w2 * dw)
        # gnarled pale ash: the shaft wanders a little, two knots swell it, and it ends in a dark slate FERRULE
        # (fix round 3: the split root foot read as a bone end); the head bends up into the lantern
        ss = np.linspace(-STAFF_BACK + 0.03, BEND_S, 10)
        pts = [at(s_, 0.008 * math.sin(s_ * 8.5 + 0.6), 0.006 * math.cos(s_ * 6.0 + 0.3)) for s_ in ss]
        rad = [r * (1.0 + 0.10 * math.sin(s_ * 13.0) + (0.26 if abs(s_ - 0.18) < 0.05 or abs(s_ + 0.12) < 0.04 else 0.0))
               for s_ in ss]
        shaft.add(sdf.Tube(pts, rad, k=0.012).displaced(
            lambda Q: 0.0035 * NOISE(Q, 14.0) - 0.002 * np.abs(np.sin(np.arctan2((Q - P) @ w, (Q - P) @ v) * 3)), 0.0035),
            k=0.0)
        shaft.add(RoundCone(hat(BEND_S), hat(0.88), r * 1.05, r * 1.6), k=0.03)                       # bends up, flares
        part("staff", shaft, "wood", "bone:prop.R", 130, 0.7, 0.8)
        fu = sdf.frame(u)
        foot = lathe_mesh(at(-STAFF_BACK + 0.005), fu, [(0.0, 0.0), (0.004, r * 1.05), (0.016, r * 1.32), (0.052, r * 1.30),
                                                        (0.060, r * 1.12), (0.068, 0.0)], 6)
        part("staff_cap", ("mesh", foot[0], foot[1]), "ironstone", "bone:prop.R", None, 0.4)
        fr2 = sdf.frame(u2, v2)
        # the concept's HEXAGONAL dawnglass lantern: a fluted chalk socket, six big glowing panes (the job lamp:
        # the widest light on the wick) between six slim chalk corner posts, a framing ring, a low six-sided roof
        # with a small eave (from the 52 deg camera the roof never hides the panes), a knob and a SHORT blunt
        # spire (explicit, crisp: never a claw on a gem, never a tall pale point)
        s0, Lb = 0.905, LANTERN_A["len"]
        r0, r1 = LANTERN_A["r"]
        frame_m = [lathe_mesh(hat(s0 - 0.058), fr2, [(0.0, 0.028), (0.024, 0.034), (0.046, 0.060), (0.060, 0.056)], 6)]
        # the panes' thin dark slate BEZELS (the foot ring and a band under the eave): the light's edge; the
        # frame, posts, eave and roof are chalk (the concept's chalk-framed lantern)
        bez = [lathe_mesh(hat(s0 - 0.004), fr2, [(0.0, r0 - 0.006), (0.0, r0 + 0.010), (0.014, r0 + 0.010),
                                                 (0.014, r0 - 0.002)], 6),
               lathe_mesh(hat(s0 + Lb - 0.020), fr2, [(0.0, r1 - 0.004), (0.0, r1 + 0.007), (0.011, r1 + 0.009),
                                                      (0.011, r1 - 0.004)], 6)]
        for k in range(6):
            a = 2 * math.pi * (k + 0.5) / 6
            dirv = fr2[0] * math.cos(a) + fr2[1] * math.sin(a)
            p0 = np.array(hat(s0 + 0.010)) + dirv * (r0 + 0.004)
            p1 = np.array(hat(s0 + Lb - 0.004)) + dirv * (r1 + 0.004)
            frame_m.append(lathe_mesh(p0, sdf.frame(p1 - p0, dirv), [(0.0, 0.0085), (float(np.linalg.norm(p1 - p0)), 0.0085)],
                                      4))
        e = r1 + 0.016
        frame_m.append(lathe_mesh(hat(s0 + Lb - 0.012), fr2,
                                  [(0.0, r1 - 0.008), (0.008, e - 0.010), (0.016, e), (0.024, e - 0.006),
                                   (0.046, 0.054), (0.066, 0.028), (0.072, 0.0)], 6))
        roof = lathe_mesh(hat(s0 + Lb - 0.012), fr2,
                          [(0.064, 0.0), (0.068, 0.026), (0.074, 0.024), (0.080, 0.030), (0.098, 0.030),
                           (0.106, 0.018), (0.148, 0.0045), (0.152, 0.0)], 6)
        STAFF_HEAD["aubade"] = np.array(hat(s0 - 0.058))
        v_, f_ = merge_meshes(frame_m)
        part("lantern", ("mesh", v_, f_), "chalk", "bone:prop.R", None, 0.6)
        v_, f_ = merge_meshes(bez)
        part("lantern_bezel", ("mesh", v_, f_), "ironstone", "bone:prop.R", None, 0.4)
        part("lantern_roof", ("mesh", roof[0], roof[1]), "chalk", "bone:prop.R", None, 0.5)
        v_, f_ = lathe_mesh(hat(s0 + 0.004), fr2, [(0.0, 0.0), (0.0, r0), (Lb - 0.012, r1), (Lb - 0.004, 0.0)], 6)
        part("lantern_light", ("mesh", v_, f_), "accent", "bone:prop.R", None, 0.6)
        return
    # SERENADE: a walnut staff, an ironstone foot cap, and the concept's heavy CAGED lampresin lantern: a glowing
    # ball inside three thick ironstone bands (a cross plus a ring from the front: many recessed panes), a heavy
    # double collar where the staff enters and a collar + bolt knob on the far side
    shaft.add(Capsule(at(-STAFF_BACK + 0.06), at(0.82), r).displaced(lambda Q: 0.004 * NOISE(Q, 10.0), 0.004), k=0.0)
    part("staff", shaft, "wood_dark", "bone:prop.R", 170, 0.7, 0.8)
    fu = sdf.frame(u)
    foot = lathe_mesh(at(-STAFF_BACK - 0.028), fu, [(0.0, 0.0), (0.004, r * 1.30), (0.060, r * 1.48), (0.078, r * 1.32),
                                                    (0.090, r * 1.05), (0.100, 0.0)], 6)
    part("staff_cap", ("mesh", foot[0], foot[1]), "ironstone", "bone:prop.R", None, 0.5)
    c, Rg_ = 0.985, 0.106             # (fix round 3: r 11.6 -> 10.6 cm, the accent to 5-7 %)
    Rgp = prop_rotation(info, guard_pose())
    nX, nY, nZ = (Rgp.T @ np.array(e) for e in ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))
    iron = [band_ring(at(c), sdf.frame(n_), Rg_ - 0.006, Rg_ + 0.020, 0.015, 9) for n_ in (nX, nY, nZ)]
    iron.append(lathe_mesh(at(c - Rg_ - 0.080), fu, [(0.0, 0.0), (0.0, 0.034), (0.012, 0.052), (0.036, 0.050),
                                                     (0.044, 0.060), (0.084, 0.052)], 8))
    iron.append(lathe_mesh(at(c + Rg_ - 0.006), fu, [(0.0, 0.058), (0.026, 0.060), (0.036, 0.048), (0.044, 0.031),
                                                     (0.086, 0.026), (0.094, 0.0)], 8))
    v_, f_ = merge_meshes(iron)
    part("lantern", ("mesh", v_, f_), "ironstone", "bone:prop.R", None, 0.6)
    # the amber LAMPRESIN rims: the resin panes' edges showing either side of each iron band (the Serenade lamp
    # material; the core's light is the accent, so without them the amber never showed)
    Rr, hwr = Rg_ + 0.004, 0.027
    rr_ = math.sqrt(Rr * Rr - hwr * hwr)
    resin = [lathe_mesh(at(c), sdf.frame(n_), [(-hwr, rr_), (0.0, Rr), (hwr, rr_)], 8) for n_ in (nX, nY, nZ)]
    v_, f_ = merge_meshes(resin)
    part("lantern_resin", ("mesh", v_, f_), "lampresin", "bone:prop.R", None, 0.4)
    v_, f_ = ellipsoid_mesh(at(c), (Rg_,) * 3, nu=10, nv=6)
    part("lantern_light", ("mesh", v_, f_), "accent", "bone:prop.R", None, 0.6)


def band_ring(c, axes, r_in, r_out, hw, nu):
    """an open-section band round axes[2] (its two sides and its outer face; the inner face lies on the glass)"""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    sec = [(r_in, -hw), (r_out, -hw), (r_out, hw), (r_in, hw)]
    V = []
    for i in range(nu):
        a = 2 * math.pi * (i + 0.5) / nu
        for r_, h in sec:
            V.append(c + (ax[0] * math.cos(a) + ax[1] * math.sin(a)) * r_ + ax[2] * h)
    V = np.array(V)
    F = []
    for i in range(nu):
        i2 = (i + 1) % nu
        for k in range(3):
            a_, b_, c_, d_ = i * 4 + k, i2 * 4 + k, i2 * 4 + k + 1, i * 4 + k + 1
            F += [(a_, b_, c_), (a_, c_, d_)]
    F = np.array(F, dtype=np.int64)
    cen = V[F].mean(1)
    loc = (cen - c) @ ax.T
    aa = np.arctan2(loc[:, 1], loc[:, 0])
    core = c[None] + (ax[0][None] * np.cos(aa)[:, None] + ax[1][None] * np.sin(aa)[:, None]) * (r_in - 0.002)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    flip = (nn * (cen - core)).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


# ── paint: the palette base painted from the sculpt, carrying the concept's strokes ────────────────────────
# part colours beyond the role palette (the concepts' colour placement)
PART_HEX = {
    # fix round 3 (B5 value law: the hoods at L* <= 65 in game and under the fighters; the team read for both
    # viewers): the linen hood #A2B4C4 -> #7E878F (L* 72 -> 56, chroma 10.6 -> 5.5: the ally azure stood weakly
    # on the blue linen), the chalk #D9D6CD -> #98948A on the hood / #9C988E on the pauldrons (L* 86 -> 61-63:
    # weathered chalk, still the lightest stone on the wick), the stole #E0DDD4 -> #A8A49A (L* 67), the wool cloak
    # a little greyer (#6E7A86 -> #6A727B, chroma 8 -> 5.5; same blue-grey family as the other Aubade wicks), the
    # ash staff #C4BBA9 -> #9A8C76 (L* 59: the near-white tube read as bone). In game (both seats) the hood p90 is
    # L* 61-64
    "aubade": {"hood": "#7E878F", "cowl": "#646E79", "forearms": "#A29E94", "belt": "#9A968C", "tabard": "#A8A49A",
               "crown_cups": "#30353C", "lantern_bezel": "#30353C", "lantern": "#A29E94",
               "mitt_L": "#68727C", "mitt_R": "#68727C", "staff": "#85775F", "hood_rim": "#928E85",
               # (r6, review r4: the hood top quarter L* 65-66 in game, over the cap: the chalk circlet and its spire
               # towers -4 L*, the rim -2, the pauldron caps' top step darkened in `_pauldron_aubade`)
               "pauldron_L": "#9C988E", "pauldron_R": "#9C988E", "crown": "#8C887F",
               "lantern_roof": "#A29E94", "staff_cap": "#3A3F46", "cloak": "#6A727B", "sleeves": "#6A727B"},
    # Serenade: ochre / umber. Fix round 3: the felt down to L* ~57-60 and ~31 % saturation (was L* 71-72 at 39.7 %,
    # on the 40 % cap of the reserved marigold band: the enemy tint sat on a near-amber body, and the pale cream
    # dome out-valued the fighters); the umber cloak stays at 23 deg (under the band)
    "serenade": {"hood": "#9A846A", "hood_cap": "#93806A", "hood_rim": "#563F31", "pauldron_L": "#5E5047", "pauldron_R": "#5E5047",
                 "crown": "#7A6A5A",
                 "collar": "#664E3E", "bib": "#9E876B", "forearms": "#4E3C30", "mitt_L": "#3B3430", "mitt_R": "#3B3430",
                 "cloak": "#7B5842", "sleeves": "#7B5842", "mantle": "#A88F72", "tabard": "#9E876B"},
}
CLOTH_ROLES = ("cloth", "cloth2", "under")
ROUGH = {"cloth": 0.93, "cloth2": 0.92, "under": 0.92, "chalk": 0.86, "stone": 0.82, "ironstone": 0.80, "lampresin": 0.5,
         "leather": 0.66, "wood": 0.76, "wood_dark": 0.74, "ink": 0.95}
RAMP = {   # value (linear multiplier) by height: light top, dark feet (bible §2.4)
    # (fix round 3: the top lifts trimmed, 1.18 -> 1.09 / 1.26 -> 1.14: the hoods stay under L* 65 in game)
    "aubade": [(0.0, 0.45), (0.20, 0.55), (0.45, 0.75), (0.80, 0.93), (1.05, 1.0), (1.28, 1.05), (1.80, 1.09)],
    # (fix round 4: in game the Serenade feet read lighter than its top, 30-35 against 26-28) the feet a step darker
    # (r6, review r4: in game top / mid / feet 34 / 31 / 28 on High, 34 / 34 / 33 on Low: flat) the lower coat darker
    # toward the hem (the feet quarter <= L* 28 on screen), the top kept
    "serenade": [(0.0, 0.21), (0.20, 0.28), (0.45, 0.50), (0.80, 0.83), (1.05, 1.02), (1.35, 1.10), (1.80, 1.16)],
}
SHADOW_TINT = {"aubade": (-0.10, -0.03, 0.14), "serenade": (0.10, -0.02, -0.14)}
KEY = np.array((-0.35, -0.60, 0.72)) / np.linalg.norm((-0.35, -0.60, 0.72))   # painted key: front, upper right
LUMA = np.array([0.2126, 0.7152, 0.0722])
# how much of the concept a role carries: (its strokes, its painted fold light, its colour breakup)
KCON = {"cloth": (0.95, 0.80, 0.55), "cloth2": (0.95, 0.80, 0.55), "under": (0.6, 0.5, 0.3),
        "chalk": (0.60, 0.50, 0.25), "stone": (0.8, 0.6, 0.3), "ironstone": (0.9, 0.65, 0.35),
        "leather": (0.75, 0.55, 0.3), "wood": (0.75, 0.5, 0.3), "wood_dark": (0.75, 0.5, 0.3)}
BOSS: dict = {}             # (faction, side) -> (boss centre, normal): the Serenade boss paints sandstone


def lin(h) -> np.ndarray:
    return project._lin(np.asarray(scene.hex_srgb(h), dtype=np.float32))


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(col, h, m):
    m = np.asarray(m, float)[:, None]
    return col * (1 - m) + lin(h)[None] * m


def grid_sampler(grid):
    """trilinear sampler of a part's SDF grid (clipped to +-0.1)"""
    D, lo, vox = grid
    n = np.array(D.shape)

    def f(Q):
        u = (Q - lo) / vox
        i = np.clip(np.floor(u).astype(np.int64), 0, n - 2)
        t = np.clip(u - i, 0.0, 1.0)
        x, y, z = i[:, 0], i[:, 1], i[:, 2]
        tx, ty, tz = t[:, 0], t[:, 1], t[:, 2]
        c00 = D[x, y, z] * (1 - tx) + D[x + 1, y, z] * tx
        c10 = D[x, y + 1, z] * (1 - tx) + D[x + 1, y + 1, z] * tx
        c01 = D[x, y, z + 1] * (1 - tx) + D[x + 1, y, z + 1] * tx
        c11 = D[x, y + 1, z + 1] * (1 - tx) + D[x + 1, y + 1, z + 1] * tx
        return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
    return f


def surface_fields(grid, P, N):
    """per texel: the point on the sculpt's surface, its normal, the SDF Laplacian (fold crests > 0, valleys < 0)
    and an SDF occlusion (0 open .. 1 deep in a fold)"""
    f = grid_sampler(grid)
    vox = grid[2]
    E = np.eye(3)

    def grad(Q, e):
        return np.stack([f(Q + E[i] * e) - f(Q - E[i] * e) for i in range(3)], 1) / (2 * e)
    p = P.copy()
    for _ in range(5):
        d = f(p)
        g = grad(p, vox)
        step = np.clip(d / ((g * g).sum(1) + 1e-6), -0.03, 0.03)
        p = p - g * step[:, None]
    g = grad(p, vox)
    gl = np.linalg.norm(g, axis=1)
    bad = (np.abs(f(p)) > 0.012) | (gl < 0.3) | ~np.isfinite(gl)
    g = g / np.maximum(gl, 1e-6)[:, None]
    p[bad], g[bad] = P[bad], N[bad]
    h = 1.6 * vox
    lap = (sum(f(p + E[i] * h) + f(p - E[i] * h) for i in range(3)) - 6 * f(p)) / (h * h)
    occ = np.zeros(len(p))
    for hh, w in ((0.010, 0.45), (0.022, 0.35), (0.045, 0.20)):
        occ += w * np.clip((hh - f(p + g * hh)) / hh, 0.0, 1.0)
    lap[bad] = 0.0
    occ[bad] = 0.0
    return p, g, lap, occ


# region painters (linear colour in, linear colour out)
def channel(col, d, w=CHANNEL, soft=0.005):
    """the slate channel round a light: d = the texel's distance outside the light's edge (m), w its width"""
    t = np.clip((d - (w - soft)) / soft, 0.0, 1.0)
    m = 1.0 - t * t * (3 - 2 * t)
    return mix(col, CHANNEL_HEX, m)


def _hood_aubade(spec, p, g, col):
    """the concept's light blue-grey linen cowl all over (#A2B4C4, L* 72: the concept's hood measures L* 71-85,
    bluer than the palette's cloth2; lifted by the paint's top light it renders L* ~78; never white) under a CHALK circlet: a
    soft contact shadow under the circlet and a thin slate BEZEL (1 cm) either side of the lit seam (the seam's
    setting: the only dark on the hood; fix pass 5 dropped the dark slate cap: it read as a black helmet and
    broke the light-top value law)"""
    hc, hr = spec.F["hood"]
    z = p[:, 2]
    a = np.degrees(np.arctan2(p[:, 1] - hc[1], z - hc[2]))
    along = smooth(SEAM_A[0] - 4.0, SEAM_A[0], a) * (1 - smooth(SEAM_A[1], SEAM_A[1] + 4.0, a))
    under = smooth(CROWN_A[0] - 0.045, CROWN_A[0] - 0.004, z) * (1 - smooth(CROWN_A[0] - 0.004, CROWN_A[0], z))
    col = col * (1.0 - 0.22 * under)[:, None]
    above = smooth(CROWN_A[1], CROWN_A[1] + 0.03, z)                       # the band's shadow on the cap
    col = col * (1.0 - 0.14 * above * (1 - smooth(CROWN_A[1] + 0.01, CROWN_A[1] + 0.05, z)))[:, None]
    # (r6, review r4: the hood top quarter L* 65-66 in game, over the B5 cap; measured in game, the brightest quarter of
    # the hood region is the round linen CAP inside the circlet, which faces the sky and the sun from 52 deg) the cap
    # above the circlet 15 % darker (about -3 L*), fading in over 4.5 cm
    col = col * (1.0 - 0.15 * smooth(CROWN_A[1] + 0.005, CROWN_A[1] + 0.050, z))[:, None]
    half = np.interp(a, [-50, -40, 50, 62, 120, 130], [0.011, SEAM_CAP / 2, SEAM_CAP / 2, SEAM_W / 2, SEAM_W / 2, 0.018])
    col = channel(col, np.abs(p[:, 0]) - half + (1 - along) * 1.0, w=BEZEL)
    return col


def _hood_serenade(spec, p, g, col):
    """the felt DOME (fix round 3: "a bald head with a headband"): felt, not skin: a soft pile of blotchy felt tone
    and the crown band's cast shadow on the felt over and under it (the band stands proud of the dome). No
    seams: radial seams meeting at the crown read as a pie / umbrella from the 52 deg camera"""
    z = p[:, 2]
    z0, z1 = CROWN_S
    over = (1 - smooth(z1 + 0.004, z1 + 0.040, z)) * smooth(z1 - 0.004, z1 + 0.003, z)
    under = smooth(z0 - 0.035, z0 - 0.003, z) * (1 - smooth(z0 - 0.003, z0 + 0.004, z))
    col = col * (1 - 0.22 * over - 0.32 * under)[:, None]
    return col * (1 + 0.07 * PNOISE(p, 7.0, (2.2, 0.4, 1.1)) + 0.04 * PNOISE(p, 23.0, (0.7, 3.1, 0.2)))[:, None]


def _rim_serenade(spec, p, g, col):
    """(r7) the rim's sill run (along the opening's bottom, round its lower corners) is the felt's own turned edge in
    the dome's felt, a little darker: the opening's straight sill, never a dark lower lip under it"""
    zb = tomb_of(spec.F).zb
    return mix(col, "#8A765E", 1.0 - smooth(zb + 0.012, zb + 0.040, p[:, 2]))


def _mantle_serenade(spec, p, g, col):
    """the felt capelet (r6, review r4: "a flat slab with a straight hem and barely visible folds"): the drape's own
    folds painted from the sculpt's function (`mantle_drape`: a shadowed valley between every two lobes of the
    scalloped hem, a lit crest down each lobe), the thick turned edge darker along the hem, its UNDERSIDE in shadow
    (the lip and the bell's floor), a worn light along the shoulder tops (+3 L*: the top value band)"""
    z = p[:, 2]
    a = ang(p)
    hem = mantle_hem(a)
    v, w = mantle_drape(p)
    w = np.maximum(w, 0.35 * (1.0 - smooth(1.20, 1.31, z)))           # soft folds over the front too
    crest = (1.0 - v) ** 4
    col = col * (1 - 0.42 * v * w + 0.16 * crest * w)[:, None]
    col = col * (1 + 0.06 * PNOISE(p, 16.0, (0.3, 1.2, 2.1)))[:, None]
    edge = 1 - smooth(0.010, 0.032, z - hem)
    col = col * (1 - 0.30 * edge)[:, None]
    col = col * (1 - 0.42 * smooth(-0.25, -0.75, g[:, 2]))[:, None]     # the underside: the capelet stands off the coat
    top = smooth(0.55, 0.95, g[:, 2]) * smooth(1.16, 1.30, z)
    return col * (1 + 0.16 * top)[:, None]


def _cloak_aubade(spec, p, g, col):
    F = spec.F
    hz0, hamp, hn = F["hem"]
    hem = hem_line(hz0, hamp, hn, p)
    # the slate UNDER-ROBE in the front opening (palette `under`): the chalk stole stands on it
    col = _robe_floor(spec, p, col, "#454C56", "#30363E", low="#373D45")
    # the back stripe's thin slate bezel (the light is the `back_stripe` ribbon down the spine, z 0.15 - 1.12)
    z = p[:, 2]
    span = smooth(0.33, 0.35, z) * (1 - smooth(1.13, 1.15, z)) * (p[:, 1] > 0.05)
    col = channel(col, np.abs(p[:, 0]) - BACK_W / 2 + (1 - span) * 1.0, w=BEZEL)
    # the 6.5 cm ironstone hem band follows the pointed hem (bible §2.4: dark feet), a pale chalk piping above it
    band = 1.0 - smooth(hem + 0.062, hem + 0.068, p[:, 2])
    col = mix(col, "#3E434A", band)
    # the bell's underside (its hem cap) is the coat's dark INSIDE: seen when the wick lies on its side, it
    # reads as the opening of the robe, never a flat lid
    return mix(col, "#2F353D", 0.92 * smooth(-0.55, -0.80, g[:, 2]))


def _cloak_serenade(spec, p, g, col):
    col = _robe_floor(spec, p, col, "#8E785E", "#5A473B", low="#6E5A4A")
    z = p[:, 2]
    # the mantle's cast shadow on the coat under its scalloped hem (it stands off the coat: a felt capelet)
    dh = mantle_hem(ang(p)) - z
    col = col * (1.0 - 0.46 * smooth(-0.006, 0.006, dh) * (1 - smooth(0.015, 0.085, dh)))[:, None]
    # the concept's bands: an ironstone band at 0.245-0.29 and the dark rolled hem edge (r6: darker, the feet band)
    b1 = smooth(0.150, 0.152, z) * (1 - smooth(0.183, 0.187, z))
    b2 = smooth(0.243, 0.247, z) * (1 - smooth(0.288, 0.292, z))
    col = mix(col, "#332A25", np.maximum(b1, b2))
    # the sash's ironstone borders (the light sits in a dark setting: marigold on bare umber felt melts)
    sb = 1 - smooth(SASH_W / 2 + 0.036, SASH_W / 2 + 0.042, np.abs(z - SASH_Z))
    col = mix(col, "#3A302A", sb * 0.95)
    # a stitched seam line just above each band
    st = (np.abs(z - 0.297) < 0.0025) * (np.sin(ang(p) * 260.0) > 0.2)
    col = mix(col, "#4F3C30", st * 0.5)
    return mix(col, "#3A2E26", 0.92 * smooth(-0.55, -0.80, g[:, 2]))          # the coat's dark inside


def _robe_floor(spec, p, col, robe, lining, low=None):
    """the front opening: the robe floor (RECESS in) and the cloak's inner edge walls (the lining); the robe
    darkens toward the hem (`low`) so the feet stay in the bible's dark band"""
    F = spec.F
    tab, ytab = F["cloak_rx"], F["cloak_ry"]
    R = interp(tab, p[:, 2])
    ry = interp(ytab, p[:, 2])
    re = np.sqrt(p[:, 0] ** 2 + (p[:, 1] / ry) ** 2)
    a = np.degrees(np.abs(ang(p)))
    front = (p[:, 1] < 0) & (np.abs(p[:, 0]) < interp(F["open"][0], p[:, 2]) + 0.03) & (p[:, 2] < F["open"][1] + 0.02)
    depth = np.clip((R - re) / RECESS, 0.0, 1.5) * front
    col = mix(col, lining, smooth(0.20, 0.45, depth))
    m = smooth(0.65, 0.88, depth)
    col = mix(col, robe, m)
    if low is not None:
        col = mix(col, low, m * (1 - smooth(0.25, 0.65, p[:, 2])))
    return col


def _pauldron_serenade(spec, p, g, col, sx):
    """two ochre sandstone bands running down the dome's slope (the concept's stripes) and the sandstone boss"""
    px = spec.F["pauldron_x"] * sx
    c = np.array((px, 0.0, PAULDRON_S_Z - 0.005))
    nrm = np.array((sx * 0.55, 0.0, 0.835))
    s = (p - c) @ nrm
    # (broad: the concept's two ochre bands cover ~40 % of each dome; they lift the top value band)
    # (r6, review r4: "the sandstone bands look like crumpled paper") CLEAN painted ribbons: straight crisp edges (no
    # noise), a smooth fall across each band, a worn edge LIGHT along its upper edge and a shadowed lower edge, a dark
    # groove in the iron either side; no cracks
    lip = smooth(PAULDRON_S_Z - 0.105, PAULDRON_S_Z - 0.115, p[:, 2])
    m = np.zeros(len(p))
    shade = np.ones(len(p))
    groove = np.zeros(len(p))
    for lo_, hi_ in ((0.024, 0.086), (-0.062, -0.002)):
        inb = smooth(lo_ - 0.0015, lo_ + 0.0015, s) * (1 - smooth(hi_ - 0.0015, hi_ + 0.0015, s))
        u_ = np.clip((s - lo_) / (hi_ - lo_), 0.0, 1.0)              # 0 the lower edge .. 1 the upper edge
        band_shade = (0.88 + 0.16 * u_) * (1 + 0.22 * smooth(0.80, 0.97, u_)) * (1 - 0.20 * (1 - smooth(0.0, 0.12, u_)))
        shade = np.where(inb > 0.5, band_shade, shade)
        m = np.maximum(m, inb)
        groove = np.maximum(groove, (1 - smooth(0.0015, 0.0055, np.minimum(np.abs(s - lo_), np.abs(s - hi_)))) * (1 - inb))
    m = m * (1 - lip)
    st = STRIPS.get("L" if sx > 0 else "R")
    if st is not None:                       # the lit strip's dark iron setting (no ochre band runs under it)
        pts = st[0]
        dense = np.concatenate([pts[i] + (pts[i + 1] - pts[i]) * np.linspace(0, 1, 8)[:, None]
                                for i in range(len(pts) - 1)])
        dd = np.concatenate([np.sqrt(((p[k:k + 4096, None, :] - dense[None]) ** 2).sum(2)).min(1)
                             for k in range(0, len(p), 4096)])
        m = m * smooth(st[1] / 2 + 0.008, st[1] / 2 + 0.016, dd)
    col = mix(col, "#A88F70", m)
    col = col * (1 + m * (shade - 1) + 0.03 * m * PNOISE(p, 9.0, (1.1, 0.2, 2.7)))[:, None]
    col = col * (1 - 0.35 * groove * (1 - lip))[:, None]
    spec.sw_damp = m                         # the bands take no swatch strokes / mottle (clean ribbons)
    bc = BOSS.get(("serenade", "L" if sx > 0 else "R"))
    if bc is not None:
        o = p - bc[0]
        h = o @ bc[1]
        d = np.linalg.norm(o - h[:, None] * bc[1][None], axis=1)            # across the boss face
        face = (1 - smooth(0.040, 0.045, d)) * smooth(0.004, 0.012, h)        # on the raised face, not the dome
        col = mix(col, "#A88F70", face)                                       # the carved sandstone disc
        cr2 = np.clip(NOISE.ridged(p, 60.0, 2), 0, 1)
        col = col * (1 - 0.30 * face * smooth(0.80, 0.95, cr2))[:, None]
        rim = (1 - smooth(0.004, 0.008, np.abs(d - 0.040))) * smooth(0.0, 0.008, h)
        col = col * (1 - 0.35 * rim)[:, None]                                 # the carved ring line
    return col


def _pauldron_aubade(spec, p, g, col, side):
    """carved chalk plates: each texel finds its plate (the shell whose radius it sits on), then paints a worn
    bright edge along the plate's borders, a soft shadow where a lame tucks under the plate above it, and a
    carved line round the cap (the concept's relief)"""
    if side not in PLATES:
        return col
    O, ax, plates = PLATES[side]
    q = (p - O) @ ax.T
    best = np.full(len(p), 9.0)
    edge = np.full(len(p), 1.0)
    tuck = np.zeros(len(p))
    groove = np.zeros(len(p))
    which = np.zeros(len(p), dtype=np.int64)
    for i, (rr, th, ph, tk, nt, npp, ef) in enumerate(plates):
        rr = np.asarray(rr, float)
        s_ = q / (rr - tk * 0.5)
        rho = np.linalg.norm(s_, axis=1) + 1e-9
        err = np.abs(rho - 1.0) * float(rr.mean())
        thd = np.degrees(np.arccos(np.clip(s_[:, 2] / rho, -1, 1)))
        phd = np.degrees(np.arctan2(s_[:, 1], s_[:, 0]))
        t1 = th[1] + (ef(phd) if ef is not None else 0.0)
        k = math.pi / 180.0 * float(rr.mean())
        e = np.minimum((t1 - thd) * k, np.minimum(ph[1] - phd, phd - ph[0]) * k * np.maximum(np.sin(np.radians(thd)), 0.3))
        if th[0] > 1e-6:
            e = np.minimum(e, (thd - th[0]) * k)
        sel = err < best
        best = np.where(sel, err, best)
        which = np.where(sel, i, which)
        edge = np.where(sel, e, edge)
        tuck = np.where(sel, (1 - smooth(0.0, 0.035, (thd - th[0]) * k)) if th[0] > 1e-6 else 0.0, tuck)
        if i == 0:
            groove = np.where(sel, 1 - smooth(0.003, 0.007, np.abs(thd - 40.0) * k), groove)
    cap = (which == 0).astype(np.float64)
    # (r6, review r4: the pale pauldron tops lifted the hood top quarter over L* 65 in game) the cap plate's top step
    # a little darker and its worn edge light softer (-3..4 L* where the 52 deg camera looks down on it)
    col = col * (1.0 + (0.22 - 0.10 * cap) * (1 - smooth(0.004, 0.020, edge)))[:, None]
    col = col * (1.0 - 0.11 * cap * smooth(0.35, 0.90, g[:, 2]))[:, None]
    # (r7, verify wave-b: the pale stepped cap inside the inlay's U read as teeth in an open mouth from the side) the cap
    # plate (and its two points) a weathered chalk ~12 L* darker, its worn edges with it: the lames below stay the light
    # chalk. Found by the cap's OUTER sheet and its theta span (the nearest-mid-surface test above gives the cap's outer
    # face to the first lame, whose mid surface lies within 1 mm of it)
    rc_ = np.asarray(plates[0][0], float)
    sc_ = q / rc_
    rho_c = np.linalg.norm(sc_, axis=1) + 1e-9
    th_c = np.degrees(np.arccos(np.clip(sc_[:, 2] / rho_c, -1, 1)))
    capm = (((rho_c > 0.94) & (rho_c < 1.03) & (th_c < plates[0][1][1] + 1.0)) | ((rho_c >= 1.03) & (th_c < 50.0)))
    col = col * (1.0 - CAP_DARK * capm)[:, None]
    col = col * (1.0 - 0.38 * tuck)[:, None]
    col = col * (1.0 - 0.22 * groove)[:, None]
    # the inlay's thin slate bezel (the light is the `pauldron_light_*` ribbon on the middle lame)
    r1 = np.asarray(plates[1][0], float)
    s1 = q / r1
    rho = np.linalg.norm(s1, axis=1) + 1e-9
    thd = np.degrees(np.arccos(np.clip(s1[:, 2] / rho, -1, 1)))
    phd = np.abs(np.degrees(np.arctan2(s1[:, 1], s1[:, 0])))
    on1 = np.abs(rho - 1.0) * float(r1.mean()) < 0.012
    d = np.abs(thd - INLAY_TH) * math.pi / 180.0 * float(r1.mean()) - INLAY_W / 2
    d = d + np.maximum(phd - INLAY_PH, 0.0) * math.pi / 180.0 * float(r1.mean())
    return channel(col, np.where(on1, d, 1.0), w=BEZEL)


def _grain(spec, p, g, col, k=0.14):
    """wood grain along the staff (rest frame: the staff runs along -Y from the right fist). Aubade (fix round 3:
    "a featureless near-white tube"): pale ash with long dark grain streaks, two dark KNOTS where the shaft swells
    and a carved double ring above each grip"""
    aub = spec.faction == "aubade"
    k = 0.36 if aub else k
    n = PNOISE(p * np.array((22.0, 1.4, 22.0)), 1.0) + 0.5 * PNOISE(p * np.array((60.0, 3.0, 60.0)), 1.0, (3.1, 0, 0))
    col = col * (1 + k * n)[:, None]
    if aub:
        # (fix round 4: still "a featureless near-white tube" in game) a darker weathered ash (#85775F, L* 50), broad
        # grain streaks that read at wick scale, the wood's value drifting along the shaft
        streak = smooth(0.50, 0.90, PNOISE(p * np.array((40.0, 1.6, 40.0)), 1.0, (1.3, 0.2, 0.7)))
        col = col * (1 - 0.32 * streak)[:, None]
        col = col * (1 + 0.10 * PNOISE(p * np.array((3.0, 5.0, 3.0)), 1.0, (0.4, 1.9, 2.6)))[:, None]
        P0 = np.asarray(STAFF_P.get("aubade", (0.0, 0.0, 0.0)))
        s_ = -(p[:, 1] - P0[1])                       # along the staff from the right fist (rest: the staff runs -Y)
        aa = np.arctan2(p[:, 2] - P0[2], p[:, 0] - P0[0])
        for sk, a0 in ((0.18, 0.9), (-0.12, -2.1)):    # the knots (the shaft swells there): a dark eye on one side
            da = (aa - a0 + math.pi) % (2 * math.pi) - math.pi
            dk = np.hypot(s_ - sk, da * 0.026)
            halo = (1 - smooth(0.014, 0.040, dk)) * np.abs(np.sin(dk * math.pi / 0.009))
            col = col * (1 - 0.55 * (1 - smooth(0.007, 0.014, dk)) - 0.18 * halo)[:, None]
        for sc in (0.07, GRIP_L + 0.08):             # carved double rings above the grips
            for o_ in (-0.009, 0.009):
                col = col * (1 - 0.40 * (1 - smooth(0.0015, 0.0040, np.abs(s_ - sc - o_))))[:, None]
    head = STAFF_HEAD.get(spec.faction)
    if head is not None:
        # a dark leather BINDING wound round the head under the lantern socket (the lamp's light stands off it)
        d = np.linalg.norm(p - head[None], axis=1)
        wr = 0.5 + 0.5 * np.sign(np.sin(d * math.pi / 0.014))
        col = mix(col, "#3A3B40", (1 - smooth(0.105, 0.115, d)) * (0.88 + 0.12 * wr))
    return col


def _iron(spec, p, g, col):
    cr = np.clip(NOISE.ridged(p, 14.0, 2), 0, 1)
    return col * (1 - 0.30 * smooth(0.62, 0.85, cr))[:, None]


def _tabard_serenade(spec, p, g, col):
    """sand felt with a darker hem fold above the chevron, and dark umber borders round the glowing bands and the
    chevron (the team colour must stand off the sand in BOTH tints: marigold melts into bare sand)"""
    hw, ztop, ztip, zv = spec.F["tabard"]
    z, x = p[:, 2], np.abs(p[:, 0])
    col = mix(col, "#8C7659", 0.35 * (1 - smooth(zv + 0.02, zv + 0.10, z)))
    band = np.zeros(len(p))
    for zc in TAB_BANDS:
        band = np.maximum(band, 1 - smooth(0.039, 0.046, np.abs(z - zc)))
    # the chevron's border: a V from (+-hw, zv + 0.026) to (0, ztip + 0.034)
    zv_line = (ztip + 0.034) + (zv + 0.026 - ztip - 0.034) * np.clip(x / max(hw - 0.016, 1e-3), 0, 1)
    band = np.maximum(band, (1 - smooth(0.036, 0.044, np.abs(z - zv_line))) * (x < hw))
    return mix(col, "#3E3029", band * 0.94)


def _tabard_aubade(spec, p, g, col):
    """the chalk-white stole (the concept): a thin slate bezel round the centre light (the light is the
    `tabard_light` ribbon, TAB_W wide, TAB_TOP .. TAB_END) and a carved border line just inside the stole's edge"""
    hw, ztop, ztip, zv = spec.F["tabard"]
    z, x = p[:, 2], np.abs(p[:, 0])
    dx = x - TAB_W / 2
    d = np.where(z < TAB_END, np.hypot(np.maximum(dx, 0.0), TAB_END - z), dx)       # the square end, rounded off
    d = np.where(z > TAB_TOP, d + (z - TAB_TOP) * 3.0, d)
    col = channel(col, d, w=BEZEL)
    # the stole's carved border (a soft grey line 1.6 cm in from its edge, down the sides and round the V)
    edge = np.where(z >= zv, hw - x, (hw * (z - ztip) / (zv - ztip) - x) * 0.85)
    line = (1 - smooth(0.004, 0.007, np.abs(edge - 0.016))) * (z < ztop - 0.03)
    return col * (1 - 0.16 * line)[:, None]


REGIONS = {
    "aubade": {"cloak": _cloak_aubade, "staff": _grain, "tabard": _tabard_aubade, "hood": _hood_aubade,
               "pauldron_R": lambda s, p, g, c: _pauldron_aubade(s, p, g, c, "R"),
               "pauldron_L": lambda s, p, g, c: _pauldron_aubade(s, p, g, c, "L")},
    "serenade": {"cloak": _cloak_serenade, "staff": _grain, "gorget": _iron, "lantern": _iron, "hood": _hood_serenade,
                 "hood_cap": _hood_serenade, "mantle": _mantle_serenade, "hood_rim": _rim_serenade,
                 "tabard": _tabard_serenade,
                 "pauldron_R": lambda s, p, g, c: _pauldron_serenade(s, p, g, c, -1.0),
                 "pauldron_L": lambda s, p, g, c: _pauldron_serenade(s, p, g, c, 1.0)},
}


def paint_part(spec, name, role, p, g, lap, occ) -> np.ndarray:
    """the painted base of one part (linear): palette + regions, the sculpt's fold light and occlusion, a soft
    top light and key, the light-top / dark-feet ramp, hue-shifted shadows and the material's own SMOOTH
    painterly breakup (brush-scale noise only: no pixel-scale flecks)"""
    fac = spec.faction
    col = np.tile(lin(PART_HEX[fac].get(name) or spec.PALETTE.get(role, "#808080")), (len(p), 1)).astype(np.float64)
    fn = REGIONS[fac].get(name)
    spec.sw_damp = None
    if fn is not None:
        col = fn(spec, p, g, col)
    if role == "ink":
        return col
    cloth = role in CLOTH_ROLES
    crest = np.clip(lap / 40.0, -1.0, 1.0)
    # (fix pass 5: a stronger painted form - deeper folds, a firmer top light and key - the flat value fields
    # read as untextured at the game camera)
    # (fix round 3: a firmer painted value structure again, toward the fighters' Art 2.0 finish: deeper fold
    # valleys and occlusion, a stronger top light and key)
    shade = 1.0 - (0.72 if cloth else 0.52) * occ
    shade = shade * (1.0 + np.where(crest > 0, 0.50, 0.58) * crest)    # crests catch light, valleys go dark
    shade = shade * (0.48 + 0.62 * (0.5 + 0.5 * g[:, 2]))               # soft sky light (painted)
    shade = shade * (1.0 + 0.28 * np.clip(g @ KEY, -1.0, 1.0))          # the painted key
    ramp = np.interp(p[:, 2], *zip(*RAMP[fac]))                         # light top, dark feet
    if fac == "aubade" and name in ("tabard", "hood"):
        ramp = ramp ** (0.35 if name == "tabard" else 0.4)    # the chalk stole stays white; the linen hood stays linen
    elif fac == "serenade" and name in ("hood", "hood_cap", "mantle"):
        ramp = ramp ** 0.75                                   # the ochre felt stays ochre (lifted, it read cream)
    shade = shade * ramp
    if fac == "serenade" and name == "cloak":
        # (r6, review r4: "the Serenade cloak is a plain smooth brown tube") the coat's own folds PAINTED from the
        # sculpt's fold function (the low is a smooth bell): a lit crest and a deep shadowed valley down each fold,
        # opening toward the hem (the glimwick's analytic fold light); they fade out under the mantle
        w = cloak_fold_w(spec.F, False, p)
        hang = 1.0 - smooth(1.02, 1.20, p[:, 2])
        crest_ = np.maximum(w, 0.0) ** 2 * smooth(-0.4, 0.6, g[:, 2] + 0.25)
        shade = shade * (1.0 + hang * (np.where(w > 0, 0.20, 0.38) * w + 0.12 * crest_))
    nz = 0.034 * PNOISE(p, 6.0) + 0.016 * PNOISE(p, 17.0, (1.7, 0.3, 0.9))
    if cloth and fac == "aubade":
        # long vertical brush strokes down the wool (the concept's straight folds), soft
        nz = nz + 0.040 * PNOISE(p * np.array((24.0, 24.0, 2.2)), 1.0, (0.2, 1.1, 0.0))
        nz = nz + 0.016 * PNOISE(p * np.array((60.0, 60.0, 6.0)), 1.0, (2.0, 0.5, 0.0))
    elif cloth:
        # felt: a soft mottle, a fine nap and a fibre speckle (never banded; fix round 3: the nap stronger)
        nz = nz + 0.034 * PNOISE(p, 11.0, (5.0, 1.0, 2.0)) + 0.028 * PNOISE(p, 34.0, (0.4, 2.2, 1.3)) \
            + 0.050 * PNOISE(p, 140.0, (0.3, 2.2, 5.1))
        if name in ("cloak", "sleeves"):          # (r6) long soft brush strokes down the hanging felt
            nz = nz + 0.032 * PNOISE(p * np.array((24.0, 24.0, 2.2)), 1.0, (0.2, 1.1, 0.0))
    elif role in ("chalk", "stone"):
        nz = nz + 0.030 * PNOISE(p, 12.0, (2.0, 0.0, 1.0)) - 0.035 * smooth(0.80, 0.97, np.clip(NOISE.ridged(p, 20.0, 2), 0, 1))
        shade = shade * (1.0 + 0.20 * smooth(0.20, 0.75, crest))                                  # worn bright edges
    elif role in ("ironstone", "leather"):
        nz = nz + 0.060 * PNOISE(p, 12.0, (0.5, 3.0, 1.0)) + 0.025 * PNOISE(p, 40.0)
        shade = shade * (1.0 + 0.26 * smooth(0.20, 0.75, crest))
        if role == "ironstone":                                              # a cool sheen on the iron tops
            # (the dome pauldrons too: the concept's pale crowns on the domes, the top value band from the
            # 52 deg camera, which looks down on them)
            k_ = 0.10 if name.startswith("pauldron") else 0.20     # the domes stay dark iron (their stripes read)
            shade = shade * (1.0 + k_ * smooth(0.40, 0.95, g[:, 2]))
    damp = getattr(spec, "sw_damp", None)
    if damp is not None and len(damp) == len(p):
        nz = nz * (1.0 - 0.85 * damp)                       # clean painted ribbons (the Serenade pauldron bands)
    shade = shade * (1.0 + nz)
    if cloth:                                                                # dust on the hem
        dirt = 0.20 * (1 - smooth(0.06, 0.34, p[:, 2]))
        col = col * (1 - dirt)[:, None] + (col @ LUMA)[:, None] * dirt[:, None] * 0.9
    t = np.asarray(SHADOW_TINT[fac])
    dark = np.clip(1.0 - shade, 0.0, 0.6)[:, None]
    col = col * (1.0 + dark * t[None])
    col = col * shade[:, None]
    return col


def ink_hollow(spec, P, N, col, with_mask=False):
    """the head space is INK (no lining shell): every texel of the hood that lies on the tombstone hollow's walls
    (raster position, and a normal facing INTO the hollow: the decimated cheek beside the opening never takes
    ink), with a faint lift where the felt turns in at the opening"""
    T = tomb_of(spec.F)
    d = T.d(P)
    zc = 0.5 * (T.zb + T.zt)
    axis = np.stack([np.zeros(len(P)), P[:, 1], np.full(len(P), zc)], 1)
    facing = ((axis - P) * N).sum(1) / (np.linalg.norm(axis - P, axis=1) + 1e-9)
    # every texel well behind the opening's plane is ink whatever its normal (the decimated walls' odd
    # normals left lit streaks in the hollow); near the plane the facing test keeps the cheeks clean
    hc, hr = spec.F["hood"]
    y_open = hc[1] - hr[1]
    behind = smooth(y_open + 0.030, y_open + 0.060, P[:, 1])
    inside = (1.0 - smooth(0.006, 0.020, d)) * np.maximum(smooth(-0.05, 0.25, facing), behind)
    # (fix round 3) and EVERYTHING seen through the opening: a texel inside the arch's outline (x, z) lies in the
    # hollow whatever the decimated low did there (bits of the hood low bulging past the rim read as felt
    # triangles poking into the dark; the cowl / collar tops under the arch as a lit lower lip)
    thru = 1.0 - smooth(-0.006, 0.0, T.outline(P[:, 0], P[:, 2]))
    (ec_, er_) = spec.F["tomb"][1]
    deep_y = ec_[1] + 0.8 * er_[1]                  # never past the head space's back (the hood's back stays felt)
    inside = np.maximum(inside, thru * (P[:, 1] > -0.30) * (P[:, 1] < deep_y))
    # (r7, verify wave-b: "a thin lit sliver inside the hollow below the core at 52 deg") the hollow's FLOOR is ink
    # whatever its normal: the hood low's decimated floor is one long sliver triangle wound DOWN (its texels failed the
    # facing test) lying exactly on the outline's bottom edge (`thru` 0), so its front was painted as felt, a pale
    # streak in the pocket under the core. Every near-level texel on the floor band inside the hood's outer shell
    T_w = T.w + 0.004
    floor = ((np.abs(P[:, 0]) < T_w) & (P[:, 2] > T.zb - 0.008) & (P[:, 2] < T.zb + 0.022) & (np.abs(N[:, 2]) > 0.5)
             & (P[:, 1] > -0.30) & (P[:, 1] < deep_y))
    if floor.any():
        floor[floor] = hood_outer(spec.F).d(P[floor]) < 0.002
    inside = np.maximum(inside, floor.astype(np.float64))
    deep = smooth(0.0, 0.06, P[:, 1] + 0.20)
    ink = np.tile(lin(spec.PALETTE.get("ink", "#15171B")), (len(P), 1)) * (1.0 + 0.8 * (1 - deep))[:, None]
    # the core's SPILL (fix round 3: the soft falloff round the one lamp core): its light on the walls that FACE it,
    # falling off with the distance from its surface (1 / (1 + (d / 7 cm)^2)), only at and BEHIND the core's
    # depth: the front of the hollow (the sill, the floor in front of the core, the cheeks inside the rim) stays
    # ink, so the core floats in the dark with no lit floor (a tongue) and no pale ring (a sclera) round it. A
    # neutral grey glow (never a team colour), dim: at most L* ~38 right behind the core
    lc, lr, tilt = spec.F["hood_light"]
    lc = np.asarray(lc, dtype=np.float64)
    t = math.radians(tilt)
    ax = np.array([(1.0, 0.0, 0.0), (0.0, math.cos(t), -math.sin(t)), (0.0, math.sin(t), math.cos(t))])
    q = ((P - lc[None]) @ ax.T) / np.asarray(lr)[None]
    dist = np.maximum((np.linalg.norm(q, axis=1) - 1.0) * float(min(lr)), 0.0)
    to_c = lc[None] - P
    to_c /= np.linalg.norm(to_c, axis=1, keepdims=True) + 1e-9
    face = np.clip((N * to_c).sum(1), 0.0, 1.0) ** 0.6
    # (r7: the halo carries the falloff now; the side walls level with the core caught the spill as a lit diagonal
    # facet in the QA close-up) only the walls BEHIND the core take it, and less of it (0.40 -> 0.25)
    back = smooth(lc[1] - 0.005, lc[1] + 0.035, P[:, 1])
    # (r6, review r4: "a lit diagonal shard of inner wall shows inside the hollow": the painted spill lit the walls
    # beside the core as grey planes; the halo carries the falloff now) the spill halved: the pocket stays ink
    spill = face * back / (1.0 + (dist / 0.060) ** 2) * 0.25
    # (r7) none in the POCKET under the core (the floor and the low walls behind it): it stays ink, matte and occluded in
    # the ORM (roughness 1, occlusion 0.05): no lit face under the light from the 52 deg camera
    spill = spill * smooth(lc[2] - 1.6 * lr[2], lc[2] - 0.4 * lr[2], P[:, 2])
    warm = spec.faction == "serenade"
    ink = mix(ink, "#645E57" if warm else "#5A5F66", np.clip(spill, 0.0, 1.0))
    out = col * (1 - inside[:, None]) + ink * inside[:, None]
    orm_ink = inside * (1.0 - 0.6 * np.clip(spill, 0.0, 1.0))
    if spec.faction == "aubade":
        # (r6, review r4: from 52 deg "a big grey flat sill block under the opening and a serrated dark edge along
        # the hollow's floor shelf: a jaw with teeth") the sill (sunk 2 cm) falls into the hollow's shadow: the top
        # 1 cm of it is inked (matte, occluded in the ORM: the decimated floor edge reads dark on dark, never as
        # teeth on a lit shelf) and the chin under it darkens softly into the scarf, never a pale block
        zb = T.zb
        front = (P[:, 1] < hc[1] - 0.10) & (np.abs(P[:, 0]) < T.w + 0.025)
        below = P[:, 2] < zb + 0.010
        dk = smooth(zb - 0.055, zb - 0.002, P[:, 2]) * front * below
        lip_ = (1.0 - smooth(0.004, 0.012, zb - P[:, 2])) * front * below
        out = mix(out, "#1E2227", np.clip(0.78 * dk ** 1.4 + lip_, 0.0, 1.0))
        orm_ink = np.maximum(orm_ink, lip_)
    # the ORM's dark (occluded, matte) ink: less of it where the spill paints the glow (the glow takes the sky)
    return (out, orm_ink) if with_mask else out


def floor_uv_mask(spec, obj, names, size, part_attr="vale_part", dil=2):
    """(r7) the texels of the hood low's hollow FLOOR triangles (UV rows top-down, like `project.rasterize`), dilated
    `dil` px. The decimated floor is a few long sliver triangles 3-4 texels wide in UV: the texel centres inside them
    are few, so the renderer samples their neighbours (the felt of the sill's front face) across them, a pale streak
    in the pocket under the core at 52 deg. These are painted ink after the gutter fill, whatever owns them."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0 or "hood" not in names:
        return None
    k_hood = names.index("hood")
    tl = np.empty(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", tl)
    tl = tl.reshape(nt, 3)
    tp = np.empty(nt, dtype=np.int64)
    me.loop_triangles.foreach_get("polygon_index", tp)
    pp = project.poly_parts(me, part_attr)
    sel = pp[tp] == k_hood
    if not sel.any():
        return None
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(nl, 2)
    lv = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    mw = np.array(obj.matrix_world)
    if not np.allclose(mw, np.eye(4), atol=1e-6):
        co = co @ mw[:3, :3].T + mw[:3, 3]
    V = co[lv[tl[sel]]]
    UV = uv[tl[sel]] * size
    T = tomb_of(spec.F)
    c = V.mean(1)
    n = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    ok = ((np.abs(c[:, 0]) < T.w) & (c[:, 2] > T.zb - 0.006) & (c[:, 2] < T.zb + 0.012) & (np.abs(n[:, 2]) > 0.7))
    ok &= hood_outer(spec.F).d(c) < -0.003
    if not ok.any():
        return None
    mask = np.zeros((size, size), dtype=bool)
    for (a, b, cc) in UV[ok]:
        x0 = int(max(0, math.floor(min(a[0], b[0], cc[0]) - 1)))
        x1 = int(min(size - 1, math.ceil(max(a[0], b[0], cc[0]) + 1)))
        y0 = int(max(0, math.floor(min(a[1], b[1], cc[1]) - 1)))
        y1 = int(min(size - 1, math.ceil(max(a[1], b[1], cc[1]) + 1)))
        den = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
        if x1 < x0 or y1 < y0 or abs(den) < 1e-12:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((b[1] - cc[1]) * (gx - cc[0]) + (cc[0] - b[0]) * (gy - cc[1])) / den
        w1 = ((cc[1] - a[1]) * (gx - cc[0]) + (a[0] - cc[0]) * (gy - cc[1])) / den
        m = (w0 >= -0.02) & (w1 >= -0.02) & (1 - w0 - w1 >= -0.02)
        # a sliver may hold no texel centre: its three corners and its centroid are marked too
        iy, ix = np.nonzero(m)
        rows = list(size - 1 - (iy + y0))
        cols = list(ix + x0)
        for q in (a, b, cc, (a + b + cc) / 3.0, (a + b) / 2.0, (b + cc) / 2.0, (a + cc) / 2.0):
            rows.append(size - 1 - int(min(size - 1, max(0, math.floor(q[1])))))
            cols.append(int(min(size - 1, max(0, math.floor(q[0])))))
        mask[np.array(rows), np.array(cols)] = True
    for _ in range(dil):
        mask = (mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1))
    return mask


def lowpass3d(P, v, cell, keep=None, passes=1):
    """3D low-pass of per-texel values over their surface points: trilinear splat onto a `cell` grid, [1 2 1]
    blurs, trilinear gather (normalised by the kept weight: hidden texels never pull the mean)"""
    P = np.asarray(P, dtype=np.float64)
    v = np.asarray(v, dtype=np.float64)
    wt = np.ones(len(P)) if keep is None else keep.astype(np.float64)
    lo = P.min(axis=0) - 2 * cell
    g = (P - lo) / cell
    i0 = np.floor(g).astype(np.int64)
    f = g - i0
    n = i0.max(axis=0) + 4
    size = int(np.prod(n))
    S, W = np.zeros(size), np.zeros(size)
    corners = []
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w_ = ((f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1])
                      * (f[:, 2] if dz else 1 - f[:, 2]))
                idx = ((i0[:, 0] + dx) * n[1] + (i0[:, 1] + dy)) * n[2] + (i0[:, 2] + dz)
                S += np.bincount(idx, weights=w_ * wt * v, minlength=size)
                W += np.bincount(idx, weights=w_ * wt, minlength=size)
                corners.append((idx, w_))
    S, W = S.reshape(tuple(n)), W.reshape(tuple(n))
    for _ in range(passes):
        for ax in range(3):
            S = 0.25 * (np.roll(S, 1, ax) + 2 * S + np.roll(S, -1, ax))
            W = 0.25 * (np.roll(W, 1, ax) + 2 * W + np.roll(W, -1, ax))
    M = (S / np.maximum(W, 1e-12)).ravel()
    return sum(M[idx] * w_ for idx, w_ in corners)


# the concept's brushwork per material, cut from the graded plates (side, x0, x1, z0, z1 in model metres): laid
# on EVERY texel of the parts that wear that material (registration-free: sides, tops and backs carry the
# concept's own strokes and painted folds too, never a misplaced feature)
SWATCH = {
    "serenade": {"cloak": ("back", -0.24, 0.24, 0.40, 0.90), "mantle": ("back", -0.24, 0.24, 1.04, 1.20),
                 "collar": ("back", -0.16, 0.16, 1.33, 1.41),
                 "tabard": ("front", -0.06, 0.06, 0.48, 0.86), "dome": ("back", 0.30, 0.43, 1.27, 1.33),
                 "boot": ("front", 0.12, 0.22, 0.03, 0.10)},
    "aubade": {"cloak": ("back", -0.30, -0.05, 0.35, 0.90), "hood": ("back", -0.13, -0.03, 1.42, 1.58),
               "cowl": ("back", -0.26, -0.05, 1.14, 1.24), "tabard": ("front", 0.0, 0.06, 0.40, 0.85),
               "chalk": ("back", 0.24, 0.33, 1.22, 1.30), "boot": ("front", 0.18, 0.30, 0.03, 0.09)},
}
SWATCH_OF = {
    # (fix pass 5: the felt dome and the mantle carry the procedural felt only: the plate's mantle / dome swatches
    # carried horizontal edges that tiled into strata bands, the tabard's pitted into a biscuit)
    "serenade": {"cloak": "cloak", "sleeves": "cloak", "legs": "cloak",
                 "hood_rim": "collar", "collar": "collar", "tabard": "tabard", "bib": "tabard", "pauldron_R": "dome",
                 "pauldron_L": "dome", "gorget": "dome", "crown": "dome", "cuffs": "dome", "lantern": "dome",
                 "staff_cap": "dome", "boot_L": "boot", "boot_R": "boot", "mitt_L": "boot", "mitt_R": "boot",
                 "forearms": "boot"},
    "aubade": {"cloak": "cloak", "sleeves": "cloak", "mitt_L": "cloak", "mitt_R": "cloak", "legs": "cloak",
               "hood": "hood", "cowl": "cowl", "tabard": "tabard", "belt": "tabard", "forearms": "tabard",
               "pauldron_R": "chalk", "pauldron_L": "chalk", "crown": "chalk", "hood_rim": "chalk",
               "lantern_roof": "chalk", "lantern": "chalk", "staff_cap": "chalk", "boot_L": "boot", "boot_R": "boot"},
}
CYL = {"cloak": 0.36, "mantle": 0.40, "hood": 0.19, "collar": 0.21, "cowl": 0.21, "legs": 0.07}   # cylindrical maps


def _blur2(img, s):
    return project.blur(img[..., None].astype(np.float32), s)[..., 0] if img.ndim == 2 else project.blur(img, s)


def load_swatches(spec, cfg):
    """per material: (fine strokes, painted brush/fold light) luminance ratios of the concept's paint, and px/m"""
    cache = os.path.join(scene.CACHE_DIR, "concept")
    plates = project.Plates(cache, cfg["concept"], cfg["height"])
    out = {}
    for key, (side, x0, x1, z0, z1) in SWATCH[spec.faction].items():
        xs, ys = plates.to_px(side, np.array([x0, x1]), np.array([z1, z0]))
        c0, c1 = int(min(xs)), int(max(xs))
        r0, r1 = int(ys[0]), int(ys[1])
        img = plates.img[side][r0:r1, c0:c1]
        L = project._lin(np.clip(img, 0, 1)) @ LUMA + 2e-3
        b1, b3, b6, b14 = (_blur2(L, s) for s in (1.0, 3.0, 6.0, 14.0))
        fine = seamless(np.clip(b1 / b6, 0.70, 1.36))
        brush = seamless(np.clip(b3 / b14, 0.78, 1.26))
        out[key] = (fine / np.median(fine), brush / np.median(brush), plates.ppm(side))
    return out


def seamless(a):
    """a swatch made tileable: blended with its half-shifted copy under a window that fades to the edges"""
    H, W = a.shape
    w = (np.sin(np.pi * (np.arange(H) + 0.5) / H)[:, None] * np.sin(np.pi * (np.arange(W) + 0.5) / W)[None]) ** 2
    b = np.roll(np.roll(a, H // 2, 0), W // 2, 1)
    wb = np.roll(np.roll(w, H // 2, 0), W // 2, 1)
    return (a * w + b * wb) / (w + wb + 1e-6)


def swatch_detail(sw, name, p, n):
    """(fine, brush) per texel from the part's swatch: cylindrical about Z for bell / drum parts, triplanar
    (by the dominant normal axis) for the rest; seamless wrap tiling, 1:1 in metres"""
    fine, brush, ppm = sw
    H, W = fine.shape

    def look(u, v):
        x = np.mod(np.round(u * ppm).astype(np.int64), W)
        y = np.mod(np.round(-v * ppm).astype(np.int64), H)
        return fine[y, x], brush[y, x]
    if name in CYL:
        return look(ang(p) * CYL[name], p[:, 2])
    w = np.abs(n) ** 4
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    fx, bx = look(p[:, 1], p[:, 2])
    fy, by = look(p[:, 0], p[:, 2])
    fz, bz = look(p[:, 0], p[:, 1])
    return fx * w[:, 0] + fy * w[:, 1] + fz * w[:, 2], bx * w[:, 0] + by * w[:, 1] + bz * w[:, 2]


# (r6, review r4: "apply the glimwick detail transfer") the Serenade capelet joins them: the back plate shows it whole
# (its painted folds, the dip and the turned edge); the outlier mask of the detail ratio keeps neighbours off it
PROJ_PARTS = {"aubade": ("cloak", "tabard"), "serenade": ("cloak", "tabard", "mantle")}
# the front/back projection registers on these (big, plain areas); elsewhere
# it landed neighbouring features (ghost bosses and band stripes on the mantle, the rim's shadow blotching the
# hood): swatch brushwork only
AO_SKIP = ("sleeves", "forearms", "cuffs", "mitt_L", "mitt_R", "staff", "staff_cap", "lantern", "lantern_collar",
           "lantern_roof", "lantern_resin", "lantern_bezel",
           "hood_in")


def contact_ao(obj, P, N, part, names, cell=0.016, nray=28, dist=0.30, log=print):
    """occlusion BETWEEN parts on the assembled rest mesh (the bake explodes the parts apart, so a mantle never
    shadowed the coat under it): rays from every 1.6 cm surface cell, the arms and the staff left out (they move);
    up-facing rays weigh more (a painted top light). Returns (size, size) 0..1 (1 = open)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    me = obj.data
    pop = project.poly_parts(me, "vale_part")
    skip = {i for i, nm in enumerate(names) if nm in AO_SKIP}
    polys = [tuple(pp.vertices) for i, pp in enumerate(me.polygons) if int(pop[i]) not in skip]
    bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], polys)
    have = part >= 0
    p, nn = P[have], N[have]
    key = np.floor(p / cell).astype(np.int64)
    key = (key[:, 0] + 512) * 1048576 + (key[:, 1] + 512) * 1024 + (key[:, 2] + 512)
    uq, inv = np.unique(key, return_inverse=True)
    cnt = np.bincount(inv)
    Pm = np.stack([np.bincount(inv, p[:, i]) for i in range(3)], 1) / cnt[:, None]
    Nm = np.stack([np.bincount(inv, nn[:, i]) for i in range(3)], 1)
    Nm /= np.maximum(np.linalg.norm(Nm, axis=1, keepdims=True), 1e-9)
    k = np.arange(nray) + 0.5
    r = np.sqrt(k / nray)
    th = math.pi * (1 + 5 ** 0.5) * k
    loc = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - r * r)], 1)       # cosine-weighted hemisphere
    ao = np.ones(len(uq))
    for i in range(len(uq)):
        fr = sdf.frame(Nm[i])
        D = loc @ fr
        o = Vector(Pm[i] + Nm[i] * 0.008)
        occ = tot = 0.0
        for d in D:
            w = 0.55 + 0.45 * max(d[2], 0.0)
            tot += w
            hit = bvh.ray_cast(o, Vector(d), dist)
            if hit[0] is not None:
                occ += w * (1.0 - hit[3] / dist) ** 0.6
        ao[i] = 1.0 - occ / tot
    # a soft painted shadow, never speckle: a 3D low-pass over the cells (the 28-ray estimate is noisy per cell)
    ao = np.clip(lowpass3d(Pm, ao, 0.028, passes=1), 0.0, 1.0)
    out = np.ones(part.shape)
    out[have] = ao[inv]
    log(f"brightwick: contact AO on {len(uq)} cells")
    return out


DET = {"cloth": 0.72, "cloth2": 0.70, "under": 0.45, "chalk": 0.50}      # the detail transfer's strength per role


def apply_concept(col, pc, w, P, N, role, sw=None):
    """lay the concept over the painted base where the plate sees the texel: THE GLIMWICK DETAIL TRANSFER (r6;
    wick_common.detail_ratio: the concept's brush strokes, fold light and felt / linen texture as a luminance ratio
    against its own 4.5 cm 3D low-pass, clamped 0.66-1.40, its warm / cool strokes as a chroma ratio, texels off the
    part's own value and up-facing tops left out) at DET[role]; the texels the plate never sees take the concept's
    brushwork from the material's swatch"""
    k1, k2, k3 = KCON.get(role, (0.6, 0.4, 0.3))
    if sw is not None:                       # the swatch's brushwork, gentle (its pixel grain is not paint)
        sw = (1.0 + 0.75 * (sw[0] - 1.0), sw[1])

    def swatch_only(col):
        if sw is not None:
            fine, brush = sw
            col = col * ((1 + k1 * (fine - 1)) * (1 + 0.9 * k2 * (brush - 1)))[:, None]
        return col, 0.0
    ww = smooth(0.30, 0.75, w)
    if (ww > 0.01).any():                    # soft projection edges: never a stair-stepped seam
        ww = np.clip(lowpass3d(P, ww, 0.016, passes=1), 0.0, 1.0)
    keep = ww > 0.5
    if keep.sum() < 40:
        return swatch_only(col)
    Lp = pc @ LUMA + 2e-3
    LPs = lowpass3d(P, Lp, 0.018, keep)
    # consistency: where the plate paints a value or hue far from this part's own typical paint, the plate shows
    # ANOTHER material there (a misregistered neighbour: an iron dome over the mantle, a glow): drop it
    med = float(np.median(LPs[keep]))
    chs = pc / Lp[:, None]
    chm = np.median(chs[keep], axis=0)
    off = np.abs(np.log(np.maximum(LPs, 1e-4) / max(med, 1e-4))) + 1.5 * np.abs(chs - chm[None]).max(1)
    ww = ww * smooth(0.75, 0.45, off)
    keep = ww > 0.5
    if keep.sum() < 40:
        return swatch_only(col)
    lum, cr, wd = wc.detail_ratio(pc, P, N, keep=keep, cell=0.045)
    det = DET.get(role, 0.55) * ww * wd
    seen = 1.0 + det * lum
    if sw is not None:                                         # unseen texels: the swatch's brushwork
        fine, brush = sw
        unseen = (1 + k1 * (fine - 1)) * (1 + 0.9 * k2 * (brush - 1))
        f = seen * ww + unseen * (1 - ww)
    else:
        f = seen
    col = col * f[:, None] * (1.0 + 0.7 * det[:, None] * cr)
    return col, float(keep.mean())


def _armature_of(obj):
    for m in obj.modifiers:
        if m.type == "ARMATURE" and m.object is not None:
            return m.object
    return obj.parent if obj.parent and obj.parent.type == "ARMATURE" else None


def posed_coords(obj, pose: dict) -> np.ndarray:
    """vertex positions of the skinned `obj` with its armature in `pose` (the armature is reset after)"""
    arm = _armature_of(obj)
    anim.apply_pose(arm, pose)
    dg = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    eo.to_mesh_clear()
    anim.apply_pose(arm, {})
    co = co.reshape(-1, 3)
    return co @ mw[:3, :3].T + mw[:3, 3]


def yawed(co: np.ndarray, deg: float) -> np.ndarray:
    a = math.radians(deg)
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    return co @ R.T


def vis_side(obj, plates, side, step=2, part_attr="vale_part"):
    """first-hit depth (y) and part id per `step`-th plate pixel, ray-cast along +Y (front) / -Y (back) against
    the mesh as it is now (posed)"""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    me = obj.data
    verts = [v.co.copy() for v in me.vertices]
    bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons])
    pop = project.poly_parts(me, part_attr)
    co = np.array([v[:] for v in verts])
    W, H = plates.size
    y0, d = (-50.0, Vector((0, 1, 0))) if side == "front" else (50.0, Vector((0, -1, 0)))
    gx = np.arange(0, W, step) + step * 0.5
    gy = np.arange(0, H, step) + step * 0.5
    dep = np.full((len(gy), len(gx)), np.nan, dtype=np.float32)
    pid = np.full((len(gy), len(gx)), -1, dtype=np.int16)
    x, _ = plates.to_world(side, gx, np.zeros_like(gx))
    xs = np.nonzero((x > co[:, 0].min() - 0.02) & (x < co[:, 0].max() + 0.02))[0]
    _, zz = plates.to_world(side, np.zeros_like(gy), gy)
    zs = np.nonzero((zz > co[:, 2].min() - 0.02) & (zz < co[:, 2].max() + 0.02))[0]
    for j in zs:
        zj = float(zz[j])
        for i in xs:
            hit = bvh.ray_cast(Vector((float(x[i]), y0, zj)), d)
            if hit[0] is not None:
                dep[j, i] = hit[0].y
                pid[j, i] = pop[hit[2]]
    return dep, pid


PROJ_SIDE = {"front": ("tabard",), "back": ("cloak", "mantle")}   # where each plate registers cleanly
PROJ_XMAX = {"front": 0.30, "back": 0.30}   # |x| window: outside it the concept paints arms, hands, the staff


def posed_projection(spec, obj, size, part_attr, cfg, log=print, names=None):
    """The graded concept plates projected onto the mesh in the concept's pose (paint pose; the front view
    turned by the concept's yaw): per texel the plate colour (linear) and a weight = it faces that plate x the
    plate sees it first x the plate pixels around it belong to the same part x inside the concept's figure."""
    cache = os.path.join(scene.CACHE_DIR, "concept")
    plates = project.Plates(cache, cfg["concept"], cfg["height"])
    mask = project.load_rgb(os.path.join(cache, f"{cfg['concept']}_mask.png"))[..., 0] > 0.5
    for _ in range(4):                                       # erode: the figure's edge pixels are anti-aliased
        mask = mask & np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1)
    me = obj.data
    rest = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", rest)
    posed = posed_coords(obj, paint_pose(spec))
    mwi = np.linalg.inv(np.array(obj.matrix_world))

    def set_co(world):
        loc = world @ mwi[:3, :3].T + mwi[:3, 3]
        me.vertices.foreach_set("co", loc.astype(np.float32).ravel())
        me.update()
    acc = np.zeros((size, size, 3))
    wsum = np.zeros((size, size))
    wmax = np.zeros((size, size))
    yaw = spec.F["paint"]["yaw"]
    try:
        for side, co in (("front", yawed(posed, yaw)), ("back", posed)):
            set_co(co)
            mp = project.rasterize(obj, size, part_attr)
            dep, pid = vis_side(obj, plates, side, 2, part_attr)
            have = mp["part"] >= 0
            p = mp["P"][have].astype(np.float64)
            nn = mp["N"][have].astype(np.float64)
            k = mp["part"][have].astype(np.int64)
            px, py = plates.to_px(side, p[:, 0], p[:, 2])
            c = project.bilinear(plates.img[side], px, py)
            hh, wd = dep.shape
            j = np.clip((py / 2).astype(np.int64), 0, hh - 1)
            i = np.clip((px / 2).astype(np.int64), 0, wd - 1)
            d = dep[j, i]
            if side == "front":
                vis = p[:, 1] <= np.nan_to_num(d, nan=1e9) + 0.015
                face = -nn[:, 1]
            else:
                vis = p[:, 1] >= np.nan_to_num(d, nan=-1e9) - 0.015
                face = nn[:, 1]
            same = pid[j, i] == k
            for dj, di in ((4, 0), (-4, 0), (0, 4), (0, -4)):
                same &= pid[np.clip(j + dj, 0, hh - 1), np.clip(i + di, 0, wd - 1)] == k
            Hm, Wm = mask.shape
            inside = mask[np.clip(py.astype(np.int64), 0, Hm - 1), np.clip(px.astype(np.int64), 0, Wm - 1)]
            w = smooth(0.12, 0.50, face) * vis * same * inside
            if names is not None:
                ok_part = np.isin(np.array(names, dtype=object)[np.clip(k, 0, len(names) - 1)], PROJ_SIDE[side])
                w = w * ok_part * smooth(PROJ_XMAX[side], PROJ_XMAX[side] - 0.04, np.abs(p[:, 0]))
            acc[have] += project._lin(np.clip(c, 0, 1)) * w[:, None]
            wsum[have] += w
            wmax[have] = np.maximum(wmax[have], w)
            log(f"brightwick: {side} plate covers {100.0 * (w > 0.5).mean():.0f} % of the texels")
    finally:
        me.vertices.foreach_set("co", rest)
        me.update()
    proj = acc / np.maximum(wsum, 1e-6)[..., None]
    dbg = os.path.join(scene.CACHE_DIR, "brightwick_paint")              # review maps (not shipped)
    os.makedirs(dbg, exist_ok=True)
    project.save_rgb(np.clip(project._srgb(proj), 0, 1) * wmax[..., None], os.path.join(dbg, f"{spec.ID}_proj.png"))
    return proj, wmax


# the form's own value structure, per material (fix round 3: "chalk, stone, cloth and wood all render as the same
# soft matte clay"): carved edges and fold crests catch a worn edge LIGHT, seams and creases sink into CAVITY
CAV = {"chalk": (0.26, 0.20), "stone": (0.24, 0.18), "ironstone": (0.28, 0.22), "leather": (0.22, 0.14),
       "wood": (0.24, 0.16), "wood_dark": (0.24, 0.16), "cloth": (0.20, 0.08), "cloth2": (0.20, 0.08),
       "under": (0.14, 0.04), "lampresin": (0.12, 0.10)}       # role -> (cavity contrast, edge light)


def cavity(P, N, cell=0.022):
    """how far each texel's surface point stands out of its 3D neighbourhood along its normal (the low-pass mean
    of the part's surface): + carved edges, rims and fold crests, - seams, creases and fold valleys; -1..1"""
    Pd = np.asarray(P, dtype=np.float64)
    if len(Pd) < 60:
        return np.zeros(len(Pd))
    lp = np.stack([lowpass3d(Pd, Pd[:, i], cell, passes=1) for i in range(3)], 1)
    c = ((Pd - lp) * np.asarray(N, dtype=np.float64)).sum(1) / 0.005
    return np.tanh(c - float(np.median(c)))


def paint_hybrid(spec, obj, size, names, part_attr="vale_part", log=print, cfg=None):
    maps = project.rasterize(obj, size, part_attr)
    P, N, part = maps["P"].astype(np.float64), maps["N"].astype(np.float64), maps["part"]
    mw = np.array(obj.matrix_world)
    if not np.allclose(mw, np.eye(4), atol=1e-6):
        P = P @ mw[:3, :3].T + mw[:3, 3]
        N = N @ np.linalg.inv(mw[:3, :3])
    proj = wproj = None
    sws = {}
    if cfg is not None:
        try:
            proj, wproj = posed_projection(spec, obj, size, part_attr, cfg, log, names=names)
            sws = load_swatches(spec, cfg)
        except Exception as e:                    # never ship a crash for a paint layer: log it loudly
            log(f"WARNING brightwick: concept projection failed ({e!r}); painted base only")
    cao = contact_ao(obj, P, N, part, names, log=log)
    out = np.zeros((size, size, 3), dtype=np.float32)
    inkm = np.zeros((size, size), dtype=np.float32)           # the hollow's ink texels (the ORM hook darkens them)
    shares = {}
    for k in np.unique(part[part >= 0]):
        name = names[int(k)]
        role, grid = spec.parts_info.get(name, ("cloth", None))
        sel = part == k
        p, n = P[sel], N[sel]
        if grid is not None:
            p2, g, lap, occ = surface_fields(grid, p, n)
            # (fix pass 5) the finite-difference Laplacian of the trilinear SDF grid steps at every voxel layer:
            # on the smooth felt dome / mantle the fold paint drew those layers as horizontal strata. Low-pass it
            lap = lowpass3d(p2, lap, 0.014, passes=2)
            occ = lowpass3d(p2, occ, 0.010, passes=1)
        else:
            p2, g, lap, occ = p, n, np.zeros(len(p)), np.zeros(len(p))
        col = paint_part(spec, name, role, p2, g, lap, occ)
        damp = spec.sw_damp if getattr(spec, "sw_damp", None) is not None and len(spec.sw_damp) == len(p) else None
        kc, ke = CAV.get(role, (0.0, 0.0))
        if name in ("crown",) and spec.faction == "aubade":
            ke = ke * 0.4                    # (r6) the circlet's spire towers: no bright worn tips (the hood top quarter)
        if kc > 0:
            cv = cavity(p2, g)
            if name == "hood":                      # the hollow is ink: its walls carry no carving
                cv = cv * (tomb_of(spec.F).d(p) > 0.02)
            col = col * (1.0 + kc * np.minimum(cv, 0.0) + 0.5 * kc * np.maximum(cv, 0.0))[:, None]
            edge = ke * np.maximum(cv, 0.0) ** 1.5 * smooth(-0.3, 0.6, g[:, 2])      # worn, lit from above
            col = col + (col @ LUMA)[:, None] * edge[:, None] * np.array((1.06, 1.0, 0.92))[None]
        if name in ("hood", "hood_rim", "cowl", "collar", "cloak"):   # (the rim's inner wall, the cowl / collar cut faces and the coat's top cap under
            # the Aubade hood are the hollow's floor: seen through the arch they read as a lit shelf / tongue)
            col, ins = ink_hollow(spec, p, n, col, with_mask=True)
            inkm[sel] = ins
        if role != "ink":                                                    # contact shadow between parts
            lo_ = 0.62 if name in ("hood", "hood_cap") else 0.22   # (the hood's decimated low dips into the collar: no dark slivers)
            col = col * (lo_ + (1 - lo_) * cao[sel] ** 1.6)[:, None]
        if proj is not None and role != "ink":
            key = SWATCH_OF[spec.faction].get(name)     # the concept's brushwork on every painted part
            sw = swatch_detail(sws[key], name, p, n) if key in sws else None
            if sw is not None and damp is not None:     # clean painted ribbons take no swatch strokes
                sw = (1.0 + (sw[0] - 1.0) * (1.0 - 0.9 * damp), 1.0 + (sw[1] - 1.0) * (1.0 - 0.9 * damp))
            wp = wproj[sel] if name in PROJ_PARTS.get(spec.faction, ()) else np.zeros(int(sel.sum()))
            if name == "tabard":           # the concept's cowl / mantle edge sits over the stole's top: no squiggles
                wp = wp * (1 - smooth(1.02, 1.07, p[:, 2]))
            col, sh = apply_concept(col, proj[sel], wp, p2, g, role, sw)
            shares[name] = round(sh, 2)
        out[sel] = col
    if proj is not None:
        dbg = os.path.join(scene.CACHE_DIR, "brightwick_paint")
        project.save_rgb(np.clip(project._srgb(np.clip(out, 0, 1)), 0, 1), os.path.join(dbg, f"{spec.ID}_paint.png"))
    iy, ix = project.nearest_index(part >= 0)
    out = out[iy, ix]
    fm = floor_uv_mask(spec, obj, names, size, part_attr)
    if fm is not None:
        # (r7) the hollow floor's sliver triangles and the texels round them: ink (base) + the ORM's matte occluded ink
        out[fm] = lin(spec.PALETTE.get("ink", "#15171B")).astype(np.float32)[None]
        inkm[fm] = 1.0
        log(f"brightwick: hollow floor ink on {int(fm.sum())} texels")
    log(f"brightwick: painted from the sculpt + the concept ({len(shares)} parts; concept share {shares})")
    spec.paint_shares = shares
    spec.ink_map = inkm
    img = project._srgb(np.clip(out, 0, 1)).astype(np.float32)
    if spec.faction == "serenade":
        # (r6, review r4: the reserved marigold band: 16-26 % of the body in game near the enemy hue) no texel in
        # the 25-50 deg band above 0.38 HSV saturation, value kept; the lampresin rims keep theirs (brief <= 4 %)
        part_n = part[iy, ix]
        resin = np.isin(part_n, [i for i, nm in enumerate(names)
                                 if spec.parts_info.get(nm, ("cloth", None))[0] == "lampresin"])
        flat = img.reshape(-1, 3)
        # (sat 0.34, the band from 24 deg with a 4 deg feather: the lossy WebP and the warm painted shade push texels a
        # few points back up, so the clamp keeps a margin under the brief's 0.40)
        y0 = project._lin(np.clip(flat, 0, 1)) @ LUMA
        flat, frac = wc.clamp_reserved(flat, resin.reshape(-1), hue=(24.0, 50.0), sat_max=0.34, feather=4.0)
        # the clamp keeps HSV value, so a desaturated umber came out ~3 L* LIGHTER (the feet band lost its dark): the
        # texel's luminance is restored (linear), only its saturation drops
        lin_ = project._lin(np.clip(flat, 0, 1))
        k_ = y0 / np.maximum(lin_ @ LUMA, 1e-6)
        flat = project._srgb(np.clip(lin_ * np.clip(k_, 0.5, 1.0)[:, None], 0, 1))
        img = flat.reshape(img.shape).astype(np.float32)
        log(f"brightwick: reserved-band clamp on {100 * frac:.1f} % of texels")
    return img, maps


# ── motion ───────────────────────────────────────────────────────────────────────────────────────────
def hold(rel, staff, pole_r=(-0.9, 0.3, -0.4), pole_l=(0.9, 0.2, -0.5), grip=GRIP_L) -> dict:
    """both fists on the staff: the right wrist at `rel` (arm lengths from the posed right shoulder, chest
    frame), the staff pointing along `staff` (character space: +X left, -Y front, +Z up), the left fist
    `grip` m up the staff"""
    return {"ik": {"hand.R": HandTarget(rel=tuple(rel), pole=tuple(pole_r)), "aim.R": Aim(tuple(staff)),
                   "hand.L": HandTarget(to_prop=("prop.R", grip), pole=tuple(pole_l))}}


def stance_feet(kx=0.03):
    return anim.feet(l=(kx, -0.02, 0.0), r=(-kx, 0.03, 0.0), yl=8, yr=-8)


GUARD_R = (0.06, -0.50, -0.72)          # right wrist: low in front of the right hip
GUARD_STAFF = (0.82, -0.08, 0.57)       # staff diagonal: lantern up on the wick's left, a little forward and well
# out to the side (seen from a back three-quarter it stands clear of the hood, never on its axis)


def guard_pose() -> dict:
    base = anim.P(hips=(2, 0, 0), spine=(2, 0, 0), chest=(2, 0, 0), neck=(-2, 0, 0), head=(-2, 0, 0))
    p = anim.merge(anim.arms_relaxed(), base, {"hips_loc": (0.0, 0.01, -0.035), "ik": stance_feet()},
                   hold(GUARD_R, GUARD_STAFF))
    return p


def paint_pose(spec) -> dict:
    """the concept's hold (the fit check, the Aubade staff-head bend): absolute right wrist, staff dir"""
    pp = spec.F["paint"]
    p = anim.merge(anim.arms_relaxed(), {"ik": {
        "hand.R": HandTarget(pos=tuple(pp["wrist_R"]), pole=tuple(pp["pole_R"])),
        "aim.R": Aim(tuple(pp["staff"])),
        "hand.L": HandTarget(to_prop=("prop.R", GRIP_L), pole=tuple(pp["pole_L"]))}})
    return p


def hemmed(pose: dict, k: float = 0.7, extra=(0.0, 0.0, 0.0)) -> dict:
    """key x_hem_1 (the lower bell) to follow the hips' turn and lean (k of the hips' euler) + `extra` (deg)"""
    p = dict(pose)
    h = p.get("hips", (0.0, 0.0, 0.0))
    p[HEM] = tuple(k * c + e for c, e in zip(h, extra))
    return p


def hem_clip(fn, k=0.7):
    return lambda t: hemmed(fn(t), k)


def clips(spec, skel, ctx=None) -> dict:
    out = {}
    g = guard_pose()

    # IDLE (90 f): a slow heavy breath (chest and shoulders rise, the hips settle), the staff swaying a little on
    # its diagonal, the hood turning to scan the lane once, the crown level, and a half-step settle per loop
    N = 90

    def idle(t):
        b = anim.osc(t, 2)                                   # breath, twice per loop
        s = anim.osc(t, 1, 0.1)
        scan = math.sin(2 * math.pi * (t - 0.15)) * smooth(0.0, 0.25, math.sin(math.pi * t) ** 2)
        d = anim.P(chest=(2.6 * b, 0, 0), spine=(1.2 * b, 1.5 * s, 0.6 * s), neck=(-1.8 * b, 3.0 * scan, 0),
                   head=(-1.0 * b, 9.0 * scan, 0), hips=(0.4 * b, -1.0 * s, -0.8 * s),
                   shoulder_L=(0, 0, 1.6 * b), shoulder_R=(0, 0, -1.6 * b))
        p = anim.add(g, d)
        u = max(0.0, math.sin(2 * math.pi * t))
        lift = 0.035 * max(0.0, math.sin(4 * math.pi * t)) if t < 0.5 else 0.0
        ik = dict(p["ik"])
        ik["foot.R"] = FootTarget((-0.03 - 0.03 * u, 0.03, lift), 0.0, -8 - 5 * u)
        ik["hand.R"] = HandTarget(rel=(GUARD_R[0], GUARD_R[1], GUARD_R[2] + 0.02 * b), pole=(-0.9, 0.3, -0.4))
        sw = 0.05 * anim.osc(t, 1, 0.3)
        ik["aim.R"] = Aim((GUARD_STAFF[0] - sw, GUARD_STAFF[1] - 0.6 * sw, GUARD_STAFF[2] + 0.4 * sw))
        p["ik"] = ik
        return hemmed(anim._with_hips(p, (0.008 * s, 0.0, -0.014 * (0.5 + 0.5 * b))), 0.6)
    out["idle"] = anim.Clip("idle", N, True, anim.drag(idle, N, {"head": 2.5, "neck": 1.5}, loop=True))

    # RUN: a long, heavy rolling stride at 3.3 m/s (planted foot exact), the staff steady on the diagonal
    out["run"] = run_clip(spec, skel, g)

    # ATTACK1 (30 f, impact at 40 % = the 0.4 s windup): a crouch with the hood dipping, the staff swung up over
    # the LEFT shoulder (the lantern high and well off the hood's axis), then slammed down in front (the lantern on
    # the ground ~1.2 m out, the body bent over it), an impact hold, a lift and a recovery to the diagonal by way of
    # a raised staff (never swung out level)
    fn = anim.keyed(attack_keys(g))
    objs = []
    out["attack1"] = anim.Clip("attack1", 30, False, hem_clip(anim.drag(fn, 30, {"head": 1.5, "neck": 1.0}), 0.75),
                               impact=anim.IMPACT)
    if ctx is not None:
        objs = [o for o in (bpy.data.objects.get(spec.ID), bpy.data.objects.get(f"{spec.ID}_accent")) if o is not None]
        # the lantern lands ON the ground at the impact, never through it (the staff turns up about the fists)
        out["attack1"] = ground_solve(out["attack1"], ctx.info.armature, objs, body=False)

    # DEATH (48 f): recoil -> down on the right knee, leaning on the staff planted out to the side -> holds ->
    # the staff slides away and the wick folds forward onto its knees and down, the hood bowed to the ground, the
    # cloak PILED under it (x_hem_1 keeps the hem on the ground), the staff lying beside it; ground-solved
    death = death_clip(spec, skel, g)
    if objs:
        death = ground_solve(death, ctx.info.armature, objs)
    out["death"] = death
    # the rest of the required set (CONTRACT §12) the renderer never plays for a minion (the crowd plays idle,
    # run, attack1 and death): STATIC guard-pose stand-ins at the shortest legal length (0.2 s; strikes 10 frames
    # for the 40 % impact rule) - constant channels collapse to two keys in the optimizer (fix pass 5: the old
    # moving stand-ins cost ~60 KB of the GLB for clips nobody sees)
    still = hemmed(g)
    for name in ("attack2", "cast_a1", "cast_a2", "cast_a3", "cast_ult"):
        out[name] = anim.Clip(name, 10, False, lambda t: still, impact=anim.IMPACT)
    for name in ("recall", "idle_lobby", "channel", "stunned", "victory", "dash"):
        out[name] = anim.Clip(name, 6, name != "victory" and name != "dash", lambda t: still)
    return out


def attack_keys(g) -> list:
    dip = anim.merge(g, anim.P(hips=(7, 0, 0), spine=(5, 0, 0), chest=(5, 0, 0), neck=(4, 0, 0), head=(12, 0, 0)),
                     {"hips_loc": (0.0, 0.0, -0.05)},
                     hold((GUARD_R[0], GUARD_R[1] + 0.04, GUARD_R[2] - 0.02), (0.74, -0.30, 0.60)))
    wind = anim.merge(g, anim.P(hips=(-6, 10, 0), spine=(-8, 8, 0), chest=(-10, 6, 0), neck=(4, -4, 0),
                                head=(6, -6, 0)),
                      {"hips_loc": (0.0, 0.045, 0.0)},
                      hold((0.30, -0.24, 0.26), (0.80, 0.22, 0.56), pole_r=(-0.9, 0.1, -0.2), pole_l=(0.9, 0.1, -0.1),
                           grip=0.48))
    coil = anim.merge(wind, anim.P(hips=(-7, 12, 0), spine=(-10, 9, 0), chest=(-12, 7, 0)),
                      hold((0.31, -0.20, 0.30), (0.78, 0.30, 0.55), pole_r=(-0.9, 0.1, -0.2), pole_l=(0.9, 0.1, -0.1),
                           grip=0.48))
    hit = anim.merge(g, anim.P(hips=(16, -4, 0), spine=(13, -4, 0), chest=(11, -4, 0), neck=(-8, 2, 0),
                               head=(-12, 2, 0)),
                     {"hips_loc": (0.0, -0.09, -0.085)},
                     hold((0.20, -0.86, -0.32), (0.16, -0.86, -0.48), pole_r=(-0.8, 0.3, -0.5), pole_l=(0.9, 0.3, -0.4),
                          grip=0.42))
    hit["ik"].update(anim.feet(l=(0.03, -0.17, 0.0), r=(-0.03, 0.06, 0.0), yl=6, yr=-8))
    drive = anim.lerp_pose_w(coil, hit, 0.35, {"hips": 0.7, "spine": 0.55, "chest": 0.4, "hips_loc": 0.6})
    hold_ = anim._with_hips(anim.merge(hit, hold((0.21, -0.86, -0.36), (0.16, -0.86, -0.52), pole_r=(-0.8, 0.3, -0.5),
                                                 pole_l=(0.9, 0.3, -0.4), grip=0.42)), (0.0, 0.0, -0.012))
    lift = anim.merge(hit, anim.P(hips=(10, -3, 0), spine=(8, -3, 0), chest=(6, -3, 0), head=(-6, 1, 0)),
                      {"hips_loc": (0.0, -0.06, -0.06)},
                      hold((0.18, -0.80, -0.20), (0.24, -0.84, -0.30), pole_r=(-0.8, 0.3, -0.5), pole_l=(0.9, 0.3, -0.4),
                           grip=0.45))
    # the recovery swings the lantern UP out of the ground (never out level like a spear thrust), then settles
    rise = anim.merge(g, anim.P(hips=(6, -2, 0), spine=(4, -1, 0), chest=(2, 0, 0), head=(-3, 0, 0)),
                      {"hips_loc": (0.0, -0.04, -0.05)},
                      hold((0.12, -0.70, -0.42), (0.50, -0.56, 0.66), grip=0.52))
    rec = anim.merge(g, anim.P(hips=(4, -1, 0), spine=(3, 0, 0), chest=(3, 0, 0)), {"hips_loc": (0.0, -0.02, -0.04)},
                     hold((0.10, -0.62, -0.52), (0.62, -0.40, 0.68), grip=GRIP_L))
    return [(0.0, g, "linear"), (0.12, dip, "inout"), (0.27, wind, "inout"), (0.33, coil, "out"), (0.365, drive, "in"),
            (anim.IMPACT, hit, "accel"), (0.47, hold_, "out"), (0.58, lift, "inout"), (0.68, rise, "out"),
            (0.82, rec, "inout"), (1.0, g, "settle")]


def _with_aim(pose: dict, d) -> dict:
    p = dict(pose)
    p["ik"] = dict(p.get("ik", {}))
    p["ik"]["aim.R"] = Aim(tuple(d))
    return p


RUN_FRAMES, RUN_CONTACT = 18, 0.30      # 0.6 s cycle: 3.3 steps/s of 0.99 m (a long heavy stride, not a scurry)


def run_clip(spec, skel, g) -> anim.Clip:
    prof = spec.MOTION
    v = prof["run_ref_speed"]
    leg = spec.PROPORTIONS["leg"]
    ks = leg / 0.86 * 0.85                                     # gen_run's swing (0.86 m leg), kept low under the bell
    c = RUN_CONTACT
    N = RUN_FRAMES
    T = N / anim.FPS
    Ls = v * c * T
    swing = [(0.00, Ls / 2, 0.0, -24.0), (0.18, Ls / 2 + 0.05 * ks, 0.15 * ks, -40.0), (0.42, 0.04 * ks, 0.22 * ks, -22.0),
             (0.66, -Ls / 2 - 0.05 * ks, 0.14 * ks, -2.0), (0.86, -Ls / 2 - 0.02 * ks, 0.05 * ks, 8.0), (1.00, -Ls / 2, 0.0, 6.0)]

    def swing_at(s):
        for i in range(1, len(swing)):
            if s <= swing[i][0]:
                a, b = swing[i - 1], swing[i]
                uu = anim.sine((s - a[0]) / (b[0] - a[0]))
                return tuple(a[k] + (b[k] - a[k]) * uu for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        q %= 1.0
        if q < c:
            uu = q / c
            y = -Ls / 2 + Ls * uu
            pitch = 5.0 * (1 - anim.sine(min(1.0, uu / 0.25))) - 14.0 * max(0.0, (uu - 0.82) / 0.18) ** 1.6
            return (0.0, y, 0.0), pitch
        dy, dz, pitch = swing_at((q - c) / (1 - c))
        return (0.0, dy, dz), pitch

    # heavy: the weight drops hard on each contact (a deep double bob), a rolling side-to-side sway and turn, a
    # forward lean; the hood stays level (the neck counters the lean and the roll)
    bob, drop, lean = 0.045, 0.085, 12.0

    def sample(t):
        q = t % 1.0
        fl, pl = foot_at(q)
        fr, pr = foot_at(q + 0.5)
        z = -drop - bob * math.cos(2 * math.pi * (2 * q - c)) * 0.5 - bob * 0.5
        x = 0.028 * math.cos(2 * math.pi * (q - c / 2))
        yaw = -10.0 * math.cos(2 * math.pi * q)
        roll = 7.0 * math.sin(2 * math.pi * (q - c / 2))
        p = anim.merge(anim.arms_relaxed(), anim.P(
            hips=(lean * 0.5, yaw, roll), spine=(lean * 0.3, -yaw * 0.5, -roll * 0.6),
            chest=(lean * 0.2 + 2.5 * math.cos(4 * math.pi * q), -yaw * 0.4, -roll * 0.3),
            neck=(-lean * 0.5, 0, 0), head=(-lean * 0.45, 0, -roll * 0.3)))
        bz = 0.022 * math.cos(4 * math.pi * (q - 0.08))
        p = anim.merge(p, hold((GUARD_R[0], GUARD_R[1] - 0.04, GUARD_R[2] + bz), (0.77, -0.13, 0.63)))
        p["ik"]["foot.L"] = FootTarget((0.012 + fl[0], fl[1] - 0.02, fl[2]), pl, -3, 0, 0)
        p["ik"]["foot.R"] = FootTarget((-0.012 + fr[0], fr[1] - 0.02, fr[2]), pr, 3, 0, 0)
        p["hips_loc"] = (x, 0.02, z)
        return hemmed(p, 0.75)
    return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3),
                                                     "cycle_s": round(T, 3)})


DEATH_ROLL = -1.0           # sign of the hips' third Euler that tips the wick toward its LEFT (pose proto)
HEM_LOC = "hem_loc"         # pose key: x_hem_1's offset (armature metres; keyed by this module's write_action wrap)


def death_clip(spec, skel, g) -> anim.Clip:
    """recoil -> down on the right knee, leaning on the staff planted OUT TO THE SIDE and forward (the lantern
    far from the head axis in every view: never a spire over the hood) -> holds -> the staff slips out to the
    right and the wick SLIDES SIDEWAYS OFF IT (brief §3.4) and falls onto its LEFT SIDE: it ends lying on its
    side, knees drawn a little, the left arm out on the ground ahead, the right arm thrown over with its fist
    on the ground and the staff lying flat ahead, the hood and crown resting sideways on the ground (fix pass 5:
    the old end knelt with the hood bowed to the ground, a prostration, never a death). The lower bell rides
    x_hem_1, keyed to roll part way and shift with the body (`hem_loc`), so the coat folds at the waist and its
    hem settles on the ground instead of a rigid tube lying on its side."""
    N = 48
    hip_h = skel.rest_point("hips").z
    fk_arms = anim.arms_relaxed()
    rs = DEATH_ROLL
    recoil = anim.merge(g, anim.P(hips=(-5, 0, 4), spine=(-6, 0, 0), chest=(-8, 4, 0), neck=(-4, 0, 0), head=(-8, 0, 0)),
                        {"hips_loc": (0.0, 0.05, -0.02)})
    kneel = anim.merge(fk_arms, anim.P(hips=(5, 0, -5 * rs), spine=(6, 0, -5 * rs), chest=(6, 0, -3 * rs), neck=(4, 0, 0),
                                       head=(8, 0, 2 * rs),
                                       thigh_R=(14, 0, 4), shin_R=(-100, 0, 0), foot_R=(-10, 0, 0),
                                       thigh_L=(62, 0, -4), shin_L=(-72, 0, 0), foot_L=(0, 0, 0),
                                       upper_arm_L=(34, 0, -8), forearm_L=(34, 0, 0)),
                       {"ik": {"hand.R": HandTarget(rel=(-0.42, -0.28, -0.86), pole=(-0.9, 0.2, -0.3)),
                               "aim.R": Aim((-0.48, -0.46, 0.75))}})
    kneel["hips_loc"] = (-0.04, 0.0, -hip_h * 0.31)
    sag = anim.add(kneel, anim.P(spine=(6, 0, 0), chest=(6, 0, 0), head=(10, 0, 0)))
    sag["hips_loc"] = (-0.04, 0.0, -hip_h * 0.34)
    # the slip: the staff goes out from under it to the right, the body tips off it to its LEFT
    slip = anim.merge(fk_arms, anim.P(hips=(8, 0, 38 * rs), spine=(4, 0, 8 * rs), chest=(2, 0, 6 * rs),
                                      neck=(0, 0, 6 * rs), head=(2, 0, 8 * rs),
                                      thigh_R=(36, 0, 8), shin_R=(-104, 0, 0), foot_R=(-10, 0, 0),
                                      thigh_L=(50, 0, -8), shin_L=(-96, 0, 0), foot_L=(-10, 0, 0),
                                      upper_arm_L=(64, 0, -24), forearm_L=(30, 0, 0)),
                      {"ik": {"hand.R": HandTarget(rel=(-0.60, -0.40, -0.45), pole=(-0.9, 0.2, -0.4)),
                              "aim.R": Aim((-0.86, -0.36, 0.20))}})
    slip["hips_loc"] = (0.08, 0.0, -hip_h * 0.50)
    # down: lying on its left side
    fx, fy = DEATH_FIST
    down = anim.merge(fk_arms, anim.P(hips=(DEATH_PITCH, 0, DEATH_ROLL_DEG * rs), spine=(4, 0, 4 * rs),
                                      chest=(2, 0, 2 * rs), neck=(-4, 0, DEATH_HEAD * 0.45 * rs),
                                      head=(-6, 0, DEATH_HEAD * 0.55 * rs),
                                      thigh_R=(52, 0, 6), shin_R=(-74, 0, 0), foot_R=(-10, 0, 0),
                                      thigh_L=(40, 0, -6), shin_L=(-62, 0, 0), foot_L=(-10, 0, 0)),
                      {"ik": {"hand.R": HandTarget(pos=(fx, fy, 0.07), pole=(0.2, -0.3, 1.0)),
                              "aim.R": Aim(DEATH_STAFF),
                              "hand.L": HandTarget(pos=DEATH_LFIST, pole=(0.3, 0.4, -1.0))}})
    down["hips_loc"] = (DEATH_HIPS[0], DEATH_HIPS[1], -(hip_h - DEATH_HIPS[2]))
    hem_rot, hem_loc = hem_lying(skel, (DEATH_HIPS[0], DEATH_HIPS[1], DEATH_HIPS[2]))
    down[HEM], down[HEM_LOC], down[HEM_SQ] = hem_rot, hem_loc, DEATH_SQ
    slip[HEM] = tuple(0.35 * a for a in hem_rot)
    slip[HEM_LOC] = tuple(0.35 * a for a in hem_loc)
    slip[HEM_SQ] = tuple(0.35 * a for a in DEATH_SQ)
    bounce = anim.add(down, anim.P(hips=(0, 0, -4 * rs), spine=(0, 0, -3 * rs), head=(0, 0, -6 * rs)))
    bounce["hips_loc"] = (DEATH_HIPS[0], DEATH_HIPS[1], -(hip_h - DEATH_HIPS[2]) + 0.03)
    rest = anim.add(down, anim.P(head=(2, 0, 2 * rs)))
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.30, kneel, "inout"), (0.46, sag, "inout"),
            (0.62, slip, "in"), (0.78, down, "in"), (0.85, bounce, "out"), (0.93, rest, "inout"), (1.0, rest, "linear")]
    fn = anim.keyed(keys)
    return anim.Clip("death", N, False, fn, meta={"settle": 0.78})


def hem_lying(skel, hips):
    """x_hem_1's rotation (bone euler, deg) and offset (armature m) that lay the lower bell along the drawn-up
    thighs of the wick lying on its LEFT side: the bone's +Y (rest: up the bell) points from the hem's centre to
    the hips, its +X (rest: the wick's left) points down into the ground"""
    from mathutils import Matrix
    hx, hy, hz = hips
    d = np.array((DEATH_LEG[0], DEATH_LEG[1], 0.0))
    d /= np.linalg.norm(d)
    c = np.array((hx, hy, 0.0)) + d * DEATH_LEG[2]
    c[2] = DEATH_LEG[3]
    Y = np.array((hx, hy, hz)) - c
    Y /= np.linalg.norm(Y)
    X = np.array((0.0, 0.0, -1.0))
    X = X - Y * (X @ Y)
    X /= np.linalg.norm(X)
    Z = np.cross(X, Y)
    Mw = np.stack([X, Y, Z], 1)
    R0 = np.array(skel.rest[HEM].to_3x3())
    B = R0.T @ Mw
    e = Matrix([list(r) for r in B]).to_euler("XYZ")
    head = np.array(skel.rest[HEM].translation)
    return tuple(math.degrees(a) for a in e), tuple(float(v) for v in (c - head))


# the death's end pose (tuned with the pose proto): hips pitch / roll (deg), extra head roll toward the ground,
# hips offset (x, y, final height), x_hem_1 roll (deg) + offset, right fist (x, y) on the ground, staff direction,
# left fist on the ground ahead
DEATH_PITCH, DEATH_ROLL_DEG, DEATH_HEAD = 14.0, 82.0, 26.0
DEATH_HIPS = (0.22, 0.02, 0.40)
# the lower bell lying: it follows the drawn-up thighs (from the hips toward the feet: forward and back toward the
# right), its hem's centre DEATH_LEG[2] m from the hips and DEATH_LEG[3] m high, FLATTENED (x_hem_1 scale: its
# local X, which lying on the left side points down, x (1 + DEATH_SQ[0]); spread front-back x (1 + DEATH_SQ[2])):
# the coat lies flat over the legs, never a barrel on its side
DEATH_LEG = (-0.74, -0.62, 0.38, 0.20)
DEATH_SQ = (-0.30, 0.0, 0.12)
HEM_SQ = "hem_sq"           # pose key: x_hem_1's scale - 1 (bone axes; 0 = rest)
DEATH_FIST = (0.62, -0.50)
DEATH_STAFF = (-0.40, -0.92, 0.0)
DEATH_LFIST = (1.02, -0.42, 0.06)


def ground_solve(clip: anim.Clip, arm, objs, exclude=("prop.R",), floor=0.0, log=print, body=True) -> anim.Clip:
    """Sample `clip`, pose the SKINNED mesh frame by frame and move the hips vertically so the lowest vertex of the
    body (not the held prop) touches `floor`: no foot, knee or cloak below the ground in any frame, no float.
    Logs the held prop's lowest point per frame (authored to stay above the ground)."""
    skel = anim.Skeleton(arm)
    N = clip.frames
    poses = [anim.resolve(skel, clip.sample(f / N)) for f in range(N + 1)]
    masks = []
    for o in objs:
        names = [gr.name for gr in o.vertex_groups]
        keep = np.ones(len(o.data.vertices), dtype=bool)
        for v in o.data.vertices:
            if v.groups:
                gmax = max(v.groups, key=lambda gg: gg.weight)
                keep[v.index] = names[gmax.group] not in exclude
        masks.append(keep)

    def lows(pose):
        anim.apply_pose(arm, pose)
        dg = bpy.context.evaluated_depsgraph_get()
        zb, zp = [], []
        for o, m in zip(objs, masks):
            e = o.evaluated_get(dg)
            me = e.to_mesh()
            co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(e.matrix_world)[:3, :3].T + np.array(e.matrix_world)[:3, 3]
            e.to_mesh_clear()
            if m.any():
                zb.append(co[m, 2].min())
            if (~m).any():
                zp.append(co[~m, 2].min())
        return min(zb), (min(zp) if zp else 0.0)
    dz = np.array([floor - lows(p)[0] for p in poses]) if body else np.zeros(len(poses))
    sm = np.convolve(np.pad(dz, 1, mode="edge"), [0.25, 0.5, 0.25], "valid")
    dz = np.maximum(sm, dz)                       # smoothed, never below the ground
    out = []
    for pose, d in zip(poses, dz):
        q = dict(pose)
        hx, hy, hz = q.get("hips_loc", (0.0, 0.0, 0.0))
        q["hips_loc"] = (hx, hy, hz + float(d))
        if HEM_LOC in q:                          # the lower bell moves with the body (the death's lying pose)
            ex, ey, ez = q[HEM_LOC]
            q[HEM_LOC] = (ex, ey, ez + float(d))
        out.append(q)
    settle = (clip.meta or {}).get("settle")
    settle_prop(skel, out, objs, int(round(settle * N)) if settle is not None else 10 * N, floor, log)
    check = [lows(p) for p in out]
    anim.apply_pose(arm, {})
    body_min = min(c[0] for c in check)
    prop_min = [round(c[1], 3) for c in check]
    log(f"[brightwick] {clip.name} ground solve: hips dz {dz.min():+.3f}..{dz.max():+.3f} m, body min z "
        f"{body_min:+.3f}, prop min z {min(prop_min):+.3f} (frames {[i for i, z in enumerate(prop_min) if z < -0.01]})")

    def sample(t):
        u = min(max(t, 0.0), 1.0) * N
        i = int(math.floor(u))
        if i >= N:
            return out[N]
        f = u - i
        return out[i] if f < 1e-6 else anim.lerp_pose(out[i], out[i + 1], f)
    meta = dict(clip.meta or {})
    meta["ground"] = {"body_min_z": round(float(body_min), 3), "prop_min_z": float(min(prop_min))}
    return anim.Clip(clip.name, N, clip.loop, sample, impact=clip.impact, meta=meta)


def settle_prop(skel, poses, objs, f_rest, floor=0.0, log=print, bone="prop.R"):
    """The held staff, rigid on prop.R, turned about the fist (a horizontal axis across the staff) so that its
    lowest vertex never goes below `floor` in any frame, and from frame `f_rest` on rests ON the floor (the
    dropped staff lies on the ground, its lantern visible). Ramped in over 6 frames; edits poses in place."""
    from mathutils import Matrix
    pts = []
    for o in objs:
        names = [gr.name for gr in o.vertex_groups]
        mw = np.array(o.matrix_world)
        for v in o.data.vertices:
            if v.groups and names[max(v.groups, key=lambda gg: gg.weight).group] == bone:
                pts.append(mw[:3, :3] @ np.array(v.co) + mw[:3, 3])
    if not pts:
        return
    R0 = np.array(skel.rest[bone].to_3x3())
    t0 = np.array(skel.rest[bone].translation)
    loc = (np.array(pts) - t0) @ R0                       # prop-local coordinates
    ths = np.radians(np.arange(-70.0, 70.5, 0.5))
    lift, rest = [], []
    for pose in poses:
        M = skel.fk(pose)
        R = np.array(M[bone].to_3x3())
        t = np.array(M[bone].translation)
        W = loc @ R.T
        k = np.cross(R[:, 1], (0.0, 0.0, 1.0))
        k = k / (np.linalg.norm(k) + 1e-9)
        mz = np.array([(W @ rodrigues(k, a).T)[:, 2].min() + t[2] for a in ths])
        ok = mz >= floor - 1e-4
        lift.append(0.0 if mz[len(ths) // 2] >= floor else (ths[ok][np.argmin(np.abs(ths[ok]))] if ok.any() else 0.0))
        near = ok & (mz <= floor + 0.012)
        rest.append(ths[near][np.argmin(np.abs(ths[near]))] if near.any() else lift[-1])
    th = []
    for f in range(len(poses)):
        w = float(np.clip((f - (f_rest - 6)) / 6.0, 0.0, 1.0))
        th.append(lift[f] * (1 - w) + rest[f] * w)
    for f, pose in enumerate(poses):
        if abs(th[f]) < 1e-6:
            continue
        M = skel.fk(pose)
        R = np.array(M[bone].to_3x3())
        k = np.cross(R[:, 1], (0.0, 0.0, 1.0))
        k = k / (np.linalg.norm(k) + 1e-9)
        Rn = rodrigues(k, th[f]) @ R
        base = M[skel.parent[bone]] @ skel.local[bone]
        B = np.array(base.to_3x3()).T @ Rn
        e = Matrix([list(r) for r in B]).to_euler("XYZ")
        pose[bone] = tuple(math.degrees(a) for a in e)
    log(f"[brightwick] staff settle: turned {min(th) * 57.3:+.0f}..{max(th) * 57.3:+.0f} deg, rests from frame {f_rest}")


# ── pipeline hooks (this module's builds only) ────────────────────────────────────────────────────────
_orig_paint_object = project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    spec = PAINT.get(cfg.get("concept"))
    if spec is None:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    img, maps = paint_hybrid(spec, obj, size, names, part_attr=part_attr, log=log, cfg=cfg)
    spec.paint_maps = (maps, list(names))
    return (img, maps) if return_maps else img


project.paint_object = _paint_object
_orig_bind_part = pipeline.bind_part


HEM = "x_hem_1"


def bind_cloak(obj, arm, th_max=0.40):
    """The bell: the top rides the chest / spine / hips; the lower bell rides x_hem_1 (a root child keyed to
    follow the hips' turn and lean), blending into the hips by height, so when the hips DROP the bell
    compresses into a pile on the ground (the death, the kneel) instead of sinking through it or toppling as a
    rigid tube. The FRONT of the lower bell leans on its own side's thigh (up to th_max at the hem, none at the
    back): the striding knee never pokes through the coat, and kneeling the coat drapes forward over the knees."""
    obj.vertex_groups.clear()
    G = {n: obj.vertex_groups.new(name=n) for n in ("hips", "spine", "chest", "thigh.L", "thigh.R", HEM)}
    co = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
    z = co[:, 2]
    up1 = smooth(0.92, 1.10, z)
    up2 = smooth(1.10, 1.26, z)
    a = np.degrees(np.abs(np.arctan2(co[:, 0], -co[:, 1])))
    front = 1.0 - smooth(40.0, 110.0, a)
    th = th_max * front * (1.0 - smooth(0.12, 0.70, z))
    sl = 0.5 + 0.5 * np.clip(co[:, 0] / 0.16, -1.0, 1.0)              # +X (its left) leans on thigh.L
    hem = 1.0 - smooth(0.05, 0.62, z)
    rest = 1.0 - th
    W = {HEM: rest * hem, "hips": rest * (1 - hem) * (1 - up1), "spine": rest * (1 - hem) * up1 * (1 - up2),
         "chest": rest * (1 - hem) * up1 * up2, "thigh.L": th * sl, "thigh.R": th * (1 - sl)}
    for n, w in W.items():
        for i in np.nonzero(w > 1e-3)[0]:
            G[n].add([int(i)], float(w[i]), "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b and b[0] == "bw_auto":
        res = mesh.bind_auto(obj, ctx.info.armature, exclude=tuple(b[1]))
        mesh.limit_weights(obj)
        return res
    if isinstance(b, tuple) and b and b[0] == "bw_cloak":
        bind_cloak(obj, ctx.info.armature)
        mesh.limit_weights(obj)
        return {}
    if isinstance(b, tuple) and b and b[0] == "bw_transfer":     # ride the named (already bound) part's skin
        src = bpy.data.objects.get(f"{b[1]}_low")
        mesh.transfer_weights(src, obj)
        mesh.add_armature_modifier(obj, ctx.info.armature)
        mesh.parent_keep(obj, ctx.info.armature)
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


pipeline.bind_part = _bind_part
FACTION_TEX = ("brightwick_aubade", "brightwick_serenade")   # the wrappers below touch these builds only
ROUGH_MIN = 0.5             # the lowest roughness a body material authors (leather, walnut)
_orig_bake_asset = bake.bake_asset
_orig_gltf_material = bake.gltf_material


def _bake_asset(low, highs, out_dir, name="body", **kw):
    """A deeper cage for these lows: the module decimates the folded cloak/mantle bells to ~600 tris, so the low
    cuts up to ~2 cm inside the folds; the default 1.2 cm cage then starts the ray inside the high and misses
    (EMIT bakes 0 = roughness 0: chrome-like cloak panels in three). Parts are exploded apart per slot during
    the bake, so the deeper cage only ever meets the part's own high."""
    if str(name).startswith(FACTION_TEX):
        kw.setdefault("cage", 0.03)
        kw.setdefault("ray", 0.08)
    return _orig_bake_asset(low, highs, out_dir, name=name, **kw)


def _gltf_material(name, paths):
    """Non-metallic, never glossy (bible: every material metalness 0, cloth/stone/leather roughness >= 0.5).
    The ORM's roughness is floored at ROUGH_MIN and its B (metal) channel zeroed; Metallic is wired through a
    x0 multiply, which the glTF exporter writes as metallicFactor 0 on the same ORM texture (the lossy WebP's
    chroma bleed into B can never turn into metal). Faction brightwick builds only (the legacy GLB stays frozen)."""
    mine = os.path.basename(str(paths.get("base", ""))).startswith(FACTION_TEX)
    if mine and paths.get("orm"):
        img = bpy.data.images.load(paths["orm"], check_existing=True)
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        low = int((px[:, 1] < ROUGH_MIN).sum())
        px[:, 1] = np.maximum(px[:, 1], ROUGH_MIN)
        px[:, 2] = 0.0
        img.pixels.foreach_set(px.ravel())
        img.save()
        print(f"[brightwick] ORM: roughness floored at {ROUGH_MIN} on {low} texels ({100.0 * low / len(px):.1f} %)")
    m = _orig_gltf_material(name, paths)
    if mine:
        nt = m.node_tree
        bsdf = nt.nodes.get("BSDF")
        for ln in list(bsdf.inputs["Metallic"].links):
            src = ln.from_socket
            nt.links.remove(ln)
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.inputs[1].default_value = 0.0
            nt.links.new(src, mul.inputs[0])
            nt.links.new(mul.outputs[0], bsdf.inputs["Metallic"])
    return m


_orig_set_image_array = bake.set_image_array


def _set_image_array(img, arr):
    """The full-size ORM, before bake_asset scales it to 256: texels the bake left at roughness 0 (outside the
    islands past the 8 px margin, and ray misses) are filled from their neighbours, then the roughness is set per
    material role from the painted part map (cloth 0.92, chalk 0.86, ironstone 0.80, leather 0.66: the bake's
    procedural roughness averaged into a satin sheen on the small cloak islands) and the metal channel is 0."""
    if img.name.endswith("_orm") and img.name.startswith(FACTION_TEX):
        arr = np.array(arr, dtype=np.float32, copy=True)
        rgb = arr[..., :3]
        valid = rgb[..., 1] > 0.02
        n0 = int((~valid).sum())
        for _ in range(48):
            if valid.all():
                break
            acc = np.zeros_like(rgb)
            cnt = np.zeros(valid.shape, dtype=np.float32)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                sv = np.roll(valid, d, (0, 1))
                acc += np.roll(rgb, d, (0, 1)) * sv[..., None]
                cnt += sv
            new = (~valid) & (cnt > 0)
            rgb[new] = acc[new] / cnt[new][:, None]
            valid |= new
        if not valid.all():
            rgb[~valid] = rgb[valid].mean(axis=0)
        spec = SPECS.get(img.name[:-4])
        pm = getattr(spec, "paint_maps", None) if spec is not None else None
        if pm is not None and pm[0]["part"].shape == rgb.shape[:2]:
            part, names = pm[0]["part"][::-1], pm[1]                  # rasterize row 0 = top; image row 0 = bottom
            iy, ix = project.nearest_index(part >= 0)
            part = part[iy, ix]
            rough = np.full(part.shape, 0.9, dtype=np.float32)
            for k, n in enumerate(names):
                role = spec.parts_info.get(n, ("cloth", None))[0]
                rough[part == k] = ROUGH.get(role, 0.9)
            rgb[..., 1] = rough
            # (fix round 3) the hollow's ink: matte (roughness 1) and OCCLUDED (0.05): the sky's indirect light and
            # the 4 % specular greyed the up-facing ink floor into a lit shelf / tongue under the hood light
            ink = getattr(spec, "ink_map", None)
            if ink is not None and ink.shape == rgb.shape[:2]:
                w = np.clip(ink[::-1], 0.0, 1.0)
                rgb[..., 1] = rgb[..., 1] * (1 - w) + 1.0 * w
                rgb[..., 0] = rgb[..., 0] * (1 - w) + np.minimum(rgb[..., 0], 0.05) * w
        rgb[..., 2] = 0.0
        arr[..., :3] = rgb
        print(f"[brightwick] ORM fill: {n0} empty texels ({100.0 * n0 / valid.size:.1f} %) filled from neighbours; "
              f"roughness per role: {pm is not None}")
    return _orig_set_image_array(img, arr)


bake.bake_asset = _bake_asset
bake.gltf_material = _gltf_material
bake.set_image_array = _set_image_array

# x_hem_1's LOCATION (the death's lying pose): poses may carry `hem_loc` (armature metres, like hips_loc); the
# common writer keys rotations + the hips' location only, so these wraps add the hem bone's location channel to
# the action and to posed previews. Poses without the key (every other clip, every other build) are untouched.
_orig_write_action = anim.write_action
_orig_apply_pose = anim.apply_pose


def _hem_locs(arm, poses):
    if not any(HEM_LOC in p for p in poses) or HEM not in arm.data.bones:
        return None
    from mathutils import Vector
    rest = arm.data.bones[HEM].matrix_local.to_3x3().transposed()
    return ([rest @ Vector(p.get(HEM_LOC, (0.0, 0.0, 0.0))) for p in poses],
            [tuple(1.0 + c for c in p.get(HEM_SQ, (0.0, 0.0, 0.0))) for p in poses])


def _write_action(arm, name, poses, bones=None):
    act = _orig_write_action(arm, name, poses, bones)
    hl = _hem_locs(arm, poses)
    if hl is not None:
        cb = act.layers[0].strips[0].channelbag(act.slots[0], ensure=True)
        n = len(poses)
        for prop, vals in (("location", hl[0]), ("scale", hl[1])):
            for i in range(3):
                fc = anim._new_fcurve(cb, f'pose.bones["{HEM}"].{prop}', i, HEM)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set("co", [c for f, l in zip(range(n), vals) for c in (f, l[i])])
                fc.keyframe_points.foreach_set("interpolation", [1] * n)
                fc.update()
    return act


def _apply_pose(arm, pose):
    _orig_apply_pose(arm, pose)
    if HEM in arm.pose.bones:
        arm.pose.bones[HEM].scale = (1.0, 1.0, 1.0)
    hl = _hem_locs(arm, [pose])
    if hl is not None:
        arm.pose.bones[HEM].location = hl[0][0]
        arm.pose.bones[HEM].scale = hl[1][0]
        bpy.context.view_layer.update()


anim.write_action = _write_action
anim.apply_pose = _apply_pose

KINDS = [Brightwick]

if __name__ == "__main__":
    wc.run(KINDS)
