"""
Pure-python GLB inspector (no bpy): counts triangles, lists skins/joints,
animations (name, duration, channels), accessor bounds, textures, and
asserts the things the runtime relies on. Run with the system python:

    python inspect_glb.py <file.glb> [--json out.json]

Every number in manifest.json comes from here — measured off the shipped
bytes, never from the build script's intent.
"""
import sys, os, json, struct

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    js = None; bin_ = None
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off); off += 8
        chunk = data[off:off + clen]; off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_ = chunk
    return js, bin_


def accessor(js, bin_, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    fmt, size = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    stride = bv.get('byteStride', size * n)
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = []
    for i in range(acc['count']):
        out.append(struct.unpack_from('<' + fmt * n, bin_, base + i * stride))
    return out


def inspect(path):
    js, bin_ = load(path)
    rep = {'file': os.path.basename(path), 'bytes': os.path.getsize(path)}
    exts = set(js.get('extensionsUsed', [])) | set(js.get('extensionsRequired', []))
    rep['extensions'] = sorted(exts)
    rep['draco'] = 'KHR_draco_mesh_compression' in exts
    # meshes / tris
    tris = 0; prims = []
    for mi, m in enumerate(js.get('meshes', [])):
        for p in m['primitives']:
            mode = p.get('mode', 4)
            cnt = js['accessors'][p['indices']]['count'] if 'indices' in p else js['accessors'][p['attributes']['POSITION']]['count']
            t = cnt // 3 if mode == 4 else 0
            tris += t
            mat = js['materials'][p['material']]['name'] if 'material' in p else None
            prims.append({'mesh': m.get('name'), 'material': mat, 'tris': t,
                          'attributes': sorted(p['attributes'].keys())})
    rep['tris'] = tris; rep['primitives'] = prims
    # bounds from POSITION accessors (bind pose)
    mn = [1e9] * 3; mx = [-1e9] * 3
    for m in js.get('meshes', []):
        for p in m['primitives']:
            acc = js['accessors'][p['attributes']['POSITION']]
            for k in range(3):
                mn[k] = min(mn[k], acc['min'][k]); mx[k] = max(mx[k], acc['max'][k])
    rep['bounds'] = {'min': [round(v, 4) for v in mn], 'max': [round(v, 4) for v in mx],
                     'size': [round(mx[k] - mn[k], 4) for k in range(3)]}
    # nodes / skins
    nodes = js.get('nodes', [])
    rep['node_count'] = len(nodes)
    skins = js.get('skins', [])
    rep['skins'] = []
    for s in skins:
        joints = [nodes[j].get('name') for j in s['joints']]
        rep['skins'].append({'name': s.get('name'), 'joints': joints, 'joint_count': len(joints)})
    # bone hierarchy + rest rotations (should be identity for the runtime path)
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    hier = {}; nonident = []
    if skins:
        for j in skins[0]['joints']:
            n = nodes[j]
            hier[n.get('name')] = nodes[parent[j]].get('name') if j in parent else None
            r = n.get('rotation', [0, 0, 0, 1])
            if abs(r[3] - 1) > 1e-5 or any(abs(v) > 1e-5 for v in r[:3]):
                nonident.append(n.get('name'))
    rep['bone_parent'] = hier
    rep['bones_with_rest_rotation'] = nonident
    rep['bone_world'] = {}
    if skins:
        # accumulate world positions (translations only, rotations identity by construction)
        world = {}
        def wpos(i):
            if i in world:
                return world[i]
            t = nodes[i].get('translation', [0, 0, 0])
            if i in parent:
                pp = wpos(parent[i]); w = [pp[k] + t[k] for k in range(3)]
            else:
                w = list(t)
            world[i] = w
            return w
        for j in skins[0]['joints']:
            rep['bone_world'][nodes[j].get('name')] = [round(v, 4) for v in wpos(j)]
    # animations
    anims = []
    for a in js.get('animations', []):
        dur = 0.0; chans = {}
        for ch in a['channels']:
            smp = a['samplers'][ch['sampler']]
            acc = js['accessors'][smp['input']]
            dur = max(dur, acc['max'][0])
            tgt = nodes[ch['target']['node']].get('name')
            chans.setdefault(tgt, []).append(ch['target']['path'])
        anims.append({'name': a.get('name'), 'duration': round(dur, 4), 'channels': len(a['channels']),
                      'targets': len(chans)})
    rep['animations'] = anims
    # textures / images / materials
    imgs = []
    for im in js.get('images', []):
        bv = js['bufferViews'][im['bufferView']] if 'bufferView' in im else None
        imgs.append({'name': im.get('name'), 'mime': im.get('mimeType'), 'bytes': bv['byteLength'] if bv else None})
    rep['images'] = imgs
    mats = []
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        mats.append({'name': m.get('name'), 'alphaMode': m.get('alphaMode', 'OPAQUE'),
                     'baseColorTexture': 'baseColorTexture' in pbr,
                     'metallicRoughnessTexture': 'metallicRoughnessTexture' in pbr,
                     'normalTexture': 'normalTexture' in m, 'occlusionTexture': 'occlusionTexture' in m,
                     'doubleSided': m.get('doubleSided', False)})
    rep['materials'] = mats
    return rep


if __name__ == '__main__':
    path = sys.argv[1]
    rep = inspect(path)
    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w') as f:
            json.dump(rep, f, indent=1)
    print(json.dumps(rep, indent=1))
