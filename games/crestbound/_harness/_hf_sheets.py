import os, math
from PIL import Image, ImageDraw, ImageFont
SH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_shots", "hero")
try: F = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 20)
except Exception: F = ImageFont.load_default()
def z(name, box, lbl, size):
    im = Image.open(os.path.join(SH, name + ".png")).convert("RGB"); w, h = im.size
    c = im.crop((int(box[0]*w), int(box[1]*h), int(box[2]*w), int(box[3]*h))).resize((size, size), Image.LANCZOS)
    d = ImageDraw.Draw(c); d.rectangle([0, 0, size-1, 24], fill=(0, 0, 0)); d.text((4, 1), name + " " + lbl, fill=(255, 220, 90), font=F)
    return c
def grid(items, cols, out, size=460):
    ims = [z(n, b, l, size) for n, b, l in items]
    rows = math.ceil(len(ims)/cols)
    o = Image.new("RGB", (cols*size, rows*size), (18, 18, 24))
    for i, im in enumerate(ims): o.paste(im, ((i % cols)*size, (i//cols)*size))
    o.save(os.path.join(SH, out)); print(out, o.size)
W = (0.22, 0.14, 0.84, 0.76)
grid([("longjump_p10", W, "LJ10"), ("longjump_p50", W, "LJ50"), ("longjump_p90", W, "LJ90"),
      ("dive_p10", W, "DV10"), ("dive_p50", W, "DV50"), ("dive_p90", W, "DV90"),
      ("poundFall_p10", W, "PF10"), ("poundFall_p50", W, "PF50"), ("poundFall_p90", W, "PF90")],
     3, "_hf_a_air.png")
grid([("jump3_p10", W, ""), ("jump3_p50", W, ""), ("jump3_p90", W, ""),
      ("backflip_p10", W, ""), ("backflip_p50", W, ""), ("backflip_p90", W, ""),
      ("climb_p10", W, ""), ("climb_p50", W, ""), ("climb_p90", W, ""),
      ("wallslide_p10", W, ""), ("wallslide_p50", W, ""), ("wallslide_p90", W, "")],
     3, "_hf_b_states.png")
H = (0.30, 0.04, 0.70, 0.44)
grid([("longjump_p50", (0.28, 0.04, 0.72, 0.48), "scarf"), ("dive_p50", (0.28, 0.08, 0.72, 0.52), "scarf"),
      ("poundFall_p90", (0.32, 0.10, 0.76, 0.54), "scarf"), ("fly_p50", (0.32, 0.14, 0.76, 0.58), "scarf"),
      ("swim_p50", (0.28, 0.14, 0.72, 0.58), "scarf"), ("land_p50", (0.30, 0.10, 0.74, 0.54), "scarf")],
     3, "_hf_c_scarf.png", 520)
grid([("turntable_a0", (0.40, 0.62, 0.62, 0.84), "boots"), ("turntable_a1", (0.40, 0.62, 0.62, 0.84), "boots"),
      ("turntable_a5", (0.38, 0.62, 0.60, 0.84), "boots"), ("idle_p50", (0.38, 0.62, 0.62, 0.86), "boots"),
      ("run_p50", (0.30, 0.55, 0.62, 0.87), "boots"), ("silhouette_20m", (0.40, 0.36, 0.60, 0.66), "20m")],
     3, "_hf_d_boots.png", 520)
