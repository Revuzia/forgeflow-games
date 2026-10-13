"""A small score/sequencer for composing in code.

A `Stem` is a list of note events (seconds) for the eight voices, rendered into a stereo buffer.
Notes go to named BUSES (default: the voice name). Each bus has its own level, optional insert
effects, and its own hall / plate SEND, so a harp can sit nearly dry while a bell blooms in the hall
(tokens.audio.space: sends only, never inserts on the dry voices).

Loop stems render with TAIL WRAP: anything that rings past the loop end is folded back onto the
start, and the reverb sends are convolved circularly, so the loop is seamless by construction.
Notes carry humanised timing (±8 ms) and velocity (±2 dB) from a seeded generator
(tokens.audio.humanise), and identical renders are cached (the round-robin index is part of the key).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import fx
from . import instruments as I
from .core import SR, add_at, db, humanise_time, humanise_vel, hz, midi, ns, pan as pan_, rng, stereo, width

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
    human: bool | float = True       # True = default ±8 ms; a number = ±ms; False = exact
    bus: str | None = None


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
        stroke = kw.get('stroke', 'doum')
        key = ('drum', round(midi(n.pitch), 2) if n.pitch is not None else None, round(n.vel, 2), seed, tuple(sorted((k, str(v)) for k, v in kw.items())))
        if key not in _CACHE:
            f0 = hz(n.pitch) if n.pitch is not None else 110.0
            _CACHE[key] = fn(f0, max(round(n.vel, 2), 0.05), seed=seed, **kw)
        sig = _CACHE[key]
        del stroke
    elif n.voice == 'esc':
        key = ('esc', round(n.vel, 2), seed, tuple(sorted((k, str(v)) for k, v in kw.items())))
        if key not in _CACHE:
            _CACHE[key] = fn(vel=max(n.vel, 0.05), seed=seed, **kw)
        sig = _CACHE[key]
    elif n.voice == 'breath':
        sig = fn(n.dur, vel=n.vel, seed=seed, **kw)
    else:
        raise ValueError(n.voice)
    return sig


class Stem:
    """`sends` maps a bus name to (hall, plate) send levels (linear, applied to that bus's dry
    signal); buses not listed use the stem defaults hall= / plate=. `bus_db` trims a bus;
    `bus_fx` inserts effects `fn(stereo, circular) -> stereo` on a bus BEFORE its sends."""

    def __init__(self, name: str, length_s: float, loop: bool = True, hall: float = 0.0, plate: float = 0.0,
                 seed: str | None = None, width_: float = 1.0, sends: dict | None = None, bus_db: dict | None = None,
                 bus_fx: dict | None = None):
        self.name = name
        self.length = length_s
        self.loop = loop
        self.notes: list[Note] = []
        self.hall = hall
        self.plate = plate
        self.sends = sends or {}
        self.bus_db = bus_db or {}
        self.bus_fx = bus_fx or {}
        self.seed = seed or name
        self.width = width_
        self.post: list[Callable] = []        # callables (stereo, circular) -> stereo, on the summed output
        self.gain_points: list[tuple[float, float]] = []
        self._r = rng('stem:' + self.seed)

    def add(self, t: float, voice: str, pitch=None, dur: float = 2.0, vel: float = 0.7, pan: float = 0.0,
            human: bool | float = True, bus: str | None = None, **kw) -> 'Stem':
        self.notes.append(Note(t, voice, pitch, dur, vel, pan, kw, human, bus))
        return self

    def automate(self, points: list[tuple[float, float]]) -> 'Stem':
        """Output level automation: [(t_s, dB), …], linearly interpolated in dB (wraps on loops)."""
        self.gain_points = sorted(points)
        return self

    def render(self, tail_s: float = 6.0) -> np.ndarray:
        n = ns(self.length) if self.loop else ns(self.length + tail_s)
        dry: dict[str, np.ndarray] = {}
        r = self._r
        for i, note in enumerate(sorted(self.notes, key=lambda x: x.t)):
            t = note.t
            vel = note.vel
            if note.human:
                ms = 8.0 if note.human is True else float(note.human)
                t += humanise_time(r, ms)
                vel *= humanise_vel(r, 2.0)
            seed = self.seed if note.voice not in ('breath', 'drone') else f'{self.seed}:{i}'
            sig = _render_voice(Note(t, note.voice, note.pitch, note.dur, vel, note.pan, note.kw), seed)
            if note.voice in ('harp', 'esc', 'drum'):
                sig = pan_(stereo(sig).mean(axis=0), note.pan)
            else:
                sig = _balance(sig, note.pan)
            key = note.bus or note.voice
            if key not in dry:
                dry[key] = np.zeros((2, n))
            add_at(dry[key], sig, int(round(max(t, 0.0) * SR)) if not self.loop else int(round(t * SR)), wrap=self.loop)
        out = np.zeros((2, n))
        hall_in = np.zeros((2, n)) if (self.hall or any(s[0] for s in self.sends.values())) else None
        plate_in = np.zeros((2, n)) if (self.plate or any(s[1] for s in self.sends.values())) else None
        for key, buf in dry.items():
            for f in self.bus_fx.get(key, []):
                buf = f(buf, self.loop)
            if key in self.bus_db:
                buf = buf * db(self.bus_db[key])
            out += buf
            h, p = self.sends.get(key, (self.hall, self.plate))
            if h and hall_in is not None:
                hall_in += buf * h
            if p and plate_in is not None:
                plate_in += buf * p
        if self.width != 1.0:
            out = width(out, self.width)
        if hall_in is not None:
            out += fx.reverb(hall_in, fx.hall_ir(), wet=1.0, dry=0.0, circular=self.loop, tail=False)
        if plate_in is not None:
            out += fx.reverb(plate_in, fx.plate_ir(), wet=1.0, dry=0.0, circular=self.loop, tail=False)
        if self.gain_points:
            out = out * _gain_curve(self.gain_points, n, self.length, self.loop)[None, :]
        for p in self.post:
            out = p(out, self.loop)
        return out


def _gain_curve(points: list[tuple[float, float]], n: int, length: float, loop: bool) -> np.ndarray:
    ts = np.array([p[0] for p in points], float)
    gs = np.array([p[1] for p in points], float)
    t = np.arange(n) / SR
    if loop:
        ts = np.concatenate([ts - length, ts, ts + length])
        gs = np.concatenate([gs, gs, gs])
    # smooth (cosine) interpolation between points
    idx = np.clip(np.searchsorted(ts, t) - 1, 0, len(ts) - 2)
    u = np.clip((t - ts[idx]) / np.maximum(ts[idx + 1] - ts[idx], 1e-9), 0, 1)
    u = 0.5 - 0.5 * np.cos(np.pi * u)
    g = gs[idx] + (gs[idx + 1] - gs[idx]) * u
    return 10 ** (g / 20.0)


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


def merge_voice(chords: list[list], span: float | list[float], circular: bool = True) -> list[list[tuple]]:
    """Turn a chord list (each chord = notes per voice) into sustained notes per voice: consecutive
    equal pitches merge into one note; with circular=True a note that ends the progression merges
    with an identical first note across the loop seam. `span` is each chord's length in seconds
    (one number, or one per chord). Returns per-voice lists of (pitch, start_s, dur_s)."""
    nv = min(len(c) for c in chords)
    spans = [span] * len(chords) if isinstance(span, (int, float)) else list(span)
    starts = np.concatenate([[0.0], np.cumsum(spans)])
    out = []
    for v in range(nv):
        seq = [c[v] for c in chords]
        notes = []
        i = 0
        while i < len(seq):
            j = i
            while j + 1 < len(seq) and seq[j + 1] == seq[i]:
                j += 1
            notes.append([seq[i], float(starts[i]), float(starts[j + 1] - starts[i])])
            i = j + 1
        if circular and len(notes) > 1 and notes[0][0] == notes[-1][0]:
            last = notes.pop()
            notes[0] = [last[0], last[1], last[2] + notes[0][2]]
        out.append([tuple(x) for x in notes])
    return out
