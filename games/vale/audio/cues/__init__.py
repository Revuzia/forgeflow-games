"""VALE cue recipes (lane AUDIO). Importing this package registers every non-music cue in
content/audio.json with cuelib.REGISTRY:

    ui.py      ui_*            glass and wood, short, in key
    combat.py  c_*             swings, shots, hits by damage type, casts, statuses, big moments
    match.py   m_* (non-music) match events, the enemy wind-up alarm, pings, announcer stingers
    fighters.py f_<fighter>_passive (the passive procs) and the generic c_proc_* procs
    kits_a.py  f_<fighter>_<slot> the whole per-fighter kits, first half (ardit … lisvel)
    kits_b.py  f_<fighter>_<slot> the whole per-fighter kits, second half (marund … vashil)
    kits_c.py  f_<fighter>_hit / _dash (ability impacts, dashes) and the identity pass (contact, voicing) over the kits
    world.py   amb_* the maps' ambience loops (bus ambience; content lists them in audio.ambience.<map>)
    areas.py   f_<fighter>_<slot>_land / _zone: a kitted fighter's own area landings and zone loops (closing AUD-C1)
    epic.py    u_<unit>_<slot>: the epic objectives' kits (Longshade, Sunsplinter) and c_monster_fall (closing AUD-C3)

The stings on the music bus (m_victory_sting, m_defeat_sting, m_placement_sting) and the beds are
the music build's, not this package's.
"""
from . import ui  # noqa: F401
from . import combat  # noqa: F401
from . import match  # noqa: F401
from . import fighters  # noqa: F401
from . import kits_a  # noqa: F401
from . import kits_b  # noqa: F401
from . import kits_c  # noqa: F401  (after kits_a / kits_b: it wraps their identity cues)
from . import world  # noqa: F401
from . import areas  # noqa: F401  (after world: it uses its periodic blocks)
from . import epic  # noqa: F401
