import sys, numpy as np
from PIL import Image
# sheet.py out.png name...  : rows of live | cache | x4 diff ; prints mean|d|, mean RGB, detail (std of image - 9x9 box)
out, names = sys.argv[1], sys.argv[2:]
rows=[]
def detail(a):
    im=Image.fromarray(a.astype(np.uint8)); from PIL import ImageFilter
    b=np.asarray(im.filter(ImageFilter.BoxBlur(4))).astype(np.float32); return (a-b).std()
for n in names:
    a=np.asarray(Image.open(n+'-l.png').convert('RGB')).astype(np.float32); b=np.asarray(Image.open(n+'-c.png').convert('RGB')).astype(np.float32)
    d=np.abs(a-b)
    print(f"{n}: mean|d| {d.mean():.2f}  >16: {(d.max(axis=2)>16).mean()*100:.2f}%  rgb live {a.mean((0,1)).round(1)} cache {b.mean((0,1)).round(1)}  detail {detail(a):.2f}/{detail(b):.2f}")
    rows.append(np.concatenate([a,b,np.clip(d*4,0,255)],1))
Image.fromarray(np.concatenate(rows,0).astype(np.uint8)).save(out)
