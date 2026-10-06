import json,sys
from collections import defaultdict
rows=[json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
tot=0; bad=[]; fam=defaultdict(lambda:[0,0,0]); missed=0
for r in rows:
    for x in r['rubs']:
        if x['missed']: missed+=1; continue
        tot+=1; fam[r['fam']][0]+=1
        if x['f120']>0 or x['worst']>120 or x.get('bad') or x['rest']>60:
            fam[r['fam']][1]+=1; fam[r['fam']][2]+=x['f120']
            bad.append((r['id'],r['g'],r['fam'],x['p'],x['ang'],round(x['worst']),x['f120'],x['longest'],round(x['rest']),x.get('bad','')))
print(f"rubs run {tot}, missed rays {missed}, failing {len(bad)} (frames>120 or worst>120 or rest>60), bodies {len(rows)}")
for k,v in sorted(fam.items()): print(f"  {k:13s} {v[1]:3d} of {v[0]:3d} rubs fail, {v[2]} frames over 120")
for b in sorted(bad,key=lambda b:-b[6])[:25]: print('  ',*b)
