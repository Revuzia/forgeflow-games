"""A small score/sequencer for composing in code.

A `Stem` is a list of note events (seconds) for the eight voices, rendered into a stereo buffer.
Loop stems render with TAIL WRAP: anything that rings past the loop end is folded back onto the
start, and the stem's reverb send is convolved circularly, so the loop is seamless by construction.
Notes carry humanised timing (±8 ms) and velocity (±2 dB) from a seeded generator
(tokens.audio.humanise), and identical renders are cached (round-robin index is part of the key).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import fx
from . import instruments as I
from .core import SR, add_at, humanise_time, humanise_vel, hz, midi, ns, pan as pan_, rng, stereo, width

VOICES = {
    'glass': I.dawnglass, 'bell': I.hourbell, 'harp': I.dial_harp, 'drone': I.lamp_drone,
    'drum': I.frame_drum, 'esc': I.escapement, 'breath': I.shade_breath, 'fm': I.fm_shimmer,
}


@dataclass
class Note:
    t: float
    voice: str
    pitch: str | float | None = None
    dur: float = 2.0
    vel: float = 0.7
    pan: float = 0.0
    kw: dict = field(default_factory=dict)
    human: bool = True


class Clock:
    """Beat/bar arithmetic for a tempo in 4/4."""

    def __init__(self, bpm: float, beats_per_bar: int = 4):
        self.bpm = bpm
        self.bpb = beats_per_bar
        self.beat = 60.0 / bpm
        self.bar = self.beat * beats_per_bar

    def t(self, bar: float, beat: float = 0.0) -> float:
        """Time of (0-based bar, 0-based beat)."""
        return bar * self.bar + beat * self.beat


_CACHE: dict[tuple, np.ndarray] = {}


def _render_voice(n: Note, seed: str) -> np.ndarray:
    fn = VOICES[n.voice]
    kw = dict(n.kw)
    vq = round(n.vel, 1)                    # timbre follows velocity in 0.1 steps; level is exact
    if n.voice in ('glass', 'bell', 'harp', 'fm'):
        key = (n.voice, round(midi(n.pitch), 3), round(n.dur, 2), vq, seed, tuple(sorted((k, str(v)) for k, v in kw.items())))
        if key not in _CACHE:
            if n.voice == 'bell':
                _CACHE[key] = fn(hz(n.pitch), dur=n.dur, vel=max(vq, 0.05), seed=seed, **kw)
            else:
                _CACHE[key] = fn(hz(n.pitch), n.dur, max(vq, 0.05), seed=seed, **kw)
        sig = _CACHE[key] * (n.vel / max(vq, 0.05))
    elif n.voice == 'drone':
        sig = fn(hz(n.pitch), n.dur, n.vel, seed=seed, **kw)
    elif n.voice == 'drum':
        key = ('drum', n.pitch, n.vel, seed, tuple(sorted((k, str(v)) for k, v in kw.items())))
        if key not in _CACHE:
            f0 = hz(n.pitch) if n.pitch is not None else 110.0
            _CACHE[key] = fn(f0, max(round(n.vel, 2), 0.05), seed=seed, **kw)
        sig = _CACHE[key]
    elif n.voice == 'esc':
        key = ('esc', n.vel, seed, tuple(sorted((k, str(v)) for k, v in kw.items())))
        if key not in _CACHE:
            _CACHE[key] = fn(vel=n.vel, seed=seed, **kw)
        sig = _CACHE[key]
    elif n.voice == 'breath':
        sig = fn(n.dur, vel=n.vel, seed=seed, **kw)
    else:
        raise ValueError(n.voice)
    return sig


class Stem:
    def __init__(self, name: str, length_s: float, loop: bool = True, hall: float = 0.0, plate: float = 0.0,
                 seed: str | None = None, width_: float = 1.0):
        self.name = name
        self.length = length_s
        self.loop = loop
        self.notes: list[Note] = []
        self.hall = hall
        self.plate = plate
        self.seed = seed or name
        self.width = width_
        self.post = []        # callables (stereo, circular) -> stereo
        self._r = rng('stem:' + self.seed)

    def add(self, t: float, voice: str, pitch=None, dur: float = 2.0, vel: float = 0.7, pan: float = 0.0,
            human: bool = True, **kw) -> 'Stem':
        self.notes.append(Note(t, voice, pitch, dur, vel, pan, kw, human))
        return self

    def render(self, tail_s: float = 6.0) -> np.ndarray:
        n = ns(self.length) if self.loop else ns(self.length + tail_s)
        buf = np.zeros((2, n))
        r = self._r
        for i, note in enumerate(sorted(self.notes, key=lambda x: x.t)):
            t = note.t
            vel = note.vel
            if note.human:
                t += humanise_time(r, 8.0)
                vel *= humanise_vel(r, 2.0)
            seed = self.seed if note.voice not in ('breath', 'drone') else f'{self.seed}:{i}'
            sig = _render_voice(Note(t, note.voice, note.pitch, note.dur, vel, note.pan, note.kw), seed)
            sig = pan_(stereo(sig).mean(axis=0), note.pan) if note.voice in ('harp', 'esc', 'drum') else _balance(sig, note.pan)
            add_at(buf, sig, int(round(max(t, 0.0) * SR)) if not self.loop else int(round(t * SR)), wrap=self.loop)
        if self.width != 1.0:
            buf = width(buf, self.width)
        wet = np.zeros_like(buf)
        if self.hall:
            wet += fx.reverb(buf, fx.hall_ir(), wet=self.hall, dry=0.0, circular=self.loop, tail=False)
        if self.plate:
            wet += fx.reverb(buf, fx.plate_ir(), wet=self.plate, dry=0.0, circular=self.loop, tail=False)
        out = buf + wet
        for p in self.post:
            out = p(out, self.loop)
        return out


def _balance(sig: np.ndarray, p: float) -> np.ndarray:
    s = stereo(sig)
    if not p:
        return s
    a = (p + 1.0) * 0.25 * math.pi
    return np.vstack([s[0] * math.cos(a) * math.sqrt(2), s[1] * math.sin(a) * math.sqrt(2)])


def mix(*stems: np.ndarray) -> np.ndarray:
    n = max(s.shape[-1] for s in stems)
    out = np.zeros((2, n))
    for s in stems:
        out[:, :s.shape[-1]] += stereo(s)
    return out


def merge_voice(chords: list[list[str]], span: float, circular: bool = True) -> list[list[tuple[str, float, float]]]:
    """Turn a chord list (each chord = notes per voice, lasting `span` seconds) into sustained notes
    per voice: consecutive equal pitches merge into one note; with circular=True a note that ends
    the progression merges with an identical first note across the loop seam.
    Returns per-voice lists of (pitch, start_s, dur_s)."""
    nv = len(chords[0])
    out = []
    for v in range(nv):
        seq = [c[v] for c in chords]
        notes = []
        i = 0
        while i < len(seq):
            j = i
            while j + 1 < len(seq) and seq[j + 1] == seq[i]:
                j += 1
            notes.append([seq[i], i * span, (j - i + 1) * span])
            i = j + 1
        if circular and len(notes) > 1 and notes[0][0] == notes[-1][0]:
            last = notes.pop()
            notes[0] = [last[0], last[1], last[2] + notes[0][2]]
        out.append([tuple(x) for x in notes])
    return out
