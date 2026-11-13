"""
Re-bake the spine flexion in the attack clips so a gladiator SWINGS instead of
folding in half to reach.

THE DEFECT, measured
--------------------
The forward lean is authored into the clips, not added by the runtime — a grep
over runtime/ finds no rotation.x or rotation.z write on any actor root, and the
only angular term _combatIdle applies is 0.045 rad of YAW, which cannot produce
pitch. Measured world torso pitch, identical across murmillo, retiarius and
thraex (the clips are byte-identical):

    anim_idle     -3.9 deg,  6.2 deg total tilt
    anim_parry    +7.5 deg, 11.1 deg  - inside the human band, LEFT ALONE
    anim_slash1  +23.2 deg at frame 0, 27.2 deg total
    anim_slash2  +26.8 deg at frame 0, peaking +36.0 deg, 40.4 deg total

At slash2's peak the head sits 17.7 cm AHEAD of the toes. That is a man falling
over, not a man swinging. And it is a thoracic hunch rather than a hip hinge:
the flexion splits Hips 16% / Spine02 37% / Spine01 33% / Spine 14%, so
two-thirds of it is in the chest. That is exactly "he fully bends his body".

THE RIG IS REVERSE-NAMED
------------------------
Verified from the node graph: Hips -> Spine02 -> Spine01 -> Spine -> neck ->
Head. Spine02 is the LOWEST spine joint and Spine is the highest. Any correction
that assumes the obvious ordering redistributes the bend the wrong way up the
chain.

WHAT THIS DOES
--------------
For each attack clip, per frame: measure the world torso tilt, compare it to an
authored target curve keyed on normalised clip time, and remove the difference
by counter-rotating the spine chain about its FLEXION axis only. Twist and roll
are untouched, because they carry the actual swing arc - 61.0 deg of trunk twist
in slash1, 59.4 in slash2 - and flattening those would delete the swing itself.

The correction is distributed 0.42 / 0.28 / 0.20 / 0.10 down the chain from the
hips, inverting the current chest-heavy split so the bend becomes a hip hinge.
The head is left level; an aim layer owns where it points.

Target curves - a real swing pitches into the blow and recovers, it does not
start folded:
    slash1   8 deg @ 0.00 -> 4 @ 0.20 -> 15 @ 0.365 (strike) -> 20 @ 0.50 -> 8 @ 1.0
    slash2   8 deg @ 0.00 -> 2 @ 0.30 -> 16 @ 0.435 (strike) -> 20 @ 0.55 -> 8 @ 1.0
Hard ceiling of 22 deg anywhere.

ORDER MATTERS: this must run BEFORE any additive conversion. slash1's pitch
curve is inverted - it starts at its maximum and dips negative mid-swing - so
making it additive against its own frame 0 first would leave the fighter leaning
30-38 degrees BACKWARD for the whole swing.

run:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --python games/colosseum/tools/rebake_spine.py -- [archetype ...]
"""

import bpy
import math
import os
import sys

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(GAME, "assets", "chars")

# Normalised-time -> target world torso tilt in degrees.
TARGETS = {
    "anim_slash1": [(0.00, 8), (0.20, 4), (0.365, 15), (0.50, 20), (0.75, 12), (1.00, 8)],
    "anim_slash2": [(0.00, 8), (0.30, 2), (0.435, 16), (0.55, 20), (0.80, 12), (1.00, 8)],
    "anim_finisher": [(0.00, 8), (0.35, 6), (0.50, 18), (0.70, 20), (1.00, 8)],
}
CEILING = 22.0
# Default to measuring. Pass --write to actually modify clip files.
MEASURE_ONLY = "--write" not in sys.argv

# Correction weights from the hips up. Inverts the chest-heavy split so the
# bend becomes a hip hinge. Names are the REAL order, not the labels.
CHAIN = [("Hips", 0.42), ("Spine02", 0.28), ("Spine01", 0.20), ("Spine", 0.10)]


def target_at(curve, u):
    """Piecewise-linear sample of a target curve."""
    if u <= curve[0][0]:
        return curve[0][1]
    for i in range(1, len(curve)):
        t0, v0 = curve[i - 1]
        t1, v1 = curve[i]
        if u <= t1:
            k = (u - t0) / max(1e-6, t1 - t0)
            return v0 + (v1 - v0) * k
    return curve[-1][1]


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.actions, bpy.data.armatures, bpy.data.objects, bpy.data.meshes):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def load(path):
    clear()
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    return arms[0] if arms else None


def torso_tilt(arm):
    """World angle of the hips->neck vector away from vertical, in degrees."""
    pb = arm.pose.bones
    if "Hips" not in pb or "neck" not in pb:
        return None
    hips = (arm.matrix_world @ pb["Hips"].matrix).translation
    neck = (arm.matrix_world @ pb["neck"].matrix).translation
    v = neck - hips
    if v.length < 1e-6:
        return None
    v.normalize()
    # BLENDER IS Z-UP. Measuring against +Y here (the three.js convention)
    # reported a 92-degree "torso pitch" on every clip — which is not a pitch,
    # it is the angle to the wrong axis — and a correction computed from it
    # was applied to real clip files before the number was sanity-checked.
    # Restored from backup; the lesson is that a measurement gets validated
    # against a known value BEFORE anything writes.
    horiz = math.sqrt(v.x * v.x + v.y * v.y)
    return 90.0 - math.degrees(math.atan2(v.z, horiz))


def rebake(archetype, clip):
    src = os.path.join(CHARS, archetype, clip + ".glb")
    if not os.path.exists(src):
        return None
    # The clip GLBs carry the skeleton and the action but NO MESH, and
    # Blender's glTF importer does not build an ARMATURE object for a mesh-less
    # file — it lands as plain empties, so there are no pose bones to key.
    # Load the rigged base first (mesh + armature), then import the clip and
    # bind its action onto that armature.
    base = os.path.join(CHARS, archetype, "base.glb")
    arm = load(base)
    if not arm:
        return None
    before_actions = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=src)
    fresh = [a for a in bpy.data.actions if a.name not in before_actions]
    if not fresh:
        return None
    action = fresh[0]
    arm.animation_data_create()
    arm.animation_data.action = action
    f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])
    curve = TARGETS[clip]

    before_peak = 0.0
    after_peak = 0.0
    scene = bpy.context.scene

    for fr in range(f0, f1 + 1):
        scene.frame_set(fr)
        bpy.context.view_layer.update()
        cur = torso_tilt(arm)
        if cur is None:
            continue
        before_peak = max(before_peak, abs(cur))
        u = (fr - f0) / max(1, f1 - f0)
        want = min(CEILING, target_at(curve, u))
        delta = math.radians(cur - want)          # how much to take OUT
        if abs(delta) < 1e-4:
            continue
        for name, w in CHAIN:
            if name not in arm.pose.bones:
                continue
            pbone = arm.pose.bones[name]
            pbone.rotation_mode = "XYZ"
            # Flexion only. Twist and roll carry the swing arc and are left be.
            pbone.rotation_euler.x -= delta * w
            pbone.keyframe_insert("rotation_euler", frame=fr)

    # Re-measure
    for fr in range(f0, f1 + 1):
        scene.frame_set(fr)
        bpy.context.view_layer.update()
        t = torso_tilt(arm)
        if t is not None:
            after_peak = max(after_peak, abs(t))

    if MEASURE_ONLY:
        return (before_peak, after_peak)

    out = os.path.join(CHARS, archetype, clip + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=True, export_apply=False, export_yup=True,
    )
    return (before_peak, after_peak)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    archetypes = argv if argv else [
        d for d in os.listdir(CHARS)
        if not d.startswith("_") and os.path.isdir(os.path.join(CHARS, d))
    ]
    print("SPINE RE-BAKE")
    for a in archetypes:
        for clip in TARGETS:
            r = rebake(a, clip)
            if r:
                print("  %-14s %-14s peak tilt %5.1f -> %5.1f deg" % (a, clip, r[0], r[1]))
    print("REBAKE_DONE")


if __name__ == "__main__":
    main()
