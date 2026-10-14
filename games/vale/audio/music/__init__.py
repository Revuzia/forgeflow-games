"""VALE music registry (lane AUDIO, music only).

Every bed in content/audio.json `music` and every cue on the `music` bus maps to its composition here.
Entries are "module:function" strings, imported on demand, so `build_music.py --only mus_draft` never
renders (or even imports) the other beds.

  bed   fn() -> ({'main': stereo, '<layer id>': stereo, …}, meta)   loops, mastered by bedlib.master_bed
  sting fn() -> stereo                                              one-shots, mastered to the sting target
"""
from __future__ import annotations

import importlib
from dataclasses import dataclass

import bedlib

BEDS: dict[str, tuple[str, str]] = {
    'mus_menu':         ('synth.music_menu:build', '60 BPM, 96 s, 12 chords x 8 s, no hook, 1-4 kHz dip'),
    'mus_draft':        ('synth.music_draft:build', '90 BPM, 136 s: bans drone -> picks harp pulse -> finalise drums -> release'),
    'mus_match_rift':   ('synth.music_match:build_rift', '120 BPM, 160 s + intense layer; bright, driving; motif -> F#5'),
    'mus_match_bridge': ('synth.music_match:build_bridge', '120 BPM, 160 s + intense layer; tense, D pedal; motif -> G4'),
    'mus_match_fray':   ('synth.music_match:build_fray', '120 BPM, 160 s + intense layer; festive, Lydian G#; motif -> G#4'),
    'mus_postgame':     ('synth.music_postgame:build', '60 BPM, 80 s; bell chorale, the motif once, ending home on D5'),
}


@dataclass
class StingSpec:
    id: str
    ref: str
    target_st: float          # max short-term LUFS of the asset (tokens.audio.loudness.stingsShortTermLUFS)
    dur: tuple[float, float]  # allowed length window (s)
    notes: str = ''


STINGS: dict[str, StingSpec] = {s.id: s for s in (
    StingSpec('m_victory_sting', 'synth.music_stings:victory', -16.0, (5.5, 7.5),
              'motif -> F#5 over the noon chord D A E F# G#, 6 s (tokens.audio.stings.victory)'),
    StingSpec('m_defeat_sting', 'synth.music_stings:defeat', -16.0, (3.6, 5.0),
              'motif, B4 held over Dsus2, 4 s; the -4 LU is the cue gain 0.63 (tokens.audio.stings.defeat)'),
    StingSpec('m_placement_sting', 'synth.music_stings:placement', -16.0, (4.5, 6.5),
              'FRAY: the first bell, motif -> G#4 over E/D, truncated noon chord (no F#)'),
)}
# not in audio.json: the 1st-place cut of the FRAY sting (full noon chord). Rendered next to the others so
# content can wire it per place (tokens.audio.stings.frayPlacement) without a new render.
EXTRA_STINGS: dict[str, StingSpec] = {s.id: s for s in (
    StingSpec('m_placement_sting_first', 'synth.music_stings:placement_first', -16.0, (4.5, 7.0),
              'FRAY 1st place: the full noon chord D A E F# G#'),
)}


def resolve(ref: str):
    mod, fn = ref.split(':')
    return getattr(importlib.import_module(mod), fn)


def register_beds() -> None:
    for bid, (ref, notes) in BEDS.items():
        if bid not in bedlib.REGISTRY:
            bedlib.REGISTRY[bid] = bedlib.BedSpec(bid, (lambda r=ref: resolve(r)()), notes=notes)


register_beds()
