"""Crop fixed inspection regions out of a station shot so a reviewer can judge
texture SCALE and CHARACTER, which a 1600x900 contact sheet cannot show."""
import os, sys
from PIL import Image
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
def crop(src, box, out, up=2):
    im=Image.open(src).convert('RGB')
    W,H=im.size
    b=(int(box[0]*W),int(box[1]*H),int(box[2]*W),int(box[3]*H))
    c=im.crop(b)
    c=c.resize((c.width*up, c.height*up), Image.LANCZOS)
    c.save(out); print(out, c.size)
if __name__=='__main__':
    for src, box, name in [
        (sys.argv[1], (float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4]),float(sys.argv[5])), sys.argv[6]),
    ]:
        crop(src, box, os.path.join(ROOT,'_shots',name))
