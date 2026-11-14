"""
Write <kit>/manifest.json for the NIM kit — every number measured off the shipped
GLB by inspect_glb.py (tris, bones, clips, bounds, textures), plus the build
metadata (bone positions, eye/scarf rest data) and the integration notes.

    python make_manifest.py --kit <kit dir>
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inspect_glb import inspect

kit = os.path.abspath(sys.argv[sys.argv.index('--kit') + 1])
glb = os.path.join(kit, 'nim.glb')
rep = inspect(glb)
model = json.load(open(os.path.join(kit, '_work', 'model_meta.json')))
clips = json.load(open(os.path.join(kit, '_work', 'clips_meta.json')))
anims = {a['name']: a for a in rep['animations']}

tex = []
tex_bytes = 0
for name in ('nim_albedo.png', 'nim_normal.png', 'nim_orm.png'):
    p = os.path.join(kit, name)
    if os.path.exists(p):
        b = os.path.getsize(p); tex_bytes += b
        tex.append({'file': name, 'bytes': b, 'size': model.get('atlas')})
embedded = sum((im['bytes'] or 0) for im in rep['images'])

bounds = rep['bounds']
manifest = {
    'name': 'Nim',
    'kit': 'nim',
    'file': 'nim.glb',
    'bytes': rep['bytes'],
    'tris': rep['tris'],
    'tris_by_primitive': [{'mesh': p['mesh'], 'material': p['material'], 'tris': p['tris']} for p in rep['primitives']],
    'bones': rep['skins'][0]['joint_count'] if rep['skins'] else 0,
    'bone_names': rep['skins'][0]['joints'] if rep['skins'] else [],
    'bone_parent': rep['bone_parent'],
    'bone_world_bind': rep['bone_world'],
    'bones_with_rest_rotation': rep['bones_with_rest_rotation'],
    'clips': [{'name': a['name'], 'duration': a['duration'], 'loop': bool(next((c['loop'] for c in clips if c['name'] == a['name']), False)),
               'channels': a['channels']} for a in rep['animations']],
    'clip_count': len(rep['animations']),
    'bounds': {'min': bounds['min'], 'max': bounds['max'], 'size': bounds['size']},
    'height_m': bounds['max'][1] - bounds['min'][1],
    'pivot': 'origin = between the soles on the ground plane (y = 0), +Y up, -Z forward (yaw 0), +X = Nim\'s right; 1 unit = 1 m',
    'textures': tex,
    'textures_bytes_on_disk': tex_bytes,
    'textures_bytes_embedded': embedded,
    'materials': rep['materials'],
    'extensions': rep['extensions'],
    'draco': rep['draco'],
    'eyes': model['eyes'],
    'scarf_rest': model['scarf_rest'],
    'rig_pivot_y': 0.62,
    'notes': [
        'Built headless in Blender 5.1 (bpy) from the numbers in runtime/player/hero.js: proportions P, palette COL, '
        'headDirRadius skull, eye/goggle/brow/mouth constants, boot/pack/limb builders. No asset services, no Draco.',
        'RIG: bone names and hierarchy are hero.js\'s exactly (rig > hips > spine > chest > neck > head; chest > shoulderR > '
        'upperArmR > lowerArmR > handR; hips > upperLegR > lowerLegR > footR; L mirrored). EVERY joint has an identity rest '
        'rotation, so bone-local axes == the rig frame: a limb runs down -Y and a +X rotation swings its tip forward (-Z), '
        'which is the convention the hero.js pose writers assume. Path (a): create hero.bones[name] from the skinned '
        'skeleton by bone name and the existing pose code drives this mesh unchanged; `rig` is the bone hero.js writes '
        'squash/flip/lean onto (rotate about RIG_PIVOT_Y 0.62 via the same T = S.p - R.S.p pivot maths).',
        'The mesh is bound with limbs straight down (no rest A-pose); hero.js applies its own rest rotations '
        '(upperArm +-0.165 z, lowerArm 0.32 x, ...) on top, exactly as it does for its procedural parts.',
        'Extra bones (additive, not in hero.js): eyes (blink pivot at the eye rest height: scale y), eyeR/eyeL (eyeball centres, '
        'sclera + catchlight bead), pupilR/pupilL (children at the same centres, iris caps: rotate for look-at — 0.16 rad here '
        '== hero.js\'s 0.042 rad about the head origin), hairTuft (crown tufts), scarf1..scarf7 (the 7-link chain, chained '
        'under neck, link i starts at scarf_rest[i-1]; ring k of the ribbon is weighted 50/50 to links k and k+1).',
        'SCARF: scarf1 head = the runtime anchor (neck + SIDE 0.07, UP 0.03, BACK 0.135). To drive it from the verlet: set '
        'each link bone\'s WORLD matrix = T(particle_i) * R(rest_dir_i -> current_dir_i) — rest directions are '
        'scarf_rest[i] - scarf_rest[i-1]; solve in world space per doctrine. The scarf faces are their own material '
        '(nim_scarf) sharing the atlas, so the realm tint is material.color on that primitive alone. A static wrap ring on '
        'the neck bone (nim_scarf material too) gives the tail something to hang from.',
        'CLIPS: one per CONTRACT s11 state (+walk, +bonk) sampled at 60 fps from a pure-python port of the hero.js pose writers '
        '(_tools/blender/nim/nim_poses.py) including the cyclic layer, the driven flips (jump3 +2pi, backflip -2pi, sideflip roll, '
        'pound yaw 1 + 2.4 t turns), the rig pivot maths and a steady-state foot-plant/sole clamp on grounded states. '
        'Root motion is IN the rig bone (rotation, pivot translation, squash scale) — strip rig.scale if squash is driven '
        'procedurally. The run clip is exactly one stride (1.90 m at 9.0 m/s); loop clips are marked in `loop`. Durations '
        'are quantised to 60 fps frames.',
        'MATERIALS: nim_body / nim_scarf = one 2K atlas (albedo sRGB, tangent normal, ORM: R = AO (baked, floored at 0.35), '
        'G = roughness, B = metallic) — glTF metallicRoughnessTexture + occlusionTexture share the ORM image. nim_lens = '
        'BLEND alpha 0.30 dome (KHR_materials_clearcoat), its own primitive so it sorts. Per doctrine, repair nothing at load: '
        'metallic/roughness factors are 1.0 with the texture carrying the values, emissive is black (lens 0.04 aside).',
        'BUDGETS: hero <= 12k tris (measured above, lens included); atlas 2K; textures total below.',
        'DEVIATIONS from hero.js, all deliberate: the front hairline sits at 0.87R (hero.js 0.60R put it behind the '
        'goggle lenses and it read as a brown blob through the glass); the goggle strap is an open arc that stops at the '
        'cups instead of a full band under the lenses; the scarf ribbon is 0.085/0.046 half-width (hero.js 0.105/0.050) '
        'and gets a knit wrap ring + knot on the neck; hair strands radiate from the crown.',
        'KNOWN LIMITS (measured by the pose sweep, 2061 frames): sole penetration <= 3 mm on every grounded clip except '
        'slideRecover, where the authored scramble (rig pitch -1.5 -> -0.2 with the knees folding) swings the boots up to '
        '0.39 m under the floor mid-transition — the runtime foot IK receives the same authored input. Loop clips whose '
        'hero.js oscillators have incommensurate periods (idle, wallslide, swimIdle) close with a small seam; crossfade '
        'them. Squash/stretch lives in rig.scale (land/hardLand/poundLand 0.85/0.79, jump family 1.12) and is volume-'
        'preserving in XZ like the runtime.',
    ],
}
out = os.path.join(kit, 'manifest.json')
with open(out, 'w') as f:
    json.dump(manifest, f, indent=1)
print('wrote', out)
print(json.dumps({k: manifest[k] for k in ('tris', 'bones', 'clip_count', 'bounds', 'height_m', 'bytes',
                                            'textures_bytes_on_disk', 'textures_bytes_embedded', 'draco', 'extensions')}, indent=1))
