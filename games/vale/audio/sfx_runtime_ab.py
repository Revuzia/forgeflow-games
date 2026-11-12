#!/usr/bin/env python3
"""VALE live mix A/B (max SFX-1): whose sounds a laning player hears, from two probe_audio_runtime match reports
(heardG2: per cue, the summed squared gain of every play as the engine started it). Shares of the sfx-bus energy by
family (f_ the fighters' kits, c_ the shared library, w_ the Wicks, u_ units, m_ match cues), the top cues and the
loudness, before vs after, as a bar sheet and JSON.

    python3 sfx_runtime_ab.py --before <report.json> --after <report.json> --sheet out.png --json out.json
"""
from __future__ import annotations

import argparse
import json
import os

from PIL import Image, ImageDraw

from synth import viz

HERE = os.path.dirname(os.path.abspath(__file__))
FAMILIES = (('f_', 'fighter kits', (96, 170, 120)), ('c_', 'library', (200, 120, 90)), ('w_', 'Wicks', (210, 180, 90)),
            ('u_', 'units', (120, 140, 200)), ('m_', 'match', (150, 150, 150)))


def shares(rep: dict, bus: dict) -> dict:
    h = {k: v for k, v in rep['heardG2'].items() if bus.get(k) == 'sfx'}
    tot = sum(h.values()) or 1.0
    fam = {p: round(100 * sum(v for k, v in h.items() if k.startswith(p)) / tot, 2) for p, _, _ in FAMILIES}
    top = sorted(h.items(), key=lambda kv: -kv[1])[:10]
    return {'families': fam, 'top': [[k, round(100 * v / tot, 2)] for k, v in top],
            'plays': {k: n for k, n in rep.get('cueTop', [])[:10]}, 'loudness': rep['loudness'], 'gates': rep.get('gates'),
            'seconds': rep.get('seconds'), 'room': rep.get('room')}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--before', required=True)
    ap.add_argument('--after', required=True)
    ap.add_argument('--sheet')
    ap.add_argument('--json')
    a = ap.parse_args()
    bus = {k: c['bus'] for k, c in json.load(open(os.path.join(HERE, '..', 'content', 'audio.json')))['cues'].items()}
    b, f = json.load(open(a.before)), json.load(open(a.after))
    # cues the after build renamed or removed still count by their old prefix (the before catalog's sfx bus)
    for k in b['heardG2']:
        bus.setdefault(k, 'sfx')
    rows = {'before': shares(b, bus), 'after': shares(f, bus)}
    for s, r in rows.items():
        print(s, json.dumps(r['families']), 'top', r['top'][:5])
    if a.sheet:
        W, H = 1000, 520
        im = Image.new('RGB', (W, H), viz.PLATE)
        d = ImageDraw.Draw(im)
        d.text((16, 10), "SFX-1 live laning mix: whose sounds the player hears (share of sfx energy), Lisvel seed 15",
               fill=viz.CHALK, font=viz.font(15))
        for i, (s, r) in enumerate(rows.items()):
            y = 60 + i * 120
            d.text((16, y), f"{s}  ({r['seconds']:.0f} s, master {r['loudness']['out']['I']} LUFS)", fill=viz.TEXT2, font=viz.font(13))
            x = 16
            for p, name, col in FAMILIES:
                w = int((W - 32) * r['families'][p] / 100)
                d.rectangle([x, y + 22, x + w, y + 70], fill=col)
                if w > 60:
                    d.text((x + 4, y + 30), f"{name} {r['families'][p]:.1f}%", fill=(20, 20, 24), font=viz.font(12))
                x += w
        d.line([16 + (W - 32) // 2, 70, 16 + (W - 32) // 2, 320], fill=viz.CHALK, width=1)
        d.text((16 + (W - 32) // 2 + 4, 300), '50 %', fill=viz.CHALK, font=viz.font(11))
        for i, (s, r) in enumerate(rows.items()):
            d.text((16 + i * 490, 340), f'{s}: top heard cues', fill=viz.CHALK, font=viz.font(13))
            for j, (k, v) in enumerate(r['top'][:8]):
                d.text((16 + i * 490, 362 + 18 * j), f'{k:28s} {v:5.1f} %', fill=viz.TEXT2, font=viz.font(12))
        im.save(a.sheet)
    if a.json:
        with open(a.json, 'w', encoding='utf8') as fp:
            json.dump(rows, fp, indent=1)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
