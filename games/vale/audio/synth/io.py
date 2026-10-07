"""WAV writing (48 kHz, 24-bit PCM or float), ffmpeg OGG Vorbis encoding and decoding for QA."""
from __future__ import annotations

import os
import subprocess
import wave

import numpy as np

from .core import SR, stereo


def write_wav(path: str, x: np.ndarray, bits: int = 24) -> None:
    """Write a stereo 48 kHz PCM WAV (24-bit by default, TPDF-dithered when 16-bit)."""
    xs = stereo(np.asarray(x, float))
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    if bits == 16:
        r = np.random.default_rng(1)
        d = (r.random(xs.shape) - r.random(xs.shape)) / 32768.0
        q = np.clip(np.round((xs + d) * 32767.0), -32768, 32767).astype('<i2')
        data = q.T.tobytes()
        width = 2
    else:
        q = np.clip(np.round(xs * 8388607.0), -8388608, 8388607).astype('<i4')
        b = q.T.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3]
        data = b.tobytes()
        width = 3
    with wave.open(path, 'wb') as w:
        w.setnchannels(xs.shape[0])
        w.setsampwidth(width)
        w.setframerate(SR)
        w.writeframes(data)


def encode_ogg(wav_path: str, ogg_path: str, quality: float) -> None:
    """ffmpeg → OGG Vorbis at the given -q:a (5 music, 4 sfx). Metadata stripped, bit-exact length."""
    os.makedirs(os.path.dirname(ogg_path) or '.', exist_ok=True)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav_path,
           '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', str(quality), '-ar', str(SR),
           '-fflags', '+bitexact', '-flags:a', '+bitexact', ogg_path]
    subprocess.run(cmd, check=True)


def decode(path: str) -> np.ndarray:
    """Decode any file with ffmpeg to float (2, n) at 48 kHz."""
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    a = np.frombuffer(raw, dtype='<f4').astype(np.float64)
    return a.reshape(-1, 2).T.copy()


def ffprobe_duration(path: str) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path],
                         check=True, capture_output=True, text=True).stdout.strip()
    return float(out)
