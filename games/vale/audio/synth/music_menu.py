"""mus_menu — "honed stone in long light". 60 BPM, 96 s = 12 chords x 8 s (two bars each) = 12 phrases
on the 8-second grid. D Dorian with the Lydian glow (E7/D, G#) at the turn of the loop; no drums; no
statement of the motif (tokens: hookInLoop false) — only its intervals scatter through the glass.

Arc: three four-chord paragraphs. I (bars 1-8) bare: drone, bass, a slow harp. II (9-16) the harp
fills and a low bell speaks. III (17-24) the glass opens upward, breath swells carry the turns, and the
last chord (E7/D, G# on top) glows and falls back into the first Dm9 — the loop seam is a held breath.
"""
from __future__ import annotations

import numpy as np

from .core import hz, midi, rng
from .music_common import bass_line, eq_insert, ens, harp_figure, mode_report, pad_chords, pitch_pool, sat_insert
from .score import Clock, Stem
from .theory import voice_lead
from . import fx

BPM = 60
LOOP = 96.0
SPAN = 8.0

# (name, bass, rootless pad pitch classes)
CHORDS = [
    ('Dm9',    'D2', ['F', 'A', 'C', 'E']),
    ('G6/9',   'G2', ['B', 'D', 'E', 'A']),
    ('Fmaj7',  'F2', ['A', 'C', 'E', 'G']),
    ('Em7',    'E2', ['G', 'B', 'D', 'A']),
    ('Dm9',    'D2', ['F', 'A', 'C', 'E']),
    ('Cmaj7',  'C2', ['E', 'G', 'B', 'D']),
    ('Am9',    'A1', ['C', 'E', 'G', 'B']),
    ('G6/9',   'G2', ['B', 'D', 'E', 'A']),
    ('Fmaj9',  'F2', ['A', 'C', 'E', 'G']),
    ('Em7',    'E2', ['G', 'B', 'D', 'E']),
    ('Dm11',   'D2', ['F', 'A', 'C', 'G']),
    ('E7/D',   'D2', ['G#', 'B', 'D', 'E']),
]

# normalised harp figures (position in the pool 0..1) over 8 beats
FIGS = [
    ([0, 1, 2, 3, 4, 5, 6, 7],      [0.00, 0.30, 0.50, 0.75, 1.00, 0.72, 0.48, 0.25]),   # arch
    ([0, 1.5, 3, 4, 5.5, 6, 7],     [0.00, 0.42, 0.68, 0.30, 0.55, 0.85, 0.60]),         # off-beat lilt
    ([0, 1, 2, 3, 4, 5, 6, 7],      [0.00, 0.22, 0.40, 0.58, 0.76, 0.92, 0.66, 0.38]),   # climb
    ([0, 1, 2.5, 4, 5, 6, 7],       [0.00, 0.50, 0.28, 0.80, 0.62, 0.40, 0.20]),         # wave
]


def build() -> tuple[dict, dict]:
    clk = Clock(BPM)
    stem = Stem('menu_main', LOOP, hall=0.0, seed='menu',
                sends={'drone': (0.32, 0.0), 'bass': (0.10, 0.0), 'harp': (0.30, 0.10), 'glass': (0.55, 0.0),
                       'bell': (0.55, 0.0), 'fm': (0.5, 0.0), 'breath': (0.45, 0.0), 'air': (0.4, 0.0)},
                bus_db={'drone': -1.0, 'bass': 0.0, 'harp': 0.0, 'glass': -1.5, 'bell': -3.0, 'fm': -9.0, 'breath': -4.0, 'air': -2.0},
                bus_fx={'drone': [ens(2.4, 0.19, 0.55, 'menu-ens')], 'bass': [sat_insert(1.6, 0.3, 0.1)]})
    # voicings (rootless pad, 4 voices around the E3..E5 pocket)
    pads, prev = [], None
    for _, _, pcs_ in CHORDS:
        prev = voice_lead(prev, pcs_, 4, centre=62.0, lo=53.0, hi=75.0)
        pads.append(prev)
    spans = [SPAN] * len(CHORDS)
    pad_chords(stem, pads, spans, vel=0.20, cutoff=(420.0, 1300.0), attack=2.2, release=3.0, bus='drone')
    bass_line(stem, [(i * SPAN, SPAN, b) for i, (_, b, _) in enumerate(CHORDS)], vel=0.42, cutoff=(160.0, 420.0), attack=2.0,
              release=3.0, sub=0.3)

    # the harp, thickening by paragraph
    r = rng('menu-harp')
    for ci, (name, bass, _) in enumerate(CHORDS):
        pool = pitch_pool(pads[ci], midi(bass), 50, 79)
        beats, pos = FIGS[ci % len(FIGS)]
        para = ci // 4                       # 0 bare, 1 fuller, 2 open
        keep = [True] * len(beats) if para else [k % 2 == 0 or k == len(beats) - 1 for k in range(len(beats))]
        idxs = [int(round(p * (len(pool) - 1))) for p in pos]
        vel0 = [0.60 if b == 0 else 0.44 + 0.06 * r.random() for b in beats]
        for k, (b, ix, v) in enumerate(zip(beats, idxs, vel0)):
            if not keep[k]:
                continue
            drift = 0.010 * k * (1 if ci % 2 == 0 else -0.5)
            p = pool[ix]
            stem.add(ci * SPAN + b * clk.beat + drift, 'harp', p, 4.5, v * (0.8 if para == 0 else 0.95),
                     float(np.clip(-0.35 + (p - 48) / 70 + r.uniform(-.12, .12), -.6, .6)), rr=(ci + k) % 4, bright=0.3)

    # low bell: the root an octave and a bit up, at the top of each paragraph; softer fifth between
    stem.add(0.0, 'bell', 'D3', 11.0, 0.40, -0.1, human=False, decay_scale=1.2)
    stem.add(32.0, 'bell', 'D3', 10.0, 0.36, 0.1, decay_scale=1.2)
    stem.add(64.0, 'bell', 'D3', 11.0, 0.38, -0.1, decay_scale=1.25)
    stem.add(16.0, 'bell', 'A3', 8.0, 0.26, 0.2, decay_scale=1.0)
    stem.add(48.0, 'bell', 'A3', 8.0, 0.26, -0.2, decay_scale=1.0)
    stem.add(80.0, 'bell', 'E4', 8.0, 0.22, 0.2, decay_scale=1.0)

    # glass: one long note per chord from paragraph II, and the Lydian glow over E7/D
    glass_pick = {5: 'C5', 6: 'B4', 7: 'D5', 8: 'E5', 9: 'D5', 10: 'C5'}
    for ci, p in glass_pick.items():
        stem.add(ci * SPAN + 3.0, 'glass', p, 6.0, 0.30, -0.4 + 0.15 * ci % 0.8, decay_scale=1.6, bright=0.9)
    for t, p, v, pn in ((88.0 + 0.0, 'B5', .26, 0.35), (89.5, 'G#5', .24, -0.30), (91.0, 'E6', .20, 0.10), (92.5, 'D6', .16, -0.15)):
        stem.add(t, 'glass', p, 6.0, v, pn, decay_scale=1.5, bright=1.0)
    for t, p, v, pn in ((13.0, 'A5', .20, 0.5), (27.5, 'E5', .22, -0.5), (45.0, 'B5', .18, 0.4), (58.5, 'D6', .16, -0.3), (73.0, 'A5', .2, 0.3)):
        stem.add(t, 'glass', p, 6.0, v, pn, decay_scale=1.5, bright=0.9)

    # breath swells on the paragraph turns and over the closing glow
    for t, d, f0, f1 in ((28.0, 6.0, 260, 900), (60.0, 6.0, 360, 1300), (85.0, 9.0, 300, 1700)):
        stem.add(t, 'breath', None, d, 0.20, 0.0, f_start=f0, f_end=f1, q=1.5, shape='breath', peak_at=d * 0.55)
    for t, p in ((21.0, 'A5'), (53.5, 'E6'), (77.0, 'D6'), (90.0, 'B5')):
        stem.add(t, 'fm', p, 4.0, 0.08, 0.0, decay_s=3.0, index_from=1.2, ratio=3.5)
    # a high open fifth that never stops (periodic over the loop)
    stem.add(0.0, 'drone', 'A4', LOOP, 0.05, -0.2, human=False, bus='air', cutoff=(500, 800), lfo_hz=1 / 48, attack=0, release=0, loop_len=LOOP)
    stem.add(0.0, 'drone', 'E5', LOOP, 0.035, 0.25, human=False, bus='air', cutoff=(600, 900), lfo_hz=1 / 32, lfo_phase=0.5, attack=0, release=0, loop_len=LOOP)

    # tokens.audio.beds.menu.dip: -3 dB bell at 1-4 kHz so UI glass and announcer stingers sit above
    stem.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    # a slow breathing of level: bare → full → glow
    stem.automate([(0.0, -1.5), (30.0, -0.5), (48.0, 0.0), (72.0, 0.8), (90.0, 0.2)])
    # score-level mode audit (every pitched note must be D Dorian or the Lydian G#)
    bad = mode_report(stem)
    out = stem.render()
    return {'main': out}, {'bpm': BPM, 'loop': LOOP, 'layers': [], 'mode_violations': bad,
                           'form': '12 chords x 8 s; paragraphs at 0/32/64 s'}
