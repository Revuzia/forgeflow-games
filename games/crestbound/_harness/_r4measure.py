from PIL import Image
import numpy as np, sys
def stats(f, box=None, label=''):
    im=np.asarray(Image.open(f).convert('RGB')).astype(np.float32)/255
    a=im[box[1]:box[3], box[0]:box[2]] if box else im[200:900]
    lin=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    lum=lin[...,0]*0.2126+lin[...,1]*0.7152+lin[...,2]*0.0722
    mx=a.max(2); mn=a.min(2); sat=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
    print('%-28s meanLum %.4f  sd %.4f  <0.06 %5.1f%%  >0.90 %.2f%%  sat %.3f  srgbMean %.3f'
          %(label or f, lum.mean(), lum.std(), (lum<0.06).mean()*100, (lum>0.90).mean()*100, sat.mean(), a.mean()))
S='_shots/'
for f in ['keep/vista-sw','keep/vista-ne','keep/spawn','keep/cp1','keep/cp2','verdant-1/spawn','verdant-1/vista-se','verdant-1/cp2']:
    stats(S+f+'.png', None, f)
print()
# far hillside band in vista-se: the region the critic called "untextured saturated green"
stats(S+'verdant-1/vista-se.png', (150,430,1450,560), 'v1 vista-se FAR HILLS')
stats(S+'verdant-1/spawn.png', (380,180,1150,330), 'v1 spawn FAR HILLS')
im=np.asarray(Image.open(S+'verdant-1/vista-se.png').convert('RGB'))
print('vista-se column x=700:')
for y in range(190,440,10): print('  ',y, tuple(int(v) for v in im[y,700]))
