"""VALE music, composed in code (STYLE_BIBLE "Audio", tokens.audio).

Harmony: D Dorian (D E F G A B C) with the Lydian G# as the colour of bright moments; F# appears
only where the motif resolves bright (RIFT, victory). The motif is A4 E5 D5 B4 (beats 1 1 ½ 1½)
ended by F#5 (RIFT, victory), G4 (BRIDGE), G#4 (FRAY) or a held B4 over Dsus2 (defeat).
Tempi 60 menu · 90 draft · 120 match, every section on the 8-second grid.

Each piece returns {'main': stereo, '<layer>': stereo, …} plus a meta dict. Stems are loops
rendered with tail wrap; layers are additive stems the runtime fades in by INDEX (see
src/audio/engine.ts: menu layers are always on and loop at their own lengths — the polymetric
64/48/80 s menu cycle repeats every 960 s; draft layers unlock by phase; the match layer is the
'intense' stem).
"""
from __future__ import annotations

import math

import numpy as np

from . import env as E
from . import fx
from .core import SR, hz, midi, ns, rng
from .score import Clock, Stem, merge_voice

MOTIF = [('A4', 1.0), ('E5', 1.0), ('D5', 0.5), ('B4', 1.5)]
ENDINGS = {'rift': 'F#5', 'victory': 'F#5', 'bridge': 'G4', 'fray': 'G#4', 'defeat': 'B4'}


def _drone_pad(stem: Stem, chords: list[list[str]], span: float, vel: float, cutoff=(380.0, 1100.0), lfo_hz: float = 0.047,
               attack: float = 1.6, release: float = 2.6, res_db: float = 2.0, pans=None, octave_shift: int = 0,
               loop: bool = True, offset: float = 0.0) -> None:
    """Sustained lamp-drone voices following a voice-led chord list (common tones held)."""
    voices = merge_voice(chords, span, circular=loop)
    nv = len(voices)
    pans = pans or [(-0.45 + 0.9 * i / max(1, nv - 1)) for i in range(nv)]
    for v, notes in enumerate(voices):
        for pitch, start, dur in notes:
            p = midi(pitch) + 12 * octave_shift
            t0 = offset + start
            stem.add(t0 - attack * 0.35, 'drone', p, dur + release * 0.6, vel, pans[v], human=False,
                     cutoff=cutoff, lfo_hz=lfo_hz, lfo_phase=(lfo_hz * t0) % 1.0, attack=attack, release=release, res_db=res_db)


def _motif(stem: Stem, t0: float, beat: float, ending: str | None, voice: str = 'glass', vel: float = 0.5,
           pan: float = 0.0, end_beats: float = 2.0, transpose: int = 0, ring: float = 3.0, **kw) -> float:
    t = t0
    for note, b in MOTIF:
        stem.add(t, voice, midi(note) + transpose, ring, vel, pan, **kw)
        t += b * beat
    if ending:
        stem.add(t, voice, midi(ending) + transpose, ring + end_beats * beat, vel * 1.05, pan, **kw)
        t += end_beats * beat
    return t


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# MENU — 60 BPM, main 64 s (16 bars), layers 48 s 'glass' and 80 s 'air' (polymetric, 960 s cycle)
# ═════════════════════════════════════════════════════════════════════════════════════════════════
MENU_PROG = [  # (bass, pad voices) — 2 bars (8 s) each, voice-led; E/D is the Lydian glow
    ('D2', ['A3', 'C4', 'E4']),   # Dm9
    ('G2', ['B3', 'D4', 'E4']),   # G6
    ('F2', ['A3', 'C4', 'E4']),   # Fmaj7
    ('E2', ['G3', 'B3', 'D4']),   # Em7
    ('D2', ['A3', 'C4', 'E4']),   # Dm9
    ('C2', ['G3', 'B3', 'E4']),   # Cmaj7
    ('A1', ['G3', 'C4', 'E4']),   # Am7
    ('D2', ['G#3', 'B3', 'E4']),  # E/D  (G# → A, B → C into the loop start)
]

MENU_HARP = [  # beat offsets inside each 8-beat chord span, pitch, velocity
    [(0, 'D3', .62), (1, 'A3', .45), (2, 'E4', .5), (3, 'F4', .48), (4.5, 'A4', .46), (6, 'E4', .42), (7, 'C4', .38)],
    [(0, 'G2', .58), (1, 'D3', .45), (2, 'B3', .48), (3, 'E4', .5), (4.5, 'D4', .44), (5.5, 'B3', .38), (6.5, 'G3', .36)],
    [(0, 'F2', .56), (1, 'C3', .45), (2, 'A3', .46), (3, 'E4', .5), (4, 'G4', .48), (5, 'E4', .42), (6, 'C4', .4), (7.5, 'A3', .34)],
    [(0, 'E2', .56), (1, 'B2', .44), (2, 'G3', .46), (3, 'D4', .48), (4.5, 'B3', .42), (6, 'A3', .38), (7, 'G3', .34)],
    [(0, 'D3', .6), (0.5, 'A3', .42), (1, 'E4', .46), (2, 'F4', .5), (2.5, 'E4', .4), (3, 'C4', .42), (4, 'D4', .45),
     (5, 'A4', .5), (6, 'G4', .44), (7, 'E4', .4)],
    [(0, 'C3', .56), (1, 'G3', .44), (1.5, 'B3', .42), (2, 'E4', .48), (3, 'D4', .42), (4, 'G4', .48), (5, 'B4', .5),
     (6, 'A4', .44), (7, 'G4', .4)],
    [(0, 'A2', .56), (1, 'E3', .44), (2, 'C4', .46), (3, 'G4', .5), (4, 'E4', .44), (5, 'D4', .42), (6, 'C4', .4), (7, 'B3', .38)],
    [(0, 'D3', .56), (1, 'G#3', .46), (2, 'B3', .48), (3, 'E4', .5), (4, 'F#4', .48), (5, 'G#4', .52), (6, 'B4', .5), (7, 'E5', .46)],
]


def menu() -> tuple[dict, dict]:
    clk = Clock(60)
    L = 64.0
    span = 8.0
    main = Stem('menu_main', L, hall=0.32, seed='menu')
    # bass: low lamp drone + sub, very dark
    bass_chords = [[b] for b, _ in MENU_PROG]
    _drone_pad(main, bass_chords, span, 0.42, cutoff=(160.0, 420.0), attack=2.0, release=3.0, res_db=1.0, pans=[0.0])
    # pad
    _drone_pad(main, [p for _, p in MENU_PROG], span, 0.2, cutoff=(420.0, 1300.0), attack=2.2, release=3.0)
    # harp: arpeggios with a slight rubato drift inside each figure
    r = rng('menu-harp')
    for ci, fig in enumerate(MENU_HARP):
        for k, (b, p, v) in enumerate(fig):
            drift = 0.012 * k * (1 if ci % 2 == 0 else -0.5)
            main.add(ci * span + b * clk.beat + drift, 'harp', p, 4.5, v * 0.95, float(np.clip(-0.35 + midi(p) / 160 + r.uniform(-.15, .15), -.6, .6)),
                     rr=k % 4, bright=0.3)
    # bells: low D at the top of the loop, a softer A in the middle
    main.add(0.0, 'bell', 'D3', 9.0, 0.42, -0.1, human=False, decay_scale=1.2)
    main.add(32.0, 'bell', 'A3', 8.0, 0.32, 0.15, decay_scale=1.1)
    # the Lydian glow over E/D: glass G#5, B5, E6
    main.add(56.0, 'glass', 'B5', 4.5, 0.3, 0.35, decay_scale=1.4)
    main.add(57.5, 'glass', 'G#5', 4.5, 0.26, -0.3, decay_scale=1.4)
    main.add(59.0, 'glass', 'E6', 4.5, 0.24, 0.1, decay_scale=1.4)
    main.add(51.0, 'breath', None, 5.0, 0.12, 0.0, f_start=300, f_end=1600, q=1.6, shape='breath', peak_at=3.5)

    # layer 'glass' — 48 s: motif notes scattered, never the motif itself (no hook in the loop)
    gl = Stem('menu_glass', 48.0, hall=0.45, seed='menu-glass')
    glass_notes = [(3.0, 'E5', .34, -.5), (7.5, 'A5', .3, .45), (13.0, 'D5', .32, -.2), (14.6, 'B4', .26, .3),
                   (21.0, 'E6', .24, .6), (26.0, 'A4', .32, -.55), (29.5, 'E5', .3, .2), (33.0, 'B5', .26, -.4),
                   (38.0, 'D6', .22, .5), (41.5, 'A5', .28, -.1), (45.0, 'E5', .3, .35)]
    for t, p, v, pn in glass_notes:
        gl.add(t, 'glass', p, 6.0, v, pn, decay_scale=1.6, bright=0.9)

    # layer 'air' — 80 s: breath swells + faint FM shimmer + a high open fifth that never stops
    air = Stem('menu_air', 80.0, hall=0.5, seed='menu-air')
    for t, d, f0, f1 in ((0.0, 9.0, 260, 900), (22.0, 8.0, 400, 1400), (41.0, 10.0, 300, 1100), (60.0, 9.0, 500, 1800)):
        air.add(t, 'breath', None, d, 0.16, 0.0, f_start=f0, f_end=f1, q=1.4, shape='breath', peak_at=d * 0.55)
    for t, p in ((12.0, 'A5'), (50.0, 'E6'), (70.0, 'D6')):
        air.add(t, 'fm', p, 4.0, 0.08, 0.0, decay_s=3.0, index_from=1.2, ratio=3.5)
    air.add(0.0, 'drone', 'A4', 80.0, 0.05, -0.2, human=False, cutoff=(500, 800), lfo_hz=0.025, attack=0, release=0, loop_len=80.0)
    air.add(0.0, 'drone', 'E5', 80.0, 0.035, 0.25, human=False, cutoff=(600, 900), lfo_hz=0.0375, lfo_phase=0.5, attack=0,
            release=0, loop_len=80.0)
    stems = {'main': main.render(), 'glass': gl.render(), 'air': air.render()}
    for k in stems:
        stems[k] = fx.speech_dip(stems[k], -3.0, circular=True)
    return stems, {'bpm': 60, 'loop': L, 'layers': ['glass', 'air'], 'layerMode': 'ambient'}
