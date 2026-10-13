"""Shared composing helpers for the VALE beds (menu, draft, match x3, postgame) and stings."""
from __future__ import annotations

import numpy as np

from . import fx
from .core import SR, hz, midi, ns, rng
from .score import Clock, Stem, merge_voice
from .theory import BRIGHT_PCS, COLOUR_PCS, check_mode, name_of, pc

# The motif (tokens.audio.motif): A4 E5 D5 B4 with beats 1 1 ½ 1½, then the ending note for two beats
MOTIF = [('A4', 1.0), ('E5', 1.0), ('D5', 0.5), ('B4', 1.5)]
ENDINGS = {'rift': 'F#5', 'victory': 'F#5', 'bridge': 'G4', 'fray': 'G#4', 'defeat': 'B4'}


def motif(stem: Stem, t0: float, beat: float, ending: str | None = None, voice: str = 'glass', vel: float = 0.5,
          pan: float = 0.0, end_beats: float = 2.0, transpose: int = 0, ring: float = 3.0, end_vel: float | None = None,
          end_ring: float | None = None, bus: str | None = None, **kw) -> float:
    """Place the motif at t0 (seconds) on `voice`; returns the time after the ending note."""
    t = t0
    for note, b in MOTIF:
        stem.add(t, voice, midi(note) + transpose, ring, vel, pan, bus=bus, **kw)
        t += b * beat
    if ending:
        stem.add(t, voice, midi(ending) + transpose, end_ring or (ring + end_beats * beat), end_vel or vel * 1.05, pan, bus=bus, **kw)
        t += end_beats * beat
    return t


def pad_chords(stem: Stem, voicings: list[list[float]], spans: list[float] | float, vel: float,
               cutoff=(380.0, 1100.0), lfo_hz: float = 0.047, attack: float = 1.6, release: float = 2.6,
               res_db: float = 2.0, pans=None, octave_shift: int = 0, loop: bool = True, offset: float = 0.0,
               bus: str | None = None, overlap: float = 0.35, sub: float = 0.0) -> None:
    """Sustained lamp-drone voices following a voice-led chord list (common tones are held; notes
    overlap the next chord by `overlap`×attack so the harmony crossfades). voicings: per chord, MIDI
    pitches (same count per chord)."""
    voices = merge_voice(voicings, spans, circular=loop)
    nv = len(voices)
    pans = pans or [(-0.45 + 0.9 * i / max(1, nv - 1)) for i in range(nv)]
    for v, notes in enumerate(voices):
        for pitch, start, dur in notes:
            p = float(pitch) + 12 * octave_shift
            t0 = offset + start
            stem.add(t0 - attack * overlap, 'drone', p, dur + release * 0.6 + attack * overlap, vel, pans[v], human=False,
                     bus=bus, cutoff=cutoff, lfo_hz=lfo_hz, lfo_phase=(lfo_hz * t0) % 1.0, attack=attack, release=release,
                     res_db=res_db, sub=sub)


def bass_line(stem: Stem, notes: list[tuple[float, float, str | float]], vel: float, cutoff=(150.0, 420.0), attack: float = 0.9,
              release: float = 1.6, sub: float = 0.25, pan: float = 0.0, bus: str | None = 'bass', res_db: float = 1.0,
              lfo_hz: float = 0.04) -> None:
    """notes: [(start_s, dur_s, pitch)] — lamp drone bass with a sine sub."""
    for t0, dur, p in notes:
        stem.add(t0 - attack * 0.3, 'drone', p, dur + release * 0.6 + attack * 0.3, vel, pan, human=False, bus=bus,
                 cutoff=cutoff, lfo_hz=lfo_hz, lfo_phase=(lfo_hz * t0) % 1.0, attack=attack, release=release, res_db=res_db, sub=sub)


def harp_figure(stem: Stem, t0: float, beat: float, pool: list[float], beats: list[float], idxs: list[int], vels: list[float],
                dur: float = 3.0, pan_of=None, bright: float = 0.35, rr0: int = 0, drift: float = 0.0, bus: str | None = None,
                human: bool | float = True, **kw) -> None:
    """A plucked figure: note k sounds at t0 + beats[k]*beat with pitch pool[idxs[k] % len(pool)]."""
    for k, (b, ix, v) in enumerate(zip(beats, idxs, vels)):
        p = pool[ix % len(pool)]
        pn = pan_of(p) if pan_of else float(np.clip(-0.4 + (midi(p) - 48) / 70, -0.6, 0.6))
        stem.add(t0 + b * beat + drift * k, 'harp', p, dur, v, pn, rr=(rr0 + k) % 4, bright=bright, bus=bus, human=human, **kw)


def pitch_pool(voicing: list[float], bass: float, lo: float = 50, hi: float = 83) -> list[float]:
    """Chord tones across the harp's range: the voicing and its octave copies, plus the bass note,
    sorted low→high and limited to [lo, hi]."""
    s = set()
    for m in list(voicing) + [bass + 12, bass + 24]:
        for o in (-24, -12, 0, 12, 24):
            if lo <= m + o <= hi:
                s.add(float(m + o))
    return sorted(s)


def mode_report(stem: Stem, allowed=COLOUR_PCS, extra_ok: set[int] | None = None) -> list[str]:
    """Pitch-class violations of the stem's pitched notes against the mode (QA)."""
    ok = set(allowed) | (extra_ok or set())
    bad = []
    for n in stem.notes:
        if n.pitch is None or n.voice in ('drum', 'esc', 'breath'):
            continue
        if pc(n.pitch) not in ok:
            bad.append(f'{n.voice}:{name_of(midi(n.pitch))}@{n.t:.1f}s')
    return bad


def ens(depth_ms: float = 2.2, rate: float = 0.21, mix: float = 0.5, seed: str = 'ens'):
    """A chorus insert for pads (width and slow movement)."""
    return lambda x, loop: fx.chorus(x, depth_ms=depth_ms, rate_hz=rate, base_ms=14.0, voices=3, mix=mix, circular=loop, seed=seed)


def eq_insert(*bands):
    return lambda x, loop: fx.eq(x, list(bands), circular=loop)


def sat_insert(drive: float = 1.6, mix: float = 0.25, asym: float = 0.0):
    return lambda x, loop: fx.saturate(x, drive, mix, asym)
