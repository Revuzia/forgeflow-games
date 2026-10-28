"""mus_draft — "the lots are drawn". 90 BPM, 4/4, a 32 s loop (12 bars = 4 phrases of 8 s) in four stems that start
together and follow the DRAFT (final parity AUD-m2; tokens.audio.beds.draft phases 'bans: drone', 'picks: harp pulse',
'finalise: drums', localUrgencyLastS 8). The engine plays the main stem and fades the others in on the next bar:

  main         bans      pad, D pedal bass, tolling low bells, breath, far glass harmonics (always on)
  phase_picks  picks     the dial-harp pulse (8ths, one chord a bar), the escapement "pick clock", the motif's head as a
                         question in glass
  phase_final  finalise  frame drums + stone kick, the lamp-drone pluck bass, the motif's core (A4 E5 D5 B4) left
                         WITHOUT an ending: the map will finish it (on top of picks)
  urgency      your own last seconds to pick: the escapement in 16ths with accents and a breath rising into every
                         other bar; unpitched, so it sits on any chord

D Dorian; the Lydian glow (E/D, G#) lights the last bar before the loop. −3 dB dip at 1–4 kHz for the UI. Until the
client drives the phases the engine walks them itself on the old arc (picks at 16 s, finalise at 80 s).
"""
from __future__ import annotations

from . import fx
from .core import midi
from .music_common import (VOC, bars_of, bass_line, blocks, clash_report, drum_grid, duck_insert, ens, eq_insert, esc_grid,
                           gust, line, mode_report, motif, ostinato, pad_chords, pluck, riser, sat_insert, voicings)
from .score import Clock, Stem

BPM = 90
CLK = Clock(BPM)
BEAT = CLK.beat            # 0.667 s
BAR = CLK.bar              # 2.667 s
BARS = 12
LOOP = 32.0
assert abs(BARS * BAR - LOOP) < 1e-9

CHORDS = bars_of([('Dm9', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dm9', 1), ('Fmaj9', 1), ('G6/9', 1),
                  ('Am7', 1), ('Asus4', 1), ('Dm9', 1), ('Fmaj9', 1), ('G6/9', 1), ('E/D', 1)])
assert len(CHORDS) == BARS

KIT = {
    'K': dict(stroke='doum', pitch='G2', kick=0.9, vel=0.85),
    'L': dict(stroke='doum', pitch='D2', kick=0.35, vel=0.7, pan=-0.2, tone_t60=0.7),
    'T': dict(stroke='tek', pitch='D3', vel=0.6, pan=0.15),
    'G': dict(stroke='ghost', pitch='A2', vel=0.4, pan=-0.1),
    'R': dict(stroke='roll', pitch='E3', vel=0.4),
}
PULSE8 = [(0, 0, 1.0), (2, 2, 0.6), (4, 3, 0.72), (6, 2, 0.6), (8, 4, 0.8), (10, 3, 0.6), (12, 2, 0.72), (14, 1, 0.58)]


def T(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def _stem(name: str) -> Stem:
    return Stem(name, LOOP, seed=name,
                sends={'drone': (0.32, 0.0), 'bass': (0.06, 0.0), 'harp': (0.24, 0.08), 'glass': (0.55, 0.0), 'bell': (0.5, 0.0),
                       'breath': (0.45, 0.0), 'esc': (0.12, 0.1), 'drums': (0.12, 0.14), 'pulse': (0.0, 0.0), 'fm': (0.5, 0.0)},
                bus_db={'drone': -3.0, 'bass': -3.0, 'harp': 1.0, 'glass': 0.0, 'bell': -3.0, 'breath': -1.0, 'esc': -4.0,
                        'drums': 3.0, 'pulse': -7.0, 'fm': -8.0},
                bus_fx={'drone': [ens(2.4, 0.15, 0.55, f'{name}-ens')], 'bass': [sat_insert(1.6, 0.3, 0.1)],
                        'harp': [eq_insert(('low', 180.0, -2.0))], 'glass': [eq_insert(('high', 3500.0, 4.0))],
                        'drums': [sat_insert(1.8, 0.25, 0.05), lambda x, loop: fx.compress(x, -20.0, 2.2, 0.006, 0.12, circular=loop)],
                        'pulse': [sat_insert(2.0, 0.35, 0.1), eq_insert(('hp', 38.0, 0.7))]})


def _finish(st: Stem) -> None:
    st.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))


def build() -> tuple[dict, dict]:
    ch = CHORDS
    V = voicings(ch, centre=61.0)
    bad, clashes = [], []

    # main: the bans drone (always on)
    m = _stem('draft_main')
    pad_chords(m, V, [BAR] * BARS, vel=0.18, cutoff=(340.0, 1000.0), attack=1.8, release=2.6, bus='drone', lfo_hz=1 / 32)
    bass_line(m, [(s, d, VOC[c][0]) for s, d, c in blocks(ch, BAR, key=lambda c: VOC[c][0])], vel=0.36,
              cutoff=(150.0, 380.0), attack=0.9, release=1.8, sub=0.35)
    for b, p, v in ((0, 'D3', .34), (3, 'A2', .28), (6, 'A3', .24), (8, 'D3', .30)):
        m.add(T(b), 'bell', p, 14.0, v, -0.15 if p[0] == 'D' else 0.2, bus='bell', decay_scale=1.15)
    for t, d, f0, f1 in ((T(0, 1), 8.0, 220, 900), (T(6, 2), 7.0, 300, 1200)):
        gust(m, t, d, 0.16, f0, f1)
    for b, beat, p, v in ((1, 2, 'A5', .13), (2, 3, 'E6', .10), (4, 1, 'D6', .11), (9, 2, 'A5', .12), (10, 1, 'E6', .10)):
        m.add(T(b, beat), 'glass', p, 6.0, v, 0.4 if b % 2 else -0.4, bus='glass', decay_scale=1.2, bright=0.8)
    _finish(m)
    m.automate([(T(0), -0.6), (T(6), 0.0), (T(11), 0.4)])
    bad += mode_report(m)

    # picks: the harp pulse, the pick clock, the motif's head as a question
    p = _stem('draft_picks')
    for b in range(BARS):
        ostinato(p, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), PULSE8, 0.30, 0.5, rr0=b, bus='harp', bright=0.32)
        esc_grid(p, T(b), BEAT, 'k---k---k---k---', 0.15, pan=0.3)
    line(p, T, [(0, 0, 'A4', .30, 5), (0, 1, 'E5', .34, 6), (1, 2, 'D5', .26, 5), (2, 0, 'B4', .28, 6),
                (4, 0, 'A4', .28, 5), (4, 1, 'E5', .30, 5), (4, 2, 'G5', .30, 6), (5, 0, 'E5', .26, 6),
                (8, 0, 'D5', .26, 6), (9, 0, 'E5', .26, 6), (9, 2, 'F5', .24, 6), (10, 0, 'A5', .26, 6),
                (11, 0, 'G#5', .24, 7, 0.3), (11, 2, 'E5', .20, 6, -0.3)], 'glass', bus='glass', bright=0.85)
    _finish(p)
    bad += mode_report(p)
    clashes += clash_report(p, ch, V, BAR)

    # final: the drums, the pluck bass, the motif's core with no ending
    f = _stem('draft_final')
    hits = []
    A = {'K': 'X-----x---X-----', 'T': '----X-------X---', 'G': '-.-.--.-.-.--.-.'}
    B = {'K': 'X-----x---X---x-', 'T': '----X-------X--o', 'G': '-..--.-.-..--..-', 'L': '---x--x---------'}
    for b in range(BARS):
        lanes = B if b >= 6 else A
        if b % 3 == 2:
            lanes = dict(lanes, R='------------.oxX', G='')
        if b == BARS - 1:
            lanes = {'K': 'X-------X-------', 'L': '--------x-x-x-xX', 'R': '--------..oooxxX'}
        hits += drum_grid(f, T(b), BEAT, lanes, KIT, rr0=b)
        root = midi(VOC[ch[b]][0])
        for i, c in enumerate('R-r-r-o-R-r-r-o-' if b < 6 else 'R-rrr-o-R-rrr-o-'):
            if c != '-':
                pluck(f, T(b, i / 4), root + (12 if c == 'o' else 0), 0.2 if b < 6 else 0.13, 0.42 * (1.0 if c.isupper() else 0.7),
                      lo=110.0, hi=900.0)
    f.bus_fx['pulse'].append(duck_insert([(t, v) for t, lane, v in hits if lane in ('K', 'L')], LOOP, -7.0, 0.004, 0.16))
    for k, b in enumerate((2, 10)):            # the G6/9 bars: every motif note is a chord tone
        motif(f, T(b), BEAT, None, 'glass', (.44, .50)[k], ring=5.0, bus='glass', bright=0.9)
    riser(f, T(0) + LOOP, 3.0, 0.14, 300.0, 2200.0)   # into the loop's downbeat
    _finish(f)
    bad += mode_report(f)

    # urgency: your own last seconds (unpitched, so it sits on any chord)
    u = _stem('draft_urgency')
    for b in range(BARS):
        esc_grid(u, T(b), BEAT, 'KkkkKkkkKkkkKkkK', 0.24, pan=0.25)
        if b % 2 == 1:
            riser(u, T(b + 1), 1.2, 0.12, 600.0, 3200.0)
    u.bus_db['breath'] = 2.0
    _finish(u)

    return ({'main': m.render(), 'phase_picks': p.render(), 'phase_final': f.render(), 'urgency': u.render()},
            {'bpm': BPM, 'loop': LOOP, 'layers': ['phase_picks', 'phase_final', 'urgency'], 'mode_violations': bad,
             'clashes': clashes, 'form': '12 bars (32 s): main = bans drone; layers picks / final / urgency follow the draft'})
