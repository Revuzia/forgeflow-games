"""The maps' rooms (max SFX-9): one short impulse response per map, which src/audio/index.ts loads into a single shared
ConvolverNode for the match ('room.<map id>' in content/audio.json events → the cue whose file is the IR). Every spatial
sfx voice sends into it, more the farther it is (near -20 dB, at the edge of hearing -11 dB), so a fight across the
lane sits in the map's air instead of the same dry studio everywhere; UI, the announcer and music stay dry.

    room_rift     a stone gorge: firm early reflections off the cliff walls (to 60 ms), a 0.9 s tail darker at the top
    room_bridge   an open span over the drop: few, late reflections and a long thin tail (1.25 s), no low end in it
    room_fray     lantern streets: dense close reflections off the house fronts (to 40 ms), a short warm tail (0.7 s)

Synthesised (synth.fx.shaped_ir: decorrelated noise with a frequency-dependent decay, sparse early reflections, a
pre-delay), levelled here; the engine's ConvolverNode normalises the response's energy itself.
"""
from __future__ import annotations

from cuelib import cue
from synth import fx

ROOMK = dict(tail_floor_db=-72.0, fade_out=0.06)


@cue('room_rift', 'match', ('m', -16.0), (0.5, 1.4), **ROOMK)
def room_rift(v: int):
    return fx.shaped_ir('vale_room_rift', 0.95, 0.55, predelay_ms=18.0, er_ms=60.0, er_count=16, hp_hz=140.0,
                        lp_hz=8000.0, width_=0.9, length_s=1.1)


@cue('room_bridge', 'match', ('m', -16.0), (0.6, 1.6), **ROOMK)
def room_bridge(v: int):
    return fx.shaped_ir('vale_room_bridge', 1.25, 0.9, predelay_ms=26.0, er_ms=90.0, er_count=6, hp_hz=380.0,
                        lp_hz=9000.0, width_=1.0, length_s=1.4)


@cue('room_fray', 'match', ('m', -16.0), (0.4, 1.1), **ROOMK)
def room_fray(v: int):
    return fx.shaped_ir('vale_room_fray', 0.75, 0.4, predelay_ms=14.0, er_ms=40.0, er_count=22, hp_hz=120.0,
                        lp_hz=6000.0, width_=0.85, length_s=0.85)
