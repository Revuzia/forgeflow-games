# verify W1-B r3 (temp): Odrum mask (front close-up) and cap (game camera, 8 facings) CIELAB/HSV, before / fix 2 / HEAD
import numpy as np, colorsys
from PIL import Image
def lab(a):
    a=a/255.; l=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    M=np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz=l@M.T/np.array([0.95047,1,1.08883]); f=np.where(xyz>216/24389,np.cbrt(xyz),(24389/27*xyz+16)/116)
    return 116*f[...,1]-16, 500*(f[...,0]-f[...,1]), 200*(f[...,1]-f[...,2])
D='_harness/_tmp_vfy_w1b_r3'
for v in ['before','f2','after']:
    im=np.asarray(Image.open(f'{D}/face_{v}_odrum.png').convert('RGB')).astype(float)
    # zoomed face cell (row 3 cell 6): mask fills the frame
    w=im[600+60:600+260, 1800+40:1800+260]
    L,A,B=lab(w); C=np.hypot(A,B); h=np.degrees(np.arctan2(B,A))%360
    m=(L>45)
    rgb=np.median(w[m],0)/255; hh,ss,vv=colorsys.rgb_to_hsv(*rgb)
    hsvh=[]; 
    px=w[m]/255.
    mx=px.max(1); mn=px.min(1); 
    print(v,'mask: L med %.1f p90 %.1f C %.1f lab h %.1f | HSV(median rgb) h %.1f S %.2f V %.2f | share L>75&C<20 %.3f' % (np.median(L[m]),np.percentile(L[m],90),np.median(C[m]),np.median(h[m]),hh*360,ss,vv,((L>75)&(C<20))[m].mean()))
    out=[]
    for c in range(8):
        w=im[98:118, c*300+138:c*300+168]
        L,A,B=lab(w); C=np.hypot(A,B); h=np.degrees(np.arctan2(B,A))%360
        # cap: darkest compact cluster in the window; take pixels with L<55 (cap vs mask/shirt)
        m=(L<55)
        if m.sum()<5: out.append(None); continue
        out.append((round(float(np.median(L[m])),1), round(float(np.median(C[m])),1), round(float(np.median(h[m])),1), int(m.sum())))
    allL=[]
    for c in range(8):
        w=im[98:118, c*300+138:c*300+168]; L,_,_=lab(w); allL.append(round(float(np.median(L)),1))
    print(v,'cap window (L<55 px) per facing',out); print(v,'cap window all-px median L*',allL)
