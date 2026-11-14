# contact sheet: python sheet.py out.png cols width crop(x0,y0,x1,y1 as fractions or 'full') img1 img2 ...
import sys
from PIL import Image
out, cols, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
crop = sys.argv[4]
files = sys.argv[5:]
imgs = []
for f in files:
    im = Image.open(f).convert("RGB")
    if crop != "full":
        x0, y0, x1, y1 = [float(v) for v in crop.split(",")]
        W, H = im.size
        im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
    r = width / im.size[0]
    im = im.resize((width, int(im.size[1] * r)), Image.LANCZOS)
    imgs.append(im)
rows = (len(imgs) + cols - 1) // cols
h = imgs[0].size[1]
sheet = Image.new("RGB", (cols * width, rows * h), (0, 0, 0))
for i, im in enumerate(imgs):
    sheet.paste(im, ((i % cols) * width, (i // cols) * h))
sheet.save(out)
print(out, sheet.size)
