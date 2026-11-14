# Review helper: tile a piece's 9 turntable frames into one 3x3 contact sheet (scratch output, not kit output).
#   python contact_sheet.py <piece> [<out_dir>]
import sys, os, glob
from PIL import Image, ImageDraw

KIT_DIR = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound/assets/models/keep/_turntable'
name = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(KIT_DIR, f'{name}_*.png')))
cell = 400
sheet = Image.new('RGB', (cell * 3, cell * 3), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files[:9]):
    im = Image.open(f).convert('RGB').resize((cell, cell), Image.LANCZOS)
    x, y = (i % 3) * cell, (i // 3) * cell
    sheet.paste(im, (x, y))
    d.text((x + 6, y + 6), os.path.basename(f), fill=(255, 220, 120))
out = os.path.join(out_dir, f'{name}_sheet.png')
sheet.save(out)
print(out)
