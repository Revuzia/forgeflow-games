# CRESTBOUND — THE KEEP kit driver (runs INSIDE Blender, headless):
#   blender.exe --background --factory-startup --python build_kit.py -- --piece <name> [--tex N] [--no-render]
# Builds one piece from pieces.py, bakes its atlas, exports the GLB, renders the turntable,
# re-imports the GLB in a fresh scene as the independent check, and writes _manifest/<piece>.json.
import sys, os, json, time, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import kitlib as K
import pieces as P

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opts = {'--piece': None, '--tex': None, '--no-render': False, '--dry': False}
i = 0
while i < len(argv):
    a = argv[i]
    if a in ('--no-render', '--dry'):
        opts[a] = True
        i += 1
    else:
        opts[a] = argv[i + 1]
        i += 2
name = opts['--piece']
if not name:
    print('usage: -- --piece <name>')
    sys.exit(2)

T0 = time.time()


def stamp(msg):
    K.log(f'[{time.time()-T0:6.1f}s] {msg}')


K.reset_scene()
stamp('scene reset')
pc = P.build(name)
if opts['--tex']:
    pc.tex = int(opts['--tex'])
stamp(f'built {name}: {len(pc.parts)} parts, tex {pc.tex}')

# --- assemble ---------------------------------------------------------------
main = K.join(pc.parts, name)
stamp('joined')
K.mark_sharp_and_smooth(main)
stamp('sharp/smooth')
K.unwrap(main)
stamp('unwrapped')
extra = []
for ob in pc.separate:
    K.apply_mods(ob)
    K.mark_sharp_and_smooth(ob)
    K.unwrap(ob, margin=0.0)
    if getattr(ob, 'kit_uvrect', False) or ob.get('kit_uvrect'):
        K.set_uv_rect(ob, lambda p: True)
    extra.append(ob)
tris_main = K.tri_count(main)
tris_extra = sum(K.tri_count(o) for o in extra)
K.log(f'tris main {tris_main} extra {tris_extra} total {tris_main + tris_extra} (budget {pc.budget})')
if opts['--dry']:
    K.log(f'DRY {name} tris={tris_main + tris_extra} budget={pc.budget} {"OK" if tris_main + tris_extra <= pc.budget else "OVER"}')
    sys.exit(0)

# --- bake --------------------------------------------------------------------
maps = K.bake_maps(main, name, pc.tex)
stamp('baked')
slots = K.remap_materials(main, name, maps)
for ob in extra:
    # separate nodes (the painting canvas) carry a plain untextured material the game replaces
    m = bpy.data.materials.new(f'{name}_{ob.name}')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    col = ob.get('kit_color', (0.42, 0.38, 0.32))
    b.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1)
    b.inputs['Roughness'].default_value = 0.7
    ob.data.materials.clear()
    ob.data.materials.append(m)
    ob.parent = main

# --- rig ----------------------------------------------------------------------
arm = None
clips = []
objs = [main] + extra
if pc.rig:
    arm, actions = pc.rig(main)
    objs.append(arm)
    for a in actions:
        clips.append({'name': a.name, 'seconds': round((a.frame_range[1] - a.frame_range[0]) / K.FPS, 3), 'frames': int(a.frame_range[1] - a.frame_range[0])})
    if pc.rig_check:
        pc.rig_check(main, arm, actions)

bounds = K.bounds_gltf([main] + extra)
bones = len(arm.data.bones) if arm else 0
node_names = [o.name for o in objs]
extra_names = [o.name for o in extra]

# --- export -------------------------------------------------------------------
glb = os.path.join(K.OUT_DIR, f'{name}.glb')
size = K.export_glb(objs, glb)
stamp(f'exported {glb} {size/1e6:.2f} MB')

# --- turntable ----------------------------------------------------------------
shots = []
if not opts['--no-render']:
    t = time.time()
    shots = K.render_turntable([main] + extra, name, closeup=pc.closeup)
    K.log(f'turntable {len(shots)} frames {time.time()-t:.1f}s')

# --- independent check: re-import the GLB in a fresh scene --------------------
chk = K.reimport_check(glb)
ok = (chk['tris'] == tris_main + tris_extra) and (chk['bones'] == bones) and (len(chk['clips']) == len(clips))
entry = {
    'name': name, 'file': f'{name}.glb', 'kind': pc.kind, 'bytes': size,
    'tris': tris_main + tris_extra, 'tris_budget': pc.budget, 'tris_ok': (tris_main + tris_extra) <= pc.budget,
    'bones': bones, 'clips': clips, 'bounds': bounds, 'pivot': pc.pivot,
    'front': '+Z (glTF) — the face that looks into the room',
    'materials': slots + [f'{name}_{n}' for n in extra_names],
    'nodes': node_names,
    'textures': {'atlas': pc.tex, 'maps': ['albedo (sRGB, webp)', 'normal (tangent, OpenGL +Y, webp)', 'orm (R=occlusion G=roughness B=metallic, webp)']},
    'notes': pc.notes,
    'reimport': chk, 'reimport_ok': ok,
    'seconds': round(time.time() - T0, 1),
}
os.makedirs(K.MAN_DIR, exist_ok=True)
with open(os.path.join(K.MAN_DIR, f'{name}.json'), 'w', encoding='utf-8') as f:
    json.dump(entry, f, indent=1)
K.log('MANIFEST', json.dumps({k: entry[k] for k in ('name', 'tris', 'tris_ok', 'bones', 'clips', 'bytes', 'reimport_ok')}))
K.log(f'DONE {name} in {time.time()-T0:.1f}s')
