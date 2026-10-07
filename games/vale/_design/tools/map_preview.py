#!/usr/bin/env python3
"""Top-down design preview of a VALE MapDef (content/maps/<id>.json) → _design/maps/<id>.png.

Reads only the JSON (what the sim, Blender and the minimap read). Pillow only.
Legend: dark = walls (lit top edge), pale stone = open ground, paved band = lanes (7.2 m),
green = Needlegrass, azure = Aubade (team 0), marigold = Serenade (team 1), dialstone = neutral,
faint rings = Needle "shadow rings" (7.5 m attack range), thin lines = `requires` (protection).

usage: python3 _design/tools/map_preview.py [map_id ...]
"""
from __future__ import annotations

import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))

INK = (17, 20, 26)
WALL = (46, 44, 40)
WALL_TOP = (126, 121, 108)
GROUND = (108, 112, 98)
JUNGLE_GROUND = (84, 92, 76)
LANE = (160, 152, 133)
LANE_EDGE = (120, 114, 100)
THICKET = (64, 104, 70)
THICKET_EDGE = (120, 160, 112)
AZURE = (63, 156, 255)
MARIGOLD = (255, 154, 31)
NEUTRAL = (169, 164, 154)
CHALK = (237, 230, 214)
SHADOW = (74, 69, 96)
WATER = (78, 98, 112)
SEAT_COLORS = ['#B2354A', '#767305', '#D9FF17', '#20A04E', '#26F3FF', '#19AFFE', '#7273F5', '#8121FC', '#993F94', '#DC6294']
SEAT_GLYPHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

FONT_PATHS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf']
FONT_BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf']


def font(size, bold=False):
    for p in (FONT_BOLD if bold else FONT_PATHS):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


UNIT_LABEL = {
    'glasshorn': 'Glasshorn', 'resinback': 'Resinback', 'gloamoth': 'Gloamoths', 'stilltusk': 'Stilltusks',
    'stray_numeral': 'Strays', 'sunsplinter': 'Sunsplinter', 'longshade': 'Longshade',
}
PICKUP_COL = {'sunmote_mend': (99, 216, 139), 'sunmote_quick': (220, 232, 238), 'sunmote_gleam': (232, 194, 122)}


def render(map_id: str) -> str:
    with open(os.path.join(ROOT, 'content', 'maps', f'{map_id}.json')) as f:
        m = json.load(f)
    W, H = m['size']
    ppm = 8 if W > 100 else 12
    pad_top, pad_bot, pad_x = 54, 112, 24
    img = Image.new('RGB', (int(W * ppm) + 2 * pad_x, int(H * ppm) + pad_top + pad_bot), INK)
    d = ImageDraw.Draw(img, 'RGBA')
    ox, oy = pad_x, pad_top

    def X(p):
        return (ox + p[0] * ppm, oy + p[1] * ppm)

    def circle(c, r, fill=None, outline=None, width=1):
        x, y = X(c)
        d.ellipse([x - r * ppm, y - r * ppm, x + r * ppm, y + r * ppm], fill=fill, outline=outline, width=width)

    # ground
    d.rectangle([ox, oy, ox + W * ppm, oy + H * ppm], fill=JUNGLE_GROUND if m['camps'] else GROUND)
    terr = m['art'].get('terrain', {})
    # Noonline tints (Hourfall)
    nl = terr.get('noonline')
    nl_floors = []
    if nl:
        nl_floors = [(poly, SHADOW) for poly in nl['standingShadow']['floor']] + [(poly, WATER) for poly in nl['fallenShaft']['floor']]
    # clearings: camps, bases, structures
    for c in m['camps']:
        cx = sum(u['at'][0] for u in c['units']) / len(c['units'])
        cy = sum(u['at'][1] for u in c['units']) / len(c['units'])
        circle((cx, cy), 6.5 if c.get('objective') else 4.2, fill=(122, 118, 106, 170))
    for b in m['bases']:
        circle(b['fountain']['at'], b['fountain']['radius'] + 6, fill=(150, 146, 132, 110))
    if m['spawns']:
        circle((W / 2, H / 2), 30.0, fill=(74, 71, 68))
        for k, s in enumerate(m['spawns']):
            d.line([X((W / 2, H / 2)), X(s)], fill=(183, 176, 160, 120), width=2)
    for poly, col in nl_floors:
        d.polygon([X(p) for p in poly], fill=col + (230,))
    # lanes: paved band 7.2 m
    for ln in m['lanes']:
        pts = [X(p) for p in ln['path']]
        d.line(pts, fill=LANE_EDGE, width=int(7.8 * ppm), joint='curve')
        d.line(pts, fill=LANE, width=int(7.2 * ppm), joint='curve')
        for p in pts:
            d.ellipse([p[0] - 3.6 * ppm, p[1] - 3.6 * ppm, p[0] + 3.6 * ppm, p[1] + 3.6 * ppm], fill=LANE)
    # thickets
    for t in m['thickets']:
        d.polygon([X(p) for p in t], fill=THICKET + (235,), outline=THICKET_EDGE)
    # walls
    for wpoly in m['walls']:
        pts = [X(p) for p in wpoly]
        d.polygon(pts, fill=WALL)
        d.line(pts + [pts[0]], fill=WALL_TOP, width=2)
    # lane names
    for ln in m['lanes']:
        p = ln['path'][len(ln['path']) // 2]
        q = ln['path'][len(ln['path']) // 2 - 1] if len(ln['path']) > 2 else ln['path'][0]
        x, y = X(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
        d.text((x, y - 12), f"{ln['name']}  ·  {ln['id']}", font=font(12), fill=(60, 56, 48), anchor='mm')
    # lane centre lines + labels
    for ln in m['lanes']:
        pts = [X(p) for p in ln['path']]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            L = math.dist(a, b)
            n = max(1, int(L / 14))
            for k in range(n):
                if k % 2 == 0:
                    t0, t1 = k / n, (k + 1) / n
                    d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)],
                           fill=(237, 230, 214, 150), width=1)
        for p in ln['path']:
            x, y = X(p)
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(237, 230, 214, 200))
    f_s, f_m, f_b = font(11), font(13), font(15, True)
    # structures
    by_id = {s['id']: s for s in m['structures']}
    for s in m['structures']:
        for r in s['requires']:
            q = by_id.get(r)
            if q:
                d.line([X(s['at']), X(q['at'])], fill=(237, 230, 214, 90), width=1)
    for s in m['structures']:
        col = AZURE if s['team'] == 0 else MARIGOLD
        x, y = X(s['at'])
        u = s['unit']
        if u.startswith('needle'):
            circle(s['at'], 7.5, outline=col + (70,), width=1)
            r = 1.1 * ppm + 3
            d.polygon([(x, y - r * 1.4), (x + r, y + r * 0.8), (x - r, y + r * 0.8)], fill=col, outline=INK)
            if u == 'needle_bell':
                d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=INK)
        elif u == 'lantern':
            r = 1.5 * ppm
            d.rectangle([x - r, y - r, x + r, y + r], fill=col, outline=INK, width=2)
            d.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=CHALK)
        elif u == 'hourbell':
            r = 2.6 * ppm
            d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=CHALK, width=3)
            d.ellipse([x - r * 0.4, y - r * 0.4, x + r * 0.4, y + r * 0.4], fill=INK)
    # bases
    for b in m['bases']:
        col = AZURE if b['team'] == 0 else MARIGOLD
        circle(b['fountain']['at'], b['fountain']['radius'], outline=col + (220,), width=2)
        circle(b['shop']['at'], b['shop']['radius'], fill=(232, 194, 122, 90), outline=(232, 194, 122, 255), width=2)
        x, y = X(b['spawn'])
        d.line([x - 6, y, x + 6, y], fill=CHALK, width=2)
        d.line([x, y - 6, x, y + 6], fill=CHALK, width=2)
    for s in m['shops']:
        circle(s['at'], s['radius'], fill=(232, 194, 122, 120), outline=(232, 194, 122, 255), width=2)
        x, y = X(s['at'])
        d.text((x, y + s['radius'] * ppm + 8), 'Lampwright', font=f_s, fill=CHALK, anchor='mt')
    # camps
    for c in m['camps']:
        for u in c['units']:
            big = u['unit'] in ('sunsplinter', 'longshade')
            r = 2.0 if big else (0.9 if u['unit'] in ('glasshorn', 'resinback', 'stilltusk', 'stray_numeral', 'gloamoth') else 0.5)
            circle(u['at'], r, fill=NEUTRAL, outline=INK, width=2)
        lead = c['units'][0]['unit']
        cx = sum(u['at'][0] for u in c['units']) / len(c['units'])
        cy = sum(u['at'][1] for u in c['units']) / len(c['units'])
        x, y = X((cx, cy))
        label = UNIT_LABEL.get(lead, lead)
        d.text((x, y + (3.4 if c.get('objective') else 2.4) * ppm), label, font=f_b if c.get('objective') else f_s,
               fill=CHALK, anchor='mt', stroke_width=2, stroke_fill=INK)
    # pickups
    for p in m['pickups']:
        x, y = X(p['at'])
        col = PICKUP_COL.get(p['unit'], CHALK)
        r = 7
        d.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=col, outline=INK)
    # FFA spawns (hour-marks)
    for k, s in enumerate(m['spawns']):
        x, y = X(s)
        col = hexrgb(SEAT_COLORS[k % 10])
        d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=col, outline=CHALK, width=2)
        d.text((x, y), SEAT_GLYPHS[k % 10], font=f_s, fill=INK if k in (2, 4) else CHALK, anchor='mm')
    # region callouts (Hourfall)
    if m['id'] == 'map_rift':
        def pol(r, a, flip=False, mirror=False):
            x, y = 85 - r * math.cos(math.radians(a)), 55 - r * math.sin(math.radians(a))
            return (170 - x if mirror else x, 110 - y if flip else y)
        for name, p in (('ELEVENMARK', pol(40, 42)), ('SEVENMARK', pol(40, 42, flip=True)), ('TWOMARK', pol(40, 42, mirror=True)),
                        ('FOURMARK', pol(40, 42, True, True)),
                        ('Standing Shadow', (85, 46.5)), ('Fallen Shaft', (85, 71.5)), ('the Seat', (85, 52.5)),
                        ('Glass Belfry', (11, 68.5)), ('Lamp Dome', (159, 68.5))):
            x, y = X(p)
            d.text((x, y), name, font=f_s, fill=(237, 230, 214, 200), anchor='mm', stroke_width=2, stroke_fill=INK)
    if m['id'] == 'map_bridge':
        for name, p in (('Dawn Arch', (9, 34)), ('Lamp Gate', (W - 9, 34)), ('the Snap', (W / 2, 33.5))):
            x, y = X(p)
            d.text((x, y), name, font=f_s, fill=CHALK, anchor='mm', stroke_width=2, stroke_fill=INK)
    # art landmarks (art.terrain.landmarks): solid footprints as chalk outlines, flush inlays as dots
    for l in terr.get('landmarks', []):
        if l.get('flush'):
            continue
        x0, y0 = X((l['at'][0] - l['size'][0] / 2, l['at'][1] - l['size'][1] / 2))
        x1, y1 = X((l['at'][0] + l['size'][0] / 2, l['at'][1] + l['size'][1] / 2))
        d.rectangle([x0, y0, x1, y1], outline=(237, 230, 214, 170), width=1)
    # camera footprint at default zoom (23.4 m wide at the focus, 10.2 m ahead / 7.1 m behind)
    cam_at = {'map_rift': (85.0, 55.0), 'map_bridge': (W / 2, H / 2), 'map_fray': (W / 2, H / 2 + 8)}.get(m['id'], (W / 2, H / 2))
    x0, y0 = X((cam_at[0] - 11.7, cam_at[1] - 10.2))
    x1, y1 = X((cam_at[0] + 11.7, cam_at[1] + 7.1))
    for k in range(int(x0), int(x1), 10):
        d.line([k, y0, min(k + 5, x1), y0], fill=CHALK, width=2); d.line([k, y1, min(k + 5, x1), y1], fill=CHALK, width=2)
    for k in range(int(y0), int(y1), 10):
        d.line([x0, k, x0, min(k + 5, y1)], fill=CHALK, width=2); d.line([x1, k, x1, min(k + 5, y1)], fill=CHALK, width=2)
    d.text((x1 - 4, y0 + 4), 'camera', font=f_s, fill=CHALK, anchor='ra', stroke_width=2, stroke_fill=INK)
    # clip everything to the map frame
    d.rectangle([0, 0, img.width, oy - 1], fill=INK)
    d.rectangle([0, oy + H * ppm + 1, img.width, img.height], fill=INK)
    d.rectangle([0, 0, ox - 1, img.height], fill=INK)
    d.rectangle([ox + W * ppm + 1, 0, img.width, img.height], fill=INK)
    # frame + scale bar + title
    d.rectangle([ox, oy, ox + W * ppm, oy + H * ppm], outline=(61, 70, 86), width=1)
    title = f"{m['name']}  ·  {m['id']}  ·  {W:g} × {H:g} m"
    d.text((pad_x, 16), title, font=font(20, True), fill=CHALK)
    yb = oy + H * ppm + 22
    d.line([pad_x, yb, pad_x + 10 * ppm, yb], fill=CHALK, width=3)
    for k in range(0, 11, 5):
        d.line([pad_x + k * ppm, yb - 4, pad_x + k * ppm, yb + 4], fill=CHALK, width=2)
    d.text((pad_x + 10 * ppm + 8, yb), '10 m', font=f_m, fill=CHALK, anchor='lm')
    d.text((pad_x + 10 * ppm + 60, yb), 'dashed box = camera view at default zoom (23.4 × 17.3 m)', font=f_s, fill=(171, 165, 151), anchor='lm')
    legend = [('Aubade (team 0)', AZURE), ('Serenade (team 1)', MARIGOLD), ('neutral camp', NEUTRAL), ('Needlegrass', THICKET)]
    lx = pad_x
    ly = yb + 26
    for name, col in legend:
        d.rectangle([lx, ly - 6, lx + 12, ly + 6], fill=col)
        d.text((lx + 18, ly), name, font=f_s, fill=CHALK, anchor='lm')
        lx += 140
    key = ['triangle Needle (ring = 7.5 m reach)', 'dotted triangle Bell Needle', 'square Lantern', 'disc Hourbell',
           'diamonds: green Mending, white Quick, gold Gleam Sunmote', 'thin lines = requires', 'chalk boxes = art landmarks (brief)']
    line, ky = '', ly + 22
    for part in key:
        trial = f'{line} · {part}' if line else part
        if d.textlength(trial, font=f_s) > img.width - 2 * pad_x:
            d.text((pad_x, ky), line, font=f_s, fill=(171, 165, 151), anchor='lm')
            line, ky = part, ky + 16
        else:
            line = trial
    d.text((pad_x, ky), line, font=f_s, fill=(171, 165, 151), anchor='lm')
    out = os.path.join(ROOT, '_design', 'maps', f'{map_id}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    return out


if __name__ == '__main__':
    ids = sys.argv[1:] or ['map_rift', 'map_bridge', 'map_fray']
    for i in ids:
        print(render(i))
