import os, sys, math
from PIL import Image, ImageDraw, ImageFont
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
SH=os.path.join(ROOT,"_shots","hero")
def load(n): return Image.open(os.path.join(SH,n)).convert("RGB")
try: F=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf",22)
except Exception: F=ImageFont.load_default()
def sheet(names, cols, cell, out, crop=None):
    ims=[]
    for n in names:
        p=os.path.join(SH,n+".png")
        if not os.path.exists(p): continue
        im=Image.open(p).convert("RGB")
        if crop:
            w,h=im.size; x0,y0,x1,y1=[int(v*w) if i%2==0 else int(v*h) for i,v in enumerate(crop)]
            im=im.crop((x0,y0,x1,y1))
        im=im.resize((cell,cell),Image.LANCZOS)
        d=ImageDraw.Draw(im); d.rectangle([0,0,cell-1,26],fill=(0,0,0))
        d.text((5,2),n,fill=(255,220,90),font=F)
        ims.append(im)
    rows=math.ceil(len(ims)/cols)
    out_im=Image.new("RGB",(cols*cell,rows*cell),(20,20,26))
    for i,im in enumerate(ims): out_im.paste(im,((i%cols)*cell,(i//cols)*cell))
    out_im.save(os.path.join(SH,out)); print(out, out_im.size, len(ims))
STATES=("idle run skid pivot bonk crouch crouchwalk jump1 jump2 jump3 longjump backflip sideflip fall "
 "dive slide slideRecover wallslide wallkick poundHang poundFall poundLand land hardLand slopeSlide "
 "swimIdle swim swimDive climb climbKick cannon fly dead").split()
if __name__=="__main__":
    what=sys.argv[1] if len(sys.argv)>1 else "all"
    C=(0.22,0.16,0.82,0.90)   # crop to hero region
    if what in ("all","a"):
        sheet([s+"_p50" for s in STATES[:17]],6,300,"_r3s_A.png",C)
        sheet([s+"_p50" for s in STATES[17:]],6,300,"_r3s_B.png",C)
    if what in ("all","phase"):
        for s in ["jump3","longjump","dive","poundFall","dead","swim","wallslide","backflip"]:
            pass
        sheet(sum([[s+"_p10",s+"_p50",s+"_p90"] for s in ["jump3","longjump","dive","poundFall"]],[]),3,340,"_r3s_ph1.png",C)
        sheet(sum([[s+"_p10",s+"_p50",s+"_p90"] for s in ["dead","swim","wallslide","backflip"]],[]),3,340,"_r3s_ph2.png",C)
    if what in ("all","tt"):
        sheet(["turntable_a%d"%i for i in range(8)],4,340,"_r3s_tt.png",C)
        sheet(["runcycle_f%d"%i for i in range(6)],6,320,"_r3s_run.png",C)
