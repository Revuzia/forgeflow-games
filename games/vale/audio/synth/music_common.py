"""Shared composing helpers for the VALE beds (menu, draft, match x3, postgame) and stings."""
from __future__ import annotations

import numpy as np

from . import fx
from .core import SR, hz, midi, ns, rng
from .score import Clock, Stem, merge_voice
from .theory import BRIGHT_PCS, COLOUR_PCS, check_mode, name_of, pc

# The motif (tokens.audio.motif): A4 E5 D5 B4 with beats 1 1 ½ 1½, then the ending note for two beats
MOTIF = [('A4', 1.0), ('E5', 1.0), ('D5', 0.5), ('B4', 1.5)]
ENDINGS = {'rift': 'F#5', 'victory': 'F#5', 'bridge': 'G4', 'fray': 'G#4', 'defeat': 'B4'}


def motif(stem: Stem, t0: float, beat: float, ending: str | None = None, voice: str = 'glass', vel: float = 0.5,
          pan: float = 0.0, end_beats: float = 2.0, transpose: int = 0, ring: float = 3.0, end_vel: float | None = None,
          end_ring: float | None = None, bus: str | None = None, **kw) -> float:
    """Place the motif at t0 (seconds) on `voice`; returns the time after the ending note."""
    t = t0
    for note, b in MOTIF:
        stem.add(t, voice, midi(note) + transpose, ring, vel, pan, bus=bus, **kw)
        t += b * beat
    if ending:
        stem.add(t, voice, midi(ending) + transpose, end_ring or (ring + end_beats * beat), end_vel or vel * 1.05, pan, bus=bus, **kw)
        t += end_beats * beat
    return t


def pad_chords(stem: Stem, voicings: list[list[float]], spans: list[float] | float, vel: float,
               cutoff=(380.0, 1100.0), lfo_hz: float = 0.047, attack: float = 1.6, release: float = 2.6,
               res_db: float = 2.0, pans=None, octave_shift: int = 0, loop: bool = True, offset: float = 0.0,
               bus: str | None = None, overlap: float = 0.35, sub: float = 0.0) -> None:
    """Sustained lamp-drone voices following a voice-led chord list (common tones are held; notes
    overlap the next chord by `overlap`×attack so the harmony crossfades). voicings: per chord, MIDI
    pitches (same count per chord)."""
    voices = merge_voice(voicings, spans, circular=loop)
    nv = len(voices)
    pans = pans or [(-0.45 + 0.9 * i / max(1, nv - 1)) for i in range(nv)]
    for v, notes in enumerate(voices):
        for pitch, start, dur in notes:
            p = float(pitch) + 12 * octave_shift
            t0 = offset + start
            stem.add(t0 - attack * overlap, 'drone', p, dur + release * 0.6 + attack * overlap, vel, pans[v], human=False,
                     bus=bus, cutoff=cutoff, lfo_hz=lfo_hz, lfo_phase=(lfo_hz * t0) % 1.0, attack=attack, release=release,
                     res_db=res_db, sub=sub)


def bass_line(stem: Stem, notes: list[tuple[float, float, str | float]], vel: float, cutoff=(150.0, 420.0), attack: float = 0.9,
              release: float = 1.6, sub: float = 0.25, pan: float = 0.0, bus: str | None = 'bass', res_db: float = 1.0,
              lfo_hz: float = 0.04) -> None:
    """notes: [(start_s, dur_s, pitch)] — lamp drone bass with a sine sub."""
    for t0, dur, p in notes:
        stem.add(t0 - attack * 0.3, 'drone', p, dur + release * 0.6 + attack * 0.3, vel, pan, human=False, bus=bus,
                 cutoff=cutoff, lfo_hz=lfo_hz, lfo_phase=(lfo_hz * t0) % 1.0, attack=attack, release=release, res_db=res_db, sub=sub)


def harp_figure(stem: Stem, t0: float, beat: float, pool: list[float], beats: list[float], idxs: list[int], vels: list[float],
                dur: float = 3.0, pan_of=None, bright: float = 0.35, rr0: int = 0, drift: float = 0.0, bus: str | None = None,
                human: bool | float = True, **kw) -> None:
    """A plucked figure: note k sounds at t0 + beats[k]*beat with pitch pool[idxs[k] % len(pool)]."""
    for k, (b, ix, v) in enumerate(zip(beats, idxs, vels)):
        p = pool[ix % len(pool)]
        pn = pan_of(p) if pan_of else float(np.clip(-0.4 + (midi(p) - 48) / 70, -0.6, 0.6))
        stem.add(t0 + b * beat + drift * k, 'harp', p, dur, v, pn, rr=(rr0 + k) % 4, bright=bright, bus=bus, human=human, **kw)


def pitch_pool(voicing: list[float], bass: float, lo: float = 50, hi: float = 83) -> list[float]:
    """Chord tones across the harp's range: the voicing and its octave copies, plus the bass note,
    sorted low→high and limited to [lo, hi]."""
    s = set()
    for m in list(voicing) + [bass + 12, bass + 24]:
        for o in (-24, -12, 0, 12, 24):
            if lo <= m + o <= hi:
                s.add(float(m + o))
    return sorted(s)


def mode_report(stem: Stem, allowed=COLOUR_PCS, extra_ok: set[int] | None = None) -> list[str]:
    """Pitch-class violations of the stem's pitched notes against the mode (QA)."""
    ok = set(allowed) | (extra_ok or set())
    bad = []
    for n in stem.notes:
        if n.pitch is None or n.voice in ('drum', 'esc', 'breath'):
            continue
        if pc(n.pitch) not in ok:
            bad.append(f'{n.voice}:{name_of(midi(n.pitch))}@{n.t:.1f}s')
    return bad


def ens(depth_ms: float = 2.2, rate: float = 0.21, mix: float = 0.5, seed: str = 'ens'):
    """A chorus insert for pads (width and slow movement)."""
    return lambda x, loop: fx.chorus(x, depth_ms=depth_ms, rate_hz=rate, base_ms=14.0, voices=3, mix=mix, circular=loop, seed=seed)


def eq_insert(*bands):
    return lambda x, loop: fx.eq(x, list(bands), circular=loop)


def sat_insert(drive: float = 1.6, mix: float = 0.25, asym: float = 0.0):
    return lambda x, loop: fx.saturate(x, drive, mix, asym)


# ── bed-writing kit (draft, match x3, postgame, stings) ─────────────────────────────────────────
# Chord vocabulary: name → (bass note, four rootless pad pitch classes). Every chord is D Dorian
# except the Lydian-colour chords (G#: E/D, Dlyd, Dnoon) and the bright resolves (F#: D6/9, Dnoon),
# which only the RIFT bed and the victory sting use (theory.BRIGHT_PCS).
VOC: dict[str, tuple[str, list[str]]] = {
    'Dm9': ('D2', ['F', 'A', 'C', 'E']), 'Dm11': ('D2', ['F', 'A', 'C', 'G']), 'Dmadd9': ('D2', ['F', 'A', 'D', 'E']),
    'Dsus2': ('D2', ['E', 'A', 'B', 'D']), 'Dsus4': ('D2', ['G', 'A', 'D', 'E']), 'Dm6': ('D2', ['F', 'A', 'B', 'D']),
    'Dlyd': ('D2', ['E', 'G#', 'A', 'D']), 'D6/9': ('D2', ['F#', 'A', 'B', 'E']), 'Dnoon': ('D2', ['A', 'E', 'F#', 'G#']),
    'C/D': ('D2', ['C', 'E', 'G', 'D']), 'Em7/D': ('D2', ['E', 'G', 'B', 'D']), 'E/D': ('D2', ['G#', 'B', 'D', 'E']),
    'Cmaj9': ('C2', ['E', 'G', 'B', 'D']), 'Cmaj7': ('C2', ['E', 'G', 'B', 'C']),
    'Em7': ('E2', ['G', 'B', 'D', 'A']), 'Esus4': ('E2', ['A', 'B', 'D', 'E']),
    'Fmaj9': ('F2', ['A', 'C', 'E', 'G']), 'Fmaj7': ('F2', ['A', 'C', 'E', 'F']),
    'G6/9': ('G2', ['B', 'D', 'E', 'A']), 'G6/9/B': ('B1', ['G', 'D', 'E', 'A']), 'Gsus2': ('G2', ['A', 'D', 'G', 'D']),
    'Am7': ('A1', ['C', 'E', 'G', 'B']), 'Asus4': ('A1', ['D', 'E', 'G', 'A']),
    'Bm7b5': ('B1', ['D', 'F', 'A', 'E']),
}

VEL = {'-': 0.0, '.': 0.3, 'o': 0.5, 'x': 0.75, 'X': 1.0}


def bars_of(blocks: list[tuple[str, int]]) -> list[str]:
    """[('Dm9', 2), ('G6/9', 2), …] → one chord name per bar."""
    out = []
    for name, n in blocks:
        out += [name] * n
    return out


def voicings(chords: list[str], centre: float = 62.0, lo: float = 53.0, hi: float = 75.0) -> list[list[float]]:
    """Voice-led four-note pad voicings for a chord list (one per entry). The first chord is led
    from the last one so the loop seam voice-leads too."""
    from .theory import voice_lead
    prev = None
    for _ in range(2):                         # second pass: start from the end of the first
        out = []
        for c in chords:
            prev = _open_clusters(voice_lead(prev, VOC[c][1], 4, centre=centre, lo=lo, hi=hi), lo, hi + 5)
            out.append(prev)
    return out


def _open_clusters(v: list[float], lo: float, hi: float) -> list[float]:
    """Open any minor-2nd cluster inside a pad voicing (G#3-A3, B3-C4 read as mud in a lamp-drone pad):
    the upper note goes up an octave (a major 7th instead), or the lower one down if that would leave the range."""
    v = sorted(v)
    for _ in range(4):
        for i in range(len(v) - 1):
            if v[i + 1] - v[i] == 1:
                if v[i + 1] + 12 <= hi and v[i + 1] + 12 not in v:
                    v[i + 1] += 12
                elif v[i] - 12 >= lo - 5 and v[i] - 12 not in v:
                    v[i] -= 12
                v = sorted(v)
                break
        else:
            break
    return v


def blocks(chords: list[str], bar_s: float, key=lambda c: c, circular: bool = True) -> list[tuple[float, float, str]]:
    """Merge consecutive equal key(chord) bars into (start_s, dur_s, chord) blocks; with circular the
    last block absorbs an equal first block across the loop seam."""
    out: list[list] = []
    for i, c in enumerate(chords):
        if out and key(out[-1][2]) == key(c):
            out[-1][1] += bar_s
        else:
            out.append([i * bar_s, bar_s, c])
    if circular and len(out) > 1 and key(out[0][2]) == key(out[-1][2]):
        first = out.pop(0)
        out[-1][1] += first[1]
    return [tuple(b) for b in out]


def harp_pool(voicing: list[float], bass: float, lo: float = 48, hi: float = 79) -> tuple[list[float], int]:
    """Chord tones across the harp register and the index of the root (bass+12/24) in it."""
    pool = pitch_pool(voicing, bass, lo, hi)
    root = bass + 12
    while root < lo:
        root += 12
    if root not in pool:
        pool = sorted(set(pool) | {root})
    return pool, pool.index(root)


def ostinato(stem: Stem, t0: float, beat: float, voicing: list[float], bass: float, pattern, vel: float = 1.0,
             ring: float = 0.6, lo: float = 48, hi: float = 79, bright: float = 0.3, pan_spread: float = 0.45,
             bus: str | None = None, rr0: int = 0, octave: int = 0, human: bool | float = True) -> None:
    """A root-relative harp figure over one bar. pattern: [(step16, offset, v)] where offset counts
    chord tones up (+) or down (−) from the root inside the harp register; v scales `vel`. Each note
    rings `ring` seconds and is then damped (a harpist's mute), so the buffer never truncates a ring."""
    pool, ri = harp_pool(voicing, bass, lo, hi)
    for k, (step, off, v) in enumerate(pattern):
        ix = int(np.clip(ri + off, 0, len(pool) - 1))
        p = pool[ix] + 12 * octave
        pn = float(np.clip((p - 62) / 24 * pan_spread * 2, -pan_spread, pan_spread))
        r_ = round(min(ring, 4 * beat - step * beat / 4 - 0.02), 2)     # damped at the barline (chord change)
        stem.add(t0 + step * beat / 4, 'harp', p, r_ + 0.25, v * vel, pn, human=human, bus=bus,
                 rr=(rr0 + k) % 4, bright=bright, damp_at=r_)


def drum_grid(stem: Stem, t0: float, beat: float, lanes: dict[str, str], kit: dict[str, dict], vel: float = 1.0,
              bus: str = 'drums', rr0: int = 0, human: bool | float = 6.0) -> list[tuple[float, str, float]]:
    """One bar of frame drum from 16-step strings ('-' rest, '.' 0.3, 'o' 0.5, 'x' 0.75, 'X' 1.0).
    kit[lane] = dict(stroke=, pitch=, kick=, vel=, pan=, tone_t60=). Returns the hits [(t, lane, v)]."""
    hits = []
    for lane, s in lanes.items():
        k = kit[lane]
        for i, ch in enumerate(s):
            v = VEL.get(ch, 0.0)
            if not v:
                continue
            kw = {'stroke': k.get('stroke', 'doum'), 'rr': (rr0 + i) % 4}
            if 'kick' in k:
                kw['kick'] = k['kick']
            if 'tone_t60' in k:
                kw['tone_t60'] = k['tone_t60']
            stem.add(t0 + i * beat / 4, 'drum', k.get('pitch', 'A2'), 0.9, v * k.get('vel', 0.7) * vel, k.get('pan', 0.0),
                     human=human, bus=k.get('bus', bus), **kw)
            hits.append((t0 + i * beat / 4, lane, v))
    return hits


def duck_insert(hits: list[tuple[float, float]], length: float, depth_db: float = -6.0, attack: float = 0.004,
                release: float = 0.16):
    """A bus insert that dips the bus under each hit [(t, strength 0..1)] (kick-keyed ducking: the
    pluck bass gets out of the stone kick's way). Periodic over `length` when the stem loops."""
    from .core import SR as _SR

    def fx_(x, loop):
        n = x.shape[-1]
        g = np.zeros(n)
        k = np.arange(int((attack + release * 5) * _SR))
        shape = np.where(k < attack * _SR, k / max(1.0, attack * _SR), np.exp(-(k - attack * _SR) / (release * _SR)))
        for t, v in hits:
            i0 = int(round(t * _SR))
            idx = (i0 + k) % n if loop else i0 + k
            if not loop:
                ok = (idx >= 0) & (idx < n)
                idx, sh = idx[ok], shape[ok]
            else:
                sh = shape
            np.maximum.at(g, idx, sh * v)
        return x * (10 ** (depth_db * g / 20.0))[None, :]
    return fx_


def esc_grid(stem: Stem, t0: float, beat: float, s: str, vel: float = 0.3, bus: str = 'esc', pan: float = 0.0,
             human: bool | float = 4.0, **kw) -> None:
    """Escapement on a 16-step string: 'k'/'K' tick (soft/accent), 'c'/'C' tock, '-' rest."""
    for i, ch in enumerate(s):
        if ch == '-':
            continue
        kind = 'tick' if ch in 'kK' else 'tock'
        v = vel * (1.0 if ch.isupper() else 0.55)
        stem.add(t0 + i * beat / 4, 'esc', None, 0.12, v, pan * (1 if i % 4 < 2 else -1), human=human, bus=bus,
                 kind=kind, rr=i % 4, **kw)


class PluckEnv:
    """Filter envelope for the lamp-drone pluck bass (a picklable callable, so it can sit in a Note)."""

    def __init__(self, lo: float, hi: float, tau: float):
        self.lo, self.hi, self.tau = lo, hi, tau

    def __call__(self, t):
        return self.lo + (self.hi - self.lo) * np.exp(-np.maximum(np.asarray(t, float), 0.0) / self.tau)

    def __repr__(self):
        return f'PluckEnv({self.lo:.0f},{self.hi:.0f},{self.tau:.3f})'


def pluck(stem: Stem, t: float, pitch, dur: float, vel: float, bus: str = 'pulse', lo: float = 120.0, hi: float = 900.0,
          tau: float = 0.08, sub: float = 0.25, pan: float = 0.0, human: bool | float = 4.0) -> None:
    """A lamp-drone pluck (3 detuned saws, 24 dB/oct lowpass snapping shut): bass pulse / stabs."""
    stem.add(t, 'drone', pitch, dur + 0.08, vel, pan, human=human, bus=bus, attack=0.004, release=0.07,
             cutoff_env=PluckEnv(lo, hi, tau), sub=sub)


def riser(stem: Stem, t_end: float, dur: float, vel: float, f0: float = 300.0, f1: float = 2400.0, bus: str = 'breath',
          q: float = 2.0) -> None:
    """A reversed shade-breath swell that peaks on t_end (into a downbeat)."""
    stem.add(t_end - dur, 'breath', None, dur + 0.04, vel, 0.0, human=False, bus=bus, f_start=f0, f_end=f1, q=q,
             shape='swell', peak_at=dur, curve=-3.0)


def gust(stem: Stem, t: float, dur: float, vel: float, f0: float, f1: float, bus: str = 'breath', q: float = 1.6,
         pan: float = 0.0) -> None:
    """A breath that rises and falls (wind in the gorge, an exhale under a turn)."""
    stem.add(t, 'breath', None, dur, vel, pan, human=False, bus=bus, f_start=f0, f_end=f1, q=q, shape='breath',
             peak_at=dur * 0.5)


def line(stem: Stem, t0_of, notes, voice: str = 'glass', bus: str | None = None, **kw) -> None:
    """A melody: notes = [(bar, beat, pitch, vel, ring_s[, pan])]; t0_of(bar, beat) → seconds."""
    for n in notes:
        bar, b, p, v, ring = n[:5]
        pn = n[5] if len(n) > 5 else 0.0
        if voice == 'glass':
            ds = kw.get('decay_scale', 1.0)
            stem.add(t0_of(bar, b), 'glass', p, max(ring, 5.0 * ds), v, pn, bus=bus, **kw)
        else:
            stem.add(t0_of(bar, b), voice, p, ring, v, pn, bus=bus, **kw)


def clash_report(stem: Stem, chords: list[str], V: list[list[float]], bar_s: float,
                 voices=('glass', 'bell', 'fm', 'harp'), ring_check: float = 0.75) -> list[str]:
    """Harmony QA: a melodic note that is NOT a tone of the chord under it and sounds a minor 2nd or minor
    9th against a voiced pad note or the bass (or its octaves) when it strikes, or while it still rings into
    the next chord (`ring_check` s, or until a harp note is damped). Chord tones rubbing chord tones (maj7,
    add9 colours) are the harmony's own choice and pass."""
    from .theory import name_of
    nb = len(chords)
    bad = []
    for n in stem.notes:
        if n.voice not in voices or n.pitch is None:
            continue
        p = midi(n.pitch)
        ring = min(ring_check, float(n.kw.get('damp_at', ring_check)) - 0.05) if n.voice == 'harp' else ring_check
        for dt in (0.0, ring):
            b = int((n.t + dt + 1e-6) // bar_s) % nb
            bass = midi(VOC[chords[b]][0])
            pcs_ = {int(round(q)) % 12 for q in V[b]} | {int(round(bass)) % 12}
            if int(round(p)) % 12 in pcs_:
                continue
            ref = list(V[b]) + [bass + 12 * k for k in range(4)]
            hit = [q for q in ref if abs(p - q) in (1, 13)]
            if hit:
                bad.append(f'{n.voice}:{name_of(p)}@{n.t:.2f}s vs {chords[b]} ({name_of(hit[0])})')
                break
    return bad
