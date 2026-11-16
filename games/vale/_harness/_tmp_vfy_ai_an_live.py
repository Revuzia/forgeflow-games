import json,sys,collections
d=json.load(open(sys.argv[1]))
print('result',d.get('result'),'end',d.get('endT'),'err',(d.get('error') or '')[:200])
lu={p['player']:(p['team'],p['role'],p['controller']) for p in d['lineup']}
cw=d.get('coreW') or []
core=[c for c in cw if c['def'] in ('hourbell','needle_bell')]
print('struct-hit samples',len(cw),'core',len(core))
far=collections.Counter(); idlec=collections.Counter()
for c in cw:
  for f in c['fitOwn']:
    if f['p']==0: continue
    if c['def'] in ('hourbell','needle_bell','lantern') and f['d']>25: far[(c['def'],c['team'])]+=1
    if f['d']<=25 and f['st'] in ('idle',): idlec[(c['def'],c['team'])]+=1
print('fit own >25m while base struct hit (fighter-seconds):',dict(far))
print('fit own idle within 25m while hit:',dict(idlec))
for c in core[:0]: pass
# print core samples compact
for c in core:
  print(' CORE t%d %s team%d hp%d att%d fit:%s'%(c['t'],c['def'],c['team'],c['hp'],c['att'],' '.join('p%s@%.0f/%s'%(f['p'],f['d'],f['st'][:4]) for f in c['fitOwn'])))
print('idle eps (bots) >=10s:',[(i['player'],i['t0'],i['t1'],i['atOwnStructure']) for i in d['idle'] if i['t1']-i['t0']>=10])
print('dither:',[(x['player'],x['t0'],x['t1'],x['path']) for x in d['dither']])
lo=d['lowHp']; oc=collections.Counter(x.get('outcome') for x in lo); print('lowHp outcomes',dict(oc))
for o in d['objectives']: print('OBJ',json.dumps(o)[:200])
sg=[s for s in d['sieges'] if s['def'] in ('needle_inner','lantern','needle_bell','hourbell')]
for s in sg: print('SIEGE %s team%d t%d-%d att%d/%d def0 %d defmax %d firstDef %s hp %.2f->%s fell %s me %s'%(s['def'],s['team'],s['t0'],s['t1'],s['attackers'],s['maxAtt'],s['defAt0'],s['defMax'],s['firstDefT'],s['hp0'],s['hp1'],s['fell'],s['attackerHasMe']))
print('beelines',len(d.get('beelines') or []))
print('faults',d.get('faults'))
