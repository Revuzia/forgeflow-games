import json,sys,glob
files=sys.argv[1:]
rows=[json.loads(l) for f in files for l in open(f) if l.strip()]
LIM={'hold':115,'tap':115,'shove':120,'rub':120,'pinch':115,'grab':120}
fails=[]
BLEED={'slowrise':0.55,'marshmallow':0.35,'mochidough':0.05,'jellygel':0,'waterfill':0,'putty':0,'stickystretch':0,'slimegoo':0,'firmsilicone':0.02,'popdome':0.3,'gummy':0,'beadsqueeze':0.18}
volfails=[]
for r in rows:
    tag=f"{r['id']}/{r['g']}({r['fam']})"
    worst=max(r['recs'],key=lambda x:x['worst'])
    miss=[x['sc'] for x in r['recs'] if x.get('missed')]
    for x in r['recs']:
        if x.get('missed'): continue
        mode=x['sc'].split()[0]
        lim=LIM.get(mode,120)
        if x.get('nan') or x.get('inv'): fails.append((tag,x['sc'],'NaN' if x.get('nan') else 'INVERTED'))
        if x['pen']< -0.01: fails.append((tag,x['sc'],f"pen {x['pen']*100:.2f}%R"))
        if x['worst']>lim or x['f120']>0: fails.append((tag,x['sc'],f"fold {x['worst']:.0f} f120 {x['f120']} f115 {x['f115']}"))
        lo=min(0.85,1-BLEED[r['fam']]-0.05)
        if mode in ('hold','shove','tap','pinch') and (x['volMin']<lo or x['volMax']>1.15): volfails.append((tag,x['sc'],f"vol {x['volMin']:.3f}..{x['volMax']:.3f} band {lo:.2f}..1.15"))
        if x['rest']>r['restLimit']: fails.append((tag,x['sc'],f"rest {x['rest']:.0f} > {r['restLimit']}"))
    c=r['cer']; cr=c['r']
    if cr.get('nan') or cr.get('inv'): fails.append((tag,'ceremony','NaN/INV'))
    if cr['pen']< -0.01: fails.append((tag,'ceremony',f"pen {cr['pen']*100:.2f}%R"))
    if c['settleT']<0: fails.append((tag,'ceremony','not settled'))
    if not r['det']: fails.append((tag,'ceremony','NONDETERMINISTIC'))
    if c['restFold']>r['restLimit']: fails.append((tag,'ceremony',f"rest fold {c['restFold']:.0f}"))
    if abs(c['vol']-1)>0.03: fails.append((tag,'ceremony',f"vol {c['vol']:.3f}"))
    if c['safety']>0: fails.append((tag,'ceremony',f"safetyResets {c['safety']}"))
    lr=r['longRest']; lrr=lr['r']
    if lrr.get('nan') or lrr.get('inv'): fails.append((tag,'longRest','NaN/INV'))
    if lrr['rest']>r['restLimit'] or lrr['restN90']>0: fails.append((tag,'longRest',f"rest {lrr['rest']:.0f} n90 {lrr['restN90']}"))
    if abs(lr['vol']-1)>0.03: fails.append((tag,'longRest',f"vol {lr['vol']:.3f}"))
    if lr['kin']>=0.02: fails.append((tag,'longRest',f"kin {lr['kin']:.3f}"))
    print(f"{tag:34s} n{len(r['recs']):3d} worst {worst['worst']:5.1f} ({worst['sc'][:38]}) miss {len(miss)} cer: maxfold {cr['worst']:.0f} f120 {cr['f120']} settle {c['settleT']:.2f}s shape {c['shape']:.3f} vol {c['vol']:.3f} far {c['far']:.1f}m end({c['cx']:.2f},{c['cz']:.2f}) det {r['det']} | long: shape {lr['shape'][-1] if lr['shape'] else None} vol {lr['vol']:.3f} rest {lrr['rest']:.0f} | {r['sec']}s")
print('\nVOLUME BAND (CONTRACT 4.2) violations',len(volfails))
for f in volfails[:30]: print('  ',*f)
print('\nFAILURES',len(fails))
for f in fails: print('  ',*f)
