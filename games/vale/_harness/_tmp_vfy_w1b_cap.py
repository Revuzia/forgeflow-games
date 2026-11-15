# verify W1-B r2 (temp): Odrum cap L* at the three_snapshot game camera (row 1, 8 facings): olive pixels (lab h 95-140, C >= 8) in the top 20 % of the silhouette
import numpy as np
from PIL import Image
def lab(a):
    a=a/255.; l=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    M=np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz=l@M.T/np.array([0.95047,1,1.08883]); f=np.where(xyz>216/24389,np.cbrt(xyz),(24389/27*xyz+16)/116)
    return 116*f[...,1]-16, 500*(f[...,0]-f[...,1]), 200*(f[...,1]-f[...,2])
for v in ['before','after']:
    im=np.asarray(Image.open(f'_harness/_tmp_vfy_w1b/face_{v}_odrum.png').convert('RGB')).astype(float)
    Ls=[]; Ms=[]
    for c in range(8):
        cell=im[0:300, c*300:(c+1)*300]
        bg=np.array([cell[5,5]])
        L,A,B=lab(cell); C=np.hypot(A,B); h=np.degrees(np.arctan2(B,A))%360
        Lb,Ab,Bb=lab(bg.reshape(1,1,3)); 
        fg=np.hypot(np.hypot(L-Lb[0,0],A-Ab[0,0]),B-Bb[0,0])>6
        m=fg&(h>=95)&(h<=140)&(C>=8)
        # restrict to central body column near the head: the cap is the largest olive blob nearest the top of the body; take olive px in rows above the mask median row
        ys,xs=np.nonzero(m)
        if len(ys)<10: continue
        Ls.append(np.median(L[m])); Ms.append(len(ys))
    print(v,'cap-ish olive px L* median per facing',[round(x,1) for x in Ls],'px',Ms)
print('--- cap window x 138-168, y 98-118 (head stays put across facings)')
for v in ['before','after']:
    im=np.asarray(Image.open(f'_harness/_tmp_vfy_w1b/face_{v}_odrum.png').convert('RGB')).astype(float)
    out=[]
    for c in range(8):
        w=im[98:118, c*300+138:c*300+168]
        L,A,B=lab(w); C=np.hypot(A,B); h=np.degrees(np.arctan2(B,A))%360
        m=(h>=95)&(h<=150)&(C>=8)
        if m.sum()<5: out.append(None); continue
        out.append((round(float(np.median(L[m])),1), round(float(np.median(C[m])),1), round(float(np.median(h[m])),1), int(m.sum())))
    print(v, out)
