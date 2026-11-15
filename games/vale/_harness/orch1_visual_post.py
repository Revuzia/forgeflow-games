"""orch1 visual pack post-process: crops (fighters, structures), contact sheets, size cap, index.json.
Run with the repo venv: ~/Developer/forgeflow-games/.venv/bin/python3 _harness/orch1_visual_post.py
Collects only: no image is altered in content beyond crop / downscale / palette quantization (recorded per file)."""
import json, glob, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'visual')
CAP = 3_000_000
RENAMED = {}   # png name -> webp name, for a frame that stayed over the cap as a lossless PNG


def save_capped(im, path, note=None):
    """save lossless PNG. Over the cap: WebP quality 95 next to it (the PNG is removed). NEVER a palette: the grade, AO and
    fog gradients must stay unbanded (orch1 GFX-11). Returns the method."""
    im.save(path, optimize=True)
    if os.path.getsize(path) <= CAP:
        return 'lossless-png'
    wp = os.path.splitext(path)[0] + '.webp'
    im.convert('RGB').save(wp, 'WEBP', quality=95, method=6)
    os.remove(path)
    RENAMED[os.path.basename(path)] = os.path.basename(wp)
    return 'webp-q95' if os.path.getsize(wp) <= CAP else 'webp-q95-over-cap'


def openimg(n):
    p = os.path.join(OUT, n)
    return Image.open(p if os.path.exists(p) else os.path.join(OUT, RENAMED.get(n, n)))


parts = []
for f in sorted(glob.glob(os.path.join(OUT, '_parts', '*.json'))):
    d = json.load(open(f))
    if 'records' in d:
        parts.append(d)
records = list({r['file']: r for p in parts for r in p['records']}.values())   # same file name written twice (several structures of one kind share a name): the last write is what is on disk
final = []
sheets = {}
for r in records:
    k = r['kind']
    path = os.path.join(OUT, r['file'])
    if not os.path.exists(path):
        continue
    if k == 'fighter_raw':
        im = Image.open(path).convert('RGB')
        sx, sy = r['screen']['x'], r['screen']['y']
        size = 520 if 'game' in r['file'] else 900
        x0 = int(min(max(0, sx - size / 2), 1920 - size)); y0 = int(min(max(0, sy - size / 2), 1080 - size))
        crop = im.crop((x0, y0, x0 + size, y0 + size))
        cam = 'game' if 'game' in r['file'] else 'close'
        name = f"fighter_{r['fighter']}_{cam}_crop.png"
        m = save_capped(crop, os.path.join(OUT, name))
        sheets.setdefault(cam, {})[r['fighter']] = crop
        final.append({'file': name, 'what': f"{r['fighter']} base skin, {r['camera']}, native-pixel {size}x{size} crop around the fighter", 'kind': 'fighter_crop', 'fighter': r['fighter'], 'team': r['team'], 'map': 'rift', 'seed': r['seed'], 'time_s': r['time_s'], 'time': r['time'], 'quality': 'high', 'width': size, 'height': size, 'crop_origin': [x0, y0], 'source_frame': 1920, 'encode': m})
        # keep the full frame too, as a cappped PNG, for the game camera only
        if cam == 'game':
            m2 = save_capped(im, os.path.join(OUT, f"fighter_{r['fighter']}_game_frame.png"))
            final.append({'file': f"fighter_{r['fighter']}_game_frame.png", 'what': f"{r['fighter']} base skin in a real match at the game camera, full frame", 'kind': 'fighter_frame', 'fighter': r['fighter'], 'team': r['team'], 'map': 'rift', 'seed': r['seed'], 'time_s': r['time_s'], 'time': r['time'], 'quality': 'high', 'width': 1920, 'height': 1080, 'encode': m2})
        os.remove(path)
    elif k == 'structure_raw':
        im = Image.open(path).convert('RGB')
        sx, sy = r['screen']['x'], r['screen']['y']
        w, h = 960, 540
        x0 = int(min(max(0, sx - w / 2), 1920 - w)); y0 = int(min(max(0, sy - h / 2), 1080 - h))
        name = f"structure_{r['map']}_{r['structure']}_team{r['team']}_{r['stage']}.png"
        crop = im.crop((x0, y0, x0 + w, y0 + h))
        m = save_capped(crop, os.path.join(OUT, name))
        e = dict(r); e.update({'file': name, 'kind': 'structure_stage', 'width': w, 'height': h, 'crop_origin': [x0, y0], 'source_frame': 1920, 'encode': m}); e.pop('screen', None)
        final.append(e)
        os.remove(path)
    else:
        im = Image.open(path)
        m = save_capped(im, path)
        e = dict(r); e['encode'] = m
        final.append(e)

# contact sheets (downscaled)
FIGS = [r for r in final if r['kind'] == 'fighter_crop']
for cam, label in (('game', 'game camera'), ('close', 'closest camera')):
    ims = sheets.get(cam, {})
    if not ims:
        continue
    ids = sorted(ims)
    cell = 480 if cam == 'game' else 480
    cols = 4
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 28)), (20, 20, 24))
    dr = ImageDraw.Draw(sheet)
    for i, fid in enumerate(ids):
        c = ims[fid].resize((cell, cell), Image.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * (cell + 28)
        sheet.paste(c, (x, y + 28))
        dr.text((x + 8, y + 8), fid, fill=(235, 235, 235))
    name = f'contact_fighters_{cam}.png'
    m = save_capped(sheet, os.path.join(OUT, name))
    final.append({'file': name, 'what': f'contact sheet of all {len(ids)} fighters, base skin, {label}, 4x{rows} grid of {cell}px cells (crops downscaled to {cell}px), labelled with the fighter id', 'kind': 'contact_sheet', 'fighters': ids, 'map': 'rift', 'quality': 'high', 'width': sheet.width, 'height': sheet.height, 'encode': m})

# quality triples and colour-blind side-by-side sheets
def sbs(names, labels, out, what, kind):
    ims = [openimg(n).convert('RGB') for n in names if os.path.exists(os.path.join(OUT, n)) or os.path.exists(os.path.join(OUT, RENAMED.get(n, n)))]
    if len(ims) != len(names):
        return
    w = 960; h = 540
    sheet = Image.new('RGB', (w * len(ims), h + 24), (20, 20, 24))
    dr = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(zip(ims, labels)):
        sheet.paste(im.resize((w, h), Image.LANCZOS), (i * w, 24)); dr.text((i * w + 8, 6), lab, fill=(235, 235, 235))
    m = save_capped(sheet, os.path.join(OUT, out))
    final.append({'file': out, 'what': what, 'kind': kind, 'map': 'rift', 'width': sheet.width, 'height': sheet.height, 'encode': m, 'sources': names})

sbs([f'quality_teamfight_{q}.png' for q in ('low', 'medium', 'high', 'ultra')], ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'], 'sheet_quality_teamfight.png', 'side by side (each downscaled to 960x540): the same teamfight peak frame on Low, Medium, High and Ultra', 'sheet')
for nm in ('river_mid', 'base_aubade', 'jungle_glasshorn'):
    sbs([f'quality_{nm}_{q}.png' for q in ('low', 'medium', 'high', 'ultra')], ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'], f'sheet_quality_{nm}.png', f'side by side (each downscaled to 960x540): {nm} on Low, Medium, High and Ultra', 'sheet')
sbs(['teamfight_rift_peak.png'] + [f'colorblind_teamfight_{c}_peak.png' for c in ('deutan', 'protan', 'tritan')], ['DEFAULT', 'DEUTAN', 'PROTAN', 'TRITAN'], 'sheet_colorblind_teamfight.png', 'the same teamfight peak frame, default and the three colour-blind modes (each downscaled to 960x540, 2 across is not used: 4 across)', 'sheet')

order = {k: i for i, k in enumerate(['map', 'minion_clash', 'teamfight', 'quality', 'colorblind', 'fighter_frame', 'fighter_crop', 'contact_sheet', 'structure_stage', 'camp', 'moment', 'recall', 'death', 'respawn', 'sheet'])}
final.sort(key=lambda r: (order.get(r['kind'], 99), r['file']))
for r in final:
    r['file'] = RENAMED.get(r['file'], r['file'])
    r['bytes'] = os.path.getsize(os.path.join(OUT, r['file']))
idx = {
    'pack': 'orch1 visual evidence', 'collector': 'EVIDENCE COLLECTOR (visual): collects and measures, does not judge', 'head': os.popen('git rev-parse --short HEAD').read().strip(),
    'build': 'working tree of the branch at collection time, served by vite dev (catalog 2026.11.5), render bench _harness/web/render_bench.html',
    'camera': 'real game camera (map camera distance, free mode centred on the subject); canvas drawing buffer 1920x1080 at device scale 1; preset High unless the file says otherwise; dynamic resolution off',
    'seed': 7, 'driver': '_harness/orch1_visual_pack.mjs (+ _harness/orch1_visual_post.py for crops, sheets, size cap)',
    'size_cap': f'{CAP} bytes per PNG; over the cap a file is re-encoded as WebP q95 (field "encode"), never a palette, never resized except contact/side-by-side sheets',
    'files': final,
}
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print(len(final), 'files; webp:', [r['file'] for r in final if r['file'].endswith('.webp')], 'palette frames:', [r['file'] for r in final if 'palette' in str(r.get('encode'))])
