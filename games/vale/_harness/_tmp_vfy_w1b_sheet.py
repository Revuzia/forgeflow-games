# verify W1-B r2 (temp): A/B sheet of the face row (before | after per fighter) + game-camera cells at 3x + 64 px
import sys
from PIL import Image
D = '_harness/_tmp_vfy_w1b'
fs = ['odrum','ulkro','ardit','dunsom','hesmi']
for f in fs:
    rows = []
    out = Image.new('RGB', (2400, 2*300 + 2*200), (30,30,30))
    for k, v in enumerate(['before','after']):
        im = Image.open(f'{D}/face_{v}_{f}.png').convert('RGB')
        out.paste(im.crop((0,600,2400,900)), (0, k*300))
        # game camera cell 0 and 4 at 1:1 crop 100x100 -> 200 (2x), and 64 px card-ish downsample of full-body front (cell 4 of row 3)
        for j, c in enumerate([0, 2, 4, 6]):
            g = im.crop((c*300+100, 50, c*300+200, 150)).resize((200,200), Image.LANCZOS)
            out.paste(g, (j*200 + k*1200, 600))
        body = im.crop((4*300,600,5*300,900))
        out.paste(body.resize((64,64), Image.LANCZOS), (k*1200 + 820, 600))
        out.paste(body.resize((128,128), Image.LANCZOS), (k*1200 + 900, 600))
        head = im.crop((0,600,300,900))
        out.paste(head.resize((64,64), Image.LANCZOS), (k*1200 + 820, 680))
    out.save(f'{D}/ab_{f}.png')
