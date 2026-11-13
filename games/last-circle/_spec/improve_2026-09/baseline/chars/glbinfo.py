import json,struct,sys,os
for f in sys.argv[1:]:
    b=open(f,'rb').read()
    l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l])
    tris=0; verts=0; attrs=set()
    for m in j.get('meshes',[]):
        for p in m['primitives']:
            if 'indices' in p: tris+=j['accessors'][p['indices']]['count']//3
            verts+=j['accessors'][p['attributes']['POSITION']]['count']; attrs|=set(p['attributes'])
    print(os.path.basename(f), os.path.getsize(f), 'tris',tris,'verts',verts,'bones',[len(s['joints']) for s in j.get('skins',[])],'attrs',sorted(attrs),'anims',len(j.get('animations',[])))
