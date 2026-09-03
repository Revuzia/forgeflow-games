import os,sys
from PIL import Image, ImageDraw, ImageFont
HERE=os.path.dirname(os.path.abspath(__file__)); SH=os.path.join(os.path.dirname(HERE),"_shots","hero")
try: F=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf",20)
except Exception: F=ImageFont.load_default()
def z(name,box,out,size=520):
    im=Image.open(os.path.join(SH,name+".png")).convert("RGB"); w,h=im.size
    c=im.crop((int(box[0]*w),int(box[1]*h),int(box[2]*w),int(box[3]*h))).resize((size,size),Image.NEAREST)
    d=ImageDraw.Draw(c); d.rectangle([0,0,size-1,24],fill=(0,0,0)); d.text((4,1),name+" "+out,fill=(255,220,90),font=F)
    return c
def grid(items,cols,out,size=520):
    ims=[z(n,b,lbl,size) for n,b,lbl in items]
    import math; rows=math.ceil(len(ims)/cols)
    o=Image.new("RGB",(cols*size,rows*size),(18,18,24))
    for i,im in enumerate(ims): o.paste(im,((i%cols)*size,(i//cols)*size))
    o.save(os.path.join(SH,out)); print(out,o.size)
grid([("turntable_a0",(0.40,0.62,0.62,0.84),"boots"),
      ("turntable_a1",(0.40,0.62,0.62,0.84),"boots"),
      ("turntable_a5",(0.38,0.62,0.60,0.84),"boots"),
      ("idle_p50",(0.38,0.62,0.62,0.86),"boots"),
      ("run_p50",(0.30,0.55,0.62,0.87),"boots"),
      ("hardLand_p50",(0.32,0.58,0.64,0.90),"boots")],3,"_r3z_boots.png")
grid([("turntable_a0",(0.36,0.34,0.66,0.64),"torso/hands"),
      ("turntable_a3",(0.34,0.30,0.68,0.64),"back/pack"),
      ("swim_p50",(0.30,0.28,0.72,0.70),"scarf"),
      ("fly_p50",(0.30,0.28,0.72,0.70),"scarf"),
      ("land_p50",(0.30,0.20,0.72,0.62),"scarf"),
      ("longjump_p90",(0.30,0.28,0.72,0.70),"scarf")],3,"_r3z_scarf.png")
grid([("silhouette_20m",(0.40,0.36,0.60,0.66),"20m"),
      ("silhouette_20m_idle",(0.40,0.36,0.60,0.66),"20m idle"),
      ("shadow_lowangle",(0.18,0.30,0.86,0.98),"shadow"),
      ("face_closeup",(0.28,0.16,0.74,0.62),"face"),
      ("face_lookaround",(0.28,0.16,0.74,0.62),"look"),
      ("idle_p50",(0.30,0.62,0.72,0.98),"contact")],3,"_r3z_sil.png")
grid([("longjump_p50",(0.26,0.30,0.78,0.82),"LJ50"),("dive_p50",(0.26,0.30,0.78,0.82),"DV50"),
      ("jump3_p50",(0.26,0.20,0.78,0.72),"J3"),
      ("longjump_p90",(0.26,0.30,0.78,0.82),"LJ90"),("dive_p90",(0.26,0.30,0.78,0.82),"DV90"),
      ("poundFall_p90",(0.30,0.24,0.76,0.70),"PF90")],3,"_r3z_lj.png",560)
