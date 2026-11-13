"""LIGHT LANE r1 - is the hero RIM visible? Mask-based, at the low tier.
Two frames of one frozen pose: hero shown / hero hidden. mask = |A-B| > 20.
On torso rows (45-70 % of head->feet) and hair rows (5-25 %): outer 6 px of the
silhouette run on each side vs the run's interior, 8-bit luminance.
    python _harness/_light_rimcheck.py --course keep --station spawn
"""
import argparse, io, json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import shots as S
PTS_JS = r"""() => { const A=CRESTBOUND,G=A.game,E=A.engine,T=A.THREE; const P=G.player,cam=E.camera,W=E.size.w,H=E.size.h;
 const proj=(x,y,z)=>{const v=new T.Vector3(x,y,z).project(cam);return [Math.round((v.x*0.5+0.5)*W),Math.round((1-(v.y*0.5+0.5))*H)];};
 const hp=P.pos; return {head:proj(hp.x,hp.y+1.42,hp.z), feet:proj(hp.x,hp.y,hp.z)}; }"""
def lum(p): return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--course',default='keep'); ap.add_argument('--station',default='spawn')
    ap.add_argument('--width',type=int,default=1920); ap.add_argument('--height',type=int,default=1080); ap.add_argument('--dist',type=float,default=5.0)
    a=ap.parse_args(); tag='%s_%s'%(a.course,a.station)
    with sync_playwright() as p:
        br=p.chromium.launch(channel='chrome',headless=True,args=S.FLAGS); pg=br.new_page(viewport={'width':a.width,'height':a.height})
        pg.goto('%s?dev=1&quality=low'%S.BASE,wait_until='load',timeout=60000)
        dl=time.time()+70
        while time.time()<dl:
            try:
                if pg.evaluate('!!(globalThis.CRESTBOUND && CRESTBOUND.game)'): break
            except Exception: pass
            pg.wait_for_timeout(400)
        S.leave_title(pg); ok,why=S.goto_course(pg,a.course)
        if not ok: print('goto failed',why); return 2
        pg.wait_for_timeout(1200); meta=pg.evaluate(S.STATIONS_JS); st=[s for s in meta['stations'] if s['name']==a.station][0]
        pg.evaluate(S.POSE_JS,{'st':st,'dist':a.dist}); pg.wait_for_timeout(400)
        pts=pg.evaluate(PTS_JS)
        pg.evaluate("() => { CRESTBOUND.engine.stop(); }"); pg.wait_for_timeout(100)
        pg.evaluate("() => { CRESTBOUND.engine.render(0); }"); A=os.path.join(S.SHOTS,'rim_%s_A.png'%tag); pg.screenshot(path=A)
        pg.evaluate("() => { const G=CRESTBOUND.game; G.hero.root.visible=false; G.hero.shadowBlob.mesh.visible=false; CRESTBOUND.engine.render(0); }")
        B=os.path.join(S.SHOTS,'rim_%s_B.png'%tag); pg.screenshot(path=B)
        pg.evaluate("() => { const G=CRESTBOUND.game; G.hero.root.visible=true; CRESTBOUND.engine.start(CRESTBOUND.engine._loopFn||null); }")
        br.close()
    ia=Image.open(A).convert('RGB'); ib=Image.open(B).convert('RGB'); pa=ia.load(); pb=ib.load()
    hx,hy=pts['head']; fx,fy=pts['feet']; cx=(hx+fx)//2
    def run(y):
        xs=[x for x in range(cx-160,cx+160) if max(abs(pa[x,y][k]-pb[x,y][k]) for k in range(3))>20]
        if not xs: return None
        sx=set(xs); L=R=min(xs,key=lambda x:abs(x-cx))
        while L-1 in sx: L-=1
        while R+1 in sx: R+=1
        return L,R
    out=[]
    for name,t0,t1 in (('hair',0.04,0.22),('torso',0.45,0.70)):
        rows=[int(hy+(fy-hy)*t) for t in (t0,(t0+t1)/2,t1)]
        for y in rows:
            r=run(y)
            if not r or r[1]-r[0]<16: out.append((name,y,'no run')); continue
            L,R=r; e=6
            left=sum(lum(pa[x,y]) for x in range(L,L+e))/e; right=sum(lum(pa[x,y]) for x in range(R-e+1,R+1))/e
            inner=[lum(pa[x,y]) for x in range(L+e+4,R-e-3)]; inner=sum(inner)/max(1,len(inner))
            out.append((name,y,'w=%d edgeL %.0f edgeR %.0f interior %.0f  ratioL %.2f ratioR %.2f'%(R-L+1,left,right,inner,left/max(1,inner),right/max(1,inner))))
    print('==',tag,'head',pts['head'],'feet',pts['feet'])
    for o in out: print('  %-5s row %4d  %s'%o)
    crop=ia.crop((cx-130,hy-40,cx+130,fy+30)); crop=crop.resize((crop.width*3,crop.height*3),Image.NEAREST); crop.save(os.path.join(S.SHOTS,'rim_%s_crop.png'%tag))
    return 0
if __name__=='__main__': sys.exit(main())
