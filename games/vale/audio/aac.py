"""AAC-LC .m4a sibling of every Ogg Opus file (CONTRACT §11 format fallback): browsers that cannot decode
Ogg Opus (Safari before 18.4) play the .m4a written next to each .ogg (audio/out/<x>.ogg → audio/out/<x>.m4a).

ffmpeg's native `aac` encoder: deterministic and available on every platform (AudioToolbox `aac_at` exists
only on macOS and is not reproducible), 48 kHz, MP4 (ipod brand, .m4a), metadata stripped, bitexact flags.

Gapless: AAC-LC prepends 1024 samples of encoder priming and pads the last 1024-sample frame. The MP4 edit
list says which samples are the sound (elst media_time = where it starts, segment_duration = its exact length,
in the 48 kHz track timescale). Measured with _harness/audio_probe.mjs: decodeAudioData in Chrome 155 (and
ffmpeg) honours both ends, so a .m4a decodes to its .ogg sibling's exact length and alignment; Safari 27
honours the start (alignment exact) and, for a loop or bed, the end too, but returns a one-shot rounded up to
whole 1024-sample frames from the trimmed start (e.g. ui_click 7628 → 8192 samples) — the extra samples are
the encoder's padding (digital silence in ffmpeg's decode, below −90 dBFS in Safari's), so nothing is audible.
MusicDef loopStart / loopEnd and looping cues therefore need no compensation in either format.

Lead-in: the encoder's rate control starts cold (the first ~0.3 s of a stream is coded far worse: a 60 ms UI
tick came out at 12 dB SNR instead of 40), so every encode is preceded by LEAD samples the edit list skips —
silence for a one-shot, for a loop the loop's own tail (wrap-around context, as encode_opus_loop does for
Opus), and a loop is also followed by TAIL samples of its head, so the codec's edges land in trimmed context
and never at the wrap.
"""
from __future__ import annotations

import os
import struct
import subprocess

import numpy as np

SR = 48000
LEAD = 16384           # ~0.34 s of trimmed lead-in before every encode (rate-control warm-up / wrap context)
TAIL = 2048            # trimmed wrap-around context after a loop (two AAC frames)


def m4a_path(ogg: str) -> str:
    """audio/out/<x>.ogg → audio/out/<x>.m4a"""
    return os.path.splitext(ogg)[0] + '.m4a'


def encode_m4a(x: np.ndarray, m4a: str, kbps: int, loop: bool = False) -> None:
    """x: (n,) mono or (ch, n) float at 48 kHz → AAC-LC .m4a at kbps (ABR) that decodes to x's exact length
    and alignment (a loop with wrap-around context, so its decoded wrap is seamless)."""
    xs = np.asarray(x, np.float64)
    xs = xs[None, :] if xs.ndim == 1 else xs
    ch, n = xs.shape
    if loop:
        reps = 1 + -(-max(LEAD, TAIL) // n)
        tiled = np.tile(xs, (1, reps))
        y = np.concatenate([tiled[:, -LEAD:], xs, tiled[:, :TAIL]], axis=1)
    else:
        y = np.concatenate([np.zeros((ch, LEAD)), xs], axis=1)
    _encode(y, m4a, kbps)
    _trim(m4a, LEAD, n)


def encode_m4a_piece(x: np.ndarray, start: int, length: int, m4a: str, kbps: int) -> None:
    """One PIECE of a looping bed (the .m4a path decodes a long bed piece by piece, build_music.py `pieces`):
    samples [start, start + length) of the loop x (circular: the last piece's run-on wraps to the loop's head),
    encoded like a loop — the LEAD before it and TAIL after it are real neighbouring music the edit list trims —
    so the piece decodes to exactly `length` samples with the codec's edges in trimmed context."""
    xs = np.asarray(x, np.float64)
    xs = xs[None, :] if xs.ndim == 1 else xs
    y = np.take(xs, np.arange(start - LEAD, start + length + TAIL), axis=1, mode='wrap')
    _encode(y, m4a, kbps)
    _trim(m4a, LEAD, length)


def _encode(y: np.ndarray, m4a: str, kbps: int) -> None:
    """(ch, n) float at 48 kHz → AAC-LC .m4a (ABR kbps), untrimmed (the caller sets the edit list)"""
    ch = y.shape[0]
    os.makedirs(os.path.dirname(m4a) or '.', exist_ok=True)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
           '-map_metadata', '-1', '-c:a', 'aac', '-b:a', f'{kbps}k', '-ac', str(ch), '-ar', str(SR),
           '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', '-f', 'ipod', m4a]
    subprocess.run(cmd, input=np.ascontiguousarray(y.T, '<f4').tobytes(), check=True)


_CONTAINERS = {b'moov', b'trak', b'mdia', b'edts'}


def _boxes(d: bytes, off: int, end: int, out: list) -> list:
    while off + 8 <= end:
        size, typ = struct.unpack('>I4s', d[off:off + 8])
        hdr = 8
        if size == 1:
            size, hdr = struct.unpack('>Q', d[off + 8:off + 16])[0], 16
        elif size == 0:
            size = end - off
        if size < hdr:
            raise ValueError(f'bad MP4 box {typ!r} at {off}')
        out.append((typ, off + hdr))
        if typ in _CONTAINERS:
            _boxes(d, off + hdr, off + size, out)
        off += size
    return out


def _trim(path: str, trim: int, keep: int) -> None:
    """Rewrite the (single) edit: media_time += trim samples, segment_duration (and the mvhd / tkhd duration) =
    keep samples — the decoder then outputs exactly samples [trim, trim + keep) of what was encoded."""
    d = bytearray(open(path, 'rb').read())
    bx = _boxes(bytes(d), 0, len(d), [])
    kinds = [t for t, _ in bx]
    if kinds.count(b'trak') != 1 or kinds.count(b'elst') != 1:
        raise ValueError(f'{path}: expected one track with one edit list, got {kinds}')
    at = {t: b for t, b in bx}

    def timescale(box: bytes) -> int:
        o = at[box] + (20 if d[at[box]] else 12)          # after version/flags + creation/modification times
        return struct.unpack('>I', d[o:o + 4])[0]
    mts, tts = timescale(b'mvhd'), timescale(b'mdhd')
    if tts != SR:
        raise ValueError(f'{path}: track timescale {tts}, want {SR}')
    b = at[b'elst']
    v = d[b]
    if struct.unpack('>I', d[b + 4:b + 8])[0] != 1:
        raise ValueError(f'{path}: expected a single edit')
    fmt = '>Qq' if v else '>Ii'
    w = struct.calcsize(fmt)
    seg, media = struct.unpack(fmt, d[b + 8:b + 8 + w])
    if keep * mts % SR:
        raise ValueError(f'{path}: {keep} samples are not a whole number of movie ticks ({mts} Hz)')
    seg = keep * mts // SR
    d[b + 8:b + 8 + w] = struct.pack(fmt, seg, media + trim)
    for box, off32, off64 in ((b'mvhd', 16, 24), (b'tkhd', 20, 28)):
        o = at[box]
        if d[o]:
            d[o + off64:o + off64 + 8] = struct.pack('>Q', seg)
        else:
            d[o + off32:o + off32 + 4] = struct.pack('>I', seg)
    with open(path, 'wb') as f:
        f.write(bytes(d))
