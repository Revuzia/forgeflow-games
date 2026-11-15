import sys, glob
from PIL import Image, ImageStat
for p in sorted(glob.glob(sys.argv[1])):
    im = Image.open(p).convert('L')
    w, h = im.size
    full = ImageStat.Stat(im).mean[0]
    c = im.crop((w*3//8, h*3//8, w*5//8, h*5//8))
    print(f"{p.split('/')[-1].split(chr(92))[-1]:45s} {w}x{h} full={full:6.1f} centre={ImageStat.Stat(c).mean[0]:6.1f}")
