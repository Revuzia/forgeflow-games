"""Oscillators: sine/additive, FM, band-limited saw/square (PolyBLEP), mip-mapped wavetables, noise."""
from __future__ import annotations

import numpy as np

from .core import SR, TAU


def phase_of(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    """Phase in cycles for a constant or per-sample frequency (Hz)."""
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    ph = np.cumsum(f) / SR
    return ph - f[0] / SR + phase0


def sine(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    return np.sin(TAU * phase_of(freq, n, phase0))


def additive(f0: float, partials, n: int, r: np.random.Generator | None = None) -> np.ndarray:
    """partials: iterable of (ratio, amp, t60_s, detune_hz). Each partial is a detuned pair
    (degenerate modes beating at detune_hz), decaying exponentially. Partials above Nyquist drop."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for i, p in enumerate(partials):
        ratio, amp, t60 = p[0], p[1], p[2]
        det = p[3] if len(p) > 3 else 0.0
        f = f0 * ratio
        if f >= SR * 0.47 or amp == 0:
            continue
        env = np.exp(-6.9078 * t / max(t60, 1e-3))
        ph = r.uniform(0, 1, 2) if r is not None else np.array([0.0, 0.25])
        if det:
            out += amp * env * 0.5 * (np.sin(TAU * ((f - det / 2) * t + ph[0])) + np.sin(TAU * ((f + det / 2) * t + ph[1])))
        else:
            out += amp * env * np.sin(TAU * (f * t + ph[0]))
    return out


def fm(fc, ratio: float, index, n: int, fb: float = 0.0, phase0: float = 0.0) -> np.ndarray:
    """2-operator FM (phase modulation). fc constant or per-sample; index constant or per-sample.
    fb > 0 adds a little modulator self-feedback approximation (sin of sin)."""
    pc = phase_of(fc, n, phase0)
    pm = phase_of(np.asarray(fc, float) * ratio, n)
    idx = np.broadcast_to(np.asarray(index, float), (n,))
    mod = np.sin(TAU * pm)
    if fb:
        mod = np.sin(TAU * pm + fb * mod)
    return np.sin(TAU * pc + idx * mod)


def _polyblep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """PolyBLEP residual for phase t in [0,1) with increment dt."""
    y = np.zeros_like(t)
    m1 = t < dt
    x = t[m1] / dt[m1]
    y[m1] = x + x - x * x - 1.0
    m2 = t > 1.0 - dt
    x = (t[m2] - 1.0) / dt[m2]
    y[m2] = x * x + x + x + 1.0
    return y


def saw(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    """Band-limited sawtooth (PolyBLEP), −1…1."""
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    dt = np.abs(f) / SR
    t = np.mod(phase_of(f, n, phase0), 1.0)
    return 2.0 * t - 1.0 - _polyblep(t, dt)


def square(freq, n: int, pw: float = 0.5, phase0: float = 0.0) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    dt = np.abs(f) / SR
    t = np.mod(phase_of(f, n, phase0), 1.0)
    y = np.where(t < pw, 1.0, -1.0)
    y += _polyblep(t, dt)
    y -= _polyblep(np.mod(t + 1.0 - pw, 1.0), dt)
    return y


def triangle(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    """Band-limited triangle by integrating the PolyBLEP square (leaky, DC-free)."""
    sq = square(freq, n, 0.5, phase0)
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    y = np.cumsum(sq * 4.0 * f / SR)
    y -= np.convolve(y, np.ones(4801) / 4801, mode='same')   # remove drift
    return np.clip(y, -1.5, 1.5)


class Wavetable:
    """A single-cycle table, mip-mapped per octave by truncating harmonics so nothing aliases."""

    def __init__(self, harmonics: np.ndarray, size: int = 2048):
        self.size = size
        self.harm = np.asarray(harmonics, complex)       # complex amplitude per harmonic 1..K
        self.mips: dict[int, np.ndarray] = {}

    @staticmethod
    def from_amps(amps, phases=None, size: int = 2048) -> 'Wavetable':
        amps = np.asarray(amps, float)
        ph = np.zeros_like(amps) if phases is None else np.asarray(phases, float)
        return Wavetable(amps * np.exp(1j * ph), size)

    def table(self, max_harm: int) -> np.ndarray:
        k = int(max(1, min(max_harm, self.harm.size)))
        if k not in self.mips:
            spec = np.zeros(self.size // 2 + 1, complex)
            spec[1:k + 1] = self.harm[:k] * (self.size / 2) / 1j
            self.mips[k] = np.fft.irfft(spec, n=self.size)
        return self.mips[k]

    def render(self, freq, n: int, phase0: float = 0.0) -> np.ndarray:
        f = np.broadcast_to(np.asarray(freq, float), (n,))
        fmax = float(np.max(np.abs(f))) or 1.0
        tab = self.table(int(SR * 0.45 / fmax))
        ph = np.mod(phase_of(f, n, phase0), 1.0) * self.size
        i0 = np.floor(ph).astype(int)
        fr = ph - i0
        return tab[i0 % self.size] * (1 - fr) + tab[(i0 + 1) % self.size] * fr


# ── noise ────────────────────────────────────────────────────────────────────────────────────────
def white(n: int, r: np.random.Generator) -> np.ndarray:
    return r.standard_normal(n) * 0.5


def coloured(n: int, r: np.random.Generator, slope_db_oct: float = -3.0, ch: int = 1) -> np.ndarray:
    """Noise with a spectral slope (−3 dB/oct pink, −6 brown, +3 blue), unit-ish RMS.
    Generated in the frequency domain, so it is periodic: it loops seamlessly at length n."""
    shape = (ch, n) if ch > 1 else (n,)
    w = r.standard_normal(shape)
    W = np.fft.rfft(w, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    g[1:] = (f[1:] / 1000.0) ** (slope_db_oct / 6.0206)
    g[0] = 0.0
    y = np.fft.irfft(W * g, n=n, axis=-1)
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-12) * 0.25


def pink(n: int, r: np.random.Generator, ch: int = 1) -> np.ndarray:
    return coloured(n, r, -3.0, ch)
