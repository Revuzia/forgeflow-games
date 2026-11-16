import json,sys,math
S=sys.argv[1]; suf=sys.argv[2] if len(sys.argv)>2 else 'rf'
import os
arms={a:json.load(open(f'{S}/ab_{a}_{suf}.json')) for a in ('pre','e2c','head') if os.path.exists(f'{S}/ab_{a}_{suf}.json')}
def idx(d):
  o={}
  for t in d:
    for g in t['games']: o[(t['diff'],g['mode'],g['seed'])]=g
  return o
A={a:idx(v) for a,v in arms.items()}
keys=set()
for a in A.values():
  for g in a.values(): keys|=set(g['c'].keys())
keys=sorted(k for k in keys if k!='players')
def val(g,k):
  if k=='dur': return g['dur']/60
  v=g['c'].get(k,0); return v if isinstance(v,(int,float)) else 0
want=[l.strip() for l in sys.argv[3].split(',')] if len(sys.argv)>3 else ['dur']+keys
for mode in ('rift','fray','bridge'):
  for diff in ('novice','adept','veteran'):
    ks=[k for k in A['head'] if k[0]==diff and k[1]==mode]
    if not ks: continue
    print(f'\n== {mode} {diff} n={len(ks)}')
    for k in want:
      row=[]
      means={a:sum(val(A[a][s],k) for s in ks if s in A[a])/len(ks) for a in A}
      if all(abs(m)<1e-9 for m in means.values()): continue
      out=f'{k:34s} '+' '.join(f'{a} {means[a]:8.3f}' for a in A)
      for b in [x for x in ('pre','e2c') if x in A]:
        dd=[val(A['head'][s],k)-val(A[b][s],k) for s in ks if s in A[b]]
        n=len(dd); m=sum(dd)/n; sd=math.sqrt(sum((x-m)**2 for x in dd)/(n-1)) if n>1 else 0; se=sd/math.sqrt(n)
        out+=f' | h-{b} {m:+.3f}±{se:.3f} z{(m/se if se else 0):+.1f}'
      print(out)
