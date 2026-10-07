"""QA pictures with numpy + Pillow: log-frequency spectrogram + waveform tiles and contact sheets."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .core import SR, stereo

INK = (11, 13, 17)
PLATE = (23, 27, 34)
LINE = (61, 70, 86)
CHALK = (237, 230, 214)
TEXT2 = (171, 165, 151)
WARN = (246, 208, 77)
HARM = (255, 154, 31)
AZURE = (63, 156, 255)

# ink → indigo → orchid → marigold → chalk
_CMAP_STOPS = [(0.0, (11, 13, 17)), (0.25, (40, 36, 92)), (0.5, (128, 64, 150)), (0.72, (226, 110, 80)),
               (0.88, (255, 190, 70)), (1.0, (255, 248, 234))]


def _cmap() -> np.ndarray:
    xs = np.linspace(0, 1, 256)
    out = np.zeros((256, 3))
    for c in range(3):
        out[:, c] = np.interp(xs, [s[0] for s in _CMAP_STOPS], [s[1][c] for s in _CMAP_STOPS])
    return out.astype(np.uint8)


CMAP = _cmap()


def font(size: int = 12):
    try:
        return ImageFont.load_default(size=size)
    except Exception:  # pragma: no cover
        return ImageFont.load_default()


def spectrogram(x: np.ndarray, width: int, height: int, fmin: float = 30.0, fmax: float = 20000.0,
                floor_db: float = -96.0) -> np.ndarray:
    """RGB array (height, width, 3): log-frequency STFT magnitude in dBFS (full-scale sine = 0 dB)."""
    m = stereo(x).mean(axis=0)
    n = m.size
    frame = 2048 if n > SR * 2 else 1024
    hop = max(1, int(math.ceil(max(n - frame, 1) / max(width - 1, 1))))
    pad = np.pad(m, (frame // 2, frame // 2 + hop * width))
    win = np.hanning(frame)
    idx = np.arange(frame)[None, :] + hop * np.arange(width)[:, None]
    S = np.abs(np.fft.rfft(pad[idx] * win, axis=1)) * 2.0 / win.sum()
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    rows = np.geomspace(fmax, fmin, height)
    # each row takes the max over the bins it covers (high end) or interpolates (low end)
    edges = np.sqrt(rows[:-1] * rows[1:])
    edges = np.concatenate([[rows[0] * 1.03], edges, [rows[-1] * 0.97]])
    img = np.zeros((height, width))
    bin_of = lambda f: np.clip(np.searchsorted(freqs, f), 0, freqs.size - 1)
    for r in range(height):
        hi, lo = bin_of(edges[r]), bin_of(edges[r + 1])
        if hi > lo:
            img[r] = S[:, lo:hi + 1].max(axis=1)
        else:
            img[r] = S[:, lo]
    dbv = 20 * np.log10(img + 1e-12)
    v = np.clip((dbv - floor_db) / (-floor_db), 0, 1)
    return CMAP[(v * 255).astype(int)]


def waveform(x: np.ndarray, width: int, height: int, ceiling_db: float = -1.0) -> np.ndarray:
    xs = stereo(x)
    n = xs.shape[1]
    img = np.zeros((height, width, 3), np.uint8)
    img[:] = PLATE
    mid = height // 2
    edges = np.linspace(0, n, width + 1).astype(int)
    for c, col in ((0, (120, 170, 230)), (1, (240, 180, 120))):
        for i in range(width):
            seg = xs[c, edges[i]:max(edges[i + 1], edges[i] + 1)]
            lo, hi = float(seg.min()), float(seg.max())
            y0 = int(mid - hi * (mid - 1)); y1 = int(mid - lo * (mid - 1))
            y0, y1 = max(0, min(y0, height - 1)), max(0, min(y1, height - 1))
            blend = img[y0:y1 + 1, i].astype(int)
            img[y0:y1 + 1, i] = ((blend + np.array(col)) // 2).astype(np.uint8)
            if max(abs(lo), abs(hi)) >= 0.999:
                img[:3, i] = HARM
    ce = 10 ** (ceiling_db / 20)
    for yy in (int(mid - ce * (mid - 1)), int(mid + ce * (mid - 1))):
        img[max(0, yy), :: 4] = LINE
    img[mid, :] = LINE
    return img


def tile(x: np.ndarray, title: str, lines: list[str], width: int = 360, wave_h: int = 46, spec_h: int = 120,
         flags: list[str] | None = None) -> Image.Image:
    head = 34 + 14 * max(0, len(lines) - 1)
    im = Image.new('RGB', (width, head + wave_h + spec_h + 8), PLATE)
    d = ImageDraw.Draw(im)
    d.text((6, 4), title, fill=CHALK, font=font(13))
    for i, ln in enumerate(lines):
        d.text((6, 20 + 14 * i), ln, fill=TEXT2, font=font(11))
    if flags:
        d.text((width - 6 - 7 * len(' '.join(flags)), 4), ' '.join(flags), fill=WARN, font=font(11))
    im.paste(Image.fromarray(waveform(x, width - 8, wave_h)), (4, head))
    im.paste(Image.fromarray(spectrogram(x, width - 8, spec_h)), (4, head + wave_h + 2))
    return im


def sheet(tiles: list[Image.Image], title: str, cols: int = 4, pad: int = 8) -> Image.Image:
    if not tiles:
        tiles = [Image.new('RGB', (360, 60), PLATE)]
    tw = max(t.width for t in tiles); th = max(t.height for t in tiles)
    rows = int(math.ceil(len(tiles) / cols))
    W = cols * tw + (cols + 1) * pad
    H = 40 + rows * th + (rows + 1) * pad
    im = Image.new('RGB', (W, H), INK)
    d = ImageDraw.Draw(im)
    d.text((pad, 10), title, fill=CHALK, font=font(18))
    d.text((W - 330, 14), 'spectrogram 30 Hz–20 kHz log · −96…0 dBFS', fill=TEXT2, font=font(11))
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        im.paste(t, (pad + c * (tw + pad), 40 + pad + r * (th + pad)))
    return im
