# Plain-Python GLB inspector (no bpy): reads the JSON chunk and reports what the game will see.
#   python inspect_glb.py <file.glb> [...]
import sys, json, struct, os


def inspect(path):
    with open(path, 'rb') as f:
        magic, ver, length = struct.unpack('<4sII', f.read(12))
        assert magic == b'glTF', 'not a GLB'
        clen, ctype = struct.unpack('<II', f.read(8))
        js = json.loads(f.read(clen).decode('utf-8'))
    acc = js.get('accessors', [])
    tris = 0
    prims = 0
    for m in js.get('meshes', []):
        for p in m.get('primitives', []):
            prims += 1
            if 'indices' in p:
                tris += acc[p['indices']]['count'] // 3
            else:
                tris += acc[p['attributes']['POSITION']]['count'] // 3
    bvs = js.get('bufferViews', [])
    imgs = []
    for im in js.get('images', []):
        bl = bvs[im['bufferView']]['byteLength'] if 'bufferView' in im else -1
        imgs.append({'name': im.get('name'), 'mime': im.get('mimeType'), 'bytes': bl})
    mats = [m.get('name') for m in js.get('materials', [])]
    emis = [(m.get('name'), m.get('emissiveFactor'), (m.get('extensions') or {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength'))
            for m in js.get('materials', []) if m.get('emissiveFactor')]
    nodes = [n.get('name') for n in js.get('nodes', [])]
    skins = [{'joints': len(s.get('joints', [])), 'skeleton': s.get('skeleton')} for s in js.get('skins', [])]
    anims = []
    for a in js.get('animations', []):
        tmax = 0.0
        for s in a.get('samplers', []):
            tmax = max(tmax, acc[s['input']].get('max', [0])[0])
        anims.append({'name': a.get('name'), 'seconds': round(tmax, 3), 'channels': len(a.get('channels', []))})
    tex_bytes = sum(i['bytes'] for i in imgs)
    return {
        'file': os.path.basename(path), 'bytes': os.path.getsize(path), 'tris': tris, 'primitives': prims,
        'images': imgs, 'texture_bytes': tex_bytes, 'materials': mats, 'emissive': emis, 'nodes': nodes,
        'skins': skins, 'animations': anims, 'extensionsUsed': js.get('extensionsUsed', []), 'extensionsRequired': js.get('extensionsRequired', []),
        'generator': js.get('asset', {}).get('generator'),
    }


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(json.dumps(inspect(p), indent=1))
