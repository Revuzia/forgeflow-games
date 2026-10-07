#!/usr/bin/env python3
"""VALE: recompute every colour figure the style bible quotes, from _design/tokens.json.

Usage:  python3 _design/tools/verify_tokens.py [--json]
Method: sRGB -> linear -> (Machado, Oliveira & Fernandes 2009 CVD matrices, severity 1.0, applied in
linear RGB) -> XYZ (D65) -> CIELAB -> CIEDE2000. WCAG 2.x relative-luminance contrast. Needs numpy.
Exit code 1 if any gate() threshold fails, so CI can pin the palette.
"""
import itertools, json, math, os, sys
import numpy as np
M = {
 'protan': np.array([[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]]),
 'deutan': np.array([[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]]),
 'tritan': np.array([[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]),
}
def hex2rgb(h):
    h=h.lstrip('#'); return np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
def rgb2hex(c):
    c=np.clip(np.round(np.asarray(c)*255),0,255).astype(int); return '#%02X%02X%02X'%tuple(c)
def lin(c):
    c=np.asarray(c,float); return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def delin(c):
    c=np.clip(np.asarray(c,float),0,1); return np.where(c<=0.0031308,c*12.92,1.055*c**(1/2.4)-0.055)
def sim(hexc, vision):
    c=hex2rgb(hexc) if isinstance(hexc,str) else hexc
    if vision=='normal': return lin(c)
    if vision=='gray':
        l=lin(c); y=0.2126*l[0]+0.7152*l[1]+0.0722*l[2]; return np.array([y,y,y])
    return np.clip(M[vision]@lin(c),0,1)
def lab_from_lin(l):
    X=0.4124564*l[0]+0.3575761*l[1]+0.1804375*l[2]
    Y=0.2126729*l[0]+0.7151522*l[1]+0.0721750*l[2]
    Z=0.0193339*l[0]+0.1191920*l[1]+0.9503041*l[2]
    xn,yn,zn=0.95047,1.0,1.08883
    def f(t): return np.where(t>216/24389,np.cbrt(t),(24389/27*t+16)/116)
    fx,fy,fz=f(X/xn),f(Y/yn),f(Z/zn)
    return np.array([116*fy-16,500*(fx-fy),200*(fy-fz)])
def lab(hexc,vision='normal'): return lab_from_lin(sim(hexc,vision))
def Lstar(hexc): return float(lab(hexc)[0])
def de2000(l1,l2):
    L1,a1,b1=l1; L2,a2,b2=l2
    C1=np.hypot(a1,b1); C2=np.hypot(a2,b2); Cb=(C1+C2)/2
    G=0.5*(1-np.sqrt(Cb**7/(Cb**7+25**7)))
    a1p=(1+G)*a1; a2p=(1+G)*a2
    C1p=np.hypot(a1p,b1); C2p=np.hypot(a2p,b2)
    h1p=np.degrees(np.arctan2(b1,a1p))%360; h2p=np.degrees(np.arctan2(b2,a2p))%360
    dLp=L2-L1; dCp=C2p-C1p
    dh=h2p-h1p
    if C1p*C2p==0: dh=0
    elif dh>180: dh-=360
    elif dh<-180: dh+=360
    dHp=2*np.sqrt(C1p*C2p)*np.sin(np.radians(dh/2))
    Lbp=(L1+L2)/2; Cbp=(C1p+C2p)/2
    hs=h1p+h2p
    if C1p*C2p==0: hbp=hs
    elif abs(h1p-h2p)<=180: hbp=hs/2
    elif hs<360: hbp=(hs+360)/2
    else: hbp=(hs-360)/2
    T=1-0.17*np.cos(np.radians(hbp-30))+0.24*np.cos(np.radians(2*hbp))+0.32*np.cos(np.radians(3*hbp+6))-0.20*np.cos(np.radians(4*hbp-63))
    dth=30*np.exp(-((hbp-275)/25)**2)
    RC=2*np.sqrt(Cbp**7/(Cbp**7+25**7))
    SL=1+0.015*(Lbp-50)**2/np.sqrt(20+(Lbp-50)**2)
    SC=1+0.045*Cbp; SH=1+0.015*Cbp*T
    RT=-np.sin(np.radians(2*dth))*RC
    return float(np.sqrt((dLp/SL)**2+(dCp/SC)**2+(dHp/SH)**2+RT*(dCp/SC)*(dHp/SH)))
def de(h1,h2,vision='normal'): return de2000(lab(h1,vision),lab(h2,vision))
VIS=['normal','deutan','protan','tritan']
def relL(hexc):
    l=lin(hex2rgb(hexc)); return 0.2126*l[0]+0.7152*l[1]+0.0722*l[2]
def contrast(a,b):
    la,lb=relL(a),relL(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def worst(a,b,vis=VIS): return min(de(a,b,v) for v in vis)

def main():
    root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    t=json.load(open(os.path.join(root,'tokens.json'),encoding='utf-8'))
    c=t['colors']; tm=t['team']; terr=c['terrain-ref']; out={}; fails=[]
    def gate(name,val,minimum):
        out[name]=round(float(val),2)
        if val < minimum: fails.append(f'{name}={val:.2f} < {minimum}')
    # UI text contrast
    for tok in ['text-1','text-2','text-3','text-disabled']:
        for bg in ['ink-0','ink-1','ink-2','ink-3']:
            out[f'contrast {tok} on {bg}']=round(contrast(c[tok],c[bg]),2)
    gate('contrast text-1 on ink-2',contrast(c['text-1'],c['ink-2']),7.0)
    gate('contrast text-2 on ink-2',contrast(c['text-2'],c['ink-2']),7.0)
    gate('contrast text-3 on ink-3',contrast(c['text-3'],c['ink-3']),4.5)
    gate('contrast on-chalk on chalk',contrast(c['on-chalk'],c['chalk']),7.0)
    # relationship sets
    sets={'default':{k:tm[k] for k in ('self','ally','enemy')}}
    for v in ('deutan','protan','tritan'): sets[v]={k:tm['colorblind'][v][k] for k in ('self','ally','enemy')}
    world=[terr['lane'],terr['jungle'],terr['river']]
    for name,s in sets.items():
        visions = VIS if name=='default' else ['normal',name]
        for v in VIS+['gray']:
            out[f'rel {name} {v} min pair']=round(min(de(s[a],s[b],v) for a,b in itertools.combinations(s,2)),1)
            out[f'rel {name} {v} min vs terrain']=round(min(de(x,w,v) for x in s.values() for w in world),1)
        gate(f'rel {name} worst pair (own visions)', min(min(de(s[a],s[b],v) for a,b in itertools.combinations(s,2)) for v in visions), 20)
        gate(f'rel {name} worst vs terrain (own visions)', min(min(de(x,w,v) for x in s.values() for w in world) for v in visions), 20)
        for k,x in s.items(): out[f'rel {name} {k} contrast on bar plate']=round(contrast(x,c['bar-plate']),2)
    gate('neutral vs self/ally/enemy (all visions)', min(worst(tm['neutral'],tm[k]) for k in ('self','ally','enemy')), 14)
    # FRAY
    seats=[s['color'] for s in t['fray']]
    for v in VIS+['gray']:
        m=min((de(a,b,v),i,j) for (i,a),(j,b) in itertools.combinations(enumerate(seats),2))
        out[f'fray {v} min pair']=f"{m[0]:.1f} ({t['fray'][m[1]]['name']}/{t['fray'][m[2]]['name']})"
    gate('fray worst pair, all four visions', min(worst(a,b) for a,b in itertools.combinations(seats,2)), 10)
    gate('fray normal-vision min pair', min(de(a,b) for a,b in itertools.combinations(seats,2)), 16)
    gate('fray vs self (all visions)', min(worst(x,tm['self']) for x in seats), 15)
    gate('fray vs harm (all visions)', min(worst(x,tm['enemy']) for x in seats), 10)
    gate('fray vs heal (all visions)', min(worst(x,t['damage']['heal']['color']) for x in seats), 9)
    gate('fray min contrast on bar plate', min(contrast(x,c['bar-plate']) for x in seats), 3.0)
    for s in t['fray']:
        x=s['color']
        out[f"seat {s['numeral']} {s['name']}"]=f"L*={lab(x)[0]:.0f} plate={contrast(x,c['bar-plate']):.2f} vsFloor={de(x,terr['fray-floor']):.1f}"
    # damage
    d=t['damage']
    dm={'physical':d['physical']['color'],'magic':d['magic']['color'],'heal':d['heal']['color'],'shield':d['shield']['color']}
    for (a,x),(b,y) in itertools.combinations(dm.items(),2):
        out[f'damage {a}/{b} worst']=round(worst(x,y),1)
    out['damage true halo contrast']=round(contrast(d['true']['fill'],d['true']['halo']),1)
    # ranks monotonic L*
    ls=[lab(r['color'])[0] for r in c['rank'].values()]
    out['rank L* ladder']=[round(x) for x in ls]
    if any(b<=a for a,b in zip(ls,ls[1:])): fails.append('rank L* not monotonic')
    out['item tier worst pair']=round(min(worst(a['color'],b['color']) for a,b in itertools.combinations(c['item-tier'].values(),2)),1)
    if '--json' in sys.argv: print(json.dumps(out,indent=1,ensure_ascii=False))
    else:
        for k,v in out.items(): print(f'{k}: {v}')
    if fails:
        print('FAIL:', *fails, sep='\n  '); sys.exit(1)
    print('OK: all gates pass')

if __name__=='__main__': main()
