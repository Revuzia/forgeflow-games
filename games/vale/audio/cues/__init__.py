"""VALE cue recipes (lane AUDIO). Importing this package registers every non-music cue in
content/audio.json with cuelib.REGISTRY:

    ui.py      ui_*            glass and wood, short, in key
    combat.py  c_*             swings, shots, hits by damage type, casts, statuses, big moments
    match.py   m_* (non-music) match events, the enemy wind-up alarm, pings, announcer stingers
    fighters.py f_<fighter>_<slot> per-fighter cues (the passive procs) and the generic c_proc_* procs
    world.py   amb_* the maps' ambience loops (bus ambience; content binds ambient.<map>.<source>)

The stings on the music bus (m_victory_sting, m_defeat_sting, m_placement_sting) and the beds are
the music build's, not this package's.
"""
from . import ui  # noqa: F401
from . import combat  # noqa: F401
from . import match  # noqa: F401
from . import fighters  # noqa: F401
from . import world  # noqa: F401
