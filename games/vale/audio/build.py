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
  procs      every fighter passive (content/fighters, read only) whose triggers pay off in damage, a status, a mark
             or a resource has a rendered proc cue (f_<fighter>_passive, else its present.sfx / hitSfx); every other
             triggered passive (items, boons, team buffs, units) has a present.sfx / hitSfx or its 'proc.<kind>' role
  ambience   every map (content/maps, read only) has 4-6 emitters 'ambient.<map>.<source>' → rendered ambience-bus
             loops: at most one 'bed' (not spatial), every other source an art.ambient group of that map with points
  instant    (final parity AUD-m1) every recipe flagged `instant` (a cue for an instant event: a blink, a level-up, a
             respawn, a summon, a pickup, a ping …) lands on its frame: its first sample within 20 dB of its peak comes
             by INSTANT_MS (the 5 ms codec lead included); swells belong to deliberate wind-ups only
  impact     (final parity AUD-4) the impacts read on a laptop: every IMPACT_CUES file and every control-status cue loses
             at most LAPTOP_MAX_LU of max momentary loudness through a 4th-order 220 Hz high-pass (a small speaker's
             roll-off); the hits and the crit carry a contact transient (> 2 kHz share of the first 30 ms after the
             -40 dB onset >= TRANSIENT_MIN, the frequent hits <= TRANSIENT_SOFT_TOP: a soft top), the crit sharper
             than either hit on average, and stun / root an attack edge
  kits       fighter identity (final parity AUD-1): every fighter has its whole kit f_<fighter>_<slot> (attack_swing,
             attack_hit, a1, a2, a3, ult_windup, ult_release, passive, death, call, hit, dash), rendered; resolved as the engine
             does (kit cue, else the catalog's present, else the generic role), no attack or ult cue is shared by two
             fighters or with a unit, two fighters' cues in one identity slot (attack swing / hit, ult wind-up /
             release) sit >= ID_MIN_DIST_DB apart by BOTH 1/3-octave measures: from ID_FROM_HZ (125 Hz) up over the
             round-robin-averaged spectrum (a laptop plays no sub band, so none carries identity), and the
             confusability of the closest pair of takes (STFT, 125 Hz - 16 kHz, re the strongest band, -40 dB floor:
             the final review's measure); every fighter has its own ability impact and dash (hit, dash: held to the
             same distance, the dash also from the displacement's 'dash' role cue), shared with no one;
             the kits' attack swings, attack hits, ult releases and ability hits (LAPTOP_SLOTS) lose <= LAPTOP_MAX_LU on
             a laptop, a physical fighter's attack hit and ability hit (CONTACT_SLOTS: they replace the library's
             c_hit_phys_* on every auto and ability) has a contact (>= KIT_TRANSIENT_MIN) and no fighter's passes the
             soft top for frequent hits (TRANSIENT_SOFT_TOP); and every cue that can fire more than once a second (attacks,
             hits, ability hits, procs, FAST_ROLES) has >= RR_MIN variants unless its own cooldown is >= RR_SLOW_COOLDOWN
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
        if spec.instant:
            row['on20'] = env_onset_ms(dec, -20.0)
            if row['on20'] > INSTANT_MS:
                flags.append(f"LATE{row['on20']:.0f}ms")
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


CONTENT = os.path.normpath(os.path.join(HERE, '..', 'content'))
PAYOFF_OPS = {'damage', 'status', 'mark', 'consumeMark', 'resource'}
AMB_MIN, AMB_MAX = 4, 6          # ambience emitters per map (final parity AUD-8)


def _read(rel: str):
    with open(os.path.join(CONTENT, rel), encoding='utf8') as f:
        return json.load(f)


def payoff_ops(node) -> set[str]:
    """Every effect op inside a passive's triggers, nested deliveries (onHit, then, perStack, …) included,
    that pays off as damage, a status, a mark or a resource."""
    found: set[str] = set()
    if isinstance(node, dict):
        if node.get('op') in PAYOFF_OPS:
            found.add(node['op'])
        for k, v in node.items():
            if k != '$comment':
                found |= payoff_ops(v)
    elif isinstance(node, list):
        for v in node:
            found |= payoff_ops(v)
    return found


def contract_gates(contract: dict) -> tuple[list[str], dict]:
    """Every contract gate (see the module doc); returns (failures, report)."""
    fails, rep = control_gate(contract)
    pf, prep = proc_gate(contract)
    af, arep = ambience_gate(contract)
    kf, krep = kit_gate(contract)
    xf, xrep = impact_gate(contract, rep.get('controlKinds', []), rep.get('bound', {}))
    rep['procs'] = prep
    rep['ambience'] = arep
    rep['kits'] = krep
    rep['impact'] = xrep
    return fails + pf + af + kf + xf, rep


# ── instant cues and impacts on a laptop (final parity AUD-m1, AUD-4) ────────────────────────────────
INSTANT_MS = 15.0        # an instant event's cue: first sample within 20 dB of its peak by this (5 ms lead included)
LAPTOP_MAX_LU = 3.0      # max momentary loudness lost through a 4th-order 220 Hz high-pass
IMPACT_CUES = ('c_hit_phys_light', 'c_hit_phys_heavy', 'c_hit_true', 'c_crit', 'c_slam', 'c_monster_hit')
TRANSIENT_MIN = {'c_hit_phys_light': 0.07, 'c_hit_phys_heavy': 0.07, 'c_crit': 0.07, 'c_stun': 0.015, 'c_root': 0.015}
TRANSIENT_SOFT_TOP = 0.30    # … and at most this for the frequent hits (the documented soft top)
SOFT_TOP_CUES = ('c_hit_phys_light', 'c_hit_phys_heavy')


def env_onset_ms(x: np.ndarray, rel_db: float) -> float:
    """ms from the file's start (codec lead included) until the sample envelope (max |x| over channels) first comes
    within `rel_db` of its peak."""
    e = np.max(np.abs(stereo(x)), axis=0)
    return float(np.argmax(e > e.max() * 10 ** (rel_db / 20)) / SR * 1000.0)


def transient_share(x: np.ndarray, lo: float = 2000.0, win: float = 0.03) -> float:
    """Share of power above `lo` in the first `win` s after the -40 dB onset (rectangular window, mid channel)."""
    e = np.max(np.abs(stereo(x)), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    m = stereo(x).mean(axis=0)[i:i + ns_(win)]
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    return float(P[f >= lo].sum() / (P[f > 20].sum() + 1e-30))


def laptop_loss(x: np.ndarray) -> float:
    """LU of max momentary loudness lost through a 4th-order Butterworth 220 Hz high-pass (a laptop speaker)."""
    from synth import filters as F
    y = F.apply(stereo(x), [F.highpass(220.0, 0.5412), F.highpass(220.0, 1.3066)])
    return float(L.max_momentary(x) - L.max_momentary(y))


def impact_gate(contract: dict, ctrl: list[str], bound: dict) -> tuple[list[str], dict]:
    """The instant and impact gates (see the module doc) over the shipped files; returns (failures, report)."""
    fails: list[str] = []
    cues = contract['cues']
    rep: dict = {'instant': {}, 'laptop': {}, 'transient': {}}

    def files(c: str) -> list[np.ndarray]:
        out = []
        for ref in cues.get(c, {}).get('files', []):
            path = out_path(ref)
            if not os.path.exists(path):
                fails.append(f'impact: {c} is not rendered ({path})')
                continue
            out.append(decode(path))
        return out
    for c in sorted(k for k, sp in REGISTRY.items() if sp.instant and k in cues):
        on = [env_onset_ms(x, -20.0) for x in files(c)]
        rep['instant'][c] = round(max(on), 1) if on else None
        if on and max(on) > INSTANT_MS:
            fails.append(f"instant: {c} is an instant event's cue but reaches -20 dB of its peak at {max(on):.0f} ms (> {INSTANT_MS:g} ms)")
    ctrl_cues = sorted({bound[k] for k in ctrl if bound.get(k) in cues})
    for c in list(IMPACT_CUES) + [x for x in ctrl_cues if x not in IMPACT_CUES]:
        xs = files(c)
        if not xs:
            continue
        loss = [laptop_loss(x) for x in xs]
        rep['laptop'][c] = round(max(loss), 2)
        if max(loss) > LAPTOP_MAX_LU:
            fails.append(f'impact: {c} loses {max(loss):.1f} LU through a 220 Hz laptop roll-off (> {LAPTOP_MAX_LU:g})')
        if c in TRANSIENT_MIN:
            hf = [transient_share(x) for x in xs]
            rep['transient'][c] = {'min': round(min(hf), 3), 'mean': round(float(np.mean(hf)), 3), 'max': round(max(hf), 3)}
            if min(hf) < TRANSIENT_MIN[c]:
                fails.append(f'impact: {c} has {min(hf):.3f} of its first 30 ms above 2 kHz (< {TRANSIENT_MIN[c]:g}): no contact transient')
            if c in SOFT_TOP_CUES and max(hf) > TRANSIENT_SOFT_TOP:
                fails.append(f'impact: {c} has {max(hf):.3f} of its first 30 ms above 2 kHz (> {TRANSIENT_SOFT_TOP:g}): the soft top is gone')
    tr = rep['transient']
    if 'c_crit' in tr and any(h in tr for h in SOFT_TOP_CUES):
        top = max(tr[h]['mean'] for h in SOFT_TOP_CUES if h in tr)
        if tr['c_crit']['mean'] <= top:
            fails.append(f"impact: c_crit's contact ({tr['c_crit']['mean']:.3f}) is not sharper than the hits' ({top:.3f})")
    return fails, rep


# ── fighter identity (final parity AUD-1) ────────────────────────────────────────────────────────
KIT_SLOTS = ('attack_swing', 'attack_hit', 'a1', 'a2', 'a3', 'ult_windup', 'ult_release', 'passive', 'death', 'call', 'hit', 'dash')
ID_SLOTS = ('attack_swing', 'attack_hit', 'ult_windup', 'ult_release')     # the sounds a player tells fighters apart by
OWN_SLOTS = ('hit', 'dash')    # a fighter's own ability impact and dash: never shared, never the library's
DIST_SLOTS = ID_SLOTS + OWN_SLOTS  # … and the ability impact and the dash are told apart by ear like the attack and the ult
ID_MIN_DIST_DB = 8.0     # 1/3-octave distance between two fighters' cues in the same identity slot, by BOTH measures:
ID_FROM_HZ = 125.0       # … the bands from here up (a laptop speaker plays nothing below; sub bands cannot carry identity)
CONFUSE_BANDS = 125.0 * 2.0 ** (np.arange(0, 22) / 3.0)   # … and per take, 125 Hz - 16 kHz (the final review's measure)
KIT_TRANSIENT_MIN = 0.07  # a physical fighter's attack / ability hit's contact: the library's physical hits' floor …
                          # … and TRANSIENT_SOFT_TOP every kit hit's top (they are the most frequent cues of a match)
LAPTOP_SLOTS = ('attack_swing', 'attack_hit', 'ult_release', 'hit')   # the kit cues held to LAPTOP_MAX_LU (AUD-4)
CONTACT_SLOTS = ('attack_hit', 'hit')                                 # … and to the contact band
RR_MIN = 3               # round-robin variants for a cue that can fire more than once a second
RR_SLOW_COOLDOWN = 1.0   # … a cue whose own cooldown is at least this cannot
# engine roles that can fire more than once a second (every basic attack, hit, projectile, wave death, heal tick, last hit)
FAST_ROLES = ('attack', 'crit', 'hitPhysical', 'hitMagic', 'hitTrue', 'hitAbility', 'projectile', 'minionDeath', 'heal', 'gold')
_SPEC: dict[str, np.ndarray] = {}


def fighter_kit(fd: dict, cues: dict, ev: dict) -> dict[str, str | None]:
    """A fighter's identity cues as src/audio/index.ts resolves them: f_<fighter>_<slot> first, then the catalog's
    present, then the generic role (an ult release has no fallback: without a kit cue it is silent)."""
    fid = fd['id']

    def per(s: str) -> str | None:
        c = f'f_{fid}_{s}'
        return c if c in cues else None

    att = fd.get('attack') or {}
    ap = att.get('present') or {}
    up = ((fd.get('kit') or {}).get('ult') or {}).get('present') or {}
    hit_role = {'magic': 'hitMagic', 'true': 'hitTrue'}.get(att.get('damageType', 'physical'), 'hitPhysical')
    return {
        'attack_swing': per('attack_swing') or ap.get('sfx') or ev.get('attack'),
        'attack_hit': per('attack_hit') or ap.get('hitSfx') or ev.get(hit_role),
        'ult_windup': per('ult_windup') or up.get('sfx') or ev.get('castUlt'),
        'ult_release': per('ult_release'),
        'hit': per('hit'),            # no fallback here: the gate wants every fighter's own (the engine falls back)
        'dash': per('dash'),
    }


def confuse_db(x: np.ndarray) -> np.ndarray:
    """One take's confusability profile (the final review's measure): STFT (1024 / 768) power in 21 1/3-octave bands
    125 Hz - 16 kHz averaged over frames, in dB re its strongest band, floored at -40."""
    from scipy import signal
    m = stereo(x).mean(axis=0)
    f, _, Z = signal.stft(m, SR, nperseg=1024, noverlap=768)
    P = np.abs(Z) ** 2
    e = CONFUSE_BANDS
    b = np.array([P[(f >= e[i]) & (f < e[i + 1])].sum(axis=0) for i in range(len(e) - 1)]).mean(axis=1)
    s = 10 * np.log10(b + 1e-12)
    return np.maximum(s - s.max(), -40.0)


def cue_spectrum(cid: str, cues: dict) -> dict | None:
    """The cue's identity features (None: not rendered): 'hi' its 1/3-octave levels from ID_FROM_HZ up, power-averaged
    over its round-robin files (each power-normalised) and renormalised over those bands; 'takes' each file's
    confusability profile (confuse_db)."""
    if cid not in _SPEC:
        ps, takes = [], []
        centres = 1000.0 * 2.0 ** (np.arange(-16, 13) / 3.0)
        for f in cues[cid]['files']:
            p = out_path(f)
            if not os.path.exists(p):
                return None
            x = decode(p)
            ps.append(10 ** (third_octave_db(x) / 10))
            takes.append(confuse_db(x))
        hi = np.mean(ps, axis=0)[centres >= ID_FROM_HZ * 0.99]
        hi = hi / (hi.sum() + 1e-30)
        _SPEC[cid] = {'hi': 10 * np.log10(np.maximum(hi, 1e-9)), 'takes': takes}
    return _SPEC[cid]


def id_distance(a: dict, b: dict) -> tuple[float, float]:
    """(1/3-octave distance from ID_FROM_HZ up, the smallest confusability distance over every pair of takes)."""
    c = min(float(np.sqrt(np.mean((x - y) ** 2))) for x in a['takes'] for y in b['takes'])
    return band_distance(a['hi'], b['hi']), c


def _hit_sfx(node, out: set[str]) -> None:
    if isinstance(node, dict):
        pr = node.get('present')
        if isinstance(pr, dict) and pr.get('hitSfx'):
            out.add(pr['hitSfx'])
        for k, v in node.items():
            if k != '$comment':
                _hit_sfx(v, out)
    elif isinstance(node, list):
        for v in node:
            _hit_sfx(v, out)


def kit_gate(contract: dict) -> tuple[list[str], dict]:
    """kits: every fighter has its whole kit (f_<fighter>_<slot> for every KIT_SLOTS slot, rendered); no identity cue
    (attack swing / hit, ult wind-up / release) nor own cue (ability hit, dash) is shared by two fighters or with a
    unit; two fighters' cues in the same identity slot (the own ability hit and dash included: DIST_SLOTS) sit >=
    ID_MIN_DIST_DB apart by BOTH measures (1/3-octave distance from ID_FROM_HZ up over the take-averaged spectrum, and
    the confusability distance of the closest pair of takes, 125 Hz - 16 kHz), and so does every own dash from the
    displacement's ('dash' role); every kit attack swing, attack hit, ult release and ability hit loses <=
    LAPTOP_MAX_LU through the 220 Hz laptop roll-off, a physical fighter's attack hit and ability hit carry a contact (>=
    KIT_TRANSIENT_MIN of their first 30 ms above 2 kHz, every take) and no kit attack or ability hit passes
    TRANSIENT_SOFT_TOP; every cue that can fire more than once a second (fighters' and units' attacks and hits, every ability hit,
    the kits' ability hits, procs, FAST_ROLES) has >= RR_MIN round-robin variants (files, each from its own recipe
    variant), unless its own cooldown is >= RR_SLOW_COOLDOWN."""
    import glob
    fails: list[str] = []
    cues, ev = contract['cues'], contract.get('events', {})
    fighters = []
    for path in sorted(glob.glob(os.path.join(CONTENT, 'fighters', '*.json'))):
        with open(path, encoding='utf8') as f:
            fighters.append(json.load(f))
    units = _read('units.json')['units']
    rep: dict = {'fighters': {}, 'nearest': {}, 'nearestConfuse': {}, 'fast': {}, 'laptop': {}, 'contact': {}}
    resolved = {fd['id']: fighter_kit(fd, cues, ev) for fd in fighters}
    # completeness
    for fd in fighters:
        fid = fd['id']
        miss = [s for s in KIT_SLOTS if f'f_{fid}_{s}' not in cues]
        unrendered = [f'f_{fid}_{s}' for s in KIT_SLOTS if f'f_{fid}_{s}' in cues
                      and not all(os.path.exists(out_path(x)) for x in cues[f'f_{fid}_{s}']['files'])]
        rep['fighters'][fid] = {'kit': len(KIT_SLOTS) - len(miss), 'missing': miss, 'resolved': resolved[fid]}
        if miss:
            fails.append(f"kits: {fid} has no f_{fid}_{{{','.join(miss)}}}")
        for c in unrendered:
            fails.append(f'kits: {c} is not rendered')
    # shared identity cues (between fighters, and with units)
    unit_cues: dict[str, list[str]] = {}
    for u in units:
        ap = ((u.get('attack') or {}).get('present') or {})
        for k in ('sfx', 'hitSfx'):
            if ap.get(k):
                unit_cues.setdefault(ap[k], []).append(u['id'])
    users: dict[str, list[str]] = {}
    for fid, k in resolved.items():
        for s in ID_SLOTS + OWN_SLOTS:
            c = k[s]
            if not c:
                if s in ('ult_release',) + OWN_SLOTS:
                    continue                      # reported by completeness (no kit cue at all)
                fails.append(f'kits: {fid}.{s} has no cue')
                continue
            users.setdefault(c, []).append(f'{fid}.{s}')
    for c, us in sorted(users.items()):
        if len({u.split('.')[0] for u in us}) > 1:
            fails.append(f"kits: {c} is shared by {', '.join(us)}")
        if c in unit_cues:
            fails.append(f"kits: {c} ({', '.join(us)}) is also a unit's ({', '.join(unit_cues[c])})")
    # identity distance per slot, by both measures
    for s in DIST_SLOTS:
        spec = {}
        for fid, k in resolved.items():
            if k[s] and k[s] in cues:
                sp = cue_spectrum(k[s], cues)
                if sp is not None:
                    spec[fid] = (k[s], sp)
        ids = sorted(spec)
        near: dict[str, tuple[float, str]] = {}
        nearc: dict[str, tuple[float, str]] = {}
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                if spec[a][0] == spec[b][0]:
                    continue                      # one cue for both: reported as shared above
                d, c = id_distance(spec[a][1], spec[b][1])
                for x, y in ((a, b), (b, a)):
                    if x not in near or d < near[x][0]:
                        near[x] = (d, y)
                    if x not in nearc or c < nearc[x][0]:
                        nearc[x] = (c, y)
                if d < ID_MIN_DIST_DB:
                    fails.append(f'kits: {a}.{s} ({spec[a][0]}) is {d:.1f} dB from {b}.{s} ({spec[b][0]}) by 1/3-octave distance'
                                 f' from {ID_FROM_HZ:g} Hz (< {ID_MIN_DIST_DB:g} dB)')
                if c < ID_MIN_DIST_DB:
                    fails.append(f'kits: a take of {a}.{s} ({spec[a][0]}) is {c:.1f} dB from one of {b}.{s} ({spec[b][0]}) by'
                                 f' confusability (< {ID_MIN_DIST_DB:g} dB)')
        for x, (d, y) in near.items():
            rep['nearest'][f'{x}.{s}'] = [y, round(d, 2)]
        for x, (c, y) in nearc.items():
            rep['nearestConfuse'][f'{x}.{s}'] = [y, round(c, 2)]
    # an own dash is told apart from a displacement (the 'dash' role, which the engine plays on a knocked unit)
    gen = ev.get('dash')
    gsp = cue_spectrum(gen, cues) if gen in cues else None
    rep['dashVsDisplacement'] = {}
    for fid, k in sorted(resolved.items()):
        if gsp is None or not k['dash'] or k['dash'] == gen or k['dash'] not in cues:
            continue
        sp = cue_spectrum(k['dash'], cues)
        if sp is None:
            continue
        d, c = id_distance(sp, gsp)
        rep['dashVsDisplacement'][fid] = [round(d, 2), round(c, 2)]
        if min(d, c) < ID_MIN_DIST_DB:
            fails.append(f"kits: {k['dash']} is {d:.1f} / {c:.1f} dB from the displacement's {gen} (1/3-octave from"
                         f' {ID_FROM_HZ:g} Hz / confusability, < {ID_MIN_DIST_DB:g} dB): an own dash would read as a knock')
    # the kits on a laptop, and the kit hits' contact (the impact gate's measures, final parity AUD-4)
    for fd in fighters:
        fid = fd['id']
        phys = (fd.get('attack') or {}).get('damageType', 'phys') in ('phys', 'physical')
        for s in LAPTOP_SLOTS:
            c = f'f_{fid}_{s}'
            if c not in cues or not all(os.path.exists(out_path(x)) for x in cues[c]['files']):
                continue
            xs = [decode(out_path(x)) for x in cues[c]['files']]
            loss = max(laptop_loss(x) for x in xs)
            rep['laptop'][c] = round(loss, 2)
            if loss > LAPTOP_MAX_LU:
                fails.append(f'kits: {c} loses {loss:.1f} LU through a 220 Hz laptop roll-off (> {LAPTOP_MAX_LU:g})')
            if s in CONTACT_SLOTS:
                hf = [transient_share(x) for x in xs]
                rep['contact'][c] = [round(min(hf), 3), round(max(hf), 3)]
                if phys and min(hf) < KIT_TRANSIENT_MIN:
                    fails.append(f'kits: {c} has {min(hf):.3f} of its first 30 ms above 2 kHz (< {KIT_TRANSIENT_MIN:g}): no contact')
                if max(hf) > TRANSIENT_SOFT_TOP:
                    fails.append(f'kits: {c} has {max(hf):.3f} of its first 30 ms above 2 kHz (> {TRANSIENT_SOFT_TOP:g}):'
                                 f' the soft top for frequent hits is gone')
    # round-robin for every cue that can fire more than once a second
    fast: dict[str, str] = {}
    for fid, k in resolved.items():
        for s in ('attack_swing', 'attack_hit'):
            if k[s]:
                fast.setdefault(k[s], f'{fid} attack')
        if f'f_{fid}_passive' in cues:
            fast.setdefault(f'f_{fid}_passive', f'{fid} passive proc')
        if f'f_{fid}_hit' in cues:
            fast.setdefault(f'f_{fid}_hit', f'{fid} ability hit (an area lands on several units at once)')
    for fd in fighters:
        hs: set[str] = set()
        _hit_sfx(fd.get('kit') or {}, hs)
        for c in sorted(hs):
            fast.setdefault(c, f"{fd['id']} ability hit")
    for c, us in unit_cues.items():
        fast.setdefault(c, f"unit attack ({', '.join(us[:3])}{'…' if len(us) > 3 else ''})")
    for role in FAST_ROLES:
        if ev.get(role):
            fast.setdefault(ev[role], f'role {role}')
    for role, c in ev.items():
        if role.startswith('proc.'):
            fast.setdefault(c, f'role {role}')
    for c, why in sorted(fast.items()):
        d = cues.get(c)
        if not d:
            continue
        spec = REGISTRY.get(c)
        n = min(len(d['files']), spec.variants if spec else len(d['files']))
        rep['fast'][c] = {'why': why, 'variants': n, 'cooldown': d.get('cooldown', 0)}
        if n < RR_MIN and d.get('cooldown', 0) < RR_SLOW_COOLDOWN:
            fails.append(f'kits: {c} can fire more than once a second ({why}) but has {n} variant(s) (< {RR_MIN})')
    return fails, rep


def proc_gate(contract: dict) -> tuple[list[str], dict]:
    """procs: every fighter passive with a damage / status / mark / resource payoff has its proc cue
    (f_<fighter>_passive, else the passive's present.sfx / hitSfx), rendered; every other triggered passive
    (items, boons, team buffs, units) has a present.sfx / hitSfx or its 'proc.<kind>' role bound."""
    import glob
    fails: list[str] = []
    cues, ev = contract['cues'], contract.get('events', {})
    rep: dict = {'fighters': {}, 'others': {}}

    def rendered(c: str) -> bool:
        return all(os.path.exists(out_path(f)) for f in cues[c]['files'])

    for path in sorted(glob.glob(os.path.join(CONTENT, 'fighters', '*.json'))):
        with open(path, encoding='utf8') as f:
            fd = json.load(f)
        p = fd.get('kit', {}).get('passive') or {}
        ops = sorted(payoff_ops(p.get('triggers', [])))
        per = f"f_{fd['id']}_passive"
        pres = p.get('present') or {}
        c = per if per in cues else pres.get('sfx') or pres.get('hitSfx')
        rep['fighters'][fd['id']] = {'passive': p.get('id'), 'payoff': ops, 'cue': c}
        if ops and not c:
            fails.append(f"procs: {fd['id']}'s passive {p.get('id')} pays off ({', '.join(ops)}) but has no proc cue ({per})")
        elif c and c not in cues:
            fails.append(f"procs: {fd['id']}'s proc cue {c} is not in audio.json")
        elif c and not rendered(c):
            fails.append(f'procs: {c} is not rendered')
    others = [('item', p) for it in _read('items.json')['items'] for p in it.get('passives', [])]
    others += [('boon', b) for b in _read('setup.json').get('boons', [])]
    others += [('team', p) for tb in _read('team_buffs.json')['teamBuffs'] for p in tb.get('passives', [])]
    others += [('unit', u['passive']) for u in _read('units.json')['units'] if u.get('passive')]
    for kind, p in others:
        if not p.get('triggers'):
            continue
        pres = p.get('present') or {}
        c = pres.get('sfx') or pres.get('hitSfx') or ev.get(f'proc.{kind}')
        rep['others'][p['id']] = {'kind': kind, 'cue': c}
        if not c or c not in cues:
            fails.append(f"procs: the {kind} passive {p['id']} has triggers but no proc cue (present.sfx / hitSfx or 'proc.{kind}')")
    return fails, rep


def ambience_gate(contract: dict) -> tuple[list[str], dict]:
    """ambience: every map has AMB_MIN..AMB_MAX emitters ('ambient.<map>.<source>'), at most one 'bed' (not
    spatial); every other source names an art.ambient group of that map with points (spatial cue); every
    emitter's cue is a rendered loop on the ambience bus; no role names an unknown map."""
    import glob
    fails: list[str] = []
    cues, ev = contract['cues'], contract.get('events', {})
    maps = {}
    for path in sorted(glob.glob(os.path.join(CONTENT, 'maps', '*.json'))):
        with open(path, encoding='utf8') as f:
            md = json.load(f)
        maps[md['id']] = (md.get('art') or {}).get('ambient') or {}
    rep: dict = {}
    roles = {k: v for k, v in ev.items() if k.startswith('ambient.')}
    for role in roles:
        parts = role.split('.')
        if len(parts) != 3 or parts[1] not in maps:
            fails.append(f'ambience: {role} names no map (ambient.<map id>.<source>)')
    for mid, art in maps.items():
        ems = {k.split('.', 2)[2]: v for k, v in roles.items() if k.split('.')[1] == mid}
        rows = {}
        for src, c in ems.items():
            if src == 'bed':
                pts = None
            else:
                pts = sum(len(e.get('at', [])) for e in art.get('effects', []) if e.get('vfx') == src)
                pts += sum(len(x.get('spots', [])) for x in art.get('critters', []) if x.get('id') == src)
                pts += sum(len(x.get('at', [])) for x in art.get('props', [])
                           if (x.get('fx') or {}).get('vfx') == src or os.path.splitext(os.path.basename(x.get('model', '')))[0] == src)
            rows[src] = {'cue': c, 'points': pts}
            d = cues.get(c)
            if not d:
                fails.append(f'ambience: {mid}.{src} → {c} is not in audio.json')
                continue
            if d.get('bus') != 'ambience' or not d.get('loop'):
                fails.append(f'ambience: {c} must be a loop on the ambience bus')
            if src == 'bed' and d.get('spatial'):
                fails.append(f'ambience: {mid}\'s bed {c} must not be spatial (it is the map-wide floor)')
            if src != 'bed':
                if not pts:
                    fails.append(f'ambience: {mid}.{src} matches no art.ambient group with points in content/maps')
                if not d.get('spatial'):
                    fails.append(f'ambience: {c} sounds from points ({mid}.{src}) but is not spatial')
            if not all(os.path.exists(out_path(f)) for f in d['files']):
                fails.append(f'ambience: {c} is not rendered')
        rep[mid] = rows
        if not AMB_MIN <= len(ems) <= AMB_MAX:
            fails.append(f'ambience: {mid} has {len(ems)} emitters (want {AMB_MIN}-{AMB_MAX})')
    return fails, rep


def control_gate(contract: dict) -> tuple[list[str], dict]:
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
    pr = rep.get('procs', {})
    paid = [f for f, x in pr.get('fighters', {}).items() if x['payoff']]
    print(f"proc gate: {len(pr.get('fighters', {}))} fighter passives ({len(paid)} with a payoff), "
          f"{len(pr.get('others', {}))} other triggered passives")
    for f, x in pr.get('fighters', {}).items():
        print(f"  {f:9s} {x['passive'] or '-':26s} {','.join(x['payoff']) or '-':28s} → {x['cue'] or 'NONE'}")
    am = rep.get('ambience', {})
    print(f'ambience gate: {len(am)} maps, {AMB_MIN}-{AMB_MAX} emitters each')
    for mid, rows in am.items():
        print(f"  {mid:11s} " + ', '.join(f"{s}→{x['cue']}({'bed' if x['points'] is None else x['points']})" for s, x in rows.items()))
    kr = rep.get('kits', {})
    whole = [f for f, x in kr.get('fighters', {}).items() if not x['missing']]
    print(f"kit gate: {len(whole)}/{len(kr.get('fighters', {}))} fighters with a whole kit ({len(KIT_SLOTS)} slots);"
          f" identity slots >= {ID_MIN_DIST_DB:g} dB apart; >= {RR_MIN} variants for {len(kr.get('fast', {}))} fast cues")
    print(f"  nearest dB per slot: 1/3-octave from {ID_FROM_HZ:g} Hz / confusability of the closest takes")
    for f, x in kr.get('fighters', {}).items():
        near = '  '.join(f"{s.replace('attack_', 'atk_').replace('ult_', 'u_')} {kr['nearest'].get(f'{f}.{s}', ['-', float('nan')])[1]:5.1f}"
                         f"/{kr['nearestConfuse'].get(f'{f}.{s}', ['-', float('nan')])[1]:4.1f}" for s in DIST_SLOTS)
        lap = '/'.join(f"{kr['laptop'].get(f'f_{f}_{s}', float('nan')):.1f}" for s in LAPTOP_SLOTS)
        ct = '  '.join(f"{s.replace('attack_', 'atk_')} {kr['contact'][f'f_{f}_{s}'][0]:.3f}-{kr['contact'][f'f_{f}_{s}'][1]:.3f}"
                       for s in CONTACT_SLOTS if f'f_{f}_{s}' in kr['contact'])
        print(f"  {f:9s} {x['kit']:2d}/{len(KIT_SLOTS)}  {near}  laptop swing/hit/release/ability {lap} LU" + (f"  contact {ct}" if ct else ''))
    ip = rep.get('impact', {})
    late = {c: v for c, v in ip.get('instant', {}).items() if v is not None}
    print(f"instant gate: {len(late)} instant cues, slowest {max(late.values(), default=0):.1f} ms to -20 dB (<= {INSTANT_MS:g})")
    print(f"impact gate: laptop loss (<= {LAPTOP_MAX_LU:g} LU) " + ', '.join(f'{c} {v:.1f}' for c, v in ip.get('laptop', {}).items()))
    print('  contact > 2 kHz in 30 ms: ' + ', '.join(f"{c} {v['min']:.3f}-{v['max']:.3f}" for c, v in ip.get('transient', {}).items()))
    print('  ' + ('\n  '.join(f'FAIL {x}' for x in fails) if fails else
                 f'PASS: a distinct cue per control kind, c_buff for buffs only, all land <= {CC_ONSET_MS:g} ms, >= {CC_MIN_DIST_DB:g} dB apart;'
                 f' every paying passive has a proc cue; every map {AMB_MIN}-{AMB_MAX} ambience emitters on real points;'
                 f' every fighter a whole kit of its own, >= {ID_MIN_DIST_DB:g} dB from the others; fast cues >= {RR_MIN} variants;'
                 f' instant cues land <= {INSTANT_MS:g} ms; impacts lose <= {LAPTOP_MAX_LU:g} LU on a laptop, with a contact transient'))


if __name__ == '__main__':
    sys.exit(main())
