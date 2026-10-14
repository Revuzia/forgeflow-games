"""The match-end stings (cues on the `music` bus): m_victory_sting, m_defeat_sting, m_placement_sting (+ the
1st-place cut of the FRAY sting). Each returns an unmastered stereo one-shot; build_music.py masters it to
the sting target (max short-term −16 LUFS, tokens.audio.loudness.stingsShortTermLUFS).

  victory    6 s, 120 BPM. A doum and a D bell; the glass sings the motif A4 E5 D5 B4 over Dsus2 while the
             rim drums pick up, and lands on F#5 with the noon chord D A E F# G# (tokens.audio.motif
             .victoryChord): bells, a harp roll, sunlit FM, a breath swelling into the arrival.
  defeat     4 s, 100 BPM. No drums. A soft D bell, Dsus2 in the lamps, the motif sung quietly and its B4
             simply held, open, over the Dsus2 (tokens: "a held B4 over Dsus2"). Dignified: losing is
             respectable in the Vale. (The −4 LU of tokens.audio.stings.defeat is the cue gain 0.63.)
  placement  5 s, FRAY. "The first-placed fighter strikes the year's first bell": a bright D bell, the motif
             landing on G#4 over E/D, then the noon chord truncated (D A E G#, no F#) — honour for any place.
  placement_first  the 1st-place cut: the full noon chord (F#5 on top) and a peal of fair bells.
"""
from __future__ import annotations

import numpy as np

from .core import SR, fade, midi, ns
from .music_common import MOTIF, eq_insert, ens, pad_chords
from .score import Stem


def _stem(name: str, length: float) -> Stem:
    return Stem(name, length, loop=False, seed=name,
                sends={'drone': (0.32, 0.0), 'bass': (0.06, 0.0), 'harp': (0.3, 0.1), 'glass': (0.5, 0.0),
                       'bell': (0.45, 0.0), 'fm': (0.5, 0.0), 'breath': (0.4, 0.0), 'drums': (0.14, 0.16)},
                bus_db={'drone': -3.0, 'bass': -4.0, 'harp': 0.0, 'glass': 1.0, 'bell': -3.0, 'fm': -6.0, 'breath': -2.0,
                        'drums': 0.0},
                bus_fx={'drone': [ens(2.2, 0.3, 0.5, name + '-ens')], 'glass': [eq_insert(('high', 3500.0, 3.0))]})


def _roll(st: Stem, t: float, notes, vel: float, spread: float = 0.04, ring: float = 3.5) -> None:
    for k, p in enumerate(notes):
        st.add(t + spread * k, 'harp', p, ring + 0.3, vel * (1 - 0.04 * k), -0.4 + 0.8 * k / max(1, len(notes) - 1),
               human=False, bus='harp', rr=k % 4, bright=0.4, damp_at=ring)


def _motif(st: Stem, t0: float, beat: float, vel: float, ending: str | None, end_ring: float, held_b: float | None = None,
           **kw) -> float:
    t = t0
    for i, (p, b) in enumerate(MOTIF):
        ring = held_b if (held_b and i == 3) else 6.0
        st.add(t, 'glass', p, ring, vel * (1.0 if i != 1 else 1.06), 0.0, human=False, bus='glass', bright=0.95, **kw)
        t += b * beat
    if ending:
        st.add(t, 'glass', ending, end_ring, vel * 1.1, 0.0, human=False, bus='glass', bright=1.0, **kw)
    return t


def _finish(st: Stem, length: float, fade_from: float) -> np.ndarray:
    x = st.render(tail_s=0.0)[:, :ns(length)]
    return fade(x, 0.0, length - fade_from, shape='cos')


def victory() -> np.ndarray:
    L, beat = 6.0, 0.5
    st = _stem('victory', L)
    # lamps: Dsus2 → the noon chord at the arrival (2.0 s)
    pad_chords(st, [[50.0, 57.0, 64.0, 69.0], [57.0, 64.0, 66.0, 68.0]], [2.0, 4.0], vel=0.22, cutoff=(500.0, 1600.0),
               attack=0.25, release=2.0, loop=False, bus='drone', overlap=0.2, lfo_hz=0.2)
    st.add(0.0, 'drone', 'D2', 6.0, 0.4, 0.0, human=False, bus='bass', cutoff=(160.0, 420.0), attack=0.05, release=1.5, sub=0.35)
    st.add(0.0, 'drone', 'A1', 6.0, 0.14, 0.0, human=False, bus='bass', cutoff=(120.0, 260.0), attack=1.6, release=1.5, sub=0.2)
    # the opening strike
    for lane, p, v, kick in (('K', 'A2', 0.85, 0.9), ('L', 'D2', 0.6, 0.4)):
        st.add(0.0, 'drum', p, 0.9, v, 0.0, human=False, bus='drums', stroke='doum', kick=kick)
    st.add(0.0, 'bell', 'D3', 9.0, 0.38, -0.15, human=False, bus='bell')
    _roll(st, 0.0, [50, 57, 62, 64, 69], 0.34)
    _motif(st, 0.0, beat, 0.55, 'F#5', 7.0)
    for t, p in ((0.0, 'A3'), (0.5, 'E4'), (1.0, 'D4'), (1.25, 'B3'), (2.0, 'F#4')):       # harp shadow, an octave down
        st.add(t, 'harp', p, 1.6, 0.2, -0.2, human=False, bus='harp', rr=1, bright=0.35, damp_at=0.9 if t < 2 else 1.1)
    # rim pickups into the arrival
    for t, s, v in ((1.0, 'tek', 0.42), (1.5, 'tek', 0.5), (1.625, 'roll', 0.3), (1.75, 'roll', 0.38), (1.875, 'roll', 0.48)):
        st.add(t, 'drum', 'D3', 0.9, v, 0.15, human=False, bus='drums', stroke=s)
    st.add(0.4, 'breath', None, 1.64, 0.22, 0.0, human=False, bus='breath', f_start=400, f_end=3200, q=2.0, shape='swell',
           peak_at=1.6, curve=-3.0)
    # the arrival: the noon chord (D A E F# G#)
    for lane, p, v, kick in (('K', 'A2', 1.0, 1.0), ('L', 'D2', 0.75, 0.5)):
        st.add(2.0, 'drum', p, 0.9, v, 0.0, human=False, bus='drums', stroke='doum', kick=kick)
    for t, p, v, pn in ((2.0, 'D3', 0.42, -0.2), (2.0, 'A3', 0.26, 0.2), (2.09, 'E4', 0.22, 0.35)):
        st.add(t, 'bell', p, 9.0, v, pn, human=False, bus='bell')
    _roll(st, 2.0, [50, 57, 64, 66, 68, 69], 0.38, spread=0.035)
    st.add(2.12, 'glass', 'A5', 6.0, 0.18, 0.4, human=False, bus='glass', bright=1.0)
    st.add(2.3, 'glass', 'G#5', 6.0, 0.14, -0.4, human=False, bus='glass', bright=1.0)
    st.add(2.0, 'fm', 'F#6', 3.2, 0.08, 0.3, human=False, bus='fm', decay_s=2.2, index_from=1.6, ratio=3.5)
    st.add(2.25, 'fm', 'A6', 3.2, 0.06, -0.3, human=False, bus='fm', decay_s=2.0, index_from=1.4, ratio=3.5)
    st.add(2.0, 'breath', None, 4.0, 0.12, 0.0, human=False, bus='breath', f_start=2400, f_end=600, q=1.5, shape='breath',
           peak_at=0.3)
    return _finish(st, L, 4.4)


def defeat() -> np.ndarray:
    L, beat = 4.0, 0.6
    st = _stem('defeat', L)
    pad_chords(st, [[50.0, 57.0, 64.0, 69.0]], [4.0], vel=0.2, cutoff=(380.0, 1000.0), attack=0.6, release=2.0,
               loop=False, bus='drone', overlap=0.0, lfo_hz=0.12)
    st.add(0.0, 'drone', 'D2', 4.0, 0.32, 0.0, human=False, bus='bass', cutoff=(140.0, 320.0), attack=0.3, release=1.5, sub=0.3)
    st.add(0.0, 'bell', 'D3', 9.0, 0.3, -0.1, human=False, bus='bell', decay_scale=1.2)
    _roll(st, 0.0, [50, 57, 64], 0.24, spread=0.06, ring=3.6)
    _motif(st, 0.0, beat, 0.36, None, 0.0, held_b=6.0, decay_scale=1.5)
    st.add(1.5, 'harp', 'B3', 3.0, 0.16, 0.2, human=False, bus='harp', rr=2, bright=0.3, damp_at=2.4)
    st.add(1.5, 'bell', 'A3', 7.0, 0.12, 0.25, human=False, bus='bell', decay_scale=0.9)
    st.add(1.4, 'breath', None, 2.6, 0.12, 0.0, human=False, bus='breath', f_start=900, f_end=300, q=1.5, shape='breath',
           peak_at=0.5)
    return _finish(st, L, 2.9)


def _placement(first: bool) -> np.ndarray:
    L, beat = (6.0 if first else 5.0), 0.5
    st = _stem('placement_first' if first else 'placement', L)
    top = [57.0, 64.0, 66.0, 68.0] if first else [57.0, 64.0, 68.0, 76.0]
    pad_chords(st, [[50.0, 57.0, 64.0, 71.0], top], [2.0, L - 2.0], vel=0.2, cutoff=(480.0, 1500.0), attack=0.25,
               release=2.0, loop=False, bus='drone', overlap=0.2, lfo_hz=0.2)
    st.add(0.0, 'drone', 'D2', L, 0.36, 0.0, human=False, bus='bass', cutoff=(160.0, 400.0), attack=0.05, release=1.5, sub=0.3)
    # the year's first bell
    st.add(0.0, 'bell', 'D4', 8.0, 0.44, 0.0, human=False, bus='bell')
    st.add(0.0, 'bell', 'A3', 9.0, 0.24, -0.25, human=False, bus='bell')
    st.add(0.0, 'drum', 'A2', 0.9, 0.6, 0.0, human=False, bus='drums', stroke='doum', kick=0.7)
    _roll(st, 0.0, [50, 57, 62, 64], 0.3)
    _motif(st, 0.0, beat, 0.5, 'G#4', 6.0)
    for t, v in ((1.0, 0.36), (1.5, 0.44)):
        st.add(t, 'drum', 'D3', 0.9, v, 0.15, human=False, bus='drums', stroke='tek')
    st.add(0.5, 'breath', None, 1.54, 0.16, 0.0, human=False, bus='breath', f_start=500, f_end=2600, q=2.0, shape='swell',
           peak_at=1.5, curve=-3.0)
    st.add(2.0, 'drum', 'A2', 0.9, 0.75, 0.0, human=False, bus='drums', stroke='doum', kick=0.8)
    st.add(2.0, 'bell', 'E4', 8.0, 0.3, 0.3, human=False, bus='bell')
    _roll(st, 2.0, [50, 57, 64, 68, 76] if not first else [50, 57, 64, 66, 68, 76], 0.34, spread=0.035)
    st.add(2.2, 'fm', 'E6', 3.0, 0.06, 0.3, human=False, bus='fm', decay_s=2.0, index_from=1.4, ratio=3.5)
    if first:
        st.add(2.5, 'glass', 'F#5', 6.0, 0.34, 0.3, human=False, bus='glass', bright=1.0)
        for i, p in enumerate(('E5', 'D5', 'A4', 'E4')):             # the fair's peal, the year begun
            st.add(2.75 + 0.25 * i, 'bell', p, 6.0, 0.2 - 0.025 * i, -0.4 + 0.25 * i, human=False, bus='bell', decay_scale=0.9)
        st.add(2.5, 'fm', 'F#6', 3.0, 0.07, -0.3, human=False, bus='fm', decay_s=2.2, index_from=1.6, ratio=3.5)
    return _finish(st, L, L - 1.4)


def placement() -> np.ndarray:
    return _placement(False)


def placement_first() -> np.ndarray:
    return _placement(True)
