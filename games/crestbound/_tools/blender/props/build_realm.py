# CRESTBOUND prop kit driver (headless):
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python build_realm.py -- \
#        <realm> <kit_out_dir> [--only a,b,c] [--no-render] [--atlas 2048] [--small 1024]
# Writes <kit_out_dir>/<realm>/*.gltf|*.bin + textures/, <kit_out_dir>/_turntable/<realm>_*.png and
# <kit_out_dir>/<realm>/manifest.json — every number measured in bpy.
import sys, os, json, time, importlib, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
args = sys.argv[sys.argv.index('--') + 1:]
realm = args[0]
out = args[1]
only = None
render = True
atlas = 2048
small = 1024
i = 2
while i < len(args):
    a = args[i]
    if a == '--only':
        only = set(args[i + 1].split(',')); i += 2
    elif a == '--no-render':
        render = False; i += 1
    elif a == '--atlas':
        atlas = int(args[i + 1]); i += 2
    elif a == '--small':
        small = int(args[i + 1]); i += 2
    else:
        i += 1

import bpy
import propkit as K

T0 = time.time()
sc = K.reset()
mod = importlib.import_module('realm_' + realm)
M = mod.materials()
defs = mod.props()
realm_dir = os.path.join(out, realm)
os.makedirs(realm_dir, exist_ok=True)

# ---- 1. model every single (non-composite) prop
singles = []
byname = {}
for d in defs:
    if 'compose' in d:
        continue
    if only and d['name'] not in only:
        continue
    t = time.time()
    P = K.Prop(d['name'])
    d['build'](P, M)
    ob = P.finish(sharp_deg=d.get('sharp', 55.0), weld=d.get('weld', 0.0))
    # Budget fit BEFORE the unwrap, so the atlas is packed for the topology that ships. Solid props
    # only: a cutout prop's alpha cards must not be collapsed.
    fit = None
    if not d.get('cutout') and P.tris > d.get('budget', 1500):
        fit = K.fit_budget(ob, d.get('budget', 1500))
        K.log('fit', d['name'], '%d -> %d tris (ratio %.3f)' % fit)
    K.uv_unwrap(ob, angle_deg=d.get('uv_angle', 66.0), margin=0.02)
    bb = K.bounds_gltf(ob)
    maxdim = max(bb['size'])
    w = d.get('uv_weight') or max(0.55, min(2.4, 0.78 * math.sqrt(max(maxdim, 0.2) / 1.5)))
    K.uv_scale_object(ob, w)
    singles.append((d, ob))
    byname[d['name']] = ob
    tris_now = K.mesh_tris(ob.data)
    K.log('built', d['name'], 'tris', tris_now, 'size', bb['size'], 'uvw', round(w, 2), round(time.time() - t, 2), 's')
    if tris_now > d.get('budget', 1500):
        K.log('WARNING over budget', d['name'], tris_now, '>', d.get('budget', 1500))

if not singles:
    raise SystemExit('nothing to build')

# ---- 2. one atlas per realm
K.uv_pack_all([ob for _, ob in singles], margin=0.006)
imgs = K.bake_atlas([ob for _, ob in singles], realm, realm_dir, size=atlas, size_small=small,
                    emit_size=small, ao_samples=getattr(mod, 'AO_SAMPLES', 24))
amats = K.make_atlas_materials(realm, imgs, emissive_strength=getattr(mod, 'EMISSIVE_STRENGTH', 3.0))
for d, ob in singles:
    K.assign_atlas(ob, amats['cutout' if d.get('cutout') else 'opaque'])

# ---- 3. LOD1 + clips
lods = {}
clips = {}
for d, ob in singles:
    lods[d['name']] = K.make_lod(ob, ratio=d.get('lod_ratio', 0.4), card_keep=d.get('card_keep', 0.4))
    if d.get('anim'):
        clips[d['name']] = [K.add_spin(ob, **d['anim'])]

# ---- 4. composites (an Empty root + the single objects as children; no extra atlas space)
composites = []
for d in defs:
    if 'compose' not in d:
        continue
    parts = [byname.get(n) for n in d['compose']]
    if any(p is None for p in parts):
        continue
    root = bpy.data.objects.new(d['name'], None); K.link(root)
    for p in parts:
        p.parent = root
    rootl = bpy.data.objects.new(d['name'] + '_LOD1', None); K.link(rootl)
    for n in d['compose']:
        lods[n].parent = rootl
    composites.append((d, root, parts, rootl, [lods[n] for n in d['compose']]))

# ---- 5. export + measure
def export_set(name, objs, root, animated, cutout):
    path = os.path.join(realm_dir, name + '.gltf')
    sel = ([root] if root else []) + objs
    K.select_only(sel)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLTF_SEPARATE', use_selection=True, export_texture_dir='textures',
        export_yup=True, export_apply=True, export_animations=animated, export_image_format='AUTO',
        export_materials='EXPORT', export_normals=True, export_texcoords=True, export_tangents=False,
        export_extras=False, export_lights=False, export_cameras=False, export_skins=False,
        export_draco_mesh_compression_enable=False, export_attributes=False,
        export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=True,
        export_vertex_color='NONE')
    info = K.patch_gltf(path, cutout)
    info['file'] = realm + '/' + name + '.gltf'
    info['bytes'] = os.path.getsize(path) + (os.path.getsize(os.path.join(realm_dir, name + '.bin')) if os.path.exists(os.path.join(realm_dir, name + '.bin')) else 0)
    return info

entries = []
for d, ob in singles:
    inf0 = export_set(d['name'], [ob], None, bool(d.get('anim')), bool(d.get('cutout')))
    inf1 = export_set(d['name'] + '_lod1', [lods[d['name']]], None, False, bool(d.get('cutout')))
    bb = K.bounds_gltf(ob)
    entries.append({
        'name': d['name'], 'file': inf0['file'], 'lod1': inf1['file'],
        'tris': K.mesh_tris(ob.data), 'tris_gltf': inf0['tris'], 'tris_lod1': K.mesh_tris(lods[d['name']].data),
        'verts': len(ob.data.vertices), 'bones': 0,
        'clips': [{'name': c['name'], 'seconds': c['seconds'], 'frames': c['frames'], 'axis': c['axis_gltf']} for c in clips.get(d['name'], [])],
        'bounds': bb, 'pivot': d.get('pivot', 'base centre (y=0, XZ centred)'),
        'material': inf0['materials'][0] if inf0['materials'] else None, 'cutout': bool(d.get('cutout')),
        'bytes': inf0['bytes'], 'bytes_lod1': inf1['bytes'],
        'runtime': d.get('runtime', {}), 'notes': d.get('notes', ''),
    })
for d, root, parts, rootl, partsl in composites:
    inf0 = export_set(d['name'], parts, root, False, any(x.get('cutout') for x in defs if x['name'] in d['compose']))
    inf1 = export_set(d['name'] + '_lod1', partsl, rootl, False, any(x.get('cutout') for x in defs if x['name'] in d['compose']))
    bbs = [K.bounds_gltf(p) for p in parts]
    mn = [min(b['min'][i] for b in bbs) for i in range(3)]; mx = [max(b['max'][i] for b in bbs) for i in range(3)]
    entries.append({
        'name': d['name'], 'file': inf0['file'], 'lod1': inf1['file'],
        'tris': sum(K.mesh_tris(p.data) for p in parts), 'tris_gltf': inf0['tris'],
        'tris_lod1': sum(K.mesh_tris(p.data) for p in partsl), 'verts': sum(len(p.data.vertices) for p in parts),
        'bones': 0, 'clips': [], 'bounds': {'min': mn, 'max': mx, 'size': [round(mx[i] - mn[i], 4) for i in range(3)]},
        'pivot': d.get('pivot', 'base centre (y=0, XZ centred)'), 'material': inf0['materials'],
        'cutout': 'mixed', 'bytes': inf0['bytes'], 'bytes_lod1': inf1['bytes'], 'compose': d['compose'],
        'runtime': d.get('runtime', {}), 'notes': d.get('notes', ''),
    })

# ---- 6. turntables
tt_files = {}
if render:
    tt = K.Turntable(os.path.join(out, '_turntable'), px=1024)
    for d, ob in singles:
        t = time.time()
        tt_files[d['name']] = tt.render([ob], realm + '_' + d['name'], lod_obs=[lods[d['name']]])
        K.log('turntable', d['name'], round(time.time() - t, 1), 's')
    for d, root, parts, rootl, partsl in composites:
        t = time.time()
        tt_files[d['name']] = tt.render(parts, realm + '_' + d['name'], lod_obs=partsl)
        K.log('turntable', d['name'], round(time.time() - t, 1), 's')
for e in entries:
    e['turntable'] = ['_turntable/' + f for f in tt_files.get(e['name'], [])]

# ---- 7. manifest
texdir = os.path.join(realm_dir, 'textures')
textures = []
for f in sorted(os.listdir(texdir)):
    p = os.path.join(texdir, f)
    im = bpy.data.images.load(p, check_existing=True)
    textures.append({'file': realm + '/textures/' + f, 'px': list(im.size), 'bytes': os.path.getsize(p)})
man = {
    'kit': 'props', 'realm': realm, 'generated': time.strftime('%Y-%m-%dT%H:%M:%S'),
    'blender': bpy.app.version_string, 'units': 'metres, +Y up (glTF), origin at the base unless pivot says otherwise',
    'atlas': {'albedo_px': atlas, 'small_px': small, 'emissive_strength': getattr(mod, 'EMISSIVE_STRENGTH', 3.0),
              'maps': 'albedo(RGBA sRGB) normal(tangent, OpenGL +Y) orm(R=AO G=rough B=metal) emissive(sRGB)'},
    'materials': {'opaque': realm + '_atlas', 'cutout': realm + '_atlas_cutout (alphaMode MASK 0.5, doubleSided)'},
    'turntable_layout': '<realm>_<prop>_turntable.png = 2048x1024 sheet, 8 yaw angles at 512 px (a0..a3 top row, a4..a7 bottom row, 45 deg steps from 30 deg, 18 deg elevation); '
                        '<realm>_<prop>_close.png = 1024 px close-up (3/4 view, upper 2/3); <realm>_<prop>_lod1.png = 1024x512 LOD1 at two angles. Eevee, AgX, neutral 3-point rig.',
    'textures': textures, 'textures_bytes': sum(t['bytes'] for t in textures),
    'props': entries,
    'budgets': {'prop_tris_max': 1500, 'architecture_tris_max': 3000, 'atlas_px_max': 2048},
    'over_budget': [e['name'] for e in entries if e['tris'] > (1500 if 'architecture' not in e.get('notes', '') else 3000)],
    'build_seconds': round(time.time() - T0, 1),
}
with open(os.path.join(realm_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(man, f, indent=1)
K.log('DONE', realm, len(entries), 'props', 'textures', man['textures_bytes'], 'bytes', 'over_budget', man['over_budget'], round(time.time() - T0, 1), 's')
