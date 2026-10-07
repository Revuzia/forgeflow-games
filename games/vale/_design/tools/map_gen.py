#!/usr/bin/env python3
"""VALE map generator: Hourfall (map_rift), Needlespan (map_bridge), Noonplate (map_fray).

Writes content/maps/<id>.json (MapDef, src/contracts/catalog.ts). The JSON is the layout truth for the
sim, the Blender map scene and the minimap alike (CONTRACT §1); this script is only how the design
lane produces it, so the numbers below are the design and the JSON is what ships.

Method: every map is CARVED. Open ground is the union of primitives (roads, plazas, jungle paths,
clearings, pits); walls are whatever is left of the map rectangle, cut into simple polygons. Team
maps are generated for the Aubade half (x <= W/2) and mirrored across the noon line x = W/2
(a reflection, never a rotation: STYLE_BIBLE "Every team map attacks along the screen horizontal").

Sim plane: x right (Aubade west = low x), y DOWN (screen-top = low y, north). Metres.

usage: python3 _design/tools/map_gen.py [--out content/maps]      (needs: pip install shapely)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely import affinity

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))

RES = 6           # buffer segments per quarter circle (clean, few vertices)
SIMPLIFY = 0.12   # m: polygon simplification tolerance (curves stay smooth for the cliff meshes)
GRID = 0.1        # m: coordinates are rounded to this grid (mirror-exact)


# ── geometry helpers ─────────────────────────────────────────────────────────────────────────────
def rnd(v: float) -> float:
    r = round(round(v / GRID) * GRID, 2)
    return 0.0 if r == 0 else r


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def arc(cx, cy, r, a0, a1, n, west=True):
    """points on a circle around (cx, cy); angle in degrees measured from WEST (-x) toward NORTH (-y)."""
    pts = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx - r * math.cos(a), cy - r * math.sin(a)))
    return pts


def polar(cx, cy, r, a):
    a = math.radians(a)
    return (cx - r * math.cos(a), cy - r * math.sin(a))


def path_len(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def resample(pts, step):
    """even-ish resampling of a polyline (keeps ends)."""
    L = path_len(pts)
    n = max(1, round(L / step))
    out, seg, acc = [pts[0]], 0, 0.0
    targets = [L * i / n for i in range(1, n)]
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.dist(pts[i], pts[i + 1]))
    for t in targets:
        while cum[seg + 1] < t:
            seg += 1
        u = (t - cum[seg]) / max(1e-9, cum[seg + 1] - cum[seg])
        a, b = pts[seg], pts[seg + 1]
        out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
    out.append(pts[-1])
    return out


def along(pts, s_from_end):
    """point at arc length s measured from the polyline's END, plus the unit left normal there
    (for a road listed base → noon line, the left normal of the reversed walk points to the Dialwood
    side on the North road)."""
    rev = list(reversed(pts))
    acc = 0.0
    for i in range(len(rev) - 1):
        d = math.dist(rev[i], rev[i + 1])
        if acc + d >= s_from_end:
            u = (s_from_end - acc) / d
            a, b = rev[i], rev[i + 1]
            p = (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
            tx, ty = (b[0] - a[0]) / d, (b[1] - a[1]) / d
            return p, (-ty, tx)
        acc += d
    return rev[-1], (0.0, 1.0)


def offset(p_n, k):
    p, n = p_n
    return (p[0] + n[0] * k, p[1] + n[1] * k)


def corridor(pts, hw):
    return LineString(pts).buffer(hw, quad_segs=RES, cap_style='round', join_style='round')


def disc(c, r, res=None):
    """circle; big plazas and pits get more segments (about one vertex per 1.5 m of rim)"""
    q = res if res is not None else max(RES, min(16, int(math.ceil(r * math.pi / 2 / 1.5))))
    return Point(c).buffer(r, quad_segs=q)


def rect(cx, cy, w, h, ang=0.0):
    g = box(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    return affinity.rotate(g, ang, origin=(cx, cy)) if ang else g


def ellipse(cx, cy, rx, ry, ang=0.0):
    g = affinity.scale(Point(cx, cy).buffer(1, quad_segs=RES), rx, ry)
    return affinity.rotate(g, ang, origin=(cx, cy)) if ang else g


def mx(g, W):
    """mirror a shapely geometry across x = W/2"""
    return affinity.scale(g, xfact=-1, yfact=1, origin=(W / 2, 0))


def fy(g, H):
    """flip a shapely geometry across y = H/2"""
    return affinity.scale(g, xfact=1, yfact=-1, origin=(0, H / 2))


def mpt(p, W):
    return (W - p[0], p[1])


def fpt(p, H):
    return (p[0], H - p[1])


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


def ring_pts(p: Polygon):
    """exterior ring as rounded [x, y] list, clockwise on screen, no closing duplicate."""
    p = p.simplify(SIMPLIFY, preserve_topology=True)
    coords = list(p.exterior.coords)[:-1]
    out = []
    for x, y in coords:
        q = [rnd(x), rnd(y)]
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def carve_walls(W, H, open_ground, mirror=True, min_area=1.0):
    """Walls = map rectangle minus open ground, as simple polygons. With mirror, the west half is cut
    and reflected so the result is exactly symmetric; blocks crossing the axis (not touching the map
    border) are merged with their reflection into one symmetric polygon."""
    solid = box(0, 0, W, H).difference(open_ground)
    out = []
    if not mirror:
        for p in polys(solid):
            if p.area >= min_area:
                out.append(p)
        return out
    west = solid.intersection(box(0, 0, W / 2, H))
    for p in polys(west):
        if p.area < min_area:
            continue
        b = p.bounds
        on_axis = b[2] >= W / 2 - 1e-6
        on_border = b[0] <= 1e-6 or b[1] <= 1e-6 or b[3] >= H - 1e-6
        if on_axis and not on_border:
            u = unary_union([p, mx(p, W)])
            u = u.buffer(0.01, quad_segs=1).buffer(-0.01, quad_segs=1)
            for q in polys(u):
                out.append(q)
        else:
            out.append(p)
            out.append(mx(p, W))
    return out


def wall_json(walls, W, mirror=True):
    """rounded rings; mirrored pairs are produced from the same rounded west ring (exact symmetry)."""
    res = []
    if not mirror:
        return [ring_pts(p) for p in walls]
    seen = []
    for p in walls:
        c = p.centroid
        if c.x > W / 2 + 1e-6:
            continue  # east copies come from their west twin below
        r = ring_pts(p)
        res.append(r)
        if c.x < W / 2 - 1e-6:
            res.append([[rnd(W - x), y] for x, y in reversed(r)])
        seen.append(p)
    return res


def thicket_json(shapes, open_ground, W, H, mirror=True, keep_out=()):
    res = []
    for s in shapes:
        g = s.intersection(open_ground)
        for k in keep_out:
            g = g.difference(k)
        for p in polys(g):
            if p.area < 2.0:
                continue
            r = ring_pts(p)
            res.append(r)
            if mirror:
                res.append([[rnd(W - x), y] for x, y in reversed(r)])
    return res


def P(p):
    return [rnd(p[0]), rnd(p[1])]


def landmark(lid, name, at, size, height, note, flush=False):
    """art hint: a landmark's footprint (axis-aligned w × d, metres) and height. The probe checks that
    a solid one stands on wall cells or outside the map and hides no open ground from the camera
    (52°: h metres tall hides 0.78 h m of ground north of it). Flush ones are inlays on open ground."""
    rec = {"id": lid, "name": name, "at": P(at), "size": [rnd(size[0]), rnd(size[1])], "height": height, "note": note}
    if flush:
        rec["flush"] = True
    return rec


# ── shared art blocks ────────────────────────────────────────────────────────────────────────────
CAMERA = {"pitchDeg": 52, "fovDeg": 26, "distance": 28.5, "minDistance": 24.5, "maxDistance": 33.0}


TOKEN_KEY = {"map_rift": "rift", "map_bridge": "bridge", "map_fray": "fray"}
FOG_KEY = {"rift": "heightMist", "bridge": "gorge", "fray": "rimGlare"}


def sun_dir(elevation_deg, bearing_deg):
    """STYLE_BIBLE 'Look rules': sun elevation / compass bearing (0 = -Z north = screen-up, 90 = +X east,
    180 = +Z toward the camera) → unit vector TOWARD the sun in three.js axes (X east, Y up, Z south)."""
    e, b = math.radians(elevation_deg), math.radians(bearing_deg)
    return [round(math.sin(b) * math.cos(e), 4), round(math.sin(e), 4), round(-math.cos(b) * math.cos(e), 4)]


def lighting(map_id):
    """from tokens.json grade.maps.<mode> (the machine-readable bible); cross-checked against the art
    lane's sky bake fragment art/out/maps/<id>/lighting.json when it exists."""
    with open(os.path.join(ROOT, '_design', 'tokens.json')) as f:
        g = json.load(f)['grade']['maps'][TOKEN_KEY[map_id]]
    fog = g['fog'].get(FOG_KEY[TOKEN_KEY[map_id]]) or {}
    lt = {
        "sunDir": sun_dir(g['sun']['elevationDeg'], g['sun']['azimuthDeg']),
        "sunColor": g['sun']['color'],
        "sunIntensity": g['sun']['intensity'],
        "ambient": g['environmentIntensity'],
        "fogColor": fog.get('color', '#000000'),
        "fogDensity": fog.get('densityPerM', 0.0),
        "exposure": 1.0,
    }
    baked = os.path.join(ROOT, 'art', 'out', 'maps', map_id, 'lighting.json')
    if os.path.exists(baked):
        with open(baked) as f:
            b = json.load(f)
        for k, v in lt.items():
            bv = b.get(k)
            same = all(abs(x - y) < 2e-4 for x, y in zip(v, bv)) if isinstance(v, list) else (v == bv or (isinstance(v, (int, float)) and abs(v - bv) < 1e-6))
            if not same:
                print(f"WARNING {map_id}: lighting.{k} {v} differs from the sky bake's {bv}", file=sys.stderr)
    return lt


def art(map_id, music, terrain):
    return {
        "scene": f"assets/maps/{map_id}/scene.glb",
        "sky": f"assets/maps/{map_id}/sky.hdr",
        "lut": "assets/grade/vale_grade_01.cube",
        "minimap": f"assets/maps/{map_id}/minimap.png",
        "terrain": terrain,
        "lighting": lighting(map_id),
        "music": music,
    }


# ══ HOURFALL (map_rift) ═══════════════════════════════════════════════════════════════════════════
def build_rift():
    W, H = 170.0, 110.0
    CX, CY = W / 2, H / 2
    ROAD = 5.2        # open half-width of a road corridor (7.2 m paving + 1.6 m verge each side)
    EDGE = 2.8        # structures stand this far off the road's centre line (alternating sides)
    PATH = 2.8        # open half-width of a Dialwood path

    # ── roads (Aubade half, centre-line) ────────────────────────────────────────────────────────
    base_c = (12.0, CY)
    hourbell = (15.0, CY)
    mid_end = (22.0, CY)                                   # lane end inside the Glass Belfry plaza
    n_in = (17.5, 46.0)                                     # North road end inside the plaza
    n_gate = (22.5, 39.5)
    n_curve = bezier(n_gate, (26.0, 20.0), (47.0, 11.5), (CX, 11.5), 10)
    north_half = [n_in] + n_curve                            # Aubade end → noon line
    north_full = north_half + [mpt(p, W) for p in reversed(north_half[:-1])]
    south_full = [fpt(p, H) for p in north_full]
    mid_full = [mid_end, mpt(mid_end, W)]

    # ── Noonline features ───────────────────────────────────────────────────────────────────────
    seat_r = 8.0
    ls_pit = (CX, 31.0)       # Longshade: Standing Shadow, between North and Mid roads
    ls_r = 9.0
    ss_pit = (CX, 80.0)       # Sunsplinter: Fallen Shaft, between Mid and South roads (the broken tip)
    ss_r = 8.5

    # ── Dialwood hour-lines (Aubade north quadrant: Elevenmark); south = vertical flip ──────────
    RING = 27.0               # the hour-ring: concentric path around the Seat
    hour_ring = arc(CX, CY, RING, 9, 72, 14)
    ten_line = [polar(CX, CY, RING, 30), polar(CX, CY, 47, 30), polar(CX, CY, 58, 33)]       # the Baseward line
    eleven_line = [polar(CX, CY, RING, 54), polar(CX, CY, 38, 56), polar(CX, CY, 47.5, 60)]  # the Rimward line

    open_parts = []
    def add(g, mirror_x=True, flip=False):
        gs = [g] + ([fy(g, H)] if flip else [])
        for x in gs:
            open_parts.append(x)
            if mirror_x:
                open_parts.append(mx(x, W))

    # roads
    add(corridor(north_full, ROAD), mirror_x=False, flip=True)
    add(corridor(mid_full, ROAD), mirror_x=False)
    # bases (Glass Belfry plaza; the Lamp Dome is its mirror)
    add(disc(base_c, 13.0))
    # the Seat and the Noonline
    add(disc((CX, CY), seat_r), mirror_x=False)
    add(disc(ls_pit, ls_r), mirror_x=False)
    add(disc(ss_pit, ss_r), mirror_x=False)
    add(corridor([(CX, 12.0), (CX, ls_pit[1])], 2.6), mirror_x=False)              # north choke: road → pit
    add(corridor([(CX, ls_pit[1]), (CX, CY)], 4.2), mirror_x=False)                # the Standing Shadow strip
    add(corridor([(CX, CY), (CX, ss_pit[1])], 5.0), mirror_x=False)                # the Fallen Shaft channel
    add(corridor([(CX, ss_pit[1]), (CX, H - 12.0)], 2.6), mirror_x=False)          # south choke: pit → road
    # Dialwood paths (north quadrant + its flip to the south quadrant)
    add(corridor(hour_ring, PATH), flip=True)
    add(corridor(ten_line, PATH), flip=True)
    add(corridor(eleven_line, PATH), flip=True)

    # camps (clearings) — Elevenmark (north) and Sevenmark (south)
    glasshorn = polar(CX, CY, RING, 30)          # hour-ring × ten-line, nearest the Seat road
    gloamoths = polar(CX, CY, 36.5, 55.5)         # half-way out the eleven-line
    strays_n = polar(CX, CY, 45.0, 30.0)          # out on the ten-line, toward the Glass Belfry
    resinback = fpt(polar(CX, CY, 36.5, 55.5), H)  # south: eleven-line flip, near the duo road + Sunsplinter
    stilltusks = fpt(polar(CX, CY, RING, 30), H)  # south: hour-ring × ten-line flip, near the Seat road
    strays_s = fpt(polar(CX, CY, 45.0, 30.0), H)
    for c, r in ((glasshorn, 4.6), (gloamoths, 4.2), (strays_n, 4.2)):
        add(disc(c, r), flip=False)
    for c, r in ((resinback, 4.6), (stilltusks, 4.2), (strays_s, 4.2)):
        add(disc(c, r), flip=False)

    open_ground = unary_union(open_parts)

    # Fallen Shaft: needle segments lying in the channel (walls on the noon line)
    shaft = [rect(CX, 66.6, 3.0, 6.4)]
    for s in shaft:
        open_ground = open_ground.difference(s)

    walls = carve_walls(W, H, open_ground)
    wall_rings = wall_json(walls, W)

    # ── Needlegrass (thickets): lane verges and jungle mouths ──────────────────────────────────
    th = []
    def tk(g, flip=True):
        th.append(g)
        if flip:
            th.append(fy(g, H))
    # North road verge, outer (rim) side, between the Outer and Inner Needles: the gank bush
    p_v, n_v = along(north_half, 38.0)
    ang_v = math.degrees(math.atan2(n_v[1], n_v[0])) + 90
    tk(ellipse(*offset((p_v, n_v), -4.3), 5.2, 1.7, ang_v))
    # Dialwood mouths
    tk(ellipse(*polar(CX, CY, 46.0, 57.0), 2.4, 3.4, 30))           # eleven-line mouth on the North road
    tk(ellipse(*polar(CX, CY, 56.0, 32.5), 2.6, 3.0, 50))           # ten-line mouth by the North Lantern
    tk(ellipse(*polar(CX, CY, RING, 11), 3.0, 2.0, 0))              # hour-ring mouth on the Seat road
    tk(ellipse(*polar(CX, CY, RING, 66), 2.2, 3.0, -20))            # hour-ring mouth at the pit
    # Seat road verges, both sides, just outside the Seat
    th_m = [ellipse(70.5, CY + 4.4, 4.4, 1.5, 0), ellipse(70.5, CY - 4.4, 4.4, 1.5, 0)]
    keep_out = [disc(c, 3.2) for c in (glasshorn, gloamoths, strays_n, resinback, stilltusks, strays_s,
                                      mpt(glasshorn, W), mpt(gloamoths, W), mpt(strays_n, W), mpt(resinback, W),
                                      mpt(stilltusks, W), mpt(strays_s, W))]
    thickets = thicket_json(th + th_m, open_ground, W, H, keep_out=keep_out)

    # ── lanes (team 0 Aubade → team 1 Serenade) ────────────────────────────────────────────────
    def lane_pts(pts, step):
        return [P(p) for p in resample(pts, step)]
    north_lane = lane_pts(north_full, 9.0)
    south_lane = [P(fpt(p, H)) for p in north_lane]
    mid_lane = [P(mid_end), P((CX - 30, CY)), P((CX, CY)), P((CX + 30, CY)), P(mpt(mid_end, W))]
    # exact mirror of the north lane (resampling is symmetric only up to rounding)
    half = [p for p in north_lane if p[0] <= CX]
    if half[-1][0] != CX:
        half.append([CX, rnd(11.5)])
    north_lane = half + [[rnd(W - x), y] for x, y in reversed(half[:-1])]
    south_lane = [[x, rnd(H - y)] for x, y in north_lane]

    # ── structures (UNITS doc §9.2) ────────────────────────────────────────────────────────────

    S = []
    def struct(sid, unit, team, at, lane=None, requires=(), respawn=None):
        rec = {"id": sid, "unit": unit, "team": team}
        if lane:
            rec["lane"] = lane
        rec["at"] = P(at)
        rec["requires"] = list(requires)
        if respawn:
            rec["respawn"] = respawn
        S.append(rec)

    # structures are placed against the lane polyline the Wicks actually walk (Aubade half)
    nh = [tuple(p) for p in north_lane if p[0] <= CX]
    for team in (0, 1):
        tag = 'a' if team == 0 else 's'
        m = (lambda p: p) if team == 0 else (lambda p: mpt(p, W))
        # Seat road (mid). Structures stand at alternate road edges (2.8 m off the centre line) so the
        # Wicks' line stays straight: Outer north, Inner south, Lantern north.
        struct(f"{tag}_seat_needle_outer", "needle_outer", team, m((62.0, CY - EDGE)), "road_seat")
        struct(f"{tag}_seat_needle_inner", "needle_inner", team, m((46.0, CY + EDGE)), "road_seat", [f"{tag}_seat_needle_outer"])
        struct(f"{tag}_seat_lantern", "lantern", team, m((32.0, CY - EDGE)), "road_seat", [f"{tag}_seat_needle_inner"], 240)
        # North and South roads
        for road, flipf in (("road_high", lambda p: p), ("road_low", lambda p: fpt(p, H))):
            rn = "high" if road == "road_high" else "low"
            p_out, nrm = along(nh, 26.0)
            p_in, nrm_in = along(nh, 50.0)
            p_lan, nrm_lan = along(nh, 69.0)
            # Outer on the Dialwood side, Inner on the rim side, Lantern on the Dialwood side
            o = offset((p_out, nrm), -EDGE)
            i_ = offset((p_in, nrm_in), EDGE)
            lan = offset((p_lan, nrm_lan), -EDGE)
            struct(f"{tag}_{rn}_needle_outer", "needle_outer", team, m(flipf(o)), road)
            struct(f"{tag}_{rn}_needle_inner", "needle_inner", team, m(flipf(i_)), road, [f"{tag}_{rn}_needle_outer"])
            struct(f"{tag}_{rn}_lantern", "lantern", team, m(flipf(lan)), road, [f"{tag}_{rn}_needle_inner"], 240)
        # Bell Needles flank the Hourbell on the Seat road; both open when the Seat road Lantern falls
        struct(f"{tag}_bell_needle_north", "needle_bell", team, m((21.5, CY - 3.8)), None, [f"{tag}_seat_lantern"])
        struct(f"{tag}_bell_needle_south", "needle_bell", team, m((21.5, CY + 3.8)), None, [f"{tag}_seat_lantern"])
        struct(f"{tag}_hourbell", "hourbell", team, m(hourbell), None, [f"{tag}_bell_needle_north", f"{tag}_bell_needle_south"])

    # ── camps (UNITS doc §9.3–9.4) ─────────────────────────────────────────────────────────────
    camps = []
    def camp(cid, center, units, first, respawn, objective=False, facing_to=(CX, CY)):
        rec = {"id": cid, "units": [{"unit": u, "at": P((center[0] + dx, center[1] + dy))} for u, dx, dy in units],
               "firstSpawn": first, "respawn": respawn}
        if objective:
            rec["objective"] = True
        camps.append(rec)

    def camp_pair(cid, center, units, first, respawn):
        camp(f"a_{cid}", center, units, first, respawn)
        camp(f"s_{cid}", mpt(center, W), [(u, -dx, dy) for u, dx, dy in units], first, respawn)

    camp_pair("glasshorn", glasshorn, [("glasshorn", 0.0, 0.0)], 60, 270)
    camp_pair("gloamoths", gloamoths, [("gloamoth", 0.0, 0.0), ("gloamoth_little", -1.6, 1.0), ("gloamoth_little", 1.6, 1.0), ("gloamoth_little", 0.0, -1.7)], 60, 150)
    camp_pair("strays_north", strays_n, [("stray_numeral", 0.0, 0.0), ("stray_tick", -1.7, 1.1), ("stray_tick", 1.7, -1.1)], 60, 150)
    camp_pair("resinback", resinback, [("resinback", 0.0, 0.0)], 60, 270)
    camp_pair("stilltusks", stilltusks, [("stilltusk", 0.0, 0.0), ("stilltusk_young", -1.6, -1.0), ("stilltusk_young", 1.6, -1.0)], 60, 150)
    camp_pair("strays_south", strays_s, [("stray_numeral", 0.0, 0.0), ("stray_tick", -1.7, -1.1), ("stray_tick", 1.7, 1.1)], 60, 150)
    camp("sunsplinter", ss_pit, [("sunsplinter", 0.0, 0.0)], 360, 270, objective=True)
    camp("longshade", ls_pit, [("longshade", 0.0, 0.0)], 960, 360, objective=True)

    bases = []
    for team in (0, 1):
        m = (lambda p: p) if team == 0 else (lambda p: mpt(p, W))
        bases.append({"team": team, "spawn": P(m((8.5, CY))), "fountain": {"at": P(m((4.5, CY))), "radius": 5.0},
                      "shop": {"at": P(m((6.0, CY - 7.5))), "radius": 3.0}})

    # Noonline floors (art hints: the sim sees only walls/thickets). North half = the Standing Shadow,
    # south half = the Fallen Shaft; both stop at the road verges and at the Seat's rim.
    roads = unary_union([corridor(north_full, ROAD), corridor([fpt(p, H) for p in north_full], ROAD), corridor(mid_full, ROAD)])
    seat = disc((CX, CY), seat_r)
    north_nl = unary_union([disc(ls_pit, ls_r), corridor([(CX, 12.0), (CX, ls_pit[1])], 2.6), corridor([(CX, ls_pit[1]), (CX, CY)], 4.2)])
    south_nl = unary_union([disc(ss_pit, ss_r), corridor([(CX, CY), (CX, ss_pit[1])], 5.0), corridor([(CX, ss_pit[1]), (CX, H - 12.0)], 2.6)])
    def floor(g):
        g = g.difference(roads).difference(seat).intersection(open_ground)
        return [ring_pts(p) for p in polys(g) if p.area > 4.0]
    with open(os.path.join(ROOT, '_design', 'tokens.json')) as f:
        tok = json.load(f)['grade']['maps']['rift']
    terrain = {
        "$comment": "Art hints (free-form; the sim reads none of it). colors: refs for render/terrain.ts's procedural fallback. noonline: floor polygons of the two Noonline halves. tokens.json grade.maps.rift.valueLstar is the value law; _design/maps/map_rift_landmarks.md is the brief.",
        "colors": {"lane": "#9A927F", "jungle": "#4E5547", "clearing": "#7A766A", "inscription": "#B7B0A0"},
        "noonline": {
            "standingShadow": {"floor": floor(north_nl), "tint": "#4A4560", "valueLstar": tok['valueLstar']['standingShadow'], "edge": "hard, engraved; keeps colour under fog of war"},
            "fallenShaft": {"floor": floor(south_nl), "water": "shallow, <= 0.05 m over pale stone", "valueLstar": tok['valueLstar']['fallenShaft']},
        },
        "temperatureField": tok['temperatureField'],
        "edgeFog": tok['fog']['edge'],
        "heightMist": tok['fog']['heightMist'],
        "seat": {"at": [CX, CY], "radius": seat_r, "relief": "flush; carved rim <= 0.15 m"},
        "hourLines": {"centre": [CX, CY], "ring": RING, "note": "Dialwood paths follow the hour-ring and two hour-lines per quadrant (Baseward, Rimward)"},
        "landmarks": [
            landmark("glass_belfry", "Glass Belfry", (-5.0, CY), (7, 7), 22.0, "Aubade base; spire, chalk + dawnglass; beyond the west edge"),
            landmark("lamp_dome", "Lamp Dome", (W + 10.0, CY), (18, 18), 8.0, "Serenade base; low banded ironstone dome, lampresin oculus; beyond the east edge"),
            landmark("lampwright_stall_a", "Lampwright stall", (5.5, 41.5), (3, 3), 4.0, "Aubade shop kiosk on the wall lip north of the shop circle"),
            landmark("lampwright_stall_s", "Lampwright stall", (W - 5.5, 41.5), (3, 3), 4.0, "Serenade shop kiosk"),
            landmark("the_seat", "the Seat", (CX, CY), (16, 16), 0.15, "the needle's base-stone, flush, carved rim and socket scar", flush=True),
            landmark("shadow_slab_w", "shadow slab", (CX - 5.6, 19.6), (2, 3), 4.0, "leaning basalt slab framing Longshade's north choke"),
            landmark("shadow_slab_e", "shadow slab", (CX + 5.6, 19.6), (2, 3), 4.0, "its mirror"),
            landmark("shadow_tip", "shadow tip", (CX, 24.0), (2, 2), 0.02, "the Standing Shadow's engraved point on the pit floor", flush=True),
            landmark("shaft_drum", "needle drum", (CX, 66.6), (3, 6.4), 2.2, "lying drum of the fallen needle (it IS the wall there); broken face south"),
            landmark("numeral_xi", "Elevenmark numeral XI", (55.3, 28.2), (9, 4), 5.0, "half-buried, tilted 20 degrees"),
            landmark("numeral_ii", "Twomark numeral II", (W - 55.3, 28.2), (6, 4), 5.0, "half-buried"),
            landmark("numeral_vii", "Sevenmark numeral VII", (55.3, H - 28.2), (10, 4), 5.0, "half-buried"),
            landmark("numeral_iiii", "Fourmark numeral IIII", (W - 55.3, H - 28.2), (9, 4), 5.0, "half-buried"),
            landmark("noon_stone", "noon stone XII", (CX, 3.0), (3, 1.5), 9.0, "upright stele where the Noonline meets the north rim"),
            landmark("vi_slab", "VI slab", (CX, H - 3.0), (6, 2), 1.2, "lying flat: south of the South Road"),
        ],
    }
    rec = {
        "$comment": "Generated by _design/tools/map_gen.py (edit there, then run it and _harness/probe_maps.ts). Layout truth for the sim, the Blender scene and the minimap; landmark and art brief: _design/maps/map_rift_landmarks.md.",
        "id": "map_rift",
        "name": "Hourfall",
        "desc": "The carved dial itself. Three roads run west to east between the Glass Belfry and the Lamp Dome, crossed by the Noonline that runs north and south through the Seat.",
        "size": [W, H],
        "navCell": 0.5,
        "walls": wall_rings,
        "thickets": thickets,
        "lanes": [
            {"id": "road_high", "name": "North Road", "path": north_lane},
            {"id": "road_seat", "name": "Mid Road", "path": mid_lane},
            {"id": "road_low", "name": "South Road", "path": south_lane},
        ],
        "bases": bases,
        "spawns": [],
        "structures": S,
        "camps": camps,
        "pickups": [],
        "shops": [],
        "art": art("map_rift", "mus_match_rift", terrain),
        "camera": CAMERA,
    }
    return rec, open_ground


# ══ NEEDLESPAN (map_bridge) ═══════════════════════════════════════════════════════════════════════
def build_bridge():
    W, H = 156.0, 44.0
    CX, CY = W / 2, H / 2
    SPAN = 7.0          # half-width of the fallen needle's walkable top (14 m)
    parts = []
    def add(g, mirror_x=True):
        parts.append(g)
        if mirror_x:
            parts.append(mx(g, W))
    base_c = (10.0, CY)
    add(disc(base_c, 13.0))                                                  # Dawn Arch terrace (Lamp Gate = mirror)
    add(rect((20.0 + CX) / 2, CY, CX - 20.0 + 0.2, 2 * SPAN))                # the shaft top, base → Snap
    add(disc((CX, CY), 12.0), mirror_x=False)                                # the Snap
    # collar ledges: where the shaft's carved bands bulge, the top widens a little (flank pockets)
    add(ellipse(46.0, CY - SPAN, 5.0, 2.4))
    add(ellipse(46.0, CY + SPAN, 5.0, 2.4))
    open_ground = unary_union(parts)
    # carved collars: low stone bands across the shaft edges (cover, chokes)
    for g in (rect(33.0, CY - SPAN + 1.0, 2.4, 3.0), rect(33.0, CY + SPAN - 1.0, 2.4, 3.0),
              rect(62.0, CY - SPAN + 0.9, 3.4, 2.4), rect(62.0, CY + SPAN - 0.9, 3.4, 2.4)):
        open_ground = open_ground.difference(g).difference(mx(g, W))
    # the Snap's broken stubs: two shard walls on the crack line (split the plaza into lanes of fire)
    for g in (rect(CX, CY - 6.2, 2.6, 4.2), rect(CX, CY + 6.2, 2.6, 4.2)):
        open_ground = open_ground.difference(g)
    walls = carve_walls(W, H, open_ground)
    wall_rings = wall_json(walls, W)

    th = [ellipse(46.0, CY - SPAN - 0.6, 4.0, 1.9), ellipse(46.0, CY + SPAN + 0.6, 4.0, 1.9),
          ellipse(CX - 6.8, CY - 8.0, 2.6, 1.8, -35), ellipse(CX - 6.8, CY + 8.0, 2.6, 1.8, 35)]
    thickets = thicket_json(th, open_ground, W, H)

    lane = [P((17.0, CY)), P((CX, CY)), P((W - 17.0, CY))]
    S = []
    def struct(sid, unit, team, at, lane_id=None, requires=(), respawn=None):
        rec = {"id": sid, "unit": unit, "team": team}
        if lane_id:
            rec["lane"] = lane_id
        rec["at"] = P(at)
        rec["requires"] = list(requires)
        if respawn:
            rec["respawn"] = respawn
        S.append(rec)
    for team in (0, 1):
        tag = 'a' if team == 0 else 's'
        m = (lambda p: p) if team == 0 else (lambda p: mpt(p, W))
        struct(f"{tag}_span_needle_outer", "needle_outer", team, m((57.0, CY - 3.0)), "road_span")
        struct(f"{tag}_span_needle_inner", "needle_inner", team, m((41.0, CY + 3.0)), "road_span", [f"{tag}_span_needle_outer"])
        struct(f"{tag}_span_lantern", "lantern", team, m((29.0, CY - 3.0)), "road_span", [f"{tag}_span_needle_inner"], 240)
        struct(f"{tag}_bell_needle", "needle_bell", team, m((21.5, CY + 3.4)), None, [f"{tag}_span_lantern"])
        struct(f"{tag}_hourbell", "hourbell", team, m((12.5, CY)), None, [f"{tag}_bell_needle"])

    pickups = []
    for tag, m in (('a', lambda p: p), ('s', lambda p: mpt(p, W))):
        pickups.append({"id": f"{tag}_mend_outer", "unit": "sunmote_mend", "at": P(m((44.0, CY - 5.2))), "firstSpawn": 80, "respawn": 80})
        pickups.append({"id": f"{tag}_mend_inner", "unit": "sunmote_mend", "at": P(m((65.5, CY + 5.0))), "firstSpawn": 120, "respawn": 80})
    bases = []
    for team in (0, 1):
        m = (lambda p: p) if team == 0 else (lambda p: mpt(p, W))
        bases.append({"team": team, "spawn": P(m((7.0, CY))), "fountain": {"at": P(m((3.5, CY))), "radius": 5.0},
                      "shop": {"at": P(m((6.0, CY - 7.5))), "radius": 3.0}})
    terrain = {
        "$comment": "the walls of Needlespan are the gorge: render them as a drop, never as cliffs rising from the span",
        "wallStyle": "gorge",
        "landmarks": [
            landmark("dawn_arch", "Dawn Arch", (-4.0, CY), (3, 24), 12.0, "Aubade end: dawnglass arch spanning the terrace's back, beyond the west edge"),
            landmark("lamp_gate", "Lamp Gate", (W + 4.0, CY), (5, 24), 7.0, "Serenade end: low banded ironstone gate with drum towers and a lampresin lamp"),
            landmark("snap_stub_n", "Snap stub", (CX, CY - 6.2), (2.6, 4.2), 2.4, "broken stub of the shaft on the crack line (a wall)"),
            landmark("snap_stub_s", "Snap stub", (CX, CY + 6.2), (2.6, 4.2), 2.4, "its twin"),
            landmark("snap_crack", "the crack", (CX, CY), (1, 24), 0.05, "the fracture line across the Snap floor, engraved and lit from inside (emissive <= 0.8)", flush=True),
            landmark("lampwright_stall_a", "Lampwright stall", (5.0, 8.5), (3, 2.5), 3.5, "Aubade shop kiosk on the gorge lip north of the shop circle"),
            landmark("lampwright_stall_s", "Lampwright stall", (W - 5.0, 8.5), (3, 2.5), 3.5, "Serenade shop kiosk"),
        ],
        "colors": {"lane": "#988F7C", "clearing": "#7E786B", "inscription": "#B7B0A0"},
    }
    rec = {
        "$comment": "Generated by _design/tools/map_gen.py (edit there, then run it and _harness/probe_maps.ts). Layout truth for the sim, the Blender scene and the minimap; landmark and art brief: _design/maps/map_bridge_landmarks.md.",
        "id": "map_bridge",
        "name": "Needlespan",
        "desc": "The needle's fallen shaft lies across the gorge. One road runs along its top from the Dawn Arch to the Lamp Gate, and every fight meets at the Snap where it cracked.",
        "size": [W, H],
        "navCell": 0.5,
        "walls": wall_rings,
        "thickets": thickets,
        "lanes": [{"id": "road_span", "name": "Span Road", "path": lane}],
        "bases": bases,
        "spawns": [],
        "structures": S,
        "camps": [],
        "pickups": pickups,
        "shops": [],
        "art": art("map_bridge", "mus_match_bridge", terrain),
        "camera": CAMERA,
    }
    return rec, open_ground


# ══ NOONPLATE (map_fray) ══════════════════════════════════════════════════════════════════════════
def build_fray():
    W = H = 64.0
    C = (W / 2, H / 2)
    R = 30.0
    def clock(r, deg):
        """clock bearing: 0 = 12 o'clock (screen up), clockwise on screen."""
        a = math.radians(deg)
        return (C[0] + r * math.sin(a), C[1] - r * math.cos(a))
    plate = disc(C, R, res=24)
    # hour-stones: ten low carved blocks between the hour-marks (walls for play), one per gap
    stones = []
    for k in range(10):
        a = 36 * k + 18
        p = clock(19.5, a)
        stones.append(rect(p[0], p[1], 4.6, 1.8, a))
    # the Lampwright's cart is solid (a pillar to play round); its shop ring is 4 m
    cart = Polygon([(C[0] + 1.3 * math.sin(math.radians(36 * k)), C[1] - 1.3 * math.cos(math.radians(36 * k))) for k in range(10)])  # ten-sided, like the plate
    open_ground = plate.difference(cart)
    for s in stones:
        open_ground = open_ground.difference(s)
    walls = [p for p in polys(box(0, 0, W, H).difference(open_ground)) if p.area > 1.0]
    # cut the outer frame (a ring) into four corner pieces so every wall is a simple polygon
    wall_rings = []
    for p in walls:
        if p.bounds[0] <= 1e-6:  # the frame (touches the map border)
            for q in (box(0, 0, C[0], C[1]), box(C[0], 0, W, C[1]), box(0, C[1], C[0], H), box(C[0], C[1], W, H)):
                for piece in polys(p.intersection(q)):
                    wall_rings.append(ring_pts(piece))
        else:
            wall_rings.append(ring_pts(p))
    spawns = [P(clock(26.0, 36 * k)) for k in range(10)]
    # Needlegrass: ten tufts on the inner ring, one in front of each hour-mark
    th = []
    for k in range(10):
        p = clock(11.5, 36 * k)
        th.append(rect(p[0], p[1], 3.4, 2.2, 36 * k))
    thickets = [ring_pts(t) for t in th]
    pickups = []
    # Sunmotes on the inner ring, one in every gap between hour-marks: Mending and Quick alternate,
    # so every hour-mark has one of each beside it (seat k: gap k clockwise, gap k-1 anticlockwise)
    for g in range(10):
        if g % 2 == 0:
            pickups.append({"id": f"mend_{g // 2 + 1}", "unit": "sunmote_mend", "at": P(clock(15.0, 36 * g + 18)), "firstSpawn": 30, "respawn": 40})
        else:
            pickups.append({"id": f"quick_{g // 2 + 1}", "unit": "sunmote_quick", "at": P(clock(15.0, 36 * g + 18)), "firstSpawn": 45, "respawn": 80})
    for i, a in enumerate((90, 270)):
        pickups.append({"id": f"gleam_{i + 1}", "unit": "sunmote_gleam", "at": P(clock(7.0, a)), "firstSpawn": 60, "respawn": 60})
    terrain = {
        "$comment": "honed basalt plate; hour-lines from the centre to each hour-mark; the cart ring at the centre",
        "colors": {"lane": "#8E887C", "jungle": "#4A4744", "clearing": "#6E6A62", "inscription": "#B7B0A0"},
        "hourMarks": "spawns[] in seat order I-X, clockwise from 12",
        "wallHeights": {"hourStones": 1.2, "cart": 3.0, "rim": 2.4},
        "landmarks": [
            landmark("lampwright_cart", "Lampwright's cart", C, (2.6, 2.6), 3.0, "the shared shop: a two-wheeled stall (body 3 m) with a thin lamp mast; its 1.3 m footprint is a wall"),
            *[landmark(f"hour_mark_{k + 1}", f"hour-mark {k + 1}", clock(26.0, 36 * k), (2.4, 2.4), 0.02, "flush carved numeral, lit in its seat colour", flush=True) for k in range(10)],
            *[landmark(f"hour_stone_{k + 1}", "hour-stone", clock(19.5, 36 * k + 18), (1.8, 1.8), 1.2, "low carved block (a wall)") for k in range(10)],
            landmark("fair_stand_nw", "fair stand", (4.0, 4.0), (6, 6), 3.0, "stepped stone terrace of the Shadowless Noon fair, pale, inside the glare"),
            landmark("fair_stand_ne", "fair stand", (W - 4.0, 4.0), (6, 6), 3.0, "as NW"),
            landmark("fair_stand_sw", "fair stand", (4.0, H - 4.0), (6, 6), 1.0, "south of the plate: kept low"),
            landmark("fair_stand_se", "fair stand", (W - 4.0, H - 4.0), (6, 6), 1.0, "south of the plate: kept low"),
        ],
    }
    rec = {
        "$comment": "Generated by _design/tools/map_gen.py (edit there, then run it and _harness/probe_maps.ts). Layout truth for the sim, the Blender scene and the minimap; landmark and art brief: _design/maps/map_fray_landmarks.md.",
        "id": "map_fray",
        "name": "Noonplate",
        "desc": "The needle's round seat-stone at the Shadowless Noon. Ten hour-marks ring the plate, the Lampwright's cart stands at its centre, and Sunmotes fall on the stone.",
        "size": [W, H],
        "navCell": 0.5,
        "walls": wall_rings,
        "thickets": thickets,
        "lanes": [],
        "bases": [],
        "spawns": spawns,
        "structures": [],
        "camps": [],
        "pickups": pickups,
        "shops": [{"at": P(C), "radius": 4.0}],
        "art": art("map_fray", "mus_match_fray", terrain),
        "camera": CAMERA,
    }
    return rec, open_ground


def write(rec, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{rec['id']}.json")
    txt = json.dumps(rec, indent=1, ensure_ascii=False)
    # keep coordinate pairs on one line
    import re
    txt = re.sub(r'\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]', r'[\1, \2]', txt)
    with open(path, 'w') as f:
        f.write(txt + '\n')
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'content', 'maps'))
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    for fn in (build_rift, build_bridge, build_fray):
        rec, _ = fn()
        if a.only and a.only not in rec['id']:
            continue
        p = write(rec, a.out)
        print(f"{rec['id']}: {len(rec['walls'])} walls, {len(rec['thickets'])} thickets, {len(rec['structures'])} structures, "
              f"{len(rec['camps'])} camps, {len(rec['pickups'])} pickups -> {os.path.relpath(p, ROOT)}")


if __name__ == '__main__':
    sys.exit(main())
