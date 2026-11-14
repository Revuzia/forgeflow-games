"""Image lane: pure-black (0,0,0) census over fresh shots, HUD regions masked, plus the critic's named boxes."""
from PIL import Image
import glob, os, sys
def census(path, boxes=()):
    im = Image.open(path).convert('RGB'); W,H = im.size; px = im.load()
    n=0; blk=0
    for y in range(0,H,2):
        for x in range(0,W,2):
            if (x<390 and y<190) or (x<220 and y>920) or (x>1760 and y<130) or (x>1800 and y>1030): continue
            n+=1
            if px[x,y]==(0,0,0): blk+=1
    out = '%-28s black %5d / %6d = %.3f%%' % (path.replace(os.sep,'/').split('_shots/')[-1], blk, n, 100*blk/n)
    for (x0,y0,x1,y1) in boxes:
        bn=0; bb=0
        for y in range(y0,y1):
            for x in range(x0,x1):
                bn+=1
                if px[x,y]==(0,0,0): bb+=1
        out += '  box%s %.1f%%' % ((x0,y0,x1,y1), 100*bb/bn)
    print(out)
named = {
 'ember-1/crest-open.png': [(820,300,1360,330)],
 'ember-1/crest-metal.png': [(860,470,960,560)],
 'keep/spawn.png': [(586,326,610,350),(1318,238,1342,262)],
 'keep/cp1.png': [(586,326,610,350)],
 'keep/cp2.png': [(440,175,500,235)],
 'azure-3/crest-boss.png': [(0,900,1920,1080)],
 'ember-4/crest-coins.png': [(780,650,900,770)],
}
courses = sys.argv[1:] or ['ember-1','ember-4','keep','azure-3','verdant-1']
for d in courses:
    for p in sorted(glob.glob('_shots/%s/*.png' % d)):
        b = os.path.basename(p)
        if b.startswith(('_','nanprobe','boot')): continue
        rel = d + '/' + b
        census(p, named.get(rel, ()))
