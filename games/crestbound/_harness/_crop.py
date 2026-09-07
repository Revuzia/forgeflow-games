import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
x0,y0,x1,y1 = [int(v) for v in sys.argv[3:7]]
sc = float(sys.argv[7]) if len(sys.argv) > 7 else 3.0
im = Image.open(src).convert("RGB").crop((x0,y0,x1,y1))
im = im.resize((int(im.width*sc), int(im.height*sc)), Image.LANCZOS)
im.save(dst)
print(dst, im.size)
