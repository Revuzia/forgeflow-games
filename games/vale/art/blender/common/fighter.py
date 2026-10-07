"""The per-fighter pipeline: one call builds a fighter (or a skin) end to end.

A fighter script (art/blender/fighters/<id>.py, see _template.py) is a module with:

    ID, PROPORTIONS, SHAPE?, PALETTE, CARD, MOTION, SKINS
    rig_extras(ctx)          optional: x_ chains / sockets (ctx.chains[name] = [bones])
    model(ctx) -> [Part]     hand-authored modelling sections
    clip_overrides(ctx)      optional: {clip: anim.Clip} bespoke clips (replace or add)
    OUT_SUBDIR?              optional output folder override (the proof uses `_proof`)

`main(module)` parses the common args and runs: rig -> model -> lows/binding -> UV + bake ->
clips -> GLB export -> optimise -> renders -> skins -> .blend cache + build report.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

import bpy
from mathutils import Vector

from . import mesh, scene


@dataclass
class Part:
    """One modelled piece.

    high: detailed bake source (organic sculpt); low: the game mesh. Give one or both:
      * only `high` + `tris`: the low is a decimated copy (organic parts)
      * only `low`: hard-surface/mid-poly part; it is its own bake source
    bind: 'auto' (bone heat + fallback) | 'bone:<name>' (rigid) |
          ('zblend', lower_bone, upper_bone, z0, z1) (two-bone blend by height) |
          ('dblend', bone_a, bone_b, origin, axis, d0, d1) (blend by distance along axis) |
          ('chain', chain_name, root_bone) (x_ chain cloth/tail) | 'transfer' (copy body weights)
    Materials named `accent` (or gem_*/glow_*) stay emissive/unbaked; parts made only of such
    materials are exported as a separate mesh with the material untouched.
    """
    name: str
    high: bpy.types.Object | None = None
    low: bpy.types.Object | None = None
    tris: int | None = None
    bind: object = "auto"
    uv_weight: float = 1.0


@dataclass
class Context:
    spec: object
    info: object = None                      # rig.RigInfo
    mats: dict = field(default_factory=dict)
    col: bpy.types.Collection | None = None
    chains: dict = field(default_factory=dict)
    skin: dict | None = None                 # the skin being built (None = base)
    palette: dict = field(default_factory=dict)
    body_high: bpy.types.Object | None = None
    targets: list = field(default_factory=list)
    args: object = None
    timer: object = None
    report: dict = field(default_factory=dict)


def bind_zblend(obj, arm, lower: str, upper: str, z0: float, z1: float) -> None:
    """Weights blend from `lower` (below z0) to `upper` (above z1) — plates spanning two bones."""
    obj.vertex_groups.clear()
    ga, gb = obj.vertex_groups.new(name=lower), obj.vertex_groups.new(name=upper)
    for v in obj.data.vertices:
        t = mesh.smoothstep(z0, z1, (obj.matrix_world @ v.co).z)
        if 1 - t > 1e-3:
            ga.add([v.index], 1 - t, "REPLACE")
        if t > 1e-3:
            gb.add([v.index], t, "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def bind_dblend(obj, arm, a: str, b: str, origin, axis, d0: float, d1: float) -> None:
    """Weights blend from `a` to `b` by distance along `axis` from `origin` (pauldrons: shoulder
    at the dome top, upper arm toward the lames)."""
    obj.vertex_groups.clear()
    ga, gb = obj.vertex_groups.new(name=a), obj.vertex_groups.new(name=b)
    o, ax = Vector(origin), Vector(axis).normalized()
    for v in obj.data.vertices:
        t = mesh.smoothstep(d0, d1, ((obj.matrix_world @ v.co) - o).dot(ax))
        if 1 - t > 1e-3:
            ga.add([v.index], 1 - t, "REPLACE")
        if t > 1e-3:
            gb.add([v.index], t, "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def bind_part(ctx: Context, part: Part, obj, body_low=None) -> dict:
    arm = ctx.info.armature
    b = part.bind
    if b == "auto":
        return mesh.bind_auto(obj, arm)
    if isinstance(b, str) and b.startswith("bone:"):
        mesh.bind_rigid(obj, arm, b[5:])
    elif b == "transfer":
        mesh.transfer_weights(body_low, obj)
        mesh.add_armature_modifier(obj, arm)
        mesh.parent_keep(obj, arm)
    elif isinstance(b, tuple) and b[0] == "zblend":
        bind_zblend(obj, arm, *b[1:])
    elif isinstance(b, tuple) and b[0] == "dblend":
        bind_dblend(obj, arm, *b[1:])
    elif isinstance(b, tuple) and b[0] == "chain":
        mesh.chain_weights(obj, arm, ctx.chains[b[1]], b[2])
    else:
        raise ValueError(f"part {part.name}: unknown bind {b!r}")
    mesh.limit_weights(obj)
    return {}


def main(spec) -> None:  # replaced below once the full pipeline is defined
    from . import pipeline
    pipeline.main(spec)
