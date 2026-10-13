"""Small music-theory helpers for composing in code: chords as pitch-class sets, nearest-pitch voice
leading (so inner voices move by step and common tones hold), melody snapping and the MODE CHECK
that keeps every score inside D Dorian + the Lydian G# (the bible's audio rule).

Allowed pitch classes
  D Dorian        D E F G A B C   (2 4 5 7 9 11 0)
  Lydian colour   G#              (8)
  Bright resolve  F#              (6)  ONLY where the motif resolves bright (RIFT, victory, the
                                       purchase/level fanfares) — `check_mode(..., bright=True)`
"""
from __future__ import annotations

import itertools

from .core import midi

DORIAN_PCS = {2, 4, 5, 7, 9, 11, 0}
COLOUR_PCS = DORIAN_PCS | {8}
BRIGHT_PCS = COLOUR_PCS | {6}

_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def name_of(m: float) -> str:
    m = int(round(m))
    return f'{_NAMES[m % 12]}{m // 12 - 1}'


def pc(note) -> int:
    return int(round(midi(note))) % 12


def pcs(notes) -> set[int]:
    return {pc(n) for n in notes}


# chord = list of pitch-class names (root first). Voicing happens in voice_lead().
CHORDS: dict[str, list[str]] = {
    'Dm9': ['D', 'F', 'A', 'C', 'E'], 'Dm7': ['D', 'F', 'A', 'C'], 'Dm': ['D', 'F', 'A'], 'Dm(add9)': ['D', 'F', 'A', 'E'],
    'Dsus2': ['D', 'E', 'A'], 'Dsus4': ['D', 'G', 'A'], 'Dm11': ['D', 'F', 'A', 'C', 'G'], 'D6': ['D', 'F', 'A', 'B'],
    'D': ['D', 'F#', 'A'],
    'Em7': ['E', 'G', 'B', 'D'], 'Em9': ['E', 'G', 'B', 'D', 'F'], 'Em': ['E', 'G', 'B'],
    'Fmaj7': ['F', 'A', 'C', 'E'], 'Fmaj9': ['F', 'A', 'C', 'E', 'G'], 'F': ['F', 'A', 'C'], 'F6': ['F', 'A', 'C', 'D'],
    'G': ['G', 'B', 'D'], 'G6': ['G', 'B', 'D', 'E'], 'G6/9': ['G', 'B', 'D', 'E', 'A'], 'Gmaj7': ['G', 'B', 'D', 'F#'],
    'Gadd9': ['G', 'B', 'D', 'A'], 'Gsus2': ['G', 'A', 'D'], 'G7': ['G', 'B', 'D', 'F'], 'Gmaj9': ['G', 'B', 'D', 'F#', 'A'],
    'Am7': ['A', 'C', 'E', 'G'], 'Am9': ['A', 'C', 'E', 'G', 'B'], 'Am': ['A', 'C', 'E'], 'Asus4': ['A', 'D', 'E'],
    'Bm7': ['B', 'D', 'F#', 'A'], 'Bm': ['B', 'D', 'F#'], 'Bm7b5': ['B', 'D', 'F', 'A'], 'Bm9': ['B', 'D', 'F#', 'A', 'C'],
    'Cmaj7': ['C', 'E', 'G', 'B'], 'Cmaj9': ['C', 'E', 'G', 'B', 'D'], 'C': ['C', 'E', 'G'], 'C6/9': ['C', 'E', 'G', 'A', 'D'],
    'Csus2': ['C', 'D', 'G'],
    # the Lydian glow: E major over D (E7/D), G# is the colour tone
    'E/D': ['D', 'E', 'G#', 'B'], 'E7/D': ['D', 'E', 'G#', 'B'], 'Dmaj7#11': ['D', 'F#', 'A', 'C', 'G#'],
    'Esus/G#': ['E', 'G#', 'B', 'D'],
    'DmAdd#11': ['D', 'F', 'A', 'G#'],
    'Dnoon': ['D', 'A', 'E', 'F#', 'G#'],     # the victory chord (tokens.audio.motif.victoryChord)
}


def chord_pcs(name: str) -> list[int]:
    return [pc(n + '4') for n in CHORDS[name]]


def voice_lead(prev: list[float] | None, chord: str | list[str], n: int | None = None, centre: float = 60.0,
               lo: float = 48.0, hi: float = 76.0, keep_bass: float | None = None) -> list[float]:
    """Choose MIDI pitches for `chord` (a name or pitch-class list) near `prev` with minimal motion.
    With no prev, a close voicing is built upward from `centre`-ish. n = voices (default: chord size,
    min 3). Returns the voicing sorted low→high. Notes outside [lo, hi] are avoided."""
    names = CHORDS[chord] if isinstance(chord, str) else list(chord)
    pcl = [pc(x + '4') if not x[-1].isdigit() else pc(x) for x in names]
    n = n or max(3, len(pcl))
    # pick which pitch classes to use when n < len: keep root, 3rd-ish, then colour
    chosen = pcl[:n] if n < len(pcl) else pcl
    if prev is None:
        base = centre - 6
        out = []
        cur = base
        for p in chosen:
            m = cur + ((p - cur) % 12)
            out.append(m)
            cur = m + 1
        return sorted(out)
    # candidates per target pc across the register
    best, best_cost = None, 1e18
    cands = []
    for p in chosen:
        cands.append([m for m in range(int(lo), int(hi) + 1) if m % 12 == p])
    prev_sorted = sorted(prev)
    # assign pitch classes to previous voices via permutations (n <= 6)
    voices = prev_sorted[:len(chosen)] if len(prev_sorted) >= len(chosen) else prev_sorted + [centre] * (len(chosen) - len(prev_sorted))
    for perm in itertools.permutations(range(len(chosen))):
        cost = 0.0
        pick = []
        for v, ci in enumerate(perm):
            m = min(cands[ci], key=lambda x: abs(x - voices[v]))
            cost += abs(m - voices[v])
            pick.append(m)
        if len(set(pick)) < len(pick):
            cost += 50
        s = sorted(pick)
        # penalise voice crossings / huge spreads / minor-second clusters at the bottom
        cost += 0.4 * max(0, (s[-1] - s[0]) - 19)
        for a, b in zip(s[:-1], s[1:]):
            if b - a == 1:
                cost += 3.0
        if cost < best_cost:
            best, best_cost = s, cost
    return best  # type: ignore[return-value]


def lead_progression(names: list[str], n: int = 4, centre: float = 60.0, lo: float = 52.0, hi: float = 74.0) -> list[list[float]]:
    out: list[list[float]] = []
    prev = None
    for c in names:
        v = voice_lead(prev, c, n, centre, lo, hi)
        out.append(v)
        prev = v
    return out


def snap_to(note, allowed_pcs: set[int], prefer: int = 0) -> float:
    """Nearest pitch (by semitone, ties go `prefer` direction) whose pitch class is allowed."""
    m = round(midi(note))
    for d in range(0, 7):
        for s in ((d, -d) if prefer >= 0 else (-d, d)):
            if (m + s) % 12 in allowed_pcs:
                return float(m + s)
    return float(m)


def check_mode(notes, allowed: set[int] = COLOUR_PCS, label: str = '') -> list[str]:
    """Return a list of violations (empty = in mode). notes: iterable of pitches."""
    bad = []
    for n in notes:
        if pc(n) not in allowed:
            bad.append(f'{label}{name_of(midi(n))}')
    return bad
