#!/usr/bin/env python3
"""VALE cue build (lane AUDIO): render every non-music cue in content/audio.json from its recipe
(audio/cues/*.py) → master (cuelib.master: DC block, tail trim, loudness match, soft clip, true-peak
limit) → Ogg Opus 48 kHz (tokens.audio.format.primary: opus) at the exact path the contract names
(assets/audio/<x> → audio/out/<x>), then decode that file and QA what the game will actually play. Every
.ogg also gets its AAC-LC .m4a sibling (audio/out/<x>.m4a, aac.py: the CONTRACT §11 fallback for browsers
that cannot decode Ogg Opus), encoded from the same master and QA'd from its own decode.

    python3 build.py                     # every non-music cue
    python3 build.py --only ui_click,c_crit
    python3 build.py --list              # the recipe for each cue id
    python3 build.py --sheet sheet.png   # also write a waveform + spectrogram contact sheet
    python3 build.py -j 1                # serial (default: one worker per core, max 8)

Music beds and cues on the `music` bus (the stings) belong to the music build and are skipped.
A centre-only cue is written mono (WebAudio plays it at unity in both speakers; panning is then true
equal-power). Loops are encoded with wrap-around context trimmed by the Ogg pre-skip / end granule, so
the decoded loop is sample-exact and seamless (encode_opus_loop).

Exit 1 if any non-music cue in audio.json has no recipe, or a rendered cue fails QA:
  loudness   decoded measurement more than 1 LU (1 dB for peak targets) from the recipe's target
  true peak  decoded OGG above -1.0 dBTP (tokens.audio.loudness.truePeakDbtp)
  duration   outside the recipe's window
  limiter    gain reduction above the recipe's budget (a sound pushed so far it loses its transient)
  edges      a click at the start or end (first sample / last 2 ms above -50 dBFS), DC above -54 dBFS
  loop seam  (loops) a burst of >6 kHz energy across the wrap (codec splatter or a step)
  m4a        the .m4a decode: M4A-LEN not sample-exact to the .ogg's, M4A-LOUD more than 1 LU (dB) from the .ogg's
             measurement, M4A-TP above -1.0 dBTP, M4A-SEAM a loop seam burst as above
Contract gates (every build, over the shipped files in audio/out; `--gates` runs only these):
  control    every loss-of-control StatusKind (the sim's CC_<KIND> flags in src/sim/entity.ts, plus slow) is bound
             ('status.<kind>') to its OWN cue that no other status kind shares (c_buff voices buffs only), and
             there is no catch-all 'status' role; each control cue lands (its 10 ms RMS envelope within 6 dB of its
             peak by CC_ONSET_MS) and sits >= CC_MIN_DIST_DB from every other control cue and every buff cue by
             1/3-octave spectral distance (ear-level identity, not just a different file name)
Deterministic: every random choice is seeded from the cue id (synth.core.rng) and ffmpeg runs
bitexact, so a rebuild reproduces the same files.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
# ffmpeg / ffprobe are called by name: make a Homebrew install findable when the shell PATH lacks it
if not __import__('shutil').which('ffmpeg'):
    for _d in ('/opt/homebrew/bin', '/usr/local/bin'):
        if os.path.exists(os.path.join(_d, 'ffmpeg')):
            os.environ['PATH'] = _d + os.pathsep + os.environ.get('PATH', '')
            break

import numpy as np  # noqa: E402

import cues  # noqa: E402,F401  (side effect: registers every recipe in cuelib.REGISTRY)
from cuelib import CEILING_DBTP, REGISTRY, measure, master  # noqa: E402
import aac  # noqa: E402
from synth import loudness as L  # noqa: E402
from synth.core import SR, stereo  # noqa: E402

CONTRACT = os.path.normpath(os.path.join(HERE, '..', 'content', 'audio.json'))
SRC = os.path.normpath(os.path.join(HERE, '..', 'src'))
OUT = os.path.join(HERE, 'out')
WORK = os.path.join(HERE, '_work', 'cues')
BITRATE = {1: '96k', 2: '128k'}    # libopus VBR targets per channel count: transparent for SFX
AAC_KBPS = {1: 96, 2: 128}         # AAC-LC ABR targets for the .m4a siblings, per channel count
LEAD_S = 0.005                     # one-shots start with 5 ms of digital silence: the codec's pre-echo
                                   # then ramps in instead of stepping at sample 0 (5 ms < a 60 fps frame)
TP_MAX = -1.0
TOL_LU = 1.0


def load_contract() -> dict:
    with open(CONTRACT, encoding='utf8') as f:
        return json.load(f)


def out_path(ref: str) -> str:
    """assets/audio/<x> → audio/out/<x> (the content build's mapping)."""
    if not ref.startswith('assets/audio/'):
        raise ValueError(f'unexpected audio ref {ref!r}')
    return os.path.join(OUT, ref[len('assets/audio/'):])


def wanted(contract: dict) -> dict[str, dict]:
    return {k: c for k, c in contract['cues'].items() if c.get('bus') != 'music'}


# ── QA metrics ───────────────────────────────────────────────────────────────────────────────────
def band_share(x: np.ndarray, lo: float = 2000.0, hi: float = 5000.0) -> float:
    """Fraction of the signal's power in lo..hi Hz (the band that tires ears on repeated cues)."""
    m = stereo(x).mean(axis=0)
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    tot = P[f > 20].sum() + 1e-20
    return float(P[(f >= lo) & (f < hi)].sum() / tot)


def edge_levels(x: np.ndarray) -> tuple[float, float]:
    xs = stereo(x)
    first = float(np.max(np.abs(xs[:, 0])))
    last = float(np.max(np.abs(xs[:, -ns_(0.002):])))
    return db_(first), db_(last)


def seam_ratio(x: np.ndarray) -> float:
    """Loop seam: >6 kHz energy in 2 ms windows across the wrap, over the loop's median window. A clean
    seam is ~1; codec splatter or a step shows as a burst (a sparse crackle in the loop can reach a few)."""
    from synth import filters as F
    xs = stereo(x)
    n = xs.shape[1]
    y = np.concatenate([xs, xs], axis=1)
    e = np.sum(F.apply(y, [F.highpass(6000, 0.7), F.highpass(6000, 0.7)]) ** 2, axis=0)
    w = ns_(0.002)
    ew = e[: (e.size // w) * w].reshape(-1, w).sum(axis=1)
    s = n // w
    return float(np.max(ew[s - 3:s + 3]) / (np.median(ew) + 1e-20))


def ns_(s: float) -> int:
    return int(round(s * SR))


def db_(v: float) -> float:
    return 20 * math.log10(v) if v > 1e-12 else -240.0


# ── one cue ──────────────────────────────────────────────────────────────────────────────────────
def render(cid: str, files: list[str]) -> list[dict]:
    spec = REGISTRY[cid]
    rows = []
    for i, ref in enumerate(files):
        t0 = time.time()
        raw = spec.fn(i % max(1, spec.variants))
        ceiling = CEILING_DBTP
        for attempt in range(4):
            y, info = master(raw, spec, ceiling)
            if 'error' in info:
                rows.append(dict(id=cid, file=ref, error=info['error']))
                break
            if not spec.loop:
                y = np.pad(y, ((0, 0), (ns_(LEAD_S), 0)))
            side = 0.5 * (y[0] - y[1])
            mid = 0.5 * (y[0] + y[1])
            is_mono = float(np.sqrt(np.mean(side ** 2))) < 0.005 * float(np.sqrt(np.mean(mid ** 2)) + 1e-12)
            data = mid if is_mono else y
            name = os.path.splitext(os.path.basename(ref))[0]
            wav = os.path.join(WORK, f'{name}.wav')
            ogg = out_path(ref)
            if spec.loop:
                encode_opus_loop(data, wav, ogg, 1 if is_mono else 2)
            else:
                _write(wav, data)
                encode_opus(wav, ogg, 1 if is_mono else 2)
            dec = decode(ogg)
            tp = L.true_peak(dec, circular=spec.loop)
            if tp <= TP_MAX or attempt == 3:
                break
            ceiling -= (tp - TP_MAX) + 0.3        # codec overshoot: master again under a lower ceiling
        if 'error' in info:
            continue
        # the .m4a sibling, from the same final master
        ch = 1 if is_mono else 2
        m4a = aac.m4a_path(ogg)
        aac.encode_m4a(data, m4a, AAC_KBPS[ch], loop=spec.loop)
        dm = decode(m4a)
        kind, tgt = spec.target
        got = measure(dec, kind, spec.loop)
        dur = dec.shape[1] / SR
        first, last = edge_levels(dec)
        dc = db_(L.dc_offset(dec))
        row = dict(id=cid, file=ref, cat=spec.cat, kind=kind, target=tgt, got=float(got), tp=float(tp), gr=float(info['limiter_gr_db']),
                   dur=dur, ch=1 if is_mono else 2, harsh=band_share(dec), first=first, last=last, dc=dc,
                   kb=os.path.getsize(ogg) / 1024, secs=time.time() - t0, ceiling=ceiling)
        flags = []
        tol = TOL_LU
        if not abs(got - tgt) <= tol:
            flags.append(f'LOUD{got - tgt:+.1f}')
        if tp > TP_MAX:
            flags.append('TP')
        lo, hi = spec.dur
        if not lo <= dur <= hi:
            flags.append(f'DUR[{lo:g}-{hi:g}]')
        if row['gr'] > spec.max_gr_db:
            flags.append('GR')
        if not spec.loop and (first > -50 or last > -50):
            flags.append('EDGE')
        if dc > -54:
            flags.append('DC')
        if spec.loop:
            row['seam'] = seam_ratio(dec)
            if row['seam'] > 6.0:
                flags.append('SEAM')
        row.update(m4a_kb=os.path.getsize(m4a) / 1024, m4a_got=float(measure(dm, kind, spec.loop)),
                   m4a_tp=float(L.true_peak(dm, circular=spec.loop)), m4a_len=int(dm.shape[1]))
        if row['m4a_len'] != dec.shape[1]:
            flags.append(f"M4A-LEN{row['m4a_len'] - dec.shape[1]:+d}")
        if not abs(row['m4a_got'] - got) <= tol:          # parity with the .ogg (which answers to the target)
            flags.append(f"M4A-LOUD{row['m4a_got'] - got:+.1f}")
        if row['m4a_tp'] > TP_MAX:
            flags.append('M4A-TP')
        if spec.loop:
            row['m4a_seam'] = seam_ratio(dm)
            if row['m4a_seam'] > 6.0:
                flags.append('M4A-SEAM')
        row['flags'] = flags
        rows.append(row)
    return rows


def encode_opus(wav: str, ogg: str, ch: int) -> None:
    """ffmpeg libopus → Ogg (.ogg). Opus runs at 48 kHz natively; the Ogg pre-skip and end granule
    keep the decoded length sample-exact. 10 ms frames halve the pre-echo window of 20 ms ones (cue
    attacks are sharp). Metadata stripped, bitexact flags for reproducible files."""
    import subprocess
    os.makedirs(os.path.dirname(ogg), exist_ok=True)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-map_metadata', '-1',
           '-c:a', 'libopus', '-b:a', BITRATE[ch], '-vbr', 'on', '-application', 'audio', '-compression_level', '10',
           '-frame_duration', '10',
           '-ac', str(ch), '-ar', str(SR), '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', ogg]
    subprocess.run(cmd, check=True)


LOOP_CTX = 1920                    # 40 ms of wrap-around context either side of an encoded loop


def _ogg_crc(page: bytes) -> int:
    """Ogg page CRC-32 (poly 0x04C11DB7, no reflection, init 0), computed with the CRC field zeroed."""
    tab = _ogg_crc.tab
    if tab is None:
        tab = _ogg_crc.tab = []
        for i in range(256):
            r = i << 24
            for _ in range(8):
                r = ((r << 1) ^ 0x04C11DB7) if r & 0x80000000 else (r << 1)
            tab.append(r & 0xFFFFFFFF)
    crc = 0
    for b in page:
        crc = ((crc << 8) ^ tab[((crc >> 24) ^ b) & 0xFF]) & 0xFFFFFFFF
    return crc


_ogg_crc.tab = None


def _ogg_pages(data: bytes) -> list[tuple[int, int]]:
    """(offset, length) of every Ogg page."""
    out, i = [], 0
    while i < len(data):
        if data[i:i + 4] != b'OggS':
            raise ValueError('not an Ogg page boundary')
        nseg = data[i + 26]
        body = sum(data[i + 27:i + 27 + nseg])
        n = 27 + nseg + body
        out.append((i, n))
        i += n
    return out


def encode_opus_loop(x: np.ndarray, wav: str, ogg: str, ch: int) -> None:
    """Seamless Ogg Opus loop. Encoding a loop on its own makes the codec see a hard onset at the start
    and a cut at the end (audible splatter at the wrap). So the encoder gets LOOP_CTX samples of the
    loop's own tail before it and of its head after it, and the Ogg stream is told to drop them again:
    OpusHead pre-skip += LOOP_CTX (start) and the final granule position -= LOOP_CTX (end), the two
    trims RFC 7845 defines. Decoders then output exactly the loop, with the codec's edges inside the
    discarded context."""
    k = LOOP_CTX
    xs = x[None, :] if x.ndim == 1 else x
    _write(wav, np.concatenate([xs[:, -k:], xs, xs[:, :k]], axis=1))
    encode_opus(wav, ogg, ch)
    data = bytearray(open(ogg, 'rb').read())
    pages = _ogg_pages(bytes(data))
    off, n = pages[0]
    seg0 = 27 + data[off + 26]
    head = off + seg0
    if bytes(data[head:head + 8]) != b'OpusHead':
        raise ValueError('first Ogg page is not OpusHead')
    pre = int.from_bytes(data[head + 10:head + 12], 'little') + k
    data[head + 10:head + 12] = pre.to_bytes(2, 'little')
    loff, ln = pages[-1]
    gran = int.from_bytes(data[loff + 6:loff + 14], 'little') - k
    data[loff + 6:loff + 14] = gran.to_bytes(8, 'little')
    for po, pn in {pages[0], pages[-1]}:
        data[po + 22:po + 26] = b'\0\0\0\0'
        data[po + 22:po + 26] = _ogg_crc(bytes(data[po:po + pn])).to_bytes(4, 'little')
    with open(ogg, 'wb') as f:
        f.write(bytes(data))


def decode(path: str) -> np.ndarray:
    """Decode as the browser does: a mono file plays at unity in both speakers (WebAudio up-mix), not
    at ffmpeg's -3 dB centre mix, so mono is decoded as one channel and duplicated."""
    import subprocess
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels',
                            '-of', 'default=nk=1:nw=1', path], check=True, capture_output=True, text=True).stdout.strip()
    ch = int(probe or 2)
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch),
                          '-ar', str(SR), '-'], check=True, capture_output=True).stdout
    a = np.frombuffer(raw, dtype='<f4').astype(np.float64).reshape(-1, ch).T
    return np.vstack([a[0], a[0]]) if ch == 1 else a.copy()


def _write(path: str, data: np.ndarray) -> None:
    """24-bit WAV, mono when the cue is centre-only (smaller file, true equal-power panning)."""
    import wave
    os.makedirs(os.path.dirname(path), exist_ok=True)
    xs = data[None, :] if data.ndim == 1 else data
    q = np.clip(np.round(xs * 8388607.0), -8388608, 8388607).astype('<i4')
    b = q.T.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3]
    with wave.open(path, 'wb') as w:
        w.setnchannels(xs.shape[0])
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b.tobytes())


def _work(args):
    cid, files = args
    try:
        return render(cid, files)
    except Exception as e:  # report, keep building the rest
        import traceback
        return [dict(id=cid, file=files[0] if files else '', error=f'{type(e).__name__}: {e}', tb=traceback.format_exc())]


# ── contract gates ───────────────────────────────────────────────────────────────────────────────
CC_ONSET_MS = 60.0       # a control cue lands: its 10 ms RMS envelope reaches -6 dB of its peak by then
CC_MIN_DIST_DB = 6.0     # 1/3-octave distance between any two control cues, and from every buff cue


def status_kinds() -> list[str]:
    """The contract's StatusKind enum (src/contracts/catalog.ts)."""
    with open(os.path.join(SRC, 'contracts', 'catalog.ts'), encoding='utf8') as f:
        m = re.search(r'export const StatusKind = z\.enum\(\[([^\]]+)\]\)', f.read())
    return re.findall(r"'([a-z_]+)'", m.group(1)) if m else []


def control_kinds() -> list[str]:
    """Loss of control: the sim's CC_<KIND> flags (src/sim/entity.ts; not the CC_HARD mask), plus slow."""
    with open(os.path.join(SRC, 'sim', 'entity.ts'), encoding='utf8') as f:
        kinds = [k.lower() for k in re.findall(r'\bCC_([A-Z]+)\s*=\s*\d', f.read())]
    return sorted(set(kinds)) + ['slow']


def onset_ms(x: np.ndarray) -> float:
    """Time from the file's start (its 5 ms codec lead included) until the 10 ms RMS envelope first comes within
    6 dB of its maximum."""
    m = stereo(x).mean(axis=0) ** 2
    w = ns_(0.01)
    env = np.sqrt(np.convolve(m, np.ones(w) / w, mode='same'))
    i = int(np.argmax(env >= np.max(env) * 0.5012))
    return i / SR * 1000.0


def third_octave_db(x: np.ndarray) -> np.ndarray:
    """The cue's 1/3-octave band levels (25 Hz .. 16 kHz), power-normalised so loudness does not count."""
    m = stereo(x).mean(axis=0)
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    centres = 1000.0 * 2.0 ** (np.arange(-16, 13) / 3.0)
    bands = np.array([P[(f >= c * 2 ** (-1 / 6)) & (f < c * 2 ** (1 / 6))].sum() for c in centres])
    bands = bands / (bands.sum() + 1e-30)
    return 10 * np.log10(np.maximum(bands, 1e-9))


def band_distance(a: np.ndarray, b: np.ndarray) -> float:
    """RMS dB difference over the bands where either cue has energy (within 50 dB of its strongest band)."""
    keep = (a > a.max() - 50) | (b > b.max() - 50)
    a_, b_ = np.maximum(a, a.max() - 50), np.maximum(b, b.max() - 50)
    return float(np.sqrt(np.mean((a_[keep] - b_[keep]) ** 2)))


def contract_gates(contract: dict) -> tuple[list[str], dict]:
    """The control gate (see the module doc); returns (failures, report)."""
    fails: list[str] = []
    ev = contract.get('events', {})
    cues = contract['cues']
    kinds = status_kinds()
    ctrl = [k for k in control_kinds() if k in kinds]
    if 'status' in ev:
        fails.append(f"control: events.status = {ev['status']!r} is a catch-all: a control or a debuff would play a buff's sound")
    bound = {k: ev.get(f'status.{k}') for k in kinds}
    users: dict[str, list[str]] = {}
    for k, c in bound.items():
        if c:
            users.setdefault(c, []).append(k)
    for k in ctrl:
        c = bound[k]
        if not c or c not in cues:
            fails.append(f'control: status.{k} has no cue (bound {c!r})')
        elif len(users[c]) > 1:
            fails.append(f"control: status.{k} shares {c} with {', '.join(x for x in users[c] if x != k)}")
    buff_cues = sorted({c for k, c in bound.items() if c and k not in ctrl and c in cues})
    spec: dict[str, np.ndarray] = {}
    rep: dict = {'controlKinds': ctrl, 'bound': bound, 'buffCues': buff_cues, 'onsetMs': {}, 'nearest': {}}
    for c in sorted({bound[k] for k in ctrl if bound[k] in cues} | set(buff_cues)):
        path = out_path(cues[c]['files'][0])
        if not os.path.exists(path):
            fails.append(f'control: {c} is not rendered ({path})')
            continue
        x = decode(path)
        spec[c] = third_octave_db(x)
        rep['onsetMs'][c] = round(onset_ms(x), 1)
    for k in ctrl:
        c = bound[k]
        if c not in spec:
            continue
        if rep['onsetMs'][c] > CC_ONSET_MS:
            fails.append(f'control: {c} ({k}) takes {rep["onsetMs"][c]:.0f} ms to land (> {CC_ONSET_MS:.0f} ms)')
        others = [(band_distance(spec[c], spec[o]), o) for o in spec if o != c]
        d, o = min(others) if others else (float('inf'), '')
        rep['nearest'][c] = [o, round(d, 2)]
        if d < CC_MIN_DIST_DB:
            fails.append(f'control: {c} ({k}) is {d:.1f} dB from {o} by 1/3-octave distance (< {CC_MIN_DIST_DB:g} dB)')
    return fails, rep


# ── sheet ────────────────────────────────────────────────────────────────────────────────────────
def write_sheet(rows: list[dict], path: str) -> None:
    from synth import viz
    tiles = []
    for r in rows:
        if 'error' in r:
            continue
        x = decode(out_path(r['file']))
        lines = [f"{r['dur'] * 1000:.0f} ms  {r['kind']} {r['got']:.1f}/{r['target']:.0f}  tp {r['tp']:.1f}  gr {r['gr']:.1f}"]
        tiles.append(viz.tile(x, r['id'], lines, flags=r['flags']))
    viz.sheet(tiles, 'VALE cues', cols=6).save(path)


# ── main ─────────────────────────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--only', help='comma-separated cue ids')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--sheet', help='write a contact sheet PNG here')
    ap.add_argument('--json', help='write the QA rows as JSON here')
    ap.add_argument('-j', type=int, default=min(8, os.cpu_count() or 1))
    ap.add_argument('--gates', action='store_true', help='run only the contract gates over the shipped files')
    a = ap.parse_args(argv)

    contract = load_contract()
    want = wanted(contract)
    missing = sorted(set(want) - set(REGISTRY))
    extra = sorted(set(REGISTRY) - set(want))
    if a.list:
        for cid in sorted(want):
            spec = REGISTRY.get(cid)
            doc = (spec.fn.__doc__ or '').strip().split('\n')[0] if spec else '(NO RECIPE)'
            print(f'{cid:24s} {doc}')
        return 1 if missing else 0
    if missing:
        print(f'FAIL: {len(missing)} non-music cue(s) in audio.json have no recipe: {", ".join(missing)}')
        return 1
    if extra:
        print(f'note: recipes not in audio.json (not rendered): {", ".join(extra)}')
    if a.gates:
        gfails, grep_ = contract_gates(contract)
        print_gates(gfails, grep_)
        if a.json:
            with open(a.json, 'w', encoding='utf8') as f:
                json.dump({'gates': grep_, 'gateFailures': gfails}, f, indent=1)
        return 1 if gfails else 0

    ids = sorted(want)
    if a.only:
        sel = [s.strip() for s in a.only.split(',') if s.strip()]
        bad = [s for s in sel if s not in want]
        if bad:
            print(f'unknown or music cue id(s): {", ".join(bad)}')
            return 2
        ids = sel
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    jobs = [(cid, want[cid]['files']) for cid in ids]
    t0 = time.time()
    rows: list[dict] = []
    if a.j <= 1 or len(jobs) == 1:
        for j in jobs:
            rows += _work(j)
    else:
        with cf.ProcessPoolExecutor(max_workers=a.j) as ex:
            for res in ex.map(_work, jobs):
                rows += res
    rows.sort(key=lambda r: ({'ui': 0, 'ping': 1, 'match': 2, 'voice': 3, 'combat': 4}.get(r.get('cat', ''), 5), r['id']))

    print(f"{'cue':24s} {'ms':>6s} {'tgt':>9s} {'got':>6s} {'dTP':>6s} {'GR':>5s} ch {'2-5k':>5s} {'kB':>5s} | m4a {'got':>6s} {'dTP':>6s} {'kB':>5s}  flags")
    fails = 0
    for r in rows:
        if 'error' in r:
            fails += 1
            print(f"{r['id']:24s} ERROR {r['error']}")
            if r.get('tb'):
                print(r['tb'])
            continue
        if r['flags']:
            fails += 1
        tgt = f"{r['kind']}{r['target']:+g}"
        print(f"{r['id']:24s} {r['dur'] * 1000:6.0f} {tgt:>9s} {r['got']:6.1f} {r['tp']:6.1f} {r['gr']:5.1f} {r['ch']:2d} {r['harsh'] * 100:4.0f}% {r['kb']:5.1f} |     {r['m4a_got']:6.1f} {r['m4a_tp']:6.1f} {r['m4a_kb']:5.1f}  {' '.join(r['flags'])}")
    ok = len(rows) - fails
    print(f'\n{len(rows)} files, {ok} pass QA, {fails} flagged — {time.time() - t0:.1f} s'
          f' (loudness tol ±{TOL_LU} LU, true peak ≤ {TP_MAX} dBTP decoded, Ogg Opus 48 kHz;'
          f' .m4a siblings AAC-LC, same checks)'
          f'\n.ogg {sum(r["kb"] for r in rows if "kb" in r) / 1024:.2f} MB, .m4a {sum(r["m4a_kb"] for r in rows if "m4a_kb" in r) / 1024:.2f} MB')
    gfails, grep_ = contract_gates(contract)
    print_gates(gfails, grep_)
    if a.json:
        with open(a.json, 'w', encoding='utf8') as f:
            json.dump({'cues': [{k: v for k, v in r.items() if k != 'tb'} for r in rows], 'gates': grep_, 'gateFailures': gfails}, f, indent=1)
    if a.sheet:
        write_sheet(rows, a.sheet)
        print(f'sheet → {a.sheet}')
    return 1 if fails or gfails else 0


def print_gates(fails: list[str], rep: dict) -> None:
    print(f"\ncontrol gate: {len(rep['controlKinds'])} control kinds ({', '.join(rep['controlKinds'])}); buffs voice {', '.join(rep['buffCues']) or '-'}")
    for k in rep['controlKinds']:
        c = rep['bound'].get(k)
        if c in rep['onsetMs']:
            o, d = rep['nearest'].get(c, ['', float('nan')])
            print(f"  {k:9s} {c:12s} lands {rep['onsetMs'][c]:5.1f} ms   nearest {o:12s} {d:5.1f} dB")
    for c in rep['buffCues']:
        if c in rep['onsetMs']:
            print(f"  (buff)    {c:12s} lands {rep['onsetMs'][c]:5.1f} ms")
    print('  ' + ('\n  '.join(f'FAIL {x}' for x in fails) if fails else
                 f'PASS: a distinct cue per control kind, c_buff for buffs only, all land <= {CC_ONSET_MS:g} ms, >= {CC_MIN_DIST_DB:g} dB apart'))


if __name__ == '__main__':
    sys.exit(main())
