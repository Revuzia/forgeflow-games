"""mus_menu — "honed stone in long light". 60 BPM, three stems that loop on their OWN lengths (tokens.audio.beds.menu
stemsS [64, 48, 80]), so the bed only repeats exactly after 960 s (fullRepeatS): a menu you sit in for an hour never
hears the same minute twice (final parity AUD-m2). D Dorian; no drums; no statement of the motif (hookInLoop false).

  main    64 s  the harmony: 8 chords x 8 s (Dm9 G6/9 Fmaj7 Em7 | Dm9 Cmaj7 Am9 G6/9) as a lamp-drone pad over a
                bass, a high open fifth A4/E5 that never stops, low bells on the paragraph turns, breath swells
  stem_b  48 s  the dial harp: 12 bars of slow figures that rest every fourth bar
  stem_c  80 s  the light: long glass notes, an FM glint, a low bell, breath gusts, far apart

The two upper stems meet the main stem at EVERY offset (64, 48 and 80 share no shorter period), so they only use
the pitch classes D, E and A, which sit inside every chord of the main loop (a root, fifth, ninth, sixth, eleventh or
major seventh, never a minor second against it). The engine starts each stem as soon as it decodes and loops it
on its own length (src/audio `music`: 'stem…' layers).
"""
from __future__ import annotations

import numpy as np

from .core import midi, rng
from .music_common import bass_line, ens, mode_report, pad_chords, sat_insert
from .score import Stem
from .theory import voice_lead
from . import fx

BPM = 60
MAIN_S, B_S, C_S = 64.0, 48.0, 80.0
SPAN = 8.0

# (name, bass, rootless pad pitch classes)
CHORDS = [
    ('Dm9',   'D2', ['F', 'A', 'C', 'E']),
    ('G6/9',  'G2', ['B', 'D', 'E', 'A']),
    ('Fmaj7', 'F2', ['A', 'C', 'E', 'G']),
    ('Em7',   'E2', ['G', 'B', 'D', 'A']),
    ('Dm9',   'D2', ['F', 'A', 'C', 'E']),
    ('Cmaj7', 'C2', ['E', 'G', 'B', 'D']),
    ('Am9',   'A1', ['C', 'E', 'G', 'B']),
    ('G6/9',  'G2', ['B', 'D', 'E', 'A']),
]
SAFE = ['D4', 'E4', 'A4', 'D5', 'E5', 'A5', 'D6']        # the upper stems' pitches: D, E, A only

# normalised harp figures (position in SAFE 0..1) over 4 beats
FIGS = [
    ([0, 0.75, 1.5, 2.5],        [0.15, 0.45, 0.70, 0.50]),   # arch
    ([0, 1, 1.5, 3],             [0.30, 0.55, 0.85, 0.60]),   # lilt up
    ([0, 0.5, 1.5, 2, 3],        [0.70, 0.50, 0.35, 0.50, 0.20]),   # fall
    ([0, 1.25, 2.5],             [0.00, 0.35, 0.65]),         # climb
]


def _stem(name: str, length: float, seed: str) -> Stem:
    return Stem(name, length, hall=0.0, seed=seed,
                sends={'drone': (0.32, 0.0), 'bass': (0.10, 0.0), 'harp': (0.30, 0.10), 'glass': (0.55, 0.0),
                       'bell': (0.55, 0.0), 'fm': (0.5, 0.0), 'breath': (0.45, 0.0), 'air': (0.4, 0.0)},
                bus_db={'drone': -1.0, 'bass': 0.0, 'harp': 0.0, 'glass': -1.5, 'bell': -3.0, 'fm': -9.0, 'breath': -4.0, 'air': -2.0},
                bus_fx={'drone': [ens(2.4, 0.19, 0.55, f'{seed}-ens')], 'bass': [sat_insert(1.6, 0.3, 0.1)]})


def _main() -> tuple[np.ndarray, list]:
    st = _stem('menu_main', MAIN_S, 'menu')
    pads, prev = [], None
    for _, _, pcs_ in CHORDS:
        prev = voice_lead(prev, pcs_, 4, centre=62.0, lo=53.0, hi=75.0)
        pads.append(prev)
    pad_chords(st, pads, [SPAN] * len(CHORDS), vel=0.20, cutoff=(420.0, 1300.0), attack=2.2, release=3.0, bus='drone')
    bass_line(st, [(i * SPAN, SPAN, b) for i, (_, b, _) in enumerate(CHORDS)], vel=0.42, cutoff=(160.0, 420.0), attack=2.0,
              release=3.0, sub=0.3)
    # low bells on the paragraph turns (roots), a softer fifth between
    st.add(0.0, 'bell', 'D3', 11.0, 0.40, -0.1, human=False, decay_scale=1.2)
    st.add(32.0, 'bell', 'D3', 10.0, 0.36, 0.1, decay_scale=1.2)
    st.add(16.0, 'bell', 'A3', 8.0, 0.24, 0.2, decay_scale=1.0)
    st.add(48.0, 'bell', 'A3', 8.0, 0.24, -0.2, decay_scale=1.0)
    for t, d, f0, f1 in ((26.0, 6.0, 260, 900), (58.0, 6.0, 360, 1300)):
        st.add(t, 'breath', None, d, 0.18, 0.0, f_start=f0, f_end=f1, q=1.5, shape='breath', peak_at=d * 0.55)
    # a high open fifth that never stops (periodic over the loop)
    st.add(0.0, 'drone', 'A4', MAIN_S, 0.05, -0.2, human=False, bus='air', cutoff=(500, 800), lfo_hz=1 / 32, attack=0, release=0, loop_len=MAIN_S)
    st.add(0.0, 'drone', 'E5', MAIN_S, 0.035, 0.25, human=False, bus='air', cutoff=(600, 900), lfo_hz=1 / 16, lfo_phase=0.5, attack=0, release=0, loop_len=MAIN_S)
    st.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    st.automate([(0.0, -0.8), (24.0, 0.0), (40.0, 0.4), (56.0, -0.2)])
    return st.render(), mode_report(st)


def _harp() -> tuple[np.ndarray, list]:
    st = _stem('menu_harp', B_S, 'menu-harp')
    r = rng('menu-harp-b')
    pool = [midi(p) for p in SAFE]
    for bar in range(int(B_S // 4)):
        if bar % 4 == 3:
            continue                                   # every fourth bar rests: the harp breathes
        beats, pos = FIGS[bar % len(FIGS)]
        for k, (b, p) in enumerate(zip(beats, pos)):
            pitch = pool[int(round(p * (len(pool) - 1)))]
            v = (0.55 if k == 0 else 0.42 + 0.06 * r.random()) * (0.85 if bar < 4 else 0.95)
            pan = float(np.clip(-0.35 + (pitch - 60) / 40 + r.uniform(-.1, .1), -.55, .55))
            st.add(bar * 4.0 + b + 0.012 * k, 'harp', pitch, 4.0, v, pan, rr=(bar + k) % 4, bright=0.3)
    st.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    return st.render(), mode_report(st)


def _light() -> tuple[np.ndarray, list]:
    st = _stem('menu_light', C_S, 'menu-light')
    for t, p, v, pn in ((5.0, 'A5', .26, 0.35), (14.5, 'E5', .24, -0.4), (23.0, 'D6', .20, 0.2), (35.5, 'A4', .26, -0.2),
                        (44.0, 'E6', .16, 0.45), (52.5, 'D5', .24, -0.35), (63.0, 'A5', .22, 0.3), (71.5, 'E5', .22, -0.25)):
        st.add(t, 'glass', p, 6.0, v, pn, decay_scale=1.6, bright=0.9)
    st.add(30.0, 'fm', 'A5', 4.0, 0.08, 0.0, decay_s=3.0, index_from=1.2, ratio=3.5)
    st.add(66.0, 'fm', 'E6', 4.0, 0.07, 0.0, decay_s=3.0, index_from=1.2, ratio=3.5)
    st.add(40.0, 'bell', 'D3', 10.0, 0.28, 0.15, decay_scale=1.2)
    for t, d, f0, f1 in ((10.0, 7.0, 300, 1100), (48.0, 8.0, 280, 1500)):
        st.add(t, 'breath', None, d, 0.16, 0.0, f_start=f0, f_end=f1, q=1.5, shape='breath', peak_at=d * 0.55)
    st.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    return st.render(), mode_report(st)


def build() -> tuple[dict, dict]:
    main, bad_m = _main()
    harp, bad_b = _harp()
    light, bad_c = _light()
    return ({'main': main, 'stem_b': harp, 'stem_c': light},
            {'bpm': BPM, 'loop': MAIN_S, 'layers': ['stem_b', 'stem_c'], 'mode_violations': bad_m + bad_b + bad_c,
             'form': f'main {MAIN_S:g} s (8 chords x 8 s) · harp {B_S:g} s · light {C_S:g} s; full repeat 960 s'})
