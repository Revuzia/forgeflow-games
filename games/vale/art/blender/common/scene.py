"""Scene plumbing: reset, units, determinism, collections, paths, timers, args.

Conventions (CONTRACT §2): Blender Z-up, 1 unit = 1 m, models face -Y (front view), feet at the
origin. The glTF exporter maps Blender (x, y, z) -> three (x, z, -y), so -Y arrives as +Z.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import zlib
from contextlib import contextmanager

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
ART_DIR = os.path.dirname(BLENDER_DIR)
GAME_DIR = os.path.dirname(ART_DIR)
OUT_DIR = os.path.join(ART_DIR, "out")
RENDERS_DIR = os.path.join(ART_DIR, "renders")
CACHE_DIR = os.path.join(ART_DIR, ".cache")          # gitignored: .blend snapshots, bake scratch
CONTENT_DIR = os.path.join(GAME_DIR, "content")
TOOLS_DIR = os.path.join(ART_DIR, "tools")

FPS = 30

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ── arguments ────────────────────────────────────────────────────────────────────────────────────
def script_args() -> list[str]:
    """Arguments after `--` (same for `blender ... --python f.py -- a b` and `python3 f.py -- a b`)."""
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def parse_args(add=None, argv=None) -> argparse.Namespace:
    """Common flags for every build script; `add(parser)` adds script-specific ones."""
    p = argparse.ArgumentParser(prog=os.path.basename(sys.argv[0]) if sys.argv else "art")
    p.add_argument("--no-bake", action="store_true", help="skip texture baking (keep node materials)")
    p.add_argument("--no-render", action="store_true", help="skip portrait/splash/icon/turntable")
    p.add_argument("--no-optimize", action="store_true", help="skip the gltf-transform pass")
    p.add_argument("--fast", action="store_true", help="low samples everywhere (iteration mode)")
    p.add_argument("--only", default="", help="comma list of steps to run (model,bake,clips,export,render)")
    if add:
        add(p)
    return p.parse_args(script_args() if argv is None else argv)


# ── determinism ──────────────────────────────────────────────────────────────────────────────────
def seed_of(*parts) -> int:
    return zlib.crc32("|".join(str(p) for p in parts).encode("utf-8")) & 0xFFFFFFFF


def rng(*parts) -> random.Random:
    """A deterministic random stream named by `parts` (never use the global `random`)."""
    return random.Random(seed_of(*parts))


# ── colour ───────────────────────────────────────────────────────────────────────────────────────
def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str) -> tuple[float, float, float]:
    """'#rrggbb' -> linear RGB (what Blender colour sockets expect)."""
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))  # type: ignore


def hex_rgba(h: str, a: float = 1.0) -> tuple[float, float, float, float]:
    r, g, b = hex_rgb(h)
    return (r, g, b, a)


def hex_srgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore


# ── scene ────────────────────────────────────────────────────────────────────────────────────────
def reset(fps: int = FPS) -> bpy.types.Scene:
    """Empty factory scene, metric units, 30 fps, Cycles CPU, AgX. Idempotent builds start here."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "vale"
    us = sc.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    us.length_unit = "METERS"
    sc.render.fps = fps
    sc.render.fps_base = 1.0
    sc.frame_start = 0
    sc.frame_end = 60
    sc.frame_set(0)
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.seed = 0
    sc.cycles.use_animated_seed = False
    sc.render.threads_mode = "AUTO"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"
    sc.render.use_persistent_data = False
    return sc


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    """Get or create a collection linked under `parent` (default: the scene collection)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in parent.children:
        parent.children.link(col)
    return col


def link(obj: bpy.types.Object, col: bpy.types.Collection | None = None) -> bpy.types.Object:
    """Link `obj` into exactly `col` (unlinking from other collections)."""
    col = col or bpy.context.scene.collection
    for c in list(obj.users_collection):
        if c != col:
            c.objects.unlink(obj)
    if obj.name not in col.objects:
        col.objects.link(obj)
    return obj


def new_object(name: str, data, col: bpy.types.Collection | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, data)
    return link(obj, col)


def select_only(objs, active=None) -> None:
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    if active is not None:
        bpy.context.view_layer.objects.active = active
    elif objs:
        bpy.context.view_layer.objects.active = objs[0]


def set_mode(obj: bpy.types.Object, mode: str) -> None:
    if bpy.context.view_layer.objects.active != obj:
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.objects.active = obj
    if obj.mode != mode:
        bpy.ops.object.mode_set(mode=mode)


def delete(objs) -> None:
    for o in list(objs):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and getattr(data, "users", 1) == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)


def hide_render(objs, hide: bool = True) -> None:
    for o in objs:
        o.hide_render = hide
        o.hide_viewport = False


# ── paths / io ───────────────────────────────────────────────────────────────────────────────────
def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def rel(path: str) -> str:
    """Path relative to the game root, forward slashes (for logs and manifests)."""
    return os.path.relpath(path, GAME_DIR).replace("\\", "/")


def write_json(path: str, data) -> None:
    ensure_dir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, sort_keys=False)
        f.write("\n")


def read_json(path: str, default=None):
    if not os.path.isfile(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_blend(path: str) -> None:
    ensure_dir(os.path.dirname(path))
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, copy=True)


# ── timing / logging ─────────────────────────────────────────────────────────────────────────────
class Timer:
    """Collects named step durations: `with T.step('bake'): ...`; `T.report()` -> dict."""

    def __init__(self, tag: str = "art"):
        self.tag = tag
        self.t0 = time.perf_counter()
        self.steps: dict[str, float] = {}

    @contextmanager
    def step(self, name: str):
        t = time.perf_counter()
        log(f"{self.tag}: {name} ...")
        try:
            yield
        finally:
            dt = time.perf_counter() - t
            self.steps[name] = round(self.steps.get(name, 0.0) + dt, 2)
            log(f"{self.tag}: {name} done in {dt:.1f}s")

    def total(self) -> float:
        return round(time.perf_counter() - self.t0, 2)

    def report(self) -> dict:
        return {"steps_s": dict(self.steps), "total_s": self.total()}


def log(msg: str) -> None:
    print(f"[vale-art] {msg}", flush=True)


def deg(v) -> float:
    return math.radians(v)
