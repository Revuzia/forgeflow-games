# verify W1-B r3 (temp): per fighter, rows = lane start / fix 2 / HEAD: head close-ups row (3), game-camera cells 1:1 and 3x, 128 and 64 px card downsamples
from PIL import Image
D='_harness/_tmp_vfy_w1b_r3'
for f in ['odrum','ulkro','ardit','dunsom','hesmi']:
    out=Image.new('RGB',(2400,3*300),(30,30,30))
    gc=Image.new('RGB',(8*300+40,3*(300+10)),(30,30,30))
    card=Image.new('RGB',(3*(128+64+128+64+20),140),(30,30,30))
    for k,v in enumerate(['before','f2','after']):
        im=Image.open(f'{D}/face_{v}_{f}.png').convert('RGB')
        out.paste(im.crop((0,600,2400,900)),(0,k*300))
        # game camera row 1 (1:1 px at 1080p), 8 facings
        gc.paste(im.crop((0,0,2400,300)),(0,k*310))
        body=im.crop((4*300,600,5*300,900)); head=im.crop((0,600,300,900))
        x=k*(128+64+128+64+20)
        card.paste(body.resize((128,128),Image.LANCZOS),(x,0)); card.paste(body.resize((64,64),Image.LANCZOS),(x+128,0))
        card.paste(head.resize((128,128),Image.LANCZOS),(x+192,0)); card.paste(head.resize((64,64),Image.LANCZOS),(x+320,0))
    out.save(f'{D}/ab_head_{f}.png'); gc.save(f'{D}/ab_gc_{f}.png'); card.save(f'{D}/ab_card_{f}.png')
    # game-camera 3x zoom of facings 0,2,4,6 around the body
    z=Image.new('RGB',(4*300,3*300),(30,30,30))
    for k,v in enumerate(['before','f2','after']):
        im=Image.open(f'{D}/face_{v}_{f}.png').convert('RGB')
        for j,c in enumerate([0,2,4,6]):
            z.paste(im.crop((c*300+100,40,c*300+200,140)).resize((300,300),Image.LANCZOS),(j*300,k*300))
    z.save(f'{D}/ab_gc3x_{f}.png')
