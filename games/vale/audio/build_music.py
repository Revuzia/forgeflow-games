#!/usr/bin/env python3
"""VALE music build (lane AUDIO, music only): renders every bed in content/audio.json `music` (main stem +
layers) and every cue on the `music` bus (the stings), masters them, encodes Ogg Opus (tokens.audio.format.primary;
the same codec as the SFX build) at the exact audio.json paths (assets/audio/<x> → audio/out/<x>) and
prints QA from the DECODED files.

    cd games/vale/audio && ../../../.venv/bin/python3 build_music.py [--only mus_match_rift,m_victory_sting] [--kbps 128]

Deterministic: every random choice in the scores is seeded by name (synth.core.rng), so a rebuild is
bit-identical up to the encoder.

QA per bed stem (decoded OGG)
  len      exact sample count (must equal the render; a layer must equal its main stem) and the 8 s grid
  seam     the wrap (sample 0) measured like every other bar downbeat of the loop (bar 0 is itself a
           downbeat: a chord change, a strike, a fill landing): the sample step there over the 99.9th-pct
           step within ±0.5 s (≤ 1.5 = no step), the > 7 kHz peak (a click) and the spectral distance
           between the 43 ms before and after it, each ranked against the other downbeats. PASS = step
           ≤ 1.5 and neither the click nor the flux above 1.25x the downbeats' 90th percentile.
  LUFS     gated integrated (circular), true peak (circular, 4x), loudness range
  bands    energy share sub < 80 · low 80-250 · lowmid 250-1k · pres 1-4k · air > 4k
  layer    the lift main+layer over main per band (dB): the combat layer should lift sub/low/lowmid and
           leave pres (the UI / ability band) nearly alone
  mode     share of pitch-class energy inside D Dorian + G# (+ F# for the bright beds)
Stings: length, max short-term LUFS (target −16), true peak (≤ −1.0 dBTP decoded), mode share.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
if shutil.which('ffmpeg') is None and os.path.exists('/opt/homebrew/bin/ffmpeg'):
    os.environ['PATH'] = '/opt/homebrew/bin:' + os.environ.get('PATH', '')

import bedlib  # noqa: E402
import cuelib  # noqa: E402
import music  # noqa: E402  (registers the beds)
from synth import fx, io  # noqa: E402
from synth import loudness as L  # noqa: E402
from synth.core import SR, db  # noqa: E402

GAME = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out')
CONTENT = os.path.join(GAME, 'content', 'audio.json')
BANDS = [('sub', 20, 80), ('low', 80, 250), ('lowmid', 250, 1000), ('pres', 1000, 4000), ('air', 4000, 16000)]
DORIAN_G = (0, 2, 4, 5, 7, 9, 11, 8)
LAYER_KBPS = 96              # the combat layers are mostly drums and bass: Opus is transparent there at 96k
BRIGHT = DORIAN_G + (6,)


def encode(wav: str, ogg: str, kbps: int) -> None:
    """ffmpeg libopus → Ogg (.ogg), stereo VBR. Opus is native 48 kHz; the Ogg pre-skip and end granule keep
    the decoded length sample-exact, which a seamless loop needs. 20 ms frames (tonal music, no sharp
    one-shot attacks to protect). Metadata stripped, bitexact flags for reproducible files."""
    import subprocess
    os.makedirs(os.path.dirname(ogg), exist_ok=True)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-map_metadata', '-1',
           '-c:a', 'libopus', '-b:a', f'{kbps}k', '-vbr', 'on', '-application', 'audio', '-compression_level', '10',
           '-frame_duration', '20', '-ac', '2', '-ar', str(SR), '-fflags', '+bitexact', '-flags:a', '+bitexact',
           '-f', 'ogg', ogg]
    subprocess.run(cmd, check=True)


def out_path(ref: str) -> str:
    pre = 'assets/audio/'
    if not ref.startswith(pre):
        raise ValueError(f'unexpected asset ref {ref!r}')
    return os.path.join(OUT, ref[len(pre):])


# ── QA ───────────────────────────────────────────────────────────────────────────────────────────
def band_power(x: np.ndarray) -> dict[str, float]:
    X = np.abs(np.fft.rfft(x, axis=1)) ** 2
    P = X.sum(axis=0)
    f = np.fft.rfftfreq(x.shape[1], 1 / SR)
    return {name: float(P[(f >= lo) & (f < hi)].sum()) for name, lo, hi in BANDS}


def shares(bp: dict[str, float]) -> dict[str, float]:
    tot = sum(bp.values()) + 1e-30
    return {k: v / tot for k, v in bp.items()}


def _hf_env(seg: np.ndarray) -> np.ndarray:
    """1 ms power envelope of the > 7 kHz band (where a click lives)."""
    hp = fx.eq(seg, [('hp', 7000.0, 0.7071), ('hp', 7000.0, 0.7071)])
    p = (hp ** 2).sum(axis=0)
    k = SR // 1000
    m = p.size // k
    return p[:m * k].reshape(m, k).mean(axis=1)


_EDGES = 40.0 * 2 ** (np.arange(0, 29) / 3)


def _logbands(fr: np.ndarray) -> np.ndarray:
    S = np.abs(np.fft.rfft(fr * np.hanning(fr.size))) ** 2
    f = np.fft.rfftfreq(fr.size, 1 / SR)
    return 10 * np.log10(np.array([S[(f >= a) & (f < b)].sum() for a, b in zip(_EDGES[:-1], _EDGES[1:])]) + 1e-12)


def _boundary(x: np.ndarray, p: int) -> tuple[float, float, float]:
    """Three continuity measures at sample p of a loop (circular): the sample step at p over the 99.9th
    percentile step within ±0.5 s; the > 7 kHz peak within ±4 ms of p over that band's median within ±0.5 s;
    the 1/3-octave spectral distance (dB rms) between the 2048 samples before p and the 2048 after it."""
    w = SR // 2
    seg = np.take(x, np.arange(p - w, p + w), axis=1, mode='wrap')
    steps = np.abs(np.diff(seg, axis=1))
    step_p = float(steps[:, w - 1].max())
    rest = np.delete(steps, w - 1, axis=1)
    jump = step_p / (float(np.percentile(rest, 99.9)) + 1e-12)
    env = _hf_env(seg)
    c = w // (SR // 1000)
    hf = float(env[c - 4:c + 4].max()) / (float(np.median(env)) + 1e-20)
    m = seg.sum(axis=0)
    a, b = _logbands(m[w - 2048:w]), _logbands(m[w:w + 2048])
    floor = max(a.max(), b.max()) - 60.0                      # bands 60 dB under the loudest one are silence
    flux = float(np.sqrt(np.mean((np.maximum(a, floor) - np.maximum(b, floor)) ** 2)))
    return jump, hf, flux


def seam_qa(x: np.ndarray, bar_s: float) -> dict:
    """The loop wrap (sample 0) against every other bar downbeat of the loop. Bar 0 is a downbeat like any
    other (a chord change, a strike, a fill landing), so the wrap is seamless when it ranks among them, not
    above them; `jump` is also given absolutely (≤ ~1: the wrap is no bigger a step than the music's own)."""
    n = x.shape[1]
    bar = int(round(bar_s * SR))
    pts = list(range(0, n, bar))
    vals = np.array([_boundary(x, p) for p in pts])          # [downbeat, (jump, hf, flux)]
    seam = vals[0]
    others = vals[1:]
    pct = [float(np.mean(others[:, i] < seam[i]) * 100) for i in range(3)]
    return dict(jump=float(seam[0]), hf=float(seam[1]), flux=float(seam[2]), jump_pct=pct[0], hf_pct=pct[1],
                flux_pct=pct[2], flux_med=float(np.median(others[:, 2])), hf_med=float(np.median(others[:, 1])),
                ok=bool(seam[0] <= 1.5 and seam[1] <= 1.25 * np.percentile(others[:, 1], 90)
                        and seam[2] <= 1.25 * np.percentile(others[:, 2], 90)))


def stem_qa(x: np.ndarray, allowed, bar_s: float) -> dict:
    from synth.viz import mode_energy_ratio
    return dict(lufs=L.integrated(x, circular=True), tp=L.true_peak(x, circular=True),
                lra=L.loudness_range(x, circular=True), bands=shares(band_power(x)), bp=band_power(x),
                seam=seam_qa(x, bar_s), mode=mode_energy_ratio(x, allowed))


def fmt_bands(s: dict) -> str:
    return ' '.join(f'{k} {100 * v:4.1f}%' for k, v in s.items())


# ── beds ─────────────────────────────────────────────────────────────────────────────────────────
def build_bed(bid: str, mdef: dict, kbps: int, tmp: str, keep_wav: bool) -> dict:
    spec = bedlib.REGISTRY.get(bid)
    if spec is None:
        raise SystemExit(f'{bid}: no composition registered (audio/music/__init__.py)')
    t0 = time.time()
    stems, meta = spec.fn()
    t_render = time.time() - t0
    n = stems['main'].shape[1]
    want_layers = [l['id'] for l in mdef.get('layers', [])]
    for lid in want_layers:
        if lid not in stems:
            raise SystemExit(f'{bid}: audio.json wants layer {lid!r}, the composition gives {sorted(stems)}')
        if stems[lid].shape[1] != n:
            raise SystemExit(f'{bid}: layer {lid} is {stems[lid].shape[1]} samples, main is {n}')
    # pre-level every stem 3 dB above its target so bedlib's fixed-threshold glue compressor sees the same
    # input level on every bed (it then only moves loud moments by a dB or two)
    pre = {}
    for k in ['main'] + want_layers:
        tgt = spec.main_lufs if k == 'main' else spec.layer_lufs
        pre[k] = stems[k] * db(tgt + 3.0 - L.integrated(stems[k], circular=True))
    mastered, minfo = bedlib.master_bed(pre, spec)
    paths = {'main': out_path(mdef['file'])}
    for l in mdef.get('layers', []):
        paths[l['id']] = out_path(l['file'])
    allowed = BRIGHT if 'rift' in bid else DORIAN_G
    rep = dict(id=bid, seconds=n / SR, render_s=t_render, meta={k: v for k, v in meta.items() if k != 'chords'}, stems={})
    decoded = {}
    for k, x in mastered.items():
        wav = os.path.join(tmp, f'{bid}_{k}.wav')
        io.write_wav(wav, x)
        encode(wav, paths[k], kbps if k == 'main' else LAYER_KBPS)
        if keep_wav:
            shutil.copy(wav, paths[k][:-4] + '.wav')
        y = io.decode(paths[k])
        decoded[k] = y
        bar_s = 240.0 / float(meta['bpm'])
        r = stem_qa(y, allowed, bar_s)
        r.update(path=os.path.relpath(paths[k], GAME), samples=y.shape[1], render_samples=x.shape[1],
                 kb=os.path.getsize(paths[k]) / 1024, master=minfo[k], pre_seam=seam_qa(x, bar_s))
        rep['stems'][k] = r
    if len(decoded) > 1:
        main = decoded['main']
        for k, y in decoded.items():
            if k == 'main':
                continue
            m = min(main.shape[1], y.shape[1])
            both = main[:, :m] + y[:, :m]
            bm, bb = rep['stems']['main']['bp'], band_power(both)
            rep['stems'][k]['lift_db'] = {b: 10 * math.log10((bb[b] + 1e-30) / (bm[b] + 1e-30)) for b in bb}
            rep['stems'][k]['sum_lufs'] = L.integrated(both, circular=True)
            rep['stems'][k]['sum_tp'] = L.true_peak(both, circular=True)
    return rep


def print_bed(rep: dict) -> None:
    m = rep['meta']
    print(f"\n■ {rep['id']}  {rep['seconds']:.1f} s ({rep['seconds'] / 8:.0f} phrases)  bpm {m.get('bpm')}  "
          f"render {rep['render_s']:.1f} s  mode-violations {len(m.get('mode_violations', []))}"
          + (f"  {m['mode_violations'][:6]}" if m.get('mode_violations') else '')
          + (f"  m2/m9 clashes {len(m['clashes'])}" if 'clashes' in m else ''))
    for c in m.get('clashes', [])[:12]:
        print(f'           clash {c}')
    for k, r in rep['stems'].items():
        s, ps = r['seam'], r['pre_seam']
        ok_len = r['samples'] == r['render_samples']
        print(f"  {k:8s} {r['path']}  {r['kb']:.0f} kB  len {r['samples']} {'=' if ok_len else '≠'} render  "
              f"{'on' if abs((r['samples'] / SR) % 8.0) < 1e-6 else 'OFF'} 8 s grid")
        print(f"           LUFS {r['lufs']:6.2f} (target {r['master']['target']})  TP {r['tp']:5.2f} dBTP  LRA {r['lra']:4.1f} LU  "
              f"mode {100 * r['mode']:.1f}%")
        print(f"           seam {'PASS' if s['ok'] else 'CHECK'}: step {s['jump']:.2f}x (pre-encode {ps['jump']:.2f}x)  "
              f">7k peak {s['hf']:.1f}x vs downbeat median {s['hf_med']:.1f}x (pct {s['hf_pct']:.0f})  "
              f"flux {s['flux']:.1f} dB vs median {s['flux_med']:.1f} (pct {s['flux_pct']:.0f})")
        print(f"           bands {fmt_bands(r['bands'])}")
        if 'lift_db' in r:
            print(f"           layer lift (dB) " + ' '.join(f'{b} +{v:.1f}' for b, v in r['lift_db'].items())
                  + f"   main+layer {r['sum_lufs']:.2f} LUFS, TP {r['sum_tp']:.2f}")


# ── stings ───────────────────────────────────────────────────────────────────────────────────────
def build_sting(sid: str, spec: 'music.StingSpec', ref: str, kbps: int, tmp: str) -> dict:
    t0 = time.time()
    x = music.resolve(spec.ref)()
    x = x / (np.max(np.abs(x)) + 1e-12) * 0.9
    cs = cuelib.CueSpec(sid, lambda v: x, 'sting', ('st', spec.target_st), spec.dur, tail_floor_db=-66.0, fade_out=0.08)
    y, info = cuelib.master(x, cs)
    path = out_path(ref)
    wav = os.path.join(tmp, f'{sid}.wav')
    io.write_wav(wav, y)
    encode(wav, path, kbps)
    d = io.decode(path)
    from synth.viz import mode_energy_ratio
    allowed = BRIGHT if ('victory' in sid or 'first' in sid) else DORIAN_G
    return dict(id=sid, path=os.path.relpath(path, GAME), seconds=d.shape[1] / SR, dur=spec.dur,
                st=L.max_short_term(d), mom=L.max_momentary(d), tp=L.true_peak(d), target=spec.target_st,
                kb=os.path.getsize(path) / 1024, mode=mode_energy_ratio(d, allowed), render_s=time.time() - t0,
                gain_db=info.get('gain_db'), gr_db=info.get('limiter_gr_db'), notes=spec.notes)


def print_sting(r: dict) -> None:
    ok = r['dur'][0] <= r['seconds'] <= r['dur'][1]
    print(f"\n■ {r['id']}  {r['path']}  {r['seconds']:.2f} s {'ok' if ok else 'OUT OF WINDOW'} {r['dur']}  {r['kb']:.0f} kB")
    print(f"           short-term max {r['st']:.2f} LUFS (target {r['target']})  momentary max {r['mom']:.2f}  "
          f"TP {r['tp']:.2f} dBTP  limiter GR {r['gr_db']:.1f} dB  mode {100 * r['mode']:.1f}%")
    print(f"           {r['notes']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', default='', help='comma-separated ids (bed or sting); prefixes allowed')
    ap.add_argument('--kbps', type=int, default=112, help='Opus VBR target for main stems (default 112; layers 96)')
    ap.add_argument('--sting-kbps', type=int, default=128, help='Opus VBR target for stings (default 128)')
    ap.add_argument('--keep-wav', action='store_true', help='also write the mastered 24-bit WAV next to each OGG')
    ap.add_argument('--json', default='', help='write the QA report to this path')
    ap.add_argument('--no-extra', action='store_true', help='skip stings that are not in audio.json')
    a = ap.parse_args()
    catalog = json.load(open(CONTENT))
    only = [s for s in a.only.split(',') if s]
    pick = (lambda i: any(i.startswith(o) for o in only)) if only else (lambda i: True)
    beds = {k: v for k, v in catalog['music'].items() if pick(k)}
    stings = {k: c for k, c in catalog['cues'].items() if c.get('bus') == 'music' and pick(k)}
    extra = {} if a.no_extra else {k: s for k, s in music.EXTRA_STINGS.items() if pick(k)}
    missing = [k for k in stings if k not in music.STINGS]
    if missing:
        raise SystemExit(f'music-bus cues without a composition: {missing}')
    report = {'beds': [], 'stings': []}
    t_all = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        for bid, mdef in beds.items():
            rep = build_bed(bid, mdef, a.kbps, tmp, a.keep_wav)
            print_bed(rep)
            for r in rep['stems'].values():
                r.pop('bp', None)
            report['beds'].append(rep)
        for sid, cue in stings.items():
            for ref in cue['files']:
                r = build_sting(sid, music.STINGS[sid], ref, a.sting_kbps, tmp)
                print_sting(r)
                report['stings'].append(r)
        for sid, spec in extra.items():
            r = build_sting(sid, spec, f'assets/audio/{sid}.ogg', a.sting_kbps, tmp)
            print_sting(r)
            report['stings'].append(r)
    print(f'\n{len(report["beds"])} beds, {len(report["stings"])} stings in {time.time() - t_all:.0f} s → {os.path.relpath(OUT, GAME)}/')
    if a.json:
        with open(a.json, 'w') as f:
            json.dump(report, f, indent=1, default=float)


if __name__ == '__main__':
    main()
