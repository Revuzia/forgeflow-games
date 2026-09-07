# Merge _manifest/<piece>.json entries into assets/models/keep/manifest.json with kit-level totals,
# cross-checked against the GLBs on disk (inspect_glb.py — plain Python, no bpy).
#   python make_manifest.py
import os, json, glob, time, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from inspect_glb import inspect

ROOT = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound'
KIT_DIR = f'{ROOT}/assets/models/keep'
BUDGET = {'architecture': 3000, 'prop': 1500, 'critter': 8000, 'hero': 12000}
KIT_TEX_BUDGET = 24 * 1024 * 1024

entries = []
problems = []
for jp in sorted(glob.glob(os.path.join(KIT_DIR, '_manifest', '*.json'))):
    e = json.load(open(jp, encoding='utf-8'))
    glb = os.path.join(KIT_DIR, e['file'])
    if not os.path.exists(glb):
        problems.append(f"{e['name']}: {e['file']} missing on disk")
        continue
    g = inspect(glb)
    e['bytes'] = g['bytes']
    e['texture_bytes'] = g['texture_bytes']
    e['images'] = g['images']
    e['glb'] = {'tris': g['tris'], 'primitives': g['primitives'], 'materials': g['materials'], 'nodes': g['nodes'],
                'skins': g['skins'], 'animations': g['animations'], 'extensions': g['extensionsUsed'], 'emissive': g['emissive']}
    tt = sorted(os.path.basename(p) for p in glob.glob(os.path.join(KIT_DIR, '_turntable', f"{e['name']}_*.png")))
    e['turntable'] = tt
    budget = BUDGET.get(e.get('kind', 'architecture'), 3000)
    e['tris_budget'] = budget
    e['tris_ok'] = e['tris'] <= budget
    if g['tris'] != e['tris']:
        problems.append(f"{e['name']}: manifest tris {e['tris']} != glb tris {g['tris']}")
    if not e['tris_ok']:
        problems.append(f"{e['name']}: {e['tris']} tris over the {budget} budget")
    if not e.get('reimport_ok'):
        problems.append(f"{e['name']}: re-import check failed")
    if len(tt) != 9:
        problems.append(f"{e['name']}: {len(tt)} turntable frames (expect 9)")
    if e['textures']['atlas'] > 2048:
        problems.append(f"{e['name']}: atlas {e['textures']['atlas']} > 2K")
    clips = e.get('clips', [])
    if len(clips) != len(g['animations']):
        problems.append(f"{e['name']}: manifest clips {len(clips)} != glb animations {len(g['animations'])}")
    entries.append(e)

total_tex = sum(e['texture_bytes'] for e in entries)
total_bytes = sum(e['bytes'] for e in entries)
if total_tex > KIT_TEX_BUDGET:
    problems.append(f'kit textures {total_tex/1e6:.1f} MB over the 24 MB budget')

manifest = {
    'kit': 'keep', 'title': 'THE KEEP — modular castle architecture kit',
    'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
    'generator': 'Blender 5.1.2 headless (bpy) — _tools/blender/keep/{kitlib,pieces,build_kit}.py',
    'units': '1 unit = 1 metre, +Y up (export_yup), origin at the base unless the entry says otherwise, front = +Z',
    'language': 'warm stone (0x9c8768 keep tint family) + amber timber (0xc09056) + gilt / iron / marble accents',
    'textures': 'per-piece baked atlases embedded in each GLB as WebP (EXT_texture_webp; GLTFLoader r172 supports it): '
                'albedo (sRGB), tangent normal (OpenGL +Y), ORM (R occlusion, G roughness, B metallic). Draco OFF.',
    'runtime_notes': [
        'materials named <piece> (PBR) and <piece>_<glow> (same atlas + emissiveFactor/KHR_materials_emissive_strength): drive the glow slots for pulses',
        'banner_pole cloth is baked cream so material.color can carry the realm tint; frame_painting_* node `canvas` has UVs 0..1 and a plain material to swap for the course plate',
        'stair_module local frame == buildStairs: lowest riser at -Z, climbs toward +Z, rise 0.30 run 0.46 width 4.0, origin at the foot on the footprint centre',
        'gate_door: bones root/hingeL/hingeR, clip open (1.5 s, 75 deg toward +Z); play backward to close',
        'set castShadow on pieces >= 0.75 m (props.js rule), strip nothing: no lights are embedded',
    ],
    'budgets': {'architecture_tris': 3000, 'prop_tris': 1500, 'atlas_max': 2048, 'kit_texture_bytes': KIT_TEX_BUDGET},
    'totals': {'pieces': len(entries), 'bytes': total_bytes, 'texture_bytes': total_tex, 'tris': sum(e['tris'] for e in entries),
               'bones': sum(e['bones'] for e in entries), 'clips': sum(len(e.get('clips', [])) for e in entries)},
    'problems': problems,
    'pieces': entries,
}
with open(os.path.join(KIT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=1)
print(json.dumps({'pieces': len(entries), 'bytes_MB': round(total_bytes / 1e6, 2), 'texture_MB': round(total_tex / 1e6, 2),
                  'problems': problems}, indent=1))
for e in entries:
    print(f"{e['name']:20s} tris {e['tris']:5d}/{e['tris_budget']:<5d} bones {e['bones']:2d} clips {len(e.get('clips', []))} "
          f"tex {e['textures']['atlas']:4d} {e['bytes']/1e6:5.2f} MB  reimport {'ok' if e.get('reimport_ok') else 'FAIL'}")
