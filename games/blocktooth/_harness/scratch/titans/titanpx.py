# luma of "titan" pixels (violet/magenta hue: r and b both clearly above g) vs the rest of the crop
import sys
from PIL import Image
for p in sys.argv[1:]:
    im = Image.open(p).convert('RGB')
    t=[];g=[]
    for (r,gg,b) in im.getdata():
        L = 0.2126*r+0.7152*gg+0.0722*b
        (t if (r > gg+25 and b > gg+25) else g).append(L)
    t.sort(); g.sort()
    med=lambda a:a[len(a)//2] if a else 0
    print(f"{p.split('/')[-1]:28s} titan px={len(t):6d} mean={sum(t)/max(1,len(t)):5.1f} p90={t[int(len(t)*.9)] if t else 0:5.1f} | rest mean={sum(g)/len(g):5.1f} median={med(g):5.1f}")
