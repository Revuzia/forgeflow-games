"""Envelopes: ADSR, multi-stage breakpoint envelopes with curves, exponential decays, swells."""
from __future__ import annotations

import numpy as np

from .core import SR


def _seg(n: int, a: float, b: float, curve: float) -> np.ndarray:
    """n samples from a to b. curve 0 = linear, >0 = fast start (exp-like), <0 = slow start."""
    if n <= 0:
        return np.zeros(0)
    x = np.linspace(0.0, 1.0, n, endpoint=False)
    if curve:
        x = (1.0 - np.exp(-curve * x)) / (1.0 - np.exp(-curve))
    return a + (b - a) * x


def stages(points, n: int | None = None) -> np.ndarray:
    """Multi-stage envelope. points = [(t_s, level, curve), …] — first t must be 0. The last level
    holds until n (if n is longer than the last point)."""
    out = []
    for (t0, l0, _), (t1, l1, c1) in zip(points[:-1], points[1:]):
        out.append(_seg(int(round((t1 - t0) * SR)), l0, l1, c1))
    env = np.concatenate(out) if out else np.zeros(0)
    if n is not None:
        if env.size < n:
            env = np.concatenate([env, np.full(n - env.size, points[-1][1])])
        env = env[:n]
    return env


def adsr(n: int, a: float, d: float, s: float, r: float, gate: float | None = None,
         curve_a: float = -1.5, curve_d: float = 4.0, curve_r: float = 4.0) -> np.ndarray:
    """ADSR. gate = seconds the note is held (default: until n minus the release)."""
    total = n / SR
    gate = max(a, total - r) if gate is None else gate
    pts = [(0.0, 0.0, 0.0), (a, 1.0, curve_a)]
    if gate > a:
        pts.append((min(gate, a + d), s if gate >= a + d else 1.0 - (1.0 - s) * (gate - a) / max(d, 1e-6), curve_d))
        if gate > a + d:
            pts.append((gate, s, 0.0))
    end_level = pts[-1][1]
    pts.append((pts[-1][0] + r, 0.0, curve_r))
    env = stages(pts, n)
    if env.size and pts[-1][0] * SR < n:
        env[int(pts[-1][0] * SR):] = 0.0
    del end_level
    return env


def decay(n: int, t60: float, attack: float = 0.002) -> np.ndarray:
    """Percussive: short linear-ish attack then exponential decay to −60 dB at t60."""
    t = np.arange(n) / SR
    env = np.exp(-6.9078 * t / max(t60, 1e-4))
    k = max(1, int(attack * SR))
    if k > 1:
        env[:k] *= np.sin(0.5 * np.pi * np.arange(k) / k)
    return env


def swell(n: int, peak_at: float, rise_curve: float = -2.5, release: float = 0.05) -> np.ndarray:
    """Reverse-breath swell: slow-start rise to 1 at peak_at seconds, then a quick release."""
    k = int(peak_at * SR)
    up = _seg(k, 0.0, 1.0, rise_curve)
    down = _seg(int(release * SR), 1.0, 0.0, 3.0)
    env = np.concatenate([up, down])
    return np.pad(env, (0, max(0, n - env.size)))[:n]


def lfo(n: int, rate_hz: float, depth: float = 1.0, phase: float = 0.0, offset: float = 0.0) -> np.ndarray:
    t = np.arange(n) / SR
    return offset + depth * np.sin(2 * np.pi * (rate_hz * t + phase))
