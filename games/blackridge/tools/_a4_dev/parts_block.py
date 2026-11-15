# ---------------------------------------------------------------------------
# ANIMATABLE PARTS (presentation pass): the magazine and the pump forend leave the
# base mesh as their OWN nodes ("mag", "pump") so viewmodel.js can move them with
# the reload / pump animations. Meshy bases are one fused surface, so the part is
# cut by a face-centre box; the hole it leaves in the base is capped (dark) and
# the part itself is capped at the cut, so neither shows a torn opening.
# ---------------------------------------------------------------------------
def _region_pred(r):
    y0, y1 = r.get("y0", -9.0), r.get("y1", 9.0)
    zlo, zhi = r.get("z_min", -9.0), r.get("z_max", 9.0)
    xa = r.get("x_abs", 9.0)

    def pred(c):
        return y0 <= c.y <= y1 and zlo <= c.z <= zhi and abs(c.x) <= xa
    return pred


def split_region(base, name, region):
    pred = _region_pred(region)
    # --- the part: a copy keeping ONLY the region's faces
    part = base.copy()
    part.data = base.data.copy()
    part.name = name
    link(part)
    bm = bmesh.new()
    bm.from_mesh(part.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not pred(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    n_part = len(bm.faces)
    bnd = [e for e in bm.edges if e.is_boundary]
    if bnd:
        try:
            filled = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
            for f in filled.get("faces", []):
                f.material_index = 1
        except Exception:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(part.data)
    bm.free()
    # --- the base: region faces removed, hole capped
    bm = bmesh.new()
    bm.from_mesh(base.data)
    bm.faces.ensure_lookup_table()
    gone = [f for f in bm.faces if pred(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    pad = 0.012
    y0, y1 = region.get("y0", -9.0) - pad, region.get("y1", 9.0) + pad
    zhi = region.get("z_max", 9.0) + pad
    ring = [e for e in bm.edges if e.is_boundary and all(
        y0 <= v.co.y <= y1 and v.co.z <= zhi for v in e.verts)]
    if ring:
        try:
            filled = bmesh.ops.holes_fill(bm, edges=ring, sides=0)
            for f in filled.get("faces", []):
                f.material_index = 1
        except Exception:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(base.data)
    bm.free()
    base.data.update()
    part.data.update()
    print("A4SPLIT %s: %d faces split out" % (name, n_part))
    return part


def author_mag(region, mats):
    """A magazine box for weapons whose magazine lives inside the grip (pistol,
    SMG): the box is hidden inside the base mesh at rest and only its floor plate
    shows below the grip; the reload slides it out and a fresh one back in."""
    cy, wy, wx = region["cy"], region["wy"], region["wx"]
    z0, z1 = region["z0"], region["z1"]
    body = box("mag_body", 0, cy, (z0 + z1) / 2, wx, wy, z1 - z0, mats["metal"], bevel=0.0012)
    plate = box("mag_plate", 0, cy, z0 - 0.003, wx + 0.004, wy + 0.004, 0.007, mats["body"], bevel=0.0012)
    bpy.context.view_layer.update()
    for o in (body, plate):
        apply_all(o)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    body.select_set(True)
    plate.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active
    m.name = "mag"
    print("A4SPLIT mag: authored box")
    return m


def build_scope_solid(cfg, bore_z, mats):
    """SOLID optic for the scoped weapon. At full ADS the game replaces the view
    with a full-screen scope overlay and hides the 3D gun, so this model only has
    to read as a believable 3-9x scope at the hip, in the raise/lower and through
    the zoom-in. (The old bored-tube optic existed so the player could look
    THROUGH it; that is now the overlay's job.) Axis z = bore + axis_rel, which is
    also the ADS sight line (SOCKET_sight rides it)."""
    sc = cfg["scope"]
    z = bore_z + sc["axis_rel"]
    y0, y1 = sc["y_ocular"], sc["y_obj"]
    OPT = mats["optic"]
    R = sc.get("tube_r", 0.0155)
    objs = []

    def seg(name, ya, yb, ra, rb, mat=OPT, verts=40):
        # ya rear (toward the eye), yb front; ra/rb radii at those ends
        o = cyl(name, 0, (ya + yb) / 2, z, rb, yb - ya, mat, axis="Y", verts=verts, r2=ra)
        o["uv_axial"] = (2.0, 0.0, 0.0)
        objs.append(o)
        return o
    seg("sc_eyecup", y0, y0 + 0.016, 0.0300, 0.0290, mats["grip"])           # rubber eyecup
    seg("sc_ocbell", y0 + 0.016, y0 + 0.056, 0.0290, 0.0200)                # eyepiece flare
    seg("sc_tube", y0 + 0.056, y1 - 0.070, R, R)
    seg("sc_objtaper", y1 - 0.070, y1 - 0.040, R, 0.0265)                   # objective flare
    seg("sc_objbell", y1 - 0.040, y1, 0.0265, 0.0272)
    seg("sc_objrim", y1 - 0.004, y1 + 0.003, 0.0285, 0.0285, mats["metal"])  # lens ring
    # lens glass: ocular (faces the shooter) and objective
    objs.append(disc("sc_glass_oc", 0, y0 + 0.0185, z, 0.0192, mats["glass"], axis="Y", verts=40))
    objs.append(disc("sc_glass_obj", 0, y1 - 0.003, z, 0.0262, mats["glass"], axis="Y", verts=40))
    # turrets: elevation (top), windage (right), parallax (left, smaller)
    ty = sc.get("y_turret", (y0 + y1) * 0.5)
    for nm, axis, sgn, rr, ln, off in (
            ("tur_up", "Z", 1, 0.0095, 0.016, R + 0.0050),
            ("tur_up_cap", "Z", 1, 0.0075, 0.007, R + 0.0155),
            ("tur_rt", "X", 1, 0.0095, 0.016, R + 0.0050),
            ("tur_rt_cap", "X", 1, 0.0075, 0.007, R + 0.0155),
            ("tur_lf", "X", -1, 0.0070, 0.012, R + 0.0035)):
        if axis == "Z":
            o = cyl("sc_" + nm, 0, ty, z + sgn * off, rr, ln, OPT, axis="Z", verts=24)
        else:
            o = cyl("sc_" + nm, sgn * off, ty, z, rr, ln, OPT, axis="X", verts=24)
        o["uv_axial"] = (2.0, 0.0, 0.0)
        objs.append(o)
    # mounts: two rings clamped to the receiver rail
    rail_z = bore_z + sc.get("mount_base_rel", 0.045)
    for i, my in enumerate(sc.get("mounts", (y0 + 0.075, y1 - 0.085))):
        h = max(0.008, (z - R * 0.9) - rail_z)
        objs.append(box("sc_mount%d" % i, 0, my, rail_z + h / 2, 0.030, 0.020, h, OPT))
        objs.append(box("sc_clamp%d" % i, 0, my, z - R * 0.35, 0.0420, 0.017, R * 1.2, OPT))
        objs.append(box("sc_screw%d" % i, 0.0205, my, z - R * 0.35, 0.006, 0.008, 0.008, mats["metal"]))
    return objs


