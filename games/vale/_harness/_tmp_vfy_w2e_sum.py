import json,sys,collections
d=json.load(open(sys.argv[1]))
for n in d.get('notes',[]):
  if not isinstance(n,dict): continue
  t=n.get('text',''); x=n.get('data')
  if t.startswith('hudfacts') and isinstance(x,dict):
    print('==',t, 'recap',x.get('recap'),'allies',x.get('allies'),'gap',x.get('recapAlliesGap'),'dbar',x.get('dbar'),'dbar%',x.get('dbarAreaPct'),'bottom%',x.get('bottomAreaPct'))
    print('   overlaps',x.get('overlaps')); print('   fonts',x.get('fonts'),'sizes',x.get('sizes'),'nonTab',x.get('nonTabularN'),x.get('nonTabular')[:4],'small',x.get('smallN'),x.get('smallText')[:4])
    print('   res',x.get('resH'),x.get('resText'),'hp',x.get('hpH'),x.get('hpText'),'pip',x.get('pip'),'fit',x.get('fit'))
    print('   regen',x.get('regen'),'sky::before',x.get('skyBefore'))
  elif t: print('--',t, json.dumps(x)[:1500] if x is not None else '')
k=collections.Counter(l['kind'] for l in d.get('layout',[])); print('layout kinds',dict(k), [ (l['kind'],l.get('el'),l.get('text','')[:30]) for l in d.get('layout',[]) if l['kind']!='outside-scroll-ancestor'][:10])
print('console',d.get('console',[])[:5])
