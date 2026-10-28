"""Match cues: events about YOU (sfx bus, non-spatial), the enemy wind-up alarm, pings (ui bus) and the
announcer stingers (voice bus; tonal, no voice in this slice: subtitles carry the words).

Pings must be told apart instantly, from each other and from combat. They are all clean, tonal and
centred (combat is noisy and panned), and each owns a rhythm, a contour and a lead timbre:
    alert      ONE bright A6 glass strike echoing left-right                     single + echo
    danger     THREE fast dissonant F5/B5 FM pulses over a clay knock            triplet, harsh
    onmyway    a FOUR-note dial-harp run up D5-E5-G5-A5 with a little air       fast run up
    missing    G5, then a tone bending up C6 → D6 into a shade breath           a question
    assist     TWO hourbells rising D5 → A5                                     bell call
    push       a frame-drum march, tek-tek-DOUM, a D5 harp on the downbeat     percussion
    vision     a shimmer drawn in and opening on G#6 (the Lydian light)         bloom
    objective  ONE open fifth D4+A4 on the hourbell over a doum                 big single bell
    retreat    THREE notes falling A5-E5-A4 with a breath swept down            fall
Announcer stingers share the bell + drum + glass vocabulary; good news rises and ends bright
(A4-E5, F#5), bad news falls and darkens (minor thirds, low bells, breath falling).
Loudness (max momentary, asset level): pings -18, events -21..-16, stingers -18..-15.
"""
from __future__ import annotations

from cuelib import cue
from synth import fx
from synth import instruments as I
from synth import sfx as S
from synth.core import hz

from .kit import (Layers, R, at_len, bell, breath, crackle, crumble, drum, esc, finish, fm_tone, glass, harp, hollow,
                  lp, pane, rev, roll, room, sear, shimmer, spread, tink)

EVT = (0.3, 2.6)
PING = (0.3, 1.6)
STING = (1.0, 4.0)
EVTK = dict(tail_floor_db=-54.0, fade_out=0.04)           # mastering profiles (cuelib.CueSpec kwargs)
PINGK = dict(tail_floor_db=-52.0, fade_out=0.03)
STINGK = dict(tail_floor_db=-56.0, fade_out=0.06)


# ── events about you ─────────────────────────────────────────────────────────────────────────────
@cue('m_level_up', 'match', ('m', -18.0), (0.8, 2.2), **EVTK)
def m_level_up(v: int):
    """Level up (tokens: E5-B4 on dawnglass): a shimmer drawn in, then E5 falling to B4, lit from above
    by a soft E6 shimmer and a rising sparkle."""
    r = R('m_level_up')
    L = Layers(1.5)
    L.add(rev(shimmer('B5', 0.18, 0.6, decay=0.15, seed='lu'), 0.02), 0.0, peak_db=-12)
    L.add(glass('E5', 1.3, 0.9, decay=0.45, bright=0.85, seed='lu1'), 0.12, peak_db=0)
    L.add(glass('B4', 1.3, 0.85, decay=0.5, bright=0.8, seed='lu2'), 0.26, peak_db=-1)
    L.add(shimmer('E6', 1.0, 0.5, decay=0.6, index=2.0, seed='lu'), 0.12, peak_db=-12)
    L.add(S.sparkle(r, 0.5, 10, 88, 100, t60=0.12, rise=True), 0.12, peak_db=-15)
    L.add(S.thump(0.25, 200, 110, 0.02, 0.15, 1.2), 0.12, peak_db=-14)
    return finish(room(L.out(), 'plate', wet=0.18), hp_hz=90, eq=[('peak', 3300, -2, 0.8)])


@cue('m_takedown', 'match', ('m', -16.0), (0.6, 1.8), **EVTK)
def m_takedown(v: int):
    """You took a fighter down: a punch, a bright A4 hourbell and an E6 glass 'ching' a beat after, with
    shards flying. Satisfying, quick, unmistakably yours."""
    r = R('m_takedown')
    L = Layers(1.2)
    L.add(S.thump(0.35, 160, 50, 0.02, 0.22, 2.6), 0.0, peak_db=-4)
    L.add(S.snap(r, 3000, 2.0), 0.0, peak_db=-9)
    L.add(bell('A4', 1.2, 0.9, decay=0.2, bright=1.0, seed='td'), 0.0, peak_db=0)
    L.add(glass('E6', 0.8, 0.8, decay=0.25, bright=0.8, seed='td'), 0.035, peak_db=-5)
    L.add(S.shards(r, 0.5, 16, 2500, 9000, 0.06), 0.0, peak_db=-12, width=0.8)
    L.add(shimmer('A6', 0.6, 0.5, decay=0.35, index=2.5, seed='td'), 0.035, peak_db=-14)
    return finish(room(L.out(), 'plate', wet=0.15), hp_hz=40, eq=[('peak', 3300, -2.5, 0.8)])


@cue('m_ally_down', 'match', ('m', -18.0), (0.8, 2.4), **EVTK)
def m_ally_down(v: int):
    """An ally fell: a soft, darkened D4 bell with a B4 glass above it and breath falling away."""
    L = Layers(1.6)
    L.add(lp(bell('D4', 1.6, 0.75, decay=0.25, bright=0.55, seed='ad'), 3000), 0.0, peak_db=0)
    L.add(glass('B4', 1.4, 0.6, decay=0.45, bright=0.5, seed='ad'), 0.03, peak_db=-7)
    L.add(breath(1.0, 1800, 300, shape='breath', q=1.6, seed='ad', peak_at=0.1), 0.0, peak_db=-9)
    L.add(drum('D2', 0.5, 'ghost', seed='ad', dur=0.5, t60=0.3), 0.0, peak_db=-11)
    return finish(room(L.out(), 'hall', wet=0.12), hp_hz=60, lp_hz=8000)


@cue('m_self_down', 'match', ('m', -16.0), (1.5, 3.2), **EVTK)
def m_self_down(v: int):
    """You died: a muffled blow, a low D3 bell whose brightness closes as the world goes dark, a held B4
    glass (the defeat colour), breath falling from 2.4 kHz to 180 Hz and two slow heartbeats."""
    L = Layers(2.6)
    L.add(lp(S.thump(0.6, 120, 40, 0.04, 0.45, 2.0), 1500), 0.0, peak_db=0)
    L.add(S.lp_sweep(bell('D3', 2.4, 0.85, decay=0.35, bright=0.6, seed='sd'), 4000, 500), 0.02, peak_db=-2)
    L.add(glass('B4', 2.0, 0.6, decay=0.6, bright=0.4, seed='sd'), 0.25, peak_db=-10)
    L.add(breath(1.8, 2400, 180, shape='breath', q=1.8, seed='sd', peak_at=0.12), 0.0, peak_db=-6)
    L.add(drum('D2', 0.55, 'doum', seed='sd1', dur=0.6, t60=0.35, kick=0.8), 0.55, peak_db=-10)
    L.add(drum('D2', 0.4, 'doum', seed='sd2', dur=0.6, t60=0.35, kick=0.8), 1.25, peak_db=-14)
    return finish(room(L.out(), 'hall', wet=0.16), hp_hz=35, lp_hz=7000)


@cue('m_respawn', 'match', ('m', -18.0), (1.0, 2.4), **EVTK)
def m_respawn(v: int):
    """Respawn: light gathering (a glass chord drawn in backwards and breath rising) that strikes
    D5-A5-D6 forward, with an A5 shimmer and sparkle. Re-lit."""
    r = R('m_respawn')
    L = Layers(1.6)
    ch = Layers(0.6)
    for i, note in enumerate(('D5', 'A5')):
        ch.add(glass(note, 0.6, 0.7, decay=0.35, seed=f'rs{i}'), 0.0, peak_db=-2 * i)
    L.add(rev(ch.out(), 0.05), 0.0, peak_db=-5)
    L.add(breath(0.5, 400, 3500, shape='swell', q=1.4, seed='rs', vel=0.6), 0.0, peak_db=-11)
    t = 0.5
    for i, (note, g) in enumerate((('D5', 0), ('A5', -2), ('D6', -5))):
        L.add(glass(note, 1.2, 0.85, decay=0.45, bright=0.8, seed=f'rf{i}'), t + 0.01 * i, peak_db=g, pan=(-0.2, 0.2, 0.0)[i])
    L.add(shimmer('A5', 1.0, 0.6, decay=0.6, index=2.5, seed='rs'), t, peak_db=-10)
    L.add(S.sparkle(r, 0.6, 12, 86, 102, t60=0.14, rise=True), t - 0.05, peak_db=-15)
    L.add(S.thump(0.2, 180, 100, 0.015, 0.12, 1.2), t, peak_db=-14)
    return finish(room(L.out(), 'plate', wet=0.18), hp_hz=100, eq=[('peak', 3300, -2, 0.8)])


@cue('m_wave_spawn', 'match', ('m', -19.0), (1.2, 2.6), **EVTK)
def m_wave_spawn(v: int):
    """The first Wick wave: three lamps catching light left, centre, right (a breathy whumph and a little
    crackle each) on a frame-drum doum, ghost, doum, and a soft A3 bell."""
    L = Layers(2.0)
    for i, (t, p, g) in enumerate(((0.0, -0.45, -4), (0.18, 0.0, -3), (0.36, 0.45, -2))):
        L.add(breath(0.28, 300, 1200, shape='breath', q=1.2, seed=f'ws{i}', peak_at=0.05), t, peak_db=g, pan=p)
        L.add(crackle(R('m_wave_spawn', f'c{i}'), 0.3, 50, 1200, 5000, hiss=0.2, decay_s=0.3), t + 0.02, peak_db=g - 10, pan=p)
    L.add(drum('D2', 0.85, 'doum', seed='ws1', dur=0.8, t60=0.45), 0.0, peak_db=-2)
    L.add(drum('D3', 0.5, 'ghost', seed='ws2', dur=0.4, t60=0.25), 0.18, peak_db=-10)
    L.add(drum('D2', 0.8, 'doum', seed='ws3', dur=0.8, t60=0.45), 0.36, peak_db=-4)
    L.add(bell('A3', 1.6, 0.6, decay=0.2, bright=0.7, seed='ws'), 0.36, peak_db=-6)
    return finish(room(L.out(), 'stone', wet=0.14), hp_hz=35, eq=[('peak', 3300, -2, 0.8)])


@cue('m_recall_start', 'match', ('m', -20.0), (0.9, 2.0), **EVTK)
def m_recall_start(v: int):
    """Recall begins: the escapement winding (tick-tock accelerating), breath swelling, and a soft D5
    glass with an A5 shimmer as the dial turns you home."""
    L = Layers(1.5)
    for i, (t, g) in enumerate(((0.0, -6), (0.2, -5), (0.36, -4), (0.49, -3), (0.6, -2))):
        L.add(at_len(esc('tick' if i % 2 == 0 else 'tock', 0.8, rr=i, seed='rc'), 0.06), t, peak_db=g)
    L.add(breath(1.0, 300, 1500, shape='swell', q=1.5, seed='rc', vel=0.6), 0.0, peak_db=-9)
    L.add(glass('D5', 1.0, 0.6, decay=0.4, bright=0.5, seed='rc'), 0.6, peak_db=-3)
    L.add(shimmer('A5', 0.8, 0.4, decay=0.5, index=1.5, seed='rc'), 0.62, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=120, eq=[('peak', 3000, -2.5, 0.8)])


@cue('m_recall_done', 'match', ('m', -19.0), (0.8, 2.0), **EVTK)
def m_recall_done(v: int):
    """Home: a breath rushing in, then a D5-A5-E6 glass bloom with an A6 shimmer and sparkle settling."""
    r = R('m_recall_done')
    L = Layers(1.4)
    L.add(breath(0.25, 500, 3000, shape='swell', q=1.4, seed='rd'), 0.0, peak_db=-8)
    for i, note in enumerate(('D5', 'A5', 'E6')):
        L.add(glass(note, 1.1, 0.8, decay=0.4, seed=f'rd{i}'), 0.22 + 0.01 * i, peak_db=-2 * i, pan=(-0.25, 0.25, 0.0)[i])
    L.add(shimmer('A6', 0.8, 0.5, decay=0.5, index=2.0, seed='rd'), 0.22, peak_db=-13)
    L.add(drum('D2', 0.4, 'ghost', seed='rd', dur=0.4, t60=0.25), 0.22, peak_db=-12)
    L.add(S.sparkle(r, 0.6, 10, 86, 100, t60=0.14, decay_level=1.2), 0.25, peak_db=-15)
    return finish(room(L.out(), 'plate', wet=0.18), hp_hz=100, eq=[('peak', 3300, -2, 0.8)])


@cue('m_gleam', 'match', ('m', -21.0), (0.1, 0.4), variants=3, **EVTK)
def m_gleam(v: int):
    """Gleam earned (every last hit): two quick glints of light, A5 then D6, 35 ms apart, like small coins
    of glass. Pitched low enough that a farming lane of them never tires the ear. Three round-robin takes (a wave
    cleared at once earns several in a second): the same notes, each glass struck anew, the gap 30-40 ms."""
    k = '' if v == 0 else f'v{v}'
    L = Layers(0.3)
    L.add(glass('A5', 0.24, 0.8, decay=0.07, bright=0.7, seed=f'gl1{k}'), 0.0, peak_db=0)
    L.add(glass('D6', 0.22, 0.75, decay=0.06, bright=0.65, seed=f'gl2{k}'), (0.035, 0.03, 0.04)[v % 3], peak_db=-2)
    return finish(spread(L.out(), 0.3), hp_hz=400, eq=[('peak', 3300, -3, 0.8), ('high', 8000, -3)])


@cue('m_sunmote', 'match', ('m', -19.0), (0.5, 1.6), **EVTK)
def m_sunmote(v: int):
    """Sunmote picked up: a warm rush in and three glass notes climbing D5-A5-D6 over a soft harp D4,
    with an A6 shimmer: light poured into you."""
    L = Layers(1.0)
    L.add(breath(0.16, 600, 3000, shape='swell', q=1.4, seed='sm', vel=0.6), 0.0, peak_db=-10)
    L.add(harp('D4', 0.8, 0.5, bright=0.4, seed='sm'), 0.06, peak_db=-12)
    for i, note in enumerate(('D5', 'A5', 'D6')):
        L.add(glass(note, 0.8, 0.8, decay=0.25, seed=f'sm{i}'), 0.06 + 0.05 * i, peak_db=-1 - 0.5 * i, pan=-0.2 + 0.2 * i)
    L.add(shimmer('A6', 0.6, 0.5, decay=0.4, index=2.0, seed='sm'), 0.16, peak_db=-12)
    return finish(room(L.out(), 'glass', wet=0.14), hp_hz=100, eq=[('peak', 3300, -2, 0.8)])


@cue('m_enemy_windup', 'match', ('m', -16.0), (0.1, 0.3), **EVTK)
def m_enemy_windup(v: int):
    """An enemy T3+ wind-up near you (tokens: one shade-breath swell 2 → 5 kHz, 120 ms): the swell cut
    sharp at its crest, a faint reversed hollow under it for weight. Every big enemy threat shares it."""
    r = R('m_enemy_windup')
    L = Layers(0.16)
    L.add(breath(0.15, 2000, 5000, shape='swell', q=3.0, seed='ew', peak_at=0.12, curve=-2.0, width=0.5), 0.0, peak_db=0)
    L.add(rev(at_len(hollow(hz('D3'), 0.2, 0.25, r), 0.12, 0.002), 0.03), 0.0, peak_db=-13)
    return finish(L.out(), hp_hz=100)


# ── pings (ui bus) ───────────────────────────────────────────────────────────────────────────────
@cue('m_ping_alert', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_alert(v: int):
    """Ping 'look here': ONE bright A6 glass strike with an FM glint, echoing left-right twice."""
    L = Layers(0.5)
    L.add(glass('A6', 0.45, 0.95, decay=0.18, bright=0.6, seed='pa'), 0.0, peak_db=0)
    L.add(glass('A5', 0.45, 0.8, decay=0.2, bright=0.5, seed='pa5'), 0.0, peak_db=-4)
    L.add(shimmer('A6', 0.35, 0.5, decay=0.25, index=1.4, seed='pa'), 0.0, peak_db=-12)
    x = fx.stereo_delay(L.out(), 0.11, 0.17, feedback=0.32, cross=1.0, damp_hz=4500, mix=0.38, tail_s=0.5)
    return finish(x, hp_hz=300, eq=[('peak', 3300, -3, 0.8)])


@cue('m_ping_danger', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_danger(v: int):
    """Ping 'danger': THREE fast pulses of a dissonant F5+B5 FM dyad over a clay knock. Urgent, rough."""
    r = R('m_ping_danger')
    L = Layers(0.45)
    for i, t in enumerate((0.0, 0.075, 0.15)):
        g = -1.0 * i
        L.add(fm_tone(hz('B5'), hz('B5'), 0.12, ratio=3.5, i0=1.25, i1=0.3, t60=0.09, curve=0.0), t, peak_db=g)
        L.add(fm_tone(hz('F5'), hz('F5'), 0.12, ratio=3.5, i0=1.25, i1=0.3, t60=0.09, curve=0.0), t, peak_db=g - 2)
    L.add(S.knock(r, hz('D3'), 0.08, 5, 'clay'), 0.0, peak_db=-6)
    L.add(S.thump(0.12, 200, 110, 0.01, 0.07, 1.5), 0.0, peak_db=-9)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=90, eq=[('peak', 3300, -2.5, 0.8)])


@cue('m_ping_onmyway', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_onmyway(v: int):
    """Ping 'on my way': a quick FOUR-note dial-harp run up D5-E5-G5-A5 with air moving past."""
    r = R('m_ping_onmyway')
    L = Layers(0.6)
    for i, note in enumerate(('D5', 'E5', 'G5', 'A5')):
        L.add(harp(note, 0.45, 0.7 + 0.05 * i, bright=0.55, seed='omw', rr=i), 0.045 * i, peak_db=-1.5 + 0.5 * i, pan=-0.3 + 0.2 * i)
    L.add(tink(hz('A6'), 0.2, 0.15, bright=0.3), 0.135, peak_db=-13)
    L.add(S.whoosh(r, 0.22, 800, 2500, q=1.2, peak_at=0.6), 0.0, peak_db=-15, width=0.6)
    return finish(room(L.out(), 'wood', wet=0.1), hp_hz=150, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_missing', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_missing(v: int):
    """Ping 'enemy missing': a question. G5 glass, then a tone that bends up C6 → D6 and fades into a
    shade breath (they went into the dark)."""
    L = Layers(0.8)
    L.add(glass('G5', 0.4, 0.8, decay=0.15, bright=0.6, seed='pm'), 0.0, peak_db=0)
    L.add(fm_tone(hz('C6'), hz('D6'), 0.38, ratio=2.32, i0=0.9, i1=0.2, t60=0.32, curve=-1.5), 0.13, peak_db=-1)
    L.add(breath(0.45, 1500, 500, shape='breath', q=1.6, seed='pm', peak_at=0.15, vel=0.6), 0.15, peak_db=-12)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=200, lp_hz=8000, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_assist', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_assist(v: int):
    """Ping 'assist me': TWO hourbells rising D5 → A5, a call for help that carries."""
    L = Layers(1.1)
    L.add(bell('D5', 1.0, 0.8, decay=0.18, seed='pas1'), 0.0, peak_db=-1)
    L.add(bell('A5', 1.0, 0.85, decay=0.2, seed='pas2'), 0.12, peak_db=0)
    L.add(shimmer('A6', 0.5, 0.4, decay=0.3, index=1.5, seed='pas'), 0.12, peak_db=-15)
    return finish(room(L.out(), 'plate', wet=0.12), hp_hz=200, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_push', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_push(v: int):
    """Ping 'push': a frame-drum march, tek-tek-DOUM, with a D5 harp and A5 glass on the downbeat."""
    L = Layers(0.7)
    L.add(drum('D3', 0.7, 'tek', seed='pp1', dur=0.25, t60=0.12), 0.0, peak_db=-5)
    L.add(drum('D3', 0.75, 'tek', seed='pp2', dur=0.25, t60=0.12, rr=1), 0.1, peak_db=-4)
    L.add(drum('D2', 0.9, 'doum', seed='pp3', dur=0.6, t60=0.35, kick=0.4), 0.2, peak_db=-3)
    L.add(harp('D5', 0.5, 0.8, bright=0.55, seed='pp'), 0.2, peak_db=-3)
    L.add(glass('A5', 0.5, 0.7, decay=0.18, seed='pp'), 0.205, peak_db=-8)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=50, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_vision', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_vision(v: int):
    """Ping 'vision': light opening like an eye. A shimmer drawn in backwards blooms on G#6 (the Lydian
    colour), a D6 glass under it and a little sparkle."""
    r = R('m_ping_vision')
    L = Layers(0.8)
    L.add(rev(shimmer('G#6', 0.2, 0.6, decay=0.2, index=2.5, seed='pv'), 0.02), 0.0, peak_db=-5)
    L.add(shimmer('G#6', 0.6, 0.8, decay=0.4, index=3.0, seed='pvx'), 0.19, peak_db=0)
    L.add(glass('D6', 0.6, 0.7, decay=0.25, seed='pv'), 0.19, peak_db=-5)
    L.add(S.sparkle(r, 0.35, 6, 90, 100, t60=0.1, pcs=(2, 8, 9)), 0.2, peak_db=-15)
    return finish(room(L.out(), 'glass', wet=0.14), hp_hz=300, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_objective', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_objective(v: int):
    """Ping 'objective': ONE open fifth, D4+A4, struck on the hourbell over a doum, a D5 glass on top."""
    L = Layers(1.3)
    L.add(drum('D2', 0.85, 'doum', seed='po', dur=0.7, t60=0.4), 0.0, peak_db=-4)
    L.add(bell('D4', 1.3, 0.85, decay=0.22, seed='po1'), 0.0, peak_db=0)
    L.add(bell('A4', 1.2, 0.8, decay=0.2, seed='po2'), 0.004, peak_db=-2)
    L.add(glass('D5', 0.9, 0.6, decay=0.3, seed='po'), 0.004, peak_db=-9)
    return finish(room(L.out(), 'plate', wet=0.12), hp_hz=50, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ping_retreat', 'ping', ('m', -18.0), PING, **PINGK)
def m_ping_retreat(v: int):
    """Ping 'retreat': THREE notes falling fast, A5-E5-A4 (glass on bell), a breath swept down under them."""
    L = Layers(0.9)
    for i, note in enumerate(('A5', 'E5', 'A4')):
        L.add(glass(note, 0.6, 0.85, decay=0.2, bright=0.75, seed=f'pr{i}'), 0.065 * i, peak_db=0 - 0.5 * i, pan=0.25 - 0.25 * i)
        L.add(bell(note, 0.6, 0.6, decay=0.08, seed=f'pr{i}'), 0.065 * i, peak_db=-8)
    L.add(breath(0.32, 3000, 600, shape='breath', q=1.5, seed='pr', peak_at=0.06, vel=0.6), 0.0, peak_db=-10)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=150, eq=[('peak', 3300, -2, 0.8)])


# ── announcer stingers (voice bus) ───────────────────────────────────────────────────────────────
@cue('m_countdown', 'voice', ('m', -18.0), (0.3, 1.0), **STINGK)
def m_countdown(v: int):
    """Countdown beat: a short A4 hourbell with the escapement's tock in it and an A5 glass edge."""
    L = Layers(0.7)
    L.add(bell('A4', 0.7, 0.85, decay=0.1, bright=0.8, seed='cd'), 0.0, peak_db=0)
    L.add(at_len(esc('tock', 0.9, seed='cd'), 0.06), 0.0, peak_db=-7)
    L.add(glass('A5', 0.5, 0.6, decay=0.1, seed='cd'), 0.0, peak_db=-10)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=80, eq=[('peak', 3300, -2, 0.8)])


@cue('m_match_start', 'voice', ('m', -15.0), STING, **STINGK)
def m_match_start(v: int):
    """The match begins: two stone-kicked doums, D3 and A3 bells, then the motif's opening A4 → E5 on
    dawnglass over the hall. The dial wakes."""
    L = Layers(3.0)
    L.add(drum('D2', 1.0, 'doum', seed='ms1', dur=1.0, t60=0.55, kick=1.4), 0.0, peak_db=-2)
    L.add(drum('D2', 0.85, 'doum', seed='ms2', dur=1.0, t60=0.55, kick=1.2), 0.5, peak_db=-4)
    L.add(bell('D3', 2.6, 0.9, decay=0.4, seed='ms1'), 0.0, peak_db=-1)
    L.add(bell('A3', 2.4, 0.8, decay=0.35, seed='ms2'), 0.004, peak_db=-4)
    L.add(breath(0.48, 300, 2500, shape='swell', q=1.4, seed='ms', vel=0.6), 0.02, peak_db=-14)
    L.add(glass('A4', 2.0, 0.85, decay=0.6, bright=0.9, seed='ms1'), 0.5, peak_db=-2)
    L.add(glass('E5', 2.0, 0.9, decay=0.7, bright=0.9, seed='ms2'), 0.75, peak_db=-1)
    L.add(shimmer('E6', 1.4, 0.5, decay=0.8, index=2.0, seed='ms'), 0.75, peak_db=-12)
    return finish(room(L.out(), 'hall', wet=0.2), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('m_sudden_death', 'voice', ('m', -15.0), STING, **STINGK)
def m_sudden_death(v: int):
    """Sudden death: a frame-drum roll accelerating for 1.2 s into a doum, a D3 bell against G#3 (the
    tritone colour), a lamp drone swelling under breath. Tense, not panicked."""
    L = Layers(3.2)
    L.add(roll('D2', 1.2, 5, 24, 0.15, 0.9, seed='sdr'), 0.0, peak_db=-3)
    L.add(drum('D2', 1.0, 'doum', seed='sdd', dur=1.0, t60=0.6, kick=1.5), 1.2, peak_db=0)
    L.add(bell('D3', 2.0, 0.85, decay=0.35, bright=0.8, seed='sd1'), 1.2, peak_db=-2)
    L.add(bell('G#3', 2.0, 0.8, decay=0.32, bright=0.8, seed='sd2'), 1.205, peak_db=-4)
    L.add(I.lamp_drone(hz('D2'), 3.0, 0.6, seed='sd', cutoff=(300.0, 1200.0), lfo_hz=0.25, attack=1.1, release=1.4), 0.0, peak_db=-8)
    L.add(breath(1.2, 300, 2500, shape='swell', q=1.4, seed='sd', vel=0.6), 0.0, peak_db=-12)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('m_objective_ally', 'voice', ('m', -16.0), STING, **STINGK)
def m_objective_ally(v: int):
    """Your team took an objective: a doum and a D4 bell under A4-E5-F#5 rising on glass, the bright
    F#5 ending (the bible's victory colour) with shimmer and sparkle."""
    r = R('m_objective_ally')
    L = Layers(2.4)
    L.add(drum('D2', 0.9, 'doum', seed='oa', dur=0.9, t60=0.5), 0.0, peak_db=-3)
    L.add(bell('D4', 2.2, 0.85, decay=0.3, seed='oa'), 0.0, peak_db=-2)
    for i, note in enumerate(('A4', 'E5', 'F#5')):
        L.add(glass(note, 1.8, 0.8 + 0.05 * i, decay=0.5, bright=0.85, seed=f'oa{i}'), 0.14 * i, peak_db=-3 + i, pan=-0.2 + 0.2 * i)
    L.add(shimmer('F#6', 1.2, 0.5, decay=0.7, index=2.0, seed='oa'), 0.28, peak_db=-12)
    L.add(S.sparkle(r, 0.8, 12, 86, 102, t60=0.15, rise=True, pcs=(2, 4, 6, 9, 11)), 0.28, peak_db=-15)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=35, eq=[('peak', 3300, -2, 0.8)])


@cue('m_objective_enemy', 'voice', ('m', -16.0), STING, **STINGK)
def m_objective_enemy(v: int):
    """The enemy took an objective: a muffled doum, D3 bell darkened by F3 (a minor third), glass falling
    E5 → B4 and breath sinking away."""
    L = Layers(2.4)
    L.add(lp(drum('D2', 0.9, 'doum', seed='oe', dur=0.9, t60=0.5), 900), 0.0, peak_db=-2)
    L.add(bell('D3', 2.2, 0.85, decay=0.32, bright=0.7, seed='oe1'), 0.0, peak_db=-1)
    L.add(bell('F3', 2.0, 0.75, decay=0.28, bright=0.65, seed='oe2'), 0.02, peak_db=-5)
    L.add(glass('E5', 1.4, 0.75, decay=0.45, bright=0.7, seed='oe1'), 0.1, peak_db=-4)
    L.add(glass('B4', 1.8, 0.75, decay=0.55, bright=0.6, seed='oe2'), 0.3, peak_db=-3)
    L.add(breath(1.2, 1500, 250, shape='breath', q=1.6, seed='oe', peak_at=0.2), 0.0, peak_db=-11)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=35, lp_hz=7000)


@cue('m_eliminated', 'voice', ('m', -16.0), STING, **STINGK)
def m_eliminated(v: int):
    """Eliminated (FRAY): dignified, final. A D3 bell under a soft Dsus2 (E4, A4) and the defeat ending,
    B4 held in glass, breath fading."""
    L = Layers(3.0)
    L.add(drum('D2', 0.5, 'ghost', seed='el', dur=0.6, t60=0.35), 0.0, peak_db=-12)
    L.add(bell('D3', 2.8, 0.8, decay=0.45, bright=0.55, seed='el'), 0.0, peak_db=-1)
    L.add(glass('E4', 2.4, 0.6, decay=0.8, bright=0.6, seed='el1'), 0.0, peak_db=-7)
    L.add(glass('A4', 2.4, 0.6, decay=0.8, bright=0.6, seed='el2'), 0.01, peak_db=-7)
    L.add(glass('B4', 2.6, 0.8, decay=1.0, bright=0.7, seed='el3'), 0.4, peak_db=-2)
    L.add(breath(2.0, 1200, 300, shape='breath', q=1.6, seed='el', peak_at=0.4, vel=0.6), 0.0, peak_db=-14)
    return finish(room(L.out(), 'hall', wet=0.2), hp_hz=35, lp_hz=9000)


@cue('m_announce_minor', 'voice', ('m', -18.0), (0.6, 2.0), **STINGK)
def m_announce_minor(v: int):
    """A minor announcement: a D5+A5 glass fifth over a frame-drum tek, a D6 shimmer, the plate."""
    L = Layers(1.2)
    L.add(drum('D3', 0.6, 'tek', seed='am', dur=0.25, t60=0.12), 0.0, peak_db=-9)
    L.add(glass('D5', 1.1, 0.8, decay=0.35, seed='am1'), 0.0, peak_db=0)
    L.add(glass('A5', 1.0, 0.75, decay=0.32, seed='am2'), 0.006, peak_db=-2)
    L.add(shimmer('D6', 0.8, 0.4, decay=0.4, index=1.6, seed='am'), 0.0, peak_db=-14)
    return finish(room(L.out(), 'plate', wet=0.18), hp_hz=100, eq=[('peak', 3300, -2, 0.8)])


@cue('m_announce_major', 'voice', ('m', -16.0), STING, **STINGK)
def m_announce_major(v: int):
    """A major announcement (first blood, ace, objectives, structures): a doum and an A3 bell under the
    motif's head A4-E5-D5, quick, with an E6 shimmer in the hall."""
    L = Layers(2.4)
    L.add(drum('D2', 0.9, 'doum', seed='aM', dur=0.9, t60=0.5, kick=1.2), 0.0, peak_db=-2)
    L.add(bell('A3', 2.0, 0.8, decay=0.3, seed='aM'), 0.0, peak_db=-3)
    for i, note in enumerate(('A4', 'E5', 'D5')):
        L.add(glass(note, 1.8, 0.85, decay=0.5, bright=0.85, seed=f'aM{i}'), 0.11 * i, peak_db=-2 + 0.5 * i, pan=(-0.2, 0.2, 0.0)[i])
    L.add(shimmer('E6', 1.2, 0.5, decay=0.7, index=2.0, seed='aM'), 0.11, peak_db=-12)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=35, eq=[('peak', 3300, -2, 0.8)])


# ── the announcer's bell language (final parity AUD-3; the engine speaks one line at a time) ─────────────────
# A world event is ONE line on the voice bus. The lines share the hourbell and the dawnglass, and each event class
# owns a shape you can tell without the banner: a toll (takedowns: one high toll for the first, n rising tolls for
# n in quick succession), a fall of glass (a run ended), a low hourbell (structures: your loss hangs on Dsus2, theirs
# resolves to the bright F#), and a timbre per named objective (Sunsplinter: struck noon glass splitting into
# shards; Longshade: a long shade breath through a hollow stone tube). VALE's own: no voice, no words.
TOLL_NOTES = ('A4', 'D5', 'E5', 'A5', 'D6')     # rising through D Dorian; the fifth toll is the octave
TOLL_GAP = 0.17                                 # s between tolls: quick, but each one a separate strike
ANNK = dict(tail_floor_db=-56.0, fade_out=0.06)


def toll(L: Layers, note: str, t: float, gain_db: float, seed: str, pan: float = 0.0, bright: float = 0.95) -> None:
    """One toll: an hourbell struck hard with a dawnglass edge an octave up (so it reads on a laptop) and a tick of
    the escapement for the strike."""
    L.add(bell(note, 1.6, 0.9, decay=0.3, bright=bright, seed=seed), t, peak_db=gain_db, pan=pan)
    L.add(glass(I_up(note), 0.9, 0.7, decay=0.25, bright=0.8, seed=seed + 'g'), t + 0.002, peak_db=gain_db - 7, pan=pan)
    L.add(at_len(esc('tick', 0.8, seed=seed), 0.04), t, peak_db=gain_db - 12, pan=pan)


def I_up(note: str) -> str:
    """The same note an octave up ('A4' → 'A5')."""
    i = len(note) - 1
    while i > 0 and note[i - 1].isdigit():
        i -= 1
    return note[:i] + str(int(note[i:]) + 1)


@cue('m_ann_first', 'voice', ('m', -16.0), (1.2, 3.0), **ANNK)
def m_ann_first(v: int):
    """First takedown of the match: ONE high toll (A5) on the hourbell with its glass octave, a doum under it and
    a shimmer left ringing. The count is open."""
    L = Layers(2.2)
    L.add(drum('D2', 0.8, 'doum', seed='af', dur=0.8, t60=0.45, kick=1.0), 0.0, peak_db=-6)
    toll(L, 'A5', 0.0, 0, 'af')
    L.add(shimmer('E6', 1.4, 0.5, decay=0.8, index=2.0, seed='af'), 0.01, peak_db=-14)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=60, eq=[('peak', 3300, -2, 0.8)])


def multi_toll(n: int, seed: str):
    """n tolls rising (TOLL_NOTES), each brighter and a little louder; the full peal (5) lands its octave over a
    doum with sparkle."""
    r = R(f'm_ann_toll_{n}')
    L = Layers(1.9 + TOLL_GAP * n)
    notes = TOLL_NOTES[-n:] if n < 5 else TOLL_NOTES
    for i, note in enumerate(notes):
        pan = (-0.25 + 0.5 * i / max(1, n - 1)) if n > 1 else 0.0
        toll(L, note, TOLL_GAP * i, -2.5 * (n - 1 - i) / max(1, n - 1), f'{seed}{i}', pan=pan, bright=0.8 + 0.05 * i)
    end = TOLL_GAP * (n - 1)
    L.add(drum('D2', 0.6 + 0.08 * n, 'doum', seed=seed, dur=0.8, t60=0.45, kick=0.8 + 0.1 * n), end, peak_db=-6)
    if n >= 4:
        L.add(shimmer(I_up(notes[-1]), 1.2, 0.5, decay=0.8, index=2.5, seed=seed), end, peak_db=-13)
    if n == 5:
        L.add(S.sparkle(r, 0.9, 14, 86, 104, t60=0.15, rise=True), end, peak_db=-15)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=60, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ann_toll_2', 'voice', ('m', -16.0), (1.4, 3.2), **ANNK)
def m_ann_toll_2(v: int):
    """Two takedowns in quick succession: two tolls rising A5 → D6."""
    return multi_toll(2, 'at2')


@cue('m_ann_toll_3', 'voice', ('m', -15.5), (1.5, 3.4), **ANNK)
def m_ann_toll_3(v: int):
    """Three: E5 → A5 → D6."""
    return multi_toll(3, 'at3')


@cue('m_ann_toll_4', 'voice', ('m', -15.0), (1.6, 3.6), **ANNK)
def m_ann_toll_4(v: int):
    """Four: D5 → E5 → A5 → D6, a shimmer on the last."""
    return multi_toll(4, 'at4')


@cue('m_ann_toll_5', 'voice', ('m', -14.5), (1.7, 3.8), **ANNK)
def m_ann_toll_5(v: int):
    """The full peal: A4 → D5 → E5 → A5 → D6, shimmer and sparkle on the octave."""
    return multi_toll(5, 'at5')


@cue('m_ann_shutdown', 'voice', ('m', -16.0), (0.8, 2.6), **ANNK)
def m_ann_shutdown(v: int):
    """A run ended (a shutdown): a glass strike that cracks, then glass FALLING E6 → B5 → G5 → D5 (each shorter),
    shards spilling after it and a muffled doum: something bright was taken down."""
    r = R('m_ann_shutdown')
    L = Layers(1.8)
    L.add(S.snap(r, 3200, 2.0), 0.0, peak_db=-10)
    for i, note in enumerate(('E6', 'B5', 'G5', 'D5')):
        L.add(glass(note, 1.0 - 0.15 * i, 0.85, decay=0.4 - 0.06 * i, bright=0.85, seed=f'sh{i}'), 0.075 * i, peak_db=-0.5 * i,
              pan=0.3 - 0.2 * i)
    L.add(S.shards(r, 0.7, 18, 2500, 9000, 0.08, 0.15, 0.3), 0.04, peak_db=-12, width=0.8)
    L.add(lp(drum('D2', 0.7, 'doum', seed='sh', dur=0.7, t60=0.4), 1200), 0.22, peak_db=-6)
    L.add(breath(0.8, 2500, 500, shape='breath', q=1.6, seed='sh', peak_at=0.08, vel=0.6), 0.05, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.16), hp_hz=80, eq=[('peak', 3300, -2, 0.8)])


def struck_low(L: Layers, seed: str) -> None:
    """The structure line's strike: a low D3 hourbell over a stone-kicked doum and a rumble (both lines open on it)."""
    r = R(f'struck_{seed}')
    L.add(drum('D2', 1.0, 'doum', seed=seed, dur=1.0, t60=0.6, kick=1.4), 0.0, peak_db=-2)
    L.add(bell('D3', 2.6, 0.9, decay=0.42, bright=0.7, seed=seed), 0.0, peak_db=0)
    L.add(S.rumble(r, 1.6, 120, 1.0, 0.02, rough=0.3), 0.0, peak_db=-10)


@cue('m_structure_ally_fall', 'voice', ('m', -15.0), STING, **STINGK)
def m_structure_ally_fall(v: int):
    """One of YOUR structures fell: the low D3 hourbell, then Dsus2 held in glass (D4 · E4 · A4, no third: it does
    not resolve), breath falling under it. The loss hangs."""
    L = Layers(3.0)
    struck_low(L, 'saf')
    for i, note in enumerate(('D4', 'E4', 'A4')):
        L.add(glass(note, 2.4, 0.7, decay=0.9, bright=0.55, seed=f'saf{i}'), 0.32 + 0.05 * i, peak_db=-5 - i, pan=(-0.25, 0.25, 0.0)[i])
    L.add(lp(bell('A3', 2.0, 0.7, decay=0.3, bright=0.5, seed='saf2'), 1800), 0.32, peak_db=-8)
    L.add(breath(1.6, 1800, 250, shape='breath', q=1.6, seed='saf', peak_at=0.2), 0.1, peak_db=-12)
    return finish(room(L.out(), 'hall', wet=0.17), hp_hz=30, lp_hz=9000)


@cue('m_structure_enemy_fall', 'voice', ('m', -15.0), STING, **STINGK)
def m_structure_enemy_fall(v: int):
    """An ENEMY structure fell: the same low D3 hourbell, then the chord RESOLVES upward to the bright F# (D4 · F#4
    · A4 in glass, F#5 on top) with a shimmer. The same family, answered."""
    L = Layers(2.8)
    struck_low(L, 'sef')
    for i, note in enumerate(('D4', 'F#4', 'A4')):
        L.add(glass(note, 2.0, 0.8, decay=0.7, bright=0.8, seed=f'sef{i}'), 0.3 + 0.05 * i, peak_db=-4 - 0.5 * i, pan=(-0.25, 0.25, 0.0)[i])
    L.add(glass('F#5', 1.8, 0.85, decay=0.6, bright=0.9, seed='sef3'), 0.48, peak_db=-2)
    L.add(shimmer('F#6', 1.2, 0.5, decay=0.7, index=2.0, seed='sef'), 0.48, peak_db=-13)
    return finish(room(L.out(), 'hall', wet=0.16), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


def noon_glass(L: Layers, seed: str, notes: tuple[str, ...], t0: float, gap: float, gain0: float) -> None:
    """Sunsplinter's timbre: a struck pane of noon glass that splits (sear + shards), then its splinters as glass."""
    r = R(f'noon_{seed}')
    L.add(sear(hz('A5'), 0.5, r, index=(5.0, 1.2), ratio=1.41, sizzle=0.25), 0.0, peak_db=gain0 - 4)
    L.add(pane(hz('E5'), 0.9, 0.6, bright=0.8, r=r), 0.0, peak_db=gain0 - 2)
    L.add(S.shards(r, 0.6, 20, 3000, 10000, 0.06, 0.12, 0.25), 0.02, peak_db=gain0 - 10, width=0.8)
    for i, note in enumerate(notes):
        L.add(glass(note, 1.2, 0.8, decay=0.4, bright=0.9, seed=f'{seed}{i}'), t0 + gap * i, peak_db=gain0 - 1 - 0.5 * i,
              pan=(-0.3, 0.3, 0.0, 0.15)[i % 4])


@cue('m_ann_sunsplinter_own', 'voice', ('m', -16.0), STING, **ANNK)
def m_ann_sunsplinter_own(v: int):
    """Your team took the Sunsplinter: noon glass struck and splitting, its splinters climbing A5 → D6 → F#6 (the
    bright colour) over a doum."""
    L = Layers(2.4)
    L.add(drum('D2', 0.8, 'doum', seed='sso', dur=0.8, t60=0.45), 0.0, peak_db=-5)
    noon_glass(L, 'sso', ('A5', 'D6', 'F#6'), 0.12, 0.09, 0)
    L.add(shimmer('F#6', 1.2, 0.5, decay=0.7, index=2.0, seed='sso'), 0.3, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.16), hp_hz=60, eq=[('peak', 3300, -2.5, 0.8)])


@cue('m_ann_sunsplinter_foe', 'voice', ('m', -16.0), STING, **ANNK)
def m_ann_sunsplinter_foe(v: int):
    """The other team took the Sunsplinter: the same noon glass splitting, its splinters FALLING E6 → B5 → F5 into
    a muffled doum: the light went to them."""
    L = Layers(2.4)
    noon_glass(L, 'ssf', ('E6', 'B5', 'F5'), 0.12, 0.11, 0)
    L.add(lp(drum('D2', 0.8, 'doum', seed='ssf', dur=0.8, t60=0.45), 900), 0.34, peak_db=-5)
    L.add(breath(1.0, 2500, 400, shape='breath', q=1.6, seed='ssf', peak_at=0.1, vel=0.6), 0.1, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.16), hp_hz=60, lp_hz=10000, eq=[('peak', 3300, -2.5, 0.8)])


def shade_tube(L: Layers, seed: str, gain0: float) -> None:
    """Longshade's timbre: a long shade breath drawn through a struck hollow stone tube (D2's odd harmonics), a dark
    D2 hourbell hum under it."""
    r = R(f'shade_{seed}')
    L.add(hollow(hz('D3'), 1.4, 1.0, r), 0.0, peak_db=gain0)
    L.add(lp(bell('D2', 2.6, 0.85, decay=0.5, bright=0.4, seed=seed), 1200), 0.0, peak_db=gain0 - 3)
    L.add(breath(1.8, 300, 900, shape='breath', q=2.2, seed=seed, peak_at=0.5, vel=0.7), 0.0, peak_db=gain0 - 6, width=0.7)
    L.add(S.thump(0.5, 110, 38, 0.03, 0.35, 2.4), 0.0, peak_db=gain0 - 6)


@cue('m_ann_longshade_own', 'voice', ('m', -16.0), STING, **ANNK)
def m_ann_longshade_own(v: int):
    """Your team took the Longshade: the shade tube and its long breath, then the shadow answered by light: A4 → D5
    in glass rising out of it."""
    L = Layers(2.8)
    shade_tube(L, 'lso', 0)
    L.add(glass('A4', 1.6, 0.8, decay=0.6, bright=0.8, seed='lso1'), 0.45, peak_db=-3, pan=-0.2)
    L.add(glass('D5', 1.8, 0.85, decay=0.7, bright=0.85, seed='lso2'), 0.62, peak_db=-2, pan=0.2)
    return finish(room(L.out(), 'stone', wet=0.16), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('m_ann_longshade_foe', 'voice', ('m', -16.0), STING, **ANNK)
def m_ann_longshade_foe(v: int):
    """The other team took the Longshade: the same tube and breath, sinking: a second breath falls and a low F3
    (the minor third over the D2 hum) closes it."""
    L = Layers(2.8)
    shade_tube(L, 'lsf', 0)
    L.add(breath(1.4, 900, 180, shape='breath', q=2.0, seed='lsf2', peak_at=0.15, vel=0.7), 0.5, peak_db=-8, width=0.6)
    L.add(lp(bell('F3', 2.0, 0.75, decay=0.35, bright=0.5, seed='lsf'), 1600), 0.5, peak_db=-4)
    return finish(room(L.out(), 'stone', wet=0.16), hp_hz=30, lp_hz=8000)


@cue('m_ann_wipe_foe', 'voice', ('m', -14.5), STING, **ANNK)
def m_ann_wipe_foe(v: int):
    """Every lamp of the other team is out: all five tolls struck TOGETHER as one chord (A4 D5 E5 A5 D6) over two
    doums, then the F#6 glow: the peal and its answer at once."""
    r = R('m_ann_wipe_foe')
    L = Layers(3.0)
    L.add(drum('D2', 1.0, 'doum', seed='wf1', dur=1.0, t60=0.55, kick=1.4), 0.0, peak_db=-3)
    L.add(drum('D2', 0.9, 'doum', seed='wf2', dur=1.0, t60=0.55, kick=1.2), 0.22, peak_db=-5)
    for i, note in enumerate(TOLL_NOTES):
        L.add(bell(note, 2.2, 0.85, decay=0.35, bright=0.9, seed=f'wf{i}'), 0.004 * i, peak_db=-3 - 0.5 * i, pan=-0.3 + 0.15 * i)
    L.add(glass('F#6', 1.6, 0.8, decay=0.7, bright=0.9, seed='wf'), 0.3, peak_db=-6)
    L.add(shimmer('A6', 1.4, 0.5, decay=0.8, index=2.5, seed='wf'), 0.3, peak_db=-14)
    L.add(S.sparkle(r, 1.0, 14, 86, 104, t60=0.15, rise=True, pcs=(2, 4, 6, 9, 11)), 0.3, peak_db=-16)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=35, eq=[('peak', 3300, -2.5, 0.8)])


@cue('m_ann_wipe_own', 'voice', ('m', -15.0), STING, **ANNK)
def m_ann_wipe_own(v: int):
    """Every lamp of YOUR team is out: the tolls struck together but muffled and LOW (D3 A3 D4), a breath drawn down
    to nothing and one slow doum. Dark, not cruel."""
    L = Layers(3.0)
    L.add(lp(drum('D2', 0.9, 'doum', seed='wo', dur=1.0, t60=0.6, kick=1.0), 900), 0.0, peak_db=-3)
    for i, note in enumerate(('D3', 'A3', 'D4')):
        L.add(lp(bell(note, 2.6, 0.85, decay=0.45, bright=0.5, seed=f'wo{i}'), 2000), 0.004 * i, peak_db=-1 - i, pan=(-0.2, 0.2, 0.0)[i])
    L.add(glass('B4', 2.2, 0.6, decay=0.9, bright=0.4, seed='wo'), 0.4, peak_db=-10)
    L.add(breath(2.0, 2000, 160, shape='breath', q=1.8, seed='wo', peak_at=0.15), 0.0, peak_db=-9)
    return finish(room(L.out(), 'hall', wet=0.18), hp_hz=30, lp_hz=7000)


@cue('m_ann_vote_end', 'voice', ('m', -19.0), (0.8, 2.2), **ANNK)
def m_ann_vote_end(v: int):
    """A surrender vote failed (your team plays on): two soft glass notes settling A5 → D5 over a frame-drum tek,
    the plate. Smaller than every match line."""
    L = Layers(1.4)
    L.add(drum('D3', 0.5, 'tek', seed='ve', dur=0.25, t60=0.12), 0.0, peak_db=-10)
    L.add(glass('A5', 0.9, 0.7, decay=0.3, bright=0.6, seed='ve1'), 0.0, peak_db=-1)
    L.add(glass('D5', 1.2, 0.75, decay=0.4, bright=0.6, seed='ve2'), 0.16, peak_db=0)
    return finish(room(L.out(), 'plate', wet=0.16), hp_hz=120, eq=[('peak', 3300, -2, 0.8)])
