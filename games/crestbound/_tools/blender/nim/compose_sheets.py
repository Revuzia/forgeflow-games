"""
Composite the per-frame renders into the two deliverable sheets (system python + Pillow):

    python compose_sheets.py --kit <kit dir>

  <kit>/_work/sheet/NN_state.webp  -> <kit>/_turntable/nim_clips_contact_sheet.webp (labelled grid)
  <kit>/_work/runstrip/run_NN.webp -> <kit>/_turntable/nim_run_cycle_strip.webp (12 frames)
"""
import os, sys, glob, json
from PIL import Image, ImageDraw, ImageFont

kit = sys.argv[sys.argv.index('--kit') + 1]
tdir = os.path.join(kit, '_turntable')
os.makedirs(tdir, exist_ok=True)
try:
    font = ImageFont.truetype("arial.ttf", 22)
    small = ImageFont.truetype("arial.ttf", 16)
except Exception:
    font = ImageFont.load_default(); small = font

# ---- contact sheet

def _save(im, path):
    """PIL picks the codec off the extension; the kwargs have to follow it (optimize is PNG-only)."""
    if path.lower().endswith('.webp'):
        im.convert('RGB').save(path, 'WEBP', quality=92, method=5)
    else:
        im.save(path, optimize=True)

frames = sorted(glob.glob(os.path.join(kit, '_work', 'sheet', '*.webp')))
meta = {c['name']: c for c in json.load(open(os.path.join(kit, '_work', 'clips_meta.json')))}
if frames:
    cols = 7
    tw, th = Image.open(frames[0]).size
    rows = (len(frames) + cols - 1) // cols
    pad = 6; label_h = 30
    W = cols * (tw + pad) + pad; H = rows * (th + label_h + pad) + pad + 44
    sheet = Image.new('RGB', (W, H), (24, 25, 28))
    d = ImageDraw.Draw(sheet)
    d.text((pad + 4, 10), "NIM - clip contact sheet: one frame per CONTRACT s11 state (+walk, +bonk)  |  %d clips" % len(frames),
           fill=(230, 230, 230), font=font)
    for i, f in enumerate(frames):
        im = Image.open(f).convert('RGB')
        name = os.path.basename(f)[3:-4]
        c, r = i % cols, i // cols
        x = pad + c * (tw + pad); y = 44 + pad + r * (th + label_h + pad)
        sheet.paste(im, (x, y))
        m = meta.get(name, {})
        d.rectangle((x, y + th, x + tw, y + th + label_h), fill=(38, 40, 44))
        d.text((x + 6, y + th + 5), "%s  %.2fs%s" % (name, m.get('dur', 0), '  loop' if m.get('loop') else ''),
               fill=(235, 220, 190), font=small)
    out = os.path.join(tdir, 'nim_clips_contact_sheet.webp')
    _save(sheet, out)
    print("wrote", out, sheet.size)

# ---- run strip
frames = sorted(glob.glob(os.path.join(kit, '_work', 'runstrip', 'run_*.webp')))
if frames:
    tw, th = Image.open(frames[0]).size
    pad = 4
    W = len(frames) * (tw + pad) + pad; H = th + pad * 2 + 40
    strip = Image.new('RGB', (W, H), (24, 25, 28))
    d = ImageDraw.Draw(strip)
    d.text((8, 8), "NIM run cycle - 12 frames, one full stride (1.90 m at 9.0 m/s = %.3f s), side view" % meta['run']['dur'],
           fill=(230, 230, 230), font=font)
    for i, f in enumerate(frames):
        im = Image.open(f).convert('RGB')
        strip.paste(im, (pad + i * (tw + pad), 40 + pad))
        d.text((pad + i * (tw + pad) + 6, 40 + pad + 4), "%02d" % i, fill=(255, 240, 200), font=small)
    out = os.path.join(tdir, 'nim_run_cycle_strip.webp')
    _save(strip, out)
    print("wrote", out, strip.size)
