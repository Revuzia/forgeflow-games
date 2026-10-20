"""VALE Wicks: the lane minions (small lamp-bearers that walk the roads). Thin driver over the per-kind modules.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wicks.py -- [--faction legacy|aubade|serenade|both|all] [--ids shieldwick,...] [--fast]

The code lives in one module per kind, so four builders can work in parallel:
  wick_common.py       the Wick spec base, faction palettes, legacy body, helpers, the runner
  wick_shieldwick.py   melee   1.1 m   round shield (left arm) + short lamp-mace
  wick_glimwick.py     caster  1.0 m   long pole with a hanging lamp
  wick_greatwick.py    siege   1.5 m   broad back-lantern on a frame + heavy hammer
  wick_brightwick.py   super   1.7 m   pauldrons, crown-lamp ring on the hood, two-hand lamp staff
Every wick: a deep hood with no face (lamplight inside the hood is the accent, tinted per viewer), a heavy
cloak, small boots and one carried lamp that names the job; VALE_BIPED_1 at minion proportions with the
standard clips (the renderer plays idle, run, attack1, death). Brief: _design/units/wicks.md.

This driver's DEFAULT is `--faction legacy`: it rebuilds today's four GLBs (art/out/units/<kind>.glb, the content
`art.model`) from the frozen legacy geometry: same meshes, rig and clips as the pre-split wicks.py (checked
2026-10-20: shieldwick and brightwick rebuild byte-identical; glimwick and greatwick differ only in baked
normal/ORM texels, which also differ between two runs of the old script). Each wick_<kind>.py
(default `--faction both`) builds the faction GLBs <kind>_aubade / <kind>_serenade; `art/build.py units` runs
every units/*.py, so it builds both (wick_common.py is a library and does nothing when run). Pass
`--faction both` here to build all eight faction GLBs in one Blender session. When the faction models ship and
content switches to `art.teamModels`, flip this default (or retire the legacy builds).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wick_common as wc  # noqa: E402
from wick_brightwick import Brightwick  # noqa: E402
from wick_glimwick import Glimwick  # noqa: E402
from wick_greatwick import Greatwick  # noqa: E402
from wick_shieldwick import Shieldwick  # noqa: E402

KINDS = [Shieldwick, Glimwick, Greatwick, Brightwick]


def main() -> None:
    wc.run(KINDS, default_faction=wc.LEGACY)


if __name__ == "__main__":
    main()
