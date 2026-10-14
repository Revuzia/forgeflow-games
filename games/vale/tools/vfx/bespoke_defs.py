"""Every bespoke VFX def (<fighter>_<slot>_*): one module per fighter in tools/vfx/bespoke/<fighter>.py,
each exposing defs() -> list. Collected here for tools/vfx/build_vfx.py."""
from __future__ import annotations

import importlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def defs() -> list:
    out = []
    for f in sorted((HERE / "bespoke").glob("*.py")):
        if f.name.startswith("_"):
            continue
        out += importlib.import_module(f"bespoke.{f.stem}").defs()
    return out
