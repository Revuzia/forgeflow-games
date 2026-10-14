"""mus_match_{rift,bridge,fray} — the in-match beds. 120 BPM, 4/4, 160 s loops = 80 bars = 20 phrases
of 8 s (tokens.audio.bpm.match, phraseSeconds). Each bed is two sample-aligned stems of identical length:

  main     the calm stem: pad, bass, a dial-harp pulse, glass melody, bells, breath. No drums. It must
           sit under 25 minutes of ability and UI sound without fatigue, so it stays soft, keeps its
           pulse in the harp, and is dipped −3 dB at 1–4 kHz (the UI / ability band).
  intense  the combat layer (additive, faded in by the engine above intensity 0.6, quantised to the
           bar): frame drums + stone kick, a lamp-drone pluck bass pulse, a harp 16th motor, small
           escapement ticks and risers into each section. Its energy lives below 1 kHz.

Form (16-bar sections, the same skeleton for all three maps, each with its own harmony and groove)

  S1  bars  0-15  lay of the land   the bare pulse; the melody waits
  S2  bars 16-31  motion            call-and-answer fragments of the motif's head (A4–E5)
  S3  bars 32-47  the turn          each map's colour: RIFT's Lydian glow, BRIDGE's Snap, FRAY's dusk
  S4  bars 48-63  the hook          the motif A4 E5 D5 B4 four times, closed by the map's ending
                                    (RIFT F#5, BRIDGE G4, FRAY G#4); one chord per bar
  S5  bars 64-79  breathe           the pulse thins back to S1; the fill at bar 79 lands on bar 0

  RIFT    Hourfall, the dial: bright and driving. Straight 8th harp (3+3+2 accents), a D Dorian i–IV
          drive, a descending bass D–C–B–A, the Lydian E/D glow in the turn and the bright F#5 resolve
          over D6/9 (the noon chord on the last statement).
  BRIDGE  Needlespan over the gorge: tense. A D pedal under shifting upper chords, a 3-3-3-3-2-2 harp,
          gorge-wind breath, glass chimes, half-time drums with a galloping bass; the Snap (S3) is
          Bm7b5 with an escapement clock; the motif falls to G4.
  FRAY    Noonplate at the noon fair: festive. A tresillo dance harp, bell peals, the Lydian D (D E G# A)
          as home, sunmote FM sparkles; the motif lands on G#4 over E/D.
"""
from __future__ import annotations

import numpy as np

from . import fx
from .core import midi, rng
from .music_common import (ENDINGS, VOC, bars_of, bass_line, blocks, drum_grid, duck_insert, ens, eq_insert, esc_grid, gust, line,
                           clash_report, mode_report, motif, ostinato, pad_chords, pluck, riser, sat_insert, voicings)
from .score import Clock, Stem
from .theory import BRIGHT_PCS, COLOUR_PCS

BPM = 120
CLK = Clock(BPM)
BEAT = CLK.beat            # 0.5 s
BAR = CLK.bar              # 2.0 s
BARS = 80
LOOP = BARS * BAR          # 160 s
SECTION = 16


def T(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


# ── harmony (one chord per bar) ──────────────────────────────────────────────────────────────────
RIFT = bars_of([
    ('Dm9', 2), ('G6/9', 2), ('Dm9', 2), ('G6/9', 2), ('Fmaj9', 2), ('Cmaj9', 2), ('G6/9', 2), ('Am7', 1), ('Asus4', 1),
    ('Dm9', 2), ('Cmaj9', 2), ('G6/9/B', 2), ('Am7', 2), ('Fmaj9', 2), ('G6/9', 2), ('Em7', 2), ('Asus4', 2),
    ('Fmaj9', 2), ('G6/9', 2), ('E/D', 4), ('Fmaj9', 2), ('G6/9', 2), ('Am7', 2), ('Asus4', 2),
    ('G6/9', 1), ('D6/9', 1), ('Fmaj9', 1), ('Cmaj9', 1), ('G6/9', 1), ('D6/9', 1), ('Em7', 1), ('Asus4', 1),
    ('G6/9', 1), ('D6/9', 1), ('Fmaj9', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dnoon', 1), ('Asus4', 2),
    ('Dm9', 2), ('G6/9', 2), ('Dm9', 2), ('G6/9', 2), ('Fmaj9', 2), ('Cmaj9', 2), ('G6/9', 2), ('Asus4', 2),
])
BRIDGE = bars_of([
    ('Dmadd9', 2), ('Em7/D', 2), ('Dmadd9', 2), ('C/D', 2), ('Dmadd9', 2), ('Em7/D', 2), ('Dm6', 2), ('Dsus4', 2),
    ('Am7', 2), ('Fmaj9', 2), ('G6/9', 2), ('Am7', 2), ('Fmaj9', 2), ('Em7', 2), ('Dm9', 2), ('Esus4', 2),
    ('Bm7b5', 2), ('Cmaj9', 2), ('Bm7b5', 2), ('Am7', 2), ('Bm7b5', 2), ('Cmaj9', 2), ('Dsus4', 2), ('Esus4', 2),
    ('Em7', 1), ('Cmaj9', 1), ('Am7', 2), ('Em7', 1), ('Cmaj9', 1), ('Fmaj9', 1), ('Esus4', 1),
    ('Em7', 1), ('Cmaj9', 1), ('Dm9', 2), ('Em7', 1), ('G6/9', 1), ('Asus4', 2),
    ('Dmadd9', 2), ('Em7/D', 2), ('C/D', 2), ('Dmadd9', 2), ('Dm6', 2), ('Em7/D', 2), ('Dsus4', 2), ('Dmadd9', 2),
])
FRAY = bars_of([
    ('Dlyd', 2), ('Cmaj9', 2), ('G6/9', 2), ('Dlyd', 2), ('Fmaj9', 2), ('Cmaj9', 2), ('G6/9', 2), ('E/D', 2),
    ('Dlyd', 2), ('Am7', 2), ('G6/9', 2), ('Cmaj9', 2), ('Fmaj9', 2), ('G6/9', 2), ('Em7', 2), ('E/D', 2),
    ('Fmaj9', 2), ('G6/9', 2), ('Am7', 2), ('G6/9/B', 2), ('Cmaj9', 2), ('Dm9', 2), ('Em7', 2), ('E/D', 2),
    ('Dsus2', 1), ('E/D', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dsus2', 1), ('E/D', 1), ('Fmaj9', 1), ('G6/9', 1),
    ('Dsus2', 1), ('E/D', 1), ('Cmaj9', 1), ('G6/9', 1), ('Dsus2', 1), ('E/D', 3),
    ('Dlyd', 2), ('Cmaj9', 2), ('G6/9', 2), ('Dlyd', 2), ('Fmaj9', 2), ('Am7', 2), ('G6/9', 2), ('E/D', 2),
])
for _name, _ch in (('RIFT', RIFT), ('BRIDGE', BRIDGE), ('FRAY', FRAY)):
    assert len(_ch) == BARS, (_name, len(_ch))


# ── shared kit ───────────────────────────────────────────────────────────────────────────────────
KIT = {
    'K': dict(stroke='doum', pitch='A2', kick=0.85, vel=0.85),                       # doum + stone kick
    'L': dict(stroke='doum', pitch='D2', kick=0.3, vel=0.72, pan=-0.18, tone_t60=0.6),  # low frame drum
    'M': dict(stroke='doum', pitch='G2', kick=0.0, vel=0.6, pan=0.22, tone_t60=0.4),   # mid frame drum
    'T': dict(stroke='tek', pitch='D3', vel=0.62, pan=0.12),                          # rim
    'G': dict(stroke='ghost', pitch='A2', vel=0.42, pan=-0.12),                      # finger ghosts
    'R': dict(stroke='roll', pitch='E3', vel=0.4, pan=0.06),                         # roll grains
}
SMALL_ESC = dict(band_hz=5600.0, q=3.0, res=(2300.0, 5200.0))     # a small, high escapement (hat role)

# root-relative harp figures: (step16, chord-tones above the root, velocity)
Q_PULSE = [(0, 0, 1.0), (4, 2, 0.6), (8, 3, 0.72), (12, 2, 0.6)]
E_DRIVE = [(0, 0, 1.0), (2, 2, 0.58), (4, 3, 0.68), (6, 2, 0.86), (8, 4, 0.7), (10, 2, 0.58), (12, 3, 0.86), (14, 2, 0.6)]
E_ROLL = [(0, 0, 1.0), (2, 2, 0.6), (4, 4, 0.66), (6, 5, 0.82), (8, 6, 0.7), (10, 5, 0.6), (12, 4, 0.8), (14, 2, 0.6)]
E_UPPER = [(0, 5, 0.9), (6, 6, 0.8), (12, 7, 0.85)]
M16 = [(i, o, v) for i, (o, v) in enumerate([(3, 1.0), (4, .6), (5, .7), (4, .6), (3, .85), (4, .6), (5, .7), (6, .65),
                                              (3, .9), (4, .6), (5, .7), (4, .6), (3, .85), (5, .6), (6, .7), (5, .6)])]
G3332 = [(0, 0, 1.0), (3, 2, 0.62), (6, 1, 0.74), (9, 3, 0.66), (12, 2, 0.74), (14, 1, 0.56)]
G_SNAP = [(0, 3, 1.0), (6, 4, 0.62), (12, 2, 0.6)]
TRES = [(0, 0, 1.0), (3, 3, 0.68), (6, 2, 0.82), (8, 1, 0.6), (10, 4, 0.74), (12, 3, 0.6), (14, 5, 0.8)]
CHICK = [(4, 4, 0.8), (4, 5, 0.65), (12, 4, 0.8), (12, 6, 0.65)]


def _stems(name: str) -> tuple[Stem, Stem]:
    main = Stem(f'{name}_main', LOOP, seed=f'{name}:main',
                sends={'drone': (0.28, 0.0), 'bass': (0.05, 0.0), 'harp': (0.22, 0.08), 'glass': (0.5, 0.0),
                       'bell': (0.45, 0.0), 'fm': (0.5, 0.0), 'breath': (0.4, 0.0), 'esc': (0.12, 0.1), 'chime': (0.6, 0.0)},
                bus_db={'drone': -4.5, 'bass': -4.0, 'harp': 1.5, 'glass': 0.0, 'bell': -3.0, 'fm': -7.0, 'breath': -1.0,
                        'esc': -3.0, 'chime': -2.0},
                bus_fx={'drone': [ens(2.2, 0.17, 0.5, f'{name}-ens')], 'bass': [sat_insert(1.6, 0.3, 0.1)],
                        'harp': [eq_insert(('low', 180.0, -2.0))], 'glass': [eq_insert(('high', 3500.0, 4.0))],
                        'chime': [eq_insert(('high', 3500.0, 3.0))]})
    layer = Stem(f'{name}_intense', LOOP, seed=f'{name}:intense',
                 sends={'drums': (0.10, 0.14), 'pulse': (0.0, 0.0), 'motor': (0.16, 0.10), 'esc': (0.08, 0.12),
                        'breath': (0.3, 0.0)},
                 bus_db={'drums': 5.0, 'pulse': -5.0, 'motor': 2.5, 'esc': -3.0, 'breath': -4.0},
                 bus_fx={'drums': [sat_insert(1.8, 0.25, 0.05), lambda x, loop: fx.compress(x, -20.0, 2.2, 0.006, 0.12, circular=loop)],
                         'pulse': [sat_insert(2.0, 0.35, 0.1), eq_insert(('hp', 38.0, 0.7))],
                         'motor': [eq_insert(('hp', 160.0, 0.7))]})
    return main, layer


def _harmony(main: Stem, chords: list[str], pad_vel: float, cutoff=(380.0, 1150.0), bass_vel: float = 0.38,
             centre: float = 62.0) -> list[list[float]]:
    V = voicings(chords, centre=centre)
    pad_chords(main, V, [BAR] * BARS, vel=pad_vel, cutoff=cutoff, attack=1.4, release=2.2, bus='drone', lfo_hz=1 / 32)
    bl = blocks(chords, BAR, key=lambda c: VOC[c][0])
    bass_line(main, [(s, d, VOC[c][0]) for s, d, c in bl], vel=bass_vel, cutoff=(150.0, 380.0), attack=0.6,
              release=1.4, sub=0.35)
    return V


def _bass_pulse(layer: Stem, bar: int, chord: str, pat: str, vel: float, dur16: float = 0.22) -> None:
    """Pluck bass on a 16-step string: r/R root, o/O octave (lower case = normal, upper = accent)."""
    root = midi(VOC[chord][0])
    for i, ch in enumerate(pat):
        if ch == '-':
            continue
        p = root + {'r': 0, 'o': 12}[ch.lower()]
        v = vel * (1.0 if ch.isupper() else 0.68)
        n_len = dur16 if (i + 1 < len(pat) and pat[i + 1] != '-') else dur16 * 1.6
        pluck(layer, T(bar, i / 4), p, n_len, v, lo=110.0, hi=820.0 + 300.0 * (ch.isupper()), tau=0.075)


def _fill(sec_last: bool) -> dict:
    return {'K': 'X-------X-------', 'T': '----x-----------', 'R': '----------.oo.xX', 'M': '-----------x-x--'}


def _finish(main: Stem, layer: Stem, chords: list[str], allowed, hits=(), V=None) -> tuple[dict, dict]:
    kicks = [(t, v) for t, lane, v in hits if lane in ('K', 'L')]
    if kicks:
        layer.bus_fx.setdefault('pulse', []).append(duck_insert(kicks, LOOP, -7.0, 0.004, 0.14))
        layer.bus_fx.setdefault('motor', []).append(duck_insert(kicks, LOOP, -3.0, 0.004, 0.12))
    main.post.append(lambda x, loop: fx.speech_dip(x, -3.0, circular=loop))
    layer.post.append(lambda x, loop: fx.eq(x, [('peak', 2000.0, -3.0, 0.7), ('high', 6500.0, -2.0)], circular=loop))
    bad = mode_report(main, allowed) + mode_report(layer, allowed)
    clashes = clash_report(main, chords, V, BAR) + clash_report(layer, chords, V, BAR) if V is not None else []
    return {'main': main.render(), 'intense': layer.render()}, {'bpm': BPM, 'loop': LOOP, 'layers': ['intense'],
                                                                 'mode_violations': bad, 'clashes': clashes, 'chords': chords}


# ── RIFT ─────────────────────────────────────────────────────────────────────────────────────────
def build_rift() -> tuple[dict, dict]:
    ch = RIFT
    main, layer = _stems('rift')
    V = _harmony(main, ch, pad_vel=0.17, cutoff=(420.0, 1300.0))
    # harp pulse: quarters → straight 8ths (3+3+2 accents) → rolling in the turn → doubled in the hook
    for b in range(BARS):
        sec, bass = b // SECTION, midi(VOC[ch[b]][0])
        if b < 8 or b >= 72:
            ostinato(main, T(b), BEAT, V[b], bass, Q_PULSE, 0.30, 1.1, rr0=b, bus='harp')
        elif sec == 2:
            ostinato(main, T(b), BEAT, V[b], bass, E_ROLL, 0.28, 0.8, rr0=b, bus='harp')
        else:
            ostinato(main, T(b), BEAT, V[b], bass, E_DRIVE, 0.27 + 0.04 * (sec == 3), 0.42, rr0=b, bus='harp')
        if sec == 3:
            ostinato(main, T(b), BEAT, V[b], bass, E_UPPER, 0.16, 0.6, rr0=b + 2, bus='harp', bright=0.4)
        if sec in (1, 3):
            esc_grid(main, T(b), BEAT, '--k---k---k---k-', 0.16, pan=0.3)
    # glass: a slow descent in S1, the call-and-answer of S2, the Lydian glow of S3, the hook, the fade
    g = [
        (8, 0, 'E5', .26, 6), (9, 2, 'C5', .2, 5), (10, 0, 'D5', .26, 6), (12, 0, 'B4', .26, 5), (13, 2, 'A4', .22, 5),
        (14, 0, 'E5', .26, 5), (15, 0, 'D5', .24, 6),
        (16, 0, 'A4', .32, 5), (16, 1, 'E5', .36, 6), (17, 2, 'D5', .28, 5), (17, 3, 'C5', .26, 5),
        (18, 0, 'G4', .30, 5), (18, 1, 'D5', .34, 6), (19, 2, 'C5', .26, 5), (19, 3, 'B4', .26, 5),
        (20, 0, 'D5', .30, 5), (20, 1, 'E5', .34, 6), (21, 2, 'D5', .26, 5), (21, 3, 'B4', .26, 5), (22, 0, 'A4', .32, 7),
        (24, 0, 'A4', .30, 5), (24, 1, 'E5', .34, 5), (24, 2, 'G5', .36, 7), (26, 0, 'E5', .32, 5), (26, 1.5, 'D5', .28, 5),
        (26, 3, 'B4', .30, 6), (28, 0, 'G4', .28, 5), (28, 1, 'B4', .30, 5), (28, 2, 'D5', .32, 6), (30, 0, 'E5', .32, 7),
        (31, 0, 'D5', .28, 6),
        (32, 0, 'E5', .24, 6), (33, 2, 'G5', .20, 6), (34, 0, 'D5', .24, 6), (35, 2, 'A5', .18, 6),
        (36, 0, 'B5', .22, 6, .35), (36, 3, 'G#5', .20, 6, -.3), (37, 2, 'E6', .14, 6, .1), (38, 0, 'D6', .14, 6, -.15),
        (38, 2, 'B5', .16, 6, .2), (39, 0, 'G#5', .18, 7, -.2), (40, 0, 'C6', .16, 6), (41, 2, 'A5', .16, 6),
        (42, 0, 'B5', .16, 6), (43, 2, 'A5', .15, 6), (44, 0, 'E5', .22, 6), (46, 0, 'D5', .22, 7),
        (50, 0, 'C5', .28, 5), (50, 1, 'E5', .30, 5), (51, 0, 'D5', .30, 6), (51, 2, 'B4', .26, 5),
        (54, 0, 'G5', .30, 5), (54, 1, 'E5', .28, 5), (54, 2, 'D5', .30, 6), (55, 0, 'E5', .30, 5), (55, 2, 'D5', .26, 6),
        (58, 0, 'A5', .32, 5), (58, 1, 'G5', .30, 5), (58, 2, 'E5', .30, 5), (59, 0, 'D5', .32, 6), (59, 2, 'E5', .28, 6),
        (62, 0, 'E5', .28, 6), (63, 0, 'D5', .26, 6), (63, 2, 'A4', .22, 6),
        (64, 0, 'A4', .28, 5), (64, 1, 'E5', .30, 6), (66, 0, 'D5', .26, 5), (66, 2, 'B4', .24, 6),
        (68, 0, 'A4', .26, 5), (68, 1, 'E5', .28, 5), (68, 2, 'D5', .26, 6), (70, 0, 'B4', .24, 6),
        (72, 0, 'E5', .24, 7), (74, 0, 'D5', .22, 7), (76, 0, 'B4', .20, 6), (76, 2, 'A4', .18, 6),
    ]
    line(main, T, g, 'glass', bus='glass', bright=0.85)
    # the hook: four statements, each closed by the bright F#5 (tokens.audio.motif.endings.rift)
    for k, b in enumerate((48, 52, 56, 60)):
        v = (.46, .44, .50, .56)[k]
        motif(main, T(b), BEAT, ENDINGS['rift'], 'glass', v, ring=5.0, end_ring=7.0 if k < 3 else 9.0, bus='glass', bright=0.9)
        if k == 1:
            motif(main, T(b), BEAT, ENDINGS['rift'], 'harp', 0.30, transpose=-12, ring=1.6, end_ring=2.6, bus='harp', bright=0.35,
                      damp_at=1.35)
        if k >= 2:
            motif(main, T(b), BEAT, ENDINGS['rift'], 'bell', 0.13 if k == 2 else 0.16, ring=6.0, end_ring=8.0, bus='bell')
    # bells on D / A / E only (their tierce and quint stay in the mode)
    for b, p, v in ((0, 'D3', .34), (16, 'A3', .26), (32, 'A3', .24), (36, 'E4', .2), (48, 'D3', .36), (56, 'A3', .26),
                    (61, 'D3', .34), (61, 'A3', .2), (64, 'D3', .26)):
        main.add(T(b), 'bell', p, 14.0, v, 0.1 if 'A' in p else -0.1, bus='bell', decay_scale=1.1)
    for b, p in ((36, 'B6'), (38, 'E6'), (49, 'F#6'), (57, 'F#6'), (61, 'A6')):
        main.add(T(b), 'fm', p, 3.0, 0.07, 0.25, decay_s=2.0, index_from=1.4, ratio=3.5, bus='fm')
    for b in (16, 32, 48, 64):
        riser(main, T(b), 4.0, 0.13, 300.0, 1800.0)
    gust(main, T(61, 1), 6.0, 0.10, 1600.0, 400.0)
    main.automate([(T(0), -1.5), (T(14), -1.0), (T(18), 0.0), (T(34), -0.6), (T(46), 0.2), (T(50), 1.0), (T(62), 1.0),
                   (T(68), -0.4), (T(78), -1.4)])

    # combat layer
    hits = []
    A = {'K': 'X-----x-X-------', 'T': '----X-------X---', 'G': '--.--..---.--..-'}
    B = {'K': 'X-----x-X-x-----', 'T': '----X-------X--o', 'G': '-..--.-.-.-.-..-'}
    C = {'K': 'X-------X-------', 'L': '---x--x----x--x-', 'T': '----x-------x---', 'G': '-.---.---.---.-.'}
    for b in range(BARS):
        sec, last = b // SECTION, b % SECTION == SECTION - 1
        lanes = _fill(True) if last else (C if sec == 2 else B if sec in (1, 3) else A)
        if sec == 3 and b % 4 == 0 and not last:
            lanes = dict(lanes, L='X---------------')
        hits += drum_grid(layer, T(b), BEAT, lanes, KIT, rr0=b)
        pat = ('R-------r-----o-' if sec == 2 else 'R-rrr-O-r-rrR-o-' if sec in (1, 3) else 'R-r-r-O-r-r-R-o-')
        _bass_pulse(layer, b, ch[b], pat, 0.40)
        if sec in (1, 3):
            ostinato(layer, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), M16, 0.21, 0.22, lo=48, hi=72, bus='motor',
                     rr0=b, bright=0.25, human=3.0)
            esc_grid(layer, T(b), BEAT, 'k-K-k-K-k-K-k-K-', 0.22, pan=0.35, **SMALL_ESC)
        elif sec == 2:
            ostinato(layer, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), E_ROLL, 0.19, 0.5, lo=48, hi=72, bus='motor', rr0=b)
        else:
            esc_grid(layer, T(b), BEAT, '--K---K---K---K-', 0.2, pan=0.35, **SMALL_ESC)
    for b in (16, 32, 48, 64, 80):
        riser(layer, T(b), 3.0, 0.22, 400.0, 3200.0)
    return _finish(main, layer, ch, BRIGHT_PCS, hits, V)


# ── BRIDGE ───────────────────────────────────────────────────────────────────────────────────────
def build_bridge() -> tuple[dict, dict]:
    ch = BRIDGE
    main, layer = _stems('bridge')
    V = _harmony(main, ch, pad_vel=0.16, cutoff=(300.0, 900.0), centre=60.0)
    # the D pedal under S1 and S5: a held low string that never stops (periodic across the seam)
    for a, b0 in ((0, 16), (64, 16)):
        main.add(T(a) - 0.6, 'drone', 'D1', T(b0) + 1.2, 0.20, 0.0, human=False, bus='bass',
                 cutoff=(110.0, 220.0), attack=1.5, release=1.5, sub=0.5, lfo_hz=1 / 16)
    r = rng('bridge-chimes')
    for b in range(BARS):
        sec, bass = b // SECTION, midi(VOC[ch[b]][0])
        if sec == 2:
            ostinato(main, T(b), BEAT, V[b], bass, G_SNAP, 0.24, 1.4, lo=50, hi=79, rr0=b, bus='harp', bright=0.4)
            esc_grid(main, T(b), BEAT, 'C---k---C---k---', 0.24, pan=0.2)
        else:
            vel = 0.30 if sec == 3 else 0.27
            ostinato(main, T(b), BEAT, V[b], bass, G3332, vel, 0.5, lo=45, hi=74, rr0=b, bus='harp', bright=0.28)
        # gorge chimes: sparse high glass on chord tones (S1, S3, S5)
        if sec in (0, 2, 4) and r.random() < 0.7:
            pool = sorted({p + 12 * o for p in V[b] for o in (1, 2) if 79 <= p + 12 * o <= 91})
            if pool:
                p = pool[r.integers(len(pool))]
                main.add(T(b, r.integers(0, 16) / 4), 'glass', p, 5.0, r.uniform(0.10, 0.17), r.uniform(-.6, .6),
                         bus='chime', bright=0.8, decay_scale=1.0)
    g = [
        (16, 0, 'E5', .30, 6), (16, 3, 'D5', .24, 5), (17, 0, 'C5', .28, 5), (17, 2, 'B4', .30, 7),
        (18, 0, 'A4', .28, 5), (18, 1, 'C5', .28, 5), (19, 0, 'E5', .30, 7),
        (20, 0, 'D5', .28, 5), (20, 1.5, 'E5', .30, 6), (21, 2, 'B4', .26, 6), (22, 0, 'C5', .28, 5), (22, 2, 'B4', .26, 5),
        (23, 0, 'A4', .30, 7),
        (24, 0, 'A4', .28, 5), (24, 1, 'C5', .28, 5), (24, 2, 'E5', .30, 5), (25, 0, 'G5', .30, 7),
        (26, 0, 'E5', .28, 5), (26, 1.5, 'D5', .26, 5), (27, 0, 'B4', .28, 7), (28, 0, 'A4', .26, 5), (28, 1, 'C5', .26, 5),
        (29, 0, 'D5', .28, 6), (30, 0, 'B4', .28, 6), (31, 0, 'A4', .24, 7),
        (32, 0, 'B5', .18, 7, .3), (34, 0, 'C6', .16, 6, -.3), (35, 0, 'B5', .16, 6, .2), (36, 0, 'A5', .16, 7, -.2),
        (38, 0, 'E5', .18, 7), (40, 0, 'F5', .16, 7, .3), (41, 2, 'E5', .16, 6, -.2), (42, 0, 'B5', .14, 6),
        (44, 0, 'D5', .18, 6), (46, 0, 'E5', .20, 6), (47, 2, 'B4', .18, 6),
        (50, 0, 'C5', .26, 5), (50, 1, 'E5', .28, 6), (51, 0, 'B4', .26, 6), (51, 2, 'A4', .24, 6),
        (54, 0, 'C5', .26, 5), (54, 1, 'A4', .26, 6), (55, 0, 'B4', .28, 6), (55, 2, 'E5', .24, 6),
        (58, 0, 'F5', .28, 5), (58, 1, 'E5', .26, 5), (58, 2, 'C5', .26, 5), (59, 0, 'D5', .28, 6), (59, 2, 'A4', .24, 6),
        (62, 0, 'E5', .24, 6), (63, 0, 'D5', .22, 6),
    ]
    line(main, T, g, 'glass', bus='glass', bright=0.8)
    for k, b in enumerate((48, 52, 56, 60)):
        motif(main, T(b), BEAT, ENDINGS['bridge'], 'glass', (.44, .42, .40, .50)[k], ring=5.0, end_ring=7.0, bus='glass', bright=0.85)
        if k == 2:      # the third statement drops into the low harp, the glass answers above
            motif(main, T(b), BEAT, ENDINGS['bridge'], 'harp', 0.34, transpose=-12, ring=1.8, end_ring=3.0, bus='harp', bright=0.3,
                      damp_at=1.55)
        if k == 3:
            for i, (p, bb) in enumerate((('A4', 0.0), ('E5', 1.0), ('D5', 2.0))):
                main.add(T(b, bb), 'bell', p, 6.0, 0.12, 0.0, bus='bell')
    for b, p, v in ((0, 'D3', .32), (8, 'D3', .22), (16, 'A2', .30), (24, 'A3', .2), (32, 'E3', .30), (40, 'E3', .22),
                    (48, 'E3', .32), (56, 'A2', .26), (64, 'D3', .30), (72, 'D3', .22)):
        main.add(T(b), 'bell', p, 16.0, v, -0.15, bus='bell', decay_scale=1.2)
    # wind along the gorge: seeded gusts, low and slow
    rw = rng('bridge-wind')
    t = 1.0
    while t < LOOP - 2.0:
        d = rw.uniform(5.0, 9.0)
        f0 = rw.uniform(180, 320)
        gust(main, t, d, rw.uniform(0.10, 0.16), f0, f0 * rw.uniform(2.2, 3.6), pan=rw.uniform(-.5, .5), q=1.4)
        t += d * rw.uniform(0.7, 1.3)
    for b in (16, 32, 48, 64):
        riser(main, T(b), 4.0, 0.12, 220.0, 1400.0)
    main.automate([(T(0), -1.2), (T(14), -0.8), (T(18), 0.0), (T(32), -1.0), (T(46), -0.2), (T(50), 0.8), (T(62), 0.8),
                   (T(68), -0.5), (T(78), -1.1)])

    hits = []
    A = {'K': 'X---------x-----', 'L': '---x--x--x----x-', 'T': '--------X-------', 'G': '--o-o--o--o-o--o'}
    C = {'K': 'X---------------', 'L': '------x-------x-', 'T': '--------x-------', 'R': '--------..oo.oox'}
    D = {'K': 'X-----x---x-X---', 'L': '---x-----x----x-', 'T': '----X-------X---', 'G': '-o-o-o-o-o-o-o-.'}
    for b in range(BARS):
        sec, last = b // SECTION, b % SECTION == SECTION - 1
        lanes = _fill(True) if last else (C if sec == 2 else D if sec == 3 else A)
        if sec == 2 and b % 2 == 0 and not last:
            lanes = dict(lanes, R='----------------')
        hits += drum_grid(layer, T(b), BEAT, lanes, KIT, rr0=b)
        if sec == 2:
            pat = 'R-------r-------'
        elif sec == 3:
            pat = 'R-rrr-rrO-rrr-rr'
        else:
            pat = 'R-rrr-rrr-rrr-rr'
        _bass_pulse(layer, b, ch[b] if sec in (1, 2, 3) else 'Dmadd9', pat, 0.38, dur16=0.12)
        if sec in (1, 3):
            ostinato(layer, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), M16, 0.19, 0.2, lo=45, hi=70, bus='motor',
                     rr0=b, bright=0.22, human=3.0)
        if sec == 3:
            esc_grid(layer, T(b), BEAT, 'kkKkkkKkkkKkkkKk', 0.18, pan=0.35, **SMALL_ESC)
        elif sec != 2:
            esc_grid(layer, T(b), BEAT, '--K---K---K---K-', 0.18, pan=0.35, **SMALL_ESC)
    for b in (16, 32, 48, 64, 80):
        riser(layer, T(b), 3.0, 0.22, 300.0, 2600.0)
    return _finish(main, layer, ch, COLOUR_PCS, hits, V)


# ── FRAY ─────────────────────────────────────────────────────────────────────────────────────────
def build_fray() -> tuple[dict, dict]:
    ch = FRAY
    main, layer = _stems('fray')
    V = _harmony(main, ch, pad_vel=0.16, cutoff=(460.0, 1400.0), centre=63.0)
    for b in range(BARS):
        sec, bass = b // SECTION, midi(VOC[ch[b]][0])
        if b < 4 or b >= 76:
            ostinato(main, T(b), BEAT, V[b], bass, Q_PULSE, 0.30, 1.0, rr0=b, bus='harp', bright=0.35)
        else:
            ostinato(main, T(b), BEAT, V[b], bass, TRES, 0.28 + 0.03 * (sec == 3), 0.45, rr0=b, bus='harp', bright=0.35)
        if sec in (1, 3):
            ostinato(main, T(b), BEAT, V[b], bass, CHICK, 0.16, 0.25, rr0=b + 1, bus='harp', bright=0.45)
            esc_grid(main, T(b), BEAT, '--k---k---k---k-', 0.16, pan=-0.3)
    # bell peals (the fair) on the mode-safe bells D / A / E, ringing down
    def peal(b, notes, v=0.2):
        for i, p in enumerate(notes):
            main.add(T(b, i * 0.5), 'bell', p, 9.0, v * (1.0 - 0.06 * i), -0.5 + i * 0.22, bus='bell', decay_scale=0.9)
    peal(0, ['E5', 'D5', 'A4', 'E4', 'D4'], 0.18)
    peal(16, ['E5', 'D5', 'A4', 'E4', 'D4', 'A3'], 0.2)
    peal(32, ['A4', 'E4', 'D4', 'A3'], 0.16)
    peal(64, ['E5', 'D5', 'A4', 'E4', 'D4'], 0.16)
    peal(78, ['E5', 'D5', 'E5', 'E4'], 0.12)
    for b, p, v in ((8, 'D3', .26), (24, 'A3', .22), (40, 'D3', .24), (46, 'E4', .22), (48, 'D3', .34), (56, 'A3', .24),
                    (61, 'E4', .26), (72, 'D3', .22)):
        main.add(T(b), 'bell', p, 14.0, v, 0.15, bus='bell', decay_scale=1.0)
    g = [
        (8, 0, 'E5', .24, 5), (9, 2, 'C5', .20, 5), (10, 0, 'D5', .24, 5), (11, 2, 'E5', .22, 5), (12, 0, 'D5', .24, 5),
        (13, 0, 'B4', .22, 5), (14, 0, 'B4', .24, 5), (14, 2, 'G#4', .22, 6), (15, 2, 'E5', .2, 5),
        (16, 0, 'A4', .30, 5), (16, 0.75, 'E5', .32, 5), (16, 1.5, 'D5', .28, 5), (16, 3, 'E5', .30, 6),
        (18, 0, 'C5', .28, 5), (18, 0.75, 'E5', .30, 5), (18, 1.5, 'G5', .30, 6), (19, 2, 'E5', .26, 6),
        (20, 0, 'D5', .28, 5), (20, 0.75, 'B4', .26, 5), (20, 1.5, 'A4', .28, 5), (21, 0, 'E5', .30, 6),
        (22, 0, 'D5', .28, 5), (22, 0.75, 'E5', .30, 5), (22, 1.5, 'G5', .30, 5), (23, 0, 'E5', .28, 6),
        (24, 0, 'A5', .30, 5), (24, 0.75, 'G5', .28, 5), (24, 1.5, 'E5', .28, 5), (25, 0, 'C5', .26, 6),
        (26, 0, 'D5', .28, 5), (26, 0.75, 'E5', .28, 5), (26, 1.5, 'B4', .28, 6), (28, 0, 'G5', .26, 5), (28, 1.5, 'E5', .26, 5),
        (29, 0, 'D5', .26, 6), (30, 0, 'E5', .28, 5), (30, 1.5, 'B4', .26, 5), (31, 0, 'G#4', .28, 7),
        (32, 0, 'C5', .24, 6), (33, 2, 'A4', .22, 6), (34, 0, 'B4', .24, 6), (35, 2, 'D5', .22, 6), (36, 0, 'E5', .24, 6),
        (37, 2, 'C5', .22, 6), (38, 0, 'D5', .24, 6), (39, 2, 'B4', .22, 6), (40, 0, 'E5', .24, 6), (41, 2, 'G5', .22, 6),
        (42, 0, 'F5', .24, 6), (43, 2, 'E5', .22, 6), (44, 0, 'D5', .24, 6), (45, 2, 'B4', .22, 6), (46, 0, 'B4', .24, 6),
        (46, 2, 'D5', .22, 6), (47, 0, 'E5', .26, 7),
        (50, 0, 'E5', .28, 5), (50, 0.75, 'G5', .28, 5), (51, 0, 'D5', .28, 6), (51, 2, 'B4', .24, 5),
        (54, 0, 'A5', .28, 5), (54, 0.75, 'G5', .28, 5), (54, 1.5, 'E5', .28, 5), (55, 0, 'D5', .28, 6),
        (58, 0, 'E5', .28, 5), (58, 0.75, 'G5', .30, 5), (58, 1.5, 'B5', .28, 5), (59, 0, 'A5', .28, 6),
        (62, 0, 'B4', .26, 6), (62, 2, 'E5', .24, 6), (63, 0, 'G#4', .24, 7),
        (64, 0, 'A4', .26, 5), (64, 0.75, 'E5', .28, 6), (66, 0, 'C5', .24, 5), (66, 0.75, 'E5', .26, 6),
        (68, 0, 'D5', .24, 5), (68, 0.75, 'B4', .24, 6), (70, 0, 'E5', .24, 7), (72, 0, 'C5', .22, 6), (74, 0, 'B4', .22, 6),
    ]
    line(main, T, g, 'glass', bus='glass', bright=0.9)
    for k, b in enumerate((48, 52, 56, 60)):
        motif(main, T(b), BEAT, ENDINGS['fray'], 'glass', (.46, .44, .48, .54)[k], ring=5.0, end_ring=7.0 if k < 3 else 9.0,
              bus='glass', bright=0.95)
        if k in (1, 3):
            for p, bb in (('A4', 0.0), ('E5', 1.0), ('D5', 2.0)):
                main.add(T(b, bb), 'bell', p, 6.0, 0.11, 0.2, bus='bell')
        if k == 2:
            motif(main, T(b), BEAT, ENDINGS['fray'], 'harp', 0.3, transpose=-12, ring=1.5, end_ring=2.6, bus='harp', bright=0.4,
                      damp_at=1.25)
    # sunmotes: soft FM sparkles that fall through the turn and the hook (seeded)
    rs = rng('fray-motes')
    for b in range(32, 64):
        if rs.random() < 0.45:
            pool = [p for p in (81, 83, 86, 88, 93) if (p % 12) in {(int(x) % 12) for x in V[b]} | {9, 2}]
            p = pool[rs.integers(len(pool))] if pool else 86
            main.add(T(b, rs.integers(0, 16) / 4), 'fm', p, 3.0, rs.uniform(0.04, 0.07), rs.uniform(-.7, .7),
                     decay_s=1.6, index_from=1.6, ratio=3.5, bus='fm')
    for b in (16, 32, 48, 64):
        riser(main, T(b), 4.0, 0.12, 360.0, 2000.0)
    gust(main, T(62), 6.0, 0.10, 1800.0, 500.0)
    main.automate([(T(0), -1.4), (T(14), -0.8), (T(18), 0.0), (T(34), -0.8), (T(46), 0.0), (T(50), 1.0), (T(62), 1.0),
                   (T(68), -0.4), (T(78), -1.3)])

    hits = []
    A = {'K': 'X-----x-X-----x-', 'T': '----X-------X---', 'G': '-.-.-.-..-.--.-.', 'R': '---------------o'}
    C = {'K': 'X-------X-------', 'M': '---x--x----x--x-', 'L': 'x-------x-------', 'T': '----X-------X---'}
    D = {'K': 'X-----x-X-x---x-', 'T': '----X-------X---', 'G': '-..-.-.-.-..-.-.', 'R': '-------------.ox'}
    for b in range(BARS):
        sec, last = b // SECTION, b % SECTION == SECTION - 1
        lanes = _fill(True) if last else (C if sec == 2 else D if sec in (1, 3) else A)
        if lanes is not C and not last:
            lanes = {k: v for k, v in lanes.items()}
            if 'G' in lanes:     # ghosts never on a doum/tek step
                busy = {i for k2 in ('K', 'T') for i, c in enumerate(lanes.get(k2, '')) if c != '-'}
                lanes['G'] = ''.join('-' if i in busy else c for i, c in enumerate(lanes['G']))
        hits += drum_grid(layer, T(b), BEAT, lanes, KIT, rr0=b)
        pat = 'R-------r---o---' if sec == 2 else 'R-o-r-O-r-o-R-o-'
        _bass_pulse(layer, b, ch[b], pat, 0.38)
        if sec in (1, 3):
            ostinato(layer, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), M16, 0.19, 0.22, lo=50, hi=74, bus='motor',
                     rr0=b, bright=0.2, human=3.0)
            esc_grid(layer, T(b), BEAT, 'kkK-kkK-kkK-kkKk', 0.17, pan=-0.35, **SMALL_ESC)
        elif sec != 2:
            esc_grid(layer, T(b), BEAT, '--K---K---K---K-', 0.18, pan=-0.35, **SMALL_ESC)
        else:
            ostinato(layer, T(b), BEAT, V[b], midi(VOC[ch[b]][0]), TRES, 0.17, 0.4, lo=50, hi=74, bus='motor', rr0=b)
    for b in (16, 32, 48, 64, 80):
        riser(layer, T(b), 3.0, 0.22, 400.0, 3600.0)
    return _finish(main, layer, ch, COLOUR_PCS, hits, V)


BUILDERS = {'rift': build_rift, 'bridge': build_bridge, 'fray': build_fray}
