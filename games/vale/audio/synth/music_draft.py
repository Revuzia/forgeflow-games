"""mus_draft — "the lots are drawn". 90 BPM, 4/4, 136 s = 51 bars = 17 phrases of 8 s (at 90 BPM a phrase is
exactly three bars). One file, no layers, so the bed cannot follow the real draft clock; instead its own arc
walks the three phases of tokens.audio.beds.draft and breathes back to the start:

  A  bans      bars  0-5   (16 s)  drone: pad, D pedal, tolling low bells, breath, far glass harmonics
  B  picks     bars  6-29  (64 s)  the dial-harp pulse enters (8ths), one chord a bar; the escapement
                                   "pick clock" ticks from bar 12; glass fragments of the motif's head
  C  finalise  bars 30-47  (48 s)  frame drums + stone kick, the lamp-drone pluck bass, the motif's core
                                   (A4 E5 D5 B4) stated WITHOUT an ending: the map will finish it
  D  release   bars 48-50  ( 8 s)  a last doum and bell on bar 48, the drums stop, Dm9 is held and
                                   breathes out into A (the loop seam sits inside one held Dm9)

D Dorian; the Lydian glow (E/D, G#) lights the bar before the drums. −3 dB dip at 1–4 kHz for the UI.
"""
from __future__ import annotations

import numpy as np

from . import fx
from .core import midi, rng
from .music_common import (VOC, bars_of, bass_line, blocks, drum_grid, duck_insert, ens, eq_insert, esc_grid, gust,
                           line, clash_report, mode_report, motif, ostinato, pad_chords, pluck, riser, sat_insert, voicings)
from .score import Clock, Stem

BPM = 90
CLK = Clock(BPM)
BEAT = CLK.beat            # 0.667 s
BAR = CLK.bar              # 2.667 s
BARS = 51
LOOP = 136.0
assert abs(BARS * BAR - LOOP) < 1e-9

CHORDS = bars_of([
    ('Dm9', 3), ('Dm6', 3),                                                              # A  bans
    ('Dm9', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dm9', 1), ('Cmaj9', 1), ('Asus4', 1),          # B  picks
    ('Fmaj9', 1), ('G6/9', 1), ('Am7', 1), ('Fmaj9', 1), ('Em7', 1), ('Asus4', 1),
    ('Dm9', 1), ('Fmaj9', 1), ('G6/9', 1), ('Dm9', 1), ('Cmaj9', 1), ('Am7', 1),
    ('Bm7b5', 1), ('Cmaj9', 1), ('Dm9', 1), ('Fmaj9', 1), ('G6/9', 1), ('E/D', 1),
    ('Dm9', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dm9', 1), ('Fmaj9', 1), ('Asus4', 1),          # C  finalise
    ('Fmaj9', 1), ('G6/9', 1), ('Am7', 1), ('Fmaj9', 1), ('G6/9', 1), ('E/D', 1),
    ('Dm9', 1), ('Cmaj9', 1), ('G6/9', 1), ('Fmaj9', 1), ('Em7', 1), ('Asus4', 1),
    ('Dm9', 3),                                                                          # D  release
])
assert len(CHORDS) == BARS

KIT = {
    'K': dict(stroke='doum', pitch='G2', kick=0.9, vel=0.85),
    'L': dict(stroke='doum', pitch='D2', kick=0.35, vel=0.7, pan=-0.2, tone_t60=0.7),
    'T': dict(stroke='tek', pitch='D3', vel=0.6, pan=0.15),
    'G': dict(stroke='ghost', pitch='A2', vel=0.4, pan=-0.1),
    'R': dict(stroke='roll', pitch='E3', vel=0.4),
}
PULSE8 = [(0, 0, 1.0), (2, 2, 0.6), (4, 3, 0.72), (6, 2, 0.6), (8, 4, 0.8), (10, 3, 0.6), (12, 2, 0.72), (14, 1, 0.58)]
PULSE16 = PULSE8 + [(3, 3, 0.4), (7, 3, 0.4), (11, 4, 0.4), (15, 2, 0.45)]
SPARSE = [(0, 0, 1.0), (8, 3, 0.6)]


def T(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def build() -> tuple[dict, dict]:
    ch = CHORDS
    st = Stem('draft_main', LOOP, seed='draft',
              sends={'drone': (0.32, 0.0), 'bass': (0.06, 0.0), 'harp': (0.24, 0.08), 'glass': (0.55, 0.0), 'bell': (0.5, 0.0),
                     'breath': (0.45, 0.0), 'esc': (0.12, 0.1), 'drums': (0.12, 0.14), 'pulse': (0.0, 0.0), 'fm': (0.5, 0.0)},
              bus_db={'drone': -3.0, 'bass': -3.0, 'harp': 1.0, 'glass': 0.0, 'bell': -3.0, 'breath': -1.0, 'esc': -4.0,
                      'drums': 3.0, 'pulse': -7.0, 'fm': -8.0},
              bus_fx={'drone': [ens(2.4, 0.15, 0.55, 'draft-ens')], 'bass': [sat_insert(1.6, 0.3, 0.1)],
                      'harp': [eq_insert(('low', 180.0, -2.0))], 'glass': [eq_insert(('high', 3500.0, 4.0))],
                      'drums': [sat_insert(1.8, 0.25, 0.05), lambda x, loop: fx.compress(x, -20.0, 2.2, 0.006, 0.12, circular=loop)],
                      'pulse': [sat_insert(2.0, 0.35, 0.1), eq_insert(('hp', 38.0, 0.7))]})
    V = voicings(ch, centre=61.0)
    pad_chords(st, V, [BAR] * BARS, vel=0.18, cutoff=(340.0, 1000.0), attack=1.8, release=2.6, bus='drone', lfo_hz=1 / 34)
    bass_line(st, [(s, d, VOC[c][0]) for s, d, c in blocks(ch, BAR, key=lambda c: VOC[c][0])], vel=0.36,
              cutoff=(150.0, 380.0), attack=0.9, release=1.8, sub=0.35)

    # A + D: the drone world — tolling bells, breath, far glass
    for b, p, v in ((0, 'D3', .36), (3, 'A2', .30), (6, 'D3', .26), (18, 'A3', .22), (30, 'D3', .36), (39, 'A3', .26),
                    (41, 'E4', .22), (48, 'D3', .38), (48, 'A2', .22)):
        st.add(T(b), 'bell', p, 16.0, v, -0.15 if p[0] == 'D' else 0.2, bus='bell', decay_scale=1.15)
    for t, d, f0, f1 in ((T(0, 1), 9.0, 220, 900), (T(3, 2), 8.0, 300, 1200), (T(48, 1), 7.0, 1400, 300), (T(50), 6.0, 250, 800)):
        gust(st, t, d, 0.17, f0, f1)
    for b, beat, p, v in ((1, 2, 'A5', .14), (2, 3, 'E6', .11), (4, 1, 'D6', .12), (5, 2, 'B5', .11), (49, 2, 'A5', .12),
                          (50, 1, 'E6', .10)):
        st.add(T(b, beat), 'glass', p, 6.0, v, 0.4 if b % 2 else -0.4, bus='glass', decay_scale=1.2, bright=0.8)

    # B + C: the harp pulse, the pick clock
    for b in range(6, 48):
        bass = midi(VOC[ch[b]][0])
        pat = PULSE16 if b >= 42 else PULSE8
        vel = 0.26 if b < 9 else 0.30 if b < 30 else 0.33
        if b < 9:
            pat = [x for x in PULSE8 if x[0] % 4 == 0]      # the pulse fades in as quarters
        ostinato(st, T(b), BEAT, V[b], bass, pat, vel, 0.5, rr0=b, bus='harp', bright=0.32)
        if b >= 12:
            esc_grid(st, T(b), BEAT, 'k---k---k---k---' if b < 30 else 'k-K-k-K-k-K-k-K-', 0.15 if b < 30 else 0.18, pan=0.3)
    for b in range(48, BARS):
        ostinato(st, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), SPARSE, 0.24, 1.6, rr0=b, bus='harp', bright=0.3)

    # glass: the motif's head as a question through the picks, then its core (unanswered) in the finalise
    g = [
        (12, 0, 'A4', .30, 5), (12, 1, 'E5', .34, 6), (13, 2, 'D5', .26, 5), (14, 0, 'C5', .28, 6),
        (15, 0, 'A4', .30, 5), (15, 1, 'E5', .34, 6), (16, 2, 'D5', .26, 5), (17, 0, 'E5', .30, 7),
        (18, 0, 'A4', .28, 5), (18, 1, 'E5', .30, 5), (18, 2, 'G5', .32, 6), (19, 0, 'F5', .26, 5), (20, 0, 'E5', .28, 6),
        (21, 0, 'D5', .28, 5), (21, 2, 'C5', .26, 5), (22, 0, 'B4', .28, 5), (23, 0, 'A4', .26, 7),
        (24, 0, 'D5', .24, 6), (25, 0, 'E5', .26, 6), (26, 0, 'F5', .26, 6), (27, 0, 'A5', .26, 6), (28, 0, 'B5', .22, 6),
        (29, 0, 'G#5', .24, 7, 0.3), (29, 2, 'E5', .20, 6, -0.3),
        (30, 0, 'A4', .26, 5), (30, 1, 'C5', .26, 5), (30, 2, 'E5', .28, 6),
        (35, 0, 'E5', .26, 5), (35, 1, 'D5', .26, 5), (35, 2, 'A4', .26, 6),
        (38, 0, 'E5', .26, 5), (38, 1, 'G5', .28, 5), (38, 2, 'E5', .26, 6),
        (41, 0, 'E5', .26, 6), (41, 2, 'D5', .24, 6),
        (42, 0, 'A4', .26, 5), (42, 1, 'C5', .28, 5), (43, 0, 'B4', .28, 5), (43, 1, 'D5', .28, 6),
        (45, 0, 'E5', .28, 6), (46, 0, 'E5', .30, 6), (47, 0, 'D5', .30, 7),
    ]
    line(st, T, g, 'glass', bus='glass', bright=0.85)
    for k, b in enumerate((32, 37, 44)):          # the G6/9 bars: every motif note is a chord tone
        # the core only: A4 E5 D5 B4, the B4 left hanging (no ending: the map completes it)
        motif(st, T(b), BEAT, None, 'glass', (.44, .46, .52)[k], ring=6.0, bus='glass', bright=0.9)
        if k == 2:
            motif(st, T(b), BEAT, None, 'harp', 0.3, transpose=-12, ring=1.6, bus='harp', bright=0.35, damp_at=1.35)

    # C: drums and pluck bass
    hits = []
    A = {'K': 'X-----x---X-----', 'T': '----X-------X---', 'G': '-.-.--.-.-.--.-.'}
    B = {'K': 'X-----x---X---x-', 'T': '----X-------X--o', 'G': '-..--.-.-..--..-', 'L': '---x--x---------'}
    for b in range(30, 48):
        lanes = B if b >= 39 else A
        if b % 3 == 2:                     # phrase-end fills (a phrase is three bars)
            lanes = dict(lanes, R='------------.oxX', G='')
        if b == 47:
            lanes = {'K': 'X-------X-------', 'L': '--------x-x-x-xX', 'R': '--------..oooxxX'}
        hits += drum_grid(st, T(b), BEAT, lanes, KIT, rr0=b)
        root = midi(VOC[ch[b]][0])
        for i, c in enumerate('R-r-r-o-R-r-r-o-' if b < 39 else 'R-rrr-o-R-rrr-o-'):
            if c != '-':
                pluck(st, T(b, i / 4), root + (12 if c == 'o' else 0), 0.2 if b < 39 else 0.13, 0.42 * (1.0 if c.isupper() else 0.7),
                      lo=110.0, hi=900.0)
    hits += drum_grid(st, T(48), BEAT, {'K': 'X---------------', 'L': 'X---------------'}, KIT, rr0=48)
    st.bus_fx['pulse'].append(duck_insert([(t, v) for t, lane, v in hits if lane in ('K', 'L')], LOOP, -7.0, 0.004, 0.16))
    for b, d, v in ((6, 4.0, 0.12), (30, 5.0, 0.18), (48, 4.0, 0.14)):
        riser(st, T(b), d, v, 300.0, 2200.0)
    st.add(T(29, 2), 'fm', 'B6', 3.0, 0.07, 0.3, decay_s=2.0, index_from=1.4, ratio=3.5, bus='fm')
    st.add(T(48), 'fm', 'A6', 3.0, 0.06, -0.3, decay_s=2.0, index_from=1.4, ratio=3.5, bus='fm')

    st.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    st.automate([(T(0), -2.0), (T(5), -1.5), (T(8), -0.6), (T(28), 0.0), (T(31), 0.6), (T(46), 1.0), (T(48), 0.6), (T(50), -1.6)])
    bad = mode_report(st)
    clashes = clash_report(st, ch, V, BAR)
    return {'main': st.render()}, {'bpm': BPM, 'loop': LOOP, 'layers': [], 'mode_violations': bad, 'clashes': clashes,
                                   'form': 'A bans 0-16 s, B picks 16-80 s, C finalise 80-128 s, D release 128-136 s'}
