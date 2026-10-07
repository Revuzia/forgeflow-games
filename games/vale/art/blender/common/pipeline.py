"""Fighter build orchestration (see fighter.py for the spec contract).

    rig -> materials -> model -> lows + binding -> join/split accent -> UV -> bake -> clips ->
    GLB -> optimise -> renders (portrait, splash, icon, turntable) -> skins -> report

Outputs (CONTRACT §12):
    art/out/fighters/<id>/<id>.glb  (+ <skin>.glb, portrait.png, splash.png, icon.png,
                                     <skin>_portrait.png, <skin>_splash.png)
    art/.cache/textures/fighters/<id>/  baked maps (embedded in the GLB; not shipped separately)
    art/renders/fighters/<id>/       turntable contact sheet, clip sheets, build_report.json
    art/.cache/fighters/<id>.blend   snapshot for `build.py portraits` (gitignored)
Specs may set OUT_SUBDIR to redirect (the proof writes to art/out/_proof, art/renders/_proof).
"""
from __future__ import annotations

import os

import bmesh
import bpy

from . import anim, bake, export, materials, mesh, rig, scene
from .fighter import Context, Part, bind_part


def _subdir(spec) -> str:
    """Output folder under art/out and art/renders: fighters/<id>; technical specs whose id starts
    with '_' (the proof, the template demo) never write into the shipped fighters/ tree."""
    sub = getattr(spec, "OUT_SUBDIR", None)
    if sub:
        return sub
    return spec.ID if spec.ID.startswith("_") else f"fighters/{spec.ID}"


def paths(spec) -> dict:
    sub = _subdir(spec)
    return {"out": os.path.join(scene.OUT_DIR, sub), "renders": os.path.join(scene.RENDERS_DIR, sub),
            "cache": os.path.join(scene.CACHE_DIR, "fighters", f"{spec.ID}.blend"),
            "textures": os.path.join(scene.CACHE_DIR, "textures", sub)}


def main(spec) -> None:
    def extra(p):
        p.add_argument("--skin", default="", help="build only this skin id")
        p.add_argument("--no-skins", action="store_true", help="base model only")
        p.add_argument("--skins-only", action="store_true")
        p.add_argument("--clip-sheet", action="store_true", help="also render a frame strip per clip")
    args = scene.parse_args(extra)
    skins = list(getattr(spec, "SKINS", []) or [])
    builds = [] if args.skins_only else [None]
    if args.skin:
        builds = [s for s in skins if s["id"] == args.skin]
        if not builds:
            raise SystemExit(f"unknown skin {args.skin!r}")
    elif not args.no_skins:
        builds += skins
    for skin in builds:
        build(spec, args, skin)


def _palette(spec, skin) -> dict:
    pal = dict(spec.PALETTE)
    if skin:
        pal.update(skin.get("palette", {}))
    return pal


def _bible(spec) -> bool:
    """Bible-vocabulary materials (honed stone, glass, carved wood, heavy cloth; no metal) are the
    production default; the pre-bible proof mannequin keeps the legacy set (MATERIAL_SET='legacy')."""
    return getattr(spec, "MATERIAL_SET", "bible") == "bible"


def _gradient(spec) -> dict:
    if _bible(spec):
        return materials.bible_gradient(spec.PROPORTIONS["height"], getattr(spec, "VALUE_GRADIENT_STOPS", None))
    g = dict(materials.DEFAULT_GRADIENT)
    g["z1"] = spec.PROPORTIONS["height"]
    g.update(getattr(spec, "VALUE_GRADIENT", {}) or {})
    return g


def prepare_lows(ctx: Context, parts: list[Part]) -> tuple:
    """Derive lows, bind them, tag parts, join; split kept (accent) faces into their own mesh.
    Returns (body_obj, accent_obj or None, highs_by_part, bake_col, stats)."""
    arm = ctx.info.armature
    src = scene.collection("_bake_src", ctx.col)
    stats = {}
    lows, highs = [], {}
    body_low = None
    order = sorted(range(len(parts)), key=lambda i: 0 if parts[i].bind == "auto" else 1)
    for i in order:
        part = parts[i]
        if part.low is None:
            low = mesh.duplicate(part.high, f"{part.name}_low", ctx.col)
            n = mesh.decimate_to(low, part.tris or 8000)
            high = part.high
        else:
            low = part.low
            high = part.high or mesh.duplicate(low, f"{part.name}_hi")
        scene.link(high, src)
        scene.link(low, ctx.col)
        mesh.set_part(low, i)
        kept_only = all(materials.is_kept(m) for m in low.data.materials if m)
        if not kept_only:
            highs[i] = [high]
        else:
            high.hide_render = True
        res = bind_part(ctx, part, low, body_low)
        if part.bind == "auto":
            body_low = body_low or low
            stats[f"bind_{part.name}"] = res
        stats[f"tris_{part.name}"] = mesh.tri_count(low, evaluated=False)
        lows.append(low)
    if body_low is not None and getattr(ctx.spec, "ARMOUR_CONFORM", True):
        # the body under rigid armour takes the armour's weights (no poke-through in any pose) and
        # faces nobody can see are dropped; cloth on x_ chains and held props are not covers
        covers = []
        for part, low in zip([parts[i] for i in order], lows):
            b = part.bind
            if low is body_low or b in ("auto", "transfer"):
                continue
            if isinstance(b, tuple) and b[0] == "chain":
                continue
            if isinstance(b, str) and b.startswith("bone:prop."):
                continue
            if all(materials.is_kept(m) for m in low.data.materials if m):
                continue
            covers.append(low)
        before = mesh.tri_count(body_low, evaluated=False)
        res = mesh.conform_under_armour(body_low, covers)
        res["body_tris_before"] = before
        res["body_tris_after"] = mesh.tri_count(body_low, evaluated=False)
        stats["armour_conform"] = res
        scene.log(f"armour conform: {res}")
    for h in [o for objs in highs.values() for o in objs]:
        h.hide_viewport = False
    body = mesh.join(lows, ctx.spec.ID)
    accent = split_kept(body, f"{ctx.spec.ID}_accent", ctx.col)
    # the glTF exporter calls Mesh.validate() and silently repairs the mesh mid-export; repair it
    # here instead so UVs, bakes, the report and the GLB all see the same topology
    for o in [body] + ([accent] if accent else []):
        f0 = len(o.data.polygons)
        if o.data.validate(verbose=False, clean_customdata=False):
            scene.log(f"validate {o.name}: repaired invalid geometry ({f0} -> {len(o.data.polygons)} faces)")
            stats[f"validate_{o.name}"] = f"{f0}->{len(o.data.polygons)}"
    src.hide_render = False
    return body, accent, highs, src, stats


def split_kept(obj, name: str, col):
    """Move faces whose material is kept (accent / gem_ / glow_) into a new object."""
    kept_idx = {i for i, m in enumerate(obj.data.materials) if m and materials.is_kept(m)}
    if not kept_idx:
        return None
    new = mesh.duplicate(obj, name, col)
    for o, keep_kept in ((obj, False), (new, True)):
        bm = mesh.obj_bm(o)
        dead = [f for f in bm.faces if (f.material_index in kept_idx) != keep_kept]
        bmesh.ops.delete(bm, geom=dead, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    # drop unused material slots on both
    for o in (obj, new):
        used = {p.material_index for p in o.data.polygons}
        mats = list(o.data.materials)
        remap = {}
        keep = [i for i in range(len(mats)) if i in used]
        for ni, oi in enumerate(keep):
            remap[oi] = ni
        idx = [remap[p.material_index] for p in o.data.polygons]
        o.data.materials.clear()
        for oi in keep:
            o.data.materials.append(mats[oi])
        o.data.polygons.foreach_set("material_index", idx)
        o.data.update()
    for m in new.data.materials:
        bake.strip_procedural(m)
    return new


def art_fragment(spec, clips_info: dict, mesh_top: float | None = None) -> dict:
    """EXACTLY a FighterArt (src/contracts/catalog.ts, zod .strict()): the CONTENT lane copies
    art.json verbatim into content/fighters/<id>.json `art`. Asset refs follow art/out -> assets/
    (CONTRACT §12). No extra keys here (strict schemas reject them): skins go to skins.json, build
    metadata (clip frames, impact, stride) to the build report."""
    sub = _subdir(spec)
    base = f"assets/{sub}"
    roles = anim.REQUIRED_CLIPS + anim.OPTIONAL_CLIPS
    sockets = rig.standard_sockets(getattr(spec, "SOCKETS", None))
    return {
        "model": f"{base}/{spec.ID}.glb", "portrait": f"{base}/portrait.png", "splash": f"{base}/splash.png",
        "icon": f"{base}/icon.png", "height": round(float(mesh_top or spec.PROPORTIONS["height"]), 2), "scale": 1,
        "runRefSpeed": float(spec.MOTION["run_ref_speed"]),
        "clips": {r: r for r in roles if r in clips_info},
        "sockets": sockets, "accentMaterial": "accent",
    }


def skins_fragment(spec) -> list:
    """SkinDef asset fields per skin (id, fighter, model, portrait, splash) for content/skins/<id>.json;
    the CONTENT lane adds name, tier, desc and releasedIn."""
    sub = _subdir(spec)
    base = f"assets/{sub}"
    return [{"id": s["id"], "fighter": spec.ID, "model": f"{base}/{s['id']}.glb",
             "portrait": f"{base}/{s['id']}_portrait.png", "splash": f"{base}/{s['id']}_splash.png"}
            for s in getattr(spec, "SKINS", [])]


def default_chains(ctx) -> list:
    return [anim.ChainCfg(bones) for bones in ctx.chains.values()]


def build(spec, args, skin=None) -> dict:
    sid = skin["id"] if skin else spec.ID
    T = scene.Timer(sid)
    P = paths(spec)
    scene.reset()
    col = scene.collection(spec.ID)
    ctx = Context(spec=spec, col=col, skin=skin, args=args, timer=T)
    ctx.palette = _palette(spec, skin)
    report = {"id": sid, "fighter": spec.ID, "skin": bool(skin)}
    with T.step("rig"):
        ctx.info = rig.build_rig(spec.PROPORTIONS, name=f"{spec.ID}_rig", col=col)
        if hasattr(spec, "rig_extras"):
            spec.rig_extras(ctx)
        errs = rig.check_standard(ctx.info.armature)
        if errs:
            raise SystemExit(f"rig errors: {errs}")
    with T.step("materials"):
        ctx.gradient = _gradient(spec)
        ctx.mats = (materials.bible_set(ctx.palette, ctx.gradient) if _bible(spec)
                    else materials.standard_set(ctx.palette, ctx.gradient))
        if hasattr(spec, "extra_materials"):
            ctx.mats.update(spec.extra_materials(ctx) or {})
    with T.step("model"):
        parts = spec.model(ctx)
    with T.step("lows_bind"):
        body, accent, highs, src, st = prepare_lows(ctx, parts)
        report["parts"] = st
    with T.step("uv"):
        weights = {i: p.uv_weight for i, p in enumerate(parts) if p.uv_weight != 1.0}
        bake.unwrap(body, weights=weights)
        report["uv_coverage"] = round(bake.uv_coverage(body), 3)
    size = getattr(spec, "TEXTURE_SIZE", 1024)
    tex_dir = P["textures"]                    # bake sources live in the cache; the GLB embeds them
    tex_name = sid
    if not args.no_bake:
        with T.step("bake"):
            res = bake.bake_asset(body, highs, tex_dir, name=tex_name, size=size,
                                  fast=args.fast, ao_extra=[accent] if accent else [],
                                  ao_into_base=getattr(spec, "AO_INTO_BASE",
                                                       materials.BIBLE_BAKE["ao"] if _bible(spec) else 0.0))
            report["bake"] = res["timings"]
    for o in list(bpy.data.objects):
        if o is not None and any(c.name == src.name for c in o.users_collection):
            o.hide_render = True
            o.hide_viewport = True
    body.name = sid if skin else spec.ID
    arm = ctx.info.armature
    arm["vale_kind"] = "skin" if skin else "fighter"
    arm["vale_id"] = sid
    arm["vale_fighter"] = spec.ID
    arm["vale_height"] = float(spec.PROPORTIONS["height"])
    arm["vale_run_ref_speed"] = float(spec.MOTION["run_ref_speed"])
    objs = [arm, body] + ([accent] if accent else [])
    report["tris"] = sum(mesh.tri_count(o, evaluated=False) for o in objs if o.type == "MESH")
    # FighterArt.height places the health bar: the measured top of the rest-pose mesh (crests,
    # horns and hats included), not the rig's crown height
    report["mesh_top_m"] = round(max((o.matrix_world @ v.co).z for o in objs if o.type == "MESH"
                                     for v in o.data.vertices), 3)
    clips_info = {}
    if skin is None:
        with T.step("clips"):
            overrides = spec.clip_overrides(ctx) if hasattr(spec, "clip_overrides") else {}
            skel = anim.Skeleton(ctx.info.armature)
            clips = anim.standard_clips(skel, spec.MOTION, overrides)
            chains = spec.chain_config(ctx) if hasattr(spec, "chain_config") else default_chains(ctx)
            clips_info = anim.write_clips(ctx.info.armature, clips, chains)
            report["clips"] = clips_info
    glb = os.path.join(P["out"], f"{sid}.glb")
    with T.step("export"):
        export.export_glb(objs, glb, animations=skin is None)
        report["glb_bytes_raw"] = os.path.getsize(glb)
    if not args.no_optimize:
        with T.step("optimize"):
            report["optimize"] = export.optimize(glb, fighter=getattr(spec, "GLB_COMPRESS", True))
    report["glb_bytes"] = os.path.getsize(glb)
    with T.step("load_test"):
        report["three_load_test"] = export.load_test(glb, skin=skin is not None,
                                                     budget_kb=1172 if getattr(spec, "GLB_COMPRESS", True) else None)
    if skin is None:
        frag = art_fragment(spec, clips_info, report["mesh_top_m"])
        scene.write_json(os.path.join(P["out"], "art.json"), frag)
        if getattr(spec, "SKINS", None):
            scene.write_json(os.path.join(P["out"], "skins.json"), skins_fragment(spec))
    if not args.no_render:
        from . import render
        with T.step("render"):
            report["renders"] = render.fighter_renders(ctx, objs, P, skin, fast=args.fast,
                                                       clip_sheet=getattr(args, "clip_sheet", False))
    with T.step("three_qa"):
        # the in-engine view (three.js r186): gameplay-camera facings, key poses, close-ups
        qa = export.three_qa(glb, os.path.join(P["renders"], f"three_{sid}.png"))
        if getattr(args, "clip_sheet", False) and skin is None:
            qa["clip_sheet"] = export.three_qa(glb, os.path.join(P["renders"], f"three_clips_{sid}.png"),
                                               clips=True, cell=220).get("out")
        report["three_qa"] = qa
        if qa.get("ok") and qa.get("facing") and qa["facing"][1] < 0.95:
            raise SystemExit(f"{sid}: in three.js the model faces {qa['facing']} (x, z), not +Z (CONTRACT §2)")
        if qa.get("ok") and not (1.5 <= qa.get("accentPct", 0) <= 6.0):
            scene.log(f"WARNING {sid}: accent covers {qa.get('accentPct')}% of the silhouette at the game "
                      f"camera (bible: about 2-6%, top half) - the team tint will not read")
    if skin is None:
        with T.step("cache"):
            scene.save_blend(P["cache"])
    report["timings"] = T.report()
    report["run_ref_speed"] = spec.MOTION["run_ref_speed"]
    report["height_m"] = spec.PROPORTIONS["height"]
    scene.write_json(os.path.join(P["renders"], f"build_report_{sid}.json"), report)
    scene.log(f"{sid}: {report['tris']} tris, {report['glb_bytes'] / 1024:.0f} KiB, total {T.total():.1f}s")
    return report
