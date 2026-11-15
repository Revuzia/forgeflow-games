import os
os.chdir(r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\blocktooth")
p='src/render/civilians.ts'
L=open(p,encoding='utf-8').read().split('\n')
a=next(k for k,l in enumerate(L) if 'for (let pass = isRound(b) ? 0 : 1; pass < 2; pass++) {' in l)
b=next(k for k in range(a,len(L)) if 'this.wnx[i] = nx; this.wnz[i] = nz;' in L[k])
for k in range(a+1,b+1): L[k]='  '+L[k]
assert L[b+1]=='      }', repr(L[b+1])
open(p,'w',encoding='utf-8').write('\n'.join(L)); print('ok')
