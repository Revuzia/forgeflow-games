"""mus_postgame — "the long evening". 60 BPM, 80 s = 20 bars = 10 phrases of 8 s. Plays under the results
after the victory or defeat sting, so it must honour both: no drums, no triumph, no grief; a slow bell
chorale over warm lamp-drone harmony, the dial harp rolling each chord, and the motif sung ONCE by the glass,
closed not by a map's ending but by D5, home.

  phrases 1-2   Dm9 · Cmaj9          bells and rolled harp only (the loop's quiet door)
  phrases 3-8   G6/9/B · Am7 · Fmaj9 · Dm11 · Em7 · Asus4    a slow glass song over a falling bass
  phrase  9     G6/9                 the motif A4 E5 D5 B4 …
  phrase 10     Dsus2                … resolved to D5; the D held open (no third) falls back into Dm9

Bells only on D / A / E (their tierce and quint stay in the mode). −2 dB at 1–4 kHz for the results UI.
"""
from __future__ import annotations

from . import fx
from .core import midi
from .music_common import (VOC, bars_of, bass_line, blocks, clash_report, ens, eq_insert, gust, harp_pool, line,
                           mode_report, motif, ostinato, pad_chords, voicings)
from .score import Clock, Stem

BPM = 60
CLK = Clock(BPM)
BEAT = CLK.beat            # 1 s
BAR = CLK.bar              # 4 s
BARS = 20
LOOP = BARS * BAR          # 80 s

CHORDS = bars_of([('Dm9', 2), ('Cmaj9', 2), ('G6/9/B', 2), ('Am7', 2), ('Fmaj9', 2), ('Dm11', 2), ('Em7', 2),
                  ('Asus4', 2), ('G6/9', 2), ('Dsus2', 2)])
assert len(CHORDS) == BARS
# the chorale: mode-safe bells (D / A / E) for each chord, (low, high)
BELLS = {'Dm9': ('D3', 'A3'), 'Cmaj9': ('E3', None), 'G6/9/B': ('A3', 'D4'), 'Am7': ('A2', 'E4'), 'Fmaj9': ('A3', 'E4'),
         'Dm11': ('D3', 'A3'), 'Em7': ('E3', 'D4'), 'Asus4': ('A3', 'E4'), 'G6/9': ('D4', None), 'Dsus2': ('D3', 'A3')}
FIG = [(0, 4, 0.8), (4, 2, 0.6), (6, 3, 0.55), (8, 1, 0.6), (12, 2, 0.5)]       # second bar of each chord


def T(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def build() -> tuple[dict, dict]:
    ch = CHORDS
    st = Stem('postgame_main', LOOP, seed='postgame',
              sends={'drone': (0.34, 0.0), 'bass': (0.08, 0.0), 'harp': (0.32, 0.1), 'glass': (0.55, 0.0), 'bell': (0.5, 0.0),
                     'breath': (0.45, 0.0), 'fm': (0.5, 0.0)},
              bus_db={'drone': -2.5, 'bass': -3.0, 'harp': 0.5, 'glass': 0.0, 'bell': -2.0, 'breath': -2.0, 'fm': -9.0},
              bus_fx={'drone': [ens(2.6, 0.13, 0.55, 'post-ens')], 'harp': [eq_insert(('low', 180.0, -2.0))],
                      'glass': [eq_insert(('high', 3500.0, 3.0))]})
    V = voicings(ch, centre=60.0)
    pad_chords(st, V, [BAR] * BARS, vel=0.19, cutoff=(300.0, 950.0), attack=2.6, release=3.6, bus='drone', lfo_hz=1 / 40)
    bass_line(st, [(s, d, VOC[c][0]) for s, d, c in blocks(ch, BAR, key=lambda c: VOC[c][0])], vel=0.34,
              cutoff=(140.0, 340.0), attack=1.6, release=2.6, sub=0.3)

    for b in range(0, BARS, 2):
        c = ch[b]
        bass = midi(VOC[c][0])
        # a rolled chord on the change: five strings, low to high, 70 ms apart
        pool, ri = harp_pool(V[b], bass, 48, 79)
        for k in range(5):
            p = pool[min(ri + k, len(pool) - 1)]
            st.add(T(b) + 0.07 * k, 'harp', p, 4.2, 0.34 - 0.03 * k, -0.35 + 0.17 * k, bus='harp', rr=k % 4, bright=0.3,
                   damp_at=3.9 - 0.07 * k)
        ostinato(st, T(b + 1), BEAT, V[b + 1], bass, FIG, 0.27, 1.5, rr0=b, bus='harp', bright=0.3)
        lo, hi = BELLS[c]
        st.add(T(b), 'bell', lo, 16.0, 0.26, -0.2, bus='bell', decay_scale=1.2)
        if hi:
            st.add(T(b, 2), 'bell', hi, 12.0, 0.16, 0.25, bus='bell', decay_scale=1.0)

    g = [
        (1, 2, 'A5', .14, 6, .4), (3, 1, 'E5', .16, 6, -.3),
        (4, 0, 'B4', .30, 6), (4, 2, 'A4', .26, 6), (5, 0, 'D5', .30, 6), (5, 3, 'B4', .24, 5),
        (6, 0, 'C5', .30, 6), (6, 2, 'B4', .26, 5), (6, 3, 'A4', .26, 6), (7, 0, 'E5', .30, 7),
        (8, 0, 'A4', .28, 6), (8, 1, 'C5', .28, 6), (8, 2, 'E5', .32, 7), (9, 2, 'G5', .28, 7),
        (10, 0, 'D5', .30, 6), (10, 2, 'C5', .28, 6), (11, 0, 'A4', .28, 7), (11, 2, 'G4', .24, 6),
        (12, 0, 'G4', .26, 6), (12, 1, 'B4', .28, 6), (12, 2, 'D5', .30, 6), (13, 0, 'E5', .32, 7),
        (14, 0, 'D5', .28, 7), (14, 2, 'E5', .26, 6), (15, 0, 'A4', .26, 8),
        (19, 2, 'A4', .16, 8, -.3),
    ]
    line(st, T, g, 'glass', bus='glass', bright=0.85, decay_scale=1.3)
    motif(st, T(17), BEAT, 'D5', 'glass', 0.44, ring=7.0, end_ring=10.0, bus='glass', bright=0.85, decay_scale=1.4)
    motif(st, T(17), BEAT, 'D5', 'harp', 0.22, transpose=-12, ring=2.0, end_ring=3.6, bus='harp', bright=0.3, damp_at=1.8)
    for t, d, f0, f1 in ((T(7, 2), 6.0, 300, 1100), (T(16, 1), 7.0, 260, 900), (T(18, 2), 7.0, 1200, 300)):
        gust(st, t, d, 0.15, f0, f1)
    st.add(T(18), 'fm', 'A6', 3.0, 0.05, 0.3, decay_s=2.2, index_from=1.2, ratio=3.5, bus='fm')
    st.post.append(lambda x, loop: fx.speech_dip(x, -2.0, circular=loop))
    st.automate([(T(0), -1.5), (T(4), -0.6), (T(12), 0.0), (T(17), 0.6), (T(19), 0.0)])
    bad = mode_report(st)
    clashes = clash_report(st, ch, V, BAR)
    return {'main': st.render()}, {'bpm': BPM, 'loop': LOOP, 'layers': [], 'mode_violations': bad, 'clashes': clashes,
                                   'form': '10 chords x 8 s; motif at 68 s, home on D5 at 72 s'}
